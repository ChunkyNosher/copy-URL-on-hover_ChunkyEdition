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
 */

/* global createQuickTabWindow */

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
   */
  setupStateListeners() {
    console.log('[UICoordinator] Setting up state listeners');

    // Listen to state changes and trigger UI updates
    this.eventBus.on('state:added', ({ quickTab }) => {
      this.render(quickTab);
    });

    this.eventBus.on('state:updated', ({ quickTab }) => {
      this.update(quickTab);
    });

    this.eventBus.on('state:deleted', ({ id }) => {
      this.destroy(id);
    });
  }

  /**
   * Create QuickTabWindow from QuickTab entity
   * @private
   *
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow} Created window
   */
  _createWindow(quickTab) {
    // Use global createQuickTabWindow function
    // (This function is defined in window.js and attached to global scope)
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
