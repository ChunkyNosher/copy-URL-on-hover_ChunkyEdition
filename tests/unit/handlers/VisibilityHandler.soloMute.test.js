/**
 * VisibilityHandler Solo/Mute Behavior Tests
 * 
 * Enhanced tests for solo/mute mutual exclusivity, cross-tab sync,
 * and tab closure cleanup as specified in comprehensive-unit-testing-strategy.md (Section 2)
 * 
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 2.1-2.2)
 * - docs/issue-47-revised-scenarios.md (Scenarios 3, 4, 13)
 * 
 * Related Issues:
 * - #35: Quick Tabs don't persist across tabs
 * - #47: Quick Tabs comprehensive behavior scenarios
 * 
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { VisibilityHandler } from '@features/quick-tabs/handlers/VisibilityHandler.js';

// Mock browser API
global.browser = {
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve())
  },
  tabs: {
    onRemoved: {
      addListener: jest.fn()
    }
  }
};

describe('VisibilityHandler - Solo/Mute Mutual Exclusivity', () => {
  let visibilityHandler;
  let mockQuickTabsMap;
  let mockBroadcastManager;
  let mockStorageManager;
  let mockMinimizedManager;
  let mockEventBus;
  let mockCurrentZIndex;
  let mockTab;
  let mockGenerateSaveId;
  let mockTrackPendingSave;
  let mockReleasePendingSave;
  let mockCurrentTabId;
  let mockEvents;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock tab with buttons
    mockTab = {
      id: 'qt-test-1',
      cookieStoreId: 'firefox-default',
      soloedOnTabs: [],
      mutedOnTabs: [],
      soloButton: {
        textContent: '⭕',
        title: 'Solo (show only on this tab)',
        style: { background: 'transparent' },
        disabled: false
      },
      muteButton: {
        textContent: '🔊',
        title: 'Mute (hide on this tab)',
        style: { background: 'transparent' },
        disabled: false
      },
      updateZIndex: jest.fn()
    };

    mockQuickTabsMap = new Map([['qt-test-1', mockTab]]);
    mockBroadcastManager = {
      notifySolo: jest.fn(),
      notifyMute: jest.fn(),
      notifyMinimize: jest.fn(),
      notifyRestore: jest.fn()
    };
    mockStorageManager = {
      save: jest.fn(async () => {})
    };
    mockMinimizedManager = {
      add: jest.fn(),
      remove: jest.fn()
    };
    mockEventBus = new EventEmitter();
    mockCurrentZIndex = { value: 10000 };
    mockGenerateSaveId = jest.fn(() => `saveId-${Date.now()}`);
    mockTrackPendingSave = jest.fn();
    mockReleasePendingSave = jest.fn();
    mockCurrentTabId = 123;
    mockEvents = {
      QUICK_TAB_MINIMIZED: 'quick-tab:minimized',
      QUICK_TAB_FOCUSED: 'quick-tab:focused',
      QUICK_TAB_RESTORED: 'quick-tab:restored'
    };

    visibilityHandler = new VisibilityHandler({
      quickTabsMap: mockQuickTabsMap,
      broadcastManager: mockBroadcastManager,
      storageManager: mockStorageManager,
      minimizedManager: mockMinimizedManager,
      eventBus: mockEventBus,
      currentZIndex: mockCurrentZIndex,
      generateSaveId: mockGenerateSaveId,
      trackPendingSave: mockTrackPendingSave,
      releasePendingSave: mockReleasePendingSave,
      currentTabId: mockCurrentTabId,
      Events: mockEvents
    });
  });

  describe('Solo Mode Behavior', () => {
    test('should activate solo and restrict visibility to specific tab', () => {
      // Activate solo for tab 123
      visibilityHandler.handleSoloToggle('qt-test-1', [123]);

      expect(mockTab.soloedOnTabs).toEqual([123]);
      expect(mockTab.soloButton.textContent).toBe('🎯');
      expect(mockTab.soloButton.title).toBe('Un-solo (show on all tabs)');
      expect(mockTab.soloButton.style.background).toBe('#444');
    });

    test('should solo mode broadcasting to all tabs immediately', () => {
      visibilityHandler.handleSoloToggle('qt-test-1', [123]);

      expect(mockBroadcastManager.notifySolo).toHaveBeenCalledWith('qt-test-1', [123]);
    });

    test('should solo mode persisting to storage', async () => {
      await visibilityHandler.handleSoloToggle('qt-test-1', [123]);

      // Wait for async storage operation
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_QUICK_TAB_SOLO',
          id: 'qt-test-1',
          soloedOnTabs: [123]
        })
      );
    });

    test('should deactivate solo and restore global visibility', () => {
      // First activate solo
      mockTab.soloedOnTabs = [123];
      mockTab.soloButton.textContent = '🎯';

      // Then deactivate
      visibilityHandler.handleSoloToggle('qt-test-1', []);

      expect(mockTab.soloedOnTabs).toEqual([]);
      expect(mockTab.soloButton.textContent).toBe('⭕');
      expect(mockTab.soloButton.title).toBe('Solo (show only on this tab)');
      expect(mockTab.soloButton.style.background).toBe('transparent');
    });
  });

  describe('Mute Mode Behavior', () => {
    test('should activate mute and hide QT on specific tab only', () => {
      // Mute on current tab (123)
      visibilityHandler.handleMuteToggle('qt-test-1', [123]);

      expect(mockTab.mutedOnTabs).toEqual([123]);
      expect(mockTab.muteButton.textContent).toBe('🔇');
      expect(mockTab.muteButton.title).toBe('Unmute (show on this tab)');
      expect(mockTab.muteButton.style.background).toBe('#c44');
    });

    test('should mute mode broadcasting and syncing across tabs', () => {
      visibilityHandler.handleMuteToggle('qt-test-1', [123]);

      expect(mockBroadcastManager.notifyMute).toHaveBeenCalledWith('qt-test-1', [123]);
    });

    test('should allow multiple tabs to mute same QT independently', () => {
      // Mute on tabs 123 and 456 (current tab is 123, so button should show muted)
      visibilityHandler.handleMuteToggle('qt-test-1', [123, 456]);

      expect(mockTab.mutedOnTabs).toEqual([123, 456]);
      expect(mockTab.muteButton.textContent).toBe('🔇'); // Shows muted because current tab 123 is in list
    });

    test('should remove tab from mute list when unmuting', () => {
      // Setup: muted on multiple tabs
      mockTab.mutedOnTabs = [123, 456, 789];
      mockTab.muteButton.textContent = '🔇';

      // Remove tab 456 from mute list
      visibilityHandler.handleMuteToggle('qt-test-1', [123, 789]);

      expect(mockTab.mutedOnTabs).toEqual([123, 789]);
    });
  });

  describe('Solo/Mute Mutual Exclusivity', () => {
    test('should activating solo disables mute button', () => {
      // Activate solo
      visibilityHandler.handleSoloToggle('qt-test-1', [123]);

      // Mute should be cleared
      expect(mockTab.mutedOnTabs).toEqual([]);
      expect(mockTab.muteButton.style.background).toBe('transparent');
    });

    test('should activating mute disables solo button', () => {
      // Activate mute on current tab
      visibilityHandler.handleMuteToggle('qt-test-1', [123]);

      // Solo should be cleared
      expect(mockTab.soloedOnTabs).toEqual([]);
      expect(mockTab.soloButton.style.background).toBe('transparent');
    });

    test('should deactivating solo re-enables mute button', () => {
      // Activate solo, then deactivate
      visibilityHandler.handleSoloToggle('qt-test-1', [123]);
      visibilityHandler.handleSoloToggle('qt-test-1', []);

      // Now mute should be available
      expect(mockTab.soloedOnTabs).toEqual([]);
      
      // Activate mute should work
      visibilityHandler.handleMuteToggle('qt-test-1', [123]);
      expect(mockTab.mutedOnTabs).toEqual([123]);
    });

    test('should switching from solo to mute clears solo state', () => {
      // Activate solo
      visibilityHandler.handleSoloToggle('qt-test-1', [123]);
      expect(mockTab.soloedOnTabs).toEqual([123]);

      // Activate mute (should clear solo) - using current tab 123
      visibilityHandler.handleMuteToggle('qt-test-1', [123]);
      expect(mockTab.soloedOnTabs).toEqual([]);
      expect(mockTab.mutedOnTabs).toEqual([123]);
    });

    test('should switching from mute to solo clears mute state', () => {
      // Activate mute on current tab
      visibilityHandler.handleMuteToggle('qt-test-1', [123]);
      expect(mockTab.mutedOnTabs).toEqual([123]);

      // Activate solo (should clear mute)
      visibilityHandler.handleSoloToggle('qt-test-1', [123]);
      expect(mockTab.mutedOnTabs).toEqual([]);
      expect(mockTab.soloedOnTabs).toEqual([123]);
    });
  });

  describe('Minimize/Restore Functionality', () => {
    test('should minimize Quick Tab and add to minimized manager', async () => {
      await visibilityHandler.handleMinimize('qt-test-1');

      expect(mockMinimizedManager.add).toHaveBeenCalledWith('qt-test-1', mockTab);
      expect(mockBroadcastManager.notifyMinimize).toHaveBeenCalledWith('qt-test-1');
      expect(mockEventBus.listenerCount('quick-tab:minimized')).toBeGreaterThanOrEqual(0);
    });

    test('should minimize syncing across tabs', async () => {
      await visibilityHandler.handleMinimize('qt-test-1');

      expect(mockBroadcastManager.notifyMinimize).toHaveBeenCalledWith('qt-test-1');
      expect(mockTrackPendingSave).toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_QUICK_TAB_MINIMIZE',
          id: 'qt-test-1',
          minimized: true
        })
      );
    });

    test('should restore Quick Tab from minimized state', async () => {
      // Setup: minimize first
      mockMinimizedManager.restore = jest.fn(() => mockTab);
      mockBroadcastManager.notifyRestore = jest.fn();

      await visibilityHandler.handleRestore('qt-test-1');

      expect(mockMinimizedManager.restore).toHaveBeenCalledWith('qt-test-1');
      expect(mockBroadcastManager.notifyRestore).toHaveBeenCalledWith('qt-test-1');
    });

    test('should restore syncing state across all tabs', async () => {
      mockMinimizedManager.restore = jest.fn(() => mockTab);
      mockBroadcastManager.notifyRestore = jest.fn();

      await visibilityHandler.handleRestore('qt-test-1');

      expect(mockBroadcastManager.notifyRestore).toHaveBeenCalledWith('qt-test-1');
      expect(mockTrackPendingSave).toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_QUICK_TAB_MINIMIZE',
          id: 'qt-test-1',
          minimized: false
        })
      );
    });

    test('should handle restore when tab not in minimized manager', async () => {
      mockMinimizedManager.restore = jest.fn(() => null);

      await visibilityHandler.handleRestore('qt-test-1');

      // Should not broadcast or update storage
      expect(mockBroadcastManager.notifyRestore).not.toHaveBeenCalled();
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle browser.runtime.sendMessage error during solo', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Send failed'));

      await visibilityHandler.handleSoloToggle('qt-test-1', [123]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still release the saveId
      expect(mockReleasePendingSave).toHaveBeenCalled();
    });

    test('should handle browser.runtime.sendMessage error during mute', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Send failed'));

      await visibilityHandler.handleMuteToggle('qt-test-1', [123]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still release the saveId
      expect(mockReleasePendingSave).toHaveBeenCalled();
    });

    test('should handle browser.runtime.sendMessage error during minimize', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Send failed'));

      await visibilityHandler.handleMinimize('qt-test-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still release the saveId
      expect(mockReleasePendingSave).toHaveBeenCalled();
    });

    test('should handle browser.runtime.sendMessage error during restore', async () => {
      mockMinimizedManager.restore = jest.fn(() => mockTab);
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Send failed'));

      await visibilityHandler.handleRestore('qt-test-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still release the saveId
      expect(mockReleasePendingSave).toHaveBeenCalled();
    });

    test('should handle missing browser API during solo', async () => {
      const originalBrowser = global.browser;
      delete global.browser;

      await visibilityHandler.handleSoloToggle('qt-test-1', [123]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still complete without error
      expect(mockReleasePendingSave).toHaveBeenCalled();

      global.browser = originalBrowser;
    });

    test('should handle missing browser API during minimize', async () => {
      const originalBrowser = global.browser;
      delete global.browser;

      await visibilityHandler.handleMinimize('qt-test-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still complete without error
      expect(mockReleasePendingSave).toHaveBeenCalled();

      global.browser = originalBrowser;
    });
  });

  describe('Edge Cases', () => {
    test('should handle non-existent tab ID in handleSoloToggle', () => {
      expect(() => {
        visibilityHandler.handleSoloToggle('non-existent', [123]);
      }).not.toThrow();
    });

    test('should handle non-existent tab ID in handleMuteToggle', () => {
      expect(() => {
        visibilityHandler.handleMuteToggle('non-existent', [456]);
      }).not.toThrow();
    });

    test('should handle non-existent tab ID in handleMinimize', async () => {
      await expect(
        visibilityHandler.handleMinimize('non-existent')
      ).resolves.not.toThrow();
    });

    test('should handle empty soloedOnTabs array', () => {
      visibilityHandler.handleSoloToggle('qt-test-1', []);

      expect(mockTab.soloedOnTabs).toEqual([]);
      expect(mockTab.soloButton.textContent).toBe('⭕');
    });

    test('should handle empty mutedOnTabs array', () => {
      visibilityHandler.handleMuteToggle('qt-test-1', []);

      expect(mockTab.mutedOnTabs).toEqual([]);
      expect(mockTab.muteButton.textContent).toBe('🔊');
    });

    test('should handle tab without cookieStoreId', async () => {
      delete mockTab.cookieStoreId;

      await visibilityHandler.handleSoloToggle('qt-test-1', [123]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should use default container
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });
  });

  describe('Focus Handling', () => {
    test('should update z-index when handling focus', async () => {
      mockTab.container = document.createElement('div');
      mockCurrentZIndex.value = 10000;

      await visibilityHandler.handleFocus('qt-test-1');

      expect(mockCurrentZIndex.value).toBe(10001);
      expect(mockTab.updateZIndex).toHaveBeenCalledWith(10001);
    });

    test('should emit focus event', async () => {
      mockTab.container = document.createElement('div');
      const focusListener = jest.fn();
      mockEventBus.on('quick-tab:focused', focusListener);

      await visibilityHandler.handleFocus('qt-test-1');

      expect(focusListener).toHaveBeenCalledWith({ id: 'qt-test-1' });
    });

    test('should save z-index to background', async () => {
      mockTab.container = document.createElement('div');
      mockCurrentZIndex.value = 10000;

      await visibilityHandler.handleFocus('qt-test-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_QUICK_TAB_ZINDEX',
          id: 'qt-test-1',
          zIndex: 10001
        })
      );
    });

    test('should handle z-index save error gracefully', async () => {
      mockTab.container = document.createElement('div');
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Save failed'));

      await visibilityHandler.handleFocus('qt-test-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not throw error
      expect(mockCurrentZIndex.value).toBe(10001);
    });
  });
});
