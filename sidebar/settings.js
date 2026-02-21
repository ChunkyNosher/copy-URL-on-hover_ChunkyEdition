// Browser API compatibility shim for Firefox/Chrome cross-compatibility
// Use global browser API if available (Firefox), otherwise fall back to chrome (Chrome)
/* eslint-disable-next-line no-undef */
const browserAPI =
  typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;

// Verify browser API is available
if (!browserAPI) {
  console.error('[Settings] Browser API not available. Extension may not work properly.');
}

// ==================== v1.6.4 FIX ISSUE 10: LISTENER REGISTRATION GUARD ====================
// Prevent duplicate message listener registration when sidebar reloads
let _messageListenerRegistered = false;
// ==================== END LISTENER REGISTRATION GUARD ====================

// ==================== v1.6.4 FIX ISSUE 7 & 18: FAILED BUTTON TRACKING ====================
// Track buttons that failed to initialize for user feedback
const _failedButtonInitializations = [];
// ==================== END FAILED BUTTON TRACKING ====================

// ==================== v1.6.4 FIX ISSUE 9: TIMEOUT PROTECTION ====================
// Default timeout for async browser.runtime.sendMessage operations
// v1.6.4 - FIX BUG #2: Default timeout is 10000ms, but EXPORT_LOGS uses 30000ms
const MESSAGE_TIMEOUT_MS = 10000;
// v1.6.4 - FIX BUG #2: Extended timeout for log export (download can take time)
const EXPORT_LOGS_TIMEOUT_MS = 30000;

/**
 * Send message to background script with timeout protection
 * v1.6.4 - FIX Issue 9: Prevent indefinite hangs when background doesn't respond
 * v1.6.4 - FIX BUG #2: Updated default timeout, added extended timeout for exports
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns {Promise<Object>} Response from background script
 * @throws {Error} If timeout exceeded or message fails
 */
