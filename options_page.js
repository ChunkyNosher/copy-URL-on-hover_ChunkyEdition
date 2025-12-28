// Options page JavaScript for Quick Tabs settings management

// Import the state manager (requires web_accessible_resources in manifest)
// For now, we'll use browser.storage.sync directly
// Note: In manifest v3, we can use ES modules. For v2, we use direct browser.storage calls.

// Settings keys
const SETTINGS_KEY = 'quick_tab_settings';
const STATE_KEY = 'quick_tabs_state_v2';
const SESSION_KEY = 'quick_tabs_session';

// v1.6.3.12-v11 - FIX Issue #10: Page visibility guard to prevent DOM updates after page unload
// Track whether the page is still active to prevent reference errors on async callbacks
let _isPageActive = true;

/**
 * Check if page is still active (not unloaded/hidden)
 * v1.6.3.12-v11 - FIX Issue #10: Guard for async operations
 * @returns {boolean} True if page is active and DOM operations are safe
 */
function isPageActive() {
  // Safety check: ensure document exists during edge cases
  return _isPageActive && typeof document !== 'undefined' && document.visibilityState !== 'hidden';
}

// Mark page as inactive on unload
window.addEventListener('unload', () => {
  _isPageActive = false;
});

// Default settings
const DEFAULT_SETTINGS = {
  enableQuickTabs: true,
  maxQuickTabs: 5,
  defaultWidth: 600,
  defaultHeight: 400,
  syncAcrossTabs: true,
  persistAcrossSessions: true,
  enableDebugLogging: false,
  quickTabShowDebugId: false
};

// Load settings on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateStorageInfo();
  checkSessionStorageAvailability();
  setupEventListeners();
});

/**
 * Load settings from storage and populate form
 * v1.6.3.12-v11 - FIX Issue #10: Added page visibility guard
 */
async function loadSettings() {
  try {
    const result = await browser.storage.sync.get(SETTINGS_KEY);

    // v1.6.3.12-v11 - FIX Issue #10: Guard against DOM updates after page unload
    if (!isPageActive()) {
      console.log('[Options] loadSettings: Page no longer active, skipping DOM updates');
      return;
    }

    const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;

    // Populate form fields
    document.getElementById('enableQuickTabs').checked = settings.enableQuickTabs;
    document.getElementById('maxQuickTabs').value = settings.maxQuickTabs;
    document.getElementById('defaultWidth').value = settings.defaultWidth;
    document.getElementById('defaultHeight').value = settings.defaultHeight;
    document.getElementById('syncAcrossTabs').checked = settings.syncAcrossTabs;
    document.getElementById('persistAcrossSessions').checked = settings.persistAcrossSessions;
    document.getElementById('enableDebugLogging').checked = settings.enableDebugLogging;
    document.getElementById('quickTabShowDebugId').checked = settings.quickTabShowDebugId ?? false;

    console.log('Settings loaded:', settings);
  } catch (err) {
    console.error('Error loading settings:', err);
    // v1.6.3.12-v11 - FIX Issue #10: Guard status display as well
    if (isPageActive()) {
      showStatus('Error loading settings', 'error');
    }
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
      enableDebugLogging: document.getElementById('enableDebugLogging').checked,
      quickTabShowDebugId: document.getElementById('quickTabShowDebugId').checked
    };

    await browser.storage.sync.set({ [SETTINGS_KEY]: settings });
    console.log('Settings saved:', settings);
    showStatus('Settings saved successfully!', 'success');

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
    console.error('Error saving settings:', err);
    showStatus('Error saving settings', 'error');
  }
}

/**
 * Update storage information display
 * v1.6.3.12-v11 - FIX Issue #10: Added page visibility guard
 */
async function updateStorageInfo() {
  try {
    // Query from LOCAL storage (where Quick Tabs are actually stored)
    const localResult = await browser.storage.local.get(STATE_KEY);

    // v1.6.3.12-v11 - FIX Issue #10: Guard against DOM updates after page unload
    if (!isPageActive()) {
      console.log('[Options] updateStorageInfo: Page no longer active, skipping DOM updates');
      return;
    }

    const state = localResult[STATE_KEY];

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
    console.error('Error loading storage info:', err);
    // v1.6.3.12-v11 - FIX Issue #10: Guard DOM update in error handler
    if (isPageActive()) {
      document.getElementById('currentTabCount').textContent = 'Error';
    }
  }
}

