/**
 * Minimized Quick Tabs Manager
 * Manages the minimized state of Quick Tabs and provides restoration interface
 * 
 * v1.5.9.0 - New module following modular-architecture-blueprint.md
 */

/**
 * MinimizedManager class - Tracks and manages minimized Quick Tabs
 */
export class MinimizedManager {
  constructor() {
    this.minimizedTabs = new Map(); // id -> QuickTabWindow instance
  }

  /**
   * Add a minimized Quick Tab
   */
  add(id, tabWindow) {
    this.minimizedTabs.set(id, tabWindow);
    console.log('[MinimizedManager] Added minimized tab:', id);
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
   */
  restore(id) {
    const tabWindow = this.minimizedTabs.get(id);
    if (tabWindow) {
      tabWindow.restore();
      this.minimizedTabs.delete(id);
      console.log('[MinimizedManager] Restored tab:', id);
      return true;
    }
    return false;
  }

  /**
   * Get all minimized tabs
   */
  getAll() {
    return Array.from(this.minimizedTabs.values());
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
