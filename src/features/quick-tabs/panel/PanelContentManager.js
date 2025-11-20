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
 */

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
   */
  constructor(panelElement, dependencies) {
    this.panel = panelElement;
    this.uiBuilder = dependencies.uiBuilder;
    this.stateManager = dependencies.stateManager;
    this.quickTabsManager = dependencies.quickTabsManager;
    this.currentContainerId = dependencies.currentContainerId;
    this.eventListeners = [];
    this.isOpen = false;
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
   */
  async updateContent() {
    if (!this.panel || !this.isOpen) return;

    // Fetch Quick Tabs from storage
    const quickTabsState = await this._fetchQuickTabsFromStorage();
    if (!quickTabsState) return;

    // Get current container's tabs
    const currentContainerState = quickTabsState[this.currentContainerId];
    const currentContainerTabs = currentContainerState?.tabs || [];
    const latestTimestamp = currentContainerState?.lastUpdate || 0;

    // Update statistics
    this._updateStatistics(currentContainerTabs.length, latestTimestamp);

    // Show/hide empty state
    if (currentContainerTabs.length === 0) {
      this._renderEmptyState();
      return;
    }

    // Fetch container info
    const containerInfo = await this._fetchContainerInfo();

    // Render container section
    this._renderContainerSection(currentContainerState, containerInfo);
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
      if (
        this.currentContainerId === 'firefox-default' ||
        typeof browser.contextualIdentities === 'undefined'
      ) {
        return defaultInfo;
      }

      const containers = await browser.contextualIdentities.query({});
      const container = containers.find(c => c.cookieStoreId === this.currentContainerId);

      if (!container) return defaultInfo;

      return {
        name: container.name,
        icon: this.uiBuilder.getContainerIcon(container.icon),
        color: container.color
      };
    } catch (err) {
      console.error('[PanelContentManager] Error loading container:', err);
      return defaultInfo;
    }
  }

  /**
   * Update statistics display
   * @param {number} tabCount - Number of tabs
   * @param {number} timestamp - Last update timestamp
   * @private
   */
  _updateStatistics(tabCount, timestamp) {
    const totalTabsEl = this.panel.querySelector('#panel-totalTabs');
    const lastSyncEl = this.panel.querySelector('#panel-lastSync');

    if (totalTabsEl) {
      totalTabsEl.textContent = `${tabCount} Quick Tab${tabCount !== 1 ? 's' : ''}`;
    }

    if (lastSyncEl) {
      if (timestamp > 0) {
        const date = new Date(timestamp);
        lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
      } else {
        lastSyncEl.textContent = 'Last sync: Never';
      }
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

      // Use UIBuilder to render the section
      this.uiBuilder.renderContainerSection(
        containersList,
        this.currentContainerId,
        containerInfo,
        containerState
      );
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

    debug('[PanelContentManager] Event listeners setup');
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

    // Update panel after action
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
   */
  destroy() {
    // Remove all event listeners
    this.eventListeners.forEach(({ element, type, handler }) => {
      if (element) {
        element.removeEventListener(type, handler);
      }
    });
    this.eventListeners = [];

    // Clear references
    this.panel = null;
    this.uiBuilder = null;
    this.stateManager = null;
    this.quickTabsManager = null;
    this.onClose = null;

    debug('[PanelContentManager] Destroyed');
  }
}
