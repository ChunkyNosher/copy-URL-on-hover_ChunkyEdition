/**
 * BroadcastChannelManager
 * Manages real-time messaging between tabs using BroadcastChannel API
 * v1.6.3.7-v3 - API #2: BroadcastChannel for instant sidebar updates
 * v1.6.4.13 - Issue #5: Enhanced logging for broadcast operations
 * v1.6.4.15 - Phase 3B Optimization #5: Backpressure protection
 * v1.6.3.7-v9 - Issue #7: Monotonic sequence counter for message loss detection
 * v1.6.3.8-v2 - Issue #1, #10: Background Relay pattern for sidebar communication
 * v1.6.3.8-v5 - Issue #2: Cross-origin iframe BC verification and polling fallback
 *
 * Purpose: Provides instant messaging between tabs without full re-renders
 * BroadcastChannel is PRIMARY (fast), storage.onChanged is FALLBACK (reliable)
 *
 * v1.6.3.8-v5 - Cross-Origin Iframe Handling:
 * BroadcastChannel explicitly isolates channels by origin per W3C spec.
 * Cross-origin iframes (e.g., https://example.com) cannot receive BC messages
 * from moz-extension:// origin. This module provides:
 * - Per-iframe BC verification at initialization
 * - Explicit polling fallback with configurable intervals
 * - Polling success rate tracking
 * - Clear logging when BC is unavailable vs working
 *
 * v1.6.3.8-v2 - Sidebar Relay Pattern:
 * Firefox Sidebar runs in a separate origin context. BroadcastChannel messages
 * sent from content scripts never arrive in the sidebar, causing silent failure.
 * Solution: Background Relay (Content -> Background via Port -> Sidebar via Port)
 * - SIDEBAR_READY handshake protocol before routing messages
 * - BC_SIDEBAR_RELAY_ACTIVE log when relay pattern is active
 * - SIDEBAR_MESSAGE_DELIVERED/DROPPED logs for delivery status
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

// ==================== v1.6.3.8-v5 CROSS-ORIGIN IFRAME VERIFICATION ====================
// Issue #2: BroadcastChannel origin isolation - cross-origin iframes need fallback

/**
 * BC verification timeout for iframes (ms)
 * v1.6.3.8-v5 - Issue #2: Time to wait for iframe BC verification response
 */
const IFRAME_BC_VERIFICATION_TIMEOUT_MS = 1500;

/**
 * Polling fallback interval when BC unavailable (ms)
 * v1.6.3.8-v5 - Issue #2: Aggressive polling for faster sync
 */
const POLLING_FALLBACK_INTERVAL_MS = 2000;

/**
 * Aggressive polling interval when stale (ms)
 * v1.6.3.8-v5 - Issue #2: Even faster polling when channel appears stale
 */
const POLLING_AGGRESSIVE_INTERVAL_MS = 1000;

/**
 * Maximum polling retry count before giving up
 * v1.6.3.8-v5 - Issue #2: Prevent infinite polling loops
 */
const POLLING_MAX_RETRIES = 100;

/**
 * Track per-iframe BC verification status
 * v1.6.3.8-v5 - Issue #2: Map<iframeId, { verified: boolean, usingPolling: boolean, origin: string }>
 */
const _iframeVerificationStatus = new Map();

/**
 * Polling fallback state for cross-origin contexts
 * v1.6.3.8-v5 - Issue #2: Track polling fallback metrics
 */
const _pollingFallbackState = {
  active: false,
  intervalId: null,
  pollingCallback: null,
  retryCount: 0,
  successCount: 0,
  failureCount: 0,
  lastPollTime: 0,
  startTime: 0,
  intervalMs: POLLING_FALLBACK_INTERVAL_MS
};

/**
 * Polling metrics for success rate tracking
 * v1.6.3.8-v5 - Issue #2: Track polling effectiveness
 */
const _pollingMetrics = {
  totalPolls: 0,
  successfulPolls: 0,
  failedPolls: 0,
  avgLatencyMs: 0,
  latencySum: 0,
  lastSuccessTime: 0,
  lastFailureTime: 0,
  lastFailureReason: null
};

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
 * v1.6.3.7-v12 - Issue #1: Enhanced logging when BC is unavailable with context
 * @returns {boolean} True if channel was created successfully
 */
