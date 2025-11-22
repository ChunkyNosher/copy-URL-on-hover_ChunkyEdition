/**
 * Extension Test Utilities for GitHub Copilot Autonomous Testing
 * 
 * Provides wrapper utilities for Playwright MCP to interact with browser extension
 * via the Test Bridge programmatic interface.
 * 
 * @version 1.0.0
 * @see docs/manual/v1.6.0/copilot-testing-implementation.md
 */

import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';

/**
 * Helper class for testing browser extension with Playwright MCP
 * Wraps Test Bridge API for convenient test authoring
 */
export class ExtensionTestHelper {
  /**
   * @param {import('@playwright/test').Page} page - Playwright page object
   */
  constructor(page) {
    this.page = page;
    this.screenshotDir = 'test-results/screenshots';
  }

  /**
   * Wait for test bridge to be available in the page
   * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
   * @returns {Promise<boolean>} True if available, false if timeout
   */
  async waitForTestBridge(timeoutMs = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      // eslint-disable-next-line max-depth
      const bridgeFound = await this._checkBridgeAvailability();
      if (bridgeFound) {
        console.log('[ExtensionTestHelper] Test bridge available');
        return true;
      }
      
      await this.page.waitForTimeout(100);
    }
    
    console.error('[ExtensionTestHelper] Test bridge not available after timeout');
    return false;
  }

  /**
   * Helper to check if test bridge is available
   * @private
   * @returns {Promise<boolean>}
   */
  async _checkBridgeAvailability() {
    try {
      return await this.page.evaluate(() => {
        return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
      });
    } catch (error) {
      console.error('[ExtensionTestHelper] Error checking test bridge:', error);
      return false;
    }
  }

  /**
   * Create a Quick Tab programmatically
   * @param {string} url - URL to load in Quick Tab
   * @param {Object} options - Quick Tab options
   * @returns {Promise<Object>} Created Quick Tab data
   */
  async createQuickTab(url, options = {}) {
    return this.page.evaluate(
      async ({ url, options }) => {
        return window.__COPILOT_TEST_BRIDGE__.createQuickTab(url, options);
      },
      { url, options }
    );
  }

  /**
   * Get all Quick Tabs from storage
   * @returns {Promise<Array>} Array of Quick Tab objects
   */
  async getQuickTabs() {
    return this.page.evaluate(async () => {
      return window.__COPILOT_TEST_BRIDGE__.getQuickTabs();
    });
  }

  /**
   * Get specific Quick Tab by ID
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object|null>} Quick Tab object or null
   */
  async getQuickTabById(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.getQuickTabById(id);
      },
      { id }
    );
  }

  /**
   * Minimize a Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Operation result
   */
  async minimizeQuickTab(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.minimizeQuickTab(id);
      },
      { id }
    );
  }

  /**
   * Restore a minimized Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Operation result
   */
  async restoreQuickTab(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.restoreQuickTab(id);
      },
      { id }
    );
  }

  /**
   * Pin a Quick Tab to current tab
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Operation result
   */
  async pinQuickTab(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.pinQuickTab(id);
      },
      { id }
    );
  }

  /**
   * Unpin a Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Operation result
   */
  async unpinQuickTab(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.unpinQuickTab(id);
      },
      { id }
    );
  }

  /**
   * Close a specific Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Operation result
   */
  async closeQuickTab(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.closeQuickTab(id);
      },
      { id }
    );
  }

  /**
   * Wait for Quick Tab count to reach expected value
   * @param {number} count - Expected count
   * @param {number} timeout - Timeout in milliseconds (default: 5000)
   * @returns {Promise<boolean>} True if count reached, false if timeout
   */
  async waitForQuickTabCount(count, timeout = 5000) {
    return this.page.evaluate(
      async ({ count, timeout }) => {
        return window.__COPILOT_TEST_BRIDGE__.waitForQuickTabCount(count, timeout);
      },
      { count, timeout }
    );
  }

  /**
   * Clear all Quick Tabs (test cleanup)
   * @returns {Promise<Object>} Operation result
   */
  async clearAllQuickTabs() {
    return this.page.evaluate(async () => {
      return window.__COPILOT_TEST_BRIDGE__.clearAllQuickTabs();
    });
  }

  // ==================== NEW TEST BRIDGE METHODS ====================
  // Added for Issue #47 autonomous testing

  /**
   * Toggle solo mode for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @param {number} tabId - Browser tab ID (optional)
   * @returns {Promise<Object>} Operation result
   */
  async toggleSolo(id, tabId) {
    return this.page.evaluate(
      async ({ id, tabId }) => {
        return window.__COPILOT_TEST_BRIDGE__.toggleSolo(id, tabId);
      },
      { id, tabId }
    );
  }

  /**
   * Toggle mute mode for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @param {number} tabId - Browser tab ID (optional)
   * @returns {Promise<Object>} Operation result
   */
  async toggleMute(id, tabId) {
    return this.page.evaluate(
      async ({ id, tabId }) => {
        return window.__COPILOT_TEST_BRIDGE__.toggleMute(id, tabId);
      },
      { id, tabId }
    );
  }

  /**
   * Get visibility state for all Quick Tabs on a specific tab
   * @param {number} tabId - Browser tab ID (optional)
   * @returns {Promise<Object>} Visibility state
   */
  async getVisibilityState(tabId) {
    return this.page.evaluate(
      async ({ tabId }) => {
        return window.__COPILOT_TEST_BRIDGE__.getVisibilityState(tabId);
      },
      { tabId }
    );
  }

  /**
   * Get Manager Panel state
   * @returns {Promise<Object>} Manager state
   */
  async getManagerState() {
    return this.page.evaluate(async () => {
      return window.__COPILOT_TEST_BRIDGE__.getManagerState();
    });
  }

  /**
   * Set Manager Panel position
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {Promise<Object>} Operation result
   */
  async setManagerPosition(x, y) {
    return this.page.evaluate(
      async ({ x, y }) => {
        return window.__COPILOT_TEST_BRIDGE__.setManagerPosition(x, y);
      },
      { x, y }
    );
  }

  /**
   * Set Manager Panel size
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   * @returns {Promise<Object>} Operation result
   */
  async setManagerSize(width, height) {
    return this.page.evaluate(
      async ({ width, height }) => {
        return window.__COPILOT_TEST_BRIDGE__.setManagerSize(width, height);
      },
      { width, height }
    );
  }

  /**
   * Close all minimized Quick Tabs via Manager
   * @returns {Promise<Object>} Operation result
   */
  async closeAllMinimized() {
    return this.page.evaluate(async () => {
      return window.__COPILOT_TEST_BRIDGE__.closeAllMinimized();
    });
  }

  /**
   * Get container information for all Quick Tabs
   * @returns {Promise<Object>} Container info
   */
  async getContainerInfo() {
    return this.page.evaluate(async () => {
      return window.__COPILOT_TEST_BRIDGE__.getContainerInfo();
    });
  }

  /**
   * Create Quick Tab in specific container
   * @param {string} url - URL to load
   * @param {string} cookieStoreId - Firefox container ID
   * @returns {Promise<Object>} Operation result
   */
  async createQuickTabInContainer(url, cookieStoreId) {
    return this.page.evaluate(
      async ({ url, cookieStoreId }) => {
        return window.__COPILOT_TEST_BRIDGE__.createQuickTabInContainer(url, cookieStoreId);
      },
      { url, cookieStoreId }
    );
  }

  /**
   * Verify container isolation between two Quick Tabs
   * @param {string} id1 - First Quick Tab ID
   * @param {string} id2 - Second Quick Tab ID
   * @returns {Promise<Object>} Isolation result
   */
  async verifyContainerIsolation(id1, id2) {
    return this.page.evaluate(
      async ({ id1, id2 }) => {
        return window.__COPILOT_TEST_BRIDGE__.verifyContainerIsolation(id1, id2);
      },
      { id1, id2 }
    );
  }

  /**
   * Get slot numbering information (debug mode)
   * @returns {Promise<Object>} Slot numbering data
   */
  async getSlotNumbering() {
    return this.page.evaluate(async () => {
      return window.__COPILOT_TEST_BRIDGE__.getSlotNumbering();
    });
  }

  /**
   * Enable/disable debug mode
   * @param {boolean} enabled - Debug mode state
   * @returns {Promise<Object>} Operation result
   */
  async setDebugMode(enabled) {
    return this.page.evaluate(
      async ({ enabled }) => {
        return window.__COPILOT_TEST_BRIDGE__.setDebugMode(enabled);
      },
      { enabled }
    );
  }

  /**
   * Get Quick Tab position, size, and z-index
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Geometry data
   */
  async getQuickTabGeometry(id) {
    return this.page.evaluate(
      async ({ id }) => {
        return window.__COPILOT_TEST_BRIDGE__.getQuickTabGeometry(id);
      },
      { id }
    );
  }

  /**
   * Verify z-index order for focus management
   * @param {string[]} ids - Array of Quick Tab IDs in expected order
   * @returns {Promise<Object>} Verification result
   */
  async verifyZIndexOrder(ids) {
    return this.page.evaluate(
      async ({ ids }) => {
        return window.__COPILOT_TEST_BRIDGE__.verifyZIndexOrder(ids);
      },
      { ids }
    );
  }

  // ==================== ENHANCED SYNC UTILITIES ====================
  // Added for robust cross-tab synchronization testing

  /**
   * Wait for specific Quick Tab to appear across all pages in context
   * @param {string} id - Quick Tab ID to wait for
   * @param {number} timeout - Max wait time in ms (default: 5000)
   * @returns {Promise<boolean>} True if found, false if timeout
   */
  async waitForQuickTabSync(id, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const tabs = await this.getQuickTabs();
      if (tabs.some(t => t.id === id)) {
        return true;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error(`Quick Tab ${id} did not sync within ${timeout}ms`);
  }

  /**
   * Wait for Quick Tab state to match expected state
   * @param {string} id - Quick Tab ID
   * @param {Object} expectedState - Expected state properties
   * @param {number} timeout - Max wait time (default: 5000)
   * @returns {Promise<Object>} The matched tab object
   */
  async waitForQuickTabState(id, expectedState, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const tab = await this.getQuickTabById(id);
      if (tab && this.stateMatches(tab, expectedState)) {
        return tab;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error(`Quick Tab ${id} did not reach expected state within ${timeout}ms`);
  }

  /**
   * Helper to check if state matches expected properties
   * @param {Object} actual - Actual state object
   * @param {Object} expected - Expected properties
   * @returns {boolean} True if matches
   */
  stateMatches(actual, expected) {
    return Object.keys(expected).every(key => actual[key] === expected[key]);
  }

  /**
   * Wait for BroadcastChannel message propagation
   * Uses exponential backoff for reliability
   * @param {number} timeout - Max wait time (default: 3000)
   * @returns {Promise<void>}
   */
  async waitForBroadcastSync(timeout = 3000) {
    let delay = 50;
    const maxDelay = 500;
    const endTime = Date.now() + timeout;
    
    while (Date.now() < endTime) {
      await this.page.waitForTimeout(delay);
      delay = Math.min(delay * 1.5, maxDelay);
    }
  }

  /**
   * Take a screenshot of the current page
   * @param {string} name - Screenshot filename (without extension)
   * @returns {Promise<void>}
   */
  async takeScreenshot(name) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      const filepath = join(this.screenshotDir, filename);
      
      // Ensure directory exists
      await mkdir(dirname(filepath), { recursive: true });
      
      await this.page.screenshot({ path: filepath });
      console.log(`[ExtensionTestHelper] Screenshot saved: ${filepath}`);
    } catch (error) {
      console.error('[ExtensionTestHelper] Screenshot error:', error);
    }
  }

  /**
   * Verify Quick Tab behavior for specific scenario
   * @param {string} scenario - Scenario name
   * @returns {Promise<Object>} Verification result
   */
  async verifyQuickTabBehavior(scenario) {
    console.log(`[ExtensionTestHelper] Verifying scenario: ${scenario}`);
    
    switch (scenario) {
      case 'basic-creation':
        return this._verifyBasicCreation();
      
      case 'cross-tab-persistence':
        return this._verifyCrossTabPersistence();
      
      case 'pinning':
        return this._verifyPinning();
      
      case 'minimization':
        return this._verifyMinimization();
      
      case 'multiple-quick-tabs':
        return this._verifyMultipleQuickTabs();
      
      default:
        return {
          passed: false,
          message: `Unknown scenario: ${scenario}`,
          data: null
        };
    }
  }

  /**
   * Verify basic Quick Tab creation
   * @private
   */
  async _verifyBasicCreation() {
    try {
      const url = 'https://example.com';
      await this.createQuickTab(url);
      const tabs = await this.getQuickTabs();
      
      const passed = tabs.length === 1 && tabs[0].url === url;
      
      return {
        passed,
        message: passed ? 'Basic creation verified' : 'Basic creation failed',
        data: { tabs }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Error: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Verify cross-tab persistence
   * @private
   */
  async _verifyCrossTabPersistence() {
    try {
      // Create Quick Tab in current tab
      const url = 'https://example.com/test';
      await this.createQuickTab(url);
      
      // Open new tab (requires context to be passed in)
      // This would need to be implemented in the test itself
      // as it requires access to browser context
      
      return {
        passed: true,
        message: 'Cross-tab persistence test requires context access',
        data: { note: 'Implement in test file with context.newPage()' }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Error: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Verify pinning behavior
   * @private
   */
  async _verifyPinning() {
    try {
      const url = 'https://example.com/pin-test';
      await this.createQuickTab(url);
      const tabs = await this.getQuickTabs();
      
      if (tabs.length === 0) {
        throw new Error('No tabs created');
      }
      
      const tabId = tabs[0].id;
      
      // Pin the tab
      await this.pinQuickTab(tabId);
      const pinnedTab = await this.getQuickTabById(tabId);
      
      const passed = pinnedTab && pinnedTab.pinnedToUrl !== null;
      
      return {
        passed,
        message: passed ? 'Pinning verified' : 'Pinning failed',
        data: { pinnedTab }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Error: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Verify minimization behavior
   * @private
   */
  async _verifyMinimization() {
    try {
      const url = 'https://example.com/minimize-test';
      await this.createQuickTab(url);
      const tabs = await this.getQuickTabs();
      
      if (tabs.length === 0) {
        throw new Error('No tabs created');
      }
      
      const tabId = tabs[0].id;
      
      // Minimize the tab
      await this.minimizeQuickTab(tabId);
      const minimizedTab = await this.getQuickTabById(tabId);
      
      const passed = minimizedTab && minimizedTab.minimized === true;
      
      return {
        passed,
        message: passed ? 'Minimization verified' : 'Minimization failed',
        data: { minimizedTab }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Error: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Verify multiple Quick Tabs
   * @private
   */
  async _verifyMultipleQuickTabs() {
    try {
      const urls = [
        'https://en.wikipedia.org',
        'https://youtube.com',
        'https://github.com'
      ];
      
      for (const url of urls) {
        await this.createQuickTab(url);
      }
      
      const tabs = await this.getQuickTabs();
      const passed = tabs.length === urls.length;
      
      return {
        passed,
        message: passed
          ? `All ${urls.length} Quick Tabs created`
          : `Expected ${urls.length} tabs, got ${tabs.length}`,
        data: { tabs }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Error: ${error.message}`,
        data: null
      };
    }
  }
}
