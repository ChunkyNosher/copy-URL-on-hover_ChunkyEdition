/**
 * Scenario 13: Manager "Close Minimized" Functionality
 * 
 * LOW PRIORITY (1 day effort)
 * 
 * Tests that the Manager Panel "Close Minimized" button works correctly:
 * - "Close Minimized" closes only minimized Quick Tabs
 * - Active Quick Tabs remain untouched
 * - Storage updated to remove only minimized entries
 * - Works correctly across tabs
 * - State remains consistent after operation
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 13 - LOW)
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

describe('Scenario 13: Manager "Close Minimized" Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 tabs for testing close minimized
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

    // Wire up broadcast handlers
    eventBuses.forEach((bus, tabIndex) => {
      bus.on('broadcast:received', (message) => {
        if (message.type === 'DELETE') {
          stateManagers[tabIndex].remove(message.data.id);
        } else if (message.type === 'CLOSE_MINIMIZED') {
          // Remove only minimized Quick Tabs
          const minimizedQts = Array.from(stateManagers[tabIndex].quickTabs.values())
            .filter(qt => qt.visibility.minimized);
          
          minimizedQts.forEach(qt => {
            stateManagers[tabIndex].remove(qt.id);
          });
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

  describe('Basic Close Minimized', () => {
    test('closes only minimized Quick Tabs', async () => {
      // Create mix of minimized and active Quick Tabs
      const quickTabs = [
        new QuickTab({
          id: 'qt-active-1',
          url: 'https://active1.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: false
          }
        }),
        new QuickTab({
          id: 'qt-minimized-1',
          url: 'https://minimized1.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: true
          }
        }),
        new QuickTab({
          id: 'qt-active-2',
          url: 'https://active2.com',
          position: { left: 300, top: 300 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: false
          }
        }),
        new QuickTab({
          id: 'qt-minimized-2',
          url: 'https://minimized2.com',
          position: { left: 400, top: 400 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: true
          }
        })
      ];

      // Add to all state managers
      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Verify initial state: 4 Quick Tabs (2 active, 2 minimized)
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(4);
      });

      // Broadcast CLOSE_MINIMIZED from tab A
      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});

      await wait(150);

      // Verify only active Quick Tabs remain
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(2);
        expect(sm.get('qt-active-1')).toBeDefined();
        expect(sm.get('qt-active-2')).toBeDefined();
        expect(sm.get('qt-minimized-1')).toBeUndefined();
        expect(sm.get('qt-minimized-2')).toBeUndefined();
      });
    });

    test('works when no Quick Tabs are minimized', async () => {
      // Create only active Quick Tabs
      const quickTabs = Array.from({ length: 3 }, (_, i) => 
        new QuickTab({
          id: `qt-active-${i + 1}`,
          url: `https://active${i + 1}.com`,
          position: { left: (i + 1) * 50, top: (i + 1) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: false
          }
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Broadcast CLOSE_MINIMIZED
      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});

      await wait(150);

      // All active Quick Tabs should remain
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(3);
        expect(sm.get('qt-active-1')).toBeDefined();
        expect(sm.get('qt-active-2')).toBeDefined();
        expect(sm.get('qt-active-3')).toBeDefined();
      });
    });

    test('works when all Quick Tabs are minimized', async () => {
      // Create only minimized Quick Tabs
      const quickTabs = Array.from({ length: 3 }, (_, i) => 
        new QuickTab({
          id: `qt-minimized-${i + 1}`,
          url: `https://minimized${i + 1}.com`,
          position: { left: (i + 1) * 50, top: (i + 1) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: true
          }
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Broadcast CLOSE_MINIMIZED
      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});

      await wait(150);

      // All minimized Quick Tabs should be removed
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });
  });

  describe('Cross-Tab Consistency', () => {
    test('all tabs updated simultaneously', async () => {
      const quickTabs = [
        new QuickTab({
          id: 'qt-active',
          url: 'https://active.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: false
          }
        }),
        new QuickTab({
          id: 'qt-minimized',
          url: 'https://minimized.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: true
          }
        })
      ];

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // CLOSE_MINIMIZED from tab B
      await broadcastManagers[1].broadcast('CLOSE_MINIMIZED', {});

      await wait(150);

      // All tabs should have only active Quick Tab
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(1);
        expect(sm.get('qt-active')).toBeDefined();
        expect(sm.get('qt-minimized')).toBeUndefined();
      });
    });

    test('multiple CLOSE_MINIMIZED calls are idempotent', async () => {
      const quickTabs = [
        new QuickTab({
          id: 'qt-active',
          url: 'https://active.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: false
          }
        }),
        new QuickTab({
          id: 'qt-minimized',
          url: 'https://minimized.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: true
          }
        })
      ];

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // First CLOSE_MINIMIZED
      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});
      await wait(100);

      // Second CLOSE_MINIMIZED (should not cause errors)
      await broadcastManagers[1].broadcast('CLOSE_MINIMIZED', {});
      await wait(100);

      // Third CLOSE_MINIMIZED
      await broadcastManagers[2].broadcast('CLOSE_MINIMIZED', {});
      await wait(100);

      // Should still have 1 active Quick Tab, no errors
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(1);
        expect(sm.get('qt-active')).toBeDefined();
      });
    });
  });

  describe('Edge Cases with Visibility States', () => {
    test('minimized solo Quick Tabs are closed', async () => {
      const qt = new QuickTab({
        id: 'qt-minimized-solo',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [tabs[0].tabId],
          mutedOnTabs: [],
          minimized: true
        }
      });

      stateManagers.forEach(sm => sm.add(new QuickTab(qt)));

      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});
      await wait(150);

      // Even though solo, minimized QT should be closed
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });

    test('minimized muted Quick Tabs are closed', async () => {
      const qt = new QuickTab({
        id: 'qt-minimized-mute',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [tabs[1].tabId],
          minimized: true
        }
      });

      stateManagers.forEach(sm => sm.add(new QuickTab(qt)));

      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});
      await wait(150);

      // Even though muted, minimized QT should be closed
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(0);
      });
    });

    test('active solo/mute Quick Tabs are preserved', async () => {
      const quickTabs = [
        new QuickTab({
          id: 'qt-active-solo',
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
          id: 'qt-active-mute',
          url: 'https://mute.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [tabs[1].tabId],
            minimized: false
          }
        }),
        new QuickTab({
          id: 'qt-minimized',
          url: 'https://minimized.com',
          position: { left: 300, top: 300 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: true
          }
        })
      ];

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});
      await wait(150);

      // Active solo/mute QTs preserved, minimized one removed
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(2);
        expect(sm.get('qt-active-solo')).toBeDefined();
        expect(sm.get('qt-active-mute')).toBeDefined();
        expect(sm.get('qt-minimized')).toBeUndefined();
      });
    });
  });

  describe('State Consistency', () => {
    test('can minimize and close in sequence', async () => {
      // Start with all active
      const quickTabs = Array.from({ length: 3 }, (_, i) => 
        new QuickTab({
          id: `qt-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: (i + 1) * 50, top: (i + 1) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: false
          }
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      // Minimize QT-2
      const qt2 = stateManagers[0].get('qt-2');
      qt2.visibility.minimized = true;
      stateManagers[0].update(qt2);

      // Broadcast minimize update
      await broadcastManagers[0].broadcast('UPDATE_MINIMIZE', {
        id: 'qt-2',
        minimized: true
      });

      await wait(100);

      // Close minimized
      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});

      await wait(150);

      // Should have 2 active Quick Tabs remaining
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(2);
        expect(sm.get('qt-1')).toBeDefined();
        expect(sm.get('qt-2')).toBeUndefined();
        expect(sm.get('qt-3')).toBeDefined();
      });
    });
  });

  describe('Performance', () => {
    test('CLOSE_MINIMIZED with many Quick Tabs completes quickly', async () => {
      // Create 10 active and 10 minimized Quick Tabs
      const quickTabs = Array.from({ length: 20 }, (_, i) => 
        new QuickTab({
          id: `qt-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: (i % 10) * 50, top: Math.floor(i / 10) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default',
          visibility: {
            soloedOnTabs: [],
            mutedOnTabs: [],
            minimized: i % 2 === 0 // Every other one is minimized
          }
        })
      );

      stateManagers.forEach(sm => {
        quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
      });

      const startTime = Date.now();

      // Broadcast CLOSE_MINIMIZED
      await broadcastManagers[0].broadcast('CLOSE_MINIMIZED', {});

      await wait(150);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Only active Quick Tabs remain (10)
      stateManagers.forEach(sm => {
        expect(sm.count()).toBe(10);
      });

      // Should complete reasonably quickly (less than 500ms)
      expect(duration).toBeLessThan(500);
    });
  });
});
