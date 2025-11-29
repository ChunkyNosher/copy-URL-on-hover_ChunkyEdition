/**
 * StateManager Unit Tests
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
 */

import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';

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

      expect(listener).toHaveBeenCalledWith({ quickTab });
    });

    test('should throw error for non-QuickTab instance', () => {
      expect(() => {
        manager.add({ id: 'qt-123', url: 'test' });
      }).toThrow('StateManager.add() requires QuickTab instance');
    });

    test('should assign slot if not provided', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      // Slot should be null initially
      expect(quickTab.slot).toBeNull();

      manager.add(quickTab);

      // Slot should be assigned
      expect(quickTab.slot).toBe(1);
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
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);

      quickTab.updatePosition(200, 200);
      manager.update(quickTab);

      const retrieved = manager.get('qt-123');
      expect(retrieved.position.left).toBe(200);
      expect(retrieved.position.top).toBe(200);
    });

    test('should emit state:updated event', () => {
      const listener = jest.fn();
      eventBus.on('state:updated', listener);

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      manager.update(quickTab);

      expect(listener).toHaveBeenCalledWith({ quickTab });
    });

    test('should throw error for non-QuickTab instance', () => {
      expect(() => {
        manager.update({ id: 'qt-123', url: 'test' });
      }).toThrow('StateManager.update() requires QuickTab instance');
    });

    test('should not update non-existent Quick Tab', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      manager.update(quickTab);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('delete()', () => {
    test('should delete Quick Tab from state', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      expect(manager.has('qt-123')).toBe(true);

      const result = manager.delete('qt-123');

      expect(result).toBe(true);
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

      expect(listener).toHaveBeenCalledWith({ id: 'qt-123', quickTab });
    });

    test('should return false for non-existent ID', () => {
      const result = manager.delete('qt-999');
      expect(result).toBe(false);
    });
  });

  describe('getAll()', () => {
    test('should return all Quick Tabs', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      manager.add(qt2);

      const all = manager.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(qt1);
      expect(all).toContain(qt2);
    });

    test('should return empty array when no Quick Tabs', () => {
      expect(manager.getAll()).toEqual([]);
    });
  });

  describe('getVisible()', () => {
    test('should return all Quick Tabs when no filtering', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);

      const visible = manager.getVisible();
      expect(visible).toHaveLength(1);
      expect(visible).toContain(qt1);
    });

    test('should filter out muted Quick Tabs', () => {
      const qt1 = new QuickTab({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 },
        visibility: {
          minimized: false,
          soloedOnTabs: [],
          mutedOnTabs: [100] // Muted on current tab
        },
        zIndex: 1000,
        createdAt: Date.now()
      });

      manager.add(qt1);

      const visible = manager.getVisible();
      expect(visible).toHaveLength(0);
    });

    test('should show solo Quick Tabs on their tabs', () => {
      const qt1 = new QuickTab({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 },
        visibility: {
          minimized: false,
          soloedOnTabs: [100], // Solo on current tab
          mutedOnTabs: []
        },
        zIndex: 1000,
        createdAt: Date.now()
      });

      manager.add(qt1);

      const visible = manager.getVisible();
      expect(visible).toHaveLength(1);
    });
  });

  describe('clear()', () => {
    test('should clear all Quick Tabs', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
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
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      manager.clear();

      expect(listener).toHaveBeenCalledWith({ count: 1 });
    });

    test('should reset z-index', () => {
      manager.currentZIndex = 10050;
      manager.clear();
      expect(manager.currentZIndex).toBe(10000);
    });
  });

  describe('Global Slot Assignment', () => {
    test('should assign sequential slots', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      manager.add(qt2);

      expect(qt1.slot).toBe(1);
      expect(qt2.slot).toBe(2);
    });

    test('should fill gaps in slots', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      manager.add(qt2);

      // Delete first one
      manager.delete('qt-1');

      // Add new one - should get slot 1
      const qt3 = QuickTab.create({
        id: 'qt-3',
        url: 'https://example3.com',
        position: { left: 300, top: 300 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt3);
      expect(qt3.slot).toBe(1);
    });

    test('getBySlot() should return Quick Tab by slot', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);

      const found = manager.getBySlot(1);
      expect(found).toBe(qt1);
    });

    test('getBySlot() should return undefined for non-existent slot', () => {
      expect(manager.getBySlot(99)).toBeUndefined();
    });
  });

  describe('Z-Index Management', () => {
    test('getNextZIndex() should increment z-index', () => {
      const z1 = manager.getNextZIndex();
      const z2 = manager.getNextZIndex();

      expect(z2).toBe(z1 + 1);
    });

    test('bringToFront() should update z-index and emit event', () => {
      const listener = jest.fn();
      eventBus.on('state:z-index-changed', listener);

      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      manager.bringToFront('qt-1');

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('setCurrentTabId()', () => {
    test('should update current tab ID', () => {
      manager.setCurrentTabId(200);
      expect(manager.currentTabId).toBe(200);
    });
  });

  describe('count()', () => {
    test('should return correct count', () => {
      expect(manager.count()).toBe(0);

      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(qt1);
      expect(manager.count()).toBe(1);
    });
  });
});
