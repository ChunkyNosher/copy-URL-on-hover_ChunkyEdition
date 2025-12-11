/**
 * QuickTabStateMachine - Explicit lifecycle state tracking and transition validation
 *
 * v1.6.3.5 - New module for Phase 1 of Architecture Refactor
 *
 * Responsibilities:
 * - Track each Quick Tab's current state (VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED)
 * - Validate state transitions before allowing operations
 * - Log every state change with timestamp and initiator
 * - Reject invalid operations (e.g., minimize already-minimized tab)
 * - Provide state history for debugging
 *
 * @module state-machine
 */

/**
 * Valid Quick Tab states
 * @enum {string}
 */
export const QuickTabState = {
  /** Initial state - Tab not yet tracked */
  UNKNOWN: 'UNKNOWN',
  /** Tab is visible and rendered in DOM */
  VISIBLE: 'VISIBLE',
  /** Tab is in process of minimizing */
  MINIMIZING: 'MINIMIZING',
  /** Tab is minimized (no DOM) */
  MINIMIZED: 'MINIMIZED',
  /** Tab is in process of restoring */
  RESTORING: 'RESTORING',
  /** Tab has been destroyed */
  DESTROYED: 'DESTROYED'
};

/**
 * Valid state transitions - Map of fromState -> Set of valid toStates
 * @type {Map<string, Set<string>>}
 */
const VALID_TRANSITIONS = new Map([
  [QuickTabState.UNKNOWN, new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED])],
  [QuickTabState.VISIBLE, new Set([QuickTabState.MINIMIZING, QuickTabState.DESTROYED])],
  [QuickTabState.MINIMIZING, new Set([QuickTabState.MINIMIZED, QuickTabState.VISIBLE])],
  [QuickTabState.MINIMIZED, new Set([QuickTabState.RESTORING, QuickTabState.DESTROYED])],
  [QuickTabState.RESTORING, new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED])],
  [QuickTabState.DESTROYED, new Set()] // Terminal state - no transitions allowed
]);

/**
 * Maximum history entries per Quick Tab
 * @type {number}
 */
const MAX_HISTORY_SIZE = 20;

/**
 * Timeout for intermediate states (MINIMIZING, RESTORING) in milliseconds
 * v1.6.4.8 - Issue #1: State timeout watchers
 * @type {number}
 */
const INTERMEDIATE_STATE_TIMEOUT_MS = 7000; // 7 seconds

/**
 * Intermediate states that require timeout monitoring
 * @type {Set<string>}
 */
const INTERMEDIATE_STATES = new Set(['MINIMIZING', 'RESTORING']);

/**
 * Fallback states for each intermediate state on timeout
 * @type {Map<string, string>}
 */
const TIMEOUT_FALLBACK_STATES = new Map([
  ['MINIMIZING', 'VISIBLE'],
  ['RESTORING', 'MINIMIZED']
]);

/**
 * State transition entry for history tracking
 * @typedef {Object} StateTransition
 * @property {string} fromState - Previous state
 * @property {string} toState - New state
 * @property {number} timestamp - When transition occurred
 * @property {string} source - Who initiated the transition
 * @property {Object} [metadata] - Additional context
 */

/**
 * QuickTabStateMachine class - Centralized state tracking for Quick Tabs
 */
export class QuickTabStateMachine {
  constructor() {
    /**
     * Current state for each Quick Tab
     * @type {Map<string, string>}
     * @private
     */
    this._states = new Map();

    /**
     * State history for each Quick Tab (circular buffer)
     * @type {Map<string, StateTransition[]>}
     * @private
     */
    this._history = new Map();

    /**
     * Whether to enforce state transitions (can be disabled for rollout)
     * @type {boolean}
     */
    this.enforceTransitions = true;

    /**
     * Active state timeout watchers
     * v1.6.4.8 - Issue #1: Track timeout timers for intermediate states
     * @type {Map<string, { timerId: number, fromState: string, enteredAt: number }>}
     * @private
     */
    this._stateTimeouts = new Map();

    console.log('[QuickTabStateMachine] Initialized');
  }

  /**
   * Get current state for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {string} Current state or UNKNOWN if not tracked
   */
  getState(id) {
    return this._states.get(id) || QuickTabState.UNKNOWN;
  }

  /**
   * Check if a state transition is valid
   * @param {string} id - Quick Tab ID
   * @param {string} toState - Target state
   * @returns {boolean} True if transition is allowed
   */
  canTransition(id, toState) {
    const fromState = this.getState(id);
    const validTargets = VALID_TRANSITIONS.get(fromState);

    if (!validTargets) {
      console.warn('[QuickTabStateMachine] Unknown fromState:', fromState);
      return false;
    }

    return validTargets.has(toState);
  }

