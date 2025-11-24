/**
 * BroadcastManager Error Recovery Tests
 * 
 * Tests error recovery and automatic reconnection
 * Related: Gap 2 - Error Recovery & Reconnection
 */

// Mock uuid before importing
let mockUuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${mockUuidCounter++}`
}));

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import EventEmitter from 'eventemitter3';

// Enable fake timers
jest.useFakeTimers();

describe('BroadcastManager - Error Recovery (Gap 2)', () => {
  let manager;
  let eventBus;
  let mockChannel;

  beforeEach(() => {
    jest.clearAllTimers();
    eventBus = new EventEmitter();
    manager = new BroadcastManager(eventBus, 'firefox-container-1');
    
    // Create mock channel
    mockChannel = {
      postMessage: jest.fn(),
      close: jest.fn()
    };
  });

  afterEach(() => {
    if (manager) {
      manager.close();
    }
  });

  describe('Health Tracking', () => {
    test('tracks last successful send', async () => {
      manager.broadcastChannel = mockChannel;
      
      const before = Date.now();
      await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(manager.lastSuccessfulSend).toBeGreaterThanOrEqual(before);
      expect(manager.isChannelHealthy).toBe(true);
    });

    test('resets consecutive failures on success', async () => {
      manager.broadcastChannel = mockChannel;
      manager.consecutiveFailures = 3;
      
      await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(manager.consecutiveFailures).toBe(0);
    });

    test('increments consecutive failures on error', async () => {
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(manager.consecutiveFailures).toBe(1);
      expect(manager.isChannelHealthy).toBe(false);
    });
  });

  describe('Error Event Emission', () => {
    test('emits broadcast:error on failure', async () => {
      const errorListener = jest.fn();
      eventBus.on('broadcast:error', errorListener);
      
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Network error');
      });
      
      await manager.broadcast('UPDATE_POSITION', { id: 'qt-456', left: 100, top: 200 });
      
      expect(errorListener).toHaveBeenCalledWith({
        messageType: 'UPDATE_POSITION',
        error: 'Network error',
        consecutiveFailures: 1,
        timestamp: expect.any(Number)
      });
    });

    test('includes failure count in error event', async () => {
      const errorListener = jest.fn();
      eventBus.on('broadcast:error', errorListener);
      
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Failed');
      });
      
      await manager.broadcast('CLOSE', { id: 'qt-1' });
      await manager.broadcast('CLOSE', { id: 'qt-2' });
      
      expect(errorListener).toHaveBeenCalledTimes(2);
      expect(errorListener.mock.calls[1][0].consecutiveFailures).toBe(2);
    });
  });

  describe('Automatic Reconnection', () => {
    test('schedules reconnection after 3 failures', async () => {
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Failed');
      });
      
      // Cause 3 failures
      await manager.broadcast('CLOSE', { id: 'qt-1' });
      await manager.broadcast('CLOSE', { id: 'qt-2' });
      await manager.broadcast('CLOSE', { id: 'qt-3' });
      
      expect(manager.reconnectionTimer).not.toBeNull();
    });

    test('uses exponential backoff for reconnection', async () => {
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Failed');
      });
      
      // First reconnection attempt (after 3 failures)
      await manager.broadcast('CLOSE', { id: 'qt-1' });
      await manager.broadcast('CLOSE', { id: 'qt-2' });
      await manager.broadcast('CLOSE', { id: 'qt-3' });
      
      expect(manager.reconnectionTimer).not.toBeNull();
      
      // Fast-forward 100ms (first backoff interval)
      jest.advanceTimersByTime(100);
      
      expect(manager.reconnectionAttempts).toBe(1);
    });

    test('switches to fallback after 5 failed reconnections', async () => {
      global.BroadcastChannel = jest.fn(() => {
        throw new Error('BC unavailable');
      });
      
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Failed');
      });
      
      // Simulate 5 reconnection failures
      for (let i = 0; i < 5; i++) {
        manager.reconnectionAttempts = i;
        await manager.broadcast('CLOSE', { id: `qt-${i}` });
        await manager.broadcast('CLOSE', { id: `qt-${i}` });
        await manager.broadcast('CLOSE', { id: `qt-${i}` });
        
        if (manager.reconnectionTimer) {
          jest.runOnlyPendingTimers();
        }
      }
      
      expect(manager.useStorageFallback).toBe(true);
      expect(manager.useBroadcastChannel).toBe(false);
    });
  });

  describe('Channel Health Test', () => {
    test('testChannelHealth returns true for healthy channel', () => {
      manager.broadcastChannel = mockChannel;
      
      manager._testChannelHealth();
      
      expect(manager.isChannelHealthy).toBe(true);
      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: '__PING__',
        data: {}
      });
    });

    test('testChannelHealth returns false for failed channel', () => {
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Test failed');
      });
      
      manager._testChannelHealth();
      
      expect(manager.isChannelHealthy).toBe(false);
    });

    test('testChannelHealth schedules reconnection on failure', () => {
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Test failed');
      });
      manager.consecutiveFailures = 3; // Already at threshold
      
      manager._testChannelHealth();
      
      expect(manager.reconnectionTimer).not.toBeNull();
    });
  });

  describe('Reconnection Logic', () => {
    test('closes and recreates channel on reconnection', async () => {
      global.BroadcastChannel = jest.fn(() => mockChannel);
      
      manager.broadcastChannel = mockChannel;
      manager.reconnectionAttempts = 0;
      
      manager._attemptReconnection();
      
      expect(mockChannel.close).toHaveBeenCalled();
      expect(global.BroadcastChannel).toHaveBeenCalled();
    });

    test('increments reconnection attempts', () => {
      global.BroadcastChannel = jest.fn(() => mockChannel);
      
      manager.broadcastChannel = mockChannel;
      expect(manager.reconnectionAttempts).toBe(0);
      
      manager._attemptReconnection();
      
      expect(manager.reconnectionAttempts).toBe(1);
    });

    test('clears reconnection timer on close', () => {
      manager.reconnectionTimer = setTimeout(() => {}, 1000);
      
      manager.close();
      
      expect(manager.reconnectionTimer).toBeNull();
    });
  });

  describe('Return Values', () => {
    test('broadcast returns true on success', async () => {
      manager.broadcastChannel = mockChannel;
      
      const result = await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(result).toBe(true);
    });

    test('broadcast returns false on failure', async () => {
      manager.broadcastChannel = mockChannel;
      mockChannel.postMessage.mockImplementation(() => {
        throw new Error('Failed');
      });
      
      const result = await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(result).toBe(false);
    });

    test('broadcast returns false when channel unavailable', async () => {
      manager.broadcastChannel = null;
      
      const result = await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(result).toBe(false);
    });
  });
});
