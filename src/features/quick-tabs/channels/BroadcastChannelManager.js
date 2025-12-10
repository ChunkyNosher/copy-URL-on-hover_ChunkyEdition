/**
 * BroadcastChannelManager
 * Manages real-time messaging between tabs using BroadcastChannel API
 * v1.6.3.7-v3 - API #2: BroadcastChannel for instant sidebar updates
 * v1.6.4.13 - Issue #5: Enhanced logging for broadcast operations
 * v1.6.4.15 - Phase 3B Optimization #5: Backpressure protection
 * v1.6.3.7-v9 - Issue #7: Monotonic sequence counter for message loss detection
 *
 * Purpose: Provides instant messaging between tabs without full re-renders
 * BroadcastChannel is PRIMARY (fast), storage.onChanged is FALLBACK (reliable)
 *
 * Event Types:
 * - quick-tab-created: A new Quick Tab was created
 * - quick-tab-updated: An existing Quick Tab was updated
 * - quick-tab-deleted: A Quick Tab was deleted
 * - quick-tab-minimized: A Quick Tab was minimized
 * - quick-tab-restored: A Quick Tab was restored from minimized state
 * - broadcast-ack: Acknowledgment of received broadcast (backpressure)
 *
 * @module BroadcastChannelManager
 */

// Channel name for Quick Tab updates
const CHANNEL_NAME = 'quick-tabs-updates';

// Track whether BroadcastChannel is supported
let channelSupported = false;
let updateChannel = null;

// v1.6.4.13 - Issue #5: Debug flag for verbose logging
const DEBUG_BC_MESSAGING = true;

// ==================== v1.6.3.7-v9 SEQUENCE COUNTER (Issue #7) ====================
// Monotonic sequence counter for message loss detection

/**
 * Monotonic sequence counter for outgoing broadcasts
 * v1.6.3.7-v9 - Issue #7: Detect message coalescing/loss
 */
let _broadcastSequenceCounter = 0;

/**
 * Last received sequence number (for gap detection on receiver side)
 * v1.6.3.7-v9 - Issue #7: Track received sequence for gap detection
 */
let _lastReceivedSequenceNumber = 0;

/**
 * Time of last received broadcast message
 * v1.6.3.7-v9 - Issue #7: Detect stale state (no messages for >5s)
 */
let _lastBroadcastReceivedTime = Date.now();

/**
 * Callback for gap detection (set by listener)
 * v1.6.3.7-v9 - Issue #7: Notify listener of detected gaps
 */
let _gapDetectionCallback = null;

/**
 * Threshold for switching to polling-only mode (5 seconds)
 * v1.6.3.7-v9 - Issue #7: If no messages for this long, assume BC unreliable
 */
const NO_MESSAGE_POLLING_THRESHOLD_MS = 5000;

/**
 * Get the next sequence number for outgoing broadcast
 * v1.6.3.7-v9 - Issue #7: Generate monotonically increasing sequence
 * @returns {number} Next sequence number
 */
function _getNextSequenceNumber() {
  _broadcastSequenceCounter++;
  return _broadcastSequenceCounter;
}

/**
 * Get current broadcast sequence counter value (for diagnostics)
 * v1.6.3.7-v9 - Issue #7: Expose for logging/debugging
 * @returns {number} Current sequence counter
 */
export function getCurrentSequenceNumber() {
  return _broadcastSequenceCounter;
}

/**
 * Get last received sequence number (for diagnostics)
 * v1.6.3.7-v9 - Issue #7: Expose for logging/debugging
 * @returns {number} Last received sequence number
 */
export function getLastReceivedSequenceNumber() {
  return _lastReceivedSequenceNumber;
}

/**
 * Check if BroadcastChannel appears stale (no messages for >5s)
 * v1.6.3.7-v9 - Issue #7: Heuristic for polling-only mode
 * @returns {boolean} True if channel appears stale
 */
export function isBroadcastChannelStale() {
  return Date.now() - _lastBroadcastReceivedTime > NO_MESSAGE_POLLING_THRESHOLD_MS;
}

