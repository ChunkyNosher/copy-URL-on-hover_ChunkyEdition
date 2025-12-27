/**
 * State Machine Test Utilities
 * Provides utilities for testing finite state machines
 *
 * v1.6.3.12 - New test helper for comprehensive Jest testing infrastructure
 *
 * Features:
 * - Verify all valid transitions
 * - Catch invalid transitions
 * - Test guard conditions
 * - Track state change history
 * - Generate transition tables for documentation
 *
 * @module tests/helpers/state-machine-utils
 */

/**
 * Assert that a state transition is valid
 * @param {Object} machine - State machine instance
 * @param {string} from - Source state
 * @param {string} to - Target state
 * @param {string} action - Action triggering the transition
 * @throws {Error} If transition is not valid
 */
export function assertValidTransition(machine, from, to, action) {
  // First, check if transition is theoretically valid
  const canTransition =
    typeof machine.isValidTransition === 'function'
      ? machine.isValidTransition(from, to)
      : machine.canTransition
        ? (() => {
            // Need to set state first to check from that state
            const id = `test-${Date.now()}`;
            machine.initialize(id, from, 'test');
            const result = machine.canTransition(id, to);
            machine.remove(id);
            return result;
          })()
        : true;

  if (!canTransition) {
    throw new Error(
      `Expected valid transition from '${from}' to '${to}' via '${action}', but it was rejected`
    );
  }
}

/**
 * Assert that a state transition is invalid
 * @param {Object} machine - State machine instance
 * @param {string} from - Source state
 * @param {string} to - Target state
 * @param {string} action - Action triggering the transition
 * @throws {Error} If transition is unexpectedly valid
 */
export function assertInvalidTransition(machine, from, to, action) {
  let canTransition;

  if (typeof machine.isValidTransition === 'function') {
    canTransition = machine.isValidTransition(from, to);
  } else if (machine.canTransition) {
    const id = `test-${Date.now()}`;
    machine.initialize(id, from, 'test');
    canTransition = machine.canTransition(id, to);
    machine.remove(id);
  } else {
    canTransition = false;
  }

  if (canTransition) {
    throw new Error(
      `Expected invalid transition from '${from}' to '${to}' via '${action}', but it was allowed`
    );
  }
}

/**
 * Creates a transition recorder to track all state transitions
 * @param {Object} machine - State machine instance
 * @returns {Object} Recorder object
 */
export function recordTransitions(machine) {
  const history = [];
  const originalTransition = machine.transition.bind(machine);

  // Wrap transition method to record calls
  machine.transition = (id, toState, options = {}) => {
    const fromState = machine.getState(id);
    const result = originalTransition(id, toState, options);

    history.push({
      id,
      fromState,
      toState,
      action: options.source || 'unknown',
      success: result.success,
      error: result.error || null,
      timestamp: Date.now(),
      metadata: options.metadata || {}
    });

    return result;
  };

  return {
    /**
     * Get all recorded transitions
     * @returns {Array} Array of transition records
     */
    getHistory: () => [...history],

    /**
     * Get transitions for a specific Quick Tab ID
     * @param {string} id - Quick Tab ID
     * @returns {Array} Filtered transitions
     */
    getHistoryForId: id => history.filter(t => t.id === id),

    /**
     * Get successful transitions only
     * @returns {Array} Successful transitions
     */
    getSuccessfulTransitions: () => history.filter(t => t.success),

    /**
     * Get failed transitions only
     * @returns {Array} Failed transitions
     */
    getFailedTransitions: () => history.filter(t => !t.success),

    /**
     * Clear recorded history
     */
    clear: () => {
      history.length = 0;
    },

    /**
     * Restore original transition method
     */
    restore: () => {
      machine.transition = originalTransition;
    },

    /**
     * Get transition count
     * @returns {number}
     */
    getCount: () => history.length
  };
}

/**
 * Get transition history from recorder
 * @param {Object} recorder - Transition recorder
 * @returns {Array} Transition history
 */
export function getTransitionHistory(recorder) {
  return recorder.getHistory();
}

