/**
 * BroadcastChannelFactory - Singleton pattern for BroadcastChannel management
 * v1.6.2.1 - NEW: Ensures ONE channel per container
 *
 * Responsibilities:
 * - Manage BroadcastChannel lifecycle
 * - Ensure single instance per container (cookieStoreId)
 * - Provide emergency cleanup for all channels
 *
 * Memory Leak Prevention:
 * - Singleton pattern prevents multiple channel instances
 * - closeAll() for emergency cleanup
 *
 * @version 1.6.2.1
 */

import { BroadcastSync } from './BroadcastSync.js';

/**
 * Singleton factory for BroadcastSync instances
 * Ensures only ONE channel per container to prevent message amplification
 */
class BroadcastChannelFactoryClass {
  constructor() {
    // Map of cookieStoreId → BroadcastSync instance
    this.channels = new Map();
  }

  /**
   * Get or create BroadcastSync for container
   * Ensures only ONE channel per container
   *
   * @param {string} cookieStoreId - Firefox container ID
   * @param {string} tabId - Current browser tab ID
   * @returns {BroadcastSync} - BroadcastSync instance
   */
  getChannel(cookieStoreId, tabId) {
    if (this.channels.has(cookieStoreId)) {
      const existing = this.channels.get(cookieStoreId);

      // If existing channel is closed, remove it and create new
      if (existing.isClosed()) {
        this.channels.delete(cookieStoreId);
      } else {
        return existing;
      }
    }

    const channel = new BroadcastSync(cookieStoreId, tabId);
    this.channels.set(cookieStoreId, channel);
    return channel;
  }

  /**
   * Close channel for specific container
   *
   * @param {string} cookieStoreId - Firefox container ID
   */
  closeChannel(cookieStoreId) {
    const channel = this.channels.get(cookieStoreId);
    if (channel) {
      channel.close();
      this.channels.delete(cookieStoreId);
      console.log(`[BroadcastChannelFactory] Closed channel for container: ${cookieStoreId}`);
    }
  }

  /**
   * Close all channels (emergency cleanup)
   * Should be called on extension unload or memory critical events
   */
  closeAll() {
    console.log(`[BroadcastChannelFactory] Closing all channels (${this.channels.size} total)`);

    for (const [cookieStoreId, channel] of this.channels.entries()) {
      try {
        channel.close();
      } catch (err) {
        console.error(
          `[BroadcastChannelFactory] Error closing channel for ${cookieStoreId}:`,
          err
        );
      }
    }

    this.channels.clear();
    console.log('[BroadcastChannelFactory] All channels closed');
  }

  /**
   * Check if channel exists for container
   *
   * @param {string} cookieStoreId - Firefox container ID
   * @returns {boolean}
   */
  hasChannel(cookieStoreId) {
    const channel = this.channels.get(cookieStoreId);
    return !!(channel && !channel.isClosed());
  }

  /**
   * Get number of active channels
   *
   * @returns {number}
   */
  getChannelCount() {
    // Count only non-closed channels
    let count = 0;
    for (const channel of this.channels.values()) {
      if (!channel.isClosed()) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get all active container IDs
   *
   * @returns {string[]}
   */
  getActiveContainerIds() {
    const ids = [];
    for (const [cookieStoreId, channel] of this.channels.entries()) {
      if (!channel.isClosed()) {
        ids.push(cookieStoreId);
      }
    }
    return ids;
  }
}

// Export singleton instance
export const BroadcastChannelFactory = new BroadcastChannelFactoryClass();

// Also export the class for testing purposes
export { BroadcastChannelFactoryClass };
