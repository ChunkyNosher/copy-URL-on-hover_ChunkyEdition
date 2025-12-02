/**
 * MinimizedManager Tests - v1.6.0 Phase 4.5
 *
 * Comprehensive tests for MinimizedManager component
 * Target: 100% coverage (simple module)
 *
 * @created 2025-11-19
 * @refactoring Phase 4.5 - Feature Layer Test Coverage
 */

import { MinimizedManager } from '../../../src/features/quick-tabs/minimized-manager.js';

describe('MinimizedManager', () => {
  let manager;
  let mockTabWindow;

  beforeEach(() => {
    manager = new MinimizedManager();

    // Create mock QuickTabWindow
    mockTabWindow = {
      id: 'test-tab-1',
      left: 100,
      top: 200,
      width: 800,
      height: 600,
      container: {
        style: {}
      },
      restore: jest.fn()
    };

    // Mock console.log to avoid test output pollution
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with empty minimizedTabs Map', () => {
      expect(manager.minimizedTabs).toBeInstanceOf(Map);
      expect(manager.minimizedTabs.size).toBe(0);
    });
  });

  describe('add()', () => {
    test('should add a minimized tab to the map', () => {
      manager.add('test-tab-1', mockTabWindow);

      expect(manager.minimizedTabs.has('test-tab-1')).toBe(true);
      // v1.6.3.4-v4 - Now stores snapshot, not direct reference
      expect(manager.minimizedTabs.get('test-tab-1').window).toBe(mockTabWindow);
    });

    test('should log addition with snapshot', () => {
      manager.add('test-tab-1', mockTabWindow);

      // v1.6.3.4-v4 - Updated: Logs include snapshot details
      expect(console.log).toHaveBeenCalledWith(
        '[MinimizedManager] Added minimized tab with snapshot:',
        {
          id: 'test-tab-1',
          savedPosition: { left: 100, top: 200 },
          savedSize: { width: 800, height: 600 }
        }
      );
    });

    test('should allow adding multiple tabs', () => {
      const mockTabWindow2 = { ...mockTabWindow, id: 'test-tab-2' };

      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow2);

      expect(manager.minimizedTabs.size).toBe(2);
      expect(manager.minimizedTabs.has('test-tab-1')).toBe(true);
      expect(manager.minimizedTabs.has('test-tab-2')).toBe(true);
    });

    test('should replace existing tab with same id', () => {
      const mockTabWindow2 = { ...mockTabWindow, width: 1000 };

      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-1', mockTabWindow2);

      expect(manager.minimizedTabs.size).toBe(1);
      // v1.6.3.4-v4 - Now stores snapshot, not direct reference
      expect(manager.minimizedTabs.get('test-tab-1').window).toBe(mockTabWindow2);
      expect(manager.minimizedTabs.get('test-tab-1').window.width).toBe(1000);
    });
  });

  describe('remove()', () => {
    test('should remove a minimized tab from the map', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.remove('test-tab-1');

      expect(manager.minimizedTabs.has('test-tab-1')).toBe(false);
    });

    test('should log removal', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.remove('test-tab-1');

      expect(console.log).toHaveBeenCalledWith(
        '[MinimizedManager] Removed minimized tab:',
        'test-tab-1'
      );
    });

    test('should handle removing non-existent tab', () => {
      expect(() => manager.remove('non-existent')).not.toThrow();
      expect(console.log).toHaveBeenCalledWith(
        '[MinimizedManager] Removed minimized tab:',
        'non-existent'
      );
    });

    test('should not affect other tabs when removing one', () => {
      const mockTabWindow2 = { ...mockTabWindow, id: 'test-tab-2' };

      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow2);

      manager.remove('test-tab-1');

      expect(manager.minimizedTabs.has('test-tab-1')).toBe(false);
      expect(manager.minimizedTabs.has('test-tab-2')).toBe(true);
    });
  });

  describe('restore()', () => {
    test('should restore a minimized tab', () => {
      manager.add('test-tab-1', mockTabWindow);
      const result = manager.restore('test-tab-1');

      // v1.6.3.2 - restore() only applies snapshot and returns data, does NOT call tabWindow.restore()
      // UICoordinator is now the single rendering authority and will call restore() then render()
      expect(result).toBeTruthy();
      expect(result.window).toBe(mockTabWindow);
      expect(result.position).toEqual({ left: 100, top: 200 });
      expect(result.size).toEqual({ width: 800, height: 600 });
      // v1.6.3.2 - tabWindow.restore() is NO LONGER called here (fixes Issue #1 duplicate window)
      expect(mockTabWindow.restore).not.toHaveBeenCalled();
    });

    test('should keep tab in minimizedTabs until clearSnapshot called (v1.6.3.4-v3)', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      // v1.6.3.4-v3 - restore() keeps snapshot in minimizedTabs until clearSnapshot() is called
      expect(manager.minimizedTabs.has('test-tab-1')).toBe(true);
      
      // After clearSnapshot(), it should be removed
      manager.clearSnapshot('test-tab-1');
      expect(manager.minimizedTabs.has('test-tab-1')).toBe(false);
    });

    test('should apply snapshot to instance properties (v1.6.3.2)', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      // v1.6.3.2 - Verify snapshot was applied to instance properties
      // UICoordinator will call tabWindow.restore() then render() using these values
      expect(mockTabWindow.left).toBe(100);
      expect(mockTabWindow.top).toBe(200);
      expect(mockTabWindow.width).toBe(800);
      expect(mockTabWindow.height).toBe(600);
      // v1.6.3.2 - tabWindow.restore() is NO LONGER called by MinimizedManager
      expect(mockTabWindow.restore).not.toHaveBeenCalled();
    });

    test('should log restoration with position details', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      // v1.6.3.4-v3 - Updated log message to reflect snapshot is retained (not moved to pendingClear)
      expect(console.log).toHaveBeenCalledWith('[MinimizedManager] Snapshot retained for UICoordinator verification:',
        expect.objectContaining({
          id: 'test-tab-1',
          position: { left: 100, top: 200 },
          size: { width: 800, height: 600 }
        })
      );
    });

    test('should return false for non-existent tab', () => {
      const result = manager.restore('non-existent');

      expect(result).toBe(false);
    });

    test('should not call restore() for non-existent tab', () => {
      manager.restore('non-existent');

      expect(mockTabWindow.restore).not.toHaveBeenCalled();
    });

    test('should handle tab without container', () => {
      const tabWithoutContainer = {
        ...mockTabWindow,
        container: null
      };

      manager.add('test-tab-1', tabWithoutContainer);
      const result = manager.restore('test-tab-1');

      // v1.6.3.2 - restore() only applies snapshot, does NOT call tabWindow.restore()
      expect(result).toBeTruthy();
      expect(result.window).toBe(tabWithoutContainer);
      // v1.6.3.2 - tabWindow.restore() is NO LONGER called here
      expect(tabWithoutContainer.restore).not.toHaveBeenCalled();
    });

    test('should apply correct snapshot before caller invokes restore (v1.6.3.2)', () => {
      // v1.6.3.2 - MinimizedManager only applies snapshot, caller (UICoordinator) calls restore
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      // v1.6.3.2 - Snapshot should be applied to instance
      expect(mockTabWindow.left).toBe(100);
      expect(mockTabWindow.top).toBe(200);
      // v1.6.3.2 - restore() not called by MinimizedManager
      expect(mockTabWindow.restore).not.toHaveBeenCalled();
    });
  });

  describe('getAll()', () => {
    test('should return empty array when no tabs minimized', () => {
      const tabs = manager.getAll();

      expect(tabs).toEqual([]);
      expect(Array.isArray(tabs)).toBe(true);
    });

    test('should return array of all minimized tabs', () => {
      const mockTabWindow2 = { ...mockTabWindow, id: 'test-tab-2' };

      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow2);

      const tabs = manager.getAll();

      expect(tabs).toHaveLength(2);
      expect(tabs).toContain(mockTabWindow);
      expect(tabs).toContain(mockTabWindow2);
    });

    test('should return new array instance (not live reference)', () => {
      manager.add('test-tab-1', mockTabWindow);

      const tabs1 = manager.getAll();
      const tabs2 = manager.getAll();

      expect(tabs1).not.toBe(tabs2);
      expect(tabs1).toEqual(tabs2);
    });

    test('should not include removed tabs', () => {
      const mockTabWindow2 = { ...mockTabWindow, id: 'test-tab-2' };

      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow2);
      manager.remove('test-tab-1');

      const tabs = manager.getAll();

      expect(tabs).toHaveLength(1);
      expect(tabs).toContain(mockTabWindow2);
      expect(tabs).not.toContain(mockTabWindow);
    });
  });

  describe('getCount()', () => {
    test('should return 0 when no tabs minimized', () => {
      expect(manager.getCount()).toBe(0);
    });

    test('should return correct count of minimized tabs', () => {
      manager.add('test-tab-1', mockTabWindow);
      expect(manager.getCount()).toBe(1);

      const mockTabWindow2 = { ...mockTabWindow, id: 'test-tab-2' };
      manager.add('test-tab-2', mockTabWindow2);
      expect(manager.getCount()).toBe(2);
    });

    test('should decrease count when tab removed', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow);

      manager.remove('test-tab-1');

      expect(manager.getCount()).toBe(1);
    });

    test('should decrease count when tab restored and clearSnapshot called', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow);

      manager.restore('test-tab-1');
      // v1.6.3.4-v3 - restore() no longer removes from minimizedTabs, clearSnapshot() does
      manager.clearSnapshot('test-tab-1');

      expect(manager.getCount()).toBe(1);
    });
  });

  describe('isMinimized()', () => {
    test('should return false for non-existent tab', () => {
      expect(manager.isMinimized('non-existent')).toBe(false);
    });

    test('should return true for minimized tab', () => {
      manager.add('test-tab-1', mockTabWindow);

      expect(manager.isMinimized('test-tab-1')).toBe(true);
    });

    test('should return false after tab removed', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.remove('test-tab-1');

      expect(manager.isMinimized('test-tab-1')).toBe(false);
    });

    test('should return false after tab restored and clearSnapshot called', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');
      // v1.6.3.4-v3 - restore() keeps snapshot in minimizedTabs until clearSnapshot() is called
      manager.clearSnapshot('test-tab-1');

      expect(manager.isMinimized('test-tab-1')).toBe(false);
    });
  });

  describe('clear()', () => {
    test('should remove all minimized tabs', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow);
      manager.add('test-tab-3', mockTabWindow);

      manager.clear();

      expect(manager.minimizedTabs.size).toBe(0);
      expect(manager.getCount()).toBe(0);
      expect(manager.getAll()).toEqual([]);
    });

    test('should log clearing', () => {
      manager.clear();

      // v1.6.3.4-v10 - Updated log message to reflect clearing pending snapshots too
      expect(console.log).toHaveBeenCalledWith('[MinimizedManager] Cleared all minimized tabs and pending snapshots');
    });

    test('should handle clearing when already empty', () => {
      expect(() => manager.clear()).not.toThrow();
      expect(manager.getCount()).toBe(0);
    });

    test('should allow adding tabs after clear', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.clear();
      manager.add('test-tab-2', mockTabWindow);

      expect(manager.getCount()).toBe(1);
      expect(manager.isMinimized('test-tab-2')).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle multiple minimize/restore cycles', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');
      // v1.6.3.4-v3 - clearSnapshot() must be called after restore() to complete cycle
      manager.clearSnapshot('test-tab-1');
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');
      manager.clearSnapshot('test-tab-1');

      expect(manager.isMinimized('test-tab-1')).toBe(false);
      // v1.6.3.2 - MinimizedManager.restore() no longer calls tabWindow.restore()
      // The caller (UICoordinator) is responsible for calling it
      expect(mockTabWindow.restore).not.toHaveBeenCalled();
    });

    test('should maintain separate state for different tabs', () => {
      const mockTabWindow2 = {
        ...mockTabWindow,
        id: 'test-tab-2',
        left: 300,
        top: 400,
        container: { style: {} },
        restore: jest.fn()
      };

      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow2);

      manager.restore('test-tab-1');
      // v1.6.3.4-v3 - clearSnapshot() must be called after restore() to remove from minimizedTabs
      manager.clearSnapshot('test-tab-1');

      expect(manager.isMinimized('test-tab-1')).toBe(false);
      expect(manager.isMinimized('test-tab-2')).toBe(true);
      // v1.6.3.2 - MinimizedManager.restore() no longer calls tabWindow.restore()
      expect(mockTabWindow.restore).not.toHaveBeenCalled();
      expect(mockTabWindow2.restore).not.toHaveBeenCalled();
    });

    test('should handle rapid add/remove operations', () => {
      for (let i = 0; i < 10; i++) {
        manager.add(`tab-${i}`, mockTabWindow);
      }
      expect(manager.getCount()).toBe(10);

      for (let i = 0; i < 5; i++) {
        manager.remove(`tab-${i}`);
      }
      expect(manager.getCount()).toBe(5);

      manager.clear();
      expect(manager.getCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle tabs with missing properties', () => {
      const minimalTab = {
        container: { style: {} },
        restore: jest.fn()
      };

      manager.add('minimal', minimalTab);
      const result = manager.restore('minimal');

      // v1.6.3.2 - restore() only applies snapshot, does NOT call tabWindow.restore()
      expect(result).toBeTruthy();
      expect(result.window).toBe(minimalTab);
      // v1.6.3.2 - MinimizedManager.restore() no longer calls tabWindow.restore()
      expect(minimalTab.restore).not.toHaveBeenCalled();
      // v1.6.3.4-v7 - Snapshot applies to instance properties (with defaults)
      expect(minimalTab.left).toBe(100);
      expect(minimalTab.top).toBe(100);
    });

    test('should handle null tab window in add', () => {
      // v1.6.3.4-v4 - Updated: null tab window is now rejected
      manager.add('null-tab', null);

      expect(manager.isMinimized('null-tab')).toBe(false); // Not added
      expect(manager.getCount()).toBe(0);
    });

    test('should handle undefined tab window in add', () => {
      // v1.6.3.4-v4 - Updated: undefined tab window is now rejected
      manager.add('undefined-tab', undefined);

      expect(manager.isMinimized('undefined-tab')).toBe(false); // Not added
      expect(manager.getCount()).toBe(0);
    });

    test('should handle restoring null tab window', () => {
      // v1.6.3.4-v4 - Updated: Since null tab window is rejected in add,
      // restore won't find it and returns false
      manager.add('null-tab', null);

      const result = manager.restore('null-tab');

      expect(result).toBe(false); // tabWindow was never added
    });
  });
});
