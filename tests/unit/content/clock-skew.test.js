/**
 * Clock Skew Tolerance Tests
 * v1.6.3.11-v6 - Tests for stale event detection with clock skew tolerance
 *
 * Test Categories:
 * - 150ms tolerance window for stale event detection
 * - Events within tolerance are NOT rejected
 * - Events outside tolerance ARE rejected
 */

describe('Clock Skew Tolerance', () => {
  // Constant matching content.js
  const CLOCK_SKEW_TOLERANCE_MS = 150;

  let pageInactiveTimestamp;

  beforeEach(() => {
    pageInactiveTimestamp = null;
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Check if an event timestamp is stale
   * v1.6.3.11-v7 - FIX Diagnostic Issue #8
   */
  const isStaleEvent = eventTimestamp => {
    if (!pageInactiveTimestamp || !eventTimestamp) return false;

    // Add tolerance for clock skew
    const toleranceAdjustedTimestamp = pageInactiveTimestamp - CLOCK_SKEW_TOLERANCE_MS;

    // Event occurred before page became inactive (with tolerance)
    return eventTimestamp < toleranceAdjustedTimestamp;
  };

  /**
   * Mark page as inactive (entering BFCache)
   */
  const markPageInactive = () => {
    pageInactiveTimestamp = Date.now();
  };

  /**
   * Mark page as active (restored from BFCache)
   */
  const markPageActive = () => {
    pageInactiveTimestamp = null;
  };

  describe('150ms Tolerance Window', () => {
    test('should use 150ms tolerance window constant', () => {
      expect(CLOCK_SKEW_TOLERANCE_MS).toBe(150);
    });

    test('should calculate tolerance-adjusted timestamp correctly', () => {
      markPageInactive();
      const expectedTolerance = pageInactiveTimestamp - CLOCK_SKEW_TOLERANCE_MS;

      // Event at exactly tolerance boundary
      const boundaryTimestamp = expectedTolerance;

      expect(isStaleEvent(boundaryTimestamp)).toBe(false);
      expect(isStaleEvent(boundaryTimestamp - 1)).toBe(true);
    });

    test('should handle tolerance at various time points', () => {
      // Mark inactive at known time
      jest.setSystemTime(new Date('2024-01-01T12:00:10.000Z'));
      markPageInactive();

      const inactiveTime = pageInactiveTimestamp; // 1704110410000

      // Events at different times relative to inactive time
      const testCases = [
        { offset: -200, expected: true }, // 200ms before inactive - stale
        { offset: -160, expected: true }, // 160ms before inactive - stale (outside tolerance)
        { offset: -150, expected: false }, // Exactly at tolerance boundary - NOT stale
        { offset: -100, expected: false }, // 100ms before inactive - NOT stale (within tolerance)
        { offset: -50, expected: false }, // 50ms before inactive - NOT stale
        { offset: 0, expected: false }, // At inactive time - NOT stale
        { offset: 100, expected: false } // After inactive time - NOT stale
      ];

      testCases.forEach(({ offset, expected }) => {
        const eventTime = inactiveTime + offset;
        const result = isStaleEvent(eventTime);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Events Within Tolerance (NOT Rejected)', () => {
    test('should NOT reject event 1ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 1;

      expect(isStaleEvent(eventTime)).toBe(false);
    });

    test('should NOT reject event 50ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 50;

      expect(isStaleEvent(eventTime)).toBe(false);
    });

    test('should NOT reject event 100ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 100;

      expect(isStaleEvent(eventTime)).toBe(false);
    });

    test('should NOT reject event 149ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 149;

      expect(isStaleEvent(eventTime)).toBe(false);
    });

    test('should NOT reject event at exactly 150ms before (boundary)', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 150;

      expect(isStaleEvent(eventTime)).toBe(false);
    });

    test('should NOT reject event after inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp + 100;

      expect(isStaleEvent(eventTime)).toBe(false);
    });
  });

  describe('Events Outside Tolerance (ARE Rejected)', () => {
    test('should reject event 151ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 151;

      expect(isStaleEvent(eventTime)).toBe(true);
    });

    test('should reject event 200ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 200;

      expect(isStaleEvent(eventTime)).toBe(true);
    });

    test('should reject event 500ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 500;

      expect(isStaleEvent(eventTime)).toBe(true);
    });

    test('should reject event 1000ms before inactive time', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 1000;

      expect(isStaleEvent(eventTime)).toBe(true);
    });

    test('should reject very old events', () => {
      markPageInactive();
      const eventTime = pageInactiveTimestamp - 60000; // 1 minute old

      expect(isStaleEvent(eventTime)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should return false when page is not inactive', () => {
      // pageInactiveTimestamp is null
      const eventTime = Date.now();

      expect(isStaleEvent(eventTime)).toBe(false);
    });

    test('should return false when event timestamp is null', () => {
      markPageInactive();

      expect(isStaleEvent(null)).toBe(false);
    });

    test('should return false when event timestamp is undefined', () => {
      markPageInactive();

      expect(isStaleEvent(undefined)).toBe(false);
    });

    test('should return false when event timestamp is 0', () => {
      markPageInactive();

      // 0 is falsy, so should return false
      expect(isStaleEvent(0)).toBe(false);
    });

    test('should handle page becoming active again', () => {
      markPageInactive();
      const oldEventTime = pageInactiveTimestamp - 200;

      // Event would be stale while inactive
      expect(isStaleEvent(oldEventTime)).toBe(true);

      // Page becomes active
      markPageActive();

      // Now no events are stale
      expect(isStaleEvent(oldEventTime)).toBe(false);
    });

    test('should handle rapid inactive/active cycles', () => {
      // First cycle
      markPageInactive();
      const firstInactiveTime = pageInactiveTimestamp;
      markPageActive();

      // Second cycle - advance time
      jest.advanceTimersByTime(1000);
      markPageInactive();

      // Old event from before first inactive should be stale
      const oldEvent = firstInactiveTime - 500;
      expect(isStaleEvent(oldEvent)).toBe(true);

      // Event from just before second inactive should not be stale
      const recentEvent = pageInactiveTimestamp - 50;
      expect(isStaleEvent(recentEvent)).toBe(false);
    });
  });

  describe('Realistic Clock Skew Scenarios', () => {
    test('should handle event with slightly skewed timestamp (within tolerance)', () => {
      // Simulate clock skew where event timestamp is slightly behind
      markPageInactive();

      // Event appears to be from 100ms before inactive, but due to clock skew
      // it's actually from around the inactive time
      const eventWithSkew = pageInactiveTimestamp - 100;

      expect(isStaleEvent(eventWithSkew)).toBe(false);
    });

    test('should handle event with network delay appearing old', () => {
      // Event sent 200ms before inactive, but arrives after
      // The 150ms tolerance should NOT save this event
      markPageInactive();

      const delayedEvent = pageInactiveTimestamp - 200;

      expect(isStaleEvent(delayedEvent)).toBe(true);
    });

    test('should handle background tab with delayed events', () => {
      // Background tab receives event batch
      markPageInactive();

      const events = [
        { timestamp: pageInactiveTimestamp - 50, data: 'recent' },
        { timestamp: pageInactiveTimestamp - 100, data: 'within-tolerance' },
        { timestamp: pageInactiveTimestamp - 160, data: 'outside-tolerance' },
        { timestamp: pageInactiveTimestamp - 300, data: 'stale' }
      ];

      const processedEvents = events.filter(e => !isStaleEvent(e.timestamp));

      expect(processedEvents.map(e => e.data)).toEqual(['recent', 'within-tolerance']);
    });
  });

  describe('Tolerance Boundary Precision', () => {
    test('should handle millisecond precision at boundary', () => {
      markPageInactive();

      // Test exact boundary
      expect(isStaleEvent(pageInactiveTimestamp - 150)).toBe(false);
      expect(isStaleEvent(pageInactiveTimestamp - 151)).toBe(true);
    });

    test('should handle fractional milliseconds correctly', () => {
      // Note: JS timestamps don't have sub-millisecond precision in Date.now()
      // but performance.now() does. This test verifies integer handling.
      markPageInactive();

      // floor(pageInactiveTimestamp - 150.5) when pageInactiveTimestamp is large
      // results in pageInactiveTimestamp - 151 (rounded down), which is stale
      // So we test that 150 exactly is NOT stale
      const eventTime = pageInactiveTimestamp - 150;

      expect(isStaleEvent(eventTime)).toBe(false);
    });
  });
});
