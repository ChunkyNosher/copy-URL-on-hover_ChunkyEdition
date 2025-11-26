/**
 * StateManager - Manages local in-memory Quick Tab state
 * Phase 2.1: Extracted from QuickTabsManager
 * v1.6.2.2 - ISSUE #35/#51 FIX: Removed container filtering for global visibility
 *
 * Responsibilities:
 * - Maintain Map of QuickTab instances
 * - Add/update/delete Quick Tabs
 * - Query Quick Tabs by ID or criteria
 * - Hydrate state from storage
 * - Track current tab ID for visibility filtering
 *
 * Uses:
 * - QuickTab domain entities (not QuickTabWindow UI components)
 * - Map for O(1) lookups
 */

import { QuickTab } from '@domain/QuickTab.js';

export class StateManager {
  constructor(eventBus, currentTabId = null) {
    this.eventBus = eventBus;
    this.currentTabId = currentTabId;
    // v1.6.2.2 - REMOVED: currentContainer for global visibility (Issue #35, #51, #47)

    // In-memory state: Map<id, QuickTab>
    this.quickTabs = new Map();

    // v1.6.1.5 - Pending updates queue for Quick Tabs that don't exist yet
    // Map<id, Array<{type, data, timestamp}>>
    this.pendingUpdates = new Map();

    // Z-index management
    this.currentZIndex = 10000; // Base z-index from CONSTANTS
  }

  /**
   * Add Quick Tab to state
   * v1.6.1.5 - Apply pending updates after adding
   * 
   * @param {QuickTab} quickTab - QuickTab domain entity
   */
  add(quickTab) {
    if (!(quickTab instanceof QuickTab)) {
      throw new Error('StateManager.add() requires QuickTab instance');
    }

    this.quickTabs.set(quickTab.id, quickTab);
    
    // v1.6.1.5 - Apply any pending updates for this Quick Tab
    this._applyPendingUpdates(quickTab.id);
    
    this.eventBus?.emit('state:added', quickTab);

    console.log(`[StateManager] Added Quick Tab: ${quickTab.id}`);
  }

  /**
   * Add Quick Tab to state WITHOUT emitting events (Bug #1 Fix - Lazy Rendering)
   * v1.6.2.3 - Added to support lazy rendering pattern
   * 
   * Use this when hydrating state from storage to prevent automatic rendering.
   * Quick Tabs added silently are stored in memory but not rendered until
   * explicitly requested via user action (keyboard shortcut, context menu, manager panel).
   * 
   * @param {QuickTab} quickTab - QuickTab domain entity
   */
  addSilent(quickTab) {
    if (!(quickTab instanceof QuickTab)) {
      throw new Error('StateManager.addSilent() requires QuickTab instance');
    }

    this.quickTabs.set(quickTab.id, quickTab);
    
    // v1.6.2.3 - Still apply pending updates for consistency
    this._applyPendingUpdates(quickTab.id);
    
    // NO event emission - this is the key difference from add()
    console.log(`[StateManager] Added Quick Tab silently (no render): ${quickTab.id}`);
  }

  /**
   * Get Quick Tab by ID
   * @param {string} id - Quick Tab ID
   * @returns {QuickTab|undefined} - Quick Tab instance or undefined
   */
  get(id) {
    return this.quickTabs.get(id);
  }

  /**
   * Check if Quick Tab exists
   * @param {string} id - Quick Tab ID
   * @returns {boolean} - True if exists
   */
  has(id) {
    return this.quickTabs.has(id);
  }

  /**
   * Update Quick Tab
   * @param {QuickTab} quickTab - Updated QuickTab domain entity
   */
  update(quickTab) {
    if (!(quickTab instanceof QuickTab)) {
      throw new Error('StateManager.update() requires QuickTab instance');
    }

    if (!this.quickTabs.has(quickTab.id)) {
      console.warn(`[StateManager] Cannot update non-existent Quick Tab: ${quickTab.id}`);
      return;
    }

    this.quickTabs.set(quickTab.id, quickTab);
    this.eventBus?.emit('state:updated', quickTab);

    console.log(`[StateManager] Updated Quick Tab: ${quickTab.id}`);
  }

