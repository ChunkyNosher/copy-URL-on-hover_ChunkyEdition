/**
 * Storage Test Helper
 * Provides utilities for validating storage operations and consistency
 *
 * v1.6.4 - New test helper for comprehensive Jest testing infrastructure
 *
 * Features:
 * - Mock browser.storage with full tracking
 * - Validate storage key formats
 * - Check originTabId filtering
 * - Verify checksum validation
 * - Simulate quota constraints
 *
 * @module tests/helpers/storage-test-helper
 */

/**
 * Default storage key patterns
 */
const KEY_PATTERNS = {
  QUICK_TABS_STATE: /^quick_tabs_state_v\d+$/,
  SESSION_STATE: /^session_quick_tabs$/,
  QUICK_TAB_GROUPS: /^quickTabGroups$/
};

/**
 * Simple djb2-like hash function for checksum calculation
 * @param {string} str - String to hash
 * @returns {string} Hash string
 */
function calculateChecksum(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Creates a storage test helper for validating storage operations
 * @returns {Object} Storage test helper instance
 */
export function createStorageTestHelper() {
  const state = {
    localStorage: new Map(),
    syncStorage: new Map(),
    sessionStorage: new Map(),
    changeHistory: [],
    quotaLimit: 5 * 1024 * 1024, // 5MB default
    quotaExceeded: false,
    listeners: []
  };

  /**
   * Rollback storage changes
   * @param {Map} storage - Storage map
   * @param {Object} changes - Changes to rollback
   */
  function rollbackChanges(storage, changes) {
    for (const [key, change] of Object.entries(changes)) {
      if (change.oldValue !== undefined) {
        storage.set(key, change.oldValue);
      } else {
        storage.delete(key);
      }
    }
  }

  /**
   * Create a mock storage API (local, sync, or session)
   * @param {Map} storage - Storage Map to use
   * @param {string} type - Storage type identifier
   * @returns {Object} Mock storage API
   */
  function createMockStorageAPI(storage, type) {
    return {
      get: jest.fn(async keys => {
        if (state.quotaExceeded) {
          throw new Error('QUOTA_BYTES quota exceeded');
        }

        const result = {};
        if (keys === null || keys === undefined) {
          // Get all
          storage.forEach((value, key) => {
            result[key] = JSON.parse(JSON.stringify(value));
          });
        } else if (typeof keys === 'string') {
          if (storage.has(keys)) {
            result[keys] = JSON.parse(JSON.stringify(storage.get(keys)));
          }
        } else if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (storage.has(key)) {
              result[key] = JSON.parse(JSON.stringify(storage.get(key)));
            }
          });
        } else if (typeof keys === 'object') {
          // Keys with defaults
          for (const [key, defaultValue] of Object.entries(keys)) {
            result[key] = storage.has(key)
              ? JSON.parse(JSON.stringify(storage.get(key)))
              : defaultValue;
          }
        }

        state.changeHistory.push({
          type: 'read',
          storage: type,
          keys: keys,
          timestamp: Date.now()
        });

        return result;
      }),

      set: jest.fn(async items => {
        if (state.quotaExceeded) {
          throw new Error('QUOTA_BYTES quota exceeded');
        }

        const changes = {};

        for (const [key, value] of Object.entries(items)) {
          const oldValue = storage.get(key);
          const newValue = JSON.parse(JSON.stringify(value));
          storage.set(key, newValue);

          changes[key] = {
            oldValue,
            newValue
          };
        }

        const newSize = calculateStorageSize(storage);
        if (newSize > state.quotaLimit) {
          // Rollback
          rollbackChanges(storage, changes);
          throw new Error('QUOTA_BYTES quota exceeded');
        }

        state.changeHistory.push({
          type: 'write',
          storage: type,
          keys: Object.keys(items),
          changes,
          timestamp: Date.now()
        });

        // Notify listeners
        notifyListeners(changes, type);
      }),

      remove: jest.fn(async keys => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        const changes = {};

        for (const key of keysArray) {
          if (storage.has(key)) {
            changes[key] = { oldValue: storage.get(key) };
            storage.delete(key);
          }
        }

        state.changeHistory.push({
          type: 'remove',
          storage: type,
          keys: keysArray,
          changes,
          timestamp: Date.now()
        });

        notifyListeners(changes, type);
      }),

      clear: jest.fn(async () => {
        const changes = {};
        storage.forEach((value, key) => {
          changes[key] = { oldValue: value };
        });

        storage.clear();

        state.changeHistory.push({
          type: 'clear',
          storage: type,
          changes,
          timestamp: Date.now()
        });

        notifyListeners(changes, type);
      }),

      getBytesInUse: jest.fn(async keys => {
        if (keys === null || keys === undefined) {
          return calculateStorageSize(storage);
        }
        const keysArray = Array.isArray(keys) ? keys : [keys];
        let size = 0;
        for (const key of keysArray) {
          if (storage.has(key)) {
            size += JSON.stringify(storage.get(key)).length;
          }
        }
        return size;
      })
    };
  }

  /**
   * Calculate storage size in bytes
   * @param {Map} storage - Storage Map
   * @returns {number} Size in bytes
   */
  function calculateStorageSize(storage) {
    let size = 0;
    storage.forEach((value, key) => {
      size += key.length + JSON.stringify(value).length;
    });
    return size;
  }

  /**
   * Notify storage change listeners
   * @param {Object} changes - Changes object
   * @param {string} areaName - Storage area name
   */
  function notifyListeners(changes, areaName) {
    if (Object.keys(changes).length === 0) return;
    state.listeners.forEach(listener => {
      try {
        listener(changes, areaName);
      } catch {
        // Ignore listener errors
      }
    });
  }

  // Create mock storage APIs
  const mockLocalStorage = createMockStorageAPI(state.localStorage, 'local');
  const mockSyncStorage = createMockStorageAPI(state.syncStorage, 'sync');
  const mockSessionStorage = createMockStorageAPI(state.sessionStorage, 'session');

  /**
   * Get current storage snapshot
   * @returns {Object} Storage snapshot
   */
  function getSnapshot() {
    return {
      local: Object.fromEntries(state.localStorage),
      sync: Object.fromEntries(state.syncStorage),
      session: Object.fromEntries(state.sessionStorage),
      timestamp: Date.now()
    };
  }

  /**
   * Get Quick Tabs for a specific origin tab ID
   * @param {number} tabId - Origin tab ID
   * @returns {Array} Quick Tabs for this tab
   */
  function getByOriginTabId(tabId) {
    const results = [];

    // Check local storage for quick_tabs_state_v2
    const localState = state.localStorage.get('quick_tabs_state_v2');
    if (localState && localState.tabs) {
      results.push(
        ...localState.tabs.filter(qt => qt.originTabId === tabId)
      );
    }

    // Check session storage
    const sessionState = state.sessionStorage.get('session_quick_tabs');
    if (sessionState && sessionState.tabs) {
      results.push(
        ...sessionState.tabs.filter(qt => qt.originTabId === tabId)
      );
    }

    return results;
  }

  /**
   * Verify key format matches expected pattern
   * @param {string} key - Storage key to verify
   * @returns {{ valid: boolean, matchedPattern: string|null, error: string|null }}
   */
  function verifyKeyFormat(key) {
    for (const [patternName, pattern] of Object.entries(KEY_PATTERNS)) {
      if (pattern.test(key)) {
        return { valid: true, matchedPattern: patternName, error: null };
      }
    }
    return {
      valid: false,
      matchedPattern: null,
      error: `Key '${key}' does not match any expected pattern`
    };
  }

  /**
   * Verify checksum for storage data
   * @param {string} key - Storage key
   * @param {Object} data - Data to verify
   * @returns {{ valid: boolean, expected: string, actual: string|null }}
   */
  function verifyChecksum(key, data) {
    if (!data || !data.checksum) {
      return { valid: false, expected: 'present', actual: null };
    }

    // Calculate checksum from data (excluding checksum field)
    const dataWithoutChecksum = { ...data };
    delete dataWithoutChecksum.checksum;
    const expected = calculateChecksum(JSON.stringify(dataWithoutChecksum));

    return {
      valid: data.checksum === expected,
      expected,
      actual: data.checksum
    };
  }

  /**
   * Simulate quota exceeded condition
   */
  function simulateQuotaExceeded() {
    state.quotaExceeded = true;
  }

  /**
   * Clear quota exceeded condition
   */
  function clearQuotaExceeded() {
    state.quotaExceeded = false;
  }

  /**
   * Set quota limit
   * @param {number} bytes - Quota limit in bytes
   */
  function setQuotaLimit(bytes) {
    state.quotaLimit = bytes;
  }

  /**
   * Validate local storage state format
   * @param {Object} localState - Local storage state
   * @returns {string[]} Validation errors
   */
  function validateLocalStateFormat(localState) {
    const errors = [];
    if (!localState) return errors;

    if (!Array.isArray(localState.tabs)) {
      errors.push('local:quick_tabs_state_v2.tabs is not an array');
    }
    if (typeof localState.saveId !== 'string') {
      errors.push('local:quick_tabs_state_v2.saveId is not a string');
    }
    if (typeof localState.timestamp !== 'number') {
      errors.push('local:quick_tabs_state_v2.timestamp is not a number');
    }

    // Check for duplicate IDs
    if (localState.tabs) {
      const ids = localState.tabs.map(qt => qt.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      if (duplicates.length > 0) {
        errors.push(`Duplicate Quick Tab IDs found: ${duplicates.join(', ')}`);
      }
    }
    return errors;
  }

  /**
   * Assert storage consistency
   * Validates all constraints are met
   * @returns {{ consistent: boolean, errors: string[] }}
   */
  function assertConsistency() {
    const errors = [];

    // Check local storage state format
    const localState = state.localStorage.get('quick_tabs_state_v2');
    errors.push(...validateLocalStateFormat(localState));

    // Check session storage state format
    const sessionState = state.sessionStorage.get('session_quick_tabs');
    if (sessionState && !Array.isArray(sessionState.tabs)) {
      errors.push('session:session_quick_tabs.tabs is not an array');
    }

    return {
      consistent: errors.length === 0,
      errors
    };
  }

  /**
   * Get storage change history
   * @returns {Array} Array of change entries
   */
  function getChangeHistory() {
    return [...state.changeHistory];
  }

  /**
   * Get changes filtered by storage type
   * @param {string} storageType - Storage type ('local', 'sync', 'session')
   * @returns {Array} Filtered changes
   */
  function getChangesByType(storageType) {
    return state.changeHistory.filter(change => change.storage === storageType);
  }

  /**
   * Clear change history
   */
  function clearChangeHistory() {
    state.changeHistory.length = 0;
  }

  /**
   * Add storage change listener
   * @param {Function} listener - Listener function (changes, areaName) => void
   */
  function addChangeListener(listener) {
    state.listeners.push(listener);
  }

  /**
   * Remove storage change listener
   * @param {Function} listener - Listener to remove
   */
  function removeChangeListener(listener) {
    const index = state.listeners.indexOf(listener);
    if (index !== -1) {
      state.listeners.splice(index, 1);
    }
  }

  /**
   * Seed storage with test data
   * @param {string} storageType - Storage type
   * @param {Object} data - Data to seed
   */
  function seedStorage(storageType, data) {
    const storage =
      storageType === 'local' ? state.localStorage :
      storageType === 'sync' ? state.syncStorage :
      state.sessionStorage;

    for (const [key, value] of Object.entries(data)) {
      storage.set(key, JSON.parse(JSON.stringify(value)));
    }
  }

  /**
   * Reset all storage and state
   */
  function reset() {
    state.localStorage.clear();
    state.syncStorage.clear();
    state.sessionStorage.clear();
    state.changeHistory.length = 0;
    state.quotaExceeded = false;
    state.quotaLimit = 5 * 1024 * 1024;
    state.listeners.length = 0;

    // Reset mock call counts
    mockLocalStorage.get.mockClear();
    mockLocalStorage.set.mockClear();
    mockLocalStorage.remove.mockClear();
    mockLocalStorage.clear.mockClear();
    mockSyncStorage.get.mockClear();
    mockSyncStorage.set.mockClear();
    mockSyncStorage.remove.mockClear();
    mockSyncStorage.clear.mockClear();
    mockSessionStorage.get.mockClear();
    mockSessionStorage.set.mockClear();
    mockSessionStorage.remove.mockClear();
    mockSessionStorage.clear.mockClear();
  }

  /**
   * Get statistics about storage
   * @returns {Object} Statistics object
   */
  function getStats() {
    return {
      localSize: calculateStorageSize(state.localStorage),
      syncSize: calculateStorageSize(state.syncStorage),
      sessionSize: calculateStorageSize(state.sessionStorage),
      localKeyCount: state.localStorage.size,
      syncKeyCount: state.syncStorage.size,
      sessionKeyCount: state.sessionStorage.size,
      changeCount: state.changeHistory.length,
      quotaLimit: state.quotaLimit,
      quotaExceeded: state.quotaExceeded
    };
  }

  return {
    // Mock storage APIs
    local: mockLocalStorage,
    sync: mockSyncStorage,
    session: mockSessionStorage,

    // Helper methods
    getSnapshot,
    getByOriginTabId,
    verifyKeyFormat,
    verifyChecksum,
    simulateQuotaExceeded,
    clearQuotaExceeded,
    setQuotaLimit,
    assertConsistency,
    getChangeHistory,
    getChangesByType,
    clearChangeHistory,
    addChangeListener,
    removeChangeListener,
    seedStorage,
    reset,
    getStats,

    // Expose state for advanced testing
    _state: state,

    // Storage change listener (for browser.storage.onChanged mock)
    onChanged: {
      addListener: jest.fn(listener => addChangeListener(listener)),
      removeListener: jest.fn(listener => removeChangeListener(listener)),
      hasListener: jest.fn(listener => state.listeners.includes(listener))
    }
  };
}

/**
 * Create a complete browser.storage mock
 * @returns {Object} Mock browser.storage object
 */
export function createMockBrowserStorage() {
  const helper = createStorageTestHelper();

  return {
    local: helper.local,
    sync: helper.sync,
    session: helper.session,
    onChanged: helper.onChanged,
    _helper: helper
  };
}

/**
 * Generate test Quick Tab data with checksum
 * @param {Object} overrides - Property overrides
 * @returns {Object} Quick Tab state with checksum
 */
export function generateTestQuickTabState(overrides = {}) {
  const tabs = overrides.tabs || [];
  const state = {
    tabs,
    saveId: overrides.saveId || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: overrides.timestamp || Date.now(),
    writingTabId: overrides.writingTabId || null,
    revisionId: overrides.revisionId || 1
  };

  // Calculate checksum from state without checksum field
  // This ensures verifyChecksum will pass when excluding the checksum
  state.checksum = calculateChecksum(JSON.stringify(state));

  return state;
}
