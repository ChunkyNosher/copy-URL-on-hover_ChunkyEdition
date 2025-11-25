/**
 * Unit Tests for StorageManager Circuit Breaker
 * 
 * Tests the circuit breaker mechanism that prevents storage operation storms
 * by blocking operations when failures exceed threshold.
 * 
 * Part of memory leak fix - see: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
 */

import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';

describe('StorageManager - Circuit Breaker', () => {
  let storageManager;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn()
    };
    
    storageManager = new StorageManager(mockEventBus, 'firefox-default');
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (storageManager.circuitResetTimer) {
      clearTimeout(storageManager.circuitResetTimer);
    }
  });

  describe('Circuit Breaker Properties', () => {
    it('should have circuit breaker properties initialized', () => {
      expect(storageManager.circuitState).toBe('CLOSED');
      expect(storageManager.failureCount).toBe(0);
      expect(storageManager.successCount).toBe(0);
      // v1.6.2 - MIGRATION: Updated thresholds for storage.local reliability
      expect(storageManager.failureThreshold).toBe(10); // Increased from 5
      expect(storageManager.successThreshold).toBe(2);
      expect(storageManager.resetTimeoutMs).toBe(5000); // Reduced from 10000ms
    });
  });

  describe('isCircuitAllowed', () => {
    it('should allow operations when circuit is CLOSED', () => {
      expect(storageManager.isCircuitAllowed()).toBe(true);
    });

    it('should block operations when circuit is OPEN', () => {
      storageManager.circuitState = 'OPEN';
      storageManager.lastFailureTime = Date.now();
      
      expect(storageManager.isCircuitAllowed()).toBe(false);
    });

    it('should allow operations when circuit is HALF_OPEN', () => {
      storageManager.circuitState = 'HALF_OPEN';
      
      expect(storageManager.isCircuitAllowed()).toBe(true);
    });

    it('should attempt reset when OPEN and timeout passed', () => {
      storageManager.circuitState = 'OPEN';
      storageManager.lastFailureTime = Date.now() - 15000; // 15 seconds ago
      
      // Should trigger reset attempt
      expect(storageManager.isCircuitAllowed()).toBe(true);
      expect(storageManager.circuitState).toBe('HALF_OPEN');
    });
  });

  describe('_recordCircuitFailure', () => {
    it('should increment failure count', () => {
      storageManager._recordCircuitFailure();
      expect(storageManager.failureCount).toBe(1);
      
      storageManager._recordCircuitFailure();
      expect(storageManager.failureCount).toBe(2);
    });

    it('should reset success count on failure', () => {
      storageManager.successCount = 5;
      
      storageManager._recordCircuitFailure();
      
      expect(storageManager.successCount).toBe(0);
    });

    it('should open circuit when threshold reached', () => {
      for (let i = 0; i < storageManager.failureThreshold; i++) {
        storageManager._recordCircuitFailure();
      }
      
      expect(storageManager.circuitState).toBe('OPEN');
    });

    it('should emit event when circuit opens', () => {
      for (let i = 0; i < storageManager.failureThreshold; i++) {
        storageManager._recordCircuitFailure();
      }
      
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'storage:circuit-opened',
        expect.objectContaining({
          resetTimeoutMs: storageManager.resetTimeoutMs
        })
      );
    });
  });

  describe('_openCircuit', () => {
    it('should set state to OPEN', () => {
      storageManager._openCircuit();
      expect(storageManager.circuitState).toBe('OPEN');
    });

    it('should reset failure count', () => {
      storageManager.failureCount = 5;
      
      storageManager._openCircuit();
      
      expect(storageManager.failureCount).toBe(0);
    });

    it('should schedule automatic reset attempt', () => {
      storageManager._openCircuit();
      
      expect(storageManager.circuitResetTimer).not.toBeNull();
    });
  });

  describe('_attemptCircuitReset', () => {
    it('should transition from OPEN to HALF_OPEN', () => {
      storageManager.circuitState = 'OPEN';
      
      storageManager._attemptCircuitReset();
      
      expect(storageManager.circuitState).toBe('HALF_OPEN');
    });

    it('should not change state if not OPEN', () => {
      storageManager.circuitState = 'CLOSED';
      
      storageManager._attemptCircuitReset();
      
      expect(storageManager.circuitState).toBe('CLOSED');
    });

    it('should emit event on half-open', () => {
      storageManager.circuitState = 'OPEN';
      
      storageManager._attemptCircuitReset();
      
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'storage:circuit-half-open',
        expect.objectContaining({
          timestamp: expect.any(Number)
        })
      );
    });
  });

  describe('_recordCircuitSuccess', () => {
    it('should increment success count in HALF_OPEN state', () => {
      storageManager.circuitState = 'HALF_OPEN';
      
      storageManager._recordCircuitSuccess();
      
      expect(storageManager.successCount).toBe(1);
    });

    it('should close circuit when success threshold reached', () => {
      storageManager.circuitState = 'HALF_OPEN';
      
      for (let i = 0; i < storageManager.successThreshold; i++) {
        storageManager._recordCircuitSuccess();
      }
      
      expect(storageManager.circuitState).toBe('CLOSED');
    });

    it('should reset failure count in CLOSED state', () => {
      storageManager.circuitState = 'CLOSED';
      storageManager.failureCount = 3;
      
      storageManager._recordCircuitSuccess();
      
      expect(storageManager.failureCount).toBe(0);
    });
  });

  describe('_closeCircuit', () => {
    it('should set state to CLOSED', () => {
      storageManager.circuitState = 'HALF_OPEN';
      
      storageManager._closeCircuit();
      
      expect(storageManager.circuitState).toBe('CLOSED');
    });

    it('should reset all counts', () => {
      storageManager.failureCount = 10;
      storageManager.successCount = 5;
      
      storageManager._closeCircuit();
      
      expect(storageManager.failureCount).toBe(0);
      expect(storageManager.successCount).toBe(0);
    });

    it('should clear reset timer', () => {
      storageManager._openCircuit();
      expect(storageManager.circuitResetTimer).not.toBeNull();
      
      storageManager._closeCircuit();
      
      expect(storageManager.circuitResetTimer).toBeNull();
    });

    it('should emit event', () => {
      storageManager._closeCircuit();
      
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'storage:circuit-closed',
        expect.objectContaining({
          timestamp: expect.any(Number)
        })
      );
    });
  });

  describe('getCircuitBreakerStats', () => {
    it('should return circuit breaker statistics', () => {
      storageManager.failureCount = 3;
      storageManager.successCount = 1;
      storageManager.lastFailureTime = 1234567890;
      
      const stats = storageManager.getCircuitBreakerStats();
      
      // v1.6.2 - Updated thresholds for storage.local reliability
      expect(stats).toEqual({
        state: 'CLOSED',
        failureCount: 3,
        successCount: 1,
        failureThreshold: 10, // v1.6.2: increased for storage.local
        successThreshold: 2,
        lastFailureTime: 1234567890,
        resetTimeoutMs: 5000 // v1.6.2: reduced for faster recovery
      });
    });
  });
});
