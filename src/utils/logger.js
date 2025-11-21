/**
 * Category-based Logging System with Live Console & Export Filtering
 * Provides granular control over which log categories appear in console and exports
 */

// ==================== LOG CATEGORIES ====================

/**
 * Log category definitions with display names and emojis
 */
export const LOG_CATEGORIES = {
  // User Actions (6 categories)
  'url-detection': { displayName: 'URL Detection', emoji: '🔍', group: 'user-actions' },
  hover: { displayName: 'Hover Events', emoji: '👆', group: 'user-actions' },
  clipboard: { displayName: 'Clipboard Operations', emoji: '📋', group: 'user-actions' },
  keyboard: { displayName: 'Keyboard Shortcuts', emoji: '⌨️', group: 'user-actions' },
  'quick-tabs': { displayName: 'Quick Tab Actions', emoji: '🪟', group: 'user-actions' },
  'quick-tab-manager': { displayName: 'Quick Tab Manager', emoji: '📊', group: 'user-actions' },

  // System Operations (7 categories)
  'event-bus': { displayName: 'Event Bus', emoji: '📡', group: 'system-operations' },
  config: { displayName: 'Configuration', emoji: '⚙️', group: 'system-operations' },
  state: { displayName: 'State Management', emoji: '💾', group: 'system-operations' },
  storage: { displayName: 'Browser Storage', emoji: '💿', group: 'system-operations' },
  messaging: { displayName: 'Message Passing', emoji: '💬', group: 'system-operations' },
  webrequest: { displayName: 'Web Requests', emoji: '🌐', group: 'system-operations' },
  tabs: { displayName: 'Tab Management', emoji: '📑', group: 'system-operations' },

  // Diagnostics (3 categories)
  performance: { displayName: 'Performance', emoji: '⏱️', group: 'diagnostics' },
  errors: { displayName: 'Errors', emoji: '❌', group: 'diagnostics' },
  initialization: { displayName: 'Initialization', emoji: '🚀', group: 'diagnostics' }
};

/**
 * Category groups for UI organization
 */
export const CATEGORY_GROUPS = {
  'user-actions': {
    title: 'User Actions',
    description: 'User-triggered events and interactions',
    categories: [
      'url-detection',
      'hover',
      'clipboard',
      'keyboard',
      'quick-tabs',
      'quick-tab-manager'
    ]
  },
  'system-operations': {
    title: 'System Operations',
    description: 'Internal system operations',
    categories: ['event-bus', 'config', 'state', 'storage', 'messaging', 'webrequest', 'tabs']
  },
  diagnostics: {
    title: 'Diagnostics',
    description: 'Performance metrics and errors',
    categories: ['performance', 'errors', 'initialization']
  }
};

// ==================== FILTER SETTINGS CACHE ====================

// Settings cache - preloaded synchronously at module init
let liveConsoleSettingsCache = null;
let exportLogSettingsCache = null;
let settingsInitialized = false;

/**
 * Get default live console filter settings
 * Noisy categories (hover, url-detection) disabled by default
 */
export function getDefaultLiveConsoleSettings() {
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
 * All categories enabled by default for comprehensive debugging
 */
export function getDefaultExportSettings() {
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
 * Initialize filter settings - called once at module load
 * ARCHITECTURAL FIX: Preload settings synchronously to avoid async issues in logging functions
 */
async function initializeFilterSettings() {
  if (settingsInitialized) {
    return;
  }

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      const result = await browser.storage.local.get([
        'liveConsoleCategoriesEnabled',
        'exportLogCategoriesEnabled'
      ]);

      liveConsoleSettingsCache =
        result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
      exportLogSettingsCache = result.exportLogCategoriesEnabled || getDefaultExportSettings();

      console.log('[Copy-URL-on-Hover] Live console filters initialized:', {
        enabled: Object.entries(liveConsoleSettingsCache)
          .filter(([_, enabled]) => enabled)
          .map(([cat]) => cat),
        disabled: Object.entries(liveConsoleSettingsCache)
          .filter(([_, enabled]) => !enabled)
          .map(([cat]) => cat)
      });
    } else {
      liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
      exportLogSettingsCache = getDefaultExportSettings();
      console.log('[Logger] Browser API not available - using default settings');
    }

    settingsInitialized = true;
  } catch (error) {
    console.error('[Logger] Failed to initialize filter settings:', error);
    liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
    exportLogSettingsCache = getDefaultExportSettings();
    settingsInitialized = true;
  }
}

