/**
 * SyncCoordinator - Coordinates storage and broadcast synchronization
 *
 * Responsibilities:
 * - Route broadcast messages to appropriate handlers
 * - Coordinate storage ↔ state sync
 * - Ignore own storage changes to prevent loops
 * - Handle cross-tab communication
 *
 * Complexity: cc ≤ 3 per method
 */

export class SyncCoordinator {
  // Deduplication constants
  static DEDUP_TTL_MS = 30000;        // 30 second TTL for processed messages
  static DEDUP_CLEANUP_INTERVAL_MS = 5000; // Clean up every 5 seconds

  /**
   * @param {StateManager} stateManager - State manager instance
   * @param {StorageManager} storageManager - Storage manager instance
   * @param {BroadcastManager} broadcastManager - Broadcast manager instance
   * @param {Object} handlers - Handler instances {create, update, visibility, destroy}
   * @param {EventEmitter} eventBus - Internal event bus
   */
  constructor(stateManager, storageManager, broadcastManager, handlers, eventBus) {
    this.stateManager = stateManager;
    this.storageManager = storageManager;
    this.broadcastManager = broadcastManager;
    this.handlers = handlers;
    this.eventBus = eventBus;
  }

  /**
   * Setup event listeners for storage and broadcast events
   * CRITICAL FIX for Issue #35 and #51: Also listen for tab visibility changes
   */
  setupListeners() {
    console.log('[SyncCoordinator] Setting up listeners');

    // Listen to storage changes
    this.eventBus.on('storage:changed', newValue => {
      this.handleStorageChange(newValue);
    });

    // Listen to broadcast messages
    this.eventBus.on('broadcast:received', ({ type, data }) => {
      this.handleBroadcastMessage(type, data);
    });

    // Listen to tab visibility changes (fixes Issue #35 and #51)
    this.eventBus.on('event:tab-visible', () => {
      this.handleTabVisible();
    });

    console.log('[SyncCoordinator] Listeners setup complete');
  }

  /**
   * Handle storage change events
   * 
   * ✅ ENHANCED with LAYER 2 & 3 memory leak protection:
   * - Layer 2: Ignore messages from self (write source tracking)
   * - Layer 3: Deduplicate messages (hash-based)
   * 
   * See: docs/manual/v1.6.0/quick-tab-sync-restoration-guide.md
   *
   * @param {Object} newValue - New storage value
   */
  handleStorageChange(newValue) {
    // Handle null/undefined
    if (!newValue) {
      console.log('[SyncCoordinator] Ignoring null storage change');
      return;
    }

    // LAYER 2: Check if this write came from ourselves
    if (this._isOwnWrite(newValue)) {
      console.log('[SyncCoordinator] Ignoring own storage write');
      return;
    }

    // LAYER 3: Check if we've already processed this message
    if (this._isDuplicateMessage(newValue)) {
      console.log('[SyncCoordinator] Ignoring duplicate message');
      return;
    }

    console.log('[SyncCoordinator] Storage changed, syncing state');

    // Sync state from storage
    // This will trigger state:added, state:updated, state:deleted events
    this.stateManager.hydrate(newValue.quickTabs || []);
    
    // Record that we processed this message
    this._recordProcessedMessage(newValue);
  }

  /**
   * LAYER 2: Check if storage write originated from this tab
   * @private
   * @param {Object} storageValue - Storage value to check
   * @returns {boolean} True if this is our own write
   */
  _isOwnWrite(storageValue) {
    // Check write source tracking
    if (storageValue.writeSource && storageValue.writeSource === this.broadcastManager.senderId) {
      return true;
    }
    
    // Fallback to existing saveId check
    if (this.storageManager.shouldIgnoreStorageChange(storageValue.saveId)) {
      return true;
    }
    
    return false;
  }

  /**
   * LAYER 3: Check if message has been processed before
   * Uses hash-based deduplication with TTL
   * @private
   * @param {Object} storageValue - Storage value to check
   * @returns {boolean} True if this is a duplicate message
   */
  _isDuplicateMessage(storageValue) {
    if (!this.processedMessages) {
      this.processedMessages = new Map();  // messageHash -> timestamp
      this.lastCleanup = Date.now();
    }
    
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
    if (!this.processedMessages) {
      this.processedMessages = new Map();
    }
    
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
    // Hash based on timestamp and quick tab IDs
    const quickTabIds = (storageValue.quickTabs || [])
      .map(qt => qt.id)
      .sort()
      .join(',');
    
    // Use timestamp if available, otherwise use saveId or current time
    // This ensures we always have a unique hash component
    const timeComponent = storageValue.timestamp || storageValue.saveId || Date.now();
    
    return `${timeComponent}-${quickTabIds}`;
  }

