/**
 * Configuration Manager
 * Handles extension configuration and constants
 */

export const DEFAULT_CONFIG = {
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

  // Quick Tab on Hover settings
  quickTabKey: 'q',
  quickTabCtrl: false,
  quickTabAlt: false,
  quickTabShift: false,
  quickTabCloseKey: 'Escape',
  quickTabMaxWindows: 3,
  quickTabDefaultWidth: 800,
  quickTabDefaultHeight: 600,
  quickTabPosition: 'follow-cursor',
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
  menuSize: 'medium'
};

export const CONSTANTS = {
  GOOGLE_FAVICON_URL: 'https://www.google.com/s2/favicons?domain=',
  TOOLTIP_OFFSET_X: 10,
  TOOLTIP_OFFSET_Y: 10,
  TOOLTIP_DURATION_MS: 1500,
  TOOLTIP_FADE_OUT_MS: 200,
  QUICK_TAB_BASE_Z_INDEX: 1000000,
  // v1.6.2.x - Default container for Firefox container isolation
  DEFAULT_CONTAINER: 'firefox-default',
  // v1.6.3 - Maximum retry attempts for generating unique Quick Tab IDs
  MAX_ID_GENERATION_RETRIES: 10,
  // v1.6.3.2 - Storage key for Quick Tab settings (sync storage)
  QUICK_TAB_SETTINGS_KEY: 'quick_tab_settings'
};

export class ConfigManager {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.listeners = [];
  }

  /**
   * Load configuration from browser storage
   */
  async load() {
    console.log('[ConfigManager] Starting configuration load...');
    try {
      // Verify browser.storage is available
      if (!browser || !browser.storage || !browser.storage.local) {
        console.error('[ConfigManager] browser.storage.local is not available!');
        console.warn('[ConfigManager] Using DEFAULT_CONFIG as fallback');
        this.config = { ...DEFAULT_CONFIG };
        return this.config;
      }

      console.log('[ConfigManager] Calling browser.storage.local.get...');
      // Load all settings from storage (popup.js saves them as individual keys)
      const result = await browser.storage.local.get(DEFAULT_CONFIG);

      console.log('[ConfigManager] Storage get completed, processing result...');
      if (!result || typeof result !== 'object') {
        console.warn('[ConfigManager] Invalid storage result, using DEFAULT_CONFIG');
        this.config = { ...DEFAULT_CONFIG };
        return this.config;
      }

      // Merge with defaults (user settings override defaults)
      this.config = { ...DEFAULT_CONFIG, ...result };

      console.log('[ConfigManager] Configuration loaded successfully');
      console.log('[ConfigManager] Config summary:', {
        debugMode: this.config.debugMode,
        totalKeys: Object.keys(this.config).length
      });
    } catch (err) {
      console.error('[ConfigManager] Exception during load:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      });
      console.warn('[ConfigManager] Falling back to DEFAULT_CONFIG due to exception');
      this.config = { ...DEFAULT_CONFIG };
    }

    return this.config;
  }

  /**
   * Save configuration to browser storage
   */
  async save() {
    try {
      // Save settings as individual keys to match popup.js behavior
      await browser.storage.local.set(this.config);
    } catch (err) {
      console.error('[Config] Failed to save configuration:', err);
    }
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @returns {any} Configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Set a configuration value
   * @param {string} key - Configuration key
   * @param {any} value - Configuration value
   */
  set(key, value) {
    this.config[key] = value;
    this.notifyListeners(key, value);
  }

  /**
   * Get all configuration
   * @returns {object} Configuration object
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Update multiple configuration values
   * @param {object} updates - Configuration updates
   */
  update(updates) {
    this.config = { ...this.config, ...updates };
    this.notifyListeners();
  }

  /**
   * Register a listener for configuration changes
   * @param {function} callback - Callback function
   */
  onChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * Notify all listeners of configuration changes
   * @param {string} key - Optional key that changed
   * @param {any} value - Optional new value
   */
  notifyListeners(key, value) {
    this.listeners.forEach(listener => listener(key, value, this.config));
  }
}
