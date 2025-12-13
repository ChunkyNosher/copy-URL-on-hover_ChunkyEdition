/**
 * MessageBatcher - Message Batching with Adaptive Windows
 * v1.6.4.15 - Phase 3B Optimization #4: Batch rapid operations into single messages
 * v1.6.3.8-v6 - Issue #2: Added queue size limits and TTL-based pruning
 * v1.6.3.8-v7 - Issue #7: Added comprehensive logging with correlationId tracking
 *
 * Purpose: Reduce message count by 50-70% during batch operations by collecting
 * rapid operations and sending them as a single batch message.
 *
 * Features:
 * - Queue operations over sliding window (50ms initial, extends to 100ms)
 * - Adaptive window that extends if operations keep arriving
 * - Coalesce multiple updates to the same Quick Tab
 * - Configurable window size and max batch size
 * - v1.6.3.8-v6: Queue size limits with overflow handling (drop oldest)
 * - v1.6.3.8-v6: TTL-based message pruning before flush
 * - v1.6.3.8-v7: Comprehensive logging with enqueue/flush/failure events
 *
 * Architecture:
 * - Operations are queued with timestamps
 * - Window closes when no new operations arrive within threshold
 * - Batch is sent via callback when window closes
 * - Per-Quick-Tab deduplication within batch
 *
 * Expected Impact: 50-70% reduction in message count during batch operations
 *
 * @module MessageBatcher
 */

// Configuration constants
const DEFAULT_INITIAL_WINDOW_MS = 50; // Initial batch window
const DEFAULT_MAX_WINDOW_MS = 100; // Maximum window extension
const DEFAULT_MAX_BATCH_SIZE = 100; // Max operations per batch
const DEFAULT_EXTENSION_THRESHOLD_MS = 20; // Extend if op arrives within this threshold

// v1.6.3.8-v6 - Issue #2: Queue size limits and TTL
const DEFAULT_MAX_QUEUE_SIZE = 100; // Max queue size before overflow handling
const DEFAULT_MAX_MESSAGE_AGE_MS = 30000; // 30 seconds TTL for messages

// v1.6.3.8-v7 - Issue #7: Debug flag for enhanced logging
const DEBUG_BATCHER = true;

/**
 * Batched operation structure
 * @typedef {Object} BatchedOperation
 * @property {string} quickTabId - Quick Tab ID affected
 * @property {string} type - Operation type ('create', 'update', 'delete', etc.)
 * @property {Object} data - Operation data
 * @property {number} timestamp - When operation was queued
 * @property {string} [correlationId] - Optional correlation ID for tracing
 */

/**
 * Batch result structure
 * @typedef {Object} BatchResult
 * @property {BatchedOperation[]} operations - Coalesced operations
 * @property {number} originalCount - Count before coalescing
 * @property {number} coalescedCount - Count after coalescing
 * @property {number} windowDuration - Total window duration in ms
 * @property {number} extensions - Number of window extensions
 */

/**
 * MessageBatcher class
 * Manages batching of messages with adaptive windows
 */
class MessageBatcher {
  /**
   * Create a new MessageBatcher
   *
   * @param {Object} options - Configuration options
   * @param {number} [options.initialWindowMs=50] - Initial batch window in ms
   * @param {number} [options.maxWindowMs=100] - Maximum window duration in ms
   * @param {number} [options.maxBatchSize=100] - Maximum operations per batch
   * @param {number} [options.extensionThresholdMs=20] - Window extension threshold
   * @param {number} [options.maxQueueSize=100] - Maximum queue size before overflow (v1.6.3.8-v6)
   * @param {number} [options.maxMessageAgeMs=30000] - Maximum message age before pruning (v1.6.3.8-v6)
   * @param {Function} [options.onBatchReady] - Callback when batch is ready to send
   */
  constructor(options = {}) {
    this._initialWindowMs = options.initialWindowMs || DEFAULT_INITIAL_WINDOW_MS;
    this._maxWindowMs = options.maxWindowMs || DEFAULT_MAX_WINDOW_MS;
    this._maxBatchSize = options.maxBatchSize || DEFAULT_MAX_BATCH_SIZE;
    this._extensionThresholdMs = options.extensionThresholdMs || DEFAULT_EXTENSION_THRESHOLD_MS;
    // v1.6.3.8-v6 - Issue #2: Queue size limits and TTL
    this._maxQueueSize = options.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE;
    this._maxMessageAgeMs = options.maxMessageAgeMs || DEFAULT_MAX_MESSAGE_AGE_MS;
    this._onBatchReady = options.onBatchReady || null;

    // State
    this._queue = [];
    this._windowStartTime = null;
    this._windowTimerId = null;
    this._lastOperationTime = null;
    this._extensionCount = 0;

    // Metrics
    this._metrics = {
      operationsQueued: 0,
      batchesSent: 0,
      operationsCoalesced: 0,
      totalWindowDuration: 0,
      avgBatchSize: 0,
      // v1.6.3.8-v6 - Issue #2: Track overflow and TTL pruning
      overflowDropped: 0,
      ttlPruned: 0
    };

    this._log('BATCHER_CREATED', {
      initialWindowMs: this._initialWindowMs,
      maxWindowMs: this._maxWindowMs,
      maxBatchSize: this._maxBatchSize,
      maxQueueSize: this._maxQueueSize,
      maxMessageAgeMs: this._maxMessageAgeMs
    });
  }

