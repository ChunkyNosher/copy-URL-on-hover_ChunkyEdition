/**
 * BroadcastChannelManager - NO-OP STUB IMPLEMENTATION
 *
 * v1.6.3.8-v5 - ARCHITECTURE: BroadcastChannel removed per architecture-redesign.md
 * This file contains NO-OP stub functions for backwards compatibility only.
 * The new architecture uses:
 * - Layer 1a: runtime.Port for real-time metadata sync (PRIMARY)
 * - Layer 2: storage.local with monotonic revision versioning + storage.onChanged (FALLBACK)
 *
 * BroadcastChannel was removed because:
 * 1. Firefox Sidebar runs in separate origin context - BC messages never arrive
 * 2. Cross-origin iframes cannot receive BC messages due to W3C spec origin isolation
 * 3. Port-based messaging is more reliable and works across all contexts
 * 4. storage.onChanged provides reliable fallback for all scenarios
 *
 * This file now exports NO-OP stubs for backwards compatibility.
 * All functions return false/null to indicate BC is unavailable.
 *
 * @module BroadcastChannelManager
 * @deprecated Use runtime.Port messaging instead
 */

// ==================== STUB EXPORTS ====================
// All functions are no-ops that return false/null for backwards compatibility

/**
 * Initialize BroadcastChannel - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function initBroadcastChannel() {
  console.log('[BroadcastChannelManager] [DEPRECATED] initBroadcastChannel called - BC removed per architecture-redesign.md');
  return false;
}

/**
 * Check if channel is available - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function isChannelAvailable() {
  return false;
}

/**
 * Broadcast Quick Tab created - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function broadcastQuickTabCreated() {
  return false;
}

/**
 * Broadcast Quick Tab updated - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function broadcastQuickTabUpdated() {
  return false;
}

/**
 * Broadcast Quick Tab deleted - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function broadcastQuickTabDeleted() {
  return false;
}

/**
 * Broadcast Quick Tab minimized - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function broadcastQuickTabMinimized() {
  return false;
}

/**
 * Broadcast Quick Tab restored - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function broadcastQuickTabRestored() {
  return false;
}

/**
 * Broadcast full state sync - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function broadcastFullStateSync() {
  return false;
}

/**
 * Add broadcast listener - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function addBroadcastListener() {
  return false;
}

/**
 * Remove broadcast listener - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed - use runtime.Port
 */
export function removeBroadcastListener() {
  return false;
}

/**
 * Close broadcast channel - NO-OP STUB
 * @deprecated BC removed - use runtime.Port
 */
export function closeBroadcastChannel() {
  // No-op
}

// ==================== SEQUENCE TRACKING STUBS ====================

/**
 * Get current sequence number - NO-OP STUB
 * @returns {number} Always returns 0 (BC removed)
 * @deprecated BC removed
 */
export function getCurrentSequenceNumber() {
  return 0;
}

/**
 * Get last received sequence number - NO-OP STUB
 * @returns {number} Always returns 0 (BC removed)
 * @deprecated BC removed
 */
export function getLastReceivedSequenceNumber() {
  return 0;
}

/**
 * Check if BC is stale - NO-OP STUB
 * @returns {boolean} Always returns true (BC removed)
 * @deprecated BC removed
 */
export function isBroadcastChannelStale() {
  return true;
}

/**
 * Set gap detection callback - NO-OP STUB
 * @deprecated BC removed
 */
export function setGapDetectionCallback() {
  // No-op
}

/**
 * Process received sequence - NO-OP STUB
 * @returns {Object} Always returns no gap (BC removed)
 * @deprecated BC removed
 */
export function processReceivedSequence() {
  return { hasGap: false, gapSize: 0, isFirstMessage: false };
}

/**
 * Reset sequence tracking - NO-OP STUB
 * @deprecated BC removed
 */
export function resetSequenceTracking() {
  // No-op
}

// ==================== SIDEBAR RELAY STUBS ====================

/**
 * Check if sidebar relay is active - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed
 */
export function isSidebarRelayActive() {
  return false;
}

/**
 * Set sidebar ready - NO-OP STUB
 * @deprecated BC removed
 */
export function setSidebarReady() {
  // No-op
}

/**
 * Check if sidebar is ready - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed
 */
export function isSidebarReady() {
  return false;
}

/**
 * Set background relay callback - NO-OP STUB
 * @deprecated BC removed
 */
export function setBackgroundRelayCallback() {
  // No-op
}

/**
 * Activate sidebar relay - NO-OP STUB
 * @deprecated BC removed
 */
export function activateSidebarRelay() {
  // No-op
}

/**
 * Deactivate sidebar relay - NO-OP STUB
 * @deprecated BC removed
 */
export function deactivateSidebarRelay() {
  // No-op
}

/**
 * Send to sidebar via relay - NO-OP STUB
 * @returns {Promise<Object>} Always returns not delivered (BC removed)
 * @deprecated BC removed
 */
export async function sendToSidebarViaRelay() {
  return { delivered: false, method: 'none' };
}

/**
 * Smart broadcast - NO-OP STUB
 * @returns {Promise<Object>} Always returns not sent (BC removed)
 * @deprecated BC removed
 */
