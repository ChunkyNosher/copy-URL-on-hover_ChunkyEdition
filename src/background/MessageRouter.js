/**
 * MessageRouter - Routes runtime.onMessage calls to appropriate handlers
 * v1.6.3.8-v2 - Issue #7: Enhanced with standardized response shapes and requestId support
 * v1.6.3.8-v3 - Issue #11: Handler timeout with graceful degradation (5000ms)
 * v1.6.3.8-v14 - GAP-16 DECISION: KEEP MessageRouter (Active in production)
 *
 * ===============================================================================
 * GAP-16 ARCHITECTURAL DECISION
 * ===============================================================================
 * This file IS ACTIVELY USED in the production architecture:
 * - background.js imports and instantiates MessageRouter (line 19, 5065)
 * - background.js registers 21+ handlers via messageRouter.register()
 * - chrome.runtime.onMessage uses messageRouter.createListener() (line 5248)
 *
 * RELATIONSHIP TO message-handler.js:
 * - message-handler.js is part of the v2 Quick Tabs architecture (schema-v2.js)
 * - message-handler.js uses MESSAGE_TYPES from message-router.js (different file!)
 * - These are SEPARATE systems: MessageRouter handles legacy/action-based routing,
 *   while message-handler.js handles v2 Quick Tabs state sync messages
 *
 * DO NOT DELETE THIS FILE - it is actively used in the codebase.
 * ===============================================================================
 *
 * Reduces the monolithic message handler from 628 lines (cc=93) to a simple
 * routing table pattern. Each handler is responsible for one domain of operations.
 *
 * Pattern: Command Pattern + Registry
 * - Handlers register for specific action types
 * - Router validates sender and routes to handler
 * - Handlers return promises for async operations
 *
 * v1.6.3.8-v2 Changes:
 * - Standardized response shape: { success, data?, error?, requestId? }
 * - Echo requestId from incoming messages for ACK correlation
 * - Log MESSAGE_ACK_RECEIVED events
 *
 * v1.6.3.8-v3 Changes:
 * - Issue #11: Wrap handler executions in 5000ms timeout using Promise.race
 * - Log HANDLER_TIMEOUT when handler exceeds timeout
 * - Log HANDLER_COMPLETED with execution time for successful handlers
 */

// Debug flag for message routing logs
const DEBUG_ROUTING = true;

// v1.6.3.8-v3 - Issue #11: Handler timeout constant
const HANDLER_TIMEOUT_MS = 5000;

