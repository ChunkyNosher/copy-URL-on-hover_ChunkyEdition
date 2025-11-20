(function () {
  'use strict';

  /**
   * LogHandler - Handles log export and clearing operations
   *
   * Actions handled:
   * - CLEAR_CONSOLE_LOGS: Clear all logs (background + all content scripts)
   * - GET_BACKGROUND_LOGS: Retrieve background script logs
   * - EXPORT_LOGS: Export logs to file via downloads API
   */

  class LogHandler {
    constructor(logBuffer, downloadsAPI, browserAPI) {
      this.logBuffer = logBuffer;
      this.downloadsAPI = downloadsAPI;
      this.browserAPI = browserAPI;
      this.pendingDownloads = new Map();
    }

    /**
     * Clear all logs across background and content scripts
     */
    async handleClearLogs(_message, _sender) {
      const clearedBackgroundEntries = this.clearBackgroundLogs();
      let clearedTabs = 0;

      if (this.browserAPI?.tabs?.query) {
        try {
          const tabs = await this.browserAPI.tabs.query({});
          const results = await Promise.allSettled(
            tabs.map(tab =>
              this.browserAPI.tabs
                .sendMessage(tab.id, {
                  action: 'CLEAR_CONTENT_LOGS'
                })
                .catch(() => ({ success: false }))
            )
          );

          clearedTabs = results.filter(
            result => result.status === 'fulfilled' && result.value?.success
          ).length;
        } catch (error) {
          console.warn('[LogHandler] Failed to broadcast CLEAR_CONTENT_LOGS:', error);
        }
      }

      return { success: true, clearedTabs, clearedBackgroundEntries };
    }

    /**
     * Get background script logs
     */
    handleGetLogs(_message, _sender) {
      return { logs: [...this.logBuffer] };
    }

    /**
     * Export logs to file
     */
    async handleExportLogs(message, _sender) {
      if (typeof message.logText !== 'string' || typeof message.filename !== 'string') {
        throw new Error('Invalid log export payload');
      }

      await this.exportLogsToFile(message.logText, message.filename);
      return { success: true };
    }

    /**
     * Clear background log buffer
     * @returns {number} Number of cleared entries
     */
    clearBackgroundLogs() {
      const cleared = this.logBuffer.length;
      this.logBuffer.length = 0;
      return cleared;
    }

    /**
     * Export logs to file via downloads API
     * @param {string} logText - Log content
     * @param {string} filename - Target filename
     * @returns {Promise<void>} Resolves when download completes
     */
    exportLogsToFile(logText, filename) {
      if (!this.downloadsAPI || !this.downloadsAPI.download) {
        throw new Error('Downloads API not available');
      }

      const blob = new Blob([logText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);

      return new Promise((resolve, reject) => {
        let currentDownloadId = null;
        const timeoutId = setTimeout(() => {
          URL.revokeObjectURL(url);
          if (currentDownloadId) {
            this.pendingDownloads.delete(currentDownloadId);
          }
          reject(new Error('Download timeout after 60 seconds'));
        }, 60000);

        this.downloadsAPI.download(
          {
            url: url,
            filename: filename,
            saveAs: true
          },
          downloadId => {
            currentDownloadId = downloadId;
            if (!downloadId) {
              clearTimeout(timeoutId);
              URL.revokeObjectURL(url);
              const error = this.downloadsAPI.runtime?.lastError;
              reject(new Error(error?.message || 'Download failed'));
              return;
            }

            this.pendingDownloads.set(downloadId, { url, timeoutId });

            const changeListener = delta => {
              if (delta.id !== downloadId) return;

              if (delta.state?.current === 'complete') {
                clearTimeout(timeoutId);
                URL.revokeObjectURL(url);
                this.pendingDownloads.delete(downloadId);
                this.downloadsAPI.onChanged.removeListener(changeListener);
                resolve();
              } else if (delta.state?.current === 'interrupted') {
                clearTimeout(timeoutId);
                URL.revokeObjectURL(url);
                this.pendingDownloads.delete(downloadId);
                this.downloadsAPI.onChanged.removeListener(changeListener);
                reject(new Error('Download interrupted'));
              }
            };

            this.downloadsAPI.onChanged.addListener(changeListener);
          }
        );
      });
    }
  }

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

  class QuickTabHandler {
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
     * Helper method to update Quick Tab properties
     * Reduces duplication across update handlers
     * @param {Object} message - Message with id, cookieStoreId, and properties to update
     * @param {Function} updateFn - Function to update tab properties
     * @param {boolean} shouldSave - Whether to save to storage immediately
     * @returns {Object} Success response
     */
    async updateQuickTabProperty(message, updateFn, shouldSave = true) {
      if (!this.isInitialized) {
        await this.initializeFn();
      }

      const cookieStoreId = message.cookieStoreId || 'firefox-default';
      const containerState = this.globalState.containers[cookieStoreId];

      if (!containerState) {
        return { success: true };
      }

      const tab = containerState.tabs.find(t => t.id === message.id);
      if (!tab) {
        return { success: true };
      }

      updateFn(tab, message);
      containerState.lastUpdate = Date.now();

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
     */
    handlePinUpdate(message, _sender) {
      return this.updateQuickTabProperty(message, (tab, msg) => {
        tab.pinnedToUrl = msg.pinnedToUrl;
      });
    }

    /**
     * Handle solo update
     */
    handleSoloUpdate(message, _sender) {
      return this.updateQuickTabProperty(message, (tab, msg) => {
        tab.soloedOnTabs = msg.soloedOnTabs || [];
      });
    }

    /**
     * Handle mute update
     */
    handleMuteUpdate(message, _sender) {
      return this.updateQuickTabProperty(message, (tab, msg) => {
        tab.mutedOnTabs = msg.mutedOnTabs || [];
      });
    }

    /**
     * Handle minimize update
     */
    handleMinimizeUpdate(message, _sender) {
      return this.updateQuickTabProperty(message, (tab, msg) => {
        tab.minimized = msg.minimized;
      });
    }

    /**
     * Get current tab ID
     */
    handleGetCurrentTabId(_message, sender) {
      const tabId = sender.tab?.id;
      return { success: true, tabId };
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
     */
    async handleGetQuickTabsState(message, _sender) {
      try {
        if (!this.isInitialized) {
          await this.initializeFn();
        }

        const cookieStoreId = message.cookieStoreId || 'firefox-default';
        const containerState = this.globalState.containers[cookieStoreId];

        if (!containerState || !containerState.tabs) {
          return {
            success: true,
            tabs: [],
            cookieStoreId: cookieStoreId
          };
        }

        return {
          success: true,
          tabs: containerState.tabs,
          cookieStoreId: cookieStoreId,
          lastUpdate: containerState.lastUpdate
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

  /**
   * TabHandler - Handles browser tab operations
   *
   * Actions handled:
   * - openTab: Open URL in new tab
   * - saveQuickTabState: Save Quick Tab state for specific browser tab
   * - getQuickTabState: Get Quick Tab state for specific browser tab
   * - clearQuickTabState: Clear Quick Tab state for specific browser tab
   * - createQuickTab: Legacy create action (redirects to CREATE_QUICK_TAB)
   */

  class TabHandler {
    constructor(quickTabStates, browserAPI) {
      this.quickTabStates = quickTabStates; // Map of tabId -> state
      this.browserAPI = browserAPI;
    }

    /**
     * Open URL in new tab
     */
    async handleOpenTab(message, _sender) {
      if (!message.url) {
        throw new Error('URL is required');
      }

      const createProperties = {
        url: message.url
      };

      if (typeof message.active !== 'undefined') {
        createProperties.active = message.active;
      }

      const tab = await this.browserAPI.tabs.create(createProperties);
      return { success: true, tabId: tab.id };
    }

    /**
     * Save Quick Tab state for browser tab
     */
    handleSaveState(message, sender) {
      const tabId = sender.tab?.id;

      if (!tabId) {
        throw new Error('Tab ID not available');
      }

      this.quickTabStates.set(tabId, message.state);
      return { success: true };
    }

    /**
     * Get Quick Tab state for browser tab
     */
    handleGetState(_message, sender) {
      const tabId = sender.tab?.id;

      if (!tabId) {
        throw new Error('Tab ID not available');
      }

      const state = this.quickTabStates.get(tabId);
      return { success: true, state: state || null };
    }

    /**
     * Clear Quick Tab state for browser tab
     */
    handleClearState(_message, sender) {
      const tabId = sender.tab?.id;

      if (!tabId) {
        throw new Error('Tab ID not available');
      }

      this.quickTabStates.delete(tabId);
      return { success: true };
    }

    /**
     * Legacy create handler (redirects to modern handler)
     */
    handleLegacyCreate(_message, _sender) {
      console.log('[TabHandler] Legacy createQuickTab action - use CREATE_QUICK_TAB instead');

      // Just acknowledge - actual creation should use CREATE_QUICK_TAB
      return { success: true, message: 'Use CREATE_QUICK_TAB action' };
    }
  }

  /**
   * MessageRouter - Routes runtime.onMessage calls to appropriate handlers
   *
   * Reduces the monolithic message handler from 628 lines (cc=93) to a simple
   * routing table pattern. Each handler is responsible for one domain of operations.
   *
   * Pattern: Command Pattern + Registry
   * - Handlers register for specific action types
   * - Router validates sender and routes to handler
   * - Handlers return promises for async operations
   */

  class MessageRouter {
    constructor() {
      this.handlers = new Map();
      this.extensionId = null;
    }

    /**
     * Register a handler for specific message action(s)
     * @param {string|string[]} actions - Action type(s) to handle
     * @param {Function} handler - Handler function (message, sender) => Promise<any>
     */
    register(actions, handler) {
      const actionList = Array.isArray(actions) ? actions : [actions];

      for (const action of actionList) {
        if (this.handlers.has(action)) {
          console.warn(`[MessageRouter] Overwriting handler for action: ${action}`);
        }
        this.handlers.set(action, handler);
      }
    }

    /**
     * Set extension ID for sender validation
     * @param {string} extensionId - Extension ID from runtime.id
     */
    setExtensionId(extensionId) {
      this.extensionId = extensionId;
    }

    /**
     * Validate sender is from this extension
     * @param {Object} sender - Message sender
     * @returns {boolean}
     */
    isAuthorizedSender(sender) {
      if (!sender || !sender.id) {
        return false;
      }

      if (!this.extensionId) {
        console.warn('[MessageRouter] Extension ID not set - defaulting to optimistic validation');
        return true;
      }

      return sender.id === this.extensionId;
    }

    /**
     * Route message to appropriate handler
     * @param {Object} message - Message object with action property
     * @param {Object} sender - Message sender
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True if async response expected
     */
    async route(message, sender, sendResponse) {
      // Validate message format
      if (!message || typeof message.action !== 'string') {
        console.error('[MessageRouter] Invalid message format:', message);
        sendResponse({ success: false, error: 'Invalid message format' });
        return false;
      }

      const handler = this.handlers.get(message.action);

      if (!handler) {
        console.warn(`[MessageRouter] No handler for action: ${message.action}`);
        sendResponse({ success: false, error: `Unknown action: ${message.action}` });
        return false;
      }

      try {
        // Call handler and wait for result
        const result = await handler(message, sender);

        // Send response
        if (sendResponse) {
          sendResponse(result);
        }

        return true; // Keep channel open for async response
      } catch (error) {
        console.error(`[MessageRouter] Handler error for ${message.action}:`, error);

        if (sendResponse) {
          sendResponse({
            success: false,
            error: error.message || 'Handler execution failed'
          });
        }

        return true;
      }
    }

    /**
     * Create browser runtime listener
     * @returns {Function} Listener function for chrome.runtime.onMessage
     */
    createListener() {
      return (message, sender, sendResponse) => {
        this.route(message, sender, sendResponse);
        return true; // Keep channel open for async responses
      };
    }
  }

  /**
   * LegacyMigrator - Handles legacy storage format
   *
   * Format: { tabs: [...], timestamp: ... }
   * This format has a flat tabs array without container isolation.
   * Migrates to default container.
   *
   * @class LegacyMigrator
   */
  class LegacyMigrator {
    /**
     * Migrate legacy format to global state
     *
     * @param {Object} data - Storage data with tabs array
     * @param {Object} globalState - Target state object to populate
     * @returns {Object} Updated global state
     */
    migrate(data, globalState) {
      // Convert flat tabs array to default container structure
      globalState.containers['firefox-default'] = {
        tabs: data.tabs || [],
        lastUpdate: data.timestamp || Date.now()
      };

      return globalState;
    }

    /**
     * Get format name for logging
     *
     * @returns {string} Format identifier
     */
    getFormatName() {
      return 'legacy (flat tabs array)';
    }
  }

  /**
   * V1_5_8_14_Migrator - Handles v1.5.8.14 storage format
   *
   * Format: { [cookieStoreId]: { tabs: [...], lastUpdate: ... }, ... }
   * This format has unwrapped containers (direct cookieStoreId keys).
   *
   * @class V1_5_8_14_Migrator
   */
  class V1_5_8_14_Migrator {
    /**
     * Migrate v1.5.8.14 format to global state
     *
     * @param {Object} data - Storage data with cookieStoreId keys
     * @param {Object} globalState - Target state object to populate
     * @returns {Object} Updated global state
     */
    migrate(data, globalState) {
      // Data is already in containers format, just unwrapped
      // Copy directly to containers
      globalState.containers = data;

      return globalState;
    }

    /**
     * Get format name for logging
     *
     * @returns {string} Format identifier
     */
    getFormatName() {
      return 'v1.5.8.14 (unwrapped containers)';
    }
  }

  /**
   * V1_5_8_15_Migrator - Handles v1.5.8.15 storage format
   *
   * Format: { containers: {...}, saveId: '...', timestamp: ... }
   * This format has a containers wrapper with metadata.
   *
   * @class V1_5_8_15_Migrator
   */
  class V1_5_8_15_Migrator {
    /**
     * Migrate v1.5.8.15 format to global state
     *
     * @param {Object} data - Storage data with containers key
     * @param {Object} globalState - Target state object to populate
     * @returns {Object} Updated global state
     */
    migrate(data, globalState) {
      // Copy containers directly - already in correct format
      if (data.containers && typeof data.containers === 'object') {
        globalState.containers = data.containers;
      }

      return globalState;
    }

    /**
     * Get format name for logging
     *
     * @returns {string} Format identifier
     */
    getFormatName() {
      return 'v1.5.8.15 (containers wrapper)';
    }
  }

  /**
   * StorageFormatDetector - Strategy for detecting storage format versions
   *
   * Reduces complexity by extracting format detection logic from initializeGlobalState.
   * Uses table-driven approach to avoid nested conditionals.
   *
   * @class StorageFormatDetector
   */
  class StorageFormatDetector {
    /**
     * Detect the storage format version from data structure
     *
     * @param {any} data - The storage data to analyze
     * @returns {string} Format identifier: 'v1.5.8.15', 'v1.5.8.14', 'legacy', or 'empty'
     */
    detect(data) {
      // Guard: No data
      if (!data) {
        return 'empty';
      }

      // Guard: Not an object
      if (typeof data !== 'object') {
        return 'empty';
      }

      // v1.5.8.15: Has containers wrapper
      if (data.containers) {
        return 'v1.5.8.15';
      }

      // v1.5.8.14: Object format without tabs array or containers
      if (!Array.isArray(data.tabs) && !data.containers) {
        return 'v1.5.8.14';
      }

      // Legacy: Has tabs array
      if (data.tabs) {
        return 'legacy';
      }

      // Unknown format
      return 'empty';
    }
  }

  // Background script handles injecting content script into all tabs
  // and manages Quick Tab state persistence across tabs
  // Also handles sidebar panel communication
  // Also handles webRequest to remove X-Frame-Options for Quick Tabs
  // v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load


  const runtimeAPI =
    (typeof browser !== 'undefined' && browser.runtime) ||
    (typeof chrome !== 'undefined' && chrome.runtime) ||
    null;

  const downloadsAPI =
    (typeof browser !== 'undefined' && browser.downloads) ||
    (typeof chrome !== 'undefined' && chrome.downloads) ||
    null;

  const EXTENSION_ID = runtimeAPI?.id || null;

  // ==================== LOG CAPTURE FOR EXPORT ====================
  // Log buffer for background script
  const BACKGROUND_LOG_BUFFER = [];
  const MAX_BACKGROUND_BUFFER_SIZE = 2000;

  function addBackgroundLog(type, ...args) {
    if (BACKGROUND_LOG_BUFFER.length >= MAX_BACKGROUND_BUFFER_SIZE) {
      BACKGROUND_LOG_BUFFER.shift();
    }

    BACKGROUND_LOG_BUFFER.push({
      type: type,
      timestamp: Date.now(),
      message: args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
        .join(' '),
      args: args
    });
  }

  // Override console methods to capture logs
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;

  console.log = function (...args) {
    addBackgroundLog('DEBUG', ...args);
    originalConsoleLog.apply(console, args);
  };

  console.error = function (...args) {
    addBackgroundLog('ERROR', ...args);
    originalConsoleError.apply(console, args);
  };

  console.warn = function (...args) {
    addBackgroundLog('WARN', ...args);
    originalConsoleWarn.apply(console, args);
  };

  console.info = function (...args) {
    addBackgroundLog('INFO', ...args);
    originalConsoleInfo.apply(console, args);
  };

  // ==================== STATE MANAGEMENT ====================

  // Store Quick Tab states per tab
  const quickTabStates = new Map();

  // ==================== REAL-TIME STATE COORDINATOR ====================
  // Global state hub for real-time Quick Tab synchronization across all tabs
  // Container-aware since v1.5.7: State keyed by cookieStoreId for Firefox Container isolation
  // This provides instant cross-origin sync (< 50ms latency)
  // v1.5.8.13 - Enhanced with eager loading for Issue #35 and #51
  const globalQuickTabState = {
    // Keyed by cookieStoreId (e.g., "firefox-default", "firefox-container-1")
    containers: {
      'firefox-default': { tabs: [], lastUpdate: 0 }
    }
  };

  // Flag to track initialization status
  let isInitialized = false;

  // v1.6.0 - PHASE 3.2: Initialize format detection and migration strategies
  const formatDetector = new StorageFormatDetector();
  const migrators = {
    'v1.5.8.15': new V1_5_8_15_Migrator(),
    'v1.5.8.14': new V1_5_8_14_Migrator(),
    legacy: new LegacyMigrator()
  };

  /**
   * v1.5.8.13 - EAGER LOADING: Initialize global state from storage on extension startup
   * v1.6.0 - PHASE 3.2: Refactored to use strategy pattern (cc=20 → cc<5)
   *
   * Reduces complexity by:
   * - Extracting format detection to StorageFormatDetector
   * - Extracting migration logic to format-specific migrator classes
   * - Using early returns to flatten nested blocks
   */
  async function initializeGlobalState() {
    // Guard: Already initialized
    if (isInitialized) {
      console.log('[Background] State already initialized');
      return;
    }

    try {
      // Try session storage first (faster)
      const loaded = await tryLoadFromSessionStorage();
      if (loaded) return;

      // Fall back to sync storage
      await tryLoadFromSyncStorage();
    } catch (err) {
      console.error('[Background] Error initializing global state:', err);
      isInitialized = true; // Mark as initialized even on error to prevent blocking
    }
  }

  /**
   * Helper: Try loading from session storage
   *
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async function tryLoadFromSessionStorage() {
    // Guard: Session storage not available
    if (typeof browser.storage.session === 'undefined') {
      return false;
    }

    const result = await browser.storage.session.get('quick_tabs_session');

    // Guard: No data in session storage
    if (!result || !result.quick_tabs_session) {
      return false;
    }

    // Detect format and migrate
    const format = formatDetector.detect(result.quick_tabs_session);
    const migrator = migrators[format];

    if (migrator) {
      migrators[format].migrate(result.quick_tabs_session, globalQuickTabState);
      logSuccessfulLoad('session storage', migrator.getFormatName());
      isInitialized = true;
      return true;
    }

    return false;
  }

  /**
   * Helper: Try loading from sync storage
   *
   * @returns {Promise<void>}
   */
  async function tryLoadFromSyncStorage() {
    const result = await browser.storage.sync.get('quick_tabs_state_v2');

    // Guard: No data in sync storage
    if (!result || !result.quick_tabs_state_v2) {
      console.log('[Background] ✓ EAGER LOAD: No saved state found, starting with empty state');
      isInitialized = true;
      return;
    }

    // Detect format and migrate
    const format = formatDetector.detect(result.quick_tabs_state_v2);
    const migrator = migrators[format];

    if (migrator) {
      migrators[format].migrate(result.quick_tabs_state_v2, globalQuickTabState);
      logSuccessfulLoad('sync storage', migrator.getFormatName());

      // Save migrated legacy format with proper wrapper
      if (format === 'legacy') {
        await saveMigratedLegacyFormat();
      }
    }

    isInitialized = true;
  }

  /**
   * Helper: Save migrated legacy format to sync storage
   *
   * @returns {Promise<void>}
   */
  async function saveMigratedLegacyFormat() {
    const saveId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      await browser.storage.sync.set({
        quick_tabs_state_v2: {
          containers: globalQuickTabState.containers,
          saveId: saveId,
          timestamp: Date.now()
        }
      });
      console.log('[Background] ✓ Migrated legacy format to v1.5.8.15');
    } catch (err) {
      console.error('[Background] Error saving migrated state:', err);
    }
  }

  /**
   * Helper: Log successful state load
   *
   * @param {string} source - Storage source (session/sync)
   * @param {string} format - Format name
   */
  function logSuccessfulLoad(source, format) {
    const totalTabs = Object.values(globalQuickTabState.containers).reduce(
      (sum, c) => sum + (c.tabs?.length || 0),
      0
    );

    console.log(
      `[Background] ✓ EAGER LOAD: Initialized from ${source} (${format}):`,
      totalTabs,
      'tabs across',
      Object.keys(globalQuickTabState.containers).length,
      'containers'
    );
  }

  // v1.5.8.13 - EAGER LOADING: Call initialization immediately on script load
  initializeGlobalState();

  /**
   * Helper: Process migration for a single container's tabs
   *
   * @param {Array} containerTabs - Array of Quick Tab objects in container
   * @returns {boolean} True if any tab was migrated
   */
  function _processContainerMigration(containerTabs) {
    let migrated = false;

    for (const quickTab of containerTabs) {
      if (migrateTabFromPinToSoloMute(quickTab)) {
        migrated = true;
      }
    }

    return migrated;
  }

  /**
   * v1.5.9.13 - Migrate Quick Tab state from pinnedToUrl to soloedOnTabs/mutedOnTabs
   * v1.6.0 - PHASE 3.2: Refactored to extract nested loop logic (cc=10 → cc<6)
   * v1.6.0 - PHASE 4.3: Extracted _processContainerMigration to fix max-depth (line 262)
   */
  async function migrateQuickTabState() {
    // Guard: State not initialized
    if (!isInitialized) {
      console.warn('[Background Migration] State not initialized, skipping migration');
      return;
    }

    let migrated = false;

    // Process each container
    for (const containerId in globalQuickTabState.containers) {
      const containerTabs = globalQuickTabState.containers[containerId].tabs || [];
      if (_processContainerMigration(containerTabs)) {
        migrated = true;
      }
    }

    // Save if any tabs were migrated
    if (migrated) {
      await saveMigratedQuickTabState();
    } else {
      console.log('[Background Migration] No migration needed');
    }
  }

  /**
   * Helper: Migrate individual tab from pinnedToUrl to solo/mute format
   *
   * @param {Object} quickTab - Quick Tab object to migrate
   * @returns {boolean} True if migration occurred
   */
  function migrateTabFromPinToSoloMute(quickTab) {
    // Guard: No pinnedToUrl property
    if (!('pinnedToUrl' in quickTab)) {
      return false;
    }

    console.log(
      `[Background Migration] Converting Quick Tab ${quickTab.id} from pin to solo/mute format`
    );

    // Initialize new properties
    quickTab.soloedOnTabs = quickTab.soloedOnTabs || [];
    quickTab.mutedOnTabs = quickTab.mutedOnTabs || [];

    // Remove old property
    delete quickTab.pinnedToUrl;

    return true;
  }

  /**
   * Helper: Save migrated Quick Tab state to storage
   *
   * @returns {Promise<void>}
   */
  async function saveMigratedQuickTabState() {
    console.log('[Background Migration] Saving migrated Quick Tab state');

    const stateToSave = {
      containers: globalQuickTabState.containers,
      saveId: `migration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    try {
      await browser.storage.sync.set({ quick_tabs_state_v2: stateToSave });
      console.log('[Background Migration] ✓ Migration complete');
    } catch (err) {
      console.error('[Background Migration] Error saving migrated state:', err);
    }
  }

  // Run migration after initialization
  migrateQuickTabState();

  // ==================== STATE COORDINATOR ====================
  // Manages canonical Quick Tab state across all tabs with conflict resolution

  class StateCoordinator {
    constructor() {
      this.globalState = {
        tabs: [],
        timestamp: 0,
        version: 1 // Increment on breaking changes
      };
      this.pendingConfirmations = new Map(); // saveId → {tabId, resolve, reject}
      this.tabVectorClocks = new Map(); // tabId → vector clock
      this.initialized = false;
    }

    /**
     * Initialize from storage
     * v1.6.0 - PHASE 3.2: Refactored to flatten nested blocks (cc=15 → cc<6)
     */
    async initialize() {
      // Guard: Already initialized
      if (this.initialized) {
        console.log('[STATE COORDINATOR] Already initialized');
        return;
      }

      try {
        // Try session storage first
        const loaded = await this.tryLoadFromSessionStorage();
        if (loaded) return;

        // Fall back to sync storage
        await this.tryLoadFromSyncStorage();
      } catch (err) {
        console.error('[STATE COORDINATOR] Error initializing:', err);
        this.initialized = true;
      }
    }

    /**
     * Helper: Try loading from session storage
     *
     * @returns {Promise<boolean>} True if loaded successfully
     */
    async tryLoadFromSessionStorage() {
      // Guard: Session storage not available
      if (typeof browser.storage.session === 'undefined') {
        return false;
      }

      const result = await browser.storage.session.get('quick_tabs_session');

      // Guard: No valid data
      if (!result || !result.quick_tabs_session || !result.quick_tabs_session.tabs) {
        return false;
      }

      this.globalState = result.quick_tabs_session;
      this.initialized = true;
      console.log(
        '[STATE COORDINATOR] Initialized from session storage:',
        this.globalState.tabs.length,
        'tabs'
      );
      return true;
    }

    /**
     * Helper: Try loading from sync storage
     *
     * @returns {Promise<void>}
     */
    async tryLoadFromSyncStorage() {
      const result = await browser.storage.sync.get('quick_tabs_state_v2');

      // Guard: No data
      if (!result || !result.quick_tabs_state_v2) {
        this.initialized = true;
        console.log('[STATE COORDINATOR] No saved state, starting fresh');
        return;
      }

      // Load data based on format
      this.loadStateFromSyncData(result.quick_tabs_state_v2);
      this.initialized = true;
      console.log(
        '[STATE COORDINATOR] Initialized from sync storage:',
        this.globalState.tabs.length,
        'tabs'
      );
    }

    /**
     * Helper: Extract tabs from container data
     * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (line 445)
     *
     * @param {Object} containerData - Container data object
     * @returns {Array} Array of tabs from container, or empty array
     */
    _extractContainerTabs(containerData) {
      if (!containerData || !containerData.tabs) {
        return [];
      }
      return containerData.tabs;
    }

    /**
     * Helper: Load state from sync storage data
     *
     * @param {Object} data - Storage data
     */
    loadStateFromSyncData(data) {
      // Container-aware format
      if (typeof data === 'object' && !Array.isArray(data.tabs)) {
        const allTabs = [];
        for (const containerId in data) {
          const containerData = data[containerId];
          const tabs = this._extractContainerTabs(containerData);
          allTabs.push(...tabs);
        }
        this.globalState.tabs = allTabs;
        this.globalState.timestamp = Date.now();
        return;
      }

      // Legacy format with tabs array
      if (data.tabs) {
        this.globalState = data;
      }
    }

    /**
     * Process batch update from a tab
     */
    async processBatchUpdate(tabId, operations, tabInstanceId) {
      await this.initialize();

      console.log(`[STATE COORDINATOR] Processing ${operations.length} operations from tab ${tabId}`);

      // Rebuild vector clock from operations
      const tabVectorClock = new Map();
      operations.forEach(op => {
        if (op.vectorClock) {
          op.vectorClock.forEach(([key, value]) => {
            tabVectorClock.set(key, Math.max(tabVectorClock.get(key) || 0, value));
          });
        }
      });
      this.tabVectorClocks.set(tabInstanceId, tabVectorClock);

      // Process each operation (synchronous)
      for (const op of operations) {
        this.processOperation(op);
      }

      // Save to storage
      await this.persistState();

      // Broadcast to all tabs
      await this.broadcastState();

      console.log('[STATE COORDINATOR] Batch update complete');
      return { success: true };
    }

    /**
     * Process a single operation
     * v1.6.0 - PHASE 3.2: Refactored to extract operation handlers (cc=12 → cc<6)
     */
    processOperation(op) {
      const { type, quickTabId, data } = op;

      // Route to appropriate handler
      switch (type) {
        case 'create':
          this.handleCreateOperation(quickTabId, data);
          break;
        case 'update':
          this.handleUpdateOperation(quickTabId, data);
          break;
        case 'delete':
          this.handleDeleteOperation(quickTabId);
          break;
        case 'minimize':
          this.handleMinimizeOperation(quickTabId, data);
          break;
        case 'restore':
          this.handleRestoreOperation(quickTabId);
          break;
        default:
          console.warn(`[STATE COORDINATOR] Unknown operation type: ${type}`);
      }

      this.globalState.timestamp = Date.now();
    }

    /**
     * Helper: Handle create operation
     *
     * @param {string} quickTabId - Quick Tab ID
     * @param {Object} data - Tab data
     */
    handleCreateOperation(quickTabId, data) {
      const existingIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

      if (existingIndex === -1) {
        this.globalState.tabs.push(data);
        console.log(`[STATE COORDINATOR] Created Quick Tab ${quickTabId}`);
      } else {
        this.globalState.tabs[existingIndex] = {
          ...this.globalState.tabs[existingIndex],
          ...data
        };
        console.log(`[STATE COORDINATOR] Updated existing Quick Tab ${quickTabId}`);
      }
    }

    /**
     * Helper: Handle update operation
     *
     * @param {string} quickTabId - Quick Tab ID
     * @param {Object} data - Tab data
     */
    handleUpdateOperation(quickTabId, data) {
      const updateIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

      if (updateIndex === -1) {
        console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for update`);
        return;
      }

      this.globalState.tabs[updateIndex] = {
        ...this.globalState.tabs[updateIndex],
        ...data
      };
      console.log(`[STATE COORDINATOR] Updated Quick Tab ${quickTabId}`);
    }

    /**
     * Helper: Handle delete operation
     *
     * @param {string} quickTabId - Quick Tab ID
     */
    handleDeleteOperation(quickTabId) {
      const deleteIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

      if (deleteIndex === -1) {
        console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for delete`);
        return;
      }

      this.globalState.tabs.splice(deleteIndex, 1);
      console.log(`[STATE COORDINATOR] Deleted Quick Tab ${quickTabId}`);
    }

    /**
     * Helper: Handle minimize operation
     *
     * @param {string} quickTabId - Quick Tab ID
     * @param {Object} data - Tab data (optional)
     */
    handleMinimizeOperation(quickTabId, data) {
      const minIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

      if (minIndex !== -1) {
        this.globalState.tabs[minIndex].minimized = true;
        console.log(`[STATE COORDINATOR] Minimized Quick Tab ${quickTabId}`);
      } else if (data) {
        this.globalState.tabs.push({ ...data, minimized: true });
        console.log(`[STATE COORDINATOR] Created minimized Quick Tab ${quickTabId}`);
      }
    }

    /**
     * Helper: Handle restore operation
     *
     * @param {string} quickTabId - Quick Tab ID
     */
    handleRestoreOperation(quickTabId) {
      const restoreIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

      if (restoreIndex === -1) {
        console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for restore`);
        return;
      }

      this.globalState.tabs[restoreIndex].minimized = false;
      console.log(`[STATE COORDINATOR] Restored Quick Tab ${quickTabId}`);
    }

    /**
     * Persist state to storage
     */
    async persistState() {
      try {
        await browser.storage.sync.set({
          quick_tabs_state_v2: this.globalState
        });

        // Also save to session storage if available
        if (typeof browser.storage.session !== 'undefined') {
          await browser.storage.session.set({
            quick_tabs_session: this.globalState
          });
        }

        console.log('[STATE COORDINATOR] Persisted state to storage');
      } catch (err) {
        console.error('[STATE COORDINATOR] Error persisting state:', err);
        throw err;
      }
    }

    /**
     * Broadcast canonical state to all tabs
     */
    async broadcastState() {
      try {
        const tabs = await browser.tabs.query({});

        for (const tab of tabs) {
          browser.tabs
            .sendMessage(tab.id, {
              action: 'SYNC_STATE_FROM_COORDINATOR',
              state: this.globalState
            })
            .catch(() => {
              // Content script not loaded in this tab, that's OK
            });
        }

        console.log(`[STATE COORDINATOR] Broadcasted state to ${tabs.length} tabs`);
      } catch (err) {
        console.error('[STATE COORDINATOR] Error broadcasting state:', err);
      }
    }

    /**
     * Get current state
     */
    getState() {
      return this.globalState;
    }
  }

  // Global state coordinator instance
  const stateCoordinator = new StateCoordinator();
  // ==================== END STATE COORDINATOR ====================

  // ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
  // This allows Quick Tabs to load any website, bypassing clickjacking protection
  // ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
  // Firefox Manifest V3 - Supports blocking webRequest
  // This allows Quick Tabs to load any website, bypassing clickjacking protection
  // Security Note: This removes X-Frame-Options and CSP frame-ancestors headers
  // which normally prevent websites from being embedded in iframes. This makes
  // the extension potentially vulnerable to clickjacking attacks if a malicious
  // website tricks the user into clicking on a Quick Tab overlay. Use with caution.

  console.log('[Quick Tabs] Initializing Firefox MV3 X-Frame-Options bypass...');

  // Track modified URLs for debugging
  const modifiedUrls = new Set();

  browser.webRequest.onHeadersReceived.addListener(
    details => {
      console.log(`[Quick Tabs] Processing iframe: ${details.url}`);

      const headers = details.responseHeaders;
      const modifiedHeaders = headers.filter(header => {
        const name = header.name.toLowerCase();

        // Remove X-Frame-Options header (blocks iframe embedding)
        if (name === 'x-frame-options') {
          console.log(`[Quick Tabs] ✓ Removed X-Frame-Options: ${header.value} from ${details.url}`);
          modifiedUrls.add(details.url);
          return false;
        }

        // Remove Content-Security-Policy frame-ancestors directive
        if (name === 'content-security-policy') {
          const originalValue = header.value;
          // Remove frame-ancestors directive from CSP
          header.value = header.value.replace(/frame-ancestors[^;]*(;|$)/gi, '');

          // If CSP is now empty, remove the header entirely
          if (header.value.trim() === '' || header.value.trim() === ';') {
            console.log(`[Quick Tabs] ✓ Removed empty CSP from ${details.url}`);
            modifiedUrls.add(details.url);
            return false;
          }

          // Log if we modified it
          if (header.value !== originalValue) {
            console.log(`[Quick Tabs] ✓ Modified CSP for ${details.url}`);
            modifiedUrls.add(details.url);
          }
        }

        // Remove restrictive Cross-Origin-Resource-Policy
        if (name === 'cross-origin-resource-policy') {
          const value = header.value.toLowerCase();
          if (value === 'same-origin' || value === 'same-site') {
            console.log(`[Quick Tabs] ✓ Removed CORP: ${header.value} from ${details.url}`);
            modifiedUrls.add(details.url);
            return false;
          }
        }

        return true;
      });

      return { responseHeaders: modifiedHeaders };
    },
    {
      urls: ['<all_urls>'],
      types: ['sub_frame'] // Only iframes - filter at registration for better performance
    },
    ['blocking', 'responseHeaders'] // Firefox MV3 allows 'blocking'
  );

  // Log successful iframe loads
  browser.webRequest.onCompleted.addListener(
    details => {
      if (modifiedUrls.has(details.url)) {
        console.log(`[Quick Tabs] ✅ Successfully loaded iframe: ${details.url}`);
        // Clean up old URLs to prevent memory leak
        if (modifiedUrls.size > 100) {
          modifiedUrls.clear();
        }
      }
    },
    {
      urls: ['<all_urls>'],
      types: ['sub_frame']
    }
  );

  // Log failed iframe loads
  browser.webRequest.onErrorOccurred.addListener(
    details => {
      console.error(`[Quick Tabs] ❌ Failed to load iframe: ${details.url}`);
      console.error(`[Quick Tabs] Error: ${details.error}`);
    },
    {
      urls: ['<all_urls>'],
      types: ['sub_frame']
    }
  );

  console.log('[Quick Tabs] ✓ Firefox MV3 X-Frame-Options bypass installed');

  // ==================== END X-FRAME-OPTIONS BYPASS ====================

  // Listen for tab switches to restore Quick Tabs (container-aware)
  chrome.tabs.onActivated.addListener(async activeInfo => {
    console.log('[Background] Tab activated:', activeInfo.tabId);

    // Message the activated tab to potentially restore Quick Tabs from storage
    chrome.tabs
      .sendMessage(activeInfo.tabId, {
        action: 'tabActivated',
        tabId: activeInfo.tabId
      })
      .catch(_err => {
        // Content script might not be ready yet, that's OK
        console.log('[Background] Could not message tab (content script not ready)');
      });

    // Get the tab's cookieStoreId to send only relevant state
    try {
      const tab = await browser.tabs.get(activeInfo.tabId);
      const cookieStoreId = tab.cookieStoreId || 'firefox-default';

      // Send container-specific state for immediate sync
      if (
        globalQuickTabState.containers[cookieStoreId] &&
        globalQuickTabState.containers[cookieStoreId].tabs.length > 0
      ) {
        chrome.tabs
          .sendMessage(activeInfo.tabId, {
            action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
            state: {
              tabs: globalQuickTabState.containers[cookieStoreId].tabs,
              lastUpdate: globalQuickTabState.containers[cookieStoreId].lastUpdate
            },
            cookieStoreId: cookieStoreId
          })
          .catch(() => {
            // Content script might not be ready yet, that's OK
          });
      }
    } catch (err) {
      console.error('[Background] Error getting tab info:', err);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
    if (changeInfo.status === 'complete') {
      chrome.scripting
        .executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        })
        .then(() => {
          // After content script is loaded, restore Quick Tab state if it exists
          const state = quickTabStates.get(tabId);
          if (state && state.quickTabs && state.quickTabs.length > 0) {
            chrome.tabs
              .sendMessage(tabId, {
                action: 'restoreQuickTabs',
                quickTabs: state.quickTabs
              })
              .catch(_err => {
                // Ignore errors if content script isn't ready
              });
          }
        })
        .catch(_err => {
          // Silently fail for restricted pages
        });
    }
  });

  /**
   * Helper: Remove tab ID from Quick Tab's solo/mute arrays
   * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (lines 886, 893)
   *
   * @param {Object} quickTab - Quick Tab object to clean up
   * @param {number} tabId - Tab ID to remove
   * @returns {boolean} True if any changes were made
   */
  function _removeTabFromQuickTab(quickTab, tabId) {
    let changed = false;

    // Remove from soloedOnTabs
    if (quickTab.soloedOnTabs && quickTab.soloedOnTabs.includes(tabId)) {
      quickTab.soloedOnTabs = quickTab.soloedOnTabs.filter(id => id !== tabId);
      changed = true;
      console.log(`[Background] Removed tab ${tabId} from Quick Tab ${quickTab.id} solo list`);
    }

    // Remove from mutedOnTabs
    if (quickTab.mutedOnTabs && quickTab.mutedOnTabs.includes(tabId)) {
      quickTab.mutedOnTabs = quickTab.mutedOnTabs.filter(id => id !== tabId);
      changed = true;
      console.log(`[Background] Removed tab ${tabId} from Quick Tab ${quickTab.id} mute list`);
    }

    return changed;
  }

  /**
   * Helper: Process cleanup for all Quick Tabs in a container
   * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (line 914)
   *
   * @param {Array} containerTabs - Array of Quick Tab objects
   * @param {number} tabId - Tab ID to remove
   * @returns {boolean} True if any Quick Tab was changed
   */
  function _processContainerCleanup(containerTabs, tabId) {
    let changed = false;

    for (const quickTab of containerTabs) {
      if (_removeTabFromQuickTab(quickTab, tabId)) {
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Helper: Clean up Quick Tab state after tab closes
   * v1.6.0 - PHASE 4.3: Extracted to reduce complexity (cc=11 → cc<9)
   *
   * @param {number} tabId - Tab ID that was closed
   * @returns {Promise<boolean>} True if state was changed and saved
   */
  async function _cleanupQuickTabStateAfterTabClose(tabId) {
    // Guard: Not initialized
    if (!isInitialized) {
      return false;
    }

    let stateChanged = false;

    // Iterate through all containers
    for (const containerId in globalQuickTabState.containers) {
      const containerTabs = globalQuickTabState.containers[containerId].tabs || [];
      if (_processContainerCleanup(containerTabs, tabId)) {
        stateChanged = true;
      }
    }

    // Save if state changed
    if (!stateChanged) {
      return false;
    }

    const stateToSave = {
      containers: globalQuickTabState.containers,
      saveId: `cleanup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    try {
      await browser.storage.sync.set({ quick_tabs_state_v2: stateToSave });
      console.log('[Background] Cleaned up Quick Tab state after tab closure');
      return true;
    } catch (err) {
      console.error('[Background] Error saving cleaned up state:', err);
      return false;
    }
  }

  // Clean up state when tab is closed
  // v1.5.9.13 - Also clean up solo/mute arrays when tabs close
  // v1.6.0 - PHASE 4.3: Extracted cleanup logic to fix complexity and max-depth
  chrome.tabs.onRemoved.addListener(async tabId => {
    quickTabStates.delete(tabId);
    console.log(`[Background] Tab ${tabId} closed - cleaning up Quick Tab references`);
    await _cleanupQuickTabStateAfterTabClose(tabId);
  });

  // ==================== MESSAGE ROUTING SETUP (v1.6.0 Phase 3.1) ====================
  // Initialize message router and handlers for modular message processing
  console.log('[Background] Initializing MessageRouter and handlers...');

  const messageRouter = new MessageRouter();
  messageRouter.setExtensionId(EXTENSION_ID);

  // Create handler instances
  const logHandler = new LogHandler(BACKGROUND_LOG_BUFFER, downloadsAPI, browser);

  const quickTabHandler = new QuickTabHandler(
    globalQuickTabState,
    stateCoordinator,
    browser,
    initializeGlobalState
  );

  const tabHandler = new TabHandler(quickTabStates, browser);

  // Set initialization flag for QuickTabHandler if state is already initialized
  if (isInitialized) {
    quickTabHandler.setInitialized(true);
  }

  // Register log handlers (3 actions)
  messageRouter.register('CLEAR_CONSOLE_LOGS', (msg, sender) =>
    logHandler.handleClearLogs(msg, sender)
  );
  messageRouter.register('GET_BACKGROUND_LOGS', (msg, sender) =>
    logHandler.handleGetLogs(msg, sender)
  );
  messageRouter.register('EXPORT_LOGS', (msg, sender) => logHandler.handleExportLogs(msg, sender));

  // Register Quick Tab handlers (13 actions)
  messageRouter.register('BATCH_QUICK_TAB_UPDATE', (msg, sender) =>
    quickTabHandler.handleBatchUpdate(msg, sender)
  );
  messageRouter.register('CREATE_QUICK_TAB', (msg, sender) =>
    quickTabHandler.handleCreate(msg, sender)
  );
  messageRouter.register('CLOSE_QUICK_TAB', (msg, sender) =>
    quickTabHandler.handleClose(msg, sender)
  );
  messageRouter.register(
    ['UPDATE_QUICK_TAB_POSITION', 'UPDATE_QUICK_TAB_POSITION_FINAL'],
    (msg, sender) => quickTabHandler.handlePositionUpdate(msg, sender)
  );
  messageRouter.register(['UPDATE_QUICK_TAB_SIZE', 'UPDATE_QUICK_TAB_SIZE_FINAL'], (msg, sender) =>
    quickTabHandler.handleSizeUpdate(msg, sender)
  );
  messageRouter.register('UPDATE_QUICK_TAB_PIN', (msg, sender) =>
    quickTabHandler.handlePinUpdate(msg, sender)
  );
  messageRouter.register('UPDATE_QUICK_TAB_SOLO', (msg, sender) =>
    quickTabHandler.handleSoloUpdate(msg, sender)
  );
  messageRouter.register('UPDATE_QUICK_TAB_MUTE', (msg, sender) =>
    quickTabHandler.handleMuteUpdate(msg, sender)
  );
  messageRouter.register('UPDATE_QUICK_TAB_MINIMIZE', (msg, sender) =>
    quickTabHandler.handleMinimizeUpdate(msg, sender)
  );
  messageRouter.register('GET_CURRENT_TAB_ID', (msg, sender) =>
    quickTabHandler.handleGetCurrentTabId(msg, sender)
  );
  messageRouter.register('GET_CONTAINER_CONTEXT', (msg, sender) =>
    quickTabHandler.handleGetContainerContext(msg, sender)
  );
  messageRouter.register('SWITCH_TO_TAB', (msg, sender) =>
    quickTabHandler.handleSwitchToTab(msg, sender)
  );
  messageRouter.register('GET_QUICK_TABS_STATE', (msg, sender) =>
    quickTabHandler.handleGetQuickTabsState(msg, sender)
  );

  // Register tab handlers (5 actions)
  messageRouter.register('openTab', (msg, sender) => tabHandler.handleOpenTab(msg, sender));
  messageRouter.register('saveQuickTabState', (msg, sender) =>
    tabHandler.handleSaveState(msg, sender)
  );
  messageRouter.register('getQuickTabState', (msg, sender) => tabHandler.handleGetState(msg, sender));
  messageRouter.register('clearQuickTabState', (msg, sender) =>
    tabHandler.handleClearState(msg, sender)
  );
  messageRouter.register('createQuickTab', (msg, sender) =>
    tabHandler.handleLegacyCreate(msg, sender)
  );

  console.log('[Background] MessageRouter initialized with 24 registered handlers');

  // Handle messages from content script and sidebar - using MessageRouter
  chrome.runtime.onMessage.addListener(messageRouter.createListener());

  // ==================== KEYBOARD COMMAND LISTENER ====================
  // v1.6.0 - Removed obsolete toggle-minimized-manager listener
  // Now handled by the toggle-quick-tabs-manager listener below (line 1240)
  // ==================== END KEYBOARD COMMAND LISTENER ====================

  // Handle sidePanel toggle for Chrome (optional)
  if (chrome.sidePanel) {
    chrome.action.onClicked.addListener(tab => {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(err => {
        console.log('Side panel not supported or error:', err);
      });
    });
  }

  /**
   * Helper: Update global state from storage value
   * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (lines 1087, 1095)
   *
   * @param {Object|null} newValue - New storage value
   */
  function _updateGlobalStateFromStorage(newValue) {
    // Guard: No value (storage cleared)
    if (!newValue) {
      console.log('[Background] Storage cleared, checking if intentional...');
      return;
    }

    // Container-aware format
    if (typeof newValue === 'object' && newValue.containers) {
      globalQuickTabState.containers = newValue.containers;
      console.log(
        '[Background] Updated global state from storage (container-aware):',
        Object.keys(newValue.containers).length,
        'containers'
      );
      return;
    }

    // Legacy format - migrate
    if (newValue.tabs && Array.isArray(newValue.tabs)) {
      globalQuickTabState.containers = {
        'firefox-default': {
          tabs: newValue.tabs,
          lastUpdate: newValue.timestamp || Date.now()
        }
      };
      console.log(
        '[Background] Updated global state from storage (legacy format):',
        newValue.tabs.length,
        'tabs'
      );
    }
  }

  /**
   * Helper: Broadcast message to all tabs
   * v1.6.0 - PHASE 4.3: Extracted to reduce complexity
   *
   * @param {string} action - Message action type
   * @param {*} data - Data to send with message
   */
  async function _broadcastToAllTabs(action, data) {
    const tabs = await browser.tabs.query({});

    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, { action, ...data });
      } catch (_err) {
        // Content script might not be loaded in this tab
      }
    }
  }

  /**
   * Helper: Handle Quick Tab state changes
   * v1.6.0 - PHASE 4.3: Extracted to reduce complexity (cc=11 → cc<9)
   *
   * @param {Object} changes - Storage changes object
   */
  async function _handleQuickTabStateChange(changes) {
    console.log('[Background] Quick Tab state changed, broadcasting to all tabs');

    const newValue = changes.quick_tabs_state_v2.newValue;
    _updateGlobalStateFromStorage(newValue);

    await _broadcastToAllTabs('SYNC_QUICK_TAB_STATE_FROM_BACKGROUND', {
      state: newValue
    });
  }

  /**
   * Helper: Handle settings changes
   * v1.6.0 - PHASE 4.3: Extracted to reduce complexity
   *
   * @param {Object} changes - Storage changes object
   */
  async function _handleSettingsChange(changes) {
    console.log('[Background] Settings changed, broadcasting to all tabs');

    await _broadcastToAllTabs('SETTINGS_UPDATED', {
      settings: changes.quick_tab_settings.newValue
    });
  }

  // ==================== STORAGE SYNC BROADCASTING ====================
  // Listen for sync storage changes and broadcast them to all tabs
  // This enables real-time Quick Tab state synchronization across all tabs
  // v1.6.0 - PHASE 4.3: Refactored to extract handlers (cc=11 → cc<9, max-depth fixed)
  browser.storage.onChanged.addListener((changes, areaName) => {
    console.log('[Background] Storage changed:', areaName, Object.keys(changes));

    // Guard: Only process sync storage
    if (areaName !== 'sync') {
      return;
    }

    // Handle Quick Tab state changes
    if (changes.quick_tabs_state_v2) {
      _handleQuickTabStateChange(changes);
    }

    // Handle settings changes
    if (changes.quick_tab_settings) {
      _handleSettingsChange(changes);
    }
  });

  // ==================== END STORAGE SYNC BROADCASTING ====================

  /**
   * Helper: Toggle Quick Tabs panel in active tab
   * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (line 1205)
   *
   * @returns {Promise<void>}
   */
  async function _toggleQuickTabsPanel() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });

    // Guard: No active tab
    if (tabs.length === 0) {
      console.error('[QuickTabsManager] No active tab found');
      return;
    }

    const activeTab = tabs[0];

    try {
      // Send toggle message to content script
      await browser.tabs.sendMessage(activeTab.id, {
        action: 'TOGGLE_QUICK_TABS_PANEL'
      });
      console.log('[QuickTabsManager] Toggle command sent to tab', activeTab.id);
    } catch (err) {
      console.error('[QuickTabsManager] Error sending toggle message:', err);
      // Content script may not be loaded yet - inject it
      try {
        await browser.tabs.executeScript(activeTab.id, {
          file: 'content.js'
        });
        // Try again after injection
        await browser.tabs.sendMessage(activeTab.id, {
          action: 'TOGGLE_QUICK_TABS_PANEL'
        });
      } catch (injectErr) {
        console.error('[QuickTabsManager] Error injecting content script:', injectErr);
      }
    }
  }

  // ==================== KEYBOARD COMMANDS ====================
  // Listen for keyboard commands to toggle floating panel
  // v1.6.0 - PHASE 4.3: Extracted toggle logic to fix max-depth
  browser.commands.onCommand.addListener(async command => {
    if (command === 'toggle-quick-tabs-manager') {
      await _toggleQuickTabsPanel();
    }
  });
  // ==================== END KEYBOARD COMMANDS ====================

})();
//# sourceMappingURL=background.js.map
