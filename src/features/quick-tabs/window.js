/**
 * Quick Tab Window Component
 * Handles creation, rendering, and lifecycle of individual Quick Tab overlay windows
 *
 * v1.5.9.0 - Restored missing UI logic identified in v1589-quick-tabs-root-cause.md
 * v1.6.3.4-v2 - FIX Issue #4: Add DOM dimension verification logging after container creation
 * v1.6.3.4-v3 - FIX 6 Critical Quick Tab Restore Bugs:
 *   - Issue #3: Callbacks persist through restore - stored on instance, not closure
 *   - Issue #4: onDestroy callback verified before invoke, with logging
 *   - Issue #6: Enhanced logging for callback wiring and restore operations
 * v1.6.3.4-v6 - FIX Issue #2: Add URL validation in constructor to reject malformed URLs
 * v1.6.3.5-v5 - FIX Legacy Code Architecture Issues:
 *   - Issue #1: Added deprecation warnings to setPosition/setSize/updatePosition/updateSize
 *   - Issue #2: Added currentTabId as instance property (removed global access)
 *   - Issue #4: Updated comments to reflect single-tab architecture
 *   - Issue #6: Removed lastPositionUpdate/lastSizeUpdate (dead code)
 * v1.6.3.5-v9 - FIX Diagnostic Report Issues #3, #7:
 *   - Issue #3: Position/size updates stop after restore - callbacks verified after render
 *   - Issue #7: Add __quickTabWindow property and data-quicktab-id attribute for DOM recovery
 * v1.6.3.5-v10 - FIX Critical Quick Tab Restore Issues (Z-Index):
 *   - Issue #3: Z-index broken after restore - apply z-index AFTER appendChild with reflow
 *   - Added _applyZIndexAfterAppend() method for proper stacking context
 * v1.6.3.5-v11 - FIX Critical Quick Tab Bugs:
 *   - Issue #1: Stale closure references - Add rewireCallbacks() method
 *   - Issue #3: DOM event listener cleanup - Call controller cleanup() before DOM removal
 *   - Issue #4: Operation-specific flags (isMinimizing, isRestoring) replace time-based suppression
 *   - Issue #5: Enhanced logging in minimize(), restore(), updateZIndex()
 */

import browser from 'webextension-polyfill';

import { DragController } from './window/DragController.js';
import { ResizeController } from './window/ResizeController.js';
import { TitlebarBuilder } from './window/TitlebarBuilder.js';
import { CONSTANTS } from '../../core/config.js';
import { createElement } from '../../utils/dom.js';
import { isValidQuickTabUrl } from '../../utils/storage-utils.js';

// v1.6.3.4-v8 - Default dimensions for fallback when invalid values provided
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const DEFAULT_LEFT = 100;
const DEFAULT_TOP = 100;

/**
 * QuickTabWindow class - Manages a single Quick Tab overlay instance
 */
export class QuickTabWindow {
  constructor(options) {
    // v1.6.3.4-v6 - FIX Issue #2: Validate URL before creating window
    // Uses shared isValidQuickTabUrl from storage-utils.js
    if (!isValidQuickTabUrl(options.url)) {
      console.error('[QuickTabWindow] REJECTED: Invalid URL for Quick Tab creation:', {
        id: options.id,
        url: options.url,
        reason: 'URL validation failed (undefined, malformed, or invalid protocol)'
      });
      throw new Error(`Invalid URL for Quick Tab: ${options.url}`);
    }
    
    // v1.6.0 Phase 2.4 - Extract initialization methods to reduce complexity
    this._initializeBasicProperties(options);
    this._initializePositionAndSize(options);
    this._initializeVisibility(options);
    this._initializeCallbacks(options);
    this._initializeState();
  }

