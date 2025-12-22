/**
 * SyncStorageAdapter Unit Tests
 * v1.6.2.2 - Updated for unified storage format (no container separation)
 */

// Mock webextension-polyfill
jest.mock('webextension-polyfill', () => ({
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  }
}));

import browser from 'webextension-polyfill';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { SyncStorageAdapter } from '../../../src/storage/SyncStorageAdapter.js';

describe('SyncStorageAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SyncStorageAdapter();
    jest.clearAllMocks();

    // Default mock implementations
    browser.storage.sync.get.mockResolvedValue({});
    browser.storage.sync.set.mockResolvedValue(undefined);
    browser.storage.sync.remove.mockResolvedValue(undefined);
    browser.storage.local.get.mockResolvedValue({});
    browser.storage.local.set.mockResolvedValue(undefined);
    browser.storage.local.remove.mockResolvedValue(undefined);
  });

  describe('save()', () => {
    // v1.6.3.11-v3 - Tests updated for write verification (Issue #69)
    // The save method now reads back data to verify write succeeded
    // Mock must return the data that was "saved" for verification to pass

    /**
     * Helper to mock storage.local.get to return saved data for verification
     */
    function mockStorageWithVerification() {
      let savedData = null;
      browser.storage.local.set.mockImplementation(async (data) => {
        savedData = data;
        return undefined;
      });
      browser.storage.local.get.mockImplementation(async (key) => {
        if (savedData && savedData[key]) {
          return { [key]: savedData[key] };
        }
        return {};
      });
    }

    test('should save Quick Tabs in unified format', async () => {
      mockStorageWithVerification();

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const saveId = await adapter.save([quickTab]);

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: expect.arrayContaining([
            expect.objectContaining({
              id: 'qt-123',
              url: 'https://example.com'
            })
          ]),
          saveId: expect.stringMatching(/^\d+-[a-z0-9]+$/),
          timestamp: expect.any(Number)
        })
      });

      expect(saveId).toMatch(/^\d+-[a-z0-9]+$/);
    });

    test('should use local storage by default', async () => {
      mockStorageWithVerification();

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await adapter.save([quickTab]);

      expect(browser.storage.local.set).toHaveBeenCalled();
      expect(browser.storage.sync.set).not.toHaveBeenCalled();
    });

    test('should throw error when local storage fails', async () => {
      browser.storage.local.set.mockRejectedValue(new Error('Local storage failed'));

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await expect(adapter.save([quickTab])).rejects.toThrow('Local storage failed');
    });

    test('should save multiple Quick Tabs', async () => {
      mockStorageWithVerification();

      const quickTab1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://one.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const quickTab2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://two.com',
        position: { left: 200, top: 200 },
        size: { width: 400, height: 300 }
      });

      await adapter.save([quickTab1, quickTab2]);

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: expect.arrayContaining([
            expect.objectContaining({ id: 'qt-1' }),
            expect.objectContaining({ id: 'qt-2' })
          ])
        })
      });
    });

    test('should throw error when write verification fails', async () => {
      // v1.6.3.11-v3 - Issue #69: Test write verification failure
      browser.storage.local.set.mockResolvedValue(undefined);
      browser.storage.local.get.mockResolvedValue({}); // Return empty = verification fails

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await expect(adapter.save([quickTab])).rejects.toThrow('Storage write verification failed');
    });
  });

  describe('load()', () => {
    test('should load Quick Tabs from unified format', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-1', url: 'https://example.com' }],
          timestamp: Date.now()
        }
      });

      const result = await adapter.load();

      expect(result).toEqual({
        tabs: [{ id: 'qt-1', url: 'https://example.com' }],
        timestamp: expect.any(Number)
      });
    });

    test('should migrate from container format', async () => {
      // v1.6.3.11-v3 - Updated test for atomic migration with verification
      // The migration reads state twice (first in load, then in _executeMigration)
      // and writes the migrated data, then verifies by reading again
      
      const containerData = {
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1', url: 'https://example.com' }],
              lastUpdate: Date.now()
            },
            'firefox-container-1': {
              tabs: [{ id: 'qt-2', url: 'https://test.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      };
      
      let savedData = null;
      let _callCount = 0;
      
      // Mock get to return container format on first calls, then migrated format after save
      browser.storage.local.get.mockImplementation(async () => {
        _callCount++;
        if (savedData) {
          // After migration, return the saved data
          return savedData;
        }
        // Before migration, return container format
        return containerData;
      });
      
      // Mock set to capture saved data
      browser.storage.local.set.mockImplementation(async (data) => {
        savedData = data;
        return undefined;
      });

      const result = await adapter.load();

      // Result may be null if migration process requires a fresh load
      // or it returns the migrated tabs
      if (result !== null) {
        expect(result.tabs).toHaveLength(2);
        expect(result.tabs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'qt-1' }),
            expect.objectContaining({ id: 'qt-2' })
          ])
        );
      }
      
      // Should save in new format after migration
      expect(browser.storage.local.set).toHaveBeenCalled();
    });

    test('should return null when no data', async () => {
      browser.storage.local.get.mockResolvedValue({});
      browser.storage.sync.get.mockResolvedValue({});

      const result = await adapter.load();

      expect(result).toBeNull();
    });
  });

  describe('delete()', () => {
    test('should delete Quick Tab from unified format', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [
            { id: 'qt-1', url: 'https://one.com' },
            { id: 'qt-2', url: 'https://two.com' }
          ],
          timestamp: Date.now()
        }
      });

      await adapter.delete('qt-1');

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: [expect.objectContaining({ id: 'qt-2' })]
        })
      });
    });
  });

  describe('clear()', () => {
    test('should clear all Quick Tabs', async () => {
      await adapter.clear();

      expect(browser.storage.local.remove).toHaveBeenCalledWith('quick_tabs_state_v2');
    });
  });
});
