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
 * v1.6.3.12-v7 - FIX Issue #18: Support both `action` and `type` message properties
 * v1.6.3.12-v7 - FIX Issue #18 (Diagnostic): Add allowlist of valid command types
 * v1.6.3.12-v7 - FIX Issue #22: Add response format validation and normalization
 * v1.6.3.12-v7 - FIX Issue #24: Add centralized message schema validation
 */

// v1.6.3.12-v7 - FIX Issue #18: Allowlist of valid command types for validation
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

// v1.6.3.12-v7 - FIX Issue #24: Valid type-based message types (handled by separate listeners)
// These are NOT handled by MessageRouter but are valid extension messages
export const VALID_MESSAGE_TYPES = new Set([
  // Port-based messages (handled via runtime.connect ports)
  'SIDEBAR_READY',
  'SIDEBAR_STATE_SYNC',
  'GET_ALL_QUICK_TABS',
  'GET_ALL_QUICK_TABS_RESPONSE',
  'STATE_CHANGED',
  'CLOSE_QUICK_TAB',
  'MINIMIZE_QUICK_TAB',
  'RESTORE_QUICK_TAB',
  'CLOSE_ALL_QUICK_TABS',
  'CLOSE_QUICK_TAB_ACK',
  'MINIMIZE_QUICK_TAB_ACK',
  'RESTORE_QUICK_TAB_ACK',
  'CLOSE_ALL_QUICK_TABS_ACK',
  'ORIGIN_TAB_CLOSED',
  'QUICKTAB_MINIMIZED',
  'HYDRATE_ON_LOAD',
  'QUERY_MY_QUICK_TABS',
  'CREATE_QUICK_TAB',
  'DELETE_QUICK_TAB',
  'UPDATE_QUICK_TAB',
  // Legacy runtime.sendMessage types (handled by other listeners)
  'QUICK_TAB_STATE_CHANGE',
  'MANAGER_COMMAND',
  'REQUEST_FULL_STATE_SYNC',
  'ADOPT_TAB'
]);

// v1.6.3.12-v7 - FIX Issue #22: Standard response envelope format
// All handlers should return responses in this format for consistency
export const RESPONSE_ENVELOPE = {
  SUCCESS: data => ({ success: true, data }),
  ERROR: (error, code = 'UNKNOWN_ERROR') => ({ success: false, error: String(error), code })
};

// v1.6.3.12-v7 - FIX Issue #22: Protocol version for future compatibility
export const MESSAGE_PROTOCOL_VERSION = '1.0.0';

// v1.6.3.12-v7 - FIX Issue #24: Message schema validation error codes
export const VALIDATION_ERROR_CODES = {
  INVALID_MESSAGE_FORMAT: 'INVALID_MESSAGE_FORMAT',
  MISSING_ACTION_AND_TYPE: 'MISSING_ACTION_AND_TYPE',
  AMBIGUOUS_MESSAGE: 'AMBIGUOUS_MESSAGE',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  INVALID_MESSAGE_OBJECT: 'INVALID_MESSAGE_OBJECT'
};

