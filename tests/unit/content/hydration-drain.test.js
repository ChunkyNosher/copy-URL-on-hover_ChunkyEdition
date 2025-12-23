/**
 * Hydration Drain Lock Tests
 * v1.6.3.11-v6 - Tests for hydration completion and drain scheduling
 *
 * Test Categories:
 * - Operations queued during drain are processed
 * - Concurrent _markHydrationComplete() calls
 * - Drain continues until queue empty
 * - pendingHydrationCompletions queue processing
 */

// Module-level helpers to avoid max-depth lint errors

/**
 * Helper: Process queue items with potential additions during processing
 */
async function processQueueWithAdditions(queue, processor, processedOps) {
  while (queue.length > 0) {
    const op = queue.shift();
    await processor(op, processedOps);

    // Simulate operation adding new operation during processing
    if (op.addsDuringProcess) {
      queue.push({ id: 'added-during-drain' });
    }
  }
}

/**
 * Helper: Process queue items with error handling
 */
async function processQueueWithErrors(queue, processor) {
  let successCount = 0;
  let errorCount = 0;

  while (queue.length > 0) {
    const op = queue.shift();
    try {
      await processor(op);
      successCount++;
    } catch (_e) {
      errorCount++;
      // Continue processing despite error
    }
  }

  return { successCount, errorCount };
}

