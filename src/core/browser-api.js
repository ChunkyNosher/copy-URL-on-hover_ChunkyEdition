/**
 * Browser API Utilities
 * Wrapper functions for WebExtension APIs
 */

import { logNormal, logError } from '../utils/logger.js';

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
    console.error('[Browser API] Failed to get storage:', err);
    throw err;
  }
}

/**
 * Set data in storage
 * @param {object} data - Data to store
 * @param {string} storageType - Storage type (local, sync, or session)
 * @returns {Promise<void>}
 */
export async function setStorage(data, storageType = 'local') {
  try {
    const storage = browser.storage[storageType];
    if (!storage) {
      throw new Error(`Storage type "${storageType}" not available`);
    }
    await storage.set(data);
  } catch (err) {
    console.error('[Browser API] Failed to set storage:', err);
    throw err;
  }
}

/**
 * Remove data from storage
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
    console.error('[Browser API] Failed to remove storage:', err);
    throw err;
  }
}

/**
 * Clear all data from storage
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
    console.error('[Browser API] Failed to clear storage:', err);
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
 * Get container information (Firefox only)
 * @param {number} containerId - Container ID
 * @returns {Promise<object|null>} Container information
 */
export async function getContainer(containerId) {
  try {
    if (browser.contextualIdentities && browser.contextualIdentities.get) {
      return await browser.contextualIdentities.get(`firefox-container-${containerId}`);
    }
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
