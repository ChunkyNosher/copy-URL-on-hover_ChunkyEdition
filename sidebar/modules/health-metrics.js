/**
 * Health & Metrics Module
 * sidebar/modules/health-metrics.js
 *
 * v1.6.3.8-v4 - Extracted from quick-tabs-manager.js for bundle size refactoring
 *
 * Responsibilities:
 * - Storage health probes
 * - Port health tracking
 * - Dedup map size monitoring
 * - Fallback health monitoring
 * - Performance metrics collection
 *
 * MIGRATION STATUS: Phase 1 (Constants & Functions Only)
 * The state variables in this module (storageHealthStats, fallbackStats, etc.)
 * are NOT currently used by quick-tabs-manager.js. The main file retains its
 * own local state (storageHealthStats at line ~4221) as the authoritative source.
 * These module state variables exist for future Phase 3 migration.
 *
 * @module sidebar/modules/health-metrics
 */

// ==================== CONSTANTS ====================

/**
 * Capacity threshold for proactive dedup map cleanup
 * v1.6.3.8-v4 - FIX Issue #7: Cleanup at 50% capacity instead of waiting for 90%
 */
export const DEDUP_CLEANUP_THRESHOLD = 0.5;

/**
 * Sliding window eviction threshold
 * v1.6.3.8-v4 - FIX Issue #7: Remove oldest 10% when hitting 95%
 */
export const DEDUP_EVICTION_THRESHOLD = 0.95;

/**
 * Minimum time between storage health probes
 * v1.6.3.8-v4 - FIX Issue #8: Prevent rapid probe requests
 */
export const PROBE_MIN_INTERVAL_MS = 500;

/**
 * Force reset timeout for stuck probe flag
 * v1.6.3.8-v4 - FIX Issue #8: If probe running >1000ms, force-reset flag
 */
export const PROBE_FORCE_RESET_MS = 1000;

/**
 * Maximum deduplication entries before forced eviction
 * v1.6.4.16 - FIX Issue #13: Prevent unbounded growth of dedup map
 */
export const MESSAGE_DEDUP_MAX_SIZE = 1000;

/**
 * Max age for message ID tracking (ms)
 * v1.6.3.7-v4 - FIX Issue #4: Cleanup old message IDs
 */
export const MESSAGE_ID_MAX_AGE_MS = 5000;

/**
 * Fallback stall threshold (ms)
 * v1.6.3.7-v13 - Issue #12: Stall detection threshold
 */
export const FALLBACK_STALL_THRESHOLD_MS = 60000;

/**
 * Health probe key for storage tier verification
 * v1.6.3.7-v13 - arch #6: Storage health probe
 */
export const STORAGE_HEALTH_PROBE_KEY = '_sidebar_health_ping';

// ==================== STORAGE HEALTH STATE ====================

/**
 * Storage health statistics
 * v1.6.3.7-v13 - arch #6: Track storage tier health
 */
export const storageHealthStats = {
  probeCount: 0,
  successCount: 0,
  failureCount: 0,
  avgLatencyMs: 0,
  lastProbeTime: 0,
  lastSuccessTime: 0,
  lastLatencyMs: 0,
  probeInProgress: false
};

/**
 * Timestamp when last probe was started
 * v1.6.3.8-v4 - FIX Issue #8: Track for min interval enforcement
 */
let lastProbeStartTime = 0;

// ==================== DEDUP MAP STATE ====================

/**
 * Set of recently processed message IDs (for correlation ID based dedup)
 * v1.6.3.7-v4 - FIX Issue #4: Message deduplication
 */
const recentlyProcessedMessageIds = new Set();

/**
 * Map of message ID to timestamp for age-based cleanup
 * v1.6.3.8-v4 - FIX Issue #7: Track timestamps for sliding window
 */
const messageIdTimestamps = new Map();

// ==================== FALLBACK HEALTH STATE ====================

/**
 * Fallback statistics for health monitoring
 * v1.6.3.7-v13 - Issue #12: Enhanced fallback health monitoring
 */
export const fallbackStats = {
  messageCount: 0,
  lastMessageTime: 0,
  avgLatencyMs: 0,
  lastLatencyMs: 0,
  stallCount: 0
};

// ==================== DEDUP MAP FUNCTIONS ====================

/**
 * Check if message ID has been recently processed
 * @param {string} messageId - Message ID to check
 * @returns {boolean} True if recently processed
 */
export function isMessageProcessed(messageId) {
  return recentlyProcessedMessageIds.has(messageId);
}

/**
 * Mark message ID as processed
 * @param {string} messageId - Message ID to mark
 */
export function markMessageProcessed(messageId) {
  recentlyProcessedMessageIds.add(messageId);
  messageIdTimestamps.set(messageId, Date.now());

  // Check for proactive cleanup
  checkDedupMapCapacity();
}

/**
 * Get dedup map size
 * @returns {number} Current size of dedup map
 */
