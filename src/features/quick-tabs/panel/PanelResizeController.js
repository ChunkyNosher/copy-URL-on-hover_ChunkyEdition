/**
 * PanelResizeController - Manages 8-direction resize handles for Quick Tabs Manager Panel
 * Part of Phase 2.10 refactoring - Panel component extraction
 *
 * Follows the table-driven configuration pattern established in Phase 2.3
 * (window/ResizeHandle.js and window/ResizeController.js)
 *
 * Features:
 * - 8-direction resize (n, s, e, w, ne, nw, se, sw)
 * - Pointer Events API (pointerdown/move/up/cancel)
 * - Min constraints: 250px width, 300px height
 * - Position updates for nw/ne/sw directions
 * - Broadcasts size/position on resize end
 *
 * Extracted from panel.js (lines 957-1096, cc=high) → (cc=3 target)
 */

import { debug } from '../../../utils/debug.js';

/**
 * Configuration for each resize direction
 * Table-driven approach eliminates conditional complexity
 */
const RESIZE_CONFIGS = {
  // Corner handles
  nw: {
    cursor: 'nw-resize',
    position: { top: 0, left: 0 },
    size: { width: 10, height: 10 },
    directions: ['w', 'n']
  },
  ne: {
    cursor: 'ne-resize',
    position: { top: 0, right: 0 },
    size: { width: 10, height: 10 },
    directions: ['e', 'n']
  },
  sw: {
    cursor: 'sw-resize',
    position: { bottom: 0, left: 0 },
    size: { width: 10, height: 10 },
    directions: ['w', 's']
  },
  se: {
    cursor: 'se-resize',
    position: { bottom: 0, right: 0 },
    size: { width: 10, height: 10 },
    directions: ['e', 's']
  },
  // Edge handles
  n: {
    cursor: 'n-resize',
    position: { top: 0, left: 10, right: 10 },
    size: { height: 10 },
    directions: ['n']
  },
  s: {
    cursor: 's-resize',
    position: { bottom: 0, left: 10, right: 10 },
    size: { height: 10 },
    directions: ['s']
  },
  e: {
    cursor: 'e-resize',
    position: { top: 10, right: 0, bottom: 10 },
    size: { width: 10 },
    directions: ['e']
  },
  w: {
    cursor: 'w-resize',
    position: { top: 10, left: 0, bottom: 10 },
    size: { width: 10 },
    directions: ['w']
  }
};

/**
 * PanelResizeController class
 *
 * Public API:
 * - constructor(panel, callbacks) - Initialize with panel element and callbacks
 * - destroy() - Clean up handles and listeners
 *
 * Callbacks:
 * - onSizeChange(width, height) - Called during resize
 * - onPositionChange(left, top) - Called when position changes (nw/ne/sw)
 * - onResizeEnd(width, height, left, top) - Called when resize completes
 * - onBroadcast({width, height, left, top}) - Called to broadcast to other tabs
 */
export class PanelResizeController {
  constructor(panel, callbacks = {}) {
    this.panel = panel;
    this.callbacks = callbacks;
    this.handles = [];
    this.minWidth = 250;
    this.minHeight = 300;

    this._attachHandles();
  }

  /**
   * Create and attach all resize handles
   * Private method - called in constructor
   */
  _attachHandles() {
    Object.entries(RESIZE_CONFIGS).forEach(([direction, config]) => {
      const handle = this._createHandle(direction, config);
      this.panel.appendChild(handle);
      this.handles.push({ direction, element: handle });
    });

    debug('[PanelResizeController] Attached 8 resize handles');
  }

  /**
   * Create a single resize handle element
   * Returns DOM element with event listeners attached
   */
  _createHandle(direction, config) {
    const handle = document.createElement('div');
    handle.className = `panel-resize-handle ${direction}`;

    // Apply positioning and sizing from config
    const styleProps = {
      position: 'absolute',
      cursor: config.cursor,
      zIndex: '10',
      ...this._buildPositionStyles(config.position),
      ...this._buildSizeStyles(config.size)
    };

    handle.style.cssText = Object.entries(styleProps)
      .map(([key, value]) => `${this._camelToKebab(key)}: ${value};`)
      .join(' ');

    // Attach pointer event handlers
    this._attachHandleListeners(handle, direction, config);

    return handle;
  }

  /**
   * Build CSS position styles from config
   */
  _buildPositionStyles(position) {
    const styles = {};
    if (position.top !== undefined) styles.top = `${position.top}px`;
    if (position.bottom !== undefined) styles.bottom = `${position.bottom}px`;
    if (position.left !== undefined) styles.left = `${position.left}px`;
    if (position.right !== undefined) styles.right = `${position.right}px`;
    return styles;
  }

  /**
   * Build CSS size styles from config
   */
  _buildSizeStyles(size) {
    const styles = {};
    if (size.width) styles.width = `${size.width}px`;
    if (size.height) styles.height = `${size.height}px`;
    return styles;
  }

