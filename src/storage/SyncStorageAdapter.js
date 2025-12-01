import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SyncStorageAdapter - Storage adapter for browser.storage.local API
 * v1.6.2.2 - ISSUE #35/#51 FIX: Unified storage format (no container separation)
 *
 * Features:
 * - Unified storage format for global Quick Tab visibility
 * - SaveId tracking to prevent race conditions
 * - Backward compatible migration from container format
 * - Error handling with user feedback
 *
 * Storage Format (v1.6.2.2 - Unified):
 * {
 *   quick_tabs_state_v2: {
 *     tabs: [QuickTab, ...],  // ALL Quick Tabs in one array
 *     saveId: 'timestamp-random',
 *     timestamp: timestamp
 *   }
 * }
 *
 * Previous Format (v1.5.8.15 - v1.6.2.1 - Container-based):
 * {
 *   quick_tabs_state_v2: {
 *     containers: {
 *       'firefox-default': { tabs: [...], lastUpdate: timestamp },
 *       'firefox-container-1': { tabs: [...], lastUpdate: timestamp }
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
  }

  /**
   * Save Quick Tabs to unified storage format
   * v1.6.2.2 - Unified format (no container separation)
   *
   * @param {QuickTab[]} tabs - Array of QuickTab domain entities
   * @returns {Promise<string>} Save ID for tracking race conditions
   */
  async save(tabs) {
    // Generate save ID for race condition tracking
    const saveId = this._generateSaveId();
    
    const stateToSave = {
      [this.STORAGE_KEY]: {
        tabs: tabs.map(t => t.serialize()),
        saveId: saveId,
        timestamp: Date.now()
      }
    };

    const size = this._calculateSize(stateToSave);

    try {
      await browser.storage.local.set(stateToSave);
      console.log(`[SyncStorageAdapter] Saved ${tabs.length} tabs (unified format, saveId: ${saveId}, size: ${size} bytes)`);
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
   * Load Quick Tabs from unified storage format
   * v1.6.2.2 - Returns unified format, migrates from container format if needed
   *
   * @returns {Promise<{tabs: Array, timestamp: number}|null>} Unified state or null if not found
   */
  async load() {
    const state = await this._loadRawState();

    // v1.6.2.2 - New unified format
    // Return null if tabs array is empty to maintain backward compatibility
    if (state.tabs && Array.isArray(state.tabs) && state.tabs.length > 0) {
      return {
        tabs: state.tabs,
        timestamp: state.timestamp || Date.now()
      };
    }

    // Backward compatibility: migrate from container format and save in new format
    if (state.containers) {
      const migratedTabs = this._migrateFromContainerFormat(state.containers);
      if (migratedTabs.length === 0) {
        return null;
      }
      // Save migrated format to avoid repeated migration on future loads
      await this._saveRawState({
        tabs: migratedTabs,
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      });
      console.log('[SyncStorageAdapter] Migrated and saved in unified format');
      return {
        tabs: migratedTabs,
        timestamp: state.timestamp || Date.now()
      };
    }

    return null;
  }

  /**
   * Load all Quick Tabs (alias for load in unified format)
   * v1.6.2.2 - Simplified for unified format
   *
   * @returns {Promise<{tabs: Array, timestamp: number}|null>} Unified state
   */
  loadAll() {
    return this.load();
  }

  /**
   * Delete a specific Quick Tab
   * v1.6.2.2 - Unified format (no container parameter)
   *
   * @param {string} quickTabId - Quick Tab ID to delete
   * @returns {Promise<void>}
   */
  async delete(quickTabId) {
    const state = await this._loadRawState();
    
    // Handle unified format
    if (state.tabs && Array.isArray(state.tabs)) {
      const filteredTabs = state.tabs.filter(t => t.id !== quickTabId);
      
      if (filteredTabs.length === state.tabs.length) {
        console.warn(`[SyncStorageAdapter] Quick Tab ${quickTabId} not found`);
        return;
      }

      await this._saveRawState({
        tabs: filteredTabs,
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      });

      console.log(`[SyncStorageAdapter] Deleted Quick Tab ${quickTabId}`);
      return;
    }

    // Backward compatibility: container format migration
    if (state.containers) {
      const migratedTabs = this._migrateFromContainerFormat(state.containers);
      const filteredTabs = migratedTabs.filter(t => t.id !== quickTabId);
      
      await this._saveRawState({
        tabs: filteredTabs,
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      });

      console.log(`[SyncStorageAdapter] Deleted Quick Tab ${quickTabId} (migrated from container format)`);
    }
  }

  /**
   * Clear all Quick Tabs
   * v1.6.2.2 - Unified format
   *
   * @returns {Promise<void>}
   */
  async clear() {
    await browser.storage.local.remove(this.STORAGE_KEY);
    console.log('[SyncStorageAdapter] Cleared all Quick Tabs');
  }

  /**
   * Migrate tabs from container format to unified array
   * v1.6.2.2 - Backward compatibility helper
   * 
   * @private
   * @param {Object} containers - Container data object
   * @returns {Array} Array of serialized Quick Tab data
   */
  _migrateFromContainerFormat(containers) {
    const allTabs = [];
    
    for (const containerKey of Object.keys(containers)) {
      const tabs = containers[containerKey]?.tabs || [];
      if (tabs.length > 0) {
        console.log(`[SyncStorageAdapter] Migrating ${tabs.length} tabs from container: ${containerKey}`);
        allTabs.push(...tabs);
      }
    }
    
    return allTabs;
  }

  /**
   * Load raw state from storage
   * v1.6.2.2 - Only uses local storage (no sync storage fallback)
   *
   * @private
   * @returns {Promise<Object>} Raw state object
   */
  async _loadRawState() {
    try {
      const localResult = await browser.storage.local.get(this.STORAGE_KEY);

      if (localResult[this.STORAGE_KEY]) {
        return localResult[this.STORAGE_KEY];
      }

      // Fallback to sync storage for backward compatibility migration
      const syncResult = await browser.storage.sync.get(this.STORAGE_KEY);

      if (syncResult[this.STORAGE_KEY]) {
        console.log('[SyncStorageAdapter] Loaded from sync storage (legacy fallback)');
        return syncResult[this.STORAGE_KEY];
      }

      // Return empty state
      return {
        tabs: [],
        timestamp: Date.now(),
        saveId: this._generateSaveId()
      };
    } catch (error) {
      console.error('[SyncStorageAdapter] Load failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        error: error
      });
      // Return empty state on error
      return {
        tabs: [],
        timestamp: Date.now(),
        saveId: this._generateSaveId()
      };
    }
  }

  /**
   * Save raw state to storage
   * @private
   * @param {Object} state - State to save
   * @returns {Promise<void>}
   */
  async _saveRawState(state) {
    await browser.storage.local.set({
      [this.STORAGE_KEY]: state
    });
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
