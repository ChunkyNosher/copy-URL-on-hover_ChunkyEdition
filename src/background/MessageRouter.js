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
// v1.6.3.11-v3 - FIX Issue #47: Added HEARTBEAT to allowlist for restart detection
// v1.6.3.11-v3 - FIX Issue #23: Added REFRESH_CACHED_SETTINGS for options page
// v1.6.3.11-v3 - FIX Issue #2: Added keyboard shortcut actions
// v1.6.3.11-v4 - FIX Issue #4: Added RECONCILE_STALE_TABS for sidebar state verification
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
  // Keepalive and heartbeat
  'KEEPALIVE_PING',
  // v1.6.3.11-v3 - FIX Issue #47: HEARTBEAT for restart detection
  'HEARTBEAT',
  // v1.6.3.11-v3 - FIX Issue #23: Settings refresh from options page
  'REFRESH_CACHED_SETTINGS',
  // v1.6.3.11-v3 - FIX Issue #2: Keyboard shortcut management
  'UPDATE_KEYBOARD_SHORTCUT',
  'GET_KEYBOARD_SHORTCUTS',
  // v1.6.3.11-v4 - FIX Issue #4: Sidebar state verification
  'RECONCILE_STALE_TABS'
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
// v1.6.3.11-v3 - FIX Issue #14: PROTOCOL VERSION ENFORCEMENT POLICY
// ============================================================================
// POLICY: Backward-compatible with logging, NOT strict rejection
// ============================================================================
// - Clients without version header: Allowed (logged as 'legacy')
// - Clients with version >= MIN_COMPATIBLE_PROTOCOL_VERSION: Allowed
// - Clients with version < MIN_COMPATIBLE_PROTOCOL_VERSION: Allowed but WARNED
//
// RATIONALE: Extension updates may create version mismatches temporarily when
// background script updates before content scripts reload. Strict rejection
// would break functionality during updates.
//
// FUTURE: If strict enforcement needed, add 'strictVersionCheck: true' option
// to handler registration and only enforce on handlers that opt-in.
// ============================================================================
export const MESSAGE_PROTOCOL_VERSION = '1.0.0';

// v1.6.3.10-v12 - FIX Issue #10: Minimum compatible protocol version
export const MIN_COMPATIBLE_PROTOCOL_VERSION = '1.0.0';

// v1.6.3.11-v3 - FIX Issue #20: Maximum messages to queue during initialization
const MAX_PRE_INIT_MESSAGE_QUEUE = 50;

