/**
 * Tab Operations Utility Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Close all tabs
 * - Close minimized tabs
 * - Restore Quick Tabs
 * - Adopt orphaned Quick Tabs
 * - Messaging utilities
 *
 * @version 1.6.4.11
 */

// Storage key
const STATE_KEY = 'quick_tabs_state_v2';

// Operation timeout
const OPERATION_TIMEOUT_MS = 2000;

// DOM verification delay
const DOM_VERIFICATION_DELAY_MS = 500;

// Pending operations tracking
const PENDING_OPERATIONS = new Set();

/**
 * Check if operation is already pending
 * @param {string} operationKey - Operation key
 * @returns {boolean}
 */
export function isOperationPending(operationKey) {
  return PENDING_OPERATIONS.has(operationKey);
}

/**
 * Set up pending operation with auto-clear
 * @param {string} operationKey - Operation key
 */
export function setupPendingOperation(operationKey) {
  PENDING_OPERATIONS.add(operationKey);
  setTimeout(() => {
    PENDING_OPERATIONS.delete(operationKey);
  }, OPERATION_TIMEOUT_MS);
}

/**
 * Clear pending operation
 * @param {string} operationKey - Operation key
 */
export function clearPendingOperation(operationKey) {
  PENDING_OPERATIONS.delete(operationKey);
}

/**
 * Send message to a single tab
 * @param {number} tabId - Browser tab ID
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<boolean>} True if successful
 */
export async function sendMessageToTab(tabId, action, quickTabId) {
  try {
    await browser.tabs.sendMessage(tabId, { action, quickTabId });
    return true;
  } catch (_err) {
    // Content script may not be loaded
    return false;
  }
}

/**
 * Send message to all tabs
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<{success: number, errors: number}>}
 */
export async function sendMessageToAllTabs(action, quickTabId) {
  const tabs = await browser.tabs.query({});
  console.log(`[Manager] Sending ${action} to ${tabs.length} tabs for:`, quickTabId);

  let successCount = 0;
  let errorCount = 0;

  for (const tab of tabs) {
    const result = await sendMessageToTab(tab.id, action, quickTabId);
    if (result) {
      successCount++;
    } else {
      errorCount++;
    }
  }

  return { success: successCount, errors: errorCount };
}

/**
 * Send restore message with timeout for confirmation
 * @param {number} tabId - Target browser tab ID
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from content script
 */
export function sendRestoreMessageWithTimeout(tabId, quickTabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[Manager] Restore confirmation timeout (${timeoutMs}ms) for:`, {
        quickTabId,
        targetTabId: tabId
      });
      reject(new Error(`Confirmation timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    browser.tabs
      .sendMessage(tabId, {
        action: 'RESTORE_QUICK_TAB',
        quickTabId,
        _meta: {
          requestId: `restore-${quickTabId}-${Date.now()}`,
          sentAt: Date.now(),
          expectsConfirmation: true
        }
      })
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Handle successful restore response in broadcast
 * @private
 * @param {Object} response - Response from content script
 * @param {number} tabId - Tab ID
 * @param {string} quickTabId - Quick Tab ID
 * @param {Map} quickTabHostInfo - Host info map
 * @param {{ confirmedBy: number|null }} tracking - Tracking object (mutated)
 */
function _handleRestoreSuccess(response, tabId, quickTabId, quickTabHostInfo, tracking) {
  if (tracking.confirmedBy) return; // Already confirmed by another tab

  tracking.confirmedBy = tabId;
  console.log('[Manager] ✅ RESTORE_CONFIRMED_BY_TAB:', {
    quickTabId,
    confirmedBy: tabId,
    response
  });

  // Update quickTabHostInfo with confirmed host
  if (quickTabHostInfo) {
    quickTabHostInfo.set(quickTabId, {
      hostTabId: tabId,
      lastUpdate: Date.now(),
      lastOperation: 'restore',
      confirmed: true
    });
  }
}

/**
 * Send restore message to a single tab in broadcast
 * @private
 * @param {Object} tab - Browser tab
 * @param {string} quickTabId - Quick Tab ID
 * @param {Map} quickTabHostInfo - Host info map
 * @param {{ confirmedBy: number|null }} tracking - Tracking object
 * @returns {Promise<{ success: boolean, response?: Object, error?: string }>}
 */
async function _sendRestoreToBroadcastTab(tab, quickTabId, quickTabHostInfo, tracking) {
  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      _meta: {
        requestId: `restore-${quickTabId}-${Date.now()}`,
        sentAt: Date.now(),
        expectsConfirmation: true
      }
    });

    if (response?.success) {
      _handleRestoreSuccess(response, tab.id, quickTabId, quickTabHostInfo, tracking);
    }

    return { success: response?.success ?? false, response };
  } catch (_err) {
    return { success: false, error: _err.message };
  }
}

