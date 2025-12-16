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
 * v1.6.3.8-v9 - FIX Issue #20: Restructure init sequence - signalReady() BEFORE hydration
 *               This ensures queued messages are replayed BEFORE tabs created from storage
 * v1.6.3.8-v9 - FIX Issue #19: Add conflict detection in message replay to prevent duplicates
 *               Queued messages that reference existing tabs are skipped (hydration has newer state)
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
import { STATE_KEY } from '../../utils/storage-utils.js';

// v1.6.3.7-v12 - Issue #12: currentTabId barrier constants (code review fix)
// v1.6.3.8-v9 - FIX Section 1.3: Increased timeout from 2s to 5s for slow devices
// v1.6.3.9-v3 - Issue #47-2: Reduced from 5s to 2s - stateless architecture doesn't need long Port wait
//               Allow graceful degradation if currentTabId unavailable (hydration deferred, not blocked)
const CURRENT_TAB_ID_WAIT_TIMEOUT_MS = 2000; // 2 second max wait (reduced from 5s)
const INITIAL_POLL_INTERVAL_MS = 50;
const MAX_POLL_INTERVAL_MS = 200;
const POLL_INTERVAL_MULTIPLIER = 1.5; // Exponential backoff factor

// v1.6.3.8-v9 - FIX Section 1.3: Delayed retry interval for hydration fallback
const HYDRATION_RETRY_DELAY_MS = 3000; // 3 second delay before retry

// v1.6.3.8-v3 - Issue #6: Debug flag for message queueing (respects DEBUG_MESSAGING pattern)
const DEBUG_MESSAGING = true;

// v1.6.3.8-v9 - FIX Section 5.3: Maximum message queue size to prevent unbounded growth
const MAX_MESSAGE_QUEUE_SIZE = 100;

/**
 * QuickTabsManager - Facade for Quick Tab management
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync or storage persistence)
 * v1.6.3.4 - FIX Issues #1, #8: Add state rehydration on startup with logging
 * v1.6.3.8-v3 - FIX Issue #6: Add message queue for init race condition prevention
 * v1.6.3.8-v9 - FIX Section 5.3: Add message queue size limit (100 messages)
 */
class QuickTabsManager {
  constructor(options = {}) {
    // v1.6.3.8-v9 - FIX Issue #21: Track constructor start time for initialization diagnostics
    const constructorStartTime = Date.now();

    // Backward compatibility fields (MUST KEEP - other code depends on these)
    this.tabs = new Map(); // id -> QuickTabWindow instance (used by panel.js, etc.)
    this.currentZIndex = { value: CONSTANTS.QUICK_TAB_BASE_Z_INDEX }; // Changed to ref object
    this.initialized = false;
    this.cookieStoreId = null;
    this.currentTabId = null;

    // v1.6.3.8-v3 - Issue #6: Message queue for buffering during initialization
    // Messages received before handler signals READY are queued and replayed
    this._messageQueue = [];
    this._isReady = false; // True when handler explicitly signals READY

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

    // v1.6.3.8-v9 - FIX Issue #21: Track initialization timestamps for diagnostics
    this._constructorTimestamp = constructorStartTime;
    this._initStartTimestamp = null;
    this._initCompleteTimestamp = null;
    this._handlersReadyTimestamp = null;
    this._listenersRegisteredTimestamp = null;

    // v1.6.3.8-v9 - FIX Issue #21: Log constructor completion
    console.log('[QuickTabsManager] CONSTRUCTOR_COMPLETE:', {
      timestamp: constructorStartTime,
      isReady: this._isReady,
      queueLength: this._messageQueue.length
    });
  }

