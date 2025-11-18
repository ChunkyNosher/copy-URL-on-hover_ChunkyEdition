/**
 * @fileoverview Unit tests for VisibilityHandler
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { VisibilityHandler } from '@features/quick-tabs/handlers/VisibilityHandler.js';

// Mock browser API
global.browser = {
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve())
  }
};

describe('VisibilityHandler', () => {
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
    // Reset mocks
    jest.clearAllMocks();

    // Create mock tab with buttons
    mockTab = {
      id: 'qt-123',
      cookieStoreId: 'firefox-container-1',
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
      updateZIndex: jest.fn()
    };

    // Create mock Map
    mockQuickTabsMap = new Map([['qt-123', mockTab]]);

    // Create mock broadcast manager
    mockBroadcastManager = {
      notifySolo: jest.fn(),
      notifyMute: jest.fn(),
      notifyMinimize: jest.fn()
    };

    // Create mock storage manager
    mockStorageManager = {
      save: jest.fn(async () => {})
    };

    // Create mock minimized manager
    mockMinimizedManager = {
      add: jest.fn(),
      remove: jest.fn()
    };

    // Create mock event bus
    mockEventBus = new EventEmitter();

    // Create mock z-index ref
    mockCurrentZIndex = { value: 10000 };

    // Create mock utility functions
    mockGenerateSaveId = jest.fn(() => '1234567890-abc123');
    mockTrackPendingSave = jest.fn();
    mockReleasePendingSave = jest.fn();

    // Mock current tab ID
    mockCurrentTabId = 123;

    // Mock Events object
    mockEvents = {
      QUICK_TAB_MINIMIZED: 'quick-tab:minimized',
      QUICK_TAB_FOCUSED: 'quick-tab:focused'
    };

    // Create handler
    visibilityHandler = new VisibilityHandler(
      mockQuickTabsMap,
      mockBroadcastManager,
      mockStorageManager,
      mockMinimizedManager,
      mockEventBus,
      mockCurrentZIndex,
      mockGenerateSaveId,
      mockTrackPendingSave,
      mockReleasePendingSave,
      mockCurrentTabId,
      mockEvents
    );
  });

  describe('Constructor', () => {
    test('should initialize with required dependencies', () => {
      expect(visibilityHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(visibilityHandler.broadcastManager).toBe(mockBroadcastManager);
      expect(visibilityHandler.storageManager).toBe(mockStorageManager);
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

    test('should broadcast solo message', () => {
      visibilityHandler.handleSoloToggle('qt-123', [100, 200]);

      expect(mockBroadcastManager.notifySolo).toHaveBeenCalledWith('qt-123', [100, 200]);
    });

    test('should send message to background with saveId', async () => {
      await visibilityHandler.handleSoloToggle('qt-123', [100]);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'UPDATE_QUICK_TAB_SOLO',
        id: 'qt-123',
        soloedOnTabs: [100],
        cookieStoreId: 'firefox-container-1',
        saveId: '1234567890-abc123',
        timestamp: expect.any(Number)
      });
    });

    test('should use default cookieStoreId if tab has none', async () => {
      mockTab.cookieStoreId = undefined;

      await visibilityHandler.handleSoloToggle('qt-123', [100]);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });

    test('should handle non-existent tab gracefully', async () => {
      await expect(visibilityHandler.handleSoloToggle('qt-999', [100])).resolves.not.toThrow();
    });

    test('should release saveId on background error', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Background error'));

      await visibilityHandler.handleSoloToggle('qt-123', [100]);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId if browser API unavailable', async () => {
      const originalBrowser = global.browser;
      global.browser = undefined;

      await visibilityHandler.handleSoloToggle('qt-123', [100]);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');

      global.browser = originalBrowser;
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

    test('should broadcast mute message', () => {
      visibilityHandler.handleMuteToggle('qt-123', [100, 200]);

      expect(mockBroadcastManager.notifyMute).toHaveBeenCalledWith('qt-123', [100, 200]);
    });

    test('should send message to background with saveId', async () => {
      await visibilityHandler.handleMuteToggle('qt-123', [100]);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'UPDATE_QUICK_TAB_MUTE',
        id: 'qt-123',
        mutedOnTabs: [100],
        cookieStoreId: 'firefox-container-1',
        saveId: '1234567890-abc123',
        timestamp: expect.any(Number)
      });
    });

    test('should use default cookieStoreId if tab has none', async () => {
      mockTab.cookieStoreId = undefined;

      await visibilityHandler.handleMuteToggle('qt-123', [100]);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });

    test('should handle non-existent tab gracefully', async () => {
      await expect(visibilityHandler.handleMuteToggle('qt-999', [100])).resolves.not.toThrow();
    });

    test('should release saveId on background error', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Background error'));

      await visibilityHandler.handleMuteToggle('qt-123', [100]);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId if browser API unavailable', async () => {
      const originalBrowser = global.browser;
      global.browser = undefined;

      await visibilityHandler.handleMuteToggle('qt-123', [100]);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');

      global.browser = originalBrowser;
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

    test('should broadcast minimize message', () => {
      visibilityHandler.handleMinimize('qt-123');

      expect(mockBroadcastManager.notifyMinimize).toHaveBeenCalledWith('qt-123');
    });

    test('should emit minimize event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:minimized', eventSpy);

      visibilityHandler.handleMinimize('qt-123');

      expect(eventSpy).toHaveBeenCalledWith({ id: 'qt-123' });
    });

    test('should send message to background with minimized=true', async () => {
      await visibilityHandler.handleMinimize('qt-123');

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'UPDATE_QUICK_TAB_MINIMIZE',
        id: 'qt-123',
        minimized: true,
        cookieStoreId: 'firefox-container-1',
        saveId: '1234567890-abc123',
        timestamp: expect.any(Number)
      });
    });

    test('should track pending save', async () => {
      await visibilityHandler.handleMinimize('qt-123');

      expect(mockTrackPendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId on background success', async () => {
      await visibilityHandler.handleMinimize('qt-123');

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId on background error', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Background error'));

      await visibilityHandler.handleMinimize('qt-123');

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        visibilityHandler.handleMinimize('qt-999');
      }).not.toThrow();
    });

    test('should use default cookieStoreId if tab has none', async () => {
      mockTab.cookieStoreId = undefined;

      await visibilityHandler.handleMinimize('qt-123');

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
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

  describe('Integration', () => {
    test('should handle complete solo flow', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:solo-toggled', eventSpy);

      await visibilityHandler.handleSoloToggle('qt-123', [100, 200]);

      expect(mockTab.soloedOnTabs).toEqual([100, 200]);
      expect(mockTab.mutedOnTabs).toEqual([]);
      expect(mockBroadcastManager.notifySolo).toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
    });

    test('should handle complete mute flow', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:mute-toggled', eventSpy);

      await visibilityHandler.handleMuteToggle('qt-123', [100, 200]);

      expect(mockTab.mutedOnTabs).toEqual([100, 200]);
      expect(mockTab.soloedOnTabs).toEqual([]);
      expect(mockBroadcastManager.notifyMute).toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
    });

    test('should handle complete minimize flow', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:minimized', eventSpy);

      await visibilityHandler.handleMinimize('qt-123');

      expect(mockMinimizedManager.add).toHaveBeenCalled();
      expect(mockBroadcastManager.notifyMinimize).toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
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
