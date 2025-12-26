/**
 * MessageRouter - Routes runtime.onMessage calls to appropriate handlers
 *
 * Reduces the monolithic message handler from 628 lines (cc=93) to a simple
 * routing table pattern. Each handler is responsible for one domain of operations.
 *
 * Pattern: Command Pattern + Registry
 * - Handlers register for specific action types
 * - Router validates sender and routes to handler
 * - Handlers return promises for async operations
 *
 * v1.6.4.14 - FIX Issue #18: Support both `action` and `type` message properties
 * v1.6.4.15 - FIX Issue #18 (Diagnostic): Add allowlist of valid command types
 * v1.6.4.15 - FIX Issue #22: Add response format validation and normalization
 */

// v1.6.4.15 - FIX Issue #18: Allowlist of valid command types for validation
// This serves as documentation and validation for the message protocol
export const VALID_MESSAGE_ACTIONS = new Set([
  // Quick Tab CRUD operations
  'CREATE_QUICK_TAB',
  'CLOSE_QUICK_TAB',
  'UPDATE_QUICK_TAB_POSITION',
  'UPDATE_QUICK_TAB_POSITION_FINAL',
  'UPDATE_QUICK_TAB_SIZE',
  'UPDATE_QUICK_TAB_SIZE_FINAL',
  'UPDATE_QUICK_TAB_PIN',
  // v1.6.3.11-v12 - Removed UPDATE_QUICK_TAB_SOLO and UPDATE_QUICK_TAB_MUTE (Solo/Mute feature removed)
  'UPDATE_QUICK_TAB_MINIMIZE',
  'UPDATE_QUICK_TAB_ZINDEX',
  'BATCH_QUICK_TAB_UPDATE',
  // State retrieval
  'GET_CURRENT_TAB_ID',
  'GET_CONTAINER_CONTEXT',
  'GET_QUICK_TABS_STATE',
  // Tab operations
  'SWITCH_TO_TAB',
  'COPY_URL',
  'COPY_URL_FORMAT',
  // Log operations
  'GET_BACKGROUND_LOGS',
  'GET_ALL_LOGS',
  'CLEAR_ALL_LOGS',
  // Tab management
  'GET_TABS',
  'SWITCH_TAB',
  // Keepalive
  'KEEPALIVE_PING'
]);

// v1.6.4.15 - FIX Issue #22: Standard response envelope format
// All handlers should return responses in this format for consistency
export const RESPONSE_ENVELOPE = {
  SUCCESS: data => ({ success: true, data }),
  ERROR: (error, code = 'UNKNOWN_ERROR') => ({ success: false, error: String(error), code })
};

// v1.6.4.15 - FIX Issue #22: Protocol version for future compatibility
export const MESSAGE_PROTOCOL_VERSION = '1.0.0';

