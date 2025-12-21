// Sidebar panel JavaScript for Quick Tabs live state debugging

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';
const SESSION_KEY = 'quick_tabs_session';

// Auto-refresh interval
let refreshInterval;

// v1.6.3.11 - FIX Issue #21: Track storage write in progress to prevent reading partial data
let storageWriteInProgress = false;

// v1.6.3.11 - FIX Issue #22: Storage format version for migration detection
// Unused but kept for potential future use
const _EXPECTED_FORMAT_VERSION = 2;

// Initialize panel
document.addEventListener('DOMContentLoaded', () => {
  checkSessionStorageAvailability();
  displayAllQuickTabs();
  setupEventListeners();

  // Auto-refresh every 2 seconds
  refreshInterval = setInterval(displayAllQuickTabs, 2000);
});

// Clean up on unload
window.addEventListener('unload', () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

/**
 * Check if session storage is available
 */
function checkSessionStorageAvailability() {
  const hasSessionStorage =
    typeof browser !== 'undefined' &&
    browser.storage &&
    typeof browser.storage.session !== 'undefined';

  const statusElement = document.getElementById('sessionStatus');
  if (hasSessionStorage) {
    statusElement.textContent = '✓ Available';
    statusElement.style.color = '#155724';
  } else {
    statusElement.textContent = '✗ Not Available';
    statusElement.style.color = '#856404';
  }
}

/**
 * Display all Quick Tabs from storage
 */
/**
 * Load state from session storage
 * @returns {Promise<Object|null>} State or null
 */
async function _loadFromSessionStorage() {
  if (typeof browser.storage.session === 'undefined') {
    return null;
  }

  const sessionResult = await browser.storage.session.get(SESSION_KEY);
  return sessionResult && sessionResult[SESSION_KEY] ? sessionResult[SESSION_KEY] : null;
}

/**
 * Load state from sync storage
 * @returns {Promise<Object|null>} State or null
 */
async function _loadFromSyncStorage() {
  const syncResult = await browser.storage.sync.get(STATE_KEY);
  return syncResult && syncResult[STATE_KEY] ? syncResult[STATE_KEY] : null;
}

/**
 * Compare timestamps to determine which storage has more recent data
 * v1.6.3.11 - FIX Issue #40: Session vs Sync Storage Race During Init
 * @param {Object|null} sessionState - State from session storage
 * @param {Object|null} syncState - State from sync storage
 * @returns {Object|null} More recent state or null if both are null
 */
function _selectMoreRecentState(sessionState, syncState) {
  if (!sessionState && !syncState) return null;
  if (!sessionState) return syncState;
  if (!syncState) return sessionState;
  
  const sessionTimestamp = sessionState.timestamp || 0;
  const syncTimestamp = syncState.timestamp || 0;
  
  console.log('[Panel] STORAGE_TIMESTAMP_COMPARISON:', {
    sessionTimestamp,
    syncTimestamp,
    sessionIsNewer: sessionTimestamp > syncTimestamp
  });
  
  // Return whichever has the more recent timestamp
  if (sessionTimestamp > syncTimestamp) {
    return sessionState;
  }
  return syncState;
}

/**
 * Show empty state message
 */
function _showEmptyState() {
  const container = document.getElementById('quickTabsList');
  const tabCountElement = document.getElementById('tabCount');
  const lastSyncElement = document.getElementById('lastSync');

  container.innerHTML = '<div class="no-tabs">No Quick Tabs open</div>';
  tabCountElement.textContent = '0';
  lastSyncElement.textContent = 'Never';
}

/**
 * v1.6.3.11 - FIX Issue #22: Detect and normalize storage format
 * Handles both flat array format (state.tabs) and nested object format (state.allQuickTabs)
 * @param {Object} state - Raw state from storage
 * @returns {Array|null} Normalized tabs array or null if invalid
 */
function _normalizeStorageFormat(state) {
  if (!state) return null;
  
  // Format 1: Flat array format (state.tabs)
  if (Array.isArray(state.tabs)) {
    console.log('[Panel] Using flat tabs array format');
    return state.tabs;
  }
  
  // Format 2: Nested object format (state.allQuickTabs)
  if (Array.isArray(state.allQuickTabs)) {
    console.log('[Panel] Using allQuickTabs nested format (v2)');
    return state.allQuickTabs;
  }
  
  // Format 3: Direct array (legacy)
  if (Array.isArray(state)) {
    console.log('[Panel] Using direct array format (legacy)');
    return state;
  }
  
  console.warn('[Panel] Unknown storage format detected:', Object.keys(state || {}));
  return null;
}

/**
 * Render Quick Tabs list
 * v1.6.3.11 - FIX Issue #22: Handle both flat and nested storage formats
 * @param {Object} state - State containing tabs
 */
function _renderQuickTabsList(state) {
  const container = document.getElementById('quickTabsList');
  const tabCountElement = document.getElementById('tabCount');
  const lastSyncElement = document.getElementById('lastSync');

  // v1.6.3.11 - FIX Issue #22: Normalize storage format before rendering
  const tabs = _normalizeStorageFormat(state);
  
  if (!tabs) {
    console.warn('[Panel] Failed to normalize storage format, showing empty state');
    _showEmptyState();
    return;
  }

  // Update tab count
  tabCountElement.textContent = tabs.length;

  // Update last sync time
  if (state.timestamp) {
    const date = new Date(state.timestamp);
    lastSyncElement.textContent = date.toLocaleTimeString();
  }

  // Display all tabs
  container.innerHTML = '';
  tabs.forEach((tab, index) => {
    const tabElement = createTabElement(tab, index);
    container.appendChild(tabElement);
  });
}

async function displayAllQuickTabs() {
  // v1.6.3.11 - FIX Issue #21: Skip render if storage write is in progress
  if (storageWriteInProgress) {
    console.log('[Panel] Skipping render - storage write in progress');
    return;
  }
  
  try {
    // v1.6.3.11 - FIX Issue #40: Load from both storages and compare timestamps
    // This prevents stale sync data from being used when session quota exceeded
    const sessionState = await _loadFromSessionStorage();
    const syncState = await _loadFromSyncStorage();
    
    // Select the more recent state based on timestamp
    const state = _selectMoreRecentState(sessionState, syncState);

    // v1.6.3.11 - FIX Issue #22: Handle normalized format
    const tabs = _normalizeStorageFormat(state);
    if (!state || !tabs || tabs.length === 0) {
      _showEmptyState();
      return;
    }

    _renderQuickTabsList(state);
  } catch (err) {
    console.error('Error displaying Quick Tabs:', err);
    showStatus('Error loading Quick Tabs', 'error');
  }
}

/**
 * Create a tab element for display
 */
function createTabElement(tab, index) {
  const div = document.createElement('div');
  div.className = 'quick-tab-item';

  if (tab.pinnedToUrl) {
    div.classList.add('pinned');
  }

  // Create URL display
  const urlDiv = document.createElement('div');
  urlDiv.className = 'tab-url';
  urlDiv.textContent = tab.url;
  div.appendChild(urlDiv);

  // Create details
  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'tab-details';

  // Position and size
  const posSize = `${Math.round(tab.left)}px, ${Math.round(tab.top)}px • ${Math.round(tab.width)}×${Math.round(tab.height)}px`;
  detailsDiv.textContent = posSize;
  div.appendChild(detailsDiv);

  // Badges
  const badgesDiv = document.createElement('div');

  if (tab.pinnedToUrl) {
    const pinnedBadge = document.createElement('span');
    pinnedBadge.className = 'tab-badge pinned';
    pinnedBadge.textContent = `📌 Pinned to: ${new URL(tab.pinnedToUrl).hostname}`;
    badgesDiv.appendChild(pinnedBadge);
  }

  const indexBadge = document.createElement('span');
  indexBadge.className = 'tab-badge';
  indexBadge.textContent = `#${index + 1}`;
  badgesDiv.appendChild(indexBadge);

  div.appendChild(badgesDiv);

  return div;
}

/**
 * Clear all Quick Tabs
 */
async function clearAllQuickTabs() {
  if (!confirm('Clear all Quick Tabs? This will close all Quick Tabs in all tabs.')) {
    return;
  }

  try {
    // Clear from sync storage
    await browser.storage.sync.remove(STATE_KEY);

    // Clear from session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      await browser.storage.session.remove(SESSION_KEY);
    }

    showStatus('All Quick Tabs cleared!', 'success');
    await displayAllQuickTabs();

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
    console.error('Error clearing Quick Tabs:', err);
    showStatus('Error clearing Quick Tabs', 'error');
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
  document.getElementById('refreshBtn').addEventListener('click', displayAllQuickTabs);
  document.getElementById('clearAllBtn').addEventListener('click', clearAllQuickTabs);
}

// Listen for storage changes to auto-update
// v1.6.3.11 - FIX Issue #21: Track storage write state to prevent race conditions
browser.storage.onChanged.addListener((changes, areaName) => {
  if (
    (areaName === 'sync' && changes[STATE_KEY]) ||
    (areaName === 'session' && changes[SESSION_KEY])
  ) {
    // v1.6.3.11 - FIX Issue #21: Check for dirty flag indicating partial write
    const change = changes[STATE_KEY] || changes[SESSION_KEY];
    if (change?.newValue?._writeInProgress) {
      storageWriteInProgress = true;
      console.log('[Panel] Storage write in progress, deferring render');
      return;
    }
    
    storageWriteInProgress = false;
    displayAllQuickTabs();
  }
});
