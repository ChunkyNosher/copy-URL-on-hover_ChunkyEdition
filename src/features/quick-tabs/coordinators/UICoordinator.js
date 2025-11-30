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
 * v1.6.4.9 - FIX Issues #1-6: Complete restore bug fix
 *   - Issue #1: Use hasSnapshot() instead of isMinimized() for snapshot lookup
 *   - Issue #2: Call clearSnapshot() after successful render to confirm snapshot deletion
 *   - Issue #3: When DOM detached and instance NOT minimized, ALWAYS render
 *   - Issue #5: Add periodic DOM verification after render
 *   - Issue #6A-D: Enhanced logging throughout
 */

import browser from 'webextension-polyfill';

import { CONSTANTS } from '../../../core/config.js';
import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '../../../utils/dom.js';
import { createQuickTabWindow } from '../window.js';

/** @constant {number} Delay in ms for DOM verification after render (v1.6.4.7) */
const DOM_VERIFICATION_DELAY_MS = 150;

/** @constant {number} Delay in ms for periodic DOM monitoring (v1.6.4.9 - Issue #5) */
const DOM_MONITORING_INTERVAL_MS = 500;

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
    // v1.6.3.2 - Cache for quickTabShowDebugId setting
    this.showDebugIdSetting = false;
    // v1.6.4.9 - FIX Issue #5: Track DOM monitoring timers for cleanup
    this._domMonitoringTimers = new Map(); // id -> timerId
  }

  /**
   * Initialize coordinator - setup listeners and render initial state
   */
  async init() {
    console.log('[UICoordinator] Initializing...');

    // v1.6.3.2 - Load showDebugId setting before rendering
    await this._loadDebugIdSetting();

    // Setup state listeners
    this.setupStateListeners();

    // Render initial state
    this.renderAll();

    console.log('[UICoordinator] Initialized');
  }

  /**
   * Load the quickTabShowDebugId setting from storage
   * v1.6.3.2 - Feature: Debug UID Display Toggle
   * v1.6.4.8 - FIX Issue #2: Add fallback to local storage, improved logging
   * @private
   */
  async _loadDebugIdSetting() {
    const settingsKey = CONSTANTS.QUICK_TAB_SETTINGS_KEY;
    
    // Try sync storage first
    try {
      const result = await browser.storage.sync.get(settingsKey);
      console.log('[UICoordinator] Sync storage result:', { settingsKey, result });
      
      if (result && result[settingsKey]) {
        const settings = result[settingsKey];
        this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
        console.log('[UICoordinator] Loaded showDebugId from sync storage:', this.showDebugIdSetting);
        return;
      }
    } catch (syncErr) {
      console.warn('[UICoordinator] Sync storage failed, trying local:', syncErr.message);
    }
    
    // Fallback to local storage
    try {
      const localResult = await browser.storage.local.get(settingsKey);
      console.log('[UICoordinator] Local storage result:', { settingsKey, localResult });
      
      if (localResult && localResult[settingsKey]) {
        const settings = localResult[settingsKey];
        this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
        console.log('[UICoordinator] Loaded showDebugId from local storage:', this.showDebugIdSetting);
        return;
      }
    } catch (localErr) {
      console.warn('[UICoordinator] Local storage also failed:', localErr.message);
    }
    
    // Default to false if both sync and local storage fail
    this.showDebugIdSetting = false;
    console.log('[UICoordinator] Both sync and local storage failed, using default showDebugId:', this.showDebugIdSetting);
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
   * v1.6.4.8 - FIX Issue #5: Add DOM verification after render to catch detachment early
   * v1.6.4.9 - FIX Issues #1, #5, #6C: Clear snapshot after render, add monitoring, enhanced logging
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
      // v1.6.4.9 - FIX Issue #5: Clear any monitoring timer for this tab
      this._stopDOMMonitoring(quickTab.id);
    }

    console.log('[UICoordinator] Rendering tab:', quickTab.id);

    // Create QuickTabWindow from QuickTab entity
    const tabWindow = this._createWindow(quickTab);

    // Store in map
    this.renderedTabs.set(quickTab.id, tabWindow);
    
    // v1.6.4.9 - FIX Issue #6C: Log Map entry creation with isRendered() status
    const isRenderedNow = tabWindow.isRendered();
    console.log('[UICoordinator] Added to renderedTabs Map:', {
      id: quickTab.id,
      isRendered: isRenderedNow,
      mapSize: this.renderedTabs.size
    });

    // v1.6.4.8 - FIX Issue #5: Verify DOM is attached after render
    this._verifyDOMAfterRender(tabWindow, quickTab.id);
    
    // v1.6.4.9 - FIX Issue #1: Clear snapshot from MinimizedManager after successful render
    // This is the "confirmation" that render succeeded, allowing snapshot deletion
    if (isRenderedNow && this._hasMinimizedManager()) {
      const cleared = this.minimizedManager.clearSnapshot(quickTab.id);
      if (cleared) {
        console.log('[UICoordinator] Cleared snapshot after successful render:', quickTab.id);
      }
    }
    
    // v1.6.4.9 - FIX Issue #5: Start periodic DOM monitoring
    this._startDOMMonitoring(quickTab.id, tabWindow);

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
   * Try to apply snapshot from minimizedManager
   * v1.6.4.8 - Helper to reduce _applySnapshotForRestore complexity
   * v1.6.4.9 - FIX Issues #1, #6B: Use hasSnapshot() instead of isMinimized(), add source logging
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply snapshot to
   * @returns {boolean} True if snapshot was applied
   */
  _tryApplySnapshotFromManager(quickTab) {
    if (!this._hasMinimizedManager()) {
      console.log('[UICoordinator] No minimizedManager available for snapshot check:', quickTab.id);
      return false;
    }
    
    // v1.6.4.9 - FIX Issue #1: Use hasSnapshot() to check both active and pending-clear snapshots
    // isMinimized() only checks active minimizedTabs, missing pending-clear snapshots
    const hasAnySnapshot = this.minimizedManager.hasSnapshot(quickTab.id);
    const isActivelyMinimized = this.minimizedManager.isMinimized(quickTab.id);
    
    // v1.6.4.9 - FIX Issue #6B: Log WHERE snapshot check happens and WHAT it finds
    console.log('[UICoordinator] Checking MinimizedManager for snapshot:', {
      id: quickTab.id,
      hasSnapshot: hasAnySnapshot,
      isMinimized: isActivelyMinimized
    });
    
    if (!hasAnySnapshot) {
      return false;
    }
    
    const snapshot = this.minimizedManager.getSnapshot(quickTab.id);
    if (!snapshot) {
      console.log('[UICoordinator] hasSnapshot returned true but getSnapshot returned null:', quickTab.id);
      return false;
    }
    
    console.log('[UICoordinator] Restoring from snapshot (from minimizedManager):', {
      id: quickTab.id,
      position: snapshot.position,
      size: snapshot.size
    });
    quickTab.position = snapshot.position;
    quickTab.size = snapshot.size;
    
    // v1.6.4.9 - Only call restore() if still in active minimizedTabs
    // This applies the snapshot to the instance (for tabWindow dimensions)
    if (isActivelyMinimized) {
      this.minimizedManager.restore(quickTab.id);
    }
    return true;
  }

  /**
   * Try to apply dimensions from existing tabWindow instance
   * v1.6.4.8 - Helper to reduce _applySnapshotForRestore complexity
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply dimensions to
   * @returns {boolean} True if dimensions were applied
   */
  _tryApplyDimensionsFromInstance(quickTab) {
    const tabWindow = this.renderedTabs.get(quickTab.id);
    if (!tabWindow || tabWindow.minimized) {
      return false;
    }
    
    const hasValidWidth = typeof tabWindow.width === 'number' && tabWindow.width > 0;
    const hasValidHeight = typeof tabWindow.height === 'number' && tabWindow.height > 0;
    const hasValidLeft = typeof tabWindow.left === 'number';
    const hasValidTop = typeof tabWindow.top === 'number';
    if (!hasValidWidth || !hasValidHeight || !hasValidLeft || !hasValidTop) {
      return false;
    }
    
    console.log('[UICoordinator] Restoring from tabWindow instance dimensions:', {
      id: quickTab.id,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height
    });
    quickTab.position = { left: tabWindow.left, top: tabWindow.top };
    quickTab.size = { width: tabWindow.width, height: tabWindow.height };
    return true;
  }

  /**
   * Apply snapshot data to quickTab entity for restore
   * v1.6.4.5 - FIX Issue #3: Use snapshot position/size when restoring
   * v1.6.4.8 - FIX Entity-Instance Sync Gap: Read from tabWindow instance if minimizedManager
   *   has already removed the snapshot (happens when VisibilityHandler calls restore first)
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply snapshot to
   */
  _applySnapshotForRestore(quickTab) {
    // First try to get snapshot from minimizedManager
    if (this._tryApplySnapshotFromManager(quickTab)) {
      return;
    }
    // v1.6.4.8 - FIX Entity-Instance Sync Gap: If minimizedManager doesn't have it,
    // try to read from the existing tabWindow instance (which may have had snapshot applied)
    if (this._tryApplyDimensionsFromInstance(quickTab)) {
      return;
    }
    console.log('[UICoordinator] No snapshot available for:', quickTab.id);
  }

  /**
   * Handle restore of existing minimized window
   * v1.6.4.5 - Helper to reduce complexity
   * v1.6.3.2 - FIX Issue #1 CRITICAL: UICoordinator is single rendering authority
   *   MinimizedManager.restore() now only applies snapshot and returns result.
   *   We need to call tabWindow.restore() here, then render if needed.
   * v1.6.4.7 - FIX Issues #1, #5, #6: Enhanced logging, DOM verification after render
   * v1.6.4.9 - FIX Issue #1: Clear snapshot after successful render, start monitoring
   * @private
   * @param {QuickTabWindow} tabWindow - The window to restore
   * @param {string} quickTabId - Quick Tab ID
   * @returns {QuickTabWindow} The restored window
   */
  _restoreExistingWindow(tabWindow, quickTabId) {
    console.log('[UICoordinator] Tab is being restored from minimized state:', quickTabId);
    
    // v1.6.4.7 - FIX Issue #6: Log dimensions BEFORE restore for debugging
    console.log('[UICoordinator] Pre-restore dimensions:', {
      id: quickTabId,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height
    });

    // v1.6.4.9 - FIX Issue #1: Use hasSnapshot() to check both active and pending-clear snapshots
    if (this._hasMinimizedManager() && this.minimizedManager.hasSnapshot(quickTabId)) {
      // MinimizedManager.restore() applies snapshot to instance but does NOT render
      const restoreResult = this.minimizedManager.restore(quickTabId);
      if (restoreResult) {
        console.log('[UICoordinator] Applied snapshot from minimizedManager:', restoreResult.position, restoreResult.size);
        // v1.6.3.2 - Now call restore() on the window (which updates minimized flag but does NOT render)
        tabWindow.restore();
      }
    } else {
      // No snapshot available, just call restore() on the window
      tabWindow.restore();
      console.log('[UICoordinator] Restored tab directly (no snapshot):', quickTabId);
    }
    
    // v1.6.4.7 - FIX Issue #6: Log dimensions AFTER restore for debugging
    console.log('[UICoordinator] Post-restore dimensions:', {
      id: quickTabId,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height,
      minimized: tabWindow.minimized
    });

    // v1.6.3.2 - FIX Issue #1: UICoordinator is the single rendering authority
    // After restore() updates state, if DOM doesn't exist, we need to render it
    if (!tabWindow.isRendered()) {
      console.log('[UICoordinator] DOM not attached after restore, rendering:', quickTabId);
      tabWindow.render();
      // Update renderedTabs map
      this.renderedTabs.set(quickTabId, tabWindow);
      
      // v1.6.4.7 - FIX Issue #5: Verify DOM is attached after render
      this._verifyDOMAfterRender(tabWindow, quickTabId);
      
      // v1.6.4.9 - FIX Issue #1: Clear snapshot after successful render
      if (tabWindow.isRendered() && this._hasMinimizedManager()) {
        this.minimizedManager.clearSnapshot(quickTabId);
        console.log('[UICoordinator] Cleared snapshot after restore render:', quickTabId);
      }
      
      // v1.6.4.9 - FIX Issue #5: Start periodic DOM monitoring
      this._startDOMMonitoring(quickTabId, tabWindow);
    }

    return tabWindow;
  }
  
  /**
   * Verify DOM is attached after render with delayed check
   * v1.6.4.7 - FIX Issue #5: Proactive DOM detachment detection
   * v1.6.4.9 - FIX Issue #1: Clear snapshot on delayed verification success
   * @private
   * @param {QuickTabWindow} tabWindow - The window to verify
   * @param {string} quickTabId - Quick Tab ID
   */
  _verifyDOMAfterRender(tabWindow, quickTabId) {
    // Immediate verification
    if (!tabWindow.isRendered()) {
      console.error('[UICoordinator] Immediate DOM verification FAILED for:', quickTabId);
      return;
    }
    
    // v1.6.4.7 - FIX Issue #5: Delayed verification
    setTimeout(() => {
      if (!tabWindow.isRendered()) {
        console.error(`[UICoordinator] Delayed DOM verification FAILED (detached within ${DOM_VERIFICATION_DELAY_MS}ms):`, quickTabId);
        // Remove stale reference
        this.renderedTabs.delete(quickTabId);
        // Stop monitoring
        this._stopDOMMonitoring(quickTabId);
      } else {
        console.log('[UICoordinator] DOM verification PASSED for:', quickTabId);
        // v1.6.4.9 - FIX Issue #1: Ensure snapshot is cleared after delayed verification passes
        if (this._hasMinimizedManager()) {
          this.minimizedManager.clearSnapshot(quickTabId);
        }
      }
    }, DOM_VERIFICATION_DELAY_MS);
  }
  
  /**
   * Start periodic DOM monitoring for a rendered tab
   * v1.6.4.9 - FIX Issue #5: Proactive DOM detachment detection between events
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {QuickTabWindow} tabWindow - The window to monitor
   */
  _startDOMMonitoring(quickTabId, tabWindow) {
    // Clear any existing timer
    this._stopDOMMonitoring(quickTabId);
    
    // v1.6.4.9 - FIX Issue #5: Set up periodic check every 500ms
    // This catches detachment that happens between events (the 73-second gap issue)
    let checkCount = 0;
    const maxChecks = 10; // Monitor for 5 seconds max (10 * 500ms)
    
    const timerId = setInterval(() => {
      checkCount++;
      
      if (!tabWindow.isRendered()) {
        console.warn('[UICoordinator] Periodic DOM check detected detachment:', {
          id: quickTabId,
          checkNumber: checkCount,
          elapsedMs: checkCount * DOM_MONITORING_INTERVAL_MS
        });
        // Clean up
        this.renderedTabs.delete(quickTabId);
        this._stopDOMMonitoring(quickTabId);
        return;
      }
      
      // Stop monitoring after maxChecks (5 seconds) - if still attached, it's stable
      if (checkCount >= maxChecks) {
        console.log('[UICoordinator] DOM monitoring completed (stable):', quickTabId);
        this._stopDOMMonitoring(quickTabId);
      }
    }, DOM_MONITORING_INTERVAL_MS);
    
    this._domMonitoringTimers.set(quickTabId, timerId);
  }
  
  /**
   * Stop periodic DOM monitoring for a tab
   * v1.6.4.9 - FIX Issue #5: Cleanup monitoring timer
   * @private
   * @param {string} quickTabId - Quick Tab ID
   */
  _stopDOMMonitoring(quickTabId) {
    const timerId = this._domMonitoringTimers.get(quickTabId);
    if (timerId) {
      clearInterval(timerId);
      this._domMonitoringTimers.delete(quickTabId);
    }
  }

  /**
   * Update an existing QuickTabWindow
   * v1.6.3.4 - FIX Bug #6: Check for minimized state before rendering
   * v1.6.4.2 - FIX TypeError: Add null safety checks for position/size access
   * v1.6.4.3 - FIX Issue #2: Check BOTH top-level AND nested minimized properties
   * v1.6.4.4 - FIX Bug #2: When restoring, call restore() on existing window instead of render()
   * v1.6.4.5 - FIX Issue #3: Use snapshot position/size when restoring, never create duplicate
   * v1.6.4.6 - FIX Issue #3: Validate DOM attachment with isRendered() before operating
   * v1.6.4.7 - FIX Issues #2, #3, #8: Use tabWindow.minimized (instance state) instead of entity state
   *   When DOM is detached and instance is NOT minimized, ALWAYS render regardless of entity state.
   * v1.6.4.9 - FIX Issues #2, #3, #6D: Enhanced decision logging, always render when DOM missing + instance not minimized
   *
   * @param {QuickTab} quickTab - Updated QuickTab entity
   * @returns {QuickTabWindow|undefined} Updated or newly rendered tab window, or undefined if skipped
   */
  update(quickTab) {
    const tabWindow = this.renderedTabs.get(quickTab.id);
    // v1.6.4.7 - FIX Issue #8: Entity minimized state (may be stale during restore transition)
    const entityMinimized = Boolean(quickTab.minimized || quickTab.visibility?.minimized);

    // Handle non-rendered tab or stale reference (DOM detached)
    if (!tabWindow) {
      // v1.6.4.9 - FIX Issue #6D: Log decision path
      console.log('[UICoordinator] Update decision:', {
        id: quickTab.id,
        inMap: false,
        entityMinimized,
        action: entityMinimized ? 'skip (minimized)' : 'render (not in map)'
      });
      
      if (entityMinimized) {
        console.log('[UICoordinator] Tab is minimized (no window), skipping render:', quickTab.id);
        return;
      }
      // Apply snapshot if available before rendering
      this._applySnapshotForRestore(quickTab);
      console.warn('[UICoordinator] Tab not rendered, rendering now:', quickTab.id);
      return this.render(quickTab);
    }

    // v1.6.4.7 - FIX Issues #2, #3, #8: Check ACTUAL instance minimized state, not entity state
    // During restore transition, entity may still have minimized=true while tabWindow.minimized=false
    const instanceMinimized = tabWindow.minimized;
    const domAttached = tabWindow.isRendered();

    // v1.6.4.9 - FIX Issue #6D: Log decision path with all relevant state
    console.log('[UICoordinator] Update decision:', {
      id: quickTab.id,
      inMap: true,
      domAttached,
      entityMinimized,
      instanceMinimized,
      action: 'evaluating...'
    });

    // v1.6.4.6 - FIX Issue #3: Validate DOM is actually attached
    if (!domAttached) {
      console.log('[UICoordinator] Tab in map but DOM detached, cleaning up:', quickTab.id);
      this.renderedTabs.delete(quickTab.id);
      // v1.6.4.9 - FIX Issue #5: Stop monitoring for this tab
      this._stopDOMMonitoring(quickTab.id);

      // v1.6.4.9 - FIX Issues #2, #3 CRITICAL: Use INSTANCE state, not entity state
      // If instance is NOT minimized, the tab is being restored and MUST be rendered
      // This is the key fix - we removed the early return based on entity state
      if (instanceMinimized) {
        console.log('[UICoordinator] Instance is minimized, skipping render after cleanup:', {
          id: quickTab.id,
          action: 'skip (instance minimized)'
        });
        return;
      }
      
      // v1.6.4.9 - FIX Issues #2, #3: Instance is NOT minimized but DOM is missing - MUST render
      // This fixes subsequent restore attempts that do nothing
      console.log('[UICoordinator] Instance NOT minimized but DOM missing, MUST render:', {
        id: quickTab.id,
        action: 'render (DOM missing + instance not minimized)'
      });
      // Apply snapshot if available before rendering
      this._applySnapshotForRestore(quickTab);
      return this.render(quickTab);
    }

    // Handle restore from minimized state (instance minimized but entity says not minimized)
    if (instanceMinimized && !entityMinimized) {
      console.log('[UICoordinator] Update decision: restore (instance minimized, entity not)', quickTab.id);
      return this._restoreExistingWindow(tabWindow, quickTab.id);
    }

    // Normal update - DOM is attached, not restoring
    console.log('[UICoordinator] Update decision: normal update', quickTab.id);
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
   * v1.6.4.9 - FIX Issue #5: Stop DOM monitoring on destroy
   *
   * @param {string} quickTabId - ID of tab to destroy
   */
  destroy(quickTabId) {
    // v1.6.4.9 - FIX Issue #5: Stop monitoring first
    this._stopDOMMonitoring(quickTabId);
    
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
    
    // v1.6.4.9 - Also clear any pending snapshot
    if (this._hasMinimizedManager()) {
      this.minimizedManager.clearSnapshot(quickTabId);
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
   * v1.6.3.2 - Pass showDebugId setting to window
   * v1.6.4.9 - FIX Issue #6A: Log entity property values before creating window
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
    
    // v1.6.4.9 - FIX Issue #6A: Log entity properties before creating window
    console.log('[UICoordinator] Creating window from entity:', {
      id: quickTab.id,
      rawPosition: quickTab.position,
      rawSize: quickTab.size,
      safePosition: position,
      safeSize: size,
      visibility,
      zIndex
    });

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
      showDebugId: this.showDebugIdSetting // v1.6.3.2 - Pass debug ID display setting
    });
  }
}
