/**
 * QuickTabStateMachine - Explicit lifecycle state tracking and transition validation
 *
 * v1.6.3.5 - New module for Phase 1 of Architecture Refactor
 * v1.6.3.10-v12 - FIX Issue #3: Added CREATING, CLOSING, ERROR states
 *   - Extended state machine with full lifecycle tracking
 *   - Added guardOperation() for operation-level state validation
 *   - Added canMinimize/canRestore/canClose convenience methods
 * v1.6.3.11 - FIX Issue #29: Document limitation - state is memory-only
 *   - State is not persisted to storage and is lost on background restart
 *   - Content scripts should re-initialize state from storage on reconnection
 *   - Added logging when state may be stale after port reconnection
 *
 * Responsibilities:
 * - Track each Quick Tab's current state (CREATING, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, CLOSING, DESTROYED, ERROR)
 * - Validate state transitions before allowing operations
 * - Log every state change with timestamp and initiator
 * - Reject invalid operations (e.g., minimize already-minimized tab)
 * - Provide state history for debugging
 * - Guard operations based on current state (e.g., block minimize while creating)
 *
 * KNOWN LIMITATION (v1.6.3.11 - Issue #29):
 * State is stored in memory only and is NOT persisted across:
 * - Browser restarts
 * - Background script restarts
 * - Tab refreshes
 * When state is lost, Quick Tabs should be rehydrated from storage.
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
  [
    QuickTabState.UNKNOWN,
    new Set([QuickTabState.CREATING, QuickTabState.VISIBLE, QuickTabState.MINIMIZED])
  ],
  [
    QuickTabState.CREATING,
    new Set([
      QuickTabState.VISIBLE,
      QuickTabState.MINIMIZED,
      QuickTabState.ERROR,
      QuickTabState.DESTROYED
    ])
  ],
  [
    QuickTabState.VISIBLE,
    new Set([
      QuickTabState.MINIMIZING,
      QuickTabState.CLOSING,
      QuickTabState.DESTROYED,
      QuickTabState.ERROR
    ])
  ],
  [
    QuickTabState.MINIMIZING,
    new Set([QuickTabState.MINIMIZED, QuickTabState.VISIBLE, QuickTabState.ERROR])
  ],
  [
    QuickTabState.MINIMIZED,
    new Set([
      QuickTabState.RESTORING,
      QuickTabState.CLOSING,
      QuickTabState.DESTROYED,
      QuickTabState.ERROR
    ])
  ],
  [
    QuickTabState.RESTORING,
    new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED, QuickTabState.ERROR])
  ],
  [QuickTabState.CLOSING, new Set([QuickTabState.DESTROYED, QuickTabState.ERROR])],
  [QuickTabState.DESTROYED, new Set()], // Terminal state - no transitions allowed
  [
    QuickTabState.ERROR,
    new Set([QuickTabState.VISIBLE, QuickTabState.MINIMIZED, QuickTabState.DESTROYED])
  ] // Can recover or be destroyed
]);

/**
 * Maximum history entries per Quick Tab
 * v1.6.3.11 - FIX Issue #35: Document that Array.shift() is O(n)
 * KNOWN LIMITATION: Current implementation uses Array.shift() which is O(n).
 * For small history size (20 entries), this is acceptable.
 * FUTURE: Consider circular buffer implementation if history size increases significantly.
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

    /**
     * v1.6.3.11 - FIX Issue #29: Track last initialization time for staleness detection
     * @type {number}
     * @private
     */
    this._lastInitTime = Date.now();

    console.log('[QuickTabStateMachine] Initialized');
  }

  /**
   * Check if state may be stale (after reconnection)
   * v1.6.3.11 - FIX Issue #29: Detect potentially stale state after background restart
   * @param {number} lastKnownGoodTime - Timestamp of last known good state
   * @returns {boolean} True if state may be stale
   */
  isStatePotentiallyStale(lastKnownGoodTime) {
    const isStale = this._lastInitTime > lastKnownGoodTime;
    if (isStale) {
      console.warn('[QuickTabStateMachine] STATE_POTENTIALLY_STALE:', {
        initTime: this._lastInitTime,
        lastKnownGoodTime,
        trackedCount: this._states.size,
        recommendation: 'Re-hydrate state from storage'
      });
    }
    return isStale;
  }

  /**
   * Mark state as refreshed (after rehydration)
   * v1.6.3.11 - FIX Issue #29: Update init time after state refresh
   */
  markStateRefreshed() {
    this._lastInitTime = Date.now();
    console.log('[QuickTabStateMachine] STATE_REFRESHED:', {
      newInitTime: this._lastInitTime,
      trackedCount: this._states.size
    });
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
   * v1.6.3.11-v3 - FIX Issue #63: Enhanced state change logging with trigger type
   * @param {string} id - Quick Tab ID
   * @param {string} toState - Target state
   * @param {Object} options - Transition options
   * @param {string} options.source - Who initiated the transition
   * @param {Object} [options.metadata] - Additional context
   * @param {string} [options.trigger='system'] - Trigger type ('user' or 'system')
   * @returns {{ success: boolean, error?: string, fromState: string, toState: string }}
   */
  transition(id, toState, options = {}) {
    const { source = 'unknown', metadata = {}, trigger = 'system' } = options;
    const fromState = this.getState(id);
    const timestamp = Date.now();

    // Create transition entry for logging
    const transitionEntry = {
      fromState,
      toState,
      timestamp,
      source,
      trigger,
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

    // v1.6.3.11-v3 - FIX Issue #63: Enhanced state change logging
    console.log('[QuickTabStateMachine] STATE_TRANSITION:', {
      id,
      previousState: fromState,
      newState: toState,
      trigger,
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

  // ==================== v1.6.3.11-v3 FIX ISSUE #29: STORAGE PERSISTENCE ====================

  /**
   * Storage key for persisting Quick Tab states
   * v1.6.3.11-v3 - FIX Issue #29: Persist state across background restarts
   * @type {string}
   */
  static STORAGE_KEY = 'quicktab_states_v1';

  /**
   * Persist current state to storage
   * v1.6.3.11-v3 - FIX Issue #29: Save state changes immediately after update
   * @returns {Promise<boolean>} True if persistence succeeded
   */
  async persistToStorage() {
    try {
      const stateData = {};
      for (const [id, state] of this._states) {
        stateData[id] = state;
      }

      await browser.storage.session.set({
        [QuickTabStateMachine.STORAGE_KEY]: {
          states: stateData,
          timestamp: Date.now(),
          version: 1
        }
      });

      console.log('[QuickTabStateMachine] PERSIST_TO_STORAGE:', {
        stateCount: this._states.size,
        timestamp: Date.now()
      });

      return true;
    } catch (err) {
      console.error('[QuickTabStateMachine] PERSIST_FAILED:', {
        error: err.message,
        stateCount: this._states.size
      });
      return false;
    }
  }

  /**
   * Restore state from storage
   * v1.6.3.11-v3 - FIX Issue #29: Load state on reconnect after background restart
   * @returns {Promise<{success: boolean, stateCount: number, timestamp?: number}>}
   */
  async restoreFromStorage() {
    try {
      const result = await browser.storage.session.get(QuickTabStateMachine.STORAGE_KEY);
      const stored = result[QuickTabStateMachine.STORAGE_KEY];

      if (!stored || !stored.states) {
        console.log('[QuickTabStateMachine] RESTORE_FROM_STORAGE: No stored state found');
        return { success: false, stateCount: 0 };
      }

      // Clear current state and restore from storage
      this._states.clear();
      const restoredCount = this._restoreStatesFromData(stored.states);

      this._lastInitTime = Date.now();

      console.log('[QuickTabStateMachine] RESTORE_FROM_STORAGE:', {
        restoredCount,
        storedTimestamp: stored.timestamp,
        ageMs: Date.now() - stored.timestamp
      });

      return {
        success: true,
        stateCount: restoredCount,
        timestamp: stored.timestamp
      };
    } catch (err) {
      console.error('[QuickTabStateMachine] RESTORE_FAILED:', {
        error: err.message
      });
      return { success: false, stateCount: 0 };
    }
  }

  /**
   * Helper to restore states from data object
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce restoreFromStorage complexity
   * @private
   * @param {Object} statesData - States data from storage
   * @returns {number} Count of restored states
   */
  _restoreStatesFromData(statesData) {
    let restoredCount = 0;
    const validStates = Object.values(QuickTabState);

    for (const [id, state] of Object.entries(statesData)) {
      const isValidState = validStates.includes(state);
      if (!isValidState) {
        console.warn('[QuickTabStateMachine] RESTORE_SKIPPED: Unknown state:', { id, state });
        continue;
      }
      this._states.set(id, state);
      restoredCount++;
    }

    return restoredCount;
  }

  /**
   * Verify state matches backend and reconcile if needed
   * v1.6.3.11-v3 - FIX Issue #29: On reconnect, verify state with backend
   * @param {Object} backendState - State from backend { quickTabId: state }
   * @returns {{ matched: boolean, reconciled: string[] }}
   */
  reconcileWithBackend(backendState) {
    if (!backendState || typeof backendState !== 'object') {
      console.warn('[QuickTabStateMachine] RECONCILE: Invalid backend state');
      return { matched: true, reconciled: [] };
    }

    const reconciled = [];

    // Reconcile backend states with local
    this._reconcileBackendStates(backendState, reconciled);

    // Check for ghost Quick Tabs (local but not in backend)
    this._reconcileGhostTabs(backendState, reconciled);

    if (reconciled.length > 0) {
      console.log('[QuickTabStateMachine] RECONCILE_COMPLETE:', {
        reconciledCount: reconciled.length,
        reconciledIds: reconciled
      });
    }

    return {
      matched: reconciled.length === 0,
      reconciled
    };
  }

  /**
   * Reconcile backend states with local states
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce reconcileWithBackend complexity
   * @private
   */
  _reconcileBackendStates(backendState, reconciled) {
    for (const [id, backendStateValue] of Object.entries(backendState)) {
      const localState = this._states.get(id);

      if (localState === backendStateValue) continue;

      console.log('[QuickTabStateMachine] RECONCILE_MISMATCH:', {
        id,
        localState: localState || 'UNKNOWN',
        backendState: backendStateValue
      });

      // Update to match backend (backend is source of truth)
      this._states.set(id, backendStateValue);
      this._addToHistory(id, {
        fromState: localState || QuickTabState.UNKNOWN,
        toState: backendStateValue,
        timestamp: Date.now(),
        source: 'reconcile-with-backend',
        metadata: { type: 'reconciliation' }
      });

      reconciled.push(id);
    }
  }

  /**
   * Find and mark ghost Quick Tabs (local but not in backend)
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce reconcileWithBackend complexity
   * @private
   */
  _reconcileGhostTabs(backendState, reconciled) {
    for (const [id, localState] of this._states) {
      if (id in backendState) continue;

      console.warn('[QuickTabStateMachine] GHOST_DETECTED:', {
        id,
        localState,
        action: 'marking-destroyed'
      });

      // Mark as destroyed (it doesn't exist on backend)
      this._states.set(id, QuickTabState.DESTROYED);
      this._addToHistory(id, {
        fromState: localState,
        toState: QuickTabState.DESTROYED,
        timestamp: Date.now(),
        source: 'reconcile-ghost-cleanup',
        metadata: { type: 'ghost-cleanup' }
      });

      reconciled.push(id);
    }
  }

  // ==================== END ISSUE #29 FIX ====================
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
