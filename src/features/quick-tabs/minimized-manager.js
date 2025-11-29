/**
 * Minimized Quick Tabs Manager
 * Manages the minimized state of Quick Tabs and provides restoration interface
 *
 * v1.5.9.0 - New module following modular-architecture-blueprint.md
 * v1.6.4.3 - FIX Issue #4: Store position/size as immutable snapshot to prevent corruption
 */

// Default values for position/size when not provided
const DEFAULT_POSITION_LEFT = 100;
const DEFAULT_POSITION_TOP = 100;
const DEFAULT_SIZE_WIDTH = 400;
const DEFAULT_SIZE_HEIGHT = 300;

/**
 * MinimizedManager class - Tracks and manages minimized Quick Tabs
 * v1.6.4.3 - Stores immutable snapshots of position/size to prevent corruption by duplicate windows
 */
export class MinimizedManager {
  constructor() {
    // v1.6.4.3 - FIX Issue #4: Store snapshot objects instead of direct references
    // Each entry: { window: QuickTabWindow, savedPosition: {left, top}, savedSize: {width, height} }
    this.minimizedTabs = new Map();
  }

  /**
   * Add a minimized Quick Tab with immutable position/size snapshot
   * v1.6.4.3 - FIX Issue #4: Store position/size as immutable snapshot to prevent corruption
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - QuickTabWindow instance
   */
  add(id, tabWindow) {
    // Guard against null/undefined tabWindow
    if (!tabWindow) {
      console.warn('[MinimizedManager] Cannot add minimized tab - tabWindow is null/undefined:', id);
      return;
    }
    
    // v1.6.4.3 - FIX Issue #4: Store immutable snapshot of position/size
    // This prevents corruption if a duplicate window overwrites the original's properties
    const snapshot = {
      window: tabWindow,
      savedPosition: {
        left: tabWindow.left ?? DEFAULT_POSITION_LEFT,
        top: tabWindow.top ?? DEFAULT_POSITION_TOP
      },
      savedSize: {
        width: tabWindow.width ?? DEFAULT_SIZE_WIDTH,
        height: tabWindow.height ?? DEFAULT_SIZE_HEIGHT
      }
    };
    this.minimizedTabs.set(id, snapshot);
    console.log('[MinimizedManager] Added minimized tab with snapshot:', {
      id,
      savedPosition: snapshot.savedPosition,
      savedSize: snapshot.savedSize
    });
  }

  /**
   * Remove a minimized Quick Tab
   */
  remove(id) {
    this.minimizedTabs.delete(id);
    console.log('[MinimizedManager] Removed minimized tab:', id);
  }

  /**
   * Restore a minimized Quick Tab
   * v1.5.9.8 - FIX: Ensure position state is preserved before calling restore
   * v1.6.4.3 - FIX Issue #4: Use immutable snapshot instead of potentially corrupted instance
   */
  restore(id) {
    const snapshot = this.minimizedTabs.get(id);
    if (snapshot) {
      const tabWindow = snapshot.window;
      
      // v1.6.4.3 - FIX Issue #4: Use saved snapshot values, NOT current instance properties
      // The instance properties may have been corrupted by duplicate window creation
      const savedLeft = snapshot.savedPosition.left;
      const savedTop = snapshot.savedPosition.top;
      const savedWidth = snapshot.savedSize.width;
      const savedHeight = snapshot.savedSize.height;

      tabWindow.restore();

      // Apply saved snapshot position/size (defensive, uses immutable values)
      if (tabWindow.container) {
        tabWindow.container.style.left = `${savedLeft}px`;
        tabWindow.container.style.top = `${savedTop}px`;
        tabWindow.container.style.width = `${savedWidth}px`;
        tabWindow.container.style.height = `${savedHeight}px`;
      }
      
      // Also update the instance properties to match snapshot
      tabWindow.left = savedLeft;
      tabWindow.top = savedTop;
      tabWindow.width = savedWidth;
      tabWindow.height = savedHeight;

      this.minimizedTabs.delete(id);
      console.log('[MinimizedManager] Restored tab with snapshot position:', {
        id,
        left: savedLeft,
        top: savedTop,
        width: savedWidth,
        height: savedHeight
      });
      return true;
    }
    return false;
  }

  /**
   * Get all minimized tab windows
   * v1.6.4.3 - Returns window instances from snapshots
   */
  getAll() {
    return Array.from(this.minimizedTabs.values()).map(snapshot => snapshot.window);
  }

  /**
   * Get minimized tab count
   */
  getCount() {
    return this.minimizedTabs.size;
  }

  /**
   * Check if a tab is minimized
   */
  isMinimized(id) {
    return this.minimizedTabs.has(id);
  }

  /**
   * Clear all minimized tabs
   */
  clear() {
    this.minimizedTabs.clear();
    console.log('[MinimizedManager] Cleared all minimized tabs');
  }
}
