// Quick Tabs Manager Sidebar Script
// Manages display and interaction with Quick Tabs across all containers
// v1.6.3.5-v6 - FIX Diagnostic Issue #5: Added comprehensive logging for UI state changes
// v1.6.3.5-v8 - FIX Diagnostic Issues #6, #7, #10:
//   - Issue #6: Clear quickTabHostInfo on Close All
//   - Issue #7: Clear phantom Quick Tabs via coordinated clear
//   - Issue #10: Enhanced logging with affected IDs
// v1.6.3.5-v11 - FIX Issue #6: Manager list updates when last Quick Tab closed
//   - Handle QUICK_TAB_DELETED message from background
//   - Properly clear inMemoryTabsCache when tabs legitimately reach 0
//   - Ensure renderUI() is called after deletion
//   - Fix _isSuspiciousStorageDrop to recognize single-tab deletions as legitimate
// v1.6.3.6 - FIX Issue #3: Added comprehensive logging to Close All button handler
//   - Logs button click, action dispatch, response, and completion timing

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';

// Issue #2: Browser tab metadata cache to avoid repeated API calls
const browserTabInfoCache = new Map();
const BROWSER_TAB_CACHE_TTL_MS = 30000; // Cache browser tab info for 30 seconds

/**
 * Issue #1: Group Quick Tabs by their originTabId
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @returns {Map<number|string, { quickTabs: Array, tabInfo: { title: string, url: string } | null }>}
 *   Key is originTabId (number) or 'orphaned' (string) for tabs without originTabId
 */
function groupQuickTabsByOriginTab(quickTabs) {
  const groups = new Map();
  
  if (!quickTabs || !Array.isArray(quickTabs)) {
    return groups;
  }
  
  for (const tab of quickTabs) {
    const originTabId = tab.originTabId;
    
    // Determine group key - use 'orphaned' for null/undefined originTabId
    const groupKey = (originTabId != null) ? originTabId : 'orphaned';
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        quickTabs: [],
        tabInfo: null // Will be populated by fetchBrowserTabInfo
      });
    }
    
    groups.get(groupKey).quickTabs.push(tab);
  }
  
  console.log('[Manager] Grouped Quick Tabs by origin:', {
    totalTabs: quickTabs.length,
    groupCount: groups.size,
    groupKeys: [...groups.keys()]
  });
  
  return groups;
}

/**
 * Issue #2: Fetch browser tab metadata with caching
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<{ title: string, url: string, favIconUrl?: string } | null>}
 */
async function fetchBrowserTabInfo(tabId) {
  // Check cache first
  const cached = browserTabInfoCache.get(tabId);
  if (cached && (Date.now() - cached.timestamp) < BROWSER_TAB_CACHE_TTL_MS) {
    return cached.data;
  }
  
  try {
    const tab = await browser.tabs.get(tabId);
    const tabInfo = {
      title: tab.title || `Tab ${tabId}`,
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || null
    };
    
    // Cache the result
    browserTabInfoCache.set(tabId, {
      data: tabInfo,
      timestamp: Date.now()
    });
    
    return tabInfo;
  } catch (err) {
    // Tab may be closed - cache null result briefly
    console.log(`[Manager] Could not fetch tab info for ${tabId}:`, err.message);
    browserTabInfoCache.set(tabId, {
      data: null,
      timestamp: Date.now()
    });
    return null;
  }
}

/**
 * Issue #3: Load collapse state from storage
 * @returns {Promise<Object>} Collapse state map { [originTabId]: boolean }
 */
async function loadCollapseState() {
  try {
    const result = await browser.storage.local.get(COLLAPSE_STATE_KEY);
    return result?.[COLLAPSE_STATE_KEY] || {};
  } catch (err) {
    console.error('[Manager] Error loading collapse state:', err);
    return {};
  }
}

/**
 * Issue #3: Save collapse state to storage
 * @param {Object} collapseState - Collapse state map { [originTabId]: boolean }
 */
async function saveCollapseState(collapseState) {
  try {
    await browser.storage.local.set({ [COLLAPSE_STATE_KEY]: collapseState });
    console.log('[Manager] Saved collapse state:', collapseState);
  } catch (err) {
    console.error('[Manager] Error saving collapse state:', err);
  }
}

// v1.6.3.4-v9 - FIX Issue #15: Error notification styles (code review feedback)
const ERROR_NOTIFICATION_STYLES = {
  position: 'fixed',
  top: '10px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#d32f2f',
  color: 'white',
  padding: '8px 16px',
  borderRadius: '4px',
  zIndex: '10000',
  fontSize: '14px'
};

// v1.6.3.4-v5 - FIX Issue #4: Pending operations tracking
// Prevents spam-clicking by tracking in-progress restore/minimize operations
const PENDING_OPERATIONS = new Set();
const OPERATION_TIMEOUT_MS = 2000; // Clear pending state after 2 seconds

// v1.6.3.5-v2 - FIX Report 2 Issue #2: Lowered from 300ms to 50ms for faster UI updates
const STORAGE_READ_DEBOUNCE_MS = 50;
let storageReadDebounceTimer = null;
let lastStorageReadTime = 0;

// v1.6.3.5-v2 - FIX Report 1 Issue #2: Track current tab ID for Quick Tab origin filtering
let currentBrowserTabId = null;

// v1.6.3.5-v2 - FIX Code Review: Constants for saveId patterns used in corruption detection
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';

// v1.6.3.5-v2 - FIX Code Review: DOM verification delay after restore
const DOM_VERIFICATION_DELAY_MS = 500;

// v1.6.3.4-v6 - FIX Issue #5: Track last rendered state hash to avoid unnecessary re-renders
let lastRenderedStateHash = 0;

// v1.6.3.5-v4 - FIX Diagnostic Issue #2: In-memory state cache to prevent list clearing during storage storms
// v1.6.3.5-v6 - ARCHITECTURE NOTE (Issue #6 - Manager as Pure Consumer):
//   This cache exists as a FALLBACK to protect against storage storms/corruption.
//   It is NOT a competing authority with background's state.
//   Normal operation: Manager receives state from storage.onChanged/messages
//   Recovery operation: Manager uses cache when storage returns suspicious 0-tab results
//   The cache should NEVER be used to overwrite background's authoritative state.
//   See v1.6.3.5-architectural-issues.md Architecture Issue #6 for context.
let inMemoryTabsCache = [];
let lastKnownGoodTabCount = 0;
const MIN_TABS_FOR_CACHE_PROTECTION = 1; // Protect cache if we have at least 1 tab

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

// v1.6.3.5-v3 - FIX Architecture Phase 3: Track which tab hosts each Quick Tab
// Key: quickTabId, Value: { hostTabId, lastUpdate }
const quickTabHostInfo = new Map();

// v1.6.3.5-v7 - FIX Issue #7: Track when Manager's internal state was last updated (from any source)
let lastLocalUpdateTime = 0;

/**
 * Compute hash of state for deduplication
 * v1.6.3.4-v6 - FIX Issue #5: Prevent unnecessary re-renders
 * @param {Object} state - State to hash
 * @returns {number} Hash value
 */
function computeStateHash(state) {
  if (!state) return 0;
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash;
}

// v1.6.3.5-v3 - FIX Architecture Phase 1: Listen for state updates from background
// v1.6.3.5-v11 - FIX Issue #6: Handle QUICK_TAB_DELETED message and deletion via QUICK_TAB_STATE_UPDATED
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'QUICK_TAB_STATE_UPDATED') {
    console.log('[Manager] Received QUICK_TAB_STATE_UPDATED:', {
      quickTabId: message.quickTabId,
      changes: message.changes,
      source: message.originalSource
    });
    
    // v1.6.3.5-v11 - FIX Issue #6: Check if this is a deletion notification
    if (message.changes?.deleted === true || message.originalSource === 'destroy') {
      handleStateDeletedMessage(message.quickTabId);
    } else if (message.quickTabId && message.changes) {
      // Update local state cache
      handleStateUpdateMessage(message.quickTabId, message.changes);
    }
    
    // Re-render UI
    renderUI();
    sendResponse({ received: true });
    return true;
  }
  
  // v1.6.3.5-v11 - FIX Issue #6: Handle explicit QUICK_TAB_DELETED message
  if (message.type === 'QUICK_TAB_DELETED') {
    console.log('[Manager] Received QUICK_TAB_DELETED:', {
      quickTabId: message.quickTabId,
      source: message.source
    });
    
    handleStateDeletedMessage(message.quickTabId);
    renderUI();
    sendResponse({ received: true });
    return true;
  }
  
  return false;
});

