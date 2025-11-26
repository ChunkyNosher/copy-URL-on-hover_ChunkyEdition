/**
 * @fileoverview Unit tests for BroadcastSync
 * Tests BroadcastChannel wrapper with rate limiting, deduplication, and lifecycle
 */

// Mock BroadcastChannel before imports
class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this._closed = false;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data) {
    if (this._closed) {
      throw new Error('Channel is closed');
    }
    // Simulate message to other instances with same name
    MockBroadcastChannel.instances.forEach(instance => {
      if (instance !== this && instance.name === this.name && instance.onmessage && !instance._closed) {
        // Use setTimeout to simulate async nature
        setTimeout(() => {
          instance.onmessage({ data });
        }, 0);
      }
    });
  }

  close() {
    this._closed = true;
  }

  static instances = [];

  static reset() {
    MockBroadcastChannel.instances = [];
  }
}

// Set up global mock
global.BroadcastChannel = MockBroadcastChannel;

// Mock browser API
global.browser = {
  runtime: {
    onSuspend: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  }
};

import { BroadcastSync } from '../../../src/features/quick-tabs/sync/BroadcastSync.js';

describe('BroadcastSync', () => {
  let broadcastSync;

  beforeEach(() => {
    MockBroadcastChannel.reset();
    
    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    broadcastSync = new BroadcastSync('firefox-default', 'tab-1');
  });

  afterEach(() => {
    if (broadcastSync && !broadcastSync.isClosed()) {
      broadcastSync.close();
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create BroadcastChannel with container-scoped name', () => {
      expect(broadcastSync.channel).toBeDefined();
      expect(broadcastSync.channel.name).toBe('quick-tabs-firefox-default');
    });

    it('should initialize with correct properties', () => {
      expect(broadcastSync.cookieStoreId).toBe('firefox-default');
      expect(broadcastSync.tabId).toBe('tab-1');
      expect(broadcastSync.isClosed()).toBe(false);
      expect(broadcastSync.isPaused()).toBe(false);
    });

    it('should initialize empty Maps for rate limiting and deduplication', () => {
      expect(broadcastSync.rateLimiter.size).toBe(0);
      expect(broadcastSync.processedMessages.size).toBe(0);
    });
  });

  describe('MESSAGE_TYPES', () => {
    it('should have all required message types', () => {
      expect(BroadcastSync.MESSAGE_TYPES.POSITION_UPDATE).toBe('POSITION_UPDATE');
      expect(BroadcastSync.MESSAGE_TYPES.POSITION_FINAL).toBe('POSITION_FINAL');
      expect(BroadcastSync.MESSAGE_TYPES.SIZE_UPDATE).toBe('SIZE_UPDATE');
      expect(BroadcastSync.MESSAGE_TYPES.SIZE_FINAL).toBe('SIZE_FINAL');
      expect(BroadcastSync.MESSAGE_TYPES.FOCUS).toBe('FOCUS');
      expect(BroadcastSync.MESSAGE_TYPES.HEARTBEAT).toBe('HEARTBEAT');
    });
  });

  describe('send()', () => {
    it('should send message successfully', () => {
      const result = broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 });
      expect(result).toBe(true);
    });

    it('should rate limit rapid messages', () => {
      // First message should succeed
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 })).toBe(true);
      
      // Immediate second message should be rate limited
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 101, top: 201 })).toBe(false);
    });

    it('should allow messages for different IDs', () => {
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 })).toBe(true);
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-2', left: 100, top: 200 })).toBe(true);
    });

    it('should allow messages for different actions', () => {
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 })).toBe(true);
      expect(broadcastSync.send('SIZE_UPDATE', { id: 'qt-1', width: 800, height: 600 })).toBe(true);
    });

    it('should return false when closed', () => {
      broadcastSync.close();
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 })).toBe(false);
    });

    it('should return false when paused', () => {
      broadcastSync._paused = true;
      expect(broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 })).toBe(false);
    });

    it('should track sent messages for deduplication', () => {
      broadcastSync.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 });
      expect(broadcastSync.processedMessages.size).toBe(1);
    });
  });

  describe('on() and off()', () => {
    it('should register listener', () => {
      const callback = jest.fn();
      broadcastSync.on('POSITION_UPDATE', callback);

      expect(broadcastSync.listeners.get('POSITION_UPDATE')).toContain(callback);
    });

    it('should remove listener', () => {
      const callback = jest.fn();
      broadcastSync.on('POSITION_UPDATE', callback);
      broadcastSync.off('POSITION_UPDATE', callback);

      expect(broadcastSync.listeners.get('POSITION_UPDATE')).not.toContain(callback);
    });

    it('should handle removing non-existent listener', () => {
      const callback = jest.fn();
      // Should not throw
      expect(() => broadcastSync.off('POSITION_UPDATE', callback)).not.toThrow();
    });
  });

  describe('message handling', () => {
    it('should ignore own messages', async () => {
      const callback = jest.fn();
      broadcastSync.on('POSITION_UPDATE', callback);

      // Simulate receiving own message
      broadcastSync.channel.onmessage({
        data: {
          senderId: 'tab-1', // Same as broadcastSync.tabId
          action: 'POSITION_UPDATE',
          payload: { id: 'qt-1', left: 100, top: 200 },
          messageId: 'test-123'
        }
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should process messages from other tabs', async () => {
      const callback = jest.fn();
      broadcastSync.on('POSITION_UPDATE', callback);

      // Simulate receiving message from another tab
      broadcastSync.channel.onmessage({
        data: {
          senderId: 'tab-2', // Different from broadcastSync.tabId
          action: 'POSITION_UPDATE',
          payload: { id: 'qt-1', left: 100, top: 200 },
          messageId: 'test-123'
        }
      });

      expect(callback).toHaveBeenCalledWith({ id: 'qt-1', left: 100, top: 200 });
    });

    it('should ignore duplicate messages', async () => {
      const callback = jest.fn();
      broadcastSync.on('POSITION_UPDATE', callback);

      const message = {
        data: {
          senderId: 'tab-2',
          action: 'POSITION_UPDATE',
          payload: { id: 'qt-1', left: 100, top: 200 },
          messageId: 'test-123'
        }
      };

      // First message should be processed
      broadcastSync.channel.onmessage(message);
      expect(callback).toHaveBeenCalledTimes(1);

      // Second message with same ID should be ignored
      broadcastSync.channel.onmessage(message);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle listener errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Listener error');
      });
      const successCallback = jest.fn();

      broadcastSync.on('POSITION_UPDATE', errorCallback);
      broadcastSync.on('POSITION_UPDATE', successCallback);

      // Should not throw
      expect(() => {
        broadcastSync.channel.onmessage({
          data: {
            senderId: 'tab-2',
            action: 'POSITION_UPDATE',
            payload: { id: 'qt-1', left: 100, top: 200 },
            messageId: 'test-456'
          }
        });
      }).not.toThrow();

      // Second listener should still be called
      expect(successCallback).toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('should close channel and clear resources', () => {
      broadcastSync.close();

      expect(broadcastSync.isClosed()).toBe(true);
      expect(broadcastSync.channel).toBeNull();
      expect(broadcastSync.listeners).toBeNull();
      expect(broadcastSync.rateLimiter).toBeNull();
      expect(broadcastSync.processedMessages).toBeNull();
    });

    it('should be idempotent (safe to call multiple times)', () => {
      broadcastSync.close();
      expect(() => broadcastSync.close()).not.toThrow();
    });
  });

  describe('sendHeartbeat()', () => {
    it('should send heartbeat message', () => {
      const result = broadcastSync.sendHeartbeat();
      expect(result).toBe(true);
    });
  });

  describe('message ID generation', () => {
    it('should generate unique message IDs', () => {
      const id1 = broadcastSync._generateMessageId();
      const id2 = broadcastSync._generateMessageId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^tab-1-\d+-[a-z0-9]+$/);
    });
  });

  describe('cleanup', () => {
    it('should clean up old processed messages', () => {
      jest.useFakeTimers();

      // Add some messages
      broadcastSync._recordMessage('msg-1');
      broadcastSync._recordMessage('msg-2');

      // Advance time past TTL
      jest.advanceTimersByTime(31000);

      // Trigger cleanup
      broadcastSync._cleanupProcessedMessages();

      expect(broadcastSync.processedMessages.size).toBe(0);
    });

    it('should clean up rate limiter when size exceeded', () => {
      // Fill up rate limiter beyond max
      for (let i = 0; i < 150; i++) {
        broadcastSync.rateLimiter.set(`key-${i}`, Date.now() - 10000); // Old entries
      }

      // Trigger cleanup via send
      broadcastSync.send('TEST', { id: 'cleanup-test' });

      expect(broadcastSync.rateLimiter.size).toBeLessThan(150);
    });
  });
});

