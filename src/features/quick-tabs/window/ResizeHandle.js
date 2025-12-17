/**
 * ResizeHandle - Individual resize handle with table-driven configuration
 * Part of Phase 2.3 refactoring to reduce window.js complexity
 *
 * This demonstrates the table-driven configuration pattern from the refactoring plan.
 * Reduces complexity from cc=25 to cc=3 by eliminating directional conditionals.
 *
 * v1.6.3.5-v11 - FIX Critical Quick Tab Bugs:
 *   - Issue #3: Add public cleanup() method for DOM event listener cleanup before minimize
 *   - Issue #5: Add comprehensive callback logging in handlePointerUp()
 */

import { createElement } from '../../../utils/dom.js';

/**
 * Configuration for each resize direction
 * Eliminates conditional logic - direction behavior is data-driven
 */
const RESIZE_CONFIGS = {
  // Corner handles
  se: {
    cursor: 'se-resize',
    position: { bottom: 0, right: 0 },
    size: { width: 10, height: 10 },
    directions: ['e', 's']
  },
  sw: {
    cursor: 'sw-resize',
    position: { bottom: 0, left: 0 },
    size: { width: 10, height: 10 },
    directions: ['w', 's']
  },
  ne: {
    cursor: 'ne-resize',
    position: { top: 0, right: 0 },
    size: { width: 10, height: 10 },
    directions: ['e', 'n']
  },
  nw: {
    cursor: 'nw-resize',
    position: { top: 0, left: 0 },
    size: { width: 10, height: 10 },
    directions: ['w', 'n']
  },
  // Edge handles
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
  },
  s: {
    cursor: 's-resize',
    position: { bottom: 0, left: 10, right: 10 },
    size: { height: 10 },
    directions: ['s']
  },
  n: {
    cursor: 'n-resize',
    position: { top: 0, left: 10, right: 10 },
    size: { height: 10 },
    directions: ['n']
  }
};

/**
 * ResizeHandle class - Manages a single resize handle
 * Generic implementation works for all 8 directions via configuration
 */
export class ResizeHandle {
  constructor(direction, window, options = {}) {
    this.direction = direction;
    this.window = window;
    this.config = RESIZE_CONFIGS[direction];
    this.minWidth = options.minWidth || 400;
    this.minHeight = options.minHeight || 300;
    // v1.6.3.5-v11 - FIX Issue #3: Track destroyed state for cleanup
    this.destroyed = false;
    // v1.6.3.7 - FIX Issue #4: Track rAF ID for throttling
    this.rafId = null;
    // v1.6.3.7 - FIX Issue #4: Store pending dimensions for rAF callback
    this.pendingDimensions = null;

    if (!this.config) {
      throw new Error(`Invalid resize direction: ${direction}`);
    }

    this.element = null;
    this.isResizing = false;
    this.startState = null;

    // v1.6.3.5-v11 - FIX Issue #3: Store bound handlers for cleanup
    this._boundHandlePointerDown = this.handlePointerDown.bind(this);
    this._boundHandlePointerMove = this.handlePointerMove.bind(this);
    this._boundHandlePointerUp = this.handlePointerUp.bind(this);
    this._boundHandlePointerCancel = this.handlePointerCancel.bind(this);
  }

  /**
   * Create and attach the handle element
   */
  create() {
    const { cursor, position, size } = this.config;

    // Build style object from configuration
    const style = {
      position: 'absolute',
      cursor,
      zIndex: '10',
      backgroundColor: 'transparent', // Invisible but interactive
      ...Object.entries(position).reduce((acc, [key, value]) => {
        acc[key] = `${value}px`;
        return acc;
      }, {}),
      ...Object.entries(size).reduce((acc, [key, value]) => {
        acc[key] = `${value}px`;
        return acc;
      }, {})
    };

    this.element = createElement('div', {
      className: `quick-tab-resize-handle-${this.direction}`,
      style
    });

    this.attachEventListeners();
    return this.element;
  }

