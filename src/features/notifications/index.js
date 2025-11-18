/**
 * Notifications Feature Module
 * Handles tooltip and toast notifications with animations
 *
 * v1.5.8.10 - Hybrid Architecture: Modularized with separate toast/tooltip files
 * and CSS extracted to ui/css/notifications.css
 */

import { showToast } from './toast.js';
import { showTooltip } from './tooltip.js';

// CSS content will be injected from string
const notificationsCss = `
/* Notification Animations */
@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* Animation Classes */
.cuo-anim-slide {
  animation: slideInRight 0.3s ease-out;
}

.cuo-anim-fade {
  animation: fadeIn 0.3s ease-out;
}

.cuo-anim-bounce {
  animation: bounce 0.5s ease-out;
}

/* Tooltip Base Styles */
.cuo-tooltip {
  position: fixed;
  background-color: #333;
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  z-index: 999999999;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.2s;
}

/* Toast Base Styles */
.cuo-toast {
  position: fixed;
  background-color: #333;
  color: white;
  padding: 12px 20px;
  border-radius: 4px;
  font-size: 14px;
  z-index: 999999998;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  border: 1px solid #444;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.3s;
}
`;

/**
 * NotificationManager - Coordinates notification display
 */
class NotificationManager {
  constructor() {
    this.config = null;
    this.stateManager = null;
    this.styleInjected = false;
  }

  /**
   * Initialize the notification manager
   */
  init(config, stateManager) {
    this.config = config;
    this.stateManager = stateManager;

    console.log('[NotificationManager] Initializing...');

    // Inject notification styles from CSS module
    this.injectStyles();

    console.log('[NotificationManager] Initialized successfully');
  }

  /**
   * Inject notification CSS from external CSS module
   */
  injectStyles() {
    if (this.styleInjected) return;

    const styleElement = document.createElement('style');
    styleElement.id = 'cuo-notification-styles';
    styleElement.textContent = notificationsCss;

    document.head.appendChild(styleElement);
    this.styleInjected = true;
    console.log('[NotificationManager] Styles injected from CSS module');
  }

  /**
   * Show a notification (auto-selects tooltip or toast based on config)
   */
  showNotification(message, type = 'info') {
    if (!this.config || !this.config.showNotification) {
      console.log('[NotificationManager] Notifications disabled');
      return;
    }

    console.log('[NotificationManager] Showing notification:', message, type);

    if (this.config.notifDisplayMode === 'tooltip') {
      this.showTooltip(message);
    } else {
      this.showToast(message, type);
    }
  }

  /**
   * Show tooltip notification (for Copy URL - appears at cursor)
   */
  showTooltip(message) {
    showTooltip(message, this.config, this.stateManager);
  }

  /**
   * Show toast notification (for Quick Tabs - appears in corner)
   */
  showToast(message, type = 'info') {
    showToast(message, type, this.config);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = newConfig;
    console.log('[NotificationManager] Configuration updated');
  }
}

// Create singleton instance
const notificationManager = new NotificationManager();

/**
 * Initialize Notifications feature
 * Called from content.js during initialization
 */
export function initNotifications(config, stateManager) {
  console.log('[Notifications] Initializing Notifications feature module...');
  notificationManager.init(config, stateManager);
  console.log('[Notifications] Notifications feature module initialized');
  return notificationManager;
}

/**
 * Export public API
 */
export { notificationManager, showTooltip, showToast };
