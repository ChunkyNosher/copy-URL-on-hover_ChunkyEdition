/**
 * Storage utility functions for Quick Tabs
 * v1.6.4 - Extracted from handlers to reduce duplication
 * 
 * @module storage-utils
 */

// Storage key for Quick Tabs state (unified format v1.6.2.2+)
export const STATE_KEY = 'quick_tabs_state_v2';

/**
 * Generate unique save ID for storage deduplication
 * Format: 'timestamp-random9chars'
 * 
 * @returns {string} Unique save ID
 */
export function generateSaveId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Get browser storage API (browser or chrome)
 * Returns null if not available (e.g., in unit tests)
 * 
 * @returns {Object|null} Browser storage API or null
 */
export function getBrowserStorageAPI() {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      return browser;
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      return chrome;
    }
  } catch (_err) {
    // Ignore errors accessing browser/chrome globals
  }
  return null;
}

/**
 * Build current state from quickTabsMap for storage
 * v1.6.4 - Extracted from handlers to reduce duplication
 * Uses minimizedManager.isMinimized() for consistent minimized state
 * 
 * @param {Map} quickTabsMap - Map of Quick Tab instances
 * @param {Object} minimizedManager - Manager for minimized Quick Tabs
 * @returns {Object} - State object in unified format
 */
export function buildStateForStorage(quickTabsMap, minimizedManager) {
  const tabs = [];
  for (const tab of quickTabsMap.values()) {
    // Use minimizedManager for consistent minimized state tracking
    const isMinimized = minimizedManager?.isMinimized?.(tab.id) || false;
    
    // Serialize tab to storage format
    const tabData = {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      left: tab.left,
      top: tab.top,
      width: tab.width,
      height: tab.height,
      minimized: isMinimized,
      soloedOnTabs: tab.soloedOnTabs || [],
      mutedOnTabs: tab.mutedOnTabs || []
    };
    tabs.push(tabData);
  }
  return {
    tabs: tabs,
    timestamp: Date.now(),
    saveId: generateSaveId()
  };
}

/**
 * Persist Quick Tab state to storage.local
 * 
 * @param {Object} state - State object to persist
 * @param {string} logPrefix - Prefix for log messages (e.g., '[DestroyHandler]')
 */
export function persistStateToStorage(state, logPrefix = '[StorageUtils]') {
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.log(`${logPrefix} Storage API not available, skipping persist`);
    return;
  }

  const tabCount = state.tabs?.length || 0;
  
  browserAPI.storage.local.set({ [STATE_KEY]: state })
    .then(() => {
      console.log(`${logPrefix} Persisted state to storage (${tabCount} tabs)`);
    })
    .catch((err) => {
      console.error(`${logPrefix} Failed to persist to storage:`, err);
    });
}
