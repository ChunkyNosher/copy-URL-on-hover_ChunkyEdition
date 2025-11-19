/**
 * Tests for PanelDragController Component
 * Phase 2.10 - Manager Panel UI Refactoring
 * @jest-environment jsdom
 */

import { PanelDragController } from '../../../src/features/quick-tabs/panel/PanelDragController.js';

describe('PanelDragController', () => {
  let panel;
  let handle;
  let callbacks;

  beforeEach(() => {
    // Create mock panel element
    panel = document.createElement('div');
    panel.getBoundingClientRect = jest.fn(() => ({
      left: 100,
      top: 150,
      width: 350,
      height: 500
    }));

    // Create mock handle element
    handle = document.createElement('div');
    handle.classList.add('panel-header');

    // Mock Pointer Events API methods
    handle.setPointerCapture = jest.fn();
    handle.releasePointerCapture = jest.fn();

    panel.appendChild(handle);
    document.body.appendChild(panel);

    // Mock callbacks
    callbacks = {
      onDragEnd: jest.fn(),
      onBroadcast: jest.fn()
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  describe('Constructor & Initialization', () => {
    it('should initialize with panel, handle, and callbacks', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      expect(controller.panel).toBe(panel);
      expect(controller.handle).toBe(handle);
      expect(controller.onDragEnd).toBe(callbacks.onDragEnd);
      expect(controller.onBroadcast).toBe(callbacks.onBroadcast);
    });

    it('should initialize with null callbacks when none provided', () => {
      const controller = new PanelDragController(panel, handle);

      expect(controller.onDragEnd).toBeNull();
      expect(controller.onBroadcast).toBeNull();
    });

    it('should initialize drag state', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      expect(controller.isDragging).toBe(false);
      expect(controller.currentPointerId).toBeNull();
      expect(controller.offsetX).toBe(0);
      expect(controller.offsetY).toBe(0);
    });

    it('should attach pointer event listeners on construction', () => {
      const addEventListenerSpy = jest.spyOn(handle, 'addEventListener');

      new PanelDragController(panel, handle, callbacks);

      expect(addEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });
  });

  describe('Pointer Down - Start Drag', () => {
    it('should start drag on left button pointerdown', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      const pointerEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      handle.dispatchEvent(pointerEvent);

      expect(controller.isDragging).toBe(true);
      expect(controller.currentPointerId).toBe(1);
    });

    it('should ignore non-left button clicks', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      const rightClick = new PointerEvent('pointerdown', {
        button: 2,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      handle.dispatchEvent(rightClick);

      expect(controller.isDragging).toBe(false);
    });

    it('should ignore clicks on panel buttons', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      const button = document.createElement('button');
      button.classList.add('panel-btn');
      handle.appendChild(button);

      const pointerEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      Object.defineProperty(pointerEvent, 'target', { value: button });

      handle.dispatchEvent(pointerEvent);

      expect(controller.isDragging).toBe(false);
    });

    it('should capture pointer on drag start', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const pointerEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      handle.dispatchEvent(pointerEvent);

      expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('should calculate offset from panel position', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      const pointerEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      handle.dispatchEvent(pointerEvent);

      // Panel is at (100, 150), click at (150, 200)
      // Offset should be (50, 50)
      expect(controller.offsetX).toBe(50);
      expect(controller.offsetY).toBe(50);
    });

    it('should set cursor to grabbing', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const pointerEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });

      handle.dispatchEvent(pointerEvent);

      expect(handle.style.cursor).toBe('grabbing');
    });
  });

  describe('Pointer Move - Update Position', () => {
    it('should update panel position during drag', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      // Start drag at (150, 200) with panel at (100, 150)
      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      // Move to (200, 250)
      const moveEvent = new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 200,
        clientY: 250,
        bubbles: true
      });
      handle.dispatchEvent(moveEvent);

      // New position should be (200 - 50, 250 - 50) = (150, 200)
      expect(panel.style.left).toBe('150px');
      expect(panel.style.top).toBe('200px');
    });

    it('should not update position when not dragging', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const moveEvent = new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 200,
        clientY: 250,
        bubbles: true
      });
      handle.dispatchEvent(moveEvent);

      // Position should not change
      expect(panel.style.left).toBe('');
      expect(panel.style.top).toBe('');
    });

    it('should ignore pointermove from different pointer', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      // Start drag with pointer 1
      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const initialLeft = panel.style.left;
      const initialTop = panel.style.top;

      // Try to move with pointer 2
      const moveEvent = new PointerEvent('pointermove', {
        pointerId: 2,
        clientX: 300,
        clientY: 350,
        bubbles: true
      });
      handle.dispatchEvent(moveEvent);

      // Position should not change
      expect(panel.style.left).toBe(initialLeft);
      expect(panel.style.top).toBe(initialTop);
    });
  });

  describe('Pointer Up - End Drag', () => {
    it('should end drag on pointerup', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      // Start drag
      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      // End drag
      const upEvent = new PointerEvent('pointerup', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(upEvent);

      expect(controller.isDragging).toBe(false);
    });

    it('should release pointer capture', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const upEvent = new PointerEvent('pointerup', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(upEvent);

      expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('should reset cursor to grab', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const upEvent = new PointerEvent('pointerup', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(upEvent);

      expect(handle.style.cursor).toBe('grab');
    });

    it('should call onDragEnd callback with final position', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const upEvent = new PointerEvent('pointerup', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(upEvent);

      expect(callbacks.onDragEnd).toHaveBeenCalledWith(100, 150);
    });

    it('should call onBroadcast callback with final position', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const upEvent = new PointerEvent('pointerup', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(upEvent);

      expect(callbacks.onBroadcast).toHaveBeenCalledWith({ left: 100, top: 150 });
    });

    it('should ignore pointerup from different pointer', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      // Try to end with different pointer
      const upEvent = new PointerEvent('pointerup', {
        pointerId: 2,
        bubbles: true
      });
      handle.dispatchEvent(upEvent);

      // Should still be dragging
      expect(controller.isDragging).toBe(true);
    });
  });

  describe('Pointer Cancel - Drag Interrupted', () => {
    it('should handle pointercancel gracefully', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const cancelEvent = new PointerEvent('pointercancel', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(cancelEvent);

      expect(controller.isDragging).toBe(false);
      expect(handle.style.cursor).toBe('grab');
    });

    it('should save position on cancel', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const startEvent = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 200,
        bubbles: true
      });
      handle.dispatchEvent(startEvent);

      const cancelEvent = new PointerEvent('pointercancel', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(cancelEvent);

      expect(callbacks.onDragEnd).toHaveBeenCalledWith(100, 150);
    });

    it('should not trigger cancel when not dragging', () => {
      const controller = new PanelDragController(panel, handle, callbacks);  // eslint-disable-line no-unused-vars

      const cancelEvent = new PointerEvent('pointercancel', {
        pointerId: 1,
        bubbles: true
      });
      handle.dispatchEvent(cancelEvent);

      // Should not call callback
      expect(callbacks.onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe('Destroy', () => {
    it('should remove all event listeners', () => {
      const controller = new PanelDragController(panel, handle, callbacks);
      const removeEventListenerSpy = jest.spyOn(handle, 'removeEventListener');

      controller.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    it('should clear all references', () => {
      const controller = new PanelDragController(panel, handle, callbacks);

      controller.destroy();

      expect(controller.panel).toBeNull();
      expect(controller.handle).toBeNull();
      expect(controller.onDragEnd).toBeNull();
      expect(controller.onBroadcast).toBeNull();
    });
  });
});