/**
 * Set callback for gap detection notification
 * v1.6.3.7-v9 - Issue #7: Allow listener to register gap handler
 * @param {Function} callback - Called with { expectedSeq, receivedSeq, gap } when gap detected
 */
export function setGapDetectionCallback(callback) {
  _gapDetectionCallback = callback;
}

/**
 * Safely invoke gap detection callback
 * v1.6.3.7-v9 - Issue #7: Extracted to reduce nesting depth
 * @private
 * @param {number} expectedSequence - Expected sequence number
 * @param {number} receivedSequence - Received sequence number
 * @param {number} gapSize - Size of the gap
 */
function _invokeGapDetectionCallback(expectedSequence, receivedSequence, gapSize) {
  if (!_gapDetectionCallback) {
    return;
  }
  
  try {
    _gapDetectionCallback({
      expectedSeq: expectedSequence,
      receivedSeq: receivedSequence,
      gap: gapSize
    });
  } catch (err) {
    console.error('[BroadcastChannelManager] Gap detection callback error:', err.message);
  }
}

/**
 * Process incoming sequence number and detect gaps
 * v1.6.3.7-v9 - Issue #7: Detect message coalescing/loss
 * @param {number} receivedSequence - Sequence number from received message
 * @returns {{ hasGap: boolean, gapSize: number, isFirstMessage: boolean }}
 */
export function processReceivedSequence(receivedSequence) {
  _lastBroadcastReceivedTime = Date.now();
  
  // First message - no gap possible
  if (_lastReceivedSequenceNumber === 0) {
    _lastReceivedSequenceNumber = receivedSequence;
    return { hasGap: false, gapSize: 0, isFirstMessage: true };
  }
  
  const expectedSequence = _lastReceivedSequenceNumber + 1;
  const hasGap = receivedSequence > expectedSequence;
  const gapSize = hasGap ? receivedSequence - expectedSequence : 0;
  
  if (hasGap) {
    console.warn('[BroadcastChannelManager] [BC] SEQUENCE_GAP_DETECTED:', {
      expectedSequence,
      receivedSequence,
      gapSize,
      missedMessages: gapSize,
      timestamp: Date.now()
    });
    
    // Notify listener of gap (extracted to reduce nesting)
    _invokeGapDetectionCallback(expectedSequence, receivedSequence, gapSize);
  }
  
  _lastReceivedSequenceNumber = receivedSequence;
  return { hasGap, gapSize, isFirstMessage: false };
}

/**
 * Reset sequence tracking (e.g., on channel reinit)
 * v1.6.3.7-v9 - Issue #7: Reset state for fresh start
 */
export function resetSequenceTracking() {
  _lastReceivedSequenceNumber = 0;
  _lastBroadcastReceivedTime = Date.now();
  console.log('[BroadcastChannelManager] [BC] Sequence tracking reset');
}

// ==================== v1.6.4.15 BACKPRESSURE CONSTANTS ====================
// Phase 3B Optimization #5: Broadcast overflow protection

// ACK timeout - if no ACK within this time, throttle future broadcasts
const ACK_TIMEOUT_MS = 500;

// Throttle duration when backpressure is detected
const THROTTLE_DURATION_MS = 1000;

// Maximum unacknowledged broadcasts before triggering backpressure
const MAX_UNACKED_BROADCASTS = 5;

// Repeated ACK timeout threshold before throttling
const REPEATED_ACK_TIMEOUT_THRESHOLD = 3;

// Per-client state tracking
const _clientState = new Map(); // clientId -> { lastAckTime, unackedCount, throttledUntil }

// Pending ACKs tracking
const _pendingAcks = new Map(); // messageId -> { timestamp, timeoutId }

// Global backpressure state
let _globalThrottledUntil = 0;
let _messageIdCounter = 0;

// Metrics
const _backpressureMetrics = {
  acksReceived: 0,
  acksTimedOut: 0,
  throttleEvents: 0,
  messagesDropped: 0
};

/**
 * Initialize the BroadcastChannel
 * v1.6.3.7-v3 - API #2: Create channel for real-time updates
 * @returns {boolean} True if channel was created successfully
 */
