/**
 * BroadcastManager Mock - Test Cross-Tab Simulation
 * v1.6.3.8-v6 - ARCHITECTURE: BroadcastChannel removed from PRODUCTION code
 *
 * This mock simulates cross-tab sync for integration tests. While BC is removed
 * from production (replaced by Port + storage.onChanged), tests use mock
 * BroadcastChannels wired together by test setup to simulate message delivery.
 */

export class BroadcastManager {
  constructor(eventBus, _cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.messageHistory = [];
    this._channel = null;
  }

  /**
   * Setup broadcast channel - stores channel reference for cross-tab delivery
   */
  setupBroadcastChannel() {
    // Tests mock global.BroadcastChannel - use it if available
    if (typeof BroadcastChannel !== 'undefined') {
      this._channel = new BroadcastChannel('quick-tabs-sync');
      // Wire up onmessage handler to emit broadcast:received
      this._channel.onmessage = event => {
        this.eventBus?.emit('broadcast:received', event.data);
      };
    }
  }

  /**
   * Broadcast message - delivers to all tabs via mock channel
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {Promise} Always resolves
   */
  async broadcast(type, data) {
    const message = { type, data, timestamp: Date.now() };
    this.messageHistory.push(message);
    this.eventBus?.emit('broadcast:sent', message);

    // Use the channel to deliver to other tabs (test setup wires these together)
    if (this._channel && typeof this._channel.postMessage === 'function') {
      this._channel.postMessage(message);
    }

    return Promise.resolve();
  }

  notifyPositionUpdate(id, left, top) {
    return this.broadcast('UPDATE_POSITION', { id, left, top });
  }

  notifySizeUpdate(id, width, height) {
    return this.broadcast('UPDATE_SIZE', { id, width, height });
  }

  notifySolo(id, soloedOnTabs) {
    return this.broadcast('SOLO', { id, soloedOnTabs });
  }

  notifyMute(id, mutedOnTabs) {
    return this.broadcast('MUTE', { id, mutedOnTabs });
  }

  notifyMinimize(id) {
    return this.broadcast('MINIMIZE', { id });
  }

  notifyRestore(id) {
    return this.broadcast('RESTORE', { id });
  }

  notifyClose(id) {
    return this.broadcast('CLOSE', { id });
  }

  startPeriodicSnapshots() {
    // NO-OP - BC removed
  }

  stopPeriodicSnapshots() {
    // NO-OP - BC removed
  }

  setStateManager(_stateManager) {
    // NO-OP - BC removed
  }

  async replayBroadcastHistory() {
    return 0;
  }

  getMessageHistory() {
    return this.messageHistory;
  }

  clearMessageHistory() {
    this.messageHistory = [];
  }

  close() {
    if (this._channel && typeof this._channel.close === 'function') {
      this._channel.close();
    }
    this._channel = null;
    this.messageHistory = [];
  }

  cleanup() {
    this.close();
  }
}
