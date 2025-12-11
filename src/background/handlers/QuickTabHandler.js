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
 */

// v1.6.3.7-v12 - Issue #7: Initialization barrier timeout constant (code review fix)
const INIT_TIMEOUT_MS = 10000;

export class QuickTabHandler {
  // v1.6.2.4 - Message deduplication constants for Issue 4 fix
  // 100ms: Typical double-fire interval for keyboard/context menu events is <10ms
  // Using 100ms provides safety margin while not blocking legitimate rapid operations
  static DEDUP_WINDOW_MS = 100;
  // 5000ms: Cleanup interval balances memory usage vs CPU overhead
  static DEDUP_CLEANUP_INTERVAL_MS = 5000;
  // 10000ms: TTL keeps entries long enough for debugging but prevents memory bloat
  static DEDUP_TTL_MS = 10000;

  // v1.6.3.7-v9 - FIX Issue #6: Sequence ID for event ordering
  // Uses a static counter shared across all handler instances
  static _sequenceId = 0;

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
      currentSize: { width: tab.width, height: tab.height }
    });

    updateFn(tab, message);
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
      cookieStoreId: cookieStoreId // v1.6.2.2 - Store container info on tab itself
    };

    if (existingIndex !== -1) {
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
    this._logSimpleUpdate('Pin Update', 'UPDATE_QUICK_TAB_PIN', message, { pinnedToUrl: message.pinnedToUrl });
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
    this._logSimpleUpdate('Minimize Update', 'UPDATE_QUICK_TAB_MINIMIZE', message, { minimized: message.minimized });
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
    this._logSimpleUpdate('Z-Index Update', 'UPDATE_QUICK_TAB_ZINDEX', message, { zIndex: message.zIndex });
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
   * @returns {{ success: boolean, tabId: number|null, error?: string }}
   */
  handleGetCurrentTabId(_message, sender) {
    // v1.6.3.6-v4 - FIX Issue #1: ALWAYS use sender.tab.id - this is the ACTUAL requesting tab
    // sender.tab is populated by Firefox for all messages from content scripts
    if (sender.tab && typeof sender.tab.id === 'number') {
      console.log(
        `[QuickTabHandler] GET_CURRENT_TAB_ID: returning sender.tab.id=${sender.tab.id} (actual requesting tab)`
      );
      return { success: true, tabId: sender.tab.id };
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

    console.error(
      '[QuickTabHandler] GET_CURRENT_TAB_ID: sender.tab not available - cannot determine requesting tab ID'
    );
    console.error(
      '[QuickTabHandler] This should not happen for content scripts. Check if message came from non-tab context.'
    );
    return {
      success: false,
      tabId: null,
      error: 'sender.tab not available - cannot identify requesting tab'
    };
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
    return this._buildInitFailureResponse('NOT_INITIALIZED', 'Background script still initializing. Please retry.');
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
   */
  async saveState(saveId, cookieStoreId, message) {
    const generatedSaveId = saveId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();

    // v1.6.3.7-v9 - FIX Issue #6: Get sequence ID for event ordering
    const sequenceId = QuickTabHandler._getNextSequenceId();

    // v1.6.2.2 - Unified format: single tabs array
    const stateToSave = {
      tabs: this.globalState.tabs,
      saveId: generatedSaveId,
      sequenceId,
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
   */
  async saveStateToStorage() {
    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();
    const tabCount = this.globalState.tabs?.length ?? 0;
    const saveTimestamp = Date.now();
    // v1.6.3.7-v9 - FIX Issue #8: Generate unique operation ID for tracing
    const operationId = `handler-${saveTimestamp}-${Math.random().toString(36).substring(2, 11)}`;

    // v1.6.3.7-v9 - FIX Issue #6: Get sequence ID for event ordering
    const sequenceId = QuickTabHandler._getNextSequenceId();
    
    // v1.6.3.7-v9 - FIX Issue #8: Generate saveId for validation
    const saveId = `${saveTimestamp}-${Math.random().toString(36).substring(2, 11)}`;

    // v1.6.3.6-v4 - FIX Issue #1: Log before storage write
    console.log('[QuickTabHandler] saveStateToStorage ENTRY:', {
      operationId,
      writeSourceId,
      saveId,
      sequenceId,
      tabCount,
      timestamp: saveTimestamp
    });

    // v1.6.2.2 - Unified format: single tabs array
    const stateToSave = {
      tabs: this.globalState.tabs,
      saveId, // v1.6.3.7-v9 - FIX Issue #8: Add saveId for validation
      sequenceId,
      timestamp: saveTimestamp,
      writeSourceId: writeSourceId // v1.6.1.6 - Include source ID for loop detection
    };

    try {
      // v1.6.0.12 - FIX: Use local storage to avoid quota errors
      // v1.6.1.6 - FIX: Only write to local storage (removed session storage to prevent double events)
      await this.browserAPI.storage.local.set({
        quick_tabs_state_v2: stateToSave
      });

      // v1.6.3.7-v9 - FIX Issue #8: Validate the write by reading back
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

      // v1.6.3.6-v4 - FIX Issue #1: Log successful completion (was missing before!)
      console.log('[QuickTabHandler] saveStateToStorage SUCCESS:', {
        operationId,
        writeSourceId,
        saveId,
        sequenceId,
        tabCount,
        validated: validationResult.valid,
        timestamp: saveTimestamp,
        tabIds: this.globalState.tabs.map(t => t.id).slice(0, 10) // First 10 IDs
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
    }
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
      return this._handleNullReadValidationFailure(context);
    }
    
    // Check saveId matches
    if (readBack.saveId !== context.saveId) {
      return this._handleSaveIdMismatch(context, readBack);
    }
    
    // Check tab count matches
    const actualCount = readBack?.tabs?.length || 0;
    if (context.expectedState?.tabs?.length !== actualCount) {
      return this._handleTabCountMismatch(context, readBack, context.expectedState?.tabs?.length || 0, actualCount);
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
      operationId, expectedState, 'READ_RETURNED_NULL'
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
      operationId, expectedState, 'TAB_COUNT_MISMATCH'
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
    return { valid: false, error: `VALIDATION_ERROR: ${err.message}`, actualTabCount: 0, recovered: false };
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
      const needsRecovery = failureType === 'READ_RETURNED_NULL' || failureType === 'TAB_COUNT_MISMATCH';
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
    const recoveryState = {
      ...expectedState,
      saveId: recoverySaveId,
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
    
    this._logPartialVerificationIfNeeded({ operationId, recoverySaveId, saveIdMatches, tabCountMatches, expectedState, verifyData });
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
    const { operationId, recoverySaveId, saveIdMatches, tabCountMatches, expectedState, verifyData } = context;
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
