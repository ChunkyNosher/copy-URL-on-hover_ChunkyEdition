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

import browser from 'webextension-polyfill';

import { CONSTANTS } from '../../../core/config.js';
import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '../../../utils/dom.js';
import { createQuickTabWindow } from '../window.js';

/** @constant {string} Settings storage key */
const SETTINGS_KEY = 'quick_tab_settings';

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
    // v1.6.4.7 - Cache for quickTabShowDebugId setting
    this.showDebugIdSetting = false;
  }

  /**
   * Initialize coordinator - setup listeners and render initial state
   */
  async init() {
    console.log('[UICoordinator] Initializing...');

    // v1.6.4.7 - Load showDebugId setting before rendering
    await this._loadDebugIdSetting();

    // Setup state listeners
    this.setupStateListeners();

    // Render initial state
    this.renderAll();

    console.log('[UICoordinator] Initialized');
  }

  /**
   * Load the quickTabShowDebugId setting from storage
   * v1.6.4.7 - Feature: Debug UID Display Toggle
   * @private
   */
  async _loadDebugIdSetting() {
    try {
      const result = await browser.storage.sync.get(SETTINGS_KEY);
      const settings = result[SETTINGS_KEY] || {};
      this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
      console.log('[UICoordinator] Loaded showDebugId setting:', this.showDebugIdSetting);
    } catch (err) {
      console.warn('[UICoordinator] Failed to load showDebugId setting:', err);
      this.showDebugIdSetting = false;
    }
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
   * v1.6.4.6 - FIX Issue #3: Validate DOM attachment before returning cached window
   *
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow} Rendered tab window
   */
  render(quickTab) {
    // Check if already in map
    if (this.renderedTabs.has(quickTab.id)) {
      const existingWindow = this.renderedTabs.get(quickTab.id);

      // v1.6.4.6 - FIX Issue #3: Validate DOM is actually attached
      if (existingWindow.isRendered()) {
        console.log('[UICoordinator] Tab already rendered and DOM attached:', quickTab.id);
        return existingWindow;
      }

      // DOM is detached (e.g., after minimize), remove stale reference and re-render
      console.log(
        '[UICoordinator] Tab in map but DOM detached, removing stale reference:',
        quickTab.id
      );
      this.renderedTabs.delete(quickTab.id);
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
   * Check if minimizedManager is available and has required methods
   * v1.6.4.5 - Helper to reduce complexity
   * @private
   * @returns {boolean} True if minimizedManager is usable
   */
  _hasMinimizedManager() {
    return this.minimizedManager && typeof this.minimizedManager.isMinimized === 'function';
  }

  /**
   * Apply snapshot data from minimizedManager to quickTab for restore
   * v1.6.4.5 - FIX Issue #3: Use snapshot position/size when restoring
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply snapshot to
   */
  _applySnapshotForRestore(quickTab) {
    if (!this._hasMinimizedManager() || !this.minimizedManager.isMinimized(quickTab.id)) {
      return;
    }

    const snapshot = this.minimizedManager.getSnapshot(quickTab.id);
    if (snapshot) {
      console.log('[UICoordinator] Restoring from snapshot, applying saved position:', snapshot);
      quickTab.position = snapshot.position;
      quickTab.size = snapshot.size;
    }
    // Restore and remove from minimizedManager
    this.minimizedManager.restore(quickTab.id);
  }

  /**
   * Handle restore of existing minimized window
   * v1.6.4.5 - Helper to reduce complexity
   * v1.6.4.7 - FIX Issue #1 CRITICAL: UICoordinator is single rendering authority
   *   MinimizedManager.restore() now only applies snapshot and returns result.
   *   We need to call tabWindow.restore() here, then render if needed.
   * @private
   * @param {QuickTabWindow} tabWindow - The window to restore
   * @param {string} quickTabId - Quick Tab ID
   * @returns {QuickTabWindow} The restored window
   */
  _restoreExistingWindow(tabWindow, quickTabId) {
    console.log('[UICoordinator] Tab is being restored from minimized state:', quickTabId);

    if (this._hasMinimizedManager() && this.minimizedManager.isMinimized(quickTabId)) {
      // MinimizedManager.restore() applies snapshot to instance but does NOT render
      const restoreResult = this.minimizedManager.restore(quickTabId);
      if (restoreResult) {
        console.log('[UICoordinator] Applied snapshot from minimizedManager:', restoreResult.position);
        // v1.6.4.7 - Now call restore() on the window (which updates minimized flag but does NOT render)
        tabWindow.restore();
      }
    } else {
      // No snapshot available, just call restore() on the window
      tabWindow.restore();
      console.log('[UICoordinator] Restored tab directly (no snapshot):', quickTabId);
    }

    // v1.6.4.7 - FIX Issue #1: UICoordinator is the single rendering authority
    // After restore() updates state, if DOM doesn't exist, we need to render it
    if (!tabWindow.isRendered()) {
      console.log('[UICoordinator] DOM not attached after restore, rendering:', quickTabId);
      tabWindow.render();
      // Update renderedTabs map
      this.renderedTabs.set(quickTabId, tabWindow);
    }

    return tabWindow;
  }

  /**
   * Update an existing QuickTabWindow
   * v1.6.3.4 - FIX Bug #6: Check for minimized state before rendering
   * v1.6.4.2 - FIX TypeError: Add null safety checks for position/size access
   * v1.6.4.3 - FIX Issue #2: Check BOTH top-level AND nested minimized properties
   * v1.6.4.4 - FIX Bug #2: When restoring, call restore() on existing window instead of render()
   * v1.6.4.5 - FIX Issue #3: Use snapshot position/size when restoring, never create duplicate
   * v1.6.4.6 - FIX Issue #3: Validate DOM attachment with isRendered() before operating
   *
   * @param {QuickTab} quickTab - Updated QuickTab entity
   * @returns {QuickTabWindow|undefined} Updated or newly rendered tab window, or undefined if skipped
   */
  update(quickTab) {
    const tabWindow = this.renderedTabs.get(quickTab.id);
    const isMinimized = Boolean(quickTab.minimized || quickTab.visibility?.minimized);

    // Handle non-rendered tab or stale reference (DOM detached)
    if (!tabWindow) {
      if (isMinimized) {
        console.log('[UICoordinator] Tab is minimized, skipping render:', quickTab.id);
        return;
      }
      // Apply snapshot if available before rendering
      this._applySnapshotForRestore(quickTab);
      console.warn('[UICoordinator] Tab not rendered, rendering now:', quickTab.id);
      return this.render(quickTab);
    }

    // v1.6.4.6 - FIX Issue #3: Validate DOM is actually attached
    if (!tabWindow.isRendered()) {
      console.log('[UICoordinator] Tab in map but DOM detached, cleaning up:', quickTab.id);
      this.renderedTabs.delete(quickTab.id);

      if (isMinimized) {
        console.log(
          '[UICoordinator] Tab is minimized, skipping render after cleanup:',
          quickTab.id
        );
        return;
      }
      // Apply snapshot if available before rendering
      this._applySnapshotForRestore(quickTab);
      console.log('[UICoordinator] Re-rendering tab after DOM cleanup:', quickTab.id);
      return this.render(quickTab);
    }

    // Handle restore from minimized state
    if (tabWindow.minimized && !isMinimized) {
      return this._restoreExistingWindow(tabWindow, quickTab.id);
    }

    // Normal update
    console.log('[UICoordinator] Updating tab:', quickTab.id);

    const position = this._getSafePosition(quickTab);
    const size = this._getSafeSize(quickTab);
    const zIndex = this._getSafeZIndex(quickTab);

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
      console.log(
        `[UICoordinator] Reconciled: destroyed ${orphanedIds.length} tracked + ${cleanedCount} orphaned DOM element(s)`
      );
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
   * v1.6.4.7 - Pass showDebugId setting to window
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
      mutedOnTabs: visibility.mutedOnTabs,
      showDebugId: this.showDebugIdSetting // v1.6.4.7 - Pass debug ID display setting
    });
  }
}