  /**
   * Convert camelCase to kebab-case for CSS properties
   */
  _camelToKebab(str) {
    return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  }

  /**
   * Attach pointer event listeners to a handle
   */
  _attachHandleListeners(handle, direction, config) {
    let isResizing = false;
    let currentPointerId = null;
    let startState = null;

    const handlePointerDown = e => {
      startState = this._initResize(e, handle);
      if (!startState) return;

      isResizing = true;
      currentPointerId = e.pointerId;
    };

    const handlePointerMove = e => {
      if (!isResizing || e.pointerId !== currentPointerId) return;

      this._performResize(e, startState, config, direction);
      e.preventDefault();
    };

    const handlePointerUp = e => {
      if (!isResizing || e.pointerId !== currentPointerId) return;

      this._finishResize(handle, e.pointerId);
      isResizing = false;
    };

    const handlePointerCancel = _e => {
      if (!isResizing) return;
      this._finishResize(handle, null);
      isResizing = false;
    };

    // Attach listeners
    handle.addEventListener('pointerdown', handlePointerDown);
    handle.addEventListener('pointermove', handlePointerMove);
    handle.addEventListener('pointerup', handlePointerUp);
    handle.addEventListener('pointercancel', handlePointerCancel);
  }

  /**
   * Initialize resize operation on pointerdown
   */
  _initResize(e, handle) {
    if (e.button !== 0) return null; // Left button only

    if (handle.setPointerCapture) {
      handle.setPointerCapture(e.pointerId);
    }

    const rect = this.panel.getBoundingClientRect();
    const startState = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top
    };

    e.preventDefault();
    e.stopPropagation();

    return startState;
  }

  /**
   * Perform resize on pointermove
   */
  _performResize(e, startState, config, direction) {
    const dx = e.clientX - startState.x;
    const dy = e.clientY - startState.y;

    const { newWidth, newHeight, newLeft, newTop } = this._calculateNewDimensions(
      direction,
      config.directions,
      startState,
      dx,
      dy
    );

    // Apply new dimensions
    this.panel.style.width = `${newWidth}px`;
    this.panel.style.height = `${newHeight}px`;
    this.panel.style.left = `${newLeft}px`;
    this.panel.style.top = `${newTop}px`;

    // Notify via callbacks
    if (this.callbacks.onSizeChange) {
      this.callbacks.onSizeChange(newWidth, newHeight);
    }
    if (
      this.callbacks.onPositionChange &&
      (newLeft !== startState.left || newTop !== startState.top)
    ) {
      this.callbacks.onPositionChange(newLeft, newTop);
    }
  }

  /**
   * Finish resize on pointerup/pointercancel
   */
  _finishResize(handle, pointerId) {
    if (pointerId && handle.releasePointerCapture) {
      handle.releasePointerCapture(pointerId);
    }

    const rect = this.panel.getBoundingClientRect();

    // Notify resize end
    if (this.callbacks.onResizeEnd) {
      this.callbacks.onResizeEnd(rect.width, rect.height, rect.left, rect.top);
    }

    // Broadcast to other tabs (v1.5.9.8 fix)
    if (this.callbacks.onBroadcast) {
      this.callbacks.onBroadcast({
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top
      });
    }

    debug(
      `[PanelResizeController] Resize end: ${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`
    );
  }

  /**
   * Calculate new dimensions based on resize direction
   * Handles min constraints and position updates for nw/ne/sw directions
   */
  _calculateNewDimensions(direction, directions, startState, dx, dy) {
    let newWidth = startState.width;
    let newHeight = startState.height;
    let newLeft = startState.left;
    let newTop = startState.top;

    // East (right edge)
    if (directions.includes('e')) {
      newWidth = Math.max(this.minWidth, startState.width + dx);
    }

    // West (left edge) - also moves position
    if (directions.includes('w')) {
      const maxDx = startState.width - this.minWidth;
      const constrainedDx = Math.min(dx, maxDx);
      newWidth = startState.width - constrainedDx;
      newLeft = startState.left + constrainedDx;
    }

    // South (bottom edge)
    if (directions.includes('s')) {
      newHeight = Math.max(this.minHeight, startState.height + dy);
    }

    // North (top edge) - also moves position
    if (directions.includes('n')) {
      const maxDy = startState.height - this.minHeight;
      const constrainedDy = Math.min(dy, maxDy);
      newHeight = startState.height - constrainedDy;
      newTop = startState.top + constrainedDy;
    }

    return { newWidth, newHeight, newLeft, newTop };
  }

  /**
   * Clean up all handles and listeners
   */
  destroy() {
    this.handles.forEach(({ element }) => {
      element.remove();
    });
    this.handles = [];

    debug('[PanelResizeController] Destroyed all handles');
  }
}
