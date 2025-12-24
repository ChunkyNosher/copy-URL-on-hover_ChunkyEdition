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
 * v1.6.3.10-v7 - FIX Issue #15: Storage write serialization
 *   - Add async write queue to prevent concurrent storage writes
 *   - Implement version tracking with conflict detection
 *   - Retry writes on version mismatch (max 3 attempts)
 */

// v1.6.3.10-v7 - FIX Issue #15: Storage write serialization constants
const STORAGE_WRITE_MAX_RETRIES = 3;
const STORAGE_KEY = 'quick_tabs_state_v2';

export class QuickTabHandler {
  // v1.6.2.4 - Message deduplication constants for Issue 4 fix
  // 100ms: Typical double-fire interval for keyboard/context menu events is <10ms
  // Using 100ms provides safety margin while not blocking legitimate rapid operations
  static DEDUP_WINDOW_MS = 100;
  // 5000ms: Cleanup interval balances memory usage vs CPU overhead
  static DEDUP_CLEANUP_INTERVAL_MS = 5000;
  // 10000ms: TTL keeps entries long enough for debugging but prevents memory bloat
  static DEDUP_TTL_MS = 10000;

  constructor(globalState, stateCoordinator, browserAPI, initializeFn) {
    this.globalState = globalState;
    this.stateCoordinator = stateCoordinator;
    this.browserAPI = browserAPI;
    this.initializeFn = initializeFn;
    this.isInitialized = false;

    // v1.6.3.10-v7 - FIX Issue #16 & #7: Track first init attempt for duration logging
    this._firstInitAttemptTime = null;

    // v1.6.1.6 - Memory leak fix: Track last write to detect self-triggered storage events
    this.lastWriteTimestamp = null;
    this.WRITE_IGNORE_WINDOW_MS = 100;

    // v1.6.2.4 - BUG FIX Issue 4: Message deduplication tracking
    // Prevents duplicate CREATE_QUICK_TAB messages sent within 100ms
    this.processedMessages = new Map(); // messageKey -> timestamp
    this.lastCleanup = Date.now();

    // v1.6.3.10-v7 - FIX Issue #15: Storage write serialization
    // Queue to serialize concurrent storage writes
    this._writeQueue = [];
    this._isWriting = false;
    // Version counter for optimistic locking
    this._storageVersion = 0;
    // Expected version from last read (for conflict detection)
    this._expectedVersion = 0;
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
    // v1.6.3.10-v7 - FIX Issue #7: Log initialization state changes with [InitBoundary]
    if (value) {
      const duration = this._firstInitAttemptTime ? Date.now() - this._firstInitAttemptTime : 0;
      console.log(`[InitBoundary] QuickTabHandler initialized ${duration}ms`, {
        tabCount: this.globalState.tabs?.length ?? 0,
        globalStateReady: Array.isArray(this.globalState.tabs)
      });
    } else {
      // Reset timing when initialization is reset
      console.log('[InitBoundary] QuickTabHandler initialization reset');
      this._firstInitAttemptTime = null;
    }
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
   */
  async handleBatchUpdate(message, sender) {
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
   * Handle pin update
   * v1.6.0.13 - Added logging
   */
  handlePinUpdate(message, _sender) {
    console.log('[QuickTabHandler] Pin Update:', {
      action: 'UPDATE_QUICK_TAB_PIN',
      quickTabId: message.id,
      pinnedToUrl: message.pinnedToUrl,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.pinnedToUrl = msg.pinnedToUrl;
    });
  }

  /**
   * Handle solo update
   * v1.6.0.13 - Added logging
   */
  handleSoloUpdate(message, _sender) {
    console.log('[QuickTabHandler] Solo Update:', {
      action: 'UPDATE_QUICK_TAB_SOLO',
      quickTabId: message.id,
      soloedOnTabs: message.soloedOnTabs || [],
      tabCount: (message.soloedOnTabs || []).length,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.soloedOnTabs = msg.soloedOnTabs || [];
    });
  }

  /**
   * Handle mute update
   * v1.6.0.13 - Added logging
   */
  handleMuteUpdate(message, _sender) {
    console.log('[QuickTabHandler] Mute Update:', {
      action: 'UPDATE_QUICK_TAB_MUTE',
      quickTabId: message.id,
      mutedOnTabs: message.mutedOnTabs || [],
      tabCount: (message.mutedOnTabs || []).length,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.mutedOnTabs = msg.mutedOnTabs || [];
    });
  }

  /**
   * Handle minimize update
   * v1.6.0.13 - Added logging
   */
  handleMinimizeUpdate(message, _sender) {
    console.log('[QuickTabHandler] Minimize Update:', {
      action: 'UPDATE_QUICK_TAB_MINIMIZE',
      quickTabId: message.id,
      minimized: message.minimized,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.minimized = msg.minimized;
    });
  }

  /**
   * Handle z-index update
   * v1.6.0.12 - NEW: Save z-index for cross-tab sync
   * v1.6.0.13 - Added logging
   */
  handleZIndexUpdate(message, _sender) {
    console.log('[QuickTabHandler] Z-Index Update:', {
      action: 'UPDATE_QUICK_TAB_ZINDEX',
      quickTabId: message.id,
      zIndex: message.zIndex,
      cookieStoreId: message.cookieStoreId || 'firefox-default',
      timestamp: Date.now()
    });

    return this.updateQuickTabProperty(message, (tab, msg) => {
      tab.zIndex = msg.zIndex;
    });
  }

  /**
   * Build error response for GET_CURRENT_TAB_ID
   * v1.6.4.15 - FIX Code Health: Extracted to reduce complexity
   * @private
   */
  _buildTabIdErrorResponse(error, code, message = null, retryable = false) {
    return {
      success: false,
      data: { currentTabId: null },
      tabId: null,
      error,
      code,
      ...(message && { message }),
      ...(retryable && { retryable })
    };
  }

  /**
   * Build success response for GET_CURRENT_TAB_ID
   * v1.6.4.15 - FIX Code Health: Extracted to reduce complexity
   * @private
   */
  _buildTabIdSuccessResponse(tabId) {
    return { 
      success: true, 
      data: { currentTabId: tabId },
      tabId // Keep for backward compatibility
    };
  }

  /**
   * Check if sender has a valid tab ID
   * v1.6.4.15 - FIX Code Health: Extracted to reduce handleGetCurrentTabId complexity
   * @private
   */
  _hasValidSenderTabId(sender) {
    return sender?.tab && typeof sender.tab.id === 'number';
  }

  /**
   * Get current tab ID
   * v1.6.2.4 - FIX Issue #4: Add fallback when sender.tab is unavailable
   * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #1: ALWAYS prioritize sender.tab.id
   * v1.6.3.10-v7 - FIX Bug #1: Add initialization guard to prevent race conditions
   * v1.6.4.15 - FIX Issue #15: Consistent response envelope with code field
   * v1.6.4.15 - FIX Code Health: Extracted helpers to reduce complexity
   *
   * @param {Object} _message - Message object (unused, required by message router signature)
   * @param {Object} sender - Message sender object containing tab information
   * @returns {Promise<{ success: boolean, data?: { currentTabId: number }, error?: string, code?: string }>}
   */
  async handleGetCurrentTabId(_message, sender) {
    try {
      // v1.6.3.10-v7 - FIX Bug #1: Check initialization FIRST
      const initResult = await this._ensureInitialized();
      if (!initResult.success) {
        console.warn('[QuickTabHandler] GET_CURRENT_TAB_ID: Init check failed');
        return this._buildTabIdErrorResponse(
          initResult.error || 'NOT_INITIALIZED',
          initResult.error || 'NOT_INITIALIZED',
          initResult.message,
          initResult.retryable ?? true
        );
      }

      // v1.6.3.6-v4 - FIX Issue #1: ALWAYS use sender.tab.id
      if (this._hasValidSenderTabId(sender)) {
        console.log(`[QuickTabHandler] GET_CURRENT_TAB_ID: returning sender.tab.id=${sender.tab.id}`);
        return this._buildTabIdSuccessResponse(sender.tab.id);
      }

      // sender.tab not available - return error
      console.error('[QuickTabHandler] GET_CURRENT_TAB_ID: sender.tab not available');
      return this._buildTabIdErrorResponse(
        'sender.tab not available - cannot identify requesting tab',
        'SENDER_TAB_UNAVAILABLE'
      );
    } catch (err) {
      console.error('[QuickTabHandler] GET_CURRENT_TAB_ID error:', err?.message);
      return this._buildTabIdErrorResponse(err?.message || 'Unknown error', 'HANDLER_ERROR');
    }
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
   */
  async handleGetQuickTabsState(message, _sender) {
    try {
      // v1.6.3.6-v12 - FIX Issue #1: Check initialization and wait with timeout
      const initResult = await this._ensureInitialized();
      if (!initResult.success) {
        return initResult;
      }

      const cookieStoreId = message.cookieStoreId || 'firefox-default';

      // v1.6.2.2 - Return all tabs from unified array for global visibility
      const allTabs = this.globalState.tabs || [];

      return {
        success: true,
        tabs: allTabs,
        cookieStoreId: cookieStoreId,
        lastUpdate: this.globalState.lastUpdate
      };
    } catch (err) {
      console.error('[QuickTabHandler] Error getting Quick Tabs state:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        code: err?.code,
        error: err
      });
      return {
        success: false,
        tabs: [],
        error: err.message
      };
    }
  }

  /**
   * Ensure handler is initialized before operations
   * v1.6.3.6-v12 - FIX Issue #1: Extracted to reduce nesting depth
   * v1.6.3.10-v7 - FIX Issue #16: Enhanced with dependency validation and [InitBoundary] logging
   *   Validates that globalState.tabs is an array to ensure storage has been loaded.
   * @returns {Promise<Object>} Result with success flag
   * @private
   */
  async _ensureInitialized() {
    const attemptStartTime = Date.now();

    // Fast path: already initialized and dependencies ready
    if (this.isInitialized && this._isGlobalStateReady()) {
      return { success: true };
    }

    // Track first init attempt time for overall duration logging
    if (!this._firstInitAttemptTime) {
      this._firstInitAttemptTime = attemptStartTime;
    }

    console.log('[InitBoundary] QuickTabHandler _ensureInitialized waiting', {
      isInitialized: this.isInitialized,
      globalStateReady: this._isGlobalStateReady(),
      globalStateTabsType: typeof this.globalState.tabs
    });

    await this.initializeFn();

    // v1.6.3.10-v7 - FIX Issue #16: Validate dependencies after init attempt
    const globalStateReady = this._isGlobalStateReady();
    const attemptDuration = Date.now() - attemptStartTime;

    if (!this.isInitialized) {
      console.warn('[InitBoundary] QuickTabHandler init failed', {
        attemptDuration: `${attemptDuration}ms`,
        isInitialized: this.isInitialized,
        globalStateReady
      });
      return {
        success: false,
        error: 'NOT_INITIALIZED',
        message: 'Background script still initializing. Please retry.',
        retryable: true,
        tabs: []
      };
    }

    // v1.6.3.10-v7 - FIX Issue #16: Check globalState.tabs is actually ready
    if (!globalStateReady) {
      console.warn('[InitBoundary] QuickTabHandler init incomplete - globalState.tabs not ready', {
        attemptDuration: `${attemptDuration}ms`,
        globalStateTabsType: typeof this.globalState.tabs,
        globalStateTabsIsArray: Array.isArray(this.globalState.tabs)
      });
      return {
        success: false,
        error: 'GLOBAL_STATE_NOT_READY',
        message: 'Storage not yet loaded. Please retry.',
        retryable: true,
        tabs: []
      };
    }

    console.log('[InitBoundary] QuickTabHandler _ensureInitialized completed', {
      attemptDuration: `${attemptDuration}ms`,
      tabCount: this.globalState.tabs.length
    });

    return { success: true };
  }

  /**
   * Check if globalState is ready (tabs array exists)
   * v1.6.3.10-v7 - FIX Issue #16: Validates storage is loaded by checking globalState.tabs is array
   * @returns {boolean} True if globalState.tabs is a valid array
   * @private
   */
  _isGlobalStateReady() {
    return Array.isArray(this.globalState.tabs);
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
   */
  async saveState(saveId, cookieStoreId, message) {
    const generatedSaveId = saveId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();

    // v1.6.2.2 - Unified format: single tabs array
    const stateToSave = {
      tabs: this.globalState.tabs,
      saveId: generatedSaveId,
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
   * v1.6.3.10-v7 - FIX Issue #15: Serialize writes through queue to prevent concurrent write races
   */
  saveStateToStorage() {
    // v1.6.3.10-v7 - FIX Issue #15: Use queue-based serialization
    return this._enqueueStorageWrite();
  }

  /**
   * Enqueue a storage write operation
   * v1.6.3.10-v7 - FIX Issue #15: Serialize concurrent writes through queue
   * @private
   * @returns {Promise<void>} Resolves when write completes
   */
  _enqueueStorageWrite() {
    return new Promise((resolve, reject) => {
      this._writeQueue.push({ resolve, reject, enqueuedAt: Date.now() });
      console.debug('[QuickTabHandler] 🔒 WRITE_QUEUE: Enqueued write, queue size:', this._writeQueue.length);
      this._processWriteQueue();
    });
  }

  /**
   * Process the storage write queue
   * v1.6.3.10-v7 - FIX Issue #15: Sequential processing prevents concurrent writes
   * @private
   */
  async _processWriteQueue() {
    // If already writing, wait for current write to finish
    if (this._isWriting) {
      return;
    }

    // Get next write from queue
    const nextWrite = this._writeQueue.shift();
    if (!nextWrite) {
      return;
    }

    this._isWriting = true;
    const queueWaitTime = Date.now() - nextWrite.enqueuedAt;

    try {
      await this._performStorageWrite(queueWaitTime);
      nextWrite.resolve();
    } catch (err) {
      nextWrite.reject(err);
    } finally {
      this._isWriting = false;
      // Process next item in queue if any
      if (this._writeQueue.length > 0) {
        this._processWriteQueue();
      }
    }
  }

  /**
   * Perform the actual storage write with version tracking
   * v1.6.3.10-v7 - FIX Issue #15: Includes optimistic locking with retry
   * @private
   * @param {number} queueWaitTime - Time spent waiting in queue (for logging)
   */
  async _performStorageWrite(queueWaitTime) {
    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();
    const tabCount = this.globalState.tabs?.length ?? 0;
    const saveTimestamp = Date.now();

    // v1.6.3.6-v4 - FIX Issue #1: Log before storage write
    console.log('[QuickTabHandler] saveStateToStorage ENTRY:', {
      writeSourceId,
      tabCount,
      timestamp: saveTimestamp,
      queueWaitTime,
      version: this._storageVersion
    });

    // v1.6.3.10-v7 - FIX Issue #15: Retry loop for version conflicts
    let retryCount = 0;
    while (retryCount < STORAGE_WRITE_MAX_RETRIES) {
      const result = await this._attemptStorageWrite(writeSourceId, tabCount, saveTimestamp, retryCount);
      if (result.success) {
        return; // Success - exit retry loop
      }
      retryCount++;
      if (retryCount >= STORAGE_WRITE_MAX_RETRIES) {
        throw result.error; // Max retries reached, propagate error
      }
    }
  }

  /**
   * Attempt a single storage write operation
   * v1.6.3.10-v7 - FIX Issue #15: Extracted to reduce nesting depth
   * @private
   * @returns {Promise<{success: boolean, error?: Error}>}
   */
  async _attemptStorageWrite(writeSourceId, tabCount, saveTimestamp, retryCount) {
    try {
      // Read current version from storage to detect conflicts
      const currentState = await this.browserAPI.storage.local.get(STORAGE_KEY);
      const storedVersion = currentState[STORAGE_KEY]?.version ?? 0;

      // Check for version conflict (another writer updated storage)
      this._handleVersionConflict(currentState, storedVersion, retryCount);

      // Increment version for this write
      const newVersion = Math.max(storedVersion, this._storageVersion) + 1;

      // v1.6.2.2 - Unified format: single tabs array
      const stateToSave = {
        tabs: this.globalState.tabs,
        timestamp: saveTimestamp,
        writeSourceId: writeSourceId, // v1.6.1.6 - Include source ID for loop detection
        version: newVersion // v1.6.3.10-v7 - Version for conflict detection
      };

      // v1.6.0.12 - FIX: Use local storage to avoid quota errors
      await this.browserAPI.storage.local.set({
        [STORAGE_KEY]: stateToSave
      });

      // Update our version tracking
      this._storageVersion = newVersion;
      this._expectedVersion = newVersion;

      // v1.6.3.6-v4 - FIX Issue #1: Log successful completion
      console.log('[QuickTabHandler] saveStateToStorage SUCCESS:', {
        writeSourceId,
        tabCount,
        timestamp: saveTimestamp,
        version: newVersion,
        tabIds: this.globalState.tabs.map(t => t.id).slice(0, 10) // First 10 IDs
      });

      return { success: true };
    } catch (err) {
      // DOMException and browser-native errors don't serialize properly
      console.error('[QuickTabHandler] Error saving state (attempt ' + (retryCount + 1) + '):', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        code: err?.code,
        error: err
      });
      return { success: false, error: err };
    }
  }

  /**
   * Handle version conflict during storage write
   * v1.6.3.10-v7 - FIX Issue #15: Extracted to reduce nesting depth
   * @private
   */
  _handleVersionConflict(currentState, storedVersion, retryCount) {
    if (storedVersion <= this._expectedVersion || this._expectedVersion === 0) {
      return; // No conflict
    }

    console.error('[QuickTabHandler] ❌ VERSION_CONFLICT: Storage modified by another writer', {
      expectedVersion: this._expectedVersion,
      storedVersion,
      retryCount
    });

    // Update our expected version and globalState from storage
    this._expectedVersion = storedVersion;
    const storedTabs = currentState[STORAGE_KEY]?.tabs;
    if (!Array.isArray(storedTabs)) {
      return;
    }

    // Merge: rebuild globalState from storage (trigger rebuild)
    console.warn('[QuickTabHandler] Triggering state rebuild from storage');
    this.globalState.tabs = storedTabs;
  }

  /**
   * Update expected version after reading from storage
   * v1.6.3.10-v7 - FIX Issue #15: Call this after loading state from storage
   * @param {number} version - Version from storage
   */
  updateExpectedVersion(version) {
    if (typeof version === 'number' && version > 0) {
      this._expectedVersion = version;
      this._storageVersion = version;
      console.debug('[QuickTabHandler] 🔒 VERSION_TRACKING: Updated expected version to:', version);
    }
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
