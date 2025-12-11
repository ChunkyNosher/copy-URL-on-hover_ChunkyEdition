/**
 * MapTransactionManager - Atomic operations on renderedTabs Map with logging and rollback
 *
 * v1.6.3.5 - New module for Phase 3 of Architecture Refactor
 *
 * Responsibilities:
 * - Wrap all Map delete/set sequences in transactions
 * - Capture Map state before modifications
 * - Log Map contents (not just size) at every operation
 * - Validate final state matches expected state
 * - Rollback on validation failure
 *
 * Key Pattern: Each Map modification is logged with:
 * - Current Map keys as array: mapKeys: ['qt-123', 'qt-456']
 * - Operation being performed: operation: 'delete'
 * - ID being operated on: targetId: 'qt-123'
 * - Timestamp with millisecond precision: timestamp: Date.now()
 * - Call stack depth: stackDepth: new Error().stack.split('\n').length
 *
 * @module map-transaction-manager
 */

/**
 * @typedef {Object} MapSnapshot
 * @property {Map<string, *>} entries - Snapshot of Map entries
 * @property {number} timestamp - When snapshot was taken
 * @property {string} reason - Why snapshot was taken
 */

/**
 * @typedef {Object} MapOperation
 * @property {'delete'|'set'|'clear'} type - Operation type
 * @property {string} id - Quick Tab ID (null for clear)
 * @property {*} [value] - Value for set operations
 * @property {string} reason - Why operation was performed
 * @property {number} timestamp - When operation was performed
 */

/**
 * MapTransactionManager class - Provides atomic operations on a Map
 */
export class MapTransactionManager {
  /**
   * @param {Map<string, *>} targetMap - The Map to manage (e.g., renderedTabs)
   * @param {string} [mapName='Map'] - Name for logging purposes
   */
  constructor(targetMap, mapName = 'Map') {
    if (!targetMap || !(targetMap instanceof Map)) {
      throw new Error(
        `MapTransactionManager requires a valid Map instance, received: ${typeof targetMap}`
      );
    }

    /**
     * The Map being managed
     * @type {Map<string, *>}
     * @private
     */
    this._map = targetMap;

    /**
     * Name for logging
     * @type {string}
     * @private
     */
    this._mapName = mapName;

    /**
     * Current transaction state
     * @type {MapSnapshot|null}
     * @private
     */
    this._activeTransaction = null;

    /**
     * Staged operations for current transaction
     * @type {MapOperation[]}
     * @private
     */
    this._stagedOperations = [];

    /**
     * Transaction counter for logging
     * @type {number}
     * @private
     */
    this._transactionCounter = 0;

    /**
     * Operation lock to prevent concurrent transactions
     * @type {boolean}
     * @private
     */
    this._locked = false;

    /**
     * v1.6.4.8 - Issue #4: Rollback callback stack for cascading rollback
     * Each entry contains { step, rollbackFn, snapshot }
     * @type {Array<{ step: string, rollbackFn: Function, snapshot: Object }>}
     * @private
     */
    this._rollbackCallbacks = [];

    console.log(`[MapTransactionManager] Initialized for ${mapName}`);
  }

  /**
   * Get current Map keys as array for logging
   * @returns {string[]} Array of current Map keys
   */
  getMapKeys() {
    return Array.from(this._map.keys());
  }

  /**
   * Get current Map size
   * @returns {number} Map size
   */
  getMapSize() {
    return this._map.size;
  }

  /**
   * Log a Map operation with full context
   * @private
   * @param {string} operation - Operation type
   * @param {string} targetId - ID being operated on
   * @param {string} reason - Why operation was performed
   * @param {Object} [extra] - Additional data to log
   */
  _logOperation(operation, targetId, reason, extra = {}) {
    const stackLines = new Error().stack?.split('\n') || [];

    const logData = {
      mapName: this._mapName,
      operation,
      targetId,
      reason,
      mapKeys: this.getMapKeys(),
      mapSize: this.getMapSize(),
      timestamp: Date.now(),
      stackDepth: stackLines.length,
      inTransaction: !!this._activeTransaction,
      ...extra
    };

    console.log(`[MapTransactionManager] ${operation}:`, logData);
  }

