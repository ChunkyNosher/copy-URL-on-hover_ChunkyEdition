/**
 * QuickTabHandler - Handles Quick Tab CRUD operations
 *
 * Actions handled:
 * - BATCH_QUICK_TAB_UPDATE: Process batch updates via StateCoordinator
 * - CREATE_QUICK_TAB: Create new Quick Tab
 * - CLOSE_QUICK_TAB: Close existing Quick Tab
 * - UPDATE_QUICK_TAB_POSITION: Update position (throttled)
 * - UPDATE_QUICK_TAB_POSITION_FINAL: Final position update
 * - UPDATE_QUICK_TAB_SIZE: Update size (throttled)
 * - UPDATE_QUICK_TAB_SIZE_FINAL: Final size update
 * - UPDATE_QUICK_TAB_PIN: Update pin state
 * - UPDATE_QUICK_TAB_SOLO: Update solo state
 * - UPDATE_QUICK_TAB_MUTE: Update mute state
 * - UPDATE_QUICK_TAB_MINIMIZE: Update minimize state
 * - GET_CURRENT_TAB_ID: Get current browser tab ID
 *
 * @version 1.6.3.9 - GAP-7: Import shared dedup constant
 */

import { HANDLER_DEDUP_WINDOW_MS } from '../../constants.js';

// v1.6.3.7-v12 - Issue #7: Initialization barrier timeout constant (code review fix)
const INIT_TIMEOUT_MS = 10000;

// v1.6.3.8-v2 - Issue #5: Backpressure threshold constant (100ms)
const WRITE_BACKPRESSURE_THRESHOLD_MS = 100;

// v1.6.3.8-v2 - Issue #8: WriteBuffer constants
const WRITE_BUFFER_FLUSH_DELAY_MS = 75; // Accumulate changes for 50-100ms range (using 75ms midpoint)
const WRITE_BUFFER_MAX_PENDING = 10; // Max pending operations before force flush

// v1.6.3.8-v2 - Issue #8: Validation idle callback timeout
const VALIDATION_IDLE_TIMEOUT_MS = 2000; // Max wait for idle callback

// v1.6.3.8-v2 - Issue #12: Debug diagnostics flag (matches background.js)
// Note: Import from background.js would create circular dependency, so we define locally
let DEBUG_DIAGNOSTICS = true;

export class QuickTabHandler {
  // v1.6.3.8-v13 - GAP-7: Use imported HANDLER_DEDUP_WINDOW_MS constant
  // v1.6.2.4 - Message deduplication constants for Issue 4 fix
  // 100ms: Typical double-fire interval for keyboard/context menu events is <10ms
  // Using 100ms provides safety margin while not blocking legitimate rapid operations
  static DEDUP_WINDOW_MS = HANDLER_DEDUP_WINDOW_MS;
  // 5000ms: Cleanup interval balances memory usage vs CPU overhead
  static DEDUP_CLEANUP_INTERVAL_MS = 5000;
  // 10000ms: TTL keeps entries long enough for debugging but prevents memory bloat
  static DEDUP_TTL_MS = 10000;

  // v1.6.3.7-v9 - FIX Issue #6: Sequence ID for event ordering
  // Uses a static counter shared across all handler instances
  static _sequenceId = 0;

  // v1.6.3.8-v2 - Issue #3: Track highest processed sequence ID for rejection
  static _highestProcessedSequenceId = 0;

  // v1.6.3.8-v5 - FIX Issue #1: Monotonic revision counter for storage event ordering
  // Initialized to Date.now() to ensure uniqueness across browser restarts
  // Each storage write increments this counter - listeners reject updates with revision ≤ their last
  static _revisionCounter = Date.now();

  // v1.6.3.8-v5 - FIX Issue #1: Track highest processed revision for rejection
  static _highestProcessedRevision = 0;

  constructor(globalState, stateCoordinator, browserAPI, initializeFn) {
    this.globalState = globalState;
    this.stateCoordinator = stateCoordinator;
    this.browserAPI = browserAPI;
    this.initializeFn = initializeFn;
    this.isInitialized = false;

    // v1.6.1.6 - Memory leak fix: Track last write to detect self-triggered storage events
    this.lastWriteTimestamp = null;
    this.WRITE_IGNORE_WINDOW_MS = 100;

    // v1.6.2.4 - BUG FIX Issue 4: Message deduplication tracking
    // Prevents duplicate CREATE_QUICK_TAB messages sent within 100ms
    this.processedMessages = new Map(); // messageKey -> timestamp
    this.lastCleanup = Date.now();

    // v1.6.3.8-v2 - Issue #5: Track pending writes count for backpressure detection
    this._pendingWritesCount = 0;

    // v1.6.3.8-v2 - Issue #8: WriteBuffer for batching storage operations
    this._writeBuffer = {
      pendingState: null, // Accumulated state to write
      flushTimeoutId: null, // Timeout ID for delayed flush
      pendingOperations: 0, // Count of pending operations
      lastFlushTime: 0 // Timestamp of last flush
    };
  }

  /**
   * Set DEBUG_DIAGNOSTICS flag for conditional logging
   * v1.6.3.8-v2 - Issue #12: Allow external configuration
   * @param {boolean} value - Enable or disable diagnostics
   */
  static setDebugDiagnostics(value) {
    DEBUG_DIAGNOSTICS = !!value;
  }

  /**
   * Get the next sequence ID for storage writes
   * v1.6.3.7-v9 - FIX Issue #6: Monotonically increasing sequence ID
   * @returns {number} Next sequence ID
   */
  static _getNextSequenceId() {
    QuickTabHandler._sequenceId++;
    return QuickTabHandler._sequenceId;
  }

  /**
   * Get the next revision number for storage writes
   * v1.6.3.8-v5 - FIX Issue #1: Monotonic revision counter for storage event ordering
   * Each state snapshot includes this revision number. Listeners reject any update
   * with revision ≤ their _lastAppliedRevision.
   * @returns {number} Next revision number
   */
  static _getNextRevision() {
    QuickTabHandler._revisionCounter++;
    return QuickTabHandler._revisionCounter;
  }

  /**
   * Check if incoming revision should be rejected (out-of-order)
   * v1.6.3.8-v5 - FIX Issue #1: Reject updates with revision ≤ current highest
   * @param {number} incomingRevision - Revision from incoming update
   * @param {Object} context - Optional context for logging
   * @returns {boolean} True if update should be rejected
   */
  static shouldRejectRevision(incomingRevision, context = {}) {
    if (typeof incomingRevision !== 'number') {
      // No revision - allow for backwards compatibility
      return false;
    }

    const shouldReject = incomingRevision <= QuickTabHandler._highestProcessedRevision;

    if (shouldReject && DEBUG_DIAGNOSTICS) {
      console.warn('[QuickTabHandler] REVISION_REJECTED:', {
        incomingRevision,
        highestProcessedRevision: QuickTabHandler._highestProcessedRevision,
        reason:
          incomingRevision === QuickTabHandler._highestProcessedRevision
            ? 'Duplicate revision'
            : 'Out-of-order event (older revision arrived late)',
        ...context,
        timestamp: Date.now()
      });
    }

    return shouldReject;
  }

  /**
   * Update the highest processed revision
   * v1.6.3.8-v5 - FIX Issue #1: Call after successfully processing an update
   * @param {number} revision - Revision just processed
   */
  static updateHighestProcessedRevision(revision) {
    if (typeof revision === 'number' && revision > QuickTabHandler._highestProcessedRevision) {
      QuickTabHandler._highestProcessedRevision = revision;
    }
  }