  /**
   * Delete Quick Tab from state
   * @param {string} id - Quick Tab ID
   * @returns {boolean} - True if deleted
   */
  delete(id) {
    const quickTab = this.quickTabs.get(id);
    const deleted = this.quickTabs.delete(id);

    if (deleted) {
      this.eventBus?.emit('state:deleted', quickTab);
      console.log(`[StateManager] Deleted Quick Tab: ${id}`);
    }

    return deleted;
  }

  /**
   * Get all Quick Tabs
   * @returns {Array<QuickTab>} - Array of all Quick Tabs
   */
  getAll() {
    return Array.from(this.quickTabs.values());
  }

  /**
   * Get visible Quick Tabs based on current tab ID
   * @returns {Array<QuickTab>} - Array of visible Quick Tabs
   */
  getVisible() {
    if (!this.currentTabId) {
      // No filtering if current tab ID unknown
      return this.getAll();
    }

    return this.getAll().filter(qt => qt.shouldBeVisible(this.currentTabId));
  }

  /**
   * Get minimized Quick Tabs
   * @returns {Array<QuickTab>} - Array of minimized Quick Tabs
   */
  getMinimized() {
    return this.getAll().filter(qt => qt.visibility.minimized);
  }

  // v1.6.2.2 - REMOVED: getByContainer() method
  // Container filtering removed for global visibility (Issue #35, #51, #47)

  /**
   * Hydrate state from array of QuickTab entities
   * v1.6.1 - CRITICAL FIX: Track additions, updates, and deletions to emit proper events
   * v1.6.2.2 - ISSUE #35 FIX: Enhanced logging for cross-tab sync debugging
   * v1.6.2.x - ISSUE #51 FIX: Detect and emit position/size/zIndex changes for cross-tab sync
   * This ensures UI coordinator knows about deletions and removes Quick Tabs that no longer exist
   * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
   * @param {Object} options - Hydration options
   * @param {boolean} [options.detectChanges=false] - Whether to detect and emit position/size/zIndex changes
   */
  hydrate(quickTabs, options = {}) {
    if (!Array.isArray(quickTabs)) {
      throw new Error('StateManager.hydrate() requires array of QuickTab instances');
    }

    const { detectChanges = false } = options;
    const context = this._getContext();

    console.log('[StateManager] Hydrate called', {
      context: context.type,
      tabUrl: context.url,
      incomingCount: quickTabs.length,
      existingCount: this.quickTabs.size,
      detectChanges,
      timestamp: Date.now()
    });

    // Process adds and updates
    const existingIds = new Set(this.quickTabs.keys());
    const result = this._processIncomingQuickTabs(quickTabs, existingIds, detectChanges);

    // Detect and emit deletions
    const deletedCount = this._processDeletedQuickTabs(existingIds, result.incomingIds);

    // v1.6.2.x - ISSUE #51 FIX: Emit change events for position/size/zIndex updates
    this._emitQuickTabChanges(result.changes, context.type);

    this.eventBus?.emit('state:hydrated', { count: quickTabs.length });
    
    console.log('[StateManager] ✓ Hydrate complete', {
      context: context.type,
      tabUrl: context.url,
      added: result.addedCount,
      updated: result.updatedCount,
      deleted: deletedCount,
      changesDetected: result.changes.length,
      totalNow: this.quickTabs.size
    });
  }

  /**
   * Hydrate state from array of QuickTab entities WITHOUT emitting events (Bug #1 Fix)
   * v1.6.2.3 - Added to support lazy rendering pattern
   * 
   * Use this for initial page load to prevent automatic rendering of ALL Quick Tabs.
   * Quick Tabs are loaded into memory but NOT rendered until explicitly requested
   * via user action (keyboard shortcut, context menu, or Quick Tab Manager panel).
   * 
   * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
   */
  hydrateSilent(quickTabs) {
    if (!Array.isArray(quickTabs)) {
      throw new Error('StateManager.hydrateSilent() requires array of QuickTab instances');
    }

    const context = this._getContext();
    let addedCount = 0;

    console.log('[StateManager] HydrateSilent called (lazy load - no rendering)', {
      context: context.type,
      tabUrl: context.url,
      incomingCount: quickTabs.length,
      existingCount: this.quickTabs.size,
      timestamp: Date.now()
    });

    for (const qt of quickTabs) {
      if (!(qt instanceof QuickTab)) {
        console.warn('[StateManager] Skipping non-QuickTab instance during silent hydration');
        continue;
      }

      // Only add if doesn't exist already (don't overwrite)
      if (!this.quickTabs.has(qt.id)) {
        this.addSilent(qt);
        addedCount++;
      }
    }

    console.log('[StateManager] ✓ HydrateSilent complete (no Quick Tabs rendered)', {
      context: context.type,
      tabUrl: context.url,
      added: addedCount,
      totalNow: this.quickTabs.size
    });
  }

