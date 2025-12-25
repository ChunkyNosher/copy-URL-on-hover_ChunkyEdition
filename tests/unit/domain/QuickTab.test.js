/**
 * QuickTab Domain Entity Tests
 * v1.6.0 - Unit tests for pure business logic
 * v1.6.2.2 - Updated for unified format (container field removed)
 * v1.6.4 - Removed Solo/Mute tests (functionality removed)
 *
 * Target: 100% coverage (branches, functions, lines, statements)
 */

import { QuickTab } from '../../../src/domain/QuickTab.js';

describe('QuickTab Domain Entity', () => {
  describe('Construction', () => {
    // v1.6.4 - Removed soloedOnTabs/mutedOnTabs from visibility
    test('should create QuickTab with valid parameters', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: false
        }
      });

      expect(quickTab.id).toBe('qt-123');
      expect(quickTab.url).toBe('https://example.com');
      expect(quickTab.position).toEqual({ left: 100, top: 200 });
      expect(quickTab.size).toEqual({ width: 800, height: 600 });
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

  // v1.6.4 - Simplified visibility logic (only minimized state matters)
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

    // v1.6.4 - Solo/Mute visibility tests removed (functionality removed)
    // Quick Tabs are now always visible on all tabs (when not minimized)
  });

  // v1.6.4 - Solo Operations tests removed (functionality removed)
  // v1.6.4 - Mute Operations tests removed (functionality removed)

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
      expect(() => quickTab.updateSize('800', 600)).toThrow('Size must be numeric {width, height}');
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

  // v1.6.4 - Dead Tab Cleanup tests removed (Solo/Mute functionality removed)

  // v1.6.2.2 - Container Operations removed (container field removed for global visibility)

  // v1.6.4 - Serialization tests updated for Solo/Mute removal
  describe('Serialization', () => {
    test('serialize should create plain object', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        title: 'Test Tab',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: true
        },
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
          minimized: true
        },
        zIndex: 2000,
        createdAt: 1234567890,
        lastModified: expect.any(Number),
        slot: null
      });
    });

    // v1.6.4 - Updated for Solo/Mute removal
    test('serialize should include slot when set', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {},
        slot: 5
      });

      const serialized = quickTab.serialize();

      expect(serialized.slot).toBe(5);
    });

    // v1.6.4 - Updated clone test for Solo/Mute removal
    test('serialize should clone arrays and objects', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {
          minimized: false
        }
      });

      const serialized = quickTab.serialize();

      // Mutate serialized object
      serialized.position.left = 999;

      // Original should be unchanged
      expect(quickTab.position.left).toBe(100);
    });
  });

  describe('Static Factories', () => {
    describe('fromStorage', () => {
      // v1.6.4 - Updated for Solo/Mute removal
      test('should hydrate from storage format', () => {
        const data = {
          id: 'qt-123',
          url: 'https://example.com',
          title: 'Test Tab',
          position: { left: 150, top: 250 },
          size: { width: 900, height: 700 },
          visibility: {
            minimized: true
          },
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
        expect(quickTab.zIndex).toBe(1000);
      });

      // v1.6.2.2 - Container-related tests removed (container field removed)
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
      });

      test('should accept custom position and size', () => {
        const quickTab = QuickTab.create({
          id: 'qt-456',
          url: 'https://test.com',
          left: 200,
          top: 300,
          width: 1000,
          height: 800,
          title: 'Custom Title'
        });

        expect(quickTab.position).toEqual({ left: 200, top: 300 });
        expect(quickTab.size).toEqual({ width: 1000, height: 800 });
        expect(quickTab.title).toBe('Custom Title');
      });

      test('should accept slot parameter', () => {
        const quickTab = QuickTab.create({
          id: 'qt-456',
          url: 'https://test.com',
          slot: 3
        });

        expect(quickTab.slot).toBe(3);
      });

      test('should default slot to null if not provided', () => {
        const quickTab = QuickTab.create({
          id: 'qt-456',
          url: 'https://test.com'
        });

        expect(quickTab.slot).toBeNull();
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

  describe('Slot Operations', () => {
    test('should preserve slot from storage data', () => {
      const data = {
        id: 'qt-123',
        url: 'https://example.com',
        slot: 2
      };

      const quickTab = QuickTab.fromStorage(data);

      expect(quickTab.slot).toBe(2);
    });

    test('should default slot to null when not in storage', () => {
      const data = {
        id: 'qt-123',
        url: 'https://example.com'
      };

      const quickTab = QuickTab.fromStorage(data);

      expect(quickTab.slot).toBeNull();
    });

    test('should include slot in serialization', () => {
      const quickTab = new QuickTab({
        id: 'qt-123',
        url: 'https://example.com',
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        visibility: {},
        slot: 5
      });

      const serialized = quickTab.serialize();

      expect(serialized.slot).toBe(5);
    });
  });
});
