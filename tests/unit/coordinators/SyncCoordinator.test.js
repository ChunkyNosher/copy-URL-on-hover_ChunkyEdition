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
  save: jest.fn()
});

const createMockBroadcastManager = () => ({
  broadcast: jest.fn()
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
  let mockBroadcastManager;
  let mockHandlers;
  let mockEventBus;

  beforeEach(() => {
    mockStateManager = createMockStateManager();
    mockStorageManager = createMockStorageManager();
    mockBroadcastManager = createMockBroadcastManager();
    mockHandlers = createMockHandlers();
    mockEventBus = new EventEmitter();

    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with all dependencies', () => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockBroadcastManager,
        mockHandlers,
        mockEventBus
      );

      expect(syncCoordinator.stateManager).toBe(mockStateManager);
      expect(syncCoordinator.storageManager).toBe(mockStorageManager);
      expect(syncCoordinator.broadcastManager).toBe(mockBroadcastManager);
      expect(syncCoordinator.handlers).toBe(mockHandlers);
      expect(syncCoordinator.eventBus).toBe(mockEventBus);
    });
  });

  describe('setupListeners()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockBroadcastManager,
        mockHandlers,
        mockEventBus
      );
    });

    test('should setup storage change listener', () => {
      const spy = jest.spyOn(mockEventBus, 'on');

      syncCoordinator.setupListeners();

      expect(spy).toHaveBeenCalledWith('storage:changed', expect.any(Function));
    });

    test('should setup broadcast message listener', () => {
      const spy = jest.spyOn(mockEventBus, 'on');

      syncCoordinator.setupListeners();

      expect(spy).toHaveBeenCalledWith('broadcast:received', expect.any(Function));
    });
  });

  describe('handleStorageChange()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockBroadcastManager,
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

      mockEventBus.emit('storage:changed', newValue);

      expect(mockStateManager.hydrate).toHaveBeenCalledWith([quickTab]);
    });

    test('should ignore own storage changes', () => {
      mockStorageManager.shouldIgnoreStorageChange.mockReturnValue(true);

      const newValue = {
        quickTabs: [],
        saveId: 'save-123'
      };

      mockEventBus.emit('storage:changed', newValue);

      expect(mockStateManager.hydrate).not.toHaveBeenCalled();
    });

    test('should handle null newValue gracefully', () => {
      mockEventBus.emit('storage:changed', null);

      expect(mockStateManager.hydrate).not.toHaveBeenCalled();
    });

    test('should handle undefined saveId', () => {
      const newValue = {
        quickTabs: []
        // No saveId
      };

      mockEventBus.emit('storage:changed', newValue);

      expect(mockStorageManager.shouldIgnoreStorageChange).toHaveBeenCalledWith(undefined);
    });
  });

  describe('handleBroadcastMessage()', () => {
    beforeEach(() => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockBroadcastManager,
        mockHandlers,
        mockEventBus
      );
      syncCoordinator.setupListeners();
    });

    test('should route CREATE message to create handler', () => {
      const data = {
        id: 'qt-1',
        url: 'https://example.com'
      };

      mockEventBus.emit('broadcast:received', { type: 'CREATE', data });

      expect(mockHandlers.create.create).toHaveBeenCalledWith(data);
    });

    test('should route UPDATE_POSITION message to update handler', () => {
      const data = {
        id: 'qt-1',
        left: 150,
        top: 250
      };

      mockEventBus.emit('broadcast:received', { type: 'UPDATE_POSITION', data });

      expect(mockHandlers.update.handlePositionChangeEnd).toHaveBeenCalledWith('qt-1', 150, 250);
    });

    test('should route UPDATE_SIZE message to update handler', () => {
      const data = {
        id: 'qt-1',
        width: 500,
        height: 400
      };

      mockEventBus.emit('broadcast:received', { type: 'UPDATE_SIZE', data });

      expect(mockHandlers.update.handleSizeChangeEnd).toHaveBeenCalledWith('qt-1', 500, 400);
    });

    test('should route SOLO message to visibility handler', () => {
      const data = {
        id: 'qt-1',
        soloedOnTabs: [100, 200]
      };

      mockEventBus.emit('broadcast:received', { type: 'SOLO', data });

      expect(mockHandlers.visibility.handleSoloToggle).toHaveBeenCalledWith('qt-1', [100, 200]);
    });

    test('should route MUTE message to visibility handler', () => {
      const data = {
        id: 'qt-1',
        mutedOnTabs: [100, 200]
      };

      mockEventBus.emit('broadcast:received', { type: 'MUTE', data });

      expect(mockHandlers.visibility.handleMuteToggle).toHaveBeenCalledWith('qt-1', [100, 200]);
    });

    test('should route MINIMIZE message to visibility handler', () => {
      const data = {
        id: 'qt-1'
      };

      mockEventBus.emit('broadcast:received', { type: 'MINIMIZE', data });

      expect(mockHandlers.visibility.handleMinimize).toHaveBeenCalledWith('qt-1');
    });

    test('should route RESTORE message to visibility handler', () => {
      const data = {
        id: 'qt-1'
      };

      mockEventBus.emit('broadcast:received', { type: 'RESTORE', data });

      expect(mockHandlers.visibility.handleRestore).toHaveBeenCalledWith('qt-1');
    });

    test('should route CLOSE message to destroy handler', () => {
      const data = {
        id: 'qt-1'
      };

      mockEventBus.emit('broadcast:received', { type: 'CLOSE', data });

      expect(mockHandlers.destroy.handleDestroy).toHaveBeenCalledWith('qt-1');
    });

    test('should handle unknown message type gracefully', () => {
      const data = {
        id: 'qt-1'
      };

      // Should not throw
      expect(() => {
        mockEventBus.emit('broadcast:received', { type: 'UNKNOWN_TYPE', data });
      }).not.toThrow();
    });

    test('should handle null data gracefully', () => {
      expect(() => {
        mockEventBus.emit('broadcast:received', { type: 'CREATE', data: null });
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    test('should coordinate storage and broadcast handling', () => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockBroadcastManager,
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

      mockEventBus.emit('storage:changed', { quickTabs: [quickTab], saveId: 'save-1' });
      expect(mockStateManager.hydrate).toHaveBeenCalled();

      // Broadcast message
      mockEventBus.emit('broadcast:received', {
        type: 'SOLO',
        data: { id: 'qt-1', soloedOnTabs: [100] }
      });

      expect(mockHandlers.visibility.handleSoloToggle).toHaveBeenCalled();
    });

    test('should handle multiple message types in sequence', () => {
      syncCoordinator = new SyncCoordinator(
        mockStateManager,
        mockStorageManager,
        mockBroadcastManager,
        mockHandlers,
        mockEventBus
      );

      syncCoordinator.setupListeners();

      // Create
      mockEventBus.emit('broadcast:received', {
        type: 'CREATE',
        data: { id: 'qt-1', url: 'https://example.com' }
      });
      expect(mockHandlers.create.create).toHaveBeenCalledTimes(1);

      // Update position
      mockEventBus.emit('broadcast:received', {
        type: 'UPDATE_POSITION',
        data: { id: 'qt-1', left: 100, top: 200 }
      });
      expect(mockHandlers.update.handlePositionChangeEnd).toHaveBeenCalledTimes(1);

      // Solo
      mockEventBus.emit('broadcast:received', {
        type: 'SOLO',
        data: { id: 'qt-1', soloedOnTabs: [100] }
      });
      expect(mockHandlers.visibility.handleSoloToggle).toHaveBeenCalledTimes(1);

      // Close
      mockEventBus.emit('broadcast:received', {
        type: 'CLOSE',
        data: { id: 'qt-1' }
      });
      expect(mockHandlers.destroy.handleDestroy).toHaveBeenCalledTimes(1);
    });
  });
});
