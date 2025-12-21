// Mock webextension-polyfill
jest.mock('webextension-polyfill', () => ({
  storage: {
    session: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  }
}));

import browser from 'webextension-polyfill';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { SessionStorageAdapter } from '../../../src/storage/SessionStorageAdapter.js';

/**
 * SessionStorageAdapter Tests
 * v1.6.3.10-v7 - Updated to match unified storage format (matching SyncStorageAdapter)
 *
 * Storage Format (v1.6.3.10-v7 - Unified):
 * {
 *   quick_tabs_state_v2: {
 *     tabs: [QuickTab, ...],  // ALL Quick Tabs in one array
 *     saveId: 'timestamp-random',
 *     timestamp: timestamp
 *   }
 * }
 */
describe('SessionStorageAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SessionStorageAdapter();
    jest.clearAllMocks();

    // Default mock implementations
    browser.storage.session.get.mockResolvedValue({});
    browser.storage.session.set.mockResolvedValue(undefined);
    browser.storage.session.remove.mockResolvedValue(undefined);
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

      expect(browser.storage.session.set).toHaveBeenCalledWith({
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

    test('should save empty array when no Quick Tabs', async () => {
      await adapter.save([]);

      expect(browser.storage.session.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: [],
          saveId: expect.stringMatching(/^\d+-[a-z0-9]+$/),
          timestamp: expect.any(Number)
        })
      });
    });

    test('should handle raw tab objects (not QuickTab instances)', async () => {
      const rawTab = {
        id: 'qt-raw',
        url: 'https://raw.com'
      };

      await adapter.save([rawTab]);

      expect(browser.storage.session.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: expect.arrayContaining([
            expect.objectContaining({
              id: 'qt-raw',
              url: 'https://raw.com'
            })
          ])
        })
      });
    });
  });

  describe('load()', () => {
    test('should load Quick Tabs from unified format', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-1', url: 'https://example.com' }],
          timestamp: Date.now()
        }
      });

      const result = await adapter.load();

      expect(result).toEqual({
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: 'qt-1', url: 'https://example.com' })
        ]),
        timestamp: expect.any(Number)
      });
    });

    test('should migrate from legacy container format', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1', url: 'https://example.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await adapter.load();

      expect(result).toEqual({
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: 'qt-1', url: 'https://example.com' })
        ]),
        timestamp: expect.any(Number)
      });

      // Should have saved migrated format
      expect(browser.storage.session.set).toHaveBeenCalled();
    });

    test('should return null when storage is empty', async () => {
      browser.storage.session.get.mockResolvedValue({});

      const result = await adapter.load();

      expect(result).toBeNull();
    });

    test('should return null when tabs array is empty', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [],
          timestamp: Date.now()
        }
      });

      const result = await adapter.load();

      expect(result).toBeNull();
    });
  });

  describe('loadAll()', () => {
    test('should return same as load() in unified format', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-1' }, { id: 'qt-2' }],
          timestamp: Date.now()
        }
      });

      const result = await adapter.loadAll();

      expect(result).toEqual({
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: 'qt-1' }),
          expect.objectContaining({ id: 'qt-2' })
        ]),
        timestamp: expect.any(Number)
      });
    });

    test('should return null when no tabs exist', async () => {
      browser.storage.session.get.mockResolvedValue({});

      const result = await adapter.loadAll();

      expect(result).toBeNull();
    });
  });

  describe('delete()', () => {
    test('should delete specific Quick Tab from unified format', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [
            { id: 'qt-1', url: 'https://one.com' },
            { id: 'qt-2', url: 'https://two.com' }
          ],
          timestamp: Date.now()
        }
      });

      await adapter.delete('qt-1');

      // Should save with only qt-2
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: expect.arrayContaining([expect.objectContaining({ id: 'qt-2' })])
        })
      });

      // Should not contain qt-1
      const setCall = browser.storage.session.set.mock.calls[0][0];
      const tabs = setCall.quick_tabs_state_v2.tabs;
      expect(tabs.find(t => t.id === 'qt-1')).toBeUndefined();
    });

    test('should do nothing when tab not found', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-1' }],
          timestamp: Date.now()
        }
      });

      await adapter.delete('qt-nonexistent');

      // Should not call set since nothing changed
      expect(browser.storage.session.set).not.toHaveBeenCalled();
    });

    test('should migrate from legacy format when deleting', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [
                { id: 'qt-1', url: 'https://one.com' },
                { id: 'qt-2', url: 'https://two.com' }
              ]
            }
          }
        }
      });

      await adapter.delete('qt-1');

      // Should save in unified format
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: expect.arrayContaining([expect.objectContaining({ id: 'qt-2' })])
        })
      });
    });
  });

  describe('clear()', () => {
    test('should remove all Quick Tabs from storage', async () => {
      await adapter.clear();

      expect(browser.storage.session.remove).toHaveBeenCalledWith('quick_tabs_state_v2');
    });
  });

  describe('Error Handling', () => {
    test('should return null when storage.get fails', async () => {
      browser.storage.session.get.mockRejectedValue(new Error('Storage error'));

      const result = await adapter.loadAll();

      expect(result).toBeNull();
    });

    test('should throw error when storage.set fails', async () => {
      browser.storage.session.set.mockRejectedValue(new Error('Storage error'));

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await expect(adapter.save([quickTab])).rejects.toThrow('Storage error');
    });
  });

  describe('Legacy Format Migration', () => {
    test('should migrate multiple containers to single tabs array', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1', url: 'https://one.com' }]
            },
            'firefox-container-1': {
              tabs: [{ id: 'qt-2', url: 'https://two.com' }]
            }
          }
        }
      });

      const result = await adapter.load();

      expect(result.tabs).toHaveLength(2);
      expect(result.tabs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'qt-1' }),
          expect.objectContaining({ id: 'qt-2' })
        ])
      );
    });
  });
});
