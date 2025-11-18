/**
 * Unit tests for ResizeHandle
 * Demonstrates table-driven testing for refactored window.js components
 */

import { ResizeHandle } from '../../../src/features/quick-tabs/window/ResizeHandle.js';

describe('ResizeHandle', () => {
  let mockWindow;

  beforeEach(() => {
    mockWindow = {
      id: 'test-window',
      width: 800,
      height: 600,
      left: 100,
      top: 100,
      container: {
        style: {}
      },
      onSizeChange: jest.fn(),
      onSizeChangeEnd: jest.fn(),
      onPositionChange: jest.fn(),
      onPositionChangeEnd: jest.fn()
    };
  });

  describe('Constructor', () => {
    test('should initialize with valid direction', () => {
      const handle = new ResizeHandle('se', mockWindow);

      expect(handle.direction).toBe('se');
      expect(handle.window).toBe(mockWindow);
      expect(handle.minWidth).toBe(400);
      expect(handle.minHeight).toBe(300);
    });

    test('should accept custom min dimensions', () => {
      const handle = new ResizeHandle('se', mockWindow, {
        minWidth: 500,
        minHeight: 400
      });

      expect(handle.minWidth).toBe(500);
      expect(handle.minHeight).toBe(400);
    });

    test('should throw error for invalid direction', () => {
      expect(() => {
        new ResizeHandle('invalid', mockWindow);
      }).toThrow('Invalid resize direction: invalid');
    });
  });

  describe('Element Creation', () => {
    test('should create element with correct styling', () => {
      const handle = new ResizeHandle('se', mockWindow);
      const element = handle.create();

      expect(element).toBeDefined();
      expect(element.className).toBe('quick-tab-resize-handle-se');
      expect(element.style.cursor).toBe('se-resize');
      expect(element.style.position).toBe('absolute');
    });

    test('should create elements for all 8 directions', () => {
      const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

      for (const dir of directions) {
        const handle = new ResizeHandle(dir, mockWindow);
        const element = handle.create();

        expect(element.className).toBe(`quick-tab-resize-handle-${dir}`);
        expect(element.style.cursor).toContain('resize');
      }
    });
  });

  describe('Resize Logic', () => {
    let handle;
    let element;

    beforeEach(() => {
      handle = new ResizeHandle('se', mockWindow);
      element = handle.create();

      // Append to document for event testing
      document.body.appendChild(element);
    });

    afterEach(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });

    // Note: PointerEvent integration tests skipped in JSDOM environment
    // These would work in a real browser or with Playwright
    test.skip('should start resize on pointerdown', () => {
      const event = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 200,
        clientY: 200,
        pointerId: 1,
        bubbles: true
      });

      element.dispatchEvent(event);

      expect(handle.isResizing).toBe(true);
      expect(handle.startState).toEqual({
        x: 200,
        y: 200,
        width: 800,
        height: 600,
        left: 100,
        top: 100
      });
    });

    test.skip('should ignore non-left-button clicks', () => {
      const event = new PointerEvent('pointerdown', {
        button: 1, // Right button
        clientX: 200,
        clientY: 200,
        pointerId: 1,
        bubbles: true
      });

      element.dispatchEvent(event);

      expect(handle.isResizing).toBe(false);
      expect(handle.startState).toBeNull();
    });

    test('should calculate dimensions for southeast resize', () => {
      handle.startState = {
        x: 200,
        y: 200,
        width: 800,
        height: 600,
        left: 100,
        top: 100
      };

      const newDims = handle.calculateNewDimensions(50, 50); // dx=50, dy=50

      expect(newDims.width).toBe(850); // Expanded right
      expect(newDims.height).toBe(650); // Expanded down
      expect(newDims.left).toBe(100); // Unchanged
      expect(newDims.top).toBe(100); // Unchanged
    });

    test('should respect minimum width', () => {
      handle.startState = {
        x: 200,
        y: 200,
        width: 450,
        height: 600,
        left: 100,
        top: 100
      };

      const newDims = handle.calculateNewDimensions(-100, 0); // Try to shrink below min

      expect(newDims.width).toBe(400); // Clamped to minWidth
    });

    test('should respect minimum height', () => {
      handle.startState = {
        x: 200,
        y: 200,
        width: 800,
        height: 350,
        left: 100,
        top: 100
      };

      const newDims = handle.calculateNewDimensions(0, -100); // Try to shrink below min

      expect(newDims.height).toBe(300); // Clamped to minHeight
    });
  });

  describe('Callback Integration', () => {
    let handle;

    beforeEach(() => {
      handle = new ResizeHandle('se', mockWindow);
      handle.create();
      handle.startState = {
        x: 200,
        y: 200,
        width: 800,
        height: 600,
        left: 100,
        top: 100
      };
    });

    test('should call onSizeChange when size changes', () => {
      const newDims = { width: 850, height: 650, left: 100, top: 100 };

      handle.notifyChanges(newDims);

      expect(mockWindow.onSizeChange).toHaveBeenCalledWith('test-window', 850, 650);
    });

    test('should call onPositionChange when position changes', () => {
      const newDims = { width: 800, height: 600, left: 150, top: 150 };

      handle.notifyChanges(newDims);

      expect(mockWindow.onPositionChange).toHaveBeenCalledWith('test-window', 150, 150);
    });

    test('should not call callbacks when dimensions unchanged', () => {
      const newDims = { width: 800, height: 600, left: 100, top: 100 };

      handle.notifyChanges(newDims);

      expect(mockWindow.onSizeChange).not.toHaveBeenCalled();
      expect(mockWindow.onPositionChange).not.toHaveBeenCalled();
    });
  });

  describe('Table-Driven Configuration', () => {
    test.each([
      ['se', { e: true, s: true }],
      ['sw', { w: true, s: true }],
      ['ne', { e: true, n: true }],
      ['nw', { w: true, n: true }],
      ['e', { e: true }],
      ['w', { w: true }],
      ['n', { n: true }],
      ['s', { s: true }]
    ])('direction %s should modify correct dimensions', (direction, expected) => {
      const handle = new ResizeHandle(direction, mockWindow);
      handle.startState = {
        x: 200,
        y: 200,
        width: 800,
        height: 600,
        left: 100,
        top: 100
      };

      const newDims = handle.calculateNewDimensions(50, 50);

      if (expected.e) {
        expect(newDims.width).toBeGreaterThan(800); // Expanded right (positive dx increases width)
        expect(newDims.left).toBe(100); // Position unchanged
      }
      if (expected.w) {
        expect(newDims.width).toBeLessThan(800); // Shrunk (positive dx decreases width)
        expect(newDims.left).toBeGreaterThan(100); // Position moved right to compensate
      }
      if (expected.s) {
        expect(newDims.height).toBeGreaterThan(600); // Expanded down (positive dy increases height)
        expect(newDims.top).toBe(100); // Position unchanged
      }
      if (expected.n) {
        expect(newDims.height).toBeLessThan(600); // Shrunk (positive dy decreases height)
        expect(newDims.top).toBeGreaterThan(100); // Position moved down to compensate
      }
    });
  });

  describe('Cleanup', () => {
    test('should remove element on destroy', () => {
      const handle = new ResizeHandle('se', mockWindow);
      const element = handle.create();

      document.body.appendChild(element);
      expect(document.body.contains(element)).toBe(true);

      handle.destroy();

      expect(document.body.contains(element)).toBe(false);
      expect(handle.element).toBeNull();
    });
  });
});
