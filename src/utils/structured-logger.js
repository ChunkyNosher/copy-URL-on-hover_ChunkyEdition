/**
 * Structured Logger for Quick Tabs Diagnostics
 * v1.6.3.10-v9 - Comprehensive logging infrastructure per logging-diagnostics.md
 *
 * Provides:
 * - Consistent log format with component, level, timestamp
 * - Correlation IDs for tracing related log entries
 * - Structured data for programmatic parsing
 * - Component-specific prefixes (Storage, Hydration, Ownership, etc.)
 *
 * Log Format:
 * [Component] LEVEL: message { structured_data }
 *
 * Correlation ID Patterns:
 * - Hydration: hyd-{timestamp}-{random6}
 * - Write: write-{timestamp}-{random6}
 * - Transaction: txn-{timestamp}-{random6}
 *
 * @module structured-logger
 */

// ==================== CONSTANTS ====================

/**
 * Log level enumeration
 * @enum {string}
 */
export const LOG_LEVEL = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

/**
 * Component prefixes for structured logging
 * @enum {string}
 */
export const LOG_COMPONENT = {
  STORAGE: 'Storage',
  STORAGE_INIT: 'Storage-Init',
  STORAGE_IDENTITY: 'Storage-Identity',
  STORAGE_WRITE: 'StorageWrite',
  STORAGE_QUEUE: 'StorageQueue',
  STORAGE_EVENT: 'StorageEvent',
  STORAGE_ERROR: 'StorageError',
  STORAGE_ADAPTER: 'StorageAdapter',
  HYDRATION: 'Hydration',
  HYDRATION_OWNERSHIP: 'Hydration-Ownership',
  OWNERSHIP: 'OwnershipValidation',
  CONTAINER: 'ContainerFilter',
  TRANSACTION: 'Transaction',
  SUBSCRIPTION: 'Subscription',
  MEMORY_TELEMETRY: 'MemoryTelemetry',
  SELF_WRITE: 'SelfWrite',
  QUOTA_MONITOR: 'QuotaMonitor',
  RATE_LIMIT: 'RateLimit',
  RETRY: 'Retry',
  LIFECYCLE_TRACE: 'LifecycleTrace',
  // v1.6.3.12 - Scenario-aware logging for Quick Tabs state machine
  QUICK_TABS: 'QuickTabs',
  QUICK_TABS_MEDIATOR: 'QuickTabs-Mediator',
  QUICK_TABS_STATE_MACHINE: 'QuickTabs-StateMachine',
  QUICK_TABS_MINIMIZED: 'QuickTabs-Minimized'
};

/**
 * Correlation ID prefixes
 * @enum {string}
 */
export const CORRELATION_PREFIX = {
  HYDRATION: 'hyd',
  WRITE: 'write',
  TRANSACTION: 'txn',
  LIFECYCLE: 'cycle'
};

// ==================== CORRELATION ID GENERATION ====================

/**
 * Generate random suffix for correlation IDs
 * @private
 * @returns {string} 6-character random string
 */
