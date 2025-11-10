// QuickTabStateManager - Centralized state management for Quick Tabs
// Uses browser.storage.sync for persistent state and browser.storage.session for fast ephemeral sync
// This module is shared between content.js, background.js, and other components

/**
 * QuickTabStateManager class handles all Quick Tab state persistence and synchronization
 * Uses a dual-layer storage approach:
 * - browser.storage.sync: Persistent storage that syncs across devices
 * - browser.storage.session: Fast ephemeral storage for current session (Firefox 115+)
 */
export class QuickTabStateManager {
  constructor() {
    // Storage keys
    this.stateKey = 'quick_tabs_state_v2';
    this.sessionKey = 'quick_tabs_session';
    
    // Feature detection for browser.storage.session (Firefox 115+)
    this.hasSessionStorage = typeof browser !== 'undefined' && 
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
   * Save Quick Tab state to storage
   * @param {Array} tabs - Array of Quick Tab objects to save
   * @returns {Promise<Object>} - The saved state object
   */
  async save(tabs) {
    const state = { 
      tabs: tabs || [], 
      timestamp: Date.now() 
    };
    
    this.log(`Saving ${state.tabs.length} Quick Tabs to storage`);
    
    const promises = [];
    
    // Always save to sync storage for persistence
    promises.push(
      browser.storage.sync.set({ [this.stateKey]: state })
        .then(() => this.log('Saved to sync storage'))
        .catch(err => console.error('Error saving to sync storage:', err))
    );
    
    // Also save to session storage if available (faster reads)
    if (this.hasSessionStorage) {
      promises.push(
        browser.storage.session.set({ [this.sessionKey]: state })
          .then(() => this.log('Saved to session storage'))
          .catch(err => console.error('Error saving to session storage:', err))
      );
    }
    
    await Promise.all(promises);
    return state;
  }

  /**
   * Load Quick Tab state from storage
   * Tries session storage first (faster), falls back to sync storage
   * @returns {Promise<Object>} - The loaded state object with { tabs: [], timestamp: number }
   */
  async load() {
    this.log('Loading Quick Tab state from storage');
    
    try {
      // Try session storage first (faster)
      if (this.hasSessionStorage) {
        const sessionResult = await browser.storage.session.get(this.sessionKey);
        if (sessionResult && sessionResult[this.sessionKey]) {
          this.log(`Loaded ${sessionResult[this.sessionKey].tabs.length} tabs from session storage`);
          return sessionResult[this.sessionKey];
        }
      }
      
      // Fall back to sync storage
      const syncResult = await browser.storage.sync.get(this.stateKey);
      if (syncResult && syncResult[this.stateKey]) {
        this.log(`Loaded ${syncResult[this.stateKey].tabs.length} tabs from sync storage`);
        
        // Populate session storage for faster future reads
        if (this.hasSessionStorage) {
          await browser.storage.session.set({ [this.sessionKey]: syncResult[this.stateKey] })
            .catch(err => console.error('Error populating session storage:', err));
        }
        
        return syncResult[this.stateKey];
      }
      
      // No state found
      this.log('No saved state found, returning empty state');
      return { tabs: [], timestamp: Date.now() };
      
    } catch (err) {
      console.error('Error loading Quick Tab state:', err);
      return { tabs: [], timestamp: Date.now() };
    }
  }

  /**
   * Update a specific Quick Tab's position
   * @param {string} url - URL of the Quick Tab to update
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @returns {Promise<Object>} - The updated state
   */
  async updatePosition(url, left, top) {
    const currentState = await this.load();
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === url ? { ...tab, left, top } : tab
    );
    return await this.save(updatedTabs);
  }

  /**
   * Update a specific Quick Tab's size
   * @param {string} url - URL of the Quick Tab to update
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   * @returns {Promise<Object>} - The updated state
   */
  async updateSize(url, width, height) {
    const currentState = await this.load();
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === url ? { ...tab, width, height } : tab
    );
    return await this.save(updatedTabs);
  }

  /**
   * Add a new Quick Tab
   * @param {Object} tab - Quick Tab object { url, width, height, left, top, pinnedToUrl }
   * @returns {Promise<Object>} - The updated state
   */
  async addTab(tab) {
    const currentState = await this.load();
    
    // Check if tab already exists
    const existingIndex = currentState.tabs.findIndex(t => t.url === tab.url);
    if (existingIndex !== -1) {
      // Update existing tab
      currentState.tabs[existingIndex] = { ...currentState.tabs[existingIndex], ...tab };
    } else {
      // Add new tab
      currentState.tabs.push(tab);
    }
    
    return await this.save(currentState.tabs);
  }

  /**
   * Remove a Quick Tab by URL
   * @param {string} url - URL of the Quick Tab to remove
   * @returns {Promise<Object>} - The updated state
   */
  async removeTab(url) {
    const currentState = await this.load();
    const updatedTabs = currentState.tabs.filter(tab => tab.url !== url);
    return await this.save(updatedTabs);
  }

  /**
   * Clear all Quick Tabs
   * @returns {Promise<Object>} - The empty state
   */
  async clear() {
    this.log('Clearing all Quick Tabs from storage');
    
    const promises = [];
    
    // Clear sync storage
    promises.push(
      browser.storage.sync.remove(this.stateKey)
        .catch(err => console.error('Error clearing sync storage:', err))
    );
    
    // Clear session storage if available
    if (this.hasSessionStorage) {
      promises.push(
        browser.storage.session.remove(this.sessionKey)
          .catch(err => console.error('Error clearing session storage:', err))
      );
    }
    
    await Promise.all(promises);
    return { tabs: [], timestamp: Date.now() };
  }

  /**
   * Get a specific Quick Tab by URL
   * @param {string} url - URL of the Quick Tab
   * @returns {Promise<Object|null>} - The Quick Tab object or null if not found
   */
  async getTab(url) {
    const currentState = await this.load();
    return currentState.tabs.find(tab => tab.url === url) || null;
  }

  /**
   * Pin a Quick Tab to a specific URL
   * @param {string} tabUrl - URL of the Quick Tab
   * @param {string} pinnedToUrl - URL to pin the tab to
   * @returns {Promise<Object>} - The updated state
   */
  async pinTab(tabUrl, pinnedToUrl) {
    const currentState = await this.load();
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === tabUrl ? { ...tab, pinnedToUrl } : tab
    );
    return await this.save(updatedTabs);
  }

  /**
   * Unpin a Quick Tab
   * @param {string} tabUrl - URL of the Quick Tab
   * @returns {Promise<Object>} - The updated state
   */
  async unpinTab(tabUrl) {
    const currentState = await this.load();
    const updatedTabs = currentState.tabs.map(tab =>
      tab.url === tabUrl ? { ...tab, pinnedToUrl: null } : tab
    );
    return await this.save(updatedTabs);
  }
}

// Create a singleton instance for use across the extension
export const stateManager = new QuickTabStateManager();
