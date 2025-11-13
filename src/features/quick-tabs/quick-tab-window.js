/**
 * Quick Tab Window Component
 * Handles creation, rendering, and lifecycle of individual Quick Tab overlay windows
 * 
 * v1.5.9.0 - Restored missing UI logic identified in v1589-quick-tabs-root-cause.md
 */

import { createElement } from '../../utils/dom.js';
import { CONSTANTS } from '../../core/config.js';

/**
 * QuickTabWindow class - Manages a single Quick Tab overlay instance
 */
export class QuickTabWindow {
  constructor(options) {
    this.id = options.id;
    this.url = options.url;
    this.left = options.left || 100;
    this.top = options.top || 100;
    this.width = options.width || 800;
    this.height = options.height || 600;
    this.title = options.title || 'Quick Tab';
    this.cookieStoreId = options.cookieStoreId || 'firefox-default';
    this.minimized = options.minimized || false;
    this.zIndex = options.zIndex || CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
    
    this.container = null;
    this.iframe = null;
    this.isDragging = false;
    this.isResizing = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.resizeStartWidth = 0;
    this.resizeStartHeight = 0;
    
    this.onDestroy = options.onDestroy || (() => {});
    this.onMinimize = options.onMinimize || (() => {});
    this.onFocus = options.onFocus || (() => {});
  }

  /**
   * Create and render the Quick Tab window
   */
  render() {
    if (this.container) {
      console.warn('[QuickTabWindow] Already rendered:', this.id);
      return this.container;
    }

    // Create main container
    this.container = createElement('div', {
      id: `quick-tab-${this.id}`,
      className: 'quick-tab-window',
      style: {
        position: 'fixed',
        left: `${this.left}px`,
        top: `${this.top}px`,
        width: `${this.width}px`,
        height: `${this.height}px`,
        zIndex: this.zIndex.toString(),
        backgroundColor: '#1e1e1e',
        border: '2px solid #444',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        display: this.minimized ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s'
      }
    });

    // Create titlebar
    const titlebar = this.createTitlebar();
    this.container.appendChild(titlebar);

    // Create iframe content area
    this.iframe = createElement('iframe', {
      src: this.url,
      style: {
        flex: '1',
        border: 'none',
        width: '100%',
        height: 'calc(100% - 40px)'
      },
      sandbox: 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
    });

    this.container.appendChild(this.iframe);

    // Add to document
    document.body.appendChild(this.container);

    // Setup interactions
    this.setupDragHandlers(titlebar);
    this.setupResizeHandlers();
    this.setupFocusHandlers();

    console.log('[QuickTabWindow] Rendered:', this.id);
    return this.container;
  }

  /**
   * Create titlebar with controls
   */
  createTitlebar() {
    const titlebar = createElement('div', {
      className: 'quick-tab-titlebar',
      style: {
        height: '40px',
        backgroundColor: '#2d2d2d',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        cursor: 'move',
        userSelect: 'none'
      }
    });

    // Title text
    const titleText = createElement('div', {
      className: 'quick-tab-title',
      style: {
        color: '#fff',
        fontSize: '14px',
        fontWeight: 'bold',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: '1'
      }
    }, this.title);

    // Control buttons container
    const controls = createElement('div', {
      style: {
        display: 'flex',
        gap: '8px'
      }
    });

    // Minimize button
    const minimizeBtn = this.createButton('_', () => this.minimize());
    controls.appendChild(minimizeBtn);

    // Close button
    const closeBtn = this.createButton('×', () => this.destroy());
    controls.appendChild(closeBtn);

    titlebar.appendChild(titleText);
    titlebar.appendChild(controls);

    return titlebar;
  }