function _generateRandomSuffix() {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Generate correlation ID with specified prefix
 * Format: {prefix}-{ISO-timestamp}-{random6}
 *
 * @param {string} prefix - Correlation prefix (hyd, write, txn, etc.)
 * @returns {string} Correlation ID
 */
export function generateCorrelationId(prefix = 'op') {
  const timestamp = new Date().toISOString();
  const random = _generateRandomSuffix();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate hydration correlation ID
 * @returns {string} Hydration trace correlation ID
 */
export function generateHydrationCorrelationId() {
  return generateCorrelationId(CORRELATION_PREFIX.HYDRATION);
}

/**
 * Generate write correlation ID
 * @returns {string} Write operation correlation ID
 */
export function generateWriteCorrelationId() {
  return generateCorrelationId(CORRELATION_PREFIX.WRITE);
}

/**
 * Generate transaction correlation ID
 * @returns {string} Transaction correlation ID
 */
export function generateTransactionCorrelationId() {
  return generateCorrelationId(CORRELATION_PREFIX.TRANSACTION);
}

/**
 * Generate lifecycle trace correlation ID
 * @returns {string} Lifecycle trace correlation ID
 */
export function generateLifecycleCorrelationId() {
  return generateCorrelationId(CORRELATION_PREFIX.LIFECYCLE);
}

// ==================== STRUCTURED LOGGER CLASS ====================

/**
 * StructuredLogger class for consistent, component-based logging
 *
 * Usage:
 * ```javascript
 * const logger = new StructuredLogger(LOG_COMPONENT.STORAGE);
 * logger.info('STATE_TRANSITION', { from: 'IDLE', to: 'READY' });
 * logger.withCorrelation('hyd-123').debug('FILTER_CHECK', { tab: 5 });
 * ```
 */
export class StructuredLogger {
  /**
   * Create a structured logger for a component
   * @param {string} component - Component name from LOG_COMPONENT
   */
  constructor(component) {
    this._component = component;
    this._correlationId = null;
    this._context = {};
  }

  /**
   * Create a child logger with correlation ID
   * @param {string} correlationId - Correlation ID to attach to logs
   * @returns {StructuredLogger} New logger instance with correlation
   */
  withCorrelation(correlationId) {
    const child = new StructuredLogger(this._component);
    child._correlationId = correlationId;
    child._context = { ...this._context };
    return child;
  }

  /**
   * Create a child logger with additional context
   * @param {Object} context - Additional context to merge
   * @returns {StructuredLogger} New logger instance with context
   */
  withContext(context) {
    const child = new StructuredLogger(this._component);
    child._correlationId = this._correlationId;
    child._context = { ...this._context, ...context };
    return child;
  }

  /**
   * Format log entry with component prefix
   * @private
   * @param {string} level - Log level
   * @param {string} event - Event name/type
   * @param {Object} data - Structured data
   * @returns {Object} Formatted log object
   */
  _formatLog(level, event, data = {}) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      component: this._component,
      level,
      event,
      ...this._context,
      ...data
    };

    if (this._correlationId) {
      entry.correlationId = this._correlationId;
    }

    return entry;
  }

  /**
   * Build log message prefix
   * @private
   * @param {string} event - Event name
   * @returns {string} Formatted prefix
   */
  _buildPrefix(event) {
    const prefix = `[${this._component}]`;
    const correlationSuffix = this._correlationId ? ` [${this._correlationId}]` : '';
    return `${prefix}${correlationSuffix} ${event}:`;
  }

  /**
   * Log at DEBUG level
   * @param {string} event - Event name
   * @param {Object} data - Structured data
   */
  debug(event, data = {}) {
    const entry = this._formatLog(LOG_LEVEL.DEBUG, event, data);
    console.log(this._buildPrefix(event), entry);
  }

  /**
   * Log at INFO level
   * @param {string} event - Event name
   * @param {Object} data - Structured data
   */
  info(event, data = {}) {
    const entry = this._formatLog(LOG_LEVEL.INFO, event, data);
    console.log(this._buildPrefix(event), entry);
  }

  /**
   * Log at WARN level
   * @param {string} event - Event name
   * @param {Object} data - Structured data
   */
  warn(event, data = {}) {
    const entry = this._formatLog(LOG_LEVEL.WARN, event, data);
    console.warn(this._buildPrefix(event), entry);
  }

  /**
   * Log at ERROR level
   * @param {string} event - Event name
   * @param {Object} data - Structured data
   */
  error(event, data = {}) {
    const entry = this._formatLog(LOG_LEVEL.ERROR, event, data);
    console.error(this._buildPrefix(event), entry);
  }
}

// ==================== PRE-CONFIGURED LOGGERS ====================

/**
 * Storage initialization logger
 */
export const storageInitLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_INIT);

/**
 * Storage identity logger
 */
export const storageIdentityLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_IDENTITY);

/**
 * Storage write logger
 */
export const storageWriteLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_WRITE);

/**
 * Storage queue logger
 */
export const storageQueueLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_QUEUE);

/**
 * Storage event logger
 */
export const storageEventLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_EVENT);

/**
 * Hydration logger
 */
export const hydrationLogger = new StructuredLogger(LOG_COMPONENT.HYDRATION);

/**
 * Hydration ownership logger
 */
export const hydrationOwnershipLogger = new StructuredLogger(LOG_COMPONENT.HYDRATION_OWNERSHIP);

/**
 * Ownership validation logger
 */
export const ownershipLogger = new StructuredLogger(LOG_COMPONENT.OWNERSHIP);

