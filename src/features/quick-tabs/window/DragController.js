/**
 * DragController - Handles drag operations using Pointer Events API
 *
 * Uses Pointer Events API (pointerdown/pointermove/pointerup/pointercancel) instead
 * of Mouse Events to support Issue #51 fix (handling tab switch during drag).
 * The pointercancel event is critical for saving state when drag is interrupted.
 *
 * Prevents "slipping" on high-refresh monitors by using requestAnimationFrame
 * and tracking actual pointer position. Extracted from QuickTabWindow.js as part
 * of v1.6.0 Phase 2.9 refactoring.
 *
 * v1.6.4.7 - FIX Issue #5: Add destroyed flag to prevent ghost events after cleanup
 *
 * @see docs/misc/v1.6.0-REFACTORING-PHASE3.4-NEXT-STEPS.md
 */

export class DragController {
  /**
   * Create a drag controller
   * @param {HTMLElement} element - Element to make draggable
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onDragStart - Called when drag starts (x, y)
   * @param {Function} callbacks.onDrag - Called during drag (newX, newY)
   * @param {Function} callbacks.onDragEnd - Called when drag ends (finalX, finalY)
   * @param {Function} callbacks.onDragCancel - Called when drag is cancelled (lastX, lastY)
   */
  constructor(element, callbacks = {}) {
    this.element = element;
    this.onDragStart = callbacks.onDragStart || null;
    this.onDrag = callbacks.onDrag || null;
    this.onDragEnd = callbacks.onDragEnd || null;
    this.onDragCancel = callbacks.onDragCancel || null;

    this.isDragging = false;
    this.destroyed = false; // v1.6.4.7 - FIX Issue #5: Track destroyed state
    this.currentPointerId = null;
    this.offsetX = 0;
    this.offsetY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.rafId = null;

    this.boundHandlePointerDown = this.handlePointerDown.bind(this);
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandlePointerUp = this.handlePointerUp.bind(this);
    this.boundHandlePointerCancel = this.handlePointerCancel.bind(this);

    this.attach();
  }

  /**
   * Attach drag listeners
   */
  attach() {
    this.element.addEventListener('pointerdown', this.boundHandlePointerDown);
    this.element.addEventListener('pointermove', this.boundHandlePointerMove);
    this.element.addEventListener('pointerup', this.boundHandlePointerUp);
    this.element.addEventListener('pointercancel', this.boundHandlePointerCancel);
  }

  /**
   * Handle pointer down - start drag
   * v1.6.4.7 - FIX Issue #5: Check destroyed flag to prevent ghost events
   * @param {PointerEvent} e
   */
  handlePointerDown(e) {
    // v1.6.4.7 - FIX Issue #5: Prevent ghost events after destroy
    if (this.destroyed) return;

    // Don't drag if clicking on button or other interactive element
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
      return;
    }

    this.isDragging = true;
    this.currentPointerId = e.pointerId;

    // Calculate offset from current element position
    const rect = this.element.parentElement.getBoundingClientRect();
    this.currentX = rect.left;
    this.currentY = rect.top;
    this.offsetX = e.clientX - this.currentX;
    this.offsetY = e.clientY - this.currentY;

    // Capture pointer events
    this.element.setPointerCapture(e.pointerId);

    if (this.onDragStart) {
      this.onDragStart(this.currentX, this.currentY);
    }
  }

  /**
   * Handle pointer move - update position
   * Uses requestAnimationFrame to prevent slipping on high-refresh monitors
   * v1.6.4.7 - FIX Issue #5: Check destroyed flag to prevent ghost events
   * @param {PointerEvent} e
   */
  handlePointerMove(e) {
    // v1.6.4.7 - FIX Issue #5: Prevent ghost events after destroy
    if (this.destroyed) return;
    if (!this.isDragging) return;

    // Use requestAnimationFrame to prevent excessive updates
    if (this.rafId) return;

    this.rafId = requestAnimationFrame(() => {
      // v1.6.4.7 - FIX Issue #5: Double-check destroyed in RAF callback
      if (this.destroyed) {
        this.rafId = null;
        return;
      }

      const newX = e.clientX - this.offsetX;
      const newY = e.clientY - this.offsetY;

      this.currentX = newX;
      this.currentY = newY;

      if (this.onDrag) {
        this.onDrag(newX, newY);
      }

      this.rafId = null;
    });
  }

  /**
   * Handle pointer up - end drag
   * v1.6.4.7 - FIX Issue #5: Check destroyed flag to prevent ghost events
   * @param {PointerEvent} e
   */
  handlePointerUp(e) {
    // v1.6.4.7 - FIX Issue #5: Prevent ghost events after destroy
    if (this.destroyed) return;
    if (!this.isDragging) return;

    this.isDragging = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Release pointer capture
    if (this.currentPointerId !== null) {
      this.element.releasePointerCapture(this.currentPointerId);
      this.currentPointerId = null;
    }

    // Calculate final position
    const finalX = e.clientX - this.offsetX;
    const finalY = e.clientY - this.offsetY;

    if (this.onDragEnd) {
      this.onDragEnd(finalX, finalY);
    }
  }

  /**
   * Handle pointer cancel - CRITICAL FOR ISSUE #51
   * This fires when drag is interrupted (e.g., user switches tabs during drag)
   * v1.6.4.7 - FIX Issue #5: Check destroyed flag to prevent ghost events
   * @param {PointerEvent} _e
   */
  handlePointerCancel(_e) {
    // v1.6.4.7 - FIX Issue #5: Prevent ghost events after destroy
    if (this.destroyed) return;
    if (!this.isDragging) return;

    this.isDragging = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Call onDragCancel with last known position (or onDragEnd as fallback)
    const callback = this.onDragCancel || this.onDragEnd;
    if (callback) {
      callback(this.currentX, this.currentY);
    }

    this.currentPointerId = null;
  }

  /**
   * Detach drag listeners and cleanup
   * v1.6.4.7 - FIX Issue #5: Set destroyed flag FIRST to prevent ghost events
   */
  destroy() {
    // v1.6.4.7 - FIX Issue #5: Set destroyed flag FIRST
    this.destroyed = true;

    this.element.removeEventListener('pointerdown', this.boundHandlePointerDown);
    this.element.removeEventListener('pointermove', this.boundHandlePointerMove);
    this.element.removeEventListener('pointerup', this.boundHandlePointerUp);
    this.element.removeEventListener('pointercancel', this.boundHandlePointerCancel);

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.isDragging = false;
    this.currentPointerId = null;
  }
}