/**
 * Handle state update message from background
 * v1.6.3.5-v3 - FIX Architecture Phase 1: Update local state from message
 * v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime for accurate "Last sync"
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function handleStateUpdateMessage(quickTabId, changes) {
  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }
  
  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    // Update existing tab
    Object.assign(quickTabsState.tabs[existingIndex], changes);
    console.log('[Manager] Updated tab from message:', quickTabId);
  } else if (changes.url) {
    // Add new tab
    quickTabsState.tabs.push({ id: quickTabId, ...changes });
    console.log('[Manager] Added new tab from message:', quickTabId);
  }
  
  // Track host tab info if provided
  if (changes.originTabId) {
    quickTabHostInfo.set(quickTabId, {
      hostTabId: changes.originTabId,
      lastUpdate: Date.now()
    });
  }
  
  // Update timestamp
  quickTabsState.timestamp = Date.now();
  
  // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive state updates
  lastLocalUpdateTime = Date.now();
}

/**
 * Handle state deleted message from background
 * v1.6.3.5-v11 - FIX Issue #6: Remove deleted Quick Tab from local state and cache
 *   This ensures Manager list updates when a Quick Tab is closed via UI or Manager command.
 * @param {string} quickTabId - Quick Tab ID that was deleted
 */
function handleStateDeletedMessage(quickTabId) {
  console.log('[Manager] Handling state:deleted for:', quickTabId);
  
  // Remove from quickTabsState
  const wasRemoved = _removeTabFromState(quickTabId);
  if (wasRemoved) {
    _updateCacheAfterDeletion(quickTabId);
  }
  
  // Remove from host info tracking
  _removeFromHostInfo(quickTabId);
  
  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();
}

/**
 * Remove tab from quickTabsState
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID to remove
 * @returns {boolean} True if tab was removed
 */
function _removeTabFromState(quickTabId) {
  if (!quickTabsState.tabs || !Array.isArray(quickTabsState.tabs)) {
    return false;
  }
  
  const beforeCount = quickTabsState.tabs.length;
  quickTabsState.tabs = quickTabsState.tabs.filter(t => t.id !== quickTabId);
  const afterCount = quickTabsState.tabs.length;
  
  if (beforeCount === afterCount) {
    return false;
  }
  
  console.log('[Manager] Removed tab from local state:', {
    quickTabId,
    beforeCount,
    afterCount
  });
  return true;
}

/**
 * Update cache after tab deletion
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID that was removed
 */
function _updateCacheAfterDeletion(quickTabId) {
  const afterCount = quickTabsState.tabs?.length ?? 0;
  
  if (afterCount === 0) {
    console.log('[Manager] Last Quick Tab deleted - clearing cache');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
  } else {
    // Update cache to remove this tab
    inMemoryTabsCache = inMemoryTabsCache.filter(t => t.id !== quickTabId);
    lastKnownGoodTabCount = afterCount;
  }
}

/**
 * Remove from host info tracking
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID to remove from tracking
 */
function _removeFromHostInfo(quickTabId) {
  if (quickTabHostInfo.has(quickTabId)) {
    quickTabHostInfo.delete(quickTabId);
    console.log('[Manager] Removed from quickTabHostInfo:', quickTabId);
  }
}

/**
 * Send MANAGER_COMMAND to background for remote Quick Tab control
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Manager can control Quick Tabs in any tab
 * v1.6.3.5-v6 - ARCHITECTURE NOTE: This is the PREFERRED approach for Quick Tab control.
 *   Background routes commands to specific host tabs via quickTabHostTabs Map.
 *   This enables per-tab ownership and prevents cross-tab ghosting.
 *   
 * Currently used for: none (minimize/restore still use targeted messaging)
 * Should be used for: MINIMIZE_QUICK_TAB, RESTORE_QUICK_TAB, CLOSE_QUICK_TAB, FOCUS_QUICK_TAB
 * 
 * @param {string} command - Command to execute (MINIMIZE_QUICK_TAB, RESTORE_QUICK_TAB, etc.)
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<Object>} Response from background
 */
async function _sendManagerCommand(command, quickTabId) {
  console.log('[Manager] Sending MANAGER_COMMAND:', { command, quickTabId });
  
  try {
    const response = await browser.runtime.sendMessage({
      type: 'MANAGER_COMMAND',
      command,
      quickTabId,
      sourceContext: 'sidebar'
    });
    
    console.log('[Manager] Command response:', response);
    return response;
  } catch (err) {
    console.error('[Manager] Failed to send command:', { command, quickTabId, error: err.message });
    return { success: false, error: err.message };
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Cache DOM elements
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');

  // v1.6.3.5-v2 - FIX Report 1 Issue #2: Get current tab ID for origin filtering
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentBrowserTabId = tabs[0].id;
      console.log('[Manager] Current browser tab ID:', currentBrowserTabId);
    }
  } catch (err) {
    console.warn('[Manager] Could not get current tab ID:', err);
  }

  // Load container information from Firefox API
  await loadContainerInfo();

  // Load Quick Tabs state from storage
  await loadQuickTabsState();

  // Render initial UI
  renderUI();

  // Setup event listeners
  setupEventListeners();

  // Auto-refresh every 2 seconds
  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();
  }, 2000);
  
  console.log('[Manager] v1.6.3.5-v3 Message infrastructure initialized');
});

/**
 * Load Firefox Container Tab information
 * Uses contextualIdentities API to get container names, icons, colors
 * Cross-browser: Falls back gracefully if containers not supported (Chrome)
 */
async function loadContainerInfo() {
  try {
    // Cross-browser: Check if contextualIdentities API is available
    // Firefox: Native container support
    // Chrome: No container support, use default
    if (typeof browser.contextualIdentities === 'undefined') {
      console.warn('[Cross-browser] Contextual Identities API not available (Chrome/Edge)');
      // Fallback: Only show default container
      containersData['firefox-default'] = {
        name: 'Default',
        icon: '📁',
        color: 'grey',
        cookieStoreId: 'firefox-default'
      };
      return;
    }

    // Get all Firefox containers
    const containers = await browser.contextualIdentities.query({});

    // Map containers
    containersData = {};
    containers.forEach(container => {
      containersData[container.cookieStoreId] = {
        name: container.name,
        icon: getContainerIcon(container.icon),
        color: container.color,
        colorCode: container.colorCode,
        cookieStoreId: container.cookieStoreId
      };
    });

    // Always add default container
    containersData['firefox-default'] = {
      name: 'Default',
      icon: '📁',
      color: 'grey',
      colorCode: '#808080',
      cookieStoreId: 'firefox-default'
    };

    console.log('Loaded container info:', containersData);
  } catch (err) {
    console.error('Error loading container info:', err);
  }
}

/**
 * Convert Firefox container icon identifier to emoji
 */
function getContainerIcon(icon) {
  const iconMap = {
    fingerprint: '🔒',
    briefcase: '💼',
    dollar: '💰',
    cart: '🛒',
    circle: '⭕',
    gift: '🎁',
    vacation: '🏖️',
    food: '🍴',
    fruit: '🍎',
    pet: '🐾',
    tree: '🌳',
    chill: '❄️',
    fence: '🚧'
  };

  return iconMap[icon] || '📁';
}

/**
 * Check if a URL is valid for Quick Tab
 * v1.6.3.4-v6 - Extracted to reduce loadQuickTabsState complexity
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid
 */
function isValidTabUrl(url) {
  return url && url !== 'undefined' && !String(url).includes('/undefined');
}

/**
 * Filter invalid tabs from state
 * v1.6.3.4-v6 - Extracted to reduce loadQuickTabsState complexity
 * @param {Object} state - State object to filter
 */
function filterInvalidTabs(state) {
  if (!state.tabs || !Array.isArray(state.tabs)) return;
  
  const originalCount = state.tabs.length;
  state.tabs = state.tabs.filter(tab => {
    if (!isValidTabUrl(tab.url)) {
      console.warn('[Manager] Filtering invalid tab:', { id: tab.id, url: tab.url });
      return false;
    }
    return true;
  });
  
  if (state.tabs.length !== originalCount) {
    console.log('[Manager] Filtered', originalCount - state.tabs.length, 'invalid tabs');
  }
}

/**
 * Check if storage read should be debounced
 * v1.6.3.4-v6 - Extracted to reduce loadQuickTabsState complexity
 * Simply uses timing-based debounce (no storage read needed)
 * v1.6.3.5-v2 - FIX Report 2 Issue #2: Reduced debounce from 300ms to 50ms
 * @returns {Promise<void>} Resolves when ready to read
 */
