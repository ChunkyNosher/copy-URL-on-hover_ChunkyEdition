/**
 * Storage Handlers Utility Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Storage change detection and handling
 * - Tab change identification
 * - Suspicious storage drop detection
 * - Reconciliation with content scripts
 *
 * @version 1.6.4.11
 */

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';

// Constants for saveId patterns used in corruption detection
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';

// Debounce timing
// v1.6.3.7-v4 - FIX Issue #7: Increased from 50ms to 500ms
// Since BroadcastChannel is now PRIMARY for instant updates, storage polling is BACKUP
// Higher debounce prevents rapid storage reads during burst operations
const STORAGE_READ_DEBOUNCE_MS = 500;

/**
 * Identify tabs that changed position or size between two state snapshots
 * @param {Array} oldTabs - Previous tabs array
 * @param {Array} newTabs - New tabs array
 * @returns {{ positionChanged: Array<string>, sizeChanged: Array<string> }}
 */
export function identifyChangedTabs(oldTabs, newTabs) {
  const positionChanged = [];
  const sizeChanged = [];

  if (!Array.isArray(oldTabs) || !Array.isArray(newTabs)) {
    return { positionChanged, sizeChanged };
  }

  const oldTabMap = new Map(oldTabs.map(t => [t.id, t]));

  for (const newTab of newTabs) {
    const oldTab = oldTabMap.get(newTab.id);
    if (!oldTab) continue;

    // Check position changes (flat or nested format)
    const hasPositionChange = _hasPositionChanged(oldTab, newTab);
    if (hasPositionChange) {
      positionChanged.push(newTab.id);
    }

    // Check size changes (flat or nested format)
    const hasSizeChange = _hasSizeChanged(oldTab, newTab);
    if (hasSizeChange) {
      sizeChanged.push(newTab.id);
    }
  }

  return { positionChanged, sizeChanged };
}

/**
 * Check if position changed between two tabs
 * @private
 */
function _hasPositionChanged(oldTab, newTab) {
  // Check nested position format
  if (newTab.position && oldTab.position) {
    if (newTab.position.x !== oldTab.position.x || newTab.position.y !== oldTab.position.y) {
      return true;
    }
  }

  // Check flat format
  if (newTab.left !== oldTab.left || newTab.top !== oldTab.top) {
    return true;
  }

  return false;
}

/**
 * Check if size changed between two tabs
 * @private
 */
function _hasSizeChanged(oldTab, newTab) {
  // Check nested size format
  if (newTab.size && oldTab.size) {
    if (newTab.size.width !== oldTab.size.width || newTab.size.height !== oldTab.size.height) {
      return true;
    }
  }

  // Check flat format
  if (newTab.width !== oldTab.width || newTab.height !== oldTab.height) {
    return true;
  }

  return false;
}

/**
 * Check if storage change is a suspicious drop (potential corruption)
 * A drop to 0 is only suspicious if:
 * - More than 1 tab existed before (sudden multi-tab wipe)
 * - It's not an explicit clear operation (reconciled/cleared saveId)
 *
 * @param {number} oldTabCount - Previous tab count
 * @param {number} newTabCount - New tab count
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if suspicious
 */
export function isSuspiciousStorageDrop(oldTabCount, newTabCount, newValue) {
  // Single tab deletion (1→0) is always legitimate
  if (oldTabCount === 1 && newTabCount === 0) {
    console.log('[StorageHandlers] Single tab deletion detected (1→0) - legitimate operation');
    return false;
  }

  // Check for multi-tab drop to 0
  const isMultiTabDrop = oldTabCount > 1 && newTabCount === 0;
  if (!isMultiTabDrop) {
    return false;
  }

  // Check for explicit clear operations
  const isExplicitClear = _isExplicitClearOperation(newValue);

  return !isExplicitClear;
}

/**
 * Check if the storage change is an explicit clear operation
 * @private
 */
function _isExplicitClearOperation(newValue) {
  if (!newValue) return true;

  const saveId = newValue.saveId || '';
  return saveId.includes(SAVEID_RECONCILED) || saveId.includes(SAVEID_CLEARED);
}

