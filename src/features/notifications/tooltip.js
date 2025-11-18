/**
 * Tooltip Notification Module
 * Handles tooltip notifications (for Copy URL - appears at cursor)
 * v1.5.8.10 - Extracted from notifications/index.js
 */

import { CONSTANTS } from '../../core/config.js';
import { createElement } from '../../core/dom.js';

/**
 * Show tooltip notification at cursor position
 * @param {string} message - Message to display
 * @param {object} config - Configuration object
 * @param {object} stateManager - State manager for mouse position
 */
export function showTooltip(message, config, stateManager) {
  const existing = document.getElementById('copy-url-tooltip');
  if (existing) existing.remove();

  const mouseX = stateManager?.get('lastMouseX') || 0;
  const mouseY = stateManager?.get('lastMouseY') || 0;

  // Determine animation class
  let animClass = 'cuo-anim-fade';
  if (config.tooltipAnimation === 'bounce') {
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
        backgroundColor: config.tooltipColor || '#333',
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
  }, config.tooltipDuration || 1000);

  console.log('[Tooltip] Displayed:', message);
}
