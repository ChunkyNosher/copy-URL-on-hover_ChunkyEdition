/**
 * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.4 - FIX Bug #2: Persist to storage after minimize/restore
 * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.3.4-v6 - FIX Issues #1, #2, #6: Debounce minimize/restore, prevent event storms
 * v1.6.3.2 - FIX Issue #2: Add mutex/lock pattern to prevent duplicate operations
 * v1.6.3.3 - FIX 14 Critical Bugs:
 *   - Issue #1: Re-register window in quickTabsMap after restore
 *   - Issue #3: Remove spurious "Tab not found" warnings during normal operations
 * v1.6.3.4 - FIX Issues #2, #5, #6:
 *   - Issue #2: Atomic Map/DOM cleanup on minimize
 *   - Issue #5: Explicit Map deletion with logging
 *   - Issue #6: Source parameter for all operations
 * v1.6.3.4-v2 - FIX Issue #5: Add isRestoreOperation flag for entity-instance state desync
 * v1.6.3.4-v6 - FIX Issue #6: Ensure sync point after restore before persist
 * v1.6.3.5-v5 - FIX Quick Tab Restore Diagnostic Issues:
 *   - Issue #1: DOM state verification after restore with rollback on failure
 *   - Issue #2: Promise-based sequencing replaces timer-based coordination
 *   - Issue #3: Promise chaining enforces event->storage execution order
 *   - Issue #4: Try/catch in all timer callbacks with context markers
 *   - Issue #6: Transaction pattern with rollback capability
 * v1.6.3.5-v6 - FIX Diagnostic Issue #1: Remove DOM verification rollback
 *   - Issue #1: Removed DOM verification rollback that caused infinite restore deadlock
 *   - Trust UICoordinator to handle rendering via event-driven architecture
 * v1.6.3.5-v8 - FIX Diagnostic Issues #4, #5, #10:
 *   - Issue #4: Z-index sync after restore via dedicated z-index update
 *   - Issue #5: Stable restore persistence via skip-if-unchanged check
 *   - Issue #10: Enhanced logging with tab context
 * v1.6.3.5-v11 - FIX Critical Quick Tab Bugs:
 *   - Issue #2: Re-wire callbacks after restore using tabWindow.rewireCallbacks()
 *   - Issue #4: Check tabWindow.isMinimizing/isRestoring flags instead of time-based suppression
 *   - Issue #7: Z-index sync - ensure entity.zIndex is used, add validation
 *   - Issue #8: Defensive checks in handleFocus() before updateZIndex()
 *   - Issue #9: Comprehensive z-index operation logging
 *   - Issue #10: Stale onFocus callback - part of callback re-wiring
 * v1.6.3.6-v6 - FIX Restore Bug: Enhanced originTabId logging in restore flow
 *   - Log originTabId in _performTabWindowRestore() before and after restore
 *   - Log originTabId in _verifyRestoreAndEmit() verification
 *   - Log originTabId in _emitRestoreStateUpdateSync() event payload
 * v1.6.3.10-v4 - FIX Critical Cross-Tab Operation Validation (Issues 9-16):
 *   - Issue #9: Cross-tab ownership validation for all visibility operations
 *   - Issue #10: Focus operation z-index leakage prevention
 *   - Issue #14: Mutex lock pattern includes tab context to prevent cross-tab conflicts
 *   - Issue #15: Storage persistence filter - only persist owned Quick Tabs
 * v1.6.3.10-v5 - Note: Remote invocations from Manager sidebar now use Scripting API fallback
 *   - See background.js executeManagerCommand() for timeout-protected messaging
 *   - Falls back to browser.scripting.executeScript on messaging failure
 * v1.6.3.11-v9 - FIX Diagnostic Report Issues:
 *   - Issue 3.2: Z-index recycling threshold lowered from 100000 to 10000
 *   - Issue 5: Container isolation validation added to all visibility operations
 *   - Issue I: Debounce timer captures currentTabId at schedule time, not fire time
 * v1.6.4 - Removed Solo/Mute visibility control (Quick Tabs always visible on all tabs)
 *
 * Architecture (Single-Tab Model v1.6.3+):
 * - Each tab manages visibility only for Quick Tabs it owns (originTabId matches)
 * - Storage used for persistence and hydration, not for cross-tab sync
 * - Mutex/lock pattern prevents duplicate operations from multiple sources
 * - Cross-tab validation ensures operations only affect owned Quick Tabs
 * - v1.6.3.10-v5: Remote commands from Manager use Scripting API fallback for reliability
 * - v1.6.3.11-v9: Container isolation enforced in runtime operations
 *
 * Responsibilities:
 * - Handle minimize operation with DOM cleanup
 * - Handle restore operation (trusts UICoordinator for rendering)
 * - Handle focus operation (bring to front)
 * - Emit events for coordinators
 * - Persist state to storage after visibility changes
 * - Cross-tab ownership validation for all operations
 * - Container isolation validation for all operations
 *
 * @version 1.6.4
 */

import {
  buildStateForStorage,
  persistStateToStorage,
  validateStateForPersist,
  STATE_KEY,
  getBrowserStorageAPI,
  getWritingContainerId, // v1.6.3.11-v9 - FIX Issue 5: Container validation in runtime ops
  getStorageCoordinator, // v1.6.3.12 - FIX Issue #14: Centralized write coordination
  saveZIndexCounter, // v1.6.3.12 - FIX Issue #17: Z-index counter persistence
  saveZIndexCounterWithAck, // v1.6.3.12-v5 - FIX Issue #17: Atomic z-index persistence
  QUEUE_PRIORITY // v1.6.3.12-v5 - FIX Issue #16: Queue priority constants
} from '@utils/storage-utils.js';

// v1.6.3.4-v5 - FIX Issue #6: Adjusted timing to ensure state:updated event fires BEFORE storage persistence
// STATE_EMIT_DELAY_MS must be LESS THAN MINIMIZE_DEBOUNCE_MS to prevent race condition
// Old values: MINIMIZE_DEBOUNCE_MS=150, STATE_EMIT_DELAY_MS=200 (race condition!)
// New values: STATE_EMIT_DELAY_MS=100, MINIMIZE_DEBOUNCE_MS=200 (correct order)
const MINIMIZE_DEBOUNCE_MS = 200;

// v1.6.3.2 - FIX Issue #2: Lock duration to prevent duplicate operations from multiple sources
const OPERATION_LOCK_MS = 200;

// v1.6.3.4-v5 - FIX Issue #6: Reduced delay to ensure event fires before storage persist
// 100ms gives UICoordinator time to render but fires before MINIMIZE_DEBOUNCE_MS (200ms)
const STATE_EMIT_DELAY_MS = 100;

// v1.6.3.4-v8 - FIX Issue #3: Delay before clearing operation suppression flag
// 50ms allows any pending callbacks to be suppressed while still being quick enough
// to not interfere with subsequent legitimate operations
const CALLBACK_SUPPRESSION_DELAY_MS = 50;

// v1.6.3.5-v6 - FIX Issue #1: Reduced delay - DOM verification is no longer used for rollback
// Keep a short delay for event emission sequencing only
const DOM_VERIFICATION_DELAY_MS = 50;

// v1.6.3.10-v10 - FIX Issue 10.1: Timeout for _persistToStorage to prevent indefinite hangs
// If storage write hangs, we log error and mark storage as potentially unavailable
const PERSIST_STORAGE_TIMEOUT_MS = 5000;

// v1.6.3.11-v9 - FIX Issue 3.2: Z-index recycling threshold (lowered from 100000)
// When z-index counter exceeds this value, recycle all z-indices to prevent unbounded growth
const Z_INDEX_RECYCLE_THRESHOLD = 10000;

/**
 * VisibilityHandler class
 * Manages Quick Tab visibility states (solo, mute, minimize, focus)
 * v1.6.3 - Single-tab only (storage used for persistence, not cross-tab sync)
 * v1.6.3.4 - Now persists state to storage after minimize/restore
 * v1.6.3.4-v2 - Proper async handling with validation and timeout for storage
 * v1.6.3.4-v6 - Debouncing to prevent event storms and ensure atomic storage writes
 * v1.6.3.2 - Mutex/lock pattern to prevent duplicate operations from multiple sources
 * v1.6.3.5-v2 - FIX Report 1 Issue #7: Enhanced logging with Tab ID prefix
 * v1.6.3.5-v5 - FIX Diagnostic Issues #1, #2, #3, #4, #6: Promise-based coordination
 * v1.6.3.5-v6 - FIX Diagnostic Issue #1: Removed DOM verification rollback
 */
export class VisibilityHandler {
  /**
   * @param {Object} options - Configuration options
   * @param {Map} options.quickTabsMap - Map of Quick Tab instances
   * @param {MinimizedManager} options.minimizedManager - Manager for minimized Quick Tabs
   * @param {EventEmitter} options.eventBus - Event bus for internal communication
   * @param {Object} options.currentZIndex - Reference object with value property for z-index
   * @param {number} options.currentTabId - Current browser tab ID
   * @param {Object} options.Events - Events constants object
   * @param {string} options.currentContainerId - Current container ID (v1.6.3.11-v9)
   */
  constructor(options) {
    this.quickTabsMap = options.quickTabsMap;
    this.minimizedManager = options.minimizedManager;
    this.eventBus = options.eventBus;
    this.currentZIndex = options.currentZIndex;
    this.currentTabId = options.currentTabId;
    this.Events = options.Events;

    // v1.6.3.11-v9 - FIX Issue 5: Container isolation in runtime operations
    // Store container ID for runtime container validation
    this.currentContainerId = options.currentContainerId ?? getWritingContainerId() ?? null;

    // v1.6.3.5-v2 - FIX Report 1 Issue #7: Create log prefix with Tab ID
    this._logPrefix = `[VisibilityHandler][Tab ${options.currentTabId ?? 'unknown'}]`;

    // v1.6.3.4-v6 - FIX Issues #1, #2: Track pending operations to prevent duplicates
    this._pendingMinimize = new Set();
    this._pendingRestore = new Set();
    this._debounceTimers = new Map();

    // v1.6.3.5 - FIX Issue #4: Replace generation counter with active timer IDs Set
    // Old approach (generation counter) had a flaw: rapid operations caused ALL timers to skip
    // because generation was incremented but all timers checked against the latest value.
    // New approach: Each timer has a unique ID, and we track which IDs are still active.
    // When timer fires, it checks if its ID is still in the Set before executing.
    this._activeTimerIds = new Set(); // Set of active timer ID strings
    this._timerIdCounter = 0; // Counter for generating unique timer IDs

    // v1.6.3.2 - FIX Issue #2: Mutex/lock pattern for operations
    // Key: operation-id (e.g., "minimize-qt-123"), Value: timestamp when lock was acquired
    this._operationLocks = new Map();

    // v1.6.3.4-v8 - FIX Issue #3: Track operations initiated by this handler
    // to suppress callbacks that would cause circular propagation
    this._initiatedOperations = new Set();

    // v1.6.3.4-v8 - FIX Issue #6: Track recent focus events for debouncing
    this._lastFocusTime = new Map(); // id -> timestamp

    // v1.6.3.10-v10 - FIX Issue 10.1: Track storage availability
    // Set to false if storage write times out to prevent further hangs
    this._storageAvailable = true;
    this._storageTimeoutCount = 0;
  }

