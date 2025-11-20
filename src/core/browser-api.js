/**
 * Browser API Utilities
 * Wrapper functions for WebExtension APIs
 */

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
 * @param {string} text - Text to copy
 * @returns {boolean} True if successful
 */
function fallbackCopyToClipboard(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!success) {
      console.error('[Browser API] execCommand copy returned false');
    }

    return success;
  } catch (fallbackErr) {
    console.error('[Browser API] Fallback copy also failed:', fallbackErr);
    return false;
  }
}

/**
 * Copy text to clipboard
 * v1.6.0.1 - Added validation and improved error logging
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if successful
 */
export async function copyToClipboard(text) {
  // Validate input
  if (!text || typeof text !== 'string') {
    console.error('[Browser API] Invalid text for clipboard:', text);
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('[Browser API] Failed to copy to clipboard:', {
      message: err.message,
      name: err.name,
      stack: err.stack,
      textLength: text.length,
      textPreview: text.substring(0, 50)
    });

    // Fallback to execCommand
    return fallbackCopyToClipboard(text);
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
