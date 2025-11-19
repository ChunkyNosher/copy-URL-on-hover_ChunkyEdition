/**
 * @jest-environment jsdom
 */

import { DragController } from '../../../src/features/quick-tabs/window/DragController.js';

describe('DragController - Pointer Events API', () => {
  let element;
  let parentElement;
  let callbacks;

  beforeEach(() => {
    // Create mock DOM structure
    parentElement = document.createElement('div');
    parentElement.getBoundingClientRect = jest.fn(() => ({
      left: 100,
      top: 100,
      width: 400,
      height: 300
    }));

    element = document.createElement('div');
    // Mock Pointer Events API methods
    element.setPointerCapture = jest.fn();
    element.releasePointerCapture = jest.fn();
    parentElement.appendChild(element);
    document.body.appendChild(parentElement);

    // Mock callbacks
    callbacks = {
      onDragStart: jest.fn(),
      onDrag: jest.fn(),
      onDragEnd: jest.fn(),
      onDragCancel: jest.fn()
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  describe('Constructor & Initialization', () => {
    test('should initialize with element and callbacks', () => {
      const controller = new DragController(element, callbacks);

      expect(controller.element).toBe(element);
      expect(controller.onDragStart).toBe(callbacks.onDragStart);
      expect(controller.onDrag).toBe(callbacks.onDrag);
      expect(controller.onDragEnd).toBe(callbacks.onDragEnd);
      expect(controller.onDragCancel).toBe(callbacks.onDragCancel);
    });

    test('should initialize with null callbacks when none provided', () => {
      const controller = new DragController(element);

      expect(controller.onDragStart).toBeNull();
      expect(controller.onDrag).toBeNull();
      expect(controller.onDragEnd).toBeNull();
      expect(controller.onDragCancel).toBeNull();
    });

    test('should initialize drag state with Pointer Events properties', () => {
      const controller = new DragController(element, callbacks);

      expect(controller.isDragging).toBe(false);
      expect(controller.currentPointerId).toBeNull();
      expect(controller.offsetX).toBe(0);
      expect(controller.offsetY).toBe(0);
      expect(controller.currentX).toBe(0);
      expect(controller.currentY).toBe(0);
      expect(controller.rafId).toBeNull();
    });

    test('should attach Pointer Events listeners on construction', () => {
      const addEventListenerSpy = jest.spyOn(element, 'addEventListener');

      new DragController(element, callbacks);

      expect(addEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });
  });

  describe('Pointer Down - Start Drag', () => {
    test('should start drag on pointerdown', () => {
      const controller = new DragController(element, callbacks);

      const pointerEvent = new PointerEvent('pointerdown', {
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      element.dispatchEvent(pointerEvent);

      expect(controller.isDragging).toBe(true);
      expect(controller.currentPointerId).toBe(1);
      expect(controller.offsetX).toBe(50); // 150 - 100 (element left)
      expect(controller.offsetY).toBe(100); // 200 - 100 (element top)
      expect(callbacks.onDragStart).toHaveBeenCalledWith(100, 100);
      expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    });

    test('should not drag when clicking on button', () => {
      const controller = new DragController(element, callbacks);

      const button = document.createElement('button');
      element.appendChild(button);

      const pointerEvent = new PointerEvent('pointerdown', {
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      Object.defineProperty(pointerEvent, 'target', {
        value: button,
        writable: false
      });

      element.dispatchEvent(pointerEvent);

      expect(controller.isDragging).toBe(false);
      expect(callbacks.onDragStart).not.toHaveBeenCalled();
      expect(element.setPointerCapture).not.toHaveBeenCalled();
    });

    test('should not drag when clicking on input', () => {
      const controller = new DragController(element, callbacks);

      const input = document.createElement('input');
      element.appendChild(input);

      const pointerEvent = new PointerEvent('pointerdown', {
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      Object.defineProperty(pointerEvent, 'target', {
        value: input,
        writable: false
      });

      element.dispatchEvent(pointerEvent);

      expect(controller.isDragging).toBe(false);
      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });
  });

  describe('Pointer Move - During Drag', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should update position during drag with requestAnimationFrame', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      const pointerDown = new PointerEvent('pointerdown', {
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      element.dispatchEvent(pointerDown);

      // Clear initial onDragStart call
      callbacks.onDrag.mockClear();

      // Move pointer
      const pointerMove = new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 200,
        clientY: 250,
        bubbles: true
      });
      element.dispatchEvent(pointerMove);

      // RAF should be scheduled
      expect(controller.rafId).not.toBeNull();

      // Execute RAF
      jest.runAllTimers();

      // Check onDrag was called with new position
      expect(callbacks.onDrag).toHaveBeenCalledWith(150, 150);
      expect(controller.currentX).toBe(150);
      expect(controller.currentY).toBe(150);
      expect(controller.rafId).toBeNull();
    });

    test('should not process pointermove if not dragging', () => {
      const controller = new DragController(element, callbacks);

      const pointerMove = new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 200,
        clientY: 250,
        bubbles: true
      });
      element.dispatchEvent(pointerMove);

      expect(callbacks.onDrag).not.toHaveBeenCalled();
      expect(controller.rafId).toBeNull();
    });

    test('should throttle RAF calls during fast movement', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      callbacks.onDrag.mockClear();

      // First move - schedules RAF
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 160,
          clientY: 210,
          bubbles: true
        })
      );
      expect(controller.rafId).not.toBeNull();

      // Second move while RAF pending - should be ignored
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 170,
          clientY: 220,
          bubbles: true
        })
      );

      // Execute RAF
      jest.runAllTimers();

      // onDrag should only be called once (for first move)
      expect(callbacks.onDrag).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pointer Up - End Drag', () => {
    test('should end drag on pointerup', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      expect(controller.isDragging).toBe(true);

      // End drag
      const pointerUp = new PointerEvent('pointerup', {
        pointerId: 1,
        clientX: 200,
        clientY: 250,
        bubbles: true
      });
      element.dispatchEvent(pointerUp);

      expect(controller.isDragging).toBe(false);
      expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
      expect(callbacks.onDragEnd).toHaveBeenCalledWith(150, 150);
    });

    test('should not process pointerup if not dragging', () => {
      const _controller = new DragController(element, callbacks);

      element.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 1,
          clientX: 200,
          clientY: 250,
          bubbles: true
        })
      );

      expect(callbacks.onDragEnd).not.toHaveBeenCalled();
    });

    test('should cancel pending RAF on pointerup', () => {
      jest.useFakeTimers();
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Move (schedules RAF)
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 160,
          clientY: 210,
          bubbles: true
        })
      );

      const rafId = controller.rafId;
      expect(rafId).not.toBeNull();

      // End drag (should cancel RAF)
      element.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 1,
          clientX: 170,
          clientY: 220,
          bubbles: true
        })
      );

      expect(controller.rafId).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('Pointer Cancel - CRITICAL FOR ISSUE #51', () => {
    test('should handle pointercancel (tab switch during drag)', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Move
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 180,
          clientY: 230,
          bubbles: true
        })
      );

      jest.runAllTimers();
      const lastX = controller.currentX;
      const lastY = controller.currentY;

      expect(controller.isDragging).toBe(true);

      // Pointer cancel (e.g., tab switch)
      element.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: 1,
          bubbles: true
        })
      );

      expect(controller.isDragging).toBe(false);
      expect(controller.currentPointerId).toBeNull();
      expect(callbacks.onDragCancel).toHaveBeenCalledWith(lastX, lastY);
    });

    test('should call onDragEnd if onDragCancel not provided', () => {
      const _controller = new DragController(element, {
        onDragStart: callbacks.onDragStart,
        onDrag: callbacks.onDrag,
        onDragEnd: callbacks.onDragEnd
        // No onDragCancel
      });

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Cancel
      element.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: 1,
          bubbles: true
        })
      );

      expect(callbacks.onDragEnd).toHaveBeenCalled();
    });

    test('should cancel pending RAF on pointercancel', () => {
      jest.useFakeTimers();
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Move (schedules RAF)
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 160,
          clientY: 210,
          bubbles: true
        })
      );

      expect(controller.rafId).not.toBeNull();

      // Cancel (should cancel RAF)
      element.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: 1,
          bubbles: true
        })
      );

      expect(controller.rafId).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('Cleanup & Destroy', () => {
    test('should remove all listeners on destroy', () => {
      const removeEventListenerSpy = jest.spyOn(element, 'removeEventListener');
      const controller = new DragController(element, callbacks);

      controller.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    test('should cancel pending RAF on destroy', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Move (schedules RAF)
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 160,
          clientY: 210,
          bubbles: true
        })
      );

      expect(controller.rafId).not.toBeNull();

      controller.destroy();

      expect(controller.rafId).toBeNull();
      expect(controller.isDragging).toBe(false);
    });

    test('should reset state on destroy', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      controller.destroy();

      expect(controller.isDragging).toBe(false);
      expect(controller.currentPointerId).toBeNull();
    });
  });
});
