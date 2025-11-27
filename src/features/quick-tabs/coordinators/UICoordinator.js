/**
 * UICoordinator - Coordinates QuickTabWindow rendering and lifecycle
 *
 * Responsibilities:
 * - Render QuickTabWindow instances from QuickTab entities
 * - Update UI when state changes
 * - Manage QuickTabWindow lifecycle
 * - Listen to state events and trigger UI updates
 *
 * Complexity: cc ≤ 3 per method
 * 
 * v1.6.2.2 - ISSUE #35/#51 FIX: Removed container isolation to enable global Quick Tab visibility
 * v1.6.3 - Removed cross-tab sync infrastructure (single-tab Quick Tabs only)
 */

import { createQuickTabWindow } from '../window.js';

export class UICoordinator {
  /**
   * @param {StateManager} stateManager - State manager instance
   * @param {MinimizedManager} minimizedManager - Minimized manager instance
   * @param {PanelManager} panelManager - Panel manager instance
   * @param {EventEmitter} eventBus - Internal event bus
   */
  constructor(stateManager, minimizedManager, panelManager, eventBus) {
    this.stateManager = stateManager;
    this.minimizedManager = minimizedManager;
    this.panelManager = panelManager;
    this.eventBus = eventBus;
    this.renderedTabs = new Map(); // id -> QuickTabWindow
  }

  /**
   * Initialize coordinator - setup listeners and render initial state
   */
  init() {
    console.log('[UICoordinator] Initializing...');

    // Setup state listeners
    this.setupStateListeners();

    // Render initial state
    this.renderAll();

    console.log('[UICoordinator] Initialized');
  }

  /**
   * Render all visible Quick Tabs from state
   */
  renderAll() {
    console.log('[UICoordinator] Rendering all visible tabs');

    const visibleTabs = this.stateManager.getVisible();

    for (const quickTab of visibleTabs) {
      this.render(quickTab);
    }

    console.log(`[UICoordinator] Rendered ${visibleTabs.length} tabs`);
  }

  /**
   * Render a single QuickTabWindow from QuickTab entity
   * v1.6.2.2 - Removed container check for global visibility
   * v1.6.3 - Removed pending updates (no cross-tab sync)
   *
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow} Rendered tab window
   */
  render(quickTab) {
    // Skip if already rendered
    if (this.renderedTabs.has(quickTab.id)) {
      console.log('[UICoordinator] Tab already rendered:', quickTab.id);
      return this.renderedTabs.get(quickTab.id);
    }

    console.log('[UICoordinator] Rendering tab:', quickTab.id);

    // Create QuickTabWindow from QuickTab entity
    const tabWindow = this._createWindow(quickTab);

    // Store in map
    this.renderedTabs.set(quickTab.id, tabWindow);

    console.log('[UICoordinator] Tab rendered:', quickTab.id);
    return tabWindow;
  }

  /**
   * Update an existing QuickTabWindow
   *
   * @param {QuickTab} quickTab - Updated QuickTab entity
   */
  update(quickTab) {
    const tabWindow = this.renderedTabs.get(quickTab.id);

    if (!tabWindow) {
      console.warn('[UICoordinator] Tab not rendered, rendering now:', quickTab.id);
      return this.render(quickTab);
    }

    console.log('[UICoordinator] Updating tab:', quickTab.id);

    // Update tab properties
    tabWindow.updatePosition(quickTab.position.left, quickTab.position.top);
    tabWindow.updateSize(quickTab.size.width, quickTab.size.height);
    tabWindow.updateZIndex(quickTab.zIndex);

    console.log('[UICoordinator] Tab updated:', quickTab.id);
  }

  /**
   * Destroy a QuickTabWindow
   *
   * @param {string} quickTabId - ID of tab to destroy
   */
  destroy(quickTabId) {
    const tabWindow = this.renderedTabs.get(quickTabId);

    if (!tabWindow) {
      console.warn('[UICoordinator] Tab not found for destruction:', quickTabId);
      return;
    }

    console.log('[UICoordinator] Destroying tab:', quickTabId);

    // Call tab's destroy method if it exists
    if (tabWindow.destroy) {
      tabWindow.destroy();
    }

    // Remove from map
    this.renderedTabs.delete(quickTabId);

    console.log('[UICoordinator] Tab destroyed:', quickTabId);
  }

  /**
   * Setup state event listeners
   * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
   */
  setupStateListeners() {
    console.log('[UICoordinator] Setting up state listeners');

    // Listen to state changes and trigger UI updates
    this.eventBus.on('state:added', ({ quickTab }) => {
      console.log('[UICoordinator] Received state:added event', { quickTabId: quickTab.id });
      this.render(quickTab);
    });

    this.eventBus.on('state:updated', ({ quickTab }) => {
      console.log('[UICoordinator] Received state:updated event', { quickTabId: quickTab.id });
      this.update(quickTab);
    });

    this.eventBus.on('state:deleted', ({ id }) => {
      console.log('[UICoordinator] Received state:deleted event', { quickTabId: id });
      this.destroy(id);
    });

    console.log('[UICoordinator] ✓ State listeners setup complete');
  }

  /**
   * Refresh all rendered tabs with latest state
   * @private
   */
  _refreshAllRenderedTabs() {
    // Get current visible Quick Tabs from state
    const visibleTabs = this.stateManager.getVisible();
    const visibleIds = new Set(visibleTabs.map(qt => qt.id));

    // Destroy tabs that should no longer be visible
    for (const [id] of this.renderedTabs) {
      if (!visibleIds.has(id)) {
        console.log('[UICoordinator] Destroying no-longer-visible tab:', id);
        this.destroy(id);
      }
    }

    // Update or render visible tabs
    for (const quickTab of visibleTabs) {
      if (this.renderedTabs.has(quickTab.id)) {
        // Update existing rendered tab with latest state
        console.log('[UICoordinator] Updating rendered tab:', quickTab.id);
        this.update(quickTab);
      } else {
        // Render new tab
        console.log('[UICoordinator] Rendering new visible tab:', quickTab.id);
        this.render(quickTab);
      }
    }
  }

  /**
   * Create QuickTabWindow from QuickTab entity
   * @private
   *
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow} Created window
   */
  _createWindow(quickTab) {
    // Create QuickTabWindow using imported factory function from window.js
    return createQuickTabWindow({
      id: quickTab.id,
      url: quickTab.url,
      left: quickTab.position.left,
      top: quickTab.position.top,
      width: quickTab.size.width,
      height: quickTab.size.height,
      title: quickTab.title,
      cookieStoreId: quickTab.container,
      minimized: quickTab.visibility.minimized,
      zIndex: quickTab.zIndex,
      soloedOnTabs: quickTab.visibility.soloedOnTabs,
      mutedOnTabs: quickTab.visibility.mutedOnTabs
      // Note: Callbacks are passed through from QuickTabsManager facade
      // They will be added when QuickTabsManager calls this with options
    });
  }
}
