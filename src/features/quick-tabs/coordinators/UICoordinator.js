/**
 * UICoordinator - Coordinates QuickTabWindow rendering and lifecycle
 *
 * Responsibilities:
 * - Render QuickTabWindow instances from QuickTab entities
 * - Update UI when state changes
 * - Manage QuickTabWindow lifecycle
 * - Listen to state events and trigger UI updates
 * - Register windows from window:created events
 * - Enforce per-tab scoping via originTabId
 *
 * Complexity: cc ≤ 3 per method
 *
 * v1.6.2.2 - ISSUE #35/#51 FIX: Removed container isolation to enable global Quick Tab visibility
 * v1.6.3 - Removed cross-tab sync infrastructure (single-tab Quick Tabs only)
 * v1.6.3.4-v5 - FIX Bug #3: Use shared DOM cleanup utility
 * v1.6.3.4-v10 - FIX Issues #1-6: Complete restore bug fix
 *   - Issue #1: Use hasSnapshot() instead of isMinimized() for snapshot lookup
 *   - Issue #2: Call clearSnapshot() after successful render to confirm snapshot deletion
 *   - Issue #3: When DOM detached and instance NOT minimized, ALWAYS render
 *   - Issue #5: Add periodic DOM verification after render
 *   - Issue #6A-D: Enhanced logging throughout
 * v1.6.3.3 - FIX 14 Critical Bugs:
 *   - Bug #4: Track highest z-index in memory, apply incremented z-index after restore
 *   - Bug #5: Settings loading desync - use same storage source as CreateHandler
 *   - Bug #6: Close button wiring - use internal event bus for state:deleted
 *   - Bug #8: DOM detaches post-restore - attempt re-render on unexpected detachment
 *   - Bug #2 (UID): Update showDebugId setting before restore render
 * v1.6.3.4-v2 - FIX 6 Critical Restore Issues:
 *   - Issue #1/#2: Source-aware Map cleanup for Manager minimizes
 *   - Issue #3: Enhanced snapshot application logging
 *   - Issue #5: isRestoreOperation flag to handle entity-instance desync
 *   - Issue #6: Extract and use source parameter in update() decisions
 * v1.6.3.4-v3 - FIX 6 Critical Quick Tab Restore Bugs:
 *   - Issue #1: Unified restore path - always delete Map entry BEFORE restore, use fresh render()
 *   - Issue #2: Explicit Map cleanup in minimize handler before DOM removal
 *   - Issue #3: Ensure callbacks persist through restore via stored instance references
 *   - Issue #4: Verify onDestroy callback exists before invoking
 *   - Issue #5: Improved snapshot lifecycle - don't move to pending until confirmed
 *   - Issue #6: Comprehensive logging at all decision points
 * v1.6.3.4-v9 - FIX Issues #16, #19:
 *   - Issue #16: Render rejection does NOT write to storage - silent failure
 *   - Issue #19: Copy-on-write pattern for entity state updates
 * v1.6.3.4-v12 - FIX Diagnostic Report Issues #2, #4, #6:
 *   - Issue #2: Defensive Map cleanup - verify DOM before clearing renderedTabs
 *   - Issue #4: Check DOM for existing elements before creating duplicate windows
 *   - Issue #6: Enhanced logging for Map operations and orphaned window detection
 * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Add window:created listener to populate renderedTabs
 * v1.6.3.5-v8 - FIX Diagnostic Issues #1, #6, #10:
 *   - Issue #1: Enforce per-tab scoping via originTabId check
 *   - Issue #6: Coordinated clear path for Close All
 *   - Issue #10: Enhanced logging with tab context
 * v1.6.3.5-v9 - FIX Diagnostic Report Issues #4, #7:
 *   - Issue #4: Verify z-index stacking context after restore
 *   - Issue #7: Use __quickTabWindow property from window.js for orphan recovery
 * v1.6.3.5-v10 - FIX Critical Quick Tab Restore Issues (Callback Wiring + Z-Index):
 *   - Issue #1-2: Position/size updates stop after restore - callbacks now wired via handlers
 *   - Issue #3: Z-index broken after restore - handled by window.js z-index fix
 *   - Added setHandlers() method for deferred handler initialization
 *   - Added _buildCallbackOptions() for callback wiring in _createWindow()
 */

import browser from 'webextension-polyfill';

import { CONSTANTS } from '../../../core/config.js';
import { cleanupOrphanedQuickTabElements, removeQuickTabElement } from '../../../utils/dom.js';
import { MapTransactionManager } from '../map-transaction-manager.js';
import { createQuickTabWindow } from '../window.js';

/** @constant {number} Delay in ms for DOM verification after render (v1.6.3.4-v8) */
const DOM_VERIFICATION_DELAY_MS = 150;

/** @constant {number} Delay in ms for periodic DOM monitoring (v1.6.3.4-v10 - Issue #5) */
const DOM_MONITORING_INTERVAL_MS = 500;

/** @constant {number} Delay in ms before clearing snapshot after render (v1.6.3.4-v5 - Issue #5) */
// 400ms grace period allows for accidental double-clicks without losing snapshot
const SNAPSHOT_CLEAR_DELAY_MS = 400;

// v1.6.3.4-v6 - FIX Issue #4: Track restore operations to prevent duplicates
const RESTORE_IN_PROGRESS = new Set();
const RESTORE_LOCK_MS = 500;

// v1.6.3.5-v4 - FIX Diagnostic Issue #4: Cooldown for render operations to prevent rapid duplicates
const _RENDER_COOLDOWN_MS = 1000;

export class UICoordinator {
  /**
   * @param {StateManager} stateManager - State manager instance
   * @param {MinimizedManager} minimizedManager - Minimized manager instance
   * @param {PanelManager} panelManager - Panel manager instance
   * @param {EventEmitter} eventBus - Internal event bus
   * @param {number} [currentTabId=null] - Current browser tab ID for cross-tab filtering
   * @param {Object} [handlers={}] - Handler references for callback wiring
   * @param {Object} [handlers.updateHandler] - UpdateHandler for position/size callbacks
   * @param {Object} [handlers.visibilityHandler] - VisibilityHandler for focus/minimize callbacks
   * @param {Object} [handlers.destroyHandler] - DestroyHandler for close callback
   */
  constructor(stateManager, minimizedManager, panelManager, eventBus, currentTabId = null, handlers = {}) {
    this.stateManager = stateManager;
    this.minimizedManager = minimizedManager;
    this.panelManager = panelManager;
    this.eventBus = eventBus;
    // v1.6.3.5-v8 - FIX Issue #1: Store current tab ID for cross-tab filtering
    this.currentTabId = currentTabId;
    // v1.6.3.5-v8 - FIX Issue #10: Create log prefix with Tab ID for enhanced logging
    this._logPrefix = `[UICoordinator][Tab ${currentTabId ?? 'unknown'}]`;
    this.renderedTabs = new Map(); // id -> QuickTabWindow
    // v1.6.3.2 - Cache for quickTabShowDebugId setting
    this.showDebugIdSetting = false;
    // v1.6.3.4-v10 - FIX Issue #5: Track DOM monitoring timers for cleanup
    this._domMonitoringTimers = new Map(); // id -> timerId
    // v1.6.3.3 - FIX Bug #4: Track highest z-index in memory for proper stacking
    this._highestZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
    // v1.6.3.4-v5 - FIX Issue #5: Track pending snapshot clear timers
    this._pendingSnapshotClears = new Map();
    // v1.6.3.4-v6 - FIX Issue #3: Track render timestamps to prevent duplicate processing
    this._renderTimestamps = new Map(); // id -> timestamp
    // v1.6.3.5 - FIX Issue #1: MapTransactionManager for atomic operations
    this._mapTxnManager = new MapTransactionManager(this.renderedTabs, 'renderedTabs');
    // v1.6.3.5-v4 - FIX Issue #4: Track last render time per tab to prevent rapid duplicates
    this._lastRenderTime = new Map(); // id -> timestamp
    
    // v1.6.3.5-v10 - FIX Issue #1-2: Store handler references for callback wiring during _createWindow()
    // These handlers are needed to build proper callbacks when restoring Quick Tabs
    this.updateHandler = handlers.updateHandler || null;
    this.visibilityHandler = handlers.visibilityHandler || null;
    this.destroyHandler = handlers.destroyHandler || null;
  }
  
  /**
   * Set handler references after construction (for deferred initialization)
   * v1.6.3.5-v10 - FIX Issue #1-2: Allow setting handlers after UICoordinator is created
   * @param {Object} handlers - Handler references
   */
  setHandlers(handlers) {
    if (handlers.updateHandler) {
      this.updateHandler = handlers.updateHandler;
    }
    if (handlers.visibilityHandler) {
      this.visibilityHandler = handlers.visibilityHandler;
    }
    if (handlers.destroyHandler) {
      this.destroyHandler = handlers.destroyHandler;
    }
    console.log(`${this._logPrefix} Handlers set:`, {
      hasUpdateHandler: !!this.updateHandler,
      hasVisibilityHandler: !!this.visibilityHandler,
      hasDestroyHandler: !!this.destroyHandler
    });
  }
  
  /**
   * Verify invariant: tab cannot be in both renderedTabs AND minimizedManager simultaneously
   * v1.6.3.5-v4 - FIX Diagnostic Issue #4: Strengthen invariants
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} operation - Operation being performed (for logging)
   * @returns {{ valid: boolean, inRenderedTabs: boolean, inMinimizedManager: boolean }}
   */
  _verifyInvariant(id, operation) {
    const inRenderedTabs = this.renderedTabs.has(id);
    const inMinimizedManager = this._hasMinimizedManager() && this.minimizedManager.isMinimized(id);
    
    // Tab should NOT be in both simultaneously (except during transitions)
    // During restore: briefly in both as we're moving from minimized to rendered
    const violatesInvariant = inRenderedTabs && inMinimizedManager;
    
    if (violatesInvariant) {
      const tabWindow = this.renderedTabs.get(id);
      const isRenderedDOM = tabWindow?.isRendered?.() ?? false;
      
      console.error('[UICoordinator] ⛔ INVARIANT VIOLATION: Tab in both renderedTabs AND minimizedManager:', {
        id,
        operation,
        inRenderedTabs,
        inMinimizedManager,
        isRenderedDOM,
        renderedTabsSize: this.renderedTabs.size,
        minimizedCount: this.minimizedManager?.getCount?.() ?? 0
      });
      
      // Auto-fix: if DOM is not rendered, remove from renderedTabs
      if (!isRenderedDOM) {
        console.warn('[UICoordinator] Auto-fixing invariant violation: removing from renderedTabs (no DOM)');
        this.renderedTabs.delete(id);
        return { valid: true, inRenderedTabs: false, inMinimizedManager };
      }
    } else {
      console.log('[UICoordinator] Invariant check passed:', {
        id,
        operation,
        inRenderedTabs,
        inMinimizedManager
      });
    }
    
    return { valid: !violatesInvariant, inRenderedTabs, inMinimizedManager };
  }
  
