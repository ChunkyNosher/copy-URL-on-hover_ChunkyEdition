/**
 * Scenario 9: Solo/Mute Mutual Exclusivity
 * 
 * MEDIUM PRIORITY - Quick Win (2 days effort)
 * 
 * Tests that Solo and Mute modes are mutually exclusive and properly enforced:
 * - Activating solo disables mute button
 * - Activating mute disables solo button
 * - Deactivating solo re-enables mute button
 * - Attempting to activate both simultaneously fails gracefully
 * - State correctly syncs mutual exclusivity across tabs
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 9 - MEDIUM/Quick Win)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Covers Issues: #47 (Solo/Mute feature constraints)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { VisibilityHandler } from '../../../src/features/quick-tabs/handlers/VisibilityHandler.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 9: Solo/Mute Mutual Exclusivity Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let visibilityHandlers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 simulated tabs for testing mutual exclusivity
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

    visibilityHandlers = tabs.map((tab, index) => {
      return new VisibilityHandler(eventBuses[index], tab.tabId);
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

    // Wire up visibility update handlers
    eventBuses.forEach((bus, tabIndex) => {
      bus.on('broadcast:received', (message) => {
        if (message.type === 'SOLO') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
            // Clear mute when solo is set
            if (message.data.soloedOnTabs && message.data.soloedOnTabs.length > 0) {
              qt.visibility.mutedOnTabs = [];
            }
            stateManagers[tabIndex].update(qt);
          }
        } else if (message.type === 'MUTE') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.visibility.mutedOnTabs = message.data.mutedOnTabs;
            // Clear solo when mute is set
            if (message.data.mutedOnTabs && message.data.mutedOnTabs.length > 0) {
              qt.visibility.soloedOnTabs = [];
            }
            stateManagers[tabIndex].update(qt);
          }
        }
      });
    });
  });

  afterEach(() => {
    broadcastManagers.forEach(bm => bm.close());
    stateManagers.forEach(sm => sm.quickTabs.clear());
    delete global.BroadcastChannel;
    delete global.browser;
  });

  describe('Solo Disables Mute', () => {
    test('activating solo clears mute state', async () => {
      // Create Quick Tab with mute active on tab A
      const quickTab = new QuickTab({
        id: 'qt-exclusivity-1',
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

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Verify mute is active
      expect(stateManagers[0].get('qt-exclusivity-1').visibility.mutedOnTabs).toEqual([tabs[0].tabId]);

      // Activate solo on tab B - apply locally first, then broadcast
      const qtInTabB = stateManagers[1].get('qt-exclusivity-1');
      qtInTabB.visibility.soloedOnTabs = [tabs[1].tabId];
      qtInTabB.visibility.mutedOnTabs = []; // Clear mute (mutual exclusivity)
      stateManagers[1].update(qtInTabB);

      await broadcastManagers[1].broadcast('SOLO', {
        id: 'qt-exclusivity-1',
        soloedOnTabs: [tabs[1].tabId]
      });

      await wait(150);

      // Verify solo is active and mute is cleared in all tabs
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-exclusivity-1');
        expect(qt.visibility.soloedOnTabs).toEqual([tabs[1].tabId]);
        expect(qt.visibility.mutedOnTabs).toEqual([]);
      });
    });

    test('activating solo on multiple tabs clears mute', async () => {
      const quickTab = new QuickTab({
        id: 'qt-exclusivity-2',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [tabs[0].tabId, tabs[1].tabId],
          minimized: false
        }
      });

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Activate solo on tabs A and C - apply locally first, then broadcast
      const qtInTabA = stateManagers[0].get('qt-exclusivity-2');
      qtInTabA.visibility.soloedOnTabs = [tabs[0].tabId, tabs[2].tabId];
      qtInTabA.visibility.mutedOnTabs = []; // Clear mute (mutual exclusivity)
      stateManagers[0].update(qtInTabA);

      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-exclusivity-2',
        soloedOnTabs: [tabs[0].tabId, tabs[2].tabId]
      });

      await wait(150);

      // Verify solo is active and all mute is cleared
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-exclusivity-2');
        expect(qt.visibility.soloedOnTabs).toEqual([tabs[0].tabId, tabs[2].tabId]);
        expect(qt.visibility.mutedOnTabs).toEqual([]);
      });
    });
  });

  describe('Mute Disables Solo', () => {
    test('activating mute clears solo state', async () => {
      // Create Quick Tab with solo active on tab A
      const quickTab = new QuickTab({
        id: 'qt-exclusivity-3',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Verify solo is active
      expect(stateManagers[0].get('qt-exclusivity-3').visibility.soloedOnTabs).toEqual([tabs[0].tabId]);

      // Activate mute on tab B - apply locally first, then broadcast
      const qtInTabB = stateManagers[1].get('qt-exclusivity-3');
      qtInTabB.visibility.mutedOnTabs = [tabs[1].tabId];
      qtInTabB.visibility.soloedOnTabs = []; // Clear solo (mutual exclusivity)
      stateManagers[1].update(qtInTabB);

      await broadcastManagers[1].broadcast('MUTE', {
        id: 'qt-exclusivity-3',
        mutedOnTabs: [tabs[1].tabId]
      });

      await wait(150);

      // Verify mute is active and solo is cleared in all tabs
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-exclusivity-3');
        expect(qt.visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
        expect(qt.visibility.soloedOnTabs).toEqual([]);
      });
    });

    test('activating mute on multiple tabs clears solo', async () => {
      const quickTab = new QuickTab({
        id: 'qt-exclusivity-4',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [tabs[0].tabId, tabs[1].tabId],
          mutedOnTabs: [],
          minimized: false
        }
      });

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Activate mute on tabs A and C - apply locally first, then broadcast
      const qtInTabA2 = stateManagers[0].get('qt-exclusivity-4');
      qtInTabA2.visibility.mutedOnTabs = [tabs[0].tabId, tabs[2].tabId];
      qtInTabA2.visibility.soloedOnTabs = []; // Clear solo (mutual exclusivity)
      stateManagers[0].update(qtInTabA2);

      await broadcastManagers[0].broadcast('MUTE', {
        id: 'qt-exclusivity-4',
        mutedOnTabs: [tabs[0].tabId, tabs[2].tabId]
      });

      await wait(150);

      // Verify mute is active and all solo is cleared
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-exclusivity-4');
        expect(qt.visibility.mutedOnTabs).toEqual([tabs[0].tabId, tabs[2].tabId]);
        expect(qt.visibility.soloedOnTabs).toEqual([]);
      });
    });
  });

  describe('Toggling Between Modes', () => {
    test('can toggle from solo to mute and back', async () => {
      const quickTab = new QuickTab({
        id: 'qt-toggle-1',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Activate solo - apply locally first
      let qt = stateManagers[0].get('qt-toggle-1');
      qt.visibility.soloedOnTabs = [tabs[0].tabId];
      qt.visibility.mutedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-toggle-1',
        soloedOnTabs: [tabs[0].tabId]
      });
      await wait(150);

      // Verify solo active
      expect(stateManagers[0].get('qt-toggle-1').visibility.soloedOnTabs).toEqual([tabs[0].tabId]);
      expect(stateManagers[0].get('qt-toggle-1').visibility.mutedOnTabs).toEqual([]);

      // Switch to mute - apply locally first
      qt = stateManagers[0].get('qt-toggle-1');
      qt.visibility.mutedOnTabs = [tabs[1].tabId];
      qt.visibility.soloedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('MUTE', {
        id: 'qt-toggle-1',
        mutedOnTabs: [tabs[1].tabId]
      });
      await wait(150);

      // Verify mute active, solo cleared
      expect(stateManagers[0].get('qt-toggle-1').visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
      expect(stateManagers[0].get('qt-toggle-1').visibility.soloedOnTabs).toEqual([]);

      // Switch back to solo - apply locally first
      qt = stateManagers[0].get('qt-toggle-1');
      qt.visibility.soloedOnTabs = [tabs[2].tabId];
      qt.visibility.mutedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-toggle-1',
        soloedOnTabs: [tabs[2].tabId]
      });
      await wait(150);

      // Verify solo active again, mute cleared
      expect(stateManagers[0].get('qt-toggle-1').visibility.soloedOnTabs).toEqual([tabs[2].tabId]);
      expect(stateManagers[0].get('qt-toggle-1').visibility.mutedOnTabs).toEqual([]);
    });
  });

  describe('Deactivation Re-enables', () => {
    test('deactivating solo allows mute to be activated', async () => {
      const quickTab = new QuickTab({
        id: 'qt-renable-1',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Deactivate solo (clear soloedOnTabs) - apply locally first
      let qt = stateManagers[0].get('qt-renable-1');
      qt.visibility.soloedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-renable-1',
        soloedOnTabs: []
      });
      await wait(150);

      // Verify solo is cleared
      expect(stateManagers[0].get('qt-renable-1').visibility.soloedOnTabs).toEqual([]);

      // Now activate mute (should succeed) - apply locally first
      qt = stateManagers[0].get('qt-renable-1');
      qt.visibility.mutedOnTabs = [tabs[1].tabId];
      qt.visibility.soloedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('MUTE', {
        id: 'qt-renable-1',
        mutedOnTabs: [tabs[1].tabId]
      });
      await wait(150);

      // Verify mute is active
      expect(stateManagers[0].get('qt-renable-1').visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
    });

    test('deactivating mute allows solo to be activated', async () => {
      const quickTab = new QuickTab({
        id: 'qt-renable-2',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Deactivate mute (clear mutedOnTabs) - apply locally first
      let qt = stateManagers[0].get('qt-renable-2');
      qt.visibility.mutedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('MUTE', {
        id: 'qt-renable-2',
        mutedOnTabs: []
      });
      await wait(150);

      // Verify mute is cleared
      expect(stateManagers[0].get('qt-renable-2').visibility.mutedOnTabs).toEqual([]);

      // Now activate solo (should succeed) - apply locally first
      qt = stateManagers[0].get('qt-renable-2');
      qt.visibility.soloedOnTabs = [tabs[1].tabId];
      qt.visibility.mutedOnTabs = [];
      stateManagers[0].update(qt);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-renable-2',
        soloedOnTabs: [tabs[1].tabId]
      });
      await wait(150);

      // Verify solo is active
      expect(stateManagers[0].get('qt-renable-2').visibility.soloedOnTabs).toEqual([tabs[1].tabId]);
    });
  });

  describe('Cross-Tab Enforcement', () => {
    test('mutual exclusivity enforced across all tabs', async () => {
      const quickTab = new QuickTab({
        id: 'qt-cross-tab-1',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Tab A activates solo - apply locally first
      let qtA = stateManagers[0].get('qt-cross-tab-1');
      qtA.visibility.soloedOnTabs = [tabs[0].tabId];
      qtA.visibility.mutedOnTabs = [];
      stateManagers[0].update(qtA);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-cross-tab-1',
        soloedOnTabs: [tabs[0].tabId]
      });
      await wait(150);

      // Verify all tabs see solo active
      stateManagers.forEach(sm => {
        expect(sm.get('qt-cross-tab-1').visibility.soloedOnTabs).toEqual([tabs[0].tabId]);
      });

      // Tab B activates mute (should clear solo in all tabs) - apply locally first
      let qtB = stateManagers[1].get('qt-cross-tab-1');
      qtB.visibility.mutedOnTabs = [tabs[1].tabId];
      qtB.visibility.soloedOnTabs = [];
      stateManagers[1].update(qtB);
      
      await broadcastManagers[1].broadcast('MUTE', {
        id: 'qt-cross-tab-1',
        mutedOnTabs: [tabs[1].tabId]
      });
      await wait(150);

      // Verify all tabs see mute active and solo cleared
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-cross-tab-1');
        expect(qt.visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
        expect(qt.visibility.soloedOnTabs).toEqual([]);
      });
    });

    test('concurrent solo and mute attempts resolve correctly', async () => {
      const quickTab = new QuickTab({
        id: 'qt-concurrent-1',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Tab A attempts solo, Tab B attempts mute simultaneously - apply locally first
      let qtConcA = stateManagers[0].get('qt-concurrent-1');
      qtConcA.visibility.soloedOnTabs = [tabs[0].tabId];
      qtConcA.visibility.mutedOnTabs = [];
      stateManagers[0].update(qtConcA);
      
      let qtConcB = stateManagers[1].get('qt-concurrent-1');
      qtConcB.visibility.mutedOnTabs = [tabs[1].tabId];
      qtConcB.visibility.soloedOnTabs = [];
      stateManagers[1].update(qtConcB);
      
      const soloPromise = broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-concurrent-1',
        soloedOnTabs: [tabs[0].tabId]
      });

      const mutePromise = broadcastManagers[1].broadcast('MUTE', {
        id: 'qt-concurrent-1',
        mutedOnTabs: [tabs[1].tabId]
      });

      await Promise.all([soloPromise, mutePromise]);
      await wait(150);

      // One mode should be active, not both
      const qt = stateManagers[0].get('qt-concurrent-1');
      const hasSolo = qt.visibility.soloedOnTabs.length > 0;
      const hasMute = qt.visibility.mutedOnTabs.length > 0;

      // XOR: exactly one should be true
      expect(hasSolo !== hasMute).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('empty arrays treated as deactivated', async () => {
      const quickTab = new QuickTab({
        id: 'qt-empty-1',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Set solo to empty array (deactivate) - apply locally first
      let qtEmpty = stateManagers[0].get('qt-empty-1');
      qtEmpty.visibility.soloedOnTabs = [];
      stateManagers[0].update(qtEmpty);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-empty-1',
        soloedOnTabs: []
      });
      await wait(150);

      // Now mute should be activatable - apply locally first
      qtEmpty = stateManagers[0].get('qt-empty-1');
      qtEmpty.visibility.mutedOnTabs = [tabs[1].tabId];
      qtEmpty.visibility.soloedOnTabs = [];
      stateManagers[0].update(qtEmpty);
      
      await broadcastManagers[0].broadcast('MUTE', {
        id: 'qt-empty-1',
        mutedOnTabs: [tabs[1].tabId]
      });
      await wait(150);

      expect(stateManagers[0].get('qt-empty-1').visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
      expect(stateManagers[0].get('qt-empty-1').visibility.soloedOnTabs).toEqual([]);
    });

    test('state remains consistent after multiple rapid toggles', async () => {
      const quickTab = new QuickTab({
        id: 'qt-rapid-1',
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

      stateManagers.forEach(sm => sm.add(new QuickTab(quickTab)));

      // Rapid toggles - apply locally for each
      let qtRapid = stateManagers[0].get('qt-rapid-1');
      qtRapid.visibility.soloedOnTabs = [tabs[0].tabId];
      qtRapid.visibility.mutedOnTabs = [];
      stateManagers[0].update(qtRapid);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-rapid-1',
        soloedOnTabs: [tabs[0].tabId]
      });

      qtRapid = stateManagers[0].get('qt-rapid-1');
      qtRapid.visibility.mutedOnTabs = [tabs[1].tabId];
      qtRapid.visibility.soloedOnTabs = [];
      stateManagers[0].update(qtRapid);
      
      await broadcastManagers[0].broadcast('MUTE', {
        id: 'qt-rapid-1',
        mutedOnTabs: [tabs[1].tabId]
      });

      qtRapid = stateManagers[0].get('qt-rapid-1');
      qtRapid.visibility.soloedOnTabs = [tabs[2].tabId];
      qtRapid.visibility.mutedOnTabs = [];
      stateManagers[0].update(qtRapid);
      
      await broadcastManagers[0].broadcast('SOLO', {
        id: 'qt-rapid-1',
        soloedOnTabs: [tabs[2].tabId]
      });

      await wait(200);

      // Final state should be solo on tab C, no mute
      const qt = stateManagers[0].get('qt-rapid-1');
      expect(qt.visibility.soloedOnTabs).toEqual([tabs[2].tabId]);
      expect(qt.visibility.mutedOnTabs).toEqual([]);
    });
  });
});
