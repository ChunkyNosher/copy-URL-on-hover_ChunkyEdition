/**
 * Scenario 18: Corrupted Storage Recovery
 * 
 * Tests graceful recovery from corrupted storage data without crashes or data loss.
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 18)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Phase 3)
 * 
 * Covers Issues: #47 (robustness & error handling)
 */

import { EventEmitter } from 'eventemitter3';

import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { QuickTab } from '../../../src/domain/QuickTab.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 18: Corrupted Storage Recovery Protocol', () => {
  let tabs;
  let broadcastManagers;
  let stateManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://youtube.com', containerId: 'firefox-default' }
    ]);

    eventBuses = tabs.map(() => new EventEmitter());

    channels = tabs.map(() => ({
      postMessage: jest.fn(),
      close: jest.fn(),
      onmessage: null
    }));

    let channelIndex = 0;
    global.BroadcastChannel = jest.fn(() => {
      const channel = channels[channelIndex];
      channelIndex++;
      return channel;
    });

    global.browser = {
      storage: {
        sync: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined)
        },
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined)
        },
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue({ success: true })
      }
    };

    broadcastManagers = tabs.map((tab, index) => {
      const manager = new BroadcastManager(eventBuses[index], tab.containerId);
      manager.setupBroadcastChannel();
      return manager;
    });

    stateManagers = tabs.map((tab, index) => {
      return new StateManager(eventBuses[index], tab.tabId);
    });

    channels.forEach((sourceChannel, sourceIndex) => {
      const originalPostMessage = sourceChannel.postMessage;
      sourceChannel.postMessage = jest.fn((message) => {
        if (originalPostMessage && originalPostMessage.mock) {
          originalPostMessage(message);
        }
        
        setTimeout(() => {
          channels.forEach((targetChannel, targetIndex) => {
            if (sourceIndex !== targetIndex && targetChannel.onmessage) {
              targetChannel.onmessage({ data: message });
            }
          });
        }, 10);
      });
    });
  });

  afterEach(() => {
    broadcastManagers.forEach(m => m.close());
    delete global.BroadcastChannel;
    delete global.browser;
  });

  describe('Invalid Message Handling', () => {
    test('malformed broadcast message does not crash state manager', async () => {
      eventBuses[1].on('broadcast:received', (message) => {
        // This handler should not throw even with malformed messages
        if (message.type === 'CREATE' && message.data && message.data.id) {
          const qt = new QuickTab({
            id: message.data.id,
            url: message.data.url || 'https://example.com',
            position: message.data.position || { left: 100, top: 100 },
            size: message.data.size || { width: 800, height: 600 },
            container: message.data.container || 'firefox-default'
          });
          stateManagers[1].add(qt);
        }
      });

      // Send malformed message (missing required fields)
      await broadcastManagers[0].broadcast('CREATE', {
        id: 'qt-malformed-1'
        // Missing url, position, size, container
      });

      await wait(100);

      // Should not crash - defaults should be used
      const qt = stateManagers[1].get('qt-malformed-1');
      expect(qt).toBeDefined();
      expect(qt.url).toBe('https://example.com'); // default
    });

    test('message with invalid Quick Tab ID is handled gracefully', async () => {
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          const qt = stateManagers[1].get(message.data.id);
          if (qt) {
            qt.position.left = message.data.left;
            qt.position.top = message.data.top;
            stateManagers[1].update(qt);
          }
          // If qt doesn't exist, silently ignore (no crash)
        }
      });

      // Send update for non-existent Quick Tab - should not throw
      broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: 'qt-nonexistent',
        left: 500,
        top: 500
      });

      await wait(100);

      // Should not crash or create invalid state
      expect(stateManagers[1].count()).toBe(0);
    });
  });

  describe('Partial Data Recovery', () => {
    test('Quick Tab with missing visibility data uses defaults', async () => {
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CREATE') {
          // Create Quick Tab even if visibility data missing
          const qt = new QuickTab({
            id: message.data.id,
            url: message.data.url,
            position: { left: message.data.left, top: message.data.top },
              size: { width: message.data.width, height: message.data.height },
            container: message.data.container,
            // visibility not provided - should use defaults
          });
          stateManagers[1].add(qt);
        }
      });

      const qt = new QuickTab({
        id: 'qt-partial-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers[0].add(qt);

      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        position: qt.position,
        size: qt.size,
        container: qt.container
        // No visibility data
      });

      await wait(100);

      const qtInB = stateManagers[1].get(qt.id);
      expect(qtInB).toBeDefined();
      expect(qtInB.visibility.soloedOnTabs).toEqual([]);
      expect(qtInB.visibility.mutedOnTabs).toEqual([]);
      expect(qtInB.visibility.minimized).toBe(false);
    });

    test('Quick Tab with invalid position values uses safe defaults', async () => {
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CREATE') {
          const qt = new QuickTab({
            id: message.data.id,
            url: message.data.url,
            position: {
              left: Number.isFinite(message.data.position?.left) ? message.data.position.left : 100,
              top: Number.isFinite(message.data.position?.top) ? message.data.position.top : 100
            },
            size: message.data.size,
            container: message.data.container
          });
          stateManagers[1].add(qt);
        }
      });

      await broadcastManagers[0].broadcast('CREATE', {
        id: 'qt-invalid-pos-1',
        url: 'https://example.com',
        position: { left: NaN, top: Infinity }, // Invalid values
        width: 800,
          height: 600 
      });

      await wait(100);

      const qt = stateManagers[1].get('qt-invalid-pos-1');
      expect(qt).toBeDefined();
      expect(qt.position.left).toBe(100); // default
      expect(qt.position.top).toBe(100); // default
    });
  });

  describe('State Consistency After Errors', () => {
    test('failed message processing does not corrupt state', async () => {
      // Create valid Quick Tab first
      const qt1 = new QuickTab({
        id: 'qt-valid-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers[0].add(qt1);
      stateManagers[1].add(new QuickTab({ ...qt1 }));

      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          try {
            const qt = stateManagers[1].get(message.data.id);
            if (qt) {
              // Simulate error during update
              if (message.data.id === 'qt-error-trigger') {
                throw new Error('Simulated processing error');
              }
              qt.position.left = message.data.left;
              qt.position.top = message.data.top;
              stateManagers[1].update(qt);
            }
          } catch (error) {
            // Error caught - state should remain consistent
            console.error('Update error:', error);
          }
        }
      });

      // Send update that triggers error
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: 'qt-error-trigger',
        left: 500,
        top: 500
      });

      await wait(100);

      // Send valid update
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt1.id,
        left: 200,
        top: 200
      });

      await wait(100);

      // Valid Quick Tab should still be updated correctly
      const qtInB = stateManagers[1].get(qt1.id);
      expect(qtInB.position.left).toBe(200);
      expect(qtInB.position.top).toBe(200);

      // State count should be correct
      expect(stateManagers[1].count()).toBe(1);
    });
  });

  describe('Broadcast Channel Resilience', () => {
    test('continues to function after invalid message received', async () => {
      const messagesReceived = [];

      eventBuses[1].on('broadcast:received', (message) => {
        messagesReceived.push(message.type);
        
        if (message.type === 'CREATE' && message.data) {
          const qt = new QuickTab({
            id: message.data.id,
            url: message.data.url || 'https://example.com',
            position: message.data.position || { left: 100, top: 100 },
            size: message.data.size || { width: 800, height: 600 },
            container: message.data.container || 'firefox-default'
          });
          stateManagers[1].add(qt);
        }
      });

      // Send invalid message
      await broadcastManagers[0].broadcast('INVALID_TYPE', {
        garbage: 'data'
      });

      await wait(50);

      // Send valid message
      await broadcastManagers[0].broadcast('CREATE', {
        id: 'qt-after-invalid',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        width: 800,
          height: 600 
      });

      await wait(100);

      // Valid message should still be processed
      expect(messagesReceived).toContain('INVALID_TYPE');
      expect(messagesReceived).toContain('CREATE');
      expect(stateManagers[1].get('qt-after-invalid')).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    test('empty message payload does not cause error', async () => {
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CREATE') {
          // Should handle missing data gracefully
          if (!message.data || !message.data.id) {
            return; // Skip invalid message
          }
        }
      });

      // broadcast() doesn't return a promise, so we just call it
      broadcastManagers[0].broadcast('CREATE', {});

      await wait(100);

      expect(stateManagers[1].count()).toBe(0);
    });

    test('null/undefined values in message handled gracefully', async () => {
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          const qt = stateManagers[1].get(message.data?.id);
          if (qt && message.data) {
            qt.position.left = message.data.left ?? qt.position.left;
            qt.position.top = message.data.top ?? qt.position.top;
            stateManagers[1].update(qt);
          }
        }
      });

      const qt = new QuickTab({
        id: 'qt-null-test-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers[0].add(qt);
      stateManagers[1].add(new QuickTab({ ...qt }));

      // Send update with null values
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: null,
        top: undefined
      });

      await wait(100);

      // Original position should be preserved (nullish coalescing)
      const qtInB = stateManagers[1].get(qt.id);
      expect(qtInB.position.left).toBe(100);
      expect(qtInB.position.top).toBe(100);
    });
  });
});
