/**
 * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.2 - MIGRATION: Removed BroadcastManager, uses storage.onChanged for cross-tab sync
 *
 * Responsibilities:
 * - Handle position updates during drag (no save)
 * - Handle position updates at drag end (save to storage)
 * - Handle size updates during resize (no save)
 * - Handle size updates at resize end (save to storage)
 * - Emit update events for coordinators
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
 * UpdateHandler class
 * Manages Quick Tab position and size updates with storage-based cross-tab sync
 */
export class UpdateHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {StorageManager} storageManager - Storage manager for persistence
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
   * @param {Function} releasePendingSave - Function to release pending saveId
   */
  constructor(
    quickTabsMap,
    storageManager,
    eventBus,
    generateSaveId,
    releasePendingSave
  ) {
    this.quickTabsMap = quickTabsMap;
    this.storageManager = storageManager;
    this.eventBus = eventBus;
    this.generateSaveId = generateSaveId;
    this.releasePendingSave = releasePendingSave;

    // Throttle tracking (for future use if needed)
    this.positionChangeThrottle = new Map();
    this.sizeChangeThrottle = new Map();
  }

  /**
   * Handle position change during drag
   * v1.5.8.15 - No longer saves during drag
   * This prevents excessive storage writes
   * Position syncs only on drag end via handlePositionChangeEnd
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - New left position
   * @param {number} top - New top position
   */
  handlePositionChange(_id, _left, _top) {
    // v1.5.8.15 - No storage writes during drag
    // This prevents excessive storage writes
    // Position syncs only on drag end via handlePositionChangeEnd
    // Local UI update happens automatically via pointer events
  }

  /**
   * Handle position change end (drag end) - save to storage
   * v1.6.2 - MIGRATION: Writes to storage (triggers storage.onChanged in other tabs)
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - Final left position
   * @param {number} top - Final top position
   * @returns {Promise<void>}
   */
  async handlePositionChangeEnd(id, left, top) {
    // Clear throttle (if exists)
    if (this.positionChangeThrottle.has(id)) {
      this.positionChangeThrottle.delete(id);
    }

    // Round values
    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);

    // Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // Get cookieStoreId from tab
    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

    // v1.6.2 - Save to storage (triggers storage.onChanged in other tabs)
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
          id: id,
          left: roundedLeft,
          top: roundedTop,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[UpdateHandler] Final position save error:', err);
        this.releasePendingSave(saveId);
        return;
      }
    }

    this.releasePendingSave(saveId);

    // Emit event for coordinators
    this.eventBus?.emit('tab:position-updated', {
      id,
      left: roundedLeft,
      top: roundedTop
    });
  }

  /**
   * Handle size change during resize
   * v1.5.8.15 - REMOVED save during resize to prevent performance issues
   * Size only syncs on resize end for optimal performance
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - New width
   * @param {number} height - New height
   */
  handleSizeChange(_id, _width, _height) {
    // v1.5.8.15 - No storage writes during resize
    // This prevents excessive storage writes
    // Size syncs only on resize end via handleSizeChangeEnd
    // Local UI update happens automatically via pointer events
  }

  /**
   * Handle size change end (resize end) - save to storage
   * v1.6.2 - MIGRATION: Writes to storage (triggers storage.onChanged in other tabs)
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - Final width
   * @param {number} height - Final height
   * @returns {Promise<void>}
   */
  async handleSizeChangeEnd(id, width, height) {
    // Clear throttle (if exists)
    if (this.sizeChangeThrottle.has(id)) {
      this.sizeChangeThrottle.delete(id);
    }

    // Round values
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    // Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // Get cookieStoreId from tab
    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

    // v1.6.2 - Save to storage (triggers storage.onChanged in other tabs)
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
          id: id,
          width: roundedWidth,
          height: roundedHeight,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[UpdateHandler] Final size save error:', err);
        this.releasePendingSave(saveId);
        return;
      }
    }

    this.releasePendingSave(saveId);

    // Emit event for coordinators
    this.eventBus?.emit('tab:size-updated', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });
  }
}