export class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.extensionId = null;
  }

  /**
   * Register a handler for specific message action(s)
   * @param {string|string[]} actions - Action type(s) to handle
   * @param {Function} handler - Handler function (message, sender) => Promise<any>
   */
  register(actions, handler) {
    const actionList = Array.isArray(actions) ? actions : [actions];

    for (const action of actionList) {
      if (this.handlers.has(action)) {
        console.warn(`[MessageRouter] Overwriting handler for action: ${action}`);
      }
      this.handlers.set(action, handler);
    }
  }

  /**
   * Set extension ID for sender validation
   * @param {string} extensionId - Extension ID from runtime.id
   */
  setExtensionId(extensionId) {
    this.extensionId = extensionId;
  }

  /**
   * Validate sender is from this extension
   * @param {Object} sender - Message sender
   * @returns {boolean}
   */
  isAuthorizedSender(sender) {
    if (!sender || !sender.id) {
      return false;
    }

    if (!this.extensionId) {
      console.warn('[MessageRouter] Extension ID not set - defaulting to optimistic validation');
      return true;
    }

    return sender.id === this.extensionId;
  }

  /**
   * Normalize handler result to standardized response shape
   * v1.6.3.8-v2 - Issue #7: Enforce { success, data?, error?, requestId? }
   * @private
   * @param {any} result - Handler result
   * @param {string|null} requestId - Request ID to include
   * @returns {Object} Standardized response
   */
  _normalizeResponse(result, requestId) {
    // Handle null/undefined
    if (result === null || result === undefined) {
      return { success: true, requestId, timestamp: Date.now() };
    }

    // Handle primitive results
    if (typeof result !== 'object') {
      return { success: true, data: result, requestId, timestamp: Date.now() };
    }

    // Already has success field - augment with requestId
    if (typeof result.success === 'boolean') {
      return {
        ...result,
        requestId: result.requestId || requestId,
        timestamp: result.timestamp || Date.now()
      };
    }

    // Handle error objects
    if (result.error) {
      return {
        success: false,
        error: result.error,
        data: result,
        requestId,
        timestamp: Date.now()
      };
    }

    // Wrap other objects as success
    return { success: true, data: result, requestId, timestamp: Date.now() };
  }

  /**
   * Handle invalid message format
   * v1.6.3.8-v2 - Extracted for complexity reduction
   * @private
   */
  _handleInvalidMessage(message, sendResponse, requestId) {
    console.error('[MessageRouter] Invalid message format:', message);
    sendResponse(
      this._normalizeResponse({ success: false, error: 'Invalid message format' }, requestId)
    );
    return false;
  }

  /**
   * Handle unknown action
   * v1.6.3.8-v2 - Extracted for complexity reduction
   * @private
   */
  _handleUnknownAction(action, sendResponse, requestId) {
    console.warn(`[MessageRouter] No handler for action: ${action}`);
    sendResponse(
      this._normalizeResponse({ success: false, error: `Unknown action: ${action}` }, requestId)
    );
    return false;
  }

  /**
   * Log successful message acknowledgment
   * v1.6.3.8-v2 - Extracted for complexity reduction
   * @private
   */
  _logAck(requestId, action, success, durationMs) {
    if (!DEBUG_ROUTING || !requestId) return;
    console.log('[MessageRouter] MESSAGE_ACK_RECEIVED:', {
      requestId,
      action,
      success,
      durationMs,
      timestamp: Date.now()
    });
  }

  /**
   * Log handler timeout event
   * v1.6.3.8-v3 - Issue #11: Log when handler exceeds timeout
   * @private
   */
  _logHandlerTimeout(action, requestId, durationMs) {
    if (!DEBUG_ROUTING) return;
    console.error('[MessageRouter] HANDLER_TIMEOUT:', {
      action,
      requestId,
      durationMs,
      timeoutMs: HANDLER_TIMEOUT_MS,
      timestamp: Date.now()
    });
  }

  /**
   * Log handler completed event
   * v1.6.3.8-v3 - Issue #11: Log successful handler completion with timing
   * @private
   */
  _logHandlerCompleted(action, requestId, durationMs) {
    if (!DEBUG_ROUTING) return;
    console.log('[MessageRouter] HANDLER_COMPLETED:', {
      action,
      requestId,
      durationMs,
      timestamp: Date.now()
    });
  }

  /**
   * Create timeout promise for handler execution
   * v1.6.3.8-v3 - Issue #11: Graceful degradation when handler hangs
   * @private
   */
  _createHandlerTimeout(action, timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`Handler timeout after ${timeoutMs}ms`);
        error.code = 'HANDLER_TIMEOUT';
        error.action = action;
        reject(error);
      }, timeoutMs);
    });
  }

  /**
   * Handle successful handler execution
   * v1.6.3.8-v3 - Issue #11: Extracted to reduce route() complexity
   * @private
   */
  _handleSuccessfulExecution(message, requestId, result, startTime, sendResponse) {
    const durationMs = Date.now() - startTime;
    const normalizedResponse = this._normalizeResponse(result, requestId);

    if (sendResponse) sendResponse(normalizedResponse);

    // v1.6.3.8-v3 - Issue #11: Log HANDLER_COMPLETED with execution time
    this._logHandlerCompleted(message.action, requestId, durationMs);
    this._logAck(requestId, message.action, normalizedResponse.success, durationMs);

    return true;
  }

  /**
   * Handle handler timeout error
   * v1.6.3.8-v3 - Issue #11: Extracted to reduce route() max-depth
   * @private
   */
  _handleTimeoutError(message, requestId, durationMs, sendResponse) {
    this._logHandlerTimeout(message.action, requestId, durationMs);
    const timeoutResponse = this._normalizeResponse(
      {
        success: false,
        error: 'HANDLER_TIMEOUT'
      },
      requestId
    );
    if (sendResponse) sendResponse(timeoutResponse);
    return true;
  }

  /**
   * Handle general handler error
   * v1.6.3.8-v3 - Issue #11: Extracted to reduce route() complexity
   * @private
   */
  _handleGeneralError(message, requestId, error, sendResponse) {
    console.error(`[MessageRouter] Handler error for ${message.action}:`, error);
    const errorResponse = this._normalizeResponse(
      {
        success: false,
        error: error.message || 'Handler execution failed'
      },
      requestId
    );
    if (sendResponse) sendResponse(errorResponse);
    return true;
  }

  /**
   * Route message to appropriate handler
   * v1.6.3.8-v2 - Issue #7: Enhanced with requestId echo and standardized responses
   * v1.6.3.8-v3 - Issue #11: Wrap handler execution in 5000ms timeout using Promise.race
   * @param {Object} message - Message object with action property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    const startTime = Date.now();
    const requestId = message?.requestId || null;

    // Validate message format
    if (!message || typeof message.action !== 'string') {
      return this._handleInvalidMessage(message, sendResponse, requestId);
    }

    const handler = this.handlers.get(message.action);
    if (!handler) {
      return this._handleUnknownAction(message.action, sendResponse, requestId);
    }

    try {
      // v1.6.3.8-v3 - Issue #11: Wrap handler execution in timeout using Promise.race
      const result = await Promise.race([
        handler(message, sender),
        this._createHandlerTimeout(message.action, HANDLER_TIMEOUT_MS)
      ]);

      return this._handleSuccessfulExecution(message, requestId, result, startTime, sendResponse);
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // v1.6.3.8-v3 - Issue #11: Check if this is a timeout error
      if (error.code === 'HANDLER_TIMEOUT') {
        return this._handleTimeoutError(message, requestId, durationMs, sendResponse);
      }

      return this._handleGeneralError(message, requestId, error, sendResponse);
    }
  }

  /**
   * Create browser runtime listener
   * @returns {Function} Listener function for chrome.runtime.onMessage
   */
  createListener() {
    return (message, sender, sendResponse) => {
      this.route(message, sender, sendResponse);
      return true; // Keep channel open for async responses
    };
  }
}
