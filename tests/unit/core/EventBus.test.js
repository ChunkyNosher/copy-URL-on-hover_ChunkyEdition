/**
 * EventBus Singleton Unit Tests
 * v1.6.3.11-v10 - FIX Issue #12: Instance tracking and singleton behavior
 *
 * Tests for:
 * - Singleton behavior: getSharedEventBus() returns same instance
 * - Instance ID uniqueness
 * - isSameInstance validation method
 * - Event emission works correctly with singleton
 */

import { EventBus, getSharedEventBus, Events } from '../../../src/core/events.js';

describe('EventBus', () => {
  let eventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    jest.clearAllMocks();
  });

  describe('Instance Creation', () => {
    test('new EventBus creates unique instance', () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();

      expect(bus1).not.toBe(bus2);
    });

    test('each instance has unique instanceId', () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();
      const bus3 = new EventBus();

      expect(bus1.instanceId).not.toBe(bus2.instanceId);
      expect(bus2.instanceId).not.toBe(bus3.instanceId);
      expect(bus1.instanceId).not.toBe(bus3.instanceId);
    });

    test('instanceId follows correct format', () => {
      const bus = new EventBus();

      // Format: eventbus-{counter}-{timestamp}
      expect(bus.instanceId).toMatch(/^eventbus-\d+-\d+$/);
    });

    test('getInstanceId returns the instanceId', () => {
      const bus = new EventBus();

      expect(bus.getInstanceId()).toBe(bus.instanceId);
    });
  });

  describe('Singleton Behavior - getSharedEventBus()', () => {
    test('getSharedEventBus returns same instance on multiple calls', () => {
      const shared1 = getSharedEventBus();
      const shared2 = getSharedEventBus();
      const shared3 = getSharedEventBus();

      expect(shared1).toBe(shared2);
      expect(shared2).toBe(shared3);
    });

    test('shared instance is an EventBus', () => {
      const shared = getSharedEventBus();

      expect(shared).toBeInstanceOf(EventBus);
    });

    test('shared instance has valid instanceId', () => {
      const shared = getSharedEventBus();

      expect(shared.instanceId).toBeTruthy();
      expect(shared.instanceId).toMatch(/^eventbus-\d+-\d+$/);
    });

    test('shared instance preserves state across calls', () => {
      const shared1 = getSharedEventBus();
      const callback = jest.fn();
      shared1.on('testEvent', callback);

      const shared2 = getSharedEventBus();
      shared2.emit('testEvent', { data: 'test' });

      expect(callback).toHaveBeenCalledWith({ data: 'test' });
    });
  });

  describe('Instance ID Uniqueness', () => {
    test('multiple rapid creations have unique IDs', () => {
      const instances = [];
      const ids = new Set();

      for (let i = 0; i < 100; i++) {
        const bus = new EventBus();
        instances.push(bus);
        ids.add(bus.instanceId);
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);
    });

    test('instanceId contains counter and timestamp', () => {
      const bus = new EventBus();
      const parts = bus.instanceId.split('-');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('eventbus');
      expect(parseInt(parts[1])).toBeGreaterThan(0);
      expect(parseInt(parts[2])).toBeGreaterThan(0);
    });
  });

  describe('isSameInstance Validation', () => {
    test('isSameInstance returns true for same instance', () => {
      const bus = new EventBus();

      expect(bus.isSameInstance(bus)).toBe(true);
    });

    test('isSameInstance returns false for different instances', () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();

      expect(bus1.isSameInstance(bus2)).toBe(false);
      expect(bus2.isSameInstance(bus1)).toBe(false);
    });

    test('isSameInstance returns false for null', () => {
      const bus = new EventBus();

      expect(bus.isSameInstance(null)).toBe(false);
    });

    test('isSameInstance returns false for undefined', () => {
      const bus = new EventBus();

      expect(bus.isSameInstance(undefined)).toBe(false);
    });

    test('isSameInstance returns false for non-EventBus objects', () => {
      const bus = new EventBus();

      expect(bus.isSameInstance({})).toBe(false);
      expect(bus.isSameInstance({ instanceId: 'fake' })).toBe(false);
      expect(bus.isSameInstance('string')).toBe(false);
      expect(bus.isSameInstance(123)).toBe(false);
    });

    test('isSameInstance works with shared singleton', () => {
      const shared1 = getSharedEventBus();
      const shared2 = getSharedEventBus();

      expect(shared1.isSameInstance(shared2)).toBe(true);
    });

    test('isSameInstance detects mismatch between shared and new instance', () => {
      const shared = getSharedEventBus();
      const newBus = new EventBus();

      expect(shared.isSameInstance(newBus)).toBe(false);
      expect(newBus.isSameInstance(shared)).toBe(false);
    });

    test('isSameInstance logs error for mismatched instances', () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();

      bus1.isSameInstance(bus2);

      expect(console.error).toHaveBeenCalledWith(
        '[EVENTBUS_MISMATCH] Different instances detected!',
        expect.objectContaining({
          thisInstance: bus1.instanceId,
          otherInstance: bus2.instanceId
        })
      );
    });
  });

  describe('Event Emission with Singleton', () => {
    test('events emitted on singleton reach all subscribers', () => {
      const shared = getSharedEventBus();
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      shared.on('testEvent', callback1);
      shared.on('testEvent', callback2);
      shared.on('testEvent', callback3);

      shared.emit('testEvent', { value: 42 });

      expect(callback1).toHaveBeenCalledWith({ value: 42 });
      expect(callback2).toHaveBeenCalledWith({ value: 42 });
      expect(callback3).toHaveBeenCalledWith({ value: 42 });
    });

    test('on() returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = eventBus.on('testEvent', callback);

      eventBus.emit('testEvent', 'first');
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      eventBus.emit('testEvent', 'second');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('off() removes specific listener', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      eventBus.on('testEvent', callback1);
      eventBus.on('testEvent', callback2);

      eventBus.off('testEvent', callback1);
      eventBus.emit('testEvent', 'data');

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('data');
    });

    test('once() fires only once', () => {
      const callback = jest.fn();

      eventBus.once('testEvent', callback);

      eventBus.emit('testEvent', 'first');
      eventBus.emit('testEvent', 'second');
      eventBus.emit('testEvent', 'third');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('first');
    });

    test('emit() does nothing for unregistered events', () => {
      expect(() => {
        eventBus.emit('nonExistentEvent', 'data');
      }).not.toThrow();
    });

    test('handler errors do not stop other handlers', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Handler error');
      });
      const normalCallback = jest.fn();

      eventBus.on('testEvent', errorCallback);
      eventBus.on('testEvent', normalCallback);

      eventBus.emit('testEvent', 'data');

      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalledWith('data');
    });
  });

  describe('Event Management', () => {
    test('clear() removes all listeners', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      eventBus.on('event1', callback1);
      eventBus.on('event2', callback2);

      eventBus.clear();

      eventBus.emit('event1', 'data');
      eventBus.emit('event2', 'data');

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    test('removeAllListeners() clears all listeners', () => {
      const callback = jest.fn();

      eventBus.on('event1', callback);
      eventBus.on('event2', callback);

      eventBus.removeAllListeners();

      expect(eventBus.getEventNames()).toHaveLength(0);
    });

    test('getEventNames() returns registered event names', () => {
      eventBus.on('event1', jest.fn());
      eventBus.on('event2', jest.fn());
      eventBus.on('event3', jest.fn());

      const names = eventBus.getEventNames();

      expect(names).toContain('event1');
      expect(names).toContain('event2');
      expect(names).toContain('event3');
      expect(names).toHaveLength(3);
    });

    test('listenerCount() returns correct count', () => {
      eventBus.on('testEvent', jest.fn());
      eventBus.on('testEvent', jest.fn());
      eventBus.on('testEvent', jest.fn());

      expect(eventBus.listenerCount('testEvent')).toBe(3);
      expect(eventBus.listenerCount('nonExistent')).toBe(0);
    });

    test('removing last listener cleans up event', () => {
      const callback = jest.fn();
      eventBus.on('testEvent', callback);

      expect(eventBus.getEventNames()).toContain('testEvent');

      eventBus.off('testEvent', callback);

      expect(eventBus.getEventNames()).not.toContain('testEvent');
    });
  });

  describe('Debug Mode', () => {
    test('enableDebug() enables debug logging', () => {
      eventBus.enableDebug();

      expect(eventBus.debugMode).toBe(true);
    });

    test('disableDebug() disables debug logging', () => {
      eventBus.enableDebug();
      eventBus.disableDebug();

      expect(eventBus.debugMode).toBe(false);
    });
  });

  describe('Predefined Events', () => {
    test('Events object contains Quick Tab events', () => {
      expect(Events.QUICK_TAB_CREATED).toBe('quickTab:created');
      expect(Events.QUICK_TAB_CLOSED).toBe('quickTab:closed');
      expect(Events.QUICK_TAB_MINIMIZED).toBe('quickTab:minimized');
      expect(Events.QUICK_TAB_RESTORED).toBe('quickTab:restored');
    });

    test('Events object contains Panel events', () => {
      expect(Events.PANEL_TOGGLED).toBe('panel:toggled');
      expect(Events.PANEL_OPENED).toBe('panel:opened');
      expect(Events.PANEL_CLOSED).toBe('panel:closed');
    });

    test('Events object contains Storage events', () => {
      expect(Events.STORAGE_UPDATED).toBe('storage:updated');
      expect(Events.STORAGE_SYNCED).toBe('storage:synced');
    });

    test('can subscribe to predefined events', () => {
      const callback = jest.fn();

      eventBus.on(Events.QUICK_TAB_CREATED, callback);
      eventBus.emit(Events.QUICK_TAB_CREATED, { id: 'qt-123' });

      expect(callback).toHaveBeenCalledWith({ id: 'qt-123' });
    });
  });

  describe('Edge Cases', () => {
    test('handles high volume of events', () => {
      const callback = jest.fn();
      eventBus.on('highVolume', callback);

      for (let i = 0; i < 1000; i++) {
        eventBus.emit('highVolume', { index: i });
      }

      expect(callback).toHaveBeenCalledTimes(1000);
    });

    test('handles many listeners on single event', () => {
      const callbacks = [];

      for (let i = 0; i < 100; i++) {
        const cb = jest.fn();
        callbacks.push(cb);
        eventBus.on('manyListeners', cb);
      }

      eventBus.emit('manyListeners', 'data');

      callbacks.forEach(cb => {
        expect(cb).toHaveBeenCalledWith('data');
      });
    });

    test('handles emit with undefined data', () => {
      const callback = jest.fn();
      eventBus.on('testEvent', callback);

      eventBus.emit('testEvent', undefined);

      expect(callback).toHaveBeenCalledWith(undefined);
    });

    test('handles emit with null data', () => {
      const callback = jest.fn();
      eventBus.on('testEvent', callback);

      eventBus.emit('testEvent', null);

      expect(callback).toHaveBeenCalledWith(null);
    });

    test('multiple subscriptions with same callback', () => {
      const callback = jest.fn();

      eventBus.on('testEvent', callback);
      eventBus.on('testEvent', callback);

      eventBus.emit('testEvent', 'data');

      // Same callback registered twice should be called twice
      expect(callback).toHaveBeenCalledTimes(2);
    });

    test('off() on non-existent event is safe', () => {
      expect(() => {
        eventBus.off('nonExistent', jest.fn());
      }).not.toThrow();
    });

    test('off() with non-existent callback is safe', () => {
      eventBus.on('testEvent', jest.fn());

      expect(() => {
        eventBus.off('testEvent', jest.fn());
      }).not.toThrow();
    });
  });
});
