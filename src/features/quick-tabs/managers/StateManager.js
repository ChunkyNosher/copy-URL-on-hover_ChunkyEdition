/**
 * StateManager - Manages local in-memory Quick Tab state
 * Phase 2.1: Extracted from QuickTabsManager
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

    // In-memory state: Map<id, QuickTab>
    this.quickTabs = new Map();

    // Z-index management
    this.currentZIndex = 10000; // Base z-index from CONSTANTS
  }

  /**
   * Add Quick Tab to state
   * @param {QuickTab} quickTab - QuickTab domain entity
   */
  add(quickTab) {
    if (!(quickTab instanceof QuickTab)) {
      throw new Error('StateManager.add() requires QuickTab instance');
    }

    this.quickTabs.set(quickTab.id, quickTab);
    this.eventBus?.emit('state:added', quickTab);

    console.log(`[StateManager] Added Quick Tab: ${quickTab.id}`);
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

  /**
   * Get Quick Tabs for specific container
   * @param {string} cookieStoreId - Container ID
   * @returns {Array<QuickTab>} - Array of Quick Tabs for container
   */
  getByContainer(cookieStoreId) {
    return this.getAll().filter(qt => qt.belongsToContainer(cookieStoreId));
  }

  /**
   * Hydrate state from array of QuickTab entities
   * v1.6.1 - CRITICAL FIX: Track additions, updates, and deletions to emit proper events
   * This ensures UI coordinator knows about deletions and removes Quick Tabs that no longer exist
   * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
   */
  hydrate(quickTabs) {
    if (!Array.isArray(quickTabs)) {
      throw new Error('StateManager.hydrate() requires array of QuickTab instances');
    }

    // Track existing IDs to detect deletions
    const existingIds = new Set(this.quickTabs.keys());
    const incomingIds = new Set();

    // Process incoming Quick Tabs (adds and updates)
    for (const qt of quickTabs) {
      if (!(qt instanceof QuickTab)) {
        console.warn('[StateManager] Skipping non-QuickTab instance during hydration');
        continue;
      }

      incomingIds.add(qt.id);

      if (existingIds.has(qt.id)) {
        // Existing Quick Tab - update it
        this.quickTabs.set(qt.id, qt);
        this.eventBus?.emit('state:updated', { quickTab: qt });
      } else {
        // New Quick Tab - add it
        this.quickTabs.set(qt.id, qt);
        this.eventBus?.emit('state:added', { quickTab: qt });
      }
    }

    // Detect deletions (existed before but not in incoming data)
    for (const existingId of existingIds) {
      if (!incomingIds.has(existingId)) {
        // Quick Tab was deleted
        const deletedQuickTab = this.quickTabs.get(existingId);
        this.quickTabs.delete(existingId);
        this.eventBus?.emit('state:deleted', { id: existingId, quickTab: deletedQuickTab });
        console.log(`[StateManager] Detected deleted Quick Tab: ${existingId}`);
      }
    }

    this.eventBus?.emit('state:hydrated', { count: quickTabs.length });
    console.log(`[StateManager] Hydrated ${quickTabs.length} Quick Tabs (${incomingIds.size - existingIds.size} added, ${existingIds.size - incomingIds.size} deleted)`);
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
