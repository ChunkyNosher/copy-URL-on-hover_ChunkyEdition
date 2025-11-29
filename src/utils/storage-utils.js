/**
 * Storage utility functions for Quick Tabs
 * v1.6.4 - Extracted from handlers to reduce duplication
 * v1.6.4.1 - FIX Bug #1: Add Promise timeout, validation, and detailed logging
 * 
 * @module storage-utils
 */

// Storage key for Quick Tabs state (unified format v1.6.2.2+)
export const STATE_KEY = 'quick_tabs_state_v2';

// v1.6.4.1 - FIX Bug #1: Timeout for storage operations (5 seconds)
const STORAGE_TIMEOUT_MS = 5000;

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
 * Get numeric value from flat or nested tab property
 * v1.6.4.2 - Helper to reduce complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {string} flatKey - Key for flat format (e.g., 'left')
 * @param {string} nestedObj - Nested object name (e.g., 'position')
 * @param {string} nestedKey - Nested property name (e.g., 'left')
 * @param {number} defaultVal - Default value if not found
 * @returns {number} Resolved value
 */
function _getNumericValue(tab, flatKey, nestedObj, nestedKey, defaultVal) {
  // v1.6.4.2 - Use nullish coalescing to properly handle 0 values
  const flatVal = tab[flatKey];
  const nestedVal = tab[nestedObj]?.[nestedKey];
  const rawVal = flatVal ?? nestedVal ?? defaultVal;
  // v1.6.4.3 - FIX: Validate that Number() produces a valid number (not NaN)
  const numVal = Number(rawVal);
  return isNaN(numVal) ? defaultVal : numVal;
}

/**
 * Get array value from flat or nested tab property
 * v1.6.4.2 - Helper to reduce complexity
 * v1.6.4.3 - Note: Unlike _getNumericValue, this function doesn't have a defaultVal
 *            parameter because arrays always default to empty []. The nestedKey
 *            parameter accesses tab.visibility[nestedKey] specifically.
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {string} flatKey - Key for flat format (e.g., 'soloedOnTabs')
 * @param {string} nestedKey - Nested key in visibility object (e.g., 'soloedOnTabs')
 * @returns {Array} Resolved array (copied), defaults to empty array
 */
function _getArrayValue(tab, flatKey, nestedKey) {
  const flatVal = tab[flatKey];
  const nestedVal = tab.visibility?.[nestedKey];
  const arr = Array.isArray(flatVal) ? flatVal : (Array.isArray(nestedVal) ? nestedVal : []);
  return [...arr];
}

/**
 * Serialize a single Quick Tab to storage format
 * v1.6.4.1 - FIX Bug #1: Extracted to reduce complexity
 * v1.6.4.2 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {Object} Serialized tab data for storage
 */
function serializeTabForStorage(tab, isMinimized) {
  return {
    id: String(tab.id),
    url: String(tab.url || ''),
    title: String(tab.title || ''),
    left: _getNumericValue(tab, 'left', 'position', 'left', 0),
    top: _getNumericValue(tab, 'top', 'position', 'top', 0),
    width: _getNumericValue(tab, 'width', 'size', 'width', 400),
    height: _getNumericValue(tab, 'height', 'size', 'height', 300),
    minimized: Boolean(isMinimized),
    soloedOnTabs: _getArrayValue(tab, 'soloedOnTabs', 'soloedOnTabs'),
    mutedOnTabs: _getArrayValue(tab, 'mutedOnTabs', 'mutedOnTabs')
  };
}

/**
 * Validate that a state object can be serialized to JSON
 * v1.6.4.1 - FIX Bug #1: Extracted to reduce complexity
 * @private
 * @param {Object} state - State object to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateStateSerializable(state) {
  try {
    JSON.stringify(state);
    return true;
  } catch (jsonErr) {
    console.error('[StorageUtils] State is not JSON-serializable:', jsonErr);
    return false;
  }
}

/**
 * Build current state from quickTabsMap for storage
 * v1.6.4 - Extracted from handlers to reduce duplication
 * v1.6.4.1 - FIX Bug #1: Add validation and error handling
 * Uses minimizedManager.isMinimized() for consistent minimized state
 * 
 * @param {Map} quickTabsMap - Map of Quick Tab instances
 * @param {Object} minimizedManager - Manager for minimized Quick Tabs
 * @returns {Object|null} - State object in unified format, or null if error
 */
