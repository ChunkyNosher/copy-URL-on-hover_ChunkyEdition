/**
 * ResizeController - Coordinates all resize handles for a Quick Tab window
 * Part of Phase 2.3 refactoring to reduce window.js complexity
 *
 * This demonstrates the facade/coordinator pattern from the refactoring plan.
 * Reduces setupResizeHandlers from 195 lines to ~15 lines of orchestration.
 * 
 * v1.6.3.5-v11 - FIX Critical Quick Tab Bugs:
 *   - Issue #3: Add public cleanup() method for DOM event listener cleanup before minimize
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
   * Public cleanup method for DOM event listener cleanup before minimize
   * v1.6.3.5-v11 - FIX Issue #3: DOM event listeners not cleaned up on minimize
   * Calls cleanup on all resize handles without removing them from the DOM
   */
  cleanup() {
    console.log('[ResizeController][cleanup] Cleaning up', this.handles.length, 'handles');
    for (const handle of this.handles) {
      if (handle.cleanup) {
        handle.cleanup();
      }
    }
    console.log('[ResizeController][cleanup] Removed event listeners from all handles');
  }

  /**
   * Get specific handle by direction
   */
  getHandle(direction) {
    return this.handles.find(h => h.direction === direction);
  }
}
