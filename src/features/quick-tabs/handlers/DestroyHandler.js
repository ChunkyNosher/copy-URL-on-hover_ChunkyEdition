/**
 * @fileoverview DestroyHandler - Handles Quick Tab destruction and cleanup
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.2 - MIGRATION: Removed BroadcastManager, uses storage.onChanged for cross-tab sync
 *
 * Responsibilities:
 * - Handle single Quick Tab destruction
 * - Close Quick Tabs via closeById (calls tab.destroy())
 * - Close all Quick Tabs via closeAll
 * - Cleanup minimized manager references
 * - Reset z-index when all tabs closed
 * - Emit destruction events
 *
 * Migration Notes (v1.6.2):
 * - Removed BroadcastManager dependency
 * - Writing to storage via background triggers storage.onChanged in other tabs
 * - Local UI updates happen immediately (no storage event for self)
 *
 * @version 1.6.2
 * @author refactor-specialist
 */

/**
 * DestroyHandler class
 * Manages Quick Tab destruction and cleanup operations with storage-based cross-tab sync
 */
export class DestroyHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {MinimizedManager} minimizedManager - Manager for minimized Quick Tabs
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Object} currentZIndex - Reference object with value property for z-index
   * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
   * @param {Function} releasePendingSave - Function to release pending saveId
   * @param {Object} Events - Events constants object
   * @param {number} baseZIndex - Base z-index value to reset to
   */
  constructor(
    quickTabsMap,
    minimizedManager,
    eventBus,
    currentZIndex,
    generateSaveId,
    releasePendingSave,
    Events,
    baseZIndex
  ) {
    this.quickTabsMap = quickTabsMap;
    this.minimizedManager = minimizedManager;
    this.eventBus = eventBus;
    this.currentZIndex = currentZIndex;
    this.generateSaveId = generateSaveId;
    this.releasePendingSave = releasePendingSave;
    this.Events = Events;
    this.baseZIndex = baseZIndex;
  }

  /**
   * Handle Quick Tab destruction
   * v1.6.2 - MIGRATION: Uses storage for cross-tab sync (removed BroadcastManager)
   *
   * @param {string} id - Quick Tab ID
   * @returns {Promise<void>}
   */
  async handleDestroy(id) {
    console.log('[DestroyHandler] Handling destroy for:', id);

    // Get tab info and cleanup
    const tabInfo = this._getTabInfoAndCleanup(id);

    // Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // v1.6.2 - Save to storage (triggers storage.onChanged in other tabs)
    await this._sendCloseToBackground(id, tabInfo, saveId);

    // Emit destruction event
    this._emitDestructionEvent(id);

    // Reset z-index if all tabs are closed
    this._resetZIndexIfEmpty();
  }

  /**
   * Get tab info and perform cleanup
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {Object} Tab info with url and cookieStoreId
   */
  _getTabInfoAndCleanup(id) {
    const tabWindow = this.quickTabsMap.get(id);
    const url = tabWindow && tabWindow.url ? tabWindow.url : null;
    const cookieStoreId = tabWindow
      ? tabWindow.cookieStoreId || 'firefox-default'
      : 'firefox-default';

    // Delete from map and minimized manager
    this.quickTabsMap.delete(id);
    this.minimizedManager.remove(id);

    return { url, cookieStoreId };
  }

  /**
   * Send close message to background
   * v1.6.2 - Triggers storage.onChanged in other tabs
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabInfo - Tab info with url and cookieStoreId
   * @param {string} saveId - Save ID for transaction tracking
   * @returns {Promise<void>}
   */
  async _sendCloseToBackground(id, tabInfo, saveId) {
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'CLOSE_QUICK_TAB',
          id: id,
          url: tabInfo.url,
          cookieStoreId: tabInfo.cookieStoreId,
          saveId: saveId
        });
      } catch (err) {
        console.error('[DestroyHandler] Error closing Quick Tab in background:', err);
        this.releasePendingSave(saveId);
      }
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * Emit destruction event
   * @private
   * @param {string} id - Quick Tab ID
   */
  _emitDestructionEvent(id) {
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_CLOSED, { id });
    }
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
   * Calls destroy() on each tab, clears map, clears minimized manager, resets z-index
   */
  closeAll() {
    console.log('[DestroyHandler] Closing all Quick Tabs');

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
  }
}
