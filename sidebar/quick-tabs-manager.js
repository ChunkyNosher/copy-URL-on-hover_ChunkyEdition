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
 */
async function loadContainerInfo() {
  try {
    // Check if contextualIdentities API is available
    if (typeof browser.contextualIdentities === 'undefined') {
      console.warn('Contextual Identities API not available');
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
 * Load Quick Tabs state from browser.storage.sync
 */
async function loadQuickTabsState() {
  try {
    const result = await browser.storage.sync.get(STATE_KEY);

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
 * Render the entire UI based on current state
 */
function renderUI() {
  // Calculate total tabs
  let totalTabs = 0;
  let latestTimestamp = 0;

  Object.keys(quickTabsState).forEach(cookieStoreId => {
    const containerState = quickTabsState[cookieStoreId];
    if (containerState && containerState.tabs) {
      totalTabs += containerState.tabs.length;
      if (containerState.timestamp > latestTimestamp) {
        latestTimestamp = containerState.timestamp;
      }
    }
  });

  // Update stats
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  if (latestTimestamp > 0) {
    const date = new Date(latestTimestamp);
    lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
  }

  // Show/hide empty state
  if (totalTabs === 0) {
    containersList.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  } else {
    containersList.style.display = 'block';
    emptyState.style.display = 'none';
  }

  // Clear containers list
  containersList.innerHTML = '';

  // Render each container section
  // Sort containers: Default first, then alphabetically
  const sortedContainers = Object.keys(containersData).sort((a, b) => {
    if (a === 'firefox-default') return -1;
    if (b === 'firefox-default') return 1;
    return containersData[a].name.localeCompare(containersData[b].name);
  });

  sortedContainers.forEach(cookieStoreId => {
    const containerInfo = containersData[cookieStoreId];
    const containerState = quickTabsState[cookieStoreId];

    if (!containerState || !containerState.tabs || containerState.tabs.length === 0) {
      // Skip containers with no Quick Tabs
      return;
    }

    renderContainerSection(cookieStoreId, containerInfo, containerState);
  });
}

/**
 * Render a single container section with its Quick Tabs
 */
function renderContainerSection(cookieStoreId, containerInfo, containerState) {
  const section = document.createElement('div');
  section.className = 'container-section';
  section.dataset.containerId = cookieStoreId;

  // Container header
  const header = document.createElement('h2');
  header.className = 'container-header';

  const icon = document.createElement('span');
  icon.className = 'container-icon';
  icon.textContent = containerInfo.icon;

  const name = document.createElement('span');
  name.className = 'container-name';
  name.textContent = containerInfo.name;

  const count = document.createElement('span');
  count.className = 'container-count';
  const tabCount = containerState.tabs.length;
  count.textContent = `(${tabCount} tab${tabCount !== 1 ? 's' : ''})`;

  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(count);

  section.appendChild(header);

  // Quick Tabs list
  const tabsList = document.createElement('div');
  tabsList.className = 'quick-tabs-list';

  // Separate active and minimized tabs
  const activeTabs = containerState.tabs.filter(t => !t.minimized);
  const minimizedTabs = containerState.tabs.filter(t => t.minimized);

  // Render active tabs first
  activeTabs.forEach(tab => {
    tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, false));
  });

  // Then minimized tabs
  minimizedTabs.forEach(tab => {
    tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, true));
  });

  section.appendChild(tabsList);
  containersList.appendChild(section);
}

/**
 * Render a single Quick Tab item
 */
function renderQuickTabItem(tab, cookieStoreId, isMinimized) {
  const item = document.createElement('div');
  item.className = `quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;
  item.dataset.tabId = tab.id;
  item.dataset.containerId = cookieStoreId;

  // Status indicator
  const indicator = document.createElement('span');
  indicator.className = `status-indicator ${isMinimized ? 'yellow' : 'green'}`;

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  try {
    const urlObj = new URL(tab.url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    favicon.onerror = () => {
      favicon.style.display = 'none';
    };
  } catch (e) {
    favicon.style.display = 'none';
  }

  // Tab info
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

  // Tab actions
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  if (!isMinimized) {
    // Active Quick Tab actions

    // Go to Tab button (NEW FEATURE)
    if (tab.activeTabId) {
      const goToTabBtn = document.createElement('button');
      goToTabBtn.className = 'btn-icon';
      goToTabBtn.textContent = '🔗';
      goToTabBtn.title = `Go to Tab ${tab.activeTabId}`;
      goToTabBtn.dataset.action = 'goToTab';
      goToTabBtn.dataset.tabId = tab.activeTabId;
      actions.appendChild(goToTabBtn);
    }

    // Minimize button
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'btn-icon';
    minimizeBtn.textContent = '➖';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.dataset.action = 'minimize';
    minimizeBtn.dataset.quickTabId = tab.id;
    actions.appendChild(minimizeBtn);
  } else {
    // Minimized Quick Tab actions

    // Restore button
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
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[STATE_KEY]) {
      loadQuickTabsState().then(() => {
        renderUI();
      });
    }
  });
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 */
async function closeMinimizedTabs() {
  try {
    // Get current state
    const result = await browser.storage.sync.get(STATE_KEY);
    if (!result || !result[STATE_KEY]) return;

    const state = result[STATE_KEY];
    let hasChanges = false;

    // Filter out minimized tabs from each container
    Object.keys(state).forEach(cookieStoreId => {
      if (state[cookieStoreId] && state[cookieStoreId].tabs) {
        const originalLength = state[cookieStoreId].tabs.length;
        state[cookieStoreId].tabs = state[cookieStoreId].tabs.filter(t => !t.minimized);

        if (state[cookieStoreId].tabs.length !== originalLength) {
          hasChanges = true;
          state[cookieStoreId].timestamp = Date.now();
        }
      }
    });

    if (hasChanges) {
      // Save updated state
      await browser.storage.sync.set({ [STATE_KEY]: state });

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
 * Close all Quick Tabs - both active and minimized (NEW FEATURE #2)
 */
async function closeAllTabs() {
  try {
    // Clear all Quick Tabs from storage
    await browser.storage.sync.remove(STATE_KEY);

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