async function checkStorageDebounce() {
  const now = Date.now();
  const timeSinceLastRead = now - lastStorageReadTime;
  
  // If within debounce period, wait the remaining time
  if (timeSinceLastRead < STORAGE_READ_DEBOUNCE_MS) {
    const waitTime = STORAGE_READ_DEBOUNCE_MS - timeSinceLastRead;
    console.log('[Manager] Debouncing storage read, waiting', waitTime, 'ms');
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastStorageReadTime = Date.now();
}

/**
 * Handle empty storage state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Clear cache when storage is legitimately empty
 *   If storage is empty and cache has only 1 tab, this is a legitimate single-tab deletion.
 *   Sets quickTabsState and logs appropriately - used as flow control signal
 */
function _handleEmptyStorageState() {
  // v1.6.3.5-v11 - FIX Issue #6: Check if this is a legitimate single-tab deletion
  if (inMemoryTabsCache.length === 1) {
    console.log('[Manager] Storage empty with single-tab cache - clearing cache (legitimate deletion)');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    quickTabsState = {};
    return;
  }
  
  // Multiple tabs in cache but storage empty - use cache (potential storm protection)
  if (inMemoryTabsCache.length > 1) {
    console.log('[Manager] Storage returned empty but cache has', inMemoryTabsCache.length, 'tabs - using cache');
    quickTabsState = { tabs: inMemoryTabsCache, timestamp: Date.now() };
  } else {
    // Cache is empty too - normal empty state
    quickTabsState = {};
    console.log('[Manager] Loaded Quick Tabs state: empty');
  }
}

/**
 * Detect and handle storage storm (0 tabs but cache has tabs)
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Allow legitimate single-tab deletions (cache=1, storage=0)
 *   Storage storms are detected when MULTIPLE tabs vanish unexpectedly.
 *   A single tab going to 0 is legitimate user action.
 * @param {Object} state - Storage state
 * @returns {boolean} True if storm detected and handled
 */
function _detectStorageStorm(state) {
  const storageTabs = state.tabs || [];
  
  // No storm if storage has tabs
  if (storageTabs.length !== 0) {
    return false;
  }
  
  // No cache to protect - no storm possible
  if (inMemoryTabsCache.length < MIN_TABS_FOR_CACHE_PROTECTION) {
    return false;
  }
  
  // v1.6.3.5-v11 - FIX Issue #6: Single tab deletion is legitimate, not a storm
  // If cache has exactly 1 tab and storage has 0, user closed the last Quick Tab
  if (inMemoryTabsCache.length === 1) {
    console.log('[Manager] Single tab→0 transition detected - clearing cache (legitimate deletion)');
    // Clear the cache to accept the new 0-tab state
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    return false; // Not a storm - proceed with normal update
  }
  
  // Multiple tabs vanished at once - this IS a storage storm
  console.warn('[Manager] ⚠️ Storage storm detected - 0 tabs in storage but', inMemoryTabsCache.length, 'in cache:', {
    storageTabCount: storageTabs.length,
    cacheTabCount: inMemoryTabsCache.length,
    lastKnownGoodCount: lastKnownGoodTabCount,
    saveId: state.saveId
  });
  quickTabsState = { tabs: inMemoryTabsCache, timestamp: Date.now() };
  console.log('[Manager] Using in-memory cache to prevent list clearing');
  return true;
}

/**
 * Update in-memory cache with valid state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Also update cache when tabs.length is 0 (legitimate deletion)
 *   The cache must be cleared when tabs legitimately reach 0, not just updated when > 0.
 * @param {Array} tabs - Tabs array from storage
 */
function _updateInMemoryCache(tabs) {
  if (tabs.length > 0) {
    inMemoryTabsCache = [...tabs];
    lastKnownGoodTabCount = tabs.length;
    console.log('[Manager] Updated in-memory cache:', { tabCount: tabs.length });
  } else if (lastKnownGoodTabCount === 1) {
    // v1.6.3.5-v11 - FIX Issue #6: Clear cache when going from 1→0 (single-tab deletion)
    console.log('[Manager] Clearing in-memory cache (single-tab deletion detected)');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
  }
  // Note: If lastKnownGoodTabCount > 1 and tabs.length === 0, we don't clear the cache
  // because this might be a storage storm. _detectStorageStorm handles that case.
}

/**
 * Load Quick Tabs state from browser.storage.local
 * v1.6.3 - FIX: Changed from storage.sync to storage.local (storage location since v1.6.0.12)
 * v1.6.3.4-v6 - FIX Issue #1: Debounce reads to avoid mid-transaction reads
 * v1.6.3.5-v4 - FIX Diagnostic Issue #2: Use in-memory cache to protect against storage storms
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read operations
 * Refactored: Extracted helpers to reduce complexity and nesting depth
 */
async function loadQuickTabsState() {
  const loadStartTime = Date.now();
  
  try {
    await checkStorageDebounce();
    
    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read start
    console.log('[Manager] Reading Quick Tab state from storage...');
    
    const result = await browser.storage.local.get(STATE_KEY);
    const state = result?.[STATE_KEY];

    if (!state) {
      _handleEmptyStorageState();
      console.log('[Manager] Storage read complete: empty state', {
        source: 'storage.local',
        durationMs: Date.now() - loadStartTime
      });
      return;
    }
    
    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read result
    console.log('[Manager] Storage read result:', {
      tabCount: state.tabs?.length ?? 0,
      saveId: state.saveId,
      timestamp: state.timestamp,
      source: 'storage.local',
      durationMs: Date.now() - loadStartTime
    });
    
    // v1.6.3.4-v6 - FIX Issue #5: Check if state has actually changed
    const newHash = computeStateHash(state);
    if (newHash === lastRenderedStateHash) {
      console.log('[Manager] Storage state unchanged (hash match), skipping update');
      return;
    }
    
    // v1.6.3.5-v4 - FIX Diagnostic Issue #2: Protect against storage storms
    if (_detectStorageStorm(state)) return;
    
    // v1.6.3.5-v4 - Update cache with new valid state
    _updateInMemoryCache(state.tabs || []);
    
    quickTabsState = state;
    filterInvalidTabs(quickTabsState);
    
    // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive new state from storage
    lastLocalUpdateTime = Date.now();
    
    console.log('[Manager] Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('[Manager] Error loading Quick Tabs state:', err);
  }
}

/**
 * Extract tabs from unified state format (v1.6.2.2+)
 * @param {Object} state - Quick Tabs state in unified format
 * @returns {{ allTabs: Array, latestTimestamp: number }} - Extracted tabs and timestamp
 */
function extractFromUnifiedFormat(state) {
  const tabs = Array.isArray(state.tabs) ? state.tabs : [];
  return {
    allTabs: tabs,
    latestTimestamp: state.timestamp || 0
  };
}

/**
 * Extract tabs from legacy container format (pre-v1.6.2.2)
 * @param {Object} state - Quick Tabs state in legacy format
 * @returns {{ allTabs: Array, latestTimestamp: number }} - Extracted tabs and timestamp
 */
function extractFromLegacyFormat(state) {
  const allTabs = [];
  let latestTimestamp = 0;

  const containerKeys = Object.keys(state).filter(
    key => key !== 'saveId' && key !== 'timestamp'
  );

  for (const cookieStoreId of containerKeys) {
    const containerState = state[cookieStoreId];
    const hasTabs = containerState?.tabs && Array.isArray(containerState.tabs);
    
    if (hasTabs) {
      allTabs.push(...containerState.tabs);
      latestTimestamp = Math.max(latestTimestamp, containerState.timestamp || 0);
    }
  }

  return { allTabs, latestTimestamp };
}

/**
 * Check if state is in unified format (v1.6.2.2+)
 * @param {Object} state - Quick Tabs state
 * @returns {boolean} - True if unified format
 */
function isUnifiedFormat(state) {
  return state?.tabs && Array.isArray(state.tabs);
}

/**
 * Extract tabs from state (handles both unified and legacy formats)
 * @param {Object} state - Quick Tabs state
 * @returns {{ allTabs: Array, latestTimestamp: number }} - Extracted tabs and timestamp
 */
function extractTabsFromState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { allTabs: [], latestTimestamp: 0 };
  }

  if (isUnifiedFormat(state)) {
    return extractFromUnifiedFormat(state);
  }

  return extractFromLegacyFormat(state);
}

/**
 * Update UI stats (total tabs and last sync time)
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log last sync timestamp updates
 * v1.6.3.5-v7 - FIX Issue #7: Use lastLocalUpdateTime for accurate "Last sync"
 *   The timestamp now reflects when Manager's internal state was updated from ANY source
 *   (storage read, message, or reconciliation), not just storage write timestamp.
 * @param {number} totalTabs - Number of Quick Tabs
 * @param {number} latestTimestamp - Timestamp of last sync (from storage, used as fallback)
 */
