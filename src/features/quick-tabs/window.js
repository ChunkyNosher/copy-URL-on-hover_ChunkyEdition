/**
 * Quick Tab Window Component
 * Handles creation, rendering, and lifecycle of individual Quick Tab overlay windows
 *
 * v1.5.9.0 - Restored missing UI logic identified in v1589-quick-tabs-root-cause.md
 */

import browser from 'webextension-polyfill';

import { DragController } from './window/DragController.js';
import { ResizeController } from './window/ResizeController.js';
import { TitlebarBuilder } from './window/TitlebarBuilder.js';
import { CONSTANTS } from '../../core/config.js';
import { createElement } from '../../utils/dom.js';

/**
 * QuickTabWindow class - Manages a single Quick Tab overlay instance
 */
export class QuickTabWindow {
  constructor(options) {
    // v1.6.0 Phase 2.4 - Extract initialization methods to reduce complexity
    this._initializeBasicProperties(options);
    this._initializePositionAndSize(options);
    this._initializeVisibility(options);
    this._initializeCallbacks(options);
    this._initializeState();
  }

  /**
   * Initialize basic properties (id, url, title, etc.)
   */
  _initializeBasicProperties(options) {
    this.id = options.id;
    this.url = options.url;
    this.title = options.title || 'Quick Tab';
    this.cookieStoreId = options.cookieStoreId || 'firefox-default';
  }

  /**
   * Initialize position and size properties
   */
  _initializePositionAndSize(options) {
    this.left = options.left || 100;
    this.top = options.top || 100;
    this.width = options.width || 800;
    this.height = options.height || 600;
    this.zIndex = options.zIndex || CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
  }

  /**
   * Initialize visibility-related properties (minimized, solo, mute)
   */
  _initializeVisibility(options) {
    this.minimized = options.minimized || false;
    // v1.5.9.13 - Replace pinnedToUrl with solo/mute arrays
    this.soloedOnTabs = options.soloedOnTabs || [];
    this.mutedOnTabs = options.mutedOnTabs || [];
  }

  /**
   * Initialize lifecycle and event callbacks
   * v1.6.0 Phase 2.4 - Table-driven to reduce complexity
   */
  _initializeCallbacks(options) {
    const noop = () => {};
    const callbacks = [
      'onDestroy',
      'onMinimize',
      'onFocus',
      'onPositionChange',
      'onPositionChangeEnd',
      'onSizeChange',
      'onSizeChangeEnd',
      'onSolo', // v1.5.9.13
      'onMute' // v1.5.9.13
    ];

    callbacks.forEach(name => {
      this[name] = options[name] || noop;
    });
  }

  /**
   * Initialize internal state properties
   */
  _initializeState() {
    this.container = null;
    this.iframe = null;
    this.rendered = false; // v1.5.9.10 - Track rendering state to prevent rendering bugs
    // v1.6.0 Phase 2.9 - isDragging kept for external checks, managed by DragController
    this.isDragging = false;
    this.isResizing = false;
    // v1.6.0 Phase 2.9 - dragStartX/Y removed, managed internally by DragController
    this.resizeStartWidth = 0;
    this.resizeStartHeight = 0;
    this.soloButton = null; // v1.5.9.13 - Reference to solo button
    this.muteButton = null; // v1.5.9.13 - Reference to mute button
    // v1.6.0 Phase 2.9 - Controllers for drag and resize
    this.dragController = null;
    this.resizeController = null;
    // v1.6.2.3 - Track update timestamps for cross-tab sync
    this.lastPositionUpdate = null;
    this.lastSizeUpdate = null;
  }

  /**
   * Process URL to disable autoplay for YouTube videos
   * v1.6.1.5 - Fix for YouTube autoplay issue
   * 
   * @param {string} url - Original URL
   * @returns {string} - Modified URL with autoplay disabled
   */
  _processUrlForAutoplay(url) {
    try {
      // Check if URL is a YouTube URL (youtube.com or youtu.be)
      if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
        return url; // Not a YouTube URL, return as-is
      }

      const urlObj = new URL(url);

      // Set or update autoplay parameter to 0
      urlObj.searchParams.set('autoplay', '0');

      console.log(`[QuickTabWindow] Processed YouTube URL for autoplay prevention: ${urlObj.toString()}`);
      return urlObj.toString();
    } catch (err) {
      console.error('[QuickTabWindow] Error processing URL for autoplay:', err);
      return url; // Return original URL on error
    }
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

    // v1.6.0 Phase 2.9 Task 4 - Use TitlebarBuilder facade pattern
    // Create titlebar using TitlebarBuilder component
    this.titlebarBuilder = new TitlebarBuilder(
      {
        title: this.title,
        url: this.url,
        soloedOnTabs: this.soloedOnTabs,
        mutedOnTabs: this.mutedOnTabs,
        currentTabId: this.currentTabId,
        iframe: null // Will be set after iframe creation
      },
      {
        onClose: () => this.destroy(),
        onMinimize: () => this.minimize(),
        onSolo: btn => this.toggleSolo(btn),
        onMute: btn => this.toggleMute(btn),
        onOpenInTab: () => {
          const currentSrc = this.iframe.src || this.iframe.getAttribute('data-deferred-src');
          browser.runtime.sendMessage({
            action: 'openTab',
            url: currentSrc,
            switchFocus: true
          });
        }
      }
    );