// Initialize settings immediately when module loads
initializeFilterSettings();

/**
 * Get live console filter settings (synchronous - uses preloaded cache)
 */
function getLiveConsoleSettings() {
  // Fail-safe: if not initialized yet, use defaults
  if (!settingsInitialized || liveConsoleSettingsCache === null) {
    return getDefaultLiveConsoleSettings();
  }
  return liveConsoleSettingsCache;
}

/**
 * Get export filter settings (synchronous - uses preloaded cache)
 */
export function getExportSettings() {
  // Fail-safe: if not initialized yet, use defaults
  if (!settingsInitialized || exportLogSettingsCache === null) {
    return getDefaultExportSettings();
  }
  return exportLogSettingsCache;
}

/**
 * Refresh live console settings from storage
 * Call this after settings change in popup
 */
export async function refreshLiveConsoleSettings() {
  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      const result = await browser.storage.local.get('liveConsoleCategoriesEnabled');
      liveConsoleSettingsCache =
        result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
      console.log('[Copy-URL-on-Hover] Live console filters refreshed:', {
        enabled: Object.entries(liveConsoleSettingsCache)
          .filter(([_, enabled]) => enabled)
          .map(([cat]) => cat),
        disabled: Object.entries(liveConsoleSettingsCache)
          .filter(([_, enabled]) => !enabled)
          .map(([cat]) => cat)
      });
    }
  } catch (error) {
    console.error('[Logger] Failed to refresh live console settings:', error);
  }
}

/**
 * Refresh export settings from storage
 */
export async function refreshExportSettings() {
  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      const result = await browser.storage.local.get('exportLogCategoriesEnabled');
      exportLogSettingsCache = result.exportLogCategoriesEnabled || getDefaultExportSettings();
      console.log('[Logger] Export filter cache refreshed');
    }
  } catch (error) {
    console.error('[Logger] Failed to refresh export settings:', error);
  }
}

/**
 * Check if category is enabled for live console output
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
function isCategoryEnabledForLiveConsole(category) {
  const settings = getLiveConsoleSettings();

  // Default to true if category not in settings (fail-safe)
  if (!(category in settings)) {
    return true;
  }

  return settings[category] === true;
}

// ==================== LOGGING FUNCTIONS ====================

/**
 * Get category display name
 */
export function getCategoryDisplayName(category) {
  const categoryInfo = LOG_CATEGORIES[category];
  if (!categoryInfo) {
    return category;
  }
  return `${categoryInfo.emoji} ${categoryInfo.displayName}`;
}

/**
 * Get category ID from display name (for export filtering)
 */
export function getCategoryIdFromDisplayName(displayName) {
  const normalized = displayName.trim().toLowerCase();

  // Remove emoji and extra spaces
  const cleanName = normalized.replace(/[^\w\s-]/g, '').trim();

  // Direct mappings
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
    // Legacy mappings
    debug: 'quick-tabs',
    quicktabsmanager: 'quick-tab-manager',
    createhandler: 'quick-tabs',
    quicktabwindow: 'quick-tabs',
    broadcastmanager: 'quick-tabs',
    notificationmanager: 'clipboard',
    tooltip: 'clipboard'
  };

  return mapping[cleanName] || 'uncategorized';
}

/**
 * Format log message with category prefix
 */
function formatLogMessage(category, action, message) {
  const categoryName = getCategoryDisplayName(category);
  return `[${categoryName}] [${action}] ${message}`;
}