/**
 * Send restore message to all tabs and track first confirmation
 * @param {string} quickTabId - Quick Tab ID
 * @param {Map} quickTabHostInfo - Map of Quick Tab host info
 * @returns {Promise<{ success: boolean, confirmedBy?: number, broadcastResults: Object }>}
 */
export async function sendRestoreMessageWithConfirmationBroadcast(quickTabId, quickTabHostInfo) {
  const tabs = await browser.tabs.query({});
  console.log(`[Manager] Broadcasting RESTORE_QUICK_TAB to ${tabs.length} tabs for:`, quickTabId);

  const tracking = { confirmedBy: null };
  let successCount = 0;
  let errorCount = 0;

  for (const tab of tabs) {
    const result = await _sendRestoreToBroadcastTab(tab, quickTabId, quickTabHostInfo, tracking);
    if (result.success) successCount++;
    else errorCount++;
  }

  const result = {
    success: successCount > 0,
    confirmedBy: tracking.confirmedBy,
    broadcastResults: { success: successCount, errors: errorCount, totalTabs: tabs.length }
  };

  console.log(`[Manager] Restored Quick Tab ${quickTabId} via broadcast:`, result);

  return result;
}

/**
 * Check if a tab is minimized using consistent logic
 * @param {Object} tab - Quick Tab data
 * @returns {boolean}
 */
export function isTabMinimizedHelper(tab) {
  return tab.minimized ?? tab.visibility?.minimized ?? false;
}

/**
 * Filter minimized tabs from state object
 * @param {Object} state - State object to modify in place
 * @returns {boolean} True if changes were made
 */
export function filterMinimizedFromState(state) {
  let hasChanges = false;

  // Handle unified format (v1.6.2.2+)
  if (state.tabs && Array.isArray(state.tabs)) {
    const originalLength = state.tabs.length;
    state.tabs = state.tabs.filter(t => !isTabMinimizedHelper(t));

    if (state.tabs.length !== originalLength) {
      hasChanges = true;
      state.timestamp = Date.now();
      state.saveId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
  } else {
    // Legacy container format (fallback)
    hasChanges = filterMinimizedFromContainerFormat(state);
  }

  return hasChanges;
}

/**
 * Filter minimized tabs from legacy container format
 * @param {Object} state - State object in container format
 * @returns {boolean} True if changes were made
 */
export function filterMinimizedFromContainerFormat(state) {
  let hasChanges = false;

  Object.keys(state).forEach(cookieStoreId => {
    if (cookieStoreId === 'saveId' || cookieStoreId === 'timestamp') return;

    if (state[cookieStoreId] && state[cookieStoreId].tabs) {
      const originalLength = state[cookieStoreId].tabs.length;
      state[cookieStoreId].tabs = state[cookieStoreId].tabs.filter(t => !isTabMinimizedHelper(t));

      if (state[cookieStoreId].tabs.length !== originalLength) {
        hasChanges = true;
        state[cookieStoreId].timestamp = Date.now();
      }
    }
  });

  return hasChanges;
}

/**
 * Validate tab data for restore operation
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} quickTabsState - Quick Tabs state
 * @returns {{ valid: boolean, tabData: Object|null, error: string|null }}
 */
export function validateRestoreTabData(quickTabId, quickTabsState) {
  const tabData = findTabInState(quickTabId, quickTabsState);

  if (!tabData) {
    console.warn('[Manager] Restore REJECTED: Tab not found in state:', quickTabId);
    return { valid: false, tabData: null, error: 'Quick Tab not found' };
  }

  console.log('[Manager] 📋 RESTORE_TAB_DATA:', {
    quickTabId,
    originTabId: tabData.originTabId,
    minimized: tabData.minimized,
    visibilityMinimized: tabData.visibility?.minimized,
    url: tabData.url?.substring(0, 50)
  });

  const isMinimized = isTabMinimizedHelper(tabData);
  if (!isMinimized) {
    console.warn('[Manager] Restore REJECTED: Tab is not minimized:', {
      id: quickTabId,
      minimized: tabData.minimized,
      visibilityMinimized: tabData.visibility?.minimized
    });
    return { valid: false, tabData, error: 'Tab is already active - cannot restore' };
  }

  return { valid: true, tabData, error: null };
}

/**
 * Find Quick Tab data in current state by ID
 * @param {string} quickTabId - Quick Tab ID to find
 * @param {Object} quickTabsState - Quick Tabs state
 * @returns {Object|null} Tab data or null if not found
 */
export function findTabInState(quickTabId, quickTabsState) {
  if (!quickTabsState?.tabs) return null;
  return quickTabsState.tabs.find(tab => tab.id === quickTabId) || null;
}

/**
 * Resolve target tab ID for restore operation
 * v1.6.4.13 - FIX BUG #4: Prioritize originTabId from storage over hostInfo
 *
 * After adoption, storage contains the correct originTabId but hostInfo
 * may still have the old host tab ID. We should prioritize storage (tabData.originTabId)
 * as the source of truth.
 *
 * @private
 * @param {Object} hostInfo - Host info from map
 * @param {Object} tabData - Tab data
 * @returns {number|null} Target tab ID or null
 */
function _resolveTargetTabId(hostInfo, tabData) {
  // v1.6.4.13 - FIX BUG #4: Prioritize storage originTabId over hostInfo
  // After adoption, storage has the correct originTabId but hostInfo may be stale
  if (tabData.originTabId) {
    return tabData.originTabId;
  }
  return hostInfo?.hostTabId || null;
}

/**
 * Update host info after successful restore
 * @private
 * @param {number} targetTabId - Target tab ID
 * @param {string} quickTabId - Quick Tab ID
 * @param {Map} quickTabHostInfo - Host info map
 */
function _updateHostInfoAfterRestore(targetTabId, quickTabId, quickTabHostInfo) {
  if (!quickTabHostInfo) return;
  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'restore',
    confirmed: true
  });
}

