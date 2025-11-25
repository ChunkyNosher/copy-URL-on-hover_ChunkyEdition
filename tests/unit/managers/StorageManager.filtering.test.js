/**
 * Unit Tests for StorageManager Storage Listener Filtering
 * 
 * Tests the storage change listener filtering that prevents infinite feedback loops
 * by ignoring broadcast history and sync message keys.
 * 
 * Part of memory leak fix - see: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
 */

import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';

// Mock browser API
global.browser = {
  storage: {
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn()
    },
    session: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn().mockResolvedValue({ success: false })
  }
};

describe('StorageManager - Storage Listener Filtering', () => {
  let storageManager;
  let mockEventBus;
  let capturedListener;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn()
    };
    
    // Capture the listener when it's registered
    browser.storage.onChanged.addListener.mockImplementation((listener) => {
      capturedListener = listener;
    });
    
    storageManager = new StorageManager(mockEventBus, 'firefox-default');
    storageManager.setupStorageListeners();
  });

  afterEach(() => {
    jest.clearAllMocks();
    capturedListener = null;
  });

  describe('Storage Change Filtering', () => {
    it('should filter out broadcast history keys (silently)', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const changes = {
        'quicktabs-broadcast-history-firefox-default': {
          newValue: { messages: [] }
        }
      };
      
      capturedListener(changes, 'local');
      
      // Should NOT log individual filtering messages (to prevent log spam)
      // The function returns silently when all keys are filtered
      expect(consoleSpy).not.toHaveBeenCalledWith(
        '[StorageManager] Ignoring broadcast history change:',
        expect.any(String)
      );
      
      // handleStorageChange should NOT be called
      expect(mockEventBus.emit).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should filter out sync message keys (silently)', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const changes = {
        'quick-tabs-sync-firefox-default-1234567890': {
          newValue: { type: 'CREATE', data: {} }
        }
      };
      
      capturedListener(changes, 'local');
      
      // Should NOT log individual filtering messages (to prevent log spam)
      expect(consoleSpy).not.toHaveBeenCalledWith(
        '[StorageManager] Ignoring sync message change:',
        expect.any(String)
      );
      
      // handleStorageChange should NOT be called
      expect(mockEventBus.emit).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should skip processing when all keys filtered (silently)', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const changes = {
        'quicktabs-broadcast-history-firefox-default': { newValue: {} },
        'quick-tabs-sync-firefox-default-1234567890': { newValue: {} }
      };
      
      capturedListener(changes, 'local');
      
      // Should NOT log that all changes were filtered (to prevent log spam)
      expect(consoleSpy).not.toHaveBeenCalledWith(
        '[StorageManager] All storage changes filtered out, skipping'
      );
      
      // handleStorageChange should NOT be called
      expect(mockEventBus.emit).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should process non-filtered keys normally', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const changes = {
        'quick_tabs_state_v2': {
          newValue: {
            containers: {
              'firefox-default': { tabs: [] }
            },
            saveId: 'test-save-id'
          }
        }
      };
      
      // Track pending save to prevent processing
      storageManager.trackPendingSave('test-save-id');
      
      capturedListener(changes, 'local');
      
      // Should log that storage changed (v1.6.2.1 - Updated format with context object)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[StorageManager] Storage changed:',
        expect.objectContaining({
          context: 'content-script',
          areaName: 'local',
          changedKeys: ['quick_tabs_state_v2']
        })
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle mixed filtered and non-filtered keys', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const changes = {
        'quicktabs-broadcast-history-firefox-default': { newValue: {} },
        'quick_tabs_state_v2': { newValue: { saveId: 'test-id' } }
      };
      
      // Track pending save
      storageManager.trackPendingSave('test-id');
      
      capturedListener(changes, 'local');
      
      // Should NOT log individual filtering (silent operation)
      expect(consoleSpy).not.toHaveBeenCalledWith(
        '[StorageManager] Ignoring broadcast history change:',
        expect.any(String)
      );
      
      // Should still process the remaining key (v1.6.2.1 - Updated format with context object)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[StorageManager] Storage changed:',
        expect.objectContaining({
          context: 'content-script',
          areaName: 'local',
          changedKeys: ['quick_tabs_state_v2']
        })
      );
      
      consoleSpy.mockRestore();
    });

    it('should filter keys from different containers (silently)', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const changes = {
        'quicktabs-broadcast-history-firefox-container-1': { newValue: {} },
        'quicktabs-broadcast-history-firefox-container-2': { newValue: {} },
        'quick-tabs-sync-firefox-container-3-9999': { newValue: {} }
      };
      
      capturedListener(changes, 'local');
      
      // All should be filtered silently (no log spam)
      expect(consoleSpy).not.toHaveBeenCalledWith(
        '[StorageManager] All storage changes filtered out, skipping'
      );
      
      // handleStorageChange should NOT be called
      expect(mockEventBus.emit).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Listener Registration', () => {
    it('should register storage listener on setup', () => {
      expect(browser.storage.onChanged.addListener).toHaveBeenCalled();
      expect(capturedListener).toBeDefined();
      expect(typeof capturedListener).toBe('function');
    });
  });
});