  /**
   * Log batcher operation if debug is enabled
   * @private
   */
  _log(operation, details = {}) {
    if (!DEBUG_BATCHER) return;
    console.log(`[MessageBatcher] ${operation}:`, {
      ...details,
      queueSize: this._queue.length,
      timestamp: Date.now()
    });
  }

  /**
   * Queue an operation for batching
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {string} type - Operation type
   * @param {Object} data - Operation data
   * @param {string} [correlationId] - Optional correlation ID
   * @returns {boolean} True if operation was queued
   */
  queue(quickTabId, type, data, correlationId = null) {
    const now = Date.now();

    // v1.6.3.8-v7 - Issue #7: Determine queue reason for logging
    let queueReason = 'window_active';
    if (this._windowStartTime === null) {
      queueReason = 'new_window';
    } else if (this._queue.length >= this._maxQueueSize - 1) {
      queueReason = 'near_capacity';
    }

    // v1.6.3.8-v6 - Issue #2: Handle queue overflow (drop oldest)
    if (this._queue.length >= this._maxQueueSize) {
      this._handleQueueOverflow();
      queueReason = 'overflow_handled';
    }

    const operation = {
      quickTabId,
      type,
      data,
      timestamp: now,
      correlationId
    };

    this._queue.push(operation);
    this._metrics.operationsQueued++;
    this._lastOperationTime = now;

    // v1.6.3.8-v7 - Issue #7: Enhanced logging with reason and correlationId
    this._log('BATCHER_ENQUEUE', {
      quickTabId,
      type,
      // v1.6.3.8-v7 - Issue #7: Include reason for queueing
      reason: queueReason,
      queueDepth: this._queue.length,
      queueCapacity: ((this._queue.length / this._maxQueueSize) * 100).toFixed(1) + '%',
      // v1.6.3.8-v7 - Issue #7: Include correlationId for tracing
      correlationId: correlationId || 'none',
      windowOpen: this._windowStartTime !== null
    });

    // Start window if not already started
    if (this._windowStartTime === null) {
      this._startWindow();
    } else {
      // Check if we should extend the window
      this._maybeExtendWindow();
    }

    // Flush immediately if batch size exceeded
    if (this._queue.length >= this._maxBatchSize) {
      this._log('MAX_BATCH_SIZE_REACHED', { maxBatchSize: this._maxBatchSize });
      this._flushBatch();
    }

    return true;
  }

  /**
   * Handle queue overflow by dropping oldest messages
   * v1.6.3.8-v6 - Issue #2: Queue overflow strategy
   * @private
   */
  _handleQueueOverflow() {
    // Drop oldest 10% of queue
    const dropCount = Math.max(1, Math.ceil(this._queue.length * 0.1));
    const droppedOps = this._queue.splice(0, dropCount);

    this._metrics.overflowDropped += dropCount;

    console.warn('[MessageBatcher] QUEUE_OVERFLOW:', {
      droppedCount: dropCount,
      maxQueueSize: this._maxQueueSize,
      queueSizeBefore: this._queue.length + dropCount,
      queueSizeAfter: this._queue.length,
      droppedTypes: droppedOps.map(op => op.type),
      totalOverflowDropped: this._metrics.overflowDropped,
      timestamp: Date.now()
    });
  }

  /**
   * Start the batch window timer
   * @private
   */
  _startWindow() {
    this._windowStartTime = Date.now();
    this._extensionCount = 0;

    this._windowTimerId = setTimeout(() => {
      this._onWindowClose();
    }, this._initialWindowMs);

    this._log('WINDOW_STARTED', {
      windowMs: this._initialWindowMs
    });
  }

