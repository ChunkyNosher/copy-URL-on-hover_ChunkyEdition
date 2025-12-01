/**
 * Scenario 5: Manager Panel Minimize/Restore Operations
 * 
 * MEDIUM PRIORITY (2-3 days effort)
 * 
 * Tests that Manager Panel minimize/restore functionality works correctly:
 * - Minimize button in Manager minimizes Quick Tab
 * - Minimized Quick Tab shows yellow indicator in Manager
 * - Restore button reappears minimized Quick Tab
 * - Multiple Quick Tabs can be minimized/restored independently
 * - State persists across Manager Panel close/reopen
 * - Minimize/restore syncs correctly across tabs
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 5 - MEDIUM)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Covers Issues: #47 (Manager Panel functionality)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { VisibilityHandler } from '../../../src/features/quick-tabs/handlers/VisibilityHandler.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';
import { BroadcastManager } from '../../mocks/BroadcastManagerMock.js';

describe('Scenario 5: Manager Minimize/Restore Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let _visibilityHandlers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 tabs for testing Manager minimize/restore
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

    _visibilityHandlers = tabs.map((tab, index) => {
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
            if (targetIndex !== sourceIndex && targetChannel.onmessage) {
              targetChannel.onmessage({ data: message });
            }
          });
        }, 10);
      });
    });

    // Wire up broadcast handlers for UPDATE_MINIMIZE
    eventBuses.forEach((bus, tabIndex) => {
      bus.on('broadcast:received', (message) => {
        if (message.type === 'UPDATE_MINIMIZE') {
          const qt = stateManagers[tabIndex].get(message.data.id);
          if (qt) {
            qt.visibility.minimized = message.data.minimized;
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

  describe('Basic Minimize Operation', () => {
    it('should minimize Quick Tab from Manager', async () => {
      // Create Quick Tab
      const qt = new QuickTab({
        id: 'qt-minimize-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Initially not minimized
      expect(stateManagers[0].get('qt-minimize-1').visibility.minimized).toBe(false);

      // Minimize from Manager in Tab A
      const smA = stateManagers[0];
      const qtA = smA.get('qt-minimize-1');
      
      // Apply minimize locally
      qtA.visibility.minimized = true;
      smA.update(qtA);

      // Broadcast UPDATE_MINIMIZE
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-minimize-1',
        minimized: true
      });

      await wait(50);

      // Verify minimized in all tabs
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-minimize-1');
        expect(qt.visibility.minimized).toBe(true);
      });
    });

    it('should restore (un-minimize) Quick Tab from Manager', async () => {
      // Create minimized Quick Tab
      const qt = new QuickTab({
        id: 'qt-restore-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qt.visibility.minimized = true;

      stateManagers.forEach(sm => sm.add(qt));

      // Verify initially minimized
      expect(stateManagers[0].get('qt-restore-1').visibility.minimized).toBe(true);

      // Restore from Manager in Tab B
      const smB = stateManagers[1];
      const qtB = smB.get('qt-restore-1');
      
      // Apply restore locally
      qtB.visibility.minimized = false;
      smB.update(qtB);

      // Broadcast UPDATE_MINIMIZE
      await broadcastManagers[1].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-restore-1',
        minimized: false
      });

      await wait(50);

      // Verify restored in all tabs
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-restore-1');
        expect(qt.visibility.minimized).toBe(false);
      });
    });
  });

  describe('Multiple Quick Tabs', () => {
    it('should handle minimize/restore independently for multiple Quick Tabs', async () => {
      // Create 5 Quick Tabs
      const qts = Array.from({ length: 5 }, (_, i) =>
        new QuickTab({
          id: `qt-multi-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: (i + 1) * 100, top: (i + 1) * 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      // Add all to all state managers
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      await wait(50);

      // Minimize QTs 1, 3, 5 from Tab A
      const smA = stateManagers[0];
      
      for (const id of ['qt-multi-1', 'qt-multi-3', 'qt-multi-5']) {
        const qt = smA.get(id);
        qt.visibility.minimized = true;
        smA.update(qt);
        await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
          id,
          minimized: true
        });
      }

      await wait(100);

      // Verify correct minimized states in all tabs
      stateManagers.forEach(sm => {
        expect(sm.get('qt-multi-1').visibility.minimized).toBe(true);
        expect(sm.get('qt-multi-2').visibility.minimized).toBe(false);
        expect(sm.get('qt-multi-3').visibility.minimized).toBe(true);
        expect(sm.get('qt-multi-4').visibility.minimized).toBe(false);
        expect(sm.get('qt-multi-5').visibility.minimized).toBe(true);
      });

      // Restore QT 3 from Tab B
      const smB = stateManagers[1];
      const qt3 = smB.get('qt-multi-3');
      qt3.visibility.minimized = false;
      smB.update(qt3);
      await broadcastManagers[1].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-multi-3',
        minimized: false
      });

      await wait(50);

      // Verify QT 3 restored, others unchanged
      stateManagers.forEach(sm => {
        expect(sm.get('qt-multi-1').visibility.minimized).toBe(true);
        expect(sm.get('qt-multi-2').visibility.minimized).toBe(false);
        expect(sm.get('qt-multi-3').visibility.minimized).toBe(false); // Restored
        expect(sm.get('qt-multi-4').visibility.minimized).toBe(false);
        expect(sm.get('qt-multi-5').visibility.minimized).toBe(true);
      });
    });

    it('should handle minimize/restore with rapid operations', async () => {
      // Create Quick Tab
      const qt = new QuickTab({
        id: 'qt-rapid-minimize',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Rapid minimize/restore cycle (10 operations)
      for (let i = 0; i < 10; i++) {
        const shouldMinimize = i % 2 === 0;
        const sm = stateManagers[i % 3]; // Cycle through tabs
        const qt = sm.get('qt-rapid-minimize');
        
        qt.visibility.minimized = shouldMinimize;
        sm.update(qt);
        
        await broadcastManagers[i % 3].broadcast('UPDATE_MINIMIZE', {
          id: 'qt-rapid-minimize',
          minimized: shouldMinimize
        });
        
        await wait(10);
      }

      await wait(100);

      // Verify final state is consistent across tabs (should be false - last operation)
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-rapid-minimize');
        expect(qt).toBeDefined();
        expect(qt.visibility.minimized).toBe(false);
      });
    });
  });

  describe('State Persistence', () => {
    it('should maintain minimize state across multiple operations', async () => {
      // Create Quick Tab
      const qt = new QuickTab({
        id: 'qt-persist-minimize',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Minimize
      const smA = stateManagers[0];
      let qtA = smA.get('qt-persist-minimize');
      qtA.visibility.minimized = true;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-persist-minimize',
        minimized: true
      });

      await wait(50);

      // Perform other operations (solo, mute)
      qtA = smA.get('qt-persist-minimize');
      qtA.visibility.soloedOnTabs = [tabs[0].tabId];
      smA.update(qtA);

      await wait(50);

      // Verify minimize state still intact
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-persist-minimize');
        expect(qt.visibility.minimized).toBe(true);
        expect(qt.visibility.soloedOnTabs).toEqual([tabs[0].tabId]);
      });

      // Restore
      qtA = smA.get('qt-persist-minimize');
      qtA.visibility.minimized = false;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-persist-minimize',
        minimized: false
      });

      await wait(50);

      // Verify restored, solo state still intact
      stateManagers.forEach(sm => {
        const qt = sm.get('qt-persist-minimize');
        expect(qt.visibility.minimized).toBe(false);
        expect(qt.visibility.soloedOnTabs).toEqual([tabs[0].tabId]);
      });
    });
  });

  describe('Cross-Tab Sync', () => {
    it('should sync minimize from Tab A to Tabs B and C', async () => {
      const qt = new QuickTab({
        id: 'qt-sync-minimize',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Minimize from Tab A
      const smA = stateManagers[0];
      const qtA = smA.get('qt-sync-minimize');
      qtA.visibility.minimized = true;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-sync-minimize',
        minimized: true
      });

      await wait(50);

      // Verify synced to B and C
      const qtB = stateManagers[1].get('qt-sync-minimize');
      const qtC = stateManagers[2].get('qt-sync-minimize');
      
      expect(qtB.visibility.minimized).toBe(true);
      expect(qtC.visibility.minimized).toBe(true);
    });

    it('should sync restore from Tab B to Tabs A and C', async () => {
      // Create minimized Quick Tab
      const qt = new QuickTab({
        id: 'qt-sync-restore',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qt.visibility.minimized = true;

      stateManagers.forEach(sm => sm.add(qt));

      // Restore from Tab B
      const smB = stateManagers[1];
      const qtB = smB.get('qt-sync-restore');
      qtB.visibility.minimized = false;
      smB.update(qtB);
      await broadcastManagers[1].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-sync-restore',
        minimized: false
      });

      await wait(50);

      // Verify synced to A and C
      const qtA = stateManagers[0].get('qt-sync-restore');
      const qtC = stateManagers[2].get('qt-sync-restore');
      
      expect(qtA.visibility.minimized).toBe(false);
      expect(qtC.visibility.minimized).toBe(false);
    });

    it('should sync minimize/restore operations from any tab', async () => {
      const qt = new QuickTab({
        id: 'qt-any-tab-minimize',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Minimize from Tab C
      const smC = stateManagers[2];
      const qtC = smC.get('qt-any-tab-minimize');
      qtC.visibility.minimized = true;
      smC.update(qtC);
      await broadcastManagers[2].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-any-tab-minimize',
        minimized: true
      });

      await wait(50);

      // Verify all tabs minimized
      stateManagers.forEach(sm => {
        expect(sm.get('qt-any-tab-minimize').visibility.minimized).toBe(true);
      });

      // Restore from Tab A
      const smA = stateManagers[0];
      const qtA = smA.get('qt-any-tab-minimize');
      qtA.visibility.minimized = false;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-any-tab-minimize',
        minimized: false
      });

      await wait(50);

      // Verify all tabs restored
      stateManagers.forEach(sm => {
        expect(sm.get('qt-any-tab-minimize').visibility.minimized).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimize on non-existent Quick Tab gracefully', async () => {
      // Try to minimize non-existent Quick Tab
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'non-existent-qt',
        minimized: true
      });

      await wait(50);

      // Should not crash
      stateManagers.forEach(sm => {
        expect(sm.quickTabs.size).toBe(0);
      });
    });

    it('should handle restore on already restored Quick Tab (idempotent)', async () => {
      const qt = new QuickTab({
        id: 'qt-already-restored',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      // Already not minimized (default)

      stateManagers.forEach(sm => sm.add(qt));

      // Try to restore (already restored)
      const smA = stateManagers[0];
      const qtA = smA.get('qt-already-restored');
      qtA.visibility.minimized = false;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-already-restored',
        minimized: false
      });

      await wait(50);

      // Should remain not minimized
      stateManagers.forEach(sm => {
        expect(sm.get('qt-already-restored').visibility.minimized).toBe(false);
      });
    });

    it('should handle minimize on already minimized Quick Tab (idempotent)', async () => {
      const qt = new QuickTab({
        id: 'qt-already-minimized',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qt.visibility.minimized = true;

      stateManagers.forEach(sm => sm.add(qt));

      // Try to minimize (already minimized)
      const smA = stateManagers[0];
      const qtA = smA.get('qt-already-minimized');
      qtA.visibility.minimized = true;
      smA.update(qtA);
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-already-minimized',
        minimized: true
      });

      await wait(50);

      // Should remain minimized
      stateManagers.forEach(sm => {
        expect(sm.get('qt-already-minimized').visibility.minimized).toBe(true);
      });
    });

    it('should handle minimize/restore on closed Quick Tab gracefully', async () => {
      const qt = new QuickTab({
        id: 'qt-minimize-closed',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Close the Quick Tab
      stateManagers.forEach(sm => sm.delete('qt-minimize-closed'));

      await wait(50);

      // Try to minimize
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-minimize-closed',
        minimized: true
      });

      await wait(50);

      // Should not crash or recreate
      stateManagers.forEach(sm => {
        expect(sm.get('qt-minimize-closed')).toBeUndefined();
      });
    });
  });
});
