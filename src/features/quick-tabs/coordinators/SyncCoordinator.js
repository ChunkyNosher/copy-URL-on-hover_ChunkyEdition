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
   * v1.6.2.1 - ISSUE #35 FIX: Added context-aware logging
   * v1.6.2.2 - ISSUE #35 FIX: Added listener count verification to diagnose EventBus disconnect
   */
  setupListeners() {
    const context = typeof window !== 'undefined' ? 'content-script' : 'background';
    
    console.log('[SyncCoordinator] Setting up listeners (storage.onChanged only)', {
      context,
      tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A',
      hasEventBus: !!this.eventBus,
      eventBusType: this.eventBus?.constructor?.name || 'none'
    });

    // Issue #35 Fix: Verify EventBus exists
    if (!this.eventBus) {
      console.error('[SyncCoordinator] ❌ EventBus is null/undefined! Cannot setup listeners');
      return;
    }

    // Listen to storage changes (from StorageManager)
    this.eventBus.on('storage:changed', ({ state }) => {
      console.log('[SyncCoordinator] *** RECEIVED storage:changed EVENT ***', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A',
        hasState: !!state,
        timestamp: Date.now()
      });
      this.handleStorageChange(state);
    });

    // Listen to tab visibility changes (fixes Issue #35 and #51)
    this.eventBus.on('event:tab-visible', () => {
      this.handleTabVisible();
    });

    // Issue #35 Fix: Log listener count after registration to verify listeners are attached
    const storageChangedListenerCount = this.eventBus.listenerCount?.('storage:changed') ?? 'unknown';
    const tabVisibleListenerCount = this.eventBus.listenerCount?.('event:tab-visible') ?? 'unknown';
    
    console.log('[SyncCoordinator] ✓ Listeners setup complete', { 
      context,
      storageChangedListeners: storageChangedListenerCount,
      tabVisibleListeners: tabVisibleListenerCount
    });
  }

  /**
   * Handle storage change events from other tabs
   * v1.6.2 - MIGRATION: Primary cross-tab sync mechanism
   * v1.6.2.1 - ISSUE #35 FIX: Enhanced context-aware logging
   * 
   * Called when storage.onChanged fires (from another tab's write)
   * Note: This does NOT fire in the tab that made the change
   *
   * @param {Object} newValue - New storage value with containers data
   */
  handleStorageChange(newValue) {
    const context = typeof window !== 'undefined' ? 'content-script' : 'background';
    const tabUrl = typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A';
    
    // Handle null/undefined
    if (!newValue) {
      console.log('[SyncCoordinator] Ignoring null storage change', { context, tabUrl });
      return;
    }

    // Check for duplicate message (prevents processing same change multiple times)
    if (this._isDuplicateMessage(newValue)) {
      console.log('[SyncCoordinator] Ignoring duplicate storage change', { context, tabUrl });
      return;
    }

    console.log('[SyncCoordinator] *** PROCESSING STORAGE CHANGE ***', {
      context,
      tabUrl,
      timestamp: Date.now()
    });

    // Extract Quick Tabs from container-aware storage format
    const quickTabData = this._extractQuickTabsFromStorage(newValue);

    // Debug logging to track the sync pipeline
    console.log('[SyncCoordinator] Extracted Quick Tabs from storage:', {
      context,
      tabUrl,
      quickTabCount: quickTabData.length,
      quickTabIds: quickTabData.map(qt => qt.id)
    });

    if (quickTabData.length > 0) {
      // v1.6.2 - Convert raw storage data to QuickTab domain entities
      // StateManager.hydrate() expects QuickTab instances, not raw objects
      const quickTabs = quickTabData.map(data => QuickTab.fromStorage(data));
      
      console.log('[SyncCoordinator] Calling StateManager.hydrate()', {
        context,
        tabUrl,
        quickTabCount: quickTabs.length
      });
      
      // Sync state from storage
      // This will trigger state:added, state:updated, state:deleted events
      // v1.6.2.x - ISSUE #51 FIX: Enable change detection for position/size/zIndex sync
      // v1.6.2.5 - ISSUE #1,4,5 FIX: Pass skipDeletions: false to trust storage as single source of truth
      //            When storage.onChanged fires, storage is authoritative. If a Quick Tab is not in
      //            storage, it was deleted in another tab and should be deleted here too.
      this.stateManager.hydrate(quickTabs, { detectChanges: true, skipDeletions: false });
      
      console.log('[SyncCoordinator] ✓ State hydration complete', { context, tabUrl });
    }

    // Record that we processed this message
    this._recordProcessedMessage(newValue);
  }

  /**
   * Extract Quick Tabs from storage value
   * v1.6.2.2 - FIX: Added support for unified storage format
   * 
   * Supports three formats (checked in order):
   * 1. Unified format (v1.6.2.2+): { tabs: [...], saveId, timestamp }
   * 2. Legacy quickTabs format (v1.6.1.x): { quickTabs: [...] }
   * 3. Container-aware format (v1.6.2.1-): { containers: { ... } }
   * 
   * @private
   * @param {Object} storageValue - Storage value with Quick Tabs data
   * @returns {Array} Array of Quick Tab data
   */
  _extractQuickTabsFromStorage(storageValue) {
    // CHECK NEW UNIFIED FORMAT FIRST (v1.6.2.2+)
    if (storageValue.tabs && Array.isArray(storageValue.tabs)) {
      console.log('[SyncCoordinator] Extracted Quick Tabs from unified format', {
        tabCount: storageValue.tabs.length,
        tabIds: storageValue.tabs.map(qt => qt.id)
      });
      return storageValue.tabs;
    }

    // LEGACY FORMAT 1: Direct quickTabs array (v1.6.1.x)
    if (storageValue.quickTabs && Array.isArray(storageValue.quickTabs)) {
      console.log('[SyncCoordinator] Extracted Quick Tabs from legacy quickTabs format', {
        tabCount: storageValue.quickTabs.length
      });
      return storageValue.quickTabs;
    }

    // LEGACY FORMAT 2: Container-aware format (v1.6.2.1 and earlier)
    if (storageValue.containers) {
      const extracted = this._extractFromContainers(storageValue.containers);
      console.log('[SyncCoordinator] Extracted Quick Tabs from container format', {
        tabCount: extracted.length
      });
      return extracted;
    }

    console.warn('[SyncCoordinator] No Quick Tabs found in storage value', {
      hasTabsKey: 'tabs' in storageValue,
      hasQuickTabsKey: 'quickTabs' in storageValue,
      hasContainersKey: 'containers' in storageValue,
      storageKeys: Object.keys(storageValue)
    });
    
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
   * v1.6.2.5 - ISSUE #6 FIX: Trust storage unconditionally when tab becomes visible.
   *            Skip merge logic - when tab was hidden, it missed storage.onChanged events.
   *            Storage is more up-to-date than stale in-memory state.
   */
  async handleTabVisible() {
    console.log('[SyncCoordinator] Tab became visible - refreshing state from storage (trusting storage unconditionally)');

    try {
      // Load from storage (all containers globally) - this is the ground truth
      const storageState = await this.storageManager.loadAll();

      console.log(`[SyncCoordinator] Loaded ${storageState.length} Quick Tabs from storage (skipping merge, trusting storage)`);

      // v1.6.2.5 - ISSUE #6 FIX: Skip merge logic entirely, trust storage unconditionally
      // Pass skipDeletions: false to delete anything not in storage
      // Keep detectChanges: true for UI sync
      this.stateManager.hydrate(storageState, { detectChanges: true, skipDeletions: false });

      // Notify UI coordinator to re-render
      this.eventBus.emit('state:refreshed', { quickTabs: storageState });

      console.log(`[SyncCoordinator] Refreshed with ${storageState.length} Quick Tabs from storage (merge skipped)`);
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
   * v1.6.3 - Ensure slot is preserved across syncs
   * 
   * @private
   * @param {QuickTab} memoryQt - In-memory Quick Tab
   * @param {QuickTab} storageQt - Storage Quick Tab
   * @returns {QuickTab} - The newer Quick Tab with slot preserved
   */
  _selectNewerQuickTab(memoryQt, storageQt) {
    const memoryModified = memoryQt.lastModified || memoryQt.createdAt || 0;
    const storageModified = storageQt.lastModified || storageQt.createdAt || 0;

    const useStorage = storageModified > memoryModified;
    const winner = useStorage ? storageQt : memoryQt;
    const loser = useStorage ? memoryQt : storageQt;
    const diff = Math.abs(storageModified - memoryModified);

    console.log(`[SyncCoordinator] Merge: Using ${useStorage ? 'storage' : 'in-memory'} version of ${winner.id} (newer by ${diff}ms)`);

    // v1.6.3 - Ensure slot is preserved (prefer existing slot over null)
    this._preserveSlot(winner, loser);

    return winner;
  }

  /**
   * Preserve slot from loser if winner has no slot
   * v1.6.3 - Helper to reduce complexity
   * 
   * @private
   * @param {QuickTab} winner - Winner Quick Tab (may be modified)
   * @param {QuickTab} loser - Loser Quick Tab (source of slot)
   */
  _preserveSlot(winner, loser) {
    const winnerHasSlot = winner.slot !== null && winner.slot !== undefined;
    const loserHasSlot = loser.slot !== null && loser.slot !== undefined;

    if (!winnerHasSlot && loserHasSlot) {
      winner.slot = loser.slot;
      console.log(`[SyncCoordinator] Preserved slot ${winner.slot} for ${winner.id}`);
    }
  }

  /**
   * Get this tab's unique ID (for tracking purposes)
   * @returns {string} Tab ID
   */
  getTabId() {
    return this.tabId;
  }
}