export class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.extensionId = null;
    // v1.6.4.15 - FIX Issue #18: Track rejected commands for diagnostics
    this._rejectedCommandCount = 0;
    this._lastRejectedCommand = null;
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
   * Extract the action identifier from message
   * v1.6.4.14 - FIX Issue #18: Support both `action` and `type` properties
   * @private
   * @param {Object} message - Message object
   * @returns {string|null} Action identifier or null
   */
  _extractAction(message) {
    if (!message) return null;

    // Prefer `action` property (standard)
    if (typeof message.action === 'string') {
      return message.action;
    }

    // Fall back to `type` property for type-based messages
    // v1.6.4.14 - FIX Issue #18: Some handlers use `type` instead of `action`
    if (typeof message.type === 'string') {
      return message.type;
    }

    return null;
  }

  /**
   * Check if message should be deferred to other browser.runtime.onMessage listeners
   * v1.6.4.14 - FIX Issue #18: Allow type-based messages to pass through
   *
   * The MessageRouter handles action-based messages, but some messages use
   * `type` property instead of `action`. These type-based messages are handled
   * by separate runtime.onMessage listeners (added in background.js):
   * - QUICK_TAB_STATE_CHANGE: Handled by handleQuickTabStateChange()
   * - MANAGER_COMMAND: Handled by handleManagerCommand()
   * - REQUEST_FULL_STATE_SYNC: Handled by handleFullStateSyncRequest()
   *
   * @private
   * @param {Object} message - Message to check
   * @returns {boolean} True if message should be handled by other listeners
   */
  _shouldDeferToOtherListeners(message) {
    // Messages with `type` (not `action`) are handled by other listeners
    const isTypeBasedMessage =
      typeof message.type === 'string' && typeof message.action !== 'string';
    return isTypeBasedMessage;
  }

  /**
   * Validate that an action is in the allowlist of valid commands
   * v1.6.4.15 - FIX Issue #18: Validate against allowlist
   * @private
   * @param {string} action - Action to validate
   * @param {Object} sender - Message sender for logging
   * @returns {{valid: boolean, reason?: string}}
   */
  _validateAction(action, sender) {
    // Check if action is in the allowlist
    if (!VALID_MESSAGE_ACTIONS.has(action)) {
      // Log rejected command with context
      this._rejectedCommandCount++;
      this._lastRejectedCommand = { action, timestamp: Date.now() };

      console.warn('[MSG][MessageRouter] UNKNOWN_COMMAND rejected:', {
        command: action,
        senderTabId: sender?.tab?.id ?? 'unknown',
        senderFrameId: sender?.frameId ?? 'unknown',
        senderUrl: sender?.url ?? 'unknown',
        reason: 'Action not in VALID_MESSAGE_ACTIONS allowlist',
        totalRejected: this._rejectedCommandCount
      });

      return { valid: false, reason: `Unknown command: ${action}` };
    }

    return { valid: true };
  }

  /**
   * Validate and normalize response format
   * v1.6.4.15 - FIX Issue #22: Ensure consistent response envelope
   * @private
   * @param {*} response - Raw handler response
   * @param {string} action - Action that generated the response
   * @returns {Object} Normalized response object
   */
  _normalizeResponse(response, action) {
    // Handle null/undefined responses
    if (response === null || response === undefined) {
      console.warn('[MSG_VALIDATE][MessageRouter] Handler returned null/undefined:', {
        action,
        responseType: response === null ? 'null' : 'undefined'
      });
      return { success: true, data: null };
    }

    // Response already has success property - validate format
    if (typeof response === 'object' && 'success' in response) {
      // Validate required fields based on success/failure
      if (response.success === false && !response.error) {
        console.warn('[MSG_VALIDATE][MessageRouter] Error response missing error field:', {
          action,
          response
        });
        // Add default error if missing
        return { ...response, error: 'Unknown error', code: response.code || 'UNKNOWN_ERROR' };
      }

      // Response is valid format
      return response;
    }

    // Response is raw data - wrap in success envelope
    return { success: true, data: response };
  }

  /**
   * Handle case when no handler exists for action
   * v1.6.3.11-v11 - FIX Issue 48 #3: Extracted to reduce route() complexity
   * @private
   * @param {Object} message - Message object
   * @param {string} action - Extracted action
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if message was handled (deferred to other listeners returns false)
   */
  _handleNoHandler(message, action, sender, sendResponse) {
    // v1.6.4.14 - FIX Issue #18: Check if this message should be handled by other listeners
    if (this._shouldDeferToOtherListeners(message)) {
      return false;
    }

    // v1.6.4.15 - FIX Issue #18: Validate against allowlist and log rejection
    const validation = this._validateAction(action, sender);
    if (!validation.valid) {
      sendResponse({
        success: false,
        error: 'UNKNOWN_COMMAND',
        command: action,
        code: 'UNKNOWN_COMMAND',
        version: MESSAGE_PROTOCOL_VERSION
      });
      return true;
    }

    console.warn(`[MSG][MessageRouter] No handler for action: ${action}`);
    sendResponse({ success: false, error: `Unknown action: ${action}`, code: 'NO_HANDLER' });
    return true;
  }

  /**
   * Execute handler and send response
   * v1.6.3.11-v11 - FIX Issue 48 #3: Extracted to reduce route() complexity
   * @private
   */
  async _executeHandler(handler, message, sender, sendResponse, action, routeStartTime) {
    // v1.6.3.11-v11 - FIX Issue 48 #3: Log handler execution start
    console.log(`[MSG_HANDLER] Handler for ${action} executing`, {
      senderTabId: sender?.tab?.id ?? 'unknown',
      timestamp: new Date().toISOString()
    });

    // Call handler and wait for result
    const result = await handler(message, sender);

    // v1.6.4.15 - FIX Issue #22: Normalize response format
    const normalizedResponse = this._normalizeResponse(result, action);

    // v1.6.3.11-v11 - FIX Issue 48 #3: Log handler result
    const routeDurationMs = Date.now() - routeStartTime;
    console.log(`[MSG_HANDLER] Handler returned: success=${normalizedResponse.success}`, {
      action,
      durationMs: routeDurationMs,
      hasData: normalizedResponse.data !== undefined && normalizedResponse.data !== null
    });

    // Send response
    if (sendResponse) {
      sendResponse(normalizedResponse);
    }
  }

  /**
   * Route message to appropriate handler
   * v1.6.4.14 - FIX Issue #18: Support both `action` and `type` message properties
   * v1.6.4.15 - FIX Issue #18: Validate against allowlist of valid actions
   * v1.6.4.15 - FIX Issue #22: Normalize response format
   * v1.6.3.11-v11 - FIX Issue 48 #3: Enhanced message routing diagnostics
   * @param {Object} message - Message object with action or type property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    // v1.6.4.14 - Extract action from either `action` or `type` property
    const action = this._extractAction(message);
    const routeStartTime = Date.now();

    // Validate message format - must have either action or type
    if (!action) {
      console.error('[MSG][MessageRouter] Invalid message format (missing action/type):', message);
      sendResponse({
        success: false,
        error: 'Invalid message format',
        code: 'INVALID_MESSAGE_FORMAT'
      });
      return false;
    }

    // v1.6.3.11-v11 - FIX Issue 48 #3: Log message received after validation
    console.log(`[MSG_ROUTER] Message received: action=${action}`, {
      senderTabId: sender?.tab?.id ?? 'unknown',
      senderFrameId: sender?.frameId ?? 'unknown',
      hasHandler: this.handlers.has(action),
      timestamp: new Date().toISOString()
    });

    const handler = this.handlers.get(action);

    if (!handler) {
      // v1.6.3.11-v11 - FIX Code Review: Simplified boolean return
      return this._handleNoHandler(message, action, sender, sendResponse);
    }

    try {
      await this._executeHandler(handler, message, sender, sendResponse, action, routeStartTime);
      return true; // Keep channel open for async response
    } catch (error) {
      // v1.6.3.11-v11 - FIX Issue 48 #3: Log handler error with details
      const routeDurationMs = Date.now() - routeStartTime;
      console.error('[MSG_HANDLER] Handler returned: success=false', {
        action,
        error: error.message,
        durationMs: routeDurationMs
      });

      if (sendResponse) {
        sendResponse({
          success: false,
          error: error.message || 'Handler execution failed',
          code: 'HANDLER_ERROR'
        });
      }

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
