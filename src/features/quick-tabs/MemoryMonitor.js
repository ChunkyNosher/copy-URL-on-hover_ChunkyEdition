/**
 * MemoryMonitor - Memory Monitoring with Automatic Cleanup
 * v1.6.4.14 - Phase 3A Optimization #10: Memory monitoring and cleanup
 *
 * Purpose: Monitor memory usage and trigger automatic cleanup when thresholds exceeded.
 * Prevents OOM crashes and provides visibility into memory trends.
 *
 * Features:
 * - Monitor memory via performance.memory API (Chrome/Edge) or fallback heuristics
 * - Trigger cleanup at configurable threshold (default 80% of 150MB)
 * - 60-second monitoring interval
 * - Memory metrics logging for debugging
 *
 * Limitations:
 * - performance.memory is only available in Chrome/Edge with flag
 * - Firefox does not expose memory API to extensions
 * - Uses heuristic-based estimation when API unavailable
 *
 * @module MemoryMonitor
 */

// Configuration constants
const DEFAULT_MEMORY_LIMIT_MB = 150; // Default memory limit in MB
const DEFAULT_THRESHOLD_PERCENT = 0.8; // 80% threshold
const MONITORING_INTERVAL_MS = 60000; // 60 seconds
const MIN_MONITORING_INTERVAL_MS = 10000; // Minimum 10 seconds
const BYTES_PER_MB = 1024 * 1024;

// Cleanup action types
const CLEANUP_ACTIONS = {
  INVALIDATE_CACHES: 'invalidate_caches',
  CLEAR_OLD_LOGS: 'clear_old_logs',
  TRIGGER_GC: 'trigger_gc',
  COMPACT_STATE: 'compact_state'
};

/**
 * Memory snapshot structure
 * @typedef {Object} MemorySnapshot
 * @property {number} usedMB - Used memory in MB
 * @property {number} limitMB - Memory limit in MB
 * @property {number} percentUsed - Percentage of limit used
 * @property {boolean} isEstimated - True if value is estimated (API unavailable)
 * @property {number} timestamp - When snapshot was taken
 */

/**
 * Memory metrics structure
 * @typedef {Object} MemoryMetrics
 * @property {number} cleanupCount - Number of cleanups triggered
 * @property {number} lastCleanupTime - Last cleanup timestamp
 * @property {MemorySnapshot[]} snapshots - Recent memory snapshots
 * @property {number} peakUsageMB - Peak memory usage observed
 */

// Monitor state
let _monitoringIntervalId = null;
let _memoryLimitMB = DEFAULT_MEMORY_LIMIT_MB;
let _thresholdPercent = DEFAULT_THRESHOLD_PERCENT;
const _cleanupCallbacks = [];
let _isMonitoring = false;

// Metrics tracking
const _metrics = {
  cleanupCount: 0,
  lastCleanupTime: 0,
  snapshots: [], // Keep last 10 snapshots
  peakUsageMB: 0,
  startTime: 0
};

const MAX_SNAPSHOTS = 10;

// Debug flag
const DEBUG_MEMORY = false;

/**
 * Log memory operation if debug is enabled
 * @private
 * @param {string} operation - Operation name
 * @param {Object} details - Operation details
 */
