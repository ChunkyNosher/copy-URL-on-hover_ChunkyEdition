/**
 * @fileoverview Unit tests for UpdateHandler
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
 * @jest-environment jsdom
 */

import { EventEmitter } from 'eventemitter3';

import { UpdateHandler } from '@features/quick-tabs/handlers/UpdateHandler.js';

describe('UpdateHandler', () => {
  let updateHandler;
  let mockQuickTabsMap;
  let mockEventBus;
  let mockTab;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock tab
    mockTab = {
      id: 'qt-123',
      position: { left: 100, top: 50 },
      size: { width: 400, height: 300 }
    };

    // Create mock Map
    mockQuickTabsMap = new Map([['qt-123', mockTab]]);

    // Create mock event bus
    mockEventBus = new EventEmitter();

    // Create handler
    updateHandler = new UpdateHandler(mockQuickTabsMap, mockEventBus);
  });

  describe('Constructor', () => {
    test('should initialize with required dependencies', () => {
      expect(updateHandler.quickTabsMap).toBe(mockQuickTabsMap);
      expect(updateHandler.eventBus).toBe(mockEventBus);
    });
  });

  describe('handlePositionChange()', () => {
    test('should not throw (no-op during drag)', () => {
      expect(() => {
        updateHandler.handlePositionChange('qt-123', 200, 150);
      }).not.toThrow();
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        updateHandler.handlePositionChange('qt-999', 200, 150);
      }).not.toThrow();
    });
  });

  describe('handlePositionChangeEnd()', () => {
    test('should emit tab:position-updated event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:position-updated', eventSpy);

      updateHandler.handlePositionChangeEnd('qt-123', 250, 175);

      expect(eventSpy).toHaveBeenCalledWith({
        id: 'qt-123',
        left: 250,
        top: 175
      });
    });

    test('should round position values', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:position-updated', eventSpy);

      updateHandler.handlePositionChangeEnd('qt-123', 250.7, 175.3);

      expect(eventSpy).toHaveBeenCalledWith({
        id: 'qt-123',
        left: 251,
        top: 175
      });
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        updateHandler.handlePositionChangeEnd('qt-999', 250, 175);
      }).not.toThrow();
    });
  });

  describe('handleSizeChange()', () => {
    test('should not throw (no-op during resize)', () => {
      expect(() => {
        updateHandler.handleSizeChange('qt-123', 500, 400);
      }).not.toThrow();
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        updateHandler.handleSizeChange('qt-999', 500, 400);
      }).not.toThrow();
    });
  });

  describe('handleSizeChangeEnd()', () => {
    test('should emit tab:size-updated event', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:size-updated', eventSpy);

      updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(eventSpy).toHaveBeenCalledWith({
        id: 'qt-123',
        width: 500,
        height: 400
      });
    });

    test('should round size values', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:size-updated', eventSpy);

      updateHandler.handleSizeChangeEnd('qt-123', 500.7, 400.3);

      expect(eventSpy).toHaveBeenCalledWith({
        id: 'qt-123',
        width: 501,
        height: 400
      });
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => {
        updateHandler.handleSizeChangeEnd('qt-999', 500, 400);
      }).not.toThrow();
    });
  });

  describe('destroy()', () => {
    test('should not throw', () => {
      expect(() => {
        updateHandler.destroy();
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    test('should handle complete position update flow', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:position-updated', eventSpy);

      // Drag (no-op)
      updateHandler.handlePositionChange('qt-123', 200, 150);

      // Drag end (emit event)
      updateHandler.handlePositionChangeEnd('qt-123', 200, 150);

      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

    test('should handle complete size update flow', () => {
      const eventSpy = jest.fn();
      mockEventBus.on('tab:size-updated', eventSpy);

      // Resize (no-op)
      updateHandler.handleSizeChange('qt-123', 500, 400);

      // Resize end (emit event)
      updateHandler.handleSizeChangeEnd('qt-123', 500, 400);

      expect(eventSpy).toHaveBeenCalledTimes(1);
    });
  });
});
