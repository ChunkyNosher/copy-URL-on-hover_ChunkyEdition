/**
 * Comprehensive Logging Infrastructure
 * v1.6.4.17 - FIX Issues #8, #13, L1-L7: Logging infrastructure for extension debugging
 *
 * Provides standardized logging prefixes for all extension components:
 * - [LISTENER_REG] - Listener registration events
 * - [MSG_HANDLER] - Message handler tracing
 * - [STORAGE_PROPAGATE] - Storage change event propagation
 * - [ERROR_RECOVERY] - Error recovery attempt tracking
 * - [PORT_LIFECYCLE] - Port connection lifecycle
 * - [STATE_RECONCILE] - State reconciliation events
 * - [SYNC_LATENCY] - Cross-tab sync latency tracking
 *
 * @module logging-infrastructure
 */

// ==================== LOG PREFIXES ====================

/**
 * Standardized logging prefixes
 * @enum {string}
 */
export const LOG_PREFIX = {
  // L1: Listener Registration
  LISTENER_REG: '[LISTENER_REG]',

  // L2: Message Handler Tracing
  MSG_HANDLER: '[MSG_HANDLER]',

  // L3: Storage Change Propagation
  STORAGE_PROPAGATE: '[STORAGE_PROPAGATE]',

  // L4: Error Recovery
  ERROR_RECOVERY: '[ERROR_RECOVERY]',

  // L5: Port Lifecycle
  PORT_LIFECYCLE: '[PORT_LIFECYCLE]',

  // L6: State Reconciliation
  STATE_RECONCILE: '[STATE_RECONCILE]',

  // L7: Sync Latency
  SYNC_LATENCY: '[SYNC_LATENCY]'
};

// ==================== L1: LISTENER REGISTRATION LOGGING ====================

/**
 * Registered listeners tracking
 * @type {Map<string, {timestamp: number, type: string, status: string}>}
 */
const registeredListeners = new Map();

/**
 * Log when a listener is being registered
 * @param {string} listenerType - Type of listener (e.g., 'command', 'action_button', 'storage')
 * @param {string} apiPath - API path being used (e.g., 'browser.commands.onCommand')
 * @param {Object} context - Additional context
 */
export function logListenerRegistration(listenerType, apiPath, context = {}) {
  const timestamp = Date.now();
  const entry = {
    timestamp,
    listenerType,
    apiPath,
    status: 'registering',
    ...context
  };

  console.log(`${LOG_PREFIX.LISTENER_REG} REGISTERING:`, entry);
  registeredListeners.set(listenerType, entry);
}

/**
 * Log successful listener registration
 * @param {string} listenerType - Type of listener
 * @param {Object} context - Additional context
 */
export function logListenerRegistered(listenerType, context = {}) {
  const timestamp = Date.now();
  const existing = registeredListeners.get(listenerType);
  const durationMs = existing ? timestamp - existing.timestamp : 0;

  const entry = {
    timestamp,
    listenerType,
    status: 'registered',
    durationMs,
    ...context
  };

  console.log(`${LOG_PREFIX.LISTENER_REG} ✓ REGISTERED:`, entry);

  if (existing) {
    existing.status = 'registered';
    existing.registeredAt = timestamp;
  }
}

/**
 * Log listener registration failure
 * @param {string} listenerType - Type of listener
 * @param {Error|string} error - Error that occurred
 * @param {Object} context - Additional context
 */
export function logListenerRegistrationFailed(listenerType, error, context = {}) {
  const timestamp = Date.now();
  const message = error instanceof Error ? error.message : String(error);

  console.error(`${LOG_PREFIX.LISTENER_REG} ✗ FAILED:`, {
    timestamp,
    listenerType,
    error: message,
    stack: error instanceof Error ? error.stack?.substring(0, 300) : undefined,
    ...context
  });
}

/**
 * Log initialization completion with all listeners status
 * @param {string} component - Component name (e.g., 'background', 'content', 'sidebar')
 */