  /**
   * Check if a transition from a specific state to another is valid
   * @param {string} fromState - Source state
   * @param {string} toState - Target state
   * @returns {boolean} True if transition is allowed
   */
  isValidTransition(fromState, toState) {
    const validTargets = VALID_TRANSITIONS.get(fromState);
    return validTargets ? validTargets.has(toState) : false;
  }

  /**
   * Perform a state transition with validation and logging
   * @param {string} id - Quick Tab ID
   * @param {string} toState - Target state
   * @param {Object} options - Transition options
   * @param {string} options.source - Who initiated the transition
   * @param {Object} [options.metadata] - Additional context
   * @returns {{ success: boolean, error?: string, fromState: string, toState: string }}
   */
  transition(id, toState, options = {}) {
    const { source = 'unknown', metadata = {} } = options;
    const fromState = this.getState(id);
    const timestamp = Date.now();

    // Create transition entry for logging
    const transitionEntry = {
      fromState,
      toState,
      timestamp,
      source,
      metadata
    };

    // Check if transition is valid
    if (!this.canTransition(id, toState)) {
      const error = `Invalid transition: ${fromState} → ${toState}`;

      if (this.enforceTransitions) {
        console.error('[QuickTabStateMachine] REJECTED:', {
          id,
          ...transitionEntry,
          error
        });
        return { success: false, error, fromState, toState };
      }

      // Log warning but allow if not enforcing
      console.warn('[QuickTabStateMachine] WARNING (not enforced):', {
        id,
        ...transitionEntry,
        error
      });
    }

    // Perform transition
    this._states.set(id, toState);

    // Add to history
    this._addToHistory(id, transitionEntry);

    // v1.6.4.8 - Issue #1: Manage timeout watchers for intermediate states
    if (INTERMEDIATE_STATES.has(toState)) {
      // Starting an intermediate state - start timeout watcher
      this._watchStateTimeout(id, toState, fromState);
    } else {
      // Leaving intermediate state or entering stable state - cancel any watcher
      this._cancelStateTimeout(id);
    }

    // Log successful transition
    console.log('[QuickTabStateMachine] Transition:', {
      id,
      fromState,
      toState,
      source,
      timestamp: new Date(timestamp).toISOString()
    });

    return { success: true, fromState, toState };
  }

  /**
   * Start a timeout watcher for an intermediate state
   * v1.6.4.8 - Issue #1: State timeout watchers
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} state - Current state (MINIMIZING or RESTORING)
   * @param {string} previousState - State before entering intermediate state
   */
  _watchStateTimeout(id, state, previousState) {
    // Clear any existing timeout for this ID
    this._cancelStateTimeout(id);

    if (!INTERMEDIATE_STATES.has(state)) {
      return; // Not an intermediate state, no timeout needed
    }

    const enteredAt = Date.now();
    const fallbackState = TIMEOUT_FALLBACK_STATES.get(state) || previousState;

    const timerId = setTimeout(() => {
      const currentState = this.getState(id);

      // Only recover if still stuck in the intermediate state
      if (currentState === state) {
        console.error('[QuickTabStateMachine] ⚠️ TIMEOUT: Stuck in intermediate state, recovering:', {
          id,
          stuckState: state,
          stuckDurationMs: Date.now() - enteredAt,
          fallbackState,
          originalPreviousState: previousState
        });

        // Force transition back to stable state
        this._states.set(id, fallbackState);
        this._addToHistory(id, {
          fromState: state,
          toState: fallbackState,
          timestamp: Date.now(),
          source: 'timeout-recovery',
          metadata: {
            type: 'timeout_recovery',
            stuckDurationMs: Date.now() - enteredAt,
            originalTimeout: INTERMEDIATE_STATE_TIMEOUT_MS
          }
        });

        console.log('[QuickTabStateMachine] Recovered from stuck state:', {
          id,
          recoveredTo: fallbackState
        });
      }

      // Clean up timeout tracking
      this._stateTimeouts.delete(id);
    }, INTERMEDIATE_STATE_TIMEOUT_MS);

    this._stateTimeouts.set(id, { timerId, fromState: previousState, enteredAt });
    console.log('[QuickTabStateMachine] Started timeout watcher:', {
      id,
      state,
      timeoutMs: INTERMEDIATE_STATE_TIMEOUT_MS
    });
  }

  /**
   * Cancel a timeout watcher for a Quick Tab
   * v1.6.4.8 - Issue #1: State timeout watchers
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if a timeout was cancelled
   */
  cancelStateTimeout(id) {
    return this._cancelStateTimeout(id);
  }