  /**
   * v1.6.4.8 - Issue #4: Register a rollback callback for cascading rollback
   * @param {string} step - Step name for logging
   * @param {Function} rollbackFn - Function to call on rollback (receives snapshot)
   * @param {Object} [snapshot] - Optional state snapshot to pass to rollbackFn
   */
  registerRollbackCallback(step, rollbackFn, snapshot = null) {
    if (typeof rollbackFn !== 'function') {
      console.warn(
        '[MapTransactionManager] registerRollbackCallback: rollbackFn must be a function'
      );
      return;
    }

    this._rollbackCallbacks.push({
      step,
      rollbackFn,
      snapshot,
      registeredAt: Date.now()
    });

    console.log('[MapTransactionManager] Registered rollback callback:', {
      step,
      totalCallbacks: this._rollbackCallbacks.length,
      hasSnapshot: !!snapshot
    });
  }

  /**
   * v1.6.4.8 - Issue #4: Execute all rollback callbacks in LIFO order
   * @param {string} failedAt - Step name where failure occurred
   * @returns {Promise<{ success: boolean, stepsRolledBack: number, errors: string[] }>}
   */
  async executeCascadingRollback(failedAt) {
    const totalSteps = this._rollbackCallbacks.length;
    if (totalSteps === 0) {
      console.log('[MapTransactionManager] No rollback callbacks registered');
      return { success: true, stepsRolledBack: 0, errors: [] };
    }

    console.log('[MapTransactionManager] ⚠️ Executing cascading rollback:', {
      failedAt,
      totalSteps
    });

    let stepsRolledBack = 0;
    const errors = [];

    // Execute in LIFO order (reverse)
    while (this._rollbackCallbacks.length > 0) {
      const { step, rollbackFn, snapshot } = this._rollbackCallbacks.pop();
      console.log('[MapTransactionManager] Rolling back step:', {
        step,
        hasSnapshot: !!snapshot,
        remainingSteps: this._rollbackCallbacks.length
      });

      try {
        await rollbackFn(snapshot);
        stepsRolledBack++;
        console.log('[MapTransactionManager] ✓ Rollback step succeeded:', { step });
      } catch (err) {
        const errorMsg = `Step '${step}' failed: ${err.message}`;
        errors.push(errorMsg);
        console.error('[MapTransactionManager] ✗ Rollback step failed:', {
          step,
          error: err.message
        });
        // Continue rolling back other steps even if one fails
      }
    }

    console.log('[MapTransactionManager] Cascading rollback complete:', {
      stepsRolledBack,
      totalSteps,
      errorCount: errors.length
    });

    return {
      success: errors.length === 0,
      stepsRolledBack,
      errors
    };
  }

  /**
   * v1.6.4.8 - Issue #4: Clear all rollback callbacks (on success)
   */
  clearRollbackCallbacks() {
    const count = this._rollbackCallbacks.length;
    this._rollbackCallbacks = [];
    if (count > 0) {
      console.log('[MapTransactionManager] Cleared rollback callbacks:', { count });
    }
  }

  /**
   * Begin a new transaction
   * Captures the current Map state for potential rollback
   * @param {string} [reason=''] - Why the transaction is being started
   * @returns {boolean} True if transaction started, false if already in transaction
   */
  beginTransaction(reason = '') {
    if (this._activeTransaction) {
      console.warn('[MapTransactionManager] Transaction already active, cannot begin new one');
      return false;
    }

    if (this._locked) {
      console.warn('[MapTransactionManager] Map is locked, cannot begin transaction');
      return false;
    }

    this._transactionCounter++;
    const transactionId = `txn-${this._transactionCounter}`;

    // Capture current state
    const snapshot = new Map();
    for (const [key, value] of this._map) {
      snapshot.set(key, value);
    }

    this._activeTransaction = {
      id: transactionId,
      entries: snapshot,
      timestamp: Date.now(),
      reason
    };

    this._stagedOperations = [];
    this._locked = true;

    console.log('[MapTransactionManager] Transaction BEGIN:', {
      transactionId,
      reason,
      snapshotSize: snapshot.size,
      snapshotKeys: Array.from(snapshot.keys())
    });

    return true;
  }

