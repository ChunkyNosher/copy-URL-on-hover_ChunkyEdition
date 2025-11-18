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
      console.warn(
        '[MessageRouter] Extension ID not set - defaulting to optimistic validation'
      );
      return true;
    }

    return sender.id === this.extensionId;
  }

  /**
   * Route message to appropriate handler
   * @param {Object} message - Message object with action property
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} True if async response expected
   */
  async route(message, sender, sendResponse) {
    // Validate message format
    if (!message || typeof message.action !== 'string') {
      console.error('[MessageRouter] Invalid message format:', message);
      sendResponse({ success: false, error: 'Invalid message format' });
      return false;
    }

    const handler = this.handlers.get(message.action);

    if (!handler) {
      console.warn(`[MessageRouter] No handler for action: ${message.action}`);
      sendResponse({ success: false, error: `Unknown action: ${message.action}` });
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
      console.error(`[MessageRouter] Handler error for ${message.action}:`, error);
      
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
