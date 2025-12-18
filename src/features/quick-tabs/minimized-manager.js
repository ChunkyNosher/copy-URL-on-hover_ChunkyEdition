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
 * v1.6.3.10-v7 - FIX Issue #12: Snapshot lifecycle guard prevents expiration race
 *   - Add isRestoring flag to snapshot objects to track restore-in-progress state
 *   - Defer expiration timeout if isRestoring=true when timeout fires
 *   - Cancel and reschedule timeout when restore retries occur
 *   - Add DEBUG level logging for snapshot lifecycle transitions
 */

// Default values for position/size when not provided
const DEFAULT_POSITION_LEFT = 100;
const DEFAULT_POSITION_TOP = 100;
const DEFAULT_SIZE_WIDTH = 400;
const DEFAULT_SIZE_HEIGHT = 300;

// v1.6.3.5 - FIX Issue #3: Restore lock duration (matches SNAPSHOT_CLEAR_DELAY_MS)
const RESTORE_LOCK_DURATION_MS = 500;

// v1.6.3.10-v6 - FIX Issue A5: Snapshot expiration timeout
// Pending snapshots are automatically cleared if UICoordinator doesn't call clearSnapshot()
// within this timeout. Prevents indefinite memory leaks from failed restore operations.
const PENDING_SNAPSHOT_EXPIRATION_MS = 1000;

