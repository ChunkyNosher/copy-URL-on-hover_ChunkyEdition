/**
 * @fileoverview Unit tests for DestroyHandler
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { DestroyHandler } from '@features/quick-tabs/handlers/DestroyHandler.js';

describe('DestroyHandler', () => {
  let destroyHandler;
  let mockQuickTabsMap;
  let mockMinimizedManager;
  let mockEventBus;
  let mockCurrentZIndex;
  let mockTab;
  let mockEvents;
  let mockBaseZIndex;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock tab
    mockTab = {
      id: 'qt-123',
      url: 'https://example.com',
      destroy: jest.fn()
    };

    // Create mock Map
    mockQuickTabsMap = new Map([
      ['qt-123', mockTab],
      ['qt-456', { id: 'qt-456', destroy: jest.fn() }]
    ]);

    // Create mock minimized manager
    mockMinimizedManager = {
      remove: jest.fn(),
      clear: jest.fn()
    };

    // Create mock event bus
    mockEventBus = new EventEmitter();

    // Create mock z-index ref
    mockBaseZIndex = 10000;
    mockCurrentZIndex = { value: 10005 };

    // Mock Events object
    mockEvents = {
      QUICK_TAB_CLOSED: 'quick-tab:closed'
    };

    // Create handler
    destroyHandler = new DestroyHandler(
      mockQuickTabsMap,
      mockMinimizedManager,
      mockEventBus,
      mockCurrentZIndex,
      mockEvents,
      mockBaseZIndex
    );
  });

  describe('Constructor', () => {
    test('should initialize with required dependencies', () => {
      expect(destroyHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(destroyHandler.minimizedManager).toBe(mockMinimizedManager);
      expect(destroyHandler.eventBus).toBe(mockEventBus);
    });
  });

  describe('handleDestroy()', () => {
    test('should delete tab from quickTabsMap', () => {
      destroyHandler.handleDestroy('qt-123');

      expect(mockQuickTabsMap.has('qt-123')).toBe(false);
    });

    test('should remove tab from minimized manager', () => {
      destroyHandler.handleDestroy('qt-123');

      expect(mockMinimizedManager.remove).toHaveBeenCalledWith('qt-123');
    });

    test('should emit destruction event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:closed', eventSpy);

      destroyHandler.handleDestroy('qt-123');

      expect(eventSpy).toHaveBeenCalledWith({ id: 'qt-123' });
    });

    test('should reset z-index when all tabs closed', () => {
      mockQuickTabsMap.clear();
      mockQuickTabsMap.set('qt-123', mockTab);

      destroyHandler.handleDestroy('qt-123');

      expect(mockCurrentZIndex.value).toBe(mockBaseZIndex);
    });

    test('should not reset z-index when tabs remain', () => {
      const originalZIndex = mockCurrentZIndex.value;

      destroyHandler.handleDestroy('qt-123');

      expect(mockCurrentZIndex.value).toBe(originalZIndex);
      expect(mockQuickTabsMap.size).toBeGreaterThan(0);
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        destroyHandler.handleDestroy('qt-999');
      }).not.toThrow();
    });

    // v1.6.3.6-v5 - FIX Deletion Loop: Test that duplicate calls are prevented
    test('should skip if ID was already destroyed (prevents deletion loop)', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('state:deleted', eventSpy);

      // First call should process normally
      destroyHandler.handleDestroy('qt-123', 'UI');
      expect(eventSpy).toHaveBeenCalledTimes(1);

      // Second call should skip (ID already in _destroyedIds)
      destroyHandler.handleDestroy('qt-123', 'UICoordinator');
      
      // state:deleted should NOT be emitted again
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

    test('wasRecentlyDestroyed() should return true after handleDestroy()', () => {
      expect(destroyHandler.wasRecentlyDestroyed('qt-123')).toBe(false);
      
      destroyHandler.handleDestroy('qt-123');
      
      expect(destroyHandler.wasRecentlyDestroyed('qt-123')).toBe(true);
    });
  });

  describe('closeById()', () => {
    test('should call tab destroy method', () => {
      destroyHandler.closeById('qt-123');

      expect(mockTab.destroy).toHaveBeenCalled();
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        destroyHandler.closeById('qt-999');
      }).not.toThrow();
    });

    test('should handle tab without destroy method gracefully', () => {
      mockTab.destroy = undefined;

      expect(() => {
        destroyHandler.closeById('qt-123');
      }).not.toThrow();
    });
  });

  describe('closeAll()', () => {
    test('should destroy all tabs', () => {
      const tab1DestroyMock = mockTab.destroy;
      const tab2DestroyMock = mockQuickTabsMap.get('qt-456').destroy;

      destroyHandler.closeAll();

      expect(tab1DestroyMock).toHaveBeenCalled();
      expect(tab2DestroyMock).toHaveBeenCalled();
    });

    test('should clear quickTabsMap', () => {
      destroyHandler.closeAll();

      expect(mockQuickTabsMap.size).toBe(0);
    });

    test('should clear minimized manager', () => {
      destroyHandler.closeAll();

      expect(mockMinimizedManager.clear).toHaveBeenCalled();
    });

    test('should reset z-index', () => {
      destroyHandler.closeAll();

      expect(mockCurrentZIndex.value).toBe(mockBaseZIndex);
    });

    test('should handle empty quickTabsMap gracefully', () => {
      mockQuickTabsMap.clear();

      expect(() => {
        destroyHandler.closeAll();
      }).not.toThrow();
    });

    test('should handle tabs without destroy method', () => {
      mockQuickTabsMap.forEach(tab => {
        tab.destroy = undefined;
      });

      expect(() => {
        destroyHandler.closeAll();
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    test('should handle complete destroy flow', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:closed', eventSpy);

      destroyHandler.handleDestroy('qt-123');

      expect(mockQuickTabsMap.has('qt-123')).toBe(false);
      expect(mockMinimizedManager.remove).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalled();
    });

    test('should handle closeById before handleDestroy', () => {
      // First close via closeById (calls tab.destroy())
      destroyHandler.closeById('qt-123');
      expect(mockTab.destroy).toHaveBeenCalled();

      // Then cleanup via handleDestroy
      destroyHandler.handleDestroy('qt-123');
      expect(mockQuickTabsMap.has('qt-123')).toBe(false);
    });

    test('should handle closeAll cleanup', () => {
      const destroySpy1 = jest.fn();
      const destroySpy2 = jest.fn();

      mockQuickTabsMap.get('qt-123').destroy = destroySpy1;
      mockQuickTabsMap.get('qt-456').destroy = destroySpy2;

      destroyHandler.closeAll();

      expect(destroySpy1).toHaveBeenCalled();
      expect(destroySpy2).toHaveBeenCalled();
      expect(mockQuickTabsMap.size).toBe(0);
      expect(mockMinimizedManager.clear).toHaveBeenCalled();
      expect(mockCurrentZIndex.value).toBe(mockBaseZIndex);
    });
  });
});
