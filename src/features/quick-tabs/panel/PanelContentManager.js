/**
 * PanelContentManager Component
 * Handles content updates and Quick Tab operations for the Manager Panel
 *
 * Extracted from panel.js as part of Phase 2.10 refactoring
 * Responsibilities:
 * - Update panel content from storage
 * - Fetch and display Quick Tabs grouped by container
 * - Handle bulk operations (close minimized, close all)
 * - Handle individual Quick Tab actions (minimize, restore, close, go to tab)
 * - Setup event listeners with event delegation
 *
 * v1.6.0 - Phase 2.10: Extracted content management logic
 * v1.6.2.3 - Added real-time event listeners for state:added, state:updated, state:deleted
 */

import { PanelUIBuilder } from './PanelUIBuilder.js';
import { getContainerAPI } from '../../../shims/container-shim.js';
import { debug } from '../../../utils/debug.js';

/**
 * PanelContentManager
 * Manages panel content updates and user interactions
 */
export class PanelContentManager {
  /**
   * Create a new PanelContentManager
   * @param {HTMLElement} panelElement - The panel DOM element
   * @param {Object} dependencies - Required dependencies
   * @param {Object} dependencies.uiBuilder - PanelUIBuilder instance
   * @param {Object} dependencies.stateManager - PanelStateManager instance
   * @param {Object} dependencies.quickTabsManager - QuickTabsManager instance
   * @param {string} dependencies.currentContainerId - Current container ID
   * @param {Object} [dependencies.eventBus] - EventEmitter for state events (v1.6.2.3)
   * @param {Object} [dependencies.liveStateManager] - StateManager for live Quick Tab state (v1.6.2.3)
   * @param {Object} [dependencies.minimizedManager] - MinimizedManager for minimized tab count (v1.6.2.3)
   */
  constructor(panelElement, dependencies) {
    this.panel = panelElement;
    this.uiBuilder = dependencies.uiBuilder;
    this.stateManager = dependencies.stateManager;
    this.quickTabsManager = dependencies.quickTabsManager;
    this.currentContainerId = dependencies.currentContainerId;
    
    // v1.6.2.3 - New dependencies for real-time updates
    this.eventBus = dependencies.eventBus;
    this.liveStateManager = dependencies.liveStateManager;
    this.minimizedManager = dependencies.minimizedManager;
    
    this.eventListeners = [];
    this.isOpen = false;
    // v1.6.2.x - Track state changes while panel is closed
    this.stateChangedWhileClosed = false;
    // Cross-browser container API (native Firefox, shimmed Chrome)
    this.containerAPI = getContainerAPI();
    
    // v1.6.2.4 - Debug logging for issue tracking
    debug('[PanelContentManager] Constructor called, instance created');
  }
  
  /**
   * Get the authoritative isOpen state
   * v1.6.2.4 - FIX Issue #1: Query PanelStateManager for authoritative state
   * This prevents stale cached state from blocking content updates
   * @returns {boolean} Whether panel is open
   * @private
   */
  _getIsOpen() {
    // Query PanelStateManager for authoritative state if available
    const stateManagerAvailable = this.stateManager && typeof this.stateManager.getState === 'function';
    if (!stateManagerAvailable) {
      // Fallback to local cached state
      return this.isOpen;
    }
    
    const state = this.stateManager.getState();
    const hasAuthoritativeState = typeof state.isOpen === 'boolean';
    if (!hasAuthoritativeState) {
      return this.isOpen;
    }
    
    // Sync local state if it differs (for logging purposes)
    if (this.isOpen !== state.isOpen) {
      debug(`[PanelContentManager] Syncing isOpen: local=${this.isOpen}, stateManager=${state.isOpen}`);
      this.isOpen = state.isOpen;
    }
    return state.isOpen;
  }

  /**
   * Update panel open state
   * @param {boolean} isOpen - Whether panel is open
   */
  setIsOpen(isOpen) {
    const wasOpen = this.isOpen;
    this.isOpen = isOpen;
    
    // v1.6.2.x - Update content if panel was just opened and state changed while closed
    if (isOpen && !wasOpen && this.stateChangedWhileClosed) {
      debug('[PanelContentManager] Panel opened after state changes - updating content');
      this.stateChangedWhileClosed = false;
      this.updateContent();
    }
  }

