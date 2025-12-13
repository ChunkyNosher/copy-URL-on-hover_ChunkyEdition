/**
 * Cross-Tab Simulation Framework
 * v1.6.3.8-v6 - BC REMOVED: Updated to use storage.onChanged for cross-tab sync
 *
 * Provides utilities for simulating multiple browser tabs in unit tests
 * to validate cross-tab synchronization behaviors.
 *
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 7.2)
 * - docs/issue-47-revised-scenarios.md
 *
 * Note: Uses pure mocks instead of JSDOM to avoid dependency issues
 */

/**
 * Creates a simulated browser tab context with isolated storage
 * v1.6.3.8-v6 - BC REMOVED: broadcastChannel field kept for backwards compat only
 * @param {string} url - URL for the simulated tab
 * @param {string} containerId - Firefox container ID (default: 'firefox-default')
 * @returns {Promise<Object>} Simulated tab context
 */
export async function createSimulatedTab(url, containerId = 'firefox-default') {
  // Generate unique tab ID
  const tabId = Math.floor(Math.random() * 1000000);

  // Create mock DOM for this tab
  const mockDocument = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn()
  };

  const mockWindow = {
    document: mockDocument,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    }
  };

  // Create isolated storage mock for cross-tab sync via storage.onChanged
  const storage = new Map();
  const storageAPI = {
    sync: {
      get: jest.fn(async keys => {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (storage.has(key)) {
              result[key] = storage.get(key);
            }
          });
        } else if (typeof keys === 'string') {
          if (storage.has(keys)) {
            result[keys] = storage.get(keys);
          }
        } else if (keys === null || keys === undefined) {
          // Get all
          storage.forEach((value, key) => {
            result[key] = value;
          });
        }
        return result;
      }),
      set: jest.fn(async items => {
        Object.entries(items).forEach(([key, value]) => {
          storage.set(key, value);
        });
      }),
      remove: jest.fn(async keys => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => storage.delete(key));
      }),
      clear: jest.fn(async () => {
        storage.clear();
      })
    },
    local: {
      get: jest.fn(async keys => {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (storage.has(key)) {
              result[key] = storage.get(key);
            }
          });
        } else if (typeof keys === 'string') {
          if (storage.has(keys)) {
            result[keys] = storage.get(keys);
          }
        }
        return result;
      }),
      set: jest.fn(async items => {
        Object.entries(items).forEach(([key, value]) => {
          storage.set(key, value);
        });
      }),
      remove: jest.fn(async keys => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => storage.delete(key));
      }),
      clear: jest.fn(async () => {
        storage.clear();
      })
    }
  };

  // v1.6.3.8-v6 - BC REMOVED: Kept for backwards compatibility with existing tests
  // Tests should migrate to storage.onChanged based sync testing
  const broadcastListeners = [];
  const broadcastChannel = {
    postMessage: jest.fn(_message => {
      // NO-OP - BC removed, but kept for test backwards compatibility
    }),
    addEventListener: jest.fn((_event, _listener) => {
      // NO-OP - BC removed
    }),
    removeEventListener: jest.fn((_event, _listener) => {
      // NO-OP - BC removed
    }),
    close: jest.fn(),
    onmessage: null
  };

  // Mock browser.tabs API
  const tabsAPI = {
    query: jest.fn(async query => {
      if (query.active && query.currentWindow) {
        return [
          {
            id: tabId,
            url,
            cookieStoreId: containerId,
            active: true
          }
        ];
      }
      return [];
    }),
    get: jest.fn(async id => {
      if (id === tabId) {
        return {
          id: tabId,
          url,
          cookieStoreId: containerId,
          active: true
        };
      }
      throw new Error('Tab not found');
    }),
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onActivated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  };

  return {
    tabId,
    containerId,
    url,
    window: mockWindow,
    document: mockDocument,
    storage: storageAPI,
    broadcastChannel,
    tabs: tabsAPI,
    _storage: storage, // Internal storage map for direct access in tests
    _broadcastListeners: broadcastListeners // Internal listeners array
  };
}

/**
 * Switches focus between simulated tabs
 * @param {Object} fromTab - Tab losing focus
 * @param {Object} toTab - Tab gaining focus
 */
