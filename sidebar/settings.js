// Browser API compatibility shim for Firefox/Chrome cross-compatibility
// Use global browser API if available (Firefox), otherwise fall back to chrome (Chrome)
/* eslint-disable-next-line no-undef */
const browserAPI =
  typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;

// Verify browser API is available
if (!browserAPI) {
  console.error('[Popup] Browser API not available. Extension may not work properly.');
}

// ==================== LOG EXPORT FUNCTIONS ====================

/**
 * Request logs from background script
 * @returns {Promise<Array>} Array of log entries
 */
async function getBackgroundLogs() {
  try {
    const response = await browserAPI.runtime.sendMessage({
      action: 'GET_BACKGROUND_LOGS'
    });
    return response && response.logs ? response.logs : [];
  } catch (error) {
    console.warn('[Popup] Could not retrieve background logs:', error);
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
    console.warn('[Popup] No active tab found');
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
    console.error('[Popup] Content script not loaded in active tab');
  } else if (error.message.includes('No active tab')) {
    console.error('[Popup] No active tab found - try clicking on a webpage first');
  }
}

/**
 * Request logs from active content script
 * @returns {Promise<Array>} Array of log entries
 */
async function getContentScriptLogs() {
  try {
    const activeTab = await _getActiveTab();
    if (!activeTab) return [];

    console.log(`[Popup] Requesting logs from tab ${activeTab.id}`);

    // Request logs from content script
    const response = await browserAPI.tabs.sendMessage(activeTab.id, {
      action: 'GET_CONTENT_LOGS'
    });

    if (!response || !response.logs) {
      console.warn('[Popup] Content script returned no logs');
      return [];
    }

    console.log(`[Popup] Received ${response.logs.length} logs from content script`);

    // Log buffer stats for debugging
    if (response.stats) {
      console.log('[Popup] Content script buffer stats:', response.stats);
    }

    return response.logs;
  } catch (error) {
    console.warn('[Popup] Could not retrieve content script logs:', error);
    _logContentScriptError(error);
    return [];
  }
}

/**
 * Format logs as plain text
 * @param {Array} logs - Array of log entries
 * @param {string} version - Extension version
 * @returns {string} Formatted log text
 */
