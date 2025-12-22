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
 * v1.6.3.10-v12 - FIX Issue #22: State consistency with VisibilityHandler
 *   - VisibilityHandler.startConsistencyChecks() validates DOM state matches snapshot state
 *   - MISSING_SNAPSHOT: Minimized in DOM but no snapshot - create one from current state
 *   - STALE_SNAPSHOT: Non-minimized in DOM but has snapshot - remove stale snapshot
 *   - Checks run every 5 seconds when enabled by QuickTabsManager
 * v1.6.3.11 - FIX Issue #30: Document limitation - minimized state is memory-only
 *
 * KNOWN LIMITATION (v1.6.3.11 - Issue #30):
 * Minimized state (minimizedTabs Map) is stored in memory only and is NOT persisted across:
 * - Browser restarts
 * - Background script restarts
 * - Tab refreshes
 * When state is lost, minimized Quick Tabs will need to be re-minimized by the user.
 * FUTURE: Consider persisting minimized state to storage.session for session persistence.
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
// v1.6.3.10-v10 - FIX Issue 1.2: Increased from 1000ms to 5000ms to handle slow restore pipelines
// This acts as a watchdog for orphan cleanup only - isRestoring flag prevents early expiration during active restores
const PENDING_SNAPSHOT_EXPIRATION_MS = 5000;

// v1.6.3.10-v7 - FIX Issue #12: Deferred expiration wait time
// When expiration fires while restore is in progress, we defer and re-check after this interval.
// This should be longer than typical retry intervals (~900ms) to avoid racing.
const DEFERRED_EXPIRATION_WAIT_MS = 500;

// v1.6.3.11-v4 - FIX Issue #71: Batched persistence interval
// Volatile state is persisted every 10 seconds to reduce storage thrashing
const VOLATILE_STATE_BATCH_INTERVAL_MS = 10000;

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
 * Validate position fields in snapshot
 * v1.6.4.16 - FIX Issue #25: Helper to reduce complexity
 * @private
 * @param {Object} savedPosition - Position object
 * @param {string[]} errors - Errors array to append to
 */
function _validateSnapshotPosition(savedPosition, errors) {
  if (!savedPosition || typeof savedPosition !== 'object') {
    errors.push('Missing or invalid savedPosition object');
    return;
  }
  if (typeof savedPosition.left !== 'number' || !Number.isFinite(savedPosition.left)) {
    errors.push('Invalid savedPosition.left: must be a finite number');
  }
  if (typeof savedPosition.top !== 'number' || !Number.isFinite(savedPosition.top)) {
    errors.push('Invalid savedPosition.top: must be a finite number');
  }
}

/**
 * Validate size fields in snapshot
 * v1.6.4.16 - FIX Issue #25: Helper to reduce complexity
 * @private
 * @param {Object} savedSize - Size object
 * @param {string[]} errors - Errors array to append to
 */
function _validateSnapshotSize(savedSize, errors) {
  if (!savedSize || typeof savedSize !== 'object') {
    errors.push('Missing or invalid savedSize object');
    return;
  }
  if (typeof savedSize.width !== 'number' || savedSize.width <= 0) {
    errors.push('Invalid savedSize.width: must be a positive number');
  }
  if (typeof savedSize.height !== 'number' || savedSize.height <= 0) {
    errors.push('Invalid savedSize.height: must be a positive number');
  }
}

/**
 * Log snapshot validation result
 * v1.6.4.16 - FIX Issue #25: Helper to reduce complexity
 * @private
 */
function _logSnapshotValidationResult(valid, errors, snapshot, context) {
  if (!valid) {
    console.warn('[SNAPSHOT_VALIDATE] Validation failed:', {
      context,
      errorCount: errors.length,
      errors,
      snapshotKeys: Object.keys(snapshot || {})
    });
  } else {
    console.log('[SNAPSHOT_VALIDATE] Validation passed:', {
      context,
      position: snapshot.savedPosition,
      size: snapshot.savedSize,
      hasWindow: !!snapshot.window,
      hasOriginTabId: snapshot.savedOriginTabId !== undefined
    });
  }
}

/**
 * Validate snapshot structural integrity before deserialization
 * v1.6.4.16 - FIX Issue #25: No validation of snapshot structural integrity
 * Checks that all required fields exist and have valid values
 * @param {Object} snapshot - Snapshot object to validate
 * @param {string} context - Context for logging (e.g., 'restore', 'hydration')
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
export function validateSnapshotIntegrity(snapshot, context = 'unknown') {
  const errors = [];

  // Check if snapshot exists
  if (!snapshot) {
    errors.push('Snapshot is null or undefined');
    console.warn('[SNAPSHOT_VALIDATE] Validation failed:', { context, errors });
    return { valid: false, errors };
  }

  // Validate position and size using helpers
  _validateSnapshotPosition(snapshot.savedPosition, errors);
  _validateSnapshotSize(snapshot.savedSize, errors);

  // Check window reference (optional but logged)
  if (!snapshot.window) {
    console.log('[SNAPSHOT_VALIDATE] Warning: Snapshot has no window reference:', { context });
  }

  const valid = errors.length === 0;
  _logSnapshotValidationResult(valid, errors, snapshot, context);

  return { valid, errors };
}

/**
 * MinimizedManager class - Tracks and manages minimized Quick Tabs
 * v1.6.3.4-v4 - Stores immutable snapshots of position/size to prevent corruption by duplicate windows
 * v1.6.3.4-v10 - FIX Issue #1: Snapshot lifecycle - keep until UICoordinator confirms successful render
 * v1.6.3.5 - FIX Issue #3: Add restore-in-progress lock to prevent duplicates
 * v1.6.3.5-v7 - FIX Issue #1: Add storage persistence callback after snapshot operations
 * v1.6.3.10-v6 - FIX Issue A5: Add automatic snapshot expiration (1000ms timeout)
 * v1.6.3.10-v10 - FIX Issues #9, #11: Enhanced adoption lock with timeout and escalation
 */

// v1.6.3.10-v10 - FIX Issue #11: Adoption lock timeout constants
const ADOPTION_LOCK_TIMEOUT_MS = 10000; // 10 seconds max lock duration
const ADOPTION_LOCK_WARNING_MS = 5000; // Warn after 5 seconds

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
    // v1.6.3.10-v10 - FIX Issue #9/#11: Adoption lock to synchronize adoption and restore operations
    // Key: quickTabId, Value: { timestamp, promise, resolver, timeoutId, warningTimeoutId }
    this._adoptionLocks = new Map();
    // v1.6.3.10-v10 - FIX Issue #11: Track forced lock releases for debugging
    this._forcedLockReleaseCount = 0;

    // v1.6.3.11-v4 - FIX Issue #71: Volatile state batching
    // Track whether volatile state has changed since last persistence
    this._volatileStateDirty = false;
    // Batched persistence timer ID
    this._batchPersistTimerId = null;
  }

  /**
   * Start batched persistence timer
   * v1.6.3.11-v4 - FIX Issue #71: Batch volatile state changes
   *
   * Call this when the MinimizedManager is initialized to enable
   * automatic batched persistence every 10 seconds when state changes.
   */
  startBatchedPersistence() {
    if (this._batchPersistTimerId !== null) {
      return; // Already running
    }

    this._batchPersistTimerId = setInterval(() => {
      if (this._volatileStateDirty) {
        this._flushVolatileState();
      }
    }, VOLATILE_STATE_BATCH_INTERVAL_MS);

    console.log('[MinimizedManager] BATCHED_PERSISTENCE_STARTED:', {
      intervalMs: VOLATILE_STATE_BATCH_INTERVAL_MS
    });
  }

  /**
   * Stop batched persistence timer
   * v1.6.3.11-v4 - FIX Issue #71: Cleanup on shutdown
   */
  stopBatchedPersistence() {
    if (this._batchPersistTimerId !== null) {
      clearInterval(this._batchPersistTimerId);
      this._batchPersistTimerId = null;
      
      // Flush any pending changes
      if (this._volatileStateDirty) {
        this._flushVolatileState();
      }

      console.log('[MinimizedManager] BATCHED_PERSISTENCE_STOPPED');
    }
  }

  /**
   * Mark volatile state as dirty (needs persistence)
   * v1.6.3.11-v4 - FIX Issue #71: Track state changes
   * @private
   */
  _markVolatileStateDirty() {
    this._volatileStateDirty = true;
  }

  /**
   * Flush volatile state to storage
   * v1.6.3.11-v4 - FIX Issue #71: Batched persistence
   * @private
   */
  async _flushVolatileState() {
    if (!this._volatileStateDirty) {
      return;
    }

    this._volatileStateDirty = false;

    console.log('[MinimizedManager] VOLATILE_STATE_FLUSH:', {
      minimizedCount: this.minimizedTabs.size,
      timestamp: Date.now()
    });

    try {
      await this.persistToStorage();
    } catch (err) {
      console.error('[MinimizedManager] VOLATILE_STATE_FLUSH_FAILED:', {
        error: err.message
      });
      // Re-mark as dirty so next interval retries
      this._volatileStateDirty = true;
    }
  }

  /**
   * Acquire adoption lock for a Quick Tab
   * v1.6.3.10-v10 - FIX Issue #9/#11: Coordinate adoption with restore operations
   *
   * The lock prevents restore operations from proceeding while adoption is in flight.
   * Includes timeout and escalation mechanism to prevent indefinite waits.
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {string} reason - Reason for acquiring lock (for logging)
   * @returns {Promise<{acquired: boolean, wasForced: boolean}>}
   */
  /**
   * Wait for existing lock with timeout
   * v1.6.3.10-v10 - FIX Code Health: Extracted to reduce nesting
   * v1.6.3.10-v10 - FIX Code Review: Clear timeout to prevent memory leaks
   * @private
   */
  async _waitForExistingLockWithTimeout(existingLock, quickTabId, remainingTimeout) {
    console.log('[ADOPTION][MinimizedManager] LOCK_WAIT:', {
      quickTabId,
      lockAge: Date.now() - existingLock.timestamp,
      timeout: ADOPTION_LOCK_TIMEOUT_MS,
      timestamp: new Date().toISOString()
    });

    let timeoutId = null;
    try {
      await Promise.race([
        existingLock.promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Lock wait timeout')), remainingTimeout);
        })
      ]);
    } catch (err) {
      console.warn('[ADOPTION][MinimizedManager] LOCK_WAIT_TIMEOUT:', {
        quickTabId,
        error: err.message,
        timestamp: new Date().toISOString()
      });
      this._forceReleaseAdoptionLock(quickTabId);
      this._forcedLockReleaseCount++;
    } finally {
      // Clear timeout to prevent memory leaks
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Handle existing lock when trying to acquire
   * v1.6.3.10-v10 - FIX Code Health: Extracted to reduce nesting
   * @private
   */
  async _handleExistingLock(existingLock, quickTabId) {
    const lockAge = Date.now() - existingLock.timestamp;

    // Force-release stale locks
    if (lockAge >= ADOPTION_LOCK_TIMEOUT_MS) {
      console.warn('[ADOPTION][MinimizedManager] LOCK_FORCE_RELEASE:', {
        quickTabId,
        lockAge,
        reason: 'timeout exceeded',
        timestamp: new Date().toISOString()
      });
      this._forceReleaseAdoptionLock(quickTabId);
      this._forcedLockReleaseCount++;
      return;
    }

    // Wait for existing lock
    await this._waitForExistingLockWithTimeout(
      existingLock,
      quickTabId,
      ADOPTION_LOCK_TIMEOUT_MS - lockAge
    );
  }

  /**
   * Create and store new adoption lock
   * v1.6.3.10-v10 - FIX Code Health: Extracted to reduce nesting
   * @private
   */
  _createNewAdoptionLock(quickTabId, reason) {
    let resolver;
    const promise = new Promise(resolve => {
      resolver = resolve;
    });

    const warningTimeoutId = setTimeout(() => {
      console.warn('[ADOPTION][MinimizedManager] LOCK_WARNING:', {
        quickTabId,
        heldMs: ADOPTION_LOCK_WARNING_MS,
        reason,
        timestamp: new Date().toISOString()
      });
    }, ADOPTION_LOCK_WARNING_MS);

    const timeoutId = setTimeout(() => {
      console.error('[ADOPTION][MinimizedManager] LOCK_TIMEOUT_ESCALATION:', {
        quickTabId,
        heldMs: ADOPTION_LOCK_TIMEOUT_MS,
        reason,
        action: 'force-releasing',
        timestamp: new Date().toISOString()
      });
      this._forceReleaseAdoptionLock(quickTabId);
      this._forcedLockReleaseCount++;
    }, ADOPTION_LOCK_TIMEOUT_MS);

    this._adoptionLocks.set(quickTabId, {
      timestamp: Date.now(),
      promise,
      resolver,
      timeoutId,
      warningTimeoutId,
      reason
    });
  }

  /**
   * Acquire adoption lock for a Quick Tab
   * v1.6.3.10-v10 - FIX Issue #9/#11: Coordinate adoption with restore operations
   *
   * The lock prevents restore operations from proceeding while adoption is in flight.
   * Includes timeout and escalation mechanism to prevent indefinite waits.
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {string} reason - Reason for acquiring lock (for logging)
   * @returns {Promise<{acquired: boolean, wasForced: boolean}>}
   */
  async acquireAdoptionLock(quickTabId, reason = 'adoption') {
    console.log('[ADOPTION][MinimizedManager] LOCK_ACQUIRE_REQUEST:', {
      quickTabId,
      reason,
      existingLock: this._adoptionLocks.has(quickTabId),
      timestamp: new Date().toISOString()
    });

    // Check for existing lock
    const existingLock = this._adoptionLocks.get(quickTabId);
    if (existingLock) {
      await this._handleExistingLock(existingLock, quickTabId);
    }

    // Create new lock
    this._createNewAdoptionLock(quickTabId, reason);

    console.log('[ADOPTION][MinimizedManager] LOCK_ACQUIRED:', {
      quickTabId,
      reason,
      timestamp: new Date().toISOString()
    });

    return { acquired: true, wasForced: false };
  }

  /**
   * Release adoption lock for a Quick Tab
   * v1.6.3.10-v10 - FIX Issue #9/#11: Release lock after adoption completes
   * @param {string} quickTabId - Quick Tab ID
   */
  releaseAdoptionLock(quickTabId) {
    const lock = this._adoptionLocks.get(quickTabId);
    if (!lock) {
      console.log('[ADOPTION][MinimizedManager] LOCK_RELEASE_NOOP:', {
        quickTabId,
        reason: 'no lock held',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Clear timeouts
    if (lock.timeoutId) clearTimeout(lock.timeoutId);
    if (lock.warningTimeoutId) clearTimeout(lock.warningTimeoutId);

    // Resolve the promise
    if (lock.resolver) lock.resolver();

    // Remove the lock
    this._adoptionLocks.delete(quickTabId);

    const holdDuration = Date.now() - lock.timestamp;
    console.log('[ADOPTION][MinimizedManager] LOCK_RELEASED:', {
      quickTabId,
      holdDurationMs: holdDuration,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Force-release adoption lock (for timeout escalation)
   * v1.6.3.10-v10 - FIX Issue #11: Force-release stale locks
   * @private
   */
  _forceReleaseAdoptionLock(quickTabId) {
    const lock = this._adoptionLocks.get(quickTabId);
    if (!lock) return;

    // Clear timeouts
    if (lock.timeoutId) clearTimeout(lock.timeoutId);
    if (lock.warningTimeoutId) clearTimeout(lock.warningTimeoutId);

    // Resolve the promise
    if (lock.resolver) lock.resolver();

    // Remove the lock
    this._adoptionLocks.delete(quickTabId);
  }

  /**
   * Check if adoption lock is held for a Quick Tab
   * v1.6.3.10-v10 - FIX Issue #12: Check adoption state before ownership check
   * @param {string} quickTabId - Quick Tab ID
   * @returns {{isLocked: boolean, lockAge: number|null, reason: string|null}}
   */
  isAdoptionLocked(quickTabId) {
    const lock = this._adoptionLocks.get(quickTabId);
    if (!lock) {
      return { isLocked: false, lockAge: null, reason: null };
    }
    return {
      isLocked: true,
      lockAge: Date.now() - lock.timestamp,
      reason: lock.reason
    };
  }

  /**
   * Update snapshot's originTabId during adoption
   * v1.6.3.10-v10 - FIX Issue #10: Update snapshot when adoption occurs
   * @param {string} quickTabId - Quick Tab ID
   * @param {number} newOriginTabId - New owner tab ID
   * @returns {boolean} True if updated, false if snapshot not found
   */
  updateSnapshotOriginTabId(quickTabId, newOriginTabId) {
    const snapshot =
      this.minimizedTabs.get(quickTabId) || this.pendingClearSnapshots.get(quickTabId);
    if (!snapshot) {
      console.warn('[ADOPTION][MinimizedManager] UPDATE_ORIGIN_TAB_ID_FAILED:', {
        quickTabId,
        newOriginTabId,
        reason: 'snapshot not found',
        timestamp: new Date().toISOString()
      });
      return false;
    }

    const oldOriginTabId = snapshot.savedOriginTabId;
    snapshot.savedOriginTabId = newOriginTabId;

    console.log('[ADOPTION][MinimizedManager] UPDATE_ORIGIN_TAB_ID:', {
      quickTabId,
      oldOriginTabId,
      newOriginTabId,
      timestamp: new Date().toISOString()
    });

    return true;
  }

  /**
   * Cleanup stale adoption locks on startup
   * v1.6.3.10-v10 - FIX Issue #11: Clear any leftover locks from crashes/restarts
   */
  cleanupStaleAdoptionLocks() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [quickTabId, lock] of this._adoptionLocks.entries()) {
      const lockAge = now - lock.timestamp;
      if (lockAge >= ADOPTION_LOCK_TIMEOUT_MS) {
        this._forceReleaseAdoptionLock(quickTabId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log('[ADOPTION][MinimizedManager] STARTUP_CLEANUP:', {
        cleanedLocks: cleanedCount,
        timestamp: new Date().toISOString()
      });
    }
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

    // v1.6.3.11-v4 - FIX Issue #71: Mark volatile state as dirty for batched persistence
    this._markVolatileStateDirty();
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
   * v1.6.3.11-v4 - FIX Issue #71: Mark state dirty for batched persistence
   */
  remove(id) {
    const hadEntry = this.minimizedTabs.delete(id);
    console.log('[MinimizedManager] Removed minimized tab:', id);

    // v1.6.3.11-v4 - FIX Issue #71: Mark volatile state as dirty
    if (hadEntry) {
      this._markVolatileStateDirty();
    }
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
   * v1.6.4.15 - FIX Issue #17: Log restore attempts with timing for diagnostics
   * @param {string} id - Quick Tab ID
   * @returns {Object|boolean} Snapshot object with position/size, or false if not found
   */
  restore(id) {
    const restoreStartTime = Date.now();
    const restoreAttemptId = `restore-${id}-${restoreStartTime}`;

    // v1.6.4.15 - FIX Issue #17: Log restore attempt timing
    console.log('[RESTORE] Attempt started:', {
      quickTabId: id,
      attemptId: restoreAttemptId,
      timestamp: new Date().toISOString()
    });

    // v1.6.3.5 - FIX Issue #3: Check restore-in-progress lock
    const duplicateResult = this._handleDuplicateRestore(id);
    if (duplicateResult !== null) {
      console.log('[RESTORE] Attempt completed (duplicate):', {
        quickTabId: id,
        attemptId: restoreAttemptId,
        durationMs: Date.now() - restoreStartTime,
        result: 'duplicate'
      });
      return duplicateResult;
    }

    // Find snapshot from available sources
    const { snapshot, snapshotSource } = this._findSnapshot(id);
    if (!snapshot) {
      console.log('[RESTORE] Attempt completed (not found):', {
        quickTabId: id,
        attemptId: restoreAttemptId,
        durationMs: Date.now() - restoreStartTime,
        result: 'not-found'
      });
      return false;
    }

    // Set restore-in-progress lock
    this._setRestoreLock(id);

    // Move snapshot to pending (clear-on-first-use)
    this._moveSnapshotToPending(id, snapshot, snapshotSource);

    // Apply snapshot and verify
    const result = this._applyAndVerifySnapshot(id, snapshot, snapshotSource);

    // v1.6.4.15 - FIX Issue #17: Log restore completion with timing
    console.log('[RESTORE] Attempt completed (success):', {
      quickTabId: id,
      attemptId: restoreAttemptId,
      durationMs: Date.now() - restoreStartTime,
      result: 'success',
      snapshotSource
    });

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
    // v1.6.3.10-v10 - FIX Code Review: Use _findSnapshotById helper for consistency
    const snapshot = this._findSnapshotById(id);
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
      console.debug(
        '[MinimizedManager] 🔒 SNAPSHOT_LIFECYCLE: Expiration deferred (isRestoring=true):',
        {
          id,
          deferMs: DEFERRED_EXPIRATION_WAIT_MS
        }
      );
      // Reschedule expiration check after deferred wait
      this._snapshotExpirationTimeouts.delete(id);
      const deferredTimeoutId = setTimeout(() => {
        this._handleSnapshotExpiration(id);
      }, DEFERRED_EXPIRATION_WAIT_MS);
      this._snapshotExpirationTimeouts.set(id, deferredTimeoutId);
      return;
    }

    // Snapshot is not being restored - safe to expire
    console.warn(
      '[MinimizedManager] Snapshot expired (UICoordinator never called clearSnapshot):',
      {
        id,
        timeoutMs: PENDING_SNAPSHOT_EXPIRATION_MS
      }
    );
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

  /**
   * Find snapshot in either minimizedTabs or pendingClearSnapshots
   * v1.6.4.15 - FIX Code Review: Extracted to reduce duplication
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @returns {Object|null} Snapshot object or null
   */
  _findSnapshotInAllMaps(quickTabId) {
    return this.minimizedTabs.get(quickTabId) || this.pendingClearSnapshots.get(quickTabId) || null;
  }

  /**
   * Check if a snapshot exists and return its current originTabId
   * v1.6.4.15 - FIX Issue #22: Helper for adoption verification
   * @param {string} quickTabId - Quick Tab ID
   * @returns {number|null} Current savedOriginTabId or null if no snapshot
   */
  getSnapshotOriginTabId(quickTabId) {
    const snapshot = this._findSnapshotInAllMaps(quickTabId);

    if (!snapshot) {
      return null;
    }

    return snapshot.savedOriginTabId ?? null;
  }

  /**
   * Wait for adoption lock to be released if it exists
   * v1.6.3.10-v10 - FIX Issue 1.1: Helper for restore operations to wait
   * @param {string} quickTabId - Quick Tab ID
   * @returns {Promise<void>} Resolves when no lock exists or lock is released
   */
  async waitForAdoptionLock(quickTabId) {
    const existingLock = this._adoptionLocks.get(quickTabId);
    if (existingLock) {
      console.log('[MinimizedManager] Restore waiting for adoption lock:', {
        quickTabId,
        lockAge: Date.now() - existingLock.timestamp
      });
      await existingLock.promise;
    }
  }

  /**
   * Check if adoption lock is held (lightweight check)
   * v1.6.3.10-v10 - FIX Issue 1.1: Check if adoption is in progress
   * v1.6.3.10-v10 - FIX Code Review: Use lightweight Map.has() check for performance
   * @param {string} quickTabId - Quick Tab ID
   * @returns {boolean} True if lock is held
   */
  hasAdoptionLock(quickTabId) {
    return this._adoptionLocks.has(quickTabId);
  }

  // ==================== v1.6.3.11-v3 FIX ISSUE #30: STORAGE PERSISTENCE ====================

  /**
   * Storage key for persisting minimized Quick Tab state
   * v1.6.3.11-v3 - FIX Issue #30: Persist minimized state across background restarts
   * @type {string}
   */
  static STORAGE_KEY = 'minimized_quicktabs_v1';

  /**
   * Persist minimized state to storage
   * v1.6.3.11-v3 - FIX Issue #30: Save minimized state immediately after updates
   * @returns {Promise<boolean>} True if persistence succeeded
   */
  async persistToStorage() {
    try {
      const minimizedData = [];

      for (const [id, snapshot] of this.minimizedTabs) {
        minimizedData.push({
          id,
          savedPosition: snapshot.savedPosition,
          savedSize: snapshot.savedSize,
          savedOriginTabId: snapshot.savedOriginTabId,
          savedOriginContainerId: snapshot.savedOriginContainerId,
          // Don't persist window reference - it's not serializable
          // Don't persist isRestoring - it's transient state
        });
      }

      await browser.storage.session.set({
        [MinimizedManager.STORAGE_KEY]: {
          minimizedTabs: minimizedData,
          timestamp: Date.now(),
          version: 1
        }
      });

      console.log('[MinimizedManager] PERSIST_TO_STORAGE:', {
        minimizedCount: minimizedData.length,
        timestamp: Date.now()
      });

      return true;
    } catch (err) {
      console.error('[MinimizedManager] PERSIST_FAILED:', {
        error: err.message,
        minimizedCount: this.minimizedTabs.size
      });
      return false;
    }
  }

  /**
   * Restore minimized state from storage
   * v1.6.3.11-v3 - FIX Issue #30: Load minimized state on init after background restart
   * Note: This only restores metadata. Window references must be re-established separately.
   * @returns {Promise<{success: boolean, minimizedCount: number, timestamp?: number}>}
   */
  async restoreFromStorage() {
    try {
      const result = await browser.storage.session.get(MinimizedManager.STORAGE_KEY);
      const stored = result[MinimizedManager.STORAGE_KEY];

      if (!stored || !stored.minimizedTabs) {
        console.log('[MinimizedManager] RESTORE_FROM_STORAGE: No stored state found');
        return { success: false, minimizedCount: 0 };
      }

      // Note: We don't clear existing state - this allows merging with any tabs
      // that were already restored through other means
      const restoredCount = this._restoreMinimizedTabsFromData(stored.minimizedTabs);

      console.log('[MinimizedManager] RESTORE_FROM_STORAGE:', {
        restoredCount,
        totalMinimized: this.minimizedTabs.size,
        storedTimestamp: stored.timestamp,
        ageMs: Date.now() - stored.timestamp
      });

      return {
        success: true,
        minimizedCount: restoredCount,
        timestamp: stored.timestamp
      };
    } catch (err) {
      console.error('[MinimizedManager] RESTORE_FAILED:', {
        error: err.message
      });
      return { success: false, minimizedCount: 0 };
    }
  }

  /**
   * Helper to restore minimized tabs from stored data
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce restoreFromStorage complexity
   * @private
   * @param {Array} minimizedTabsData - Array of tab data from storage
   * @returns {number} Count of restored tabs
   */
  _restoreMinimizedTabsFromData(minimizedTabsData) {
    let restoredCount = 0;

    for (const tabData of minimizedTabsData) {
      // Skip if already tracked (from another restore path)
      if (this.minimizedTabs.has(tabData.id)) continue;

      const partialSnapshot = this._buildPartialSnapshot(tabData);
      this.minimizedTabs.set(tabData.id, partialSnapshot);
      restoredCount++;

      console.log('[MinimizedManager] RESTORE_TAB:', {
        id: tabData.id,
        position: partialSnapshot.savedPosition,
        size: partialSnapshot.savedSize,
        originTabId: partialSnapshot.savedOriginTabId
      });
    }

    return restoredCount;
  }

  /**
   * Build a partial snapshot from stored tab data
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce complexity
   * @private
   * @param {Object} tabData - Tab data from storage
   * @returns {Object} Partial snapshot object
   */
  _buildPartialSnapshot(tabData) {
    return {
      window: null, // Will be set by UICoordinator when rendering
      savedPosition: tabData.savedPosition || { left: DEFAULT_POSITION_LEFT, top: DEFAULT_POSITION_TOP },
      savedSize: tabData.savedSize || { width: DEFAULT_SIZE_WIDTH, height: DEFAULT_SIZE_HEIGHT },
      savedOriginTabId: tabData.savedOriginTabId ?? null,
      savedOriginContainerId: tabData.savedOriginContainerId ?? null,
      isRestoring: false
    };
  }

  /**
   * Update window reference in restored snapshot
   * v1.6.3.11-v3 - FIX Issue #30: After restoring from storage, link window reference
   * @param {string} id - Quick Tab ID
   * @param {Object} window - QuickTabWindow instance
   * @returns {boolean} True if updated
   */
  linkRestoredWindow(id, window) {
    const snapshot = this.minimizedTabs.get(id);
    if (!snapshot) {
      console.warn('[MinimizedManager] LINK_WINDOW_FAILED: No snapshot for:', id);
      return false;
    }

    if (snapshot.window !== null) {
      console.log('[MinimizedManager] LINK_WINDOW_SKIPPED: Already has window reference:', id);
      return false;
    }

    snapshot.window = window;
    console.log('[MinimizedManager] LINK_WINDOW_SUCCESS:', {
      id,
      hasWindow: !!snapshot.window
    });

    return true;
  }

  // ==================== END ISSUE #30 FIX ====================
}
