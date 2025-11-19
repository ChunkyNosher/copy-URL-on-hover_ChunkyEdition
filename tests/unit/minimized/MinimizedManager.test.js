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
      expect(manager.minimizedTabs.get('test-tab-1')).toBe(mockTabWindow);
    });

    test('should log addition', () => {
      manager.add('test-tab-1', mockTabWindow);

      expect(console.log).toHaveBeenCalledWith(
        '[MinimizedManager] Added minimized tab:',
        'test-tab-1'
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
      expect(manager.minimizedTabs.get('test-tab-1')).toBe(mockTabWindow2);
      expect(manager.minimizedTabs.get('test-tab-1').width).toBe(1000);
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

      expect(result).toBe(true);
      expect(mockTabWindow.restore).toHaveBeenCalled();
    });

    test('should remove tab from minimizedTabs after restoration', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      expect(manager.minimizedTabs.has('test-tab-1')).toBe(false);
    });

    test('should preserve position state before restoring', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      // Verify position was applied to container after restore
      expect(mockTabWindow.container.style.left).toBe('100px');
      expect(mockTabWindow.container.style.top).toBe('200px');
      expect(mockTabWindow.container.style.width).toBe('800px');
      expect(mockTabWindow.container.style.height).toBe('600px');
    });

    test('should log restoration with position details', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      expect(console.log).toHaveBeenCalledWith('[MinimizedManager] Restored tab with position:', {
        id: 'test-tab-1',
        left: 100,
        top: 200
      });
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

      expect(result).toBe(true);
      expect(tabWithoutContainer.restore).toHaveBeenCalled();
      // Should not throw when trying to set styles on null container
    });

    test('should preserve exact position even if restore changes it', () => {
      // Mock restore to change position (defensive behavior test)
      mockTabWindow.restore = jest.fn(() => {
        mockTabWindow.container.style.left = '999px'; // Wrong position
      });

      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      // Should force correct position after restore
      expect(mockTabWindow.container.style.left).toBe('100px'); // Correct position
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

    test('should decrease count when tab restored', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.add('test-tab-2', mockTabWindow);

      manager.restore('test-tab-1');

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

    test('should return false after tab restored', () => {
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

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

      expect(console.log).toHaveBeenCalledWith('[MinimizedManager] Cleared all minimized tabs');
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
      manager.add('test-tab-1', mockTabWindow);
      manager.restore('test-tab-1');

      expect(manager.isMinimized('test-tab-1')).toBe(false);
      expect(mockTabWindow.restore).toHaveBeenCalledTimes(2);
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

      expect(manager.isMinimized('test-tab-1')).toBe(false);
      expect(manager.isMinimized('test-tab-2')).toBe(true);
      expect(mockTabWindow.restore).toHaveBeenCalled();
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

      expect(result).toBe(true);
      expect(minimalTab.restore).toHaveBeenCalled();
      // Should use undefined for missing properties
      expect(minimalTab.container.style.left).toBe('undefinedpx');
    });

    test('should handle null tab window in add', () => {
      manager.add('null-tab', null);

      expect(manager.isMinimized('null-tab')).toBe(true);
      expect(manager.getCount()).toBe(1);
    });

    test('should handle undefined tab window in add', () => {
      manager.add('undefined-tab', undefined);

      expect(manager.isMinimized('undefined-tab')).toBe(true);
      expect(manager.getCount()).toBe(1);
    });

    test('should handle restoring null tab window', () => {
      manager.add('null-tab', null);

      const result = manager.restore('null-tab');

      expect(result).toBe(false); // tabWindow is null, so returns false
    });
  });
});
