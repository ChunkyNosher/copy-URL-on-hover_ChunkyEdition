/**
 * CircuitBreaker - Runaway Process Detection (Layer 5)
 * Automatically stops operations if thresholds exceeded
 *
 * v1.6.2.1 - NEW: Memory leak prevention layer
 *
 * States:
 * - CLOSED: Normal operation
 * - OPEN: Operations rejected, waiting for reset
 * - HALF_OPEN: Testing recovery with single operation
 *
 * @version 1.6.2.1
 */

export class CircuitBreaker {
  // State constants
  static STATES = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
  };

  // Timing constants
  static OPERATION_WINDOW_MS = 1000; // Reset operation count every second
  static WARNING_THROTTLE_MS = 5000; // Log warnings max once per 5 seconds

  /**
   * @param {string} name - Circuit breaker name for logging
   * @param {Object} options - Configuration options
   * @param {number} options.maxOperationsPerSecond - Max operations per second (default: 100)
   * @param {number} options.maxFailures - Failures before opening circuit (default: 10)
   * @param {number} options.resetTimeout - Time in ms before attempting recovery (default: 60000)
   */
  constructor(name, options = {}) {
    this.name = name;
    this.maxOperationsPerSecond = options.maxOperationsPerSecond || 100;
    this.maxFailures = options.maxFailures || 10;
    this.resetTimeout = options.resetTimeout || 60000; // 60 seconds

    // State
    this.state = CircuitBreaker.STATES.CLOSED;
    this.failureCount = 0;
    this.operationCount = 0;
    this.lastReset = Date.now();
    this.lastWarning = 0;
    this.openedAt = null;
  }

  /**
   * Execute operation with circuit breaker protection
   * @param {Function} operation - Async function to execute
   * @returns {Promise<any>} - Operation result or throws if circuit open
   */
  async execute(operation) {
    this._checkCircuitState();
    this._updateOperationCounter();
    this._checkOperationRate();

    return this._executeWithTracking(operation);
  }

  /**
   * Check and potentially update circuit state
   * @private
   * @throws {Error} if circuit is open
   */
  _checkCircuitState() {
    if (this.state !== CircuitBreaker.STATES.OPEN) {
      return;
    }

    // Check if reset timeout has passed
    if (Date.now() - this.openedAt > this.resetTimeout) {
      this.state = CircuitBreaker.STATES.HALF_OPEN;
      this.failureCount = 0;
      console.log(`[CircuitBreaker:${this.name}] Entering HALF_OPEN state`);
    } else {
      throw new Error(`CircuitBreaker:${this.name} is OPEN - operation rejected`);
    }
  }

  /**
   * Update operation counter with per-second reset
   * @private
   */
  _updateOperationCounter() {
    const now = Date.now();
    if (now - this.lastReset > CircuitBreaker.OPERATION_WINDOW_MS) {
      this.operationCount = 0;
      this.lastReset = now;
    }
    this.operationCount++;
  }

  /**
   * Check if operation rate exceeded thresholds
   * @private
   * @throws {Error} if rate exceeds 10x threshold
   */
  _checkOperationRate() {
    if (this.operationCount <= this.maxOperationsPerSecond) {
      return;
    }

    const now = Date.now();
    if (now - this.lastWarning > CircuitBreaker.WARNING_THROTTLE_MS) {
      console.warn(
        `[CircuitBreaker:${this.name}] Operation rate exceeded: ${this.operationCount}/sec`
      );
      this.lastWarning = now;
    }

    // Open circuit if rate VERY high (10x threshold)
    if (this.operationCount > this.maxOperationsPerSecond * 10) {
      this._openCircuit('Operation rate exceeded 10x threshold');
      throw new Error(`CircuitBreaker:${this.name} is OPEN due to excessive operations`);
    }
  }

  /**
   * Execute operation and track success/failure
   * @private
   * @param {Function} operation - Async function to execute
   * @returns {Promise<any>} - Operation result
   */
  async _executeWithTracking(operation) {
    try {
      const result = await operation();
      this._handleSuccess();
      return result;
    } catch (err) {
      this._handleFailure();
      throw err;
    }
  }

  /**
   * Handle successful operation
   * @private
   */
  _handleSuccess() {
    if (this.state === CircuitBreaker.STATES.HALF_OPEN) {
      this.state = CircuitBreaker.STATES.CLOSED;
      this.failureCount = 0;
      console.log(`[CircuitBreaker:${this.name}] Returning to CLOSED state`);
    }
  }

  /**
   * Handle failed operation
   * @private
   */
  _handleFailure() {
    this.failureCount++;
    if (this.failureCount >= this.maxFailures) {
      this._openCircuit(`Failure threshold reached: ${this.failureCount} failures`);
    }
  }

  /**
   * Open the circuit breaker
   * @private
   * @param {string} reason - Reason for opening
   */
  _openCircuit(reason) {
    this.state = CircuitBreaker.STATES.OPEN;
    this.openedAt = Date.now();
    console.error(`[CircuitBreaker:${this.name}] Circuit OPENED: ${reason}`);

    // Emit event for monitoring
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('circuit-breaker-open', {
          detail: { name: this.name, reason }
        })
      );
    }
  }

  /**
   * Get current circuit breaker state
   * @returns {Object} - State information
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      operationCount: this.operationCount,
      openedAt: this.openedAt
    };
  }

  /**
   * Reset the circuit breaker to closed state
   * For manual recovery
   */
  reset() {
    this.state = CircuitBreaker.STATES.CLOSED;
    this.failureCount = 0;
    this.operationCount = 0;
    this.openedAt = null;
    console.log(`[CircuitBreaker:${this.name}] Manually reset to CLOSED state`);
  }

  /**
   * Check if circuit is open (operations blocked)
   * @returns {boolean}
   */
  isOpen() {
    return this.state === CircuitBreaker.STATES.OPEN;
  }

  /**
   * Check if circuit is closed (normal operation)
   * @returns {boolean}
   */
  isClosed() {
    return this.state === CircuitBreaker.STATES.CLOSED;
  }
}