export function initBroadcastChannel() {
  // v1.6.3.7-v12 - Issue #1: Detect execution context for better diagnostics
  const executionContext = _detectExecutionContext();

  // Check if BroadcastChannel is supported
  if (typeof BroadcastChannel === 'undefined') {
    console.warn('[BroadcastChannelManager] [BC] INIT_UNAVAILABLE:', {
      reason: 'BroadcastChannel API not defined',
      context: executionContext,
      fallbackActivated: true,
      fallbackMechanism: 'port-based messaging and storage.onChanged polling',
      timestamp: Date.now()
    });
    channelSupported = false;
    return false;
  }

  try {
    updateChannel = new BroadcastChannel(CHANNEL_NAME);
    channelSupported = true;
    console.log('[BroadcastChannelManager] [BC] INIT_SUCCESS:', {
      channelName: CHANNEL_NAME,
      context: executionContext,
      timestamp: Date.now()
    });
    return true;
  } catch (err) {
    // v1.6.3.7-v12 - Issue #1: Log failure with detailed context
    console.error('[BroadcastChannelManager] [BC] INIT_FAILED:', {
      error: err.message,
      errorName: err.name,
      context: executionContext,
      channelName: CHANNEL_NAME,
      fallbackActivated: true,
      fallbackMechanism: 'port-based messaging and storage.onChanged polling',
      timestamp: Date.now()
    });
    channelSupported = false;
    return false;
  }
}

/**
 * Detect the current execution context (background, content, sidebar, etc.)
 * v1.6.3.7-v12 - Issue #1: Helper for context-aware logging
 * v1.6.3.7-v12 - FIX ESLint: Reduced complexity and max-depth
 * v1.6.3.7-v12 - FIX Code Review: Explicit null check for _getExecutionContextFromUrl()
 * @private
 * @returns {string} Execution context description
 */
function _detectExecutionContext() {
  try {
    const urlContext = _getExecutionContextFromUrl();
    // v1.6.3.7-v12 - FIX Code Review: Explicit null/undefined check
    if (urlContext !== null && urlContext !== undefined) return urlContext;

    if (_isBackgroundScript()) return 'background';

    return 'content-script';
  } catch (_err) {
    return 'unknown';
  }
}

/**
 * Get execution context from URL if window is available
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce _detectExecutionContext complexity
 * @private
 * @returns {string|null} Context string or null if not determinable from URL
 */
function _getExecutionContextFromUrl() {
  if (typeof window === 'undefined') return null;

  const url = window.location?.href || '';

  if (url.includes('sidebar/')) return 'sidebar';
  if (url.includes('popup')) return 'popup';
  if (url.includes('options_page')) return 'options';
  if (_isExtensionPageUrl(url)) return 'extension-page';

  return null;
}

/**
 * Check if URL is an extension page
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce max-depth
 * @private
 */
function _isExtensionPageUrl(url) {
  return url.includes('moz-extension://') || url.includes('chrome-extension://');
}

/**
 * Check if we're in a background script context
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
 * @private
 */
function _isBackgroundScript() {
  return typeof browser !== 'undefined' && browser.runtime && !window.document?.body;
}

/**
 * Check if BroadcastChannel is available
 * @returns {boolean} True if channel is ready
 */
export function isChannelAvailable() {
  return channelSupported && updateChannel !== null;
}

// ==================== v1.6.3.8-v5 CROSS-ORIGIN IFRAME BC VERIFICATION ====================
// Issue #2: Per-iframe BC verification and polling fallback

/**
 * Get current origin for comparison
 * v1.6.3.8-v5 - Issue #2: Helper to detect cross-origin scenarios
 * @private
 * @returns {string} Current window origin
 */
function _getCurrentOrigin() {
  try {
    return window.location?.origin || 'unknown';
  } catch (_err) {
    return 'unknown';
  }
}

/**
 * Check if current context is a cross-origin iframe
 * v1.6.3.8-v5 - Issue #2: Detect cross-origin iframe scenario
 * @returns {{ isCrossOrigin: boolean, parentOrigin: string|null, currentOrigin: string }}
 */
export function detectCrossOriginContext() {
  const currentOrigin = _getCurrentOrigin();
  const result = {
    isCrossOrigin: false,
    parentOrigin: null,
    currentOrigin,
    isIframe: false,
    isExtensionContext: currentOrigin.includes('moz-extension://') ||
                        currentOrigin.includes('chrome-extension://')
  };

  try {
    // Check if we're in an iframe
    result.isIframe = window.self !== window.top;
    if (result.isIframe) {
      _detectParentOrigin(result, currentOrigin);
    }
  } catch (_err) {
    // Error detecting context - assume cross-origin for safety
    result.isCrossOrigin = true;
  }

  return result;
}

