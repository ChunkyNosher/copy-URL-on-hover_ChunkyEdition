/**
 * TabLifecycleHandler - Manages Quick Tab lifecycle based on browser tab events
 *
 * v1.6.3.10-v3 - Phase 2: Tabs API Integration
 * - Detects when origin tabs close → marks Quick Tabs as orphaned
 * - Broadcasts tab events to Manager via port
 * - Validates adoption targets
 * - Updates tab metadata (favicon, title)
 */

export class TabLifecycleHandler {
  constructor() {
    // Track which tabs are currently open
    this.openTabs = new Map(); // tabId -> { id, title, url, favIconUrl, active, status }
    // Track the currently active tab ID for efficient updates
    this.activeTabId = null;
    // Store bound handlers for cleanup
    this._boundHandlers = {
      onCreated: null,
      onUpdated: null,
      onActivated: null,
      onRemoved: null
    };
  }

  /**
   * Initialize and start listening to tab events
   */
  async start() {
    console.log('[TAB_LIFECYCLE] Handler starting...');

    // Initialize open tabs snapshot
    await this.initializeOpenTabs();

    // Bind handlers and store references for cleanup
    this._boundHandlers.onCreated = this.handleTabCreated.bind(this);
    this._boundHandlers.onUpdated = this.handleTabUpdated.bind(this);
    this._boundHandlers.onActivated = this.handleTabActivated.bind(this);
    this._boundHandlers.onRemoved = this.handleTabRemoved.bind(this);

    // Set up listeners
    browser.tabs.onCreated.addListener(this._boundHandlers.onCreated);
    browser.tabs.onUpdated.addListener(this._boundHandlers.onUpdated);
    browser.tabs.onActivated.addListener(this._boundHandlers.onActivated);
    browser.tabs.onRemoved.addListener(this._boundHandlers.onRemoved);

    console.log('[TAB_LIFECYCLE] Listeners registered, tracking', this.openTabs.size, 'tabs');
  }

  /**
   * Stop listening to tab events and cleanup
   */
  stop() {
    console.log('[TAB_LIFECYCLE] Handler stopping...');

    // Remove listeners if they were registered
    if (this._boundHandlers.onCreated) {
      browser.tabs.onCreated.removeListener(this._boundHandlers.onCreated);
    }
    if (this._boundHandlers.onUpdated) {
      browser.tabs.onUpdated.removeListener(this._boundHandlers.onUpdated);
    }
    if (this._boundHandlers.onActivated) {
      browser.tabs.onActivated.removeListener(this._boundHandlers.onActivated);
    }
    if (this._boundHandlers.onRemoved) {
      browser.tabs.onRemoved.removeListener(this._boundHandlers.onRemoved);
    }

    // Clear bound handlers
    this._boundHandlers = {
      onCreated: null,
      onUpdated: null,
      onActivated: null,
      onRemoved: null
    };

    // Clear state
    this.openTabs.clear();
    this.activeTabId = null;

    console.log('[TAB_LIFECYCLE] Handler stopped');
  }

  /**
   * Initialize snapshot of currently open tabs
   */
  async initializeOpenTabs() {
    try {
      const tabs = await browser.tabs.query({});
      this._populateOpenTabs(tabs);
      console.log('[TAB_LIFECYCLE] Initialized with', this.openTabs.size, 'open tabs');
    } catch (error) {
      console.error('[TAB_LIFECYCLE] Error initializing:', error);
    }
  }

  /**
   * Populate openTabs map from tabs array
   * @param {Array} tabs - Array of browser tabs
   * @private
   */
  _populateOpenTabs(tabs) {
    for (const tab of tabs) {
      this.openTabs.set(tab.id, {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        active: tab.active,
        status: tab.status
      });
      // Track the active tab
      if (tab.active) {
        this.activeTabId = tab.id;
      }
    }
  }

  /**
   * Handle new tab created
   * @param {Object} tab - Browser tab object
   */
  handleTabCreated(tab) {
    console.log('[TAB_LIFECYCLE] Tab created:', { tabId: tab.id, title: tab.title });

    this.openTabs.set(tab.id, {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      active: tab.active || false,
      status: tab.status
    });
  }

  /**
   * Handle tab updated (title, favicon, URL changes)
   * @param {number} tabId - Tab ID
   * @param {Object} changeInfo - Changed properties
   * @param {Object} tab - Full tab object
   */
  handleTabUpdated(tabId, changeInfo, tab) {
    // Update our snapshot
    if (this.openTabs.has(tabId)) {
      const existing = this.openTabs.get(tabId);
      Object.assign(existing, {
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        status: tab.status
      });
    }

    // Log significant updates
    if (changeInfo.favIconUrl) {
      console.log('[TAB_LIFECYCLE] Tab favicon updated:', {
        tabId,
        favIconUrl: changeInfo.favIconUrl
      });
    }
    if (changeInfo.title) {
      console.log('[TAB_LIFECYCLE] Tab title updated:', { tabId, title: changeInfo.title });
    }
  }

  /**
   * Handle tab activated (switched to)
   * Optimized O(1) update using tracked activeTabId
   * @param {Object} activeInfo - Contains tabId and windowId
   */
  handleTabActivated({ tabId, windowId }) {
    console.log('[TAB_LIFECYCLE] Tab activated:', { tabId, windowId });

    // O(1) update: Only update the previous and new active tabs
    const previousActiveId = this.activeTabId;

    // Deactivate previous tab if it exists
    if (previousActiveId !== null && this.openTabs.has(previousActiveId)) {
      const previousTab = this.openTabs.get(previousActiveId);
      previousTab.active = false;
    }

    // Activate new tab if it exists
    if (this.openTabs.has(tabId)) {
      const newActiveTab = this.openTabs.get(tabId);
      newActiveTab.active = true;
    }

    // Update tracked active tab ID
    this.activeTabId = tabId;
  }

  /**
   * Handle tab removed - updates internal state tracking
   * Note: Orphan detection is handled by background.js handleTabRemoved
   * This method keeps the TabLifecycleHandler's internal state in sync
   * @param {number} tabId - ID of closed tab
   * @param {Object} removeInfo - Removal details (isWindowClosing, windowId)
   */
  handleTabRemoved(tabId, removeInfo) {
    console.log('[TAB_LIFECYCLE] Tab removed:', { tabId, removeInfo });

    // Remove from our snapshot
    this.openTabs.delete(tabId);

    // Clear active tab if this was the active tab
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  /**
   * Check if a tab ID is currently open
   * @param {number} tabId - Tab ID to check
   * @returns {boolean}
   */
  isTabOpen(tabId) {
    return this.openTabs.has(tabId);
  }

  /**
   * Get tab metadata
   * @param {number} tabId - Tab ID
   * @returns {Object|null} Tab info or null if not found
   */
  getTabMetadata(tabId) {
    return this.openTabs.get(tabId) || null;
  }

  /**
   * Validate if a tab is valid for adoption
   * @param {number} targetTabId - Target tab ID
   * @returns {Object} { valid: boolean, reason?: string }
   */
  validateAdoptionTarget(targetTabId) {
    if (!this.openTabs.has(targetTabId)) {
      return {
        valid: false,
        reason: `Tab ${targetTabId} not found or closed`
      };
    }

    return { valid: true };
  }

  /**
   * Get all currently open tab IDs
   * @returns {Array<number>} Array of open tab IDs
   */
  getOpenTabIds() {
    return Array.from(this.openTabs.keys());
  }

  /**
   * Get count of currently open tabs
   * @returns {number} Number of open tabs
   */
  getOpenTabCount() {
    return this.openTabs.size;
  }
}
