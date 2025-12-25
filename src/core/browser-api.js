/**
 * Browser API Utilities
 * Wrapper functions for WebExtension APIs
 * v1.6.3.10-v9 - FIX Issue C: Add error classification for storage operations
 */

import { logNormal, logError } from '../utils/logger.js';

/**
 * Storage error types for classification
 * v1.6.3.10-v9 - FIX Issue C: Error type classification
 * @enum {string}
 */
export const STORAGE_ERROR_TYPE = {
  QUOTA: 'QUOTA', // Storage quota exceeded
  PERMISSION: 'PERMISSION', // Permission denied
  UNAVAILABLE: 'UNAVAILABLE', // Storage API not available
  TRANSIENT: 'TRANSIENT', // Temporary failure (retry may help)
  UNKNOWN: 'UNKNOWN' // Unknown error type
};

/**
 * Check if error message matches quota-related patterns
 * v1.6.3.10-v9 - FIX Issue C: Helper for error classification
 * @private
 */
function _isQuotaError(message, name) {
  return (
    message.includes('quota') ||
    message.includes('exceeded') ||
    message.includes('bytes') ||
    name === 'quotaexceedederror'
  );
}

/**
 * Check if error message matches permission-related patterns
 * v1.6.3.10-v9 - FIX Issue C: Helper for error classification
 * @private
 */
function _isPermissionError(message, name) {
  return (
    message.includes('permission') ||
    message.includes('denied') ||
    name === 'securityerror' ||
    name === 'notallowederror'
  );
}

/**
 * Check if error message matches unavailable-related patterns
 * v1.6.3.10-v9 - FIX Issue C: Helper for error classification
 * @private
 */
function _isUnavailableError(message) {
  return (
    message.includes('unavailable') ||
    message.includes('not found') ||
    message.includes('not supported') ||
    message.includes('undefined')
  );
}

/**
 * Check if error message matches transient-related patterns
 * v1.6.3.10-v9 - FIX Issue C: Helper for error classification
 * @private
 */
function _isTransientError(message) {
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('aborted') ||
    message.includes('interrupted')
  );
}

/**
 * Classify a storage error into a type
 * v1.6.3.10-v9 - FIX Issue C: Error classification helper (refactored for complexity)
 * @param {Error} err - Error to classify
 * @returns {string} Error type from STORAGE_ERROR_TYPE
 */
export function classifyStorageError(err) {
  if (!err) return STORAGE_ERROR_TYPE.UNKNOWN;

  const message = (err.message || '').toLowerCase();
  const name = (err.name || '').toLowerCase();

  if (_isQuotaError(message, name)) return STORAGE_ERROR_TYPE.QUOTA;
  if (_isPermissionError(message, name)) return STORAGE_ERROR_TYPE.PERMISSION;
  if (_isUnavailableError(message)) return STORAGE_ERROR_TYPE.UNAVAILABLE;
  if (_isTransientError(message)) return STORAGE_ERROR_TYPE.TRANSIENT;

  return STORAGE_ERROR_TYPE.UNKNOWN;
}

/**
 * Log storage error with classification
 * v1.6.3.10-v9 - FIX Issue C: Enhanced error logging
 * @param {string} operation - Operation type (get, set, remove, clear)
 * @param {Error} err - Error object
 * @param {Object} context - Additional context
 */
function logStorageError(operation, err, context = {}) {
  const errorType = classifyStorageError(err);

  console.error(`[Browser API] Storage ${operation} failed:`, {
    errorType,
    errorName: err?.name,
    errorMessage: err?.message,
    errorStack: err?.stack,
    operation,
    ...context
  });
}

/**
 * Send message to background script
 * @param {object} message - Message object
 * @returns {Promise<any>} Response from background script
 */
export async function sendMessageToBackground(message) {
  try {
    return await browser.runtime.sendMessage(message);
  } catch (err) {
    console.error('[Browser API] Failed to send message to background:', err);
    throw err;
  }
}

