/**
 * Quick Tabs Manager Persistent Floating Panel
 * Implements persistent, draggable, resizable panel for managing Quick Tabs
 *
 * v1.5.8.12 - Replaces sidebar API implementation for Zen Browser compatibility
 * Based on: docs/manual/persistent-panel-implementation.md
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

import { debug } from '../../utils/debug.js';

// Panel HTML template
const PANEL_HTML = `
<div id="quick-tabs-manager-panel" class="quick-tabs-manager-panel" style="display: none;">
  <div class="panel-header">
    <span class="panel-drag-handle">≡</span>
    <h2 class="panel-title">Quick Tabs Manager</h2>
    <div class="panel-controls">
      <button class="panel-btn panel-minimize" title="Minimize Panel">−</button>
      <button class="panel-btn panel-close" title="Close Panel (Ctrl+Alt+Z)">✕</button>
    </div>
  </div>
  
  <div class="panel-actions">
    <button id="panel-closeMinimized" class="panel-btn-secondary" title="Close all minimized Quick Tabs">
      Close Minimized
    </button>
    <button id="panel-closeAll" class="panel-btn-danger" title="Close all Quick Tabs">
      Close All
    </button>
  </div>
  
  <div class="panel-stats">
    <span id="panel-totalTabs">0 Quick Tabs</span>
    <span id="panel-lastSync">Last sync: Never</span>
  </div>
  
  <div id="panel-containersList" class="panel-containers-list">
    <!-- Dynamically populated -->
  </div>
  
  <div id="panel-emptyState" class="panel-empty-state" style="display: none;">
    <div class="empty-icon">📭</div>
    <div class="empty-text">No Quick Tabs</div>
    <div class="empty-hint">Press Q while hovering over a link</div>
  </div>
</div>
`;

// Panel CSS styles
const PANEL_CSS = `
/* Quick Tabs Manager Floating Panel Styles */

.quick-tabs-manager-panel {
  position: fixed;
  top: 100px;
  right: 20px;
  width: 350px;
  height: 500px;
  background: #2d2d2d;
  border: 2px solid #555;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 999999999; /* Above all Quick Tabs */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 250px;
  min-height: 300px;
}

/* Panel Header (draggable) */
.panel-header {
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
}

.panel-header:active {
  cursor: grabbing;
}

.panel-drag-handle {
  font-size: 18px;
  color: #888;
  cursor: grab;
}

.panel-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel-controls {
  display: flex;
  gap: 4px;
}

.panel-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  color: #e0e0e0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.panel-btn:hover {
  background: #444;
}

.panel-close:hover {
  background: #ff5555;
}

/* Panel Actions */
.panel-actions {
  padding: 10px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #555;
  display: flex;
  gap: 8px;
}

.panel-btn-secondary,
.panel-btn-danger {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.panel-btn-secondary {
  background: #4a90e2;
  color: white;
}

.panel-btn-secondary:hover {
  opacity: 0.8;
}

.panel-btn-danger {
  background: #f44336;
  color: white;
}

.panel-btn-danger:hover {
  opacity: 0.8;
}

/* Panel Stats */
.panel-stats {
  padding: 8px 12px;
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #999;
}

/* Containers List */
.panel-containers-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

/* Container Section */
.panel-container-section {
  margin-bottom: 16px;
}

.panel-container-header {
  padding: 8px 12px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  background: #1e1e1e;
  border-top: 1px solid #555;
  border-bottom: 1px solid #555;
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-container-icon {
  font-size: 14px;
}

.panel-container-count {
  margin-left: auto;
  font-weight: normal;
  color: #999;
  font-size: 11px;
}

/* Quick Tab Items */
.panel-quick-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #555;
  transition: background 0.2s;
  cursor: pointer;
}

.panel-quick-tab-item:hover {
  background: #3a3a3a;
}

.panel-quick-tab-item.active {
  border-left: 3px solid #4CAF50;
  padding-left: 9px;
}

.panel-quick-tab-item.minimized {
  border-left: 3px solid #FFC107;
  padding-left: 9px;
}

.panel-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.panel-status-indicator.green {
  background: #4CAF50;
}

.panel-status-indicator.yellow {
  background: #FFC107;
}

.panel-favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.panel-tab-info {
  flex: 1;
  min-width: 0;
}

.panel-tab-title {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-tab-meta {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
}

.panel-tab-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.panel-btn-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e0e0e0;
}

.panel-btn-icon:hover {
  background: #555;
}

/* Empty State */
.panel-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #999;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 12px;
}