  /**
   * Update panel content with current Quick Tabs state
   * v1.5.9.12 - Container integration: Filter by current container
   * v1.6.2.3 - Query live state from StateManager instead of storage for real-time updates
   * v1.6.2.2 - ISSUE FIX: Show all Quick Tabs globally (no container filtering)
   * v1.6.2.4 - FIX Issue #1: Use _getIsOpen() for authoritative state check
   * v1.6.3 - FIX Issue #1: Accept options.forceRefresh to bypass isOpen check
   * @param {Object} options - Update options
   * @param {boolean} [options.forceRefresh=false] - If true, bypass isOpen check and force update
   */
  async updateContent(options = { forceRefresh: false }) {
    // v1.6.2.4 - Use _getIsOpen() which queries PanelStateManager for authoritative state
    const isCurrentlyOpen = this._getIsOpen();
    
    // v1.6.3 - FIX Issue #1: If forceRefresh is true, skip isOpen check
    if (!options.forceRefresh && !isCurrentlyOpen) {
      debug(`[PanelContentManager] updateContent skipped: panel=${!!this.panel}, isOpen=${isCurrentlyOpen}`);
      // v1.6.3 - Mark state changed while closed for later update
      this.stateChangedWhileClosed = true;
      return;
    }
    
    if (!this.panel) {
      debug('[PanelContentManager] updateContent skipped: panel not initialized');
      return;
    }
    
    // Track update timestamp for health checks
    this.lastUpdateTimestamp = Date.now();

    let allQuickTabs = [];
    let minimizedCount = 0;

    // v1.6.2.3 - Prefer live state for instant updates, fallback to storage
    if (this.liveStateManager) {
      // Query live state (instant, no I/O)
      // v1.6.2.2 - Show all Quick Tabs globally for visibility
      allQuickTabs = this.liveStateManager.getAll();
      
      // Get minimized count from MinimizedManager if available
      if (this.minimizedManager) {
        minimizedCount = this.minimizedManager.getCount();
      }
      
      debug(`[PanelContentManager] Live state: ${allQuickTabs.length} tabs, ${minimizedCount} minimized`);
    } else {
      // Fallback to storage (slower, for backward compatibility)
      const quickTabsState = await this._fetchQuickTabsFromStorage();
      if (!quickTabsState) return;

      // v1.6.2.2 - Unified format: quickTabsState is already an array of tabs
      allQuickTabs = quickTabsState;
      minimizedCount = allQuickTabs.filter(t => t.minimized).length;
    }

    // Update statistics with active count
    const activeCount = allQuickTabs.length - minimizedCount;
    this._updateStatistics(allQuickTabs.length, activeCount, minimizedCount);

    // Show/hide empty state
    if (allQuickTabs.length === 0) {
      this._renderEmptyState();
      return;
    }

    // Fetch container info
    const containerInfo = await this._fetchContainerInfo();

    // Render container section
    this._renderContainerSectionFromData(allQuickTabs, containerInfo);
  }

  /**
   * Fetch Quick Tabs state from browser storage
   * v1.6.2+ - MIGRATION: Use storage.local instead of storage.sync
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   * v1.6.3 - FIX Issue #5: Add fallback to recover tabs from malformed storage
   * @returns {Array|null} Quick Tabs array
   * @private
   */
  async _fetchQuickTabsFromStorage() {
    try {
      const result = await browser.storage.local.get('quick_tabs_state_v2');
      if (!result?.quick_tabs_state_v2) {
        debug('[PanelContentManager] No storage data found');
        return null;
      }

      const state = result.quick_tabs_state_v2;
      
      // v1.6.2.2 - New unified format: { tabs: [...], timestamp, saveId }
      if (state.tabs && Array.isArray(state.tabs)) {
        debug(`[PanelContentManager] Found unified format: ${state.tabs.length} tabs`);
        return state.tabs;
      }
      
      // v1.6.2.1 and earlier - Container format: { containers: {...} }
      if (state.containers) {
        return this._extractTabsFromContainers(state.containers);
      }
      
      // v1.6.3 - FIX Issue #5: Attempt to extract tabs from unknown format
      return this._attemptStorageRecovery(state);
    } catch (err) {
      console.error('[PanelContentManager] Error loading Quick Tabs:', err);
      return null;
    }
  }

  /**
   * Extract tabs from container format (v1.6.2.1 and earlier)
   * @private
   * @param {Object} containers - Containers object
   * @returns {Array} Array of tabs
   */
  _extractTabsFromContainers(containers) {
    const allTabs = [];
    for (const containerKey of Object.keys(containers)) {
      const tabs = containers[containerKey]?.tabs || [];
      allTabs.push(...tabs);
    }
    debug(`[PanelContentManager] Migrated container format: ${allTabs.length} tabs`);
    return allTabs;
  }

