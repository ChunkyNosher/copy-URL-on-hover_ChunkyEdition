/**
 * Quick Tabs Feature Module - REFACTORED FACADE
 * Main entrypoint for Quick Tabs functionality
 *
 * v1.6.0 - PHASE 2.2: Facade pattern implementation
 * Reduces complexity from 1453 lines to ~400 lines by delegating to extracted components
 *
 * Architecture:
 * - Facade orchestrates 4 managers, 4 handlers, 2 coordinators
 * - Maintains backward compatibility with legacy API
 * - Delegates all business logic to specialized components
 */

import { EventEmitter } from 'eventemitter3';

import { SyncCoordinator } from './coordinators/SyncCoordinator.js';
import { UICoordinator } from './coordinators/UICoordinator.js';
import { CreateHandler } from './handlers/CreateHandler.js';
import { DestroyHandler } from './handlers/DestroyHandler.js';
import { UpdateHandler } from './handlers/UpdateHandler.js';
import { VisibilityHandler } from './handlers/VisibilityHandler.js';
import { BroadcastManager } from './managers/BroadcastManager.js';
import { EventManager } from './managers/EventManager.js';
import { StateManager } from './managers/StateManager.js';
import { StorageManager } from './managers/StorageManager.js';
import { MinimizedManager } from './minimized-manager.js';
import { PanelManager } from './panel.js';
import { CONSTANTS } from '../../core/config.js';

/**
 * QuickTabsManager - Facade for Quick Tab management
 * v1.6.0 - Simplified to orchestration layer, delegates to specialized components
 */
class QuickTabsManager {
  constructor(options = {}) {
    // Backward compatibility fields (MUST KEEP - other code depends on these)
    this.tabs = new Map(); // id -> QuickTabWindow instance (used by panel.js, etc.)
    this.currentZIndex = { value: CONSTANTS.QUICK_TAB_BASE_Z_INDEX }; // Changed to ref object
    this.initialized = false;
    this.cookieStoreId = null;
    this.currentTabId = null;
    this.pendingSaveIds = new Set(); // For saveId tracking (backward compat)

    // Internal event bus for component communication (NEW in v1.6.0)
    this.internalEventBus = new EventEmitter();

    // Managers (initialized in init())
    this.storage = null;
    this.broadcast = null;
    this.state = null;
    this.events = null;

    // Handlers (initialized in init())
    this.createHandler = null;
    this.updateHandler = null;
    this.visibilityHandler = null;
    this.destroyHandler = null;

    // Coordinators (initialized in init())
    this.uiCoordinator = null;
    this.syncCoordinator = null;

    // Legacy UI managers (KEEP - used by other modules)
    this.minimizedManager = new MinimizedManager();
    this.panelManager = null;

    // Legacy fields for backward compatibility (KEEP - required by old code)
    this.eventBus = null; // External event bus from content.js
    this.Events = null; // Event constants
    this.broadcastChannel = null; // Legacy field (now handled by BroadcastManager)
    
    // v1.6.1.2 - Dependency injection for testing
    this.windowFactory = options.windowFactory || null;
  }

  /**
   * Initialize the Quick Tabs manager
   * v1.6.0 - Refactored to wire together extracted components
   * v1.6.0.3 - Added comprehensive error logging to debug initialization failures
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
      this._initStep3_Handlers();
      await this._initStep4_Panel();
      this._initStep5_Coordinators();
      await this._initStep6_Setup();
      await this._initStep7_Hydrate();
      this._initStep8_Expose();

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
   * @private
   */
  _initStep3_Handlers() {
    console.log('[QuickTabsManager] STEP 3: Initializing handlers...');
    this._initializeHandlers();
    console.log('[QuickTabsManager] STEP 3 Complete');
  }

  /**
   * STEP 4: Initialize panel manager
   * @private
   */
  async _initStep4_Panel() {
    console.log('[QuickTabsManager] STEP 4: Initializing panel manager...');
    this.panelManager = new PanelManager(this);
    await this.panelManager.init();
    console.log('[QuickTabsManager] STEP 4 Complete - Panel manager initialized');
  }

  /**
   * STEP 5: Initialize coordinators
   * @private
   */
  _initStep5_Coordinators() {
    console.log('[QuickTabsManager] STEP 5: Initializing coordinators...');
    this._initializeCoordinators();
    console.log('[QuickTabsManager] STEP 5 Complete');
  }

