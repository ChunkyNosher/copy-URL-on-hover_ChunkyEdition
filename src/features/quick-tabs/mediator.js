/**
 * QuickTabMediator - Centralized coordinator for multi-step Quick Tab operations
 *
 * v1.6.3.5 - New module for Phase 2 of Architecture Refactor
 *
 * Responsibilities:
 * - Single entry point for all minimize/restore/destroy operations
 * - Orchestrate handlers in correct sequence
 * - Coordinate atomic Map operations across multiple handlers
 * - Provide transaction rollback if any step fails
 * - Maintain operation-in-progress locks to prevent duplicates
 *
 * @module mediator
 */

import { QuickTabState, getStateMachine } from './state-machine.js';

/**
 * @typedef {Object} OperationResult
 * @property {boolean} success - Whether operation succeeded
 * @property {string} [error] - Error message if failed
 * @property {string} [fromState] - Previous state
 * @property {string} [toState] - New state
 */

/**
 * Operation lock timeout (ms)
 * @type {number}
 */
const OPERATION_LOCK_MS = 500;

/**
 * WeakRef polyfill check - use native WeakRef if available
 * v1.6.4.8 - Issue #2: Callback wrapper factory with weak references
 * @type {boolean}
 */
const HAS_WEAK_REF = typeof WeakRef !== 'undefined';

/**
 * QuickTabMediator class - Centralized operation coordinator
 */
export class QuickTabMediator {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.visibilityHandler - VisibilityHandler instance
   * @param {Object} options.minimizedManager - MinimizedManager instance
   * @param {Object} options.uiCoordinator - UICoordinator instance
   * @param {Map} options.quickTabsMap - Map of Quick Tab instances
   * @param {Object} [options.eventBus] - Event bus for notifications
   */
  constructor(options) {
    this.visibilityHandler = options.visibilityHandler;
    this.minimizedManager = options.minimizedManager;
    this.uiCoordinator = options.uiCoordinator;
    this.quickTabsMap = options.quickTabsMap;
    this.eventBus = options.eventBus || null;

    /**
     * State machine instance
     * @type {Object}
     * @private
     */
    this._stateMachine = getStateMachine();

    /**
     * Operation locks - Map of operationKey -> timestamp
     * @type {Map<string, number>}
     * @private
     */
    this._operationLocks = new Map();

    /**
     * Active rollback functions for current operations
     * @type {Map<string, Function[]>}
     * @private
     */
    this._rollbackStack = new Map();

    /**
     * v1.6.4.8 - Issue #2: Temporary callback bindings for cleanup
     * @type {Map<string, Map<string, Function>>}
     * @private
     */
    this._callbackBindings = new Map();

    /**
     * v1.6.4.8 - Issue #4: Step snapshots for cascading rollback
     * Stores state snapshots at each operation step for proper rollback
     * @type {Map<string, Array<{ step: string, snapshot: Object, rollbackFn: Function }>>}
     * @private
     */
    this._stepSnapshots = new Map();

    console.log('[QuickTabMediator] Initialized');
  }

  /**
   * Try to acquire a lock for an operation
   * @private
   * @param {string} operation - Operation type (minimize, restore, destroy)
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if lock acquired
   */
  _tryAcquireLock(operation, id) {
    const lockKey = `${operation}-${id}`;
    const now = Date.now();
    const existingLock = this._operationLocks.get(lockKey);

    // If lock exists and hasn't expired, reject
    if (existingLock && now - existingLock < OPERATION_LOCK_MS) {
      console.log(`[QuickTabMediator] Lock blocked duplicate ${operation} for:`, id);
      return false;
    }

    this._operationLocks.set(lockKey, now);
    return true;
  }

  /**
   * Release an operation lock
   * @private
   * @param {string} operation - Operation type
   * @param {string} id - Quick Tab ID
   */
  _releaseLock(operation, id) {
    const lockKey = `${operation}-${id}`;
    this._operationLocks.delete(lockKey);
  }

