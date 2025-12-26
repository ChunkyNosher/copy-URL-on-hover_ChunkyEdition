/**
 * QuickTabMediator - Centralized coordinator for multi-step Quick Tab operations
 *
 * v1.6.3.5 - New module for Phase 2 of Architecture Refactor
 * v1.6.4 - Scenario-aware logging hooks for state transitions
 * v1.6.4.1 - Code Health 9.0+ refactor: reduced duplication, options objects
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
 * @typedef {Object} StateTransitionLogOptions
 * @property {string} event - Event name (MINIMIZE_TOGGLED, RESTORE_TOGGLED, etc.)
 * @property {string} source - Who initiated the operation
 * @property {string} id - Quick Tab ID
 * @property {string|null} containerId - Container ID
 * @property {string} phase - Operation phase (START, BLOCKED, REJECTED, etc.)
 * @property {Object} [extraData] - Additional data to log
 */

/**
 * @typedef {Object} ExecuteOperationOptions
 * @property {string} id - Quick Tab ID
 * @property {string} source - Who initiated the operation
 * @property {string|null} containerId - Container ID
 * @property {string} correlationId - Correlation ID for tracking
 * @property {Object} logger - Logger instance
 */

/**
 * Operation configuration for minimize/restore operations
 * @typedef {Object} OperationConfig
 * @property {string} eventName - Event name for logging
 * @property {string} operationName - Operation name (minimize, restore)
 * @property {string} validFromState - Required state to start (VISIBLE or MINIMIZED)
 * @property {string} transitionState - Intermediate state (MINIMIZING or RESTORING)
 * @property {string} finalState - End state (MINIMIZED or VISIBLE)
 * @property {string} handlerMethod - Handler method name (handleMinimize or handleRestore)
 */

/**
 * Operation configurations for minimize and restore
 * @type {Object.<string, OperationConfig>}
 */
