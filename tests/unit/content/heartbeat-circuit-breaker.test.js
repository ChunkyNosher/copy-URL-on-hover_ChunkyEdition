/**
 * Heartbeat Circuit Breaker Tests
 * v1.6.3.11-v6 - Tests for heartbeat failure handling with circuit breaker pattern
 *
 * Test Categories:
 * - Exponential backoff: 15s → 30s → 60s → 120s
 * - Pause at 10 consecutive failures
 * - Reset on successful heartbeat
 */

describe('Heartbeat Circuit Breaker', () => {
  // Constants for heartbeat circuit breaker
  const BASE_HEARTBEAT_INTERVAL_MS = 15000; // 15 seconds
  const MAX_HEARTBEAT_INTERVAL_MS = 120000; // 120 seconds
  const MAX_CONSECUTIVE_FAILURES = 10;

  let consecutiveFailures;
  let currentHeartbeatInterval;
  let isCircuitOpen;
  let successfulHeartbeats;
  let failedHeartbeats;

  beforeEach(() => {
    consecutiveFailures = 0;
    currentHeartbeatInterval = BASE_HEARTBEAT_INTERVAL_MS;
    isCircuitOpen = false;
    successfulHeartbeats = 0;
    failedHeartbeats = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Calculate next heartbeat interval with exponential backoff
   */
  const calculateBackoffInterval = failures => {
    if (failures === 0) return BASE_HEARTBEAT_INTERVAL_MS;

    // Exponential backoff: 15s, 30s, 60s, 120s
    const backoffMultiplier = Math.pow(2, failures);
    const interval = BASE_HEARTBEAT_INTERVAL_MS * backoffMultiplier;

    return Math.min(interval, MAX_HEARTBEAT_INTERVAL_MS);
  };

  /**
   * Handle heartbeat failure
   */
  const handleHeartbeatFailure = () => {
    consecutiveFailures++;
    failedHeartbeats++;

    // Update interval with backoff
    currentHeartbeatInterval = calculateBackoffInterval(consecutiveFailures);

    // Check if we should open circuit
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      isCircuitOpen = true;
    }

    return {
      consecutiveFailures,
      currentInterval: currentHeartbeatInterval,
      circuitOpen: isCircuitOpen
    };
  };

  /**
   * Handle successful heartbeat
   */
  const handleHeartbeatSuccess = () => {
    const wasOpen = isCircuitOpen;

    // Reset state
    consecutiveFailures = 0;
    currentHeartbeatInterval = BASE_HEARTBEAT_INTERVAL_MS;
    isCircuitOpen = false;
    successfulHeartbeats++;

    return {
      consecutiveFailures,
      currentInterval: currentHeartbeatInterval,
      circuitOpen: isCircuitOpen,
      wasCircuitOpen: wasOpen
    };
  };

  /**
   * Send heartbeat (mock)
   */
  const sendHeartbeat = async shouldSucceed => {
    if (shouldSucceed) {
      return handleHeartbeatSuccess();
    }
    return handleHeartbeatFailure();
  };

  describe('Exponential Backoff (15s → 30s → 60s → 120s)', () => {
    test('should start with 15s interval (base)', () => {
      expect(currentHeartbeatInterval).toBe(15000);
    });

    test('should increase to 30s after first failure', () => {
      handleHeartbeatFailure();
      expect(currentHeartbeatInterval).toBe(30000);
    });

    test('should increase to 60s after second failure', () => {
      handleHeartbeatFailure();
      handleHeartbeatFailure();
      expect(currentHeartbeatInterval).toBe(60000);
    });

    test('should increase to 120s after third failure', () => {
      handleHeartbeatFailure();
      handleHeartbeatFailure();
      handleHeartbeatFailure();
      expect(currentHeartbeatInterval).toBe(120000);
    });

    test('should cap at 120s (MAX_HEARTBEAT_INTERVAL_MS)', () => {
      // 5 failures would give 15 * 2^5 = 480s without cap
      for (let i = 0; i < 5; i++) {
        handleHeartbeatFailure();
      }
      expect(currentHeartbeatInterval).toBe(120000);
    });

    test('should follow exponential progression correctly', () => {
      const expectedIntervals = [30000, 60000, 120000, 120000, 120000];

      expectedIntervals.forEach((expected, index) => {
        handleHeartbeatFailure();
        expect(currentHeartbeatInterval).toBe(expected);
      });
    });

    test('should calculate backoff correctly for various failure counts', () => {
      expect(calculateBackoffInterval(0)).toBe(15000);
      expect(calculateBackoffInterval(1)).toBe(30000);
      expect(calculateBackoffInterval(2)).toBe(60000);
      expect(calculateBackoffInterval(3)).toBe(120000);
      expect(calculateBackoffInterval(4)).toBe(120000); // Capped
      expect(calculateBackoffInterval(10)).toBe(120000); // Capped
    });
  });

  describe('Pause at 10 Consecutive Failures', () => {
    test('should open circuit after 10 consecutive failures', () => {
      for (let i = 0; i < 10; i++) {
        handleHeartbeatFailure();
      }

      expect(isCircuitOpen).toBe(true);
      expect(consecutiveFailures).toBe(10);
    });

    test('should NOT open circuit before 10 failures', () => {
      for (let i = 0; i < 9; i++) {
        handleHeartbeatFailure();
      }

      expect(isCircuitOpen).toBe(false);
      expect(consecutiveFailures).toBe(9);
    });

    test('should track consecutive failures accurately', () => {
      const results = [];

      for (let i = 0; i < 12; i++) {
        const result = handleHeartbeatFailure();
        results.push({
          failures: result.consecutiveFailures,
          circuitOpen: result.circuitOpen
        });
      }

      // Check progression
      expect(results[8].failures).toBe(9);
      expect(results[8].circuitOpen).toBe(false);

      expect(results[9].failures).toBe(10);
      expect(results[9].circuitOpen).toBe(true);

      expect(results[11].failures).toBe(12);
      expect(results[11].circuitOpen).toBe(true);
    });

    test('should block new heartbeats when circuit is open', async () => {
      // Open circuit
      for (let i = 0; i < 10; i++) {
        handleHeartbeatFailure();
      }

      expect(isCircuitOpen).toBe(true);

      // Mock heartbeat sender that checks circuit
      const attemptHeartbeat = () => {
        if (isCircuitOpen) {
          return { blocked: true, reason: 'circuit-open' };
        }
        return { blocked: false };
      };

      const result = attemptHeartbeat();
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('circuit-open');
    });
  });

  describe('Reset on Successful Heartbeat', () => {
    test('should reset consecutive failures to 0 on success', () => {
      // Accumulate failures
      for (let i = 0; i < 5; i++) {
        handleHeartbeatFailure();
      }
      expect(consecutiveFailures).toBe(5);

      // Success resets
      handleHeartbeatSuccess();
      expect(consecutiveFailures).toBe(0);
    });

    test('should reset interval to base on success', () => {
      // Failures increase interval
      for (let i = 0; i < 3; i++) {
        handleHeartbeatFailure();
      }
      expect(currentHeartbeatInterval).toBe(120000);

      // Success resets interval
      handleHeartbeatSuccess();
      expect(currentHeartbeatInterval).toBe(15000);
    });

    test('should close circuit on success', () => {
      // Open circuit
      for (let i = 0; i < 10; i++) {
        handleHeartbeatFailure();
      }
      expect(isCircuitOpen).toBe(true);

      // Success closes circuit
      const result = handleHeartbeatSuccess();
      expect(isCircuitOpen).toBe(false);
      expect(result.wasCircuitOpen).toBe(true);
    });

    test('should track that circuit was previously open', () => {
      // Open circuit
      for (let i = 0; i < 10; i++) {
        handleHeartbeatFailure();
      }

      // Close circuit with success
      const result = handleHeartbeatSuccess();

      expect(result.wasCircuitOpen).toBe(true);
      expect(result.circuitOpen).toBe(false);
    });

    test('should allow heartbeats after circuit closes', async () => {
      // Open circuit
      for (let i = 0; i < 10; i++) {
        handleHeartbeatFailure();
      }

      // Close with success
      handleHeartbeatSuccess();

      // New heartbeat should work
      const attemptHeartbeat = () => {
        if (isCircuitOpen) {
          return { blocked: true };
        }
        return { blocked: false };
      };

      expect(attemptHeartbeat().blocked).toBe(false);
    });
  });

  describe('Mixed Success/Failure Scenarios', () => {
    test('should reset failures on any success', async () => {
      // Fail 5 times
      for (let i = 0; i < 5; i++) {
        await sendHeartbeat(false);
      }
      expect(consecutiveFailures).toBe(5);

      // One success resets
      await sendHeartbeat(true);
      expect(consecutiveFailures).toBe(0);

      // Fail again - starts from 1
      await sendHeartbeat(false);
      expect(consecutiveFailures).toBe(1);
    });

    test('should handle alternating success/failure', async () => {
      const results = [];

      // Alternate pattern
      for (let i = 0; i < 6; i++) {
        const success = i % 2 === 0; // success, fail, success, fail, success, fail
        await sendHeartbeat(success);
        results.push(consecutiveFailures);
      }

      // Failures should never accumulate beyond 1
      expect(Math.max(...results)).toBe(1);
    });

    test('should track total heartbeats', async () => {
      // 5 successes
      for (let i = 0; i < 5; i++) {
        await sendHeartbeat(true);
      }

      // 3 failures
      for (let i = 0; i < 3; i++) {
        await sendHeartbeat(false);
      }

      expect(successfulHeartbeats).toBe(5);
      expect(failedHeartbeats).toBe(3);
    });
  });

  describe('Timing Behavior', () => {
    test('should schedule next heartbeat after interval', () => {
      const scheduledIntervals = [];
      let scheduledCallback;

      const scheduleNextHeartbeat = () => {
        scheduledIntervals.push(currentHeartbeatInterval);
        // Mock scheduling
        scheduledCallback = setTimeout(() => {
          // Heartbeat logic
        }, currentHeartbeatInterval);
      };

      // Initial schedule
      scheduleNextHeartbeat();
      expect(scheduledIntervals[0]).toBe(15000);

      // After failure
      handleHeartbeatFailure();
      scheduleNextHeartbeat();
      expect(scheduledIntervals[1]).toBe(30000);

      clearTimeout(scheduledCallback);
    });

    test('should reschedule with shorter interval on success after failures', () => {
      const intervals = [];

      // Failures increase interval
      for (let i = 0; i < 3; i++) {
        handleHeartbeatFailure();
        intervals.push(currentHeartbeatInterval);
      }

      // Success resets
      handleHeartbeatSuccess();
      intervals.push(currentHeartbeatInterval);

      expect(intervals).toEqual([30000, 60000, 120000, 15000]);
    });
  });

  describe('Edge Cases', () => {
    test('should handle rapid success calls', () => {
      for (let i = 0; i < 100; i++) {
        handleHeartbeatSuccess();
      }

      expect(successfulHeartbeats).toBe(100);
      expect(consecutiveFailures).toBe(0);
      expect(currentHeartbeatInterval).toBe(15000);
    });

    test('should handle success when not in failure state', () => {
      const result = handleHeartbeatSuccess();

      expect(result.wasCircuitOpen).toBe(false);
      expect(result.consecutiveFailures).toBe(0);
    });

    test('should maintain state consistency under stress', () => {
      // Random pattern of success/failure
      const pattern = [false, false, true, false, false, false, true, false, false, false];

      pattern.forEach(success => {
        if (success) {
          handleHeartbeatSuccess();
        } else {
          handleHeartbeatFailure();
        }
      });

      // After pattern: fail, fail, success, fail, fail, fail, success, fail, fail, fail
      // Final consecutive failures should be 3
      expect(consecutiveFailures).toBe(3);
      expect(isCircuitOpen).toBe(false);
    });

    test('should handle exactly MAX_CONSECUTIVE_FAILURES edge', () => {
      // Exactly 9 failures - circuit still closed
      for (let i = 0; i < 9; i++) {
        handleHeartbeatFailure();
      }
      expect(isCircuitOpen).toBe(false);

      // 10th failure - circuit opens
      handleHeartbeatFailure();
      expect(isCircuitOpen).toBe(true);
      expect(consecutiveFailures).toBe(10);
    });
  });
});