export function initBroadcastChannel() {
  // Check if BroadcastChannel is supported
  if (typeof BroadcastChannel === 'undefined') {
    console.warn('[BroadcastChannelManager] BroadcastChannel not supported in this environment');
    channelSupported = false;
    return false;
  }

  try {
    updateChannel = new BroadcastChannel(CHANNEL_NAME);
    channelSupported = true;
    console.log('[BroadcastChannelManager] BroadcastChannel created:', CHANNEL_NAME);
    return true;
  } catch (err) {
    console.error('[BroadcastChannelManager] Failed to create BroadcastChannel:', err.message);
    channelSupported = false;
    return false;
  }
}

/**
 * Check if BroadcastChannel is available
 * @returns {boolean} True if channel is ready
 */
export function isChannelAvailable() {
  return channelSupported && updateChannel !== null;
}

/**
 * Post a message to the BroadcastChannel
 * v1.6.3.7-v3 - API #2: Send targeted change events
 * v1.6.4.13 - Issue #5: Consolidated logging with success/failure status (single log)
 * v1.6.4.15 - Phase 3B: Updated to use backpressure-aware posting
 * @param {Object} message - Message to broadcast
 * @returns {boolean} True if message was sent
 */
function postMessage(message) {
  if (!isChannelAvailable()) {
    if (DEBUG_BC_MESSAGING) {
      console.warn('[BroadcastChannelManager] [BC] POST_FAILED: Channel not available', {
        type: message.type,
        quickTabId: message.quickTabId,
        success: false,
        timestamp: Date.now()
      });
    }
    return false;
  }

  // Use backpressure-aware posting for state-changing messages
  const requireAck = message.type === 'full-state-sync';
  return _postMessageWithBackpressure(message, requireAck);
}

/**
 * Broadcast Quick Tab created event
 * v1.6.3.7-v3 - API #2: Instant notification of new Quick Tab
 * v1.6.4.13 - Issue #5: Enhanced logging with [BC] prefix
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} data - Full Quick Tab data
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabCreated(quickTabId, data) {
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] [BC] BROADCAST_INITIATED: quick-tab-created', {
      quickTabId,
      hasData: !!data,
      timestamp: Date.now()
    });
  }
  return postMessage({
    type: 'quick-tab-created',
    quickTabId,
    data
  });
}

/**
 * Broadcast Quick Tab updated event
 * v1.6.3.7-v3 - API #2: Instant notification of Quick Tab change
 * v1.6.4.13 - Issue #5: Enhanced logging with [BC] prefix
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Only the changed properties
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabUpdated(quickTabId, changes) {
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] [BC] BROADCAST_INITIATED: quick-tab-updated', {
      quickTabId,
      changesKeys: changes ? Object.keys(changes) : [],
      timestamp: Date.now()
    });
  }
  return postMessage({
    type: 'quick-tab-updated',
    quickTabId,
    changes
  });
}

/**
 * Broadcast Quick Tab deleted event
 * v1.6.3.7-v3 - API #2: Instant notification of Quick Tab deletion
 * v1.6.4.13 - Issue #5: Enhanced logging with [BC] prefix
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabDeleted(quickTabId) {
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] [BC] BROADCAST_INITIATED: quick-tab-deleted', {
      quickTabId,
      timestamp: Date.now()
    });
  }
  return postMessage({
    type: 'quick-tab-deleted',
    quickTabId
  });
}

/**
 * Broadcast Quick Tab minimized event
 * v1.6.3.7-v3 - API #2: Instant notification of minimize
 * v1.6.4.13 - Issue #5: Enhanced logging with [BC] prefix
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabMinimized(quickTabId) {
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] [BC] BROADCAST_INITIATED: quick-tab-minimized', {
      quickTabId,
      timestamp: Date.now()
    });
  }
  return postMessage({
    type: 'quick-tab-minimized',
    quickTabId,
    changes: { minimized: true }
  });
}

/**
 * Broadcast Quick Tab restored event
 * v1.6.3.7-v3 - API #2: Instant notification of restore
 * v1.6.4.13 - Issue #5: Enhanced logging with [BC] prefix
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabRestored(quickTabId) {
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] [BC] BROADCAST_INITIATED: quick-tab-restored', {
      quickTabId,
      timestamp: Date.now()
    });
  }
  return postMessage({
    type: 'quick-tab-restored',
    quickTabId,
    changes: { minimized: false }
  });
}

/**
 * Broadcast full state sync event
 * v1.6.3.7-v7 - FIX Issue #6: Storage write confirmation via BroadcastChannel
 * v1.6.4.13 - Issue #5: Enhanced logging with [BC] prefix
 * Used to notify Manager when storage is updated with new state
 * @param {Object} state - Full state object with tabs array
 * @param {string} saveId - Save ID for deduplication
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastFullStateSync(state, saveId) {
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] [BC] BROADCAST_INITIATED: full-state-sync', {
      tabCount: state?.tabs?.length || 0,
      saveId,
      timestamp: Date.now()
    });
  }
  return postMessage({
    type: 'full-state-sync',
    state,
    saveId
  });
}

/**
 * Add listener for BroadcastChannel messages
 * v1.6.3.7-v3 - API #2: Listen for targeted updates from other tabs
 * @param {Function} handler - Message handler function (event) => void
 * @returns {boolean} True if listener was added
 */
