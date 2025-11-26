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

export class QuickTabHandler {
  constructor(globalState, stateCoordinator, browserAPI, initializeFn) {
    this.globalState = globalState;
    this.stateCoordinator = stateCoordinator;
    this.browserAPI = browserAPI;
    this.initializeFn = initializeFn;
    this.isInitialized = false;

    // v1.6.1.6 - Memory leak fix: Track last write to detect self-triggered storage events
    this.lastWriteTimestamp = null;
    this.WRITE_IGNORE_WINDOW_MS = 100;
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
   * @param {Object} message - Message with id and properties to update
   * @param {Function} updateFn - Function to update tab properties
   * @param {boolean} shouldSave - Whether to save to storage immediately
   * @returns {Object} Success response
   */
  async updateQuickTabProperty(message, updateFn, shouldSave = true) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    // v1.6.2.2 - Use unified tabs array instead of container-based lookup
    const tab = this.globalState.tabs.find(t => t.id === message.id);
    if (!tab) {
      return { success: true };
    }

    updateFn(tab, message);
    this.globalState.lastUpdate = Date.now();

    if (shouldSave) {
      await this.saveStateToStorage();
    }

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
   */
  async handleCreate(message, _sender) {
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
   */
  handlePositionUpdate(message, _sender) {
    const shouldSave = message.action === 'UPDATE_QUICK_TAB_POSITION_FINAL';
    return this.updateQuickTabProperty(
      message,
      (tab, msg) => {
        tab.left = msg.left;
        tab.top = msg.top;
      },
      shouldSave
    );
  }

  /**
   * Handle size update
   */
  handleSizeUpdate(message, _sender) {
    const shouldSave = message.action === 'UPDATE_QUICK_TAB_SIZE_FINAL';
    return this.updateQuickTabProperty(
      message,
      (tab, msg) => {
        tab.width = msg.width;
        tab.height = msg.height;
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
   * Get current tab ID
   * v1.6.2.4 - FIX Issue #4: Add fallback when sender.tab is unavailable
   * Content scripts during initialization may not have sender.tab populated
   */
  async handleGetCurrentTabId(_message, sender) {
    // Primary: Use sender.tab if available
    if (sender.tab && typeof sender.tab.id === 'number') {
      console.log(`[QuickTabHandler] GET_CURRENT_TAB_ID: returning ${sender.tab.id} from sender.tab`);
      return { success: true, tabId: sender.tab.id };
    }

    // Fallback: Query active tab in current window
    // This handles cases where sender.tab is not populated during initialization
    console.log('[QuickTabHandler] GET_CURRENT_TAB_ID: sender.tab not available, querying active tab...');
    
    try {
      const tabs = await this.browserAPI.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0 && typeof tabs[0].id === 'number') {
        console.log(`[QuickTabHandler] GET_CURRENT_TAB_ID: returning ${tabs[0].id} from tabs.query`);
        return { success: true, tabId: tabs[0].id };
      }
      
      console.warn('[QuickTabHandler] GET_CURRENT_TAB_ID: Could not determine tab ID - no active tab found');
      return { success: false, tabId: null };
    } catch (err) {
      console.error('[QuickTabHandler] GET_CURRENT_TAB_ID: Error querying tabs:', err);
      return { success: false, tabId: null, error: err.message };
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
   */
  async handleGetQuickTabsState(message, _sender) {
    try {
      if (!this.isInitialized) {
        await this.initializeFn();
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
   */
  async saveStateToStorage() {
    // v1.6.1.6 - Generate unique write source ID to detect self-writes
    const writeSourceId = this._generateWriteSourceId();

    // v1.6.2.2 - Unified format: single tabs array
    const stateToSave = {
      tabs: this.globalState.tabs,
      timestamp: Date.now(),
      writeSourceId: writeSourceId // v1.6.1.6 - Include source ID for loop detection
    };

    try {
      // v1.6.0.12 - FIX: Use local storage to avoid quota errors
      // v1.6.1.6 - FIX: Only write to local storage (removed session storage to prevent double events)
      await this.browserAPI.storage.local.set({
        quick_tabs_state_v2: stateToSave
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