  /**
   * Attempt to recover tabs from unknown/malformed storage format
   * @private
   * @param {Object} state - Storage state object
   * @returns {Array|null} Recovered tabs or null
   */
  _attemptStorageRecovery(state) {
    console.warn('[PanelContentManager] Unknown storage format detected, attempting recovery...');
    
    const possibleTabs = [];
    const stateKeys = Object.keys(state);
    // Limit keys to check to prevent performance issues with corrupted storage
    const MAX_KEYS_TO_CHECK = 20;
    const keysToCheck = stateKeys.slice(0, MAX_KEYS_TO_CHECK);
    
    for (const key of keysToCheck) {
      const value = state[key];
      // Check if value is an array with all items being tab-like objects (has id and url)
      if (Array.isArray(value) && value.length > 0) {
        // Validate ALL items have id (string/number) and url (string) to avoid malformed data
        const allValid = value.every(item => {
          const hasValidId = item?.id && (typeof item.id === 'string' || typeof item.id === 'number');
          const hasValidUrl = item?.url && typeof item.url === 'string';
          return hasValidId && hasValidUrl;
        });
        if (allValid) {
          console.warn(`[PanelContentManager] Found valid tabs array at key: ${key}`);
          possibleTabs.push(...value);
        }
      }
    }
    
    if (stateKeys.length > MAX_KEYS_TO_CHECK) {
      console.warn(`[PanelContentManager] Storage has ${stateKeys.length} keys, only checked first ${MAX_KEYS_TO_CHECK}`);
    }
    
    if (possibleTabs.length > 0) {
      console.warn(`[PanelContentManager] Recovered ${possibleTabs.length} tabs from malformed storage`);
      return possibleTabs;
    }
    
    console.error('[PanelContentManager] Storage format unrecognized and cannot be recovered');
    console.error('[PanelContentManager] Storage contents:', JSON.stringify(state, null, 2));
    return null;
  }

  /**
   * Fetch container info from browser API
   * @returns {Object} Container info (name, icon, color)
   * @private
   */
  async _fetchContainerInfo() {
    const defaultInfo = {
      name: 'Default',
      icon: '📁',
      color: 'grey'
    };

    try {
      // Cross-browser: Check if containers are supported
      if (this.currentContainerId === 'firefox-default' || !this.containerAPI.isSupported()) {
        return defaultInfo;
      }

      const containers = await this.containerAPI.query({});
      const container = containers.find(c => c.cookieStoreId === this.currentContainerId);

      if (!container) return defaultInfo;

      // v1.6.0.3 - FIX: getContainerIcon() is a static method
      return {
        name: container.name,
        icon: PanelUIBuilder.getContainerIcon(container.icon),
        color: container.color
      };
    } catch (err) {
      console.error('[PanelContentManager] Error loading container:', err);
      return defaultInfo;
    }
  }

  /**
   * Update statistics display
   * v1.6.2.3 - Updated to show active/minimized counts for better UX
   * @param {number} totalCount - Total number of tabs
   * @param {number} activeCount - Number of active tabs
   * @param {number} minimizedCount - Number of minimized tabs
   * @private
   */
  _updateStatistics(totalCount, activeCount, minimizedCount) {
    const totalTabsEl = this.panel.querySelector('#panel-totalTabs');
    const lastSyncEl = this.panel.querySelector('#panel-lastSync');

    if (totalTabsEl) {
      // Show detailed breakdown if there are minimized tabs
      if (minimizedCount > 0) {
        totalTabsEl.textContent = `${activeCount} active, ${minimizedCount} minimized`;
      } else {
        totalTabsEl.textContent = `${totalCount} Quick Tab${totalCount !== 1 ? 's' : ''}`;
      }
    }

    if (lastSyncEl) {
      // Show real-time update indicator
      const now = new Date();
      lastSyncEl.textContent = `Updated: ${now.toLocaleTimeString()}`;
    }
  }

  /**
   * Render empty state when no Quick Tabs exist
   * @private
   */
  _renderEmptyState() {
    const containersList = this.panel.querySelector('#panel-containersList');
    const emptyState = this.panel.querySelector('#panel-emptyState');

    if (containersList) {
      containersList.style.display = 'none';
    }
    if (emptyState) {
      emptyState.style.display = 'flex';
    }
  }

  /**
   * Render container section with Quick Tabs
   * @param {Object} containerState - Container state with tabs
   * @param {Object} containerInfo - Container info (name, icon, color)
   * @private
   */
  _renderContainerSection(containerState, containerInfo) {
    const containersList = this.panel.querySelector('#panel-containersList');
    const emptyState = this.panel.querySelector('#panel-emptyState');

    if (emptyState) {
      emptyState.style.display = 'none';
    }
    if (containersList) {
      containersList.style.display = 'block';
      containersList.innerHTML = '';

      // v1.6.0.3 - FIX: renderContainerSection() is a static method that returns an element
      const section = PanelUIBuilder.renderContainerSection(
        this.currentContainerId,
        containerInfo,
        containerState
      );
      containersList.appendChild(section);
    }
  }

  /**
   * Render container section from QuickTab entities or storage data
   * v1.6.2.3 - Supports both live QuickTab entities and storage format
   * @param {Array} quickTabs - Array of QuickTab entities or storage tab objects
   * @param {Object} containerInfo - Container info (name, icon, color)
   * @private
   */
  _renderContainerSectionFromData(quickTabs, containerInfo) {
    const containersList = this.panel.querySelector('#panel-containersList');
    const emptyState = this.panel.querySelector('#panel-emptyState');

    if (emptyState) {
      emptyState.style.display = 'none';
    }
    if (containersList) {
      containersList.style.display = 'block';
      containersList.innerHTML = '';

      // Convert QuickTab entities to storage-like format for rendering
      const containerState = {
        tabs: quickTabs.map(qt => {
          // Handle both QuickTab domain entities and storage format
          if (qt.visibility) {
            // QuickTab domain entity
            return {
              id: qt.id,
              url: qt.url,
              title: qt.title,
              activeTabId: qt.sourceTabId,
              minimized: qt.visibility?.minimized ?? false,
              width: qt.size?.width ?? 400,
              height: qt.size?.height ?? 300,
              left: qt.position?.left ?? 100,
              top: qt.position?.top ?? 100
            };
          } else {
            // Already in storage format
            return qt;
          }
        }),
        lastUpdate: Date.now()
      };

      const section = PanelUIBuilder.renderContainerSection(
        this.currentContainerId,
        containerInfo,
        containerState
      );
      containersList.appendChild(section);
    }
  }