export function addBroadcastListener(handler) {
  if (!isChannelAvailable()) {
    console.warn('[BroadcastChannelManager] Cannot add listener - channel not available');
    return false;
  }

  updateChannel.addEventListener('message', handler);
  console.log('[BroadcastChannelManager] Listener added');
  return true;
}

/**
 * Remove listener from BroadcastChannel
 * v1.6.3.7-v3 - API #2: Clean up listener
 * @param {Function} handler - Handler to remove
 * @returns {boolean} True if listener was removed
 */
export function removeBroadcastListener(handler) {
  if (!isChannelAvailable()) {
    return false;
  }

  updateChannel.removeEventListener('message', handler);
  console.log('[BroadcastChannelManager] Listener removed');
  return true;
}

/**
 * Close the BroadcastChannel
 * v1.6.3.7-v3 - API #2: Clean up channel resources
 */
export function closeBroadcastChannel() {
  if (updateChannel) {
    updateChannel.close();
    updateChannel = null;
    channelSupported = false;
    console.log('[BroadcastChannelManager] Channel closed');
  }
}

// Export default object with all methods
export default {
  initBroadcastChannel,
  isChannelAvailable,
  broadcastQuickTabCreated,
  broadcastQuickTabUpdated,
  broadcastQuickTabDeleted,
  broadcastQuickTabMinimized,
  broadcastQuickTabRestored,
  broadcastFullStateSync,
  addBroadcastListener,
  removeBroadcastListener,
  closeBroadcastChannel,
  // v1.6.4.15 - Backpressure exports
  sendAcknowledgment,
  handleIncomingAck,
  isThrottled,
  getBackpressureMetrics,
  resetBackpressureMetrics,
  getClientState,
  clearClientState,
  // v1.6.3.7-v9 - Issue #7: Sequence tracking exports
  getCurrentSequenceNumber,
  getLastReceivedSequenceNumber,
  isBroadcastChannelStale,
  setGapDetectionCallback,
  processReceivedSequence,
  resetSequenceTracking
};

// ==================== v1.6.4.15 BACKPRESSURE IMPLEMENTATION ====================
// Phase 3B Optimization #5: Broadcast overflow protection with ACK mechanism

/**
 * Generate unique message ID for ACK tracking
 * @private
 * @returns {string} Unique message ID
 */
function _generateMessageId() {
  _messageIdCounter++;
  return `bc-${Date.now()}-${_messageIdCounter}`;
}

/**
 * Check if broadcasts are currently throttled
 * @returns {boolean} True if throttled
 */
export function isThrottled() {
  return Date.now() < _globalThrottledUntil;
}

/**
 * Check if broadcasts should be allowed (backpressure check)
 * @private
 * @returns {{ allowed: boolean, reason: string }}
 */