export function buildStateForStorage(quickTabsMap, minimizedManager) {
  // v1.6.4.1 - FIX Bug #1: Validate inputs
  if (!quickTabsMap) {
    console.warn('[StorageUtils] buildStateForStorage: quickTabsMap is null/undefined');
    return null;
  }
  
  const tabs = [];
  for (const tab of quickTabsMap.values()) {
    // Skip invalid tabs
    if (!tab?.id) {
      console.warn('[StorageUtils] buildStateForStorage: Skipping invalid tab (no id)');
      continue;
    }
    
    // Use minimizedManager for consistent minimized state tracking
    const isMinimized = minimizedManager?.isMinimized?.(tab.id) || false;
    const tabData = serializeTabForStorage(tab, isMinimized);
    tabs.push(tabData);
  }
  
  const state = {
    tabs: tabs,
    timestamp: Date.now(),
    saveId: generateSaveId()
  };
  
  // v1.6.4.1 - FIX Bug #1: Validate state is JSON-serializable before returning
  if (!validateStateSerializable(state)) {
    return null;
  }
  
  return state;
}

/**
 * Create a Promise that rejects after a timeout
 * v1.6.4.1 - FIX Bug #1: Helper for Promise timeout wrapper
 * @private
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Description of the operation for error message
 * @returns {{promise: Promise, clear: Function}} Object with timeout promise and cleanup function
 */
function createTimeoutPromise(ms, operation) {
  // v1.6.4.3 - FIX: Initialize timeoutId to null for safer cleanup
  let timeoutId = null;
  const promise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);
  });
  // v1.6.4.3 - FIX: Only clear if timeoutId was set (safety check)
  const clear = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
  return { promise, clear };
}

/**
 * Persist Quick Tab state to storage.local
 * v1.6.4 - Extracted from handlers
 * v1.6.4.1 - FIX Bug #1: Add Promise timeout, validation, and detailed logging
 * v1.6.4.2 - FIX: Ensure timeout is always cleared to prevent memory leak
 * 
 * @param {Object} state - State object to persist
 * @param {string} logPrefix - Prefix for log messages (e.g., '[DestroyHandler]')
 * @returns {Promise<boolean>} - Promise resolving to true on success, false on failure
 */
export async function persistStateToStorage(state, logPrefix = '[StorageUtils]') {
  // v1.6.4.1 - FIX Bug #1: Log at start of persist
  console.log(`${logPrefix} Starting storage persist...`);
  
  // v1.6.4.1 - FIX Bug #1: Validate state before attempting storage
  if (!state) {
    console.error(`${logPrefix} Cannot persist: state is null/undefined`);
    return false;
  }
  
  if (!state.tabs || !Array.isArray(state.tabs)) {
    console.error(`${logPrefix} Cannot persist: state.tabs is invalid`);
    return false;
  }
  
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.warn(`${logPrefix} Storage API not available, cannot persist`);
    return false;
  }

  const tabCount = state.tabs.length;
  console.log(`${logPrefix} Persisting ${tabCount} tabs to storage...`);
  
  // v1.6.4.1 - FIX Bug #1: Create timeout with cleanup to prevent race condition
  const timeout = createTimeoutPromise(STORAGE_TIMEOUT_MS, 'storage.local.set');
  
  try {
    // v1.6.4.1 - FIX Bug #1: Wrap storage.local.set with timeout
    const storagePromise = browserAPI.storage.local.set({ [STATE_KEY]: state });
    
    await Promise.race([storagePromise, timeout.promise]);
    
    console.log(`${logPrefix} Persisted state to storage (${tabCount} tabs)`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} Failed to persist to storage:`, err.message || err);
    return false;
  } finally {
    // v1.6.4.2 - FIX: Always clear timeout to prevent memory leak
    timeout.clear();
  }
}
