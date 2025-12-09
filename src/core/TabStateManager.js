/**
 * TabStateManager
 * Manages per-tab state using browser.sessions API
 * v1.6.3.7-v3 - API #3: sessions API for per-tab state management
 *
 * Purpose:
 * - Store tab-specific Quick Tab state that survives page refresh
 * - Automatically cleaned up when tab closes (no memory leaks)
 * - Provides robust alternative to in-memory state tracking
 *
 * Keys used:
 * - 'current-quick-tab': Tracks which Quick Tab is currently focused in a tab
 * - 'ui-state': Stores per-tab UI preferences (sidebar state, theme, etc.)
 * - 'has-quick-tab': Tracks whether this tab has Quick Tabs
 *
 * @module TabStateManager
 */

/**
 * Check if sessions API is available
 * @returns {boolean} True if browser.sessions API is available
 */
function isSessionsApiAvailable() {
  return typeof browser !== 'undefined' &&
    browser.sessions &&
    typeof browser.sessions.setTabValue === 'function' &&
    typeof browser.sessions.getTabValue === 'function';
}

/**
 * Store which Quick Tab is currently focused in a specific tab
 * v1.6.3.7-v3 - API #3: Use sessions.setTabValue for persistence
 * @param {number} tabId - Browser tab ID
 * @param {string} quickTabId - Quick Tab ID (or null to clear)
 * @returns {Promise<boolean>} True if saved successfully
 */
export async function setCurrentQuickTab(tabId, quickTabId) {
  if (!isSessionsApiAvailable()) {
    console.warn('[TabStateManager] sessions API not available');
    return false;
  }

  if (!tabId || typeof tabId !== 'number') {
    console.warn('[TabStateManager] Invalid tabId:', tabId);
    return false;
  }

  const metadata = {
    currentQuickTabId: quickTabId,
    setAt: Date.now(),
    tabId: tabId
  };

  try {
    await browser.sessions.setTabValue(tabId, 'current-quick-tab', metadata);
    console.log('[TabStateManager] Set current Quick Tab for tab', tabId, ':', quickTabId);
    return true;
  } catch (err) {
    console.error('[TabStateManager] Failed to set current Quick Tab:', err.message);
    return false;
  }
}

/**
 * Retrieve which Quick Tab is focused in a specific tab
 * v1.6.3.7-v3 - API #3: Use sessions.getTabValue for retrieval
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<string|null>} Quick Tab ID or null
 */
export async function getCurrentQuickTab(tabId) {
  if (!isSessionsApiAvailable()) {
    console.warn('[TabStateManager] sessions API not available');
    return null;
  }

  if (!tabId || typeof tabId !== 'number') {
    console.warn('[TabStateManager] Invalid tabId:', tabId);
    return null;
  }

  try {
    const metadata = await browser.sessions.getTabValue(tabId, 'current-quick-tab');

    if (!metadata) {
      console.log('[TabStateManager] No current Quick Tab for tab', tabId);
      return null;
    }

    console.log('[TabStateManager] Retrieved current Quick Tab for tab', tabId, ':', metadata.currentQuickTabId);
    return metadata.currentQuickTabId;
  } catch (err) {
    // Tab may not exist or have no value set
    console.log('[TabStateManager] Could not get current Quick Tab for tab', tabId, ':', err.message);
    return null;
  }
}

/**
 * Default UI state values
 * @private
 */
const DEFAULT_UI_STATE = {
  sidebarCollapsed: false,
  sidebarWidth: 300,
  theme: 'auto'
};

/**
 * Store per-tab UI preferences
 * v1.6.3.7-v3 - API #3: Persist UI state per tab
 * @param {number} tabId - Browser tab ID
 * @param {Object} uiState - UI state object
 * @param {boolean} [uiState.sidebarCollapsed] - Whether sidebar is collapsed
 * @param {number} [uiState.sidebarWidth] - Sidebar width in pixels
 * @param {string} [uiState.theme] - Theme preference ('auto', 'light', 'dark')
 * @returns {Promise<boolean>} True if saved successfully
 */
