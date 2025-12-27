/**
 * CreateHandler
 * Handles Quick Tab creation logic
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created event for UICoordinator
 *
 * Extracted from QuickTabsManager to reduce complexity
 * Lines 903-992 from original index.js
 */

// v1.6.3.12-v3 - FIX Issue A: Import getWritingContainerId to get current container from Identity system
import { validateOriginTabIdForSerialization, getWritingContainerId } from '@utils/storage-utils.js';
import browser from 'webextension-polyfill';

import { createQuickTabWindow } from '../window.js';

/**
 * CreateHandler - Responsible for creating new Quick Tabs
 * v1.6.3 - Single-tab Quick Tabs (no storage persistence or cross-tab sync)
 * v1.6.3.2 - Added showDebugId setting support for Debug ID display
 * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created for UICoordinator Map
 *
 * Responsibilities:
 * - Generate ID if not provided
 * - Handle existing tabs (render if not rendered)
 * - Create QuickTabWindow instance
 * - Store in tabs Map
 * - Emit QUICK_TAB_CREATED event
 * - Emit window:created event for UICoordinator registration
 * - Load debug settings from storage
 */
export class CreateHandler {
  /**
   * @param {Map} quickTabsMap - Map of id -> QuickTabWindow
   * @param {Object} currentZIndex - Ref object { value: number }
   * @param {string} cookieStoreId - Current container ID
   * @param {Object} eventBus - EventEmitter for DOM events (external, from content.js)
   * @param {Object} Events - Event constants
   * @param {Function} generateId - ID generation function
   * @param {Function} windowFactory - Optional factory function for creating windows (for testing)
   * @param {Object} internalEventBus - v1.6.3.11-v10 FIX Issue #12: Internal event bus for UICoordinator communication
   */
  constructor(
    quickTabsMap,
    currentZIndex,
    cookieStoreId,
    eventBus,
    Events,
    generateId,
    windowFactory = null,
    internalEventBus = null
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
    // v1.6.3.11-v10 - FIX Issue #12: Store internal event bus for window:created events
    // UICoordinator listens on internalEventBus, so window:created must be emitted there
    this.internalEventBus = internalEventBus;

    // v1.6.3.11-v10 - FIX Issue #12: Log event bus instances for debugging
    const externalId = eventBus?.getInstanceId?.() ?? eventBus?.constructor?.name ?? 'unknown';
    const internalId = internalEventBus?.constructor?.name ?? 'null';
    console.log('[CreateHandler] Received eventBus instances:', {
      externalEventBus: externalId,
      internalEventBus: internalId,
      hasInternalBus: !!internalEventBus
    });
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
   * v1.6.3.12 - FIX Issue #16: Validate originTabId is set on tab data before storing
   * @private
   */
  _createNewTab(id, cookieStoreId, options) {
    this.currentZIndex.value++;

    const defaults = this._getDefaults();
    const tabOptions = this._buildTabOptions(id, cookieStoreId, options, defaults);

    // v1.6.3.12 - FIX Issue #16: Validate originTabId before creating window
    const originValidation = validateOriginTabIdForSerialization(
      tabOptions,
      'CreateHandler._createNewTab'
    );
    if (!originValidation.valid) {
      console.warn('[CreateHandler] originTabId validation failed:', {
        id,
        warning: originValidation.warning,
        tabOptions: {
          originTabId: tabOptions.originTabId,
          originContainerId: tabOptions.originContainerId
        }
      });
      // Continue anyway - the logging will help debug serialization issues
    }

    console.log('[CreateHandler] Creating window with factory:', typeof this.createWindow);
    console.log('[CreateHandler] Tab options:', tabOptions);

    const tabWindow = this.createWindow(tabOptions);

    // v1.6.3.12 - FIX Issue #16: Ensure originTabId is assigned directly on tabWindow
    // This ensures serialization reads from the same location where it's assigned
    if (tabOptions.originTabId !== null && tabOptions.originTabId !== undefined) {
      tabWindow.originTabId = tabOptions.originTabId;
    }
    if (tabOptions.originContainerId !== null && tabOptions.originContainerId !== undefined) {
      tabWindow.originContainerId = tabOptions.originContainerId;
    }

    // v1.6.3.11-v12 - FIX Issue #7: Enhanced logging for originTabId and originContainerId
    console.log('[CreateHandler] 📍 ORIGIN_ASSIGNMENT:', {
      id,
      originTabId: tabWindow.originTabId,
      originContainerId: tabWindow.originContainerId,
      cookieStoreId: tabOptions.cookieStoreId,
      url: options.url?.substring(0, 50)
    });

    console.log('[CreateHandler] Window created:', tabWindow);

    this.quickTabsMap.set(id, tabWindow);

    this._emitCreationEvent(id, options.url);

    // v1.6.3.5-v6 - FIX Diagnostic Issue #4: Emit window:created for UICoordinator
    // This allows UICoordinator to register the window in its renderedTabs Map
    this._emitWindowCreatedEvent(id, tabWindow);

    console.log('[CreateHandler] Quick Tab created successfully:', id);

    return {
      tabWindow,
      newZIndex: this.currentZIndex.value
    };
  }

  /**
   * Get default option values
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Add originTabId default
   * v1.6.3.10-v4 - FIX Issue #13: Add originContainerId default for container isolation
   * v1.6.4 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
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
      showDebugId: false, // v1.6.3.2 - Default for Debug ID display
      originTabId: null, // v1.6.3.5-v2 - Track originating tab for cross-tab filtering
      originContainerId: null // v1.6.3.10-v4 - FIX Issue #13: Track originating container for Firefox Multi-Account Containers
    };
  }

  /**
   * Build options for createQuickTabWindow
   * v1.6.3.2 - Added showDebugId setting for Debug ID display feature
   * v1.6.3.2 - Refactored to reduce complexity by extracting geometry options
   * v1.6.3.6-v8 - FIX Issue #1: Pass id to _buildVisibilityOptions for pattern extraction
   * @private
   */
  _buildTabOptions(id, cookieStoreId, options, defaults) {
    return {
      id,
      url: options.url,
      cookieStoreId,
      zIndex: this.currentZIndex.value,
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
   * Determine the source of the origin container ID for logging
   * v1.6.3.10-v4 - FIX Issue #13: Extract to reduce _buildVisibilityOptions complexity
   * v1.6.3.12-v2 - FIX Issue #2: Updated priority order to match _getOriginContainerId
   * @private
   * @param {string|null} originContainerId - Resolved container ID
   * @param {Object} options - Creation options
   * @returns {string} Source name for logging
   * @deprecated v1.6.3.12-v3 - Replaced by _getContainerIdSourceV3 which queries Identity system.
   *   This method only checks constructor/options values which may be stale.
   *   The V3 version adds getWritingContainerId() as a priority source.
   *   Kept for backward compatibility - safe to remove in v1.6.4+.
   */
  _getContainerIdSource(originContainerId, options) {
    // v1.6.3.12-v3 - DEPRECATED: Replaced by _getContainerIdSourceV3
    // This method is kept for potential external callers but is no longer used internally.
    // The V3 version adds Identity system (getWritingContainerId) as a priority source.
    if (originContainerId === options.originContainerId) return 'options.originContainerId';
    if (originContainerId === this.cookieStoreId) return 'this.cookieStoreId (identity context)';
    if (originContainerId === options.cookieStoreId) return 'options.cookieStoreId';
    return 'defaults';
  }

  /**
   * Resolve origin container ID with fallback priority
   * v1.6.3.10-v4 - FIX Issue #13: Extract to reduce _buildVisibilityOptions complexity
   * v1.6.3.12-v2 - FIX Issue #2 (issue-logging-analysis): Changed priority - prefer this.cookieStoreId
   *   (actual identity context) over options.cookieStoreId (potentially stale value from Quick Tab options)
   *   The identity context (this.cookieStoreId) is acquired during content script initialization
   *   and represents the actual container where the tab is running.
   * v1.6.3.12-v3 - FIX Issue A (issue-47-log-analysis): Query Identity system at creation time
   *   The constructor's this.cookieStoreId can be stale if Identity system acquired container ID
   *   AFTER handler initialization. Now we query getWritingContainerId() at creation time to get
   *   the actual current container from the Identity system.
   * Priority: options.originContainerId > Identity system > this.cookieStoreId > options.cookieStoreId > defaults
   * @private
   * @param {Object} options - Creation options
   * @param {Object} defaults - Default values
   * @param {string} quickTabId - Quick Tab ID for logging
   * @returns {string|null} Resolved container ID
   */
  _getOriginContainerId(options, defaults, quickTabId) {
    // v1.6.3.12-v3 - FIX Issue A: Query Identity system for current container at creation time
    // This is critical because this.cookieStoreId may be stale if it was set before Identity system
    // acquired the actual container context. getWritingContainerId() returns the current Identity state.
    const identityContainerId = getWritingContainerId();

    // v1.6.3.12-v3 - FIX Issue A: Priority order:
    // 1. Explicit options.originContainerId (highest priority, already known)
    // 2. Identity system's current container (getWritingContainerId) - most accurate at creation time
    // 3. this.cookieStoreId (constructor value, may be stale)
    // 4. options.cookieStoreId (potentially stale value from Quick Tab options)
    // 5. defaults.originContainerId (fallback)
    const originContainerId =
      options.originContainerId ??
      identityContainerId ??
      this.cookieStoreId ??
      options.cookieStoreId ??
      defaults.originContainerId;

    // v1.6.3.12-v3 - Enhanced logging to track container resolution source
    const source = this._getContainerIdSourceV3(originContainerId, options, identityContainerId);

    console.log('[CreateHandler] 📦 CONTAINER_CONTEXT:', {
      quickTabId,
      originContainerId,
      source,
      // v1.6.3.12-v3 - Diagnostic fields to track container resolution from all sources
      identitySystemContainerId: identityContainerId ?? null,
      constructorCookieStoreId: this.cookieStoreId ?? null,
      optionsCookieStoreId: options.cookieStoreId ?? null,
      optionsOriginContainerId: options.originContainerId ?? null
    });

    return originContainerId;
  }

  /**
   * Determine the source of the origin container ID for logging (v3 with Identity system)
   * v1.6.3.12-v3 - FIX Issue A: Updated to include Identity system source
   * @private
   * @param {string|null} originContainerId - Resolved container ID
   * @param {Object} options - Creation options
   * @param {string|null} identityContainerId - Container ID from Identity system
   * @returns {string} Source name for logging
   */
  _getContainerIdSourceV3(originContainerId, options, identityContainerId) {
    if (originContainerId === options.originContainerId) return 'options.originContainerId';
    if (originContainerId === identityContainerId) return 'Identity system (getWritingContainerId)';
    if (originContainerId === this.cookieStoreId) return 'this.cookieStoreId (constructor)';
    if (originContainerId === options.cookieStoreId) return 'options.cookieStoreId';
    return 'defaults';
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
   * v1.6.3.10-v4 - FIX Issue #13: Add originContainerId for Firefox Multi-Account Container isolation
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

    // v1.6.3.10-v4 - FIX Issue #13: Capture origin container ID for Firefox Multi-Account Container isolation
    const originContainerId = this._getOriginContainerId(options, defaults, quickTabId);

    // v1.6.4 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
    return {
      minimized: options.minimized ?? defaults.minimized,
      showDebugId: options.showDebugId ?? this.showDebugIdSetting,
      originTabId,
      originContainerId, // v1.6.3.10-v4 - FIX Issue #13: Include container ID
      // v1.6.3.6-v4 - FIX Issue #2: Also pass currentTabId to window for operations
      currentTabId: options.currentTabId
    };
  }

  /**
   * Extract callback options
   * v1.6.3.2 - Extracted to reduce _buildTabOptions complexity
   * v1.6.4 - Removed Solo/Mute callbacks
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
      onSizeChangeEnd: options.onSizeChangeEnd
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
   * v1.6.3.11-v10 - FIX Issue #12: Use internalEventBus to reach UICoordinator
   *   UICoordinator listens on internalEventBus (EventEmitter3), not external eventBus (EventBus)
   *   This was the root cause of window:created events never reaching UICoordinator
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Created tab window instance
   */
  _emitWindowCreatedEvent(id, tabWindow) {
    // v1.6.3.11-v10 - FIX Issue #12: Prefer internalEventBus for UICoordinator communication
    // UICoordinator listens on internalEventBus, not the external eventBus from content.js
    const targetBus = this.internalEventBus || this.eventBus;

    if (!targetBus) {
      console.warn('[CreateHandler] No event bus available for window:created');
      return;
    }

    targetBus.emit('window:created', { id, tabWindow });

    // v1.6.3.11-v10 - FIX Issue #12: Log which bus was used for debugging
    const busType = this.internalEventBus ? 'internalEventBus' : 'eventBus (fallback)';
    console.log('[CreateHandler] Emitted window:created for UICoordinator:', {
      id,
      busType,
      busConstructor: targetBus?.constructor?.name ?? 'unknown'
    });
  }
}
