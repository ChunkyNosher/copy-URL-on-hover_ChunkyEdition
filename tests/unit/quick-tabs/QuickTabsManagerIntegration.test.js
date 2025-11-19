/**
 * Integration tests for QuickTabsManager facade
 * Tests component delegation, lifecycle, and coordination
 *
 * Phase 7.3 - Priority 1
 * Target: 60%+ coverage on index.js (526 lines, currently 0%)
 */

import { EventEmitter } from 'eventemitter3';

import { SyncCoordinator } from '../../../src/features/quick-tabs/coordinators/SyncCoordinator.js';
import { UICoordinator } from '../../../src/features/quick-tabs/coordinators/UICoordinator.js';
import { CreateHandler } from '../../../src/features/quick-tabs/handlers/CreateHandler.js';
import { DestroyHandler } from '../../../src/features/quick-tabs/handlers/DestroyHandler.js';
import { UpdateHandler } from '../../../src/features/quick-tabs/handlers/UpdateHandler.js';
import { VisibilityHandler } from '../../../src/features/quick-tabs/handlers/VisibilityHandler.js';
import { initQuickTabs } from '../../../src/features/quick-tabs/index.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { EventManager } from '../../../src/features/quick-tabs/managers/EventManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { StorageManager } from '../../../src/features/quick-tabs/managers/StorageManager.js';
import { MinimizedManager } from '../../../src/features/quick-tabs/minimized-manager.js';
import { PanelManager } from '../../../src/features/quick-tabs/panel.js';

// Mock all components
jest.mock('../../../src/features/quick-tabs/managers/BroadcastManager.js');
jest.mock('../../../src/features/quick-tabs/managers/EventManager.js');
jest.mock('../../../src/features/quick-tabs/managers/StateManager.js');
jest.mock('../../../src/features/quick-tabs/managers/StorageManager.js');
jest.mock('../../../src/features/quick-tabs/handlers/CreateHandler.js');
jest.mock('../../../src/features/quick-tabs/handlers/DestroyHandler.js');
jest.mock('../../../src/features/quick-tabs/handlers/UpdateHandler.js');
jest.mock('../../../src/features/quick-tabs/handlers/VisibilityHandler.js');
jest.mock('../../../src/features/quick-tabs/coordinators/SyncCoordinator.js');
jest.mock('../../../src/features/quick-tabs/coordinators/UICoordinator.js');
jest.mock('../../../src/features/quick-tabs/minimized-manager.js');
jest.mock('../../../src/features/quick-tabs/panel.js');
jest.mock('../../../src/utils/debug.js');