  /**
   * Setup event listeners for panel interactions
   * v1.6.2.x - Added storage.onChanged listener for cross-tab sync
   * v1.6.2.4 - FIX Issue #2 & #3: Added null checks and debug logging for button setup
   */
  setupEventListeners() {
    debug('[PanelContentManager] Setting up event listeners...');
    
    // Close button
    const closeBtn = this.panel.querySelector('.panel-close');
    if (closeBtn) {
      const closeBtnHandler = e => {
        e.stopPropagation();
        if (this.onClose) this.onClose();
      };
      closeBtn.addEventListener('click', closeBtnHandler);
      this.eventListeners.push({ element: closeBtn, type: 'click', handler: closeBtnHandler });
      debug('[PanelContentManager] ✓ Close button listener attached');
    } else {
      console.warn('[PanelContentManager] Close button (.panel-close) not found in panel');
    }

    // Minimize button (same as close)
    const minimizeBtn = this.panel.querySelector('.panel-minimize');
    if (minimizeBtn) {
      const minimizeBtnHandler = e => {
        e.stopPropagation();
        if (this.onClose) this.onClose();
      };
      minimizeBtn.addEventListener('click', minimizeBtnHandler);
      this.eventListeners.push({
        element: minimizeBtn,
        type: 'click',
        handler: minimizeBtnHandler
      });
      debug('[PanelContentManager] ✓ Minimize button listener attached');
    } else {
      console.warn('[PanelContentManager] Minimize button (.panel-minimize) not found in panel');
    }

    // Close Minimized button
    const closeMinimizedBtn = this.panel.querySelector('#panel-closeMinimized');
    if (closeMinimizedBtn) {
      const closeMinimizedHandler = async e => {
        e.stopPropagation();
        debug('[PanelContentManager] Close Minimized button clicked');
        await this.handleCloseMinimized();
      };
      closeMinimizedBtn.addEventListener('click', closeMinimizedHandler);
      this.eventListeners.push({
        element: closeMinimizedBtn,
        type: 'click',
        handler: closeMinimizedHandler
      });
      debug('[PanelContentManager] ✓ Close Minimized button listener attached');
    } else {
      console.warn('[PanelContentManager] Close Minimized button (#panel-closeMinimized) not found in panel');
    }

    // Close All button
    // v1.6.2.4 - FIX Issue #2: Added null check and debug logging
    const closeAllBtn = this.panel.querySelector('#panel-closeAll');
    if (closeAllBtn) {
      const closeAllHandler = async e => {
        e.stopPropagation();
        debug('[PanelContentManager] Close All button clicked');
        debug('[PanelContentManager] handleCloseAll starting...');
        await this.handleCloseAll();
        debug('[PanelContentManager] handleCloseAll completed');
      };
      closeAllBtn.addEventListener('click', closeAllHandler);
      this.eventListeners.push({
        element: closeAllBtn,
        type: 'click',
        handler: closeAllHandler
      });
      debug('[PanelContentManager] ✓ Close All button listener attached');
    } else {
      console.warn('[PanelContentManager] Close All button (#panel-closeAll) not found in panel');
    }

    // v1.6.2.2 - Clear Storage button
    // v1.6.2.4 - FIX Issue #3: Added debug logging
    const clearStorageBtn = this.panel.querySelector('#panel-clearStorage');
    if (clearStorageBtn) {
      const clearStorageHandler = async e => {
        e.stopPropagation();
        debug('[PanelContentManager] Clear Storage button clicked');
        debug('[PanelContentManager] handleClearStorage starting...');
        await this.handleClearStorage();
        debug('[PanelContentManager] handleClearStorage completed');
      };
      clearStorageBtn.addEventListener('click', clearStorageHandler);
      this.eventListeners.push({
        element: clearStorageBtn,
        type: 'click',
        handler: clearStorageHandler
      });
      debug('[PanelContentManager] ✓ Clear Storage button listener attached');
    } else {
      console.warn('[PanelContentManager] Clear Storage button (#panel-clearStorage) not found in panel');
    }

    // Delegated listener for Quick Tab item actions
    const containersList = this.panel.querySelector('#panel-containersList');
    const actionHandler = async e => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;

      e.stopPropagation();

      const action = button.dataset.action;
      const quickTabId = button.dataset.quickTabId;
      const tabId = button.dataset.tabId;

      await this._handleQuickTabAction(action, quickTabId, tabId);
    };
    containersList.addEventListener('click', actionHandler);
    this.eventListeners.push({
      element: containersList,
      type: 'click',
      handler: actionHandler
    });

