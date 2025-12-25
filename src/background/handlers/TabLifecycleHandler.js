/**
 * TabLifecycleHandler - Manages Quick Tab lifecycle based on browser tab events
 *
 * v1.6.3.10-v3 - Phase 2: Tabs API Integration
 * - Detects when origin tabs close → marks Quick Tabs as orphaned
 * - Broadcasts tab events to Manager via port
 * - Validates adoption targets
 * - Updates tab metadata (favicon, title)
 *
 * v1.6.4.15 - FIX Issue #19: Container context updated during tab adoption
 * v1.6.4.15 - FIX Issue #20: triggerPostAdoptionPersistence() hook called after adoption
 *
 * v1.6.4.16 - FIX Issue #23: Tab cleanup handler with storage cleanup callback
 * - Added onTabRemovedCallback for external cleanup notifications
 * - Enhanced cleanup with [TAB_CLEANUP] logging prefix
 * - Track registered listeners for proper cleanup
 */

export class TabLifecycleHandler {
  constructor() {
    // Track which tabs are currently open
    this.openTabs = new Map(); // tabId -> { id, title, url, favIconUrl, active, status, cookieStoreId }
    // Track the currently active tab ID for efficient updates
    this.activeTabId = null;
    // Store bound handlers for cleanup
    this._boundHandlers = {
      onCreated: null,
      onUpdated: null,
      onActivated: null,
      onRemoved: null
    };
    // v1.6.4.15 - FIX Issue #20: Post-adoption persistence callback
    this._postAdoptionPersistCallback = null;
    // v1.6.4.16 - FIX Issue #23: Tab removal cleanup callback
    this._onTabRemovedCallback = null;
    // v1.6.4.16 - FIX Issue C: Track registered listener count for cleanup verification
    this._registeredListenerCount = 0;
  }

