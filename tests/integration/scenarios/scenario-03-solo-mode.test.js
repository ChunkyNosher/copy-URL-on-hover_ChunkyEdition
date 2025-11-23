/**
 * Scenario 3: Solo Mode (Pin to Specific Tab)
 * 
 * Tests that Quick Tabs can be "soloed" to be visible only on specific tabs.
 * When a Quick Tab is soloed, it should:
 * - Only appear on tabs in the soloedOnTabs array
 * - Not appear on any other tabs (including new tabs)
 * - Solo state should sync across all tabs
 * - Broadcast should propagate solo changes within 100ms
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 3)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Priority 1)
 * 
 * Covers Issues: #47 (Solo/Mute feature)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 3: Solo Mode Protocol', () => {
  let tabs;
  let broadcastManagers;
  let stateManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 simulated tabs to test solo isolation
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

    // Connect channels for cross-tab delivery
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

  describe('Solo Mode Activation', () => {
    test('soloing Quick Tab on Tab A makes it visible only on Tab A', async () => {
      // Create Quick Tab visible on all tabs initially
      const quickTab = new QuickTab({
        id: 'qt-solo-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      });

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(new QuickTab({
        id: quickTab.id,
        url: quickTab.url,
        position: quickTab.position,
        size: quickTab.size,
        container: quickTab.container,
        visibility: quickTab.visibility
      })));

      // Setup tabs to handle solo updates
      eventBuses.forEach((bus, index) => {
        bus.on('broadcast:received', (message) => {
          if (message.type === 'UPDATE_SOLO') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Solo Quick Tab on Tab A (tabs[0])
      const tabAQt = stateManagers[0].get(quickTab.id);
      tabAQt.visibility.soloedOnTabs = [tabs[0].tabId];
      stateManagers[0].update(tabAQt);

      // Broadcast solo update
      await broadcastManagers[0].broadcast('UPDATE_SOLO', {
        id: quickTab.id,
        soloedOnTabs: [tabs[0].tabId]
      });

      await wait(100);

      // Verify visibility using shouldBeVisible method
      const qtInTabA = stateManagers[0].get(quickTab.id);
      const qtInTabB = stateManagers[1].get(quickTab.id);
      const qtInTabC = stateManagers[2].get(quickTab.id);

      expect(qtInTabA.shouldBeVisible(tabs[0].tabId)).toBe(true);
      expect(qtInTabB.shouldBeVisible(tabs[1].tabId)).toBe(false);
      expect(qtInTabC.shouldBeVisible(tabs[2].tabId)).toBe(false);
    });

    test('soloing Quick Tab on multiple tabs makes it visible on all soloed tabs', async () => {
      const quickTab = new QuickTab({
        id: 'qt-solo-2',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      });

      stateManagers.forEach(sm => sm.add(new QuickTab({
        id: quickTab.id,
        url: quickTab.url,
        position: quickTab.position,
        size: quickTab.size,
        container: quickTab.container,
        visibility: quickTab.visibility
      })));

      eventBuses.forEach((bus, index) => {
        bus.on('broadcast:received', (message) => {
          if (message.type === 'UPDATE_SOLO') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Solo on Tab A and Tab B
      const qtInTabA = stateManagers[0].get(quickTab.id);
      qtInTabA.visibility.soloedOnTabs = [tabs[0].tabId, tabs[1].tabId];
      stateManagers[0].update(qtInTabA);

      await broadcastManagers[0].broadcast('UPDATE_SOLO', {
        id: quickTab.id,
        soloedOnTabs: [tabs[0].tabId, tabs[1].tabId]
      });

      await wait(100);

      // Verify visibility
      const qtA = stateManagers[0].get(quickTab.id);
      const qtB = stateManagers[1].get(quickTab.id);
      const qtC = stateManagers[2].get(quickTab.id);

      expect(qtA.shouldBeVisible(tabs[0].tabId)).toBe(true);
      expect(qtB.shouldBeVisible(tabs[1].tabId)).toBe(true);
      expect(qtC.shouldBeVisible(tabs[2].tabId)).toBe(false);
    });

    test('solo broadcast completes within 100ms', async () => {
      const quickTab = new QuickTab({
        id: 'qt-solo-3',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(new QuickTab({
        id: quickTab.id,
        url: quickTab.url,
        position: quickTab.position,
        size: quickTab.size,
        container: quickTab.container
      })));

      let messageReceived = false;
      eventBuses[1].on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_SOLO') {
          messageReceived = true;
        }
      });

      const startTime = Date.now();

      await broadcastManagers[0].broadcast('UPDATE_SOLO', {
        id: quickTab.id,
        soloedOnTabs: [tabs[0].tabId]
      });

      await wait(100);

      const endTime = Date.now();
      const propagationTime = endTime - startTime;

      expect(messageReceived).toBe(true);
      expect(propagationTime).toBeLessThan(150);
    });
  });

  describe('Solo Mode Deactivation', () => {
    test('removing solo makes Quick Tab visible on all tabs again', async () => {
      const quickTab = new QuickTab({
        id: 'qt-solo-4',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [tabs[0].tabId],
          mutedOnTabs: [],
          minimized: false
        }
      });

      stateManagers.forEach(sm => sm.add(new QuickTab({
        id: quickTab.id,
        url: quickTab.url,
        position: quickTab.position,
        size: quickTab.size,
        container: quickTab.container,
        visibility: { ...quickTab.visibility }
      })));

      eventBuses.forEach((bus, index) => {
        bus.on('broadcast:received', (message) => {
          if (message.type === 'UPDATE_SOLO') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Remove solo (empty array)
      const qtInTabA = stateManagers[0].get(quickTab.id);
      qtInTabA.visibility.soloedOnTabs = [];
      stateManagers[0].update(qtInTabA);

      await broadcastManagers[0].broadcast('UPDATE_SOLO', {
        id: quickTab.id,
        soloedOnTabs: []
      });

      await wait(100);

      // Verify visible on all tabs now
      const qtA = stateManagers[0].get(quickTab.id);
      const qtB = stateManagers[1].get(quickTab.id);
      const qtC = stateManagers[2].get(quickTab.id);

      expect(qtA.shouldBeVisible(tabs[0].tabId)).toBe(true);
      expect(qtB.shouldBeVisible(tabs[1].tabId)).toBe(true);
      expect(qtC.shouldBeVisible(tabs[2].tabId)).toBe(true);
    });
  });

  describe('Solo Mode Edge Cases', () => {
    test('soloing on non-existent tab ID still updates state correctly', async () => {
      const quickTab = new QuickTab({
        id: 'qt-solo-5',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(quickTab);

      const nonExistentTabId = 999999;
      quickTab.visibility.soloedOnTabs = [nonExistentTabId];
      stateManagers[0].update(quickTab);

      await broadcastManagers[0].broadcast('UPDATE_SOLO', {
        id: quickTab.id,
        soloedOnTabs: [nonExistentTabId]
      });

      await wait(100);

      // Should not be visible on any actual tab
      const qt = stateManagers[0].get(quickTab.id);
      expect(qt.shouldBeVisible(tabs[0].tabId)).toBe(false);
    });

    test('concurrent solo updates handle correctly', async () => {
      const quickTab = new QuickTab({
        id: 'qt-solo-6',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(new QuickTab({
        id: quickTab.id,
        url: quickTab.url,
        position: quickTab.position,
        size: quickTab.size,
        container: quickTab.container
      })));

      eventBuses.forEach((bus, index) => {
        bus.on('broadcast:received', (message) => {
          if (message.type === 'UPDATE_SOLO') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Both tabs try to solo simultaneously (last one wins)
      await Promise.all([
        broadcastManagers[0].broadcast('UPDATE_SOLO', {
          id: quickTab.id,
          soloedOnTabs: [tabs[0].tabId]
        }),
        broadcastManagers[1].broadcast('UPDATE_SOLO', {
          id: quickTab.id,
          soloedOnTabs: [tabs[1].tabId]
        })
      ]);

      await wait(150);

      // One of the solo states should have taken effect
      const qt = stateManagers[2].get(quickTab.id);
      expect(qt.visibility.soloedOnTabs.length).toBe(1);
      expect(
        qt.visibility.soloedOnTabs.includes(tabs[0].tabId) ||
        qt.visibility.soloedOnTabs.includes(tabs[1].tabId)
      ).toBe(true);
    });
  });
});
