/**
 * DragController - Handles drag operations with proper mouse tracking
 *
 * Prevents "slipping" on high-refresh monitors by using requestAnimationFrame
 * and tracking actual mouse position. Extracted from QuickTabWindow.js as part
 * of v1.6.0 Phase 2.9 refactoring.
 *
 * @see docs/misc/v1.6.0-REFACTORING-PHASE3.3-NEXT-STEPS.md
 */

export class DragController {
  /**
   * Create a drag controller
   * @param {HTMLElement} element - Element to make draggable
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onDragStart - Called when drag starts (x, y)
   * @param {Function} callbacks.onDrag - Called during drag (x, y)
   * @param {Function} callbacks.onDragEnd - Called when drag ends (x, y)
   */
  constructor(element, callbacks = {}) {
    this.element = element;
    this.onDragStart = callbacks.onDragStart || null;
    this.onDrag = callbacks.onDrag || null;
    this.onDragEnd = callbacks.onDragEnd || null;

    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.elementStartX = 0;
    this.elementStartY = 0;
    this.rafId = null;

    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);

    this.attach();
  }

  /**
   * Attach drag listeners
   */
  attach() {
    this.element.addEventListener('mousedown', this.boundHandleMouseDown);
  }

  /**
   * Handle mouse down - start drag
   * @param {MouseEvent} e
   */
  handleMouseDown(e) {
    // Only left mouse button
    if (e.button !== 0) return;

    // Don't drag if clicking on button or other interactive element
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
      return;
    }

    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;

    const rect = this.element.parentElement.getBoundingClientRect();
    this.elementStartX = rect.left;
    this.elementStartY = rect.top;

    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);

    if (this.onDragStart) {
      this.onDragStart(this.elementStartX, this.elementStartY);
    }

    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Handle mouse move - update position
   * Uses requestAnimationFrame to prevent slipping on high-refresh monitors
   * @param {MouseEvent} e
   */
  handleMouseMove(e) {
    if (!this.isDragging) return;

    // Use requestAnimationFrame to prevent slipping on high-refresh monitors
    if (this.rafId) return;

    this.rafId = requestAnimationFrame(() => {
      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;

      const newX = this.elementStartX + deltaX;
      const newY = this.elementStartY + deltaY;

      if (this.onDrag) {
        this.onDrag(newX, newY);
      }

      this.rafId = null;
    });
  }

  /**
   * Handle mouse up - end drag
   * @param {MouseEvent} e
   */
  handleMouseUp(e) {
    if (!this.isDragging) return;

    this.isDragging = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);

    // Call onDragEnd with the final position
    // We calculate it from the current mouse position and the drag start
    if (this.onDragEnd) {
      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;
      const finalX = this.elementStartX + deltaX;
      const finalY = this.elementStartY + deltaY;
      
      this.onDragEnd(finalX, finalY);
    }
  }

  /**
   * Detach drag listeners and cleanup
   */
  destroy() {
    this.element.removeEventListener('mousedown', this.boundHandleMouseDown);
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    this.isDragging = false;
  }
}
