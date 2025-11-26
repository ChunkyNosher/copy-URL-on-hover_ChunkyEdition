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
    test('should save Quick Tabs in unified format', async () => {
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
      browser.storage.local.get.mockResolvedValue({
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
      });

      const result = await adapter.load();

      expect(result.tabs).toHaveLength(2);
      expect(result.tabs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'qt-1' }),
        expect.objectContaining({ id: 'qt-2' })
      ]));
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