  /**
   * Push a rollback function onto the stack for an operation
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Function} rollbackFn - Function to call on rollback
   */
  _pushRollback(id, rollbackFn) {
    let stack = this._rollbackStack.get(id);
    if (!stack) {
      stack = [];
      this._rollbackStack.set(id, stack);
    }
    stack.push(rollbackFn);
  }

  /**
   * Execute all rollback functions for an operation (in reverse order)
   * @private
   * @param {string} id - Quick Tab ID
   */
  async _executeRollback(id) {
    const stack = this._rollbackStack.get(id);
    if (!stack || stack.length === 0) {
      return;
    }

    console.log('[QuickTabMediator] Executing rollback:', { id, steps: stack.length });

    // Execute in reverse order (LIFO)
    while (stack.length > 0) {
      const rollbackFn = stack.pop();
      try {
        await rollbackFn();
      } catch (err) {
        console.error('[QuickTabMediator] Rollback step failed:', err);
      }
    }

    this._rollbackStack.delete(id);
  }

  /**
   * Clear rollback stack for an operation (on success)
   * @private
   * @param {string} id - Quick Tab ID
   */
  _clearRollback(id) {
    this._rollbackStack.delete(id);
  }

  /**
   * v1.6.4.8 - Issue #2: Create a callback wrapper that won't retain closure scope
   * Uses WeakRef when available for automatic cleanup
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} callbackName - Name of the callback
   * @param {Function} callback - Original callback function
   * @param {Object} context - Context object (for WeakRef)
   * @returns {Function} Wrapped callback
   */
  _wrapCallback(id, callbackName, callback, context = null) {
    // Get or create callback map for this ID
    let idCallbacks = this._callbackBindings.get(id);
    if (!idCallbacks) {
      idCallbacks = new Map();
      this._callbackBindings.set(id, idCallbacks);
    }

    let wrappedCallback;

    if (HAS_WEAK_REF && context) {
      // Use WeakRef for automatic cleanup when context is GC'd
      const weakContext = new WeakRef(context);
      wrappedCallback = (...args) => {
        const ctx = weakContext.deref();
        if (ctx) {
          return callback.apply(ctx, args);
        }
        console.warn(`[QuickTabMediator] Callback ${callbackName} skipped - context was GC'd`);
        return undefined;
      };
    } else {
      // Fallback: simple wrapper without closure retention
      wrappedCallback = (...args) => callback(...args);
    }

    idCallbacks.set(callbackName, wrappedCallback);
    return wrappedCallback;
  }

  /**
   * v1.6.4.8 - Issue #2: Clean up all callback bindings for an operation
   * Called on operation completion or error
   * @private
   * @param {string} id - Quick Tab ID
   */
  _cleanupCallbacks(id) {
    const idCallbacks = this._callbackBindings.get(id);
    if (idCallbacks) {
      const callbackCount = idCallbacks.size;
      idCallbacks.clear();
      this._callbackBindings.delete(id);
      console.log('[QuickTabMediator] Cleaned up callbacks:', { id, callbackCount });
    }
  }

  /**
   * v1.6.4.8 - Issue #4: Register a rollback step with snapshot
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} step - Step name for logging
   * @param {Object} snapshot - State snapshot before this step
   * @param {Function} rollbackFn - Function to execute on rollback
   */
  _registerRollbackStep(id, step, snapshot, rollbackFn) {
    let steps = this._stepSnapshots.get(id);
    if (!steps) {
      steps = [];
      this._stepSnapshots.set(id, steps);
    }
    steps.push({ step, snapshot, rollbackFn, timestamp: Date.now() });
    console.log('[QuickTabMediator] Registered rollback step:', { id, step });
  }

