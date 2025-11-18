/**
 * QuickTab Domain Entity Tests
 * v1.6.0 - Unit tests for pure business logic
 *
 * Target: 100% coverage (branches, functions, lines, statements)
 */

import { QuickTab } from '../../../src/domain/QuickTab.js';

describe('QuickTab Domain Entity', () => {
  describe('Construction', () => {
    test('should create QuickTab with valid parameters', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: false,
          soloedOnTabs: [],
          mutedOnTabs: []
        },
        container: 'firefox-container-1'
      });

      expect(quickTab.id).toBe('qt-123');
      expect(quickTab.url).toBe('https://example.com');
      expect(quickTab.position).toEqual({ left: 100, top: 200 });
      expect(quickTab.size).toEqual({ width: 800, height: 600 });
      expect(quickTab.container).toBe('firefox-container-1');
      expect(quickTab.visibility.minimized).toBe(false);
    });

    test('should use defaults for optional parameters', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });

      expect(quickTab.title).toBe('Quick Tab');
      expect(quickTab.zIndex).toBe(1000);
      expect(quickTab.container).toBe('firefox-default');
      expect(quickTab.createdAt).toBeGreaterThan(0);
    });

    test('should throw error if id is missing', () => {
      expect(() => {
        new QuickTab({
          url: 'https://example.com',
          position: { left: 100, top: 200 },
          size: { width: 800, height: 600 },
          visibility: {}
        });
      }).toThrow('QuickTab requires a valid string id');
    });

    test('should throw error if url is missing', () => {
      expect(() => {
        new QuickTab({
          id: 'qt-123',
          position: { left: 100, top: 200 },
          size: { width: 800, height: 600 },
          visibility: {}
        });
      }).toThrow('QuickTab requires a valid string url');
    });

    test('should throw error if position is invalid', () => {
      expect(() => {
        new QuickTab({
          id: 'qt-123',
          url: 'https://example.com',
          position: { left: 100 }, // Missing 'top'
          size: { width: 800, height: 600 },
          visibility: {}
        });
      }).toThrow('QuickTab requires valid position {left, top}');
    });

    test('should throw error if size is invalid', () => {
      expect(() => {
        new QuickTab({
          id: 'qt-123',
          url: 'https://example.com',
          position: { left: 100, top: 200 },
          size: { width: 800 }, // Missing 'height'
          visibility: {}
        });
      }).toThrow('QuickTab requires valid size {width, height}');
    });
  });

  describe('Visibility Logic (shouldBeVisible)', () => {
    test('should be visible by default', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });

      expect(quickTab.shouldBeVisible(123)).toBe(true);
      expect(quickTab.shouldBeVisible(456)).toBe(true);
    });

    test('should not be visible when minimized', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: { minimized: true }
      });

      expect(quickTab.shouldBeVisible(123)).toBe(false);
    });

    test('should only be visible on soloed tabs', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: { soloedOnTabs: [100, 200] }
      });

      expect(quickTab.shouldBeVisible(100)).toBe(true);
      expect(quickTab.shouldBeVisible(200)).toBe(true);
      expect(quickTab.shouldBeVisible(300)).toBe(false);
    });

    test('should not be visible on muted tabs', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: { mutedOnTabs: [100, 200] }
      });

      expect(quickTab.shouldBeVisible(100)).toBe(false);
      expect(quickTab.shouldBeVisible(200)).toBe(false);
      expect(quickTab.shouldBeVisible(300)).toBe(true);
    });

    test('solo takes precedence over mute (should not happen but tested for robustness)', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          soloedOnTabs: [100],
          mutedOnTabs: [200]
        }
      });

      expect(quickTab.shouldBeVisible(100)).toBe(true);
      expect(quickTab.shouldBeVisible(200)).toBe(false);
      expect(quickTab.shouldBeVisible(300)).toBe(false);
    });

    test('minimized always hides regardless of solo/mute', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: true,
          soloedOnTabs: [100]
        }
      });

      expect(quickTab.shouldBeVisible(100)).toBe(false);
    });
  });

  describe('Solo Operations', () => {
    let quickTab;

    beforeEach(() => {
      quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });
    });

    test('toggleSolo should add tab to solo list', () => {
      const result = quickTab.toggleSolo(100);

      expect(result).toBe(true);
      expect(quickTab.visibility.soloedOnTabs).toContain(100);
    });

    test('toggleSolo should remove tab from solo list if already present', () => {
      quickTab.solo(100);
      const result = quickTab.toggleSolo(100);

      expect(result).toBe(false);
      expect(quickTab.visibility.soloedOnTabs).not.toContain(100);
    });

    test('toggleSolo should clear mute list when adding solo', () => {
      quickTab.mute(200);
      quickTab.toggleSolo(100);

      expect(quickTab.visibility.mutedOnTabs).toEqual([]);
    });

    test('solo should add tab without duplicates', () => {
      quickTab.solo(100);
      quickTab.solo(100);

      expect(quickTab.visibility.soloedOnTabs).toEqual([100]);
    });

    test('unsolo should remove specific tab', () => {
      quickTab.solo(100);
      quickTab.solo(200);
      quickTab.unsolo(100);

      expect(quickTab.visibility.soloedOnTabs).toEqual([200]);
    });

    test('clearSolo should remove all solo tabs', () => {
      quickTab.solo(100);
      quickTab.solo(200);
      quickTab.clearSolo();

      expect(quickTab.visibility.soloedOnTabs).toEqual([]);
    });
  });

  describe('Mute Operations', () => {
    let quickTab;

    beforeEach(() => {
      quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });
    });

    test('toggleMute should add tab to mute list', () => {
      const result = quickTab.toggleMute(100);

      expect(result).toBe(true);
      expect(quickTab.visibility.mutedOnTabs).toContain(100);
    });

    test('toggleMute should remove tab from mute list if already present', () => {
      quickTab.mute(100);
      const result = quickTab.toggleMute(100);

      expect(result).toBe(false);
      expect(quickTab.visibility.mutedOnTabs).not.toContain(100);
    });

    test('toggleMute should clear solo list when adding mute', () => {
      quickTab.solo(200);
      quickTab.toggleMute(100);

      expect(quickTab.visibility.soloedOnTabs).toEqual([]);
    });

    test('mute should add tab without duplicates', () => {
      quickTab.mute(100);
      quickTab.mute(100);

      expect(quickTab.visibility.mutedOnTabs).toEqual([100]);
    });

    test('unmute should remove specific tab', () => {
      quickTab.mute(100);
      quickTab.mute(200);
      quickTab.unmute(100);

      expect(quickTab.visibility.mutedOnTabs).toEqual([200]);
    });

    test('clearMute should remove all muted tabs', () => {
      quickTab.mute(100);
      quickTab.mute(200);
      quickTab.clearMute();

      expect(quickTab.visibility.mutedOnTabs).toEqual([]);
    });
  });

  describe('Minimized Operations', () => {
    let quickTab;

    beforeEach(() => {
      quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });
    });

    test('toggleMinimized should toggle state', () => {
      expect(quickTab.toggleMinimized()).toBe(true);
      expect(quickTab.visibility.minimized).toBe(true);
      expect(quickTab.toggleMinimized()).toBe(false);
      expect(quickTab.visibility.minimized).toBe(false);
    });

    test('setMinimized should set state directly', () => {
      quickTab.setMinimized(true);
      expect(quickTab.visibility.minimized).toBe(true);

      quickTab.setMinimized(false);
      expect(quickTab.visibility.minimized).toBe(false);
    });
  });

  describe('Position and Size Updates', () => {
    let quickTab;

    beforeEach(() => {
      quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });
    });

    test('updatePosition should update position', () => {
      quickTab.updatePosition(150, 250);

      expect(quickTab.position).toEqual({ left: 150, top: 250 });
    });

    test('updatePosition should throw error for non-numeric values', () => {
      expect(() => quickTab.updatePosition('100', 200)).toThrow(
        'Position must be numeric {left, top}'
      );
    });

    test('updateSize should update size', () => {
      quickTab.updateSize(900, 700);

      expect(quickTab.size).toEqual({ width: 900, height: 700 });
    });

    test('updateSize should throw error for non-numeric values', () => {
      expect(() => quickTab.updateSize('800', 600)).toThrow(
        'Size must be numeric {width, height}'
      );
    });

    test('updateSize should throw error for non-positive values', () => {
      expect(() => quickTab.updateSize(0, 600)).toThrow('Size must be positive');
      expect(() => quickTab.updateSize(800, -1)).toThrow('Size must be positive');
    });
  });

  describe('Other Updates', () => {
    let quickTab;

    beforeEach(() => {
      quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {}
      });
    });

    test('updateZIndex should update z-index', () => {
      quickTab.updateZIndex(2000);
      expect(quickTab.zIndex).toBe(2000);
    });

    test('updateZIndex should throw error for non-numeric value', () => {
      expect(() => quickTab.updateZIndex('2000')).toThrow('zIndex must be a number');
    });

    test('updateTitle should update title', () => {
      quickTab.updateTitle('New Title');
      expect(quickTab.title).toBe('New Title');
    });

    test('updateTitle should throw error for non-string value', () => {
      expect(() => quickTab.updateTitle(123)).toThrow('Title must be a string');
    });
  });

  describe('Dead Tab Cleanup', () => {
    test('should remove closed tabs from solo list', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          soloedOnTabs: [100, 200, 300]
        }
      });

      quickTab.cleanupDeadTabs([100, 300]); // 200 is closed

      expect(quickTab.visibility.soloedOnTabs).toEqual([100, 300]);
    });

    test('should remove closed tabs from mute list', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          mutedOnTabs: [100, 200, 300]
        }
      });

      quickTab.cleanupDeadTabs([100, 300]); // 200 is closed

      expect(quickTab.visibility.mutedOnTabs).toEqual([100, 300]);
    });

    test('should handle empty active tabs list', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          soloedOnTabs: [100, 200],
          mutedOnTabs: [300, 400]
        }
      });

      quickTab.cleanupDeadTabs([]);

      expect(quickTab.visibility.soloedOnTabs).toEqual([]);
      expect(quickTab.visibility.mutedOnTabs).toEqual([]);
    });
  });

  describe('Container Operations', () => {
    test('belongsToContainer should return true for matching container', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {},
        container: 'firefox-container-1'
      });

      expect(quickTab.belongsToContainer('firefox-container-1')).toBe(true);
    });

    test('belongsToContainer should return false for non-matching container', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {},
        container: 'firefox-container-1'
      });

      expect(quickTab.belongsToContainer('firefox-container-2')).toBe(false);
    });
  });

  describe('Serialization', () => {
    test('serialize should create plain object', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        title: 'Test Tab',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: true,
          soloedOnTabs: [100],
          mutedOnTabs: [200]
        },
        container: 'firefox-container-1',
        zIndex: 2000,
        createdAt: 1234567890
      });

      const serialized = quickTab.serialize();

      expect(serialized).toEqual({
        id: 'qt-123',
        url: 'https://example.com',
        title: 'Test Tab',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: true,
          soloedOnTabs: [100],
          mutedOnTabs: [200]
        },
        container: 'firefox-container-1',
        zIndex: 2000,
        createdAt: 1234567890
      });
    });

    test('serialize should clone arrays and objects', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          soloedOnTabs: [100, 200]
        }
      });

      const serialized = quickTab.serialize();

      // Mutate serialized object
      serialized.position.left = 999;
      serialized.visibility.soloedOnTabs.push(300);

      // Original should be unchanged
      expect(quickTab.position.left).toBe(100);
      expect(quickTab.visibility.soloedOnTabs).toEqual([100, 200]);
    });
  });

  describe('Static Factories', () => {
    describe('fromStorage', () => {
      test('should hydrate from storage format', () => {
        const data = {
          id: 'qt-123',
          url: 'https://example.com',
          title: 'Test Tab',
          position: { left: 150, top: 250 },
          size: { width: 900, height: 700 },
          visibility: {
            minimized: true,
            soloedOnTabs: [100],
            mutedOnTabs: []
          },
          container: 'firefox-container-2',
          zIndex: 1500,
          createdAt: 1234567890
        };

        const quickTab = QuickTab.fromStorage(data);

        expect(quickTab.id).toBe('qt-123');
        expect(quickTab.url).toBe('https://example.com');
        expect(quickTab.title).toBe('Test Tab');
        expect(quickTab.position).toEqual({ left: 150, top: 250 });
        expect(quickTab.size).toEqual({ width: 900, height: 700 });
        expect(quickTab.visibility.minimized).toBe(true);
        expect(quickTab.container).toBe('firefox-container-2');
        expect(quickTab.zIndex).toBe(1500);
      });

      test('should use defaults for missing fields', () => {
        const data = {
          id: 'qt-123',
          url: 'https://example.com'
        };

        const quickTab = QuickTab.fromStorage(data);

        expect(quickTab.title).toBe('Quick Tab');
        expect(quickTab.position).toEqual({ left: 100, top: 100 });
        expect(quickTab.size).toEqual({ width: 800, height: 600 });
        expect(quickTab.container).toBe('firefox-default');
        expect(quickTab.zIndex).toBe(1000);
      });

      test('should handle legacy cookieStoreId field', () => {
        const data = {
          id: 'qt-123',
          url: 'https://example.com',
          cookieStoreId: 'firefox-container-3'
        };

        const quickTab = QuickTab.fromStorage(data);

        expect(quickTab.container).toBe('firefox-container-3');
      });
    });

    describe('create', () => {
      test('should create with required fields and defaults', () => {
        const quickTab = QuickTab.create({
          id: 'qt-456',
          url: 'https://test.com'
        });

        expect(quickTab.id).toBe('qt-456');
        expect(quickTab.url).toBe('https://test.com');
        expect(quickTab.position).toEqual({ left: 100, top: 100 });
        expect(quickTab.size).toEqual({ width: 800, height: 600 });
        expect(quickTab.visibility.minimized).toBe(false);
        expect(quickTab.container).toBe('firefox-default');
      });

      test('should accept custom position and size', () => {
        const quickTab = QuickTab.create({
          id: 'qt-456',
          url: 'https://test.com',
          left: 200,
          top: 300,
          width: 1000,
          height: 800,
          container: 'firefox-container-4',
          title: 'Custom Title'
        });

        expect(quickTab.position).toEqual({ left: 200, top: 300 });
        expect(quickTab.size).toEqual({ width: 1000, height: 800 });
        expect(quickTab.container).toBe('firefox-container-4');
        expect(quickTab.title).toBe('Custom Title');
      });

      test('should throw error if id is missing', () => {
        expect(() => {
          QuickTab.create({ url: 'https://test.com' });
        }).toThrow('QuickTab.create requires id');
      });

      test('should throw error if url is missing', () => {
        expect(() => {
          QuickTab.create({ id: 'qt-456' });
        }).toThrow('QuickTab.create requires url');
      });
    });
  });
});
