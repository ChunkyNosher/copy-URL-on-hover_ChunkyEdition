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
  }

  setInitialized(value) {
    this.isInitialized = value;
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

    // Initialize container state if it doesn't exist
    if (!this.globalState.containers[cookieStoreId]) {
      this.globalState.containers[cookieStoreId] = { tabs: [], lastUpdate: 0 };
    }

    const containerState = this.globalState.containers[cookieStoreId];

    // Check if tab already exists by ID
    const existingIndex = containerState.tabs.findIndex(t => t.id === message.id);

    const tabData = {
      id: message.id,
      url: message.url,
      left: message.left,
      top: message.top,
      width: message.width,
      height: message.height,
      pinnedToUrl: message.pinnedToUrl || null,
      title: message.title || 'Quick Tab',
      minimized: message.minimized || false
    };

    if (existingIndex !== -1) {
      containerState.tabs[existingIndex] = tabData;
    } else {
      containerState.tabs.push(tabData);
    }

    containerState.lastUpdate = Date.now();

    // Save state
    await this.saveState(message.saveId, cookieStoreId, message);

    return { success: true };
  }

  /**
   * Handle Quick Tab close
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

    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      containerState.tabs = containerState.tabs.filter(t => t.id !== message.id);
      containerState.lastUpdate = Date.now();

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
  async handlePositionUpdate(message, _sender) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    
    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      const tab = containerState.tabs.find(t => t.id === message.id);
      
      if (tab) {
        tab.left = message.left;
        tab.top = message.top;
        containerState.lastUpdate = Date.now();

        if (message.action === 'UPDATE_QUICK_TAB_POSITION_FINAL') {
          await this.saveStateToStorage();
        }
      }
    }

    return { success: true };
  }

  /**
   * Handle size update
   */
  async handleSizeUpdate(message, _sender) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    
    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      const tab = containerState.tabs.find(t => t.id === message.id);
      
      if (tab) {
        tab.width = message.width;
        tab.height = message.height;
        containerState.lastUpdate = Date.now();

        if (message.action === 'UPDATE_QUICK_TAB_SIZE_FINAL') {
          await this.saveStateToStorage();
        }
      }
    }

    return { success: true };
  }

  /**
   * Handle pin update
   */
  async handlePinUpdate(message, _sender) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    
    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      const tab = containerState.tabs.find(t => t.id === message.id);
      
      if (tab) {
        tab.pinnedToUrl = message.pinnedToUrl;
        containerState.lastUpdate = Date.now();
        await this.saveStateToStorage();
      }
    }

    return { success: true };
  }

  /**
   * Handle solo update
   */
  async handleSoloUpdate(message, _sender) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    
    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      const tab = containerState.tabs.find(t => t.id === message.id);
      
      if (tab) {
        tab.soloedOnTabs = message.soloedOnTabs || [];
        containerState.lastUpdate = Date.now();
        await this.saveStateToStorage();
      }
    }

    return { success: true };
  }

  /**
   * Handle mute update
   */
  async handleMuteUpdate(message, _sender) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    
    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      const tab = containerState.tabs.find(t => t.id === message.id);
      
      if (tab) {
        tab.mutedOnTabs = message.mutedOnTabs || [];
        containerState.lastUpdate = Date.now();
        await this.saveStateToStorage();
      }
    }

    return { success: true };
  }

  /**
   * Handle minimize update
   */
  async handleMinimizeUpdate(message, _sender) {
    if (!this.isInitialized) {
      await this.initializeFn();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';
    
    if (this.globalState.containers[cookieStoreId]) {
      const containerState = this.globalState.containers[cookieStoreId];
      const tab = containerState.tabs.find(t => t.id === message.id);
      
      if (tab) {
        tab.minimized = message.minimized;
        containerState.lastUpdate = Date.now();
        await this.saveStateToStorage();
      }
    }

    return { success: true };
  }

  /**
   * Get current tab ID
   */
  async handleGetCurrentTabId(_message, sender) {
    const tabId = sender.tab?.id;
    return { success: true, tabId };
  }

  /**
   * Save state to storage
   */
  async saveState(saveId, cookieStoreId, message) {
    const generatedSaveId = saveId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const stateToSave = {
      containers: this.globalState.containers,
      saveId: generatedSaveId,
      timestamp: Date.now()
    };

    try {
      await this.browserAPI.storage.sync.set({
        quick_tabs_state_v2: stateToSave
      });

      if (typeof this.browserAPI.storage.session !== 'undefined') {
        await this.browserAPI.storage.session.set({
          quick_tabs_session: stateToSave
        });
      }

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
      console.error('[QuickTabHandler] Error saving state:', err);
    }
  }

  /**
   * Save state to storage (simplified)
   */
  async saveStateToStorage() {
    const stateToSave = {
      containers: this.globalState.containers,
      timestamp: Date.now()
    };

    try {
      await this.browserAPI.storage.sync.set({
        quick_tabs_state_v2: stateToSave
      });

      if (typeof this.browserAPI.storage.session !== 'undefined') {
        await this.browserAPI.storage.session.set({
          quick_tabs_session: stateToSave
        });
      }
    } catch (err) {
      console.error('[QuickTabHandler] Error saving state:', err);
    }
  }

  /**
   * Broadcast message to all tabs in container
   */
  async broadcastToContainer(cookieStoreId, messageData) {
    try {
      const tabs = await this.browserAPI.tabs.query({ cookieStoreId });
      
      await Promise.allSettled(
        tabs.map(tab =>
          this.browserAPI.tabs
            .sendMessage(tab.id, messageData)
            .catch(() => {})
        )
      );
    } catch (err) {
      console.error('[QuickTabHandler] Error broadcasting:', err);
    }
  }
}
