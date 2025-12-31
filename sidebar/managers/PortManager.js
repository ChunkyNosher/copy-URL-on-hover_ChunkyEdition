/**
 * Port Manager Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Quick Tabs port connection to background
 * - Port message sending with timeout and fallback
 * - Circuit breaker for reconnection
 * - Port message validation
 * - ACK handling and roundtrip tracking
 *
 * @version 1.6.4
 *
 * v1.6.4 - Extracted from quick-tabs-manager.js for code health improvement
 *   - Port initialization and connection
 *   - Circuit breaker logic for reconnection
 *   - Message validation and filtering
 *   - ACK handlers and roundtrip tracking
 */

// ==================== CONSTANTS ====================

/**
 * Port reconnection circuit breaker max attempts
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
const QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS = 10;
const QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS = 1000;
const QUICK_TABS_PORT_RECONNECT_BACKOFF_MAX_MS = 30000;
const QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS = 60000;

/**
 * Port message sequence tracking
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
const SEQUENCE_GAP_WARNING_ENABLED = true;

// ==================== STATE ====================

/**
 * Quick Tabs port connection to background
 * @private
 */
let _quickTabsPort = null;

/**
 * Port reconnection state
 * @private
 */
let _reconnectAttempts = 0;
let _reconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
let _circuitBreakerTripped = false;
let _circuitBreakerTrippedAt = 0;
let _circuitBreakerAutoResetTimerId = null;

/**
 * Port message sequence tracking
 * @private
 */
let _lastReceivedSequence = 0;
let _sequenceGapsDetected = 0;

/**
 * Track sent Quick Tab port operations for roundtrip time calculation
 * Key: quickTabId, Value: { sentAt: number, messageType: string, correlationId: string }
 * @private
 */
const _portOperationTimestamps = new Map();

/**
 * External callbacks for Manager integration
 * @private
 */
let _externalCallbacks = {
  onStateUpdate: null,
  onPortConnect: null,
  onPortDisconnect: null,
  scheduleRender: null,
  requestAllQuickTabs: null,
  getLastCacheSyncFromStorage: null
};

// ==================== INITIALIZATION ====================

/**
 * Initialize the PortManager with external callbacks
 * v1.6.4 - REQUIRED: Must be called before using port functions
 * @param {Object} callbacks - External callbacks
 * @param {Function} callbacks.onStateUpdate - Called when state update received
 * @param {Function} callbacks.onPortConnect - Called when port connects
 * @param {Function} callbacks.onPortDisconnect - Called when port disconnects
 * @param {Function} callbacks.scheduleRender - Called to schedule UI render
 * @param {Function} callbacks.requestAllQuickTabs - Called to request all Quick Tabs
 * @param {Function} callbacks.getLastCacheSyncFromStorage - Get last cache sync timestamp
 */
function initialize(callbacks) {
  _externalCallbacks = { ...callbacks };
  console.log('[PortManager] Initialized with callbacks', {
    timestamp: Date.now(),
    callbacksProvided: Object.keys(callbacks).filter(k => !!callbacks[k])
  });
}

// ==================== CIRCUIT BREAKER ====================

/**
 * Check if circuit breaker is tripped
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 * @returns {boolean} True if circuit breaker is tripped
 */
function _checkCircuitBreakerTripped() {
  if (!_circuitBreakerTripped) return false;

  console.warn('[PortManager] CIRCUIT_BREAKER_OPEN:', {
    timestamp: Date.now(),
    attempts: _reconnectAttempts,
    maxAttempts: QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
    message: 'Connection attempts exhausted. Use manual reconnect button.'
  });
  return true;
}

