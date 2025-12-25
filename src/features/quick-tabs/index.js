/**
 * Quick Tabs Feature Module - REFACTORED FACADE
 * Main entrypoint for Quick Tabs functionality
 *
 * v1.6.0 - PHASE 2.2: Facade pattern implementation
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.4 - FIX Issues #1, #8: Add state rehydration on startup with explicit logging
 * v1.6.3.4-v7 - FIX Issue #1: Hydration creates real QuickTabWindow instances
 * v1.6.3.5-v5 - FIX Issue #5: Added deprecation warnings to legacy mutation methods
 * v1.6.3.5-v10 - FIX Issue #1-2: Pass handlers to UICoordinator for callback wiring
 *
 * Architecture (Single-Tab Model v1.6.3+):
 * - Each browser tab manages only Quick Tabs it owns (originTabId matches currentTabId)
 * - Facade orchestrates managers, handlers, and coordinators
 * - Maintains backward compatibility with legacy API (with deprecation warnings)
 * - Delegates all business logic to specialized components
 * - No cross-tab broadcasting - storage used for persistence and hydration only
 */

import { EventEmitter } from 'eventemitter3';

import { UICoordinator } from './coordinators/UICoordinator.js';
import { MemoryGuard } from './guards/MemoryGuard.js';
import { CreateHandler } from './handlers/CreateHandler.js';
import { DestroyHandler } from './handlers/DestroyHandler.js';
import { UpdateHandler } from './handlers/UpdateHandler.js';
import { VisibilityHandler } from './handlers/VisibilityHandler.js';
import { EventManager } from './managers/EventManager.js';
import { StateManager } from './managers/StateManager.js';
import { MinimizedManager } from './minimized-manager.js';
import { QuickTabWindow } from './window.js'; // v1.6.3.4-v7 - FIX Issue #1: Import for hydration
import { CONSTANTS } from '../../core/config.js';
import {
  STATE_KEY,
  loadZIndexCounter, // v1.6.3.12 - FIX Issue #17: Z-index counter persistence
  startStorageListenerHealthMonitor // v1.6.3.12 - FIX Issue #15: Storage listener health
} from '../../utils/storage-utils.js';

/**
 * QuickTabsManager - Facade for Quick Tab management
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync or storage persistence)
 * v1.6.3.4 - FIX Issues #1, #8: Add state rehydration on startup with logging
 */
class QuickTabsManager {
  constructor(options = {}) {
    // Backward compatibility fields (MUST KEEP - other code depends on these)
    this.tabs = new Map(); // id -> QuickTabWindow instance (used by panel.js, etc.)
    this.currentZIndex = { value: CONSTANTS.QUICK_TAB_BASE_Z_INDEX }; // Changed to ref object
    this.initialized = false;
    this.cookieStoreId = null;
    this.currentTabId = null;

    // Internal event bus for component communication
    this.internalEventBus = new EventEmitter();

    // Managers (initialized in init())
    this.state = null;
    this.events = null;

    // Handlers (initialized in init())
    this.createHandler = null;
    this.updateHandler = null;
    this.visibilityHandler = null;
    this.destroyHandler = null;

    // Coordinators (initialized in init())
    this.uiCoordinator = null;

    // Legacy UI managers (KEEP - used by other modules)
    this.minimizedManager = new MinimizedManager();

    // Legacy fields for backward compatibility (KEEP - required by old code)
    this.eventBus = null; // External event bus from content.js
    this.Events = null; // Event constants

    // Dependency injection for testing
    this.windowFactory = options.windowFactory || null;

    // MemoryGuard for emergency shutdown
    this.memoryGuard = null;

    // Track all generated IDs to prevent collisions within this session
    this.generatedIds = new Set();
  }

  /**
   * Initialize the Quick Tabs manager
   * v1.6.3 - Simplified (no storage/sync components)
   *
   * @param {EventEmitter} eventBus - External event bus from content.js
   * @param {Object} Events - Event constants
   * @param {Object} [options={}] - v1.6.3.5-v10: Initialization options
   * @param {number} [options.currentTabId] - v1.6.3.5-v10: Pre-fetched tab ID from content script
   */
  async init(eventBus, Events, options = {}) {
    if (this.initialized) {
      console.log('[QuickTabsManager] Already initialized, skipping');
      return;
    }

    this.eventBus = eventBus;
    this.Events = Events;

    // v1.6.3.5-v10 - FIX Issue #3: Use pre-fetched currentTabId if provided
    // This is critical for cross-tab scoping - content.js fetched this from background
    // before calling init(), so we can use it immediately instead of detecting async
    if (options.currentTabId !== null && options.currentTabId !== undefined) {
      this.currentTabId = options.currentTabId;
      console.log('[QuickTabsManager] Using pre-fetched currentTabId:', this.currentTabId);
    }

    console.log('[QuickTabsManager] Initializing facade...');

    try {
      await this._initStep1_Context(options);
      this._initStep2_Managers();
      await this._initStep3_Handlers(); // v1.6.3.2 - Made async for CreateHandler settings
      this._initStep4_Coordinators();
      await this._initStep5_Setup();
      await this._initStep6_Hydrate(); // v1.6.3.4 - FIX Issue #1: Hydrate state from storage
      this._initStep7_Expose();

      this.initialized = true;
      console.log('[QuickTabsManager] ✓✓✓ Facade initialized successfully ✓✓✓');
    } catch (err) {
      this._logInitializationError(err);
      throw err;
    }
  }

  /**
   * Log initialization error with detailed context
   * v1.6.3.6-v10 - Extracted to reduce init() complexity
   * @private
   * @param {Error} err - Error that occurred during initialization
   */
  _logInitializationError(err) {
    console.error('[QuickTabsManager] ❌❌❌ INITIALIZATION FAILED ❌❌❌');
    console.error('[QuickTabsManager] Error details:', {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      type: typeof err,
      error: err
    });
  }

  /**
   * STEP 1: Detect context (container, tab ID)
   * v1.6.3.5-v10 - FIX Issue #3: Accept options parameter for pre-fetched tab ID
   * v1.6.3.12 - FIX Issue #17: Load z-index counter from storage
   * v1.6.3.12 - FIX Issue #15: Start storage listener health monitoring
   * @private
   * @param {Object} [_options={}] - Options including pre-fetched currentTabId (unused, kept for API consistency)
   */
  async _initStep1_Context(_options = {}) {
    console.log('[QuickTabsManager] STEP 1: Detecting container context...');
    const containerDetected = await this.detectContainerContext();
    if (!containerDetected) {
      console.warn('[QuickTabsManager] Container detection failed, using default container');
    }

    // v1.6.3.5-v10 - FIX Issue #3: Skip tab ID detection if already set from options
    // Content.js now pre-fetches tab ID from background before calling init()
    if (this.currentTabId !== null && this.currentTabId !== undefined) {
      console.log(
        '[QuickTabsManager] STEP 1: Tab ID already set (from options):',
        this.currentTabId
      );
    } else {
      console.log('[QuickTabsManager] STEP 1: Detecting tab ID (fallback)...');
      await this.detectCurrentTabId();
    }

    // v1.6.3.12 - FIX Issue #17: Load z-index counter from storage
    try {
      const restoredZIndex = await loadZIndexCounter(CONSTANTS.QUICK_TAB_BASE_Z_INDEX);
      this.currentZIndex.value = restoredZIndex;
      console.log('[QuickTabsManager] STEP 1: Z-index counter restored:', restoredZIndex);
    } catch (err) {
      console.warn('[QuickTabsManager] STEP 1: Z-index restore failed, using default:', err.message);
    }

    // v1.6.3.12 - FIX Issue #15: Start storage listener health monitoring
    try {
      const monitorStarted = startStorageListenerHealthMonitor();
      console.log('[QuickTabsManager] STEP 1: Storage health monitor:', monitorStarted ? 'started' : 'failed');
    } catch (err) {
      console.warn('[QuickTabsManager] STEP 1: Storage health monitor failed to start:', err.message);
    }

    console.log('[QuickTabsManager] STEP 1 Complete - currentTabId:', this.currentTabId);
  }

