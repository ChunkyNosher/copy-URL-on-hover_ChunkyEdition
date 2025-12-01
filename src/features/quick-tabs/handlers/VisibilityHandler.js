/**
 * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.4 - FIX Bug #2: Persist to storage after minimize/restore
 * v1.6.4.1 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.4.5 - FIX Issues #1, #2, #6: Debounce minimize/restore, prevent event storms
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
 *
 * Responsibilities:
 * - Handle solo toggle (show only on specific tabs)
 * - Handle mute toggle (hide on specific tabs)
 * - Handle minimize operation
 * - Handle focus operation (bring to front)
 * - Update button appearances
 * - Emit events for coordinators
 * - Persist state to storage after visibility changes
 *
 * @version 1.6.4.12
 */

import { buildStateForStorage, persistStateToStorage, validateStateForPersist } from '@utils/storage-utils.js';

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

/**
 * VisibilityHandler class
 * Manages Quick Tab visibility states (solo, mute, minimize, focus)
 * v1.6.3 - Local only (no cross-tab sync or storage persistence)
 * v1.6.4 - Now persists state to storage after minimize/restore
 * v1.6.4.1 - Proper async handling with validation and timeout for storage
 * v1.6.4.5 - Debouncing to prevent event storms and ensure atomic storage writes
 * v1.6.3.2 - Mutex/lock pattern to prevent duplicate operations from multiple sources
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
    
    // v1.6.4.5 - FIX Issues #1, #2: Track pending operations to prevent duplicates
    this._pendingMinimize = new Set();
    this._pendingRestore = new Set();
    this._debounceTimers = new Map();
    
    // v1.6.3.2 - FIX Issue #2: Mutex/lock pattern for operations
    // Key: operation-id (e.g., "minimize-qt-123"), Value: timestamp when lock was acquired
    this._operationLocks = new Map();
    
    // v1.6.3.4-v8 - FIX Issue #3: Track operations initiated by this handler
    // to suppress callbacks that would cause circular propagation
    this._initiatedOperations = new Set();
    
    // v1.6.3.4-v8 - FIX Issue #6: Track recent focus events for debouncing
    this._lastFocusTime = new Map(); // id -> timestamp
  }

  /**
   * Handle solo toggle from Quick Tab window or panel
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newSoloedTabs - Array of tab IDs where Quick Tab should be visible
   */
  handleSoloToggle(quickTabId, newSoloedTabs) {
    this._handleVisibilityToggle(quickTabId, {
      mode: 'SOLO',
      newTabs: newSoloedTabs,
      tabsProperty: 'soloedOnTabs',
      clearProperty: 'mutedOnTabs',
      updateButton: this._updateSoloButton.bind(this)
    });
  }

  /**
   * Handle mute toggle from Quick Tab window or panel
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newMutedTabs - Array of tab IDs where Quick Tab should be hidden
   */
  handleMuteToggle(quickTabId, newMutedTabs) {
    this._handleVisibilityToggle(quickTabId, {
      mode: 'MUTE',
      newTabs: newMutedTabs,
      tabsProperty: 'mutedOnTabs',
      clearProperty: 'soloedOnTabs',
      updateButton: this._updateMuteButton.bind(this)
    });
  }

  /**
   * Common handler for solo/mute visibility toggles
   * v1.6.3 - Local only (no storage writes)
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} config - Configuration for toggle operation
   */
  _handleVisibilityToggle(quickTabId, config) {
    const { mode, newTabs, tabsProperty, clearProperty, updateButton } = config;

    console.log(`[VisibilityHandler] Toggling ${mode.toLowerCase()} for ${quickTabId}:`, newTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // Update visibility state (mutually exclusive)
    tab[tabsProperty] = newTabs;
    tab[clearProperty] = [];

    // Update button states if tab has them
    updateButton(tab, newTabs);
  }

  /**
   * Create minimal Quick Tab data object for state:updated events
   * v1.6.3.1 - Helper to reduce code duplication
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
      title: tabWindow?.title
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
    const lockKey = `${operation}-${id}`;
    const now = Date.now();
    const existingLock = this._operationLocks.get(lockKey);
    
    // If lock exists and hasn't expired, operation is in progress
    if (existingLock && (now - existingLock) < OPERATION_LOCK_MS) {
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
   * @private
   * @param {string} operation - Operation type ('minimize' or 'restore')
   * @param {string} id - Quick Tab ID
   */
  _releaseLock(operation, id) {
    const lockKey = `${operation}-${id}`;
    this._operationLocks.delete(lockKey);
  }

  /**
   * Handle Quick Tab minimize
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.1 - FIX Bug #7: Emit state:updated for panel sync
   * v1.6.4 - FIX Bug #2: Persist to storage after minimize
   * v1.6.4.4 - FIX Bug #6: Call tabWindow.minimize() to actually hide the window
   * v1.6.4.5 - FIX Issues #1, #2: Debounce to prevent event storms
   * v1.6.3.2 - FIX Issue #2: Use mutex/lock pattern for true duplicate prevention
   * v1.6.3.4 - FIX Issues #5, #6: Atomic Map cleanup, source logging
   * v1.6.3.4-v5 - FIX Issue #7: Update entity.minimized = true FIRST (entity is source of truth)
   * v1.6.3.4-v7 - FIX Issues #3, #6: Instance validation and try/finally for lock cleanup
   * v1.6.3.4-v8 - FIX Issue #3: Suppress callbacks during handler-initiated operations
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   * @returns {{ success: boolean, error?: string }} Result object for message handlers
   */
  handleMinimize(id, source = 'unknown') {
    // v1.6.3.4-v8 - FIX Issue #3: Check if this is a callback from our own minimize() call
    const operationKey = `minimize-${id}`;
    if (this._initiatedOperations.has(operationKey)) {
      console.log(`[VisibilityHandler] Suppressing callback re-entry for minimize (source: ${source}):`, id);
      return { success: true, error: 'Suppressed callback' };
    }
    
    // v1.6.3.2 - FIX Issue #2: Use mutex to prevent multiple sources triggering same operation
    if (!this._tryAcquireLock('minimize', id)) {
      console.log(`[VisibilityHandler] Ignoring duplicate minimize request (lock held, source: ${source}) for:`, id);
      return { success: false, error: 'Operation lock held' };
    }

    // v1.6.3.4-v7 - FIX Issue #6: Use try/finally to ensure lock is ALWAYS released
    try {
      // v1.6.4.5 - FIX Issue #1: Prevent duplicate minimize operations
      if (this._pendingMinimize.has(id)) {
        console.log(`[VisibilityHandler] Ignoring duplicate minimize request (pending, source: ${source}) for:`, id);
        return { success: false, error: 'Operation pending' };
      }
      
      // v1.6.4 - FIX Issue #1: Log at start to confirm button was clicked
      // v1.6.3.4 - FIX Issue #6: Include source in log
      console.log(`[VisibilityHandler] Minimize button clicked (source: ${source}) for Quick Tab:`, id);

      const tabWindow = this.quickTabsMap.get(id);
      if (!tabWindow) {
        console.warn(`[VisibilityHandler] Tab not found for minimize (source: ${source}):`, id);
        return { success: false, error: 'Tab not found' };
      }
      
      // v1.6.3.4-v7 - FIX Issue #3: Validate this is a real QuickTabWindow instance
      if (typeof tabWindow.minimize !== 'function') {
        console.error(`[VisibilityHandler] Invalid tab instance (not QuickTabWindow, source: ${source}):`, {
          id,
          type: tabWindow.constructor?.name,
          hasMinimize: typeof tabWindow.minimize
        });
        // Remove invalid entry from map
        this.quickTabsMap.delete(id);
        return { success: false, error: 'Invalid tab instance (not QuickTabWindow)' };
      }
      
      // v1.6.4.5 - FIX Issue #1: Mark as pending to prevent duplicate clicks
      this._pendingMinimize.add(id);

      // v1.6.3.4-v5 - FIX Issue #7: Update entity.minimized = true FIRST (entity is source of truth)
      // Note: tabWindow IS the entity in quickTabsMap - they reference the same object
      // This must happen BEFORE calling minimizedManager.add() or tabWindow.minimize()
      // so that all downstream reads see the correct state
      console.log(`[VisibilityHandler] Updating entity.minimized = true (source: ${source}) for:`, id);
      tabWindow.minimized = true;

      // Add to minimized manager BEFORE calling minimize (to capture correct position/size)
      this.minimizedManager.add(id, tabWindow);

      // v1.6.3.4-v8 - FIX Issue #3: Mark this operation as initiated by handler to suppress callback
      this._initiatedOperations.add(operationKey);
      try {
        // v1.6.4.4 - FIX Bug #6: Actually minimize the window (hide it)
        tabWindow.minimize();
        console.log(`[VisibilityHandler] Called tabWindow.minimize() (source: ${source}) for:`, id);
      } finally {
        // v1.6.3.4-v8 - Clear the suppression flag after short delay (allows any pending callbacks)
        setTimeout(() => this._initiatedOperations.delete(operationKey), CALLBACK_SUPPRESSION_DELAY_MS);
      }

      // v1.6.3.4 - FIX Issue #5: Do NOT delete from Map during minimize
      // The tab still exists, it's just hidden. Map entry needed for restore.
      // Note: tabWindow.minimize() already sets container = null, so isRendered() will be false

      // Emit minimize event for legacy handlers
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id, source });
      }

      // v1.6.3.1 - FIX Bug #7: Emit state:updated for panel to refresh
      // This allows PanelContentManager to update when Quick Tab is minimized from its window
      if (this.eventBus) {
        const quickTabData = this._createQuickTabData(id, tabWindow, true);
        quickTabData.source = source; // v1.6.3.4 - FIX Issue #6: Add source
        this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
        console.log(`[VisibilityHandler] Emitted state:updated for minimize (source: ${source}):`, id);
      }

      // v1.6.4.5 - FIX Issue #6: Persist to storage with debounce
      this._debouncedPersist(id, 'minimize', source);
      
      return { success: true };
    } finally {
      // v1.6.3.4-v7 - FIX Issue #6: Guarantee lock release even on exceptions
      this._releaseLock('minimize', id);
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
      console.log(`[VisibilityHandler] Ignoring duplicate restore request (lock held, source: ${source}) for:`, id);
      return false;
    }

    // Check pending flag
    if (this._pendingRestore.has(id)) {
      console.log(`[VisibilityHandler] Ignoring duplicate restore request (pending, source: ${source}) for:`, id);
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
    
    console.error(`[VisibilityHandler] Invalid tab instance (not QuickTabWindow, source: ${source}):`, {
      id,
      type: tabWindow.constructor?.name,
      hasRestore: typeof tabWindow.restore
    });
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
    
    console.log(`[VisibilityHandler] Window exists but not in map (source: ${source}), re-registering:`, id);
    this.quickTabsMap.set(id, tabWindow);
    console.log(`[VisibilityHandler] Re-registered tabWindow in quickTabsMap (source: ${source}):`, id);
  }

  /**
   * Handle restore of minimized Quick Tab
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.1 - FIX Bug #7: Emit state:updated for panel sync
   * v1.6.4 - FIX Bug #2: Persist to storage after restore
   * v1.6.4.5 - FIX Issues #1, #2: Debounce to prevent event storms
   * v1.6.3.2 - FIX Issue #2: Use mutex/lock pattern for true duplicate prevention
   * v1.6.3.3 - FIX Issue #1: Re-register window in quickTabsMap after restore to maintain reference
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * v1.6.3.4-v5 - FIX Issues #1, #2, #7: 
   *   - Issue #1: Emit state:updated even when snapshot not found
   *   - Issue #2: Update entity.minimized = false in quickTabsMap after restore
   *   - Issue #7: Entity state is single source of truth - update FIRST
   * v1.6.3.4-v7 - FIX Issues #3, #6: Instance validation and try/finally for lock cleanup
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   * @returns {{ success: boolean, error?: string }} Result object for message handlers
   */
  handleRestore(id, source = 'unknown') {
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
   * Execute restore operation (extracted to reduce handleRestore complexity)
   * v1.6.3.4-v7 - Helper for try/finally pattern in handleRestore
   * @private
   */
  _executeRestore(id, source) {
    console.log(`[VisibilityHandler] Handling restore (source: ${source}) for:`, id);

    const tabWindow = this.quickTabsMap.get(id);
    
    // v1.6.3.4-v7 - FIX Issue #3: Validate instance if it exists
    if (!this._validateTabWindowInstance(tabWindow, id, source)) {
      return { success: false, error: 'Invalid tab instance (not QuickTabWindow)' };
    }
    
    // v1.6.4.5 - FIX Issue #2: Mark as pending to prevent duplicate operations
    this._pendingRestore.add(id);

    // v1.6.3.4-v5 - FIX Issue #7: Update entity.minimized = false FIRST
    if (tabWindow) {
      console.log(`[VisibilityHandler] Updating entity.minimized = false (source: ${source}) for:`, id);
      tabWindow.minimized = false;
    }

    // Restore from minimized manager
    const restored = this.minimizedManager.restore(id);
    if (!restored) {
      console.warn(`[VisibilityHandler] Tab not found in minimized manager (source: ${source}):`, id);
      this._emitRestoreStateUpdate(id, tabWindow, source);
      this._debouncedPersist(id, 'restore', source);
      return { success: true };
    }

    // Call tabWindow.restore() which updates state but does NOT render
    if (tabWindow) {
      tabWindow.restore();
      console.log(`[VisibilityHandler] Called tabWindow.restore() (source: ${source}) for:`, id);
      this._ensureTabInMap(tabWindow, id, source);
    } else {
      console.warn(`[VisibilityHandler] tabWindow not found in quickTabsMap (source: ${source}) for:`, id);
    }

    // Emit restore event for legacy handlers
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_RESTORED, { id, source });
    }

    this._emitRestoreStateUpdate(id, tabWindow, source);
    this._debouncedPersist(id, 'restore', source);
    
    return { success: true };
  }

  /**
   * Emit state:updated event for restore
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * v1.6.4.7 - FIX Issue #4: Verify DOM is rendered before emitting state:updated
   *   Manager was showing green indicator based on entity state, not actual DOM presence.
   * v1.6.3.3 - FIX Bug #3: Remove spurious warnings that fire during successful operations
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   * v1.6.3.4-v2 - FIX Issue #5: Add isRestoreOperation flag to event payload
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance
   * @param {string} source - Source of action
   */
  _emitRestoreStateUpdate(id, tabWindow, source = 'unknown') {
    if (!this.eventBus) {
      return;
    }
    
    // v1.6.3.3 - FIX Bug #3: tabWindow may be null if not in quickTabsMap initially
    // This is not an error condition - UICoordinator will render via state:updated event
    if (!tabWindow) {
      console.log(`[VisibilityHandler] No tabWindow for restore event (source: ${source}), UICoordinator will handle:`, id);
      // Still emit state:updated so UICoordinator can render
      // v1.6.3.4-v2 - FIX Issue #5: Add isRestoreOperation flag
      const quickTabData = { id, minimized: false, domVerified: false, source, isRestoreOperation: true };
      this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
      return;
    }
    
    // v1.6.4.7 - FIX Issue #4: Delay emit until we can verify DOM is rendered
    // This prevents Manager from showing green indicator when window isn't actually visible
    setTimeout(() => {
      // Verify DOM is actually rendered before emitting state:updated
      const isDOMRendered = tabWindow.isRendered ? tabWindow.isRendered() : (tabWindow.container && tabWindow.container.parentNode);
      
      // v1.6.3.3 - FIX Bug #3: Don't warn if DOM not rendered - this is expected during restore
      // UICoordinator will handle rendering, we just report the current state
      if (!isDOMRendered) {
        console.log(`[VisibilityHandler] DOM not yet rendered after restore (source: ${source}), expected during transition:`, id);
      } else {
        console.log(`[VisibilityHandler] DOM verified rendered after restore (source: ${source}):`, id);
      }
      
      const quickTabData = this._createQuickTabData(id, tabWindow, false);
      // v1.6.4.7 - Add DOM verification result to event data
      quickTabData.domVerified = isDOMRendered;
      quickTabData.source = source; // v1.6.3.4 - FIX Issue #6: Add source
      // v1.6.3.4-v2 - FIX Issue #5: Add isRestoreOperation flag so UICoordinator routes correctly
      quickTabData.isRestoreOperation = true;
      this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
      console.log(`[VisibilityHandler] Emitted state:updated for restore (source: ${source}):`, id, { domVerified: isDOMRendered, isRestoreOperation: true });
    }, STATE_EMIT_DELAY_MS);
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
   * Handle Quick Tab focus (bring to front)
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.4 - FIX Issue #3: Persist z-index to storage after focus
   * v1.6.3.4-v8 - FIX Issue #6: Debounce duplicate focus events (100ms)
   *
   * @param {string} id - Quick Tab ID
   */
  handleFocus(id) {
    // v1.6.3.4-v8 - FIX Issue #6: Debounce focus events to prevent duplicates
    const FOCUS_DEBOUNCE_MS = 100;
    const now = Date.now();
    const lastFocus = this._lastFocusTime.get(id) || 0;
    
    if (now - lastFocus < FOCUS_DEBOUNCE_MS) {
      console.log('[VisibilityHandler] Ignoring duplicate focus (within debounce window):', id);
      return;
    }
    this._lastFocusTime.set(id, now);
    
    console.log('[VisibilityHandler] Bringing to front:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Increment z-index and update tab UI
    this.currentZIndex.value++;
    const newZIndex = this.currentZIndex.value;
    tabWindow.updateZIndex(newZIndex);
    
    // v1.6.3.4 - FIX Issue #3: Store the new z-index on the tab for persistence
    tabWindow.zIndex = newZIndex;

    // Emit focus event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, { id });
    }
    
    // v1.6.3.4 - FIX Issue #3: Persist z-index change to storage (debounced)
    this._debouncedPersist(id, 'focus', 'UI');
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
   * v1.6.4.5 - FIX Issues #1, #2, #6: Single atomic storage write after debounce
   * v1.6.3.2 - FIX Issue #2: Release operation locks after debounce completes
   * v1.6.3.4 - FIX Issue #6: Add source to logging
   * @private
   * @param {string} id - Quick Tab ID that triggered the persist
   * @param {string} operation - 'minimize' or 'restore'
   * @param {string} source - Source of action
   */
  _debouncedPersist(id, operation, source = 'unknown') {
    // Clear any existing timer for this tab
    const existingTimer = this._debounceTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new debounce timer
    const timer = setTimeout(async () => {
      this._debounceTimers.delete(id);
      
      // Clear pending flags
      this._pendingMinimize.delete(id);
      this._pendingRestore.delete(id);
      
      // v1.6.3.2 - FIX Issue #2: Release operation locks
      this._releaseLock('minimize', id);
      this._releaseLock('restore', id);
      
      // Perform atomic storage write
      await this._persistToStorage();
      
      console.log(`[VisibilityHandler] Completed ${operation} (source: ${source}) for ${id} with storage persist`);
    }, MINIMIZE_DEBOUNCE_MS);
    
    this._debounceTimers.set(id, timer);
  }

  /**
   * Persist current state to browser.storage.local
   * v1.6.4 - FIX Bug #2: Persist to storage after minimize/restore
   * v1.6.4.1 - FIX Bug #1: Proper async handling with validation
   * v1.6.3.4-v6 - FIX Issue #6: Validate counts and state before persist
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   * @returns {Promise<void>}
   */
  async _persistToStorage() {
    // v1.6.4.1 - FIX Bug #1: Log position/size data when persisting
    console.log('[VisibilityHandler] Building state for storage persist...');
    
    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);
    
    // v1.6.4.1 - FIX Bug #1: Handle null state from validation failure
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
      console.warn('[VisibilityHandler] State validation warnings (proceeding with persist):', validation.errors);
      // Continue with persist despite validation warnings - data integrity is maintained
      // by the individual tab validation in buildStateForStorage
    }
    
    // v1.6.4.1 - FIX Bug #1: Log tab count and minimized states
    console.log(`[VisibilityHandler] Persisting ${state.tabs.length} tabs (${minimizedCount} minimized)`);
    
    // v1.6.4.1 - FIX Bug #1: Await the async persist and log result
    const success = await persistStateToStorage(state, '[VisibilityHandler]');
    if (!success) {
      // v1.6.4.3 - FIX: More descriptive error message about potential causes
      console.error('[VisibilityHandler] Storage persist failed: operation timed out, storage API unavailable, or quota exceeded');
    }
  }
}
