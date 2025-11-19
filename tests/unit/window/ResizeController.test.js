/**
 * Unit tests for ResizeController
 * Tests the facade pattern that coordinates all 8 resize handles
 */

import { ResizeController } from '../../../src/features/quick-tabs/window/ResizeController.js';
import { ResizeHandle } from '../../../src/features/quick-tabs/window/ResizeHandle.js';

// Mock ResizeHandle
jest.mock('../../../src/features/quick-tabs/window/ResizeHandle.js');

describe('ResizeController', () => {
  let mockWindow;
  let mockContainer;
  let resizeController;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock DOM container
    mockContainer = {
      appendChild: jest.fn(),
      removeChild: jest.fn()
    };

    // Mock window object
    mockWindow = {
      id: 'test-window',
      width: 800,
      height: 600,
      left: 100,
      top: 100,
      container: mockContainer,
      onSizeChange: jest.fn(),
      onSizeChangeEnd: jest.fn(),
      onPositionChange: jest.fn(),
      onPositionChangeEnd: jest.fn()
    };

    // Mock ResizeHandle instances
    ResizeHandle.mockImplementation((direction, window, options) => {
      return {
        direction,
        window,
        options,
        element: document.createElement('div'),
        create: jest.fn(() => document.createElement('div')),
        destroy: jest.fn()
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with window reference', () => {
      resizeController = new ResizeController(mockWindow);

      expect(resizeController.window).toBe(mockWindow);
      expect(resizeController.handles).toEqual([]);
    });

    test('should accept options parameter', () => {
      const options = { minWidth: 500, minHeight: 400 };
      resizeController = new ResizeController(mockWindow, options);

      expect(resizeController.options).toEqual(options);
    });

    test('should use empty object for options if not provided', () => {
      resizeController = new ResizeController(mockWindow);

      expect(resizeController.options).toEqual({});
    });

    test('should initialize handles as empty array', () => {
      resizeController = new ResizeController(mockWindow);

      expect(Array.isArray(resizeController.handles)).toBe(true);
      expect(resizeController.handles.length).toBe(0);
    });
  });

  describe('attachHandles()', () => {
    beforeEach(() => {
      resizeController = new ResizeController(mockWindow, {
        minWidth: 400,
        minHeight: 300
      });
    });

    test('should create ResizeHandle for all 8 directions', () => {
      resizeController.attachHandles();

      expect(ResizeHandle).toHaveBeenCalledTimes(8);

      // Verify all 8 directions
      const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      directions.forEach(direction => {
        expect(ResizeHandle).toHaveBeenCalledWith(direction, mockWindow, resizeController.options);
      });
    });

    test('should pass options to each ResizeHandle', () => {
      const options = { minWidth: 500, minHeight: 400 };
      resizeController = new ResizeController(mockWindow, options);

      resizeController.attachHandles();

      // Check that options were passed to all handles
      expect(ResizeHandle.mock.calls.every(call => call[2] === options)).toBe(true);
    });

    test('should call create() on each handle', () => {
      resizeController.attachHandles();

      // Get all mock instances
      const mockInstances = ResizeHandle.mock.results.map(result => result.value);

      // Verify create() was called on each
      mockInstances.forEach(instance => {
        expect(instance.create).toHaveBeenCalledTimes(1);
      });
    });

    test('should append each handle element to window container', () => {
      resizeController.attachHandles();

      // Should have appended 8 elements (one per direction)
      expect(mockContainer.appendChild).toHaveBeenCalledTimes(8);
    });

    test('should track all handle instances', () => {
      const handles = resizeController.attachHandles();

      expect(resizeController.handles.length).toBe(8);
      expect(handles.length).toBe(8);
      expect(handles).toBe(resizeController.handles);
    });

    test('should return array of handle instances', () => {
      const handles = resizeController.attachHandles();

      expect(Array.isArray(handles)).toBe(true);
      expect(handles.length).toBe(8);

      // Verify each handle has expected properties
      handles.forEach(handle => {
        expect(handle).toHaveProperty('direction');
        expect(handle).toHaveProperty('window');
        expect(handle).toHaveProperty('create');
        expect(handle).toHaveProperty('destroy');
      });
    });

    test('should store handles in correct order', () => {
      resizeController.attachHandles();

      const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      resizeController.handles.forEach((handle, index) => {
        expect(handle.direction).toBe(directions[index]);
      });
    });
  });

  describe('detachAll()', () => {
    beforeEach(() => {
      resizeController = new ResizeController(mockWindow);
    });

    test('should call destroy() on all handles', () => {
      resizeController.attachHandles();
      const handlesBefore = [...resizeController.handles];

      resizeController.detachAll();

      // Verify destroy() was called on each handle
      handlesBefore.forEach(handle => {
        expect(handle.destroy).toHaveBeenCalledTimes(1);
      });
    });

    test('should clear handles array', () => {
      resizeController.attachHandles();
      expect(resizeController.handles.length).toBe(8);

      resizeController.detachAll();

      expect(resizeController.handles.length).toBe(0);
      expect(resizeController.handles).toEqual([]);
    });

    test('should handle being called when no handles attached', () => {
      // Should not throw when no handles exist
      expect(() => {
        resizeController.detachAll();
      }).not.toThrow();

      expect(resizeController.handles).toEqual([]);
    });

    test('should handle being called multiple times', () => {
      resizeController.attachHandles();

      // Call detachAll multiple times
      resizeController.detachAll();
      resizeController.detachAll();
      resizeController.detachAll();

      // Should not throw and handles should remain empty
      expect(resizeController.handles).toEqual([]);
    });
  });

  describe('getHandle()', () => {
    beforeEach(() => {
      resizeController = new ResizeController(mockWindow);
      resizeController.attachHandles();
    });

    test('should return handle for valid direction', () => {
      const seHandle = resizeController.getHandle('se');

      expect(seHandle).toBeDefined();
      expect(seHandle.direction).toBe('se');
    });

    test('should return handle for all 8 directions', () => {
      const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

      directions.forEach(direction => {
        const handle = resizeController.getHandle(direction);
        expect(handle).toBeDefined();
        expect(handle.direction).toBe(direction);
      });
    });

    test('should return undefined for invalid direction', () => {
      const handle = resizeController.getHandle('invalid');

      expect(handle).toBeUndefined();
    });

    test('should return undefined when no handles attached', () => {
      resizeController.detachAll();

      const handle = resizeController.getHandle('se');

      expect(handle).toBeUndefined();
    });

    test('should return undefined for null direction', () => {
      const handle = resizeController.getHandle(null);

      expect(handle).toBeUndefined();
    });

    test('should return undefined for empty string', () => {
      const handle = resizeController.getHandle('');

      expect(handle).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle null window reference', () => {
      expect(() => {
        resizeController = new ResizeController(null);
      }).not.toThrow();

      expect(resizeController.window).toBeNull();
    });

    test('should handle undefined window reference', () => {
      expect(() => {
        resizeController = new ResizeController(undefined);
      }).not.toThrow();

      expect(resizeController.window).toBeUndefined();
    });

    test('should handle multiple attachHandles() calls', () => {
      resizeController = new ResizeController(mockWindow);

      // Attach multiple times
      resizeController.attachHandles();
      const firstHandles = resizeController.handles.length;

      resizeController.attachHandles();
      const secondHandles = resizeController.handles.length;

      // Second call should add more handles (not idempotent by design)
      expect(secondHandles).toBe(firstHandles + 8);
    });

    test('should properly cleanup after attach/detach cycle', () => {
      resizeController = new ResizeController(mockWindow);

      // Attach and detach multiple times
      for (let i = 0; i < 3; i++) {
        resizeController.attachHandles();
        expect(resizeController.handles.length).toBeGreaterThan(0);

        resizeController.detachAll();
        expect(resizeController.handles.length).toBe(0);
      }
    });
  });

  describe('Integration with ResizeHandle', () => {
    beforeEach(() => {
      resizeController = new ResizeController(mockWindow, {
        minWidth: 500,
        minHeight: 400,
        onResizeStart: jest.fn(),
        onResize: jest.fn(),
        onResizeEnd: jest.fn()
      });
    });

    test('should pass all options to ResizeHandle instances', () => {
      resizeController.attachHandles();

      // Verify options were passed correctly
      ResizeHandle.mock.calls.forEach(call => {
        const [_direction, _window, options] = call;
        expect(options).toEqual(resizeController.options);
        expect(options.minWidth).toBe(500);
        expect(options.minHeight).toBe(400);
        expect(options.onResizeStart).toBeDefined();
        expect(options.onResize).toBeDefined();
        expect(options.onResizeEnd).toBeDefined();
      });
    });

    test('should pass window reference to all handles', () => {
      resizeController.attachHandles();

      ResizeHandle.mock.calls.forEach(call => {
        const [, windowRef] = call;
        expect(windowRef).toBe(mockWindow);
      });
    });

    test('should maintain handle references after creation', () => {
      const handles = resizeController.attachHandles();

      // Verify we can access each handle
      handles.forEach(handle => {
        expect(handle).toBeDefined();
        expect(handle.direction).toBeDefined();
        expect(handle.window).toBe(mockWindow);
      });
    });

    test('should correctly wire up handle creation and DOM insertion', () => {
      resizeController.attachHandles();

      // Verify the sequence: create handle → call create() → append element
      const mockInstances = ResizeHandle.mock.results.map(result => result.value);

      mockInstances.forEach(instance => {
        expect(instance.create).toHaveBeenCalled();
      });

      expect(mockContainer.appendChild).toHaveBeenCalledTimes(8);
    });
  });

  describe('Memory Management', () => {
    test('should properly cleanup all references on detachAll()', () => {
      resizeController = new ResizeController(mockWindow);
      resizeController.attachHandles();

      const handleRefs = [...resizeController.handles];

      resizeController.detachAll();

      // Verify destroy was called on all handles
      handleRefs.forEach(handle => {
        expect(handle.destroy).toHaveBeenCalled();
      });

      // Verify handles array is empty
      expect(resizeController.handles.length).toBe(0);
    });

    test('should allow garbage collection after detachAll()', () => {
      resizeController = new ResizeController(mockWindow);
      resizeController.attachHandles();

      resizeController.detachAll();

      // After detachAll, handles array should be empty
      // allowing old handles to be garbage collected
      expect(resizeController.handles).toEqual([]);
    });
  });
});