/**
 * Handle targeted restore response
 * @private
 */
function _handleTargetedRestoreResponse(response, targetTabId, quickTabId, quickTabHostInfo) {
  console.log('[Manager] ✅ RESTORE_CONFIRMATION:', {
    quickTabId,
    targetTabId,
    success: response?.success,
    action: response?.action,
    completedAt: response?.completedAt || Date.now(),
    responseDetails: response
  });

  if (response?.success) {
    _updateHostInfoAfterRestore(targetTabId, quickTabId, quickTabHostInfo);
  }

  return { success: response?.success ?? false, confirmedBy: targetTabId };
}

/**
 * Determine the source of the restore target
 * v1.6.4.13 - Extracted to improve readability and reduce code duplication
 * @param {Object} tabData - Tab data with originTabId
 * @param {Object} hostInfo - Host info from map
 * @returns {string} Source description
 */
export function determineRestoreSource(tabData, hostInfo) {
  if (tabData.originTabId) {
    return 'originTabId (storage)';
  }
  if (hostInfo?.hostTabId) {
    return 'quickTabHostInfo';
  }
  return 'broadcast';
}

/**
 * Send restore message to target tab with confirmation tracking
 * v1.6.4.13 - FIX BUG #4: Updated logging to show correct source of truth
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} tabData - Tab data with originTabId
 * @param {Map} quickTabHostInfo - Map of Quick Tab host info
 * @returns {Promise<{ success: boolean, confirmedBy?: number, error?: string }>}
 */
export async function sendRestoreMessage(quickTabId, tabData, quickTabHostInfo) {
  const hostInfo = quickTabHostInfo?.get(quickTabId);
  const targetTabId = _resolveTargetTabId(hostInfo, tabData);

  // v1.6.4.13 - Extracted source determination for readability
  const source = determineRestoreSource(tabData, hostInfo);

  console.log('[Manager] 🎯 RESTORE_TARGET_RESOLUTION:', {
    quickTabId,
    targetTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    originTabId: tabData.originTabId,
    source,
    // v1.6.4.13 - Show if hostInfo was overridden by storage originTabId
    hostInfoOverridden: hostInfo?.hostTabId && tabData.originTabId && hostInfo.hostTabId !== tabData.originTabId
  });

  // No target - fall back to broadcast
  if (!targetTabId) {
    console.log('[Manager] ⚠️ No host tab info found, using broadcast for restore:', quickTabId);
    return sendRestoreMessageWithConfirmationBroadcast(quickTabId, quickTabHostInfo);
  }

  // Try targeted message first
  try {
    const response = await sendRestoreMessageWithTimeout(targetTabId, quickTabId, 500);
    return _handleTargetedRestoreResponse(response, targetTabId, quickTabId, quickTabHostInfo);
  } catch (err) {
    console.warn(
      `[Manager] Targeted restore failed (tab ${targetTabId} may be closed), falling back to broadcast:`,
      err.message
    );
    return sendRestoreMessageWithConfirmationBroadcast(quickTabId, quickTabHostInfo);
  }
}