export async function setTabUIState(tabId, uiState) {
  if (!isSessionsApiAvailable()) {
    console.warn('[TabStateManager] sessions API not available');
    return false;
  }

  if (!tabId || typeof tabId !== 'number') {
    console.warn('[TabStateManager] Invalid tabId:', tabId);
    return false;
  }

  const state = {
    sidebarCollapsed: uiState.sidebarCollapsed ?? DEFAULT_UI_STATE.sidebarCollapsed,
    sidebarWidth: uiState.sidebarWidth ?? DEFAULT_UI_STATE.sidebarWidth,
    theme: uiState.theme ?? DEFAULT_UI_STATE.theme,
    setAt: Date.now()
  };

  try {
    await browser.sessions.setTabValue(tabId, 'ui-state', state);
    console.log('[TabStateManager] Saved UI state for tab', tabId);
    return true;
  } catch (err) {
    console.error('[TabStateManager] Failed to save UI state:', err.message);
    return false;
  }
}

/**
 * Retrieve per-tab UI preferences
 * v1.6.3.7-v3 - API #3: Get UI state with defaults
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<Object>} UI state object (defaults if not set)
 */
export async function getTabUIState(tabId) {
  if (!isSessionsApiAvailable()) {
    console.warn('[TabStateManager] sessions API not available');
    return { ...DEFAULT_UI_STATE };
  }

  if (!tabId || typeof tabId !== 'number') {
    console.warn('[TabStateManager] Invalid tabId:', tabId);
    return { ...DEFAULT_UI_STATE };
  }

  try {
    const state = await browser.sessions.getTabValue(tabId, 'ui-state');

    if (!state) {
      return { ...DEFAULT_UI_STATE };
    }

    return {
      sidebarCollapsed: state.sidebarCollapsed ?? DEFAULT_UI_STATE.sidebarCollapsed,
      sidebarWidth: state.sidebarWidth ?? DEFAULT_UI_STATE.sidebarWidth,
      theme: state.theme ?? DEFAULT_UI_STATE.theme
    };
  } catch (err) {
    console.log('[TabStateManager] Could not get UI state for tab', tabId, ':', err.message);
    return { ...DEFAULT_UI_STATE };
  }
}

/**
 * Record whether this tab has Quick Tabs
 * v1.6.3.7-v3 - API #3: Track tabs with Quick Tabs
 * @param {number} tabId - Browser tab ID
 * @param {boolean} hasQuickTab - Whether tab has Quick Tabs
 * @returns {Promise<boolean>} True if saved successfully
 */
export async function recordTabHasQuickTab(tabId, hasQuickTab) {
  if (!isSessionsApiAvailable()) {
    console.warn('[TabStateManager] sessions API not available');
    return false;
  }

  if (!tabId || typeof tabId !== 'number') {
    console.warn('[TabStateManager] Invalid tabId:', tabId);
    return false;
  }

  try {
    await browser.sessions.setTabValue(tabId, 'has-quick-tab', {
      value: hasQuickTab,
      recordedAt: Date.now()
    });
    console.log('[TabStateManager] Recorded has-quick-tab for tab', tabId, ':', hasQuickTab);
    return true;
  } catch (err) {
    console.error('[TabStateManager] Failed to record has-quick-tab:', err.message);
    return false;
  }
}

/**
 * Check if tab has Quick Tabs recorded
 * v1.6.3.7-v3 - API #3: Query tab Quick Tab status
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<boolean>} True if tab has Quick Tabs
 */
export async function checkTabHasQuickTab(tabId) {
  if (!isSessionsApiAvailable()) {
    return false;
  }

  if (!tabId || typeof tabId !== 'number') {
    return false;
  }

  try {
    const result = await browser.sessions.getTabValue(tabId, 'has-quick-tab');
    return result?.value === true;
  } catch (_err) {
    return false;
  }
}

/**
 * Clear all tab-specific state for a tab
 * v1.6.3.7-v3 - API #3: Manual cleanup (usually automatic when tab closes)
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clearTabState(tabId) {
  if (!isSessionsApiAvailable()) {
    return false;
  }

  if (!tabId || typeof tabId !== 'number') {
    return false;
  }

  try {
    await browser.sessions.removeTabValue(tabId, 'current-quick-tab');
    await browser.sessions.removeTabValue(tabId, 'ui-state');
    await browser.sessions.removeTabValue(tabId, 'has-quick-tab');
    console.log('[TabStateManager] Cleared all state for tab', tabId);
    return true;
  } catch (err) {
    console.log('[TabStateManager] Could not clear state for tab', tabId, ':', err.message);
    return false;
  }
}

// Export class-like default object for convenience
export default {
  setCurrentQuickTab,
  getCurrentQuickTab,
  setTabUIState,
  getTabUIState,
  recordTabHasQuickTab,
  checkTabHasQuickTab,
  clearTabState,
  isSessionsApiAvailable
};