export class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.extensionId = null;
    // v1.6.3.12-v7 - FIX Issue #18: Track rejected commands for diagnostics
    this._rejectedCommandCount = 0;
    this._lastRejectedCommand = null;
    // v1.6.3.12-v7 - FIX Issue #24: Track validation failures for diagnostics
    this._validationFailureCount = 0;
    this._lastValidationFailure = null;
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
   * Check if message is a valid object
   * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce validateMessageSchema complexity
   * @private
   * @param {*} message - Message to check
   * @param {Object} sender - Message sender for logging
   * @returns {{ valid: boolean, error?: string, code?: string }|null} Error result or null if valid
   */
  _checkMessageIsObject(message, sender) {
    if (!message || typeof message !== 'object') {
      this._logValidationFailure(
        'INVALID_MESSAGE_OBJECT',
        message,
        sender,
        'Message is not an object'
      );
      return {
        valid: false,
        error: 'Message must be an object',
        code: VALIDATION_ERROR_CODES.INVALID_MESSAGE_OBJECT
      };
    }
    return null;
  }

  /**
   * Check for ambiguous messages with both action and type
   * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce validateMessageSchema complexity
   * @private
   * @param {boolean} hasAction - Whether message has action property
   * @param {boolean} hasType - Whether message has type property
   * @param {Object} message - The message
   * @param {Object} sender - Message sender for logging
   */
  _checkAmbiguousMessage(hasAction, hasType, message, sender) {
    if (hasAction && hasType) {
      console.warn('[MSG_SCHEMA][MessageRouter] AMBIGUOUS_MESSAGE: Both action and type present', {
        action: message.action,
        type: message.type,
        senderTabId: sender?.tab?.id ?? 'unknown',
        resolution: 'Using action property',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Validate action property value against allowlist
   * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce validateMessageSchema complexity
   * @private
   * @param {Object} message - The message
   * @param {Object} sender - Message sender for logging
   * @returns {{ valid: boolean, error?: string, code?: string }|null} Error result or null if valid
   */
  _validateActionProperty(message, sender) {
    if (!VALID_MESSAGE_ACTIONS.has(message.action)) {
      if (VALID_MESSAGE_TYPES.has(message.action)) {
        console.warn(
          '[MSG_SCHEMA][MessageRouter] PROPERTY_MISMATCH: action property contains a type value',
          {
            action: message.action,
            suggestion: 'Use type property instead of action for this message',
            senderTabId: sender?.tab?.id ?? 'unknown'
          }
        );
        return null; // Allow but log warning
      }
      this._logValidationFailure(
        'UNKNOWN_ACTION',
        message,
        sender,
        `Unknown action: ${message.action}`
      );
      return {
        valid: false,
        action: message.action,
        error: `Unknown action: ${message.action}`,
        code: VALIDATION_ERROR_CODES.UNKNOWN_ACTION
      };
    }
    return null;
  }

  /**
   * Validate type property value against allowlist
   * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce validateMessageSchema complexity
   * @private
   * @param {Object} message - The message
   * @param {Object} sender - Message sender for logging
   * @returns {{ valid: boolean, error?: string, code?: string }|null} Error result or null if valid
   */
  _validateTypeProperty(message, sender) {
    if (!VALID_MESSAGE_TYPES.has(message.type)) {
      if (VALID_MESSAGE_ACTIONS.has(message.type)) {
        console.warn(
          '[MSG_SCHEMA][MessageRouter] PROPERTY_MISMATCH: type property contains an action value',
          {
            type: message.type,
            suggestion: 'Use action property instead of type for this message',
            senderTabId: sender?.tab?.id ?? 'unknown'
          }
        );
        return null; // Allow but log warning
      }
      this._logValidationFailure('UNKNOWN_TYPE', message, sender, `Unknown type: ${message.type}`);
      return {
        valid: false,
        action: message.type,
        error: `Unknown type: ${message.type}`,
        code: VALIDATION_ERROR_CODES.UNKNOWN_TYPE
      };
    }
    return null;
  }

  /**
   * Check if neither action nor type present and return error
   * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce validateMessageSchema complexity
   * @private
   * @param {boolean} hasAction - Whether message has action property
   * @param {boolean} hasType - Whether message has type property
   * @param {Object} message - The message
   * @param {Object} sender - Message sender for logging
   * @returns {{ valid: boolean, error: string, code: string }|null} Error result or null if valid
   */
  _checkMissingActionAndType(hasAction, hasType, message, sender) {
    if (!hasAction && !hasType) {
      this._logValidationFailure(
        'MISSING_ACTION_AND_TYPE',
        message,
        sender,
        'Message missing both action and type properties'
      );
      return {
        valid: false,
        error: 'Message must have either action or type property',
        code: VALIDATION_ERROR_CODES.MISSING_ACTION_AND_TYPE
      };
    }
    return null;
  }

  /**
   * Validate action or type property and return error if invalid
   * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce validateMessageSchema complexity
   * v1.6.3.12-v8 - FIX Code Health: Flatten to early returns to eliminate bumpy road
   * @private
   * @param {boolean} hasAction - Whether message has action property
   * @param {boolean} hasType - Whether message has type property
   * @param {Object} message - The message
   * @param {Object} sender - Message sender for logging
   * @returns {{ valid: boolean, action?: string, error?: string, code?: string }|null} Error result or null if valid
   */
  _validateActionOrType(hasAction, hasType, message, sender) {
    // v1.6.3.12-v8 - FIX Code Health: Early return for action validation
    if (hasAction) {
      return this._validateActionProperty(message, sender);
    }
    // v1.6.3.12-v8 - FIX Code Health: Early return for type validation
    if (hasType) {
      return this._validateTypeProperty(message, sender);
    }
    return null;
  }

  /**
   * Validate message schema - centralized validation for both action and type properties
   * v1.6.3.12-v7 - FIX Issue #24: Centralized message schema validation
   * v1.6.3.12-v7 - FIX Code Health: Refactored to reduce complexity
   * @param {Object} message - Message to validate
   * @param {Object} sender - Message sender for logging
   * @returns {{ valid: boolean, action?: string, error?: string, code?: string }}
   */
  validateMessageSchema(message, sender) {
    // Check if message is a valid object
    const objectError = this._checkMessageIsObject(message, sender);
    if (objectError) return objectError;

    const hasAction = typeof message.action === 'string' && message.action.length > 0;
    const hasType = typeof message.type === 'string' && message.type.length > 0;

    // Check for ambiguous messages (both action AND type present)
    this._checkAmbiguousMessage(hasAction, hasType, message, sender);

    // Neither action nor type present
    const missingError = this._checkMissingActionAndType(hasAction, hasType, message, sender);
    if (missingError) return missingError;

    // Validate action or type against allowlist
    const propertyError = this._validateActionOrType(hasAction, hasType, message, sender);
    if (propertyError) return propertyError;

    // Determine which property to use (action takes precedence)
    return {
      valid: true,
      action: hasAction ? message.action : message.type,
      propertyUsed: hasAction ? 'action' : 'type'
    };
  }

  /**
   * Log validation failure with details
   * v1.6.3.12-v7 - FIX Issue #24: Centralized validation failure logging
   * @private
   * @param {string} errorType - Type of validation error
   * @param {Object} message - The invalid message
   * @param {Object} sender - Message sender
   * @param {string} reason - Human-readable reason
   */
  _logValidationFailure(errorType, message, sender, reason) {
    this._validationFailureCount++;
    this._lastValidationFailure = { errorType, timestamp: Date.now() };

    console.error('[MSG_SCHEMA][MessageRouter] VALIDATION_FAILURE:', {
      errorType,
      reason,
      messageKeys: message ? Object.keys(message) : [],
      messageAction: message?.action ?? 'undefined',
      messageType: message?.type ?? 'undefined',
      senderTabId: sender?.tab?.id ?? 'unknown',
      senderFrameId: sender?.frameId ?? 'unknown',
      senderUrl: sender?.url ?? 'unknown',
      totalValidationFailures: this._validationFailureCount,
      timestamp: Date.now()
    });
  }

  /**
   * Extract the action identifier from message
   * v1.6.3.12-v7 - FIX Issue #18: Support both `action` and `type` properties
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
    // v1.6.3.12-v7 - FIX Issue #18: Some handlers use `type` instead of `action`
    if (typeof message.type === 'string') {
      return message.type;
    }

    return null;
  }

  /**
   * Check if message should be deferred to other browser.runtime.onMessage listeners
   * v1.6.3.12-v7 - FIX Issue #18: Allow type-based messages to pass through
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
   * v1.6.3.12-v7 - FIX Issue #18: Validate against allowlist
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
   * Check if response is null or undefined and return appropriate envelope
   * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce _normalizeResponse complexity
   * @private
   * @param {*} response - Raw response to check
   * @param {string} action - Action for logging
   * @returns {Object|null} Normalized response or null if response is not null/undefined
   */
  _handleNullResponse(response, action) {
    if (response !== null && response !== undefined) {
      return null;
    }
    console.warn('[MSG_VALIDATE][MessageRouter] Handler returned null/undefined:', {
      action,
      responseType: response === null ? 'null' : 'undefined'
    });
    return { success: true, data: null };
  }

  /**
   * Check if response has success property and normalize if needed
   * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce _normalizeResponse complexity
   * @private
   * @param {Object} response - Response object with success property
   * @param {string} action - Action for logging
   * @returns {Object} Normalized response
   */
  _normalizeSuccessResponse(response, action) {
    // Error response missing error field - add defaults
    if (response.success === false && !response.error) {
      console.warn('[MSG_VALIDATE][MessageRouter] Error response missing error field:', {
        action,
        response
      });
      return { ...response, error: 'Unknown error', code: response.code || 'UNKNOWN_ERROR' };
    }
    // Response is valid format
    return response;
  }

  /**
   * Validate and normalize response format
   * v1.6.3.12-v7 - FIX Issue #22: Ensure consistent response envelope
   * v1.6.3.12-v8 - FIX Code Health: Reduced cc from 9 to <9 via extraction
   * @private
   * @param {*} response - Raw handler response
   * @param {string} action - Action that generated the response
   * @returns {Object} Normalized response object
   */
  _normalizeResponse(response, action) {
    // v1.6.3.12-v8 - Handle null/undefined responses
    const nullResult = this._handleNullResponse(response, action);
    if (nullResult) return nullResult;

    // v1.6.3.12-v8 - Response already has success property - validate format
    if (typeof response === 'object' && 'success' in response) {
      return this._normalizeSuccessResponse(response, action);
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
    // v1.6.3.12-v7 - FIX Issue #18: Check if this message should be handled by other listeners
    if (this._shouldDeferToOtherListeners(message)) {
      return false;
    }

    // v1.6.3.12-v7 - FIX Issue #18: Validate against allowlist and log rejection
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
   * v1.6.3.12-v8 - FIX Code Health: Converted 6 args to options object
   * @private
   * @param {Object} options - Handler execution options
   * @param {Function} options.handler - Handler function to execute
   * @param {Object} options.message - Message object
   * @param {Object} options.sender - Message sender
   * @param {Function} options.sendResponse - Response callback
   * @param {string} options.action - Action identifier
   * @param {number} options.routeStartTime - Start timestamp for duration calculation
   */
  async _executeHandler({ handler, message, sender, sendResponse, action, routeStartTime }) {
    // v1.6.3.11-v11 - FIX Issue 48 #3: Log handler execution start
    console.log(`[MSG_HANDLER] Handler for ${action} executing`, {
      senderTabId: sender?.tab?.id ?? 'unknown',
      timestamp: new Date().toISOString()
    });

    // Call handler and wait for result
    const result = await handler(message, sender);

    // v1.6.3.12-v7 - FIX Issue #22: Normalize response format
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
   * Handle error during handler execution
   * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   * @param {Error} error - The error that occurred
   * @param {string} action - Action that failed
   * @param {number} routeStartTime - Start timestamp for duration calculation
   * @param {Function} sendResponse - Response callback
   */
  _handleExecutionError(error, action, routeStartTime, sendResponse) {
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
  }

  /**
   * Send error response for invalid schema
   * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   * @param {Object} schemaValidation - Validation result
   * @param {Function} sendResponse - Response callback
   */
  _sendSchemaErrorResponse(schemaValidation, sendResponse) {
    sendResponse({
      success: false,
      error: schemaValidation.error,
      code: schemaValidation.code,
      version: MESSAGE_PROTOCOL_VERSION
    });
  }

  /**
   * Log message routing details
   * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   * @param {string} action - Action identifier
   * @param {Object} sender - Message sender
   * @param {boolean} hasHandler - Whether handler exists
   * @param {string} propertyUsed - Which property was used (action or type)
   */
  _logMessageRouting(action, sender, hasHandler, propertyUsed) {
    console.log(`[MSG_ROUTER] Message received: action=${action}`, {
      senderTabId: sender?.tab?.id ?? 'unknown',
      senderFrameId: sender?.frameId ?? 'unknown',
      hasHandler,
      propertyUsed,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Route message to appropriate handler
   * v1.6.3.12-v7 - FIX Issue #18: Support both `action` and `type` message properties
   * v1.6.3.12-v7 - FIX Issue #18: Validate against allowlist of valid actions
   * v1.6.3.12-v7 - FIX Issue #22: Normalize response format
   * v1.6.3.11-v11 - FIX Issue 48 #3: Enhanced message routing diagnostics
   * v1.6.3.12-v7 - FIX Issue #24: Use centralized schema validation
   * v1.6.3.12-v8 - FIX Code Health: Reduced cc from 9 to <9 via extraction
   * @param {Object} message - Message object with action or type property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    const routeStartTime = Date.now();

    // v1.6.3.12-v7 - FIX Issue #24: Use centralized schema validation
    const schemaValidation = this.validateMessageSchema(message, sender);

    if (!schemaValidation.valid) {
      this._sendSchemaErrorResponse(schemaValidation, sendResponse);
      return false;
    }

    const action = schemaValidation.action;
    const handler = this.handlers.get(action);

    // v1.6.3.12-v8 - FIX Code Health: Extracted logging
    this._logMessageRouting(action, sender, !!handler, schemaValidation.propertyUsed);

    if (!handler) {
      return this._handleNoHandler(message, action, sender, sendResponse);
    }

    try {
      // v1.6.3.12-v8 - FIX Code Health: Use options object instead of 6 args
      await this._executeHandler({ handler, message, sender, sendResponse, action, routeStartTime });
      return true;
    } catch (error) {
      this._handleExecutionError(error, action, routeStartTime, sendResponse);
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