const OPERATION_CONFIGS = {
  minimize: {
    eventName: 'MINIMIZE_TOGGLED',
    operationName: 'minimize',
    validFromState: QuickTabState.VISIBLE,
    transitionState: QuickTabState.MINIMIZING,
    finalState: QuickTabState.MINIMIZED,
    handlerMethod: 'handleMinimize'
  },
  restore: {
    eventName: 'RESTORE_TOGGLED',
    operationName: 'restore',
    validFromState: QuickTabState.MINIMIZED,
    transitionState: QuickTabState.RESTORING,
    finalState: QuickTabState.VISIBLE,
    handlerMethod: 'handleRestore'
  }
};

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
   * v1.6.4.1 - Refactored to use options object instead of 7 positional arguments
   * @private
   * @param {Object} logger - Logger instance
   * @param {StateTransitionLogOptions} options - Logging options
   */
  _logStateTransition(logger, options) {
    const { event, source, id, containerId, phase, extraData = {} } = options;
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
   * @typedef {Object} ExecuteOperationConfig
   * @property {string} operation - Operation type (minimize, restore, destroy)
   * @property {string} eventName - Event name for logging
   * @property {string} id - Quick Tab ID
   * @property {string} source - Who initiated the operation
   * @property {Object} context - Context with containerId and tabId
   * @property {Function} executeCallback - Function to execute the operation
   */

  /**
   * Common entry point for minimize/restore/destroy operations
   * v1.6.4.1 - Extracted to reduce duplication across minimize/restore/destroy
   * v1.6.4.2 - Refactored to use options object (reduces from 6 to 1 argument)
   * @private
   * @param {ExecuteOperationConfig} config - Operation configuration
   * @returns {OperationResult}
   */
  _executeOperation(config) {
    const { operation, eventName, id, source, context, executeCallback } = config;
    const correlationId = generateCorrelationId(operation.substring(0, 3));
    const logger = quickTabsMediatorLogger.withCorrelation(correlationId);
    const { containerId = null, tabId = null } = context;

    this._logStateTransition(logger, {
      event: eventName,
      source,
      id,
      containerId,
      phase: 'START',
      extraData: { tabId }
    });
    console.log(`[QuickTabMediator] ${operation}() called:`, { id, source });

    // Step 1: Acquire lock
    if (!this._tryAcquireLock(operation, id)) {
      this._logStateTransition(logger, {
        event: eventName,
        source,
        id,
        containerId,
        phase: 'BLOCKED',
        extraData: { reason: 'Operation lock held' }
      });
      return { success: false, error: 'Operation lock held' };
    }

    try {
      return executeCallback({ id, source, containerId, correlationId, logger });
    } finally {
      this._releaseLock(operation, id);
    }
  }

  /**
   * Validate state for visibility operation
   * v1.6.4.2 - Extracted from _executeVisibilityOperation to reduce method size
   * @private
   * @param {Object} params - Validation parameters
   * @returns {{ valid: boolean, currentState: string, error?: OperationResult }}
   */
  _validateVisibilityState(params) {
    const { id, source, containerId, logger, eventName, operationName, validFromState } = params;
    const currentState = this._stateMachine.getState(id);

    if (currentState !== validFromState && currentState !== QuickTabState.UNKNOWN) {
      this._logStateTransition(logger, {
        event: eventName,
        source,
        id,
        containerId,
        phase: 'REJECTED',
        extraData: {
          previousState: currentState,
          reason: `Cannot ${operationName} tab in ${currentState} state`
        }
      });
      console.log(`[QuickTabMediator] Cannot ${operationName} - invalid state:`, currentState);
      return {
        valid: false,
        currentState,
        error: { success: false, error: `Cannot ${operationName} tab in ${currentState} state` }
      };
    }

    return { valid: true, currentState };
  }

  /**
   * Handle visibility operation failure with rollback
   * v1.6.4.2 - Extracted from _executeVisibilityOperation to reduce method size
   * @private
   * @param {Object} params - Failure handling parameters
   * @param {Object} result - The failed operation result
   * @returns {OperationResult}
   */
  _handleVisibilityFailure(params, result) {
    const { id, source, containerId, correlationId, logger, eventName, validFromState, transitionState } = params;

    this._stateMachine.transition(id, validFromState, {
      source: 'mediator-rollback',
      metadata: { reason: result.error, correlationId }
    });
    this._logStateTransition(logger, {
      event: eventName,
      source,
      id,
      containerId,
      phase: 'ROLLBACK',
      extraData: {
        previousState: transitionState,
        newState: validFromState,
        error: result.error
      }
    });
    return result;
  }

  /**
   * Execute a minimize/restore operation using shared logic
   * v1.6.4.1 - Extracted to eliminate duplication between minimize/restore
   * v1.6.4.2 - Reduced size by extracting validation and failure handling
   * @private
   * @param {OperationConfig} config - Operation configuration
   * @param {ExecuteOperationOptions} options - Execution options
   * @returns {OperationResult}
   */
  _executeVisibilityOperation(config, options) {
    const { id, source, containerId, correlationId, logger } = options;
    const { eventName, operationName, validFromState, transitionState, finalState, handlerMethod } = config;

    // Validate current state
    const validation = this._validateVisibilityState({
      id, source, containerId, logger, eventName, operationName, validFromState
    });
    if (!validation.valid) {
      return validation.error;
    }

    // Transition to intermediate state
    const transitionResult = this._stateMachine.transition(id, transitionState, {
      source,
      metadata: { operation: operationName, correlationId }
    });

    if (!transitionResult.success && this._stateMachine.enforceTransitions) {
      this._logStateTransition(logger, {
        event: eventName,
        source,
        id,
        containerId,
        phase: 'TRANSITION_FAILED',
        extraData: {
          previousState: validation.currentState,
          targetState: transitionState,
          error: transitionResult.error
        }
      });
      return { success: false, error: transitionResult.error };
    }

    // Execute operation via VisibilityHandler
    const result = this.visibilityHandler[handlerMethod](id, source);

    if (!result.success) {
      return this._handleVisibilityFailure(
        { id, source, containerId, correlationId, logger, eventName, validFromState, transitionState },
        result
      );
    }

    // Transition to final state
    this._stateMachine.transition(id, finalState, {
      source,
      metadata: { operation: `${operationName}-complete`, correlationId }
    });

    this._logStateTransition(logger, {
      event: eventName,
      source,
      id,
      containerId,
      phase: 'COMPLETE',
      extraData: {
        previousState: validFromState,
        newState: finalState
      }
    });

    console.log(`[QuickTabMediator] ${operationName}() complete:`, { id, source });
    return { success: true, fromState: validFromState, toState: finalState };
  }

  /**
   * Coordinate a minimize operation
   * v1.6.4 - Scenario-aware logging with structured state transition logging
   * v1.6.4.1 - Refactored to use shared _executeOperation helper
   * v1.6.4.2 - Uses config object for _executeOperation
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @param {Object} [context] - Optional context with containerId and tabId
   * @returns {OperationResult}
   */
  minimize(id, source = 'unknown', context = {}) {
    return this._executeOperation({
      operation: 'minimize',
      eventName: OPERATION_CONFIGS.minimize.eventName,
      id,
      source,
      context,
      executeCallback: (options) => this._executeVisibilityOperation(OPERATION_CONFIGS.minimize, options)
    });
  }

  /**
   * Coordinate a restore operation
   * v1.6.4 - Scenario-aware logging with structured state transition logging
   * v1.6.4.1 - Refactored to use shared _executeOperation helper
   * v1.6.4.2 - Uses config object for _executeOperation
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @param {Object} [context] - Optional context with containerId and tabId
   * @returns {OperationResult}
   */
  restore(id, source = 'unknown', context = {}) {
    return this._executeOperation({
      operation: 'restore',
      eventName: OPERATION_CONFIGS.restore.eventName,
      id,
      source,
      context,
      executeCallback: (options) => this._executeVisibilityOperation(OPERATION_CONFIGS.restore, options)
    });
  }

  /**
   * Coordinate a destroy operation
   * v1.6.4 - Scenario-aware logging with structured state transition logging
   * v1.6.4.1 - Refactored to use shared _executeOperation helper
   * v1.6.4.2 - Uses config object for _executeOperation
   * @param {string} id - Quick Tab ID
   * @param {string} source - Who initiated the operation
   * @param {Object} [context] - Optional context with containerId and tabId
   * @returns {OperationResult}
   */
  destroy(id, source = 'unknown', context = {}) {
    return this._executeOperation({
      operation: 'destroy',
      eventName: 'DESTROY_INITIATED',
      id,
      source,
      context,
      executeCallback: (options) => this._executeDestroyInternal(options)
    });
  }

  /**
   * Check if minimized manager has snapshot
   * v1.6.4.1 - Extracted to simplify complex conditional in _executeDestroyInternal
   * @private
   * @param {string} id - Quick Tab ID
   * @returns {boolean}
   */
  _hasMinimizedSnapshot(id) {
    return (
      this.minimizedManager &&
      typeof this.minimizedManager.hasSnapshot === 'function' &&
      this.minimizedManager.hasSnapshot(id)
    );
  }

  /**
   * Execute destroy operation internal logic
   * v1.6.4.1 - Refactored to use options object and extracted predicates
   * @private
   * @param {ExecuteOperationOptions} options - Execution options
   * @returns {OperationResult}
   */
  _executeDestroyInternal(options) {
    const { id, source, containerId, correlationId, logger } = options;

    // Check state machine - DESTROYED is terminal, can't destroy twice
    const currentState = this._stateMachine.getState(id);
    if (currentState === QuickTabState.DESTROYED) {
      this._logStateTransition(logger, {
        event: 'DESTROY_INITIATED',
        source,
        id,
        containerId,
        phase: 'ALREADY_DESTROYED',
        extraData: { previousState: currentState }
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
    if (this._hasMinimizedSnapshot(id)) {
      this.minimizedManager.clearSnapshot(id);
    }

    // Clean up from UICoordinator
    if (this.uiCoordinator?.destroy) {
      this.uiCoordinator.destroy(id);
    }

    // Remove from state machine tracking
    this._stateMachine.remove(id);

    this._logStateTransition(logger, {
      event: 'DESTROY_INITIATED',
      source,
      id,
      containerId,
      phase: 'COMPLETE',
      extraData: {
        previousState: currentState,
        newState: QuickTabState.DESTROYED
      }
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
