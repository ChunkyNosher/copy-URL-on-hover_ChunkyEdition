/**
 * Minimized Quick Tabs Manager
 * Manages the minimized state of Quick Tabs and provides restoration interface
 *
 * v1.5.9.0 - New module following modular-architecture-blueprint.md
 * v1.6.3.4-v4 - FIX Issue #4: Store position/size as immutable snapshot to prevent corruption
 * v1.6.3.4-v10 - FIX Issue #1: Do NOT delete snapshot in restore(), keep until UICoordinator confirms
 *   Added clearSnapshot() for UICoordinator to call after successful render
 * v1.6.3.4-v2 - FIX Issue #3: Enhanced logging for snapshot application verification
 * v1.6.3.4-v3 - FIX Issue #5: Improved snapshot lifecycle
 *   - Don't move to pendingClearSnapshots until UICoordinator calls clearSnapshot()
 *   - Keep snapshot in minimizedTabs during restore to allow re-reading
 *   - Comprehensive logging at all snapshot operations
 * v1.6.3.4-v12 - FIX Diagnostic Report Issue #5, #6:
 *   - State validation logging for entity.minimized vs Map consistency
 *   - Atomic snapshot clear with validation after clear
 * v1.6.3.6-v6 - FIX Minimize/Restore Bug:
 *   - Include originTabId in snapshot to preserve cross-tab ownership
 *   - Apply originTabId during restore to pass UICoordinator validation
 *   - Enhanced logging for snapshot lifecycle with originTabId tracking
 * v1.6.3.6-v8 - FIX Issue #3: Extract originTabId from ID pattern when null
 */

// Default values for position/size when not provided
const DEFAULT_POSITION_LEFT = 100;
const DEFAULT_POSITION_TOP = 100;
const DEFAULT_SIZE_WIDTH = 400;
const DEFAULT_SIZE_HEIGHT = 300;

// v1.6.3.5 - FIX Issue #3: Restore lock duration (matches SNAPSHOT_CLEAR_DELAY_MS)
const RESTORE_LOCK_DURATION_MS = 500;

/**
 * Extract tab ID from Quick Tab ID pattern
 * v1.6.3.6-v8 - FIX Issue #3: Fallback extraction from ID pattern
 * Quick Tab IDs follow pattern: qt-{tabId}-{timestamp}-{random}
 * @param {string} quickTabId - Quick Tab ID
 * @returns {number|null} Extracted tab ID or null
 */
