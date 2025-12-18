/**
 * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.4 - FIX Issue #2: Added debounce and change detection for storage writes
 * v1.6.3.4 - FIX Issue #3: Added storage persistence after position/size changes
 * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.3.4 - FIX Issue #3: Add z-index persistence for restore
 * v1.6.3.4-v3 - FIX Issue #6: Enhanced logging for callback invocation verification
 * v1.6.3.4-v12 - FIX Diagnostic Report Issue #3, #6:
 *   - Add DOM verification before skipping updates
 *   - Re-add tabs to Map if DOM exists but Map entry is missing
 *   - Enhanced logging for skipped updates
 * v1.6.3.5-v8 - FIX Diagnostic Issue #3:
 *   - Re-wire window reference after restore using eventBus
 *   - Enhanced tab recovery for post-restore updates
 * v1.6.3.10-v6 - FIX Issue A3: Check MINIMIZED state before persisting position/size
 *   - Prevents race condition where position data persists during 300ms debounce window
 *     after tab is minimized
 *
 * Responsibilities:
 * - Handle position updates during drag
 * - Handle position updates at drag end
 * - Handle size updates during resize
 * - Handle size updates at resize end
 * - Handle z-index updates on focus
 * - Emit update events for coordinators
 * - Persist state to storage after updates (debounced, with change detection)
 *
 * @version 1.6.3.10-v6
 */

import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

// v1.6.3.4 - FIX Issue #2: Debounce delay (Mozilla best practice: 200-350ms)
const DEBOUNCE_DELAY_MS = 300;

