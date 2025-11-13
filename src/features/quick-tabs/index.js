/**
 * Quick Tabs Feature Module
 * Main entrypoint for Quick Tabs functionality
 *
 * v1.5.8.10 - Hybrid Architecture: Renamed quick-tab-window.js to window.js
 * Fixes issue identified in v1589-quick-tabs-root-cause.md
 * Follows architecture from hybrid-architecture-implementation.md
 */

import { createQuickTabWindow } from './window.js';
import { MinimizedManager } from './minimized-manager.js';
import { PanelManager } from './panel.js';
import { CONSTANTS } from '../../core/config.js';

/**
 * QuickTabsManager - Singleton manager for all Quick Tab instances
 */
class QuickTabsManager {
  constructor() {
    this.tabs = new Map(); // id -> QuickTabWindow instance
    this.minimizedManager = new MinimizedManager();
    this.panelManager = null; // Initialized after construction with reference to this
    this.currentZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
    this.eventBus = null;
    this.Events = null;
  }

  /**
   * Initialize the Quick Tabs manager
   */
  async init(eventBus, Events) {
    this.eventBus = eventBus;
    this.Events = Events;

    console.log('[QuickTabsManager] Initializing...');

    // Initialize panel manager (v1.5.8.12 - floating panel instead of sidebar)
    this.panelManager = new PanelManager(this);
    await this.panelManager.init();
    console.log('[QuickTabsManager] Panel manager initialized');

    // Listen for Quick Tab creation events from EventBus
    this.eventBus.on(Events.QUICK_TAB_REQUESTED, options => {
      console.log('[QuickTabsManager] QUICK_TAB_REQUESTED event received:', options);
      this.createQuickTab(options);
    });

    // Listen for background script messages
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.onMessage.addListener((message, sender) => {
        // Validate sender
        if (!sender.id || sender.id !== browser.runtime.id) {
          console.error('[QuickTabsManager] Message from unknown sender:', sender);
          return;
        }

        if (message.action === 'CREATE_QUICK_TAB_FROM_BACKGROUND') {
          console.log('[QuickTabsManager] Background message received:', message);
          this.createQuickTab(message);
        }
      });
    }

