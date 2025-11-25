/**
 * CreateHandler
 * Handles Quick Tab creation logic
 * v1.6.2 - MIGRATION: Removed BroadcastManager, uses storage.onChanged for cross-tab sync
 *
 * Extracted from QuickTabsManager to reduce complexity
 * Lines 903-992 from original index.js
 */

import { createQuickTabWindow } from '../window.js';

/**
 * CreateHandler - Responsible for creating new Quick Tabs
 * v1.6.2 - MIGRATION: Cross-tab sync now handled via storage.onChanged
 *
 * Responsibilities:
 * - Generate ID if not provided
 * - Auto-assign container if not provided
 * - Handle existing tabs (render if not rendered)
 * - Create QuickTabWindow instance
 * - Store in tabs Map
 * - Save to storage (triggers storage.onChanged in other tabs)
 * - Emit QUICK_TAB_CREATED event
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

    // v1.5.9.10 - Ensure tab is rendered
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
   * v1.6.2 - MIGRATION: Saves to storage (triggers storage.onChanged in other tabs)
   * @private
   */
  _createNewTab(id, cookieStoreId, options) {
    this.currentZIndex.value++;

    const defaults = this._getDefaults();
    const tabOptions = this._buildTabOptions(id, cookieStoreId, options, defaults);

    console.log('[CreateHandler] Creating window with factory:', typeof this.createWindow);
    console.log('[CreateHandler] Factory is mock?:', this.createWindow.name === 'mockConstructor' || this.createWindow.toString().includes('jest'));
    console.log('[CreateHandler] Tab options:', tabOptions);

    const tabWindow = this.createWindow(tabOptions);

    console.log('[CreateHandler] Window created:', tabWindow);
    console.log('[CreateHandler] Window type:', typeof tabWindow);
    console.log('[CreateHandler] Window has id?:', tabWindow && 'id' in tabWindow);

    this.quickTabsMap.set(id, tabWindow);
    
    // v1.6.2 - Save to storage (triggers storage.onChanged in other tabs)
    this._saveToStorage(id, cookieStoreId, options, defaults);
    
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
      mutedOnTabs: []
    };
  }

  /**
   * Build options for createQuickTabWindow
   * @private
   */
  _buildTabOptions(id, cookieStoreId, options, defaults) {
    return {
      id,
      url: options.url,
      left: options.left ?? defaults.left,
      top: options.top ?? defaults.top,
      width: options.width ?? defaults.width,
      height: options.height ?? defaults.height,
      title: options.title ?? defaults.title,
      cookieStoreId,
      minimized: options.minimized ?? defaults.minimized,
      zIndex: this.currentZIndex.value,
      soloedOnTabs: options.soloedOnTabs ?? defaults.soloedOnTabs,
      mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs,
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
   * Save Quick Tab to storage (triggers storage.onChanged in other tabs)
   * v1.6.2 - MIGRATION: Replaces broadcastManager.broadcast()
   * @private
   */
  async _saveToStorage(id, cookieStoreId, options, defaults) {
    if (typeof browser === 'undefined' || !browser.runtime) {
      console.warn('[CreateHandler] browser.runtime not available - Quick Tab will NOT sync across tabs. This is expected in test environments but indicates a problem in production.');
      return;
    }

    try {
      await browser.runtime.sendMessage({
        action: 'CREATE_QUICK_TAB',
        id,
        url: options.url,
        left: options.left ?? defaults.left,
        top: options.top ?? defaults.top,
        width: options.width ?? defaults.width,
        height: options.height ?? defaults.height,
        title: options.title ?? defaults.title,
        cookieStoreId,
        minimized: options.minimized ?? defaults.minimized,
        soloedOnTabs: options.soloedOnTabs ?? defaults.soloedOnTabs,
        mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs,
        timestamp: Date.now()
      });
      console.log('[CreateHandler] Quick Tab saved to storage:', id);
    } catch (err) {
      console.error('[CreateHandler] Error saving Quick Tab to storage:', err);
    }
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