    // v1.6.2.x - Listen for storage changes from other tabs (cross-tab sync)
    const storageListener = (changes, areaName) => {
      if (areaName !== 'local') return;
      
      // Check if quick_tabs_state_v2 changed
      if (changes.quick_tabs_state_v2) {
        debug('[PanelContentManager] Storage changed from another tab - updating content');
        
        // v1.6.2.4 - FIX: Use _getIsOpen() for authoritative state check
        if (this._getIsOpen()) {
          this.updateContent();
        } else {
          this.stateChangedWhileClosed = true;
          debug('[PanelContentManager] Storage changed while panel closed - will update on open');
        }
      }
    };
    
    browser.storage.onChanged.addListener(storageListener);
    this._storageListener = storageListener;  // Store for cleanup

    // v1.6.2.3 - Setup state event listeners for real-time updates
    this.setupStateListeners();

    debug('[PanelContentManager] Event listeners setup (including storage.onChanged)');
  }

  /**
   * Setup listeners for Quick Tab state events
   * v1.6.2.3 - Called when panel opens, enables real-time updates
   * v1.6.2.x - Track state changes when panel is closed
   * v1.6.3 - FIX Issue #2: Add EventBus connection test
   */
  setupStateListeners() {
    if (!this.eventBus) {
      console.warn('[PanelContentManager] No eventBus available - skipping state listeners. Real-time updates will not work.');
      return;
    }

    // v1.6.3 - FIX Issue #2: Test EventBus connection by emitting and listening for test event
    // Using synchronous pattern since EventEmitter3 is synchronous
    let testReceived = false;
    const testHandler = () => { testReceived = true; };
    try {
      this.eventBus.on('test:connection', testHandler);
      this.eventBus.emit('test:connection');
      this.eventBus.off('test:connection', testHandler);
      
      if (!testReceived) {
        console.error('[PanelContentManager] EventBus connection test FAILED - events may not propagate correctly');
      } else {
        debug('[PanelContentManager] EventBus connection test PASSED');
      }
    } catch (err) {
      console.error('[PanelContentManager] EventBus connection test threw error:', err);
    }

    // Listen for Quick Tab created
    // v1.6.3 - FIX Issue #1 & #3: Always mark stateChangedWhileClosed and call updateContent
    // Note: Calling updateContent when closed is intentional - it checks isOpen internally
    // and returns early with stateChangedWhileClosed flag set, avoiding DOM updates
    const addedHandler = (data) => {
      try {
        const quickTab = data?.quickTab || data;
        debug(`[PanelContentManager] state:added received for ${quickTab?.id}`);
        
        // v1.6.3 - Only mark state changed if panel is closed
        if (!this._getIsOpen()) {
          this.stateChangedWhileClosed = true;
        }
        
        // v1.6.3 - Try to update content - it will handle isOpen internally
        this.updateContent({ forceRefresh: false });
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:added:', err);
      }
    };
    this.eventBus.on('state:added', addedHandler);

    // Listen for Quick Tab updated (minimize/restore/position change)
    // v1.6.3 - FIX Issue #1 & #3: Always mark stateChangedWhileClosed and call updateContent
    const updatedHandler = (data) => {
      try {
        const quickTab = data?.quickTab || data;
        debug(`[PanelContentManager] state:updated received for ${quickTab?.id}`);
        
        // v1.6.3 - Only mark state changed if panel is closed
        if (!this._getIsOpen()) {
          this.stateChangedWhileClosed = true;
        }
        
        // v1.6.3 - Try to update content - it will handle isOpen internally
        this.updateContent({ forceRefresh: false });
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:updated:', err);
      }
    };
    this.eventBus.on('state:updated', updatedHandler);

    // Listen for Quick Tab deleted (closed)
    // v1.6.3 - FIX Issue #1 & #3: Always mark stateChangedWhileClosed and call updateContent
    const deletedHandler = (data) => {
      try {
        const id = data?.id || data?.quickTab?.id;
        debug(`[PanelContentManager] state:deleted received for ${id}`);
        
        // v1.6.3 - Only mark state changed if panel is closed
        if (!this._getIsOpen()) {
          this.stateChangedWhileClosed = true;
        }
        
        // v1.6.3 - Try to update content - it will handle isOpen internally
        this.updateContent({ forceRefresh: false });
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:deleted:', err);
      }
    };
    this.eventBus.on('state:deleted', deletedHandler);

    // Listen for state hydration (cross-tab sync)
    // v1.6.3 - FIX Issue #1 & #3: Always mark stateChangedWhileClosed and call updateContent
    const hydratedHandler = (data) => {
      try {
        debug(`[PanelContentManager] state:hydrated received, ${data?.count} tabs`);
        
        // v1.6.3 - Only mark state changed if panel is closed
        if (!this._getIsOpen()) {
          this.stateChangedWhileClosed = true;
        }
        
        // v1.6.3 - Try to update content - it will handle isOpen internally
        this.updateContent({ forceRefresh: false });
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:hydrated:', err);
      }
    };
    this.eventBus.on('state:hydrated', hydratedHandler);

    // v1.6.3 - Listen for state cleared (from Clear Storage button)
    const clearedHandler = (data) => {
      try {
        debug(`[PanelContentManager] state:cleared received, ${data?.count ?? 0} tabs cleared`);
        
        // Mark state changed if panel is closed
        if (!this._getIsOpen()) {
          this.stateChangedWhileClosed = true;
        }
        
        // v1.6.3 - FIX Issue #6: Force refresh to update immediately
        this.updateContent({ forceRefresh: true });
        
        debug('[PanelContentManager] State cleared - panel updated');
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:cleared:', err);
      }
    };
    this.eventBus.on('state:cleared', clearedHandler);

    // Store handlers for cleanup
    this._stateHandlers = {
      added: addedHandler,
      updated: updatedHandler,
      deleted: deletedHandler,
      hydrated: hydratedHandler,
      cleared: clearedHandler  // v1.6.3
    };

    debug('[PanelContentManager] State event listeners setup');
  }

  /**
   * Handle Quick Tab action button clicks
   * v1.6.2.x - Removed setTimeout race condition, rely on event listeners
   * @param {string} action - Action type (goToTab, minimize, restore, close)
   * @param {string} quickTabId - Quick Tab ID
   * @param {string} tabId - Browser tab ID
   * @private
   */
  async _handleQuickTabAction(action, quickTabId, tabId) {
    debug(`[PanelContentManager] Handling action: ${action} for ${quickTabId}`);
    
    switch (action) {
      case 'goToTab':
        await this.handleGoToTab(parseInt(tabId, 10));
        break;
      case 'minimize':
        this.handleMinimizeTab(quickTabId);
        break;
      case 'restore':
        this.handleRestoreTab(quickTabId);
        break;
      case 'close':
        this.handleCloseTab(quickTabId);
        break;
      default:
        console.warn(`[PanelContentManager] Unknown action: ${action}`);
    }

    // v1.6.2.x - Removed setTimeout race condition
    // State event listeners (state:added/updated/deleted) will trigger updateContent()
    // No manual update needed - this prevents race conditions where setTimeout may fire
    // before state has fully propagated
    debug(`[PanelContentManager] Action ${action} completed, waiting for state event`);
  }

  /**
   * Close all minimized Quick Tabs
   * v1.5.8.15 - Fixed to handle wrapped container format
   * v1.6.2+ - MIGRATION: Use storage.local instead of storage.sync
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   */
  async handleCloseMinimized() {
    try {
      const result = await browser.storage.local.get('quick_tabs_state_v2');
      if (!result || !result.quick_tabs_state_v2) return;

      const state = result.quick_tabs_state_v2;
      let hasChanges = false;

      // v1.6.2.2 - New unified format: { tabs: [...], timestamp, saveId }
      if (state.tabs && Array.isArray(state.tabs)) {
        const originalLength = state.tabs.length;
        state.tabs = state.tabs.filter(t => !t.minimized);
        
        if (state.tabs.length !== originalLength) {
          hasChanges = true;
          state.timestamp = Date.now();
          state.saveId = this._generateSaveId();
        }
        
        if (hasChanges) {
          await browser.storage.local.set({ quick_tabs_state_v2: state });
          debug('[PanelContentManager] Closed minimized Quick Tabs (unified format)');
          await this.updateContent();
        }
        return;
      }

      // v1.6.2.1 and earlier - Container format: { containers: {...} }
      // Backward compatible migration
      const containers = state.containers || state;

      // Iterate through containers
      Object.keys(containers).forEach(key => {
        // Skip metadata keys
        if (key === 'saveId' || key === 'timestamp' || key === 'writeSourceId') return;

        const containerState = containers[key];
        if (!containerState?.tabs || !Array.isArray(containerState.tabs)) {
          return;
        }

        const originalLength = containerState.tabs.length;

        // Filter out minimized tabs
        containerState.tabs = containerState.tabs.filter(t => !t.minimized);

        if (containerState.tabs.length !== originalLength) {
          hasChanges = true;
          containerState.lastUpdate = Date.now();
        }
      });

      if (hasChanges) {
        // Save with proper wrapper format
        const stateToSave = {
          containers,
          saveId: this._generateSaveId(),
          timestamp: Date.now()
        };

        await browser.storage.local.set({ quick_tabs_state_v2: stateToSave });

        // Update session storage
        await this._updateSessionStorage(stateToSave);

        debug('[PanelContentManager] Closed minimized Quick Tabs');
        await this.updateContent();
      }
    } catch (err) {
      console.error('[PanelContentManager] Error closing minimized:', err);
    }
  }

  /**
   * Update session storage helper
   * @param {Object} state - State to save
   * @private
   */
  async _updateSessionStorage(state) {
    if (typeof browser.storage.session !== 'undefined') {
      await browser.storage.session.set({ quick_tabs_session: state });
    }
  }

  /**
   * Close all Quick Tabs
   * v1.5.8.15 - Fixed to use proper wrapped format
   * v1.6.2+ - MIGRATION: Use storage.local instead of storage.sync
   * v1.6.2.4 - FIX Issue #3: Destroy DOM elements BEFORE clearing storage
   *            storage.onChanged does NOT fire in the tab that made the change,
   *            so we must explicitly destroy DOM elements in the current tab.
   * v1.6.2.2 - Updated for unified format (tabs array instead of containers object)
   * v1.6.3 - Clear in-memory state and emit state:cleared event, use forceRefresh
   */
  async handleCloseAll() {
    try {
      // Get count before clearing for logging
      let clearedCount = 0;
      if (this.liveStateManager) {
        clearedCount = this.liveStateManager.count();
      }

      // v1.6.2.4 - FIX: Destroy all Quick Tab DOM elements in current tab FIRST
      // storage.onChanged will handle cleanup in OTHER tabs automatically
      if (this.quickTabsManager?.closeAll) {
        console.log('[PanelContentManager] Destroying all Quick Tab DOM elements in current tab...');
        this.quickTabsManager.closeAll();
      } else {
        console.warn('[PanelContentManager] quickTabsManager.closeAll not available');
      }

      // v1.6.3 - FIX Issue #6: Force clear in-memory state manager
      if (this.liveStateManager?.clear) {
        console.log('[PanelContentManager] Forcing in-memory state clear...');
        this.liveStateManager.clear();
      }

      // v1.6.2.2 - Use unified format
      const emptyState = {
        tabs: [],
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      };

      await browser.storage.local.set({ quick_tabs_state_v2: emptyState });

      // Clear session storage
      await this._updateSessionStorage(emptyState);

      // v1.6.3 - Emit state:cleared event for other listeners
      if (this.eventBus) {
        this.eventBus.emit('state:cleared', { count: clearedCount });
        debug(`[PanelContentManager] Emitted state:cleared event (${clearedCount} tabs closed)`);
      }

      // Note: Cross-tab sync happens via storage.onChanged which fires when we write to storage.local above.
      // Other tabs will receive the change and update their UI accordingly.

      debug('[PanelContentManager] Closed all Quick Tabs');
      
      // v1.6.3 - FIX Issue #6: Force refresh to update immediately
      await this.updateContent({ forceRefresh: true });
    } catch (err) {
      console.error('[PanelContentManager] Error closing all:', err);
    }
  }

  /**
   * Clear all Quick Tab storage
   * v1.6.2.2 - Debug/testing utility
   * v1.6.3 - Emit state:cleared event to update panel and other listeners
   * v1.6.3 - FIX Issue #6: Force liveStateManager.clear() before emitting event, use forceRefresh
   * CRITICAL: Destroy DOM elements BEFORE clearing storage
   */
  async handleClearStorage() {
    try {
      // Confirm with user
      // eslint-disable-next-line no-alert
      const confirmed = confirm(
        'Clear ALL Quick Tab Storage?\n\n' +
        'This will remove all Quick Tabs and their state.\n' +
        'This action cannot be undone.'
      );
      
      if (!confirmed) return;
      
      // Get count before clearing for logging
      let clearedCount = 0;
      if (this.liveStateManager) {
        clearedCount = this.liveStateManager.count();
      }
      
      // Destroy all Quick Tab DOM elements in current tab FIRST
      if (this.quickTabsManager?.closeAll) {
        console.log('[PanelContentManager] Destroying all Quick Tab DOM elements...');
        this.quickTabsManager.closeAll();
      }

      // v1.6.3 - FIX Issue #6: Force clear in-memory state BEFORE emitting event
      if (this.liveStateManager?.clear) {
        console.log('[PanelContentManager] Forcing in-memory state clear...');
        this.liveStateManager.clear();
      }

      // Clear storage (unified format)
      const emptyState = {
        tabs: [],
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      };

      await browser.storage.local.set({ quick_tabs_state_v2: emptyState });
      
      // Clear session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        await browser.storage.session.set({ quick_tabs_session: emptyState });
      }

      // v1.6.3 - Emit state:cleared event for other listeners (e.g., background script)
      if (this.eventBus) {
        this.eventBus.emit('state:cleared', { count: clearedCount });
        debug(`[PanelContentManager] Emitted state:cleared event (${clearedCount} tabs cleared)`);
      }

      console.log('[PanelContentManager] ✓ Cleared all Quick Tab storage');
      
      // v1.6.3 - FIX Issue #6: Force refresh to update immediately
      await this.updateContent({ forceRefresh: true });
    } catch (err) {
      console.error('[PanelContentManager] Error clearing storage:', err);
    }
  }

  /**
   * Go to browser tab
   * v1.6.0.1 - Fixed to use message passing (browser.tabs.update not available in content scripts)
   * @param {number} tabId - Browser tab ID
   */
  async handleGoToTab(tabId) {
    try {
      // Content scripts cannot access browser.tabs.update API
      // Must request tab switch from background script
      const response = await browser.runtime.sendMessage({
        action: 'SWITCH_TO_TAB',
        tabId
      });

      if (response && response.success) {
        debug(`[PanelContentManager] Switched to tab ${tabId}`);
      } else {
        console.error('[PanelContentManager] Failed to switch to tab:', response?.error);
      }
    } catch (err) {
      console.error('[PanelContentManager] Error switching to tab:', err);
    }
  }

  /**
   * Minimize Quick Tab
   * v1.6.2.x - Added defensive checks
   * @param {string} quickTabId - Quick Tab ID
   */
  handleMinimizeTab(quickTabId) {
    if (!this.quickTabsManager) {
      console.error('[PanelContentManager] quickTabsManager not available');
      return;
    }
    
    if (typeof this.quickTabsManager.minimizeById !== 'function') {
      console.error('[PanelContentManager] minimizeById method not found on quickTabsManager');
      return;
    }
    
    debug(`[PanelContentManager] Calling minimizeById for ${quickTabId}`);
    this.quickTabsManager.minimizeById(quickTabId);
  }

  /**
   * Restore Quick Tab
   * v1.6.2.x - Added defensive checks
   * @param {string} quickTabId - Quick Tab ID
   */
  handleRestoreTab(quickTabId) {
    if (!this.quickTabsManager) {
      console.error('[PanelContentManager] quickTabsManager not available');
      return;
    }
    
    if (typeof this.quickTabsManager.restoreById !== 'function') {
      console.error('[PanelContentManager] restoreById method not found on quickTabsManager');
      return;
    }
    
    debug(`[PanelContentManager] Calling restoreById for ${quickTabId}`);
    this.quickTabsManager.restoreById(quickTabId);
  }

  /**
   * Close Quick Tab
   * v1.6.2.x - Added defensive checks
   * @param {string} quickTabId - Quick Tab ID
   */
  handleCloseTab(quickTabId) {
    if (!this.quickTabsManager) {
      console.error('[PanelContentManager] quickTabsManager not available');
      return;
    }
    
    if (typeof this.quickTabsManager.closeById !== 'function') {
      console.error('[PanelContentManager] closeById method not found on quickTabsManager');
      return;
    }
    
    debug(`[PanelContentManager] Calling closeById for ${quickTabId}`);
    this.quickTabsManager.closeById(quickTabId);
  }

  /**
   * Generate unique save ID for transaction tracking
   * @returns {string} Unique save ID
   * @private
   */
  _generateSaveId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set callback for panel close
   * @param {Function} callback - Close callback
   */
  setOnClose(callback) {
    this.onClose = callback;
  }

  /**
   * Get the count of active state event listeners
   * v1.6.3 - Added for health check diagnostics
   * Note: This counts locally tracked handlers. EventBus registration is verified during setupStateListeners.
   * @returns {number} Number of tracked state listener handlers
   */
  getListenerCount() {
    if (!this._stateHandlers) {
      return 0;
    }
    // Count only non-null handlers that are actually functions
    return Object.values(this._stateHandlers).filter(h => typeof h === 'function').length;
  }

  /**
   * Cleanup event listeners and references
   * v1.6.2.3 - Also cleanup state event listeners
   * v1.6.2.x - Also cleanup storage.onChanged listener
   */
  destroy() {
    // Remove all DOM event listeners
    this.eventListeners.forEach(({ element, type, handler }) => {
      if (element) {
        element.removeEventListener(type, handler);
      }
    });
    this.eventListeners = [];

    // v1.6.2.x - Remove storage change listener
    if (this._storageListener) {
      browser.storage.onChanged.removeListener(this._storageListener);
      this._storageListener = null;
    }

    // v1.6.2.3 - Remove state event listeners
    if (this.eventBus && this._stateHandlers) {
      this.eventBus.off('state:added', this._stateHandlers.added);
      this.eventBus.off('state:updated', this._stateHandlers.updated);
      this.eventBus.off('state:deleted', this._stateHandlers.deleted);
      this.eventBus.off('state:hydrated', this._stateHandlers.hydrated);
      // v1.6.3 - Also remove cleared handler
      if (this._stateHandlers.cleared) {
        this.eventBus.off('state:cleared', this._stateHandlers.cleared);
      }
      this._stateHandlers = null;
    }

    // Clear references
    this.panel = null;
    this.uiBuilder = null;
    this.stateManager = null;
    this.quickTabsManager = null;
    this.onClose = null;
    this.eventBus = null;
    this.liveStateManager = null;
    this.minimizedManager = null;

    debug('[PanelContentManager] Destroyed');
  }
}
