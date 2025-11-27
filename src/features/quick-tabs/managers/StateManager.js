/**
 * StateManager - Manages local in-memory Quick Tab state
 * Phase 2.1: Extracted from QuickTabsManager
 * v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync or storage persistence)
 *
 * Responsibilities:
 * - Maintain Map of QuickTab instances
 * - Add/update/delete Quick Tabs
 * - Query Quick Tabs by ID or criteria
 * - Track current tab ID for visibility filtering
 * - Assign global slots to Quick Tabs
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

    // In-memory state: Map<id, QuickTab>
    this.quickTabs = new Map();

    // Z-index management
    this.currentZIndex = 10000; // Base z-index from CONSTANTS
  }

  /**
   * Add Quick Tab to state
   * v1.6.3 - Assign global slot if not already assigned
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
    this.eventBus?.emit('state:updated', { quickTab });

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
      this.eventBus?.emit('state:deleted', { id, quickTab });
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
}
