/**
 * Tabs API Event Listeners for Quick Tabs
 *
 * v1.6.3.9-v2 - Issue #6: Container Isolation and Tab Event Handling
 *
 * This module provides three event listeners for browser tabs:
 * 1. onActivated - Triggers immediate state refresh when tab becomes active
 * 2. onRemoved - Cleans up Quick Tabs owned by closed tabs
 * 3. onUpdated - Monitors URL/title/favicon changes and container changes
 *
 * @module background/tab-events
 */

import {
  TAB_UPDATED_DEBOUNCE_MS,
  PENDING_TAB_UPDATE_MAX_AGE_MS,
  DEFAULT_CONTAINER_ID
} from '../constants.js';
import { broadcastToAllTabs } from './broadcast-manager.js';
import { storageManager } from './message-handler.js';
import * as SchemaV2 from '../storage/schema-v2.js';

// =============================================================================
// CONSTANTS
// =============================================================================

// Import timing constants from centralized constants.js
const ON_UPDATED_DEBOUNCE_MS = TAB_UPDATED_DEBOUNCE_MS;
const PENDING_UPDATE_MAX_AGE_MS = PENDING_TAB_UPDATE_MAX_AGE_MS;

// =============================================================================
// STATE TRACKING
// =============================================================================

/**
 * Track pending debounced updates per tab
 * Map of tabId → { timeoutId, lastUpdate, changes }
 */
const pendingUpdates = new Map();

/**
 * Track last known container ID per tab for change detection
 * Map of tabId → containerId
 */
const tabContainerCache = new Map();

/**
 * Flag to track if listeners are initialized
 */
let listenersInitialized = false;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Log tab event with consistent formatting
 * @private
 * @param {string} eventType - Type of event (ACTIVATED, REMOVED, UPDATED)
 * @param {Object} details - Event details
 */
