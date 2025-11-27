/**
 * StateManager Unit Tests
 * Phase 2.1: Tests for extracted state management logic
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
      const quickTab = QuickTab.create({
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

      const quickTab = QuickTab.create({
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

  // v1.6.2.2 - getByContainer tests removed (container filtering removed)

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

    test('should NOT clear existing state when hydrating (additive by default, v1.6.2.4)', () => {
      // v1.6.2.4 - Hydration is now additive by default (skipDeletions=true)
      // This prevents "ghost" Quick Tab syndrome (Issues 1 & 5)
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

      // Default hydration is additive - should add qt2 without removing qt1
      manager.hydrate([qt2]);

      expect(manager.count()).toBe(2);
      expect(manager.has('qt-1')).toBe(true); // Still exists (not deleted)
      expect(manager.has('qt-2')).toBe(true); // Also exists (added)
    });

    test('should clear existing state when hydrating with skipDeletions=false', () => {
      // Explicit skipDeletions=false restores old replacive behavior
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

      // Explicit skipDeletions=false enables deletion of missing Quick Tabs
      manager.hydrate([qt2], { skipDeletions: false });

      expect(manager.count()).toBe(1);
      expect(manager.has('qt-1')).toBe(false);
      expect(manager.has('qt-2')).toBe(true);
    });

    test('should emit state:quicktab:changed when position changes with detectChanges: true', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 400,
        height: 300
      });
      manager.add(qt1);

      const listener = jest.fn();
      eventBus.on('state:quicktab:changed', listener);

      // Create updated version with different position
      const qt1Updated = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 200, // Changed
        top: 300,  // Changed
        width: 400,
        height: 300
      });

      manager.hydrate([qt1Updated], { detectChanges: true });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        quickTab: expect.objectContaining({ id: 'qt-1' }),
        changes: { position: true, size: false, zIndex: false }
      });
    });

    test('should emit state:quicktab:changed when size changes with detectChanges: true', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 400,
        height: 300
      });
      manager.add(qt1);

      const listener = jest.fn();
      eventBus.on('state:quicktab:changed', listener);

      // Create updated version with different size
      const qt1Updated = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 500,  // Changed
        height: 400  // Changed
      });

      manager.hydrate([qt1Updated], { detectChanges: true });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        quickTab: expect.objectContaining({ id: 'qt-1' }),
        changes: { position: false, size: true, zIndex: false }
      });
    });

    test('should NOT emit state:quicktab:changed when detectChanges is false', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 400,
        height: 300
      });
      manager.add(qt1);

      const listener = jest.fn();
      eventBus.on('state:quicktab:changed', listener);

      // Create updated version with different position
      const qt1Updated = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 200,
        top: 300,
        width: 400,
        height: 300
      });

      // detectChanges defaults to false
      manager.hydrate([qt1Updated]);

      expect(listener).not.toHaveBeenCalled();
    });

    test('should NOT emit state:quicktab:changed when nothing changes', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 400,
        height: 300
      });
      manager.add(qt1);

      const listener = jest.fn();
      eventBus.on('state:quicktab:changed', listener);

      // Create same Quick Tab (no changes)
      const qt1Same = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 400,
        height: 300
      });

      manager.hydrate([qt1Same], { detectChanges: true });

      expect(listener).not.toHaveBeenCalled();
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

  describe('Edge Cases and Error Handling', () => {
    test('update() should warn when updating non-existent Quick Tab', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const quickTab = QuickTab.create({
        id: 'qt-non-existent',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      // Try to update without adding first
      manager.update(quickTab);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[StateManager] Cannot update non-existent Quick Tab: qt-non-existent'
      );
      expect(manager.has('qt-non-existent')).toBe(false);

      consoleSpy.mockRestore();
    });

    test('hydrate() should throw error for non-array input', () => {
      expect(() => {
        manager.hydrate('not-an-array');
      }).toThrow('StateManager.hydrate() requires array of QuickTab instances');

      expect(() => {
        manager.hydrate(null);
      }).toThrow('StateManager.hydrate() requires array of QuickTab instances');

      expect(() => {
        manager.hydrate({ key: 'value' });
      }).toThrow('StateManager.hydrate() requires array of QuickTab instances');
    });

    test('hydrate() should skip non-QuickTab instances', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const validQuickTab = QuickTab.create({
        id: 'qt-valid',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      const invalidItem = { id: 'invalid', url: 'test' };

      manager.hydrate([validQuickTab, invalidItem, null, undefined]);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[StateManager] Skipping non-QuickTab instance during hydration'
      );
      expect(manager.count()).toBe(1);
      expect(manager.has('qt-valid')).toBe(true);
      expect(manager.has('invalid')).toBe(false);

      consoleSpy.mockRestore();
    });

    test('clear() should work when state is already empty', () => {
      expect(manager.count()).toBe(0);

      const listener = jest.fn();
      eventBus.on('state:cleared', listener);

      manager.clear();

      expect(manager.count()).toBe(0);
      expect(listener).toHaveBeenCalled();
    });

    test('cleanupDeadTabs() should handle empty state', () => {
      expect(manager.count()).toBe(0);

      const listener = jest.fn();
      eventBus.on('state:cleaned', listener);

      manager.cleanupDeadTabs([100, 200]);

      // Event should not be emitted when nothing cleaned
      expect(listener).not.toHaveBeenCalled();
    });

    test('cleanupDeadTabs() should handle tabs with no solo/mute arrays', () => {
      const quickTab = QuickTab.create({
        id: 'qt-no-arrays',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 400, height: 300 }
      });

      manager.add(quickTab);
      manager.cleanupDeadTabs([100, 200]);

      // Should not throw, just complete
      expect(manager.count()).toBe(1);
    });
  });

  describe('Global Slot Assignment (v1.6.3)', () => {
    test('assignGlobalSlot() should return 1 for empty state', () => {
      const slot = manager.assignGlobalSlot();
      expect(slot).toBe(1);
    });

    test('assignGlobalSlot() should return next available slot', () => {
      // Add Quick Tabs with slots 1, 2, 3
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        slot: 1
      });
      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        slot: 2
      });
      const qt3 = QuickTab.create({
        id: 'qt-3',
        url: 'https://another.com',
        slot: 3
      });

      manager.quickTabs.set(qt1.id, qt1);
      manager.quickTabs.set(qt2.id, qt2);
      manager.quickTabs.set(qt3.id, qt3);

      const nextSlot = manager.assignGlobalSlot();
      expect(nextSlot).toBe(4);
    });

    test('assignGlobalSlot() should reuse lowest available slot after deletion', () => {
      // Add Quick Tabs with slots 1, 2, 3
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        slot: 1
      });
      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        slot: 2
      });
      const qt3 = QuickTab.create({
        id: 'qt-3',
        url: 'https://another.com',
        slot: 3
      });

      manager.quickTabs.set(qt1.id, qt1);
      manager.quickTabs.set(qt2.id, qt2);
      manager.quickTabs.set(qt3.id, qt3);

      // Delete Quick Tab with slot 2
      manager.quickTabs.delete(qt2.id);

      // Next slot should be 2 (the gap)
      const nextSlot = manager.assignGlobalSlot();
      expect(nextSlot).toBe(2);
    });

    test('add() should assign slot if not provided', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com'
      });

      expect(quickTab.slot).toBeNull();

      manager.add(quickTab);

      expect(quickTab.slot).toBe(1);
    });

    test('add() should preserve existing slot', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        slot: 5
      });

      manager.add(quickTab);

      expect(quickTab.slot).toBe(5);
    });

    test('addSilent() should assign slot if not provided', () => {
      const quickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com'
      });

      expect(quickTab.slot).toBeNull();

      manager.addSilent(quickTab);

      expect(quickTab.slot).toBe(1);
    });

    test('getBySlot() should find Quick Tab by slot number', () => {
      const qt1 = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        slot: 1
      });
      const qt2 = QuickTab.create({
        id: 'qt-2',
        url: 'https://test.com',
        slot: 2
      });

      manager.quickTabs.set(qt1.id, qt1);
      manager.quickTabs.set(qt2.id, qt2);

      const found = manager.getBySlot(2);
      expect(found).toBe(qt2);
    });

    test('getBySlot() should return undefined for non-existent slot', () => {
      const found = manager.getBySlot(999);
      expect(found).toBeUndefined();
    });

    test('static assignGlobalSlotFromTabs() should work with array', () => {
      const tabs = [
        { id: 'qt-1', slot: 1 },
        { id: 'qt-2', slot: 3 },
        { id: 'qt-3', slot: 5 }
      ];

      const nextSlot = StateManager.assignGlobalSlotFromTabs(tabs);
      // Should be 2 (first gap)
      expect(nextSlot).toBe(2);
    });

    test('static assignGlobalSlotFromTabs() should return 1 for empty array', () => {
      const nextSlot = StateManager.assignGlobalSlotFromTabs([]);
      expect(nextSlot).toBe(1);
    });

    test('static assignGlobalSlotFromTabs() should handle tabs without slots', () => {
      const tabs = [
        { id: 'qt-1', slot: null },
        { id: 'qt-2' }, // No slot property
        { id: 'qt-3', slot: 2 }
      ];

      const nextSlot = StateManager.assignGlobalSlotFromTabs(tabs);
      // Only slot 2 is occupied, so next is 1
      expect(nextSlot).toBe(1);
    });
  });
});