function sendMessageWithTimeout(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms. Please try again.`));
    }, timeoutMs);
  });

  const messagePromise = browserAPI.runtime.sendMessage(message);

  // Clean up the timer regardless of which promise resolves first
  return Promise.race([messagePromise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}
// ==================== END TIMEOUT PROTECTION ====================

// ==================== LOG EXPORT FUNCTIONS ====================

/**
 * Request logs from background script
 * v1.6.4 - FIX Issue 9: Added timeout protection
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 * @returns {Promise<Array>} Array of log entries
 */
async function getBackgroundLogs() {
  console.log('[Settings] getBackgroundLogs: Requesting logs from background script...');
  try {
    const response = await sendMessageWithTimeout({
      action: 'GET_BACKGROUND_LOGS'
    });
    const logCount = response && response.logs ? response.logs.length : 0;
    console.log(`[Settings] getBackgroundLogs: Received ${logCount} logs from background`);
    return response && response.logs ? response.logs : [];
  } catch (error) {
    console.warn('[Settings] getBackgroundLogs: Could not retrieve background logs:', error);
    return [];
  }
}

/**
 * Get the active tab
 * @returns {Promise<Object|null>} Active tab or null
 */
async function _getActiveTab() {
  const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) {
    console.warn('[Settings] No active tab found');
    return null;
  }
  return tabs[0];
}

/**
 * Log detailed error information for content script failures
 * @param {Error} error - The error object
 */
function _logContentScriptError(error) {
  if (!error.message) return;

  if (error.message.includes('Could not establish connection')) {
    console.error('[Settings] Content script not loaded in active tab');
  } else if (error.message.includes('No active tab')) {
    console.error('[Settings] No active tab found - try clicking on a webpage first');
  }
}

/**
 * Request logs from active content script
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 * @returns {Promise<Array>} Array of log entries
 */
async function getContentScriptLogs() {
  console.log('[Settings] getContentScriptLogs: Starting content script log collection...');
  try {
    const activeTab = await _getActiveTab();
    if (!activeTab) {
      console.warn('[Settings] getContentScriptLogs: No active tab available');
      return [];
    }

    console.log(`[Settings] getContentScriptLogs: Requesting logs from tab ${activeTab.id}`);

    // Request logs from content script
    const response = await browserAPI.tabs.sendMessage(activeTab.id, {
      action: 'GET_CONTENT_LOGS'
    });

    if (!response || !response.logs) {
      console.warn('[Settings] getContentScriptLogs: Content script returned no logs');
      return [];
    }

    console.log(`[Settings] getContentScriptLogs: Received ${response.logs.length} logs`);

    // Log buffer stats for debugging
    if (response.stats) {
      console.log('[Settings] Content script buffer stats:', response.stats);
    }

    return response.logs;
  } catch (error) {
    console.warn('[Settings] getContentScriptLogs: Could not retrieve content script logs:', error);
    _logContentScriptError(error);
    return [];
  }
}

/**
 * Request logs from Quick Tabs Manager iframe via postMessage
 * v1.6.4-v3 - FEATURE: Include Manager/sidebar logs in export
 * @returns {Promise<Array>} Array of log entries
 */
function getManagerLogs() {
  console.log('[Settings] getManagerLogs: Requesting logs from Manager iframe...');

  const iframe = document.querySelector('iframe');
  if (!iframe || !iframe.contentWindow) {
    console.warn('[Settings] getManagerLogs: Manager iframe not available');
    return [];
  }

  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      console.warn('[Settings] getManagerLogs: Timeout waiting for Manager response');
      window.removeEventListener('message', handler);
      resolve([]);
    }, 5000);

    const handler = event => {
      // Security check: only accept messages from same origin
      if (event.origin !== window.location.origin) return;

      if (event.data && event.data.type === 'MANAGER_LOGS_RESPONSE') {
        clearTimeout(timeoutId);
        window.removeEventListener('message', handler);
        const logCount = event.data.logs ? event.data.logs.length : 0;
        console.log(`[Settings] getManagerLogs: Received ${logCount} logs from Manager`);
        resolve(event.data.logs || []);
      }
    };

    window.addEventListener('message', handler);

    try {
      iframe.contentWindow.postMessage({ type: 'GET_MANAGER_LOGS' }, window.location.origin);
      console.log('[Settings] getManagerLogs: Sent GET_MANAGER_LOGS to iframe');
    } catch (err) {
      console.error('[Settings] getManagerLogs: Failed to send message to iframe:', err);
      clearTimeout(timeoutId);
      window.removeEventListener('message', handler);
      resolve([]);
    }
  });
}

/**
 * Format logs as plain text
 * v1.6.4 - FIX BUG #3: Add first log timestamp at top of export
 * @param {Array} logs - Array of log entries
 * @param {string} version - Extension version
 * @returns {string} Formatted log text
 */
function formatLogsAsText(logs, version) {
  const now = new Date();

  // v1.6.4 - FIX BUG #3: Calculate first log timestamp
  const firstLogTimestamp = logs[0]?.timestamp;
  const firstLogDate = firstLogTimestamp ? new Date(firstLogTimestamp) : null;

  const header = [
    '='.repeat(80),
    'Copy URL on Hover - Extension Console Logs',
    '='.repeat(80),
    '',
    `Version: ${version}`,
    `Export Date: ${now.toISOString()}`,
    `Export Date (Local): ${now.toLocaleString()}`,
    // v1.6.4 - FIX BUG #3: Add first log timestamp
    `First Log: ${firstLogDate ? firstLogDate.toISOString() : 'Unknown'}`,
    `First Log (Local): ${firstLogDate ? firstLogDate.toLocaleString() : 'Unknown'}`,
    `Total Logs: ${logs.length}`,
    '',
    '='.repeat(80),
    ''
  ].join('\n');

  const logLines = logs.map(entry => {
    const date = new Date(entry.timestamp);
    const timestamp = date.toISOString();
    return `[${timestamp}] [${entry.type.padEnd(5)}] ${entry.message}`;
  });

  const footer = ['', '='.repeat(80), 'End of Logs', '='.repeat(80)].join('\n');

  return header + logLines.join('\n') + footer;
}

/**
 * Generate filename for log export
 * @param {string} version - Extension version
 * @returns {string} Filename with version and timestamp
 */
function generateLogFilename(version) {
  const now = new Date();
  // ISO 8601 format with hyphens instead of colons for filename compatibility
  const timestamp = now.toISOString().replace(/:/g, '-').split('.')[0];
  return `copy-url-extension-logs_v${version}_${timestamp}.txt`;
}

// ==================== REMOVED IN v1.5.9.5 ====================
// utf8ToBase64() function removed - no longer needed with Blob URL approach
// Blob URLs work directly with plain text, no Base64 encoding required
// This simplifies the code and improves performance (21x faster, 33% smaller files)
// ==============================================================

/**
 * Log debug information about collected logs
 * v1.6.4-v3 - Updated to include Manager logs
 * @param {Array} backgroundLogs - Background logs
 * @param {Array} contentLogs - Content script logs
 * @param {Array} managerLogs - Manager/sidebar logs
 */
function _logCollectionDebugInfo(backgroundLogs, contentLogs, managerLogs = []) {
  console.log(`[Settings] Collected ${backgroundLogs.length} background logs`);
  console.log(`[Settings] Collected ${contentLogs.length} content logs`);
  console.log(`[Settings] Collected ${managerLogs.length} manager logs`);

  // Show breakdown by log type
  const backgroundTypes = {};
  const contentTypes = {};
  const managerTypes = {};

  backgroundLogs.forEach(log => {
    backgroundTypes[log.type] = (backgroundTypes[log.type] || 0) + 1;
  });

  contentLogs.forEach(log => {
    contentTypes[log.type] = (contentTypes[log.type] || 0) + 1;
  });

  managerLogs.forEach(log => {
    managerTypes[log.type] = (managerTypes[log.type] || 0) + 1;
  });

  console.log('[Settings] Background log types:', backgroundTypes);
  console.log('[Settings] Content log types:', contentTypes);
  console.log('[Settings] Manager log types:', managerTypes);
}

/**
 * Validation rules for collected logs
 * Each rule has a condition function and an error message
 * Rules are checked in order; first matching rule throws
 */
const LOG_VALIDATION_RULES = [
  {
    condition: (_, __, ___, ____, activeTab) => activeTab && activeTab.url.startsWith('about:'),
    message:
      'Cannot capture logs from browser internal pages (about:*, about:debugging, etc.). Try navigating to a regular webpage first.'
  },
  {
    condition: (_, __, ___, ____, activeTab) => !activeTab,
    message: 'No active tab found. Try clicking on a webpage tab first.'
  },
  {
    condition: (_, backgroundLogs, contentLogs, managerLogs) =>
      contentLogs.length === 0 && backgroundLogs.length === 0 && managerLogs.length === 0,
    message:
      'No logs found. Make sure debug mode is enabled and try using the extension (hover over links, create Quick Tabs, etc.) before exporting logs.'
  },
  {
    condition: (_, backgroundLogs, contentLogs, managerLogs) =>
      contentLogs.length === 0 && managerLogs.length === 0,
    messageBuilder: (_, backgroundLogs) =>
      `Only found ${backgroundLogs.length} background logs. Content script may not be loaded. Try reloading the webpage.`
  }
];

/**
 * Validate that logs were collected and throw appropriate errors
 * v1.6.4-v3 - Updated to include Manager logs
 * @param {Array} allLogs - All collected logs
 * @param {Array} backgroundLogs - Background logs
 * @param {Array} contentLogs - Content logs
 * @param {Array} managerLogs - Manager/sidebar logs
 * @param {Object|null} activeTab - Active tab or null
 * @throws {Error} If validation fails
 */
function _validateCollectedLogs(allLogs, backgroundLogs, contentLogs, managerLogs, activeTab) {
  if (allLogs.length > 0) {
    console.log('[Settings] Log validation passed:', allLogs.length, 'logs collected');
    return;
  }

  console.warn('[Settings] No logs to export');

  // Find first matching validation rule and throw appropriate error
  for (const rule of LOG_VALIDATION_RULES) {
    if (rule.condition(allLogs, backgroundLogs, contentLogs, managerLogs, activeTab)) {
      const errorMessage = rule.messageBuilder
        ? rule.messageBuilder(allLogs, backgroundLogs, contentLogs, managerLogs, activeTab)
        : rule.message;
      throw new Error(errorMessage);
    }
  }

  // Default error if no specific rule matched
  throw new Error('No logs found. Try enabling debug mode and using the extension first.');
}

/**
 * Delegate log export to background script
 * v1.6.4 - FIX Issue 9: Added timeout protection
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 * v1.6.4 - FIX BUG #2: Use extended timeout (30s) for export operation
 * @param {string} logText - Formatted log text
 * @param {string} filename - Export filename
 */
async function _delegateLogExport(logText, filename) {
  console.log('[Settings] _delegateLogExport: Sending export request to background script...');
  console.log(`[Settings] _delegateLogExport: Filename: ${filename}`);
  console.log(`[Settings] _delegateLogExport: Log text size: ${logText.length} chars`);

  // v1.6.4 - FIX BUG #2: Use extended timeout for export (download can take time)
  const response = await sendMessageWithTimeout(
    {
      action: 'EXPORT_LOGS',
      logText: logText,
      filename: filename
    },
    EXPORT_LOGS_TIMEOUT_MS
  );

  if (!response || !response.success) {
    const errorMessage = response?.error || 'Background script did not acknowledge export request';
    console.error('[Settings] _delegateLogExport: Export failed:', errorMessage);
    throw new Error(errorMessage);
  }

  console.log('[Settings] _delegateLogExport: Background script accepted log export request ✓');
}

/**
 * Extract category from log entry for export filtering
 * v1.6.0.9 - Added export filter support
 * v1.6.0.13 - Enhanced to handle background script component names
 */
function extractCategoryFromLogEntry(logEntry) {
  const message = logEntry.message || '';

  // Use category if already extracted by console-interceptor (v1.6.0.13)
  if (logEntry.category && logEntry.category !== 'uncategorized') {
    return logEntry.category;
  }

  // Match pattern: [emoji displayName] [Action] Message
  const match = message.match(/^\[([^\]]+)\]/);

  if (!match) {
    return 'uncategorized';
  }

  const displayName = match[1];
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim();

  // Category mapping - includes both display names and component names
  const mapping = {
    'url detection': 'url-detection',
    hover: 'hover',
    'hover events': 'hover',
    clipboard: 'clipboard',
    'clipboard operations': 'clipboard',
    keyboard: 'keyboard',
    'keyboard shortcuts': 'keyboard',
    'quick tabs': 'quick-tabs',
    'quick tab actions': 'quick-tabs',
    'quick tab manager': 'quick-tab-manager',
    'event bus': 'event-bus',
    config: 'config',
    configuration: 'config',
    state: 'state',
    'state management': 'state',
    storage: 'storage',
    'browser storage': 'storage',
    messaging: 'messaging',
    'message passing': 'messaging',
    webrequest: 'webrequest',
    'web requests': 'webrequest',
    tabs: 'tabs',
    'tab management': 'tabs',
    performance: 'performance',
    errors: 'errors',
    initialization: 'initialization',
    // Background script component names (v1.6.0.13)
    background: 'state',
    quicktabhandler: 'quick-tab-manager',
    quicktabsmanager: 'quick-tab-manager',
    storagemanager: 'storage',
    statecoordinator: 'state',
    eventbus: 'event-bus',
    popup: 'config',
    content: 'messaging',
    debug: 'quick-tabs',
    'copy-url-on-hover': 'initialization'
  };

  return mapping[normalized] || 'uncategorized';
}

/**
 * Get export filter settings from storage
 * v1.6.0.9 - Added export filter support
 * v1.6.4 - FIX Issue 7: Added logging
 */
async function getExportFilterSettings() {
  console.log('[Settings] getExportFilterSettings: Loading filter settings...');
  try {
    const result = await browserAPI.storage.local.get('exportLogCategoriesEnabled');
    if (result.exportLogCategoriesEnabled) {
      console.log('[Settings] getExportFilterSettings: Loaded custom filter settings');
      return result.exportLogCategoriesEnabled;
    }
  } catch (error) {
    console.error(
      '[Settings] getExportFilterSettings: Failed to load export filter settings:',
      error
    );
  }

  // Default: all categories enabled
  console.log('[Settings] getExportFilterSettings: Using default filter settings (all enabled)');
  return {
    'url-detection': true,
    hover: true,
    clipboard: true,
    keyboard: true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': true,
    config: true,
    state: true,
    storage: true,
    messaging: true,
    webrequest: true,
    tabs: true,
    performance: true,
    errors: true,
    initialization: true
  };
}

/**
 * Filter logs by export category settings
 * v1.6.0.9 - Added export filter support
 * v1.6.0.13 - FIX: Now respects disabled categories for uncategorized logs
 */
function filterLogsByExportSettings(allLogs, exportSettings) {
  // Check if ALL categories are disabled
  const allDisabled = Object.values(exportSettings).every(enabled => enabled === false);

  return allLogs.filter(logEntry => {
    const category = extractCategoryFromLogEntry(logEntry);

    // If all categories disabled, exclude uncategorized too (user wants minimal export)
    if (category === 'uncategorized') {
      if (allDisabled) {
        return false; // Respect user's choice to disable everything
      }
      return true; // Otherwise include uncategorized as fail-safe
    }

    // Check if category is enabled for export
    return exportSettings[category] === true;
  });
}

/**
 * Export all logs as downloadable .txt file
 * Uses Blob URLs for Firefox compatibility (data: URLs are blocked)
 * v1.6.0.9 - Added export filter support
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 * v1.6.4-v3 - FEATURE: Include Manager/sidebar logs in export
 *
 * @param {string} version - Extension version
 * @returns {Promise<void>}
 */
async function exportAllLogs(version) {
  console.log('[Settings] exportAllLogs: ========== STARTING LOG EXPORT ==========');
  console.log(`[Settings] exportAllLogs: Extension version: ${version}`);
  try {
    // Get active tab for debugging
    const activeTab = await _getActiveTab();
    if (activeTab) {
      console.log('[Settings] exportAllLogs: Active tab URL:', activeTab.url);
      console.log('[Settings] exportAllLogs: Active tab ID:', activeTab.id);
    } else {
      console.warn('[Settings] exportAllLogs: No active tab found');
    }

    // Collect logs from all sources
    // v1.6.4-v3 - Now includes Manager/sidebar logs
    console.log('[Settings] exportAllLogs: Collecting logs from all sources...');
    const backgroundLogs = await getBackgroundLogs();
    const contentLogs = await getContentScriptLogs();
    const managerLogs = await getManagerLogs();

    // Log debug information
    _logCollectionDebugInfo(backgroundLogs, contentLogs, managerLogs);

    // Merge and sort logs
    // v1.6.4-v3 - Now includes Manager logs
    const allLogs = [...backgroundLogs, ...contentLogs, ...managerLogs];
    allLogs.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Settings] exportAllLogs: Total logs captured: ${allLogs.length}`);

    // ==================== EXPORT FILTER (v1.6.0.9) ====================
    // Apply export filter settings
    const exportSettings = await getExportFilterSettings();
    console.log('[Settings] exportAllLogs: Export filter settings:', exportSettings);

    const filteredLogs = filterLogsByExportSettings(allLogs, exportSettings);
    console.log(`[Settings] exportAllLogs: Logs after export filter: ${filteredLogs.length}`);

    const percentage =
      allLogs.length > 0 ? ((filteredLogs.length / allLogs.length) * 100).toFixed(1) : '0.0';
    console.log(`[Settings] exportAllLogs: Export filter: ${percentage}% of logs included`);
    // ==================== END EXPORT FILTER ====================

    // Validate logs were collected
    _validateCollectedLogs(filteredLogs, backgroundLogs, contentLogs, managerLogs, activeTab);

    // Format logs as plain text (using filtered logs)
    const logText = formatLogsAsText(filteredLogs, version);

    // Generate filename with timestamp
    const filename = generateLogFilename(version);

    console.log(`[Settings] exportAllLogs: Exporting to: ${filename}`);
    console.log(
      `[Settings] exportAllLogs: Log text size: ${logText.length} characters (${(logText.length / 1024).toFixed(2)} KB)`
    );

    // ==================== BACKGROUND HANDOFF (v1.5.9.7) ====================
    // Firefox automatically closes the popup when the "Save As" dialog opens,
    // which destroys popup event listeners mid-download. Delegating the
    // downloads API work to the persistent background script ensures the
    // listener survives regardless of popup focus.

    await _delegateLogExport(logText, filename);
    console.log('[Settings] exportAllLogs: ========== LOG EXPORT COMPLETE ==========');

    // ==================== END BACKGROUND HANDOFF ====================
  } catch (error) {
    console.error('[Settings] exportAllLogs: ========== EXPORT FAILED ==========');
    console.error('[Settings] exportAllLogs: Error:', error);
    throw error;
  }
}

