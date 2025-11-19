/**
 * StorageManager Unit Tests
 * Phase 2.1: Tests for extracted storage management logic
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';
import { SessionStorageAdapter } from '../../../src/storage/SessionStorageAdapter.js';
import { SyncStorageAdapter } from '../../../src/storage/SyncStorageAdapter.js';

// Mock the storage adapters
jest.mock('../../../src/storage/SyncStorageAdapter.js');
jest.mock('../../../src/storage/SessionStorageAdapter.js');

describe('StorageManager', () => {
  let manager;
  let mockSyncAdapter;
  let mockSessionAdapter;
  let eventBus;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create event bus
    eventBus = new EventEmitter();

    // Create mock adapters
    mockSyncAdapter = new SyncStorageAdapter();
    mockSessionAdapter = new SessionStorageAdapter();

    // Create manager
    manager = new StorageManager(eventBus, 'firefox-default');

    // Replace adapters with mocks
    manager.syncAdapter = mockSyncAdapter;
    manager.sessionAdapter = mockSessionAdapter;
  });

  describe('Constructor', () => {
    test('should initialize with default container', () => {
      const mgr = new StorageManager(eventBus);
      expect(mgr.cookieStoreId).toBe('firefox-default');
      expect(mgr.eventBus).toBe(eventBus);
    });

    test('should initialize with custom container', () => {
      const mgr = new StorageManager(eventBus, 'firefox-container-1');
      expect(mgr.cookieStoreId).toBe('firefox-container-1');
    });

    test('should initialize pending save tracking', () => {
      expect(manager.pendingSaveIds).toBeInstanceOf(Set);
      expect(manager.pendingSaveIds.size).toBe(0);
    });
  });

  describe('save()', () => {
    test('should save Quick Tabs using sync adapter', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      mockSyncAdapter.save.mockResolvedValue('save-id-123');

      const saveId = await manager.save([quickTab]);

      expect(mockSyncAdapter.save).toHaveBeenCalledWith(
        'firefox-default',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'qt-123',
            url: 'https://example.com'
          })
        ])
      );
      expect(saveId).toBe('save-id-123');
    });

    test('should track pending save ID', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      mockSyncAdapter.save.mockResolvedValue('save-id-456');

      await manager.save([quickTab]);

      expect(manager.pendingSaveIds.has('save-id-456')).toBe(true);
    });

    test('should emit storage:saved event', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      mockSyncAdapter.save.mockResolvedValue('save-id-789');

      const listener = jest.fn();
      eventBus.on('storage:saved', listener);

      await manager.save([quickTab]);

      expect(listener).toHaveBeenCalledWith({
        cookieStoreId: 'firefox-default',
        saveId: 'save-id-789'
      });
    });

    test('should return null when no tabs to save', async () => {
      const saveId = await manager.save([]);
      expect(saveId).toBeNull();
      expect(mockSyncAdapter.save).not.toHaveBeenCalled();
    });

    test('should handle save errors', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const error = new Error('Storage quota exceeded');
      mockSyncAdapter.save.mockRejectedValue(error);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      await expect(manager.save([quickTab])).rejects.toThrow('Storage quota exceeded');
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'save',
        error
      });
    });
  });

  describe('loadAll()', () => {
    test('should load Quick Tabs from session storage first', async () => {
      const tabData = {
        tabs: [
          {
            id: 'qt-123',
            url: 'https://example.com',
            position: { left: 100, top: 100 },
            size: { width: 400, height: 300 },
            cookieStoreId: 'firefox-default'
          }
        ],
        lastUpdate: Date.now()
      };

      mockSessionAdapter.load.mockResolvedValue(tabData);

      const quickTabs = await manager.loadAll();

      expect(mockSessionAdapter.load).toHaveBeenCalledWith('firefox-default');
      expect(quickTabs).toHaveLength(1);
      expect(quickTabs[0]).toBeInstanceOf(QuickTab);
      expect(quickTabs[0].id).toBe('qt-123');
    });

    test('should fall back to sync storage if session is empty', async () => {
      const tabData = {
        tabs: [
          {
            id: 'qt-456',
            url: 'https://test.com',
            position: { left: 200, top: 200 },
            size: { width: 500, height: 400 },
            cookieStoreId: 'firefox-default'
          }
        ],
        lastUpdate: Date.now()
      };

      mockSessionAdapter.load.mockResolvedValue(null);
      mockSyncAdapter.load.mockResolvedValue(tabData);

      const quickTabs = await manager.loadAll();

      expect(mockSessionAdapter.load).toHaveBeenCalled();
      expect(mockSyncAdapter.load).toHaveBeenCalledWith('firefox-default');
      expect(quickTabs).toHaveLength(1);
      expect(quickTabs[0].id).toBe('qt-456');
    });

    test('should return empty array when no data found', async () => {
      mockSessionAdapter.load.mockResolvedValue(null);
      mockSyncAdapter.load.mockResolvedValue(null);

      const quickTabs = await manager.loadAll();

      expect(quickTabs).toEqual([]);
    });

    test('should handle load errors gracefully', async () => {
      const error = new Error('Storage access denied');
      mockSessionAdapter.load.mockRejectedValue(error);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      const quickTabs = await manager.loadAll();

      expect(quickTabs).toEqual([]);
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'load',
        error
      });
    });
  });

  describe('shouldIgnoreStorageChange()', () => {
    test('should return true for pending save IDs', () => {
      manager.pendingSaveIds.add('save-id-123');
      expect(manager.shouldIgnoreStorageChange('save-id-123')).toBe(true);
    });

    test('should return false for non-pending save IDs', () => {
      manager.pendingSaveIds.add('save-id-123');
      expect(manager.shouldIgnoreStorageChange('save-id-456')).toBe(false);
    });

    test('should return false for null save ID', () => {
      expect(manager.shouldIgnoreStorageChange(null)).toBe(false);
    });
  });

  describe('trackPendingSave() and releasePendingSave()', () => {
    test('should add save ID to pending set', () => {
      manager.trackPendingSave('save-id-111');
      expect(manager.pendingSaveIds.has('save-id-111')).toBe(true);
    });

    test('should auto-release save ID after grace period', done => {
      manager.SAVE_ID_GRACE_MS = 50; // Shorten for test
      manager.trackPendingSave('save-id-222');

      expect(manager.pendingSaveIds.has('save-id-222')).toBe(true);

      setTimeout(() => {
        expect(manager.pendingSaveIds.has('save-id-222')).toBe(false);
        done();
      }, 60);
    });

    test('should manually release save ID', () => {
      manager.trackPendingSave('save-id-333');
      expect(manager.pendingSaveIds.has('save-id-333')).toBe(true);

      manager.releasePendingSave('save-id-333');
      expect(manager.pendingSaveIds.has('save-id-333')).toBe(false);
    });

    test('should clear timer when manually released', () => {
      manager.trackPendingSave('save-id-444');
      const timer = manager.saveIdTimers.get('save-id-444');
      expect(timer).toBeDefined();

      manager.releasePendingSave('save-id-444');
      expect(manager.saveIdTimers.has('save-id-444')).toBe(false);
    });
  });

  describe('delete()', () => {
    test('should delete Quick Tab using sync adapter', async () => {
      mockSyncAdapter.delete.mockResolvedValue();

      await manager.delete('qt-123');

      expect(mockSyncAdapter.delete).toHaveBeenCalledWith('firefox-default', 'qt-123');
    });

    test('should emit storage:deleted event', async () => {
      mockSyncAdapter.delete.mockResolvedValue();

      const listener = jest.fn();
      eventBus.on('storage:deleted', listener);

      await manager.delete('qt-123');

      expect(listener).toHaveBeenCalledWith({
        cookieStoreId: 'firefox-default',
        quickTabId: 'qt-123'
      });
    });

    test('should handle delete errors', async () => {
      const error = new Error('Delete failed');
      mockSyncAdapter.delete.mockRejectedValue(error);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      await expect(manager.delete('qt-123')).rejects.toThrow('Delete failed');
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'delete',
        error
      });
    });
  });

  describe('clear()', () => {
    test('should clear container using sync adapter', async () => {
      mockSyncAdapter.deleteContainer.mockResolvedValue();

      await manager.clear();

      expect(mockSyncAdapter.deleteContainer).toHaveBeenCalledWith('firefox-default');
    });

    test('should emit storage:cleared event', async () => {
      mockSyncAdapter.deleteContainer.mockResolvedValue();

      const listener = jest.fn();
      eventBus.on('storage:cleared', listener);

      await manager.clear();

      expect(listener).toHaveBeenCalledWith({
        cookieStoreId: 'firefox-default'
      });
    });

    test('should handle clear errors', async () => {
      const error = new Error('Clear failed');
      mockSyncAdapter.deleteContainer.mockRejectedValue(error);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      await expect(manager.clear()).rejects.toThrow('Clear failed');
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'clear',
        error
      });
    });
  });

  describe('scheduleStorageSync()', () => {
    test('should debounce multiple sync requests', done => {
      manager.STORAGE_SYNC_DELAY_MS = 50; // Shorten for test

      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const state1 = { containers: { 'firefox-default': { tabs: [] } } };
      const state2 = { containers: { 'firefox-default': { tabs: [{ id: 'qt-1' }] } } };
      const state3 = { containers: { 'firefox-default': { tabs: [{ id: 'qt-2' }] } } };

      manager.scheduleStorageSync(state1);
      manager.scheduleStorageSync(state2);
      manager.scheduleStorageSync(state3);

      // Should only emit once with latest state
      setTimeout(() => {
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({
          containerFilter: 'firefox-default',
          state: state3
        });
        done();
      }, 60);
    });
  });

  describe('setupStorageListeners()', () => {
    let mockBrowser;
    let storageListeners;

    beforeEach(() => {
      storageListeners = [];
      mockBrowser = {
        storage: {
          onChanged: {
            addListener: jest.fn(listener => {
              storageListeners.push(listener);
            })
          }
        }
      };
      global.browser = mockBrowser;
    });

    afterEach(() => {
      delete global.browser;
    });

    test('should setup storage listeners when browser API available', () => {
      manager.setupStorageListeners();
      expect(mockBrowser.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
    });

    test('should handle missing browser API gracefully', () => {
      delete global.browser;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      manager.setupStorageListeners();

      expect(consoleSpy).toHaveBeenCalledWith('[StorageManager] Storage API not available');
      consoleSpy.mockRestore();
    });

    test('should handle missing browser.storage gracefully', () => {
      global.browser = {};
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      manager.setupStorageListeners();

      expect(consoleSpy).toHaveBeenCalledWith('[StorageManager] Storage API not available');
      consoleSpy.mockRestore();
    });
  });

  describe('handleStorageChange()', () => {
    test('should ignore null/undefined values', () => {
      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      manager.handleStorageChange(null);
      manager.handleStorageChange(undefined);

      expect(listener).not.toHaveBeenCalled();
    });

    test('should ignore changes from pending saves', () => {
      manager.pendingSaveIds.add('save-id-123');
      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const newValue = {
        saveId: 'save-id-123',
        containers: {
          'firefox-default': { tabs: [] }
        }
      };

      manager.handleStorageChange(newValue);

      expect(listener).not.toHaveBeenCalled();
    });

    test('should ignore changes while saves are pending (no saveId)', () => {
      manager.pendingSaveIds.add('save-id-456');
      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const newValue = {
        containers: {
          'firefox-default': { tabs: [] }
        }
      };

      manager.handleStorageChange(newValue);

      expect(listener).not.toHaveBeenCalled();
    });

    test('should process container-specific changes', done => {
      manager.STORAGE_SYNC_DELAY_MS = 50;
      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const newValue = {
        containers: {
          'firefox-default': { tabs: [{ id: 'qt-1' }] },
          'firefox-container-1': { tabs: [{ id: 'qt-2' }] }
        }
      };

      manager.handleStorageChange(newValue);

      setTimeout(() => {
        expect(listener).toHaveBeenCalledWith({
          containerFilter: 'firefox-default',
          state: {
            containers: {
              'firefox-default': { tabs: [{ id: 'qt-1' }] }
            }
          }
        });
        done();
      }, 60);
    });

    test('should handle legacy format', done => {
      manager.STORAGE_SYNC_DELAY_MS = 50;
      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const legacyValue = {
        tabs: [{ id: 'qt-1' }]
      };

      manager.handleStorageChange(legacyValue);

      setTimeout(() => {
        expect(listener).toHaveBeenCalledWith({
          containerFilter: 'firefox-default',
          state: legacyValue
        });
        done();
      }, 60);
    });

    test('should handle missing container gracefully', () => {
      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const newValue = {
        containers: {
          'firefox-container-1': { tabs: [] }
        }
      };

      manager.handleStorageChange(newValue);

      // Should not schedule sync for missing container
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Storage Event Integration', () => {
    let mockBrowser;
    let storageListener;

    beforeEach(() => {
      storageListener = null;
      mockBrowser = {
        storage: {
          onChanged: {
            addListener: jest.fn(listener => {
              storageListener = listener;
            })
          }
        }
      };
      global.browser = mockBrowser;
    });

    afterEach(() => {
      delete global.browser;
    });

    test('should handle sync storage changes', done => {
      manager.setupStorageListeners();
      manager.STORAGE_SYNC_DELAY_MS = 50;

      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const changes = {
        quick_tabs_state_v2: {
          newValue: {
            containers: {
              'firefox-default': { tabs: [{ id: 'qt-1' }] }
            }
          }
        }
      };

      storageListener(changes, 'sync');

      setTimeout(() => {
        expect(listener).toHaveBeenCalled();
        done();
      }, 60);
    });

    test('should handle session storage changes', done => {
      manager.setupStorageListeners();
      manager.STORAGE_SYNC_DELAY_MS = 50;

      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const changes = {
        quick_tabs_session: {
          newValue: {
            containers: {
              'firefox-default': { tabs: [{ id: 'qt-1' }] }
            }
          }
        }
      };

      storageListener(changes, 'session');

      setTimeout(() => {
        expect(listener).toHaveBeenCalled();
        done();
      }, 60);
    });

    test('should ignore irrelevant storage areas', () => {
      manager.setupStorageListeners();

      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      const changes = {
        someOtherKey: {
          newValue: { data: 'test' }
        }
      };

      storageListener(changes, 'local');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Race Condition Prevention', () => {
    test('should prevent race condition during rapid saves', async () => {
      const quickTab1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const quickTab2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });

      mockSyncAdapter.save.mockResolvedValueOnce('save-id-1');
      mockSyncAdapter.save.mockResolvedValueOnce('save-id-2');

      // Start two saves rapidly
      const save1 = manager.save([quickTab1]);
      const save2 = manager.save([quickTab2]);

      await Promise.all([save1, save2]);

      // Both save IDs should be tracked
      expect(manager.pendingSaveIds.has('save-id-1')).toBe(true);
      expect(manager.pendingSaveIds.has('save-id-2')).toBe(true);
    });

    test('should ignore storage change during pending save', () => {
      manager.pendingSaveIds.add('save-id-123');

      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      // Simulate storage change with pending save ID
      manager.handleStorageChange({
        saveId: 'save-id-123',
        containers: {
          'firefox-default': { tabs: [] }
        }
      });

      expect(listener).not.toHaveBeenCalled();
    });

    test('should process storage change after save released', done => {
      manager.SAVE_ID_GRACE_MS = 50;
      manager.STORAGE_SYNC_DELAY_MS = 50;

      const listener = jest.fn();
      eventBus.on('storage:changed', listener);

      // Track save ID
      manager.trackPendingSave('save-id-999');

      // Try to process change (should be ignored)
      manager.handleStorageChange({
        saveId: 'save-id-999',
        containers: {
          'firefox-default': { tabs: [] }
        }
      });

      // Wait for save ID to be released
      setTimeout(() => {
        expect(manager.pendingSaveIds.has('save-id-999')).toBe(false);

        // Now change should be processed
        manager.handleStorageChange({
          containers: {
            'firefox-default': { tabs: [{ id: 'qt-1' }] }
          }
        });

        setTimeout(() => {
          expect(listener).toHaveBeenCalled();
          done();
        }, 60);
      }, 60);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty Quick Tabs array', async () => {
      const saveId = await manager.save([]);
      expect(saveId).toBeNull();
    });

    test('should handle null Quick Tabs parameter', async () => {
      const saveId = await manager.save(null);
      expect(saveId).toBeNull();
    });

    test('should handle undefined Quick Tabs parameter', async () => {
      const saveId = await manager.save(undefined);
      expect(saveId).toBeNull();
    });

    test('should handle multiple releases of same save ID', () => {
      manager.trackPendingSave('save-id-multi');
      expect(manager.pendingSaveIds.has('save-id-multi')).toBe(true);

      manager.releasePendingSave('save-id-multi');
      expect(manager.pendingSaveIds.has('save-id-multi')).toBe(false);

      // Second release should not throw
      expect(() => {
        manager.releasePendingSave('save-id-multi');
      }).not.toThrow();
    });

    test('should handle release of non-existent save ID', () => {
      expect(() => {
        manager.releasePendingSave('non-existent-id');
      }).not.toThrow();
    });

    test('should handle track with null save ID', () => {
      expect(() => {
        manager.trackPendingSave(null);
      }).not.toThrow();
      expect(manager.pendingSaveIds.size).toBe(0);
    });

    test('should handle release with null save ID', () => {
      expect(() => {
        manager.releasePendingSave(null);
      }).not.toThrow();
    });

    test('should replace existing timer when tracking same save ID twice', () => {
      manager.trackPendingSave('duplicate-id');
      const firstTimer = manager.saveIdTimers.get('duplicate-id');

      manager.trackPendingSave('duplicate-id');
      const secondTimer = manager.saveIdTimers.get('duplicate-id');

      expect(firstTimer).not.toBe(secondTimer);
      expect(manager.pendingSaveIds.has('duplicate-id')).toBe(true);
    });
  });

  describe('Error Handling Paths', () => {
    test('should handle network errors during sync', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-network',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const networkError = new Error('Network request failed');
      networkError.code = 'NETWORK_ERROR';
      mockSyncAdapter.save.mockRejectedValue(networkError);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      await expect(manager.save([quickTab])).rejects.toThrow('Network request failed');
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'save',
        error: networkError
      });
    });

    test('should handle storage corruption during load', async () => {
      const corruptionError = new Error('Data corruption detected');
      mockSessionAdapter.load.mockRejectedValue(corruptionError);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      const result = await manager.loadAll();

      expect(result).toEqual([]);
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'load',
        error: corruptionError
      });
    });

    test('should handle delete when Quick Tab does not exist', async () => {
      const notFoundError = new Error('Quick Tab not found');
      mockSyncAdapter.delete.mockRejectedValue(notFoundError);

      const errorListener = jest.fn();
      eventBus.on('storage:error', errorListener);

      await expect(manager.delete('non-existent-id')).rejects.toThrow('Quick Tab not found');
      expect(errorListener).toHaveBeenCalledWith({
        operation: 'delete',
        error: notFoundError
      });
    });

    test('should handle concurrent delete operations', async () => {
      mockSyncAdapter.delete.mockResolvedValue();

      const listener = jest.fn();
      eventBus.on('storage:deleted', listener);

      // Trigger multiple deletes
      await Promise.all([manager.delete('qt-1'), manager.delete('qt-2'), manager.delete('qt-3')]);

      expect(listener).toHaveBeenCalledTimes(3);
    });
  });
});