/**
 * Verify DOM was actually rendered after restore
 * @param {string} quickTabId - Quick Tab ID
 */
export function scheduleRestoreVerification(quickTabId) {
  setTimeout(async () => {
    try {
      const stateResult = await browser.storage.local.get(STATE_KEY);
      const state = stateResult?.[STATE_KEY];
      const tab = state?.tabs?.find(t => t.id === quickTabId);

      if (tab?.domVerified === false) {
        console.warn('[Manager] Restore WARNING: DOM not verified after restore:', quickTabId);
      } else if (tab && !tab.minimized) {
        console.log('[Manager] Restore confirmed: DOM verified for:', quickTabId);
      }
    } catch (err) {
      console.error('[Manager] Error verifying restore:', err);
    }
  }, DOM_VERIFICATION_DELAY_MS);
}

/**
 * Check if a Quick Tab is orphaned (no valid browser tab to restore to)
 * @param {Object} tab - Quick Tab data
 * @param {Map} browserTabInfoCache - Cache of browser tab info
 * @returns {boolean} True if orphaned
 */
export function isOrphanedQuickTab(tab, browserTabInfoCache) {
  // No originTabId means definitely orphaned
  if (tab.originTabId == null) {
    return true;
  }

  // Check if the origin tab is still open using cached browser tab info
  const cachedInfo = browserTabInfoCache?.get(tab.originTabId);
  if (cachedInfo && cachedInfo.data === null) {
    // Cache indicates this tab was closed
    return true;
  }

  // Not orphaned (or we don't have confirmation yet)
  return false;
}

/**
 * Adopt an orphaned Quick Tab to a target browser tab
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} targetTabId - Target browser tab ID
 * @param {Map} quickTabHostInfo - Map of Quick Tab host info
 * @param {Map} browserTabInfoCache - Cache of browser tab info
 * @returns {Promise<{ success: boolean, oldOriginTabId?: number, newOriginTabId?: number }>}
 */
export async function adoptQuickTab(
  quickTabId,
  targetTabId,
  quickTabHostInfo,
  browserTabInfoCache
) {
  console.log('[Manager] 📥 ADOPT_TO_CURRENT_TAB:', {
    quickTabId,
    targetTabId,
    timestamp: Date.now()
  });

  // Validate targetTabId
  if (!targetTabId || targetTabId < 0) {
    console.error('[Manager] ❌ Invalid targetTabId for adopt:', targetTabId);
    return { success: false };
  }

  try {
    // Read current state
    const result = await browser.storage.local.get(STATE_KEY);
    const state = result?.[STATE_KEY];

    if (!state?.tabs?.length) {
      console.warn('[Manager] No Quick Tabs in storage to adopt');
      return { success: false };
    }

    // Find the Quick Tab
    const tabIndex = state.tabs.findIndex(t => t.id === quickTabId);
    if (tabIndex === -1) {
      console.warn('[Manager] Quick Tab not found for adopt:', quickTabId);
      return { success: false };
    }

    const quickTab = state.tabs[tabIndex];
    const oldOriginTabId = quickTab.originTabId;

    // Update originTabId
    quickTab.originTabId = targetTabId;

    // Generate new saveId for the update
    const saveId = `adopt-${quickTabId}-${Date.now()}`;

    // Persist the change
    await browser.storage.local.set({
      [STATE_KEY]: {
        tabs: state.tabs,
        saveId,
        timestamp: Date.now(),
        writingTabId: targetTabId,
        writingInstanceId: `manager-adopt-${Date.now()}`
      }
    });

    console.log('[Manager] ✅ ADOPT_COMPLETED:', {
      quickTabId,
      oldOriginTabId,
      newOriginTabId: targetTabId,
      saveId
    });

    // Update local quickTabHostInfo
    if (quickTabHostInfo) {
      quickTabHostInfo.set(quickTabId, {
        hostTabId: targetTabId,
        lastUpdate: Date.now(),
        lastOperation: 'adopt',
        confirmed: true
      });
    }

    // Invalidate cache for old tab
    if (browserTabInfoCache && oldOriginTabId) {
      browserTabInfoCache.delete(oldOriginTabId);
    }

    return { success: true, oldOriginTabId, newOriginTabId: targetTabId };
  } catch (err) {
    console.error('[Manager] ❌ Error adopting Quick Tab:', err);
    return { success: false };
  }
}

export { STATE_KEY, OPERATION_TIMEOUT_MS, DOM_VERIFICATION_DELAY_MS };