  /**
   * STEP 6: Setup managers (attach listeners)
   * @private
   */
  async _initStep6_Setup() {
    console.log('[QuickTabsManager] STEP 6: Setting up components...');
    await this._setupComponents();
    console.log('[QuickTabsManager] STEP 6 Complete');
  }

  /**
   * STEP 7: Hydrate state from storage
   * @private
   */
  async _initStep7_Hydrate() {
    console.log('[QuickTabsManager] STEP 7: Hydrating state...');
    await this._hydrateState();
    console.log('[QuickTabsManager] STEP 7 Complete');
  }

  /**
   * STEP 8: Expose manager globally
   * @private
   */
  _initStep8_Expose() {
    console.log('[QuickTabsManager] STEP 8: Exposing manager globally...');
    if (typeof window !== 'undefined') {
      window.__quickTabsManager = this;
      console.log('[QuickTabsManager] Manager exposed globally');
    }
    console.log('[QuickTabsManager] STEP 8 Complete');
  }

  /**
   * Initialize manager components
   * @private
   */
  _initializeManagers() {
    this.storage = new StorageManager(this.internalEventBus, this.cookieStoreId);
    this.broadcast = new BroadcastManager(this.internalEventBus, this.cookieStoreId);
    this.state = new StateManager(this.internalEventBus, this.currentTabId);
    this.events = new EventManager(this.internalEventBus, this.tabs);
  }

  /**
   * Initialize handler components
   * @private
   */
  _initializeHandlers() {
    this.createHandler = new CreateHandler(
      this.tabs,
      this.currentZIndex,
      this.cookieStoreId,
      this.broadcast,
      this.eventBus,
      this.Events,
      this.generateId.bind(this),
      this.windowFactory
    );

    this.updateHandler = new UpdateHandler(
      this.tabs,
      this.broadcast,
      this.storage,
      this.internalEventBus,
      this.generateSaveId.bind(this),
      this.releasePendingSave.bind(this)
    );

    this.visibilityHandler = new VisibilityHandler({
      quickTabsMap: this.tabs,
      broadcastManager: this.broadcast,
      storageManager: this.storage,
      minimizedManager: this.minimizedManager,
      eventBus: this.internalEventBus,
      currentZIndex: this.currentZIndex,
      generateSaveId: this.generateSaveId.bind(this),
      trackPendingSave: this.trackPendingSave.bind(this),
      releasePendingSave: this.releasePendingSave.bind(this),
      currentTabId: this.currentTabId,
      Events: this.Events
    });

    this.destroyHandler = new DestroyHandler(
      this.tabs,
      this.broadcast,
      this.minimizedManager,
      this.eventBus,
      this.currentZIndex,
      this.generateSaveId.bind(this),
      this.releasePendingSave.bind(this),
      this.Events,
      CONSTANTS.QUICK_TAB_BASE_Z_INDEX
    );
  }

  /**
   * Initialize coordinator components
   * @private
   */
  _initializeCoordinators() {
    this.uiCoordinator = new UICoordinator(
      this.state,
      this.minimizedManager,
      this.panelManager,
      this.internalEventBus
    );

    this.syncCoordinator = new SyncCoordinator(
      this.state,
      this.storage,
      this.broadcast,
      {
        create: this.createHandler,
        update: this.updateHandler,
        visibility: this.visibilityHandler,
        destroy: this.destroyHandler
      },
      this.internalEventBus
    );
  }

  /**
   * Setup component listeners and event flows
   * @private
   */
  async _setupComponents() {
    this.storage.setupStorageListeners();
    this.broadcast.setupBroadcastChannel();
    this.events.setupEmergencySaveHandlers();
    this.syncCoordinator.setupListeners();
    await this.uiCoordinator.init();
  }

  /**
   * Detect Firefox container context
   * v1.5.9.12 - Container integration
   * v1.6.0.1 - Fixed to use message passing (browser.tabs not available in content scripts)
   */
  async detectContainerContext() {
    try {
      // Content scripts cannot access browser.tabs API
      // Must request container info from background script
      const response = await browser.runtime.sendMessage({
        action: 'GET_CONTAINER_CONTEXT'
      });

      if (response && response.success && response.cookieStoreId) {
        this.cookieStoreId = response.cookieStoreId;
        console.log('[QuickTabsManager] Detected container:', this.cookieStoreId);
        return true; // Success
      } else {
        console.error(
          '[QuickTabsManager] Failed to get container from background:',
          response?.error
        );
        this.cookieStoreId = 'firefox-default';
        return false; // Failure
      }
    } catch (err) {
      console.error('[QuickTabsManager] Failed to detect container:', err);
      this.cookieStoreId = 'firefox-default';
      return false; // Failure
    }
  }