function updateUIStats(totalTabs, latestTimestamp) {
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  // v1.6.3.5-v7 - FIX Issue #7: Prefer lastLocalUpdateTime over storage timestamp
  // This reflects when Manager actually received updates, not when storage was written
  const effectiveTimestamp = lastLocalUpdateTime > 0 ? lastLocalUpdateTime : latestTimestamp;
  
  if (effectiveTimestamp > 0) {
    const date = new Date(effectiveTimestamp);
    const timeStr = date.toLocaleTimeString();
    lastSyncEl.textContent = `Last sync: ${timeStr}`;
    
    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log last sync update
    console.log('[Manager] Last sync updated:', {
      timestamp: effectiveTimestamp,
      formatted: timeStr,
      totalTabs,
      reason: lastLocalUpdateTime > 0 ? 'local state update' : 'storage state timestamp',
      localUpdateTime: lastLocalUpdateTime,
      storageTimestamp: latestTimestamp
    });
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
    console.log('[Manager] Last sync: Never (no timestamp)');
  }
}

/**
 * Create global section element for displaying all Quick Tabs
 * @param {number} totalTabs - Number of Quick Tabs
 * @returns {HTMLDivElement} - Section element
 */
function createGlobalSection(totalTabs) {
  const section = document.createElement('div');
  section.className = 'container-section';
  section.dataset.containerId = 'global';

  // Section header
  const header = document.createElement('h2');
  header.className = 'container-header';

  const icon = document.createElement('span');
  icon.className = 'container-icon';
  icon.textContent = '📑';

  const name = document.createElement('span');
  name.className = 'container-name';
  name.textContent = 'All Quick Tabs';

  const count = document.createElement('span');
  count.className = 'container-count';
  count.textContent = `(${totalTabs} tab${totalTabs !== 1 ? 's' : ''})`;

  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(count);
  section.appendChild(header);

  return section;
}

/**
 * Render the entire UI based on current state
 * v1.6.3 - FIX: Updated to handle unified format (v1.6.2.2+) instead of container-based format
 * v1.6.3.4-v10 - FIX Issue #4: Check domVerified property for warning indicator
 * v1.6.3.5-v4 - FIX Diagnostic Issue #7: Add logging for UI state changes
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Comprehensive UI list change logging
 * v1.6.4.8 - Cross-Tab Grouping: Group Quick Tabs by originTabId with collapsible sections
 * 
 * Unified format:
 * { tabs: [...], saveId: '...', timestamp: ... }
 * 
 * Each tab in tabs array has:
 * - id, url, title
 * - visibility: { minimized, soloedOnTabs, mutedOnTabs }
 * - position, size
 * - domVerified (optional): false means restore failed to create visible window
 */
async function renderUI() {
  const renderStartTime = Date.now();
  
  // Extract tabs from state (handles both unified and legacy formats)
  const { allTabs, latestTimestamp } = extractTabsFromState(quickTabsState);
  const totalTabs = allTabs.length;

  // v1.6.3.5-v4 - FIX Diagnostic Issue #7: Log UI rebuild with tab details
  const activeTabs = allTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = allTabs.filter(t => isTabMinimizedHelper(t));
  
  // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Comprehensive UI list logging
  console.log('[Manager] UI Rebuild starting:', {
    totalTabs,
    activeCount: activeTabs.length,
    minimizedCount: minimizedTabs.length,
    cacheCount: inMemoryTabsCache.length,
    lastRenderedHash: lastRenderedStateHash,
    trigger: 'renderUI()',
    timestamp: Date.now()
  });
  
  // Log tab IDs for debugging
  console.log('[Manager] UI List contents:', {
    activeTabIds: activeTabs.map(t => ({ id: t.id, url: t.url?.substring(0, 50) })),
    minimizedTabIds: minimizedTabs.map(t => ({ id: t.id, minimized: true }))
  });

  // Update stats
  updateUIStats(totalTabs, latestTimestamp);

  // Show/hide empty state
  if (totalTabs === 0) {
    containersList.style.display = 'none';
    emptyState.style.display = 'flex';
    console.log('[Manager] UI showing empty state (0 tabs)');
    return;
  }

  containersList.style.display = 'block';
  emptyState.style.display = 'none';

  // Clear and populate containers list
  containersList.innerHTML = '';

  // v1.6.4.8 - Cross-Tab Grouping: Group Quick Tabs by originTabId
  const groups = groupQuickTabsByOriginTab(allTabs);
  
  // Issue #3: Load collapse state
  const collapseState = await loadCollapseState();
  
  // Issue #7: Fetch tab info for each group and render
  const section = createGlobalSection(totalTabs);
  const groupsContainer = document.createElement('div');
  groupsContainer.className = 'tab-groups-container';
  
  // Sort groups: numbered tabs first (sorted by ID), orphaned last
  const sortedGroupKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'orphaned') return 1;
    if (b === 'orphaned') return -1;
    return Number(a) - Number(b);
  });
  
  for (const groupKey of sortedGroupKeys) {
    const group = groups.get(groupKey);
    
    // Skip empty groups
    if (!group.quickTabs || group.quickTabs.length === 0) {
      continue;
    }
    
    // Issue #2: Fetch browser tab info for non-orphaned groups
    let tabInfo = null;
    if (groupKey !== 'orphaned') {
      tabInfo = await fetchBrowserTabInfo(groupKey);
      group.tabInfo = tabInfo;
    }
    
    // Issue #4: Create <details> element for group
    const detailsEl = await renderTabGroup(groupKey, group, collapseState);
    groupsContainer.appendChild(detailsEl);
  }
  
  section.appendChild(groupsContainer);
  containersList.appendChild(section);
  
  // Issue #6: Attach event listeners for collapse toggle
  attachCollapseEventListeners(groupsContainer, collapseState);
  
  // v1.6.3.5-v4 - FIX Diagnostic Issue #7: Update rendered state hash
  lastRenderedStateHash = computeStateHash(quickTabsState);
  
  // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log render completion
  const renderDuration = Date.now() - renderStartTime;
  console.log('[Manager] UI Rebuild complete:', {
    renderedActive: activeTabs.length,
    renderedMinimized: minimizedTabs.length,
    groupCount: groups.size,
    newHash: lastRenderedStateHash,
    durationMs: renderDuration
  });
}

/**
 * Issue #4: Render a single tab group as a <details> element
 * @param {number|string} groupKey - originTabId or 'orphaned'
 * @param {Object} group - { quickTabs: Array, tabInfo: Object | null }
 * @param {Object} collapseState - Current collapse state
 * @returns {HTMLDetailsElement}
 */
async function renderTabGroup(groupKey, group, collapseState) {
  const details = document.createElement('details');
  details.className = 'tab-group';
  details.dataset.originTabId = String(groupKey);
  
  // Issue #3: Apply saved collapse state (default: expanded)
  const isCollapsed = collapseState[groupKey] === true;
  details.open = !isCollapsed;
  
  // Create summary (header)
  const summary = document.createElement('summary');
  summary.className = 'tab-group-header';
  
  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  
  if (groupKey === 'orphaned') {
    // Orphaned group uses folder icon
    favicon.src = '';
    favicon.style.display = 'none';
    const folderIcon = document.createElement('span');
    folderIcon.className = 'tab-favicon-fallback';
    folderIcon.textContent = '🗂️';
    summary.appendChild(folderIcon);
  } else if (group.tabInfo?.favIconUrl) {
    favicon.src = group.tabInfo.favIconUrl;
    favicon.onerror = () => {
      favicon.style.display = 'none';
      // Add fallback icon
      const fallback = document.createElement('span');
      fallback.className = 'tab-favicon-fallback';
      fallback.textContent = '🌐';
      summary.insertBefore(fallback, summary.firstChild.nextSibling);
    };
    summary.appendChild(favicon);
  } else {
    // No favicon - use globe icon
    favicon.style.display = 'none';
    const fallback = document.createElement('span');
    fallback.className = 'tab-favicon-fallback';
    fallback.textContent = '🌐';
    summary.appendChild(fallback);
  }
  
  // Title
  const title = document.createElement('span');
  title.className = 'tab-group-title';
  
  if (groupKey === 'orphaned') {
    title.textContent = 'Orphaned Quick Tabs';
  } else if (group.tabInfo?.title) {
    title.textContent = group.tabInfo.title;
    title.title = group.tabInfo.url || ''; // Tooltip with URL
  } else {
    // Tab is closed or info unavailable
    title.textContent = `Tab ${groupKey} (Closed)`;
    title.classList.add('closed-tab');
  }
  summary.appendChild(title);
  
  // Count badge
  const count = document.createElement('span');
  count.className = 'tab-group-count';
  count.textContent = `(${group.quickTabs.length})`;
  summary.appendChild(count);
  
  details.appendChild(summary);
  
  // Content (Quick Tab items)
  const content = document.createElement('div');
  content.className = 'tab-group-content';
  
  // Sort: active tabs first, then minimized
  const sortedTabs = [...group.quickTabs].sort((a, b) => {
    const aMin = isTabMinimizedHelper(a) ? 1 : 0;
    const bMin = isTabMinimizedHelper(b) ? 1 : 0;
    return aMin - bMin;
  });
  
  for (const tab of sortedTabs) {
    const isMinimized = isTabMinimizedHelper(tab);
    content.appendChild(renderQuickTabItem(tab, 'global', isMinimized));
  }
  
  details.appendChild(content);
  
  return details;
}

