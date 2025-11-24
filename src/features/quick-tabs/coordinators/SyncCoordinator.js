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
   * @param {Object} newValue - New storage value
   */
  handleStorageChange(newValue) {
    // Handle null/undefined
    if (!newValue) {
      console.log('[SyncCoordinator] Ignoring null storage change');
      return;
    }

    console.log('[SyncCoordinator] Storage changed, checking if should sync');

    // Ignore changes from our own saves to prevent loops
    if (this.storageManager.shouldIgnoreStorageChange(newValue.saveId)) {
      console.log('[SyncCoordinator] Ignoring own storage change');
      return;
    }

    console.log('[SyncCoordinator] Syncing state from storage');

    // Sync state from storage
    // This will trigger state:added, state:updated, state:deleted events
    this.stateManager.hydrate(newValue.quickTabs || []);
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
      
      // Load state from storage
      const storageState = await this.storageManager.loadAll();
      
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
   * @private
   *
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  _routeMessage(type, data) {
    switch (type) {
      case 'CREATE':
        this.handlers.create.create(data);
        break;

      case 'UPDATE_POSITION':
        this.handlers.update.handlePositionChangeEnd(data.id, data.left, data.top);
        break;

      case 'UPDATE_SIZE':
        this.handlers.update.handleSizeChangeEnd(data.id, data.width, data.height);
        break;

      case 'SOLO':
        this.handlers.visibility.handleSoloToggle(data.id, data.soloedOnTabs);
        break;

      case 'MUTE':
        this.handlers.visibility.handleMuteToggle(data.id, data.mutedOnTabs);
        break;

      case 'MINIMIZE':
        this.handlers.visibility.handleMinimize(data.id);
        break;

      case 'RESTORE':
        this.handlers.visibility.handleRestore(data.id);
        break;

      case 'CLOSE':
        this.handlers.destroy.handleDestroy(data.id);
        break;

      default:
        console.warn('[SyncCoordinator] Unknown broadcast type:', type);
    }
  }
}