/**
 * Detect parent origin for iframe context
 * v1.6.3.8-v5 - FIX ESLint: Extracted to reduce max-depth in detectCrossOriginContext
 * @private
 * @param {Object} result - Result object to update
 * @param {string} currentOrigin - Current window origin
 */
function _detectParentOrigin(result, currentOrigin) {
  try {
    result.parentOrigin = window.parent.location.origin;
    result.isCrossOrigin = result.parentOrigin !== currentOrigin;
  } catch (_crossOriginErr) {
    result.isCrossOrigin = true;
    result.parentOrigin = 'cross-origin-blocked';
  }
}

/**
 * Create failed verification result
 * v1.6.3.8-v5 - FIX ESLint: Helper to reduce verifyBroadcastChannelForIframe complexity
 * @private
 */
function _createFailedVerificationResult(origin, startTime, reason, method = 'none') {
  return {
    verified: false,
    origin,
    method,
    latencyMs: Date.now() - startTime,
    reason
  };
}

/**
 * Update iframe verification status
 * v1.6.3.8-v5 - FIX ESLint: Helper to reduce verifyBroadcastChannelForIframe complexity
 * @private
 */
function _updateIframeVerificationStatus(iframeId, verified, origin) {
  _iframeVerificationStatus.set(iframeId, {
    verified,
    usingPolling: !verified,
    origin,
    verifiedAt: Date.now()
  });
}

/**
 * Handle BC unavailable scenario
 * v1.6.3.8-v5 - FIX ESLint: Extracted from verifyBroadcastChannelForIframe
 * @private
 */
function _handleBCUnavailable(iframeId, contextInfo, startTime, onVerified) {
  const result = _createFailedVerificationResult(
    contextInfo.currentOrigin,
    startTime,
    'BroadcastChannel API not available'
  );

  _updateIframeVerificationStatus(iframeId, false, contextInfo.currentOrigin);

  console.warn('[BroadcastChannelManager] [BC] IFRAME_BC_UNAVAILABLE:', {
    iframeId,
    ...result,
    fallbackActivated: true,
    fallbackMethod: 'polling',
    timestamp: Date.now()
  });

  if (onVerified) onVerified(result);
  return result;
}

/**
 * Handle cross-origin iframe scenario
 * v1.6.3.8-v5 - FIX ESLint: Extracted from verifyBroadcastChannelForIframe
 * @private
 */
function _handleCrossOriginIframe(iframeId, contextInfo, startTime, onVerified) {
  const result = _createFailedVerificationResult(
    contextInfo.currentOrigin,
    startTime,
    'Cross-origin iframe cannot receive BC messages from extension context',
    'polling-fallback'
  );

  _updateIframeVerificationStatus(iframeId, false, contextInfo.currentOrigin);

  console.warn('[BroadcastChannelManager] [BC] IFRAME_CROSS_ORIGIN_DETECTED:', {
    iframeId,
    currentOrigin: contextInfo.currentOrigin,
    parentOrigin: contextInfo.parentOrigin,
    reason: 'W3C BroadcastChannel spec isolates channels by origin',
    consequence: 'Messages from moz-extension:// cannot reach https:// iframes',
    fallbackActivated: true,
    fallbackMethod: 'polling',
    pollingIntervalMs: POLLING_FALLBACK_INTERVAL_MS,
    timestamp: Date.now()
  });

  if (onVerified) onVerified(result);
  return result;
}

/**
 * Handle verification result
 * v1.6.3.8-v5 - FIX ESLint: Extracted from verifyBroadcastChannelForIframe
 * @private
 */
function _handleVerificationResult(iframeId, verificationResult, contextInfo, onVerified) {
  _updateIframeVerificationStatus(iframeId, verificationResult.verified, contextInfo.currentOrigin);

  if (verificationResult.verified) {
    console.log('[BroadcastChannelManager] [BC] IFRAME_VERIFICATION_SUCCESS:', {
      iframeId,
      ...verificationResult,
      timestamp: Date.now()
    });
  } else {
    console.warn('[BroadcastChannelManager] [BC] IFRAME_VERIFICATION_FAILED:', {
      iframeId,
      ...verificationResult,
      fallbackActivated: true,
      fallbackMethod: 'polling',
      timestamp: Date.now()
    });
  }

  if (onVerified) onVerified(verificationResult);
  return verificationResult;
}

/**
 * Handle verification error
 * v1.6.3.8-v5 - FIX ESLint: Extracted from verifyBroadcastChannelForIframe
 * @private
 */
