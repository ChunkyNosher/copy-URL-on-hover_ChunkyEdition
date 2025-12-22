/**
 * Toast Notification Module
 * Handles toast notifications (for Quick Tabs - appears in corner)
 * v1.5.8.10 - Extracted from notifications/index.js
 * v1.6.3.11-v4 - FIX Issue #3: Added error handling with try-catch and fallback
 */

import { createElement } from '../../core/dom.js';

/**
 * Get position styles for toast
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _getPositionStyles(config) {
  const positions = {
    'top-left': { top: '20px', left: '20px' },
    'top-right': { top: '20px', right: '20px' },
    'bottom-left': { bottom: '20px', left: '20px' },
    'bottom-right': { bottom: '20px', right: '20px' }
  };
  return positions[config?.notifPosition] || positions['bottom-right'];
}

/**
 * Get animation class for toast
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _getAnimationClass(config) {
  if (config?.notifAnimation === 'slide') return 'cuo-anim-slide';
  if (config?.notifAnimation === 'bounce') return 'cuo-anim-bounce';
  return 'cuo-anim-fade';
}

/**
 * Create toast element
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _createToastElement(message, config) {
  const pos = _getPositionStyles(config);
  const animClass = _getAnimationClass(config);
  const borderWidth = parseInt(config?.notifBorderWidth) || 1;

  return createElement(
    'div',
    {
      id: 'copy-url-toast',
      className: animClass,
      style: {
        position: 'fixed',
        ...pos,
        backgroundColor: config?.notifColor || '#333',
        color: 'white',
        padding: '12px 20px',
        borderRadius: '4px',
        fontSize: '14px',
        zIndex: '999999998',
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        border: `${borderWidth}px solid ${config?.notifBorderColor || '#444'}`,
        pointerEvents: 'none',
        opacity: '1'
      }
    },
    message
  );
}

/**
 * Schedule toast removal
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _scheduleToastRemoval(toast, duration) {
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Show toast notification in configured corner
 * v1.6.3.11-v4 - FIX Issue #3: Wrapped in try-catch with DOM verification
 * @param {string} message - Message to display
 * @param {string} type - Notification type (info, success, warning, error)
 * @param {object} config - Configuration object
 * @returns {Promise<{success: boolean, element?: HTMLElement, error?: string}>}
 */
export function showToast(message, type, config) {
  // v1.6.3.11-v4 - FIX Code Review: Use String() to safely handle non-string messages
  const messageStr = String(message || '');
  console.log('[NOTIFICATION] Toast display attempt:', {
    message: messageStr.substring(0, 50),
    type,
    timestamp: Date.now()
  });

  try {
    // Remove existing toast
    const existing = document.getElementById('copy-url-toast');
    if (existing) existing.remove();

    // Create and append toast
    const toast = _createToastElement(message, config);
    document.body.appendChild(toast);

    // v1.6.3.11-v4 - FIX Issue #3: Verify element was added to DOM
    const verifyElement = document.getElementById('copy-url-toast');
    if (!verifyElement) {
      throw new Error('Toast element not found in DOM after appendChild');
    }

    // Schedule removal
    _scheduleToastRemoval(toast, config?.notifDuration || 2000);

    console.log('[NOTIFICATION] Toast displayed successfully:', {
      message: messageStr.substring(0, 50),
      type,
      position: config?.notifPosition || 'bottom-right'
    });

    return Promise.resolve({ success: true, element: toast });
  } catch (err) {
    // v1.6.3.11-v4 - FIX Issue #3: Log failure and fallback to console
    // v1.6.3.11-v4 - FIX Code Review: Use messageStr for consistent safe handling
    console.error('[NOTIFICATION] Toast display failed:', {
      message: messageStr.substring(0, 50),
      type,
      error: err.message,
      timestamp: Date.now()
    });

    // Fallback: log message to console as notification
    console.warn(`[NOTIFICATION FALLBACK] ${type?.toUpperCase() || 'INFO'}: ${messageStr}`);

    return Promise.resolve({ success: false, error: err.message });
  }
}
