/**
 * Quick Tabs Manager Persistent Floating Panel
 * Facade integrating all panel components
 *
 * v1.6.0 - Phase 2.10: Refactored to facade pattern
 * Previously 1497 lines → Now ~300 lines facade orchestrating components
 *
 * Components:
 * - PanelUIBuilder: DOM creation and rendering
 * - PanelDragController: Drag handling
 * - PanelResizeController: Resize handling
 * - PanelStateManager: State persistence and BroadcastChannel
 * - PanelContentManager: Content updates and Quick Tab operations
 *
 * Features:
 * - Persistent across page navigations (re-injected on load)
 * - Draggable using Pointer Events API
 * - Resizable from all edges/corners
 * - Position/size persisted to browser.storage.local
 * - Container-aware Quick Tabs categorization
 * - Action buttons: Close Minimized, Close All
 * - Individual tab actions: Minimize, Restore, Close, Go to Tab
 */

import { PanelContentManager } from './panel/PanelContentManager.js';
import { PanelDragController } from './panel/PanelDragController.js';
import { PanelResizeController } from './panel/PanelResizeController.js';
import { PanelStateManager } from './panel/PanelStateManager.js';
import { PanelUIBuilder } from './panel/PanelUIBuilder.js';
import { debug } from '../../utils/debug.js';

/**
 * PanelManager - Facade for Quick Tabs Manager Panel
 */
export class PanelManager {
  /**
   * Create a new PanelManager
   * @param {Object} quickTabsManager - QuickTabsManager instance
   */
  constructor(quickTabsManager) {
    this.quickTabsManager = quickTabsManager;
    this.panel = null;
    this.isOpen = false;
    this.currentContainerId = 'firefox-default';

    // Component instances
    this.uiBuilder = new PanelUIBuilder();
    this.dragController = null;
    this.resizeController = null;
    this.stateManager = null;
    this.contentManager = null;

    // Auto-refresh interval
    this.updateInterval = null;
  }

  /**
   * Initialize the panel
   * v1.5.9.12 - Container integration: Detect container context
   * v1.6.0.3 - Fixed initialization order: Create panel BEFORE loading state
   * v1.6.0.3 - Added document.body safety check to prevent null reference error
   * v1.6.1 - CRITICAL FIX: Initialize in correct order to prevent null reference errors
   */
  async init() {
    debug('[PanelManager] Initializing...');

    // Detect container context
    await this.detectContainerContext();

    // Inject CSS early (needed for panel creation)
    // v1.6.0.3 - FIX: injectStyles() is a static method, not instance method
    PanelUIBuilder.injectStyles();

    // Create panel with default state (hidden by default)
    // CRITICAL: Panel must exist BEFORE state manager callbacks are invoked
    const defaultState = {
      left: 100,
      top: 100,
      width: 350,
      height: 500,
      isOpen: false
    };
    // v1.6.0.3 - FIX: createPanel() is a static method, not instance method
    this.panel = PanelUIBuilder.createPanel(defaultState);

    // Safety check: Ensure document.body exists before appending
    // (should always be true with run_at: "document_idle", but defensive programming)
    if (!document.body) {
      throw new Error('[PanelManager] document.body is null - DOM not ready!');
    }
    document.body.appendChild(this.panel);

    // Initialize state manager FIRST (needed by controllers)
    // v1.6.1 - State will be loaded and callback will be called during init()
    this.stateManager = new PanelStateManager({
      onStateLoaded: state => this._applyState(state),
      onBroadcastReceived: (type, data) => this._handleBroadcast(type, data)
    });
    await this.stateManager.init();

    // Now initialize controllers (they need stateManager to exist)
    // v1.6.1 - contentManager needs stateManager in its options
    this._initializeControllers();

    // Apply loaded state to panel AGAIN after all components are ready
    // v1.6.1 - This ensures isOpen state is applied after contentManager exists
    const savedState = this.stateManager.getState();
    this._applyState(savedState);

    // Set up message listener for toggle command
    this.setupMessageListener();

    debug('[PanelManager] Initialized');
  }