  /**
   * Attach pointer event listeners
   * v1.6.3.5-v11 - FIX Issue #3: Use stored bound handlers for cleanup
   */
  attachEventListeners() {
    this.element.addEventListener('pointerdown', this._boundHandlePointerDown);
    this.element.addEventListener('pointermove', this._boundHandlePointerMove);
    this.element.addEventListener('pointerup', this._boundHandlePointerUp);
    this.element.addEventListener('pointercancel', this._boundHandlePointerCancel);
  }

  /**
   * Start resize operation
   */
  handlePointerDown(e) {
    if (e.button !== 0) return;

    e.stopPropagation();
    e.preventDefault();

    this.isResizing = true;
    this.element.setPointerCapture(e.pointerId);

    this.startState = {
      x: e.clientX,
      y: e.clientY,
      width: this.window.width,
      height: this.window.height,
      left: this.window.left,
      top: this.window.top
    };
  }

  /**
   * Handle resize drag
   * Uses configuration to determine which dimensions to modify
   * v1.6.3.7 - FIX Issue #4: Wrap DOM updates in requestAnimationFrame
   */
  handlePointerMove(e) {
    if (!this.isResizing) return;
    if (this.destroyed) return;

    const dx = e.clientX - this.startState.x;
    const dy = e.clientY - this.startState.y;

    const newDimensions = this.calculateNewDimensions(dx, dy);

    // v1.6.3.7 - FIX Issue #4: Store pending dimensions and schedule rAF
    this.pendingDimensions = newDimensions;

    // Skip if rAF is already scheduled
    if (this.rafId) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;

      // Double-check state in case of rapid cleanup
      if (this.destroyed || !this.isResizing || !this.pendingDimensions) return;

      const dims = this.pendingDimensions;

      // Apply dimensions
      Object.assign(this.window, dims);

      // Update DOM
      this.window.container.style.width = `${dims.width}px`;
      this.window.container.style.height = `${dims.height}px`;
      this.window.container.style.left = `${dims.left}px`;
      this.window.container.style.top = `${dims.top}px`;

      // Notify callbacks (only position/size change, not final)
      this.notifyChanges(dims);
    });

    e.preventDefault();
  }

  /**
   * Calculate new dimensions based on direction configuration
   * This is where the table-driven approach shines - no directional conditionals!
   */
  calculateNewDimensions(dx, dy) {
    const { directions } = this.config;
    const { width, height, left, top } = this.startState;

    let newWidth = width;
    let newHeight = height;
    let newLeft = left;
    let newTop = top;

    // Process each direction in the configuration
    for (const dir of directions) {
      switch (dir) {
        case 'e': // East - expand right
          newWidth = Math.max(this.minWidth, width + dx);
          break;
        case 'w': // West - expand left
          {
            const maxDx = width - this.minWidth;
            const constrainedDx = Math.min(dx, maxDx);
            newWidth = width - constrainedDx;
            newLeft = left + constrainedDx;
          }
          break;
        case 's': // South - expand down
          newHeight = Math.max(this.minHeight, height + dy);
          break;
        case 'n': // North - expand up
          {
            const maxDy = height - this.minHeight;
            const constrainedDy = Math.min(dy, maxDy);
            newHeight = height - constrainedDy;
            newTop = top + constrainedDy;
          }
          break;
      }
    }

    return { width: newWidth, height: newHeight, left: newLeft, top: newTop };
  }

  /**
   * Notify parent of dimension changes
   */
  notifyChanges(newDimensions) {
    const { width, height, left, top } = newDimensions;
    const { width: oldWidth, height: oldHeight, left: oldLeft, top: oldTop } = this.startState;

    // Size changed
    if (width !== oldWidth || height !== oldHeight) {
      this.window.onSizeChange?.(this.window.id, width, height);
    }

    // Position changed
    if (left !== oldLeft || top !== oldTop) {
      this.window.onPositionChange?.(this.window.id, left, top);
    }
  }

  /**
   * Safely invoke a callback with logging
   * v1.6.3.5-v11 - Helper to reduce nesting depth in handlePointerUp
   * @private
   * @param {Function|null} callback - Callback to invoke
   * @param {string} callbackName - Name for logging
   * @param {Array} args - Arguments to pass to callback
   * @param {Object} logContext - Additional context for logging
   */
  _invokeCallbackWithLogging(callback, callbackName, args, logContext) {
    if (!callback) {
      console.warn(`[ResizeHandle][handlePointerUp] No ${callbackName} callback available`);
      return;
    }

    console.log(`[ResizeHandle][handlePointerUp] BEFORE calling ${callbackName}:`, {
      direction: this.direction,
      ...logContext,
      callbackType: typeof callback
    });

    try {
      callback(...args);
      console.log(`[ResizeHandle][handlePointerUp] AFTER ${callbackName} - success`);
    } catch (err) {
      console.error(`[ResizeHandle][handlePointerUp] ${callbackName} callback FAILED:`, {
        error: err.message,
        stack: err.stack,
        ...logContext
      });
    }
  }

  /**
   * End resize operation
   * v1.6.3.5-v11 - FIX Issue #5: Add comprehensive callback logging
   */
  handlePointerUp(e) {
    if (!this.isResizing) return;
    if (this.destroyed) return;

    this.isResizing = false;
    this.element.releasePointerCapture(e.pointerId);

    // Prevent click propagation
    e.preventDefault();
    e.stopPropagation();

    // v1.6.3.5-v11 - FIX Issue #5: Comprehensive callback logging for size
    this._invokeCallbackWithLogging(
      this.window.onSizeChangeEnd,
      'onSizeChangeEnd',
      [this.window.id, this.window.width, this.window.height],
      { id: this.window.id, width: this.window.width, height: this.window.height }
    );

    // v1.6.3.5-v11 - FIX Issue #5: Comprehensive callback logging for position
    const positionChanged =
      this.window.left !== this.startState.left || this.window.top !== this.startState.top;
    if (positionChanged) {
      this._invokeCallbackWithLogging(
        this.window.onPositionChangeEnd,
        'onPositionChangeEnd',
        [this.window.id, this.window.left, this.window.top],
        { id: this.window.id, left: this.window.left, top: this.window.top }
      );
    }

    this.startState = null;
  }

  /**
   * Handle resize cancellation
   * v1.6.3.5-v11 - FIX Issue #3: Check destroyed flag
   */
  handlePointerCancel(_e) {
    if (!this.isResizing) return;
    if (this.destroyed) return;

    this.isResizing = false;

    // Emergency save
    this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height);
    this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top);

    this.startState = null;
  }

  /**
   * Remove event listeners from current element
   * v1.6.3.5-v11 - FIX Issue #3: Support cleanup before DOM removal
   * @private
   */
  _removeListeners() {
    if (!this.element) return;

    this.element.removeEventListener('pointerdown', this._boundHandlePointerDown);
    this.element.removeEventListener('pointermove', this._boundHandlePointerMove);
    this.element.removeEventListener('pointerup', this._boundHandlePointerUp);
    this.element.removeEventListener('pointercancel', this._boundHandlePointerCancel);
  }

  /**
   * Public cleanup method for DOM event listener cleanup before minimize
   * v1.6.3.5-v11 - FIX Issue #3: DOM event listeners not cleaned up on minimize
   * Removes event listeners without removing the element from DOM
   * v1.6.3.7 - FIX Issue #4: Also cancel pending rAF
   */
  cleanup() {
    if (this.destroyed) return;

    // v1.6.3.7 - FIX Issue #4: Cancel pending animation frame
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingDimensions = null;

    this._removeListeners();
    this.isResizing = false;
    this.startState = null;
    console.log('[ResizeHandle][cleanup] Removed event listeners for direction:', this.direction);
  }

  /**
   * Cleanup event listeners
   * v1.6.3.5-v11 - FIX Issue #3: Set destroyed flag and use _removeListeners
   * v1.6.3.7 - FIX Issue #4: Also cancel pending rAF
   */
  destroy() {
    this.destroyed = true;

    // v1.6.3.7 - FIX Issue #4: Cancel pending animation frame
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingDimensions = null;

    this._removeListeners();

    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
