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
    // Cross-browser container API (native Firefox, shimmed Chrome)
    this.containerAPI = getContainerAPI();
  }

  /**
   * Update panel open state
   * @param {boolean} isOpen - Whether panel is open
   */
  setIsOpen(isOpen) {
    this.isOpen = isOpen;
  }

  /**
   * Update panel content with current Quick Tabs state
   * v1.5.9.12 - Container integration: Filter by current container
   * v1.6.2.3 - Query live state from StateManager instead of storage for real-time updates
   */
  async updateContent() {
    if (!this.panel || !this.isOpen) return;

    let currentContainerTabs = [];
    let minimizedCount = 0;

    // v1.6.2.3 - Prefer live state for instant updates, fallback to storage
    if (this.liveStateManager) {
      // Query live state (instant, no I/O)
      const allQuickTabs = this.liveStateManager.getAll();
      currentContainerTabs = allQuickTabs.filter(qt => 
        qt.container === this.currentContainerId || 
        qt.cookieStoreId === this.currentContainerId
      );
      
      // Get minimized count from MinimizedManager if available
      if (this.minimizedManager) {
        minimizedCount = this.minimizedManager.getCount();
      }
      
      debug(`[PanelContentManager] Live state: ${currentContainerTabs.length} tabs, ${minimizedCount} minimized`);
    } else {
      // Fallback to storage (slower, for backward compatibility)
      const quickTabsState = await this._fetchQuickTabsFromStorage();
      if (!quickTabsState) return;

      const currentContainerState = quickTabsState[this.currentContainerId];
      currentContainerTabs = currentContainerState?.tabs || [];
      minimizedCount = currentContainerTabs.filter(t => t.minimized).length;
    }

    // Update statistics with active count
    const activeCount = currentContainerTabs.length - minimizedCount;
    this._updateStatistics(currentContainerTabs.length, activeCount, minimizedCount);

    // Show/hide empty state
    if (currentContainerTabs.length === 0) {
      this._renderEmptyState();
      return;
    }

    // Fetch container info
    const containerInfo = await this._fetchContainerInfo();

    // Render container section
    this._renderContainerSectionFromData(currentContainerTabs, containerInfo);
  }

  /**
   * Fetch Quick Tabs state from browser storage
   * @returns {Object|null} Quick Tabs state by container
   * @private
   */
  async _fetchQuickTabsFromStorage() {
    try {
      const result = await browser.storage.sync.get('quick_tabs_state_v2');
      if (!result || !result.quick_tabs_state_v2) return null;

      const state = result.quick_tabs_state_v2;
      // v1.5.8.15: Handle wrapped format
      return state.containers || state;
    } catch (err) {
      console.error('[PanelContentManager] Error loading Quick Tabs:', err);
      return null;
    }
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
   */
  setupEventListeners() {
    // Close button
    const closeBtn = this.panel.querySelector('.panel-close');
    const closeBtnHandler = e => {
      e.stopPropagation();
      if (this.onClose) this.onClose();
    };
    closeBtn.addEventListener('click', closeBtnHandler);
    this.eventListeners.push({ element: closeBtn, type: 'click', handler: closeBtnHandler });

    // Minimize button (same as close)
    const minimizeBtn = this.panel.querySelector('.panel-minimize');
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

    // Close Minimized button
    const closeMinimizedBtn = this.panel.querySelector('#panel-closeMinimized');
    const closeMinimizedHandler = async e => {
      e.stopPropagation();
      await this.handleCloseMinimized();
    };
    closeMinimizedBtn.addEventListener('click', closeMinimizedHandler);
    this.eventListeners.push({
      element: closeMinimizedBtn,
      type: 'click',
      handler: closeMinimizedHandler
    });

    // Close All button
    const closeAllBtn = this.panel.querySelector('#panel-closeAll');
    const closeAllHandler = async e => {
      e.stopPropagation();
      await this.handleCloseAll();
    };
    closeAllBtn.addEventListener('click', closeAllHandler);
    this.eventListeners.push({
      element: closeAllBtn,
      type: 'click',
      handler: closeAllHandler
    });

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

    // v1.6.2.3 - Setup state event listeners for real-time updates
    this.setupStateListeners();

    debug('[PanelContentManager] Event listeners setup');
  }

  /**
   * Setup listeners for Quick Tab state events
   * v1.6.2.3 - Called when panel opens, enables real-time updates
   */
  setupStateListeners() {
    if (!this.eventBus) {
      debug('[PanelContentManager] No eventBus available - skipping state listeners');
      return;
    }

    // Listen for Quick Tab created
    const addedHandler = (data) => {
      try {
        const quickTab = data?.quickTab || data;
        debug(`[PanelContentManager] state:added received for ${quickTab?.id}`);
        if (this.isOpen) {
          this.updateContent();
        }
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:added:', err);
      }
    };
    this.eventBus.on('state:added', addedHandler);

    // Listen for Quick Tab updated (minimize/restore/position change)
    const updatedHandler = (data) => {
      try {
        const quickTab = data?.quickTab || data;
        debug(`[PanelContentManager] state:updated received for ${quickTab?.id}`);
        if (this.isOpen) {
          this.updateContent();
        }
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:updated:', err);
      }
    };
    this.eventBus.on('state:updated', updatedHandler);

    // Listen for Quick Tab deleted (closed)
    const deletedHandler = (data) => {
      try {
        const id = data?.id || data?.quickTab?.id;
        debug(`[PanelContentManager] state:deleted received for ${id}`);
        if (this.isOpen) {
          this.updateContent();
        }
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:deleted:', err);
      }
    };
    this.eventBus.on('state:deleted', deletedHandler);

    // Listen for state hydration (cross-tab sync)
    const hydratedHandler = (data) => {
      try {
        debug(`[PanelContentManager] state:hydrated received, ${data?.count} tabs`);
        if (this.isOpen) {
          this.updateContent();
        }
      } catch (err) {
        console.error('[PanelContentManager] Error handling state:hydrated:', err);
      }
    };
    this.eventBus.on('state:hydrated', hydratedHandler);

    // Store handlers for cleanup
    this._stateHandlers = {
      added: addedHandler,
      updated: updatedHandler,
      deleted: deletedHandler,
      hydrated: hydratedHandler
    };

    debug('[PanelContentManager] State event listeners setup');
  }

  /**
   * Handle Quick Tab action button clicks
   * @param {string} action - Action type (goToTab, minimize, restore, close)
   * @param {string} quickTabId - Quick Tab ID
   * @param {string} tabId - Browser tab ID
   * @private
   */
  async _handleQuickTabAction(action, quickTabId, tabId) {
    switch (action) {
      case 'goToTab':
        await this.handleGoToTab(parseInt(tabId, 10));
        break;
      case 'minimize':
        await this.handleMinimizeTab(quickTabId);
        break;
      case 'restore':
        await this.handleRestoreTab(quickTabId);
        break;
      case 'close':
        await this.handleCloseTab(quickTabId);
        break;
      default:
        console.warn(`[PanelContentManager] Unknown action: ${action}`);
    }

    // v1.6.2.3 - Note: With event listeners, this is now redundant as state:added/updated/deleted
    // events will trigger updateContent(). Keeping as fallback for edge cases where events might not fire.
    setTimeout(() => this.updateContent(), 100);
  }

  /**
   * Close all minimized Quick Tabs
   * v1.5.8.15 - Fixed to handle wrapped container format
   */
  async handleCloseMinimized() {
    try {
      const result = await browser.storage.sync.get('quick_tabs_state_v2');
      if (!result || !result.quick_tabs_state_v2) return;

      const state = result.quick_tabs_state_v2;
      let hasChanges = false;

      // v1.5.8.15: Handle wrapped format
      const containers = state.containers || state;

      // Iterate through containers
      Object.keys(containers).forEach(key => {
        // Skip metadata keys
        if (key === 'saveId' || key === 'timestamp') return;

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

        await browser.storage.sync.set({ quick_tabs_state_v2: stateToSave });

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
   */
  async handleCloseAll() {
    try {
      // Use wrapped container format
      const emptyState = {
        containers: {
          'firefox-default': { tabs: [], lastUpdate: Date.now() }
        },
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      };

      await browser.storage.sync.set({ quick_tabs_state_v2: emptyState });

      // Clear session storage
      await this._updateSessionStorage(emptyState);

      // Notify all tabs via background
      browser.runtime
        .sendMessage({
          action: 'CLEAR_ALL_QUICK_TABS'
        })
        .catch(() => {
          // Ignore errors when background script is not available
        });

      debug('[PanelContentManager] Closed all Quick Tabs');
      await this.updateContent();
    } catch (err) {
      console.error('[PanelContentManager] Error closing all:', err);
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
   * @param {string} quickTabId - Quick Tab ID
   */
  handleMinimizeTab(quickTabId) {
    if (this.quickTabsManager?.minimizeById) {
      this.quickTabsManager.minimizeById(quickTabId);
    }
  }

  /**
   * Restore Quick Tab
   * @param {string} quickTabId - Quick Tab ID
   */
  handleRestoreTab(quickTabId) {
    if (this.quickTabsManager?.restoreById) {
      this.quickTabsManager.restoreById(quickTabId);
    }
  }

  /**
   * Close Quick Tab
   * @param {string} quickTabId - Quick Tab ID
   */
  handleCloseTab(quickTabId) {
    if (this.quickTabsManager?.closeById) {
      this.quickTabsManager.closeById(quickTabId);
    }
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
   * Cleanup event listeners and references
   * v1.6.2.3 - Also cleanup state event listeners
   */
  destroy() {
    // Remove all DOM event listeners
    this.eventListeners.forEach(({ element, type, handler }) => {
      if (element) {
        element.removeEventListener(type, handler);
      }
    });
    this.eventListeners = [];

    // v1.6.2.3 - Remove state event listeners
    if (this.eventBus && this._stateHandlers) {
      this.eventBus.off('state:added', this._stateHandlers.added);
      this.eventBus.off('state:updated', this._stateHandlers.updated);
      this.eventBus.off('state:deleted', this._stateHandlers.deleted);
      this.eventBus.off('state:hydrated', this._stateHandlers.hydrated);
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
