/**
 * StorageCoordinator Unit Tests
 * v1.6.3.12 - FIX Issue #14: Centralized storage write coordination
 *
 * Tests for:
 * - Queue behavior: multiple writes are serialized
 * - Only ONE write operation in-flight at a time
 * - Error handling when write fails
 * - Status reporting via getStatus()
 * - Queue draining after write completes
 */

import { getStorageCoordinator } from '../../../src/utils/storage-utils.js';

describe('StorageCoordinator', () => {
  let coordinator;

  beforeEach(() => {
    // Get singleton coordinator and clear any pending state
    coordinator = getStorageCoordinator();
    coordinator.clearQueue();
    jest.clearAllMocks();
  });

  describe('Singleton Behavior', () => {
    test('getStorageCoordinator returns the same instance', () => {
      const instance1 = getStorageCoordinator();
      const instance2 = getStorageCoordinator();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Queue Behavior - Multiple Writes Serialized', () => {
    test('multiple writes execute in order (FIFO)', async () => {
      const executionOrder = [];

      // Queue 3 writes
      const write1 = coordinator.queueWrite('Handler1', async () => {
        executionOrder.push('Handler1');
        return true;
      });

      const write2 = coordinator.queueWrite('Handler2', async () => {
        executionOrder.push('Handler2');
        return true;
      });

      const write3 = coordinator.queueWrite('Handler3', async () => {
        executionOrder.push('Handler3');
        return true;
      });

      // Wait for all writes to complete
      await Promise.all([write1, write2, write3]);

      expect(executionOrder).toEqual(['Handler1', 'Handler2', 'Handler3']);
    });

    test('writes are queued even when one is in progress', async () => {
      let firstWriteStarted = false;
      let firstWriteResolve;
      const firstWritePromise = new Promise(resolve => {
        firstWriteResolve = resolve;
      });

      // Queue first write that will wait
      const write1 = coordinator.queueWrite('SlowHandler', async () => {
        firstWriteStarted = true;
        await firstWritePromise;
        return 'slow';
      });

      // Wait for first write to start
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(firstWriteStarted).toBe(true);

      // Queue another write while first is in progress
      const write2 = coordinator.queueWrite('FastHandler', async () => {
        return 'fast';
      });

      // Check queue status before first completes
      const statusWhileWriting = coordinator.getStatus();
      expect(statusWhileWriting.isWriting).toBe(true);
      expect(statusWhileWriting.queueSize).toBe(1);
      // v1.6.3.12-v5 - FIX Issue #16: pendingHandlers now returns objects with handler, priority, waitTimeMs
      expect(statusWhileWriting.pendingHandlers[0].handler).toBe('FastHandler');

      // Release the first write
      firstWriteResolve();

      // Wait for all to complete
      const [result1, result2] = await Promise.all([write1, write2]);

      expect(result1).toBe('slow');
      expect(result2).toBe('fast');
    });
  });

  describe('Only ONE Write Operation In-Flight', () => {
    test('concurrent operations never overlap', async () => {
      let activeWrites = 0;
      let maxConcurrentWrites = 0;

      const createSlowWrite = handlerName =>
        coordinator.queueWrite(handlerName, async () => {
          activeWrites++;
          maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);

          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 20));

          activeWrites--;
          return handlerName;
        });

      // Queue 5 concurrent writes
      const writes = [
        createSlowWrite('Handler1'),
        createSlowWrite('Handler2'),
        createSlowWrite('Handler3'),
        createSlowWrite('Handler4'),
        createSlowWrite('Handler5')
      ];

      await Promise.all(writes);

      // Verify only one write was ever active at a time
      expect(maxConcurrentWrites).toBe(1);
    });

    test('isWriting flag is correctly managed', async () => {
      let statusDuringWrite;

      await coordinator.queueWrite('TestHandler', async () => {
        statusDuringWrite = coordinator.getStatus();
        return true;
      });

      // Check status was captured during write
      expect(statusDuringWrite.isWriting).toBe(true);
      expect(statusDuringWrite.currentHandler).toBe('TestHandler');

      // Check status after write
      const statusAfterWrite = coordinator.getStatus();
      expect(statusAfterWrite.isWriting).toBe(false);
      expect(statusAfterWrite.currentHandler).toBe(null);
    });
  });

  describe('Error Handling', () => {
    test('write failure rejects promise with error', async () => {
      const testError = new Error('Storage write failed');

      await expect(
        coordinator.queueWrite('FailingHandler', async () => {
          throw testError;
        })
      ).rejects.toThrow('Storage write failed');
    });

    test('failed write does not block subsequent writes', async () => {
      const executionOrder = [];

      // Queue a failing write
      const failingWrite = coordinator
        .queueWrite('FailingHandler', async () => {
          executionOrder.push('FailingHandler-start');
          throw new Error('Intentional failure');
        })
        .catch(_e => {
          executionOrder.push('FailingHandler-error');
        });

      // Queue a successful write after the failing one
      const successfulWrite = coordinator.queueWrite('SuccessHandler', async () => {
        executionOrder.push('SuccessHandler');
        return 'success';
      });

      await Promise.all([failingWrite, successfulWrite]);

      expect(executionOrder).toEqual([
        'FailingHandler-start',
        'FailingHandler-error',
        'SuccessHandler'
      ]);
    });

    test('error in one write does not corrupt queue state', async () => {
      // First write fails
      const write1 = coordinator
        .queueWrite('FailingHandler', async () => {
          throw new Error('Failure');
        })
        .catch(() => 'caught');

      // Second and third writes succeed
      const write2 = coordinator.queueWrite('SuccessHandler1', async () => {
        return 'success1';
      });

      const write3 = coordinator.queueWrite('SuccessHandler2', async () => {
        return 'success2';
      });

      const results = await Promise.all([write1, write2, write3]);

      expect(results).toEqual(['caught', 'success1', 'success2']);

      // Verify queue is clean
      const status = coordinator.getStatus();
      expect(status.queueSize).toBe(0);
      expect(status.isWriting).toBe(false);
    });
  });

  describe('Status Reporting', () => {
    test('getStatus returns correct initial state', () => {
      const status = coordinator.getStatus();

      expect(status).toHaveProperty('queueSize', 0);
      expect(status).toHaveProperty('isWriting', false);
      expect(status).toHaveProperty('currentHandler', null);
      expect(status).toHaveProperty('totalWrites');
      expect(status).toHaveProperty('pendingHandlers');
      expect(Array.isArray(status.pendingHandlers)).toBe(true);
    });

    test('getStatus shows pending handlers', async () => {
      let _statusCapture;
      let resolveFirst;
      const firstBlocked = new Promise(resolve => {
        resolveFirst = resolve;
      });

      // Queue first write that blocks
      const write1 = coordinator.queueWrite('BlockingHandler', async () => {
        await firstBlocked;
        return true;
      });

      // Wait for first to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue more writes
      const write2 = coordinator.queueWrite('PendingHandler1', async () => {
        _statusCapture = coordinator.getStatus();
        return true;
      });

      const write3 = coordinator.queueWrite('PendingHandler2', async () => {
        return true;
      });

      // Check status while blocked
      const statusWhileBlocked = coordinator.getStatus();
      // v1.6.3.12-v5 - FIX Issue #16: pendingHandlers now returns objects with handler, priority, waitTimeMs
      expect(statusWhileBlocked.pendingHandlers.map(p => p.handler)).toEqual(['PendingHandler1', 'PendingHandler2']);

      // Release blocked write
      resolveFirst();
      await Promise.all([write1, write2, write3]);
    });

    test('totalWrites counter increments correctly', async () => {
      const initialStatus = coordinator.getStatus();
      const initialWrites = initialStatus.totalWrites;

      await coordinator.queueWrite('Handler1', async () => true);
      await coordinator.queueWrite('Handler2', async () => true);
      await coordinator.queueWrite('Handler3', async () => true);

      const finalStatus = coordinator.getStatus();
      expect(finalStatus.totalWrites).toBe(initialWrites + 3);
    });
  });

  describe('Queue Draining', () => {
    test('queue drains completely after writes finish', async () => {
      const writes = [];

      for (let i = 0; i < 10; i++) {
        writes.push(
          coordinator.queueWrite(`Handler${i}`, async () => {
            return `result${i}`;
          })
        );
      }

      await Promise.all(writes);

      const status = coordinator.getStatus();
      expect(status.queueSize).toBe(0);
      expect(status.isWriting).toBe(false);
    });

    test('clearQueue rejects pending writes', async () => {
      let resolveBlocker;
      const blocker = new Promise(resolve => {
        resolveBlocker = resolve;
      });

      // Queue blocking write
      const blockedWrite = coordinator.queueWrite('Blocker', async () => {
        await blocker;
        return 'blocked';
      });

      // Wait for it to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue pending writes
      const pending1 = coordinator.queueWrite('Pending1', async () => {
        return 'pending1';
      });

      const pending2 = coordinator.queueWrite('Pending2', async () => {
        return 'pending2';
      });

      // Clear the queue
      coordinator.clearQueue();

      // Pending writes should be rejected
      await expect(pending1).rejects.toThrow('Queue cleared');
      await expect(pending2).rejects.toThrow('Queue cleared');

      // Release blocker and verify original write completes
      resolveBlocker();
      await expect(blockedWrite).resolves.toBe('blocked');

      // Queue should be empty
      const status = coordinator.getStatus();
      expect(status.queueSize).toBe(0);
    });

    test('writes queued after drain start new drain cycle', async () => {
      // Complete first batch
      await Promise.all([
        coordinator.queueWrite('Batch1-1', async () => true),
        coordinator.queueWrite('Batch1-2', async () => true)
      ]);

      // Verify queue is empty
      expect(coordinator.getStatus().queueSize).toBe(0);

      // Queue second batch
      const batch2Results = await Promise.all([
        coordinator.queueWrite('Batch2-1', async () => 'batch2-1'),
        coordinator.queueWrite('Batch2-2', async () => 'batch2-2')
      ]);

      expect(batch2Results).toEqual(['batch2-1', 'batch2-2']);
      expect(coordinator.getStatus().queueSize).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    test('handles rapid fire writes', async () => {
      const results = [];
      const writes = [];

      for (let i = 0; i < 20; i++) {
        writes.push(
          coordinator.queueWrite(`RapidHandler${i}`, async () => {
            results.push(i);
            return i;
          })
        );
      }

      await Promise.all(writes);

      // Verify all writes completed in order
      expect(results).toHaveLength(20);
      expect(results).toEqual([...Array(20).keys()]);
    });

    test('write operation can return various result types', async () => {
      const objectResult = await coordinator.queueWrite('ObjectHandler', async () => ({
        success: true,
        data: 'test'
      }));

      const arrayResult = await coordinator.queueWrite('ArrayHandler', async () => [1, 2, 3]);

      const nullResult = await coordinator.queueWrite('NullHandler', async () => null);

      const undefinedResult = await coordinator.queueWrite(
        'UndefinedHandler',
        async () => undefined
      );

      expect(objectResult).toEqual({ success: true, data: 'test' });
      expect(arrayResult).toEqual([1, 2, 3]);
      expect(nullResult).toBe(null);
      expect(undefinedResult).toBe(undefined);
    });
  });

  // v1.6.3.12-v5 - FIX Issue #16: Priority-based queue tests
  describe('Priority-Based Queue (Issue #16)', () => {
    test('high priority operations process before low priority', async () => {
      const executionOrder = [];
      let resolveBlocker;
      const blockerPromise = new Promise(resolve => {
        resolveBlocker = resolve;
      });

      // Queue a blocker to hold the queue
      const blocker = coordinator.queueWrite('Blocker', async () => {
        await blockerPromise;
        executionOrder.push('Blocker');
        return true;
      }, 2); // MEDIUM priority

      // Wait for blocker to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue operations with different priorities (1=HIGH, 2=MEDIUM, 3=LOW)
      const low = coordinator.queueWrite('LowHandler', async () => {
        executionOrder.push('Low');
        return true;
      }, 3);

      const high = coordinator.queueWrite('HighHandler', async () => {
        executionOrder.push('High');
        return true;
      }, 1);

      const medium = coordinator.queueWrite('MediumHandler', async () => {
        executionOrder.push('Medium');
        return true;
      }, 2);

      // Release blocker
      resolveBlocker();
      await Promise.all([blocker, low, high, medium]);

      // High priority should execute first after blocker
      expect(executionOrder).toEqual(['Blocker', 'High', 'Medium', 'Low']);
    });

    test('getStatus includes priority information', async () => {
      let resolveBlocker;
      const blockerPromise = new Promise(resolve => {
        resolveBlocker = resolve;
      });

      const blocker = coordinator.queueWrite('Blocker', async () => {
        await blockerPromise;
        return true;
      }, 2);

      // Wait for blocker to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Queue with different priorities - capture promises to catch rejections
      const highPromise = coordinator.queueWrite('High', async () => true, 1);
      const lowPromise = coordinator.queueWrite('Low', async () => true, 3);

      const status = coordinator.getStatus();
      expect(status.pendingHandlers.length).toBe(2);
      expect(status.pendingHandlers[0].priority).toBe(1);
      expect(status.pendingHandlers[1].priority).toBe(3);

      // Release blocker and wait for all to complete naturally
      resolveBlocker();
      await blocker;
      await highPromise;
      await lowPromise;
    });

    test('getStatus includes totalEvicted count', () => {
      const status = coordinator.getStatus();
      expect(status).toHaveProperty('totalEvicted');
      expect(typeof status.totalEvicted).toBe('number');
    });
  });
});
