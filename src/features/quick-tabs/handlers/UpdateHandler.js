/**
 * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 *
 * Responsibilities:
 * - Handle position updates during drag (no broadcast/save)
 * - Handle position updates at drag end (broadcast + save)
 * - Handle size updates during resize (no broadcast/save)
 * - Handle size updates at resize end (broadcast + save)
 * - Emit update events for coordinators
 *
 * @version 1.6.0
 * @author refactor-specialist
 */

/**
 * UpdateHandler class
 * Manages Quick Tab position and size updates with throttling and broadcast coordination
 */
export class UpdateHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {BroadcastManager} broadcastManager - Broadcast manager for cross-tab sync
   * @param {StorageManager} storageManager - Storage manager (currently unused, kept for future use)
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
   * @param {Function} releasePendingSave - Function to release pending saveId
   */
  constructor(
    quickTabsMap,
    broadcastManager,
    storageManager,
    eventBus,
    generateSaveId,
    releasePendingSave
  ) {
    this.quickTabsMap = quickTabsMap;
    this.broadcastManager = broadcastManager;
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
   * v1.5.8.15 - No longer broadcasts or syncs during drag
   * This prevents excessive BroadcastChannel messages and storage writes
   * Position syncs only on drag end via handlePositionChangeEnd
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - New left position
   * @param {number} top - New top position
   */
  handlePositionChange(_id, _left, _top) {
    // v1.5.8.15 - No longer broadcasts or syncs during drag
    // This prevents excessive BroadcastChannel messages and storage writes
    // Position syncs only on drag end via handlePositionChangeEnd
    // Local UI update happens automatically via pointer events
  }

  /**
   * Handle position change end (drag end) - broadcast and save
   * v1.5.8.13 - Enhanced with BroadcastChannel sync
   * v1.5.8.14 - Added transaction ID for race condition prevention
   * v1.5.9.12 - Container integration: Include container context
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

    // v1.5.8.13 - Final position broadcast
    this.broadcastManager.notifyPositionUpdate(id, roundedLeft, roundedTop);

    // v1.5.8.14 - Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // v1.5.9.12 - Get cookieStoreId from tab
    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

    // Send final position to background
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
          id: id,
          left: roundedLeft,
          top: roundedTop,
          cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
          saveId: saveId, // v1.5.8.14 - Include save ID
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[UpdateHandler] Final position save error:', err);
        this.releasePendingSave(saveId);
      }
    } else {
      this.releasePendingSave(saveId);
    }

    // Emit event for coordinators
    this.eventBus?.emit('tab:position-updated', {
      id,
      left: roundedLeft,
      top: roundedTop
    });
  }

  /**
   * Handle size change during resize
   * v1.5.8.15 - REMOVED broadcast/sync during resize to prevent performance issues
   * Size only syncs on resize end for optimal performance
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - New width
   * @param {number} height - New height
   */
  handleSizeChange(_id, _width, _height) {
    // v1.5.8.15 - No longer broadcasts or syncs during resize
    // This prevents excessive BroadcastChannel messages and storage writes
    // Size syncs only on resize end via handleSizeChangeEnd
    // Local UI update happens automatically via pointer events
  }

  /**
   * Handle size change end (resize end) - broadcast and save
   * v1.5.8.13 - Enhanced with BroadcastChannel sync
   * v1.5.8.14 - Added transaction ID for race condition prevention
   * v1.5.9.12 - Container integration: Include container context
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

    // v1.5.8.13 - Final size broadcast
    this.broadcastManager.notifySizeUpdate(id, roundedWidth, roundedHeight);

    // v1.5.8.14 - Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // v1.5.9.12 - Get cookieStoreId from tab
    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

    // Send final size to background
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
          id: id,
          width: roundedWidth,
          height: roundedHeight,
          cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
          saveId: saveId, // v1.5.8.14 - Include save ID
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[UpdateHandler] Final size save error:', err);
        this.releasePendingSave(saveId);
      }
    } else {
      this.releasePendingSave(saveId);
    }

    // Emit event for coordinators
    this.eventBus?.emit('tab:size-updated', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });
  }
}
