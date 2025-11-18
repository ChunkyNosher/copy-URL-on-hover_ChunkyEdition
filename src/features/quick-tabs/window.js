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

    // v1.5.9.13 - Replace pinnedToUrl with solo/mute arrays
    this.soloedOnTabs = options.soloedOnTabs || [];
    this.mutedOnTabs = options.mutedOnTabs || [];

    this.container = null;
    this.iframe = null;
    this.rendered = false; // v1.5.9.10 - Track rendering state to prevent rendering bugs
    this.isDragging = false;
    this.isResizing = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.resizeStartWidth = 0;
    this.resizeStartHeight = 0;
    this.soloButton = null; // v1.5.9.13 - Reference to solo button
    this.muteButton = null; // v1.5.9.13 - Reference to mute button

    this.onDestroy = options.onDestroy || (() => {});
    this.onMinimize = options.onMinimize || (() => {});
    this.onFocus = options.onFocus || (() => {});
    this.onPositionChange = options.onPositionChange || (() => {});
    this.onPositionChangeEnd = options.onPositionChangeEnd || (() => {});
    this.onSizeChange = options.onSizeChange || (() => {});
    this.onSizeChangeEnd = options.onSizeChangeEnd || (() => {});
    this.onSolo = options.onSolo || (() => {}); // v1.5.9.13 - Solo callback
    this.onMute = options.onMute || (() => {}); // v1.5.9.13 - Mute callback
  }

  /**
   * Create and render the Quick Tab window
   */
  render() {
    if (this.container) {
      console.warn('[QuickTabWindow] Already rendered:', this.id);
      return this.container;
    }

    const targetLeft = Number.isFinite(this.left) ? this.left : 100;
    const targetTop = Number.isFinite(this.top) ? this.top : 100;
    this.left = targetLeft;
    this.top = targetTop;

    // Create main container
    this.container = createElement('div', {
      id: `quick-tab-${this.id}`,
      className: 'quick-tab-window',
      style: {
        position: 'fixed',
        left: '-9999px',
        top: '-9999px',
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
        transition: 'box-shadow 0.2s, opacity 0.15s ease-in',
        visibility: 'hidden',
        opacity: '0'
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
      sandbox:
        'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
    });

    this.container.appendChild(this.iframe);

    // Setup iframe load listener to update title
    this.setupIframeLoadHandler();

    // Add to document
    document.body.appendChild(this.container);

    // v1.5.9.10 - Mark as rendered
    this.rendered = true;

    // Fix Quick Tab flash by moving into place after a frame
    requestAnimationFrame(() => {
      this.container.style.left = `${targetLeft}px`;
      this.container.style.top = `${targetTop}px`;
      this.container.style.visibility = 'visible';
      this.container.style.opacity = '1';
    });

    // Setup interactions
    this.setupDragHandlers(titlebar);
    this.setupResizeHandlers();
    this.setupFocusHandlers();

    console.log('[QuickTabWindow] Rendered:', this.id);
    return this.container;
  }

  /**
   * Create favicon element
   */
  createFavicon() {
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
      const urlObj = new URL(this.url);
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

    // Create left section with navigation, favicon and title
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
    const navContainer = createElement('div', {
      style: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center'
      }
    });

    // Back button
    const backBtn = this.createButton('←', () => {
      if (this.iframe.contentWindow) {
        try {
          this.iframe.contentWindow.history.back();
        } catch (err) {
          console.warn('[QuickTab] Cannot navigate back - cross-origin restriction');
        }
      }
    });
    backBtn.title = 'Back';
    navContainer.appendChild(backBtn);

    // Forward button
    const forwardBtn = this.createButton('→', () => {
      if (this.iframe.contentWindow) {
        try {
          this.iframe.contentWindow.history.forward();
        } catch (err) {
          console.warn('[QuickTab] Cannot navigate forward - cross-origin restriction');
        }
      }
    });
    forwardBtn.title = 'Forward';
    navContainer.appendChild(forwardBtn);

    // Reload button - Fixed self-assignment ESLint error
    const reloadBtn = this.createButton('↻', () => {
      // Proper iframe reload technique (fixes no-self-assign ESLint error)
      const currentSrc = this.iframe.src;
      this.iframe.src = 'about:blank';
      setTimeout(() => {
        this.iframe.src = currentSrc;
      }, 10);
    });
    reloadBtn.title = 'Reload';
    navContainer.appendChild(reloadBtn);

    // Zoom controls
    let currentZoom = 100;

    const zoomOutBtn = this.createButton('−', () => {
      if (currentZoom > 50) {
        currentZoom -= 10;
        this.applyZoom(currentZoom, zoomDisplay);
      }
    });
    zoomOutBtn.title = 'Zoom Out';
    navContainer.appendChild(zoomOutBtn);

    const zoomDisplay = createElement(
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
    navContainer.appendChild(zoomDisplay);

    const zoomInBtn = this.createButton('+', () => {
      if (currentZoom < 200) {
        currentZoom += 10;
        this.applyZoom(currentZoom, zoomDisplay);
      }
    });
    zoomInBtn.title = 'Zoom In';
    navContainer.appendChild(zoomInBtn);

    leftSection.appendChild(navContainer);

    // Favicon
    const favicon = this.createFavicon();
    leftSection.appendChild(favicon);

    // Title text
    const titleText = createElement(
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
      this.title
    );
    leftSection.appendChild(titleText);

    // Control buttons container
    const controls = createElement('div', {
      style: {
        display: 'flex',
        gap: '8px'
      }
    });

    // Open in New Tab button
    const openBtn = this.createButton('🔗', () => {
      const currentSrc = this.iframe.src || this.iframe.getAttribute('data-deferred-src');
      browser.runtime.sendMessage({
        action: 'openTab',
        url: currentSrc,
        switchFocus: true
      });
    });
    openBtn.title = 'Open in New Tab';
    controls.appendChild(openBtn);

    // v1.5.9.13 - Solo button (replaces pin button)
    const soloBtn = this.createButton(this.isCurrentTabSoloed() ? '🎯' : '⭕', () =>
      this.toggleSolo(soloBtn)
    );
    soloBtn.title = this.isCurrentTabSoloed()
      ? 'Un-solo (show on all tabs)'
      : 'Solo (show only on this tab)';
    soloBtn.style.background = this.isCurrentTabSoloed() ? '#444' : 'transparent';
    controls.appendChild(soloBtn);
    this.soloButton = soloBtn;

    // v1.5.9.13 - Mute button
    const muteBtn = this.createButton(this.isCurrentTabMuted() ? '🔇' : '🔊', () =>
      this.toggleMute(muteBtn)
    );
    muteBtn.title = this.isCurrentTabMuted()
      ? 'Unmute (show on this tab)'
      : 'Mute (hide on this tab)';
    muteBtn.style.background = this.isCurrentTabMuted() ? '#c44' : 'transparent';
    controls.appendChild(muteBtn);
    this.muteButton = muteBtn;

    // Minimize button
    const minimizeBtn = this.createButton('−', () => this.minimize());
    minimizeBtn.title = 'Minimize';
    controls.appendChild(minimizeBtn);

    // Close button
    const closeBtn = this.createButton('×', () => this.destroy());
    closeBtn.title = 'Close';
    controls.appendChild(closeBtn);

    titlebar.appendChild(leftSection);
    titlebar.appendChild(controls);

    return titlebar;
  }

  /**
   * Create a control button
   */
  createButton(text, onClick) {
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
   * Setup drag handlers using Pointer Events API
   */
  setupDragHandlers(titlebar) {
    titlebar.addEventListener('pointerdown', e => {
      if (e.target.tagName === 'BUTTON') return;

      this.isDragging = true;
      this.dragStartX = e.clientX - this.left;
      this.dragStartY = e.clientY - this.top;

      titlebar.setPointerCapture(e.pointerId);

      this.onFocus(this.id);
    });

    titlebar.addEventListener('pointermove', e => {
      if (!this.isDragging) return;

      this.left = e.clientX - this.dragStartX;
      this.top = e.clientY - this.dragStartY;

      this.container.style.left = `${this.left}px`;
      this.container.style.top = `${this.top}px`;

      // Notify parent of position change (throttled)
      if (this.onPositionChange) {
        this.onPositionChange(this.id, this.left, this.top);
      }
    });

    titlebar.addEventListener('pointerup', e => {
      if (this.isDragging) {
        this.isDragging = false;
        titlebar.releasePointerCapture(e.pointerId);

        // Final save on drag end
        if (this.onPositionChangeEnd) {
          this.onPositionChangeEnd(this.id, this.left, this.top);
        }
      }
    });

    // CRITICAL FOR ISSUE #51: Handle tab switch during drag
    titlebar.addEventListener('pointercancel', e => {
      if (this.isDragging) {
        this.isDragging = false;

        // Emergency save position before tab loses focus
        if (this.onPositionChangeEnd) {
          this.onPositionChangeEnd(this.id, this.left, this.top);
        }
      }
    });
  }

  /**
   * Setup resize handlers on all 8 edges/corners
   * Uses Pointer Events API for reliable capture
   */
  setupResizeHandlers() {
    const minWidth = 400;
    const minHeight = 300;
    const handleSize = 10;

    // Define all 8 resize handles
    const handles = {
      se: {
        cursor: 'se-resize',
        bottom: 0,
        right: 0,
        width: handleSize,
        height: handleSize
      },
      sw: {
        cursor: 'sw-resize',
        bottom: 0,
        left: 0,
        width: handleSize,
        height: handleSize
      },
      ne: {
        cursor: 'ne-resize',
        top: 0,
        right: 0,
        width: handleSize,
        height: handleSize
      },
      nw: {
        cursor: 'nw-resize',
        top: 0,
        left: 0,
        width: handleSize,
        height: handleSize
      },
      e: {
        cursor: 'e-resize',
        top: handleSize,
        right: 0,
        bottom: handleSize,
        width: handleSize
      },
      w: {
        cursor: 'w-resize',
        top: handleSize,
        left: 0,
        bottom: handleSize,
        width: handleSize
      },
      s: {
        cursor: 's-resize',
        bottom: 0,
        left: handleSize,
        right: handleSize,
        height: handleSize
      },
      n: {
        cursor: 'n-resize',
        top: 0,
        left: handleSize,
        right: handleSize,
        height: handleSize
      }
    };

    Object.entries(handles).forEach(([direction, config]) => {
      const handle = createElement('div', {
        className: `quick-tab-resize-handle-${direction}`,
        style: {
          position: 'absolute',
          ...(config.top !== undefined ? { top: `${config.top}px` } : {}),
          ...(config.bottom !== undefined ? { bottom: `${config.bottom}px` } : {}),
          ...(config.left !== undefined ? { left: `${config.left}px` } : {}),
          ...(config.right !== undefined ? { right: `${config.right}px` } : {}),
          ...(config.width ? { width: `${config.width}px` } : {}),
          ...(config.height ? { height: `${config.height}px` } : {}),
          cursor: config.cursor,
          zIndex: '10',
          backgroundColor: 'transparent' // Invisible but interactive
        }
      });

      let isResizing = false;
      let startX, startY, startWidth, startHeight, startLeft, startTop;

      handle.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;

        e.stopPropagation();
        e.preventDefault();

        isResizing = true;
        handle.setPointerCapture(e.pointerId);

        startX = e.clientX;
        startY = e.clientY;
        startWidth = this.width;
        startHeight = this.height;
        startLeft = this.left;
        startTop = this.top;
      });

      handle.addEventListener('pointermove', e => {
        if (!isResizing) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Calculate new dimensions based on resize direction
        if (direction.includes('e')) {
          newWidth = Math.max(minWidth, startWidth + dx);
        }
        if (direction.includes('w')) {
          const maxDx = startWidth - minWidth;
          const constrainedDx = Math.min(dx, maxDx);
          newWidth = startWidth - constrainedDx;
          newLeft = startLeft + constrainedDx;
        }
        if (direction.includes('s')) {
          newHeight = Math.max(minHeight, startHeight + dy);
        }
        if (direction.includes('n')) {
          const maxDy = startHeight - minHeight;
          const constrainedDy = Math.min(dy, maxDy);
          newHeight = startHeight - constrainedDy;
          newTop = startTop + constrainedDy;
        }

        // Apply immediately (no RAF delay)
        this.width = newWidth;
        this.height = newHeight;
        this.left = newLeft;
        this.top = newTop;

        this.container.style.width = `${newWidth}px`;
        this.container.style.height = `${newHeight}px`;
        this.container.style.left = `${newLeft}px`;
        this.container.style.top = `${newTop}px`;

        // Notify parent (throttled)
        if (this.onSizeChange) {
          this.onSizeChange(this.id, newWidth, newHeight);
        }
        if (newLeft !== startLeft || newTop !== startTop) {
          if (this.onPositionChange) {
            this.onPositionChange(this.id, newLeft, newTop);
          }
        }

        e.preventDefault();
      });

      handle.addEventListener('pointerup', e => {
        if (!isResizing) return;

        isResizing = false;
        handle.releasePointerCapture(e.pointerId);

        // CRITICAL FIX: Prevent click propagation after resize
        // This fixes the bug where resizing causes the Quick Tab to close
        e.preventDefault();
        e.stopPropagation();

        // Final save
        if (this.onSizeChangeEnd) {
          this.onSizeChangeEnd(this.id, this.width, this.height);
        }
        if (this.left !== startLeft || this.top !== startTop) {
          if (this.onPositionChangeEnd) {
            this.onPositionChangeEnd(this.id, this.left, this.top);
          }
        }
      });

      handle.addEventListener('pointercancel', e => {
        if (isResizing) {
          isResizing = false;

          // Emergency save
          if (this.onSizeChangeEnd) {
            this.onSizeChangeEnd(this.id, this.width, this.height);
          }
          if (this.onPositionChangeEnd) {
            this.onPositionChangeEnd(this.id, this.left, this.top);
          }
        }
      });

      this.container.appendChild(handle);
    });
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

    // Enhanced logging for console log export (Issue #1)
    console.log(
      `[Quick Tab] Minimized - URL: ${this.url}, Title: ${this.title}, ID: ${this.id}, Position: (${this.left}, ${this.top}), Size: ${this.width}x${this.height}`
    );

    this.onMinimize(this.id);
  }

  /**
   * Restore minimized Quick Tab window
   * v1.5.9.8 - FIX: Explicitly re-apply position to ensure it's in the same place
   */
  restore() {
    this.minimized = false;
    this.container.style.display = 'flex';

    // v1.5.9.8 - FIX: Explicitly re-apply position to ensure it's restored to the same place
    this.container.style.left = `${this.left}px`;
    this.container.style.top = `${this.top}px`;
    this.container.style.width = `${this.width}px`;
    this.container.style.height = `${this.height}px`;

    // Enhanced logging for console log export (Issue #1)
    console.log(
      `[Quick Tab] Restored - URL: ${this.url}, Title: ${this.title}, ID: ${this.id}, Position: (${this.left}, ${this.top}), Size: ${this.width}x${this.height}`
    );

    this.onFocus(this.id);
  }

  /**
   * Apply zoom to iframe content
   */
  applyZoom(zoomLevel, displayElement) {
    const zoomFactor = zoomLevel / 100;
    if (this.iframe.contentWindow) {
      try {
        this.iframe.contentWindow.document.body.style.zoom = zoomFactor;
      } catch (err) {
        // Cross-origin restriction - use CSS transform fallback
        this.iframe.style.transform = `scale(${zoomFactor})`;
        this.iframe.style.transformOrigin = 'top left';
        this.iframe.style.width = `${100 / zoomFactor}%`;
        this.iframe.style.height = `${100 / zoomFactor}%`;
      }
    }
    if (displayElement) {
      displayElement.textContent = `${zoomLevel}%`;
    }
    console.log(`[Quick Tab] Zoom applied: ${zoomLevel}% on ${this.url}`);
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
   * Setup iframe load handler to update title
   */
  setupIframeLoadHandler() {
    this.iframe.addEventListener('load', () => {
      try {
        // Try to get title from iframe (same-origin only)
        const iframeTitle = this.iframe.contentDocument?.title;
        if (iframeTitle) {
          this.title = iframeTitle;
          const titleEl = this.container.querySelector('.quick-tab-title');
          if (titleEl) {
            titleEl.textContent = iframeTitle;
            titleEl.title = iframeTitle;
          }
        } else {
          // Fallback to hostname
          try {
            const urlObj = new URL(this.iframe.src);
            this.title = urlObj.hostname;
            const titleEl = this.container.querySelector('.quick-tab-title');
            if (titleEl) {
              titleEl.textContent = urlObj.hostname;
              titleEl.title = this.iframe.src;
            }
          } catch (e) {
            this.title = 'Quick Tab';
          }
        }
      } catch (e) {
        // Cross-origin - use URL hostname
        try {
          const urlObj = new URL(this.iframe.src);
          this.title = urlObj.hostname;
          const titleEl = this.container.querySelector('.quick-tab-title');
          if (titleEl) {
            titleEl.textContent = urlObj.hostname;
            titleEl.title = this.iframe.src;
          }
        } catch (err) {
          this.title = 'Quick Tab';
        }
      }
    });
  }

  /**
   * v1.5.9.13 - Check if current tab is in solo list
   */
  isCurrentTabSoloed() {
    return (
      this.soloedOnTabs &&
      this.soloedOnTabs.length > 0 &&
      window.quickTabsManager &&
      window.quickTabsManager.currentTabId &&
      this.soloedOnTabs.includes(window.quickTabsManager.currentTabId)
    );
  }

  /**
   * v1.5.9.13 - Check if current tab is in mute list
   */
  isCurrentTabMuted() {
    return (
      this.mutedOnTabs &&
      this.mutedOnTabs.length > 0 &&
      window.quickTabsManager &&
      window.quickTabsManager.currentTabId &&
      this.mutedOnTabs.includes(window.quickTabsManager.currentTabId)
    );
  }

  /**
   * v1.5.9.13 - Toggle solo state for current tab
   */
  toggleSolo(soloBtn) {
    console.log('[QuickTabWindow] toggleSolo called for:', this.id);
    console.log('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
    console.log('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);

    if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
      console.warn('[QuickTabWindow] Cannot toggle solo - no current tab ID');
      console.warn('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
      console.warn('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);
      return;
    }

    const currentTabId = window.quickTabsManager.currentTabId;

    if (this.isCurrentTabSoloed()) {
      // Un-solo: Remove current tab from solo list
      this.soloedOnTabs = this.soloedOnTabs.filter(id => id !== currentTabId);
      soloBtn.textContent = '⭕';
      soloBtn.title = 'Solo (show only on this tab)';
      soloBtn.style.background = 'transparent';

      // If no tabs left in solo list, Quick Tab becomes visible everywhere
      if (this.soloedOnTabs.length === 0) {
        console.log('[QuickTabWindow] Un-soloed - now visible on all tabs');
      }
    } else {
      // Solo: Set current tab as the only tab (replace entire list for simplicity)
      this.soloedOnTabs = [currentTabId];
      this.mutedOnTabs = []; // Clear mute state (mutually exclusive)
      soloBtn.textContent = '🎯';
      soloBtn.title = 'Un-solo (show on all tabs)';
      soloBtn.style.background = '#444';

      // Update mute button if it exists
      if (this.muteButton) {
        this.muteButton.textContent = '🔊';
        this.muteButton.title = 'Mute (hide on this tab)';
        this.muteButton.style.background = 'transparent';
      }

      console.log('[QuickTabWindow] Soloed - only visible on this tab');
    }

    // Notify parent manager
    if (this.onSolo) {
      this.onSolo(this.id, this.soloedOnTabs);
    }
  }

  /**
   * v1.5.9.13 - Toggle mute state for current tab
   */
  toggleMute(muteBtn) {
    console.log('[QuickTabWindow] toggleMute called for:', this.id);
    console.log('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
    console.log('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);

    if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
      console.warn('[QuickTabWindow] Cannot toggle mute - no current tab ID');
      console.warn('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
      console.warn('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);
      return;
    }

    const currentTabId = window.quickTabsManager.currentTabId;

    if (this.isCurrentTabMuted()) {
      // Unmute: Remove current tab from mute list
      this.mutedOnTabs = this.mutedOnTabs.filter(id => id !== currentTabId);
      muteBtn.textContent = '🔊';
      muteBtn.title = 'Mute (hide on this tab)';
      muteBtn.style.background = 'transparent';

      console.log('[QuickTabWindow] Unmuted on this tab');
    } else {
      // Mute: Add current tab to mute list
      if (!this.mutedOnTabs.includes(currentTabId)) {
        this.mutedOnTabs.push(currentTabId);
      }
      this.soloedOnTabs = []; // Clear solo state (mutually exclusive)
      muteBtn.textContent = '🔇';
      muteBtn.title = 'Unmute (show on this tab)';
      muteBtn.style.background = '#c44';

      // Update solo button if it exists
      if (this.soloButton) {
        this.soloButton.textContent = '⭕';
        this.soloButton.title = 'Solo (show only on this tab)';
        this.soloButton.style.background = 'transparent';
      }

      console.log('[QuickTabWindow] Muted on this tab');
    }

    // Notify parent manager
    if (this.onMute) {
      this.onMute(this.id, this.mutedOnTabs);
    }
  }

  /**
   * Set position of Quick Tab window (v1.5.8.13 - for sync from other tabs)
   * @param {number} left - X position
   * @param {number} top - Y position
   */
  setPosition(left, top) {
    this.left = left;
    this.top = top;
    if (this.container) {
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
    }
  }

  /**
   * Set size of Quick Tab window (v1.5.8.13 - for sync from other tabs)
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   */
  setSize(width, height) {
    this.width = width;
    this.height = height;
    if (this.container) {
      this.container.style.width = `${width}px`;
      this.container.style.height = `${height}px`;
    }
  }

  /**
   * v1.5.9.10 - Check if Quick Tab is rendered on the page
   * @returns {boolean} True if rendered and attached to DOM
   */
  isRendered() {
    return this.rendered && this.container && this.container.parentNode;
  }

  /**
   * Destroy the Quick Tab window
   */
  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.iframe = null;
      this.rendered = false; // v1.5.9.10 - Reset rendering state
    }
    this.onDestroy(this.id);
    console.log('[QuickTabWindow] Destroyed:', this.id);
  }

  /**
   * Get current state for persistence
   * v1.5.9.13 - Updated to include soloedOnTabs and mutedOnTabs
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
      zIndex: this.zIndex,
      soloedOnTabs: this.soloedOnTabs, // v1.5.9.13
      mutedOnTabs: this.mutedOnTabs // v1.5.9.13
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
