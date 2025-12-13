/**
 * Manager Mock Factory
 * Provides factory functions for creating mock managers for testing
 *
 * v1.6.4 - New test helper for comprehensive Jest testing infrastructure
 *
 * Each factory creates a Jest mock with:
 * - All methods mocked by default
 * - Method call tracking setup
 * - State getter/setter helpers
 * - Override support via parameter
 *
 * @module tests/helpers/manager-factory
 */

/**
 * Creates a mock MemoryMonitor with all methods mocked
 * @param {Object} overrides - Method overrides
 * @returns {Object} Mock MemoryMonitor instance
 */
export function createMockMemoryMonitor(overrides = {}) {
  const state = {
    memoryUsage: 0,
    threshold: 0.9,
    isWarning: false,
    isCritical: false
  };

  const mock = {
    // State getters
    getMemoryUsage: jest.fn(() => state.memoryUsage),
    getThreshold: jest.fn(() => state.threshold),
    isWarning: jest.fn(() => state.isWarning),
    isCritical: jest.fn(() => state.isCritical),

    // Core methods
    checkMemory: jest.fn(() => ({
      usage: state.memoryUsage,
      warning: state.isWarning,
      critical: state.isCritical
    })),
    setThreshold: jest.fn(value => {
      state.threshold = value;
    }),
    triggerCleanup: jest.fn(() => Promise.resolve(true)),
    reset: jest.fn(() => {
      state.memoryUsage = 0;
      state.isWarning = false;
      state.isCritical = false;
    }),

    // Event emitters
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),

    // State helpers for tests
    _state: state,
    _setMemoryUsage: value => {
      state.memoryUsage = value;
      state.isWarning = value >= state.threshold * 0.75;
      state.isCritical = value >= state.threshold;
    },
    _reset: () => {
      jest.clearAllMocks();
      state.memoryUsage = 0;
      state.threshold = 0.9;
      state.isWarning = false;
      state.isCritical = false;
    },

    // Apply overrides
    ...overrides
  };

  return mock;
}

/**
 * Creates a mock PerformanceMetrics with all methods mocked
 * @param {Object} overrides - Method overrides
 * @returns {Object} Mock PerformanceMetrics instance
 */
export function createMockPerformanceMetrics(overrides = {}) {
  const state = {
    metrics: new Map(),
    timers: new Map(),
    history: []
  };

  const mock = {
    // Timer methods
    startTimer: jest.fn(name => {
      state.timers.set(name, Date.now());
      return name;
    }),
    endTimer: jest.fn(name => {
      const start = state.timers.get(name);
      if (start) {
        const duration = Date.now() - start;
        state.timers.delete(name);
        state.history.push({ name, duration, timestamp: Date.now() });
        return duration;
      }
      return null;
    }),

    // Metric recording
    recordMetric: jest.fn((name, value) => {
      const metrics = state.metrics.get(name) || [];
      metrics.push({ value, timestamp: Date.now() });
      state.metrics.set(name, metrics);
    }),
    getMetric: jest.fn(name => state.metrics.get(name) || []),
    getAllMetrics: jest.fn(() => Object.fromEntries(state.metrics)),

    // Statistics
    getAverageTime: jest.fn(name => {
      const metrics = state.metrics.get(name);
      if (!metrics || metrics.length === 0) return 0;
      const sum = metrics.reduce((acc, m) => acc + m.value, 0);
      return sum / metrics.length;
    }),
    getStats: jest.fn(() => ({
      totalMetrics: state.metrics.size,
      activeTimers: state.timers.size,
      historyLength: state.history.length
    })),

    // Reset
    reset: jest.fn(() => {
      state.metrics.clear();
      state.timers.clear();
      state.history.length = 0;
    }),

    // State helpers for tests
    _state: state,
    _reset: () => {
      jest.clearAllMocks();
      state.metrics.clear();
      state.timers.clear();
      state.history.length = 0;
    },

    // Apply overrides
    ...overrides
  };

  return mock;
}

/**
 * Creates a mock QuickTabGroupManager with all methods mocked
 * @param {Object} overrides - Method overrides
 * @returns {Object} Mock QuickTabGroupManager instance
 */
