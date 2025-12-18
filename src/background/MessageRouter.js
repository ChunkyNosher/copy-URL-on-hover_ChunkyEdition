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
 */

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
   * Route message to appropriate handler
   * v1.6.4.14 - FIX Issue #18: Support both `action` and `type` message properties
   * @param {Object} message - Message object with action or type property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    // v1.6.4.14 - Extract action from either `action` or `type` property
    const action = this._extractAction(message);
    
    // Validate message format - must have either action or type
    if (!action) {
      console.error('[MessageRouter] Invalid message format (missing action/type):', message);
      sendResponse({ success: false, error: 'Invalid message format' });
      return false;
    }

    const handler = this.handlers.get(action);

    if (!handler) {
      // v1.6.4.14 - FIX Issue #18: Don't error for type-based messages that are
      // handled by other listeners (e.g., QUICK_TAB_STATE_CHANGE, MANAGER_COMMAND)
      // These will be handled by the browser.runtime.onMessage listener added later
      const isTypeBasedMessage = typeof message.type === 'string' && typeof message.action !== 'string';
      
      if (isTypeBasedMessage) {
        // Let other listeners handle type-based messages
        return false;
      }
      
      console.warn(`[MessageRouter] No handler for action: ${action}`);
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false;
    }

    try {
      // Call handler and wait for result
      const result = await handler(message, sender);

      // Send response
      if (sendResponse) {
        sendResponse(result);
      }

      return true; // Keep channel open for async response
    } catch (error) {
      console.error(`[MessageRouter] Handler error for ${action}:`, error);

      if (sendResponse) {
        sendResponse({
          success: false,
          error: error.message || 'Handler execution failed'
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
