/**
 * StateManager - Manages local in-memory Quick Tab state
 * Phase 2.1: Extracted from QuickTabsManager
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync or storage persistence)
 * v1.6.3.1 - Added persistToStorage() for sidebar/manager sync
 * v1.6.3.5-v5 - FIX Issue #3: Use persistStateToStorage instead of direct browser.storage.local.set
 *
 * Responsibilities:
 * - Maintain Map of QuickTab instances
 * - Add/update/delete Quick Tabs
 * - Query Quick Tabs by ID or criteria
 * - Track current tab ID for visibility filtering
 * - Assign global slots to Quick Tabs
 * - Persist state to browser.storage.local via storage-utils (single pipeline)
 *
 * Uses:
 * - QuickTab domain entities (not QuickTabWindow UI components)
 * - Map for O(1) lookups
 */

import { persistStateToStorage, generateSaveId } from '@utils/storage-utils.js';

import { QuickTab } from '@domain/QuickTab.js';

export class StateManager {
  constructor(eventBus, currentTabId = null) {
    this.eventBus = eventBus;
    this.currentTabId = currentTabId;

    // In-memory state: Map<id, QuickTab>
    this.quickTabs = new Map();

    // Z-index management
    this.currentZIndex = 10000; // Base z-index from CONSTANTS
  }

  /**
   * Persist current state to browser.storage.local
   * v1.6.3.1 - New method for sidebar/manager sync
   * v1.6.3.5-v5 - FIX Issue #3: Route through persistStateToStorage instead of direct write
   *   This consolidates all persistence through one pipeline with consistent transaction
   *   tracking, validation, and queuing - preventing parallel persistence conflicts.
   * v1.6.3.5-v7 - FIX Issue #5: Add comprehensive logging with timing, source, and state snapshot
   * 
   * Writes unified format (v1.6.2.2+):
   * { tabs: [...], saveId: '...', timestamp: ..., transactionId: ... }
   * 
   * @param {string} [source='unknown'] - Source of persist operation for logging
   */
  async persistToStorage(source = 'unknown') {
    const startTime = Date.now();
    
    try {
      const tabs = this.getAll().map(qt => qt.serialize());
      const state = {
        tabs: tabs,
        timestamp: Date.now(),
        saveId: generateSaveId()
      };

      // v1.6.3.5-v7 - FIX Issue #5: Comprehensive logging before persist
      console.log('[StateManager] persistToStorage() starting:', {
        source,
        tabCount: tabs.length,
        saveId: state.saveId,
        minimizedCount: tabs.filter(t => t.minimized).length,
        activeCount: tabs.filter(t => !t.minimized).length,
        tabIds: tabs.map(t => t.id).slice(0, 5), // First 5 IDs for debugging
        timestamp: state.timestamp
      });

      // v1.6.3.5-v5 - FIX Issue #3: Use centralized persistStateToStorage instead of direct write
      // This ensures all storage writes have transaction IDs, respect FIFO queue,
      // use hash deduplication, and validate ownership.
      const success = await persistStateToStorage(state, '[StateManager]');
      
      const duration = Date.now() - startTime;
      
      if (success) {
        console.log(`[StateManager] Persisted ${tabs.length} Quick Tabs to storage:`, {
          source,
          saveId: state.saveId,
          durationMs: duration,
          success: true
        });
      } else {
        console.warn('[StateManager] Storage persist returned false:', {
          source,
          saveId: state.saveId,
          durationMs: duration,
          success: false,
          reason: 'may have been skipped/blocked'
        });
      }
      
      return success;
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error('[StateManager] Failed to persist to storage:', {
        source,
        durationMs: duration,
        error: err.message,
        stack: err.stack
      });
      return false;
    }
  }

  /**
   * Add Quick Tab to state
   * v1.6.3 - Assign global slot if not already assigned
   * v1.6.3.1 - Persist to storage for cross-context sync
   * 
   * @param {QuickTab} quickTab - QuickTab domain entity
   */
  add(quickTab) {
    if (!(quickTab instanceof QuickTab)) {
      throw new Error('StateManager.add() requires QuickTab instance');
    }

    // Assign global slot if not already assigned
    if (quickTab.slot === null || quickTab.slot === undefined) {
      quickTab.slot = this.assignGlobalSlot();
      console.log(`[StateManager] Assigned slot ${quickTab.slot} to Quick Tab: ${quickTab.id}`);
    }

    this.quickTabs.set(quickTab.id, quickTab);
    
    this.eventBus?.emit('state:added', { quickTab });

    console.log(`[StateManager] Added Quick Tab: ${quickTab.id} (slot: ${quickTab.slot})`);

    // v1.6.3.1 - Persist to storage for sidebar/manager sync (fire-and-forget for UI responsiveness)
    this.persistToStorage().catch(() => { /* errors logged in persistToStorage */ });
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
   * v1.6.3.1 - Persist to storage for cross-context sync
   * 
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
    this.eventBus?.emit('state:updated', { quickTab });

    console.log(`[StateManager] Updated Quick Tab: ${quickTab.id}`);

    // v1.6.3.1 - Persist to storage for sidebar/manager sync (fire-and-forget for UI responsiveness)
    this.persistToStorage().catch(() => { /* errors logged in persistToStorage */ });
  }