export async function smartBroadcast() {
  return { bcSent: false, relaySent: false };
}

// ==================== CROSS-ORIGIN IFRAME STUBS ====================

/**
 * Detect cross-origin context - NO-OP STUB
 * @returns {Object} Default context info (BC removed)
 * @deprecated BC removed
 */
export function detectCrossOriginContext() {
  return {
    isCrossOrigin: false,
    parentOrigin: null,
    currentOrigin: 'unknown',
    isIframe: false,
    isExtensionContext: false
  };
}

/**
 * Verify BC for iframe - NO-OP STUB
 * @returns {Promise<Object>} Always returns not verified (BC removed)
 * @deprecated BC removed
 */
export async function verifyBroadcastChannelForIframe() {
  return {
    verified: false,
    origin: 'unknown',
    method: 'none',
    latencyMs: 0,
    reason: 'BroadcastChannel removed per architecture-redesign.md'
  };
}

/**
 * Get iframe verification status - NO-OP STUB
 * @returns {null} Always returns null (BC removed)
 * @deprecated BC removed
 */
export function getIframeVerificationStatus() {
  return null;
}

/**
 * Check if iframe is using polling - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed
 */
export function isIframeUsingPolling() {
  return false;
}

// ==================== POLLING FALLBACK STUBS ====================

/**
 * Start polling fallback - NO-OP STUB
 * @returns {Object} Always returns not started (BC removed)
 * @deprecated BC removed - use storage.onChanged instead
 */
export function startPollingFallback() {
  return { started: false, intervalMs: 0 };
}

/**
 * Stop polling fallback - NO-OP STUB
 * @returns {Object} Always returns not stopped (BC removed)
 * @deprecated BC removed
 */
export function stopPollingFallback() {
  return { stopped: false, stats: null };
}

/**
 * Check if polling fallback is active - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed
 */
export function isPollingFallbackActive() {
  return false;
}

/**
 * Get polling success rate - NO-OP STUB
 * @returns {string} Always returns N/A (BC removed)
 * @deprecated BC removed
 */
export function getPollingSuccessRate() {
  return 'N/A';
}

/**
 * Get polling metrics - NO-OP STUB
 * @returns {Object} Empty metrics (BC removed)
 * @deprecated BC removed
 */
export function getPollingMetrics() {
  return {
    totalPolls: 0,
    successfulPolls: 0,
    failedPolls: 0,
    avgLatencyMs: 0,
    successRate: 'N/A',
    isActive: false,
    currentIntervalMs: 0,
    uptimeMs: 0,
    retryCount: 0,
    maxRetries: 0
  };
}

/**
 * Reset polling metrics - NO-OP STUB
 * @deprecated BC removed
 */
export function resetPollingMetrics() {
  // No-op
}

/**
 * Log communication method - NO-OP STUB
 * @returns {string} Always returns 'port-based' (BC removed)
 * @deprecated BC removed
 */
export function logCommunicationMethod() {
  return 'port-based';
}

// ==================== BACKPRESSURE STUBS ====================

/**
 * Send acknowledgment - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed
 */
export function sendAcknowledgment() {
  return false;
}

/**
 * Handle incoming ack - NO-OP STUB
 * @deprecated BC removed
 */
export function handleIncomingAck() {
  // No-op
}

/**
 * Check if throttled - NO-OP STUB
 * @returns {boolean} Always returns false (BC removed)
 * @deprecated BC removed
 */
export function isThrottled() {
  return false;
}

/**
 * Get backpressure metrics - NO-OP STUB
 * @returns {Object} Empty metrics (BC removed)
 * @deprecated BC removed
 */
export function getBackpressureMetrics() {
  return {
    acksReceived: 0,
    acksTimedOut: 0,
    throttleEvents: 0,
    messagesDropped: 0,
    pendingAcks: 0,
    isThrottled: false,
    throttledUntil: 0,
    trackedClients: 0
  };
}

/**
 * Reset backpressure metrics - NO-OP STUB
 * @deprecated BC removed
 */
export function resetBackpressureMetrics() {
  // No-op
}

/**
 * Get client state - NO-OP STUB
 * @returns {null} Always returns null (BC removed)
 * @deprecated BC removed
 */
export function getClientState() {
  return null;
}

/**
 * Clear client state - NO-OP STUB
 * @deprecated BC removed
 */
export function clearClientState() {
  // No-op
}

// ==================== DEFAULT EXPORT ====================

export default {
  // Core functions
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
  // Backpressure
  sendAcknowledgment,
  handleIncomingAck,
  isThrottled,
  getBackpressureMetrics,
  resetBackpressureMetrics,
  getClientState,
  clearClientState,
  // Sequence tracking
  getCurrentSequenceNumber,
  getLastReceivedSequenceNumber,
  isBroadcastChannelStale,
  setGapDetectionCallback,
  processReceivedSequence,
  resetSequenceTracking,
  // Sidebar relay
  isSidebarRelayActive,
  setSidebarReady,
  isSidebarReady,
  setBackgroundRelayCallback,
  activateSidebarRelay,
  deactivateSidebarRelay,
  sendToSidebarViaRelay,
  smartBroadcast,
  // Cross-origin iframe
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