export function createMockQuickTabGroupManager(overrides = {}) {
  const state = {
    groups: new Map(),
    tabsGroupAvailable: true
  };

  const mock = {
    // API availability check
    isTabsGroupAvailable: jest.fn(() => state.tabsGroupAvailable),

    // Group operations
    createGroup: jest.fn(async (groupName, tabIds) => {
      if (!state.tabsGroupAvailable) return null;
      if (!tabIds || tabIds.length === 0) return null;

      const groupId = Date.now();
      const metadata = {
        groupId,
        name: groupName || `Group ${groupId}`,
        tabIds: [...tabIds],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      state.groups.set(groupId, metadata);
      return metadata;
    }),

    addToGroup: jest.fn(async (groupId, tabId) => {
      if (!state.tabsGroupAvailable) return false;
      const group = state.groups.get(groupId);
      if (group && !group.tabIds.includes(tabId)) {
        group.tabIds.push(tabId);
        group.updatedAt = Date.now();
        return true;
      }
      return false;
    }),

    removeFromGroup: jest.fn(async tabId => {
      if (!state.tabsGroupAvailable) return false;
      for (const group of state.groups.values()) {
        const index = group.tabIds.indexOf(tabId);
        if (index !== -1) {
          group.tabIds.splice(index, 1);
          group.updatedAt = Date.now();
          return true;
        }
      }
      return false;
    }),

    getGroupMembers: jest.fn(async groupId => {
      const group = state.groups.get(groupId);
      return group ? [...group.tabIds] : [];
    }),

    getAllGroups: jest.fn(async () => Array.from(state.groups.values())),

    deleteGroup: jest.fn(async groupId => {
      return state.groups.delete(groupId);
    }),

    // State helpers for tests
    _state: state,
    _setTabsGroupAvailable: value => {
      state.tabsGroupAvailable = value;
    },
    _reset: () => {
      jest.clearAllMocks();
      state.groups.clear();
      state.tabsGroupAvailable = true;
    },

    // Apply overrides
    ...overrides
  };

  return mock;
}

/**
 * Creates a mock MapTransactionManager with all methods mocked
 * @param {Object} overrides - Method overrides
 * @returns {Object} Mock MapTransactionManager instance
 */
export function createMockTransactionManager(overrides = {}) {
  const state = {
    map: new Map(),
    activeTransaction: null,
    stagedOperations: [],
    transactionCounter: 0,
    locked: false,
    rollbackCallbacks: []
  };

  /**
   * Helper to rollback all callbacks
   * @param {Array} callbacks - Rollback callbacks
   * @returns {Promise<number>} Number of steps rolled back
   */
  async function rollbackAllCallbacks(callbacks) {
    let stepsRolledBack = 0;
    while (callbacks.length > 0) {
      const { rollbackFn, snapshot } = callbacks.pop();
      try {
        await rollbackFn(snapshot);
        stepsRolledBack++;
      } catch {
        // Continue rolling back
      }
    }
    return stepsRolledBack;
  }

  const mock = {
    // Map accessors
    getMapKeys: jest.fn(() => Array.from(state.map.keys())),
    getMapSize: jest.fn(() => state.map.size),
    has: jest.fn(id => state.map.has(id)),
    get: jest.fn(id => state.map.get(id)),

    // Transaction methods
    beginTransaction: jest.fn(reason => {
      if (state.activeTransaction || state.locked) return false;
      state.transactionCounter++;
      state.activeTransaction = {
        id: `txn-${state.transactionCounter}`,
        entries: new Map(state.map),
        timestamp: Date.now(),
        reason
      };
      state.stagedOperations = [];
      state.locked = true;
      return true;
    }),

    commitTransaction: jest.fn(validation => {
      if (!state.activeTransaction) {
        return { success: false, error: 'No active transaction' };
      }

      const { expectedSize, expectedKeys } = validation || {};

      if (typeof expectedSize === 'number' && state.map.size !== expectedSize) {
        mock.rollbackTransaction();
        return { success: false, error: `Size mismatch: expected ${expectedSize}, got ${state.map.size}` };
      }

      if (expectedKeys) {
        const currentKeys = new Set(state.map.keys());
        const missingKeys = expectedKeys.filter(k => !currentKeys.has(k));
        if (missingKeys.length > 0) {
          mock.rollbackTransaction();
          return { success: false, error: `Missing expected keys: ${missingKeys.join(', ')}` };
        }
      }

      state.activeTransaction = null;
      state.stagedOperations = [];
      state.locked = false;
      state.rollbackCallbacks = [];
      return { success: true };
    }),

    rollbackTransaction: jest.fn(async () => {
      if (!state.activeTransaction) return false;
      state.map.clear();
      for (const [key, value] of state.activeTransaction.entries) {
        state.map.set(key, value);
      }
      state.activeTransaction = null;
      state.stagedOperations = [];
      state.locked = false;
      state.rollbackCallbacks = [];
      return true;
    }),

    // Entry operations (within transaction)
    deleteEntry: jest.fn((id, reason) => {
      if (!state.map.has(id)) return false;
      state.map.delete(id);
      state.stagedOperations.push({ type: 'delete', id, reason, timestamp: Date.now() });
      return true;
    }),

    setEntry: jest.fn((id, value, reason) => {
      state.map.set(id, value);
      state.stagedOperations.push({ type: 'set', id, value, reason, timestamp: Date.now() });
      return true;
    }),

    // Direct operations (without transaction)
    directDelete: jest.fn((id, _reason) => {
      if (state.locked) return false;
      if (!state.map.has(id)) return false;
      state.map.delete(id);
      return true;
    }),

    directSet: jest.fn((id, value, _reason) => {
      if (state.locked) return false;
      state.map.set(id, value);
      return true;
    }),

    directClear: jest.fn((_reason, _userInitiated) => {
      if (state.locked) return false;
      state.map.clear();
      return true;
    }),

    // Transaction state
    isInTransaction: jest.fn(() => !!state.activeTransaction),
    getTransactionId: jest.fn(() => state.activeTransaction?.id || null),
    getStagedOperations: jest.fn(() => [...state.stagedOperations]),

    // Rollback callbacks
    registerRollbackCallback: jest.fn((step, rollbackFn, snapshot) => {
      state.rollbackCallbacks.push({ step, rollbackFn, snapshot, registeredAt: Date.now() });
    }),
    executeCascadingRollback: jest.fn(async _failedAt => {
      const stepsRolledBack = await rollbackAllCallbacks(state.rollbackCallbacks);
      const errors = [];
      return { success: errors.length === 0, stepsRolledBack, errors };
    }),
    clearRollbackCallbacks: jest.fn(() => {
      state.rollbackCallbacks = [];
    }),

    // Statistics
    getStats: jest.fn(() => ({
      mapName: 'MockMap',
      mapSize: state.map.size,
      inTransaction: !!state.activeTransaction,
      transactionId: state.activeTransaction?.id || null,
      stagedOperationsCount: state.stagedOperations.length,
      totalTransactions: state.transactionCounter,
      locked: state.locked,
      pendingRollbackCallbacks: state.rollbackCallbacks.length
    })),

    // State helpers for tests
    _state: state,
    _reset: () => {
      jest.clearAllMocks();
      state.map.clear();
      state.activeTransaction = null;
      state.stagedOperations = [];
      state.transactionCounter = 0;
      state.locked = false;
      state.rollbackCallbacks = [];
    },

    // Apply overrides
    ...overrides
  };

  return mock;
}

/**
 * Creates a mock MinimizedManager with all methods mocked
 * @param {Object} overrides - Method overrides
 * @returns {Object} Mock MinimizedManager instance
 */
export function createMockMinimizedManager(overrides = {}) {
  const state = {
    minimizedTabs: new Map(),
    pendingClearSnapshots: new Map(),
    restoreInProgress: new Set(),
    lastLocalUpdateTime: Date.now()
  };

  const mock = {
    // Storage persistence callback
    onStoragePersistNeeded: null,

    // Core methods
    add: jest.fn((id, tabWindow) => {
      if (!tabWindow) return;
      const snapshot = {
        window: tabWindow,
        savedPosition: {
          left: tabWindow.left ?? 100,
          top: tabWindow.top ?? 100
        },
        savedSize: {
          width: tabWindow.width ?? 400,
          height: tabWindow.height ?? 300
        },
        savedOriginTabId: tabWindow.originTabId ?? null
      };
      state.minimizedTabs.set(id, snapshot);
    }),

    remove: jest.fn(id => {
      state.minimizedTabs.delete(id);
    }),

    restore: jest.fn(id => {
      if (state.restoreInProgress.has(id)) {
        const existingSnapshot = state.minimizedTabs.get(id) || state.pendingClearSnapshots.get(id);
        if (existingSnapshot) {
          return {
            window: existingSnapshot.window,
            position: { ...existingSnapshot.savedPosition },
            size: { ...existingSnapshot.savedSize },
            originTabId: existingSnapshot.savedOriginTabId ?? null,
            duplicate: true
          };
        }
        return false;
      }

      const snapshot = state.minimizedTabs.get(id) || state.pendingClearSnapshots.get(id);
      if (!snapshot) return false;

      state.restoreInProgress.add(id);
      setTimeout(() => state.restoreInProgress.delete(id), 500);

      if (state.minimizedTabs.has(id)) {
        state.minimizedTabs.delete(id);
        state.pendingClearSnapshots.set(id, snapshot);
      }

      const tabWindow = snapshot.window;
      tabWindow.left = snapshot.savedPosition.left;
      tabWindow.top = snapshot.savedPosition.top;
      tabWindow.width = snapshot.savedSize.width;
      tabWindow.height = snapshot.savedSize.height;

      return {
        window: tabWindow,
        position: { ...snapshot.savedPosition },
        size: { ...snapshot.savedSize },
        originTabId: snapshot.savedOriginTabId ?? null
      };
    }),

    // Snapshot methods
    getSnapshot: jest.fn(id => {
      const snapshot = state.minimizedTabs.get(id) || state.pendingClearSnapshots.get(id);
      if (snapshot && snapshot.savedPosition && snapshot.savedSize) {
        return {
          position: { ...snapshot.savedPosition },
          size: { ...snapshot.savedSize },
          originTabId: snapshot.savedOriginTabId ?? null
        };
      }
      return null;
    }),

    clearSnapshot: jest.fn(id => {
      const inMinimizedTabs = state.minimizedTabs.has(id);
      const inPendingClear = state.pendingClearSnapshots.has(id);

      if (inMinimizedTabs) {
        state.minimizedTabs.delete(id);
        state.lastLocalUpdateTime = Date.now();
        return true;
      }
      if (inPendingClear) {
        state.pendingClearSnapshots.delete(id);
        state.lastLocalUpdateTime = Date.now();
        return true;
      }
      return false;
    }),

    clearSnapshotAtomic: jest.fn((id, entity) => {
      const cleared = mock.clearSnapshot(id);
      if (entity && typeof entity === 'object') {
        entity.minimized = false;
      }
      return cleared;
    }),

    hasSnapshot: jest.fn(id => {
      return state.minimizedTabs.has(id) || state.pendingClearSnapshots.has(id);
    }),

    updateWindowReference: jest.fn((id, newWindow) => {
      const snapshot = state.minimizedTabs.get(id);
      if (snapshot && newWindow) {
        snapshot.window = newWindow;
        return true;
      }
      return false;
    }),

    // Query methods
    getAll: jest.fn(() => Array.from(state.minimizedTabs.values()).map(s => s.window)),
    getCount: jest.fn(() => state.minimizedTabs.size),
    isMinimized: jest.fn(id => state.minimizedTabs.has(id)),
    getAllSnapshotIds: jest.fn(() => [
      ...Array.from(state.minimizedTabs.keys()),
      ...Array.from(state.pendingClearSnapshots.keys())
    ]),

    // Validation
    validateStateConsistency: jest.fn((id, entityMinimizedFlag) => {
      const inMap = state.minimizedTabs.has(id);
      const inPending = state.pendingClearSnapshots.has(id);
      return (entityMinimizedFlag && inMap) ||
             (!entityMinimizedFlag && !inMap) ||
             (!entityMinimizedFlag && inPending);
    }),

    // Cleanup
    clear: jest.fn(() => {
      state.minimizedTabs.clear();
      state.pendingClearSnapshots.clear();
      state.restoreInProgress.clear();
      state.lastLocalUpdateTime = Date.now();
    }),

    forceCleanup: jest.fn(id => {
      if (!id) return false;
      const wasInMinimized = state.minimizedTabs.delete(id);
      const wasInPending = state.pendingClearSnapshots.delete(id);
      const wasRestoreInProgress = state.restoreInProgress.delete(id);
      const cleaned = wasInMinimized || wasInPending || wasRestoreInProgress;
      if (cleaned) state.lastLocalUpdateTime = Date.now();
      return cleaned;
    }),

    // State helpers for tests
    _state: state,
    _reset: () => {
      jest.clearAllMocks();
      state.minimizedTabs.clear();
      state.pendingClearSnapshots.clear();
      state.restoreInProgress.clear();
      state.lastLocalUpdateTime = Date.now();
      mock.onStoragePersistNeeded = null;
    },

    // Apply overrides
    ...overrides
  };

  return mock;
}

/**
 * Get call history for a mock manager
 * @param {Object} manager - Mock manager instance
 * @returns {Object} Object with method names and their call counts/args
 */
export function getManagerCallHistory(manager) {
  const history = {};
  for (const [key, value] of Object.entries(manager)) {
    if (typeof value === 'function' && value.mock) {
      history[key] = {
        callCount: value.mock.calls.length,
        calls: value.mock.calls,
        results: value.mock.results
      };
    }
  }
  return history;
}

/**
 * Assert manager state is internally consistent
 * @param {Object} manager - Mock manager instance
 * @throws {Error} If state is inconsistent
 */
export function assertManagerStateConsistent(manager) {
  if (!manager._state) {
    throw new Error('Manager does not have _state property');
  }
  // Basic consistency checks based on manager type
  const state = manager._state;

  // Check Map-based state
  if (state.map && !(state.map instanceof Map)) {
    throw new Error('State map is not a Map instance');
  }
  if (state.minimizedTabs && !(state.minimizedTabs instanceof Map)) {
    throw new Error('State minimizedTabs is not a Map instance');
  }
  if (state.groups && !(state.groups instanceof Map)) {
    throw new Error('State groups is not a Map instance');
  }

  return true;
}

/**
 * Reset a manager mock to initial state
 * @param {Object} manager - Mock manager instance
 */
export function resetManagerMock(manager) {
  if (typeof manager._reset === 'function') {
    manager._reset();
  } else {
    jest.clearAllMocks();
  }
}
