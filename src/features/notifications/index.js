/**
 * Notifications Feature Module
 * Handles tooltip and toast notifications with animations
 *
 * v1.5.9.0 - Extracted from content.js following modular-architecture-blueprint.md
 */

import { createElement } from '../../utils/dom.js';
import { CONSTANTS } from '../../core/config.js';

/**
 * NotificationManager - Handles all notification display
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

    // Inject notification styles
    this.injectStyles();

    console.log('[NotificationManager] Initialized successfully');
  }

  /**
   * Inject notification CSS animations and styles
   */
  injectStyles() {
    if (this.styleInjected) return;

    const styleElement = document.createElement('style');
    styleElement.id = 'cuo-notification-styles';
    styleElement.textContent = `
      /* Notification Animations */
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      
      @keyframes slideInLeft {
        from { transform: translateX(-100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
      
      .cuo-anim-slide { animation: slideInRight 0.3s ease-out; }
      .cuo-anim-fade { animation: fadeIn 0.3s ease-out; }
      .cuo-anim-bounce { animation: bounce 0.5s ease-out; }
    `;

    document.head.appendChild(styleElement);
    this.styleInjected = true;
    console.log('[NotificationManager] Styles injected');
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
    const existing = document.getElementById('copy-url-tooltip');
    if (existing) existing.remove();

    const mouseX = this.stateManager?.get('lastMouseX') || 0;
    const mouseY = this.stateManager?.get('lastMouseY') || 0;

    // Determine animation class
    let animClass = 'cuo-anim-fade';
    if (this.config.tooltipAnimation === 'bounce') {
      animClass = 'cuo-anim-bounce';
    }

    const tooltip = createElement(
      'div',
      {
        id: 'copy-url-tooltip',
        className: animClass,
        style: {
          position: 'fixed',
          left: `${mouseX + CONSTANTS.TOOLTIP_OFFSET_X}px`,
          top: `${mouseY + CONSTANTS.TOOLTIP_OFFSET_Y}px`,
          backgroundColor: this.config.tooltipColor || '#333',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '14px',
          zIndex: '999999999',
          pointerEvents: 'none',
          opacity: '1'
        }
      },
      message
    );

    document.body.appendChild(tooltip);

    setTimeout(() => {
      tooltip.style.opacity = '0';
      tooltip.style.transition = 'opacity 0.2s';
      setTimeout(() => tooltip.remove(), CONSTANTS.TOOLTIP_FADE_OUT_MS);
    }, this.config.tooltipDuration || 1000);

    console.log('[NotificationManager] Tooltip displayed');
  }

  /**
   * Show toast notification (for Quick Tabs - appears in corner)
   */
  showToast(message, _type) {
    const existing = document.getElementById('copy-url-toast');
    if (existing) existing.remove();

    const positions = {
      'top-left': { top: '20px', left: '20px' },
      'top-right': { top: '20px', right: '20px' },
      'bottom-left': { bottom: '20px', left: '20px' },
      'bottom-right': { bottom: '20px', right: '20px' }
    };

    const pos = positions[this.config.notifPosition] || positions['bottom-right'];

    // Determine animation class
    let animClass = 'cuo-anim-fade'; // Default
    if (this.config.notifAnimation === 'slide') {
      animClass = 'cuo-anim-slide';
    } else if (this.config.notifAnimation === 'bounce') {
      animClass = 'cuo-anim-bounce';
    }

    // Ensure border width is a number
    const borderWidth = parseInt(this.config.notifBorderWidth) || 1;

    const toast = createElement(
      'div',
      {
        id: 'copy-url-toast',
        className: animClass,
        style: {
          position: 'fixed',
          ...pos,
          backgroundColor: this.config.notifColor || '#333',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '4px',
          fontSize: '14px',
          zIndex: '999999998',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          border: `${borderWidth}px solid ${this.config.notifBorderColor || '#444'}`,
          pointerEvents: 'none',
          opacity: '1'
        }
      },
      message
    );

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, this.config.notifDuration || 2000);

    console.log('[NotificationManager] Toast displayed');
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
 * Export manager instance for direct access
 */
export { notificationManager };
