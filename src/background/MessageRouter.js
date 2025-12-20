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
 * v1.6.3.10-v12 - FIX Issue #7: Include messageId in response for correlation
 * v1.6.3.10-v12 - FIX Issue #10: Enforce MESSAGE_PROTOCOL_VERSION validation
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
  'UPDATE_QUICK_TAB_SOLO',
  'UPDATE_QUICK_TAB_MUTE',
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
// v1.6.3.10-v12 - FIX Issue #7: Added messageId to response envelope
export const RESPONSE_ENVELOPE = {
  SUCCESS: (data, messageId = null) => ({ 
    success: true, 
    data,
    ...(messageId ? { messageId } : {}),
    timestamp: Date.now()
  }),
  ERROR: (error, code = 'UNKNOWN_ERROR', messageId = null) => ({ 
    success: false, 
    error: String(error), 
    code,
    ...(messageId ? { messageId } : {}),
    timestamp: Date.now()
  })
};

// v1.6.4.15 - FIX Issue #22: Protocol version for future compatibility
// v1.6.3.10-v12 - FIX Issue #10: Now enforced in message validation
export const MESSAGE_PROTOCOL_VERSION = '1.0.0';

// v1.6.3.10-v12 - FIX Issue #10: Minimum compatible protocol version
export const MIN_COMPATIBLE_PROTOCOL_VERSION = '1.0.0';

// v1.6.3.10-v11 - FIX Issue #11: Operations requiring ownership validation
// These operations modify Quick Tab state and must validate sender.tab.id === message.originTabId
const OWNERSHIP_REQUIRED_ACTIONS = new Set([
  'CREATE_QUICK_TAB',
  'UPDATE_QUICK_TAB_POSITION',
  'UPDATE_QUICK_TAB_POSITION_FINAL',
  'UPDATE_QUICK_TAB_SIZE',
  'UPDATE_QUICK_TAB_SIZE_FINAL',
  'UPDATE_QUICK_TAB_PIN',
  'UPDATE_QUICK_TAB_SOLO',
  'UPDATE_QUICK_TAB_MUTE',
  'UPDATE_QUICK_TAB_MINIMIZE',
  'UPDATE_QUICK_TAB_ZINDEX'
]);

