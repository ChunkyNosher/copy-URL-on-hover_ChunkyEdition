/**
 * DOMUpdateBatcher - Debounced & Batched DOM Updates
 *
 * Phase 3C Optimization #8: Debounced & Batched DOM Updates
 *
 * Problem: Every drag/resize event immediately updates DOM, triggering
 * reflows on each event (60+ events/second during drag).
 *
 * Solution: Queue DOM updates and flush in batch via requestAnimationFrame.
 * Multiple requests to the same element are coalesced (only last one runs).
 *
 * Expected Impact:
 * - 55-60 FPS drag performance
 * - 95% reduction in reflow count
 * - Smoother animations
 * - Improved battery life
 *
 * @version 1.6.4
 * @author Phase 3C UI Performance Optimization
 */

/**
 * Update types for categorization
 * @constant {Object}
 */
const UPDATE_TYPES = {
  STYLE: 'style',
  ATTRIBUTE: 'attribute',
  CLASS: 'class',
  CONTENT: 'content',
  TRANSFORM: 'transform'
};

/**
 * Priority levels for update ordering
 * Higher priority updates are processed first
 * @constant {Object}
 */
const PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4
};

/**
 * DOMUpdateBatcher collects DOM change requests and flushes them
 * in a single batch using requestAnimationFrame.
 *
 * Key features:
 * - Coalesces multiple updates to the same element
 * - Priority-based ordering
 * - Automatic RAF scheduling
 * - Metrics collection for performance monitoring
 *
 * @example
 * const batcher = new DOMUpdateBatcher();
 *
 * // Queue style updates
 * batcher.queueStyleUpdate(element, { left: '100px', top: '50px' });
 *
 * // Queue transform (uses GPU acceleration)
 * batcher.queueTransform(element, { translateX: 100, translateY: 50 });
 *
 * // Force immediate flush if needed
 * batcher.flush();
 *
 * // Cleanup
 * batcher.destroy();
 */
class DOMUpdateBatcher {
  /**
   * Create a new DOMUpdateBatcher instance
   *
   * @param {Object} [options] - Configuration options
   * @param {boolean} [options.enableMetrics=false] - Enable performance metrics
   * @param {number} [options.maxBatchSize=100] - Max updates per batch before force flush
   * @param {Function} [options.onFlush] - Callback after each flush
   */
  constructor(options = {}) {
    // Configuration
    this._enableMetrics = options.enableMetrics || false;
    this._maxBatchSize = options.maxBatchSize || 100;
    this._onFlush = options.onFlush || null;

    // State
    this._isDestroyed = false;
    this._rafId = null;
    this._isFlushing = false;

    // Update queues - Map keyed by element for coalescing
    // Structure: Map<element, Map<updateType, { updates, priority }>>
    this._pendingUpdates = new Map();

    // Metrics
    this._metrics = {
      totalUpdatesQueued: 0,
      totalUpdatesProcessed: 0,
      totalFlushes: 0,
      totalCoalesced: 0,
      avgBatchSize: 0,
      lastFlushDuration: 0
    };

    // Bind methods
    this._boundFlush = this._performFlush.bind(this);
  }

  /**
   * Queue a style update for an element
   * Multiple style updates to the same element are merged
   *
   * @param {HTMLElement} element - Target element
   * @param {Object} styles - Style properties to update (e.g., { left: '10px', top: '20px' })
   * @param {number} [priority=PRIORITY.NORMAL] - Update priority
   */
  queueStyleUpdate(element, styles, priority = PRIORITY.NORMAL) {
    if (this._isDestroyed || !element) return;

    this._queueUpdate(element, UPDATE_TYPES.STYLE, styles, priority, (el, val) => {
      Object.assign(el.style, val);
    });
  }

  /**
   * Queue an attribute update for an element
   *
   * @param {HTMLElement} element - Target element
   * @param {Object} attributes - Attributes to update (e.g., { 'data-id': '123' })
   * @param {number} [priority=PRIORITY.NORMAL] - Update priority
   */
  queueAttributeUpdate(element, attributes, priority = PRIORITY.NORMAL) {
    if (this._isDestroyed || !element) return;

    this._queueUpdate(element, UPDATE_TYPES.ATTRIBUTE, attributes, priority, (el, val) => {
      for (const [key, value] of Object.entries(val)) {
        if (value === null || value === undefined) {
          el.removeAttribute(key);
        } else {
          el.setAttribute(key, value);
        }
      }
    });
  }

  /**
   * Queue a class update for an element
   *
   * @param {HTMLElement} element - Target element
   * @param {Object} classChanges - Classes to add/remove (e.g., { add: ['active'], remove: ['hidden'] })
   * @param {number} [priority=PRIORITY.NORMAL] - Update priority
   */
  queueClassUpdate(element, classChanges, priority = PRIORITY.NORMAL) {
    if (this._isDestroyed || !element) return;

    this._queueUpdate(element, UPDATE_TYPES.CLASS, classChanges, priority, (el, val) => {
      if (val.add) {
        el.classList.add(...val.add);
      }
      if (val.remove) {
        el.classList.remove(...val.remove);
      }
      if (val.toggle) {
        for (const className of val.toggle) {
          el.classList.toggle(className);
        }
      }
    });
  }

