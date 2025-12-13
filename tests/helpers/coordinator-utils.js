/**
 * Coordinator Test Utilities
 * Provides utilities for testing coordination between components
 *
 * v1.6.4 - New test helper for comprehensive Jest testing infrastructure
 *
 * Features:
 * - Mock subordinate components
 * - Track operation sequence
 * - Verify event emission
 * - Support operation recording/playback
 * - Simulate component errors
 *
 * @module tests/helpers/coordinator-utils
 */

/**
 * Creates a test bed for testing coordinators
 * @param {Object} coordinator - Coordinator instance to test
 * @param {Object} dependencies - Mock dependencies
 * @returns {Object} Test bed instance
 */
export function createCoordinatorTestBed(coordinator, dependencies = {}) {
  const state = {
    operationLog: [],
    eventLog: [],
    errorLog: [],
    componentErrors: new Map()
  };

  // Wrap coordinator methods to track operations
  const originalMethods = {};
  const methodsToWrap = Object.getOwnPropertyNames(Object.getPrototypeOf(coordinator))
    .filter(name => name !== 'constructor' && typeof coordinator[name] === 'function');

  for (const methodName of methodsToWrap) {
    originalMethods[methodName] = coordinator[methodName].bind(coordinator);

    coordinator[methodName] = async function (...args) {
      const operationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startTime = Date.now();

      state.operationLog.push({
        id: operationId,
        method: methodName,
        args: JSON.parse(JSON.stringify(args)),
        startTime,
        endTime: null,
        duration: null,
        result: null,
        error: null,
        status: 'pending'
      });

      try {
        const result = await originalMethods[methodName](...args);
        const endTime = Date.now();

        // Update log entry
        const entry = state.operationLog.find(e => e.id === operationId);
        if (entry) {
          entry.endTime = endTime;
          entry.duration = endTime - startTime;
          entry.result = result;
          entry.status = 'success';
        }

        return result;
      } catch (err) {
        const endTime = Date.now();

        // Update log entry
        const entry = state.operationLog.find(e => e.id === operationId);
        if (entry) {
          entry.endTime = endTime;
          entry.duration = endTime - startTime;
          entry.error = err.message;
          entry.status = 'error';
        }

        state.errorLog.push({
          operationId,
          method: methodName,
          error: err.message,
          timestamp: endTime
        });

        throw err;
      }
    };
  }

  // Track events if coordinator has event emitter
  if (coordinator.on && typeof coordinator.on === 'function') {
    const originalOn = coordinator.on.bind(coordinator);
    coordinator.on = function (event, listener) {
      const wrappedListener = (...args) => {
        state.eventLog.push({
          event,
          args: JSON.parse(JSON.stringify(args)),
          timestamp: Date.now()
        });
        return listener(...args);
      };
      return originalOn(event, wrappedListener);
    };
  }

  // If coordinator has emit method, wrap it
  if (coordinator.emit && typeof coordinator.emit === 'function') {
    const originalEmit = coordinator.emit.bind(coordinator);
    coordinator.emit = function (event, ...args) {
      state.eventLog.push({
        event,
        args: JSON.parse(JSON.stringify(args)),
        timestamp: Date.now(),
        source: 'emit'
      });
      return originalEmit(event, ...args);
    };
  }

  return {
    coordinator,
    dependencies,

    /**
     * Get all operation logs
     * @returns {Array}
     */
    getOperationLog: () => [...state.operationLog],

    /**
     * Get all event logs
     * @returns {Array}
     */
    getEventLog: () => [...state.eventLog],

    /**
     * Get all error logs
     * @returns {Array}
     */
    getErrorLog: () => [...state.errorLog],

    /**
     * Clear all logs
     */
    clearLogs: () => {
      state.operationLog.length = 0;
      state.eventLog.length = 0;
      state.errorLog.length = 0;
    },

    /**
     * Restore original methods
     */
    restore: () => {
      for (const [methodName, original] of Object.entries(originalMethods)) {
        coordinator[methodName] = original;
      }
    },

    /**
     * Set a component to throw errors
     * @param {string} componentName - Component name
     * @param {Error} error - Error to throw
     */
    setComponentError: (componentName, error) => {
      state.componentErrors.set(componentName, error);
    },

    /**
     * Clear component error
     * @param {string} componentName - Component name
     */
    clearComponentError: componentName => {
      state.componentErrors.delete(componentName);
    },

    /**
     * Get component error if set
     * @param {string} componentName - Component name
     * @returns {Error|null}
     */
    getComponentError: componentName => state.componentErrors.get(componentName) || null,

    _state: state,
    _originalMethods: originalMethods
  };
}

