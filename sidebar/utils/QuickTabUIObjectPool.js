/**
 * Quick Tab UI Object Pool
 * Maintains a pool of reusable UI element objects for Quick Tab items
 * to reduce GC churn and improve frame rates during high-churn operations.
 *
 * @version 1.6.4
 *
 * Phase 3D Optimization (#11): Object Pool for Reusable UI Elements
 *
 * **Problem:** Creating/destroying Quick Tab UI objects constantly causes
 * GC churn and frame rate drops.
 *
 * **Solution:** Maintain pool of reusable UI element objects; acquire from
 * pool when needed, release when done.
 *
 * **Expected impact:** 60-80% reduction in GC pause times, smoother animations,
 * especially during batch add/remove operations.
 */

// ==================== CONSTANTS ====================

/**
 * Default pool size for pre-allocated elements
 * Balances memory usage with pool hit rate
 */
const DEFAULT_POOL_SIZE = 75;

/**
 * Minimum pool size - pool won't shrink below this threshold
 */
const MIN_POOL_SIZE = 50;

/**
 * Maximum pool size - prevents unbounded growth
 */
const MAX_POOL_SIZE = 200;

/**
 * Growth factor when pool is exhausted
 */
const POOL_GROWTH_FACTOR = 1.5;

// ==================== POOL STATISTICS ====================

/**
 * Pool statistics for monitoring and debugging
 */
const poolStats = {
  hits: 0,
  misses: 0,
  resizes: 0,
  acquires: 0,
  releases: 0,
  currentSize: 0,
  peakSize: 0,
  created: 0
};

// ==================== POOL STORAGE ====================

/**
 * Pool of available Quick Tab item elements
 * @type {HTMLElement[]}
 */
let availableElements = [];

/**
 * Set of elements currently in use (for leak detection)
 * @type {Set<HTMLElement>}
 */
const inUseElements = new Set();

/**
 * Flag indicating if pool has been initialized
 * @type {boolean}
 */
let isInitialized = false;

// ==================== ELEMENT CREATION ====================

/**
 * Create a new Quick Tab item element with base structure
 * @private
 * @returns {HTMLElement} New Quick Tab item element
 */
function _createQuickTabElement() {
  const item = document.createElement('div');
  item.className = 'quick-tab-item';

  // Create base structure that will be reused
  const faviconContainer = document.createElement('div');
  faviconContainer.className = 'qt-favicon';

  const titleContainer = document.createElement('div');
  titleContainer.className = 'qt-title';

  const urlContainer = document.createElement('div');
  urlContainer.className = 'qt-url';

  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'qt-actions';

  // Append base structure
  item.appendChild(faviconContainer);
  item.appendChild(titleContainer);
  item.appendChild(urlContainer);
  item.appendChild(actionsContainer);

  // Mark as pooled element
  item.dataset.pooled = 'true';

  poolStats.created++;

  return item;
}

/**
 * Reset an element to its initial state for reuse
 * @private
 * @param {HTMLElement} element - Element to reset
 */