  /**
   * Initialize the Quick Tabs manager
   * v1.6.3 - Simplified (no storage/sync components)
   * v1.6.3.8-v3 - Issue #6: Signal READY and replay queued messages after init
   * v1.6.3.8-v9 - FIX Issue #21: Enhanced initialization logging with timestamps
   *
   * @param {EventEmitter} eventBus - External event bus from content.js
   * @param {Object} Events - Event constants
   * @param {Object} [options={}] - v1.6.3.5-v10: Initialization options
   * @param {number} [options.currentTabId] - v1.6.3.5-v10: Pre-fetched tab ID from content script
   */
  async init(eventBus, Events, options = {}) {
    if (this.initialized) {
      console.log('[QuickTabsManager] INIT_SKIPPED: Already initialized:', {
        timestamp: Date.now(),
        initCompleteTimestamp: this._initCompleteTimestamp
      });
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

    const initStartTime = Date.now();
    this._initStartTimestamp = initStartTime;

    // v1.6.3.8-v9 - FIX Issue #21: Log initialization start with barrier status
    console.log('[QuickTabsManager] INIT_START:', {
      timestamp: initStartTime,
      timeSinceConstructor: initStartTime - this._constructorTimestamp,
      isReady: this._isReady,
      queueLength: this._messageQueue.length,
      currentTabId: this.currentTabId
    });

    try {
      await this._initStep1_Context(options);
      this._initStep2_Managers();
      await this._initStep3_Handlers(); // v1.6.3.2 - Made async for CreateHandler settings
      this._initStep4_Coordinators();
      await this._initStep5_Setup();

      // v1.6.3.8-v9 - FIX Issue #20: Signal READY and replay queued messages BEFORE hydration
      // Previous order: Hydration → signalReady() (queued events replayed AFTER tabs created)
      // New order: signalReady() → Hydration (queued events applied BEFORE tabs created)
      // This ensures storage events are processed before local memory state is restored
      console.log(
        '[QuickTabsManager] INIT_STEP_5.5: Signaling ready and replaying queued messages:',
        {
          timestamp: Date.now(),
          isReady: this._isReady,
          queuedMessages: this._messageQueue.length,
          prerequisite: 'Steps 1-5 complete',
          purpose: 'Enable message processing before hydration'
        }
      );
      this.signalReady();
      console.log('[QuickTabsManager] INIT_STEP_5.5_COMPLETE: Queued messages replayed:', {
        timestamp: Date.now(),
        isReady: this._isReady
      });

      await this._initStep6_Hydrate(); // v1.6.3.4 - FIX Issue #1: Hydrate state from storage
      this._initStep7_Expose();

      this.initialized = true;
      this._initCompleteTimestamp = Date.now();

      // v1.6.3.8-v9 - FIX Issue #21: Log initialization completion with full timing
      console.log('[QuickTabsManager] INIT_COMPLETE:', {
        status: 'passed',
        durationMs: this._initCompleteTimestamp - initStartTime,
        timestamp: this._initCompleteTimestamp,
        initSequence: {
          constructorTimestamp: this._constructorTimestamp,
          initStartTimestamp: this._initStartTimestamp,
          handlersReadyTimestamp: this._handlersReadyTimestamp,
          initCompleteTimestamp: this._initCompleteTimestamp
        },
        tabsCount: this.tabs.size,
        isReady: this._isReady
      });
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
   * v1.6.3.7-v13 - Issue #6: Enhanced logging with INIT_STEP_1 format
   * @private
   * @param {Object} [_options={}] - Options including pre-fetched currentTabId (unused, kept for API consistency)
   */
  async _initStep1_Context(_options = {}) {
    // v1.6.3.7-v13 - Issue #6: Log step entry with specific format
    console.log('[QuickTabsManager] INIT_STEP_1: currentTabId detection started', {
      currentTabId: this.currentTabId,
      hasPreFetchedId: this.currentTabId !== null && this.currentTabId !== undefined,
      timestamp: Date.now()
    });

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

    // v1.6.3.7-v13 - Issue #6: Log step completion with specific format
    console.log('[QuickTabsManager] INIT_STEP_1_COMPLETE:', {
      currentTabId: this.currentTabId,
      success: this.currentTabId !== null && this.currentTabId !== undefined,
      timestamp: Date.now()
    });
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
   * v1.6.3.7-v12 - Issue #12: Add currentTabId barrier before hydration
   * @private
   */
  async _initStep6_Hydrate() {
    console.log('[QuickTabsManager] STEP 6: Attempting to hydrate state from storage...');

    // v1.6.3.7-v12 - Issue #12: Check currentTabId barrier before hydration
    const barrierResult = await this._checkCurrentTabIdBarrier();
    if (!barrierResult.passed) {
      console.warn('[QuickTabsManager] STEP 6: ⚠️ WARNING - Hydration blocked:', {
        reason: 'currentTabId barrier failed',
        currentTabId: this.currentTabId,
        barrierReason: barrierResult.reason,
        timestamp: Date.now()
      });
      console.log('[QuickTabsManager] STEP 6 Complete (skipped - no currentTabId)');
      return;
    }

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
   * Check currentTabId barrier before hydration
   * v1.6.3.7-v12 - Issue #12: Ensure currentTabId is set before hydration to prevent filtering all tabs
   * v1.6.3.8-v9 - FIX Section 1.3: Increased timeout to 5s, add fallback retry mechanism
   * @private
   * @returns {Promise<{passed: boolean, reason: string}>}
   */
  async _checkCurrentTabIdBarrier() {
    const barrierStartTime = Date.now();

    // If currentTabId is already set, barrier passes
    if (this.currentTabId !== null && this.currentTabId !== undefined) {
      console.log('[QuickTabsManager] CURRENT_TAB_ID_BARRIER: Passed (already set)', {
        currentTabId: this.currentTabId,
        timestamp: Date.now()
      });
      return { passed: true, reason: 'already_set' };
    }

    // v1.6.3.7-v12 - Issue #12: Wait for currentTabId to be set with timeout
    // v1.6.3.7-v12 - FIX Code Review: Use exponential backoff for polling
    // v1.6.3.8-v9 - FIX Section 1.3: Increased timeout to 5 seconds for slow devices
    console.log('[QuickTabsManager] CURRENT_TAB_ID_BARRIER: Waiting for currentTabId...', {
      timeout: CURRENT_TAB_ID_WAIT_TIMEOUT_MS,
      pollingStrategy: 'exponential-backoff',
      timestamp: Date.now()
    });

    let pollInterval = INITIAL_POLL_INTERVAL_MS;

    while (Date.now() - barrierStartTime < CURRENT_TAB_ID_WAIT_TIMEOUT_MS) {
      // Check if currentTabId was set by Step 1 or message handler
      if (this.currentTabId !== null && this.currentTabId !== undefined) {
        const waitDurationMs = Date.now() - barrierStartTime;
        console.log('[QuickTabsManager] CURRENT_TAB_ID_BARRIER: Passed (after wait)', {
          currentTabId: this.currentTabId,
          waitDurationMs,
          timestamp: Date.now()
        });
        return { passed: true, reason: 'resolved_after_wait' };
      }

      // Wait before next check with exponential backoff
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      pollInterval = Math.min(pollInterval * POLL_INTERVAL_MULTIPLIER, MAX_POLL_INTERVAL_MS);
    }

    // v1.6.3.7-v12 - Issue #12: Timeout reached - currentTabId still null
    // v1.6.3.8-v9 - FIX Section 1.3: Schedule delayed retry instead of just failing
    // v1.6.3.9-v3 - Issue #47-6: Use warn instead of error - graceful degradation is normal operation
    console.warn(
      '[QuickTabsManager] CURRENT_TAB_ID_BARRIER: Timeout - proceeding with graceful degradation',
      {
        currentTabId: this.currentTabId,
        timeoutMs: CURRENT_TAB_ID_WAIT_TIMEOUT_MS,
        elapsedMs: Date.now() - barrierStartTime,
        consequence: 'Hydration deferred until currentTabId available (retry scheduled)',
        note: 'This is expected behavior in stateless architecture - not a failure',
        retryDelayMs: HYDRATION_RETRY_DELAY_MS,
        timestamp: Date.now()
      }
    );

    // v1.6.3.8-v9 - FIX Section 1.3: Schedule a delayed retry of hydration
    // This gives background script more time to respond with currentTabId
    this._scheduleDelayedHydrationRetry();

    return {
      passed: false,
      reason: `currentTabId still null after ${CURRENT_TAB_ID_WAIT_TIMEOUT_MS}ms wait (retry scheduled)`
    };
  }

  /**
   * Schedule a delayed retry of hydration after barrier timeout
   * v1.6.3.8-v9 - FIX Section 1.3: Fallback mechanism for slow devices
   * @private
   */
  _scheduleDelayedHydrationRetry() {
    console.log('[QuickTabsManager] HYDRATION_RETRY_SCHEDULED:', {
      retryDelayMs: HYDRATION_RETRY_DELAY_MS,
      timestamp: Date.now()
    });

    setTimeout(async () => {
      // Check if currentTabId is now available
      if (this.currentTabId !== null && this.currentTabId !== undefined) {
        console.log('[QuickTabsManager] HYDRATION_RETRY_STARTED:', {
          currentTabId: this.currentTabId,
          timestamp: Date.now()
        });

        // Attempt hydration now that currentTabId is available
        const hydrationResult = await this._hydrateStateFromStorage();
        console.log('[QuickTabsManager] HYDRATION_RETRY_COMPLETE:', {
          success: hydrationResult.success,
          count: hydrationResult.count,
          reason: hydrationResult.reason,
          timestamp: Date.now()
        });
      } else {
        console.warn('[QuickTabsManager] HYDRATION_RETRY_SKIPPED: currentTabId still null', {
          currentTabId: this.currentTabId,
          timestamp: Date.now()
        });
      }
    }, HYDRATION_RETRY_DELAY_MS);
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
   * v1.6.3.8-v6 - Issue #10: Enhanced logging for cross-tab filtering diagnostics
   * @private
   * @param {Array} tabs - Array of tab data from storage
   * @returns {number} Count of successfully hydrated tabs
   */
  _hydrateTabsFromStorage(tabs) {
    // v1.6.3.8-v6 - Issue #10: Log tab count before filtering
    console.log('[QuickTabsManager] HYDRATION_FILTER_START:', {
      tabCountBeforeFilter: tabs.length,
      currentTabId: this.currentTabId,
      originTabIds: tabs.map(t => ({ id: t.id, originTabId: t.originTabId })),
      timestamp: Date.now()
    });

    // v1.6.3.6-v5 - FIX: Track validation results for comprehensive logging
    // v1.6.3.8-v6: Track both filtered and recovered tabs for diagnostics
    const filterReasons = {
      invalidData: 0,
      noOriginTabId: 0,
      noCurrentTabId: 0,
      differentTab: 0,
      alreadyExists: 0,
      noHandler: 0,
      error: 0
    };
    // v1.6.3.8-v6: Track successful recoveries separately (not filtered)
    let recoveredFromIdPattern = 0;

    let hydratedCount = 0;
    for (const tabData of tabs) {
      const result = this._safeHydrateTabWithReason(tabData, filterReasons);
      if (!result.success) continue;

      hydratedCount++;
      // v1.6.3.8-v6: Track if this was a recovered tab
      const wasRecovered = result.reason === 'recoveredFromIdPattern';
      recoveredFromIdPattern += wasRecovered ? 1 : 0;
    }

    // v1.6.3.6-v5 - FIX: Comprehensive init logging (single structured log)
    // v1.6.3.8-v6 - Issue #10: Enhanced with before/after counts
    console.log('[QuickTabsManager] TAB SCOPE ISOLATION VALIDATION:', {
      total: tabs.length,
      passed: hydratedCount,
      filtered: tabs.length - hydratedCount,
      currentTabId: this.currentTabId,
      filterReasons,
      recoveredFromIdPattern
    });

    // v1.6.3.8-v6 - Issue #10: Log final render count after filtering
    console.log('[QuickTabsManager] HYDRATION_FILTER_COMPLETE:', {
      tabCountBeforeFilter: tabs.length,
      tabCountAfterFilter: hydratedCount,
      filteredOutCount: tabs.length - hydratedCount,
      recoveredCount: recoveredFromIdPattern,
      currentTabId: this.currentTabId,
      timestamp: Date.now()
    });

    return hydratedCount;
  }

  /**
   * Safely hydrate a single tab with error handling and reason tracking
   * v1.6.3.6-v5 - FIX: Added reason tracking for comprehensive logging
   * v1.6.3.8-v6 - Issue #10: Track recoveredFromIdPattern as success reason
   * @private
   * @param {Object} tabData - Tab data from storage
   * @param {Object} filterReasons - Object to track filter reasons
   * @returns {{success: boolean, reason: string}} Result with success flag and reason
   */
  _safeHydrateTabWithReason(tabData, filterReasons) {
    try {
      // Validate required fields
      if (!this._isValidTabData(tabData)) {
        filterReasons.invalidData++;
        return { success: false, reason: 'invalidData' };
      }

      // Check tab scope validation with reason tracking
      const skipResult = this._checkTabScopeWithReason(tabData);
      if (skipResult.skip) {
        filterReasons[skipResult.reason]++;
        return { success: false, reason: skipResult.reason };
      }

      // v1.6.3.8-v6: Track if this was a recovered tab (for diagnostics)
      const wasRecovered = skipResult.reason === 'recoveredFromIdPattern';

      // Skip if tab already exists
      if (this.tabs.has(tabData.id)) {
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
      // v1.6.3.8-v6: Return recoveredFromIdPattern reason if applicable
      return { success: true, reason: wasRecovered ? 'recoveredFromIdPattern' : 'hydrated' };
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
   * Compute djb2-like checksum for state validation
   * v1.6.3.8-v7 - Issue #2: Same algorithm as background.js _computeStorageChecksum
   * IMPORTANT: Must match background.js exactly to ensure checksums are comparable
   * @private
   * @param {Object} state - State object with tabs array
   * @returns {string} Checksum string (e.g., 'chk-3-a1b2c3d4') or 'empty'
   */
  _computeStateChecksum(state) {
    if (!state?.tabs || !Array.isArray(state.tabs) || state.tabs.length === 0) {
      return 'empty';
    }

    // Build a deterministic string from tab IDs and their minimized states
    // MUST match background.js: ${t.id}:${t.minimized ? '1' : '0'}:${t.originTabId || '?'}
    const tabSignatures = state.tabs
      .map(t => `${t.id}:${t.minimized ? '1' : '0'}:${t.originTabId || '?'}`)
      .sort()
      .join('|');

    // djb2-like hash: hash = hash * 33 + char
    let hash = state.tabs.length;
    for (let i = 0; i < tabSignatures.length; i++) {
      hash = ((hash << 5) - hash + tabSignatures.charCodeAt(i)) | 0;
    }

    return `chk-${state.tabs.length}-${Math.abs(hash).toString(16)}`;
  }

  /**
   * Validate checksum during hydration
   * v1.6.3.8-v7 - Issue #2: Detect corruption by comparing computed vs expected checksum
   * @private
   * @param {Object} storedState - State from storage
   * @returns {{valid: boolean, computed: string, reason: string}}
   */
  _validateHydrationChecksum(storedState) {
    const computed = this._computeStateChecksum(storedState);
    const expected = storedState?.checksum;

    // Log checksum validation for diagnostics
    console.log('[QuickTabsManager] CHECKSUM_VALIDATION:', {
      computed,
      expected: expected || 'none',
      tabCount: storedState?.tabs?.length || 0,
      hasExpected: !!expected
    });

    // If no expected checksum in stored state, assume valid (backwards compatibility)
    if (!expected) {
      return { valid: true, computed, reason: 'no-expected-checksum' };
    }

    if (computed === expected) {
      return { valid: true, computed, reason: 'match' };
    }

    console.error('[QuickTabsManager] CHECKSUM_MISMATCH:', {
      computed,
      expected,
      tabCount: storedState?.tabs?.length || 0,
      recommendation: 'Request fresh state from background'
    });
    return { valid: false, computed, reason: 'mismatch' };
  }

  /**
   * Request fresh state from background when checksum validation fails
   * v1.6.3.8-v7 - Issue #2: Recovery mechanism for corrupted state
   * @private
   * @param {string} reason - Reason for requesting fresh state
   */
  async _requestFreshStateFromBackground(reason) {
    console.log('[QuickTabsManager] REQUESTING_FRESH_STATE:', {
      reason,
      currentTabId: this.currentTabId,
      timestamp: Date.now()
    });

    try {
      await browser.runtime.sendMessage({
        action: 'REQUEST_FULL_STATE_SYNC',
        source: 'quicktabs-manager-checksum-recovery',
        reason,
        tabId: this.currentTabId,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('[QuickTabsManager] Failed to request fresh state:', err.message);
    }
  }

  /**
   * Hydrate Quick Tab state from browser.storage.local
   * v1.6.3.4 - FIX Issue #1: Restore Quick Tabs after page reload
   * v1.6.3.4-v8 - Extracted logging to reduce complexity
   * v1.6.3.6-v10 - Refactored: Extracted helpers to reduce cc from 9 to 6
   * v1.6.3.8-v7 - Issue #2: Add checksum validation during hydration
   * @private
   * @returns {Promise<{success: boolean, count: number, reason: string}>}
   */
  async _hydrateStateFromStorage() {
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

      // v1.6.3.8-v7 - Issue #2: Validate checksum before hydrating
      const checksumResult = this._validateHydrationChecksum(storedState);
      if (!checksumResult.valid) {
        // Checksum mismatch - request fresh state and skip hydration
        await this._requestFreshStateFromBackground('hydration-checksum-mismatch');
        return {
          success: false,
          count: 0,
          reason: `Checksum mismatch: computed=${checksumResult.computed}, expected=${storedState.checksum}`
        };
      }

      console.log(
        `[QuickTabsManager] Found ${storedState.tabs.length} Quick Tab(s) in storage to hydrate`
      );

      // Hydrate each stored tab
      const hydratedCount = this._hydrateTabsFromStorage(storedState.tabs);

      // Emit hydrated event for UICoordinator to render restored tabs
      this._emitHydratedEventIfNeeded(hydratedCount);

      // v1.6.3.7-v13 - Issue #6: Log successful hydration completion with specific format
      // v1.6.3.8-v7 - Issue #2: Include checksum in completion log
      console.log('[QuickTabsManager] HYDRATION_COMPLETE:', {
        loadedTabCount: hydratedCount,
        totalInStorage: storedState.tabs.length,
        currentTabId: this.currentTabId,
        checksum: checksumResult.computed,
        checksumValid: true,
        timestamp: Date.now()
      });

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
   * v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
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
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
      onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs),
      onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs)
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
   * Extract browser tab ID from Quick Tab ID pattern
   * v1.6.3.6-v7 - FIX Issue #1: Fallback for orphaned Quick Tabs with null originTabId
   * Quick Tab ID format: qt-{tabId}-{timestamp}-{random}
   * @private
   * @param {string} quickTabId - Quick Tab ID to parse
   * @returns {number|null} Extracted tab ID or null if invalid format
   */
  _extractTabIdFromQuickTabId(quickTabId) {
    if (!quickTabId || typeof quickTabId !== 'string') return null;
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
   * v1.6.3.8-v6 - Issue #10: Enhanced logging for cross-tab filtering diagnostics
   * @private
   * @param {Object} tabData - Stored tab data
   * @returns {{skip: boolean, reason: string}} Result with skip flag and reason
   */
  _checkTabScopeWithReason(tabData) {
    const hasOriginTabId = tabData.originTabId !== null && tabData.originTabId !== undefined;
    const hasCurrentTabId = this.currentTabId !== null && this.currentTabId !== undefined;

    // v1.6.3.8-v6 - Issue #10: Log originTabId matching decision
    console.log('[QuickTabsManager] CROSS_TAB_FILTER_CHECK:', {
      quickTabId: tabData.id,
      originTabId: tabData.originTabId,
      currentTabId: this.currentTabId,
      hasOriginTabId,
      hasCurrentTabId,
      timestamp: Date.now()
    });

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
    // v1.6.3.8-v6 - Issue #10: Log final filtering decision
    console.log('[QuickTabsManager] CROSS_TAB_FILTER_RESULT:', {
      quickTabId: tabData.id,
      originTabId: tabData.originTabId,
      currentTabId: this.currentTabId,
      shouldRender,
      reason: shouldRender ? 'passed' : 'differentTab'
    });

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
  _shouldRenderOnThisTab(tabData) {
    const currentTabId = this.currentTabId;
    const originTabId = tabData.originTabId;
    const soloedOnTabs = tabData.soloedOnTabs || [];
    const mutedOnTabs = tabData.mutedOnTabs || [];

    // If soloed to specific tabs, only render on those tabs
    if (soloedOnTabs.length > 0) {
      return soloedOnTabs.includes(currentTabId);
    }

    // If muted on this tab, don't render
    if (mutedOnTabs.includes(currentTabId)) {
      return false;
    }

    // Default: only render on originating tab
    return originTabId === currentTabId;
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
        // v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
        currentTabId: this.currentTabId,
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

    // v1.6.3.8-v12 - GAP-3, GAP-17 fix: Pass currentTabId for ownership validation
    this.updateHandler = new UpdateHandler(
      this.tabs,
      this.internalEventBus,
      this.minimizedManager,
      this.currentTabId
    );

    this.visibilityHandler = new VisibilityHandler({
      quickTabsMap: this.tabs,
      minimizedManager: this.minimizedManager,
      eventBus: this.internalEventBus,
      currentZIndex: this.currentZIndex,
      currentTabId: this.currentTabId,
      Events: this.Events
    });

    // v1.6.3.8-v12 - GAP-3, GAP-17 fix: Pass currentTabId for ownership validation
    this.destroyHandler = new DestroyHandler(
      this.tabs,
      this.minimizedManager,
      this.internalEventBus, // v1.6.3.3 - FIX Bug #6: Use internal bus for state:deleted so UICoordinator receives it
      this.currentZIndex,
      this.Events,
      CONSTANTS.QUICK_TAB_BASE_Z_INDEX,
      this.currentTabId
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
    this.uiCoordinator = new UICoordinator(
      this.state,
      this.minimizedManager,
      null, // panelManager removed in v1.6.3.4
      this.internalEventBus,
      this.currentTabId // v1.6.3.5-v10 - Pass currentTabId for cross-tab filtering
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
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Register storage.onChanged listener
   * @private
   */
  async _setupComponents() {
    console.log('[QuickTabsManager] _setupComponents starting...');

    this.events.setupEmergencySaveHandlers();
    await this.uiCoordinator.init();

    // v1.6.3.3 - FIX Bug #5: Bridge internal events to external bus
    this._setupEventBridge();

    // v1.6.3.8-v12 - GAP-6, GAP-15 fix: Register storage.onChanged listener for cross-tab sync
    this._setupStorageListener();

    // Start memory monitoring
    if (this.memoryGuard) {
      this.memoryGuard.startMonitoring();
      console.log('[QuickTabsManager] MemoryGuard monitoring started');
    }

    console.log('[QuickTabsManager] ✓ _setupComponents complete');
  }

  /**
   * Setup storage.onChanged listener for cross-tab sync
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Register listener for storage changes
   * @private
   */
  _setupStorageListener() {
    // Store bound reference for cleanup
    this._boundStorageListener = this.onStorageChanged.bind(this);

    if (typeof browser !== 'undefined' && browser?.storage?.onChanged) {
      browser.storage.onChanged.addListener(this._boundStorageListener);
      console.log('[QuickTabsManager] storage.onChanged listener registered');
    } else {
      console.warn('[QuickTabsManager] storage.onChanged API not available');
    }
  }

  /**
   * Remove storage.onChanged listener (cleanup)
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Clean up listener on destroy
   * @private
   */
  _removeStorageListener() {
    if (
      this._boundStorageListener &&
      typeof browser !== 'undefined' &&
      browser?.storage?.onChanged
    ) {
      browser.storage.onChanged.removeListener(this._boundStorageListener);
      this._boundStorageListener = null;
      console.log('[QuickTabsManager] storage.onChanged listener removed');
    }
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
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] createQuickTab called with:', options);

    // Add callbacks to options (required by QuickTabWindow)
    // v1.6.3.4 - FIX Issue #4: onDestroy callback now routes to DestroyHandler
    // v1.6.3.4 - FIX Issue #6: Source defaults to 'UI' for window callbacks
    // v1.6.3.5-v2 - FIX Report 1 Issue #2: Set originTabId for cross-tab filtering
    // v1.6.3.5-v5 - FIX Issue #2: Pass currentTabId for decoupled tab ID access
    const optionsWithCallbacks = {
      ...options,
      originTabId: options.originTabId ?? this.currentTabId, // v1.6.3.5-v2
      currentTabId: this.currentTabId, // v1.6.3.5-v5 - FIX Issue #2: Pass for Solo/Mute
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
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Remove storage.onChanged listener
   *
   * This method:
   * - Stops MemoryGuard monitoring
   * - Removes storage.onChanged listener via CreateHandler.destroy()
   * - Removes QuickTabsManager's storage.onChanged listener
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
    // v1.6.3.8-v12 - GAP-6, GAP-15 fix: Remove QuickTabsManager's own storage listener
    this._removeStorageListener();
    this._destroyStep3_CloseAllTabs();
    this._destroyStep4_RemoveEventListeners();

    // Step 5: Mark as uninitialized
    this.initialized = false;

    // v1.6.3.8-v3 - Issue #6: Reset ready state and clear message queue
    this._isReady = false;
    this._messageQueue = [];

    console.log('[QuickTabsManager] ✓ Cleanup/teardown complete');
  }

  // ============================================================================
  // v1.6.3.8-v12 - GAP-6, GAP-15: STORAGE.ONCHANGED SYNC METHOD
  // ============================================================================

  /**
   * Validate storage change event and extract state
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Extracted to reduce onStorageChanged complexity
   * @private
   * @param {Object} changes - Storage changes object
   * @param {string} areaName - Storage area ('local', 'session', etc.)
   * @returns {{ valid: boolean, newState: Object|null }} Validation result
   */
  _validateStorageChange(changes, areaName) {
    // Only handle local storage changes for quick_tabs_state_v2
    if (areaName !== 'local') {
      return { valid: false, newState: null };
    }

    const stateChange = changes[STATE_KEY];
    if (!stateChange) {
      return { valid: false, newState: null };
    }

    console.log('[QuickTabsManager] STORAGE_ONCHANGED: Received storage update:', {
      areaName,
      hasNewValue: !!stateChange.newValue,
      hasOldValue: !!stateChange.oldValue,
      currentTabId: this.currentTabId,
      timestamp: Date.now()
    });

    // Skip if we don't have a currentTabId (can't filter)
    if (this.currentTabId === null || this.currentTabId === undefined) {
      console.warn('[QuickTabsManager] STORAGE_ONCHANGED: Skipped - no currentTabId set');
      return { valid: false, newState: null };
    }

    const newState = stateChange.newValue;
    if (!newState?.tabs || !Array.isArray(newState.tabs)) {
      console.log('[QuickTabsManager] STORAGE_ONCHANGED: Skipped - invalid state format');
      return { valid: false, newState: null };
    }

    return { valid: true, newState };
  }

  /**
   * Sync filtered tabs with UICoordinator or emit event
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Extracted to reduce onStorageChanged complexity
   * @private
   * @param {Array} filteredTabs - Tabs filtered for this tab
   */
  _syncFilteredTabs(filteredTabs) {
    // Sync state with UICoordinator if available
    if (this.uiCoordinator && typeof this.uiCoordinator.syncState === 'function') {
      this.uiCoordinator.syncState(filteredTabs);
      console.log(
        '[QuickTabsManager] Storage sync:',
        filteredTabs.length,
        'Quick Tabs for this tab'
      );
    } else {
      // Fallback: emit event for manual handling
      if (this.internalEventBus) {
        this.internalEventBus.emit('storage:synced', { tabs: filteredTabs });
      }
      console.log(
        '[QuickTabsManager] Storage sync (event):',
        filteredTabs.length,
        'Quick Tabs for this tab'
      );
    }
  }

  /**
   * Handle storage changes from other tabs (storage.onChanged listener)
   * v1.6.3.8-v12 - GAP-6, GAP-15 fix: Respond to storage changes for cross-tab sync
   *
   * @param {Object} changes - Storage changes object
   * @param {string} areaName - Storage area ('local', 'session', etc.)
   */
  onStorageChanged(changes, areaName) {
    const validation = this._validateStorageChange(changes, areaName);
    if (!validation.valid) {
      return;
    }

    // Filter tabs by originTabId for this tab
    const filteredTabs = validation.newState.tabs.filter(
      tab => tab.originTabId === this.currentTabId
    );

    console.log('[QuickTabsManager] STORAGE_ONCHANGED: Filtered tabs:', {
      totalInStorage: validation.newState.tabs.length,
      filteredForThisTab: filteredTabs.length,
      currentTabId: this.currentTabId
    });

    this._syncFilteredTabs(filteredTabs);
  }

  // ============================================================================
  // v1.6.3.8-v3 - Issue #6: MESSAGE QUEUE METHODS (Race Condition Prevention)
  // ============================================================================

  /**
   * Queue a message for later processing
   * v1.6.3.8-v3 - Issue #6: Buffer messages until handler signals READY
   * v1.6.3.8-v9 - FIX Section 5.3: Add maximum queue size limit (100 messages)
   * Messages received during initialization are queued and replayed later
   *
   * @param {Object} message - Message to queue
   * @param {string} message.type - Message type (e.g., 'storage-update', 'broadcast')
   * @param {Object} message.data - Message payload
   * @param {string} [message.source] - Source of the message (for logging)
   * @returns {boolean} True if message was queued, false if processed immediately
   */
  queueMessage(message) {
    // If already ready, process immediately
    if (this._isReady) {
      return false;
    }

    // v1.6.3.8-v9 - FIX Section 5.3: Check queue size limit before adding
    if (this._messageQueue.length >= MAX_MESSAGE_QUEUE_SIZE) {
      // Drop oldest message to make room for new one
      const droppedMessage = this._messageQueue.shift();
      console.warn('[QuickTabsManager] MESSAGE_QUEUE_OVERFLOW: Dropping oldest message', {
        droppedType: droppedMessage?.type,
        droppedAt: droppedMessage?._queuedAt,
        queueSize: MAX_MESSAGE_QUEUE_SIZE,
        newMessageType: message.type,
        timestamp: Date.now()
      });
    }

    // Add timestamp and queue position for debugging
    const queuedMessage = {
      ...message,
      _queuedAt: Date.now(),
      _queuePosition: this._messageQueue.length
    };

    this._messageQueue.push(queuedMessage);

    // v1.6.3.8-v3 - Issue #6: Log queued message (respects DEBUG_MESSAGING)
    if (DEBUG_MESSAGING) {
      console.log('[QuickTabsManager] INIT_MESSAGE_QUEUED:', {
        type: message.type,
        source: message.source || 'unknown',
        queuePosition: queuedMessage._queuePosition,
        queueLength: this._messageQueue.length,
        maxQueueSize: MAX_MESSAGE_QUEUE_SIZE,
        timestamp: Date.now()
      });
    }

    return true;
  }

  /**
   * Signal that the handler is ready to process messages
   * v1.6.3.8-v3 - Issue #6: Replays all queued messages in order
   * v1.6.3.8-v9 - FIX Issue #20: Now called BEFORE hydration to ensure queued storage
   *               events are processed BEFORE tabs are created from local memory
   * v1.6.3.8-v9 - FIX Issue #21: Enhanced logging with timestamps for init diagnostics
   * Call this after Step 5 (setup) but BEFORE Step 6 (hydration)
   *
   * @param {Function} [messageHandler] - Optional handler function to process messages
   *                                       If not provided, emits 'message:received' events
   */
  signalReady(messageHandler = null) {
    if (this._isReady) {
      console.warn('[QuickTabsManager] signalReady() called but already ready:', {
        timestamp: Date.now(),
        previousReadyTimestamp: this._handlersReadyTimestamp
      });
      return;
    }

    const signalReadyStartTime = Date.now();
    this._isReady = true;
    this._handlersReadyTimestamp = signalReadyStartTime;
    const queuedCount = this._messageQueue.length;

    // v1.6.3.8-v9 - FIX Issue #21: Enhanced logging for init sequence diagnostics
    console.log('[QuickTabsManager] HANDLERS_READY_BARRIER:', {
      status: 'passed',
      prerequisite: 'init() steps 1-5 complete',
      result: '_isReady set to true',
      timestamp: signalReadyStartTime,
      queuedMessageCount: queuedCount,
      timeSinceInit: this._initStartTimestamp
        ? signalReadyStartTime - this._initStartTimestamp
        : null,
      note: 'Message replay starting (before hydration per Issue #20 fix)'
    });

    // Replay queued messages
    if (queuedCount > 0) {
      console.log('[QuickTabsManager] MESSAGE_REPLAY_START:', {
        messageCount: queuedCount,
        timestamp: Date.now(),
        note: 'Replaying queued messages BEFORE hydration'
      });
      this._replayQueuedMessages(messageHandler);
      console.log('[QuickTabsManager] MESSAGE_REPLAY_END:', {
        durationMs: Date.now() - signalReadyStartTime,
        timestamp: Date.now()
      });
    } else {
      console.log('[QuickTabsManager] MESSAGE_QUEUE_EMPTY: No queued messages to replay:', {
        timestamp: Date.now()
      });
    }
  }

  /**
   * Replay queued messages after ready signal
   * v1.6.3.8-v3 - Issue #6: Process queued messages in order
   * v1.6.3.8-v9 - FIX Issue #19: Add conflict detection to skip messages for existing tabs
   * @private
   * @param {Function|null} messageHandler - Handler function or null to emit events
   */
  _replayQueuedMessages(messageHandler) {
    const messagesToReplay = [...this._messageQueue];
    this._messageQueue = []; // Clear queue before replay

    const replayStartTime = Date.now();
    let replayedCount = 0;
    let skippedDuplicates = 0;
    let skippedConflicts = 0;

    for (const message of messagesToReplay) {
      const replayResult = this._replaySingleMessage(message, messageHandler);
      if (replayResult.replayed) {
        replayedCount++;
      } else if (replayResult.reason === 'duplicate') {
        skippedDuplicates++;
      } else if (replayResult.reason === 'conflict') {
        skippedConflicts++;
      }
    }

    console.log('[QuickTabsManager] INIT_MESSAGE_REPLAY_COMPLETE:', {
      totalQueued: messagesToReplay.length,
      replayedCount,
      skippedDuplicates,
      skippedConflicts,
      totalReplayTimeMs: Date.now() - replayStartTime,
      timestamp: Date.now()
    });
  }

  /**
   * Replay a single queued message with conflict detection
   * v1.6.3.8-v3 - Issue #6: Extracted to reduce _replayQueuedMessages max-depth
   * v1.6.3.8-v9 - FIX Issue #19: Add conflict detection for existing tabs
   * @private
   * @returns {{replayed: boolean, reason: string}} Result of replay attempt
   */
  _replaySingleMessage(message, messageHandler) {
    const replayDelay = Date.now() - message._queuedAt;

    // v1.6.3.8-v9 - FIX Issue #19: Check for conflicts with existing tabs
    const conflictCheck = this._checkMessageConflict(message);
    if (conflictCheck.hasConflict) {
      if (DEBUG_MESSAGING) {
        console.log('[QuickTabsManager] INIT_MESSAGE_SKIPPED (conflict):', {
          type: message.type,
          tabId: conflictCheck.tabId,
          reason: conflictCheck.reason,
          queuedAt: message._queuedAt,
          timestamp: Date.now()
        });
      }
      return { replayed: false, reason: conflictCheck.reason };
    }

    // v1.6.3.8-v3 - Issue #6: Log message replay
    if (DEBUG_MESSAGING) {
      console.log('[QuickTabsManager] INIT_MESSAGE_REPLAY:', {
        type: message.type,
        source: message.source || 'unknown',
        originalQueuePosition: message._queuePosition,
        queuedAt: message._queuedAt,
        replayDelayMs: replayDelay,
        timestamp: Date.now()
      });
    }

    this._processMessageWithHandler(message, messageHandler);
    return { replayed: true, reason: 'success' };
  }

  /**
   * Check if a queued message conflicts with existing state
   * v1.6.3.8-v9 - FIX Issue #19: Conflict detection for message replay
   * @private
   * @param {Object} message - Queued message to check
   * @returns {{hasConflict: boolean, tabId: string|null, reason: string}}
   */
  _checkMessageConflict(message) {
    // Extract tab ID from message based on message type
    const tabId = this._extractTabIdFromMessage(message);
    if (!tabId) {
      // No tab ID in message, can't detect conflicts - allow replay
      return { hasConflict: false, tabId: null, reason: 'no-tab-id' };
    }

    // v1.6.3.8-v9 - FIX Issue #19: Check if tab already exists in local state
    // If tab exists in this.tabs Map, hydration created it with newer state
    const existsInTabs = this.tabs.has(tabId);
    if (existsInTabs) {
      // v1.6.3.8-v9 - FIX Issue #19: Tab exists - compare message timestamp with hydration
      // Queued messages are from BEFORE signalReady(), hydration happens AFTER signalReady()
      // Therefore, hydration state is always newer than queued messages - skip the message
      return {
        hasConflict: true,
        tabId,
        reason: 'duplicate',
        note: 'Tab already exists in tabs Map - hydration has newer state'
      };
    }

    // v1.6.3.8-v9 - FIX Issue #19: Check for stale destructive operations
    return this._checkStaleDestructiveMessage(message, tabId, existsInTabs);
  }

  /**
   * Check if a message is a stale destructive operation
   * v1.6.3.8-v9 - FIX Issue #19: Extracted to reduce _checkMessageConflict complexity
   * @private
   * @param {Object} message - Message to check
   * @param {string} tabId - Extracted tab ID
   * @param {boolean} existsInTabs - Whether tab exists in tabs Map
   * @returns {{hasConflict: boolean, tabId: string, reason: string}}
   */
  _checkStaleDestructiveMessage(message, tabId, existsInTabs) {
    // v1.6.3.8-v9 - FIX Issue #19: Check for contradictory operations
    // If message is trying to update/delete a tab that doesn't exist, it's stale
    const messageType = message.type || message.action || '';
    const isDestructiveMessage = this._isDestructiveMessageType(messageType);

    if (isDestructiveMessage && !existsInTabs) {
      // Trying to delete a tab that doesn't exist - message is stale
      return {
        hasConflict: true,
        tabId,
        reason: 'conflict',
        note: 'Delete message for non-existent tab - message is stale'
      };
    }

    return { hasConflict: false, tabId, reason: 'no-conflict' };
  }

  /**
   * Check if a message type indicates a destructive operation
   * v1.6.3.8-v9 - FIX Issue #19: Extracted to reduce complexity
   * v1.6.3.8-v9 - Code Review Fix: Use RegExp for better performance
   * @private
   * @param {string} messageType - Message type to check
   * @returns {boolean} True if destructive (delete/remove/destroy/close)
   */
  _isDestructiveMessageType(messageType) {
    // v1.6.3.8-v9 - Code Review Fix: Use optional chaining with early return
    if (!messageType?.includes) {
      return false;
    }
    // v1.6.3.8-v9 - Code Review Fix: Use RegExp for better performance
    return /delete|remove|destroy|close/i.test(messageType);
  }

  /**
   * Extract tab ID from a message object
   * v1.6.3.8-v9 - FIX Issue #19: Helper for conflict detection
   * @private
   * @param {Object} message - Message to extract tab ID from
   * @returns {string|null} Tab ID or null if not found
   */
  _extractTabIdFromMessage(message) {
    // Try various common locations for tab ID in messages
    if (message.data?.id) return message.data.id;
    if (message.data?.tabId) return message.data.tabId;
    if (message.data?.quickTabId) return message.data.quickTabId;
    if (message.data?.quickTab?.id) return message.data.quickTab.id;
    if (message.id) return message.id;
    if (message.tabId) return message.tabId;
    if (message.quickTabId) return message.quickTabId;
    return null;
  }

  /**
   * Process a message with the given handler
   * v1.6.3.8-v3 - Issue #6: Extracted to reduce nesting depth
   * @private
   */
  _processMessageWithHandler(message, messageHandler) {
    try {
      if (messageHandler) {
        messageHandler(message);
      } else {
        this.internalEventBus.emit('message:received', message);
      }
    } catch (err) {
      console.error('[QuickTabsManager] Error replaying queued message:', {
        type: message.type,
        error: err.message,
        stack: err.stack
      });
    }
  }

  /**
   * Check if the handler is ready to process messages
   * v1.6.3.8-v3 - Issue #6: Used to check if messages should be queued
   * @returns {boolean} True if ready, false if messages should be queued
   */
  isReady() {
    return this._isReady;
  }

  /**
   * Get the current message queue length
   * v1.6.3.8-v3 - Issue #6: For diagnostics and testing
   * @returns {number} Number of messages in queue
   */
  getQueueLength() {
    return this._messageQueue.length;
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
