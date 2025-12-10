/**
 * StorageCache - Hybrid Storage Strategy with Read-Through Caching
 * v1.6.4.14 - Phase 3A Optimization #1: Read-through cache for Quick Tab state
 *
 * Purpose: Reduce storage operation latency by 40-60% through intelligent caching.
 * Storage remains source-of-truth, but repeated reads are served from in-memory cache.
 *
 * Features:
 * - TTL-based expiration (default 30 seconds)
 * - Automatic cache invalidation on write operations
 * - Graceful degradation if cache becomes corrupted
 * - Hit/miss metrics tracking for optimization decisions
 *
 * Architecture:
 * - browser.storage.local is source-of-truth
 * - Cache is a performance optimization only
 * - Cache is invalidated on any write operation
 * - Falls back to storage on cache miss or corruption
 *
 * @module StorageCache
 */

// Cache configuration constants
const DEFAULT_TTL_MS = 30000; // 30 seconds default TTL
const MAX_TTL_MS = 45000; // Maximum TTL (45 seconds)
const MIN_TTL_MS = 5000; // Minimum TTL (5 seconds)

// Storage key for Quick Tab state
const STATE_KEY = 'quick_tabs_state_v2';

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {Object} data - Cached data
 * @property {number} timestamp - When the entry was cached
 * @property {number} ttl - Time-to-live in milliseconds
 * @property {string} saveId - Save ID for version tracking
 */

/**
 * Cache metrics structure
 * @typedef {Object} CacheMetrics
 * @property {number} hits - Number of cache hits
 * @property {number} misses - Number of cache misses
 * @property {number} invalidations - Number of cache invalidations
 * @property {number} errors - Number of cache errors
 */

// In-memory cache state
let _cache = null;
let _cacheTimestamp = 0;
let _cacheTtl = DEFAULT_TTL_MS;
let _cacheSaveId = '';

// Metrics tracking
const _metrics = {
  hits: 0,
  misses: 0,
  invalidations: 0,
  errors: 0,
  lastResetTime: Date.now()
};

// Debug flag
const DEBUG_CACHE = false;

/**
 * Log cache operation if debug is enabled
 * @private
 * @param {string} operation - Operation name
 * @param {Object} details - Operation details
 */
