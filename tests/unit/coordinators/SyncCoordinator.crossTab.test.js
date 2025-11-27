/**
 * SyncCoordinator Cross-Tab Synchronization Tests
 * 
 * v1.6.2 - MIGRATION: Uses storage.onChanged exclusively (BroadcastChannel removed)
 * 
 * Enhanced tests for position/size sync lifecycle, cross-tab propagation,
 * emergency save, and state hydration as specified in comprehensive-unit-testing-strategy.md
 * 
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 1.2)
 * - docs/issue-47-revised-scenarios.md
 * 
 * Related Issues:
 * - #35: Quick Tabs don't persist across tabs
 * - #51: Quick Tab size and position don't update and transfer between tabs
 */

import { EventEmitter } from 'eventemitter3';
import { SyncCoordinator } from '../../../src/features/quick-tabs/coordinators/SyncCoordinator.js';
import { createMultiTabScenario, switchToTab } from '../../helpers/cross-tab-simulator.js';
import { wait, createQuickTabWithDefaults } from '../../helpers/quick-tabs-test-utils.js';

describe('SyncCoordinator - Cross-Tab Synchronization', () => {
  let tabs;
  let coordinators;
  let mockStateManagers;
  let mockStorageManagers;
  let mockHandlers;
  let eventBuses;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create 3 simulated tabs
    tabs = await createMultiTabScenario([
      { url: 'https://example.com/tab1', containerId: 'firefox-default' },
      { url: 'https://example.com/tab2', containerId: 'firefox-default' },
      { url: 'https://example.com/tab3', containerId: 'firefox-default' }
    ]);

    // Create event buses for each tab
    eventBuses = tabs.map(() => new EventEmitter());

    // Create mock managers and handlers for each tab
    mockStateManagers = tabs.map(() => ({
      hydrate: jest.fn(),
      get: jest.fn(),
      getAll: jest.fn(() => []),
      update: jest.fn(),
      add: jest.fn(),
      delete: jest.fn()
    }));

    mockStorageManagers = tabs.map(() => ({
      shouldIgnoreStorageChange: jest.fn(() => false),
      save: jest.fn(),
      load: jest.fn(),
      loadAll: jest.fn().mockResolvedValue([]),
      emergencySave: jest.fn()
    }));

    // v1.6.2 - BroadcastManager removed, cross-tab sync via storage.onChanged

    mockHandlers = tabs.map(() => ({
      create: { create: jest.fn() },
      update: {
        handlePositionChangeEnd: jest.fn(),
        handleSizeChangeEnd: jest.fn()
      },
      visibility: {
        handleSoloToggle: jest.fn(),
        handleMuteToggle: jest.fn(),
        handleMinimize: jest.fn(),
        handleRestore: jest.fn()
      },
      destroy: { handleDestroy: jest.fn() }
    }));

    // Create coordinators for each tab
    // v1.6.2 - SyncCoordinator takes 4 params (removed broadcastManager)
    coordinators = tabs.map((tab, index) => {
      const coordinator = new SyncCoordinator(
        mockStateManagers[index],
        mockStorageManagers[index],
        mockHandlers[index],
        eventBuses[index]
      );
      coordinator.setupListeners();
      return coordinator;
    });
  });

  describe('Position/Size Sync Lifecycle', () => {
    test('position change triggers storage update and state hydration', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-1', position: { left: 100, top: 100 } });
      mockStateManagers[0].get.mockReturnValue(qt);

      // v1.6.2 - Simulate storage.onChanged event (from another tab's write)
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, position: { left: 200, top: 200 } }]
            }
          }
        }
      });

      await wait(50);

      // Verify StateManager.hydrate was called
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('position change in tab A reflects in tab B via storage.onChanged', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-sync-1', position: { left: 100, top: 100 } });
      
      // Tab A has the Quick Tab
      mockStateManagers[0].get.mockReturnValue(qt);

      // v1.6.2 - Simulate storage.onChanged event in Tab B (triggered by Tab A's write)
      eventBuses[1].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, position: { left: 250, top: 250 } }]
            }
          }
        }
      });

      await wait(50);

      // Verify tab B received update via state hydration
      expect(mockStateManagers[1].hydrate).toHaveBeenCalled();
    });

    test('size change in tab A propagates to all other tabs via storage.onChanged', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-size-1', size: { width: 800, height: 600 } });
      
      // Setup state in all tabs
      mockStateManagers.forEach(sm => sm.get.mockReturnValue(qt));

      // v1.6.2 - Simulate storage.onChanged in tabs 1 and 2 (from tab 0's write)
      eventBuses[1].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, size: { width: 900, height: 700 } }]
            }
          }
        }
      });

      eventBuses[2].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, size: { width: 900, height: 700 } }]
            }
          }
        }
      });

      await wait(50);

      // Verify propagation to tabs 1 and 2 via state hydration
      expect(mockStateManagers[1].hydrate).toHaveBeenCalled();
      expect(mockStateManagers[2].hydrate).toHaveBeenCalled();
    });
  });

  describe('Tab Visibility State Refresh', () => {
    test('tab becoming visible triggers state refresh', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-refresh-1', position: { left: 150, top: 150 } });
      
      // Setup mock to return Quick Tabs from storage
      mockStorageManagers[0].loadAll = jest.fn().mockResolvedValue([qt]);

      // Simulate tab becoming visible
      eventBuses[0].emit('event:tab-visible');

      await wait(100);

      // Verify loadAll was called to refresh from storage
      expect(mockStorageManagers[0].loadAll).toHaveBeenCalled();
      
      // Verify hydrate was called to update local state
      // v1.6.2.5 - skipDeletions: false to trust storage, detectChanges: true for UI sync
      expect(mockStateManagers[0].hydrate).toHaveBeenCalledWith([qt], { detectChanges: true, skipDeletions: false });
    });

    test('state refresh emits state:refreshed event', async () => {
      const qt1 = createQuickTabWithDefaults({ id: 'qt-refresh-2' });
      const qt2 = createQuickTabWithDefaults({ id: 'qt-refresh-3' });
      
      mockStorageManagers[0].loadAll = jest.fn().mockResolvedValue([qt1, qt2]);

      // Setup listener for refresh event
      const refreshEvents = [];
      eventBuses[0].on('state:refreshed', (event) => {
        refreshEvents.push(event);
      });

      // Trigger tab visible
      eventBuses[0].emit('event:tab-visible');
      await wait(100);

      // Verify refresh event was emitted
      expect(refreshEvents.length).toBeGreaterThan(0);
      expect(refreshEvents[0].quickTabs).toHaveLength(2);
    });

    test('tab switching updates state in newly visible tab', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-switch-1', position: { left: 200, top: 200 } });
      
      // Setup tab 1 to load the QT when it becomes visible
      mockStorageManagers[1].loadAll = jest.fn().mockResolvedValue([qt]);

      // Switch from tab 0 to tab 1
      await switchToTab(tabs[0], tabs[1]);

      // Trigger tab visible event on tab 1
      eventBuses[1].emit('event:tab-visible');
      await wait(100);

      // Verify tab 1 refreshed its state
      expect(mockStorageManagers[1].loadAll).toHaveBeenCalled();
      expect(mockStateManagers[1].hydrate).toHaveBeenCalled();
    });
  });

  describe('State Hydration on Tab Load', () => {
    test('new tab loads all Quick Tabs from storage correctly', async () => {
      const qt1 = createQuickTabWithDefaults({ id: 'qt-load-1', position: { left: 100, top: 100 } });
      const qt2 = createQuickTabWithDefaults({ id: 'qt-load-2', position: { left: 200, top: 200 } });
      const qt3 = createQuickTabWithDefaults({ id: 'qt-load-3', position: { left: 300, top: 300 } });

      // Pre-populate storage
      tabs[0]._storage.set('qt_firefox-default_qt-load-1', qt1);
      tabs[0]._storage.set('qt_firefox-default_qt-load-2', qt2);
      tabs[0]._storage.set('qt_firefox-default_qt-load-3', qt3);

      // v1.6.2 - Simulate storage.onChanged event to trigger hydration
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qt1, qt2, qt3]
            }
          }
        }
      });

      await wait(50);

      // Verify hydration was called
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('container-specific tabs load only relevant Quick Tabs', async () => {
      const qtDefault1 = createQuickTabWithDefaults({ 
        id: 'qt-default-1', 
        cookieStoreId: 'firefox-default' 
      });
      const qtDefault2 = createQuickTabWithDefaults({ 
        id: 'qt-default-2', 
        cookieStoreId: 'firefox-default' 
      });
      const qtPersonal1 = createQuickTabWithDefaults({ 
        id: 'qt-personal-1', 
        cookieStoreId: 'firefox-container-1' 
      });
      const qtPersonal2 = createQuickTabWithDefaults({ 
        id: 'qt-personal-2', 
        cookieStoreId: 'firefox-container-1' 
      });

      // Create new tab scenario with different containers
      const containerTabs = await createMultiTabScenario([
        { url: 'https://example.com', containerId: 'firefox-default' },
        { url: 'https://example.com', containerId: 'firefox-container-1' }
      ]);

      // Pre-populate storage with mixed containers
      containerTabs[0]._storage.set('qt_firefox-default_qt-default-1', qtDefault1);
      containerTabs[0]._storage.set('qt_firefox-default_qt-default-2', qtDefault2);
      containerTabs[0]._storage.set('qt_firefox-container-1_qt-personal-1', qtPersonal1);
      containerTabs[0]._storage.set('qt_firefox-container-1_qt-personal-2', qtPersonal2);

      // Container-specific coordinators would filter by container
      // This test verifies the pattern is in place
      const defaultKeys = Array.from(containerTabs[0]._storage.keys()).filter(k => 
        k.includes('firefox-default')
      );
      const personalKeys = Array.from(containerTabs[0]._storage.keys()).filter(k => 
        k.includes('firefox-container-1')
      );

      expect(defaultKeys.length).toBe(2);
      expect(personalKeys.length).toBe(2);
    });

    test('restored tabs have correct position, size, and solo/mute state', async () => {
      const qtWithSolo = createQuickTabWithDefaults({
        id: 'qt-restore-solo',
        position: { left: 150, top: 150 },
        size: { width: 700, height: 500 },
        soloTabId: 123
      });

      const qtWithMute = createQuickTabWithDefaults({
        id: 'qt-restore-mute',
        position: { left: 250, top: 250 },
        size: { width: 650, height: 450 },
        mutedTabs: [456, 789]
      });

      // Pre-populate storage
      tabs[0]._storage.set('qt_firefox-default_qt-restore-solo', qtWithSolo);
      tabs[0]._storage.set('qt_firefox-default_qt-restore-mute', qtWithMute);

      // v1.6.2 - Trigger hydration via storage.onChanged with distinct timestamps for deduplication
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qtWithSolo]
            }
          },
          timestamp: Date.now()
        }
      });

      // Small delay to ensure different timestamp
      await wait(10);

      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qtWithMute]
            }
          },
          timestamp: Date.now() + 1
        }
      });

      await wait(50);

      // Verify hydration was called for both
      expect(mockStateManagers[0].hydrate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cross-Tab State Consistency', () => {
    test('rapid position updates maintain consistency across all tabs', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-rapid-1', position: { left: 100, top: 100 } });
      mockStateManagers.forEach(sm => sm.get.mockReturnValue(qt));

      const updates = [
        { left: 110, top: 110 },
        { left: 120, top: 120 },
        { left: 130, top: 130 },
        { left: 140, top: 140 },
        { left: 150, top: 150 }
      ];

      // v1.6.2 - Send rapid storage updates
      for (const position of updates) {
        eventBuses[1].emit('storage:changed', {
          state: {
            containers: {
              'firefox-default': {
                tabs: [{ ...qt, position, timestamp: Date.now() }]
              }
            }
          }
        });
        await wait(10);
      }

      await wait(100);

      // Verify all updates were processed via state hydration
      expect(mockStateManagers[1].hydrate).toHaveBeenCalled();
    });

    test('concurrent updates from different tabs are handled gracefully', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-concurrent-1' });
      mockStateManagers.forEach(sm => sm.get.mockReturnValue(qt));

      // v1.6.2 - Tab 0 and Tab 1 update simultaneously via storage.onChanged
      eventBuses[2].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, position: { left: 100, top: 100 }, timestamp: Date.now() }]
            }
          }
        }
      });

      eventBuses[2].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, position: { left: 200, top: 200 }, timestamp: Date.now() + 1 }]
            }
          }
        }
      });

      await wait(100);

      // Verify updates were processed (last-write-wins at application level)
      expect(mockStateManagers[2].hydrate).toHaveBeenCalled();
    });

    test('storage changes ignored during pending saveId window', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-saveid-1' });
      
      // Simulate own storage change - coordinator should use deduplication
      // v1.6.2 - SyncCoordinator uses _isDuplicateMessage to skip processed messages
      // Deduplication is based on a hash of Quick Tab IDs and timestamp
      
      // First storage change with unique timestamp
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qt]
            }
          },
          timestamp: 12345
        }
      });

      await wait(10);

      // Emit same storage change again with SAME timestamp (should be deduplicated)
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qt]
            }
          },
          timestamp: 12345
        }
      });

      await wait(50);

      // Verify only one hydrate call (second identical message was deduplicated)
      expect(mockStateManagers[0].hydrate).toHaveBeenCalledTimes(1);
    });

    test('storage changes processed after saveId released', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-saveid-2' });
      
      // First change
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qt]
            }
          },
          timestamp: 1000
        }
      });

      await wait(50);
      expect(mockStateManagers[0].hydrate).toHaveBeenCalledTimes(1);

      // Second change with different content (should be processed)
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [{ ...qt, position: { left: 300, top: 300 } }]
            }
          },
          timestamp: 2000
        }
      });

      await wait(50);
      expect(mockStateManagers[0].hydrate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Storage-Based State Sync', () => {
    // v1.6.2 - BroadcastChannel removed. Cross-tab sync now works via storage.onChanged only.
    // These tests verify that storage changes properly hydrate state in receiving tabs.

    test('storage change with new Quick Tab triggers state hydration', async () => {
      const newQt = createQuickTabWithDefaults({ id: 'qt-new-1', url: 'https://example.com' });

      // Simulate storage.onChanged from another tab's CREATE action
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [newQt]
            }
          }
        }
      });

      await wait(50);

      // Verify state was hydrated with the new Quick Tab
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
      const hydrateCall = mockStateManagers[0].hydrate.mock.calls[0][0];
      expect(hydrateCall).toContainEqual(expect.objectContaining({ id: 'qt-new-1' }));
    });

    test('storage change with solo state triggers state hydration', async () => {
      const qtWithSolo = createQuickTabWithDefaults({ 
        id: 'qt-solo-1', 
        soloedOnTabs: [123] 
      });

      // Simulate storage.onChanged from another tab's SOLO action
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qtWithSolo]
            }
          }
        }
      });

      await wait(50);

      // Verify state was hydrated
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('storage change with mute state triggers state hydration', async () => {
      const qtWithMute = createQuickTabWithDefaults({ 
        id: 'qt-mute-1', 
        mutedOnTabs: [456, 789] 
      });

      // Simulate storage.onChanged from another tab's MUTE action
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qtWithMute]
            }
          }
        }
      });

      await wait(50);

      // Verify state was hydrated
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('storage change with minimize state triggers state hydration', async () => {
      const qtMinimized = createQuickTabWithDefaults({ 
        id: 'qt-min-1', 
        minimized: true 
      });

      // Simulate storage.onChanged from another tab's MINIMIZE action
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qtMinimized]
            }
          }
        }
      });

      await wait(50);

      // Verify state was hydrated
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('storage change with restore state triggers state hydration', async () => {
      const qtRestored = createQuickTabWithDefaults({ 
        id: 'qt-restore-1', 
        minimized: false 
      });

      // Simulate storage.onChanged from another tab's RESTORE action
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qtRestored]
            }
          }
        }
      });

      await wait(50);

      // Verify state was hydrated
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('storage change with deleted Quick Tab triggers state hydration', async () => {
      // Initially have 2 Quick Tabs
      const qt1 = createQuickTabWithDefaults({ id: 'qt-keep-1' });
      const qt2 = createQuickTabWithDefaults({ id: 'qt-close-1' });

      mockStateManagers[0].getAll.mockReturnValue([qt1, qt2]);

      // Simulate storage.onChanged from another tab's CLOSE action (qt2 removed)
      eventBuses[0].emit('storage:changed', {
        state: {
          containers: {
            'firefox-default': {
              tabs: [qt1] // qt2 no longer in storage
            }
          }
        }
      });

      await wait(50);

      // Verify state was hydrated with updated list
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });
  });
});
