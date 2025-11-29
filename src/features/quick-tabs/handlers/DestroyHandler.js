/**
 * @fileoverview DestroyHandler - Handles Quick Tab destruction and cleanup
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
 * v1.6.4 - FIX Bug #1: Persist to storage after destroy
 * v1.6.4.1 - FIX Bug #1: Proper async handling with validation and timeout
 *
 * Responsibilities:
 * - Handle single Quick Tab destruction
 * - Close Quick Tabs via closeById (calls tab.destroy())
 * - Close all Quick Tabs via closeAll
 * - Cleanup minimized manager references
 * - Reset z-index when all tabs closed
 * - Emit destruction events
 * - Persist state to storage after destruction
 *
 * @version 1.6.4.1
 */

import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

/**
 * DestroyHandler class
 * Manages Quick Tab destruction and cleanup operations (local only, no cross-tab sync)
 * v1.6.4 - Now persists state to storage after destruction
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
  }

  /**
   * Handle Quick Tab destruction
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
   * v1.6.4 - FIX Bug #1: Persist to storage after destroy
   *
   * @param {string} id - Quick Tab ID
   */
  handleDestroy(id) {
    console.log('[DestroyHandler] Handling destroy for:', id);

    // Get tab info BEFORE deleting (needed for state:deleted event)
    const tabWindow = this.quickTabsMap.get(id);

    // Delete from map and minimized manager
    this.quickTabsMap.delete(id);
    this.minimizedManager.remove(id);

    // Emit destruction event (legacy)
    this._emitDestructionEvent(id);

    // v1.6.3.2 - FIX Bug #4: Emit state:deleted for PanelContentManager to update
    this._emitStateDeletedEvent(id, tabWindow);

    // Reset z-index if all tabs are closed
    this._resetZIndexIfEmpty();

    // v1.6.4 - FIX Bug #1: Persist to storage after destroy
    this._persistToStorage();
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
   * Calls destroy() on each tab, clears map, clears minimized manager, resets z-index
   */
  closeAll() {
    console.log('[DestroyHandler] Closing all Quick Tabs');
    const count = this.quickTabsMap.size;

    // Destroy all tabs
    for (const tabWindow of this.quickTabsMap.values()) {
      if (tabWindow.destroy) {
        tabWindow.destroy();
      }
    }

    // Clear everything
    this.quickTabsMap.clear();
    this.minimizedManager.clear();
    this.currentZIndex.value = this.baseZIndex;

    // v1.6.4.3 - FIX Issue #3: Emit state:cleared for UICoordinator to reconcile
    // This removes any orphaned windows that may exist in renderedTabs but not StateManager
    if (this.eventBus) {
      this.eventBus.emit('state:cleared', { count });
      console.log('[DestroyHandler] Emitted state:cleared:', count);
    }

    // v1.6.4 - FIX Bug #1: Persist to storage after close all
    this._persistToStorage();
  }
}
