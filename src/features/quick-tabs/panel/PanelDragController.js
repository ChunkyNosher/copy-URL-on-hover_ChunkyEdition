/**
 * PanelDragController Component
 * Handles drag operations for the Quick Tabs Manager Panel using Pointer Events API
 *
 * Extracted from panel.js as part of Phase 2.10 refactoring
 * Based on window/DragController.js pattern from Phase 2.9
 *
 * Responsibilities:
 * - Handle panel dragging via header/drag handle
 * - Use Pointer Events API (pointerdown/move/up/cancel)
 * - Update panel position during drag
 * - Save state and broadcast position on drag end
 * - Handle drag cancellation gracefully
 *
 * v1.6.0 - Phase 2.10: Extracted drag logic from PanelManager
 */

export class PanelDragController {
  /**
   * Create a drag controller for the panel
   * @param {HTMLElement} panel - Panel element
   * @param {HTMLElement} handle - Drag handle element (usually panel header)
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onDragEnd - Called when drag ends (left, top)
   * @param {Function} callbacks.onBroadcast - Called to broadcast position updates
   */
  constructor(panel, handle, callbacks = {}) {
    this.panel = panel;
    this.handle = handle;
    this.onDragEnd = callbacks.onDragEnd || null;
    this.onBroadcast = callbacks.onBroadcast || null;

    this.isDragging = false;
    this.currentPointerId = null;
    this.offsetX = 0;
    this.offsetY = 0;

    this._setupEventListeners();
  }

  /**
   * Setup drag event listeners on handle
   * @private
   */
  _setupEventListeners() {
    this.handle.addEventListener('pointerdown', this._handlePointerDown.bind(this));
    this.handle.addEventListener('pointermove', this._handlePointerMove.bind(this));
    this.handle.addEventListener('pointerup', this._handlePointerUp.bind(this));
    this.handle.addEventListener('pointercancel', this._handlePointerCancel.bind(this));
  }

  /**
   * Handle pointer down - start drag
   * @param {PointerEvent} e - Pointer event
   * @private
   */
  _handlePointerDown(e) {
    // Only left click
    if (e.button !== 0) return;

    // Ignore clicks on buttons
    if (e.target.classList.contains('panel-btn')) return;

    this.isDragging = true;
    this.currentPointerId = e.pointerId;

    // Capture pointer
    this.handle.setPointerCapture(e.pointerId);

    // Calculate offset from panel position
    const rect = this.panel.getBoundingClientRect();
    this.offsetX = e.clientX - rect.left;
    this.offsetY = e.clientY - rect.top;

    // Visual feedback
    this.handle.style.cursor = 'grabbing';

    e.preventDefault();
  }

  /**
   * Handle pointer move - update position
   * @param {PointerEvent} e - Pointer event
   * @private
   */
  _handlePointerMove(e) {
    if (!this.isDragging || e.pointerId !== this.currentPointerId) return;

    // Calculate new position
    const newLeft = e.clientX - this.offsetX;
    const newTop = e.clientY - this.offsetY;

    // Apply position
    this.panel.style.left = `${newLeft}px`;
    this.panel.style.top = `${newTop}px`;

    e.preventDefault();
  }

  /**
   * Handle pointer up - end drag
   * @param {PointerEvent} e - Pointer event
   * @private
   */
  _handlePointerUp(e) {
    if (!this.isDragging || e.pointerId !== this.currentPointerId) return;

    this.isDragging = false;
    this.handle.releasePointerCapture(e.pointerId);
    this.handle.style.cursor = 'grab';

    // Get final position
    const rect = this.panel.getBoundingClientRect();
    const finalLeft = rect.left;
    const finalTop = rect.top;

    // Save final position
    if (this.onDragEnd) {
      this.onDragEnd(finalLeft, finalTop);
    }

    // Broadcast position to other tabs
    if (this.onBroadcast) {
      this.onBroadcast({ left: finalLeft, top: finalTop });
    }
  }

  /**
   * Handle pointer cancel - drag interrupted
   * @param {PointerEvent} _e - Pointer event
   * @private
   */
  _handlePointerCancel(_e) {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.handle.style.cursor = 'grab';

    // Save position even though drag was cancelled
    const rect = this.panel.getBoundingClientRect();
    if (this.onDragEnd) {
      this.onDragEnd(rect.left, rect.top);
    }
  }

  /**
   * Destroy controller and clean up
   */
  destroy() {
    // Remove event listeners
    this.handle.removeEventListener('pointerdown', this._handlePointerDown);
    this.handle.removeEventListener('pointermove', this._handlePointerMove);
    this.handle.removeEventListener('pointerup', this._handlePointerUp);
    this.handle.removeEventListener('pointercancel', this._handlePointerCancel);

    // Clear references
    this.panel = null;
    this.handle = null;
    this.onDragEnd = null;
    this.onBroadcast = null;
  }
}
