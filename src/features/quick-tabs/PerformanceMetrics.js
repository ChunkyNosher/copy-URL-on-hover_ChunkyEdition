/**
 * PerformanceMetrics - Performance Metrics Collection
 * v1.6.4.14 - Phase 3A Optimization #12: Performance metrics collection
 *
 * Purpose: Provide visibility into actual performance bottlenecks.
 * Enables data-driven optimization decisions and regression detection.
 *
 * Features:
 * - Instrument hot paths with timing code
 * - Collect metrics by operation type
 * - Calculate percentiles (p50, p95, p99)
 * - Automatic metric flushing every minute
 * - Export metrics for analysis
 *
 * Usage:
 * ```javascript
 * import { startTiming, endTiming, getMetricsSummary } from './PerformanceMetrics.js';
 *
 * const timerId = startTiming('storage-read');
 * // ... do work ...
 * endTiming(timerId);
 *
 * // Later: get summary
 * const summary = getMetricsSummary();
 * console.log('p95 storage-read:', summary['storage-read'].p95);
 * ```
 *
 * @module PerformanceMetrics
 */

// Configuration constants
const FLUSH_INTERVAL_MS = 60000; // 1 minute
const MAX_SAMPLES_PER_OPERATION = 1000; // Keep last 1000 samples
const MIN_SAMPLES_FOR_PERCENTILE = 3; // Need at least 3 samples for percentiles

// Percentiles to calculate (exported for reference)
const _PERCENTILES = [50, 95, 99];

/**
 * Operation timing structure
 * @typedef {Object} OperationTiming
 * @property {string} operation - Operation name
 * @property {number} duration - Duration in milliseconds
 * @property {number} timestamp - When operation completed
 */

/**
 * Metrics summary for an operation
 * @typedef {Object} MetricsSummary
 * @property {number} count - Total number of operations
 * @property {number} min - Minimum duration (ms)
 * @property {number} max - Maximum duration (ms)
 * @property {number} avg - Average duration (ms)
 * @property {number} p50 - 50th percentile (ms)
 * @property {number} p95 - 95th percentile (ms)
 * @property {number} p99 - 99th percentile (ms)
 * @property {number} lastTimestamp - Most recent operation timestamp
 */

// State
const _samples = new Map(); // operation -> number[]
const _pendingTimers = new Map(); // timerId -> { operation, startTime }
let _timerIdCounter = 0;
let _flushIntervalId = null;
let _isCollecting = false;
let _lastFlushTime = 0;

// Debug flag
const DEBUG_METRICS = false;

/**
 * Log metrics operation if debug is enabled
 * @private
 * @param {string} operation - Operation name
 * @param {Object} details - Operation details
 */
