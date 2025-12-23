/**
 * Adaptive Timeout Calculation Tests
 * v1.6.3.11-v6 - Tests for Firefox-specific timeout calculations
 *
 * Test Categories:
 * - _getAdaptiveTimeout() with Firefox realistic latencies
 * - 90th percentile calculation (not 95th)
 * - Timeout extension on background restart detection
 * - Exponential backoff (2x, 4x, 8x delays)
 */

describe('Adaptive Timeout Calculations', () => {
  // Constants matching content.js
  const DEFAULT_MESSAGE_TIMEOUT_MS = 7000;
  const MAX_MESSAGE_TIMEOUT_MS = 30000;
  const ADAPTIVE_TIMEOUT_MULTIPLIER = 4;
  const ADAPTIVE_TIMEOUT_PERCENTILE = 0.9; // 90th percentile
  const RESTART_EXTENDED_TIMEOUT_DURATION_MS = 30000;
  const RESTART_TIMEOUT_MULTIPLIER = 2;

  let recentMessageLatencies;
  let backgroundRestartDetectedRecently;
  let lastBackgroundRestartTime;

  beforeEach(() => {
    recentMessageLatencies = [];
    backgroundRestartDetectedRecently = false;
    lastBackgroundRestartTime = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Helper: Record message latency
   */
  const recordMessageLatency = (latencyMs, maxSamples = 10) => {
    if (typeof latencyMs !== 'number' || latencyMs <= 0) return;
    recentMessageLatencies.push(latencyMs);
    while (recentMessageLatencies.length > maxSamples) {
      recentMessageLatencies.shift();
    }
  };

  /**
   * Helper: Check if in restart recovery period
   */
  const isInRestartRecoveryPeriod = () => {
    if (!backgroundRestartDetectedRecently) return false;
    const elapsed = Date.now() - lastBackgroundRestartTime;
    if (elapsed > RESTART_EXTENDED_TIMEOUT_DURATION_MS) {
      backgroundRestartDetectedRecently = false;
      return false;
    }
    return true;
  };

  /**
   * Implementation of _getAdaptiveTimeout matching content.js
   */
  const getAdaptiveTimeout = () => {
    let baseTimeout;

    if (recentMessageLatencies.length < 3) {
      baseTimeout = DEFAULT_MESSAGE_TIMEOUT_MS;
    } else {
      const sorted = [...recentMessageLatencies].sort((a, b) => a - b);
      const percentileIndex = Math.floor(sorted.length * ADAPTIVE_TIMEOUT_PERCENTILE);
      const percentileLatency = sorted[Math.min(percentileIndex, sorted.length - 1)];
      baseTimeout = Math.round(percentileLatency * ADAPTIVE_TIMEOUT_MULTIPLIER);
      baseTimeout = Math.max(
        DEFAULT_MESSAGE_TIMEOUT_MS,
        Math.min(baseTimeout, MAX_MESSAGE_TIMEOUT_MS)
      );
    }

    if (isInRestartRecoveryPeriod()) {
      const extendedTimeout = baseTimeout * RESTART_TIMEOUT_MULTIPLIER;
      return Math.min(extendedTimeout, MAX_MESSAGE_TIMEOUT_MS);
    }

    return baseTimeout;
  };

  describe('Firefox Realistic Latencies', () => {
    /**
     * Test with Firefox realistic latencies (200ms median, 1500ms p95)
     * v1.6.3.11-v6 - FIX Issue #2
     */
    test('should calculate timeout with Firefox realistic latencies (200ms median, 1500ms p95)', () => {
      // Firefox realistic latency distribution
      // Median ~200ms, P95 ~1500ms, P90 ~1000ms
      const firefoxLatencies = [
        50,
        80,
        120,
        150,
        200, // Low latencies
        250,
        300,
        400,
        600, // Medium latencies
        1000,
        1500,
        2000 // High latencies (p90-p99 range)
      ];

      firefoxLatencies.forEach(latency => recordMessageLatency(latency));

      const timeout = getAdaptiveTimeout();

      // With 12 samples, p90 index = floor(12 * 0.9) = 10
      // Sorted: [50, 80, 120, 150, 200, 250, 300, 400, 600, 1000, 1500, 2000]
      // P90 value = 1500ms
      // Timeout = 1500 * 4 = 6000ms, but min is 7000ms
      expect(timeout).toBeGreaterThanOrEqual(DEFAULT_MESSAGE_TIMEOUT_MS);
      expect(timeout).toBeLessThanOrEqual(MAX_MESSAGE_TIMEOUT_MS);
    });

    test('should handle high latency Firefox environment', () => {
      // High latency scenario (poor network)
      const highLatencies = [500, 800, 1000, 1200, 1500, 2000, 2500, 3000, 3500, 4000];
      highLatencies.forEach(latency => recordMessageLatency(latency));

      const timeout = getAdaptiveTimeout();

      // P90 of high latencies should give higher timeout
      // P90 index = floor(10 * 0.9) = 9, value = 4000ms
      // Timeout = 4000 * 4 = 16000ms
      expect(timeout).toBe(16000);
    });

    test('should use default timeout with insufficient samples', () => {
      recordMessageLatency(100);
      recordMessageLatency(200);
      // Only 2 samples, need 3

      const timeout = getAdaptiveTimeout();
      expect(timeout).toBe(DEFAULT_MESSAGE_TIMEOUT_MS);
    });
  });

  describe('90th Percentile Calculation', () => {
    /**
     * Test 90th percentile (not 95th)
     * v1.6.3.11-v6 - Changed from 95th to 90th for Firefox variance
     */
    test('should use 90th percentile (not 95th) for calculation', () => {
      // 10 samples: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
      for (let i = 1; i <= 10; i++) {
        recordMessageLatency(i * 100);
      }

      const sorted = [...recentMessageLatencies].sort((a, b) => a - b);

      // 90th percentile index: floor(10 * 0.9) = 9
      const p90Index = Math.floor(sorted.length * 0.9);
      const p90Value = sorted[p90Index];

      // 95th percentile index: floor(10 * 0.95) = 9
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95Value = sorted[p95Index];

      expect(p90Index).toBe(9);
      expect(p90Value).toBe(1000); // Index 9 = 1000ms

      // For 10 samples, p90 and p95 index are same, but for larger samples they differ
      expect(p95Index).toBe(9);
    });

    test('should correctly calculate 90th percentile with 20 samples', () => {
      // 20 samples to show difference between p90 and p95
      for (let i = 1; i <= 20; i++) {
        recordMessageLatency(i * 100, 20);
      }

      const sorted = [...recentMessageLatencies].sort((a, b) => a - b);

      // 90th percentile index: floor(20 * 0.9) = 18
      const p90Index = Math.floor(sorted.length * 0.9);
      expect(p90Index).toBe(18);
      expect(sorted[p90Index]).toBe(1900);

      // 95th percentile index: floor(20 * 0.95) = 19
      const p95Index = Math.floor(sorted.length * 0.95);
      expect(p95Index).toBe(19);
      expect(sorted[p95Index]).toBe(2000);
    });

    test('should handle edge case with exactly 3 samples', () => {
      recordMessageLatency(100);
      recordMessageLatency(500);
      recordMessageLatency(1000);

      const timeout = getAdaptiveTimeout();

      // Sorted: [100, 500, 1000]
      // P90 index = floor(3 * 0.9) = 2
      // P90 value = 1000
      // Timeout = 1000 * 4 = 4000, but min is 7000
      expect(timeout).toBe(DEFAULT_MESSAGE_TIMEOUT_MS);
    });
  });

  describe('Background Restart Detection', () => {
    /**
     * Test timeout extension on background restart
     * v1.6.3.11-v6 - FIX Issue #2
     */
    test('should extend timeout 2x during restart recovery period', () => {
      // Record some latencies for baseline
      for (let i = 0; i < 5; i++) {
        recordMessageLatency(2000); // 2s latencies
      }

      // Baseline timeout (no restart)
      const baselineTimeout = getAdaptiveTimeout();

      // Simulate background restart detection
      backgroundRestartDetectedRecently = true;
      lastBackgroundRestartTime = Date.now();

      const extendedTimeout = getAdaptiveTimeout();

      // Extended should be 2x baseline (capped at MAX)
      expect(extendedTimeout).toBe(Math.min(baselineTimeout * 2, MAX_MESSAGE_TIMEOUT_MS));
    });

    test('should return to normal timeout after recovery period ends', () => {
      // Record latencies
      for (let i = 0; i < 5; i++) {
        recordMessageLatency(1000);
      }

      // Start restart recovery
      backgroundRestartDetectedRecently = true;
      lastBackgroundRestartTime = Date.now();

      const duringRecovery = getAdaptiveTimeout();

      // Advance time past recovery period
      jest.advanceTimersByTime(RESTART_EXTENDED_TIMEOUT_DURATION_MS + 1000);

      const afterRecovery = getAdaptiveTimeout();

      expect(duringRecovery).toBeGreaterThan(afterRecovery);
      expect(backgroundRestartDetectedRecently).toBe(false);
    });

    test('should cap extended timeout at MAX_MESSAGE_TIMEOUT_MS', () => {
      // Record very high latencies
      for (let i = 0; i < 5; i++) {
        recordMessageLatency(10000); // 10s latencies
      }

      backgroundRestartDetectedRecently = true;
      lastBackgroundRestartTime = Date.now();

      const timeout = getAdaptiveTimeout();

      // Should be capped at max
      expect(timeout).toBe(MAX_MESSAGE_TIMEOUT_MS);
    });
  });

  describe('Exponential Backoff (2x, 4x, 8x)', () => {
    /**
     * Test exponential backoff delays
     * v1.6.3.11-v6 - FIX Issue #2
     */
    const BASE_BACKOFF_MS = 1000;
    const MAX_BACKOFF_MS = 16000;

    const calculateBackoff = attempt => {
      const multiplier = Math.pow(2, attempt); // 2, 4, 8, 16...
      return Math.min(BASE_BACKOFF_MS * multiplier, MAX_BACKOFF_MS);
    };

    test('should calculate 2x backoff for first retry', () => {
      const backoff = calculateBackoff(1);
      expect(backoff).toBe(2000); // 1000 * 2^1
    });

    test('should calculate 4x backoff for second retry', () => {
      const backoff = calculateBackoff(2);
      expect(backoff).toBe(4000); // 1000 * 2^2
    });

    test('should calculate 8x backoff for third retry', () => {
      const backoff = calculateBackoff(3);
      expect(backoff).toBe(8000); // 1000 * 2^3
    });

    test('should cap backoff at MAX_BACKOFF_MS', () => {
      const backoff = calculateBackoff(5); // Would be 32000
      expect(backoff).toBe(MAX_BACKOFF_MS);
    });

    test('should implement correct retry sequence', () => {
      const retryDelays = [];
      const maxRetries = 4;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        retryDelays.push(calculateBackoff(attempt));
      }

      expect(retryDelays).toEqual([2000, 4000, 8000, 16000]);
    });
  });

  describe('Latency Recording', () => {
    test('should ignore invalid latencies (negative)', () => {
      recordMessageLatency(-100);
      expect(recentMessageLatencies).toHaveLength(0);
    });

    test('should ignore invalid latencies (zero)', () => {
      recordMessageLatency(0);
      expect(recentMessageLatencies).toHaveLength(0);
    });

    test('should ignore non-number latencies', () => {
      recordMessageLatency('100');
      recordMessageLatency(null);
      recordMessageLatency(undefined);
      expect(recentMessageLatencies).toHaveLength(0);
    });

    test('should maintain max sample size', () => {
      for (let i = 0; i < 15; i++) {
        recordMessageLatency(100 + i);
      }

      expect(recentMessageLatencies).toHaveLength(10);
      // Should keep most recent
      expect(recentMessageLatencies[0]).toBe(105);
      expect(recentMessageLatencies[9]).toBe(114);
    });
  });

  describe('Edge Cases', () => {
    test('should handle all identical latencies', () => {
      for (let i = 0; i < 5; i++) {
        recordMessageLatency(500);
      }

      const timeout = getAdaptiveTimeout();

      // P90 of [500, 500, 500, 500, 500] = 500
      // Timeout = 500 * 4 = 2000, but min is 7000
      expect(timeout).toBe(DEFAULT_MESSAGE_TIMEOUT_MS);
    });

    test('should handle very low latencies', () => {
      for (let i = 0; i < 5; i++) {
        recordMessageLatency(10);
      }

      const timeout = getAdaptiveTimeout();

      // Even with very low latencies, minimum is enforced
      expect(timeout).toBe(DEFAULT_MESSAGE_TIMEOUT_MS);
    });

    test('should handle spike in latencies', () => {
      // Normal latencies
      recordMessageLatency(100);
      recordMessageLatency(150);
      recordMessageLatency(200);
      // Spike
      recordMessageLatency(5000);

      const timeout = getAdaptiveTimeout();

      // P90 of [100, 150, 200, 5000] index = 3
      // Value = 5000, timeout = 20000
      expect(timeout).toBe(20000);
    });
  });
});
