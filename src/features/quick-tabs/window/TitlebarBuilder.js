/**
 * TitlebarBuilder Component - v1.6.0 Phase 2.9 Task 4
 *
 * Extracted from QuickTabWindow.createTitlebar() (157 lines, cc unknown)
 * Follows facade pattern used by ResizeController and DragController
 *
 * Responsibilities:
 * - Build titlebar with left section (navigation + favicon + title)
 * - Build control buttons (minimize/close)
 * - Manage button state updates
 * - Handle button event delegation
 *
 * v1.6.4 - Removed Solo/Mute functionality
 *
 * @created 2025-11-19
 * @refactoring Phase 2.9 Task 4
 */

import { createElement } from '../../../utils/dom.js';

/**
 * TitlebarBuilder - Builds and manages Quick Tab titlebar
 *
 * Follows facade pattern - encapsulates titlebar creation logic
 * that was previously in QuickTabWindow.createTitlebar()
 */
export class TitlebarBuilder {
  /**
   * @param {Object} config - Titlebar configuration
   * @param {string} config.id - Quick Tab unique ID (for debug display)
   * @param {string} config.title - Initial title text
   * @param {string} config.url - URL for favicon extraction
   * @param {number} config.currentTabId - Current tab ID
   * @param {HTMLIFrameElement} config.iframe - Iframe element for navigation/zoom
   * @param {boolean} config.showDebugId - Whether to display Quick Tab ID in titlebar
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onClose - Close button clicked
   * @param {Function} callbacks.onMinimize - Minimize button clicked
   * @param {Function} callbacks.onOpenInTab - Open in tab button clicked
   */
  constructor(config, callbacks) {
    this.config = config;
    this.callbacks = callbacks;

    // DOM element references (public for window.js access)
    this.titlebar = null;
    this.titleElement = null;
    this.faviconElement = null;
    this.debugIdElement = null; // v1.6.3.2 - Debug ID display element
    this.controlsContainer = null; // v1.6.3.4-v9 - Controls container for dynamic updates

    // Zoom state (internal to titlebar)
    this.currentZoom = 100;
    this.zoomDisplay = null;
  }

  /**
   * Build and return the complete titlebar element
   * @returns {HTMLElement} The titlebar DOM element
   */
  build() {
    this.titlebar = this._createContainer();

    // Build sections
    const leftSection = this._createLeftSection();
    const controls = this._createRightSection();

    this.titlebar.appendChild(leftSection);
    this.titlebar.appendChild(controls);

    return this.titlebar;
  }

  /**
   * Update title text dynamically
   * @param {string} newTitle - New title text
   */
  updateTitle(newTitle) {
    if (this.titleElement) {
      this.titleElement.textContent = newTitle;
    }
  }

  /**
   * Update debug ID display dynamically
   * v1.6.3.4-v9 - FIX Issue #4: Dynamic titlebar updates when settings change
   * @param {boolean} showDebugId - Whether to show debug ID in titlebar
   */
  updateDebugIdDisplay(showDebugId) {
    // Update config for future builds
    this.config.showDebugId = showDebugId;

    if (showDebugId) {
      this._addDebugIdElement();
    } else {
      this._removeDebugIdElement();
    }
  }

  /**
   * Add debug ID element to titlebar if not already present
   * v1.6.3.4-v9 - Extracted to reduce nesting depth
   * v1.6.3.4-v9 - Use stored controlsContainer reference instead of fragile querySelector
   * @private
   */
  _addDebugIdElement() {
    // Skip if already present or no controls container
    if (this.debugIdElement || !this.controlsContainer) {
      if (!this.controlsContainer) {
        console.log(
          '[TitlebarBuilder] Cannot add debug ID - no controls container:',
          this.config.id
        );
      }
      return;
    }

    this.debugIdElement = this._createDebugIdElement();
    if (!this.debugIdElement) {
      // Can happen if config.id is missing or empty
      console.log(
        '[TitlebarBuilder] Debug ID element not created (no ID in config):',
        this.config.id
      );
      return;
    }

    // Insert at beginning of controls container
    if (this.controlsContainer.firstChild) {
      this.controlsContainer.insertBefore(this.debugIdElement, this.controlsContainer.firstChild);
    } else {
      this.controlsContainer.appendChild(this.debugIdElement);
    }
    console.log('[TitlebarBuilder] Added debug ID element dynamically:', this.config.id);
  }

