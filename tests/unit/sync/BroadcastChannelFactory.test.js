/**
 * @fileoverview Unit tests for BroadcastChannelFactory
 * Tests singleton pattern and channel management
 */

// Mock BroadcastChannel
class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this._closed = false;
  }

  postMessage() {
    if (this._closed) {
      throw new Error('Channel is closed');
    }
  }

  close() {
    this._closed = true;
  }
}

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

// Need to use fresh imports after mocking
import { BroadcastChannelFactory, BroadcastChannelFactoryClass } from '../../../src/features/quick-tabs/sync/BroadcastChannelFactory.js';

describe('BroadcastChannelFactory', () => {
  let factory;

  beforeEach(() => {
    // Create fresh factory for each test
    factory = new BroadcastChannelFactoryClass();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    factory.closeAll();
    jest.restoreAllMocks();
  });

  describe('getChannel()', () => {
    it('should create new channel for container', () => {
      const channel = factory.getChannel('firefox-default', 'tab-1');

      expect(channel).toBeDefined();
      expect(channel.cookieStoreId).toBe('firefox-default');
      expect(channel.tabId).toBe('tab-1');
    });

    it('should return same channel for same container', () => {
      const channel1 = factory.getChannel('firefox-default', 'tab-1');
      const channel2 = factory.getChannel('firefox-default', 'tab-2');

      expect(channel1).toBe(channel2);
    });

    it('should create different channels for different containers', () => {
      const channel1 = factory.getChannel('firefox-default', 'tab-1');
      const channel2 = factory.getChannel('firefox-container-1', 'tab-2');

      expect(channel1).not.toBe(channel2);
      expect(channel1.cookieStoreId).toBe('firefox-default');
      expect(channel2.cookieStoreId).toBe('firefox-container-1');
    });

    it('should replace closed channel with new one', () => {
      const channel1 = factory.getChannel('firefox-default', 'tab-1');
      channel1.close();

      const channel2 = factory.getChannel('firefox-default', 'tab-2');

      expect(channel2).not.toBe(channel1);
      expect(channel2.isClosed()).toBe(false);
    });
  });

  describe('closeChannel()', () => {
    it('should close specific channel', () => {
      const channel = factory.getChannel('firefox-default', 'tab-1');
      
      factory.closeChannel('firefox-default');

      expect(channel.isClosed()).toBe(true);
      expect(factory.hasChannel('firefox-default')).toBe(false);
    });

    it('should handle closing non-existent channel', () => {
      // Should not throw
      expect(() => factory.closeChannel('non-existent')).not.toThrow();
    });
  });

  describe('closeAll()', () => {
    it('should close all channels', () => {
      const channel1 = factory.getChannel('firefox-default', 'tab-1');
      const channel2 = factory.getChannel('firefox-container-1', 'tab-2');
      const channel3 = factory.getChannel('firefox-container-2', 'tab-3');

      factory.closeAll();

      expect(channel1.isClosed()).toBe(true);
      expect(channel2.isClosed()).toBe(true);
      expect(channel3.isClosed()).toBe(true);
      expect(factory.getChannelCount()).toBe(0);
    });

    it('should clear channels map', () => {
      factory.getChannel('firefox-default', 'tab-1');
      factory.getChannel('firefox-container-1', 'tab-2');

      factory.closeAll();

      expect(factory.channels.size).toBe(0);
    });
  });

  describe('hasChannel()', () => {
    it('should return true for active channel', () => {
      factory.getChannel('firefox-default', 'tab-1');

      expect(factory.hasChannel('firefox-default')).toBe(true);
    });

    it('should return false for non-existent channel', () => {
      expect(factory.hasChannel('non-existent')).toBe(false);
    });

    it('should return false for closed channel', () => {
      const channel = factory.getChannel('firefox-default', 'tab-1');
      channel.close();

      expect(factory.hasChannel('firefox-default')).toBe(false);
    });
  });

  describe('getChannelCount()', () => {
    it('should return correct count of active channels', () => {
      expect(factory.getChannelCount()).toBe(0);

      factory.getChannel('firefox-default', 'tab-1');
      expect(factory.getChannelCount()).toBe(1);

      factory.getChannel('firefox-container-1', 'tab-2');
      expect(factory.getChannelCount()).toBe(2);
    });

    it('should not count closed channels', () => {
      const channel = factory.getChannel('firefox-default', 'tab-1');
      factory.getChannel('firefox-container-1', 'tab-2');

      channel.close();

      expect(factory.getChannelCount()).toBe(1);
    });
  });

  describe('getActiveContainerIds()', () => {
    it('should return array of active container IDs', () => {
      factory.getChannel('firefox-default', 'tab-1');
      factory.getChannel('firefox-container-1', 'tab-2');

      const ids = factory.getActiveContainerIds();

      expect(ids).toContain('firefox-default');
      expect(ids).toContain('firefox-container-1');
      expect(ids.length).toBe(2);
    });

    it('should not include closed channels', () => {
      const channel = factory.getChannel('firefox-default', 'tab-1');
      factory.getChannel('firefox-container-1', 'tab-2');

      channel.close();

      const ids = factory.getActiveContainerIds();

      expect(ids).not.toContain('firefox-default');
      expect(ids).toContain('firefox-container-1');
    });
  });
});

describe('BroadcastChannelFactory singleton', () => {
  it('should export singleton instance', () => {
    expect(BroadcastChannelFactory).toBeDefined();
    expect(BroadcastChannelFactory.getChannel).toBeDefined();
    expect(BroadcastChannelFactory.closeAll).toBeDefined();
  });
});