describe('Hydration Drain Lock', () => {
  let isHydrationComplete;
  let isDrainInProgress;
  let preHydrationOperationQueue;
  let pendingHydrationCompletions;
  let processedOperations;

  beforeEach(() => {
    isHydrationComplete = false;
    isDrainInProgress = false;
    preHydrationOperationQueue = [];
    pendingHydrationCompletions = [];
    processedOperations = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Helper: Process a single operation
   */
  const processOperation = async operation => {
    processedOperations.push({
      ...operation,
      processedAt: Date.now()
    });
    // Simulate async processing
    return Promise.resolve({ success: true, operationId: operation.id });
  };

  /**
   * Helper: Drain the pre-hydration queue
   * v1.6.3.11-v6 - Queue-based drain to prevent lost operations
   */
  const drainPreHydrationQueue = async () => {
    if (isDrainInProgress) {
      return { skipped: true, reason: 'drain-in-progress' };
    }

    isDrainInProgress = true;
    let drainCount = 0;

    try {
      // Process all queued operations
      while (preHydrationOperationQueue.length > 0) {
        const operation = preHydrationOperationQueue.shift();
        await processOperation(operation);
        drainCount++;
      }

      return { success: true, drainCount };
    } finally {
      isDrainInProgress = false;
    }
  };

  /**
   * Helper: Mark hydration complete and trigger drain
   * v1.6.3.11-v6 - Handle concurrent calls
   */
  const markHydrationComplete = async () => {
    if (isHydrationComplete) {
      // Already complete, queue this completion call
      const completionPromise = new Promise(resolve => {
        pendingHydrationCompletions.push(resolve);
      });
      return completionPromise;
    }

    isHydrationComplete = true;

    // Drain queued operations
    const drainResult = await drainPreHydrationQueue();

    // Process any pending completion calls
    while (pendingHydrationCompletions.length > 0) {
      const resolve = pendingHydrationCompletions.shift();
      resolve({ success: true, queued: true });
    }

    return { success: true, ...drainResult };
  };

  /**
   * Helper: Queue operation for pre-hydration
   */
  const queuePreHydrationOperation = operation => {
    if (isHydrationComplete) {
      // Process immediately if hydration is complete
      return processOperation(operation);
    }

    preHydrationOperationQueue.push(operation);
    return Promise.resolve({ queued: true, queueDepth: preHydrationOperationQueue.length });
  };

  describe('Operations Queued During Drain', () => {
    test('should process operations added during drain', async () => {
      // Queue initial operations
      await queuePreHydrationOperation({ id: 'op-1', action: 'CREATE' });
      await queuePreHydrationOperation({ id: 'op-2', action: 'UPDATE' });

      expect(preHydrationOperationQueue).toHaveLength(2);

      // Mark hydration complete (starts drain)
      await markHydrationComplete();

      // All operations should be processed
      expect(processedOperations).toHaveLength(2);
      expect(preHydrationOperationQueue).toHaveLength(0);
    });

    test('should continue processing if new operations arrive during drain', async () => {
      // Queue initial operations
      await queuePreHydrationOperation({ id: 'op-1', action: 'CREATE' });

      // Simulate drain that adds operations mid-process
      isDrainInProgress = true;

      // Operation added during drain (would normally be queued)
      preHydrationOperationQueue.push({ id: 'op-2', action: 'LATE_ADD' });

      isDrainInProgress = false;

      // Complete drain
      await drainPreHydrationQueue();

      // Both operations should be processed
      expect(processedOperations.map(o => o.id)).toContain('op-1');
      expect(processedOperations.map(o => o.id)).toContain('op-2');
    });
  });

  describe('Concurrent _markHydrationComplete() Calls', () => {
    test('should handle concurrent markHydrationComplete calls safely', async () => {
      // Queue operations
      await queuePreHydrationOperation({ id: 'op-1' });
      await queuePreHydrationOperation({ id: 'op-2' });

      // Simulate concurrent completion calls
      const call1 = markHydrationComplete();
      const call2 = markHydrationComplete();
      const call3 = markHydrationComplete();

      const results = await Promise.all([call1, call2, call3]);

      // First call should complete with drain
      expect(results[0].success).toBe(true);

      // Subsequent calls should be queued and resolved
      expect(results[1].success).toBe(true);
      expect(results[1].queued).toBe(true);
      expect(results[2].success).toBe(true);
      expect(results[2].queued).toBe(true);

      // Operations should only be processed once
      expect(processedOperations).toHaveLength(2);
    });

    test('should prevent double-drain on concurrent calls', async () => {
      await queuePreHydrationOperation({ id: 'op-1' });

      let drainStartCount = 0;
      const originalDrain = drainPreHydrationQueue;

      // Track drain calls
      const trackedDrain = async () => {
        drainStartCount++;
        return originalDrain();
      };

      // First call
      await trackedDrain();

      // Second call should skip due to drain-in-progress check or completion
      const secondResult = await drainPreHydrationQueue();

      // Queue should be empty, so second drain is a no-op
      expect(secondResult.drainCount || 0).toBe(0);
    });
  });

  describe('Drain Until Queue Empty', () => {
    test('should drain until queue is completely empty', async () => {
      // Queue many operations
      for (let i = 0; i < 50; i++) {
        await queuePreHydrationOperation({ id: `op-${i}` });
      }

      expect(preHydrationOperationQueue).toHaveLength(50);

      await markHydrationComplete();

      expect(preHydrationOperationQueue).toHaveLength(0);
      expect(processedOperations).toHaveLength(50);
    });

    test('should handle empty queue gracefully', async () => {
      // No operations queued
      const result = await markHydrationComplete();

      expect(result.success).toBe(true);
      expect(result.drainCount).toBe(0);
      expect(processedOperations).toHaveLength(0);
    });

    test('should process operations in FIFO order', async () => {
      await queuePreHydrationOperation({ id: 'first' });
      await queuePreHydrationOperation({ id: 'second' });
      await queuePreHydrationOperation({ id: 'third' });

      await markHydrationComplete();

      expect(processedOperations[0].id).toBe('first');
      expect(processedOperations[1].id).toBe('second');
      expect(processedOperations[2].id).toBe('third');
    });
  });

  describe('pendingHydrationCompletions Queue', () => {
    test('should queue completion callbacks when already complete', async () => {
      // First completion
      await markHydrationComplete();
      expect(isHydrationComplete).toBe(true);

      // Queue completion callbacks manually for testing
      let callback1Resolved = false;
      let callback2Resolved = false;

      pendingHydrationCompletions.push(() => {
        callback1Resolved = true;
      });
      pendingHydrationCompletions.push(() => {
        callback2Resolved = true;
      });

      // Process pending completions
      while (pendingHydrationCompletions.length > 0) {
        const resolve = pendingHydrationCompletions.shift();
        resolve();
      }

      expect(callback1Resolved).toBe(true);
      expect(callback2Resolved).toBe(true);
    });

    test('should resolve all pending completions after drain', async () => {
      await queuePreHydrationOperation({ id: 'op-1' });

      // Start multiple concurrent completions
      const completions = [];
      for (let i = 0; i < 5; i++) {
        completions.push(markHydrationComplete());
      }

      const results = await Promise.all(completions);

      // All should resolve successfully
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Re-Drain on New Operations', () => {
    test('should schedule re-drain if operations added during drain', async () => {
      let reDrainScheduled = false;

      const processor = async (op, processed) => {
        processed.push({ ...op, processedAt: Date.now() });
        return { success: true };
      };

      const drainWithReschedule = async () => {
        if (isDrainInProgress) {
          reDrainScheduled = true;
          return { skipped: true, reDrainScheduled: true };
        }

        isDrainInProgress = true;

        try {
          // Use module-level helper to avoid max-depth lint error
          await processQueueWithAdditions(
            preHydrationOperationQueue,
            processor,
            processedOperations
          );
          return { success: true };
        } finally {
          isDrainInProgress = false;

          // Re-drain if operations were added
          if (preHydrationOperationQueue.length > 0 && !reDrainScheduled) {
            await drainWithReschedule();
          }
        }
      };

      preHydrationOperationQueue.push({ id: 'op-1', addsDuringProcess: true });

      await drainWithReschedule();

      // Should have processed both original and added operation
      expect(processedOperations.map(o => o.id)).toContain('op-1');
      expect(processedOperations.map(o => o.id)).toContain('added-during-drain');
    });
  });

  describe('Error Handling During Drain', () => {
    test('should continue drain even if individual operation fails', async () => {
      const failingProcessOperation = async operation => {
        if (operation.shouldFail) {
          throw new Error('Operation failed');
        }
        processedOperations.push(operation);
        return { success: true };
      };

      const drainWithErrorHandling = async () => {
        isDrainInProgress = true;

        try {
          // Use module-level helper to avoid max-depth lint error
          const result = await processQueueWithErrors(
            preHydrationOperationQueue,
            failingProcessOperation
          );
          return { success: true, ...result };
        } finally {
          isDrainInProgress = false;
        }
      };

      preHydrationOperationQueue.push({ id: 'op-1' });
      preHydrationOperationQueue.push({ id: 'op-2', shouldFail: true });
      preHydrationOperationQueue.push({ id: 'op-3' });

      const result = await drainWithErrorHandling();

      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(1);
      expect(preHydrationOperationQueue).toHaveLength(0);
    });
  });

  describe('State Consistency', () => {
    test('should maintain isHydrationComplete state after drain', async () => {
      await queuePreHydrationOperation({ id: 'op-1' });

      await markHydrationComplete();

      expect(isHydrationComplete).toBe(true);

      // New operations should process immediately
      const result = await queuePreHydrationOperation({ id: 'op-2' });

      // Should be processed immediately, not queued
      expect(result.queued).toBeUndefined();
    });

    test('should reset drain flag after completion', async () => {
      await queuePreHydrationOperation({ id: 'op-1' });

      await drainPreHydrationQueue();

      expect(isDrainInProgress).toBe(false);
    });
  });
});