/**
 * Issue #6: Attach event listeners for collapse toggle
 * @param {HTMLElement} container - Container with <details> elements
 * @param {Object} collapseState - Current collapse state (will be modified)
 */
function attachCollapseEventListeners(container, collapseState) {
  const detailsElements = container.querySelectorAll('details.tab-group');
  
  for (const details of detailsElements) {
    details.addEventListener('toggle', async () => {
      const originTabId = details.dataset.originTabId;
      const isNowCollapsed = !details.open;
      
      console.log('[Manager] Tab group toggle:', {
        originTabId,
        isCollapsed: isNowCollapsed
      });
      
      // Update collapse state
      if (isNowCollapsed) {
        collapseState[originTabId] = true;
      } else {
        delete collapseState[originTabId]; // Remove if expanded (default)
      }
      
      // Issue #3: Save to storage
      await saveCollapseState(collapseState);
    });
  }
}

/**
 * Render a single Quick Tab item
 */
/**
 * Create favicon element for Quick Tab
 * @param {string} url - Tab URL
 * @returns {HTMLImageElement} Favicon element
 */
function _createFavicon(url) {
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  try {
    const urlObj = new URL(url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    favicon.onerror = () => {
      favicon.style.display = 'none';
    };
  } catch (e) {
    favicon.style.display = 'none';
  }
  return favicon;
}

/**
 * v1.6.3.4-v3 - Helper to get position value from flat or nested format
 * @param {Object} tab - Quick Tab data
 * @param {string} flatKey - Key for flat format (e.g., 'width')
 * @param {string} nestedKey - Key for nested format (e.g., 'size')
 * @param {string} prop - Property name (e.g., 'width')
 * @returns {number|undefined} The value or undefined
 */
function _getValue(tab, flatKey, nestedKey, prop) {
  return tab[flatKey] ?? tab[nestedKey]?.[prop];
}

/**
 * v1.6.3.4 - Helper to format size and position string for tab metadata
 * Extracted to reduce complexity in _createTabInfo
 * FIX Issue #3: Only show position if both left and top are defined
 * v1.6.3.4-v3 - FIX TypeError: Handle both flat and nested position/size formats
 * @param {Object} tab - Quick Tab data
 * @returns {string|null} Formatted size/position string or null
 */
function _formatSizePosition(tab) {
  // v1.6.3.4-v3 - FIX TypeError: Handle both flat (width/height) and nested (size.width) formats
  const width = _getValue(tab, 'width', 'size', 'width');
  const height = _getValue(tab, 'height', 'size', 'height');
  
  if (!width || !height) {
    return null;
  }
  
  let sizeStr = `${Math.round(width)}×${Math.round(height)}`;
  
  // v1.6.3.4-v3 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
  const left = _getValue(tab, 'left', 'position', 'left');
  const top = _getValue(tab, 'top', 'position', 'top');
  
  // v1.6.3.4 - FIX Issue #3: Only show position if both values exist
  if (left != null && top != null) {
    sizeStr += ` at (${Math.round(left)}, ${Math.round(top)})`;
  }
  
  return sizeStr;
}

/**
 * Create tab info section (title + metadata)
 * v1.6.3.4 - FIX Bug #6: Added position display (x, y) alongside size
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Tab info element
 */
function _createTabInfo(tab, isMinimized) {
  const tabInfo = document.createElement('div');
  tabInfo.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Quick Tab';
  title.title = tab.title || tab.url;

  const meta = document.createElement('div');
  meta.className = 'tab-meta';

  // Build metadata string
  const metaParts = [];

  if (isMinimized) {
    metaParts.push('Minimized');
  }

  if (tab.activeTabId) {
    metaParts.push(`Tab ${tab.activeTabId}`);
  }

  // v1.6.3.4 - FIX Bug #6: Size with position display
  const sizePosition = _formatSizePosition(tab);
  if (sizePosition) {
    metaParts.push(sizePosition);
  }

  if (tab.slotNumber) {
    metaParts.push(`Slot ${tab.slotNumber}`);
  }

  meta.textContent = metaParts.join(' • ');

  tabInfo.appendChild(title);
  tabInfo.appendChild(meta);

  return tabInfo;
}

/**
 * Create action buttons for Quick Tab
 * v1.6.3.4-v5 - FIX Issue #4: Disable restore button when operation in progress (domVerified=false)
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Actions element
 */
function _createTabActions(tab, isMinimized) {
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  // v1.6.3.4-v5 - FIX Issue #4: Check if restore is pending/in-progress
  // domVerified=false means restore was attempted but DOM isn't confirmed yet
  const isRestorePending = !isMinimized && tab.domVerified === false;

  if (!isMinimized) {
    // Active Quick Tab actions: Go to Tab + Minimize
    if (tab.activeTabId) {
      const goToTabBtn = document.createElement('button');
      goToTabBtn.className = 'btn-icon';
      goToTabBtn.textContent = '🔗';
      goToTabBtn.title = `Go to Tab ${tab.activeTabId}`;
      goToTabBtn.dataset.action = 'goToTab';
      goToTabBtn.dataset.tabId = tab.activeTabId;
      actions.appendChild(goToTabBtn);
    }

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'btn-icon';
    minimizeBtn.textContent = '➖';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.dataset.action = 'minimize';
    minimizeBtn.dataset.quickTabId = tab.id;
    // v1.6.3.4-v5 - FIX Issue #4: Disable minimize if restore is pending
    if (isRestorePending) {
      minimizeBtn.disabled = true;
      minimizeBtn.title = 'Restore in progress...';
    }
    actions.appendChild(minimizeBtn);
  } else {
    // Minimized Quick Tab actions: Restore
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn-icon';
    restoreBtn.textContent = '↑';
    restoreBtn.title = 'Restore';
    restoreBtn.dataset.action = 'restore';
    restoreBtn.dataset.quickTabId = tab.id;
    actions.appendChild(restoreBtn);
  }

  // Close button (always available)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.dataset.action = 'close';
  closeBtn.dataset.quickTabId = tab.id;
  actions.appendChild(closeBtn);

  return actions;
}

/**
 * Determine status indicator class based on tab state
 * v1.6.3.4-v10 - FIX Issue #4: Check domVerified for warning indicator
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {string} - CSS class for indicator color
 */
function _getIndicatorClass(tab, isMinimized) {
  // Minimized tabs show yellow indicator
  if (isMinimized) {
    return 'yellow';
  }
  
  // v1.6.3.4-v10 - FIX Issue #4: Check domVerified property
  // If domVerified is explicitly false, show orange/warning indicator
  // This means restore was attempted but DOM wasn't actually rendered
  if (tab.domVerified === false) {
    return 'orange';
  }
  
  // Active tabs with verified DOM show green
  return 'green';
}

function renderQuickTabItem(tab, cookieStoreId, isMinimized) {
  const item = document.createElement('div');
  item.className = `quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;
  item.dataset.tabId = tab.id;
  item.dataset.containerId = cookieStoreId;

  // Status indicator
  // v1.6.3.4-v10 - FIX Issue #4: Use helper function for indicator class
  const indicator = document.createElement('span');
  const indicatorClass = _getIndicatorClass(tab, isMinimized);
  indicator.className = `status-indicator ${indicatorClass}`;
  
  // v1.6.3.4-v10 - FIX Issue #4: Add tooltip for warning state
  if (indicatorClass === 'orange') {
    indicator.title = 'Warning: Window may not be visible. Try restoring again.';
  }

  // Create components
  const favicon = _createFavicon(tab.url);
  const tabInfo = _createTabInfo(tab, isMinimized);
  const actions = _createTabActions(tab, isMinimized);

  // Assemble item
  item.appendChild(indicator);
  item.appendChild(favicon);
  item.appendChild(tabInfo);
  item.appendChild(actions);

  return item;
}

/**
 * Setup event listeners for user interactions
 */
function setupEventListeners() {
  // Close Minimized button
  document.getElementById('closeMinimized').addEventListener('click', async () => {
    await closeMinimizedTabs();
  });

  // Close All button
  document.getElementById('closeAll').addEventListener('click', async () => {
    await closeAllTabs();
  });

  // Delegated event listener for Quick Tab actions
  containersList.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    switch (action) {
      case 'goToTab':
        await goToTab(parseInt(tabId));
        break;
      case 'minimize':
        await minimizeQuickTab(quickTabId);
        break;
      case 'restore':
        await restoreQuickTab(quickTabId);
        break;
      case 'close':
        await closeQuickTab(quickTabId);
        break;
    }
  });

  // Listen for storage changes to auto-update
  // v1.6.3 - FIX: Changed from 'sync' to 'local' (storage location since v1.6.0.12)
  // v1.6.3.4-v6 - FIX Issue #1: Debounce storage reads to avoid mid-transaction reads
  // v1.6.3.4-v9 - FIX Issue #18: Add reconciliation logic for suspicious storage changes
  // v1.6.3.5-v2 - FIX Report 2 Issue #6: Refactored to reduce complexity
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STATE_KEY]) return;
    _handleStorageChange(changes[STATE_KEY]);
  });
}

/**
 * Handle storage change event
 * v1.6.3.5-v2 - Extracted to reduce setupEventListeners complexity
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Added comprehensive logging
 * @param {Object} change - The storage change object
 */
function _handleStorageChange(change) {
  const newValue = change.newValue;
  const oldValue = change.oldValue;
  
  const oldTabCount = oldValue?.tabs?.length ?? 0;
  const newTabCount = newValue?.tabs?.length ?? 0;
  
  // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Comprehensive storage.onChanged logging
  console.log('[Manager] storage.onChanged received:', {
    oldTabCount,
    newTabCount,
    delta: newTabCount - oldTabCount,
    saveId: newValue?.saveId,
    transactionId: newValue?.transactionId,
    writingInstanceId: newValue?.writingInstanceId,
    timestamp: newValue?.timestamp,
    processedAt: Date.now()
  });
  
  // Log tab IDs that changed
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
  
  // Check for suspicious drop
  if (_isSuspiciousStorageDrop(oldTabCount, newTabCount, newValue)) {
    _handleSuspiciousStorageDrop(oldValue);
    return;
  }
  
  _scheduleStorageUpdate();
}

/**
 * Check if storage change is a suspicious drop (potential corruption)
 * v1.6.3.5-v2 - FIX Report 2 Issue #6: Better heuristics for corruption detection
 * v1.6.3.5-v11 - FIX Issue #6: Recognize single-tab deletions as legitimate (N→0 where N=1)
 *   A drop to 0 is only suspicious if:
 *   - More than 1 tab existed before (sudden multi-tab wipe)
 *   - It's not an explicit clear operation (reconciled/cleared saveId)
 * @param {number} oldTabCount - Previous tab count
 * @param {number} newTabCount - New tab count
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if suspicious
 */
function _isSuspiciousStorageDrop(oldTabCount, newTabCount, newValue) {
  // v1.6.3.5-v11 - FIX Issue #6: Only 1→0 is legitimate single-tab deletion
  // Drops from 2+ tabs to 0 in one change are suspicious (possible corruption)
  const isMultiTabDrop = oldTabCount > 1 && newTabCount === 0;
  
  // Single tab deletion (1→0) is always legitimate - user closed last Quick Tab
  const isSingleTabDeletion = oldTabCount === 1 && newTabCount === 0;
  if (isSingleTabDeletion) {
    console.log('[Manager] Single tab deletion detected (1→0) - legitimate operation');
    return false;
  }
  
  // Check for explicit clear operations
  const isExplicitClear = newValue?.saveId?.includes(SAVEID_RECONCILED) || 
                          newValue?.saveId?.includes(SAVEID_CLEARED) ||
                          !newValue;
  
  return isMultiTabDrop && !isExplicitClear;
}

/**
 * Handle suspicious storage drop (potential corruption)
 * v1.6.3.5-v2 - Extracted for clarity
 * @param {Object} oldValue - Previous storage value
 */
function _handleSuspiciousStorageDrop(oldValue) {
  console.warn('[Manager] ⚠️ SUSPICIOUS: Tab count dropped to 0!');
  console.warn('[Manager] This may indicate storage corruption. Querying content scripts...');
  
  _reconcileWithContentScripts(oldValue).catch(err => {
    console.error('[Manager] Reconciliation error:', err);
    _showErrorNotification('Failed to recover Quick Tab state. Data may be lost.');
  });
}

/**
 * Schedule debounced storage update
 * v1.6.3.5-v2 - Extracted to reduce complexity
 */
function _scheduleStorageUpdate() {
  if (storageReadDebounceTimer) {
    clearTimeout(storageReadDebounceTimer);
  }
  
  storageReadDebounceTimer = setTimeout(() => {
    storageReadDebounceTimer = null;
    loadQuickTabsState().then(() => {
      const newHash = computeStateHash(quickTabsState);
      if (newHash !== lastRenderedStateHash) {
        lastRenderedStateHash = newHash;
        renderUI();
      }
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Reconcile storage state with content scripts when suspicious changes detected
 * v1.6.3.4-v9 - FIX Issue #18: Query content scripts before clearing UI
 * @param {Object} _previousState - The previous state before the suspicious change (unused but kept for future use)
 */
async function _reconcileWithContentScripts(_previousState) {
  console.log('[Manager] Starting reconciliation with content scripts...');
  
  try {
    const foundQuickTabs = await _queryAllContentScriptsForQuickTabs();
    const uniqueQuickTabs = _deduplicateQuickTabs(foundQuickTabs);
    
    console.log('[Manager] Reconciliation found', uniqueQuickTabs.length, 'unique Quick Tabs in content scripts');
    
    await _processReconciliationResult(uniqueQuickTabs);
  } catch (err) {
    console.error('[Manager] Reconciliation failed:', err);
    _scheduleNormalUpdate();
  }
}

/**
 * Query all content scripts for their Quick Tabs state
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @returns {Promise<Array>} Array of Quick Tabs from all tabs
 */
async function _queryAllContentScriptsForQuickTabs() {
  const tabs = await browser.tabs.query({});
  const foundQuickTabs = [];
  
  for (const tab of tabs) {
    const quickTabs = await _queryContentScriptForQuickTabs(tab.id);
    foundQuickTabs.push(...quickTabs);
  }
  
  return foundQuickTabs;
}

/**
 * Query a single content script for Quick Tabs
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<Array>} Quick Tabs from this tab
 */
async function _queryContentScriptForQuickTabs(tabId) {
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
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {Array} quickTabs - Array of Quick Tabs (may contain duplicates)
 * @returns {Array} Deduplicated array
 */
function _deduplicateQuickTabs(quickTabs) {
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
 * Process reconciliation result - restore or proceed with normal update
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {Array} uniqueQuickTabs - Deduplicated Quick Tabs from content scripts
 */
async function _processReconciliationResult(uniqueQuickTabs) {
  if (uniqueQuickTabs.length > 0) {
    // Content scripts have Quick Tabs but storage is empty - this is corruption!
    console.warn('[Manager] CORRUPTION DETECTED: Content scripts have Quick Tabs but storage is empty');
    await _restoreStateFromContentScripts(uniqueQuickTabs);
  } else {
    // No Quick Tabs found in content scripts - the empty state may be valid
    console.log('[Manager] No Quick Tabs found in content scripts - empty state appears valid');
    _scheduleNormalUpdate();
  }
}

/**
 * Restore state from content scripts data
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * v1.6.3.5-v2 - FIX Code Review: Use SAVEID_RECONCILED constant
 * 
 * ARCHITECTURE NOTE (v1.6.3.5-v6):
 * This function writes directly to storage as a RECOVERY operation.
 * This is an intentional exception to the "single-writer" architecture because:
 * 1. It only runs when storage corruption is detected
 * 2. Background's cache may be corrupted, so we need to restore from content scripts
 * 3. The SAVEID_RECONCILED prefix allows other components to recognize this write
 * 
 * DO NOT use this pattern for normal operations - use message-based control instead.
 * See v1.6.3.5-architectural-issues.md Architecture Issue #6.
 * 
 * @param {Array} quickTabs - Quick Tabs from content scripts
 */
async function _restoreStateFromContentScripts(quickTabs) {
  console.warn('[Manager] Restoring from content script state...');
  
  const restoredState = {
    tabs: quickTabs,
    timestamp: Date.now(),
    saveId: `${SAVEID_RECONCILED}-${Date.now()}`
  };
  
  await browser.storage.local.set({ [STATE_KEY]: restoredState });
  console.log('[Manager] State restored from content scripts:', quickTabs.length, 'tabs');
  
  // Update local state and re-render
  quickTabsState = restoredState;
  renderUI();
}

/**
 * Schedule normal state update after delay
 * v1.6.3.4-v9 - Extracted to reduce code duplication
 */
function _scheduleNormalUpdate() {
  setTimeout(() => {
    loadQuickTabsState().then(() => {
      const newHash = computeStateHash(quickTabsState);
      if (newHash !== lastRenderedStateHash) {
        lastRenderedStateHash = newHash;
        renderUI();
      }
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local and updated for unified format
 * v1.6.3.4-v6 - FIX Issue #4: Send CLOSE_QUICK_TAB to content scripts BEFORE updating storage
 * 
 * ARCHITECTURE NOTE (v1.6.3.5-v6):
 * This function writes directly to storage, which violates the "single-writer" architecture.
 * This is a known deviation that should be addressed in a future refactor:
 * - Should send CLOSE_MINIMIZED_QUICK_TABS command to background
 * - Background should handle the storage write
 * - Manager should receive confirmation via message
 * 
 * Current behavior is acceptable for now because:
 * 1. Operation is atomic (read-modify-write within same function)
 * 2. Content scripts are notified before storage write
 * 3. No race condition risk since minimized tabs have no DOM
 * 
 * TODO: Migrate to background-coordinated approach (see v1.6.3.5-architectural-issues.md)
 */
async function closeMinimizedTabs() {
  try {
    // Get current state from local storage (v1.6.3 fix)
    const result = await browser.storage.local.get(STATE_KEY);
    if (!result || !result[STATE_KEY]) return;

    const state = result[STATE_KEY];
    
    // v1.6.3.4-v6 - FIX Issue #4: Collect minimized tab IDs BEFORE filtering
    const minimizedTabIds = [];
    if (state.tabs && Array.isArray(state.tabs)) {
      state.tabs.forEach(tab => {
        if (isTabMinimizedHelper(tab)) {
          minimizedTabIds.push(tab.id);
        }
      });
    }
    
    console.log('[Manager] Closing minimized tabs:', minimizedTabIds);
    
    // v1.6.3.4-v6 - FIX Issue #4: Send CLOSE_QUICK_TAB to ALL tabs for DOM cleanup FIRST
    const browserTabs = await browser.tabs.query({});
    for (const tabId of minimizedTabIds) {
      browserTabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'CLOSE_QUICK_TAB',
            quickTabId: tabId
          })
          .catch(() => {
            // Ignore errors for tabs where content script isn't loaded
          });
      });
    }
    
    // Now filter and update storage
    const hasChanges = filterMinimizedFromState(state);

    if (hasChanges) {
      // Save updated state to local storage (v1.6.3 fix)
      await browser.storage.local.set({ [STATE_KEY]: state });

      // Also send legacy CLOSE_MINIMIZED_QUICK_TABS for backwards compat
      browserTabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'CLOSE_MINIMIZED_QUICK_TABS'
          })
          .catch(() => {
            // Ignore errors for tabs where content script isn't loaded
          });
      });

      console.log('Closed all minimized Quick Tabs');
    }
  } catch (err) {
    console.error('Error closing minimized tabs:', err);
  }
}

/**
 * Check if a tab is minimized using consistent logic
 * v1.6.3.4-v4 - FIX Issue #5: Helper for consistent minimized state detection
 * Prefers top-level `minimized` property as single source of truth
 * @param {Object} tab - Quick Tab data
 * @returns {boolean} - True if tab is minimized
 */
function isTabMinimizedHelper(tab) {
  return tab.minimized ?? tab.visibility?.minimized ?? false;
}

/**
 * Filter minimized tabs from state object
 * v1.6.3.4-v4 - FIX Issue #5: Use consistent isTabMinimizedHelper
 * @param {Object} state - State object to modify in place
 * @returns {boolean} - True if changes were made
 */
function filterMinimizedFromState(state) {
  let hasChanges = false;

  // Handle unified format (v1.6.2.2+)
  if (state.tabs && Array.isArray(state.tabs)) {
    const originalLength = state.tabs.length;
    // v1.6.3.4-v4 - FIX Issue #5: Use consistent helper
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
 * v1.6.3.4-v4 - FIX Issue #5: Use consistent isTabMinimizedHelper
 * @param {Object} state - State object in container format
 * @returns {boolean} - True if changes were made
 */
function filterMinimizedFromContainerFormat(state) {
  let hasChanges = false;

  Object.keys(state).forEach(cookieStoreId => {
    if (cookieStoreId === 'saveId' || cookieStoreId === 'timestamp') return;
    
    if (state[cookieStoreId] && state[cookieStoreId].tabs) {
      const originalLength = state[cookieStoreId].tabs.length;
      // v1.6.3.4-v4 - FIX Issue #5: Use consistent helper
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
 * Close all Quick Tabs - both active and minimized (NEW FEATURE #2)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local
 * v1.6.3.5-v6 - FIX Architecture Issue #1: Use background-coordinated clear
 *   Instead of writing directly to storage, we send COORDINATED_CLEAR_ALL_QUICK_TABS
 *   to background which handles the single storage write and broadcasts to all tabs.
 *   This prevents multi-writer race conditions.
 * v1.6.3.5-v8 - FIX Issue #6, #10: Enhanced logging with affected IDs
 * v1.6.3.6 - FIX Issue #3: Added comprehensive logging for button handlers
 */
async function closeAllTabs() {
  const startTime = Date.now();
  
  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ Close All button clicked');
  console.log('[Manager] └─────────────────────────────────────────────────────────');
  
  try {
    // v1.6.3.5-v8 - FIX Issue #10: Log IDs being cleared
    const clearedIds = quickTabsState?.tabs?.map(t => t.id) || [];
    const originTabIds = quickTabsState?.tabs?.map(t => t.originTabId).filter(Boolean) || [];
    
    // v1.6.3.6 - FIX Issue #3: Comprehensive pre-action logging
    console.log('[Manager] Close All: Pre-action state:', {
      tabCount: clearedIds.length,
      ids: clearedIds,
      originTabIds: [...new Set(originTabIds)], // Unique origin tab IDs
      cacheCount: inMemoryTabsCache.length,
      hostInfoCount: quickTabHostInfo.size,
      timestamp: Date.now()
    });
    
    // v1.6.3.6 - FIX Issue #3: Log button action dispatch
    console.log('[Manager] Close All: Dispatching COORDINATED_CLEAR_ALL_QUICK_TABS to background...');
    
    // v1.6.3.5-v6 - Use background-coordinated clear (single-writer architecture)
    const response = await browser.runtime.sendMessage({
      action: 'COORDINATED_CLEAR_ALL_QUICK_TABS'
    });
    
    // v1.6.3.6 - FIX Issue #3: Log response details
    console.log('[Manager] Close All: Background response:', {
      success: response?.success,
      response,
      durationMs: Date.now() - startTime
    });
    
    if (response?.success) {
      console.log('[Manager] Close All: Coordinated clear successful');
    } else {
      console.warn('[Manager] Close All: Coordinated clear returned non-success:', response);
    }

    // v1.6.3.5-v8 - FIX Issue #6: Clear quickTabHostInfo to prevent phantom Quick Tabs
    const hostInfoBeforeClear = quickTabHostInfo.size;
    quickTabHostInfo.clear();
    
    // v1.6.3.6 - FIX Issue #3: Log completion with timing and details
    console.log('[Manager] Close All: Post-action cleanup:', {
      clearedIds,
      clearedCount: clearedIds.length,
      hostInfoCleared: hostInfoBeforeClear,
      totalDurationMs: Date.now() - startTime
    });

    // Update UI immediately
    quickTabsState = {};
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    lastLocalUpdateTime = Date.now();
    renderUI();
    
    console.log('[Manager] Close All: UI updated, operation complete');
  } catch (err) {
    console.error('[Manager] Close All: ERROR:', {
      message: err.message,
      stack: err.stack,
      durationMs: Date.now() - startTime
    });
  }
}

/**
 * Go to the browser tab containing this Quick Tab (NEW FEATURE #3)
 */
async function goToTab(tabId) {
  try {
    await browser.tabs.update(tabId, { active: true });
    console.log(`Switched to tab ${tabId}`);
  } catch (err) {
    console.error(`Error switching to tab ${tabId}:`, err);
    alert('Could not switch to tab - it may have been closed.');
  }
}

/**
 * Helper: Send message to a single tab
 * v1.6.3.4-v11 - Extracted to reduce nesting depth
 * @param {number} tabId - Browser tab ID
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function _sendMessageToTab(tabId, action, quickTabId) {
  try {
    await browser.tabs.sendMessage(tabId, { action, quickTabId });
    return true;
  } catch (_err) {
    // Content script may not be loaded - expected for new tabs/internal pages
    return false;
  }
}

/**
 * Helper: Send message to all tabs
 * v1.6.3.4-v11 - Extracted to reduce nesting depth
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<{success: number, errors: number}>} Count of successes and errors
 */
async function _sendMessageToAllTabs(action, quickTabId) {
  const tabs = await browser.tabs.query({});
  console.log(`[Manager] Sending ${action} to ${tabs.length} tabs for:`, quickTabId);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const tab of tabs) {
    const result = await _sendMessageToTab(tab.id, action, quickTabId);
    if (result) {
      successCount++;
    } else {
      errorCount++;
    }
  }
  
  return { success: successCount, errors: errorCount };
}

/**
 * Minimize an active Quick Tab
 * v1.6.3.4-v11 - FIX Issue #4: Send to ALL tabs, not just active tab
 *   Quick Tab may exist in a different browser tab than the active one.
 *   Cross-tab minimize was failing because message was only sent to active tab.
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 * v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging via quickTabHostInfo or originTabId
 */
async function minimizeQuickTab(quickTabId) {
  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `minimize-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log(`[Manager] Ignoring duplicate minimize for ${quickTabId} (operation pending)`);
    return;
  }
  
  // Mark operation as pending
  PENDING_OPERATIONS.add(operationKey);
  
  // Auto-clear pending state after timeout (safety net)
  setTimeout(() => {
    PENDING_OPERATIONS.delete(operationKey);
  }, OPERATION_TIMEOUT_MS);
  
  // v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging
  const tabData = _findTabInState(quickTabId);
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const originTabId = tabData?.originTabId;
  const targetTabId = hostInfo?.hostTabId || originTabId;
  
  if (targetTabId) {
    console.log('[Manager] Sending MINIMIZE_QUICK_TAB to specific host tab:', {
      quickTabId,
      targetTabId,
      source: hostInfo ? 'quickTabHostInfo' : 'originTabId'
    });
    
    try {
      await browser.tabs.sendMessage(targetTabId, {
        action: 'MINIMIZE_QUICK_TAB',
        quickTabId
      });
      console.log(`[Manager] Minimized Quick Tab ${quickTabId} via targeted message to tab ${targetTabId}`);
    } catch (err) {
      console.warn(`[Manager] Targeted minimize failed (tab ${targetTabId} may be closed), falling back to broadcast:`, err.message);
      // Fallback to broadcast if targeted message fails
      const result = await _sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
      console.log(`[Manager] Minimized Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`);
    }
  } else {
    // No host info available - fall back to broadcast
    console.log('[Manager] No host tab info found, using broadcast for minimize:', quickTabId);
    const result = await _sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
    console.log(`[Manager] Minimized Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`);
  }
}

