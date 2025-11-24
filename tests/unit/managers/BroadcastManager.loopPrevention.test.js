/**
 * BroadcastManager Loop Prevention Tests
 * 
 * Tests enhanced debounce and loop prevention mechanisms
 * Related: Gap 5 - Enhanced Debounce & Loop Prevention
 */

// Mock uuid before importing - each call returns unique value
let mockUuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${mockUuidCounter++}`
}));

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import EventEmitter from 'eventemitter3';

describe('BroadcastManager - Loop Prevention (Gap 5)', () => {
  let manager;
  let eventBus;

  beforeEach(() => {
    eventBus = new EventEmitter();
    manager = new BroadcastManager(eventBus, 'firefox-container-1');
  });

  afterEach(() => {
    if (manager) {
      manager.close();
    }
  });

  describe('Sender Identification', () => {
    test('generates unique sender ID on construction', () => {
      expect(manager.senderId).toBeDefined();
      expect(typeof manager.senderId).toBe('string');
      expect(manager.senderId.length).toBeGreaterThan(0);
    });

    test('each manager instance has different sender ID', () => {
      const manager2 = new BroadcastManager(eventBus, 'firefox-container-1');
      
      expect(manager.senderId).not.toBe(manager2.senderId);
      
      manager2.close();
    });

    test('broadcast includes sender ID in message', async () => {
      const mockChannel = {
        postMessage: jest.fn(),
        close: jest.fn()
      };
      
      manager.broadcastChannel = mockChannel;
      
      await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      const call = mockChannel.postMessage.mock.calls[0][0];
      expect(call.data.senderId).toBe(manager.senderId);
    });

    test('broadcast includes incrementing sequence numbers', async () => {
      const mockChannel = {
        postMessage: jest.fn(),
        close: jest.fn()
      };
      
      manager.broadcastChannel = mockChannel;
      
      await manager.broadcast('CLOSE', { id: 'qt-1' });
      await manager.broadcast('CLOSE', { id: 'qt-2' });
      await manager.broadcast('CLOSE', { id: 'qt-3' });
      
      const calls = mockChannel.postMessage.mock.calls;
      expect(calls[0][0].data.sequence).toBe(1);
      expect(calls[1][0].data.sequence).toBe(2);
      expect(calls[2][0].data.sequence).toBe(3);
    });
  });

  describe('Self-Message Filtering', () => {
    test('ignores messages from self', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const message = {
        type: 'CLOSE',
        data: {
          id: 'qt-123',
          senderId: manager.senderId  // Same as manager's sender ID
        }
      };
      
      manager.handleBroadcastMessage(message);
      
      expect(listener).not.toHaveBeenCalled();
      expect(manager.selfMessageCount).toBe(1);
    });

    test('accepts messages from other senders', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const message = {
        type: 'CLOSE',
        data: {
          id: 'qt-123',
          senderId: 'different-sender-id'
        }
      };
      
      manager.handleBroadcastMessage(message);
      
      expect(listener).toHaveBeenCalled();
    });

    test('tracks self-message count', () => {
      const selfMessage = {
        type: 'CLOSE',
        data: {
          id: 'qt-1',
          senderId: manager.senderId
        }
      };
      
      manager.handleBroadcastMessage(selfMessage);
      manager.handleBroadcastMessage(selfMessage);
      
      expect(manager.selfMessageCount).toBe(2);
    });
  });

  describe('Sequence Validation', () => {
    test('accepts first message from sender', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const message = {
        type: 'CLOSE',
        data: {
          id: 'qt-123',
          senderId: 'sender-1',
          sequence: 1
        }
      };
      
      manager.handleBroadcastMessage(message);
      
      expect(listener).toHaveBeenCalled();
    });

    test('accepts incrementing sequences', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const senderId = 'sender-1';
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', senderId, sequence: 1 }
      });
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-2', senderId, sequence: 2 }
      });
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-3', senderId, sequence: 3 }
      });
      
      expect(listener).toHaveBeenCalledTimes(3);
    });

    test('rejects duplicate sequence numbers', () => {
      const listener = jest.fn();
      const anomalyListener = jest.fn();
      
      eventBus.on('broadcast:received', listener);
      eventBus.on('broadcast:sequence-anomaly', anomalyListener);
      
      const senderId = 'sender-1';
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', senderId, sequence: 1 }
      });
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-2', senderId, sequence: 1 }  // Duplicate
      });
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(anomalyListener).toHaveBeenCalledWith({
        senderId,
        lastSequence: 1,
        currentSequence: 1,
        messageType: 'CLOSE',
        count: 1
      });
    });

    test('rejects out-of-order sequence numbers', () => {
      const listener = jest.fn();
      const anomalyListener = jest.fn();
      
      eventBus.on('broadcast:received', listener);
      eventBus.on('broadcast:sequence-anomaly', anomalyListener);
      
      const senderId = 'sender-1';
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', senderId, sequence: 5 }
      });
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-2', senderId, sequence: 3 }  // Out of order
      });
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(anomalyListener).toHaveBeenCalled();
    });

    test('tracks sequences separately per sender', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', senderId: 'sender-1', sequence: 1 }
      });
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-2', senderId: 'sender-2', sequence: 1 }
      });
      
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-3', senderId: 'sender-1', sequence: 2 }
      });
      
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });

  describe('Enhanced Debounce with Sender ID', () => {
    test('debounce key includes sender ID', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      // Same message type and ID, different senders
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 100, top: 200, senderId: 'sender-1', sequence: 1 }
      });
      
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 150, top: 250, senderId: 'sender-2', sequence: 1 }
      });
      
      // Both should be accepted (different senders)
      expect(listener).toHaveBeenCalledTimes(2);
    });

    test('debounces rapid updates from same sender', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const senderId = 'sender-1';
      
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 100, top: 200, senderId, sequence: 1 }
      });
      
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 150, top: 250, senderId, sequence: 2 }
      });
      
      // Second should be debounced
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Configurable Debounce Windows', () => {
    test('uses different debounce windows per message type', () => {
      expect(manager.DEBOUNCE_WINDOWS.UPDATE_POSITION).toBe(50);
      expect(manager.DEBOUNCE_WINDOWS.CREATE).toBe(200);
      expect(manager.DEBOUNCE_WINDOWS.SOLO).toBe(100);
    });

    test('rapid position updates have short window', async () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const senderId = 'sender-1';
      
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 100, top: 200, senderId, sequence: 1 }
      });
      
      // Wait 51ms (just after window for UPDATE_POSITION)
      await new Promise(resolve => setTimeout(resolve, 51));
      
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 150, top: 250, senderId, sequence: 2 }
      });
      
      // Second should be accepted after window expires
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});