  /**
   * Get context info for logging
   * @private
   * @returns {Object} Context info
   */
  _getContext() {
    return {
      type: typeof window !== 'undefined' ? 'content-script' : 'background',
      url: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A'
    };
  }

  /**
   * Process incoming Quick Tabs for adds and updates
   * v1.6.2.x - Extracted to reduce hydrate() complexity
   * @private
   * @param {Array<QuickTab>} quickTabs - Incoming Quick Tabs
   * @param {Set} existingIds - Set of existing Quick Tab IDs
   * @param {boolean} detectChanges - Whether to detect changes
   * @returns {Object} Processing result with counts and changes
   */
  _processIncomingQuickTabs(quickTabs, existingIds, detectChanges) {
    const incomingIds = new Set();
    const changes = [];
    let addedCount = 0;
    let updatedCount = 0;

    for (const qt of quickTabs) {
      if (!(qt instanceof QuickTab)) {
        console.warn('[StateManager] Skipping non-QuickTab instance during hydration');
        continue;
      }

      incomingIds.add(qt.id);

      if (existingIds.has(qt.id)) {
        const changeInfo = this._processExistingQuickTab(qt, detectChanges);
        if (changeInfo) {
          changes.push(changeInfo);
        }
        updatedCount++;
      } else {
        this._processNewQuickTab(qt);
        addedCount++;
      }
    }

    return { incomingIds, changes, addedCount, updatedCount };
  }

  /**
   * Process an existing Quick Tab (update)
   * @private
   * @param {QuickTab} qt - Quick Tab to process
   * @param {boolean} detectChanges - Whether to detect changes
   * @returns {Object|null} Change info or null
   */
  _processExistingQuickTab(qt, detectChanges) {
    const previous = this.quickTabs.get(qt.id);
    let changeInfo = null;

    if (detectChanges && previous) {
      changeInfo = this._detectQuickTabChanges(previous, qt);
    }

    this.quickTabs.set(qt.id, qt);
    this.eventBus?.emit('state:updated', { quickTab: qt });

    return changeInfo;
  }

  /**
   * Process a new Quick Tab (add)
   * @private
   * @param {QuickTab} qt - Quick Tab to add
   */
  _processNewQuickTab(qt) {
    this.quickTabs.set(qt.id, qt);
    console.log('[StateManager] Hydrate: emitting state:added', {
      quickTabId: qt.id,
      context: typeof window !== 'undefined' ? 'content-script' : 'background'
    });
    this.eventBus?.emit('state:added', { quickTab: qt });
  }

