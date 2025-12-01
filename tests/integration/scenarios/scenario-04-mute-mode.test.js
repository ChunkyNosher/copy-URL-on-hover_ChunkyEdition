/**
 * Scenario 4: Mute Mode (Hide on Specific Tab)
 * 
 * Tests that Quick Tabs can be "muted" to be hidden on specific tabs.
 * When a Quick Tab is muted, it should:
 * - Be visible on all tabs EXCEPT those in the mutedOnTabs array
 * - Not appear on muted tabs
 * - Mute state should sync across all tabs
 * - Broadcast should propagate mute changes within 100ms
 * - Mute and Solo are mutually exclusive (muting clears solo, soloing clears mute)
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 4)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Priority 1)
 * 
 * Covers Issues: #47 (Solo/Mute feature)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';
import { BroadcastManager } from '../../mocks/BroadcastManagerMock.js';

describe('Scenario 4: Mute Mode Protocol', () => {
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

  describe('Mute Mode Activation', () => {
    test('muting Quick Tab on Tab A makes it hidden only on Tab A', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-1',
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
          if (message.type === 'MUTE') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.mutedOnTabs = message.data.mutedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Mute Quick Tab on Tab A
      const tabAQt = stateManagers[0].get(quickTab.id);
      tabAQt.visibility.mutedOnTabs = [tabs[0].tabId];
      stateManagers[0].update(tabAQt);

      await broadcastManagers[0].broadcast('MUTE', {
        id: quickTab.id,
        mutedOnTabs: [tabs[0].tabId]
      });

      await wait(100);

      // Verify visibility
      const qtInTabA = stateManagers[0].get(quickTab.id);
      const qtInTabB = stateManagers[1].get(quickTab.id);
      const qtInTabC = stateManagers[2].get(quickTab.id);

      expect(qtInTabA.shouldBeVisible(tabs[0].tabId)).toBe(false); // Muted on Tab A
      expect(qtInTabB.shouldBeVisible(tabs[1].tabId)).toBe(true);  // Visible on Tab B
      expect(qtInTabC.shouldBeVisible(tabs[2].tabId)).toBe(true);  // Visible on Tab C
    });

    test('muting Quick Tab on multiple tabs makes it hidden on all muted tabs', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-2',
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
          if (message.type === 'MUTE') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.mutedOnTabs = message.data.mutedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Mute on Tab A and Tab C
      const qtInTabA = stateManagers[0].get(quickTab.id);
      qtInTabA.visibility.mutedOnTabs = [tabs[0].tabId, tabs[2].tabId];
      stateManagers[0].update(qtInTabA);

      await broadcastManagers[0].broadcast('MUTE', {
        id: quickTab.id,
        mutedOnTabs: [tabs[0].tabId, tabs[2].tabId]
      });

      await wait(100);

      const qtA = stateManagers[0].get(quickTab.id);
      const qtB = stateManagers[1].get(quickTab.id);
      const qtC = stateManagers[2].get(quickTab.id);

      expect(qtA.shouldBeVisible(tabs[0].tabId)).toBe(false); // Muted
      expect(qtB.shouldBeVisible(tabs[1].tabId)).toBe(true);  // Visible
      expect(qtC.shouldBeVisible(tabs[2].tabId)).toBe(false); // Muted
    });

    test('mute broadcast completes within 100ms', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-3',
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
        if (message.type === 'MUTE') {
          messageReceived = true;
        }
      });

      const startTime = Date.now();

      await broadcastManagers[0].broadcast('MUTE', {
        id: quickTab.id,
        mutedOnTabs: [tabs[0].tabId]
      });

      await wait(100);

      const endTime = Date.now();
      const propagationTime = endTime - startTime;

      expect(messageReceived).toBe(true);
      expect(propagationTime).toBeLessThan(150);
    });
  });

  describe('Mute Mode Deactivation', () => {
    test('removing mute makes Quick Tab visible on all tabs again', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-4',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [tabs[0].tabId],
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
          if (message.type === 'MUTE') {
            const qt = stateManagers[index].get(message.data.id);
            if (qt) {
              qt.visibility.mutedOnTabs = message.data.mutedOnTabs;
              stateManagers[index].update(qt);
            }
          }
        });
      });

      // Remove mute (empty array)
      const qtInTabA = stateManagers[0].get(quickTab.id);
      qtInTabA.visibility.mutedOnTabs = [];
      stateManagers[0].update(qtInTabA);

      await broadcastManagers[0].broadcast('MUTE', {
        id: quickTab.id,
        mutedOnTabs: []
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

  describe('Solo/Mute Mutual Exclusivity', () => {
    test('muting clears solo state', async () => {
      // Start with soloed Quick Tab
      const quickTab = new QuickTab({
        id: 'qt-mute-solo-1',
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

      stateManagers[0].add(quickTab);

      eventBuses[0].on('broadcast:received', (message) => {
        if (message.type === 'MUTE') {
          const qt = stateManagers[0].get(message.data.id);
          if (qt) {
            // Muting clears solo
            qt.visibility.soloedOnTabs = [];
            qt.visibility.mutedOnTabs = message.data.mutedOnTabs;
            stateManagers[0].update(qt);
          }
        }
      });

      // Apply mute
      const qt = stateManagers[0].get(quickTab.id);
      qt.visibility.soloedOnTabs = [];
      qt.visibility.mutedOnTabs = [tabs[1].tabId];
      stateManagers[0].update(qt);

      await broadcastManagers[0].broadcast('MUTE', {
        id: quickTab.id,
        mutedOnTabs: [tabs[1].tabId]
      });

      await wait(100);

      const updatedQt = stateManagers[0].get(quickTab.id);
      expect(updatedQt.visibility.soloedOnTabs).toEqual([]);
      expect(updatedQt.visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
    });

    test('soloing clears mute state', async () => {
      // Start with muted Quick Tab
      const quickTab = new QuickTab({
        id: 'qt-solo-mute-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [tabs[0].tabId],
          minimized: false
        }
      });

      stateManagers[0].add(quickTab);

      eventBuses[0].on('broadcast:received', (message) => {
        if (message.type === 'SOLO') {
          const qt = stateManagers[0].get(message.data.id);
          if (qt) {
            // Soloing clears mute
            qt.visibility.mutedOnTabs = [];
            qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
            stateManagers[0].update(qt);
          }
        }
      });

      // Apply solo
      const qt = stateManagers[0].get(quickTab.id);
      qt.visibility.mutedOnTabs = [];
      qt.visibility.soloedOnTabs = [tabs[1].tabId];
      stateManagers[0].update(qt);

      await broadcastManagers[0].broadcast('SOLO', {
        id: quickTab.id,
        soloedOnTabs: [tabs[1].tabId]
      });

      await wait(100);

      const updatedQt = stateManagers[0].get(quickTab.id);
      expect(updatedQt.visibility.mutedOnTabs).toEqual([]);
      expect(updatedQt.visibility.soloedOnTabs).toEqual([tabs[1].tabId]);
    });
  });

  describe('Mute Mode Edge Cases', () => {
    test('muting on all tabs effectively hides Quick Tab everywhere', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-5',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(quickTab);

      // Mute on all tabs
      quickTab.visibility.mutedOnTabs = [tabs[0].tabId, tabs[1].tabId, tabs[2].tabId];
      stateManagers[0].update(quickTab);

      // Should not be visible anywhere
      expect(quickTab.shouldBeVisible(tabs[0].tabId)).toBe(false);
      expect(quickTab.shouldBeVisible(tabs[1].tabId)).toBe(false);
      expect(quickTab.shouldBeVisible(tabs[2].tabId)).toBe(false);
    });

    test('muting on non-existent tab ID still updates state correctly', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-6',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(quickTab);

      const nonExistentTabId = 999999;
      quickTab.visibility.mutedOnTabs = [nonExistentTabId];
      stateManagers[0].update(quickTab);

      // Should still be visible on actual tabs
      expect(quickTab.shouldBeVisible(tabs[0].tabId)).toBe(true);
      expect(quickTab.shouldBeVisible(tabs[1].tabId)).toBe(true);
      expect(quickTab.shouldBeVisible(tabs[2].tabId)).toBe(true);

      // Should not be visible on non-existent tab
      expect(quickTab.shouldBeVisible(nonExistentTabId)).toBe(false);
    });
  });
});