// ==================== END LOG EXPORT FUNCTIONS ====================

const DEFAULT_SETTINGS = {
  copyUrlKey: 'y',
  copyUrlCtrl: false,
  copyUrlAlt: false,
  copyUrlShift: false,

  copyTextKey: 'x',
  copyTextCtrl: false,
  copyTextAlt: false,
  copyTextShift: false,

  // Open Link in New Tab settings
  openNewTabKey: 'o',
  openNewTabCtrl: false,
  openNewTabAlt: false,
  openNewTabShift: false,
  openNewTabSwitchFocus: false,

  // Quick Tab settings
  quickTabKey: 'q',
  quickTabCtrl: false,
  quickTabAlt: false,
  quickTabShift: false,
  quickTabCloseKey: 'Escape',
  quickTabMaxWindows: 3,
  quickTabDefaultWidth: 800,
  quickTabDefaultHeight: 600,
  quickTabPosition: 'follow-cursor',
  quickTabCustomX: 100,
  quickTabCustomY: 100,
  quickTabCloseOnOpen: false,
  quickTabEnableResize: true,
  quickTabDuplicateModifier: 'shift',

  // v1.6.4-v2 - FEATURE: Live metrics settings
  quickTabsMetricsEnabled: true,
  quickTabsMetricsIntervalMs: 1000,

  showNotification: true,
  notifDisplayMode: 'tooltip',

  // Tooltip settings
  tooltipColor: '#4CAF50',
  tooltipDuration: 1500,
  tooltipAnimation: 'fade',

  // Notification settings
  notifColor: '#4CAF50',
  notifDuration: 2000,
  notifPosition: 'bottom-right',
  notifSize: 'medium',
  notifBorderColor: '#000000',
  notifBorderWidth: 1,
  notifAnimation: 'slide',

  debugMode: false,
  darkMode: true,
  menuSize: 'medium',

  // v1.6.3.4-v10 - Quick Tab Debug UID Display setting
  quickTabShowDebugId: false,

  // v1.6.0.11 - Added filter defaults (stored separately in storage but reset together)
  // These are stored as liveConsoleCategoriesEnabled and exportLogCategoriesEnabled
  // but included here for documentation and reset functionality
  _filterDefaults: true // Flag to indicate filter defaults should be reset
};

// Helper function to safely parse integer with fallback
function safeParseInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

// Helper function to validate and normalize hex color
function validateHexColor(color, fallback = DEFAULT_SETTINGS.tooltipColor) {
  if (!color) return fallback;
  // Remove whitespace
  color = color.trim();
  // Add # if missing
  if (!color.startsWith('#')) {
    color = '#' + color;
  }
  // Validate hex format (6-character format only)
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return color.toUpperCase();
  }
  return fallback;
}

// Color input to settings mapping
const COLOR_INPUTS = [
  { textId: 'tooltipColor', pickerId: 'tooltipColorPicker', settingKey: 'tooltipColor' },
  { textId: 'notifColor', pickerId: 'notifColorPicker', settingKey: 'notifColor' },
  { textId: 'notifBorderColor', pickerId: 'notifBorderColorPicker', settingKey: 'notifBorderColor' }
];

// Sync text input with color picker
function _syncColorInputs(textInput, colorPicker) {
  if (!textInput || !colorPicker) return;

  const color = validateHexColor(textInput.value);
  textInput.value = color;
  colorPicker.value = color;
}

// Load settings
function loadSettings() {
  browserAPI.storage.local.get(DEFAULT_SETTINGS, items => {
    document.getElementById('copyUrlKey').value = items.copyUrlKey;
    document.getElementById('copyUrlCtrl').checked = items.copyUrlCtrl;
    document.getElementById('copyUrlAlt').checked = items.copyUrlAlt;
    document.getElementById('copyUrlShift').checked = items.copyUrlShift;

    document.getElementById('copyTextKey').value = items.copyTextKey;
    document.getElementById('copyTextCtrl').checked = items.copyTextCtrl;
    document.getElementById('copyTextAlt').checked = items.copyTextAlt;
    document.getElementById('copyTextShift').checked = items.copyTextShift;

    // Open Link in New Tab settings
    document.getElementById('openNewTabKey').value = items.openNewTabKey;
    document.getElementById('openNewTabCtrl').checked = items.openNewTabCtrl;
    document.getElementById('openNewTabAlt').checked = items.openNewTabAlt;
    document.getElementById('openNewTabShift').checked = items.openNewTabShift;
    document.getElementById('openNewTabSwitchFocus').checked = items.openNewTabSwitchFocus;

    // Quick Tab settings
    document.getElementById('quickTabKey').value = items.quickTabKey;
    document.getElementById('quickTabCtrl').checked = items.quickTabCtrl;
    document.getElementById('quickTabAlt').checked = items.quickTabAlt;
    document.getElementById('quickTabShift').checked = items.quickTabShift;
    document.getElementById('quickTabCloseKey').value = items.quickTabCloseKey;
    document.getElementById('quickTabMaxWindows').value = items.quickTabMaxWindows;
    document.getElementById('quickTabDefaultWidth').value = items.quickTabDefaultWidth;
    document.getElementById('quickTabDefaultHeight').value = items.quickTabDefaultHeight;
    document.getElementById('quickTabPosition').value = items.quickTabPosition;
    document.getElementById('quickTabCustomX').value = items.quickTabCustomX;
    document.getElementById('quickTabCustomY').value = items.quickTabCustomY;
    document.getElementById('quickTabCloseOnOpen').checked = items.quickTabCloseOnOpen;
    document.getElementById('quickTabEnableResize').checked = items.quickTabEnableResize;
    document.getElementById('quickTabDuplicateModifier').value = items.quickTabDuplicateModifier;
    toggleCustomPosition(items.quickTabPosition);

    // v1.6.4-v2 - FEATURE: Live metrics settings
    document.getElementById('quickTabsMetricsEnabled').checked = items.quickTabsMetricsEnabled;
    document.getElementById('quickTabsMetricsInterval').value = String(
      items.quickTabsMetricsIntervalMs
    );

    document.getElementById('showNotification').checked = items.showNotification;
    document.getElementById('notifDisplayMode').value = items.notifDisplayMode;

    // Tooltip settings
    document.getElementById('tooltipColor').value = items.tooltipColor;
    document.getElementById('tooltipColorPicker').value = items.tooltipColor;
    document.getElementById('tooltipDuration').value = items.tooltipDuration;
    document.getElementById('tooltipAnimation').value = items.tooltipAnimation;

    // Notification settings
    document.getElementById('notifColor').value = items.notifColor;
    document.getElementById('notifColorPicker').value = items.notifColor;
    document.getElementById('notifDuration').value = items.notifDuration;
    document.getElementById('notifPosition').value = items.notifPosition;
    document.getElementById('notifSize').value = items.notifSize;
    document.getElementById('notifBorderColor').value = items.notifBorderColor;
    document.getElementById('notifBorderColorPicker').value = items.notifBorderColor;
    document.getElementById('notifBorderWidth').value = items.notifBorderWidth;
    document.getElementById('notifAnimation').value = items.notifAnimation;

    document.getElementById('debugMode').checked = items.debugMode;
    document.getElementById('darkMode').checked = items.darkMode;
    document.getElementById('menuSize').value = items.menuSize || 'medium';
    // v1.6.3.4-v10 - Quick Tab Debug UID Display setting
    document.getElementById('quickTabShowDebugId').checked = items.quickTabShowDebugId;

    applyTheme(items.darkMode);
    applyMenuSize(items.menuSize || 'medium');
  });
}

