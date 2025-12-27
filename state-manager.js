// QuickTabStateManager - Centralized state management for Quick Tabs
// Uses browser.storage.sync for persistent state and browser.storage.local for session-scoped Quick Tabs
// v1.6.3.12-v4 - FIX: Replace storage.session with storage.local (Firefox MV2 compatibility)
// This module is shared between content.js, background.js, and other components

/** Default container ID when none is specified */
const DEFAULT_CONTAINER = 'firefox-default';

/**
 * Get the cookieStoreId of the current tab (for Firefox Container support)
 * @returns {Promise<string>} The cookieStoreId (e.g., "firefox-container-1" or "firefox-default")
 */
async function getCurrentCookieStoreId() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.cookieStoreId || DEFAULT_CONTAINER;
  } catch (err) {
    console.error('[QuickTabStateManager] Error getting cookieStoreId:', err);
    return DEFAULT_CONTAINER;
  }
}

/**
 * QuickTabStateManager class handles all Quick Tab state persistence and synchronization
 * Uses a dual-layer storage approach:
 * - browser.storage.sync: Persistent storage that syncs across devices (container-aware since v1.5.7)
 * - browser.storage.local: Session-scoped storage for Quick Tabs (cleared on browser restart via explicit cleanup)
 * v1.6.3.12-v4 - FIX: Replace storage.session with storage.local (Firefox MV2 compatibility)
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
    this.stateKey = 'quick_tabs_state_v2';
    this.sessionKey = 'quick_tabs_session';
    // v1.6.3.12-v4 - FIX: Always use storage.local (storage.session not available in Firefox MV2)
    // Session-scoped behavior is achieved via explicit startup cleanup in background.js
    this.hasLocalStorage =
      typeof browser !== 'undefined' &&
      browser.storage &&
      typeof browser.storage.local !== 'undefined';
    this.debug = false;
  }

  setDebug(enabled) {
    this.debug = enabled;
  }

  log(message) {
    if (this.debug) {
      console.log(`[QuickTabStateManager] ${message}`);
    }
  }

  /**
   * Resolve cookieStoreId, auto-detecting if not provided
   * @private
   */
  _resolveContainer(cookieStoreId) {
    return cookieStoreId ? Promise.resolve(cookieStoreId) : getCurrentCookieStoreId();
  }

  /**
   * Load existing container states from sync storage
   * @private
   */
  async _loadContainerStates() {
    const existingData = (await browser.storage.sync.get(this.stateKey)) || {};
    return existingData[this.stateKey] || {};
  }

  /**
   * Persist container states to sync storage
   * @private
   */
  _persistToSync(containerStates) {
    return browser.storage.sync
      .set({ [this.stateKey]: containerStates })
      .then(() => this.log('Saved to sync storage'))
      .catch(err => console.error('Error saving to sync storage:', err));
  }

  /**
   * Persist container states to local storage (session-scoped via explicit cleanup)
   * v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
   * @private
   */
  _persistToSession(containerStates) {
    if (!this.hasLocalStorage) return Promise.resolve();
    return browser.storage.local
      .set({ [this.sessionKey]: containerStates })
      .then(() => this.log('Saved to local storage (session-scoped)'))
      .catch(err => console.error('Error saving to local storage:', err));
  }

  /**
   * Save Quick Tab state to storage (container-aware)
   * @param {Array} tabs - Array of Quick Tab objects to save
   * @param {string} cookieStoreId - Optional cookieStoreId (will auto-detect if not provided)
   * @returns {Promise<Object>} - The saved state object
   */
  async save(tabs, cookieStoreId = null) {
    const containerId = await this._resolveContainer(cookieStoreId);
    this.log(`Saving ${tabs.length} Quick Tabs for container: ${containerId}`);

    try {
      const containerStates = await this._loadContainerStates();
      containerStates[containerId] = { tabs: tabs || [], timestamp: Date.now() };

      await Promise.all([
        this._persistToSync(containerStates),
        this._persistToSession(containerStates)
      ]);

      return containerStates[containerId];
    } catch (err) {
      console.error('[QuickTabStateManager] Error in save():', err);
      throw err;
    }
  }

  /**
   * Load Quick Tab state from storage (container-aware)
   * @param {string} cookieStoreId - Optional cookieStoreId (will auto-detect if not provided)
   * @returns {Promise<Object>} - The loaded state object with { tabs: [], timestamp: number }
   */
  async load(cookieStoreId = null) {
    const containerId = await this._resolveContainer(cookieStoreId);
    this.log(`Loading Quick Tab state for container: ${containerId}`);

    try {
      const sessionState = await this._loadFromSession(containerId);
      if (sessionState) return sessionState;

      const syncState = await this._loadFromSync(containerId);
      if (syncState) return syncState;

      this.log(`No saved state found for ${containerId}, returning empty state`);
      return { tabs: [], timestamp: Date.now() };
    } catch (err) {
      console.error('[QuickTabStateManager] Error loading Quick Tab state:', err);
      return { tabs: [], timestamp: Date.now() };
    }
  }

  /**
   * Load state from local storage (session-scoped via explicit cleanup)
   * v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
   * @private
   */
  async _loadFromSession(cookieStoreId) {
    if (!this.hasLocalStorage) return null;

    const sessionResult = await browser.storage.local.get(this.sessionKey);
    const containerState = sessionResult?.[this.sessionKey]?.[cookieStoreId];

    if (containerState) {
      this.log(`Loaded ${containerState.tabs.length} tabs from local storage (session-scoped)`);
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

    // v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
    if (this.hasLocalStorage) {
      await browser.storage.local
        .set({ [this.sessionKey]: containerStates })
        .catch(err => console.error('Error populating local storage:', err));
    }

    const containerState = containerStates[cookieStoreId];
    if (containerState) {
      this.log(`Loaded ${containerState.tabs.length} tabs from sync storage`);
      return containerState;
    }
    return null;
  }

  /**
   * Update tab properties and persist to storage
   * @private
   */
  async _updateTabProperties(tabUrl, properties, cookieStoreId = null) {
    const containerId = await this._resolveContainer(cookieStoreId);
    const currentState = await this.load(containerId);
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === tabUrl ? { ...tab, ...properties } : tab
    );
    return this.save(updatedTabs, containerId);
  }

  /**
   * Update a specific Quick Tab's position (container-aware)
   * @param {string} url - URL of the Quick Tab to update
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  updatePosition(url, left, top, cookieStoreId = null) {
    return this._updateTabProperties(url, { left, top }, cookieStoreId);
  }

  /**
   * Update a specific Quick Tab's size (container-aware)
   * @param {string} url - URL of the Quick Tab to update
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  updateSize(url, width, height, cookieStoreId = null) {
    return this._updateTabProperties(url, { width, height }, cookieStoreId);
  }

  /**
   * Add a new Quick Tab (container-aware)
   * @param {Object} tab - Quick Tab object { url, width, height, left, top, pinnedToUrl }
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async addTab(tab, cookieStoreId = null) {
    const containerId = await this._resolveContainer(cookieStoreId);
    const currentState = await this.load(containerId);

    const existingIndex = currentState.tabs.findIndex(t => t.url === tab.url);
    if (existingIndex !== -1) {
      currentState.tabs[existingIndex] = { ...currentState.tabs[existingIndex], ...tab };
    } else {
      currentState.tabs.push(tab);
    }

    return this.save(currentState.tabs, containerId);
  }

  /**
   * Remove a Quick Tab by URL (container-aware)
   * @param {string} url - URL of the Quick Tab to remove
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  async removeTab(url, cookieStoreId = null) {
    const containerId = await this._resolveContainer(cookieStoreId);
    const currentState = await this.load(containerId);
    const updatedTabs = currentState.tabs.filter(tab => tab.url !== url);
    return this.save(updatedTabs, containerId);
  }

  /**
   * Clear all Quick Tabs (container-aware)
   * @param {string} cookieStoreId - Optional cookieStoreId (will clear only this container's tabs)
   * @returns {Promise<Object>} - The empty state
   */
  async clear(cookieStoreId = null) {
    const containerId = await this._resolveContainer(cookieStoreId);
    this.log(`Clearing all Quick Tabs from storage for container: ${containerId}`);

    try {
      const containerStates = await this._loadContainerStates();
      containerStates[containerId] = { tabs: [], timestamp: Date.now() };

      await Promise.all([
        this._persistToSync(containerStates),
        this._persistToSession(containerStates)
      ]);

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
    const containerId = await this._resolveContainer(cookieStoreId);
    const currentState = await this.load(containerId);
    return currentState.tabs.find(tab => tab.url === url) || null;
  }

  /**
   * Pin a Quick Tab to a specific URL (container-aware)
   * @param {string} tabUrl - URL of the Quick Tab
   * @param {string} pinnedToUrl - URL to pin the tab to
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  pinTab(tabUrl, pinnedToUrl, cookieStoreId = null) {
    return this._updateTabProperties(tabUrl, { pinnedToUrl }, cookieStoreId);
  }

  /**
   * Unpin a Quick Tab (container-aware)
   * @param {string} tabUrl - URL of the Quick Tab
   * @param {string} cookieStoreId - Optional cookieStoreId
   * @returns {Promise<Object>} - The updated state
   */
  unpinTab(tabUrl, cookieStoreId = null) {
    return this._updateTabProperties(tabUrl, { pinnedToUrl: null }, cookieStoreId);
  }
}

// Create a singleton instance for use across the extension
export const stateManager = new QuickTabStateManager();