/**
 * Verify a guard condition on the state machine
 * @param {Object} machine - State machine instance
 * @param {string} state - State to check guard for
 * @param {Function} guard - Guard function that should return boolean
 * @param {Object} context - Context to pass to guard
 * @returns {{ passed: boolean, reason: string }}
 */
export function verifyGuardCondition(machine, state, guard, context = {}) {
  try {
    const result = guard(state, context);

    if (typeof result !== 'boolean') {
      return {
        passed: false,
        reason: `Guard did not return boolean, got ${typeof result}`
      };
    }

    return {
      passed: true,
      reason: result ? 'Guard condition passed' : 'Guard condition blocked'
    };
  } catch (err) {
    return {
      passed: false,
      reason: `Guard threw error: ${err.message}`
    };
  }
}

/**
 * Generate a transition table for documentation
 * @param {Object} machine - State machine instance or valid transitions map
 * @param {Array} states - Array of state names (optional)
 * @returns {Object} Transition table
 */
export function generateTransitionTable(machine, states = null) {
  // Try to extract states from machine
  const allStates = states || [
    'UNKNOWN',
    'VISIBLE',
    'MINIMIZING',
    'MINIMIZED',
    'RESTORING',
    'DESTROYED'
  ];

  const table = {
    states: allStates,
    transitions: [],
    matrix: {}
  };

  /**
   * Check if transition is valid using machine methods
   * @param {Object} machine - State machine
   * @param {string} from - From state
   * @param {string} to - To state
   * @returns {boolean} True if valid
   */
  function checkTransitionValidity(machine, from, to) {
    if (typeof machine.isValidTransition === 'function') {
      return machine.isValidTransition(from, to);
    }
    if (!machine.canTransition) return false;

    const id = `table-gen-${Date.now()}-${Math.random()}`;
    try {
      machine.initialize(id, from, 'table-gen');
      const isValid = machine.canTransition(id, to);
      machine.remove(id);
      return isValid;
    } catch {
      return false;
    }
  }

  /**
   * Populate matrix entry and add transition if valid
   * @param {string} from - From state
   * @param {string} to - To state
   * @param {boolean} isValid - Is transition valid
   */
  function populateMatrixEntry(from, to, isValid) {
    table.matrix[from][to] = isValid;
    if (isValid && from !== to) {
      table.transitions.push({ from, to });
    }
  }

  // Initialize matrix
  for (const from of allStates) {
    table.matrix[from] = {};
    for (const to of allStates) {
      const isValid = checkTransitionValidity(machine, from, to);
      populateMatrixEntry(from, to, isValid);
    }
  }

  return table;
}

/**
 * Format transition table as ASCII table
 * @param {Object} table - Transition table from generateTransitionTable
 * @returns {string} ASCII formatted table
 */
export function formatTransitionTable(table) {
  const colWidth = Math.max(...table.states.map(s => s.length)) + 2;
  let output = '';

  // Header row
  output += ''.padEnd(colWidth) + '│';
  for (const state of table.states) {
    output += state.padEnd(colWidth) + '│';
  }
  output += '\n';

  // Separator
  output += '─'.repeat(colWidth) + '┼';
  for (let i = 0; i < table.states.length; i++) {
    output += '─'.repeat(colWidth) + '┼';
  }
  output += '\n';

  // Data rows
  for (const from of table.states) {
    output += from.padEnd(colWidth) + '│';
    for (const to of table.states) {
      const symbol = table.matrix[from][to] ? '✓' : '✗';
      output += symbol.padEnd(colWidth) + '│';
    }
    output += '\n';
  }

  return output;
}

/**
 * Test all valid transitions for a state machine
 * @param {Object} machine - State machine instance
 * @param {Array} expectedTransitions - Array of {from, to} objects
 * @returns {{ passed: number, failed: number, errors: Array }}
 */
export function testAllTransitions(machine, expectedTransitions) {
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  for (const { from, to, action } of expectedTransitions) {
    const testResult = testSingleTransition(machine, from, to, action);
    if (testResult.success) {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push(testResult.error);
    }
  }

  return results;
}

