/**
 * BroadcastManager Unit Tests
 * Phase 2.1: Tests for extracted broadcast messaging logic
 */

import { EventEmitter } from 'eventemitter3';

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';

describe('BroadcastManager', () => {
  let manager;
  let eventBus;
  let mockChannel;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create event bus
    eventBus = new EventEmitter();

    // Mock BroadcastChannel
    mockChannel = {
      postMessage: jest.fn(),
      close: jest.fn(),
      onmessage: null
    };

    global.BroadcastChannel = jest.fn(() => mockChannel);

    // Create manager
    manager = new BroadcastManager(eventBus, 'firefox-default');
  });

  afterEach(() => {
    manager.close();
    delete global.BroadcastChannel;
  });

  describe('Constructor', () => {
    test('should initialize with default container', () => {
      const mgr = new BroadcastManager(eventBus);
      expect(mgr.cookieStoreId).toBe('firefox-default');
      expect(mgr.eventBus).toBe(eventBus);
    });

    test('should initialize with custom container', () => {
      const mgr = new BroadcastManager(eventBus, 'firefox-container-1');
      expect(mgr.cookieStoreId).toBe('firefox-container-1');
    });

    test('should initialize debounce map', () => {
      expect(manager.broadcastDebounce).toBeInstanceOf(Map);
      expect(manager.broadcastDebounce.size).toBe(0);
    });
  });

  describe('setupBroadcastChannel()', () => {
    test('should create container-specific channel', () => {
      manager.setupBroadcastChannel();

      expect(global.BroadcastChannel).toHaveBeenCalledWith('quick-tabs-sync-firefox-default');
      expect(manager.broadcastChannel).toBe(mockChannel);
      expect(manager.currentChannelName).toBe('quick-tabs-sync-firefox-default');
    });

    test('should close existing channel before creating new one', () => {
      manager.setupBroadcastChannel();
      const oldChannel = manager.broadcastChannel;

      manager.setupBroadcastChannel();

      expect(oldChannel.close).toHaveBeenCalled();
    });

    test('should attach message handler', () => {
      manager.setupBroadcastChannel();
      expect(mockChannel.onmessage).toBeInstanceOf(Function);
    });

    test('should handle missing BroadcastChannel API', () => {
      delete global.BroadcastChannel;

      manager.setupBroadcastChannel();

      expect(manager.broadcastChannel).toBeNull();
    });
  });

  describe('handleBroadcastMessage()', () => {
    test('should emit broadcast:received event', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);

      manager.handleBroadcastMessage({
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      });
    });

    test('should debounce duplicate messages', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);

      const message = {
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      };

      manager.handleBroadcastMessage(message);
      manager.handleBroadcastMessage(message); // Duplicate within 50ms

      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('should allow messages after debounce period', done => {
      manager.BROADCAST_DEBOUNCE_MS = 10; // Shorten for test
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);

      const message = {
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      };

      manager.handleBroadcastMessage(message);

      setTimeout(() => {
        manager.handleBroadcastMessage(message);
        expect(listener).toHaveBeenCalledTimes(2);
        done();
      }, 15);
    });
  });

  describe('shouldDebounce()', () => {
    test('should return true for duplicate within debounce window', () => {
      const type = 'CREATE';
      const data = { id: 'qt-123' };

      expect(manager.shouldDebounce(type, data)).toBe(false); // First call
      expect(manager.shouldDebounce(type, data)).toBe(true); // Duplicate
    });

    test('should return false for different messages', () => {
      expect(manager.shouldDebounce('CREATE', { id: 'qt-1' })).toBe(false);
      expect(manager.shouldDebounce('CREATE', { id: 'qt-2' })).toBe(false);
      expect(manager.shouldDebounce('UPDATE_POSITION', { id: 'qt-1' })).toBe(false);
    });

    test('should clean up old debounce entries', () => {
      manager.BROADCAST_DEBOUNCE_MS = 10;

      // Add 101 entries to trigger cleanup
      for (let i = 0; i < 101; i++) {
        manager.shouldDebounce('TEST', { id: `qt-${i}` });
      }

      // Wait for entries to age
      setTimeout(() => {
        expect(manager.broadcastDebounce.size).toBeLessThan(101);
      }, 50);
    });
  });

  describe('broadcast()', () => {
    beforeEach(() => {
      manager.setupBroadcastChannel();
    });

    test('should post message to channel', async () => {
      await manager.broadcast('CREATE', { id: 'qt-123', url: 'https://example.com' });

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      });
    });

    test('should handle missing channel gracefully', async () => {
      manager.broadcastChannel = null;

      await manager.broadcast('CREATE', { id: 'qt-123' });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('notify methods', () => {
    beforeEach(() => {
      manager.setupBroadcastChannel();
    });

    test('notifyCreate() should broadcast CREATE', async () => {
      await manager.notifyCreate({ id: 'qt-123', url: 'https://example.com' });

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      });
    });

    test('notifyPositionUpdate() should broadcast UPDATE_POSITION', async () => {
      await manager.notifyPositionUpdate('qt-123', 100, 200);

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-123', left: 100, top: 200 }
      });
    });

    test('notifySizeUpdate() should broadcast UPDATE_SIZE', async () => {
      await manager.notifySizeUpdate('qt-123', 400, 300);

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'UPDATE_SIZE',
        data: { id: 'qt-123', width: 400, height: 300 }
      });
    });

    test('notifyMinimize() should broadcast MINIMIZE', async () => {
      await manager.notifyMinimize('qt-123');

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'MINIMIZE',
        data: { id: 'qt-123' }
      });
    });

    test('notifyRestore() should broadcast RESTORE', async () => {
      await manager.notifyRestore('qt-123');

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'RESTORE',
        data: { id: 'qt-123' }
      });
    });

    test('notifyClose() should broadcast CLOSE', async () => {
      await manager.notifyClose('qt-123');

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'CLOSE',
        data: { id: 'qt-123' }
      });
    });

    test('notifySolo() should broadcast SOLO', async () => {
      await manager.notifySolo('qt-123', [100, 200]);

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'SOLO',
        data: { id: 'qt-123', soloedOnTabs: [100, 200] }
      });
    });

    test('notifyMute() should broadcast MUTE', async () => {
      await manager.notifyMute('qt-123', [100, 200]);

      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'MUTE',
        data: { id: 'qt-123', mutedOnTabs: [100, 200] }
      });
    });
  });

  describe('updateContainer()', () => {
    test('should re-create channel for new container', () => {
      manager.setupBroadcastChannel();
      const oldChannel = manager.broadcastChannel;

      manager.updateContainer('firefox-container-1');

      expect(oldChannel.close).toHaveBeenCalled();
      expect(manager.cookieStoreId).toBe('firefox-container-1');
      expect(global.BroadcastChannel).toHaveBeenCalledWith('quick-tabs-sync-firefox-container-1');
    });

    test('should not re-create channel for same container', () => {
      manager.setupBroadcastChannel();
      const oldChannel = manager.broadcastChannel;

      manager.updateContainer('firefox-default');

      expect(oldChannel.close).not.toHaveBeenCalled();
      expect(manager.broadcastChannel).toBe(oldChannel);
    });
  });

  describe('close()', () => {
    test('should close broadcast channel', () => {
      manager.setupBroadcastChannel();
      const channel = manager.broadcastChannel;

      manager.close();

      expect(channel.close).toHaveBeenCalled();
      expect(manager.broadcastChannel).toBeNull();
      expect(manager.currentChannelName).toBeNull();
    });

    test('should handle close when no channel exists', () => {
      manager.close();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle BroadcastChannel setup failure', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // Create manager first with working BroadcastChannel
      const errorManager = new BroadcastManager(eventBus, 'firefox-default');

      // Now mock BroadcastChannel to throw error for re-setup
      global.BroadcastChannel = jest.fn(() => {
        throw new Error('BroadcastChannel not available');
      });

      // Try to setup again - should catch error
      errorManager.setupBroadcastChannel();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[BroadcastManager] Failed to setup BroadcastChannel:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    test('should handle broadcast postMessage failure', () => {
      manager.setupBroadcastChannel();
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Failed to post message');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      manager.broadcast('TEST', { id: 'test-123' });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[BroadcastManager] Failed to broadcast:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('should handle message without channel', () => {
      manager.broadcastChannel = null;

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      manager.broadcast('TEST', { id: 'test-123' });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[BroadcastManager] No broadcast channel available'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Message Reception', () => {
    test('should trigger onmessage handler when message received', () => {
      manager.setupBroadcastChannel();

      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);

      // Simulate message reception via onmessage
      const messageEvent = {
        data: {
          type: 'CREATE',
          data: { id: 'qt-123', url: 'https://example.com' }
        }
      };

      mockChannel.onmessage(messageEvent);

      expect(listener).toHaveBeenCalledWith({
        type: 'CREATE',
        data: { id: 'qt-123', url: 'https://example.com' }
      });
    });
  });

  describe('Debouncing Edge Cases', () => {
    test('should not debounce message without data', () => {
      const result = manager.shouldDebounce('TEST', null);
      expect(result).toBe(false);
    });

    test('should not debounce message without id', () => {
      const result = manager.shouldDebounce('TEST', { url: 'https://example.com' });
      expect(result).toBe(false);
    });

    test('should cleanup old debounce entries when size exceeds 100', () => {
      // Fill debounce map with old entries
      const now = Date.now();
      const oldTimestamp = now - manager.BROADCAST_DEBOUNCE_MS * 3; // Very old

      for (let i = 0; i < 110; i++) {
        manager.broadcastDebounce.set(`CREATE-qt-${i}`, oldTimestamp);
      }

      expect(manager.broadcastDebounce.size).toBe(110);

      // Trigger debounce check (which calls cleanup)
      manager.shouldDebounce('CREATE', { id: 'qt-new' });

      // Old entries should be cleaned up
      expect(manager.broadcastDebounce.size).toBeLessThan(110);
    });

    test('should not cleanup debounce entries when size is small', () => {
      // Add only a few entries
      const now = Date.now();
      manager.broadcastDebounce.set('CREATE-qt-1', now);
      manager.broadcastDebounce.set('CREATE-qt-2', now);

      expect(manager.broadcastDebounce.size).toBe(2);

      // Trigger debounce check (cleanup should not run)
      manager.shouldDebounce('CREATE', { id: 'qt-3' });

      // Size should remain same or just +1 for new entry
      expect(manager.broadcastDebounce.size).toBeLessThanOrEqual(3);
    });
  });
});
