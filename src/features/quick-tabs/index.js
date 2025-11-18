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

    // v1.5.9.12 - Container integration: Store container context
    this.cookieStoreId = null; // Detected during init(), e.g., 'firefox-default', 'firefox-container-1'

    // v1.5.9.13 - Tab ID detection for solo/mute functionality
    this.currentTabId = null; // Current Firefox tab ID (detected during init)

    // v1.5.8.14 - Transaction ID system to prevent race conditions
    this.pendingSaveIds = new Set();
    this.saveIdTimers = new Map();
    this.SAVE_ID_GRACE_MS = 1000;
    this.saveQueue = Promise.resolve();
    this.storageSyncTimer = null;
    this.latestStorageSnapshot = null;
    this.STORAGE_SYNC_DELAY_MS = 100;

    // v1.5.8.16 - FIX Issue #1: Debounce rapid broadcast messages to prevent loops
    this.broadcastDebounce = new Map(); // id -> timestamp of last broadcast processed
    this.BROADCAST_DEBOUNCE_MS = 50; // Ignore duplicate broadcasts within 50ms
  }

  /**
   * Initialize the Quick Tabs manager
   * v1.5.8.13 - Now includes eager state hydration and BroadcastChannel setup
   * v1.5.9.12 - Container integration: Detects and stores container context
   * v1.5.9.13 - Solo/Mute integration: Detects current tab ID
   */
  async init(eventBus, Events) {
    if (this.initialized) {
      console.log('[QuickTabsManager] Already initialized, skipping');
      return;
    }

    this.eventBus = eventBus;
    this.Events = Events;

    console.log('[QuickTabsManager] Initializing with eager loading...');

    // v1.5.9.12 - Container integration: Detect container context FIRST
    await this.detectContainerContext();

    // v1.5.9.13 - Solo/Mute integration: Detect current tab ID
    await this.detectCurrentTabId();

    // EAGER LOADING v1.5.8.13: Set up BroadcastChannel for real-time cross-tab sync
    // v1.5.9.12 - Now uses container-specific channel
    this.setupBroadcastChannel();

    // EAGER LOADING v1.5.8.13: Set up storage listeners immediately
    this.setupStorageListeners();

    // Initialize panel manager (v1.5.8.12 - floating panel instead of sidebar)
    this.panelManager = new PanelManager(this);
    await this.panelManager.init();
    console.log('[QuickTabsManager] Panel manager initialized');

    // EAGER LOADING v1.5.8.13: Set up message listeners immediately
    this.setupMessageListeners();

    // v1.5.8.14: Set up emergency save handlers
    this.setupEmergencySaveHandlers();

    // EAGER LOADING v1.5.8.13: Hydrate state from storage immediately on load
    await this.hydrateStateFromStorage();

    this.initialized = true;
    console.log('[QuickTabsManager] Initialized successfully with eager loading');
  }

  /**
   * v1.5.9.12 - Detect and store the current tab's container context
   * Uses tabs.query() instead of tabs.getCurrent() since content scripts can't use getCurrent()
   */
  async detectContainerContext() {
    // Default to firefox-default if detection fails
    this.cookieStoreId = 'firefox-default';

    if (typeof browser === 'undefined' || !browser.tabs) {
      console.warn('[QuickTabsManager] Browser tabs API not available, using default container');
      return;
    }

    try {
      // Content scripts must use tabs.query() to get current tab
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0 && tabs[0].cookieStoreId) {
        this.cookieStoreId = tabs[0].cookieStoreId;
        console.log(`[QuickTabsManager] Container context detected: ${this.cookieStoreId}`);
      } else {
        console.log('[QuickTabsManager] No cookieStoreId found, using default container');
      }
    } catch (err) {
      console.warn('[QuickTabsManager] Failed to detect container context:', err);
    }
  }

  /**
   * v1.5.9.13 - Detect and store the current Firefox tab ID
   * Required for solo/mute functionality to determine visibility
   */
  async detectCurrentTabId() {
    if (typeof browser === 'undefined' || !browser.runtime) {
      console.warn('[QuickTabsManager] Browser API not available');
      this.currentTabId = null;
      return;
    }

    try {
      // Send message to background to get current tab ID
      const response = await browser.runtime.sendMessage({
        action: 'GET_CURRENT_TAB_ID'
      });

      if (response && response.tabId) {
        this.currentTabId = response.tabId;
        console.log(`[QuickTabsManager] Current tab ID: ${this.currentTabId}`);
      } else {
        console.warn('[QuickTabsManager] Failed to get tab ID from background');
        this.currentTabId = null;
      }
    } catch (err) {
      console.error('[QuickTabsManager] Error detecting tab ID:', err);
      this.currentTabId = null;
    }
  }

  /**
   * v1.5.8.13 - Set up BroadcastChannel for real-time cross-tab sync
   * v1.5.9.12 - Container integration: Use container-specific channel names
   */
  setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[QuickTabsManager] BroadcastChannel not available, using storage-only sync');
      return;
    }

    try {
      // v1.5.9.12 - Container-specific channel for isolation
      const channelName = `quick-tabs-sync-${this.cookieStoreId}`;
      this.broadcastChannel = new BroadcastChannel(channelName);

      console.log(`[QuickTabsManager] BroadcastChannel created: ${channelName}`);

      this.broadcastChannel.onmessage = event => {
        console.log('[QuickTabsManager] BroadcastChannel message received:', event.data);

        const { type, data } = event.data;

        // v1.5.8.16 - FIX Issue #1: Debounce rapid messages to prevent loops
        const debounceKey = `${type}-${data.id}`;
        const now = Date.now();
        const lastProcessed = this.broadcastDebounce.get(debounceKey);

        if (lastProcessed && now - lastProcessed < this.BROADCAST_DEBOUNCE_MS) {
          console.log(
            '[QuickTabsManager] Ignoring duplicate broadcast (debounced):',
            type,
            data.id
          );
          return;
        }

        this.broadcastDebounce.set(debounceKey, now);

        // Clean up old debounce entries (prevent memory leak)
        if (this.broadcastDebounce.size > 100) {
          const oldestAllowed = now - this.BROADCAST_DEBOUNCE_MS * 2;
          for (const [key, timestamp] of this.broadcastDebounce.entries()) {
            if (timestamp < oldestAllowed) {
              this.broadcastDebounce.delete(key);
            }
          }
        }

        switch (type) {
          case 'CREATE':
            // v1.5.9.10 FIX: Always call createQuickTab - it now handles rendering check internally
            // This ensures tabs are rendered even when they exist in memory but not on the page
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
          case 'SOLO':
            // v1.5.9.13 - Handle solo state change from broadcast
            this.handleSoloFromBroadcast(data.id, data.soloedOnTabs);
            break;
          case 'MUTE':
            // v1.5.9.13 - Handle mute state change from broadcast
            this.handleMuteFromBroadcast(data.id, data.mutedOnTabs);
            break;
          default:
            console.warn('[QuickTabsManager] Unknown broadcast type:', type);
        }
      };

      console.log(
        `[QuickTabsManager] BroadcastChannel initialized for container: ${this.cookieStoreId}`
      );
    } catch (err) {
      console.error('[QuickTabsManager] Failed to set up BroadcastChannel:', err);
    }
  }

  /**
   * v1.5.8.13 - Set up storage event listeners for state changes
   * v1.5.8.14 - Enhanced with transaction ID checking to prevent race conditions
   * v1.5.9.12 - Container integration: Extract only current container's state from changes
   */
  setupStorageListeners() {
    if (typeof browser === 'undefined' || !browser.storage) {
      console.warn('[QuickTabsManager] Storage API not available');
      return;
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
      console.log('[QuickTabsManager] Storage changed:', areaName, Object.keys(changes));

      if (areaName === 'sync' && changes.quick_tabs_state_v2) {
        const newValue = changes.quick_tabs_state_v2.newValue;

        if (this.shouldIgnoreStorageChange(newValue?.saveId)) {
          return;
        }

        if (this.pendingSaveIds.size > 0 && !newValue?.saveId) {
          console.log(
            '[QuickTabsManager] Ignoring sync change while pending saves are in-flight:',
            Array.from(this.pendingSaveIds)
          );
          return;
        }

        // v1.5.9.12 - Container integration: Extract only current container's state
        if (newValue && newValue.containers && this.cookieStoreId) {
          const containerState = newValue.containers[this.cookieStoreId];
          if (containerState) {
            console.log(`[QuickTabsManager] Scheduling sync for container ${this.cookieStoreId}`);
            // Create container-filtered state snapshot
            const filteredState = {
              containers: {
                [this.cookieStoreId]: containerState
              }
            };
            this.scheduleStorageSync(filteredState);
          } else {
            console.log(`[QuickTabsManager] No state found for container ${this.cookieStoreId}`);
          }
        } else {
          // Legacy format or no container info - process as-is
          console.log('[QuickTabsManager] Scheduling external storage change sync (legacy format)');
          this.scheduleStorageSync(newValue);
        }
      }

      if (areaName === 'session' && changes.quick_tabs_session) {
        const newValue = changes.quick_tabs_session.newValue;

        if (this.shouldIgnoreStorageChange(newValue?.saveId)) {
          return;
        }

        if (this.pendingSaveIds.size > 0 && !newValue?.saveId) {
          console.log(
            '[QuickTabsManager] Ignoring session change while pending saves are in-flight:',
            Array.from(this.pendingSaveIds)
          );
          return;
        }

        // v1.5.9.12 - Container integration: Extract only current container's state
        if (newValue && newValue.containers && this.cookieStoreId) {
          const containerState = newValue.containers[this.cookieStoreId];
          if (containerState) {
            console.log(
              `[QuickTabsManager] Scheduling session sync for container ${this.cookieStoreId}`
            );
            // Create container-filtered state snapshot
            const filteredState = {
              containers: {
                [this.cookieStoreId]: containerState
              }
            };
            this.scheduleStorageSync(filteredState);
          }
        } else {
          // Legacy format or no container info - process as-is
          console.log(
            '[QuickTabsManager] Scheduling external session state change sync (legacy format)'
          );
          this.scheduleStorageSync(newValue);
        }
      }
    });

    console.log('[QuickTabsManager] Storage listeners attached');
  }

  shouldIgnoreStorageChange(saveId) {
    if (saveId && this.pendingSaveIds.has(saveId)) {
      console.log('[QuickTabsManager] Ignoring storage change for pending save:', saveId);
      return true;
    }
    return false;
  }

  scheduleStorageSync(stateSnapshot) {
    this.latestStorageSnapshot = stateSnapshot;

    if (this.storageSyncTimer) {
      clearTimeout(this.storageSyncTimer);
    }

    this.storageSyncTimer = setTimeout(() => {
      const snapshot = this.latestStorageSnapshot;
      this.latestStorageSnapshot = null;
      this.storageSyncTimer = null;
      // v1.5.9.12 - Always pass container filter to enforce isolation
      this.syncFromStorage(snapshot, this.cookieStoreId);
    }, this.STORAGE_SYNC_DELAY_MS);
  }

  trackPendingSave(saveId) {
    if (!saveId) {
      return;
    }

    if (this.saveIdTimers.has(saveId)) {
      clearTimeout(this.saveIdTimers.get(saveId));
      this.saveIdTimers.delete(saveId);
    }

    this.pendingSaveIds.add(saveId);

    const timer = setTimeout(() => {
      this.releasePendingSave(saveId);
    }, this.SAVE_ID_GRACE_MS);

    this.saveIdTimers.set(saveId, timer);
  }

  releasePendingSave(saveId) {
    if (!saveId) {
      return;
    }

    if (this.saveIdTimers.has(saveId)) {
      clearTimeout(this.saveIdTimers.get(saveId));
      this.saveIdTimers.delete(saveId);
    }

    if (this.pendingSaveIds.delete(saveId)) {
      console.log('[QuickTabsManager] Released saveId:', saveId);
    }
  }

  /**
   * v1.5.8.13 - Set up message listeners for background communication
   * v1.5.9.12 - Container integration: Validate container context in messages
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

      // v1.5.9.12 - Container integration: Validate container context
      if (message.cookieStoreId && message.cookieStoreId !== this.cookieStoreId) {
        console.log(
          `[QuickTabsManager] Ignoring message for different container: ${message.cookieStoreId} (current: ${this.cookieStoreId})`
        );
        return;
      }

      console.log('[QuickTabsManager] Message received:', message.action);

      switch (message.action) {
        case 'CREATE_QUICK_TAB_FROM_BACKGROUND':
          console.log(
            '[QuickTabsManager] Background create signal received; awaiting storage sync for render'
          );
          break;
        case 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND':
        case 'SYNC_QUICK_TAB_STATE': // v1.5.9.11 FIX: Handle both message action names
          // v1.5.9.12 - Always pass container filter
          this.syncFromStorage(message.state, this.cookieStoreId);
          break;
        case 'UPDATE_QUICK_TAB_POSITION':
          this.updateQuickTabPosition(message.id, message.left, message.top);
          break;
        case 'UPDATE_QUICK_TAB_SIZE':
          this.updateQuickTabSize(message.id, message.width, message.height);
          break;
        case 'CLOSE_QUICK_TAB_FROM_BACKGROUND':
          // v1.5.8.16 - FIX Issue #2: Handle close from background script
          console.log('[QuickTabsManager] Closing Quick Tab from background:', message.id);
          this.closeById(message.id);
          break;
        case 'CLEAR_ALL_QUICK_TABS':
          // v1.5.8.16 - Handle clear all from popup
          console.log('[QuickTabsManager] Clearing all Quick Tabs');
          this.closeAll();
          break;
        default:
          // Unknown action, ignore
          break;
      }
    });

    console.log('[QuickTabsManager] Message listeners attached');
  }

  /**
   * v1.5.8.14 - Set up emergency save handlers for tab switching and unload
   */
  setupEmergencySaveHandlers() {
    // Emergency save when tab becomes hidden (user switches tabs)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.tabs.size > 0) {
        console.log('[QuickTabsManager] Tab hidden - triggering emergency save');
        this.saveCurrentStateToBackground();
      }
    });

    // Emergency save before page unload
    window.addEventListener('beforeunload', () => {
      if (this.tabs.size > 0) {
        console.log('[QuickTabsManager] Page unloading - triggering emergency save');
        this.saveCurrentStateToBackground();
      }
    });

    console.log('[QuickTabsManager] Emergency save handlers attached');
  }

  /**
   * v1.5.8.14 - Save current Quick Tabs state to background script
   * v1.5.9.12 - Container integration: Include container context in message
   */
  saveCurrentStateToBackground() {
    if (this.tabs.size === 0) return;

    const saveId = this.generateSaveId();
    const tabsArray = Array.from(this.tabs.values()).map(tabWindow => ({
      id: tabWindow.id || tabWindow.element?.id,
      url: tabWindow.url || tabWindow.iframe?.src,
      left: parseInt(tabWindow.element?.style.left) || 100,
      top: parseInt(tabWindow.element?.style.top) || 100,
      width: parseInt(tabWindow.element?.style.width) || 800,
      height: parseInt(tabWindow.element?.style.height) || 600,
      title: tabWindow.title || 'Quick Tab',
      cookieStoreId: tabWindow.cookieStoreId || this.cookieStoreId || 'firefox-default',
      minimized: tabWindow.minimized || false,
      pinnedToUrl: tabWindow.pinnedToUrl || null
    }));

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'EMERGENCY_SAVE_QUICK_TABS',
          tabs: tabsArray,
          cookieStoreId: this.cookieStoreId, // v1.5.9.12 - Include container context
          saveId: saveId,
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Emergency save error:', err);
          this.releasePendingSave(saveId);
        });
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * v1.5.8.13 - Hydrate Quick Tabs state from storage on load (EAGER)
   * v1.5.9.12 - Container integration: Use already-detected container context
   */
  async hydrateStateFromStorage() {
    console.log('[QuickTabsManager] Hydrating state from storage...');

    try {
      // v1.5.9.12 - Use already-detected container context from init()
      // No need to re-detect since detectContainerContext() was called during init()

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
        // v1.5.9.12 - Always pass container filter for isolation
        this.syncFromStorage(state, this.cookieStoreId);
        console.log('[QuickTabsManager] State hydration complete');
      } else {
        console.log('[QuickTabsManager] No saved state found');
      }
    } catch (err) {
      console.error('[QuickTabsManager] Error hydrating state:', err);
    }
  }

  /**
   * v1.5.9.13 - Check if Quick Tab should be visible on current tab
   * @param {Object} tabData - Quick Tab state data
   * @returns {boolean} - True if Quick Tab should be visible
   */
  shouldQuickTabBeVisible(tabData) {
    // Must have valid current tab ID
    if (!this.currentTabId) {
      console.warn('[QuickTabsManager] No current tab ID, cannot filter visibility');
      return true; // Show everything if we can't filter
    }

    // Solo logic: Only show on soloed tabs
    if (tabData.soloedOnTabs && tabData.soloedOnTabs.length > 0) {
      return tabData.soloedOnTabs.includes(this.currentTabId);
    }

    // Mute logic: Hide on muted tabs
    if (tabData.mutedOnTabs && tabData.mutedOnTabs.length > 0) {
      return !tabData.mutedOnTabs.includes(this.currentTabId);
    }

    // Default: visible everywhere
    return true;
  }

  /**
   * v1.5.8.13 - Sync Quick Tabs from storage state (container-aware)
   * v1.5.9.12 - Container integration: Enforce container filtering, never sync all containers
   * v1.5.9.13 - Solo/Mute integration: Filter by visibility rules
   */
  syncFromStorage(state, containerFilter = null) {
    if (!state) {
      console.log('[QuickTabsManager] Empty state, nothing to sync');
      return;
    }

    // v1.5.9.12 - ENFORCE container filtering: Use current container if no filter provided
    const effectiveFilter = containerFilter || this.cookieStoreId;

    console.log(`[QuickTabsManager] Syncing from storage state (container: ${effectiveFilter})...`);

    // Handle container-aware format
    let tabsToSync = [];
    if (state.containers && typeof state.containers === 'object') {
      // Container-aware format - ALWAYS filter by container
      const containerState = state.containers[effectiveFilter];
      if (containerState && containerState.tabs) {
        tabsToSync = containerState.tabs;
        console.log(
          `[QuickTabsManager] Syncing ${tabsToSync.length} tabs from container ${effectiveFilter}`
        );
      } else {
        console.log(`[QuickTabsManager] No tabs found for container ${effectiveFilter}`);
      }
    } else if (state.tabs && Array.isArray(state.tabs)) {
      // Legacy format - only process if no container filter or if filter is 'firefox-default'
      if (!effectiveFilter || effectiveFilter === 'firefox-default') {
        tabsToSync = state.tabs;
        console.log(`[QuickTabsManager] Syncing ${tabsToSync.length} tabs (legacy format)`);
      } else {
        console.log(
          `[QuickTabsManager] Skipping legacy format tabs for non-default container ${effectiveFilter}`
        );
      }
    }

    // v1.5.9.13 - Filter tabs by visibility rules BEFORE creating
    const visibleTabs = tabsToSync.filter(tabData => this.shouldQuickTabBeVisible(tabData));

    console.log(
      `[QuickTabsManager] ${visibleTabs.length}/${tabsToSync.length} tabs visible on current tab`
    );

    // Create/update only visible Quick Tabs
    visibleTabs.forEach(tabData => {
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
          cookieStoreId: tabData.cookieStoreId || effectiveFilter,
          minimized: tabData.minimized || false,
          soloedOnTabs: tabData.soloedOnTabs || [], // v1.5.9.13
          mutedOnTabs: tabData.mutedOnTabs || [] // v1.5.9.13
        });
      } else {
        // Update existing Quick Tab
        const tab = this.tabs.get(tabData.id);
        if (tab) {
          tab.setPosition(tabData.left, tabData.top);
          tab.setSize(tabData.width, tabData.height);
          if (tabData.minimized && !tab.minimized) {
            tab.minimize();
          } else if (!tabData.minimized && tab.minimized) {
            this.restoreById(tabData.id);
          }
        }
      }
    });

    // v1.5.9.13 - Remove Quick Tabs that are no longer visible
    const visibleIds = new Set(visibleTabs.map(t => t.id));
    for (const [id, tab] of this.tabs.entries()) {
      if (!visibleIds.has(id)) {
        console.log(`[QuickTabsManager] Removing Quick Tab ${id} (no longer visible on this tab)`);
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
   * v1.5.9.13 - Handle solo state change from broadcast
   */
  handleSoloFromBroadcast(quickTabId, soloedOnTabs) {
    const tab = this.tabs.get(quickTabId);

    if (tab) {
      // Update solo state
      tab.soloedOnTabs = soloedOnTabs;
      tab.mutedOnTabs = []; // Clear mute state (mutually exclusive)

      // Check if should be visible on current tab
      const tabState = tab.getState();
      if (!this.shouldQuickTabBeVisible(tabState)) {
        // Hide on this tab (not in solo list)
        console.log(`[QuickTabsManager] Hiding Quick Tab ${quickTabId} (soloed on other tabs)`);
        tab.destroy();
      } else {
        // Update button if visible
        if (tab.soloButton) {
          const isSoloed = soloedOnTabs.length > 0;
          tab.soloButton.textContent = isSoloed ? '🎯' : '⭕';
          tab.soloButton.title = isSoloed
            ? 'Un-solo (show on all tabs)'
            : 'Solo (show only on this tab)';
          tab.soloButton.style.background = isSoloed ? '#444' : 'transparent';
        }
      }
    } else {
      // Quick Tab doesn't exist locally
      // If current tab is in solo list, it will be created by storage sync
      if (soloedOnTabs.includes(this.currentTabId)) {
        console.log(
          `[QuickTabsManager] Quick Tab ${quickTabId} should appear (soloed on this tab) - will be created by storage sync`
        );
      }
    }
  }

  /**
   * v1.5.9.13 - Handle mute state change from broadcast
   */
  handleMuteFromBroadcast(quickTabId, mutedOnTabs) {
    const tab = this.tabs.get(quickTabId);

    if (tab) {
      // Update mute state
      tab.mutedOnTabs = mutedOnTabs;
      tab.soloedOnTabs = []; // Clear solo state (mutually exclusive)

      // Check if should be visible on current tab
      const tabState = tab.getState();
      if (!this.shouldQuickTabBeVisible(tabState)) {
        // Hide on this tab (in mute list)
        console.log(`[QuickTabsManager] Hiding Quick Tab ${quickTabId} (muted on this tab)`);
        tab.destroy();
      } else {
        // Update button if visible
        if (tab.muteButton) {
          const isMuted = mutedOnTabs.includes(this.currentTabId);
          tab.muteButton.textContent = isMuted ? '🔇' : '🔊';
          tab.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
          tab.muteButton.style.background = isMuted ? '#c44' : 'transparent';
        }
      }
    } else {
      // Quick Tab doesn't exist locally
      // If current tab is NOT in mute list, it will be created by storage sync
      if (!mutedOnTabs.includes(this.currentTabId)) {
        console.log(
          `[QuickTabsManager] Quick Tab ${quickTabId} should appear (not muted on this tab) - will be created by storage sync`
        );
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
   * v1.5.9.8 - CRITICAL FIX: Always create locally when initiated, don't wait for broadcast
   */
  createQuickTab(options) {
    console.log('[QuickTabsManager] Creating Quick Tab with options:', options);

    // Generate ID if not provided
    const id = options.id || this.generateId();

    // v1.5.9.12 - Container integration: Auto-assign current container if not provided
    const cookieStoreId = options.cookieStoreId || this.cookieStoreId || 'firefox-default';

    // Check if already exists
    if (this.tabs.has(id)) {
      const existingTab = this.tabs.get(id);

      // v1.5.9.10 - CRITICAL FIX: Even if tab exists, ensure it's rendered
      // This fixes the bug where tabs exist in memory but not visually on the page
      if (!existingTab.isRendered || !existingTab.isRendered()) {
        console.log('[QuickTabsManager] Tab exists but not rendered, rendering now:', id);
        existingTab.render();
      } else {
        console.warn('[QuickTabsManager] Quick Tab already exists and is rendered:', id);
      }

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
      cookieStoreId: cookieStoreId, // v1.5.9.12 - Use auto-assigned container
      minimized: options.minimized || false,
      zIndex: this.currentZIndex,
      soloedOnTabs: options.soloedOnTabs || [], // v1.5.9.13
      mutedOnTabs: options.mutedOnTabs || [], // v1.5.9.13
      onDestroy: tabId => this.handleDestroy(tabId),
      onMinimize: tabId => this.handleMinimize(tabId),
      onFocus: tabId => this.handleFocus(tabId),
      onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
      onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
      onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
      onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
      onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs), // v1.5.9.13
      onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs) // v1.5.9.13
    });

    // Store the tab
    this.tabs.set(id, tabWindow);

    // v1.5.8.13 - Broadcast creation to other tabs
    // v1.5.9.12 - Container-specific broadcast (channel already filtered)
    this.broadcast('CREATE', {
      id,
      url: options.url,
      left: options.left || 100,
      top: options.top || 100,
      width: options.width || 800,
      height: options.height || 600,
      title: options.title || 'Quick Tab',
      cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
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
   * v1.5.8.16 - FIX Issue #2 & #3: Also send to background for proper cross-tab close
   */
  handleDestroy(id) {
    console.log('[QuickTabsManager] Handling destroy for:', id);

    // Get tab info before deleting
    const tabWindow = this.tabs.get(id);
    const url = tabWindow ? tabWindow.url : null;
    const cookieStoreId = tabWindow ? tabWindow.cookieStoreId : 'firefox-default';

    this.tabs.delete(id);
    this.minimizedManager.remove(id);

    const saveId = this.generateSaveId();

    // v1.5.8.13 - Broadcast close to other tabs
    this.broadcast('CLOSE', { id });

    // v1.5.8.16 - FIX Issue #2: Send to background to update storage and notify all tabs
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'CLOSE_QUICK_TAB',
          id: id,
          url: url,
          cookieStoreId: cookieStoreId,
          saveId: saveId
        })
        .catch(err => {
          console.error('[QuickTabsManager] Error closing Quick Tab in background:', err);
          this.releasePendingSave(saveId);
        });
    } else {
      this.releasePendingSave(saveId);
    }

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

      // v1.5.9.8 - FIX: Update storage immediately to reflect minimized state
      const saveId = this.generateSaveId();
      this.trackPendingSave(saveId);

      // v1.5.9.12 - Get cookieStoreId from tab
      const cookieStoreId = tabWindow.cookieStoreId || this.cookieStoreId || 'firefox-default';

      if (typeof browser !== 'undefined' && browser.runtime) {
        browser.runtime
          .sendMessage({
            action: 'UPDATE_QUICK_TAB_MINIMIZE',
            id: id,
            minimized: true,
            cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
            saveId: saveId,
            timestamp: Date.now()
          })
          .then(() => this.releasePendingSave(saveId))
          .catch(err => {
            console.error('[QuickTabsManager] Error updating minimize state:', err);
            this.releasePendingSave(saveId);
          });
      } else {
        this.releasePendingSave(saveId);
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
   * v1.5.9.8 - FIX: Update storage immediately to reflect restored state
   */
  restoreById(id) {
    const restored = this.restoreQuickTab(id);

    if (restored) {
      // v1.5.9.8 - FIX: Update storage immediately to reflect restored state
      const saveId = this.generateSaveId();
      this.trackPendingSave(saveId);

      if (typeof browser !== 'undefined' && browser.runtime) {
        browser.runtime
          .sendMessage({
            action: 'UPDATE_QUICK_TAB_MINIMIZE',
            id: id,
            minimized: false,
            saveId: saveId,
            timestamp: Date.now()
          })
          .then(() => this.releasePendingSave(saveId))
          .catch(err => {
            console.error('[QuickTabsManager] Error updating restore state:', err);
            this.releasePendingSave(saveId);
          });
      } else {
        this.releasePendingSave(saveId);
      }
    }

    return restored;
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
   * v1.5.8.15 - REMOVED broadcast/sync during drag to prevent performance issues
   * Position only syncs on drag end for optimal performance
   */
  handlePositionChange(id, left, top) {
    // v1.5.8.15 - No longer broadcasts or syncs during drag
    // This prevents excessive BroadcastChannel messages and storage writes
    // Position syncs only on drag end via handlePositionChangeEnd
    // Local UI update happens automatically via pointer events
  }

  /**
   * Handle Quick Tab position change end (final save)
   * v1.5.8.13 - Enhanced with BroadcastChannel sync
   * v1.5.8.14 - Added transaction ID for race condition prevention
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

    // v1.5.8.14 - Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // v1.5.9.12 - Get cookieStoreId from tab
    const tabWindow = this.tabs.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || this.cookieStoreId || 'firefox-default';

    // Send final position to background
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
          id: id,
          left: Math.round(left),
          top: Math.round(top),
          cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
          saveId: saveId, // v1.5.8.14 - Include save ID
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Final position save error:', err);
          this.releasePendingSave(saveId);
        });
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * Handle Quick Tab size change (throttled during resize)
   * v1.5.8.15 - REMOVED broadcast/sync during resize to prevent performance issues
   * Size only syncs on resize end for optimal performance
   */
  handleSizeChange(id, width, height) {
    // v1.5.8.15 - No longer broadcasts or syncs during resize
    // This prevents excessive BroadcastChannel messages and storage writes
    // Size syncs only on resize end via handleSizeChangeEnd
    // Local UI update happens automatically via pointer events
  }

  /**
   * Handle Quick Tab size change end (final save)
   * v1.5.8.13 - Enhanced with BroadcastChannel sync
   * v1.5.8.14 - Added transaction ID for race condition prevention
   * v1.5.9.12 - Container integration: Include container context
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

    // v1.5.8.14 - Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // v1.5.9.12 - Get cookieStoreId from tab
    const tabWindow = this.tabs.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || this.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
          id: id,
          width: Math.round(width),
          height: Math.round(height),
          cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
          saveId: saveId, // v1.5.8.14 - Include save ID
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Final size save error:', err);
          this.releasePendingSave(saveId);
        });
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * v1.5.9.13 - Handle solo toggle from Quick Tab window or panel
   */
  handleSoloToggle(quickTabId, newSoloedTabs) {
    console.log(`[QuickTabsManager] Toggling solo for ${quickTabId}:`, newSoloedTabs);

    const tab = this.tabs.get(quickTabId);
    if (tab) {
      tab.soloedOnTabs = newSoloedTabs;
      tab.mutedOnTabs = []; // Clear mute state (mutually exclusive)

      // Update button states if tab has them
      if (tab.soloButton) {
        const isSoloed = newSoloedTabs.length > 0;
        tab.soloButton.textContent = isSoloed ? '🎯' : '⭕';
        tab.soloButton.title = isSoloed ? 'Un-solo (show on all tabs)' : 'Solo (show only on this tab)';
        tab.soloButton.style.background = isSoloed ? '#444' : 'transparent';
      }
    }

    // Broadcast to other tabs
    this.broadcast('SOLO', {
      id: quickTabId,
      soloedOnTabs: newSoloedTabs
    });

    // Save to background
    const saveId = this.generateSaveId();
    const cookieStoreId = tab?.cookieStoreId || this.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_SOLO',
          id: quickTabId,
          soloedOnTabs: newSoloedTabs,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Solo update error:', err);
          this.releasePendingSave(saveId);
        });
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * v1.5.9.13 - Handle mute toggle from Quick Tab window or panel
   */
  handleMuteToggle(quickTabId, newMutedTabs) {
    console.log(`[QuickTabsManager] Toggling mute for ${quickTabId}:`, newMutedTabs);

    const tab = this.tabs.get(quickTabId);
    if (tab) {
      tab.mutedOnTabs = newMutedTabs;
      tab.soloedOnTabs = []; // Clear solo state (mutually exclusive)

      // Update button states if tab has them
      if (tab.muteButton) {
        const isMuted = newMutedTabs.includes(this.currentTabId);
        tab.muteButton.textContent = isMuted ? '🔇' : '🔊';
        tab.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
        tab.muteButton.style.background = isMuted ? '#c44' : 'transparent';
      }
    }

    // Broadcast to other tabs
    this.broadcast('MUTE', {
      id: quickTabId,
      mutedOnTabs: newMutedTabs
    });

    // Save to background
    const saveId = this.generateSaveId();
    const cookieStoreId = tab?.cookieStoreId || this.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime
        .sendMessage({
          action: 'UPDATE_QUICK_TAB_MUTE',
          id: quickTabId,
          mutedOnTabs: newMutedTabs,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        })
        .catch(err => {
          console.error('[QuickTabsManager] Mute update error:', err);
          this.releasePendingSave(saveId);
        });
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * Generate unique Quick Tab ID
   */
  generateId() {
    return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * v1.5.8.14 - Generate unique save ID for transaction tracking
   */
  generateSaveId() {
    const saveId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.trackPendingSave(saveId);
    return saveId;
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
