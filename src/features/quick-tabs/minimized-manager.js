/**
 * Minimized Quick Tabs Manager
 * Manages the minimized state of Quick Tabs and provides restoration interface
 *
 * v1.5.9.0 - New module following modular-architecture-blueprint.md
 * v1.6.4.3 - FIX Issue #4: Store position/size as immutable snapshot to prevent corruption
 * v1.6.4.9 - FIX Issue #1: Do NOT delete snapshot in restore(), keep until UICoordinator confirms
 *   Added clearSnapshot() for UICoordinator to call after successful render
 * v1.6.3.4-v2 - FIX Issue #3: Enhanced logging for snapshot application verification
 * v1.6.3.4-v3 - FIX Issue #5: Improved snapshot lifecycle
 *   - Don't move to pendingClearSnapshots until UICoordinator calls clearSnapshot()
 *   - Keep snapshot in minimizedTabs during restore to allow re-reading
 *   - Comprehensive logging at all snapshot operations
 */

// Default values for position/size when not provided
const DEFAULT_POSITION_LEFT = 100;
const DEFAULT_POSITION_TOP = 100;
const DEFAULT_SIZE_WIDTH = 400;
const DEFAULT_SIZE_HEIGHT = 300;

/**
 * MinimizedManager class - Tracks and manages minimized Quick Tabs
 * v1.6.4.3 - Stores immutable snapshots of position/size to prevent corruption by duplicate windows
 * v1.6.4.9 - FIX Issue #1: Snapshot lifecycle - keep until UICoordinator confirms successful render
 */