  /**
   * Delete an entry from the Map within a transaction
   * @param {string} id - Key to delete
   * @param {string} reason - Why the entry is being deleted
   * @returns {boolean} True if entry existed and was staged for deletion
   */
  deleteEntry(id, reason) {
    const sizeBefore = this._map.size;
    const hadEntry = this._map.has(id);

    if (!hadEntry) {
      this._logOperation('delete-skip', id, reason, {
        skipped: true,
        message: 'Entry does not exist'
      });
      return false;
    }

    // Perform the actual deletion
    this._map.delete(id);

    // Record operation
    this._stagedOperations.push({
      type: 'delete',
      id,
      reason,
      timestamp: Date.now()
    });

    this._logOperation('delete', id, reason, {
      sizeBefore,
      sizeAfter: this._map.size
    });

    return true;
  }

  /**
   * Set an entry in the Map within a transaction
   * @param {string} id - Key to set
   * @param {*} value - Value to set
   * @param {string} reason - Why the entry is being set
   * @returns {boolean} True if entry was staged
   */
  setEntry(id, value, reason) {
    const sizeBefore = this._map.size;
    const hadExisting = this._map.has(id);

    // Perform the actual set
    this._map.set(id, value);

    // Record operation
    this._stagedOperations.push({
      type: 'set',
      id,
      value,
      reason,
      timestamp: Date.now()
    });

    this._logOperation('set', id, reason, {
      sizeBefore,
      sizeAfter: this._map.size,
      replaced: hadExisting
    });

    return true;
  }

  /**
   * Commit the current transaction
   * Validates final state and makes changes permanent
   * @param {Object} [validation] - Optional validation config
   * @param {number} [validation.expectedSize] - Expected final Map size
   * @param {string[]} [validation.expectedKeys] - Expected keys in Map
   * @returns {{ success: boolean, error?: string }}
   */
  commitTransaction(validation = {}) {
    if (!this._activeTransaction) {
      console.warn('[MapTransactionManager] No active transaction to commit');
      return { success: false, error: 'No active transaction' };
    }

    const { expectedSize, expectedKeys } = validation;
    const transactionId = this._activeTransaction.id;

    // Validate expected size if provided
    if (typeof expectedSize === 'number' && this._map.size !== expectedSize) {
      const error = `Size mismatch: expected ${expectedSize}, got ${this._map.size}`;
      console.error('[MapTransactionManager] COMMIT FAILED:', {
        transactionId,
        error,
        mapKeys: this.getMapKeys()
      });

      // Auto-rollback on validation failure
      this.rollbackTransaction();
      return { success: false, error };
    }

    // Validate expected keys if provided
    if (expectedKeys) {
      const currentKeys = new Set(this._map.keys());
      const missingKeys = expectedKeys.filter(k => !currentKeys.has(k));

      if (missingKeys.length > 0) {
        const error = `Missing expected keys: ${missingKeys.join(', ')}`;
        console.error('[MapTransactionManager] COMMIT FAILED:', {
          transactionId,
          error,
          mapKeys: this.getMapKeys()
        });

        // Auto-rollback on validation failure
        this.rollbackTransaction();
        return { success: false, error };
      }
    }

    // Commit successful
    console.log('[MapTransactionManager] Transaction COMMIT:', {
      transactionId,
      operationsCount: this._stagedOperations.length,
      finalSize: this._map.size,
      finalKeys: this.getMapKeys()
    });

    // Clean up transaction state
    this._activeTransaction = null;
    this._stagedOperations = [];
    this._locked = false;

    // v1.6.4.8 - Issue #4: Clear rollback callbacks on successful commit
    this.clearRollbackCallbacks();

    return { success: true };
  }

  /**
   * Rollback the current transaction
   * Restores Map to state captured at beginTransaction()
   * v1.6.4.8 - Issue #4: Also executes cascading rollback callbacks
   * @returns {Promise<boolean>} True if rollback was performed
   */
  async rollbackTransaction() {
    if (!this._activeTransaction) {
      console.warn('[MapTransactionManager] No active transaction to rollback');
      return false;
    }

    const transactionId = this._activeTransaction.id;
    const snapshot = this._activeTransaction.entries;

    // Clear current Map
    this._map.clear();

    // Restore from snapshot
    for (const [key, value] of snapshot) {
      this._map.set(key, value);
    }

    // v1.6.4.8 - Issue #4: Execute cascading rollback callbacks
    const rollbackResult = await this.executeCascadingRollback(transactionId);

    console.log('[MapTransactionManager] Transaction ROLLBACK:', {
      transactionId,
      restoredSize: this._map.size,
      restoredKeys: this.getMapKeys(),
      droppedOperations: this._stagedOperations.length,
      cascadingRollback: rollbackResult
    });

    // Clean up transaction state
    this._activeTransaction = null;
    this._stagedOperations = [];
    this._locked = false;

    return true;
  }