/**
 * Check if session storage is available
 */
function checkSessionStorageAvailability() {
  // v1.6.3.12-v5 - storage.session does NOT exist in Firefox MV2
  // Session-only behavior is achieved via explicit startup cleanup
  const hasLocalStorage =
    typeof browser !== 'undefined' &&
    browser.storage &&
    typeof browser.storage.local !== 'undefined';

  const statusElement = document.getElementById('sessionStorageStatus');
  if (hasLocalStorage) {
    statusElement.textContent = '✓ Available (storage.local - session-scoped via cleanup)';
    statusElement.style.color = '#155724';
  } else {
    statusElement.textContent = '✗ Not Available';
    statusElement.style.color = '#856404';
  }
}

/**
 * Clear all Quick Tabs from storage
 */
async function clearStorage() {
  if (
    !confirm(
      'Are you sure you want to clear all Quick Tabs? This will close all Quick Tab windows but preserve your settings and keyboard shortcuts. This action cannot be undone.'
    )
  ) {
    return;
  }

  try {
    // Clear Quick Tabs state from LOCAL storage (where Quick Tabs are stored)
    // This preserves settings (in sync storage) and console logs
    await browser.storage.local.remove(STATE_KEY);

    // Also clear from sync storage for backward compatibility
    await browser.storage.sync.remove(STATE_KEY);

    // Clear session key from local storage as well
    // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
    await browser.storage.local.remove(SESSION_KEY);

    showStatus(
      'All Quick Tabs cleared! Your settings and keyboard shortcuts are preserved.',
      'success'
    );
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
    console.error('Error clearing storage:', err);
    showStatus('Error clearing storage', 'error');
  }
}

/**
 * Show current state in debug output
 * v1.6.3.12-v11 - FIX Issue #10: Added page visibility guard
 */
async function showCurrentState() {
  try {
    // Query from LOCAL storage (where Quick Tabs are actually stored)
    const localResult = await browser.storage.local.get(STATE_KEY);

    // v1.6.3.12-v11 - FIX Issue #10: Guard against DOM updates after page unload
    if (!isPageActive()) {
      console.log('[Options] showCurrentState: Page no longer active, skipping DOM updates');
      return;
    }

    const state = localResult[STATE_KEY];

    const debugOutput = document.getElementById('debugOutput');
    const debugContent = document.getElementById('debugContent');

    debugContent.textContent = JSON.stringify(state, null, 2);
    debugOutput.style.display = 'block';
  } catch (err) {
    console.error('Error loading state:', err);
    // v1.6.3.12-v11 - FIX Issue #10: Guard status display
    if (isPageActive()) {
      showStatus('Error loading state', 'error');
    }
  }
}

/**
 * Export state as JSON file
 * v1.6.3.12-v11 - FIX Issue #10: Added page visibility guard
 */
async function exportState() {
  try {
    // Query from LOCAL storage (where Quick Tabs are actually stored)
    const localResult = await browser.storage.local.get(STATE_KEY);

    // v1.6.3.12-v11 - FIX Issue #10: Guard against DOM updates after page unload
    if (!isPageActive()) {
      console.log('[Options] exportState: Page no longer active, skipping export');
      return;
    }

    const state = localResult[STATE_KEY];

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

    showStatus('State exported successfully!', 'success');
  } catch (err) {
    console.error('Error exporting state:', err);
    // v1.6.3.12-v11 - FIX Issue #10: Guard status display
    if (isPageActive()) {
      showStatus('Error exporting state', 'error');
    }
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  statusElement.style.display = 'block';

  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusElement.style.display = 'none';
  }, 3000);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('refreshInfo').addEventListener('click', updateStorageInfo);
  document.getElementById('clearStorage').addEventListener('click', clearStorage);
  document.getElementById('showCurrentState').addEventListener('click', showCurrentState);
  document.getElementById('exportState').addEventListener('click', exportState);
}
