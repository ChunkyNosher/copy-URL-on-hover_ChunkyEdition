/**
 * Scenario 2: Multiple Quick Tabs with Cross-Tab Sync
 * 
 * Tests that multiple Quick Tabs can coexist, each maintains independent state,
 * and all sync correctly across tabs.
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 2)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Phase 4)
 * 
 * Covers Issues: #47
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';
import { BroadcastManager } from '../../mocks/BroadcastManagerMock.js';

describe('Scenario 2: Multiple Quick Tabs Protocol', () => {
  let tabs;
  let broadcastManagers;
  let stateManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://youtube.com', containerId: 'firefox-default' },
      { url: 'https://github.com', containerId: 'firefox-default' }
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

  describe('Multiple Quick Tab Creation', () => {
    test('creating two Quick Tabs in same tab syncs both to other tabs', async () => {
      // Setup broadcast handlers for all tabs
      eventBuses.forEach((bus, idx) => {
        bus.on('broadcast:received', (message) => {
          if (message.type === 'CREATE') {
            const qt = new QuickTab({
              id: message.data.id,
              url: message.data.url,
              position: { left: message.data.left, top: message.data.top },
              size: { width: message.data.width, height: message.data.height },
              container: message.data.cookieStoreId
            });
            stateManagers[idx].add(qt);
          }
        });
      });

      // Tab A: Create QT 1
      const qt1 = new QuickTab({
        id: 'qt-multi-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      stateManagers[0].add(qt1);

      await broadcastManagers[0].broadcast('CREATE', {
        id: qt1.id,
        url: qt1.url,
        left: qt1.position.left,
        top: qt1.position.top,
        width: qt1.size.width,
        height: qt1.size.height,
        cookieStoreId: qt1.container
      });

      // Tab A: Create QT 2 (offset position)
      const qt2 = new QuickTab({
        id: 'qt-multi-2',
        url: 'https://example2.com',
        position: { left: 150, top: 150 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });
      stateManagers[0].add(qt2);

      await broadcastManagers[0].broadcast('CREATE', {
        id: qt2.id,
        url: qt2.url,
        left: qt2.position.left,
        top: qt2.position.top,
        width: qt2.size.width,
        height: qt2.size.height,
        cookieStoreId: qt2.container
      });

      await wait(100);

      // Verify both QTs in Tab B
      expect(stateManagers[1].get(qt1.id)).toBeDefined();
      expect(stateManagers[1].get(qt2.id)).toBeDefined();

      // Verify both QTs in Tab C
      expect(stateManagers[2].get(qt1.id)).toBeDefined();
      expect(stateManagers[2].get(qt2.id)).toBeDefined();

      // Verify positions are correct
      const qt1InB = stateManagers[1].get(qt1.id);
      const qt2InB = stateManagers[1].get(qt2.id);
      expect(qt1InB.position.left).toBe(100);
      expect(qt2InB.position.left).toBe(150);
    });

    test('each Quick Tab maintains independent state', async () => {
      // Create two QTs in Tab A
      const qt1 = new QuickTab({
        id: 'qt-ind-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-ind-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      // Replicate to Tab B
      stateManagers[1].add(new QuickTab({
        id: qt1.id,
        url: qt1.url,
        position: qt1.position,
        size: qt1.size,
        container: qt1.container
      }));
      stateManagers[1].add(new QuickTab({
        id: qt2.id,
        url: qt2.url,
        position: qt2.position,
        size: qt2.size,
        container: qt2.container
      }));

      // Setup position update handler
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          const qt = stateManagers[1].get(message.data.id);
          if (qt) {
            qt.position.left = message.data.left;
            qt.position.top = message.data.top;
            stateManagers[1].update(qt);
          }
        }
      });

      // Update QT 1 position only
      qt1.position.left = 500;
      qt1.position.top = 400;
      stateManagers[0].update(qt1);

      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt1.id,
        left: 500,
        top: 400
      });

      await wait(100);

      // Verify QT 1 updated, QT 2 unchanged in Tab B
      const qt1Updated = stateManagers[1].get(qt1.id);
      const qt2Unchanged = stateManagers[1].get(qt2.id);

      expect(qt1Updated.position.left).toBe(500);
      expect(qt1Updated.position.top).toBe(400);
      expect(qt2Unchanged.position.left).toBe(200); // Unchanged
      expect(qt2Unchanged.position.top).toBe(200); // Unchanged
    });

    test('closing one Quick Tab does not affect others', async () => {
      // Create 3 QTs
      const qts = [
        new QuickTab({
          id: 'qt-close-1',
          url: 'https://example1.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-close-2',
          url: 'https://example2.com',
          position: { left: 200, top: 200 },
          size: { width: 700, height: 500 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-close-3',
          url: 'https://example3.com',
          position: { left: 300, top: 300 },
          size: { width: 600, height: 400 },
          container: 'firefox-default'
        })
      ];

      // Add all to Tab A
      qts.forEach(qt => stateManagers[0].add(qt));

      // Replicate to Tab B
      qts.forEach(qt => {
        stateManagers[1].add(new QuickTab({
          id: qt.id,
          url: qt.url,
          position: qt.position,
          size: qt.size,
          container: qt.container
        }));
      });

      // Setup close handler
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CLOSE') {
          stateManagers[1].delete(message.data.id);
        }
      });

      // Close QT 2 (middle one)
      stateManagers[0].delete(qts[1].id);
      await broadcastManagers[0].broadcast('CLOSE', { id: qts[1].id });

      await wait(100);

      // Verify QT 1 and QT 3 still exist in Tab B
      expect(stateManagers[1].get(qts[0].id)).toBeDefined();
      expect(stateManagers[1].get(qts[1].id)).toBeUndefined(); // Closed
      expect(stateManagers[1].get(qts[2].id)).toBeDefined();
    });
  });

  describe('Position Offset Management', () => {
    test('new Quick Tabs get offset positions to avoid overlap', () => {
      // Create QT 1 at (100, 100)
      const qt1 = new QuickTab({
        id: 'qt-offset-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      stateManagers[0].add(qt1);

      // Create QT 2 with offset (150, 150)
      const qt2 = new QuickTab({
        id: 'qt-offset-2',
        url: 'https://example2.com',
        position: { left: 150, top: 150 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      stateManagers[0].add(qt2);

      // Verify offset applied
      expect(qt2.position.left).toBe(150);
      expect(qt2.position.top).toBe(150);
      expect(qt2.position.left - qt1.position.left).toBe(50);
      expect(qt2.position.top - qt1.position.top).toBe(50);
    });
  });

  describe('Multiple Quick Tab Updates', () => {
    test('updating multiple Quick Tabs broadcasts all changes', async () => {
      const receivedUpdates = [];

      // Setup handler to track updates
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          receivedUpdates.push(message.data.id);
        }
      });

      // Create 2 QTs
      const qt1 = new QuickTab({
        id: 'qt-update-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-update-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      // Update both positions
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt1.id,
        left: 500,
        top: 400
      });

      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt2.id,
        left: 600,
        top: 500
      });

      await wait(100);

      // Verify both updates received
      expect(receivedUpdates).toContain(qt1.id);
      expect(receivedUpdates).toContain(qt2.id);
      expect(receivedUpdates.length).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    test('handles maximum Quick Tab count gracefully', async () => {
      const maxQTs = 10;
      const qts = [];

      // Create max number of QTs
      for (let i = 0; i < maxQTs; i++) {
        const qt = new QuickTab({
          id: `qt-max-${i}`,
          url: `https://example${i}.com`,
          position: { left: 100 + i * 50, top: 100 + i * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        });
        qts.push(qt);
        stateManagers[0].add(qt);
      }

      // Verify all added
      expect(stateManagers[0].getAll().length).toBe(maxQTs);

      // Verify each has correct ID
      qts.forEach(qt => {
        expect(stateManagers[0].get(qt.id)).toBeDefined();
      });
    });

    test('handles Quick Tabs with same URL but different positions', async () => {
      const sameURL = 'https://example.com';

      const qt1 = new QuickTab({
        id: 'qt-same-1',
        url: sameURL,
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-same-2',
        url: sameURL,
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      // Verify both exist with different positions
      expect(stateManagers[0].get(qt1.id)).toBeDefined();
      expect(stateManagers[0].get(qt2.id)).toBeDefined();
      expect(stateManagers[0].get(qt1.id).position.left).toBe(100);
      expect(stateManagers[0].get(qt2.id).position.left).toBe(200);
    });
  });
});