export function logInitializationComplete(component) {
  const timestamp = Date.now();
  const listenerStatuses = {};

  for (const [type, entry] of registeredListeners.entries()) {
    listenerStatuses[type] = {
      status: entry.status,
      apiPath: entry.apiPath
    };
  }

  console.log(`${LOG_PREFIX.LISTENER_REG} INIT_COMPLETE:`, {
    timestamp,
    component,
    listenerCount: registeredListeners.size,
    listeners: listenerStatuses
  });
}

// ==================== L2: MESSAGE HANDLER TRACING ====================

/**
 * Active message handlers being traced
 * @type {Map<string, {startTime: number, action: string, params: Object}>}
 */
const activeHandlers = new Map();

/**
 * Log when a message is received for handling
 * @param {string} source - Source of message (e.g., 'background', 'content', 'sidebar')
 * @param {string} action - Action/type of message
 * @param {Object} params - Parameters passed
 * @returns {string} Handler ID for tracking duration
 */
export function logMessageReceived(source, action, params = {}) {
  const handlerId = `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const timestamp = Date.now();

  const entry = {
    handlerId,
    timestamp,
    source,
    action,
    params: _sanitizeParams(params)
  };

  console.log(`${LOG_PREFIX.MSG_HANDLER} RECEIVED:`, entry);
  activeHandlers.set(handlerId, { startTime: timestamp, action, params: entry.params });

  return handlerId;
}

/**
 * Log which handler was invoked for a message
 * @param {string} handlerId - Handler ID from logMessageReceived
 * @param {string} handlerName - Name of the handler function/class
 * @param {Object} context - Additional context
 */
export function logHandlerInvoked(handlerId, handlerName, context = {}) {
  const entry = activeHandlers.get(handlerId);
  const timestamp = Date.now();

  console.log(`${LOG_PREFIX.MSG_HANDLER} INVOKED:`, {
    handlerId,
    handlerName,
    action: entry?.action,
    elapsedMs: entry ? timestamp - entry.startTime : 0,
    ...context
  });
}

/**
 * Log handler completion with response
 * @param {string} handlerId - Handler ID from logMessageReceived
 * @param {Object} response - Response sent back
 * @param {boolean} success - Whether handler succeeded
 */
export function logHandlerComplete(handlerId, response = {}, success = true) {
  const entry = activeHandlers.get(handlerId);
  const timestamp = Date.now();
  const durationMs = entry ? timestamp - entry.startTime : 0;

  const logFn = success ? console.log : console.warn;
  logFn(`${LOG_PREFIX.MSG_HANDLER} ${success ? 'COMPLETE' : 'FAILED'}:`, {
    handlerId,
    action: entry?.action,
    durationMs,
    success,
    response: _truncateResponse(response),
    timestamp
  });

  // Clean up
  activeHandlers.delete(handlerId);
}

// ==================== L3: STORAGE CHANGE PROPAGATION ====================

/**
 * Log what operation triggered a storage write
 * @param {string} operation - Operation that triggered write (e.g., 'CREATE', 'UPDATE', 'DELETE')
 * @param {string} key - Storage key being written
 * @param {Object} context - Additional context (quickTabId, originTabId, etc.)
 * @returns {string} Write ID for tracking propagation
 */
export function logStorageWriteTriggered(operation, key, context = {}) {
  const writeId = `write-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const timestamp = Date.now();

  console.log(`${LOG_PREFIX.STORAGE_PROPAGATE} WRITE_TRIGGERED:`, {
    writeId,
    timestamp,
    operation,
    key,
    ...context
  });

  return writeId;
}

/**
 * Log what state changed in storage
 * @param {string} writeId - Write ID from logStorageWriteTriggered
 * @param {Object} oldState - Previous state summary
 * @param {Object} newState - New state summary
 */
export function logStorageStateChanged(writeId, oldState, newState) {
  console.log(`${LOG_PREFIX.STORAGE_PROPAGATE} STATE_CHANGED:`, {
    writeId,
    timestamp: Date.now(),
    oldTabCount: oldState?.tabs?.length ?? 0,
    newTabCount: newState?.tabs?.length ?? 0,
    addedIds: _computeAddedIds(oldState, newState),
    removedIds: _computeRemovedIds(oldState, newState),
    saveId: newState?.saveId
  });
}