// Apply theme
function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// Apply menu size
function applyMenuSize(size) {
  document.body.classList.remove('menu-small', 'menu-large');
  if (size === 'small') {
    document.body.classList.add('menu-small');
  } else if (size === 'large') {
    document.body.classList.add('menu-large');
  }
}

// Toggle custom position fields visibility
function toggleCustomPosition(position) {
  const customFields = document.getElementById('customPositionFields');
  if (customFields) {
    customFields.style.display = position === 'custom' ? 'block' : 'none';
  }
}

// Show status message
function showStatus(message, isSuccess = true) {
  const statusMsg = document.getElementById('statusMsg');
  statusMsg.textContent = message;
  statusMsg.className = isSuccess ? 'status-msg success' : 'status-msg error';

  setTimeout(() => {
    statusMsg.className = 'status-msg';
  }, 3000);
}

/**
 * Gather copy URL shortcut settings from form
 * @returns {Object} Copy URL settings
 */
function _gatherCopyUrlSettings() {
  return {
    copyUrlKey: document.getElementById('copyUrlKey').value || 'y',
    copyUrlCtrl: document.getElementById('copyUrlCtrl').checked,
    copyUrlAlt: document.getElementById('copyUrlAlt').checked,
    copyUrlShift: document.getElementById('copyUrlShift').checked
  };
}

/**
 * Gather copy text shortcut settings from form
 * @returns {Object} Copy text settings
 */
function _gatherCopyTextSettings() {
  return {
    copyTextKey: document.getElementById('copyTextKey').value || 'x',
    copyTextCtrl: document.getElementById('copyTextCtrl').checked,
    copyTextAlt: document.getElementById('copyTextAlt').checked,
    copyTextShift: document.getElementById('copyTextShift').checked
  };
}

/**
 * Gather open new tab shortcut settings from form
 * @returns {Object} Open new tab settings
 */
function _gatherOpenNewTabSettings() {
  return {
    openNewTabKey: document.getElementById('openNewTabKey').value || 'o',
    openNewTabCtrl: document.getElementById('openNewTabCtrl').checked,
    openNewTabAlt: document.getElementById('openNewTabAlt').checked,
    openNewTabShift: document.getElementById('openNewTabShift').checked,
    openNewTabSwitchFocus: document.getElementById('openNewTabSwitchFocus').checked
  };
}

/**
 * Gather Quick Tab settings from form
 * @returns {Object} Quick Tab settings
 */
function _gatherQuickTabSettings() {
  return {
    quickTabKey: document.getElementById('quickTabKey').value || 'q',
    quickTabCtrl: document.getElementById('quickTabCtrl').checked,
    quickTabAlt: document.getElementById('quickTabAlt').checked,
    quickTabShift: document.getElementById('quickTabShift').checked,
    quickTabCloseKey: document.getElementById('quickTabCloseKey').value || 'Escape',
    quickTabMaxWindows: safeParseInt(document.getElementById('quickTabMaxWindows').value, 3),
    quickTabDefaultWidth: safeParseInt(document.getElementById('quickTabDefaultWidth').value, 800),
    quickTabDefaultHeight: safeParseInt(
      document.getElementById('quickTabDefaultHeight').value,
      600
    ),
    quickTabPosition: document.getElementById('quickTabPosition').value || 'follow-cursor',
    quickTabCustomX: safeParseInt(document.getElementById('quickTabCustomX').value, 100),
    quickTabCustomY: safeParseInt(document.getElementById('quickTabCustomY').value, 100),
    quickTabCloseOnOpen: document.getElementById('quickTabCloseOnOpen').checked,
    quickTabEnableResize: document.getElementById('quickTabEnableResize').checked,
    quickTabDuplicateModifier: document.getElementById('quickTabDuplicateModifier').value || 'alt',
    quickTabShowDebugId: document.getElementById('quickTabShowDebugId').checked,
    // v1.6.4-v2 - FEATURE: Live metrics settings
    quickTabsMetricsEnabled: document.getElementById('quickTabsMetricsEnabled').checked,
    quickTabsMetricsIntervalMs: safeParseInt(
      document.getElementById('quickTabsMetricsInterval').value,
      1000
    )
  };
}

/**
 * Gather notification display settings from form
 * @returns {Object} Notification display settings
 */
function _gatherNotificationSettings() {
  return {
    showNotification: document.getElementById('showNotification').checked,
    notifDisplayMode: document.getElementById('notifDisplayMode').value || 'tooltip'
  };
}

/**
 * Gather tooltip settings from form
 * @returns {Object} Tooltip settings
 */
function _gatherTooltipSettings() {
  return {
    tooltipColor: validateHexColor(
      document.getElementById('tooltipColor').value,
      DEFAULT_SETTINGS.tooltipColor
    ),
    tooltipDuration: safeParseInt(document.getElementById('tooltipDuration').value, 1500),
    tooltipAnimation: document.getElementById('tooltipAnimation').value || 'fade'
  };
}

/**
 * Gather notification appearance settings from form
 * @returns {Object} Notification appearance settings
 */
function _gatherNotificationAppearanceSettings() {
  return {
    notifColor: validateHexColor(
      document.getElementById('notifColor').value,
      DEFAULT_SETTINGS.notifColor
    ),
    notifDuration: safeParseInt(document.getElementById('notifDuration').value, 2000),
    notifPosition: document.getElementById('notifPosition').value || 'bottom-right',
    notifSize: document.getElementById('notifSize').value || 'medium',
    notifBorderColor: validateHexColor(
      document.getElementById('notifBorderColor').value,
      DEFAULT_SETTINGS.notifBorderColor
    ),
    notifBorderWidth: safeParseInt(document.getElementById('notifBorderWidth').value, 1),
    notifAnimation: document.getElementById('notifAnimation').value || 'slide'
  };
}

/**
 * Gather general/advanced settings from form
 * @returns {Object} General settings
 */
function _gatherGeneralSettings() {
  return {
    debugMode: document.getElementById('debugMode').checked,
    darkMode: document.getElementById('darkMode').checked,
    menuSize: document.getElementById('menuSize').value || 'medium'
  };
}

/**
 * Gather all settings from the form
 * Combines all settings groups into a single object
 * @returns {Object} Complete settings object
 */
function gatherSettingsFromForm() {
  return {
    ..._gatherCopyUrlSettings(),
    ..._gatherCopyTextSettings(),
    ..._gatherOpenNewTabSettings(),
    ..._gatherQuickTabSettings(),
    ..._gatherNotificationSettings(),
    ..._gatherTooltipSettings(),
    ..._gatherNotificationAppearanceSettings(),
    ..._gatherGeneralSettings()
  };
}

/**
 * Gather filter settings from checkboxes
 * v1.6.0.11 - Integrated with main save workflow
 */
function gatherFilterSettings() {
  const liveSettings = {};
  const exportSettings = {};

  // Gather live filter settings
  document.querySelectorAll('.category-checkbox[data-filter="live"]').forEach(cb => {
    liveSettings[cb.dataset.category] = cb.checked;
  });

  // Gather export filter settings
  document.querySelectorAll('.category-checkbox[data-filter="export"]').forEach(cb => {
    exportSettings[cb.dataset.category] = cb.checked;
  });

  return { liveSettings, exportSettings };
}

/**
 * Save settings from form to storage
 * v1.6.0.11 - Now also saves filter settings and notifies content scripts
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 */
async function saveSettings() {
  console.log('[Settings] saveSettings: ========== STARTING SAVE ==========');
  try {
    const settings = gatherSettingsFromForm();
    const { liveSettings, exportSettings } = gatherFilterSettings();

    console.log('[Settings] saveSettings: Gathered settings from form');

    // Save main settings
    await browserAPI.storage.local.set(settings);
    console.log('[Settings] saveSettings: Main settings saved to storage.local');

    // Save filter settings
    await browserAPI.storage.local.set({
      liveConsoleCategoriesEnabled: liveSettings,
      exportLogCategoriesEnabled: exportSettings
    });
    console.log('[Settings] saveSettings: Filter settings saved to storage.local');

    // Notify all tabs to refresh live console filter cache
    await refreshLiveConsoleFiltersInAllTabs();
    console.log('[Settings] saveSettings: Notified all tabs to refresh filters');

    showStatus('✓ Settings saved! Reload tabs to apply changes.');
    applyTheme(settings.darkMode);
    applyMenuSize(settings.menuSize);
    console.log('[Settings] saveSettings: ========== SAVE COMPLETE ==========');
  } catch (error) {
    console.error('[Settings] saveSettings: Failed to save settings:', error);
    showStatus('✗ Failed to save settings', false);
  }
}

// Save settings
// v1.6.4 - FIX Issue 7: Added button click logging
document.getElementById('saveBtn').addEventListener('click', () => {
  console.log('[Settings] BUTTON_CLICKED: saveBtn');
  saveSettings();
});