  /**
   * v1.6.4.8 - Issue #4: Execute cascading rollback in LIFO order
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} failedAt - Step name where failure occurred
   * @returns {Promise<{ success: boolean, stepsRolledBack: number }>}
   */
  async _executeCascadingRollback(id, failedAt) {
    const steps = this._stepSnapshots.get(id);
    if (!steps || steps.length === 0) {
      console.warn('[QuickTabMediator] No rollback steps registered for:', id);
      return { success: true, stepsRolledBack: 0 };
    }

    console.log('[QuickTabMediator] ⚠️ Executing cascading rollback:', {
      id,
      failedAt,
      totalSteps: steps.length
    });

    let stepsRolledBack = 0;
    let lastError = null;

    // Execute in LIFO order (reverse)
    while (steps.length > 0) {
      const { step, snapshot, rollbackFn } = steps.pop();
      console.log('[QuickTabMediator] Rolling back step:', { id, step, hasSnapshot: !!snapshot });

      try {
        await rollbackFn(snapshot);
        stepsRolledBack++;
        console.log('[QuickTabMediator] ✓ Rollback step succeeded:', { id, step });
      } catch (err) {
        console.error('[QuickTabMediator] ✗ Rollback step failed:', { id, step, error: err.message });
        lastError = err;
        // Continue rolling back other steps even if one fails
      }
    }

    // Clean up
    this._stepSnapshots.delete(id);

    console.log('[QuickTabMediator] Cascading rollback complete:', {
      id,
      stepsRolledBack,
      hadErrors: !!lastError
    });

    return { success: !lastError, stepsRolledBack };
  }

  /**
   * v1.6.4.8 - Issue #4: Clear step snapshots on successful operation
   * @private
   * @param {string} id - Quick Tab ID
   */
  _clearStepSnapshots(id) {
    this._stepSnapshots.delete(id);
  }

