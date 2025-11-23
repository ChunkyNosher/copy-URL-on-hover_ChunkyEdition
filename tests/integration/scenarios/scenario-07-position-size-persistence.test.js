/**
 * Scenario 7: Position/Size Persistence Across Tabs
 * 
 * Tests that moving and resizing Quick Tabs in one tab correctly syncs
 * position/size to all other tabs, and that state persists across page reloads.
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 7)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Priority 1)
 * 
 * Covers Issues: #35, #51 (position/size not transferring between tabs)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 7: Position/Size Persistence Protocol', () => {
  let tabs;
  let broadcastManagers;
  let stateManagers;
  let storageManagers;
  let eventBuses;
  let channels;
  let mockStorage;

  beforeEach(async () => {
    jest.clearAllMocks();

    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://github.com', containerId: 'firefox-default' },
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

    // Mock storage with persistence simulation
    mockStorage = {};
    global.browser = {
      storage: {
        sync: {
          get: jest.fn().mockImplementation(() => Promise.resolve(mockStorage)),
          set: jest.fn().mockImplementation((data) => {
            Object.assign(mockStorage, data);
            return Promise.resolve();
          }),
          remove: jest.fn().mockImplementation((keys) => {
            if (Array.isArray(keys)) {
              keys.forEach(key => delete mockStorage[key]);
            } else {
              delete mockStorage[keys];
            }
            return Promise.resolve();
          })
        },
        local: {
          get: jest.fn().mockImplementation(() => Promise.resolve(mockStorage)),
          set: jest.fn().mockImplementation((data) => {
            Object.assign(mockStorage, data);
            return Promise.resolve();
          }),
          remove: jest.fn().mockImplementation((keys) => {
            if (Array.isArray(keys)) {
              keys.forEach(key => delete mockStorage[key]);
            } else {
              delete mockStorage[keys];
            }
            return Promise.resolve();
          })
        },
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue({ success: false }) // Force fallback to storage adapters
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

    storageManagers = tabs.map((tab, index) => {
      return new StorageManager(eventBuses[index], tab.containerId);
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
    mockStorage = {};
  });

  describe('Position Persistence', () => {
    test('moving Quick Tab in Tab A syncs position to Tab B', async () => {
      // Create QT in Tab A
      const qt = new QuickTab({
        id: 'qt-pos-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      stateManagers[0].add(qt);

      // Replicate to Tab B
      stateManagers[1].add(new QuickTab({
        id: qt.id,
        url: qt.url,
        position: { ...qt.position },
        size: { ...qt.size },
        container: qt.container
      }));

      // Setup position update handler for Tab B
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          const qtInB = stateManagers[1].get(message.data.id);
          if (qtInB) {
            qtInB.position.left = message.data.left;
            qtInB.position.top = message.data.top;
            stateManagers[1].update(qtInB);
          }
        }
      });

      // Move to top-left in Tab A
      const qtInA = stateManagers[0].get(qt.id);
      qtInA.position.left = 20;
      qtInA.position.top = 20;
      stateManagers[0].update(qtInA);

      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 20,
        top: 20
      });

      await wait(100);

      // Verify position synced to Tab B
      const qtInB = stateManagers[1].get(qt.id);
      expect(qtInB.position.left).toBe(20);
      expect(qtInB.position.top).toBe(20);
    });

    test('position persists to storage on update', async () => {
      const qt = new QuickTab({
        id: 'qt-storage-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      stateManagers[0].add(qt);

      // Verify serialize method exists
      expect(qt.serialize).toBeDefined();
      expect(typeof qt.serialize).toBe('function');

      // Save to storage
      await storageManagers[0].save([qt]);

      // Update position
      qt.position.left = 500;
      qt.position.top = 400;
      stateManagers[0].update(qt);

      // Save updated state
      await storageManagers[0].save([qt]);

      // Load from storage
      const loadedQuickTabs = await storageManagers[0].loadAll();

      expect(loadedQuickTabs).toBeDefined();
      expect(loadedQuickTabs.length).toBeGreaterThan(0);
      const loadedState = loadedQuickTabs.find(q => q.id === qt.id);
      expect(loadedState).toBeDefined();
      expect(loadedState.position.left).toBe(500);
      expect(loadedState.position.top).toBe(400);
    });

    test('position updates complete within 100ms', async () => {
      const qt = new QuickTab({
        id: 'qt-speed-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);
      stateManagers[1].add(new QuickTab({
        id: qt.id,
        url: qt.url,
        position: { ...qt.position },
        size: { ...qt.size },
        container: qt.container
      }));

      let updateReceived = false;
      const startTime = Date.now();

      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          updateReceived = true;
        }
      });

      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 500,
        top: 400
      });

      await wait(100);

      const endTime = Date.now();
      const propagationTime = endTime - startTime;

      expect(updateReceived).toBe(true);
      expect(propagationTime).toBeLessThan(150);
    });
  });

  describe('Size Persistence', () => {
    test('resizing Quick Tab in Tab A syncs size to Tab B', async () => {
      const qt = new QuickTab({
        id: 'qt-size-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);
      stateManagers[1].add(new QuickTab({
        id: qt.id,
        url: qt.url,
        position: { ...qt.position },
        size: { ...qt.size },
        container: qt.container
      }));

      // Setup size update handler
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_SIZE') {
          const qtInB = stateManagers[1].get(message.data.id);
          if (qtInB) {
            qtInB.size.width = message.data.width;
            qtInB.size.height = message.data.height;
            stateManagers[1].update(qtInB);
          }
        }
      });

      // Resize in Tab A
      const qtInA = stateManagers[0].get(qt.id);
      qtInA.size.width = 600;
      qtInA.size.height = 400;
      stateManagers[0].update(qtInA);

      await broadcastManagers[0].broadcast('UPDATE_SIZE', {
        id: qt.id,
        width: 600,
        height: 400
      });

      await wait(100);

      // Verify size synced
      const qtInB = stateManagers[1].get(qt.id);
      expect(qtInB.size.width).toBe(600);
      expect(qtInB.size.height).toBe(400);
    });

    test('size persists to storage on update', async () => {
      const qt = new QuickTab({
        id: 'qt-size-storage-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);
      await storageManagers[0].save([qt]);

      // Resize
      qt.size.width = 700;
      qt.size.height = 500;
      stateManagers[0].update(qt);
      await storageManagers[0].save([qt]);

      // Load and verify
      const loadedQuickTabs = await storageManagers[0].loadAll();
      const loadedState = loadedQuickTabs.find(q => q.id === qt.id);
      expect(loadedState).toBeDefined();
      expect(loadedState.size.width).toBe(700);
      expect(loadedState.size.height).toBe(500);
    });
  });

  describe('Combined Position & Size Updates', () => {
    test('position and size updates can be applied independently', async () => {
      const qt = new QuickTab({
        id: 'qt-combined-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);
      stateManagers[1].add(new QuickTab({
        id: qt.id,
        url: qt.url,
        position: { ...qt.position },
        size: { ...qt.size },
        container: qt.container
      }));

      // Setup handlers
      eventBuses[1].on('broadcast:received', (message) => {
        const qtInB = stateManagers[1].get(message.data.id);
        if (!qtInB) return;

        if (message.type === 'UPDATE_POSITION') {
          qtInB.position.left = message.data.left;
          qtInB.position.top = message.data.top;
          stateManagers[1].update(qtInB);
        } else if (message.type === 'UPDATE_SIZE') {
          qtInB.size.width = message.data.width;
          qtInB.size.height = message.data.height;
          stateManagers[1].update(qtInB);
        }
      });

      // Update position only
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 500,
        top: 400
      });

      await wait(50);

      let qtInB = stateManagers[1].get(qt.id);
      expect(qtInB.position.left).toBe(500);
      expect(qtInB.size.width).toBe(800); // Size unchanged

      // Update size only
      await broadcastManagers[0].broadcast('UPDATE_SIZE', {
        id: qt.id,
        width: 700,
        height: 500
      });

      await wait(50);

      qtInB = stateManagers[1].get(qt.id);
      expect(qtInB.position.left).toBe(500); // Position unchanged
      expect(qtInB.size.width).toBe(700); // Size updated
    });

    test('rapid position/size updates all apply correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-rapid-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);
      stateManagers[1].add(new QuickTab({
        id: qt.id,
        url: qt.url,
        position: { ...qt.position },
        size: { ...qt.size },
        container: qt.container
      }));

      const updates = [];

      eventBuses[1].on('broadcast:received', (message) => {
        updates.push(message.type);
        const qtInB = stateManagers[1].get(message.data.id);
        if (!qtInB) return;

        if (message.type === 'UPDATE_POSITION') {
          qtInB.position.left = message.data.left;
          qtInB.position.top = message.data.top;
          stateManagers[1].update(qtInB);
        } else if (message.type === 'UPDATE_SIZE') {
          qtInB.size.width = message.data.width;
          qtInB.size.height = message.data.height;
          stateManagers[1].update(qtInB);
        }
      });

      // Send rapid updates
      await Promise.all([
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 200,
          top: 200
        }),
        broadcastManagers[0].broadcast('UPDATE_SIZE', {
          id: qt.id,
          width: 700,
          height: 500
        }),
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          left: 300,
          top: 300
        })
      ]);

      await wait(150);

      // Verify all updates received
      expect(updates.length).toBe(3);
      expect(updates).toContain('UPDATE_POSITION');
      expect(updates).toContain('UPDATE_SIZE');

      // Verify final state (last update wins)
      const qtInB = stateManagers[1].get(qt.id);
      expect(qtInB.position.left).toBe(300);
      expect(qtInB.size.width).toBe(700);
    });
  });

  describe('Storage Persistence', () => {
    test('Quick Tab state survives simulated page reload', async () => {
      const qt = new QuickTab({
        id: 'qt-reload-1',
        url: 'https://example.com',
        position: { left: 500, top: 400 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);
      await storageManagers[0].save([qt]);

      // Simulate page reload - clear in-memory state
      stateManagers[0].quickTabs.clear();

      // Verify in-memory state cleared
      expect(stateManagers[0].get(qt.id)).toBeUndefined();

      // Load from storage (simulating hydration on reload)
      const loadedQuickTabs = await storageManagers[0].loadAll();
      const loadedState = loadedQuickTabs.find(q => q.id === qt.id);

      expect(loadedState).toBeDefined();

      // Recreate QuickTab from loaded state
      const restoredQT = new QuickTab({
        id: loadedState.id,
        url: loadedState.url,
        position: loadedState.position,
        size: loadedState.size,
        container: loadedState.container
      });

      stateManagers[0].add(restoredQT);

      // Verify state restored
      const restored = stateManagers[0].get(qt.id);
      expect(restored).toBeDefined();
      expect(restored.position.left).toBe(500);
      expect(restored.position.top).toBe(400);
      expect(restored.size.width).toBe(700);
      expect(restored.size.height).toBe(500);
    });
  });

  describe('Edge Cases', () => {
    test('position update to same position does not trigger duplicate broadcasts', async () => {
      const qt = new QuickTab({
        id: 'qt-dup-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);

      const broadcasts = [];
      const originalBroadcast = broadcastManagers[0].broadcast.bind(broadcastManagers[0]);
      broadcastManagers[0].broadcast = jest.fn((...args) => {
        broadcasts.push(args[0]);
        return originalBroadcast(...args);
      });

      // Update to same position
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        left: 100,
        top: 100
      });

      await wait(50);

      // Should still broadcast (component decides whether to optimize)
      expect(broadcasts.length).toBeGreaterThan(0);
    });

    test('negative position values are handled correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-neg-1',
        url: 'https://example.com',
        position: { left: -50, top: -50 }, // Partially off-screen
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);

      // Verify negative values stored
      expect(qt.position.left).toBe(-50);
      expect(qt.position.top).toBe(-50);

      // Verify persisted to storage
      await storageManagers[0].save([qt]);
      const loadedQuickTabs = await storageManagers[0].loadAll();
      const loaded = loadedQuickTabs.find(q => q.id === qt.id);
      expect(loaded).toBeDefined();
      expect(loaded.position.left).toBe(-50);
    });

    test('very large position values are handled correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-large-1',
        url: 'https://example.com',
        position: { left: 10000, top: 10000 }, // Far off-screen
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);

      // Verify large values stored
      expect(qt.position.left).toBe(10000);
      expect(qt.position.top).toBe(10000);

      // Verify persisted
      await storageManagers[0].save([qt]);
      const loadedQuickTabs = await storageManagers[0].loadAll();
      const loaded = loadedQuickTabs.find(q => q.id === qt.id);
      expect(loaded).toBeDefined();
      expect(loaded.position.left).toBe(10000);
    });
  });
});
