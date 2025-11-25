/**
 * SyncCoordinator - Coordinates storage-based cross-tab synchronization
 * v1.6.2 - MIGRATION: Uses storage.onChanged exclusively (BroadcastChannel removed)
 *
 * Responsibilities:
 * - Handle storage.onChanged events for cross-tab sync
 * - Coordinate storage ↔ state sync
 * - Ignore own storage changes to prevent loops
 * - Handle cross-tab communication via storage events
 *
 * Migration Notes (v1.6.2):
 * - Removed BroadcastManager dependency
 * - Cross-tab sync now handled exclusively via storage.onChanged
 * - storage.onChanged fires in ALL OTHER tabs (not the tab that made the change)
 * - Handlers now write directly to storage, which triggers sync to other tabs
 *
 * Architecture:
 * Tab A writes to storage.local → storage.onChanged fires in Tab B, C, D
 * Tab A updates local UI immediately (no storage event for self)
 *
 * Complexity: cc ≤ 3 per method
 */

import { QuickTab } from '@domain/QuickTab.js';

export class SyncCoordinator {
  // Deduplication constants
  static DEDUP_TTL_MS = 30000;        // 30 second TTL for processed messages
  static DEDUP_CLEANUP_INTERVAL_MS = 5000; // Clean up every 5 seconds

  /**
   * @param {StateManager} stateManager - State manager instance
   * @param {StorageManager} storageManager - Storage manager instance
   * @param {Object} handlers - Handler instances {create, update, visibility, destroy}
   * @param {EventEmitter} eventBus - Internal event bus
   */
  constructor(stateManager, storageManager, handlers, eventBus) {
    this.stateManager = stateManager;
    this.storageManager = storageManager;
    this.handlers = handlers;
    this.eventBus = eventBus;

    // Deduplication tracking
    this.processedMessages = new Map();  // messageHash -> timestamp
    this.lastCleanup = Date.now();
  }

  /**
   * Setup event listeners for storage events
   * v1.6.2 - MIGRATION: Removed broadcast:received listener
   */
  setupListeners() {
    console.log('[SyncCoordinator] Setting up listeners (storage.onChanged only)');

    // Listen to storage changes (from StorageManager)
    this.eventBus.on('storage:changed', ({ state }) => {
      this.handleStorageChange(state);
    });

    // Listen to tab visibility changes (fixes Issue #35 and #51)
    this.eventBus.on('event:tab-visible', () => {
      this.handleTabVisible();
    });

    console.log('[SyncCoordinator] Listeners setup complete');
  }

  /**
   * Handle storage change events from other tabs
   * v1.6.2 - MIGRATION: Primary cross-tab sync mechanism
   * 
   * Called when storage.onChanged fires (from another tab's write)
   * Note: This does NOT fire in the tab that made the change
   *
   * @param {Object} newValue - New storage value with containers data
   */
  handleStorageChange(newValue) {
    // Handle null/undefined
    if (!newValue) {
      console.log('[SyncCoordinator] Ignoring null storage change');
      return;
    }

    // Check for duplicate message (prevents processing same change multiple times)
    if (this._isDuplicateMessage(newValue)) {
      console.log('[SyncCoordinator] Ignoring duplicate storage change');
      return;
    }

    console.log('[SyncCoordinator] Storage changed from another tab, syncing state');

    // Extract Quick Tabs from container-aware storage format
    const quickTabData = this._extractQuickTabsFromStorage(newValue);

    if (quickTabData.length > 0) {
      // v1.6.2 - Convert raw storage data to QuickTab domain entities
      // StateManager.hydrate() expects QuickTab instances, not raw objects
      const quickTabs = quickTabData.map(data => QuickTab.fromStorage(data));
      
      // Sync state from storage
      // This will trigger state:added, state:updated, state:deleted events
      this.stateManager.hydrate(quickTabs);
    }

    // Record that we processed this message
    this._recordProcessedMessage(newValue);
  }

  /**
   * Extract Quick Tabs from container-aware storage format
   * v1.6.2 - Helper for storage change handling
   * 
   * @private
   * @param {Object} storageValue - Storage value with containers
   * @returns {Array} Array of Quick Tab data
   */
  _extractQuickTabsFromStorage(storageValue) {
    // Handle direct quickTabs array (legacy format)
    if (storageValue.quickTabs && Array.isArray(storageValue.quickTabs)) {
      return storageValue.quickTabs;
    }

    // Handle container-aware format
    if (storageValue.containers) {
      return this._extractFromContainers(storageValue.containers);
    }

    return [];
  }

  /**
   * Extract Quick Tabs from containers object
   * @private
   * @param {Object} containers - Containers object
   * @returns {Array} Array of Quick Tab data
   */
  _extractFromContainers(containers) {
    const allQuickTabs = [];
    for (const containerData of Object.values(containers)) {
      const tabs = containerData?.tabs;
      if (tabs && Array.isArray(tabs)) {
        allQuickTabs.push(...tabs);
      }
    }
    return allQuickTabs;
  }

