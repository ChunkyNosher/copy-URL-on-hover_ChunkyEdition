/**
 * Browser API Utilities
 * Wrapper functions for WebExtension APIs
 */

import { DEFAULT_CONTAINER_ID } from '../constants.js';
import { logNormal, logError } from '../utils/logger.js';

// Re-export for consumers that import from browser-api.js
export { DEFAULT_CONTAINER_ID };

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

// =============================================================================
// v1.6.3.9-v2 - Issue #6: Container-Aware Query Functions
// =============================================================================

/**
 * Get tabs organized by container
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @param {number|null} windowId - Optional window ID (defaults to current window)
 * @returns {Promise<Map<string, Array>>} Map of containerId → tabs array
 */
export async function getTabsByContainer(windowId = null) {
  try {
    const query = windowId ? { windowId } : { currentWindow: true };
    const tabs = await browser.tabs.query(query);

    const byContainer = new Map();
    tabs.forEach(tab => {
      const containerId = tab.cookieStoreId || DEFAULT_CONTAINER_ID;
      if (!byContainer.has(containerId)) {
        byContainer.set(containerId, []);
      }
      byContainer.get(containerId).push(tab);
    });

    return byContainer;
  } catch (err) {
    console.error('[Browser API] Failed to get tabs by container:', err);
    return new Map();
  }
}

/**
 * Check if tab is in the expected container
 * v1.6.3.9-v2 - Extracted to reduce validateTabExists max-depth
 * @private
 */
function _isTabInExpectedContainer(tab, expectedContainer, tabId) {
  const tabContainerId = tab.cookieStoreId || DEFAULT_CONTAINER_ID;
  if (tabContainerId !== expectedContainer) {
    console.log('[Browser API] Tab in different container:', {
      tabId,
      expectedContainer,
      actualContainer: tabContainerId
    });
    return false;
  }
  return true;
}

/**
 * Validate tab exists and is in expected container
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 * v1.6.3.9-v2 - Refactored to reduce max-depth
 *
 * @param {number} tabId - Tab ID to validate
 * @param {string|null} expectedContainer - Expected container ID (null to skip container check)
 * @returns {Promise<Object|null>} Tab object if valid, null if not found or wrong container
 */
export async function validateTabExists(tabId, expectedContainer = null) {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const tab = tabs.find(t => t.id === tabId);

    if (!tab) return null; // Tab closed

    if (expectedContainer && !_isTabInExpectedContainer(tab, expectedContainer, tabId)) {
      return null;
    }

    return tab;
  } catch (err) {
    console.error('[Browser API] Tab validation failed:', err);
    return null;
  }
}

/**
 * Get container ID for a specific tab
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<string>} Container ID (defaults to 'firefox-default')
 */
export async function getTabContainerId(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    return tab.cookieStoreId || DEFAULT_CONTAINER_ID;
  } catch (err) {
    console.error('[Browser API] Failed to get tab container ID:', err);
    return DEFAULT_CONTAINER_ID;
  }
}

/**
 * Check if two tabs are in the same container
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @param {number} tabId1 - First tab ID
 * @param {number} tabId2 - Second tab ID
 * @returns {Promise<boolean>} True if tabs are in the same container
 */
export async function areTabsInSameContainer(tabId1, tabId2) {
  try {
    const [tab1, tab2] = await Promise.all([browser.tabs.get(tabId1), browser.tabs.get(tabId2)]);

    const containerId1 = tab1.cookieStoreId || DEFAULT_CONTAINER_ID;
    const containerId2 = tab2.cookieStoreId || DEFAULT_CONTAINER_ID;

    return containerId1 === containerId2;
  } catch (err) {
    console.error('[Browser API] Failed to compare tab containers:', err);
    return false;
  }
}

/**
 * Get all container contexts (for displaying in Manager)
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @returns {Promise<Array<{id: string, name: string, color: string}>>} Array of container info
 */
export async function getAllContainers() {
  try {
    // Check if contextualIdentities API is available
    if (!browser.contextualIdentities || !browser.contextualIdentities.query) {
      // Return just the default container if API not available
      return [{ id: DEFAULT_CONTAINER_ID, name: 'Default', color: 'grey' }];
    }

    const identities = await browser.contextualIdentities.query({});

    // Add default container to the list
    const containers = [{ id: DEFAULT_CONTAINER_ID, name: 'Default', color: 'grey' }];

    for (const identity of identities) {
      containers.push({
        id: identity.cookieStoreId,
        name: identity.name,
        color: identity.color
      });
    }

    return containers;
  } catch (err) {
    console.error('[Browser API] Failed to get containers:', err);
    return [{ id: DEFAULT_CONTAINER_ID, name: 'Default', color: 'grey' }];
  }
}