/**
 * Log storage change event with comprehensive details
 * @param {Object} params - Parameters for logging
 * @param {number} params.oldTabCount - Previous tab count
 * @param {number} params.newTabCount - New tab count
 * @param {Object} params.newValue - New storage value
 * @param {number} params.currentBrowserTabId - Current browser tab ID
 */
export function logStorageChange({ oldTabCount, newTabCount, newValue, currentBrowserTabId }) {
  const sourceTabId = newValue?.writingTabId;
  const sourceInstanceId = newValue?.writingInstanceId;
  const isFromCurrentTab = sourceTabId === currentBrowserTabId;

  console.log('[Manager] 📦 STORAGE_CHANGED:', {
    oldTabCount,
    newTabCount,
    delta: newTabCount - oldTabCount,
    saveId: newValue?.saveId,
    transactionId: newValue?.transactionId,
    writingTabId: sourceTabId,
    writingInstanceId: sourceInstanceId,
    isFromCurrentTab,
    currentBrowserTabId,
    timestamp: newValue?.timestamp,
    processedAt: Date.now()
  });
}

/**
 * Log tab ID changes (added/removed)
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 */
export function logTabIdChanges(oldValue, newValue) {
  const oldIds = new Set((oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((newValue?.tabs || []).map(t => t.id));
  const addedIds = [...newIds].filter(id => !oldIds.has(id));
  const removedIds = [...oldIds].filter(id => !newIds.has(id));

  if (addedIds.length > 0 || removedIds.length > 0) {
    console.log('[Manager] storage.onChanged tab changes:', {
      addedIds,
      removedIds,
      addedCount: addedIds.length,
      removedCount: removedIds.length
    });
  }
}

/**
 * Log position/size updates from storage change
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @param {number} sourceTabId - Source tab ID of the change
 * @param {boolean} isFromCurrentTab - Whether change is from current tab
 */
export function logPositionSizeUpdates(oldValue, newValue, sourceTabId, isFromCurrentTab) {
  if (!newValue?.tabs || !oldValue?.tabs) return;

  const changedTabs = identifyChangedTabs(oldValue.tabs, newValue.tabs);
  if (changedTabs.positionChanged.length > 0 || changedTabs.sizeChanged.length > 0) {
    console.log('[Manager] 📐 POSITION_SIZE_UPDATE_RECEIVED:', {
      positionChangedIds: changedTabs.positionChanged,
      sizeChangedIds: changedTabs.sizeChanged,
      sourceTabId,
      isFromCurrentTab
    });
  }
}

/**
 * Query all content scripts for their Quick Tabs state
 * @returns {Promise<Array>} Array of Quick Tabs from all tabs
 */
export async function queryAllContentScriptsForQuickTabs() {
  const tabs = await browser.tabs.query({});
  const foundQuickTabs = [];

  for (const tab of tabs) {
    const quickTabs = await queryContentScriptForQuickTabs(tab.id);
    foundQuickTabs.push(...quickTabs);
  }

  return foundQuickTabs;
}

/**
 * Query a single content script for Quick Tabs
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<Array>} Quick Tabs from this tab
 */
export async function queryContentScriptForQuickTabs(tabId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      action: 'GET_QUICK_TABS_STATE'
    });

    if (response?.quickTabs && Array.isArray(response.quickTabs)) {
      console.log(`[Manager] Received ${response.quickTabs.length} Quick Tabs from tab ${tabId}`);
      return response.quickTabs;
    }
    return [];
  } catch (_err) {
    // Content script may not be loaded - this is expected
    return [];
  }
}

/**
 * Deduplicate Quick Tabs by ID
 * @param {Array} quickTabs - Array of Quick Tabs (may contain duplicates)
 * @returns {Array} Deduplicated array
 */
export function deduplicateQuickTabs(quickTabs) {
  const uniqueQuickTabs = [];
  const seenIds = new Set();

  for (const qt of quickTabs) {
    if (!seenIds.has(qt.id)) {
      seenIds.add(qt.id);
      uniqueQuickTabs.push(qt);
    }
  }

  return uniqueQuickTabs;
}

