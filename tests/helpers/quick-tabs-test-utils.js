/**
 * Quick Tabs Test Utilities
 *
 * Common utilities for testing Quick Tab behaviors
 *
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 8.3)
 */

/**
 * Waits for a specific broadcast message
 * @param {Object} broadcastChannel - Mock broadcast channel
 * @param {string} expectedAction - Expected action type
 * @param {number} timeout - Timeout in ms (default: 500)
 * @returns {Promise<Object>} The broadcast message
 */
export async function waitForBroadcast(broadcastChannel, expectedAction, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for broadcast action: ${expectedAction}`));
    }, timeout);

    const listener = event => {
      if (event.data && event.data.action === expectedAction) {
        clearTimeout(timeoutId);
        broadcastChannel.removeEventListener('message', listener);
        resolve(event.data);
      }
    };

    broadcastChannel.addEventListener('message', listener);
  });
}

/**
 * Waits for storage operation to complete
 * @param {Object} storageAPI - Mock storage API
 * @param {string} key - Storage key to watch
 * @param {number} timeout - Timeout in ms (default: 500)
 * @returns {Promise<*>} The stored value
 */
export async function waitForStorageSave(storageAPI, key, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for storage save: ${key}`));
    }, timeout);

    const checkStorage = async () => {
      const result = await storageAPI.sync.get(key);
      if (result[key] !== undefined) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(result[key]);
      }
    };

    const intervalId = setInterval(checkStorage, 50);
    checkStorage(); // Check immediately
  });
}

/**
 * Deep equality check for Quick Tab state
 * @param {Object} qt - Quick Tab object
 * @param {Object} expectedState - Expected state
 * @throws {Error} If state doesn't match
 */
export function assertQuickTabState(qt, expectedState) {
  const errors = [];

  // Check position
  if (expectedState.position) {
    if (qt.position.left !== expectedState.position.left) {
      errors.push(
        `position.left: expected ${expectedState.position.left}, got ${qt.position.left}`
      );
    }
    if (qt.position.top !== expectedState.position.top) {
      errors.push(`position.top: expected ${expectedState.position.top}, got ${qt.position.top}`);
    }
  }

  // Check size
  if (expectedState.size) {
    if (qt.size.width !== expectedState.size.width) {
      errors.push(`size.width: expected ${expectedState.size.width}, got ${qt.size.width}`);
    }
    if (qt.size.height !== expectedState.size.height) {
      errors.push(`size.height: expected ${expectedState.size.height}, got ${qt.size.height}`);
    }
  }

  // Check solo state
  if (Object.hasOwn(expectedState, 'soloTabId')) {
    if (qt.soloTabId !== expectedState.soloTabId) {
      errors.push(`soloTabId: expected ${expectedState.soloTabId}, got ${qt.soloTabId}`);
    }
  }

  // Check mute state
  if (Object.hasOwn(expectedState, 'mutedTabs')) {
    const expectedMuted = JSON.stringify(expectedState.mutedTabs || []);
    const actualMuted = JSON.stringify(qt.mutedTabs || []);
    if (expectedMuted !== actualMuted) {
      errors.push(`mutedTabs: expected ${expectedMuted}, got ${actualMuted}`);
    }
  }

  // Check minimized state
  if (Object.hasOwn(expectedState, 'isMinimized')) {
    if (qt.isMinimized !== expectedState.isMinimized) {
      errors.push(`isMinimized: expected ${expectedState.isMinimized}, got ${qt.isMinimized}`);
    }
  }

  // Check z-index
  if (Object.hasOwn(expectedState, 'zIndex')) {
    if (qt.zIndex !== expectedState.zIndex) {
      errors.push(`zIndex: expected ${expectedState.zIndex}, got ${qt.zIndex}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Quick Tab state assertion failed:\n${errors.join('\n')}`);
  }
}

/**
 * Factory for creating Quick Tab test instances with defaults
 * @param {Object} overrides - Properties to override defaults
 * @returns {Object} Quick Tab-like object
 */
export function createQuickTabWithDefaults(overrides = {}) {
  return {
    id: overrides.id || `qt-${Date.now()}`,
    url: overrides.url || 'https://example.com',
    position: {
      left: overrides.position?.left ?? 100,
      top: overrides.position?.top ?? 100
    },
    size: {
      width: overrides.size?.width ?? 800,
      height: overrides.size?.height ?? 600
    },
    zIndex: overrides.zIndex ?? 100000,
    isMinimized: overrides.isMinimized ?? false,
    soloTabId: overrides.soloTabId ?? null,
    mutedTabs: overrides.mutedTabs ?? [],
    cookieStoreId: overrides.cookieStoreId || 'firefox-default',
    createdAt: overrides.createdAt || Date.now(),
    ...overrides
  };
}

/**
 * Simulates rapid position/size updates
 * @param {Function} updateFn - Update function to call
 * @param {Array<Object>} updates - Array of update objects
 * @param {number} interval - Interval between updates in ms (default: 10)
 * @returns {Promise<void>}
 */
export async function simulateRapidUpdates(updateFn, updates, interval = 10) {
  for (const update of updates) {
    updateFn(update);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Waits for specific number of broadcast messages
 * @param {Object} broadcastChannel - Mock broadcast channel
 * @param {number} count - Expected message count
 * @param {number} timeout - Timeout in ms (default: 1000)
 * @returns {Promise<Array<Object>>} Array of messages
 */
export async function waitForBroadcastCount(broadcastChannel, count, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: expected ${count} broadcasts, got ${messages.length}`));
    }, timeout);

    const listener = event => {
      messages.push(event.data);
      if (messages.length >= count) {
        clearTimeout(timeoutId);
        broadcastChannel.removeEventListener('message', listener);
        resolve(messages);
      }
    };

    broadcastChannel.addEventListener('message', listener);
  });
}

/**
 * Flushes all pending promises
 * @returns {Promise<void>}
 */
export async function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Waits for specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock Quick Tab window element
 * @param {Object} qt - Quick Tab data
 * @returns {Object} Mock DOM element
 */
export function createMockQuickTabElement(qt) {
  return {
    id: qt.id,
    style: {
      left: `${qt.position.left}px`,
      top: `${qt.position.top}px`,
      width: `${qt.size.width}px`,
      height: `${qt.size.height}px`,
      zIndex: qt.zIndex.toString(),
      display: qt.isMinimized ? 'none' : 'block'
    },
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn()
    },
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    remove: jest.fn(),
    getBoundingClientRect: jest.fn(() => ({
      left: qt.position.left,
      top: qt.position.top,
      width: qt.size.width,
      height: qt.size.height,
      right: qt.position.left + qt.size.width,
      bottom: qt.position.top + qt.size.height
    }))
  };
}

/**
 * Verifies container isolation (QT only visible in correct container)
 * @param {Object} qt - Quick Tab object
 * @param {string} expectedContainer - Expected container ID
 * @param {Array<Object>} tabs - All simulated tabs
 */
export function assertContainerIsolation(qt, expectedContainer, tabs) {
  tabs.forEach(tab => {
    const shouldBeVisible = tab.containerId === expectedContainer;
    const message = shouldBeVisible
      ? `QT should be visible in container ${tab.containerId}`
      : `QT should NOT be visible in container ${tab.containerId}`;

    // This would be checked by actual rendering logic
    // For tests, we verify the cookieStoreId matches
    if (shouldBeVisible && qt.cookieStoreId !== tab.containerId) {
      throw new Error(
        `${message} (cookieStoreId mismatch: ${qt.cookieStoreId} !== ${tab.containerId})`
      );
    }
  });
}