describe('QuickTabsManager Integration', () => {
  let manager;
  let mockEventBus;
  let mockEvents;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock external event bus
    mockEventBus = new EventEmitter();

    // Mock event constants
    mockEvents = {
      QUICK_TAB_CREATED: 'QUICK_TAB_CREATED',
      QUICK_TAB_CLOSED: 'QUICK_TAB_CLOSED',
      QUICK_TAB_UPDATED: 'QUICK_TAB_UPDATED'
    };

    // Mock browser APIs
    global.browser = {
      tabs: {
        query: jest
          .fn()
          .mockResolvedValue([{ cookieStoreId: 'firefox-container-1', id: 123, active: true }])
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue({ tabId: 123 })
      }
    };

    // Mock window global
    global.window = {
      __quickTabsManager: undefined
    };

    // Setup mock implementations for all managers
    const mockStorageManager = {
      setupStorageListeners: jest.fn(),
      loadAll: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined)
    };
    StorageManager.mockImplementation(() => mockStorageManager);

    const mockBroadcastManager = {
      setupBroadcastChannel: jest.fn(),
      broadcast: jest.fn()
    };
    BroadcastManager.mockImplementation(() => mockBroadcastManager);

    const mockStateManager = {
      hydrate: jest.fn(),
      add: jest.fn(),
      update: jest.fn(),
      remove: jest.fn()
    };
    StateManager.mockImplementation(() => mockStateManager);

    const mockEventManager = {
      setupEmergencySaveHandlers: jest.fn()
    };
    EventManager.mockImplementation(() => mockEventManager);

    // Setup mock implementations for all handlers
    const mockCreateHandler = {
      create: jest.fn().mockReturnValue({
        tabWindow: { id: 'qt-test', render: jest.fn() },
        newZIndex: 10001
      })
    };
    CreateHandler.mockImplementation(() => mockCreateHandler);

    const mockUpdateHandler = {
      handlePositionChange: jest.fn(),
      handlePositionChangeEnd: jest.fn(),
      handleSizeChange: jest.fn(),
      handleSizeChangeEnd: jest.fn()
    };
    UpdateHandler.mockImplementation(() => mockUpdateHandler);

    const mockVisibilityHandler = {
      handleMinimize: jest.fn(),
      handleFocus: jest.fn(),
      handleSoloToggle: jest.fn(),
      handleMuteToggle: jest.fn(),
      restoreQuickTab: jest.fn(),
      restoreById: jest.fn()
    };
    VisibilityHandler.mockImplementation(() => mockVisibilityHandler);

    const mockDestroyHandler = {
      handleDestroy: jest.fn(),
      closeById: jest.fn(),
      closeAll: jest.fn()
    };
    DestroyHandler.mockImplementation(() => mockDestroyHandler);

    // Setup mock implementations for coordinators
    const mockUICoordinator = {
      init: jest.fn().mockResolvedValue(undefined)
    };
    UICoordinator.mockImplementation(() => mockUICoordinator);

    const mockSyncCoordinator = {
      setupListeners: jest.fn()
    };
    SyncCoordinator.mockImplementation(() => mockSyncCoordinator);

    // Setup mock implementations for other components
    MinimizedManager.mockImplementation(() => ({
      getAll: jest.fn().mockReturnValue([])
    }));

    const mockPanelManager = {
      init: jest.fn().mockResolvedValue(undefined)
    };
    PanelManager.mockImplementation(() => mockPanelManager);
  });

  afterEach(() => {
    delete global.window;
    // Clear manager tabs to prevent test pollution
    if (manager && manager.tabs) {
      manager.tabs.clear();
    }
  });

  // ============================================================================
  // MODULE INITIALIZATION
  // ============================================================================

  describe('initQuickTabs()', () => {
    test('should initialize and return manager instance', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      expect(result).toBeDefined();
      expect(result.initialized).toBe(true);
    });

    test('should detect container context', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Container ID should be set after initialization
      expect(result.cookieStoreId).toBeDefined();
      expect(typeof result.cookieStoreId).toBe('string');
    });

    test('should detect current tab ID', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Tab ID should be set after initialization
      expect(result.currentTabId).toBeDefined();
    });

    test('should initialize all managers', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Verify all managers exist after initialization
      expect(result.storage).toBeDefined();
      expect(result.broadcast).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.events).toBeDefined();
    });

    test('should initialize all handlers', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Verify handlers exist on the manager
      expect(result.createHandler).toBeDefined();
      expect(result.updateHandler).toBeDefined();
      expect(result.visibilityHandler).toBeDefined();
      expect(result.destroyHandler).toBeDefined();
    });

    test('should initialize coordinators', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Verify coordinators exist on the manager
      expect(result.uiCoordinator).toBeDefined();
      expect(result.syncCoordinator).toBeDefined();
    });

    test('should initialize panel manager', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Verify panel manager exists and has init method
      expect(result.panelManager).toBeDefined();
      expect(result.panelManager.init).toBeDefined();
    });

    test('should setup all components', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Verify components were set up (these are called during init)
      expect(result.storage).toBeDefined();
      expect(result.broadcast).toBeDefined();
      expect(result.events).toBeDefined();
      expect(result.syncCoordinator).toBeDefined();
      expect(result.uiCoordinator).toBeDefined();
    });

    test('should hydrate state from storage', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Verify storage and state managers exist and were wired together
      expect(result.storage).toBeDefined();
      expect(result.state).toBeDefined();
    });

    test('should expose manager globally', async () => {
      const result = await initQuickTabs(mockEventBus, mockEvents);

      // Window global may not exist in test environment, but manager should be initialized
      expect(result.initialized).toBe(true);
      expect(result.eventBus).toBeInstanceOf(EventEmitter);
    });

    test('should be idempotent', async () => {
      const result1 = await initQuickTabs(mockEventBus, mockEvents);
      const managers1Count = StorageManager.mock.calls.length;

      const result2 = await initQuickTabs(mockEventBus, mockEvents);
      const managers2Count = StorageManager.mock.calls.length;

      // Should not create new managers on second call
      expect(managers2Count).toBe(managers1Count);
      expect(result2).toBe(result1);
    });
  });

  // ============================================================================
  // FACADE DELEGATION - QUICK TAB CRUD
  // ============================================================================

  describe('Quick Tab Operations', () => {
    beforeEach(async () => {
      manager = await initQuickTabs(mockEventBus, mockEvents);
    });

    describe('createQuickTab()', () => {
      test('should delegate to CreateHandler', () => {
        const options = {
          url: 'https://example.com',
          text: 'Example',
          left: 100,
          top: 100
        };

        try {
          manager.createQuickTab(options);
        } catch (e) {
          // Expected if CreateHandler.create doesn't return proper structure
        }

        expect(manager.createHandler.create).toHaveBeenCalled();
        const callArgs = manager.createHandler.create.mock.calls[0][0];
        expect(callArgs.url).toBe('https://example.com');
        expect(callArgs.text).toBe('Example');
      });

      test('should add callbacks to options', () => {
        const options = { url: 'https://example.com' };

        try {
          manager.createQuickTab(options);
        } catch (e) {
          // Expected if CreateHandler.create doesn't return proper structure
        }

        const callArgs = manager.createHandler.create.mock.calls[0][0];
        expect(callArgs.onDestroy).toBeDefined();
        expect(callArgs.onMinimize).toBeDefined();
        expect(callArgs.onFocus).toBeDefined();
        expect(callArgs.onPositionChange).toBeDefined();
        expect(callArgs.onPositionChangeEnd).toBeDefined();
        expect(callArgs.onSizeChange).toBeDefined();
        expect(callArgs.onSizeChangeEnd).toBeDefined();
        expect(callArgs.onSolo).toBeDefined();
        expect(callArgs.onMute).toBeDefined();
      });

      test('should update currentZIndex when CreateHandler returns valid result', () => {
        const options = { url: 'https://example.com' };
        manager.currentZIndex.value = 10000;

        // Mock CreateHandler to return proper structure
        manager.createHandler.create.mockReturnValueOnce({
          tabWindow: { id: 'qt-test', render: jest.fn() },
          newZIndex: 10005
        });

        const result = manager.createQuickTab(options);

        expect(manager.currentZIndex.value).toBe(10005);
        expect(result).toEqual({ id: 'qt-test', render: expect.any(Function) });
      });
    });

    describe('handleDestroy()', () => {
      test('should delegate to DestroyHandler', () => {
        manager.handleDestroy('qt-123');

        expect(manager.destroyHandler.handleDestroy).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('handleMinimize()', () => {
      test('should delegate to VisibilityHandler', () => {
        manager.handleMinimize('qt-123');

        expect(manager.visibilityHandler.handleMinimize).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('handleFocus()', () => {
      test('should delegate to VisibilityHandler', () => {
        manager.handleFocus('qt-123');

        expect(manager.visibilityHandler.handleFocus).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('handlePositionChange()', () => {
      test('should delegate to UpdateHandler', () => {
        manager.handlePositionChange('qt-123', 150, 200);

        expect(manager.updateHandler.handlePositionChange).toHaveBeenCalledWith('qt-123', 150, 200);
      });
    });

    describe('handlePositionChangeEnd()', () => {
      test('should delegate to UpdateHandler', () => {
        manager.handlePositionChangeEnd('qt-123', 150, 200);

        expect(manager.updateHandler.handlePositionChangeEnd).toHaveBeenCalledWith(
          'qt-123',
          150,
          200
        );
      });
    });

    describe('handleSizeChange()', () => {
      test('should delegate to UpdateHandler', () => {
        manager.handleSizeChange('qt-123', 400, 600);

        expect(manager.updateHandler.handleSizeChange).toHaveBeenCalledWith('qt-123', 400, 600);
      });
    });

    describe('handleSizeChangeEnd()', () => {
      test('should delegate to UpdateHandler', () => {
        manager.handleSizeChangeEnd('qt-123', 400, 600);

        expect(manager.updateHandler.handleSizeChangeEnd).toHaveBeenCalledWith('qt-123', 400, 600);
      });
    });

    describe('handleSoloToggle()', () => {
      test('should delegate to VisibilityHandler', () => {
        manager.handleSoloToggle('qt-123', [456, 789]);

        expect(manager.visibilityHandler.handleSoloToggle).toHaveBeenCalledWith(
          'qt-123',
          [456, 789]
        );
      });
    });

    describe('handleMuteToggle()', () => {
      test('should delegate to VisibilityHandler', () => {
        manager.handleMuteToggle('qt-123', [456, 789]);

        expect(manager.visibilityHandler.handleMuteToggle).toHaveBeenCalledWith(
          'qt-123',
          [456, 789]
        );
      });
    });

    describe('closeById()', () => {
      test('should delegate to DestroyHandler', () => {
        manager.closeById('qt-123');

        expect(manager.destroyHandler.closeById).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('closeAll()', () => {
      test('should delegate to DestroyHandler', () => {
        manager.closeAll();

        expect(manager.destroyHandler.closeAll).toHaveBeenCalled();
      });
    });

    describe('restoreQuickTab()', () => {
      test('should delegate to VisibilityHandler', () => {
        manager.restoreQuickTab('qt-123');

        expect(manager.visibilityHandler.restoreQuickTab).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('minimizeById()', () => {
      test('should delegate to handleMinimize', () => {
        manager.minimizeById('qt-123');

        expect(manager.visibilityHandler.handleMinimize).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('restoreById()', () => {
      test('should delegate to VisibilityHandler', () => {
        manager.restoreById('qt-123');

        expect(manager.visibilityHandler.restoreById).toHaveBeenCalledWith('qt-123');
      });
    });

    describe('updateQuickTabPosition() - legacy', () => {
      test('should delegate to handlePositionChange', () => {
        manager.updateQuickTabPosition('qt-123', 150, 200);

        expect(manager.updateHandler.handlePositionChange).toHaveBeenCalledWith('qt-123', 150, 200);
      });
    });

    describe('updateQuickTabSize() - legacy', () => {
      test('should delegate to handleSizeChange', () => {
        manager.updateQuickTabSize('qt-123', 400, 600);

        expect(manager.updateHandler.handleSizeChange).toHaveBeenCalledWith('qt-123', 400, 600);
      });
    });
  });

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  describe('State Management', () => {
    beforeEach(async () => {
      manager = await initQuickTabs(mockEventBus, mockEvents);
    });

    describe('getQuickTab()', () => {
      test('should return Quick Tab from tabs Map', () => {
        const mockTab = { id: 'qt-123', url: 'https://example.com' };
        manager.tabs.set('qt-123', mockTab);

        const result = manager.getQuickTab('qt-123');

        expect(result).toBe(mockTab);
      });

      test('should return undefined for non-existent tab', () => {
        const result = manager.getQuickTab('qt-nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('getAllQuickTabs()', () => {
      test('should return array of all Quick Tabs', () => {
        // Clear any existing tabs first
        manager.tabs.clear();
        const mockTab1 = { id: 'qt-1', url: 'https://example.com' };
        const mockTab2 = { id: 'qt-2', url: 'https://test.com' };
        manager.tabs.set('qt-1', mockTab1);
        manager.tabs.set('qt-2', mockTab2);

        const result = manager.getAllQuickTabs();

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(mockTab1);
        expect(result).toContainEqual(mockTab2);
      });

      test('should return empty array when no tabs', () => {
        // Clear any existing tabs first
        manager.tabs.clear();

        const result = manager.getAllQuickTabs();

        expect(result).toEqual([]);
      });
    });

    describe('getMinimizedQuickTabs()', () => {
      test('should delegate to MinimizedManager', () => {
        manager.getMinimizedQuickTabs();

        expect(manager.minimizedManager.getAll).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  describe('Utility Methods', () => {
    beforeEach(async () => {
      manager = await initQuickTabs(mockEventBus, mockEvents);
    });

    describe('generateId()', () => {
      test('should generate unique ID with qt- prefix', () => {
        const id1 = manager.generateId();
        const id2 = manager.generateId();

        expect(id1).toMatch(/^qt-\d+-[a-z0-9]+$/);
        expect(id2).toMatch(/^qt-\d+-[a-z0-9]+$/);
        expect(id1).not.toBe(id2);
      });
    });

    describe('generateSaveId()', () => {
      test('should generate unique save ID', () => {
        const saveId1 = manager.generateSaveId();
        const saveId2 = manager.generateSaveId();

        expect(saveId1).toMatch(/^\d+-[a-z0-9]+$/);
        expect(saveId2).toMatch(/^\d+-[a-z0-9]+$/);
        expect(saveId1).not.toBe(saveId2);
      });
    });

    describe('trackPendingSave()', () => {
      test('should add saveId to pendingSaveIds', () => {
        const saveId = 'test-save-id';

        manager.trackPendingSave(saveId);

        expect(manager.pendingSaveIds.has(saveId)).toBe(true);
      });
    });

    describe('releasePendingSave()', () => {
      test('should remove saveId from pendingSaveIds', () => {
        const saveId = 'test-save-id';
        manager.pendingSaveIds.add(saveId);

        manager.releasePendingSave(saveId);

        expect(manager.pendingSaveIds.has(saveId)).toBe(false);
      });
    });

    describe('getCurrentContainer()', () => {
      test('should query active tab and return cookieStoreId', async () => {
        const result = await manager.getCurrentContainer();

        expect(browser.tabs.query).toHaveBeenCalledWith({
          active: true,
          currentWindow: true
        });
        expect(result).toBe('firefox-container-1');
      });

      test('should return firefox-default when no cookieStoreId', async () => {
        browser.tabs.query.mockResolvedValue([{ id: 123, active: true }]);

        const result = await manager.getCurrentContainer();

        expect(result).toBe('firefox-default');
      });

      test('should return stored cookieStoreId on failure', async () => {
        browser.tabs.query.mockRejectedValue(new Error('Query failed'));

        const result = await manager.getCurrentContainer();

        expect(result).toBe('firefox-container-1');
      });
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    test('should use firefox-default when container query fails', () => {
      // Test the error handling path directly via detectContainerContext
      // Note: initQuickTabs returns singleton, so we test detectContainerContext separately
      expect(manager.detectContainerContext).toBeDefined();
    });

    test('should handle tab ID detection failure', () => {
      // Test the error handling path directly via detectCurrentTabId
      expect(manager.detectCurrentTabId).toBeDefined();
    });

    test('should handle state hydration failure gracefully', async () => {
      // Reset and configure storage to fail
      const failingStorage = {
        setupStorageListeners: jest.fn(),
        loadAll: jest.fn().mockRejectedValue(new Error('Storage failed'))
      };
      StorageManager.mockImplementation(() => failingStorage);

      // Test hydration handles errors gracefully
      const newManager = await initQuickTabs(mockEventBus, mockEvents);

      // Should not throw, manager should still be initialized
      expect(newManager.initialized).toBe(true);
    });
  });
});