/**
 * Get data from storage
 * v1.6.3.10-v9 - FIX Issue C: Add error classification and enhanced logging
 * @param {string|string[]} keys - Storage key(s)
 * @param {string} storageType - Storage type (local, sync, or session)
 * @returns {Promise<object>} Storage data
 */
export async function getStorage(keys, storageType = 'local') {
  try {
    const storage = browser.storage[storageType];
    if (!storage) {
      throw new Error(`Storage type "${storageType}" not available`);
    }
    return await storage.get(keys);
  } catch (err) {
    // v1.6.3.10-v9 - FIX Issue C: Classify error type
    const errorType = classifyStorageError(err);
    logStorageError('get', err, {
      storageType,
      keys: Array.isArray(keys) ? keys : [keys],
      keyCount: Array.isArray(keys) ? keys.length : 1
    });

    // Rethrow with enhanced info
    err.storageErrorType = errorType;
    throw err;
  }
}

/**
 * Set data in storage
 * v1.6.3.10-v9 - FIX Issue C: Add error classification and bytes estimate
 * @param {object} data - Data to store
 * @param {string} storageType - Storage type (local, sync, or session)
 * @returns {Promise<void>}
 */
export async function setStorage(data, storageType = 'local') {
  // v1.6.3.10-v9 - FIX Issue C: Estimate bytes for logging
  let bytesEstimate = 0;
  try {
    bytesEstimate = new Blob([JSON.stringify(data)]).size;
  } catch (estimateErr) {
    // Log debug info for serialization issues
    console.debug('[Browser API] Bytes estimation failed:', estimateErr.message);
  }

  try {
    const storage = browser.storage[storageType];
    if (!storage) {
      throw new Error(`Storage type "${storageType}" not available`);
    }
    await storage.set(data);
  } catch (err) {
    // v1.6.3.10-v9 - FIX Issue C: Classify error type with bytes estimate
    const errorType = classifyStorageError(err);
    logStorageError('set', err, {
      storageType,
      keyCount: Object.keys(data).length,
      bytesEstimate
    });

    // Rethrow with enhanced info
    err.storageErrorType = errorType;
    err.bytesAttempted = bytesEstimate;
    throw err;
  }
}

/**
 * Remove data from storage
 * v1.6.3.10-v9 - FIX Issue C: Add error classification
 * @param {string|string[]} keys - Storage key(s) to remove
 * @param {string} storageType - Storage type (local, sync, or session)
 * @returns {Promise<void>}
 */
export async function removeStorage(keys, storageType = 'local') {
  try {
    const storage = browser.storage[storageType];
    if (!storage) {
      throw new Error(`Storage type "${storageType}" not available`);
    }
    await storage.remove(keys);
  } catch (err) {
    // v1.6.3.10-v9 - FIX Issue C: Classify error type
    const errorType = classifyStorageError(err);
    logStorageError('remove', err, {
      storageType,
      keys: Array.isArray(keys) ? keys : [keys],
      keyCount: Array.isArray(keys) ? keys.length : 1
    });

    // Rethrow with enhanced info
    err.storageErrorType = errorType;
    throw err;
  }
}

/**
 * Clear all data from storage
 * v1.6.3.10-v9 - FIX Issue C: Add error classification
 * @param {string} storageType - Storage type (local, sync, or session)
 * @returns {Promise<void>}
 */
export async function clearStorage(storageType = 'local') {
  try {
    const storage = browser.storage[storageType];
    if (!storage) {
      throw new Error(`Storage type "${storageType}" not available`);
    }
    await storage.clear();
  } catch (err) {
    // v1.6.3.10-v9 - FIX Issue C: Classify error type
    const errorType = classifyStorageError(err);
    logStorageError('clear', err, {
      storageType
    });

    // Rethrow with enhanced info
    err.storageErrorType = errorType;
    throw err;
  }
}

/**
 * Fallback clipboard copy using execCommand
 * v1.6.0.7 - Enhanced logging for fallback clipboard operations
 * @param {string} text - Text to copy
 * @returns {boolean} True if successful
 */