/**
 * Log when storage.onChanged listener fires
 * @param {string} key - Storage key that changed
 * @param {string} areaName - Storage area (local, sync, session)
 * @param {Object} context - Additional context
 */
export function logStorageListenerFired(key, areaName, context = {}) {
  console.log(`${LOG_PREFIX.STORAGE_PROPAGATE} LISTENER_FIRED:`, {
    timestamp: Date.now(),
    key,
    areaName,
    ...context
  });
}

/**
 * Log which subscribers were notified of storage change
 * @param {string} key - Storage key that changed
 * @param {number} subscriberCount - Number of subscribers notified
 * @param {Array<string>} subscriberIds - IDs of subscribers notified
 */
export function logStorageSubscribersNotified(key, subscriberCount, subscriberIds = []) {
  console.log(`${LOG_PREFIX.STORAGE_PROPAGATE} SUBSCRIBERS_NOTIFIED:`, {
    timestamp: Date.now(),
    key,
    subscriberCount,
    subscriberIds: subscriberIds.slice(0, 10) // Limit logged IDs
  });
}

// ==================== L4: ERROR RECOVERY (via error-telemetry.js) ====================
// Error recovery logging is handled by error-telemetry.js
// Re-exported for convenience
export { startRecoveryAttempt, recordRecoveryRetry, completeRecovery } from './error-telemetry.js';

// ==================== L5: PORT LIFECYCLE ====================

/**
 * Port lifecycle state
 * @type {Map<string, {connectedAt: number, state: string, lastActivity: number}>}
 */
const portStates = new Map();

/**
 * Log port connection established
 * @param {string} portName - Name of the port
 * @param {string} direction - 'inbound' or 'outbound'
 * @param {Object} context - Additional context
 */
export function logPortConnected(portName, direction, context = {}) {
  const timestamp = Date.now();

  portStates.set(portName, {
    connectedAt: timestamp,
    state: 'connected',
    lastActivity: timestamp
  });

  console.log(`${LOG_PREFIX.PORT_LIFECYCLE} CONNECTED:`, {
    timestamp,
    portName,
    direction,
    ...context
  });
}

/**
 * Log port connection failure
 * @param {string} portName - Name of the port
 * @param {Error|string} error - Connection error
 * @param {Object} context - Additional context
 */
export function logPortConnectionFailed(portName, error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`${LOG_PREFIX.PORT_LIFECYCLE} CONNECTION_FAILED:`, {
    timestamp: Date.now(),
    portName,
    error: message,
    ...context
  });
}

/**
 * Log message sent/received on port
 * @param {string} portName - Name of the port
 * @param {string} direction - 'sent' or 'received'
 * @param {string} messageType - Type of message
 * @param {Object} context - Additional context
 */
export function logPortMessage(portName, direction, messageType, context = {}) {
  const port = portStates.get(portName);
  if (port) {
    port.lastActivity = Date.now();
  }

  console.log(`${LOG_PREFIX.PORT_LIFECYCLE} MESSAGE_${direction.toUpperCase()}:`, {
    timestamp: Date.now(),
    portName,
    direction,
    messageType,
    ...context
  });
}

/**
 * Log port disconnection
 * @param {string} portName - Name of the port
 * @param {string} reason - 'normal', 'error', or 'timeout'
 * @param {Object} context - Additional context
 */
export function logPortDisconnected(portName, reason, context = {}) {
  const port = portStates.get(portName);
  const timestamp = Date.now();
  const connectionDurationMs = port ? timestamp - port.connectedAt : 0;

  const logFn = reason === 'normal' ? console.log : console.warn;
  logFn(`${LOG_PREFIX.PORT_LIFECYCLE} DISCONNECTED:`, {
    timestamp,
    portName,
    reason,
    connectionDurationMs,
    ...context
  });

  portStates.delete(portName);
}