  /**
   * Check if incoming sequence ID should be rejected (out-of-order)
   * v1.6.3.8-v2 - FIX Issue #3: Reject updates with lower sequenceId than current local state
   * Call this method when processing storage.onChanged events to detect out-of-order updates
   * @param {number} incomingSequenceId - Sequence ID from incoming update
   * @param {Object} context - Optional context for logging (saveId, tabCount, etc.)
   * @returns {boolean} True if update should be rejected
   */
  static shouldRejectSequenceId(incomingSequenceId, context = {}) {
    if (typeof incomingSequenceId !== 'number') {
      // No sequence ID - allow for backwards compatibility
      return false;
    }

    const shouldReject = incomingSequenceId <= QuickTabHandler._highestProcessedSequenceId;

    if (shouldReject && DEBUG_DIAGNOSTICS) {
      console.warn('[QuickTabHandler] STORAGE_SEQUENCE_REJECTED:', {
        incomingSequenceId,
        highestProcessedSequenceId: QuickTabHandler._highestProcessedSequenceId,
        reason:
          incomingSequenceId === QuickTabHandler._highestProcessedSequenceId
            ? 'Duplicate sequence ID'
            : 'Out-of-order event (older sequence arrived late)',
        ...context,
        timestamp: Date.now()
      });
    }

    return shouldReject;
  }

  /**
   * Legacy alias for backwards compatibility
   * @deprecated Use shouldRejectSequenceId instead
   */
  static _shouldRejectSequenceId(incomingSequenceId) {
    return QuickTabHandler.shouldRejectSequenceId(incomingSequenceId);
  }

  /**
   * Update highest processed sequence ID after successful write
   * v1.6.3.8-v2 - FIX Issue #3: Track highest processed for rejection logic
   * @param {number} sequenceId - Sequence ID that was successfully processed
   */
  static _updateHighestProcessedSequenceId(sequenceId) {
    if (
      typeof sequenceId === 'number' &&
      sequenceId > QuickTabHandler._highestProcessedSequenceId
    ) {
      QuickTabHandler._highestProcessedSequenceId = sequenceId;
    }
  }

  /**
   * Get current highest processed sequence ID
   * v1.6.3.8-v2 - Issue #3: Getter for diagnostics
   * @returns {number} Current highest processed sequence ID
   */
  static getHighestProcessedSequenceId() {
    return QuickTabHandler._highestProcessedSequenceId;
  }

  /**
   * Check if message is a duplicate (same action + id within dedup window)
   * v1.6.2.4 - BUG FIX Issue 4: Prevents double-creation of Quick Tabs
   * @param {Object} message - Message to check
   * @returns {boolean} True if this is a duplicate message
   */
  _isDuplicateMessage(message) {
    // Only deduplicate creation messages
    if (message.action !== 'CREATE_QUICK_TAB') {
      return false;
    }

    // Clean up old entries periodically
    const now = Date.now();
    if (now - this.lastCleanup > QuickTabHandler.DEDUP_CLEANUP_INTERVAL_MS) {
      this._cleanupOldProcessedMessages(now);
    }

    // Generate unique key for this message
    const messageKey = `${message.action}-${message.id}`;
    const lastProcessed = this.processedMessages.get(messageKey);

    // Check if recently processed
    if (lastProcessed && now - lastProcessed < QuickTabHandler.DEDUP_WINDOW_MS) {
      console.log('[QuickTabHandler] Ignoring duplicate message:', {
        action: message.action,
        id: message.id,
        timeSinceLastMs: now - lastProcessed
      });
      return true;
    }

    // Record this message
    this.processedMessages.set(messageKey, now);
    return false;
  }

  /**
   * Clean up old processed message entries
   * @private
   * @param {number} now - Current timestamp
   */
  _cleanupOldProcessedMessages(now) {
    const cutoff = now - QuickTabHandler.DEDUP_TTL_MS;
    for (const [key, timestamp] of this.processedMessages.entries()) {
      if (timestamp < cutoff) {
        this.processedMessages.delete(key);
      }
    }
    this.lastCleanup = now;
  }

  /**
   * Get last write timestamp for self-write detection
   * v1.6.1.6 - Memory leak fix
   * @returns {Object|null} Last write info with writeSourceId and timestamp
   */
  getLastWriteTimestamp() {
    return this.lastWriteTimestamp;
  }

  /**
   * Generate a unique write source ID and update tracking
   * v1.6.1.6 - Memory leak fix: Extracted to reduce code duplication
   * @returns {string} Unique write source ID
   */
  _generateWriteSourceId() {
    const writeSourceId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    this.lastWriteTimestamp = { writeSourceId, timestamp: Date.now() };
    return writeSourceId;
  }

  setInitialized(value) {
    this.isInitialized = value;
  }

  /**
   * Helper method to update Quick Tab properties
   * Reduces duplication across update handlers
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   * v1.6.3.6-v4 - FIX Issue #1: Added diagnostic logging for tab lookup and update confirmation
   * @param {Object} message - Message with id and properties to update
   * @param {Function} updateFn - Function to update tab properties
   * @param {boolean} shouldSave - Whether to save to storage immediately
   * @returns {Object} Success response
   */
  async updateQuickTabProperty(message, updateFn, shouldSave = true) {
    // v1.6.3.6-v4 - FIX Issue #1: Log entry with parameters
    console.log('[QuickTabHandler] updateQuickTabProperty ENTRY:', {
      messageId: message.id,
      shouldSave,
      isInitialized: this.isInitialized,
      tabCount: this.globalState.tabs?.length ?? 0,
      timestamp: Date.now()
    });

    if (!this.isInitialized) {
      console.log('[QuickTabHandler] Not initialized, calling initializeFn...');
      await this.initializeFn();
    }

    // v1.6.2.2 - Use unified tabs array instead of container-based lookup
    const tab = this.globalState.tabs.find(t => t.id === message.id);
    if (!tab) {
      // v1.6.3.6-v4 - FIX Issue #1: Log warning when tab not found (silent failure before)
      console.warn('[QuickTabHandler] updateQuickTabProperty: Tab NOT FOUND in globalState:', {
        searchId: message.id,
        availableIds: this.globalState.tabs.map(t => t.id).slice(0, 10), // First 10 IDs for debugging
        totalTabs: this.globalState.tabs.length
      });
      return { success: true };
    }

    // v1.6.3.6-v4 - FIX Issue #1: Log successful tab lookup
    console.log('[QuickTabHandler] updateQuickTabProperty: Tab FOUND:', {
      id: tab.id,
      currentPosition: { left: tab.left, top: tab.top },
      currentSize: { width: tab.width, height: tab.height },
      currentVersion: tab.version || 0 // v1.6.3.8-v2 - Issue #12: Log version
    });

    updateFn(tab, message);
    // v1.6.3.8-v2 - Issue #12: Increment version on any property update
    tab.version = (tab.version || 0) + 1;
    this.globalState.lastUpdate = Date.now();

    if (shouldSave) {
      // v1.6.3.6-v4 - FIX Issue #1: Log before calling saveStateToStorage
      console.log(
        '[QuickTabHandler] updateQuickTabProperty: Calling saveStateToStorage (shouldSave=true)'
      );
      await this.saveStateToStorage();
    } else {
      console.log(
        '[QuickTabHandler] updateQuickTabProperty: Skipping storage save (shouldSave=false)'
      );
    }

    // v1.6.3.6-v4 - FIX Issue #1: Log successful completion
    console.log('[QuickTabHandler] updateQuickTabProperty EXIT:', {
      id: message.id,
      shouldSave,
      lastUpdate: this.globalState.lastUpdate
    });
    return { success: true };
  }

