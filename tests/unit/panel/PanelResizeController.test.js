/**
 * Unit tests for PanelResizeController
 * Part of Phase 2.10 - Panel component extraction
 *
 * Tests cover:
 * - Handle creation for all 8 directions
 * - Resize calculations (e.g., se increases size, nw changes position)
 * - Min constraints (250px width, 300px height)
 * - Pointer capture/release
 * - Callbacks (onSizeChange, onPositionChange, onResizeEnd, onBroadcast)
 * - Cleanup on destroy
 */

import { PanelResizeController } from '../../../src/features/quick-tabs/panel/PanelResizeController.js';

describe('PanelResizeController', () => {
  let mockPanel;
  let mockCallbacks;
  let controller;

  beforeEach(() => {
    // Mock panel element
    mockPanel = {
      appendChild: jest.fn(element => {
        // Add pointer capture methods to elements
        element.setPointerCapture = jest.fn();
        element.releasePointerCapture = jest.fn();
        element.remove = jest.fn();
      }),
      style: {},
      getBoundingClientRect: jest.fn(() => ({
        width: 350,
        height: 500,
        left: 100,
        top: 100
      }))
    };

    // Mock callbacks
    mockCallbacks = {
      onSizeChange: jest.fn(),
      onPositionChange: jest.fn(),
      onResizeEnd: jest.fn(),
      onBroadcast: jest.fn()
    };
  });

  afterEach(() => {
    if (controller) {
      controller.destroy();
    }
  });

  describe('Construction', () => {
    test('should create controller with panel and callbacks', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      expect(controller.panel).toBe(mockPanel);
      expect(controller.callbacks).toBe(mockCallbacks);
      expect(controller.minWidth).toBe(250);
      expect(controller.minHeight).toBe(300);
    });

    test('should create 8 resize handles on construction', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      expect(mockPanel.appendChild).toHaveBeenCalledTimes(8);
      expect(controller.handles).toHaveLength(8);
    });

    test('should create handles for all 8 directions', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const directions = controller.handles.map(h => h.direction);
      expect(directions).toEqual(expect.arrayContaining(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']));
    });

    test('should work with empty callbacks', () => {
      expect(() => {
        controller = new PanelResizeController(mockPanel, {});
      }).not.toThrow();
    });
  });

  describe('Handle Element Creation', () => {
    test('should create handle elements with correct classes', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const appendCalls = mockPanel.appendChild.mock.calls;
      expect(appendCalls[0][0].className).toContain('panel-resize-handle');
      expect(appendCalls[0][0].className).toContain('nw');
    });

    test('should apply correct cursor for each direction', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nwHandle = mockPanel.appendChild.mock.calls[0][0];
      expect(nwHandle.style.cursor).toBe('nw-resize');
    });

    test('should apply correct positioning styles', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nwHandle = mockPanel.appendChild.mock.calls[0][0]; // nw corner
      expect(nwHandle.style.top).toBe('0px');
      expect(nwHandle.style.left).toBe('0px');
    });

    test('should apply correct size styles', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nwHandle = mockPanel.appendChild.mock.calls[0][0]; // nw corner
      expect(nwHandle.style.width).toBe('10px');
      expect(nwHandle.style.height).toBe('10px');
    });
  });

  describe('Resize Operations - Southeast (se)', () => {
    test('should increase width when resizing east', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500, // +50px east
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      expect(mockPanel.style.width).toBe('400px'); // 350 + 50
    });

    test('should increase height when resizing south', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 450,
        clientY: 650, // +50px south
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      expect(mockPanel.style.height).toBe('550px'); // 500 + 50
    });

    test('should not change position when resizing southeast', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      expect(mockPanel.style.left).toBe('100px'); // No change
      expect(mockPanel.style.top).toBe('100px'); // No change
    });
  });

  describe('Resize Operations - Northwest (nw)', () => {
    test('should decrease width and move left when resizing west', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nwHandle = controller.handles.find(h => h.direction === 'nw').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });

      nwHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 150, // +50px west (moving right)
        clientY: 100,
        pointerId: 1
      });

      nwHandle.dispatchEvent(pointermoveEvent);

      expect(mockPanel.style.width).toBe('300px'); // 350 - 50
      expect(mockPanel.style.left).toBe('150px'); // 100 + 50
    });

    test('should decrease height and move top when resizing north', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nwHandle = controller.handles.find(h => h.direction === 'nw').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });

      nwHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 100,
        clientY: 150, // +50px north (moving down)
        pointerId: 1
      });

      nwHandle.dispatchEvent(pointermoveEvent);

      expect(mockPanel.style.height).toBe('450px'); // 500 - 50
      expect(mockPanel.style.top).toBe('150px'); // 100 + 50
    });
  });

  describe('Min Constraints', () => {
    test('should enforce minWidth constraint (250px)', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const wHandle = controller.handles.find(h => h.direction === 'w').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 300,
        pointerId: 1
      });

      wHandle.dispatchEvent(pointerdownEvent);

      // Try to resize 200px west (would violate minWidth)
      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 300, // +200px west
        clientY: 300,
        pointerId: 1
      });

      wHandle.dispatchEvent(pointermoveEvent);

      // Should be clamped to minWidth
      expect(mockPanel.style.width).toBe('250px'); // Not 150px (350 - 200)
    });

    test('should enforce minHeight constraint (300px)', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nHandle = controller.handles.find(h => h.direction === 'n').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 225,
        clientY: 100,
        pointerId: 1
      });

      nHandle.dispatchEvent(pointerdownEvent);

      // Try to resize 300px north (would violate minHeight)
      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 225,
        clientY: 400, // +300px north
        pointerId: 1
      });

      nHandle.dispatchEvent(pointermoveEvent);

      // Should be clamped to minHeight
      expect(mockPanel.style.height).toBe('300px'); // Not 200px (500 - 300)
    });
  });

  describe('Pointer Event Handling', () => {
    test('should ignore non-left-button clicks', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 1, // Middle button
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      // Should not resize
      expect(mockPanel.style.width).toBeUndefined();
    });

    test('should ignore pointermove if not resizing', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;

      // No pointerdown first
      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      // Should not resize
      expect(mockPanel.style.width).toBeUndefined();
    });

    test('should ignore pointermove with wrong pointerId', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 2 // Different pointerId
      });

      seHandle.dispatchEvent(pointermoveEvent);

      // Should not resize
      expect(mockPanel.style.width).toBeUndefined();
    });
  });

  describe('Callbacks', () => {
    test('should call onSizeChange during resize', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      expect(mockCallbacks.onSizeChange).toHaveBeenCalledWith(400, 550);
    });

    test('should call onPositionChange when position changes', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const nwHandle = controller.handles.find(h => h.direction === 'nw').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });

      nwHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 150,
        clientY: 150,
        pointerId: 1
      });

      nwHandle.dispatchEvent(pointermoveEvent);

      expect(mockCallbacks.onPositionChange).toHaveBeenCalledWith(150, 150);
    });

    test('should not call onPositionChange when only size changes', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      expect(mockCallbacks.onPositionChange).not.toHaveBeenCalled();
    });

    test('should call onResizeEnd on pointerup', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointermoveEvent = new PointerEvent('pointermove', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointermoveEvent);

      const pointerupEvent = new PointerEvent('pointerup', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerupEvent);

      expect(mockCallbacks.onResizeEnd).toHaveBeenCalledWith(350, 500, 100, 100);
    });

    test('should call onBroadcast on pointerup', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointerupEvent = new PointerEvent('pointerup', {
        clientX: 500,
        clientY: 650,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerupEvent);

      expect(mockCallbacks.onBroadcast).toHaveBeenCalledWith({
        width: 350,
        height: 500,
        left: 100,
        top: 100
      });
    });

    test('should call onResizeEnd on pointercancel', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      const seHandle = controller.handles.find(h => h.direction === 'se').element;
      const pointerdownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 450,
        clientY: 600,
        pointerId: 1
      });

      seHandle.dispatchEvent(pointerdownEvent);

      const pointercancelEvent = new PointerEvent('pointercancel', {
        pointerId: 1
      });

      seHandle.dispatchEvent(pointercancelEvent);

      expect(mockCallbacks.onResizeEnd).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    test('should remove all handles on destroy', () => {
      controller = new PanelResizeController(mockPanel, mockCallbacks);

      expect(controller.handles).toHaveLength(8);

      controller.destroy();

      // Check that all elements had remove() called
      const appendCalls = mockPanel.appendChild.mock.calls;
      appendCalls.forEach(call => {
        const element = call[0];
        expect(element.remove).toHaveBeenCalled();
      });

      expect(controller.handles).toHaveLength(0);
    });
  });
});