/**
 * Container filter logger
 */
export const containerLogger = new StructuredLogger(LOG_COMPONENT.CONTAINER);

/**
 * Transaction logger
 */
export const transactionLogger = new StructuredLogger(LOG_COMPONENT.TRANSACTION);

/**
 * Subscription logger
 */
export const subscriptionLogger = new StructuredLogger(LOG_COMPONENT.SUBSCRIPTION);

/**
 * Self-write detection logger
 */
export const selfWriteLogger = new StructuredLogger(LOG_COMPONENT.SELF_WRITE);

/**
 * Quota monitor logger
 */
export const quotaMonitorLogger = new StructuredLogger(LOG_COMPONENT.QUOTA_MONITOR);

/**
 * Storage error logger
 */
export const storageErrorLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_ERROR);

/**
 * Retry logger
 */
export const retryLogger = new StructuredLogger(LOG_COMPONENT.RETRY);

/**
 * Rate limit logger
 */
export const rateLimitLogger = new StructuredLogger(LOG_COMPONENT.RATE_LIMIT);

/**
 * Storage adapter logger
 */
export const storageAdapterLogger = new StructuredLogger(LOG_COMPONENT.STORAGE_ADAPTER);

/**
 * Quick Tabs logger
 * v1.6.3.12 - Scenario-aware logging
 */
export const quickTabsLogger = new StructuredLogger(LOG_COMPONENT.QUICK_TABS);

/**
 * Quick Tabs Mediator logger
 * v1.6.3.12 - State transition logging at mediator boundaries
 */
export const quickTabsMediatorLogger = new StructuredLogger(LOG_COMPONENT.QUICK_TABS_MEDIATOR);

/**
 * Quick Tabs State Machine logger
 * v1.6.3.12 - State machine transition logging
 */
export const quickTabsStateMachineLogger = new StructuredLogger(
  LOG_COMPONENT.QUICK_TABS_STATE_MACHINE
);

/**
 * Quick Tabs Minimized Manager logger
 * v1.6.3.12 - Minimized state change logging
 */
export const quickTabsMinimizedLogger = new StructuredLogger(LOG_COMPONENT.QUICK_TABS_MINIMIZED);

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate data size in bytes for logging
 * @param {*} data - Data to measure
 * @returns {number} Size in bytes or 0 if unable to calculate
 */
export function calculateDataSizeBytes(data) {
  try {
    return new Blob([JSON.stringify(data)]).size;
  } catch (_err) {
    return 0;
  }
}

/**
 * Format size for display
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5KB", "2.3MB")
 */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Create identity state snapshot for logging
 * @param {Object} options - Options containing identity state
 * @param {number|null} options.tabId - Current tab ID
 * @param {string|null} options.containerId - Current container ID
 * @param {string} options.identityMode - Current identity mode
 * @returns {Object} Identity state snapshot for logging
 */
export function createIdentityStateSnapshot({ tabId, containerId, identityMode }) {
  return {
    tabId: tabId !== null ? `KNOWN(${tabId})` : 'UNKNOWN',
    containerId: containerId !== null ? `KNOWN(${containerId})` : 'UNKNOWN',
    identityMode,
    isReady: tabId !== null && containerId !== null
  };
}

/**
 * Create ownership filter result for logging
 * @param {Object} options - Filter options
 * @param {string} options.quickTabId - Quick Tab ID
 * @param {number|null} options.originTabId - Origin tab ID
 * @param {number|null} options.currentTabId - Current tab ID
 * @param {string|null} options.originContainerId - Origin container ID
 * @param {string|null} options.currentContainerId - Current container ID
 * @param {boolean} options.accepted - Whether filter accepted the Quick Tab
 * @param {string} options.reason - Reason code for decision
 * @returns {Object} Ownership filter result for logging
 */
export function createOwnershipFilterResult({
  quickTabId,
  originTabId,
  currentTabId,
  originContainerId,
  currentContainerId,
  accepted,
  reason
}) {
  return {
    quickTabId,
    originTabId,
    currentTabId,
    tabIdMatch: originTabId === currentTabId,
    originContainerId,
    currentContainerId,
    containerIdMatch: originContainerId === currentContainerId,
    accepted,
    reason
  };
}