/**
 * Find Quick Tab data in current state by ID
 * v1.6.3.4-v9 - FIX Issue #15: Helper to get tab data for validation
 * @param {string} quickTabId - Quick Tab ID to find
 * @returns {Object|null} Tab data or null if not found
 */
function _findTabInState(quickTabId) {
  if (!quickTabsState?.tabs) return null;
  return quickTabsState.tabs.find(tab => tab.id === quickTabId) || null;
}

/**
 * Show error notification to user
 * v1.6.3.4-v9 - FIX Issue #15: User feedback for invalid operations
 * @param {string} message - Error message to display
 */
function _showErrorNotification(message) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.textContent = message;
  // v1.6.3.4-v9: Use extracted styles constant for maintainability
  Object.assign(notification.style, ERROR_NOTIFICATION_STYLES);
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * Check if operation is already pending
 * v1.6.3.6-v8 - Extracted to reduce restoreQuickTab complexity
 * @private
 * @param {string} operationKey - Operation key
 * @returns {boolean} True if operation is already pending
 */
function _isOperationPending(operationKey) {
  return PENDING_OPERATIONS.has(operationKey);
}

/**
 * Set up pending operation with auto-clear
 * v1.6.3.6-v8 - Extracted to reduce restoreQuickTab complexity
 * @private
 * @param {string} operationKey - Operation key
 */
