/**
 * @fileoverview LRUMapGuard - Memory management for Quick Tabs Map
 * v1.6.3.10-v11 - FIX Issue #21: Implement LRU eviction and map size monitoring
 *
 * This utility wraps a Map to provide:
 * 1. Maximum size enforcement with configurable threshold
 * 2. LRU (Least Recently Used) eviction when threshold exceeded
 * 3. Access time tracking for each entry
 * 4. Stale entry cleanup based on configurable age
 * 5. Periodic cleanup via page visibility change or timer
 * 6. Memory usage logging and monitoring
 *
 * @version 1.6.3.10-v11
 */

// ==================== CONSTANTS ====================

/**
 * Maximum number of entries in the Map before LRU eviction kicks in
 * v1.6.3.10-v11 - FIX Issue #21: Configurable map size limit
 */
const MAX_MAP_SIZE = 500;

/**
 * Percentage of entries to evict when threshold exceeded (as decimal)
 * E.g., 0.10 = 10% of entries evicted when map is 110% full
 * v1.6.3.10-v11 - FIX Issue #21
 */
const EVICTION_PERCENT = 0.10;

/**
 * Threshold multiplier for triggering eviction
 * E.g., 1.10 = evict when map is 110% of MAX_MAP_SIZE
 * v1.6.3.10-v11 - FIX Issue #21
 */
const EVICTION_TRIGGER_MULTIPLIER = 1.10;

/**
 * Maximum age for stale entries in milliseconds (24 hours)
 * Entries not accessed within this time are eligible for cleanup
 * v1.6.3.10-v11 - FIX Issue #21
 */
const STALE_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Interval for periodic cleanup in milliseconds (30 seconds)
 * v1.6.3.10-v11 - FIX Issue #21
 */
const CLEANUP_INTERVAL_MS = 30 * 1000;

/**
 * Log prefix for all LRUMapGuard logging
 */
const LOG_PREFIX = '[LRUMapGuard]';

// ==================== LRUMapGuard CLASS ====================

/**
 * LRUMapGuard - Manages Map size with LRU eviction policy
 *
 * Usage:
 * ```javascript
 * const guard = new LRUMapGuard(myMap, {
 *   maxSize: 500,
 *   evictionPercent: 0.10,
 *   staleAgeMs: 24 * 60 * 60 * 1000
 * });
 * guard.startPeriodicCleanup();
 *
 * // Track access when getting entries
 * guard.trackAccess('qt-123');
 *
 * // Check and evict after operations
 * guard.checkAndEvict();
 *
 * // Cleanup when done
 * guard.destroy();
 * ```
 */
export class LRUMapGuard {
  /**
   * @param {Map} targetMap - The Map to guard (e.g., quickTabsMap / tabs)
   * @param {Object} options - Configuration options
   * @param {number} [options.maxSize=500] - Maximum entries before eviction
   * @param {number} [options.evictionPercent=0.10] - Percent to evict (0.10 = 10%)
   * @param {number} [options.staleAgeMs=86400000] - Max age for stale entries (24h)
   * @param {number} [options.cleanupIntervalMs=30000] - Cleanup interval (30s)
   * @param {string} [options.logPrefix='[LRUMapGuard]'] - Prefix for log messages
   */
  constructor(targetMap, options = {}) {
    this._targetMap = targetMap;
    this._maxSize = options.maxSize ?? MAX_MAP_SIZE;
    this._evictionPercent = options.evictionPercent ?? EVICTION_PERCENT;
    this._staleAgeMs = options.staleAgeMs ?? STALE_ENTRY_AGE_MS;
    this._cleanupIntervalMs = options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS;
    this._logPrefix = options.logPrefix ?? LOG_PREFIX;

    // Track last access time for each key: Map<key, timestamp>
    this._accessTimes = new Map();

    // Cleanup timer and visibility handler
    this._cleanupTimerId = null;
    this._visibilityHandler = null;
    this._cleanupOptions = {}; // v1.6.3.10-v11 - Store cleanup options for periodic callbacks
    this._isDestroyed = false;
  }

  // ==================== CORE OPERATIONS ====================

  /**
   * Track access time for an entry
   * Call this when getting or using an entry to update its LRU status
   *
   * @param {string} key - Entry key to track
   */
  trackAccess(key) {
    if (this._isDestroyed) return;
    this._accessTimes.set(key, Date.now());
  }

  /**
   * Record creation time for a new entry
   * Same as trackAccess but with semantic naming for creation
   *
   * @param {string} key - Entry key that was just created
   */
  recordCreation(key) {
    this.trackAccess(key);
  }

  /**
   * Remove tracking for a deleted entry
   *
   * @param {string} key - Entry key that was deleted
   */
  recordDeletion(key) {
    if (this._isDestroyed) return;
    this._accessTimes.delete(key);
  }

