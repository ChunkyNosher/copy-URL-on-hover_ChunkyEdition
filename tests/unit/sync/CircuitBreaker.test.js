/**
 * @fileoverview Unit tests for CircuitBreaker
 * Tests circuit breaker states, thresholds, and auto-recovery
 */

import { CircuitBreaker } from '../../../src/features/quick-tabs/sync/CircuitBreaker.js';

describe('CircuitBreaker', () => {
  let circuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('test', {
      maxOperationsPerSecond: 10,
      maxFailures: 3,
      resetTimeout: 1000
    });

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.state).toBe(CircuitBreaker.STATES.CLOSED);
      expect(circuitBreaker.isClosed()).toBe(true);
      expect(circuitBreaker.isOpen()).toBe(false);
    });

    it('should have zero failure count', () => {
      expect(circuitBreaker.failureCount).toBe(0);
    });

    it('should have zero operation count', () => {
      expect(circuitBreaker.operationCount).toBe(0);
    });
  });

  describe('execute()', () => {
    it('should execute operation successfully when closed', async () => {
      const result = await circuitBreaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should increment operation count', async () => {
      await circuitBreaker.execute(async () => 'success');
      expect(circuitBreaker.operationCount).toBe(1);
    });

    it('should track failures', async () => {
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('test error');
        });
      } catch {
        // Expected
      }
      expect(circuitBreaker.failureCount).toBe(1);
    });

    it('should open circuit after max failures', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('test error');
          });
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.state).toBe(CircuitBreaker.STATES.OPEN);
      expect(circuitBreaker.isOpen()).toBe(true);
    });

    it('should reject operations when open', async () => {
      // Force open state
      circuitBreaker.state = CircuitBreaker.STATES.OPEN;
      circuitBreaker.openedAt = Date.now();

      await expect(
        circuitBreaker.execute(async () => 'success')
      ).rejects.toThrow('CircuitBreaker:test is OPEN - operation rejected');
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Force open state with old timestamp
      circuitBreaker.state = CircuitBreaker.STATES.OPEN;
      circuitBreaker.openedAt = Date.now() - 2000; // 2 seconds ago (> 1 second reset)

      const result = await circuitBreaker.execute(async () => 'success');

      expect(result).toBe('success');
      expect(circuitBreaker.state).toBe(CircuitBreaker.STATES.CLOSED);
    });

    it('should reset to CLOSED on success in HALF_OPEN state', async () => {
      circuitBreaker.state = CircuitBreaker.STATES.HALF_OPEN;

      await circuitBreaker.execute(async () => 'success');

      expect(circuitBreaker.state).toBe(CircuitBreaker.STATES.CLOSED);
      expect(circuitBreaker.failureCount).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('should warn when operation rate exceeded', async () => {
      // Reset operation counter timing
      circuitBreaker.lastReset = Date.now();

      // Execute more than maxOperationsPerSecond
      for (let i = 0; i < 15; i++) {
        try {
          await circuitBreaker.execute(async () => 'success');
        } catch {
          // May throw if circuit opens
        }
      }

      expect(console.warn).toHaveBeenCalled();
    });

    it('should open circuit at 10x rate threshold', async () => {
      // Reset operation counter timing
      circuitBreaker.lastReset = Date.now();

      // Execute way more than threshold (10 * 10 = 100)
      for (let i = 0; i < 101; i++) {
        try {
          await circuitBreaker.execute(async () => 'success');
        } catch {
          // Expected after threshold
        }
      }

      expect(circuitBreaker.state).toBe(CircuitBreaker.STATES.OPEN);
    });
  });

  describe('getState()', () => {
    it('should return current state information', () => {
      const state = circuitBreaker.getState();

      expect(state).toHaveProperty('state', CircuitBreaker.STATES.CLOSED);
      expect(state).toHaveProperty('failureCount', 0);
      expect(state).toHaveProperty('operationCount', 0);
      expect(state).toHaveProperty('openedAt', null);
    });
  });

  describe('reset()', () => {
    it('should reset to CLOSED state', async () => {
      // Force open state
      circuitBreaker.state = CircuitBreaker.STATES.OPEN;
      circuitBreaker.failureCount = 5;
      circuitBreaker.operationCount = 100;

      circuitBreaker.reset();

      expect(circuitBreaker.state).toBe(CircuitBreaker.STATES.CLOSED);
      expect(circuitBreaker.failureCount).toBe(0);
      expect(circuitBreaker.operationCount).toBe(0);
    });
  });

  describe('event emission', () => {
    it('should emit circuit-breaker-open event when opening', async () => {
      const mockDispatchEvent = jest.fn();
      const originalDispatchEvent = window.dispatchEvent;
      
      // Spy on window.dispatchEvent
      window.dispatchEvent = mockDispatchEvent;

      // Create new circuit breaker
      const cb = new CircuitBreaker('test-event', {
        maxOperationsPerSecond: 10,
        maxFailures: 3,
        resetTimeout: 1000
      });

      // Force failures to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('test');
          });
        } catch {
          // Expected
        }
      }

      expect(mockDispatchEvent).toHaveBeenCalled();
      const eventArg = mockDispatchEvent.mock.calls[0][0];
      expect(eventArg.type).toBe('circuit-breaker-open');
      expect(eventArg.detail.name).toBe('test-event');

      // Restore
      window.dispatchEvent = originalDispatchEvent;
    });
  });
});
