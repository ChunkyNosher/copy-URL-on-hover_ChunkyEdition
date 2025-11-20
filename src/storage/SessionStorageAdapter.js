import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SessionStorageAdapter - Storage adapter for browser.storage.session API
 *
 * Features:
 * - Container-aware storage format
 * - Temporary storage (cleared on browser restart)
 * - No quota limits (unlike sync storage)
 * - Faster than sync storage (no cross-device sync overhead)
 * - SaveId tracking to prevent race conditions
 *
 * Use Cases:
 * - Quick Tab state during active browser session
 * - Temporary caching to reduce sync storage writes
 * - Rollback buffer before committing to sync storage
 *
 * Storage Format (same as SyncStorageAdapter):
 * {
 *   quick_tabs_state_v2: {
 *     containers: {
 *       'firefox-default': {
 *         tabs: [QuickTab, ...],
 *         lastUpdate: timestamp
 *       }
 *     },
 *     saveId: 'timestamp-random',
 *     timestamp: timestamp
 *   }
 * }
 */
export class SessionStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.STORAGE_KEY = 'quick_tabs_state_v2';
  }

  /**
   * Save Quick Tabs for a specific container
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

    try {
      await browser.storage.session.set(stateToSave);
      console.log(
        `[SessionStorageAdapter] Saved ${tabs.length} tabs for container ${containerId} (saveId: ${saveId})`
      );
      return saveId;
    } catch (error) {
      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SessionStorageAdapter] Save failed:', {
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
      console.warn(`[SessionStorageAdapter] Container ${containerId} not found for deletion`);
      return;
    }

    // Filter out the tab
    const filteredTabs = containerData.tabs.filter(t => t.id !== quickTabId);

    if (filteredTabs.length === containerData.tabs.length) {
      console.warn(
        `[SessionStorageAdapter] Quick Tab ${quickTabId} not found in container ${containerId}`
      );
      return;
    }

    // Save updated tabs
    // Note: We need to reconstruct QuickTab objects for save()
    const { QuickTab } = await import('../domain/QuickTab.js');
    const quickTabs = filteredTabs.map(data => QuickTab.fromStorage(data));
    await this.save(containerId, quickTabs);

    console.log(
      `[SessionStorageAdapter] Deleted Quick Tab ${quickTabId} from container ${containerId}`
    );
  }

  /**
   * Delete all Quick Tabs for a specific container
   *
   * @param {string} containerId - Firefox container ID
   * @returns {Promise<void>}
   */
  async deleteContainer(containerId) {
    const existingState = await this._loadRawState();

    if (!existingState.containers || !existingState.containers[containerId]) {
      console.warn(`[SessionStorageAdapter] Container ${containerId} not found for deletion`);
      return;
    }

    delete existingState.containers[containerId];
    existingState.timestamp = Date.now();
    existingState.saveId = this._generateSaveId();

    await browser.storage.session.set({
      [this.STORAGE_KEY]: existingState
    });

    console.log(`[SessionStorageAdapter] Deleted all Quick Tabs for container ${containerId}`);
  }

  /**
   * Clear all Quick Tabs across all containers
   *
   * @returns {Promise<void>}
   */
  async clear() {
    await browser.storage.session.remove(this.STORAGE_KEY);
    console.log('[SessionStorageAdapter] Cleared all Quick Tabs');
  }

  /**
   * Load raw state from storage
   *
   * @private
   * @returns {Promise<Object>} Raw state object
   */
  async _loadRawState() {
    try {
      const result = await browser.storage.session.get(this.STORAGE_KEY);

      if (result[this.STORAGE_KEY]) {
        return result[this.STORAGE_KEY];
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
      console.error('[SessionStorageAdapter] Load failed:', {
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
}
