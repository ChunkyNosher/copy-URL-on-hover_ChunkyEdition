/**
 * @fileoverview DestroyHandler - Handles Quick Tab destruction and cleanup
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
 * v1.6.3.4 - FIX Bug #1: Persist to storage after destroy
 * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.3.4-v5 - FIX Bug #7 & #8: Atomic closure with debounced storage writes
 * v1.6.3.2 - FIX Issue #6: Add batch mode flag to prevent storage write storm during closeAll
 * v1.6.3.4 - FIX Issues #4, #6, #7: Add source tracking, consolidate all destroy logic
 * v1.6.3.5-v6 - FIX Diagnostic Issue #3: Add closeAll mutex to prevent duplicate executions
 *
 * Responsibilities:
 * - Handle single Quick Tab destruction
 * - Close Quick Tabs via closeById (calls tab.destroy())
 * - Close all Quick Tabs via closeAll (with mutex protection)
 * - Cleanup minimized manager references
 * - Reset z-index when all tabs closed
 * - Emit destruction events
 * - Persist state to storage after destruction (debounced to prevent write storms)
 * - Log all destroy operations with source indication
 *
 * @version 1.6.3.5-v6
 */

import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '@utils/dom.js';
import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

// v1.6.3.4-v5 - FIX Bug #8: Debounce delay for storage writes (ms)
const STORAGE_DEBOUNCE_DELAY = 150;

// v1.6.3.5-v6 - FIX Diagnostic Issue #3: Cooldown for closeAll mutex (ms)
const CLOSE_ALL_COOLDOWN_MS = 2000;

/**
 * DestroyHandler class
 * Manages Quick Tab destruction and cleanup operations (local only, no cross-tab sync)
 * v1.6.3.4 - Now persists state to storage after destruction
 * v1.6.3.4-v5 - FIX Bug #7 & #8: Atomic closure with debounced storage writes
 * v1.6.3.2 - FIX Issue #6: Batch mode to prevent storage write storm during closeAll
 * v1.6.3.5-v6 - FIX Diagnostic Issue #3: closeAll mutex to prevent duplicate executions
 */
