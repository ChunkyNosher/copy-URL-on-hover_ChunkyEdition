/**
 * Scenario 17: Concurrent Tab Updates
 * Tests that concurrent updates from multiple tabs are handled correctly without race conditions
 *
 * Related Issues: #51 (position not transferring between tabs)
 *
 * Test Behaviors:
 * - Multiple tabs updating simultaneously don't cause race conditions
 * - Last update wins when conflicts occur
 * - State remains consistent across all tabs
 * - No data loss during concurrent operations
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';
import { BroadcastManager } from '../../mocks/BroadcastManagerMock.js';

describe('Scenario 17: Concurrent Tab Updates Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 5 simulated tabs
    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://github.com', containerId: 'firefox-default' },
      { url: 'https://youtube.com', containerId: 'firefox-default' },
      { url: 'https://twitter.com', containerId: 'firefox-default' },
      { url: 'https://reddit.com', containerId: 'firefox-default' }
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
        if (message.type === 'UPDATE_POSITION') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.updatePosition(message.data.left, message.data.top);
          }
        } else if (message.type === 'UPDATE_SIZE') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.updateSize(message.data.width, message.data.height);
          }
        } else if (message.type === 'CREATE') {
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
        }
      });
    });
  });

  afterEach(() => {
    // Cleanup
    broadcastManagers.forEach(bm => bm.close());
    stateManagers.forEach(sm => sm.quickTabs.clear());
    delete global.BroadcastChannel;
  });

  describe('Concurrent Position Updates', () => {
    test('5 tabs updating same Quick Tab position simultaneously', async () => {
      const qt = new QuickTab({
        id: 'qt-concurrent-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(qt));

      // Each tab updates position simultaneously
      const updates = stateManagers.map((sm, index) => {
        const qtInTab = sm.get(qt.id);
        const newLeft = (index + 1) * 100;
        const newTop = (index + 1) * 100;
        qtInTab.updatePosition(newLeft, newTop);
        return broadcastManagers[index].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: newLeft,
          top: newTop 
        });
      });

      await Promise.all(updates);
      await wait(200);

      // Verify all tabs have consistent state (last update should win)
      const positions = stateManagers.map(sm => sm.get(qt.id).position);
      const firstPos = positions[0];

      // All tabs should have same position
      positions.forEach(pos => {
        expect(pos.left).toBe(firstPos.left);
        expect(pos.top).toBe(firstPos.top);
      });

      // Position should be one of the broadcast values
      const validPositions = [100, 200, 300, 400, 500];
      expect(validPositions).toContain(firstPos.left);
    });

    test('different tabs updating different Quick Tabs simultaneously', async () => {
      // Create 5 Quick Tabs
      const qts = [1, 2, 3, 4, 5].map(i =>
        new QuickTab({
          id: `qt-multi-${i}`,
          url: `https://example${i}.com`,
          position: { left: i * 50, top: i * 50 },
          size: { width: 800, height: 600 }
        })
      );

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      // Each tab updates a different Quick Tab
      const updates = qts.map((qt, index) => {
        const qtInTab = stateManagers[index].get(qt.id);
        qtInTab.updatePosition(1000 + index * 100, 1000 + index * 100);
        return broadcastManagers[index].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 1000 + index * 100,
          top: 1000 + index * 100 
        });
      });

      await Promise.all(updates);
      await wait(200);

      // Verify all updates applied correctly
      qts.forEach((qt, index) => {
        const expectedLeft = 1000 + index * 100;
        const expectedTop = 1000 + index * 100;

        stateManagers.forEach(sm => {
          const qtInTab = sm.get(qt.id);
          expect(qtInTab.position.left).toBe(expectedLeft);
          expect(qtInTab.position.top).toBe(expectedTop);
        });
      });
    });
  });

  describe('Concurrent Size Updates', () => {
    test('multiple tabs resizing same Quick Tab simultaneously', async () => {
      const qt = new QuickTab({
        id: 'qt-resize-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Each tab updates size simultaneously
      const updates = stateManagers.map((sm, index) => {
        const qtInTab = sm.get(qt.id);
        const newWidth = 700 + index * 50;
        const newHeight = 500 + index * 50;
        qtInTab.updateSize(newWidth, newHeight);
        return broadcastManagers[index].broadcast('UPDATE_SIZE', {
          id: qt.id,
          width: newWidth,
          height: newHeight 
        });
      });

      await Promise.all(updates);
      await wait(200);

      // Verify all tabs have consistent state
      const sizes = stateManagers.map(sm => sm.get(qt.id).size);
      const firstSize = sizes[0];

      // All tabs should have same size
      sizes.forEach(size => {
        expect(size.width).toBe(firstSize.width);
        expect(size.height).toBe(firstSize.height);
      });

      // Size should be one of the broadcast values
      const validWidths = [700, 750, 800, 850, 900];
      expect(validWidths).toContain(firstSize.width);
    });
  });

  describe('Mixed Concurrent Operations', () => {
    test('concurrent position and size updates from different tabs', async () => {
      const qt = new QuickTab({
        id: 'qt-mixed-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Tab 0 and 1: position updates
      // Tab 2 and 3: size updates
      // Tab 4: both position and size
      const updates = [];

      // Tab 0: position
      stateManagers[0].get(qt.id).updatePosition(200, 200);
      updates.push(
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 200,
          top: 200 
        })
      );

      // Tab 1: position
      stateManagers[1].get(qt.id).updatePosition(300, 300);
      updates.push(
        broadcastManagers[1].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 300,
          top: 300 
        })
      );

      // Tab 2: size
      stateManagers[2].get(qt.id).updateSize(900, 700);
      updates.push(
        broadcastManagers[2].broadcast('UPDATE_SIZE', {
          id: qt.id,
          width: 900,
          height: 700 
        })
      );

      // Tab 3: size
      stateManagers[3].get(qt.id).updateSize(1000, 800);
      updates.push(
        broadcastManagers[3].broadcast('UPDATE_SIZE', {
          id: qt.id,
          width: 1000,
          height: 800 
        })
      );

      // Tab 4: both
      stateManagers[4].get(qt.id).updatePosition(400, 400);
      stateManagers[4].get(qt.id).updateSize(1100, 900);
      updates.push(
        broadcastManagers[4].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 400,
          top: 400 
        })
      );
      updates.push(
        broadcastManagers[4].broadcast('UPDATE_SIZE', {
          id: qt.id,
          width: 1100,
          height: 900 
        })
      );

      await Promise.all(updates);
      await wait(250);

      // Verify all tabs have consistent state
      const positions = stateManagers.map(sm => sm.get(qt.id).position);
      const sizes = stateManagers.map(sm => sm.get(qt.id).size);

      // All tabs should have same position
      positions.forEach(pos => {
        expect(pos.left).toBe(positions[0].left);
        expect(pos.top).toBe(positions[0].top);
      });

      // All tabs should have same size
      sizes.forEach(size => {
        expect(size.width).toBe(sizes[0].width);
        expect(size.height).toBe(sizes[0].height);
      });

      // Values should be one of the broadcast values
      const validLefts = [200, 300, 400];
      const validWidths = [900, 1000, 1100];
      expect(validLefts).toContain(positions[0].left);
      expect(validWidths).toContain(sizes[0].width);
    });
  });

  describe('Concurrent Creation', () => {
    test('multiple tabs creating Quick Tabs simultaneously', async () => {
      // Each tab creates a different Quick Tab
      // First add to local state, then broadcast
      const creations = [1, 2, 3, 4, 5].map((i, index) => {
        const qtData = {
          id: `qt-create-${i}`,
          url: `https://example${i}.com`,
          position: { left: i * 100, top: i * 100 },
          size: { width: 800, height: 600 }
        };
        
        // Add to creating tab's state first
        const qt = new QuickTab(qtData);
        stateManagers[index].add(qt);
        
        // Then broadcast to other tabs (use flat schema)
        return broadcastManagers[index].broadcast('CREATE', {
          id: qtData.id,
          url: qtData.url,
          left: qtData.position.left,
          top: qtData.position.top,
          width: qtData.size.width,
          height: qtData.size.height
        });
      });

      await Promise.all(creations);
      await wait(200);

      // Verify all Quick Tabs created in all tabs
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(5);
        for (let i = 1; i <= 5; i++) {
          expect(sm.get(`qt-create-${i}`)).toBeDefined();
        }
      });
    });

    test('same Quick Tab created from multiple tabs (idempotency)', async () => {
      const qtData = {
        id: 'qt-idempotent-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600 
      };

      // All tabs try to create the same Quick Tab
      const creations = broadcastManagers.map(bm =>
        bm.broadcast('CREATE', qtData)
      );

      await Promise.all(creations);
      await wait(200);

      // Verify Quick Tab exists once in each tab
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(1);
        expect(sm.get(qtData.id)).toBeDefined();
      });
    });
  });

  describe('State Consistency Under Load', () => {
    test('50 concurrent updates maintain state consistency', async () => {
      // Create 10 Quick Tabs
      const qts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i =>
        new QuickTab({
          id: `qt-load-${i}`,
          url: `https://example${i}.com`,
          position: { left: i * 50, top: i * 50 },
          size: { width: 800, height: 600 }
        })
      );

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      // Perform 50 concurrent updates (10 QTs × 5 tabs)
      const updates = [];
      qts.forEach((qt, qtIndex) => {
        stateManagers.forEach((sm, tabIndex) => {
          const qtInTab = sm.get(qt.id);
          const newLeft = 1000 + qtIndex * 100 + tabIndex * 10;
          const newTop = 1000 + qtIndex * 100 + tabIndex * 10;
          qtInTab.updatePosition(newLeft, newTop);
          updates.push(
            broadcastManagers[tabIndex].broadcast('UPDATE_POSITION', {
              id: qt.id,
              left: newLeft,
          top: newTop 
            })
          );
        });
      });

      await Promise.all(updates);
      await wait(300);

      // Verify all Quick Tabs still exist
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(10);
        qts.forEach(qt => {
          expect(sm.get(qt.id)).toBeDefined();
        });
      });

      // Verify state consistency (all tabs have same positions for each QT)
      qts.forEach(qt => {
        const positions = stateManagers.map(sm => sm.get(qt.id).position);
        const firstPos = positions[0];

        positions.forEach(pos => {
          expect(pos.left).toBe(firstPos.left);
          expect(pos.top).toBe(firstPos.top);
        });
      });
    });
  });

  describe('Edge Cases', () => {
    test('concurrent updates do not create duplicate Quick Tabs', async () => {
      const qt = new QuickTab({
        id: 'qt-dup-test-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      // Add to first tab only
      stateManagers[0].add(qt);

      // First tab broadcasts CREATE
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        left: qt.position.left,
        top: qt.position.top,
        width: qt.size.width,
        height: qt.size.height
      });

      // Before propagation completes, multiple tabs try to update
      const updates = stateManagers.map((sm, index) => {
        if (index === 0) {
          // Skip first tab (already has QT)
          return Promise.resolve();
        }
        return broadcastManagers[index].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 200 + index * 50,
          top: 200 + index * 50 
        });
      });

      await Promise.all(updates);
      await wait(200);

      // Verify no duplicate Quick Tabs created
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(1);
        expect(sm.get(qt.id)).toBeDefined();
      });
    });

    test('concurrent operations complete without errors', async () => {
      const qt = new QuickTab({
        id: 'qt-error-test-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 }
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Mix of valid and potentially problematic operations
      const operations = [];

      // Valid updates
      operations.push(
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 200,
          top: 200 
        })
      );

      // Updates to non-existent QT (should not cause error)
      operations.push(
        broadcastManagers[1].broadcast('UPDATE_POSITION', {
          id: 'qt-nonexistent',
          left: 300,
          top: 300 
        })
      );

      // More valid updates
      operations.push(
        broadcastManagers[2].broadcast('UPDATE_SIZE', {
          id: qt.id,
          width: 900,
          height: 700 
        })
      );

      // Should all resolve without throwing
      await expect(Promise.all(operations)).resolves.not.toThrow();

      await wait(150);

      // Valid Quick Tab should still exist
      expect(stateManagers[0].get(qt.id)).toBeDefined();
      expect(stateManagers[0].count()).toBe(1);
    });
  });
});