function _handleVerificationError(iframeId, err, contextInfo, startTime, onVerified) {
  const result = _createFailedVerificationResult(
    contextInfo.currentOrigin,
    startTime,
    `Verification error: ${err.message}`,
    'polling-fallback'
  );

  _updateIframeVerificationStatus(iframeId, false, contextInfo.currentOrigin);

  console.error('[BroadcastChannelManager] [BC] IFRAME_VERIFICATION_ERROR:', {
    iframeId,
    error: err.message,
    fallbackActivated: true,
    timestamp: Date.now()
  });

  if (onVerified) onVerified(result);
  return result;
}

/**
 * Verify BroadcastChannel connectivity for current iframe context
 * v1.6.3.8-v5 - Issue #2: Verify BC works in this context before relying on it
 * v1.6.3.8-v5 - FIX ESLint: Refactored to reduce complexity (cc=10 → cc=5)
 * @param {string} iframeId - Unique identifier for this iframe/context
 * @param {Function} [onVerified] - Callback when verification completes
 * @returns {Promise<{ verified: boolean, origin: string, method: string, latencyMs: number }>}
 */
export async function verifyBroadcastChannelForIframe(iframeId, onVerified) {
  const startTime = Date.now();
  const contextInfo = detectCrossOriginContext();

  console.log('[BroadcastChannelManager] [BC] IFRAME_VERIFICATION_STARTED:', {
    iframeId,
    currentOrigin: contextInfo.currentOrigin,
    isIframe: contextInfo.isIframe,
    isCrossOrigin: contextInfo.isCrossOrigin,
    isExtensionContext: contextInfo.isExtensionContext,
    timeoutMs: IFRAME_BC_VERIFICATION_TIMEOUT_MS,
    timestamp: startTime
  });

  // If BC API not available, immediately fail verification
  if (!isChannelAvailable()) {
    return _handleBCUnavailable(iframeId, contextInfo, startTime, onVerified);
  }

  // If we're in a cross-origin iframe, BC won't work across origins
  if (contextInfo.isCrossOrigin && !contextInfo.isExtensionContext) {
    return _handleCrossOriginIframe(iframeId, contextInfo, startTime, onVerified);
  }

  // Attempt bidirectional BC verification via ping-pong
  try {
    const verificationResult = await _performBCVerificationPingPong(iframeId, startTime);
    return _handleVerificationResult(iframeId, verificationResult, contextInfo, onVerified);
  } catch (err) {
    return _handleVerificationError(iframeId, err, contextInfo, startTime, onVerified);
  }
}

/**
 * Perform BC verification ping-pong with background
 * v1.6.3.8-v5 - Issue #2: Verify bidirectional BC communication
 * @private
 * @param {string} iframeId - Iframe identifier
 * @param {number} startTime - Verification start time
 * @returns {Promise<{ verified: boolean, method: string, latencyMs: number }>}
 */
function _performBCVerificationPingPong(iframeId, startTime) {
  return new Promise((resolve) => {
    const verificationId = `bc-iframe-verify-${iframeId}-${Date.now()}`;
    let timeoutId = null;
    let messageHandler = null;

    // Handler for verification response
    messageHandler = (event) => {
      const data = event.data;
      if (data && data.type === 'BC_IFRAME_VERIFICATION_PONG' &&
          data.verificationId === verificationId) {
        clearTimeout(timeoutId);
        if (updateChannel) {
          updateChannel.removeEventListener('message', messageHandler);
        }

        resolve({
          verified: true,
          method: 'broadcast-channel',
          latencyMs: Date.now() - startTime,
          origin: _getCurrentOrigin()
        });
      }
    };

    // Set timeout for verification
    timeoutId = setTimeout(() => {
      if (updateChannel) {
        updateChannel.removeEventListener('message', messageHandler);
      }

      resolve({
        verified: false,
        method: 'polling-fallback',
        latencyMs: Date.now() - startTime,
        reason: 'Verification timeout - no PONG received',
        origin: _getCurrentOrigin()
      });
    }, IFRAME_BC_VERIFICATION_TIMEOUT_MS);

    // Add listener and send verification ping
    if (updateChannel) {
      updateChannel.addEventListener('message', messageHandler);
      updateChannel.postMessage({
        type: 'BC_IFRAME_VERIFICATION_PING',
        verificationId,
        iframeId,
        origin: _getCurrentOrigin(),
        timestamp: Date.now()
      });
    } else {
      clearTimeout(timeoutId);
      resolve({
        verified: false,
        method: 'polling-fallback',
        latencyMs: Date.now() - startTime,
        reason: 'No update channel available',
        origin: _getCurrentOrigin()
      });
    }
  });
}

