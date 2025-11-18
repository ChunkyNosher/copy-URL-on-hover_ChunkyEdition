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
    test('should save Quick Tabs in container-aware format', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const saveId = await adapter.save('firefox-container-1', [quickTab]);

      expect(browser.storage.session.set).toHaveBeenCalledWith({
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
      browser.storage.session.get.mockResolvedValue({
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

      expect(browser.storage.session.set).toHaveBeenCalledWith({
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

    test('should save empty array when no Quick Tabs', async () => {
      await adapter.save('firefox-default', []);

      expect(browser.storage.session.set).toHaveBeenCalledWith({
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

      const result = await adapter.load('firefox-default');

      expect(result).toEqual({
        tabs: [
          expect.objectContaining({ id: 'qt-1', url: 'https://example.com' })
        ],
        lastUpdate: expect.any(Number)
      });
    });

    test('should return null when container not found', async () => {
      browser.storage.session.get.mockResolvedValue({
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
      browser.storage.session.get.mockResolvedValue({});

      const result = await adapter.load('firefox-default');

      expect(result).toBeNull();
    });
  });

  describe('loadAll()', () => {
    test('should load all containers', async () => {
      browser.storage.session.get.mockResolvedValue({
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
      browser.storage.session.get.mockResolvedValue({});

      const result = await adapter.loadAll();

      expect(result).toEqual({});
    });
  });

  describe('delete()', () => {
    test('should delete specific Quick Tab from container', async () => {
      browser.storage.session.get.mockResolvedValue({
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
      expect(browser.storage.session.set).toHaveBeenCalledWith({
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
      const setCall = browser.storage.session.set.mock.calls[0][0];
      const tabs = setCall.quick_tabs_state_v2.containers['firefox-default'].tabs;
      expect(tabs.find(t => t.id === 'qt-1')).toBeUndefined();
    });

    test('should do nothing when container not found', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {}
        }
      });

      await adapter.delete('firefox-container-999', 'qt-123');

      expect(browser.storage.session.set).not.toHaveBeenCalled();
    });
  });

  describe('deleteContainer()', () => {
    test('should delete all Quick Tabs for container', async () => {
      browser.storage.session.get.mockResolvedValue({
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

      expect(browser.storage.session.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          containers: {
            'firefox-default': expect.any(Object)
          }
        })
      });

      const setCall = browser.storage.session.set.mock.calls[0][0];
      expect(setCall.quick_tabs_state_v2.containers['firefox-container-1']).toBeUndefined();
    });
  });

  describe('clear()', () => {
    test('should remove all Quick Tabs from storage', async () => {
      await adapter.clear();

      expect(browser.storage.session.remove).toHaveBeenCalledWith('quick_tabs_state_v2');
    });
  });

  describe('Error Handling', () => {
    test('should return empty state when storage.get fails', async () => {
      browser.storage.session.get.mockRejectedValue(new Error('Storage error'));

      const result = await adapter.loadAll();

      expect(result).toEqual({});
    });

    test('should throw error when storage.set fails', async () => {
      browser.storage.session.set.mockRejectedValue(new Error('Storage error'));

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      await expect(adapter.save('firefox-default', [quickTab])).rejects.toThrow('Storage error');
    });
  });
});