// Reset to defaults
// v1.6.0.11 - Now also resets filter settings
// v1.6.4 - FIX Issue 7: Added comprehensive logging
document.getElementById('resetBtn').addEventListener('click', async () => {
  console.log('[Settings] Reset button clicked');
  if (confirm('Reset all settings to defaults?')) {
    console.log('[Settings] Reset confirmed by user');
    try {
      // Reset main settings
      await browserAPI.storage.local.set(DEFAULT_SETTINGS);
      console.log('[Settings] Main settings reset to defaults');

      // Reset filter settings
      await browserAPI.storage.local.set({
        liveConsoleCategoriesEnabled: getDefaultLiveConsoleSettings(),
        exportLogCategoriesEnabled: getDefaultExportSettings()
      });
      console.log('[Settings] Filter settings reset to defaults');

      // Notify all tabs to refresh live console filter cache
      await refreshLiveConsoleFiltersInAllTabs();
      console.log('[Settings] Notified all tabs to refresh filters');

      // Reload UI
      loadSettings();
      loadFilterSettings();
      showStatus('✓ Settings reset to defaults!');
      console.log('[Settings] Reset complete');
    } catch (error) {
      console.error('[Settings] Failed to reset settings:', error);
      showStatus('✗ Failed to reset settings', false);
    }
  } else {
    console.log('[Settings] Reset cancelled by user');
  }
});

/**
 * v1.6.3.4 - FIX Bug #5: Helper to handle coordinated clear response
 * Extracted to reduce max-depth
 * v1.6.4 - FIX Issue 7: Added logging
 * @param {Object} response - Response from background script
 */
function _handleClearResponse(response) {
  if (response && response.success) {
    console.log('[Settings] Clear storage: Success');
    showStatus('✓ Quick Tab storage cleared! Settings preserved.');
  } else {
    const errorMsg = response?.error || 'Unknown error';
    console.error('[Settings] Clear storage: Failed -', errorMsg);
    showStatus('✗ Error clearing storage: ' + errorMsg);
  }
}

// Clear Quick Tab storage button
// v1.6.3.4 - FIX Bug #5: Coordinate through background script to prevent storage write storm
// v1.6.4 - FIX Issue 9: Added timeout protection
// v1.6.4 - FIX Issue 7: Added comprehensive logging
document.getElementById('clearStorageBtn').addEventListener('click', async () => {
  console.log('[Settings] BUTTON_CLICKED: clearStorageBtn');
  const confirmed = confirm(
    'This will clear Quick Tab positions and state. Your settings and keybinds will be preserved. Are you sure?'
  );

  if (!confirmed) {
    console.log('[Settings] Clear storage cancelled by user');
    return;
  }

  console.log('[Settings] Clear storage confirmed by user');
  try {
    // v1.6.3.4 - FIX Bug #5: Send coordinated clear to background script
    // Background will: 1) Clear storage once 2) Broadcast QUICK_TABS_CLEARED to all tabs
    // This prevents N tabs from all trying to clear storage simultaneously
    // v1.6.4 - FIX Issue 9: Use timeout-protected message sending
    console.log('[Settings] Sending COORDINATED_CLEAR_ALL_QUICK_TABS to background...');
    const response = await sendMessageWithTimeout({
      action: 'COORDINATED_CLEAR_ALL_QUICK_TABS'
    });
    console.log('[Settings] Clear storage response:', response);
    _handleClearResponse(response);
  } catch (err) {
    console.error('[Settings] Clear storage error:', err);
    showStatus('✗ Error clearing storage: ' + err.message);
  }
});

// Dark mode toggle
document.getElementById('darkMode').addEventListener('change', function () {
  applyTheme(this.checked);
});

// Menu size change
document.getElementById('menuSize').addEventListener('change', function () {
  applyMenuSize(this.value);
});

// Quick Tab position change
document.getElementById('quickTabPosition').addEventListener('change', function () {
  toggleCustomPosition(this.value);
});

// ==================== TWO-LAYER TAB SYSTEM ====================

/**
 * Update the active state of primary tab buttons
 * @param {string} primaryTab - The primary tab identifier
 */
function _updatePrimaryTabActiveState(primaryTab) {
  document.querySelectorAll('.primary-tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-primary-tab="${primaryTab}"]`)?.classList.add('active');
}

/**
 * Handle switching to the Settings primary tab
 * Shows secondary tabs and restores last active secondary tab
 * Shows footer buttons (Save Settings, Reset to Defaults)
 * @param {HTMLElement|null} secondaryTabsContainer - The secondary tabs container
 * @param {HTMLElement|null} managerContent - The manager content element
 */
function _switchToSettingsTab(secondaryTabsContainer, managerContent) {
  if (secondaryTabsContainer) {
    secondaryTabsContainer.style.display = 'flex';
  }

  if (managerContent) {
    managerContent.classList.remove('active');
  }

  // v1.6.4-v3 - FIX: Show footer buttons when on Settings tab
  const footerButtons = document.querySelector('.footer-buttons');
  if (footerButtons) {
    footerButtons.style.display = 'flex';
  }

  const lastSecondaryTab = getStoredSecondaryTab() || 'copy-url';
  showSecondaryTab(lastSecondaryTab);
}

/**
 * Handle switching to the Manager primary tab
 * Hides secondary tabs and shows manager content
 * Hides footer buttons (Save Settings, Reset to Defaults)
 * @param {HTMLElement|null} secondaryTabsContainer - The secondary tabs container
 * @param {HTMLElement|null} managerContent - The manager content element
 */
function _switchToManagerTab(secondaryTabsContainer, managerContent) {
  if (secondaryTabsContainer) {
    secondaryTabsContainer.style.display = 'none';
  }

  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id !== 'manager') {
      content.classList.remove('active');
    }
  });

  if (managerContent) {
    managerContent.classList.add('active');
  }

  // v1.6.4-v3 - FIX: Hide footer buttons when on Manager tab (not relevant to Manager)
  const footerButtons = document.querySelector('.footer-buttons');
  if (footerButtons) {
    footerButtons.style.display = 'none';
  }
}

/**
 * Primary tab switch handlers map
 * Maps tab identifiers to their handler functions
 */
const PRIMARY_TAB_HANDLERS = {
  settings: _switchToSettingsTab,
  manager: _switchToManagerTab
};

/**
 * Handle primary tab switching (Settings vs Manager)
 * @param {string} primaryTab - The primary tab identifier ('settings' or 'manager')
 */
function handlePrimaryTabSwitch(primaryTab) {
  _updatePrimaryTabActiveState(primaryTab);

  const secondaryTabsContainer = document.getElementById('settings-subtabs');
  const managerContent = document.getElementById('manager');

  const handler = PRIMARY_TAB_HANDLERS[primaryTab];
  if (handler) {
    handler(secondaryTabsContainer, managerContent);
  }

  storePrimaryTab(primaryTab);
}

/**
 * Handle secondary tab switching (only when Settings is active)
 * @param {string} secondaryTab - The secondary tab identifier
 */
function showSecondaryTab(secondaryTab) {
  // Update secondary tab active state
  document.querySelectorAll('.secondary-tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${secondaryTab}"]`)?.classList.add('active');

  // Show corresponding content
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === secondaryTab) {
      content.classList.add('active');
    } else if (content.id !== 'manager') {
      content.classList.remove('active');
    }
  });

  // Store secondary tab selection
  storeSecondaryTab(secondaryTab);
}

/**
 * Get stored primary tab selection
 * @returns {string} Primary tab identifier
 */
function getStoredPrimaryTab() {
  try {
    return localStorage.getItem('sidebarActivePrimaryTab') || 'settings';
  } catch (error) {
    console.error('[Settings] Failed to get stored primary tab:', error);
    return 'settings';
  }
}

/**
 * Get stored secondary tab selection
 * @returns {string} Secondary tab identifier
 */
function getStoredSecondaryTab() {
  try {
    return localStorage.getItem('sidebarActiveSecondaryTab') || 'copy-url';
  } catch (error) {
    console.error('[Settings] Failed to get stored secondary tab:', error);
    return 'copy-url';
  }
}

/**
 * Store primary tab selection
 * @param {string} primaryTab - Primary tab identifier
 */
function storePrimaryTab(primaryTab) {
  try {
    localStorage.setItem('sidebarActivePrimaryTab', primaryTab);
  } catch (error) {
    console.error('[Settings] Failed to store primary tab:', error);
  }
}

/**
 * Store secondary tab selection
 * @param {string} secondaryTab - Secondary tab identifier
 */
function storeSecondaryTab(secondaryTab) {
  try {
    localStorage.setItem('sidebarActiveSecondaryTab', secondaryTab);
  } catch (error) {
    console.error('[Settings] Failed to store secondary tab:', error);
  }
}

/**
 * v1.6.3.4-v3 - FIX Bug #3: Check storage for requested tab from keyboard shortcut
 * Background script sets _requestedPrimaryTab before opening sidebar to ensure
 * the correct tab is shown even on first open (when message listener isn't ready)
 */
async function _checkAndApplyRequestedTab() {
  try {
    const result = await browserAPI.storage.local.get('_requestedPrimaryTab');
    const requestedTab = result._requestedPrimaryTab;

    if (requestedTab) {
      console.debug('[Settings] Found requested tab from keyboard shortcut:', requestedTab);

      // Apply the requested tab
      handlePrimaryTabSwitch(requestedTab);

      // Clear the request so it doesn't persist across sessions
      await browserAPI.storage.local.remove('_requestedPrimaryTab');
      console.debug('[Settings] Cleared _requestedPrimaryTab from storage');
    } else {
      // No keyboard shortcut request - restore last used tab
      const storedPrimaryTab = getStoredPrimaryTab();
      handlePrimaryTabSwitch(storedPrimaryTab);
    }
  } catch (error) {
    // v1.6.3.4-v4 - FIX: More specific error message about what failed
    console.error('[Settings] Failed to check requested tab from storage.local:', error);
    // Fallback to stored tab on error (localStorage or default)
    const storedPrimaryTab = getStoredPrimaryTab();
    handlePrimaryTabSwitch(storedPrimaryTab);
  }
}

