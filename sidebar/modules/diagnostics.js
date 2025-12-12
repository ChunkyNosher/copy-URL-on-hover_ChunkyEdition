/**
 * Diagnostics & Logging Module
 * sidebar/modules/diagnostics.js
 *
 * v1.6.3.8-v4 - Extracted from quick-tabs-manager.js for bundle size refactoring
 *
 * Responsibilities:
 * - Log formatting
 * - Correlation IDs
 * - Structured logging for barriers, message paths, and errors
 * - Debug flags management
 */

// ==================== DEBUG FLAGS ====================

/**
 * Debug flag for verbose message routing logs
 * v1.6.4.13 - Issue #5: Feature flag for verbose message routing logs
 */
export const DEBUG_MESSAGING = true;

// ==================== CORRELATION ID TRACKING ====================

/**
 * Generate correlation ID for message acknowledgment
 * v1.6.3.6-v11 - FIX Issue #10: Correlation tracking
 * @returns {string} Unique correlation ID
 */
export function generateCorrelationId() {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate a unique session ID for this browser session
 * v1.6.3.7-v4 - FIX Issue #6: Session validation for cache
 * @returns {string} Unique session identifier
 */
export function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ==================== PORT LIFECYCLE LOGGING ====================

/**
 * Log port lifecycle event
 * v1.6.3.6-v11 - FIX Issue #12: Port lifecycle logging
 * @param {string} event - Event name
 * @param {Object} details - Event details
 * @param {Object} context - Context object with currentBrowserTabId, backgroundPort, connectionState
 */
export function logPortLifecycle(event, details = {}, context = {}) {
  console.log(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, {
    tabId: context.currentBrowserTabId,
    portId: context.backgroundPort?._portId,
    connectionState: context.connectionState,
    timestamp: Date.now(),
    ...details
  });
}

// ==================== MESSAGE ROUTING LOGGING ====================

/**
 * Log message received with unified format
 * v1.6.3.7-v9 - Issue #2: Unified MESSAGE_RECEIVED logging
 * @param {string} channel - Channel type: 'PORT', 'BC', 'RUNTIME', 'STORAGE'
 * @param {Object} message - The received message
 * @param {Object} context - Additional context
 */
export function logMessageReceived(channel, message, context = {}) {
  if (!DEBUG_MESSAGING) return;

  console.log(`[Manager] [${channel}] MESSAGE_RECEIVED:`, {
    type: message?.type || message?.action || 'unknown',
    correlationId: message?.correlationId,
    saveId: message?.state?.saveId || message?.saveId,
    timestamp: Date.now(),
    ...context
  });
}

/**
 * Log message processed with duration
 * v1.6.3.7-v9 - Issue #2: Message entry/exit logging with duration
 * @param {string} channel - Channel type
 * @param {Object} message - The processed message
 * @param {number} startTime - Processing start time
 * @param {boolean} success - Whether processing succeeded
 */
export function logMessageProcessed(channel, message, startTime, success = true) {
  if (!DEBUG_MESSAGING) return;

  const duration = Date.now() - startTime;
  const logFn = success ? console.log : console.warn;

  logFn(`[Manager] [${channel}] MESSAGE_PROCESSED:`, {
    type: message?.type || message?.action || 'unknown',
    correlationId: message?.correlationId,
    success,
    durationMs: duration,
    timestamp: Date.now()
  });
}

/**
 * Log dedup decision
 * v1.6.3.8 - Dedup decision logging
 * @param {string} saveId - The saveId being checked
 * @param {string} decision - 'SKIP' or 'PROCESS'
 * @param {string} reason - Reason for decision
 */
export function logDedupDecision(saveId, decision, reason) {
  console.log(`[Manager] DEDUP_DECISION: saveId=${saveId}, decision=${decision}`, {
    reason,
    timestamp: Date.now()
  });
}

// ==================== STATE TRANSITION LOGGING ====================

/**
 * Log connection state transition with context
 * v1.6.3.7-v6 - Issue #3: Enhanced context logging
 * @param {Object} options - Transition options
 * @param {string} options.oldState - Previous connection state
 * @param {string} options.newState - New connection state
 * @param {string} options.reason - Reason for transition
 * @param {number} options.duration - Duration in previous state
 * @param {number} options.consecutiveFailures - Consecutive failure count
 */
export function logConnectionStateTransition(options) {
  const { oldState, newState, reason, duration, consecutiveFailures = 0 } = options;

  console.log('[Manager] CONNECTION_STATE_TRANSITION:', {
    oldState,
    newState,
    reason,
    durationInPreviousStateMs: duration,
    consecutiveFailures,
    timestamp: Date.now()
  });
}

/**
 * Log fallback mode activation
 * v1.6.3.7-v5 - Issue #5: Sidebar BC fallback logging
 * @param {string} newState - Connection state that triggered fallback
 */
export function logFallbackModeIfNeeded(newState) {
  const CONNECTION_STATE = {
    CONNECTED: 'connected',
    ZOMBIE: 'zombie',
    DISCONNECTED: 'disconnected'
  };

  if (newState !== CONNECTION_STATE.CONNECTED) {
    console.log('[Manager] SIDEBAR_BC_UNAVAILABLE: Entering fallback mode', {
      connectionState: newState,
      fallbackMechanism: 'storage.onChanged (Tier 3)',
      message:
        'Port-based messaging unavailable. Using storage.onChanged for state sync. BC is for tab-to-tab only.',
      timestamp: Date.now()
    });
  }
}

// ==================== STORAGE LOGGING ====================

/**
 * Log storage read operation
 * @param {string} operation - Operation name
 * @param {Object} context - Context information
 */
export function logStorageRead(operation, context = {}) {
  console.log(`[Manager] [STORAGE] READ: ${operation}`, {
    timestamp: Date.now(),
    ...context
  });
}

/**
 * Log storage write operation
 * @param {string} operation - Operation name
 * @param {Object} context - Context information
 */
export function logStorageWrite(operation, context = {}) {
  console.log(`[Manager] [STORAGE] WRITE: ${operation}`, {
    timestamp: Date.now(),
    ...context
  });
}

/**
 * Log storage verification event
 * @param {string} status - Verification status
 * @param {Object} context - Context information
 */
export function logStorageVerification(status, context = {}) {
  const logFn = status === 'success' ? console.log : console.warn;
  logFn(`[Manager] STORAGE_LISTENER_VERIFICATION: ${status}`, {
    timestamp: Date.now(),
    ...context
  });
}

// ==================== HEALTH METRICS LOGGING ====================

/**
 * Log keepalive health report
 * v1.6.3.8 - Keepalive health reports
 * @param {number} successes - Number of successful keepalives
 * @param {number} failures - Number of failed keepalives
 */
export function logKeepaliveHealthReport(successes, failures) {
  const total = successes + failures;
  const successRate = total > 0 ? Math.round((successes / total) * 100) : 100;

  console.log(`[Manager] KEEPALIVE_HEALTH_REPORT: ${successes} successes, ${failures} failures (${successRate}%)`, {
    successRate,
    total,
    timestamp: Date.now()
  });
}

/**
 * Log port activity
 * v1.6.3.8 - Port activity tracking
 * @param {string} portId - Port identifier
 * @param {number} lastMessageTime - Time since last message
 */
export function logPortActivity(portId, lastMessageTime) {
  console.log(`[Manager] PORT_ACTIVITY: portId=${portId}, lastMessageTime=${lastMessageTime} ms ago`, {
    timestamp: Date.now()
  });
}

/**
 * Log fallback health status
 * v1.6.3.7-v13 - Issue #12: Enhanced fallback health monitoring
 * @param {Object} stats - Fallback statistics
 */
export function logFallbackHealth(stats) {
  console.log('[Manager] FALLBACK_HEALTH:', {
    ...stats,
    timestamp: Date.now()
  });
}

/**
 * Log fallback stall warning
 * v1.6.3.7-v13 - Issue #12: Stall detection
 * @param {number} lastUpdateMs - Time since last update in ms
 */
export function logFallbackStalled(lastUpdateMs) {
  console.warn('[Manager] FALLBACK_STALLED: No updates received', {
    lastUpdateMs,
    thresholdMs: 60000,
    message: 'No storage.onChanged updates for 60+ seconds',
    timestamp: Date.now()
  });
}

// ==================== ERROR LOGGING ====================

/**
 * Log error with context
 * @param {string} operation - Operation that failed
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
export function logError(operation, error, context = {}) {
  console.error(`[Manager] ERROR: ${operation}`, {
    error: error.message,
    stack: error.stack,
    timestamp: Date.now(),
    ...context
  });
}

/**
 * Log warning with context
 * @param {string} operation - Operation with warning
 * @param {string} message - Warning message
 * @param {Object} context - Additional context
 */
export function logWarning(operation, message, context = {}) {
  console.warn(`[Manager] WARNING: ${operation}`, {
    message,
    timestamp: Date.now(),
    ...context
  });
}

// ==================== DIAGNOSTIC UTILITIES ====================

/**
 * Format duration in human-readable form
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get age bucket for diagnostic display
 * v1.6.3.7-v10 - Issue #10: Age bucket distribution
 * @param {number} ageMs - Age in milliseconds
 * @returns {string} Age bucket label
 */
export function getAgeBucket(ageMs) {
  const ONE_HOUR = 60 * 60 * 1000;
  if (ageMs < ONE_HOUR) return '< 1h';
  if (ageMs < 6 * ONE_HOUR) return '1-6h';
  if (ageMs < 24 * ONE_HOUR) return '6-24h';
  return '> 24h';
}

/**
 * Create diagnostic snapshot of current state
 * @param {Object} context - Context with state information
 * @returns {Object} Diagnostic snapshot
 */
export function createDiagnosticSnapshot(context) {
  return {
    timestamp: Date.now(),
    connectionState: context.connectionState,
    initializationComplete: context.initializationComplete,
    storageListenerVerified: context.storageListenerVerified,
    tabCount: context.tabCount,
    dedupMapSize: context.dedupMapSize,
    portConnected: context.portConnected
  };
}
