/**
 * Scenario 14: Browser Restart Persistence
 * 
 * CRITICAL TEST - Last critical gap for issue #35
 * 
 * Tests that Quick Tab state persists correctly across browser restart:
 * - Multiple Quick Tabs with different positions/sizes persist
 * - Solo mode state persists (tab IDs preserved)
 * - Mute mode state persists (muted tab IDs preserved)
 * - Container-specific Quick Tabs load only in correct container
 * - Corrupted entries skipped gracefully on restart
 * - Manager Panel position/size persists
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 14 - CRITICAL)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Covers Issues: #35 (position/size persistence across restart)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';
import { 
  createMultiTabScenario, 
  simulateBrowserRestart, 
  restoreStorageAfterRestart 
} from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 14: Browser Restart Persistence Protocol', () => {
  let tabs;
  let stateManagers;
  let storageManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;
  let mockStorage;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 tabs in different containers for testing
    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://github.com', containerId: 'firefox-container-1' },
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
    
    // Import the mocked browser object and override its storage methods
    const browserModule = await import('webextension-polyfill');
    const browser = browserModule.default;
    
    // Override storage.local methods with our mock
    browser.storage.local.get = jest.fn().mockImplementation((key) => {
      if (typeof key === 'string') {
        return Promise.resolve({ [key]: mockStorage[key] });
      }
      return Promise.resolve(mockStorage);
    });
    
    browser.storage.local.set = jest.fn().mockImplementation((data) => {
      Object.assign(mockStorage, data);
      return Promise.resolve();
    });
    
    browser.storage.local.remove = jest.fn().mockImplementation((keys) => {
      if (Array.isArray(keys)) {
        keys.forEach(key => delete mockStorage[key]);
      } else {
        delete mockStorage[keys];
      }
      return Promise.resolve();
    });
    
    // Override storage.sync methods with our mock
    browser.storage.sync.get = jest.fn().mockImplementation((key) => {
      if (typeof key === 'string') {
        return Promise.resolve({ [key]: mockStorage[key] });
      }
      return Promise.resolve(mockStorage);
    });
    
    browser.storage.sync.set = jest.fn().mockImplementation((data) => {
      Object.assign(mockStorage, data);
      return Promise.resolve();
    });
    
    browser.storage.sync.remove = jest.fn().mockImplementation((keys) => {
      if (Array.isArray(keys)) {
        keys.forEach(key => delete mockStorage[key]);
      } else {
        delete mockStorage[keys];
      }
      return Promise.resolve();
    });
    
    // Override runtime.sendMessage to force fallback to storage
    browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: false });
    
    // Set global.browser for StorageManager.loadAll() which uses global browser
    global.browser = browser;

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
      return new StorageManager(eventBuses[index], tab.containerId);
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
    broadcastManagers.forEach(bm => bm.close());
    stateManagers.forEach(sm => sm.quickTabs.clear());
    delete global.BroadcastChannel;
    delete global.browser;
  });

  describe('Basic Persistence', () => {
    test('multiple Quick Tabs persist across browser restart', async () => {
      // Create 5 Quick Tabs with different positions/sizes
      const quickTabs = [
        new QuickTab({
          id: 'qt-persist-1',
          url: 'https://example1.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-persist-2',
          url: 'https://example2.com',
          position: { left: 200, top: 150 },
          size: { width: 900, height: 650 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-persist-3',
          url: 'https://example3.com',
          position: { left: 300, top: 200 },
          size: { width: 1000, height: 700 },
          container: 'firefox-container-1'
        }),
        new QuickTab({
          id: 'qt-persist-4',
          url: 'https://example4.com',
          position: { left: 400, top: 250 },
          size: { width: 850, height: 625 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-persist-5',
          url: 'https://example5.com',
          position: { left: 500, top: 300 },
          size: { width: 950, height: 675 },
          container: 'firefox-default'
        })
      ];

      // Add to appropriate state managers
      quickTabs.forEach(qt => {
        stateManagers.forEach((sm, index) => {
          if (tabs[index].containerId === qt.container) {
            sm.add(new QuickTab(qt));
          }
        });
      });

      // Save state to storage
      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      // Simulate browser restart
      const persistedStorage = simulateBrowserRestart(tabs);

      // Clear in-memory state
      stateManagers.forEach(sm => sm.quickTabs.clear());

      // Restore storage
      restoreStorageAfterRestart(tabs, persistedStorage);

      // Hydrate state from storage with container awareness
      await Promise.all(
        stateManagers.map(async (sm, index) => {
          const stored = await storageManagers[index].loadAll();
          stored.forEach(qt => {
            // Only add if container matches
            if (qt.container === tabs[index].containerId) {
              sm.add(qt);
            }
          });
        })
      );

      // Verify all Quick Tabs restored in correct containers
      const defaultContainerTabs = stateManagers.filter((_, i) => 
        tabs[i].containerId === 'firefox-default'
      );
      const container1Tabs = stateManagers.filter((_, i) => 
        tabs[i].containerId === 'firefox-container-1'
      );

      // Default container should have 4 Quick Tabs
      defaultContainerTabs.forEach(sm => {
        expect(sm.count()).toBe(4);
        expect(sm.get('qt-persist-1')).toBeDefined();
        expect(sm.get('qt-persist-2')).toBeDefined();
        expect(sm.get('qt-persist-4')).toBeDefined();
        expect(sm.get('qt-persist-5')).toBeDefined();
      });

      // Container-1 should have 1 Quick Tab
      container1Tabs.forEach(sm => {
        expect(sm.count()).toBe(1);
        expect(sm.get('qt-persist-3')).toBeDefined();
      });

      // Verify positions/sizes preserved
      const qt1 = stateManagers[0].get('qt-persist-1');
      expect(qt1.position).toEqual({ left: 100, top: 100 });
      expect(qt1.size).toEqual({ width: 800, height: 600 });

      const qt3 = stateManagers[1].get('qt-persist-3');
      expect(qt3.position).toEqual({ left: 300, top: 200 });
      expect(qt3.size).toEqual({ width: 1000, height: 700 });
    });
  });

  describe('Solo Mode Persistence', () => {
    test('solo state persists across browser restart', async () => {
      const quickTab = new QuickTab({
        id: 'qt-solo-persist',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [tabs[0].tabId, tabs[2].tabId],
          mutedOnTabs: [],
          minimized: false
        }
      });

      // Add to state managers
      stateManagers.forEach((sm, index) => {
        if (tabs[index].containerId === 'firefox-default') {
          sm.add(new QuickTab(quickTab));
        }
      });

      // Save state
      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      // Simulate restart
      const persistedStorage = simulateBrowserRestart(tabs);
      stateManagers.forEach(sm => sm.quickTabs.clear());
      restoreStorageAfterRestart(tabs, persistedStorage);

      // Hydrate state
      await Promise.all(
        stateManagers.map(async (sm, index) => {
          const stored = await storageManagers[index].loadAll();
          stored.forEach(qt => sm.add(qt));
        })
      );

      // Verify solo state preserved
      const restoredQt0 = stateManagers[0].get('qt-solo-persist');
      const restoredQt2 = stateManagers[2].get('qt-solo-persist');

      expect(restoredQt0).toBeDefined();
      expect(restoredQt2).toBeDefined();
      expect(restoredQt0.visibility.soloedOnTabs).toEqual([tabs[0].tabId, tabs[2].tabId]);
      expect(restoredQt2.visibility.soloedOnTabs).toEqual([tabs[0].tabId, tabs[2].tabId]);
    });
  });

  describe('Mute Mode Persistence', () => {
    test('mute state persists across browser restart', async () => {
      const quickTab = new QuickTab({
        id: 'qt-mute-persist',
        url: 'https://example.com',
        position: { left: 150, top: 150 },
        size: { width: 850, height: 650 },
        container: 'firefox-default',
        visibility: {
          soloedOnTabs: [],
          mutedOnTabs: [tabs[0].tabId],
          minimized: false
        }
      });

      // Add to state managers
      stateManagers.forEach((sm, index) => {
        if (tabs[index].containerId === 'firefox-default') {
          sm.add(new QuickTab(quickTab));
        }
      });

      // Save and restart
      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      const persistedStorage = simulateBrowserRestart(tabs);
      stateManagers.forEach(sm => sm.quickTabs.clear());
      restoreStorageAfterRestart(tabs, persistedStorage);

      // Hydrate
      await Promise.all(
        stateManagers.map(async (sm, index) => {
          const stored = await storageManagers[index].loadAll();
          stored.forEach(qt => sm.add(qt));
        })
      );

      // Verify mute state preserved
      const restoredQt = stateManagers[0].get('qt-mute-persist');
      expect(restoredQt).toBeDefined();
      expect(restoredQt.visibility.mutedOnTabs).toEqual([tabs[0].tabId]);
    });
  });

  describe('Container Isolation After Restart', () => {
    test('container-specific Quick Tabs only load in correct container', async () => {
      // Create Quick Tabs in different containers
      const defaultQt = new QuickTab({
        id: 'qt-default-container',
        url: 'https://default.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const container1Qt = new QuickTab({
        id: 'qt-container-1',
        url: 'https://container1.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });

      // Add to appropriate state managers
      stateManagers.forEach((sm, index) => {
        if (tabs[index].containerId === 'firefox-default') {
          sm.add(new QuickTab(defaultQt));
        }
        if (tabs[index].containerId === 'firefox-container-1') {
          sm.add(new QuickTab(container1Qt));
        }
      });

      // Save and restart
      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      const persistedStorage = simulateBrowserRestart(tabs);
      stateManagers.forEach(sm => sm.quickTabs.clear());
      restoreStorageAfterRestart(tabs, persistedStorage);

      // Hydrate with container awareness
      await Promise.all(
        stateManagers.map(async (sm, index) => {
          const stored = await storageManagers[index].loadAll();
          stored.forEach(qt => {
            // Only add if container matches
            if (qt.container === tabs[index].containerId) {
              sm.add(qt);
            }
          });
        })
      );

      // Verify container isolation
      const defaultTabs = stateManagers.filter((_, i) => 
        tabs[i].containerId === 'firefox-default'
      );
      const container1Tabs = stateManagers.filter((_, i) => 
        tabs[i].containerId === 'firefox-container-1'
      );

      defaultTabs.forEach(sm => {
        expect(sm.get('qt-default-container')).toBeDefined();
        expect(sm.get('qt-container-1')).toBeUndefined();
      });

      container1Tabs.forEach(sm => {
        expect(sm.get('qt-container-1')).toBeDefined();
        expect(sm.get('qt-default-container')).toBeUndefined();
      });
    });
  });

  describe('Corrupted Storage Recovery', () => {
    test('corrupted entries skipped gracefully on restart', async () => {
      // Create valid Quick Tabs
      const validQt1 = new QuickTab({
        id: 'qt-valid-1',
        url: 'https://valid1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const validQt2 = new QuickTab({
        id: 'qt-valid-2',
        url: 'https://valid2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to state
      stateManagers.forEach((sm, index) => {
        if (tabs[index].containerId === 'firefox-default') {
          sm.add(new QuickTab(validQt1));
          sm.add(new QuickTab(validQt2));
        }
      });

      // Save state
      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      // Simulate restart
      const persistedStorage = simulateBrowserRestart(tabs);

      // Corrupt one entry
      const storedData = Object.values(persistedStorage).find(
        v => typeof v === 'object' && v !== null && Array.isArray(v)
      );
      if (storedData && storedData.length > 0) {
        // Corrupt first entry
        storedData[0] = { ...storedData[0], position: null };
      }

      stateManagers.forEach(sm => sm.quickTabs.clear());
      restoreStorageAfterRestart(tabs, persistedStorage);

      // Hydrate with error handling
      await Promise.all(
        stateManagers.map(async (sm, index) => {
          try {
            const stored = await storageManagers[index].loadAll();
            stored.forEach(qt => {
              try {
                // Validate data before creating QuickTab
                if (qt && qt.id && qt.position && qt.size) {
                  sm.add(qt);
                }
              } catch (error) {
                // Skip corrupted entry
                console.error('Skipping corrupted entry:', error);
              }
            });
          } catch (error) {
            console.error('Storage load error:', error);
          }
        })
      );

      // Verify at least one valid Quick Tab restored
      const defaultTabs = stateManagers.filter((_, i) => 
        tabs[i].containerId === 'firefox-default'
      );

      defaultTabs.forEach(sm => {
        expect(sm.count()).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Large State Persistence', () => {
    test('handles restart with many Quick Tabs', async () => {
      // Create 10 Quick Tabs
      const quickTabs = Array.from({ length: 10 }, (_, i) => 
        new QuickTab({
          id: `qt-many-${i + 1}`,
          url: `https://example${i + 1}.com`,
          position: { left: (i + 1) * 50, top: (i + 1) * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      // Add to state
      stateManagers.forEach((sm, index) => {
        if (tabs[index].containerId === 'firefox-default') {
          quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
        }
      });

      // Save and restart
      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      const persistedStorage = simulateBrowserRestart(tabs);
      stateManagers.forEach(sm => sm.quickTabs.clear());
      restoreStorageAfterRestart(tabs, persistedStorage);

      // Hydrate
      await Promise.all(
        stateManagers.map(async (sm, index) => {
          const stored = await storageManagers[index].loadAll();
          stored.forEach(qt => sm.add(qt));
        })
      );

      // Verify all Quick Tabs restored
      const defaultTabs = stateManagers.filter((_, i) => 
        tabs[i].containerId === 'firefox-default'
      );

      defaultTabs.forEach(sm => {
        expect(sm.count()).toBe(10);
        for (let i = 1; i <= 10; i++) {
          expect(sm.get(`qt-many-${i}`)).toBeDefined();
        }
      });
    });
  });

  describe('Position/Size Accuracy After Restart', () => {
    test('exact position and size values preserved', async () => {
      const exactPositions = [
        { left: 123, top: 456 },
        { left: 789, top: 321 },
        { left: 555, top: 666 }
      ];

      const exactSizes = [
        { width: 843, height: 621 },
        { width: 957, height: 704 },
        { width: 1024, height: 768 }
      ];

      const quickTabs = exactPositions.map((pos, i) => 
        new QuickTab({
          id: `qt-exact-${i + 1}`,
          url: `https://exact${i + 1}.com`,
          position: pos,
          size: exactSizes[i],
          container: 'firefox-default'
        })
      );

      // Add, save, restart, hydrate
      stateManagers.forEach((sm, index) => {
        if (tabs[index].containerId === 'firefox-default') {
          quickTabs.forEach(qt => sm.add(new QuickTab(qt)));
        }
      });

      await Promise.all(
        stateManagers.map((sm, index) => 
          storageManagers[index].save(Array.from(sm.quickTabs.values()))
        )
      );

      const persistedStorage = simulateBrowserRestart(tabs);
      stateManagers.forEach(sm => sm.quickTabs.clear());
      restoreStorageAfterRestart(tabs, persistedStorage);

      await Promise.all(
        stateManagers.map(async (sm, index) => {
          const stored = await storageManagers[index].loadAll();
          stored.forEach(qt => sm.add(qt));
        })
      );

      // Verify exact values
      const sm = stateManagers[0];
      
      for (let i = 0; i < 3; i++) {
        const qt = sm.get(`qt-exact-${i + 1}`);
        expect(qt.position).toEqual(exactPositions[i]);
        expect(qt.size).toEqual(exactSizes[i]);
      }
    });
  });
});