  /**
   * Check if a transaction is currently active
   * @returns {boolean}
   */
  isInTransaction() {
    return !!this._activeTransaction;
  }

  /**
   * Get the current transaction ID
   * @returns {string|null}
   */
  getTransactionId() {
    return this._activeTransaction?.id || null;
  }

  /**
   * Get staged operations for current transaction
   * @returns {MapOperation[]}
   */
  getStagedOperations() {
    return [...this._stagedOperations];
  }

  /**
   * Perform a delete operation without transaction (direct mode)
   * Use only when atomicity is not required
   * @param {string} id - Key to delete
   * @param {string} reason - Why the entry is being deleted
   * @returns {boolean} True if entry was deleted
   */
  directDelete(id, reason) {
    if (this._locked) {
      console.warn(
        '[MapTransactionManager] Map is locked (transaction in progress), use deleteEntry instead'
      );
      return false;
    }

    const sizeBefore = this._map.size;
    const hadEntry = this._map.has(id);

    if (!hadEntry) {
      this._logOperation('direct-delete-skip', id, reason, {
        skipped: true,
        message: 'Entry does not exist'
      });
      return false;
    }

    this._map.delete(id);

    this._logOperation('direct-delete', id, reason, {
      sizeBefore,
      sizeAfter: this._map.size
    });

    return true;
  }

  /**
   * Perform a set operation without transaction (direct mode)
   * Use only when atomicity is not required
   * @param {string} id - Key to set
   * @param {*} value - Value to set
   * @param {string} reason - Why the entry is being set
   * @returns {boolean} True if entry was set
   */
  directSet(id, value, reason) {
    if (this._locked) {
      console.warn(
        '[MapTransactionManager] Map is locked (transaction in progress), use setEntry instead'
      );
      return false;
    }

    const sizeBefore = this._map.size;
    const hadExisting = this._map.has(id);

    this._map.set(id, value);

    this._logOperation('direct-set', id, reason, {
      sizeBefore,
      sizeAfter: this._map.size,
      replaced: hadExisting
    });

    return true;
  }

  /**
   * Perform a clear operation without transaction (direct mode)
   * Use only when atomicity is not required
   * @param {string} reason - Why the Map is being cleared
   * @param {boolean} [userInitiated=false] - Whether user explicitly initiated the clear
   * @returns {boolean} True if Map was cleared
   */
  directClear(reason, userInitiated = false) {
    if (this._locked) {
      console.warn('[MapTransactionManager] Map is locked (transaction in progress), cannot clear');
      return false;
    }

    const sizeBefore = this._map.size;
    const clearedKeys = this.getMapKeys();

    this._map.clear();

    console.log('[MapTransactionManager] direct-clear:', {
      mapName: this._mapName,
      reason,
      userInitiated,
      sizeBefore,
      clearedKeys,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Check if Map has an entry
   * @param {string} id - Key to check
   * @returns {boolean}
   */
  has(id) {
    return this._map.has(id);
  }

  /**
   * Get an entry from the Map
   * @param {string} id - Key to get
   * @returns {*} Value or undefined
   */
  get(id) {
    return this._map.get(id);
  }

  /**
   * Get transaction statistics
   * @returns {Object}
   */
  getStats() {
    return {
      mapName: this._mapName,
      mapSize: this._map.size,
      inTransaction: this.isInTransaction(),
      transactionId: this.getTransactionId(),
      stagedOperationsCount: this._stagedOperations.length,
      totalTransactions: this._transactionCounter,
      locked: this._locked,
      // v1.6.4.8 - Issue #4: Include rollback callback count
      pendingRollbackCallbacks: this._rollbackCallbacks.length
    };
  }
}
