/**
 * QuickTabStateMachine - Explicit lifecycle state tracking and transition validation
 *
 * v1.6.3.5 - New module for Phase 1 of Architecture Refactor
 * v1.6.3.10-v12 - FIX Issue #3: Added CREATING, CLOSING, ERROR states
 *   - Extended state machine with full lifecycle tracking
 *   - Added guardOperation() for operation-level state validation
 *   - Added canMinimize/canRestore/canClose convenience methods
 *
 * Responsibilities:
 * - Track each Quick Tab's current state (CREATING, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, CLOSING, DESTROYED, ERROR)
 * - Validate state transitions before allowing operations
 * - Log every state change with timestamp and initiator
 * - Reject invalid operations (e.g., minimize already-minimized tab)
 * - Provide state history for debugging
 * - Guard operations based on current state (e.g., block minimize while creating)
 *
 * @module state-machine
 */

/**
 * Valid Quick Tab states
 * v1.6.3.10-v12 - FIX Issue #3: Added CREATING, CLOSING, ERROR states for complete lifecycle tracking
 * @enum {string}
 */
export const QuickTabState = {
  /** Initial state - Tab not yet tracked */
  UNKNOWN: 'UNKNOWN',
  /** Tab is being created (ID generated, not yet rendered) */
  CREATING: 'CREATING',
  /** Tab is visible and rendered in DOM */
  VISIBLE: 'VISIBLE',
  /** Tab is in process of minimizing */
  MINIMIZING: 'MINIMIZING',
  /** Tab is minimized (no DOM) */
  MINIMIZED: 'MINIMIZED',
  /** Tab is in process of restoring */
  RESTORING: 'RESTORING',
  /** Tab is in process of closing/being destroyed */
  CLOSING: 'CLOSING',
  /** Tab has been destroyed */
  DESTROYED: 'DESTROYED',
  /** Tab is in error state (operation failed) */
  ERROR: 'ERROR'
};

/**
 * Valid state transitions - Map of fromState -> Set of valid toStates
 * v1.6.3.10-v12 - FIX Issue #3: Extended with CREATING, CLOSING, ERROR transitions
 * @type {Map<string, Set<string>>}
 */
const VALID_TRANSITIONS = new Map([
  [QuickTabState.UNKNOWN, new Set([QuickTabState.CREATING, QuickTabState.VISIBLE, QuickTabState.MINIMIZED])],
  [QuickTabState.CREATING, new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED, QuickTabState.ERROR, QuickTabState.DESTROYED])],
  [QuickTabState.VISIBLE, new Set([QuickTabState.MINIMIZING, QuickTabState.CLOSING, QuickTabState.DESTROYED, QuickTabState.ERROR])],
  [QuickTabState.MINIMIZING, new Set([QuickTabState.MINIMIZED, QuickTabState.VISIBLE, QuickTabState.ERROR])],
  [QuickTabState.MINIMIZED, new Set([QuickTabState.RESTORING, QuickTabState.CLOSING, QuickTabState.DESTROYED, QuickTabState.ERROR])],
  [QuickTabState.RESTORING, new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED, QuickTabState.ERROR])],
  [QuickTabState.CLOSING, new Set([QuickTabState.DESTROYED, QuickTabState.ERROR])],
  [QuickTabState.DESTROYED, new Set()], // Terminal state - no transitions allowed
  [QuickTabState.ERROR, new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED, QuickTabState.DESTROYED])] // Can recover or be destroyed
]);

/**
 * Maximum history entries per Quick Tab
 * @type {number}
 */
const MAX_HISTORY_SIZE = 20;

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

  // ==================== v1.6.3.10-v12 FIX ISSUE #3: OPERATION GUARDS ====================
  
  /**
   * Check if minimize operation is allowed for a Quick Tab
   * v1.6.3.10-v12 - FIX Issue #3: Operation-level state validation
   * @param {string} id - Quick Tab ID
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canMinimize(id) {
    const state = this.getState(id);
    
    // Can only minimize from VISIBLE state
    if (state !== QuickTabState.VISIBLE) {
      return { 
        allowed: false, 
        reason: `Cannot minimize from state ${state} (must be VISIBLE)` 
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check if restore operation is allowed for a Quick Tab
   * v1.6.3.10-v12 - FIX Issue #3: Operation-level state validation
   * @param {string} id - Quick Tab ID
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canRestore(id) {
    const state = this.getState(id);
    
    // Can only restore from MINIMIZED state
    if (state !== QuickTabState.MINIMIZED) {
      return { 
        allowed: false, 
        reason: `Cannot restore from state ${state} (must be MINIMIZED)` 
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check if close operation is allowed for a Quick Tab
   * v1.6.3.10-v12 - FIX Issue #3: Operation-level state validation
   * @param {string} id - Quick Tab ID
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canClose(id) {
    const state = this.getState(id);
    
    // Cannot close from CREATING, CLOSING, or DESTROYED states
    const blockedStates = [QuickTabState.CREATING, QuickTabState.CLOSING, QuickTabState.DESTROYED];
    if (blockedStates.includes(state)) {
      return { 
        allowed: false, 
        reason: `Cannot close from state ${state}` 
      };
    }
    
    return { allowed: true };
  }

  /**
   * Guard an operation based on current state
   * v1.6.3.10-v12 - FIX Issue #3: Unified operation guard with logging
   * @param {string} id - Quick Tab ID
   * @param {string} operation - Operation name ('minimize', 'restore', 'close')
   * @param {string} source - Who initiated the operation
   * @returns {{ allowed: boolean, reason?: string, currentState: string }}
   */
  guardOperation(id, operation, source = 'unknown') {
    const currentState = this.getState(id);
    let result;
    
    switch (operation) {
      case 'minimize':
        result = this.canMinimize(id);
        break;
      case 'restore':
        result = this.canRestore(id);
        break;
      case 'close':
        result = this.canClose(id);
        break;
      default:
        result = { allowed: true }; // Unknown operations are allowed by default
    }
    
    // Log guard result
    if (!result.allowed) {
      console.warn('[QuickTabStateMachine] OPERATION_BLOCKED:', {
        id,
        operation,
        source,
        currentState,
        reason: result.reason
      });
    } else {
      console.log('[QuickTabStateMachine] OPERATION_ALLOWED:', {
        id,
        operation,
        source,
        currentState
      });
    }
    
    return { ...result, currentState };
  }

  // ==================== END ISSUE #3 FIX ====================

  /**
   * Get statistics about the state machine
   * @returns {Object} Statistics object
   */
  getStats() {
    const stateCounts = {};

    for (const state of this._states.values()) {
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    }

    return {
      trackedCount: this._states.size,
      stateCounts,
      enforcing: this.enforceTransitions
    };
  }

  /**
   * Clear all state tracking (for testing/reset)
   */
  clear() {
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