  /**
   * Get current container context (backward compat)
   * v1.6.0.1 - Fixed to use message passing instead of direct browser.tabs access
   */
  async getCurrentContainer() {
    try {
      // Content scripts cannot access browser.tabs API
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
   * v1.5.9.13 - Solo/Mute functionality
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

  /**
   * Hydrate state from storage
   * @private
   */
  async _hydrateState() {
    console.log('[QuickTabsManager] Hydrating state from storage...');
    try {
      const quickTabs = await this.storage.loadAll();
      this.state.hydrate(quickTabs);
      console.log(`[QuickTabsManager] Hydrated ${quickTabs.length} Quick Tabs`);

      // Phase 3: Replay broadcast history for late-joining tabs
      console.log('[QuickTabsManager] Replaying broadcast history...');
      const replayedCount = await this.broadcast.replayBroadcastHistory();
      console.log(`[QuickTabsManager] Replayed ${replayedCount} broadcast messages`);

      // Phase 4: Set state manager reference and start periodic snapshots
      this.broadcast.setStateManager(this.state);
      this.broadcast.startPeriodicSnapshots();
      console.log('[QuickTabsManager] Started periodic state snapshot broadcasting');
    } catch (err) {
      console.error('[QuickTabsManager] Failed to hydrate state:', err);
    }
  }

  // ============================================================================
  // PUBLIC API - Delegate to handlers and coordinators
  // ============================================================================

  /**
   * Create a new Quick Tab
   * Delegates to CreateHandler
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] createQuickTab called with:', options);
    console.log('[QuickTabsManager] createHandler exists:', !!this.createHandler);
    
    // Add callbacks to options (required by QuickTabWindow)
    const optionsWithCallbacks = {
      ...options,
      onDestroy: tabId => this.handleDestroy(tabId),
      onMinimize: tabId => this.handleMinimize(tabId),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
      onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs),
      onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs)
    };

    console.log('[QuickTabsManager] Calling createHandler.create...');
    const result = this.createHandler.create(optionsWithCallbacks);
    console.log('[QuickTabsManager] Result:', result);
    console.log('[QuickTabsManager] Result type:', typeof result);
    console.log('[QuickTabsManager] Result has tabWindow?:', result && 'tabWindow' in result);
    
    if (!result) {
      throw new Error('[QuickTabsManager] createHandler.create() returned undefined');
    }
    
    if (!result.tabWindow) {
      console.error('[QuickTabsManager] result.tabWindow is undefined!');
      console.error('[QuickTabsManager] Full result object:', JSON.stringify(result, null, 2));
    }
    
    this.currentZIndex.value = result.newZIndex;
    const returnValue = result.tabWindow;
    console.log('[QuickTabsManager] Returning:', returnValue);
    return returnValue;
  }

  /**
   * Handle Quick Tab destruction
   * Delegates to DestroyHandler
   */
  handleDestroy(id) {
    return this.destroyHandler.handleDestroy(id);
  }

  /**
   * Handle Quick Tab minimize
   * Delegates to VisibilityHandler
   */
  handleMinimize(id) {
    return this.visibilityHandler.handleMinimize(id);
  }

  /**
   * Handle Quick Tab focus
   * Delegates to VisibilityHandler
   */
  handleFocus(id) {
    return this.visibilityHandler.handleFocus(id);
  }

  /**
   * Handle position change (during drag)
   * Delegates to UpdateHandler
   */
  handlePositionChange(id, left, top) {
    return this.updateHandler.handlePositionChange(id, left, top);
  }

  /**
   * Handle position change end (drag complete)
   * Delegates to UpdateHandler
   */
  handlePositionChangeEnd(id, left, top) {
    return this.updateHandler.handlePositionChangeEnd(id, left, top);
  }

  /**
   * Handle size change (during resize)
   * Delegates to UpdateHandler
   */
  handleSizeChange(id, width, height) {
    return this.updateHandler.handleSizeChange(id, width, height);
  }

  /**
   * Handle size change end (resize complete)
   * Delegates to UpdateHandler
   */
  handleSizeChangeEnd(id, width, height) {
    return this.updateHandler.handleSizeChangeEnd(id, width, height);
  }

  /**
   * Handle solo toggle
   * Delegates to VisibilityHandler
   */
  handleSoloToggle(quickTabId, newSoloedTabs) {
    return this.visibilityHandler.handleSoloToggle(quickTabId, newSoloedTabs);
  }

  /**
   * Handle mute toggle
   * Delegates to VisibilityHandler
   */
  handleMuteToggle(quickTabId, newMutedTabs) {
    return this.visibilityHandler.handleMuteToggle(quickTabId, newMutedTabs);
  }

  /**
   * Close Quick Tab by ID
   * Delegates to DestroyHandler
   */
  closeById(id) {
    return this.destroyHandler.closeById(id);
  }

  /**
   * Close all Quick Tabs
   * Delegates to DestroyHandler
   */
  closeAll() {
    return this.destroyHandler.closeAll();
  }

  /**
   * Restore Quick Tab from minimized state
   * Delegates to VisibilityHandler
   */
  restoreQuickTab(id) {
    return this.visibilityHandler.restoreQuickTab(id);
  }

  /**
   * Minimize Quick Tab by ID (backward compat)
   * Delegates to VisibilityHandler
   */
  minimizeById(id) {
    return this.handleMinimize(id);
  }

  /**
   * Restore Quick Tab by ID (backward compat)
   * Delegates to VisibilityHandler
   */
  restoreById(id) {
    return this.visibilityHandler.restoreById(id);
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
  // UTILITY METHODS (KEEP - core functionality)
  // ============================================================================

  /**
   * Generate unique ID for Quick Tab
   */
  generateId() {
    return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique save ID for transaction tracking
   */
  generateSaveId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Track pending save to prevent race conditions
   */
  trackPendingSave(saveId) {
    this.pendingSaveIds.add(saveId);
    console.log('[QuickTabsManager] Tracking pending save:', saveId);
  }

  /**
   * Release pending save
   */
  releasePendingSave(saveId) {
    this.pendingSaveIds.delete(saveId);
    console.log('[QuickTabsManager] Released pending save:', saveId);
  }

  // ============================================================================
  // LEGACY METHODS (kept for backward compatibility, delegate to new components)
  // ============================================================================

  /**
   * Update Quick Tab position (legacy - backward compat)
   * @deprecated Use handlePositionChange instead
   */
  updateQuickTabPosition(id, left, top) {
    return this.handlePositionChange(id, left, top);
  }

  /**
   * Update Quick Tab size (legacy - backward compat)
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
 * v1.6.0 - Facade pattern, delegates to extracted components
 * v1.6.1.2 - Added options parameter for dependency injection (testing support)
 * v1.6.1.3 - Fixed singleton pattern to support testing with different factories
 *
 * @param {EventEmitter} eventBus - External event bus from content.js
 * @param {Object} Events - Event constants
 * @param {Object} options - Optional configuration (for testing)
 * @param {Function} options.windowFactory - Optional window factory for testing
 * @param {boolean} options.forceNew - Force creation of new instance (for testing)
 * @returns {QuickTabsManager} Initialized manager instance
 */
export async function initQuickTabs(eventBus, Events, options = {}) {
  console.log('[QuickTabs] Initializing Quick Tabs feature module...');
  
  // v1.6.1.3 - Allow creating new instance for testing (avoids singleton issues in tests)
  if (options.forceNew || !quickTabsManagerInstance) {
    console.log('[QuickTabs] Creating new QuickTabsManager instance with options:', options);
    quickTabsManagerInstance = new QuickTabsManager(options);
  } else if (options.windowFactory) {
    // If reusing instance but windowFactory provided, update it BEFORE init
    console.log('[QuickTabs] Updating windowFactory on existing instance');
    quickTabsManagerInstance.windowFactory = options.windowFactory;
  }
  
  await quickTabsManagerInstance.init(eventBus, Events);
  console.log('[QuickTabs] Quick Tabs feature module initialized');
  return quickTabsManagerInstance;
}

export { QuickTabsManager };
