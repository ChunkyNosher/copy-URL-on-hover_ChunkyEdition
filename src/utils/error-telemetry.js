/**
 * Error Telemetry Infrastructure
 * v1.6.3.12-v7 - FIX Issues #8, #13: Comprehensive error tracking and threshold alerting
 *
 * Provides:
 * - Error counter per error type (handler failures, port timeouts, notification failures, etc.)
 * - Frequency tracking in time windows (1 minute, 5 minutes)
 * - Threshold-based escalation logging when error frequency exceeds limits
 * - Rolling error buffer (last 100 errors with timestamps, types, context)
 *
 * Log Prefixes:
 * - [ERROR_TELEMETRY] - Main error telemetry events
 * - [ERROR_RECOVERY] - Error recovery attempt tracking
 *
 * @module error-telemetry
 */

// ==================== CONSTANTS ====================

/**
 * Error types for telemetry tracking
 * @enum {string}
 */
export const ERROR_TYPES = {
  HANDLER_FAILURE: 'handler_failure',
  PORT_TIMEOUT: 'port_timeout',
  NOTIFICATION_FAILURE: 'notification_failure',
  STORAGE_ERROR: 'storage_error',
  VALIDATION_ERROR: 'validation_error',
  MESSAGE_TIMEOUT: 'message_timeout',
  INITIALIZATION_ERROR: 'initialization_error',
  SYNC_ERROR: 'sync_error',
  UNKNOWN: 'unknown'
};

/**
 * Threshold for errors per minute before escalation
 * @type {number}
 */
export const ERROR_THRESHOLD_PER_MINUTE = 5;

/**
 * Maximum size of rolling error buffer
 * @type {number}
 */
export const ERROR_BUFFER_MAX_SIZE = 100;

/**
 * Time windows for frequency tracking (in milliseconds)
 * @type {Object}
 */
export const TIME_WINDOWS = {
  ONE_MINUTE_MS: 60000,
  FIVE_MINUTES_MS: 300000
};

// ==================== STATE ====================

/**
 * Rolling buffer of recent errors
 * @type {Array<{timestamp: number, type: string, context: Object, message: string}>}
 */
const errorBuffer = [];

/**
 * Error counts per type in 1-minute windows
 * Key: error type, Value: Array of timestamps
 * @type {Map<string, number[]>}
 */
const errorCountsPerMinute = new Map();

/**
 * Track last threshold exceeded alert time per type to prevent spam
 * @type {Map<string, number>}
 */
const lastThresholdAlertTime = new Map();

/**
 * Minimum time between threshold alerts (30 seconds)
 * @type {number}
 */
const THRESHOLD_ALERT_COOLDOWN_MS = 30000;

/**
 * Recovery attempt tracking
 * Key: recovery ID, Value: {startTime, attempts, lastError, status}
 * @type {Map<string, Object>}
 */
const recoveryAttempts = new Map();

// ==================== CORE FUNCTIONS ====================

/**
 * Record an error in the telemetry system
 * @param {string} errorType - Error type from ERROR_TYPES enum
 * @param {string} message - Error message
 * @param {Object} context - Additional context (handler name, operation, etc.)
 */
export function recordError(errorType, message, context = {}) {
  const now = Date.now();
  const type = ERROR_TYPES[errorType] || errorType || ERROR_TYPES.UNKNOWN;

  // Add to rolling buffer
  _addToErrorBuffer(now, type, message, context);

  // Update per-type frequency tracking
  _updateErrorFrequency(type, now);

  // Check threshold and escalate if needed
  _checkThresholdAndEscalate(type, now, message, context);

  // Log the recorded error
  console.log('[ERROR_TELEMETRY] ERROR_RECORDED:', {
    type,
    message: message?.substring(0, 100),
    context: _sanitizeContext(context),
    timestamp: now,
    bufferSize: errorBuffer.length
  });
}

/**
 * Record a handler-specific error with enhanced context
 * @param {string} handlerName - Name of the handler that failed
 * @param {string} operation - Operation being performed
 * @param {Error|string} error - The error that occurred
 * @param {Object} additionalContext - Additional context
 */
export function recordHandlerError(handlerName, operation, error, additionalContext = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const context = {
    handlerName,
    operation,
    stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
    ...additionalContext
  };

  recordError(ERROR_TYPES.HANDLER_FAILURE, message, context);
}

/**
 * Record a port/message timeout error
 * @param {string} operation - Operation that timed out
 * @param {number} timeoutMs - Timeout duration
 * @param {Object} context - Additional context
 */
export function recordTimeoutError(operation, timeoutMs, context = {}) {
  recordError(ERROR_TYPES.PORT_TIMEOUT, `Timeout after ${timeoutMs}ms: ${operation}`, {
    operation,
    timeoutMs,
    ...context
  });
}

/**
 * Record a storage-related error
 * @param {string} operation - Storage operation (read, write, etc.)
 * @param {Error|string} error - The error
 * @param {Object} context - Additional context
 */
