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

      expect(mockStateManager.hydrate).toHaveBeenCalledWith([quickTab]);
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
