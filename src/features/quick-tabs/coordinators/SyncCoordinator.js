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
   * CRITICAL FIX for Issue #35 and #51: Load latest state when switching to this tab
   */
  async handleTabVisible() {
    console.log('[SyncCoordinator] Tab became visible - refreshing state from background');

    try {
      // Re-hydrate state from storage (which will call background first)
      const quickTabs = await this.storageManager.loadAll();
      this.stateManager.hydrate(quickTabs);

      // Notify UI coordinator to re-render
      this.eventBus.emit('state:refreshed', { quickTabs });

      console.log(`[SyncCoordinator] Refreshed ${quickTabs.length} Quick Tabs on tab visible`);
    } catch (err) {
      console.error('[SyncCoordinator] Error refreshing state on tab visible:', err);
    }
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