/**
 * Test a single transition
 * @param {Object} machine - State machine
 * @param {string} from - From state
 * @param {string} to - To state
 * @param {string} action - Action name
 * @returns {{ success: boolean, error: Object|null }}
 */
function testSingleTransition(machine, from, to, action) {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  try {
    machine.initialize(id, from, 'test');
    const result = machine.transition(id, to, { source: action || 'test' });
    machine.remove(id);

    if (result.success) {
      return { success: true, error: null };
    }
    return { success: false, error: { from, to, action, error: result.error } };
  } catch (err) {
    return { success: false, error: { from, to, action, error: err.message } };
  }
}

/**
 * Test that invalid transitions are properly rejected
 * @param {Object} machine - State machine instance
 * @param {Array} invalidTransitions - Array of {from, to} objects that should fail
 * @returns {{ passed: number, failed: number, errors: Array }}
 */
export function testInvalidTransitions(machine, invalidTransitions) {
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  for (const { from, to, action } of invalidTransitions) {
    const testResult = testSingleInvalidTransition(machine, from, to, action);
    if (testResult.passed) {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push(testResult.error);
    }
  }

  return results;
}

/**
 * Test a single invalid transition
 * @param {Object} machine - State machine
 * @param {string} from - From state
 * @param {string} to - To state
 * @param {string} action - Action name
 * @returns {{ passed: boolean, error: Object|null }}
 */
function testSingleInvalidTransition(machine, from, to, action) {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  try {
    machine.initialize(id, from, 'test');
    const result = machine.transition(id, to, { source: action || 'test' });
    machine.remove(id);

    if (!result.success) {
      return { passed: true, error: null };
    }
    return {
      passed: false,
      error: { from, to, action, error: 'Expected rejection but transition succeeded' }
    };
  } catch {
    // Error thrown = transition rejected (good)
    return { passed: true, error: null };
  }
}

/**
 * Create a mock state machine for testing
 * @param {Object} config - Configuration
 * @param {Array} config.states - Array of state names
 * @param {Array} config.transitions - Array of {from, to} valid transitions
 * @returns {Object} Mock state machine
 */
export function createMockStateMachine(config = {}) {
  const { states = ['UNKNOWN', 'VISIBLE', 'MINIMIZED'], transitions = [] } = config;

  const validTransitions = new Map();
  for (const state of states) {
    validTransitions.set(state, new Set());
  }
  for (const { from, to } of transitions) {
    if (validTransitions.has(from)) {
      validTransitions.get(from).add(to);
    }
  }

  const currentStates = new Map();
  const history = new Map();

  return {
    states,
    transitions,

    getState: jest.fn(id => currentStates.get(id) || 'UNKNOWN'),

    canTransition: jest.fn((id, toState) => {
      const fromState = currentStates.get(id) || 'UNKNOWN';
      return validTransitions.get(fromState)?.has(toState) || false;
    }),

    isValidTransition: jest.fn((fromState, toState) => {
      return validTransitions.get(fromState)?.has(toState) || false;
    }),

    transition: jest.fn((id, toState, options = {}) => {
      const fromState = currentStates.get(id) || 'UNKNOWN';
      const isValid = validTransitions.get(fromState)?.has(toState) || false;

      if (!isValid) {
        return { success: false, error: `Invalid: ${fromState} → ${toState}`, fromState, toState };
      }

      currentStates.set(id, toState);

      if (!history.has(id)) {
        history.set(id, []);
      }
      history.get(id).push({
        fromState,
        toState,
        source: options.source || 'unknown',
        timestamp: Date.now()
      });

      return { success: true, fromState, toState };
    }),

    initialize: jest.fn((id, state, _source) => {
      if (currentStates.has(id)) return false;
      currentStates.set(id, state);
      return true;
    }),

    remove: jest.fn(id => {
      currentStates.delete(id);
      history.delete(id);
    }),

    getHistory: jest.fn(id => history.get(id) || []),

    getAllIds: jest.fn(() => Array.from(currentStates.keys())),

    clear: jest.fn(() => {
      currentStates.clear();
      history.clear();
    }),

    _currentStates: currentStates,
    _history: history,
    _validTransitions: validTransitions
  };
}