/**
 * Log with category filter - Normal level
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function logNormal(category, action, message, context = {}) {
  // Check live console filter (synchronous)
  if (!isCategoryEnabledForLiveConsole(category)) {
    return; // Silent - don't log to console
  }

  const formattedMessage = formatLogMessage(category, action, message);
  console.log(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

/**
 * Log with category filter - Error level
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function logError(category, action, message, context = {}) {
  // Check live console filter (synchronous)
  if (!isCategoryEnabledForLiveConsole(category)) {
    return; // Silent - don't log to console
  }

  const formattedMessage = formatLogMessage(category, action, message);
  console.error(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

/**
 * Log with category filter - Warning level
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function logWarn(category, action, message, context = {}) {
  // Check live console filter (synchronous)
  if (!isCategoryEnabledForLiveConsole(category)) {
    return; // Silent - don't log to console
  }

  const formattedMessage = formatLogMessage(category, action, message);
  console.warn(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

/**
 * Log with category filter - Info level
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function logInfo(category, action, message, context = {}) {
  // Check live console filter (synchronous)
  if (!isCategoryEnabledForLiveConsole(category)) {
    return; // Silent - don't log to console
  }

  const formattedMessage = formatLogMessage(category, action, message);
  console.info(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

/**
 * Log performance metric
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function logPerformance(category, action, message, context = {}) {
  // Check live console filter (synchronous)
  if (!isCategoryEnabledForLiveConsole(category)) {
    return; // Silent - don't log to console
  }

  const formattedMessage = formatLogMessage(category, action, message);
  console.log(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

// ==================== EXPORT FILTERING ====================

/**
 * Extract category from log entry message
 */
export function extractCategoryFromLog(logEntry) {
  const message = logEntry.message || '';

  // Match pattern: [Category Display Name] [Action] Message
  const match = message.match(/^\[([^\]]+)\]/);

  if (!match) {
    return 'uncategorized';
  }

  const displayName = match[1];
  return getCategoryIdFromDisplayName(displayName);
}

/**
 * Filter logs by export category settings
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function filterLogsByExportCategories(allLogs) {
  const enabledCategories = getExportSettings();

  return allLogs.filter(logEntry => {
    const category = extractCategoryFromLog(logEntry);

    // Always include uncategorized logs (fail-safe)
    if (category === 'uncategorized') {
      return true;
    }

    // Check if category is enabled for export
    return enabledCategories[category] === true;
  });
}

/**
 * Generate export metadata showing filter state
 * ARCHITECTURAL FIX: Now synchronous using preloaded settings
 */
export function generateExportMetadata(totalLogs, filteredLogs) {
  const liveSettings = getLiveConsoleSettings();
  const exportSettings = getExportSettings();

  const liveFilters = Object.entries(liveSettings)
    .map(([cat, enabled]) => {
      const info = LOG_CATEGORIES[cat];
      const symbol = enabled ? '✓' : '✗';
      const status = enabled ? 'enabled in console' : 'disabled in console';
      return `${symbol} ${info?.displayName || cat} (${status})`;
    })
    .join('\n');

  const exportFilters = Object.entries(exportSettings)
    .map(([cat, enabled]) => {
      const info = LOG_CATEGORIES[cat];
      const symbol = enabled ? '✓' : '✗';
      const status = enabled ? 'included' : 'excluded from export';
      return `${symbol} ${info?.displayName || cat} (${status})`;
    })
    .join('\n');

  const percentage = totalLogs > 0 ? ((filteredLogs / totalLogs) * 100).toFixed(1) : '0.0';

  return `
LIVE CONSOLE FILTERS (what was logged):
${liveFilters}

EXPORT FILTERS (applied to this file):
${exportFilters}

NOTE: Export filter can only work with logs that were captured.
If a category was disabled in Live Console Filters, those logs
don't exist to export. To capture all logs, enable all categories
in Live Console Filters before reproducing the issue.

Total logs captured: ${totalLogs}
Logs in export: ${filteredLogs} (${percentage}%)
`;
}