function _shouldAllowBroadcast() {
  // Check global throttle
  if (isThrottled()) {
    return {
      allowed: false,
      reason: `Global throttle active (${_globalThrottledUntil - Date.now()}ms remaining)`
    };
  }

  // Check unacked broadcasts count
  if (_pendingAcks.size >= MAX_UNACKED_BROADCASTS) {
    _triggerThrottle('max_unacked_broadcasts');
    return {
      allowed: false,
      reason: `Too many unacked broadcasts (${_pendingAcks.size}/${MAX_UNACKED_BROADCASTS})`
    };
  }

  return { allowed: true, reason: 'ok' };
}

/**
 * Trigger throttling due to backpressure
 * @private
 * @param {string} reason - Reason for throttle
 */
function _triggerThrottle(reason) {
  _globalThrottledUntil = Date.now() + THROTTLE_DURATION_MS;
  _backpressureMetrics.throttleEvents++;

  if (DEBUG_BC_MESSAGING) {
    console.warn('[BroadcastChannelManager] [BC] BACKPRESSURE_THROTTLE:', {
      reason,
      throttleDurationMs: THROTTLE_DURATION_MS,
      pendingAcks: _pendingAcks.size,
      timestamp: Date.now()
    });
  }
}

/**
 * Register a pending ACK for a broadcast message
 * @private
 * @param {string} messageId - Message ID to track
 */
function _registerPendingAck(messageId) {
  // Set up timeout for ACK
  const timeoutId = setTimeout(() => {
    _handleAckTimeout(messageId);
  }, ACK_TIMEOUT_MS);

  _pendingAcks.set(messageId, {
    timestamp: Date.now(),
    timeoutId
  });
}

/**
 * Handle ACK timeout - no ACK received in time
 * @private
 * @param {string} messageId - Message ID that timed out
 */
function _handleAckTimeout(messageId) {
  const pending = _pendingAcks.get(messageId);
  if (!pending) return;

  _pendingAcks.delete(messageId);
  _backpressureMetrics.acksTimedOut++;

  if (DEBUG_BC_MESSAGING) {
    console.warn('[BroadcastChannelManager] [BC] ACK_TIMEOUT:', {
      messageId,
      timeoutMs: ACK_TIMEOUT_MS,
      pendingAcks: _pendingAcks.size
    });
  }

  // Consider throttling if too many timeouts
  const timeoutCount = _backpressureMetrics.acksTimedOut;
  if (timeoutCount > REPEATED_ACK_TIMEOUT_THRESHOLD &&
      timeoutCount % REPEATED_ACK_TIMEOUT_THRESHOLD === 0) {
    _triggerThrottle('repeated_ack_timeouts');
  }
}

/**
 * Send an acknowledgment for a received broadcast
 * Clients should call this after processing a broadcast message
 *
 * @param {string} originalMessageId - ID of the message being acknowledged
 * @param {string} [clientId] - Optional client identifier
 * @returns {boolean} True if ACK was sent
 */
export function sendAcknowledgment(originalMessageId, clientId = null) {
  if (!isChannelAvailable()) {
    return false;
  }

  try {
    updateChannel.postMessage({
      type: 'broadcast-ack',
      originalMessageId,
      clientId: clientId || 'unknown',
      timestamp: Date.now()
    });

    if (DEBUG_BC_MESSAGING) {
      console.log('[BroadcastChannelManager] [BC] ACK_SENT:', {
        originalMessageId,
        clientId
      });
    }

    return true;
  } catch (err) {
    console.error('[BroadcastChannelManager] Failed to send ACK:', err.message);
    return false;
  }
}

/**
 * Handle incoming acknowledgment from a client
 * Called by the broadcast sender when receiving ACK messages
 *
 * @param {Object} ackMessage - ACK message { originalMessageId, clientId, timestamp }
 */
