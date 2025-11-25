/**
 * @fileoverview Unit tests for UpdateHandler
 * v1.6.2 - MIGRATION: Removed BroadcastManager
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { UpdateHandler } from '@features/quick-tabs/handlers/UpdateHandler.js';

// Mock browser API
global.browser = {
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve())
  }
};

describe('UpdateHandler', () => {
  let updateHandler;
  let mockQuickTabsMap;
  let mockStorageManager;
  let mockEventBus;
  let mockTab;
  let mockGenerateSaveId;
  let mockReleasePendingSave;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock tab
    mockTab = {
      id: 'qt-123',
      container: {
        style: {
          left: '100px',
          top: '50px',
          width: '400px',
          height: '300px'
        }
      },
      position: { left: 100, top: 50 },
      size: { width: 400, height: 300 },
      cookieStoreId: 'firefox-container-1'
    };

    // Create mock Map
    mockQuickTabsMap = new Map([['qt-123', mockTab]]);

    // Create mock storage manager
    mockStorageManager = {
      save: jest.fn(async () => {})
    };

    // Create mock event bus
    mockEventBus = new EventEmitter();

    // Create mock utility functions
    mockGenerateSaveId = jest.fn(() => '1234567890-abc123');
    mockReleasePendingSave = jest.fn();

    // Create handler (v1.6.2 - no broadcastManager)
    updateHandler = new UpdateHandler(
      mockQuickTabsMap,
      mockStorageManager,
      mockEventBus,
      mockGenerateSaveId,
      mockReleasePendingSave
    );
  });

  describe('Constructor', () => {
    test('should initialize with required dependencies', () => {
      expect(updateHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(updateHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(updateHandler.storageManager).toBe(mockStorageManager);
      expect(updateHandler.eventBus).toBe(mockEventBus);
    });

    test('should initialize throttle Maps', () => {
      expect(updateHandler.positionChangeThrottle).toBeInstanceOf(Map);
      expect(updateHandler.sizeChangeThrottle).toBeInstanceOf(Map);
    });
  });

  describe('handlePositionChange()', () => {
    test('should update tab position immediately (no save)', () => {
      updateHandler.handlePositionChange('qt-123', 200, 150);

      // No saves during drag (v1.6.2 - no broadcast)
      expect(mockStorageManager.save).not.toHaveBeenCalled();
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        updateHandler.handlePositionChange('qt-999', 200, 150);
      }).not.toThrow();
    });
  });

  describe('handlePositionChangeEnd()', () => {
    test('should send message to background (triggers storage.onChanged in other tabs)', async () => {
      await updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
        id: 'qt-123',
        left: 250,
        top: 175,
        cookieStoreId: 'firefox-container-1',
        saveId: '1234567890-abc123',
        timestamp: expect.any(Number)
      });
    });

    test('should round position values', async () => {
      await updateHandler.handlePositionChangeEnd('qt-123', 250.7, 175.3);

      expect(mockBroadcastManager.notifyPositionUpdate).toHaveBeenCalledWith('qt-123', 251, 175);
    });

    test('should emit tab:position-updated event', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:position-updated', eventSpy);

      await updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(eventSpy).toHaveBeenCalledWith({
        id: 'qt-123',
        left: 250,
        top: 175
      });
    });

    test('should clear position throttle', async () => {
      updateHandler.positionChangeThrottle.set('qt-123', {});

      await updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(updateHandler.positionChangeThrottle.has('qt-123')).toBe(false);
    });

    test('should use default cookieStoreId if tab has none', async () => {
      mockTab.cookieStoreId = undefined;

      await updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });

    test('should handle non-existent tab gracefully', async () => {
      await expect(
        updateHandler.handlePositionChangeEnd('qt-999', 250, 175)
      ).resolves.not.toThrow();
    });

    test('should release saveId on background error', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Background error'));

      await updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId if browser API unavailable', async () => {
      const originalBrowser = global.browser;
      global.browser = undefined;

      await updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');

      global.browser = originalBrowser;
    });
  });

  describe('handleSizeChange()', () => {
    test('should update tab size immediately (no save)', () => {
      updateHandler.handleSizeChange('qt-123', 500, 400);

      // No saves during resize (v1.6.2 - no broadcast)
      expect(mockStorageManager.save).not.toHaveBeenCalled();
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        updateHandler.handleSizeChange('qt-999', 500, 400);
      }).not.toThrow();
    });
  });

  describe('handleSizeChangeEnd()', () => {
    test('should send message to background (triggers storage.onChanged in other tabs)', async () => {
      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      // v1.6.2 - No broadcast, only storage via background
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
    });

    test('should send message to background with saveId', async () => {
      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
        id: 'qt-123',
        width: 500,
        height: 400,
        cookieStoreId: 'firefox-container-1',
        saveId: '1234567890-abc123',
        timestamp: expect.any(Number)
      });
    });

    test('should round size values', async () => {
      await updateHandler.handleSizeChangeEnd('qt-123', 500.7, 400.3);

      // v1.6.2 - No broadcast, verify rounded values in sendMessage
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 501,
          height: 400
        })
      );
    });

    test('should emit tab:size-updated event', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:size-updated', eventSpy);

      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(eventSpy).toHaveBeenCalledWith({
        id: 'qt-123',
        width: 500,
        height: 400
      });
    });

    test('should clear size throttle', async () => {
      updateHandler.sizeChangeThrottle.set('qt-123', {});

      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(updateHandler.sizeChangeThrottle.has('qt-123')).toBe(false);
    });

    test('should use default cookieStoreId if tab has none', async () => {
      mockTab.cookieStoreId = undefined;

      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });

    test('should handle non-existent tab gracefully', async () => {
      await expect(updateHandler.handleSizeChangeEnd('qt-999', 500, 400)).resolves.not.toThrow();
    });

    test('should release saveId on background error', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Background error'));

      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');
    });

    test('should release saveId if browser API unavailable', async () => {
      const originalBrowser = global.browser;
      global.browser = undefined;

      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(mockReleasePendingSave).toHaveBeenCalledWith('1234567890-abc123');

      global.browser = originalBrowser;
    });
  });

  describe('Integration', () => {
    test('should handle complete position update flow', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:position-updated', eventSpy);

      // Drag (no broadcast/save)
      updateHandler.handlePositionChange('qt-123', 200, 150);

      // Drag end (broadcast + save)
      await updateHandler.handlePositionChangeEnd('qt-123', 200, 150);

      expect(mockBroadcastManager.notifyPositionUpdate).toHaveBeenCalledTimes(1);
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

    test('should handle complete size update flow', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:size-updated', eventSpy);

      // Resize (no broadcast/save)
      updateHandler.handleSizeChange('qt-123', 500, 400);

      // Resize end (broadcast + save)
      await updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(mockBroadcastManager.notifySizeUpdate).toHaveBeenCalledTimes(1);
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });
  });
});
