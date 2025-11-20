// QuickTabStateManager - Centralized state management for Quick Tabs
// Uses browser.storage.sync for persistent state and browser.storage.session for fast ephemeral sync
// This module is shared between content.js, background.js, and other components

/**
 * Get the cookieStoreId of the current tab (for Firefox Container support)
 * @returns {Promise<string>} The cookieStoreId (e.g., "firefox-container-1" or "firefox-default")
 */
async function getCurrentCookieStoreId() {
  try {
    // For content scripts: query for active tab in current window
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    if (tabs && tabs.length > 0) {
      // Default to "firefox-default" if cookieStoreId is missing
      return tabs[0].cookieStoreId || 'firefox-default';
    }

    // Fallback to default container
    return 'firefox-default';
  } catch (err) {
    console.error('[QuickTabStateManager] Error getting cookieStoreId:', err);
    return 'firefox-default';
  }
}

/**
 * QuickTabStateManager class handles all Quick Tab state persistence and synchronization
 * Uses a dual-layer storage approach:
 * - browser.storage.sync: Persistent storage that syncs across devices (container-aware since v1.5.7)
 * - browser.storage.session: Fast ephemeral storage for current session (Firefox 115+)
 *
 * Container-aware storage structure (v1.5.7+):
 * {
 *   "quick_tabs_state_v2": {
 *     "firefox-default": { tabs: [...], timestamp: ... },
 *     "firefox-container-1": { tabs: [...], timestamp: ... },
 *     ...
 *   }
 * }
 */
export class QuickTabStateManager {
  constructor() {
    // Storage keys
    this.stateKey = 'quick_tabs_state_v2';
    this.sessionKey = 'quick_tabs_session';

    // Feature detection for browser.storage.session (Firefox 115+)
    this.hasSessionStorage =
      typeof browser !== 'undefined' &&
      browser.storage &&
      typeof browser.storage.session !== 'undefined';

    // Debug logging
    this.debug = false;
  }

  /**
   * Enable/disable debug logging
   * @param {boolean} enabled - Whether to enable debug logging
   */
  setDebug(enabled) {
    this.debug = enabled;
  }

  /**
   * Log debug messages
   * @param {string} message - Debug message
   */
  log(message) {
    if (this.debug) {
      console.log(`[QuickTabStateManager] ${message}`);
    }
  }

  /**
   * Save Quick Tab state to storage (container-aware)
   * @param {Array} tabs - Array of Quick Tab objects to save
   * @param {string} cookieStoreId - Optional cookieStoreId (will auto-detect if not provided)
   * @returns {Promise<Object>} - The saved state object
   */
  async save(tabs, cookieStoreId = null) {
    // Auto-detect container if not provided
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    this.log(`Saving ${tabs.length} Quick Tabs for container: ${cookieStoreId}`);

    try {
      // Load existing state for all containers
      const existingData = (await browser.storage.sync.get(this.stateKey)) || {};
      const containerStates = existingData[this.stateKey] || {};

      // Update state for this specific container
      containerStates[cookieStoreId] = {
        tabs: tabs || [],
        timestamp: Date.now()
      };

      // Save back to storage
      const promises = [];

      // Save to sync storage
      promises.push(
        browser.storage.sync
          .set({
            [this.stateKey]: containerStates
          })
          .then(() => this.log(`Saved to sync storage for ${cookieStoreId}`))
          .catch(err => console.error('Error saving to sync storage:', err))
      );

      // Also save to session storage if available
      if (this.hasSessionStorage) {
        promises.push(
          browser.storage.session
            .set({
              [this.sessionKey]: containerStates
            })
            .then(() => this.log(`Saved to session storage for ${cookieStoreId}`))
            .catch(err => console.error('Error saving to session storage:', err))
        );
      }

      await Promise.all(promises);

      return containerStates[cookieStoreId];
    } catch (err) {
      console.error('[QuickTabStateManager] Error in save():', err);
      throw err;
    }
  }

  /**
   * Load Quick Tab state from storage (container-aware)
   * Tries session storage first (faster), falls back to sync storage
   * @param {string} cookieStoreId - Optional cookieStoreId (will auto-detect if not provided)
   * @returns {Promise<Object>} - The loaded state object with { tabs: [], timestamp: number }
   */
  async load(cookieStoreId = null) {
    // Auto-detect container if not provided
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    this.log(`Loading Quick Tab state for container: ${cookieStoreId}`);

    try {
      // Try session storage first (faster)
      const sessionState = await this._loadFromSession(cookieStoreId);
      if (sessionState) return sessionState;

      // Fall back to sync storage
      const syncState = await this._loadFromSync(cookieStoreId);
      if (syncState) return syncState;

      // No state found for this container
      this.log(`No saved state found for ${cookieStoreId}, returning empty state`);
      return { tabs: [], timestamp: Date.now() };
    } catch (err) {
      console.error('[QuickTabStateManager] Error loading Quick Tab state:', err);
      return { tabs: [], timestamp: Date.now() };
    }
  }

