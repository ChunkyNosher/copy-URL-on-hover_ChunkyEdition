/**
 * @fileoverview DestroyHandler - Handles Quick Tab destruction and cleanup
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
 * v1.6.3.4 - FIX Bug #1: Persist to storage after destroy
 * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation and timeout
 * v1.6.3.4-v5 - FIX Bug #7 & #8: Atomic closure with debounced storage writes
 * v1.6.3.2 - FIX Issue #6: Add batch mode flag to prevent storage write storm during closeAll
 * v1.6.3.4 - FIX Issues #4, #6, #7: Add source tracking, consolidate all destroy logic
 * v1.6.3.5-v6 - FIX Diagnostic Issue #3: Add closeAll mutex to prevent duplicate executions
 * v1.6.3.5-v11 - FIX Issue #6: Notify background of deletions for immediate Manager update
 * v1.6.3.6-v5 - FIX Deletion Loop: Early return if ID already destroyed
 * v1.6.3.7 - FIX Issue #3: Add initiateDestruction() for unified deletion path
 * v1.6.3.8-v8 - FIX Issue #2: Pass forceEmpty=true when state becomes empty after destroy
 * v1.6.3.8-v8 - FIX Issue #11: REMOVED write-ahead log (dead code that was never consulted)
 * v1.6.3.8-v9 - FIX Issue #14: Emit statedeleted event BEFORE deleting from Map
 *               This ensures UICoordinator receives event while tab still exists in renderedTabs
 * v1.6.3.8-v9 - FIX Issue #16: Proper persist control flow with retry logic
 *               - forceEmpty check now skips persist call entirely when blocked
 *               - Failed persists are queued for retry during next storage.onChanged cycle
 *               - Explicit deletion persistence state tracking
 * v1.6.3.8-v9 - FIX Issue #21: Enhanced initialization logging
 *               - Explicit timestamps at all initialization steps
 *               - Handler readiness state changes logged
 *               - Persist operations logged with success/failure/retry status
 *
 * Responsibilities:
 * - Handle single Quick Tab destruction
 * - Close Quick Tabs via closeById (calls tab.destroy())
 * - Unified destruction via initiateDestruction() (cross-tab sync)
 * - Close all Quick Tabs via closeAll (with mutex protection)
 * - Cleanup minimized manager references
 * - Reset z-index when all tabs closed
 * - Emit destruction events
 * - Notify background of deletions for Manager sidebar update
 * - Persist state to storage after destruction (debounced to prevent write storms)
 * - Log all destroy operations with source indication
 * - Prevent deletion loops via _destroyedIds tracking
 * - Retry failed persists automatically (v1.6.3.8-v9)
 *
 * @version 1.6.3.8-v9
 */

import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '@utils/dom.js';
import { buildStateForStorage, persistStateToStorage } from '@utils/storage-utils.js';

// v1.6.3.8-v6 - ARCHITECTURE: BroadcastChannel COMPLETELY REMOVED
// All BC imports and functions removed per user request - Port + storage.onChanged only

// v1.6.3.4-v5 - FIX Bug #8: Debounce delay for storage writes (ms)
const STORAGE_DEBOUNCE_DELAY = 150;

// v1.6.3.5-v6 - FIX Diagnostic Issue #3: Cooldown for closeAll mutex (ms)
const CLOSE_ALL_COOLDOWN_MS = 2000;

// v1.6.3.8-v9 - FIX Issue #16: Retry delay for failed persists (ms)
const PERSIST_RETRY_DELAY_MS = 500;

// v1.6.3.8-v9 - FIX Issue #16: Maximum retry attempts for failed persists
const PERSIST_MAX_RETRIES = 3;

/**
 * v1.6.4.8 - Issue #5: Generate simple checksum for state verification
 * @param {Object} state - State object to checksum
 * @returns {string} Checksum string
 */
function generateStateChecksum(state) {
  if (!state || !state.tabs) return 'empty';
  // Simple checksum: tab count + first and last IDs + timestamp
  const tabCount = state.tabs.length;
  const firstId = state.tabs[0]?.id || 'none';
  const lastId = state.tabs[state.tabs.length - 1]?.id || 'none';
  const timestamp = state.timestamp || 0;
  return `${tabCount}:${firstId}:${lastId}:${timestamp}`;
}

/**
 * Determine if forceEmpty should be set for a storage write
 * v1.6.3.8-v8 - Issue #2: Extracted to reduce duplication between persistence methods
 * @param {Object} state - State object to check
 * @returns {boolean} True if forceEmpty should be passed
 */
function _shouldForceEmptyWrite(state) {
  const tabCount = state?.tabs?.length || 0;
  return tabCount === 0;
}

