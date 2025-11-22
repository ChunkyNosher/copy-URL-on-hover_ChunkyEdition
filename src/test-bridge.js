/**
 * Test Bridge for GitHub Copilot Autonomous Testing
 * 
 * Provides programmatic interface to extension functionality for automated testing
 * in CI environments where keyboard shortcuts cannot be triggered.
 * 
 * SECURITY: Only loads when TEST_MODE environment variable is true
 * USAGE: Accessed via window.__COPILOT_TEST_BRIDGE__ in test environment
 * 
 * @version 1.0.0
 * @see docs/manual/v1.6.0/copilot-testing-implementation.md
 */

// Guard condition - only included in test builds
// This file is only injected during TEST_MODE builds, so if it's present, we load it
console.log('[Test Bridge] Loading test bridge for autonomous testing...');

/**
 * Test Bridge API
 * Exposes extension functionality for programmatic testing
 */
const TestBridge = {
    /**
     * Create a Quick Tab programmatically (bypasses "Q" keyboard shortcut)
     * @param {string} url - URL to load in Quick Tab
     * @param {Object} options - Quick Tab configuration
     * @param {boolean} options.minimized - Start minimized
     * @param {string} options.pinnedToUrl - Pin to specific tab URL
     * @returns {Promise<Object>} Created Quick Tab data
     */
    async createQuickTab(url, options = {}) {
      console.log('[Test Bridge] createQuickTab:', url, options);
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_CREATE_QUICK_TAB',
          data: { url, options }
        });
        
        console.log('[Test Bridge] createQuickTab response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] createQuickTab error:', error);
        throw error;
      }
    },

    /**
     * Get all Quick Tabs from storage
     * @returns {Promise<Array>} Array of Quick Tab objects
     */
    async getQuickTabs() {
      console.log('[Test Bridge] getQuickTabs');
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const cookieStoreId = tabs[0].cookieStoreId || 'firefox-default';
        const storageKey = `quickTabs_${cookieStoreId}`;
        const result = await browser.storage.local.get(storageKey);
        const quickTabs = result[storageKey] || [];
        
        console.log('[Test Bridge] getQuickTabs result:', quickTabs);
        return quickTabs;
      } catch (error) {
        console.error('[Test Bridge] getQuickTabs error:', error);
        throw error;
      }
    },

    /**
     * Get specific Quick Tab by ID
     * @param {string} id - Quick Tab ID
     * @returns {Promise<Object|null>} Quick Tab object or null
     */
    async getQuickTabById(id) {
      console.log('[Test Bridge] getQuickTabById:', id);
      try {
        const quickTabs = await this.getQuickTabs();
        const tab = quickTabs.find(t => t.id === id);
        console.log('[Test Bridge] getQuickTabById result:', tab);
        return tab || null;
      } catch (error) {
        console.error('[Test Bridge] getQuickTabById error:', error);
        throw error;
      }
    },

    /**
     * Minimize a Quick Tab programmatically
     * @param {string} id - Quick Tab ID
     * @returns {Promise<Object>} Operation result
     */
    async minimizeQuickTab(id) {
      console.log('[Test Bridge] minimizeQuickTab:', id);
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_MINIMIZE_QUICK_TAB',
          data: { id }
        });
        
        console.log('[Test Bridge] minimizeQuickTab response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] minimizeQuickTab error:', error);
        throw error;
      }
    },

    /**
     * Restore a minimized Quick Tab programmatically
     * @param {string} id - Quick Tab ID
     * @returns {Promise<Object>} Operation result
     */
    async restoreQuickTab(id) {
      console.log('[Test Bridge] restoreQuickTab:', id);
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_RESTORE_QUICK_TAB',
          data: { id }
        });
        
        console.log('[Test Bridge] restoreQuickTab response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] restoreQuickTab error:', error);
        throw error;
      }
    },

    /**
     * Pin a Quick Tab to current tab URL
     * @param {string} id - Quick Tab ID
     * @returns {Promise<Object>} Operation result
     */
    async pinQuickTab(id) {
      console.log('[Test Bridge] pinQuickTab:', id);
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_PIN_QUICK_TAB',
          data: { id }
        });
        
        console.log('[Test Bridge] pinQuickTab response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] pinQuickTab error:', error);
        throw error;
      }
    },

    /**
     * Unpin a Quick Tab
     * @param {string} id - Quick Tab ID
     * @returns {Promise<Object>} Operation result
     */
    async unpinQuickTab(id) {
      console.log('[Test Bridge] unpinQuickTab:', id);
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_UNPIN_QUICK_TAB',
          data: { id }
        });
        
        console.log('[Test Bridge] unpinQuickTab response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] unpinQuickTab error:', error);
        throw error;
      }
    },

    /**
     * Close a specific Quick Tab
     * @param {string} id - Quick Tab ID
     * @returns {Promise<Object>} Operation result
     */
    async closeQuickTab(id) {
      console.log('[Test Bridge] closeQuickTab:', id);
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_CLOSE_QUICK_TAB',
          data: { id }
        });
        
        console.log('[Test Bridge] closeQuickTab response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] closeQuickTab error:', error);
        throw error;
      }
    },

    /**
     * Wait for Quick Tab count to reach expected value (polling utility for cross-tab sync testing)
     * @param {number} expectedCount - Expected number of Quick Tabs
     * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
     * @returns {Promise<boolean>} True if count reached, false if timeout
     */
    async waitForQuickTabCount(expectedCount, timeoutMs = 5000) {
      console.log('[Test Bridge] waitForQuickTabCount:', expectedCount, 'timeout:', timeoutMs);
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeoutMs) {
        const countReached = await this._checkQuickTabCount(expectedCount);
        if (countReached) {
          console.log('[Test Bridge] waitForQuickTabCount: count reached');
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
      }
      
      console.log('[Test Bridge] waitForQuickTabCount: timeout');
      return false;
    },

    /**
     * Helper to check if Quick Tab count matches expected value
     * @private
     * @param {number} expectedCount - Expected count
     * @returns {Promise<boolean>} True if matches
     */
    async _checkQuickTabCount(expectedCount) {
      try {
        const quickTabs = await this.getQuickTabs();
        return quickTabs.length === expectedCount;
      } catch (error) {
        console.error('[Test Bridge] _checkQuickTabCount error:', error);
        return false;
      }
    },

    /**
     * Clear all Quick Tabs (test cleanup utility)
     * @returns {Promise<Object>} Operation result
     */
    async clearAllQuickTabs() {
      console.log('[Test Bridge] clearAllQuickTabs');
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          throw new Error('No active tab found');
        }
        
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_CLEAR_ALL_QUICK_TABS',
          data: {}
        });
        
        console.log('[Test Bridge] clearAllQuickTabs response:', response);
        return response;
      } catch (error) {
        console.error('[Test Bridge] clearAllQuickTabs error:', error);
        throw error;
      }
    }
  };

};

// Expose test bridge globally
window.__COPILOT_TEST_BRIDGE__ = TestBridge;
console.log('[Test Bridge] ✓ Test bridge exposed at window.__COPILOT_TEST_BRIDGE__');
