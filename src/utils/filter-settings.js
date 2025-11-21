/**
 * Filter Settings Module
 * Shared by both console-interceptor.js and logger.js
 * Avoids circular dependency by extracting filter logic into separate module
 *
 * v1.6.0.13 - Created to fix live console filter bug
 */

// ==================== DEFAULT SETTINGS ====================

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

// ==================== SETTINGS CACHE ====================

let liveConsoleSettingsCache = null;
let exportLogSettingsCache = null;
let settingsInitialized = false;

/**
 * Initialize filter settings - called once at module load
 * Preload settings synchronously to avoid async issues in logging functions
 */
export async function initializeFilterSettings() {
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
    } else {
      liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
      exportLogSettingsCache = getDefaultExportSettings();
    }

    settingsInitialized = true;
  } catch (error) {
    console.error('[FilterSettings] Initialization failed:', error);
    liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
    exportLogSettingsCache = getDefaultExportSettings();
    settingsInitialized = true;
  }
}

/**
 * Get live console filter settings (synchronous - uses preloaded cache)
 */
export function getLiveConsoleSettings() {
  if (!settingsInitialized || liveConsoleSettingsCache === null) {
    return getDefaultLiveConsoleSettings();
  }
  return liveConsoleSettingsCache;
}

/**
 * Get export filter settings (synchronous - uses preloaded cache)
 */
export function getExportSettings() {
  if (!settingsInitialized || exportLogSettingsCache === null) {
    return getDefaultExportSettings();
  }
  return exportLogSettingsCache;
}

/**
 * Check if category is enabled for live console output
 * v1.6.0.13 - Critical categories always enabled
 */
export function isCategoryEnabledForLiveConsole(category) {
  const settings = getLiveConsoleSettings();

  // CRITICAL CATEGORIES ALWAYS ENABLED (errors, initialization)
  const criticalCategories = ['errors', 'initialization'];
  if (criticalCategories.includes(category)) {
    return true;
  }

  // Default to true if category not in settings (fail-safe)
  if (!(category in settings)) {
    return true;
  }

  return settings[category] === true;
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
      console.log('[FilterSettings] Live console filters refreshed:', {
        enabled: Object.entries(liveConsoleSettingsCache)
          .filter(([_, enabled]) => enabled)
          .map(([cat]) => cat),
        disabled: Object.entries(liveConsoleSettingsCache)
          .filter(([_, enabled]) => !enabled)
          .map(([cat]) => cat)
      });
    }
  } catch (error) {
    console.error('[FilterSettings] Refresh failed:', error);
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
      console.log('[FilterSettings] Export filter cache refreshed');
    }
  } catch (error) {
    console.error('[FilterSettings] Refresh failed:', error);
  }
}

/**
 * Get category ID from display name
 * Used to map log message prefixes to category IDs
 */
export function getCategoryIdFromDisplayName(displayName) {
  const normalized = displayName.trim().toLowerCase().replace(/[^\w\s-]/g, '').trim();

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
    // Component name mappings for background logs
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

// Initialize settings immediately when module loads
initializeFilterSettings();
