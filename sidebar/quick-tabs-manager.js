// Quick Tabs Manager Sidebar Script
// Manages display and interaction with Quick Tabs across all containers

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';

// v1.6.3.4-v5 - FIX Issue #4: Pending operations tracking
// Prevents spam-clicking by tracking in-progress restore/minimize operations
const PENDING_OPERATIONS = new Set();
const OPERATION_TIMEOUT_MS = 2000; // Clear pending state after 2 seconds

// v1.6.3.4-v6 - FIX Issue #1: Debounce storage reads to avoid mid-transaction reads
const STORAGE_READ_DEBOUNCE_MS = 300;
let storageReadDebounceTimer = null;
let lastStorageReadTime = 0;

// v1.6.3.4-v6 - FIX Issue #5: Track last rendered state hash to avoid unnecessary re-renders
let lastRenderedStateHash = 0;

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Cache DOM elements
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');

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
 * Load Quick Tabs state from browser.storage.local
 * v1.6.3 - FIX: Changed from storage.sync to storage.local (storage location since v1.6.0.12)
 * v1.6.3.4-v6 - FIX Issue #1: Debounce reads to avoid mid-transaction reads
 * Refactored: Extracted helpers to reduce complexity
 */
async function loadQuickTabsState() {
  try {
    await checkStorageDebounce();
    
    const result = await browser.storage.local.get(STATE_KEY);
    const state = result?.[STATE_KEY];

    if (!state) {
      quickTabsState = {};
      console.log('Loaded Quick Tabs state: empty');
      return;
    }
    
    // v1.6.3.4-v6 - FIX Issue #5: Check if state has actually changed
    const newHash = computeStateHash(state);
    if (newHash === lastRenderedStateHash) return;
    
    quickTabsState = state;
    filterInvalidTabs(quickTabsState);
    console.log('Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('Error loading Quick Tabs state:', err);
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
 * @param {number} totalTabs - Number of Quick Tabs
 * @param {number} latestTimestamp - Timestamp of last sync
 */
function updateUIStats(totalTabs, latestTimestamp) {
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  if (latestTimestamp > 0) {
    const date = new Date(latestTimestamp);
    lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
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
 * v1.6.4.9 - FIX Issue #4: Check domVerified property for warning indicator
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
function renderUI() {
  // Extract tabs from state (handles both unified and legacy formats)
  const { allTabs, latestTimestamp } = extractTabsFromState(quickTabsState);
  const totalTabs = allTabs.length;

  // Update stats
  updateUIStats(totalTabs, latestTimestamp);

  // Show/hide empty state
  if (totalTabs === 0) {
    containersList.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  containersList.style.display = 'block';
  emptyState.style.display = 'none';

  // Clear and populate containers list
  containersList.innerHTML = '';

  // v1.6.2.2+ - Render all Quick Tabs globally (no container grouping)
  const section = createGlobalSection(totalTabs);

  // Quick Tabs list
  const tabsList = document.createElement('div');
  tabsList.className = 'quick-tabs-list';

  // v1.6.4.3 - FIX Issue #5: Use module-level helper for consistent minimized state detection
  // Separate active and minimized tabs using consistent helper
  const activeTabs = allTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = allTabs.filter(t => isTabMinimizedHelper(t));

  // Render active tabs first, then minimized tabs
  activeTabs.forEach(tab => {
    tabsList.appendChild(renderQuickTabItem(tab, 'global', false));
  });
  minimizedTabs.forEach(tab => {
    tabsList.appendChild(renderQuickTabItem(tab, 'global', true));
  });

  section.appendChild(tabsList);
  containersList.appendChild(section);
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
 * v1.6.4.2 - Helper to get position value from flat or nested format
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
 * v1.6.4 - Helper to format size and position string for tab metadata
 * Extracted to reduce complexity in _createTabInfo
 * FIX Issue #3: Only show position if both left and top are defined
 * v1.6.4.2 - FIX TypeError: Handle both flat and nested position/size formats
 * @param {Object} tab - Quick Tab data
 * @returns {string|null} Formatted size/position string or null
 */
function _formatSizePosition(tab) {
  // v1.6.4.2 - FIX TypeError: Handle both flat (width/height) and nested (size.width) formats
  const width = _getValue(tab, 'width', 'size', 'width');
  const height = _getValue(tab, 'height', 'size', 'height');
  
  if (!width || !height) {
    return null;
  }
  
  let sizeStr = `${Math.round(width)}×${Math.round(height)}`;
  
  // v1.6.4.2 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
  const left = _getValue(tab, 'left', 'position', 'left');
  const top = _getValue(tab, 'top', 'position', 'top');
  
  // v1.6.4 - FIX Issue #3: Only show position if both values exist
  if (left != null && top != null) {
    sizeStr += ` at (${Math.round(left)}, ${Math.round(top)})`;
  }
  
  return sizeStr;
}

/**
 * Create tab info section (title + metadata)
 * v1.6.4 - FIX Bug #6: Added position display (x, y) alongside size
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

  // v1.6.4 - FIX Bug #6: Size with position display
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
 * v1.6.4.9 - FIX Issue #4: Check domVerified for warning indicator
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {string} - CSS class for indicator color
 */
function _getIndicatorClass(tab, isMinimized) {
  // Minimized tabs show yellow indicator
  if (isMinimized) {
    return 'yellow';
  }
  
  // v1.6.4.9 - FIX Issue #4: Check domVerified property
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
  // v1.6.4.9 - FIX Issue #4: Use helper function for indicator class
  const indicator = document.createElement('span');
  const indicatorClass = _getIndicatorClass(tab, isMinimized);
  indicator.className = `status-indicator ${indicatorClass}`;
  
  // v1.6.4.9 - FIX Issue #4: Add tooltip for warning state
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
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STATE_KEY]) {
      // v1.6.3.4-v6 - FIX Issue #1: Check for transaction in progress
      const newValue = changes[STATE_KEY].newValue;
      const oldValue = changes[STATE_KEY].oldValue;
      
      console.log('[Manager] Storage change detected:', {
        oldTabCount: oldValue?.tabs?.length ?? 0,
        newTabCount: newValue?.tabs?.length ?? 0,
        transactionId: newValue?.transactionId
      });
      
      // v1.6.3.4-v6 - FIX Issue #1: Debounce to avoid reading mid-transaction
      if (storageReadDebounceTimer) {
        clearTimeout(storageReadDebounceTimer);
      }
      
      storageReadDebounceTimer = setTimeout(() => {
        storageReadDebounceTimer = null;
        loadQuickTabsState().then(() => {
          // v1.6.3.4-v6 - FIX Issue #5: Only render if state actually changed
          const newHash = computeStateHash(quickTabsState);
          if (newHash !== lastRenderedStateHash) {
            lastRenderedStateHash = newHash;
            renderUI();
          }
        });
      }, STORAGE_READ_DEBOUNCE_MS);
    }
  });
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local and updated for unified format
 * v1.6.4.5 - FIX Issue #4: Send CLOSE_QUICK_TAB to content scripts BEFORE updating storage
 */
async function closeMinimizedTabs() {
  try {
    // Get current state from local storage (v1.6.3 fix)
    const result = await browser.storage.local.get(STATE_KEY);
    if (!result || !result[STATE_KEY]) return;

    const state = result[STATE_KEY];
    
    // v1.6.4.5 - FIX Issue #4: Collect minimized tab IDs BEFORE filtering
    const minimizedTabIds = [];
    if (state.tabs && Array.isArray(state.tabs)) {
      state.tabs.forEach(tab => {
        if (isTabMinimizedHelper(tab)) {
          minimizedTabIds.push(tab.id);
        }
      });
    }
    
    console.log('[Manager] Closing minimized tabs:', minimizedTabIds);
    
    // v1.6.4.5 - FIX Issue #4: Send CLOSE_QUICK_TAB to ALL tabs for DOM cleanup FIRST
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
 * v1.6.4.3 - FIX Issue #5: Helper for consistent minimized state detection
 * Prefers top-level `minimized` property as single source of truth
 * @param {Object} tab - Quick Tab data
 * @returns {boolean} - True if tab is minimized
 */
function isTabMinimizedHelper(tab) {
  return tab.minimized ?? tab.visibility?.minimized ?? false;
}

/**
 * Filter minimized tabs from state object
 * v1.6.4.3 - FIX Issue #5: Use consistent isTabMinimizedHelper
 * @param {Object} state - State object to modify in place
 * @returns {boolean} - True if changes were made
 */
function filterMinimizedFromState(state) {
  let hasChanges = false;

  // Handle unified format (v1.6.2.2+)
  if (state.tabs && Array.isArray(state.tabs)) {
    const originalLength = state.tabs.length;
    // v1.6.4.3 - FIX Issue #5: Use consistent helper
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
 * v1.6.4.3 - FIX Issue #5: Use consistent isTabMinimizedHelper
 * @param {Object} state - State object in container format
 * @returns {boolean} - True if changes were made
 */
function filterMinimizedFromContainerFormat(state) {
  let hasChanges = false;

  Object.keys(state).forEach(cookieStoreId => {
    if (cookieStoreId === 'saveId' || cookieStoreId === 'timestamp') return;
    
    if (state[cookieStoreId] && state[cookieStoreId].tabs) {
      const originalLength = state[cookieStoreId].tabs.length;
      // v1.6.4.3 - FIX Issue #5: Use consistent helper
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
 */
async function closeAllTabs() {
  try {
    // Clear all Quick Tabs from local storage (v1.6.3 fix)
    await browser.storage.local.remove(STATE_KEY);

    // Notify all content scripts to close Quick Tabs
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLEAR_ALL_QUICK_TABS'
        })
        .catch(() => {
          // Ignore errors
        });
    });

    console.log('Closed all Quick Tabs');

    // Update UI immediately
    quickTabsState = {};
    renderUI();
  } catch (err) {
    console.error('Error closing all tabs:', err);
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
 * v1.6.4.10 - Extracted to reduce nesting depth
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
 * v1.6.4.10 - Extracted to reduce nesting depth
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
 * v1.6.4.10 - FIX Issue #4: Send to ALL tabs, not just active tab
 *   Quick Tab may exist in a different browser tab than the active one.
 *   Cross-tab minimize was failing because message was only sent to active tab.
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
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
  
  // v1.6.4.10 - FIX Issue #4: Send to ALL tabs, not just active tab
  const result = await _sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
  console.log(`[Manager] Minimized Quick Tab ${quickTabId} | success: ${result.success}, errors: ${result.errors}`);
}

/**
 * Restore a minimized Quick Tab
 * v1.6.4.10 - FIX Issue #4: Send to ALL tabs, not just active tab
 *   Quick Tab may exist in a different browser tab than the active one.
 *   Cross-tab restore was failing because message was only sent to active tab.
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 */
async function restoreQuickTab(quickTabId) {
  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `restore-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log(`[Manager] Ignoring duplicate restore for ${quickTabId} (operation pending)`);
    return;
  }
  
  // Mark operation as pending
  PENDING_OPERATIONS.add(operationKey);
  
  // Auto-clear pending state after timeout (safety net)
  setTimeout(() => {
    PENDING_OPERATIONS.delete(operationKey);
  }, OPERATION_TIMEOUT_MS);
  
  // v1.6.4.10 - FIX Issue #4: Send to ALL tabs, not just active tab
  const result = await _sendMessageToAllTabs('RESTORE_QUICK_TAB', quickTabId);
  console.log(`[Manager] Restored Quick Tab ${quickTabId} | success: ${result.success}, errors: ${result.errors}`);
  
  // Note: Pending state is cleared by setTimeout above (safety net after OPERATION_TIMEOUT_MS)
  // This ensures UI re-renders from storage update before allowing more clicks
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
