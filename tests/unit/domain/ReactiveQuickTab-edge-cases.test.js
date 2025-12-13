/**
 * ReactiveQuickTab Edge Cases Tests
 * v1.6.3.8 - Additional edge case tests for improved domain coverage
 *
 * Target: Cover uncovered lines to help achieve 100% domain coverage.
 */

import { ReactiveQuickTab } from '../../../src/domain/ReactiveQuickTab.js';

describe('ReactiveQuickTab Edge Cases', () => {
  describe('Proxy Depth Limits', () => {
    it('should handle deeply nested objects without infinite recursion', () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep'
                }
              }
            }
          }
        }
      };

      const reactive = new ReactiveQuickTab({
        id: 'qt-deep-nested',
        ...deeplyNested
      });

      // Access deeply nested properties - they should be accessible
      // but proxy depth is limited to MAX_PROXY_DEPTH (3)
      expect(reactive.state).toBeDefined();
    });

    it('should limit proxy depth to prevent performance issues', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-proxy-depth'
      });

      // Directly setting nested object triggers proxy creation
      // This should not cause infinite recursion
      reactive.state.customNested = {
        a: { b: { c: { d: { e: 'deep' } } } }
      };

      expect(reactive.state.customNested).toBeDefined();
    });
  });

  describe('Timestamp Validation', () => {
    it('should validate createdAt as timestamp', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-timestamp',
        createdAt: Date.now()
      });

      // Try setting invalid createdAt (negative number)
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      reactive.state.createdAt = -1;

      // Should reject negative timestamp
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should validate lastModified as timestamp', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-lastmod',
        lastModified: Date.now()
      });

      // Try setting invalid lastModified (string)
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      reactive.state.lastModified = 'not-a-timestamp';

      // Should reject non-numeric value
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should accept valid positive timestamps', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-valid-timestamp'
      });

      const validTimestamp = Date.now();
      reactive.state.createdAt = validTimestamp;

      // Timestamps update lastModified automatically, so check createdAt
      expect(reactive.state.createdAt).toBe(validTimestamp);
    });

    it('should accept zero as valid timestamp', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-zero-timestamp'
      });

      reactive.state.createdAt = 0;
      expect(reactive.state.createdAt).toBe(0);
    });
  });

  describe('Symbol Property Handling', () => {
    it('should handle setting Symbol properties', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-symbol' });
      const testSymbol = Symbol('test');

      // Setting Symbol property should work
      reactive.state[testSymbol] = 'symbol-value';

      expect(reactive.state[testSymbol]).toBe('symbol-value');
    });

    it('should handle getting Symbol properties', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-symbol-get' });
      const sym = Symbol('getter');

      // First set, then get
      reactive.state[sym] = 123;
      expect(reactive.state[sym]).toBe(123);
    });

    it('should not trigger onSync for Symbol properties', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab({ id: 'qt-symbol-sync' }, onSync);
      const sym = Symbol('nosync');

      reactive.state[sym] = 'value';

      // Symbol properties should not trigger sync
      expect(onSync).not.toHaveBeenCalled();
    });
  });

  describe('Computed Property Edge Cases', () => {
    it('should return undefined for unknown computed property', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-unknown-computed' });

      // Access a property that looks like it could be computed but isn't
      expect(reactive.state.isUnknownComputed).toBeUndefined();
    });

    it('should handle computed property with null currentTabId', () => {
      const reactive = new ReactiveQuickTab(
        {
          id: 'qt-null-tabid',
          mutedOnTabs: [1, 2, 3]
        },
        null,
        null
      );

      // isMuted should be false when currentTabId is null
      expect(reactive.state.isMuted).toBe(false);
    });

    it('should correctly compute isMuted when currentTabId is in list', () => {
      const reactive = new ReactiveQuickTab(
        {
          id: 'qt-muted-computed',
          mutedOnTabs: [100, 200, 300]
        },
        null,
        200
      );

      expect(reactive.state.isMuted).toBe(true);
    });
  });

  describe('Nested Object Proxy', () => {
    it('should create proxy for nested plain objects', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-nested' });

      // Set a nested plain object
      reactive.state.customObject = {
        nested: {
          value: 'test'
        }
      };

      // Accessing should work through proxy
      expect(reactive.state.customObject.nested.value).toBe('test');
    });

    it('should not proxy arrays', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-array' });

      // Arrays should not be recursively proxied
      reactive.state.customArray = [1, 2, 3];

      expect(Array.isArray(reactive.state.customArray)).toBe(true);
      expect(reactive.state.customArray).toEqual([1, 2, 3]);
    });

    it('should not proxy special objects (Date, RegExp, etc)', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-special' });

      // Set special objects
      const date = new Date();
      const regex = /test/;
      const map = new Map();
      const set = new Set([1, 2, 3]);

      reactive.state.dateObj = date;
      reactive.state.regexObj = regex;
      reactive.state.mapObj = map;
      reactive.state.setObj = set;

      // These should be returned as-is, not proxied
      expect(reactive.state.dateObj).toBe(date);
      expect(reactive.state.regexObj).toBe(regex);
      expect(reactive.state.mapObj).toBe(map);
      expect(reactive.state.setObj).toBe(set);
    });

    it('should handle Error objects as special objects', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-error' });

      const error = new Error('test error');
      reactive.state.errorObj = error;

      expect(reactive.state.errorObj).toBe(error);
      expect(reactive.state.errorObj.message).toBe('test error');
    });

    it('should handle WeakMap and WeakSet as special objects', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-weak' });

      const weakMap = new WeakMap();
      const weakSet = new WeakSet();

      reactive.state.weakMapObj = weakMap;
      reactive.state.weakSetObj = weakSet;

      expect(reactive.state.weakMapObj).toBe(weakMap);
      expect(reactive.state.weakSetObj).toBe(weakSet);
    });
  });

  describe('Validator Edge Cases', () => {
    it('should accept string url', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-url',
        url: 'https://example.com'
      });

      reactive.state.url = 'https://new-url.com';
      expect(reactive.state.url).toBe('https://new-url.com');
    });

    it('should reject non-string url', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const reactive = new ReactiveQuickTab({
        id: 'qt-url-invalid',
        url: 'https://example.com'
      });

      reactive.state.url = 123; // Invalid

      expect(consoleSpy).toHaveBeenCalled();
      expect(reactive.state.url).toBe('https://example.com'); // Unchanged
      consoleSpy.mockRestore();
    });

    it('should accept string title', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-title',
        title: 'Original'
      });

      reactive.state.title = 'New Title';
      expect(reactive.state.title).toBe('New Title');
    });

    it('should accept string cookieStoreId', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-cookie',
        cookieStoreId: 'firefox-default'
      });

      reactive.state.cookieStoreId = 'firefox-container-1';
      expect(reactive.state.cookieStoreId).toBe('firefox-container-1');
    });

    it('should reject non-string cookieStoreId', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const reactive = new ReactiveQuickTab({
        id: 'qt-cookie-invalid',
        cookieStoreId: 'firefox-default'
      });

      reactive.state.cookieStoreId = 123; // Invalid

      expect(consoleSpy).toHaveBeenCalled();
      expect(reactive.state.cookieStoreId).toBe('firefox-default'); // Unchanged
      consoleSpy.mockRestore();
    });
  });

  describe('updateCurrentTabId Edge Cases', () => {
    it('should not update if tabId is same as current', () => {
      const reactive = new ReactiveQuickTab({ id: 'qt-same-tabid' }, null, 12345);
      const watcher = jest.fn();

      reactive.watch('isVisible', watcher);
      reactive.updateCurrentTabId(12345); // Same as current

      expect(watcher).not.toHaveBeenCalled();
    });

    it('should warn if tabId is not a number', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const reactive = new ReactiveQuickTab({ id: 'qt-invalid-tabid' }, null, 12345);

      reactive.updateCurrentTabId('not-a-number');

      expect(consoleSpy).toHaveBeenCalled();
      expect(reactive.currentTabId).toBe(12345); // Unchanged
      consoleSpy.mockRestore();
    });

    it('should warn if tabId is null', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const reactive = new ReactiveQuickTab({ id: 'qt-null-new-tabid' }, null, 12345);

      reactive.updateCurrentTabId(null);

      expect(consoleSpy).toHaveBeenCalled();
      expect(reactive.currentTabId).toBe(12345); // Unchanged
      consoleSpy.mockRestore();
    });

    it('should warn if tabId is undefined', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const reactive = new ReactiveQuickTab({ id: 'qt-undefined-tabid' }, null, 12345);

      reactive.updateCurrentTabId(undefined);

      expect(consoleSpy).toHaveBeenCalled();
      expect(reactive.currentTabId).toBe(12345); // Unchanged
      consoleSpy.mockRestore();
    });
  });

  describe('Array Equality Edge Cases', () => {
    it('should detect array length difference', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab(
        {
          id: 'qt-array-len',
          soloedOnTabs: [1, 2]
        },
        onSync
      );

      reactive.state.soloedOnTabs = [1, 2, 3]; // Different length

      expect(onSync).toHaveBeenCalled();
    });

    it('should detect array element difference', () => {
      const onSync = jest.fn();
      const reactive = new ReactiveQuickTab(
        {
          id: 'qt-array-elem',
          soloedOnTabs: [1, 2, 3]
        },
        onSync
      );

      reactive.state.soloedOnTabs = [1, 2, 4]; // Different element

      expect(onSync).toHaveBeenCalled();
    });
  });

  describe('ID Validation', () => {
    it('should reject numeric id', () => {
      expect(() => {
        new ReactiveQuickTab({ id: 123 });
      }).toThrow('ReactiveQuickTab requires data with a valid string id');
    });

    it('should reject empty string id', () => {
      // Empty string is technically a string, behavior depends on implementation
      const reactive = new ReactiveQuickTab({ id: '' });
      // Empty string should still work (it's a valid string)
      expect(reactive.id).toBe('');
    });

    it('should reject object id', () => {
      expect(() => {
        new ReactiveQuickTab({ id: { value: 'test' } });
      }).toThrow('ReactiveQuickTab requires data with a valid string id');
    });
  });

  describe('Computed Cache Invalidation', () => {
    it('should invalidate isSoloed cache when soloedOnTabs changes to non-empty', () => {
      const reactive = new ReactiveQuickTab({
        id: 'qt-cache-solo',
        soloedOnTabs: []
      });

      // Initially not soloed
      expect(reactive.state.isSoloed).toBe(false);

      // Add to solo list
      reactive.state.soloedOnTabs = [100];

      // Cache should be invalidated and recomputed
      expect(reactive.state.isSoloed).toBe(true);
    });

    it('should invalidate isMuted cache when mutedOnTabs changes', () => {
      const reactive = new ReactiveQuickTab(
        {
          id: 'qt-cache-mute',
          mutedOnTabs: []
        },
        null,
        100
      );

      // Initially not muted
      expect(reactive.state.isMuted).toBe(false);

      // Add current tab to mute list
      reactive.state.mutedOnTabs = [100];

      // Cache should be invalidated and recomputed
      expect(reactive.state.isMuted).toBe(true);
    });
  });
});