// ==================== END TWO-LAYER TAB SYSTEM ====================

/**
 * Setup two-way sync between color text input and color picker
 * v1.6.1.4 - Moved outside DOMContentLoaded to reduce function size
 * @param {HTMLInputElement} textInput - Text input element
 * @param {HTMLInputElement} pickerInput - Color picker element
 */
function setupColorInputSync(textInput, pickerInput) {
  // When text input changes, update picker
  textInput.addEventListener('input', () => {
    const color = validateHexColor(textInput.value);
    textInput.value = color;
    pickerInput.value = color;
  });

  textInput.addEventListener('blur', () => {
    const color = validateHexColor(textInput.value);
    textInput.value = color;
    pickerInput.value = color;
  });

  // When picker changes, update text input
  pickerInput.addEventListener('input', () => {
    const color = pickerInput.value.toUpperCase();
    textInput.value = color;
  });
}

/**
 * Handle export logs button click
 * v1.6.1.4 - Extracted from DOMContentLoaded
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 */
async function handleExportAllLogs() {
  console.log('[Settings] BUTTON_CLICKED: exportLogsBtn');
  console.log('[Settings] handleExportAllLogs: Starting export process...');
  const manifest = browserAPI.runtime.getManifest();
  console.log('[Settings] handleExportAllLogs: Extension version:', manifest.version);
  await exportAllLogs(manifest.version);
  console.log('[Settings] handleExportAllLogs: Export complete');
}

/**
 * Build status message for cleared logs
 * v1.6.4-v5 - Extracted from handleClearLogHistory to reduce complexity
 * @param {number} backgroundEntries - Number of background log entries cleared
 * @param {number} clearedTabs - Number of tabs where logs were cleared
 * @returns {string} Status message to display
 */
function _buildClearLogStatusMessage(backgroundEntries, clearedTabs) {
  const parts = [];
  if (backgroundEntries > 0) {
    parts.push(`${backgroundEntries} background log${backgroundEntries === 1 ? '' : 's'}`);
  }
  if (clearedTabs > 0) {
    parts.push(`logs from ${clearedTabs} tab${clearedTabs === 1 ? '' : 's'}`);
  }

  if (parts.length > 0) {
    return `✓ Cleared ${parts.join(' and ')}. Manager logs also cleared.`;
  }
  return '✓ Log buffers cleared. No cached logs were present.';
}

/**
 * Send clear messages to manager iframe
 * v1.6.4-v5 - Extracted from handleClearLogHistory to reduce complexity
 */
function _clearManagerLogsViaIframe() {
  const iframe = document.querySelector('iframe');
  if (!iframe?.contentWindow) {
    return;
  }

  try {
    // Clear log action counts for metrics
    iframe.contentWindow.postMessage({ type: 'CLEAR_LOG_ACTION_COUNTS' }, window.location.origin);
    console.log('[Settings] handleClearLogHistory: Sent CLEAR_LOG_ACTION_COUNTS to iframe');

    // v1.6.4-v3 - Clear Manager log buffer
    iframe.contentWindow.postMessage({ type: 'CLEAR_MANAGER_LOGS' }, window.location.origin);
    console.log('[Settings] handleClearLogHistory: Sent CLEAR_MANAGER_LOGS to iframe');
  } catch (err) {
    console.warn('[Settings] handleClearLogHistory: Failed to send message to iframe:', err);
  }
}

/**
 * Handle clear logs button click
 * v1.6.1.4 - Extracted from DOMContentLoaded
 * v1.6.4 - FIX Issue 9: Added timeout protection
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 * v1.6.4-v5 - Added confirmation dialog before clearing logs
 * v1.6.4-v5 - Improved status message to show accurate counts
 */
async function handleClearLogHistory() {
  console.log('[Settings] BUTTON_CLICKED: clearLogsBtn');

  // v1.6.4-v5 - Add confirmation dialog before clearing
  const confirmed = confirm(
    'Clear all log history? This will clear background logs, content script logs, and manager logs. This cannot be undone.'
  );

  if (!confirmed) {
    console.log('[Settings] Clear log history cancelled by user');
    return;
  }

  console.log('[Settings] Clear log history confirmed by user');
  console.log('[Settings] handleClearLogHistory: Sending CLEAR_CONSOLE_LOGS to background...');

  const response = await sendMessageWithTimeout({
    action: 'CLEAR_CONSOLE_LOGS'
  });

  console.log('[Settings] handleClearLogHistory: Response received:', response);

  const clearedTabs = response?.clearedTabs || 0;
  const backgroundEntries = response?.clearedBackgroundEntries || 0;

  // v1.6.4-v3 - Also clear Manager log buffer
  _clearManagerLogsViaIframe();

  // v1.6.4-v5 - Build accurate status message with all cleared sources
  const statusMsg = _buildClearLogStatusMessage(backgroundEntries, clearedTabs);
  console.log('[Settings] handleClearLogHistory:', statusMsg);
  showStatus(statusMsg, true);
}

/**
 * Setup button with async handler that shows loading/success/error states
 * v1.6.1.4 - Extracted from DOMContentLoaded
 * v1.6.4 - FIX Issue 7 & 18: Added defensive null checks, initialization logging,
 *          and user-facing feedback for failed button initialization
 * @param {string} buttonId - Button element ID
 * @param {Function} handler - Async handler function
 * @param {Object} options - Configuration options
 * @returns {boolean} True if button was found and initialized, false otherwise
 */
function setupButtonHandler(buttonId, handler, options = {}) {
  console.log(`[Settings][INIT] Button initialization: ${buttonId} - checking...`);
  const button = document.getElementById(buttonId);

  // v1.6.4 - FIX Issue 7 & 18: Defensive null check with logging and tracking
  if (!button) {
    console.warn(`[Settings][INIT] Button initialization: ${buttonId} - NOT FOUND`);
    console.warn(`[Settings][INIT] Listener NOT attached for: ${buttonId}`);
    // Track failed initialization for user feedback
    _failedButtonInitializations.push(buttonId);
    return false;
  }

  console.log(`[Settings][INIT] Button initialization: ${buttonId} - FOUND`);

  const {
    loadingText = '⏳ Loading...',
    successText = '✓ Success!',
    errorText = '✗ Failed',
    successDuration = 2000,
    errorDuration = 3000
  } = options;

  button.addEventListener('click', async () => {
    console.log(`[Settings] BUTTON_CLICKED: ${buttonId}`);
    const originalText = button.textContent;
    const originalBg = button.style.backgroundColor;

    try {
      // Show loading state
      button.disabled = true;
      button.textContent = loadingText;
      console.log(`[Settings] ${buttonId}: Handler starting...`);

      // Execute handler
      await handler();

      console.log(`[Settings] ${buttonId}: Handler completed successfully`);

      // Show success state
      button.textContent = successText;
      button.classList.add('success');

      // Reset after duration
      setTimeout(() => {
        button.textContent = originalText;
        button.style.backgroundColor = originalBg;
        button.classList.remove('success');
        button.disabled = false;
      }, successDuration);
    } catch (error) {
      console.error(`[Settings] ${buttonId}: Handler failed:`, error);

      // Show error state
      button.textContent = errorText;
      button.classList.add('error');

      // Show error message in status
      showStatus(`${originalText} failed: ${error.message}`, false);

      // Reset after duration
      setTimeout(() => {
        button.textContent = originalText;
        button.style.backgroundColor = originalBg;
        button.classList.remove('error');
        button.disabled = false;
      }, errorDuration);
    }
  });

  // v1.6.4 - FIX Issue 7: Log successful listener attachment
  console.log(`[Settings][INIT] Event listener attached: ${buttonId}`);
  return true;
}

/**
 * Initialize tab switching event handlers
 * v1.6.1.4 - Extracted to fix max-lines-per-function eslint warning
 * v1.6.3.4-v3 - FIX Bug #3: Check storage for requested tab on initialization
 * v1.6.4 - FIX Issue 10: Added listener registration guard to prevent duplicates
 */
function initializeTabSwitching() {
  console.log('[Settings][INIT] Initializing tab switching...');

  // Primary tab switching
  document.querySelectorAll('.primary-tab-button').forEach(btn => {
    btn.addEventListener('click', event => {
      const primaryTab = event.currentTarget.dataset.primaryTab;
      console.log(`[Settings] Primary tab clicked: ${primaryTab}`);
      handlePrimaryTabSwitch(primaryTab);
    });
  });

  // Secondary tab switching
  document.querySelectorAll('.secondary-tab-button').forEach(btn => {
    btn.addEventListener('click', event => {
      const secondaryTab = event.currentTarget.dataset.tab;
      console.log(`[Settings] Secondary tab clicked: ${secondaryTab}`);
      showSecondaryTab(secondaryTab);
    });
  });

  // v1.6.3.4-v3 - FIX Bug #3: Check for requested tab from keyboard shortcut
  // Background script sets _requestedPrimaryTab before opening sidebar
  _checkAndApplyRequestedTab();

  // v1.6.4 - FIX Issue 10: Guard against duplicate listener registration
  // Firefox sidebars can reload, and listeners stack up without cleanup
  if (_messageListenerRegistered) {
    console.debug(
      '[Settings] Message listener already registered, skipping duplicate registration'
    );
    return;
  }

  // Listen for messages from background script to switch tabs
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.debug('[Settings] Received message:', message.type);
    if (message.type === 'SWITCH_TO_MANAGER_TAB') {
      handlePrimaryTabSwitch('manager');
    } else if (message.type === 'SWITCH_TO_SETTINGS_TAB') {
      handlePrimaryTabSwitch('settings');
    } else if (message.type === 'GET_CURRENT_PRIMARY_TAB') {
      // Return the current primary tab state
      sendResponse({ primaryTab: getStoredPrimaryTab() });
      return true; // Keep the message channel open for sendResponse
    }
  });

  // v1.6.4 - FIX Issue 10: Mark listener as registered
  _messageListenerRegistered = true;
  console.debug('[Settings][INIT] Tab switching initialized, message listener registered');
}

