/**
 * Circuit Breaker Unit Tests
 * v1.6.3.12-v5 - FIX Issues #1, #5, #8: Circuit breaker and storage failure handling
 */

import {
  CIRCUIT_BREAKER_MODE,
  getCircuitBreakerMode,
  isStorageWriteBlocked,
  recordTransactionSuccess,
  recordTransactionFailure,
  recordTimeoutAndGetBackoff,
  checkWriteBypassOrDelay,
  getCircuitBreakerStatus,
  getPostFailureDelay,
  _resetCircuitBreakerForTesting
} from '../../../src/utils/storage-utils.js';

describe('Circuit Breaker', () => {
  // Reset circuit breaker state before each test
  beforeEach(() => {
    // Use proper test reset to clear all state
    _resetCircuitBreakerForTesting();
  });

  describe('CIRCUIT_BREAKER_MODE enum', () => {
    it('should export all mode values', () => {
      expect(CIRCUIT_BREAKER_MODE.NORMAL).toBe('NORMAL');
      expect(CIRCUIT_BREAKER_MODE.TRIPPED).toBe('TRIPPED');
      expect(CIRCUIT_BREAKER_MODE.FALLBACK).toBe('FALLBACK');
      expect(CIRCUIT_BREAKER_MODE.RECOVERING).toBe('RECOVERING');
    });
  });

  describe('getCircuitBreakerMode', () => {
    it('should return NORMAL mode initially', () => {
      expect(getCircuitBreakerMode()).toBe(CIRCUIT_BREAKER_MODE.NORMAL);
    });
  });

  describe('isStorageWriteBlocked', () => {
    it('should return false when in NORMAL mode', () => {
      expect(isStorageWriteBlocked()).toBe(false);
    });
  });

  describe('recordTransactionSuccess', () => {
    it('should reset failure counters', () => {
      // Record some failures first
      recordTransactionFailure('txn-1', 'test');
      recordTransactionFailure('txn-2', 'test');
      
      // Record success
      recordTransactionSuccess('txn-success');
      
      // Check status - counters should be reset
      const status = getCircuitBreakerStatus();
      expect(status.consecutiveFailedTransactions).toBe(0);
      expect(status.consecutiveTimeouts).toBe(0);
      expect(status.timeoutBackoffIndex).toBe(0);
    });
  });

  describe('recordTransactionFailure', () => {
    it('should increment failure counter', () => {
      const statusBefore = getCircuitBreakerStatus();
      const initialFailures = statusBefore.consecutiveFailedTransactions;
      
      recordTransactionFailure('txn-fail', 'test-reason');
      
      const statusAfter = getCircuitBreakerStatus();
      expect(statusAfter.consecutiveFailedTransactions).toBe(initialFailures + 1);
    });

    it('should trip circuit breaker after threshold failures', () => {
      // Record 5 consecutive failures (threshold)
      for (let i = 0; i < 5; i++) {
        const tripped = recordTransactionFailure(`txn-fail-${i}`, 'test-reason');
        if (i < 4) {
          expect(tripped).toBe(false);
        } else {
          // 5th failure should trip
          expect(tripped).toBe(true);
        }
      }
      
      expect(getCircuitBreakerMode()).not.toBe(CIRCUIT_BREAKER_MODE.NORMAL);
      expect(isStorageWriteBlocked()).toBe(true);
    });
  });

  describe('recordTimeoutAndGetBackoff', () => {
    it('should return exponential backoff delays', () => {
      const result1 = recordTimeoutAndGetBackoff('txn-timeout-1');
      expect(result1.backoffMs).toBe(1000); // First timeout: 1s
      expect(result1.shouldTripCircuitBreaker).toBe(false);
      
      const result2 = recordTimeoutAndGetBackoff('txn-timeout-2');
      expect(result2.backoffMs).toBe(3000); // Second timeout: 3s
      expect(result2.shouldTripCircuitBreaker).toBe(false);
      
      const result3 = recordTimeoutAndGetBackoff('txn-timeout-3');
      expect(result3.backoffMs).toBe(5000); // Third timeout: 5s
      expect(result3.shouldTripCircuitBreaker).toBe(true); // Should trip after 3 timeouts
    });
  });

  describe('checkWriteBypassOrDelay', () => {
    it('should not bypass when in NORMAL mode with no recent failures', () => {
      const result = checkWriteBypassOrDelay('test-txn');
      expect(result.bypass).toBe(false);
      expect(result.reason).toBe(null);
      expect(result.delayMs).toBe(0);
    });

    it('should bypass when circuit breaker is tripped', () => {
      // Trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        recordTransactionFailure(`txn-fail-${i}`, 'test-reason');
      }
      
      const result = checkWriteBypassOrDelay('test-txn');
      expect(result.bypass).toBe(true);
      expect(result.reason).toContain('circuit_breaker');
    });
  });

  describe('getPostFailureDelay', () => {
    it('should return 0 when no recent failures', () => {
      const delay = getPostFailureDelay();
      expect(delay).toBe(0);
    });

    it('should return remaining delay after recent failure', () => {
      // Record a failure
      recordTransactionFailure('txn-fail', 'test-reason');
      
      // Immediately check delay - should be close to 5000ms
      const delay = getPostFailureDelay();
      expect(delay).toBeGreaterThan(4900); // Allow some tolerance for execution time
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe('getCircuitBreakerStatus', () => {
    it('should return all status fields', () => {
      const status = getCircuitBreakerStatus();
      
      expect(status).toHaveProperty('mode');
      expect(status).toHaveProperty('consecutiveFailedTransactions');
      expect(status).toHaveProperty('transactionThreshold');
      expect(status).toHaveProperty('consecutiveTimeouts');
      expect(status).toHaveProperty('timeoutBackoffIndex');
      expect(status).toHaveProperty('fallbackActivatedTime');
      expect(status).toHaveProperty('lastSuccessfulWriteTime');
      expect(status).toHaveProperty('lastTransactionFailureTime');
      expect(status).toHaveProperty('testWriteIntervalActive');
    });

    it('should report threshold value of 5', () => {
      const status = getCircuitBreakerStatus();
      expect(status.transactionThreshold).toBe(5);
    });
  });
});