function _setupPendingOperation(operationKey) {
  PENDING_OPERATIONS.add(operationKey);
  setTimeout(() => {
    PENDING_OPERATIONS.delete(operationKey);
  }, OPERATION_TIMEOUT_MS);
}

/**
 * Validate tab data for restore operation
 * v1.6.3.6-v8 - Extracted to reduce restoreQuickTab complexity
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {{ valid: boolean, tabData: Object|null, error: string|null }}
 */
function _validateRestoreTabData(quickTabId) {
  const tabData = _findTabInState(quickTabId);
  
  if (!tabData) {
    console.warn('[Manager] Restore REJECTED: Tab not found in state:', quickTabId);
    return { valid: false, tabData: null, error: 'Quick Tab not found' };
  }
  
  // v1.6.3.6-v8 - FIX Issue #5: Log tab data for diagnostics
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
 * Send restore message to target tab
 * v1.6.3.6-v8 - Extracted to reduce restoreQuickTab complexity
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} tabData - Tab data with originTabId
 */
async function _sendRestoreMessage(quickTabId, tabData) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const originTabId = tabData.originTabId;
  const targetTabId = hostInfo?.hostTabId || originTabId;
  
  // v1.6.3.6-v8 - FIX Issue #5: Log target resolution
  console.log('[Manager] 🎯 RESTORE_TARGET_RESOLUTION:', {
    quickTabId,
    targetTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    originTabId,
    source: hostInfo ? 'quickTabHostInfo' : originTabId ? 'originTabId' : 'broadcast'
  });
  
  if (!targetTabId) {
    console.log('[Manager] ⚠️ No host tab info found, using broadcast for restore:', quickTabId);
    const result = await _sendMessageToAllTabs('RESTORE_QUICK_TAB', quickTabId);
    console.log(`[Manager] Restored Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`);
    return;
  }
  
  try {
    await browser.tabs.sendMessage(targetTabId, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId
    });
    console.log(`[Manager] ✅ Restored Quick Tab ${quickTabId} via targeted message to tab ${targetTabId}`);
  } catch (err) {
    console.warn(`[Manager] Targeted restore failed (tab ${targetTabId} may be closed), falling back to broadcast:`, err.message);
    const result = await _sendMessageToAllTabs('RESTORE_QUICK_TAB', quickTabId);
    console.log(`[Manager] Restored Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`);
  }
}

