/**
 * MessageRouter - Routes runtime.onMessage calls to appropriate handlers
 * v1.6.3.8-v2 - Issue #7: Enhanced with standardized response shapes and requestId support
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
 */

// Debug flag for message routing logs
const DEBUG_ROUTING = true;

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
      return { ...result, requestId: result.requestId || requestId, timestamp: result.timestamp || Date.now() };
    }

    // Handle error objects
    if (result.error) {
      return { success: false, error: result.error, data: result, requestId, timestamp: Date.now() };
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
    sendResponse(this._normalizeResponse({ success: false, error: 'Invalid message format' }, requestId));
    return false;
  }

  /**
   * Handle unknown action
   * v1.6.3.8-v2 - Extracted for complexity reduction
   * @private
   */
  _handleUnknownAction(action, sendResponse, requestId) {
    console.warn(`[MessageRouter] No handler for action: ${action}`);
    sendResponse(this._normalizeResponse({ success: false, error: `Unknown action: ${action}` }, requestId));
    return false;
  }

  /**
   * Log successful message acknowledgment
   * v1.6.3.8-v2 - Extracted for complexity reduction
   * @private
   */
  _logAck(requestId, action, success, durationMs) {
    if (!DEBUG_ROUTING || !requestId) return;
    console.log('[MessageRouter] MESSAGE_ACK_RECEIVED:', { requestId, action, success, durationMs, timestamp: Date.now() });
  }

  /**
   * Route message to appropriate handler
   * v1.6.3.8-v2 - Issue #7: Enhanced with requestId echo and standardized responses
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
      const result = await handler(message, sender);
      const normalizedResponse = this._normalizeResponse(result, requestId);
      if (sendResponse) sendResponse(normalizedResponse);
      this._logAck(requestId, message.action, normalizedResponse.success, Date.now() - startTime);
      return true;
    } catch (error) {
      console.error(`[MessageRouter] Handler error for ${message.action}:`, error);
      if (sendResponse) sendResponse(this._normalizeResponse({ success: false, error: error.message || 'Handler execution failed' }, requestId));
      return true;
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