  /**
   * Remove debug ID element from titlebar if present
   * v1.6.3.4-v9 - Extracted to reduce nesting depth
   * @private
   */
  _removeDebugIdElement() {
    if (!this.debugIdElement) return;

    this.debugIdElement.remove();
    this.debugIdElement = null;
    console.log('[TitlebarBuilder] Removed debug ID element dynamically:', this.config.id);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Create titlebar container
   * @private
   */
  _createContainer() {
    return createElement('div', {
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
  }

  /**
   * Create left section with navigation + favicon + title
   * @private
   */
  _createLeftSection() {
    const leftSection = createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        flex: '1',
        overflow: 'hidden',
        gap: '8px'
      }
    });

    // Navigation buttons container
    const navContainer = this._createNavigationButtons();
    leftSection.appendChild(navContainer);

    // Favicon
    this.faviconElement = this._createFavicon();
    leftSection.appendChild(this.faviconElement);

    // Title text
    this.titleElement = this._createTitle();
    leftSection.appendChild(this.titleElement);

    return leftSection;
  }

  /**
   * Create navigation buttons container (back/forward/reload/zoom)
   * @private
   */
  _createNavigationButtons() {
    const navContainer = createElement('div', {
      style: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center'
      }
    });

    this._appendHistoryButtons(navContainer);
    this._appendZoomControls(navContainer);