/**
 * Display a banner for failed button initializations
 * v1.6.4 - FIX Issue 18: User-facing feedback for initialization failures
 */
function displayFailedButtonBanner() {
  if (_failedButtonInitializations.length === 0) {
    console.log('[Settings][INIT] All buttons initialized successfully');
    return;
  }

  console.warn(
    `[Settings][INIT] ${_failedButtonInitializations.length} button(s) failed to initialize:`,
    _failedButtonInitializations
  );

  // Create and insert a warning banner
  const banner = document.createElement('div');
  banner.id = 'failed-buttons-banner';
  banner.style.cssText = `
    background: #4a2a2a;
    border: 1px solid #f44336;
    border-radius: 4px;
    padding: 12px;
    margin: 8px 16px;
    color: #f44336;
    font-size: 12px;
    line-height: 1.4;
  `;
  banner.innerHTML = `
    <strong>⚠️ Initialization Warning:</strong><br>
    The following buttons could not be initialized: <code>${_failedButtonInitializations.join(', ')}</code><br>
    <small style="color: #888;">Try reloading the extension or refreshing this page.</small>
  `;

  // Insert after the secondary tabs
  const secondaryTabs = document.getElementById('settings-subtabs');
  if (secondaryTabs && secondaryTabs.parentNode) {
    secondaryTabs.parentNode.insertBefore(banner, secondaryTabs.nextSibling);
  }
}

// Tab switching logic
// v1.6.4 - FIX Issue 7 & 18: Added initialization logging and failed button banner
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Settings][INIT] ========== DOMContentLoaded fired ==========');
  console.log('[Settings][INIT] Starting settings page initialization...');

  // Initialize two-layer tab system
  initializeTabSwitching();

  // Set footer version dynamically
  const manifest = browserAPI.runtime.getManifest();
  const footerElement = document.getElementById('footerVersion');
  if (footerElement) {
    footerElement.textContent = `${manifest.name} v${manifest.version}`;
    console.log(`[Settings][INIT] Footer version set: ${manifest.version}`);
  }

  // Add color input event listeners to sync text and picker inputs
  console.log('[Settings][INIT] Setting up color input sync...');
  COLOR_INPUTS.forEach(({ textId, pickerId }) => {
    const textInput = document.getElementById(textId);
    const pickerInput = document.getElementById(pickerId);

    if (textInput && pickerInput) {
      setupColorInputSync(textInput, pickerInput);
      console.log(`[Settings][INIT] Color sync setup: ${textId} <-> ${pickerId}`);
    } else {
      console.warn(`[Settings][INIT] Color input not found: ${textId} or ${pickerId}`);
    }
  });

  // ==================== EXPORT LOGS BUTTON ====================
  // Export logs button event listener
  console.log('[Settings][INIT] Setting up Export Logs button...');
  setupButtonHandler('exportLogsBtn', handleExportAllLogs, {
    loadingText: '⏳ Exporting...',
    successText: '✓ Logs Exported!',
    errorText: '✗ Export Failed'
  });
  // ==================== END EXPORT LOGS BUTTON ====================

  // ==================== CLEAR LOGS BUTTON ====================
  console.log('[Settings][INIT] Setting up Clear Logs button...');
  setupButtonHandler('clearLogsBtn', handleClearLogHistory, {
    loadingText: '⏳ Clearing...',
    successText: '✓ Logs Cleared',
    errorText: '✗ Clear Failed'
  });
  // ==================== END CLEAR LOGS BUTTON ====================

  // ==================== COLLAPSIBLE FILTER GROUPS ====================
  // v1.6.0.11 - Removed separate save/reset buttons; filters now save with main "Save Settings"
  console.log('[Settings][INIT] Initializing collapsible groups...');
  initCollapsibleGroups();
  console.log('[Settings][INIT] Loading filter settings...');
  loadFilterSettings();
  // ==================== END COLLAPSIBLE FILTER GROUPS ====================

  // v1.6.4 - FIX Issue 18: Display banner if any buttons failed to initialize
  displayFailedButtonBanner();

  console.log('[Settings][INIT] ========== DOMContentLoaded initialization complete ==========');
});

// ==================== FILTER SETTINGS FUNCTIONS ====================

/**
 * Get default live console filter settings
 */
function getDefaultLiveConsoleSettings() {
  return {
    'url-detection': false, // Noisy - disabled by default
    hover: false, // Noisy - disabled by default
    clipboard: true,
    keyboard: true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': false,
    config: true,
    state: false,
    storage: true,
    messaging: false,
    webrequest: true,
    tabs: true,
    performance: false,
    errors: true,
    initialization: true
  };
}

/**
 * Get default export filter settings
 */
function getDefaultExportSettings() {
  return {
    'url-detection': true, // All enabled by default for comprehensive export
    hover: true,
    clipboard: true,
    keyboard: true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': true,
    config: true,
    state: true,
    storage: true,
    messaging: true,
    webrequest: true,
    tabs: true,
    performance: true,
    errors: true,
    initialization: true
  };
}

/**
 * v1.6.0.12 - Update the live counter for a filter group
 * @param {HTMLElement} groupElement - The filter group container
 */
function updateGroupCounter(groupElement) {
  // Get filter type from button (more reliable than checkbox)
  const btn = groupElement.querySelector('.group-btn');
  if (!btn) return;

  const filter = btn.dataset.filter;
  const checkboxes = groupElement.querySelectorAll(`.category-checkbox[data-filter="${filter}"]`);
  const counter = groupElement.querySelector('.group-counter');

  if (!counter) return;

  const total = checkboxes.length;
  const checked = Array.from(checkboxes).filter(cb => cb.checked).length;

  counter.textContent = `${checked}/${total}`;
}

/**
 * v1.6.0.12 - Update button colors based on checkbox states
 * @param {HTMLElement} groupElement - The filter group container
 */
function updateButtonColors(groupElement) {
  // Get filter type from button (more reliable than checkbox)
  const btn = groupElement.querySelector('.group-btn');
  if (!btn) return;

  const filter = btn.dataset.filter;
  const checkboxes = groupElement.querySelectorAll(`.category-checkbox[data-filter="${filter}"]`);
  const selectAllBtn = groupElement.querySelector('[data-action="select-all"]');
  const deselectAllBtn = groupElement.querySelector('[data-action="deselect-all"]');

  if (!selectAllBtn || !deselectAllBtn) return;

  const total = checkboxes.length;
  const checked = Array.from(checkboxes).filter(cb => cb.checked).length;

  // Update Select All button - green when all selected
  if (checked === total) {
    selectAllBtn.classList.add('all-selected');
  } else {
    selectAllBtn.classList.remove('all-selected');
  }

  // Update Deselect All button - red when none selected
  if (checked === 0) {
    deselectAllBtn.classList.add('all-deselected');
  } else {
    deselectAllBtn.classList.remove('all-deselected');
  }
}

/**
 * v1.6.0.12 - Update all group counters and button colors
 */
function updateAllGroupStates() {
  document.querySelectorAll('.filter-group').forEach(group => {
    updateGroupCounter(group);
    updateButtonColors(group);
  });
}

/**
 * Initialize collapsible groups functionality
 */
function initCollapsibleGroups() {
  // Handle group action buttons (Select All / Deselect All)
  document.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation(); // Prevent triggering group toggle

      const action = btn.dataset.action;
      const filter = btn.dataset.filter;

      // Find all checkboxes in this group
      const groupElement = btn.closest('.filter-group');
      const checkboxes = groupElement.querySelectorAll(
        `.category-checkbox[data-filter="${filter}"]`
      );

      if (action === 'select-all') {
        checkboxes.forEach(cb => (cb.checked = true));
      } else if (action === 'deselect-all') {
        checkboxes.forEach(cb => (cb.checked = false));
      }

      // v1.6.0.12 - Update counter and button colors immediately
      updateGroupCounter(groupElement);
      updateButtonColors(groupElement);
    });
  });

  // v1.6.0.12 - Add change listeners to all checkboxes for live updates
  document.querySelectorAll('.category-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const groupElement = checkbox.closest('.filter-group');
      updateGroupCounter(groupElement);
      updateButtonColors(groupElement);
    });
  });
}

