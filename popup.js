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

  // Check if content script is loaded
  if (activeTab && activeTab.url.startsWith('about:')) {
    throw new Error(
      'Cannot capture logs from browser internal pages (about:*, about:debugging, etc.). Try navigating to a regular webpage first.'
    );
  }

  if (!activeTab) {
    throw new Error('No active tab found. Try clicking on a webpage tab first.');
  }

  if (contentLogs.length === 0 && backgroundLogs.length === 0) {
    throw new Error(
      'No logs found. Make sure debug mode is enabled and try using the extension (hover over links, create Quick Tabs, etc.) before exporting logs.'
    );
  }

  if (contentLogs.length === 0) {
    throw new Error(
      `Only found ${backgroundLogs.length} background logs. Content script may not be loaded. Try reloading the webpage.`
    );
  }

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
 * Gather all settings from the form
 * @returns {Object} Settings object
 */
// eslint-disable-next-line complexity
function gatherSettingsFromForm() {
  return {
    copyUrlKey: document.getElementById('copyUrlKey').value || 'y',
    copyUrlCtrl: document.getElementById('copyUrlCtrl').checked,
    copyUrlAlt: document.getElementById('copyUrlAlt').checked,
    copyUrlShift: document.getElementById('copyUrlShift').checked,

    copyTextKey: document.getElementById('copyTextKey').value || 'x',
    copyTextCtrl: document.getElementById('copyTextCtrl').checked,
    copyTextAlt: document.getElementById('copyTextAlt').checked,
    copyTextShift: document.getElementById('copyTextShift').checked,

    // Open Link in New Tab settings
    openNewTabKey: document.getElementById('openNewTabKey').value || 'o',
    openNewTabCtrl: document.getElementById('openNewTabCtrl').checked,
    openNewTabAlt: document.getElementById('openNewTabAlt').checked,
    openNewTabShift: document.getElementById('openNewTabShift').checked,
    openNewTabSwitchFocus: document.getElementById('openNewTabSwitchFocus').checked,

    // Quick Tab settings
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

    showNotification: document.getElementById('showNotification').checked,
    notifDisplayMode: document.getElementById('notifDisplayMode').value || 'tooltip',

    // Tooltip settings
    tooltipColor: validateHexColor(
      document.getElementById('tooltipColor').value,
      DEFAULT_SETTINGS.tooltipColor
    ),
    tooltipDuration: safeParseInt(document.getElementById('tooltipDuration').value, 1500),
    tooltipAnimation: document.getElementById('tooltipAnimation').value || 'fade',

    // Notification settings
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
    notifAnimation: document.getElementById('notifAnimation').value || 'slide',

    debugMode: document.getElementById('debugMode').checked,
    darkMode: document.getElementById('darkMode').checked,
    menuSize: document.getElementById('menuSize').value || 'medium'
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

// Clear Quick Tab storage button
// v1.6.3 - FIX: Clear from storage.local (primary storage since v1.6.0.12)
// Also notify background to reset globalQuickTabState cache
document.getElementById('clearStorageBtn').addEventListener('click', async () => {
  if (
    confirm(
      'This will clear Quick Tab positions and state. Your settings and keybinds will be preserved. Are you sure?'
    )
  ) {
    try {
      // v1.6.3 - FIX: Clear from local storage (where Quick Tabs are actually stored since v1.6.0.12)
      await browserAPI.storage.local.remove('quick_tabs_state_v2');

      // v1.6.3 - Backward compatibility: also clear from sync storage (legacy location)
      await browserAPI.storage.sync.remove('quick_tabs_state_v2');

      // Clear session key from local storage as well
      // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
      await browserAPI.storage.local.remove('quick_tabs_session');

      // v1.6.3 - FIX: Notify background to reset globalQuickTabState cache
      await browserAPI.runtime.sendMessage({ action: 'RESET_GLOBAL_QUICK_TAB_STATE' });

      showStatus('✓ Quick Tab storage cleared! Settings preserved.');

      // Notify all tabs to close their Quick Tabs
      const tabs = await browserAPI.tabs.query({});
      tabs.forEach(tab => {
        browserAPI.tabs
          .sendMessage(tab.id, {
            action: 'CLEAR_ALL_QUICK_TABS'
          })
          .catch(() => {
            // Content script might not be loaded in this tab
          });
      });
    } catch (err) {
      showStatus('✗ Error clearing storage: ' + err.message);
      console.error('Error clearing Quick Tab storage:', err);
    }
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

/**
 * Handle tab button click to switch active tab
 * @param {Event} event - Click event
 */
function handleTabSwitch(event) {
  const tab = event.currentTarget;

  // Remove active class from all tabs and contents
  // eslint-disable-next-line max-nested-callbacks
  document.querySelectorAll('.tab-button').forEach(t => t.classList.remove('active'));
  // eslint-disable-next-line max-nested-callbacks
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  // Add active class to clicked tab
  tab.classList.add('active');

  // Show corresponding content
  const tabName = tab.dataset.tab;
  const content = document.getElementById(tabName);
  if (content) {
    content.classList.add('active');
  }
}

/**
 * Setup two-way sync between color text input and color picker
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
 */
async function handleExportAllLogs() {
  const manifest = browserAPI.runtime.getManifest();
  await exportAllLogs(manifest.version);
}

/**
 * Handle clear logs button click
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
 * Initialize UI components on DOMContentLoaded
 */
function initializePopupUI() {
  // Settings tab switching
  document.querySelectorAll('.tab-button').forEach(tab => {
    tab.addEventListener('click', handleTabSwitch);
  });

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

  // Export logs button event listener
  setupButtonHandler('exportLogsBtn', handleExportAllLogs, {
    loadingText: '⏳ Exporting...',
    successText: '✓ Logs Exported!',
    errorText: '✗ Export Failed'
  });

  // Clear logs button
  setupButtonHandler('clearLogsBtn', handleClearLogHistory, {
    loadingText: '⏳ Clearing...',
    successText: '✓ Logs Cleared',
    errorText: '✗ Clear Failed'
  });

  // Initialize collapsible filter groups
  initCollapsibleGroups();
  loadFilterSettings();
}

// Tab switching logic
document.addEventListener('DOMContentLoaded', initializePopupUI);

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

// Load settings on popup open
loadSettings();