/**
 * Reset circuit breaker state on successful connection
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _resetCircuitBreakerOnSuccess() {
  _reconnectAttempts = 0;
  _reconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
  _circuitBreakerTripped = false;
  _clearCircuitBreakerAutoResetTimer();
}

/**
 * Clear the circuit breaker auto-reset timer
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _clearCircuitBreakerAutoResetTimer() {
  if (_circuitBreakerAutoResetTimerId !== null) {
    clearTimeout(_circuitBreakerAutoResetTimerId);
    console.log('[PortManager] CIRCUIT_BREAKER_AUTO_RESET_TIMER_CLEARED:', {
      timestamp: Date.now(),
      reason: 'manual_reconnect_or_successful_connection'
    });
    _circuitBreakerAutoResetTimerId = null;
  }
}

/**
 * Execute circuit breaker auto-reset logic
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _executeCircuitBreakerAutoReset() {
  _circuitBreakerAutoResetTimerId = null;

  if (!_circuitBreakerTripped) {
    console.log('[PortManager] CIRCUIT_BREAKER_AUTO_RESET_SKIPPED: Already reset');
    return;
  }

  console.log('[PortManager] CIRCUIT_BREAKER_AUTO_RESET_TRIGGERED:', {
    timestamp: Date.now(),
    trippedDurationMs: Date.now() - _circuitBreakerTrippedAt,
    previousAttempts: _reconnectAttempts
  });

  _reconnectAttempts = 0;
  _reconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
  _circuitBreakerTripped = false;
  _circuitBreakerTrippedAt = 0;

  _removeErrorNotification();
  initializePort();
}

/**
 * Schedule automatic circuit breaker reset after timeout
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _scheduleCircuitBreakerAutoReset() {
  _clearCircuitBreakerAutoResetTimer();

  console.log('[PortManager] CIRCUIT_BREAKER_AUTO_RESET_SCHEDULED:', {
    timestamp: Date.now(),
    resetAfterMs: QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS,
    trippedAt: _circuitBreakerTrippedAt
  });

  _circuitBreakerAutoResetTimerId = setTimeout(
    _executeCircuitBreakerAutoReset,
    QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS
  );
}

// ==================== ERROR NOTIFICATION ====================

/**
 * Show error notification when port connection fails
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _showErrorNotification() {
  const errorMessage = 'Connection to background lost. Click to reconnect.';

  const notification = document.createElement('div');
  notification.id = 'quick-tabs-port-error-notification';
  notification.className = 'error-notification reconnect-available';
  notification.textContent = errorMessage;
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: #d32f2f;
    color: white;
    padding: 10px 16px;
    border-radius: 4px;
    z-index: 10000;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;

  notification.addEventListener('click', () => {
    manualReconnect();
    notification.remove();
  });

  const existing = document.getElementById('quick-tabs-port-error-notification');
  if (existing) {
    existing.remove();
  }

  document.body.appendChild(notification);

  console.log('[PortManager] ERROR_NOTIFICATION_SHOWN:', {
    timestamp: Date.now(),
    message: errorMessage,
    hasManualReconnect: true
  });
}

/**
 * Remove error notification from DOM
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _removeErrorNotification() {
  const notification = document.getElementById('quick-tabs-port-error-notification');
  if (notification) {
    notification.remove();
  }
}

// ==================== PORT CONNECTION ====================

/**
 * Handle port disconnect event
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _handlePortDisconnect() {
  const lastError = browser.runtime?.lastError;
  const disconnectTimestamp = Date.now();
  const lastCacheSync = _externalCallbacks.getLastCacheSyncFromStorage?.() ?? 0;

  console.warn('[PortManager] PORT_DISCONNECTED:', {
    reason: lastError?.message || 'unknown',
    errorCaptured: !!lastError,
    timestamp: disconnectTimestamp,
    pendingOperations: _portOperationTimestamps.size,
    portWasConnected: !!_quickTabsPort,
    cacheStalenessMs: disconnectTimestamp - lastCacheSync,
    reconnectAttempts: _reconnectAttempts
  });

  _quickTabsPort = null;
  _portOperationTimestamps.clear();

  if (_externalCallbacks.onPortDisconnect) {
    _externalCallbacks.onPortDisconnect();
  }

  _scheduleReconnect(disconnectTimestamp);
}

/**
 * Send SIDEBAR_READY message with fallback
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _sendSidebarReadyMessage() {
  const message = { type: 'SIDEBAR_READY', timestamp: Date.now() };
  try {
    _quickTabsPort.postMessage(message);
    console.log('[PortManager] SIDEBAR_READY sent via port');
  } catch (err) {
    console.warn('[PortManager] SIDEBAR_READY port failed, trying fallback:', err.message);
    browser.runtime
      .sendMessage({ ...message, source: 'sendMessage_fallback' })
      .then(() => console.log('[PortManager] SIDEBAR_READY sent via runtime.sendMessage fallback'))
      .catch(sendErr =>
        console.error('[PortManager] SIDEBAR_READY both methods failed:', {
          portError: err.message,
          sendMessageError: sendErr.message
        })
      );
  }
}

/**
 * Schedule port reconnection with exponential backoff
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 * @param {number} disconnectTimestamp - When disconnect occurred
 */
