import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SyncStorageAdapter - Storage adapter for browser.storage.sync API
 *
 * Features:
 * - Container-aware storage format
 * - Quota management (100KB limit for sync storage)
 * - Automatic fallback to local storage on quota exceeded
 * - SaveId tracking to prevent race conditions
 * - Error handling with user feedback
 *
 * Storage Format (v1.5.8.15+):
 * {
 *   quick_tabs_state_v2: {
 *     containers: {
 *       'firefox-default': {
 *         tabs: [QuickTab, ...],
 *         lastUpdate: timestamp
 *       },
 *       'firefox-container-1': {
 *         tabs: [QuickTab, ...],
 *         lastUpdate: timestamp
 *       }
 *     },
 *     saveId: 'timestamp-random',
 *     timestamp: timestamp
 *   }
 * }
 */
export class SyncStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.STORAGE_KEY = 'quick_tabs_state_v2';
    this.MAX_SYNC_SIZE = 100 * 1024; // 100KB limit for sync storage
  }

  /**
   * Save Quick Tabs for a specific container
   * v1.6.0.12 - FIX: Use local storage by default to avoid quota issues
   *
   * @param {string} containerId - Firefox container ID
   * @param {QuickTab[]} tabs - Array of QuickTab domain entities
   * @returns {Promise<string>} Save ID for tracking race conditions
   */
  async save(containerId, tabs) {
    // Load existing state
    const existingState = await this._loadRawState();

    // Update container
    if (!existingState.containers) {
      existingState.containers = {};
    }

    existingState.containers[containerId] = {
      tabs: tabs.map(t => t.serialize()),
      lastUpdate: Date.now()
    };

    // Generate save ID for race condition tracking
    const saveId = this._generateSaveId();
    existingState.saveId = saveId;
    existingState.timestamp = Date.now();

    // Wrap in storage key
    const stateToSave = {
      [this.STORAGE_KEY]: existingState
    };

    // Check size - if too large, use local storage directly
    const size = this._calculateSize(stateToSave);

    try {
      // v1.6.0.12 - FIX: Use local storage by default for Quick Tabs
      // Local storage has much higher limits (no 100KB restriction)
      await browser.storage.local.set(stateToSave);
      console.log(
        `[SyncStorageAdapter] Saved ${tabs.length} tabs for container ${containerId} to local storage (saveId: ${saveId}, size: ${size} bytes)`
      );
      return saveId;
    } catch (error) {
      console.error('[SyncStorageAdapter] Save failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        error: error
      });
      throw error;
    }
  }

  /**
   * Handle save error with fallback to local storage
   * @private
   */
  async _handleSaveError(error, stateToSave, saveId) {
    // Handle quota exceeded - fallback to local storage
    if (!error.message || !error.message.includes('QUOTA_BYTES')) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SyncStorageAdapter] Save failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        error: error
      });
      throw error;
    }

    console.error(
      '[SyncStorageAdapter] Sync storage quota exceeded, falling back to local storage'
    );

    try {
      await browser.storage.local.set(stateToSave);
      console.log(`[SyncStorageAdapter] Fallback: Saved to local storage (saveId: ${saveId})`);
      return saveId;
    } catch (localError) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SyncStorageAdapter] Local storage fallback failed:', {
        message: localError?.message,
        name: localError?.name,
        stack: localError?.stack,
        code: localError?.code,
        error: localError
      });
      throw new Error(`Failed to save: ${localError.message}`);
    }
  }

  /**
   * Load Quick Tabs for a specific container
   *
   * @param {string} containerId - Firefox container ID
   * @returns {Promise<{tabs: Array, lastUpdate: number}|null>} Container data or null if not found
   */
  async load(containerId) {
    const state = await this._loadRawState();

    if (!state.containers || !state.containers[containerId]) {
      return null;
    }

    return state.containers[containerId];
  }

  /**
   * Load all Quick Tabs across all containers
   *
   * @returns {Promise<Object.<string, {tabs: Array, lastUpdate: number}>>} Map of container ID to container data
   */
  async loadAll() {
    const state = await this._loadRawState();
    return state.containers || {};
  }

  /**
   * Delete a specific Quick Tab from a container
   *
   * @param {string} containerId - Firefox container ID
   * @param {string} quickTabId - Quick Tab ID to delete
   * @returns {Promise<void>}
   */
  async delete(containerId, quickTabId) {
    const containerData = await this.load(containerId);

    if (!containerData) {
      console.warn(`[SyncStorageAdapter] Container ${containerId} not found for deletion`);
      return;
    }

    // Filter out the tab
    const filteredTabs = containerData.tabs.filter(t => t.id !== quickTabId);

    if (filteredTabs.length === containerData.tabs.length) {
      console.warn(
        `[SyncStorageAdapter] Quick Tab ${quickTabId} not found in container ${containerId}`
      );
      return;
    }

    // Save updated tabs
    // Note: We need to reconstruct QuickTab objects for save()
    const { QuickTab } = await import('../domain/QuickTab.js');
    const quickTabs = filteredTabs.map(data => QuickTab.fromStorage(data));
    await this.save(containerId, quickTabs);

    console.log(
      `[SyncStorageAdapter] Deleted Quick Tab ${quickTabId} from container ${containerId}`
    );
  }

  /**
   * Delete all Quick Tabs for a specific container
   * v1.6.0.12 - FIX: Use local storage to match save behavior
   *
   * @param {string} containerId - Firefox container ID
   * @returns {Promise<void>}
   */
  async deleteContainer(containerId) {
    const existingState = await this._loadRawState();

    if (!existingState.containers || !existingState.containers[containerId]) {
      console.warn(`[SyncStorageAdapter] Container ${containerId} not found for deletion`);
      return;
    }

    delete existingState.containers[containerId];
    existingState.timestamp = Date.now();
    existingState.saveId = this._generateSaveId();

    // v1.6.0.12 - FIX: Save to local storage
    await browser.storage.local.set({
      [this.STORAGE_KEY]: existingState
    });

    console.log(`[SyncStorageAdapter] Deleted all Quick Tabs for container ${containerId}`);
  }

  /**
   * Clear all Quick Tabs across all containers
   * v1.6.0.12 - FIX: Clear from both local and sync storage
   *
   * @returns {Promise<void>}
   */
  async clear() {
    // Clear from both storages for complete cleanup
    await Promise.all([
      browser.storage.local.remove(this.STORAGE_KEY),
      browser.storage.sync.remove(this.STORAGE_KEY)
    ]);
    console.log('[SyncStorageAdapter] Cleared all Quick Tabs from both storages');
  }

  /**
   * Load raw state from storage (checks both local and sync, prioritizing local)
   * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
   *
   * @private
   * @returns {Promise<Object>} Raw state object
   */
  async _loadRawState() {
    try {
      // v1.6.0.12 - FIX: Try local storage first (where we now save)
      const localResult = await browser.storage.local.get(this.STORAGE_KEY);

      if (localResult[this.STORAGE_KEY]) {
        return localResult[this.STORAGE_KEY];
      }

      // Fallback to sync storage for backward compatibility
      const syncResult = await browser.storage.sync.get(this.STORAGE_KEY);

      if (syncResult[this.STORAGE_KEY]) {
        console.log('[SyncStorageAdapter] Loaded from sync storage (legacy fallback)');
        return syncResult[this.STORAGE_KEY];
      }

      // Return empty state
      return {
        containers: {},
        timestamp: Date.now(),
        saveId: this._generateSaveId()
      };
    } catch (error) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SyncStorageAdapter] Load failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        error: error
      });
      // Return empty state on error
      return {
        containers: {},
        timestamp: Date.now(),
        saveId: this._generateSaveId()
      };
    }
  }

  /**
   * Generate unique save ID for race condition tracking
   *
   * @private
   * @returns {string} Save ID in format 'timestamp-random'
   */
  _generateSaveId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate size of data in bytes
   *
   * @private
   * @param {Object} data - Data to measure
   * @returns {number} Size in bytes
   */
  _calculateSize(data) {
    try {
      const jsonString = JSON.stringify(data);
      return new Blob([jsonString]).size;
    } catch (error) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SyncStorageAdapter] Size calculation failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        error: error
      });
      return 0;
    }
  }
}