export function getDedupMapSize() {
  return recentlyProcessedMessageIds.size;
}

/**
 * Check dedup map capacity and cleanup if needed
 * v1.6.3.8-v4 - FIX Issue #7: Proactive cleanup at 50%
 */
export function checkDedupMapCapacity() {
  const size = recentlyProcessedMessageIds.size;
  const capacity = size / MESSAGE_DEDUP_MAX_SIZE;

  // Proactive cleanup at 50% capacity
  if (capacity >= DEDUP_CLEANUP_THRESHOLD && capacity < DEDUP_EVICTION_THRESHOLD) {
    cleanupOldMessageIds();
  }

  // Aggressive eviction at 95% capacity
  if (capacity >= DEDUP_EVICTION_THRESHOLD) {
    evictOldestMessageIds();
  }
}

/**
 * Clean up old message IDs based on age
 * v1.6.3.7-v4 - FIX Issue #4: Cleanup old message IDs
 */
export function cleanupOldMessageIds() {
  const now = Date.now();
  const cutoffTime = now - MESSAGE_ID_MAX_AGE_MS;
  let removedCount = 0;

  for (const [messageId, timestamp] of messageIdTimestamps.entries()) {
    if (timestamp < cutoffTime) {
      recentlyProcessedMessageIds.delete(messageId);
      messageIdTimestamps.delete(messageId);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log('[Manager] DEDUP_CLEANUP: age-based', {
      removed: removedCount,
      remaining: recentlyProcessedMessageIds.size,
      timestamp: now
    });
  }
}

/**
 * Evict oldest 10% of message IDs
 * v1.6.3.8-v4 - FIX Issue #7: Sliding window eviction
 */
export function evictOldestMessageIds() {
  const entries = [...messageIdTimestamps.entries()].sort((a, b) => a[1] - b[1]);
  const evictCount = Math.ceil(entries.length * 0.1);

  for (let i = 0; i < evictCount && i < entries.length; i++) {
    const [messageId] = entries[i];
    recentlyProcessedMessageIds.delete(messageId);
    messageIdTimestamps.delete(messageId);
  }

  console.log('[Manager] DEDUP_EVICTION: sliding window', {
    evicted: evictCount,
    remaining: recentlyProcessedMessageIds.size,
    timestamp: Date.now()
  });
}

/**
 * Clear all dedup map entries
 */
export function clearDedupMap() {
  const size = recentlyProcessedMessageIds.size;
  recentlyProcessedMessageIds.clear();
  messageIdTimestamps.clear();

  console.log('[Manager] DEDUP_MAP_CLEARED:', {
    previousSize: size,
    timestamp: Date.now()
  });
}

/**
 * Log dedup map size for diagnostics
 * v1.6.3.7-v13 - Dedup map size logging
 */
export function logDedupMapSize() {
  console.log('[Manager] DEDUP_MAP_SIZE:', {
    size: recentlyProcessedMessageIds.size,
    maxSize: MESSAGE_DEDUP_MAX_SIZE,
    capacity: ((recentlyProcessedMessageIds.size / MESSAGE_DEDUP_MAX_SIZE) * 100).toFixed(1) + '%',
    timestamp: Date.now()
  });
}

// ==================== STORAGE HEALTH FUNCTIONS ====================

/**
 * Check if storage probe can be started
 * v1.6.3.8-v4 - FIX Issue #8: Enforce min interval
 * @returns {boolean} True if probe can start
 */
export function canStartProbe() {
  const now = Date.now();
  const timeSinceLastProbe = now - lastProbeStartTime;

  // Check min interval
  if (timeSinceLastProbe < PROBE_MIN_INTERVAL_MS) {
    console.log('[Manager] PROBE_RATE_LIMITED:', {
      timeSinceLastProbe,
      minInterval: PROBE_MIN_INTERVAL_MS,
      timestamp: now
    });
    return false;
  }

  // Check if probe already in progress
  if (storageHealthStats.probeInProgress) {
    const probeAge = now - lastProbeStartTime;
    if (probeAge > PROBE_FORCE_RESET_MS) {
      // Force reset stuck probe
      console.warn('[Manager] PROBE_FORCE_RESET: stuck probe detected', {
        probeAge,
        threshold: PROBE_FORCE_RESET_MS,
        timestamp: now
      });
      storageHealthStats.probeInProgress = false;
    } else {
      console.log('[Manager] PROBE_IN_PROGRESS: skipping', {
        probeAge,
        timestamp: now
      });
      return false;
    }
  }

  return true;
}

/**
 * Start a storage health probe
 * v1.6.3.7-v13 - arch #6: Storage health probe
 */
export function startStorageProbe() {
  const now = Date.now();
  lastProbeStartTime = now;
  storageHealthStats.probeInProgress = true;
  storageHealthStats.probeCount++;
  storageHealthStats.lastProbeTime = now;

  console.log('[Manager] STORAGE_PROBE_STARTED:', {
    probeCount: storageHealthStats.probeCount,
    timestamp: now
  });

  return now;
}

/**
 * Complete a storage health probe
 * @param {number} startTime - When probe was started
 * @param {boolean} success - Whether probe succeeded
 */
export function completeStorageProbe(startTime, success) {
  const now = Date.now();
  const latency = now - startTime;

  storageHealthStats.probeInProgress = false;
  storageHealthStats.lastLatencyMs = latency;

  if (success) {
    storageHealthStats.successCount++;
    storageHealthStats.lastSuccessTime = now;

    // Update rolling average
    const totalSuccess = storageHealthStats.successCount;
    storageHealthStats.avgLatencyMs =
      (storageHealthStats.avgLatencyMs * (totalSuccess - 1) + latency) / totalSuccess;

    console.log('[Manager] STORAGE_PROBE_SUCCESS:', {
      latencyMs: latency,
      avgLatencyMs: storageHealthStats.avgLatencyMs.toFixed(1),
      successRate: getStorageSuccessRate(),
      timestamp: now
    });
  } else {
    storageHealthStats.failureCount++;

    console.warn('[Manager] STORAGE_PROBE_FAILED:', {
      latencyMs: latency,
      failureCount: storageHealthStats.failureCount,
      successRate: getStorageSuccessRate(),
      timestamp: now
    });
  }
}

/**
 * Get storage probe success rate
 * @returns {string} Success rate as percentage string
 */
export function getStorageSuccessRate() {
  const total = storageHealthStats.successCount + storageHealthStats.failureCount;
  if (total === 0) return '100%';
  return ((storageHealthStats.successCount / total) * 100).toFixed(1) + '%';
}

/**
 * Get storage health tier classification
 * v1.6.3.7-v13 - arch #6: Latency classification
 * @returns {string} 'healthy', 'acceptable', or 'degraded'
 */
export function getStorageHealthTier() {
  const latency = storageHealthStats.avgLatencyMs;
  if (latency === 0) return 'unknown';
  if (latency < 100) return 'healthy';
  if (latency < 500) return 'acceptable';
  return 'degraded';
}

/**
 * Get storage health snapshot
 * @returns {Object} Health statistics snapshot
 */
export function getStorageHealthSnapshot() {
  return {
    ...storageHealthStats,
    successRate: getStorageSuccessRate(),
    healthTier: getStorageHealthTier()
  };
}

// ==================== FALLBACK HEALTH FUNCTIONS ====================

/**
 * Record fallback message received
 * v1.6.3.7-v13 - Issue #12: Track fallback messages
 * @param {number} [latency] - Message latency in ms
 */
export function recordFallbackMessage(latency = 0) {
  const now = Date.now();
  fallbackStats.messageCount++;
  fallbackStats.lastMessageTime = now;

  if (latency > 0) {
    fallbackStats.lastLatencyMs = latency;
    // Update rolling average
    const count = fallbackStats.messageCount;
    fallbackStats.avgLatencyMs = (fallbackStats.avgLatencyMs * (count - 1) + latency) / count;
  }
}

/**
 * Check for fallback stall condition
 * v1.6.3.7-v13 - Issue #12: Stall detection
 * @returns {boolean} True if stalled
 */
export function checkFallbackStall() {
  const now = Date.now();
  const timeSinceLastMessage = now - fallbackStats.lastMessageTime;

  if (fallbackStats.lastMessageTime > 0 && timeSinceLastMessage > FALLBACK_STALL_THRESHOLD_MS) {
    fallbackStats.stallCount++;
    return true;
  }

  return false;
}

/**
 * Get fallback health snapshot
 * @returns {Object} Fallback statistics snapshot
 */
export function getFallbackHealthSnapshot() {
  return {
    ...fallbackStats,
    timeSinceLastMessage:
      fallbackStats.lastMessageTime > 0 ? Date.now() - fallbackStats.lastMessageTime : null,
    isStalled: checkFallbackStall()
  };
}

/**
 * Reset fallback statistics
 */
export function resetFallbackStats() {
  fallbackStats.messageCount = 0;
  fallbackStats.lastMessageTime = 0;
  fallbackStats.avgLatencyMs = 0;
  fallbackStats.lastLatencyMs = 0;
  fallbackStats.stallCount = 0;

  console.log('[Manager] FALLBACK_STATS_RESET:', {
    timestamp: Date.now()
  });
}

// ==================== COMBINED HEALTH REPORT ====================

/**
 * Generate comprehensive health report
 * @param {Object} context - Additional context
 * @returns {Object} Health report
 */
export function generateHealthReport(context = {}) {
  return {
    timestamp: Date.now(),
    storage: getStorageHealthSnapshot(),
    fallback: getFallbackHealthSnapshot(),
    dedupMap: {
      size: getDedupMapSize(),
      maxSize: MESSAGE_DEDUP_MAX_SIZE,
      capacity: getDedupMapSize() / MESSAGE_DEDUP_MAX_SIZE
    },
    ...context
  };
}