// v1.6.3.10-v7 - FIX Issue #12: Deferred expiration wait time
// When expiration fires while restore is in progress, we defer and re-check after this interval.
// This should be longer than typical retry intervals (~900ms) to avoid racing.
const DEFERRED_EXPIRATION_WAIT_MS = 500;

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
 * v1.6.3.10-v6 - FIX Issue A5: Add automatic snapshot expiration (1000ms timeout)
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
    // v1.6.3.10-v6 - FIX Issue A5: Track expiration timeouts for pending snapshots
    this._snapshotExpirationTimeouts = new Map();
  }

  /**
   * Add a minimized Quick Tab with immutable position/size snapshot
   * v1.6.3.4-v4 - FIX Issue #4: Store position/size as immutable snapshot to prevent corruption
   * v1.6.3.6-v8 - FIX Issue #3: Extract originTabId from ID pattern when null
   * v1.6.3.10-v4 - FIX Issue #13: Include originContainerId for Firefox Multi-Account Container isolation
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

    // Resolve originTabId with fallback to ID pattern
    const resolvedOriginTabId = this._resolveOriginTabId(id, tabWindow);

    // v1.6.3.10-v4 - FIX Issue #13: Resolve originContainerId for Firefox Multi-Account Container isolation
    const resolvedOriginContainerId =
      tabWindow.originContainerId ?? tabWindow.cookieStoreId ?? null;

    // Build snapshot object
    const snapshot = this._buildSnapshot(tabWindow, resolvedOriginTabId, resolvedOriginContainerId);
    this.minimizedTabs.set(id, snapshot);

    // Log snapshot capture
    this._logSnapshotCapture(id, snapshot, resolvedOriginTabId !== tabWindow.originTabId);
  }

  /**
   * Resolve originTabId with fallback to ID pattern extraction
   * v1.6.3.10-v4 - FIX: Extract to reduce add() complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - QuickTabWindow instance
   * @returns {number|null} Resolved originTabId
   */
  _resolveOriginTabId(id, tabWindow) {
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
    return resolvedOriginTabId;
  }

  /**
   * Build immutable snapshot object from tabWindow
   * v1.6.3.10-v4 - FIX: Extract to reduce add() complexity
   * v1.6.3.10-v7 - FIX Issue #12: Add isRestoring flag for snapshot lifecycle guard
   * @private
   * @param {Object} tabWindow - QuickTabWindow instance
   * @param {number|null} resolvedOriginTabId - Resolved originTabId
   * @param {string|null} resolvedOriginContainerId - Resolved originContainerId
   * @returns {Object} Snapshot object
   */
  _buildSnapshot(tabWindow, resolvedOriginTabId, resolvedOriginContainerId) {
    return {
      window: tabWindow,
      savedPosition: {
        left: tabWindow.left ?? DEFAULT_POSITION_LEFT,
        top: tabWindow.top ?? DEFAULT_POSITION_TOP
      },
      savedSize: {
        width: tabWindow.width ?? DEFAULT_SIZE_WIDTH,
        height: tabWindow.height ?? DEFAULT_SIZE_HEIGHT
      },
      savedOriginTabId: resolvedOriginTabId,
      savedOriginContainerId: resolvedOriginContainerId,
      // v1.6.3.10-v7 - FIX Issue #12: Track restore-in-progress to prevent expiration race
      isRestoring: false
    };
  }

  /**
   * Log snapshot capture for debugging
   * v1.6.3.10-v4 - FIX: Extract to reduce add() complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} snapshot - Snapshot object
   * @param {boolean} wasRecoveredFromIdPattern - Whether originTabId was recovered from ID pattern
   */
  _logSnapshotCapture(id, snapshot, wasRecoveredFromIdPattern) {
    console.log('[MinimizedManager] 📸 SNAPSHOT_CAPTURED:', {
      id,
      savedPosition: snapshot.savedPosition,
      savedSize: snapshot.savedSize,
      savedOriginTabId: snapshot.savedOriginTabId,
      savedOriginContainerId: snapshot.savedOriginContainerId,
      wasRecoveredFromIdPattern
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
   * v1.6.3.10-v4 - FIX Issue #13: Include originContainerId in duplicate restore result
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
        // v1.6.3.10-v4 - FIX Issue #13: Include originContainerId for Firefox Multi-Account Container isolation
        originContainerId: existingSnapshot.savedOriginContainerId ?? null,
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
   * v1.6.3.10-v7 - FIX Issue #12: Also set isRestoring flag on snapshot for lifecycle guard
   * @private
   */
  _setRestoreLock(id) {
    this._restoreInProgress.add(id);
    setTimeout(() => this._restoreInProgress.delete(id), RESTORE_LOCK_DURATION_MS);

    // v1.6.3.10-v7 - FIX Issue #12: Set isRestoring flag on snapshot (both locations)
    const snapshot = this.minimizedTabs.get(id) || this.pendingClearSnapshots.get(id);
    if (snapshot) {
      snapshot.isRestoring = true;
      console.debug('[MinimizedManager] 🔒 SNAPSHOT_LIFECYCLE: isRestoring=true set for:', id);
    }
  }

  /**
   * Move snapshot from minimizedTabs to pendingClear (clear-on-first-use)
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * v1.6.3.10-v6 - FIX Issue A5: Add automatic expiration timeout for pending snapshots
   * v1.6.3.10-v7 - FIX Issue #12: Defer expiration while isRestoring=true (lifecycle guard)
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

    // v1.6.3.10-v6 - FIX Issue A5: Set up automatic expiration timeout
    // Clear any existing timeout for this ID
    this._clearSnapshotExpirationTimeout(id);

    // v1.6.3.10-v7 - FIX Issue #12: Schedule expiration with lifecycle guard
    this._scheduleSnapshotExpiration(id);
  }

  /**
   * Schedule snapshot expiration with lifecycle guard
   * v1.6.3.10-v7 - FIX Issue #12: Extracted to support deferred expiration
   * If isRestoring=true when expiration fires, defer until restore completes.
   * @private
   * @param {string} id - Quick Tab ID
   */
  _scheduleSnapshotExpiration(id) {
    // Schedule automatic cleanup if UICoordinator doesn't call clearSnapshot()
    // Use arrow function to capture 'this' and the 'id' in closure
    const timeoutId = setTimeout(() => {
      this._handleSnapshotExpiration(id);
    }, PENDING_SNAPSHOT_EXPIRATION_MS);

    this._snapshotExpirationTimeouts.set(id, timeoutId);
    console.debug('[MinimizedManager] 🔒 SNAPSHOT_LIFECYCLE: Expiration scheduled for:', {
      id,
      timeoutMs: PENDING_SNAPSHOT_EXPIRATION_MS
    });
  }

  /**
   * Handle snapshot expiration with lifecycle guard
   * v1.6.3.10-v7 - FIX Issue #12: If isRestoring=true, defer; otherwise expire
   * @private
   * @param {string} id - Quick Tab ID
   */
  _handleSnapshotExpiration(id) {
    // Guard: Check if instance is still valid (Maps exist)
    if (!this._snapshotExpirationTimeouts || !this.pendingClearSnapshots) {
      return; // Instance was likely destroyed
    }

    const snapshot = this.pendingClearSnapshots.get(id);
    if (!snapshot) {
      // Snapshot was already cleared (by clearSnapshot call)
      this._snapshotExpirationTimeouts.delete(id);
      return;
    }

    // v1.6.3.10-v7 - FIX Issue #12: Lifecycle guard - defer if restore in progress
    if (snapshot.isRestoring) {
      console.debug('[MinimizedManager] 🔒 SNAPSHOT_LIFECYCLE: Expiration deferred (isRestoring=true):', {
        id,
        deferMs: DEFERRED_EXPIRATION_WAIT_MS
      });
      // Reschedule expiration check after deferred wait
      this._snapshotExpirationTimeouts.delete(id);
      const deferredTimeoutId = setTimeout(() => {
        this._handleSnapshotExpiration(id);
      }, DEFERRED_EXPIRATION_WAIT_MS);
      this._snapshotExpirationTimeouts.set(id, deferredTimeoutId);
      return;
    }

    // Snapshot is not being restored - safe to expire
    console.warn('[MinimizedManager] Snapshot expired (UICoordinator never called clearSnapshot):', {
      id,
      timeoutMs: PENDING_SNAPSHOT_EXPIRATION_MS
    });
    this.pendingClearSnapshots.delete(id);
    this._snapshotExpirationTimeouts.delete(id);
  }

  /**
   * Clear expiration timeout for a snapshot ID
   * v1.6.3.10-v6 - FIX Issue A5: Helper for timeout cleanup
   * @private
   * @param {string} id - Quick Tab ID
   */
  _clearSnapshotExpirationTimeout(id) {
    const existingTimeout = this._snapshotExpirationTimeouts.get(id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this._snapshotExpirationTimeouts.delete(id);
    }
  }

  /**
   * Apply snapshot to tabWindow and verify application
   * v1.6.3.5 - Extracted to reduce restore() complexity
   * v1.6.3.10-v4 - FIX Issue #13: Include originContainerId for Firefox Multi-Account Container isolation
   * v1.6.3.10-v7 - FIX Issue #12: Clear isRestoring flag after successful application
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
    // v1.6.3.10-v4 - FIX Issue #13: Retrieve saved originContainerId for container isolation
    const savedOriginContainerId = snapshot.savedOriginContainerId ?? null;

    // Log snapshot source and dimensions
    // v1.6.3.10-v4 - FIX Issue #13: Include container ID in logging
    console.log('[MinimizedManager] restore() snapshot lookup:', {
      id,
      source: snapshotSource,
      savedPosition: { left: savedLeft, top: savedTop },
      savedSize: { width: savedWidth, height: savedHeight },
      savedOriginTabId,
      savedOriginContainerId
    });

    // Log dimensions before applying
    console.log('[MinimizedManager] Instance dimensions BEFORE snapshot application:', {
      id,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height,
      originTabId: tabWindow.originTabId,
      originContainerId: tabWindow.originContainerId
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

    // v1.6.3.10-v4 - FIX Issue #13: Apply originContainerId to tabWindow for container isolation
    if (savedOriginContainerId !== null && savedOriginContainerId !== undefined) {
      tabWindow.originContainerId = savedOriginContainerId;
      console.log('[MinimizedManager] Restored originContainerId:', {
        id,
        originContainerId: savedOriginContainerId
      });
    }

    // Verify application
    this._verifySnapshotApplication(id, tabWindow, savedLeft, savedTop, savedWidth, savedHeight);

    // v1.6.3.10-v7 - FIX Issue #12: Clear isRestoring flag after successful application
    // This allows the expiration timeout to proceed if needed
    snapshot.isRestoring = false;
    console.debug('[MinimizedManager] 🔒 SNAPSHOT_LIFECYCLE: isRestoring=false set for:', id);

    // v1.6.3.10-v4 - FIX Issue #13: Include container ID in logging
    console.log('[MinimizedManager] Snapshot applied:', {
      id,
      position: { left: savedLeft, top: savedTop },
      size: { width: savedWidth, height: savedHeight },
      originTabId: savedOriginTabId,
      originContainerId: savedOriginContainerId
    });

    return {
      window: tabWindow,
      position: { left: savedLeft, top: savedTop },
      size: { width: savedWidth, height: savedHeight },
      // v1.6.3.6-v6 - FIX: Include originTabId in return value for cross-tab validation
      originTabId: savedOriginTabId,
      // v1.6.3.10-v4 - FIX Issue #13: Include originContainerId for Firefox Multi-Account Container isolation
      originContainerId: savedOriginContainerId
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

    // v1.6.3.10-v6 - FIX Issue A5: Clear expiration timeout when explicitly clearing
    this._clearSnapshotExpirationTimeout(id);

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
   * Find snapshot from minimizedTabs or pendingClearSnapshots
   * v1.6.3.10-v4 - FIX: Extract to reduce getSnapshot complexity
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {Object|null} Snapshot or null
   */
  _findSnapshotById(id) {
    let snapshot = this.minimizedTabs.get(id);
    if (!snapshot) {
      snapshot = this.pendingClearSnapshots.get(id);
    }
    return snapshot;
  }

  /**
   * Build return value for getSnapshot
   * v1.6.3.10-v4 - FIX: Extract to reduce getSnapshot complexity
   * @private
   * @param {Object} snapshot - Snapshot object
   * @returns {Object} Formatted snapshot data
   */
  _formatSnapshotData(snapshot) {
    return {
      position: { left: snapshot.savedPosition.left, top: snapshot.savedPosition.top },
      size: { width: snapshot.savedSize.width, height: snapshot.savedSize.height },
      originTabId: snapshot.savedOriginTabId ?? null,
      originContainerId: snapshot.savedOriginContainerId ?? null
    };
  }

  /**
   * Get snapshot data for a minimized tab without restoring
   * v1.6.3.4-v5 - FIX Bug #5: Allow reading snapshot data for verification
   * v1.6.3.4-v10 - FIX Issue #1: Also check pendingClearSnapshots for recently restored tabs
   * v1.6.3.10-v4 - FIX Issue #13: Include originContainerId for Firefox Multi-Account Container isolation
   * @param {string} id - Quick Tab ID
   * @returns {Object|null} Snapshot data or null if not found
   */
  getSnapshot(id) {
    const snapshot = this._findSnapshotById(id);

    if (!snapshot || !snapshot.savedPosition || !snapshot.savedSize) {
      console.log('[MinimizedManager] getSnapshot not found for:', id);
      return null;
    }

    // Log found snapshot
    console.log('[MinimizedManager] getSnapshot found for:', id, {
      source: this.minimizedTabs.has(id) ? 'minimizedTabs' : 'pendingClearSnapshots',
      position: snapshot.savedPosition,
      size: snapshot.savedSize,
      originTabId: snapshot.savedOriginTabId ?? null,
      originContainerId: snapshot.savedOriginContainerId ?? null
    });

    return this._formatSnapshotData(snapshot);
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
   * v1.6.3.10-v6 - FIX Issue A5: Also clear all expiration timeouts
   */
  clear() {
    const minimizedCount = this.minimizedTabs.size;
    const pendingCount = this.pendingClearSnapshots.size;
    const restoreCount = this._restoreInProgress.size;
    const expirationTimeoutCount = this._snapshotExpirationTimeouts.size;

    // Log IDs being cleared for debugging
    const clearedIds = [
      ...Array.from(this.minimizedTabs.keys()),
      ...Array.from(this.pendingClearSnapshots.keys())
    ];

    // v1.6.3.10-v6 - FIX Issue A5: Clear all expiration timeouts
    for (const timeoutId of this._snapshotExpirationTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this._snapshotExpirationTimeouts.clear();

    this.minimizedTabs.clear();
    this.pendingClearSnapshots.clear();
    this._restoreInProgress.clear();
    this._updateLocalTimestamp();

    console.log('[MinimizedManager] clear() complete:', {
      minimizedCleared: minimizedCount,
      pendingCleared: pendingCount,
      restoreLocksCleared: restoreCount,
      expirationTimeoutsCleared: expirationTimeoutCount,
      clearedIds
    });
  }

  /**
   * Force cleanup a specific snapshot from all Maps
   * v1.6.3.5-v8 - FIX Issue #9: Ensure atomic cleanup across all collections
   * v1.6.3.10-v6 - FIX Issue A5: Also clear expiration timeout
   * @param {string} id - Quick Tab ID to clean up
   * @returns {boolean} True if anything was cleaned up
   */
  forceCleanup(id) {
    // Guard: Validate id parameter
    if (!id) {
      console.warn('[MinimizedManager] forceCleanup called with invalid id:', id);
      return false;
    }

    // v1.6.3.10-v6 - FIX Issue A5: Clear expiration timeout if exists
    this._clearSnapshotExpirationTimeout(id);

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
