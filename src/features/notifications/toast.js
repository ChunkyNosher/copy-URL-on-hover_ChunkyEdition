/**
 * Toast Notification Module
 * Handles toast notifications (for Quick Tabs - appears in corner)
 * v1.5.8.10 - Extracted from notifications/index.js
 */

import { createElement } from '../../core/dom.js';

/**
 * Show toast notification in configured corner
 * @param {string} message - Message to display
 * @param {string} type - Notification type (info, success, warning, error)
 * @param {object} config - Configuration object
 */
export function showToast(message, type, config) {
  const existing = document.getElementById('copy-url-toast');
  if (existing) existing.remove();

  const positions = {
    'top-left': { top: '20px', left: '20px' },
    'top-right': { top: '20px', right: '20px' },
    'bottom-left': { bottom: '20px', left: '20px' },
    'bottom-right': { bottom: '20px', right: '20px' }
  };

  const pos = positions[config?.notifPosition] || positions['bottom-right'];

  // Determine animation class with null-safe config access
  let animClass = 'cuo-anim-fade'; // Default
  if (config?.notifAnimation === 'slide') {
    animClass = 'cuo-anim-slide';
  } else if (config?.notifAnimation === 'bounce') {
    animClass = 'cuo-anim-bounce';
  }

  // Ensure border width is a number with null-safe access
  const borderWidth = parseInt(config?.notifBorderWidth) || 1;

  const toast = createElement(
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

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, config?.notifDuration || 2000);

  console.log('[Toast] Displayed:', message);
}