  /**
   * Coordinate a minimize operation
   * v1.6.4.8 - Issue #1: Start/cancel timeout watchers
   * v1.6.4.8 - Issue #2: Clean up callbacks on completion/error
   * v1.6.4.8 - Issue #4: Use cascading rollback system
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @returns {OperationResult}
   */
  minimize(id, source = 'unknown') {
    console.log('[QuickTabMediator] minimize() called:', { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock('minimize', id)) {
      return { success: false, error: 'Operation lock held' };
    }

    try {
      // Step 2: Check state machine - is tab in VISIBLE state?
      const currentState = this._stateMachine.getState(id);
      if (currentState !== QuickTabState.VISIBLE && currentState !== QuickTabState.UNKNOWN) {
        console.log('[QuickTabMediator] Cannot minimize - invalid state:', currentState);
        return {
          success: false,
          error: `Cannot minimize tab in ${currentState} state`
        };
      }

      // v1.6.4.8 - Issue #4: Capture snapshot before state machine transition
      const preMinimizeSnapshot = {
        state: currentState,
        timestamp: Date.now()
      };

      // Step 3: Transition to MINIMIZING state (starts timeout watcher - Issue #1)
      const transitionResult = this._stateMachine.transition(id, QuickTabState.MINIMIZING, {
        source,
        metadata: { operation: 'minimize' }
      });

      if (!transitionResult.success && this._stateMachine.enforceTransitions) {
        return { success: false, error: transitionResult.error };
      }

      // v1.6.4.8 - Issue #4: Register rollback step for state transition
      this._registerRollbackStep(id, 'state-to-minimizing', preMinimizeSnapshot, async (snapshot) => {
        this._stateMachine.transition(id, snapshot.state, {
          source: 'mediator-rollback',
          metadata: { reason: 'minimize failed', originalState: snapshot.state }
        });
      });

      // Step 4: Execute minimize via VisibilityHandler
      const result = this.visibilityHandler.handleMinimize(id, source);

      if (!result.success) {
        // v1.6.4.8 - Issue #4: Execute cascading rollback
        this._executeCascadingRollback(id, 'visibility-handler');
        // Also cancel timeout watcher (Issue #1)
        this._stateMachine.cancelStateTimeout(id);
        return result;
      }

      // Step 5: Transition to MINIMIZED state (cancels timeout watcher - Issue #1)
      this._stateMachine.transition(id, QuickTabState.MINIMIZED, {
        source,
        metadata: { operation: 'minimize-complete' }
      });

      // v1.6.4.8 - Issue #2, #4: Cleanup on success
      this._clearStepSnapshots(id);
      this._cleanupCallbacks(id);

      console.log('[QuickTabMediator] minimize() complete:', { id, source });
      return { success: true, fromState: QuickTabState.VISIBLE, toState: QuickTabState.MINIMIZED };
    } finally {
      this._releaseLock('minimize', id);
    }
  }

  /**
   * Coordinate a restore operation
   * v1.6.4.8 - Issue #1: Start/cancel timeout watchers
   * v1.6.4.8 - Issue #2: Clean up callbacks on completion/error
   * v1.6.4.8 - Issue #4: Use cascading rollback system
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @returns {OperationResult}
   */
  restore(id, source = 'unknown') {
    console.log('[QuickTabMediator] restore() called:', { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock('restore', id)) {
      return { success: false, error: 'Operation lock held' };
    }

    try {
      // Step 2: Check state machine - is tab in MINIMIZED state?
      const currentState = this._stateMachine.getState(id);
      if (currentState !== QuickTabState.MINIMIZED && currentState !== QuickTabState.UNKNOWN) {
        console.log('[QuickTabMediator] Cannot restore - invalid state:', currentState);
        return {
          success: false,
          error: `Cannot restore tab in ${currentState} state`
        };
      }

      // v1.6.4.8 - Issue #4: Capture snapshot before state machine transition
      const preRestoreSnapshot = {
        state: currentState,
        timestamp: Date.now()
      };

      // v1.6.4.8 - Issue #4: Capture minimizedManager snapshot for rollback
      let minimizedSnapshot = null;
      if (this.minimizedManager?.hasSnapshot?.(id)) {
        minimizedSnapshot = this.minimizedManager.getSnapshot(id);
      }

      // Step 3: Transition to RESTORING state (starts timeout watcher - Issue #1)
      const transitionResult = this._stateMachine.transition(id, QuickTabState.RESTORING, {
        source,
        metadata: { operation: 'restore' }
      });

      if (!transitionResult.success && this._stateMachine.enforceTransitions) {
        return { success: false, error: transitionResult.error };
      }

      // v1.6.4.8 - Issue #4: Register rollback step for state transition
      this._registerRollbackStep(id, 'state-to-restoring', preRestoreSnapshot, async (snapshot) => {
        this._stateMachine.transition(id, snapshot.state, {
          source: 'mediator-rollback',
          metadata: { reason: 'restore failed', originalState: snapshot.state }
        });
      });

      // v1.6.4.8 - Issue #4: Register rollback step to re-save minimized snapshot if needed
      if (minimizedSnapshot) {
        this._registerRollbackStep(id, 'minimized-snapshot', minimizedSnapshot, async (snapshot) => {
          if (this.minimizedManager?.saveSnapshot) {
            this.minimizedManager.saveSnapshot(id, snapshot);
            console.log('[QuickTabMediator] Restored minimized snapshot on rollback:', id);
          }
        });
      }

      // Step 4: Execute restore via VisibilityHandler
      const result = this.visibilityHandler.handleRestore(id, source);

      if (!result.success) {
        // v1.6.4.8 - Issue #4: Execute cascading rollback
        this._executeCascadingRollback(id, 'visibility-handler');
        // Also cancel timeout watcher (Issue #1)
        this._stateMachine.cancelStateTimeout(id);
        return result;
      }

      // Step 5: Transition to VISIBLE state (cancels timeout watcher - Issue #1)
      this._stateMachine.transition(id, QuickTabState.VISIBLE, {
        source,
        metadata: { operation: 'restore-complete' }
      });

      // v1.6.4.8 - Issue #2, #4: Cleanup on success
      this._clearStepSnapshots(id);
      this._cleanupCallbacks(id);

      console.log('[QuickTabMediator] restore() complete:', { id, source });
      return { success: true, fromState: QuickTabState.MINIMIZED, toState: QuickTabState.VISIBLE };
    } finally {
      this._releaseLock('restore', id);
    }
  }

  /**
   * Coordinate a destroy operation
   * v1.6.4.8 - Issue #1: Cancel any timeout watchers
   * v1.6.4.8 - Issue #2: Clean up callbacks
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @returns {OperationResult}
   */
  destroy(id, source = 'unknown') {
    console.log('[QuickTabMediator] destroy() called:', { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock('destroy', id)) {
      return { success: false, error: 'Operation lock held' };
    }

    try {
      // Step 2: Check state machine - DESTROYED is terminal, can't destroy twice
      const currentState = this._stateMachine.getState(id);
      if (currentState === QuickTabState.DESTROYED) {
        console.log('[QuickTabMediator] Tab already destroyed:', id);
        return { success: true, error: 'Already destroyed' };
      }

      // v1.6.4.8 - Issue #1: Cancel any pending timeout watchers before destroy
      this._stateMachine.cancelStateTimeout(id);

      // Step 3: Transition to DESTROYED state
      // Allow from any state except DESTROYED
      this._stateMachine.transition(id, QuickTabState.DESTROYED, {
        source,
        metadata: { operation: 'destroy', previousState: currentState }
      });

      // Step 4: Clean up from minimized manager if needed
      if (
        this.minimizedManager &&
        typeof this.minimizedManager.hasSnapshot === 'function' &&
        this.minimizedManager.hasSnapshot(id)
      ) {
        this.minimizedManager.clearSnapshot(id);
      }

      // Step 5: Clean up from UICoordinator
      if (this.uiCoordinator?.destroy) {
        this.uiCoordinator.destroy(id);
      }

      // Step 6: Remove from state machine tracking
      this._stateMachine.remove(id);

      // v1.6.4.8 - Issue #2, #4: Clean up all tracking for this ID
      this._cleanupCallbacks(id);
      this._clearStepSnapshots(id);
      this._clearRollback(id);

      console.log('[QuickTabMediator] destroy() complete:', { id, source });
      return { success: true, fromState: currentState, toState: QuickTabState.DESTROYED };
    } finally {
      this._releaseLock('destroy', id);
    }
  }

  /**
   * Execute an operation with rollback capability
   * @param {Function} operation - Async function to execute
   * @param {Function} rollbackFn - Function to call on failure
   * @returns {Promise<{ success: boolean, result?: *, error?: string }>}
   */
  async executeWithRollback(operation, rollbackFn) {
    try {
      const result = await operation();
      return { success: true, result };
    } catch (err) {
      console.error('[QuickTabMediator] Operation failed, executing rollback:', err);

      try {
        await rollbackFn();
      } catch (rollbackErr) {
        console.error('[QuickTabMediator] Rollback also failed:', rollbackErr);
      }

      return { success: false, error: err.message || 'Operation failed' };
    }
  }

  /**
   * Initialize a Quick Tab in the state machine
   * @param {string} id - Quick Tab ID
   * @param {boolean} minimized - Whether tab is minimized
   * @param {string} source - Who initialized it
   */
  initializeTab(id, minimized = false, source = 'init') {
    const initialState = minimized ? QuickTabState.MINIMIZED : QuickTabState.VISIBLE;
    this._stateMachine.initialize(id, initialState, source);
  }

  /**
   * Get current state for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {string} Current state
   */
  getState(id) {
    return this._stateMachine.getState(id);
  }

  /**
   * Get state history for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @returns {Array} State history
   */
  getHistory(id) {
    return this._stateMachine.getHistory(id);
  }

  /**
   * Get statistics about operations
   * @returns {Object}
   */
  getStats() {
    return {
      activeLocks: Array.from(this._operationLocks.keys()),
      pendingRollbacks: Array.from(this._rollbackStack.keys()),
      stateMachine: this._stateMachine.getStats()
    };
  }

  /**
   * Clear all operation locks (for testing/reset)
   */
  clearLocks() {
    this._operationLocks.clear();
    this._rollbackStack.clear();
    // v1.6.4.8 - Issue #2, #4: Also clean up callback bindings and step snapshots
    this._callbackBindings.clear();
    this._stepSnapshots.clear();
  }
}

// Singleton instance
let mediatorInstance = null;

/**
 * Get or create the singleton QuickTabMediator instance
 * @param {Object} [options] - Configuration options (only used on first call)
 * @returns {QuickTabMediator|null}
 */
export function getMediator(options) {
  if (!mediatorInstance && options) {
    mediatorInstance = new QuickTabMediator(options);
  }
  return mediatorInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetMediator() {
  if (mediatorInstance) {
    mediatorInstance.clearLocks();
  }
  mediatorInstance = null;
}