  /**
   * Unified container validation helper for all operations
   * v1.6.3.12-v5 - FIX Issue #20: Single source of truth for container validation logic
   * Ensures consistent behavior across all code paths:
   * - Case 1: currentContainerId is null/undefined → fail-closed (deny operation for safety)
   * - Case 2: Legacy Quick Tab (no originContainerId) → allow for backward compatibility
   * - Case 3: Container IDs must match → allow if match, deny if mismatch
   * @private
   * @param {Object} quickTab - Quick Tab window instance
   * @param {string} operation - Operation name for logging
   * @returns {{ valid: boolean, reason: string }}
   */
  _validateContainerForOperation(quickTab, operation) {
    const logPrefix = `${this._logPrefix} [CONTAINER_VALIDATION] ${operation}`;

    // Case 1: Current container ID unknown - fail-closed for safety
    // This handles the edge case where identity system hasn't initialized
    if (this.currentContainerId === null || this.currentContainerId === undefined) {
      // Only log warning if Quick Tab has container info (not legacy)
      if (quickTab?.originContainerId) {
        console.warn(`${logPrefix}: currentContainerId is null - denying operation for safety`, {
          quickTabId: quickTab?.id,
          originContainerId: quickTab?.originContainerId
        });
      }
      return { valid: false, reason: 'currentContainerId_unknown' };
    }

    // Case 2: Legacy Quick Tab (no container info) - allow for backward compatibility
    // Quick Tabs created before container tracking was added won't have originContainerId
    if (quickTab?.originContainerId === null || quickTab?.originContainerId === undefined) {
      console.log(`${logPrefix}: Legacy Quick Tab (no originContainerId) - allowing`, {
        quickTabId: quickTab?.id,
        currentContainerId: this.currentContainerId
      });
      return { valid: true, reason: 'legacy_quicktab' };
    }

    // Case 3: Container IDs must match for container isolation
    const matches = quickTab.originContainerId === this.currentContainerId;
    if (!matches) {
      console.warn(`${logPrefix}: Container mismatch - blocking`, {
        quickTabId: quickTab.id,
        originContainerId: quickTab.originContainerId,
        currentContainerId: this.currentContainerId
      });
      return { valid: false, reason: 'container_mismatch' };
    }

    return { valid: true, reason: 'container_match' };
  }

  /**
   * Check if a tabWindow is owned by the current tab
   * v1.6.3.10-v4 - FIX Issue #9: Extracted to reduce duplication (Code Review feedback)
   * v1.6.3.11-v9 - FIX Issue 5: Now also validates container ID for container isolation
   * v1.6.3.12-v5 - FIX Issue #20: Now uses unified _validateContainerForOperation helper
   * @private
   * @param {Object} tabWindow - Quick Tab window instance
   * @returns {boolean} True if owned by current tab or ownership is unset
   */
  _isOwnedByCurrentTab(tabWindow) {
    // If originTabId is not set, consider it owned (backwards compatibility)
    if (tabWindow.originTabId === null || tabWindow.originTabId === undefined) {
      return true;
    }
    // Check if originTabId matches current tab
    const tabIdMatch = tabWindow.originTabId === this.currentTabId;
    if (!tabIdMatch) {
      return false;
    }

    // v1.6.3.12-v5 - FIX Issue #20: Use unified container validation helper
    const containerValidation = this._validateContainerForOperation(tabWindow, 'ownership_check');
    return containerValidation.valid;
  }

  /**
   * Validate container isolation for an operation
   * v1.6.3.11-v9 - FIX Issue 5: Container validation for runtime operations
   * v1.6.3.12-v5 - FIX Issue #20: Now uses unified _validateContainerForOperation helper
   * @private
   * @param {Object} tabWindow - Quick Tab window instance
   * @param {string} operation - Operation name for logging
   * @returns {{ valid: boolean, reason?: string }}
   */
  _validateContainerIsolation(tabWindow, operation) {
    // v1.6.3.12-v5 - FIX Issue #20: Delegate to unified helper
    const result = this._validateContainerForOperation(tabWindow, operation);
    // Transform reason to match legacy format for backward compatibility
    if (!result.valid) {
      if (result.reason === 'currentContainerId_unknown') {
        return { valid: false, reason: 'CURRENT_CONTAINER_UNKNOWN' };
      }
      if (result.reason === 'container_mismatch') {
        return { valid: false, reason: 'CONTAINER_MISMATCH' };
      }
    }
    return { valid: result.valid };
  }

  /**
   * Validate cross-tab ownership for an operation
   * v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation helper
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} operation - Operation name for logging
   * @param {string} source - Source of action
   * @returns {{ valid: boolean, tabWindow?: Object, result?: Object }}
   */
  _validateCrossTabOwnership(id, operation, source = 'unknown') {
    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      return { valid: true, tabWindow: null }; // Let caller handle missing tab
    }

    // v1.6.3.10-v4 - FIX Issue #9: Use shared ownership check
    if (!this._isOwnedByCurrentTab(tabWindow)) {
      console.warn(
        `${this._logPrefix} CROSS-TAB BLOCKED: Cannot ${operation} Quick Tab from different tab:`,
        {
          id,
          originTabId: tabWindow.originTabId,
          currentTabId: this.currentTabId,
          source
        }
      );
      return {
        valid: false,
        tabWindow,
        result: { success: false, error: 'Cross-tab operation rejected' }
      };
    }

