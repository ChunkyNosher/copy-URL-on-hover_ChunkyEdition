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
      set: jest.fn()
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

      expect(browser.storage.sync.set).toHaveBeenCalledWith({
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
      // Setup existing state
      browser.storage.sync.get.mockResolvedValue({
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

      expect(browser.storage.sync.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.objectContaining({
              tabs: expect.arrayContaining([
                expect.objectContaining({ id: 'qt-old' })
              ])
            }),
            'firefox-container-1': expect.objectContaining({
              tabs: expect.arrayContaining([
                expect.objectContaining({ id: 'qt-new' })
              ])
            })
          }
        })
      });
    });

    test('should fallback to local storage when quota exceeded', async () => {
      browser.storage.sync.set.mockRejectedValue(
        new Error('QUOTA_BYTES: Storage quota exceeded')
      );

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const saveId = await adapter.save('firefox-default', [quickTab]);

      expect(browser.storage.local.set).toHaveBeenCalled();
      expect(saveId).toMatch(/^\d+-[a-z0-9]+$/);
    });

    test('should throw error when both sync and local storage fail', async () => {
      browser.storage.sync.set.mockRejectedValue(
        new Error('QUOTA_BYTES: Storage quota exceeded')
      );
      browser.storage.local.set.mockRejectedValue(
        new Error('Local storage failed')
      );

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await expect(adapter.save('firefox-default', [quickTab])).rejects.toThrow(
        'Failed to save'
      );
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

      expect(browser.storage.sync.set).toHaveBeenCalledWith({
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

      expect(browser.storage.sync.set).toHaveBeenCalledWith({
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
              tabs: [
                { id: 'qt-1', url: 'https://example.com' }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await adapter.load('firefox-default');

      expect(result).toEqual({
        tabs: [
          expect.objectContaining({ id: 'qt-1', url: 'https://example.com' })
        ],
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
      browser.storage.sync.get.mockResolvedValue({
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

      // Should save with only qt-2
      expect(browser.storage.sync.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.objectContaining({
              tabs: expect.arrayContaining([
                expect.objectContaining({ id: 'qt-2' })
              ])
            })
          }
        })
      });

      // Should not contain qt-1
      const setCall = browser.storage.sync.set.mock.calls[0][0];
      const tabs = setCall.quick_tabs_state_v2.containers['firefox-default'].tabs;
      expect(tabs.find(t => t.id === 'qt-1')).toBeUndefined();
    });

    test('should do nothing when container not found', async () => {
      browser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {}
        }
      });

      await adapter.delete('firefox-container-999', 'qt-123');

      expect(browser.storage.sync.set).not.toHaveBeenCalled();
    });

    test('should do nothing when Quick Tab not found in container', async () => {
      browser.storage.sync.get.mockResolvedValue({
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

      expect(browser.storage.sync.set).not.toHaveBeenCalled();
    });
  });

  describe('deleteContainer()', () => {
    test('should delete all Quick Tabs for container', async () => {
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

      await adapter.deleteContainer('firefox-container-1');

      expect(browser.storage.sync.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.any(Object)
            // firefox-container-1 should be deleted
          }
        })
      });

      const setCall = browser.storage.sync.set.mock.calls[0][0];
      expect(setCall.quick_tabs_state_v2.containers['firefox-container-1']).toBeUndefined();
    });

    test('should do nothing when container not found', async () => {
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

      await adapter.deleteContainer('firefox-container-999');

      expect(browser.storage.sync.set).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    test('should remove all Quick Tabs from storage', async () => {
      await adapter.clear();

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

    test('should throw error when storage.set fails with non-quota error', async () => {
      browser.storage.sync.set.mockRejectedValue(new Error('Network error'));

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
