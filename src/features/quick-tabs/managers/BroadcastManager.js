/**
 * BroadcastManager - Handles cross-tab real-time messaging
 * Phase 2.1: Extracted from QuickTabsManager
 *
 * Responsibilities:
 * - Setup BroadcastChannel for container-specific messaging
 * - Send broadcast messages to other tabs
 * - Receive and route broadcast messages
 * - Debounce rapid broadcasts to prevent loops
 * - Container-aware channel management
 *
 * Uses:
 * - BroadcastChannel API for <10ms cross-tab sync
 * - EventBus for decoupled message handling
 */

export class BroadcastManager {
  constructor(eventBus, cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.cookieStoreId = cookieStoreId;

    // Broadcast channel
    this.broadcastChannel = null;
    this.currentChannelName = null;

    // Debounce to prevent message loops
    this.broadcastDebounce = new Map(); // key -> timestamp
    this.BROADCAST_DEBOUNCE_MS = 50; // Ignore duplicate broadcasts within 50ms
  }

  /**
   * Setup BroadcastChannel for cross-tab messaging
   */
  setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[BroadcastManager] BroadcastChannel not available, using storage-only sync');
      return;
    }

    try {
      // Container-specific channel for isolation
      const channelName = `quick-tabs-sync-${this.cookieStoreId}`;

      // Close existing channel if present
      if (this.broadcastChannel) {
        console.log(`[BroadcastManager] Closing old channel: ${this.currentChannelName}`);
        this.broadcastChannel.close();
      }

      this.broadcastChannel = new BroadcastChannel(channelName);
      this.currentChannelName = channelName;

      console.log(`[BroadcastManager] BroadcastChannel created: ${channelName}`);

      // Setup message handler
      this.broadcastChannel.onmessage = event => {
        this.handleBroadcastMessage(event.data);
      };

      console.log(`[BroadcastManager] Initialized for container: ${this.cookieStoreId}`);
    } catch (err) {
      console.error('[BroadcastManager] Failed to setup BroadcastChannel:', err);
    }
  }

  /**
   * Handle incoming broadcast message
   * @param {Object} message - Message data with type and data
   */
  handleBroadcastMessage(message) {
    console.log('[BroadcastManager] Message received:', message);

    const { type, data } = message;

    // Debounce rapid messages to prevent loops
    if (this.shouldDebounce(type, data)) {
      console.log('[BroadcastManager] Ignoring duplicate broadcast (debounced):', type, data.id);
      return;
    }

    // Emit event for handlers to process
    this.eventBus?.emit('broadcast:received', { type, data });
  }

  /**
   * Check if message should be debounced
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {boolean} - True if should skip
   */
  shouldDebounce(type, data) {
    if (!data || !data.id) {
      return false;
    }

    const debounceKey = `${type}-${data.id}`;
    const now = Date.now();
    const lastProcessed = this.broadcastDebounce.get(debounceKey);

    if (lastProcessed && now - lastProcessed < this.BROADCAST_DEBOUNCE_MS) {
      return true;
    }

    // Update timestamp
    this.broadcastDebounce.set(debounceKey, now);

    // Clean up old entries to prevent memory leak
    if (this.broadcastDebounce.size > 100) {
      const oldestAllowed = now - this.BROADCAST_DEBOUNCE_MS * 2;
      for (const [key, timestamp] of this.broadcastDebounce.entries()) {
        if (timestamp < oldestAllowed) {
          this.broadcastDebounce.delete(key);
        }
      }
    }

    return false;
  }

  /**
   * Broadcast message to other tabs
   * @param {string} type - Message type (CREATE, UPDATE_POSITION, etc.)
   * @param {Object} data - Message payload
   */
  async broadcast(type, data) {
    if (!this.broadcastChannel) {
      console.warn('[BroadcastManager] No broadcast channel available');
      return;
    }

    try {
      this.broadcastChannel.postMessage({ type, data });
      console.log(`[BroadcastManager] Broadcasted ${type}:`, data);
    } catch (err) {
      console.error('[BroadcastManager] Failed to broadcast:', err);
    }
  }

  /**
   * Broadcast Quick Tab creation
   * @param {Object} quickTabData - Quick Tab data to broadcast
   */
  async notifyCreate(quickTabData) {
    await this.broadcast('CREATE', quickTabData);
  }

  /**
   * Broadcast position update
   * @param {string} id - Quick Tab ID
   * @param {number} left - Left position
   * @param {number} top - Top position
   */
  async notifyPositionUpdate(id, left, top) {
    await this.broadcast('UPDATE_POSITION', { id, left, top });
  }

  /**
   * Broadcast size update
   * @param {string} id - Quick Tab ID
   * @param {number} width - Width
   * @param {number} height - Height
   */
  async notifySizeUpdate(id, width, height) {
    await this.broadcast('UPDATE_SIZE', { id, width, height });
  }

  /**
   * Broadcast minimize
   * @param {string} id - Quick Tab ID
   */
  async notifyMinimize(id) {
    await this.broadcast('MINIMIZE', { id });
  }

  /**
   * Broadcast restore
   * @param {string} id - Quick Tab ID
   */
  async notifyRestore(id) {
    await this.broadcast('RESTORE', { id });
  }

  /**
   * Broadcast close
   * @param {string} id - Quick Tab ID
   */
  async notifyClose(id) {
    await this.broadcast('CLOSE', { id });
  }

  /**
   * Broadcast solo state change
   * @param {string} id - Quick Tab ID
   * @param {Array<number>} soloedOnTabs - Array of tab IDs where Quick Tab is soloed
   */
  async notifySolo(id, soloedOnTabs) {
    await this.broadcast('SOLO', { id, soloedOnTabs });
  }

  /**
   * Broadcast mute state change
   * @param {string} id - Quick Tab ID
   * @param {Array<number>} mutedOnTabs - Array of tab IDs where Quick Tab is muted
   */
  async notifyMute(id, mutedOnTabs) {
    await this.broadcast('MUTE', { id, mutedOnTabs });
  }

  /**
   * Update container context (re-creates channel)
   * @param {string} cookieStoreId - New container ID
   */
  updateContainer(cookieStoreId) {
    if (this.cookieStoreId === cookieStoreId) {
      return; // No change
    }

    console.log(`[BroadcastManager] Updating container: ${this.cookieStoreId} → ${cookieStoreId}`);
    this.cookieStoreId = cookieStoreId;
    this.setupBroadcastChannel(); // Re-create channel for new container
  }

  /**
   * Close broadcast channel
   */
  close() {
    if (this.broadcastChannel) {
      console.log(`[BroadcastManager] Closing channel: ${this.currentChannelName}`);
      this.broadcastChannel.close();
      this.broadcastChannel = null;
      this.currentChannelName = null;
    }
  }
}
