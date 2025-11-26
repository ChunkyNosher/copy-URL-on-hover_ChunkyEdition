/**
 * SyncCoordinator Unit Tests
 * v1.6.2 - MIGRATION: Updated for storage.onChanged-only architecture
 * 
 * The SyncCoordinator now:
 * - Uses storage.onChanged exclusively for cross-tab sync
 * - Does NOT use BroadcastManager (removed)
 * - Handles state hydration from storage changes
 */
import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { SyncCoordinator } from '../../../src/features/quick-tabs/coordinators/SyncCoordinator.js';

// Mock dependencies
const createMockStateManager = () => ({
  hydrate: jest.fn(),
  get: jest.fn(),
  getAll: jest.fn(() => [])
});

const createMockStorageManager = () => ({
  shouldIgnoreStorageChange: jest.fn(() => false),
  save: jest.fn(),
  loadAll: jest.fn(async () => [])
});

const createMockHandlers = () => ({
  create: {
    create: jest.fn()
  },
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
  destroy: {
    handleDestroy: jest.fn()
  }
});

describe('SyncCoordinator', () => {
  let syncCoordinator;
  let mockStateManager;
  let mockStorageManager;
  let mockHandlers;
  let mockEventBus;

  beforeEach(() => {
    mockStateManager = createMockStateManager();
    mockStorageManager = createMockStorageManager();
    mockHandlers = createMockHandlers();
    mockEventBus = new EventEmitter();

    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with all dependencies (v1.6.2 - no broadcastManager)', () => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );

      expect(syncCoordinator.stateManager).toBe(mockStateManager);
      expect(syncCoordinator.storageManager).toBe(mockStorageManager);
      expect(syncCoordinator.handlers).toBe(mockHandlers);
      expect(syncCoordinator.eventBus).toBe(mockEventBus);
      // v1.6.2 - broadcastManager removed
      expect(syncCoordinator.broadcastManager).toBeUndefined();
    });
  });

  describe('setupListeners()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );
    });

    test('should setup storage change listener', () => {
      const spy = jest.spyOn(mockEventBus, 'on');

      syncCoordinator.setupListeners();

      expect(spy).toHaveBeenCalledWith('storage:changed', expect.any(Function));
    });

    test('should setup tab visible listener', () => {
      const spy = jest.spyOn(mockEventBus, 'on');

      syncCoordinator.setupListeners();

      expect(spy).toHaveBeenCalledWith('event:tab-visible', expect.any(Function));
    });

    // v1.6.2 - broadcast:received listener removed
    test('should NOT setup broadcast:received listener (v1.6.2)', () => {
      const spy = jest.spyOn(mockEventBus, 'on');

      syncCoordinator.setupListeners();

      // Should not be listening for broadcast events
      const calls = spy.mock.calls.map(call => call[0]);
      expect(calls).not.toContain('broadcast:received');
    });
  });

  describe('handleStorageChange()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );
      syncCoordinator.setupListeners();
    });

    test('should sync state when storage changes', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      const newValue = {
        quickTabs: [quickTab],
        saveId: 'save-123'
      };

      // v1.6.2 - storage:changed now passes { state: newValue }
      mockEventBus.emit('storage:changed', { state: newValue });

      // v1.6.2.x - hydrate now called with detectChanges: true for position/size sync
      expect(mockStateManager.hydrate).toHaveBeenCalledWith([quickTab], { detectChanges: true });
    });

    test('should ignore own storage changes', () => {
      mockStorageManager.shouldIgnoreStorageChange.mockReturnValue(true);

      const newValue = {
        quickTabs: [],
        saveId: 'save-123'
      };

      mockEventBus.emit('storage:changed', { state: newValue });

      expect(mockStateManager.hydrate).not.toHaveBeenCalled();
    });

    test('should handle null state gracefully', () => {
      mockEventBus.emit('storage:changed', { state: null });

      expect(mockStateManager.hydrate).not.toHaveBeenCalled();
    });

    test('should handle storage change with empty quickTabs', () => {
      const newValue = {
        quickTabs: []
        // No saveId
      };

      mockEventBus.emit('storage:changed', { state: newValue });

      // Empty array should not trigger hydration (or would hydrate empty array)
      // The behavior depends on implementation - we just verify no error is thrown
    });

    test('should sync state when storage changes with unified format (v1.6.2.2+)', () => {
      const quickTab = QuickTab.create({
        id: 'qt-unified-1',
        url: 'https://example.com',
        container: 'firefox-default',
        position: { left: 500, top: 300 }
      });

      const newValue = {
        tabs: [quickTab],
        saveId: 'unified-save-123',
        timestamp: Date.now()
      };

      mockEventBus.emit('storage:changed', { state: newValue });

      expect(mockStateManager.hydrate).toHaveBeenCalledWith([quickTab], { detectChanges: true });
    });

    test('should sync multiple Quick Tabs with unified format', () => {
      const quickTab1 = QuickTab.create({
        id: 'qt-multi-1',
        url: 'https://example1.com',
        container: 'firefox-default'
      });
      
      const quickTab2 = QuickTab.create({
        id: 'qt-multi-2',
        url: 'https://example2.com',
        container: 'firefox-default'
      });

      const newValue = {
        tabs: [quickTab1, quickTab2],
        saveId: 'multi-save-123',
        timestamp: Date.now()
      };

      mockEventBus.emit('storage:changed', { state: newValue });

      expect(mockStateManager.hydrate).toHaveBeenCalledWith([quickTab1, quickTab2], { detectChanges: true });
    });
  });

  describe('_extractQuickTabsFromStorage()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );
    });

    test('should extract Quick Tabs from unified format (v1.6.2.2+)', () => {
      const storageValue = {
        tabs: [
          { id: 'qt-123', url: 'https://example.com', position: { left: 100, top: 100 } },
          { id: 'qt-456', url: 'https://test.com', position: { left: 200, top: 200 } }
        ],
        timestamp: Date.now(),
        saveId: 'abc-123'
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toHaveLength(2);
      expect(extracted[0].id).toBe('qt-123');
      expect(extracted[1].id).toBe('qt-456');
    });

    test('should extract Quick Tabs from legacy quickTabs format (v1.6.1.x)', () => {
      const storageValue = {
        quickTabs: [
          { id: 'qt-789', url: 'https://legacy.com' }
        ]
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toHaveLength(1);
      expect(extracted[0].id).toBe('qt-789');
    });

    test('should extract Quick Tabs from container format (v1.6.2.1-)', () => {
      const storageValue = {
        containers: {
          'firefox-default': {
            tabs: [
              { id: 'qt-container-1', url: 'https://container1.com' }
            ]
          },
          'firefox-personal': {
            tabs: [
              { id: 'qt-container-2', url: 'https://container2.com' }
            ]
          }
        }
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toHaveLength(2);
      expect(extracted.map(qt => qt.id)).toContain('qt-container-1');
      expect(extracted.map(qt => qt.id)).toContain('qt-container-2');
    });

    test('should return empty array for empty storage', () => {
      const extracted = syncCoordinator._extractQuickTabsFromStorage({});
      
      expect(extracted).toEqual([]);
    });

    test('should return empty array when tabs array is empty', () => {
      const storageValue = {
        tabs: [],
        timestamp: Date.now(),
        saveId: 'empty-123'
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toEqual([]);
    });

    test('should prioritize unified format over legacy formats', () => {
      // Storage with both formats - unified should take precedence
      const storageValue = {
        tabs: [{ id: 'qt-unified', url: 'https://unified.com' }],
        quickTabs: [{ id: 'qt-legacy', url: 'https://legacy.com' }],
        timestamp: Date.now(),
        saveId: 'mixed-123'
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toHaveLength(1);
      expect(extracted[0].id).toBe('qt-unified');
    });

    test('should handle container format with empty tabs arrays', () => {
      const storageValue = {
        containers: {
          'firefox-default': {
            tabs: []
          }
        }
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toEqual([]);
    });

    test('should handle container format with missing tabs property', () => {
      const storageValue = {
        containers: {
          'firefox-default': {}
        }
      };

      const extracted = syncCoordinator._extractQuickTabsFromStorage(storageValue);
      
      expect(extracted).toEqual([]);
    });
  });

  describe('handleTabVisible()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );
      syncCoordinator.setupListeners();
    });

    test('should load state from storage when tab becomes visible', async () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      mockStorageManager.loadAll.mockResolvedValue([quickTab]);
      mockStateManager.getAll.mockReturnValue([]);

      mockEventBus.emit('event:tab-visible');

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockStorageManager.loadAll).toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    test('should coordinate storage handling (v1.6.2 - storage only)', () => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );

      syncCoordinator.setupListeners();

      // Storage change
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      mockEventBus.emit('storage:changed', { state: { quickTabs: [quickTab], saveId: 'save-1' } });
      expect(mockStateManager.hydrate).toHaveBeenCalled();
    });

    test('should handle multiple storage changes in sequence', () => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockHandlers,
        mockEventBus
      );

      syncCoordinator.setupListeners();

      // First change
      const quickTab1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default'
      });
      mockEventBus.emit('storage:changed', { state: { quickTabs: [quickTab1], saveId: 'save-1' } });
      expect(mockStateManager.hydrate).toHaveBeenCalledTimes(1);

      // Second change  
      const quickTab2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://example2.com',
        container: 'firefox-default'
      });
      mockEventBus.emit('storage:changed', { state: { quickTabs: [quickTab1, quickTab2], saveId: 'save-2' } });
      expect(mockStateManager.hydrate).toHaveBeenCalledTimes(2);
    });
  });
});