  /**
   * Load state from session storage
   * @private
   */
  async _loadFromSession(cookieStoreId) {
    if (!this.hasSessionStorage) return null;

    const sessionResult = await browser.storage.session.get(this.sessionKey);
    const containerStates = sessionResult?.[this.sessionKey];
    const containerState = containerStates?.[cookieStoreId];

    if (containerState) {
      this.log(`Loaded ${containerState.tabs.length} tabs from session storage`);
      return containerState;
    }

    return null;
  }

  /**
   * Load state from sync storage
   * @private
   */
  async _loadFromSync(cookieStoreId) {
    const syncResult = await browser.storage.sync.get(this.stateKey);
    const containerStates = syncResult?.[this.stateKey];

    if (!containerStates) return null;

    // Populate session storage for faster future reads
    if (this.hasSessionStorage) {
      await browser.storage.session
        .set({ [this.sessionKey]: containerStates })
        .catch(err => console.error('Error populating session storage:', err));
    }

    const containerState = containerStates[cookieStoreId];
    if (containerState) {
      this.log(`Loaded ${containerState.tabs.length} tabs from sync storage`);
      return containerState;
    }

    return null;
  }

  /**
   * Update a specific Quick Tab's position (container-aware)
   * @param {string} url - URL of the Quick Tab to update
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async updatePosition(url, left, top, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === url ? { ...tab, left, top } : tab
    );
    return this.save(updatedTabs, cookieStoreId);
  }

  /**
   * Update a specific Quick Tab's size (container-aware)
   * @param {string} url - URL of the Quick Tab to update
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async updateSize(url, width, height, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === url ? { ...tab, width, height } : tab
    );
    return this.save(updatedTabs, cookieStoreId);
  }

  /**
   * Add a new Quick Tab (container-aware)
   * @param {Object} tab - Quick Tab object { url, width, height, left, top, pinnedToUrl }
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async addTab(tab, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);

    // Check if tab already exists
    const existingIndex = currentState.tabs.findIndex(t => t.url === tab.url);
    if (existingIndex !== -1) {
      // Update existing tab
      currentState.tabs[existingIndex] = { ...currentState.tabs[existingIndex], ...tab };
    } else {
      // Add new tab
      currentState.tabs.push(tab);
    }

    return this.save(currentState.tabs, cookieStoreId);
  }

  /**
   * Remove a Quick Tab by URL (container-aware)
   * @param {string} url - URL of the Quick Tab to remove
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async removeTab(url, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);
    const updatedTabs = currentState.tabs.filter(tab => tab.url !== url);
    return this.save(updatedTabs, cookieStoreId);
  }

  /**
   * Clear all Quick Tabs (container-aware)
   * @param {string} cookieStoreId - Optional cookieStoreId (will clear only this container's tabs)
   * @returns {Promise<Object>} - The empty state
   */
  async clear(cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    this.log(`Clearing all Quick Tabs from storage for container: ${cookieStoreId}`);

    try {
      // Load existing state for all containers
      const existingData = (await browser.storage.sync.get(this.stateKey)) || {};
      const containerStates = existingData[this.stateKey] || {};

      // Clear only this container's tabs
      containerStates[cookieStoreId] = {
        tabs: [],
        timestamp: Date.now()
      };

      const promises = [];

      // Save updated state to sync storage
      promises.push(
        browser.storage.sync
          .set({ [this.stateKey]: containerStates })
          .catch(err => console.error('Error clearing sync storage:', err))
      );

      // Update session storage if available
      if (this.hasSessionStorage) {
        promises.push(
          browser.storage.session
            .set({ [this.sessionKey]: containerStates })
            .catch(err => console.error('Error clearing session storage:', err))
        );
      }

      await Promise.all(promises);
      return { tabs: [], timestamp: Date.now() };
    } catch (err) {
      console.error('[QuickTabStateManager] Error in clear():', err);
      return { tabs: [], timestamp: Date.now() };
    }
  }

  /**
   * Get a specific Quick Tab by URL (container-aware)
   * @param {string} url - URL of the Quick Tab
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object|null>} - The Quick Tab object or null if not found
   */
  async getTab(url, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);
    return currentState.tabs.find(tab => tab.url === url) || null;
  }

  /**
   * Pin a Quick Tab to a specific URL (container-aware)
   * @param {string} tabUrl - URL of the Quick Tab
   * @param {string} pinnedToUrl - URL to pin the tab to
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async pinTab(tabUrl, pinnedToUrl, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === tabUrl ? { ...tab, pinnedToUrl } : tab
    );
    return this.save(updatedTabs, cookieStoreId);
  }

  /**
   * Unpin a Quick Tab (container-aware)
   * @param {string} tabUrl - URL of the Quick Tab
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async unpinTab(tabUrl, cookieStoreId = null) {
    if (!cookieStoreId) {
      cookieStoreId = await getCurrentCookieStoreId();
    }

    const currentState = await this.load(cookieStoreId);
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === tabUrl ? { ...tab, pinnedToUrl: null } : tab
    );
    return this.save(updatedTabs, cookieStoreId);
  }
}

// Create a singleton instance for use across the extension
export const stateManager = new QuickTabStateManager();
