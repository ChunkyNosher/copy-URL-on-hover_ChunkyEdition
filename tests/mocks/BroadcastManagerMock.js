/**
 * BroadcastManager Mock - NO-OP STUB
 * v1.6.3.8-v6 - ARCHITECTURE: BroadcastChannel COMPLETELY REMOVED
 *
 * This mock provides backward compatibility for tests that were written
 * for the old BroadcastChannel-based architecture. All methods are now no-ops.
 * The new architecture uses Port + storage.onChanged exclusively.
 */

export class BroadcastManager {
  constructor(eventBus, _cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.messageHistory = [];
  }

  /**
   * Setup broadcast channel - NO-OP (BC removed)
   */
  setupBroadcastChannel() {
    // NO-OP - BC removed
  }

  /**
   * Broadcast message - NO-OP, stores for test verification only
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {Promise} Always resolves
   */
  async broadcast(type, data) {
    const message = { type, data, timestamp: Date.now() };
    this.messageHistory.push(message);
    this.eventBus?.emit('broadcast:sent', message);
    return Promise.resolve();
  }

  notifyPositionUpdate(id, left, top) {
    this.broadcast('UPDATE_POSITION', { id, left, top });
  }

  notifySizeUpdate(id, width, height) {
    this.broadcast('UPDATE_SIZE', { id, width, height });
  }

  notifySolo(id, soloedOnTabs) {
    this.broadcast('SOLO', { id, soloedOnTabs });
  }

  notifyMute(id, mutedOnTabs) {
    this.broadcast('MUTE', { id, mutedOnTabs });
  }

  notifyMinimize(id) {
    this.broadcast('MINIMIZE', { id });
  }

  notifyRestore(id) {
    this.broadcast('RESTORE', { id });
  }

  notifyClose(id) {
    this.broadcast('CLOSE', { id });
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
    this.messageHistory = [];
  }

  cleanup() {
    this.close();
  }
}
