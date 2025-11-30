/**
 * CreateHandler
 * Handles Quick Tab creation logic
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 *
 * Extracted from QuickTabsManager to reduce complexity
 * Lines 903-992 from original index.js
 */

import browser from 'webextension-polyfill';

import { CONSTANTS } from '../../../core/config.js';
import { createQuickTabWindow } from '../window.js';

/**
 * CreateHandler - Responsible for creating new Quick Tabs
 * v1.6.3 - Single-tab Quick Tabs (no storage persistence or cross-tab sync)
 * v1.6.3.2 - Added showDebugId setting support for Debug ID display
 *
 * Responsibilities:
 * - Generate ID if not provided
 * - Handle existing tabs (render if not rendered)
 * - Create QuickTabWindow instance
 * - Store in tabs Map
 * - Emit QUICK_TAB_CREATED event
 * - Load debug settings from storage
 */
export class CreateHandler {
  /**
   * @param {Map} quickTabsMap - Map of id -> QuickTabWindow
   * @param {Object} currentZIndex - Ref object { value: number }
   * @param {string} cookieStoreId - Current container ID
   * @param {Object} eventBus - EventEmitter for DOM events
   * @param {Object} Events - Event constants
   * @param {Function} generateId - ID generation function
   * @param {Function} windowFactory - Optional factory function for creating windows (for testing)
   */
  constructor(
    quickTabsMap,
    currentZIndex,
    cookieStoreId,
    eventBus,
    Events,
    generateId,
    windowFactory = null
  ) {
    this.quickTabsMap = quickTabsMap;
    this.currentZIndex = currentZIndex;
    this.cookieStoreId = cookieStoreId;
    this.eventBus = eventBus;
    this.Events = Events;
    this.generateId = generateId;
    // Allow injection of window factory for testing
    this.createWindow = windowFactory || createQuickTabWindow;
    // v1.6.3.2 - Cache for quickTabShowDebugId setting
    this.showDebugIdSetting = false;
    // v1.6.4.8 - Store listener reference for cleanup
    this._storageListener = null;
  }

  /**
   * Initialize handler - load settings from storage
   * v1.6.3.2 - Load showDebugId setting for Debug ID display feature
   * v1.6.4.8 - FIX Issue #4: Add storage.onChanged listener for dynamic updates
   */
  async init() {
    await this._loadDebugIdSetting();
    this._setupStorageListener();
  }

  /**
   * Cleanup storage listener to prevent memory leaks
   * v1.6.4.8 - Added for proper resource cleanup
   */
  destroy() {
    if (this._storageListener) {
      browser.storage.onChanged.removeListener(this._storageListener);
      this._storageListener = null;
      console.log('[CreateHandler] Storage listener removed');
    }
  }

  /**
   * Setup storage.onChanged listener for dynamic setting updates
   * v1.6.4.8 - FIX Issue #4: Update already-rendered Quick Tabs when settings change
   * @private
   */
  _setupStorageListener() {
    const settingsKey = CONSTANTS.QUICK_TAB_SETTINGS_KEY;

    // Store listener reference for cleanup
    // Note: We intentionally don't filter by areaName because settings can be in
    // either sync or local storage (with fallback), and we want to react to changes
    // in either area
    this._storageListener = (changes, areaName) => {
      // Check if our settings key changed
      if (!changes[settingsKey]) return;

      const newSettings = changes[settingsKey].newValue;
      const oldSettings = changes[settingsKey].oldValue;
      
      // Check if quickTabShowDebugId specifically changed
      const newShowDebugId = newSettings?.quickTabShowDebugId ?? false;
      const oldShowDebugId = oldSettings?.quickTabShowDebugId ?? false;
      
      if (newShowDebugId === oldShowDebugId) return;

      console.log('[CreateHandler] Debug ID setting changed:', {
        areaName,
        oldValue: oldShowDebugId,
        newValue: newShowDebugId
      });
      
      // Update cached setting
      this.showDebugIdSetting = newShowDebugId;
      
      // Update all rendered Quick Tabs
      this._updateAllQuickTabsDebugDisplay(newShowDebugId);
    };

    browser.storage.onChanged.addListener(this._storageListener);
    console.log('[CreateHandler] Storage listener setup complete');
  }

  /**
   * Update debug ID display on all rendered Quick Tabs
   * v1.6.4.8 - FIX Issue #4: Dynamic titlebar updates when settings change
   * @private
   * @param {boolean} showDebugId - Whether to show debug ID
   */
  _updateAllQuickTabsDebugDisplay(showDebugId) {
    let updatedCount = 0;
    
    for (const [_id, tabWindow] of this.quickTabsMap) {
      // Only update rendered windows with the required method
      if (!tabWindow || typeof tabWindow.isRendered !== 'function') continue;
      if (!tabWindow.isRendered()) continue;
      if (typeof tabWindow.updateDebugIdDisplay !== 'function') continue;

      tabWindow.updateDebugIdDisplay(showDebugId);
      updatedCount++;
    }
    
    console.log('[CreateHandler] Updated debug ID display on', updatedCount, 'Quick Tabs');
  }

