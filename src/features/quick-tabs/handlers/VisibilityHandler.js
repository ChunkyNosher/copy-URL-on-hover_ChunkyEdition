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
 * v1.6.3.10-v12 - FIX Issue #22: State consistency checks between VisibilityHandler and MinimizedManager
 *   - startConsistencyChecks() validates DOM state matches snapshot state every 5 seconds
 *   - Automatic recovery for MISSING_SNAPSHOT (create from DOM) and STALE_SNAPSHOT (remove)
 *   - Consistency checks started automatically by QuickTabsManager._setupComponents()
 *
 * Architecture (Single-Tab Model v1.6.3+):
 * - Each tab manages visibility only for Quick Tabs it owns (originTabId matches)
 * - Storage used for persistence and hydration, not for cross-tab sync
 * - Mutex/lock pattern prevents duplicate operations from multiple sources
 * - Cross-tab validation ensures operations only affect owned Quick Tabs
 * - v1.6.3.10-v5: Remote commands from Manager use Scripting API fallback for reliability
 * - v1.6.3.10-v12: Periodic consistency checks detect and recover from state desync
 *
 * Responsibilities:
 * - Handle solo toggle (show only on specific tabs)
 * - Handle mute toggle (hide on specific tabs)
 * - Handle minimize operation with DOM cleanup
 * - Handle restore operation (trusts UICoordinator for rendering)
 * - Handle focus operation (bring to front)
 * - Update button appearances
 * - Emit events for coordinators
 * - Persist state to storage after visibility changes
 * - Cross-tab ownership validation for all operations
 * - Periodic state consistency checks with automatic recovery
 *
 * @version 1.6.3.10-v12
 */