/* Resize Handles */
.panel-resize-handle {
  position: absolute;
  z-index: 10;
}

.panel-resize-handle.n { top: 0; left: 10px; right: 10px; height: 10px; cursor: n-resize; }
.panel-resize-handle.s { bottom: 0; left: 10px; right: 10px; height: 10px; cursor: s-resize; }
.panel-resize-handle.e { right: 0; top: 10px; bottom: 10px; width: 10px; cursor: e-resize; }
.panel-resize-handle.w { left: 0; top: 10px; bottom: 10px; width: 10px; cursor: w-resize; }
.panel-resize-handle.ne { top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; }
.panel-resize-handle.nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; }
.panel-resize-handle.se { bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; }
.panel-resize-handle.sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; }

/* Scrollbar Styling */
.panel-containers-list::-webkit-scrollbar {
  width: 8px;
}

.panel-containers-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.panel-containers-list::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 4px;
}

.panel-containers-list::-webkit-scrollbar-thumb:hover {
  background: #666;
}
`;

/**
 * PanelManager class - Manages the persistent floating panel
 */
export class PanelManager {
  constructor(quickTabsManager) {
    this.quickTabsManager = quickTabsManager;
    this.panel = null;
    this.isOpen = false;
    this.panelState = {
      left: 20,
      top: 100,
      width: 350,
      height: 500,
      isOpen: false
    };
    this.updateInterval = null;
    this.broadcastChannel = null; // v1.5.8.15 - For cross-tab panel sync
    this.currentContainerId = null; // v1.5.9.12 - Container integration: Store current container
  }

  /**
   * Initialize the panel
   * v1.5.9.12 - Container integration: Detect container context
   */
  async init() {
    debug('[PanelManager] Initializing...');

    // v1.5.9.12 - Container integration: Detect container context
    await this.detectContainerContext();

    // v1.5.8.15: Set up BroadcastChannel for cross-tab panel sync
    this.setupBroadcastChannel();

    // Inject CSS
    this.injectStyles();

    // Load saved state
    await this.loadPanelState();

    // Create panel (hidden by default)
    this.createPanel();

    // Set up message listener for toggle command
    this.setupMessageListener();

    debug('[PanelManager] Initialized');
  }

  /**
   * v1.5.9.12 - Detect and store the current tab's container context
   */
  async detectContainerContext() {
    // Default to firefox-default if detection fails
    this.currentContainerId = 'firefox-default';

    if (typeof browser === 'undefined' || !browser.tabs) {
      debug('[PanelManager] Browser tabs API not available, using default container');
      return;
    }

    try {
      // Content scripts must use tabs.query() to get current tab
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0 && tabs[0].cookieStoreId) {
        this.currentContainerId = tabs[0].cookieStoreId;
        debug(`[PanelManager] Container context detected: ${this.currentContainerId}`);
      } else {
        debug('[PanelManager] No cookieStoreId found, using default container');
      }
    } catch (err) {
      debug('[PanelManager] Failed to detect container context:', err);
    }
  }

  /**
   * v1.5.8.15 - Set up BroadcastChannel for cross-tab panel visibility sync
   * v1.5.9.8 - FIX: Added position/size sync
   */
  setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      debug('[PanelManager] BroadcastChannel not available, panel sync disabled');
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel('quick-tabs-panel-sync');

      // v1.5.9.8 - Add debounce tracking
      this.broadcastDebounce = new Map();
      this.BROADCAST_DEBOUNCE_MS = 50;

      this.broadcastChannel.onmessage = event => {
        const { type, data } = event.data;

        // v1.5.9.8 - Debounce rapid messages
        const now = Date.now();
        const lastProcessed = this.broadcastDebounce.get(type);

        if (lastProcessed && now - lastProcessed < this.BROADCAST_DEBOUNCE_MS) {
          debug(`[PanelManager] Ignoring duplicate broadcast: ${type}`);
          return;
        }

        this.broadcastDebounce.set(type, now);

        switch (type) {
          case 'PANEL_OPENED':
            // Another tab opened the panel - open it here too (without broadcasting)
            if (!this.isOpen) {
              debug('[PanelManager] Opening panel (broadcast from another tab)');
              this.openSilent(); // Open without broadcasting to prevent loop
            }
            break;
          case 'PANEL_CLOSED':
            // Another tab closed the panel - close it here too (without broadcasting)
            if (this.isOpen) {
              debug('[PanelManager] Closing panel (broadcast from another tab)');
              this.closeSilent(); // Close without broadcasting to prevent loop
            }
            break;
          // v1.5.9.8 - FIX: Handle position updates
          case 'PANEL_POSITION_UPDATED':
            if (this.panel && data.left !== undefined && data.top !== undefined) {
              this.panel.style.left = `${data.left}px`;
              this.panel.style.top = `${data.top}px`;
              this.panelState.left = data.left;
              this.panelState.top = data.top;
              this.savePanelStateLocal();
              debug(`[PanelManager] Updated position from broadcast: (${data.left}, ${data.top})`);
            }
            break;
          // v1.5.9.8 - FIX: Handle size updates
          case 'PANEL_SIZE_UPDATED':
            if (this.panel && data.width !== undefined && data.height !== undefined) {
              this.panel.style.width = `${data.width}px`;
              this.panel.style.height = `${data.height}px`;
              this.panelState.width = data.width;
              this.panelState.height = data.height;
              this.savePanelStateLocal();
              debug(`[PanelManager] Updated size from broadcast: ${data.width}x${data.height}`);
            }
            break;
        }
      };

      debug('[PanelManager] BroadcastChannel initialized for panel sync');
    } catch (err) {
      console.error('[PanelManager] Failed to set up BroadcastChannel:', err);
    }
  }

  /**
   * Inject panel styles into page
   */
  injectStyles() {
    // Check if already injected
    if (document.getElementById('quick-tabs-manager-panel-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'quick-tabs-manager-panel-styles';
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    debug('[PanelManager] Styles injected');
  }

  /**
   * Create the panel DOM structure
   */
  createPanel() {
    if (this.panel) {
      debug('[PanelManager] Panel already exists');
      return;
    }

    // Create panel container
    const container = document.createElement('div');
    container.innerHTML = PANEL_HTML;
    const panel = container.firstElementChild;

    // Apply saved position and size
    panel.style.left = this.panelState.left + 'px';
    panel.style.top = this.panelState.top + 'px';
    panel.style.width = this.panelState.width + 'px';
    panel.style.height = this.panelState.height + 'px';

    // Show panel if it was open before
    if (this.panelState.isOpen) {
      panel.style.display = 'flex';
      this.isOpen = true;
    }

    // Append to body
    document.documentElement.appendChild(panel);
    this.panel = panel;

    // Make draggable
    const header = panel.querySelector('.panel-header');
    this.makePanelDraggable(panel, header);

    // Make resizable
    this.makePanelResizable(panel);

    // Setup event listeners
    this.setupPanelEventListeners(panel);

    // Initialize content
    this.updatePanelContent();

    debug('[PanelManager] Panel created');
  }

  /**
   * Load panel state from storage
   */
  async loadPanelState() {
    try {
      const result = await browser.storage.local.get('quick_tabs_panel_state');
      if (result && result.quick_tabs_panel_state) {
        this.panelState = { ...this.panelState, ...result.quick_tabs_panel_state };
        debug('[PanelManager] Loaded panel state:', this.panelState);
      }
    } catch (err) {
      console.error('[PanelManager] Error loading panel state:', err);
    }
  }

  /**
   * Save panel state to storage
   */
  async savePanelState() {
    if (!this.panel) return;

    const rect = this.panel.getBoundingClientRect();

    this.panelState = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isOpen: this.isOpen
    };

    try {
      await browser.storage.local.set({ quick_tabs_panel_state: this.panelState });
      debug('[PanelManager] Saved panel state');
    } catch (err) {
      console.error('[PanelManager] Error saving panel state:', err);
    }
  }

  /**
   * v1.5.9.8 - FIX: Save panel state without triggering storage event handlers
   * Used when receiving broadcast messages to prevent infinite loops
   */
  savePanelStateLocal() {
    if (!this.panel) return;

    const rect = this.panel.getBoundingClientRect();

    this.panelState = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isOpen: this.isOpen
    };

    debug('[PanelManager] Updated local panel state (no storage write)');
  }

  /**
   * Toggle panel visibility
   */
  toggle() {
    if (!this.panel) {
      this.createPanel();
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
      this.createPanel();
    }

    this.panel.style.display = 'flex';
    this.isOpen = true;
    this.panelState.isOpen = true;

    // Bring to front
    this.panel.style.zIndex = '999999999';

    // Update content immediately
    this.updatePanelContent();

    // Start auto-refresh
    if (!this.updateInterval) {
      this.updateInterval = setInterval(() => {
        this.updatePanelContent();
      }, 2000);
    }

    // Save state
    this.savePanelState();

    // v1.5.8.15: Broadcast panel opened to other tabs
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'PANEL_OPENED',
        timestamp: Date.now()
      });
    }

    debug('[PanelManager] Panel opened');
  }

  /**
   * Close panel
   */
  close() {
    if (this.panel) {
      this.panel.style.display = 'none';
      this.isOpen = false;
      this.panelState.isOpen = false;

      // Stop auto-refresh
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Save state
      this.savePanelState();

      // v1.5.8.15: Broadcast panel closed to other tabs
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: 'PANEL_CLOSED',
          timestamp: Date.now()
        });
      }

      debug('[PanelManager] Panel closed');
    }
  }

  /**
   * v1.5.8.15 - Open panel silently (without broadcasting) to prevent infinite loop
   */
  openSilent() {
    if (!this.panel) {
      this.createPanel();
    }

    this.panel.style.display = 'flex';
    this.isOpen = true;
    this.panelState.isOpen = true;

    // Bring to front
    this.panel.style.zIndex = '999999999';

    // Update content immediately
    this.updatePanelContent();

    // Start auto-refresh
    if (!this.updateInterval) {
      this.updateInterval = setInterval(() => {
        this.updatePanelContent();
      }, 2000);
    }

    // Save state locally only
    this.savePanelState();

    debug('[PanelManager] Panel opened silently (from broadcast)');
  }

  /**
   * v1.5.8.15 - Close panel silently (without broadcasting) to prevent infinite loop
   */
  closeSilent() {
    if (this.panel) {
      this.panel.style.display = 'none';
      this.isOpen = false;
      this.panelState.isOpen = false;

      // Stop auto-refresh
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Save state locally only
      this.savePanelState();

      debug('[PanelManager] Panel closed silently (from broadcast)');
    }
  }

  /**
   * Setup message listener for toggle command from background script
   */
  setupMessageListener() {
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.onMessage.addListener((message, sender) => {
        // Validate sender
        if (!sender.id || sender.id !== browser.runtime.id) {
          console.error('[PanelManager] Message from unknown sender:', sender);
          return;
        }

        if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
          this.toggle();
          return Promise.resolve({ success: true });
        }
      });

      debug('[PanelManager] Message listener setup');
    }
  }

  /**
   * Setup event listeners for panel buttons
   */
  setupPanelEventListeners(panel) {
    // Close button
    const closeBtn = panel.querySelector('.panel-close');
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.close();
    });

    // Minimize button (same as close for now)
    const minimizeBtn = panel.querySelector('.panel-minimize');
    minimizeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.close();
    });

    // Close Minimized button
    const closeMinimizedBtn = panel.querySelector('#panel-closeMinimized');
    closeMinimizedBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await this.closeMinimizedQuickTabs();
    });

    // Close All button
    const closeAllBtn = panel.querySelector('#panel-closeAll');
    closeAllBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await this.closeAllQuickTabs();
    });

    // Delegated listener for Quick Tab item actions
    const containersList = panel.querySelector('#panel-containersList');
    containersList.addEventListener('click', async e => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;

      e.stopPropagation();

      const action = button.dataset.action;
      const quickTabId = button.dataset.quickTabId;
      const tabId = button.dataset.tabId;

      switch (action) {
        case 'goToTab':
          await this.goToTab(parseInt(tabId));
          break;
        case 'minimize':
          await this.minimizeQuickTab(quickTabId);
          break;
        case 'restore':
          await this.restoreQuickTab(quickTabId);
          break;
        case 'close':
          await this.closeQuickTab(quickTabId);
          break;
      }

      // Update panel after action
      setTimeout(() => this.updatePanelContent(), 100);
    });

    debug('[PanelManager] Event listeners setup');
  }

  /**
   * Make panel draggable using Pointer Events API
   */
  makePanelDraggable(panel, handle) {
    let isDragging = false;
    let offsetX = 0,
      offsetY = 0;
    let currentPointerId = null;

    const handlePointerDown = e => {
      if (e.button !== 0) return; // Only left click
      if (e.target.classList.contains('panel-btn')) return; // Ignore buttons

      isDragging = true;
      currentPointerId = e.pointerId;

      // Capture pointer
      handle.setPointerCapture(e.pointerId);

      // Calculate offset
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      handle.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const handlePointerMove = e => {
      if (!isDragging || e.pointerId !== currentPointerId) return;

      // Calculate new position
      const newLeft = e.clientX - offsetX;
      const newTop = e.clientY - offsetY;

      // Apply position
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';

      e.preventDefault();
    };

    const handlePointerUp = e => {
      if (!isDragging || e.pointerId !== currentPointerId) return;

      isDragging = false;
      handle.releasePointerCapture(e.pointerId);
      handle.style.cursor = 'grab';

      // Save final position
      this.savePanelState();

      // v1.5.9.8 - FIX: Broadcast position to other tabs
      if (this.broadcastChannel) {
        const rect = panel.getBoundingClientRect();
        this.broadcastChannel.postMessage({
          type: 'PANEL_POSITION_UPDATED',
          data: { left: rect.left, top: rect.top }
        });
        debug(`[PanelManager] Broadcast position: (${rect.left}, ${rect.top})`);
      }
    };

    const handlePointerCancel = _e => {
      if (!isDragging) return;

      isDragging = false;
      handle.style.cursor = 'grab';

      // Save position
      this.savePanelState();
    };

    // Attach listeners
    handle.addEventListener('pointerdown', handlePointerDown);
    handle.addEventListener('pointermove', handlePointerMove);
    handle.addEventListener('pointerup', handlePointerUp);
    handle.addEventListener('pointercancel', handlePointerCancel);
  }

  /**
   * Make panel resizable from all edges/corners
   */
  makePanelResizable(panel) {
    const minWidth = 250;
    const minHeight = 300;
    const handleSize = 10;

    // Define resize handles
    const handles = {
      n: { cursor: 'n-resize', top: 0, left: handleSize, right: handleSize, height: handleSize },
      s: { cursor: 's-resize', bottom: 0, left: handleSize, right: handleSize, height: handleSize },
      e: { cursor: 'e-resize', right: 0, top: handleSize, bottom: handleSize, width: handleSize },
      w: { cursor: 'w-resize', left: 0, top: handleSize, bottom: handleSize, width: handleSize },
      ne: { cursor: 'ne-resize', top: 0, right: 0, width: handleSize, height: handleSize },
      nw: { cursor: 'nw-resize', top: 0, left: 0, width: handleSize, height: handleSize },
      se: { cursor: 'se-resize', bottom: 0, right: 0, width: handleSize, height: handleSize },
      sw: { cursor: 'sw-resize', bottom: 0, left: 0, width: handleSize, height: handleSize }
    };

    Object.entries(handles).forEach(([direction, style]) => {
      const handle = document.createElement('div');
      handle.className = `panel-resize-handle ${direction}`;
      handle.style.cssText = `
        position: absolute;
        ${style.top !== undefined ? `top: ${style.top}px;` : ''}
        ${style.bottom !== undefined ? `bottom: ${style.bottom}px;` : ''}
        ${style.left !== undefined ? `left: ${style.left}px;` : ''}
        ${style.right !== undefined ? `right: ${style.right}px;` : ''}
        ${style.width ? `width: ${style.width}px;` : ''}
        ${style.height ? `height: ${style.height}px;` : ''}
        cursor: ${style.cursor};
        z-index: 10;
      `;

      let isResizing = false;
      let currentPointerId = null;
      let startX, startY, startWidth, startHeight, startLeft, startTop;

      const handlePointerDown = e => {
        if (e.button !== 0) return;

        isResizing = true;
        currentPointerId = e.pointerId;
        handle.setPointerCapture(e.pointerId);

        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;

        e.preventDefault();
        e.stopPropagation();
      };

      const handlePointerMove = e => {
        if (!isResizing || e.pointerId !== currentPointerId) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Calculate new dimensions based on direction
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

        // Apply new dimensions
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';

        e.preventDefault();
      };

      const handlePointerUp = e => {
        if (!isResizing || e.pointerId !== currentPointerId) return;

        isResizing = false;
        handle.releasePointerCapture(e.pointerId);

        // Save final size/position
        this.savePanelState();

        // v1.5.9.8 - FIX: Broadcast size/position to other tabs
        if (this.broadcastChannel) {
          const rect = panel.getBoundingClientRect();
          this.broadcastChannel.postMessage({
            type: 'PANEL_SIZE_UPDATED',
            data: { width: rect.width, height: rect.height }
          });
          this.broadcastChannel.postMessage({
            type: 'PANEL_POSITION_UPDATED',
            data: { left: rect.left, top: rect.top }
          });
          debug(
            `[PanelManager] Broadcast size: ${rect.width}x${rect.height}, position: (${rect.left}, ${rect.top})`
          );
        }
      };

      const handlePointerCancel = _e => {
        if (!isResizing) return;

        isResizing = false;
        this.savePanelState();
      };

      // Attach listeners
      handle.addEventListener('pointerdown', handlePointerDown);
      handle.addEventListener('pointermove', handlePointerMove);
      handle.addEventListener('pointerup', handlePointerUp);
      handle.addEventListener('pointercancel', handlePointerCancel);

      panel.appendChild(handle);
    });
  }

  /**
   * Update panel content with current Quick Tabs state
   */
  /**
   * v1.5.9.12 - Container integration: Filter panel content by current container
   */
  async updatePanelContent() {
    if (!this.panel || !this.isOpen) return;

    const totalTabsEl = this.panel.querySelector('#panel-totalTabs');
    const lastSyncEl = this.panel.querySelector('#panel-lastSync');
    const containersList = this.panel.querySelector('#panel-containersList');
    const emptyState = this.panel.querySelector('#panel-emptyState');

    // Load Quick Tabs state from storage
    let quickTabsState = {};
    try {
      const result = await browser.storage.sync.get('quick_tabs_state_v2');
      if (result && result.quick_tabs_state_v2) {
        // v1.5.8.15 FIX: Handle wrapped format
        const state = result.quick_tabs_state_v2;
        quickTabsState = state.containers || state; // Extract containers or use state directly
      }
    } catch (err) {
      console.error('[PanelManager] Error loading Quick Tabs state:', err);
      return;
    }

    // v1.5.9.12 - Container integration: Filter by current container
    const currentContainerState = quickTabsState[this.currentContainerId];
    const currentContainerTabs = currentContainerState?.tabs || [];
    const latestTimestamp = currentContainerState?.lastUpdate || 0;

    // Update stats - only show current container's tabs
    totalTabsEl.textContent = `${currentContainerTabs.length} Quick Tab${currentContainerTabs.length !== 1 ? 's' : ''}`;

    if (latestTimestamp > 0) {
      const date = new Date(latestTimestamp);
      lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
    } else {
      lastSyncEl.textContent = 'Last sync: Never';
    }

    // Show/hide empty state
    if (currentContainerTabs.length === 0) {
      containersList.style.display = 'none';
      emptyState.style.display = 'flex';
      return;
    } else {
      containersList.style.display = 'block';
      emptyState.style.display = 'none';
    }

    // Load container info for current container
    let containerInfo = {
      name: 'Default',
      icon: '📁',
      color: 'grey'
    };

    try {
      if (
        this.currentContainerId !== 'firefox-default' &&
        typeof browser.contextualIdentities !== 'undefined'
      ) {
        const containers = await browser.contextualIdentities.query({});
        const currentContainer = containers.find(c => c.cookieStoreId === this.currentContainerId);
        if (currentContainer) {
          containerInfo = {
            name: currentContainer.name,
            icon: this.getContainerIcon(currentContainer.icon),
            color: currentContainer.color
          };
        }
      }
    } catch (err) {
      console.error('[PanelManager] Error loading container info:', err);
    }

    // Clear and rebuild containers list - only show current container
    containersList.innerHTML = '';

    this.renderContainerSection(
      containersList,
      this.currentContainerId,
      containerInfo,
      currentContainerState
    );
  }

  /**
   * Get container icon emoji
   */
  getContainerIcon(icon) {
    const iconMap = {
      fingerprint: '🔒',
      briefcase: '💼',
      dollar: '💰',
      cart: '🛒',
      circle: '⭕',
      gift: '🎁',
      vacation: '🏖️',
      food: '🍴',
      fruit: '🍎',
      pet: '🐾',
      tree: '🌳',
      chill: '❄️',
      fence: '🚧'
    };

    return iconMap[icon] || '📁';
  }

  /**
   * Render container section
   */
  renderContainerSection(containersList, cookieStoreId, containerInfo, containerState) {
    const section = document.createElement('div');
    section.className = 'panel-container-section';

    // Header
    const header = document.createElement('h3');
    header.className = 'panel-container-header';
    header.innerHTML = `
      <span class="panel-container-icon">${containerInfo.icon}</span>
      <span class="panel-container-name">${containerInfo.name}</span>
      <span class="panel-container-count">(${containerState.tabs.length} tab${containerState.tabs.length !== 1 ? 's' : ''})</span>
    `;

    section.appendChild(header);

    // Tabs
    const activeTabs = containerState.tabs.filter(t => !t.minimized);
    const minimizedTabs = containerState.tabs.filter(t => t.minimized);

    activeTabs.forEach(tab => {
      section.appendChild(this.renderQuickTabItem(tab, false));
    });

    minimizedTabs.forEach(tab => {
      section.appendChild(this.renderQuickTabItem(tab, true));
    });

    containersList.appendChild(section);
  }

  /**
   * Render Quick Tab item
   * v1.5.9.8 - FIX: Defensive boolean conversion for isMinimized
   */
  renderQuickTabItem(tab, isMinimized) {
    // v1.5.9.8 - FIX: Convert to boolean explicitly to prevent string 'false' issues
    const minimized = Boolean(isMinimized);

    const item = document.createElement('div');
    item.className = `panel-quick-tab-item ${minimized ? 'minimized' : 'active'}`;

    // Indicator
    const indicator = document.createElement('span');
    indicator.className = `panel-status-indicator ${minimized ? 'yellow' : 'green'}`;

    // Favicon
    const favicon = document.createElement('img');
    favicon.className = 'panel-favicon';
    try {
      const urlObj = new URL(tab.url);
      favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
      favicon.onerror = () => (favicon.style.display = 'none');
    } catch (e) {
      favicon.style.display = 'none';
    }

    // Info
    const info = document.createElement('div');
    info.className = 'panel-tab-info';

    const title = document.createElement('div');
    title.className = 'panel-tab-title';
    title.textContent = tab.title || 'Quick Tab';

    const meta = document.createElement('div');
    meta.className = 'panel-tab-meta';

    const metaParts = [];
    if (minimized) metaParts.push('Minimized');
    if (tab.activeTabId) metaParts.push(`Tab ${tab.activeTabId}`);
    if (tab.width && tab.height)
      metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
    meta.textContent = metaParts.join(' • ');

    info.appendChild(title);
    info.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'panel-tab-actions';

    if (!minimized) {
      // Go to Tab button
      if (tab.activeTabId) {
        const goToBtn = document.createElement('button');
        goToBtn.className = 'panel-btn-icon';
        goToBtn.textContent = '🔗';
        goToBtn.title = 'Go to Tab';
        goToBtn.dataset.action = 'goToTab';
        goToBtn.dataset.tabId = tab.activeTabId;
        actions.appendChild(goToBtn);
      }

      // Minimize button
      const minBtn = document.createElement('button');
      minBtn.className = 'panel-btn-icon';
      minBtn.textContent = '➖';
      minBtn.title = 'Minimize';
      minBtn.dataset.action = 'minimize';
      minBtn.dataset.quickTabId = tab.id;
      actions.appendChild(minBtn);
    } else {
      // Restore button
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'panel-btn-icon';
      restoreBtn.textContent = '↑';
      restoreBtn.title = 'Restore';
      restoreBtn.dataset.action = 'restore';
      restoreBtn.dataset.quickTabId = tab.id;
      actions.appendChild(restoreBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn-icon';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.dataset.action = 'close';
    closeBtn.dataset.quickTabId = tab.id;
    actions.appendChild(closeBtn);

    // Assemble
    item.appendChild(indicator);
    item.appendChild(favicon);
    item.appendChild(info);
    item.appendChild(actions);

    return item;
  }

  /**
   * Close minimized Quick Tabs
   * v1.5.8.15 - Fixed to handle wrapped container format
   */
  async closeMinimizedQuickTabs() {
    try {
      const result = await browser.storage.sync.get('quick_tabs_state_v2');
      if (!result || !result.quick_tabs_state_v2) return;

      const state = result.quick_tabs_state_v2;
      let hasChanges = false;

      // v1.5.8.15 FIX: Handle wrapped format (state.containers)
      const containers = state.containers || state; // Support both wrapped and unwrapped

      // Iterate through containers
      Object.keys(containers).forEach(key => {
        // Skip metadata keys
        if (key === 'saveId' || key === 'timestamp') return;

        const containerState = containers[key];
        if (containerState && containerState.tabs && Array.isArray(containerState.tabs)) {
          const originalLength = containerState.tabs.length;

          // Filter out minimized tabs
          containerState.tabs = containerState.tabs.filter(t => !t.minimized);

          if (containerState.tabs.length !== originalLength) {
            hasChanges = true;
            containerState.lastUpdate = Date.now();
          }
        }
      });

      if (hasChanges) {
        // v1.5.8.15 FIX: Save with proper wrapper format
        const stateToSave = {
          containers: containers,
          saveId: this.generateSaveId(),
          timestamp: Date.now()
        };

        await browser.storage.sync.set({ quick_tabs_state_v2: stateToSave });

        // Also update session storage
        if (typeof browser.storage.session !== 'undefined') {
          await browser.storage.session.set({ quick_tabs_session: stateToSave });
        }

        debug('[PanelManager] Closed all minimized Quick Tabs');
        this.updatePanelContent();
      }
    } catch (err) {
      console.error('[PanelManager] Error closing minimized tabs:', err);
    }
  }

  /**
   * Close all Quick Tabs
   * v1.5.8.15 - Fixed to use proper wrapped format
   */
  async closeAllQuickTabs() {
    try {
      // v1.5.8.15 FIX: Use wrapped container format
      const emptyState = {
        containers: {
          'firefox-default': { tabs: [], lastUpdate: Date.now() }
        },
        saveId: this.generateSaveId(),
        timestamp: Date.now()
      };

      await browser.storage.sync.set({ quick_tabs_state_v2: emptyState });

      // Also clear session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        await browser.storage.session.set({ quick_tabs_session: emptyState });
      }

      // Notify all tabs via background script
      browser.runtime
        .sendMessage({
          action: 'CLEAR_ALL_QUICK_TABS'
        })
        .catch(() => {});

      debug('[PanelManager] Closed all Quick Tabs');
      this.updatePanelContent();
    } catch (err) {
      console.error('[PanelManager] Error closing all tabs:', err);
    }
  }

  /**
   * v1.5.8.14 - Generate unique save ID for transaction tracking
   */
  generateSaveId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Go to browser tab
   */
  async goToTab(tabId) {
    try {
      await browser.tabs.update(tabId, { active: true });
      debug(`[PanelManager] Switched to tab ${tabId}`);
    } catch (err) {
      console.error(`[PanelManager] Error switching to tab ${tabId}:`, err);
    }
  }

  /**
   * Minimize Quick Tab
   */
  // eslint-disable-next-line require-await
  async minimizeQuickTab(quickTabId) {
    // Call Quick Tabs Manager to minimize
    if (this.quickTabsManager && this.quickTabsManager.minimizeById) {
      this.quickTabsManager.minimizeById(quickTabId);
    }

    // Update panel after short delay
    setTimeout(() => this.updatePanelContent(), 100);
  }

  /**
   * Restore Quick Tab
   */
  // eslint-disable-next-line require-await
  async restoreQuickTab(quickTabId) {
    // Call Quick Tabs Manager to restore
    if (this.quickTabsManager && this.quickTabsManager.restoreById) {
      this.quickTabsManager.restoreById(quickTabId);
    }

    // Update panel after short delay
    setTimeout(() => this.updatePanelContent(), 100);
  }

  /**
   * Close Quick Tab
   */
  // eslint-disable-next-line require-await
  async closeQuickTab(quickTabId) {
    // Call Quick Tabs Manager to close
    if (this.quickTabsManager && this.quickTabsManager.closeById) {
      this.quickTabsManager.closeById(quickTabId);
    }

    // Update panel after short delay
    setTimeout(() => this.updatePanelContent(), 100);
  }
}
