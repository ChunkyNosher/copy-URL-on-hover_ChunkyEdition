/**
 * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.4 - FIX Issue #2: Added debounce and change detection for storage writes
 * v1.6.4 - FIX Issue #3: Added storage persistence after position/size changes
 *
 * Responsibilities:
 * - Handle position updates during drag
 * - Handle position updates at drag end
 * - Handle size updates during resize
 * - Handle size updates at resize end
 * - Emit update events for coordinators
 * - Persist state to storage after updates (debounced, with change detection)
 *
 * @version 1.6.4
 */

import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

// v1.6.4 - FIX Issue #2: Debounce delay (Mozilla best practice: 200-350ms)
const DEBOUNCE_DELAY_MS = 300;

/**
 * UpdateHandler class
 * Manages Quick Tab position and size updates (local only, no cross-tab sync)
 * v1.6.3 - Simplified for single-tab Quick Tabs
 * v1.6.4 - FIX Issue #2: Added debounce and change detection for storage writes
 * v1.6.4 - FIX Issue #3: Added storage persistence after position/size changes
 */
export class UpdateHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Object} minimizedManager - Manager for minimized Quick Tabs (optional, for storage persistence)
   */
  constructor(quickTabsMap, eventBus, minimizedManager = null) {
    this.quickTabsMap = quickTabsMap;
    this.eventBus = eventBus;
    this.minimizedManager = minimizedManager;
    
    // v1.6.4 - FIX Issue #2: Debounce state tracking
    this._debounceTimer = null;
    this._lastStateHash = null;
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
   * v1.6.4 - FIX Issue #3: Added storage persistence
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - Final left position
   * @param {number} top - Final top position
   */
  handlePositionChangeEnd(id, left, top) {
    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);

    // Update the Quick Tab's stored position
    const tab = this.quickTabsMap.get(id);
    if (tab) {
      tab.left = roundedLeft;
      tab.top = roundedTop;
    }

    // Emit event for coordinators
    this.eventBus?.emit('tab:position-updated', {
      id,
      left: roundedLeft,
      top: roundedTop
    });

    // v1.6.4 - FIX Issue #3: Persist to storage after drag ends
    this._persistToStorage();
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
   * v1.6.4 - FIX Issue #3: Added storage persistence
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - Final width
   * @param {number} height - Final height
   */
  handleSizeChangeEnd(id, width, height) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    // Update the Quick Tab's stored size
    const tab = this.quickTabsMap.get(id);
    if (tab) {
      tab.width = roundedWidth;
      tab.height = roundedHeight;
    }

    // Emit event for coordinators
    this.eventBus?.emit('tab:size-updated', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });

    // v1.6.4 - FIX Issue #3: Persist to storage after resize ends
    this._persistToStorage();
  }

  /**
   * Persist current state to browser.storage.local (debounced with change detection)
   * v1.6.4 - FIX Issue #2: Added debounce and change detection
   * v1.6.4 - FIX Issue #3: Persist to storage after position/size changes
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   */
  _persistToStorage() {
    // v1.6.4 - FIX Issue #2: Clear any existing debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    
    // v1.6.4 - FIX Issue #2: Schedule debounced persist
    this._debounceTimer = setTimeout(() => {
      this._doPersist();
    }, DEBOUNCE_DELAY_MS);
  }
  
  /**
   * Actually perform the storage write (called after debounce)
   * v1.6.4 - FIX Issue #2: Only writes if state actually changed
   * @private
   */
  _doPersist() {
    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);
    
    // v1.6.4 - FIX Issue #2: Check if state actually changed
    const newHash = this._computeStateHash(state);
    if (newHash === this._lastStateHash) {
      console.log('[UpdateHandler] State unchanged, skipping storage write');
      return;
    }
    
    // Update hash and persist
    this._lastStateHash = newHash;
    persistStateToStorage(state, '[UpdateHandler]');
  }
  
  /**
   * Compute a simple hash of the state for change detection
   * v1.6.4 - FIX Issue #2: Used to skip redundant storage writes
   * @private
   * @param {Object} state - State object to hash
   * @returns {number} 32-bit hash of the state
   */
  _computeStateHash(state) {
    if (!state?.tabs) return 0;
    
    // Create a string of just the position/size data that we care about
    const stateStr = state.tabs.map(t => 
      `${t.id}:${t.left}:${t.top}:${t.width}:${t.height}:${t.minimized}`
    ).join('|');
    
    // Simple djb2 hash function with 32-bit conversion
    let hash = 0;
    for (let i = 0; i < stateStr.length; i++) {
      hash = ((hash << 5) - hash) + stateStr.charCodeAt(i);
      hash = hash & 0xffffffff; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Destroy handler and cleanup resources
   * v1.6.4 - FIX Issue #2: Clean up debounce timer
   */
  destroy() {
    // v1.6.4 - FIX Issue #2: Clear debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }
}