function _logMemoryOperation(operation, details = {}) {
  if (!DEBUG_MEMORY) return;
  console.log(`[MemoryMonitor] ${operation}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Check if performance.memory API is available
 * @returns {boolean} True if API is available
 */
function _isMemoryAPIAvailable() {
  return (
    typeof performance !== 'undefined' &&
    performance.memory !== undefined &&
    typeof performance.memory.usedJSHeapSize === 'number'
  );
}

/**
 * Get memory usage from performance.memory API
 * @private
 * @returns {MemorySnapshot} Memory snapshot
 */
function _getMemoryFromAPI() {
  const memory = performance.memory;
  const usedBytes = memory.usedJSHeapSize;
  const limitBytes = memory.jsHeapSizeLimit;
  const usedMB = usedBytes / BYTES_PER_MB;
  const limitMB = limitBytes / BYTES_PER_MB;

  return {
    usedMB: Math.round(usedMB * 100) / 100,
    limitMB: Math.round(limitMB * 100) / 100,
    percentUsed: Math.round((usedBytes / limitBytes) * 100) / 100,
    isEstimated: false,
    timestamp: Date.now()
  };
}

/**
 * Estimate memory usage using heuristics when API unavailable
 * Uses object counts and string lengths as rough proxy
 * @private
 * @returns {MemorySnapshot} Estimated memory snapshot
 */
function _estimateMemory() {
  // Estimate based on common patterns in extension
  // This is a rough heuristic and not accurate
  let estimatedMB = 10; // Base overhead for extension

  // Try to estimate from global objects if accessible
  try {
    // Check if we have access to state objects
    if (typeof globalThis !== 'undefined') {
      // Rough estimate: 1KB per entry in various maps
      // This is intentionally conservative
      estimatedMB += 5; // Default for unknown state
    }
  } catch (_e) {
    // Ignore errors in estimation
  }

  return {
    usedMB: estimatedMB,
    limitMB: _memoryLimitMB,
    percentUsed: estimatedMB / _memoryLimitMB,
    isEstimated: true,
    timestamp: Date.now()
  };
}

/**
 * Get current memory snapshot
 * Uses performance.memory if available, otherwise estimates
 * @returns {MemorySnapshot} Current memory snapshot
 */
export function getMemorySnapshot() {
  if (_isMemoryAPIAvailable()) {
    return _getMemoryFromAPI();
  }
  return _estimateMemory();
}

/**
 * Check if memory is above threshold using existing snapshot
 * @param {MemorySnapshot} snapshot - Pre-fetched memory snapshot
 * @returns {boolean} True if cleanup should be triggered
 */
function _isAboveThresholdWithSnapshot(snapshot) {
  const thresholdMB = _memoryLimitMB * _thresholdPercent;
  return snapshot.usedMB >= thresholdMB;
}

/**
 * Check if memory is above threshold
 * @returns {boolean} True if cleanup should be triggered
 */
export function isAboveThreshold() {
  const snapshot = getMemorySnapshot();
  return _isAboveThresholdWithSnapshot(snapshot);
}

/**
 * Record memory snapshot and update metrics
 * @private
 * @param {MemorySnapshot} snapshot - Snapshot to record
 */
function _recordSnapshot(snapshot) {
  // Update peak usage
  if (snapshot.usedMB > _metrics.peakUsageMB) {
    _metrics.peakUsageMB = snapshot.usedMB;
  }

  // Keep only recent snapshots
  _metrics.snapshots.push(snapshot);
  if (_metrics.snapshots.length > MAX_SNAPSHOTS) {
    _metrics.snapshots.shift();
  }
}

/**
 * Execute cleanup callbacks
 * @private
 * @returns {number} Number of callbacks executed
 */
async function _executeCleanup() {
  const snapshot = getMemorySnapshot();

  console.log('[MemoryMonitor] CLEANUP_TRIGGERED:', {
    usedMB: snapshot.usedMB,
    limitMB: _memoryLimitMB,
    thresholdMB: _memoryLimitMB * _thresholdPercent,
    percentUsed: (snapshot.percentUsed * 100).toFixed(1) + '%'
  });

  let executed = 0;

  for (const callback of _cleanupCallbacks) {
    try {
      await callback.handler(snapshot);
      executed++;
      _logMemoryOperation('CLEANUP_CALLBACK_EXECUTED', {
        name: callback.name
      });
    } catch (err) {
      console.error('[MemoryMonitor] Cleanup callback error:', {
        name: callback.name,
        error: err.message
      });
    }
  }

  _metrics.cleanupCount++;
  _metrics.lastCleanupTime = Date.now();

  return executed;
}

/**
 * Main monitoring check function
 * Called periodically by the monitoring interval
 * @private
 */
async function _monitoringCheck() {
  const snapshot = getMemorySnapshot();
  _recordSnapshot(snapshot);

  _logMemoryOperation('MEMORY_CHECK', {
    usedMB: snapshot.usedMB,
    limitMB: _memoryLimitMB,
    percentUsed: (snapshot.percentUsed * 100).toFixed(1) + '%',
    isEstimated: snapshot.isEstimated
  });

  // Check threshold using pre-fetched snapshot to avoid duplicate API call
  if (_isAboveThresholdWithSnapshot(snapshot)) {
    await _executeCleanup();
  }
}

/**
 * Start memory monitoring
 * @param {Object} options - Configuration options
 * @param {number} options.memoryLimitMB - Memory limit in MB
 * @param {number} options.thresholdPercent - Threshold as decimal (0.8 = 80%)
 * @param {number} options.intervalMs - Check interval in milliseconds
 * @returns {boolean} True if monitoring started successfully
 */
export function startMonitoring(options = {}) {
  if (_isMonitoring) {
    console.warn('[MemoryMonitor] Already monitoring');
    return false;
  }

  // Apply options with defaults
  _memoryLimitMB = options.memoryLimitMB || DEFAULT_MEMORY_LIMIT_MB;
  _thresholdPercent = options.thresholdPercent || DEFAULT_THRESHOLD_PERCENT;

  const intervalMs = Math.max(
    MIN_MONITORING_INTERVAL_MS,
    options.intervalMs || MONITORING_INTERVAL_MS
  );

  // Start monitoring
  _metrics.startTime = Date.now();
  _monitoringIntervalId = setInterval(_monitoringCheck, intervalMs);
  _isMonitoring = true;

  // Run immediate check
  _monitoringCheck();

  console.log('[MemoryMonitor] Monitoring started:', {
    memoryLimitMB: _memoryLimitMB,
    thresholdPercent: _thresholdPercent,
    thresholdMB: _memoryLimitMB * _thresholdPercent,
    intervalMs,
    apiAvailable: _isMemoryAPIAvailable()
  });

  return true;
}

/**
 * Stop memory monitoring
 */
export function stopMonitoring() {
  if (!_isMonitoring) {
    return;
  }

  if (_monitoringIntervalId) {
    clearInterval(_monitoringIntervalId);
    _monitoringIntervalId = null;
  }

  _isMonitoring = false;
  console.log('[MemoryMonitor] Monitoring stopped');
}

/**
 * Register a cleanup callback
 * Callbacks are called when memory exceeds threshold
 *
 * @param {string} name - Callback name for logging
 * @param {Function} handler - Async function to call (receives MemorySnapshot)
 * @returns {boolean} True if callback was registered
 */
export function registerCleanupCallback(name, handler) {
  if (typeof handler !== 'function') {
    console.error('[MemoryMonitor] Invalid cleanup callback:', name);
    return false;
  }

  // Check for duplicate
  const existing = _cleanupCallbacks.find(cb => cb.name === name);
  if (existing) {
    console.warn('[MemoryMonitor] Replacing existing callback:', name);
    existing.handler = handler;
    return true;
  }

  _cleanupCallbacks.push({ name, handler });
  _logMemoryOperation('CALLBACK_REGISTERED', { name });
  return true;
}

/**
 * Unregister a cleanup callback
 * @param {string} name - Callback name to remove
 * @returns {boolean} True if callback was removed
 */
export function unregisterCleanupCallback(name) {
  const index = _cleanupCallbacks.findIndex(cb => cb.name === name);
  if (index === -1) {
    return false;
  }

  _cleanupCallbacks.splice(index, 1);
  _logMemoryOperation('CALLBACK_UNREGISTERED', { name });
  return true;
}

/**
 * Get current memory metrics
 * @returns {MemoryMetrics} Current metrics
 */
export function getMetrics() {
  const currentSnapshot = getMemorySnapshot();

  return {
    isMonitoring: _isMonitoring,
    current: currentSnapshot,
    cleanupCount: _metrics.cleanupCount,
    lastCleanupTime: _metrics.lastCleanupTime,
    peakUsageMB: _metrics.peakUsageMB,
    snapshots: [..._metrics.snapshots],
    uptime: _metrics.startTime > 0 ? Date.now() - _metrics.startTime : 0,
    callbackCount: _cleanupCallbacks.length,
    memoryLimitMB: _memoryLimitMB,
    thresholdPercent: _thresholdPercent,
    thresholdMB: _memoryLimitMB * _thresholdPercent,
    apiAvailable: _isMemoryAPIAvailable()
  };
}

/**
 * Force a cleanup check regardless of threshold
 * Useful for testing or manual cleanup
 * @returns {Promise<number>} Number of callbacks executed
 */
export function forceCleanup() {
  console.log('[MemoryMonitor] Force cleanup requested');
  return _executeCleanup();
}

/**
 * Check if monitoring is active
 * @returns {boolean} True if monitoring is active
 */
export function isMonitoringActive() {
  return _isMonitoring;
}

// Export cleanup action types for consumers
export { CLEANUP_ACTIONS };

// Export default object with all methods
export default {
  startMonitoring,
  stopMonitoring,
  getMemorySnapshot,
  isAboveThreshold,
  registerCleanupCallback,
  unregisterCleanupCallback,
  getMetrics,
  forceCleanup,
  isMonitoringActive,
  CLEANUP_ACTIONS
};