  /**
   * STEP 2: Initialize managers
   * @private
   */
  _initStep2_Managers() {
    console.log('[QuickTabsManager] STEP 2: Initializing managers...');
    this._initializeManagers();
    console.log('[QuickTabsManager] STEP 2 Complete');
  }

  /**
   * STEP 3: Initialize handlers
   * v1.6.3.2 - Made async to support CreateHandler.init() for loading settings
   * @private
   */
  async _initStep3_Handlers() {
    console.log('[QuickTabsManager] STEP 3: Initializing handlers...');
    await this._initializeHandlers();
    console.log('[QuickTabsManager] STEP 3 Complete');
  }

  /**
   * STEP 4: Initialize coordinators
   * @private
   */
  _initStep4_Coordinators() {
    console.log('[QuickTabsManager] STEP 4: Initializing coordinators...');
    this._initializeCoordinators();
    console.log('[QuickTabsManager] STEP 4 Complete');
  }

  /**
   * STEP 5: Setup managers (attach listeners)
   * @private
   */
  async _initStep5_Setup() {
    console.log('[QuickTabsManager] STEP 5: Setting up components...');
    await this._setupComponents();
    console.log('[QuickTabsManager] STEP 5 Complete');
  }

  /**
   * STEP 6: Hydrate state from storage (v1.6.3.4 - FIX Issues #1, #8)
   * v1.6.3.4 - Added hydration step: reads stored Quick Tabs and repopulates local state
   * @private
   */
  async _initStep6_Hydrate() {
    console.log('[QuickTabsManager] STEP 6: Attempting to hydrate state from storage...');
    const hydrationResult = await this._hydrateStateFromStorage();

    if (hydrationResult.success) {
      console.log(
        `[QuickTabsManager] STEP 6: Hydrated ${hydrationResult.count} Quick Tab(s) from storage`
      );
    } else {
      // v1.6.3.4 - FIX Issue #8: Log explicit WARNING when hydration is skipped
      console.warn(
        '[QuickTabsManager] STEP 6: ⚠️ WARNING - State hydration skipped or failed:',
        hydrationResult.reason
      );
    }
    console.log('[QuickTabsManager] STEP 6 Complete');
  }

  /**
   * Validate stored state from storage
   * v1.6.3.4 - Helper to reduce complexity
   * @private
   * @param {Object} storedState - State from storage
   * @returns {{valid: boolean, reason: string}}
   */
  _validateStoredState(storedState) {
    if (!storedState) {
      return { valid: false, reason: 'No stored state found (first run or cleared)' };
    }

    if (!storedState.tabs || !Array.isArray(storedState.tabs)) {
      return { valid: false, reason: 'Invalid stored state format (missing tabs array)' };
    }

    if (storedState.tabs.length === 0) {
      return { valid: false, reason: 'Stored state has empty tabs array (no tabs to restore)' };
    }

    return { valid: true, reason: '' };
  }

  /**
   * Hydrate tabs from stored state
   * v1.6.3.4 - Helper to reduce complexity
   * v1.6.3.6-v5 - FIX Cross-Tab State Contamination: Add comprehensive init logging
   * @private
   * @param {Array} tabs - Array of tab data from storage
   * @returns {number} Count of successfully hydrated tabs
   */
  _hydrateTabsFromStorage(tabs) {
    // v1.6.3.6-v5 - FIX: Track validation results for comprehensive logging
    const filterReasons = {
      invalidData: 0,
      noOriginTabId: 0,
      noCurrentTabId: 0,
      differentTab: 0,
      alreadyExists: 0,
      noHandler: 0,
      error: 0
    };

    let hydratedCount = 0;
    for (const tabData of tabs) {
      const result = this._safeHydrateTabWithReason(tabData, filterReasons);
      if (result.success) {
        hydratedCount++;
      }
    }

    // v1.6.3.6-v5 - FIX: Comprehensive init logging (single structured log)
    console.log('[QuickTabsManager] TAB SCOPE ISOLATION VALIDATION:', {
      total: tabs.length,
      passed: hydratedCount,
      filtered: tabs.length - hydratedCount,
      currentTabId: this.currentTabId,
      filterReasons
    });

    return hydratedCount;
  }