function _logMetricsOperation(operation, details = {}) {
  if (!DEBUG_METRICS) return;
  console.log(`[PerformanceMetrics] ${operation}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Generate unique timer ID
 * @private
 * @returns {string} Unique timer ID
 */
function _generateTimerId() {
  _timerIdCounter++;
  return `timer-${Date.now()}-${_timerIdCounter}`;
}

/**
 * Get or create sample array for operation
 * @private
 * @param {string} operation - Operation name
 * @returns {number[]} Sample array
 */
function _getSamples(operation) {
  if (!_samples.has(operation)) {
    _samples.set(operation, []);
  }
  return _samples.get(operation);
}

/**
 * Add sample to operation and trim if necessary
 * @private
 * @param {string} operation - Operation name
 * @param {number} duration - Duration in milliseconds
 */
function _addSample(operation, duration) {
  const samples = _getSamples(operation);
  samples.push(duration);

  // Trim to max samples
  if (samples.length > MAX_SAMPLES_PER_OPERATION) {
    samples.shift();
  }
}

/**
 * Calculate percentile from sorted array
 * @private
 * @param {number[]} sortedArr - Sorted array of numbers
 * @param {number} percentile - Percentile to calculate (0-100)
 * @returns {number} Percentile value
 */
function _calculatePercentile(sortedArr, percentile) {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length < MIN_SAMPLES_FOR_PERCENTILE) {
    // Not enough samples - return max
    return sortedArr[sortedArr.length - 1];
  }

  const index = Math.ceil((percentile / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

/**
 * Calculate statistics for an operation
 * @private
 * @param {string} operation - Operation name
 * @returns {MetricsSummary|null} Summary or null if no samples
 */
function _calculateStats(operation) {
  const samples = _getSamples(operation);
  if (samples.length === 0) {
    return null;
  }

  // Sort for percentile calculation
  const sorted = [...samples].sort((a, b) => a - b);

  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / sorted.length;

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(avg * 100) / 100,
    p50: _calculatePercentile(sorted, 50),
    p95: _calculatePercentile(sorted, 95),
    p99: _calculatePercentile(sorted, 99),
    lastTimestamp: Date.now()
  };
}

/**
 * Start timing an operation
 * Returns a timer ID that must be passed to endTiming()
 *
 * @param {string} operation - Operation name (e.g., 'storage-read', 'render-ui')
 * @returns {string} Timer ID to pass to endTiming()
 */
export function startTiming(operation) {
  const timerId = _generateTimerId();
  _pendingTimers.set(timerId, {
    operation,
    startTime: performance.now()
  });

  _logMetricsOperation('TIMING_STARTED', {
    operation,
    timerId
  });

  return timerId;
}

/**
 * End timing for an operation
 * Records the duration and returns it
 *
 * @param {string} timerId - Timer ID from startTiming()
 * @returns {number|null} Duration in milliseconds, or null if timer not found
 */
export function endTiming(timerId) {
  const timer = _pendingTimers.get(timerId);
  if (!timer) {
    console.warn('[PerformanceMetrics] Timer not found:', timerId);
    return null;
  }

  const duration = performance.now() - timer.startTime;
  _pendingTimers.delete(timerId);

  // Record sample
  _addSample(timer.operation, duration);

  _logMetricsOperation('TIMING_ENDED', {
    operation: timer.operation,
    duration: Math.round(duration * 100) / 100
  });

  return duration;
}

/**
 * Record a timing directly (when start/end pattern isn't suitable)
 *
 * @param {string} operation - Operation name
 * @param {number} durationMs - Duration in milliseconds
 */
export function recordTiming(operation, durationMs) {
  _addSample(operation, durationMs);

  _logMetricsOperation('TIMING_RECORDED', {
    operation,
    duration: Math.round(durationMs * 100) / 100
  });
}

/**
 * Time a promise-based operation
 * Automatically measures and records the time
 *
 * @param {string} operation - Operation name
 * @param {Promise} promise - Promise to time
 * @returns {Promise} The original promise result
 */
export async function timePromise(operation, promise) {
  const timerId = startTiming(operation);
  try {
    const result = await promise;
    endTiming(timerId);
    return result;
  } catch (err) {
    endTiming(timerId);
    throw err;
  }
}

/**
 * Time a sync function
 * Wraps the function and records timing
 *
 * @param {string} operation - Operation name
 * @param {Function} fn - Function to time
 * @returns {*} Function result
 */
export function timeSync(operation, fn) {
  const timerId = startTiming(operation);
  try {
    const result = fn();
    endTiming(timerId);
    return result;
  } catch (err) {
    endTiming(timerId);
    throw err;
  }
}

/**
 * Get metrics summary for a specific operation
 *
 * @param {string} operation - Operation name
 * @returns {MetricsSummary|null} Summary or null if no data
 */
export function getOperationMetrics(operation) {
  return _calculateStats(operation);
}

/**
 * Get metrics summary for all operations
 *
 * @returns {Object} Map of operation name to MetricsSummary
 */
export function getMetricsSummary() {
  const summary = {};

  for (const operation of _samples.keys()) {
    const stats = _calculateStats(operation);
    if (stats) {
      summary[operation] = stats;
    }
  }

  return summary;
}

/**
 * Get list of tracked operations
 * @returns {string[]} Array of operation names
 */
export function getTrackedOperations() {
  return Array.from(_samples.keys());
}

/**
 * Flush metrics (log current state)
 * Called periodically when collection is active
 */
export function flushMetrics() {
  const summary = getMetricsSummary();
  const operationCount = Object.keys(summary).length;

  if (operationCount === 0) {
    _logMetricsOperation('FLUSH_EMPTY', {});
    return;
  }

  _lastFlushTime = Date.now();

  // Build batched metrics for single log entry
  const metricsData = {};
  for (const [operation, stats] of Object.entries(summary)) {
    metricsData[operation] = {
      count: stats.count,
      avg: stats.avg,
      p50: stats.p50,
      p95: stats.p95,
      p99: stats.p99,
      min: stats.min,
      max: stats.max
    };
  }

  // Log all metrics in a single structured entry for better performance
  console.log('[PerformanceMetrics] METRICS_FLUSH:', {
    operationCount,
    timestamp: _lastFlushTime,
    metrics: metricsData
  });
}

/**
 * Start automatic metric collection and flushing
 *
 * @param {Object} options - Configuration options
 * @param {number} options.flushIntervalMs - Interval between flushes (default 60000ms)
 * @returns {boolean} True if collection started
 */
export function startCollection(options = {}) {
  if (_isCollecting) {
    console.warn('[PerformanceMetrics] Collection already active');
    return false;
  }

  const flushInterval = options.flushIntervalMs || FLUSH_INTERVAL_MS;

  _flushIntervalId = setInterval(flushMetrics, flushInterval);
  _isCollecting = true;

  console.log('[PerformanceMetrics] Collection started:', {
    flushIntervalMs: flushInterval
  });

  return true;
}

/**
 * Stop automatic metric collection
 */
export function stopCollection() {
  if (!_isCollecting) {
    return;
  }

  if (_flushIntervalId) {
    clearInterval(_flushIntervalId);
    _flushIntervalId = null;
  }

  // Final flush before stopping
  flushMetrics();

  _isCollecting = false;
  console.log('[PerformanceMetrics] Collection stopped');
}

/**
 * Check if collection is active
 * @returns {boolean} True if collection is active
 */
export function isCollectionActive() {
  return _isCollecting;
}

/**
 * Clear all collected metrics
 */
export function clearMetrics() {
  _samples.clear();
  _pendingTimers.clear();
  _lastFlushTime = 0;

  _logMetricsOperation('METRICS_CLEARED', {});
}

/**
 * Get raw sample data for an operation
 * Useful for detailed analysis
 *
 * @param {string} operation - Operation name
 * @returns {number[]} Array of duration samples
 */
export function getRawSamples(operation) {
  return [...(_samples.get(operation) || [])];
}

/**
 * Get collection status
 * @returns {Object} Collection status information
 */
export function getCollectionStatus() {
  return {
    isCollecting: _isCollecting,
    operationCount: _samples.size,
    pendingTimers: _pendingTimers.size,
    lastFlushTime: _lastFlushTime,
    totalSamples: Array.from(_samples.values()).reduce((sum, arr) => sum + arr.length, 0),
    operations: Array.from(_samples.entries()).map(([op, samples]) => ({
      name: op,
      sampleCount: samples.length
    }))
  };
}

// Export default object with all methods
export default {
  startTiming,
  endTiming,
  recordTiming,
  timePromise,
  timeSync,
  getOperationMetrics,
  getMetricsSummary,
  getTrackedOperations,
  flushMetrics,
  startCollection,
  stopCollection,
  isCollectionActive,
  clearMetrics,
  getRawSamples,
  getCollectionStatus
};