  /**
   * Detect and store the current tab's container context
   * v1.5.9.12 - Container integration
   * v1.6.0.1 - Fixed to use message passing (browser.tabs not available in content scripts)
   * @private
   */
  async detectContainerContext() {
    this.currentContainerId = 'firefox-default';

    try {
      // Content scripts cannot access browser.tabs API
      // Must request container info from background script
      const response = await browser.runtime.sendMessage({
        action: 'GET_CONTAINER_CONTEXT'
      });

      if (response && response.success && response.cookieStoreId) {
        this.currentContainerId = response.cookieStoreId;
        debug(`[PanelManager] Container: ${this.currentContainerId}`);
      } else {
        debug('[PanelManager] Using default container (no response from background)');
      }
    } catch (err) {
      debug('[PanelManager] Failed to detect container:', err);
    }
  }

  /**
   * Initialize all controllers
   * @private
   */
  _initializeControllers() {
    const handle = this.panel.querySelector('.panel-header');

    // Drag controller
    this.dragController = new PanelDragController(this.panel, handle, {
      onDragEnd: (_left, _top) => {
        this.stateManager.savePanelState(this.panel);
      },
      onBroadcast: data => {
        this.stateManager.broadcast('PANEL_POSITION_UPDATED', data);
      }
    });

    // Resize controller
    this.resizeController = new PanelResizeController(this.panel, {
      onSizeChange: (_width, _height) => {
        // Optional: Update UI during resize
      },
      onPositionChange: (_left, _top) => {
        // Optional: Update UI during position change
      },
      onResizeEnd: (_w, _h, _l, _t) => {
        this.stateManager.savePanelState(this.panel);
      },
      onBroadcast: data => {
        this.stateManager.broadcast('PANEL_SIZE_UPDATED', {
          width: data.width,
          height: data.height
        });
        this.stateManager.broadcast('PANEL_POSITION_UPDATED', {
          left: data.left,
          top: data.top
        });
      }
    });

    // Content manager
    // v1.6.2.3 - FIX: Pass EventBus and live state managers for real-time updates
    this.contentManager = new PanelContentManager(this.panel, {
      uiBuilder: this.uiBuilder,
      stateManager: this.stateManager,
      quickTabsManager: this.quickTabsManager,
      currentContainerId: this.currentContainerId,
      // NEW: Add these for real-time updates (fixes panel not updating issue)
      eventBus: this.quickTabsManager.internalEventBus,
      liveStateManager: this.quickTabsManager.state,
      minimizedManager: this.quickTabsManager.minimizedManager
    });
    this.contentManager.setOnClose(() => this.close());
    this.contentManager.setupEventListeners();
  }

  /**
   * Setup message listener for toggle command
   * v1.6.0.12 - FIX: Removed duplicate listener (already handled in content.js)
   * This was causing panel to toggle twice when Ctrl+Alt+Z was pressed
   */
  setupMessageListener() {
    // Listener removed - toggle command is now handled only in content.js
    // This prevents the double-toggle bug where panel opens then immediately closes
  }