  /**
   * Safely hydrate a single tab with error handling and reason tracking
   * v1.6.3.6-v5 - FIX: Added reason tracking for comprehensive logging
   * @private
   * @param {Object} tabData - Tab data from storage
   * @param {Object} filterReasons - Object to track filter reasons
   * @returns {{success: boolean, reason: string}} Result with success flag and reason
   */
  _safeHydrateTabWithReason(tabData, filterReasons) {
    try {
      // Validate required fields
      if (!this._isValidTabData(tabData)) {
        // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for hydration FILTER
        console.log('[Content][Hydration] FILTER: Evaluating Quick Tab for hydration', {
          id: tabData?.id,
          originTabId: tabData?.originTabId,
          currentTabId: this.currentTabId,
          result: 'REJECT',
          reason: 'invalidData'
        });
        filterReasons.invalidData++;
        return { success: false, reason: 'invalidData' };
      }

      // Check tab scope validation with reason tracking
      const skipResult = this._checkTabScopeWithReason(tabData);
      if (skipResult.skip) {
        // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for hydration FILTER
        console.log('[Content][Hydration] FILTER: Evaluating Quick Tab for hydration', {
          id: tabData.id,
          originTabId: tabData.originTabId,
          currentTabId: this.currentTabId,
          result: 'REJECT',
          reason: skipResult.reason
        });
        filterReasons[skipResult.reason]++;
        return { success: false, reason: skipResult.reason };
      }

      // Skip if tab already exists
      if (this.tabs.has(tabData.id)) {
        // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for hydration FILTER
        console.log('[Content][Hydration] FILTER: Evaluating Quick Tab for hydration', {
          id: tabData.id,
          originTabId: tabData.originTabId,
          currentTabId: this.currentTabId,
          result: 'REJECT',
          reason: 'alreadyExists'
        });
        console.log('[QuickTabsManager] Tab already exists, skipping hydration:', tabData.id);
        filterReasons.alreadyExists++;
        return { success: false, reason: 'alreadyExists' };
      }

      // Skip if no createHandler available
      if (!this.createHandler) {
        console.warn('[QuickTabsManager] No createHandler available for hydration');
        filterReasons.noHandler++;
        return { success: false, reason: 'noHandler' };
      }

      // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for hydration FILTER (KEEP)
      console.log('[Content][Hydration] FILTER: Evaluating Quick Tab for hydration', {
        id: tabData.id,
        originTabId: tabData.originTabId,
        currentTabId: this.currentTabId,
        result: 'KEEP'
      });

      // Perform hydration
      console.log(
        `[QuickTabsManager] Hydrating tab: ${tabData.id} (minimized: ${tabData.minimized})`
      );
      const options = this._buildHydrationOptions(tabData);
      const optionsWithCallbacks = this._addHydrationCallbacks(options);

      if (options.minimized) {
        this._hydrateMinimizedTab(optionsWithCallbacks);
      } else {
        this._hydrateVisibleTab(optionsWithCallbacks);
      }
      return { success: true, reason: 'hydrated' };
    } catch (tabError) {
      console.error('[QuickTabsManager] Error hydrating individual tab:', tabData?.id, tabError);
      filterReasons.error++;
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Check if browser storage API is available
   * v1.6.3.6-v10 - Extracted to reduce _hydrateStateFromStorage complexity
   * @private
   * @returns {boolean} True if storage API is available
   */
  _isStorageApiAvailable() {
    return typeof browser !== 'undefined' && browser?.storage?.local;
  }

  /**
   * Emit hydrated event if tabs were restored
   * v1.6.3.6-v10 - Extracted to reduce _hydrateStateFromStorage complexity
   * @private
   * @param {number} hydratedCount - Number of tabs hydrated
   */
  _emitHydratedEventIfNeeded(hydratedCount) {
    if (hydratedCount > 0 && this.internalEventBus) {
      this.internalEventBus.emit('state:hydrated', { count: hydratedCount });
    }
  }

  /**
   * Hydrate Quick Tab state from browser.storage.local
   * v1.6.3.4 - FIX Issue #1: Restore Quick Tabs after page reload
   * v1.6.3.4-v8 - Extracted logging to reduce complexity
   * v1.6.3.6-v10 - Refactored: Extracted helpers to reduce cc from 9 to 6
   * v1.6.4.15 - FIX Issue #21: Detect and log domain changes during hydration
   * @private
   * @returns {Promise<{success: boolean, count: number, reason: string}>}
   */
  async _hydrateStateFromStorage() {
    // v1.6.4.15 - FIX Issue #21: Detect domain change at hydration time
    const currentDomain = this._getCurrentDomain();
    console.log('[HYDRATION_DOMAIN_CHECK] Current page domain:', {
      domain: currentDomain,
      url: typeof window !== 'undefined' ? window.location?.href : 'N/A',
      currentTabId: this.currentTabId
    });

    // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for hydration START
    console.log('[Content][Hydration] START: Beginning Quick Tab hydration process', {
      currentTabId: this.currentTabId,
      currentDomain,
      timestamp: Date.now()
    });

    // Check if browser storage API is available
    if (!this._isStorageApiAvailable()) {
      return { success: false, count: 0, reason: 'Storage API unavailable' };
    }

    try {
      const storedState = await this._readAndLogStorageState();

      // Validate stored state
      const validation = this._validateStoredState(storedState);
      if (!validation.valid) {
        return { success: false, count: 0, reason: validation.reason };
      }

      console.log(
        `[QuickTabsManager] Found ${storedState.tabs.length} Quick Tab(s) in storage to hydrate`
      );

      // Hydrate each stored tab
      const hydratedCount = this._hydrateTabsFromStorage(storedState.tabs);

      // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for hydration COMPLETE
      console.log('[Content][Hydration] COMPLETE: Hydration finished', {
        totalInStorage: storedState.tabs.length,
        hydratedCount: hydratedCount,
        filteredOutCount: storedState.tabs.length - hydratedCount,
        currentTabId: this.currentTabId
      });

      // Emit hydrated event for UICoordinator to render restored tabs
      this._emitHydratedEventIfNeeded(hydratedCount);

      return { success: true, count: hydratedCount, reason: 'Success' };
    } catch (error) {
      console.error('[QuickTabsManager] Storage hydration error:', error);
      return { success: false, count: 0, reason: `Storage error: ${error.message}` };
    }
  }

  /**
   * Read state from storage and log result
   * v1.6.3.4-v8 - FIX Issue #8: Extracted to reduce _hydrateStateFromStorage complexity
   * @private
   * @returns {Promise<Object|null>} Stored state or null
   */
  async _readAndLogStorageState() {
    console.log('[QuickTabsManager] Reading state from storage.local (key:', STATE_KEY, ')');

    const result = await browser.storage.local.get(STATE_KEY);
    const storedState = result[STATE_KEY];

    console.log('[QuickTabsManager] Storage read result:', {
      found: !!storedState,
      tabCount: storedState?.tabs?.length ?? 0,
      saveId: storedState?.saveId ?? 'none',
      transactionId: storedState?.transactionId ?? 'none'
    });

    return storedState;
  }

  /**
   * Default values for tab hydration
   * v1.6.3.4-v11 - Extracted to reduce _buildHydrationOptions complexity
   * v1.6.4 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   * @private
   * @type {Object}
   */
  static get HYDRATION_DEFAULTS() {
    return {
      title: 'Quick Tab',
      left: 100,
      top: 100,
      width: 400,
      height: 300,
      minimized: false,
      zIndex: CONSTANTS.QUICK_TAB_BASE_Z_INDEX
    };
  }

  /**
   * Apply default value if source value is null/undefined
   * v1.6.3.4-v11 - Helper to reduce _buildHydrationOptions complexity
   * @private
   * @param {*} value - Source value
   * @param {*} defaultValue - Default value
   * @returns {*} Value or default
   */
  _getWithDefault(value, defaultValue) {
    return value ?? defaultValue;
  }

  /**
   * Build options object for tab hydration
   * v1.6.3.4 - Helper to reduce complexity
   * v1.6.3.4-v11 - Refactored: extracted HYDRATION_DEFAULTS and _getWithDefault to reduce cc from 10 to ≤9
   * v1.6.3.10-v4 - FIX Issue #13: Include originTabId and originContainerId for container isolation
   * v1.6.4 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   * @private
   * @param {Object} tabData - Tab data from storage
   * @returns {Object} Options for createQuickTab
   */
  _buildHydrationOptions(tabData) {
    const defaults = QuickTabsManager.HYDRATION_DEFAULTS;

    return {
      id: tabData.id,
      url: tabData.url,
      title: tabData.title || defaults.title,
      left: this._getWithDefault(tabData.left, defaults.left),
      top: this._getWithDefault(tabData.top, defaults.top),
      width: this._getWithDefault(tabData.width, defaults.width),
      height: this._getWithDefault(tabData.height, defaults.height),
      minimized: this._getWithDefault(tabData.minimized, defaults.minimized),
      zIndex: this._getWithDefault(tabData.zIndex, defaults.zIndex),
      // v1.6.3.10-v4 - FIX Issue #13: Include originTabId and originContainerId for container isolation
      originTabId: tabData.originTabId ?? null,
      originContainerId: tabData.originContainerId ?? null,
      source: 'hydration'
    };
  }

  /**
   * Add callbacks to hydration options
   * v1.6.3.4 - Helper to reduce complexity
   * v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
   * v1.6.4 - Removed Solo/Mute callbacks
   * @private
   * @param {Object} options - Base options
   * @returns {Object} Options with callbacks
   */
  _addHydrationCallbacks(options) {
    return {
      ...options,
      // v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
      currentTabId: this.currentTabId,
      onDestroy: tabId => this.handleDestroy(tabId, 'UI'),
      onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height)
    };
  }

  /**
   * Validate tab data for hydration
   * v1.6.3.5-v2 - Extracted to reduce _hydrateTab complexity
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {boolean} True if valid
   */
  _isValidTabData(tabData) {
    if (!tabData?.id || !tabData?.url) {
      console.warn('[QuickTabsManager] Skipping invalid tab data (missing id or url):', tabData);
      return false;
    }
    return true;
  }

  /**
   * Get current page domain for navigation detection
   * v1.6.4.15 - FIX Issue #21: Helper for domain change detection during hydration
   * @private
   * @returns {string} Current domain or 'unknown' if not available
   */
  _getCurrentDomain() {
    try {
      if (typeof window !== 'undefined' && window.location?.hostname) {
        return window.location.hostname;
      }
      return 'unknown';
    } catch (err) {
      return 'unknown';
    }
  }

  /**
   * Extract domain from URL string
   * v1.6.4.15 - FIX Issue #21: Helper for URL domain extraction
   * @private
   * @param {string} url - URL string
   * @returns {string} Domain or 'unknown'
   */
  _extractDomainFromUrl(url) {
    try {
      if (!url || typeof url !== 'string') return 'unknown';
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (err) {
      return 'unknown';
    }
  }

  /**
   * Detect and log domain change between stored Quick Tab and current page
   * v1.6.4.15 - FIX Issue #21: Cross-domain navigation detection
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {{domainChanged: boolean, oldDomain: string, newDomain: string}}
   */
  _detectDomainChange(tabData) {
    const storedDomain = this._extractDomainFromUrl(tabData?.url);
    const currentDomain = this._getCurrentDomain();
    const domainChanged = storedDomain !== currentDomain && storedDomain !== 'unknown' && currentDomain !== 'unknown';
    
    if (domainChanged) {
      console.log('[NAVIGATION] Domain changed:', {
        oldDomain: storedDomain,
        newDomain: currentDomain,
        quickTabId: tabData?.id,
        storedUrl: tabData?.url
      });
    }
    
    return { domainChanged, oldDomain: storedDomain, newDomain: currentDomain };
  }

  /**
   * Extract browser tab ID from Quick Tab ID pattern
   * v1.6.3.6-v7 - FIX Issue #1: Fallback for orphaned Quick Tabs with null originTabId
   * Quick Tab ID format: qt-{tabId}-{timestamp}-{random}
   * @private
   * @param {string} quickTabId - Quick Tab ID to parse
   * @returns {number|null} Extracted tab ID or null if invalid format
   */
  _extractTabIdFromQuickTabId(quickTabId) {
    if (!quickTabId || typeof quickTabId !== 'string') return null;
    
    // v1.6.3.10-v10 - FIX Issue #4: Handle "qt-unknown-*" pattern
    // Check if the pattern contains "unknown" (no tab ID was available at creation time)
    if (quickTabId.startsWith('qt-unknown-')) {
      console.warn('[QuickTabsManager] v1.6.3.10-v10 PATTERN_EXTRACTION: "unknown" pattern detected', {
        quickTabId,
        warning: 'Quick Tab was created without valid tab ID',
        recommendation: 'Check explicit originTabId field in storage'
      });
      return null;
    }
    
    const match = quickTabId.match(/^qt-(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Check if tab should be filtered by originTabId (unified implementation with reason tracking)
   * v1.6.3.5-v2 - Extracted to reduce _hydrateTab complexity
   * v1.6.3.6-v5 - FIX Cross-Tab State Contamination: STRICT filtering - reject missing originTabId
   *              Consolidated to single implementation that tracks reasons
   * v1.6.3.6-v7 - FIX Issue #1: Add fallback to extract tab ID from Quick Tab ID pattern
   *              when originTabId is null but ID pattern matches current tab
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {{skip: boolean, reason: string}} Result with skip flag and reason
   */
  _checkTabScopeWithReason(tabData) {
    const hasOriginTabId = tabData.originTabId !== null && tabData.originTabId !== undefined;
    const hasCurrentTabId = this.currentTabId !== null && this.currentTabId !== undefined;

    // v1.6.3.6-v5 - FIX: If we don't have currentTabId, we CANNOT safely filter
    // Reject all tabs until we know our tab ID to prevent cross-tab contamination
    if (!hasCurrentTabId) {
      console.warn(
        '[QuickTabsManager] HYDRATION BLOCKED - No currentTabId set, cannot verify ownership:',
        {
          id: tabData.id,
          originTabId: tabData.originTabId,
          reason: 'currentTabId is null/undefined'
        }
      );
      return { skip: true, reason: 'noCurrentTabId' };
    }

    // v1.6.3.6-v7 - FIX Issue #1: If originTabId is missing, try to extract from Quick Tab ID
    // This recovers orphaned Quick Tabs that lost their originTabId but have it embedded in ID
    if (!hasOriginTabId) {
      const extractedTabId = this._extractTabIdFromQuickTabId(tabData.id);

      console.log('[QuickTabsManager] HYDRATION RECOVERY - Attempting tab ID extraction:', {
        id: tabData.id,
        extractedTabId,
        currentTabId: this.currentTabId,
        willRecover: extractedTabId === this.currentTabId
      });

      if (extractedTabId === this.currentTabId) {
        // v1.6.3.6-v7 - Recovery successful: ID pattern matches current tab
        // Patch the originTabId in-place so subsequent operations have correct value
        tabData.originTabId = extractedTabId;
        console.log(
          '[QuickTabsManager] HYDRATION RECOVERED - originTabId patched from ID pattern:',
          {
            id: tabData.id,
            patchedOriginTabId: extractedTabId
          }
        );
        return { skip: false, reason: 'recoveredFromIdPattern' };
      }

      // v1.6.3.6-v5 - FIX Cross-Tab State Contamination: Reject tabs with missing originTabId
      // that can't be recovered from ID pattern
      console.warn('[QuickTabsManager] HYDRATION BLOCKED - Orphaned Quick Tab, recovery failed:', {
        id: tabData.id,
        originTabId: tabData.originTabId,
        extractedTabId,
        currentTabId: this.currentTabId,
        url: tabData.url,
        reason: 'originTabId null and ID pattern does not match current tab'
      });
      return { skip: true, reason: 'noOriginTabId' };
    }

    const shouldRender = this._shouldRenderOnThisTab(tabData);
    if (!shouldRender) {
      console.log('[QuickTabsManager] Skipping hydration - tab originated from different tab:', {
        id: tabData.id,
        originTabId: tabData.originTabId,
        currentTabId: this.currentTabId
      });
      return { skip: true, reason: 'differentTab' };
    }
    return { skip: false, reason: 'passed' };
  }

  /**
   * Check if tab should be filtered by originTabId (boolean wrapper for legacy compatibility)
   * v1.6.3.6-v5 - Now wraps _checkTabScopeWithReason to avoid duplication
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {boolean} True if tab should be skipped (filtered out)
   */
  _shouldSkipDueToOriginTab(tabData) {
    return this._checkTabScopeWithReason(tabData).skip;
  }

  /**
   * Hydrate a single Quick Tab from stored data
   * v1.6.3.4 - FIX Issue #1: Helper to create Quick Tab from storage data
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Filter by originTabId for cross-tab isolation
   * Refactored to reduce complexity by extracting validation helpers
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {boolean} True if hydration succeeded
   */
  _hydrateTab(tabData) {
    // Validate required fields
    if (!this._isValidTabData(tabData)) return false;

    // v1.6.3.5-v2 - FIX Report 1 Issue #2: Filter by originTabId
    if (this._shouldSkipDueToOriginTab(tabData)) return false;

    // Skip if tab already exists
    if (this.tabs.has(tabData.id)) {
      console.log('[QuickTabsManager] Tab already exists, skipping hydration:', tabData.id);
      return false;
    }

    // Skip if no createHandler available
    if (!this.createHandler) {
      console.warn('[QuickTabsManager] No createHandler available for hydration');
      return false;
    }

    console.log(
      `[QuickTabsManager] Hydrating tab: ${tabData.id} (minimized: ${tabData.minimized})`
    );

    const options = this._buildHydrationOptions(tabData);
    const optionsWithCallbacks = this._addHydrationCallbacks(options);

    // Route to appropriate handler based on minimized state
    if (options.minimized) {
      this._hydrateMinimizedTab(optionsWithCallbacks);
    } else {
      this._hydrateVisibleTab(optionsWithCallbacks);
    }
    return true;
  }

  /**
   * Determine if a Quick Tab should render on this tab
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Cross-tab filtering logic
   * @private
   * @param {Object} tabData - Quick Tab data
   * @returns {boolean} True if should render
   */
  /**
   * Check if container IDs match (container isolation) during hydration
   * v1.6.3.10-v4 - FIX Issue #13: Extract to reduce _shouldRenderOnThisTab complexity
   * @private
   * @param {Object} tabData - Tab data from storage
   * @returns {boolean} True if container check passes (or not applicable)
   */
  _checkContainerIsolationForHydration(tabData) {
    const originContainerId = tabData.originContainerId;

    // If no container context was set, skip container check
    if (originContainerId === null || originContainerId === undefined) {
      return true;
    }

    // Get current container context (default to 'firefox-default' if not set)
    const currentContainerId = this.cookieStoreId ?? 'firefox-default';

    if (originContainerId !== currentContainerId) {
      console.log('[QuickTabsManager] CONTAINER BLOCKED during hydration:', {
        id: tabData.id,
        originContainerId,
        currentContainerId,
        originTabId: tabData.originTabId
      });
      return false;
    }

    console.log('[QuickTabsManager] Container check PASSED during hydration:', {
      id: tabData.id,
      originContainerId,
      currentContainerId
    });

    return true;
  }

  /**
   * Determine if a Quick Tab should render on this tab
   * v1.6.3.5-v2 - FIX Report 1 Issue #2: Cross-tab filtering logic
   * v1.6.3.10-v4 - FIX Issue #13: Add container isolation check
   * v1.6.4 - Simplified: Solo/Mute removed, only check originTabId and container
   * @private
   * @param {Object} tabData - Quick Tab data
   * @returns {boolean} True if should render
   */
  _shouldRenderOnThisTab(tabData) {
    const currentTabId = this.currentTabId;
    const originTabId = tabData.originTabId;

    // Check originTabId match
    if (originTabId !== currentTabId) {
      return false;
    }

    // v1.6.3.10-v4 - FIX Issue #13: Container isolation check
    if (!this._checkContainerIsolationForHydration(tabData)) {
      return false;
    }

    // Default: passed all checks
    return true;
  }

  /**
   * Hydrate a visible (non-minimized) Quick Tab
   * v1.6.3.4 - Helper to reduce complexity
   * v1.6.3.4-v7 - FIX Issue #7: Emit state:added after creation for UICoordinator tracking
   * @private
   * @param {Object} options - Quick Tab options with callbacks
   */
  _hydrateVisibleTab(options) {
    const result = this.createHandler.create(options);
    if (result) {
      this.currentZIndex.value = result.newZIndex;

      // v1.6.3.4-v7 - FIX Issue #7: Emit state:added so UICoordinator can track
      if (this.internalEventBus && result.tabWindow) {
        this.internalEventBus.emit('state:added', {
          quickTab: {
            id: options.id,
            url: options.url,
            title: options.title,
            minimized: false,
            position: { left: options.left, top: options.top },
            size: { width: options.width, height: options.height },
            zIndex: result.newZIndex
          }
        });
      }
    }
  }

  /**
   * Hydrate a minimized Quick Tab (create real instance but don't render)
   * v1.6.3.4 - FIX Issue #1: Handle minimized tabs during hydration
   * v1.6.3.4-v7 - FIX Issue #1 CRITICAL: Create REAL QuickTabWindow instance, not plain object
   *   The old approach created plain objects that lacked all QuickTabWindow methods.
   *   When restore/minimize was called, the methods didn't exist causing 100% failure rate.
   *   Now we create a real instance with minimized=true that has all methods but no DOM.
   * v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
   * v1.6.3.10-v4 - FIX Issue #13: Pass originTabId and originContainerId for container isolation
   * @private
   * @param {Object} options - Quick Tab options
   */
  _hydrateMinimizedTab(options) {
    console.log('[QuickTabsManager] Hydrating minimized tab (dormant mode, no DOM):', options.id);

    try {
      // v1.6.3.4-v7 - FIX Issue #1: Create REAL QuickTabWindow instance
      // NOTE: We use `new QuickTabWindow()` directly instead of `createQuickTabWindow()` factory
      // because the factory calls render() which we DON'T want for minimized tabs.
      // The instance exists with all methods but no DOM attached (minimized=true)
      // v1.6.4 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
      const tabWindow = new QuickTabWindow({
        id: options.id,
        url: options.url,
        title: options.title,
        left: options.left,
        top: options.top,
        width: options.width,
        height: options.height,
        minimized: true,
        zIndex: options.zIndex,
        // v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
        currentTabId: this.currentTabId,
        // v1.6.3.10-v4 - FIX Issue #13: Pass originTabId and originContainerId for container isolation
        originTabId: options.originTabId ?? this.currentTabId,
        originContainerId: options.originContainerId ?? this.cookieStoreId,
        // Wire up callbacks - these persist through restore cycles
        // v1.6.4 - Removed Solo/Mute callbacks
        onDestroy: tabId => this.handleDestroy(tabId, 'UI'),
        onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
        onFocus: tabId => this.handleFocus(tabId),
        onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
        onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
        onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
        onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height)
      });

      // v1.6.3.4-v7 - Log instance type to confirm real QuickTabWindow
      // v1.6.3.10-v4 - FIX Issue #13: Include container ID in logging
      console.log('[QuickTabsManager] Created real QuickTabWindow instance:', {
        id: options.id,
        constructorName: tabWindow.constructor.name,
        hasRender: typeof tabWindow.render === 'function',
        hasMinimize: typeof tabWindow.minimize === 'function',
        hasRestore: typeof tabWindow.restore === 'function',
        hasDestroy: typeof tabWindow.destroy === 'function',
        minimized: tabWindow.minimized,
        url: tabWindow.url,
        originTabId: tabWindow.originTabId,
        originContainerId: tabWindow.originContainerId
      });

      // Store snapshot in minimizedManager for later restore
      if (this.minimizedManager) {
        this.minimizedManager.add(options.id, tabWindow);
        console.log('[QuickTabsManager] Added to minimizedManager:', options.id);
      }

      // Store in tabs Map - now a REAL QuickTabWindow instance with all methods
      this.tabs.set(options.id, tabWindow);

      // v1.6.3.4-v7 - FIX Issue #7: Emit state:added so UICoordinator can track this tab
      if (this.internalEventBus) {
        this.internalEventBus.emit('state:added', {
          quickTab: {
            id: options.id,
            url: options.url,
            title: options.title,
            minimized: true,
            position: { left: options.left, top: options.top },
            size: { width: options.width, height: options.height },
            zIndex: options.zIndex
          }
        });
      }
    } catch (err) {
      console.error('[QuickTabsManager] Failed to create QuickTabWindow for hydration:', {
        id: options.id,
        url: options.url,
        error: err.message
      });
      // Don't add to map if creation fails - prevents fake objects
    }
  }

  /**
   * STEP 7: Expose manager globally
   * @private
   */
  _initStep7_Expose() {
    console.log('[QuickTabsManager] STEP 7: Exposing manager globally...');
    if (typeof window !== 'undefined') {
      window.quickTabsManager = this;
      window.__quickTabsManager = this;
      console.log('[QuickTabsManager] Manager exposed globally as window.quickTabsManager');
      console.log('[QuickTabsManager] Current tab ID available:', this.currentTabId);
    }
    console.log('[QuickTabsManager] STEP 7 Complete');
  }

  /**
   * Initialize manager components
   * v1.6.3 - Removed StorageManager (no persistence)
   * @private
   */
  _initializeManagers() {
    this.state = new StateManager(this.internalEventBus, this.currentTabId);
    this.events = new EventManager(this.internalEventBus, this.tabs);

    // Initialize MemoryGuard for emergency shutdown
    this.memoryGuard = new MemoryGuard({
      eventBus: this.internalEventBus,
      extensionThresholdMB: 1000,
      browserThresholdMB: 20000,
      checkIntervalMs: 1000
    });

    // Configure emergency shutdown callback
    this.memoryGuard.onEmergencyShutdown = (reason, memoryMB) => {
      console.error(
        '[QuickTabsManager] MemoryGuard triggered emergency shutdown:',
        reason,
        memoryMB
      );
      this._handleEmergencyShutdown(reason, memoryMB);
    };
  }

  /**
   * Handle emergency shutdown triggered by MemoryGuard
   * @private
   * @param {string} reason - Shutdown reason
   * @param {number} memoryMB - Memory usage at shutdown
   */
  _handleEmergencyShutdown(reason, memoryMB) {
    console.error('[QuickTabsManager] ⚠️ EMERGENCY SHUTDOWN ⚠️', { reason, memoryMB });

    try {
      // Emit event for external handlers
      this.eventBus?.emit('quick-tabs:emergency-shutdown', {
        reason,
        memoryMB,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[QuickTabsManager] Error during emergency shutdown:', error);
    }
  }

  /**
   * Initialize handler components
   * v1.6.3 - Simplified handlers (no storage/sync)
   * v1.6.3.2 - Made async to initialize CreateHandler settings
   * v1.6.3.11-v10 - FIX Issue #12: Pass internalEventBus to CreateHandler for UICoordinator communication
   * @private
   */
  async _initializeHandlers() {
    // v1.6.3.11-v10 - FIX Issue #12: Pass internalEventBus as 8th parameter
    // CreateHandler needs internalEventBus to emit window:created events that UICoordinator will receive
    // Previously, CreateHandler only had eventBus (external) which UICoordinator doesn't listen to
    this.createHandler = new CreateHandler(
      this.tabs,
      this.currentZIndex,
      this.cookieStoreId,
      this.eventBus,
      this.Events,
      this.generateId.bind(this),
      this.windowFactory,
      this.internalEventBus // v1.6.3.11-v10 - FIX Issue #12: Pass for window:created events
    );

    // v1.6.3.2 - Initialize CreateHandler to load debug settings
    await this.createHandler.init();

    this.updateHandler = new UpdateHandler(this.tabs, this.internalEventBus, this.minimizedManager);

    this.visibilityHandler = new VisibilityHandler({
      quickTabsMap: this.tabs,
      minimizedManager: this.minimizedManager,
      eventBus: this.internalEventBus,
      currentZIndex: this.currentZIndex,
      currentTabId: this.currentTabId,
      Events: this.Events
    });

    // v1.6.3.10-v4 - FIX Issue #16: Pass currentTabId for cross-tab validation
    this.destroyHandler = new DestroyHandler(
      this.tabs,
      this.minimizedManager,
      this.internalEventBus, // v1.6.3.3 - FIX Bug #6: Use internal bus for state:deleted so UICoordinator receives it
      this.currentZIndex,
      this.Events,
      CONSTANTS.QUICK_TAB_BASE_Z_INDEX,
      this.currentTabId // v1.6.3.10-v4 - FIX Issue #16: Pass for cross-tab validation
    );
  }

  /**
   * Initialize coordinator components
   * v1.6.3 - Removed SyncCoordinator
   * v1.6.3.4 - Removed PanelManager (floating panel removed, sidebar-only)
   * v1.6.3.5-v10 - FIX Issue #1-2: Pass currentTabId and set handlers after creation
   * @private
   */
  _initializeCoordinators() {
    // v1.6.3.10-v4 - FIX Issue #13: Pass cookieStoreId (container ID) to UICoordinator for container isolation
    this.uiCoordinator = new UICoordinator(
      this.state,
      this.minimizedManager,
      null, // panelManager removed in v1.6.3.4
      this.internalEventBus,
      this.currentTabId, // v1.6.3.5-v10 - Pass currentTabId for cross-tab filtering
      {}, // handlers - will be set below
      this.cookieStoreId // v1.6.3.10-v4 - FIX Issue #13: Pass container ID for Firefox Multi-Account Container isolation
    );

    // v1.6.3.5-v10 - FIX Issue #1-2: Set handlers for callback wiring during _createWindow()
    // Handlers are already initialized in _initStep3_Handlers before this step
    this.uiCoordinator.setHandlers({
      updateHandler: this.updateHandler,
      visibilityHandler: this.visibilityHandler,
      destroyHandler: this.destroyHandler
    });
  }

  /**
   * Setup component listeners and event flows
   * v1.6.3 - Simplified (no storage/sync setup)
   * v1.6.3.3 - FIX Bug #5: Setup event bridge after UI coordinator init
   * @private
   */
  async _setupComponents() {
    console.log('[QuickTabsManager] _setupComponents starting...');

    this.events.setupEmergencySaveHandlers();
    await this.uiCoordinator.init();

    // v1.6.3.3 - FIX Bug #5: Bridge internal events to external bus
    this._setupEventBridge();

    // Start memory monitoring
    if (this.memoryGuard) {
      this.memoryGuard.startMonitoring();
      console.log('[QuickTabsManager] MemoryGuard monitoring started');
    }

    console.log('[QuickTabsManager] ✓ _setupComponents complete');
  }

  /**
   * Bridge internal events to external event bus
   * v1.6.3.3 - FIX Bug #5: Bridge internal events for components that may listen on external bus
   * v1.6.3.4 - NOTE: PanelContentManager now uses internalEventBus directly, but we maintain
   *            this bridge for backward compatibility and any other components using external bus
   * @private
   */
  _setupEventBridge() {
    if (!this.internalEventBus || !this.eventBus) {
      console.warn('[QuickTabsManager] Cannot setup event bridge - missing event bus(es)');
      return;
    }

    // Bridge internal state:updated events to external bus
    this.internalEventBus.on('state:updated', data => {
      this.eventBus.emit('state:updated', data);
      console.log('[QuickTabsManager] Bridged state:updated to external bus');
    });

    // Bridge internal state:deleted events to external bus
    this.internalEventBus.on('state:deleted', data => {
      this.eventBus.emit('state:deleted', data);
      console.log('[QuickTabsManager] Bridged state:deleted to external bus');
    });

    // Bridge internal state:created events to external bus
    this.internalEventBus.on('state:created', data => {
      this.eventBus.emit('state:created', data);
      console.log('[QuickTabsManager] Bridged state:created to external bus');
    });

    // Bridge internal state:added events to external bus (for panel updates)
    this.internalEventBus.on('state:added', data => {
      this.eventBus.emit('state:added', data);
      console.log('[QuickTabsManager] Bridged state:added to external bus');
    });

    // v1.6.3.4 - Bridge internal state:hydrated events to external bus (cross-tab sync)
    this.internalEventBus.on('state:hydrated', data => {
      this.eventBus.emit('state:hydrated', data);
      console.log('[QuickTabsManager] Bridged state:hydrated to external bus');
    });

    // v1.6.3.4 - Bridge internal state:cleared events to external bus (Clear Storage button)
    this.internalEventBus.on('state:cleared', data => {
      this.eventBus.emit('state:cleared', data);
      console.log('[QuickTabsManager] Bridged state:cleared to external bus');
    });

    console.log('[QuickTabsManager] ✓ Event bridge setup complete');
  }

  /**
   * Check if container response is valid
   * v1.6.3.6-v10 - Extracted to reduce complex conditional
   * @private
   * @param {Object} response - Response from background script
   * @returns {boolean} True if response has valid container data
   */
  _isValidContainerResponse(response) {
    return response && response.success && response.cookieStoreId;
  }

  /**
   * Detect Firefox container context
   */
  async detectContainerContext() {
    try {
      const response = await browser.runtime.sendMessage({
        action: 'GET_CONTAINER_CONTEXT'
      });

      if (this._isValidContainerResponse(response)) {
        this.cookieStoreId = response.cookieStoreId;
        console.log('[QuickTabsManager] Detected container:', this.cookieStoreId);
        return true;
      } else {
        console.error(
          '[QuickTabsManager] Failed to get container from background:',
          response?.error
        );
        this.cookieStoreId = 'firefox-default';
        return false;
      }
    } catch (err) {
      console.error('[QuickTabsManager] Failed to detect container:', err);
      this.cookieStoreId = 'firefox-default';
      return false;
    }
  }

  /**
   * Get current container context (backward compat)
   */
  async getCurrentContainer() {
    try {
      const response = await browser.runtime.sendMessage({
        action: 'GET_CONTAINER_CONTEXT'
      });

      if (this._isValidContainerResponse(response)) {
        return response.cookieStoreId;
      }
      return this.cookieStoreId || 'firefox-default';
    } catch (err) {
      console.error('[QuickTabsManager] Failed to get current container:', err);
      return this.cookieStoreId || 'firefox-default';
    }
  }

  /**
   * Detect current Firefox tab ID
   */
  async detectCurrentTabId() {
    try {
      const response = await browser.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' });
      if (response && response.tabId) {
        this.currentTabId = response.tabId;
        console.log('[QuickTabsManager] Detected current tab ID:', this.currentTabId);
      }
    } catch (err) {
      console.error('[QuickTabsManager] Failed to detect tab ID:', err);
    }
  }

  // ============================================================================
  // PUBLIC API - Delegate to handlers and coordinators
  // ============================================================================

  /**
   * Create a new Quick Tab
   * Delegates to CreateHandler
   * v1.6.3.4 - FIX Issue #4: Wire UI close button to DestroyHandler via onDestroy callback
   * v1.6.3.4 - FIX Issue #6: Add source tracking for logs
   * v1.6.4 - Removed Solo/Mute callbacks
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] createQuickTab called with:', options);

    // Add callbacks to options (required by QuickTabWindow)
    // v1.6.3.4 - FIX Issue #4: onDestroy callback now routes to DestroyHandler
    // v1.6.3.4 - FIX Issue #6: Source defaults to 'UI' for window callbacks
    // v1.6.3.5-v2 - FIX Report 1 Issue #2: Set originTabId for cross-tab filtering
    // v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
    // v1.6.4 - Removed Solo/Mute callbacks
    const optionsWithCallbacks = {
      ...options,
      originTabId: options.originTabId ?? this.currentTabId, // v1.6.3.5-v2
      currentTabId: this.currentTabId, // v1.6.3.5-v5 - FIX Issue #2: Pass for visibility checks
      onDestroy: tabId => this.handleDestroy(tabId, 'UI'),
      onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height)
    };

    const result = this.createHandler.create(optionsWithCallbacks);

    if (!result) {
      throw new Error('[QuickTabsManager] createHandler.create() returned undefined');
    }

    this.currentZIndex.value = result.newZIndex;
    return result.tabWindow;
  }

  /**
   * Handle Quick Tab destruction
   * v1.6.3.4 - FIX Issue #4: All closes (UI and Manager) now route through DestroyHandler
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   */
  handleDestroy(id, source = 'unknown') {
    console.log(`[QuickTabsManager] handleDestroy called for: ${id} (source: ${source})`);
    return this.destroyHandler.handleDestroy(id, source);
  }

  /**
   * Handle Quick Tab minimize
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   */
  handleMinimize(id, source = 'unknown') {
    console.log(`[QuickTabsManager] handleMinimize called for: ${id} (source: ${source})`);
    return this.visibilityHandler.handleMinimize(id, source);
  }

  /**
   * Handle Quick Tab focus
   */
  handleFocus(id) {
    return this.visibilityHandler.handleFocus(id);
  }

  /**
   * Handle position change (during drag)
   */
  handlePositionChange(id, left, top) {
    return this.updateHandler.handlePositionChange(id, left, top);
  }

  /**
   * Handle position change end (drag complete)
   */
  handlePositionChangeEnd(id, left, top) {
    return this.updateHandler.handlePositionChangeEnd(id, left, top);
  }

  /**
   * Handle size change (during resize)
   */
  handleSizeChange(id, width, height) {
    return this.updateHandler.handleSizeChange(id, width, height);
  }

  /**
   * Handle size change end (resize complete)
   */
  handleSizeChangeEnd(id, width, height) {
    return this.updateHandler.handleSizeChangeEnd(id, width, height);
  }

  /**
   * Close Quick Tab by ID
   */
  closeById(id) {
    return this.destroyHandler.closeById(id);
  }

  /**
   * Close all Quick Tabs
   */
  closeAll() {
    return this.destroyHandler.closeAll();
  }

  /**
   * Restore Quick Tab from minimized state
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   */
  restoreQuickTab(id, source = 'unknown') {
    console.log(`[QuickTabsManager] restoreQuickTab called for: ${id} (source: ${source})`);
    return this.visibilityHandler.restoreQuickTab(id, source);
  }

  /**
   * Minimize Quick Tab by ID (backward compat)
   * v1.6.3.4 - FIX Issue #6: Add source parameter
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  minimizeById(id, source = 'unknown') {
    return this.handleMinimize(id, source);
  }

  /**
   * Restore Quick Tab by ID (backward compat)
   * v1.6.3.4 - FIX Issue #6: Add source parameter
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  restoreById(id, source = 'unknown') {
    return this.visibilityHandler.restoreById(id, source);
  }

  /**
   * Get Quick Tab by ID (backward compat)
   */
  getQuickTab(id) {
    return this.tabs.get(id);
  }

  /**
   * Get all Quick Tabs (backward compat)
   */
  getAllQuickTabs() {
    return Array.from(this.tabs.values());
  }

  /**
   * Get minimized Quick Tabs (backward compat)
   */
  getMinimizedQuickTabs() {
    return this.minimizedManager.getAll();
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Generate cryptographically secure random string
   * Uses crypto.getRandomValues() for better entropy than Math.random()
   * Falls back to Math.random() if crypto is unavailable
   * @private
   * @returns {string} Random string (~13 characters)
   */
  _generateSecureRandom() {
    // Use Web Crypto API if available (preferred)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint32Array(2); // 2 * 32 bits = 64 bits of entropy
      crypto.getRandomValues(array);
      return array[0].toString(36) + array[1].toString(36);
    }

    // Fallback to Math.random() for older environments
    console.warn(
      '[QuickTabsManager] crypto.getRandomValues unavailable, using Math.random fallback'
    );
    return (
      Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11)
    );
  }

  /**
   * Generate a candidate ID for Quick Tab
   * Format: qt-{tabId}-{timestamp}-{secureRandom}
   * @private
   * @returns {string} Candidate ID
   */
  _generateIdCandidate() {
    const tabId = this.currentTabId || 'unknown';
    const timestamp = Date.now();
    const random = this._generateSecureRandom();
    
    // v1.6.3.10-v10 - FIX Issue #3: Log warning when generating ID with unknown tab ID
    if (tabId === 'unknown') {
      console.warn('[QuickTabsManager] v1.6.3.10-v10 QUICKTAB_ID_UNKNOWN:', {
        warning: 'Generating Quick Tab ID with unknown tabId',
        currentTabId: this.currentTabId,
        timestamp,
        recommendation: 'Tab ID should be acquired before Quick Tab creation'
      });
    }
    
    return `qt-${tabId}-${timestamp}-${random}`;
  }

  /**
   * Generate unique ID for Quick Tab with collision detection
   * Uses cryptographically secure random and includes tab ID for cross-tab uniqueness
   * @param {number} maxRetries - Maximum number of retry attempts (default: CONSTANTS.MAX_ID_GENERATION_RETRIES)
   * @returns {string} Unique Quick Tab ID
   */
  generateId(maxRetries = CONSTANTS.MAX_ID_GENERATION_RETRIES) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const id = this._generateIdCandidate();

      // Check local tabs Map and generated IDs Set for collisions
      if (!this.tabs.has(id) && !this.generatedIds.has(id)) {
        this.generatedIds.add(id);
        return id;
      }

      console.warn(
        `[QuickTabsManager] ID collision detected: ${id}, retrying... (${attempt + 1}/${maxRetries})`
      );
    }

    // Fallback: add extra entropy with collision marker
    const fallbackId = `qt-${this.currentTabId || 'unknown'}-${Date.now()}-${this._generateSecureRandom()}-collision`;
    console.error(
      `[QuickTabsManager] Failed to generate unique ID after ${maxRetries} attempts, using fallback: ${fallbackId}`
    );
    this.generatedIds.add(fallbackId);
    return fallbackId;
  }

  // ============================================================================
  // LEGACY METHODS (kept for backward compatibility)
  // ============================================================================

  /**
   * Update Quick Tab position (legacy)
   * @deprecated v1.6.3.5-v5 - FIX Issue #5: This method bypasses UpdateHandler validation.
   * Use handlePositionChange/handlePositionChangeEnd instead.
   */
  updateQuickTabPosition(id, left, top) {
    console.warn(
      '[QuickTabsManager] DEPRECATED: updateQuickTabPosition() bypasses UpdateHandler. Use handlePositionChange/handlePositionChangeEnd instead.'
    );
    return this.handlePositionChange(id, left, top);
  }

  /**
   * Update Quick Tab size (legacy)
   * @deprecated v1.6.3.5-v5 - FIX Issue #5: This method bypasses UpdateHandler validation.
   * Use handleSizeChange/handleSizeChangeEnd instead.
   */
  updateQuickTabSize(id, width, height) {
    console.warn(
      '[QuickTabsManager] DEPRECATED: updateQuickTabSize() bypasses UpdateHandler. Use handleSizeChange/handleSizeChangeEnd instead.'
    );
    return this.handleSizeChange(id, width, height);
  }

  // ============================================================================
  // LIFECYCLE METHODS
  // ============================================================================

  /**
   * Stop MemoryGuard monitoring during teardown
   * v1.6.3.6-v10 - Extracted to reduce destroy() complexity
   * @private
   */
  _destroyStep1_StopMemoryGuard() {
    if (this.memoryGuard?.stopMonitoring) {
      console.log('[QuickTabsManager] Stopping MemoryGuard monitoring');
      this.memoryGuard.stopMonitoring();
    }
  }

  /**
   * Remove storage listener via CreateHandler during teardown
   * v1.6.3.6-v10 - Extracted to reduce destroy() complexity
   * @private
   */
  _destroyStep2_RemoveStorageListener() {
    if (this.createHandler?.destroy) {
      console.log('[QuickTabsManager] Calling createHandler.destroy() to remove storage listener');
      this.createHandler.destroy();
    }
  }

  /**
   * Close all Quick Tabs during teardown
   * v1.6.3.6-v10 - Extracted to reduce destroy() complexity
   * @private
   */
  _destroyStep3_CloseAllTabs() {
    if (this.tabs.size > 0) {
      console.log(`[QuickTabsManager] Closing ${this.tabs.size} Quick Tab(s)`);
      this.closeAll();
    }
  }

  /**
   * Remove all event listeners during teardown
   * v1.6.3.6-v10 - Extracted to reduce destroy() complexity
   * @private
   */
  _destroyStep4_RemoveEventListeners() {
    if (this.internalEventBus?.removeAllListeners) {
      console.log('[QuickTabsManager] Removing all event listeners from internalEventBus');
      this.internalEventBus.removeAllListeners();
    }
  }

  /**
   * Cleanup and teardown the QuickTabsManager
   * v1.6.3.4-v11 - FIX Issue #1, #2, #3: Proper resource cleanup to prevent memory leaks
   * v1.6.3.6-v10 - Refactored: Extracted steps to helper methods to reduce cc from 9 to 2
   *
   * This method:
   * - Stops MemoryGuard monitoring
   * - Removes storage.onChanged listener via CreateHandler.destroy()
   * - Closes all Quick Tabs (DOM cleanup)
   * - Removes all event listeners from internalEventBus
   * - Marks manager as uninitialized
   *
   * This method is idempotent - safe to call multiple times.
   *
   * @returns {void}
   */
  destroy() {
    // Guard: Only cleanup if initialized
    if (!this.initialized) {
      console.log('[QuickTabsManager] destroy() called but not initialized, skipping');
      return;
    }

    console.log('[QuickTabsManager] Starting cleanup/teardown...');

    this._destroyStep1_StopMemoryGuard();
    this._destroyStep2_RemoveStorageListener();
    this._destroyStep3_CloseAllTabs();
    this._destroyStep4_RemoveEventListeners();

    // Step 5: Mark as uninitialized
    this.initialized = false;

    console.log('[QuickTabsManager] ✓ Cleanup/teardown complete');
  }
}

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

let quickTabsManagerInstance = null;

/**
 * Initialize Quick Tabs feature module
 *
 * @param {EventEmitter} eventBus - External event bus from content.js
 * @param {Object} Events - Event constants
 * @param {Object} options - Optional configuration (for testing)
 * @param {number} [options.currentTabId] - v1.6.3.5-v10: Current tab ID from content script (pre-fetched from background)
 * @returns {QuickTabsManager} Initialized manager instance
 */
export async function initQuickTabs(eventBus, Events, options = {}) {
  console.log('[QuickTabs] Initializing Quick Tabs feature module...');
  console.log('[QuickTabs] Options received:', {
    currentTabId: options.currentTabId,
    forceNew: options.forceNew,
    hasWindowFactory: !!options.windowFactory
  });

  if (options.forceNew || !quickTabsManagerInstance) {
    console.log('[QuickTabs] Creating new QuickTabsManager instance with options:', options);
    quickTabsManagerInstance = new QuickTabsManager(options);
  } else if (options.windowFactory) {
    console.log('[QuickTabs] Updating windowFactory on existing instance');
    quickTabsManagerInstance.windowFactory = options.windowFactory;
  }

  // v1.6.3.5-v10 - FIX Issue #3: Pass currentTabId from options to init()
  // This is already available from content.js which got it from background
  await quickTabsManagerInstance.init(eventBus, Events, options);
  console.log('[QuickTabs] Quick Tabs feature module initialized');
  return quickTabsManagerInstance;
}

export { QuickTabsManager };
