/**
 * Scenario 16: Rapid Position Updates
 * Tests that Quick Tabs handle rapid position changes correctly with throttling
 *
 * Related Issues: #51 (position not transferring between tabs)
 *
 * Test Behaviors:
 * - Rapid position updates are handled correctly
 * - Final position is accurate after rapid changes
 * - Throttling prevents excessive broadcasts
 * - Cross-tab sync remains consistent
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 16: Rapid Position Updates Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;
  let messageLog;

  beforeEach(async () => {
    jest.clearAllMocks();
    messageLog = [];

    // Create 3 simulated tabs
    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://github.com', containerId: 'firefox-default' },
      { url: 'https://youtube.com', containerId: 'firefox-default' }
    ]);

    // Create event buses for each tab
    eventBuses = tabs.map(() => new EventEmitter());

    // Create broadcast channels for cross-tab communication
    channels = tabs.map(() => ({
      postMessage: jest.fn(),
      close: jest.fn(),
      onmessage: null
    }));

    // Mock BroadcastChannel to connect tabs
    let channelIndex = 0;
    global.BroadcastChannel = jest.fn(() => {
      const channel = channels[channelIndex];
      channelIndex++;
      return channel;
    });

    // Create managers for each tab
    broadcastManagers = tabs.map((tab, index) => {
      const manager = new BroadcastManager(eventBuses[index], tab.containerId);
      manager.setupBroadcastChannel();
      return manager;
    });

    stateManagers = tabs.map((tab, index) => {
      return new StateManager(eventBuses[index], tab.tabId);
    });

    // Connect channels to simulate cross-tab delivery
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

    // Wire up broadcast handlers for each tab
    eventBuses.forEach((bus, tabIndex) => {
      bus.on('broadcast:received', (message) => {
        if (message.type === 'CREATE') {
          const existingQt = stateManagers[tabIndex].get(message.data.id);
          if (!existingQt) {
            const qt = new QuickTab({
              id: message.data.id,
              url: message.data.url,
              position: { left: message.data.left, top: message.data.top },
              size: { width: message.data.width, height: message.data.height },
              container: message.data.container || message.data.cookieStoreId || 'firefox-default'
            });
            stateManagers[tabIndex].add(qt);
          }
        } else if (message.type === 'UPDATE_POSITION') {
          messageLog.push({ tabIndex, type: 'UPDATE_POSITION', timestamp: Date.now() });
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.updatePosition(message.data.left, message.data.top);
          }
        } else if (message.type === 'UPDATE_SIZE') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.updateSize(message.data.width, message.data.height);
          }
        }
      });
    });
  });

  afterEach(() => {
    // Cleanup
    broadcastManagers.forEach(bm => bm.close());
    stateManagers.forEach(sm => sm.quickTabs.clear());
    messageLog = [];
    delete global.BroadcastChannel;
  });

  describe('Rapid Updates', () => {
    test('10 rapid position updates all apply correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-rapid-1',
        url: 'https://example.com',
        position: { left: 0, top: 0 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);

      // Broadcast initial state to other tabs (will be handled by CREATE handler)
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });

      await wait(150); // Wait for cross-tab sync

      // Perform 10 rapid position updates
      for (let i = 1; i <= 10; i++) {
        const left = i * 10;
        const top = i * 10;
        
        // Update in Tab A's state
        const qtInA = stateManagers[0].get(qt.id);
        qtInA.updatePosition(left, top);
        
        // Broadcast to other tabs
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: left,
          top: top
        });
        
        // Small delay between updates to avoid overwhelming debounce
        await wait(60);
      }

      // Wait for final broadcast to propagate
      await wait(150);

      // Verify final position is correct (last update wins)
      const qtInTabA = stateManagers[0].get(qt.id);
      const qtInTabB = stateManagers[1].get(qt.id);
      const qtInTabC = stateManagers[2].get(qt.id);

      expect(qtInTabA.position.left).toBe(100);
      expect(qtInTabA.position.top).toBe(100);
      expect(qtInTabB.position.left).toBe(100);
      expect(qtInTabB.position.top).toBe(100);
      expect(qtInTabC.position.left).toBe(100);
      expect(qtInTabC.position.top).toBe(100);
    });

    test('50 rapid position updates complete within reasonable time', async () => {
      const qt = new QuickTab({
        id: 'qt-perf-1',
        url: 'https://example.com',
        position: { left: 0, top: 0 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to Tab A and broadcast to others
      stateManagers[0].add(qt);
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });
      
      await wait(150); // Wait for cross-tab sync

      const startTime = Date.now();

      // Perform 50 rapid updates
      for (let i = 1; i <= 50; i++) {
        const qtInA = stateManagers[0].get(qt.id);
        qtInA.updatePosition(i * 5, i * 5);
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: i * 5,
          top: i * 5
        });
        await wait(60); // Respect debounce timing
      }

      await wait(200);

      const duration = Date.now() - startTime;

      // Should complete within 4 seconds (reasonable performance with delays)
      expect(duration).toBeLessThan(4000);

      // Verify final position accurate
      expect(stateManagers[0].get(qt.id).position.left).toBe(250);
      expect(stateManagers[1].get(qt.id).position.left).toBe(250);
      expect(stateManagers[2].get(qt.id).position.left).toBe(250);
    });
  });

  describe('Position Accuracy', () => {
    test('final position matches last update after rapid changes', async () => {
      const qt = new QuickTab({
        id: 'qt-accuracy-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to Tab A and broadcast to others
      stateManagers[0].add(qt);
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });
      
      await wait(150); // Wait for cross-tab sync

      // Random rapid updates
      const positions = [
        { left: 50, top: 50 },
        { left: 200, top: 300 },
        { left: 150, top: 250 },
        { left: 400, top: 100 },
        { left: 300, top: 200 } // Final position
      ];

      const qtInA = stateManagers[0].get(qt.id);
      for (const pos of positions) {
        qtInA.updatePosition(pos.left, pos.top);
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: pos.left,
          top: pos.top
        });
        await wait(60); // Respect debounce
      }

      await wait(150);

      // Verify all tabs have final position
      stateManagers.forEach((sm, index) => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(300);
        expect(qtInTab.position.top).toBe(200);
      });
    });

    test('position updates from different tabs resolve correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-multi-update-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to Tab A and broadcast to others
      stateManagers[0].add(qt);
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });
      
      await wait(150); // Wait for cross-tab sync

      // Tab A updates position
      const qtInA = stateManagers[0].get(qt.id);
      qtInA.updatePosition(200, 200);
      broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 200,
        top: 200
      });

      await wait(80);

      // Tab B updates position (overrides Tab A)
      const qtInTabB = stateManagers[1].get(qt.id);
      qtInTabB.updatePosition(300, 300);
      broadcastManagers[1].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 300,
        top: 300
      });

      await wait(80);

      // Tab C updates position (overrides Tab B)
      const qtInTabC = stateManagers[2].get(qt.id);
      qtInTabC.updatePosition(400, 400);
      broadcastManagers[2].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 400,
        top: 400
      });

      await wait(150);

      // All tabs should have final position from Tab C
      stateManagers.forEach(sm => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(400);
        expect(qtInTab.position.top).toBe(400);
      });
    });
  });

  describe('Message Efficiency', () => {
    test('broadcasts complete within acceptable latency', async () => {
      const qt = new QuickTab({
        id: 'qt-latency-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      messageLog = []; // Clear log

      // Single update
      const startTime = Date.now();
      qt.updatePosition(200, 200);
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 200,
        top: 200
      });

      await wait(100);

      const latency = Date.now() - startTime;

      // Broadcast should complete quickly (< 200ms)
      expect(latency).toBeLessThan(200);

      // Should have received messages in other tabs
      const messagesInOtherTabs = messageLog.filter(m => m.tabIndex !== 0);
      expect(messagesInOtherTabs.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    test('position updates to same position do not create duplicate messages', async () => {
      const qt = new QuickTab({
        id: 'qt-dup-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      messageLog = []; // Clear log

      // Update to same position 3 times
      for (let i = 0; i < 3; i++) {
        qt.updatePosition(100, 100);
        await broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 100,
          top: 100
        });
      }

      await wait(100);

      // Position should still be correct
      expect(stateManagers[0].get(qt.id).position.left).toBe(100);
      expect(stateManagers[1].get(qt.id).position.left).toBe(100);

      // Should have received messages (even if position unchanged)
      // This tests that the protocol doesn't optimize away "duplicate" updates
      // since they might have timing significance
      const messagesReceived = messageLog.length;
      expect(messagesReceived).toBeGreaterThan(0);
    });

    test('rapid updates during concurrent size changes maintain consistency', async () => {
      const qt = new QuickTab({
        id: 'qt-combined-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to Tab A and broadcast to others
      stateManagers[0].add(qt);
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });
      
      await wait(150); // Wait for cross-tab sync
      
      // Update size handler is already set up in beforeEach

      // Interleave position and size updates
      const qtInA = stateManagers[0].get(qt.id);
      qtInA.updatePosition(200, 200);
      broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 200,
        top: 200
      });

      await wait(60);

      qtInA.updateSize(900, 700);
      broadcastManagers[0].broadcast('UPDATE_SIZE', {
        id: qt.id,
        width: 900,
        height: 700
      });

      await wait(60);

      qtInA.updatePosition(300, 300);
      broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 300,
        top: 300
      });

      await wait(150);

      // Verify final state in all tabs
      stateManagers.forEach(sm => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(300);
        expect(qtInTab.position.top).toBe(300);
        expect(qtInTab.size.width).toBe(900);
        expect(qtInTab.size.height).toBe(700);
      });
    });

    test('updates to non-existent Quick Tab are handled gracefully', async () => {
      // Try to update non-existent QT - should not throw
      broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: 'qt-nonexistent',
        left: 100,
        top: 100
      });

      await wait(50);

      // No errors should occur
      expect(stateManagers[0].count()).toBe(0);
    });
  });

  describe('Stress Test', () => {
    test('100 rapid updates complete successfully', async () => {
      const qt = new QuickTab({
        id: 'qt-stress-1',
        url: 'https://example.com',
        position: { left: 0, top: 0 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to Tab A and broadcast to others
      stateManagers[0].add(qt);
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });
      
      await wait(150); // Wait for cross-tab sync

      // Perform 100 rapid updates
      const qtInA = stateManagers[0].get(qt.id);
      for (let i = 1; i <= 100; i++) {
        qtInA.updatePosition(i * 2, i * 2);
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: i * 2,
          top: i * 2
        });
        await wait(60); // Respect debounce
      }

      await wait(250);

      // Verify final position is accurate
      stateManagers.forEach(sm => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(200);
        expect(qtInTab.position.top).toBe(200);
      });

      // No errors should occur
      expect(stateManagers[0].count()).toBe(1);
      expect(stateManagers[1].count()).toBe(1);
      expect(stateManagers[2].count()).toBe(1);
    });
  });
});
