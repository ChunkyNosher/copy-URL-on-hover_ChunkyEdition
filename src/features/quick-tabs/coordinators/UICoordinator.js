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
 * v1.6.4.4 - FIX Bug #3: Use shared DOM cleanup utility
 */

import { CONSTANTS } from '../../../core/config.js';
import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '../../../utils/dom.js';
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
   * v1.6.3.4 - FIX Bug #6: Check for minimized state before rendering
   * v1.6.4.2 - FIX TypeError: Add null safety checks for position/size access
   * v1.6.4.3 - FIX Issue #2: Check BOTH top-level AND nested minimized properties
   * v1.6.4.4 - FIX Bug #2: When restoring, call restore() on existing window instead of render()
   *
   * @param {QuickTab} quickTab - Updated QuickTab entity
   * @returns {QuickTabWindow|undefined} Updated or newly rendered tab window, or undefined if skipped
   */
  update(quickTab) {
    const tabWindow = this.renderedTabs.get(quickTab.id);

    // v1.6.4.3 - FIX Issue #2: Check BOTH top-level `minimized` AND nested `visibility.minimized`
    // Top-level property is the current format; visibility.minimized is legacy format
    // Using OR logic ensures we handle both formats correctly
    const isMinimized = Boolean(quickTab.minimized || quickTab.visibility?.minimized);
    
    if (!tabWindow) {
      // v1.6.3.4 - FIX Bug #6: Don't render minimized tabs
      if (isMinimized) {
        console.log('[UICoordinator] Tab is minimized, skipping render:', quickTab.id);
        return;
      }
      console.warn('[UICoordinator] Tab not rendered, rendering now:', quickTab.id);
      return this.render(quickTab);
    }

    // v1.6.4.4 - FIX Bug #2: If tab was minimized and is now being restored,
    // check if minimizedManager has it and restore properly instead of just updating
    if (tabWindow.minimized && !isMinimized) {
      console.log('[UICoordinator] Tab is being restored from minimized state:', quickTab.id);
      // The window already exists but is hidden - just call restore on it
      if (this.minimizedManager && this.minimizedManager.isMinimized(quickTab.id)) {
        this.minimizedManager.restore(quickTab.id);
        console.log('[UICoordinator] Restored tab via minimizedManager:', quickTab.id);
        return tabWindow;
      } else {
        // Fallback: restore the window directly if not in minimizedManager
        tabWindow.restore();
        console.log('[UICoordinator] Restored tab directly:', quickTab.id);
        return tabWindow;
      }
    }

    console.log('[UICoordinator] Updating tab:', quickTab.id);

    // v1.6.4.2 - FIX TypeError: Use helper functions for safe access
    const position = this._getSafePosition(quickTab);
    const size = this._getSafeSize(quickTab);
    const zIndex = this._getSafeZIndex(quickTab);

    // Update tab properties with safe values
    tabWindow.updatePosition(position.left, position.top);
    tabWindow.updateSize(size.width, size.height);
    tabWindow.updateZIndex(zIndex);

    console.log('[UICoordinator] Tab updated:', quickTab.id);
    return tabWindow;
  }

  /**
   * Destroy a QuickTabWindow
   * v1.6.4.4 - FIX Bug #3: Verify DOM cleanup after destroy
   *
   * @param {string} quickTabId - ID of tab to destroy
   */
  destroy(quickTabId) {
    const tabWindow = this.renderedTabs.get(quickTabId);

    if (!tabWindow) {
      console.warn('[UICoordinator] Tab not found for destruction:', quickTabId);
      // v1.6.4.4 - FIX Bug #3: Still try to clean up orphaned DOM elements using shared utility
      if (removeQuickTabElement(quickTabId)) {
        console.log('[UICoordinator] Removed orphaned DOM element for:', quickTabId);
      }
      return;
    }

    console.log('[UICoordinator] Destroying tab:', quickTabId);

    // Call tab's destroy method if it exists
    if (tabWindow.destroy) {
      tabWindow.destroy();
    }

    // Remove from map
    this.renderedTabs.delete(quickTabId);

    // v1.6.4.4 - FIX Bug #3: Verify DOM cleanup - use shared utility
    if (removeQuickTabElement(quickTabId)) {
      console.log('[UICoordinator] Removed orphaned DOM element for:', quickTabId);
    }

    console.log('[UICoordinator] Tab destroyed:', quickTabId);
  }

  /**
   * Setup state event listeners
   * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
   * v1.6.4.3 - FIX Issue #3: Add state:cleared listener for reconciliation
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

    // v1.6.4.3 - FIX Issue #3: Listen for state:cleared to remove orphaned windows
    this.eventBus.on('state:cleared', () => {
      console.log('[UICoordinator] Received state:cleared event');
      this.reconcileRenderedTabs();
    });

    console.log('[UICoordinator] ✓ State listeners setup complete');
  }

  /**
   * Reconcile rendered tabs with StateManager
   * v1.6.4.3 - FIX Issue #3: Destroy orphaned tabs that exist in renderedTabs but not in StateManager
   * v1.6.4.4 - FIX Bug #3: Also scan DOM for orphaned .quick-tab-window elements
   * This handles the case where "Close All" removes tabs from storage but duplicates remain visible
   */
  reconcileRenderedTabs() {
    console.log('[UICoordinator] Reconciling rendered tabs with StateManager');

    // Get all tab IDs from StateManager
    const stateTabIds = new Set(this.stateManager.getAll().map(qt => qt.id));

    // Find and destroy orphaned tabs (in renderedTabs but not in StateManager)
    const orphanedIds = [];
    for (const [id] of this.renderedTabs) {
      if (!stateTabIds.has(id)) {
        orphanedIds.push(id);
      }
    }

    // Destroy orphaned tabs
    for (const id of orphanedIds) {
      console.log('[UICoordinator] Destroying orphaned tab:', id);
      this.destroy(id);
    }

    // v1.6.4.4 - FIX Bug #3: Use shared utility for comprehensive DOM cleanup
    // Also remove from renderedTabs any IDs that were cleaned up
    const cleanedCount = cleanupOrphanedQuickTabElements(stateTabIds);
    
    // Clean up renderedTabs for any elements that were removed
    for (const [id] of this.renderedTabs) {
      if (!stateTabIds.has(id)) {
        this.renderedTabs.delete(id);
      }
    }

    if (orphanedIds.length > 0 || cleanedCount > 0) {
      console.log(`[UICoordinator] Reconciled: destroyed ${orphanedIds.length} tracked + ${cleanedCount} orphaned DOM element(s)`);
    } else {
      console.log('[UICoordinator] Reconciled: no orphaned tabs found');
    }
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
   * Extract safe position values from QuickTab
   * v1.6.4.2 - Helper to reduce complexity
   * @private
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {{left: number, top: number}} Safe position values
   */
  _getSafePosition(quickTab) {
    const pos = quickTab.position || {};
    return {
      left: pos.left ?? 100,
      top: pos.top ?? 100
    };
  }

  /**
   * Extract safe size values from QuickTab
   * v1.6.4.2 - Helper to reduce complexity
   * @private
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {{width: number, height: number}} Safe size values
   */
  _getSafeSize(quickTab) {
    const size = quickTab.size || {};
    return {
      width: size.width ?? 400,
      height: size.height ?? 300
    };
  }

  /**
   * Extract safe zIndex value from QuickTab
   * v1.6.4.4 - Helper for consistent zIndex handling
   * @private
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {number} Safe zIndex value
   */
  _getSafeZIndex(quickTab) {
    return quickTab.zIndex ?? CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
  }

  /**
   * Extract safe visibility values from QuickTab
   * v1.6.4.2 - Helper to reduce complexity
   * @private
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {Object} Safe visibility values
   */
  _getSafeVisibility(quickTab) {
    const vis = quickTab.visibility || {};
    return {
      minimized: vis.minimized ?? false,
      soloedOnTabs: vis.soloedOnTabs ?? [],
      mutedOnTabs: vis.mutedOnTabs ?? []
    };
  }

  /**
   * Create QuickTabWindow from QuickTab entity
   * v1.6.4.2 - FIX TypeError: Add null safety checks for position/size access
   * @private
   *
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow} Created window
   */
  _createWindow(quickTab) {
    const position = this._getSafePosition(quickTab);
    const size = this._getSafeSize(quickTab);
    const visibility = this._getSafeVisibility(quickTab);
    const zIndex = this._getSafeZIndex(quickTab);

    // Create QuickTabWindow using imported factory function from window.js
    return createQuickTabWindow({
      id: quickTab.id,
      url: quickTab.url,
      left: position.left,
      top: position.top,
      width: size.width,
      height: size.height,
      title: quickTab.title,
      cookieStoreId: quickTab.container,
      minimized: visibility.minimized,
      zIndex: zIndex,
      soloedOnTabs: visibility.soloedOnTabs,
      mutedOnTabs: visibility.mutedOnTabs
    });
  }
}
