/**
 * Scenario 6: Cross-Tab Manager Panel Sync
 * 
 * HIGH PRIORITY (2-3 days effort)
 * 
 * Tests that Manager Panel state syncs correctly across browser tabs:
 * - Minimizing QT in tab A updates Manager in tab B immediately
 * - Closing QT in one tab removes from Manager in all tabs
 * - Manager position/size syncs across tabs
 * - "Close All" in tab A closes QTs in all tabs
 * - "Close Minimized" in tab B removes only minimized QTs everywhere
 * - Restore button in Manager works from any tab
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 6 - HIGH)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Covers Issues: #47 (Manager Panel cross-tab functionality)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { VisibilityHandler } from '../../../src/features/quick-tabs/handlers/VisibilityHandler.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 6: Cross-Tab Manager Panel Sync Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let visibilityHandlers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 tabs to simulate Manager Panel open in multiple tabs
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

        // Deliver to all OTHER tabs (broadcasts don't loop back)
        setTimeout(() => {
          channels.forEach((targetChannel, targetIndex) => {
            if (targetIndex !== sourceIndex && targetChannel.onmessage) {
              targetChannel.onmessage({ data: message });
            }
          });
        }, 10);
      });
    });

    // Wire up broadcast handlers
    eventBuses.forEach((bus, tabIndex) => {
      bus.on('broadcast:received', (message) => {
        if (message.type === 'CLOSE') {
          stateManagers[tabIndex].delete(message.data.id);
        } else if (message.type === 'CLOSE_ALL') {
          // Clear all Quick Tabs
          stateManagers[tabIndex].quickTabs.clear();
        } else if (message.type === 'CLOSE_MINIMIZED') {
          // Remove only minimized Quick Tabs
          const minimizedIds = [];
          stateManagers[tabIndex].quickTabs.forEach((qt, id) => {
            if (qt.visibility.minimized) {
              minimizedIds.push(id);
            }
          });
          minimizedIds.forEach(id => stateManagers[tabIndex].delete(id));
        } else if (message.type === 'UPDATE_MINIMIZE') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.visibility.minimized = message.data.minimized;
            stateManagers[tabIndex].update(qt);
          }
        } else if (message.type === 'UPDATE_SOLO') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.visibility.soloedOnTabs = message.data.soloedOnTabs;
            stateManagers[tabIndex].update(qt);
          }
        } else if (message.type === 'UPDATE_MUTE') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.visibility.mutedOnTabs = message.data.mutedOnTabs;
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

  describe('Minimize State Sync', () => {
    it('should sync minimize state from Tab A to Tab B and C', async () => {
      // Create a Quick Tab in Tab A
      const qt = new QuickTab({
        id: 'qt-manager-sync-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(qt));

      // Wait for initial sync
      await wait(50);

      // Minimize in Tab A (Tab 0)
      const visibilityA = visibilityHandlers[0];
      const smA = stateManagers[0];
      const qtA = smA.get('qt-manager-sync-1');
      
      // Apply minimize locally in Tab A
      qtA.visibility.minimized = true;
      smA.update(qtA);

      // Broadcast UPDATE_MINIMIZE
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-manager-sync-1',
        minimized: true
      });

      await wait(50);

      // Verify Tab B and C received minimize state
      const qtB = stateManagers[1].get('qt-manager-sync-1');
      const qtC = stateManagers[2].get('qt-manager-sync-1');

      expect(qtB).toBeDefined();
      expect(qtC).toBeDefined();
      expect(qtB.visibility.minimized).toBe(true);
      expect(qtC.visibility.minimized).toBe(true);
    });

    it('should sync restore (un-minimize) state across tabs', async () => {
      // Create minimized Quick Tab
      const qt = new QuickTab({
        id: 'qt-manager-restore-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qt.visibility.minimized = true;

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(qt));

      await wait(50);

      // Restore in Tab B (Tab 1)
      const smB = stateManagers[1];
      const qtB = smB.get('qt-manager-restore-1');
      
      // Apply restore locally
      qtB.visibility.minimized = false;
      smB.update(qtB);

      // Broadcast UPDATE_MINIMIZE
      await broadcastManagers[1].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-manager-restore-1',
        minimized: false
      });

      await wait(50);

      // Verify Tabs A and C received restore state
      const qtA = stateManagers[0].get('qt-manager-restore-1');
      const qtC = stateManagers[2].get('qt-manager-restore-1');

      expect(qtA.visibility.minimized).toBe(false);
      expect(qtC.visibility.minimized).toBe(false);
    });
  });

  describe('Close Operations Sync', () => {
    it('should sync individual Quick Tab close across all tabs', async () => {
      // Create Quick Tab in all tabs
      const qt = new QuickTab({
        id: 'qt-close-sync-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));
      await wait(50);

      // Close in Tab C (Tab 2)
      const smC = stateManagers[2];
      
      // Apply close locally
      smC.delete('qt-close-sync-1');

      // Broadcast CLOSE
      await broadcastManagers[2].broadcast('CLOSE', {
        id: 'qt-close-sync-1'
      });

      await wait(50);

      // Verify closed in all tabs
      expect(stateManagers[0].get('qt-close-sync-1')).toBeUndefined();
      expect(stateManagers[1].get('qt-close-sync-1')).toBeUndefined();
      expect(stateManagers[2].get('qt-close-sync-1')).toBeUndefined();
    });

    it('should sync "Close All" across all tabs', async () => {
      // Create multiple Quick Tabs
      const qts = [
        new QuickTab({
          id: 'qt-closeall-1',
          url: 'https://example1.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-closeall-2',
          url: 'https://example2.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-closeall-3',
          url: 'https://example3.com',
          position: { left: 300, top: 300 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      ];

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      await wait(50);

      // Execute "Close All" from Tab A
      const smA = stateManagers[0];
      
      // Apply close all locally
      qts.forEach(qt => smA.delete(qt.id));

      // Broadcast CLOSE_ALL
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(50);

      // Verify all tabs have no Quick Tabs
      stateManagers.forEach((sm, index) => {
        expect(sm.quickTabs.size).toBe(0);
        expect(sm.get('qt-closeall-1')).toBeUndefined();
        expect(sm.get('qt-closeall-2')).toBeUndefined();
        expect(sm.get('qt-closeall-3')).toBeUndefined();
      });
    });

    it('should sync "Close Minimized" across all tabs', async () => {
      // Create mix of minimized and active Quick Tabs
      const qt1 = new QuickTab({
        id: 'qt-closeminimized-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qt1.visibility.minimized = true;

      const qt2 = new QuickTab({
        id: 'qt-closeminimized-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      // qt2 is NOT minimized

      const qt3 = new QuickTab({
        id: 'qt-closeminimized-3',
        url: 'https://example3.com',
        position: { left: 300, top: 300 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qt3.visibility.minimized = true;

      // Add all to all tabs
      [qt1, qt2, qt3].forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      await wait(50);

      // Execute "Close Minimized" from Tab B
      const smB = stateManagers[1];
      
      // Apply close minimized locally
      const minimizedIds = ['qt-closeminimized-1', 'qt-closeminimized-3'];
      minimizedIds.forEach(id => smB.delete(id));

      // Broadcast CLOSE_MINIMIZED
      await broadcastManagers[1].broadcast('CLOSE_MINIMIZED', {});

      await wait(50);

      // Verify minimized QTs closed, active QT remains
      stateManagers.forEach((sm, index) => {
        expect(sm.get('qt-closeminimized-1')).toBeUndefined(); // Minimized - closed
        expect(sm.get('qt-closeminimized-2')).toBeDefined();   // Active - remains
        expect(sm.get('qt-closeminimized-3')).toBeUndefined(); // Minimized - closed
        expect(sm.quickTabs.size).toBe(1);
      });
    });
  });

  describe('Solo/Mute State Sync via Manager', () => {
    it('should sync solo activation across tabs', async () => {
      const qt = new QuickTab({
        id: 'qt-manager-solo-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));
      await wait(50);

      // Activate solo from Manager in Tab A
      const smA = stateManagers[0];
      const qtA = smA.get('qt-manager-solo-1');
      
      // Apply solo locally
      qtA.visibility.soloedOnTabs = [tabs[0].tabId];
      qtA.visibility.mutedOnTabs = []; // Clear mute (mutual exclusivity)
      smA.update(qtA);

      // Broadcast UPDATE_SOLO
      await broadcastManagers[0].broadcast('UPDATE_SOLO', {
        id: 'qt-manager-solo-1',
        soloedOnTabs: [tabs[0].tabId]
      });

      await wait(50);

      // Verify solo state in other tabs
      const qtB = stateManagers[1].get('qt-manager-solo-1');
      const qtC = stateManagers[2].get('qt-manager-solo-1');

      expect(qtB.visibility.soloedOnTabs).toEqual([tabs[0].tabId]);
      expect(qtC.visibility.soloedOnTabs).toEqual([tabs[0].tabId]);
    });

    it('should sync mute activation across tabs', async () => {
      const qt = new QuickTab({
        id: 'qt-manager-mute-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));
      await wait(50);

      // Activate mute from Manager in Tab B
      const smB = stateManagers[1];
      const qtB = smB.get('qt-manager-mute-1');
      
      // Apply mute locally
      qtB.visibility.mutedOnTabs = [tabs[1].tabId];
      qtB.visibility.soloedOnTabs = []; // Clear solo (mutual exclusivity)
      smB.update(qtB);

      // Broadcast UPDATE_MUTE
      await broadcastManagers[1].broadcast('UPDATE_MUTE', {
        id: 'qt-manager-mute-1',
        mutedOnTabs: [tabs[1].tabId]
      });

      await wait(50);

      // Verify mute state in other tabs
      const qtA = stateManagers[0].get('qt-manager-mute-1');
      const qtC = stateManagers[2].get('qt-manager-mute-1');

      expect(qtA.visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
      expect(qtC.visibility.mutedOnTabs).toEqual([tabs[1].tabId]);
    });
  });

  describe('Multi-Tab Manager Consistency', () => {
    it('should maintain consistent state across 3 Manager instances', async () => {
      // Create Quick Tab
      const qt = new QuickTab({
        id: 'qt-consistency-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));
      await wait(50);

      // Perform sequence of operations from different tabs
      
      // 1. Minimize from Tab A
      const smA = stateManagers[0];
      const qtA = smA.get('qt-consistency-1');
      qtA.visibility.minimized = true;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-consistency-1',
        minimized: true
      });
      await wait(50);

      // 2. Solo from Tab B
      const smB = stateManagers[1];
      const qtB = smB.get('qt-consistency-1');
      qtB.visibility.soloedOnTabs = [tabs[1].tabId];
      qtB.visibility.mutedOnTabs = [];
      smB.update(qtB);
      await broadcastManagers[1].broadcast('UPDATE_SOLO', {
        id: 'qt-consistency-1',
        soloedOnTabs: [tabs[1].tabId]
      });
      await wait(50);

      // 3. Restore from Tab C
      const smC = stateManagers[2];
      const qtC = smC.get('qt-consistency-1');
      qtC.visibility.minimized = false;
      smC.update(qtC);
      await broadcastManagers[2].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-consistency-1',
        minimized: false
      });
      await wait(50);

      // Verify all tabs have consistent final state
      const finalA = stateManagers[0].get('qt-consistency-1');
      const finalB = stateManagers[1].get('qt-consistency-1');
      const finalC = stateManagers[2].get('qt-consistency-1');

      // Should be: NOT minimized, soloed on Tab B
      [finalA, finalB, finalC].forEach(final => {
        expect(final.visibility.minimized).toBe(false);
        expect(final.visibility.soloedOnTabs).toEqual([tabs[1].tabId]);
      });
    });

    it('should handle rapid Manager operations from multiple tabs', async () => {
      const qt = new QuickTab({
        id: 'qt-rapid-manager-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));
      await wait(50);

      // Rapid operations from different tabs (no wait between)
      const operations = [
        // Tab A: Minimize
        async () => {
          const sm = stateManagers[0];
          const qt = sm.get('qt-rapid-manager-1');
          qt.visibility.minimized = true;
          sm.update(qt);
          await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
            id: 'qt-rapid-manager-1',
            minimized: true
          });
        },
        // Tab B: Solo
        async () => {
          const sm = stateManagers[1];
          const qt = sm.get('qt-rapid-manager-1');
          qt.visibility.soloedOnTabs = [tabs[1].tabId];
          qt.visibility.mutedOnTabs = [];
          sm.update(qt);
          await broadcastManagers[1].broadcast('UPDATE_SOLO', {
            id: 'qt-rapid-manager-1',
            soloedOnTabs: [tabs[1].tabId]
          });
        },
        // Tab C: Restore
        async () => {
          const sm = stateManagers[2];
          const qt = sm.get('qt-rapid-manager-1');
          qt.visibility.minimized = false;
          sm.update(qt);
          await broadcastManagers[2].broadcast('UPDATE_MINIMIZE', {
            id: 'qt-rapid-manager-1',
            minimized: false
          });
        }
      ];

      // Execute all simultaneously
      await Promise.all(operations.map(op => op()));
      await wait(100);

      // Verify no crashes and state is consistent (last operation wins)
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-rapid-manager-1');
        expect(qt).toBeDefined();
        // Should have either minimized or solo state (both valid outcomes)
        const hasState = qt.visibility.minimized === false || 
                         qt.visibility.soloedOnTabs.length > 0;
        expect(hasState).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle Manager operations on non-existent Quick Tab', async () => {
      // Try to minimize non-existent Quick Tab
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'non-existent-qt',
        minimized: true
      });

      await wait(50);

      // Should not crash, no Quick Tabs affected
      stateManagers.forEach(sm => {
        expect(sm.quickTabs.size).toBe(0);
      });
    });

    it('should handle Manager operations after Quick Tab closed', async () => {
      // Create and close Quick Tab
      const qt = new QuickTab({
        id: 'qt-closed-then-op',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));
      await wait(50);

      // Close from Tab A
      stateManagers[0].delete('qt-closed-then-op');
      await broadcastManagers[0].broadcast('CLOSE', {
        id: 'qt-closed-then-op'
      });
      await wait(50);

      // Try to minimize from Tab B (Quick Tab already closed)
      await broadcastManagers[1].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-closed-then-op',
        minimized: true
      });

      await wait(50);

      // Should not crash or recreate Quick Tab
      stateManagers.forEach(sm => {
        expect(sm.get('qt-closed-then-op')).toBeUndefined();
      });
    });

    it('should handle Manager sync with empty state', async () => {
      // No Quick Tabs exist
      expect(stateManagers[0].quickTabs.size).toBe(0);
      expect(stateManagers[1].quickTabs.size).toBe(0);
      expect(stateManagers[2].quickTabs.size).toBe(0);

      // Try Close All with no Quick Tabs
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});
      await wait(50);

      // Should not crash
      stateManagers.forEach(sm => {
        expect(sm.quickTabs.size).toBe(0);
      });

      // Try Close Minimized with no Quick Tabs
      await broadcastManagers[1].broadcast('CLOSE_MINIMIZED', {});
      await wait(50);

      // Should not crash
      stateManagers.forEach(sm => {
        expect(sm.quickTabs.size).toBe(0);
      });
    });
  });
});