function _logTabEvent(eventType, details) {
  console.log(`[TabEvents] TAB_${eventType}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Check if tab-events module is enabled
 * @returns {boolean} Always true for now (can add feature flag later)
 */
function isTabEventsEnabled() {
  return true;
}

/**
 * Clear pending update for a tab
 * @private
 * @param {number} tabId - Tab ID
 */
function _clearPendingUpdate(tabId) {
  const pending = pendingUpdates.get(tabId);
  if (pending?.timeoutId) {
    clearTimeout(pending.timeoutId);
  }
  pendingUpdates.delete(tabId);
}

// =============================================================================
// onActivated LISTENER
// =============================================================================

/**
 * Check if error is an expected "content script not loaded" error
 * @private
 * @param {Error} err - Error to check
 * @returns {boolean} True if this is an expected error
 */
function _isContentScriptNotLoadedError(err) {
  return err.message?.includes('Receiving end does not exist');
}

/**
 * Check if error is an expected "tab not found" error
 * v1.6.3.9-v2 - Extracted for maintainability
 * @private
 * @param {Error} err - Error to check
 * @returns {boolean} True if this is an expected tab-not-found error
 */
function _isTabNotFoundError(err) {
  return err.message?.includes('Invalid tab ID') || err.message?.includes('No tab with id');
}

/**
 * Handle tab activation - triggers immediate state refresh
 * v1.6.3.9-v2 - Issue #6: Reduces perceived latency from 100-250ms to 10-20ms
 *
 * @param {Object} activeInfo - Tab activation info { tabId, previousTabId, windowId }
 */
async function handleTabActivated(activeInfo) {
  const { tabId, windowId } = activeInfo;

  _logTabEvent('ACTIVATED', { tabId, windowId });

  try {
    // Get tab info to check container context
    const tab = await browser.tabs.get(tabId);
    const containerId = tab.cookieStoreId || DEFAULT_CONTAINER_ID;

    // Update container cache
    tabContainerCache.set(tabId, containerId);

    // Send state refresh request to the activated tab
    await _sendStateRefreshToTab(tabId, containerId);
  } catch (err) {
    console.error('[TabEvents] Error handling tab activation:', {
      tabId,
      error: err.message
    });
  }
}

/**
 * Send state refresh request to a tab
 * v1.6.3.9-v2 - Extracted to reduce handleTabActivated complexity
 * @private
 */
async function _sendStateRefreshToTab(tabId, containerId) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'STATE_REFRESH_REQUESTED',
      tabId,
      containerId,
      timestamp: Date.now()
    });
    _logTabEvent('ACTIVATED_REFRESH_SENT', { tabId, containerId });
  } catch (err) {
    // Content script may not be loaded yet - this is normal for new tabs
    if (!_isContentScriptNotLoadedError(err)) {
      console.warn('[TabEvents] Failed to send refresh to tab:', {
        tabId,
        error: err.message
      });
    }
  }
}

// =============================================================================
// onRemoved LISTENER
// =============================================================================

/**
 * Handle tab removal - cleans up Quick Tabs owned by the closed tab
 * v1.6.3.9-v2 - Issue #6: Automatic cleanup without forceEmpty flag
 *
 * @param {number} tabId - ID of the closed tab
 * @param {Object} removeInfo - Removal info { windowId, isWindowClosing }
 */
async function handleTabRemoved(tabId, removeInfo) {
  const { windowId, isWindowClosing } = removeInfo;

  _logTabEvent('REMOVED', { tabId, windowId, isWindowClosing });

  // Clear any pending updates for this tab
  _clearPendingUpdate(tabId);

  // Clear container cache for this tab
  tabContainerCache.delete(tabId);

  try {
    // Read current state
    const state = await storageManager.readState();

    // Find Quick Tabs owned by this tab
    const tabQuickTabs = SchemaV2.getQuickTabsByOriginTabId(state, tabId);

    if (tabQuickTabs.length === 0) {
      _logTabEvent('REMOVED_NO_QUICKTABS', { tabId });
      return;
    }

    _logTabEvent('REMOVED_CLEANUP_START', {
      tabId,
      quickTabCount: tabQuickTabs.length,
      isWindowClosing
    });

    // Remove Quick Tabs for this tab
    const updatedState = SchemaV2.removeQuickTabsByOriginTabId(state, tabId);

    // Write updated state
    // Note: When isWindowClosing is true, multiple tabs may close simultaneously
    // The storage manager handles this via its queue and deduplication
    await storageManager.writeStateWithValidation(
      updatedState,
      `tab-removed-${tabId}-${Date.now()}`
    );

    // Broadcast state update to remaining tabs
    await broadcastToAllTabs({
      type: 'QT_STATE_SYNC',
      source: 'tab-events-cleanup',
      originTabId: tabId,
      removedQuickTabIds: tabQuickTabs.map(qt => qt.id),
      timestamp: Date.now()
    });

    _logTabEvent('REMOVED_CLEANUP_COMPLETE', {
      tabId,
      removedCount: tabQuickTabs.length
    });
  } catch (err) {
    console.error('[TabEvents] Error handling tab removal:', {
      tabId,
      error: err.message
    });
  }
}

// =============================================================================
// onUpdated LISTENER
// =============================================================================

/**
 * Build updates object from changes
 * v1.6.3.9-v2 - Extracted to reduce _processTabUpdate complexity
 * @private
 * @param {Object} changes - Accumulated changes
 * @param {boolean} containerChanged - Whether container changed
 * @param {string} currentContainerId - Current container ID
 * @returns {Object} Updates to apply
 */
function _buildQuickTabUpdates(changes, containerChanged, currentContainerId) {
  const updates = {};
  if (changes.url) updates.url = changes.url;
  if (changes.title) updates.title = changes.title;
  if (changes.favIconUrl) updates.favIconUrl = changes.favIconUrl;
  if (containerChanged) updates.originContainerId = currentContainerId;
  return updates;
}

/**
 * Apply updates to Quick Tabs for a tab
 * v1.6.3.9-v2 - Extracted to reduce _processTabUpdate complexity
 * @private
 */
async function _applyQuickTabUpdates(state, tabQuickTabs, updates, tabId) {
  let updatedState = state;
  for (const qt of tabQuickTabs) {
    updatedState = SchemaV2.updateQuickTab(updatedState, qt.id, updates);
  }

  await storageManager.writeStateWithValidation(
    updatedState,
    `tab-updated-${tabId}-${Date.now()}`
  );

  _logTabEvent('UPDATED_QUICKTABS_SYNCED', {
    tabId,
    quickTabCount: tabQuickTabs.length,
    updates: Object.keys(updates)
  });
}

/**
 * Process debounced tab update - updates Quick Tab metadata
 * v1.6.3.9-v2 - Refactored to reduce complexity
 * @private
 * @param {number} tabId - Tab ID
 * @param {Object} changes - Accumulated changes
 */
async function _processTabUpdate(tabId, changes) {
  try {
    const tab = await browser.tabs.get(tabId);
    const currentContainerId = tab.cookieStoreId || DEFAULT_CONTAINER_ID;

    const previousContainerId = tabContainerCache.get(tabId);
    const containerChanged = previousContainerId && previousContainerId !== currentContainerId;

    tabContainerCache.set(tabId, currentContainerId);

    if (containerChanged) {
      _logTabEvent('UPDATED_CONTAINER_CHANGED', { tabId, previousContainerId, currentContainerId });
    }

    const state = await storageManager.readState();
    const tabQuickTabs = SchemaV2.getQuickTabsByOriginTabId(state, tabId);

    if (tabQuickTabs.length === 0) return;

    const updates = _buildQuickTabUpdates(changes, containerChanged, currentContainerId);
    if (Object.keys(updates).length === 0) return;

    await _applyQuickTabUpdates(state, tabQuickTabs, updates, tabId);
  } catch (err) {
    // Tab may have been closed during processing - this is expected
    if (!_isTabNotFoundError(err)) {
      console.error('[TabEvents] Error processing tab update:', { tabId, error: err.message });
    }
  }
}

/**
 * Extract relevant changes from changeInfo
 * v1.6.3.9-v2 - Extracted to reduce handleTabUpdated complexity
 * @private
 */
function _extractRelevantChanges(changeInfo, tab, tabId) {
  const relevantChanges = {};
  if (changeInfo.url) relevantChanges.url = changeInfo.url;
  if (changeInfo.title) relevantChanges.title = changeInfo.title;
  if (changeInfo.favIconUrl) relevantChanges.favIconUrl = changeInfo.favIconUrl;

  const currentContainerId = tab.cookieStoreId || DEFAULT_CONTAINER_ID;
  const cachedContainerId = tabContainerCache.get(tabId);
  if (cachedContainerId && cachedContainerId !== currentContainerId) {
    relevantChanges.containerChanged = true;
  }

  return relevantChanges;
}

/**
 * Get or create pending update entry
 * v1.6.3.9-v2 - Extracted to reduce handleTabUpdated complexity
 * @private
 */
function _getOrCreatePendingUpdate(tabId, relevantChanges) {
  let pending = pendingUpdates.get(tabId);

  if (pending) {
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    pending.changes = { ...pending.changes, ...relevantChanges };
    pending.lastUpdate = Date.now();
  } else {
    pending = {
      changes: relevantChanges,
      createdAt: Date.now(),
      lastUpdate: Date.now(),
      timeoutId: null
    };
    pendingUpdates.set(tabId, pending);
  }

  return pending;
}

/**
 * Handle tab update - monitors URL/title/favicon/container changes
 * v1.6.3.9-v2 - Issue #6: Debounced to max once per 500ms
 * v1.6.3.9-v2 - Refactored to reduce complexity
 *
 * @param {number} tabId - ID of the updated tab
 * @param {Object} changeInfo - What changed { url, title, favIconUrl, status, etc. }
 * @param {Object} tab - Full tab object
 */
function handleTabUpdated(tabId, changeInfo, tab) {
  const relevantChanges = _extractRelevantChanges(changeInfo, tab, tabId);

  if (Object.keys(relevantChanges).length === 0) return;

  const pending = _getOrCreatePendingUpdate(tabId, relevantChanges);

  // Check if pending update is too old
  if (Date.now() - pending.createdAt > PENDING_UPDATE_MAX_AGE_MS) {
    _logTabEvent('UPDATED_STALE_DISCARDED', { tabId, age: Date.now() - pending.createdAt });
    _clearPendingUpdate(tabId);
    return;
  }

  // Schedule debounced processing
  pending.timeoutId = setTimeout(() => {
    const changes = pending.changes;
    pendingUpdates.delete(tabId);
    _processTabUpdate(tabId, changes);
  }, ON_UPDATED_DEBOUNCE_MS);

  pendingUpdates.set(tabId, pending);
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize tab event listeners
 * v1.6.3.9-v2 - Issue #6: Register all three event listeners
 *
 * @returns {{ success: boolean, listenersRegistered: string[] }}
 */
export function initializeTabEvents() {
  if (listenersInitialized) {
    console.log('[TabEvents] Already initialized');
    return { success: true, listenersRegistered: [], alreadyInitialized: true };
  }

  if (!isTabEventsEnabled()) {
    console.log('[TabEvents] Tab events disabled by feature flag');
    return { success: false, listenersRegistered: [], reason: 'disabled' };
  }

  const listenersRegistered = [];

  try {
    // Register onActivated listener
    browser.tabs.onActivated.addListener(handleTabActivated);
    listenersRegistered.push('onActivated');

    // Register onRemoved listener
    browser.tabs.onRemoved.addListener(handleTabRemoved);
    listenersRegistered.push('onRemoved');

    // Register onUpdated listener
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    listenersRegistered.push('onUpdated');

    listenersInitialized = true;

    console.log('[TabEvents] v1.6.3.9-v2 Tab event listeners initialized:', {
      listeners: listenersRegistered,
      timestamp: Date.now()
    });

    return { success: true, listenersRegistered };
  } catch (err) {
    console.error('[TabEvents] Failed to initialize:', {
      error: err.message,
      listenersRegistered
    });
    return { success: false, listenersRegistered, error: err.message };
  }
}

/**
 * Cleanup tab event listeners (for testing/shutdown)
 */
export function cleanupTabEvents() {
  if (!listenersInitialized) {
    return { success: true, message: 'Not initialized' };
  }

  try {
    browser.tabs.onActivated.removeListener(handleTabActivated);
    browser.tabs.onRemoved.removeListener(handleTabRemoved);
    browser.tabs.onUpdated.removeListener(handleTabUpdated);

    // Clear pending updates
    for (const [tabId] of pendingUpdates) {
      _clearPendingUpdate(tabId);
    }
    pendingUpdates.clear();
    tabContainerCache.clear();

    listenersInitialized = false;

    console.log('[TabEvents] Listeners cleaned up');
    return { success: true };
  } catch (err) {
    console.error('[TabEvents] Cleanup failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get tab events module diagnostics
 */
export function getTabEventsDiagnostics() {
  return {
    isInitialized: listenersInitialized,
    pendingUpdatesCount: pendingUpdates.size,
    cachedContainersCount: tabContainerCache.size,
    timestamp: Date.now()
  };
}
