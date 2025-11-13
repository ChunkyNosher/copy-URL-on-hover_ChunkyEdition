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
  quickTabCustomX: 100,
  quickTabCustomY: 100,
  quickTabPersistAcrossTabs: true,
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

export const CONSTANTS = {
  GOOGLE_FAVICON_URL: 'https://www.google.com/s2/favicons?domain=',
  TOOLTIP_OFFSET_X: 10,
  TOOLTIP_OFFSET_Y: 10,
  TOOLTIP_DURATION_MS: 1500,
  TOOLTIP_FADE_OUT_MS: 200,
  QUICK_TAB_BASE_Z_INDEX: 1000000
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
    try {
      // Load all settings from storage (popup.js saves them as individual keys)
      const result = await browser.storage.local.get(DEFAULT_CONFIG);
      this.config = { ...DEFAULT_CONFIG, ...result };
    } catch (err) {
      console.error('[Config] Failed to load configuration:', err);
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