function _scheduleReconnect(disconnectTimestamp) {
  _reconnectAttempts++;

  if (_reconnectAttempts >= QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS) {
    _circuitBreakerTripped = true;
    _circuitBreakerTrippedAt = Date.now();

    console.error('[PortManager] CIRCUIT_BREAKER_TRIPPED:', {
      timestamp: Date.now(),
      attempts: _reconnectAttempts,
      maxAttempts: QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
      message: 'Max reconnection attempts reached.',
      autoResetAfterMs: QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS
    });

    _showErrorNotification();
    _scheduleCircuitBreakerAutoReset();
    return;
  }

  const backoffDelay = _reconnectBackoffMs;

  console.log('[PortManager] RECONNECT_SCHEDULED:', {
    timestamp: Date.now(),
    attempt: _reconnectAttempts,
    maxAttempts: QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
    backoffMs: backoffDelay,
    timeSinceDisconnect: Date.now() - disconnectTimestamp
  });

  setTimeout(() => {
    if (!_quickTabsPort && !_circuitBreakerTripped) {
      console.log('[PortManager] Attempting reconnection', {
        timestamp: Date.now(),
        attempt: _reconnectAttempts
      });
      initializePort();
    }
  }, backoffDelay);

  _reconnectBackoffMs = Math.min(_reconnectBackoffMs * 2, QUICK_TABS_PORT_RECONNECT_BACKOFF_MAX_MS);
}

/**
 * Initialize Quick Tabs port connection
 * v1.6.4 - Main port initialization function
 * @param {Function} [messageHandler] - Optional custom message handler
 */
function initializePort(messageHandler) {
  if (_checkCircuitBreakerTripped()) return;

  console.log('[PortManager] PORT_LIFECYCLE: Connection attempt starting', {
    timestamp: Date.now(),
    portName: 'quick-tabs-port',
    existingPort: !!_quickTabsPort,
    reconnectAttempt: _reconnectAttempts
  });

  try {
    _quickTabsPort = browser.runtime.connect({ name: 'quick-tabs-port' });
    _resetCircuitBreakerOnSuccess();

    console.log('[PortManager] PORT_LIFECYCLE: Connection established', {
      timestamp: Date.now(),
      portName: 'quick-tabs-port',
      success: true
    });

    if (messageHandler) {
      _quickTabsPort.onMessage.addListener(messageHandler);
    }
    _quickTabsPort.onDisconnect.addListener(_handlePortDisconnect);

    _sendSidebarReadyMessage();

    if (_externalCallbacks.onPortConnect) {
      _externalCallbacks.onPortConnect();
    }

    if (_externalCallbacks.requestAllQuickTabs) {
      console.log('[PortManager] Requesting initial state after port connection');
      _externalCallbacks.requestAllQuickTabs();
    }
  } catch (err) {
    console.error('[PortManager] PORT_LIFECYCLE: Connection failed', {
      timestamp: Date.now(),
      error: err.message,
      reconnectAttempt: _reconnectAttempts
    });
    _scheduleReconnect(Date.now());
  }
}

/**
 * Manual reconnection triggered by user
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
function manualReconnect() {
  console.log('[PortManager] MANUAL_RECONNECT:', {
    timestamp: Date.now(),
    previousAttempts: _reconnectAttempts,
    wasCircuitBreakerTripped: _circuitBreakerTripped
  });

  _clearCircuitBreakerAutoResetTimer();
  _reconnectAttempts = 0;
  _reconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
  _circuitBreakerTripped = false;
  _circuitBreakerTrippedAt = 0;

  initializePort();
}

// ==================== MESSAGE SENDING ====================

/**
 * Generate correlation ID for port operations
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 * @returns {string} Unique correlation ID
 */