    return navContainer;
  }

  /**
   * Append history navigation buttons (back/forward/reload)
   * @private
   */
  _appendHistoryButtons(navContainer) {
    // Back button
    const backBtn = this._createButton('←', () => {
      if (this.config.iframe.contentWindow) {
        try {
          this.config.iframe.contentWindow.history.back();
        } catch (err) {
          console.warn('[QuickTab] Cannot navigate back - cross-origin restriction');
        }
      }
    });
    backBtn.title = 'Back';
    navContainer.appendChild(backBtn);

    // Forward button
    const forwardBtn = this._createButton('→', () => {
      if (this.config.iframe.contentWindow) {
        try {
          this.config.iframe.contentWindow.history.forward();
        } catch (err) {
          console.warn('[QuickTab] Cannot navigate forward - cross-origin restriction');
        }
      }
    });
    forwardBtn.title = 'Forward';
    navContainer.appendChild(forwardBtn);

    // Reload button
    const reloadBtn = this._createButton('↻', () => {
      // Proper iframe reload technique (fixes no-self-assign ESLint error)
      const currentSrc = this.config.iframe.src;
      this.config.iframe.src = 'about:blank';
      setTimeout(() => {
        this.config.iframe.src = currentSrc;
      }, 10);
    });
    reloadBtn.title = 'Reload';
    navContainer.appendChild(reloadBtn);
  }

  /**
   * Append zoom controls (zoom out/display/zoom in)
   * @private
   */
  _appendZoomControls(navContainer) {
    // Zoom out button
    const zoomOutBtn = this._createButton('−', () => {
      if (this.currentZoom > 50) {
        this.currentZoom -= 10;
        this._applyZoom(this.currentZoom);
      }
    });
    zoomOutBtn.title = 'Zoom Out';
    navContainer.appendChild(zoomOutBtn);

    // Zoom display
    this.zoomDisplay = createElement(
      'span',
      {
        style: {
          fontSize: '11px',
          color: '#fff',
          minWidth: '38px',
          textAlign: 'center',
          fontWeight: '500'
        }
      },
      '100%'
    );
    navContainer.appendChild(this.zoomDisplay);

    // Zoom in button
    const zoomInBtn = this._createButton('+', () => {
      if (this.currentZoom < 200) {
        this.currentZoom += 10;
        this._applyZoom(this.currentZoom);
      }
    });
    zoomInBtn.title = 'Zoom In';
    navContainer.appendChild(zoomInBtn);
  }

  /**
   * Create favicon element
   * @private
   */
  _createFavicon() {
    const favicon = createElement('img', {
      className: 'quick-tab-favicon',
      style: {
        width: '16px',
        height: '16px',
        marginLeft: '5px',
        marginRight: '5px',
        flexShrink: '0'
      }
    });

    // Extract domain for favicon
    try {
      const urlObj = new URL(this.config.url);
      const GOOGLE_FAVICON_URL = 'https://www.google.com/s2/favicons?domain=';
      favicon.src = `${GOOGLE_FAVICON_URL}${urlObj.hostname}&sz=32`;
      favicon.onerror = () => {
        favicon.style.display = 'none';
      };
    } catch (e) {
      favicon.style.display = 'none';
    }

    return favicon;
  }

  /**
   * Create title text element
   * @private
   */
  _createTitle() {
    return createElement(
      'div',
      {
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
      },
      this.config.title
    );
  }

  /**
   * Create debug ID display element
   * v1.6.3.2 - Feature: Show Quick Tab Debug ID in titlebar
   * v1.6.3.3 - FIX Bug #1: Show LAST N characters for uniqueness (random suffix is at end)
   * @private
   * @returns {HTMLElement|null} Debug ID element or null if disabled
   */
  _createDebugIdElement() {
    if (!this.config.showDebugId || !this.config.id) {
      return null;
    }

    // v1.6.3.3 - FIX Bug #1: Show LAST 12 characters (the unique part is the random suffix)
    // Old format truncated prefix like "qt-123-16..." which was identical across tabs
    // New format shows "...timestamp-random" which is always unique
    const displayId =
      this.config.id.length > 15 ? '...' + this.config.id.slice(-12) : this.config.id;

    // v1.6.3.4-v9 - FIX Issue #1: Add marginLeft: 'auto' to push element to right edge
    // v1.6.3.4-v9 - FIX Issue #3: Increase fontSize to 11px and use brighter color #aaa
    const debugId = createElement(
      'span',
      {
        className: 'quick-tab-debug-id',
        style: {
          fontSize: '11px',
          color: '#aaa',
          fontFamily: 'monospace',
          marginLeft: 'auto',
          marginRight: '8px',
          userSelect: 'text',
          cursor: 'default',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '120px'
        }
      },
      displayId
    );
    debugId.title = `Quick Tab ID: ${this.config.id}`;

    return debugId;
  }

  /**
   * Create right section with control buttons
   * v1.6.4 - Removed Solo/Mute buttons
   * @private
   */
  _createRightSection() {
    // v1.6.3.4-v9 - Added className for robust querySelector targeting
    const controls = createElement('div', {
      className: 'quick-tab-controls',
      style: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
      }
    });

    // Store reference for dynamic updates
    this.controlsContainer = controls;

    // v1.6.3.2 - Add debug ID display (left of buttons)
    this.debugIdElement = this._createDebugIdElement();
    if (this.debugIdElement) {
      controls.appendChild(this.debugIdElement);
    }

    // Open in New Tab button
    const openBtn = this._createButton('🔗', () => {
      if (this.callbacks.onOpenInTab) {
        this.callbacks.onOpenInTab();
      }
    });
    openBtn.title = 'Open in New Tab';
    controls.appendChild(openBtn);

    // Minimize button
    const minimizeBtn = this._createButton('−', () => {
      if (this.callbacks.onMinimize) {
        this.callbacks.onMinimize();
      }
    });
    minimizeBtn.title = 'Minimize';
    controls.appendChild(minimizeBtn);

    // Close button
    const closeBtn = this._createButton('×', () => {
      if (this.callbacks.onClose) {
        this.callbacks.onClose();
      }
    });
    closeBtn.title = 'Close';
    controls.appendChild(closeBtn);

    return controls;
  }

  /**
   * Create a button element with hover effects
   * @private
   * @param {string} text - Button text/icon
   * @param {Function} onClick - Click handler
   * @returns {HTMLElement} Button element
   */
  _createButton(text, onClick) {
    const button = createElement(
      'button',
      {
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
      },
      text
    );

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#444';
    });

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = 'transparent';
    });

    button.addEventListener('click', e => {
      e.stopPropagation();
      onClick();
    });

    return button;
  }

  /**
   * Apply zoom level to iframe
   * @private
   * @param {number} zoomLevel - Zoom percentage (50-200)
   */
  _applyZoom(zoomLevel) {
    const zoomFactor = zoomLevel / 100;
    if (this.config.iframe.contentWindow) {
      try {
        this.config.iframe.contentWindow.document.body.style.zoom = zoomFactor;
      } catch (err) {
        // Cross-origin restriction - use CSS transform fallback
        this.config.iframe.style.transform = `scale(${zoomFactor})`;
        this.config.iframe.style.transformOrigin = 'top left';
        this.config.iframe.style.width = `${100 / zoomFactor}%`;
        this.config.iframe.style.height = `${100 / zoomFactor}%`;
      }
    }
    if (this.zoomDisplay) {
      this.zoomDisplay.textContent = `${zoomLevel}%`;
    }
    console.log(`[TitlebarBuilder] Zoom applied: ${zoomLevel}% on ${this.config.url}`);
  }
}
