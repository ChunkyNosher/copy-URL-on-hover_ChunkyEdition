/**
 * QuickTabMediator - Centralized coordinator for multi-step Quick Tab operations
 *
 * v1.6.3.5 - New module for Phase 2 of Architecture Refactor
 * v1.6.4 - Scenario-aware logging hooks for state transitions
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
import {
  quickTabsMediatorLogger,
  generateCorrelationId
} from '../../utils/structured-logger.js';

/**
 * @typedef {Object} OperationResult
 * @property {boolean} success - Whether operation succeeded
 * @property {string} [error] - Error message if failed
 * @property {string} [fromState] - Previous state
 * @property {string} [toState] - New state
 */

/**
 * Operation lock timeout (ms)
 * v1.6.3.10-v6 - FIX Issue A15: Increased from 500ms to 2000ms
 *   Operations can take >500ms (especially with slow storage or network),
 *   causing lock expiration and duplicate operations. 2000ms aligns with
 *   STORAGE_TIMEOUT_MS for consistency.
 * @type {number}
 */
const OPERATION_LOCK_MS = 2000;

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
   * Log state transition event
   * v1.6.4 - Extracted to reduce method complexity
   * @private
   */
  _logStateTransition(logger, event, source, id, containerId, phase, extraData = {}) {
    const logData = {
      event,
      source,
      quickTabId: id,
      containerId,
      phase,
      ...extraData
    };

    if (phase === 'BLOCKED' || phase === 'REJECTED') {
      logger.warn('STATE_TRANSITION', logData);
    } else if (phase === 'ROLLBACK' || phase === 'TRANSITION_FAILED') {
      logger.error('STATE_TRANSITION', logData);
    } else {
      logger.info('STATE_TRANSITION', logData);
    }
  }

  /**
   * Coordinate a minimize operation
   * v1.6.4 - Scenario-aware logging with structured state transition logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @param {Object} [context] - Optional context with containerId and tabId
   * @returns {OperationResult}
   */
  minimize(id, source = 'unknown', context = {}) {
    const correlationId = generateCorrelationId('min');
    const logger = quickTabsMediatorLogger.withCorrelation(correlationId);
    const { containerId = null, tabId = null } = context;

    this._logStateTransition(logger, 'MINIMIZE_TOGGLED', source, id, containerId, 'START', { tabId });
    console.log('[QuickTabMediator] minimize() called:', { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock('minimize', id)) {
      this._logStateTransition(logger, 'MINIMIZE_TOGGLED', source, id, containerId, 'BLOCKED', {
        reason: 'Operation lock held'
      });
      return { success: false, error: 'Operation lock held' };
    }

    try {
      return this._executeMinimize(id, source, containerId, correlationId, logger);
    } finally {
      this._releaseLock('minimize', id);
    }
  }

  /**
   * Execute minimize operation after lock acquisition
   * v1.6.4 - Extracted to reduce minimize() complexity
   * @private
   */
  _executeMinimize(id, source, containerId, correlationId, logger) {
    // Check state machine - is tab in VISIBLE state?
    const currentState = this._stateMachine.getState(id);
    if (currentState !== QuickTabState.VISIBLE && currentState !== QuickTabState.UNKNOWN) {
      this._logStateTransition(logger, 'MINIMIZE_TOGGLED', source, id, containerId, 'REJECTED', {
        previousState: currentState,
        reason: `Cannot minimize tab in ${currentState} state`
      });
      console.log('[QuickTabMediator] Cannot minimize - invalid state:', currentState);
      return { success: false, error: `Cannot minimize tab in ${currentState} state` };
    }

    // Transition to MINIMIZING state
    const transitionResult = this._stateMachine.transition(id, QuickTabState.MINIMIZING, {
      source,
      metadata: { operation: 'minimize', correlationId }
    });

    if (!transitionResult.success && this._stateMachine.enforceTransitions) {
      this._logStateTransition(logger, 'MINIMIZE_TOGGLED', source, id, containerId, 'TRANSITION_FAILED', {
        previousState: currentState,
        targetState: QuickTabState.MINIMIZING,
        error: transitionResult.error
      });
      return { success: false, error: transitionResult.error };
    }

    // Execute minimize via VisibilityHandler
    const result = this.visibilityHandler.handleMinimize(id, source);

    if (!result.success) {
      this._stateMachine.transition(id, QuickTabState.VISIBLE, {
        source: 'mediator-rollback',
        metadata: { reason: result.error, correlationId }
      });
      this._logStateTransition(logger, 'MINIMIZE_TOGGLED', source, id, containerId, 'ROLLBACK', {
        previousState: QuickTabState.MINIMIZING,
        newState: QuickTabState.VISIBLE,
        error: result.error
      });
      return result;
    }

    // Transition to MINIMIZED state
    this._stateMachine.transition(id, QuickTabState.MINIMIZED, {
      source,
      metadata: { operation: 'minimize-complete', correlationId }
    });

    this._logStateTransition(logger, 'MINIMIZE_TOGGLED', source, id, containerId, 'COMPLETE', {
      previousState: QuickTabState.VISIBLE,
      newState: QuickTabState.MINIMIZED
    });

    console.log('[QuickTabMediator] minimize() complete:', { id, source });
    return { success: true, fromState: QuickTabState.VISIBLE, toState: QuickTabState.MINIMIZED };
  }

  /**
   * Coordinate a restore operation
   * v1.6.4 - Scenario-aware logging with structured state transition logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @param {Object} [context] - Optional context with containerId and tabId
   * @returns {OperationResult}
   */
  restore(id, source = 'unknown', context = {}) {
    const correlationId = generateCorrelationId('rst');
    const logger = quickTabsMediatorLogger.withCorrelation(correlationId);
    const { containerId = null, tabId = null } = context;

    this._logStateTransition(logger, 'RESTORE_TOGGLED', source, id, containerId, 'START', { tabId });
    console.log('[QuickTabMediator] restore() called:', { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock('restore', id)) {
      this._logStateTransition(logger, 'RESTORE_TOGGLED', source, id, containerId, 'BLOCKED', {
        reason: 'Operation lock held'
      });
      return { success: false, error: 'Operation lock held' };
    }

    try {
      return this._executeRestore(id, source, containerId, correlationId, logger);
    } finally {
      this._releaseLock('restore', id);
    }
  }

  /**
   * Execute restore operation after lock acquisition
   * v1.6.4 - Extracted to reduce restore() complexity
   * @private
   */
  _executeRestore(id, source, containerId, correlationId, logger) {
    // Check state machine - is tab in MINIMIZED state?
    const currentState = this._stateMachine.getState(id);
    if (currentState !== QuickTabState.MINIMIZED && currentState !== QuickTabState.UNKNOWN) {
      this._logStateTransition(logger, 'RESTORE_TOGGLED', source, id, containerId, 'REJECTED', {
        previousState: currentState,
        reason: `Cannot restore tab in ${currentState} state`
      });
      console.log('[QuickTabMediator] Cannot restore - invalid state:', currentState);
      return { success: false, error: `Cannot restore tab in ${currentState} state` };
    }

    // Transition to RESTORING state
    const transitionResult = this._stateMachine.transition(id, QuickTabState.RESTORING, {
      source,
      metadata: { operation: 'restore', correlationId }
    });

    if (!transitionResult.success && this._stateMachine.enforceTransitions) {
      this._logStateTransition(logger, 'RESTORE_TOGGLED', source, id, containerId, 'TRANSITION_FAILED', {
        previousState: currentState,
        targetState: QuickTabState.RESTORING,
        error: transitionResult.error
      });
      return { success: false, error: transitionResult.error };
    }

    // Execute restore via VisibilityHandler
    const result = this.visibilityHandler.handleRestore(id, source);

    if (!result.success) {
      this._stateMachine.transition(id, QuickTabState.MINIMIZED, {
        source: 'mediator-rollback',
        metadata: { reason: result.error, correlationId }
      });
      this._logStateTransition(logger, 'RESTORE_TOGGLED', source, id, containerId, 'ROLLBACK', {
        previousState: QuickTabState.RESTORING,
        newState: QuickTabState.MINIMIZED,
        error: result.error
      });
      return result;
    }

    // Transition to VISIBLE state
    this._stateMachine.transition(id, QuickTabState.VISIBLE, {
      source,
      metadata: { operation: 'restore-complete', correlationId }
    });

    this._logStateTransition(logger, 'RESTORE_TOGGLED', source, id, containerId, 'COMPLETE', {
      previousState: QuickTabState.MINIMIZED,
      newState: QuickTabState.VISIBLE
    });

    console.log('[QuickTabMediator] restore() complete:', { id, source });
    return { success: true, fromState: QuickTabState.MINIMIZED, toState: QuickTabState.VISIBLE };
  }

  /**
   * Coordinate a destroy operation
   * v1.6.4 - Scenario-aware logging with structured state transition logging
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @param {Object} [context] - Optional context with containerId and tabId
   * @returns {OperationResult}
   */
  destroy(id, source = 'unknown', context = {}) {
    const correlationId = generateCorrelationId('dst');
    const logger = quickTabsMediatorLogger.withCorrelation(correlationId);
    const { containerId = null, tabId = null } = context;

    this._logStateTransition(logger, 'DESTROY_INITIATED', source, id, containerId, 'START', { tabId });
    console.log('[QuickTabMediator] destroy() called:', { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock('destroy', id)) {
      this._logStateTransition(logger, 'DESTROY_INITIATED', source, id, containerId, 'BLOCKED', {
        reason: 'Operation lock held'
      });
      return { success: false, error: 'Operation lock held' };
    }

    try {
      return this._executeDestroy(id, source, containerId, correlationId, logger);
    } finally {
      this._releaseLock('destroy', id);
    }
  }

  /**
   * Execute destroy operation after lock acquisition
   * v1.6.4 - Extracted to reduce destroy() complexity
   * @private
   */
  _executeDestroy(id, source, containerId, correlationId, logger) {
    // Check state machine - DESTROYED is terminal, can't destroy twice
    const currentState = this._stateMachine.getState(id);
    if (currentState === QuickTabState.DESTROYED) {
      this._logStateTransition(logger, 'DESTROY_INITIATED', source, id, containerId, 'ALREADY_DESTROYED', {
        previousState: currentState
      });
      console.log('[QuickTabMediator] Tab already destroyed:', id);
      return { success: true, error: 'Already destroyed' };
    }

    // Transition to DESTROYED state (allow from any state except DESTROYED)
    this._stateMachine.transition(id, QuickTabState.DESTROYED, {
      source,
      metadata: { operation: 'destroy', previousState: currentState, correlationId }
    });

    // Clean up from minimized manager if needed
    if (
      this.minimizedManager &&
      typeof this.minimizedManager.hasSnapshot === 'function' &&
      this.minimizedManager.hasSnapshot(id)
    ) {
      this.minimizedManager.clearSnapshot(id);
    }

    // Clean up from UICoordinator
    if (this.uiCoordinator?.destroy) {
      this.uiCoordinator.destroy(id);
    }

    // Remove from state machine tracking
    this._stateMachine.remove(id);

    this._logStateTransition(logger, 'DESTROY_INITIATED', source, id, containerId, 'COMPLETE', {
      previousState: currentState,
      newState: QuickTabState.DESTROYED
    });

    console.log('[QuickTabMediator] destroy() complete:', { id, source });
    return { success: true, fromState: currentState, toState: QuickTabState.DESTROYED };
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