  /**
   * Initialize basic properties (id, url, title, etc.)
   * v1.6.3.4-v6 - FIX Issue #2: Log URL for debugging
   */
  _initializeBasicProperties(options) {
    this.id = options.id;
    this.url = options.url;
    this.title = options.title || 'Quick Tab';
    this.cookieStoreId = options.cookieStoreId || 'firefox-default';
    // v1.6.3.2 - Debug ID display setting (from options, falls back to false)
    this.showDebugId = options.showDebugId ?? false;
    
    // v1.6.3.4-v6 - FIX Issue #2: Log URL for debugging ghost iframe issues
    console.log('[QuickTabWindow] Created with URL:', { id: this.id, url: this.url });
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
   * v1.6.3.5-v5 - FIX Issue #2: Added currentTabId as instance property (removes global access)
   */
  _initializeVisibility(options) {
    this.minimized = options.minimized || false;
    // v1.5.9.13 - Replace pinnedToUrl with solo/mute arrays
    this.soloedOnTabs = options.soloedOnTabs || [];
    this.mutedOnTabs = options.mutedOnTabs || [];
    // v1.6.3.5-v5 - FIX Issue #2: Store currentTabId as instance property
    // This removes tight coupling to window.quickTabsManager.currentTabId
    this.currentTabId = options.currentTabId ?? null;
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
   * Re-wire callbacks after restore to capture fresh execution context
   * v1.6.3.5-v11 - FIX Issue #1: Stale closure references after restore
   * 
   * After browser restart with hydration OR minimize/restore cycle, the original
   * callbacks may reference stale closure variables from construction time.
   * This method allows replacing callbacks with fresh versions that capture
   * the CURRENT handler context.
   * 
   * @param {Object} callbacks - Object containing fresh callback functions
   * @returns {boolean} True if any callbacks were rewired
   */
  rewireCallbacks(callbacks) {
    const callbackNames = [
      'onDestroy',
      'onMinimize',
      'onFocus',
      'onPositionChange',
      'onPositionChangeEnd',
      'onSizeChange',
      'onSizeChangeEnd',
      'onSolo',
      'onMute'
    ];
    const rewired = [];
    
    callbackNames.forEach(name => {
      if (callbacks[name] && typeof callbacks[name] === 'function') {
        this[name] = callbacks[name];
        rewired.push(name);
      }
    });
    
    console.log('[QuickTabWindow][rewireCallbacks] Re-wired callbacks:', {
      id: this.id,
      rewired,
      rewiredCount: rewired.length,
      totalCallbacks: callbackNames.length
    });
    
    return rewired.length > 0;
  }

  /**
   * Initialize internal state properties
   * v1.6.3.5-v5 - FIX Issue #6: Removed lastPositionUpdate/lastSizeUpdate fields (dead code)
   * v1.6.3.5-v11 - FIX Issue #4: Add isMinimizing, isRestoring operation-specific flags
   */
  _initializeState() {
    this.container = null;
    this.iframe = null;
    this.rendered = false; // v1.5.9.10 - Track rendering state to prevent rendering bugs
    this.destroyed = false; // v1.6.3.2 - Track destroyed state to prevent ghost events
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
    // v1.6.3.5-v5 - FIX Issue #6: Removed lastPositionUpdate/lastSizeUpdate (unused timestamp tracking)
    // These fields were set during updatePosition/updateSize but never read by any code.
    // They were intended for cross-tab sync conflict resolution which was removed in v1.6.3.
    
    // v1.6.3.5-v11 - FIX Issue #4: Operation-specific flags replace time-based callback suppression
    // These flags are checked by callbacks to determine if they should be suppressed
    // instead of using a broad time-based window that suppresses ALL callbacks
    this.isMinimizing = false;
    this.isRestoring = false;
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

      console.log(
        `[QuickTabWindow] Processed YouTube URL for autoplay prevention: ${urlObj.toString()}`
      );
      return urlObj.toString();
    } catch (err) {
      console.error('[QuickTabWindow] Error processing URL for autoplay:', err);
      return url; // Return original URL on error
    }
  }

  /**
   * Create and render the Quick Tab window
   * v1.6.3.4-v8 - FIX Issues #1, #6: Enhanced logging to verify correct dimensions are used
   * v1.6.3.4-v2 - FIX Issue #4: Add DOM dimension verification after container creation
   * v1.6.3.4-v11 - Refactored to extract helper methods for improved code health
   * v1.6.3.5-v10 - FIX Issue #3: Apply z-index AFTER appendChild and force reflow
   */
  render() {
    if (this.container) {
      console.warn('[QuickTabWindow] Already rendered:', this.id);
      return this.container;
    }

    // Step 1: Validate and normalize dimensions
    const dimensions = this._validateAndNormalizeDimensions();

    // Step 2: Create container
    this._createContainer(dimensions);

    // Step 3: Create and attach titlebar
    const titlebar = this._createTitlebar();
    this.container.appendChild(titlebar);

    // Step 4: Create and attach iframe
    this._createIframe();
    this.container.appendChild(this.iframe);
    this.titlebarBuilder.config.iframe = this.iframe;
    this.setupIframeLoadHandler();

    // Step 5: Add to document and mark as rendered
    document.body.appendChild(this.container);
    this.rendered = true;
    
    // v1.6.3.5-v10 - FIX Issue #3: Apply z-index AFTER appendChild
    // When z-index is set before the element is in the DOM, the browser may not
    // properly create a stacking context. Setting z-index after appendChild and
    // forcing a reflow ensures the z-index takes effect immediately.
    this._applyZIndexAfterAppend();

    // Step 6: Apply anti-flash positioning
    this._setupAntiFlashPositioning(dimensions);

    // Step 7: Setup controllers
    this._setupDragController(titlebar);
    this._setupResizeController();
    this.setupFocusHandlers();

    console.log('[QuickTabWindow] Rendered:', this.id);
    
    // v1.6.3.5-v12 - FIX Issue #3: Log render completion with full container state
    console.log('[QuickTabWindow][render] Render completed - container established:', {
      id: this.id,
      hasContainer: !!this.container,
      isAttachedToDOM: !!(this.container?.parentNode),
      isRendered: this.isRendered()
    });
    
    return this.container;
  }
  
  /**
   * Apply z-index after container is appended to DOM and force reflow
   * v1.6.3.5-v10 - FIX Issue #3: Ensures proper stacking context creation
   * 
   * Setting z-index before appendChild may not create the stacking context
   * correctly in all browsers. By setting it after the element is in the DOM
   * and forcing a reflow (by reading offsetHeight), we ensure the browser
   * has properly computed the stacking context.
   * 
   * @private
   */
  _applyZIndexAfterAppend() {
    if (!this.container) return;
    
    // Re-apply z-index to ensure it takes effect after appendChild
    this.container.style.zIndex = this.zIndex.toString();
    
    // Force browser reflow to ensure z-index is applied immediately
    // Reading offsetHeight triggers a synchronous layout calculation
    // Using void operator to explicitly indicate intentional side-effect
    void this.container.offsetHeight;
    
    // Verify z-index was applied correctly (defensive check for test environment)
    let verifiedZIndex = 'unknown';
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      try {
        const computedStyle = window.getComputedStyle(this.container);
        verifiedZIndex = computedStyle.zIndex;
      } catch (_e) {
        // getComputedStyle may fail in test environments
        verifiedZIndex = this.container.style.zIndex;
      }
    } else {
      verifiedZIndex = this.container.style.zIndex;
    }
    
    console.log('[QuickTabWindow] Z-index applied after appendChild:', {
      id: this.id,
      targetZIndex: this.zIndex,
      verifiedZIndex,
      position: this.container.style.position
    });
  }

