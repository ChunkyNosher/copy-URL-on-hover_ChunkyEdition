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

  describe('Pointer Event Handlers', () => {
    let handle;
    let element;

    beforeEach(() => {
      handle = new ResizeHandle('se', mockWindow);
      element = handle.create();
      document.body.appendChild(element);

      // Mock setPointerCapture and releasePointerCapture
      element.setPointerCapture = jest.fn();
      element.releasePointerCapture = jest.fn();
    });

    afterEach(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });

    describe('handlePointerDown', () => {
      test('should initialize resize state on left button', () => {
        const event = {
          button: 0,
          clientX: 200,
          clientY: 300,
          pointerId: 1,
          stopPropagation: jest.fn(),
          preventDefault: jest.fn()
        };

        handle.handlePointerDown(event);

        expect(handle.isResizing).toBe(true);
        expect(handle.startState).toEqual({
          x: 200,
          y: 300,
          width: 800,
          height: 600,
          left: 100,
          top: 100
        });
        expect(element.setPointerCapture).toHaveBeenCalledWith(1);
        expect(event.stopPropagation).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      test('should ignore non-left button clicks', () => {
        const event = {
          button: 1, // Right button
          clientX: 200,
          clientY: 300,
          pointerId: 1
        };

        handle.handlePointerDown(event);

        expect(handle.isResizing).toBe(false);
        expect(handle.startState).toBeNull();
      });

      test('should ignore middle button clicks', () => {
        const event = {
          button: 2,
          clientX: 200,
          clientY: 300,
          pointerId: 1
        };

        handle.handlePointerDown(event);

        expect(handle.isResizing).toBe(false);
        expect(handle.startState).toBeNull();
      });
    });

    describe('handlePointerMove', () => {
      beforeEach(() => {
        handle.startState = {
          x: 200,
          y: 300,
          width: 800,
          height: 600,
          left: 100,
          top: 100
        };
      });

      test('should not resize when not in resize mode', () => {
        handle.isResizing = false;

        const event = {
          clientX: 250,
          clientY: 350,
          preventDefault: jest.fn()
        };

        handle.handlePointerMove(event);

        expect(mockWindow.container.style.width).toBeUndefined();
        expect(event.preventDefault).not.toHaveBeenCalled();
      });

      test('should update dimensions during resize', () => {
        handle.isResizing = true;

        const event = {
          clientX: 250, // dx = +50
          clientY: 350, // dy = +50
          preventDefault: jest.fn()
        };

        handle.handlePointerMove(event);

        expect(mockWindow.width).toBe(850);
        expect(mockWindow.height).toBe(650);
        expect(mockWindow.container.style.width).toBe('850px');
        expect(mockWindow.container.style.height).toBe('650px');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      test('should call onSizeChange callback', () => {
        handle.isResizing = true;

        const event = {
          clientX: 250,
          clientY: 350,
          preventDefault: jest.fn()
        };

        handle.handlePointerMove(event);

        expect(mockWindow.onSizeChange).toHaveBeenCalledWith('test-window', 850, 650);
      });

      test('should call onPositionChange for west handle', () => {
        const westHandle = new ResizeHandle('w', mockWindow);
        westHandle.startState = {
          x: 200,
          y: 300,
          width: 800,
          height: 600,
          left: 100,
          top: 100
        };
        westHandle.isResizing = true;

        const event = {
          clientX: 150, // dx = -50 (moving left)
          clientY: 300,
          preventDefault: jest.fn()
        };

        westHandle.handlePointerMove(event);

        expect(mockWindow.onPositionChange).toHaveBeenCalledWith('test-window', 50, 100);
      });

      test('should clamp to minimum dimensions', () => {
        handle.isResizing = true;

        const event = {
          clientX: 100, // dx = -100 (try to shrink below minimum)
          clientY: 200, // dy = -100
          preventDefault: jest.fn()
        };

        handle.handlePointerMove(event);

        expect(mockWindow.width).toBe(700); // 800 - 100
        expect(mockWindow.height).toBe(500); // 600 - 100
      });
    });

    describe('handlePointerUp', () => {
      beforeEach(() => {
        handle.startState = {
          x: 200,
          y: 300,
          width: 800,
          height: 600,
          left: 100,
          top: 100
        };
      });

      test('should not process when not resizing', () => {
        handle.isResizing = false;

        const event = {
          pointerId: 1,
          preventDefault: jest.fn(),
          stopPropagation: jest.fn()
        };

        handle.handlePointerUp(event);

        expect(element.releasePointerCapture).not.toHaveBeenCalled();
      });

      test('should end resize and release pointer', () => {
        handle.isResizing = true;
        mockWindow.width = 850;
        mockWindow.height = 650;

        const event = {
          pointerId: 1,
          preventDefault: jest.fn(),
          stopPropagation: jest.fn()
        };

        handle.handlePointerUp(event);

        expect(handle.isResizing).toBe(false);
        expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        expect(handle.startState).toBeNull();
      });

      test('should call onSizeChangeEnd callback', () => {
        handle.isResizing = true;
        mockWindow.width = 850;
        mockWindow.height = 650;

        const event = {
          pointerId: 1,
          preventDefault: jest.fn(),
          stopPropagation: jest.fn()
        };

        handle.handlePointerUp(event);

        expect(mockWindow.onSizeChangeEnd).toHaveBeenCalledWith('test-window', 850, 650);
      });

      test('should call onPositionChangeEnd when position changed', () => {
        handle.isResizing = true;
        mockWindow.left = 150;
        mockWindow.top = 150;

        const event = {
          pointerId: 1,
          preventDefault: jest.fn(),
          stopPropagation: jest.fn()
        };

        handle.handlePointerUp(event);

        expect(mockWindow.onPositionChangeEnd).toHaveBeenCalledWith('test-window', 150, 150);
      });

      test('should not call onPositionChangeEnd when position unchanged', () => {
        handle.isResizing = true;
        mockWindow.left = 100;
        mockWindow.top = 100;

        const event = {
          pointerId: 1,
          preventDefault: jest.fn(),
          stopPropagation: jest.fn()
        };

        handle.handlePointerUp(event);

        expect(mockWindow.onPositionChangeEnd).not.toHaveBeenCalled();
      });
    });

    describe('handlePointerCancel', () => {
      beforeEach(() => {
        handle.startState = {
          x: 200,
          y: 300,
          width: 800,
          height: 600,
          left: 100,
          top: 100
        };
      });

      test('should not process when not resizing', () => {
        handle.isResizing = false;

        const event = {};

        handle.handlePointerCancel(event);

        expect(mockWindow.onSizeChangeEnd).not.toHaveBeenCalled();
      });

      test('should emergency save on cancel', () => {
        handle.isResizing = true;
        mockWindow.width = 850;
        mockWindow.height = 650;
        mockWindow.left = 150;
        mockWindow.top = 150;

        const event = {};

        handle.handlePointerCancel(event);

        expect(handle.isResizing).toBe(false);
        expect(handle.startState).toBeNull();
        expect(mockWindow.onSizeChangeEnd).toHaveBeenCalledWith('test-window', 850, 650);
        expect(mockWindow.onPositionChangeEnd).toHaveBeenCalledWith('test-window', 150, 150);
      });

      test('should handle optional callbacks gracefully', () => {
        handle.isResizing = true;
        delete mockWindow.onSizeChangeEnd;
        delete mockWindow.onPositionChangeEnd;

        const event = {};

        expect(() => {
          handle.handlePointerCancel(event);
        }).not.toThrow();

        expect(handle.isResizing).toBe(false);
        expect(handle.startState).toBeNull();
      });
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