export class MinimizedManager {
  constructor() {
    // v1.6.4.3 - FIX Issue #4: Store snapshot objects instead of direct references
    // Each entry: { window: QuickTabWindow, savedPosition: {left, top}, savedSize: {width, height} }
    this.minimizedTabs = new Map();
    // v1.6.4.9 - FIX Issue #1: Track restored but not yet cleared snapshots
    // These are snapshots that have been applied but UICoordinator hasn't confirmed render yet
    this.pendingClearSnapshots = new Map();
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
      console.warn(
        '[MinimizedManager] Cannot add minimized tab - tabWindow is null/undefined:',
        id
      );
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
   * v1.6.4.4 - FIX Bug #5: Return snapshot data for caller to apply to correct window
   * v1.6.4.6 - FIX Issue #1, #6: Apply snapshot BEFORE calling restore() so render() uses correct values
   * v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call tabWindow.restore() here!
   *   This was causing duplicate window bug. MinimizedManager only applies snapshot.
   *   UICoordinator is the single rendering authority and will call restore() then render().
   * v1.6.4.7 - FIX Issues #1, #6: Enhanced logging for dimension verification
   * v1.6.4.9 - FIX Issue #1 CRITICAL: Do NOT delete snapshot here! Keep until UICoordinator confirms.
   *   The 200ms STATE_EMIT_DELAY_MS causes snapshot to be deleted before UICoordinator reads it.
   *   UICoordinator will call clearSnapshot() after successful render.
   * v1.6.3.4-v2 - FIX Issue #3: Enhanced logging showing saved snapshot values being applied
   * v1.6.3.4-v3 - FIX Issue #5: Keep snapshot in minimizedTabs during restore
   *   Only clearSnapshot() will remove it after UICoordinator confirms successful render.
   *   This allows multiple calls to getSnapshot() during the restore flow.
   * @param {string} id - Quick Tab ID
   * @returns {Object|boolean} Snapshot object with position/size, or false if not found
   */
  restore(id) {
    // v1.6.3.4-v3 - FIX Issue #5: Check minimizedTabs first, then pendingClear for re-entry
    let snapshot = this.minimizedTabs.get(id);
    let snapshotSource = 'minimizedTabs';
    
    // Also check pending clear snapshots (in case restore is called again before clearSnapshot)
    if (!snapshot) {
      snapshot = this.pendingClearSnapshots.get(id);
      snapshotSource = 'pendingClearSnapshots';
      if (snapshot) {
        console.log('[MinimizedManager] Using pending-clear snapshot for re-entry:', id);
      }
    }
    
    if (!snapshot) {
      console.log('[MinimizedManager] No snapshot found for restore:', id);
      return false;
    }
    
    const tabWindow = snapshot.window;

    // v1.6.4.3 - FIX Issue #4: Use saved snapshot values, NOT current instance properties
    // The instance properties may have been corrupted by duplicate window creation
    const savedLeft = snapshot.savedPosition.left;
    const savedTop = snapshot.savedPosition.top;
    const savedWidth = snapshot.savedSize.width;
    const savedHeight = snapshot.savedSize.height;
    
    // v1.6.3.4-v3 - FIX Issue #5: Log which source the snapshot came from
    console.log('[MinimizedManager] restore() snapshot lookup:', {
      id,
      source: snapshotSource,
      savedPosition: { left: savedLeft, top: savedTop },
      savedSize: { width: savedWidth, height: savedHeight }
    });
    
    // v1.6.4.7 - FIX Issue #6: Log BEFORE and AFTER to verify application
    console.log('[MinimizedManager] Instance dimensions BEFORE snapshot application:', {
      id,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height
    });

    // v1.6.4.6 - FIX Issue #6: Apply snapshot to instance properties
    // This ensures when render() is eventually called, it uses the correct position/size
    tabWindow.left = savedLeft;
    tabWindow.top = savedTop;
    tabWindow.width = savedWidth;
    tabWindow.height = savedHeight;

    // v1.6.4.7 - FIX Issue #6: Log AFTER to verify application succeeded
    console.log('[MinimizedManager] Instance dimensions AFTER snapshot application:', {
      id,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height
    });
    
    // v1.6.4.7 - Verify the values match what we intended to set
    const applicationVerified = 
      tabWindow.left === savedLeft &&
      tabWindow.top === savedTop &&
      tabWindow.width === savedWidth &&
      tabWindow.height === savedHeight;
    
    // v1.6.3.4-v2 - FIX Issue #3: Log verification result explicitly
    if (applicationVerified) {
      console.log('[MinimizedManager] ✓ Snapshot application VERIFIED - all values match:', id);
    } else {
      console.error('[MinimizedManager] CRITICAL: Snapshot application verification FAILED!', {
        id,
        expected: { left: savedLeft, top: savedTop, width: savedWidth, height: savedHeight },
        actual: { left: tabWindow.left, top: tabWindow.top, width: tabWindow.width, height: tabWindow.height }
      });
    }

    // v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call tabWindow.restore() here!
    // This was causing the duplicate window bug - both MinimizedManager.restore()
    // and UICoordinator.update() were calling render().
    // Now UICoordinator._restoreExistingWindow() is the single authority that
    // calls tabWindow.restore() (which updates state) then tabWindow.render() (creates DOM).

    // v1.6.3.4-v3 - FIX Issue #5 CRITICAL: Do NOT move snapshot to pending here!
    // Keep the snapshot in minimizedTabs until UICoordinator calls clearSnapshot().
    // This allows the snapshot to be re-read during the restore flow if needed.
    console.log('[MinimizedManager] Snapshot retained for UICoordinator verification:', {
      id,
      position: { left: savedLeft, top: savedTop },
      size: { width: savedWidth, height: savedHeight },
      note: 'Call clearSnapshot() after successful render to remove'
    });

    // v1.6.4.4 - FIX Bug #5: Return snapshot data so caller can verify/apply to correct window
    return {
      window: tabWindow,
      position: { left: savedLeft, top: savedTop },
      size: { width: savedWidth, height: savedHeight }
    };
  }

  /**
   * Clear a snapshot after UICoordinator confirms successful render
   * v1.6.4.9 - FIX Issue #1: Called by UICoordinator after DOM verification passes
   * v1.6.3.4-v3 - FIX Issue #5: Now clears from minimizedTabs first (where snapshot stays during restore)
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if snapshot was cleared, false if not found
   */
  clearSnapshot(id) {
    // v1.6.3.4-v3 - FIX Issue #5: First check minimizedTabs (where snapshot stays during restore)
    if (this.minimizedTabs.has(id)) {
      this.minimizedTabs.delete(id);
      console.log('[MinimizedManager] Cleared snapshot from minimizedTabs after successful render:', id);
      return true;
    }
    // Then check pendingClearSnapshots (legacy path)
    if (this.pendingClearSnapshots.has(id)) {
      this.pendingClearSnapshots.delete(id);
      console.log('[MinimizedManager] Cleared snapshot from pendingClearSnapshots:', id);
      return true;
    }
    console.log('[MinimizedManager] clearSnapshot called but no snapshot found:', id);
    return false;
  }

  /**
   * Update window reference in snapshot
   * v1.6.4.4 - FIX Bug #5: Allow updating window reference when restore creates new window
   * @param {string} id - Quick Tab ID
   * @param {Object} newWindow - New QuickTabWindow instance
   * @returns {boolean} True if updated, false if not found
   */
  updateWindowReference(id, newWindow) {
    const snapshot = this.minimizedTabs.get(id);
    if (snapshot && newWindow) {
      snapshot.window = newWindow;
      console.log('[MinimizedManager] Updated window reference for:', id);
      return true;
    }
    return false;
  }

  /**
   * Get snapshot data for a minimized tab without restoring
   * v1.6.4.4 - FIX Bug #5: Allow reading snapshot data for verification
   * v1.6.4.9 - FIX Issue #1: Also check pendingClearSnapshots for recently restored tabs
   * @param {string} id - Quick Tab ID
   * @returns {Object|null} Snapshot data or null if not found
   */
  getSnapshot(id) {
    // Check active minimized tabs first
    let snapshot = this.minimizedTabs.get(id);
    
    // v1.6.4.9 - FIX Issue #1: Also check pending clear snapshots
    if (!snapshot) {
      snapshot = this.pendingClearSnapshots.get(id);
    }
    
    if (snapshot && snapshot.savedPosition && snapshot.savedSize) {
      console.log('[MinimizedManager] getSnapshot found for:', id, {
        source: this.minimizedTabs.has(id) ? 'minimizedTabs' : 'pendingClearSnapshots',
        position: snapshot.savedPosition,
        size: snapshot.savedSize
      });
      return {
        position: { left: snapshot.savedPosition.left, top: snapshot.savedPosition.top },
        size: { width: snapshot.savedSize.width, height: snapshot.savedSize.height }
      };
    }
    console.log('[MinimizedManager] getSnapshot not found for:', id);
    return null;
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
   * v1.6.4.9 - FIX Issue #1: A tab is still "minimized" for snapshot purposes if in pendingClear
   *   But for UI purposes, only check minimizedTabs (not pendingClear)
   */
  isMinimized(id) {
    return this.minimizedTabs.has(id);
  }

  /**
   * Check if a snapshot exists for this tab (either active or pending clear)
   * v1.6.4.9 - FIX Issue #1: UICoordinator should use this for snapshot lookup
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if any snapshot exists
   */
  hasSnapshot(id) {
    return this.minimizedTabs.has(id) || this.pendingClearSnapshots.has(id);
  }

  /**
   * Clear all minimized tabs
   * v1.6.4.9 - FIX Issue #1: Also clear pendingClearSnapshots
   */
  clear() {
    this.minimizedTabs.clear();
    this.pendingClearSnapshots.clear();
    console.log('[MinimizedManager] Cleared all minimized tabs and pending snapshots');
  }
}
