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
 * v1.6.3.12-v4 - FIX Issue #8: Add debounce timing validation logging
 *   - Log debounce trigger with scheduled delay
 *   - Track and log rapid events during debounce window
 *   - Log prevented write operations count on completion
 *   - Validate scheduled vs actual delay timing
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
 * @version 1.6.3.12-v4
 */

import {
  buildStateForStorage,
  persistStateToStorage,
  getStorageCoordinator // v1.6.3.12 - FIX Issue #14: Centralized write coordination
} from '@utils/storage-utils.js';

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

    // v1.6.3.12-v4 - FIX Issue #8: Debounce event tracking for validation logging
    this._debounceEventCounts = {}; // { key -> eventCount }
    this._debounceScheduledTimes = {}; // { key -> scheduledTime }
    this._mainDebounceEventCount = 0;
    this._mainDebounceScheduledTime = null;
  }

  /**
   * Handle property change during drag/resize
   * v1.6.3.12 - FIX Code Health: Extracted common logic from handlePositionChange/handleSizeChange
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} values - Values to update { left, top } or { width, height }
   * @param {string} eventName - Event name to emit (e.g., 'tab:position-changing')
   * @param {string} persistType - Type for debounced persist ('position' or 'size')
   */
  _handlePropertyChange(id, values, eventName, persistType) {
    const tab = this.quickTabsMap.get(id);
    if (tab) {
      // Round and apply values to tab
      for (const [key, value] of Object.entries(values)) {
        tab[key] = Math.round(value);
      }

      // Emit lightweight event for Manager live updates (without persistence)
      this.eventBus?.emit(eventName, { id, ...this._getRoundedValues(tab, Object.keys(values)) });

      // Debounced persist during drag/resize (200ms) for cross-context sync
      this._debouncedDragPersist(id, persistType);
    }
  }

  /**
   * Get rounded values from tab for specified keys
   * @private
   * @param {Object} tab - Tab object
   * @param {string[]} keys - Keys to extract
   * @returns {Object} Object with rounded values
   */
  _getRoundedValues(tab, keys) {
    const result = {};
    for (const key of keys) {
      result[key] = tab[key];
    }
    return result;
  }

  /**
   * Handle position change during drag
   * v1.6.3 - Local only (no cross-tab broadcast)
   * v1.6.3.5-v7 - FIX Issue #4: Add debounced persistence during drag for live Manager updates
   * v1.6.3.12 - FIX Code Health: Refactored to use shared _handlePropertyChange
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - New left position
   * @param {number} top - New top position
   */
  handlePositionChange(id, left, top) {
    this._handlePropertyChange(id, { left, top }, 'tab:position-changing', 'position');
  }

  /**
   * Debounced persist during drag/resize operations
   * v1.6.3.5-v7 - FIX Issue #4: Enable live sync without overwhelming storage
   * Uses 200ms debounce (faster than end persist, but not on every pixel)
   * v1.6.3.12-v4 - FIX Issue #8: Add debounce timing validation logging
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} type - 'position' or 'size'
   */
  _debouncedDragPersist(id, type) {
    const key = `drag-${id}-${type}`;
    const scheduledDelayMs = 200;

    // v1.6.3.12-v4 - FIX Issue #8: Initialize or increment event counter
    if (this._dragDebounceTimers[key]) {
      // Subsequent event during debounce window
      this._debounceEventCounts[key] = (this._debounceEventCounts[key] || 0) + 1;
      console.log('[DEBOUNCE][DRAG_EVENT_QUEUED] Event during debounce window', {
        key,
        debouncedEventCount: this._debounceEventCounts[key],
        scheduledDelayMs,
        timestamp: new Date().toISOString()
      });
      clearTimeout(this._dragDebounceTimers[key]);
    } else {
      // v1.6.3.12-v4 - FIX Issue #8: Log debounce trigger
      this._debounceEventCounts[key] = 0;
      this._debounceScheduledTimes[key] = Date.now();
      console.log('[DEBOUNCE][DRAG_TRIGGERED] Debounce initiated', {
        key,
        scheduledDelayMs,
        debouncedEventCount: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Schedule new persist (200ms - faster than DEBOUNCE_DELAY_MS for end operations)
    this._dragDebounceTimers[key] = setTimeout(() => {
      // v1.6.3.12-v4 - FIX Issue #8: Log completion with metrics
      const actualDelayMs = Date.now() - this._debounceScheduledTimes[key];
      const preventedWrites = this._debounceEventCounts[key] || 0;

      console.log('[DEBOUNCE][DRAG_COMPLETE] Debounce timer fired', {
        key,
        scheduledDelayMs,
        actualDelayMs,
        delayDeltaMs: actualDelayMs - scheduledDelayMs,
        preventedWrites,
        message: `Debounce complete, prevented ${preventedWrites} write operations`,
        timestamp: new Date().toISOString()
      });

      // Cleanup tracking state
      delete this._dragDebounceTimers[key];
      delete this._debounceEventCounts[key];
      delete this._debounceScheduledTimes[key];

      this._doPersist();
    }, scheduledDelayMs);
  }

  /**
   * Handle property change end (drag/resize end)
   * v1.6.3.12 - FIX Code Health: Extracted common logic from handlePositionChangeEnd/handleSizeChangeEnd
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} values - Raw values to round and apply
   * @param {string} updateType - Type for orphan event ('position' or 'size')
   * @param {string} eventName - Event name to emit (e.g., 'tab:position-updated')
   * @param {Function} sendMessageFn - Function to send message (bound method)
   * @returns {boolean} True if update was applied, false if skipped
   */
  _handlePropertyChangeEnd(id, values, updateType, eventName, sendMessageFn) {
    // Log callback invocation for debugging
    console.log(
      `[UpdateHandler] handle${updateType === 'position' ? 'Position' : 'Size'}ChangeEnd called:`,
      { id, ...values }
    );

    // Round all values
    const roundedValues = {};
    for (const [key, value] of Object.entries(values)) {
      roundedValues[key] = Math.round(value);
    }

    // Update the Quick Tab's stored values
    const tab = this.quickTabsMap.get(id);

    // Check DOM if tab not in Map
    if (!tab) {
      return this._handleMissingTabOnChangeEnd(id, updateType, roundedValues);
    }

    // Apply rounded values to tab
    Object.assign(tab, roundedValues);
    console.log(`[UpdateHandler] Updated tab ${updateType} in Map:`, { id, ...roundedValues });

    // Emit event for coordinators
    this.eventBus?.emit(eventName, { id, ...roundedValues });

    // Persist to storage after drag/resize ends
    console.log(`[UpdateHandler] Scheduling storage persist after ${updateType} change`);
    this._persistToStorage();

    // Send message to sidebar for immediate update (fire-and-forget)
    sendMessageFn(id, roundedValues, tab.originTabId).catch(() => {
      // Error already logged by send*Message
    });

    return true;
  }

  /**
   * Handle missing tab during change end
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} updateType - Type for orphan event
   * @param {Object} roundedValues - Rounded values for orphan event
   * @returns {boolean} Always false (update skipped)
   */
  _handleMissingTabOnChangeEnd(id, updateType, roundedValues) {
    const domExists = this._checkDOMExists(id);
    console.warn(
      `[UpdateHandler] ${updateType === 'position' ? 'Position' : 'Size'} update skipped:`,
      {
        id,
        reason: 'tab not in quickTabsMap',
        inDOM: domExists
      }
    );

    if (domExists) {
      this._emitOrphanedTabEvent(id, updateType, roundedValues);
    }
    return false;
  }

  /**
   * Handle position change end (drag end)
   * v1.6.3 - Local only (no storage persistence)
   * v1.6.3.4 - FIX Issue #3: Added storage persistence
   * v1.6.3.4-v3 - FIX Issue #6: Enhanced logging for callback invocation
   * v1.6.3.4-v12 - FIX Diagnostic Issue #3, #6: Verify DOM before skipping, re-add if missing
   * v1.6.3.5-v8 - FIX Issue #3: Emit event when orphaned DOM detected for re-wiring
   * v1.6.3.12 - FIX Code Health: Refactored to use shared _handlePropertyChangeEnd
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - Final left position
   * @param {number} top - Final top position
   */
  handlePositionChangeEnd(id, left, top) {
    this._handlePropertyChangeEnd(
      id,
      { left, top },
      'position',
      'tab:position-updated',
      (qid, vals, originTabId) => this._sendMoveMessage(qid, vals.left, vals.top, originTabId)
    );
  }

  /**
   * Send QUICKTAB_MOVED message to background for sidebar notification
   * v1.6.3.11-v12 - FIX Issue #4 & #5: Direct message to sidebar via background
   * v1.6.3.12 - FIX Code Health: Refactored to use shared _sendUpdateMessage
   * @private
   * @param {string} id - Quick Tab ID
   * @param {number} left - New left position
   * @param {number} top - New top position
   * @param {number|null} originTabId - Origin tab ID
   */
  async _sendMoveMessage(id, left, top, originTabId) {
    await this._sendUpdateMessage('QUICKTAB_MOVED', id, { left, top }, originTabId);
  }

  /**
   * Send update message to background for sidebar notification
   * v1.6.3.12 - FIX Code Health: Extracted common logic from _sendMoveMessage/_sendResizeMessage
   * @private
   * @param {string} type - Message type ('QUICKTAB_MOVED' or 'QUICKTAB_RESIZED')
   * @param {string} id - Quick Tab ID
   * @param {Object} data - Update data (position or size)
   * @param {number|null} originTabId - Origin tab ID
   */
  async _sendUpdateMessage(type, id, data, originTabId) {
    const logPrefix = type === 'QUICKTAB_MOVED' ? 'MOVE_MESSAGE' : 'RESIZE_MESSAGE';
    try {
      console.log(`[UpdateHandler] [${logPrefix}] Sending ${type}:`, { id, ...data, originTabId });

      await browser.runtime.sendMessage({
        type,
        quickTabId: id,
        ...data,
        originTabId,
        source: 'UpdateHandler',
        timestamp: Date.now()
      });

      console.log(`[UpdateHandler] [${logPrefix}] Sent successfully:`, { id });
    } catch (err) {
      // Background may not be available - this is non-critical
      console.debug(`[UpdateHandler] [${logPrefix}] Could not send:`, { id, error: err.message });
    }
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
   * v1.6.3.12 - FIX Code Health: Refactored to use shared _handlePropertyChange
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - New width
   * @param {number} height - New height
   */
  handleSizeChange(id, width, height) {
    this._handlePropertyChange(id, { width, height }, 'tab:size-changing', 'size');
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

    // v1.6.3.11-v12 - FIX Issue #4: Send QUICKTAB_RESIZED message to sidebar for immediate update
    // Fire-and-forget pattern - errors are handled internally by _sendResizeMessage
    this._sendResizeMessage(id, roundedWidth, roundedHeight, tab.originTabId).catch(() => {
      // Error already logged by _sendResizeMessage
    });
  }

  /**
   * Send QUICKTAB_RESIZED message to background for sidebar notification
   * v1.6.3.11-v12 - FIX Issue #4 & #5: Direct message to sidebar via background
   * v1.6.3.12 - FIX Code Health: Refactored to use shared _sendUpdateMessage
   * @private
   * @param {string} id - Quick Tab ID
   * @param {number} width - New width
   * @param {number} height - New height
   * @param {number|null} originTabId - Origin tab ID
   */
  async _sendResizeMessage(id, width, height, originTabId) {
    await this._sendUpdateMessage('QUICKTAB_RESIZED', id, { width, height }, originTabId);
  }

  /**
   * Persist current state to browser.storage.local (debounced with change detection)
   * v1.6.3.4 - FIX Issue #2: Added debounce and change detection
   * v1.6.3.4 - FIX Issue #3: Persist to storage after position/size changes
   * v1.6.3.12-v4 - FIX Issue #8: Add debounce timing validation logging
   * Uses shared buildStateForStorage and persistStateToStorage utilities
   * @private
   */
  _persistToStorage() {
    const scheduledDelayMs = DEBOUNCE_DELAY_MS;

    // v1.6.3.4 - FIX Issue #2: Clear any existing debounce timer
    if (this._debounceTimer) {
      // v1.6.3.12-v4 - FIX Issue #8: Increment event counter during debounce
      this._mainDebounceEventCount++;
      console.log('[DEBOUNCE][MAIN_EVENT_QUEUED] Event during debounce window', {
        debouncedEventCount: this._mainDebounceEventCount,
        scheduledDelayMs,
        timestamp: new Date().toISOString()
      });
      clearTimeout(this._debounceTimer);
    } else {
      // v1.6.3.12-v4 - FIX Issue #8: Log debounce trigger
      this._mainDebounceEventCount = 0;
      this._mainDebounceScheduledTime = Date.now();
      console.log('[DEBOUNCE][MAIN_TRIGGERED] Debounce initiated', {
        scheduledDelayMs,
        debouncedEventCount: 0,
        timestamp: new Date().toISOString()
      });
    }

    // v1.6.3.4 - FIX Issue #2: Schedule debounced persist
    this._debounceTimer = setTimeout(() => {
      // v1.6.3.12-v4 - FIX Issue #8: Log completion with metrics
      const actualDelayMs = Date.now() - this._mainDebounceScheduledTime;
      const preventedWrites = this._mainDebounceEventCount;

      console.log('[DEBOUNCE][MAIN_COMPLETE] Debounce timer fired', {
        scheduledDelayMs,
        actualDelayMs,
        delayDeltaMs: actualDelayMs - scheduledDelayMs,
        preventedWrites,
        message: `Debounce complete, prevented ${preventedWrites} write operations`,
        timestamp: new Date().toISOString()
      });

      // Reset tracking state
      this._mainDebounceEventCount = 0;
      this._mainDebounceScheduledTime = null;
      this._debounceTimer = null;

      this._doPersist();
    }, scheduledDelayMs);
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
   * Count non-minimized tabs
   * v1.6.3.10-v7 - FIX CodeScene: Extracted to reduce _doPersist complexity
   * @private
   * @returns {number} Count of non-minimized tabs
   */
  _countNonMinimizedTabs() {
    let count = 0;
    for (const [id] of this.quickTabsMap) {
      if (!this._isTabMinimized(id)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if persist should be skipped due to all tabs being minimized
   * v1.6.3.10-v7 - FIX CodeScene: Extracted to reduce _doPersist complexity
   * @private
   * @returns {boolean} True if persist should be skipped
   */
  _shouldSkipMinimizedPersist() {
    if (this.quickTabsMap.size === 0) return false;
    const nonMinimizedCount = this._countNonMinimizedTabs();
    if (nonMinimizedCount === 0) {
      console.log('[UpdateHandler] STORAGE_PERSIST_SKIPPED:', {
        reason: 'all-tabs-minimized',
        totalTabs: this.quickTabsMap.size,
        nonMinimizedCount
      });
      return true;
    }
    return false;
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
   * v1.6.3.10-v7 - FIX Diagnostic Issue #7: Enhanced logging showing storage write initiated/blocked
   * v1.6.3.10-v7 - FIX CodeScene: Extracted helpers to reduce complexity
   * v1.6.3.12 - FIX Issue #14: Use StorageCoordinator for serialized writes
   * @private
   * @returns {Promise<void>}
   */
  async _doPersist() {
    // v1.6.3.6-v4 - FIX Issue #1: Log entry
    console.log('[UpdateHandler] STORAGE_PERSIST_INITIATED:', {
      mapSize: this.quickTabsMap?.size ?? 0,
      hasMinimizedManager: !!this.minimizedManager,
      caller: 'UpdateHandler._doPersist',
      timestamp: Date.now()
    });

    // v1.6.3.10-v6 - FIX Issue A3: Check if any non-minimized tabs exist
    if (this._shouldSkipMinimizedPersist()) return;

    const state = buildStateForStorage(this.quickTabsMap, this.minimizedManager);

    // v1.6.3.4-v2 - FIX Bug #1: Handle null state from validation failure
    if (!state) {
      console.error('[UpdateHandler] STORAGE_PERSIST_BLOCKED:', {
        reason: 'build-state-failed',
        mapSize: this.quickTabsMap?.size ?? 0
      });
      return;
    }

    // v1.6.3.4-v10 - FIX Issue #5: Compute 64-bit hash and compare both parts
    const newHash = this._computeStateHash(state);
    const hashChanged = this._hasHashChanged(this._lastStateHash, newHash);

    if (!hashChanged) {
      console.log('[UpdateHandler] STORAGE_PERSIST_SKIPPED:', {
        reason: 'hash-match',
        hashLo: newHash.lo,
        hashHi: newHash.hi,
        tabCount: state.tabs?.length
      });
      return;
    }

    console.log('[UpdateHandler] STORAGE_PERSIST_PROCEEDING:', {
      reason: 'hash-mismatch',
      oldHashLo: this._lastStateHash?.lo,
      oldHashHi: this._lastStateHash?.hi,
      newHashLo: newHash.lo,
      newHashHi: newHash.hi,
      tabCount: state.tabs?.length
    });

    // Update hash and persist
    this._lastStateHash = newHash;

    // v1.6.3.12 - FIX Issue #14: Use StorageCoordinator for serialized writes
    const coordinator = getStorageCoordinator();
    try {
      const success = await coordinator.queueWrite('UpdateHandler', () => {
        return persistStateToStorage(state, '[UpdateHandler]');
      });

      // v1.6.3.6-v4 - FIX Issue #1: Log result
      if (success) {
        console.log('[UpdateHandler] STORAGE_PERSIST_SUCCESS:', {
          tabCount: state.tabs?.length,
          timestamp: Date.now()
        });
      } else {
        console.error('[UpdateHandler] STORAGE_PERSIST_FAILED:', {
          tabCount: state.tabs?.length,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('[UpdateHandler] Storage coordinator error:', err.message);
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