  /**
   * Check if message has been processed before
   * Uses hash-based deduplication with TTL
   * @private
   * @param {Object} storageValue - Storage value to check
   * @returns {boolean} True if this is a duplicate message
   */
  _isDuplicateMessage(storageValue) {
    // Clean up old entries periodically
    const now = Date.now();
    if (now - this.lastCleanup > SyncCoordinator.DEDUP_CLEANUP_INTERVAL_MS) {
      this._cleanupOldProcessedMessages(now);
    }

    // Generate hash of relevant message data
    const messageHash = this._hashMessage(storageValue);

    // Check if already processed
    return this.processedMessages.has(messageHash);
  }

  /**
   * Clean up old processed message entries
   * @private
   * @param {number} now - Current timestamp
   */
  _cleanupOldProcessedMessages(now) {
    const cutoff = now - SyncCoordinator.DEDUP_TTL_MS;
    for (const [hash, timestamp] of this.processedMessages.entries()) {
      if (timestamp < cutoff) {
        this.processedMessages.delete(hash);
      }
    }
    this.lastCleanup = now;
  }

  /**
   * Record that we've processed this message
   * @private
   * @param {Object} storageValue - Storage value to record
   */
  _recordProcessedMessage(storageValue) {
    const messageHash = this._hashMessage(storageValue);
    this.processedMessages.set(messageHash, Date.now());
  }

  /**
   * Generate hash of message for deduplication
   * @private
   * @param {Object} storageValue - Storage value to hash
   * @returns {string} Hash string
   */
  _hashMessage(storageValue) {
    // Extract Quick Tab IDs for hashing
    const quickTabs = this._extractQuickTabsFromStorage(storageValue);
    const quickTabIds = quickTabs
      .map(qt => qt.id)
      .sort()
      .join(',');

    // Use timestamp if available, otherwise use saveId or current time
    const timeComponent = storageValue.timestamp || storageValue.saveId || Date.now();

    return `${timeComponent}-${quickTabIds}`;
  }

  /**
   * Handle tab becoming visible - refresh state from storage
   * v1.6.2 - MIGRATION: Only uses storage, no broadcast replay
   */
  async handleTabVisible() {
    console.log('[SyncCoordinator] Tab became visible - refreshing state from storage');

    try {
      // Get current in-memory state
      const currentState = this.stateManager.getAll();

      // Load from storage (all containers globally)
      const storageState = await this.storageManager.loadAll();

      console.log(`[SyncCoordinator] Loaded ${storageState.length} Quick Tabs globally from storage`);

      // Merge storage state with in-memory state using timestamp-based conflict resolution
      const mergedState = this._mergeQuickTabStates(currentState, storageState);

      // Hydrate with merged state
      this.stateManager.hydrate(mergedState);

      // Notify UI coordinator to re-render
      this.eventBus.emit('state:refreshed', { quickTabs: mergedState });

      console.log(`[SyncCoordinator] Refreshed with ${mergedState.length} Quick Tabs (${currentState.length} in-memory, ${storageState.length} from storage)`);
    } catch (err) {
      console.error('[SyncCoordinator] Error refreshing state on tab visible:', err);
    }
  }

  /**
   * Merge Quick Tab states with timestamp-based conflict resolution
   * 
   * Strategy:
   * - If Quick Tab exists only in memory → Keep it (from recent update)
   * - If Quick Tab exists only in storage → Add it (was created before this tab loaded)
   * - If Quick Tab exists in both → Use the version with newer lastModified timestamp
   * 
   * @private
   * @param {Array<QuickTab>} currentState - In-memory Quick Tabs
   * @param {Array<QuickTab>} storageState - Quick Tabs from storage
   * @returns {Array<QuickTab>} - Merged Quick Tabs
   */
  _mergeQuickTabStates(currentState, storageState) {
    const merged = new Map();

    // Add all current (in-memory) Quick Tabs to merge map
    for (const qt of currentState) {
      merged.set(qt.id, qt);
    }

    // Merge storage Quick Tabs
    for (const storageQt of storageState) {
      const memoryQt = merged.get(storageQt.id);

      // Quick Tab only in storage
      if (!memoryQt) {
        merged.set(storageQt.id, storageQt);
        continue;
      }

      // Quick Tab in both → Compare timestamps
      const winner = this._selectNewerQuickTab(memoryQt, storageQt);
      merged.set(storageQt.id, winner);
    }

    return Array.from(merged.values());
  }

  /**
   * Select newer Quick Tab based on lastModified timestamp
   * 
   * @private
   * @param {QuickTab} memoryQt - In-memory Quick Tab
   * @param {QuickTab} storageQt - Storage Quick Tab
   * @returns {QuickTab} - The newer Quick Tab
   */
  _selectNewerQuickTab(memoryQt, storageQt) {
    const memoryModified = memoryQt.lastModified || memoryQt.createdAt || 0;
    const storageModified = storageQt.lastModified || storageQt.createdAt || 0;

    if (storageModified > memoryModified) {
      console.log(`[SyncCoordinator] Merge: Using storage version of ${storageQt.id} (newer by ${storageModified - memoryModified}ms)`);
      return storageQt;
    }

    console.log(`[SyncCoordinator] Merge: Keeping in-memory version of ${memoryQt.id} (newer by ${memoryModified - storageModified}ms)`);
    return memoryQt;
  }

  /**
   * Get this tab's unique ID (for tracking purposes)
   * @returns {string} Tab ID
   */
  getTabId() {
    return this.tabId;
  }
}