  /**
   * Validate and normalize dimensions with fallback to defaults
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * @private
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  _validateAndNormalizeDimensions() {
    console.log('[QuickTabWindow] render() called with dimensions:', {
      id: this.id,
      left: this.left,
      top: this.top,
      width: this.width,
      height: this.height
    });

    const targetLeft = Number.isFinite(this.left) ? this.left : DEFAULT_LEFT;
    const targetTop = Number.isFinite(this.top) ? this.top : DEFAULT_TOP;
    const targetWidth = Number.isFinite(this.width) && this.width > 0 ? this.width : DEFAULT_WIDTH;
    const targetHeight = Number.isFinite(this.height) && this.height > 0 ? this.height : DEFAULT_HEIGHT;

    this.left = targetLeft;
    this.top = targetTop;
    this.width = targetWidth;
    this.height = targetHeight;

    console.log('[QuickTabWindow] Applying dimensions to DOM:', {
      id: this.id,
      width: targetWidth,
      height: targetHeight,
      left: targetLeft,
      top: targetTop
    });

    return { left: targetLeft, top: targetTop, width: targetWidth, height: targetHeight };
  }

  /**
   * Create the main container element
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * v1.6.3.5-v9 - FIX Diagnostic Issue #7: Add __quickTabWindow property for DOM recovery
   * v1.6.3.5-v9 - FIX Diagnostic Issue #7: Add data-quicktab-id attribute for DOM querying
   * @private
   * @param {{ width: number, height: number }} dimensions
   */
  _createContainer(dimensions) {
    this.container = createElement('div', {
      id: `quick-tab-${this.id}`,
      className: 'quick-tab-window',
      style: {
        position: 'fixed',
        left: '-9999px',
        top: '-9999px',
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
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

    // v1.6.3.5-v9 - FIX Diagnostic Issue #7: Add data-quicktab-id attribute for DOM querying
    // This allows UICoordinator to find orphaned DOM elements via querySelector
    this.container.setAttribute('data-quicktab-id', this.id);
    
    // v1.6.3.5-v9 - FIX Diagnostic Issue #7: Store instance reference on container element
    // This enables UICoordinator to recover orphaned windows instead of creating duplicates
    // Pattern: DOM element → QuickTabWindow instance (reverse lookup)
    this.container.__quickTabWindow = this;

    console.log('[QuickTabWindow] DOM dimensions AFTER createElement:', {
      id: this.id,
      'container.style.width': this.container.style.width,
      'container.style.height': this.container.style.height,
      'container.style.left': this.container.style.left,
      'container.style.top': this.container.style.top,
      'container.style.zIndex': this.container.style.zIndex,
      'data-quicktab-id': this.container.getAttribute('data-quicktab-id'),
      '__quickTabWindow': !!this.container.__quickTabWindow
    });
  }

  /**
   * Create titlebar using TitlebarBuilder
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * @private
   * @returns {HTMLElement} The titlebar element
   */
  _createTitlebar() {
    this.titlebarBuilder = new TitlebarBuilder(
      {
        id: this.id,
        title: this.title,
        url: this.url,
        soloedOnTabs: this.soloedOnTabs,
        mutedOnTabs: this.mutedOnTabs,
        currentTabId: this.currentTabId,
        iframe: null,
        showDebugId: this.showDebugId
      },
      {
        onClose: () => this.destroy(),
        onMinimize: () => this.minimize(),
        onSolo: btn => this.toggleSolo(btn),
        onMute: btn => this.toggleMute(btn),
        onOpenInTab: async () => {
          const currentSrc = this.iframe.src || this.iframe.getAttribute('data-deferred-src');
          await browser.runtime.sendMessage({
            action: 'openTab',
            url: currentSrc,
            switchFocus: true
          });
          const settings = await browser.storage.local.get({ quickTabCloseOnOpen: false });
          if (settings.quickTabCloseOnOpen) {
            this.destroy();
          }
        }
      }
    );

    const titlebar = this.titlebarBuilder.build();
    this.soloButton = this.titlebarBuilder.soloButton;
    this.muteButton = this.titlebarBuilder.muteButton;
    return titlebar;
  }

  /**
   * Create iframe content area
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * @private
   */
  _createIframe() {
    const processedUrl = this._processUrlForAutoplay(this.url);
    this.iframe = createElement('iframe', {
      src: processedUrl,
      style: {
        flex: '1',
        border: 'none',
        width: '100%',
        height: 'calc(100% - 40px)'
      },
      sandbox: 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
      allow: 'picture-in-picture; fullscreen'
    });
  }

  /**
   * Apply anti-flash positioning after a frame
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * @private
   * @param {{ left: number, top: number }} dimensions
   */
  _setupAntiFlashPositioning(dimensions) {
    requestAnimationFrame(() => {
      this.container.style.left = `${dimensions.left}px`;
      this.container.style.top = `${dimensions.top}px`;
      this.container.style.visibility = 'visible';
      this.container.style.opacity = '1';

      console.log('[QuickTabWindow] DOM dimensions AFTER position correction (final):', {
        id: this.id,
        'container.style.left': this.container.style.left,
        'container.style.top': this.container.style.top,
        'container.style.width': this.container.style.width,
        'container.style.height': this.container.style.height
      });
    });
  }

  /**
   * Setup DragController with callbacks
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * @private
   * @param {HTMLElement} titlebar - The titlebar element for drag handling
   */
  _setupDragController(titlebar) {
    console.log('[QuickTabWindow] Wiring DragController callbacks:', {
      id: this.id,
      hasOnFocus: typeof this.onFocus === 'function',
      hasOnPositionChange: typeof this.onPositionChange === 'function',
      hasOnPositionChangeEnd: typeof this.onPositionChangeEnd === 'function'
    });

    this.dragController = new DragController(titlebar, {
      onDragStart: (x, y) => this._handleDragStart(x, y),
      onDrag: (newX, newY) => this._handleDrag(newX, newY),
      onDragEnd: (finalX, finalY) => this._handleDragEnd(finalX, finalY),
      onDragCancel: (lastX, lastY) => this._handleDragCancel(lastX, lastY)
    });
  }

  /**
   * Handle drag start event
   * v1.6.3.4-v11 - Extracted from render() callback
   * @private
   */
  _handleDragStart(x, y) {
    console.log('[QuickTabWindow] Drag started:', this.id, x, y);
    this.isDragging = true;
    if (this.onFocus) {
      console.log('[QuickTabWindow] Bringing to front via onFocus callback:', this.id);
      this.onFocus(this.id);
    } else {
      console.warn('[QuickTabWindow] onFocus callback not wired for drag:', this.id);
    }
  }

  /**
   * Handle drag event (position update)
   * v1.6.3.4-v11 - Extracted from render() callback
   * @private
   */
  _handleDrag(newX, newY) {
    this.left = newX;
    this.top = newY;
    this.container.style.left = `${newX}px`;
    this.container.style.top = `${newY}px`;

    if (this.onPositionChange) {
      this.onPositionChange(this.id, newX, newY);
    }
  }

  /**
   * Handle drag end event
   * v1.6.3.4-v11 - Extracted from render() callback
   * @private
   */
  _handleDragEnd(finalX, finalY) {
    console.log('[QuickTabWindow] Drag ended:', this.id, finalX, finalY);
    this.isDragging = false;

    if (this.onPositionChangeEnd) {
      console.log('[QuickTabWindow] Calling onPositionChangeEnd callback:', this.id);
      this.onPositionChangeEnd(this.id, finalX, finalY);
    } else {
      console.warn('[QuickTabWindow] onPositionChangeEnd callback not wired:', this.id);
    }
  }

  /**
   * Handle drag cancel event (emergency save)
   * v1.6.3.4-v11 - Extracted from render() callback
   * @private
   */
  _handleDragCancel(lastX, lastY) {
    console.log('[QuickTabWindow] Drag cancelled:', this.id, lastX, lastY);
    this.isDragging = false;

    if (this.onPositionChangeEnd) {
      this.onPositionChangeEnd(this.id, lastX, lastY);
    }
  }

  /**
   * Setup ResizeController
   * v1.6.3.4-v11 - Extracted from render() to reduce complexity
   * @private
   */
  _setupResizeController() {
    console.log('[QuickTabWindow] Wiring ResizeController callbacks:', {
      id: this.id,
      hasOnSizeChange: typeof this.onSizeChange === 'function',
      hasOnSizeChangeEnd: typeof this.onSizeChangeEnd === 'function'
    });

    this.resizeController = new ResizeController(this, {
      minWidth: 400,
      minHeight: 300
    });
    this.resizeController.attachHandles();
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
   * Pause any playing media (video/audio) in the iframe
   * v1.6.3.2 - Feature: Video Pause on Minimize
   * v1.6.3.4-v11 - Refactored to extract helpers for improved code health
   *
   * Attempts to pause media using:
   * 1. Direct DOM access for same-origin iframes
   * 2. postMessage API for YouTube embeds (cross-origin)
   *
   * @private
   */
  _pauseMediaInIframe() {
    if (!this.iframe) {
      return;
    }

    // Try same-origin approach first
    if (this._pauseSameOriginMedia()) {
      return;
    }

    // Fall back to postMessage for cross-origin (YouTube)
    this._pauseYouTubeViaPostMessage();
  }

  /**
   * Attempt to pause media via direct DOM access (same-origin only)
   * v1.6.3.4-v11 - Extracted from _pauseMediaInIframe() to reduce complexity
   * @private
   * @returns {boolean} True if same-origin access succeeded, false otherwise
   */
  _pauseSameOriginMedia() {
    try {
      const iframeDoc = this.iframe.contentDocument || this.iframe.contentWindow?.document;
      if (!iframeDoc) {
        return false;
      }

      this._pauseVideoElements(iframeDoc);
      this._pauseAudioElements(iframeDoc);
      return true;
    } catch (_e) {
      console.log('[QuickTabWindow] Cross-origin iframe, trying postMessage:', this.id);
      return false;
    }
  }

  /**
   * Pause all video elements in a document
   * v1.6.3.4-v11 - Extracted from _pauseMediaInIframe()
   * @private
   * @param {Document} doc - The document to search for videos
   */
  _pauseVideoElements(doc) {
    const videos = doc.querySelectorAll('video');
    videos.forEach(video => {
      if (!video.paused) {
        video.pause();
        console.log('[QuickTabWindow] Paused video element:', this.id);
      }
    });
  }

  /**
   * Pause all audio elements in a document
   * v1.6.3.4-v11 - Extracted from _pauseMediaInIframe()
   * @private
   * @param {Document} doc - The document to search for audio
   */
  _pauseAudioElements(doc) {
    const audios = doc.querySelectorAll('audio');
    audios.forEach(audio => {
      if (!audio.paused) {
        audio.pause();
        console.log('[QuickTabWindow] Paused audio element:', this.id);
      }
    });
  }

  /**
   * Pause YouTube video via postMessage API (cross-origin)
   * v1.6.3.4-v11 - Extracted from _pauseMediaInIframe() to reduce complexity
   * Reference: https://developers.google.com/youtube/iframe_api_reference
   * @private
   */
  _pauseYouTubeViaPostMessage() {
    try {
      if (!this.url.includes('youtube.com') && !this.url.includes('youtu.be')) {
        return;
      }

      const pauseCommand = JSON.stringify({
        event: 'command',
        func: 'pauseVideo',
        args: []
      });
      this.iframe.contentWindow?.postMessage(pauseCommand, '*');
      console.log('[QuickTabWindow] Sent YouTube pause command via postMessage:', this.id);
    } catch (e) {
      console.warn('[QuickTabWindow] Failed to send pause command:', this.id, e.message);
    }
  }

  /**
   * Minimize the Quick Tab window
   * v1.6.3.4-v7 - FIX Issues #1, #2, #7: Properly remove DOM and cleanup event listeners
   * v1.6.3.2 - Feature: Pause media before removing DOM
   * v1.6.3.5-v11 - FIX Issues #3, #4, #5:
   *   - Issue #3: Call controller cleanup() BEFORE destroy to properly remove listeners
   *   - Issue #4: Set isMinimizing flag for operation-specific callback suppression
   *   - Issue #5: Enhanced logging throughout minimize operation
   *
   * This method now:
   * 1. Sets isMinimizing flag (for callback suppression)
   * 2. Pauses any playing media (video/audio)
   * 3. Calls cleanup() on controllers (removes event listeners)
   * 4. Destroys controllers (prevents ghost events)
   * 5. Removes container from DOM (prevents duplicate windows)
   * 6. Clears references and sets rendered=false
   * 7. Clears isMinimizing flag
   * 8. Calls onMinimize callback
   */
  minimize() {
    // v1.6.3.5-v11 - FIX Issue #4: Set operation flag for callback suppression
    this.isMinimizing = true;
    this.minimized = true;

    // Enhanced logging for console log export (Issue #1)
    console.log('[QuickTabWindow][minimize] ENTRY:', {
      id: this.id,
      url: this.url,
      title: this.title,
      position: { left: this.left, top: this.top },
      size: { width: this.width, height: this.height },
      hasDragController: !!this.dragController,
      hasResizeController: !!this.resizeController,
      hasContainer: !!this.container
    });

    // v1.6.3.2 - Feature: Pause media before removing DOM
    this._pauseMediaInIframe();

    // v1.6.3.5-v11 - FIX Issue #3: Cleanup controllers BEFORE destroy
    // This properly removes event listeners while element is still in DOM
    if (this.dragController) {
      if (this.dragController.cleanup) {
        this.dragController.cleanup();
        console.log('[QuickTabWindow][minimize] Called dragController.cleanup():', this.id);
      }
      this.dragController.destroy();
      this.dragController = null;
      console.log('[QuickTabWindow][minimize] Destroyed drag controller:', this.id);
    }

    if (this.resizeController) {
      if (this.resizeController.cleanup) {
        this.resizeController.cleanup();
        console.log('[QuickTabWindow][minimize] Called resizeController.cleanup():', this.id);
      }
      this.resizeController.detachAll();
      this.resizeController = null;
      console.log('[QuickTabWindow][minimize] Destroyed resize controller:', this.id);
    }
    
    // v1.6.3.5-v12 - FIX Issue #3: Log controller destruction for lifecycle tracking
    console.log('[QuickTabWindow][minimize] Controllers destroyed:', { id: this.id, operation: 'minimize' });

    // v1.6.3.4-v7 - FIX Issue #1: Remove container from DOM instead of display:none
    // v1.6.3.5-v12 - FIX Issue #1: Add defensive DOM query fallback when container reference is lost
    if (this.container && this.container.parentNode) {
      this.container.remove();
      console.log('[QuickTabWindow][minimize] Removed DOM element:', this.id);
    } else {
      // Container reference lost - try fallback DOM query
      // v1.6.3.5-v12 - Code Review: Use more specific selector with class to avoid conflicts
      const element = document.querySelector(`.quick-tab-window[data-quicktab-id="${CSS.escape(this.id)}"]`);
      if (element) {
        console.warn('[QuickTabWindow][minimize] Container reference lost, using fallback DOM removal:', this.id);
        element.remove();
      } else {
        console.log('[QuickTabWindow][minimize] No container or fallback DOM element found:', this.id);
      }
    }

    // v1.6.3.4-v7 - FIX Issue #1: Clear references and mark as not rendered
    this.container = null;
    
    // v1.6.3.5-v12 - FIX Issue #3: Log container reference nullification for lifecycle tracking
    console.log('[QuickTabWindow][minimize] Container reference nullified:', {
      id: this.id,
      operation: 'minimize',
      hasControllers: { drag: !!this.dragController, resize: !!this.resizeController }
    });
    
    this.iframe = null;
    this.titlebarBuilder = null;
    this.soloButton = null;
    this.muteButton = null;
    this.rendered = false;
    
    // v1.6.3.5-v11 - FIX Issue #4: Clear operation flag
    this.isMinimizing = false;

    console.log('[QuickTabWindow][minimize] EXIT (DOM removed):', {
      id: this.id,
      url: this.url,
      minimized: this.minimized,
      rendered: this.rendered
    });

    this.onMinimize(this.id);
  }

  /**
   * Restore minimized Quick Tab window
   * v1.5.9.8 - FIX: Explicitly re-apply position to ensure it's in the same place
   * v1.6.3.4-v7 - FIX Issues #1, #6: Recreate DOM via render() since minimize() removes it
   * v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call render() here!
   *   UICoordinator is the single rendering authority. restore() only updates instance state.
   *   UICoordinator.update() will detect the state change and call render() exactly once.
   * v1.6.3.4-v8 - FIX Issue #7: Log explicit warning when container is null (expected behavior)
   * v1.6.3.4-v10 - FIX Issue #1: REMOVE ALL DOM manipulation from restore()
   *   UICoordinator is the SOLE rendering authority. restore() ONLY updates instance state.
   *   Removed the `if (this.container) { ... }` block that was directly manipulating DOM.
   * v1.6.3.5-v11 - FIX Issue #4, #5:
   *   - Issue #4: Set isRestoring flag for operation-specific callback suppression
   *   - Issue #5: Enhanced logging throughout restore operation
   *
   * This method now:
   * 1. Sets isRestoring flag (for callback suppression)
   * 2. Clears minimized flag
   * 3. Logs dimensions for debugging (but does NOT manipulate DOM)
   * 4. Clears isRestoring flag
   * 5. Calls onFocus() callback to notify state change
   */
  restore() {
    // v1.6.3.5-v11 - FIX Issue #4: Set operation flag for callback suppression
    this.isRestoring = true;
    this.minimized = false;

    console.log('[QuickTabWindow][restore] ENTRY:', {
      id: this.id,
      position: { left: this.left, top: this.top },
      size: { width: this.width, height: this.height },
      hasContainer: !!this.container,
      rendered: this.rendered,
      zIndex: this.zIndex
    });

    // v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call render() here!
    // UICoordinator is the single rendering authority.
    // This method ONLY updates instance state; UICoordinator.update() handles DOM creation.
    // The duplicate window bug was caused by BOTH restore() AND update() calling render().

    // v1.6.3.4-v10 - FIX Issue #1: REMOVED ALL DOM MANIPULATION
    // Previously, this method would update container.style if this.container existed.
    // This caused a race condition where whether container exists depends on minimize/restore timing.
    // When DOM was removed during minimize but instance still held stale container reference,
    // restore() would manipulate a detached element instead of deferring to UICoordinator.
    // Now UICoordinator is the SOLE authority for DOM manipulation.
    console.log('[QuickTabWindow][restore] Container state:', {
      id: this.id,
      hasContainer: !!this.container,
      containerAttached: !!this.container?.parentNode
    });
    console.log('[QuickTabWindow][restore] Dimensions to be used by UICoordinator:', {
      left: this.left,
      top: this.top,
      width: this.width,
      height: this.height
    });

    // v1.6.3.5-v11 - FIX Issue #4: Clear operation flag
    this.isRestoring = false;

    console.log('[QuickTabWindow][restore] EXIT (state updated, render deferred to UICoordinator):', {
      id: this.id,
      minimized: this.minimized,
      isRestoring: this.isRestoring
    });
    
    // v1.6.3.5-v12 - FIX Issue #3: Log restore completion with full instance state
    console.log('[QuickTabWindow][restore] Restore completed - instance state:', {
      id: this.id,
      minimized: this.minimized,
      hasContainer: !!this.container,
      isRendered: this.isRendered(),
      hasDragController: !!this.dragController,
      hasResizeController: !!this.resizeController
    });

    this.onFocus(this.id);
  }

  // v1.6.0 Phase 2.9 Task 4 - applyZoom() removed (now in TitlebarBuilder._applyZoom())

  /**
   * Update z-index for stacking
   * v1.6.3.4-v5 - FIX Bug #4: Add null/undefined safety check for newZIndex
   * v1.6.3.5-v11 - FIX Issue #8, #9:
   *   - Issue #8: Defensive check for container existence and DOM attachment
   *   - Issue #9: Comprehensive z-index operation logging
   */
  updateZIndex(newZIndex) {
    const oldZIndex = this.zIndex;
    
    // v1.6.3.5-v11 - FIX Issue #9: Log entry with parameters
    console.log('[QuickTabWindow][updateZIndex] ENTRY:', {
      id: this.id,
      oldZIndex,
      newZIndex,
      hasContainer: !!this.container,
      containerAttached: !!this.container?.parentNode
    });
    
    // v1.6.3.4-v5 - FIX Bug #4: Guard against null/undefined to prevent TypeError
    if (newZIndex === undefined || newZIndex === null) {
      console.warn('[QuickTabWindow][updateZIndex] Called with null/undefined, skipping:', {
        id: this.id,
        oldZIndex
      });
      return;
    }

    this.zIndex = newZIndex;
    
    // v1.6.3.5-v11 - FIX Issue #8: Defensive container check
    if (!this.container) {
      console.warn('[QuickTabWindow][updateZIndex] No container - z-index stored but not applied to DOM:', {
        id: this.id,
        newZIndex
      });
      return;
    }
    
    // v1.6.3.5-v11 - FIX Issue #8: Verify container is attached to DOM
    if (!this.container.parentNode) {
      console.warn('[QuickTabWindow][updateZIndex] Container not attached to DOM:', {
        id: this.id,
        newZIndex
      });
      // Still update the style in case container is re-attached later
    }
    
    this.container.style.zIndex = newZIndex.toString();
    
    // v1.6.3.5-v11 - FIX Issue #9: Log completion and verify update
    console.log('[QuickTabWindow][updateZIndex] EXIT:', {
      id: this.id,
      oldZIndex,
      newZIndex,
      domZIndex: this.container.style.zIndex,
      verified: this.container.style.zIndex === newZIndex.toString()
    });
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
   * v1.6.3.5-v5 - FIX Issue #2: Use instance currentTabId instead of global access
   */
  isCurrentTabSoloed() {
    const tabId = this._getCurrentTabId();
    return (
      this.soloedOnTabs &&
      this.soloedOnTabs.length > 0 &&
      tabId !== null &&
      this.soloedOnTabs.includes(tabId)
    );
  }

  /**
   * v1.5.9.13 - Check if current tab is in mute list
   * v1.6.3.5-v5 - FIX Issue #2: Use instance currentTabId instead of global access
   */
  isCurrentTabMuted() {
    const tabId = this._getCurrentTabId();
    return (
      this.mutedOnTabs &&
      this.mutedOnTabs.length > 0 &&
      tabId !== null &&
      this.mutedOnTabs.includes(tabId)
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
   * Get the current tab ID, preferring instance property over global fallback
   * v1.6.3.5-v5 - FIX Issue #2: Helper for decoupled currentTabId access
   * @private
   * @returns {number|null} Current tab ID or null if unavailable
   */
  _getCurrentTabId() {
    // Prefer instance property (set via constructor options or setCurrentTabId)
    if (this.currentTabId !== null && this.currentTabId !== undefined) {
      return this.currentTabId;
    }
    // Fallback to global for backward compatibility (with deprecation warning)
    if (window.quickTabsManager?.currentTabId) {
      console.warn('[QuickTabWindow] Using global quickTabsManager.currentTabId fallback. Pass currentTabId in constructor options instead.');
      return window.quickTabsManager.currentTabId;
    }
    return null;
  }

  /**
   * Set the current tab ID (for updating after construction)
   * v1.6.3.5-v5 - FIX Issue #2: Allow updating currentTabId without global access
   * @param {number} tabId - The new current tab ID
   */
  setCurrentTabId(tabId) {
    this.currentTabId = tabId;
  }

  /**
   * Validate current tab ID availability
   * v1.6.3.5-v5 - FIX Issue #2: Use instance method instead of global access
   * @private
   * @param {string} action - Action name for logging ('solo' or 'mute')
   * @returns {number|null} Current tab ID or null if unavailable
   */
  _validateCurrentTabId(action) {
    console.log(
      `[QuickTabWindow] toggle${action.charAt(0).toUpperCase() + action.slice(1)} called for:`,
      this.id
    );

    const tabId = this._getCurrentTabId();
    if (tabId === null) {
      console.warn(`[QuickTabWindow] Cannot toggle ${action} - no current tab ID available. Pass currentTabId in constructor or call setCurrentTabId().`);
      return null;
    }

    return tabId;
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
   * Set position of Quick Tab window
   * @deprecated v1.6.3.5-v5 - FIX Issue #1: This method bypasses UpdateHandler.
   * Use handlePositionChange/handlePositionChangeEnd through QuickTabsManager instead.
   * @param {number} left - X position
   * @param {number} top - Y position
   */
  setPosition(left, top) {
    console.warn('[QuickTabWindow] DEPRECATED: setPosition() bypasses UpdateHandler. Use QuickTabsManager.handlePositionChange() instead.');
    this.left = left;
    this.top = top;
    if (this.container) {
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
    }
  }

  /**
   * Set size of Quick Tab window
   * @deprecated v1.6.3.5-v5 - FIX Issue #1: This method bypasses UpdateHandler.
   * Use handleSizeChange/handleSizeChangeEnd through QuickTabsManager instead.
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   */
  setSize(width, height) {
    console.warn('[QuickTabWindow] DEPRECATED: setSize() bypasses UpdateHandler. Use QuickTabsManager.handleSizeChange() instead.');
    this.width = width;
    this.height = height;
    if (this.container) {
      this.container.style.width = `${width}px`;
      this.container.style.height = `${height}px`;
    }
  }

  /**
   * Update position of Quick Tab window
   * @deprecated v1.6.3.5-v5 - FIX Issue #1: This method bypasses UpdateHandler.
   * Use handlePositionChange/handlePositionChangeEnd through QuickTabsManager instead.
   * Note: The timestamp tracking (lastPositionUpdate) was removed in v1.6.3.5-v5 as dead code.
   *
   * @param {number} left - X position in pixels
   * @param {number} top - Y position in pixels
   */
  updatePosition(left, top) {
    console.warn('[QuickTabWindow] DEPRECATED: updatePosition() bypasses UpdateHandler. Use QuickTabsManager.handlePositionChange() instead.');
    this.setPosition(left, top);
    // v1.6.3.5-v5 - FIX Issue #6: Removed lastPositionUpdate timestamp tracking (dead code)
  }

  /**
   * Update size of Quick Tab window
   * @deprecated v1.6.3.5-v5 - FIX Issue #1: This method bypasses UpdateHandler.
   * Use handleSizeChange/handleSizeChangeEnd through QuickTabsManager instead.
   * Note: The timestamp tracking (lastSizeUpdate) was removed in v1.6.3.5-v5 as dead code.
   *
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   */
  updateSize(width, height) {
    console.warn('[QuickTabWindow] DEPRECATED: updateSize() bypasses UpdateHandler. Use QuickTabsManager.handleSizeChange() instead.');
    this.setSize(width, height);
    // v1.6.3.5-v5 - FIX Issue #6: Removed lastSizeUpdate timestamp tracking (dead code)
  }

  /**
   * v1.5.9.10 - Check if Quick Tab is rendered on the page
   * v1.6.3.4-v11 - FIX Issue #6: Ensure strict boolean return (not truthy object)
   *   The && chain was returning the last truthy value (parentNode object)
   *   instead of a boolean, causing conditional logic to incorrectly treat
   *   destroyed windows as "attached" when the result was an empty object.
   * @returns {boolean} True if rendered and attached to DOM
   */
  isRendered() {
    return Boolean(this.rendered && this.container && this.container.parentNode);
  }
  
  /**
   * Log warning if rendered flag and container state are out of sync
   * v1.6.3.5-v12 - FIX Issue E: Helper to detect and log state desync at key lifecycle points
   * @param {string} operation - Name of the current operation for logging context
   * @private
   */
  _logIfStateDesync(operation) {
    if (this.rendered && (!this.container || !this.container.parentNode)) {
      console.warn('[QuickTabWindow] State desync detected:', {
        id: this.id,
        operation,
        rendered: this.rendered,
        hasContainer: !!this.container,
        containerAttached: !!(this.container?.parentNode)
      });
    }
    if (!this.rendered && this.container && this.container.parentNode) {
      console.warn('[QuickTabWindow] State desync detected:', {
        id: this.id,
        operation,
        rendered: this.rendered,
        hasContainer: true,
        containerAttached: true
      });
    }
  }

  /**
   * Update debug ID display dynamically
   * v1.6.3.4-v9 - FIX Issue #4: Update already-rendered Quick Tab titlebars when settings change
   * @param {boolean} showDebugId - Whether to show debug ID in titlebar
   */
  updateDebugIdDisplay(showDebugId) {
    // Update instance property
    this.showDebugId = showDebugId;

    // Delegate to TitlebarBuilder if available
    if (this.titlebarBuilder) {
      this.titlebarBuilder.updateDebugIdDisplay(showDebugId);
    } else {
      console.log('[QuickTabWindow] No titlebarBuilder available for debug ID update:', this.id);
    }
  }

  /**
   * Destroy the Quick Tab window
   * v1.6.3.2 - FIX Issue #5: Ensure all event listeners are removed BEFORE DOM removal
   *   Order is critical: cleanup controllers → remove handlers → remove DOM → clear references
   * v1.6.3.4-v3 - FIX Issue #4: Verify onDestroy callback exists before calling, with logging
   */
  destroy() {
    console.log('[QuickTabWindow] Destroying:', this.id);

    // v1.6.3.2 - FIX Issue #5: Set destroyed flag early to prevent new events
    this.destroyed = true;

    // v1.6.0 Phase 2.9 - Cleanup drag controller FIRST (removes drag event listeners)
    if (this.dragController) {
      this.dragController.destroy();
      this.dragController = null;
      console.log('[QuickTabWindow] Cleaned up drag controller');
    }

    // v1.6.0 Phase 2.4 - Cleanup resize controller (removes resize handles and listeners)
    if (this.resizeController) {
      this.resizeController.detachAll();
      this.resizeController = null;
      console.log('[QuickTabWindow] Cleaned up resize controller');
    }

    // v1.6.3.2 - FIX Issue #5: Remove focus handler before DOM removal
    // Note: The mousedown handler for focus is added via addEventListener but not tracked
    // This is acceptable since removing the container also removes its listeners

    // v1.6.3.2 - FIX Issue #5: Clear titlebar builder references
    if (this.titlebarBuilder) {
      this.titlebarBuilder = null;
    }

    // v1.6.3.2 - FIX Issue #5: Clear button references
    this.soloButton = null;
    this.muteButton = null;

    // v1.6.3.2 - FIX Issue #5: Now remove DOM AFTER all event handlers are cleaned up
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.iframe = null;
      this.rendered = false; // v1.5.9.10 - Reset rendering state
      console.log('[QuickTabWindow] Removed DOM element');
    }

    // v1.6.3.4-v3 - FIX Issue #4: Verify onDestroy callback exists and is a function
    console.log('[QuickTabWindow] Checking onDestroy callback:', {
      id: this.id,
      hasOnDestroy: typeof this.onDestroy === 'function',
      callbackType: typeof this.onDestroy
    });
    
    if (typeof this.onDestroy === 'function') {
      try {
        this.onDestroy(this.id);
        console.log('[QuickTabWindow] onDestroy callback executed successfully:', this.id);
      } catch (err) {
        console.error('[QuickTabWindow] onDestroy callback failed:', this.id, err.message);
      }
    } else {
      console.warn('[QuickTabWindow] onDestroy callback not wired or not a function:', this.id);
    }
    
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