  /**
   * Handle tab becoming visible - refresh state from background
   * v1.6.1.5 - CRITICAL FIX: Merge instead of replace to preserve broadcast-populated state
   * 
   * Previously: hydrate() replaced entire state, wiping out Quick Tabs received via broadcasts
   * Now: Merge storage state with in-memory state using timestamp-based conflict resolution
   */
  async handleTabVisible() {
    console.log('[SyncCoordinator] Tab became visible - refreshing state from background');

    try {
      // Get current in-memory state (may contain Quick Tabs from broadcasts)
      const currentState = this.stateManager.getAll();
      
      // ✅ Now loads from ALL containers globally
      const storageState = await this.storageManager.loadAll();
      
      console.log(`[SyncCoordinator] Loaded ${storageState.length} Quick Tabs globally from storage`);
      
      // v1.6.1.5 - MERGE instead of REPLACE
      // This preserves Quick Tabs received via broadcasts while still loading from storage
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
   * v1.6.1.5 - Critical fix for cross-domain sync issues
   * 
   * Strategy:
   * - If Quick Tab exists only in memory → Keep it (from recent broadcast)
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
      
      // Early return: Quick Tab only in storage
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
   * v1.6.1.5 - Helper to reduce complexity
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
   * Handle broadcast messages and route to appropriate handlers
   *
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  handleBroadcastMessage(type, data) {
    // Handle null/undefined data
    if (!data) {
      console.warn('[SyncCoordinator] Received broadcast with null data, ignoring');
      return;
    }

    console.log('[SyncCoordinator] Received broadcast:', type);

    // Route to appropriate handler based on message type
    this._routeMessage(type, data);
  }

  /**
   * Route message to appropriate handler
   * v1.6.1.5 - Reduced complexity with lookup table pattern
   * @private
   *
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  _routeMessage(type, data) {
    // Lookup table pattern to reduce complexity
    const routes = {
      CREATE: () => this.handlers.create.create(data),
      UPDATE_POSITION: () => this.handlers.update.handlePositionChangeEnd(data.id, data.left, data.top),
      UPDATE_SIZE: () => this.handlers.update.handleSizeChangeEnd(data.id, data.width, data.height),
      SOLO: () => this.handlers.visibility.handleSoloToggle(data.id, data.soloedOnTabs),
      MUTE: () => this.handlers.visibility.handleMuteToggle(data.id, data.mutedOnTabs),
      MINIMIZE: () => this.handlers.visibility.handleMinimize(data.id),
      RESTORE: () => this.handlers.visibility.handleRestore(data.id),
      CLOSE: () => this.handlers.destroy.handleDestroy(data.id),
      SNAPSHOT: () => this._handleStateSnapshot(data) // Phase 4: Self-healing
    };

    const handler = routes[type];
    if (handler) {
      handler();
    } else {
      console.warn('[SyncCoordinator] Unknown broadcast type:', type);
    }
  }

  /**
   * Handle state snapshot broadcast for self-healing
   * Phase 4: Merge snapshot with local state
   * 
   * @private
   * @param {Object} data - Snapshot data with quickTabs array
   */
  _handleStateSnapshot(data) {
    if (!data.quickTabs || !Array.isArray(data.quickTabs)) {
      console.warn('[SyncCoordinator] Invalid snapshot data');
      return;
    }

    console.log(`[SyncCoordinator] Received state snapshot with ${data.quickTabs.length} Quick Tabs`);

    // Get current state
    const currentState = this.stateManager.getAll();
    
    // Import QuickTab class for deserialization
    import('@domain/QuickTab.js').then(({ QuickTab }) => {
      // Deserialize snapshot Quick Tabs
      const snapshotQuickTabs = data.quickTabs.map(qtData => QuickTab.fromStorage(qtData));
      
      // Merge with current state using timestamp-based resolution
      const mergedState = this._mergeQuickTabStates(currentState, snapshotQuickTabs);
      
      // Hydrate with merged state
      this.stateManager.hydrate(mergedState);
      
      console.log(`[SyncCoordinator] Merged snapshot: ${currentState.length} local + ${snapshotQuickTabs.length} snapshot = ${mergedState.length} total`);
    }).catch(err => {
      console.error('[SyncCoordinator] Failed to process snapshot:', err);
    });
  }
}
