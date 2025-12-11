/**
 * Message Utilities - Reliable request/response patterns for WebExtension messaging
 * v1.6.3.8-v2 - Issue #7: Fix async/await Promise resolution race conditions
 *
 * Problem: Firefox's runtime.sendMessage returns a Promise that resolves as soon as
 * the listener invokes the callback, not when the operation completes. This causes
 * content scripts to proceed with "success" state while background operation is pending.
 *
 * Solution: Implement a request/response pattern with:
 * 1. Unique requestId for ACK correlation
 * 2. Timeout-based Promise management
 * 3. Standardized response shape: { success, data, error?, requestId? }
 *
 * @module message-utils
 */

// ==================== CONSTANTS ====================

/**
 * Default request timeout (5 seconds)
 * v1.6.3.8-v2 - Issue #7: Reasonable default for most operations
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/**
 * Debug flag for message utility logging
 * v1.6.3.8-v2 - Issue #7: Respect DEBUG_MESSAGING pattern
 */
const DEBUG_MESSAGING = true;

/**
 * Counter for generating unique request IDs
 * @private
 */
let _requestIdCounter = 0;

// ==================== REQUEST ID GENERATION ====================

/**
 * Generate unique request ID for message correlation
 * v1.6.3.8-v2 - Issue #7: Unique IDs for ACK correlation
 * @returns {string} Unique request ID in format "req-{timestamp}-{counter}"
 */
export function generateRequestId() {
  _requestIdCounter++;
  return `req-${Date.now()}-${_requestIdCounter}`;
}

// ==================== RESPONSE VALIDATION ====================

/**
 * Standardized response shape
 * v1.6.3.8-v2 - Issue #7: All responses should conform to this shape
 * @typedef {Object} StandardResponse
 * @property {boolean} success - Whether the operation succeeded
 * @property {any} [data] - Response data (if success)
 * @property {string} [error] - Error message (if failure)
 * @property {string} [requestId] - Correlated request ID
 */

/**
 * Validate response conforms to standard shape
 * v1.6.3.8-v2 - Issue #7: Ensure consistent response handling
 * @param {any} response - Response to validate
 * @returns {boolean} True if response is valid
 */
export function isValidResponse(response) {
  if (!response || typeof response !== 'object') {
    return false;
  }
  return typeof response.success === 'boolean';
}

/**
 * Normalize response to standard shape
 * v1.6.3.8-v2 - Issue #7: Convert legacy responses to standard shape
 * @param {any} response - Response to normalize
 * @param {string} [requestId] - Request ID to include
 * @returns {StandardResponse} Normalized response
 */
export function normalizeResponse(response, requestId = null) {
  // Handle null/undefined
  if (!response) {
    return {
      success: false,
      error: 'Empty response',
      requestId
    };
  }

  // Handle primitive responses (boolean success)
  if (typeof response === 'boolean') {
    return {
      success: response,
      requestId
    };
  }

  // Handle non-object responses
  if (typeof response !== 'object') {
    return {
      success: true,
      data: response,
      requestId
    };
  }

  // Already has success field - just add requestId if needed
  if (typeof response.success === 'boolean') {
    return {
      ...response,
      requestId: response.requestId || requestId
    };
  }

  // Legacy response with error field
  if (response.error) {
    return {
      success: false,
      error: response.error,
      data: response,
      requestId
    };
  }

  // Assume success for other object responses
  return {
    success: true,
    data: response,
    requestId
  };
}

// ==================== SEND REQUEST WITH TIMEOUT ====================

/**
 * Create timeout promise that rejects after specified time
 * v1.6.3.8-v2 - Issue #7: Extracted to reduce sendRequestWithTimeout complexity
 * @private
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} requestId - Request ID for error context
 * @returns {Promise} Promise that rejects on timeout
 */
function _createTimeoutPromise(timeoutMs, requestId) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(`Request timeout after ${timeoutMs}ms`);
      error.code = 'TIMEOUT';
      error.requestId = requestId;
      reject(error);
    }, timeoutMs);
  });
}

/**
 * Log request sent for debugging
 * v1.6.3.8-v2 - Issue #7: Extracted to reduce complexity
 * @private
 */
function _logRequestSent(requestId, message, timeoutMs, requireAck, startTime) {
  if (!DEBUG_MESSAGING) return;
  console.log('[MessageUtils] REQUEST_SENT:', {
    requestId,
    action: message.action || message.type,
    timeoutMs,
    requireAck,
    timestamp: startTime
  });
}

/**
 * Log successful request for debugging
 * v1.6.3.8-v2 - Issue #7: Extracted to reduce complexity
 * @private
 */
