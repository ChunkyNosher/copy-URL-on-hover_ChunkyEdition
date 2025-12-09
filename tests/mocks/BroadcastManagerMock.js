/**
 * BroadcastManager Mock for v1.6.2 Migration
 *
 * This mock provides backward compatibility for tests that were written
 * for the old BroadcastChannel-based architecture. In v1.6.2, cross-tab
 * sync is now handled exclusively via storage.onChanged events.
 *
 * The mock uses BroadcastChannel when available (for test cross-tab simulation)
 * and falls back to storing messages for verification.
 */

export class BroadcastManager {
  constructor(eventBus, cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.cookieStoreId = cookieStoreId;
    this.senderId = `mock-sender-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.channel = null;

    // Track messages for test verification
    this.messageHistory = [];
  }

  /**
   * Setup broadcast channel - uses global.BroadcastChannel if available (for tests)
   */
  setupBroadcastChannel() {
    if (typeof global !== 'undefined' && global.BroadcastChannel) {
      try {
        this.channel = new global.BroadcastChannel(`quick-tabs-sync-${this.cookieStoreId}`);
        this.channel.onmessage = event => {
          const message = event.data;
          // Emit to event bus so tests can handle
          this.eventBus?.emit('broadcast:received', message);
        };
      } catch {
        // BroadcastChannel not available, continue without it
        this.channel = null;
      }
    }
  }

  /**
   * Broadcast message - uses channel if available, stores for verification
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {Promise} - Always returns a Promise for consistency
   */
  async broadcast(type, data) {
    const message = { type, data, timestamp: Date.now(), senderId: this.senderId };
    this.messageHistory.push(message);

    // Emit event for any listeners (simulates cross-tab behavior)
    this.eventBus?.emit('broadcast:sent', message);

    // Post to channel if available (for cross-tab delivery in tests)
    if (this.channel && typeof this.channel.postMessage === 'function') {
      this.channel.postMessage(message);
    }

    return Promise.resolve();
  }

  /**
   * Notify position update
   */
  notifyPositionUpdate(id, left, top) {
    this.broadcast('UPDATE_POSITION', { id, left, top });
  }

  /**
   * Notify size update
   */
  notifySizeUpdate(id, width, height) {
    this.broadcast('UPDATE_SIZE', { id, width, height });
  }

  /**
   * Notify solo toggle
   */
  notifySolo(id, soloedOnTabs) {
    this.broadcast('SOLO', { id, soloedOnTabs });
  }

  /**
   * Notify mute toggle
   */
  notifyMute(id, mutedOnTabs) {
    this.broadcast('MUTE', { id, mutedOnTabs });
  }

  /**
   * Notify minimize
   */
  notifyMinimize(id) {
    this.broadcast('MINIMIZE', { id });
  }

  /**
   * Notify restore
   */
  notifyRestore(id) {
    this.broadcast('RESTORE', { id });
  }

  /**
   * Notify close
   */
  notifyClose(id) {
    this.broadcast('CLOSE', { id });
  }

  /**
   * Start periodic snapshots (no-op in mock)
   */
  startPeriodicSnapshots() {
    // No-op: Snapshots no longer used in v1.6.2
  }

  /**
   * Stop periodic snapshots (no-op in mock)
   */
  stopPeriodicSnapshots() {
    // No-op: Snapshots no longer used in v1.6.2
  }

  /**
   * Set state manager (no-op in mock)
   */
  setStateManager(_stateManager) {
    // No-op: State manager not used in v1.6.2
  }

  /**
   * Replay broadcast history (no-op in mock)
   */
  async replayBroadcastHistory() {
    // No-op: History replay not used in v1.6.2
    return 0;
  }

  /**
   * Get message history for test verification
   */
  getMessageHistory() {
    return this.messageHistory;
  }

  /**
   * Clear message history (for test reset)
   */
  clearMessageHistory() {
    this.messageHistory = [];
  }

  /**
   * Close the broadcast channel
   */
  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.messageHistory = [];
  }

  /**
   * Cleanup (alias for close)
   */
  cleanup() {
    this.close();
  }
}
