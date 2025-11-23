/**
 * Scenario 1: Basic Quick Tab Creation & Cross-Tab Synchronization Protocol
 * 
 * Simplified integration test focusing on cross-tab synchronization protocol
 * Tests that BroadcastManager + StateManager + StorageManager work together
 * to maintain consistent state across multiple simulated tabs.
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 1)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Phase 4)
 * 
 * Covers Issues: #35, #47, #51
 */

import { EventEmitter } from 'eventemitter3';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';
import { QuickTab } from '../../../src/domain/QuickTab.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 1: Cross-Tab Synchronization Protocol', () => {
  let tabs;
  let managers;
  let broadcastManagers;
  let stateManagers;
  let storageManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 2 simulated tabs (Wikipedia and YouTube)
    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
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

    // Setup browser API for storage
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

    // Create managers for each tab
    broadcastManagers = tabs.map((tab, index) => {
      const manager = new BroadcastManager(eventBuses[index], tab.containerId);
      manager.setupBroadcastChannel();
      return manager;
    });

    stateManagers = tabs.map((tab, index) => {
      return new StateManager(eventBuses[index], tab.tabId);
    });

    storageManagers = tabs.map((tab, index) => {
      const quickTabsMap = new Map();
      return new StorageManager(quickTabsMap, tab.containerId);
    });

    // Connect channels to simulate cross-tab delivery
    channels.forEach((sourceChannel, sourceIndex) => {
      const originalPostMessage = sourceChannel.postMessage;
      sourceChannel.postMessage = jest.fn((message) => {
        // Call original mock if any
        if (originalPostMessage && originalPostMessage.mock) {
          originalPostMessage(message);
        }
        
        // Simulate 10ms network delay
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

  describe('Quick Tab State Creation and Broadcast', () => {
    test('creating Quick Tab state in Tab A broadcasts to Tab B', async () => {
      const receivedMessages = [[], []];
      
      // Setup message listeners
      eventBuses.forEach((bus, index) => {
        bus.on('broadcast:received', (message) => {
          receivedMessages[index].push(message);
        });
      });

      // Tab A: Create Quick Tab state
      const quickTabState = new QuickTab({
        id: 'qt-test-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        },
        zIndex: 10001
      });

      // Add to Tab A's state
      stateManagers[0].add(quickTabState);

      // Broadcast CREATE message (need to serialize QuickTab for broadcast)
      await broadcastManagers[0].broadcast('CREATE', {
        id: quickTabState.id,
        url: quickTabState.url,
        left: quickTabState.position.left,
        top: quickTabState.position.top,
        width: quickTabState.size.width,
        height: quickTabState.size.height,
        cookieStoreId: quickTabState.container,
        soloedOnTabs: quickTabState.visibility.soloedOnTabs,
        mutedOnTabs: quickTabState.visibility.mutedOnTabs,
        minimized: quickTabState.visibility.minimized
      });

      // Wait for propagation
      await wait(100);

      // Verify Tab B received the message
      expect(receivedMessages[1].length).toBeGreaterThan(0);
      const createMessage = receivedMessages[1].find(m => m.type === 'CREATE');
      expect(createMessage).toBeDefined();
      expect(createMessage.data).toMatchObject({
        id: 'qt-test-1',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });
    });

    test('Quick Tab state is added to Tab B after receiving CREATE message', async () => {
      // Setup Tab B to handle broadcast messages
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CREATE') {
          const qt = new QuickTab({
            id: message.data.id,
            url: message.data.url,
            position: { left: message.data.left, top: message.data.top },
            size: { width: message.data.width, height: message.data.height },
            container: message.data.cookieStoreId
          });
          stateManagers[1].add(qt);
        }
      });

      // Tab A: Create and broadcast
      const quickTabState = new QuickTab({
        id: 'qt-test-2',
        url: 'https://example.com',
        position: { left: 150, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      });

      stateManagers[0].add(quickTabState);
      await broadcastManagers[0].broadcast('CREATE', {
        id: quickTabState.id,
        url: quickTabState.url,
        left: quickTabState.position.left,
        top: quickTabState.position.top,
        width: quickTabState.size.width,
        height: quickTabState.size.height,
        cookieStoreId: quickTabState.container
      });

      // Wait for propagation and processing
      await wait(100);

      // Verify Tab B has the state
      const tabBState = stateManagers[1].get(quickTabState.id);
      expect(tabBState).toBeDefined();
      expect(tabBState.id).toBe('qt-test-2');
      expect(tabBState.position.left).toBe(150);
      expect(tabBState.position.top).toBe(200);
      expect(tabBState.size.width).toBe(700);
      expect(tabBState.size.height).toBe(500);
    });

    test('broadcast completes within 100ms', async () => {
      const startTime = Date.now();
      let messageReceived = false;

      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CREATE') {
          messageReceived = true;
        }
      });

      const quickTabState = new QuickTab({
        id: 'qt-test-3',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      await broadcastManagers[0].broadcast('CREATE', {
        id: quickTabState.id,
        url: quickTabState.url,
        left: quickTabState.position.left,
        top: quickTabState.position.top,
        width: quickTabState.size.width,
        height: quickTabState.size.height,
        cookieStoreId: quickTabState.container
      });

      // Wait for message
      await wait(100);

      const endTime = Date.now();
      const propagationTime = endTime - startTime;

      expect(messageReceived).toBe(true);
      expect(propagationTime).toBeLessThan(150); // Allow some margin for test overhead
    });
  });

  describe('Position/Size Update Synchronization', () => {
    test('position update in Tab A syncs to Tab B', async () => {
      // Setup both tabs with same Quick Tab
      const initialState = new QuickTab({
        id: 'qt-test-4',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(initialState);
      stateManagers[1].add(new QuickTab({
        id: 'qt-test-4',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      }));

      // Setup Tab B to handle position updates
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          const state = stateManagers[1].get(message.data.id);
          if (state) {
            state.position.left = message.data.left;
            state.position.top = message.data.top;
            stateManagers[1].update(state);
          }
        }
      });

      // Tab A: Update position
      const updatedState = stateManagers[0].get(initialState.id);
      updatedState.position.left = 500;
      updatedState.position.top = 400;
      stateManagers[0].update(updatedState);

      // Broadcast position update
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: initialState.id,
        left: 500,
        top: 400
      });

      // Wait for propagation
      await wait(100);

      // Verify Tab B's state updated
      const tabBState = stateManagers[1].get(initialState.id);
      expect(tabBState.position.left).toBe(500);
      expect(tabBState.position.top).toBe(400);
    });

    test('size update in Tab A syncs to Tab B', async () => {
      // Setup both tabs
      const initialState = new QuickTab({
        id: 'qt-test-5',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(initialState);
      stateManagers[1].add(new QuickTab({
        id: 'qt-test-5',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      }));

      // Setup Tab B to handle size updates
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_SIZE') {
          const state = stateManagers[1].get(message.data.id);
          if (state) {
            state.size.width = message.data.width;
            state.size.height = message.data.height;
            stateManagers[1].update(state);
          }
        }
      });

      // Tab A: Update size
      const updatedState = stateManagers[0].get(initialState.id);
      updatedState.size.width = 500;
      updatedState.size.height = 400;
      stateManagers[0].update(updatedState);

      // Broadcast size update
      await broadcastManagers[0].broadcast('UPDATE_SIZE', {
        id: initialState.id,
        width: 500,
        height: 400
      });

      // Wait for propagation
      await wait(100);

      // Verify Tab B's state updated
      const tabBState = stateManagers[1].get(initialState.id);
      expect(tabBState.size.width).toBe(500);
      expect(tabBState.size.height).toBe(400);
    });
  });

  describe('Quick Tab Close Synchronization', () => {
    test('closing Quick Tab in Tab A removes it from Tab B', async () => {
      // Setup both tabs with Quick Tab
      const quickTabState = new QuickTab({
        id: 'qt-test-6',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(quickTabState);
      stateManagers[1].add(new QuickTab({
        id: 'qt-test-6',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      }));

      // Setup Tab B to handle close messages
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'CLOSE') {
          stateManagers[1].delete(message.data.id);
        }
      });

      // Verify both tabs have the Quick Tab
      expect(stateManagers[0].get(quickTabState.id)).toBeDefined();
      expect(stateManagers[1].get(quickTabState.id)).toBeDefined();

      // Tab A: Close Quick Tab
      stateManagers[0].delete(quickTabState.id);
      await broadcastManagers[0].broadcast('CLOSE', { id: quickTabState.id });

      // Wait for propagation
      await wait(100);

      // Verify Tab B removed it
      expect(stateManagers[0].get(quickTabState.id)).toBeUndefined();
      expect(stateManagers[1].get(quickTabState.id)).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('concurrent creation in both tabs handles correctly', async () => {
      // Both tabs create different Quick Tabs simultaneously
      const qtA = new QuickTab({
        id: 'qt-test-7a',
        url: 'https://example-a.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qtB = new QuickTab({
        id: 'qt-test-7b',
        url: 'https://example-b.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });

      // Setup both tabs to handle CREATE messages
      eventBuses.forEach((bus, index) => {
        bus.on('broadcast:received', (message) => {
          if (message.type === 'CREATE') {
            // Create QuickTab instance from broadcast data
            const qt = new QuickTab({
              id: message.data.id,
              url: message.data.url,
              position: { left: message.data.left, top: message.data.top },
              size: { width: message.data.width, height: message.data.height },
              container: message.data.cookieStoreId
            });
            stateManagers[index].add(qt);
          }
        });
      });

      // Create simultaneously
      stateManagers[0].add(qtA);
      stateManagers[1].add(qtB);
      
      await Promise.all([
        broadcastManagers[0].broadcast('CREATE', {
          id: qtA.id,
          url: qtA.url,
          left: qtA.position.left,
          top: qtA.position.top,
          width: qtA.size.width,
          height: qtA.size.height,
          cookieStoreId: qtA.container
        }),
        broadcastManagers[1].broadcast('CREATE', {
          id: qtB.id,
          url: qtB.url,
          left: qtB.position.left,
          top: qtB.position.top,
          width: qtB.size.width,
          height: qtB.size.height,
          cookieStoreId: qtB.container
        })
      ]);

      // Wait for cross-propagation
      await wait(100);

      // Verify both tabs have both Quick Tabs
      expect(stateManagers[0].get(qtA.id)).toBeDefined();
      expect(stateManagers[0].get(qtB.id)).toBeDefined();
      expect(stateManagers[1].get(qtA.id)).toBeDefined();
      expect(stateManagers[1].get(qtB.id)).toBeDefined();
    });

    test('update to non-existent Quick Tab is handled gracefully', async () => {
      // Setup Tab B to handle updates
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_POSITION') {
          const state = stateManagers[1].get(message.data.id);
          if (state) {
            state.left = message.data.left;
            state.top = message.data.top;
            stateManagers[1].update(message.data.id, state);
          }
          // Gracefully ignore if doesn't exist
        }
      });

      // Tab A: Broadcast update for non-existent Quick Tab
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: 'qt-nonexistent',
        left: 500,
        top: 400
      });

      // Wait for propagation
      await wait(100);

      // Verify no errors occurred
      expect(stateManagers[1].get('qt-nonexistent')).toBeUndefined();
    });
  });
});