  /**
   * Get detailed logging info for Map operations (Issue #2 fix)
   * v1.6.3.5 - FIX Issue #2: Capture Map state for comprehensive logging
   * @private
   * @param {string} operation - The operation being performed
   * @param {string} targetId - The ID being operated on
   * @returns {Object} Log info object
   */
  _getMapLogInfo(operation, targetId) {
    const stackLines = new Error().stack?.split('\n') || [];
    return {
      mapKeys: Array.from(this.renderedTabs.keys()),
      operation,
      targetId,
      timestamp: Date.now(),
      stackDepth: stackLines.length
    };
  }
  
  /**
   * Safely delete from renderedTabs Map with logging and validation
   * v1.6.3.4-v8 - FIX Issue #5: Prevent double deletion and Map corruption
   * v1.6.3.5 - FIX Issue #2: Enhanced logging with Map contents (not just size)
   * @private
   * @param {string} id - Quick Tab ID to delete
   * @param {string} reason - Reason for deletion (for logging)
   * @returns {boolean} True if deleted, false if entry didn't exist
   */
  _safeDeleteFromRenderedTabs(id, reason) {
    // v1.6.3.5 - FIX Issue #2: Log Map contents before operation
    const logInfo = this._getMapLogInfo('delete', id);
    
    if (!this.renderedTabs.has(id)) {
      console.warn('[UICoordinator] WARNING: Attempted to delete non-existent Map entry:', {
        ...logInfo,
        reason
      });
      return false;
    }
    
    const mapSizeBefore = this.renderedTabs.size;
    this.renderedTabs.delete(id);
    
    // v1.6.3.5 - FIX Issue #2: Log Map contents after operation
    console.log('[UICoordinator] renderedTabs.delete():', {
      ...logInfo,
      reason,
      mapSizeBefore,
      mapSizeAfter: this.renderedTabs.size,
      mapKeysAfter: Array.from(this.renderedTabs.keys())
    });
    
    // v1.6.3.4-v8 - FIX Issue #5: Sanity check - size should never unexpectedly go to zero
    if (mapSizeBefore > 1 && this.renderedTabs.size === 0) {
      console.error('[UICoordinator] CRITICAL: Map unexpectedly empty after single delete!', {
        id,
        reason,
        mapSizeBefore,
        mapKeysBefore: logInfo.mapKeys
      });
    }
    
    return true;
  }
  
  /**
   * Safely clear all entries from renderedTabs Map with logging
   * v1.6.3.4-v11 - FIX Issue #4: Ensure ALL Map.clear() operations are logged
   * v1.6.3.4-v12 - FIX Issue #2: Verify DOM elements before clearing
   *   Only clear if user-initiated (Close All) or DOM verification confirms tabs are gone
   *   Note: userInitiated parameter defaults to false for backward compatibility
   * v1.6.3.5 - FIX Issue #2: Enhanced logging with Map contents and timestamps
   * @private
   * @param {string} reason - Reason for clearing (for logging)
   * @param {string} [source='unknown'] - Source of the clear operation (optional)
   * @param {boolean} [userInitiated=false] - True if user explicitly initiated (optional)
   * @returns {boolean} True if cleared, false if blocked
   */
  _safeClearRenderedTabs(reason, source = 'unknown', userInitiated = false) {
    // v1.6.3.5 - FIX Issue #2: Log Map contents before operation
    const logInfo = this._getMapLogInfo('clear', 'all');
    const mapSizeBefore = this.renderedTabs.size;
    
    if (mapSizeBefore === 0) {
      console.log('[UICoordinator] renderedTabs already empty, nothing to clear:', { 
        ...logInfo,
        reason, 
        source 
      });
      return true;
    }
    
    // v1.6.3.4-v12 - FIX Issue #2: Only clear if user-initiated or DOM verification passes
    if (!userInitiated && !this._verifyAllTabsDOMDetached()) {
      console.error('[UICoordinator] ⛔ BLOCKED: renderedTabs.clear() rejected - DOM elements still exist:', {
        ...logInfo,
        reason,
        source
      });
      return false;
    }
    
    console.warn('[UICoordinator] ⚠️ renderedTabs.clear() called:', {
      ...logInfo,
      reason, 
      source, 
      userInitiated, 
      mapSizeBefore
    });
    
    // Stop all DOM monitoring timers and clear
    for (const id of this.renderedTabs.keys()) {
      this._stopDOMMonitoring(id);
    }
    this.renderedTabs.clear();
    
    console.log('[UICoordinator] renderedTabs cleared:', { 
      mapSizeAfter: this.renderedTabs.size, 
      reason, 
      source,
      timestamp: Date.now()
    });
    return true;
  }
  
  /**
   * Verify all tracked tabs have detached DOM
   * v1.6.3.4-v12 - Helper to reduce _safeClearRenderedTabs complexity
   * @private
   * @returns {boolean} True if all tabs are DOM-detached
   */
  _verifyAllTabsDOMDetached() {
    for (const [id, tabWindow] of this.renderedTabs) {
      const domElement = this._findDOMElementById(id);
      const isRendered = tabWindow && typeof tabWindow.isRendered === 'function' && tabWindow.isRendered();
      if (domElement || isRendered) {
        console.log('[UICoordinator] Tab still has DOM:', { id, hasDOMElement: !!domElement, isRendered });
        return false;
      }
    }
    return true;
  }
  
  /**
   * Check if a DOM element exists for a Quick Tab ID
   * v1.6.3.4-v12 - FIX Issue #4: Detect orphaned DOM elements before creating duplicates
   * @private
   * @param {string} quickTabId - Quick Tab ID to check
   * @returns {Element|null} The DOM element if found, null otherwise
   */
  _findDOMElementById(quickTabId) {
    try {
      // v1.6.3.4-v12 - FIX Security: Escape ID to prevent CSS injection
      const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(quickTabId) : quickTabId;
      const element = document.querySelector(`[data-quicktab-id="${escapedId}"]`);
      if (element) {
        console.log('[UICoordinator] Found existing DOM element for Quick Tab:', {
          id: quickTabId,
          element: element.tagName
        });
      }
      return element;
    } catch (err) {
      console.warn('[UICoordinator] Error querying DOM for Quick Tab:', quickTabId, err);
      return null;
    }
  }
  