export async function switchToTab(fromTab, toTab) {
  if (fromTab) {
    // Trigger visibilitychange on previous tab
    fromTab.document.hidden = true;
    fromTab.document.visibilityState = 'hidden';

    // Call all visibility change listeners
    if (fromTab.document.addEventListener.mock) {
      const calls = fromTab.document.addEventListener.mock.calls;
      calls.forEach(call => {
        if (call[0] === 'visibilitychange') {
          call[1]({ type: 'visibilitychange' });
        }
      });
    }
  }

  if (toTab) {
    // Trigger focus events on new tab
    toTab.document.hidden = false;
    toTab.document.visibilityState = 'visible';

    // Call all visibility change listeners
    if (toTab.document.addEventListener.mock) {
      const calls = toTab.document.addEventListener.mock.calls;
      calls.forEach(call => {
        if (call[0] === 'visibilitychange') {
          call[1]({ type: 'visibilitychange' });
        }
      });
    }

    // Call all focus listeners
    if (toTab.window.addEventListener.mock) {
      const calls = toTab.window.addEventListener.mock.calls;
      calls.forEach(call => {
        if (call[0] === 'focus') {
          call[1]({ type: 'focus' });
        }
      });
    }
  }

  // Allow event handlers to process
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Simulates broadcast message propagation between tabs
 * v1.6.3.8-v6 - BC REMOVED: This function is now a no-op stub
 * Tests should migrate to storage.onChanged based sync testing
 * @param {Object} _sourceTab - Tab sending the message (unused)
 * @param {Object} _message - Message to broadcast (unused)
 * @param {Array<Object>} _targetTabs - Tabs to receive the message (unused)
 * @param {number} delay - Delivery delay in ms (default: 10)
 */
export async function propagateBroadcast(_sourceTab, _message, _targetTabs, delay = 10) {
  // v1.6.3.8-v6 - BC removed, this function is now a no-op
  // Tests should use storage.onChanged based sync testing
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Creates multi-tab test scenario
 * v1.6.3.8-v6 - BC REMOVED: broadcastChannel setup simplified
 * @param {Array<Object>} configs - Array of {url, containerId} objects
 * @returns {Promise<Array<Object>>} Array of simulated tab contexts
 */
export async function createMultiTabScenario(configs) {
  const tabs = [];

  for (const config of configs) {
    const tab = await createSimulatedTab(config.url, config.containerId);
    tabs.push(tab);
  }

  // v1.6.3.8-v6 - BC removed, broadcastChannel is now a no-op stub
  // Tests should use storage.onChanged based sync testing

  return tabs;
}

/**
 * Waits for a specific condition with timeout
 * @param {Function} condition - Condition function returning boolean
 * @param {number} timeout - Timeout in ms (default: 1000)
 * @param {number} interval - Check interval in ms (default: 50)
 * @returns {Promise<boolean>} True if condition met, false if timeout
 */
export async function waitForCondition(condition, timeout = 1000, interval = 50) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  return false;
}

/**
 * Simulates browser restart by clearing in-memory state
 * @param {Array<Object>} tabs - Tabs to persist storage from
 * @returns {Object} Persisted storage data
 */
export function simulateBrowserRestart(tabs) {
  const persistedStorage = {};

  tabs.forEach(tab => {
    tab._storage.forEach((value, key) => {
      persistedStorage[key] = value;
    });
  });

  return persistedStorage;
}

/**
 * Restores storage after browser restart simulation
 * @param {Array<Object>} tabs - Tabs to restore storage to
 * @param {Object} persistedStorage - Storage data to restore
 */
export function restoreStorageAfterRestart(tabs, persistedStorage) {
  tabs.forEach(tab => {
    tab._storage.clear();
    Object.entries(persistedStorage).forEach(([key, value]) => {
      tab._storage.set(key, value);
    });
  });
}

/**
 * Creates a cross-tab simulator for comprehensive cross-tab testing
 * v1.6.4 - New enhanced simulator API
 * @returns {Object} Cross-tab simulator instance
 */
export function createCrossTabSimulator() {
  const state = {
    tabs: new Map(),
    globalStorage: new Map(),
    messageHistory: [],
    closedTabs: []
  };

  /**
   * Create a simulated tab
   * @param {number} tabId - Tab ID
   * @param {string} domain - Domain URL
   * @param {string} container - Container ID (default: 'firefox-default')
   * @returns {Object} Tab context
   */
  function createTab(tabId, domain, container = 'firefox-default') {
    const tabStorage = new Map();

    const tab = {
      tabId,
      domain,
      container,
      url: `https://${domain}/`,
      active: true,
      hidden: false,
      visibilityState: 'visible',

      // Per-tab storage (filtered view of global)
      storage: {
        get: jest.fn(async keys => {
          const result = {};
          const keysArray = keys === null || keys === undefined
            ? Array.from(tabStorage.keys())
            : Array.isArray(keys)
            ? keys
            : [keys];

          for (const key of keysArray) {
            if (tabStorage.has(key)) {
              result[key] = JSON.parse(JSON.stringify(tabStorage.get(key)));
            }
          }
          return result;
        }),
        set: jest.fn(async items => {
          for (const [key, value] of Object.entries(items)) {
            tabStorage.set(key, JSON.parse(JSON.stringify(value)));
            state.globalStorage.set(key, JSON.parse(JSON.stringify(value)));
          }
        }),
        remove: jest.fn(async keys => {
          const keysArray = Array.isArray(keys) ? keys : [keys];
          for (const key of keysArray) {
            tabStorage.delete(key);
          }
        }),
        clear: jest.fn(async () => {
          tabStorage.clear();
        })
      },

      // Mock DOM
      document: {
        hidden: false,
        visibilityState: 'visible',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      },

      // Internal
      _storage: tabStorage
    };

    state.tabs.set(tabId, tab);
    return tab;
  }

  /**
   * Get storage for a specific tab
   * @param {number} tabId - Tab ID
   * @returns {Object|null} Tab storage or null
   */
  function getTabStorage(tabId) {
    const tab = state.tabs.get(tabId);
    return tab ? tab.storage : null;
  }

  /**
   * Simulate navigation to a new domain
   * @param {number} tabId - Tab ID
   * @param {string} newDomain - New domain
   * @returns {boolean} True if successful
   */
  function simulateNavigation(tabId, newDomain) {
    const tab = state.tabs.get(tabId);
    if (!tab) return false;

    tab.domain = newDomain;
    tab.url = `https://${newDomain}/`;

    // Trigger any navigation listeners
    state.messageHistory.push({
      type: 'navigation',
      tabId,
      newDomain,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Simulate tab close
   * @param {number} tabId - Tab ID
   * @returns {boolean} True if closed
   */
  function closeTab(tabId) {
    const tab = state.tabs.get(tabId);
    if (!tab) return false;

    state.closedTabs.push({
      ...tab,
      closedAt: Date.now()
    });

    state.tabs.delete(tabId);

    state.messageHistory.push({
      type: 'close',
      tabId,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Send a port message between tabs
   * @param {number} fromTab - Source tab ID
   * @param {number} toTab - Target tab ID
   * @param {Object} message - Message to send
   * @returns {boolean} True if delivered
   */
  function sendPortMessage(fromTab, toTab, message) {
    const from = state.tabs.get(fromTab);
    const to = state.tabs.get(toTab);

    if (!from || !to) return false;

    const entry = {
      type: 'port_message',
      fromTab,
      toTab,
      message: JSON.parse(JSON.stringify(message)),
      timestamp: Date.now()
    };

    state.messageHistory.push(entry);
    return true;
  }

  /**
   * Get global storage (all tabs combined)
   * @returns {Object} Global storage contents
   */
  function getGlobalStorage() {
    return Object.fromEntries(state.globalStorage);
  }

  /**
   * Check if a Quick Tab belongs to a specific tab
   * @private
   * @param {Object} qt - Quick Tab
   * @param {number} tabId - Tab ID
   * @returns {boolean} True if it belongs to a different tab
   */
  function isQuickTabFromDifferentTab(qt, tabId) {
    return qt.originTabId && qt.originTabId !== tabId;
  }

  /**
   * Verify tab isolation (each tab only sees its own data)
   * @returns {{ isolated: boolean, violations: Array }}
   */
  function verifyIsolation() {
    const violations = [];

    // Check that each tab's quick tabs only belong to that tab
    for (const [tabId, tab] of state.tabs) {
      const quickTabState = tab._storage.get('quick_tabs_state_v2');
      if (!quickTabState || !quickTabState.tabs) continue;

      const tabViolations = quickTabState.tabs
        .filter(qt => isQuickTabFromDifferentTab(qt, tabId))
        .map(qt => ({
          tabId,
          quickTabId: qt.id,
          expectedOriginTabId: tabId,
          actualOriginTabId: qt.originTabId
        }));

      violations.push(...tabViolations);
    }

    return {
      isolated: violations.length === 0,
      violations
    };
  }

  /**
   * Get message history
   * @returns {Array} Message history
   */
  function getMessageHistory() {
    return [...state.messageHistory];
  }

  /**
   * Get all tabs
   * @returns {Map} All tabs
   */
  function getAllTabs() {
    return new Map(state.tabs);
  }

  /**
   * Get closed tabs
   * @returns {Array} Closed tabs
   */
  function getClosedTabs() {
    return [...state.closedTabs];
  }

  /**
   * Reset simulator state
   */
  function reset() {
    state.tabs.clear();
    state.globalStorage.clear();
    state.messageHistory.length = 0;
    state.closedTabs.length = 0;
  }

  /**
   * Sync storage change to all tabs
   * @param {string} key - Storage key
   * @param {*} value - New value
   */
  function syncStorageChange(key, value) {
    state.globalStorage.set(key, JSON.parse(JSON.stringify(value)));

    for (const tab of state.tabs.values()) {
      tab._storage.set(key, JSON.parse(JSON.stringify(value)));
    }

    state.messageHistory.push({
      type: 'storage_sync',
      key,
      timestamp: Date.now()
    });
  }

  return {
    createTab,
    getTabStorage,
    simulateNavigation,
    closeTab,
    sendPortMessage,
    getGlobalStorage,
    verifyIsolation,
    getMessageHistory,
    getAllTabs,
    getClosedTabs,
    reset,
    syncStorageChange,
    _state: state
  };
}
