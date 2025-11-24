/**
 * BroadcastManager Container Boundary Validation Tests
 * 
 * Tests container isolation and boundary validation
 * Related: Gap 6 - Container Boundary Validation
 */

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import EventEmitter from 'eventemitter3';

describe('BroadcastManager - Container Boundary Validation (Gap 6)', () => {
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

  describe('Outgoing Messages', () => {
    test('broadcast() includes cookieStoreId in message data', async () => {
      const mockChannel = {
        postMessage: jest.fn(),
        close: jest.fn()
      };
      
      manager.broadcastChannel = mockChannel;
      
      await manager.broadcast('CLOSE', { id: 'qt-123' });
      
      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'CLOSE',
        data: expect.objectContaining({
          id: 'qt-123',
          cookieStoreId: 'firefox-container-1',
          senderId: expect.any(String),
          sequence: expect.any(Number)
        })
      });
    });

    test('broadcast() uses current container ID', async () => {
      const mockChannel = {
        postMessage: jest.fn(),
        close: jest.fn()
      };
      
      manager.broadcastChannel = mockChannel;
      manager.cookieStoreId = 'firefox-container-2';
      
      await manager.broadcast('CLOSE', { id: 'qt-456' });
      
      expect(mockChannel.postMessage).toHaveBeenCalledWith({
        type: 'CLOSE',
        data: expect.objectContaining({
          id: 'qt-456',
          cookieStoreId: 'firefox-container-2',
          senderId: expect.any(String),
          sequence: expect.any(Number)
        })
      });
    });

    test('all notification methods include cookieStoreId', async () => {
      const mockChannel = {
        postMessage: jest.fn(),
        close: jest.fn()
      };
      
      manager.broadcastChannel = mockChannel;
      
      await manager.notifyClose('qt-789');
      
      const calls = mockChannel.postMessage.mock.calls;
      expect(calls[0][0].data.cookieStoreId).toBe('firefox-container-1');
    });
  });

  describe('Incoming Messages', () => {
    test('accepts messages from same container', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const message = {
        type: 'CLOSE',
        data: {
          id: 'qt-123',
          cookieStoreId: 'firefox-container-1',
          senderId: 'different-sender-id', // Different from manager's senderId
          sequence: 1
        }
      };
      
      manager.handleBroadcastMessage(message);
      
      expect(listener).toHaveBeenCalledWith({
        type: 'CLOSE',
        data: expect.objectContaining({
          id: 'qt-123',
          cookieStoreId: 'firefox-container-1',
          senderId: 'different-sender-id',
          sequence: 1
        })
      });
    });

    test('rejects messages from different container', () => {
      const listener = jest.fn();
      const violationListener = jest.fn();
      
      eventBus.on('broadcast:received', listener);
      eventBus.on('broadcast:container-violation', violationListener);
      
      const message = {
        type: 'CLOSE',
        data: {
          id: 'qt-123',
          cookieStoreId: 'firefox-container-2',  // Different container
          senderId: 'different-sender-id', // Different from manager's senderId
          sequence: 1
        }
      };
      
      manager.handleBroadcastMessage(message);
      
      // Message should NOT be processed
      expect(listener).not.toHaveBeenCalled();
      
      // Violation event should be emitted
      expect(violationListener).toHaveBeenCalledWith({
        expectedContainer: 'firefox-container-1',
        actualContainer: 'firefox-container-2',
        messageType: 'CLOSE',
        count: 1
      });
    });

    test('accepts messages without cookieStoreId (backward compatibility)', () => {
      const listener = jest.fn();
      eventBus.on('broadcast:received', listener);
      
      const message = {
        type: 'CLOSE',
        data: {
          id: 'qt-123',
          senderId: 'different-sender-id', // Different from manager's senderId
          sequence: 1
          // No cookieStoreId field
        }
      };
      
      manager.handleBroadcastMessage(message);
      
      // Should accept message for backward compatibility
      expect(listener).toHaveBeenCalledWith({
        type: 'CLOSE',
        data: expect.objectContaining({
          id: 'qt-123',
          senderId: 'different-sender-id',
          sequence: 1
        })
      });
    });

    test('tracks container violation count', () => {
      const message1 = {
        type: 'CLOSE',
        data: {
          id: 'qt-1',
          cookieStoreId: 'firefox-container-2',
          senderId: 'different-sender-id-1',
          sequence: 1
        }
      };
      
      const message2 = {
        type: 'CLOSE',
        data: {
          id: 'qt-2',
          cookieStoreId: 'firefox-container-3',
          senderId: 'different-sender-id-2',
          sequence: 1
        }
      };
      
      manager.handleBroadcastMessage(message1);
      expect(manager.containerViolationCount).toBe(1);
      
      manager.handleBroadcastMessage(message2);
      expect(manager.containerViolationCount).toBe(2);
    });
  });

  describe('Container Consistency', () => {
    test('updateContainer recreates channel with new container ID', () => {
      const setupSpy = jest.spyOn(manager, 'setupBroadcastChannel');
      
      manager.updateContainer('firefox-container-2');
      
      expect(manager.cookieStoreId).toBe('firefox-container-2');
      expect(setupSpy).toHaveBeenCalled();
      
      setupSpy.mockRestore();
    });

    test('updateContainer ignores if container unchanged', () => {
      const setupSpy = jest.spyOn(manager, 'setupBroadcastChannel');
      
      manager.updateContainer('firefox-container-1');  // Same as current
      
      expect(setupSpy).not.toHaveBeenCalled();
      
      setupSpy.mockRestore();
    });
  });

  describe('Cross-Container Message Scenarios', () => {
    test('multiple violations logged separately', () => {
      const violationListener = jest.fn();
      eventBus.on('broadcast:container-violation', violationListener);
      
      // Message from container-2
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', cookieStoreId: 'firefox-container-2' }
      });
      
      // Message from container-3
      manager.handleBroadcastMessage({
        type: 'UPDATE_POSITION',
        data: { id: 'qt-2', left: 100, top: 200, cookieStoreId: 'firefox-container-3' }
      });
      
      expect(violationListener).toHaveBeenCalledTimes(2);
      expect(violationListener.mock.calls[0][0].actualContainer).toBe('firefox-container-2');
      expect(violationListener.mock.calls[1][0].actualContainer).toBe('firefox-container-3');
    });

    test('valid and invalid messages handled correctly', () => {
      const receiveListener = jest.fn();
      const violationListener = jest.fn();
      
      eventBus.on('broadcast:received', receiveListener);
      eventBus.on('broadcast:container-violation', violationListener);
      
      // Valid message
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', cookieStoreId: 'firefox-container-1' }
      });
      
      // Invalid message
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-2', cookieStoreId: 'firefox-container-2' }
      });
      
      // Valid message
      manager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-3', cookieStoreId: 'firefox-container-1' }
      });
      
      expect(receiveListener).toHaveBeenCalledTimes(2);
      expect(violationListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Default Container', () => {
    test('uses firefox-default as default container', () => {
      const defaultManager = new BroadcastManager(eventBus);
      
      expect(defaultManager.cookieStoreId).toBe('firefox-default');
      
      defaultManager.close();
    });

    test('validates against default container', () => {
      const defaultManager = new BroadcastManager(eventBus);
      const listener = jest.fn();
      
      eventBus.on('broadcast:received', listener);
      
      // Message with default container
      defaultManager.handleBroadcastMessage({
        type: 'CLOSE',
        data: { id: 'qt-1', cookieStoreId: 'firefox-default' }
      });
      
      expect(listener).toHaveBeenCalled();
      
      defaultManager.close();
    });
  });
});
