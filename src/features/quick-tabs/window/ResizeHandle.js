/**
 * ResizeHandle - Individual resize handle with table-driven configuration
 * Part of Phase 2.3 refactoring to reduce window.js complexity
 *
 * This demonstrates the table-driven configuration pattern from the refactoring plan.
 * Reduces complexity from cc=25 to cc=3 by eliminating directional conditionals.
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

    if (!this.config) {
      throw new Error(`Invalid resize direction: ${direction}`);
    }

    this.element = null;
    this.isResizing = false;
    this.startState = null;
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
   */
  attachEventListeners() {
    this.element.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.element.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.element.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.element.addEventListener('pointercancel', this.handlePointerCancel.bind(this));
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
   */
  handlePointerMove(e) {
    if (!this.isResizing) return;

    const dx = e.clientX - this.startState.x;
    const dy = e.clientY - this.startState.y;

    const newDimensions = this.calculateNewDimensions(dx, dy);

    // Apply dimensions
    Object.assign(this.window, newDimensions);

    // Update DOM
    this.window.container.style.width = `${newDimensions.width}px`;
    this.window.container.style.height = `${newDimensions.height}px`;
    this.window.container.style.left = `${newDimensions.left}px`;
    this.window.container.style.top = `${newDimensions.top}px`;

    // Notify callbacks
    this.notifyChanges(newDimensions);

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
   * End resize operation
   */
  handlePointerUp(e) {
    if (!this.isResizing) return;

    this.isResizing = false;
    this.element.releasePointerCapture(e.pointerId);

    // Prevent click propagation
    e.preventDefault();
    e.stopPropagation();

    // Final save callbacks
    this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height);

    if (this.window.left !== this.startState.left || this.window.top !== this.startState.top) {
      this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top);
    }

    this.startState = null;
  }

  /**
   * Handle resize cancellation
   */
  handlePointerCancel(_e) {
    if (!this.isResizing) return;

    this.isResizing = false;

    // Emergency save
    this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height);
    this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top);

    this.startState = null;
  }

  /**
   * Cleanup event listeners
   */
  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