/**
 * Load filter settings from storage
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 */
async function loadFilterSettings() {
  console.log('[Settings] loadFilterSettings: Loading filter settings from storage...');
  try {
    const result = await browserAPI.storage.local.get([
      'liveConsoleCategoriesEnabled',
      'exportLogCategoriesEnabled'
    ]);

    const liveSettings = result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
    const exportSettings = result.exportLogCategoriesEnabled || getDefaultExportSettings();

    console.log('[Settings] loadFilterSettings: Live settings loaded');
    console.log('[Settings] loadFilterSettings: Export settings loaded');

    // Apply to live filter checkboxes
    let liveCount = 0;
    document.querySelectorAll('.category-checkbox[data-filter="live"]').forEach(cb => {
      const category = cb.dataset.category;
      cb.checked = liveSettings[category] === true;
      liveCount++;
    });
    console.log(`[Settings] loadFilterSettings: Applied ${liveCount} live filter checkboxes`);

    // Apply to export filter checkboxes
    let exportCount = 0;
    document.querySelectorAll('.category-checkbox[data-filter="export"]').forEach(cb => {
      const category = cb.dataset.category;
      cb.checked = exportSettings[category] === true;
      exportCount++;
    });
    console.log(`[Settings] loadFilterSettings: Applied ${exportCount} export filter checkboxes`);

    // v1.6.0.12 - Update all counters and button colors after loading
    updateAllGroupStates();
    console.log('[Settings] loadFilterSettings: Filter settings loaded successfully');
  } catch (error) {
    console.error('[Settings] loadFilterSettings: Failed to load filter settings:', error);
  }
}

// v1.6.0.11 - Removed saveFilterSettings() and resetFilterSettings()
// Filter settings now save with main "Save Settings" button via gatherFilterSettings()
// Reset functionality handled by main "Reset to Defaults" button

/**
 * Notify all tabs to refresh live console filter cache
 * v1.6.4 - FIX Issue 7: Added comprehensive logging
 */
async function refreshLiveConsoleFiltersInAllTabs() {
  console.log('[Settings] refreshLiveConsoleFiltersInAllTabs: Starting...');
  try {
    const tabs = await browserAPI.tabs.query({});
    console.log(`[Settings] refreshLiveConsoleFiltersInAllTabs: Found ${tabs.length} tabs`);

    let successCount = 0;
    let failCount = 0;

    const messagePromises = tabs.map(tab =>
      browserAPI.tabs
        .sendMessage(tab.id, {
          action: 'REFRESH_LIVE_CONSOLE_FILTERS'
        })
        .then(() => {
          successCount++;
        })
        .catch(() => {
          // Tab might not have content script loaded - silently ignore
          failCount++;
        })
    );
    await Promise.all(messagePromises);
    console.log(
      `[Settings] refreshLiveConsoleFiltersInAllTabs: Notified ${successCount} tabs (${failCount} without content script)`
    );
  } catch (error) {
    console.error('[Settings] refreshLiveConsoleFiltersInAllTabs: Failed:', error);
  }
}

// ==================== END FILTER SETTINGS FUNCTIONS ====================

// ==================== v1.6.4-v3: METRICS FOOTER COMMUNICATION ====================
// Cached DOM element references for metrics footer (populated on first message)
let _metricsFooterParent = null;
let _metricQuickTabsEl = null;
let _metricLogsPerSecondEl = null;
let _metricTotalLogsEl = null;
// v1.6.4-v3 - Task 2: Additional elements for expandable breakdown
let _metricsToggleEl = null;
let _metricsDetailsEl = null;
let _metricsBreakdownEl = null;
let _metricsExpandHintEl = null;
// State for details expansion
let _metricsDetailsExpanded = false;

/**
 * Initialize metrics DOM element cache
 * v1.6.4-v3 - FEATURE: Cache element references to avoid repeated getElementById
 * @private
 */
function _initMetricsElementCache() {
  if (_metricsFooterParent) return; // Already initialized
  _metricsFooterParent = document.getElementById('metricsFooterParent');
  _metricQuickTabsEl = document.getElementById('metricQuickTabsParent');
  _metricLogsPerSecondEl = document.getElementById('metricLogsPerSecondParent');
  _metricTotalLogsEl = document.getElementById('metricTotalLogsParent');
  // v1.6.4-v3 - Task 2: Additional elements
  _metricsToggleEl = document.getElementById('metricsToggle');
  _metricsDetailsEl = document.getElementById('metricsDetails');
  _metricsBreakdownEl = document.getElementById('metricsBreakdown');
  _metricsExpandHintEl = document.getElementById('metricsExpandHint');

  // Set up toggle click handler
  if (_metricsToggleEl) {
    _metricsToggleEl.addEventListener('click', _toggleMetricsDetails);
  }
}

/**
 * Toggle the metrics details expansion
 * v1.6.4-v3 - Task 2: Expandable category breakdown
 * @private
 */
function _toggleMetricsDetails() {
  _metricsDetailsExpanded = !_metricsDetailsExpanded;

  if (_metricsDetailsEl) {
    if (_metricsDetailsExpanded) {
      _metricsDetailsEl.classList.add('expanded');
    } else {
      _metricsDetailsEl.classList.remove('expanded');
    }
  }

  if (_metricsExpandHintEl) {
    _metricsExpandHintEl.textContent = _metricsDetailsExpanded ? '▲' : '▼';
  }
}

/**
 * Check if a metrics message event is valid
 * v1.6.4-v3 - FEATURE: Extracted to reduce complexity
 * @private
 * @param {MessageEvent} event - Message event
 * @returns {{valid: boolean, data: Object|null}} Validation result
 */
function _validateMetricsMessage(event) {
  // Accept messages from same origin only
  if (event.origin !== window.location.origin) return { valid: false, data: null };
  const data = event.data || {};
  if (data.type !== 'METRICS_UPDATE') return { valid: false, data: null };
  return { valid: true, data };
}

// Category display names for the breakdown
const CATEGORY_DISPLAY_NAMES = {
  'url-detection': '🔍 URL Detection',
  hover: '👆 Hover',
  clipboard: '📋 Clipboard',
  keyboard: '⌨️ Keyboard',
  'quick-tabs': '🪟 Quick Tabs',
  'quick-tab-manager': '📊 Manager',
  'event-bus': '📡 Event Bus',
  config: '⚙️ Config',
  state: '💾 State',
  storage: '💿 Storage',
  messaging: '💬 Messaging',
  webrequest: '🌐 WebRequest',
  tabs: '📑 Tabs',
  performance: '⏱️ Perf',
  errors: '❌ Errors',
  initialization: '🚀 Init',
  uncategorized: '❓ Other'
};

/**
 * Create a category breakdown item element safely
 * v1.6.4-v3 - Task 2: Secure DOM element creation (avoid innerHTML XSS)
 * @private
 * @param {string} displayName - Category display name
 * @param {number} count - Count value
 * @returns {HTMLElement} The created element
 */
function _createBreakdownItem(displayName, count) {
  const item = document.createElement('div');
  item.className = 'metrics-breakdown-item';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'cat-name';
  nameSpan.textContent = displayName;

  const countSpan = document.createElement('span');
  countSpan.className = 'cat-count';
  countSpan.textContent = String(count);

  item.appendChild(nameSpan);
  item.appendChild(countSpan);

  return item;
}

/**
 * Update the category breakdown display
 * v1.6.4-v3 - Task 2: Expandable category breakdown
 * @private
 * @param {Object} categoryBreakdown - Object with category: count pairs
 */
function _updateCategoryBreakdown(categoryBreakdown) {
  if (!_metricsBreakdownEl) return;

  // Sort categories by count (descending) and filter out zeros
  const sortedCategories = Object.entries(categoryBreakdown || {})
    .filter(([_, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  // Clear existing content
  _metricsBreakdownEl.textContent = '';

  if (sortedCategories.length === 0) {
    const emptyMsg = document.createElement('span');
    emptyMsg.style.color = '#666';
    emptyMsg.textContent = 'No log actions yet';
    _metricsBreakdownEl.appendChild(emptyMsg);
    return;
  }

  // Create breakdown items using safe DOM manipulation
  sortedCategories.forEach(([category, count]) => {
    const displayName = CATEGORY_DISPLAY_NAMES[category] || category;
    const item = _createBreakdownItem(displayName, count);
    _metricsBreakdownEl.appendChild(item);
  });
}

/**
 * Update metrics DOM elements using cached references
 * v1.6.4-v3 - FEATURE: Extracted to reduce complexity
 * v1.6.4-v3 - Task 2: Also update category breakdown
 * @private
 * @param {Object} data - Metrics data
 */
function _updateMetricsDOM(data) {
  if (_metricQuickTabsEl) _metricQuickTabsEl.textContent = String(data.quickTabCount || 0);
  if (_metricLogsPerSecondEl) _metricLogsPerSecondEl.textContent = `${data.logsPerSecond || 0}/s`;
  if (_metricTotalLogsEl) _metricTotalLogsEl.textContent = String(data.totalLogs || 0);

  // v1.6.4-v3 - Task 2: Update category breakdown if provided
  if (data.categoryBreakdown) {
    _updateCategoryBreakdown(data.categoryBreakdown);
  }
}

/**
 * Handle metrics updates from the Quick Tabs Manager iframe
 * v1.6.4-v3 - FEATURE: Metrics footer visible on all tabs
 * @private
 * @param {MessageEvent} event - Message event from iframe
 */
function _handleMetricsMessage(event) {
  const { valid, data } = _validateMetricsMessage(event);
  if (!valid) return;

  // Initialize cache on first message
  _initMetricsElementCache();
  if (!_metricsFooterParent) return;

  _metricsFooterParent.style.display = data.enabled ? 'flex' : 'none';
  if (data.enabled) _updateMetricsDOM(data);
}

// Register message listener for iframe communication
window.addEventListener('message', _handleMetricsMessage);

// ==================== END METRICS FOOTER COMMUNICATION ====================

// Load settings on popup open
loadSettings();