  /**
   * Create a control button
   */
  createButton(text, onClick) {
    const button = createElement('button', {
      style: {
        width: '24px',
        height: '24px',
        backgroundColor: 'transparent',
        border: '1px solid #666',
        borderRadius: '4px',
        color: '#fff',
        fontSize: '16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0',
        transition: 'background-color 0.2s'
      }
    }, text);

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#444';
    });

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = 'transparent';
    });

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });

    return button;
  }

  /**
   * Setup drag handlers using Pointer Events API
   */
  setupDragHandlers(titlebar) {
    titlebar.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      
      this.isDragging = true;
      this.dragStartX = e.clientX - this.left;
      this.dragStartY = e.clientY - this.top;
      
      titlebar.setPointerCapture(e.pointerId);
      
      this.onFocus(this.id);
    });

    titlebar.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      
      this.left = e.clientX - this.dragStartX;
      this.top = e.clientY - this.dragStartY;
      
      this.container.style.left = `${this.left}px`;
      this.container.style.top = `${this.top}px`;
    });

    titlebar.addEventListener('pointerup', (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        titlebar.releasePointerCapture(e.pointerId);
      }
    });

    titlebar.addEventListener('pointercancel', (e) => {
      this.isDragging = false;
    });
  }

  /**
   * Setup resize handlers
   */
  setupResizeHandlers() {
    const resizeHandle = createElement('div', {
      className: 'quick-tab-resize-handle',
      style: {
        position: 'absolute',
        bottom: '0',
        right: '0',
        width: '16px',
        height: '16px',
        cursor: 'se-resize',
        backgroundColor: 'transparent'
      }
    });

    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.isResizing = true;
      this.resizeStartWidth = this.width;
      this.resizeStartHeight = this.height;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      
      resizeHandle.setPointerCapture(e.pointerId);
    });

    resizeHandle.addEventListener('pointermove', (e) => {
      if (!this.isResizing) return;
      
      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;
      
      this.width = Math.max(400, this.resizeStartWidth + deltaX);
      this.height = Math.max(300, this.resizeStartHeight + deltaY);
      
      this.container.style.width = `${this.width}px`;
      this.container.style.height = `${this.height}px`;
    });

    resizeHandle.addEventListener('pointerup', (e) => {
      if (this.isResizing) {
        this.isResizing = false;
        resizeHandle.releasePointerCapture(e.pointerId);
      }
    });

    resizeHandle.addEventListener('pointercancel', (e) => {
      this.isResizing = false;
    });

    this.container.appendChild(resizeHandle);
  }

  /**
   * Setup focus handlers
   */
  setupFocusHandlers() {
    this.container.addEventListener('mousedown', () => {
      this.onFocus(this.id);
    });
  }

  /**
   * Minimize the Quick Tab window
   */
  minimize() {
    this.minimized = true;
    this.container.style.display = 'none';
    this.onMinimize(this.id);
    console.log('[QuickTabWindow] Minimized:', this.id);
  }

  /**
   * Restore minimized Quick Tab window
   */
  restore() {
    this.minimized = false;
    this.container.style.display = 'flex';
    this.onFocus(this.id);
    console.log('[QuickTabWindow] Restored:', this.id);
  }

  /**
   * Update z-index for stacking
   */
  updateZIndex(newZIndex) {
    this.zIndex = newZIndex;
    if (this.container) {
      this.container.style.zIndex = newZIndex.toString();
    }
  }

  /**
   * Destroy the Quick Tab window
   */
  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.iframe = null;
    }
    this.onDestroy(this.id);
    console.log('[QuickTabWindow] Destroyed:', this.id);
  }

  /**
   * Get current state for persistence
   */
  getState() {
    return {
      id: this.id,
      url: this.url,
      left: this.left,
      top: this.top,
      width: this.width,
      height: this.height,
      title: this.title,
      cookieStoreId: this.cookieStoreId,
      minimized: this.minimized,
      zIndex: this.zIndex
    };
  }
}

/**
 * Create a Quick Tab window
 * @param {Object} options - Quick Tab configuration
 * @returns {QuickTabWindow} The created Quick Tab window instance
 */
export function createQuickTabWindow(options) {
  const window = new QuickTabWindow(options);
  window.render();
  return window;
}
