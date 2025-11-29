/**
 * @fileoverview DestroyHandler - Handles Quick Tab destruction and cleanup
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
 * v1.6.4 - FIX Bug #1: Persist to storage after destroy
 * v1.6.4.1 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.4.4 - FIX Bug #7 & #8: Atomic closure with debounced storage writes
 * v1.6.3.2 - FIX Issue #6: Add batch mode flag to prevent storage write storm during closeAll
 *
 * Responsibilities:
 * - Handle single Quick Tab destruction
 * - Close Quick Tabs via closeById (calls tab.destroy())
 * - Close all Quick Tabs via closeAll
 * - Cleanup minimized manager references
 * - Reset z-index when all tabs closed
 * - Emit destruction events
 * - Persist state to storage after destruction (debounced to prevent write storms)
 *
 * @version 1.6.3.2
 */

import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '@utils/dom.js';
import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

// v1.6.4.4 - FIX Bug #8: Debounce delay for storage writes (ms)
const STORAGE_DEBOUNCE_DELAY = 150;

/**
 * DestroyHandler class
 * Manages Quick Tab destruction and cleanup operations (local only, no cross-tab sync)
 * v1.6.4 - Now persists state to storage after destruction
 * v1.6.4.4 - FIX Bug #7 & #8: Atomic closure with debounced storage writes
 * v1.6.3.2 - FIX Issue #6: Batch mode to prevent storage write storm during closeAll
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
    
    // v1.6.4.4 - FIX Bug #8: Debounce timer for storage writes
    this._storageDebounceTimer = null;
    
    // v1.6.4.4 - FIX Bug #7: Track destroyed IDs to prevent resurrection
    this._destroyedIds = new Set();
    
    // v1.6.3.2 - FIX Issue #6: Batch mode flag to skip individual persists during closeAll
    this._batchMode = false;
  }

  /**
   * Handle Quick Tab destruction
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
   * v1.6.4 - FIX Bug #1: Persist to storage after destroy
   * v1.6.4.4 - FIX Bug #7: Track destroyed IDs to prevent resurrection
   * v1.6.3.2 - FIX Issue #6: Skip persistence when in batch mode (closeAll)
   *
   * @param {string} id - Quick Tab ID
   */
  handleDestroy(id) {
    console.log('[DestroyHandler] Handling destroy for:', id);

    // v1.6.4.4 - FIX Bug #7: Mark as destroyed FIRST to prevent resurrection
    this._destroyedIds.add(id);

    // Get tab info BEFORE deleting (needed for state:deleted event)
    const tabWindow = this.quickTabsMap.get(id);

    // v1.6.4.4 - FIX Bug #7: Atomic cleanup - delete from ALL references
    this.quickTabsMap.delete(id);
    this.minimizedManager.remove(id);
    
    // v1.6.4.4 - FIX Bug #7: Use shared utility for DOM cleanup
    if (removeQuickTabElement(id)) {
      console.log('[DestroyHandler] Removed DOM element for:', id);
    }

    // Emit destruction event (legacy)
    this._emitDestructionEvent(id);

    // v1.6.3.2 - FIX Bug #4: Emit state:deleted for PanelContentManager to update
    this._emitStateDeletedEvent(id, tabWindow);

    // Reset z-index if all tabs are closed
    this._resetZIndexIfEmpty();

    // v1.6.3.2 - FIX Issue #6: Skip persistence when in batch mode (closeAll)
    // closeAll() will do a single persist after all tabs are destroyed
    if (this._batchMode) {
      console.log('[DestroyHandler] Batch mode - skipping individual persist for:', id);
      return;
    }

    // v1.6.4.4 - FIX Bug #8: Debounced persist to prevent write storms
    this._debouncedPersistToStorage();
  }

  /**
   * Check if a Quick Tab ID was recently destroyed
   * v1.6.4.4 - FIX Bug #7: Used to prevent resurrection during DOM scans
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if recently destroyed
   */
  wasRecentlyDestroyed(id) {
    return this._destroyedIds.has(id);
  }

  /**
   * Clear destroyed IDs tracking (call periodically to prevent memory leak)
   * v1.6.4.4 - FIX Bug #7: Cleanup destroyed IDs set
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
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance (may be undefined)
   */
  _emitStateDeletedEvent(id, tabWindow) {
    if (!this.eventBus) return;

    // Build quickTabData - only include url/title if tabWindow exists
    const quickTabData = tabWindow
      ? { id, url: tabWindow.url, title: tabWindow.title }
      : { id };

    this.eventBus.emit('state:deleted', { id, quickTab: quickTabData });
    console.log('[DestroyHandler] Emitted state:deleted for:', id);
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
   * v1.6.4.4 - FIX Bug #8: Prevents storage write storms (8 writes in 38ms)
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
   * v1.6.4 - FIX Bug #1: Persist to storage after destroy
   * v1.6.4.1 - FIX Bug #1: Proper async handling with validation
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   * @returns {Promise<void>}
   */
  async _persistToStorage() {
    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);
    
    // v1.6.4.1 - FIX Bug #1: Handle null state from validation failure
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
   *
   * @param {string} id - Quick Tab ID
   */
  closeById(id) {
    const tabWindow = this.quickTabsMap.get(id);
    if (tabWindow && tabWindow.destroy) {
      tabWindow.destroy();
    }
  }

  /**
   * Close all Quick Tabs
   * v1.6.4 - FIX Bug #1: Persist to storage after close all
   * v1.6.4.3 - FIX Issue #3: Emit state:cleared event for UICoordinator reconciliation
   * v1.6.4.4 - FIX Bug #7: Track all destroyed IDs atomically, use shared cleanup utility
   * v1.6.3.2 - FIX Issue #6: Use batch mode to prevent storage write storm (6+ writes in 24ms)
   * Calls destroy() on each tab, clears map, clears minimized manager, resets z-index
   */
  closeAll() {
    console.log('[DestroyHandler] Closing all Quick Tabs');
    const count = this.quickTabsMap.size;

    // v1.6.3.2 - FIX Issue #6: Enable batch mode to skip individual persist calls
    this._batchMode = true;

    // v1.6.4.4 - FIX Bug #7: Track all IDs being destroyed
    for (const id of this.quickTabsMap.keys()) {
      this._destroyedIds.add(id);
    }

    // Destroy all tabs - each destroy() call will skip storage persist due to batch mode
    for (const tabWindow of this.quickTabsMap.values()) {
      if (tabWindow.destroy) {
        tabWindow.destroy();
      }
    }

    // Clear everything
    this.quickTabsMap.clear();
    this.minimizedManager.clear();
    this.currentZIndex.value = this.baseZIndex;

    // v1.6.4.4 - FIX Bug #7: Use shared utility to clean up ALL .quick-tab-window elements
    const removedCount = cleanupOrphanedQuickTabElements(null);
    if (removedCount > 0) {
      console.log(`[DestroyHandler] Removed ${removedCount} DOM element(s)`);
    }

    // v1.6.4.3 - FIX Issue #3: Emit state:cleared for UICoordinator to reconcile
    // This removes any orphaned windows that may exist in renderedTabs but not StateManager
    if (this.eventBus) {
      this.eventBus.emit('state:cleared', { count });
      console.log('[DestroyHandler] Emitted state:cleared:', count);
    }

    // v1.6.3.2 - FIX Issue #6: Disable batch mode before single atomic persist
    this._batchMode = false;

    // v1.6.3.2 - FIX Issue #6: Single atomic storage write after all cleanup
    // This replaces 6+ individual writes with 1 write
    console.log('[DestroyHandler] closeAll complete - performing single atomic storage write');
    this._persistToStorage();
  }
}