function formatLogsAsText(logs, version) {
  const now = new Date();
  const header = [
    '='.repeat(80),
    'Copy URL on Hover - Extension Console Logs',
    '='.repeat(80),
    '',
    `Version: ${version}`,
    `Export Date: ${now.toISOString()}`,
    `Export Date (Local): ${now.toLocaleString()}`,
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
 * @param {Array} backgroundLogs - Background logs
 * @param {Array} contentLogs - Content script logs
 */
function _logCollectionDebugInfo(backgroundLogs, contentLogs) {
  console.log(`[Popup] Collected ${backgroundLogs.length} background logs`);
  console.log(`[Popup] Collected ${contentLogs.length} content logs`);

  // Show breakdown by log type
  const backgroundTypes = {};
  const contentTypes = {};

  backgroundLogs.forEach(log => {
    backgroundTypes[log.type] = (backgroundTypes[log.type] || 0) + 1;
  });

  contentLogs.forEach(log => {
    contentTypes[log.type] = (contentTypes[log.type] || 0) + 1;
  });

  console.log('[Popup] Background log types:', backgroundTypes);
  console.log('[Popup] Content log types:', contentTypes);
}

/**
 * Validation rules for collected logs
 * Each rule has a condition function and an error message
 * Rules are checked in order; first matching rule throws
 */
const LOG_VALIDATION_RULES = [
  {
    condition: (_, __, ___, activeTab) => activeTab && activeTab.url.startsWith('about:'),
    message:
      'Cannot capture logs from browser internal pages (about:*, about:debugging, etc.). Try navigating to a regular webpage first.'
  },
  {
    condition: (_, __, ___, activeTab) => !activeTab,
    message: 'No active tab found. Try clicking on a webpage tab first.'
  },
  {
    condition: (_, backgroundLogs, contentLogs) =>
      contentLogs.length === 0 && backgroundLogs.length === 0,
    message:
      'No logs found. Make sure debug mode is enabled and try using the extension (hover over links, create Quick Tabs, etc.) before exporting logs.'
  },
  {
    condition: (_, backgroundLogs, contentLogs) => contentLogs.length === 0,
    messageBuilder: (_, backgroundLogs) =>
      `Only found ${backgroundLogs.length} background logs. Content script may not be loaded. Try reloading the webpage.`
  }
];

/**
 * Validate that logs were collected and throw appropriate errors
 * @param {Array} allLogs - All collected logs
 * @param {Array} backgroundLogs - Background logs
 * @param {Array} contentLogs - Content logs
 * @param {Object|null} activeTab - Active tab or null
 * @throws {Error} If validation fails
 */
function _validateCollectedLogs(allLogs, backgroundLogs, contentLogs, activeTab) {
  if (allLogs.length > 0) return;

  console.warn('[Popup] No logs to export');

  // Find first matching validation rule and throw appropriate error
  for (const rule of LOG_VALIDATION_RULES) {
    if (rule.condition(allLogs, backgroundLogs, contentLogs, activeTab)) {
      const errorMessage = rule.messageBuilder
        ? rule.messageBuilder(allLogs, backgroundLogs, contentLogs, activeTab)
        : rule.message;
      throw new Error(errorMessage);
    }
  }

  // Default error if no specific rule matched
  throw new Error('No logs found. Try enabling debug mode and using the extension first.');
}

/**
 * Delegate log export to background script
 * @param {string} logText - Formatted log text
 * @param {string} filename - Export filename
 */
async function _delegateLogExport(logText, filename) {
  console.log('[Popup] Delegating export to background script (v1.5.9.7 fix)');

  const response = await browserAPI.runtime.sendMessage({
    action: 'EXPORT_LOGS',
    logText: logText,
    filename: filename
  });

  if (!response || !response.success) {
    const errorMessage = response?.error || 'Background script did not acknowledge export request';
    throw new Error(errorMessage);
  }

  console.log('✓ [Popup] Background script accepted log export request');
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
 */
async function getExportFilterSettings() {
  try {
    const result = await browserAPI.storage.local.get('exportLogCategoriesEnabled');
    if (result.exportLogCategoriesEnabled) {
      return result.exportLogCategoriesEnabled;
    }
  } catch (error) {
    console.error('[Popup] Failed to load export filter settings:', error);
  }

  // Default: all categories enabled
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
 *
 * @param {string} version - Extension version
 * @returns {Promise<void>}
 */
async function exportAllLogs(version) {
  try {
    console.log('[Popup] Starting log export...');

    // Get active tab for debugging
    const activeTab = await _getActiveTab();
    if (activeTab) {
      console.log('[Popup] Active tab:', activeTab.url);
      console.log('[Popup] Active tab ID:', activeTab.id);
    }

    // Collect logs from all sources
    const backgroundLogs = await getBackgroundLogs();
    const contentLogs = await getContentScriptLogs();

    // Log debug information
    _logCollectionDebugInfo(backgroundLogs, contentLogs);

    // Merge and sort logs
    const allLogs = [...backgroundLogs, ...contentLogs];
    allLogs.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Popup] Total logs captured: ${allLogs.length}`);

    // ==================== EXPORT FILTER (v1.6.0.9) ====================
    // Apply export filter settings
    const exportSettings = await getExportFilterSettings();
    console.log('[Popup] Export filter settings:', exportSettings);

    const filteredLogs = filterLogsByExportSettings(allLogs, exportSettings);
    console.log(`[Popup] Logs after export filter: ${filteredLogs.length}`);

    const percentage =
      allLogs.length > 0 ? ((filteredLogs.length / allLogs.length) * 100).toFixed(1) : '0.0';
    console.log(`[Popup] Export filter: ${percentage}% of logs included`);
    // ==================== END EXPORT FILTER ====================

    // Validate logs were collected
    _validateCollectedLogs(filteredLogs, backgroundLogs, contentLogs, activeTab);

    // Format logs as plain text (using filtered logs)
    const logText = formatLogsAsText(filteredLogs, version);

    // Generate filename with timestamp
    const filename = generateLogFilename(version);

    console.log(`[Popup] Exporting to: ${filename}`);
    console.log(
      `[Popup] Log text size: ${logText.length} characters (${(logText.length / 1024).toFixed(2)} KB)`
    );

    // ==================== BACKGROUND HANDOFF (v1.5.9.7) ====================
    // Firefox automatically closes the popup when the "Save As" dialog opens,
    // which destroys popup event listeners mid-download. Delegating the
    // downloads API work to the persistent background script ensures the
    // listener survives regardless of popup focus.
    //
    // References:
    // - Diagnostic report: docs/manual/1.5.9 docs/popup-close-background-v1597.md
    // - Stack Overflow 58412084: Save As dialog closes browserAction popup
    // - Firefox Bug 1658694: Popup closes when file picker opens

    await _delegateLogExport(logText, filename);

    // ==================== END BACKGROUND HANDOFF ====================
  } catch (error) {
    console.error('[Popup] Export failed:', error);
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
  const parsed = parseInt(value);
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
    toggleCustomPosition(items.quickTabPosition);

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
    quickTabShowDebugId: document.getElementById('quickTabShowDebugId').checked
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
 */
/**
 * v1.6.3.11 - FIX Issue #23: Notify background script of settings changes
 * Background uses stale settings until restart without this notification
 */
async function notifyBackgroundOfSettingsChange(settings) {
  try {
    await browserAPI.runtime.sendMessage({
      action: 'SETTINGS_CHANGED',
      settings: settings,
      timestamp: Date.now()
    });
    console.log('[Settings] Background script notified of settings change');
  } catch (error) {
    // Background might not be listening for this message - that's OK
    console.warn('[Settings] Could not notify background of settings change:', error.message);
  }
}

async function saveSettings() {
  try {
    const settings = gatherSettingsFromForm();
    const { liveSettings, exportSettings } = gatherFilterSettings();

    // Save main settings
    await browserAPI.storage.local.set(settings);

    // Save filter settings
    await browserAPI.storage.local.set({
      liveConsoleCategoriesEnabled: liveSettings,
      exportLogCategoriesEnabled: exportSettings
    });

    // Notify all tabs to refresh live console filter cache
    await refreshLiveConsoleFiltersInAllTabs();

    // v1.6.3.11 - FIX Issue #23: Notify background script of settings change
    await notifyBackgroundOfSettingsChange(settings);

    showStatus('✓ Settings saved! Reload tabs to apply changes.');
    applyTheme(settings.darkMode);
    applyMenuSize(settings.menuSize);
  } catch (error) {
    console.error('[Popup] Failed to save settings:', error);
    showStatus('✗ Failed to save settings', false);
  }
}

// Save settings
document.getElementById('saveBtn').addEventListener('click', saveSettings);

// Reset to defaults
// v1.6.0.11 - Now also resets filter settings
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (confirm('Reset all settings to defaults?')) {
    try {
      // Reset main settings
      await browserAPI.storage.local.set(DEFAULT_SETTINGS);

      // Reset filter settings
      await browserAPI.storage.local.set({
        liveConsoleCategoriesEnabled: getDefaultLiveConsoleSettings(),
        exportLogCategoriesEnabled: getDefaultExportSettings()
      });

      // Notify all tabs to refresh live console filter cache
      await refreshLiveConsoleFiltersInAllTabs();

      // Reload UI
      loadSettings();
      loadFilterSettings();
      showStatus('✓ Settings reset to defaults!');
    } catch (error) {
      console.error('[Popup] Failed to reset settings:', error);
      showStatus('✗ Failed to reset settings', false);
    }
  }
});

/**
 * v1.6.3.4 - FIX Bug #5: Helper to handle coordinated clear response
 * Extracted to reduce max-depth
 * @param {Object} response - Response from background script
 */
function _handleClearResponse(response) {
  if (response && response.success) {
    showStatus('✓ Quick Tab storage cleared! Settings preserved.');
  } else {
    showStatus('✗ Error clearing storage: ' + (response?.error || 'Unknown error'));
  }
}

// Clear Quick Tab storage button
// v1.6.3.4 - FIX Bug #5: Coordinate through background script to prevent storage write storm
document.getElementById('clearStorageBtn').addEventListener('click', async () => {
  const confirmed = confirm(
    'This will clear Quick Tab positions and state. Your settings and keybinds will be preserved. Are you sure?'
  );

  if (!confirmed) {
    return;
  }

  try {
    // v1.6.3.4 - FIX Bug #5: Send coordinated clear to background script
    // Background will: 1) Clear storage once 2) Broadcast QUICK_TABS_CLEARED to all tabs
    // This prevents N tabs from all trying to clear storage simultaneously
    const response = await browserAPI.runtime.sendMessage({
      action: 'COORDINATED_CLEAR_ALL_QUICK_TABS'
    });
    _handleClearResponse(response);
  } catch (err) {
    showStatus('✗ Error clearing storage: ' + err.message);
    console.error('Error clearing Quick Tab storage:', err);
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

  const lastSecondaryTab = getStoredSecondaryTab() || 'copy-url';
  showSecondaryTab(lastSecondaryTab);
}

/**
 * Handle switching to the Manager primary tab
 * Hides secondary tabs and shows manager content
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
 */
async function handleExportAllLogs() {
  const manifest = browserAPI.runtime.getManifest();
  await exportAllLogs(manifest.version);
}

/**
 * Handle clear logs button click
 * v1.6.1.4 - Extracted from DOMContentLoaded
 */
async function handleClearLogHistory() {
  const response = await browserAPI.runtime.sendMessage({
    action: 'CLEAR_CONSOLE_LOGS'
  });

  const clearedTabs = response?.clearedTabs || 0;
  const backgroundEntries = response?.clearedBackgroundEntries || 0;

  const tabSummary = clearedTabs ? ` (${clearedTabs} tab${clearedTabs === 1 ? '' : 's'})` : '';
  showStatus(
    `Cleared ${backgroundEntries} background log entries${tabSummary}. Next export will only include new activity.`,
    true
  );
}

/**
 * Setup button with async handler that shows loading/success/error states
 * v1.6.1.4 - Extracted from DOMContentLoaded
 * @param {string} buttonId - Button element ID
 * @param {Function} handler - Async handler function
 * @param {Object} options - Configuration options
 */
function setupButtonHandler(buttonId, handler, options = {}) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  const {
    loadingText = '⏳ Loading...',
    successText = '✓ Success!',
    errorText = '✗ Failed',
    successDuration = 2000,
    errorDuration = 3000
  } = options;

  button.addEventListener('click', async () => {
    const originalText = button.textContent;
    const originalBg = button.style.backgroundColor;

    try {
      // Show loading state
      button.disabled = true;
      button.textContent = loadingText;

      // Execute handler
      await handler();

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
}

/**
 * Initialize tab switching event handlers
 * v1.6.1.4 - Extracted to fix max-lines-per-function eslint warning
 * v1.6.3.4-v3 - FIX Bug #3: Check storage for requested tab on initialization
 */
function initializeTabSwitching() {
  // Primary tab switching
  document.querySelectorAll('.primary-tab-button').forEach(btn => {
    btn.addEventListener('click', event => {
      const primaryTab = event.currentTarget.dataset.primaryTab;
      handlePrimaryTabSwitch(primaryTab);
    });
  });

  // Secondary tab switching
  document.querySelectorAll('.secondary-tab-button').forEach(btn => {
    btn.addEventListener('click', event => {
      const secondaryTab = event.currentTarget.dataset.tab;
      showSecondaryTab(secondaryTab);
    });
  });

  // v1.6.3.4-v3 - FIX Bug #3: Check for requested tab from keyboard shortcut
  // Background script sets _requestedPrimaryTab before opening sidebar
  _checkAndApplyRequestedTab();

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

  console.debug('[Settings] Tab switching initialized, message listener registered');
}

// Tab switching logic
document.addEventListener('DOMContentLoaded', () => {
  // Initialize two-layer tab system
  initializeTabSwitching();

  // Set footer version dynamically
  const manifest = browserAPI.runtime.getManifest();
  const footerElement = document.getElementById('footerVersion');
  if (footerElement) {
    footerElement.textContent = `${manifest.name} v${manifest.version}`;
  }

  // Add color input event listeners to sync text and picker inputs
  COLOR_INPUTS.forEach(({ textId, pickerId }) => {
    const textInput = document.getElementById(textId);
    const pickerInput = document.getElementById(pickerId);

    if (textInput && pickerInput) {
      setupColorInputSync(textInput, pickerInput);
    }
  });

  // ==================== EXPORT LOGS BUTTON ====================
  // Export logs button event listener
  setupButtonHandler('exportLogsBtn', handleExportAllLogs, {
    loadingText: '⏳ Exporting...',
    successText: '✓ Logs Exported!',
    errorText: '✗ Export Failed'
  });
  // ==================== END EXPORT LOGS BUTTON ====================

  // ==================== CLEAR LOGS BUTTON ====================
  setupButtonHandler('clearLogsBtn', handleClearLogHistory, {
    loadingText: '⏳ Clearing...',
    successText: '✓ Logs Cleared',
    errorText: '✗ Clear Failed'
  });
  // ==================== END CLEAR LOGS BUTTON ====================

  // ==================== COLLAPSIBLE FILTER GROUPS ====================
  // v1.6.0.11 - Removed separate save/reset buttons; filters now save with main "Save Settings"
  initCollapsibleGroups();
  loadFilterSettings();
  // ==================== END COLLAPSIBLE FILTER GROUPS ====================

  // ==================== KEYBOARD SHORTCUTS (v1.6.3.11-v3) ====================
  // FIX Issue #5: Setup keyboard shortcut update handlers

  // Update Manager shortcut button
  const updateManagerBtn = document.getElementById('update-shortcut-manager');
  const managerInput = document.getElementById('shortcut-toggle-manager');
  if (updateManagerBtn && managerInput) {
    updateManagerBtn.addEventListener('click', async () => {
      await updateKeyboardShortcut(
        'toggle-quick-tabs-manager',
        managerInput.value.trim(),
        managerInput
      );
    });
  }

  // Update Sidebar shortcut button
  const updateSidebarBtn = document.getElementById('update-shortcut-sidebar');
  const sidebarInput = document.getElementById('shortcut-toggle-sidebar');
  if (updateSidebarBtn && sidebarInput) {
    updateSidebarBtn.addEventListener('click', async () => {
      await updateKeyboardShortcut(
        '_execute_sidebar_action',
        sidebarInput.value.trim(),
        sidebarInput
      );
    });
  }

  // Load current shortcuts button
  const loadShortcutsBtn = document.getElementById('loadShortcutsBtn');
  if (loadShortcutsBtn) {
    loadShortcutsBtn.addEventListener('click', async () => {
      loadShortcutsBtn.disabled = true;
      loadShortcutsBtn.textContent = '⏳ Loading...';
      try {
        await loadKeyboardShortcuts();
        loadShortcutsBtn.textContent = '✓ Shortcuts Loaded';
        setTimeout(() => {
          loadShortcutsBtn.textContent = '🔄 Refresh Current Shortcuts';
          loadShortcutsBtn.disabled = false;
        }, 2000);
      } catch (err) {
        loadShortcutsBtn.textContent = '✗ Failed to Load';
        setTimeout(() => {
          loadShortcutsBtn.textContent = '🔄 Refresh Current Shortcuts';
          loadShortcutsBtn.disabled = false;
        }, 3000);
      }
    });
  }

  // Load keyboard shortcuts on page load
  loadKeyboardShortcuts();
  // ==================== END KEYBOARD SHORTCUTS ====================
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
 */
async function loadFilterSettings() {
  try {
    const result = await browserAPI.storage.local.get([
      'liveConsoleCategoriesEnabled',
      'exportLogCategoriesEnabled'
    ]);

    const liveSettings = result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
    const exportSettings = result.exportLogCategoriesEnabled || getDefaultExportSettings();

    // Apply to live filter checkboxes
    document.querySelectorAll('.category-checkbox[data-filter="live"]').forEach(cb => {
      const category = cb.dataset.category;
      cb.checked = liveSettings[category] === true;
    });

    // Apply to export filter checkboxes
    document.querySelectorAll('.category-checkbox[data-filter="export"]').forEach(cb => {
      const category = cb.dataset.category;
      cb.checked = exportSettings[category] === true;
    });

    // v1.6.0.12 - Update all counters and button colors after loading
    updateAllGroupStates();
  } catch (error) {
    console.error('[Popup] Failed to load filter settings:', error);
  }
}

// v1.6.0.11 - Removed saveFilterSettings() and resetFilterSettings()
// Filter settings now save with main "Save Settings" button via gatherFilterSettings()
// Reset functionality handled by main "Reset to Defaults" button

/**
 * Notify all tabs to refresh live console filter cache
 */
async function refreshLiveConsoleFiltersInAllTabs() {
  try {
    const tabs = await browserAPI.tabs.query({});
    const messagePromises = tabs.map(tab =>
      browserAPI.tabs
        .sendMessage(tab.id, {
          action: 'REFRESH_LIVE_CONSOLE_FILTERS'
        })
        .catch(() => {
          // Tab might not have content script loaded - silently ignore
        })
    );
    await Promise.all(messagePromises);
  } catch (error) {
    console.error('[Popup] Failed to refresh live console filters:', error);
  }
}

// ==================== END FILTER SETTINGS FUNCTIONS ====================

// ==================== KEYBOARD SHORTCUT FUNCTIONS (v1.6.3.11-v3) ====================
// FIX Issues #4 & #5: Keyboard shortcut validation and browser.commands integration

/**
 * Firefox keyboard shortcut format validation
 * v1.6.3.11-v3 - FIX Issue #4: Validate shortcut syntax
 *
 * Valid formats:
 * - "Ctrl+Alt+Z", "Alt+Shift+S", "Ctrl+Shift+O"
 * - "MacCtrl+Alt+U" (Mac-specific)
 * - "Alt+Comma", "Ctrl+Period"
 * - Function keys: "F1", "F12", "Ctrl+F5"
 * - Media keys: "MediaPlayPause", "MediaNextTrack"
 *
 * @param {string} shortcut - Shortcut string to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateKeyboardShortcut(shortcut) {
  // Empty shortcut is valid (clears the shortcut)
  if (!shortcut || shortcut.trim() === '') {
    return { valid: true };
  }

  const trimmed = shortcut.trim();

  // Check for basic format (modifier+key or just function/media key)
  const modifierPattern = /^(Ctrl|Alt|Shift|MacCtrl|Command)(\+(Ctrl|Alt|Shift|MacCtrl|Command))*\+(.+)$/i;
  const functionKeyPattern = /^F([1-9]|1[0-2])$/i;
  const mediaKeyPattern = /^Media(PlayPause|NextTrack|PrevTrack|Stop)$/i;

  // Check if it's a function key alone
  if (functionKeyPattern.test(trimmed)) {
    return { valid: true };
  }

  // Check if it's a media key alone
  if (mediaKeyPattern.test(trimmed)) {
    return { valid: true };
  }

  // Check modifier+key format
  const match = trimmed.match(modifierPattern);
  if (!match) {
    return {
      valid: false,
      error: `Invalid shortcut format: "${trimmed}". Use format like "Ctrl+Alt+Z" or "Alt+Shift+S".`
    };
  }

  // Extract the final key
  const finalKey = match[4];

  // Validate the final key
  const validSingleKeys = /^([A-Z]|[0-9]|F[1-9]|F1[0-2]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/i;
  if (!validSingleKeys.test(finalKey)) {
    return {
      valid: false,
      error: `Invalid key: "${finalKey}". Use A-Z, 0-9, F1-F12, or special keys like Comma, Period, Space.`
    };
  }

  // Check that at least one modifier is present (required by Firefox)
  const parts = trimmed.split('+');
  const modifiers = parts.slice(0, -1);
  if (modifiers.length === 0) {
    return {
      valid: false,
      error: 'At least one modifier (Ctrl, Alt, Shift) is required.'
    };
  }

  return { valid: true };
}

/**
 * Show keyboard shortcut validation error
 * v1.6.3.11-v3 - FIX Issue #4: User feedback for invalid shortcuts
 * @param {HTMLElement} inputElement - Input element to mark as invalid
 * @param {string} errorMessage - Error message to display
 */
function showShortcutError(inputElement, errorMessage) {
  inputElement.classList.add('shortcut-error');
  inputElement.title = errorMessage;

  // Show error in status area
  showStatus(`⚠️ ${errorMessage}`, false);

  // Clear error styling after 5 seconds
  setTimeout(() => {
    inputElement.classList.remove('shortcut-error');
    inputElement.title = '';
  }, 5000);
}

/**
 * Show keyboard shortcut update success
 * v1.6.3.11-v3 - FIX Issue #5: Visual feedback for successful updates
 * @param {HTMLElement} inputElement - Input element to mark as valid
 * @param {string} message - Success message to display
 */
function showShortcutSuccess(inputElement, message) {
  inputElement.classList.add('shortcut-success');

  // Show success in status area
  showStatus(`✓ ${message}`, true);

  // Clear success styling after 3 seconds
  setTimeout(() => {
    inputElement.classList.remove('shortcut-success');
  }, 3000);
}

/**
 * Update a keyboard shortcut via background script
 * v1.6.3.11-v3 - FIX Issue #5: Connect sidebar UI to browser.commands API
 * @param {string} commandName - Command name from manifest.json
 * @param {string} shortcut - New shortcut value
 * @param {HTMLElement} inputElement - Input element for visual feedback
 */
async function updateKeyboardShortcut(commandName, shortcut, inputElement) {
  console.log('[Settings] Updating keyboard shortcut:', { commandName, shortcut });

  // Validate shortcut format first
  const validation = validateKeyboardShortcut(shortcut);
  if (!validation.valid) {
    showShortcutError(inputElement, validation.error);
    return false;
  }

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: 'UPDATE_KEYBOARD_SHORTCUT',
      commandName,
      shortcut
    });

    if (response && response.success) {
      showShortcutSuccess(inputElement, response.message || 'Shortcut updated');
      return true;
    } else {
      showShortcutError(inputElement, response?.error || 'Failed to update shortcut');
      return false;
    }
  } catch (error) {
    console.error('[Settings] Failed to update keyboard shortcut:', error);
    showShortcutError(inputElement, error.message);
    return false;
  }
}

/**
 * Update UI elements with loaded keyboard shortcuts
 * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce nesting depth
 * @param {Array} commands - Array of command objects
 */
function _updateShortcutInputs(commands) {
  for (const cmd of commands) {
    const inputId = getShortcutInputId(cmd.name);
    const inputElement = document.getElementById(inputId);
    if (!inputElement) continue;

    inputElement.value = cmd.shortcut || '';
    inputElement.dataset.currentShortcut = cmd.shortcut || '';
  }
}

/**
 * Load current keyboard shortcuts from browser
 * v1.6.3.11-v3 - FIX Issue #5: Reflect browser's actual shortcuts in UI
 */
async function loadKeyboardShortcuts() {
  console.log('[Settings] Loading keyboard shortcuts...');

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: 'GET_KEYBOARD_SHORTCUTS'
    });

    if (!response || !response.success) {
      console.warn('[Settings] Failed to load shortcuts:', response?.error);
      return [];
    }

    console.log('[Settings] Keyboard shortcuts loaded:', response.commands);
    _updateShortcutInputs(response.commands);
    return response.commands;
  } catch (error) {
    console.error('[Settings] Error loading keyboard shortcuts:', error);
    return [];
  }
}

/**
 * Get input element ID for a command name
 * v1.6.3.11-v3 - FIX Issue #5: Map command names to UI element IDs
 * @param {string} commandName - Command name from manifest
 * @returns {string} Input element ID
 */
function getShortcutInputId(commandName) {
  const mapping = {
    'toggle-quick-tabs-manager': 'shortcut-toggle-manager',
    _execute_sidebar_action: 'shortcut-toggle-sidebar'
  };
  return mapping[commandName] || `shortcut-${commandName}`;
}

/**
 * Listen for external shortcut changes from Firefox settings
 * v1.6.3.11-v3 - FIX Issue #2: Sync external changes to UI
 */
function listenForShortcutChanges() {
  browserAPI.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === 'KEYBOARD_SHORTCUT_CHANGED') {
      console.log('[Settings] External shortcut change detected:', message.changeInfo);
      // Reload shortcuts to update UI
      loadKeyboardShortcuts();
    }
  });
}

// ==================== END KEYBOARD SHORTCUT FUNCTIONS ====================

// Load settings on popup open
loadSettings();

// v1.6.3.11-v3 - FIX Issue #5: Initialize keyboard shortcut listeners
listenForShortcutChanges();