/**
 * Get verification status for an iframe
 * v1.6.3.8-v5 - Issue #2: Check if iframe has been verified
 * @param {string} iframeId - Iframe identifier
 * @returns {{ verified: boolean, usingPolling: boolean, origin: string }|null}
 */
export function getIframeVerificationStatus(iframeId) {
  return _iframeVerificationStatus.get(iframeId) || null;
}

/**
 * Check if an iframe is using polling fallback
 * v1.6.3.8-v5 - Issue #2: Quick check for polling mode
 * @param {string} iframeId - Iframe identifier
 * @returns {boolean} True if using polling fallback
 */
export function isIframeUsingPolling(iframeId) {
  const status = _iframeVerificationStatus.get(iframeId);
  return status ? status.usingPolling : false;
}

// ==================== v1.6.3.8-v5 POLLING FALLBACK MECHANISM ====================
// Issue #2: Aggressive polling fallback for cross-origin iframes

/**
 * Start polling fallback for state synchronization
 * v1.6.3.8-v5 - Issue #2: Activate polling when BC unavailable
 * @param {Function} pollCallback - Callback to execute on each poll: () => Promise<{ success: boolean, data?: any }>
 * @param {Object} [options] - Polling options
 * @param {number} [options.intervalMs] - Polling interval in milliseconds
 * @param {boolean} [options.aggressive] - Use aggressive (faster) polling
 * @returns {{ started: boolean, intervalMs: number }}
 */
export function startPollingFallback(pollCallback, options = {}) {
  // Stop any existing polling
  stopPollingFallback();

  const intervalMs = options.aggressive
    ? POLLING_AGGRESSIVE_INTERVAL_MS
    : (options.intervalMs || POLLING_FALLBACK_INTERVAL_MS);

  _pollingFallbackState.active = true;
  _pollingFallbackState.pollingCallback = pollCallback;
  _pollingFallbackState.retryCount = 0;
  _pollingFallbackState.startTime = Date.now();
  _pollingFallbackState.intervalMs = intervalMs;

  console.log('[BroadcastChannelManager] [POLLING] FALLBACK_STARTED:', {
    intervalMs,
    aggressive: options.aggressive || false,
    maxRetries: POLLING_MAX_RETRIES,
    reason: 'BroadcastChannel unavailable for this context',
    timestamp: Date.now()
  });

  // Start polling interval
  _pollingFallbackState.intervalId = setInterval(async () => {
    await _executePollCycle();
  }, intervalMs);

  // Execute first poll immediately
  _executePollCycle();

  return { started: true, intervalMs };
}

/**
 * Handle successful poll result
 * v1.6.3.8-v5 - FIX ESLint: Extracted to reduce _executePollCycle complexity
 * @private
 * @param {number} latencyMs - Poll latency in milliseconds
 */