  /**
   * Maybe extend the window if operations are still arriving
   * @private
   */
  _maybeExtendWindow() {
    const elapsed = Date.now() - this._windowStartTime;
    const timeSinceLastOp = Date.now() - this._lastOperationTime;

    // Don't extend if already at max
    if (elapsed >= this._maxWindowMs) {
      return;
    }

    // Extend if operation arrived within threshold
    if (timeSinceLastOp <= this._extensionThresholdMs) {
      this._extendWindow();
    }
  }

  /**
   * Extend the window duration
   * @private
   */
  _extendWindow() {
    const elapsed = Date.now() - this._windowStartTime;
    const remaining = this._maxWindowMs - elapsed;

    if (remaining <= 0) {
      return;
    }

    // Clear existing timer
    if (this._windowTimerId) {
      clearTimeout(this._windowTimerId);
    }

    // Set new timer for remaining time
    const extensionMs = Math.min(remaining, this._initialWindowMs);
    this._windowTimerId = setTimeout(() => {
      this._onWindowClose();
    }, extensionMs);

    this._extensionCount++;

    this._log('WINDOW_EXTENDED', {
      extensionMs,
      extensionCount: this._extensionCount,
      totalElapsed: elapsed
    });
  }

  /**
   * Handle window close - flush the batch
   * @private
   */
  _onWindowClose() {
    this._log('WINDOW_CLOSED', {
      duration: Date.now() - this._windowStartTime,
      extensions: this._extensionCount
    });

    this._flushBatch();
  }

  /**
   * Coalesce operations for the same Quick Tab
   * Later operations override earlier ones (except deletes which are final)
   * @private
   * @param {BatchedOperation[]} operations - Operations to coalesce
   * @returns {BatchedOperation[]} Coalesced operations
   */
  _coalesceOperations(operations) {
    const byTab = new Map();

    for (const op of operations) {
      const existing = byTab.get(op.quickTabId);

      if (!existing) {
        byTab.set(op.quickTabId, op);
        continue;
      }

      // Delete operations are final
      if (op.type === 'delete') {
        byTab.set(op.quickTabId, op);
        continue;
      }

      // Skip if existing is a delete
      if (existing.type === 'delete') {
        continue;
      }

      // Create followed by update -> merged create
      if (existing.type === 'create' && op.type === 'update') {
        byTab.set(op.quickTabId, {
          ...existing,
          data: { ...existing.data, ...op.data },
          timestamp: op.timestamp
        });
        continue;
      }

      // Update followed by update -> merged update
      if (existing.type === 'update' && op.type === 'update') {
        byTab.set(op.quickTabId, {
          ...existing,
          data: { ...existing.data, ...op.data },
          timestamp: op.timestamp
        });
        continue;
      }

      // Default: later operation wins
      byTab.set(op.quickTabId, op);
    }

    return Array.from(byTab.values());
  }

  /**
   * Prune messages that have exceeded TTL
   * v1.6.3.8-v6 - Issue #2: TTL-based message pruning
   * @private
   * @param {BatchedOperation[]} operations - Operations to prune
   * @returns {{ validOps: BatchedOperation[], prunedCount: number }}
   */
  _pruneExpiredMessages(operations) {
    const now = Date.now();
    const validOps = [];
    let prunedCount = 0;

    for (const op of operations) {
      const age = now - op.timestamp;
      if (age > this._maxMessageAgeMs) {
        prunedCount++;
      } else {
        validOps.push(op);
      }
    }

    if (prunedCount > 0) {
      this._metrics.ttlPruned += prunedCount;
      console.warn('[MessageBatcher] TTL_PRUNED:', {
        prunedCount,
        maxMessageAgeMs: this._maxMessageAgeMs,
        validCount: validOps.length,
        totalTtlPruned: this._metrics.ttlPruned,
        timestamp: now
      });
    }

    return { validOps, prunedCount };
  }

  /**
   * Update metrics after flush
   * v1.6.3.8-v7 - Issue #7: Extracted to reduce _flushBatch complexity
   * @private
   */
  _updateFlushMetrics(validOpsLength, coalescedOpsLength, windowDuration) {
    this._metrics.batchesSent++;
    this._metrics.operationsCoalesced += validOpsLength - coalescedOpsLength;
    this._metrics.totalWindowDuration += windowDuration;
    this._metrics.avgBatchSize =
      this._metrics.operationsQueued / Math.max(1, this._metrics.batchesSent);
  }

