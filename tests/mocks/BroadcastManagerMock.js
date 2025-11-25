/**
 * BroadcastManager Mock for v1.6.2 Migration
 * 
 * This mock provides backward compatibility for tests that were written
 * for the old BroadcastChannel-based architecture. In v1.6.2, cross-tab
 * sync is now handled exclusively via storage.onChanged events.
 * 
 * The mock simulates broadcast behavior by storing messages and allowing
 * tests to verify what would have been broadcast.
 */

export class BroadcastManager {
  constructor(eventBus, cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.cookieStoreId = cookieStoreId;
    this.senderId = `mock-sender-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Track messages for test verification
    this.messageHistory = [];
  }

  /**
   * Setup broadcast channel (no-op in mock)
   */
  setupBroadcastChannel() {
    // No-op: BroadcastChannel no longer used in v1.6.2
  }

  /**
   * Broadcast message (stores for test verification)
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  broadcast(type, data) {
    const message = { type, data, timestamp: Date.now() };
    this.messageHistory.push(message);
    
    // Emit event for any listeners (simulates cross-tab behavior)
    this.eventBus?.emit('broadcast:sent', message);
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
   * Close the broadcast channel (no-op in mock)
   */
  close() {
    // No-op: BroadcastChannel no longer used in v1.6.2
    this.messageHistory = [];
  }

  /**
   * Cleanup (alias for close)
   */
  cleanup() {
    this.close();
  }
}