function _resetElement(element) {
  if (!element) return;

  // Reset classes to base
  element.className = 'quick-tab-item';

  // Clear all data attributes except pooled marker
  const dataAttrs = Object.keys(element.dataset);
  for (const attr of dataAttrs) {
    if (attr !== 'pooled') {
      delete element.dataset[attr];
    }
  }

  // Reset inline styles
  element.style.cssText = '';

  // Clear event listeners by cloning (removes all listeners)
  // Note: This is intentionally NOT done here as it would be expensive
  // and listeners should be managed via ManagedEventListeners utility

  // Reset child containers
  const children = element.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // Clear text content
    child.textContent = '';
    // Clear child elements
    while (child.firstChild) {
      child.removeChild(child.firstChild);
    }
    // Reset inline styles
    child.style.cssText = '';
  }

  // Remove from DOM if attached
  if (element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

// ==================== POOL MANAGEMENT ====================

/**
 * Initialize the object pool with pre-allocated elements
 * Should be called once during sidebar initialization
 * @param {number} [initialSize=DEFAULT_POOL_SIZE] - Number of elements to pre-allocate
 */
export function initializePool(initialSize = DEFAULT_POOL_SIZE) {
  if (isInitialized) {
    console.log('[QuickTabPool] Pool already initialized, skipping');
    return;
  }

  const size = Math.max(MIN_POOL_SIZE, Math.min(initialSize, MAX_POOL_SIZE));

  console.log('[QuickTabPool] POOL_INIT_START:', {
    requestedSize: initialSize,
    actualSize: size,
    timestamp: Date.now()
  });

  const startTime = performance.now();

  // Pre-allocate elements
  for (let i = 0; i < size; i++) {
    availableElements.push(_createQuickTabElement());
  }

  poolStats.currentSize = size;
  poolStats.peakSize = size;
  isInitialized = true;

  const duration = performance.now() - startTime;

  console.log('[QuickTabPool] POOL_INIT_COMPLETE:', {
    size,
    durationMs: duration.toFixed(2),
    elementsCreated: poolStats.created,
    timestamp: Date.now()
  });
}

/**
 * Acquire an element from the pool
 * @returns {HTMLElement} Quick Tab item element (from pool or newly created)
 */
export function acquire() {
  poolStats.acquires++;

  // Check if pool has available elements
  if (availableElements.length > 0) {
    poolStats.hits++;
    const element = availableElements.pop();
    inUseElements.add(element);
    poolStats.currentSize = availableElements.length;

    return element;
  }

  // Pool miss - need to create new element
  poolStats.misses++;

  console.log('[QuickTabPool] POOL_MISS:', {
    inUseCount: inUseElements.size,
    missCount: poolStats.misses,
    hitRate: _calculateHitRate(),
    timestamp: Date.now()
  });

  // Grow pool if under max size
  if (poolStats.created < MAX_POOL_SIZE) {
    _growPool();
  }

  const element = _createQuickTabElement();
  inUseElements.add(element);

  return element;
}

/**
 * Release an element back to the pool
 * @param {HTMLElement} element - Element to release
 * @returns {boolean} True if released successfully
 */
export function release(element) {
  if (!element) {
    console.warn('[QuickTabPool] Attempted to release null element');
    return false;
  }

  // Check if this element is from the pool
  if (!element.dataset?.pooled) {
    console.warn('[QuickTabPool] Attempted to release non-pooled element');
    return false;
  }

  // Check if element is actually in use
  if (!inUseElements.has(element)) {
    console.warn('[QuickTabPool] Attempted to release element not in use (double release?)');
    return false;
  }

  poolStats.releases++;

  // Reset element state
  _resetElement(element);

  // Return to pool (only if under max size)
  inUseElements.delete(element);

  if (availableElements.length < MAX_POOL_SIZE) {
    availableElements.push(element);
    poolStats.currentSize = availableElements.length;
  }

  return true;
}

/**
 * Release multiple elements back to the pool (batch operation)
 * @param {HTMLElement[]} elements - Array of elements to release
 * @returns {{ released: number, failed: number }} Release results
 */
export function releaseAll(elements) {
  if (!Array.isArray(elements)) {
    console.warn('[QuickTabPool] releaseAll expects an array');
    return { released: 0, failed: 0 };
  }

  let released = 0;
  let failed = 0;

  for (const element of elements) {
    if (release(element)) {
      released++;
    } else {
      failed++;
    }
  }

  console.log('[QuickTabPool] BATCH_RELEASE:', {
    released,
    failed,
    poolSize: availableElements.length,
    timestamp: Date.now()
  });

  return { released, failed };
}

/**
 * Grow the pool by creating additional elements
 * @private
 */
function _growPool() {
  const currentTotal = availableElements.length + inUseElements.size;
  const growthAmount = Math.ceil(currentTotal * (POOL_GROWTH_FACTOR - 1));
  const targetSize = Math.min(currentTotal + growthAmount, MAX_POOL_SIZE);
  const actualGrowth = targetSize - currentTotal;

  if (actualGrowth <= 0) {
    return;
  }

  poolStats.resizes++;

  console.log('[QuickTabPool] POOL_GROW:', {
    currentTotal,
    growthAmount: actualGrowth,
    targetSize,
    resizeCount: poolStats.resizes,
    timestamp: Date.now()
  });

  for (let i = 0; i < actualGrowth; i++) {
    availableElements.push(_createQuickTabElement());
  }

  poolStats.currentSize = availableElements.length;
  poolStats.peakSize = Math.max(poolStats.peakSize, availableElements.length + inUseElements.size);
}

/**
 * Calculate pool hit rate
 * @private
 * @returns {string} Hit rate as percentage string
 */
function _calculateHitRate() {
  const total = poolStats.hits + poolStats.misses;
  if (total === 0) return '0.00%';
  return ((poolStats.hits / total) * 100).toFixed(2) + '%';
}

// ==================== STATISTICS & DIAGNOSTICS ====================

/**
 * Get current pool statistics
 * @returns {Object} Pool statistics
 */
export function getPoolStats() {
  return {
    ...poolStats,
    available: availableElements.length,
    inUse: inUseElements.size,
    hitRate: _calculateHitRate(),
    isInitialized,
    timestamp: Date.now()
  };
}

/**
 * Log pool statistics to console
 */
export function logPoolStats() {
  const stats = getPoolStats();
  console.log('[QuickTabPool] POOL_STATS:', stats);
  return stats;
}

/**
 * Clear and reset the pool
 * Should only be used for testing or when sidebar is unloaded
 */
export function clearPool() {
  console.log('[QuickTabPool] POOL_CLEAR:', {
    availableCount: availableElements.length,
    inUseCount: inUseElements.size,
    timestamp: Date.now()
  });

  // Clear available elements
  availableElements = [];

  // Clear in-use tracking
  inUseElements.clear();

  // Reset stats except created count (for historical tracking)
  poolStats.hits = 0;
  poolStats.misses = 0;
  poolStats.resizes = 0;
  poolStats.acquires = 0;
  poolStats.releases = 0;
  poolStats.currentSize = 0;

  isInitialized = false;
}

/**
 * Shrink pool to minimum size
 * Useful for memory cleanup during low activity
 */
export function shrinkPool() {
  if (availableElements.length <= MIN_POOL_SIZE) {
    return;
  }

  const removeCount = availableElements.length - MIN_POOL_SIZE;

  console.log('[QuickTabPool] POOL_SHRINK:', {
    before: availableElements.length,
    after: MIN_POOL_SIZE,
    removing: removeCount,
    timestamp: Date.now()
  });

  // Remove excess elements from the end
  availableElements.splice(MIN_POOL_SIZE);
  poolStats.currentSize = availableElements.length;
}

/**
 * Prewarm the pool by acquiring and releasing elements
 * Useful for ensuring elements are fully rendered before use
 * @param {number} [count=10] - Number of elements to prewarm
 */
export function prewarmPool(count = 10) {
  const warmCount = Math.min(count, availableElements.length);

  console.log('[QuickTabPool] POOL_PREWARM_START:', {
    count: warmCount,
    timestamp: Date.now()
  });

  const elements = [];
  for (let i = 0; i < warmCount; i++) {
    elements.push(acquire());
  }

  // Force layout calculation
  elements.forEach(el => {
    // Temporarily add to DOM to trigger layout
    document.body.appendChild(el);
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight; // Force reflow
    document.body.removeChild(el);
  });

  // Release back to pool
  elements.forEach(el => release(el));

  console.log('[QuickTabPool] POOL_PREWARM_COMPLETE:', {
    warmedCount: warmCount,
    timestamp: Date.now()
  });
}

// ==================== EXPORTS ====================

export default {
  initializePool,
  acquire,
  release,
  releaseAll,
  getPoolStats,
  logPoolStats,
  clearPool,
  shrinkPool,
  prewarmPool
};

export {
  DEFAULT_POOL_SIZE,
  MIN_POOL_SIZE,
  MAX_POOL_SIZE
};
