// Quick Tabs Manager Sidebar Script
// Manages display and interaction with Quick Tabs across all containers

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

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
 * Load Quick Tabs state from browser.storage.local
 * v1.6.3 - FIX: Changed from storage.sync to storage.local (storage location since v1.6.0.12)
 */
async function loadQuickTabsState() {
  try {
    const result = await browser.storage.local.get(STATE_KEY);

    if (result && result[STATE_KEY]) {
      quickTabsState = result[STATE_KEY];
    } else {
      quickTabsState = {};
    }

    console.log('Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('Error loading Quick Tabs state:', err);
  }
}

/**
 * Extract tabs from state (handles both unified and legacy formats)
 * @param {Object} state - Quick Tabs state
 * @returns {{ allTabs: Array, latestTimestamp: number }} - Extracted tabs and timestamp
 */
function extractTabsFromState(state) {
  let allTabs = [];
  let latestTimestamp = 0;

  if (state && state.tabs && Array.isArray(state.tabs)) {
    // Unified format (v1.6.2.2+)
    allTabs = state.tabs;
    latestTimestamp = state.timestamp || 0;
  } else if (state && typeof state === 'object') {
    // Legacy container format (fallback for backward compatibility)
    Object.keys(state).forEach(cookieStoreId => {
      // Skip non-container properties like 'saveId', 'timestamp'
      if (cookieStoreId === 'saveId' || cookieStoreId === 'timestamp') return;
      
      const containerState = state[cookieStoreId];
      if (containerState && containerState.tabs && Array.isArray(containerState.tabs)) {
        allTabs = allTabs.concat(containerState.tabs);
        if (containerState.timestamp > latestTimestamp) {
          latestTimestamp = containerState.timestamp;
        }
      }
    });
  }

  return { allTabs, latestTimestamp };
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
 * 
 * Unified format:
 * { tabs: [...], saveId: '...', timestamp: ... }
 * 
 * Each tab in tabs array has:
 * - id, url, title
 * - visibility: { minimized, soloedOnTabs, mutedOnTabs }
 * - position, size
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

  // Separate active and minimized tabs
  const activeTabs = allTabs.filter(t => !t.minimized && !(t.visibility && t.visibility.minimized));
  const minimizedTabs = allTabs.filter(t => t.minimized || (t.visibility && t.visibility.minimized));

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
 * Create tab info section (title + metadata)
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

  if (tab.width && tab.height) {
    metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
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
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Actions element
 */
function _createTabActions(tab, isMinimized) {
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

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

function renderQuickTabItem(tab, cookieStoreId, isMinimized) {
  const item = document.createElement('div');
  item.className = `quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;
  item.dataset.tabId = tab.id;
  item.dataset.containerId = cookieStoreId;

  // Status indicator
  const indicator = document.createElement('span');
  indicator.className = `status-indicator ${isMinimized ? 'yellow' : 'green'}`;

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
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STATE_KEY]) {
      loadQuickTabsState().then(() => {
        renderUI();
      });
    }
  });
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local and updated for unified format
 */
async function closeMinimizedTabs() {
  try {
    // Get current state from local storage (v1.6.3 fix)
    const result = await browser.storage.local.get(STATE_KEY);
    if (!result || !result[STATE_KEY]) return;

    const state = result[STATE_KEY];
    const hasChanges = filterMinimizedFromState(state);

    if (hasChanges) {
      // Save updated state to local storage (v1.6.3 fix)
      await browser.storage.local.set({ [STATE_KEY]: state });

      // Notify all content scripts to update their local state
      const tabs = await browser.tabs.query({});
      tabs.forEach(tab => {
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
 * Filter minimized tabs from state object
 * @param {Object} state - State object to modify in place
 * @returns {boolean} - True if changes were made
 */
function filterMinimizedFromState(state) {
  let hasChanges = false;

  // Handle unified format (v1.6.2.2+)
  if (state.tabs && Array.isArray(state.tabs)) {
    const originalLength = state.tabs.length;
    // Filter out minimized tabs (check both legacy and new format)
    state.tabs = state.tabs.filter(t => {
      const isMinimized = t.minimized || (t.visibility && t.visibility.minimized);
      return !isMinimized;
    });

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
 * @returns {boolean} - True if changes were made
 */
function filterMinimizedFromContainerFormat(state) {
  let hasChanges = false;

  Object.keys(state).forEach(cookieStoreId => {
    if (cookieStoreId === 'saveId' || cookieStoreId === 'timestamp') return;
    
    if (state[cookieStoreId] && state[cookieStoreId].tabs) {
      const originalLength = state[cookieStoreId].tabs.length;
      state[cookieStoreId].tabs = state[cookieStoreId].tabs.filter(t => !t.minimized);

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
 * Minimize an active Quick Tab
 */
async function minimizeQuickTab(quickTabId) {
  try {
    // Send message to content script in active tab
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length === 0) return;

    await browser.tabs.sendMessage(activeTabs[0].id, {
      action: 'MINIMIZE_QUICK_TAB',
      quickTabId: quickTabId
    });

    console.log(`Minimized Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error minimizing Quick Tab ${quickTabId}:`, err);
  }
}

/**
 * Restore a minimized Quick Tab
 */
async function restoreQuickTab(quickTabId) {
  try {
    // Send message to content script in active tab
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length === 0) return;

    await browser.tabs.sendMessage(activeTabs[0].id, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId: quickTabId
    });

    console.log(`Restored Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error restoring Quick Tab ${quickTabId}:`, err);
  }
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