  /**
   * Update a Quick Tab with version-based conflict resolution
   * v1.6.3.8-v2 - FIX Issue #12: Conditional write with version checking
   * @param {string} id - Quick Tab ID
   * @param {number} version - Expected version of the Quick Tab
   * @param {Object} changes - Changes to apply to the Quick Tab
   * @returns {Object} Result with success flag and conflict info if applicable
   */
  async updateQuickTab(id, version, changes) {
    // Wait for initialization if needed
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    // Find the tab
    const tab = this.globalState.tabs.find(t => t.id === id);
    if (!tab) {
      return {
        success: false,
        error: 'TAB_NOT_FOUND',
        message: `Quick Tab with id ${id} not found`
      };
    }

    // v1.6.3.8-v2 - Issue #12: Check version for conflict
    const currentVersion = tab.version || 0;
    if (typeof version === 'number' && version < currentVersion) {
      // Conflict detected - stored version is newer than request version
      if (DEBUG_DIAGNOSTICS) {
        console.warn('[QuickTabHandler] STATE_CONFLICT_DETECTED:', {
          quickTabId: id,
          requestVersion: version,
          storedVersion: currentVersion,
          changes: Object.keys(changes),
          resolution: 'REJECTED - stored version is newer',
          timestamp: Date.now()
        });
      }
      return {
        success: false,
        error: 'VERSION_CONFLICT',
        message: `Version conflict: stored version ${currentVersion} > request version ${version}`,
        currentVersion,
        requestedVersion: version
      };
    }

    // Apply changes and increment version
    Object.assign(tab, changes);
    tab.version = currentVersion + 1;
    this.globalState.lastUpdate = Date.now();

    // Log successful update
    if (DEBUG_DIAGNOSTICS) {
      console.log('[QuickTabHandler] VERSION_UPDATE_APPLIED:', {
        quickTabId: id,
        previousVersion: currentVersion,
        newVersion: tab.version,
        changes: Object.keys(changes),
        timestamp: Date.now()
      });
    }

    // Save to storage
    await this.saveStateToStorage();

    return {
      success: true,
      version: tab.version
    };
  }

  /**
   * Get the current version of a Quick Tab
   * v1.6.3.8-v2 - Issue #12: Helper for version-based updates
   * @param {string} id - Quick Tab ID
   * @returns {number|null} Current version or null if not found
   */
  getQuickTabVersion(id) {
    const tab = this.globalState.tabs.find(t => t.id === id);
    if (!tab) {
      return null;
    }
    return tab.version || 0;
  }

  /**
   * Handle batch Quick Tab update
   * v1.6.4.13 - FIX Issue #16: Added initialization guard
   */
  async handleBatchUpdate(message, sender) {
    // v1.6.4.13 - FIX Issue #16: Wait for initialization before processing batch updates
    if (!this.isInitialized) {
      console.log('[QuickTabHandler] handleBatchUpdate: Waiting for initialization');
      await this.initializeFn();
    }

    const tabId = sender.tab?.id;
    const result = await this.stateCoordinator.processBatchUpdate(
      tabId,
      message.operations,
      message.tabInstanceId
    );
    return result;
  }

  /**
   * Handle Quick Tab creation
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   * v1.6.2.4 - BUG FIX Issue 4: Added message deduplication to prevent double-creation
   */
  async handleCreate(message, _sender) {
    // v1.6.2.4 - BUG FIX Issue 4: Check for duplicate CREATE messages
    if (this._isDuplicateMessage(message)) {
      console.log('[QuickTabHandler] Skipping duplicate Create:', message.id);
      return { success: true, duplicate: true };
    }

    console.log(
      '[QuickTabHandler] Create:',
      message.url,
      'ID:',
      message.id,
      'Container:',
      message.cookieStoreId
    );

    // Wait for initialization if needed
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // v1.6.2.2 - Check if tab already exists by ID in unified tabs array
    const existingIndex = this.globalState.tabs.findIndex(t => t.id === message.id);

    const tabData = {
      id: message.id,
      url: message.url,
      left: message.left,
      top: message.top,
      width: message.width,
      height: message.height,
      pinnedToUrl: message.pinnedToUrl || null,
      title: message.title || 'Quick Tab',
      minimized: message.minimized || false,
      cookieStoreId: cookieStoreId, // v1.6.2.2 - Store container info on tab itself
      version: 1 // v1.6.3.8-v2 - Issue #12: Initialize version for conflict resolution
    };

    if (existingIndex !== -1) {
      // v1.6.3.8-v2 - Issue #12: Preserve version when updating existing tab
      const existingVersion = this.globalState.tabs[existingIndex].version || 0;
      tabData.version = existingVersion + 1;
      this.globalState.tabs[existingIndex] = tabData;
    } else {
      this.globalState.tabs.push(tabData);
    }

    this.globalState.lastUpdate = Date.now();

    // Save state
    await this.saveState(message.saveId, cookieStoreId, message);

    return { success: true };
  }

  /**
   * Handle Quick Tab close
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   */
  async handleClose(message, _sender) {
    console.log(
      '[QuickTabHandler] Close:',
      message.url,
      'ID:',
      message.id,
      'Container:',
      message.cookieStoreId
    );

    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // v1.6.2.2 - Filter from unified tabs array
    const originalLength = this.globalState.tabs.length;
    this.globalState.tabs = this.globalState.tabs.filter(t => t.id !== message.id);

    if (this.globalState.tabs.length !== originalLength) {
      this.globalState.lastUpdate = Date.now();

      // Save state
      await this.saveStateToStorage();

      // Broadcast to tabs in same container
      await this.broadcastToContainer(cookieStoreId, {
        action: 'CLOSE_QUICK_TAB_FROM_BACKGROUND',
        id: message.id,
        url: message.url,
        cookieStoreId: cookieStoreId
      });
    }

    return { success: true };
  }

  /**
   * Handle position update
   * v1.6.3.6-v4 - FIX Issue #1: Added entry logging similar to handlePinUpdate()
   */
  handlePositionUpdate(message, _sender) {
    const shouldSave = message.action === 'UPDATE_QUICK_TAB_POSITION_FINAL';

    // v1.6.3.6-v4 - FIX Issue #1: Entry logging for position updates
    console.log('[QuickTabHandler] Position Update:', {
      action: message.action,
      quickTabId: message.id,
      left: message.left,
      top: message.top,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      shouldSave,
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(
      message,
      (tab, msg) => {
        const oldLeft = tab.left;
        const oldTop = tab.top;
        tab.left = msg.left;
        tab.top = msg.top;
        // v1.6.3.6-v4 - FIX Issue #1: Log old vs new values
        console.log('[QuickTabHandler] Position applied:', {
          quickTabId: msg.id,
          oldPosition: { left: oldLeft, top: oldTop },
          newPosition: { left: tab.left, top: tab.top }
        });
      },
      shouldSave
    );
  }

  /**
   * Handle size update
   * v1.6.3.6-v4 - FIX Issue #1: Added entry logging similar to handlePinUpdate()
   */
  handleSizeUpdate(message, _sender) {
    const shouldSave = message.action === 'UPDATE_QUICK_TAB_SIZE_FINAL';

    // v1.6.3.6-v4 - FIX Issue #1: Entry logging for size updates
    console.log('[QuickTabHandler] Size Update:', {
      action: message.action,
      quickTabId: message.id,
      width: message.width,
      height: message.height,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      shouldSave,
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(
      message,
      (tab, msg) => {
        const oldWidth = tab.width;
        const oldHeight = tab.height;
        tab.width = msg.width;
        tab.height = msg.height;
        // v1.6.3.6-v4 - FIX Issue #1: Log old vs new values
        console.log('[QuickTabHandler] Size applied:', {
          quickTabId: msg.id,
          oldSize: { width: oldWidth, height: oldHeight },
          newSize: { width: tab.width, height: tab.height }
        });
      },
      shouldSave
    );
  }

  /**
   * Generic logging for simple update handlers
   * v1.6.3.7-v14 - FIX Duplication: Extracted common logging pattern
   * @private
   */
  _logSimpleUpdate(handlerName, action, message, extraFields = {}) {
    console.log(`[QuickTabHandler] ${handlerName}:`, {
      action,
      quickTabId: message.id,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      timestamp: Date.now(),
      ...extraFields
    });
  }

  /**
   * Handle pin update
   * v1.6.0.13 - Added logging
   * v1.6.3.7-v14 - FIX Duplication: Use generic logger
   */
  handlePinUpdate(message, _sender) {
    this._logSimpleUpdate('Pin Update', 'UPDATE_QUICK_TAB_PIN', message, {
      pinnedToUrl: message.pinnedToUrl
    });
    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.pinnedToUrl = msg.pinnedToUrl;
    });
  }

  /**
   * Handle solo update
   * v1.6.0.13 - Added logging
   * v1.6.3.7-v14 - FIX Duplication: Use generic logger
   */
  handleSoloUpdate(message, _sender) {
    this._logSimpleUpdate('Solo Update', 'UPDATE_QUICK_TAB_SOLO', message, {
      soloedOnTabs: message.soloedOnTabs || [],
      tabCount: (message.soloedOnTabs || []).length
    });
    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.soloedOnTabs = msg.soloedOnTabs || [];
    });
  }