import {
  buildStateForStorage,
  persistStateToStorage,
  validateStateForPersist,
  STATE_KEY,
  getBrowserStorageAPI
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

// v1.6.3.10-v10 - FIX Issue 3.2: Z-index recycling threshold
// When z-index counter exceeds this value, recycle all z-indices to prevent unbounded growth
const Z_INDEX_RECYCLE_THRESHOLD = 100000;

// v1.6.3.10-v11 - FIX Issue #10: Lock timeout for stale lock recovery
// If a lock is held longer than this, log warning and auto-release
const LOCK_TIMEOUT_MS = 1000;

// v1.6.3.10-v11 - FIX Issue #10: Lock warning threshold (5x normal lock duration)
// Log warning if lock held longer than this but not yet timed out
const LOCK_WARNING_THRESHOLD_MS = OPERATION_LOCK_MS * 5;

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
   */
  constructor(options) {
    this.quickTabsMap = options.quickTabsMap;
    this.minimizedManager = options.minimizedManager;
    this.eventBus = options.eventBus;
    this.currentZIndex = options.currentZIndex;
    this.currentTabId = options.currentTabId;
    this.Events = options.Events;

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
    
    // v1.6.3.10-v11 - FIX Issue #19: Track registered event listeners for cleanup
    // Map of { target, type, listener, options } for later removal
    this._registeredListeners = [];
    
    // v1.6.3.10-v11 - FIX Issue #20: Track active timers with metadata
    // Map of timerId -> { type, description, createdAt, callback }
    this._activeTimers = new Map();
    
    // v1.6.3.10-v11 - FIX Issue #19: Track if handler is destroyed
    this._isDestroyed = false;
    
    // v1.6.3.10-v11 - FIX Issue #22: Track state consistency check interval
    this._consistencyCheckIntervalId = null;
    
    // Log handler creation
    console.log(`${this._logPrefix} HANDLER_CREATED:`, {
      tabId: this.currentTabId,
      timestamp: Date.now()
    });
  }
  
  // ==================== v1.6.3.10-v11 FIX ISSUE #22: STATE CONSISTENCY ====================
  
  /**
   * Interval for periodic state consistency checks (milliseconds)
   * v1.6.3.10-v11 - FIX Issue #22
   */
  static get STATE_CONSISTENCY_CHECK_INTERVAL_MS() {
    return 5000; // 5 seconds
  }
  
  /**
   * Start periodic state consistency checks
   * v1.6.3.10-v11 - FIX Issue #22: Detect and recover from state desync between VisibilityHandler and MinimizedManager
   */
  startConsistencyChecks() {
    if (this._consistencyCheckIntervalId) {
      return; // Already running
    }
    
    this._consistencyCheckIntervalId = setInterval(() => {
      this._performConsistencyCheck();
    }, VisibilityHandler.STATE_CONSISTENCY_CHECK_INTERVAL_MS);
    
    console.log(`${this._logPrefix} STATE_CONSISTENCY_CHECKS_STARTED:`, {
      intervalMs: VisibilityHandler.STATE_CONSISTENCY_CHECK_INTERVAL_MS
    });
  }
  
  /**
   * Stop periodic state consistency checks
   * v1.6.3.10-v11 - FIX Issue #22
   */
  stopConsistencyChecks() {
    if (this._consistencyCheckIntervalId) {
      clearInterval(this._consistencyCheckIntervalId);
      this._consistencyCheckIntervalId = null;
      console.log(`${this._logPrefix} STATE_CONSISTENCY_CHECKS_STOPPED`);
    }
  }
  
  /**
   * Check if a minimized tab has a snapshot
   * v1.6.3.10-v11 - FIX Issue #22: Helper to reduce nesting depth
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if snapshot exists
   */
  _hasSnapshotForTab(id) {
    if (this.minimizedManager?.has?.(id)) return true;
    return this.minimizedManager?.minimizedTabs?.has(id) ?? false;
  }
  
  /**
   * Check minimized tabs for missing snapshots
   * v1.6.3.10-v11 - FIX Issue #22: Helper to reduce complexity
   * @private
   * @returns {Array} Array of MISSING_SNAPSHOT issues
   */
  _checkForMissingSnapshots() {
    const issues = [];
    
    for (const [id, tabWindow] of this.quickTabsMap) {
      if (!this._isOwnedByCurrentTab(tabWindow)) continue;
      if (!tabWindow.minimized) continue;
      
      if (!this._hasSnapshotForTab(id)) {
        issues.push({
          type: 'MISSING_SNAPSHOT',
          id,
          message: 'Minimized Quick Tab has no snapshot in MinimizedManager'
        });
      }
    }
    
    return issues;
  }
  
  /**
   * Check snapshots for stale entries
   * v1.6.3.10-v11 - FIX Issue #22: Helper to reduce complexity
   * @private
   * @returns {Array} Array of STALE_SNAPSHOT issues
   */
  _checkForStaleSnapshots() {
    const issues = [];
    
    if (!this.minimizedManager?.minimizedTabs) return issues;
    
    for (const [id] of this.minimizedManager.minimizedTabs) {
      const tabWindow = this.quickTabsMap.get(id);
      if (!tabWindow || !this._isOwnedByCurrentTab(tabWindow)) continue;
      
      if (!tabWindow.minimized) {
        issues.push({
          type: 'STALE_SNAPSHOT',
          id,
          message: 'MinimizedManager has snapshot for non-minimized Quick Tab'
        });
      }
    }
    
    return issues;
  }
  
  /**
   * Perform a state consistency check between VisibilityHandler's quickTabsMap and MinimizedManager
   * v1.6.3.10-v11 - FIX Issue #22 (refactored to reduce complexity)
   * @private
   */
  _performConsistencyCheck() {
    if (this._isDestroyed) return;
    
    // Check both directions of state consistency
    const issues = [
      ...this._checkForMissingSnapshots(),
      ...this._checkForStaleSnapshots()
    ];
    
    // Log and recover from issues
    if (issues.length > 0) {
      console.warn(`${this._logPrefix} STATE_CONSISTENCY_ISSUES:`, {
        issueCount: issues.length,
        issues
      });
      
      // Attempt recovery
      for (const issue of issues) {
        this._recoverFromConsistencyIssue(issue);
      }
    }
  }
  
  /**
   * Attempt to recover from a state consistency issue
   * v1.6.3.10-v11 - FIX Issue #22
   * @private
   * @param {Object} issue - Issue to recover from
   */
  _recoverFromConsistencyIssue(issue) {
    console.log(`${this._logPrefix} STATE_RECOVERY_ATTEMPT:`, {
      type: issue.type,
      id: issue.id
    });
    
    switch (issue.type) {
      case 'MISSING_SNAPSHOT': {
        // Minimized tab has no snapshot - create one
        const tabWindow = this.quickTabsMap.get(issue.id);
        if (tabWindow && this.minimizedManager?.add) {
          console.log(`${this._logPrefix} STATE_RECOVERY: Creating missing snapshot for ${issue.id}`);
          this.minimizedManager.add(issue.id, tabWindow);
        }
        break;
      }
      
      case 'STALE_SNAPSHOT': {
        // Non-minimized tab has stale snapshot - remove it
        if (this.minimizedManager?.remove) {
          console.log(`${this._logPrefix} STATE_RECOVERY: Removing stale snapshot for ${issue.id}`);
          this.minimizedManager.remove(issue.id);
        }
        break;
      }
      
      default:
        console.warn(`${this._logPrefix} STATE_RECOVERY: Unknown issue type ${issue.type}`);
    }
  }
  
  /**
   * Verify minimize operation completed successfully
   * v1.6.3.10-v11 - FIX Issue #22: Transactional verification
   * @param {string} id - Quick Tab ID
   * @returns {{ success: boolean, error?: string }}
   */
  _verifyMinimizeComplete(id) {
    const tabWindow = this.quickTabsMap.get(id);
    
    // Check DOM state
    if (tabWindow && !tabWindow.minimized) {
      return { success: false, error: 'DOM state not updated (minimized flag is false)' };
    }
    
    // Check snapshot exists
    const hasSnapshot = this.minimizedManager?.minimizedTabs?.has(id);
    if (!hasSnapshot) {
      return { success: false, error: 'Snapshot not created in MinimizedManager' };
    }
    
    // Get snapshot to verify it's valid
    const snapshot = this.minimizedManager.minimizedTabs.get(id);
    if (!snapshot || !snapshot.savedPosition || !snapshot.savedSize) {
      return { success: false, error: 'Snapshot is incomplete or invalid' };
    }
    
    return { success: true };
  }
  
  // ==================== END ISSUE #22 FIX ====================

  /**
   * Check if a tabWindow is owned by the current tab
   * v1.6.3.10-v4 - FIX Issue #9: Extracted to reduce duplication (Code Review feedback)
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
    return tabWindow.originTabId === this.currentTabId;
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
   * Handle solo toggle from Quick Tab window or panel
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newSoloedTabs - Array of tab IDs where Quick Tab should be visible
   * @param {string} source - Source of action
   * @returns {{ success: boolean, error?: string }}
   */
  handleSoloToggle(quickTabId, newSoloedTabs, source = 'unknown') {
    // v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
    const validation = this._validateCrossTabOwnership(quickTabId, 'solo toggle', source);
    if (!validation.valid) {
      return validation.result;
    }

    // v1.6.3.10-v11 - FIX Issue #10: Pass source to _handleVisibilityToggle
    this._handleVisibilityToggle(quickTabId, {
      mode: 'SOLO',
      newTabs: newSoloedTabs,
      tabsProperty: 'soloedOnTabs',
      clearProperty: 'mutedOnTabs',
      updateButton: this._updateSoloButton.bind(this)
    }, source);
    return { success: true };
  }

  /**
   * Handle mute toggle from Quick Tab window or panel
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newMutedTabs - Array of tab IDs where Quick Tab should be hidden
   * @param {string} source - Source of action
   * @returns {{ success: boolean, error?: string }}
   */
  handleMuteToggle(quickTabId, newMutedTabs, source = 'unknown') {
    // v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
    const validation = this._validateCrossTabOwnership(quickTabId, 'mute toggle', source);
    if (!validation.valid) {
      return validation.result;
    }

    // v1.6.3.10-v11 - FIX Issue #10: Pass source to _handleVisibilityToggle
    this._handleVisibilityToggle(quickTabId, {
      mode: 'MUTE',
      newTabs: newMutedTabs,
      tabsProperty: 'mutedOnTabs',
      clearProperty: 'soloedOnTabs',
      updateButton: this._updateMuteButton.bind(this)
    }, source);
    return { success: true };
  }

  /**
   * Common handler for solo/mute visibility toggles
   * v1.6.3 - Local only (no storage writes)
   * v1.6.3.10-v10 - FIX Issue 5.1: Add ownership validation and lock for atomicity
   * v1.6.3.10-v11 - FIX Issue #10: Pass source to lock methods
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} config - Configuration for toggle operation
   * @param {string} [source='UI'] - Source of the operation
   */
  _handleVisibilityToggle(quickTabId, config, source = 'UI') {
    const { mode, newTabs, tabsProperty, clearProperty, updateButton } = config;

    console.log(`[VisibilityHandler] Toggling ${mode.toLowerCase()} for ${quickTabId}:`, newTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // v1.6.3.10-v10 - FIX Issue 5.1: Validate ownership before mutation
    if (!this._isOwnedByCurrentTab(tab)) {
      console.warn(`${this._logPrefix} VISIBILITY_TOGGLE_BLOCKED: Not owned by current tab:`, {
        quickTabId,
        mode,
        originTabId: tab.originTabId,
        currentTabId: this.currentTabId
      });
      return;
    }

    // v1.6.3.10-v10 - FIX Issue 5.1: Use lock to prevent concurrent modifications
    // v1.6.3.10-v11 - FIX Issue #10: Pass source to lock
    if (!this._tryAcquireLock('visibility', quickTabId, source)) {
      console.warn(`${this._logPrefix} VISIBILITY_TOGGLE_BLOCKED: Lock held for:`, {
        quickTabId,
        mode,
        source
      });
      return;
    }

    try {
      // Update visibility state (mutually exclusive)
      tab[tabsProperty] = newTabs;
      tab[clearProperty] = [];

      // Update button states if tab has them
      updateButton(tab, newTabs);
    } finally {
      this._releaseLock('visibility', quickTabId, source);
    }
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
   * v1.6.3.10-v11 - FIX Issue #10: Add source to lock key, add timeout recovery
   * @private
   * @param {string} operation - Operation type ('minimize', 'restore', 'visibility', etc.)
   * @param {string} id - Quick Tab ID
   * @param {string} [source='unknown'] - Source of the operation ('UI', 'Manager', 'background', etc.)
   * @returns {boolean} True if lock acquired, false if operation already in progress
   */
  _tryAcquireLock(operation, id, source = 'unknown') {
    // v1.6.3.10-v4 - FIX Issue #14: Include tab context to prevent cross-tab lock conflicts
    // v1.6.3.10-v11 - FIX Issue #10: Include source in lock key to distinguish operation origins
    const lockKey = `${operation}-${this.currentTabId}-${id}-${source}`;
    const now = Date.now();
    const existingLock = this._operationLocks.get(lockKey);

    // If lock exists, check if it's still valid
    if (existingLock) {
      const lockAge = now - existingLock.timestamp;
      
      // v1.6.3.10-v11 - FIX Issue #10: Log warning if lock held too long
      if (lockAge >= LOCK_WARNING_THRESHOLD_MS && lockAge < LOCK_TIMEOUT_MS) {
        console.warn(`${this._logPrefix} LOCK_HELD_WARNING: Lock held for ${lockAge}ms`, {
          lockKey,
          operation,
          id,
          source,
          holder: existingLock.source,
          warningThresholdMs: LOCK_WARNING_THRESHOLD_MS
        });
      }
      
      // v1.6.3.10-v11 - FIX Issue #10: Auto-release if lock held too long (timeout recovery)
      if (lockAge >= LOCK_TIMEOUT_MS) {
        console.error(`${this._logPrefix} LOCK_TIMEOUT_RECOVERY: Auto-releasing stale lock`, {
          lockKey,
          operation,
          id,
          source,
          previousHolder: existingLock.source,
          lockAgeMs: lockAge,
          timeoutMs: LOCK_TIMEOUT_MS
        });
        // Fall through to acquire the lock
      } else if (lockAge < OPERATION_LOCK_MS) {
        // Lock is still valid and not timed out
        console.log(`${this._logPrefix} Lock blocked duplicate ${operation} for:`, {
          id,
          requestingSource: source,
          holdingSource: existingLock.source,
          lockAgeMs: lockAge
        });
        return false;
      }
    }

    // Acquire lock with source tracking
    this._operationLocks.set(lockKey, { 
      timestamp: now, 
      source,
      operation,
      id 
    });
    
    console.log(`${this._logPrefix} Lock acquired:`, {
      lockKey,
      operation,
      id,
      source
    });
    
    return true;
  }

  /**
   * Release a lock for an operation
   * v1.6.3.2 - FIX Issue #2: Mutex pattern cleanup
   * v1.6.3.10-v4 - FIX Issue #14: Include tab context in lock key
   * v1.6.3.10-v11 - FIX Issue #10: Include source in lock key
   * @private
   * @param {string} operation - Operation type ('minimize', 'restore', 'visibility', etc.)
   * @param {string} id - Quick Tab ID
   * @param {string} [source='unknown'] - Source of the operation
   */
  _releaseLock(operation, id, source = 'unknown') {
    // v1.6.3.10-v4 - FIX Issue #14: Include tab context in lock key
    // v1.6.3.10-v11 - FIX Issue #10: Include source in lock key
    const lockKey = `${operation}-${this.currentTabId}-${id}-${source}`;
    const lock = this._operationLocks.get(lockKey);
    
    if (lock) {
      const lockDuration = Date.now() - lock.timestamp;
      console.log(`${this._logPrefix} Lock released:`, {
        lockKey,
        operation,
        id,
        source,
        lockDurationMs: lockDuration
      });
    }
    
    this._operationLocks.delete(lockKey);
  }

  /**
   * Check minimize preconditions
   * v1.6.3.5-v11 - Extracted to reduce handleMinimize complexity
   * v1.6.3.10-v11 - FIX Issue #10: Pass source to lock methods
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

    // Check mutex lock - v1.6.3.10-v11: Pass source
    if (!this._tryAcquireLock('minimize', id, source)) {
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
      this._releaseLock('minimize', id, source);
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
   * v1.6.3.10-v11 - FIX Issue #16: Operation completion logging with operation ID
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   * @returns {{ success: boolean, error?: string }} Result object for message handlers
   */
  handleMinimize(id, source = 'unknown') {
    // v1.6.3.10-v11 - FIX Issue #16: Generate operation ID for tracing
    const operationStartTime = Date.now();
    const operationId = `minimize-${id}-${operationStartTime}`;
    
    console.log(`${this._logPrefix} handleMinimize ENTRY:`, {
      id,
      source,
      operationId
    });

    // v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
    const ownershipValidation = this._validateCrossTabOwnership(id, 'minimize', source);
    if (!ownershipValidation.valid) {
      console.log(`${this._logPrefix} handleMinimize COMPLETED:`, {
        id,
        operationId,
        outcome: 'error',
        errorReason: 'ownership_validation_failed',
        durationMs: Date.now() - operationStartTime
      });
      return ownershipValidation.result;
    }

    const tabWindow = this.quickTabsMap.get(id);

    // v1.6.3.5-v11 - FIX Issue #4: Check preconditions
    const preconditions = this._checkMinimizePreconditions(id, tabWindow, source);
    if (!preconditions.canProceed) {
      console.log(`${this._logPrefix} handleMinimize COMPLETED:`, {
        id,
        operationId,
        outcome: 'blocked',
        errorReason: preconditions.result?.error || 'precondition_failed',
        durationMs: Date.now() - operationStartTime
      });
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
        console.log(`${this._logPrefix} handleMinimize COMPLETED:`, {
          id,
          operationId,
          outcome: 'error',
          errorReason: 'instance_validation_failed',
          durationMs: Date.now() - operationStartTime
        });
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

      // v1.6.3.10-v11 - FIX Issue #16: Log completion with success
      console.log(`${this._logPrefix} handleMinimize COMPLETED:`, {
        id,
        operationId,
        outcome: 'success',
        durationMs: Date.now() - operationStartTime,
        storageWriteScheduled: true
      });

      return { success: true };
    } catch (err) {
      // v1.6.3.10-v11 - FIX Issue #16: Log completion with exception
      console.error(`${this._logPrefix} handleMinimize COMPLETED:`, {
        id,
        operationId,
        outcome: 'error',
        errorReason: err.message,
        durationMs: Date.now() - operationStartTime,
        stack: err.stack
      });
      throw err;
    } finally {
      // v1.6.3.4-v7 - FIX Issue #6: Guarantee lock release even on exceptions
      // v1.6.3.10-v11 - FIX Issue #10: Pass source to lock
      this._releaseLock('minimize', id, source);
    }
  }

  /**
   * Check if restore operation can proceed
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * v1.6.3.10-v11 - FIX Issue #10: Pass source to lock methods
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @returns {boolean} True if operation can proceed
   */
  _canProceedWithRestore(id, source = 'unknown') {
    // Check mutex lock - v1.6.3.10-v11: Pass source
    if (!this._tryAcquireLock('restore', id, source)) {
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
      this._releaseLock('restore', id, source);
      return false;
    }

    return true;
  }

  /**
   * Cleanup after failed restore attempt
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * v1.6.3.10-v11 - FIX Issue #10: Add source parameter for lock release
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} [source='unknown'] - Source of action
   */
  _cleanupFailedRestore(id, source = 'unknown') {
    this._pendingRestore.delete(id);
    this._releaseLock('restore', id, source);
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
   * v1.6.3.10-v11 - FIX Issue #10: Pass source to lock, Issue #16: Operation completion logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   * @returns {{ success: boolean, error?: string }} Result object for message handlers
   */
  async handleRestore(id, source = 'unknown') {
    // v1.6.3.10-v11 - FIX Issue #16: Generate operation ID for tracing
    const operationStartTime = Date.now();
    const operationId = `restore-${id}-${operationStartTime}`;
    
    console.log(`${this._logPrefix} handleRestore ENTRY:`, {
      id,
      source,
      operationId
    });

    // v1.6.3.10-v4 - FIX Issue #9: Cross-tab ownership validation
    const ownershipValidation = this._validateCrossTabOwnership(id, 'restore', source);
    if (!ownershipValidation.valid) {
      console.log(`${this._logPrefix} handleRestore COMPLETED:`, {
        id,
        operationId,
        outcome: 'error',
        errorReason: 'ownership_validation_failed',
        durationMs: Date.now() - operationStartTime
      });
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
      console.log(`${this._logPrefix} handleRestore COMPLETED:`, {
        id,
        operationId,
        outcome: 'blocked',
        errorReason: 'precondition_failed',
        durationMs: Date.now() - operationStartTime
      });
      return { success: false, error: 'Operation blocked (lock held or pending)' };
    }

    // v1.6.3.4-v7 - FIX Issue #6: Use try/finally to ensure lock is ALWAYS released
    try {
      const result = this._executeRestore(id, source, operationId, operationStartTime);
      return result;
    } catch (err) {
      // v1.6.3.10-v11 - FIX Issue #16: Log completion with exception
      console.error(`${this._logPrefix} handleRestore COMPLETED:`, {
        id,
        operationId,
        outcome: 'error',
        errorReason: err.message,
        durationMs: Date.now() - operationStartTime,
        stack: err.stack
      });
      throw err;
    } finally {
      // v1.6.3.4-v7 - FIX Issue #6: Guarantee lock release even on exceptions
      // v1.6.3.10-v11 - FIX Issue #10: Pass source to lock
      this._releaseLock('restore', id, source);
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
   * v1.6.3.10-v11 - FIX Issue #9: Enhanced callback re-wiring with timeout recovery
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
    // Previously only onMinimize and onFocus were re-wired, but position/size/solo/mute
    // callbacks also need to be re-wired to ensure proper state persistence
    const freshCallbacks = {
      onMinimize: tabId => this.handleMinimize(tabId, 'UI'),
      onFocus: tabId => this.handleFocus(tabId),
      // v1.6.3.10-v10 - FIX Issue 2.1: Add missing position/size/solo/mute callbacks
      onSolo: (tabId, soloedTabs) => this.handleSoloToggle(tabId, soloedTabs, 'UI'),
      onMute: (tabId, mutedTabs) => this.handleMuteToggle(tabId, mutedTabs, 'UI')
    };

    // Note: Position/size callbacks (onPositionChange, onPositionChangeEnd, onSizeChange, onSizeChangeEnd)
    // are wired by UICoordinator via UpdateHandler as they require UpdateHandler context.
    // Emit an event so UICoordinator can re-wire those callbacks.
    // v1.6.3.10-v11 - FIX Issue #9: Add timeout recovery for UICoordinator event
    const CALLBACK_REWIRE_TIMEOUT_MS = 500;
    let callbackRewireAcknowledged = false;
    
    if (this.eventBus) {
      // Set up one-time listener for acknowledgment
      const ackHandler = (ackData) => {
        if (ackData?.id === id) {
          callbackRewireAcknowledged = true;
          console.log(`${this._logPrefix} Callback re-wire acknowledged by UICoordinator:`, {
            id,
            source,
            ackData
          });
        }
      };
      
      // Listen for acknowledgment (UICoordinator should emit this after re-wiring)
      this.eventBus.once('tab:callback-rewire-ack', ackHandler);
      
      this.eventBus.emit('tab:needs-callback-rewire', {
        id,
        source,
        callbacksNeeded: ['onPositionChange', 'onPositionChangeEnd', 'onSizeChange', 'onSizeChangeEnd']
      });
      
      // v1.6.3.10-v11 - FIX Issue #9: Timeout recovery if UICoordinator doesn't acknowledge
      setTimeout(() => {
        if (!callbackRewireAcknowledged) {
          console.warn(`${this._logPrefix} CALLBACK_REWIRE_TIMEOUT: UICoordinator did not acknowledge within ${CALLBACK_REWIRE_TIMEOUT_MS}ms`, {
            id,
            source,
            note: 'Position/size callbacks may not be re-wired. User may need to reload page.'
          });
          
          // Remove the listener to prevent memory leak
          this.eventBus.off('tab:callback-rewire-ack', ackHandler);
          
          // v1.6.3.10-v11 - FIX Issue #9: Emit warning event for monitoring
          this.eventBus.emit('tab:callback-rewire-timeout', {
            id,
            source,
            timeoutMs: CALLBACK_REWIRE_TIMEOUT_MS
          });
        }
      }, CALLBACK_REWIRE_TIMEOUT_MS);
    }

    const rewired = tabWindow.rewireCallbacks(freshCallbacks);
    console.log(`${this._logPrefix} Re-wired callbacks after restore (source: ${source}):`, {
      id,
      rewired,
      callbacksProvided: Object.keys(freshCallbacks),
      pendingUICoordinatorCallbacks: ['onPositionChange', 'onPositionChangeEnd', 'onSizeChange', 'onSizeChangeEnd']
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
   * Log operation completion with tracing info
   * v1.6.3.10-v11 - FIX Code Health: Extracted to reduce _executeRestore complexity
   * @private
   */
  _logOperationCompletion(options) {
    const { id, operationId, operationStartTime, outcome, error, note, tabWindow } = options;
    
    if (!operationId || !operationStartTime) return;
    
    const completionLog = {
      id,
      operationId,
      outcome,
      durationMs: Date.now() - operationStartTime
    };
    
    if (error) completionLog.errorReason = error;
    if (note) completionLog.note = note;
    if (outcome === 'success') {
      completionLog.storageWriteScheduled = true;
      if (tabWindow?.zIndex !== undefined) {
        completionLog.newZIndex = tabWindow.zIndex;
      }
    }
    
    console.log(`${this._logPrefix} handleRestore COMPLETED:`, completionLog);
  }

  /**
   * Execute restore operation (extracted to reduce handleRestore complexity)
   * v1.6.3.4-v7 - Helper for try/finally pattern in handleRestore
   * v1.6.3.4-v9 - FIX Issue #20: Add validation before proceeding
   * v1.6.3.5-v5 - FIX Issues #1, #6: DOM verification and transaction pattern with rollback
   * v1.6.3.5-v11 - FIX Issue #7, #9: Z-index sync and logging during restore
   * v1.6.3.10-v11 - FIX Issue #16: Operation ID for completion logging
   * Refactored: Extracted helpers to reduce complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @param {string} [operationId] - Operation ID for tracing
   * @param {number} [operationStartTime] - Operation start timestamp
   */
  _executeRestore(id, source, operationId = null, operationStartTime = null) {
    console.log(`${this._logPrefix}[_executeRestore] ENTRY (source: ${source}):`, { id, operationId });

    const tabWindow = this.quickTabsMap.get(id);

    // Validate preconditions
    const validation = this._validateRestorePreconditions(tabWindow, id, source);
    if (!validation.valid) {
      this._logOperationCompletion({ id, operationId, operationStartTime, outcome: 'error', error: validation.error });
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
      this._logOperationCompletion({ id, operationId, operationStartTime, outcome: 'success', note: 'not_in_minimized_manager' });
      return { success: true };
    }

    // Perform restore on tabWindow (includes callback re-wiring)
    this._performTabWindowRestore(tabWindow, id, source);

    // Verify DOM state after restore
    this._verifyRestoreAndEmit(id, tabWindow, source, preRestoreState);

    // Emit restore event for legacy handlers
    this._emitLegacyRestoredEvent(id, source);

    // Log completion with success
    this._logOperationCompletion({ id, operationId, operationStartTime, outcome: 'success', tabWindow });

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
   * Handle Quick Tab focus (bring to front)
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.4 - FIX Issue #3: Persist z-index to storage after focus
   * v1.6.3.4-v8 - FIX Issue #6: Debounce duplicate focus events (100ms)
   * v1.6.3.5-v11 - FIX Issues #8, #9:
   *   - Issue #8: Defensive checks for container existence and DOM attachment
   *   - Issue #9: Comprehensive z-index operation logging
   * v1.6.3.5-v12 - FIX Issue #2: Add fallback DOM query for z-index update
   * v1.6.3.10-v4 - FIX Issues #9, #10: Cross-tab ownership validation
   *
   * @param {string} id - Quick Tab ID
   */
  handleFocus(id) {
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

    // v1.6.3.10-v4 - FIX Issues #9, #10: Cross-tab ownership validation
    // Only allow focus from owning tab to prevent z-index leakage
    if (tabWindow.originTabId !== null && tabWindow.originTabId !== undefined) {
      if (tabWindow.originTabId !== this.currentTabId) {
        console.log(`${this._logPrefix}[handleFocus] Cross-tab focus rejected:`, {
          id,
          originTabId: tabWindow.originTabId,
          currentTabId: this.currentTabId
        });
        return;
      }
    }

    // v1.6.3.10-v10 - FIX Issue 3.2: Recycle z-indices if threshold exceeded
    if (this.currentZIndex.value >= Z_INDEX_RECYCLE_THRESHOLD) {
      this._recycleZIndices();
    }

    // Store old z-index for logging
    const oldZIndex = tabWindow.zIndex;

    // Increment z-index counter and update entity
    this.currentZIndex.value++;
    const newZIndex = this.currentZIndex.value;

    console.log(`${this._logPrefix}[handleFocus] Z-index increment:`, {
      id,
      oldZIndex,
      newZIndex,
      counterValue: this.currentZIndex.value
    });

    tabWindow.zIndex = newZIndex;

    // Apply z-index via helper
    this._applyZIndexUpdate(id, { tabWindow, newZIndex, hasContainer, isAttachedToDOM });

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
   * Recycle z-indices to prevent unbounded growth
   * v1.6.3.10-v10 - FIX Issue 3.2: Reset z-index counter and reassign to all Quick Tabs
   * @private
   */
  _recycleZIndices() {
    console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Counter exceeded threshold`, {
      currentValue: this.currentZIndex.value,
      threshold: Z_INDEX_RECYCLE_THRESHOLD
    });

    // Sort tabs by current z-index to maintain stacking order
    const sortedTabs = Array.from(this.quickTabsMap.entries())
      .sort(([, a], [, b]) => (a.zIndex || 0) - (b.zIndex || 0));

    // Reset counter to base value
    this.currentZIndex.value = 1000;

    // Reassign z-indices maintaining relative order
    for (const [id, tabWindow] of sortedTabs) {
      this.currentZIndex.value++;
      const newZIndex = this.currentZIndex.value;
      tabWindow.zIndex = newZIndex;

      // Update DOM if container exists
      if (tabWindow.container) {
        tabWindow.container.style.zIndex = newZIndex.toString();
      }

      console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Reassigned`, {
        id,
        newZIndex
      });
    }

    console.log(`${this._logPrefix} Z-INDEX_RECYCLE: Complete`, {
      newCounterValue: this.currentZIndex.value,
      tabsRecycled: sortedTabs.length
    });
  }

  /**
   * Update solo button appearance
   * @private
   * @param {Object} tab - Quick Tab instance
   * @param {number[]} soloedOnTabs - Array of tab IDs
   */
  _updateSoloButton(tab, soloedOnTabs) {
    if (!tab.soloButton) return;

    const isSoloed = soloedOnTabs.length > 0;
    tab.soloButton.textContent = isSoloed ? '🎯' : '⭕';
    tab.soloButton.title = isSoloed ? 'Un-solo (show on all tabs)' : 'Solo (show only on this tab)';
    tab.soloButton.style.background = isSoloed ? '#444' : 'transparent';
  }

  /**
   * Update mute button appearance
   * @private
   * @param {Object} tab - Quick Tab instance
   * @param {number[]} mutedOnTabs - Array of tab IDs
   */
  _updateMuteButton(tab, mutedOnTabs) {
    if (!tab.muteButton) return;

    const isMuted = mutedOnTabs.includes(this.currentTabId);
    tab.muteButton.textContent = isMuted ? '🔇' : '🔊';
    tab.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
    tab.muteButton.style.background = isMuted ? '#c44' : 'transparent';
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

    // v1.6.3.5-v12 - FIX Issue A: Log whether this is a focus operation persist
    // Code Review: Renamed from isFocusOnlyChange to isFocusOperation for accuracy
    const isFocusOperation = operation === 'focus';

    console.log('[VisibilityHandler] Persist triggered:', {
      id,
      source,
      trigger: operation,
      isFocusOperation
    });

    console.log(`[VisibilityHandler] _debouncedPersist scheduling (source: ${source}):`, {
      id,
      operation,
      timerId,
      existingTimer: this._debounceTimers.has(id),
      activeTimerCount: this._activeTimerIds.size,
      scheduledDelayMs: MINIMIZE_DEBOUNCE_MS
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

    // Set new debounce timer with timer ID check
    const callbackOptions = { operation, source, timerId, timerScheduleTime };
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
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} options - Callback options
   * @param {string} options.operation - Operation type ('minimize', 'restore', 'focus')
   * @param {string} options.source - Source of action
   * @param {string} options.timerId - Unique timer ID
   * @param {number} options.timerScheduleTime - Timestamp when timer was scheduled
   */
  async _executeDebouncedPersistCallback(id, options) {
    const { operation, source, timerId, timerScheduleTime } = options;

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

    // v1.6.3.5-v3 - FIX Diagnostic Issue #7: Log timer callback STARTED with actual delay
    const callbackStartTime = Date.now();
    console.log(`[VisibilityHandler] Timer callback STARTED (source: ${source}):`, {
      id,
      operation,
      timerId,
      scheduledDelayMs: MINIMIZE_DEBOUNCE_MS,
      actualDelayMs: actualDelay,
      pendingMinimizeSize: this._pendingMinimize.size,
      pendingRestoreSize: this._pendingRestore.size
    });

    this._debounceTimers.delete(id);

    // Clear pending flags
    this._pendingMinimize.delete(id);
    this._pendingRestore.delete(id);

    // v1.6.3.2 - FIX Issue #2: Release operation locks
    // v1.6.3.10-v11 - FIX Issue #10: Pass source to lock release
    this._releaseLock('minimize', id, source);
    this._releaseLock('restore', id, source);

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
      await Promise.race([
        this._persistToStorage(),
        timeoutPromise
      ]);
      // Reset timeout count on success
      this._storageTimeoutCount = 0;
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

    // v1.6.3.4-v2 - FIX Bug #1: Await the async persist and log result
    const success = await persistStateToStorage(state, '[VisibilityHandler]');
    if (!success) {
      // v1.6.3.4-v4 - FIX: More descriptive error message about potential causes
      console.error(
        '[VisibilityHandler] Storage persist failed: operation timed out, storage API unavailable, or quota exceeded'
      );
    }
  }

  /**
   * Register an event listener with tracking for cleanup
   * v1.6.3.10-v11 - FIX Issue #19: Track listeners for later removal
   * @param {EventTarget} target - Target to add listener to
   * @param {string} type - Event type
   * @param {Function} listener - Event listener function
   * @param {Object} [options] - addEventListener options
   */
  _registerListener(target, type, listener, options = {}) {
    if (this._isDestroyed) {
      console.warn(`${this._logPrefix} LISTENER_BLOCKED: Handler is destroyed`);
      return;
    }
    
    target.addEventListener(type, listener, options);
    this._registeredListeners.push({ target, type, listener, options });
    
    console.log(`${this._logPrefix} LISTENER_REGISTERED:`, {
      type,
      targetType: target.constructor?.name ?? 'unknown',
      listenerCount: this._registeredListeners.length
    });
  }
  
  /**
   * Create a tracked timer with metadata
   * v1.6.3.10-v11 - FIX Issue #20: Track timers for cleanup and validation
   * @param {Function} callback - Timer callback
   * @param {number} delay - Delay in milliseconds
   * @param {string} type - Timer type ('timeout' or 'interval')
   * @param {string} description - Human-readable description
   * @returns {number} Timer ID
   */
  _createTrackedTimer(callback, delay, type, description) {
    if (this._isDestroyed) {
      console.warn(`${this._logPrefix} TIMER_BLOCKED: Handler is destroyed, skipping ${description}`);
      return null;
    }
    
    const createdAt = Date.now();
    const wrappedCallback = () => {
      // v1.6.3.10-v11 - FIX Issue #20: Validate handler is still active before executing
      if (this._isDestroyed) {
        console.log(`${this._logPrefix} TIMER_SKIPPED: Handler destroyed before execution`, {
          description,
          createdAt,
          waitedMs: Date.now() - createdAt
        });
        return;
      }
      
      // Remove from tracking
      this._activeTimers.delete(timerId);
      
      // Log timer execution
      console.log(`${this._logPrefix} TIMER_FIRED: ${description}`, {
        type,
        activeForMs: Date.now() - createdAt
      });
      
      callback();
    };
    
    let timerId;
    if (type === 'interval') {
      timerId = setInterval(wrappedCallback, delay);
    } else {
      timerId = setTimeout(wrappedCallback, delay);
    }
    
    this._activeTimers.set(timerId, {
      type,
      description,
      createdAt,
      delay
    });
    
    console.log(`${this._logPrefix} TIMER_CREATED: ${description}`, {
      timerId,
      type,
      delay,
      activeTimers: this._activeTimers.size
    });
    
    return timerId;
  }
  
  /**
   * Cancel a tracked timer
   * v1.6.3.10-v11 - FIX Issue #20: Log timer cancellation
   * @param {number} timerId - Timer ID to cancel
   */
  _cancelTrackedTimer(timerId) {
    const timerInfo = this._activeTimers.get(timerId);
    
    if (timerInfo) {
      if (timerInfo.type === 'interval') {
        clearInterval(timerId);
      } else {
        clearTimeout(timerId);
      }
      
      const activeForMs = Date.now() - timerInfo.createdAt;
      console.log(`${this._logPrefix} TIMER_CANCELLED: ${timerInfo.description}`, {
        timerId,
        activeForMs
      });
      
      this._activeTimers.delete(timerId);
    }
  }
  
  /**
   * Remove all registered event listeners
   * v1.6.3.10-v11 - FIX Issue #19: Helper to reduce destroy() complexity
   * @private
   */
  _cleanupEventListeners() {
    if (!this._registeredListeners) return;
    
    const count = this._registeredListeners.length;
    for (const { target, type, listener, options } of this._registeredListeners) {
      try {
        target.removeEventListener(type, listener, options);
      } catch (err) {
        console.warn(`${this._logPrefix} Failed to remove listener:`, { type, error: err.message });
      }
    }
    console.log(`${this._logPrefix} LISTENERS_REMOVED: ${count}`);
    this._registeredListeners = [];
  }
  
  /**
   * Clear a single timer by ID and type
   * v1.6.3.10-v11 - FIX Issue #20: Helper to reduce nesting depth
   * @private
   * @param {number} timerId - Timer ID
   * @param {Object} timerInfo - Timer info object
   */
  _clearSingleTimer(timerId, timerInfo) {
    const activeForMs = Date.now() - timerInfo.createdAt;
    console.log(`${this._logPrefix} TIMER_CLEARED: ${timerInfo.description}`, {
      timerId,
      activeForMs
    });
    
    if (timerInfo.type === 'interval') {
      clearInterval(timerId);
    } else {
      clearTimeout(timerId);
    }
  }
  
  /**
   * Clear all tracked timers
   * v1.6.3.10-v11 - FIX Issue #20: Helper to reduce destroy() complexity
   * @private
   */
  _cleanupTrackedTimers() {
    if (!this._activeTimers) return;
    
    let clearedCount = 0;
    for (const [timerId, timerInfo] of this._activeTimers) {
      this._clearSingleTimer(timerId, timerInfo);
      clearedCount++;
    }
    console.log(`${this._logPrefix} TIMERS_CLEARED: ${clearedCount}`);
    this._activeTimers.clear();
  }
  
  /**
   * Clear debounce timers
   * v1.6.3.10-v11 - FIX Issue #20: Helper to reduce destroy() complexity
   * @private
   */
  _cleanupDebounceTimers() {
    for (const timer of this._debounceTimers.values()) {
      const timerId = timer?.timeoutId ?? (typeof timer === 'number' ? timer : null);
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    }
    this._debounceTimers.clear();
  }

  /**
   * Destroy handler and cleanup resources
   * v1.6.3.10-v10 - FIX Issue 3.3: Clear all Set/Map references to prevent memory leaks
   * v1.6.3.10-v11 - FIX Issue #19: Remove all event listeners (refactored)
   * v1.6.3.10-v11 - FIX Issue #20: Clear all tracked timers with logging (refactored)
   */
  destroy() {
    console.log(`${this._logPrefix} HANDLER_DESTROY_START:`, {
      registeredListeners: this._registeredListeners?.length ?? 0,
      activeTimers: this._activeTimers?.size ?? 0,
      pendingMinimize: this._pendingMinimize?.size ?? 0,
      pendingRestore: this._pendingRestore?.size ?? 0
    });
    
    // v1.6.3.10-v11 - FIX Issue #19: Mark as destroyed first to prevent new registrations
    this._isDestroyed = true;

    // v1.6.3.10-v11 - FIX Issue #19: Remove all registered event listeners
    this._cleanupEventListeners();
    
    // v1.6.3.10-v11 - FIX Issue #20: Clear all tracked timers
    this._cleanupTrackedTimers();
    
    // v1.6.3.10-v11 - FIX Issue #22: Clear consistency check interval
    if (this._consistencyCheckIntervalId) {
      clearInterval(this._consistencyCheckIntervalId);
      this._consistencyCheckIntervalId = null;
      console.log(`${this._logPrefix} CONSISTENCY_CHECK_STOPPED`);
    }

    // Clear all pending operations
    this._pendingMinimize.clear();
    this._pendingRestore.clear();

    // Clear all debounce timers
    this._cleanupDebounceTimers();

    // v1.6.3.10-v10 - FIX Issue 3.3: Clear active timer IDs
    this._activeTimerIds.clear();

    // Clear operation locks
    this._operationLocks.clear();

    // Clear initiated operations
    this._initiatedOperations.clear();

    // Clear focus time tracking
    this._lastFocusTime.clear();

    console.log(`${this._logPrefix} HANDLER_DESTROY_COMPLETE:`, {
      timestamp: Date.now()
    });
  }
}
