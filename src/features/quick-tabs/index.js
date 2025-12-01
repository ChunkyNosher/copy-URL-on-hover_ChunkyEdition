/**
 * Quick Tabs Feature Module - REFACTORED FACADE
 * Main entrypoint for Quick Tabs functionality
 *
 * v1.6.0 - PHASE 2.2: Facade pattern implementation
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.4 - FIX Issues #1, #8: Add state rehydration on startup with explicit logging
 * v1.6.3.4-v7 - FIX Issue #1: Hydration creates real QuickTabWindow instances
 *
 * Architecture:
 * - Facade orchestrates managers, handlers, and coordinators
 * - Maintains backward compatibility with legacy API
 * - Delegates all business logic to specialized components
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
import { STATE_KEY } from '../../utils/storage-utils.js';

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
   */
  async init(eventBus, Events) {
    if (this.initialized) {
      console.log('[QuickTabsManager] Already initialized, skipping');
      return;
    }

    this.eventBus = eventBus;
    this.Events = Events;
    console.log('[QuickTabsManager] Initializing facade...');

    try {
      await this._initStep1_Context();
      this._initStep2_Managers();
      await this._initStep3_Handlers(); // v1.6.3.2 - Made async for CreateHandler settings
      this._initStep4_Coordinators();
      await this._initStep5_Setup();
      await this._initStep6_Hydrate(); // v1.6.3.4 - FIX Issue #1: Hydrate state from storage
      this._initStep7_Expose();

      this.initialized = true;
      console.log('[QuickTabsManager] ✓✓✓ Facade initialized successfully ✓✓✓');
    } catch (err) {
      console.error('[QuickTabsManager] ❌❌❌ INITIALIZATION FAILED ❌❌❌');
      console.error('[QuickTabsManager] Error details:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        type: typeof err,
        error: err
      });
      throw err;
    }
  }

  /**
   * STEP 1: Detect context (container, tab ID)
   * @private
   */
  async _initStep1_Context() {
    console.log('[QuickTabsManager] STEP 1: Detecting container context...');
    const containerDetected = await this.detectContainerContext();
    if (!containerDetected) {
      console.warn('[QuickTabsManager] Container detection failed, using default container');
    }
    console.log('[QuickTabsManager] STEP 1: Detecting tab ID...');
    await this.detectCurrentTabId();
    console.log('[QuickTabsManager] STEP 1 Complete');
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
      console.log(`[QuickTabsManager] STEP 6: Hydrated ${hydrationResult.count} Quick Tab(s) from storage`);
    } else {
      // v1.6.3.4 - FIX Issue #8: Log explicit WARNING when hydration is skipped
      console.warn('[QuickTabsManager] STEP 6: ⚠️ WARNING - State hydration skipped or failed:', hydrationResult.reason);
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
   * @private
   * @param {Array} tabs - Array of tab data from storage
   * @returns {number} Count of successfully hydrated tabs
   */
  _hydrateTabsFromStorage(tabs) {
    let hydratedCount = 0;
    for (const tabData of tabs) {
      const success = this._safeHydrateTab(tabData);
      if (success) hydratedCount++;
    }
    return hydratedCount;
  }

  /**
   * Safely hydrate a single tab with error handling
   * v1.6.3.4 - Helper to reduce nesting depth
   * @private
   * @param {Object} tabData - Tab data from storage
   * @returns {boolean} True if successful
   */
  _safeHydrateTab(tabData) {
    try {
      return this._hydrateTab(tabData);
    } catch (tabError) {
      console.error('[QuickTabsManager] Error hydrating individual tab:', tabData?.id, tabError);
      return false;
    }
  }

  /**
   * Hydrate Quick Tab state from browser.storage.local
   * v1.6.3.4 - FIX Issue #1: Restore Quick Tabs after page reload
   * v1.6.3.4-v8 - Extracted logging to reduce complexity
   * @private
   * @returns {Promise<{success: boolean, count: number, reason: string}>}
   */
  async _hydrateStateFromStorage() {
    // Check if browser storage API is available
    if (typeof browser === 'undefined' || !browser?.storage?.local) {
      return { success: false, count: 0, reason: 'Storage API unavailable' };
    }

    try {
      const storedState = await this._readAndLogStorageState();

      // Validate stored state
      const validation = this._validateStoredState(storedState);
      if (!validation.valid) {
        return { success: false, count: 0, reason: validation.reason };
      }

      console.log(`[QuickTabsManager] Found ${storedState.tabs.length} Quick Tab(s) in storage to hydrate`);

      // Hydrate each stored tab
      const hydratedCount = this._hydrateTabsFromStorage(storedState.tabs);

      // Emit hydrated event for UICoordinator to render restored tabs
      if (hydratedCount > 0 && this.internalEventBus) {
        this.internalEventBus.emit('state:hydrated', { count: hydratedCount });
      }

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
   * v1.6.4.11 - Extracted to reduce _buildHydrationOptions complexity
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
      soloedOnTabs: [],
      mutedOnTabs: [],
      zIndex: CONSTANTS.QUICK_TAB_BASE_Z_INDEX
    };
  }

  /**
   * Apply default value if source value is null/undefined
   * v1.6.4.11 - Helper to reduce _buildHydrationOptions complexity
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
   * v1.6.4.11 - Refactored: extracted HYDRATION_DEFAULTS and _getWithDefault to reduce cc from 10 to ≤9
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
      soloedOnTabs: this._getWithDefault(tabData.soloedOnTabs, defaults.soloedOnTabs),
      mutedOnTabs: this._getWithDefault(tabData.mutedOnTabs, defaults.mutedOnTabs),
      zIndex: this._getWithDefault(tabData.zIndex, defaults.zIndex),
      source: 'hydration'
    };
  }

  /**
   * Add callbacks to hydration options
   * v1.6.3.4 - Helper to reduce complexity
   * @private
   * @param {Object} options - Base options
   * @returns {Object} Options with callbacks
   */
  _addHydrationCallbacks(options) {
    return {
      ...options,
      onDestroy: tabId => this.handleDestroy(tabId, 'UI'),
      onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
      onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs),
      onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs)
    };
  }

  /**
   * Hydrate a single Quick Tab from stored data
   * v1.6.3.4 - FIX Issue #1: Helper to create Quick Tab from storage data
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {boolean} True if hydration succeeded
   */
  _hydrateTab(tabData) {
    // Validate required fields
    if (!tabData?.id || !tabData?.url) {
      console.warn('[QuickTabsManager] Skipping invalid tab data (missing id or url):', tabData);
      return false;
    }

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

    console.log(`[QuickTabsManager] Hydrating tab: ${tabData.id} (minimized: ${tabData.minimized})`);

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
      const tabWindow = new QuickTabWindow({
        id: options.id,
        url: options.url,
        title: options.title,
        left: options.left,
        top: options.top,
        width: options.width,
        height: options.height,
        minimized: true,
        soloedOnTabs: options.soloedOnTabs,
        mutedOnTabs: options.mutedOnTabs,
        zIndex: options.zIndex,
        // Wire up callbacks - these persist through restore cycles
        onDestroy: tabId => this.handleDestroy(tabId, 'UI'),
        onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
        onFocus: tabId => this.handleFocus(tabId),
        onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
        onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
        onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
        onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
        onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs),
        onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs)
      });
      
      // v1.6.3.4-v7 - Log instance type to confirm real QuickTabWindow
      console.log('[QuickTabsManager] Created real QuickTabWindow instance:', {
        id: options.id,
        constructorName: tabWindow.constructor.name,
        hasRender: typeof tabWindow.render === 'function',
        hasMinimize: typeof tabWindow.minimize === 'function',
        hasRestore: typeof tabWindow.restore === 'function',
        hasDestroy: typeof tabWindow.destroy === 'function',
        minimized: tabWindow.minimized,
        url: tabWindow.url
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
      console.error('[QuickTabsManager] MemoryGuard triggered emergency shutdown:', reason, memoryMB);
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
   * @private
   */
  async _initializeHandlers() {
    this.createHandler = new CreateHandler(
      this.tabs,
      this.currentZIndex,
      this.cookieStoreId,
      this.eventBus,
      this.Events,
      this.generateId.bind(this),
      this.windowFactory
    );

    // v1.6.3.2 - Initialize CreateHandler to load debug settings
    await this.createHandler.init();

    this.updateHandler = new UpdateHandler(
      this.tabs,
      this.internalEventBus,
      this.minimizedManager
    );

    this.visibilityHandler = new VisibilityHandler({
      quickTabsMap: this.tabs,
      minimizedManager: this.minimizedManager,
      eventBus: this.internalEventBus,
      currentZIndex: this.currentZIndex,
      currentTabId: this.currentTabId,
      Events: this.Events
    });

    this.destroyHandler = new DestroyHandler(
      this.tabs,
      this.minimizedManager,
      this.internalEventBus, // v1.6.3.3 - FIX Bug #6: Use internal bus for state:deleted so UICoordinator receives it
      this.currentZIndex,
      this.Events,
      CONSTANTS.QUICK_TAB_BASE_Z_INDEX
    );
  }

  /**
   * Initialize coordinator components
   * v1.6.3 - Removed SyncCoordinator
   * v1.6.4 - Removed PanelManager (floating panel removed, sidebar-only)
   * @private
   */
  _initializeCoordinators() {
    this.uiCoordinator = new UICoordinator(
      this.state,
      this.minimizedManager,
      null, // panelManager removed in v1.6.4
      this.internalEventBus
    );
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
    this.internalEventBus.on('state:updated', (data) => {
      this.eventBus.emit('state:updated', data);
      console.log('[QuickTabsManager] Bridged state:updated to external bus');
    });
    
    // Bridge internal state:deleted events to external bus
    this.internalEventBus.on('state:deleted', (data) => {
      this.eventBus.emit('state:deleted', data);
      console.log('[QuickTabsManager] Bridged state:deleted to external bus');
    });
    
    // Bridge internal state:created events to external bus
    this.internalEventBus.on('state:created', (data) => {
      this.eventBus.emit('state:created', data);
      console.log('[QuickTabsManager] Bridged state:created to external bus');
    });
    
    // Bridge internal state:added events to external bus (for panel updates)
    this.internalEventBus.on('state:added', (data) => {
      this.eventBus.emit('state:added', data);
      console.log('[QuickTabsManager] Bridged state:added to external bus');
    });

    // v1.6.3.4 - Bridge internal state:hydrated events to external bus (cross-tab sync)
    this.internalEventBus.on('state:hydrated', (data) => {
      this.eventBus.emit('state:hydrated', data);
      console.log('[QuickTabsManager] Bridged state:hydrated to external bus');
    });

    // v1.6.3.4 - Bridge internal state:cleared events to external bus (Clear Storage button)
    this.internalEventBus.on('state:cleared', (data) => {
      this.eventBus.emit('state:cleared', data);
      console.log('[QuickTabsManager] Bridged state:cleared to external bus');
    });

    console.log('[QuickTabsManager] ✓ Event bridge setup complete');
  }

  /**
   * Detect Firefox container context
   */
  async detectContainerContext() {
    try {
      const response = await browser.runtime.sendMessage({
        action: 'GET_CONTAINER_CONTEXT'
      });

      if (response && response.success && response.cookieStoreId) {
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

      if (response && response.success && response.cookieStoreId) {
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
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] createQuickTab called with:', options);
    
    // Add callbacks to options (required by QuickTabWindow)
    // v1.6.3.4 - FIX Issue #4: onDestroy callback now routes to DestroyHandler
    // v1.6.3.4 - FIX Issue #6: Source defaults to 'UI' for window callbacks
    const optionsWithCallbacks = {
      ...options,
      onDestroy: tabId => this.handleDestroy(tabId, 'UI'),
      onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
      onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs),
      onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs)
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
   * Handle solo toggle
   */
  handleSoloToggle(quickTabId, newSoloedTabs) {
    return this.visibilityHandler.handleSoloToggle(quickTabId, newSoloedTabs);
  }

  /**
   * Handle mute toggle
   */
  handleMuteToggle(quickTabId, newMutedTabs) {
    return this.visibilityHandler.handleMuteToggle(quickTabId, newMutedTabs);
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
    console.warn('[QuickTabsManager] crypto.getRandomValues unavailable, using Math.random fallback');
    return Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11);
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
      
      console.warn(`[QuickTabsManager] ID collision detected: ${id}, retrying... (${attempt + 1}/${maxRetries})`);
    }
    
    // Fallback: add extra entropy with collision marker
    const fallbackId = `qt-${this.currentTabId || 'unknown'}-${Date.now()}-${this._generateSecureRandom()}-collision`;
    console.error(`[QuickTabsManager] Failed to generate unique ID after ${maxRetries} attempts, using fallback: ${fallbackId}`);
    this.generatedIds.add(fallbackId);
    return fallbackId;
  }

  // ============================================================================
  // LEGACY METHODS (kept for backward compatibility)
  // ============================================================================

  /**
   * Update Quick Tab position (legacy)
   * @deprecated Use handlePositionChange instead
   */
  updateQuickTabPosition(id, left, top) {
    return this.handlePositionChange(id, left, top);
  }

  /**
   * Update Quick Tab size (legacy)
   * @deprecated Use handleSizeChange instead
   */
  updateQuickTabSize(id, width, height) {
    return this.handleSizeChange(id, width, height);
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
 * @returns {QuickTabsManager} Initialized manager instance
 */
export async function initQuickTabs(eventBus, Events, options = {}) {
  console.log('[QuickTabs] Initializing Quick Tabs feature module...');
  
  if (options.forceNew || !quickTabsManagerInstance) {
    console.log('[QuickTabs] Creating new QuickTabsManager instance with options:', options);
    quickTabsManagerInstance = new QuickTabsManager(options);
  } else if (options.windowFactory) {
    console.log('[QuickTabs] Updating windowFactory on existing instance');
    quickTabsManagerInstance.windowFactory = options.windowFactory;
  }
  
  await quickTabsManagerInstance.init(eventBus, Events);
  console.log('[QuickTabs] Quick Tabs feature module initialized');
  return quickTabsManagerInstance;
}

export { QuickTabsManager };
