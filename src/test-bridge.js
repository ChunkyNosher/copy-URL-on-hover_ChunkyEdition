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
  },

  // v1.6.3.11-v12 - Removed toggleSolo() and toggleMute() methods (Solo/Mute feature removed)

  /**
   * Get visibility state for current tab
   * v1.6.3.11-v12 - Simplified: Solo/Mute removed, only returns visibility info
   * @param {number} tabId - Tab ID to get visibility for
   * @returns {Promise<Object>} Visibility state (visible/hidden QTs)
   */
  async getVisibilityState(tabId) {
    console.log('[Test Bridge] getVisibilityState:', tabId);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_GET_VISIBILITY_STATE',
        data: { tabId }
      });

      console.log('[Test Bridge] getVisibilityState response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] getVisibilityState error:', error);
      throw error;
    }
  },

  // ==================== MANAGER PANEL METHODS ====================

  /**
   * Get manager panel state including tab counts and groupings
   * v1.6.3.12 - J2: Enhanced to include groupings and counts for test verification
   *
   * Note: The flags `includeGroupings` and `includeContainers` are always set to true
   * because tests require full state information. The content script handler should
   * implement these fields for complete test coverage.
   *
   * @returns {Promise<Object>} Panel state with:
   *   - visible: boolean - Whether Manager panel is visible
   *   - tabCount: number - Total Quick Tabs in Manager (requires handler support)
   *   - groupings: Array<{ originTabId, containerLabel, count }> - Tabs grouped by origin (requires handler support)
   *   - containers: Array<{ containerId, label, count }> - Tabs grouped by container (requires handler support)
   */
  async getManagerState() {
    console.log('[Test Bridge] getManagerState');
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_GET_MANAGER_STATE',
        data: { includeGroupings: true, includeContainers: true }
      });

      console.log('[Test Bridge] getManagerState response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] getManagerState error:', error);
      throw error;
    }
  },

  /**
   * Set manager panel position (for testing)
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {Promise<Object>} Operation result
   */
  async setManagerPosition(x, y) {
    console.log('[Test Bridge] setManagerPosition:', x, y);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_SET_MANAGER_POSITION',
        data: { x, y }
      });

      console.log('[Test Bridge] setManagerPosition response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] setManagerPosition error:', error);
      throw error;
    }
  },

  /**
   * Set manager panel size (for testing)
   * @param {number} width - Panel width
   * @param {number} height - Panel height
   * @returns {Promise<Object>} Operation result
   */
  async setManagerSize(width, height) {
    console.log('[Test Bridge] setManagerSize:', width, height);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_SET_MANAGER_SIZE',
        data: { width, height }
      });

      console.log('[Test Bridge] setManagerSize response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] setManagerSize error:', error);
      throw error;
    }
  },

  /**
   * Close all minimized Quick Tabs
   * @returns {Promise<Object>} Operation result with count
   */
  async closeAllMinimized() {
    console.log('[Test Bridge] closeAllMinimized');
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_CLOSE_ALL_MINIMIZED',
        data: {}
      });

      console.log('[Test Bridge] closeAllMinimized response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] closeAllMinimized error:', error);
      throw error;
    }
  },

  // ==================== CONTAINER ISOLATION METHODS ====================

  /**
   * Get all Quick Tabs grouped by container
   * @returns {Promise<Object>} Container info with grouped Quick Tabs
   */
  async getContainerInfo() {
    console.log('[Test Bridge] getContainerInfo');
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_GET_CONTAINER_INFO',
        data: {}
      });

      console.log('[Test Bridge] getContainerInfo response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] getContainerInfo error:', error);
      throw error;
    }
  },

  /**
   * Create Quick Tab in specific container
   * @param {string} url - URL to load
   * @param {string} cookieStoreId - Container cookie store ID
   * @returns {Promise<Object>} Created Quick Tab data
   */
  async createQuickTabInContainer(url, cookieStoreId) {
    console.log('[Test Bridge] createQuickTabInContainer:', url, cookieStoreId);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_CREATE_QUICK_TAB_IN_CONTAINER',
        data: { url, cookieStoreId }
      });

      console.log('[Test Bridge] createQuickTabInContainer response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] createQuickTabInContainer error:', error);
      throw error;
    }
  },

  /**
   * Verify two Quick Tabs are in different containers
   * @param {string} id1 - First Quick Tab ID
   * @param {string} id2 - Second Quick Tab ID
   * @returns {Promise<Object>} Verification result with container info
   */
  async verifyContainerIsolation(id1, id2) {
    console.log('[Test Bridge] verifyContainerIsolation:', id1, id2);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_VERIFY_CONTAINER_ISOLATION',
        data: { id1, id2 }
      });

      console.log('[Test Bridge] verifyContainerIsolation response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] verifyContainerIsolation error:', error);
      throw error;
    }
  },

  /**
   * Verify Quick Tabs are properly isolated within a specific container
   * v1.6.3.12 - J2: New method for single-container isolation verification
   * @param {string} containerId - Container cookie store ID (e.g., 'firefox-container-1')
   * @returns {Promise<Object>} Verification result:
   *   - isolated: boolean - Whether all Quick Tabs in container are properly isolated
   *   - quickTabCount: number - Count of Quick Tabs in this container
   *   - quickTabIds: string[] - IDs of Quick Tabs in this container
   *   - containerLabel: string - Human-readable container label
   *   - crossContainerViolations: string[] - IDs of Quick Tabs incorrectly in other containers
   */
  async verifyContainerIsolationById(containerId) {
    console.log('[Test Bridge] verifyContainerIsolationById:', containerId);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_VERIFY_CONTAINER_ISOLATION_BY_ID',
        data: { containerId }
      });

      console.log('[Test Bridge] verifyContainerIsolationById response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] verifyContainerIsolationById error:', error);
      throw error;
    }
  },

  /**
   * Get human-readable label for a Firefox container
   * v1.6.3.12 - J2: New method for container label lookup
   * @param {string} containerId - Container cookie store ID (e.g., 'firefox-container-1')
   * @returns {Promise<Object>} Container label info:
   *   - containerId: string - The container ID requested
   *   - label: string - Human-readable label (e.g., 'Personal', 'Work', 'Banking')
   *   - color: string - Container color
   *   - icon: string - Container icon
   *   - exists: boolean - Whether the container exists
   */
  async getContainerLabel(containerId) {
    console.log('[Test Bridge] getContainerLabel:', containerId);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_GET_CONTAINER_LABEL',
        data: { containerId }
      });

      console.log('[Test Bridge] getContainerLabel response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] getContainerLabel error:', error);
      throw error;
    }
  },

  /**
   * Verify cross-tab isolation - ensure Quick Tabs don't appear in wrong tabs
   * v1.6.3.12 - J2: New method for cross-tab isolation verification
   * @param {number} originTabId - Expected origin tab ID
   * @returns {Promise<Object>} Verification result:
   *   - isolated: boolean - Whether Quick Tabs are properly isolated to origin tab
   *   - quickTabCount: number - Count of Quick Tabs belonging to this tab
   *   - violations: Array<{quickTabId, expectedTabId, actualTabId}>
   */
  async verifyCrossTabIsolation(originTabId) {
    console.log('[Test Bridge] verifyCrossTabIsolation:', originTabId);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_VERIFY_CROSS_TAB_ISOLATION',
        data: { originTabId }
      });

      console.log('[Test Bridge] verifyCrossTabIsolation response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] verifyCrossTabIsolation error:', error);
      throw error;
    }
  },

  // ==================== DEBUG MODE METHODS ====================

  /**
   * Get slot numbering information for debug mode
   * @returns {Promise<Object>} Slot numbering info
   */
  async getSlotNumbering() {
    console.log('[Test Bridge] getSlotNumbering');
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_GET_SLOT_NUMBERING',
        data: {}
      });

      console.log('[Test Bridge] getSlotNumbering response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] getSlotNumbering error:', error);
      throw error;
    }
  },

  /**
   * Set debug mode on/off
   * @param {boolean} enabled - Enable or disable debug mode
   * @returns {Promise<Object>} Operation result
   */
  async setDebugMode(enabled) {
    console.log('[Test Bridge] setDebugMode:', enabled);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_SET_DEBUG_MODE',
        data: { enabled }
      });

      console.log('[Test Bridge] setDebugMode response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] setDebugMode error:', error);
      throw error;
    }
  },

  // ==================== GEOMETRY/Z-INDEX METHODS ====================

  /**
   * Get Quick Tab geometry (position, size, z-index)
   * @param {string} id - Quick Tab ID
   * @returns {Promise<Object>} Geometry data
   */
  async getQuickTabGeometry(id) {
    console.log('[Test Bridge] getQuickTabGeometry:', id);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_GET_QUICK_TAB_GEOMETRY',
        data: { id }
      });

      console.log('[Test Bridge] getQuickTabGeometry response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] getQuickTabGeometry error:', error);
      throw error;
    }
  },

  /**
   * Verify z-index stacking order
   * @param {Array<string>} ids - Quick Tab IDs in expected order (front to back)
   * @returns {Promise<Object>} Verification result
   */
  async verifyZIndexOrder(ids) {
    console.log('[Test Bridge] verifyZIndexOrder:', ids);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_VERIFY_ZINDEX_ORDER',
        data: { ids }
      });

      console.log('[Test Bridge] verifyZIndexOrder response:', response);
      return response;
    } catch (error) {
      console.error('[Test Bridge] verifyZIndexOrder error:', error);
      throw error;
    }
  }
};

// Expose test bridge globally
window.__COPILOT_TEST_BRIDGE__ = TestBridge;
console.log('[Test Bridge] ✓ Test bridge exposed at window.__COPILOT_TEST_BRIDGE__');
