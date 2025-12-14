/**
 * Message Router - Define message types and validation for tabs.sendMessage architecture
 *
 * This module provides:
 * - Message type constants
 * - Message pattern definitions (Local, Global, Manager)
 * - Message builder utilities
 * - Message validation
 *
 * @module messaging/message-router
 */

/**
 * Message type constants for Quick Tabs communication
 */
export const MESSAGE_TYPES = {
  // Local updates (Pattern A - no broadcast)
  QT_POSITION_CHANGED: 'QT_POSITION_CHANGED',
  QT_SIZE_CHANGED: 'QT_SIZE_CHANGED',

  // Global actions (Pattern B - broadcast to all)
  QT_CREATED: 'QT_CREATED',
  QT_MINIMIZED: 'QT_MINIMIZED',
  QT_RESTORED: 'QT_RESTORED',
  QT_CLOSED: 'QT_CLOSED',

  // Manager actions (Pattern C - broadcast to all)
  MANAGER_CLOSE_ALL: 'MANAGER_CLOSE_ALL',
  MANAGER_CLOSE_MINIMIZED: 'MANAGER_CLOSE_MINIMIZED',

  // State sync
  QT_STATE_SYNC: 'QT_STATE_SYNC',
  SIDEBAR_UPDATE: 'SIDEBAR_UPDATE',
  REQUEST_FULL_STATE: 'REQUEST_FULL_STATE',

  // Lifecycle
  CONTENT_SCRIPT_READY: 'CONTENT_SCRIPT_READY',
  CONTENT_SCRIPT_UNLOAD: 'CONTENT_SCRIPT_UNLOAD'
};

/**
 * Message patterns defining broadcast behavior
 */
export const MESSAGE_PATTERNS = {
  LOCAL: 'LOCAL', // Pattern A: No broadcast needed
  GLOBAL: 'GLOBAL', // Pattern B: Broadcast to all tabs
  MANAGER: 'MANAGER' // Pattern C: Manager-initiated broadcast
};

/**
 * Map message types to their patterns
 */
export const TYPE_TO_PATTERN = {
  [MESSAGE_TYPES.QT_POSITION_CHANGED]: MESSAGE_PATTERNS.LOCAL,
  [MESSAGE_TYPES.QT_SIZE_CHANGED]: MESSAGE_PATTERNS.LOCAL,
  [MESSAGE_TYPES.QT_CREATED]: MESSAGE_PATTERNS.GLOBAL,
  [MESSAGE_TYPES.QT_MINIMIZED]: MESSAGE_PATTERNS.GLOBAL,
  [MESSAGE_TYPES.QT_RESTORED]: MESSAGE_PATTERNS.GLOBAL,
  [MESSAGE_TYPES.QT_CLOSED]: MESSAGE_PATTERNS.GLOBAL,
  [MESSAGE_TYPES.MANAGER_CLOSE_ALL]: MESSAGE_PATTERNS.MANAGER,
  [MESSAGE_TYPES.MANAGER_CLOSE_MINIMIZED]: MESSAGE_PATTERNS.MANAGER,
  [MESSAGE_TYPES.QT_STATE_SYNC]: MESSAGE_PATTERNS.GLOBAL,
  [MESSAGE_TYPES.SIDEBAR_UPDATE]: MESSAGE_PATTERNS.GLOBAL,
  [MESSAGE_TYPES.REQUEST_FULL_STATE]: MESSAGE_PATTERNS.LOCAL,
  [MESSAGE_TYPES.CONTENT_SCRIPT_READY]: MESSAGE_PATTERNS.LOCAL,
  [MESSAGE_TYPES.CONTENT_SCRIPT_UNLOAD]: MESSAGE_PATTERNS.LOCAL
};

/**
 * Message builder class for creating well-formed messages
 */
export class MessageBuilder {
  /**
   * Build a local update message (Pattern A - no broadcast)
   *
   * @param {string} type - Message type
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} payload - Additional payload data
   * @param {number|string} tabId - Source tab ID
   * @returns {Object} Well-formed message object
   */
  static buildLocalUpdate(type, quickTabId, payload, tabId) {
    return {
      type,
      quickTabId,
      ...payload,
      correlationId: this._generateId(tabId),
      timestamp: Date.now()
    };
  }

  /**
   * Build a global action message (Pattern B - broadcast to all)
   *
   * @param {string} type - Message type
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} payload - Additional payload data
   * @param {number|string} tabId - Source tab ID
   * @returns {Object} Well-formed message object
   */
  static buildGlobalAction(type, quickTabId, payload, tabId) {
    return {
      type,
      quickTabId,
      ...payload,
      correlationId: this._generateId(tabId),
      timestamp: Date.now(),
      broadcast: true
    };
  }

