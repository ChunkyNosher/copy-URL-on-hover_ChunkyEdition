/**
 * TabHandler - Handles browser tab operations
 *
 * Actions handled:
 * - openTab: Open URL in new tab
 * - saveQuickTabState: Save Quick Tab state for specific browser tab
 * - getQuickTabState: Get Quick Tab state for specific browser tab
 * - clearQuickTabState: Clear Quick Tab state for specific browser tab
 * - createQuickTab: Legacy create action (redirects to CREATE_QUICK_TAB)
 *
 * v1.6.3.11-v4 - FIX Issue #6: Enhanced error context and logging
 * v1.6.3.11-v5 - Refactor: Extracted helpers to reduce complexity and duplication
 */

/**
 * Extract and validate tab ID from sender
 * @param {Object} sender - Message sender object
 * @returns {number} Valid tab ID
 * @throws {Error} If tab ID is not available
 */
function extractTabId(sender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) {
    throw new Error('Tab ID not available');
  }
  return tabId;
}

/**
 * Build a standardized success response
 * @param {string} operation - Operation name
 * @param {Object} details - Operation-specific details
 * @param {Object} [legacyFields] - Optional legacy fields for backward compatibility
 * @returns {Object} Standardized response object
 */
function buildSuccessResponse(operation, details, legacyFields = {}) {
  return {
    success: true,
    operation,
    details,
    ...legacyFields
  };
}

/**
 * Format error context as string for logging
 * @param {Object} context - Context key-value pairs
 * @returns {string} Formatted context string
 */
function formatErrorContext(context) {
  return Object.entries(context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

export class TabHandler {
  /**
   * Augment an error with handler context for diagnostics
   * v1.6.3.11-v4 - FIX Issue #6: Adds handler name, operation, and request context to errors
   * @param {Error} error - Original error
   * @param {string} operation - Operation being performed
   * @param {Object} context - Additional context
   * @returns {Error} Error with augmented message
   */
  static augmentError(error, operation, context = {}) {
    const contextStr = formatErrorContext(context);
    const augmentedMessage = `[ERROR] [TabHandler] ${operation} failed: ${error.message}${contextStr ? ` (${contextStr})` : ''}`;

    console.error(augmentedMessage, {
      handlerName: 'TabHandler',
      operation,
      context,
      originalError: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });

    const augmentedError = new Error(augmentedMessage);
    augmentedError.originalError = error;
    augmentedError.handlerName = 'TabHandler';
    augmentedError.operation = operation;
    augmentedError.context = context;
    return augmentedError;
  }

  constructor(quickTabStates, browserAPI) {
    this.quickTabStates = quickTabStates; // Map of tabId -> state
    this.browserAPI = browserAPI;
  }

  /**
   * Open URL in new tab
   * v1.6.3.11-v4 - FIX Issue #6: Enhanced error context
   * v1.6.3.11-v4 - FIX Issue #2: Standardized response format
   */
  async handleOpenTab(message, _sender) {
    try {
      if (!message.url) {
        throw new Error('URL is required');
      }

      const createProperties = { url: message.url };
      if (typeof message.active !== 'undefined') {
        createProperties.active = message.active;
      }

      const tab = await this.browserAPI.tabs.create(createProperties);
      return buildSuccessResponse('openTab', {
        tabId: tab.id,
        url: message.url,
        active: message.active ?? true
      }, { tabId: tab.id }); // Legacy field for backward compatibility
    } catch (error) {
      throw TabHandler.augmentError(error, 'handleOpenTab', {
        action: message.action,
        url: message.url ? message.url.substring(0, 50) : 'none'
      });
    }
  }

  /**
   * Save Quick Tab state for browser tab
   * v1.6.3.11-v4 - FIX Issue #6: Enhanced error context
   * v1.6.3.11-v4 - FIX Issue #2: Standardized response format
   * v1.6.3.11-v5 - Refactor: Use shared helpers
   */
  handleSaveState(message, sender) {
    try {
      const tabId = extractTabId(sender);
      this.quickTabStates.set(tabId, message.state);
      return buildSuccessResponse('saveQuickTabState', {
        tabId,
        stateSize: JSON.stringify(message.state || {}).length
      });
    } catch (error) {
      throw TabHandler.augmentError(error, 'handleSaveState', {
        action: message.action,
        senderTabId: sender?.tab?.id
      });
    }
  }

  /**
   * Get Quick Tab state for browser tab
   * v1.6.3.11-v4 - FIX Issue #6: Enhanced error context
   * v1.6.3.11-v4 - FIX Issue #2: Standardized response format
   * v1.6.3.11-v5 - Refactor: Use shared helpers
   */
  handleGetState(_message, sender) {
    try {
      const tabId = extractTabId(sender);
      const state = this.quickTabStates.get(tabId);
      return buildSuccessResponse('getQuickTabState', {
        tabId,
        hasState: state !== null && state !== undefined
      }, { state: state || null }); // Legacy field for backward compatibility
    } catch (error) {
      throw TabHandler.augmentError(error, 'handleGetState', {
        senderTabId: sender?.tab?.id
      });
    }
  }

  /**
   * Clear Quick Tab state for browser tab
   * v1.6.3.11-v4 - FIX Issue #6: Enhanced error context
   * v1.6.3.11-v4 - FIX Issue #2: Standardized response format
   * v1.6.3.11-v5 - Refactor: Use shared helpers
   */
  handleClearState(_message, sender) {
    try {
      const tabId = extractTabId(sender);
      const hadState = this.quickTabStates.has(tabId);
      this.quickTabStates.delete(tabId);
      return buildSuccessResponse('clearQuickTabState', {
        tabId,
        hadState
      });
    } catch (error) {
      throw TabHandler.augmentError(error, 'handleClearState', {
        senderTabId: sender?.tab?.id
      });
    }
  }

  /**
   * Legacy create handler (redirects to modern handler)
   */
  handleLegacyCreate(_message, _sender) {
    console.log('[TabHandler] Legacy createQuickTab action - use CREATE_QUICK_TAB instead');

    // Just acknowledge - actual creation should use CREATE_QUICK_TAB
    return { success: true, message: 'Use CREATE_QUICK_TAB action' };
  }
}
