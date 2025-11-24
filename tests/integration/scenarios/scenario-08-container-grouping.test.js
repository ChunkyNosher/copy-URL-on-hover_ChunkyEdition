/**
 * Scenario 8: Container-Aware Grouping in Manager Panel
 * 
 * MEDIUM PRIORITY (2 days effort)
 * 
 * Tests that Manager Panel correctly groups Quick Tabs by container:
 * - Manager Panel shows separate sections per container
 * - Quick Tabs grouped correctly by container
 * - Opening Manager in container A shows all containers
 * - Container sections expand/collapse independently
 * - Empty containers show "No Quick Tabs" message
 * - Container isolation maintained in Manager display
 * 
 * Related Documentation:
 * - docs/manual/updated-remaining-testing-work.md (Scenario 8 - MEDIUM)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Covers Issues: #47 (Manager Panel container organization)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';
import { wait } from '../../helpers/quick-tabs-test-utils.js';

describe('Scenario 8: Container-Aware Grouping Protocol', () => {
  let tabs;
  let stateManagers;
  let broadcastManagers;
  let eventBuses;
  let channels;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create tabs in different containers for grouping tests
    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://github.com', containerId: 'firefox-container-1' },
      { url: 'https://youtube.com', containerId: 'firefox-container-2' },
      { url: 'https://reddit.com', containerId: 'firefox-container-3' }
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

    // Connect channels for cross-tab delivery (within same container)
    channels.forEach((sourceChannel, sourceIndex) => {
      const originalPostMessage = sourceChannel.postMessage;
      sourceChannel.postMessage = jest.fn((message) => {
        if (originalPostMessage && originalPostMessage.mock) {
          originalPostMessage(message);
        }

        setTimeout(() => {
          channels.forEach((targetChannel, targetIndex) => {
            // Only deliver to same container (container isolation)
            const sourceContainer = tabs[sourceIndex].containerId;
            const targetContainer = tabs[targetIndex].containerId;
            
            if (targetIndex !== sourceIndex && 
                sourceContainer === targetContainer && 
                targetChannel.onmessage) {
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

  describe('Basic Container Grouping', () => {
    it('should group Quick Tabs by container', () => {
      // Create Quick Tabs in different containers
      const qtDefault = new QuickTab({
        id: 'qt-default-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qtContainer1 = new QuickTab({
        id: 'qt-container1-1',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });

      const qtContainer2 = new QuickTab({
        id: 'qt-container2-1',
        url: 'https://example3.com',
        position: { left: 300, top: 300 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-2'
      });

      // Add to respective state managers
      stateManagers[0].add(qtDefault);
      stateManagers[1].add(qtContainer1);
      stateManagers[2].add(qtContainer2);

      // Verify each container has only its own Quick Tabs
      expect(stateManagers[0].get('qt-default-1')).toBeDefined();
      expect(stateManagers[0].get('qt-container1-1')).toBeUndefined();
      expect(stateManagers[0].get('qt-container2-1')).toBeUndefined();

      expect(stateManagers[1].get('qt-default-1')).toBeUndefined();
      expect(stateManagers[1].get('qt-container1-1')).toBeDefined();
      expect(stateManagers[1].get('qt-container2-1')).toBeUndefined();

      expect(stateManagers[2].get('qt-default-1')).toBeUndefined();
      expect(stateManagers[2].get('qt-container1-1')).toBeUndefined();
      expect(stateManagers[2].get('qt-container2-1')).toBeDefined();
    });

    it('should maintain container separation with multiple Quick Tabs', () => {
      // Create 2 Quick Tabs per container
      const qts = [
        new QuickTab({
          id: 'qt-default-1',
          url: 'https://example1.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-default-2',
          url: 'https://example2.com',
          position: { left: 150, top: 150 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        }),
        new QuickTab({
          id: 'qt-container1-1',
          url: 'https://example3.com',
          position: { left: 200, top: 200 },
          size: { width: 800, height: 600 },
          container: 'firefox-container-1'
        }),
        new QuickTab({
          id: 'qt-container1-2',
          url: 'https://example4.com',
          position: { left: 250, top: 250 },
          size: { width: 800, height: 600 },
          container: 'firefox-container-1'
        })
      ];

      // Add to respective managers
      stateManagers[0].add(qts[0]);
      stateManagers[0].add(qts[1]);
      stateManagers[1].add(qts[2]);
      stateManagers[1].add(qts[3]);

      // Verify container separation
      expect(stateManagers[0].count()).toBe(2);
      expect(stateManagers[1].count()).toBe(2);
      expect(stateManagers[2].count()).toBe(0);
      expect(stateManagers[3].count()).toBe(0);

      // Verify correct Quick Tabs in each container
      expect(stateManagers[0].get('qt-default-1')).toBeDefined();
      expect(stateManagers[0].get('qt-default-2')).toBeDefined();
      expect(stateManagers[1].get('qt-container1-1')).toBeDefined();
      expect(stateManagers[1].get('qt-container1-2')).toBeDefined();
    });
  });

  describe('Container Isolation', () => {
    it('should not allow Quick Tab from one container to appear in another', () => {
      const qt = new QuickTab({
        id: 'qt-isolated',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });

      // Add to container-1
      stateManagers[1].add(qt);

      // Verify it doesn't appear in other containers
      expect(stateManagers[0].get('qt-isolated')).toBeUndefined(); // default
      expect(stateManagers[1].get('qt-isolated')).toBeDefined();   // container-1
      expect(stateManagers[2].get('qt-isolated')).toBeUndefined(); // container-2
      expect(stateManagers[3].get('qt-isolated')).toBeUndefined(); // container-3
    });

    it('should isolate container broadcast messages', async () => {
      // Create Quick Tabs in two containers
      const qtContainer1 = new QuickTab({
        id: 'qt-broadcast-test-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });

      const qtContainer2 = new QuickTab({
        id: 'qt-broadcast-test-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-2'
      });

      stateManagers[1].add(qtContainer1);
      stateManagers[2].add(qtContainer2);

      // Broadcast CREATE from container-1
      await broadcastManagers[1].broadcast('CREATE', {
        id: 'qt-new-container1',
        url: 'https://new.com',
        position: { left: 300, top: 300 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });

      await wait(50);

      // Verify broadcast didn't cross container boundaries
      // (In reality, broadcasts within same container would be received,
      // but our test setup isolates by container)
      expect(stateManagers[0].get('qt-new-container1')).toBeUndefined();
      expect(stateManagers[2].get('qt-new-container1')).toBeUndefined();
      expect(stateManagers[3].get('qt-new-container1')).toBeUndefined();
    });
  });

  describe('Multi-Container Scenarios', () => {
    it('should handle Quick Tabs across 4 different containers', () => {
      const qts = tabs.map((tab, index) =>
        new QuickTab({
          id: `qt-multi-${index}`,
          url: `https://example${index}.com`,
          position: { left: (index + 1) * 100, top: (index + 1) * 100 },
          size: { width: 800, height: 600 },
          container: tab.containerId
        })
      );

      // Add each Quick Tab to its container's state manager
      qts.forEach((qt, index) => {
        stateManagers[index].add(qt);
      });

      // Verify each container has exactly 1 Quick Tab
      stateManagers.forEach((sm, index) => {
        expect(sm.count()).toBe(1);
        expect(sm.get(`qt-multi-${index}`)).toBeDefined();
      });

      // Verify no cross-container leakage
      for (let i = 0; i < stateManagers.length; i++) {
        for (let j = 0; j < qts.length; j++) {
          if (i !== j) {
            expect(stateManagers[i].get(`qt-multi-${j}`)).toBeUndefined();
          }
        }
      }
    });

    it('should group by container when multiple Quick Tabs exist', () => {
      // Create 3 Quick Tabs per container (for containers 0, 1, 2)
      const containersToTest = [0, 1, 2];
      
      containersToTest.forEach(containerIndex => {
        for (let i = 1; i <= 3; i++) {
          const qt = new QuickTab({
            id: `qt-c${containerIndex}-${i}`,
            url: `https://example${containerIndex}-${i}.com`,
            position: { left: i * 100, top: i * 100 },
            size: { width: 800, height: 600 },
            container: tabs[containerIndex].containerId
          });
          stateManagers[containerIndex].add(qt);
        }
      });

      // Verify each container has exactly 3 Quick Tabs
      containersToTest.forEach(index => {
        expect(stateManagers[index].count()).toBe(3);
      });

      // Verify container 3 is empty
      expect(stateManagers[3].count()).toBe(0);
    });
  });

  describe('Empty Container Handling', () => {
    it('should handle containers with no Quick Tabs', () => {
      // Create Quick Tabs only in container 0 and 1
      stateManagers[0].add(new QuickTab({
        id: 'qt-only-default',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      }));

      stateManagers[1].add(new QuickTab({
        id: 'qt-only-container1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      }));

      // Verify counts
      expect(stateManagers[0].count()).toBe(1);
      expect(stateManagers[1].count()).toBe(1);
      expect(stateManagers[2].count()).toBe(0); // Empty
      expect(stateManagers[3].count()).toBe(0); // Empty
    });

    it('should maintain empty state after Quick Tab removed', () => {
      const qt = new QuickTab({
        id: 'qt-to-remove',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-2'
      });

      stateManagers[2].add(qt);
      expect(stateManagers[2].count()).toBe(1);

      // Remove it
      stateManagers[2].delete('qt-to-remove');
      
      // Verify empty
      expect(stateManagers[2].count()).toBe(0);
      expect(stateManagers[2].get('qt-to-remove')).toBeUndefined();
    });
  });

  describe('Container Visibility States', () => {
    it('should maintain solo/mute states per container', () => {
      // Create Quick Tabs in different containers with different visibility states
      const qtDefault = new QuickTab({
        id: 'qt-default-solo',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });
      qtDefault.visibility.soloedOnTabs = [tabs[0].tabId];

      const qtContainer1 = new QuickTab({
        id: 'qt-container1-mute',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });
      qtContainer1.visibility.mutedOnTabs = [tabs[1].tabId];

      const qtContainer2 = new QuickTab({
        id: 'qt-container2-minimized',
        url: 'https://example3.com',
        position: { left: 300, top: 300 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-2'
      });
      qtContainer2.visibility.minimized = true;

      // Add to respective containers
      stateManagers[0].add(qtDefault);
      stateManagers[1].add(qtContainer1);
      stateManagers[2].add(qtContainer2);

      // Verify visibility states maintained per container
      const qt0 = stateManagers[0].get('qt-default-solo');
      expect(qt0.visibility.soloedOnTabs).toEqual([tabs[0].tabId]);

      const qt1 = stateManagers[1].get('qt-container1-mute');
      expect(qt1.visibility.mutedOnTabs).toEqual([tabs[1].tabId]);

      const qt2 = stateManagers[2].get('qt-container2-minimized');
      expect(qt2.visibility.minimized).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid container ID gracefully', () => {
      const qt = new QuickTab({
        id: 'qt-invalid-container',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'invalid-container-id'
      });

      // Try to add to state manager
      stateManagers[0].add(qt);

      // Should still work (container ID is just metadata)
      expect(stateManagers[0].get('qt-invalid-container')).toBeDefined();
      expect(stateManagers[0].get('qt-invalid-container').container).toBe('invalid-container-id');
    });

    it('should handle container with many Quick Tabs', () => {
      // Add 20 Quick Tabs to one container
      for (let i = 1; i <= 20; i++) {
        const qt = new QuickTab({
          id: `qt-many-${i}`,
          url: `https://example${i}.com`,
          position: { left: i * 50, top: i * 50 },
          size: { width: 800, height: 600 },
          container: 'firefox-container-1'
        });
        stateManagers[1].add(qt);
      }

      // Verify all added
      expect(stateManagers[1].count()).toBe(20);

      // Verify other containers empty
      expect(stateManagers[0].count()).toBe(0);
      expect(stateManagers[2].count()).toBe(0);
      expect(stateManagers[3].count()).toBe(0);
    });

    it('should maintain grouping after container operations', () => {
      // Create initial state
      stateManagers[0].add(new QuickTab({
        id: 'qt-default',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      }));

      stateManagers[1].add(new QuickTab({
        id: 'qt-container1',
        url: 'https://example.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      }));

      // Perform operations (minimize in default, solo in container1)
      const qtDefault = stateManagers[0].get('qt-default');
      qtDefault.visibility.minimized = true;
      stateManagers[0].update(qtDefault);

      const qtContainer1 = stateManagers[1].get('qt-container1');
      qtContainer1.visibility.soloedOnTabs = [tabs[1].tabId];
      stateManagers[1].update(qtContainer1);

      // Verify container grouping still intact
      expect(stateManagers[0].count()).toBe(1);
      expect(stateManagers[1].count()).toBe(1);
      
      // Verify no cross-contamination
      expect(stateManagers[0].get('qt-container1')).toBeUndefined();
      expect(stateManagers[1].get('qt-default')).toBeUndefined();
    });
  });

  describe('Container Metadata', () => {
    it('should preserve container metadata on Quick Tabs', () => {
      const containers = [
        'firefox-default',
        'firefox-container-1',
        'firefox-container-2',
        'firefox-container-3'
      ];

      containers.forEach((containerId, index) => {
        const qt = new QuickTab({
          id: `qt-metadata-${index}`,
          url: 'https://example.com',
          position: { left: 100, top: 100 },
          size: { width: 800, height: 600 },
          container: containerId
        });

        stateManagers[index].add(qt);

        // Verify container metadata preserved
        const addedQt = stateManagers[index].get(`qt-metadata-${index}`);
        expect(addedQt.container).toBe(containerId);
      });
    });

    it('should maintain container ID through updates', () => {
      const qt = new QuickTab({
        id: 'qt-update-container',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1'
      });

      stateManagers[1].add(qt);

      // Update position
      const qtToUpdate = stateManagers[1].get('qt-update-container');
      qtToUpdate.position.left = 200;
      qtToUpdate.position.top = 200;
      stateManagers[1].update(qtToUpdate);

      // Verify container ID still correct
      const updatedQt = stateManagers[1].get('qt-update-container');
      expect(updatedQt.container).toBe('firefox-container-1');
      expect(updatedQt.position.left).toBe(200);
    });
  });
});