function _handlePollSuccess(latencyMs) {
  _pollingFallbackState.successCount++;
  _pollingMetrics.successfulPolls++;
  _pollingMetrics.lastSuccessTime = Date.now();
  _pollingMetrics.latencySum += latencyMs;

  // Update average latency
  _pollingMetrics.avgLatencyMs = Math.round(
    _pollingMetrics.latencySum / _pollingMetrics.successfulPolls
  );

  // Log every 10th successful poll to avoid spam
  const shouldLog = DEBUG_BC_MESSAGING && _pollingMetrics.successfulPolls % 10 === 0;
  if (shouldLog) {
    console.log('[BroadcastChannelManager] [POLLING] POLL_HEALTH:', {
      successfulPolls: _pollingMetrics.successfulPolls,
      failedPolls: _pollingMetrics.failedPolls,
      successRate: getPollingSuccessRate(),
      avgLatencyMs: _pollingMetrics.avgLatencyMs,
      intervalMs: _pollingFallbackState.intervalMs,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle failed poll result
 * v1.6.3.8-v5 - FIX ESLint: Extracted to reduce _executePollCycle complexity
 * @private
 * @param {string} reason - Failure reason
 * @param {number} latencyMs - Poll latency in milliseconds
 */
function _handlePollFailure(reason, latencyMs) {
  _pollingFallbackState.failureCount++;
  _pollingMetrics.failedPolls++;
  _pollingMetrics.lastFailureTime = Date.now();
  _pollingMetrics.lastFailureReason = reason;

  console.warn('[BroadcastChannelManager] [POLLING] POLL_FAILED:', {
    retryCount: _pollingFallbackState.retryCount,
    failureCount: _pollingFallbackState.failureCount,
    reason,
    latencyMs,
    timestamp: Date.now()
  });
}

/**
 * Execute a single poll cycle
 * v1.6.3.8-v5 - Issue #2: Individual poll execution with metrics
 * v1.6.3.8-v5 - FIX ESLint: Refactored to reduce complexity (cc=10 → cc=6)
 * @private
 */
async function _executePollCycle() {
  if (!_pollingFallbackState.active || !_pollingFallbackState.pollingCallback) {
    return;
  }

  // Check retry limit
  if (_pollingFallbackState.retryCount >= POLLING_MAX_RETRIES) {
    console.error('[BroadcastChannelManager] [POLLING] MAX_RETRIES_REACHED:', {
      retryCount: _pollingFallbackState.retryCount,
      maxRetries: POLLING_MAX_RETRIES,
      successRate: getPollingSuccessRate(),
      action: 'Stopping polling fallback',
      timestamp: Date.now()
    });
    stopPollingFallback();
    return;
  }

  const pollStartTime = Date.now();
  _pollingFallbackState.lastPollTime = pollStartTime;
  _pollingMetrics.totalPolls++;
  _pollingFallbackState.retryCount++;

  try {
    const result = await _pollingFallbackState.pollingCallback();
    const latencyMs = Date.now() - pollStartTime;

    if (result && result.success) {
      _handlePollSuccess(latencyMs);
    } else {
      _handlePollFailure(result?.error || 'Unknown error', latencyMs);
    }
  } catch (err) {
    _handlePollFailure(err.message, Date.now() - pollStartTime);
    console.error('[BroadcastChannelManager] [POLLING] POLL_ERROR:', {
      error: err.message,
      retryCount: _pollingFallbackState.retryCount,
      failureCount: _pollingFallbackState.failureCount,
      timestamp: Date.now()
    });
  }
}

/**
 * Stop polling fallback
 * v1.6.3.8-v5 - Issue #2: Clean up polling resources
 * @returns {{ stopped: boolean, stats: Object }}
 */
export function stopPollingFallback() {
  if (!_pollingFallbackState.active) {
    return { stopped: false, stats: null };
  }

  if (_pollingFallbackState.intervalId) {
    clearInterval(_pollingFallbackState.intervalId);
    _pollingFallbackState.intervalId = null;
  }

  const stats = {
    durationMs: Date.now() - _pollingFallbackState.startTime,
    totalPolls: _pollingFallbackState.retryCount,
    successCount: _pollingFallbackState.successCount,
    failureCount: _pollingFallbackState.failureCount,
    successRate: getPollingSuccessRate(),
    avgLatencyMs: _pollingMetrics.avgLatencyMs
  };

  console.log('[BroadcastChannelManager] [POLLING] FALLBACK_STOPPED:', {
    ...stats,
    timestamp: Date.now()
  });

  _pollingFallbackState.active = false;
  _pollingFallbackState.pollingCallback = null;

  return { stopped: true, stats };
}

/**
 * Check if polling fallback is active
 * v1.6.3.8-v5 - Issue #2: Query polling state
 * @returns {boolean} True if polling is active
 */
export function isPollingFallbackActive() {
  return _pollingFallbackState.active;
}

/**
 * Get polling success rate
 * v1.6.3.8-v5 - Issue #2: Calculate success percentage
 * @returns {string} Success rate as percentage string (e.g., "95.5%")
 */
export function getPollingSuccessRate() {
  if (_pollingMetrics.totalPolls === 0) return 'N/A';
  const rate = (_pollingMetrics.successfulPolls / _pollingMetrics.totalPolls) * 100;
  return `${rate.toFixed(1)}%`;
}

/**
 * Get comprehensive polling metrics
 * v1.6.3.8-v5 - Issue #2: Full metrics for diagnostics
 * @returns {Object} Polling metrics object
 */
export function getPollingMetrics() {
  return {
    ..._pollingMetrics,
    successRate: getPollingSuccessRate(),
    isActive: _pollingFallbackState.active,
    currentIntervalMs: _pollingFallbackState.intervalMs,
    uptimeMs: _pollingFallbackState.active
      ? Date.now() - _pollingFallbackState.startTime
      : 0,
    retryCount: _pollingFallbackState.retryCount,
    maxRetries: POLLING_MAX_RETRIES
  };
}

/**
 * Reset polling metrics
 * v1.6.3.8-v5 - Issue #2: Clear metrics for fresh start
 */
export function resetPollingMetrics() {
  _pollingMetrics.totalPolls = 0;
  _pollingMetrics.successfulPolls = 0;
  _pollingMetrics.failedPolls = 0;
  _pollingMetrics.avgLatencyMs = 0;
  _pollingMetrics.latencySum = 0;
  _pollingMetrics.lastSuccessTime = 0;
  _pollingMetrics.lastFailureTime = 0;
  _pollingMetrics.lastFailureReason = null;

  console.log('[BroadcastChannelManager] [POLLING] METRICS_RESET:', {
    timestamp: Date.now()
  });
}

/**
 * Log current communication method being used
 * v1.6.3.8-v5 - Issue #2: Clear indication of active method
 * @param {string} contextId - Identifier for the context (iframe/sidebar)
 */
export function logCommunicationMethod(contextId) {
  const status = _iframeVerificationStatus.get(contextId);
  const contextInfo = detectCrossOriginContext();

  const method = status?.verified
    ? 'broadcast-channel'
    : (_pollingFallbackState.active ? 'polling-fallback' : 'storage-events');

  console.log('[BroadcastChannelManager] [BC] COMMUNICATION_METHOD:', {
    contextId,
    method,
    bcVerified: status?.verified || false,
    pollingActive: _pollingFallbackState.active,
    isCrossOrigin: contextInfo.isCrossOrigin,
    currentOrigin: contextInfo.currentOrigin,
    pollingMetrics: _pollingFallbackState.active ? {
      successRate: getPollingSuccessRate(),
      intervalMs: _pollingFallbackState.intervalMs,
      avgLatencyMs: _pollingMetrics.avgLatencyMs
    } : null,
    timestamp: Date.now()
  });

  return method;
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

// ==================== v1.6.3.8-v2 SIDEBAR RELAY PATTERN ====================
// Issue #1 & #10: Firefox Sidebar runs in separate origin context
// BroadcastChannel messages sent from content scripts never arrive in sidebar
// Solution: Background Relay Pattern - Content -> Background -> Sidebar via Port

/**
 * Track sidebar ready state for relay routing
 * v1.6.3.8-v2 - Issue #1: SIDEBAR_READY handshake protocol
 */
let _sidebarReady = false;

/**
 * Callback to send messages via background relay
 * v1.6.3.8-v2 - Issue #1: Set by content script or sidebar
 * @type {Function|null}
 */
let _backgroundRelayCallback = null;

/**
 * Track whether relay is active (BC failed verification)
 * v1.6.3.8-v2 - Issue #1: Logged as BC_SIDEBAR_RELAY_ACTIVE
 */
let _sidebarRelayActive = false;

/**
 * Check if sidebar relay pattern is active
 * v1.6.3.8-v2 - Issue #1: Returns true when using relay instead of direct BC
 * @returns {boolean} True if relay pattern is active
 */
export function isSidebarRelayActive() {
  return _sidebarRelayActive;
}

/**
 * Mark sidebar as ready to receive messages
 * v1.6.3.8-v2 - Issue #1 & #10: Called when sidebar sends SIDEBAR_READY signal
 * @param {boolean} ready - Whether sidebar is ready
 */
export function setSidebarReady(ready) {
  _sidebarReady = ready;
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] SIDEBAR_READY_STATE:', {
      ready,
      timestamp: Date.now()
    });
  }
}

/**
 * Check if sidebar is ready to receive messages
 * v1.6.3.8-v2 - Issue #10: Used before routing messages
 * @returns {boolean} True if sidebar has signaled ready
 */
export function isSidebarReady() {
  return _sidebarReady;
}

/**
 * Set callback for background relay messaging
 * v1.6.3.8-v2 - Issue #1: Register relay function
 * @param {Function} callback - Function to send message via background: (message) => Promise<void>
 */
export function setBackgroundRelayCallback(callback) {
  _backgroundRelayCallback = callback;
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] RELAY_CALLBACK_SET:', {
      hasCallback: !!callback,
      timestamp: Date.now()
    });
  }
}