/**
 * Record a specific operation and its effects
 * @param {Object} testBed - Coordinator test bed
 * @param {string} operation - Operation method name
 * @param {...*} args - Operation arguments
 * @returns {Promise<Object>} Operation result with timing and effects
 */
export async function recordOperation(testBed, operation, ...args) {
  const startEventCount = testBed.getEventLog().length;
  const startOpCount = testBed.getOperationLog().length;
  const startTime = Date.now();

  let result = null;
  let error = null;

  try {
    result = await testBed.coordinator[operation](...args);
  } catch (err) {
    error = err;
  }

  const endTime = Date.now();
  const newEvents = testBed.getEventLog().slice(startEventCount);
  const newOperations = testBed.getOperationLog().slice(startOpCount);

  return {
    operation,
    args,
    result,
    error,
    duration: endTime - startTime,
    events: newEvents,
    subOperations: newOperations.filter(op => op.method !== operation),
    success: error === null
  };
}

/**
 * Verify that operations occurred in expected sequence
 * @param {Array} recorded - Recorded operations from getOperationLog()
 * @param {Array} expected - Expected sequence of operation names
 * @returns {{ matches: boolean, differences: Array }}
 */
export function verifySequence(recorded, expected) {
  const differences = [];
  const actualSequence = recorded.map(op => op.method);

  // Check lengths
  if (actualSequence.length !== expected.length) {
    differences.push({
      type: 'length',
      expected: expected.length,
      actual: actualSequence.length
    });
  }

  // Check each position
  for (let i = 0; i < Math.max(actualSequence.length, expected.length); i++) {
    if (actualSequence[i] !== expected[i]) {
      differences.push({
        type: 'mismatch',
        index: i,
        expected: expected[i] || '(none)',
        actual: actualSequence[i] || '(none)'
      });
    }
  }

  return {
    matches: differences.length === 0,
    differences,
    actualSequence,
    expectedSequence: expected
  };
}

/**
 * Assert that a specific event was fired
 * @param {Object} testBed - Coordinator test bed
 * @param {string} event - Event name
 * @param {*} args - Expected args (optional, partial match)
 * @returns {{ found: boolean, matches: Array }}
 */
export function assertEventFired(testBed, event, args = null) {
  const eventLog = testBed.getEventLog();
  const matches = eventLog.filter(e => e.event === event);

  if (args !== null) {
    // Filter by args if provided
    const argsMatches = matches.filter(e => {
      if (Array.isArray(args)) {
        return args.every((arg, i) => {
          if (arg === undefined) return true; // Skip undefined positions
          return JSON.stringify(e.args[i]) === JSON.stringify(arg);
        });
      }
      return JSON.stringify(e.args[0]) === JSON.stringify(args);
    });

    return {
      found: argsMatches.length > 0,
      matches: argsMatches,
      allEventMatches: matches
    };
  }

  return {
    found: matches.length > 0,
    matches,
    allEventMatches: matches
  };
}

/**
 * Assert that an event was NOT fired
 * @param {Object} testBed - Coordinator test bed
 * @param {string} event - Event name
 * @returns {boolean} True if event was not fired
 */
export function assertEventNotFired(testBed, event) {
  const eventLog = testBed.getEventLog();
  return !eventLog.some(e => e.event === event);
}

/**
 * Simulate a component error during coordinator operation
 * @param {Object} testBed - Coordinator test bed
 * @param {string} component - Component name
 * @param {Error} error - Error to simulate
 */
export function simulateComponentError(testBed, component, error) {
  testBed.setComponentError(component, error);
}

/**
 * Get all operations from test bed
 * @param {Object} testBed - Coordinator test bed
 * @returns {Array} Operation log
 */
