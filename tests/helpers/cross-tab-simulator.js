/**
 * Cross-Tab Simulation Framework
 * 
 * Provides utilities for simulating multiple browser tabs in unit tests
 * to validate cross-tab synchronization behaviors.
 * 
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 7.2)
 * - docs/issue-47-revised-scenarios.md
 */

import { JSDOM } from 'jsdom';

/**
 * Creates a simulated browser tab context with isolated storage and broadcast channel
 * @param {string} url - URL for the simulated tab
 * @param {string} containerId - Firefox container ID (default: 'firefox-default')
 * @returns {Promise<Object>} Simulated tab context
 */
export async function createSimulatedTab(url, containerId = 'firefox-default') {
  // Generate unique tab ID
  const tabId = Math.floor(Math.random() * 1000000);

  // Create isolated JSDOM instance for this tab
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url,
    runScripts: 'dangerously',
    resources: 'usable'
  });

  // Create isolated storage mock
  const storage = new Map();
  const storageAPI = {
    sync: {
      get: jest.fn(async (keys) => {
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
      set: jest.fn(async (items) => {
        Object.entries(items).forEach(([key, value]) => {
          storage.set(key, value);
        });
      }),
      remove: jest.fn(async (keys) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => storage.delete(key));
      }),
      clear: jest.fn(async () => {
        storage.clear();
      })
    },
    local: {
      get: jest.fn(async (keys) => {
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
      set: jest.fn(async (items) => {
        Object.entries(items).forEach(([key, value]) => {
          storage.set(key, value);
        });
      }),
      remove: jest.fn(async (keys) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => storage.delete(key));
      }),
      clear: jest.fn(async () => {
        storage.clear();
      })
    }
  };

  // Create isolated broadcast channel mock
  const broadcastListeners = [];
  const broadcastChannel = {
    postMessage: jest.fn((message) => {
      // Simulate async delivery with small delay
      setTimeout(() => {
        broadcastListeners.forEach(listener => listener({ data: message }));
      }, 10);
    }),
    addEventListener: jest.fn((event, listener) => {
      if (event === 'message') {
        broadcastListeners.push(listener);
      }
    }),
    removeEventListener: jest.fn((event, listener) => {
      const index = broadcastListeners.indexOf(listener);
      if (index > -1) {
        broadcastListeners.splice(index, 1);
      }
    }),
    close: jest.fn()
  };

  // Mock browser.tabs API
  const tabsAPI = {
    query: jest.fn(async (query) => {
      if (query.active && query.currentWindow) {
        return [{
          id: tabId,
          url,
          cookieStoreId: containerId,
          active: true
        }];
      }
      return [];
    }),
    get: jest.fn(async (id) => {
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
    dom,
    window: dom.window,
    document: dom.window.document,
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
    const event = new fromTab.window.Event('visibilitychange');
    Object.defineProperty(fromTab.document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(fromTab.document, 'visibilityState', { value: 'hidden', configurable: true });
    fromTab.document.dispatchEvent(event);
  }

  if (toTab) {
    // Trigger focus events on new tab
    const visibilityEvent = new toTab.window.Event('visibilitychange');
    const focusEvent = new toTab.window.Event('focus');
    Object.defineProperty(toTab.document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(toTab.document, 'visibilityState', { value: 'visible', configurable: true });
    toTab.document.dispatchEvent(visibilityEvent);
    toTab.window.dispatchEvent(focusEvent);
  }

  // Allow event handlers to process
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Simulates broadcast message propagation between tabs
 * @param {Object} sourceTab - Tab sending the message
 * @param {Object} message - Message to broadcast
 * @param {Array<Object>} targetTabs - Tabs to receive the message
 * @param {number} delay - Delivery delay in ms (default: 10)
 */
export async function propagateBroadcast(sourceTab, message, targetTabs, delay = 10) {
  // Send from source
  sourceTab.broadcastChannel.postMessage(message);

  // Deliver to targets after delay
  await new Promise(resolve => setTimeout(resolve, delay));

  targetTabs.forEach(targetTab => {
    // Skip source tab (same-tab delivery depends on BroadcastChannel implementation)
    if (targetTab.tabId === sourceTab.tabId) return;

    // Respect container boundaries
    if (targetTab.containerId !== sourceTab.containerId) return;

    // Trigger listeners
    targetTab._broadcastListeners.forEach(listener => {
      listener({ data: message });
    });
  });

  // Allow listeners to process
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Creates multi-tab test scenario
 * @param {Array<Object>} configs - Array of {url, containerId} objects
 * @returns {Promise<Array<Object>>} Array of simulated tab contexts
 */
export async function createMultiTabScenario(configs) {
  const tabs = [];
  
  for (const config of configs) {
    const tab = await createSimulatedTab(config.url, config.containerId);
    tabs.push(tab);
  }

  // Setup broadcast channel connections between tabs in same container
  tabs.forEach((sourceTab, sourceIndex) => {
    sourceTab.broadcastChannel.postMessage = jest.fn((message) => {
      setTimeout(() => {
        tabs.forEach((targetTab, targetIndex) => {
          // Skip self and different containers
          if (sourceIndex === targetIndex) return;
          if (targetTab.containerId !== sourceTab.containerId) return;

          // Deliver message
          targetTab._broadcastListeners.forEach(listener => {
            listener({ data: message });
          });
        });
      }, 10);
    });
  });

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