  /**
   * Get next z-index for a new or restored window
   * v1.6.3.3 - FIX Bug #4: Ensures restored windows stack correctly
   * @private
   * @returns {number} Next z-index value
   */
  _getNextZIndex() {
    this._highestZIndex++;
    return this._highestZIndex;
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
   * v1.6.3.4-v9 - FIX Issue #2: Add fallback to local storage, improved logging
   * v1.6.3.3 - FIX Bug #5: Use same storage source as CreateHandler (storage.local with individual key)
   * @private
   */
  async _loadDebugIdSetting() {
    // v1.6.3.3 - FIX Bug #5: Read from storage.local with individual key 'quickTabShowDebugId'
    // This matches how settings.js saves the setting and how CreateHandler reads it
    try {
      const result = await browser.storage.local.get('quickTabShowDebugId');
      this.showDebugIdSetting = result.quickTabShowDebugId ?? false;
      console.log('[UICoordinator] Loaded showDebugId from storage.local:', this.showDebugIdSetting);
    } catch (err) {
      console.warn('[UICoordinator] Failed to load showDebugId setting:', err.message);
      this.showDebugIdSetting = false;
      console.log('[UICoordinator] Using default showDebugId:', this.showDebugIdSetting);
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
   * Handle existing window in render - check if needs re-render
   * v1.6.3.4-v11 - Extracted to reduce render() bumpy road
   * @private
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @param {number} _mapSizeBefore - Map size before operation (unused, logged by helper)
   * @returns {QuickTabWindow|null} Existing window if valid, null if needs re-render
   */
  _handleExistingWindowInRender(quickTab, _mapSizeBefore) {
    if (!this.renderedTabs.has(quickTab.id)) {
      return null; // Not in map, needs fresh render
    }
    
    const existingWindow = this.renderedTabs.get(quickTab.id);

    // v1.6.3.4-v7 - FIX Issue #3: Validate DOM is actually attached
    if (existingWindow.isRendered()) {
      console.log('[UICoordinator] Tab already rendered and DOM attached:', quickTab.id);
      return existingWindow; // Return cached window
    }

    // v1.6.3.4-v8 - Use helper for safe deletion with validation and logging
    this._safeDeleteFromRenderedTabs(quickTab.id, 'DOM detached, re-rendering');
    // v1.6.3.4-v10 - FIX Issue #5: Clear any monitoring timer for this tab
    this._stopDOMMonitoring(quickTab.id);
    
    return null; // Needs fresh render
  }

  /**
   * Finalize render - store in map, verify, clear snapshot, start monitoring
   * v1.6.3.4-v11 - Extracted to reduce render() bumpy road
   * v1.6.3.4-v5 - FIX Issue #5: Delay snapshot clearing by SNAPSHOT_CLEAR_DELAY_MS (400ms)
   *   to allow for accidental double-clicks without losing the snapshot
   * @private
   * @param {QuickTabWindow} tabWindow - Created tab window
   * @param {QuickTab} quickTab - QuickTab domain entity
   */
  _finalizeRender(tabWindow, quickTab) {
    // v1.6.3.5-v4 - FIX Diagnostic Issue #4: Verify invariant before Map modification
    const invariantCheck = this._verifyInvariant(quickTab.id, '_finalizeRender');
    if (!invariantCheck.valid) {
      console.warn('[UICoordinator] Invariant violation before render - auto-fixed');
    }
    
    // Store in map
    // v1.6.3.4-v11 - FIX Issue #5: Log Map addition with before/after sizes
    const mapSizeAfterDelete = this.renderedTabs.size;
    this.renderedTabs.set(quickTab.id, tabWindow);
    
    // v1.6.3.4-v10 - FIX Issue #6C: Log Map entry creation with isRendered() status
    // v1.6.3.5-v4 - FIX Diagnostic Issue #7: Enhanced logging with full Map keys
    const isRenderedNow = tabWindow.isRendered();
    console.log('[UICoordinator] renderedTabs.set():', {
      id: quickTab.id,
      isRendered: isRenderedNow,
      mapSizeBefore: mapSizeAfterDelete,
      mapSizeAfter: this.renderedTabs.size,
      allMapKeys: Array.from(this.renderedTabs.keys())
    });

    // v1.6.3.4-v9 - FIX Issue #5: Verify DOM is attached after render
    this._verifyDOMAfterRender(tabWindow, quickTab.id);
    
    // v1.6.3.4-v5 - FIX Issue #5: DELAY snapshot clearing to allow for double-clicks
    // Old behavior: clear immediately after render (no tolerance for spam-clicks)
    // New behavior: delay clearing by SNAPSHOT_CLEAR_DELAY_MS (400ms) grace period
    if (isRenderedNow && this._hasMinimizedManager()) {
      this._scheduleSnapshotClearing(quickTab.id);
    }
    
    // v1.6.3.4-v10 - FIX Issue #5: Start periodic DOM monitoring
    this._startDOMMonitoring(quickTab.id, tabWindow);
  }

  /**
   * Schedule delayed snapshot clearing with grace period
   * v1.6.3.4-v5 - FIX Issue #5: Grace period for accidental double-clicks
   * v1.6.3.4-v11 - FIX Issue #7: Implement atomic clear-on-first-use pattern
   *   The snapshot is cleared IMMEDIATELY when restore starts but stored in a
   *   temporary variable for the current restore operation. This prevents a
   *   second restore from accessing the same snapshot.
   * @private
   * @param {string} quickTabId - Quick Tab ID
   */
  _scheduleSnapshotClearing(quickTabId) {
    // Cancel any existing timer for this tab
    const existingTimer = this._pendingSnapshotClears.get(quickTabId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // v1.6.3.4-v11 - FIX Issue #7: Clear snapshot IMMEDIATELY to prevent second restore from using it
    // The snapshot was already extracted and used by _applySnapshotForRestore() before this call
    // We clear it now to prevent race conditions with rapid successive restores
    if (this._hasMinimizedManager()) {
      const cleared = this.minimizedManager.clearSnapshot(quickTabId);
      if (cleared) {
        console.log('[UICoordinator] Snapshot cleared atomically (first-use pattern):', quickTabId);
      }
    }
    
    // Schedule a delayed verification to ensure cleanup
    // This is now just for safety/logging, not the primary clearing mechanism
    const timer = setTimeout(() => {
      this._pendingSnapshotClears.delete(quickTabId);
      if (this._hasMinimizedManager()) {
        // Verify it's truly cleared (defensive)
        const hasSnapshot = this.minimizedManager.hasSnapshot(quickTabId);
        if (hasSnapshot) {
          console.warn('[UICoordinator] Snapshot unexpectedly still exists, clearing:', quickTabId);
          this.minimizedManager.clearSnapshot(quickTabId);
        }
      }
    }, SNAPSHOT_CLEAR_DELAY_MS);
    
    this._pendingSnapshotClears.set(quickTabId, timer);
    console.log(`[UICoordinator] Scheduled snapshot verification in ${SNAPSHOT_CLEAR_DELAY_MS}ms:`, quickTabId);
  }

  /**
   * Render a single QuickTabWindow from QuickTab entity
   * v1.6.2.2 - Removed container check for global visibility
   * v1.6.3 - Removed pending updates (no cross-tab sync)
   * v1.6.3.4-v7 - FIX Issue #3: Validate DOM attachment before returning cached window
   * v1.6.3.4-v9 - FIX Issue #5: Add DOM verification after render to catch detachment early
   * v1.6.3.4-v10 - FIX Issues #1, #5, #6C: Clear snapshot after render, add monitoring, enhanced logging
   * v1.6.3.4-v11 - FIX Issue #5: Enhanced Map lifecycle logging with before/after sizes
   * v1.6.3.4-v11 - Refactored: extracted helpers to eliminate bumpy road pattern
   * v1.6.3.4-v6 - FIX Issue #4: Track render timestamps to prevent duplicate processing
   * v1.6.3.4-v7 - FIX Issue #2, #4: Validate URL and entity before creating window
   * v1.6.3.4-v9 - FIX Issue #16: Render rejection does NOT write to storage
   * v1.6.3.4-v12 - FIX Issue #4: Check for existing DOM element before creating duplicate
   *   Refactored to reduce complexity by extracting helper methods
   * v1.6.3.5-v8 - FIX Issue #1: Add cross-tab scoping check
   *
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow|null} Rendered tab window, or null if validation fails
   */
  render(quickTab) {
    // Validate URL first
    if (!this._validateRenderUrl(quickTab)) {
      return null;
    }
    
    // v1.6.3.5-v8 - FIX Issue #1: Check cross-tab scoping
    if (!this._shouldRenderOnThisTab(quickTab)) {
      return null;
    }
    
    // Check for duplicate render within lock period
    const duplicateCheck = this._checkDuplicateRender(quickTab);
    if (duplicateCheck) return duplicateCheck;
    
    // Check for existing valid window in Map
    const existingWindow = this._handleExistingWindowInRender(quickTab, this.renderedTabs.size);
    if (existingWindow) return existingWindow;
    
    // Check for orphaned DOM element and try to recover
    const recoveredWindow = this._handleOrphanedDOMElement(quickTab);
    if (recoveredWindow) return recoveredWindow;

    // Create new window
    return this._createAndFinalizeWindow(quickTab);
  }
  
  /**
   * Validate URL for render
   * v1.6.3.4-v12 - Extracted to reduce render() complexity
   * @private
   */
  _validateRenderUrl(quickTab) {
    if (!quickTab.url) {
      console.error(`${this._logPrefix} REJECTED: Cannot render Quick Tab with undefined URL:`, {
        id: quickTab.id, url: quickTab.url
      });
      return false;
    }
    return true;
  }
  
  /**
   * Check if Quick Tab should be rendered on this tab (cross-tab scoping)
   * v1.6.3.5-v8 - FIX Issue #1: Enforce strict per-tab scoping
   * Quick Tabs should only render in the browser tab that created them
   * @private
   * @param {Object} quickTab - Quick Tab entity with originTabId property
   * @returns {boolean} True if Quick Tab should render on this tab
   */
  _shouldRenderOnThisTab(quickTab) {
    // If we don't know our tab ID, allow rendering (backwards compatibility)
    // TODO v1.6.4: Remove this fallback once all tabs reliably have currentTabId set
    if (this.currentTabId === null) {
      console.log(`${this._logPrefix} No currentTabId set, allowing render:`, quickTab.id);
      return true;
    }
    
    // If Quick Tab has no originTabId, allow rendering (backwards compatibility)
    // TODO v1.6.4: Remove this fallback once all Quick Tabs have originTabId from creation
    const originTabId = quickTab.originTabId;
    if (originTabId === null || originTabId === undefined) {
      console.log(`${this._logPrefix} No originTabId on Quick Tab, allowing render:`, quickTab.id);
      return true;
    }
    
    // Only render if this is the origin tab
    const shouldRender = originTabId === this.currentTabId;
    
    if (!shouldRender) {
      console.log(`${this._logPrefix} CROSS-TAB BLOCKED: Quick Tab belongs to different tab:`, {
        id: quickTab.id,
        originTabId,
        currentTabId: this.currentTabId
      });
    }
    
    return shouldRender;
  }
  
  /**
   * Check for duplicate render within lock period
   * v1.6.3.4-v12 - Extracted to reduce render() complexity
   * @private
   * @returns {QuickTabWindow|null} Existing window if duplicate blocked, null to continue
   */
  _checkDuplicateRender(quickTab) {
    const lastRenderTime = this._renderTimestamps.get(quickTab.id);
    const now = Date.now();
    if (lastRenderTime && (now - lastRenderTime) < RESTORE_LOCK_MS) {
      const existing = this.renderedTabs.get(quickTab.id);
      if (existing && existing.isRendered()) {
        console.log('[UICoordinator] Duplicate render blocked:', { id: quickTab.id });
        return existing;
      }
    }
    return null;
  }
  
  /**
   * Handle orphaned DOM element - try to recover or remove
   * v1.6.3.4-v12 - Extracted to reduce render() complexity
   * @private
   * @returns {QuickTabWindow|null} Recovered window if found, null otherwise
   */
  _handleOrphanedDOMElement(quickTab) {
    const existingDOMElement = this._findDOMElementById(quickTab.id);
    if (!existingDOMElement) return null;
    
    console.warn('[UICoordinator] Orphaned window detected:', { id: quickTab.id, inMap: false, inDOM: true });
    
    const recoveredWindow = this._tryRecoverWindowFromDOM(existingDOMElement, quickTab);
    if (recoveredWindow) return recoveredWindow;
    
    console.log('[UICoordinator] Could not recover window, removing orphaned element:', quickTab.id);
    existingDOMElement.remove();
    return null;
  }
  
  /**
   * Create new window and finalize render
   * v1.6.3.4-v12 - Extracted to reduce render() complexity
   * @private
   */
  _createAndFinalizeWindow(quickTab) {
    console.log('[UICoordinator] Creating new window instance:', quickTab.id);
    this._renderTimestamps.set(quickTab.id, Date.now());

    let tabWindow;
    try {
      tabWindow = this._createWindow(quickTab);
    } catch (err) {
      console.error('[UICoordinator] Failed to create QuickTabWindow:', { id: quickTab.id, error: err.message });
      this._renderTimestamps.delete(quickTab.id);
      return null;
    }

    this._finalizeRender(tabWindow, quickTab);
    console.log('[UICoordinator] Tab rendered:', quickTab.id);
    return tabWindow;
  }
  
  /**
   * Try to recover a QuickTabWindow from an orphaned DOM element
   * v1.6.3.4-v12 - FIX Issue #4: Reuse existing window instead of creating duplicate
   * 
   * Note: Uses __quickTabWindow property on DOM elements which is set by window.js
   * during render(). This is a common pattern for associating data with DOM elements
   * in browser extensions. If window.js doesn't set this property, recovery will
   * gracefully fail and a new window will be created.
   * 
   * @private
   * @param {Element} domElement - The existing DOM element
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {QuickTabWindow|null} Recovered window or null if recovery failed
   */
  _tryRecoverWindowFromDOM(domElement, quickTab) {
    // The window reference might be stored on the element by window.js render()
    // If not present, recovery fails gracefully and caller creates a new window
    const recoveredWindow = domElement.__quickTabWindow;
    
    if (recoveredWindow && typeof recoveredWindow.isRendered === 'function') {
      console.log('[UICoordinator] DOM element found but not in Map - reusing existing window:', quickTab.id);
      
      // Restore the window
      if (typeof recoveredWindow.restore === 'function') {
        recoveredWindow.restore();
      }
      
      // Re-add to renderedTabs Map
      this.renderedTabs.set(quickTab.id, recoveredWindow);
      
      console.log('[UICoordinator] Re-added recovered window to Map:', {
        id: quickTab.id,
        mapSizeAfter: this.renderedTabs.size
      });
      
      // Start DOM monitoring
      this._startDOMMonitoring(quickTab.id, recoveredWindow);
      
      return recoveredWindow;
    }
    
    return null;
  }

  /**
   * Check if minimizedManager is available and has required methods
   * v1.6.3.4-v6 - Helper to reduce complexity
   * @private
   * @returns {boolean} True if minimizedManager is usable
   */
  _hasMinimizedManager() {
    return this.minimizedManager && typeof this.minimizedManager.isMinimized === 'function';
  }

  /**
   * Try to apply snapshot from minimizedManager
   * v1.6.3.4-v9 - Helper to reduce _applySnapshotForRestore complexity
   * v1.6.3.4-v10 - FIX Issues #1, #6B: Use hasSnapshot() instead of isMinimized(), add source logging
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply snapshot to
   * @returns {boolean} True if snapshot was applied
   */
  _tryApplySnapshotFromManager(quickTab) {
    if (!this._hasMinimizedManager()) {
      console.log('[UICoordinator] No minimizedManager available for snapshot check:', quickTab.id);
      return false;
    }
    
    // v1.6.3.4-v10 - FIX Issue #1: Use hasSnapshot() to check both active and pending-clear snapshots
    // isMinimized() only checks active minimizedTabs, missing pending-clear snapshots
    const hasAnySnapshot = this.minimizedManager.hasSnapshot(quickTab.id);
    const isActivelyMinimized = this.minimizedManager.isMinimized(quickTab.id);
    
    // v1.6.3.4-v10 - FIX Issue #6B: Log WHERE snapshot check happens and WHAT it finds
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
    
    // v1.6.3.4-v10 - Only call restore() if still in active minimizedTabs
    // This applies the snapshot to the instance (for tabWindow dimensions)
    if (isActivelyMinimized) {
      this.minimizedManager.restore(quickTab.id);
    }
    return true;
  }

  /**
   * Check if tabWindow has valid dimensions for restore
   * v1.6.3.4-v11 - Extracted to reduce _tryApplyDimensionsFromInstance complexity
   * @private
   * @param {QuickTabWindow} tabWindow - Tab window instance
   * @returns {boolean} True if all dimensions are valid
   */
  _hasValidDimensions(tabWindow) {
    const hasValidWidth = typeof tabWindow.width === 'number' && tabWindow.width > 0;
    const hasValidHeight = typeof tabWindow.height === 'number' && tabWindow.height > 0;
    const hasValidLeft = typeof tabWindow.left === 'number';
    const hasValidTop = typeof tabWindow.top === 'number';
    return hasValidWidth && hasValidHeight && hasValidLeft && hasValidTop;
  }

  /**
   * Try to apply dimensions from existing tabWindow instance
   * v1.6.3.4-v9 - Helper to reduce _applySnapshotForRestore complexity
   * v1.6.3.4-v11 - Refactored: extracted _hasValidDimensions() to reduce complexity
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply dimensions to
   * @returns {boolean} True if dimensions were applied
   */
  _tryApplyDimensionsFromInstance(quickTab) {
    const tabWindow = this.renderedTabs.get(quickTab.id);
    if (!tabWindow || tabWindow.minimized) {
      return false;
    }
    
    if (!this._hasValidDimensions(tabWindow)) {
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
   * v1.6.3.4-v6 - FIX Issue #3: Use snapshot position/size when restoring
   * v1.6.3.4-v9 - FIX Entity-Instance Sync Gap: Read from tabWindow instance if minimizedManager
   *   has already removed the snapshot (happens when VisibilityHandler calls restore first)
   * v1.6.3.4-v2 - FIX Issue #3: Enhanced logging for snapshot application verification
   * @private
   * @param {QuickTab} quickTab - QuickTab entity to apply snapshot to
   */
  _applySnapshotForRestore(quickTab) {
    // v1.6.3.4-v2 - FIX Issue #3: Log entity dimensions BEFORE snapshot application
    console.log('[UICoordinator] _applySnapshotForRestore - entity dimensions BEFORE:', {
      id: quickTab.id,
      position: quickTab.position,
      size: quickTab.size
    });
    
    // First try to get snapshot from minimizedManager
    if (this._tryApplySnapshotFromManager(quickTab)) {
      // v1.6.3.4-v2 - FIX Issue #3: Log entity dimensions AFTER snapshot application
      console.log('[UICoordinator] _applySnapshotForRestore - entity dimensions AFTER (from manager):', {
        id: quickTab.id,
        position: quickTab.position,
        size: quickTab.size
      });
      return;
    }
    // v1.6.3.4-v9 - FIX Entity-Instance Sync Gap: If minimizedManager doesn't have it,
    // try to read from the existing tabWindow instance (which may have had snapshot applied)
    if (this._tryApplyDimensionsFromInstance(quickTab)) {
      // v1.6.3.4-v2 - FIX Issue #3: Log entity dimensions AFTER instance application
      console.log('[UICoordinator] _applySnapshotForRestore - entity dimensions AFTER (from instance):', {
        id: quickTab.id,
        position: quickTab.position,
        size: quickTab.size
      });
      return;
    }
    console.log('[UICoordinator] No snapshot available for:', quickTab.id);
  }

  /**
   * Apply snapshot from MinimizedManager and restore window state
   * v1.6.3.4-v11 - Extracted to reduce _restoreExistingWindow bumpy road
   * @private
   * @param {QuickTabWindow} tabWindow - The window to restore
   * @param {string} quickTabId - Quick Tab ID
   */
  _applySnapshotAndRestore(tabWindow, quickTabId) {
    if (!this._hasMinimizedManager() || !this.minimizedManager.hasSnapshot(quickTabId)) {
      // No snapshot available, just call restore() on the window
      tabWindow.restore();
      console.log('[UICoordinator] Restored tab directly (no snapshot):', quickTabId);
      return;
    }
    
    // v1.6.3.4-v2 - FIX Issue #3: Log that we're about to apply snapshot from manager
    console.log('[UICoordinator] Applying snapshot from MinimizedManager for:', quickTabId);
    
    // MinimizedManager.restore() applies snapshot to instance but does NOT render
    const restoreResult = this.minimizedManager.restore(quickTabId);
    if (restoreResult) {
      // v1.6.3.4-v2 - FIX Issue #3: Log the snapshot values that were applied
      console.log('[UICoordinator] Snapshot applied from MinimizedManager:', {
        id: quickTabId,
        position: restoreResult.position,
        size: restoreResult.size
      });
      // v1.6.3.2 - Now call restore() on the window (which updates minimized flag but does NOT render)
      tabWindow.restore();
    }
  }

  /**
   * Render restored window and apply post-render setup
   * v1.6.3.4-v11 - Extracted to reduce _restoreExistingWindow bumpy road
   * v1.6.3.4-v5 - FIX Issue #5: Use delayed snapshot clearing
   * @private
   * @param {QuickTabWindow} tabWindow - The window to render
   * @param {string} quickTabId - Quick Tab ID
   */
  _renderRestoredWindow(tabWindow, quickTabId) {
    console.log('[UICoordinator] DOM not attached after restore, rendering:', quickTabId);
    
    // v1.6.3.3 - FIX Bug #2 (UID Disappears): Ensure showDebugId is current before render
    tabWindow.showDebugId = this.showDebugIdSetting;
    
    // v1.6.3.4-v2 - FIX Issue #3: Log dimensions about to be used for render
    console.log('[UICoordinator] Dimensions being passed to render():', {
      id: quickTabId,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height
    });
    
    tabWindow.render();
    this.renderedTabs.set(quickTabId, tabWindow);
    
    // v1.6.3.4-v11 - FIX Issue #5: Verify callbacks are properly wired after restore
    this._verifyCallbacksAfterRestore(tabWindow, quickTabId);
    
    // Apply incremented z-index for proper stacking
    this._applyZIndexAfterRestore(tabWindow, quickTabId);
    
    // v1.6.3.4-v8 - FIX Issue #5: Verify DOM is attached after render
    this._verifyDOMAfterRender(tabWindow, quickTabId);
    
    // v1.6.3.4-v5 - FIX Issue #5: Use delayed snapshot clearing (see _scheduleSnapshotClearing)
    if (tabWindow.isRendered() && this._hasMinimizedManager()) {
      this._scheduleSnapshotClearing(quickTabId);
    }
    
    // v1.6.3.4-v10 - FIX Issue #5: Start periodic DOM monitoring
    this._startDOMMonitoring(quickTabId, tabWindow);
  }
  
  /**
   * Verify that callbacks are properly wired after restore render
   * v1.6.3.4-v11 - FIX Issue #5: Restored Window Callback Failures
   * @private
   * @param {QuickTabWindow} tabWindow - The window to verify
   * @param {string} quickTabId - Quick Tab ID
   */
  _verifyCallbacksAfterRestore(tabWindow, quickTabId) {
    const callbackStatus = {
      id: quickTabId,
      onPositionChangeEnd: typeof tabWindow.onPositionChangeEnd === 'function',
      onSizeChangeEnd: typeof tabWindow.onSizeChangeEnd === 'function',
      onFocus: typeof tabWindow.onFocus === 'function',
      onMinimize: typeof tabWindow.onMinimize === 'function',
      onClose: typeof tabWindow.onClose === 'function'
    };
    
    const missingCallbacks = Object.entries(callbackStatus)
      .filter(([key, value]) => key !== 'id' && !value)
      .map(([key]) => key);
    
    if (missingCallbacks.length > 0) {
      console.warn('[UICoordinator] ⚠️ Missing callbacks after restore:', {
        id: quickTabId,
        missingCallbacks,
        allCallbacks: callbackStatus
      });
    } else {
      console.log('[UICoordinator] ✓ All callbacks verified for restored window:', quickTabId);
    }
  }

  /**
   * Apply incremented z-index after restore render
   * v1.6.3.4-v11 - Extracted to reduce _renderRestoredWindow complexity
   * v1.6.3.5-v9 - FIX Diagnostic Issue #4: Ensure stacking context by forcing reflow
   * @private
   * @param {QuickTabWindow} tabWindow - The window
   * @param {string} quickTabId - Quick Tab ID
   */
  _applyZIndexAfterRestore(tabWindow, quickTabId) {
    // v1.6.3.3 - FIX Bug #4: Apply NEXT z-index so restored tabs stack correctly
    const newZIndex = this._getNextZIndex();
    if (tabWindow.container) {
      tabWindow.zIndex = newZIndex;
      tabWindow.container.style.zIndex = newZIndex.toString();
      
      // v1.6.3.5-v9 - FIX Diagnostic Issue #4: Force browser reflow to ensure z-index takes effect
      // When z-index is changed on elements that were recently added to the DOM (like restored
      // Quick Tabs), the browser may batch style updates. Accessing offsetHeight forces a
      // synchronous reflow, ensuring the z-index change is applied immediately before the
      // element is painted. This prevents the "behind other tabs" bug where restored windows
      // briefly appear behind other elements due to deferred style application.
      // Reference: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
      // eslint-disable-next-line no-unused-expressions
      tabWindow.container.offsetHeight;
      
      // v1.6.3.5-v9 - FIX Diagnostic Issue #4: Verify stacking context properties
      const computedStyle = window.getComputedStyle(tabWindow.container);
      const verifiedZIndex = parseInt(computedStyle.zIndex, 10);
      
      console.log('[UICoordinator] Applied incremented z-index after restore render:', {
        id: quickTabId,
        zIndex: newZIndex,
        verifiedZIndex,
        position: computedStyle.position,
        opacity: computedStyle.opacity,
        transform: computedStyle.transform
      });
      
      // Warn if z-index verification fails
      if (verifiedZIndex !== newZIndex) {
        console.warn('[UICoordinator] ⚠️ z-index verification mismatch after restore:', {
          id: quickTabId,
          expected: newZIndex,
          actual: verifiedZIndex
        });
      }
    }
  }

  /**
   * Handle restore of existing minimized window
   * v1.6.3.4-v6 - Helper to reduce complexity
   * v1.6.3.2 - FIX Issue #1 CRITICAL: UICoordinator is single rendering authority
   *   MinimizedManager.restore() now only applies snapshot and returns result.
   *   We need to call tabWindow.restore() here, then render if needed.
   * v1.6.3.4-v8 - FIX Issues #1, #5, #6: Enhanced logging, DOM verification after render
   * v1.6.3.4-v10 - FIX Issue #1: Clear snapshot after successful render, start monitoring
   * v1.6.3.4-v2 - FIX Issue #3: Enhanced logging for snapshot application verification
   * v1.6.3.4-v11 - Refactored: extracted helpers to eliminate bumpy road pattern
   * @private
   * @param {QuickTabWindow} tabWindow - The window to restore
   * @param {string} quickTabId - Quick Tab ID
   * @returns {QuickTabWindow} The restored window
   */
  _restoreExistingWindow(tabWindow, quickTabId) {
    console.log('[UICoordinator] Tab is being restored from minimized state:', quickTabId);
    
    // v1.6.3.4-v8 - FIX Issue #6: Log dimensions BEFORE restore for debugging
    console.log('[UICoordinator] Pre-restore instance dimensions:', {
      id: quickTabId,
      left: tabWindow.left,
      top: tabWindow.top,
      width: tabWindow.width,
      height: tabWindow.height
    });

    // Apply snapshot and restore window state
    this._applySnapshotAndRestore(tabWindow, quickTabId);
    
    // v1.6.3.4-v2 - FIX Issue #3: Log dimensions AFTER restore/snapshot application
    console.log('[UICoordinator] Post-restore instance dimensions (before render):', {
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
      this._renderRestoredWindow(tabWindow, quickTabId);
    }

    return tabWindow;
  }
  
  /**
   * Verify DOM is attached after render with delayed check
   * v1.6.3.4-v8 - FIX Issue #5: Proactive DOM detachment detection
   * v1.6.3.4-v10 - FIX Issue #1: Clear snapshot on delayed verification success
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
    
    // v1.6.3.4-v8 - FIX Issue #5: Delayed verification
    setTimeout(() => {
      if (!tabWindow.isRendered()) {
        console.error(`[UICoordinator] Delayed DOM verification FAILED (detached within ${DOM_VERIFICATION_DELAY_MS}ms):`, quickTabId);
        // Remove stale reference
        this.renderedTabs.delete(quickTabId);
        // Stop monitoring
        this._stopDOMMonitoring(quickTabId);
      } else {
        console.log('[UICoordinator] DOM verification PASSED for:', quickTabId);
        // v1.6.3.4-v10 - FIX Issue #1: Ensure snapshot is cleared after delayed verification passes
        if (this._hasMinimizedManager()) {
          this.minimizedManager.clearSnapshot(quickTabId);
        }
      }
    }, DOM_VERIFICATION_DELAY_MS);
  }
  
  /**
   * Start periodic DOM monitoring for a rendered tab
   * v1.6.3.4-v10 - FIX Issue #5: Proactive DOM detachment detection between events
   * v1.6.3.3 - FIX Bug #8: Attempt to re-render if DOM detaches unexpectedly
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {QuickTabWindow} tabWindow - The window to monitor
   */
  _startDOMMonitoring(quickTabId, tabWindow) {
    // Clear any existing timer
    this._stopDOMMonitoring(quickTabId);
    
    // v1.6.3.4-v10 - FIX Issue #5: Set up periodic check every 500ms
    // This catches detachment that happens between events (the 73-second gap issue)
    let checkCount = 0;
    const maxChecks = 10; // Monitor for 5 seconds max (10 * 500ms)
    
    const timerId = setInterval(() => {
      checkCount++;
      
      // v1.6.3.3 - FIX Bug #8: Check if window was minimized (expected detachment)
      if (tabWindow.minimized) {
        console.log('[UICoordinator] DOM monitoring: tab minimized, stopping:', quickTabId);
        this._stopDOMMonitoring(quickTabId);
        return;
      }
      
      if (!tabWindow.isRendered()) {
        console.warn('[UICoordinator] Periodic DOM check detected UNEXPECTED detachment:', {
          id: quickTabId,
          checkNumber: checkCount,
          elapsedMs: checkCount * DOM_MONITORING_INTERVAL_MS,
          minimized: tabWindow.minimized,
          destroyed: tabWindow.destroyed
        });
        
        // v1.6.3.3 - FIX Bug #8: Attempt re-render if tab is still active
        const reRenderSucceeded = this._attemptReRenderDetachedTab(tabWindow, quickTabId);
        if (reRenderSucceeded) return; // Successfully re-rendered, continue monitoring
        
        // Clean up if re-render failed, not attempted, or tab was destroyed
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
   * v1.6.3.4-v10 - FIX Issue #5: Cleanup monitoring timer
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
   * Attempt to re-render a detached Quick Tab
   * v1.6.3.3 - FIX Bug #8: Extracted helper to reduce nesting depth
   * @private
   * @param {QuickTabWindow} tabWindow - The tab window instance
   * @param {string} quickTabId - Quick Tab ID
   * @returns {boolean} True if re-render succeeded, false otherwise
   */
  _attemptReRenderDetachedTab(tabWindow, quickTabId) {
    if (tabWindow.minimized || tabWindow.destroyed) {
      return false; // Not eligible for re-render
    }
    
    console.log('[UICoordinator] Attempting to re-render detached tab:', quickTabId);
    try {
      tabWindow.render();
      // Note: Don't update z-index on re-render - the tab already had a valid z-index
      console.log('[UICoordinator] Successfully re-rendered detached tab:', quickTabId);
      return true; // Continue monitoring
    } catch (err) {
      console.error('[UICoordinator] Failed to re-render detached tab:', quickTabId, err);
      return false;
    }
  }

  /**
   * Update an existing QuickTabWindow
   * v1.6.3.4 - FIX Bug #6: Check for minimized state before rendering
   * v1.6.3.4-v3 - FIX TypeError: Add null safety checks for position/size access
   * v1.6.3.4-v4 - FIX Issue #2: Check BOTH top-level AND nested minimized properties
   * v1.6.3.4-v5 - FIX Bug #2: When restoring, call restore() on existing window instead of render()
   * v1.6.3.4-v6 - FIX Issue #3: Use snapshot position/size when restoring, never create duplicate
   * v1.6.3.4-v7 - FIX Issue #3: Validate DOM attachment with isRendered() before operating
   * v1.6.3.4-v8 - FIX Issues #2, #3, #8: Use tabWindow.minimized (instance state) instead of entity state
   *   When DOM is detached and instance is NOT minimized, ALWAYS render regardless of entity state.
   * v1.6.3.4-v10 - FIX Issues #2, #3, #6D: Enhanced decision logging, always render when DOM missing + instance not minimized
   * v1.6.3.4-v11 - FIX Issue #1: Remove from renderedTabs when DOM detached and entity is minimized (Manager minimize)
   *   The Manager's minimize button calls handleMinimize which removes DOM but doesn't clear renderedTabs.
   *   This fix ensures stale Map entries are cleaned up to prevent duplicate 400x300 windows on restore.
   * v1.6.3.4-v2 - FIX Issues #1, #2, #5, #6: Source-aware Map cleanup and isRestoreOperation flag
   *   - Issue #1/#2: When source='Manager' AND minimized, immediately delete Map entry
   *   - Issue #5: Use isRestoreOperation flag to correctly route restore even when both states are false
   *   - Issue #6: Log all source-based decisions for audit trail
   * v1.6.3.4-v3 - FIX Issues #1, #2, #6: Unified restore path
   *   - Issue #1: ALWAYS delete Map entry before restore to ensure fresh render() path
   *   - Issue #2: Map cleanup now happens explicitly, not relying on conditional paths
   *   - Issue #6: Enhanced logging for Map lifecycle and restore decision
   *   - Refactored to extract helpers and reduce complexity
   * v1.6.3.4-v11 - Refactored: introduced UpdateContext object to reduce function argument count
   * v1.6.3.5 - FIX Issue #2: Enhanced Map logging with mapKeys array at entry and exit
   *
   * @param {QuickTab} quickTab - Updated QuickTab entity
   * @param {string} source - Source of the event ('Manager', 'UI', 'automation', 'background', 'unknown')
   * @param {boolean} isRestoreOperation - Flag indicating this is a restore operation
   * @returns {QuickTabWindow|undefined} Updated or newly rendered tab window, or undefined if skipped
   */
  update(quickTab, source = 'unknown', isRestoreOperation = false) {
    const mapSizeBefore = this.renderedTabs.size;
    const tabWindow = this.renderedTabs.get(quickTab.id);
    const entityMinimized = Boolean(quickTab.minimized || quickTab.visibility?.minimized);

    // v1.6.3.5 - FIX Issue #2: Enhanced logging with Map contents
    const logInfo = this._getMapLogInfo('update-entry', quickTab.id);
    console.log('[UICoordinator] update() entry:', {
      ...logInfo,
      id: quickTab.id,
      inMap: !!tabWindow,
      entityMinimized,
      source,
      isRestoreOperation,
      mapSizeBefore
    });

    // v1.6.3.4-v11 - Create context object to reduce parameter passing
    const ctx = {
      quickTab,
      tabWindow,
      entityMinimized,
      source,
      isRestoreOperation,
      mapSizeBefore
    };

    // Handle Manager minimize cleanup (early path)
    const minimizeResult = this._handleManagerMinimize(ctx);
    if (minimizeResult !== null) return minimizeResult;

    // Handle restore operations with unified path
    const restoreResult = this._handleRestoreOperation(ctx);
    if (restoreResult !== null) return restoreResult;

    // Handle non-rendered tab
    if (!tabWindow) {
      return this._handleNotInMap(ctx);
    }

    // Check instance state and DOM attachment
    const instanceMinimized = tabWindow.minimized;
    const domAttached = tabWindow.isRendered();

    console.log('[UICoordinator] Update decision (in-map path):', {
      id: quickTab.id,
      inMap: true,
      domAttached,
      entityMinimized,
      instanceMinimized,
      source,
      isRestoreOperation,
      mapSize: mapSizeBefore
    });

    // Handle detached DOM - extend context with instance state
    if (!domAttached) {
      return this._handleDetachedDOMUpdate({ ...ctx, instanceMinimized });
    }

    // Handle instance-entity state mismatch restore
    if (instanceMinimized && !entityMinimized) {
      return this._handleStateMismatchRestore(ctx);
    }

    // Normal update path
    return this._performNormalUpdate(quickTab, tabWindow);
  }

  /**
   * Handle Manager minimize cleanup
   * v1.6.3.4-v3 - Extracted to reduce update() complexity
   * v1.6.3.4-v11 - Refactored: uses UpdateContext object for parameters
   * @private
   * @param {Object} ctx - Update context { quickTab, tabWindow, entityMinimized, source, mapSizeBefore }
   * @returns {undefined|null} undefined if handled, null to continue
   */
  _handleManagerMinimize(ctx) {
    const { quickTab, tabWindow, entityMinimized, source, mapSizeBefore } = ctx;
    
    if (source !== 'Manager' || !entityMinimized) {
      return null; // Not a Manager minimize, continue processing
    }
    
    if (tabWindow) {
      console.log('[UICoordinator] renderedTabs.delete() - Manager minimize cleanup (early path):', {
        id: quickTab.id,
        reason: 'Manager minimize with entity.minimized=true',
        source,
        mapSizeBefore,
        mapSizeAfter: mapSizeBefore - 1
      });
      this.renderedTabs.delete(quickTab.id);
      this._stopDOMMonitoring(quickTab.id);
    }
    console.log('[UICoordinator] Update decision: skip (Manager minimize, cleanup complete):', quickTab.id);
    return undefined; // Handled, return early
  }

  /**
   * Handle restore operations with unified path
   * v1.6.3.4-v3 - Extracted to reduce update() complexity
   * v1.6.3.4-v11 - Refactored: uses UpdateContext object for parameters
   * v1.6.3.4-v6 - FIX Issue #4: Add restore-in-progress lock to prevent duplicates
   * v1.6.3.5 - FIX Issue #1: Use transaction wrapper for atomic delete+set sequence
   * @private
   * @param {Object} ctx - Update context { quickTab, tabWindow, entityMinimized, source, isRestoreOperation, mapSizeBefore }
   * @returns {QuickTabWindow|null} Rendered window if handled, null to continue
   */
  _handleRestoreOperation(ctx) {
    const { quickTab, entityMinimized, isRestoreOperation } = ctx;
    
    if (!isRestoreOperation || entityMinimized) {
      return null; // Not a restore operation, continue processing
    }
    
    // v1.6.3.4-v6 - FIX Issue #4: Check if restore is already in progress
    if (RESTORE_IN_PROGRESS.has(quickTab.id)) {
      console.log('[UICoordinator] Restore already in progress, skipping:', quickTab.id);
      return this.renderedTabs.get(quickTab.id) || null;
    }
    
    // v1.6.3.4-v6 - FIX Issue #4: Lock restore operation
    RESTORE_IN_PROGRESS.add(quickTab.id);
    setTimeout(() => RESTORE_IN_PROGRESS.delete(quickTab.id), RESTORE_LOCK_MS);
    
    return this._executeRestoreWithTransaction(ctx);
  }
  
  /**
   * Execute restore with transaction wrapper
   * v1.6.3.5 - Extracted to reduce _handleRestoreOperation complexity
   * @private
   * @param {Object} ctx - Update context
   * @returns {QuickTabWindow|null} Rendered window or null on error
   */
  _executeRestoreWithTransaction(ctx) {
    const { quickTab, tabWindow, source, mapSizeBefore } = ctx;
    const transactionStarted = this._mapTxnManager.beginTransaction('restore operation');
    
    try {
      this._cleanupTabWindowForRestore(quickTab.id, tabWindow, transactionStarted, source, mapSizeBefore);
      
      console.log('[UICoordinator] Update decision: restore via unified fresh render path:', {
        id: quickTab.id,
        source,
        isRestoreOperation: true,
        inTransaction: transactionStarted
      });
      
      this._applySnapshotForRestore(quickTab);
      const result = this.render(quickTab);
      
      this._commitRestoreTransaction(transactionStarted);
      return result;
    } catch (err) {
      console.error('[UICoordinator] Restore operation failed, rolling back:', err);
      if (transactionStarted) {
        this._mapTxnManager.rollbackTransaction();
      }
      return null;
    }
  }
  
  /**
   * Clean up existing tabWindow for restore operation
   * v1.6.3.5 - Extracted to reduce nesting depth
   * @private
   */
  _cleanupTabWindowForRestore(id, tabWindow, transactionStarted, source, mapSizeBefore) {
    if (!tabWindow) return;
    
    const logInfo = this._getMapLogInfo('delete-before-restore', id);
    console.log('[UICoordinator] renderedTabs.delete() - restore operation cleanup:', {
      ...logInfo,
      reason: 'restore operation - forcing fresh render path',
      source,
      mapSizeBefore,
      mapSizeAfter: mapSizeBefore - 1
    });
    
    if (transactionStarted) {
      this._mapTxnManager.deleteEntry(id, 'restore operation cleanup');
    } else {
      this.renderedTabs.delete(id);
    }
    this._stopDOMMonitoring(id);
  }
  
  /**
   * Commit restore transaction if started
   * v1.6.3.5 - Extracted to reduce nesting depth
   * @private
   */
  _commitRestoreTransaction(transactionStarted) {
    if (!transactionStarted) return;
    
    const commitResult = this._mapTxnManager.commitTransaction();
    if (!commitResult.success) {
      console.error('[UICoordinator] Transaction commit failed:', commitResult.error);
    }
  }

  /**
   * Handle update when tab is not in renderedTabs Map
   * v1.6.3.4-v3 - Extracted to reduce update() complexity
   * v1.6.3.4-v11 - Refactored: uses UpdateContext object for parameters
   * @private
   * @param {Object} ctx - Update context { quickTab, entityMinimized, source, mapSizeBefore }
   * @returns {QuickTabWindow|undefined} Rendered window or undefined if skipped
   */
  _handleNotInMap(ctx) {
    const { quickTab, entityMinimized, source, mapSizeBefore } = ctx;
    
    console.log('[UICoordinator] Update decision:', {
      id: quickTab.id,
      inMap: false,
      entityMinimized,
      source,
      mapSize: mapSizeBefore,
      action: entityMinimized ? 'skip (minimized)' : 'render (not in map)'
    });
    
    if (entityMinimized) {
      console.log('[UICoordinator] Tab is minimized (no window), skipping render:', quickTab.id);
      return;
    }
    this._applySnapshotForRestore(quickTab);
    console.warn('[UICoordinator] Tab not rendered, rendering now:', quickTab.id);
    return this.render(quickTab);
  }

  /**
   * Handle restore when instance and entity states mismatch
   * v1.6.3.4-v3 - Extracted to reduce update() complexity
   * v1.6.3.4-v11 - Refactored: uses UpdateContext object for parameters
   * @private
   * @param {Object} ctx - Update context { quickTab, source, mapSizeBefore }
   * @returns {QuickTabWindow} Rendered window
   */
  _handleStateMismatchRestore(ctx) {
    const { quickTab, source, mapSizeBefore } = ctx;
    
    console.log('[UICoordinator] Update decision: restore (instance minimized, entity not):', quickTab.id);
    console.log('[UICoordinator] renderedTabs.delete() - restore via instance state mismatch:', {
      id: quickTab.id,
      reason: 'instance.minimized=true but entity.minimized=false',
      source,
      mapSizeBefore,
      mapSizeAfter: mapSizeBefore - 1
    });
    this.renderedTabs.delete(quickTab.id);
    this._stopDOMMonitoring(quickTab.id);
    this._applySnapshotForRestore(quickTab);
    return this.render(quickTab);
  }

  /**
   * Perform normal update on existing tab
   * v1.6.3.4-v3 - Extracted to reduce update() complexity
   * @private
   * @returns {QuickTabWindow} Updated window
   */
  _performNormalUpdate(quickTab, tabWindow) {
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
   * Get human-readable reason for transition decision
   * v1.6.3.4-v10 - FIX Issue #8: Helper to avoid deeply nested ternary
   * @private
   * @param {boolean} entityMinimized - Entity minimized state
   * @param {boolean} instanceMinimized - Instance minimized state
   * @param {boolean} isRestoreOperation - Whether this is a restore operation
   * @returns {string} Human-readable reason
   */
  _getTransitionReason(entityMinimized, instanceMinimized, isRestoreOperation) {
    if (entityMinimized) {
      return 'entity is minimized';
    }
    if (isRestoreOperation) {
      return 'restore operation';
    }
    if (!instanceMinimized) {
      return 'instance not minimized';
    }
    return 'entity not minimized';
  }

  /**
   * Handle update when DOM is detached
   * v1.6.3.3 - Extracted to reduce complexity of update() method
   * v1.6.3.4-v2 - FIX Issues #1, #2, #6: Add source parameter for source-aware cleanup
   * v1.6.3.4-v3 - FIX Issues #1, #2: Simplified logic - always clean up and then render if needed
   * v1.6.3.4-v11 - Refactored: uses UpdateContext object for parameters (reduces from 7 to 1)
   * v1.6.3.4-v10 - FIX Issue #3: Use look-ahead pattern instead of immediate deletion
   *   The problem was that deleting from renderedTabs Map BEFORE knowing the final state
   *   created an async gap where the tab appeared "not rendered" during transition.
   *   Now we determine final state (willRender) first and only delete when final state is minimized.
   * @private
   * @param {Object} ctx - Update context { quickTab, entityMinimized, instanceMinimized, source, isRestoreOperation, mapSizeBefore }
   * @returns {QuickTabWindow|undefined} Rendered window or undefined
   */
  _handleDetachedDOMUpdate(ctx) {
    const { quickTab, entityMinimized, instanceMinimized, source, isRestoreOperation, mapSizeBefore } = ctx;
    
    // v1.6.3.4-v10 - FIX Issue #3: Log transition state BEFORE any modifications
    // This helps diagnose the 73-second gaps in logs
    console.log('[UICoordinator] _handleDetachedDOMUpdate - transition state:', {
      id: quickTab.id,
      entityMinimized,
      instanceMinimized,
      isRestoreOperation,
      source,
      mapSizeBefore,
      hasExistingEntry: this.renderedTabs.has(quickTab.id)
    });

    // v1.6.3.4-v10 - FIX Issue #3: Determine final action BEFORE modifying Map
    // This prevents the "deleted but about to recreate" intermediate state
    const willRender = !entityMinimized && (!instanceMinimized || isRestoreOperation);
    
    // v1.6.3.4-v10 - FIX Issue #8: Use helper for readable transition reason
    const transitionReason = this._getTransitionReason(entityMinimized, instanceMinimized, isRestoreOperation);
    console.log('[UICoordinator] Transition decision:', {
      id: quickTab.id,
      willRender,
      reason: transitionReason
    });
    
    // v1.6.3.4-v10 - FIX Issue #3: Only delete from Map AFTER we know final state
    // If we're going to render, we can skip the delete entirely since we'll set() after render
    if (!willRender) {
      // Final state is "not rendered" - safe to delete now
      console.log('[UICoordinator] renderedTabs.delete():', {
        id: quickTab.id,
        reason: 'DOM detached and will NOT render',
        source,
        entityMinimized,
        instanceMinimized,
        mapSizeBefore,
        mapSizeAfter: mapSizeBefore - 1
      });
      this._safeDeleteFromRenderedTabs(quickTab.id, 'DOM detached - final state minimized');
      this._stopDOMMonitoring(quickTab.id);
      
      console.log('[UICoordinator] DOM detached + will not render, cleanup complete:', {
        id: quickTab.id,
        source,
        action: 'skip (cleanup only)',
        mapSizeAfter: this.renderedTabs.size
      });
      return;
    }

    // v1.6.3.4-v10 - FIX Issue #3: We're going to render
    // The existing Map entry (if any) will be overwritten by render()
    // So we can clean up DOM monitoring but defer Map deletion
    this._stopDOMMonitoring(quickTab.id);
    
    // Log that we're keeping the Map entry until render() overwrites it
    if (this.renderedTabs.has(quickTab.id)) {
      console.log('[UICoordinator] Keeping Map entry until render() completes:', {
        id: quickTab.id,
        source,
        reason: 'copy-on-write pattern - render() will overwrite'
      });
    }

    // Apply snapshot if available before rendering
    console.log('[UICoordinator] DOM detached but will render - applying snapshot:', {
      id: quickTab.id,
      source,
      isRestoreOperation,
      action: 'render'
    });
    this._applySnapshotForRestore(quickTab);
    
    // Now delete just before render so the render path is clean
    // This minimizes the async gap window
    if (this.renderedTabs.has(quickTab.id)) {
      this._safeDeleteFromRenderedTabs(quickTab.id, 'DOM detached - preparing for re-render');
    }
    
    return this.render(quickTab);
  }

  /**
   * Destroy a QuickTabWindow
   * v1.6.3.4-v5 - FIX Bug #3: Verify DOM cleanup after destroy
   * v1.6.3.4-v10 - FIX Issue #5: Stop DOM monitoring on destroy
   * v1.6.3.4-v11 - FIX Issue #5: Enhanced Map lifecycle logging
   *
   * @param {string} quickTabId - ID of tab to destroy
   */
  destroy(quickTabId) {
    const mapSizeBefore = this.renderedTabs.size;
    
    // v1.6.3.4-v10 - FIX Issue #5: Stop monitoring first
    this._stopDOMMonitoring(quickTabId);
    
    const tabWindow = this.renderedTabs.get(quickTabId);

    if (!tabWindow) {
      console.warn('[UICoordinator] Tab not found for destruction:', quickTabId);
      // v1.6.3.4-v5 - FIX Bug #3: Still try to clean up orphaned DOM elements using shared utility
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
    // v1.6.3.4-v11 - FIX Issue #5: Log Map removal with before/after sizes
    console.log('[UICoordinator] renderedTabs.delete():', {
      id: quickTabId,
      reason: 'destroy',
      mapSizeBefore,
      mapSizeAfter: mapSizeBefore - 1
    });
    this.renderedTabs.delete(quickTabId);

    // v1.6.3.4-v5 - FIX Bug #3: Verify DOM cleanup - use shared utility
    if (removeQuickTabElement(quickTabId)) {
      console.log('[UICoordinator] Removed orphaned DOM element for:', quickTabId);
    }
    
    // v1.6.3.4-v10 - Also clear any pending snapshot
    if (this._hasMinimizedManager()) {
      this.minimizedManager.clearSnapshot(quickTabId);
    }

    console.log(`${this._logPrefix} Tab destroyed:`, quickTabId, '| mapSize:', this.renderedTabs.size);
  }

  /**
   * Clear all Quick Tabs from this tab context
   * v1.6.3.5-v8 - FIX Issue #6: Coordinated global destruction path
   * Clears renderedTabs, minimizedManager snapshots, and DOM elements
   * @param {string} source - Source of clear operation ('Manager', 'background', etc.)
   */
  clearAll(source = 'unknown') {
    console.log(`${this._logPrefix} clearAll() called (source: ${source}):`, {
      renderedTabsCount: this.renderedTabs.size,
      hasMinimizedManager: this._hasMinimizedManager()
    });
    
    const clearedIds = [];
    
    // Stop all DOM monitoring timers
    for (const id of this._domMonitoringTimers.keys()) {
      this._stopDOMMonitoring(id);
    }
    
    // Destroy all rendered tabs
    for (const [id, tabWindow] of this.renderedTabs) {
      clearedIds.push(id);
      if (tabWindow?.destroy) {
        tabWindow.destroy();
      }
      // Remove DOM element
      removeQuickTabElement(id);
    }
    
    // Clear the Map
    this.renderedTabs.clear();
    
    // Clear minimized manager
    if (this._hasMinimizedManager()) {
      this.minimizedManager.clear();
    }
    
    // Clear pending snapshot timers
    for (const timer of this._pendingSnapshotClears.values()) {
      clearTimeout(timer);
    }
    this._pendingSnapshotClears.clear();
    
    // Clear render timestamps
    this._renderTimestamps.clear();
    this._lastRenderTime.clear();
    
    // Reset z-index
    this._highestZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
    
    // Final DOM cleanup using shared utility
    cleanupOrphanedQuickTabElements(null);
    
    console.log(`${this._logPrefix} clearAll() complete (source: ${source}):`, {
      clearedIds,
      clearedCount: clearedIds.length
    });
  }

  /**
   * Setup state event listeners
   * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync)
   * v1.6.3.4-v4 - FIX Issue #3: Add state:cleared listener for reconciliation
   * v1.6.3.4-v2 - FIX Issue #6: Pass source and isRestoreOperation from events to update()
   * v1.6.3.5-v6 - FIX Diagnostic Issue #4: Add window:created listener for Map registration
   */
  setupStateListeners() {
    console.log('[UICoordinator] Setting up state listeners');

    // Listen to state changes and trigger UI updates
    this.eventBus.on('state:added', ({ quickTab }) => {
      console.log('[UICoordinator] Received state:added event', { quickTabId: quickTab.id });
      this.render(quickTab);
    });

    this.eventBus.on('state:updated', ({ quickTab, source }) => {
      // v1.6.3.4-v2 - FIX Issue #6: Extract source from event and pass to update()
      const eventSource = source || quickTab.source || 'unknown';
      // v1.6.3.4-v2 - FIX Issue #5: Extract isRestoreOperation flag if present
      const isRestoreOperation = quickTab.isRestoreOperation || false;
      console.log('[UICoordinator] Received state:updated event', { 
        quickTabId: quickTab.id,
        source: eventSource,
        isRestoreOperation 
      });
      this.update(quickTab, eventSource, isRestoreOperation);
    });

    this.eventBus.on('state:deleted', ({ id }) => {
      console.log('[UICoordinator] Received state:deleted event', { quickTabId: id });
      this.destroy(id);
    });

    // v1.6.3.4-v4 - FIX Issue #3: Listen for state:cleared to remove orphaned windows
    this.eventBus.on('state:cleared', () => {
      console.log('[UICoordinator] Received state:cleared event');
      this.reconcileRenderedTabs();
    });

    // v1.6.3.5-v6 - FIX Diagnostic Issue #4: Listen for window:created from CreateHandler
    // This ensures renderedTabs Map is populated when QuickTabWindows are created
    this.eventBus.on('window:created', ({ id, tabWindow }) => {
      console.log('[UICoordinator] Received window:created event', { id });
      this._registerCreatedWindow(id, tabWindow);
    });

    console.log('[UICoordinator] ✓ State listeners setup complete');
  }

  /**
   * Register a created window in renderedTabs Map
   * v1.6.3.5-v6 - FIX Diagnostic Issue #4: UICoordinator Map never populated
   * @private
   * @param {string} id - Quick Tab ID
   * @param {Object} tabWindow - QuickTabWindow instance
   */
  _registerCreatedWindow(id, tabWindow) {
    if (!id || !tabWindow) {
      console.warn('[UICoordinator] Invalid window:created event - missing id or tabWindow');
      return;
    }
    
    // Check if already in Map to avoid overwriting
    if (this.renderedTabs.has(id)) {
      console.log('[UICoordinator] Window already in renderedTabs Map:', id);
      return;
    }
    
    // Register window in Map
    this.renderedTabs.set(id, tabWindow);
    console.log('[UICoordinator] Registered window in renderedTabs from window:created:', {
      id,
      mapSizeAfter: this.renderedTabs.size,
      allMapKeys: Array.from(this.renderedTabs.keys())
    });
    
    // Start DOM monitoring for the newly registered window
    this._startDOMMonitoring(id, tabWindow);
  }

  /**
   * Find orphaned tab IDs in renderedTabs that are not in StateManager
   * v1.6.3.4-v11 - Extracted to reduce reconcileRenderedTabs bumpy road
   * @private
   * @param {Set<string>} stateTabIds - Valid tab IDs from StateManager
   * @returns {string[]} Array of orphaned tab IDs
   */
  _findOrphanedTabIds(stateTabIds) {
    const orphanedIds = [];
    for (const [id] of this.renderedTabs) {
      if (!stateTabIds.has(id)) {
        orphanedIds.push(id);
      }
    }
    return orphanedIds;
  }

  /**
   * Clean up renderedTabs Map entries not in valid state
   * v1.6.3.4-v11 - Extracted to reduce reconcileRenderedTabs bumpy road
   * @private
   * @param {Set<string>} stateTabIds - Valid tab IDs from StateManager
   */
  _cleanupStaleMapEntries(stateTabIds) {
    for (const [id] of this.renderedTabs) {
      if (!stateTabIds.has(id)) {
        this.renderedTabs.delete(id);
      }
    }
  }

  /**
   * Log reconciliation results
   * v1.6.3.4-v11 - Extracted to reduce reconcileRenderedTabs complexity
   * @private
   * @param {number} orphanedCount - Number of orphaned tabs destroyed
   * @param {number} cleanedCount - Number of DOM elements cleaned
   */
  _logReconciliationResults(orphanedCount, cleanedCount) {
    if (orphanedCount > 0 || cleanedCount > 0) {
      console.log(
        `[UICoordinator] Reconciled: destroyed ${orphanedCount} tracked + ${cleanedCount} orphaned DOM element(s)`
      );
    } else {
      console.log('[UICoordinator] Reconciled: no orphaned tabs found');
    }
  }

  /**
   * Reconcile rendered tabs with StateManager
   * v1.6.3.4-v4 - FIX Issue #3: Destroy orphaned tabs that exist in renderedTabs but not in StateManager
   * v1.6.3.4-v5 - FIX Bug #3: Also scan DOM for orphaned .quick-tab-window elements
   * v1.6.3.4-v11 - Refactored: extracted helpers to eliminate bumpy road pattern
   * This handles the case where "Close All" removes tabs from storage but duplicates remain visible
   */
  reconcileRenderedTabs() {
    console.log('[UICoordinator] Reconciling rendered tabs with StateManager');

    // Get all tab IDs from StateManager
    const stateTabIds = new Set(this.stateManager.getAll().map(qt => qt.id));

    // Find and destroy orphaned tabs (in renderedTabs but not in StateManager)
    const orphanedIds = this._findOrphanedTabIds(stateTabIds);
    orphanedIds.forEach(id => {
      console.log('[UICoordinator] Destroying orphaned tab:', id);
      this.destroy(id);
    });

    // v1.6.3.4-v5 - FIX Bug #3: Use shared utility for comprehensive DOM cleanup
    const cleanedCount = cleanupOrphanedQuickTabElements(stateTabIds);

    // Clean up renderedTabs for any elements that were removed
    this._cleanupStaleMapEntries(stateTabIds);

    this._logReconciliationResults(orphanedIds.length, cleanedCount);
  }

  /**
   * Destroy tabs that are no longer visible
   * v1.6.3.4-v11 - Extracted to reduce _refreshAllRenderedTabs bumpy road
   * @private
   * @param {Set<string>} visibleIds - Set of visible tab IDs
   */
  _destroyNonVisibleTabs(visibleIds) {
    for (const [id] of this.renderedTabs) {
      if (!visibleIds.has(id)) {
        console.log('[UICoordinator] Destroying no-longer-visible tab:', id);
        this.destroy(id);
      }
    }
  }

  /**
   * Update or render visible tabs
   * v1.6.3.4-v11 - Extracted to reduce _refreshAllRenderedTabs bumpy road
   * @private
   * @param {Array} visibleTabs - Array of visible QuickTab entities
   */
  _updateOrRenderVisibleTabs(visibleTabs) {
    for (const quickTab of visibleTabs) {
      if (this.renderedTabs.has(quickTab.id)) {
        console.log('[UICoordinator] Updating rendered tab:', quickTab.id);
        this.update(quickTab);
      } else {
        console.log('[UICoordinator] Rendering new visible tab:', quickTab.id);
        this.render(quickTab);
      }
    }
  }

  /**
   * Refresh all rendered tabs with latest state
   * v1.6.3.4-v11 - Refactored: extracted helpers to eliminate bumpy road pattern
   * @private
   */
  _refreshAllRenderedTabs() {
    // Get current visible Quick Tabs from state
    const visibleTabs = this.stateManager.getVisible();
    const visibleIds = new Set(visibleTabs.map(qt => qt.id));

    // Destroy tabs that should no longer be visible
    this._destroyNonVisibleTabs(visibleIds);

    // Update or render visible tabs
    this._updateOrRenderVisibleTabs(visibleTabs);
  }

  /**
   * Extract safe position values from QuickTab
   * v1.6.3.4-v3 - Helper to reduce complexity
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
   * v1.6.3.4-v3 - Helper to reduce complexity
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
   * v1.6.3.4-v5 - Helper for consistent zIndex handling
   * @private
   * @param {QuickTab} quickTab - QuickTab domain entity
   * @returns {number} Safe zIndex value
   */
  _getSafeZIndex(quickTab) {
    return quickTab.zIndex ?? CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
  }

  /**
   * Extract safe visibility values from QuickTab
   * v1.6.3.4-v3 - Helper to reduce complexity
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
   * v1.6.3.4-v3 - FIX TypeError: Add null safety checks for position/size access
   * v1.6.3.2 - Pass showDebugId setting to window
   * v1.6.3.4-v10 - FIX Issue #6A: Log entity property values before creating window
   * v1.6.3.5-v10 - FIX Issue #1-2: Include lifecycle callbacks for position/size/focus
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
    
    // v1.6.3.5-v10 - FIX Issue #1-2: Build callback options from handler references
    // These callbacks are CRITICAL for drag/resize persistence after restore
    const callbackOptions = this._buildCallbackOptions(quickTab.id);
    
    // v1.6.3.4-v10 - FIX Issue #6A: Log entity properties before creating window
    // v1.6.3.5-v10 - Also log callback status
    console.log('[UICoordinator] Creating window from entity, zIndex =', zIndex, ':', {
      id: quickTab.id,
      rawPosition: quickTab.position,
      rawSize: quickTab.size,
      safePosition: position,
      safeSize: size,
      visibility,
      zIndex,
      callbacksWired: {
        onPositionChangeEnd: !!callbackOptions.onPositionChangeEnd,
        onSizeChangeEnd: !!callbackOptions.onSizeChangeEnd,
        onFocus: !!callbackOptions.onFocus,
        onMinimize: !!callbackOptions.onMinimize,
        onClose: !!callbackOptions.onClose
      }
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
      showDebugId: this.showDebugIdSetting, // v1.6.3.2 - Pass debug ID display setting
      currentTabId: this.currentTabId, // v1.6.3.5-v10 - Pass for Solo/Mute
      // v1.6.3.5-v10 - FIX Issue #1-2: Include lifecycle callbacks
      ...callbackOptions
    });
  }
  
  /**
   * Build callback options for window creation
   * v1.6.3.5-v10 - FIX Issue #1-2: Extracted to reduce _createWindow complexity
   * Callbacks are bound to handler methods if handlers are available
   * @private
   * @param {string} quickTabId - Quick Tab ID for logging
   * @returns {Object} Callback options
   */
  _buildCallbackOptions(quickTabId) {
    const callbacks = {};
    
    // Build callbacks from each handler
    this._addUpdateHandlerCallbacks(callbacks);
    this._addVisibilityHandlerCallbacks(callbacks);
    this._addDestroyHandlerCallbacks(callbacks);
    
    // Log warnings for missing critical callbacks
    this._logMissingCallbacks(callbacks, quickTabId);
    
    return callbacks;
  }
  
  /**
   * Add UpdateHandler callbacks to callbacks object
   * v1.6.3.5-v10 - Extracted to reduce _buildCallbackOptions complexity
   * @private
   * @param {Object} callbacks - Callbacks object to populate
   */
  _addUpdateHandlerCallbacks(callbacks) {
    if (!this.updateHandler) return;
    
    const methods = [
      ['handlePositionChangeEnd', 'onPositionChangeEnd'],
      ['handleSizeChangeEnd', 'onSizeChangeEnd'],
      ['handlePositionChange', 'onPositionChange'],
      ['handleSizeChange', 'onSizeChange']
    ];
    
    for (const [handlerMethod, callbackName] of methods) {
      if (typeof this.updateHandler[handlerMethod] === 'function') {
        callbacks[callbackName] = this.updateHandler[handlerMethod].bind(this.updateHandler);
      }
    }
  }
  
  /**
   * Add VisibilityHandler callbacks to callbacks object
   * v1.6.3.5-v10 - Extracted to reduce _buildCallbackOptions complexity
   * @private
   * @param {Object} callbacks - Callbacks object to populate
   */
  _addVisibilityHandlerCallbacks(callbacks) {
    if (!this.visibilityHandler) return;
    
    if (typeof this.visibilityHandler.handleFocus === 'function') {
      callbacks.onFocus = this.visibilityHandler.handleFocus.bind(this.visibilityHandler);
    }
    if (typeof this.visibilityHandler.handleMinimize === 'function') {
      callbacks.onMinimize = (id) => this.visibilityHandler.handleMinimize(id, 'UI');
    }
  }
  
  /**
   * Add DestroyHandler callbacks to callbacks object
   * v1.6.3.5-v10 - Extracted to reduce _buildCallbackOptions complexity
   * @private
   * @param {Object} callbacks - Callbacks object to populate
   */
  _addDestroyHandlerCallbacks(callbacks) {
    if (!this.destroyHandler) return;
    
    if (typeof this.destroyHandler.handleDestroy === 'function') {
      callbacks.onDestroy = (id) => this.destroyHandler.handleDestroy(id, 'UI');
    } else if (typeof this.destroyHandler.closeById === 'function') {
      callbacks.onDestroy = this.destroyHandler.closeById.bind(this.destroyHandler);
    }
  }
  
  /**
   * Log warnings for missing critical callbacks
   * v1.6.3.5-v10 - Extracted to reduce _buildCallbackOptions complexity
   * @private
   * @param {Object} callbacks - Callbacks object to check
   * @param {string} quickTabId - Quick Tab ID for logging
   */
  _logMissingCallbacks(callbacks, quickTabId) {
    if (!callbacks.onPositionChangeEnd || !callbacks.onSizeChangeEnd) {
      console.warn(`${this._logPrefix} WARNING: Position/Size callbacks not wired for ${quickTabId}:`, {
        hasUpdateHandler: !!this.updateHandler,
        onPositionChangeEnd: !!callbacks.onPositionChangeEnd,
        onSizeChangeEnd: !!callbacks.onSizeChangeEnd
      });
    }
    
    if (!callbacks.onFocus) {
      console.warn(`${this._logPrefix} WARNING: Focus callback not wired for ${quickTabId}:`, {
        hasVisibilityHandler: !!this.visibilityHandler,
        onFocus: !!callbacks.onFocus
      });
    }
  }
}