function extractTabIdFromQuickTabId(quickTabId) {
  if (!quickTabId || typeof quickTabId !== 'string') return null;
  const match = quickTabId.match(/^qt-(\d+)-/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * MinimizedManager class - Tracks and manages minimized Quick Tabs
 * v1.6.3.4-v4 - Stores immutable snapshots of position/size to prevent corruption by duplicate windows
 * v1.6.3.4-v10 - FIX Issue #1: Snapshot lifecycle - keep until UICoordinator confirms successful render
 * v1.6.3.5 - FIX Issue #3: Add restore-in-progress lock to prevent duplicates
 * v1.6.3.5-v7 - FIX Issue #1: Add storage persistence callback after snapshot operations
 */
export class MinimizedManager {
  /**
   * Storage persistence callback - set by QuickTabsManager to trigger saves
   * v1.6.3.5-v7 - FIX Issue #1: Manager shows empty list after minimize/restore
   * @type {Function|null}
   */
  onStoragePersistNeeded = null;

  constructor() {
    // v1.6.3.4-v4 - FIX Issue #4: Store snapshot objects instead of direct references
    // Each entry: { window: QuickTabWindow, savedPosition: {left, top}, savedSize: {width, height} }
    this.minimizedTabs = new Map();
    // v1.6.3.4-v10 - FIX Issue #1: Track restored but not yet cleared snapshots
    // These are snapshots that have been applied but UICoordinator hasn't confirmed render yet
    this.pendingClearSnapshots = new Map();
    // v1.6.3.5 - FIX Issue #3: Track restore-in-progress per Quick Tab ID
    this._restoreInProgress = new Set();
    // v1.6.3.5-v7 - FIX Issue #7: Track last local update time for accurate "Last sync"
    this.lastLocalUpdateTime = Date.now();
  }

  /**
   * Add a minimized Quick Tab with immutable position/size snapshot
   * v1.6.3.4-v4 - FIX Issue #4: Store position/size as immutable snapshot to prevent corruption
   * v1.6.3.6-v8 - FIX Issue #3: Extract originTabId from ID pattern when null
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - QuickTabWindow instance
   */
  add(id, tabWindow) {
    // Guard against null/undefined tabWindow
    if (!tabWindow) {
      console.warn(
        '[MinimizedManager] Cannot add minimized tab - tabWindow is null/undefined:',
        id
      );
      return;
    }

    // v1.6.3.6-v8 - FIX Issue #3: Resolve originTabId with fallback to ID pattern
    let resolvedOriginTabId = tabWindow.originTabId;
    if (resolvedOriginTabId === null || resolvedOriginTabId === undefined) {
      const extractedTabId = extractTabIdFromQuickTabId(id);
      if (extractedTabId !== null) {
        console.warn('[MinimizedManager] ⚠️ ORIGIN_TAB_ID_RECOVERY: Extracted from ID pattern:', {
          quickTabId: id,
          extractedTabId,
          originalOriginTabId: tabWindow.originTabId
        });
        resolvedOriginTabId = extractedTabId;
      } else {
        console.error('[MinimizedManager] ❌ ORIGIN_TAB_ID_NULL: Could not resolve originTabId:', {
          quickTabId: id,
          tabWindowOriginTabId: tabWindow.originTabId
        });
      }
    }

    // v1.6.3.4-v4 - FIX Issue #4: Store immutable snapshot of position/size
    // This prevents corruption if a duplicate window overwrites the original's properties
    // v1.6.3.6-v6 - FIX: Include originTabId for cross-tab validation during restore
    // v1.6.3.6-v8 - FIX Issue #3: Use resolved originTabId (may be from ID pattern)
    const snapshot = {
      window: tabWindow,
      savedPosition: {
        left: tabWindow.left ?? DEFAULT_POSITION_LEFT,
        top: tabWindow.top ?? DEFAULT_POSITION_TOP
      },
      savedSize: {
        width: tabWindow.width ?? DEFAULT_SIZE_WIDTH,
        height: tabWindow.height ?? DEFAULT_SIZE_HEIGHT
      },
      // v1.6.3.6-v6 - FIX: Include originTabId for cross-tab validation during restore
      // v1.6.3.6-v8 - FIX Issue #3: Use resolved originTabId from ID pattern fallback
      savedOriginTabId: resolvedOriginTabId
    };
    this.minimizedTabs.set(id, snapshot);

    // v1.6.3.6-v8 - FIX Issue #3: Diagnostic logging for snapshot capture
    console.log('[MinimizedManager] 📸 SNAPSHOT_CAPTURED:', {
      id,
      savedPosition: snapshot.savedPosition,
      savedSize: snapshot.savedSize,
      savedOriginTabId: snapshot.savedOriginTabId,
      wasRecoveredFromIdPattern: resolvedOriginTabId !== tabWindow.originTabId
    });
  }

  /**
   * Remove a minimized Quick Tab
   */
  remove(id) {
    this.minimizedTabs.delete(id);
    console.log('[MinimizedManager] Removed minimized tab:', id);
  }

  /**
   * Restore a minimized Quick Tab
   * v1.5.9.8 - FIX: Ensure position state is preserved before calling restore
   * v1.6.3.4-v4 - FIX Issue #4: Use immutable snapshot instead of potentially corrupted instance
   * v1.6.3.4-v5 - FIX Bug #5: Return snapshot data for caller to apply to correct window
   * v1.6.3.4-v7 - FIX Issue #1, #6: Apply snapshot BEFORE calling restore() so render() uses correct values
   * v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call tabWindow.restore() here!
   *   This was causing duplicate window bug. MinimizedManager only applies snapshot.
   *   UICoordinator is the single rendering authority and will call restore() then render().
   * v1.6.3.4-v8 - FIX Issues #1, #6: Enhanced logging for dimension verification
   * v1.6.3.4-v10 - FIX Issue #1 CRITICAL: Do NOT delete snapshot here! Keep until UICoordinator confirms.
   *   The 200ms STATE_EMIT_DELAY_MS causes snapshot to be deleted before UICoordinator reads it.
   *   UICoordinator will call clearSnapshot() after successful render.
   * v1.6.3.4-v2 - FIX Issue #3: Enhanced logging showing saved snapshot values being applied
   * v1.6.3.4-v3 - FIX Issue #5: Keep snapshot in minimizedTabs during restore
   *   Only clearSnapshot() will remove it after UICoordinator confirms successful render.
   *   This allows multiple calls to getSnapshot() during the restore flow.
   * v1.6.3.5 - FIX Issue #3: Add restore-in-progress lock to prevent duplicate 400x300 windows
   *   Clear snapshot atomically BEFORE applying it to prevent race conditions
   *   Refactored to extract helpers to reduce complexity
   * @param {string} id - Quick Tab ID
   * @returns {Object|boolean} Snapshot object with position/size, or false if not found
   */
  restore(id) {
    // v1.6.3.5 - FIX Issue #3: Check restore-in-progress lock
    const duplicateResult = this._handleDuplicateRestore(id);
    if (duplicateResult !== null) return duplicateResult;

    // Find snapshot from available sources
    const { snapshot, snapshotSource } = this._findSnapshot(id);
    if (!snapshot) {
      console.log('[MinimizedManager] No snapshot found for restore:', id);
      return false;
    }

    // Set restore-in-progress lock
    this._setRestoreLock(id);

    // Move snapshot to pending (clear-on-first-use)
    this._moveSnapshotToPending(id, snapshot, snapshotSource);

    // Apply snapshot and verify
    const result = this._applyAndVerifySnapshot(id, snapshot, snapshotSource);

    return result;
  }

  /**
   * Handle duplicate restore attempts
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * @private
   */
  _handleDuplicateRestore(id) {
    if (!this._restoreInProgress.has(id)) return null;

    console.log('[MinimizedManager] Restore already in progress, rejecting duplicate:', id);
    const existingSnapshot = this.minimizedTabs.get(id) || this.pendingClearSnapshots.get(id);
    if (existingSnapshot) {
      return {
        window: existingSnapshot.window,
        position: {
          left: existingSnapshot.savedPosition.left,
          top: existingSnapshot.savedPosition.top
        },
        size: {
          width: existingSnapshot.savedSize.width,
          height: existingSnapshot.savedSize.height
        },
        // v1.6.3.6-v6 - FIX: Include originTabId for cross-tab validation during restore
        originTabId: existingSnapshot.savedOriginTabId ?? null,
        duplicate: true
      };
    }
    return false;
  }

  /**
   * Find snapshot from minimizedTabs or pendingClearSnapshots
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * @private
   */
  _findSnapshot(id) {
    let snapshot = this.minimizedTabs.get(id);
    let snapshotSource = 'minimizedTabs';

    if (!snapshot) {
      snapshot = this.pendingClearSnapshots.get(id);
      snapshotSource = 'pendingClearSnapshots';
      if (snapshot) {
        console.log('[MinimizedManager] Using pending-clear snapshot for re-entry:', id);
      }
    }

    return { snapshot, snapshotSource };
  }

  /**
   * Set restore-in-progress lock with timeout
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * @private
   */
  _setRestoreLock(id) {
    this._restoreInProgress.add(id);
    setTimeout(() => this._restoreInProgress.delete(id), RESTORE_LOCK_DURATION_MS);
  }

  /**
   * Move snapshot from minimizedTabs to pendingClear (clear-on-first-use)
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * @private
   */
  _moveSnapshotToPending(id, snapshot, snapshotSource) {
    if (snapshotSource !== 'minimizedTabs') return;

    this.minimizedTabs.delete(id);
    this.pendingClearSnapshots.set(id, snapshot);
    console.log(
      '[MinimizedManager] Atomically moved snapshot to pendingClear (clear-on-first-use):',
      id
    );
  }

  /**
   * Apply snapshot to tabWindow and verify application
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * @private
   */
  _applyAndVerifySnapshot(id, snapshot, snapshotSource) {
    const tabWindow = snapshot.window;

    // v1.6.3.4-v4 - FIX Issue #4: Use saved snapshot values, NOT current instance properties
    const savedLeft = snapshot.savedPosition.left;
    const savedTop = snapshot.savedPosition.top;
    const savedWidth = snapshot.savedSize.width;
    const savedHeight = snapshot.savedSize.height;
    // v1.6.3.6-v6 - FIX: Retrieve saved originTabId for cross-tab validation
    const savedOriginTabId = snapshot.savedOriginTabId ?? null;

    // Log snapshot source and dimensions
    console.log('[MinimizedManager] restore() snapshot lookup:', {
      id,
      source: snapshotSource,
      savedPosition: { left: savedLeft, top: savedTop },
      savedSize: { width: savedWidth, height: savedHeight },
      savedOriginTabId
    });

    // Log dimensions before applying
    console.log('[MinimizedManager] Instance dimensions BEFORE snapshot application:', {
      id,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height,
      originTabId: tabWindow.originTabId
    });

    // Apply snapshot to instance
    tabWindow.left = savedLeft;
    tabWindow.top = savedTop;
    tabWindow.width = savedWidth;
    tabWindow.height = savedHeight;

    // v1.6.3.6-v6 - FIX: Apply originTabId to tabWindow for UICoordinator validation
    if (savedOriginTabId !== null && savedOriginTabId !== undefined) {
      tabWindow.originTabId = savedOriginTabId;
      console.log('[MinimizedManager] Restored originTabId:', {
        id,
        originTabId: savedOriginTabId
      });
    }

    // Verify application
    this._verifySnapshotApplication(id, tabWindow, savedLeft, savedTop, savedWidth, savedHeight);

    console.log('[MinimizedManager] Snapshot applied:', {
      id,
      position: { left: savedLeft, top: savedTop },
      size: { width: savedWidth, height: savedHeight },
      originTabId: savedOriginTabId
    });

    return {
      window: tabWindow,
      position: { left: savedLeft, top: savedTop },
      size: { width: savedWidth, height: savedHeight },
      // v1.6.3.6-v6 - FIX: Include originTabId in return value for cross-tab validation
      originTabId: savedOriginTabId
    };
  }

  /**
   * Verify snapshot values were correctly applied to tabWindow
   * v1.6.3.5 - Extracted to reduce complexity
   * @private
   */
  _verifySnapshotApplication(id, tabWindow, savedLeft, savedTop, savedWidth, savedHeight) {
    const verified =
      tabWindow.left === savedLeft &&
      tabWindow.top === savedTop &&
      tabWindow.width === savedWidth &&
      tabWindow.height === savedHeight;

    if (verified) {
      console.log('[MinimizedManager] ✓ Snapshot application VERIFIED:', id);
    } else {
      console.error('[MinimizedManager] CRITICAL: Snapshot verification FAILED!', {
        id,
        expected: { left: savedLeft, top: savedTop, width: savedWidth, height: savedHeight },
        actual: {
          left: tabWindow.left,
          top: tabWindow.top,
          width: tabWindow.width,
          height: tabWindow.height
        }
      });
    }
  }

  /**
   * Clear a snapshot after UICoordinator confirms successful render
   * v1.6.3.4-v10 - FIX Issue #1: Called by UICoordinator after DOM verification passes
   * v1.6.3.4-v3 - FIX Issue #5: Now clears from minimizedTabs first (where snapshot stays during restore)
   * v1.6.3.4-v8 - FIX Issue #8: Enhanced logging with caller identification via stack trace
   * v1.6.3.4-v10 - FIX Issue #4: Atomic snapshot clearing - capture state in local variables
   *   The problem was checking two Maps sequentially without atomicity. Between checks,
   *   a timer could move the snapshot between Maps. Now we capture the state atomically
   *   using local variables before any modifications.
   * v1.6.3.5-v7 - FIX Issue #1: Trigger storage persistence after clearing snapshot
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if snapshot was cleared, false if not found
   */
  clearSnapshot(id) {
    // v1.6.3.4-v8 - FIX Issue #8: Log caller for debugging
    const stackLines = new Error().stack?.split('\n') || [];
    const caller = (stackLines.length > 2 ? stackLines[2]?.trim() : null) || 'unknown';

    // v1.6.3.4-v10 - FIX Issue #4: Capture state atomically in local variables BEFORE any modifications
    // This prevents race conditions where timer moves snapshot between Maps mid-operation
    const inMinimizedTabs = this.minimizedTabs.has(id);
    const inPendingClear = this.pendingClearSnapshots.has(id);

    console.log('[MinimizedManager] clearSnapshot() called:', {
      id,
      caller,
      inMinimizedTabs,
      inPendingClear,
      minimizedTabsSize: this.minimizedTabs.size,
      pendingSize: this.pendingClearSnapshots.size
    });

    let cleared = false;

    // v1.6.3.4-v10 - FIX Issue #4: Use captured state for atomic decision
    // First check minimizedTabs (where snapshot stays during restore)
    if (inMinimizedTabs) {
      this.minimizedTabs.delete(id);
      console.log(
        '[MinimizedManager] Cleared snapshot from minimizedTabs after successful render:',
        {
          id,
          remainingMinimizedTabs: this.minimizedTabs.size
        }
      );
      cleared = true;
    } else if (inPendingClear) {
      // Then check pendingClearSnapshots (legacy path)
      this.pendingClearSnapshots.delete(id);
      console.log('[MinimizedManager] Cleared snapshot from pendingClearSnapshots:', {
        id,
        remainingPendingSnapshots: this.pendingClearSnapshots.size
      });
      cleared = true;
    }

    // v1.6.3.5-v7 - FIX Issue #1: Trigger storage persistence if snapshot was cleared
    if (cleared) {
      this.lastLocalUpdateTime = Date.now();
      this._triggerStoragePersist();
    } else {
      // v1.6.3.4-v10 - FIX Issue #4: Enhanced logging when not found
      console.log('[MinimizedManager] clearSnapshot called but no snapshot found:', {
        id,
        minimizedTabsIds: Array.from(this.minimizedTabs.keys()),
        pendingClearIds: Array.from(this.pendingClearSnapshots.keys())
      });
    }

    return cleared;
  }

  /**
   * Trigger storage persistence via callback
   * v1.6.3.5-v7 - FIX Issue #1: Helper to notify QuickTabsManager to save state
   * @private
   */
  _triggerStoragePersist() {
    if (typeof this.onStoragePersistNeeded === 'function') {
      console.log('[MinimizedManager] Triggering storage persistence');
      this.onStoragePersistNeeded();
    } else {
      console.log('[MinimizedManager] No storage persist callback registered');
    }
  }

  /**
   * Update local timestamp to track when state was last modified
   * v1.6.3.5-v8 - Helper for consistent timestamp updates across state-modifying operations
   * @private
   */
  _updateLocalTimestamp() {
    this.lastLocalUpdateTime = Date.now();
  }

  /**
   * Update window reference in snapshot
   * v1.6.3.4-v5 - FIX Bug #5: Allow updating window reference when restore creates new window
   * @param {string} id - Quick Tab ID
   * @param {Object} newWindow - New QuickTabWindow instance
   * @returns {boolean} True if updated, false if not found
   */
  updateWindowReference(id, newWindow) {
    const snapshot = this.minimizedTabs.get(id);
    if (snapshot && newWindow) {
      snapshot.window = newWindow;
      console.log('[MinimizedManager] Updated window reference for:', id);
      return true;
    }
    return false;
  }

  /**
   * Get snapshot data for a minimized tab without restoring
   * v1.6.3.4-v5 - FIX Bug #5: Allow reading snapshot data for verification
   * v1.6.3.4-v10 - FIX Issue #1: Also check pendingClearSnapshots for recently restored tabs
   * @param {string} id - Quick Tab ID
   * @returns {Object|null} Snapshot data or null if not found
   */
  getSnapshot(id) {
    // Check active minimized tabs first
    let snapshot = this.minimizedTabs.get(id);

    // v1.6.3.4-v10 - FIX Issue #1: Also check pending clear snapshots
    if (!snapshot) {
      snapshot = this.pendingClearSnapshots.get(id);
    }

    if (snapshot && snapshot.savedPosition && snapshot.savedSize) {
      console.log('[MinimizedManager] getSnapshot found for:', id, {
        source: this.minimizedTabs.has(id) ? 'minimizedTabs' : 'pendingClearSnapshots',
        position: snapshot.savedPosition,
        size: snapshot.savedSize,
        // v1.6.3.6-v6 - FIX: Include originTabId in logging
        originTabId: snapshot.savedOriginTabId ?? null
      });
      return {
        position: { left: snapshot.savedPosition.left, top: snapshot.savedPosition.top },
        size: { width: snapshot.savedSize.width, height: snapshot.savedSize.height },
        // v1.6.3.6-v6 - FIX: Include originTabId for cross-tab validation
        originTabId: snapshot.savedOriginTabId ?? null
      };
    }
    console.log('[MinimizedManager] getSnapshot not found for:', id);
    return null;
  }

  /**
   * Get all minimized tab windows
   * v1.6.3.4-v4 - Returns window instances from snapshots
   */
  getAll() {
    return Array.from(this.minimizedTabs.values()).map(snapshot => snapshot.window);
  }

  /**
   * Get minimized tab count
   */
  getCount() {
    return this.minimizedTabs.size;
  }

  /**
   * Check if a tab is minimized
   * v1.6.3.4-v10 - FIX Issue #1: A tab is still "minimized" for snapshot purposes if in pendingClear
   *   But for UI purposes, only check minimizedTabs (not pendingClear)
   */
  isMinimized(id) {
    return this.minimizedTabs.has(id);
  }

  /**
   * Check if a snapshot exists for this tab (either active or pending clear)
   * v1.6.3.4-v10 - FIX Issue #1: UICoordinator should use this for snapshot lookup
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if any snapshot exists
   */
  hasSnapshot(id) {
    return this.minimizedTabs.has(id) || this.pendingClearSnapshots.has(id);
  }

  /**
   * Validate state consistency between entity.minimized flag and Map contents
   * v1.6.3.4-v12 - FIX Diagnostic Issue #5, #6: State validation logging
   * @param {string} id - Quick Tab ID
   * @param {boolean} entityMinimizedFlag - The entity.minimized flag value
   * @returns {boolean} True if states are consistent
   */
  validateStateConsistency(id, entityMinimizedFlag) {
    const inMap = this.minimizedTabs.has(id);
    const inPending = this.pendingClearSnapshots.has(id);

    // State is consistent if:
    // - entity.minimized=true AND in minimizedTabs (normal minimized state)
    // - entity.minimized=false AND NOT in minimizedTabs (normal visible state)
    // - entity.minimized=false AND in pendingClear (restore in progress - acceptable)

    const isConsistent =
      (entityMinimizedFlag && inMap) ||
      (!entityMinimizedFlag && !inMap) ||
      (!entityMinimizedFlag && inPending);

    if (!isConsistent) {
      console.warn('[MinimizedManager] ⚠️ State desync detected:', {
        id,
        entityMinimized: entityMinimizedFlag,
        inMinimizedTabs: inMap,
        inPendingClear: inPending,
        expected: entityMinimizedFlag
          ? 'should be in minimizedTabs'
          : 'should NOT be in minimizedTabs'
      });
    } else {
      console.log('[MinimizedManager] State consistency check passed:', {
        id,
        entityMinimized: entityMinimizedFlag,
        inMinimizedTabs: inMap
      });
    }

    return isConsistent;
  }

  /**
   * Atomically clear snapshot and update entity.minimized flag
   * v1.6.3.4-v12 - FIX Diagnostic Issue #5: Ensure atomic update
   * @param {string} id - Quick Tab ID
   * @param {Object} entity - The entity object to update (optional)
   * @returns {boolean} True if cleared and validated
   */
  clearSnapshotAtomic(id, entity = null) {
    // Clear the snapshot
    const cleared = this.clearSnapshot(id);

    // Update entity.minimized if provided
    if (entity && typeof entity === 'object') {
      entity.minimized = false;
      console.log('[MinimizedManager] Snapshot cleared, entity.minimized updated to false:', id);
    }

    // Validate after clear
    const stillHasSnapshot = this.hasSnapshot(id);
    if (stillHasSnapshot) {
      console.error('[MinimizedManager] CRITICAL: Snapshot still exists after clear!', {
        id,
        inMinimizedTabs: this.minimizedTabs.has(id),
        inPendingClear: this.pendingClearSnapshots.has(id)
      });
      return false;
    }

    console.log('[MinimizedManager] Snapshot cleared atomically, validated:', {
      id,
      cleared,
      hasSnapshotAfterClear: stillHasSnapshot
    });

    return cleared;
  }

  /**
   * Clear all minimized tabs
   * v1.6.3.4-v10 - FIX Issue #1: Also clear pendingClearSnapshots
   * v1.6.3.5 - FIX Issue #3: Also clear restore-in-progress locks
   * v1.6.3.5-v8 - FIX Issue #9: Enhanced logging for debug visibility
   */
  clear() {
    const minimizedCount = this.minimizedTabs.size;
    const pendingCount = this.pendingClearSnapshots.size;
    const restoreCount = this._restoreInProgress.size;

    // Log IDs being cleared for debugging
    const clearedIds = [
      ...Array.from(this.minimizedTabs.keys()),
      ...Array.from(this.pendingClearSnapshots.keys())
    ];

    this.minimizedTabs.clear();
    this.pendingClearSnapshots.clear();
    this._restoreInProgress.clear();
    this._updateLocalTimestamp();

    console.log('[MinimizedManager] clear() complete:', {
      minimizedCleared: minimizedCount,
      pendingCleared: pendingCount,
      restoreLocksCleared: restoreCount,
      clearedIds
    });
  }

  /**
   * Force cleanup a specific snapshot from all Maps
   * v1.6.3.5-v8 - FIX Issue #9: Ensure atomic cleanup across all collections
   * @param {string} id - Quick Tab ID to clean up
   * @returns {boolean} True if anything was cleaned up
   */
  forceCleanup(id) {
    // Guard: Validate id parameter
    if (!id) {
      console.warn('[MinimizedManager] forceCleanup called with invalid id:', id);
      return false;
    }

    const wasInMinimized = this.minimizedTabs.delete(id);
    const wasInPending = this.pendingClearSnapshots.delete(id);
    const wasRestoreInProgress = this._restoreInProgress.delete(id);

    const cleaned = wasInMinimized || wasInPending || wasRestoreInProgress;

    if (cleaned) {
      console.log('[MinimizedManager] forceCleanup:', {
        id,
        wasInMinimized,
        wasInPending,
        wasRestoreInProgress
      });
      this._updateLocalTimestamp();
      this._triggerStoragePersist();
    }

    return cleaned;
  }

  /**
   * Get all snapshot IDs (from both minimizedTabs and pendingClearSnapshots)
   * v1.6.3.5-v8 - FIX Issue #10: Enhanced logging support
   * @returns {string[]} Array of all snapshot IDs
   */
  getAllSnapshotIds() {
    return [
      ...Array.from(this.minimizedTabs.keys()),
      ...Array.from(this.pendingClearSnapshots.keys())
    ];
  }
}
