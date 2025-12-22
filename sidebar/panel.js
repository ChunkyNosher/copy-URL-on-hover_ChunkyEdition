// Sidebar panel JavaScript for Quick Tabs live state debugging

// Storage keys
const STATE_KEY = 'quick_tabs_state_v2';
const SESSION_KEY = 'quick_tabs_session';

// Auto-refresh interval
let refreshInterval;

// v1.6.3.11 - FIX Issue #21: Track storage write in progress to prevent reading partial data
let storageWriteInProgress = false;

// v1.6.3.11-v3 - FIX Issue #70: Debounced storage.onChanged handler
let _storageChangeDebounceTimer = null;
const STORAGE_CHANGE_DEBOUNCE_MS = 100;

// v1.6.3.11 - FIX Issue #22: Storage format version for migration detection
// Unused but kept for potential future use
const _EXPECTED_FORMAT_VERSION = 2;

// v1.6.3.11-v2 - FIX Issue #40: Stale data threshold (1 hour in milliseconds)
const STALE_DATA_THRESHOLD_MS = 60 * 60 * 1000;

// v1.6.3.11-v2 - FIX Issue #21: Required fields for a valid Quick Tab object
const REQUIRED_QUICK_TAB_FIELDS = ['id', 'url', 'left', 'top', 'width', 'height'];

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
 * v1.6.3.11-v2 - FIX Issue #40: Check if timestamp is stale
 * @private
 * @param {number} timestamp - Timestamp to check
 * @param {number} ageMs - Age in milliseconds
 * @returns {boolean} True if stale
 */
function _isTimestampStale(timestamp, ageMs) {
  return timestamp > 0 && ageMs > STALE_DATA_THRESHOLD_MS;
}

/**
 * v1.6.3.11-v2 - FIX Issue #40: Select based on staleness, returning the non-stale one if only one is stale
 * @private
 */
function _selectNonStaleState(sessionState, syncState, isSessionStale, isSyncStale) {
  if (isSessionStale && !isSyncStale) return syncState;
  if (isSyncStale && !isSessionStale) return sessionState;
  return null; // Neither or both stale
}

/**
 * v1.6.3.11-v2 - FIX Issue #40: Select the more recent state by timestamp
 * @private
 */
function _selectByTimestamp(sessionState, syncState, sessionTimestamp, syncTimestamp) {
  if (!sessionState) return syncState;
  if (!syncState) return sessionState;
  return sessionTimestamp > syncTimestamp ? sessionState : syncState;
}

/**
 * Compare timestamps to determine which storage has more recent data
 * v1.6.3.11 - FIX Issue #40: Session vs Sync Storage Race During Init
 * v1.6.3.11-v2 - FIX Issue #40: Add stale data rejection (data older than 1 hour)
 * @param {Object|null} sessionState - State from session storage
 * @param {Object|null} syncState - State from sync storage
 * @returns {Object|null} More recent state or null if both are null/stale
 */