  /**
   * Handle mute update
   * v1.6.0.13 - Added logging
   * v1.6.3.7-v14 - FIX Duplication: Use generic logger
   */
  handleMuteUpdate(message, _sender) {
    this._logSimpleUpdate('Mute Update', 'UPDATE_QUICK_TAB_MUTE', message, {
      mutedOnTabs: message.mutedOnTabs || [],
      tabCount: (message.mutedOnTabs || []).length
    });
    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.mutedOnTabs = msg.mutedOnTabs || [];
    });
  }

  /**
   * Handle minimize update
   * v1.6.0.13 - Added logging
   * v1.6.3.7-v14 - FIX Duplication: Use generic logger
   */
  handleMinimizeUpdate(message, _sender) {
    this._logSimpleUpdate('Minimize Update', 'UPDATE_QUICK_TAB_MINIMIZE', message, {
      minimized: message.minimized
    });
    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.minimized = msg.minimized;
    });
  }

  /**
   * Handle z-index update
   * v1.6.0.12 - NEW: Save z-index for cross-tab sync
   * v1.6.0.13 - Added logging
   * v1.6.3.7-v14 - FIX Duplication: Use generic logger
   */
  handleZIndexUpdate(message, _sender) {
    this._logSimpleUpdate('Z-Index Update', 'UPDATE_QUICK_TAB_ZINDEX', message, {
      zIndex: message.zIndex
    });
    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.zIndex = msg.zIndex;
    });
  }

  /**
   * Get current tab ID
   * v1.6.2.4 - FIX Issue #4: Add fallback when sender.tab is unavailable
   * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #1: ALWAYS prioritize sender.tab.id
   *   The fallback to tabs.query({ active: true }) was causing cross-tab isolation failures
   *   because when user switches tabs before content script initializes, the "active" tab
   *   is different from the requesting tab. This returns the WRONG tab ID.
   *
   *   Now: We ONLY use sender.tab.id (which is the actual requesting tab).
   *   If sender.tab is unavailable, we return null with a clear error instead of
   *   returning a potentially wrong tab ID from the active tab query.
   *
   *   Note: Removed async since we no longer use await.
   *
   * @param {Object} _message - Message object (unused, required by message router signature)
   * @param {Object} sender - Message sender object containing tab information
   * @returns {{ success: boolean, data: { tabId: number|null }, error?: string }}
   *
   * Response Schema (v1.6.3.9-v2):
   * - Success: { success: true, data: { tabId: <number> } }
   * - Failure: { success: false, data: { tabId: null }, error: <string> }
   *
   * Note: MessageRouter.js will augment this with requestId and timestamp.
   */
  handleGetCurrentTabId(_message, sender) {
    // v1.6.3.9-v2 Issue #47: Enhanced logging for message flow visibility
    console.log('[QuickTabHandler] GET_CURRENT_TAB_ID request received:', {
      hasSenderTab: !!sender?.tab,
      senderTabId: sender?.tab?.id,
      senderTabUrl: sender?.tab?.url ? sender.tab.url.substring(0, 50) : undefined,
      senderFrameId: sender?.frameId,
      timestamp: Date.now()
    });

    // v1.6.3.6-v4 - FIX Issue #1: ALWAYS use sender.tab.id - this is the ACTUAL requesting tab
    // sender.tab is populated by Firefox for all messages from content scripts
    if (sender.tab && typeof sender.tab.id === 'number') {
      // v1.6.3.9-v2 - Issue #5: Use new response format { success: true, data: { tabId } }
      // This aligns with content.js which prefers this format (legacy format is deprecated)
      const response = { success: true, data: { tabId: sender.tab.id } };
      console.log('[QuickTabHandler] GET_CURRENT_TAB_ID response (success):', {
        response,
        senderTabId: sender.tab.id,
        timestamp: Date.now()
      });
      return response;
    }

    // v1.6.3.6-v4 - REMOVED: Fallback to tabs.query({ active: true })
    // This fallback was causing cross-tab isolation failures because:
    // 1. User opens Wikipedia Tab 1 (tabId=13)
    // 2. User opens Wikipedia Tab 2 (tabId=14) and switches to it
    // 3. Tab 2's content script sends GET_CURRENT_TAB_ID
    // 4. If sender.tab.id is unavailable, fallback returned tabId=14 (active tab)
    //    but Tab 1's content script might still be initializing and get wrong ID
    //
    // Instead: Return null if sender.tab is unavailable - this is a clear error
    // that the caller can handle, rather than silently returning wrong data.

    // v1.6.3.9-v2 Issue #47: Enhanced error logging
    const errorResponse = {
      success: false,
      data: { tabId: null },
      error: 'sender.tab not available - cannot identify requesting tab'
    };
    console.error('[QuickTabHandler] GET_CURRENT_TAB_ID response (failure):', {
      response: errorResponse,
      senderInfo: {
        hasSender: !!sender,
        hasTab: !!sender?.tab,
        tabId: sender?.tab?.id,
        frameId: sender?.frameId,
        url: sender?.url ? sender.url.substring(0, 50) : undefined
      },
      timestamp: Date.now()
    });
    console.error(
      '[QuickTabHandler] This should not happen for content scripts. Check if message came from non-tab context.'
    );
    return errorResponse;
  }

  /**
   * Get container context (cookieStoreId and tabId) for content script
   * Content scripts cannot access browser.tabs API, so they must request this from background
   */
  async handleGetContainerContext(_message, sender) {
    try {
      // Get the tab that sent the message
      const tab = await this.browserAPI.tabs.get(sender.tab.id);
      return {
        success: true,
        cookieStoreId: tab.cookieStoreId || 'firefox-default',
        tabId: tab.id
      };
    } catch (err) {
      console.error('[QuickTabHandler] Error getting container context:', err);
      return {
        success: false,
        cookieStoreId: 'firefox-default',
        error: err.message
      };
    }
  }

  /**
   * Get Quick Tabs state for a specific container
   * Critical for fixing Issue #35 and #51 - content scripts need to load from background's authoritative state
   * v1.6.2.2 - Updated for unified format (returns all tabs for global visibility)
   * v1.6.3.6-v12 - FIX Issue #1: Return explicit error when not initialized
   * v1.6.3.7-v13 - Issue #1: Enhanced logging with message arrival, state transitions, and response timing
   * v1.6.3.7-v14 - FIX Complexity: Simplified with extracted helpers
   */
  async handleGetQuickTabsState(message, _sender) {
    const messageArrivalTime = Date.now();

    console.log('[QuickTabHandler] GET_QUICK_TABS_STATE: Message arrived', {
      messageArrivalTime,
      isInitialized: this.isInitialized,
      cookieStoreId: message.cookieStoreId || 'firefox-default'
    });

    try {
      const initResult = await this._ensureInitialized();
      if (!initResult.success) {
        return this._logAndReturnInitFailure(initResult, messageArrivalTime);
      }

      return this._buildStateSuccessResponse(message, messageArrivalTime);
    } catch (err) {
      return this._handleGetStateError(err, messageArrivalTime);
    }
  }

  /**
   * Log and return initialization failure response
   * v1.6.3.7-v14 - FIX Complexity: Extracted from handleGetQuickTabsState
   * @private
   */
  _logAndReturnInitFailure(initResult, messageArrivalTime) {
    console.log('[QuickTabHandler] GET_QUICK_TABS_STATE: Responding with init failure', {
      error: initResult.error,
      responseDelayMs: Date.now() - messageArrivalTime,
      timestamp: Date.now()
    });
    return initResult;
  }

  /**
   * Build success response for getQuickTabsState
   * v1.6.3.7-v14 - FIX Complexity: Extracted from handleGetQuickTabsState
   * @private
   */
  _buildStateSuccessResponse(message, messageArrivalTime) {
    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    const allTabs = this.globalState.tabs || [];

    console.log('[QuickTabHandler] GET_QUICK_TABS_STATE: Responding with state', {
      tabCount: allTabs.length,
      responseDelayMs: Date.now() - messageArrivalTime,
      lastUpdate: this.globalState.lastUpdate,
      timestamp: Date.now()
    });

    return {
      success: true,
      tabs: allTabs,
      cookieStoreId,
      lastUpdate: this.globalState.lastUpdate
    };
  }

  /**
   * Handle error in getQuickTabsState
   * v1.6.3.7-v14 - FIX Complexity: Extracted from handleGetQuickTabsState
   * @private
   */
  _handleGetStateError(err, messageArrivalTime) {
    console.error('[QuickTabHandler] Error getting Quick Tabs state:', {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      code: err?.code,
      error: err,
      responseDelayMs: Date.now() - messageArrivalTime
    });
    return {
      success: false,
      tabs: [],
      error: err.message
    };
  }

  /**
   * Build initialization failure response
   * v1.6.3.7-v14 - FIX Complexity: Extracted to reduce _ensureInitialized cc
   * @private
   */
  _buildInitFailureResponse(error, message) {
    return {
      success: false,
      error,
      message,
      retryable: true,
      tabs: []
    };
  }

  /**
   * Handle initialization barrier failure (completed but not initialized)
   * v1.6.3.7-v14 - FIX Complexity: Extracted to reduce _ensureInitialized cc
   * @private
   */
  _handleBarrierFailed(initDurationMs) {
    console.warn('[QuickTabHandler] INIT_BARRIER_FAILED:', {
      reason: 'initializeFn completed but isInitialized still false',
      durationMs: initDurationMs,
      timestamp: Date.now()
    });
    return this._buildInitFailureResponse(
      'NOT_INITIALIZED',
      'Background script still initializing. Please retry.'
    );
  }

  /**
   * Log initialization success
   * v1.6.3.7-v14 - FIX Complexity: Extracted logger
   * @private
   */
  _logInitComplete(initStartTime, initDurationMs) {
    console.log('[QuickTabHandler] INITIALIZATION_COMPLETE:', {
      recoveredAfterMs: initDurationMs,
      tabCount: this.globalState.tabs?.length || 0,
      initStartTime,
      initEndTime: Date.now()
    });
  }

  /**
   * Handle initialization error
   * v1.6.3.7-v14 - FIX Complexity: Extracted to reduce _ensureInitialized cc
   * @private
   */
  _handleInitError(err, initDurationMs) {
    const isTimeout = err.message === 'Initialization timeout';

    if (isTimeout) {
      console.error('[QuickTabHandler] INIT_TIMEOUT:', {
        durationMs: initDurationMs,
        expectedIsInitialized: true,
        actualIsInitialized: this.isInitialized,
        timeoutMs: INIT_TIMEOUT_MS,
        timestamp: Date.now()
      });
    } else {
      console.error('[QuickTabHandler] INIT_BARRIER_ERROR:', {
        error: err.message,
        isTimeout: false,
        durationMs: initDurationMs,
        timestamp: Date.now()
      });
    }

    const errorCode = isTimeout ? 'INIT_TIMEOUT' : 'INIT_ERROR';
    const message = isTimeout
      ? `Initialization timed out after ${INIT_TIMEOUT_MS}ms`
      : `Initialization error: ${err.message}`;
    return this._buildInitFailureResponse(errorCode, message);
  }

  /**
   * Ensure handler is initialized before operations
   * v1.6.3.6-v12 - FIX Issue #1: Extracted to reduce nesting depth
   * v1.6.3.7-v12 - Issue #7: Add explicit async barrier with await and timeout protection
   * v1.6.3.7-v13 - Issue #1: Enhanced logging with state transitions and recovery timing
   * v1.6.3.7-v14 - FIX Complexity: Extracted helper functions
   * @returns {Promise<Object>} Result with success flag
   * @private
   */
  async _ensureInitialized() {
    if (this.isInitialized) {
      return { success: true };
    }

    const initStartTime = Date.now();
    console.log('[QuickTabHandler] AWAITING_INITIALIZATION:', {
      isInitialized: this.isInitialized,
      initStartTime,
      timestamp: initStartTime
    });

    try {
      const initPromise = this.initializeFn();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Initialization timeout')), INIT_TIMEOUT_MS);
      });

      await Promise.race([initPromise, timeoutPromise]);

      const initDurationMs = Date.now() - initStartTime;

      if (!this.isInitialized) {
        return this._handleBarrierFailed(initDurationMs);
      }

      this._logInitComplete(initStartTime, initDurationMs);
      return { success: true };
    } catch (err) {
      return this._handleInitError(err, Date.now() - initStartTime);
    }
  }

  /**
   * Switch to a specific browser tab
   * Content scripts cannot use browser.tabs.update, so they must request this from background
   */
  async handleSwitchToTab(message, _sender) {
    try {
      const { tabId } = message;
      if (!tabId) {
        return {
          success: false,
          error: 'Missing tabId'
        };
      }

      await this.browserAPI.tabs.update(tabId, { active: true });
      return {
        success: true
      };
    } catch (err) {
      console.error('[QuickTabHandler] Error switching to tab:', err);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Save state to storage
   * v1.6.0.12 - FIX: Use local storage to avoid quota errors
   * v1.6.1.6 - FIX: Add writeSourceId to prevent feedback loop (memory leak fix)
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
   * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
   */
  async saveState(saveId, cookieStoreId, message) {
    const generatedSaveId = saveId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();

    // v1.6.3.7-v9 - FIX Issue #6: Get sequence ID for event ordering
    const sequenceId = QuickTabHandler._getNextSequenceId();
    // v1.6.3.8-v5 - FIX Issue #1: Get revision for monotonic versioning
    const revision = QuickTabHandler._getNextRevision();

    // v1.6.2.2 - Unified format: single tabs array
    const stateToSave = {
      tabs: this.globalState.tabs,
      saveId: generatedSaveId,
      sequenceId,
      revision,
      timestamp: Date.now(),
      writeSourceId: writeSourceId // v1.6.1.6 - Include source ID for loop detection
    };

    try {
      // v1.6.0.12 - FIX: Use local storage to avoid quota errors
      // v1.6.1.6 - FIX: Only write to local storage (removed session storage to prevent double events)
      await this.browserAPI.storage.local.set({
        quick_tabs_state_v2: stateToSave
      });

      // Broadcast to tabs in same container
      await this.broadcastToContainer(cookieStoreId, {
        action: 'CREATE_QUICK_TAB_FROM_BACKGROUND',
        id: message.id,
        url: message.url,
        left: message.left,
        top: message.top,
        width: message.width,
        height: message.height,
        title: message.title,
        cookieStoreId: cookieStoreId
      });
    } catch (err) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[QuickTabHandler] Error saving state:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        code: err?.code,
        error: err
      });
    }
  }

  /**
   * Save state to storage (simplified)
   * v1.6.0.12 - FIX: Use local storage to avoid quota errors
   * v1.6.1.6 - FIX: Add writeSourceId to prevent feedback loop (memory leak fix)
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   * v1.6.3.6-v4 - FIX Issue #1: Added success confirmation logging
   * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
   * v1.6.3.7-v9 - FIX Issue #8: Add storage write validation
   * v1.6.3.8-v2 - FIX Issue #5: Add STORAGE_WRITE_LATENCY and STORAGE_BACKPRESSURE_DETECTED logging
   * v1.6.3.8-v2 - FIX Issue #8: Use WriteBuffer for batching (accumulate 50-100ms before write)
   * @returns {Promise<void>} Resolves when state is buffered (actual write is deferred)
   */
  saveStateToStorage() {
    // v1.6.3.8-v2 - Issue #8: Buffer the state change instead of writing immediately
    // Update local state immediately but defer storage persistence
    // Returns synchronously since actual write is async and batched
    this._bufferStateForWrite();
    return Promise.resolve();
  }

  /**
   * Save state to storage immediately (bypasses WriteBuffer)
   * v1.6.3.8-v2 - FIX Issue #8: For callers who need to wait for actual write completion
   * Use this for critical operations like tab close where you need confirmation
   * @returns {Promise<void>} Resolves when storage write is complete
   */
  async saveStateToStorageImmediate() {
    // Cancel any pending buffered write
    if (this._writeBuffer.flushTimeoutId) {
      clearTimeout(this._writeBuffer.flushTimeoutId);
      this._writeBuffer.flushTimeoutId = null;
    }

    // Reset buffer state
    this._writeBuffer.pendingState = null;
    this._writeBuffer.pendingOperations = 0;

    // Perform immediate write
    await this._performStorageWrite(this.globalState.tabs, 1);
  }

  /**
   * Force flush any pending buffered writes
   * v1.6.3.8-v2 - Issue #8: For cleanup or ensuring writes complete before shutdown
   * @returns {Promise<void>} Resolves when buffered write is complete
   */
  async forceFlushWrites() {
    if (this._writeBuffer.pendingState) {
      await this._flushWriteBuffer();
    }
  }

  /**
   * Buffer state change for batched write
   * v1.6.3.8-v2 - FIX Issue #8: Accumulate changes over 50-100ms window
   * @private
   */
  _bufferStateForWrite() {
    // Increment pending operations count
    this._writeBuffer.pendingOperations++;

    // Store current state to write (overwrites previous pending state - we only need latest)
    this._writeBuffer.pendingState = {
      tabs: [...this.globalState.tabs] // Clone to capture current state
    };

    // If we've hit max pending operations, force flush immediately
    if (this._writeBuffer.pendingOperations >= WRITE_BUFFER_MAX_PENDING) {
      if (DEBUG_DIAGNOSTICS) {
        console.log('[QuickTabHandler] WRITE_BUFFER_FORCE_FLUSH: Max pending reached', {
          pendingOperations: this._writeBuffer.pendingOperations,
          maxPending: WRITE_BUFFER_MAX_PENDING
        });
      }
      this._flushWriteBuffer();
      return;
    }

    // Clear existing timeout if any
    if (this._writeBuffer.flushTimeoutId) {
      clearTimeout(this._writeBuffer.flushTimeoutId);
    }

    // Schedule flush after delay
    this._writeBuffer.flushTimeoutId = setTimeout(() => {
      this._flushWriteBuffer();
    }, WRITE_BUFFER_FLUSH_DELAY_MS);
  }

  /**
   * Flush buffered state to storage
   * v1.6.3.8-v2 - FIX Issue #8: Single atomic write for all accumulated changes
   * v1.6.3.8-v2 - FIX Issue #5: Track write latency and detect backpressure
   * @private
   */
  async _flushWriteBuffer() {
    // Clear timeout reference
    this._writeBuffer.flushTimeoutId = null;

    // Get pending state
    const pendingState = this._writeBuffer.pendingState;
    if (!pendingState) {
      return; // Nothing to write
    }

    // Reset buffer
    const pendingOperationCount = this._writeBuffer.pendingOperations;
    this._writeBuffer.pendingState = null;
    this._writeBuffer.pendingOperations = 0;
    this._writeBuffer.lastFlushTime = Date.now();

    // Perform the actual write
    await this._performStorageWrite(pendingState.tabs, pendingOperationCount);
  }

  /**
   * Perform actual storage write with latency tracking
   * v1.6.3.8-v2 - FIX Issue #5: Log STORAGE_WRITE_LATENCY and STORAGE_BACKPRESSURE_DETECTED
   * v1.6.3.8-v2 - FIX Issue #3: Track highest processed sequenceId
   * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
   * @private
   */
  async _performStorageWrite(tabs, batchedOperations = 1) {
    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();
    const tabCount = tabs?.length ?? 0;
    const saveTimestamp = Date.now();
    // v1.6.3.7-v9 - FIX Issue #8: Generate unique operation ID for tracing
    const operationId = `handler-${saveTimestamp}-${Math.random().toString(36).substring(2, 11)}`;

    // v1.6.3.7-v9 - FIX Issue #6: Get sequence ID for event ordering
    const sequenceId = QuickTabHandler._getNextSequenceId();
    // v1.6.3.8-v5 - FIX Issue #1: Get revision for monotonic versioning
    const revision = QuickTabHandler._getNextRevision();

    // v1.6.3.7-v9 - FIX Issue #8: Generate saveId for validation
    const saveId = `${saveTimestamp}-${Math.random().toString(36).substring(2, 11)}`;

    // v1.6.3.8-v2 - Issue #5: Track pending writes for backpressure detection
    this._pendingWritesCount++;

    // v1.6.3.6-v4 - FIX Issue #1: Log before storage write
    console.log('[QuickTabHandler] saveStateToStorage ENTRY:', {
      operationId,
      writeSourceId,
      saveId,
      sequenceId,
      revision,
      tabCount,
      batchedOperations, // v1.6.3.8-v2 - Issue #8: Log how many operations were batched
      pendingWrites: this._pendingWritesCount,
      timestamp: saveTimestamp
    });

    // v1.6.2.2 - Unified format: single tabs array
    const stateToSave = {
      tabs: tabs,
      saveId, // v1.6.3.7-v9 - FIX Issue #8: Add saveId for validation
      sequenceId,
      revision,
      timestamp: saveTimestamp,
      writeSourceId: writeSourceId // v1.6.1.6 - Include source ID for loop detection
    };

    // v1.6.3.8-v2 - Issue #5: Record write start time for latency measurement
    const writeStartTime = Date.now();

    try {
      // v1.6.0.12 - FIX: Use local storage to avoid quota errors
      // v1.6.1.6 - FIX: Only write to local storage (removed session storage to prevent double events)
      await this.browserAPI.storage.local.set({
        quick_tabs_state_v2: stateToSave
      });

      // v1.6.3.8-v2 - Issue #5: Calculate and log write latency
      const writeLatencyMs = Date.now() - writeStartTime;
      this._logWriteLatency(operationId, writeLatencyMs, tabCount);

      // v1.6.3.8-v2 - Issue #3: Update highest processed sequence ID
      QuickTabHandler._updateHighestProcessedSequenceId(sequenceId);

      // v1.6.3.8-v2 - Issue #8: Schedule validation via idle callback
      this._scheduleValidation(operationId, stateToSave, saveId, tabCount);

      // v1.6.3.6-v4 - FIX Issue #1: Log successful completion (was missing before!)
      console.log('[QuickTabHandler] saveStateToStorage SUCCESS:', {
        operationId,
        writeSourceId,
        saveId,
        sequenceId,
        tabCount,
        writeLatencyMs,
        batchedOperations,
        timestamp: saveTimestamp,
        tabIds: tabs.map(t => t.id).slice(0, 10) // First 10 IDs
      });
    } catch (err) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[QuickTabHandler] Error saving state:', {
        operationId,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        code: err?.code,
        error: err
      });
    } finally {
      // v1.6.3.8-v2 - Issue #5: Decrement pending writes count
      this._pendingWritesCount--;
    }
  }

  /**
   * Log write latency and detect backpressure
   * v1.6.3.8-v2 - FIX Issue #5: STORAGE_WRITE_LATENCY and STORAGE_BACKPRESSURE_DETECTED
   * @private
   */
  _logWriteLatency(operationId, writeLatencyMs, tabCount) {
    // Always log latency when DEBUG_DIAGNOSTICS enabled
    if (DEBUG_DIAGNOSTICS) {
      console.log('[QuickTabHandler] STORAGE_WRITE_LATENCY:', {
        operationId,
        latencyMs: writeLatencyMs,
        tabCount,
        pendingWrites: this._pendingWritesCount,
        timestamp: Date.now()
      });
    }

    // Log backpressure warning if write took too long
    if (writeLatencyMs > WRITE_BACKPRESSURE_THRESHOLD_MS) {
      console.warn('[QuickTabHandler] STORAGE_BACKPRESSURE_DETECTED:', {
        operationId,
        latencyMs: writeLatencyMs,
        thresholdMs: WRITE_BACKPRESSURE_THRESHOLD_MS,
        tabCount,
        pendingWrites: this._pendingWritesCount,
        recommendation: 'Consider reducing write frequency or enabling write batching',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Schedule storage validation via idle callback
   * v1.6.3.8-v2 - FIX Issue #8: Move validation to low-priority idle callback
   * @private
   */
  _scheduleValidation(operationId, stateToSave, saveId, tabCount) {
    // Use requestIdleCallback if available, otherwise use setTimeout
    const scheduleIdleTask =
      typeof requestIdleCallback === 'function'
        ? callback => requestIdleCallback(callback, { timeout: VALIDATION_IDLE_TIMEOUT_MS })
        : callback => setTimeout(callback, 0);

    scheduleIdleTask(async () => {
      try {
        const validationResult = await this._validateStorageWrite(operationId, stateToSave, saveId);

        if (!validationResult.valid) {
          console.error('[QuickTabHandler] STORAGE_VALIDATION_FAILED:', {
            operationId,
            saveId,
            error: validationResult.error,
            expectedTabCount: tabCount,
            actualTabCount: validationResult.actualTabCount
          });
          // Note: We don't retry here as the background.js handles recovery
          // This handler just reports the validation failure
        }
      } catch (err) {
        console.error('[QuickTabHandler] VALIDATION_IDLE_CALLBACK_ERROR:', {
          operationId,
          error: err?.message
        });
      }
    });
  }

  /**
   * Validate storage write by reading back and comparing
   * v1.6.3.7-v9 - FIX Issue #8: Detect IndexedDB corruption
   * v1.6.3.7-v12 - Issue #13: Add recovery strategy when validation fails
   * @private
   * @param {string} operationId - Operation ID for tracing
   * @param {Object} expectedState - State that was written
   * @param {string} saveId - SaveId to match
   * @returns {Promise<{valid: boolean, error: string|null, actualTabCount: number, recovered: boolean}>}
   */
  async _validateStorageWrite(operationId, expectedState, saveId) {
    const validationStartTime = Date.now();
    const context = { operationId, expectedState, saveId, validationStartTime };

    try {
      const result = await this.browserAPI.storage.local.get('quick_tabs_state_v2');
      const readBack = result?.quick_tabs_state_v2;

      // Run validation checks and return appropriate result
      return await this._runStorageValidationChecks(context, readBack);
    } catch (err) {
      return this._handleStorageValidationError(context, err);
    }
  }

  /**
   * Run storage validation checks and return result
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce _validateStorageWrite complexity
   * v1.6.3.7-v14 - FIX Complexity: Extract success path
   * @private
   */
  async _runStorageValidationChecks(context, readBack) {
    // Check if data exists
    if (!readBack) {
      const result = await this._handleNullReadValidationFailure(context);
      return result;
    }

    // Check saveId matches
    if (readBack.saveId !== context.saveId) {
      return this._handleSaveIdMismatch(context, readBack);
    }

    // Check tab count matches
    const actualCount = readBack?.tabs?.length || 0;
    if (context.expectedState?.tabs?.length !== actualCount) {
      const result = await this._handleTabCountMismatch(
        context,
        readBack,
        context.expectedState?.tabs?.length || 0,
        actualCount
      );
      return result;
    }

    return this._handleValidationSuccess(context, actualCount);
  }

  /**
   * Handle successful validation
   * v1.6.3.7-v14 - FIX Complexity: Extracted success path
   * @private
   */
  _handleValidationSuccess(context, actualCount) {
    console.log('[QuickTabHandler] STORAGE_VALIDATION_PASSED:', {
      operationId: context.operationId,
      saveId: context.saveId,
      tabCount: actualCount,
      validationDurationMs: Date.now() - context.validationStartTime
    });
    return { valid: true, error: null, actualTabCount: actualCount, recovered: false };
  }

  /**
   * Handle null read validation failure
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
   * @private
   */
  async _handleNullReadValidationFailure(context) {
    const { operationId, expectedState, validationStartTime } = context;

    console.error('[QuickTabHandler] VALIDATION_FAILED_NULL_READ:', {
      operationId,
      expectedTabCount: expectedState?.tabs?.length || 0,
      validationDurationMs: Date.now() - validationStartTime,
      timestamp: Date.now()
    });

    const recoveryResult = await this._attemptRecoveryOnValidationFailure(
      operationId,
      expectedState,
      'READ_RETURNED_NULL'
    );

    return {
      valid: false,
      error: 'READ_RETURNED_NULL',
      actualTabCount: 0,
      recovered: recoveryResult.recovered
    };
  }

  /**
   * Handle saveId mismatch validation failure
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
   * v1.6.3.7-v14 - FIX Complexity: Simplified structure
   * @private
   */
  _handleSaveIdMismatch(context, readBack) {
    this._logSaveIdMismatchError(context, readBack);
    return this._buildValidationFailure('SAVEID_MISMATCH', readBack?.tabs?.length || 0, false);
  }

  /**
   * Log saveId mismatch error
   * v1.6.3.7-v14 - FIX Complexity: Extracted logger
   * @private
   */
  _logSaveIdMismatchError(context, readBack) {
    console.error('[QuickTabHandler] VALIDATION_FAILED_SAVEID_MISMATCH:', {
      operationId: context.operationId,
      expectedSaveId: context.saveId,
      actualSaveId: readBack.saveId,
      expectedTabCount: context.expectedState?.tabs?.length || 0,
      actualTabCount: readBack?.tabs?.length || 0,
      validationDurationMs: Date.now() - context.validationStartTime,
      timestamp: Date.now()
    });
  }

  /**
   * Build validation failure response
   * v1.6.3.7-v14 - FIX Complexity: Unified failure builder
   * @private
   */
  _buildValidationFailure(error, actualTabCount, recovered) {
    return { valid: false, error, actualTabCount, recovered };
  }

  /**
   * Handle tab count mismatch validation failure
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
   * @private
   */
  async _handleTabCountMismatch(context, readBack, expectedCount, actualCount) {
    const { operationId, expectedState, validationStartTime } = context;

    console.error('[QuickTabHandler] VALIDATION_FAILED_TAB_COUNT_MISMATCH:', {
      operationId,
      expectedTabCount: expectedCount,
      actualTabCount: actualCount,
      difference: expectedCount - actualCount,
      validationDurationMs: Date.now() - validationStartTime,
      timestamp: Date.now()
    });

    const recoveryResult = await this._attemptRecoveryOnValidationFailure(
      operationId,
      expectedState,
      'TAB_COUNT_MISMATCH'
    );

    return {
      valid: false,
      error: 'TAB_COUNT_MISMATCH',
      actualTabCount: actualCount,
      recovered: recoveryResult.recovered
    };
  }

  /**
   * Handle storage validation error
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
   * @private
   */
  _handleStorageValidationError(context, err) {
    const { operationId, validationStartTime } = context;

    console.error('[QuickTabHandler] STORAGE_VALIDATION_ERROR:', {
      operationId,
      error: err.message,
      validationDurationMs: Date.now() - validationStartTime
    });
    return {
      valid: false,
      error: `VALIDATION_ERROR: ${err.message}`,
      actualTabCount: 0,
      recovered: false
    };
  }

  /**
   * Attempt recovery when storage validation fails
   * v1.6.3.7-v12 - Issue #13: Recovery strategy for validation failures
   * v1.6.3.7-v12 - FIX ESLint: Reduced complexity via extracted helpers
   * @private
   */
  async _attemptRecoveryOnValidationFailure(operationId, expectedState, failureType) {
    console.log('[QuickTabHandler] RECOVERY_ATTEMPT_STARTED:', {
      operationId,
      failureType,
      expectedTabCount: expectedState?.tabs?.length || 0,
      timestamp: Date.now()
    });

    try {
      const needsRecovery =
        failureType === 'READ_RETURNED_NULL' || failureType === 'TAB_COUNT_MISMATCH';
      if (needsRecovery) {
        return await this._performRewriteRecovery(operationId, expectedState, failureType);
      }

      return { recovered: false, method: 'none' };
    } catch (recoveryErr) {
      console.error('[QuickTabHandler] RECOVERY_ERROR:', {
        operationId,
        error: recoveryErr.message,
        failureType,
        timestamp: Date.now()
      });
      return { recovered: false, method: 'error' };
    }
  }

  /**
   * Perform re-write recovery strategy
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
   * @private
   */
  async _performRewriteRecovery(operationId, expectedState, failureType) {
    console.log('[QuickTabHandler] RECOVERY_STRATEGY: Re-write state to storage');

    // v1.6.3.7-v12 - FIX Code Review: Use slice() instead of deprecated substr()
    const recoverySaveId = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    // v1.6.3.8-v5 - FIX Issue #1: Add sequenceId and revision for monotonic versioning
    const recoverySequenceId = QuickTabHandler._getNextSequenceId();
    const recoveryRevision = QuickTabHandler._getNextRevision();
    const recoveryState = {
      ...expectedState,
      saveId: recoverySaveId,
      sequenceId: recoverySequenceId,
      revision: recoveryRevision,
      recoveredFrom: failureType,
      recoveryTimestamp: Date.now()
    };

    await this.browserAPI.storage.local.set({
      quick_tabs_state_v2: recoveryState
    });

    const isRecovered = await this._verifyRecoveryWrite(operationId, recoverySaveId, expectedState);

    if (isRecovered) {
      return { recovered: true, method: 're-write' };
    }

    console.error('[QuickTabHandler] RECOVERY_FAILED:', {
      operationId,
      failureType,
      recommendation: 'User may need to manually clear storage or re-create Quick Tabs',
      timestamp: Date.now()
    });

    return { recovered: false, method: 'none' };
  }

  /**
   * Verify recovery write succeeded
   * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce complexity
   * v1.6.3.7-v14 - FIX Complexity: Extracted helpers for verification
   * @private
   */
  async _verifyRecoveryWrite(operationId, recoverySaveId, expectedState) {
    const verifyData = await this._fetchVerificationData();

    const saveIdMatches = this._verifySaveId(verifyData, recoverySaveId);
    const tabCountMatches = this._verifyTabCount(verifyData, expectedState);

    if (saveIdMatches && tabCountMatches) {
      return this._logRecoverySuccess(operationId, recoverySaveId, verifyData);
    }

    this._logPartialVerificationIfNeeded({
      operationId,
      recoverySaveId,
      saveIdMatches,
      tabCountMatches,
      expectedState,
      verifyData
    });
    return false;
  }

  /**
   * Fetch verification data from storage
   * v1.6.3.7-v14 - FIX Complexity: Extracted from _verifyRecoveryWrite
   * @private
   */
  async _fetchVerificationData() {
    const verifyResult = await this.browserAPI.storage.local.get('quick_tabs_state_v2');
    return verifyResult?.quick_tabs_state_v2;
  }

  /**
   * Verify saveId matches expected value
   * v1.6.3.7-v14 - FIX Complexity: Extracted from _verifyRecoveryWrite
   * @private
   */
  _verifySaveId(verifyData, recoverySaveId) {
    return verifyData && verifyData.saveId === recoverySaveId;
  }

  /**
   * Verify tab count matches expected value
   * v1.6.3.7-v14 - FIX Complexity: Extracted from _verifyRecoveryWrite
   * @private
   */
  _verifyTabCount(verifyData, expectedState) {
    return verifyData?.tabs?.length === expectedState?.tabs?.length;
  }

  /**
   * Log and return recovery success
   * v1.6.3.7-v14 - FIX Complexity: Extracted from _verifyRecoveryWrite
   * @private
   */
  _logRecoverySuccess(operationId, recoverySaveId, verifyData) {
    console.log('[QuickTabHandler] RECOVERY_SUCCESS:', {
      operationId,
      method: 're-write',
      recoverySaveId,
      tabCount: verifyData?.tabs?.length || 0,
      saveIdVerified: true,
      tabCountVerified: true,
      timestamp: Date.now()
    });
    return true;
  }

  /**
   * Log partial verification failure if applicable
   * v1.6.3.7-v14 - FIX Complexity: Extracted from _verifyRecoveryWrite
   * v1.6.3.7-v14 - FIX Excess Args: Use context object pattern
   * v1.6.3.7-v14 - FIX Code Review: Explicit boolean variable for clarity
   * @private
   * @param {Object} context - Verification context
   */
  _logPartialVerificationIfNeeded(context) {
    const {
      operationId,
      recoverySaveId,
      saveIdMatches,
      tabCountMatches,
      expectedState,
      verifyData
    } = context;
    const neitherMatched = !saveIdMatches && !tabCountMatches;
    if (neitherMatched) return;

    console.warn('[QuickTabHandler] RECOVERY_PARTIAL_VERIFICATION:', {
      operationId,
      recoverySaveId,
      saveIdMatches,
      tabCountMatches,
      expectedTabCount: expectedState?.tabs?.length || 0,
      actualTabCount: verifyData?.tabs?.length || 0,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast message to all tabs in container
   */
  async broadcastToContainer(cookieStoreId, messageData) {
    try {
      const tabs = await this.browserAPI.tabs.query({ cookieStoreId });

      await Promise.allSettled(
        tabs.map(tab => this.browserAPI.tabs.sendMessage(tab.id, messageData).catch(() => {}))
      );
    } catch (err) {
      console.error('[QuickTabHandler] Error broadcasting:', err);
    }
  }
}
