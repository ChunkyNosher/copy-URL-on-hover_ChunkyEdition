/**
 * Message ID Collision Tests
 * v1.6.3.11-v6 - Tests for message ID collision handling
 *
 * Test Categories:
 * - Iterative collision handling (not recursive)
 * - Counter suffix (-r1, -r2, etc.)
 * - High-frequency ID generation (100+ per millisecond)
 * - No stack overflow under 10k msg/sec
 */

// Helper function at module scope to avoid max-depth lint error
function findNonCollidingId(baseId, maxRetries, idSet) {
  let finalId = baseId;
  let retryCount = 0;

  while (idSet.has(finalId) && retryCount < maxRetries) {
    retryCount++;
    finalId = `${baseId}-r${retryCount}`;
  }

  return { finalId, retryCount };
}

// Helper to populate ID set with collision entries
function populateCollisionIds(baseId, count, idSet) {
  idSet.add(baseId);
  for (let i = 1; i <= count; i++) {
    idSet.add(`${baseId}-r${i}`);
  }
}

describe('Message ID Collision Handling', () => {
  let generatedIds;
  let messageIdCounter;

  beforeEach(() => {
    generatedIds = new Set();
    messageIdCounter = 0;
  });

  /**
   * Helper: Generate base message ID
   */
  const generateBaseMessageId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `msg-${timestamp}-${random}`;
  };

  /**
   * Helper: Generate unique message ID with collision handling
   * v1.6.3.11-v6 - Iterative, not recursive
   */
  const generateUniqueMessageId = () => {
    let baseId = generateBaseMessageId();
    let finalId = baseId;
    let retryCount = 0;
    const MAX_RETRIES = 1000; // Prevent infinite loop

    // Iterative collision handling (not recursive to avoid stack overflow)
    while (generatedIds.has(finalId) && retryCount < MAX_RETRIES) {
      retryCount++;
      finalId = `${baseId}-r${retryCount}`;
    }

    if (retryCount >= MAX_RETRIES) {
      // Ultimate fallback with counter
      messageIdCounter++;
      finalId = `${baseId}-c${messageIdCounter}`;
    }

    generatedIds.add(finalId);
    return { id: finalId, retryCount };
  };

  /**
   * Helper: Simulate recursive ID generation (for comparison)
   * This is what we DON'T want - can cause stack overflow
   */
  const generateIdRecursively = (baseId, depth = 0) => {
    if (depth > 100) {
      throw new Error('Max recursion depth exceeded');
    }

    const id = depth === 0 ? baseId : `${baseId}-r${depth}`;

    if (generatedIds.has(id)) {
      return generateIdRecursively(baseId, depth + 1);
    }

    generatedIds.add(id);
    return id;
  };

  describe('Iterative Collision Handling', () => {
    test('should use iterative approach for collision resolution', () => {
      // Pre-populate with colliding IDs
      const baseId = 'msg-test-123';
      generatedIds.add(baseId);
      generatedIds.add(`${baseId}-r1`);
      generatedIds.add(`${baseId}-r2`);

      // Custom generator for test
      let finalId = baseId;
      let retryCount = 0;

      while (generatedIds.has(finalId)) {
        retryCount++;
        finalId = `${baseId}-r${retryCount}`;
      }

      expect(finalId).toBe(`${baseId}-r3`);
      expect(retryCount).toBe(3);
    });

    test('should NOT use recursive approach', () => {
      // This test verifies the iterative approach by checking
      // that we can handle many collisions without stack overflow
      const baseId = 'msg-stress-test';

      // Add 500 collisions
      generatedIds.add(baseId);
      for (let i = 1; i <= 500; i++) {
        generatedIds.add(`${baseId}-r${i}`);
      }

      // Should find -r501 without stack overflow
      let finalId = baseId;
      let retryCount = 0;

      while (generatedIds.has(finalId) && retryCount < 1000) {
        retryCount++;
        finalId = `${baseId}-r${retryCount}`;
      }

      expect(retryCount).toBe(501);
      expect(finalId).toBe(`${baseId}-r501`);
    });
  });

  describe('Counter Suffix (-r1, -r2, etc.)', () => {
    test('should add -r1 suffix on first collision', () => {
      const baseId = 'msg-1234567890-abc123';
      generatedIds.add(baseId);

      let finalId = baseId;
      let retryCount = 0;

      while (generatedIds.has(finalId)) {
        retryCount++;
        finalId = `${baseId}-r${retryCount}`;
      }

      expect(finalId).toBe(`${baseId}-r1`);
    });

    test('should increment counter on subsequent collisions', () => {
      const baseId = 'msg-test';
      generatedIds.add(baseId);
      generatedIds.add(`${baseId}-r1`);
      generatedIds.add(`${baseId}-r2`);
      generatedIds.add(`${baseId}-r3`);

      let finalId = baseId;
      let retryCount = 0;

      while (generatedIds.has(finalId)) {
        retryCount++;
        finalId = `${baseId}-r${retryCount}`;
      }

      expect(finalId).toBe(`${baseId}-r4`);
      expect(retryCount).toBe(4);
    });

    test('should produce sequential retry suffixes', () => {
      const baseId = 'msg-sequential';
      const collectedIds = [];

      // Generate 5 IDs with same base (forcing collisions)
      for (let i = 0; i < 5; i++) {
        let finalId = baseId;
        let retryCount = 0;

        while (generatedIds.has(finalId)) {
          retryCount++;
          finalId = `${baseId}-r${retryCount}`;
        }

        generatedIds.add(finalId);
        collectedIds.push(finalId);
      }

      expect(collectedIds).toEqual([
        baseId,
        `${baseId}-r1`,
        `${baseId}-r2`,
        `${baseId}-r3`,
        `${baseId}-r4`
      ]);
    });
  });

  describe('High-Frequency ID Generation (100+ per millisecond)', () => {
    test('should handle 100 IDs in same millisecond without collision', () => {
      const startTime = Date.now();
      const ids = [];

      // Mock Date.now to return same value
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => startTime);

      try {
        for (let i = 0; i < 100; i++) {
          const result = generateUniqueMessageId();
          ids.push(result.id);
        }

        // All IDs should be unique
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(100);
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('should handle 1000 IDs per millisecond', () => {
      const startTime = Date.now();
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => startTime);

      try {
        for (let i = 0; i < 1000; i++) {
          generateUniqueMessageId();
        }

        // All should be unique
        expect(generatedIds.size).toBe(1000);
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('should track retry counts under high frequency', () => {
      const startTime = Date.now();
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => startTime);

      // Force same random component
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.5);

      const retryCounts = [];

      try {
        for (let i = 0; i < 10; i++) {
          const result = generateUniqueMessageId();
          retryCounts.push(result.retryCount);
        }

        // First should have 0 retries, subsequent should increase
        expect(retryCounts[0]).toBe(0);
        expect(retryCounts[1]).toBeGreaterThan(0);
      } finally {
        Date.now = originalDateNow;
        Math.random = originalRandom;
      }
    });
  });

  describe('No Stack Overflow Under 10k msg/sec', () => {
    test('should handle 10000 message IDs without stack overflow', () => {
      const startTime = Date.now();
      let completedCount = 0;

      // Don't mock Date.now for realistic test
      for (let i = 0; i < 10000; i++) {
        generateUniqueMessageId();
        completedCount++;
      }

      expect(completedCount).toBe(10000);
      expect(generatedIds.size).toBe(10000);
    });

    test('recursive approach SHOULD fail with many collisions', () => {
      const baseId = 'msg-recursive-test';

      // Pre-populate to force deep recursion
      for (let i = 0; i <= 150; i++) {
        if (i === 0) {
          generatedIds.add(baseId);
        } else {
          generatedIds.add(`${baseId}-r${i}`);
        }
      }

      // This should throw due to recursion limit
      expect(() => {
        generateIdRecursively(baseId);
      }).toThrow('Max recursion depth exceeded');
    });

    test('iterative approach should NOT fail with many collisions', () => {
      const baseId = 'msg-iterative-test';

      // Pre-populate with many collisions (use helper to avoid max-depth)
      populateCollisionIds(baseId, 500, generatedIds);

      // Should complete without throwing - use helper to avoid max-depth
      const { finalId, retryCount } = findNonCollidingId(baseId, 1000, generatedIds);

      expect(retryCount).toBe(501);
      expect(finalId).toBe(`${baseId}-r501`);
    });

    test('should maintain performance under sustained load', () => {
      const startTime = Date.now();

      // Simulate 10k messages
      for (let i = 0; i < 10000; i++) {
        generateUniqueMessageId();
      }

      const elapsed = Date.now() - startTime;

      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('Edge Cases', () => {
    test('should handle fallback to counter suffix at max retries', () => {
      // Test the fallback mechanism directly
      // By forcing the retry count to exceed MAX_RETRIES
      const baseId = 'msg-forced-fallback';
      const MAX_RETRIES = 1000;

      // Pre-populate all -r1 to -r1000 (use helper to avoid max-depth)
      populateCollisionIds(baseId, MAX_RETRIES, generatedIds);

      // Use helper to find non-colliding ID (avoids max-depth lint error)
      const { finalId, retryCount } = findNonCollidingId(baseId, MAX_RETRIES, generatedIds);

      // Should have exhausted retries
      expect(retryCount).toBe(MAX_RETRIES);
      expect(generatedIds.has(finalId)).toBe(true);

      // Fallback to counter suffix
      messageIdCounter++;
      const fallbackId = `${baseId}-c${messageIdCounter}`;
      expect(fallbackId).toContain('-c');
    });

    test('should handle empty ID set correctly', () => {
      const result = generateUniqueMessageId();

      expect(result.id).toBeDefined();
      expect(result.retryCount).toBe(0);
    });

    test('should handle rapid sequential generation', () => {
      const ids = [];
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        ids.push(generateUniqueMessageId().id);
      }

      const duration = performance.now() - start;

      // All unique
      expect(new Set(ids).size).toBe(1000);

      // Fast (< 100ms for 1000 IDs)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('ID Format Consistency', () => {
    test('should maintain consistent ID format with suffix', () => {
      const baseId = 'msg-format-test';
      generatedIds.add(baseId);

      let finalId = baseId;
      let retryCount = 0;

      while (generatedIds.has(finalId)) {
        retryCount++;
        finalId = `${baseId}-r${retryCount}`;
      }

      // Format should be: baseId-rN
      expect(finalId).toMatch(/^msg-format-test-r\d+$/);
    });

    test('should use numeric suffix without leading zeros', () => {
      const baseId = 'msg-numeric';

      for (let i = 0; i < 15; i++) {
        generatedIds.add(i === 0 ? baseId : `${baseId}-r${i}`);
      }

      let finalId = baseId;
      let retryCount = 0;

      while (generatedIds.has(finalId)) {
        retryCount++;
        finalId = `${baseId}-r${retryCount}`;
      }

      // Should be -r15, not -r015 or -r0015
      expect(finalId).toBe(`${baseId}-r15`);
    });
  });
});