  /**
   * Queue a content update for an element (textContent or innerHTML)
   *
   * @param {HTMLElement} element - Target element
   * @param {Object} content - Content to set (e.g., { text: 'Hello' } or { html: '<b>Hello</b>' })
   * @param {number} [priority=PRIORITY.NORMAL] - Update priority
   */
  queueContentUpdate(element, content, priority = PRIORITY.NORMAL) {
    if (this._isDestroyed || !element) return;

    this._queueUpdate(element, UPDATE_TYPES.CONTENT, content, priority, (el, val) => {
      if (val.text !== undefined) {
        el.textContent = val.text;
      } else if (val.html !== undefined) {
        el.innerHTML = val.html;
      }
    });
  }

  /**
   * Queue a transform update (GPU-accelerated)
   * Transforms are coalesced into a single transform string
   *
   * @param {HTMLElement} element - Target element
   * @param {Object} transform - Transform properties
   * @param {number} [transform.translateX] - X translation in pixels
   * @param {number} [transform.translateY] - Y translation in pixels
   * @param {number} [transform.scale] - Scale factor
   * @param {number} [transform.rotate] - Rotation in degrees
   * @param {number} [priority=PRIORITY.HIGH] - Update priority (high by default for animations)
   */
  queueTransform(element, transform, priority = PRIORITY.HIGH) {
    if (this._isDestroyed || !element) return;

    this._queueUpdate(element, UPDATE_TYPES.TRANSFORM, transform, priority, (el, val) => {
      const parts = [];

      if (val.translateX !== undefined || val.translateY !== undefined) {
        const x = val.translateX || 0;
        const y = val.translateY || 0;
        parts.push(`translate(${x}px, ${y}px)`);
      }
      if (val.scale !== undefined) {
        parts.push(`scale(${val.scale})`);
      }
      if (val.rotate !== undefined) {
        parts.push(`rotate(${val.rotate}deg)`);
      }

      el.style.transform = parts.join(' ');
    });
  }

  /**
   * Queue a custom update with a custom apply function
   *
   * @param {HTMLElement} element - Target element
   * @param {string} updateKey - Unique key for coalescing (e.g., 'custom-resize')
   * @param {*} value - Value to pass to apply function
   * @param {Function} applyFn - Function to apply the update: (element, value) => void
   * @param {number} [priority=PRIORITY.NORMAL] - Update priority
   */
  queueCustomUpdate(element, updateKey, value, applyFn, priority = PRIORITY.NORMAL) {
    if (this._isDestroyed || !element || typeof applyFn !== 'function') return;

    this._queueUpdate(element, updateKey, value, priority, applyFn);
  }

  /**
   * Force immediate flush of all pending updates
   * Bypasses RAF scheduling
   */
  flush() {
    if (this._isDestroyed) return;

    // Cancel any pending RAF
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._performFlush();
  }

  /**
   * Cancel all pending updates without applying them
   */
  cancel() {
    if (this._isDestroyed) return;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._pendingUpdates.clear();
  }

  /**
   * Get the number of pending updates
   * @returns {number} Number of pending updates
   */
  getPendingCount() {
    let count = 0;
    for (const elementUpdates of this._pendingUpdates.values()) {
      count += elementUpdates.size;
    }
    return count;
  }

  /**
   * Check if there are pending updates
   * @returns {boolean} True if updates are pending
   */
  hasPendingUpdates() {
    return this._pendingUpdates.size > 0;
  }

  /**
   * Get performance metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics() {
    this._metrics = {
      totalUpdatesQueued: 0,
      totalUpdatesProcessed: 0,
      totalFlushes: 0,
      totalCoalesced: 0,
      avgBatchSize: 0,
      lastFlushDuration: 0
    };
  }

  /**
   * Clean up and destroy the batcher
   */
  destroy() {
    if (this._isDestroyed) return;

    this._isDestroyed = true;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._pendingUpdates.clear();
    this._pendingUpdates = null;
  }