  /**
   * Initialize and start listening to tab events
   * v1.6.4.16 - FIX Issue C: Track listener count for cleanup verification
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

    // v1.6.4.16 - FIX Issue C: Track registered listeners
    this._registeredListenerCount = 4;
    console.log('[LISTENER_CLEANUP] Registered 4 tab event listeners');

    console.log('[TAB_LIFECYCLE] Listeners registered, tracking', this.openTabs.size, 'tabs');
  }

  /**
   * Stop listening to tab events and cleanup
   * v1.6.4.16 - FIX Issue C: Enhanced listener cleanup logging
   */
  stop() {
    console.log('[TAB_LIFECYCLE] Handler stopping...');

    let removedCount = 0;

    // Remove listeners if they were registered
    if (this._boundHandlers.onCreated) {
      browser.tabs.onCreated.removeListener(this._boundHandlers.onCreated);
      removedCount++;
    }
    if (this._boundHandlers.onUpdated) {
      browser.tabs.onUpdated.removeListener(this._boundHandlers.onUpdated);
      removedCount++;
    }
    if (this._boundHandlers.onActivated) {
      browser.tabs.onActivated.removeListener(this._boundHandlers.onActivated);
      removedCount++;
    }
    if (this._boundHandlers.onRemoved) {
      browser.tabs.onRemoved.removeListener(this._boundHandlers.onRemoved);
      removedCount++;
    }

    // v1.6.4.16 - FIX Issue C: Log listener cleanup
    console.log(
      '[LISTENER_CLEANUP] Removed',
      removedCount,
      'of',
      this._registeredListenerCount,
      'tab event listeners'
    );

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
    this._registeredListenerCount = 0;

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
   * v1.6.4.15 - FIX Issue #19: Include cookieStoreId for container tracking
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
        status: tab.status,
        // v1.6.4.15 - FIX Issue #19: Track container ID for adoption
        cookieStoreId: tab.cookieStoreId || 'firefox-default'
      });
      // Track the active tab
      if (tab.active) {
        this.activeTabId = tab.id;
      }
    }
  }

  /**
   * Handle new tab created
   * v1.6.4.15 - FIX Issue #19: Include cookieStoreId for container tracking
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
      status: tab.status,
      // v1.6.4.15 - FIX Issue #19: Track container ID
      cookieStoreId: tab.cookieStoreId || 'firefox-default'
    });
  }

  /**
   * Handle tab updated (title, favicon, URL changes)
   * v1.6.4.15 - FIX Issue #19: Track container ID changes
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
        status: tab.status,
        // v1.6.4.15 - FIX Issue #19: Update container ID if changed
        cookieStoreId: tab.cookieStoreId || existing.cookieStoreId
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
   * Handle tab removed - updates internal state tracking and triggers cleanup
   * v1.6.4.16 - FIX Issue #23: Enhanced with cleanup callback and logging
   * Note: Orphan detection is handled by background.js handleTabRemoved
   * This method keeps the TabLifecycleHandler's internal state in sync
   * @param {number} tabId - ID of closed tab
   * @param {Object} removeInfo - Removal details (isWindowClosing, windowId)
   */
  handleTabRemoved(tabId, removeInfo) {
    console.log('[TAB_LIFECYCLE] Tab removed:', { tabId, removeInfo });

    // Get tab info before removing (for cleanup callback)
    const closedTabInfo = this.openTabs.get(tabId);

    // Remove from our snapshot
    this.openTabs.delete(tabId);

    // Clear active tab if this was the active tab
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }

    // v1.6.4.16 - FIX Issue #23: Invoke cleanup callback if registered
    if (typeof this._onTabRemovedCallback === 'function') {
      console.log('[TAB_CLEANUP] Invoking tab removal cleanup callback:', {
        tabId,
        isWindowClosing: removeInfo?.isWindowClosing,
        hasTabInfo: !!closedTabInfo
      });

      try {
        this._onTabRemovedCallback(tabId, removeInfo, closedTabInfo);
        console.log('[TAB_CLEANUP] Cleanup callback completed for tab:', tabId);
      } catch (err) {
        console.error('[TAB_CLEANUP] Cleanup callback failed:', {
          tabId,
          error: err.message
        });
      }
    }
  }

  /**
   * Set callback for tab removal cleanup
   * v1.6.4.16 - FIX Issue #23: Allow external cleanup logic registration
   * @param {Function} callback - Callback to invoke when tab is removed
   *   Signature: (tabId, removeInfo, closedTabInfo) => void
   */
  setOnTabRemovedCallback(callback) {
    this._onTabRemovedCallback = callback;
    console.log('[TAB_CLEANUP] Tab removal callback registered:', {
      hasCallback: typeof callback === 'function'
    });
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
   * v1.6.4.15 - FIX Issue #19: Include container context in validation
   * @param {number} targetTabId - Target tab ID
   * @returns {Object} { valid: boolean, reason?: string, containerContext?: Object }
   */
  validateAdoptionTarget(targetTabId) {
    if (!this.openTabs.has(targetTabId)) {
      return {
        valid: false,
        reason: `Tab ${targetTabId} not found or closed`
      };
    }

    // v1.6.4.15 - FIX Issue #19: Include container context for adoption
    const targetTab = this.openTabs.get(targetTabId);
    return {
      valid: true,
      containerContext: {
        cookieStoreId: targetTab.cookieStoreId || 'firefox-default',
        tabId: targetTabId
      }
    };
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

  /**
   * Get container ID for a specific tab
   * v1.6.4.15 - FIX Issue #19: Helper for container adoption
   * @param {number} tabId - Tab ID
   * @returns {string|null} Cookie store ID or null if tab not found
   */
  getTabContainerId(tabId) {
    const tab = this.openTabs.get(tabId);
    return tab?.cookieStoreId || null;
  }

  /**
   * Update container context during adoption
   * v1.6.4.15 - FIX Issue #19: Detect container change during adoption
   * @param {string} quickTabId - Quick Tab ID being adopted
   * @param {number} oldOriginTabId - Previous origin tab ID
   * @param {number} newOriginTabId - New origin tab ID
   * @param {Object} snapshotMetadata - Current snapshot metadata to update
   * @returns {{containerChanged: boolean, oldContainer: string, newContainer: string}}
   */
  updateContainerContextForAdoption(quickTabId, oldOriginTabId, newOriginTabId, snapshotMetadata) {
    const oldContainer =
      this.getTabContainerId(oldOriginTabId) || snapshotMetadata?.originContainerId || 'unknown';
    const newContainer = this.getTabContainerId(newOriginTabId) || 'firefox-default';

    const containerChanged = oldContainer !== newContainer;

    console.log('[ADOPTION_CONTAINER] Metadata update:', {
      quickTabId,
      oldOriginTabId,
      newOriginTabId,
      oldContainer,
      newContainer,
      containerChanged,
      timestamp: new Date().toISOString()
    });

    // Update snapshot metadata if provided
    if (snapshotMetadata) {
      snapshotMetadata.originContainerId = newContainer;
    }

    return { containerChanged, oldContainer, newContainer };
  }

  /**
   * Set callback for post-adoption persistence
   * v1.6.4.15 - FIX Issue #20: Allow setting callback from outside
   * @param {Function} callback - Callback to invoke after adoption completes
   */
  setPostAdoptionPersistCallback(callback) {
    this._postAdoptionPersistCallback = callback;
    console.log('[TAB_LIFECYCLE] POST_ADOPTION_CALLBACK_SET:', {
      hasCallback: typeof callback === 'function'
    });
  }

  /**
   * Trigger state persistence after adoption completes
   * v1.6.3.10-v7 - FIX Diagnostic Issue #5: Re-attempt blocked writes after adoption fixes originTabId
   * v1.6.4.15 - FIX Issue #19: Include container context update
   * v1.6.4.15 - FIX Issue #20: Invoke registered callback
   *
   * This method should be called by background.js after a Quick Tab adoption completes.
   * After adoption, the originTabId is updated on the Quick Tab, which may unblock
   * previously blocked storage writes.
   *
   * @param {string} quickTabId - ID of adopted Quick Tab
   * @param {number} newOriginTabId - New origin tab ID after adoption
   * @param {Function} persistCallback - Callback to trigger state persistence (optional)
   * @returns {Promise<void>}
   */
  async triggerPostAdoptionPersistence(quickTabId, newOriginTabId, persistCallback) {
    console.log('[ADOPTION_COMPLETE] Post-persistence hook triggered:', {
      quickTabId,
      newOriginTabId,
      hasExternalCallback: typeof persistCallback === 'function',
      hasRegisteredCallback: typeof this._postAdoptionPersistCallback === 'function',
      timestamp: new Date().toISOString()
    });

    // Validate the new origin tab is valid
    const validation = this.validateAdoptionTarget(newOriginTabId);
    if (!validation.valid) {
      console.warn('[ADOPTION_COMPLETE] Post-persistence skipped:', {
        quickTabId,
        newOriginTabId,
        reason: validation.reason
      });
      return;
    }

    // v1.6.4.15 - FIX Issue #20: Call registered callback first (if any)
    if (typeof this._postAdoptionPersistCallback === 'function') {
      try {
        await this._postAdoptionPersistCallback(quickTabId, newOriginTabId);
        console.log('[ADOPTION_COMPLETE] Registered callback executed:', {
          quickTabId,
          newOriginTabId
        });
      } catch (err) {
        console.error('[ADOPTION_COMPLETE] Registered callback failed:', {
          quickTabId,
          newOriginTabId,
          error: err.message
        });
      }
    }

    // Call the external persist callback if provided
    if (typeof persistCallback === 'function') {
      try {
        await persistCallback();
        console.log('[ADOPTION_COMPLETE] External callback executed, write queue unblocked:', {
          quickTabId,
          newOriginTabId
        });
      } catch (err) {
        console.error('[ADOPTION_COMPLETE] External callback failed:', {
          quickTabId,
          newOriginTabId,
          error: err.message
        });
      }
    }
  }
}
