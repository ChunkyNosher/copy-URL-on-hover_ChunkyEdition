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
 * Request logs from active content script
 * @returns {Promise<Array>} Array of log entries
 */
async function getContentScriptLogs() {
  try {
    // Get active tab
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      console.warn('[Popup] No active tab found');
      return [];
    }

    const activeTab = tabs[0];

    console.log(`[Popup] Requesting logs from tab ${activeTab.id}`);

    // Request logs from content script
    const response = await browserAPI.tabs.sendMessage(activeTab.id, {
      action: 'GET_CONTENT_LOGS'
    });

    if (response && response.logs) {
      console.log(`[Popup] Received ${response.logs.length} logs from content script`);

      // ✅ NEW: Log buffer stats for debugging
      if (response.stats) {
        console.log('[Popup] Content script buffer stats:', response.stats);
      }

      return response.logs;
    } else {
      console.warn('[Popup] Content script returned no logs');
      return [];
    }
  } catch (error) {
    console.warn('[Popup] Could not retrieve content script logs:', error);

    // ✅ IMPROVED: More specific error messages
    if (error.message && error.message.includes('Could not establish connection')) {
      console.error('[Popup] Content script not loaded in active tab');
    } else if (error.message && error.message.includes('No active tab')) {
      console.error('[Popup] No active tab found - try clicking on a webpage first');
    }

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

/**
 * Convert UTF-8 string to Base64 using modern TextEncoder API
 * Handles large strings by chunking to avoid stack overflow
 *
 * This replaces the deprecated btoa(unescape(encodeURIComponent())) pattern
 * which fails with Unicode characters and corrupts data URLs.
 *
 * @param {string} str - UTF-8 string to encode
 * @returns {string} Base64-encoded string
 * @throws {Error} If encoding fails
 */
function utf8ToBase64(str) {
  try {
    // Step 1: Encode string to UTF-8 bytes using TextEncoder
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(str);

    console.log(`[utf8ToBase64] Input string: ${str.length} characters`);
    console.log(`[utf8ToBase64] UTF-8 bytes: ${utf8Bytes.length} bytes`);

    // Step 2: Convert Uint8Array to binary string using chunking
    // This prevents "Maximum call stack size exceeded" error on large files
    const CHUNK_SIZE = 0x8000; // 32KB chunks (optimal for performance)
    let binaryString = '';

    for (let i = 0; i < utf8Bytes.length; i += CHUNK_SIZE) {
      const chunk = utf8Bytes.subarray(i, Math.min(i + CHUNK_SIZE, utf8Bytes.length));
      binaryString += String.fromCharCode.apply(null, chunk);
    }

    // Step 3: Encode to Base64
    const base64 = btoa(binaryString);

    console.log(`[utf8ToBase64] Base64 output: ${base64.length} characters`);
    console.log(
      `[utf8ToBase64] Encoding efficiency: ${((base64.length / str.length) * 100).toFixed(1)}%`
    );

    return base64;
  } catch (error) {
    console.error('[utf8ToBase64] Encoding failed:', error);
    throw new Error(`UTF-8 to Base64 encoding failed: ${error.message}`);
  }
}

/**
 * Export all logs as downloadable .txt file
 * @param {string} version - Extension version
 * @returns {Promise<void>}
 */
async function exportAllLogs(version) {
  try {
    console.log('[Popup] Starting log export...');

    // ✅ IMPROVED: Add debug info about active tab
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      console.log('[Popup] Active tab:', tabs[0].url);
      console.log('[Popup] Active tab ID:', tabs[0].id);
    }

    // Collect logs from all sources
    const backgroundLogs = await getBackgroundLogs();
    const contentLogs = await getContentScriptLogs();

    console.log(`[Popup] Collected ${backgroundLogs.length} background logs`);
    console.log(`[Popup] Collected ${contentLogs.length} content logs`);

    // ✅ IMPROVED: Show breakdown by log type
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

    // Merge all logs
    const allLogs = [...backgroundLogs, ...contentLogs];

    // Sort by timestamp
    allLogs.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Popup] Total logs to export: ${allLogs.length}`);

    // ✅ IMPROVED: Better error message with actionable advice
    if (allLogs.length === 0) {
      console.warn('[Popup] No logs to export');

      // Check if content script is loaded
      if (tabs.length > 0 && tabs[0].url.startsWith('about:')) {
        throw new Error(
          'Cannot capture logs from browser internal pages (about:*, about:debugging, etc.). Try navigating to a regular webpage first.'
        );
      } else if (tabs.length === 0) {
        throw new Error('No active tab found. Try clicking on a webpage tab first.');
      } else if (contentLogs.length === 0 && backgroundLogs.length === 0) {
        throw new Error(
          'No logs found. Make sure debug mode is enabled and try using the extension (hover over links, create Quick Tabs, etc.) before exporting logs.'
        );
      } else if (contentLogs.length === 0) {
        throw new Error(
          `Only found ${backgroundLogs.length} background logs. Content script may not be loaded. Try reloading the webpage.`
        );
      } else {
        throw new Error('No logs found. Try enabling debug mode and using the extension first.');
      }
    }

    // Format logs
    const logText = formatLogsAsText(allLogs, version);

    // Generate filename
    const filename = generateLogFilename(version);

    console.log(`[Popup] Exporting to: ${filename}`);
    console.log(`[Popup] Log text size: ${logText.length} characters`);

    // ✅ MODERN SOLUTION: Use TextEncoder for proper UTF-8 encoding
    // Replaces deprecated btoa(unescape(encodeURIComponent())) which corrupts Unicode
    const base64Data = utf8ToBase64(logText);

    // Create data URL with proper format
    const dataUrl = `data:text/plain;charset=utf-8;base64,${base64Data}`;

    console.log(`[Popup] Data URL format: ${dataUrl.substring(0, 50)}...`);
    console.log(`[Popup] Total data URL length: ${dataUrl.length} characters`);

    // Download
    await browserAPI.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });

    console.log('✓ [Popup] Export successful via data URL method');
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
  quickTabUpdateRate: 360, // Position updates per second (Hz) for dragging

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
  menuSize: 'medium'
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
function syncColorInputs(textInput, colorPicker) {
  if (!textInput || !colorPicker) return;

  const color = validateHexColor(textInput.value);
  textInput.value = color;
  colorPicker.value = color;
}

// Load settings
function loadSettings() {
  browserAPI.storage.local.get(DEFAULT_SETTINGS, function (items) {
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
    document.getElementById('quickTabUpdateRate').value = items.quickTabUpdateRate || 360;
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

// Save settings
document.getElementById('saveBtn').addEventListener('click', function () {
  const settings = {
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
    quickTabUpdateRate: safeParseInt(document.getElementById('quickTabUpdateRate').value, 360),

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

  browserAPI.storage.local.set(settings, function () {
    showStatus('✓ Settings saved! Reload tabs to apply changes.');
    applyTheme(settings.darkMode);
    applyMenuSize(settings.menuSize);
  });
});

// Reset to defaults
document.getElementById('resetBtn').addEventListener('click', function () {
  if (confirm('Reset all settings to defaults?')) {
    browserAPI.storage.local.set(DEFAULT_SETTINGS, function () {
      loadSettings();
      showStatus('✓ Settings reset to defaults!');
    });
  }
});

// Clear Quick Tab storage button
document.getElementById('clearStorageBtn').addEventListener('click', async function () {
  if (
    confirm(
      'This will clear Quick Tab positions and state. Your settings and keybinds will be preserved. Are you sure?'
    )
  ) {
    try {
      // Only clear Quick Tab state, preserve all settings
      await browserAPI.storage.sync.remove('quick_tabs_state_v2');

      // Clear session storage if available
      if (typeof browserAPI.storage.session !== 'undefined') {
        await browserAPI.storage.session.remove('quick_tabs_session');
      }

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

// Tab switching logic
document.addEventListener('DOMContentLoaded', function () {
  // Settings tab switching
  document.querySelectorAll('.tab-button').forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      document.querySelectorAll('.tab-button').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      // Add active class to clicked tab
      tab.classList.add('active');

      // Show corresponding content
      const tabName = tab.dataset.tab;
      const content = document.getElementById(tabName);
      if (content) {
        content.classList.add('active');
      }
    });
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
  });

  // ==================== EXPORT LOGS BUTTON ====================
  // Export logs button event listener
  const exportLogsBtn = document.getElementById('exportLogsBtn');
  if (exportLogsBtn) {
    exportLogsBtn.addEventListener('click', async () => {
      const originalText = exportLogsBtn.textContent;
      const originalBg = exportLogsBtn.style.backgroundColor;

      try {
        // Disable button during export
        exportLogsBtn.disabled = true;
        exportLogsBtn.textContent = '⏳ Exporting...';

        // Get version from manifest
        const manifest = browserAPI.runtime.getManifest();
        const version = manifest.version;

        // Export all logs
        await exportAllLogs(version);

        // Show success feedback
        exportLogsBtn.textContent = '✓ Logs Exported!';
        exportLogsBtn.classList.add('success');

        // Reset after 2 seconds
        setTimeout(() => {
          exportLogsBtn.textContent = originalText;
          exportLogsBtn.style.backgroundColor = originalBg;
          exportLogsBtn.classList.remove('success');
          exportLogsBtn.disabled = false;
        }, 2000);
      } catch (error) {
        // Show error feedback
        exportLogsBtn.textContent = '✗ Export Failed';
        exportLogsBtn.classList.add('error');

        // Show error message in status
        showStatus(`Export failed: ${error.message}`, false);

        // Reset after 3 seconds
        setTimeout(() => {
          exportLogsBtn.textContent = originalText;
          exportLogsBtn.style.backgroundColor = originalBg;
          exportLogsBtn.classList.remove('error');
          exportLogsBtn.disabled = false;
        }, 3000);
      }
    });
  }
  // ==================== END EXPORT LOGS BUTTON ====================
});

// Load settings on popup open
loadSettings();