export function handleIncomingAck(ackMessage) {
  if (!ackMessage || !ackMessage.originalMessageId) {
    return;
  }

  const { originalMessageId, clientId } = ackMessage;

  // Clear pending ACK
  const pending = _pendingAcks.get(originalMessageId);
  if (pending) {
    clearTimeout(pending.timeoutId);
    _pendingAcks.delete(originalMessageId);
    _backpressureMetrics.acksReceived++;

    if (DEBUG_BC_MESSAGING) {
      console.log('[BroadcastChannelManager] [BC] ACK_RECEIVED:', {
        originalMessageId,
        clientId,
        latencyMs: Date.now() - pending.timestamp,
        pendingAcks: _pendingAcks.size
      });
    }
  }

  // Update client state
  if (clientId) {
    const state = _clientState.get(clientId) || {
      lastAckTime: 0,
      unackedCount: 0,
      throttledUntil: 0
    };
    state.lastAckTime = Date.now();
    state.unackedCount = Math.max(0, state.unackedCount - 1);
    _clientState.set(clientId, state);
  }
}

/**
 * Get backpressure metrics
 * @returns {Object} Metrics object
 */
export function getBackpressureMetrics() {
  return {
    ..._backpressureMetrics,
    pendingAcks: _pendingAcks.size,
    isThrottled: isThrottled(),
    throttledUntil: _globalThrottledUntil,
    trackedClients: _clientState.size
  };
}

/**
 * Reset backpressure metrics
 */
export function resetBackpressureMetrics() {
  _backpressureMetrics.acksReceived = 0;
  _backpressureMetrics.acksTimedOut = 0;
  _backpressureMetrics.throttleEvents = 0;
  _backpressureMetrics.messagesDropped = 0;
}

/**
 * Get state for a specific client
 * @param {string} clientId - Client identifier
 * @returns {Object|null} Client state or null
 */
export function getClientState(clientId) {
  return _clientState.get(clientId) || null;
}

/**
 * Clear state for a specific client (e.g., when client disconnects)
 * @param {string} clientId - Client identifier
 */
export function clearClientState(clientId) {
  _clientState.delete(clientId);
}

/**
 * Post a message with backpressure protection
 * v1.6.4.15 - Enhanced with backpressure checks
 * v1.6.3.7-v9 - Issue #7: Added monotonic sequence number for message loss detection
 * @private
 * @param {Object} message - Message to broadcast
 * @param {boolean} [requireAck=false] - Whether to require ACK
 * @returns {boolean} True if message was sent
 */
function _postMessageWithBackpressure(message, requireAck = false) {
  // Check backpressure
  const backpressureCheck = _shouldAllowBroadcast();
  if (!backpressureCheck.allowed) {
    _backpressureMetrics.messagesDropped++;
    if (DEBUG_BC_MESSAGING) {
      console.warn('[BroadcastChannelManager] [BC] MESSAGE_DROPPED:', {
        type: message.type,
        reason: backpressureCheck.reason,
        quickTabId: message.quickTabId
      });
    }
    return false;
  }

  // Generate message ID for ACK tracking
  const messageId = _generateMessageId();
  // v1.6.3.7-v9 - Issue #7: Add monotonic sequence number
  const sequenceNumber = _getNextSequenceNumber();
  
  const messageWithMeta = {
    ...message,
    messageId,
    sequenceNumber, // v1.6.3.7-v9 - Issue #7: Monotonic sequence for gap detection
    timestamp: Date.now(),
    source: 'BroadcastChannelManager',
    requireAck
  };

  try {
    updateChannel.postMessage(messageWithMeta);

    // Register for ACK if required
    if (requireAck) {
      _registerPendingAck(messageId);
    }

    if (DEBUG_BC_MESSAGING) {
      console.log('[BroadcastChannelManager] [BC] POST_SUCCESS:', {
        type: message.type,
        messageId,
        sequenceNumber, // v1.6.3.7-v9 - Issue #7: Log sequence number
        quickTabId: message.quickTabId,
        requireAck,
        success: true,
        timestamp: Date.now()
      });
    }

    return true;
  } catch (err) {
    if (DEBUG_BC_MESSAGING) {
      console.error('[BroadcastChannelManager] [BC] POST_FAILED:', {
        type: message.type,
        quickTabId: message.quickTabId,
        sequenceNumber, // v1.6.3.7-v9 - Issue #7: Log sequence number even on failure
        error: err.message,
        success: false,
        timestamp: Date.now()
      });
    }
    return false;
  }
}
