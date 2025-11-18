/**
 * EventManager Unit Tests
 */

import { EventManager } from '../../../src/features/quick-tabs/managers/EventManager.js';
import { EventEmitter } from 'eventemitter3';

describe('EventManager', () => {
  let eventManager;
  let eventBus;
  let quickTabsMap;

  beforeEach(() => {
    eventBus = new EventEmitter();
    quickTabsMap = new Map();
    eventManager = new EventManager(eventBus, quickTabsMap);

    // Clear existing listeners
    document.removeAllListeners?.();
    window.removeAllListeners?.();
  });

  afterEach(() => {
    eventManager.teardown();
  });

  describe('Constructor', () => {
    test('should initialize with eventBus and quickTabsMap', () => {
      expect(eventManager.eventBus).toBe(eventBus);
      expect(eventManager.quickTabsMap).toBe(quickTabsMap);
    });

    test('should initialize boundHandlers object', () => {
      expect(eventManager.boundHandlers).toEqual({
        visibilityChange: null,
        beforeUnload: null,
        pageHide: null
      });
    });
  });

  describe('setupEmergencySaveHandlers()', () => {
    test('should attach visibilitychange listener', () => {
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

      eventManager.setupEmergencySaveHandlers();

      expect(addEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });

    test('should attach beforeunload listener', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      eventManager.setupEmergencySaveHandlers();

      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });

    test('should attach pagehide listener', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      eventManager.setupEmergencySaveHandlers();

      expect(addEventListenerSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });

    test('should store bound handlers for cleanup', () => {
      eventManager.setupEmergencySaveHandlers();

      expect(eventManager.boundHandlers.visibilityChange).toBeInstanceOf(Function);
      expect(eventManager.boundHandlers.beforeUnload).toBeInstanceOf(Function);
      expect(eventManager.boundHandlers.pageHide).toBeInstanceOf(Function);
    });
  });

  describe('visibilitychange handler', () => {
    test('should emit emergency-save when document becomes hidden and tabs exist', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      quickTabsMap.set('qt-1', {});

      eventManager.setupEmergencySaveHandlers();

      // Simulate document becoming hidden
      Object.defineProperty(document, 'hidden', {
        writable: true,
        value: true
      });

      // Trigger visibilitychange
      eventManager.boundHandlers.visibilityChange();

      expect(emitSpy).toHaveBeenCalledWith('event:emergency-save', {
        trigger: 'visibilitychange'
      });

      emitSpy.mockRestore();
    });

    test('should not emit when document is visible', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      quickTabsMap.set('qt-1', {});

      eventManager.setupEmergencySaveHandlers();

      // Simulate document being visible
      Object.defineProperty(document, 'hidden', {
        writable: true,
        value: false
      });

      // Trigger visibilitychange
      eventManager.boundHandlers.visibilityChange();

      expect(emitSpy).not.toHaveBeenCalled();

      emitSpy.mockRestore();
    });

    test('should not emit when no tabs exist', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');

      eventManager.setupEmergencySaveHandlers();

      // Simulate document becoming hidden
      Object.defineProperty(document, 'hidden', {
        writable: true,
        value: true
      });

      // Trigger visibilitychange
      eventManager.boundHandlers.visibilityChange();

      expect(emitSpy).not.toHaveBeenCalled();

      emitSpy.mockRestore();
    });
  });

  describe('beforeunload handler', () => {
    test('should emit emergency-save when tabs exist', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      quickTabsMap.set('qt-1', {});

      eventManager.setupEmergencySaveHandlers();

      // Trigger beforeunload
      eventManager.boundHandlers.beforeUnload();

      expect(emitSpy).toHaveBeenCalledWith('event:emergency-save', {
        trigger: 'beforeunload'
      });

      emitSpy.mockRestore();
    });

    test('should not emit when no tabs exist', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');

      eventManager.setupEmergencySaveHandlers();

      // Trigger beforeunload
      eventManager.boundHandlers.beforeUnload();

      expect(emitSpy).not.toHaveBeenCalled();

      emitSpy.mockRestore();
    });
  });

  describe('pagehide handler', () => {
    test('should emit emergency-save when tabs exist', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      quickTabsMap.set('qt-1', {});

      eventManager.setupEmergencySaveHandlers();

      // Trigger pagehide
      eventManager.boundHandlers.pageHide();

      expect(emitSpy).toHaveBeenCalledWith('event:emergency-save', {
        trigger: 'pagehide'
      });

      emitSpy.mockRestore();
    });

    test('should not emit when no tabs exist', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');

      eventManager.setupEmergencySaveHandlers();

      // Trigger pagehide
      eventManager.boundHandlers.pageHide();

      expect(emitSpy).not.toHaveBeenCalled();

      emitSpy.mockRestore();
    });
  });

  describe('teardown()', () => {
    test('should remove all event listeners', () => {
      const removeEventListenerSpyDoc = jest.spyOn(document, 'removeEventListener');
      const removeEventListenerSpyWin = jest.spyOn(window, 'removeEventListener');

      eventManager.setupEmergencySaveHandlers();
      eventManager.teardown();

      expect(removeEventListenerSpyDoc).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );

      expect(removeEventListenerSpyWin).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      expect(removeEventListenerSpyWin).toHaveBeenCalledWith('pagehide', expect.any(Function));

      removeEventListenerSpyDoc.mockRestore();
      removeEventListenerSpyWin.mockRestore();
    });

    test('should handle teardown when handlers not set', () => {
      // Should not throw
      expect(() => eventManager.teardown()).not.toThrow();
    });

    test('should handle teardown multiple times', () => {
      eventManager.setupEmergencySaveHandlers();
      eventManager.teardown();

      // Should not throw
      expect(() => eventManager.teardown()).not.toThrow();
    });
  });

  describe('Integration', () => {
    test('should properly cleanup after setup', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');

      eventManager.setupEmergencySaveHandlers();
      eventManager.teardown();

      // Manually call handlers after teardown - should be removed
      // so this won't cause events
      quickTabsMap.set('qt-1', {});

      Object.defineProperty(document, 'hidden', {
        writable: true,
        value: true
      });

      // Handlers should be cleaned up, so no events should fire
      expect(emitSpy).not.toHaveBeenCalled();

      emitSpy.mockRestore();
    });
  });
});