function fallbackCopyToClipboard(text) {
  logNormal('clipboard', 'Fallback', 'Using execCommand method', {
    reason: 'Clipboard API failed',
    textLength: text.length,
    textPreview: text.substring(0, 50)
  });

  try {
    const fallbackStart = performance.now();
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    const fallbackDuration = performance.now() - fallbackStart;

    logNormal('clipboard', 'Fallback', 'execCommand result', {
      success: success,
      duration: `${fallbackDuration.toFixed(2)}ms`
    });

    if (!success) {
      logError('clipboard', 'Fallback', 'execCommand copy returned false', {
        textLength: text.length
      });
    }

    return success;
  } catch (fallbackErr) {
    logError('clipboard', 'Fallback', 'Fallback copy also failed', {
      error: fallbackErr,
      message: fallbackErr.message,
      stack: fallbackErr.stack
    });
    return false;
  }
}

/**
 * Copy text to clipboard
 * v1.6.0.1 - Added validation and improved error logging
 * v1.6.0.7 - Enhanced logging for clipboard API interactions
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if successful
 */
export async function copyToClipboard(text) {
  logNormal('clipboard', 'Start', 'Copy attempt started', {
    textLength: text?.length || 0,
    textPreview: text?.substring(0, 100) || '<empty>',
    clipboardAPIAvailable: !!navigator.clipboard,
    execCommandAvailable: !!document.execCommand,
    userAgent: navigator.userAgent
  });

  // Validate input
  if (!text || typeof text !== 'string') {
    logError('clipboard', 'Validation', 'Invalid text for clipboard', {
      textType: typeof text,
      textValue: text
    });
    return false;
  }

  logNormal('clipboard', 'API Selection', 'Using navigator.clipboard API', {
    method: 'navigator.clipboard.writeText'
  });

  try {
    const apiStart = performance.now();
    await navigator.clipboard.writeText(text);
    const apiDuration = performance.now() - apiStart;

    logNormal('clipboard', 'Success', 'Clipboard API copy successful', {
      method: 'navigator.clipboard.writeText',
      textLength: text.length,
      duration: `${apiDuration.toFixed(2)}ms`
    });

    return true;
  } catch (err) {
    logError('clipboard', 'Failure', 'Clipboard API failed', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
      textLength: text.length,
      textPreview: text.substring(0, 50),
      permissionDenied: err.name === 'NotAllowedError'
    });

    logNormal('clipboard', 'Fallback', 'Attempting execCommand fallback');

    // Fallback to execCommand
    const fallbackResult = fallbackCopyToClipboard(text);

    logNormal('clipboard', 'Final Result', 'Copy operation final result', {
      success: fallbackResult,
      methodUsed: 'execCommand-fallback'
    });

    return fallbackResult;
  }
}

/**
 * Get current tab information
 * @returns {Promise<object>} Tab information
 */
export async function getCurrentTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  } catch (err) {
    console.error('[Browser API] Failed to get current tab:', err);
    return null;
  }
}

/**
 * Create a new tab
 * @param {object} options - Tab creation options
 * @returns {Promise<object>} Created tab
 */
export async function createTab(options) {
  try {
    return await browser.tabs.create(options);
  } catch (err) {
    console.error('[Browser API] Failed to create tab:', err);
    throw err;
  }
}

/**
 * Get container information
 * Cross-browser: Firefox returns container info, Chrome returns null (no container support)
 * @param {number} containerId - Container ID
 * @returns {Promise<object|null>} Container information or null if not supported
 */
export async function getContainer(containerId) {
  try {
    if (browser.contextualIdentities && browser.contextualIdentities.get) {
      return await browser.contextualIdentities.get(`firefox-container-${containerId}`);
    }
    // Chrome/Edge: No container support, return null
    return null;
  } catch (err) {
    console.error('[Browser API] Failed to get container:', err);
    return null;
  }
}

/**
 * Check if browser supports a specific API
 * @param {string} apiPath - API path (e.g., 'storage.session')
 * @returns {boolean} True if API is supported
 */
export function isApiSupported(apiPath) {
  const parts = apiPath.split('.');
  let current = browser;

  for (const part of parts) {
    if (!current || !current[part]) {
      return false;
    }
    current = current[part];
  }

  return true;
}