export function recordStorageError(operation, error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  recordError(ERROR_TYPES.STORAGE_ERROR, message, {
    operation,
    ...context
  });
}

/**
 * Record a notification delivery failure
 * @param {string} notificationType - Type of notification
 * @param {Error|string} error - The error
 * @param {Object} context - Additional context
 */
export function recordNotificationError(notificationType, error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  recordError(ERROR_TYPES.NOTIFICATION_FAILURE, message, {
    notificationType,
    ...context
  });
}

// ==================== ERROR RECOVERY TRACKING ====================

/**
 * Start tracking an error recovery attempt
 * @param {string} recoveryId - Unique ID for this recovery attempt
 * @param {string} errorType - Type of error being recovered from
 * @param {Object} context - Recovery context
 * @returns {string} Recovery ID for tracking
 */
export function startRecoveryAttempt(recoveryId, errorType, context = {}) {
  const id = recoveryId || `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  recoveryAttempts.set(id, {
    startTime: Date.now(),
    errorType,
    attempts: 1,
    lastError: null,
    status: 'in_progress',
    context
  });

  console.log('[ERROR_RECOVERY] ATTEMPT_STARTED:', {
    recoveryId: id,
    errorType,
    context: _sanitizeContext(context),
    timestamp: Date.now()
  });

  return id;
}

/**
 * Record a recovery retry attempt
 * @param {string} recoveryId - Recovery ID from startRecoveryAttempt
 * @param {string} reason - Reason for retry
 */
export function recordRecoveryRetry(recoveryId, reason) {
  const attempt = recoveryAttempts.get(recoveryId);
  if (!attempt) {
    console.warn('[ERROR_RECOVERY] UNKNOWN_RECOVERY_ID:', { recoveryId });
    return;
  }

  attempt.attempts++;
  attempt.lastRetryTime = Date.now();

  console.log('[ERROR_RECOVERY] RETRY_ATTEMPT:', {
    recoveryId,
    attempt: attempt.attempts,
    reason,
    elapsedMs: Date.now() - attempt.startTime,
    timestamp: Date.now()
  });
}

/**
 * Mark recovery as complete (success or failure)
 * @param {string} recoveryId - Recovery ID
 * @param {boolean} success - Whether recovery succeeded
 * @param {string} details - Details about the outcome
 */
export function completeRecovery(recoveryId, success, details = '') {
  const attempt = recoveryAttempts.get(recoveryId);
  if (!attempt) {
    console.warn('[ERROR_RECOVERY] UNKNOWN_RECOVERY_ID:', { recoveryId });
    return;
  }

  attempt.status = success ? 'success' : 'failed';
  attempt.completedAt = Date.now();
  attempt.details = details;

  const logLevel = success ? 'log' : 'warn';
  console[logLevel](`[ERROR_RECOVERY] RECOVERY_${success ? 'COMPLETED' : 'FAILED'}:`, {
    recoveryId,
    errorType: attempt.errorType,
    attempts: attempt.attempts,
    durationMs: attempt.completedAt - attempt.startTime,
    success,
    details,
    timestamp: attempt.completedAt
  });

  // Clean up old recovery attempts
  _cleanupOldRecoveries();
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get error frequency for a specific type in the last minute
 * @param {string} errorType - Error type to query
 * @returns {number} Count of errors in last minute
 */
export function getErrorCountLastMinute(errorType) {
  const timestamps = errorCountsPerMinute.get(errorType) || [];
  const oneMinuteAgo = Date.now() - TIME_WINDOWS.ONE_MINUTE_MS;
  return timestamps.filter(ts => ts > oneMinuteAgo).length;
}

/**
 * Get error frequency for a specific type in the last 5 minutes
 * @param {string} errorType - Error type to query
 * @returns {number} Count of errors in last 5 minutes
 */
export function getErrorCountLast5Minutes(errorType) {
  const timestamps = errorCountsPerMinute.get(errorType) || [];
  const fiveMinutesAgo = Date.now() - TIME_WINDOWS.FIVE_MINUTES_MS;
  return timestamps.filter(ts => ts > fiveMinutesAgo).length;
}

/**
 * Get all error counts per type for the last minute
 * @returns {Object} Map of error type to count
 */
export function getAllErrorCounts() {
  const counts = {};
  for (const type of Object.values(ERROR_TYPES)) {
    counts[type] = getErrorCountLastMinute(type);
  }
  return counts;
}

/**
 * Get recent errors from the buffer
 * @param {number} limit - Maximum number of errors to return
 * @param {string} filterType - Optional filter by error type
 * @returns {Array} Recent errors
 */
export function getRecentErrors(limit = 20, filterType = null) {
  let errors = [...errorBuffer];

  if (filterType) {
    errors = errors.filter(e => e.type === filterType);
  }

  return errors.slice(-limit);
}

/**
 * Get telemetry summary for debugging
 * @returns {Object} Telemetry summary
 */
export function getTelemetrySummary() {
  const now = Date.now();
  return {
    timestamp: now,
    bufferSize: errorBuffer.length,
    countsLastMinute: getAllErrorCounts(),
    activeRecoveries: Array.from(recoveryAttempts.entries())
      .filter(([_, v]) => v.status === 'in_progress')
      .map(([k, v]) => ({ id: k, errorType: v.errorType, attempts: v.attempts })),
    oldestError: errorBuffer.length > 0 ? errorBuffer[0].timestamp : null,
    newestError: errorBuffer.length > 0 ? errorBuffer[errorBuffer.length - 1].timestamp : null
  };
}

// ==================== PRIVATE HELPERS ====================

/**
 * Add error to rolling buffer
 * @private
 */
function _addToErrorBuffer(timestamp, type, message, context) {
  errorBuffer.push({
    timestamp,
    type,
    message: message?.substring(0, 200),
    context: _sanitizeContext(context)
  });

  // Maintain buffer size
  while (errorBuffer.length > ERROR_BUFFER_MAX_SIZE) {
    errorBuffer.shift();
  }
}

/**
 * Update error frequency tracking
 * @private
 */
function _updateErrorFrequency(type, timestamp) {
  if (!errorCountsPerMinute.has(type)) {
    errorCountsPerMinute.set(type, []);
  }

  const timestamps = errorCountsPerMinute.get(type);
  timestamps.push(timestamp);

  // Clean up old timestamps (older than 5 minutes)
  const fiveMinutesAgo = timestamp - TIME_WINDOWS.FIVE_MINUTES_MS;
  const filtered = timestamps.filter(ts => ts > fiveMinutesAgo);
  errorCountsPerMinute.set(type, filtered);
}

/**
 * Check if threshold exceeded and escalate if needed
 * @private
 */
function _checkThresholdAndEscalate(type, timestamp, message, context) {
  const countLastMinute = getErrorCountLastMinute(type);

  if (countLastMinute >= ERROR_THRESHOLD_PER_MINUTE) {
    // Check cooldown to prevent alert spam
    const lastAlert = lastThresholdAlertTime.get(type) || 0;
    if (timestamp - lastAlert < THRESHOLD_ALERT_COOLDOWN_MS) {
      return; // Skip alert during cooldown
    }

    lastThresholdAlertTime.set(type, timestamp);

    // Escalate with severity
    console.error('[ERROR_TELEMETRY] THRESHOLD_EXCEEDED:', {
      severity: 'HIGH',
      errorType: type,
      countLastMinute,
      threshold: ERROR_THRESHOLD_PER_MINUTE,
      countLast5Minutes: getErrorCountLast5Minutes(type),
      lastMessage: message?.substring(0, 100),
      context: _sanitizeContext(context),
      timestamp,
      action: 'INVESTIGATE_IMMEDIATELY'
    });
  }
}

/**
 * Safely serialize an object value for logging
 * @private
 */
function _safeSerializeValue(value, maxLength) {
  try {
    return JSON.stringify(value).substring(0, maxLength);
  } catch (_err) {
    return '[Object]';
  }
}

/**
 * Sanitize a single value for context logging
 * @private
 */
function _sanitizeSingleValue(value) {
  if (typeof value === 'string' && value.length > 200) {
    return value.substring(0, 200) + '...';
  }
  if (typeof value === 'object' && value !== null) {
    return _safeSerializeValue(value, 200);
  }
  return value;
}

/**
 * Sanitize context object for logging (remove sensitive data, truncate)
 * @private
 */
function _sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};

  const sensitiveKeys = ['password', 'token', 'secret', 'cookie'];
  const sanitized = {};

  for (const [key, value] of Object.entries(context)) {
    if (sensitiveKeys.includes(key.toLowerCase())) continue;
    sanitized[key] = _sanitizeSingleValue(value);
  }

  return sanitized;
}

/**
 * Clean up old recovery attempts (older than 5 minutes and completed)
 * @private
 */
function _cleanupOldRecoveries() {
  const fiveMinutesAgo = Date.now() - TIME_WINDOWS.FIVE_MINUTES_MS;

  for (const [id, attempt] of recoveryAttempts.entries()) {
    // Only delete completed attempts that have a completedAt timestamp older than 5 minutes
    const isCompleted = attempt.status !== 'in_progress';
    const isOldEnough = attempt.completedAt && attempt.completedAt < fiveMinutesAgo;
    if (isCompleted && isOldEnough) {
      recoveryAttempts.delete(id);
    }
  }
}

/**
 * Clear all telemetry data (for testing)
 * @private
 */
export function _resetTelemetry() {
  errorBuffer.length = 0;
  errorCountsPerMinute.clear();
  lastThresholdAlertTime.clear();
  recoveryAttempts.clear();
}