/**
 * Log port reconnection attempt
 * @param {string} portName - Name of the port
 * @param {number} attemptNumber - Which attempt this is
 * @param {number} backoffMs - Backoff delay before attempt
 */
export function logPortReconnectAttempt(portName, attemptNumber, backoffMs) {
  console.log(`${LOG_PREFIX.PORT_LIFECYCLE} RECONNECT_ATTEMPT:`, {
    timestamp: Date.now(),
    portName,
    attemptNumber,
    backoffMs
  });
}

// ==================== L6: STATE RECONCILIATION ====================

/**
 * Log state reconciliation results
 * @param {Object} options - Reconciliation details
 * @param {number} options.loadedCount - Quick Tabs loaded from storage
 * @param {number} options.verifiedCount - Origin tabs verified as existing
 * @param {number} options.staleCount - Stale Quick Tabs found
 * @param {number} options.cleanedCount - Quick Tabs cleaned up
 * @param {Object} options.context - Additional context
 */
export function logStateReconciliation({
  loadedCount,
  verifiedCount,
  staleCount,
  cleanedCount,
  context = {}
}) {
  console.log(`${LOG_PREFIX.STATE_RECONCILE} RECONCILIATION_COMPLETE:`, {
    timestamp: Date.now(),
    loadedCount,
    verifiedCount,
    staleCount,
    cleanedCount,
    cleanupRate: loadedCount > 0 ? ((cleanedCount / loadedCount) * 100).toFixed(1) + '%' : '0%',
    ...context
  });
}

/**
 * Log origin tab verification
 * @param {string} quickTabId - Quick Tab being verified
 * @param {number} originTabId - Origin tab ID
 * @param {boolean} exists - Whether origin tab still exists
 */
export function logOriginTabVerification(quickTabId, originTabId, exists) {
  console.log(`${LOG_PREFIX.STATE_RECONCILE} ORIGIN_TAB_VERIFIED:`, {
    timestamp: Date.now(),
    quickTabId,
    originTabId,
    exists,
    action: exists ? 'keep' : 'mark_stale'
  });
}

/**
 * Log Quick Tab cleanup
 * @param {string} quickTabId - Quick Tab being cleaned up
 * @param {string} reason - Reason for cleanup (e.g., 'origin_tab_closed', 'stale')
 */
export function logQuickTabCleanup(quickTabId, reason) {
  console.log(`${LOG_PREFIX.STATE_RECONCILE} QUICK_TAB_CLEANED:`, {
    timestamp: Date.now(),
    quickTabId,
    reason
  });
}

// ==================== L7: SYNC LATENCY TRACKING ====================

/**
 * Active sync operations being tracked
 * @type {Map<string, {stateChangedAt: number, propagatedAt: number, detectedBy: Map<number, number>}>}
 */
const syncOperations = new Map();

/**
 * Log when state changed (start of sync tracking)
 * @param {string} syncId - Unique ID for this sync operation
 * @param {string} operation - Operation that caused the change
 * @returns {string} Sync ID for tracking
 */
