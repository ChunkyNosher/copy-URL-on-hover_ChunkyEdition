/**
 * @fileoverview Unit tests for DestroyHandler
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { DestroyHandler } from '@features/quick-tabs/handlers/DestroyHandler.js';

// Mock browser API
global.browser = {
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve())
  }
};

describe('DestroyHandler', () => {
  let destroyHandler;
  let mockQuickTabsMap;
  let mockBroadcastManager;
  let mockMinimizedManager;
  let mockEventBus;
  let mockCurrentZIndex;
  let mockTab;
  let mockGenerateSaveId;
  let mockReleasePendingSave;
  let mockEvents;
  let mockBaseZIndex;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock tab
    mockTab = {
      id: 'qt-123',
      url: 'https://example.com',
      cookieStoreId: 'firefox-container-1',
      destroy: jest.fn()
    };

    // Create mock Map
    mockQuickTabsMap = new Map([
      ['qt-123', mockTab],
      ['qt-456', { id: 'qt-456', destroy: jest.fn() }]
    ]);

    // Create mock broadcast manager
    mockBroadcastManager = {
      notifyClose: jest.fn()
    };

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

    // Create mock utility functions
    mockGenerateSaveId = jest.fn(() => '1234567890-abc123');
    mockReleasePendingSave = jest.fn();

    // Mock Events object
    mockEvents = {
      QUICK_TAB_CLOSED: 'quick-tab:closed'
    };

    // Create handler
    destroyHandler = new DestroyHandler(
      mockQuickTabsMap,
      mockBroadcastManager,
      mockMinimizedManager,
      mockEventBus,
      mockCurrentZIndex,
      mockGenerateSaveId,
      mockReleasePendingSave,
      mockEvents,
      mockBaseZIndex
    );
  });

  describe('Constructor', () => {
    test('should initialize with required dependencies', () => {
      expect(destroyHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(destroyHandler.broadcastManager).toBe(mockBroadcastManager);
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

    test('should broadcast close message', () => {
      destroyHandler.handleDestroy('qt-123');

      expect(mockBroadcastManager.notifyClose).toHaveBeenCalledWith('qt-123');
    });

    test('should send message to background', async () => {
      await destroyHandler.handleDestroy('qt-123');

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'CLOSE_QUICK_TAB',
        id: 'qt-123',
        url: 'https://example.com',
        cookieStoreId: 'firefox-container-1',
        saveId: '1234567890-abc123'
      });
    });

    test('should emit destruction event', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:closed', eventSpy);

      await destroyHandler.handleDestroy('qt-123');

      expect(eventSpy).toHaveBeenCalledWith({ id: 'qt-123' });
    });

    test('should reset z-index when all tabs closed', async () => {
      mockQuickTabsMap.clear();
      mockQuickTabsMap.set('qt-123', mockTab);

      await destroyHandler.handleDestroy('qt-123');

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

    test('should use default cookieStoreId if tab has none', async () => {
      mockTab.cookieStoreId = undefined;

      await destroyHandler.handleDestroy('qt-123');

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });

    test('should handle null URL gracefully', async () => {
      mockTab.url = undefined;

      await destroyHandler.handleDestroy('qt-123');

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          url: null
        })
      );
    });

    test('should release saveId on background error', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Background error'));

      await destroyHandler.handleDestroy('qt-123');

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId if browser API unavailable', async () => {
      const originalBrowser = global.browser;
      global.browser = undefined;

      await destroyHandler.handleDestroy('qt-123');

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');

      global.browser = originalBrowser;
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
    test('should handle complete destroy flow', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('quick-tab:closed', eventSpy);

      await destroyHandler.handleDestroy('qt-123');

      expect(mockQuickTabsMap.has('qt-123')).toBe(false);
      expect(mockMinimizedManager.remove).toHaveBeenCalled();
      expect(mockBroadcastManager.notifyClose).toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
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
