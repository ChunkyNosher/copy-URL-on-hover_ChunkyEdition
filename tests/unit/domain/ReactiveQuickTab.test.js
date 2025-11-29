/**
 * ReactiveQuickTab Domain Entity Tests
 * v1.6.2.1 - Unit tests for Proxy reactivity
 *
 * Tests:
 * - Proxy change detection
 * - Computed property caching
 * - Computed property invalidation on dependency change
 * - watch() API and unwatch
 * - Validation (valid and invalid values)
 * - Solo/Mute mutual exclusion
 * - toJSON() serialization
 * - isVisible computation for all states
 */

import { ReactiveQuickTab } from '../../../src/domain/ReactiveQuickTab.js';

describe('ReactiveQuickTab Domain Entity', () => {
  describe('Construction', () => {
    test('should create ReactiveQuickTab with valid parameters', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        left: 100,
        top: 200,
        width: 800,
        height: 600,
        zIndex: 1000,
        minimized: false,
        soloedOnTabs: [],
        mutedOnTabs: []
      });

      expect(reactive.id).toBe('qt-123');
      expect(reactive.state.left).toBe(100);
      expect(reactive.state.top).toBe(200);
      expect(reactive.state.width).toBe(800);
      expect(reactive.state.height).toBe(600);
      expect(reactive.state.zIndex).toBe(1000);
      expect(reactive.state.minimized).toBe(false);
    });

    test('should use defaults for missing optional parameters', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123'
      });

      expect(reactive.state.left).toBe(100);
      expect(reactive.state.top).toBe(100);
      expect(reactive.state.width).toBe(800);
      expect(reactive.state.height).toBe(600);
      expect(reactive.state.zIndex).toBe(1000);
      expect(reactive.state.minimized).toBe(false);
      expect(reactive.state.soloedOnTabs).toEqual([]);
      expect(reactive.state.mutedOnTabs).toEqual([]);
      expect(reactive.state.title).toBe('Quick Tab');
      expect(reactive.state.cookieStoreId).toBe('firefox-default');
    });

    test('should throw error if id is missing', () => {
      expect(() => {
        new ReactiveQuickTab({ left: 100 });
      }).toThrow('ReactiveQuickTab requires data with a valid string id');
    });

    test('should throw error if data is null', () => {
      expect(() => {
        new ReactiveQuickTab(null);
      }).toThrow('ReactiveQuickTab requires data with a valid string id');
    });

    test('should accept onSync callback', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, onSync, 12345);

      reactive.state.left = 200;

      expect(onSync).toHaveBeenCalledWith('qt-123', 'left', 200);
    });

    test('should accept currentTabId', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, null, 12345);

      expect(reactive.currentTabId).toBe(12345);
    });
  });

  describe('Proxy Change Detection', () => {
    test('should detect property changes', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, onSync);

      reactive.state.left = 150;
      reactive.state.top = 250;

      expect(onSync).toHaveBeenCalledTimes(2);
      expect(onSync).toHaveBeenCalledWith('qt-123', 'left', 150);
      expect(onSync).toHaveBeenCalledWith('qt-123', 'top', 250);
    });

    test('should not trigger sync for unchanged values', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({ id: 'qt-123', left: 100 }, onSync);

      reactive.state.left = 100; // Same value

      expect(onSync).not.toHaveBeenCalled();
    });

    test('should handle array changes correctly', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({ id: 'qt-123', soloedOnTabs: [] }, onSync);

      reactive.state.soloedOnTabs = [12345];

      expect(onSync).toHaveBeenCalledWith('qt-123', 'soloedOnTabs', [12345]);
    });

    test('should not trigger sync for equal arrays', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [1, 2, 3]
      }, onSync);

      reactive.state.soloedOnTabs = [1, 2, 3]; // Same array

      expect(onSync).not.toHaveBeenCalled();
    });

    test('should update lastModified on property change', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        lastModified: 1000
      });

      const originalLastModified = reactive.state.lastModified;

      // Wait a tiny bit to ensure timestamp difference
      reactive.state.left = 200;

      expect(reactive.state.lastModified).toBeGreaterThanOrEqual(originalLastModified);
    });

    test('should handle onSync callback errors gracefully', () => {
      const onSync = jest.fn(() => {
        throw new Error('Sync error');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, onSync);

      // Should not throw
      expect(() => {
        reactive.state.left = 200;
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Computed Properties', () => {
    describe('isVisible', () => {
      test('should be true by default (global mode)', () => {
        const reactive = new ReactiveQuickTab({ id: 'qt-123' }, null, 12345);

        expect(reactive.state.isVisible).toBe(true);
      });

      test('should be false when minimized', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          minimized: true
        }, null, 12345);

        expect(reactive.state.isVisible).toBe(false);
      });

      test('should be true when soloed on current tab', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          soloedOnTabs: [12345, 67890]
        }, null, 12345);

        expect(reactive.state.isVisible).toBe(true);
      });

      test('should be false when soloed on different tab', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          soloedOnTabs: [67890]
        }, null, 12345);

        expect(reactive.state.isVisible).toBe(false);
      });

      test('should be false when muted on current tab', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          mutedOnTabs: [12345]
        }, null, 12345);

        expect(reactive.state.isVisible).toBe(false);
      });

      test('should be true when muted on different tab', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          mutedOnTabs: [67890]
        }, null, 12345);

        expect(reactive.state.isVisible).toBe(true);
      });

      test('minimized takes precedence over solo', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          minimized: true,
          soloedOnTabs: [12345]
        }, null, 12345);

        expect(reactive.state.isVisible).toBe(false);
      });

      test('solo takes precedence over mute', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          soloedOnTabs: [12345],
          mutedOnTabs: [12345]
        }, null, 12345);

        // Solo is checked first - if soloed on current tab, visible
        expect(reactive.state.isVisible).toBe(true);
      });
    });

    describe('isSoloed', () => {
      test('should be false when soloedOnTabs is empty', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          soloedOnTabs: []
        });

        expect(reactive.state.isSoloed).toBe(false);
      });

      test('should be true when soloedOnTabs has entries', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          soloedOnTabs: [12345]
        });

        expect(reactive.state.isSoloed).toBe(true);
      });
    });

    describe('isMuted', () => {
      test('should be false when not muted on current tab', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          mutedOnTabs: [67890]
        }, null, 12345);

        expect(reactive.state.isMuted).toBe(false);
      });

      test('should be true when muted on current tab', () => {
        const reactive = new ReactiveQuickTab({
          id: 'qt-123',
          mutedOnTabs: [12345]
        }, null, 12345);

        expect(reactive.state.isMuted).toBe(true);
      });
    });
  });

  describe('Computed Property Caching', () => {
    test('should cache computed property values', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, null, 12345);

      // Access isVisible twice
      const visible1 = reactive.state.isVisible;
      const visible2 = reactive.state.isVisible;

      expect(visible1).toBe(visible2);
      // Both should return cached value
    });

    test('should invalidate cache when dependency changes', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        minimized: false
      }, null, 12345);

      expect(reactive.state.isVisible).toBe(true);

      reactive.state.minimized = true;

      expect(reactive.state.isVisible).toBe(false);
    });

    test('should invalidate isVisible when soloedOnTabs changes', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: []
      }, null, 12345);

      expect(reactive.state.isVisible).toBe(true);

      reactive.state.soloedOnTabs = [67890]; // Not current tab

      expect(reactive.state.isVisible).toBe(false);
    });

    test('should invalidate isVisible when mutedOnTabs changes', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        mutedOnTabs: []
      }, null, 12345);

      expect(reactive.state.isVisible).toBe(true);

      reactive.state.mutedOnTabs = [12345]; // Current tab muted

      expect(reactive.state.isVisible).toBe(false);
    });

    test('should invalidate isSoloed when soloedOnTabs changes', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: []
      });

      expect(reactive.state.isSoloed).toBe(false);

      reactive.state.soloedOnTabs = [12345];

      expect(reactive.state.isSoloed).toBe(true);
    });

    test('should invalidate isMuted when mutedOnTabs changes', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        mutedOnTabs: []
      }, null, 12345);

      expect(reactive.state.isMuted).toBe(false);

      reactive.state.mutedOnTabs = [12345];

      expect(reactive.state.isMuted).toBe(true);
    });
  });

  describe('watch() API', () => {
    test('should call watcher when property changes', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123', left: 100 });
      const watcher = jest.fn();

      reactive.watch('left', watcher);
      reactive.state.left = 200;

      expect(watcher).toHaveBeenCalledWith(200, 100);
    });

    test('should support multiple watchers for same property', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const watcher1 = jest.fn();
      const watcher2 = jest.fn();

      reactive.watch('left', watcher1);
      reactive.watch('left', watcher2);
      reactive.state.left = 200;

      expect(watcher1).toHaveBeenCalledWith(200, 100);
      expect(watcher2).toHaveBeenCalledWith(200, 100);
    });

    test('should return unwatch function', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const watcher = jest.fn();

      const unwatch = reactive.watch('left', watcher);
      unwatch();
      reactive.state.left = 200;

      expect(watcher).not.toHaveBeenCalled();
    });

    test('should support watching computed properties', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        minimized: false
      }, null, 12345);
      const watcher = jest.fn();

      reactive.watch('isVisible', watcher);
      reactive.state.minimized = true;

      expect(watcher).toHaveBeenCalledWith(false, true);
    });

    test('should handle watcher errors gracefully', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const badWatcher = jest.fn(() => {
        throw new Error('Watcher error');
      });
      const goodWatcher = jest.fn();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      reactive.watch('left', badWatcher);
      reactive.watch('left', goodWatcher);

      // Should not throw
      expect(() => {
        reactive.state.left = 200;
      }).not.toThrow();

      // Good watcher should still be called
      expect(goodWatcher).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should throw error if callback is not a function', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });

      expect(() => {
        reactive.watch('left', 'not a function');
      }).toThrow('ReactiveQuickTab.watch requires a callback function');
    });

    test('unwatch should clean up empty watcher sets', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const watcher = jest.fn();

      const unwatch = reactive.watch('left', watcher);
      unwatch();

      // Internal check - watcher set should be removed
      expect(reactive._watchers.has('left')).toBe(false);
    });
  });

  describe('Validation', () => {
    describe('left/top validation', () => {
      test('should accept valid left/top values', () => {
        const reactive = new ReactiveQuickTab({ id: 'qt-123' });

        reactive.state.left = 0;
        reactive.state.top = 0;
        expect(reactive.state.left).toBe(0);
        expect(reactive.state.top).toBe(0);

        reactive.state.left = 9999;
        reactive.state.top = 9999;
        expect(reactive.state.left).toBe(9999);
        expect(reactive.state.top).toBe(9999);
      });

      test('should reject negative left/top values', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', left: 100 });

        reactive.state.left = -1;

        expect(reactive.state.left).toBe(100); // Unchanged
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      });

      test('should reject left/top >= 10000', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', left: 100 });

        reactive.state.left = 10000;

        expect(reactive.state.left).toBe(100); // Unchanged
        consoleSpy.mockRestore();
      });

      test('should reject non-numeric left/top', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', left: 100 });

        reactive.state.left = 'invalid';

        expect(reactive.state.left).toBe(100); // Unchanged
        consoleSpy.mockRestore();
      });
    });

    describe('width/height validation', () => {
      test('should accept valid width/height values', () => {
        const reactive = new ReactiveQuickTab({ id: 'qt-123' });

        reactive.state.width = 100;
        reactive.state.height = 100;
        expect(reactive.state.width).toBe(100);
        expect(reactive.state.height).toBe(100);

        reactive.state.width = 4999;
        reactive.state.height = 4999;
        expect(reactive.state.width).toBe(4999);
        expect(reactive.state.height).toBe(4999);
      });

      test('should reject width/height < 100', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', width: 800 });

        reactive.state.width = 99;

        expect(reactive.state.width).toBe(800); // Unchanged
        consoleSpy.mockRestore();
      });

      test('should reject width/height >= 5000', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', width: 800 });

        reactive.state.width = 5000;

        expect(reactive.state.width).toBe(800); // Unchanged
        consoleSpy.mockRestore();
      });
    });

    describe('zIndex validation', () => {
      test('should accept valid zIndex values', () => {
        const reactive = new ReactiveQuickTab({ id: 'qt-123' });

        reactive.state.zIndex = 0;
        expect(reactive.state.zIndex).toBe(0);

        reactive.state.zIndex = 999999;
        expect(reactive.state.zIndex).toBe(999999);
      });

      test('should reject negative zIndex', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', zIndex: 1000 });

        reactive.state.zIndex = -1;

        expect(reactive.state.zIndex).toBe(1000); // Unchanged
        consoleSpy.mockRestore();
      });
    });

    describe('minimized validation', () => {
      test('should accept boolean minimized values', () => {
        const reactive = new ReactiveQuickTab({ id: 'qt-123' });

        reactive.state.minimized = true;
        expect(reactive.state.minimized).toBe(true);

        reactive.state.minimized = false;
        expect(reactive.state.minimized).toBe(false);
      });

      test('should reject non-boolean minimized', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', minimized: false });

        reactive.state.minimized = 'true';

        expect(reactive.state.minimized).toBe(false); // Unchanged
        consoleSpy.mockRestore();
      });
    });

    describe('soloedOnTabs/mutedOnTabs validation', () => {
      test('should accept valid arrays of numbers', () => {
        const reactive = new ReactiveQuickTab({ id: 'qt-123' });

        reactive.state.soloedOnTabs = [1, 2, 3];
        expect(reactive.state.soloedOnTabs).toEqual([1, 2, 3]);

        reactive.state.mutedOnTabs = [4, 5, 6];
        expect(reactive.state.mutedOnTabs).toEqual([4, 5, 6]);
      });

      test('should reject non-array values', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', soloedOnTabs: [] });

        reactive.state.soloedOnTabs = 'invalid';

        expect(reactive.state.soloedOnTabs).toEqual([]); // Unchanged
        consoleSpy.mockRestore();
      });

      test('should reject arrays with non-numbers', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const reactive = new ReactiveQuickTab({ id: 'qt-123', soloedOnTabs: [] });

        reactive.state.soloedOnTabs = [1, 'two', 3];

        expect(reactive.state.soloedOnTabs).toEqual([]); // Unchanged
        consoleSpy.mockRestore();
      });
    });
  });

  describe('Solo/Mute Mutual Exclusion', () => {
    test('setting solo should clear mute', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [],
        mutedOnTabs: [12345, 67890]
      });

      reactive.state.soloedOnTabs = [12345];

      expect(reactive.state.soloedOnTabs).toEqual([12345]);
      expect(reactive.state.mutedOnTabs).toEqual([]);
    });

    test('setting mute should clear solo', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [12345, 67890],
        mutedOnTabs: []
      });

      reactive.state.mutedOnTabs = [12345];

      expect(reactive.state.mutedOnTabs).toEqual([12345]);
      expect(reactive.state.soloedOnTabs).toEqual([]);
    });

    test('setting empty solo should not affect mute', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [12345],
        mutedOnTabs: []
      });

      reactive.state.soloedOnTabs = [];

      expect(reactive.state.soloedOnTabs).toEqual([]);
      expect(reactive.state.mutedOnTabs).toEqual([]);
    });

    test('setting empty mute should not affect solo', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [],
        mutedOnTabs: [12345]
      });

      reactive.state.mutedOnTabs = [];

      expect(reactive.state.mutedOnTabs).toEqual([]);
      expect(reactive.state.soloedOnTabs).toEqual([]);
    });

    test('mutual exclusion should notify watchers', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [],
        mutedOnTabs: [12345]
      });
      const muteWatcher = jest.fn();

      reactive.watch('mutedOnTabs', muteWatcher);
      reactive.state.soloedOnTabs = [12345]; // Should clear mute

      expect(muteWatcher).toHaveBeenCalledWith([], [12345]);
    });
  });

  describe('toJSON() serialization', () => {
    test('should return plain object', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        left: 150,
        top: 250,
        width: 900,
        height: 700,
        zIndex: 2000,
        minimized: true,
        soloedOnTabs: [1, 2],
        mutedOnTabs: [3, 4],
        url: 'https://example.com',
        title: 'Test Tab',
        cookieStoreId: 'firefox-container-1',
        createdAt: 1234567890,
        lastModified: 1234567900
      });

      const json = reactive.toJSON();

      expect(json).toEqual({
        id: 'qt-123',
        left: 150,
        top: 250,
        width: 900,
        height: 700,
        zIndex: 2000,
        minimized: true,
        soloedOnTabs: [1, 2],
        mutedOnTabs: [3, 4],
        url: 'https://example.com',
        title: 'Test Tab',
        cookieStoreId: 'firefox-container-1',
        createdAt: 1234567890,
        lastModified: expect.any(Number) // May have been updated
      });
    });

    test('should clone arrays to prevent mutation', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [1, 2, 3]
      });

      const json = reactive.toJSON();
      json.soloedOnTabs.push(4);

      // Original should be unchanged
      expect(reactive.state.soloedOnTabs).toEqual([1, 2, 3]);
    });

    test('should be JSON serializable', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });

      const jsonString = JSON.stringify(reactive.toJSON());
      const parsed = JSON.parse(jsonString);

      expect(parsed.id).toBe('qt-123');
    });
  });

  describe('updateCurrentTabId()', () => {
    test('should update currentTabId', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, null, 12345);

      reactive.updateCurrentTabId(67890);

      expect(reactive.currentTabId).toBe(67890);
    });

    test('should invalidate visibility computation', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [12345]
      }, null, 12345);

      expect(reactive.state.isVisible).toBe(true);

      reactive.updateCurrentTabId(67890);

      expect(reactive.state.isVisible).toBe(false);
    });

    test('should notify isVisible watchers on change', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        soloedOnTabs: [12345]
      }, null, 12345);
      const watcher = jest.fn();

      reactive.watch('isVisible', watcher);
      reactive.updateCurrentTabId(67890);

      expect(watcher).toHaveBeenCalledWith(false, true);
    });

    test('should not notify if visibility unchanged', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123' // Global mode - visible everywhere
      }, null, 12345);
      const watcher = jest.fn();

      reactive.watch('isVisible', watcher);
      reactive.updateCurrentTabId(67890);

      expect(watcher).not.toHaveBeenCalled();
    });

    test('should warn if tabId is not a number', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, null, 12345);

      reactive.updateCurrentTabId('invalid');

      expect(reactive.currentTabId).toBe(12345); // Unchanged
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('destroy()', () => {
    test('should clean up watchers', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const watcher = jest.fn();

      reactive.watch('left', watcher);
      reactive.destroy();

      expect(reactive._watchers.size).toBe(0);
    });

    test('should clear computed cache', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, null, 12345);

      // Populate cache
      reactive.state.isVisible;
      expect(reactive._computedCache.size).toBeGreaterThan(0);

      reactive.destroy();

      expect(reactive._computedCache.size).toBe(0);
    });

    test('should set onSync to null', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({ id: 'qt-123' }, onSync);

      reactive.destroy();

      expect(reactive.onSync).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle Symbol properties', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const sym = Symbol('test');

      // Should not throw
      expect(() => {
        reactive.state[sym] = 'value';
      }).not.toThrow();
    });

    test('should handle undefined computed property', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });

      expect(reactive.state.nonExistentComputed).toBeUndefined();
    });

    test('should allow unknown properties', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });

      reactive.state.customProp = 'custom value';

      expect(reactive.state.customProp).toBe('custom value');
    });

    test('should handle empty currentTabId for isMuted', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-123',
        mutedOnTabs: [12345]
      }, null, null);

      expect(reactive.state.isMuted).toBe(false);
    });

    test('should handle Date objects as special objects', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-123' });
      const date = new Date();

      reactive.state.someDate = date;

      expect(reactive.state.someDate).toEqual(date);
    });
  });
});