  /**
   * Check if instance is destroyed
   * @returns {boolean} True if destroyed
   */
  isDestroyed() {
    return this._isDestroyed;
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Queue an update for an element
   * @private
   * @param {HTMLElement} element - Target element
   * @param {string} updateType - Type of update
   * @param {*} value - Update value
   * @param {number} priority - Update priority
   * @param {Function} applyFn - Function to apply the update
   */
  _queueUpdate(element, updateType, value, priority, applyFn) {
    // Get or create element's update map
    if (!this._pendingUpdates.has(element)) {
      this._pendingUpdates.set(element, new Map());
    }

    const elementUpdates = this._pendingUpdates.get(element);

    // Check for coalescing
    if (elementUpdates.has(updateType)) {
      // Merge with existing update
      const existing = elementUpdates.get(updateType);
      existing.value = this._mergeValues(existing.value, value, updateType);
      existing.priority = Math.max(existing.priority, priority);

      if (this._enableMetrics) {
        this._metrics.totalCoalesced++;
      }
    } else {
      // New update
      elementUpdates.set(updateType, {
        value,
        priority,
        applyFn
      });
    }

    if (this._enableMetrics) {
      this._metrics.totalUpdatesQueued++;
    }

    // Schedule RAF if not already scheduled
    this._scheduleFlush();
  }

  /**
   * Merge update values for coalescing
   * @private
   * @param {*} existing - Existing value
   * @param {*} incoming - New value
   * @param {string} _updateType - Type of update (unused, kept for future extension)
   * @returns {*} Merged value
   */
  _mergeValues(existing, incoming, _updateType) {
    // For objects, merge properties
    if (typeof existing === 'object' && typeof incoming === 'object') {
      return { ...existing, ...incoming };
    }

    // For non-objects, incoming value wins
    return incoming;
  }

  /**
   * Schedule a flush via requestAnimationFrame
   * @private
   */
  _scheduleFlush() {
    // Don't schedule if already scheduled or currently flushing
    if (this._rafId || this._isFlushing) return;

    // Force immediate flush if batch size exceeded
    if (this.getPendingCount() >= this._maxBatchSize) {
      this._performFlush();
      return;
    }

    this._rafId = requestAnimationFrame(this._boundFlush);
  }

  /**
   * Perform the actual flush of all pending updates
   * @private
   */
  _performFlush() {
    if (this._isDestroyed) return;

    this._rafId = null;
    this._isFlushing = true;

    const startTime = this._enableMetrics ? performance.now() : 0;
    let processedCount = 0;

    try {
      // Collect all updates sorted by priority
      const allUpdates = this._collectSortedUpdates();

      // Apply updates in priority order
      processedCount = this._applyUpdates(allUpdates);

      // Clear pending updates
      this._pendingUpdates.clear();
    } finally {
      this._isFlushing = false;
    }

    // Update metrics and notify
    this._updateFlushMetrics(startTime, processedCount);
  }

  /**
   * Apply collected updates
   * @private
   * @param {Array} allUpdates - Sorted updates to apply
   * @returns {number} Number of updates processed
   */
  _applyUpdates(allUpdates) {
    let processedCount = 0;

    for (const { element, updateType, update } of allUpdates) {
      const applied = this._applySingleUpdate(element, updateType, update);
      if (applied) processedCount++;
    }

    return processedCount;
  }

  /**
   * Apply a single update with error handling
   * @private
   * @param {HTMLElement} element - Target element
   * @param {string} updateType - Type of update
   * @param {Object} update - Update to apply
   * @returns {boolean} True if applied successfully
   */
  _applySingleUpdate(element, updateType, update) {
    try {
      update.applyFn(element, update.value);
      return true;
    } catch (err) {
      console.error('DOMUpdateBatcher: Error applying update:', err, {
        updateType,
        element: element?.tagName
      });
      return false;
    }
  }

  /**
   * Update metrics after flush
   * @private
   * @param {number} startTime - When flush started
   * @param {number} processedCount - Updates processed
   */
  _updateFlushMetrics(startTime, processedCount) {
    if (this._enableMetrics) {
      const duration = performance.now() - startTime;
      this._metrics.totalUpdatesProcessed += processedCount;
      this._metrics.totalFlushes++;
      this._metrics.lastFlushDuration = duration;
      this._metrics.avgBatchSize = this._metrics.totalUpdatesProcessed / this._metrics.totalFlushes;
    }

    // Callback
    if (this._onFlush) {
      this._onFlush({
        updatesProcessed: processedCount,
        duration: this._metrics.lastFlushDuration
      });
    }
  }

  /**
   * Collect all pending updates sorted by priority
   * @private
   * @returns {Array<{ element, updateType, update }>} Sorted updates
   */
  _collectSortedUpdates() {
    const updates = [];

    for (const [element, elementUpdates] of this._pendingUpdates.entries()) {
      for (const [updateType, update] of elementUpdates.entries()) {
        updates.push({ element, updateType, update });
      }
    }

    // Sort by priority (highest first)
    updates.sort((a, b) => b.update.priority - a.update.priority);

    return updates;
  }
}

/**
 * Singleton instance for global use
 * @type {DOMUpdateBatcher|null}
 */
let _globalBatcher = null;

/**
 * Get or create the global DOMUpdateBatcher instance
 *
 * @param {Object} [options] - Options for creating new instance
 * @returns {DOMUpdateBatcher} Global batcher instance
 */
function getGlobalBatcher(options = {}) {
  if (!_globalBatcher || _globalBatcher.isDestroyed()) {
    _globalBatcher = new DOMUpdateBatcher(options);
  }
  return _globalBatcher;
}

/**
 * Destroy the global batcher instance
 */
function destroyGlobalBatcher() {
  if (_globalBatcher) {
    _globalBatcher.destroy();
    _globalBatcher = null;
  }
}

export default DOMUpdateBatcher;
export { DOMUpdateBatcher, UPDATE_TYPES, PRIORITY, getGlobalBatcher, destroyGlobalBatcher };