/**
 * Activate sidebar relay pattern
 * v1.6.3.8-v2 - Issue #1: Called when BC verification fails
 * Routes all sidebar-bound messages through background
 */
export function activateSidebarRelay() {
  _sidebarRelayActive = true;
  console.log('[BroadcastChannelManager] BC_SIDEBAR_RELAY_ACTIVE:', {
    reason: 'BroadcastChannel cannot reach sidebar context',
    fallback: 'Using Background Relay (Content -> Background -> Sidebar)',
    timestamp: Date.now()
  });
}

/**
 * Deactivate sidebar relay pattern
 * v1.6.3.8-v2 - Issue #1: Called if BC starts working
 */
export function deactivateSidebarRelay() {
  _sidebarRelayActive = false;
  if (DEBUG_BC_MESSAGING) {
    console.log('[BroadcastChannelManager] SIDEBAR_RELAY_DEACTIVATED:', {
      reason: 'BroadcastChannel is working',
      timestamp: Date.now()
    });
  }
}

/**
 * Send message to sidebar via background relay
 * v1.6.3.8-v2 - Issue #1 & #10: Used when BC cannot reach sidebar
 * @param {Object} message - Message to send
 * @returns {Promise<{ delivered: boolean, method: string }>} Delivery result
 */
export async function sendToSidebarViaRelay(message) {
  if (!_backgroundRelayCallback) {
    console.warn('[BroadcastChannelManager] SIDEBAR_MESSAGE_DROPPED:', {
      reason: 'No relay callback registered',
      messageType: message.type,
      timestamp: Date.now()
    });
    return { delivered: false, method: 'none' };
  }

  // Check if sidebar is ready
  if (!_sidebarReady) {
    console.warn('[BroadcastChannelManager] SIDEBAR_MESSAGE_DROPPED:', {
      reason: 'Sidebar not ready (no SIDEBAR_READY signal)',
      messageType: message.type,
      timestamp: Date.now()
    });
    return { delivered: false, method: 'none' };
  }

  try {
    // Add relay metadata
    const relayMessage = {
      ...message,
      _relayed: true,
      _relayTimestamp: Date.now()
    };

    await _backgroundRelayCallback(relayMessage);

    if (DEBUG_BC_MESSAGING) {
      console.log('[BroadcastChannelManager] SIDEBAR_MESSAGE_DELIVERED:', {
        messageType: message.type,
        method: 'background-relay',
        quickTabId: message.quickTabId,
        timestamp: Date.now()
      });
    }

    return { delivered: true, method: 'background-relay' };
  } catch (err) {
    console.error('[BroadcastChannelManager] SIDEBAR_MESSAGE_DROPPED:', {
      reason: `Relay callback error: ${err.message}`,
      messageType: message.type,
      timestamp: Date.now()
    });
    return { delivered: false, method: 'none' };
  }
}

