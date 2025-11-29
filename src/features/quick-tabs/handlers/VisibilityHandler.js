/**
 * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.4 - FIX Bug #2: Persist to storage after minimize/restore
 * v1.6.4.1 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.4.5 - FIX Issues #1, #2, #6: Debounce minimize/restore, prevent event storms
 * v1.6.3.2 - FIX Issue #2: Add mutex/lock pattern to prevent duplicate operations
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
 * @version 1.6.3.2
 */

import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

// v1.6.4.5 - FIX Issue #1: Debounce delay for minimize/restore operations
const MINIMIZE_DEBOUNCE_MS = 150;

// v1.6.3.2 - FIX Issue #2: Lock duration to prevent duplicate operations from multiple sources
const OPERATION_LOCK_MS = 200;

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
   *
   * @param {string} id - Quick Tab ID
   */
  handleMinimize(id) {
    // v1.6.3.2 - FIX Issue #2: Use mutex to prevent multiple sources triggering same operation
    if (!this._tryAcquireLock('minimize', id)) {
      console.log('[VisibilityHandler] Ignoring duplicate minimize request (lock held) for:', id);
      return;
    }

    // v1.6.4.5 - FIX Issue #1: Prevent duplicate minimize operations
    if (this._pendingMinimize.has(id)) {
      console.log('[VisibilityHandler] Ignoring duplicate minimize request (pending) for:', id);
      this._releaseLock('minimize', id);
      return;
    }
    
    // v1.6.4 - FIX Issue #1: Log at start to confirm button was clicked
    console.log('[VisibilityHandler] Minimize button clicked for Quick Tab:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      console.warn('[VisibilityHandler] Tab not found for minimize:', id);
      this._releaseLock('minimize', id);
      return;
    }
    
    // v1.6.4.5 - FIX Issue #1: Mark as pending to prevent duplicate clicks
    this._pendingMinimize.add(id);

    // Add to minimized manager BEFORE calling minimize (to capture correct position/size)
    this.minimizedManager.add(id, tabWindow);

    // v1.6.4.4 - FIX Bug #6: Actually minimize the window (hide it)
    // The Manager sidebar was calling handleMinimize but the window wasn't being hidden
    // because we weren't calling tabWindow.minimize()
    if (tabWindow.minimize) {
      tabWindow.minimize();
      console.log('[VisibilityHandler] Called tabWindow.minimize() for:', id);
    }

    // Emit minimize event for legacy handlers
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id });
    }

    // v1.6.3.1 - FIX Bug #7: Emit state:updated for panel to refresh
    // This allows PanelContentManager to update when Quick Tab is minimized from its window
    if (this.eventBus) {
      const quickTabData = this._createQuickTabData(id, tabWindow, true);
      this.eventBus.emit('state:updated', { quickTab: quickTabData });
      console.log('[VisibilityHandler] Emitted state:updated for minimize:', id);
    }

    // v1.6.4.5 - FIX Issue #6: Persist to storage with debounce
    this._debouncedPersist(id, 'minimize');
  }

  /**
   * Check if restore operation can proceed
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if operation can proceed
   */
  _canProceedWithRestore(id) {
    // Check mutex lock
    if (!this._tryAcquireLock('restore', id)) {
      console.log('[VisibilityHandler] Ignoring duplicate restore request (lock held) for:', id);
      return false;
    }

    // Check pending flag
    if (this._pendingRestore.has(id)) {
      console.log('[VisibilityHandler] Ignoring duplicate restore request (pending) for:', id);
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
   * Handle restore of minimized Quick Tab
   * v1.6.3 - Local only (no cross-tab sync)
   * v1.6.3.1 - FIX Bug #7: Emit state:updated for panel sync
   * v1.6.4 - FIX Bug #2: Persist to storage after restore
   * v1.6.4.5 - FIX Issues #1, #2: Debounce to prevent event storms
   * v1.6.3.2 - FIX Issue #2: Use mutex/lock pattern for true duplicate prevention
   * @param {string} id - Quick Tab ID
   */
  handleRestore(id) {
    // v1.6.3.2 - Check preconditions for restore
    if (!this._canProceedWithRestore(id)) {
      return;
    }
    
    console.log('[VisibilityHandler] Handling restore for:', id);

    // Get tab info BEFORE restoring (needed for state:updated event)
    const tabWindow = this.quickTabsMap.get(id);
    
    // v1.6.4.5 - FIX Issue #2: Mark as pending to prevent duplicate operations
    this._pendingRestore.add(id);

    // Restore from minimized manager - returns snapshot with position/size
    // v1.6.3.2 - Note: minimizedManager.restore() now only applies snapshot, does NOT call tabWindow.restore()
    const restored = this.minimizedManager.restore(id);
    if (!restored) {
      console.warn('[VisibilityHandler] Tab not found in minimized manager:', id);
      this._cleanupFailedRestore(id);
      return;
    }

    // v1.6.3.2 - Now call tabWindow.restore() which updates state but does NOT render
    // UICoordinator will handle rendering via the state:updated event below
    if (tabWindow?.restore) {
      tabWindow.restore();
      console.log('[VisibilityHandler] Called tabWindow.restore() for:', id);
    }

    // Emit restore event for legacy handlers
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_RESTORED, { id });
    }

    // v1.6.3.1 - FIX Bug #7: Emit state:updated for panel to refresh
    this._emitRestoreStateUpdate(id, tabWindow);

    // v1.6.4.5 - FIX Issue #6: Persist to storage with debounce
    this._debouncedPersist(id, 'restore');
  }

  /**
   * Emit state:updated event for restore
   * v1.6.3.2 - Helper to reduce handleRestore complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance
   */
  _emitRestoreStateUpdate(id, tabWindow) {
    if (this.eventBus && tabWindow) {
      const quickTabData = this._createQuickTabData(id, tabWindow, false);
      this.eventBus.emit('state:updated', { quickTab: quickTabData });
      console.log('[VisibilityHandler] Emitted state:updated for restore:', id);
    }
  }

  /**
   * Restore Quick Tab from minimized state (alias for handleRestore)
   * @param {string} id - Quick Tab ID
   */
  restoreQuickTab(id) {
    return this.handleRestore(id);
  }

  /**
   * Restore Quick Tab by ID (backward compat alias)
   * @param {string} id - Quick Tab ID
   */
  restoreById(id) {
    return this.handleRestore(id);
  }

  /**
   * Handle Quick Tab focus (bring to front)
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} id - Quick Tab ID
   */
  handleFocus(id) {
    console.log('[VisibilityHandler] Bringing to front:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Increment z-index and update tab UI
    this.currentZIndex.value++;
    const newZIndex = this.currentZIndex.value;
    tabWindow.updateZIndex(newZIndex);

    // Emit focus event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, { id });
    }
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
   * @private
   * @param {string} id - Quick Tab ID that triggered the persist
   * @param {string} operation - 'minimize' or 'restore'
   */
  _debouncedPersist(id, operation) {
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
      
      console.log(`[VisibilityHandler] Completed ${operation} for ${id} with storage persist`);
    }, MINIMIZE_DEBOUNCE_MS);
    
    this._debounceTimers.set(id, timer);
  }

  /**
   * Persist current state to browser.storage.local
   * v1.6.4 - FIX Bug #2: Persist to storage after minimize/restore
   * v1.6.4.1 - FIX Bug #1: Proper async handling with validation
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
    
    // v1.6.4.1 - FIX Bug #1: Log tab count and minimized states
    const minimizedCount = state.tabs.filter(t => t.minimized).length;
    console.log(`[VisibilityHandler] Persisting ${state.tabs.length} tabs (${minimizedCount} minimized)`);
    
    // v1.6.4.1 - FIX Bug #1: Await the async persist and log result
    const success = await persistStateToStorage(state, '[VisibilityHandler]');
    if (!success) {
      // v1.6.4.3 - FIX: More descriptive error message about potential causes
      console.error('[VisibilityHandler] Storage persist failed: operation timed out, storage API unavailable, or quota exceeded');
    }
  }
}