  /**
   * Build flush result object
   * v1.6.3.8-v7 - Issue #7: Extracted to reduce _flushBatch complexity
   * @private
   */
  _buildFlushResult(coalescedOps, originalCount, windowDuration, prunedCount) {
    const correlationIds = coalescedOps.map(op => op.correlationId).filter(id => id != null);

    return {
      operations: coalescedOps,
      originalCount,
      coalescedCount: coalescedOps.length,
      windowDuration,
      extensions: this._extensionCount,
      prunedCount,
      correlationIds
    };
  }

  /**
   * Flush the batch and invoke callback
   * v1.6.3.8-v6 - Issue #2: Add TTL-based pruning before flush
   * v1.6.3.8-v7 - Issue #7: Enhanced logging with message count and target channel
   * @private
   */
  _flushBatch() {
    // Clear timer if running
    if (this._windowTimerId) {
      clearTimeout(this._windowTimerId);
      this._windowTimerId = null;
    }

    // Calculate window duration
    const windowDuration = this._windowStartTime ? Date.now() - this._windowStartTime : 0;

    // Reset window state
    this._windowStartTime = null;
    this._lastOperationTime = null;

    // Get and clear queue
    const originalOps = [...this._queue];
    this._queue = [];

    if (originalOps.length === 0) {
      this._log('BATCHER_FLUSH_SKIP', { reason: 'empty_queue', windowDuration });
      return;
    }

    // v1.6.3.8-v6 - Issue #2: Prune expired messages by TTL before processing
    const { validOps, prunedCount } = this._pruneExpiredMessages(originalOps);

    if (validOps.length === 0) {
      this._log('BATCHER_FLUSH_SKIP', {
        reason: 'all_messages_expired',
        prunedCount,
        originalCount: originalOps.length
      });
      return;
    }

    // Coalesce operations and update metrics
    const coalescedOps = this._coalesceOperations(validOps);
    this._updateFlushMetrics(validOps.length, coalescedOps.length, windowDuration);

    // Build result
    const result = this._buildFlushResult(
      coalescedOps,
      originalOps.length,
      windowDuration,
      prunedCount
    );

    // Log flush
    this._log('BATCHER_FLUSH', {
      messageCount: coalescedOps.length,
      originalCount: originalOps.length,
      validCount: validOps.length,
      coalescedCount: coalescedOps.length,
      prunedCount,
      windowDuration,
      extensions: this._extensionCount,
      correlationIds: result.correlationIds.length > 0 ? result.correlationIds : 'none',
      targetChannel: this._onBatchReady ? 'callback' : 'none'
    });

    this._extensionCount = 0;

    // Invoke callback
    this._invokeFlushCallback(result);
  }