/**
 * Smart broadcast that uses relay for sidebar when needed
 * v1.6.3.8-v2 - Issue #1 & #10: Hybrid broadcast with relay fallback
 * @param {Object} message - Message to broadcast
 * @param {boolean} [requireAck=false] - Whether to require ACK
 * @returns {Promise<{ bcSent: boolean, relaySent: boolean }>} Broadcast result
 */
export async function smartBroadcast(message, requireAck = false) {
  const result = { bcSent: false, relaySent: false };

  // Always try BroadcastChannel for same-origin tabs
  if (isChannelAvailable()) {
    result.bcSent = _postMessageWithBackpressure(message, requireAck);
  }

  // Use relay for sidebar if relay is active
  if (_sidebarRelayActive && _backgroundRelayCallback) {
    const relayResult = await sendToSidebarViaRelay(message);
    result.relaySent = relayResult.delivered;
  }

  return result;
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
  resetSequenceTracking,
  // v1.6.3.8-v2 - Issue #1 & #10: Sidebar relay exports
  isSidebarRelayActive,
  setSidebarReady,
  isSidebarReady,
  setBackgroundRelayCallback,
  activateSidebarRelay,
  deactivateSidebarRelay,
  sendToSidebarViaRelay,
  smartBroadcast,
  // v1.6.3.8-v5 - Issue #2: Cross-origin iframe verification exports
  detectCrossOriginContext,
  verifyBroadcastChannelForIframe,
  getIframeVerificationStatus,
  isIframeUsingPolling,
  startPollingFallback,
  stopPollingFallback,
  isPollingFallbackActive,
  getPollingSuccessRate,
  getPollingMetrics,
  resetPollingMetrics,
  logCommunicationMethod
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
  if (
    timeoutCount > REPEATED_ACK_TIMEOUT_THRESHOLD &&
    timeoutCount % REPEATED_ACK_TIMEOUT_THRESHOLD === 0
  ) {
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
