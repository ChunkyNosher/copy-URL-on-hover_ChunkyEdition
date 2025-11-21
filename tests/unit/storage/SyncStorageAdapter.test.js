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
    test('should save Quick Tabs in container-aware format', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const saveId = await adapter.save('firefox-container-1', [quickTab]);

      // v1.6.0.12 - Uses local storage by default
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-container-1': {
              tabs: expect.arrayContaining([
                expect.objectContaining({
                  id: 'qt-123',
                  url: 'https://example.com'
                })
              ]),
              lastUpdate: expect.any(Number)
            }
          },
          saveId: expect.stringMatching(/^\d+-[a-z0-9]+$/),
          timestamp: expect.any(Number)
        })
      });

      expect(saveId).toMatch(/^\d+-[a-z0-9]+$/);
    });

    test('should preserve existing containers when saving new container', async () => {
      // Setup existing state - v1.6.0.12 reads from local storage
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-old', url: 'https://old.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const quickTab = QuickTab.create({
        id: 'qt-new',
        url: 'https://new.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await adapter.save('firefox-container-1', [quickTab]);

      // v1.6.0.12 - Uses local storage by default
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.objectContaining({
              tabs: expect.arrayContaining([expect.objectContaining({ id: 'qt-old' })])
            }),
            'firefox-container-1': expect.objectContaining({
              tabs: expect.arrayContaining([expect.objectContaining({ id: 'qt-new' })])
            })
          }
        })
      });
    });

    test('should use local storage by default (v1.6.0.12)', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const saveId = await adapter.save('firefox-default', [quickTab]);

      // v1.6.0.12 - Always uses local storage (no quota limits)
      expect(browser.storage.local.set).toHaveBeenCalled();
      expect(browser.storage.sync.set).not.toHaveBeenCalled();
      expect(saveId).toMatch(/^\d+-[a-z0-9]+$/);
    });

    test('should throw error when local storage fails', async () => {
      browser.storage.local.set.mockRejectedValue(new Error('Local storage failed'));

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      // v1.6.0.12 - Only uses local storage now, so error propagates directly
      await expect(adapter.save('firefox-default', [quickTab])).rejects.toThrow('Local storage failed');
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

      await adapter.save('firefox-default', [quickTab1, quickTab2]);

      // v1.6.0.12 - Uses local storage by default
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': {
              tabs: expect.arrayContaining([
                expect.objectContaining({ id: 'qt-1' }),
                expect.objectContaining({ id: 'qt-2' })
              ]),
              lastUpdate: expect.any(Number)
            }
          }
        })
      });
    });

    test('should save empty array when no Quick Tabs', async () => {
      await adapter.save('firefox-default', []);

      // v1.6.0.12 - Uses local storage by default
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: expect.any(Number)
            }
          }
        })
      });
    });
  });

  describe('load()', () => {
    test('should load Quick Tabs for specific container', async () => {
      browser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1', url: 'https://example.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await adapter.load('firefox-default');

      expect(result).toEqual({
        tabs: [expect.objectContaining({ id: 'qt-1', url: 'https://example.com' })],
        lastUpdate: expect.any(Number)
      });
    });

    test('should return null when container not found', async () => {
      browser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await adapter.load('firefox-container-999');

      expect(result).toBeNull();
    });

    test('should return null when storage is empty', async () => {
      browser.storage.sync.get.mockResolvedValue({});

      const result = await adapter.load('firefox-default');

      expect(result).toBeNull();
    });

    test('should fallback to local storage when sync is empty', async () => {
      browser.storage.sync.get.mockResolvedValue({});
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await adapter.load('firefox-default');

      expect(result).toEqual({
        tabs: [expect.objectContaining({ id: 'qt-1' })],
        lastUpdate: expect.any(Number)
      });
    });
  });

  describe('loadAll()', () => {
    test('should load all containers', async () => {
      browser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1' }],
              lastUpdate: Date.now()
            },
            'firefox-container-1': {
              tabs: [{ id: 'qt-2' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await adapter.loadAll();

      expect(result).toEqual({
        'firefox-default': expect.objectContaining({
          tabs: expect.any(Array)
        }),
        'firefox-container-1': expect.objectContaining({
          tabs: expect.any(Array)
        })
      });

      expect(Object.keys(result)).toHaveLength(2);
    });

    test('should return empty object when no containers exist', async () => {
      browser.storage.sync.get.mockResolvedValue({});

      const result = await adapter.loadAll();

      expect(result).toEqual({});
    });
  });

  describe('delete()', () => {
    test('should delete specific Quick Tab from container', async () => {
      // v1.6.0.12 - Reads from local storage
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [
                { id: 'qt-1', url: 'https://one.com' },
                { id: 'qt-2', url: 'https://two.com' }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      await adapter.delete('firefox-default', 'qt-1');

      // v1.6.0.12 - Should save with only qt-2 to local storage
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.objectContaining({
              tabs: expect.arrayContaining([expect.objectContaining({ id: 'qt-2' })])
            })
          }
        })
      });

      // Should not contain qt-1
      const setCall = browser.storage.local.set.mock.calls[0][0];
      const tabs = setCall.quick_tabs_state_v2.containers['firefox-default'].tabs;
      expect(tabs.find(t => t.id === 'qt-1')).toBeUndefined();
    });

    test('should do nothing when container not found', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {}
        }
      });

      await adapter.delete('firefox-container-999', 'qt-123');

      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    test('should do nothing when Quick Tab not found in container', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      await adapter.delete('firefox-default', 'qt-999');

      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('deleteContainer()', () => {
    test('should delete all Quick Tabs for container', async () => {
      // v1.6.0.12 - Reads from local storage
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-1' }],
              lastUpdate: Date.now()
            },
            'firefox-container-1': {
              tabs: [{ id: 'qt-2' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      await adapter.deleteContainer('firefox-container-1');

      // v1.6.0.12 - Uses local storage
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.any(Object)
            // firefox-container-1 should be deleted
          }
        })
      });

      const setCall = browser.storage.local.set.mock.calls[0][0];
      expect(setCall.quick_tabs_state_v2.containers['firefox-container-1']).toBeUndefined();
    });

    test('should do nothing when container not found', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      await adapter.deleteContainer('firefox-container-999');

      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    test('should remove all Quick Tabs from storage', async () => {
      await adapter.clear();

      // v1.6.0.12 - Clears from both local and sync storage
      expect(browser.storage.local.remove).toHaveBeenCalledWith('quick_tabs_state_v2');
      expect(browser.storage.sync.remove).toHaveBeenCalledWith('quick_tabs_state_v2');
    });
  });

  describe('Error Handling', () => {
    test('should return empty state when storage.get fails', async () => {
      browser.storage.sync.get.mockRejectedValue(new Error('Storage error'));
      browser.storage.local.get.mockRejectedValue(new Error('Storage error'));

      const result = await adapter.loadAll();

      expect(result).toEqual({});
    });

    test('should throw error when storage.set fails', async () => {
      // v1.6.0.12 - Uses local storage, so mock that instead
      browser.storage.local.set.mockRejectedValue(new Error('Network error'));

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await expect(adapter.save('firefox-default', [quickTab])).rejects.toThrow('Network error');
    });
  });
});
