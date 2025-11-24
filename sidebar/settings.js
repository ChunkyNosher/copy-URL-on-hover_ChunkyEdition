// Sidebar settings JavaScript for Quick Tabs settings management
// Converted from options_page.js with sidebar-specific adaptations

// Settings keys
const SETTINGS_KEY = 'quick_tab_settings';
const STATE_KEY = 'quick_tabs_state_v2';
const SESSION_KEY = 'quick_tabs_session';

// Default settings
const DEFAULT_SETTINGS = {
  enableQuickTabs: true,
  maxQuickTabs: 5,
  defaultWidth: 600,
  defaultHeight: 400,
  syncAcrossTabs: true,
  persistAcrossSessions: true,
  enableDebugLogging: false
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  await initializeSettings();
  setupEventListeners();
  setupTabNavigation();
});

/**
 * Initialize settings on page load
 */
async function initializeSettings() {
  await loadSettings();
  await updateStorageInfo();
  checkSessionStorageAvailability();
  console.log('[Sidebar Settings] Initialized');
}

/**
 * Load settings from storage and populate form
 */
async function loadSettings() {
  try {
    const result = await browser.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;

    // Populate form fields
    document.getElementById('enableQuickTabs').checked = settings.enableQuickTabs;
    document.getElementById('maxQuickTabs').value = settings.maxQuickTabs;
    document.getElementById('defaultWidth').value = settings.defaultWidth;
    document.getElementById('defaultHeight').value = settings.defaultHeight;
    document.getElementById('syncAcrossTabs').checked = settings.syncAcrossTabs;
    document.getElementById('persistAcrossSessions').checked = settings.persistAcrossSessions;
    document.getElementById('enableDebugLogging').checked = settings.enableDebugLogging;

    console.log('[Sidebar Settings] Settings loaded:', settings);
  } catch (err) {
    console.error('[Sidebar Settings] Error loading settings:', err);
    showStatusMessage('Error loading settings', 'error');
  }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  try {
    const settings = {
      enableQuickTabs: document.getElementById('enableQuickTabs').checked,
      maxQuickTabs: parseInt(document.getElementById('maxQuickTabs').value),
      defaultWidth: parseInt(document.getElementById('defaultWidth').value),
      defaultHeight: parseInt(document.getElementById('defaultHeight').value),
      syncAcrossTabs: document.getElementById('syncAcrossTabs').checked,
      persistAcrossSessions: document.getElementById('persistAcrossSessions').checked,
      enableDebugLogging: document.getElementById('enableDebugLogging').checked
    };

    await browser.storage.sync.set({ [SETTINGS_KEY]: settings });
    console.log('[Sidebar Settings] Settings saved:', settings);
    showStatusMessage('Settings saved successfully!', 'success');

    // Notify all tabs about settings change
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'SETTINGS_UPDATED',
          settings: settings
        })
        .catch(() => {
          // Ignore errors for tabs where content script isn't loaded
        });
    }
  } catch (err) {
    console.error('[Sidebar Settings] Error saving settings:', err);
    showStatusMessage('Error saving settings', 'error');
  }
}

/**
 * Update storage information display
 */
async function updateStorageInfo() {
  try {
    // Try to load state from sync storage
    const syncResult = await browser.storage.sync.get(STATE_KEY);
    const state = syncResult[STATE_KEY];

    if (!state || !state.tabs) {
      document.getElementById('currentTabCount').textContent = '0';
      document.getElementById('lastUpdated').textContent = 'Never';
      return;
    }

    document.getElementById('currentTabCount').textContent = state.tabs.length;

    if (state.timestamp) {
      const date = new Date(state.timestamp);
      document.getElementById('lastUpdated').textContent = date.toLocaleString();
    }
  } catch (err) {
    console.error('[Sidebar Settings] Error loading storage info:', err);
    document.getElementById('currentTabCount').textContent = 'Error';
  }
}

/**
 * Check if session storage is available
 */