  /**
   * Internal method to cancel timeout watcher
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if cancelled
   */
  _cancelStateTimeout(id) {
    const timeout = this._stateTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout.timerId);
      this._stateTimeouts.delete(id);
      console.log('[QuickTabStateMachine] Cancelled timeout watcher:', {
        id,
        wasPendingForMs: Date.now() - timeout.enteredAt
      });
      return true;
    }
    return false;
  }

  /**
   * Add a transition to the history for a Quick Tab
   * @private
   * @param {string} id - Quick Tab ID
   * @param {StateTransition} entry - Transition entry
   */
  _addToHistory(id, entry) {
    let history = this._history.get(id);

    if (!history) {
      history = [];
      this._history.set(id, history);
    }

    // Add new entry
    history.push(entry);

    // Trim to max size (keep most recent)
    if (history.length > MAX_HISTORY_SIZE) {
      history.shift();
    }
  }

  /**
   * Get state history for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {StateTransition[]} Array of state transitions (oldest first)
   */
  getHistory(id) {
    return this._history.get(id) || [];
  }

  /**
   * Initialize a Quick Tab in a specific state
   * Useful for hydration from storage
   * @param {string} id - Quick Tab ID
   * @param {string} state - Initial state
   * @param {string} source - Who initialized it
   * @returns {boolean} True if initialized, false if already tracking
   */
  initialize(id, state, source = 'init') {
    // Skip if already tracking (idempotent)
    if (this._states.has(id)) {
      console.warn('[QuickTabStateMachine] Already tracking (init skipped):', {
        id,
        currentState: this._states.get(id)
      });
      return false;
    }

    const timestamp = Date.now();
    this._states.set(id, state);

    this._addToHistory(id, {
      fromState: QuickTabState.UNKNOWN,
      toState: state,
      timestamp,
      source,
      metadata: { type: 'initialize' }
    });

    console.log('[QuickTabStateMachine] Initialized:', { id, state, source });
    return true;
  }

  /**
   * Remove a Quick Tab from tracking
   * @param {string} id - Quick Tab ID
   */
  remove(id) {
    // v1.6.4.8 - Issue #1: Cancel any timeout watchers
    this._cancelStateTimeout(id);

    const hadState = this._states.delete(id);
    const hadHistory = this._history.delete(id);

    if (hadState || hadHistory) {
      console.log('[QuickTabStateMachine] Removed:', id);
    }
  }

  /**
   * Get all tracked Quick Tab IDs
   * @returns {string[]} Array of Quick Tab IDs
   */
  getAllIds() {
    return Array.from(this._states.keys());
  }

  /**
   * Get statistics about the state machine
   * @returns {Object} Statistics object
   */
  getStats() {
    const stateCounts = {};

    for (const state of this._states.values()) {
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    }

    // v1.6.4.8 - Issue #1: Include timeout watcher stats
    const pendingTimeouts = [];
    const now = Date.now();
    for (const [id, timeout] of this._stateTimeouts) {
      pendingTimeouts.push({
        id,
        pendingForMs: now - timeout.enteredAt,
        fromState: timeout.fromState
      });
    }

    return {
      trackedCount: this._states.size,
      stateCounts,
      enforcing: this.enforceTransitions,
      pendingTimeouts
    };
  }

  /**
   * Clear all state tracking (for testing/reset)
   */
  clear() {
    // v1.6.4.8 - Issue #1: Cancel all timeout watchers
    for (const [id, timeout] of this._stateTimeouts) {
      clearTimeout(timeout.timerId);
    }
    this._stateTimeouts.clear();

    this._states.clear();
    this._history.clear();
    console.log('[QuickTabStateMachine] Cleared all state tracking');
  }

  /**
   * Dump full state for debugging
   * @returns {Object} Full state dump
   */
  dump() {
    const states = {};
    const histories = {};

    for (const [id, state] of this._states) {
      states[id] = state;
    }

    for (const [id, history] of this._history) {
      histories[id] = history;
    }

    return { states, histories };
  }
}

// Singleton instance for use across the application
let stateMachineInstance = null;

/**
 * Get the singleton QuickTabStateMachine instance
 * @returns {QuickTabStateMachine}
 */
export function getStateMachine() {
  if (!stateMachineInstance) {
    stateMachineInstance = new QuickTabStateMachine();
  }
  return stateMachineInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetStateMachine() {
  if (stateMachineInstance) {
    stateMachineInstance.clear();
  }
  stateMachineInstance = null;
}