  /**
   * Delete Quick Tab from state
   * v1.6.3.1 - Persist to storage for cross-context sync
   * 
   * @param {string} id - Quick Tab ID
   * @returns {boolean} - True if deleted
   */
  delete(id) {
    const quickTab = this.quickTabs.get(id);
    const deleted = this.quickTabs.delete(id);

    if (deleted) {
      this.eventBus?.emit('state:deleted', { id, quickTab });
      console.log(`[StateManager] Deleted Quick Tab: ${id}`);

      // v1.6.3.1 - Persist to storage for sidebar/manager sync (fire-and-forget for UI responsiveness)
      this.persistToStorage().catch(() => { /* errors logged in persistToStorage */ });
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

  /**
   * Get Quick Tab by slot number
   * 
   * @param {number} slot - Slot number to find
   * @returns {QuickTab|undefined} - Quick Tab with matching slot or undefined
   */
  getBySlot(slot) {
    for (const qt of this.quickTabs.values()) {
      if (qt.slot === slot) {
        return qt;
      }
    }
    return undefined;
  }

  /**
   * Assign global slot to a new Quick Tab
   * 
   * Scans all existing Quick Tabs and returns the lowest available slot number.
   * Slot numbers start at 1 and are never reused until the Quick Tab is deleted.
   * 
   * @returns {number} - Next available slot number (1, 2, 3, ...)
   */
  assignGlobalSlot() {
    const occupiedSlots = new Set();
    
    // Collect all occupied slots
    for (const qt of this.quickTabs.values()) {
      if (qt.slot !== null && qt.slot !== undefined) {
        occupiedSlots.add(qt.slot);
      }
    }
    
    // Find first available slot (starting from 1)
    let slot = 1;
    while (occupiedSlots.has(slot)) {
      slot++;
    }
    
    console.log(`[StateManager] Assigned global slot: ${slot}`);
    return slot;
  }

  /**
   * Clear all Quick Tabs
   * v1.6.3.1 - Persist to storage for cross-context sync
   */
  clear() {
    const count = this.quickTabs.size;
    this.quickTabs.clear();
    this.currentZIndex = 10000; // Reset z-index

    this.eventBus?.emit('state:cleared', { count });
    console.log(`[StateManager] Cleared ${count} Quick Tabs`);

    // v1.6.3.1 - Persist to storage for sidebar/manager sync (fire-and-forget for UI responsiveness)
    this.persistToStorage().catch(() => { /* errors logged in persistToStorage */ });
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
   * v1.6.3.5-v7 - FIX Issue #8: Add storage persistence after z-index updates
   * @param {string} id - Quick Tab ID
   * @param {number} zIndex - New z-index
   */
  updateZIndex(id, zIndex) {
    const startTime = Date.now();
    const quickTab = this.quickTabs.get(id);
    if (quickTab) {
      const oldZIndex = quickTab.zIndex;
      quickTab.updateZIndex(zIndex);
      this.quickTabs.set(id, quickTab);

      // Track highest z-index
      if (zIndex > this.currentZIndex) {
        this.currentZIndex = zIndex;
      }
      
      // v1.6.3.5-v7 - FIX Issue #5: Comprehensive logging for state transitions
      console.log('[StateManager] Z-index updated:', {
        id,
        oldZIndex,
        newZIndex: zIndex,
        currentHighest: this.currentZIndex,
        durationMs: Date.now() - startTime
      });
      
      // v1.6.3.5-v7 - FIX Issue #8: Persist to storage after z-index update
      this.persistToStorage('z-index-update').catch(() => { /* errors logged in persistToStorage */ });
    }
  }

  /**
   * Bring Quick Tab to front
   * v1.6.3.5-v7 - FIX Issue #5: Add comprehensive logging
   * @param {string} id - Quick Tab ID
   */
  bringToFront(id) {
    const startTime = Date.now();
    console.log('[StateManager] bringToFront() called:', { id, currentZIndex: this.currentZIndex });
    
    const nextZIndex = this.getNextZIndex();
    this.updateZIndex(id, nextZIndex);
    this.eventBus?.emit('state:z-index-changed', { id, zIndex: nextZIndex });
    
    console.log('[StateManager] bringToFront() complete:', {
      id,
      newZIndex: nextZIndex,
      durationMs: Date.now() - startTime
    });
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
}