/**
 * UpdateHandler class
 * Manages Quick Tab position and size updates (local only, no cross-tab sync)
 * v1.6.3 - Simplified for single-tab Quick Tabs
 * v1.6.3.4 - FIX Issue #2: Added debounce and change detection for storage writes
 * v1.6.3.4 - FIX Issue #3: Added storage persistence after position/size changes
 * v1.6.3.4-v12 - FIX Issue #3: Resilience checks - verify DOM before skipping updates
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

    // v1.6.3.4 - FIX Issue #2: Debounce state tracking for _persistToStorage
    this._debounceTimer = null;
    // v1.6.3.5-v7 - FIX Bug: Separate timer object for drag/resize debouncing
    // This prevents conflict with single-timer _debounceTimer used by _persistToStorage
    this._dragDebounceTimers = {};
    // v1.6.3.4-v10 - FIX Issue #5: Use 64-bit hash (object with lo/hi parts)
    this._lastStateHash = null;
  }

  /**
   * Handle position change during drag
   * v1.6.3 - Local only (no cross-tab broadcast)
   * v1.6.3.5-v7 - FIX Issue #4: Add debounced persistence during drag for live Manager updates
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - New left position
   * @param {number} top - New top position
   */
  handlePositionChange(id, left, top) {
    // v1.6.3.5-v7 - FIX Issue #4: Update in-memory state for live tracking
    const tab = this.quickTabsMap.get(id);
    if (tab) {
      tab.left = Math.round(left);
      tab.top = Math.round(top);

      // Emit lightweight event for Manager live updates (without persistence)
      this.eventBus?.emit('tab:position-changing', {
        id,
        left: tab.left,
        top: tab.top
      });

      // Debounced persist during drag (200ms) for cross-context sync
      this._debouncedDragPersist(id, 'position');
    }
  }

  /**
   * Debounced persist during drag/resize operations
   * v1.6.3.5-v7 - FIX Issue #4: Enable live sync without overwhelming storage
   * Uses 200ms debounce (faster than end persist, but not on every pixel)
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} type - 'position' or 'size'
   */
  _debouncedDragPersist(id, type) {
    const key = `drag-${id}-${type}`;

    // Clear existing timer for this operation
    if (this._dragDebounceTimers[key]) {
      clearTimeout(this._dragDebounceTimers[key]);
    }

    // Schedule new persist (200ms - faster than DEBOUNCE_DELAY_MS for end operations)
    this._dragDebounceTimers[key] = setTimeout(() => {
      delete this._dragDebounceTimers[key];
      this._doPersist();
    }, 200);
  }

  /**
   * Handle position change end (drag end)
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.4 - FIX Issue #3: Added storage persistence
   * v1.6.3.4-v3 - FIX Issue #6: Enhanced logging for callback invocation
   * v1.6.3.4-v12 - FIX Diagnostic Issue #3, #6: Verify DOM before skipping, re-add if missing
   * v1.6.3.5-v8 - FIX Issue #3: Emit event when orphaned DOM detected for re-wiring
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - Final left position
   * @param {number} top - Final top position
   */
  handlePositionChangeEnd(id, left, top) {
    // v1.6.3.4-v3 - FIX Issue #6: Log callback invocation for debugging
    console.log('[UpdateHandler] handlePositionChangeEnd called:', { id, left, top });

    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);

    // Update the Quick Tab's stored position
    const tab = this.quickTabsMap.get(id);

    // v1.6.3.4-v12 - FIX Issue #3: Check DOM if tab not in Map
    if (!tab) {
      const domExists = this._checkDOMExists(id);
      console.warn('[UpdateHandler] Position update skipped:', {
        id,
        reason: 'tab not in quickTabsMap',
        inDOM: domExists
      });

      if (domExists) {
        // v1.6.3.5-v8 - FIX Issue #3: Request re-wiring via event
        this._emitOrphanedTabEvent(id, 'position', { left: roundedLeft, top: roundedTop });
      }
      return;
    }

    tab.left = roundedLeft;
    tab.top = roundedTop;
    console.log('[UpdateHandler] Updated tab position in Map:', {
      id,
      left: roundedLeft,
      top: roundedTop
    });

    // Emit event for coordinators
    this.eventBus?.emit('tab:position-updated', {
      id,
      left: roundedLeft,
      top: roundedTop
    });

    // v1.6.3.4 - FIX Issue #3: Persist to storage after drag ends
    console.log('[UpdateHandler] Scheduling storage persist after position change');
    this._persistToStorage();
  }

  /**
   * Emit event when orphaned DOM element detected
   * v1.6.3.5-v8 - FIX Issue #3: Request re-wiring from UICoordinator
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} updateType - Type of update that triggered detection
   * @param {Object} updateData - Update data to apply after re-wiring
   */
  _emitOrphanedTabEvent(id, updateType, updateData) {
    console.warn('[UpdateHandler] Tab not in Map but exists in DOM, requesting re-wire:', {
      id,
      updateType,
      updateData
    });

    // Guard: Only emit if eventBus is available
    if (!this.eventBus) {
      console.warn('[UpdateHandler] Cannot emit tab:orphaned - eventBus not available');
      return;
    }

    // Emit event for UICoordinator to handle re-wiring
    this.eventBus.emit('tab:orphaned', {
      id,
      updateType,
      updateData
    });
  }

  /**
   * Check if a DOM element exists for a Quick Tab ID
   * v1.6.3.4-v12 - FIX Issue #3: Helper to verify DOM state
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if DOM element exists
   */
  _checkDOMExists(id) {
    try {
      // v1.6.3.4-v12 - FIX Security: Escape ID to prevent CSS injection
      const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
      return !!document.querySelector(`[data-quicktab-id="${escapedId}"]`);
    } catch (err) {
      // Log DOM query failures for debugging (could indicate corrupt DOM state)
      console.warn('[UpdateHandler] DOM query failed for tab:', id, err?.message);
      return false;
    }
  }

  /**
   * Handle size change during resize
   * v1.6.3 - Local only (no cross-tab broadcast)
   * v1.6.3.5-v7 - FIX Issue #4: Add debounced persistence during resize for live Manager updates
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - New width
   * @param {number} height - New height
   */
  handleSizeChange(id, width, height) {
    // v1.6.3.5-v7 - FIX Issue #4: Update in-memory state for live tracking
    const tab = this.quickTabsMap.get(id);
    if (tab) {
      tab.width = Math.round(width);
      tab.height = Math.round(height);

      // Emit lightweight event for Manager live updates (without persistence)
      this.eventBus?.emit('tab:size-changing', {
        id,
        width: tab.width,
        height: tab.height
      });

      // Debounced persist during resize (200ms) for cross-context sync
      this._debouncedDragPersist(id, 'size');
    }
  }

  /**
   * Handle size change end (resize end)
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.4 - FIX Issue #3: Added storage persistence
   * v1.6.3.4-v3 - FIX Issue #6: Enhanced logging for callback invocation
   * v1.6.3.4-v12 - FIX Diagnostic Issue #3, #6: Verify DOM before skipping, enhanced logging
   * v1.6.3.5-v8 - FIX Issue #3: Emit event when orphaned DOM detected for re-wiring
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - Final width
   * @param {number} height - Final height
   */
  handleSizeChangeEnd(id, width, height) {
    // v1.6.3.4-v3 - FIX Issue #6: Log callback invocation for debugging
    console.log('[UpdateHandler] handleSizeChangeEnd called:', { id, width, height });

    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    // Update the Quick Tab's stored size
    const tab = this.quickTabsMap.get(id);

    // v1.6.3.4-v12 - FIX Issue #3: Check DOM if tab not in Map
    if (!tab) {
      const domExists = this._checkDOMExists(id);
      console.warn('[UpdateHandler] Size update skipped:', {
        id,
        reason: 'tab not in quickTabsMap',
        inDOM: domExists
      });

      if (domExists) {
        // v1.6.3.5-v8 - FIX Issue #3: Request re-wiring via event
        this._emitOrphanedTabEvent(id, 'size', { width: roundedWidth, height: roundedHeight });
      }
      return;
    }

    tab.width = roundedWidth;
    tab.height = roundedHeight;
    console.log('[UpdateHandler] Updated tab size in Map:', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });

    // Emit event for coordinators
    this.eventBus?.emit('tab:size-updated', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });

    // v1.6.3.4 - FIX Issue #3: Persist to storage after resize ends
    console.log('[UpdateHandler] Scheduling storage persist after size change');
    this._persistToStorage();
  }

  /**
   * Persist current state to browser.storage.local (debounced with change detection)
   * v1.6.3.4 - FIX Issue #2: Added debounce and change detection
   * v1.6.3.4 - FIX Issue #3: Persist to storage after position/size changes
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   */
  _persistToStorage() {
    // v1.6.3.4 - FIX Issue #2: Clear any existing debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    // v1.6.3.4 - FIX Issue #2: Schedule debounced persist
    this._debounceTimer = setTimeout(() => {
      this._doPersist();
    }, DEBOUNCE_DELAY_MS);
  }

  /**
   * Check if 64-bit hash has changed compared to last hash
   * v1.6.3.4-v10 - FIX Issue #5: Helper for cleaner hash comparison
   * @private
   * @param {{ lo: number, hi: number }|null} oldHash - Previous hash
   * @param {{ lo: number, hi: number }} newHash - New hash
   * @returns {boolean} True if hash has changed
   */
  _hasHashChanged(oldHash, newHash) {
    if (!oldHash) return true; // No previous hash means "changed"
    return newHash.lo !== oldHash.lo || newHash.hi !== oldHash.hi;
  }

  /**
   * Check if a tab ID corresponds to a minimized tab
   * v1.6.3.10-v6 - FIX Issue A3: Helper for minimized state check
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if tab is minimized
   */
  _isTabMinimized(id) {
    return this.minimizedManager?.isMinimized?.(id) ?? false;
  }

  /**
   * Actually perform the storage write (called after debounce)
   * v1.6.3.4 - FIX Issue #2: Only writes if state actually changed
   * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation
   * v1.6.3.4-v10 - FIX Issue #5: Compare both parts of 64-bit hash
   * v1.6.3.6-v4 - FIX Issue #1: Added success confirmation logging
   * v1.6.3.10-v6 - FIX Issue A3: Skip persist if all updated tabs are now minimized
   *   This prevents race condition where position data persists during 300ms debounce
   *   window after tab is minimized
   * @private
   * @returns {Promise<void>}
   */
  async _doPersist() {
    // v1.6.3.6-v4 - FIX Issue #1: Log entry
    console.log('[UpdateHandler] _doPersist ENTRY:', {
      mapSize: this.quickTabsMap?.size ?? 0,
      hasMinimizedManager: !!this.minimizedManager,
      timestamp: Date.now()
    });

    // v1.6.3.10-v6 - FIX Issue A3: Check if any non-minimized tabs exist
    // If all tabs are minimized, skip the persist since it would be stale
    let nonMinimizedCount = 0;
    for (const [id] of this.quickTabsMap) {
      if (!this._isTabMinimized(id)) {
        nonMinimizedCount++;
      }
    }

    if (nonMinimizedCount === 0 && this.quickTabsMap.size > 0) {
      console.log('[UpdateHandler] _doPersist SKIPPED: All tabs are minimized, position/size changes are stale');
      return;
    }

    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);

    // v1.6.3.4-v2 - FIX Bug #1: Handle null state from validation failure
    if (!state) {
      console.error('[UpdateHandler] Failed to build state for storage');
      return;
    }

    // v1.6.3.4-v10 - FIX Issue #5: Compute 64-bit hash and compare both parts
    const newHash = this._computeStateHash(state);
    const hashChanged = this._hasHashChanged(this._lastStateHash, newHash);

    if (!hashChanged) {
      console.log('[UpdateHandler] State unchanged (hash match), skipping storage write:', {
        hashLo: newHash.lo,
        hashHi: newHash.hi
      });
      return;
    }

    // v1.6.3.4-v10 - FIX Issue #8: Log hash change for debugging
    console.log('[UpdateHandler] State changed (hash mismatch), proceeding with storage write:', {
      oldHashLo: this._lastStateHash?.lo,
      oldHashHi: this._lastStateHash?.hi,
      newHashLo: newHash.lo,
      newHashHi: newHash.hi,
      tabCount: state.tabs?.length
    });

    // Update hash and persist
    this._lastStateHash = newHash;
    const success = await persistStateToStorage(state, '[UpdateHandler]');

    // v1.6.3.6-v4 - FIX Issue #1: Log result
    if (success) {
      console.log('[UpdateHandler] _doPersist SUCCESS:', {
        tabCount: state.tabs?.length,
        timestamp: Date.now()
      });
    } else {
      console.error('[UpdateHandler] Storage persist failed or timed out');
    }
  }

  /**
   * Compute a simple hash of the state for change detection
   * v1.6.3.4 - FIX Issue #2: Used to skip redundant storage writes
   * v1.6.3.4 - FIX Issue #3: Include zIndex in hash for proper change detection
   * v1.6.3.4-v10 - FIX Issue #5: Implement 64-bit hash to reduce collision probability
   *   The 32-bit hash had ~50% collision probability over session lifetime (birthday paradox).
   *   Now using dual hash (djb2 + sdbm) for 64-bit equivalent with negligible collision rate.
   * @private
   * @param {Object} state - State object to hash
   * @returns {{ lo: number, hi: number }} Object with low and high 32-bit hash parts
   */
  _computeStateHash(state) {
    if (!state?.tabs) {
      return { lo: 0, hi: 0 };
    }

    // Create a string of just the position/size/zIndex data that we care about
    // v1.6.3.4 - FIX Issue #3: Include zIndex for z-index persistence
    const stateStr = state.tabs
      .map(t => `${t.id}:${t.left}:${t.top}:${t.width}:${t.height}:${t.zIndex}:${t.minimized}`)
      .join('|');

    // v1.6.3.4-v10 - FIX Issue #5: djb2 hash for low 32 bits
    let hashLo = 0;
    for (let i = 0; i < stateStr.length; i++) {
      hashLo = (hashLo << 5) - hashLo + stateStr.charCodeAt(i);
      hashLo = hashLo & 0xffffffff; // Convert to 32-bit integer
    }

    // v1.6.3.4-v10 - FIX Issue #5: sdbm hash for high 32 bits
    // Using different algorithm ensures different collision patterns
    let hashHi = 0;
    for (let i = 0; i < stateStr.length; i++) {
      hashHi = stateStr.charCodeAt(i) + (hashHi << 6) + (hashHi << 16) - hashHi;
      hashHi = hashHi & 0xffffffff; // Convert to 32-bit integer
    }

    return { lo: hashLo, hi: hashHi };
  }

  /**
   * Destroy handler and cleanup resources
   * v1.6.3.4 - FIX Issue #2: Clean up debounce timer
   */
  destroy() {
    // v1.6.3.4 - FIX Issue #2: Clear debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }
}