function checkSessionStorageAvailability() {
  const hasSessionStorage =
    typeof browser !== 'undefined' &&
    browser.storage &&
    typeof browser.storage.session !== 'undefined';

  const statusElement = document.getElementById('sessionStorageStatus');
  if (hasSessionStorage) {
    statusElement.textContent = '✓ Available (Firefox 115+)';
    statusElement.style.color = '#4caf50';
  } else {
    statusElement.textContent = '✗ Not Available (requires Firefox 115+)';
    statusElement.style.color = '#ff9800';
  }
}

/**
 * Clear all Quick Tabs from storage
 */
async function clearStorage() {
  if (!confirm('Are you sure you want to clear all Quick Tabs? This action cannot be undone.')) {
    return;
  }

  try {
    // Clear from sync storage
    await browser.storage.sync.remove(STATE_KEY);

    // Clear from session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      await browser.storage.session.remove(SESSION_KEY);
    }

    showStatusMessage('All Quick Tabs cleared successfully!', 'success');
    await updateStorageInfo();

    // Notify all tabs to close Quick Tabs
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLEAR_ALL_QUICK_TABS'
        })
        .catch(() => {
          // Ignore errors for tabs where content script isn't loaded
        });
    }
  } catch (err) {
    console.error('[Sidebar Settings] Error clearing storage:', err);
    showStatusMessage('Error clearing storage', 'error');
  }
}

/**
 * Show current state in debug output
 */
async function showCurrentState() {
  try {
    const syncResult = await browser.storage.sync.get(STATE_KEY);
    const state = syncResult[STATE_KEY];

    const debugOutput = document.getElementById('debugOutput');
    const debugContent = document.getElementById('debugContent');

    debugContent.textContent = JSON.stringify(state, null, 2);
    debugOutput.style.display = 'block';
  } catch (err) {
    console.error('[Sidebar Settings] Error loading state:', err);
    showStatusMessage('Error loading state', 'error');
  }
}

/**
 * Export state as JSON file
 */
async function exportState() {
  try {
    const syncResult = await browser.storage.sync.get(STATE_KEY);
    const state = syncResult[STATE_KEY];

    const dataStr = JSON.stringify(state, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `quick-tabs-state-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatusMessage('State exported successfully!', 'success');
  } catch (err) {
    console.error('[Sidebar Settings] Error exporting state:', err);
    showStatusMessage('Error exporting state', 'error');
  }
}

/**
 * Show status message
 */
function showStatusMessage(message, type) {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = `${type}`;
  statusElement.style.display = 'block';

  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusElement.style.display = 'none';
  }, 3000);
}

// ==================== TAB NAVIGATION (NEW) ====================
/**
 * Setup tab navigation between Settings and Quick Tabs
 */
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;

      // Update active states
      tabButtons.forEach((b) => b.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));

      button.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');

      console.log(`[Sidebar Settings] Switched to ${targetTab} tab`);
    });
  });
}

/**
 * Setup event listeners for all buttons and inputs
 */
function setupEventListeners() {
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('refreshInfo').addEventListener('click', updateStorageInfo);
  document.getElementById('clearStorage').addEventListener('click', clearStorage);
  document.getElementById('showCurrentState').addEventListener('click', showCurrentState);
  document.getElementById('exportState').addEventListener('click', exportState);
}

// ==================== STORAGE SYNC LISTENER ====================
// Listen for settings changes from other tabs/windows
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[SETTINGS_KEY]) {
    console.log('[Sidebar Settings] Settings updated externally, reloading');
    const newSettings = changes[SETTINGS_KEY].newValue;
    if (newSettings) {
      // Update form fields
      document.getElementById('enableQuickTabs').checked = newSettings.enableQuickTabs;
      document.getElementById('maxQuickTabs').value = newSettings.maxQuickTabs;
      document.getElementById('defaultWidth').value = newSettings.defaultWidth;
      document.getElementById('defaultHeight').value = newSettings.defaultHeight;
      document.getElementById('syncAcrossTabs').checked = newSettings.syncAcrossTabs;
      document.getElementById('persistAcrossSessions').checked = newSettings.persistAcrossSessions;
      document.getElementById('enableDebugLogging').checked = newSettings.enableDebugLogging;
    }
  }

  // Update storage info if Quick Tabs state changes
  if (areaName === 'sync' && changes[STATE_KEY]) {
    updateStorageInfo();
  }
});