/**
 * Restore state from content scripts data
 * @param {Array} quickTabs - Quick Tabs from content scripts
 */
export async function restoreStateFromContentScripts(quickTabs) {
  console.warn('[Manager] Restoring from content script state...');

  const restoredState = {
    tabs: quickTabs,
    timestamp: Date.now(),
    saveId: `${SAVEID_RECONCILED}-${Date.now()}`
  };

  await browser.storage.local.set({ [STATE_KEY]: restoredState });
  console.log('[Manager] State restored from content scripts:', quickTabs.length, 'tabs');

  return restoredState;
}

/**
 * Create storage change handler context
 * @param {Object} deps - Dependencies
 * @returns {Object} Handler context with methods
 */
export function createStorageChangeHandler(deps) {
  const {
    loadQuickTabsState,
    renderUI,
    computeStateHash,
    showErrorNotification,
    getQuickTabsState,
    setQuickTabsState
  } = deps;

  let storageReadDebounceTimer = null;
  let lastRenderedStateHash = 0;

  /**
   * Schedule debounced storage update
   */
  function scheduleStorageUpdate() {
    if (storageReadDebounceTimer) {
      clearTimeout(storageReadDebounceTimer);
    }

    storageReadDebounceTimer = setTimeout(async () => {
      storageReadDebounceTimer = null;
      await loadQuickTabsState();
      const quickTabsState = getQuickTabsState();
      const newHash = computeStateHash(quickTabsState);
      if (newHash !== lastRenderedStateHash) {
        lastRenderedStateHash = newHash;
        renderUI();
      }
    }, STORAGE_READ_DEBOUNCE_MS);
  }

  /**
   * Handle suspicious storage drop
   * @param {Object} oldValue - Previous storage value
   */
  async function handleSuspiciousStorageDrop(oldValue) {
    console.warn('[Manager] ⚠️ SUSPICIOUS: Tab count dropped to 0!');
    console.warn('[Manager] This may indicate storage corruption. Querying content scripts...');

    try {
      await reconcileWithContentScripts(oldValue);
    } catch (err) {
      console.error('[Manager] Reconciliation error:', err);
      showErrorNotification('Failed to recover Quick Tab state. Data may be lost.');
    }
  }

  /**
   * Reconcile storage state with content scripts when suspicious changes detected
   * @param {Object} _previousState - Previous state (unused but kept for potential future use)
   */
  async function reconcileWithContentScripts(_previousState) {
    console.log('[Manager] Starting reconciliation with content scripts...');

    const foundQuickTabs = await queryAllContentScriptsForQuickTabs();
    const uniqueQuickTabs = deduplicateQuickTabs(foundQuickTabs);

    console.log(
      '[Manager] Reconciliation found',
      uniqueQuickTabs.length,
      'unique Quick Tabs in content scripts'
    );

    if (uniqueQuickTabs.length > 0) {
      // Content scripts have Quick Tabs but storage is empty - this is corruption!
      console.warn(
        '[Manager] CORRUPTION DETECTED: Content scripts have Quick Tabs but storage is empty'
      );
      const restoredState = await restoreStateFromContentScripts(uniqueQuickTabs);
      setQuickTabsState(restoredState);
      renderUI();
    } else {
      // No Quick Tabs found in content scripts - the empty state may be valid
      console.log('[Manager] No Quick Tabs found in content scripts - empty state appears valid');
      scheduleStorageUpdate();
    }
  }

  /**
   * Update the last rendered state hash
   * @param {number} hash - New hash value
   */
  function setLastRenderedStateHash(hash) {
    lastRenderedStateHash = hash;
  }

  /**
   * Get the last rendered state hash
   * @returns {number} Current hash value
   */
  function getLastRenderedStateHash() {
    return lastRenderedStateHash;
  }

  return {
    scheduleStorageUpdate,
    handleSuspiciousStorageDrop,
    reconcileWithContentScripts,
    setLastRenderedStateHash,
    getLastRenderedStateHash
  };
}

export { STATE_KEY, SAVEID_RECONCILED, SAVEID_CLEARED, STORAGE_READ_DEBOUNCE_MS };