  /**
   * Load the quickTabShowDebugId setting from storage
   * v1.6.3.2 - Feature: Debug UID Display Toggle
   * v1.6.4.8 - FIX Issue #2: Add fallback to local storage, improved logging
   * @private
   */
  async _loadDebugIdSetting() {
    const settingsKey = CONSTANTS.QUICK_TAB_SETTINGS_KEY;
    
    // Try sync storage first
    try {
      const result = await browser.storage.sync.get(settingsKey);
      console.log('[CreateHandler] Sync storage result:', { settingsKey, result });
      
      if (result && result[settingsKey]) {
        const settings = result[settingsKey];
        this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
        console.log('[CreateHandler] Loaded showDebugId from sync storage:', this.showDebugIdSetting);
        return;
      }
    } catch (syncErr) {
      console.warn('[CreateHandler] Sync storage failed, trying local:', syncErr);
    }
    
    // Fallback to local storage
    try {
      const localResult = await browser.storage.local.get(settingsKey);
      console.log('[CreateHandler] Local storage result:', { settingsKey, localResult });
      
      if (localResult && localResult[settingsKey]) {
        const settings = localResult[settingsKey];
        this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
        console.log('[CreateHandler] Loaded showDebugId from local storage:', this.showDebugIdSetting);
        return;
      }
    } catch (localErr) {
      console.warn('[CreateHandler] Local storage also failed:', localErr.message);
    }
    
    // Default to false if both fail
    this.showDebugIdSetting = false;
    console.log('[CreateHandler] Using default showDebugId setting:', this.showDebugIdSetting);
  }

  /**
   * Create a new Quick Tab
   *
   * @param {Object} options - Quick Tab options
   * @returns {{ tabWindow: Object, newZIndex: number }} Created tab and new z-index
   */
  create(options) {
    console.log('[CreateHandler] Creating Quick Tab with options:', options);

    const id = options.id || this.generateId();
    const cookieStoreId = options.cookieStoreId || this.cookieStoreId || 'firefox-default';

    // Handle existing tab
    if (this.quickTabsMap.has(id)) {
      return this._handleExistingTab(id);
    }

    // Create new tab
    return this._createNewTab(id, cookieStoreId, options);
  }

  /**
   * Handle existing tab (render if not rendered, bring to front)
   * @private
   */
  _handleExistingTab(id) {
    const existingTab = this.quickTabsMap.get(id);

    // Ensure tab is rendered
    if (!existingTab.isRendered || !existingTab.isRendered()) {
      console.log('[CreateHandler] Tab exists but not rendered, rendering now:', id);
      existingTab.render();
    } else {
      console.warn('[CreateHandler] Quick Tab already exists and is rendered:', id);
    }

    this.currentZIndex.value++;
    existingTab.updateZIndex(this.currentZIndex.value);

    return {
      tabWindow: existingTab,
      newZIndex: this.currentZIndex.value
    };
  }

  /**
   * Create and store new tab
   * v1.6.3 - Local only (no storage persistence)
   * @private
   */
  _createNewTab(id, cookieStoreId, options) {
    this.currentZIndex.value++;

    const defaults = this._getDefaults();
    const tabOptions = this._buildTabOptions(id, cookieStoreId, options, defaults);

    console.log('[CreateHandler] Creating window with factory:', typeof this.createWindow);
    console.log('[CreateHandler] Tab options:', tabOptions);

    const tabWindow = this.createWindow(tabOptions);

    console.log('[CreateHandler] Window created:', tabWindow);

    this.quickTabsMap.set(id, tabWindow);
    
    this._emitCreationEvent(id, options.url);

    console.log('[CreateHandler] Quick Tab created successfully:', id);

    return {
      tabWindow,
      newZIndex: this.currentZIndex.value
    };
  }

  /**
   * Get default option values
   * @private
   */
  _getDefaults() {
    return {
      left: 100,
      top: 100,
      width: 800,
      height: 600,
      title: 'Quick Tab',
      minimized: false,
      soloedOnTabs: [],
      mutedOnTabs: [],
      showDebugId: false // v1.6.3.2 - Default for Debug ID display
    };
  }

  /**
   * Build options for createQuickTabWindow
   * v1.6.3.2 - Added showDebugId setting for Debug ID display feature
   * v1.6.3.2 - Refactored to reduce complexity by extracting geometry options
   * @private
   */
  _buildTabOptions(id, cookieStoreId, options, defaults) {
    return {
      id,
      url: options.url,
      cookieStoreId,
      zIndex: this.currentZIndex.value,
      ...this._buildGeometryOptions(options, defaults),
      ...this._buildVisibilityOptions(options, defaults),
      ...this._extractCallbacks(options)
    };
  }

  /**
   * Build geometry-related options (position/size)
   * v1.6.3.2 - Extracted to reduce _buildTabOptions complexity
   * @private
   */
  _buildGeometryOptions(options, defaults) {
    return {
      left: options.left ?? defaults.left,
      top: options.top ?? defaults.top,
      width: options.width ?? defaults.width,
      height: options.height ?? defaults.height,
      title: options.title ?? defaults.title
    };
  }

  /**
   * Build visibility-related options (minimized, solo, mute, debug)
   * v1.6.3.2 - Extracted to reduce _buildTabOptions complexity
   * @private
   */
  _buildVisibilityOptions(options, defaults) {
    return {
      minimized: options.minimized ?? defaults.minimized,
      soloedOnTabs: options.soloedOnTabs ?? defaults.soloedOnTabs,
      mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs,
      showDebugId: options.showDebugId ?? this.showDebugIdSetting
    };
  }

  /**
   * Extract callback options
   * v1.6.3.2 - Extracted to reduce _buildTabOptions complexity
   * @private
   */
  _extractCallbacks(options) {
    return {
      onDestroy: options.onDestroy,
      onMinimize: options.onMinimize,
      onFocus: options.onFocus,
      onPositionChange: options.onPositionChange,
      onPositionChangeEnd: options.onPositionChangeEnd,
      onSizeChange: options.onSizeChange,
      onSizeChangeEnd: options.onSizeChangeEnd,
      onSolo: options.onSolo,
      onMute: options.onMute
    };
  }

  /**
   * Emit creation event
   * @private
   */
  _emitCreationEvent(id, url) {
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_CREATED, { id, url });
    }
  }
}