/**
 * Restore a minimized Quick Tab
 * v1.6.3.4-v11 - FIX Issue #4: Send to ALL tabs, not just active tab
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 * v1.6.3.4-v9 - FIX Issue #15: Validate tab is actually minimized before restore
 * v1.6.3.5-v2 - FIX Report 2 Issue #8: DOM-verified handshake before UI update
 * v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging via quickTabHostInfo or originTabId
 * v1.6.3.6-v8 - FIX Issue #5: Enhanced diagnostic logging + refactored for complexity
 */
async function restoreQuickTab(quickTabId) {
  // v1.6.3.6-v8 - FIX Issue #5: Log restore request with full context
  console.log('[Manager] 🔄 RESTORE_REQUEST:', {
    quickTabId,
    timestamp: Date.now(),
    quickTabsStateTabCount: quickTabsState?.tabs?.length ?? 0
  });
  
  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `restore-${quickTabId}`;
  if (_isOperationPending(operationKey)) {
    console.log(`[Manager] Ignoring duplicate restore for ${quickTabId} (operation pending)`);
    return;
  }
  
  // Validate tab data
  const validation = _validateRestoreTabData(quickTabId);
  if (!validation.valid) {
    _showErrorNotification(validation.error);
    return;
  }
  
  console.log('[Manager] Restore validated - tab is minimized:', quickTabId);
  
  // Mark operation as pending with auto-clear
  _setupPendingOperation(operationKey);
  
  // Send restore message
  await _sendRestoreMessage(quickTabId, validation.tabData);
  
  // v1.6.3.5-v2 - FIX Report 2 Issue #8: Verify DOM was actually rendered
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
 * Close a Quick Tab
 */
async function closeQuickTab(quickTabId) {
  try {
    // Send message to all tabs to close this Quick Tab
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLOSE_QUICK_TAB',
          quickTabId: quickTabId
        })
        .catch(() => {
          // Ignore errors
        });
    });

    console.log(`Closed Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error closing Quick Tab ${quickTabId}:`, err);
  }
}