export class DestroyHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {MinimizedManager} minimizedManager - Manager for minimized Quick Tabs
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Object} currentZIndex - Reference object with value property for z-index
   * @param {Object} Events - Events constants object
   * @param {number} baseZIndex - Base z-index value to reset to
   */
  constructor(
    quickTabsMap,
    minimizedManager,
    eventBus,
    currentZIndex,
    Events,
    baseZIndex
  ) {
    this.quickTabsMap = quickTabsMap;
    this.minimizedManager = minimizedManager;
    this.eventBus = eventBus;
    this.currentZIndex = currentZIndex;
    this.Events = Events;
    this.baseZIndex = baseZIndex;
    
    // v1.6.3.4-v5 - FIX Bug #8: Debounce timer for storage writes
    this._storageDebounceTimer = null;
    
    // v1.6.3.4-v5 - FIX Bug #7: Track destroyed IDs to prevent resurrection
    this._destroyedIds = new Set();
    
    // v1.6.3.4-v10 - FIX Issue #6: Replace boolean _batchMode with Set tracking specific operation IDs
    // The boolean flag was vulnerable to timer interleaving: if a timer from an earlier
    // minimize operation fires during closeAll(), it would incorrectly skip persist because
    // _batchMode was true for the unrelated closeAll() operation.
    // Now each operation checks if its specific ID is in the batch Set.
    this._batchOperationIds = new Set();
    
    // v1.6.3.5-v6 - FIX Diagnostic Issue #3: Mutex flag to prevent closeAll duplicate execution
    this._closeAllInProgress = false;
    this._closeAllCooldownTimer = null;
  }

  /**
   * Handle Quick Tab destruction
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
   * v1.6.3.4 - FIX Bug #1: Persist to storage after destroy
   * v1.6.3.4-v5 - FIX Bug #7: Track destroyed IDs to prevent resurrection
   * v1.6.3.2 - FIX Issue #6: Skip persistence when in batch mode (closeAll)
   * v1.6.3.4 - FIX Issues #4, #6, #7: Add source parameter, enhanced logging
   * v1.6.3.4-v10 - FIX Issue #6: Check batch Set membership instead of boolean flag
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   */
  handleDestroy(id, source = 'unknown') {
    // v1.6.3.4 - FIX Issue #6: Log with source indication
    console.log(`[DestroyHandler] Handling destroy for: ${id} (source: ${source})`);

    // v1.6.3.4-v5 - FIX Bug #7: Mark as destroyed FIRST to prevent resurrection
    this._destroyedIds.add(id);

    // Get tab info BEFORE deleting (needed for state:deleted event)
    const tabWindow = this.quickTabsMap.get(id);
    
    // v1.6.3.4 - FIX Issue #5: Log if tab not found in Map
    if (!tabWindow) {
      console.warn(`[DestroyHandler] Tab not found in Map (source: ${source}):`, id);
    }

    // v1.6.3.4-v5 - FIX Bug #7: Atomic cleanup - delete from ALL references
    // v1.6.3.4 - FIX Issue #5: Log Map deletion
    const wasInMap = this.quickTabsMap.delete(id);
    console.log(`[DestroyHandler] Map.delete result (source: ${source}):`, { id, wasInMap });
    
    this.minimizedManager.remove(id);
    
    // v1.6.3.4-v5 - FIX Bug #7: Use shared utility for DOM cleanup
    if (removeQuickTabElement(id)) {
      console.log(`[DestroyHandler] Removed DOM element (source: ${source}):`, id);
    }

    // Emit destruction event (legacy)
    this._emitDestructionEvent(id);

    // v1.6.3.2 - FIX Bug #4: Emit state:deleted for PanelContentManager to update
    this._emitStateDeletedEvent(id, tabWindow, source);

    // Reset z-index if all tabs are closed
    this._resetZIndexIfEmpty();

    // v1.6.3.4-v10 - FIX Issue #6: Check if this specific ID is in batch mode (Set membership)
    // This replaces the boolean _batchMode flag which was vulnerable to timer interleaving.
    // Only skip persist if THIS specific ID was added to the batch Set by closeAll().
    if (this._batchOperationIds.has(id)) {
      console.log(`[DestroyHandler] Batch mode - skipping individual persist (source: ${source}):`, {
        id,
        batchSetSize: this._batchOperationIds.size
      });
      return;
    }

    // v1.6.3.4-v5 - FIX Bug #8: Debounced persist to prevent write storms
    this._debouncedPersistToStorage();
    
    console.log(`[DestroyHandler] Destroy complete (source: ${source}):`, id);
  }

  /**
   * Check if a Quick Tab ID was recently destroyed
   * v1.6.3.4-v5 - FIX Bug #7: Used to prevent resurrection during DOM scans
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if recently destroyed
   */
  wasRecentlyDestroyed(id) {
    return this._destroyedIds.has(id);
  }

  /**
   * Clear destroyed IDs tracking (call periodically to prevent memory leak)
   * v1.6.3.4-v5 - FIX Bug #7: Cleanup destroyed IDs set
   */
  clearDestroyedTracking() {
    this._destroyedIds.clear();
  }

  /**
   * Emit destruction event (legacy)
   * @private
   * @param {string} id - Quick Tab ID
   */
  _emitDestructionEvent(id) {
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_CLOSED, { id });
    }
  }

  /**
   * Emit state:deleted event for panel sync
   * v1.6.3.2 - FIX Bug #4: Panel listens for this event to update its display
   * v1.6.3.4 - FIX Issue #6: Add source to event data
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance (may be undefined)
   * @param {string} source - Source of action ('UI', 'Manager', etc.)
   */
  _emitStateDeletedEvent(id, tabWindow, source = 'unknown') {
    if (!this.eventBus) return;

    // Build quickTabData - only include url/title if tabWindow exists
    const quickTabData = tabWindow
      ? { id, url: tabWindow.url, title: tabWindow.title, source }
      : { id, source };

    this.eventBus.emit('state:deleted', { id, quickTab: quickTabData, source });
    console.log(`[DestroyHandler] Emitted state:deleted (source: ${source}):`, id);
  }

  /**
   * Reset z-index if all tabs are closed
   * @private
   */
  _resetZIndexIfEmpty() {
    if (this.quickTabsMap.size === 0) {
      this.currentZIndex.value = this.baseZIndex;
      console.log('[DestroyHandler] All tabs closed, reset z-index');
    }
  }

  /**
   * Debounced persist to storage
   * v1.6.3.4-v5 - FIX Bug #8: Prevents storage write storms (8 writes in 38ms)
   * @private
   */
  _debouncedPersistToStorage() {
    // Clear existing timer
    if (this._storageDebounceTimer) {
      clearTimeout(this._storageDebounceTimer);
    }
    
    // Set new debounced timer
    this._storageDebounceTimer = setTimeout(() => {
      this._storageDebounceTimer = null;
      this._persistToStorage();
    }, STORAGE_DEBOUNCE_DELAY);
  }

  /**
   * Persist current state to browser.storage.local
   * v1.6.3.4 - FIX Bug #1: Persist to storage after destroy
   * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   * @returns {Promise<void>}
   */
  async _persistToStorage() {
    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);
    
    // v1.6.3.4-v2 - FIX Bug #1: Handle null state from validation failure
    if (!state) {
      console.error('[DestroyHandler] Failed to build state for storage');
      return;
    }
    
    console.debug('[DestroyHandler] Persisting state with', state.tabs?.length || 0, 'tabs');
    const success = await persistStateToStorage(state, '[DestroyHandler]');
    if (!success) {
      console.error('[DestroyHandler] Storage persist failed or timed out');
    }
  }

  /**
   * Close Quick Tab by ID (calls tab.destroy() method)
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', etc.)
   */
  closeById(id, source = 'Manager') {
    console.log(`[DestroyHandler] closeById called (source: ${source}):`, id);
    const tabWindow = this.quickTabsMap.get(id);
    if (tabWindow && tabWindow.destroy) {
      tabWindow.destroy();
    } else {
      // v1.6.3.4 - FIX Issue #5: Tab not found, but still clean up Map/storage
      console.warn(`[DestroyHandler] Tab not found for closeById (source: ${source}):`, id);
      // Still call handleDestroy to clean up any orphaned state
      this.handleDestroy(id, source);
    }
  }

  /**
   * Schedule mutex release after cooldown
   * v1.6.3.5-v6 - Extracted to improve readability (per code review)
   * @private
   */
  _scheduleMutexRelease() {
    if (this._closeAllCooldownTimer) {
      clearTimeout(this._closeAllCooldownTimer);
    }
    this._closeAllCooldownTimer = setTimeout(() => {
      this._closeAllInProgress = false;
      this._closeAllCooldownTimer = null;
      console.log(`[DestroyHandler] closeAll mutex released after ${CLOSE_ALL_COOLDOWN_MS}ms cooldown`);
    }, CLOSE_ALL_COOLDOWN_MS);
  }

  /**
   * Close all Quick Tabs
   * v1.6.3.4 - FIX Bug #1: Persist to storage after close all
   * v1.6.3.4-v4 - FIX Issue #3: Emit state:cleared event for UICoordinator reconciliation
   * v1.6.3.4-v5 - FIX Bug #7: Track all destroyed IDs atomically, use shared cleanup utility
   * v1.6.3.2 - FIX Issue #6: Use batch mode to prevent storage write storm (6+ writes in 24ms)
   * v1.6.3.4 - FIX Issue #7: Enhanced logging throughout closeAll
   * v1.6.3.4-v10 - FIX Issue #6: Use Set of operation IDs instead of boolean flag
   *   The boolean was vulnerable to timer interleaving from earlier operations.
   *   Now each ID is tracked individually in _batchOperationIds Set.
   * v1.6.3.5-v6 - FIX Diagnostic Issue #3: Add mutex to prevent duplicate executions
   *   Problem: closeAll() was executing 2-3 times per button click
   *   Fix: Add _closeAllInProgress flag with 2000ms cooldown
   * Calls destroy() on each tab, clears map, clears minimized manager, resets z-index
   * 
   * @param {string} source - Source of action ('UI', 'Manager', etc.)
   */
  closeAll(source = 'Manager') {
    // v1.6.3.5-v6 - FIX Diagnostic Issue #3: Check mutex to prevent duplicate execution
    if (this._closeAllInProgress) {
      console.warn(`[DestroyHandler] closeAll BLOCKED (mutex held, source: ${source})`);
      return;
    }
    
    // v1.6.3.5-v6 - Acquire mutex
    this._closeAllInProgress = true;
    console.log(`[DestroyHandler] Closing all Quick Tabs (source: ${source}) - mutex acquired`);
    
    // v1.6.3.5-v6 - Schedule mutex release with cooldown (extracted per code review)
    this._scheduleMutexRelease();
    
    const count = this.quickTabsMap.size;

    // v1.6.3.4-v10 - FIX Issue #6: Add all IDs to batch Set BEFORE destroy loop
    // This ensures handleDestroy() checks for membership correctly
    for (const id of this.quickTabsMap.keys()) {
      this._batchOperationIds.add(id);
    }
    console.log(`[DestroyHandler] Added ${count} IDs to batch Set (source: ${source}):`, {
      batchSetSize: this._batchOperationIds.size,
      ids: Array.from(this._batchOperationIds)
    });

    // v1.6.3.4-v5 - FIX Bug #7: Track all IDs being destroyed
    for (const id of this.quickTabsMap.keys()) {
      this._destroyedIds.add(id);
      console.log(`[DestroyHandler] Marked for destruction (source: ${source}):`, id);
    }

    // Destroy all tabs - each destroy() call will skip storage persist due to batch Set
    for (const tabWindow of this.quickTabsMap.values()) {
      if (tabWindow.destroy) {
        tabWindow.destroy();
      }
    }

    // Clear everything
    this.quickTabsMap.clear();
    console.log(`[DestroyHandler] Map cleared (source: ${source})`);
    
    this.minimizedManager.clear();
    console.log(`[DestroyHandler] MinimizedManager cleared (source: ${source})`);
    
    this.currentZIndex.value = this.baseZIndex;

    // v1.6.3.4-v5 - FIX Bug #7: Use shared utility to clean up ALL .quick-tab-window elements
    const removedCount = cleanupOrphanedQuickTabElements(null);
    if (removedCount > 0) {
      console.log(`[DestroyHandler] Removed ${removedCount} DOM element(s) (source: ${source})`);
    }

    // v1.6.3.4-v4 - FIX Issue #3: Emit state:cleared for UICoordinator to reconcile
    // This removes any orphaned windows that may exist in renderedTabs but not StateManager
    if (this.eventBus) {
      this.eventBus.emit('state:cleared', { count, source });
      console.log(`[DestroyHandler] Emitted state:cleared (source: ${source}):`, count);
    }

    // v1.6.3.4-v10 - FIX Issue #6: Clear batch Set after all cleanup is complete
    this._batchOperationIds.clear();
    console.log(`[DestroyHandler] Cleared batch Set after closeAll (source: ${source})`);

    // v1.6.3.2 - FIX Issue #6: Single atomic storage write after all cleanup
    // This replaces 6+ individual writes with 1 write
    console.log(`[DestroyHandler] closeAll complete (source: ${source}) - performing single atomic storage write`);
    this._persistToStorage();
  }
}