    return { valid: true, tabWindow };
  }

  /**
   * Extract position from tabWindow
   * @private
   * @param {Object} tabWindow - Quick Tab window instance
   * @returns {{ left: number, top: number }|null}
   */
  _extractPosition(tabWindow) {
    if (!tabWindow) return null;
    return { left: tabWindow.left, top: tabWindow.top };
  }

  /**
   * Extract size from tabWindow
   * @private
   * @param {Object} tabWindow - Quick Tab window instance
   * @returns {{ width: number, height: number }|null}
   */
  _extractSize(tabWindow) {
    if (!tabWindow) return null;
    return { width: tabWindow.width, height: tabWindow.height };
  }

  /**
   * Create minimal Quick Tab data object for state:updated events
   * v1.6.3.1 - Helper to reduce code duplication
   * v1.6.3.4-v9 - FIX Issue #14: Include complete entity data (url, position, size, title, container)
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance
   * @param {boolean} minimized - Minimized state
   * @returns {Object} Quick Tab data for event emission
   */
  _createQuickTabData(id, tabWindow, minimized) {
    return {
      id,
      minimized,
      url: tabWindow?.url,
      title: tabWindow?.title,
      position: this._extractPosition(tabWindow),
      size: this._extractSize(tabWindow),
      container: tabWindow?.cookieStoreId || tabWindow?.container || null,
      zIndex: tabWindow?.zIndex
    };
  }

  /**
   * Get browser storage API with validation
   * @private
   * @returns {Object|null} Browser storage API or null if unavailable
   */
  _getStorageAPI() {
    const browserAPI = getBrowserStorageAPI();
    if (!browserAPI?.storage?.local) {
      console.warn('[VisibilityHandler] Storage API not available for entity fetch');
      return null;
    }
    return browserAPI.storage.local;
  }

  /**
   * Find entity by ID in state tabs array
   * @private
   * @param {Object} state - Storage state object
   * @param {string} id - Quick Tab ID to find
   * @returns {Object|null} Entity or null if not found
   */
  _findEntityInState(state, id) {
    if (!state?.tabs || !Array.isArray(state.tabs)) {
      console.log('[VisibilityHandler] No state found in storage for entity fetch');
      return null;
    }

    const entity = state.tabs.find(tab => tab.id === id);
    if (!entity) {
      console.log('[VisibilityHandler] Entity not found in storage:', id);
      return null;
    }

    console.log('[VisibilityHandler] Fetched entity from storage:', { id, url: entity.url });
    return entity;
  }

  /**
   * Fetch entity data from storage for event payload when tabWindow is not available
   * v1.6.3.4-v9 - FIX Issue #14: Ensure complete event payload
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object|null>} Entity data or null if not found
   */
  async _fetchEntityFromStorage(id) {
    try {
      const storageAPI = this._getStorageAPI();
      if (!storageAPI) return null;

      const result = await storageAPI.get(STATE_KEY);
      return this._findEntityInState(result?.[STATE_KEY], id);
    } catch (err) {
      console.error('[VisibilityHandler] Error fetching entity from storage:', err);
      return null;
    }
  }

  /**
   * Validate that event payload has all required fields
   * v1.6.3.4-v9 - FIX Issue #14: Prevent incomplete event emission
   * @private
   * @param {Object} quickTabData - Event payload to validate
   * @returns {{ valid: boolean, missingFields: string[] }}
   */
  _validateEventPayload(quickTabData) {
    const requiredFields = ['id', 'url'];
    // Check for null, undefined, or empty string values
    const missingFields = requiredFields.filter(
      field =>
        !(field in quickTabData) ||
        quickTabData[field] === null ||
        quickTabData[field] === undefined ||
        quickTabData[field] === ''
    );

    return {
      valid: missingFields.length === 0,
      missingFields
    };
  }

  /**
   * Try to acquire a lock for an operation
   * v1.6.3.2 - FIX Issue #2: Mutex pattern to prevent duplicate operations
   * @private
   * @param {string} operation - Operation type ('minimize' or 'restore')
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if lock acquired, false if operation already in progress
   */
  _tryAcquireLock(operation, id) {
    // v1.6.3.10-v4 - FIX Issue #14: Include tab context to prevent cross-tab lock conflicts
    const lockKey = `${operation}-${this.currentTabId}-${id}`;
    const now = Date.now();
    const existingLock = this._operationLocks.get(lockKey);

    // If lock exists and hasn't expired, operation is in progress
    if (existingLock && now - existingLock < OPERATION_LOCK_MS) {
      console.log(`[VisibilityHandler] Lock blocked duplicate ${operation} for:`, id);
      return false;
    }

    // Acquire lock
    this._operationLocks.set(lockKey, now);
    return true;
  }

  /**
   * Release a lock for an operation
   * v1.6.3.2 - FIX Issue #2: Mutex pattern cleanup
   * v1.6.3.10-v4 - FIX Issue #14: Include tab context in lock key
   * @private
   * @param {string} operation - Operation type ('minimize' or 'restore')
   * @param {string} id - Quick Tab ID
   */
  _releaseLock(operation, id) {
    // v1.6.3.10-v4 - FIX Issue #14: Include tab context in lock key
    const lockKey = `${operation}-${this.currentTabId}-${id}`;
    this._operationLocks.delete(lockKey);
  }

  /**
   * Check minimize preconditions
   * v1.6.3.5-v11 - Extracted to reduce handleMinimize complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object|null} tabWindow - TabWindow instance
   * @param {string} source - Source of action
   * @returns {{ canProceed: boolean, result?: Object }}
   */
  _checkMinimizePreconditions(id, tabWindow, source) {
    // Check operation-specific flag
    if (tabWindow?.isMinimizing) {
      console.log(
        `${this._logPrefix} Suppressing callback (tabWindow.isMinimizing=true, source: ${source}):`,
        id
      );
      return {
        canProceed: false,
        result: { success: true, error: 'Suppressed - minimize in progress' }
      };
    }

    // Check callback re-entry
    const operationKey = `minimize-${id}`;
    if (this._initiatedOperations.has(operationKey)) {
      console.log(
        `${this._logPrefix} Suppressing callback re-entry for minimize (source: ${source}):`,
        id
      );
      return { canProceed: false, result: { success: true, error: 'Suppressed callback' } };
    }

    // Check mutex lock
    if (!this._tryAcquireLock('minimize', id)) {
      console.log(
        `${this._logPrefix} Ignoring duplicate minimize request (lock held, source: ${source}) for:`,
        id
      );
      return { canProceed: false, result: { success: false, error: 'Operation lock held' } };
    }

    // Check pending flag
    if (this._pendingMinimize.has(id)) {
      console.log(
        `${this._logPrefix} Ignoring duplicate minimize request (pending, source: ${source}) for:`,
        id
      );
      this._releaseLock('minimize', id);
      return { canProceed: false, result: { success: false, error: 'Operation pending' } };
    }

    return { canProceed: true };
  }

  /**
   * Validate and get tabWindow instance for minimize
   * v1.6.3.5-v11 - Extracted to reduce handleMinimize complexity
   * @private
   */
  _validateMinimizeInstance(id, tabWindow, source) {
    // Re-fetch tabWindow in case it wasn't available before
    const tabWindowInstance = tabWindow || this.quickTabsMap.get(id);
    if (!tabWindowInstance) {
      console.warn(`${this._logPrefix} Tab not found for minimize (source: ${source}):`, id);
      return { valid: false, result: { success: false, error: 'Tab not found' } };
    }

    // Validate this is a real QuickTabWindow instance
    if (typeof tabWindowInstance.minimize !== 'function') {
      console.error(
        `${this._logPrefix} Invalid tab instance (not QuickTabWindow, source: ${source}):`,
        {
          id,
          type: tabWindowInstance.constructor?.name,
          hasMinimize: typeof tabWindowInstance.minimize
        }
      );
      this.quickTabsMap.delete(id);
      return {
        valid: false,
        result: { success: false, error: 'Invalid tab instance (not QuickTabWindow)' }
      };
    }

    return { valid: true, instance: tabWindowInstance };
  }

  /**
   * Handle Quick Tab minimize
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.1 - FIX Bug #7: Emit state:updated for panel sync
   * v1.6.3.4 - FIX Bug #2: Persist to storage after minimize
   * v1.6.3.4-v5 - FIX Bug #6: Call tabWindow.minimize() to actually hide the window
   * v1.6.3.4-v6 - FIX Issues #1, #2: Debounce to prevent event storms
   * v1.6.3.2 - FIX Issue #2: Use mutex/lock pattern for true duplicate prevention
   * v1.6.3.4 - FIX Issues #5, #6: Atomic Map cleanup, source logging
   * v1.6.3.4-v5 - FIX Issue #7: Update entity.minimized = true FIRST (entity is source of truth)
   * v1.6.3.4-v7 - FIX Issues #3, #6: Instance validation and try/finally for lock cleanup
   * v1.6.3.4-v8 - FIX Issue #3: Suppress callbacks during handler-initiated operations
   * v1.6.3.5-v11 - FIX Issue #4: Check tabWindow.isMinimizing flag for operation-specific suppression
   * v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   * @returns {{ success: boolean, error?: string }} Result object for message handlers
   */
  handleMinimize(id, source = 'unknown') {
    // v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
    const ownershipValidation = this._validateCrossTabOwnership(id, 'minimize', source);
    if (!ownershipValidation.valid) {
      return ownershipValidation.result;
    }

    const tabWindow = this.quickTabsMap.get(id);

    // v1.6.3.5-v11 - FIX Issue #4: Check preconditions
    const preconditions = this._checkMinimizePreconditions(id, tabWindow, source);
    if (!preconditions.canProceed) {
      return preconditions.result;
    }

    // v1.6.3.4-v7 - FIX Issue #6: Use try/finally to ensure lock is ALWAYS released
    try {
      console.log(
        `${this._logPrefix} Minimize button clicked (source: ${source}) for Quick Tab:`,
        id
      );

      // Validate instance
      const validation = this._validateMinimizeInstance(id, tabWindow, source);
      if (!validation.valid) {
        return validation.result;
      }
      const tabWindowInstance = validation.instance;

      // v1.6.3.4-v6 - FIX Issue #1: Mark as pending to prevent duplicate clicks
      this._pendingMinimize.add(id);

      // v1.6.3.4-v5 - FIX Issue #7: Update entity.minimized = true FIRST (entity is source of truth)
      // Note: tabWindowInstance IS the entity in quickTabsMap - they reference the same object
      // This must happen BEFORE calling minimizedManager.add() or tabWindowInstance.minimize()
      // so that all downstream reads see the correct state
      console.log(
        `${this._logPrefix} Updating entity.minimized = true (source: ${source}) for:`,
        id
      );
      tabWindowInstance.minimized = true;

      // v1.6.3.5-v7 - FIX Issue #6: Set domVerified: false when minimizing
      // This ensures minimize state is explicitly tracked and survives reload
      tabWindowInstance.domVerified = false;
      console.log(
        `${this._logPrefix} Set domVerified = false for minimize (source: ${source}):`,
        id
      );

      // Add to minimized manager BEFORE calling minimize (to capture correct position/size)
      // v1.6.3.5-v2 - FIX Report 1 Issue #7: Log snapshot lifecycle
      console.log(`${this._logPrefix} Creating snapshot (source: ${source}) for:`, id);
      this.minimizedManager.add(id, tabWindowInstance);

      // v1.6.3.4-v8 - FIX Issue #3: Mark this operation as initiated by handler to suppress callback
      const operationKey = `minimize-${id}`;
      this._initiatedOperations.add(operationKey);
      try {
        // v1.6.3.4-v5 - FIX Bug #6: Actually minimize the window (hide it)
        tabWindowInstance.minimize();
        console.log(
          `${this._logPrefix} Called tabWindowInstance.minimize() (source: ${source}) for:`,
          id
        );
      } finally {
        // v1.6.3.4-v8 - Clear the suppression flag after short delay (allows any pending callbacks)
        setTimeout(
          () => this._initiatedOperations.delete(operationKey),
          CALLBACK_SUPPRESSION_DELAY_MS
        );
      }

      // v1.6.3.4 - FIX Issue #5: Do NOT delete from Map during minimize
      // The tab still exists, it's just hidden. Map entry needed for restore.
      // Note: tabWindowInstance.minimize() already sets container = null, so isRendered() will be false

      // Emit minimize event for legacy handlers
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id, source });
      }

      // v1.6.3.1 - FIX Bug #7: Emit state:updated for panel to refresh
      // This allows PanelContentManager to update when Quick Tab is minimized from its window
      if (this.eventBus) {
        const quickTabData = this._createQuickTabData(id, tabWindowInstance, true);
        quickTabData.source = source; // v1.6.3.4 - FIX Issue #6: Add source
        quickTabData.domVerified = false; // v1.6.3.5-v7 - FIX Issue #6
        this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
        console.log(
          `${this._logPrefix} Emitted state:updated for minimize (source: ${source}):`,
          id
        );
      }

      // v1.6.3.4-v6 - FIX Issue #6: Persist to storage with debounce
      this._debouncedPersist(id, 'minimize', source);

      // v1.6.3.11-v12 - FIX Issue #2: Send QUICKTAB_MINIMIZED message to sidebar for immediate update
      // Fire-and-forget pattern - errors are handled internally by _sendMinimizeMessage
      this._sendMinimizeMessage(id, true, source).catch(() => {
        // Error already logged by _sendMinimizeMessage
      });

      return { success: true };
    } finally {
      // v1.6.3.4-v7 - FIX Issue #6: Guarantee lock release even on exceptions
      this._releaseLock('minimize', id);
    }
  }

  /**
   * Send QUICKTAB_MINIMIZED message to background for sidebar notification
   * v1.6.3.11-v12 - FIX Issue #2 & #5: Direct message to sidebar via background
   * @private
   * @param {string} id - Quick Tab ID
   * @param {boolean} minimized - New minimized state
   * @param {string} source - Source of action
   */
  async _sendMinimizeMessage(id, minimized, source) {
    try {
      console.log(
        `${this._logPrefix} [MINIMIZE_MESSAGE] Sending QUICKTAB_MINIMIZED:`,
        { id, minimized, source, originTabId: this.currentTabId }
      );

      await browser.runtime.sendMessage({
        type: 'QUICKTAB_MINIMIZED',
        quickTabId: id,
        minimized,
        originTabId: this.currentTabId,
        source: source || 'VisibilityHandler',
        timestamp: Date.now()
      });

      console.log(
        `${this._logPrefix} [MINIMIZE_MESSAGE] Sent successfully:`,
        { id, minimized }
      );
    } catch (err) {
      // Background may not be available - this is non-critical
      console.debug(
        `${this._logPrefix} [MINIMIZE_MESSAGE] Could not send:`,
        { id, error: err.message }
      );
    }
  }

  /**
   * Check if restore operation can proceed
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @returns {boolean} True if operation can proceed
   */
  _canProceedWithRestore(id, source = 'unknown') {
    // Check mutex lock
    if (!this._tryAcquireLock('restore', id)) {
      console.log(
        `[VisibilityHandler] Ignoring duplicate restore request (lock held, source: ${source}) for:`,
        id
      );
      return false;
    }

    // Check pending flag
    if (this._pendingRestore.has(id)) {
      console.log(
        `[VisibilityHandler] Ignoring duplicate restore request (pending, source: ${source}) for:`,
        id
      );
      this._releaseLock('restore', id);
      return false;
    }

    return true;
  }

  /**
   * Cleanup after failed restore attempt
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * @private
   * @param {string} id - Quick Tab ID
   */
  _cleanupFailedRestore(id) {
    this._pendingRestore.delete(id);
    this._releaseLock('restore', id);
  }

  /**
   * Validate tab instance is a real QuickTabWindow
   * v1.6.3.4-v7 - FIX Issue #3: Helper to validate instance type
   * @private
   * @param {Object} tabWindow - Tab window to validate
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @returns {boolean} True if valid, false if invalid (and removed from map)
   */
  _validateTabWindowInstance(tabWindow, id, source) {
    // Valid cases: tabWindow doesn't exist (null), or has the required restore method
    if (!tabWindow) {
      return true; // Doesn't exist - let caller handle this
    }
    if (typeof tabWindow.restore === 'function') {
      return true; // Valid QuickTabWindow instance
    }

    console.error(
      `[VisibilityHandler] Invalid tab instance (not QuickTabWindow, source: ${source}):`,
      {
        id,
        type: tabWindow.constructor?.name,
        hasRestore: typeof tabWindow.restore
      }
    );
    // Remove invalid entry from map
    this.quickTabsMap.delete(id);
    return false;
  }

  /**
   * Re-register window in quickTabsMap if missing
   * v1.6.3.4-v7 - Helper to reduce handleRestore complexity
   * @private
   * @param {Object} tabWindow - Tab window to register
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  _ensureTabInMap(tabWindow, id, source) {
    if (this.quickTabsMap.has(id)) return;

    console.log(
      `[VisibilityHandler] Window exists but not in map (source: ${source}), re-registering:`,
      id
    );
    this.quickTabsMap.set(id, tabWindow);
    console.log(
      `[VisibilityHandler] Re-registered tabWindow in quickTabsMap (source: ${source}):`,
      id
    );
  }

  /**
   * Handle restore of minimized Quick Tab
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.1 - FIX Bug #7: Emit state:updated for panel sync
   * v1.6.3.4 - FIX Bug #2: Persist to storage after restore
   * v1.6.3.4-v6 - FIX Issues #1, #2: Debounce to prevent event storms
   * v1.6.3.2 - FIX Issue #2: Use mutex/lock pattern for true duplicate prevention
   * v1.6.3.3 - FIX Issue #1: Re-register window in quickTabsMap after restore to maintain reference
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * v1.6.3.4-v5 - FIX Issues #1, #2, #7:
   *   - Issue #1: Emit state:updated even when snapshot not found
   *   - Issue #2: Update entity.minimized = false in quickTabsMap after restore
   *   - Issue #7: Entity state is single source of truth - update FIRST
   * v1.6.3.4-v7 - FIX Issues #3, #6: Instance validation and try/finally for lock cleanup
   * v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   * @returns {{ success: boolean, error?: string }} Result object for message handlers
   */
  async handleRestore(id, source = 'unknown') {
    // v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
    const ownershipValidation = this._validateCrossTabOwnership(id, 'restore', source);
    if (!ownershipValidation.valid) {
      return ownershipValidation.result;
    }

    // v1.6.3.10-v10 - FIX Issue 1.1: Wait for any adoption lock to be released
    // This prevents restore from using stale originTabId if adoption is in progress
    if (this.minimizedManager?.hasAdoptionLock?.(id)) {
      console.log(`${this._logPrefix} Restore waiting for adoption lock:`, { id, source });
      await this.minimizedManager.waitForAdoptionLock(id);
    }

    // v1.6.3.2 - Check preconditions for restore
    if (!this._canProceedWithRestore(id, source)) {
      return { success: false, error: 'Operation blocked (lock held or pending)' };
    }

    // v1.6.3.4-v7 - FIX Issue #6: Use try/finally to ensure lock is ALWAYS released
    try {
      return this._executeRestore(id, source);
    } finally {
      // v1.6.3.4-v7 - FIX Issue #6: Guarantee lock release even on exceptions
      this._releaseLock('restore', id);
    }
  }

  /**
   * Check if tab has valid restore context (is minimized or has snapshot)
   * @private
   * @param {Object} tabWindow - Tab window instance
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if tab can be restored
   */
  _hasValidRestoreContext(tabWindow, id) {
    const hasSnapshot = this.minimizedManager?.hasSnapshot?.(id) ?? false;
    const isEntityMinimized = tabWindow?.minimized === true;
    return isEntityMinimized || hasSnapshot;
  }

  /**
   * Validate restore preconditions
   * v1.6.3.4-v9 - FIX Issue #20: Extracted to reduce _executeRestore complexity
   * @private
   * @param {Object} tabWindow - Tab window instance
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @returns {{ valid: boolean, error?: string }}
   */
  _validateRestorePreconditions(tabWindow, id, source) {
    // v1.6.3.4-v7 - FIX Issue #3: Validate instance if it exists
    if (!this._validateTabWindowInstance(tabWindow, id, source)) {
      return { valid: false, error: 'Invalid tab instance (not QuickTabWindow)' };
    }

    // v1.6.3.4-v9 - FIX Issue #20: Validate tab is actually minimized before restore
    if (tabWindow && !this._hasValidRestoreContext(tabWindow, id)) {
      console.warn(
        `[VisibilityHandler] Restore validation FAILED (source: ${source}): Tab is not minimized:`,
        {
          id,
          entityMinimized: tabWindow?.minimized,
          hasSnapshot: this.minimizedManager?.hasSnapshot?.(id) ?? false
        }
      );
      return { valid: false, error: 'Tab is not minimized - cannot restore' };
    }

    return { valid: true };
  }

  /**
   * Perform restore on tabWindow instance
   * v1.6.3.4-v9 - Extracted to reduce _executeRestore complexity
   * @private
   */
  _performTabWindowRestore(tabWindow, id, source) {
    if (!tabWindow) {
      console.warn(
        `[VisibilityHandler] tabWindow not found in quickTabsMap (source: ${source}) for:`,
        id
      );
      return;
    }

    // v1.6.3.6-v6 - FIX: Log originTabId before restore to verify it's available
    console.log(`${this._logPrefix}[_performTabWindowRestore] originTabId BEFORE restore:`, {
      id,
      originTabId: tabWindow.originTabId,
      source
    });

    tabWindow.restore();

    // v1.6.3.6-v6 - FIX: Log originTabId after restore to verify it persists
    console.log(`${this._logPrefix}[_performTabWindowRestore] AFTER restore (source: ${source}):`, {
      id,
      originTabId: tabWindow.originTabId,
      minimized: tabWindow.minimized
    });
    this._ensureTabInMap(tabWindow, id, source);

    // v1.6.3.5-v11 - FIX Issue #2: Re-wire callbacks after restore to capture fresh context
    // The original callbacks may reference stale closures from construction time
    this._rewireCallbacksAfterRestore(tabWindow, id, source);
  }

  /**
   * Re-wire callbacks on tabWindow after restore
   * v1.6.3.5-v11 - FIX Issue #2: Missing callback re-wiring after restore
   * v1.6.4 - Removed Solo/Mute callbacks
   * Creates fresh callback functions that capture CURRENT handler context
   * @private
   * @param {Object} tabWindow - QuickTabWindow instance
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of restore operation
   */
  _rewireCallbacksAfterRestore(tabWindow, id, source) {
    if (!tabWindow?.rewireCallbacks) {
      console.warn(
        `${this._logPrefix} tabWindow.rewireCallbacks not available (source: ${source}):`,
        id
      );
      return;
    }

    // v1.6.3.10-v10 - FIX Issue 2.1: Build fresh callbacks that capture current handler context
    // These replace any stale closures from initial construction
    // v1.6.4 - Removed Solo/Mute callbacks
    const freshCallbacks = {
      onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
      onFocus: tabId => this.handleFocus(tabId)
    };

    // Note: Position/size callbacks (onPositionChange, onPositionChangeEnd, onSizeChange, onSizeChangeEnd)
    // are wired by UICoordinator via UpdateHandler as they require UpdateHandler context.
    // Emit an event so UICoordinator can re-wire those callbacks.
    if (this.eventBus) {
      this.eventBus.emit('tab:needs-callback-rewire', {
        id,
        source,
        callbacksNeeded: [
          'onPositionChange',
          'onPositionChangeEnd',
          'onSizeChange',
          'onSizeChangeEnd'
        ]
      });
    }

    const rewired = tabWindow.rewireCallbacks(freshCallbacks);
    console.log(`${this._logPrefix} Re-wired callbacks after restore (source: ${source}):`, {
      id,
      rewired,
      callbacksProvided: Object.keys(freshCallbacks)
    });
  }

  /**
   * Update entity state for restore (set minimized=false and update z-index)
   * @private
   * @param {Object} tabWindow - Tab window instance
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  _updateEntityStateForRestore(tabWindow, id, source) {
    console.log(
      `${this._logPrefix} Updating entity.minimized = false (source: ${source}) for:`,
      id
    );
    tabWindow.minimized = false;

    // v1.6.3.5-v8 - FIX Issue #4: Ensure z-index is brought to front after restore
    if (this.currentZIndex) {
      const oldZIndex = tabWindow.zIndex;
      this.currentZIndex.value++;
      tabWindow.zIndex = this.currentZIndex.value;
      console.log(`${this._logPrefix}[_executeRestore] Z-index update (source: ${source}):`, {
        id,
        oldZIndex,
        newZIndex: tabWindow.zIndex,
        currentZIndexCounter: this.currentZIndex.value
      });
    }
  }

  /**
   * Handle case when tab is not in minimized manager
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Tab window instance
   * @param {string} source - Source of action
   */
  _handleNotInMinimizedManager(id, tabWindow, source) {
    console.warn(`${this._logPrefix} Tab not found in minimized manager (source: ${source}):`, id);
    void this._emitRestoreStateUpdate(id, tabWindow, source);
    this._debouncedPersist(id, 'restore', source);
  }

  /**
   * Emit QUICK_TAB_RESTORED event for legacy handlers
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  _emitLegacyRestoredEvent(id, source) {
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_RESTORED, { id, source });
    }
  }

  /**
   * Execute restore operation (extracted to reduce handleRestore complexity)
   * v1.6.3.4-v7 - Helper for try/finally pattern in handleRestore
   * v1.6.3.4-v9 - FIX Issue #20: Add validation before proceeding
   * v1.6.3.5-v5 - FIX Issues #1, #6: DOM verification and transaction pattern with rollback
   * v1.6.3.5-v11 - FIX Issue #7, #9: Z-index sync and logging during restore
   * Refactored: Extracted helpers to reduce complexity
   * @private
   */
  _executeRestore(id, source) {
    console.log(`${this._logPrefix}[_executeRestore] ENTRY (source: ${source}):`, { id });

    const tabWindow = this.quickTabsMap.get(id);

    // Validate preconditions
    const validation = this._validateRestorePreconditions(tabWindow, id, source);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Mark as pending to prevent duplicate operations
    this._pendingRestore.add(id);

    // Capture pre-restore state
    const preRestoreState = tabWindow
      ? { minimized: tabWindow.minimized, zIndex: tabWindow.zIndex }
      : null;

    // Update entity state FIRST
    if (tabWindow) {
      this._updateEntityStateForRestore(tabWindow, id, source);
    }

    // Restore from minimized manager
    if (!this.minimizedManager.restore(id)) {
      this._handleNotInMinimizedManager(id, tabWindow, source);
      return { success: true };
    }

    // Perform restore on tabWindow (includes callback re-wiring)
    this._performTabWindowRestore(tabWindow, id, source);

    // Verify DOM state after restore
    this._verifyRestoreAndEmit(id, tabWindow, source, preRestoreState);

    // Emit restore event for legacy handlers
    this._emitLegacyRestoredEvent(id, source);

    // v1.6.3.11-v12 - FIX Issue #2: Send QUICKTAB_MINIMIZED message (minimized=false) for restore
    // Fire-and-forget pattern - errors are handled internally by _sendMinimizeMessage
    this._sendMinimizeMessage(id, false, source).catch(() => {
      // Error already logged by _sendMinimizeMessage
    });

    console.log(`${this._logPrefix}[_executeRestore] EXIT (source: ${source}):`, {
      id,
      success: true,
      newZIndex: tabWindow?.zIndex,
      originTabId: tabWindow?.originTabId ?? 'N/A'
    });

    return { success: true };
  }

  /**
   * Log restore verification status
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Tab window instance
   * @param {string} source - Source of action
   * @returns {boolean} Whether DOM is rendered
   */
  _logRestoreVerification(id, tabWindow, source) {
    const isDOMRendered = this._isDOMRendered(tabWindow);
    const hasMinimizedSnapshot = this.minimizedManager?.hasSnapshot?.(id) ?? false;
    const inQuickTabsMap = this.quickTabsMap?.has?.(id) ?? false;
    const invariantHolds = isDOMRendered && !hasMinimizedSnapshot && inQuickTabsMap;

    console.log('[VisibilityHandler] Restore verification:', {
      id,
      isDOMRendered,
      hasMinimizedSnapshot,
      inQuickTabsMap,
      invariantHolds,
      originTabId: tabWindow?.originTabId ?? 'N/A'
    });

    console.log(`[VisibilityHandler] Restore state check (source: ${source}):`, {
      id,
      isDOMRendered,
      rollbackEnabled: false
    });

    return isDOMRendered;
  }

  /**
   * Emit state:updated event after restore operation
   * v1.6.3.5-v5 - FIX Issues #1, #2, #3: Promise-based event emission
   * v1.6.3.5-v6 - FIX Diagnostic Issue #1: Removed DOM verification rollback
   *   - DOM verification no longer triggers rollback - UICoordinator is trusted
   *   - Simply emit state:updated event and persist to storage
   *   - This fixes the infinite restore deadlock
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Tab window instance
   * @param {string} source - Source of action
   * @param {Object|null} _preRestoreState - Pre-restore state (unused, kept for signature compat)
   */
  async _verifyRestoreAndEmit(id, tabWindow, source, _preRestoreState) {
    try {
      // v1.6.3.5-v6 - FIX Issue #1: Short delay for event sequencing only (no rollback)
      await this._delay(DOM_VERIFICATION_DELAY_MS);

      // Log verification status (extracted helper)
      this._logRestoreVerification(id, tabWindow, source);

      // v1.6.3.5-v5 - FIX Issue #3: Synchronous event emission followed by persist
      this._emitRestoreStateUpdateSync(id, tabWindow, source);

      // v1.6.3.5-v5 - FIX Issue #3: Persist after event emission completes
      this._debouncedPersist(id, 'restore', source);
    } catch (err) {
      // v1.6.3.5-v5 - FIX Issue #4: Try/catch with context markers
      console.error(`[VisibilityHandler] Error in _verifyRestoreAndEmit (source: ${source}):`, {
        id,
        error: err.message,
        stack: err.stack
      });
    }
  }

  /**
   * Handle DOM verification failure (DEPRECATED - v1.6.3.5-v6)
   * v1.6.3.5-v5 - Original implementation with rollback
   * v1.6.3.5-v6 - DEPRECATED: Rollback caused infinite restore deadlock
   *   - Now only logs a warning, no state rollback
   *   - UICoordinator is trusted to handle rendering
   * @private
   * @deprecated No longer performs rollback - kept for future diagnostics only
   */
  _handleDOMVerificationFailure(id, tabWindow, source, _preRestoreState) {
    // v1.6.3.5-v6 - FIX Issue #1: Log warning but do NOT rollback
    // Rollback was causing infinite deadlock with UICoordinator
    console.warn(
      `[VisibilityHandler] DOM not rendered after restore (source: ${source}), trusting UICoordinator:`,
      id
    );

    // v1.6.3.5-v6 - Emit state:updated anyway - UICoordinator will handle rendering
    if (this.eventBus) {
      const quickTabData = this._createQuickTabData(id, tabWindow, false);
      quickTabData.source = source;
      quickTabData.isRestoreOperation = true;
      quickTabData.domVerified = false; // Signal that DOM wasn't verified yet
      this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
    }
  }

  /**
   * Promise-based delay helper
   * v1.6.3.5-v5 - FIX Issue #2: Replace timer-based with promise-based sequencing
   * @private
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if tab window DOM is rendered and connected to document
   * v1.6.3.5-v5 - Extracted helper to reduce code duplication (Code Review feedback)
   * v1.6.3.5-v5 - Enhanced to verify parentNode is connected to document (Code Review #1)
   * @private
   * @param {Object} tabWindow - Tab window instance
   * @returns {boolean} True if DOM is rendered and connected to document
   */
  _isDOMRendered(tabWindow) {
    // Use isRendered() method if available (preferred)
    if (tabWindow?.isRendered?.()) {
      return true;
    }
    // Fallback: Check container exists and is connected to document
    // isConnected is true only if the element is in the DOM tree
    const container = tabWindow?.container;
    return (
      container &&
      container.parentNode &&
      (container.isConnected ?? document.body.contains(container))
    );
  }

  /**
   * Emit state:updated event for restore (synchronous version for promise chaining)
   * v1.6.3.5-v5 - FIX Issue #3: Synchronous event emission for ordered execution
   * Note: Returns void, caller handles flow control
   * @private
   */
  _emitRestoreStateUpdateSync(id, tabWindow, source) {
    if (!this.eventBus) return;

    const isDOMRendered = this._isDOMRendered(tabWindow);

    const quickTabData = this._createQuickTabData(id, tabWindow, false);
    quickTabData.domVerified = isDOMRendered;
    quickTabData.source = source;
    quickTabData.isRestoreOperation = true;

    // Validate payload before emitting
    const validation = this._validateEventPayload(quickTabData);
    if (!validation.valid) {
      console.error(
        `[VisibilityHandler] REJECTED: Event payload missing required fields (source: ${source}):`,
        {
          id,
          missingFields: validation.missingFields
        }
      );
      return;
    }

    this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
    // v1.6.3.6-v6 - FIX: Include originTabId in emission log for debugging cross-tab validation
    console.log(`[VisibilityHandler] Emitted state:updated for restore (source: ${source}):`, id, {
      domVerified: isDOMRendered,
      isRestoreOperation: true,
      originTabId: tabWindow?.originTabId ?? 'N/A'
    });
  }

  /**
   * Build quick tab data from storage entity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} entity - Storage entity
   * @param {string} source - Source of action
   * @returns {Object} Quick Tab data for event emission
   */
  _buildQuickTabDataFromEntity(id, entity, source) {
    return {
      id,
      minimized: false,
      domVerified: false,
      source,
      isRestoreOperation: true,
      url: entity.url,
      title: entity.title,
      position: { left: entity.left, top: entity.top },
      size: { width: entity.width, height: entity.height },
      container: entity.container || entity.cookieStoreId || null,
      zIndex: entity.zIndex
    };
  }

  /**
   * Emit state:updated from storage entity (when tabWindow is null)
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @returns {Promise<boolean>} True if emitted, false otherwise
   */
  async _emitRestoreFromStorage(id, source) {
    console.log(
      `[VisibilityHandler] No tabWindow for restore event (source: ${source}), fetching from storage:`,
      id
    );

    const entity = await this._fetchEntityFromStorage(id);
    if (!entity) {
      console.error(
        `[VisibilityHandler] REJECTED: Cannot emit state:updated without entity data (source: ${source}):`,
        id
      );
      return false;
    }

    const quickTabData = this._buildQuickTabDataFromEntity(id, entity, source);

    const validation = this._validateEventPayload(quickTabData);
    if (!validation.valid) {
      console.error(
        `[VisibilityHandler] REJECTED: Event payload missing required fields (source: ${source}):`,
        {
          id,
          missingFields: validation.missingFields
        }
      );
      return false;
    }

    this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
    console.log(
      `[VisibilityHandler] Emitted state:updated for restore from storage (source: ${source}):`,
      id
    );
    return true;
  }

  /**
   * Timer callback for delayed state:updated emission
   * @private
   */
  _emitRestoreStateDelayedCallback(id, tabWindow, source, timerScheduleTime) {
    try {
      const actualDelay = Date.now() - timerScheduleTime;
      console.log(
        `${this._logPrefix} state:updated emit timer FIRED (id: ${id}, scheduledDelay: ${STATE_EMIT_DELAY_MS}ms, actualDelay: ${actualDelay}ms, source: ${source})`
      );

      const isDOMRendered = this._isDOMRendered(tabWindow);

      if (!isDOMRendered) {
        console.log(
          `[VisibilityHandler] DOM not yet rendered after restore (source: ${source}), expected during transition:`,
          id
        );
      } else {
        console.log(
          `[VisibilityHandler] DOM verified rendered after restore (source: ${source}):`,
          id
        );
      }

      const quickTabData = this._createQuickTabData(id, tabWindow, false);
      quickTabData.domVerified = isDOMRendered;
      quickTabData.source = source;
      quickTabData.isRestoreOperation = true;

      const validation = this._validateEventPayload(quickTabData);
      if (!validation.valid) {
        console.error(
          `[VisibilityHandler] REJECTED: Event payload missing required fields (source: ${source}):`,
          {
            id,
            missingFields: validation.missingFields
          }
        );
        console.log(
          `${this._logPrefix} state:updated emit timer COMPLETED (outcome: rejected, reason: invalid payload, duration: ${Date.now() - timerScheduleTime}ms)`
        );
        return;
      }

      this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
      console.log(
        `[VisibilityHandler] Emitted state:updated for restore (source: ${source}):`,
        id,
        { domVerified: isDOMRendered, isRestoreOperation: true }
      );
      console.log(
        `${this._logPrefix} state:updated emit timer COMPLETED (outcome: success, duration: ${Date.now() - timerScheduleTime}ms)`
      );
    } catch (err) {
      console.error(
        `[VisibilityHandler] ERROR in state:updated emit timer (id: ${id}, source: ${source}):`,
        {
          error: err.message,
          stack: err.stack,
          duration: Date.now() - timerScheduleTime
        }
      );
    }
  }

  /**
   * Emit state:updated event for restore
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * v1.6.3.4-v8 - FIX Issue #4: Verify DOM is rendered before emitting state:updated
   * v1.6.3.4-v9 - FIX Issue #14: Fetch complete entity from storage when tabWindow is null
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance
   * @param {string} source - Source of action
   */
  async _emitRestoreStateUpdate(id, tabWindow, source = 'unknown') {
    if (!this.eventBus) return;

    // Handle case when tabWindow is null - fetch from storage
    if (!tabWindow) {
      await this._emitRestoreFromStorage(id, source);
      return;
    }

    // Delay emit until we can verify DOM is rendered
    const timerScheduleTime = Date.now();
    setTimeout(
      () => this._emitRestoreStateDelayedCallback(id, tabWindow, source, timerScheduleTime),
      STATE_EMIT_DELAY_MS
    );
  }

  /**
   * Restore Quick Tab from minimized state (alias for handleRestore)
   * v1.6.3.4 - FIX Issue #6: Add source parameter
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  restoreQuickTab(id, source = 'unknown') {
    return this.handleRestore(id, source);
  }

  /**
   * Restore Quick Tab by ID (backward compat alias)
   * v1.6.3.4 - FIX Issue #6: Add source parameter
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   */
  restoreById(id, source = 'unknown') {
    return this.handleRestore(id, source);
  }

  /**
   * Apply z-index update to tabWindow or use fallback DOM query
   * v1.6.3.5-v12 - Extracted to reduce handleFocus complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} options - Z-index update options
   * @param {Object} options.tabWindow - Tab window instance
   * @param {number} options.newZIndex - New z-index value
   * @param {boolean} options.hasContainer - Whether tabWindow has container
   * @param {boolean} options.isAttachedToDOM - Whether container is attached to DOM
   */
  _applyZIndexUpdate(id, options) {
    const { tabWindow, newZIndex, hasContainer, isAttachedToDOM } = options;

    if (hasContainer && isAttachedToDOM) {
      tabWindow.updateZIndex(newZIndex);
      console.log(`${this._logPrefix}[handleFocus] Called tabWindow.updateZIndex():`, {
        id,
        newZIndex,
        domZIndex: tabWindow.container?.style?.zIndex
      });
      return;
    }

    // v1.6.3.5-v12 - FIX Issue #2: Try fallback DOM query if tab should be visible
    if (!hasContainer && !tabWindow.minimized) {
      this._applyZIndexViaFallback(id, options);
      return;
    }

    // v1.6.3.5-v11 - FIX Issue #8: Log warning but still store z-index on entity
    console.warn(`${this._logPrefix}[handleFocus] Skipped updateZIndex - container not ready:`, {
      id,
      hasContainer,
      isAttachedToDOM,
      zIndexStoredOnEntity: newZIndex
    });
  }

  /**
   * Apply z-index via fallback DOM query
   * v1.6.3.5-v12 - Extracted to reduce _applyZIndexUpdate complexity (max-depth fix)
   * v1.6.3.5-v12 - Code Review: Use more specific selector with class to avoid conflicts
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} options - Fallback options
   * @param {Object} options.tabWindow - Tab window instance
   * @param {number} options.newZIndex - New z-index value
   * @param {boolean} options.hasContainer - Whether tabWindow has container
   * @param {boolean} options.isAttachedToDOM - Whether container is attached to DOM
   */
  _applyZIndexViaFallback(id, options) {
    const { tabWindow, newZIndex, hasContainer, isAttachedToDOM } = options;
    const element = document.querySelector(
      `.quick-tab-window[data-quicktab-id="${CSS.escape(tabWindow.id)}"]`
    );
    if (element) {
      element.style.zIndex = newZIndex.toString();
      console.warn(`${this._logPrefix}[handleFocus] Applied z-index via fallback DOM query:`, {
        id,
        newZIndex,
        fallbackUsed: true
      });
    } else {
      console.warn(
        `${this._logPrefix}[handleFocus] Skipped updateZIndex - no container or fallback:`,
        {
          id,
          hasContainer,
          isAttachedToDOM,
          isMinimized: tabWindow.minimized,
          zIndexStoredOnEntity: newZIndex
        }
      );
    }
  }

  /**
   * Check if focus event should be debounced
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if focus should be ignored (debounced)
   */
  _shouldDebounceFocus(id) {
    const FOCUS_DEBOUNCE_MS = 100;
    const now = Date.now();
    const lastFocus = this._lastFocusTime.get(id) || 0;

    if (now - lastFocus < FOCUS_DEBOUNCE_MS) {
      console.log(
        `${this._logPrefix}[handleFocus] Ignoring duplicate focus (within debounce window):`,
        id
      );
      return true;
    }
    this._lastFocusTime.set(id, now);
    return false;
  }

  /**
   * Validate tab window for focus and get container info
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {{ valid: boolean, tabWindow?: Object, hasContainer?: boolean, isAttachedToDOM?: boolean }}
   */
  _validateFocusTarget(id) {
    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      console.warn(`${this._logPrefix}[handleFocus] Tab not found in quickTabsMap:`, id);
      return { valid: false };
    }

    const hasContainer = !!tabWindow.container;
    const isAttachedToDOM = !!tabWindow.container?.parentNode;

    console.log(`${this._logPrefix}[handleFocus] Container validation:`, {
      id,
      hasContainer,
      isAttachedToDOM,
      isRendered: tabWindow.isRendered?.() ?? 'N/A'
    });

    return { valid: true, tabWindow, hasContainer, isAttachedToDOM };
  }

  /**
   * Validate cross-tab focus ownership
   * v1.6.3.12-v5 - FIX CodeScene: Extract to reduce handleFocus complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Tab window instance
   * @returns {boolean} True if focus is allowed
   */
  _validateFocusOwnership(id, tabWindow) {
    // v1.6.3.10-v4 - FIX Issues #9, #10: Cross-tab ownership validation
    // Only allow focus from owning tab to prevent z-index leakage
    if (tabWindow.originTabId === null || tabWindow.originTabId === undefined) {
      return true; // No ownership set, allow
    }
    if (tabWindow.originTabId === this.currentTabId) {
      return true; // Owned by this tab
    }
    console.log(`${this._logPrefix}[handleFocus] Cross-tab focus rejected:`, {
      id,
      originTabId: tabWindow.originTabId,
      currentTabId: this.currentTabId
    });
    return false;
  }

  /**
   * Perform atomic z-index increment with persistence
   * v1.6.3.12-v5 - FIX CodeScene: Extract to reduce handleFocus complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Tab window instance
   * @returns {Promise<{success: boolean, newZIndex: number|null}>}
   */
  async _atomicZIndexIncrement(id, tabWindow) {
    const oldZIndex = tabWindow.zIndex;
    const oldCounterValue = this.currentZIndex.value;
    const newZIndex = this.currentZIndex.value + 1;

    console.log(`${this._logPrefix}[handleFocus] Z-index increment attempt:`, {
      id,
      oldZIndex,
      proposedNewZIndex: newZIndex,
      currentCounterValue: oldCounterValue
    });

    // Persist to storage FIRST with acknowledgment
    const persistSuccess = await saveZIndexCounterWithAck(newZIndex);

    if (!persistSuccess) {
      console.error(`${this._logPrefix}[handleFocus] [Z_INDEX_PERSIST_FAILED] Reverting to last known good value:`, {
        id,
        attemptedValue: newZIndex,
        revertedValue: oldCounterValue,
        tabWindowZIndex: oldZIndex,
        timestamp: new Date().toISOString()
      });
      return { success: false, newZIndex: null };
    }

    // Persistence confirmed - update in-memory state
    this.currentZIndex.value = newZIndex;
    tabWindow.zIndex = newZIndex;

    console.log(`${this._logPrefix}[handleFocus] Z-index increment SUCCESS:`, {
      id,
      oldZIndex,
      newZIndex,
      counterValue: this.currentZIndex.value,
      persistenceConfirmed: true
    });

    return { success: true, newZIndex };
  }

  /**
   * Handle Quick Tab focus (bring to front)
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.4 - FIX Issue #3: Persist z-index to storage after focus
   * v1.6.3.4-v8 - FIX Issue #6: Debounce duplicate focus events (100ms)
   * v1.6.3.5-v11 - FIX Issues #8, #9:
   *   - Issue #8: Defensive checks for container existence and DOM attachment
   *   - Issue #9: Comprehensive z-index operation logging
   * v1.6.3.5-v12 - FIX Issue #2: Add fallback DOM query for z-index update
   * v1.6.3.10-v4 - FIX Issues #9, #10: Cross-tab ownership validation
   * v1.6.3.12-v5 - FIX Issue #17: Use atomic z-index persistence pattern
   *
   * NOTE: This method changed from sync to async in v1.6.3.12-v5 for atomic z-index
   * persistence. Callers should not depend on synchronous completion. The method
   * fires-and-forgets for UI responsiveness - the returned Promise can be awaited
   * if the caller needs to know when persistence completes.
   *
   * @param {string} id - Quick Tab ID
   * @returns {Promise<void>}
   */
  async handleFocus(id) {
    // Check debounce
    if (this._shouldDebounceFocus(id)) return;

    console.log(`${this._logPrefix}[handleFocus] ENTRY:`, {
      id,
      currentZIndex: this.currentZIndex?.value
    });

    // Validate target
    const validation = this._validateFocusTarget(id);
    if (!validation.valid) return;

    const { tabWindow, hasContainer, isAttachedToDOM } = validation;

    // Check ownership
    if (!this._validateFocusOwnership(id, tabWindow)) return;

    // v1.6.3.10-v10 - FIX Issue 3.2: Recycle z-indices if threshold exceeded
    if (this.currentZIndex.value >= Z_INDEX_RECYCLE_THRESHOLD) {
      await this._recycleZIndicesAtomic();
    }

    // v1.6.3.12-v5 - FIX Issue #17: Atomic z-index persistence
    const incrementResult = await this._atomicZIndexIncrement(id, tabWindow);
    if (!incrementResult.success) return;

    // Apply z-index via helper
    this._applyZIndexUpdate(id, { tabWindow, newZIndex: incrementResult.newZIndex, hasContainer, isAttachedToDOM });

    // Emit focus event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, { id });
    }

    // Persist z-index change to storage (debounced)
    this._debouncedPersist(id, 'focus', 'UI');

    console.log(`${this._logPrefix}[handleFocus] EXIT:`, {
      id,
      finalZIndex: tabWindow.zIndex
    });
  }

  /**
   * Recycle z-indices atomically to prevent unbounded growth
   * v1.6.3.12-v5 - FIX Issue #17: Atomic version of _recycleZIndices
   * @private
   */
  async _recycleZIndicesAtomic() {
    console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Counter exceeded threshold`, {
      currentValue: this.currentZIndex.value,
      threshold: Z_INDEX_RECYCLE_THRESHOLD
    });

    // Sort tabs by current z-index to maintain stacking order
    const sortedTabs = Array.from(this.quickTabsMap.entries()).sort(
      ([, a], [, b]) => (a.zIndex || 0) - (b.zIndex || 0)
    );

    // Calculate new counter value after recycling
    const baseValue = 1000;
    const newCounterValue = baseValue + sortedTabs.length;

    // v1.6.3.12-v5 - FIX Issue #17: Persist recycled counter FIRST
    const persistSuccess = await saveZIndexCounterWithAck(newCounterValue);

    if (!persistSuccess) {
      console.error(`${this._logPrefix} Z-INDEX_RECYCLE: Counter persist failed, aborting recycle`, {
        attemptedValue: newCounterValue
      });
      return; // Don't recycle if we can't persist
    }

    // Reset counter to base value
    this.currentZIndex.value = baseValue;

    // Reassign z-indices maintaining relative order
    for (const [id, tabWindow] of sortedTabs) {
      this.currentZIndex.value++;
      const newZIndex = this.currentZIndex.value;
      tabWindow.zIndex = newZIndex;

      // Update DOM if container and style exist
      if (tabWindow.container?.style) {
        tabWindow.container.style.zIndex = newZIndex.toString();
      }

      console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Reassigned`, {
        id,
        newZIndex
      });
    }

    console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Complete`, {
      newCounterValue: this.currentZIndex.value,
      tabsRecycled: sortedTabs.length,
      persistenceConfirmed: true
    });
  }

  /**
   * Recycle z-indices to prevent unbounded growth
   * v1.6.3.10-v10 - FIX Issue 3.2: Reset z-index counter and reassign to all Quick Tabs
   * v1.6.3.11-v9 - FIX: Add defensive check for container.style
   * v1.6.3.12 - FIX Issue #17: Persist z-index counter after recycle
   * v1.6.3.12-v5 - DEPRECATED: Use _recycleZIndicesAtomic for atomic persistence
   * @private
   */
  _recycleZIndices() {
    console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Counter exceeded threshold`, {
      currentValue: this.currentZIndex.value,
      threshold: Z_INDEX_RECYCLE_THRESHOLD
    });

    // Sort tabs by current z-index to maintain stacking order
    const sortedTabs = Array.from(this.quickTabsMap.entries()).sort(
      ([, a], [, b]) => (a.zIndex || 0) - (b.zIndex || 0)
    );

    // Reset counter to base value
    this.currentZIndex.value = 1000;

    // Reassign z-indices maintaining relative order
    for (const [id, tabWindow] of sortedTabs) {
      this.currentZIndex.value++;
      const newZIndex = this.currentZIndex.value;
      tabWindow.zIndex = newZIndex;

      // Update DOM if container and style exist
      if (tabWindow.container?.style) {
        tabWindow.container.style.zIndex = newZIndex.toString();
      }

      console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Reassigned`, {
        id,
        newZIndex
      });
    }

    // v1.6.3.12 - FIX Issue #17: Persist z-index counter after recycle
    saveZIndexCounter(this.currentZIndex.value).catch(err => {
      console.warn(`${this._logPrefix} Z-INDEX_RECYCLE: Counter persist failed:`, err.message);
    });

    console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Complete`, {
      newCounterValue: this.currentZIndex.value,
      tabsRecycled: sortedTabs.length
    });
  }

  /**
   * Debounced persist to storage - prevents write storms
   * v1.6.3.4-v6 - FIX Issues #1, #2, #6: Single atomic storage write after debounce
   * v1.6.3.2 - FIX Issue #2: Release operation locks after debounce completes
   * v1.6.3.4 - FIX Issue #6: Add source to logging
   * v1.6.3.5 - FIX Issue #4: Replace generation counter with active timer IDs Set
   *   Old approach (generation counter) had a flaw where rapid operations caused persist
   *   to be skipped entirely because all callbacks checked against a single counter.
   *   New approach: Each timer has a unique ID stored in a Set. When timer fires:
   *   1. Check if its ID is still in _activeTimerIds Set
   *   2. If yes, remove it and execute cleanup/persist
   *   3. If no, skip (timer was cancelled by newer operation)
   * v1.6.3.5-v12 - FIX Issue A: Added isFocusOnlyChange flag for diagnostic logging
   * v1.6.3.11-v9 - FIX Issue I: Capture currentTabId at schedule time, not fire time
   *   Previously tab ID was read at fire time which could be different if tab context changed
   * @private
   * @param {string} id - Quick Tab ID that triggered the persist
   * @param {string} operation - 'minimize', 'restore', or 'focus'
   * @param {string} source - Source of action
   */
  _debouncedPersist(id, operation, source = 'unknown') {
    // v1.6.3.5 - FIX Issue #4: Generate unique timer ID for this operation
    this._timerIdCounter++;
    const timerId = `timer-${id}-${this._timerIdCounter}`;

    // v1.6.3.5-v3 - FIX Diagnostic Issue #7: Track schedule time for accurate delay measurement
    const timerScheduleTime = Date.now();

    // v1.6.3.11-v9 - FIX Issue I: Capture currentTabId at SCHEDULE time, not fire time
    // This prevents race condition where tab context changes between schedule and fire
    const capturedTabId = this.currentTabId;

    // v1.6.3.5-v12 - FIX Issue A: Log whether this is a focus operation persist
    // Code Review: Renamed from isFocusOnlyChange to isFocusOperation for accuracy
    const isFocusOperation = operation === 'focus';

    console.log('[VisibilityHandler] Persist triggered:', {
      id,
      source,
      trigger: operation,
      isFocusOperation,
      capturedTabId // v1.6.3.11-v9 - Log captured tab ID
    });

    console.log(`[VisibilityHandler] _debouncedPersist scheduling (source: ${source}):`, {
      id,
      operation,
      timerId,
      existingTimer: this._debounceTimers.has(id),
      activeTimerCount: this._activeTimerIds.size,
      scheduledDelayMs: MINIMIZE_DEBOUNCE_MS,
      capturedTabId // v1.6.3.11-v9 - Log captured tab ID
    });

    // Clear any existing timer for this tab
    const existingTimer = this._debounceTimers.get(id);
    if (existingTimer) {
      // v1.6.3.5 - Handle both old (raw timeout ID) and new ({timeoutId, timerId}) formats
      if (typeof existingTimer === 'object' && existingTimer.timeoutId) {
        clearTimeout(existingTimer.timeoutId);
        this._activeTimerIds.delete(existingTimer.timerId);
        console.log(`[VisibilityHandler] Timer CANCELLED before execution (source: ${source}):`, {
          id,
          cancelledTimerId: existingTimer.timerId,
          reason: 'replaced by newer timer'
        });
      } else {
        // Legacy format - existingTimer is just the timeout ID
        clearTimeout(existingTimer);
        console.log(`[VisibilityHandler] Cleared legacy debounce timer (source: ${source}):`, {
          id
        });
      }
    }

    // Add new timer ID to active set
    this._activeTimerIds.add(timerId);

    // v1.6.3.11-v9 - FIX Issue I: Pass captured tab ID in callback options
    const callbackOptions = { operation, source, timerId, timerScheduleTime, capturedTabId };
    const timeoutId = setTimeout(
      () => this._executeDebouncedPersistCallback(id, callbackOptions),
      MINIMIZE_DEBOUNCE_MS
    );

    // Store both the timeout ID and the timer ID
    this._debounceTimers.set(id, { timeoutId, timerId });
  }

  /**
   * Execute the debounced persist callback
   * v1.6.3.5-v3 - Extracted to reduce _debouncedPersist complexity
   * v1.6.3.11-v9 - FIX Issue I: Use capturedTabId from schedule time, not current tab ID
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} options - Callback options
   * @param {string} options.operation - Operation type ('minimize', 'restore', 'focus')
   * @param {string} options.source - Source of action
   * @param {string} options.timerId - Unique timer ID
   * @param {number} options.timerScheduleTime - Timestamp when timer was scheduled
   * @param {number|null} options.capturedTabId - Tab ID captured at schedule time
   */
  async _executeDebouncedPersistCallback(id, options) {
    const { operation, source, timerId, timerScheduleTime, capturedTabId } = options;

    // v1.6.3.5-v3 - FIX Diagnostic Issue #7: Calculate actual delay for logging
    const actualDelay = Date.now() - timerScheduleTime;

    // v1.6.3.5 - FIX Issue #4: Check if this timer ID is still active
    // If not, a newer timer replaced this one and this callback should be skipped
    if (!this._activeTimerIds.has(timerId)) {
      console.log('[VisibilityHandler] Timer callback SKIPPED (timer cancelled):', {
        id,
        operation,
        source,
        timerId
      });
      return;
    }

    // Remove from active set now that we're executing
    this._activeTimerIds.delete(timerId);

    // v1.6.3.11-v9 - FIX Issue I: Validate that captured tab ID matches current context
    // Log warning if tab context has changed since schedule time
    if (capturedTabId !== null && capturedTabId !== this.currentTabId) {
      console.warn('[VisibilityHandler] TAB_CONTEXT_CHANGED: Timer callback context mismatch', {
        id,
        operation,
        capturedTabId,
        currentTabId: this.currentTabId,
        warning: 'Tab ID changed between schedule and fire - using captured ID'
      });
    }

    // v1.6.3.5-v3 - FIX Diagnostic Issue #7: Log timer callback STARTED with actual delay
    const callbackStartTime = Date.now();
    console.log(`[VisibilityHandler] Timer callback STARTED (source: ${source}):`, {
      id,
      operation,
      timerId,
      scheduledDelayMs: MINIMIZE_DEBOUNCE_MS,
      actualDelayMs: actualDelay,
      capturedTabId, // v1.6.3.11-v9 - Log captured tab ID
      pendingMinimizeSize: this._pendingMinimize.size,
      pendingRestoreSize: this._pendingRestore.size
    });

    this._debounceTimers.delete(id);

    // Clear pending flags
    this._pendingMinimize.delete(id);
    this._pendingRestore.delete(id);

    // v1.6.3.2 - FIX Issue #2: Release operation locks
    this._releaseLock('minimize', id);
    this._releaseLock('restore', id);

    // v1.6.3.10-v10 - FIX Issue 10.1: Skip persist if storage marked unavailable
    if (!this._storageAvailable) {
      console.warn('[VisibilityHandler] Timer callback SKIPPED (storage unavailable):', {
        id,
        operation,
        source,
        storageTimeoutCount: this._storageTimeoutCount
      });
      return;
    }

    // Perform atomic storage write with timeout protection
    try {
      // v1.6.3.10-v10 - FIX Issue 10.1: Wrap persist in Promise.race with timeout
      await this._persistToStorageWithTimeout();

      // v1.6.3.5-v3 - FIX Diagnostic Issue #7: Log timer callback COMPLETED with duration
      const callbackDuration = Date.now() - callbackStartTime;
      console.log(`[VisibilityHandler] Timer callback COMPLETED (source: ${source}):`, {
        id,
        operation,
        timerId,
        durationMs: callbackDuration,
        outcome: 'success'
      });
    } catch (err) {
      // v1.6.3.5-v3 - FIX Diagnostic Issue #7: Log timer callback FAILED
      const callbackDuration = Date.now() - callbackStartTime;
      console.error(`[VisibilityHandler] Timer callback FAILED (source: ${source}):`, {
        id,
        operation,
        timerId,
        durationMs: callbackDuration,
        outcome: 'error',
        error: err.message
      });
    }
  }

  /**
   * Persist to storage with timeout protection
   * v1.6.3.10-v10 - FIX Issue 10.1: Wrap _persistToStorage in Promise.race with timeout
   * If timeout occurs, log error and mark storage as potentially unavailable
   * @private
   * @returns {Promise<void>}
   */
  async _persistToStorageWithTimeout() {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Storage persist timeout')), PERSIST_STORAGE_TIMEOUT_MS);
    });

    try {
      await Promise.race([this._persistToStorage(), timeoutPromise]);
      // v1.6.3.12-v5 - FIX Issue #12: Reset timeout count on success with logging
      if (this._storageTimeoutCount > 0) {
        console.log(`${this._logPrefix} [TIMEOUT_COUNTER_RESET] Reset to 0 after successful write`, {
          previousCount: this._storageTimeoutCount,
          storageAvailable: this._storageAvailable
        });
      }
      this._storageTimeoutCount = 0;
      // v1.6.3.12-v5 - FIX Issue #12: Also reset storage availability if it was marked unavailable
      if (!this._storageAvailable) {
        console.log(`${this._logPrefix} [STORAGE_RECOVERY] Storage marked available after successful write`);
        this._storageAvailable = true;
      }
    } catch (err) {
      if (err.message === 'Storage persist timeout') {
        this._handleStorageTimeout();
      }
      throw err;
    }
  }

  /**
   * Handle storage timeout by incrementing counter and potentially marking storage unavailable
   * v1.6.3.10-v10 - FIX Issue 10.1: Extracted to reduce nesting depth
   * @private
   */
  _handleStorageTimeout() {
    this._storageTimeoutCount++;
    console.error(`${this._logPrefix} STORAGE_PERSIST_TIMEOUT:`, {
      timeoutMs: PERSIST_STORAGE_TIMEOUT_MS,
      timeoutCount: this._storageTimeoutCount,
      warning: 'Storage write is taking too long, may be unavailable'
    });

    // After 3 consecutive timeouts, mark storage as unavailable
    if (this._storageTimeoutCount >= 3) {
      this._storageAvailable = false;
      console.error(`${this._logPrefix} STORAGE_MARKED_UNAVAILABLE:`, {
        reason: 'Consecutive storage timeouts exceeded threshold',
        timeoutCount: this._storageTimeoutCount
      });
    }
  }

  /**
   * Filter quickTabsMap to only include tabs owned by this tab
   * v1.6.3.10-v4 - FIX Issue #15: Extract ownership filter to reduce _persistToStorage complexity
   * @private
   * @returns {Map} Map of owned Quick Tabs only
   */
  _filterOwnedTabs() {
    const ownedTabs = new Map();
    for (const [id, tabWindow] of this.quickTabsMap) {
      // v1.6.3.10-v4 - FIX Issue #15: Use shared ownership check (Code Review feedback)
      if (this._isOwnedByCurrentTab(tabWindow)) {
        ownedTabs.set(id, tabWindow);
      } else {
        console.log('[VisibilityHandler] Filtering out cross-tab Quick Tab from persist:', {
          id,
          originTabId: tabWindow.originTabId,
          currentTabId: this.currentTabId
        });
      }
    }

    console.log('[VisibilityHandler] Ownership filter result:', {
      totalTabs: this.quickTabsMap.size,
      ownedTabs: ownedTabs.size,
      filteredOut: this.quickTabsMap.size - ownedTabs.size
    });

    return ownedTabs;
  }

  /**
   * Persist current state to browser.storage.local
   * v1.6.3.4 - FIX Bug #2: Persist to storage after minimize/restore
   * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation
   * v1.6.3.4-v6 - FIX Issue #6: Validate counts and state before persist
   * v1.6.3.10-v4 - FIX Issue #15: Only persist Quick Tabs owned by this tab
   * v1.6.3.12 - FIX Issue #14: Use StorageCoordinator for serialized writes
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   * @returns {Promise<void>}
   */
  async _persistToStorage() {
    // v1.6.3.4-v2 - FIX Bug #1: Log position/size data when persisting
    console.log('[VisibilityHandler] Building state for storage persist...');

    // v1.6.3.10-v4 - FIX Issue #15: Only persist Quick Tabs owned by this tab
    const ownedTabs = this._filterOwnedTabs();

    const state = buildStateForStorage(ownedTabs, this.minimizedManager);

    // v1.6.3.4-v2 - FIX Bug #1: Handle null state from validation failure
    if (!state) {
      console.error('[VisibilityHandler] Failed to build state for storage');
      return;
    }

    // v1.6.3.4-v6 - FIX Issue #6: Validate minimized count matches actual state
    const minimizedCount = state.tabs.filter(t => t.minimized).length;
    const activeCount = state.tabs.filter(t => !t.minimized).length;
    // v1.6.3.4-v8 - FIX Issue #2: getAllMinimized() DOES NOT EXIST - use getCount()
    const minimizedManagerCount = this.minimizedManager?.getCount() ?? 0;

    console.log('[VisibilityHandler] State validation before persist:', {
      totalTabs: state.tabs.length,
      minimizedCount,
      activeCount,
      minimizedManagerCount
    });

    // v1.6.3.4-v6 - FIX Issue #6: Warn if counts don't match
    if (minimizedCount !== minimizedManagerCount) {
      console.warn('[VisibilityHandler] Minimized count mismatch:', {
        stateMinimized: minimizedCount,
        managerMinimized: minimizedManagerCount
      });
    }

    // v1.6.3.4-v6 - FIX Issue #6: Full state validation
    const validation = validateStateForPersist(state);
    if (!validation.valid) {
      console.warn(
        '[VisibilityHandler] State validation warnings (proceeding with persist):',
        validation.errors
      );
      // Continue with persist despite validation warnings - data integrity is maintained
      // by the individual tab validation in buildStateForStorage
    }

    // v1.6.3.4-v2 - FIX Bug #1: Log tab count and minimized states
    console.log(
      `[VisibilityHandler] Persisting ${state.tabs.length} tabs (${minimizedCount} minimized)`
    );

    // v1.6.3.12 - FIX Issue #14: Use StorageCoordinator for serialized writes
    // v1.6.3.12-v5 - FIX Issue #16: Use HIGH priority for state change operations
    const coordinator = getStorageCoordinator();
    try {
      const success = await coordinator.queueWrite(
        'VisibilityHandler',
        () => persistStateToStorage(state, '[VisibilityHandler]'),
        QUEUE_PRIORITY.HIGH // State changes are high priority
      );

      if (!success) {
        // v1.6.3.4-v4 - FIX: More descriptive error message about potential causes
        console.error(
          '[VisibilityHandler] Storage persist failed: operation timed out, storage API unavailable, or quota exceeded'
        );
      }
    } catch (err) {
      console.error('[VisibilityHandler] Storage coordinator error:', err.message);
    }
  }

  /**
   * Destroy handler and cleanup resources
   * v1.6.3.10-v10 - FIX Issue 3.3: Clear all Set/Map references to prevent memory leaks
   */
  destroy() {
    console.log(`${this._logPrefix} Destroying VisibilityHandler`);

    // Clear all pending operations
    this._pendingMinimize.clear();
    this._pendingRestore.clear();

    // Clear all debounce timers
    for (const timer of this._debounceTimers.values()) {
      if (timer?.timeoutId) {
        clearTimeout(timer.timeoutId);
      } else if (typeof timer === 'number') {
        clearTimeout(timer);
      }
    }
    this._debounceTimers.clear();

    // v1.6.3.10-v10 - FIX Issue 3.3: Clear active timer IDs
    this._activeTimerIds.clear();

    // Clear operation locks
    this._operationLocks.clear();

    // Clear initiated operations
    this._initiatedOperations.clear();

    // Clear focus time tracking
    this._lastFocusTime.clear();

    console.log(`${this._logPrefix} VisibilityHandler destroyed`);
  }
}