describe('BroadcastSync cross-tab communication', () => {
  let sync1;
  let sync2;

  beforeEach(() => {
    MockBroadcastChannel.reset();
    
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    sync1 = new BroadcastSync('firefox-default', 'tab-1');
    sync2 = new BroadcastSync('firefox-default', 'tab-2');
  });

  afterEach(() => {
    sync1?.close();
    sync2?.close();
    jest.restoreAllMocks();
  });

  it('should send messages between tabs', async () => {
    const callback = jest.fn();
    sync2.on('POSITION_UPDATE', callback);

    sync1.send('POSITION_UPDATE', { id: 'qt-1', left: 150, top: 250 });

    // Wait for async message delivery
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).toHaveBeenCalledWith({ id: 'qt-1', left: 150, top: 250 });
  });

  it('should isolate messages by container', async () => {
    const personalContainer = new BroadcastSync('firefox-container-1', 'tab-3');
    const callback = jest.fn();
    
    personalContainer.on('POSITION_UPDATE', callback);

    // Send from default container
    sync1.send('POSITION_UPDATE', { id: 'qt-1', left: 100, top: 200 });

    // Wait for async message delivery
    await new Promise(resolve => setTimeout(resolve, 10));

    // Personal container should NOT receive message
    expect(callback).not.toHaveBeenCalled();

    personalContainer.close();
  });
});