  /**
   * Build a manager action message (Pattern C - manager-initiated broadcast)
   *
   * @param {string} type - Message type
   * @param {Object} payload - Additional payload data
   * @returns {Object} Well-formed message object
   */
  static buildManagerAction(type, payload) {
    return {
      type,
      ...payload,
      correlationId: this._generateId('manager'),
      timestamp: Date.now(),
      broadcast: true,
      source: 'manager'
    };
  }

  /**
   * Build a state sync message
   *
   * @param {Object} state - State to sync
   * @param {number} targetTabId - Target tab ID
   * @returns {Object} Well-formed state sync message
   */
  static buildStateSyncMessage(state, targetTabId) {
    return {
      type: MESSAGE_TYPES.QT_STATE_SYNC,
      state,
      targetTabId,
      correlationId: this._generateId('sync'),
      timestamp: Date.now()
    };
  }

  /**
   * Generate a unique message ID
   *
   * @param {string|number} prefix - Prefix for the ID
   * @returns {string} Unique ID
   * @private
   */
  static _generateId(prefix) {
    return `${prefix || 'msg'}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

/**
 * Set of valid message type values for O(1) lookup
 * @private
 */
const VALID_MESSAGE_TYPES = new Set(Object.values(MESSAGE_TYPES));

/**
 * Validators for specific message types
 * @private
 */
const TYPE_VALIDATORS = {
  [MESSAGE_TYPES.QT_POSITION_CHANGED]: message => {
    const errors = [];
    if (!message.quickTabId) errors.push('Missing quickTabId for position change');
    if (!message.newPosition) errors.push('Missing newPosition');
    return errors;
  },
  [MESSAGE_TYPES.QT_SIZE_CHANGED]: message => {
    const errors = [];
    if (!message.quickTabId) errors.push('Missing quickTabId for size change');
    if (!message.newSize) errors.push('Missing newSize');
    return errors;
  },
  [MESSAGE_TYPES.QT_MINIMIZED]: message => {
    return message.quickTabId ? [] : ['Missing quickTabId'];
  },
  [MESSAGE_TYPES.QT_RESTORED]: message => {
    return message.quickTabId ? [] : ['Missing quickTabId'];
  },
  [MESSAGE_TYPES.QT_CLOSED]: message => {
    return message.quickTabId ? [] : ['Missing quickTabId'];
  },
  [MESSAGE_TYPES.QT_STATE_SYNC]: message => {
    return message.state ? [] : ['Missing state for sync'];
  }
};

/**
 * Message validator class for validating incoming messages
 */
export class MessageValidator {
  /**
   * Validate a message object
   *
   * @param {Object} message - Message to validate
   * @returns {Object} Validation result with valid flag and errors array
   */
  static validate(message) {
    const errors = [];

    if (!message) {
      errors.push('Message is null or undefined');
      return { valid: false, errors };
    }

    if (!message.type) {
      errors.push('Missing required field: type');
    } else if (!VALID_MESSAGE_TYPES.has(message.type)) {
      errors.push(`Unknown message type: ${message.type}`);
    }

    if (!message.correlationId) {
      errors.push('Missing required field: correlationId');
    }

    if (!message.timestamp) {
      errors.push('Missing required field: timestamp');
    }

    // Type-specific validation
    if (message.type && VALID_MESSAGE_TYPES.has(message.type)) {
      const typeErrors = this._validateByType(message);
      errors.push(...typeErrors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate message based on its specific type
   *
   * @param {Object} message - Message to validate
   * @returns {Array} Array of validation error strings
   * @private
   */
  static _validateByType(message) {
    const validator = TYPE_VALIDATORS[message.type];
    return validator ? validator(message) : [];
  }

  /**
   * Check if message is a local update (no broadcast needed)
   *
   * @param {Object} message - Message to check
   * @returns {boolean} True if local update
   */
  static isLocalUpdate(message) {
    return TYPE_TO_PATTERN[message.type] === MESSAGE_PATTERNS.LOCAL;
  }

  /**
   * Check if message requires broadcast to other tabs
   *
   * @param {Object} message - Message to check
   * @returns {boolean} True if broadcast required
   */
  static requiresBroadcast(message) {
    const pattern = TYPE_TO_PATTERN[message.type];
    return pattern === MESSAGE_PATTERNS.GLOBAL || pattern === MESSAGE_PATTERNS.MANAGER;
  }
}

/**
 * Send a message with timeout support
 *
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds (default 5000)
 * @returns {Promise<*>} Response from message handler
 * @throws {Error} If message times out or fails
 */
export function sendMessageWithTimeout(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Message timed out after ${timeoutMs}ms: ${message.type}`));
      }
    }, timeoutMs);

    browser.runtime
      .sendMessage(message)
      .then(result => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch(error => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      });
  });
}

/**
 * Generate a unique message ID
 *
 * @param {string} prefix - Prefix for the ID (default 'msg')
 * @returns {string} Unique message ID
 */
export function generateMessageId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
