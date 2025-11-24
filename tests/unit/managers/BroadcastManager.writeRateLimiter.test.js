/**
 * Unit Tests for BroadcastManager Write Rate Limiter
 * 
 * Tests the rate limiting mechanism that prevents storage write storms
 * that cause infinite feedback loops.
 * 
 * Part of memory leak fix - see: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
 */

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';

describe('BroadcastManager - Write Rate Limiter', () => {
  let broadcastManager;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn()
    };
    
    broadcastManager = new BroadcastManager(mockEventBus, 'firefox-default');
  });

  afterEach(() => {
    broadcastManager.close();
    jest.clearAllMocks();
  });

  describe('Write Rate Limiter Properties', () => {
    it('should have rate limiter properties initialized', () => {
      expect(broadcastManager.maxWritesPerSecond).toBe(10);
      expect(broadcastManager.writeRateWindow).toBe(1000);
      expect(broadcastManager.writeCountInWindow).toBe(0);
      expect(broadcastManager.blockedWriteCount).toBe(0);
      expect(typeof broadcastManager.windowStartTime).toBe('number');
    });
  });

  describe('_checkWriteRateLimit', () => {
    it('should allow writes under the limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(broadcastManager._checkWriteRateLimit()).toBe(true);
      }
      expect(broadcastManager.writeCountInWindow).toBe(5);
    });

    it('should block writes over the limit', () => {
      // Max out the rate limit
      for (let i = 0; i < broadcastManager.maxWritesPerSecond; i++) {
        broadcastManager._checkWriteRateLimit();
      }
      
      // Next write should be blocked
      expect(broadcastManager._checkWriteRateLimit()).toBe(false);
      expect(broadcastManager.blockedWriteCount).toBe(1);
    });

    it('should reset window after timeout', async () => {
      // Set a short window for testing
      broadcastManager.writeRateWindow = 50;
      
      // Max out the rate limit
      for (let i = 0; i < broadcastManager.maxWritesPerSecond; i++) {
        broadcastManager._checkWriteRateLimit();
      }
      
      // Should be blocked
      expect(broadcastManager._checkWriteRateLimit()).toBe(false);
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // Should be allowed again
      expect(broadcastManager._checkWriteRateLimit()).toBe(true);
      expect(broadcastManager.writeCountInWindow).toBe(1);
    });

    it('should track blocked write count', () => {
      // Max out the rate limit
      for (let i = 0; i < broadcastManager.maxWritesPerSecond; i++) {
        broadcastManager._checkWriteRateLimit();
      }
      
      // Block 5 more writes
      for (let i = 0; i < 5; i++) {
        broadcastManager._checkWriteRateLimit();
      }
      
      expect(broadcastManager.blockedWriteCount).toBe(5);
    });
  });

  describe('getWriteRateLimiterStats', () => {
    it('should return rate limiter statistics', () => {
      broadcastManager._checkWriteRateLimit();
      broadcastManager._checkWriteRateLimit();
      
      const stats = broadcastManager.getWriteRateLimiterStats();
      
      expect(stats).toEqual({
        maxWritesPerSecond: 10,
        writeCountInWindow: 2,
        blockedWriteCount: 0,
        windowStartTime: expect.any(Number)
      });
    });
  });

  describe('Disabled Features', () => {
    it('_persistBroadcastMessage should be disabled', async () => {
      // Should return immediately without doing anything
      await broadcastManager._persistBroadcastMessage('CREATE', { id: 'test' });
      
      // If it were enabled, it would try to access browser.storage
      // Since it's disabled, nothing should happen
    });

    it('replayBroadcastHistory should be disabled and return 0', async () => {
      const result = await broadcastManager.replayBroadcastHistory();
      expect(result).toBe(0);
    });

    it('startPeriodicSnapshots should be disabled', () => {
      broadcastManager.startPeriodicSnapshots();
      
      // The snapshot interval should NOT be started
      expect(broadcastManager.snapshotInterval).toBeNull();
    });
  });
});
