/**
 * CreateHandler
 * Handles Quick Tab creation logic
 *
 * Extracted from QuickTabsManager to reduce complexity
 * Lines 903-992 from original index.js
 */

import { createQuickTabWindow } from '../window.js';

/**
 * CreateHandler - Responsible for creating new Quick Tabs
 *
 * Responsibilities:
 * - Generate ID if not provided
 * - Auto-assign container if not provided
 * - Handle existing tabs (render if not rendered)
 * - Create QuickTabWindow instance
 * - Store in tabs Map
 * - Broadcast CREATE message
 * - Emit QUICK_TAB_CREATED event
 */
export class CreateHandler {
  /**
   * @param {Map} quickTabsMap - Map of id -> QuickTabWindow
   * @param {Object} currentZIndex - Ref object { value: number }
   * @param {string} cookieStoreId - Current container ID
   * @param {Object} broadcastManager - BroadcastManager instance
   * @param {Object} eventBus - EventEmitter for DOM events
   * @param {Object} Events - Event constants
   * @param {Function} generateId - ID generation function
   */
  constructor(
    quickTabsMap,
    currentZIndex,
    cookieStoreId,
    broadcastManager,
    eventBus,
    Events,
    generateId
  ) {
    this.quickTabsMap = quickTabsMap;
    this.currentZIndex = currentZIndex;
    this.cookieStoreId = cookieStoreId;
    this.broadcastManager = broadcastManager;
    this.eventBus = eventBus;
    this.Events = Events;
    this.generateId = generateId;
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
   * @private
   */
  _createNewTab(id, cookieStoreId, options) {
    this.currentZIndex.value++;

    const defaults = this._getDefaults();
    const tabOptions = this._buildTabOptions(id, cookieStoreId, options, defaults);
    const tabWindow = createQuickTabWindow(tabOptions);

    this.quickTabsMap.set(id, tabWindow);
    this._broadcastCreation(id, cookieStoreId, options, defaults);
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
   * Broadcast creation to other tabs
   * @private
   */
  _broadcastCreation(id, cookieStoreId, options, defaults) {
    this.broadcastManager.broadcast('CREATE', {
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
      mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs
    });
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
