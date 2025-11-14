/**
 * Quick Tabs Feature Module
 * Main entrypoint for Quick Tabs functionality
 *
 * v1.5.8.13 - EAGER LOADING: Implements immediate state sync and listener setup
 * Fixes Issue #35 (cross-tab persistence) and Issue #51 (position/size sync)
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
 * v1.5.8.13 - Enhanced with eager loading and BroadcastChannel sync
 */
class QuickTabsManager {
  constructor() {
    this.tabs = new Map(); // id -> QuickTabWindow instance
    this.minimizedManager = new MinimizedManager();
    this.panelManager = null; // Initialized after construction with reference to this
    this.currentZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
    this.eventBus = null;
    this.Events = null;
    this.broadcastChannel = null; // v1.5.8.13 - Real-time cross-tab sync
    this.initialized = false;
  }

  /**
   * Initialize the Quick Tabs manager
   * v1.5.8.13 - Now includes eager state hydration and BroadcastChannel setup
   */
  async init(eventBus, Events) {
    if (this.initialized) {
      console.log('[QuickTabsManager] Already initialized, skipping');
      return;
    }

    this.eventBus = eventBus;
    this.Events = Events;

    console.log('[QuickTabsManager] Initializing with eager loading...');

    // EAGER LOADING v1.5.8.13: Set up BroadcastChannel for real-time cross-tab sync
    this.setupBroadcastChannel();

    // EAGER LOADING v1.5.8.13: Set up storage listeners immediately
    this.setupStorageListeners();

    // Initialize panel manager (v1.5.8.12 - floating panel instead of sidebar)
    this.panelManager = new PanelManager(this);
    await this.panelManager.init();
    console.log('[QuickTabsManager] Panel manager initialized');

    // Listen for Quick Tab creation events from EventBus
    this.eventBus.on(Events.QUICK_TAB_REQUESTED, options => {
      console.log('[QuickTabsManager] QUICK_TAB_REQUESTED event received:', options);
      this.createQuickTab(options);
    });

    // EAGER LOADING v1.5.8.13: Set up message listeners immediately
    this.setupMessageListeners();

    // EAGER LOADING v1.5.8.13: Hydrate state from storage immediately on load
    await this.hydrateStateFromStorage();

    this.initialized = true;
    console.log('[QuickTabsManager] Initialized successfully with eager loading');
  }

  /**
   * v1.5.8.13 - Set up BroadcastChannel for real-time cross-tab sync
   */
  setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[QuickTabsManager] BroadcastChannel not available, using storage-only sync');
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel('quick-tabs-sync');
      
      this.broadcastChannel.onmessage = (event) => {
        console.log('[QuickTabsManager] BroadcastChannel message received:', event.data);
        
        const { type, data } = event.data;
        
        switch (type) {
          case 'CREATE':
            this.createQuickTab(data);
            break;
          case 'UPDATE_POSITION':
            this.updateQuickTabPosition(data.id, data.left, data.top);
            break;
          case 'UPDATE_SIZE':
            this.updateQuickTabSize(data.id, data.width, data.height);
            break;
          case 'MINIMIZE':
            this.minimizeById(data.id);
            break;
          case 'RESTORE':
            this.restoreById(data.id);
            break;
          case 'CLOSE':
            this.closeById(data.id);
            break;
          case 'PIN':
            this.updateQuickTabPin(data.id, data.pinnedToUrl);
            break;
          case 'UNPIN':
            this.updateQuickTabPin(data.id, null);
            break;
          default:
            console.warn('[QuickTabsManager] Unknown broadcast type:', type);
        }
      };
      
