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
 *            Quick Tabs are now visible across ALL tabs regardless of Firefox Container.
 *            This aligns with Issue #47 requirements for global visibility.
 */

import { createQuickTabWindow } from '../window.js';

export class UICoordinator {
  /**
   * @param {StateManager} stateManager - State manager instance
   * @param {MinimizedManager} minimizedManager - Minimized manager instance
   * @param {PanelManager} panelManager - Panel manager instance
   * @param {EventEmitter} eventBus - Internal event bus
   * @param {UpdateHandler} updateHandler - Update handler for pending updates (optional)
   */
  constructor(stateManager, minimizedManager, panelManager, eventBus, updateHandler = null) {
    this.stateManager = stateManager;
    this.minimizedManager = minimizedManager;
    this.panelManager = panelManager;
    this.eventBus = eventBus;
    this.updateHandler = updateHandler; // v1.6.2.4 - For applying pending updates after render
    this.renderedTabs = new Map(); // id -> QuickTabWindow
  }

  /**
   * Set the update handler (alternative to constructor injection)
   * v1.6.2.4 - BUG FIX Issues 2 & 6: Allow setting updateHandler after construction
   * @param {UpdateHandler} updateHandler - Update handler instance
   */
  setUpdateHandler(updateHandler) {
    this.updateHandler = updateHandler;
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
   * v1.6.2.2 - ISSUE #35/#51 FIX: Removed container check to enable global visibility
   *            Quick Tabs are now visible across ALL tabs regardless of Firefox Container.
   *            This aligns with Issue #47 requirements for global visibility.
   * v1.6.2.4 - BUG FIX Issues 2 & 6: Apply pending updates after creation
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

    // v1.6.2.2 - Container check REMOVED for global visibility (Issue #35, #51, #47)
    // Quick Tabs are now visible across ALL tabs regardless of Firefox Container

    console.log('[UICoordinator] Rendering tab:', quickTab.id);

    // Create QuickTabWindow from QuickTab entity
    const tabWindow = this._createWindow(quickTab);

    // Store in map
    this.renderedTabs.set(quickTab.id, tabWindow);

    // v1.6.2.4 - BUG FIX Issues 2 & 6: Apply any pending position/size updates
    // Updates may have arrived via BroadcastChannel before storage.onChanged created the tab
    this._applyPendingUpdatesForTab(quickTab.id);

    console.log('[UICoordinator] Tab rendered:', quickTab.id);
    return tabWindow;
  }

  /**
   * Apply pending updates for a newly rendered Quick Tab
   * v1.6.2.4 - BUG FIX Issues 2 & 6: Called after render to apply queued updates
   * 
   * @private
   * @param {string} quickTabId - Quick Tab ID
   */
  _applyPendingUpdatesForTab(quickTabId) {
    // Early return if no updateHandler
    if (!this.updateHandler) {
      return;
    }

    // Apply pending updates if they exist
    // hasPendingUpdates() is a standard method on UpdateHandler
    if (this.updateHandler.hasPendingUpdates(quickTabId)) {
      console.log('[UICoordinator] Applying pending updates for newly rendered tab:', quickTabId);
      this.updateHandler.applyPendingUpdates(quickTabId);
    }
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
   * v1.6.1 - CRITICAL FIX: Added state:refreshed listener to re-render when tab becomes visible
   * v1.6.2.1 - ISSUE #35 FIX: Added context-aware logging for debugging cross-tab sync
   * v1.6.2.x - ISSUE #51 FIX: Added state:quicktab:changed listener for position/size/zIndex sync
   */
  setupStateListeners() {
    const context = typeof window !== 'undefined' ? 'content-script' : 'background';
    const tabUrl = typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A';
    
    console.log('[UICoordinator] Setting up state listeners', { context, tabUrl });

    // Listen to state changes and trigger UI updates
    this.eventBus.on('state:added', ({ quickTab }) => {
      console.log('[UICoordinator] Received state:added event', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A',
        quickTabId: quickTab.id,
        timestamp: Date.now()
      });
      this.render(quickTab);
    });

    this.eventBus.on('state:updated', ({ quickTab }) => {
      console.log('[UICoordinator] Received state:updated event', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        quickTabId: quickTab.id
      });
      this.update(quickTab);
    });

    this.eventBus.on('state:deleted', ({ id }) => {
      console.log('[UICoordinator] Received state:deleted event', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        quickTabId: id
      });
      this.destroy(id);
    });

    // v1.6.1 - CRITICAL FIX: Listen to state:refreshed (fired when tab becomes visible)
    // This ensures UI is updated with latest positions/sizes when switching tabs
    this.eventBus.on('state:refreshed', () => {
      console.log('[UICoordinator] State refreshed - re-rendering all visible tabs', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A'
      });
      this._refreshAllRenderedTabs();
    });

    // v1.6.2.x - ISSUE #51 FIX: Listen for position/size/zIndex changes from storage sync
    // This event is emitted when another tab changes a Quick Tab's position, size, or zIndex
    // and we need to update our already-rendered UI to reflect those changes
    this.eventBus.on('state:quicktab:changed', ({ quickTab, changes }) => {
      console.log('[UICoordinator] Received state:quicktab:changed event (external update)', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        quickTabId: quickTab.id,
        changes,
        timestamp: Date.now()
      });
      
      // Only update if already rendered in this tab
      if (this.renderedTabs.has(quickTab.id)) {
        this.update(quickTab);
      } else {
        console.log('[UICoordinator] Tab not rendered, skipping external update:', quickTab.id);
      }
    });
    
    console.log('[UICoordinator] ✓ State listeners setup complete', { context });
  }

  /**
   * Refresh all rendered tabs with latest state
   * v1.6.1 - CRITICAL FIX: Update UI for all rendered tabs when state is refreshed
   * This is called when tab becomes visible to sync positions/sizes/visibility
   * @private
   */
  _refreshAllRenderedTabs() {
    // Get current visible Quick Tabs from state
    const visibleTabs = this.stateManager.getVisible();
    const visibleIds = new Set(visibleTabs.map(qt => qt.id));

    // Destroy tabs that should no longer be visible
    for (const [id, _tabWindow] of this.renderedTabs) {
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
