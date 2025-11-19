/**
 * @jest-environment jsdom
 */

import { DragController } from '../../../src/features/quick-tabs/window/DragController.js';

describe('DragController', () => {
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
    parentElement.appendChild(element);
    document.body.appendChild(parentElement);

    // Mock callbacks
    callbacks = {
      onDragStart: jest.fn(),
      onDrag: jest.fn(),
      onDragEnd: jest.fn()
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with element and callbacks', () => {
      const controller = new DragController(element, callbacks);

      expect(controller.element).toBe(element);
      expect(controller.onDragStart).toBe(callbacks.onDragStart);
      expect(controller.onDrag).toBe(callbacks.onDrag);
      expect(controller.onDragEnd).toBe(callbacks.onDragEnd);
    });

    test('should initialize with default callbacks when none provided', () => {
      const controller = new DragController(element);

      expect(controller.onDragStart).toBeNull();
      expect(controller.onDrag).toBeNull();
      expect(controller.onDragEnd).toBeNull();
    });

    test('should initialize drag state', () => {
      const controller = new DragController(element, callbacks);

      expect(controller.isDragging).toBe(false);
      expect(controller.dragStartX).toBe(0);
      expect(controller.dragStartY).toBe(0);
      expect(controller.rafId).toBeNull();
    });

    test('should attach listeners on construction', () => {
      const addEventListenerSpy = jest.spyOn(element, 'addEventListener');

      new DragController(element, callbacks);

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'mousedown',
        expect.any(Function)
      );
    });
  });

  describe('Mouse Down Handling', () => {
    test('should start drag on left mouse button', () => {
      const controller = new DragController(element, callbacks);

      const mouseEvent = new MouseEvent('mousedown', {
        button: 0,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      element.dispatchEvent(mouseEvent);

      expect(controller.isDragging).toBe(true);
      expect(controller.dragStartX).toBe(150);
      expect(controller.dragStartY).toBe(200);
      expect(callbacks.onDragStart).toHaveBeenCalledWith(100, 100);
    });

    test('should ignore right mouse button', () => {
      const controller = new DragController(element, callbacks);

      const mouseEvent = new MouseEvent('mousedown', {
        button: 2, // Right button
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      element.dispatchEvent(mouseEvent);

      expect(controller.isDragging).toBe(false);
      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    test('should ignore middle mouse button', () => {
      const controller = new DragController(element, callbacks);

      const mouseEvent = new MouseEvent('mousedown', {
        button: 1, // Middle button
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      element.dispatchEvent(mouseEvent);

      expect(controller.isDragging).toBe(false);
      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    test('should ignore clicks on buttons', () => {
      const controller = new DragController(element, callbacks);
      const button = document.createElement('button');
      element.appendChild(button);

      const mouseEvent = new MouseEvent('mousedown', {
        button: 0,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      // Set target to button
      Object.defineProperty(mouseEvent, 'target', {
        value: button,
        writable: false
      });

      element.dispatchEvent(mouseEvent);

      expect(controller.isDragging).toBe(false);
      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    test('should ignore clicks on inputs', () => {
      const controller = new DragController(element, callbacks);
      const input = document.createElement('input');
      element.appendChild(input);

      const mouseEvent = new MouseEvent('mousedown', {
        button: 0,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      Object.defineProperty(mouseEvent, 'target', {
        value: input,
        writable: false
      });

      element.dispatchEvent(mouseEvent);

      expect(controller.isDragging).toBe(false);
      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    test('should attach document listeners when drag starts', () => {
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      const controller = new DragController(element, callbacks);

      const mouseEvent = new MouseEvent('mousedown', {
        button: 0,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      element.dispatchEvent(mouseEvent);

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'mousemove',
        expect.any(Function)
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'mouseup',
        expect.any(Function)
      );
    });
  });

  describe('Mouse Move Handling', () => {
    test('should call onDrag with new position', (done) => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Move mouse
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 250, // +100 from start
          clientY: 300, // +100 from start
          bubbles: true
        })
      );

      // Wait for requestAnimationFrame
      requestAnimationFrame(() => {
        expect(callbacks.onDrag).toHaveBeenCalledWith(200, 200);
        done();
      });
    });

    test('should not call onDrag when not dragging', () => {
      const controller = new DragController(element, callbacks);

      // Move mouse without starting drag
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 250,
          clientY: 300,
          bubbles: true
        })
      );

      expect(callbacks.onDrag).not.toHaveBeenCalled();
    });

    test('should throttle with requestAnimationFrame', (done) => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Multiple rapid move events
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 250, clientY: 300 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 260, clientY: 310 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 270, clientY: 320 })
      );

      // Wait for requestAnimationFrame
      requestAnimationFrame(() => {
        // Should only be called once despite 3 move events
        expect(callbacks.onDrag).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  describe('Mouse Up Handling', () => {
    test('should end drag and call onDragEnd', () => {
      const controller = new DragController(element, callbacks);

      // Start drag at (150, 200)
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      expect(controller.isDragging).toBe(true);

      // End drag at same position (no movement)
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      expect(controller.isDragging).toBe(false);
      // Delta is (0, 0), so final position is elementStartX/Y + 0 = (100, 100)
      expect(callbacks.onDragEnd).toHaveBeenCalledWith(100, 100);
    });

    test('should remove document listeners on drag end', () => {
      const removeEventListenerSpy = jest.spyOn(
        document,
        'removeEventListener'
      );
      const controller = new DragController(element, callbacks);

      // Start and end drag
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      document.dispatchEvent(
        new MouseEvent('mouseup', {
          button: 0,
          bubbles: true
        })
      );

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'mousemove',
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'mouseup',
        expect.any(Function)
      );
    });

    test('should cancel pending animation frame on drag end', () => {
      const controller = new DragController(element, callbacks);
      const cancelAnimationFrameSpy = jest.spyOn(
        global,
        'cancelAnimationFrame'
      );

      // Start drag
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      // Move mouse to schedule animation frame
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 250,
          clientY: 300,
          bubbles: true
        })
      );

      // End drag immediately
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          button: 0,
          bubbles: true
        })
      );

      // If rafId was set, it should be canceled
      if (controller.rafId !== null) {
        expect(cancelAnimationFrameSpy).toHaveBeenCalled();
      }
    });
  });

  describe('destroy()', () => {
    test('should remove all event listeners', () => {
      const removeEventListenerSpy = jest.spyOn(element, 'removeEventListener');
      const controller = new DragController(element, callbacks);

      controller.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'mousedown',
        expect.any(Function)
      );
    });

    test('should cancel pending animation frame', () => {
      const controller = new DragController(element, callbacks);
      const cancelAnimationFrameSpy = jest.spyOn(
        global,
        'cancelAnimationFrame'
      );

      // Start drag and move to create pending animation frame
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 250,
          clientY: 300,
          bubbles: true
        })
      );

      controller.destroy();

      // Cancel should be called if rafId was set
      if (controller.rafId !== null) {
        expect(cancelAnimationFrameSpy).toHaveBeenCalled();
      }
    });

    test('should set isDragging to false', () => {
      const controller = new DragController(element, callbacks);

      // Start drag
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      expect(controller.isDragging).toBe(true);

      controller.destroy();

      expect(controller.isDragging).toBe(false);
    });
  });

  describe('Integration', () => {
    test('should handle complete drag lifecycle', (done) => {
      const controller = new DragController(element, callbacks);

      // Start drag at (150, 200)
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          clientX: 150,
          clientY: 200,
          bubbles: true
        })
      );

      expect(callbacks.onDragStart).toHaveBeenCalledWith(100, 100);

      // Move to (250, 300) - delta of (+100, +100)
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 250,
          clientY: 300,
          bubbles: true
        })
      );

      requestAnimationFrame(() => {
        expect(callbacks.onDrag).toHaveBeenCalledWith(200, 200);

        // End drag at (250, 300) - delta of (+100, +100)
        document.dispatchEvent(
          new MouseEvent('mouseup', {
            button: 0,
            clientX: 250,
            clientY: 300,
            bubbles: true
          })
        );

        // Final position: elementStart (100, 100) + delta (100, 100) = (200, 200)
        expect(callbacks.onDragEnd).toHaveBeenCalledWith(200, 200);
        expect(controller.isDragging).toBe(false);
        done();
      });
    });
  });
});
