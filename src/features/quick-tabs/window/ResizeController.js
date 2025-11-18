/**
 * ResizeController - Coordinates all resize handles for a Quick Tab window
 * Part of Phase 2.3 refactoring to reduce window.js complexity
 *
 * This demonstrates the facade/coordinator pattern from the refactoring plan.
 * Reduces setupResizeHandlers from 195 lines to ~15 lines of orchestration.
 */

import { ResizeHandle } from './ResizeHandle.js';

/**
 * All 8 resize directions
 * Adding a new direction is as simple as adding to this array
 */
const RESIZE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * ResizeController class - Manages all resize handles for a window
 */
export class ResizeController {
  constructor(window, options = {}) {
    this.window = window;
    this.options = options;
    this.handles = [];
  }

  /**
   * Create and attach all resize handles
   * This replaces 195 lines of repeated code in setupResizeHandlers()
   */
  attachHandles() {
    // Create a handle for each direction
    for (const direction of RESIZE_DIRECTIONS) {
      const handle = new ResizeHandle(direction, this.window, this.options);
      const element = handle.create();

      // Append to window container
      this.window.container.appendChild(element);

      // Track for cleanup
      this.handles.push(handle);
    }

    return this.handles;
  }

  /**
   * Remove all resize handles and cleanup
   */
  detachAll() {
    for (const handle of this.handles) {
      handle.destroy();
    }
    this.handles = [];
  }

  /**
   * Get specific handle by direction
   */
  getHandle(direction) {
    return this.handles.find(h => h.direction === direction);
  }
}