      console.log('[QuickTabsManager] BroadcastChannel initialized for real-time sync');
    } catch (err) {
      console.error('[QuickTabsManager] Failed to set up BroadcastChannel:', err);
    }
  }

  /**
   * v1.5.8.13 - Set up storage event listeners for state changes
   */
  setupStorageListeners() {
    if (typeof browser === 'undefined' || !browser.storage) {
      console.warn('[QuickTabsManager] Storage API not available');
      return;
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
      console.log('[QuickTabsManager] Storage changed:', areaName, Object.keys(changes));
      
      if (areaName === 'sync' && changes.quick_tabs_state_v2) {
        console.log('[QuickTabsManager] Quick Tab state changed in storage, syncing...');
        this.syncFromStorage(changes.quick_tabs_state_v2.newValue);
      }
      
      if (areaName === 'session' && changes.quick_tabs_session) {
        console.log('[QuickTabsManager] Quick Tab session state changed, syncing...');
        this.syncFromStorage(changes.quick_tabs_session.newValue);
      }
    });
    
    console.log('[QuickTabsManager] Storage listeners attached');
  }

  /**
   * v1.5.8.13 - Set up message listeners for background communication
   */
  setupMessageListeners() {
    if (typeof browser === 'undefined' || !browser.runtime) {
      console.warn('[QuickTabsManager] Runtime API not available');
      return;
    }

    browser.runtime.onMessage.addListener((message, sender) => {
      // Validate sender
      if (!sender.id || sender.id !== browser.runtime.id) {
        console.error('[QuickTabsManager] Message from unknown sender:', sender);
        return;
      }

      console.log('[QuickTabsManager] Message received:', message.action);

      switch (message.action) {
        case 'CREATE_QUICK_TAB_FROM_BACKGROUND':
          this.createQuickTab(message);
          break;
        case 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND':
          this.syncFromStorage(message.state);
          break;
        case 'UPDATE_QUICK_TAB_POSITION':
          this.updateQuickTabPosition(message.id, message.left, message.top);
          break;
        case 'UPDATE_QUICK_TAB_SIZE':
          this.updateQuickTabSize(message.id, message.width, message.height);
          break;
        default:
          // Unknown action, ignore
          break;
      }
    });
    
    console.log('[QuickTabsManager] Message listeners attached');
  }

  /**
   * v1.5.8.13 - Hydrate Quick Tabs state from storage on load (EAGER)
   */
  async hydrateStateFromStorage() {
    console.log('[QuickTabsManager] Hydrating state from storage...');
    
    try {
      // Get current tab's cookieStoreId
      let cookieStoreId = 'firefox-default';
      if (typeof browser !== 'undefined' && browser.tabs) {
        try {
          const currentTab = await browser.tabs.getCurrent();
          if (currentTab && currentTab.cookieStoreId) {
            cookieStoreId = currentTab.cookieStoreId;
          }
        } catch (err) {
          console.log('[QuickTabsManager] Could not get current tab, using default container');
        }
      }

      // Try session storage first (faster)
      let state = null;
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.session) {
        const result = await browser.storage.session.get('quick_tabs_session');
        if (result && result.quick_tabs_session) {
          state = result.quick_tabs_session;
          console.log('[QuickTabsManager] Loaded state from session storage');
        }
      }

      // Fall back to sync storage
      if (!state && typeof browser !== 'undefined' && browser.storage) {
        const result = await browser.storage.sync.get('quick_tabs_state_v2');
        if (result && result.quick_tabs_state_v2) {
          state = result.quick_tabs_state_v2;
          console.log('[QuickTabsManager] Loaded state from sync storage');
        }
      }

      if (state) {
        this.syncFromStorage(state, cookieStoreId);
        console.log('[QuickTabsManager] State hydration complete');
      } else {
        console.log('[QuickTabsManager] No saved state found');
      }
    } catch (err) {
      console.error('[QuickTabsManager] Error hydrating state:', err);
    }
  }

  /**
   * v1.5.8.13 - Sync Quick Tabs from storage state (container-aware)
   */
  syncFromStorage(state, containerFilter = null) {
    if (!state) {
      console.log('[QuickTabsManager] Empty state, nothing to sync');
      return;
    }

    console.log('[QuickTabsManager] Syncing from storage state...');

    // Handle container-aware format
    let tabsToSync = [];
    if (state.containers && typeof state.containers === 'object') {
      // Container-aware format
      if (containerFilter) {
        // Sync only tabs from specific container
        const containerState = state.containers[containerFilter];
        if (containerState && containerState.tabs) {
          tabsToSync = containerState.tabs;
          console.log(`[QuickTabsManager] Syncing ${tabsToSync.length} tabs from container ${containerFilter}`);
        }
      } else {
        // Sync all containers
        for (const containerId in state.containers) {
          const containerState = state.containers[containerId];
          if (containerState && containerState.tabs) {
            tabsToSync.push(...containerState.tabs);
          }
        }
        console.log(`[QuickTabsManager] Syncing ${tabsToSync.length} tabs from all containers`);
      }
    } else if (state.tabs && Array.isArray(state.tabs)) {
      // Legacy format
      tabsToSync = state.tabs;
      console.log(`[QuickTabsManager] Syncing ${tabsToSync.length} tabs (legacy format)`);
    }

    // Create/update Quick Tabs based on state
    tabsToSync.forEach(tabData => {
      if (!this.tabs.has(tabData.id)) {
        // Create new Quick Tab
        this.createQuickTab({
          id: tabData.id,
          url: tabData.url,
          left: tabData.left,
          top: tabData.top,
          width: tabData.width,
          height: tabData.height,
          title: tabData.title,
          cookieStoreId: tabData.cookieStoreId || 'firefox-default',
          minimized: tabData.minimized || false,
          pinnedToUrl: tabData.pinnedToUrl || null
        });
      } else {
        // Update existing Quick Tab
        const tab = this.tabs.get(tabData.id);
        if (tab) {
          tab.setPosition(tabData.left, tabData.top);
          tab.setSize(tabData.width, tabData.height);
          if (tabData.minimized && !tab.isMinimized) {
            tab.minimize();
          } else if (!tabData.minimized && tab.isMinimized) {
            this.restoreById(tabData.id);
          }
        }
      }
    });

    // Remove Quick Tabs that are no longer in storage
    const stateIds = new Set(tabsToSync.map(t => t.id));
    for (const [id, tab] of this.tabs.entries()) {
      if (!stateIds.has(id)) {
        console.log(`[QuickTabsManager] Removing Quick Tab ${id} (not in storage)`);
        tab.destroy();
      }
    }

    console.log('[QuickTabsManager] Storage sync complete');
  }

  /**
   * v1.5.8.13 - Update Quick Tab position (from sync)
   */
  updateQuickTabPosition(id, left, top) {
    const tab = this.tabs.get(id);
    if (tab && tab.setPosition) {
      tab.setPosition(left, top);
      console.log(`[QuickTabsManager] Updated position for ${id}: (${left}, ${top})`);
    }
  }

  /**
   * v1.5.8.13 - Update Quick Tab size (from sync)
   */
  updateQuickTabSize(id, width, height) {
    const tab = this.tabs.get(id);
    if (tab && tab.setSize) {
      tab.setSize(width, height);
      console.log(`[QuickTabsManager] Updated size for ${id}: ${width}x${height}`);
    }
  }

  /**
   * v1.5.8.13 - Update Quick Tab pin status (from sync)
   */
  updateQuickTabPin(id, pinnedToUrl) {
    const tab = this.tabs.get(id);
    if (tab) {
      if (pinnedToUrl) {
        tab.pinnedToUrl = pinnedToUrl;
        console.log(`[QuickTabsManager] Pinned ${id} to ${pinnedToUrl}`);
      } else {
        tab.pinnedToUrl = null;
        console.log(`[QuickTabsManager] Unpinned ${id}`);
      }
    }
  }

  /**
   * v1.5.8.13 - Broadcast operation to other tabs via BroadcastChannel
   */
  broadcast(type, data) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type, data });
      console.log(`[QuickTabsManager] Broadcasted ${type}:`, data);
    }
  }

  /**
   * Create a new Quick Tab window
   * v1.5.8.13 - Now broadcasts creation to other tabs
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

    // v1.5.8.13 - Broadcast creation to other tabs
    this.broadcast('CREATE', {
      id,
      url: options.url,
      left: options.left || 100,
      top: options.top || 100,
      width: options.width || 800,
      height: options.height || 600,
      title: options.title || 'Quick Tab',
      cookieStoreId: options.cookieStoreId || 'firefox-default',
      minimized: options.minimized || false,
      pinnedToUrl: options.pinnedToUrl || null
    });

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
   * v1.5.8.13 - Now broadcasts close to other tabs
   */
  handleDestroy(id) {
    console.log('[QuickTabsManager] Handling destroy for:', id);
    this.tabs.delete(id);
    this.minimizedManager.remove(id);

    // v1.5.8.13 - Broadcast close to other tabs
    this.broadcast('CLOSE', { id });

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
   * v1.5.8.13 - Now broadcasts minimize to other tabs
   */
  handleMinimize(id) {
    console.log('[QuickTabsManager] Handling minimize for:', id);
    const tabWindow = this.tabs.get(id);
    if (tabWindow) {
      this.minimizedManager.add(id, tabWindow);

      // v1.5.8.13 - Broadcast minimize to other tabs
      this.broadcast('MINIMIZE', { id });

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
   * v1.5.8.13 - Now broadcasts restore to other tabs
   */
  restoreQuickTab(id) {
    console.log('[QuickTabsManager] Restoring Quick Tab:', id);
    
    // v1.5.8.13 - Broadcast restore to other tabs
    this.broadcast('RESTORE', { id });
    
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
   * v1.5.8.13 - Now broadcasts position updates via BroadcastChannel
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

    // v1.5.8.13 - Broadcast position update to other tabs
    this.broadcast('UPDATE_POSITION', {
      id,
      left: Math.round(left),
      top: Math.round(top)
    });

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
   * v1.5.8.13 - Enhanced with BroadcastChannel sync
   */
  handlePositionChangeEnd(id, left, top) {
    // Clear throttle
    if (this.positionChangeThrottle) {
      delete this.positionChangeThrottle[id];
    }

    // v1.5.8.13 - Final position broadcast
    this.broadcast('UPDATE_POSITION', {
      id,
      left: Math.round(left),
      top: Math.round(top)
    });

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
   * v1.5.8.13 - Now broadcasts size updates via BroadcastChannel
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

    // v1.5.8.13 - Broadcast size update to other tabs
    this.broadcast('UPDATE_SIZE', {
      id,
      width: Math.round(width),
      height: Math.round(height)
    });

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
   * v1.5.8.13 - Enhanced with BroadcastChannel sync
   */
  handleSizeChangeEnd(id, width, height) {
    if (this.sizeChangeThrottle) {
      delete this.sizeChangeThrottle[id];
    }

    // v1.5.8.13 - Final size broadcast
    this.broadcast('UPDATE_SIZE', {
      id,
      width: Math.round(width),
      height: Math.round(height)
    });

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
   * v1.5.8.13 - Now broadcasts pin to other tabs
   */
  handlePin(id, pinnedToUrl) {
    console.log('[QuickTabsManager] Handling pin for:', id, 'to:', pinnedToUrl);

    // v1.5.8.13 - Broadcast pin to other tabs
    this.broadcast('PIN', { id, pinnedToUrl });

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
   * v1.5.8.13 - Now broadcasts unpin to other tabs
   */
  handleUnpin(id) {
    console.log('[QuickTabsManager] Handling unpin for:', id);

    // v1.5.8.13 - Broadcast unpin to other tabs
    this.broadcast('UNPIN', { id });

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