function _generateCorrelationId() {
  return `port-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Execute sidebar port operation with error handling and fallback
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {string} messageType - Type of message to send
 * @param {Object} [payload={}] - Optional message payload
 * @returns {boolean} Success status
 */
function sendPortMessage(messageType, payload = {}) {
  const sentAt = Date.now();
  const correlationId = _generateCorrelationId();

  const message = {
    type: messageType,
    ...payload,
    timestamp: sentAt,
    correlationId
  };

  const quickTabId = payload.quickTabId || null;
  if (quickTabId) {
    _portOperationTimestamps.set(quickTabId, {
      sentAt,
      messageType,
      correlationId
    });
  }

  let portSucceeded = false;

  if (_quickTabsPort) {
    try {
      _quickTabsPort.postMessage(message);
      portSucceeded = true;
      console.log(`[PortManager] MESSAGE_SENT: ${messageType}`, {
        quickTabId,
        timestamp: sentAt,
        method: 'port'
      });
    } catch (err) {
      console.warn(
        `[PortManager] Port send failed for ${messageType}, trying fallback:`,
        err.message
      );
    }
  } else {
    console.warn(`[PortManager] Cannot ${messageType} via port - not connected, trying fallback`);
  }

  if (portSucceeded) {
    return true;
  }

  // Fallback to runtime.sendMessage
  browser.runtime
    .sendMessage({ ...message, source: 'sendMessage_fallback' })
    .then(() => {
      console.log(`[PortManager] ${messageType} sent via runtime.sendMessage fallback`, {
        quickTabId
      });
    })
    .catch(sendErr => {
      console.error(`[PortManager] ${messageType} both methods failed:`, {
        quickTabId,
        error: sendErr.message
      });
    });

  return false;
}

// ==================== VALIDATION ====================

/**
 * Check if message is a valid object
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {*} msg - Message to validate
 * @returns {boolean} True if valid
 */
function isValidMessageObject(msg) {
  return msg && typeof msg === 'object';
}

/**
 * Check if quickTabs field is valid
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {*} quickTabs - quickTabs field to validate
 * @returns {boolean} True if valid
 */
function isValidQuickTabsField(quickTabs) {
  return quickTabs === undefined || quickTabs === null || Array.isArray(quickTabs);
}

/**
 * Validate sequence number
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {*} sequence - Sequence number to validate
 * @returns {boolean} True if valid
 */
function isValidSequenceNumber(sequence) {
  return sequence === undefined || sequence === null || typeof sequence === 'number';
}

/**
 * Validate state update message
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Object} msg - Message to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateStateUpdateMessage(msg) {
  if (!isValidMessageObject(msg)) {
    return { valid: false, error: 'Message is not an object' };
  }
  if (!isValidQuickTabsField(msg.quickTabs)) {
    return { valid: false, error: `quickTabs field is not an array (got ${typeof msg.quickTabs})` };
  }
  if (!isValidSequenceNumber(msg.sequence)) {
    return { valid: false, error: `sequence field is not a number (got ${typeof msg.sequence})` };
  }
  return { valid: true };
}

/**
 * Validate ACK message
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Object} msg - Message to validate
 * @param {string} handlerName - Handler name for logging
 * @returns {{ valid: boolean, error?: string }}
 */
function validateAckMessage(msg, handlerName) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message is not an object' };
  }
  if (typeof msg.success !== 'boolean') {
    console.warn(
      `[PortManager] VALIDATION_WARN: ${handlerName} - success field missing or not boolean`
    );
  }
  return { valid: true };
}

/**
 * Log validation error
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {string} type - Message type
 * @param {Object} msg - Original message
 * @param {string} error - Error message
 */
function logValidationError(type, msg, error) {
  console.error('[PortManager] VALIDATION_ERROR:', {
    type,
    correlationId: msg?.correlationId || null,
    error
  });
}

// ==================== SEQUENCE TRACKING ====================

/**
 * Check message sequence for FIFO ordering detection
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {number|undefined} sequence - Message sequence number
 * @param {string} type - Message type for logging
 * @param {string|null} correlationId - Correlation ID
 * @returns {{ status: string, isOutOfOrder: boolean }}
 */
function checkMessageSequence(sequence, type, correlationId) {
  if (sequence === undefined || sequence === null) {
    return { status: 'no_sequence', isOutOfOrder: false };
  }

  const expectedSequence = _lastReceivedSequence + 1;
  const isOutOfOrder = sequence !== expectedSequence && _lastReceivedSequence > 0;

  if (isOutOfOrder) {
    _sequenceGapsDetected++;

    if (SEQUENCE_GAP_WARNING_ENABLED) {
      console.warn('[PortManager] OUT_OF_ORDER_MESSAGE:', {
        timestamp: Date.now(),
        type,
        correlationId: correlationId || null,
        expectedSequence,
        actualSequence: sequence,
        gap: sequence - expectedSequence,
        totalGapsDetected: _sequenceGapsDetected
      });
    }

    if (sequence > expectedSequence) {
      _lastReceivedSequence = sequence;
    }

    return { status: 'out_of_order', isOutOfOrder: true };
  }

  if (sequence > _lastReceivedSequence) {
    _lastReceivedSequence = sequence;
  }

  return { status: 'in_order', isOutOfOrder: false };
}

// ==================== ACK HANDLING ====================

/**
 * Build ACK log data
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Object} msg - ACK message
 * @param {Object|null} sentInfo - Sent operation info
 * @returns {Object} Log data
 */
function buildAckLogData(msg, sentInfo) {
  const { success, timestamp: responseTimestamp, correlationId: responseCorrelationId } = msg;
  const roundtripMs = sentInfo ? Date.now() - sentInfo.sentAt : null;
  return {
    success,
    roundtripMs,
    responseTimestamp,
    sentAt: sentInfo?.sentAt || null,
    sentCorrelationId: sentInfo?.correlationId || null,
    responseCorrelationId: responseCorrelationId || null,
    correlationMatch: sentInfo?.correlationId === responseCorrelationId
  };
}

/**
 * Handle Quick Tab port ACK
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Object} msg - ACK message
 * @param {string} ackType - Type of ACK
 * @param {Set} pendingOperations - Set of pending operations to update
 */
function handleAck(msg, ackType, pendingOperations) {
  const { quickTabId } = msg;
  const sentInfo = _portOperationTimestamps.get(quickTabId);

  console.log(`[PortManager] ACK_RECEIVED: ${ackType}`, {
    quickTabId,
    ...buildAckLogData(msg, sentInfo)
  });

  if (!quickTabId) return;

  _portOperationTimestamps.delete(quickTabId);

  const action = typeof ackType === 'string' ? ackType.toLowerCase() : '';
  if (!action) return;

  const operationKey = `${action}-${quickTabId}`;
  if (pendingOperations.delete(operationKey)) {
    console.log('[PortManager] PENDING_OPERATION_CLEARED_BY_ACK:', {
      operationKey,
      ackType,
      quickTabId
    });
  }
}

// ==================== STATE ACCESS ====================

/**
 * Get current port connection
 * @returns {Object|null} Current port or null
 */
function getPort() {
  return _quickTabsPort;
}

/**
 * Check if port is connected
 * @returns {boolean} True if connected
 */
function isConnected() {
  return !!_quickTabsPort;
}

/**
 * Check if circuit breaker is tripped
 * @returns {boolean} True if tripped
 */
function isCircuitBreakerTripped() {
  return _circuitBreakerTripped;
}

/**
 * Get port operation timestamps map
 * @returns {Map} Operation timestamps map
 */
function getOperationTimestamps() {
  return _portOperationTimestamps;
}

/**
 * Get reconnect attempts count
 * @returns {number} Reconnect attempts
 */
function getReconnectAttempts() {
  return _reconnectAttempts;
}

/**
 * Get sequence tracking state
 * @returns {{ lastSequence: number, gapsDetected: number }}
 */
function getSequenceState() {
  return {
    lastSequence: _lastReceivedSequence,
    gapsDetected: _sequenceGapsDetected
  };
}

/**
 * Reset sequence tracking (for testing)
 */
function resetSequenceTracking() {
  _lastReceivedSequence = 0;
  _sequenceGapsDetected = 0;
}

// ==================== EXPORTS ====================

export {
  // Initialization
  initialize,
  initializePort,
  manualReconnect,

  // Message sending
  sendPortMessage,
  _generateCorrelationId,

  // Validation
  isValidMessageObject,
  isValidQuickTabsField,
  isValidSequenceNumber,
  validateStateUpdateMessage,
  validateAckMessage,
  logValidationError,

  // Sequence tracking
  checkMessageSequence,
  resetSequenceTracking,
  getSequenceState,

  // ACK handling
  buildAckLogData,
  handleAck,

  // State access
  getPort,
  isConnected,
  isCircuitBreakerTripped,
  getOperationTimestamps,
  getReconnectAttempts,

  // Constants
  QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
  QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS,
  QUICK_TABS_PORT_RECONNECT_BACKOFF_MAX_MS,
  QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS,
  SEQUENCE_GAP_WARNING_ENABLED
};