  /**
   * Check map size and perform LRU eviction if needed
   * Call this after operations that may increase map size
   *
   * @returns {{ evicted: boolean, evictedCount: number, evictedIds: string[] }}
   */
  checkAndEvict() {
    if (this._isDestroyed) {
      return { evicted: false, evictedCount: 0, evictedIds: [] };
    }

    const currentSize = this._targetMap.size;
    const triggerThreshold = Math.floor(this._maxSize * EVICTION_TRIGGER_MULTIPLIER);

    // Only evict if we're above the trigger threshold
    if (currentSize < triggerThreshold) {
      return { evicted: false, evictedCount: 0, evictedIds: [] };
    }

    // Calculate how many to evict (10% of max size)
    const evictCount = Math.ceil(this._maxSize * this._evictionPercent);
    const evictedIds = this._performLRUEviction(evictCount);

    console.log(
      `${this._logPrefix} Evicting LRU entries: ${evictedIds.join(', ')} (map size: ${currentSize}→${this._targetMap.size})`
    );

    return {
      evicted: evictedIds.length > 0,
      evictedCount: evictedIds.length,
      evictedIds
    };
  }

  /**
   * Perform LRU eviction of the specified number of entries
   *
   * @private
   * @param {number} count - Number of entries to evict
   * @returns {string[]} IDs of evicted entries
   */
  _performLRUEviction(count) {
    const evictedIds = [];

    // Get all entries sorted by access time (oldest first)
    const sortedEntries = this._getSortedEntriesByAccessTime();

    // Evict the oldest entries
    for (let i = 0; i < count && i < sortedEntries.length; i++) {
      const key = sortedEntries[i].key;
      
      // Get entry data for logging before removal
      const entry = this._targetMap.get(key);
      const entryInfo = this._getEntryInfo(key, entry);

      // Delete from target map
      if (this._targetMap.delete(key)) {
        this._accessTimes.delete(key);
        evictedIds.push(key);

        console.log(`${this._logPrefix} Evicted entry: ${key}`, entryInfo);
      }
    }

    return evictedIds;
  }

  /**
   * Get entry info for logging
   *
   * @private
   * @param {string} key - Entry key
   * @param {Object} entry - Entry value
   * @returns {Object} Info object for logging
   */
  _getEntryInfo(key, entry) {
    const accessTime = this._accessTimes.get(key);
    const ageMs = accessTime ? Date.now() - accessTime : null;
    const ageHours = ageMs ? (ageMs / (1000 * 60 * 60)).toFixed(2) : 'unknown';

    return {
      lastAccessedHoursAgo: ageHours,
      hasEntry: !!entry,
      minimized: entry?.minimized ?? 'unknown'
    };
  }

  /**
   * Get all map entries sorted by access time (oldest first)
   *
   * @private
   * @returns {Array<{key: string, accessTime: number}>}
   */
  _getSortedEntriesByAccessTime() {
    const entries = [];

    for (const key of this._targetMap.keys()) {
      // Use access time if tracked, otherwise treat as very old (epoch 0)
      const accessTime = this._accessTimes.get(key) ?? 0;
      entries.push({ key, accessTime });
    }

    // Sort by access time ascending (oldest first)
    entries.sort((a, b) => a.accessTime - b.accessTime);

    return entries;
  }

  // ==================== STALE ENTRY CLEANUP ====================

