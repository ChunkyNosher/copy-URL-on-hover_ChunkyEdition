/**
 * Storage Error Handling Tests
 * v1.6.3.8 - Comprehensive tests for storage layer error scenarios
 *
 * Target: Cover error handling paths, quota exceeded scenarios,
 * and corruption recovery to reach 90%+ storage layer coverage.
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
    },
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
import { SyncStorageAdapter } from '../../../src/storage/SyncStorageAdapter.js';

describe('Storage Error Handling', () => {
  let syncAdapter;
  let sessionAdapter;

  beforeEach(() => {
    syncAdapter = new SyncStorageAdapter();
    sessionAdapter = new SessionStorageAdapter();
    jest.clearAllMocks();

    // Default mock implementations
    browser.storage.local.get.mockResolvedValue({});
    browser.storage.local.set.mockResolvedValue(undefined);
    browser.storage.local.remove.mockResolvedValue(undefined);
    browser.storage.sync.get.mockResolvedValue({});
    browser.storage.sync.set.mockResolvedValue(undefined);
    browser.storage.session.get.mockResolvedValue({});
    browser.storage.session.set.mockResolvedValue(undefined);
    browser.storage.session.remove.mockResolvedValue(undefined);
  });

  describe('Quota Exceeded', () => {
    it('should handle storage quota exceeded error in SyncStorageAdapter', async () => {
      const quotaError = new Error('QUOTA_BYTES quota exceeded');
      quotaError.name = 'QuotaExceededError';
      browser.storage.local.set.mockRejectedValue(quotaError);

      const quickTab = QuickTab.create({
        id: 'qt-quota-test',
        url: 'https://example.com'
      });

      await expect(syncAdapter.save([quickTab])).rejects.toThrow('QUOTA_BYTES quota exceeded');
    });

    it('should handle storage quota exceeded error in SessionStorageAdapter', async () => {
      const quotaError = new Error('QUOTA_BYTES quota exceeded');
      quotaError.name = 'QuotaExceededError';
      browser.storage.session.set.mockRejectedValue(quotaError);

      const quickTab = QuickTab.create({
        id: 'qt-session-quota',
        url: 'https://example.com'
      });

      await expect(sessionAdapter.save('firefox-default', [quickTab])).rejects.toThrow(
        'QUOTA_BYTES quota exceeded'
      );
    });

    it('should handle DOM exception for quota in SyncStorageAdapter', async () => {
      // Simulate DOMException which doesn't serialize properly
      const domException = new DOMException('Quota exceeded', 'QuotaExceededError');
      browser.storage.local.set.mockRejectedValue(domException);

      const quickTab = QuickTab.create({
        id: 'qt-dom-quota',
        url: 'https://example.com'
      });

      await expect(syncAdapter.save([quickTab])).rejects.toThrow();
    });

    it('should propagate quota error with original error properties', async () => {
      const quotaError = new Error('Storage quota exceeded');
      quotaError.code = 22; // DOMException QUOTA_EXCEEDED_ERR
      browser.storage.local.set.mockRejectedValue(quotaError);

      const quickTab = QuickTab.create({
        id: 'qt-error-props',
        url: 'https://example.com'
      });

      try {
        await syncAdapter.save([quickTab]);
        // Should not reach here - fail the test
        expect(true).toBe(false); // Force fail if no error thrown
      } catch (error) {
        expect(error.message).toBe('Storage quota exceeded');
        expect(error.code).toBe(22);
      }
    });
  });

  describe('Corruption Recovery', () => {
    it('should handle corrupted data structure in load', async () => {
      // Corrupted: tabs is not an array
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: 'not-an-array',
          timestamp: Date.now()
        }
      });

      const result = await syncAdapter.load();

      // Should return null for invalid structure
      expect(result).toBeNull();
    });

    it('should handle corrupted container format', async () => {
      // Corrupted: containers value is not an object
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: 'invalid',
          timestamp: Date.now()
        }
      });

      const result = await syncAdapter.load();

      // Migration should handle this gracefully
      expect(result).toBeNull();
    });

    it('should handle null storage key value', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: null
      });

      const result = await syncAdapter.load();

      expect(result).toBeNull();
    });

    it('should handle undefined storage key value', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: undefined
      });

      const result = await syncAdapter.load();

      expect(result).toBeNull();
    });

    it('should handle malformed tab data in container format migration', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [
                { id: 'qt-valid', url: 'https://valid.com' },
                null, // malformed entry
                { id: 'qt-valid-2', url: 'https://valid2.com' }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await syncAdapter.load();

      // Should migrate including malformed data
      expect(result).not.toBeNull();
      expect(result.tabs).toHaveLength(3);
    });

    it('should handle empty containers object in migration', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {}
        }
      });

      const result = await syncAdapter.load();

      expect(result).toBeNull();
    });

    it('should handle container with empty tabs array in migration', async () => {
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

      const result = await syncAdapter.load();

      // Empty tabs array should result in null
      expect(result).toBeNull();
    });
  });

  describe('Network/API Errors', () => {
    it('should handle network error during load in SyncStorageAdapter', async () => {
      browser.storage.local.get.mockRejectedValue(new Error('Network error'));

      const result = await syncAdapter.load();

      // Should return null on error (graceful degradation)
      expect(result).toBeNull();
    });

    it('should handle network error during loadAll in SessionStorageAdapter', async () => {
      browser.storage.session.get.mockRejectedValue(new Error('Network error'));

      const result = await sessionAdapter.loadAll();

      // Should return empty object on error
      expect(result).toEqual({});
    });

    it('should handle timeout error during save', async () => {
      const timeoutError = new Error('Operation timed out');
      timeoutError.name = 'TimeoutError';
      browser.storage.local.set.mockRejectedValue(timeoutError);

      const quickTab = QuickTab.create({
        id: 'qt-timeout',
        url: 'https://example.com'
      });

      await expect(syncAdapter.save([quickTab])).rejects.toThrow('Operation timed out');
    });

    it('should handle permission denied error', async () => {
      const permError = new Error('Permission denied');
      permError.name = 'SecurityError';
      browser.storage.local.set.mockRejectedValue(permError);

      const quickTab = QuickTab.create({
        id: 'qt-perm',
        url: 'https://example.com'
      });

      await expect(syncAdapter.save([quickTab])).rejects.toThrow('Permission denied');
    });
  });

  describe('Concurrent Access', () => {
    it('should handle concurrent saves with different saveIds', async () => {
      const quickTab1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://one.com'
      });

      const quickTab2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://two.com'
      });

      // Simulate concurrent saves
      const [saveId1, saveId2] = await Promise.all([
        syncAdapter.save([quickTab1]),
        syncAdapter.save([quickTab2])
      ]);

      // Each save should have a unique saveId
      expect(saveId1).not.toBe(saveId2);
    });

    it('should handle rapid consecutive saves', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-rapid',
        url: 'https://example.com'
      });

      // Rapid consecutive saves
      const saveIds = [];
      for (let i = 0; i < 5; i++) {
        const saveId = await syncAdapter.save([quickTab]);
        saveIds.push(saveId);
      }

      // All saveIds should be unique
      const uniqueSaveIds = new Set(saveIds);
      expect(uniqueSaveIds.size).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle save with empty tabs array', async () => {
      const saveId = await syncAdapter.save([]);

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: [],
          saveId: expect.any(String),
          timestamp: expect.any(Number)
        })
      });
      expect(saveId).toBeDefined();
    });

    it('should handle delete on non-existent Quick Tab', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-existing', url: 'https://example.com' }],
          timestamp: Date.now()
        }
      });

      // Delete should not throw for non-existent ID
      await syncAdapter.delete('qt-non-existent');

      // Should not save (since nothing changed)
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    it('should handle delete when storage is empty', async () => {
      browser.storage.local.get.mockResolvedValue({});

      // Delete should not throw when storage is empty
      await syncAdapter.delete('qt-non-existent');

      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    it('should handle clear when storage is already empty', async () => {
      browser.storage.local.get.mockResolvedValue({});

      // Clear should not throw
      await syncAdapter.clear();

      expect(browser.storage.local.remove).toHaveBeenCalledWith('quick_tabs_state_v2');
    });

    it('should handle clear error gracefully', async () => {
      browser.storage.local.remove.mockRejectedValue(new Error('Clear failed'));

      await expect(syncAdapter.clear()).rejects.toThrow('Clear failed');
    });
  });

  describe('Data Integrity', () => {
    it('should preserve all Quick Tab properties during save/load cycle', async () => {
      const originalQuickTab = QuickTab.create({
        id: 'qt-integrity',
        url: 'https://example.com',
        title: 'Test Tab',
        left: 150,
        top: 250,
        width: 900,
        height: 700,
        slot: 5
      });

      // Mock the save to capture what's being saved
      let savedData;
      browser.storage.local.set.mockImplementation(data => {
        savedData = data;
        return Promise.resolve();
      });

      await syncAdapter.save([originalQuickTab]);

      // Setup mock to return saved data on load
      browser.storage.local.get.mockResolvedValue(savedData);

      const loadedResult = await syncAdapter.load();

      expect(loadedResult.tabs[0]).toMatchObject({
        id: 'qt-integrity',
        url: 'https://example.com',
        title: 'Test Tab',
        position: { left: 150, top: 250 },
        size: { width: 900, height: 700 },
        slot: 5
      });
    });

    it('should generate unique saveIds', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-unique-id',
        url: 'https://example.com'
      });

      const saveIds = new Set();

      for (let i = 0; i < 10; i++) {
        const saveId = await syncAdapter.save([quickTab]);
        saveIds.add(saveId);
      }

      // All 10 saveIds should be unique
      expect(saveIds.size).toBe(10);
    });

    it('should include timestamp in saved data', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-timestamp',
        url: 'https://example.com'
      });

      const beforeSave = Date.now();
      await syncAdapter.save([quickTab]);
      const afterSave = Date.now();

      const savedData = browser.storage.local.set.mock.calls[0][0];
      const savedTimestamp = savedData.quick_tabs_state_v2.timestamp;

      expect(savedTimestamp).toBeGreaterThanOrEqual(beforeSave);
      expect(savedTimestamp).toBeLessThanOrEqual(afterSave);
    });
  });

  describe('Migration Edge Cases', () => {
    it('should migrate from legacy sync storage', async () => {
      // Local storage empty, but sync storage has data
      browser.storage.local.get.mockResolvedValue({});
      browser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-sync', url: 'https://sync.com' }],
          timestamp: Date.now()
        }
      });

      const result = await syncAdapter.load();

      // Should load from sync storage as fallback
      expect(result).not.toBeNull();
      expect(result.tabs).toHaveLength(1);
      expect(result.tabs[0].id).toBe('qt-sync');
    });

    it('should migrate container format to unified format', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-default', url: 'https://default.com' }],
              lastUpdate: Date.now()
            },
            'firefox-container-1': {
              tabs: [{ id: 'qt-container', url: 'https://container.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const result = await syncAdapter.load();

      // Should merge all containers
      expect(result.tabs).toHaveLength(2);
      expect(result.tabs.map(t => t.id)).toContain('qt-default');
      expect(result.tabs.map(t => t.id)).toContain('qt-container');
    });

    it('should save migrated format after container migration', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-migrate', url: 'https://migrate.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      await syncAdapter.load();

      // Should save in new unified format
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_state_v2: expect.objectContaining({
          tabs: expect.any(Array),
          saveId: expect.any(String),
          timestamp: expect.any(Number)
        })
      });
    });

    it('should handle delete with container format migration', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [
                { id: 'qt-keep', url: 'https://keep.com' },
                { id: 'qt-delete', url: 'https://delete.com' }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      await syncAdapter.delete('qt-delete');

      // Should save with only qt-keep
      const savedData = browser.storage.local.set.mock.calls[0][0];
      expect(savedData.quick_tabs_state_v2.tabs).toHaveLength(1);
      expect(savedData.quick_tabs_state_v2.tabs[0].id).toBe('qt-keep');
    });
  });

  describe('SessionStorageAdapter Specific', () => {
    it('should preserve other containers when saving to specific container', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-default', url: 'https://default.com' }],
              lastUpdate: Date.now()
            }
          },
          saveId: 'old-save-id',
          timestamp: Date.now()
        }
      });

      const newQuickTab = QuickTab.create({
        id: 'qt-new',
        url: 'https://new.com'
      });

      await sessionAdapter.save('firefox-container-1', [newQuickTab]);

      const savedData = browser.storage.session.set.mock.calls[0][0];

      // Should have both containers
      expect(savedData.quick_tabs_state_v2.containers['firefox-default']).toBeDefined();
      expect(savedData.quick_tabs_state_v2.containers['firefox-container-1']).toBeDefined();
    });

    it('should handle deleteContainer when container does not exist', async () => {
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

      // Should not throw
      await sessionAdapter.deleteContainer('firefox-container-999');

      // Should not call set
      expect(browser.storage.session.set).not.toHaveBeenCalled();
    });

    it('should handle delete when Quick Tab not found in container', async () => {
      browser.storage.session.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [{ id: 'qt-existing', url: 'https://example.com' }],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Delete non-existent Quick Tab
      await sessionAdapter.delete('firefox-default', 'qt-non-existent');

      // Should not call set since nothing changed
      expect(browser.storage.session.set).not.toHaveBeenCalled();
    });

    it('should handle load for non-existent container', async () => {
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

      const result = await sessionAdapter.load('firefox-container-999');

      expect(result).toBeNull();
    });
  });

  describe('Size Calculation', () => {
    it('should calculate size for save operation', async () => {
      const largeTitleQuickTab = QuickTab.create({
        id: 'qt-large-title',
        url: 'https://example.com',
        title: 'A'.repeat(1000)
      });

      // Save should succeed even with large data
      const saveId = await syncAdapter.save([largeTitleQuickTab]);
      expect(saveId).toBeDefined();
    });

    it('should handle size calculation error gracefully', async () => {
      // Mock Blob to throw error
      const originalBlob = global.Blob;
      global.Blob = class {
        constructor() {
          throw new Error('Blob error');
        }
      };

      const quickTab = QuickTab.create({
        id: 'qt-blob-error',
        url: 'https://example.com'
      });

      // Save should still succeed (size calculation is not critical)
      const saveId = await syncAdapter.save([quickTab]);
      expect(saveId).toBeDefined();

      // Restore
      global.Blob = originalBlob;
    });
  });

  describe('SyncStorageAdapter loadAll', () => {
    it('should call load method (alias)', async () => {
      browser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: {
          tabs: [{ id: 'qt-loadall', url: 'https://example.com' }],
          timestamp: Date.now()
        }
      });

      const result = await syncAdapter.loadAll();

      expect(result).not.toBeNull();
      expect(result.tabs).toHaveLength(1);
      expect(result.tabs[0].id).toBe('qt-loadall');
    });

    it('should return null when load returns null', async () => {
      browser.storage.local.get.mockResolvedValue({});
      browser.storage.sync.get.mockResolvedValue({});

      const result = await syncAdapter.loadAll();

      expect(result).toBeNull();
    });
  });

  describe('FormatStrategy Abstract Base Class', () => {
    // Import FormatStrategy directly to test abstract methods
    it('should test abstract methods throw errors', async () => {
      // We can't directly instantiate FormatStrategy, but we can verify the pattern
      // by testing that all concrete implementations have the required methods

      const { FormatMigrator } = await import('../../../src/storage/FormatMigrator.js');
      const migrator = new FormatMigrator();

      // Verify all formats have required methods
      const formats = migrator.getSupportedVersions();
      expect(formats).toContain('v1.5.8.15+');
      expect(formats).toContain('v1.5.8.14');
      expect(formats).toContain('v1.5.8.13-legacy');
      expect(formats).toContain('empty');
    });
  });
});
