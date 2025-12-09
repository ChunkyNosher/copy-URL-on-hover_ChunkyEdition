/**
 * @fileoverview Unit tests for VisibilityHandler
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { VisibilityHandler } from '@features/quick-tabs/handlers/VisibilityHandler.js';

describe('VisibilityHandler', () => {
  let visibilityHandler;
  let mockQuickTabsMap;
  let mockMinimizedManager;
  let mockEventBus;
  let mockCurrentZIndex;
  let mockTab;
  let mockCurrentTabId;
  let mockEvents;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock tab with buttons
    mockTab = {
      id: 'qt-123',
      // v1.6.3.4-v9 - Add url for event payload validation
      url: 'https://example.com',
      title: 'Example Tab',
      soloedOnTabs: [],
      mutedOnTabs: [],
      soloButton: {
        textContent: '⭕',
        title: 'Solo (show only on this tab)',
        style: { background: 'transparent' }
      },
      muteButton: {
        textContent: '🔊',
        title: 'Mute (hide on this tab)',
        style: { background: 'transparent' }
      },
      updateZIndex: jest.fn(),
      // v1.6.3.4-v7 - Add missing methods for instance validation
      minimize: jest.fn(),
      restore: jest.fn(),
      // v1.6.3.4-v9 - Add minimized state for restore validation
      minimized: true,
      // v1.6.3.4-v9 - Add position and size for complete entity data
      left: 100,
      top: 100,
      width: 400,
      height: 300,
      // v1.6.3.5-v5 - Add isRendered for DOM verification
      isRendered: jest.fn(() => true),
      container: { parentNode: document.body }
    };

    // Create mock Map
    mockQuickTabsMap = new Map([['qt-123', mockTab]]);

    // Create mock minimized manager
    mockMinimizedManager = {
      add: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(() => true),
      getCount: jest.fn(() => 0),
      // v1.6.3.4-v9 - Add hasSnapshot for restore validation
      hasSnapshot: jest.fn(() => true)
    };

    // Create mock event bus
    mockEventBus = new EventEmitter();

    // Create mock z-index ref
    mockCurrentZIndex = { value: 10000 };

    // Mock current tab ID
    mockCurrentTabId = 123;

    // Mock Events object
    mockEvents = {
      QUICK_TAB_MINIMIZED: 'quick-tab:minimized',
      QUICK_TAB_RESTORED: 'quick-tab:restored',
      QUICK_TAB_FOCUSED: 'quick-tab:focused'
    };

    // Create handler
    visibilityHandler = new VisibilityHandler({
      quickTabsMap: mockQuickTabsMap,
      minimizedManager: mockMinimizedManager,
      eventBus: mockEventBus,
      currentZIndex: mockCurrentZIndex,
      currentTabId: mockCurrentTabId,
      Events: mockEvents
    });
  });

  describe('Constructor', () => {
    test('should initialize with required dependencies', () => {
      expect(visibilityHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(visibilityHandler.minimizedManager).toBe(mockMinimizedManager);
      expect(visibilityHandler.eventBus).toBe(mockEventBus);
    });
  });

  describe('handleSoloToggle()', () => {
    test('should update tab solo state', () => {
      visibilityHandler.handleSoloToggle('qt-123', [100, 200]);

      expect(mockTab.soloedOnTabs).toEqual([100, 200]);
    });

    test('should clear mute state when solo is set', () => {
      mockTab.mutedOnTabs = [100];

      visibilityHandler.handleSoloToggle('qt-123', [200]);

      expect(mockTab.mutedOnTabs).toEqual([]);
    });

    test('should update solo button appearance when soloed', () => {
      visibilityHandler.handleSoloToggle('qt-123', [100]);

      expect(mockTab.soloButton.textContent).toBe('🎯');
      expect(mockTab.soloButton.title).toBe('Un-solo (show on all tabs)');
      expect(mockTab.soloButton.style.background).toBe('#444');
    });

    test('should update solo button appearance when not soloed', () => {
      visibilityHandler.handleSoloToggle('qt-123', []);

      expect(mockTab.soloButton.textContent).toBe('⭕');
      expect(mockTab.soloButton.title).toBe('Solo (show only on this tab)');
      expect(mockTab.soloButton.style.background).toBe('transparent');
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        visibilityHandler.handleSoloToggle('qt-999', [100]);
      }).not.toThrow();
    });

    test('should handle tab without solo button gracefully', () => {
      mockTab.soloButton = null;

      expect(() => {
        visibilityHandler.handleSoloToggle('qt-123', [100]);
      }).not.toThrow();
    });
  });

  describe('handleMuteToggle()', () => {
    test('should update tab mute state', () => {
      visibilityHandler.handleMuteToggle('qt-123', [100, 200]);

      expect(mockTab.mutedOnTabs).toEqual([100, 200]);
    });

    test('should clear solo state when mute is set', () => {
      mockTab.soloedOnTabs = [100];

      visibilityHandler.handleMuteToggle('qt-123', [200]);

      expect(mockTab.soloedOnTabs).toEqual([]);
    });

    test('should update mute button appearance when muted on current tab', () => {
      visibilityHandler.handleMuteToggle('qt-123', [123]); // 123 is current tab ID

      expect(mockTab.muteButton.textContent).toBe('🔇');
      expect(mockTab.muteButton.title).toBe('Unmute (show on this tab)');
      expect(mockTab.muteButton.style.background).toBe('#c44');
    });

    test('should update mute button appearance when not muted on current tab', () => {
      visibilityHandler.handleMuteToggle('qt-123', [456]); // Different tab ID

      expect(mockTab.muteButton.textContent).toBe('🔊');
      expect(mockTab.muteButton.title).toBe('Mute (hide on this tab)');
      expect(mockTab.muteButton.style.background).toBe('transparent');
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        visibilityHandler.handleMuteToggle('qt-999', [100]);
      }).not.toThrow();
    });

    test('should handle tab without mute button gracefully', () => {
      mockTab.muteButton = null;

      expect(() => {
        visibilityHandler.handleMuteToggle('qt-123', [100]);
      }).not.toThrow();
    });
  });

  describe('handleMinimize()', () => {
    test('should add tab to minimized manager', () => {
      visibilityHandler.handleMinimize('qt-123');

      expect(mockMinimizedManager.add).toHaveBeenCalledWith('qt-123', mockTab);
    });

    test('should emit minimize event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:minimized', eventSpy);

      visibilityHandler.handleMinimize('qt-123');

      // v1.6.3.4 - FIX Issue #6: Now includes source parameter in event data
      expect(eventSpy).toHaveBeenCalledWith({ id: 'qt-123', source: 'unknown' });
    });

    test('should emit state:updated event for panel sync', () => {
      const stateUpdatedSpy = jest.fn();
      mockEventBus.on('state:updated', stateUpdatedSpy);

      visibilityHandler.handleMinimize('qt-123');

      // v1.6.3.4 - FIX Issue #6: Now includes source parameter in event data
      expect(stateUpdatedSpy).toHaveBeenCalledWith({
        quickTab: expect.objectContaining({
          id: 'qt-123',
          minimized: true
        }),
        source: 'unknown'
      });
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        visibilityHandler.handleMinimize('qt-999');
      }).not.toThrow();
    });
  });

  describe('handleRestore()', () => {
    test('should restore tab from minimized manager', () => {
      visibilityHandler.handleRestore('qt-123');

      expect(mockMinimizedManager.restore).toHaveBeenCalledWith('qt-123');
    });

    test('should emit restore event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:restored', eventSpy);

      visibilityHandler.handleRestore('qt-123');

      // v1.6.3.4 - FIX Issue #6: Now includes source parameter in event data
      expect(eventSpy).toHaveBeenCalledWith({ id: 'qt-123', source: 'unknown' });
    });

    test('should emit state:updated event for panel sync on restore', async () => {
      // Use fake timers for the delayed emit
      jest.useFakeTimers();

      const stateUpdatedSpy = jest.fn();
      mockEventBus.on('state:updated', stateUpdatedSpy);

      visibilityHandler.handleRestore('qt-123');

      // v1.6.3.5-v5 - New implementation uses _verifyRestoreAndEmit with promise-based delay
      // Need to advance timers and flush promises multiple times
      await jest.runAllTimersAsync();
      // Also flush any pending promises
      await Promise.resolve();
      await jest.runAllTimersAsync();

      // v1.6.3.4 - FIX Issue #6: Now includes source parameter in event data
      expect(stateUpdatedSpy).toHaveBeenCalledWith({
        quickTab: expect.objectContaining({
          id: 'qt-123',
          minimized: false
        }),
        source: 'unknown'
      });

      // Restore real timers
      jest.useRealTimers();
    });

    test('should not emit event if tab not found in minimized manager', () => {
      mockMinimizedManager.restore.mockReturnValue(false);
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:restored', eventSpy);

      visibilityHandler.handleRestore('qt-999');

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleFocus()', () => {
    test('should increment z-index', () => {
      const initialZIndex = mockCurrentZIndex.value;

      visibilityHandler.handleFocus('qt-123');

      expect(mockCurrentZIndex.value).toBe(initialZIndex + 1);
    });

    test('should update tab z-index', () => {
      visibilityHandler.handleFocus('qt-123');

      expect(mockTab.updateZIndex).toHaveBeenCalledWith(mockCurrentZIndex.value);
    });

    test('should emit focus event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:focused', eventSpy);

      visibilityHandler.handleFocus('qt-123');

      expect(eventSpy).toHaveBeenCalledWith({ id: 'qt-123' });
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        visibilityHandler.handleFocus('qt-999');
      }).not.toThrow();
    });
  });

  describe('Alias methods', () => {
    test('restoreQuickTab should call handleRestore with source parameter', () => {
      const spy = jest.spyOn(visibilityHandler, 'handleRestore');

      visibilityHandler.restoreQuickTab('qt-123');

      // v1.6.3.4 - FIX Issue #6: Now includes source parameter
      expect(spy).toHaveBeenCalledWith('qt-123', 'unknown');
    });

    test('restoreById should call handleRestore with source parameter', () => {
      const spy = jest.spyOn(visibilityHandler, 'handleRestore');

      visibilityHandler.restoreById('qt-123');

      // v1.6.3.4 - FIX Issue #6: Now includes source parameter
      expect(spy).toHaveBeenCalledWith('qt-123', 'unknown');
    });
  });

  describe('Integration', () => {
    test('should handle complete solo flow', () => {
      visibilityHandler.handleSoloToggle('qt-123', [100, 200]);

      expect(mockTab.soloedOnTabs).toEqual([100, 200]);
      expect(mockTab.mutedOnTabs).toEqual([]);
    });

    test('should handle complete mute flow', () => {
      visibilityHandler.handleMuteToggle('qt-123', [100, 200]);

      expect(mockTab.mutedOnTabs).toEqual([100, 200]);
      expect(mockTab.soloedOnTabs).toEqual([]);
    });

    test('should handle complete minimize flow', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:minimized', eventSpy);

      visibilityHandler.handleMinimize('qt-123');

      expect(mockMinimizedManager.add).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalled();
    });

    test('should handle complete focus flow', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:focused', eventSpy);

      visibilityHandler.handleFocus('qt-123');

      expect(mockCurrentZIndex.value).toBeGreaterThan(10000);
      expect(mockTab.updateZIndex).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalled();
    });
  });
});