  /**
   * Toggle panel visibility
   */
  toggle() {
    if (!this.panel) {
      console.error('[PanelManager] Panel not initialized');
      return;
    }

    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Open panel
   */
  open() {
    if (!this.panel) {
      console.error('[PanelManager] Panel not initialized');
      return;
    }

    this.panel.style.display = 'flex';
    this.isOpen = true;
    this.stateManager.setIsOpen(true);

    // Bring to front
    this.panel.style.zIndex = '999999999';

    // Update content
    this.contentManager.setIsOpen(true);
    this.contentManager.updateContent();

    // Start auto-refresh (backup mechanism - reduced interval since events handle real-time updates)
    // v1.6.2.3 - Reduced from 2000ms to 10000ms since event listeners now handle real-time updates
    if (!this.updateInterval) {
      this.updateInterval = setInterval(() => {
        this.contentManager.updateContent();
      }, 10000);
    }

    // Save state and broadcast
    this.stateManager.savePanelState(this.panel);
    this.stateManager.broadcast('PANEL_OPENED', {});

    debug('[PanelManager] Panel opened');
  }

  /**
   * Close panel
   */
  close() {
    if (!this.panel) return;

    this.panel.style.display = 'none';
    this.isOpen = false;
    this.stateManager.setIsOpen(false);
    this.contentManager.setIsOpen(false);

    // Stop auto-refresh
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Save state and broadcast
    this.stateManager.savePanelState(this.panel);
    this.stateManager.broadcast('PANEL_CLOSED', {});

    debug('[PanelManager] Panel closed');
  }

  /**
   * Open panel silently (no broadcast)
   * Used when responding to broadcasts from other tabs
   */
  openSilent() {
    if (!this.panel) return;

    this.panel.style.display = 'flex';
    this.isOpen = true;
    this.stateManager.setIsOpen(true);
    this.contentManager.setIsOpen(true);

    // Update content
    this.contentManager.updateContent();

    // Start auto-refresh (backup mechanism)
    // v1.6.2.3 - Reduced from 2000ms to 10000ms since event listeners now handle real-time updates
    if (!this.updateInterval) {
      this.updateInterval = setInterval(() => {
        this.contentManager.updateContent();
      }, 10000);
    }

    debug('[PanelManager] Panel opened (silent)');
  }

  /**
   * Close panel silently (no broadcast)
   * Used when responding to broadcasts from other tabs
   */
  closeSilent() {
    if (!this.panel) return;

    this.panel.style.display = 'none';
    this.isOpen = false;
    this.stateManager.setIsOpen(false);
    this.contentManager.setIsOpen(false);

    // Stop auto-refresh
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    debug('[PanelManager] Panel closed (silent)');
  }

  /**
   * Apply loaded state to panel
   * v1.6.1 - CRITICAL FIX: Check if contentManager exists before calling open()
   * @param {Object} state - State object with position/size/isOpen
   * @private
   */
  _applyState(state) {
    if (!this.panel) return;

    // Apply position and size
    this.panel.style.left = `${state.left}px`;
    this.panel.style.top = `${state.top}px`;
    this.panel.style.width = `${state.width}px`;
    this.panel.style.height = `${state.height}px`;

    // Apply open state - but only if contentManager is initialized
    // v1.6.1 - Prevents null reference error during initialization
    if (state.isOpen && this.contentManager) {
      this.open();
    }
  }

  /**
   * Handle broadcast messages from other tabs
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @private
   */
  _handleBroadcast(type, data) {
    const handlers = {
      PANEL_OPENED: () => !this.isOpen && this.openSilent(),
      PANEL_CLOSED: () => this.isOpen && this.closeSilent(),
      PANEL_POSITION_UPDATED: () => this._updatePosition(data),
      PANEL_SIZE_UPDATED: () => this._updateSize(data)
    };

    const handler = handlers[type];
    if (handler) {
      handler();
    } else {
      debug(`[PanelManager] Unknown broadcast: ${type}`);
    }
  }

  /**
   * Update panel position from broadcast
   * @param {Object} data - Position data
   * @private
   */
  _updatePosition(data) {
    if (data.left === undefined || data.top === undefined) return;

    this.panel.style.left = `${data.left}px`;
    this.panel.style.top = `${data.top}px`;
    this.stateManager.savePanelStateLocal(this.panel);
  }

  /**
   * Update panel size from broadcast
   * @param {Object} data - Size data
   * @private
   */
  _updateSize(data) {
    if (data.width === undefined || data.height === undefined) return;

    this.panel.style.width = `${data.width}px`;
    this.panel.style.height = `${data.height}px`;
    this.stateManager.savePanelStateLocal(this.panel);
  }

  /**
   * Minimize a Quick Tab by ID
   * Delegates to contentManager which calls quickTabsManager.minimizeById
   * @param {string} id - Quick Tab ID
   */
  minimizeTab(id) {
    if (this.contentManager) {
      this.contentManager.handleMinimizeTab(id);
    } else {
      console.warn('[PanelManager] Cannot minimize tab - contentManager not initialized');
    }
  }

  /**
   * Restore a minimized Quick Tab by ID
   * Delegates to contentManager which calls quickTabsManager.restoreById
   * @param {string} id - Quick Tab ID
   */
  restoreTab(id) {
    if (this.contentManager) {
      this.contentManager.handleRestoreTab(id);
    } else {
      console.warn('[PanelManager] Cannot restore tab - contentManager not initialized');
    }
  }

  /**
   * Destroy panel and cleanup
   */
  destroy() {
    // Stop auto-refresh
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Destroy controllers
    if (this.dragController) {
      this.dragController.destroy();
      this.dragController = null;
    }
    if (this.resizeController) {
      this.resizeController.destroy();
      this.resizeController = null;
    }
    if (this.contentManager) {
      this.contentManager.destroy();
      this.contentManager = null;
    }
    if (this.stateManager) {
      this.stateManager.destroy();
      this.stateManager = null;
    }

    // Remove panel from DOM
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }

    debug('[PanelManager] Destroyed');
  }
}
