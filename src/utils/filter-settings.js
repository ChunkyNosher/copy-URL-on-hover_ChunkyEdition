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
 * v1.6.1 - Changed to all-enabled by default for better UX
 * Users can disable noisy categories after seeing them
 */
export function getDefaultLiveConsoleSettings() {
  return {
    'url-detection': true, // Enabled by default (was disabled)
    hover: true, // Enabled by default (was disabled)
    clipboard: true,
    keyboard: true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': true, // Enabled by default (was disabled)
    config: true,
    state: true, // Enabled by default (was disabled)
    storage: true,
    messaging: true, // Enabled by default (was disabled)
    webrequest: true,
    tabs: true,
    performance: true, // Enabled by default (was disabled)
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

// Initialize with safe defaults immediately (no race condition)
let liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
let exportLogSettingsCache = getDefaultExportSettings();
let settingsInitialized = false;

/**
 * Exported initialization promise - consumers can await if needed
 * v1.6.1 - Promise Export Pattern with IIFE for proper async control
 * Starts with safe defaults, updates from storage with timeout protection
 * Always resolves (never rejects) to ensure extension functions with defaults
 */
export const settingsReady = (async () => {
  if (settingsInitialized) {
    return { success: true, source: 'cached' };
  }

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Add 5-second timeout to prevent hanging on storage I/O
      const storagePromise = browser.storage.local.get([
        'liveConsoleCategoriesEnabled',
        'exportLogCategoriesEnabled'
      ]);
      
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Storage timeout after 5s')), 5000)
      );

      const result = await Promise.race([storagePromise, timeoutPromise]);

      // Atomic batch update to prevent partial reads
      const newLiveSettings = result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
      const newExportSettings = result.exportLogCategoriesEnabled || getDefaultExportSettings();
      
      liveConsoleSettingsCache = newLiveSettings;
      exportLogSettingsCache = newExportSettings;
      
      settingsInitialized = true;
      return { success: true, source: 'storage' };
    } else {
      // Browser storage API not available (non-browser context)
      liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
      exportLogSettingsCache = getDefaultExportSettings();
      settingsInitialized = true;
      return { success: true, source: 'defaults-no-api' };
    }
  } catch (error) {
    // On any error (timeout, storage unavailable, etc.), use safe defaults
    console.error('[FilterSettings] Initialization failed, using defaults:', error);
    liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
    exportLogSettingsCache = getDefaultExportSettings();
    settingsInitialized = true;
    return { success: false, source: 'defaults-error', error: error.message };
  }
})();

/**
 * Get live console filter settings (synchronous - uses cache with safe defaults)
 * v1.6.1 - Cache initialized with defaults at module load (never null)
 */
export function getLiveConsoleSettings() {
  return liveConsoleSettingsCache;
}

/**
 * Get export filter settings (synchronous - uses cache with safe defaults)
 * v1.6.1 - Cache initialized with defaults at module load (never null)
 */
export function getExportSettings() {
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
