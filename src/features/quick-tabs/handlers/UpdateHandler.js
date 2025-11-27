/**
 * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 *
 * Responsibilities:
 * - Handle position updates during drag
 * - Handle position updates at drag end
 * - Handle size updates during resize
 * - Handle size updates at resize end
 * - Emit update events for coordinators
 *
 * @version 1.6.3
 */

/**
 * UpdateHandler class
 * Manages Quick Tab position and size updates (local only, no cross-tab sync)
 * v1.6.3 - Simplified for single-tab Quick Tabs
 */
export class UpdateHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {EventEmitter} eventBus - Event bus for internal communication
   */
  constructor(quickTabsMap, eventBus) {
    this.quickTabsMap = quickTabsMap;
    this.eventBus = eventBus;
  }

  /**
   * Handle position change during drag
   * v1.6.3 - Local only (no cross-tab broadcast)
   *
   * @param {string} _id - Quick Tab ID (unused in local-only mode)
   * @param {number} _left - New left position (unused in local-only mode)
   * @param {number} _top - New top position (unused in local-only mode)
   */
  handlePositionChange(_id, _left, _top) {
    // v1.6.3 - No storage writes or broadcasts during drag
    // Position updates are visual only until drag ends
  }

  /**
   * Handle position change end (drag end)
   * v1.6.3 - Local only (no storage persistence)
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - Final left position
   * @param {number} top - Final top position
   */
  handlePositionChangeEnd(id, left, top) {
    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);

    // Emit event for coordinators
    this.eventBus?.emit('tab:position-updated', {
      id,
      left: roundedLeft,
      top: roundedTop
    });
  }

  /**
   * Handle size change during resize
   * v1.6.3 - Local only (no cross-tab broadcast)
   *
   * @param {string} _id - Quick Tab ID (unused in local-only mode)
   * @param {number} _width - New width (unused in local-only mode)
   * @param {number} _height - New height (unused in local-only mode)
   */
  handleSizeChange(_id, _width, _height) {
    // v1.6.3 - No storage writes or broadcasts during resize
    // Size updates are visual only until resize ends
  }

  /**
   * Handle size change end (resize end)
   * v1.6.3 - Local only (no storage persistence)
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - Final width
   * @param {number} height - Final height
   */
  handleSizeChangeEnd(id, width, height) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    // Emit event for coordinators
    this.eventBus?.emit('tab:size-updated', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });
  }

  /**
   * Destroy handler and cleanup resources
   * v1.6.3 - No-op (no resources to cleanup)
   */
  destroy() {
    // No cleanup needed for single-tab Quick Tabs
  }
}
