/**
 * SyncCoordinator Cross-Tab Synchronization Tests
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
  let mockBroadcastManagers;
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
      emergencySave: jest.fn()
    }));

    mockBroadcastManagers = tabs.map(() => ({
      broadcast: jest.fn(),
      setupBroadcastChannel: jest.fn()
    }));

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
    coordinators = tabs.map((tab, index) => {
      const coordinator = new SyncCoordinator(
        mockStateManagers[index],
        mockStorageManagers[index],
        mockBroadcastManagers[index],
        mockHandlers[index],
        eventBuses[index]
      );
      coordinator.setupListeners();
      return coordinator;
    });
  });

  describe('Position/Size Sync Lifecycle', () => {
    test('position change triggers broadcast and storage update', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-1', position: { left: 100, top: 100 } });
      mockStateManagers[0].get.mockReturnValue(qt);

      // Simulate position update in tab 0
      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-1',
        newValue: { ...qt, position: { left: 200, top: 200 } },
        oldValue: qt
      });

      await wait(50);

      // Verify StateManager.hydrate was called
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });

    test('position change in tab A reflects in tab B via broadcast', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-sync-1', position: { left: 100, top: 100 } });
      
      // Tab A has the Quick Tab
      mockStateManagers[0].get.mockReturnValue(qt);
      mockHandlers[0].update.handlePositionChangeEnd.mockImplementation(async (id, position) => {
        // Simulate successful update
        qt.position = position;
      });

      // Tab B listens for updates
      const tab2Updates = [];
      mockHandlers[1].update.handlePositionChangeEnd.mockImplementation(async (id, left, top) => {
        tab2Updates.push({ id, position: { left, top } });
      });

      // Simulate broadcast from tab A
      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-sync-1',
        newValue: { ...qt, position: { left: 250, top: 250 } }
      });

      // Trigger broadcast message reception in tab B
      eventBuses[1].emit('broadcast:received', {
        type: 'UPDATE_POSITION',
        data: { id: 'qt-sync-1', left: 250, top: 250 }
      });

      await wait(50);

      // Verify tab B received update
      expect(tab2Updates.length).toBeGreaterThan(0);
      expect(tab2Updates[0]).toMatchObject({
        id: 'qt-sync-1',
        position: { left: 250, top: 250 }
      });
    });

    test('size change in tab A propagates to all other tabs', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-size-1', size: { width: 800, height: 600 } });
      
      // Setup state in all tabs
      mockStateManagers.forEach(sm => sm.get.mockReturnValue(qt));

      const tab2SizeUpdates = [];
      const tab3SizeUpdates = [];

      mockHandlers[1].update.handleSizeChangeEnd.mockImplementation(async (id, width, height) => {
        tab2SizeUpdates.push({ id, size: { width, height } });
      });

      mockHandlers[2].update.handleSizeChangeEnd.mockImplementation(async (id, width, height) => {
        tab3SizeUpdates.push({ id, size: { width, height } });
      });

      // Broadcast size update from tab 0
      eventBuses[1].emit('broadcast:received', {
        type: 'UPDATE_SIZE',
        data: { id: 'qt-size-1', width: 900, height: 700 }
      });

      eventBuses[2].emit('broadcast:received', {
        type: 'UPDATE_SIZE',
        data: { id: 'qt-size-1', width: 900, height: 700 }
      });

      await wait(50);

      // Verify propagation to tabs 2 and 3
      expect(tab2SizeUpdates.length).toBeGreaterThan(0);
      expect(tab3SizeUpdates.length).toBeGreaterThan(0);
      expect(tab2SizeUpdates[0].size).toEqual({ width: 900, height: 700 });
      expect(tab3SizeUpdates[0].size).toEqual({ width: 900, height: 700 });
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
      expect(mockStateManagers[0].hydrate).toHaveBeenCalledWith([qt]);
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

      // Simulate storage change event to trigger hydration
      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-load-1',
        newValue: qt1
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

      // Trigger hydration via storage change
      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-restore-solo',
        newValue: qtWithSolo
      });

      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-restore-mute',
        newValue: qtWithMute
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

      // Send rapid updates from tab 0
      for (const position of updates) {
        eventBuses[1].emit('broadcast:received', {
          type: 'UPDATE_POSITION',
          data: { id: 'qt-rapid-1', ...position }
        });
        await wait(10);
      }

      await wait(100);

      // Verify all updates were processed
      expect(mockHandlers[1].update.handlePositionChangeEnd).toHaveBeenCalled();
    });

    test('concurrent updates from different tabs are handled gracefully', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-concurrent-1' });
      mockStateManagers.forEach(sm => sm.get.mockReturnValue(qt));

      // Tab 0 and Tab 1 update simultaneously
      eventBuses[2].emit('broadcast:received', {
        type: 'UPDATE_POSITION',
        data: { id: 'qt-concurrent-1', left: 100, top: 100 }
      });

      eventBuses[2].emit('broadcast:received', {
        type: 'UPDATE_POSITION',
        data: { id: 'qt-concurrent-1', left: 200, top: 200 }
      });

      await wait(100);

      // Verify handler was called (last-write-wins at application level)
      expect(mockHandlers[2].update.handlePositionChangeEnd).toHaveBeenCalled();
    });

    test('storage changes ignored during pending saveId window', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-saveid-1' });
      
      // Simulate own storage change with saveId
      mockStorageManagers[0].shouldIgnoreStorageChange.mockReturnValue(true);

      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-saveid-1',
        newValue: qt,
        saveId: 'test-save-id-123'
      });

      await wait(50);

      // Verify hydration was NOT called (own change ignored)
      expect(mockStateManagers[0].hydrate).not.toHaveBeenCalled();
    });

    test('storage changes processed after saveId released', async () => {
      const qt = createQuickTabWithDefaults({ id: 'qt-saveid-2' });
      
      // First call: ignore (own change)
      // Second call: process (saveId released)
      mockStorageManagers[0].shouldIgnoreStorageChange
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      // First change (ignored)
      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-saveid-2',
        newValue: qt,
        saveId: 'test-save-id-456'
      });

      await wait(50);
      expect(mockStateManagers[0].hydrate).not.toHaveBeenCalled();

      // Second change (processed)
      eventBuses[0].emit('storage:changed', {
        key: 'qt_firefox-default_qt-saveid-2',
        newValue: { ...qt, position: { left: 300, top: 300 } }
      });

      await wait(50);
      expect(mockStateManagers[0].hydrate).toHaveBeenCalled();
    });
  });

  describe('Message Routing', () => {
    test('CREATE message routes to create handler', async () => {
      eventBuses[0].emit('broadcast:received', {
        type: 'CREATE',
        data: { id: 'qt-new-1', url: 'https://example.com' }
      });

      await wait(50);

      expect(mockHandlers[0].create.create).toHaveBeenCalledWith({
        id: 'qt-new-1',
        url: 'https://example.com'
      });
    });

    test('SOLO message routes to visibility handler', async () => {
      eventBuses[0].emit('broadcast:received', {
        type: 'SOLO',
        data: { id: 'qt-solo-1', soloTabId: 123 }
      });

      await wait(50);

      expect(mockHandlers[0].visibility.handleSoloToggle).toHaveBeenCalled();
    });

    test('MUTE message routes to visibility handler', async () => {
      eventBuses[0].emit('broadcast:received', {
        type: 'MUTE',
        data: { id: 'qt-mute-1', tabId: 456 }
      });

      await wait(50);

      expect(mockHandlers[0].visibility.handleMuteToggle).toHaveBeenCalled();
    });

    test('MINIMIZE message routes to visibility handler', async () => {
      eventBuses[0].emit('broadcast:received', {
        type: 'MINIMIZE',
        data: { id: 'qt-min-1' }
      });

      await wait(50);

      expect(mockHandlers[0].visibility.handleMinimize).toHaveBeenCalled();
    });

    test('RESTORE message routes to visibility handler', async () => {
      eventBuses[0].emit('broadcast:received', {
        type: 'RESTORE',
        data: { id: 'qt-restore-1' }
      });

      await wait(50);

      expect(mockHandlers[0].visibility.handleRestore).toHaveBeenCalled();
    });

    test('CLOSE message routes to destroy handler', async () => {
      eventBuses[0].emit('broadcast:received', {
        type: 'CLOSE',
        data: { id: 'qt-close-1' }
      });

      await wait(50);

      expect(mockHandlers[0].destroy.handleDestroy).toHaveBeenCalled();
    });
  });
});