    // Note: iframe is null during titlebar build, will be updated before first use
    const titlebar = this.titlebarBuilder.build();
    this.container.appendChild(titlebar);

    // Store button references for updating (solo/mute state changes)
    this.soloButton = this.titlebarBuilder.soloButton;
    this.muteButton = this.titlebarBuilder.muteButton;

    // Create iframe content area
    // v1.6.1.5 - Process URL to prevent autoplay and add 'allow' attribute
    const processedUrl = this._processUrlForAutoplay(this.url);
    
    this.iframe = createElement('iframe', {
      src: processedUrl,
      style: {
        flex: '1',
        border: 'none',
        width: '100%',
        height: 'calc(100% - 40px)'
      },
      sandbox:
        'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
      // v1.6.1.5 - Add 'allow' attribute without autoplay permission to prevent autoplay
      allow: 'picture-in-picture; fullscreen'
    });

    this.container.appendChild(this.iframe);

    // Update TitlebarBuilder with iframe reference (needed for navigation/zoom)
    this.titlebarBuilder.config.iframe = this.iframe;

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

    // v1.6.0 Phase 2.9 Task 3 - Use DragController facade pattern
    this.dragController = new DragController(titlebar, {
      onDragStart: (x, y) => {
        console.log('[QuickTabWindow] Drag started:', this.id, x, y);
        this.isDragging = true;
        this.onFocus(this.id);
      },
      onDrag: (newX, newY) => {
        // Update position
        this.left = newX;
        this.top = newY;
        this.container.style.left = `${newX}px`;
        this.container.style.top = `${newY}px`;

        // Call position change callback (throttled by DragController's RAF)
        if (this.onPositionChange) {
          this.onPositionChange(this.id, newX, newY);
        }
      },
      onDragEnd: (finalX, finalY) => {
        console.log('[QuickTabWindow] Drag ended:', this.id, finalX, finalY);
        this.isDragging = false;

        // Final save on drag end
        if (this.onPositionChangeEnd) {
          this.onPositionChangeEnd(this.id, finalX, finalY);
        }
      },
      onDragCancel: (lastX, lastY) => {
        // CRITICAL FOR ISSUE #51: Emergency save position when drag is interrupted
        console.log('[QuickTabWindow] Drag cancelled:', this.id, lastX, lastY);
        this.isDragging = false;

        // Emergency save position before tab loses focus
        if (this.onPositionChangeEnd) {
          this.onPositionChangeEnd(this.id, lastX, lastY);
        }
      }
    });

    // v1.6.0 Phase 2.4 - Use ResizeController facade pattern
    this.resizeController = new ResizeController(this, {
      minWidth: 400,
      minHeight: 300
    });
    this.resizeController.attachHandles();

    this.setupFocusHandlers();

