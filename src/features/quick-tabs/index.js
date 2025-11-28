/**
 * Quick Tabs Feature Module - REFACTORED FACADE
 * Main entrypoint for Quick Tabs functionality
 *
 * v1.6.0 - PHASE 2.2: Facade pattern implementation
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
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
import { PanelManager } from './panel.js';
import { CONSTANTS } from '../../core/config.js';

/**
 * QuickTabsManager - Facade for Quick Tab management
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync or storage persistence)
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
    this.panelManager = null;

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
      this._initStep3_Handlers();
      await this._initStep4_Panel();
      this._initStep5_Coordinators();
      await this._initStep6_Setup();
      this._initStep7_Log();
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
   * STEP 7: Log initialization (no hydration in v1.6.3)
   * @private
   */
  _initStep7_Log() {
    console.log('[QuickTabsManager] STEP 7: State initialized empty (no persistence in v1.6.3)');
  }

  /**
   * STEP 8: Expose manager globally
   * @private
   */
  _initStep8_Expose() {
    console.log('[QuickTabsManager] STEP 8: Exposing manager globally...');
    if (typeof window !== 'undefined') {
      window.quickTabsManager = this;
      window.__quickTabsManager = this;
      console.log('[QuickTabsManager] Manager exposed globally as window.quickTabsManager');
      console.log('[QuickTabsManager] Current tab ID available:', this.currentTabId);
    }
    console.log('[QuickTabsManager] STEP 8 Complete');
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
   * @private
   */
  _initializeHandlers() {
    this.createHandler = new CreateHandler(
      this.tabs,
      this.currentZIndex,
      this.cookieStoreId,
      this.eventBus,
      this.Events,
      this.generateId.bind(this),
      this.windowFactory
    );

    this.updateHandler = new UpdateHandler(
      this.tabs,
      this.internalEventBus
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
      this.eventBus,
      this.currentZIndex,
      this.Events,
      CONSTANTS.QUICK_TAB_BASE_Z_INDEX
    );
  }

  /**
   * Initialize coordinator components
   * v1.6.3 - Removed SyncCoordinator
   * @private
   */
  _initializeCoordinators() {
    this.uiCoordinator = new UICoordinator(
      this.state,
      this.minimizedManager,
      this.panelManager,
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
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] createQuickTab called with:', options);
    
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

    const result = this.createHandler.create(optionsWithCallbacks);
    
    if (!result) {
      throw new Error('[QuickTabsManager] createHandler.create() returned undefined');
    }
    
    this.currentZIndex.value = result.newZIndex;
    return result.tabWindow;
  }

  /**
   * Handle Quick Tab destruction
   */
  handleDestroy(id) {
    return this.destroyHandler.handleDestroy(id);
  }

  /**
   * Handle Quick Tab minimize
   */
  handleMinimize(id) {
    return this.visibilityHandler.handleMinimize(id);
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
   */
  restoreQuickTab(id) {
    return this.visibilityHandler.restoreQuickTab(id);
  }

  /**
   * Minimize Quick Tab by ID (backward compat)
   */
  minimizeById(id) {
    return this.handleMinimize(id);
  }

  /**
   * Restore Quick Tab by ID (backward compat)
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