  /**
   * Invoke flush callback safely
   * v1.6.3.8-v7 - Issue #7: Extracted to reduce _flushBatch complexity
   * @private
   */
  _invokeFlushCallback(result) {
    if (!this._onBatchReady) return;

    try {
      this._onBatchReady(result);
    } catch (err) {
      console.error('[MessageBatcher] BATCHER_FLUSH_FAILED:', {
        reason: 'callback_error',
        error: err.message,
        messageCount: result.operations.length,
        correlationIds: result.correlationIds.length > 0 ? result.correlationIds : 'none',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Force flush any pending operations immediately
   *
   * @returns {BatchResult|null} Batch result or null if queue was empty
   */
  flush() {
    if (this._queue.length === 0) {
      return null;
    }

    this._log('FORCE_FLUSH', { queueSize: this._queue.length });
    this._flushBatch();
    return this.getLastBatchResult();
  }

  /**
   * Cancel pending operations without sending
   *
   * @returns {number} Number of cancelled operations
   */
  cancel() {
    // Clear timer
    if (this._windowTimerId) {
      clearTimeout(this._windowTimerId);
      this._windowTimerId = null;
    }

    const cancelledCount = this._queue.length;

    // Clear state
    this._queue = [];
    this._windowStartTime = null;
    this._lastOperationTime = null;
    this._extensionCount = 0;

    this._log('BATCH_CANCELLED', { cancelledCount });

    return cancelledCount;
  }

  /**
   * Get the number of pending operations
   *
   * @returns {number} Queue size
   */
  getPendingCount() {
    return this._queue.length;
  }

  /**
   * Check if there are pending operations
   *
   * @returns {boolean} True if queue is not empty
   */
  hasPending() {
    return this._queue.length > 0;
  }

  /**
   * Get current window status
   *
   * @returns {Object} Window status
   */
  getWindowStatus() {
    const isOpen = this._windowStartTime !== null;
    const elapsed = isOpen ? Date.now() - this._windowStartTime : 0;
    const remaining = isOpen ? Math.max(0, this._maxWindowMs - elapsed) : 0;

    return {
      isOpen,
      elapsed,
      remaining,
      extensions: this._extensionCount,
      pendingCount: this._queue.length
    };
  }

  /**
   * Get batcher metrics
   * v1.6.3.8-v6 - Issue #2: Include overflow and TTL metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return {
      ...this._metrics,
      currentQueueSize: this._queue.length,
      maxQueueSize: this._maxQueueSize,
      queueCapacity: ((this._queue.length / this._maxQueueSize) * 100).toFixed(1) + '%',
      coalescingRatio:
        this._metrics.operationsQueued > 0
          ? ((this._metrics.operationsCoalesced / this._metrics.operationsQueued) * 100).toFixed(
              1
            ) + '%'
          : '0%'
    };
  }

  /**
   * Reset metrics
   * v1.6.3.8-v6 - Issue #2: Include overflow and TTL metrics in reset
   */
  resetMetrics() {
    this._metrics = {
      operationsQueued: 0,
      batchesSent: 0,
      operationsCoalesced: 0,
      totalWindowDuration: 0,
      avgBatchSize: 0,
      overflowDropped: 0,
      ttlPruned: 0
    };
  }

  /**
   * Update configuration
   * v1.6.3.8-v6 - Issue #2: Support configuring queue size and TTL
   * @param {Object} options - New configuration options
   */
  configure(options = {}) {
    if (options.initialWindowMs !== undefined) {
      this._initialWindowMs = options.initialWindowMs;
    }
    if (options.maxWindowMs !== undefined) {
      this._maxWindowMs = options.maxWindowMs;
    }
    if (options.maxBatchSize !== undefined) {
      this._maxBatchSize = options.maxBatchSize;
    }
    if (options.extensionThresholdMs !== undefined) {
      this._extensionThresholdMs = options.extensionThresholdMs;
    }
    // v1.6.3.8-v6 - Issue #2: Support queue size and TTL configuration
    if (options.maxQueueSize !== undefined) {
      this._maxQueueSize = options.maxQueueSize;
    }
    if (options.maxMessageAgeMs !== undefined) {
      this._maxMessageAgeMs = options.maxMessageAgeMs;
    }
    if (options.onBatchReady !== undefined) {
      this._onBatchReady = options.onBatchReady;
    }

    this._log('CONFIGURATION_UPDATED', options);
  }

  /**
   * Destroy the batcher - cancel pending and cleanup
   */
  destroy() {
    this.cancel();
    this._onBatchReady = null;
    this._log('BATCHER_DESTROYED', {});
  }
}

/**
 * Create a new MessageBatcher instance
 *
 * @param {Object} options - Configuration options
 * @returns {MessageBatcher} New batcher instance
 */
export function createBatcher(options = {}) {
  return new MessageBatcher(options);
}

/**
 * Create a batcher pre-configured for broadcast messages
 *
 * @param {Function} onBatchReady - Callback when batch is ready
 * @returns {MessageBatcher} Configured batcher instance
 */
export function createBroadcastBatcher(onBatchReady) {
  return new MessageBatcher({
    initialWindowMs: 50,
    maxWindowMs: 100,
    maxBatchSize: 50,
    extensionThresholdMs: 25,
    onBatchReady
  });
}

/**
 * Create a batcher pre-configured for port messages
 *
 * @param {Function} onBatchReady - Callback when batch is ready
 * @returns {MessageBatcher} Configured batcher instance
 */
export function createPortBatcher(onBatchReady) {
  return new MessageBatcher({
    initialWindowMs: 30,
    maxWindowMs: 80,
    maxBatchSize: 100,
    extensionThresholdMs: 15,
    onBatchReady
  });
}

/**
 * Create a batcher pre-configured for storage operations
 *
 * @param {Function} onBatchReady - Callback when batch is ready
 * @returns {MessageBatcher} Configured batcher instance
 */
export function createStorageBatcher(onBatchReady) {
  return new MessageBatcher({
    initialWindowMs: 100,
    maxWindowMs: 200,
    maxBatchSize: 25,
    extensionThresholdMs: 50,
    onBatchReady
  });
}

// Export the class and factory functions
export { MessageBatcher };

// Export default object with all utilities
export default {
  MessageBatcher,
  createBatcher,
  createBroadcastBatcher,
  createPortBatcher,
  createStorageBatcher
};
