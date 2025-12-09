/**
 * NotificationManager - System notifications for Quick Tab events
 * v1.6.3.7-v3 - API #6: browser.notifications for user feedback
 *
 * Provides system-level notifications for Quick Tab operations:
 * - Quick Tab created
 * - Storage warnings/issues
 * - Notification click handling (opens sidebar)
 *
 * Features:
 * - Cross-platform system notifications (Windows, Mac, Linux)
 * - Auto-clear after configurable timeout
 * - Click handlers for actionable notifications
 * - Graceful handling when notifications are blocked
 *
 * Permission: "notifications" (already in manifest.json)
 */

const NOTIFICATION_ICON = '/icons/icon-48.png';
const NOTIFICATION_AUTO_CLEAR_MS = 5000; // 5 seconds

/**
 * Notification priority levels
 * v1.6.3.7-v3 - API #6: Priority constants
 */
const NOTIFICATION_PRIORITY = {
  LOW: 0,
  DEFAULT: 1,
  HIGH: 2
};

/**
 * NotificationManager - Static class for system notifications
 * v1.6.3.7-v3 - API #6: Firefox notifications API wrapper
 */
class NotificationManager {
  /**
   * Check if notifications API is available
   * v1.6.3.7-v3 - API #6: Feature detection
   * @returns {boolean} True if notifications API is available
   */
  static isAvailable() {
    return typeof browser !== 'undefined' &&
           typeof browser.notifications !== 'undefined' &&
           typeof browser.notifications.create === 'function';
  }

  /**
   * Send notification when Quick Tab is created
   * v1.6.3.7-v3 - API #6: User feedback for Quick Tab creation
   * @param {Object} quickTab - Quick Tab data (id, title, url)
   * @returns {Promise<string|null>} Notification ID or null if failed
   */
  static async notifyQuickTabCreated(quickTab) {
    if (!this.isAvailable()) {
      console.warn('[NotificationManager] Notifications API not available');
      return null;
    }

    if (!quickTab || !quickTab.id) {
      console.warn('[NotificationManager] Invalid Quick Tab data');
      return null;
    }

    try {
      const notificationId = `qt-created-${quickTab.id}`;
      const title = quickTab.title || 'Quick Tab';
      const truncatedTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

      console.log('[NotificationManager] Creating Quick Tab notification:', {
        id: notificationId,
        title: truncatedTitle
      });

      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: NOTIFICATION_ICON,
        title: 'Quick Tab Created',
        message: `"${truncatedTitle}" is now a Quick Tab`,
        priority: NOTIFICATION_PRIORITY.DEFAULT
      });

      // Auto-clear after timeout
      this._scheduleAutoClear(notificationId, NOTIFICATION_AUTO_CLEAR_MS);

