/**
 * BroadcastChannelManager
 * Manages real-time messaging between tabs using BroadcastChannel API
 * v1.6.3.7-v3 - API #2: BroadcastChannel for instant sidebar updates
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
 *
 * @module BroadcastChannelManager
 */

// Channel name for Quick Tab updates
const CHANNEL_NAME = 'quick-tabs-updates';

// Track whether BroadcastChannel is supported
let channelSupported = false;
let updateChannel = null;

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
 * @param {Object} message - Message to broadcast
 * @returns {boolean} True if message was sent
 */
function postMessage(message) {
  if (!isChannelAvailable()) {
    console.warn('[BroadcastChannelManager] Cannot post - channel not available');
    return false;
  }

  try {
    updateChannel.postMessage({
      ...message,
      timestamp: Date.now(),
      source: 'BroadcastChannelManager'
    });
    return true;
  } catch (err) {
    console.error('[BroadcastChannelManager] Failed to post message:', err.message);
    return false;
  }
}

/**
 * Broadcast Quick Tab created event
 * v1.6.3.7-v3 - API #2: Instant notification of new Quick Tab
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} data - Full Quick Tab data
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabCreated(quickTabId, data) {
  console.log('[BroadcastChannelManager] Broadcasting quick-tab-created:', quickTabId);
  return postMessage({
    type: 'quick-tab-created',
    quickTabId,
    data
  });
}

/**
 * Broadcast Quick Tab updated event
 * v1.6.3.7-v3 - API #2: Instant notification of Quick Tab change
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Only the changed properties
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabUpdated(quickTabId, changes) {
  console.log('[BroadcastChannelManager] Broadcasting quick-tab-updated:', quickTabId);
  return postMessage({
    type: 'quick-tab-updated',
    quickTabId,
    changes
  });
}

/**
 * Broadcast Quick Tab deleted event
 * v1.6.3.7-v3 - API #2: Instant notification of Quick Tab deletion
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabDeleted(quickTabId) {
  console.log('[BroadcastChannelManager] Broadcasting quick-tab-deleted:', quickTabId);
  return postMessage({
    type: 'quick-tab-deleted',
    quickTabId
  });
}

/**
 * Broadcast Quick Tab minimized event
 * v1.6.3.7-v3 - API #2: Instant notification of minimize
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabMinimized(quickTabId) {
  console.log('[BroadcastChannelManager] Broadcasting quick-tab-minimized:', quickTabId);
  return postMessage({
    type: 'quick-tab-minimized',
    quickTabId,
    changes: { minimized: true }
  });
}

/**
 * Broadcast Quick Tab restored event
 * v1.6.3.7-v3 - API #2: Instant notification of restore
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastQuickTabRestored(quickTabId) {
  console.log('[BroadcastChannelManager] Broadcasting quick-tab-restored:', quickTabId);
  return postMessage({
    type: 'quick-tab-restored',
    quickTabId,
    changes: { minimized: false }
  });
}

/**
 * Broadcast full state sync event
 * v1.6.3.7-v7 - FIX Issue #6: Storage write confirmation via BroadcastChannel
 * Used to notify Manager when storage is updated with new state
 * @param {Object} state - Full state object with tabs array
 * @param {string} saveId - Save ID for deduplication
 * @returns {boolean} True if broadcast succeeded
 */
export function broadcastFullStateSync(state, saveId) {
  console.log('[BroadcastChannelManager] Broadcasting full-state-sync:', {
    tabCount: state?.tabs?.length || 0,
    saveId
  });
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
  closeBroadcastChannel
};
