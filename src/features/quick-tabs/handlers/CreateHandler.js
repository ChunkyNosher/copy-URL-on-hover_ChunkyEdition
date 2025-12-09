/**
 * CreateHandler
 * Handles Quick Tab creation logic
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created event for UICoordinator
 * v1.6.3.7-v4 - FIX Issue #2: Add BroadcastChannel integration for cross-tab sync
 *
 * Extracted from QuickTabsManager to reduce complexity
 * Lines 903-992 from original index.js
 */

import browser from 'webextension-polyfill';

import {
  broadcastQuickTabCreated,
  isChannelAvailable
} from '../channels/BroadcastChannelManager.js';
import { createQuickTabWindow } from '../window.js';

/**
 * CreateHandler - Responsible for creating new Quick Tabs
 * v1.6.3 - Single-tab Quick Tabs (no storage persistence or cross-tab sync)
 * v1.6.3.2 - Added showDebugId setting support for Debug ID display
 * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created for UICoordinator Map
 * v1.6.3.7-v4 - FIX Issue #2: Broadcast creation via BroadcastChannel
 *
 * Responsibilities:
 * - Generate ID if not provided
 * - Handle existing tabs (render if not rendered)
 * - Create QuickTabWindow instance
 * - Store in tabs Map
 * - Emit QUICK_TAB_CREATED event
 * - Emit window:created event for UICoordinator registration
 * - Broadcast creation to other tabs via BroadcastChannel
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
    // v1.6.3.4-v9 - Store listener reference for cleanup
    this._storageListener = null;
  }

  /**
   * Initialize handler - load settings from storage
   * v1.6.3.2 - Load showDebugId setting for Debug ID display feature
   * v1.6.3.4-v9 - FIX Issue #4: Add storage.onChanged listener for dynamic updates
   */
  async init() {
    await this._loadDebugIdSetting();
    this._setupStorageListener();
  }

  /**
   * Cleanup storage listener to prevent memory leaks
   * v1.6.3.4-v9 - Added for proper resource cleanup
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
   * v1.6.3.4-v9 - FIX Issue #4: Update already-rendered Quick Tabs when settings change
   * v1.6.3.4-v10 - FIX Issue #5: Listen for individual key 'quickTabShowDebugId' from storage.local
   * @private
   */
  _setupStorageListener() {
    // Store listener reference for cleanup
    // v1.6.3.4-v10 - FIX: Listen for individual key 'quickTabShowDebugId' (how settings.js saves it)
    // instead of nested object access via QUICK_TAB_SETTINGS_KEY
    this._storageListener = (changes, areaName) => {
      // Only react to local storage changes where settings are saved
      if (areaName !== 'local') return;

      // Check if quickTabShowDebugId key changed
      const changeData = changes.quickTabShowDebugId;
      if (!changeData) return;

      const newShowDebugId = changeData.newValue ?? false;
      const oldShowDebugId = changeData.oldValue ?? false;

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
   * v1.6.3.4-v9 - FIX Issue #4: Dynamic titlebar updates when settings change
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
   * v1.6.3.4-v9 - FIX Issue #2: Add fallback to local storage, improved logging
   * @private
   */
  async _loadDebugIdSetting() {
    // v1.6.3.4-v10 - FIX Issue #3: Read from storage.local with individual key 'quickTabShowDebugId'
    // This matches how settings.js saves the setting (individual keys to storage.local)
    try {
      const result = await browser.storage.local.get('quickTabShowDebugId');
      this.showDebugIdSetting = result.quickTabShowDebugId ?? false;
      console.log(
        '[CreateHandler] Loaded showDebugId from storage.local:',
        this.showDebugIdSetting
      );
    } catch (err) {
      console.warn('[CreateHandler] Failed to load showDebugId setting:', err.message);
      this.showDebugIdSetting = false;
      console.log('[CreateHandler] Using default showDebugId setting:', this.showDebugIdSetting);
    }
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
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Capture originTabId for cross-tab filtering
   * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created for UICoordinator Map
   * v1.6.3.7-v4 - FIX Issue #2: Broadcast creation via BroadcastChannel
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

    // v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created for UICoordinator
    // This allows UICoordinator to register the window in its renderedTabs Map
    this._emitWindowCreatedEvent(id, tabWindow);

    // v1.6.3.7-v4 - FIX Issue #2: Broadcast creation via BroadcastChannel
    this._broadcastCreation(id, tabOptions, options);

    console.log('[CreateHandler] Quick Tab created successfully:', id);

    return {
      tabWindow,
      newZIndex: this.currentZIndex.value
    };
  }

  /**
   * Broadcast Quick Tab creation to other tabs
   * v1.6.3.7-v4 - FIX Issue #2: BroadcastChannel integration
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabOptions - Tab options used to create the window
   * @param {Object} options - Original options passed to create()
   */
  _broadcastCreation(id, tabOptions, options) {
    try {
      if (!isChannelAvailable()) {
        console.log('[CreateHandler] BroadcastChannel not available, skipping broadcast');
        return;
      }

      // Build broadcast data from options
      const broadcastData = {
        id,
        url: options.url,
        title: tabOptions.title,
        left: tabOptions.left,
        top: tabOptions.top,
        width: tabOptions.width,
        height: tabOptions.height,
        zIndex: tabOptions.zIndex,
        minimized: tabOptions.minimized || false,
        originTabId: tabOptions.originTabId,
        cookieStoreId: tabOptions.cookieStoreId,
        permanent: tabOptions.permanent,
        timestamp: Date.now()
      };

      const success = broadcastQuickTabCreated(id, broadcastData);
      console.log('[CreateHandler] BROADCAST_SENT: quick-tab-created', {
        id,
        success,
        channelAvailable: isChannelAvailable()
      });
    } catch (err) {
      console.warn('[CreateHandler] Failed to broadcast creation:', err.message);
    }
  }

  /**
   * Get default option values
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Add originTabId default
   * v1.6.3.7-v3 - API #1: Add permanent default (true for local storage)
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
      showDebugId: false, // v1.6.3.2 - Default for Debug ID display
      originTabId: null, // v1.6.3.5-v2 - Track originating tab for cross-tab filtering
      permanent: true // v1.6.3.7-v3 - API #1: true = local storage, false = session storage
    };
  }

  /**
   * Build options for createQuickTabWindow
   * v1.6.3.2 - Added showDebugId setting for Debug ID display feature
   * v1.6.3.2 - Refactored to reduce complexity by extracting geometry options
   * v1.6.3.6-v8 - FIX Issue #1: Pass id to _buildVisibilityOptions for pattern extraction
   * v1.6.3.7-v3 - API #1: Include permanent property in built options
   * @private
   */
  _buildTabOptions(id, cookieStoreId, options, defaults) {
    return {
      id,
      url: options.url,
      cookieStoreId,
      zIndex: this.currentZIndex.value,
      permanent: options.permanent ?? defaults.permanent, // v1.6.3.7-v3 - API #1
      ...this._buildGeometryOptions(options, defaults),
      ...this._buildVisibilityOptions(options, defaults, id),
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
   * Extract tab ID from Quick Tab ID pattern
   * v1.6.3.6-v8 - FIX Issue #1: Fallback extraction from ID pattern
   * Quick Tab IDs follow pattern: qt-{tabId}-{timestamp}-{random}
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @returns {number|null} Extracted tab ID or null
   */
  _extractTabIdFromQuickTabId(quickTabId) {
    if (!quickTabId || typeof quickTabId !== 'string') return null;
    const match = quickTabId.match(/^qt-(\d+)-/);
    if (match) {
      const tabId = parseInt(match[1], 10);
      console.log('[CreateHandler] 🔧 Extracted originTabId from ID pattern:', {
        quickTabId,
        extractedTabId: tabId
      });
      return tabId;
    }
    return null;
  }

  /**
   * Get the originTabId from options with fallbacks
   * v1.6.3.6-v4 - FIX Issue #2: Extracted to reduce _buildVisibilityOptions complexity
   * v1.6.3.6-v8 - FIX Issue #1: Added ID pattern extraction as final fallback
   * @private
   * @param {Object} options - Creation options
   * @param {Object} defaults - Default values
   * @param {string} quickTabId - Quick Tab ID for pattern extraction fallback
   * @returns {number|null} The originTabId
   */
  _getOriginTabId(options, defaults, quickTabId = null) {
    // Priority: options.originTabId > options.activeTabId > defaults.originTabId > ID pattern
    const fromOptions = options.originTabId ?? options.activeTabId ?? defaults.originTabId;
    if (fromOptions !== null && fromOptions !== undefined) {
      return fromOptions;
    }
    // v1.6.3.6-v8 - FIX Issue #1: Extract from ID pattern as last resort
    if (quickTabId) {
      const fromPattern = this._extractTabIdFromQuickTabId(quickTabId);
      if (fromPattern !== null) {
        console.warn(
          '[CreateHandler] ⚠️ originTabId recovered from ID pattern (was null in options):',
          {
            quickTabId,
            recoveredTabId: fromPattern
          }
        );
        return fromPattern;
      }
    }
    return null;
  }

  /**
   * Log originTabId assignment with appropriate severity
   * v1.6.3.6-v4 - FIX Issue #2: Extracted to reduce _buildVisibilityOptions complexity
   * @private
   * @param {number|null} originTabId - The assigned originTabId
   * @param {Object} options - Creation options
   * @param {Object} defaults - Default values
   */
  _logOriginTabIdAssignment(originTabId, options, defaults) {
    // Check for both null and undefined with single comparison
    if (originTabId == null) {
      console.error('[CreateHandler] WARNING: originTabId is null/undefined!', {
        optionsOriginTabId: options.originTabId,
        optionsActiveTabId: options.activeTabId,
        defaultsOriginTabId: defaults.originTabId,
        currentTabId: options.currentTabId,
        url: options.url
      });
    } else {
      const source = options.originTabId
        ? 'options.originTabId'
        : options.activeTabId
          ? 'options.activeTabId'
          : 'defaults';
      console.log('[CreateHandler] originTabId set:', { originTabId, source });
    }
  }

  /**
   * Build visibility-related options (minimized, solo, mute, debug)
   * v1.6.3.2 - Extracted to reduce _buildTabOptions complexity
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Include originTabId
   *   activeTabId is used as fallback because older code may set activeTabId
   *   to track which browser tab contains the Quick Tab
   * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #2: Add logging when originTabId is null
   *   Extracted helpers to reduce complexity
   * v1.6.3.6-v8 - FIX Issue #1: Pass quickTabId to _getOriginTabId for pattern extraction
   * @private
   * @param {Object} options - Creation options
   * @param {Object} defaults - Default values
   * @param {string} quickTabId - Quick Tab ID for pattern extraction fallback
   */
  _buildVisibilityOptions(options, defaults, quickTabId = null) {
    const originTabId = this._getOriginTabId(options, defaults, quickTabId);

    // v1.6.3.6-v8 - FIX Issue #1: Critical diagnostic logging
    console.log('[CreateHandler] 📍 ORIGIN_TAB_ID_RESOLUTION:', {
      quickTabId,
      resolvedOriginTabId: originTabId,
      source:
        originTabId === options.originTabId
          ? 'options.originTabId'
          : originTabId === options.activeTabId
            ? 'options.activeTabId'
            : originTabId === defaults.originTabId
              ? 'defaults.originTabId'
              : 'ID pattern extraction',
      optionsOriginTabId: options.originTabId,
      optionsActiveTabId: options.activeTabId,
      defaultsOriginTabId: defaults.originTabId
    });

    this._logOriginTabIdAssignment(originTabId, options, defaults);

    return {
      minimized: options.minimized ?? defaults.minimized,
      soloedOnTabs: options.soloedOnTabs ?? defaults.soloedOnTabs,
      mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs,
      showDebugId: options.showDebugId ?? this.showDebugIdSetting,
      originTabId,
      // v1.6.3.6-v4 - FIX Issue #2: Also pass currentTabId to window for operations
      currentTabId: options.currentTabId
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

  /**
   * Emit window:created event for UICoordinator registration
   * v1.6.3.5-v6 - FIX Diagnostic Issue #4: UICoordinator Map never populated
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Created tab window instance
   */
  _emitWindowCreatedEvent(id, tabWindow) {
    if (!this.eventBus) return;

    this.eventBus.emit('window:created', { id, tabWindow });
    console.log('[CreateHandler] Emitted window:created for UICoordinator:', id);
  }
}