  /**
   * Process deleted Quick Tabs
   * @private
   * @param {Set} existingIds - Set of existing Quick Tab IDs
   * @param {Set} incomingIds - Set of incoming Quick Tab IDs
   * @returns {number} Number of deleted Quick Tabs
   */
  _processDeletedQuickTabs(existingIds, incomingIds) {
    let deletedCount = 0;

    for (const existingId of existingIds) {
      if (!incomingIds.has(existingId)) {
        const deletedQuickTab = this.quickTabs.get(existingId);
        this.quickTabs.delete(existingId);
        this.eventBus?.emit('state:deleted', { id: existingId, quickTab: deletedQuickTab });
        console.log(`[StateManager] Detected deleted Quick Tab: ${existingId}`);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Emit change events for Quick Tab position/size/zIndex updates
   * v1.6.2.x - ISSUE #51 FIX: Extracted to reduce hydrate() complexity
   * @private
   * @param {Array} changes - Array of change info objects
   * @param {string} context - Context type for logging
   */
  _emitQuickTabChanges(changes, context) {
    for (const change of changes) {
      console.log('[StateManager] Emitting state:quicktab:changed', {
        quickTabId: change.quickTab.id,
        changes: change.changes,
        context
      });
      this.eventBus?.emit('state:quicktab:changed', {
        quickTab: change.quickTab,
        changes: change.changes
      });
    }
  }

  /**
   * Detect position/size/zIndex changes between two Quick Tab instances
   * v1.6.2.x - ISSUE #51 FIX: Helper for cross-tab sync change detection
   * 
   * @private
   * @param {QuickTab} previous - Previous Quick Tab state
   * @param {QuickTab} current - Current Quick Tab state
   * @returns {Object|null} Change info or null if no changes
   */
  _detectQuickTabChanges(previous, current) {
    const positionChanged = 
      previous.position.left !== current.position.left ||
      previous.position.top !== current.position.top;
    
    const sizeChanged = 
      previous.size.width !== current.size.width ||
      previous.size.height !== current.size.height;
    
    const zIndexChanged = previous.zIndex !== current.zIndex;
    
    if (positionChanged || sizeChanged || zIndexChanged) {
      return {
        quickTab: current,
        changes: {
          position: positionChanged,
          size: sizeChanged,
          zIndex: zIndexChanged
        }
      };
    }
    
    return null;
  }

  /**
   * Clear all Quick Tabs
   */
  clear() {
    const count = this.quickTabs.size;
    this.quickTabs.clear();
    this.currentZIndex = 10000; // Reset z-index

    this.eventBus?.emit('state:cleared', { count });
    console.log(`[StateManager] Cleared ${count} Quick Tabs`);
  }

  /**
   * Get count of Quick Tabs
   * @returns {number} - Number of Quick Tabs
   */
  count() {
    return this.quickTabs.size;
  }

  /**
   * Update current tab ID for visibility filtering
   * @param {number} tabId - Firefox tab ID
   */
  setCurrentTabId(tabId) {
    this.currentTabId = tabId;
    console.log(`[StateManager] Current tab ID set to: ${tabId}`);
  }

  /**
   * Get next z-index for new Quick Tab
   * @returns {number} - Next z-index value
   */
  getNextZIndex() {
    this.currentZIndex += 1;
    return this.currentZIndex;
  }

  /**
   * Update Quick Tab z-index
   * @param {string} id - Quick Tab ID
   * @param {number} zIndex - New z-index
   */
  updateZIndex(id, zIndex) {
    const quickTab = this.quickTabs.get(id);
    if (quickTab) {
      quickTab.updateZIndex(zIndex);
      this.quickTabs.set(id, quickTab);

      // Track highest z-index
      if (zIndex > this.currentZIndex) {
        this.currentZIndex = zIndex;
      }
    }
  }

  /**
   * Bring Quick Tab to front
   * @param {string} id - Quick Tab ID
   */
  bringToFront(id) {
    const nextZIndex = this.getNextZIndex();
    this.updateZIndex(id, nextZIndex);
    this.eventBus?.emit('state:z-index-changed', { id, zIndex: nextZIndex });
  }

  /**
   * Clean up dead tab IDs from solo/mute arrays
   * @param {Array<number>} activeTabIds - Array of currently active tab IDs
   */
  cleanupDeadTabs(activeTabIds) {
    let cleaned = 0;

    for (const quickTab of this.quickTabs.values()) {
      const before =
        quickTab.visibility.soloedOnTabs.length + quickTab.visibility.mutedOnTabs.length;
      quickTab.cleanupDeadTabs(activeTabIds);
      const after =
        quickTab.visibility.soloedOnTabs.length + quickTab.visibility.mutedOnTabs.length;

      if (before !== after) {
        this.quickTabs.set(quickTab.id, quickTab);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[StateManager] Cleaned dead tabs from ${cleaned} Quick Tabs`);
      this.eventBus?.emit('state:cleaned', { count: cleaned });
    }
  }

  /**
   * Queue update for Quick Tab that doesn't exist yet
   * v1.6.1.5 - Critical fix for position/size update race conditions
   * 
   * When updates arrive before CREATE (due to async timing), queue them
   * and apply when Quick Tab is created
   * 
   * @param {string} id - Quick Tab ID
   * @param {Object} update - Update data {type, data}
   */
  queuePendingUpdate(id, update) {
    if (!this.pendingUpdates.has(id)) {
      this.pendingUpdates.set(id, []);
    }

    this.pendingUpdates.get(id).push({
      ...update,
      timestamp: Date.now()
    });

    console.log(`[StateManager] Queued pending update for ${id}:`, update.type);
    this.eventBus?.emit('state:update-queued', { id, update });
  }

  /**
   * Apply pending updates to Quick Tab
   * v1.6.1.5 - Apply queued updates in chronological order
   * 
   * @private
   * @param {string} id - Quick Tab ID
   */
  _applyPendingUpdates(id) {
    const updates = this.pendingUpdates.get(id);
    if (!updates || updates.length === 0) {
      return;
    }

    // Sort by timestamp (should already be in order, but ensure it)
    updates.sort((a, b) => a.timestamp - b.timestamp);

    const quickTab = this.quickTabs.get(id);
    if (!quickTab) {
      console.warn(`[StateManager] Cannot apply pending updates - Quick Tab ${id} not found`);
      return;
    }

    // Apply all updates in order
    for (const update of updates) {
      try {
        this._applyUpdate(quickTab, update);
      } catch (err) {
        console.error('[StateManager] Error applying pending update:', err, update);
      }
    }

    // Clear pending updates
    this.pendingUpdates.delete(id);

    console.log(`[StateManager] Applied ${updates.length} pending updates to ${id}`);
    this.eventBus?.emit('state:pending-applied', { id, count: updates.length });
  }

  /**
   * Apply single update to Quick Tab
   * v1.6.1.5 - Helper to apply update based on type (using lookup pattern)
   * 
   * @private
   * @param {QuickTab} quickTab - Quick Tab to update
   * @param {Object} update - Update {type, data}
   */
  _applyUpdate(quickTab, update) {
    const { type, data } = update;

    // Lookup table pattern to reduce complexity
    const updateHandlers = {
      position: () => this._applyPositionUpdate(quickTab, data),
      size: () => this._applySizeUpdate(quickTab, data),
      minimize: () => this._applyMinimizeUpdate(quickTab, data),
      solo: () => this._applySoloUpdate(quickTab, data),
      mute: () => this._applyMuteUpdate(quickTab, data)
    };

    const handler = updateHandlers[type];
    if (handler) {
      handler();
    } else {
      console.warn(`[StateManager] Unknown update type: ${type}`);
    }
  }

  /** @private */
  _applyPositionUpdate(quickTab, data) {
    if (data.left !== undefined && data.top !== undefined) {
      quickTab.updatePosition(data.left, data.top);
    }
  }

  /** @private */
  _applySizeUpdate(quickTab, data) {
    if (data.width !== undefined && data.height !== undefined) {
      quickTab.updateSize(data.width, data.height);
    }
  }

  /** @private */
  _applyMinimizeUpdate(quickTab, data) {
    if (data.minimized !== undefined) {
      quickTab.setMinimized(data.minimized);
    }
  }

  /** @private */
  _applySoloUpdate(quickTab, data) {
    if (data.soloedOnTabs !== undefined) {
      quickTab.visibility.soloedOnTabs = [...data.soloedOnTabs];
      quickTab.lastModified = Date.now();
    }
  }

  /** @private */
  _applyMuteUpdate(quickTab, data) {
    if (data.mutedOnTabs !== undefined) {
      quickTab.visibility.mutedOnTabs = [...data.mutedOnTabs];
      quickTab.lastModified = Date.now();
    }
  }

  /**
   * Update Quick Tab with pending queue support
   * v1.6.1.5 - Queue update if Quick Tab doesn't exist
   * 
   * @param {string} id - Quick Tab ID
   * @param {string} type - Update type (position, size, minimize, etc.)
   * @param {Object} data - Update data
   */
  updateWithQueue(id, type, data) {
    const quickTab = this.quickTabs.get(id);

    if (!quickTab) {
      // Quick Tab doesn't exist yet - queue the update
      this.queuePendingUpdate(id, { type, data });
      return;
    }

    // Quick Tab exists - apply update immediately
    try {
      this._applyUpdate(quickTab, { type, data });
      this.quickTabs.set(id, quickTab);
      this.eventBus?.emit('state:updated', { quickTab });
    } catch (err) {
      console.error('[StateManager] Error applying update:', err);
    }
  }
}