function _logRequestSuccess(requestId, action, success, durationMs) {
  if (!DEBUG_MESSAGING) return;
  console.log('[MessageUtils] MESSAGE_ACK_RECEIVED:', { requestId, action, success, durationMs, timestamp: Date.now() });
}

/**
 * Handle request error and return appropriate response
 * v1.6.3.8-v2 - Issue #7: Extracted to reduce complexity
 * @private
 */
function _handleRequestError(err, requestId, action, durationMs) {
  if (err.code === 'TIMEOUT') {
    console.warn('[MessageUtils] MESSAGE_TIMEOUT:', { requestId, action, durationMs, timestamp: Date.now() });
  } else {
    console.error('[MessageUtils] MESSAGE_ERROR:', { requestId, action, error: err.message, durationMs, timestamp: Date.now() });
  }
  return { success: false, error: err.message, requestId, code: err.code || 'ERROR' };
}

/**
 * Send a message with managed Promise resolution based on ACK/NACK
 * v1.6.3.8-v2 - Issue #7: Fix async/await race conditions
 *
 * This function:
 * 1. Generates a unique requestId for correlation
 * 2. Sends the message via runtime.sendMessage
 * 3. Manages its own timeout instead of relying on Firefox's callback timing
 * 4. Logs MESSAGE_ACK_RECEIVED or MESSAGE_TIMEOUT events
 *
 * @param {Object} message - Message to send (must have 'action' field)
 * @param {Object} [options] - Request options
 * @param {number} [options.timeoutMs=5000] - Timeout in milliseconds
 * @param {boolean} [options.requireAck=false] - Whether to require explicit ACK
 * @returns {Promise<StandardResponse>} Standardized response
 */
export async function sendRequestWithTimeout(message, options = {}) {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, requireAck = false } = options;
  const requestId = generateRequestId();
  const startTime = Date.now();
  const augmentedMessage = { ...message, requestId, timestamp: startTime };
  const action = message.action || message.type;

  _logRequestSent(requestId, message, timeoutMs, requireAck, startTime);

  try {
    const response = await Promise.race([
      _sendMessageAndWaitForResponse(augmentedMessage),
      _createTimeoutPromise(timeoutMs, requestId)
    ]);
    const normalizedResponse = normalizeResponse(response, requestId);
    _logRequestSuccess(requestId, action, normalizedResponse.success, Date.now() - startTime);
    return normalizedResponse;
  } catch (err) {
    return _handleRequestError(err, requestId, action, Date.now() - startTime);
  }
}

/**
 * Send message and wait for response
 * v1.6.3.8-v2 - Issue #7: Wrapped for error handling
 * @private
 * @param {Object} message - Message to send
 * @returns {Promise<any>} Response from background
 */
async function _sendMessageAndWaitForResponse(message) {
  try {
    const response = await browser.runtime.sendMessage(message);
    return response;
  } catch (err) {
    // Handle disconnected/no listener errors
    if (
      err.message?.includes('disconnected') ||
      err.message?.includes('no listener') ||
      err.message?.includes('Could not establish connection')
    ) {
      return {
        success: false,
        error: 'Background script not available',
        code: 'DISCONNECTED'
      };
    }
    throw err;
  }
}

// ==================== RESPONSE BUILDER UTILITIES ====================

/**
 * Build a success response with standard shape
 * v1.6.3.8-v2 - Issue #7: Helper for consistent responses
 * @param {any} [data] - Response data
 * @param {string} [requestId] - Request ID for correlation
 * @returns {StandardResponse} Success response
 */
export function buildSuccessResponse(data = null, requestId = null) {
  const response = {
    success: true,
    timestamp: Date.now()
  };

  if (data !== null && data !== undefined) {
    response.data = data;
  }

  if (requestId) {
    response.requestId = requestId;
  }

  return response;
}

/**
 * Build an error response with standard shape
 * v1.6.3.8-v2 - Issue #7: Helper for consistent error responses
 * @param {string} error - Error message
 * @param {string} [requestId] - Request ID for correlation
 * @param {string} [code] - Error code
 * @returns {StandardResponse} Error response
 */
export function buildErrorResponse(error, requestId = null, code = null) {
  const response = {
    success: false,
    error,
    timestamp: Date.now()
  };

  if (requestId) {
    response.requestId = requestId;
  }

  if (code) {
    response.code = code;
  }

  return response;
}

// ==================== EXPORTS ====================

export default {
  generateRequestId,
  isValidResponse,
  normalizeResponse,
  sendRequestWithTimeout,
  buildSuccessResponse,
  buildErrorResponse,
  DEFAULT_REQUEST_TIMEOUT_MS
};
