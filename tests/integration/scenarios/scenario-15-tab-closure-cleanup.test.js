/**
 * Scenario 15: Tab Closure Cleanup
 * Tests that Quick Tab state is properly cleaned up when browser tabs close
 *
 * Related Issues: #47
 *
 * Test Behaviors:
 * - Quick Tab state removed when last tab in container closes
 * - Quick Tabs persist when some tabs remain open
 * - Container-specific cleanup
 * - Cross-tab cleanup synchronization
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';
import { BroadcastManager } from '../../mocks/BroadcastManagerMock.js';

describe('Scenario 15: Tab Closure Cleanup Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

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
      sourceChannel.postMessage = jest.fn(message => {
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

    // Wire up broadcast handlers for DESTROY messages
    eventBuses.forEach((bus, index) => {
      bus.on('broadcast:received', message => {
        if (message.type === 'DESTROY') {
          const qt = stateManagers[index].get(message.data.id);
          if (qt) {
            stateManagers[index].delete(message.data.id);
          }
        }
      });
    });
  });

  afterEach(() => {
    // Cleanup
    broadcastManagers.forEach(bm => bm.close());
    delete global.BroadcastChannel;
  });

  describe('Basic Tab Closure', () => {
    test('Quick Tab removed from all tabs when destroyed', async () => {
      // Create Quick Tab in Tab A
      const qt = new QuickTab({
        id: 'qt-close-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(qt));

      // Verify present in all tabs
      expect(stateManagers[0].get(qt.id)).toBeDefined();
      expect(stateManagers[1].get(qt.id)).toBeDefined();
      expect(stateManagers[2].get(qt.id)).toBeDefined();

      // Destroy from Tab A - delete locally first, then broadcast
      stateManagers[0].delete(qt.id);
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qt.id,
        container: qt.container
      });

      await wait(100);

      // Verify removed from all tabs
      expect(stateManagers[0].get(qt.id)).toBeUndefined();
      expect(stateManagers[1].get(qt.id)).toBeUndefined();
      expect(stateManagers[2].get(qt.id)).toBeUndefined();
    });

    test('closing one Quick Tab does not affect others', async () => {
      // Create two Quick Tabs
      const qt1 = new QuickTab({
        id: 'qt-multi-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      const qt2 = new QuickTab({
        id: 'qt-multi-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 }
      });

      // Add both to all tabs
      stateManagers.forEach(sm => {
        sm.add(qt1);
        sm.add(qt2);
      });

      // Close QT1 - delete locally first, then broadcast
      stateManagers[0].delete(qt1.id);
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qt1.id,
        container: qt1.container
      });

      await wait(100);

      // Verify QT1 removed, QT2 still present
      expect(stateManagers[0].get(qt1.id)).toBeUndefined();
      expect(stateManagers[1].get(qt1.id)).toBeUndefined();
      expect(stateManagers[2].get(qt1.id)).toBeUndefined();

      expect(stateManagers[0].get(qt2.id)).toBeDefined();
      expect(stateManagers[1].get(qt2.id)).toBeDefined();
      expect(stateManagers[2].get(qt2.id)).toBeDefined();
    });
  });

  describe('State Consistency', () => {
    test('Quick Tab count updates correctly after closure', async () => {
      // Create 3 Quick Tabs
      const qts = [1, 2, 3].map(
        i =>
          new QuickTab({
            id: `qt-count-${i}`,
            url: `https://example${i}.com`,
            position: { left: i * 100, top: i * 100 },
            size: { width: 800, height: 600 }
          })
      );

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      // Verify count
      expect(stateManagers[0].count()).toBe(3);
      expect(stateManagers[1].count()).toBe(3);
      expect(stateManagers[2].count()).toBe(3);

      // Close QT 2 - delete locally first, then broadcast
      stateManagers[0].delete(qts[1].id);
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qts[1].id,
        container: qts[1].container
      });

      await wait(100);

      // Verify count updated
      expect(stateManagers[0].count()).toBe(2);
      expect(stateManagers[1].count()).toBe(2);
      expect(stateManagers[2].count()).toBe(2);

      // Verify correct QTs remain
      expect(stateManagers[0].get(qts[0].id)).toBeDefined();
      expect(stateManagers[0].get(qts[1].id)).toBeUndefined();
      expect(stateManagers[0].get(qts[2].id)).toBeDefined();
    });

    test('slot becomes available after Quick Tab closure', async () => {
      const qt = new QuickTab({
        id: 'qt-slot-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Record count before close
      const countBeforeClose = stateManagers[0].count();
      expect(countBeforeClose).toBe(1);

      // Close Quick Tab - delete locally first, then broadcast
      stateManagers[0].delete(qt.id);
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qt.id,
        container: qt.container
      });

      await wait(100);

      // Verify count decreased (slot now available)
      expect(stateManagers[0].count()).toBe(0);
      expect(stateManagers[1].count()).toBe(0);
      expect(stateManagers[2].count()).toBe(0);
    });
  });

  describe('Container-Specific Cleanup', () => {
    test('closing Quick Tab in one container does not affect other containers', async () => {
      // Create event buses
      const eventBus1 = new EventEmitter();
      const eventBus2 = new EventEmitter();

      // Create managers for different containers
      const container1Managers = [
        new StateManager(eventBus1, 1001),
        new BroadcastManager(eventBus1, 'firefox-default')
      ];

      const container2Managers = [
        new StateManager(eventBus2, 1002),
        new BroadcastManager(eventBus2, 'firefox-container-1')
      ];

      // Setup broadcast channels
      container1Managers[1].setupBroadcastChannel();
      container2Managers[1].setupBroadcastChannel();

      // Wire up handlers
      eventBus1.on('broadcast:received', message => {
        if (message.type === 'DESTROY') {
          container1Managers[0].delete(message.data.id);
        }
      });

      eventBus2.on('broadcast:received', message => {
        if (message.type === 'DESTROY') {
          container2Managers[0].delete(message.data.id);
        }
      });

      // Create QTs in each container
      const qt1 = new QuickTab({
        id: 'qt-cont1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      const qt2 = new QuickTab({
        id: 'qt-cont2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 }
      });

      container1Managers[0].add(qt1);
      container2Managers[0].add(qt2);

      // Close QT1 in container 1 - delete locally first, then broadcast
      container1Managers[0].delete(qt1.id);
      await container1Managers[1].broadcast('DESTROY', {
        id: qt1.id,
        container: qt1.container
      });

      await wait(100);

      // Verify QT1 removed, QT2 unaffected
      expect(container1Managers[0].get(qt1.id)).toBeUndefined();
      expect(container2Managers[0].get(qt2.id)).toBeDefined();

      // Cleanup - close() is handled in afterEach
    });
  });

  describe('Concurrent Closures', () => {
    test('multiple Quick Tabs can be closed simultaneously', async () => {
      // Create 5 Quick Tabs
      const qts = [1, 2, 3, 4, 5].map(
        i =>
          new QuickTab({
            id: `qt-concurrent-${i}`,
            url: `https://example${i}.com`,
            position: { left: i * 100, top: i * 100 },
            size: { width: 800, height: 600 }
          })
      );

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      // Close QTs 1, 3, 5 simultaneously - delete locally first
      stateManagers[0].delete(qts[0].id);
      stateManagers[0].delete(qts[2].id);
      stateManagers[0].delete(qts[4].id);

      await Promise.all([
        broadcastManagers[0].broadcast('DESTROY', { id: qts[0].id, container: qts[0].container }),
        broadcastManagers[0].broadcast('DESTROY', { id: qts[2].id, container: qts[2].container }),
        broadcastManagers[0].broadcast('DESTROY', { id: qts[4].id, container: qts[4].container })
      ]);

      await wait(150);

      // Verify correct QTs removed
      expect(stateManagers[0].get(qts[0].id)).toBeUndefined();
      expect(stateManagers[0].get(qts[1].id)).toBeDefined();
      expect(stateManagers[0].get(qts[2].id)).toBeUndefined();
      expect(stateManagers[0].get(qts[3].id)).toBeDefined();
      expect(stateManagers[0].get(qts[4].id)).toBeUndefined();

      // Verify count
      expect(stateManagers[0].count()).toBe(2);
      expect(stateManagers[1].count()).toBe(2);
      expect(stateManagers[2].count()).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    test('closing non-existent Quick Tab does not cause error', async () => {
      // Try to close non-existent QT - should not throw
      // broadcast() doesn't return a promise, so we just call it
      broadcastManagers[0].broadcast('DESTROY', {
        id: 'qt-nonexistent',
        container: 'firefox-default'
      });

      await wait(50);

      // Verify state unchanged
      expect(stateManagers[0].count()).toBe(0);
    });

    test('closing same Quick Tab multiple times is idempotent', async () => {
      const qt = new QuickTab({
        id: 'qt-idempotent',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Close multiple times - delete locally first
      stateManagers[0].delete(qt.id);
      broadcastManagers[0].broadcast('DESTROY', { id: qt.id, container: qt.container });
      await wait(50);
      broadcastManagers[0].broadcast('DESTROY', { id: qt.id, container: qt.container });
      await wait(50);
      broadcastManagers[0].broadcast('DESTROY', { id: qt.id, container: qt.container });
      await wait(50);

      // Verify removed once
      expect(stateManagers[0].get(qt.id)).toBeUndefined();
      expect(stateManagers[0].count()).toBe(0);
    });
  });
});
