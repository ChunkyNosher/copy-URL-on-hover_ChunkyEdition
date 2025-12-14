// Broadcast Manager
// Handles broadcasting state updates to all tabs with proper error handling

import { MESSAGE_TYPES } from '../messaging/message-router.js';
import { generateCorrelationId } from '../storage/storage-manager.js';

// Track broadcast metrics
let broadcastMetrics = {
  totalBroadcasts: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
  lastBroadcastTime: null
};

/**
 * Broadcast a state update to all content scripts
 *
 * @param {Object} state - The current Quick Tabs state
 * @param {Object} options - Broadcast options
 * @param {number|null} options.excludeTabId - Tab ID to exclude from broadcast
 * @param {boolean} options.includeOnlyHttpTabs - Only send to HTTP tabs (default: true)
 * @param {number} options.timeout - Timeout in ms for each send (default: 2000)
 * @returns {Promise<Object>} Broadcast result with success flag and metrics
 */
export async function broadcastToAllTabs(state, options = {}) {
  const {
    excludeTabId = null,
    includeOnlyHttpTabs = true,
    timeout = 2000
  } = options;

  broadcastMetrics.totalBroadcasts++;
  broadcastMetrics.lastBroadcastTime = Date.now();

  try {
    const tabs = await browser.tabs.query({});
    const correlationId = generateCorrelationId('broadcast');

    const targetTabs = tabs.filter(tab => {
      // Exclude specified tab
      if (excludeTabId && tab.id === excludeTabId) return false;

      // Only include HTTP tabs if specified
      if (includeOnlyHttpTabs && !tab.url?.startsWith('http')) return false;

      // Exclude internal browser pages
      if (tab.url?.startsWith('about:') || tab.url?.startsWith('chrome:')) {
        return false;
      }

      return true;
    });

    const message = {
      type: MESSAGE_TYPES.QT_STATE_SYNC,
      state: state,
      correlationId,
      timestamp: Date.now(),
      source: 'broadcast-manager'
    };

    const results = await Promise.allSettled(
      targetTabs.map(tab => sendWithTimeout(tab.id, message, timeout))
    );

    // Track metrics
    let successCount = 0;
    let failCount = 0;

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value?.success !== false) {
        successCount++;
      } else {
        failCount++;
        // Don't log as error - tab might not have content script ready
      }
    });

    broadcastMetrics.successfulDeliveries += successCount;
    broadcastMetrics.failedDeliveries += failCount;

    console.log('[BroadcastManager] Broadcast complete:', {
      correlationId,
      targetTabs: targetTabs.length,
      success: successCount,
      failed: failCount
    });

    return {
      success: true,
      correlationId,
      delivered: successCount,
      failed: failCount
    };
  } catch (error) {
    console.error('[BroadcastManager] Broadcast failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send message to a specific tab with timeout
 *
 * @param {number} tabId - Tab ID to send to
 * @param {Object} message - Message to send
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Send result
 */
async function sendWithTimeout(tabId, message, timeout) {
  return new Promise(resolve => {
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, timeout: true });
      }
    }, timeout);

    browser.tabs
      .sendMessage(tabId, message)
      .then(response => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(response || { success: true });
        }
      })
      .catch(error => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve({ success: false, error: error.message });
        }
      });
  });
}

/**
 * Send state update to a specific tab
 *
 * @param {number} tabId - Target tab ID
 * @param {Object} state - State to send
 * @returns {Promise<Object>} Send result
 */
export async function sendToTab(tabId, state) {
  try {
    const message = {
      type: MESSAGE_TYPES.QT_STATE_SYNC,
      state: state,
      correlationId: generateCorrelationId('single-tab'),
      timestamp: Date.now()
    };

    const response = await browser.tabs.sendMessage(tabId, message);
    return { success: true, response };
  } catch (error) {
    console.warn(
      '[BroadcastManager] Failed to send to tab',
      tabId,
      error.message
    );
    return { success: false, error: error.message };
  }
}

/**
 * Notify the sidebar manager
 *
 * @param {Object} state - State to send to sidebar
 * @returns {Promise<Object>} Send result
 */
export async function notifySidebar(state) {
  try {
    const message = {
      type: MESSAGE_TYPES.SIDEBAR_UPDATE,
      state: state,
      correlationId: generateCorrelationId('sidebar'),
      timestamp: Date.now()
    };

    // Use runtime.sendMessage for sidebar (not tabs.sendMessage)
    await browser.runtime.sendMessage(message);
    return { success: true };
  } catch (_error) {
    // Sidebar might not be open - this is OK
    return { success: false, error: 'Sidebar not open' };
  }
}

/**
 * Get broadcast metrics
 *
 * @returns {Object} Copy of broadcast metrics
 */
export function getBroadcastMetrics() {
  return { ...broadcastMetrics };
}

/**
 * Reset broadcast metrics
 */
export function resetBroadcastMetrics() {
  broadcastMetrics = {
    totalBroadcasts: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    lastBroadcastTime: null
  };
}