export function getOperationLog(testBed) {
  return testBed.getOperationLog();
}

/**
 * Wait for an event to be fired
 * @param {Object} testBed - Coordinator test bed
 * @param {string} event - Event name
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Object>} Event data
 */
export async function waitForEvent(testBed, event, timeout = 1000) {
  const startCount = testBed.getEventLog().filter(e => e.event === event).length;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const currentCount = testBed.getEventLog().filter(e => e.event === event).length;
    if (currentCount > startCount) {
      const events = testBed.getEventLog().filter(e => e.event === event);
      return events[events.length - 1];
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  throw new Error(`Timeout waiting for event: ${event}`);
}

/**
 * Create a mock event emitter for testing
 * @returns {Object} Mock event emitter
 */
export function createMockEventEmitter() {
  const listeners = new Map();
  const history = [];

  return {
    on: jest.fn((event, listener) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(listener);
    }),

    off: jest.fn((event, listener) => {
      if (listeners.has(event)) {
        const eventListeners = listeners.get(event);
        const index = eventListeners.indexOf(listener);
        if (index !== -1) {
          eventListeners.splice(index, 1);
        }
      }
    }),

    emit: jest.fn((event, ...args) => {
      history.push({ event, args, timestamp: Date.now() });
      if (listeners.has(event)) {
        listeners.get(event).forEach(listener => {
          try {
            listener(...args);
          } catch {
            // Ignore listener errors
          }
        });
      }
    }),

    once: jest.fn((event, listener) => {
      const wrapper = (...args) => {
        listeners.get(event)?.splice(listeners.get(event).indexOf(wrapper), 1);
        listener(...args);
      };
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(wrapper);
    }),

    removeAllListeners: jest.fn(event => {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    }),

    getHistory: () => [...history],
    getListenerCount: event => listeners.get(event)?.length || 0,
    clearHistory: () => { history.length = 0; },

    _listeners: listeners,
    _history: history
  };
}

/**
 * Create a mock coordinator for testing
 * @param {Object} config - Configuration
 * @returns {Object} Mock coordinator
 */
export function createMockCoordinator(config = {}) {
  const {
    hasEvents = true
  } = config;

  const state = {
    items: new Map(),
    operationHistory: []
  };

  const emitter = hasEvents ? createMockEventEmitter() : null;

  const coordinator = {
    // Core operations
    create: jest.fn(async (id, data) => {
      if (state.items.has(id)) {
        throw new Error(`Item ${id} already exists`);
      }
      state.items.set(id, { ...data, id, createdAt: Date.now() });
      state.operationHistory.push({ op: 'create', id, timestamp: Date.now() });
      if (emitter) emitter.emit('created', id, state.items.get(id));
      return state.items.get(id);
    }),

    update: jest.fn(async (id, data) => {
      if (!state.items.has(id)) {
        throw new Error(`Item ${id} not found`);
      }
      const updated = { ...state.items.get(id), ...data, updatedAt: Date.now() };
      state.items.set(id, updated);
      state.operationHistory.push({ op: 'update', id, timestamp: Date.now() });
      if (emitter) emitter.emit('updated', id, updated);
      return updated;
    }),

    destroy: jest.fn(async id => {
      if (!state.items.has(id)) {
        return false;
      }
      state.items.delete(id);
      state.operationHistory.push({ op: 'destroy', id, timestamp: Date.now() });
      if (emitter) emitter.emit('destroyed', id);
      return true;
    }),

    // Query methods
    get: jest.fn(id => state.items.get(id) || null),
    has: jest.fn(id => state.items.has(id)),
    getAll: jest.fn(() => Array.from(state.items.values())),
    count: jest.fn(() => state.items.size),

    // Event emitter methods (if enabled)
    ...(emitter ? {
      on: emitter.on,
      off: emitter.off,
      emit: emitter.emit,
      once: emitter.once
    } : {}),

    // State access
    _state: state,
    _emitter: emitter,

    // Reset helper
    _reset: () => {
      state.items.clear();
      state.operationHistory.length = 0;
      if (emitter) {
        emitter.clearHistory();
        emitter.removeAllListeners();
      }
      jest.clearAllMocks();
    }
  };

  return coordinator;
}