function _selectMoreRecentState(sessionState, syncState) {
  if (!sessionState && !syncState) return null;
  
  const now = Date.now();
  const sessionTimestamp = sessionState?.timestamp || 0;
  const syncTimestamp = syncState?.timestamp || 0;
  const sessionAge = now - sessionTimestamp;
  const syncAge = now - syncTimestamp;
  const isSessionStale = _isTimestampStale(sessionTimestamp, sessionAge);
  const isSyncStale = _isTimestampStale(syncTimestamp, syncAge);

  console.log('[Panel] STORAGE_TIMESTAMP_COMPARISON:', {
    sessionTimestamp, syncTimestamp, sessionAgeMs: sessionAge, syncAgeMs: syncAge,
    isSessionStale, isSyncStale, staleThresholdMs: STALE_DATA_THRESHOLD_MS
  });

  // Both stale - reject all
  if (isSessionStale && isSyncStale) {
    console.warn('[Panel] STALE_DATA_REJECTED: Both storages older than threshold');
    return null;
  }

  // One stale, one fresh - use the fresh one
  const nonStale = _selectNonStaleState(sessionState, syncState, isSessionStale, isSyncStale);
  if (nonStale) {
    console.log('[Panel] Using non-stale storage');
    return nonStale;
  }

  // Neither stale - use the more recent one
  return _selectByTimestamp(sessionState, syncState, sessionTimestamp, syncTimestamp);
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
 * v1.6.3.11-v2 - FIX Issue #21: Validate Quick Tab object completeness
 * Detects incomplete objects that may result from non-atomic storage writes
 * @param {Object} tab - Quick Tab object to validate
 * @returns {{valid: boolean, missingFields: string[]}} Validation result
 */
function _validateQuickTabFields(tab) {
  if (!tab || typeof tab !== 'object') {
    return { valid: false, missingFields: ['entire object'] };
  }

  const missingFields = REQUIRED_QUICK_TAB_FIELDS.filter(field => {
    const value = tab[field];
    // Check for undefined, null, or empty string for id/url
    if (value === undefined || value === null) return true;
    if ((field === 'id' || field === 'url') && value === '') return true;
    return false;
  });

  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

/**
 * v1.6.3.11-v2 - FIX Issue #21: Validate all tabs in state and filter incomplete ones
 * @param {Array} tabs - Array of Quick Tab objects
 * @returns {{validTabs: Array, invalidCount: number, warnings: string[]}} Filtered result
 */
function _filterValidQuickTabs(tabs) {
  if (!Array.isArray(tabs)) {
    return { validTabs: [], invalidCount: 0, warnings: ['tabs is not an array'] };
  }

  const validTabs = [];
  const warnings = [];
  let invalidCount = 0;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const validation = _validateQuickTabFields(tab);

    if (validation.valid) {
      validTabs.push(tab);
    } else {
      invalidCount++;
      warnings.push(`Tab[${i}] missing fields: ${validation.missingFields.join(', ')}`);
    }
  }

  if (invalidCount > 0) {
    console.warn('[Panel] INCOMPLETE_QUICK_TABS_DETECTED:', {
      totalTabs: tabs.length,
      validTabs: validTabs.length,
      invalidCount,
      warnings: warnings.slice(0, 5) // Limit warning output
    });
  }

  return { validTabs, invalidCount, warnings };
}

/**
 * v1.6.3.11-v2 - FIX Issue #22: Extract tabs from container format
 * v1.6.3.11-v3 - Refactored to reduce nesting depth
 * @private
 * @param {Object} containers - Container object with tabs
 * @returns {Array|null} Extracted tabs or null on error
 */
function _extractTabsFromContainers(containers) {
  try {
    return _collectTabsFromContainers(containers);
  } catch (err) {
    console.error('[Panel] Error extracting tabs from container format:', err.message);
    return null;
  }
}

/**
 * v1.6.3.11-v3 - Helper to collect tabs from containers
 * @private
 */
function _collectTabsFromContainers(containers) {
  const tabs = [];
  const containerKeys = Object.keys(containers);
  for (const containerKey of containerKeys) {
    const containerTabs = containers[containerKey]?.tabs;
    if (Array.isArray(containerTabs)) tabs.push(...containerTabs);
  }
  return tabs;
}

/**
 * v1.6.3.11-v2 - FIX Issue #22: Detect storage format type
 * @private
 * @param {Object} state - Raw state from storage
 * @returns {string} Format type: 'flat', 'nested', 'direct', 'container', or 'unknown'
 */
function _detectStorageFormat(state) {
  if (!state) return 'unknown';
  if (Array.isArray(state.tabs)) return 'flat';
  if (Array.isArray(state.allQuickTabs)) return 'nested';
  if (Array.isArray(state)) return 'direct';
  if (typeof state === 'object' && state.containers) return 'container';
  return 'unknown';
}

/**
 * v1.6.3.11 - FIX Issue #22: Detect and normalize storage format
 * v1.6.3.11-v2 - FIX Issue #22: Add defensive checks and better error handling
 * v1.6.3.11-v3 - Refactored to reduce complexity
 * Handles both flat array format (state.tabs) and nested object format (state.allQuickTabs)
 * @param {Object} state - Raw state from storage
 * @returns {Array|null} Normalized tabs array or null if invalid
 */
function _normalizeStorageFormat(state) {
  if (!state) return null;

  const format = _detectStorageFormat(state);
  let tabs = null;

  switch (format) {
    case 'flat':
      console.log('[Panel] Using flat tabs array format');
      tabs = state.tabs;
      break;
    case 'nested':
      console.log('[Panel] Using allQuickTabs nested format (v2)');
      tabs = state.allQuickTabs;
      break;
    case 'direct':
      console.log('[Panel] Using direct array format (legacy)');
      tabs = state;
      break;
    case 'container':
      console.log('[Panel] Detected container format, extracting tabs');
      tabs = _extractTabsFromContainers(state.containers);
      break;
    default:
      console.warn('[Panel] Unknown storage format detected:', {
        keys: Object.keys(state || {}),
        tabsType: typeof state.tabs,
        allQuickTabsType: typeof state.allQuickTabs
      });
      return null;
  }

  // Defensive type check after extraction
  if (!Array.isArray(tabs)) {
    console.error('[Panel] FORMAT_NORMALIZATION_FAILED: tabs is not an array', {
      resultType: typeof tabs
    });
    return null;
  }

  return tabs;
}

/**
 * Render Quick Tabs list
 * v1.6.3.11 - FIX Issue #22: Handle both flat and nested storage formats
 * v1.6.3.11-v2 - FIX Issue #21: Filter incomplete Quick Tab objects before rendering
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

  // v1.6.3.11-v2 - FIX Issue #21: Filter out incomplete Quick Tab objects
  const { validTabs, invalidCount } = _filterValidQuickTabs(tabs);

  if (invalidCount > 0) {
    console.warn('[Panel] RENDER_SKIPPED_INCOMPLETE_TABS:', {
      originalCount: tabs.length,
      validCount: validTabs.length,
      skippedCount: invalidCount,
      note: 'Some Quick Tabs were incomplete (possible partial storage write)'
    });
  }

  // Update tab count
  tabCountElement.textContent = validTabs.length;

  // Update last sync time
  if (state.timestamp) {
    const date = new Date(state.timestamp);
    lastSyncElement.textContent = date.toLocaleTimeString();
  }

  // Display all valid tabs
  container.innerHTML = '';
  validTabs.forEach((tab, index) => {
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

/**
 * v1.6.3.11-v3 - FIX Issue #70: Handle storage change with debouncing
 * Extracted to reduce complexity and nesting depth in listener
 * @param {Object} changes - Storage changes object
 * @param {string} areaName - Storage area name
 */
function _handleStorageChange(changes, areaName) {
  const isStateChange = areaName === 'sync' && changes[STATE_KEY];
  const isSessionChange = areaName === 'session' && changes[SESSION_KEY];
  
  if (!isStateChange && !isSessionChange) {
    return;
  }

  // v1.6.3.11 - FIX Issue #21: Check for dirty flag indicating partial write
  const change = changes[STATE_KEY] || changes[SESSION_KEY];
  if (change?.newValue?._writeInProgress) {
    storageWriteInProgress = true;
    console.log('[Panel] Storage write in progress, deferring render');
    return;
  }

  storageWriteInProgress = false;

  // v1.6.3.11-v3 - FIX Issue #70: Debounce the displayAllQuickTabs call
  if (_storageChangeDebounceTimer) {
    clearTimeout(_storageChangeDebounceTimer);
  }
  _storageChangeDebounceTimer = setTimeout(() => {
    _storageChangeDebounceTimer = null;
    displayAllQuickTabs();
  }, STORAGE_CHANGE_DEBOUNCE_MS);
}

// Listen for storage changes to auto-update
// v1.6.3.11 - FIX Issue #21: Track storage write state to prevent race conditions
// v1.6.3.11-v3 - FIX Issue #70: Debounce storage.onChanged to prevent cascading listener invocations
// v1.6.3.11-v3 - FIX Issue #59: Wrap in try-catch to prevent listener cascade failures
browser.storage.onChanged.addListener((changes, areaName) => {
  try {
    _handleStorageChange(changes, areaName);
  } catch (err) {
    // v1.6.3.11-v3 - FIX Issue #59: Log error but don't re-throw to prevent blocking other listeners
    console.error('[Panel] STORAGE_ONCHANGED_ERROR:', {
      error: err.message,
      stack: err.stack,
      areaName,
      changedKeys: Object.keys(changes || {}),
      timestamp: Date.now()
    });
  }
});