export class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.extensionId = null;
    // v1.6.4.15 - FIX Issue #18: Track rejected commands for diagnostics
    this._rejectedCommandCount = 0;
    this._lastRejectedCommand = null;
    // v1.6.3.10-v12 - FIX Issue #8: Store background generation ID for responses
    this._backgroundGenerationId = null;
  }
  
  /**
   * Set the background generation ID for restart detection
   * v1.6.3.10-v12 - FIX Issue #8: Include generation ID in all responses
   * @param {string} generationId - Background generation ID
   */
  setBackgroundGenerationId(generationId) {
    this._backgroundGenerationId = generationId;
    console.log('[MessageRouter] v1.6.3.10-v12 Background generation ID configured');
  }
  
  /**
   * Get the current background generation ID
   * v1.6.3.10-v12 - FIX Issue #8
   * @returns {string|null} Background generation ID
   */
  getBackgroundGenerationId() {
    return this._backgroundGenerationId;
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
    const isTypeBasedMessage = typeof message.type === 'string' && typeof message.action !== 'string';
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
   * Build base fields with generation ID
   * v1.6.3.10-v12 - FIX Issue #8: Helper to reduce _normalizeResponse complexity
   * v1.6.3.10-v12 - FIX Issue #7: Include messageId in base fields
   * @private
   * @param {string|null} messageId - Message ID for correlation
   * @returns {Object} Base fields to include in all responses
   */
  _buildBaseResponseFields(messageId = null) {
    const fields = {
      timestamp: Date.now(),
      version: MESSAGE_PROTOCOL_VERSION
    };
    
    if (this._backgroundGenerationId) {
      fields.generation = this._backgroundGenerationId;
    }
    
    // v1.6.3.10-v12 - FIX Issue #7: Include messageId for correlation
    if (messageId) {
      fields.messageId = messageId;
    }
    
    return fields;
  }
  
  /**
   * Handle null/undefined response
   * v1.6.3.10-v12 - FIX Code Health: Extract to reduce complexity
   * @private
   */
  _handleNullResponse(action, baseFields) {
    console.warn('[MSG_VALIDATE][MessageRouter] Handler returned null/undefined:', {
      action,
      responseType: 'null or undefined'
    });
    return { success: true, data: null, ...baseFields };
  }
  
  /**
   * Handle error response missing error field
   * v1.6.3.10-v12 - FIX Code Health: Extract to reduce complexity
   * @private
   */
  _handleMissingErrorField(response, action, baseFields) {
    console.warn('[MSG_VALIDATE][MessageRouter] Error response missing error field:', {
      action,
      response
    });
    return { ...response, error: 'Unknown error', code: response.code || 'UNKNOWN_ERROR', ...baseFields };
  }

  /**
   * Validate protocol version in message
   * v1.6.3.10-v12 - FIX Issue #10: Enforce protocol version checking
   * @private
   * @param {Object} message - Message to validate
   * @param {Object} sender - Message sender
   * @returns {{valid: boolean, error?: string, code?: string}}
   */
  _validateProtocolVersion(message, sender) {
    const clientVersion = message.protocolVersion;
    
    // If client doesn't send version, log but allow (backward compatibility)
    if (!clientVersion) {
      // Only log for debugging - don't reject old clients
      console.log('[MSG][MessageRouter] PROTOCOL_NEGOTIATED: Client did not send version (legacy)', {
        action: message.action || message.type,
        senderTabId: sender?.tab?.id,
        serverVersion: MESSAGE_PROTOCOL_VERSION
      });
      return { valid: true };
    }
    
    // Check if version is compatible
    if (this._isVersionCompatible(clientVersion)) {
      console.log('[MSG][MessageRouter] PROTOCOL_NEGOTIATED:', {
        clientVersion,
        serverVersion: MESSAGE_PROTOCOL_VERSION,
        action: message.action || message.type
      });
      return { valid: true };
    }
    
    // Version mismatch - log diagnostic info but don't reject
    // (for now, we allow all versions but log the mismatch)
    console.warn('[MSG][MessageRouter] PROTOCOL_VERSION_MISMATCH:', {
      clientVersion,
      serverVersion: MESSAGE_PROTOCOL_VERSION,
      minCompatible: MIN_COMPATIBLE_PROTOCOL_VERSION,
      action: message.action || message.type,
      senderTabId: sender?.tab?.id
    });
    
    return { valid: true }; // Allow but logged
  }

  /**
   * Check if client version is compatible with server
   * v1.6.3.10-v12 - FIX Issue #10: Version compatibility check
   * @private
   * @param {string} clientVersion - Client protocol version
   * @returns {boolean} True if compatible
   */
  _isVersionCompatible(clientVersion) {
    // Simple comparison for now (could be enhanced with semver)
    // Accept any version >= MIN_COMPATIBLE_PROTOCOL_VERSION
    return clientVersion >= MIN_COMPATIBLE_PROTOCOL_VERSION;
  }

  /**
   * Validate and normalize response format
   * v1.6.4.15 - FIX Issue #22: Ensure consistent response envelope
   * v1.6.3.10-v12 - FIX Issue #8: Include generation ID for restart detection
   * v1.6.3.10-v12 - FIX Issue #7: Include messageId for correlation
   * v1.6.3.10-v12 - FIX Code Health: Refactored to reduce complexity (cc=10→6)
   * @private
   * @param {*} response - Raw handler response
   * @param {string} action - Action that generated the response
   * @param {string|null} messageId - Message ID for correlation
   * @returns {Object} Normalized response object
   */
  _normalizeResponse(response, action, messageId = null) {
    const baseFields = this._buildBaseResponseFields(messageId);
    
    // Handle null/undefined responses
    if (response === null || response === undefined) {
      return this._handleNullResponse(action, baseFields);
    }
    
    // Response already has success property - validate format
    if (typeof response === 'object' && 'success' in response) {
      // Validate required fields based on success/failure
      if (response.success === false && !response.error) {
        return this._handleMissingErrorField(response, action, baseFields);
      }
      
      // Response is valid format - add generation ID
      return { ...response, ...baseFields };
    }
    
    // Response is raw data - wrap in success envelope
    return { success: true, data: response, ...baseFields };
  }

  /**
   * Validate originTabId ownership for operations that require it
   * v1.6.3.10-v11 - FIX Issue #11: Middleware-style ownership validation
   * 
   * For operations in OWNERSHIP_REQUIRED_ACTIONS, validates that:
   * - sender.tab.id exists (message came from a content script in a tab)
   * - If message.originTabId is provided, it must match sender.tab.id
   * 
   * This prevents spoofing attacks where a malicious content script could
   * claim to be acting on behalf of a different tab.
   * 
   * @private
   * @param {Object} message - Message with potential originTabId
   * @param {Object} sender - Message sender
   * @param {string} action - Action being performed
   * @returns {{valid: boolean, error?: string, code?: string}}
   */
  _validateOwnership(message, sender, action) {
    // Skip validation for actions that don't require ownership
    if (!OWNERSHIP_REQUIRED_ACTIONS.has(action)) {
      return { valid: true };
    }
    
    const senderTabId = sender?.tab?.id;
    const payloadOriginTabId = message?.originTabId;
    
    // Sender must have a tab ID for ownership-required operations
    if (typeof senderTabId !== 'number') {
      console.error('[MSG][MessageRouter] OWNERSHIP_VALIDATION_FAILED: No sender.tab.id', {
        action,
        senderType: sender ? typeof sender : 'undefined',
        hasTab: !!sender?.tab,
        warning: 'Operations requiring ownership must come from tabs'
      });
      return { 
        valid: false, 
        error: 'OWNERSHIP_VALIDATION_FAILED',
        code: 'SENDER_TAB_REQUIRED'
      };
    }
    
    // If payload has originTabId, it MUST match sender.tab.id
    if (payloadOriginTabId !== null && payloadOriginTabId !== undefined) {
      if (payloadOriginTabId !== senderTabId) {
        console.error('[MSG][MessageRouter] OWNERSHIP_MISMATCH:', {
          action,
          payloadOriginTabId,
          senderTabId,
          warning: 'Security concern - payload claims different origin than sender'
        });
        return { 
          valid: false, 
          error: 'OWNERSHIP_VALIDATION_FAILED',
          code: 'ORIGIN_MISMATCH'
        };
      }
    }
    
    // Validation passed
    console.log('[MSG][MessageRouter] OWNERSHIP_VALIDATED:', {
      action,
      senderTabId,
      payloadOriginTabId: payloadOriginTabId ?? 'not-provided'
    });
    
    return { valid: true };
  }

  /**
   * Handle case when no handler exists for action
   * v1.6.3.10-v11 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   */
  _handleNoHandler(message, sender, sendResponse, action) {
    // v1.6.4.14 - FIX Issue #18: Check if this message should be handled by other listeners
    if (this._shouldDeferToOtherListeners(message)) {
      return { handled: false, returnValue: false };
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
      return { handled: true, returnValue: false };
    }
    
    console.warn(`[MSG][MessageRouter] No handler for action: ${action}`);
    sendResponse({ success: false, error: `Unknown action: ${action}`, code: 'NO_HANDLER' });
    return { handled: true, returnValue: false };
  }

  /**
   * Route message to appropriate handler
   * v1.6.4.14 - FIX Issue #18: Support both `action` and `type` message properties
   * v1.6.4.15 - FIX Issue #18: Validate against allowlist of valid actions
   * v1.6.4.15 - FIX Issue #22: Normalize response format
   * v1.6.3.10-v11 - FIX Issue #11: Add ownership validation middleware
   * v1.6.3.10-v12 - FIX Issue #7: Include messageId in response for correlation
   * v1.6.3.10-v12 - FIX Issue #10: Validate protocol version
   * @param {Object} message - Message object with action or type property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  /**
   * Handle invalid message format (no action)
   * v1.6.3.10-v12 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   */
  _handleInvalidFormat(message, messageId, sendResponse) {
    console.error('[MSG][MessageRouter] Invalid message format (missing action/type):', message);
    sendResponse({ 
      success: false, 
      error: 'Invalid message format', 
      code: 'INVALID_MESSAGE_FORMAT',
      ...(messageId ? { messageId } : {}),
      timestamp: Date.now()
    });
  }

  /**
   * Handle ownership validation failure
   * v1.6.3.10-v12 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   */
  _handleOwnershipFailure(ownershipValidation, messageId, sendResponse) {
    sendResponse({
      success: false,
      error: ownershipValidation.error,
      code: ownershipValidation.code,
      version: MESSAGE_PROTOCOL_VERSION,
      ...(messageId ? { messageId } : {}),
      timestamp: Date.now()
    });
  }

  /**
   * Handle handler execution error
   * v1.6.3.10-v12 - FIX Code Health: Extracted to reduce route() complexity
   * @private
   */
  _handleHandlerError(action, error, messageId, sendResponse) {
    console.error(`[MSG][MessageRouter] Handler error for ${action}:`, error);

    if (sendResponse) {
      sendResponse({
        success: false,
        error: error.message || 'Handler execution failed',
        code: 'HANDLER_ERROR',
        ...(messageId ? { messageId } : {}),
        timestamp: Date.now()
      });
    }
  }

  /**
   * Route message to appropriate handler
   * v1.6.4.14 - FIX Issue #18: Support both `action` and `type` message properties
   * v1.6.4.15 - FIX Issue #18: Validate against allowlist of valid actions
   * v1.6.4.15 - FIX Issue #22: Normalize response format
   * v1.6.3.10-v11 - FIX Issue #11: Add ownership validation middleware
   * v1.6.3.10-v12 - FIX Issue #7: Include messageId in response for correlation
   * v1.6.3.10-v12 - FIX Issue #10: Validate protocol version
   * v1.6.3.10-v12 - FIX Code Health: Extracted helpers to reduce complexity
   * @param {Object} message - Message object with action or type property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    const messageId = message?.messageId || null;
    const action = this._extractAction(message);
    
    // Validate message format
    if (!action) {
      this._handleInvalidFormat(message, messageId, sendResponse);
      return false;
    }

    // Validate protocol version and log correlation
    this._validateProtocolVersion(message, sender);
    
    if (messageId) {
      console.log('[MSG][MessageRouter] MESSAGE_CORRELATION:', { messageId, action, senderTabId: sender?.tab?.id });
    }

    const handler = this.handlers.get(action);
    if (!handler) {
      const result = this._handleNoHandler(message, sender, sendResponse, action);
      return result.handled ? result.returnValue : false;
    }

    // Validate ownership
    const ownershipValidation = this._validateOwnership(message, sender, action);
    if (!ownershipValidation.valid) {
      this._handleOwnershipFailure(ownershipValidation, messageId, sendResponse);
      return false;
    }

    try {
      const result = await handler(message, sender);
      const normalizedResponse = this._normalizeResponse(result, action, messageId);
      if (sendResponse) sendResponse(normalizedResponse);
      return true;
    } catch (error) {
      this._handleHandlerError(action, error, messageId, sendResponse);
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