    console.log('[QuickTabWindow] Rendered:', this.id);
    return this.container;
  }

  // v1.6.0 Phase 2.9 Task 4 - createFavicon() moved to TitlebarBuilder

  // v1.6.0 Phase 2.9 Task 4 - createTitlebar() moved to TitlebarBuilder (157 lines)
  // v1.6.0 Phase 2.9 Task 4 - createButton() moved to TitlebarBuilder (38 lines)
  // v1.6.0 Phase 2.9 Task 4 - createFavicon() moved to TitlebarBuilder (26 lines)
  // See TitlebarBuilder.js for extracted implementation

  /**
   * v1.6.0 Phase 2.9 Task 4 - applyZoom() REMOVED
   * Zoom functionality now handled internally by TitlebarBuilder
   * Old method signature: applyZoom(zoomLevel, displayElement)
   * If zoom needs to be exposed externally, add public method to TitlebarBuilder
   */

  // The following event handlers still in window.js (toggleSolo, toggleMute, minimize, destroy, etc.)

  /**
   * Setup drag handlers using Pointer Events API
   */
  /**
   * v1.6.0 Phase 2.9 Task 3 - setupDragHandlers removed
   * Replaced with DragController facade pattern (see render() method)
   * This eliminates ~50 lines of drag logic and uses Pointer Events API
   * for Issue #51 fix (pointercancel handles tab switch during drag)
   */

  /**
   * v1.6.0 Phase 2.4 - setupResizeHandlers removed
   * Replaced with ResizeController facade pattern (see render() method)
   * This eliminates 195 lines of complex conditional logic
   */

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

  // v1.6.0 Phase 2.9 Task 4 - applyZoom() removed (now in TitlebarBuilder._applyZoom())

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
   * v1.6.0 Phase 2.4 - Extracted helper to reduce nesting
   */
  setupIframeLoadHandler() {
    this.iframe.addEventListener('load', () => {
      this._updateTitleFromIframe();
    });
  }

  /**
   * Update title from iframe content or URL
   * v1.6.0 Phase 2.4 - Extracted to reduce nesting depth
   */
  _updateTitleFromIframe() {
    // Try same-origin title first
    const iframeTitle = this._tryGetIframeTitle();
    if (iframeTitle) {
      this._setTitle(iframeTitle, iframeTitle);
      return;
    }

    // Fallback to hostname
    const hostname = this._tryGetHostname();
    if (hostname) {
      this._setTitle(hostname, this.iframe.src);
      return;
    }

    // Final fallback
    this.title = 'Quick Tab';
  }

  /**
   * Try to get title from iframe (same-origin only)
   */
  _tryGetIframeTitle() {
    try {
      return this.iframe.contentDocument?.title;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Try to get hostname from iframe URL
   */
  _tryGetHostname() {
    try {
      const urlObj = new URL(this.iframe.src);
      return urlObj.hostname;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Set title in both property and UI
   */
  _setTitle(title, tooltip) {
    this.title = title;
    // v1.6.0 Phase 2.9 Task 4 - Use TitlebarBuilder to update title
    if (this.titlebarBuilder) {
      this.titlebarBuilder.updateTitle(title);
      // Update tooltip on title element
      if (this.titlebarBuilder.titleElement) {
        this.titlebarBuilder.titleElement.title = tooltip;
      }
    }
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
    const currentTabId = this._validateCurrentTabId('solo');
    if (!currentTabId) return;

    if (this.isCurrentTabSoloed()) {
      this._unsoloCurrentTab(soloBtn, currentTabId);
    } else {
      this._soloCurrentTab(soloBtn, currentTabId);
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
    const currentTabId = this._validateCurrentTabId('mute');
    if (!currentTabId) return;

    if (this.isCurrentTabMuted()) {
      this._unmuteCurrentTab(muteBtn, currentTabId);
    } else {
      this._muteCurrentTab(muteBtn, currentTabId);
    }

    // Notify parent manager
    if (this.onMute) {
      this.onMute(this.id, this.mutedOnTabs);
    }
  }

  /**
   * Validate current tab ID availability
   * @private
   * @param {string} action - Action name for logging ('solo' or 'mute')
   * @returns {number|null} Current tab ID or null if unavailable
   */
  _validateCurrentTabId(action) {
    console.log(
      `[QuickTabWindow] toggle${action.charAt(0).toUpperCase() + action.slice(1)} called for:`,
      this.id
    );

    if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
      console.warn(`[QuickTabWindow] Cannot toggle ${action} - no current tab ID`);
      return null;
    }

    return window.quickTabsManager.currentTabId;
  }

  /**
   * Un-solo current tab
   * @private
   */
  _unsoloCurrentTab(soloBtn, currentTabId) {
    this.soloedOnTabs = this.soloedOnTabs.filter(id => id !== currentTabId);
    soloBtn.textContent = '⭕';
    soloBtn.title = 'Solo (show only on this tab)';
    soloBtn.style.background = 'transparent';

    if (this.soloedOnTabs.length === 0) {
      console.log('[QuickTabWindow] Un-soloed - now visible on all tabs');
    }
  }

  /**
   * Solo current tab
   * @private
   */
  _soloCurrentTab(soloBtn, currentTabId) {
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

  /**
   * Unmute current tab
   * @private
   */
  _unmuteCurrentTab(muteBtn, currentTabId) {
    this.mutedOnTabs = this.mutedOnTabs.filter(id => id !== currentTabId);
    muteBtn.textContent = '🔊';
    muteBtn.title = 'Mute (hide on this tab)';
    muteBtn.style.background = 'transparent';
    console.log('[QuickTabWindow] Unmuted on this tab');
  }

  /**
   * Mute current tab
   * @private
   */
  _muteCurrentTab(muteBtn, currentTabId) {
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
   * Update position of Quick Tab window (Bug #3 Fix - UICoordinator compatibility)
   * v1.6.2.3 - Added for cross-tab sync via UICoordinator.update()
   * 
   * Note: This wraps setPosition() and adds timestamp tracking for sync.
   * The difference from setPosition() is the timestamp which helps with
   * conflict resolution in cross-tab synchronization.
   * 
   * @param {number} left - X position in pixels
   * @param {number} top - Y position in pixels
   */
  updatePosition(left, top) {
    this.setPosition(left, top);
    this.lastPositionUpdate = Date.now();
  }

  /**
   * Update size of Quick Tab window (Bug #3 Fix - UICoordinator compatibility)
   * v1.6.2.3 - Added for cross-tab sync via UICoordinator.update()
   * 
   * Note: This wraps setSize() and adds timestamp tracking for sync.
   * The difference from setSize() is the timestamp which helps with
   * conflict resolution in cross-tab synchronization.
   * 
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   */
  updateSize(width, height) {
    this.setSize(width, height);
    this.lastSizeUpdate = Date.now();
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
    // v1.6.0 Phase 2.9 - Cleanup drag controller
    if (this.dragController) {
      this.dragController.destroy();
      this.dragController = null;
    }

    // v1.6.0 Phase 2.4 - Cleanup resize controller
    if (this.resizeController) {
      this.resizeController.detachAll();
      this.resizeController = null;
    }

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