// v1.6.3.10-v11 - FIX Issue #11: Operations requiring ownership validation
// v1.6.3.11-v3 - FIX Issue #36 & #56: Added CLOSE_QUICK_TAB to ownership-required actions
// These operations modify Quick Tab state and must validate sender.tab.id === message.originTabId
const OWNERSHIP_REQUIRED_ACTIONS = new Set([
  'CREATE_QUICK_TAB',
  'CLOSE_QUICK_TAB', // v1.6.3.11-v3 - FIX Issue #36: CLOSE requires ownership validation
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

// v1.6.3.11-v3 - FIX Issue #24: Maximum queue size per action for re-entrance queue
const MAX_REENTRANCE_QUEUE_SIZE = 10;

export class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.extensionId = null;
    // v1.6.4.15 - FIX Issue #18: Track rejected commands for diagnostics
    this._rejectedCommandCount = 0;
    this._lastRejectedCommand = null;
    // v1.6.3.10-v12 - FIX Issue #8: Store background generation ID for responses
    this._backgroundGenerationId = null;
    // v1.6.3.11 - FIX Issue #35: Track initialization state
    this._isInitialized = false;
    this._initStartTime = Date.now();

    // v1.6.3.11-v3 - FIX Issue #20: Queue for messages received before initialization
    this._preInitMessageQueue = [];

    // v1.6.3.11-v3 - FIX Issue #24: Re-entrance guard using Map<action, Queue>
    // Instead of blocking re-entrant messages, queue them and process in order
    this._processingActions = new Set();
    this._reEntranceQueues = new Map(); // action -> Array of queued messages

    // v1.6.3.11 - FIX Issue #35: Log when MessageRouter is initialized
    console.log('[MessageRouter] INITIALIZED:', {
      timestamp: new Date().toISOString(),
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      handlerCount: this.handlers.size
    });
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
   * v1.6.3.11 - FIX Issue #35: Log when handlers are registered
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

    // v1.6.3.11 - FIX Issue #35: Log handler registration count
    console.log('[MessageRouter] HANDLERS_REGISTERED:', {
      newActions: actionList.length,
      totalHandlers: this.handlers.size,
      actions: actionList.join(', ')
    });
  }

  /**
   * Set extension ID for sender validation
   * @param {string} extensionId - Extension ID from runtime.id
   */
  setExtensionId(extensionId) {
    this.extensionId = extensionId;
    // v1.6.3.11 - FIX Issue #35: Log extension ID configuration
    console.log('[MessageRouter] EXTENSION_ID_CONFIGURED:', {
      extensionId: extensionId ? extensionId.substring(0, 20) + '...' : 'null'
    });
  }

  /**
   * Mark router as fully initialized and drain queued messages
   * v1.6.3.11 - FIX Issue #35: Track initialization completion
   * v1.6.3.11-v3 - FIX Issue #20: Drain pre-init message queue
   */
  markInitialized() {
    this._isInitialized = true;
    const initDuration = Date.now() - this._initStartTime;
    const queuedMessages = this._preInitMessageQueue.length;

    console.log('[MessageRouter] FULLY_INITIALIZED:', {
      timestamp: new Date().toISOString(),
      totalHandlers: this.handlers.size,
      initDurationMs: initDuration,
      hasExtensionId: !!this.extensionId,
      hasGenerationId: !!this._backgroundGenerationId,
      queuedMessages // v1.6.3.11-v3 - FIX Issue #20
    });

    // v1.6.3.11-v3 - FIX Issue #20: Drain queued messages
    if (queuedMessages > 0) {
      this._drainPreInitQueue();
    }
  }

  /**
   * Drain the pre-initialization message queue
   * v1.6.3.11-v3 - FIX Issue #20: Process messages that arrived before init
   * @private
   */
  async _drainPreInitQueue() {
    console.log('[MessageRouter] DRAIN_PRE_INIT_QUEUE_START:', {
      queueSize: this._preInitMessageQueue.length,
      timestamp: Date.now()
    });

    let processedCount = 0;
    let errorCount = 0;

    while (this._preInitMessageQueue.length > 0) {
      const entry = this._preInitMessageQueue.shift();
      const result = await this._processQueuedMessage(entry);
      if (result.success) {
        processedCount++;
      } else {
        errorCount++;
      }
    }

    console.log('[MessageRouter] DRAIN_PRE_INIT_QUEUE_COMPLETE:', {
      processedCount,
      errorCount
    });
  }

  /**
   * Process a single queued message
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce nesting depth
   * @private
   */
  async _processQueuedMessage(entry) {
    const { message, sender, sendResponse, queuedAt } = entry;
    const queueDuration = Date.now() - queuedAt;

    try {
      await this.route(message, sender, sendResponse);
      console.log('[MessageRouter] PRE_INIT_MESSAGE_PROCESSED:', {
        action: message.action || message.type,
        queueDurationMs: queueDuration
      });
      return { success: true };
    } catch (err) {
      console.error('[MessageRouter] PRE_INIT_MESSAGE_FAILED:', {
        action: message.action || message.type,
        error: err.message
      });
      if (sendResponse) {
        sendResponse({ success: false, error: 'Failed during queue drain' });
      }
      return { success: false };
    }
  }

  /**
   * Queue a message for processing after initialization
   * v1.6.3.11-v3 - FIX Issue #20: Buffer pre-init messages
   * @private
   */
  _queuePreInitMessage(message, sender, sendResponse) {
    if (this._preInitMessageQueue.length >= MAX_PRE_INIT_MESSAGE_QUEUE) {
      console.warn('[MessageRouter] PRE_INIT_QUEUE_OVERFLOW: Message dropped', {
        action: message.action || message.type,
        queueSize: this._preInitMessageQueue.length,
        maxSize: MAX_PRE_INIT_MESSAGE_QUEUE
      });
      sendResponse({
        success: false,
        error: 'MessageRouter initialization queue full',
        code: 'QUEUE_OVERFLOW',
        retryable: true
      });
      return;
    }

    this._preInitMessageQueue.push({
      message,
      sender,
      sendResponse,
      queuedAt: Date.now()
    });

    console.log('[MessageRouter] MESSAGE_QUEUED_PRE_INIT:', {
      action: message.action || message.type,
      queueSize: this._preInitMessageQueue.length
    });
  }

  /**
   * Check if router is initialized
   * v1.6.3.11 - FIX Issue #35
   * @returns {boolean}
   */
  isInitialized() {
    return this._isInitialized;
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
    return {
      ...response,
      error: 'Unknown error',
      code: response.code || 'UNKNOWN_ERROR',
      ...baseFields
    };
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
      console.log(
        '[MSG][MessageRouter] PROTOCOL_NEGOTIATED: Client did not send version (legacy)',
        {
          action: message.action || message.type,
          senderTabId: sender?.tab?.id,
          serverVersion: MESSAGE_PROTOCOL_VERSION
        }
      );
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
   * v1.6.3.11-v3 - FIX Issue #36 & #56: REQUIRE originTabId field for ownership operations
   * Previously, missing originTabId would pass validation. Now it's rejected.
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

    // v1.6.3.11-v3 - FIX Issue #36: REQUIRE originTabId field for ownership-required operations
    // Previously, missing originTabId would pass validation (security bypass)
    if (payloadOriginTabId === null || payloadOriginTabId === undefined) {
      console.error('[MSG][MessageRouter] OWNERSHIP_VALIDATION_FAILED: Missing originTabId', {
        action,
        senderTabId,
        warning: 'SECURITY: originTabId field is required for ownership operations'
      });
      return {
        valid: false,
        error: 'Missing originTabId field',
        code: 'MISSING_ORIGIN_TAB_ID'
      };
    }

    // originTabId MUST match sender.tab.id
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

    // Validation passed
    console.log('[MSG][MessageRouter] OWNERSHIP_VALIDATED:', {
      action,
      senderTabId,
      payloadOriginTabId
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
      // v1.6.3.11-v3 - FIX Issue #60: Enhanced rejection logging
      console.warn('[MSG][MessageRouter] MESSAGE_REJECTED: Unknown command', {
        action,
        senderTabId: sender?.tab?.id,
        senderFrameId: sender?.frameId,
        senderUrl: sender?.url,
        messageId: message?.messageId,
        timestamp: Date.now(),
        reason: 'UNKNOWN_COMMAND',
        messageKeys: Object.keys(message || {})
      });
      sendResponse({
        success: false,
        error: 'UNKNOWN_COMMAND',
        command: action,
        code: 'UNKNOWN_COMMAND',
        version: MESSAGE_PROTOCOL_VERSION
      });
      return { handled: true, returnValue: false };
    }

    // v1.6.3.11-v3 - FIX Issue #60: Enhanced rejection logging for no handler case
    console.warn('[MSG][MessageRouter] MESSAGE_REJECTED: No handler', {
      action,
      senderTabId: sender?.tab?.id,
      senderFrameId: sender?.frameId,
      senderUrl: sender?.url,
      messageId: message?.messageId,
      timestamp: Date.now(),
      reason: 'NO_HANDLER',
      validActions: VALID_MESSAGE_ACTIONS.slice(0, 10) // First 10 valid actions for context
    });
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
   * v1.6.3.11-v3 - FIX Issue #58: Enhanced error logging with stack trace
   * @private
   */
  _handleHandlerError(action, error, messageId, sendResponse) {
    // v1.6.3.11-v3 - FIX Issue #58: Log error with full context including stack trace
    console.error(`[MSG][MessageRouter] HANDLER_ERROR for ${action}:`, {
      action,
      messageId,
      errorMessage: error.message || 'Unknown error',
      errorName: error.name || 'Error',
      stack: error.stack || 'No stack trace',
      timestamp: Date.now()
    });

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
   * Validate basic message structure before routing
   * v1.6.3.11 - FIX Issue #25: No structure validation
   * Checks that message is an object with valid action/type field
   * @private
   * @param {*} message - Message to validate
   * @returns {{valid: boolean, error?: string, code?: string}}
   */
  _validateMessageStructure(message) {
    // Check message is an object
    if (!message || typeof message !== 'object') {
      console.warn('[MSG][MessageRouter] INVALID_STRUCTURE: Message is not an object', {
        received: typeof message
      });
      return {
        valid: false,
        error: 'Message must be an object',
        code: 'INVALID_MESSAGE_STRUCTURE'
      };
    }

    // Check for action or type field
    const hasAction = typeof message.action === 'string' && message.action.length > 0;
    const hasType = typeof message.type === 'string' && message.type.length > 0;

    if (!hasAction && !hasType) {
      console.warn('[MSG][MessageRouter] INVALID_STRUCTURE: Missing action/type field', {
        keys: Object.keys(message).slice(0, 10)
      });
      return {
        valid: false,
        error: 'Message must have action or type field',
        code: 'MISSING_ACTION_TYPE'
      };
    }

    return { valid: true };
  }

  /**
   * Check for re-entrance (recursive handler call) and queue if needed
   * v1.6.3.11-v3 - FIX Issue #24: Queue re-entrant messages instead of blocking
   * @private
   * @param {string} action - Action being processed
   * @param {Object} message - Message to potentially queue
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {{shouldQueue: boolean, wasQueued: boolean}} True if message was queued
   */
  _checkReentrance(action, message, sender, sendResponse) {
    if (!this._processingActions.has(action)) {
      return { shouldQueue: false, wasQueued: false };
    }

    // Re-entrance detected - queue the message instead of blocking
    if (!this._reEntranceQueues.has(action)) {
      this._reEntranceQueues.set(action, []);
    }

    const queue = this._reEntranceQueues.get(action);

    // Check queue size limit
    if (queue.length >= MAX_REENTRANCE_QUEUE_SIZE) {
      console.warn('[MSG][MessageRouter] RE_ENTRANCE_QUEUE_FULL: Dropping oldest message', {
        action,
        queueSize: queue.length,
        maxSize: MAX_REENTRANCE_QUEUE_SIZE
      });
      // Remove oldest message (FIFO overflow)
      const droppedMessage = queue.shift();
      if (droppedMessage.sendResponse) {
        droppedMessage.sendResponse({
          success: false,
          error: 'Message dropped due to queue overflow',
          code: 'QUEUE_OVERFLOW',
          timestamp: Date.now()
        });
      }
    }

    // Queue this message
    queue.push({ message, sender, sendResponse, queuedAt: Date.now() });

    console.log('[MSG][MessageRouter] RE_ENTRANCE_QUEUED:', {
      action,
      queueSize: queue.length,
      messageId: message?.messageId
    });

    return { shouldQueue: true, wasQueued: true };
  }

  /**
   * Handle error during queue drain
   * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce nesting depth
   * @private
   */
  _handleQueueDrainError(entry, action, err, queueDuration) {
    console.error('[MSG][MessageRouter] RE_ENTRANCE_MESSAGE_FAILED:', {
      action,
      error: err.message,
      queueDurationMs: queueDuration
    });
    if (entry.sendResponse) {
      entry.sendResponse({
        success: false,
        error: 'Failed during queue drain',
        code: 'QUEUE_DRAIN_ERROR',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Drain re-entrance queue for a specific action after handler completes
   * v1.6.3.11-v3 - FIX Issue #24: Process queued messages in order
   * @private
   * @param {string} action - Action whose queue to drain
   */
  async _drainReEntranceQueue(action) {
    const queue = this._reEntranceQueues.get(action);
    if (!queue || queue.length === 0) {
      return;
    }

    console.log('[MSG][MessageRouter] DRAIN_RE_ENTRANCE_QUEUE_START:', {
      action,
      queueSize: queue.length
    });

    // Process all queued messages for this action
    while (queue.length > 0) {
      const entry = queue.shift();
      const queueDuration = Date.now() - entry.queuedAt;

      try {
        // Re-route the queued message through the full routing pipeline
        await this.route(entry.message, entry.sender, entry.sendResponse);
        console.log('[MSG][MessageRouter] RE_ENTRANCE_MESSAGE_PROCESSED:', {
          action,
          queueDurationMs: queueDuration,
          remainingInQueue: queue.length
        });
      } catch (err) {
        this._handleQueueDrainError(entry, action, err, queueDuration);
      }
    }

    // Clean up empty queue
    this._reEntranceQueues.delete(action);

    console.log('[MSG][MessageRouter] DRAIN_RE_ENTRANCE_QUEUE_COMPLETE:', { action });
  }

  /**
   * Check early exit conditions for route()
   * v1.6.3.11-v3 - FIX Issue #24: Updated to queue re-entrant messages instead of blocking
   * @private
   * @param {Object} message - Message to route
   * @param {Object} sender - Message sender
   * @param {string} action - Extracted action
   * @param {string} messageId - Message ID for correlation
   * @param {Function} sendResponse - Response callback
   * @returns {{shouldExit: boolean, returnValue?: boolean}}
   */
  _checkRouteEarlyExit(message, sender, action, messageId, sendResponse) {
    // Check re-entrance and queue if needed
    const reEntranceResult = this._checkReentrance(action, message, sender, sendResponse);
    if (reEntranceResult.wasQueued) {
      // Message was queued, caller should exit and not process further
      return { shouldExit: true, returnValue: true }; // Return true to keep channel open
    }
    return { shouldExit: false };
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
   * v1.6.3.11 - FIX Issue #24: Re-entrance guard for circular dependencies
   * v1.6.3.11 - FIX Issue #25: Basic structure validation before routing
   * v1.6.3.11-v3 - FIX Issue #3: Enhanced logging with MSG_COMMAND/MSG_VALIDATION/MSG_ROUTE prefixes
   * @param {Object} message - Message object with action or type property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    // v1.6.3.11-v3 - FIX Issue #3: Log route start
    // v1.6.3.11-v4 - FIX Issue #4: Enhanced with [MSG] prefix for arrival logging
    const routeStartTime = Date.now();
    console.log('[MSG] Message arrived:', {
      action: message?.action || message?.type,
      senderTabId: sender?.tab?.id,
      senderUrl: sender?.url?.substring(0, 50),
      messageKeys: Object.keys(message || {}),
      timestamp: routeStartTime
    });

    // v1.6.3.11 - FIX Issue #25: Validate structure before processing
    // v1.6.3.11-v4 - FIX Issue #4: Enhanced with [MSG:VALIDATE] prefix
    const structureValidation = this._validateMessageStructure(message);
    if (!structureValidation.valid) {
      console.warn('[MSG:VALIDATE] Structure validation failed:', {
        error: structureValidation.error,
        code: structureValidation.code
      });
      sendResponse({
        success: false,
        error: structureValidation.error,
        code: structureValidation.code,
        timestamp: Date.now()
      });
      return false;
    }

    const messageId = message?.messageId || null;
    const action = this._extractAction(message);

    // Validate message format
    if (!action) {
      console.warn('[MSG:VALIDATE] No action extracted from message');
      this._handleInvalidFormat(message, messageId, sendResponse);
      return false;
    }

    // v1.6.3.11-v3 - FIX Issue #3: Log action extraction
    // v1.6.3.11-v4 - FIX Issue #4: Enhanced with [MSG:VALIDATE] prefix
    console.log('[MSG:VALIDATE] Action validated:', {
      action,
      messageId,
      senderTabId: sender?.tab?.id,
      isValidAction: VALID_MESSAGE_ACTIONS.has(action)
    });

    // v1.6.3.11-v3 - FIX Issue #24: Check for re-entrance and queue if needed
    const earlyExit = this._checkRouteEarlyExit(message, sender, action, messageId, sendResponse);
    if (earlyExit.shouldExit) return earlyExit.returnValue;

    // Validate protocol version and log correlation
    this._validateProtocolVersion(message, sender);

    if (messageId) {
      console.log('[MSG] MESSAGE_CORRELATION:', {
        messageId,
        action,
        senderTabId: sender?.tab?.id
      });
    }

    // v1.6.3.11-v4 - FIX Issue #4: [MSG:ROUTE] prefix for handler selection
    console.log('[MSG:ROUTE] Routing to handler:', {
      action,
      hasHandler: this.handlers.has(action),
      messageId
    });

    // Route to handler
    // Note: ESLint require-await rule flags this, but async is needed for awaiting callers
    return this._routeToHandler(message, sender, sendResponse, action, messageId);
  }

  /**
   * Route message to handler after validation passes
   * v1.6.3.11-v3 - FIX Issue #24: Added queue draining after handler completes
   * v1.6.3.11-v3 - FIX Issue #3: Enhanced logging with MSG_ROUTE prefix
   * @private
   */
  async _routeToHandler(message, sender, sendResponse, action, messageId) {
    const handler = this.handlers.get(action);
    if (!handler) {
      console.warn('[MSG:ROUTE] No handler found for action:', action);
      const result = this._handleNoHandler(message, sender, sendResponse, action);
      return result.handled ? result.returnValue : false;
    }

    // v1.6.3.11-v3 - FIX Issue #3: Log handler found
    // v1.6.3.11-v4 - FIX Issue #4: Enhanced with [MSG:ROUTE] prefix
    console.log('[MSG:ROUTE] Handler found, validating ownership:', {
      action,
      handlerExists: true
    });

    // Validate ownership
    const ownershipValidation = this._validateOwnership(message, sender, action);
    if (!ownershipValidation.valid) {
      console.warn('[MSG:VALIDATE] Ownership validation failed:', {
        action,
        error: ownershipValidation.error,
        code: ownershipValidation.code
      });
      this._handleOwnershipFailure(ownershipValidation, messageId, sendResponse);
      return false;
    }

    // v1.6.3.11-v3 - FIX Issue #24: Track action being processed
    this._processingActions.add(action);

    // v1.6.3.11-v3 - FIX Issue #3: Log handler execution start
    // v1.6.3.11-v4 - FIX Issue #4: Enhanced with [MSG:EXEC] prefix
    const handlerStartTime = Date.now();
    console.log('[MSG:EXEC] Handler execution starting:', {
      action,
      messageId,
      senderTabId: sender?.tab?.id,
      startTime: handlerStartTime
    });

    try {
      const result = await handler(message, sender);
      const normalizedResponse = this._normalizeResponse(result, action, messageId);
      const handlerDurationMs = Date.now() - handlerStartTime;

      // v1.6.3.11-v4 - FIX Issue #4: [MSG:EXEC] success logging
      console.log('[MSG:EXEC] Handler completed successfully:', {
        action,
        durationMs: handlerDurationMs,
        success: normalizedResponse.success !== false
      });

      // v1.6.3.11-v4 - FIX Issue #4: [MSG:RESPONSE] logging for response structure
      console.log('[MSG:RESPONSE] Sending response:', {
        action,
        success: normalizedResponse.success,
        hasData: 'data' in normalizedResponse,
        messageId,
        durationMs: handlerDurationMs
      });

      if (sendResponse) sendResponse(normalizedResponse);
      return true;
    } catch (error) {
      // v1.6.3.11-v4 - FIX Issue #4: [MSG:EXEC] error logging
      console.error('[MSG:EXEC] Handler threw error:', {
        action,
        durationMs: Date.now() - handlerStartTime,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });

      // v1.6.3.11-v4 - FIX Issue #4: [MSG:RESPONSE] error response logging
      console.log('[MSG:RESPONSE] Sending error response:', {
        action,
        success: false,
        error: error.message,
        messageId
      });

      this._handleHandlerError(action, error, messageId, sendResponse);
      return true;
    } finally {
      // v1.6.3.11-v3 - FIX Issue #24: Clear processing flag and drain queue
      this._processingActions.delete(action);
      // Drain any queued messages for this action
      await this._drainReEntranceQueue(action);
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
