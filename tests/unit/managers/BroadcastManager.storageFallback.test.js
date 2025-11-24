/**
 * BroadcastManager Storage Fallback Tests
 * 
 * Tests storage-based fallback when BroadcastChannel unavailable
 * Related: Gap 1 - Storage-Based Fallback
 */

// Mock uuid before importing
let mockUuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${mockUuidCounter++}`
}));

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import EventEmitter from 'eventemitter3';

// Mock browser.storage
const mockStorage = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      onChanged: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      }
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  }
};

describe('BroadcastManager - Storage Fallback (Gap 1)', () => {
  let manager;
  let eventBus;

  beforeAll(() => {
    globalThis.browser = mockStorage;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.storage.local.get.mockResolvedValue({});
    mockStorage.storage.local.set.mockResolvedValue();
    mockStorage.storage.local.remove.mockResolvedValue();
    
    eventBus = new EventEmitter();
    manager = new BroadcastManager(eventBus, 'firefox-container-1');
  });

  afterEach(() => {
    if (manager) {
      manager.close();
    }
  });

  describe('Fallback Activation', () => {
    test('activates storage fallback when BroadcastChannel unavailable', () => {
      // Simulate BC not available
      delete global.BroadcastChannel;
      
      const manager2 = new BroadcastManager(eventBus, 'firefox-container-1');
      manager2.setupBroadcastChannel();
      
      expect(manager2.useStorageFallback).toBe(true);
      expect(manager2.useBroadcastChannel).toBe(false);
      expect(mockStorage.storage.local.onChanged.addListener).toHaveBeenCalled();
      
      manager2.close();
    });

    test('activates storage fallback on BC setup failure', () => {
      // Simulate BC setup failure
      global.BroadcastChannel = jest.fn(() => {
        throw new Error('BC creation failed');
      });
      
      manager.setupBroadcastChannel();
      
      expect(manager.useStorageFallback).toBe(true);
      expect(manager.useBroadcastChannel).toBe(false);
      expect(mockStorage.storage.local.onChanged.addListener).toHaveBeenCalled();
    });

    test('registers storage.onChanged listener', () => {
      delete global.BroadcastChannel;
      
      const manager2 = new BroadcastManager(eventBus, 'firefox-container-1');
      manager2.setupBroadcastChannel();
      
      expect(mockStorage.storage.local.onChanged.addListener).toHaveBeenCalledTimes(1);
      expect(typeof mockStorage.storage.local.onChanged.addListener.mock.calls[0][0]).toBe('function');
      
      manager2.close();
    });
  });

  describe('Storage-Based Broadcasting', () => {
    beforeEach(() => {
      // Activate fallback mode
      manager.useStorageFallback = true;
      manager.useBroadcastChannel = false;
    });

    test('broadcasts message via storage when in fallback mode', async () => {
      await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(mockStorage.storage.local.set).toHaveBeenCalled();
      const setCall = mockStorage.storage.local.set.mock.calls[0][0];
      const key = Object.keys(setCall)[0];
      
      // Key should match pattern: quick-tabs-sync-{containerId}-{timestamp}
      expect(key).toMatch(/^quick-tabs-sync-firefox-container-1-\d+$/);
      
      const message = setCall[key];
      expect(message.type).toBe('CLOSE');
      expect(message.data.id).toBe('qt-123');
    });

    test('includes container ID, sender ID, and sequence in storage message', async () => {
      await manager.broadcast('CLOSE', { id: 'qt-456' });
      
      const setCall = mockStorage.storage.local.set.mock.calls[0][0];
      const key = Object.keys(setCall)[0];
      const message = setCall[key];
      
      expect(message.data.cookieStoreId).toBe('firefox-container-1');
      expect(message.data.senderId).toBeDefined();
      expect(message.data.sequence).toBe(1);
    });

    test('returns true on successful storage broadcast', async () => {
      mockStorage.storage.local.set.mockResolvedValue();
      
      const result = await manager.broadcast('CLOSE', { id: 'qt-789' });
      
      expect(result).toBe(true);
    });

    test('returns false on storage broadcast failure', async () => {
      mockStorage.storage.local.set.mockRejectedValue(new Error('Storage quota exceeded'));
      
      const result = await manager.broadcast('CLOSE', { id: 'qt-999' });
      
      expect(result).toBe(false);
    });
  });

  describe('Storage Change Handling', () => {
    test('processes storage changes for sync messages', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      // Simulate storage change event
      const changes = {
        'quick-tabs-sync-firefox-container-1-1234567890': {
          newValue: {
            type: 'CLOSE',
            data: {
              id: 'qt-123',
              senderId: 'other-sender',
              sequence: 1
            }
          }
        }
      };
      
      manager._handleStorageChange(changes, 'local');
      
      expect(listener).toHaveBeenCalled();
    });

    test('ignores storage changes for other containers', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const changes = {
        'quick-tabs-sync-different-container-1234567890': {
          newValue: {
            type: 'CLOSE',
            data: { id: 'qt-123' }
          }
        }
      };
      
      manager._handleStorageChange(changes, 'local');
      
      expect(listener).not.toHaveBeenCalled();
    });

    test('ignores storage changes without newValue', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const changes = {
        'quick-tabs-sync-firefox-container-1-1234567890': {
          oldValue: { type: 'CLOSE', data: { id: 'qt-123' } }
          // No newValue - message was deleted
        }
      };
      
      manager._handleStorageChange(changes, 'local');
      
      expect(listener).not.toHaveBeenCalled();
    });

    test('ignores changes from sync area', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const changes = {
        'quick-tabs-sync-firefox-container-1-1234567890': {
          newValue: {
            type: 'CLOSE',
            data: { id: 'qt-123' }
          }
        }
      };
      
      manager._handleStorageChange(changes, 'sync');
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Storage Cleanup', () => {
    test('removes old storage messages', async () => {
      const now = Date.now();
      const oldTimestamp = now - 10000; // 10 seconds ago
      
      mockStorage.storage.local.get.mockResolvedValue({
        [`quick-tabs-sync-firefox-container-1-${oldTimestamp}`]: { type: 'CLOSE', data: {} },
        [`quick-tabs-sync-firefox-container-1-${now}`]: { type: 'CLOSE', data: {} }
      });
      
      manager.lastCleanupTime = 0; // Force cleanup
      await manager._cleanupStorageMessages();
      
      expect(mockStorage.storage.local.remove).toHaveBeenCalled();
      const removedKeys = mockStorage.storage.local.remove.mock.calls[0][0];
      
      expect(removedKeys).toContain(`quick-tabs-sync-firefox-container-1-${oldTimestamp}`);
      expect(removedKeys).not.toContain(`quick-tabs-sync-firefox-container-1-${now}`);
    });

    test('only runs cleanup every 5 seconds', async () => {
      manager.lastCleanupTime = Date.now();
      
      await manager._cleanupStorageMessages();
      
      expect(mockStorage.storage.local.get).not.toHaveBeenCalled();
      expect(mockStorage.storage.local.remove).not.toHaveBeenCalled();
    });

    test('does not remove sync messages for other containers', async () => {
      const now = Date.now();
      const oldTimestamp = now - 10000;
      
      mockStorage.storage.local.get.mockResolvedValue({
        [`quick-tabs-sync-firefox-container-1-${oldTimestamp}`]: { type: 'CLOSE', data: {} },
        [`quick-tabs-sync-different-container-${oldTimestamp}`]: { type: 'CLOSE', data: {} }
      });
      
      manager.lastCleanupTime = 0;
      await manager._cleanupStorageMessages();
      
      const removedKeys = mockStorage.storage.local.remove.mock.calls[0][0];
      expect(removedKeys).toContain(`quick-tabs-sync-firefox-container-1-${oldTimestamp}`);
      expect(removedKeys).not.toContain(`quick-tabs-sync-different-container-${oldTimestamp}`);
    });
  });

  describe('Cleanup on Close', () => {
    test('removes storage listener on close', () => {
      // Activate fallback to set up listener properly
      delete global.BroadcastChannel;
      manager.setupBroadcastChannel();
      
      const listenerFunc = manager.storageListener;
      expect(listenerFunc).toBeTruthy();
      
      manager.close();
      
      expect(mockStorage.storage.local.onChanged.removeListener).toHaveBeenCalledWith(listenerFunc);
      expect(manager.storageListener).toBeNull();
    });

    test('does not error if no storage listener', () => {
      manager.storageListener = null;
      
      expect(() => manager.close()).not.toThrow();
    });
  });
});