  /**
   * Check if an entry should be cleaned up
   * v1.6.3.10-v11 - FIX Issue #21: Extracted to reduce cleanupStaleEntries complexity
   * @private
   * @param {string} key - Entry key
   * @param {Object} entry - Entry value
   * @param {number} now - Current timestamp
   * @param {Function|null} isClosedChecker - Optional function to check if entry is closed
   * @returns {{ shouldClean: boolean, reason: string }}
   */
  _shouldCleanupEntry(key, entry, now, isClosedChecker) {
    const accessTime = this._accessTimes.get(key) ?? 0;
    const ageMs = now - accessTime;
    const isStale = ageMs > this._staleAgeMs;
    const isClosed = isClosedChecker ? isClosedChecker(key, entry) : false;

    if (isClosed) {
      return { shouldClean: true, reason: 'closed' };
    }
    if (isStale) {
      const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);
      return { shouldClean: true, reason: `not accessed for ${ageHours} hours` };
    }
    return { shouldClean: false, reason: '' };
  }

  /**
   * Delete entry and log eviction
   * v1.6.3.10-v11 - FIX Issue #21: Extracted to reduce cleanupStaleEntries complexity
   * @private
   * @param {string} key - Entry key to delete
   * @param {string} reason - Reason for eviction (for logging)
   * @returns {boolean} True if entry was deleted
   */
  _deleteAndLogEntry(key, reason) {
    if (!this._targetMap.delete(key)) {
      return false;
    }
    this._accessTimes.delete(key);
    console.log(`${this._logPrefix} Evicted entry from map: ${key} (${reason})`);
    return true;
  }

  /**
   * Perform cleanup of stale entries that haven't been accessed recently
   * Also cleans up entries for closed Quick Tabs (minimizeState === 'closed')
   * v1.6.3.10-v11 - FIX Issue #21: Refactored to reduce complexity (cc=10→6)
   *
   * @param {Object} options - Cleanup options
   * @param {Function} [options.isClosedChecker] - Function to check if entry is closed: (key, entry) => boolean
   * @returns {{ cleaned: number, cleanedIds: string[] }}
   */
  cleanupStaleEntries(options = {}) {
    if (this._isDestroyed) {
      return { cleaned: 0, cleanedIds: [] };
    }

    const now = Date.now();
    const cleanedIds = [];
    const { isClosedChecker } = options;

    for (const [key, entry] of this._targetMap) {
      const { shouldClean, reason } = this._shouldCleanupEntry(key, entry, now, isClosedChecker);
      if (shouldClean && this._deleteAndLogEntry(key, reason)) {
        cleanedIds.push(key);
      }
    }

    if (cleanedIds.length > 0) {
      console.log(`${this._logPrefix} Cleanup complete:`, {
        cleanedCount: cleanedIds.length,
        remainingSize: this._targetMap.size
      });
    }

    return { cleaned: cleanedIds.length, cleanedIds };
  }

  // ==================== PERIODIC CLEANUP ====================

  /**
   * Start periodic cleanup on a timer and visibility change
   *
   * @param {Object} options - Options for periodic cleanup
   * @param {Function} [options.isClosedChecker] - Function to check if entry is closed
   */
  startPeriodicCleanup(options = {}) {
    if (this._isDestroyed) return;

    // v1.6.3.10-v11 - FIX Code Review: Store options as instance variable to avoid stale closure
    this._cleanupOptions = options;

    // Setup interval timer
    if (!this._cleanupTimerId) {
      this._cleanupTimerId = setInterval(() => {
        this.cleanupStaleEntries(this._cleanupOptions);
        this.checkAndEvict();
      }, this._cleanupIntervalMs);

      console.log(
        `${this._logPrefix} Started periodic cleanup (interval: ${this._cleanupIntervalMs}ms)`
      );
    }

    // Setup visibility change handler
    if (!this._visibilityHandler && typeof document !== 'undefined') {
      this._visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          // Clean up when page becomes visible
          this.cleanupStaleEntries(this._cleanupOptions);
          this.checkAndEvict();
        }
      };

      document.addEventListener('visibilitychange', this._visibilityHandler);
      console.log(`${this._logPrefix} Registered visibility change handler`);
    }
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this._cleanupTimerId) {
      clearInterval(this._cleanupTimerId);
      this._cleanupTimerId = null;
      console.log(`${this._logPrefix} Stopped periodic cleanup timer`);
    }

    if (this._visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
      console.log(`${this._logPrefix} Removed visibility change handler`);
    }
  }

  // ==================== MONITORING & LOGGING ====================

  /**
   * Get current map statistics
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    const size = this._targetMap.size;
    const trackedCount = this._accessTimes.size;
    const now = Date.now();

    // Calculate average age of tracked entries
    let totalAgeMs = 0;
    let oldestAgeMs = 0;
    let newestAgeMs = Infinity;

    for (const accessTime of this._accessTimes.values()) {
      const ageMs = now - accessTime;
      totalAgeMs += ageMs;
      if (ageMs > oldestAgeMs) oldestAgeMs = ageMs;
      if (ageMs < newestAgeMs) newestAgeMs = ageMs;
    }

    const avgAgeMs = trackedCount > 0 ? totalAgeMs / trackedCount : 0;

    return {
      size,
      maxSize: this._maxSize,
      trackedCount,
      percentFull: ((size / this._maxSize) * 100).toFixed(1),
      avgAgeHours: (avgAgeMs / (1000 * 60 * 60)).toFixed(2),
      oldestAgeHours: (oldestAgeMs / (1000 * 60 * 60)).toFixed(2),
      newestAgeHours: newestAgeMs === Infinity ? 'N/A' : (newestAgeMs / (1000 * 60 * 60)).toFixed(2)
    };
  }

  /**
   * Log current map size and statistics
   */
  logStats() {
    const stats = this.getStats();
    console.log(`${this._logPrefix} Map stats:`, {
      size: `${stats.size} entries`,
      maxSize: stats.maxSize,
      percentFull: `${stats.percentFull}%`,
      avgAge: `${stats.avgAgeHours} hours`,
      oldestAge: `${stats.oldestAgeHours} hours`
    });
  }

  /**
   * Estimate memory usage of the map (rough approximation)
   * Note: This is a rough estimate, actual memory usage may vary
   *
   * @returns {number} Estimated bytes
   */
  estimateMemoryBytes() {
    const entryCount = this._targetMap.size;
    // Rough estimate: each entry ~500 bytes (key + QuickTabWindow instance overhead)
    const estimatedBytesPerEntry = 500;
    return entryCount * estimatedBytesPerEntry;
  }

  // ==================== LIFECYCLE ====================

  /**
   * Cleanup and destroy the guard
   * Call this when the QuickTabsManager is destroyed
   */
  destroy() {
    if (this._isDestroyed) return;

    this._isDestroyed = true;
    this.stopPeriodicCleanup();
    this._accessTimes.clear();

    console.log(`${this._logPrefix} Destroyed`);
  }
}

// ==================== EXPORTS ====================

export {
  MAX_MAP_SIZE,
  EVICTION_PERCENT,
  STALE_ENTRY_AGE_MS,
  CLEANUP_INTERVAL_MS
};