/**
 * DestroyHandler class
 * Manages Quick Tab destruction and cleanup operations (local only, no cross-tab sync)
 * v1.6.3.4 - Now persists state to storage after destruction
 * v1.6.3.4-v5 - FIX Bug #7 & #8: Atomic closure with debounced storage writes
 * v1.6.3.2 - FIX Issue #6: Batch mode to prevent storage write storm during closeAll
 * v1.6.3.5-v6 - FIX Diagnostic Issue #3: closeAll mutex to prevent duplicate executions
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
  constructor(quickTabsMap, minimizedManager, eventBus, currentZIndex, Events, baseZIndex) {
    this.quickTabsMap = quickTabsMap;
    this.minimizedManager = minimizedManager;
    this.eventBus = eventBus;
    this.currentZIndex = currentZIndex;
    this.Events = Events;
    this.baseZIndex = baseZIndex;

    // v1.6.3.4-v5 - FIX Bug #8: Debounce timer for storage writes
    this._storageDebounceTimer = null;

    // v1.6.3.4-v5 - FIX Bug #7: Track destroyed IDs to prevent resurrection
    this._destroyedIds = new Set();

    // v1.6.3.4-v10 - FIX Issue #6: Replace boolean _batchMode with Set tracking specific operation IDs
    // The boolean flag was vulnerable to timer interleaving: if a timer from an earlier
    // minimize operation fires during closeAll(), it would incorrectly skip persist because
    // _batchMode was true for the unrelated closeAll() operation.
    // Now each operation checks if its specific ID is in the batch Set.
    this._batchOperationIds = new Set();

    // v1.6.3.5-v6 - FIX Diagnostic Issue #3: Mutex flag to prevent closeAll duplicate execution
    this._closeAllInProgress = false;
    this._closeAllCooldownTimer = null;

    // v1.6.3.8-v9 - FIX Issue #16: Pending persists queue for retry logic
    // Failed persists are queued and retried automatically
    this._pendingPersists = [];
    this._retryTimer = null;

    // v1.6.3.8-v9 - FIX Issue #16: Track which deletions have been successfully persisted
    // This allows explicit confirmation that a deletion reached storage
    this._persistedDeletions = new Set();

    // v1.6.3.8-v9 - FIX Issue #21: Track handler initialization state
    this._isInitialized = false;
    this._initTimestamp = Date.now();
    console.log('[DestroyHandler] INIT_STEP_1: Constructor called:', {
      timestamp: this._initTimestamp,
      handlersReady: false
    });

    // v1.6.3.8-v8 - FIX Issue #11: REMOVED write-ahead log (dead code)
    // The WAL was created but never consulted - actual protection comes from _destroyedIds Set
    // Reference: docs/manual/1.6.4/quick-tabs-supplementary-issues.md Issue #11
  }

  /**
   * Mark handler as initialized and ready
   * v1.6.3.8-v9 - FIX Issue #21: Explicit initialization tracking
   */
  markInitialized() {
    this._isInitialized = true;
    const initDuration = Date.now() - this._initTimestamp;
    console.log('[DestroyHandler] INIT_COMPLETE: Handler marked as initialized:', {
      timestamp: Date.now(),
      initDurationMs: initDuration,
      pendingPersists: this._pendingPersists.length,
      destroyedIds: this._destroyedIds.size
    });
  }

  /**
   * Handle Quick Tab destruction
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.2 - FIX Bug #4: Emit state:deleted for panel sync
   * v1.6.3.4 - FIX Bug #1: Persist to storage after destroy
   * v1.6.3.4-v5 - FIX Bug #7: Track destroyed IDs to prevent resurrection
   * v1.6.3.2 - FIX Issue #6: Skip persistence when in batch mode (closeAll)
   * v1.6.3.4 - FIX Issues #4, #6, #7: Add source parameter, enhanced logging
   * v1.6.3.4-v10 - FIX Issue #6: Check batch Set membership instead of boolean flag
   * v1.6.4.8 - Issue #5: Write-ahead logging before Map deletion, immediate persist for single destroys
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', 'automation', 'background')
   */
  handleDestroy(id, source = 'unknown') {
    // v1.6.3.6-v5 - FIX Deletion Loop: Early return if already destroyed
    // This prevents the loop: UICoordinator.destroy() → state:deleted → DestroyHandler → loop
    if (this._destroyedIds.has(id)) {
      console.log(`[DestroyHandler] SKIPPED: ID already destroyed (source: ${source}):`, id);
      return;
    }

    // v1.6.3.4 - FIX Issue #6: Log with source indication
    const destroyStartTime = Date.now();
    console.log(`[DestroyHandler] Handling destroy for: ${id} (source: ${source}):`, {
      timestamp: destroyStartTime
    });

    // v1.6.3.8-v8 - FIX Issue #11: REMOVED write-ahead log entry creation (dead code)
    // The WAL was never consulted - _destroyedIds Set provides the actual protection

    // v1.6.3.4-v5 - FIX Bug #7: Mark as destroyed FIRST to prevent resurrection
    this._destroyedIds.add(id);

    // Get tab info BEFORE deleting (needed for state:deleted event)
    const tabWindow = this.quickTabsMap.get(id);

    // v1.6.3.4 - FIX Issue #5: Log if tab not found in Map
    if (!tabWindow) {
      console.warn(`[DestroyHandler] Tab not found in Map (source: ${source}):`, id);
    }

    // v1.6.3.8-v9 - FIX Issue #14: Emit state:deleted BEFORE Map.delete()
    // This ensures UICoordinator receives event while tab still exists in renderedTabs Map
    // Previous order caused "Tab not found for destruction" warnings in UICoordinator
    const emitTimestamp = Date.now();
    console.log(`[DestroyHandler] Emitting state:deleted BEFORE Map.delete (source: ${source}):`, {
      id,
      tabWindowExists: !!tabWindow,
      timestamp: emitTimestamp
    });

    // Emit destruction event (legacy)
    this._emitDestructionEvent(id);

    // v1.6.3.2 - FIX Bug #4: Emit state:deleted for PanelContentManager to update
    // v1.6.3.8-v9 - MOVED UP: Now emits BEFORE Map.delete() per Issue #14
    this._emitStateDeletedEvent(id, tabWindow, source);

    // v1.6.3.8-v9 - FIX Issue #14: NOW delete from Map (after event emission)
    // v1.6.3.4-v5 - FIX Bug #7: Atomic cleanup - delete from ALL references
    // v1.6.3.4 - FIX Issue #5: Log Map deletion
    const wasInMap = this.quickTabsMap.delete(id);
    const deleteTimestamp = Date.now();
    console.log(`[DestroyHandler] Map.delete result (source: ${source}):`, {
      id,
      wasInMap,
      timestamp: deleteTimestamp
    });

    this.minimizedManager.remove(id);

    // v1.6.3.4-v5 - FIX Bug #7: Use shared utility for DOM cleanup
    if (removeQuickTabElement(id)) {
      console.log(`[DestroyHandler] Removed DOM element (source: ${source}):`, id);
    }

    // Reset z-index if all tabs are closed
    this._resetZIndexIfEmpty();

    // v1.6.3.4-v10 - FIX Issue #6: Check if this specific ID is in batch mode (Set membership)
    // This replaces the boolean _batchMode flag which was vulnerable to timer interleaving.
    // Only skip persist if THIS specific ID was added to the batch Set by closeAll().
    if (this._batchOperationIds.has(id)) {
      console.log(
        `[DestroyHandler] Batch mode - skipping individual persist (source: ${source}):`,
        {
          id,
          batchSetSize: this._batchOperationIds.size
        }
      );
      return;
    }

    // v1.6.4.8 - Issue #5: For single destroys, persist IMMEDIATELY (no debounce)
    // This eliminates the 150ms window where state is inconsistent
    console.log(`[DestroyHandler] Single destroy - immediate persist (source: ${source}):`, id);
    this._persistToStorageImmediate(id);

    console.log(`[DestroyHandler] Destroy complete (source: ${source}):`, {
      id,
      durationMs: Date.now() - destroyStartTime
    });
  }

  /**
   * Check if a Quick Tab ID was recently destroyed
   * v1.6.3.4-v5 - FIX Bug #7: Used to prevent resurrection during DOM scans
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if recently destroyed
   */
  wasRecentlyDestroyed(id) {
    return this._destroyedIds.has(id);
  }

  /**
   * Clear destroyed IDs tracking (call periodically to prevent memory leak)
   * v1.6.3.4-v5 - FIX Bug #7: Cleanup destroyed IDs set
   */
  clearDestroyedTracking() {
    this._destroyedIds.clear();
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
   * v1.6.3.4 - FIX Issue #6: Add source to event data
   * v1.6.3.5-v11 - FIX Issue #6: Also notify background for Manager sidebar update
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - Quick Tab window instance (may be undefined)
   * @param {string} source - Source of action ('UI', 'Manager', etc.)
   */
  _emitStateDeletedEvent(id, tabWindow, source = 'unknown') {
    if (!this.eventBus) return;

    // Build quickTabData - only include url/title if tabWindow exists
    const quickTabData = tabWindow
      ? { id, url: tabWindow.url, title: tabWindow.title, source }
      : { id, source };

    this.eventBus.emit('state:deleted', { id, quickTab: quickTabData, source });
    console.log(`[DestroyHandler] Emitted state:deleted (source: ${source}):`, id);

    // v1.6.3.5-v11 - FIX Issue #6: Notify background about deletion for Manager update
    // This ensures the Manager sidebar gets immediate notification, not just via storage.onChanged
    this._notifyBackgroundOfDeletion(id, source).catch(err => {
      console.warn(
        `[DestroyHandler] Failed to notify background (source: ${source}):`,
        err.message
      );
    });
  }

  /**
   * Notify background about Quick Tab deletion
   * v1.6.3.5-v11 - FIX Issue #6: Send message to background for immediate Manager update
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action
   * @returns {Promise<void>}
   */
  async _notifyBackgroundOfDeletion(id, source) {
    // v1.6.3.8-v7 - Issue #9: Generate correlationId for deletion tracing
    const correlationId = `op-${Date.now()}-${id.substring(0, 8)}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      await browser.runtime.sendMessage({
        type: 'QUICK_TAB_STATE_CHANGE',
        quickTabId: id,
        changes: { deleted: true },
        source: source || 'destroy',
        // v1.6.3.8-v7 - Issue #9: Include correlationId for tracing
        correlationId,
        // v1.6.3.8-v7 - Issue #12: Include clientTimestamp for ordering
        clientTimestamp: Date.now()
      });
      console.log(`[DestroyHandler] Notified background of deletion (source: ${source}):`, {
        id,
        correlationId
      });
    } catch (err) {
      // Background may not be available - this is expected in some edge cases
      console.debug('[DestroyHandler] Could not notify background:', {
        id,
        correlationId,
        error: err.message
      });
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
   * Debounced persist to storage
   * v1.6.3.4-v5 - FIX Bug #8: Prevents storage write storms (8 writes in 38ms)
   * v1.6.4.8 - Issue #5: Only used for closeAll batch operations now
   * @private
   */
  _debouncedPersistToStorage() {
    // Clear existing timer
    if (this._storageDebounceTimer) {
      clearTimeout(this._storageDebounceTimer);
    }

    // Set new debounced timer
    this._storageDebounceTimer = setTimeout(() => {
      this._storageDebounceTimer = null;
      this._persistToStorage();
    }, STORAGE_DEBOUNCE_DELAY);
  }

  /**
   * Persist to storage immediately with checksum verification
   * v1.6.4.8 - Issue #5: Immediate persist for single destroys with write-ahead log update
   * v1.6.3.8-v8 - Issue #2: Pass forceEmpty=true when state becomes empty after destroy
   * v1.6.3.8-v9 - FIX Issue #16: Proper control flow - skip persist when blocked, retry on failure
   * v1.6.3.8-v9 - FIX Issue #21: Enhanced logging with timestamps and persist status tracking
   * @private
   * @param {string} deletedId - ID that was deleted (for tracking)
   */
  async _persistToStorageImmediate(deletedId) {
    const persistStartTime = Date.now();
    console.log('[DestroyHandler] PERSIST_START: Beginning immediate persist:', {
      deletedId,
      timestamp: persistStartTime,
      pendingPersists: this._pendingPersists.length
    });

    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);

    if (!state) {
      console.error('[DestroyHandler] PERSIST_BLOCKED: Failed to build state for immediate storage:', {
        deletedId,
        timestamp: Date.now(),
        reason: 'buildStateForStorage returned null'
      });
      // v1.6.3.8-v9 - FIX Issue #16: Queue for retry
      this._schedulePersistRetry(deletedId, 'state-build-failed');
      return;
    }

    // v1.6.4.8 - Issue #5: Generate checksum BEFORE write
    const checksumBefore = generateStateChecksum(state);
    const tabCount = state.tabs?.length || 0;
    
    // v1.6.3.8-v8 - FIX Issue #2: Use shared helper to determine forceEmpty
    const forceEmpty = _shouldForceEmptyWrite(state);
    
    console.log('[DestroyHandler] PERSIST_CHECKSUM: Checksum BEFORE storage write:', {
      checksum: checksumBefore,
      tabCount,
      deletedId,
      forceEmpty,
      timestamp: Date.now()
    });

    // v1.6.3.8-v9 - FIX Issue #16: Attempt persist with proper error handling
    let success = false;
    try {
      success = await persistStateToStorage(state, '[DestroyHandler]', forceEmpty);
    } catch (err) {
      console.error('[DestroyHandler] PERSIST_ERROR: Storage persist threw exception:', {
        deletedId,
        error: err.message,
        timestamp: Date.now()
      });
      // v1.6.3.8-v9 - FIX Issue #16: Queue for retry on exception
      this._schedulePersistRetry(deletedId, 'persist-exception');
      return;
    }

    if (!success) {
      console.error('[DestroyHandler] PERSIST_FAILED: Immediate storage persist failed:', {
        deletedId,
        timestamp: Date.now(),
        willRetry: true
      });
      // v1.6.3.8-v9 - FIX Issue #16: Queue for retry on failure
      this._schedulePersistRetry(deletedId, 'persist-returned-false');
      return;
    }

    // v1.6.4.8 - Issue #5: Verify checksum AFTER write by re-reading
    await this._verifyStorageChecksum(checksumBefore, state, deletedId);
    
    // v1.6.3.8-v9 - FIX Issue #16: Mark deletion as successfully persisted
    this._persistedDeletions.add(deletedId);
    
    const persistDuration = Date.now() - persistStartTime;
    console.log('[DestroyHandler] PERSIST_SUCCESS: Storage persist complete:', {
      deletedId,
      durationMs: persistDuration,
      timestamp: Date.now(),
      persistedDeletionsCount: this._persistedDeletions.size
    });
  }

  /**
   * Verify storage checksum after write by re-reading from storage
   * v1.6.3.8-v4 - Extracted to reduce nesting depth (max-depth lint rule)
   * @private
   * @param {string} checksumBefore - Checksum before write
   * @param {Object} state - State that was written
   * @param {string} deletedId - ID of deleted tab
   */
  async _verifyStorageChecksum(checksumBefore, state, deletedId) {
    try {
      const result = await browser.storage.local.get('quick_tabs_state_v2');
      const storedState = result.quick_tabs_state_v2;
      const checksumAfter = generateStateChecksum(storedState);

      if (checksumBefore !== checksumAfter) {
        console.error('[DestroyHandler] ⚠️ Checksum MISMATCH after storage write:', {
          checksumBefore,
          checksumAfter,
          deletedId,
          expectedTabCount: state.tabs?.length || 0,
          actualTabCount: storedState?.tabs?.length || 0
        });
        return;
      }
      console.log('[DestroyHandler] ✓ Checksum verified AFTER storage write:', {
        checksum: checksumAfter,
        deletedId
      });
    } catch (verifyErr) {
      console.warn('[DestroyHandler] Failed to verify storage checksum:', verifyErr.message);
    }
  }

  /**
   * v1.6.3.8-v8 - FIX Issue #11: REMOVED _updateWriteAheadLogAfterPersist function
   * The write-ahead log was never consulted - it was dead code.
   * _destroyedIds Set provides the actual deletion protection.
   */

  /**
   * Persist current state to browser.storage.local
   * v1.6.3.4 - FIX Bug #1: Persist to storage after destroy
   * v1.6.3.4-v2 - FIX Bug #1: Proper async handling with validation
   * v1.6.3.8-v8 - FIX Issue #2: Pass forceEmpty=true when state becomes empty
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   * @returns {Promise<void>}
   */
  async _persistToStorage() {
    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);

    // v1.6.3.4-v2 - FIX Bug #1: Handle null state from validation failure
    if (!state) {
      console.error('[DestroyHandler] Failed to build state for storage');
      return;
    }

    const tabCount = state.tabs?.length || 0;
    
    // v1.6.3.8-v8 - FIX Issue #2: Use shared helper to determine forceEmpty
    const forceEmpty = _shouldForceEmptyWrite(state);
    
    console.debug('[DestroyHandler] Persisting state with', tabCount, 'tabs', { forceEmpty });
    const success = await persistStateToStorage(state, '[DestroyHandler]', forceEmpty);
    if (!success) {
      console.error('[DestroyHandler] Storage persist failed or timed out');
    }
  }

  /**
   * Schedule a retry for failed persist operations
   * v1.6.3.8-v9 - FIX Issue #16: Retry logic for failed persists
   * @private
   * @param {string} tabId - Tab ID that was deleted
   * @param {string} reason - Reason for the retry
   */
  _schedulePersistRetry(tabId, reason) {
    const retryEntry = {
      tabId,
      reason,
      retryCount: 0,
      createdAt: Date.now()
    };

    // Check if already in queue
    const existingIndex = this._pendingPersists.findIndex(p => p.tabId === tabId);
    if (existingIndex >= 0) {
      // Update retry count
      this._pendingPersists[existingIndex].retryCount++;
      console.log('[DestroyHandler] PERSIST_RETRY_UPDATE: Existing retry entry updated:', {
        tabId,
        retryCount: this._pendingPersists[existingIndex].retryCount,
        timestamp: Date.now()
      });
    } else {
      // Add to queue
      this._pendingPersists.push(retryEntry);
      console.log('[DestroyHandler] PERSIST_RETRY_QUEUED: New retry entry added:', {
        tabId,
        reason,
        queueLength: this._pendingPersists.length,
        timestamp: Date.now()
      });
    }

    // v1.6.3.8-v9 - Code Review Fix: Use atomic check-and-set for timer to prevent race condition
    // Double-check pattern: if timer already exists, skip; otherwise set it atomically
    if (this._retryTimer === null) {
      // Set timer immediately to prevent concurrent calls from creating multiple timers
      const newTimer = setTimeout(() => {
        this._processRetryQueue();
      }, PERSIST_RETRY_DELAY_MS);
      
      // Only assign if still null (in case another call beat us)
      if (this._retryTimer === null) {
        this._retryTimer = newTimer;
        console.log('[DestroyHandler] PERSIST_RETRY_SCHEDULED: Retry timer set:', {
          delayMs: PERSIST_RETRY_DELAY_MS,
          timestamp: Date.now()
        });
      } else {
        // Another call already set a timer, cancel this one
        clearTimeout(newTimer);
      }
    }
  }

  /**
   * Process the pending persists retry queue
   * v1.6.3.8-v9 - FIX Issue #16: Process all pending retries
   * @private
   */
  async _processRetryQueue() {
    this._retryTimer = null;
    const retryStartTime = Date.now();

    if (this._pendingPersists.length === 0) {
      console.log('[DestroyHandler] PERSIST_RETRY_EMPTY: No pending retries to process');
      return;
    }

    console.log('[DestroyHandler] PERSIST_RETRY_START: Processing retry queue:', {
      queueLength: this._pendingPersists.length,
      timestamp: retryStartTime
    });

    // Process all pending retries
    const pendingCopy = [...this._pendingPersists];
    this._pendingPersists = [];

    let successCount = 0;
    let failureCount = 0;
    let droppedCount = 0;

    for (const entry of pendingCopy) {
      // Check if max retries exceeded
      if (entry.retryCount >= PERSIST_MAX_RETRIES) {
        console.warn('[DestroyHandler] PERSIST_RETRY_DROPPED: Max retries exceeded:', {
          tabId: entry.tabId,
          retryCount: entry.retryCount,
          maxRetries: PERSIST_MAX_RETRIES,
          timestamp: Date.now()
        });
        droppedCount++;
        continue;
      }

      // Attempt to persist current state (will include all pending deletions)
      const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);
      if (!state) {
        // v1.6.3.8-v9 - Code Review Fix: Clone entry before re-queuing to avoid race conditions
        const retriedEntry = { ...entry, retryCount: entry.retryCount + 1 };
        this._pendingPersists.push(retriedEntry);
        failureCount++;
        continue;
      }

      const forceEmpty = _shouldForceEmptyWrite(state);
      const success = await persistStateToStorage(state, '[DestroyHandler-Retry]', forceEmpty);

      if (success) {
        // Mark all related deletions as persisted
        this._persistedDeletions.add(entry.tabId);
        successCount++;
        console.log('[DestroyHandler] PERSIST_RETRY_SUCCESS: Retry succeeded:', {
          tabId: entry.tabId,
          retryCount: entry.retryCount,
          timestamp: Date.now()
        });
      } else {
        // v1.6.3.8-v9 - Code Review Fix: Clone entry before re-queuing to avoid race conditions
        const retriedEntry = { ...entry, retryCount: entry.retryCount + 1 };
        this._pendingPersists.push(retriedEntry);
        failureCount++;
      }
    }

    console.log('[DestroyHandler] PERSIST_RETRY_COMPLETE:', {
      successCount,
      failureCount,
      droppedCount,
      remainingInQueue: this._pendingPersists.length,
      durationMs: Date.now() - retryStartTime,
      timestamp: Date.now()
    });

    // If there are still pending retries, schedule another timer
    if (this._pendingPersists.length > 0 && !this._retryTimer) {
      this._retryTimer = setTimeout(() => {
        this._processRetryQueue();
      }, PERSIST_RETRY_DELAY_MS);
      console.log('[DestroyHandler] PERSIST_RETRY_RESCHEDULED: More retries pending:', {
        queueLength: this._pendingPersists.length,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Check if a deletion was successfully persisted to storage
   * v1.6.3.8-v9 - FIX Issue #16: Explicit deletion persistence tracking
   * @param {string} tabId - Tab ID to check
   * @returns {boolean} True if deletion was persisted
   */
  isDeletionPersisted(tabId) {
    return this._persistedDeletions.has(tabId);
  }

  /**
   * Get count of pending persist retries
   * v1.6.3.8-v9 - FIX Issue #16: For diagnostics
   * @returns {number} Number of pending retries
   */
  getPendingPersistCount() {
    return this._pendingPersists.length;
  }

  /**
   * Close Quick Tab by ID (calls tab.destroy() method)
   * v1.6.3.4 - FIX Issue #6: Add source parameter for logging
   *
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of action ('UI', 'Manager', etc.)
   */
  closeById(id, source = 'Manager') {
    console.log(`[DestroyHandler] closeById called (source: ${source}):`, id);
    const tabWindow = this.quickTabsMap.get(id);
    if (tabWindow && tabWindow.destroy) {
      tabWindow.destroy();
    } else {
      // v1.6.3.4 - FIX Issue #5: Tab not found, but still clean up Map/storage
      console.warn(`[DestroyHandler] Tab not found for closeById (source: ${source}):`, id);
      // Still call handleDestroy to clean up any orphaned state
      this.handleDestroy(id, source);
    }
  }

  /**
   * Unified entry point for Quick Tab destruction
   * v1.6.3.7 - FIX Issue #3: Unify UI and Manager deletion paths
   *
   * This method provides a single authoritative deletion path that both UI button
   * and Manager close button should use. It ensures:
   * 1. Local cleanup via handleDestroy()
   * 2. Background notification for cross-tab sync (with broadcast flag)
   * 3. Storage persistence
   *
   * @param {string} id - Quick Tab ID to destroy
   * @param {string} source - Source of action ('UI', 'Manager', 'background', etc.)
   * @param {boolean} broadcast - Whether to broadcast deletion to other tabs (default: true)
   * @returns {Promise<void>}
   */
  async initiateDestruction(id, source = 'unknown', broadcast = true) {
    console.log(
      `[DestroyHandler] initiateDestruction (source: ${source}, broadcast: ${broadcast}):`,
      id
    );

    // v1.6.3.7 - Check if already destroyed to prevent duplicate processing
    if (this._destroyedIds.has(id)) {
      console.log('[DestroyHandler] initiateDestruction SKIPPED - already destroyed:', id);
      return;
    }

    // Step 1: Local cleanup - handleDestroy handles Map, minimizedManager, DOM, and events
    // Note: handleDestroy also calls _notifyBackgroundOfDeletion and _debouncedPersistToStorage
    this.handleDestroy(id, source);

    // Step 2: If broadcast flag is true, explicitly request cross-tab broadcast
    // This is redundant with handleDestroy's _notifyBackgroundOfDeletion, but ensures
    // the broadcast flag is honored for cases where we need to suppress cross-tab sync
    if (broadcast) {
      await this._requestCrossTabBroadcast(id, source);
    }

    console.log(`[DestroyHandler] initiateDestruction complete (source: ${source}):`, id);
  }

  /**
   * Request cross-tab broadcast of deletion via background script
   * v1.6.3.7 - FIX Issue #3: Explicit cross-tab broadcast request
   * v1.6.3.8-v7 - Issue #9: Include correlationId for tracing
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} source - Source of deletion
   * @returns {Promise<void>}
   */
  async _requestCrossTabBroadcast(id, source) {
    // v1.6.3.8-v7 - Issue #9: Generate correlationId for cross-tab broadcast tracing
    const correlationId = `op-${Date.now()}-${id.substring(0, 8)}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      await browser.runtime.sendMessage({
        type: 'QUICK_TAB_STATE_CHANGE',
        quickTabId: id,
        changes: { deleted: true },
        source: source || 'destroy',
        requestBroadcast: true, // Explicit flag to request cross-tab broadcast
        // v1.6.3.8-v7 - Issue #9: Include correlationId for tracing
        correlationId,
        // v1.6.3.8-v7 - Issue #12: Include clientTimestamp for ordering
        clientTimestamp: Date.now()
      });
      console.log(
        `[DestroyHandler] Requested cross-tab broadcast for deletion (source: ${source}):`,
        {
          id,
          correlationId
        }
      );
    } catch (err) {
      // Background may not be available
      console.debug('[DestroyHandler] Could not request cross-tab broadcast:', {
        id,
        correlationId,
        error: err.message
      });
    }
  }

  /**
   * Schedule mutex release after cooldown
   * v1.6.3.5-v6 - Extracted to improve readability (per code review)
   * @private
   */
  _scheduleMutexRelease() {
    if (this._closeAllCooldownTimer) {
      clearTimeout(this._closeAllCooldownTimer);
    }
    this._closeAllCooldownTimer = setTimeout(() => {
      this._closeAllInProgress = false;
      this._closeAllCooldownTimer = null;
      console.log(
        `[DestroyHandler] closeAll mutex released after ${CLOSE_ALL_COOLDOWN_MS}ms cooldown`
      );
    }, CLOSE_ALL_COOLDOWN_MS);
  }

  /**
   * Close all Quick Tabs
   * v1.6.3.4 - FIX Bug #1: Persist to storage after close all
   * v1.6.3.4-v4 - FIX Issue #3: Emit state:cleared event for UICoordinator reconciliation
   * v1.6.3.4-v5 - FIX Bug #7: Track all destroyed IDs atomically, use shared cleanup utility
   * v1.6.3.2 - FIX Issue #6: Use batch mode to prevent storage write storm (6+ writes in 24ms)
   * v1.6.3.4 - FIX Issue #7: Enhanced logging throughout closeAll
   * v1.6.3.4-v10 - FIX Issue #6: Use Set of operation IDs instead of boolean flag
   *   The boolean was vulnerable to timer interleaving from earlier operations.
   *   Now each ID is tracked individually in _batchOperationIds Set.
   * v1.6.3.5-v6 - FIX Diagnostic Issue #3: Add mutex to prevent duplicate executions
   *   Problem: closeAll() was executing 2-3 times per button click
   *   Fix: Add _closeAllInProgress flag with 2000ms cooldown
   * Calls destroy() on each tab, clears map, clears minimized manager, resets z-index
   *
   * @param {string} source - Source of action ('UI', 'Manager', etc.)
   */
  closeAll(source = 'Manager') {
    // v1.6.3.5-v6 - FIX Diagnostic Issue #3: Check mutex to prevent duplicate execution
    if (this._closeAllInProgress) {
      console.warn(`[DestroyHandler] closeAll BLOCKED (mutex held, source: ${source})`);
      return;
    }

    // v1.6.3.5-v6 - Acquire mutex
    this._closeAllInProgress = true;
    console.log(`[DestroyHandler] Closing all Quick Tabs (source: ${source}) - mutex acquired`);

    // v1.6.3.5-v6 - Schedule mutex release with cooldown (extracted per code review)
    this._scheduleMutexRelease();

    const count = this.quickTabsMap.size;

    // v1.6.3.4-v10 - FIX Issue #6: Add all IDs to batch Set BEFORE destroy loop
    // This ensures handleDestroy() checks for membership correctly
    for (const id of this.quickTabsMap.keys()) {
      this._batchOperationIds.add(id);
    }
    console.log(`[DestroyHandler] Added ${count} IDs to batch Set (source: ${source}):`, {
      batchSetSize: this._batchOperationIds.size,
      ids: Array.from(this._batchOperationIds)
    });

    // v1.6.3.4-v5 - FIX Bug #7: Track all IDs being destroyed
    for (const id of this.quickTabsMap.keys()) {
      this._destroyedIds.add(id);
      console.log(`[DestroyHandler] Marked for destruction (source: ${source}):`, id);
    }

    // Destroy all tabs - each destroy() call will skip storage persist due to batch Set
    for (const tabWindow of this.quickTabsMap.values()) {
      if (tabWindow.destroy) {
        tabWindow.destroy();
      }
    }

    // Clear everything
    this.quickTabsMap.clear();
    console.log(`[DestroyHandler] Map cleared (source: ${source})`);

    this.minimizedManager.clear();
    console.log(`[DestroyHandler] MinimizedManager cleared (source: ${source})`);

    this.currentZIndex.value = this.baseZIndex;

    // v1.6.3.4-v5 - FIX Bug #7: Use shared utility to clean up ALL .quick-tab-window elements
    const removedCount = cleanupOrphanedQuickTabElements(null);
    if (removedCount > 0) {
      console.log(`[DestroyHandler] Removed ${removedCount} DOM element(s) (source: ${source})`);
    }

    // v1.6.3.4-v4 - FIX Issue #3: Emit state:cleared for UICoordinator to reconcile
    // This removes any orphaned windows that may exist in renderedTabs but not StateManager
    if (this.eventBus) {
      this.eventBus.emit('state:cleared', { count, source });
      console.log(`[DestroyHandler] Emitted state:cleared (source: ${source}):`, count);
    }

    // v1.6.3.4-v10 - FIX Issue #6: Clear batch Set after all cleanup is complete
    this._batchOperationIds.clear();
    console.log(`[DestroyHandler] Cleared batch Set after closeAll (source: ${source})`);

    // v1.6.3.2 - FIX Issue #6: Single atomic storage write after all cleanup
    // This replaces 6+ individual writes with 1 write
    console.log(
      `[DestroyHandler] closeAll complete (source: ${source}) - performing single atomic storage write`
    );
    this._persistToStorage();
  }
}
