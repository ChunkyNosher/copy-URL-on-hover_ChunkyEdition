/**
 * StateManager Unit Tests
 * Phase 2.1: Tests for extracted state management logic
 */

import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { QuickTab } from '../../../src/domain/QuickTab.js';
import { EventEmitter } from 'eventemitter3';

describe('StateManager', () => {
  let manager;
  let eventBus;

  beforeEach(() => {
    eventBus = new EventEmitter();
    manager = new StateManager(eventBus, 100); // Current tab ID = 100
  });

  describe('Constructor', () => {
    test('should initialize with current tab ID', () => {
      expect(manager.currentTabId).toBe(100);
      expect(manager.eventBus).toBe(eventBus);
    });

    test('should initialize empty state', () => {
      expect(manager.count()).toBe(0);
    });

    test('should initialize z-index', () => {
      expect(manager.currentZIndex).toBe(10000);
    });
  });

  describe('add()', () => {
    test('should add Quick Tab to state', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);

      expect(manager.has('qt-123')).toBe(true);
      expect(manager.count()).toBe(1);
    });

    test('should emit state:added event', () => {
      const listener = jest.fn();
      eventBus.on('state:added', listener);

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);

      expect(listener).toHaveBeenCalledWith(quickTab);
    });

    test('should throw error for non-QuickTab instance', () => {
      expect(() => {
        manager.add({ id: 'qt-123', url: 'test' });
      }).toThrow('StateManager.add() requires QuickTab instance');
    });
  });

  describe('get()', () => {
    test('should get Quick Tab by ID', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);

      const retrieved = manager.get('qt-123');
      expect(retrieved).toBe(quickTab);
    });

    test('should return undefined for non-existent ID', () => {
      expect(manager.get('qt-999')).toBeUndefined();
    });
  });

  describe('has()', () => {
    test('should return true for existing ID', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      expect(manager.has('qt-123')).toBe(true);
    });

    test('should return false for non-existent ID', () => {
      expect(manager.has('qt-999')).toBe(false);
    });
  });

  describe('update()', () => {
    test('should update existing Quick Tab', () => {
      let quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);

      // QuickTab methods return new instance (immutable)
      const updated = new QuickTab({
        ...quickTab,
        position: { left: 200, top: 200 }
      });
      manager.update(updated);

      const retrieved = manager.get('qt-123');
      expect(retrieved.position.left).toBe(200);
      expect(retrieved.position.top).toBe(200);
    });

    test('should emit state:updated event', () => {
      const listener = jest.fn();
      eventBus.on('state:updated', listener);

      let quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      const updated = new QuickTab({
        ...quickTab,
        position: { left: 200, top: 200 }
      });
      manager.update(updated);

      expect(listener).toHaveBeenCalledWith(updated);
    });

    test('should throw error for non-QuickTab instance', () => {
      expect(() => {
        manager.update({ id: 'qt-123', position: { left: 200, top: 200 } });
      }).toThrow('StateManager.update() requires QuickTab instance');
    });
  });

  describe('delete()', () => {
    test('should delete Quick Tab', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      expect(manager.has('qt-123')).toBe(true);

      const deleted = manager.delete('qt-123');
      expect(deleted).toBe(true);
      expect(manager.has('qt-123')).toBe(false);
    });

    test('should emit state:deleted event', () => {
      const listener = jest.fn();
      eventBus.on('state:deleted', listener);

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      manager.delete('qt-123');

      expect(listener).toHaveBeenCalledWith(quickTab);
    });

    test('should return false for non-existent ID', () => {
      const deleted = manager.delete('qt-999');
      expect(deleted).toBe(false);
    });
  });

  describe('getAll()', () => {
    test('should return all Quick Tabs', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });

      manager.add(qt1);
      manager.add(qt2);

      const all = manager.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(qt1);
      expect(all).toContain(qt2);
    });
  });

  describe('getVisible()', () => {
    test('should return all tabs when no current tab ID', () => {
      manager.setCurrentTabId(null);

      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);

      expect(manager.getVisible()).toHaveLength(1);
    });

    test('should filter by solo state', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });
      qt1.solo(100); // Solo on tab 100 (current tab)

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });
      qt2.solo(200); // Solo on different tab

      manager.add(qt1); // Should be visible (soloed on current tab)
      manager.add(qt2); // Should NOT be visible (soloed on different tab)

      const visible = manager.getVisible();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('qt-1');
    });

    test('should filter by mute state', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });
      qt1.mute(100); // Mute on tab 100 (current tab)

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });

      manager.add(qt1); // Should NOT be visible (muted on current tab)
      manager.add(qt2); // Should be visible (not muted)

      const visible = manager.getVisible();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('qt-2');
    });
  });

  describe('getMinimized()', () => {
    test('should return only minimized Quick Tabs', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });
      qt1.setMinimized(true); // Mutates in place

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });

      manager.add(qt1);
      manager.add(qt2);

      const minimized = manager.getMinimized();
      expect(minimized).toHaveLength(1);
      expect(minimized[0].id).toBe('qt-1');
    });
  });

  describe('getByContainer()', () => {
    test('should return Quick Tabs for specific container', () => {
      const qt1 = QuickTab.fromStorage({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 },
        cookieStoreId: 'firefox-default'
      });

      const qt2 = QuickTab.fromStorage({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 },
        cookieStoreId: 'firefox-container-1'
      });

      manager.add(qt1);
      manager.add(qt2);

      const defaultContainer = manager.getByContainer('firefox-default');
      expect(defaultContainer).toHaveLength(1);
      expect(defaultContainer[0].id).toBe('qt-1');

      const container1 = manager.getByContainer('firefox-container-1');
      expect(container1).toHaveLength(1);
      expect(container1[0].id).toBe('qt-2');
    });
  });

  describe('hydrate()', () => {
    test('should hydrate state from QuickTab array', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });

      manager.hydrate([qt1, qt2]);

      expect(manager.count()).toBe(2);
      expect(manager.has('qt-1')).toBe(true);
      expect(manager.has('qt-2')).toBe(true);
    });

    test('should emit state:hydrated event', () => {
      const listener = jest.fn();
      eventBus.on('state:hydrated', listener);

      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.hydrate([qt1]);

      expect(listener).toHaveBeenCalledWith({ count: 1 });
    });

    test('should clear existing state before hydrating', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      expect(manager.count()).toBe(1);

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 500, height: 400 }
      });

      manager.hydrate([qt2]);

      expect(manager.count()).toBe(1);
      expect(manager.has('qt-1')).toBe(false);
      expect(manager.has('qt-2')).toBe(true);
    });
  });

  describe('clear()', () => {
    test('should clear all Quick Tabs', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      expect(manager.count()).toBe(1);

      manager.clear();
      expect(manager.count()).toBe(0);
    });

    test('should emit state:cleared event', () => {
      const listener = jest.fn();
      eventBus.on('state:cleared', listener);

      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      manager.clear();

      expect(listener).toHaveBeenCalledWith({ count: 1 });
    });

    test('should reset z-index', () => {
      manager.currentZIndex = 10005;
      manager.clear();
      expect(manager.currentZIndex).toBe(10000);
    });
  });

  describe('Z-Index Management', () => {
    test('getNextZIndex() should increment z-index', () => {
      const z1 = manager.getNextZIndex();
      const z2 = manager.getNextZIndex();

      expect(z2).toBe(z1 + 1);
    });

    test('updateZIndex() should update Quick Tab z-index', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      manager.updateZIndex('qt-1', 10050);

      const updated = manager.get('qt-1');
      expect(updated.zIndex).toBe(10050);
    });

    test('bringToFront() should assign next z-index', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      manager.bringToFront('qt-1');

      const updated = manager.get('qt-1');
      expect(updated.zIndex).toBe(10001);
    });

    test('bringToFront() should emit z-index-changed event', () => {
      const listener = jest.fn();
      eventBus.on('state:z-index-changed', listener);

      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      manager.bringToFront('qt-1');

      expect(listener).toHaveBeenCalledWith({ id: 'qt-1', zIndex: 10001 });
    });
  });

  describe('cleanupDeadTabs()', () => {
    test('should remove dead tab IDs from solo arrays', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      // Add multiple solo tabs (mutates in place)
      quickTab.solo(100);
      quickTab.solo(200);
      quickTab.solo(300);

      manager.add(quickTab);

      manager.cleanupDeadTabs([100, 200]); // 300 is dead

      const updated = manager.get('qt-1');
      expect(updated.visibility.soloedOnTabs).toEqual([100, 200]);
    });

    test('should remove dead tab IDs from mute arrays', () => {
      const quickTab = QuickTab.create({
        id: 'qt-2', // Different ID
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      // Add multiple mute tabs (mutates in place)
      quickTab.mute(100);
      quickTab.mute(200);
      quickTab.mute(300);

      manager.add(quickTab);

      manager.cleanupDeadTabs([100]); // 200 and 300 are dead

      const updated = manager.get('qt-2');
      expect(updated.visibility.mutedOnTabs).toEqual([100]);
    });

    test('should emit state:cleaned event', () => {
      const listener = jest.fn();
      eventBus.on('state:cleaned', listener);

      const quickTab = QuickTab.create({
        id: 'qt-3', // Different ID
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      quickTab.solo(100);
      quickTab.solo(200);

      manager.add(quickTab);
      manager.cleanupDeadTabs([100]);

      expect(listener).toHaveBeenCalledWith({ count: 1 });
    });
  });
});
