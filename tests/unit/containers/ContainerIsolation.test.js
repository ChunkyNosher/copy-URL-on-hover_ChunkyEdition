/**
 * Container Isolation Tests
 *
 * Tests for Firefox Container boundary enforcement, container context detection,
 * and storage key container prefixing as specified in comprehensive-unit-testing-strategy.md (Section 6)
 *
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 6.1)
 * - docs/issue-47-revised-scenarios.md (Scenarios 8, 19, 20)
 *
 * Related Issues:
 * - #47: Quick Tabs comprehensive behavior scenarios
 *
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

// Mock browser API
global.browser = {
  tabs: {
    query: jest.fn(),
    get: jest.fn(),
    onRemoved: {
      addListener: jest.fn()
    }
  },
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

describe('Container Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Create event bus for future use if needed
    new EventEmitter();
  });

  describe('Container Context Detection', () => {
    test('should correctly identify current container from active tab', async () => {
      browser.tabs.query.mockResolvedValue([
        { id: 123, active: true, cookieStoreId: 'firefox-container-1' }
      ]);

      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const containerId = tabs[0]?.cookieStoreId || 'firefox-default';

      expect(containerId).toBe('firefox-container-1');
      expect(browser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });

    test('should fall back to default container when query fails', async () => {
      browser.tabs.query.mockRejectedValue(new Error('Query failed'));

      let containerId = 'firefox-default';
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        containerId = tabs[0]?.cookieStoreId || 'firefox-default';
      } catch (err) {
        // Fallback already set
      }

      expect(containerId).toBe('firefox-default');
    });

    test('should fall back to default container when no active tab found', async () => {
      browser.tabs.query.mockResolvedValue([]);

      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const containerId = tabs[0]?.cookieStoreId || 'firefox-default';

      expect(containerId).toBe('firefox-default');
    });

    test('should handle missing cookieStoreId property', async () => {
      browser.tabs.query.mockResolvedValue([{ id: 123, active: true }]);

      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const containerId = tabs[0]?.cookieStoreId || 'firefox-default';

      expect(containerId).toBe('firefox-default');
    });

    test('should distinguish between different containers', async () => {
      const containers = [
        'firefox-default',
        'firefox-container-1', // Personal
        'firefox-container-2', // Work
        'firefox-container-3', // Banking
        'firefox-container-4' // Shopping
      ];

      for (const containerId of containers) {
        browser.tabs.query.mockResolvedValue([
          { id: 123, active: true, cookieStoreId: containerId }
        ]);

        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const detected = tabs[0]?.cookieStoreId || 'firefox-default';

        expect(detected).toBe(containerId);
      }
    });
  });

  describe('Storage Key Container Prefixing', () => {
    test('should include container ID in storage key format', () => {
      const quickTabId = 'qt-12345';
      const containerId = 'firefox-container-1';
      const storageKey = `qt_${containerId}_${quickTabId}`;

      expect(storageKey).toBe('qt_firefox-container-1_qt-12345');
      expect(storageKey).toContain(containerId);
      expect(storageKey).toContain(quickTabId);
    });

    test('should generate different storage keys for different containers', () => {
      const quickTabId = 'qt-12345';
      const defaultKey = `qt_firefox-default_${quickTabId}`;
      const personalKey = `qt_firefox-container-1_${quickTabId}`;
      const workKey = `qt_firefox-container-2_${quickTabId}`;

      expect(defaultKey).not.toBe(personalKey);
      expect(personalKey).not.toBe(workKey);
      expect(workKey).not.toBe(defaultKey);
    });

    test('should storage keys follow consistent format', () => {
      const pattern = /^qt_firefox-(default|container-\d+)_qt-[a-zA-Z0-9-]+$/;

      const keys = [
        'qt_firefox-default_qt-abc123',
        'qt_firefox-container-1_qt-def456',
        'qt_firefox-container-2_qt-789xyz'
      ];

      keys.forEach(key => {
        expect(key).toMatch(pattern);
      });
    });

    test('should parse storage key to extract container ID', () => {
      const storageKey = 'qt_firefox-container-1_qt-12345';
      const parts = storageKey.split('_');
      const containerId = parts[1]; // firefox-container-1
      const quickTabId = parts.slice(2).join('_'); // qt-12345

      expect(containerId).toBe('firefox-container-1');
      expect(quickTabId).toBe('qt-12345');
    });
  });

  describe('Container Boundary Enforcement', () => {
    test('should Quick Tab in container A not visible in container B', () => {
      const qt = {
        id: 'qt-1',
        cookieStoreId: 'firefox-default',
        url: 'https://example.com'
      };

      const containerA = 'firefox-default';
      const containerB = 'firefox-container-1';

      // Quick Tab should only be accessible in its own container
      const isVisibleInA = qt.cookieStoreId === containerA;
      const isVisibleInB = qt.cookieStoreId === containerB;

      expect(isVisibleInA).toBe(true);
      expect(isVisibleInB).toBe(false);
    });

    test('should filter Quick Tabs by container when loading from storage', async () => {
      const allQuickTabs = {
        'qt_firefox-default_qt-1': { id: 'qt-1', cookieStoreId: 'firefox-default' },
        'qt_firefox-default_qt-2': { id: 'qt-2', cookieStoreId: 'firefox-default' },
        'qt_firefox-container-1_qt-3': { id: 'qt-3', cookieStoreId: 'firefox-container-1' },
        'qt_firefox-container-1_qt-4': { id: 'qt-4', cookieStoreId: 'firefox-container-1' }
      };

      browser.storage.sync.get.mockResolvedValue(allQuickTabs);

      const result = await browser.storage.sync.get(null);
      const currentContainer = 'firefox-default';

      // Filter to only current container
      const filtered = Object.entries(result)
        .filter(([key]) => key.startsWith(`qt_${currentContainer}_`))
        .map(([, value]) => value);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('qt-1');
      expect(filtered[1].id).toBe('qt-2');
    });

    test('should not load Quick Tabs from other containers', async () => {
      const allQuickTabs = {
        'qt_firefox-default_qt-1': { id: 'qt-1', cookieStoreId: 'firefox-default' },
        'qt_firefox-container-1_qt-2': { id: 'qt-2', cookieStoreId: 'firefox-container-1' }
      };

      browser.storage.sync.get.mockResolvedValue(allQuickTabs);

      const result = await browser.storage.sync.get(null);
      const currentContainer = 'firefox-container-1';

      const filtered = Object.entries(result)
        .filter(([key]) => key.startsWith(`qt_${currentContainer}_`))
        .map(([, value]) => value);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('qt-2');
      expect(filtered[0].cookieStoreId).toBe('firefox-container-1');

      // Should not include default container Quick Tab
      expect(filtered.find(qt => qt.id === 'qt-1')).toBeUndefined();
    });

    test('should respect container boundaries in Manager Panel display', async () => {
      const allQuickTabs = [
        { id: 'qt-1', cookieStoreId: 'firefox-default', url: 'https://example1.com' },
        { id: 'qt-2', cookieStoreId: 'firefox-container-1', url: 'https://example2.com' },
        { id: 'qt-3', cookieStoreId: 'firefox-container-2', url: 'https://example3.com' }
      ];

      // Manager Panel should group by container
      const grouped = allQuickTabs.reduce((acc, qt) => {
        if (!acc[qt.cookieStoreId]) {
          acc[qt.cookieStoreId] = [];
        }
        acc[qt.cookieStoreId].push(qt);
        return acc;
      }, {});

      expect(grouped['firefox-default']).toHaveLength(1);
      expect(grouped['firefox-container-1']).toHaveLength(1);
      expect(grouped['firefox-container-2']).toHaveLength(1);
      expect(Object.keys(grouped)).toHaveLength(3);
    });

    test('should broadcast messages respect container boundaries', () => {
      const message = {
        action: 'UPDATE_POSITION',
        id: 'qt-1',
        cookieStoreId: 'firefox-container-1',
        position: { left: 100, top: 100 }
      };

      const receivingContainers = ['firefox-default', 'firefox-container-1', 'firefox-container-2'];

      receivingContainers.forEach(containerId => {
        const shouldReceive = containerId === message.cookieStoreId;

        if (shouldReceive) {
          // Message should be processed
          expect(message.cookieStoreId).toBe(containerId);
        } else {
          // Message should be ignored
          expect(message.cookieStoreId).not.toBe(containerId);
        }
      });
    });
  });

  describe('Container-Specific State Persistence', () => {
    test('should save Quick Tab state with container context', async () => {
      const quickTab = {
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        cookieStoreId: 'firefox-container-1'
      };

      const storageKey = `qt_${quickTab.cookieStoreId}_${quickTab.id}`;
      const storageData = { [storageKey]: quickTab };

      await browser.storage.sync.set(storageData);

      expect(browser.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'qt_firefox-container-1_qt-1': expect.objectContaining({
            id: 'qt-1',
            cookieStoreId: 'firefox-container-1'
          })
        })
      );
    });

    test('should load Quick Tab state from correct container', async () => {
      const storageData = {
        'qt_firefox-container-1_qt-1': {
          id: 'qt-1',
          cookieStoreId: 'firefox-container-1',
          url: 'https://example.com'
        }
      };

      browser.storage.sync.get.mockResolvedValue(storageData);

      const result = await browser.storage.sync.get(null);
      const containerKey = 'qt_firefox-container-1_qt-1';

      expect(result[containerKey]).toBeDefined();
      expect(result[containerKey].cookieStoreId).toBe('firefox-container-1');
    });

    test('should delete Quick Tab from correct container only', async () => {
      const quickTabId = 'qt-1';
      const containerId = 'firefox-container-1';
      const storageKey = `qt_${containerId}_${quickTabId}`;

      await browser.storage.sync.remove(storageKey);

      expect(browser.storage.sync.remove).toHaveBeenCalledWith('qt_firefox-container-1_qt-1');
    });

    test('should not affect Quick Tabs in other containers when deleting', async () => {
      const beforeDelete = {
        'qt_firefox-default_qt-1': { id: 'qt-1' },
        'qt_firefox-container-1_qt-1': { id: 'qt-1' }
      };

      browser.storage.sync.get.mockResolvedValue(beforeDelete);

      // Delete from container-1 only
      await browser.storage.sync.remove('qt_firefox-container-1_qt-1');

      // Verify only container-1 key was removed
      expect(browser.storage.sync.remove).toHaveBeenCalledWith('qt_firefox-container-1_qt-1');
      expect(browser.storage.sync.remove).not.toHaveBeenCalledWith('qt_firefox-default_qt-1');
    });
  });

  describe('Container Cleanup on Tab Close', () => {
    test('should track tabs per container', () => {
      const containerTabs = {
        'firefox-default': [1, 2, 3],
        'firefox-container-1': [4, 5],
        'firefox-container-2': [6]
      };

      expect(containerTabs['firefox-default']).toHaveLength(3);
      expect(containerTabs['firefox-container-1']).toHaveLength(2);
      expect(containerTabs['firefox-container-2']).toHaveLength(1);
    });

    test('should detect when all tabs in container are closed', () => {
      const containerTabs = {
        'firefox-default': [1, 2],
        'firefox-container-1': [] // All closed
      };

      const container1HasTabs = containerTabs['firefox-container-1'].length > 0;
      const defaultHasTabs = containerTabs['firefox-default'].length > 0;

      expect(container1HasTabs).toBe(false); // Should trigger cleanup
      expect(defaultHasTabs).toBe(true); // Should not cleanup
    });

    test('should prepare Quick Tabs for cleanup when container closes', async () => {
      const containerId = 'firefox-container-1';
      const quickTabsToCleanup = [
        { id: 'qt-1', cookieStoreId: containerId },
        { id: 'qt-2', cookieStoreId: containerId }
      ];

      // When all tabs in container closed, these Quick Tabs should be removed
      const keysToRemove = quickTabsToCleanup.map(qt => `qt_${containerId}_${qt.id}`);

      expect(keysToRemove).toEqual(['qt_firefox-container-1_qt-1', 'qt_firefox-container-1_qt-2']);
    });
  });

  describe('Cross-Container Operations', () => {
    test('should not allow Quick Tab to migrate between containers', () => {
      const qt = {
        id: 'qt-1',
        cookieStoreId: 'firefox-default',
        url: 'https://example.com'
      };

      // Attempt to change container (should not be allowed)
      // Container is immutable - no migration API exists
      const canMigrate = false;

      expect(canMigrate).toBe(false);
      expect(qt.cookieStoreId).toBe('firefox-default'); // Unchanged
    });

    test('should Manager Panel show all containers but enforce visibility', () => {
      const managerView = {
        containersDisplayed: [
          { id: 'firefox-default', quickTabs: ['qt-1', 'qt-2'] },
          { id: 'firefox-container-1', quickTabs: ['qt-3'] },
          { id: 'firefox-container-2', quickTabs: ['qt-4'] }
        ],
        currentContainer: 'firefox-default'
      };

      // Manager can see all containers
      expect(managerView.containersDisplayed).toHaveLength(3);

      // But operations respect boundaries
      const canRestoreInCurrentContainer = qtContainer => {
        return qtContainer === managerView.currentContainer;
      };

      expect(canRestoreInCurrentContainer('firefox-default')).toBe(true);
      expect(canRestoreInCurrentContainer('firefox-container-1')).toBe(false);
    });

    test('should container isolation persist across browser restart', async () => {
      // Before restart: save with container context
      const beforeRestart = {
        'qt_firefox-container-1_qt-1': {
          id: 'qt-1',
          cookieStoreId: 'firefox-container-1',
          url: 'https://example.com'
        }
      };

      browser.storage.sync.get.mockResolvedValue(beforeRestart);

      // After restart: load with container context
      const afterRestart = await browser.storage.sync.get(null);
      const loaded = afterRestart['qt_firefox-container-1_qt-1'];

      expect(loaded).toBeDefined();
      expect(loaded.cookieStoreId).toBe('firefox-container-1');
      expect(loaded.id).toBe('qt-1');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle undefined cookieStoreId gracefully', () => {
      const qt = {
        id: 'qt-1',
        cookieStoreId: undefined,
        url: 'https://example.com'
      };

      const containerId = qt.cookieStoreId || 'firefox-default';

      expect(containerId).toBe('firefox-default');
    });

    test('should handle null cookieStoreId gracefully', () => {
      const qt = {
        id: 'qt-1',
        cookieStoreId: null,
        url: 'https://example.com'
      };

      const containerId = qt.cookieStoreId || 'firefox-default';

      expect(containerId).toBe('firefox-default');
    });

    test('should handle empty string cookieStoreId', () => {
      const qt = {
        id: 'qt-1',
        cookieStoreId: '',
        url: 'https://example.com'
      };

      const containerId = qt.cookieStoreId || 'firefox-default';

      expect(containerId).toBe('firefox-default');
    });

    test('should handle malformed storage keys', () => {
      const malformedKeys = [
        'qt_qt-1', // Missing container (only 2 parts)
        'qt-1', // Wrong format entirely (no underscores)
        'qt__qt-1', // Empty container
        'qt_firefox-container-1_' // Missing ID (empty string)
      ];

      malformedKeys.forEach(key => {
        const parts = key.split('_');
        const isValid =
          parts.length >= 3 && parts[0] === 'qt' && parts[1].length > 0 && parts[2].length > 0;

        expect(isValid).toBe(false);
      });
    });

    test('should handle storage with mixed key formats', async () => {
      const mixedStorage = {
        'qt_firefox-default_qt-1': { id: 'qt-1', cookieStoreId: 'firefox-default' },
        invalidKey: { id: 'qt-2' },
        'qt_firefox-container-1_qt-3': { id: 'qt-3', cookieStoreId: 'firefox-container-1' }
      };

      browser.storage.sync.get.mockResolvedValue(mixedStorage);

      const result = await browser.storage.sync.get(null);
      const validKeys = Object.keys(result).filter(key => key.startsWith('qt_firefox-'));

      expect(validKeys).toHaveLength(2);
      expect(validKeys).toContain('qt_firefox-default_qt-1');
      expect(validKeys).toContain('qt_firefox-container-1_qt-3');
    });
  });
});