export function logSyncStateChanged(syncId, operation) {
  const id = syncId || `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const timestamp = Date.now();

  syncOperations.set(id, {
    stateChangedAt: timestamp,
    operation,
    propagatedAt: null,
    detectedBy: new Map()
  });

  console.log(`${LOG_PREFIX.SYNC_LATENCY} STATE_CHANGED:`, {
    syncId: id,
    timestamp,
    operation
  });

  return id;
}

/**
 * Log when change propagated to storage
 * @param {string} syncId - Sync ID from logSyncStateChanged
 */
export function logSyncPropagatedToStorage(syncId) {
  const sync = syncOperations.get(syncId);
  if (!sync) return;

  const timestamp = Date.now();
  sync.propagatedAt = timestamp;

  console.log(`${LOG_PREFIX.SYNC_LATENCY} PROPAGATED_TO_STORAGE:`, {
    syncId,
    timestamp,
    latencyMs: timestamp - sync.stateChangedAt
  });
}

/**
 * Log when a tab detected the change
 * @param {string} syncId - Sync ID
 * @param {number} tabId - Tab ID that detected the change
 */
export function logSyncDetectedByTab(syncId, tabId) {
  const sync = syncOperations.get(syncId);
  if (!sync) return;

  const timestamp = Date.now();
  sync.detectedBy.set(tabId, timestamp);

  console.log(`${LOG_PREFIX.SYNC_LATENCY} DETECTED_BY_TAB:`, {
    syncId,
    tabId,
    timestamp,
    latencyFromChangeMs: timestamp - sync.stateChangedAt,
    latencyFromStorageMs: sync.propagatedAt ? timestamp - sync.propagatedAt : null,
    tabsDetected: sync.detectedBy.size
  });
}

/**
 * Log sync operation completion with total latency
 * @param {string} syncId - Sync ID
 */
export function logSyncComplete(syncId) {
  const sync = syncOperations.get(syncId);
  if (!sync) return;

  const timestamp = Date.now();
  const totalLatencyMs = timestamp - sync.stateChangedAt;

  // Calculate tab detection latencies
  const tabLatencies = [];
  for (const [tabId, detectedAt] of sync.detectedBy.entries()) {
    tabLatencies.push({
      tabId,
      latencyMs: detectedAt - sync.stateChangedAt
    });
  }

  const avgLatency =
    tabLatencies.length > 0
      ? tabLatencies.reduce((sum, t) => sum + t.latencyMs, 0) / tabLatencies.length
      : 0;

  console.log(`${LOG_PREFIX.SYNC_LATENCY} SYNC_COMPLETE:`, {
    syncId,
    timestamp,
    totalLatencyMs,
    operation: sync.operation,
    tabsDetected: sync.detectedBy.size,
    avgTabLatencyMs: Math.round(avgLatency),
    maxTabLatencyMs: tabLatencies.length > 0 ? Math.max(...tabLatencies.map(t => t.latencyMs)) : 0,
    withinTarget: totalLatencyMs < 500 // Target: <500ms
  });

  // Clean up
  syncOperations.delete(syncId);
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Safely serialize a value for logging
 * @private
 */
function _safeSerialize(value, maxLength) {
  try {
    return JSON.stringify(value).substring(0, maxLength);
  } catch (_err) {
    return '[Object]';
  }
}

/**
 * Sanitize a single parameter value
 * @private
 */
function _sanitizeParamValue(value) {
  if (typeof value === 'string' && value.length > 100) {
    return value.substring(0, 100) + '...';
  }
  if (typeof value === 'object' && value !== null) {
    return _safeSerialize(value, 100);
  }
  return value;
}

/**
 * Sanitize parameters for logging (remove sensitive data)
 * @private
 */
function _sanitizeParams(params) {
  if (!params || typeof params !== 'object') return {};

  const sensitiveKeys = ['password', 'token', 'secret'];
  const sanitized = {};

  for (const [key, value] of Object.entries(params)) {
    if (sensitiveKeys.includes(key.toLowerCase())) continue;
    sanitized[key] = _sanitizeParamValue(value);
  }
  return sanitized;
}

/**
 * Truncate response for logging
 * @private
 */
function _truncateResponse(response) {
  if (!response || typeof response !== 'object') return response;

  return {
    success: response.success,
    error: response.error?.substring?.(0, 100) || response.error,
    // Include other important fields but truncate large data
    ...(response.quickTabId && { quickTabId: response.quickTabId }),
    ...(response.tabCount !== undefined && { tabCount: response.tabCount })
  };
}

/**
 * Compute added IDs between old and new state
 * @private
 */
function _computeAddedIds(oldState, newState) {
  const oldIds = new Set((oldState?.tabs || []).map(t => t.id));
  const newIds = (newState?.tabs || []).map(t => t.id);
  return newIds.filter(id => !oldIds.has(id));
}

/**
 * Compute removed IDs between old and new state
 * @private
 */
function _computeRemovedIds(oldState, newState) {
  const newIds = new Set((newState?.tabs || []).map(t => t.id));
  const oldIds = (oldState?.tabs || []).map(t => t.id);
  return oldIds.filter(id => !newIds.has(id));
}