function _logCacheOperation(operation, details = {}) {
  if (!DEBUG_CACHE) return;
  console.log(`[StorageCache] ${operation}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Check if cache entry has expired
 * @private
 * @returns {boolean} True if cache is expired or invalid
 */
function _isCacheExpired() {
  if (_cache === null) return true;
  if (_cacheTimestamp === 0) return true;

  const age = Date.now() - _cacheTimestamp;
  return age > _cacheTtl;
}

/**
 * Validate cache data integrity
 * @private
 * @param {Object} data - Data to validate
 * @returns {boolean} True if data appears valid
 */
function _validateCacheData(data) {
  if (!data) return false;
  if (typeof data !== 'object') return false;

  // Check for expected state structure
  if (data.tabs !== undefined && !Array.isArray(data.tabs)) {
    return false;
  }

  return true;
}

/**
 * Set cache TTL with bounds checking
 * @param {number} ttlMs - TTL in milliseconds
 * @returns {number} Actual TTL set (bounded)
 */
export function setTTL(ttlMs) {
  const boundedTtl = Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, ttlMs));
  _cacheTtl = boundedTtl;

  _logCacheOperation('TTL_SET', {
    requested: ttlMs,
    actual: boundedTtl
  });

  return boundedTtl;
}

/**
 * Get current TTL setting
 * @returns {number} Current TTL in milliseconds
 */
export function getTTL() {
  return _cacheTtl;
}

/**
 * Invalidate the cache
 * Call this after any write operation to storage
 * @param {string} reason - Reason for invalidation (for logging)
 */
export function invalidateCache(reason = 'manual') {
  const hadCache = _cache !== null;

  _cache = null;
  _cacheTimestamp = 0;
  _cacheSaveId = '';
  _metrics.invalidations++;

  _logCacheOperation('CACHE_INVALIDATED', {
    reason,
    hadCache,
    totalInvalidations: _metrics.invalidations
  });
}

/**
 * Update cache with new data
 * @param {Object} data - Data to cache
 * @param {string} saveId - Save ID for version tracking
 */
export function updateCache(data, saveId = '') {
  if (!_validateCacheData(data)) {
    _logCacheOperation('CACHE_UPDATE_REJECTED', {
      reason: 'validation_failed'
    });
    _metrics.errors++;
    return;
  }

  _cache = data;
  _cacheTimestamp = Date.now();
  _cacheSaveId = saveId;

  _logCacheOperation('CACHE_UPDATED', {
    tabCount: data.tabs?.length || 0,
    saveId,
    ttl: _cacheTtl
  });
}

/**
 * Get data from cache if valid
 * @returns {{ hit: boolean, data: Object|null, saveId: string }} Cache result
 */
export function getFromCache() {
  // Check if cache is expired
  if (_isCacheExpired()) {
    _metrics.misses++;
    _logCacheOperation('CACHE_MISS', {
      reason: 'expired_or_empty',
      age: _cacheTimestamp > 0 ? Date.now() - _cacheTimestamp : 0,
      ttl: _cacheTtl
    });
    return { hit: false, data: null, saveId: '' };
  }

  // Validate cached data
  if (!_validateCacheData(_cache)) {
    _metrics.misses++;
    _metrics.errors++;
    invalidateCache('validation_failed');
    _logCacheOperation('CACHE_MISS', {
      reason: 'validation_failed'
    });
    return { hit: false, data: null, saveId: '' };
  }

  // Cache hit!
  _metrics.hits++;
  _logCacheOperation('CACHE_HIT', {
    tabCount: _cache.tabs?.length || 0,
    saveId: _cacheSaveId,
    age: Date.now() - _cacheTimestamp
  });

  return {
    hit: true,
    data: _cache,
    saveId: _cacheSaveId
  };
}

/**
 * Read Quick Tab state with cache support (read-through pattern)
 * Checks cache first, falls back to storage on miss
 *
 * @returns {Promise<Object>} State object with tabs array
 */
export async function readStateWithCache() {
  // Try cache first
  const cacheResult = getFromCache();
  if (cacheResult.hit) {
    _logCacheOperation('READ_FROM_CACHE', {
      tabCount: cacheResult.data?.tabs?.length || 0
    });
    return cacheResult.data;
  }

  // Cache miss - read from storage
  _logCacheOperation('READ_FROM_STORAGE', {
    reason: 'cache_miss'
  });

  try {
    const result = await browser.storage.local.get(STATE_KEY);
    const state = result?.[STATE_KEY] || { tabs: [], saveId: '', timestamp: 0 };

    // Update cache with fresh data
    updateCache(state, state.saveId || '');

    return state;
  } catch (err) {
    _metrics.errors++;
    console.error('[StorageCache] Storage read error:', {
      operation: 'readStateWithCache',
      message: err.message,
      stack: err.stack
    });

    // Return empty state on error
    return { tabs: [], saveId: '', timestamp: 0 };
  }
}

/**
 * Write state to storage and invalidate cache
 * Always writes through to storage (cache is not a write-back cache)
 *
 * @param {Object} state - State to write
 * @returns {Promise<boolean>} True if write succeeded
 */
export async function writeStateAndInvalidate(state) {
  // Invalidate cache before write (prevents stale reads)
  invalidateCache('pre-write');

  try {
    await browser.storage.local.set({ [STATE_KEY]: state });

    // Update cache with new state after successful write
    updateCache(state, state.saveId || '');

    _logCacheOperation('WRITE_SUCCESS', {
      tabCount: state.tabs?.length || 0,
      saveId: state.saveId
    });

    return true;
  } catch (err) {
    _metrics.errors++;
    console.error('[StorageCache] Storage write error:', {
      operation: 'writeStateAndInvalidate',
      message: err.message,
      tabCount: state?.tabs?.length || 0,
      stack: err.stack
    });
    return false;
  }
}

/**
 * Get cache metrics for monitoring
 * @returns {CacheMetrics} Current metrics
 */
export function getMetrics() {
  const total = _metrics.hits + _metrics.misses;
  const hitRate = total > 0 ? (_metrics.hits / total) * 100 : 0;

  return {
    hits: _metrics.hits,
    misses: _metrics.misses,
    invalidations: _metrics.invalidations,
    errors: _metrics.errors,
    hitRate: hitRate.toFixed(2) + '%',
    total,
    uptime: Date.now() - _metrics.lastResetTime
  };
}

/**
 * Reset cache metrics
 * Useful for testing or periodic metric collection
 */
export function resetMetrics() {
  _metrics.hits = 0;
  _metrics.misses = 0;
  _metrics.invalidations = 0;
  _metrics.errors = 0;
  _metrics.lastResetTime = Date.now();

  _logCacheOperation('METRICS_RESET', {});
}

/**
 * Get cache status for debugging
 * @returns {Object} Cache status information
 */
export function getCacheStatus() {
  return {
    hasCache: _cache !== null,
    cacheAge: _cacheTimestamp > 0 ? Date.now() - _cacheTimestamp : 0,
    ttl: _cacheTtl,
    isExpired: _isCacheExpired(),
    saveId: _cacheSaveId,
    tabCount: _cache?.tabs?.length || 0,
    metrics: getMetrics()
  };
}

/**
 * Clear cache completely (for testing or reset)
 */
export function clearCache() {
  invalidateCache('clear_requested');
  resetMetrics();
  _logCacheOperation('CACHE_CLEARED', {});
}

// Export default object with all methods
export default {
  setTTL,
  getTTL,
  invalidateCache,
  updateCache,
  getFromCache,
  readStateWithCache,
  writeStateAndInvalidate,
  getMetrics,
  resetMetrics,
  getCacheStatus,
  clearCache
};