    console.log('[QuickTabsManager] Initialized successfully');
  }

  /**
   * Create a new Quick Tab window
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] Creating Quick Tab with options:', options);

    // Generate ID if not provided
    const id = options.id || this.generateId();

    // Check if already exists
    if (this.tabs.has(id)) {
      console.warn('[QuickTabsManager] Quick Tab already exists:', id);
      const existingTab = this.tabs.get(id);
      existingTab.updateZIndex(++this.currentZIndex);
      return existingTab;
    }

    // Increment z-index for new tab
    this.currentZIndex++;

    // Create Quick Tab window with callbacks
    const tabWindow = createQuickTabWindow({
      id,
      url: options.url,
      left: options.left || 100,
      top: options.top || 100,
      width: options.width || 800,
      height: options.height || 600,
      title: options.title || 'Quick Tab',
      cookieStoreId: options.cookieStoreId || 'firefox-default',
      minimized: options.minimized || false,
      zIndex: this.currentZIndex,
      pinnedToUrl: options.pinnedToUrl || null,
      onDestroy: tabId => this.handleDestroy(tabId),
      onMinimize: tabId => this.handleMinimize(tabId),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
      onPin: (tabId, pinnedToUrl) => this.handlePin(tabId, pinnedToUrl),
      onUnpin: tabId => this.handleUnpin(tabId)
    });

    // Store the tab
    this.tabs.set(id, tabWindow);

    // Emit creation event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_CREATED, {
        id,
        url: options.url
      });
    }

    console.log('[QuickTabsManager] Quick Tab created successfully:', id);
    return tabWindow;
  }

  /**
   * Handle Quick Tab destruction
   */
  handleDestroy(id) {
    console.log('[QuickTabsManager] Handling destroy for:', id);
    this.tabs.delete(id);
    this.minimizedManager.remove(id);

    // Emit destruction event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_CLOSED, { id });
    }

    // Reset z-index if all tabs are closed
    if (this.tabs.size === 0) {
      this.currentZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
      console.log('[QuickTabsManager] All tabs closed, reset z-index');
    }
  }

  /**
   * Handle Quick Tab minimize
   */
  handleMinimize(id) {
    console.log('[QuickTabsManager] Handling minimize for:', id);
    const tabWindow = this.tabs.get(id);
    if (tabWindow) {
      this.minimizedManager.add(id, tabWindow);

      // Emit minimize event
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id });
      }
    }
  }

  /**
   * Handle Quick Tab focus (bring to front)
   */
  handleFocus(id) {
    console.log('[QuickTabsManager] Bringing to front:', id);
    const tabWindow = this.tabs.get(id);
    if (tabWindow) {
      this.currentZIndex++;
      tabWindow.updateZIndex(this.currentZIndex);

      // Emit focus event
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, { id });
      }
    }
  }

  /**
   * Restore a minimized Quick Tab
   */
  restoreQuickTab(id) {
    console.log('[QuickTabsManager] Restoring Quick Tab:', id);
    return this.minimizedManager.restore(id);
  }

  /**
   * Minimize Quick Tab by ID (called from panel)
   */
  minimizeById(id) {
    const tabWindow = this.tabs.get(id);
    if (tabWindow && tabWindow.minimize) {
      tabWindow.minimize();
    }
  }

  /**
   * Restore Quick Tab by ID (called from panel)
   */
  restoreById(id) {
    return this.restoreQuickTab(id);
  }

  /**
   * Close Quick Tab by ID (called from panel)
   */
  closeById(id) {
    const tabWindow = this.tabs.get(id);
    if (tabWindow && tabWindow.destroy) {
      tabWindow.destroy();
    }
  }

  /**
   * Get a Quick Tab by ID
   */
  getQuickTab(id) {
    return this.tabs.get(id);
  }

  /**
   * Get all Quick Tabs
   */
  getAllQuickTabs() {
    return Array.from(this.tabs.values());
  }

  /**
   * Get all minimized Quick Tabs
   */
  getMinimizedQuickTabs() {
    return this.minimizedManager.getAll();
  }

  /**
   * Close all Quick Tabs
   */
  closeAll() {
    console.log('[QuickTabsManager] Closing all Quick Tabs');
    for (const tabWindow of this.tabs.values()) {
      tabWindow.destroy();
    }
    this.tabs.clear();
    this.minimizedManager.clear();
    this.currentZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
  }

  /**
   * Handle Quick Tab position change (throttled during drag)
   */
  handlePositionChange(id, left, top) {
    const now = Date.now();

    // Throttle to 100ms intervals during drag
    if (!this.positionChangeThrottle) {
      this.positionChangeThrottle = {};
    }

    if (this.positionChangeThrottle[id] && now - this.positionChangeThrottle[id] < 100) {
      return;
    }

    this.positionChangeThrottle[id] = now;

    // Send to background for cross-tab sync (non-blocking)
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_POSITION',
          id: id,
          left: Math.round(left),
          top: Math.round(top),
          timestamp: now
        })
        .catch(err => {
          console.error('[QuickTabsManager] Position sync error:', err);
        });
    }
  }

  /**
   * Handle Quick Tab position change end (final save)
   */
  handlePositionChangeEnd(id, left, top) {
    // Clear throttle
    if (this.positionChangeThrottle) {
      delete this.positionChangeThrottle[id];
    }

    // Send final position to background
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
          id: id,
          left: Math.round(left),
          top: Math.round(top),
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Final position save error:', err);
        });
    }
  }

  /**
   * Handle Quick Tab size change (throttled during resize)
   */
  handleSizeChange(id, width, height) {
    const now = Date.now();

    if (!this.sizeChangeThrottle) {
      this.sizeChangeThrottle = {};
    }

    if (this.sizeChangeThrottle[id] && now - this.sizeChangeThrottle[id] < 100) {
      return;
    }

    this.sizeChangeThrottle[id] = now;

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_SIZE',
          id: id,
          width: Math.round(width),
          height: Math.round(height),
          timestamp: now
        })
        .catch(err => {
          console.error('[QuickTabsManager] Size sync error:', err);
        });
    }
  }

  /**
   * Handle Quick Tab size change end (final save)
   */
  handleSizeChangeEnd(id, width, height) {
    if (this.sizeChangeThrottle) {
      delete this.sizeChangeThrottle[id];
    }

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
          id: id,
          width: Math.round(width),
          height: Math.round(height),
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Final size save error:', err);
        });
    }
  }

  /**
   * Handle Quick Tab pin
   */
  handlePin(id, pinnedToUrl) {
    console.log('[QuickTabsManager] Handling pin for:', id, 'to:', pinnedToUrl);

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'PIN_QUICK_TAB',
          id: id,
          pinnedToUrl: pinnedToUrl,
          timestamp: Date.now()
        })
        .then(() => {
          // Close this Quick Tab in all other tabs
          // Background script will handle broadcasting
          console.log('[QuickTabsManager] Pin message sent to background');
        })
        .catch(err => {
          console.error('[QuickTabsManager] Pin sync error:', err);
        });
    }
  }

  /**
   * Handle Quick Tab unpin
   */
  handleUnpin(id) {
    console.log('[QuickTabsManager] Handling unpin for:', id);

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UNPIN_QUICK_TAB',
          id: id,
          timestamp: Date.now()
        })
        .then(() => {
          // Restore this Quick Tab in all tabs
          // Background script will handle broadcasting
          console.log('[QuickTabsManager] Unpin message sent to background');
        })
        .catch(err => {
          console.error('[QuickTabsManager] Unpin sync error:', err);
        });
    }
  }

  /**
   * Generate unique Quick Tab ID
   */
  generateId() {
    return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Create singleton instance
const quickTabsManager = new QuickTabsManager();

/**
 * Initialize Quick Tabs feature
 * Called from content.js during initialization
 */
export async function initQuickTabs(eventBus, Events) {
  console.log('[QuickTabs] Initializing Quick Tabs feature module...');
  await quickTabsManager.init(eventBus, Events);
  console.log('[QuickTabs] Quick Tabs feature module initialized');
  return quickTabsManager;
}

/**
 * Export manager instance for direct access if needed
 */
export { quickTabsManager };
