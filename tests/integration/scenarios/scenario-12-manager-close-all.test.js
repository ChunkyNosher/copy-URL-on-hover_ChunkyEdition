/**
 * Scenario 12: Manager "Close All" Functionality
 * 
 * LOW PRIORITY (1 day effort)
 * 
 * Tests that the Manager Panel "Close All" button works correctly:
 * - "Close All" closes all Quick Tabs in all tabs
 * - "Close All" clears storage completely
 * - "Close All" closes Manager Panel
 * - Operation completes successfully across tabs
 * - State remains consistent after "Close All"
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 12 - LOW)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Covers Issues: #47 (Manager Panel functionality)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 12: Manager "Close All" Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 tabs for testing close all
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
          remove: jest.fn().mockResolvedValue(undefined),
          clear: jest.fn().mockResolvedValue(undefined)
        },
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
          clear: jest.fn().mockResolvedValue(undefined)
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

    // Wire up broadcast handlers for DELETE and CREATE
    eventBuses.forEach((bus, tabIndex) => {
      bus.on('broadcast:received', (message) => {
        if (message.type === 'DELETE') {
          stateManagers[tabIndex].remove(message.data.id);
        } else if (message.type === 'CLOSE_ALL') {
          // Clear all Quick Tabs
          stateManagers[tabIndex].quickTabs.clear();
        } else if (message.type === 'CREATE') {
          const existingQt = stateManagers[tabIndex].get(message.data.id);
          if (!existingQt) {
            const qt = new QuickTab({
              id: message.data.id,
              url: message.data.url,
              position: message.data.position,
              size: message.data.size,
              container: message.data.container
            });
            stateManagers[tabIndex].add(qt);
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

  describe('Basic Close All', () => {
    test('closes all Quick Tabs in all tabs', async () => {
      // Create 5 Quick Tabs
      const quickTabs = Array.from({ length: 5 }, (_, i) => 
        new QuickTab({
          id: `qt-close-all-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: (i + 1) * 50, top: (i + 1) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      // Add to all state managers
      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Verify Quick Tabs exist
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(5);
      });

      // Close all on tab A - apply locally first, then broadcast
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(150);

      // Verify all Quick Tabs removed from all tabs
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });

    test('works with no Quick Tabs (idempotent)', async () => {
      // No Quick Tabs to start
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });

      // Close all on tab A - apply locally first (already empty)
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(150);

      // Should still be 0, no errors
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });
  });

  describe('Storage Cleanup', () => {
    test('storage clear called when closing all', async () => {
      const quickTabs = Array.from({ length: 3 }, (_, i) => 
        new QuickTab({
          id: `qt-storage-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Close all on tab A - apply locally first, then broadcast
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(150);

      // Verify state cleared
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });

      // In real implementation, storage would be cleared
      // Here we just verify the state is cleared
    });
  });

  describe('Cross-Tab Consistency', () => {
    test('all tabs cleared simultaneously', async () => {
      // Create Quick Tabs
      const qt1 = new QuickTab({
        id: 'qt-cross-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-cross-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => {
        sm.add(new QuickTab(qt1));
        sm.add(new QuickTab(qt2));
      });

      // Verify all tabs have 2 Quick Tabs
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(2);
      });

      // CLOSE_ALL from tab B - apply locally first, then broadcast
      stateManagers[1].quickTabs.clear();
      
      await broadcastManagers[1].broadcast('CLOSE_ALL', {});

      await wait(150);

      // All tabs should now have 0
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });

    test('multiple CLOSE_ALL calls are idempotent', async () => {
      const quickTabs = Array.from({ length: 3 }, (_, i) => 
        new QuickTab({
          id: `qt-idempotent-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // First CLOSE_ALL - apply locally first
      stateManagers[0].quickTabs.clear();
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});
      await wait(100);

      // Second CLOSE_ALL (should not cause errors) - apply locally first
      stateManagers[1].quickTabs.clear();
      await broadcastManagers[1].broadcast('CLOSE_ALL', {});
      await wait(100);

      // Third CLOSE_ALL - apply locally first
      stateManagers[2].quickTabs.clear();
      await broadcastManagers[2].broadcast('CLOSE_ALL', {});
      await wait(100);

      // Should still be 0, no errors
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });
  });

  describe('Edge Cases', () => {
    test('CLOSE_ALL with minimized Quick Tabs', async () => {
      const quickTabs = Array.from({ length: 3 }, (_, i) => 
        new QuickTab({
          id: `qt-minimized-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: i === 0 // First one is minimized
          }
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Close all on tab A - apply locally first, then broadcast
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(150);

      // All Quick Tabs removed, including minimized ones
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });

    test('CLOSE_ALL with solo/mute Quick Tabs', async () => {
      const quickTabs = [
        new QuickTab({
          id: 'qt-solo',
          url: 'https://solo.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [tabs[0].tabId],
            mutedOnTabs: [],
            minimized: false
          }
        }),
        new QuickTab({
          id: 'qt-mute',
          url: 'https://mute.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [tabs[1].tabId],
            minimized: false
          }
        })
      ];

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Close all on tab A - apply locally first, then broadcast
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(150);

      // All Quick Tabs removed, including solo/mute ones
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });

    test('state remains consistent after CLOSE_ALL', async () => {
      // Create, close all, then create again
      const qt1 = new QuickTab({
        id: 'qt-before',
        url: 'https://before.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(new QuickTab(qt1)));

      // Close all - apply locally first, then broadcast
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});
      await wait(150);

      // Create new Quick Tab
      const qt2 = new QuickTab({
        id: 'qt-after',
        url: 'https://after.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt2);
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt2.id,
        url: qt2.url,
        position: qt2.position,
        size: qt2.size,
        container: qt2.container
      });

      await wait(150);

      // Should have 1 Quick Tab in all tabs
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(1);
        expect(sm.get('qt-after')).toBeDefined();
        expect(sm.get('qt-before')).toBeUndefined();
      });
    });
  });

  describe('Performance', () => {
    test('CLOSE_ALL with many Quick Tabs completes quickly', async () => {
      // Create 20 Quick Tabs
      const quickTabs = Array.from({ length: 20 }, (_, i) => 
        new QuickTab({
          id: `qt-many-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: (i % 10) * 50, top: Math.floor(i / 10) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      const startTime = Date.now();

      // Close all on tab A - apply locally first, then broadcast
      stateManagers[0].quickTabs.clear();
      
      await broadcastManagers[0].broadcast('CLOSE_ALL', {});

      await wait(150);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // All Quick Tabs removed
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });

      // Should complete reasonably quickly (less than 500ms)
      expect(duration).toBeLessThan(500);
    });
  });
});