      console.log('[NotificationManager] Notification created:', notificationId);
      return notificationId;
    } catch (err) {
      // Handle permission denied or other errors gracefully
      console.warn('[NotificationManager] Failed to create notification:', err.message);
      return null;
    }
  }

  /**
   * Send notification for storage warnings
   * v1.6.3.7-v3 - API #6: Storage issue alerts
   * @param {string} message - Warning message to display
   * @returns {Promise<string|null>} Notification ID or null if failed
   */
  static async notifyStorageWarning(message) {
    if (!this.isAvailable()) {
      console.warn('[NotificationManager] Notifications API not available');
      return null;
    }

    try {
      const notificationId = `qt-storage-warning-${Date.now()}`;

      console.log('[NotificationManager] Creating storage warning notification:', {
        id: notificationId,
        message
      });

      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: NOTIFICATION_ICON,
        title: 'Quick Tabs Storage Issue',
        message: message || 'A storage issue was detected',
        priority: NOTIFICATION_PRIORITY.HIGH
      });

      // Auto-clear after timeout (longer for warnings)
      this._scheduleAutoClear(notificationId, NOTIFICATION_AUTO_CLEAR_MS * 2);

      console.log('[NotificationManager] Storage warning notification created:', notificationId);
      return notificationId;
    } catch (err) {
      console.warn('[NotificationManager] Failed to create warning notification:', err.message);
      return null;
    }
  }

  /**
   * Send generic notification
   * v1.6.3.7-v3 - API #6: Generic notification helper
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Object} options - Additional options { priority, autoClearMs }
   * @returns {Promise<string|null>} Notification ID or null if failed
   */
  static async notify(title, message, options = {}) {
    if (!this.isAvailable()) {
      console.warn('[NotificationManager] Notifications API not available');
      return null;
    }

    try {
      const notificationId = `qt-notify-${Date.now()}`;
      const priority = options.priority ?? NOTIFICATION_PRIORITY.DEFAULT;
      const autoClearMs = options.autoClearMs ?? NOTIFICATION_AUTO_CLEAR_MS;

      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: NOTIFICATION_ICON,
        title: title,
        message: message,
        priority: priority
      });

      this._scheduleAutoClear(notificationId, autoClearMs);

      console.log('[NotificationManager] Generic notification created:', notificationId);
      return notificationId;
    } catch (err) {
      console.warn('[NotificationManager] Failed to create notification:', err.message);
      return null;
    }
  }

  /**
   * Clear a notification by ID
   * v1.6.3.7-v3 - API #6: Manual notification clearing
   * @param {string} notificationId - Notification ID to clear
   * @returns {Promise<boolean>} True if cleared successfully
   */
  static async clear(notificationId) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const wasCleared = await browser.notifications.clear(notificationId);
      console.log('[NotificationManager] Notification cleared:', { notificationId, wasCleared });
      return wasCleared;
    } catch (err) {
      console.warn('[NotificationManager] Failed to clear notification:', err.message);
      return false;
    }
  }

  /**
   * Handle notification click events
   * v1.6.3.7-v3 - API #6: Click handler for notifications
   * This should be called from background.js when notifications.onClicked fires
   * @param {string} notificationId - Clicked notification ID
   * @returns {Promise<void>}
   */
  static async handleNotificationClick(notificationId) {
    console.log('[NotificationManager] Notification clicked:', notificationId);

    try {
      // If it's a Quick Tab created notification, open the sidebar
      if (notificationId.startsWith('qt-created-')) {
        await this._openSidebar();
        console.log('[NotificationManager] Sidebar opened for Quick Tab notification');
      }

      // Clear the notification after handling
      await this.clear(notificationId);
    } catch (err) {
      console.error('[NotificationManager] Error handling notification click:', err.message);
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Schedule auto-clear for a notification
   * @private
   * @param {string} notificationId - Notification ID to clear
   * @param {number} delayMs - Delay in milliseconds
   */
  static _scheduleAutoClear(notificationId, delayMs) {
    setTimeout(async () => {
      try {
        await browser.notifications.clear(notificationId);
        console.log('[NotificationManager] Auto-cleared notification:', notificationId);
      } catch (_err) {
        // Notification may already be cleared by user - ignore
      }
    }, delayMs);
  }

  /**
   * Open the sidebar
   * @private
   * @returns {Promise<void>}
   */
  static async _openSidebar() {
    if (typeof browser?.sidebarAction?.open === 'function') {
      await browser.sidebarAction.open();
    } else {
      console.warn('[NotificationManager] sidebarAction.open not available');
    }
  }
}

/**
 * Initialize notification click listener
 * v1.6.3.7-v3 - API #6: Should be called from background.js
 * @returns {boolean} True if listener was registered
 */
function initNotificationClickListener() {
  if (!NotificationManager.isAvailable()) {
    console.warn('[NotificationManager] Cannot init click listener - notifications not available');
    return false;
  }

  if (typeof browser.notifications.onClicked === 'undefined') {
    console.warn('[NotificationManager] notifications.onClicked not available');
    return false;
  }

  browser.notifications.onClicked.addListener((notificationId) => {
    NotificationManager.handleNotificationClick(notificationId);
  });

  console.log('[NotificationManager] Notification click listener registered');
  return true;
}

export { NotificationManager, initNotificationClickListener, NOTIFICATION_PRIORITY };
