import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SessionStorageAdapter - Storage adapter for browser.storage.session API
 * v1.6.3.10-v7 - FIX Diagnostic Issues #4, #15: Standardized to unified format (matching SyncStorageAdapter)
 *
 * v1.6.4.16 - FIX Issue #27: Storage Adapter Documentation
 *
 * CANONICAL ADAPTER SELECTION:
 * - **SyncStorageAdapter** is the CANONICAL adapter for Quick Tab persistence
 *   - Uses browser.storage.local for permanent state
 *   - Data survives browser restart
 *   - Used for hydration on extension load
 *
 * - **SessionStorageAdapter** is for TEMPORARY session state only
 *   - Uses browser.storage.session (cleared on browser close)
 *   - Used for rollback buffers and temporary caching
 *   - NOT used for Quick Tab persistence
 *
 * Features:
 * - Unified storage format for global Quick Tab visibility (STANDARDIZED)
 * - Temporary storage (cleared on browser restart)
 * - No quota limits (unlike sync storage)
 * - Faster than sync storage (no cross-device sync overhead)
 * - SaveId tracking to prevent race conditions
 * - Migration support from legacy container format
 *
 * Use Cases:
 * - Quick Tab state during active browser session
 * - Temporary caching to reduce sync storage writes
 * - Rollback buffer before committing to sync storage
 *
 * Storage Format (v1.6.3.10-v7 - Unified, matching SyncStorageAdapter):
 * {
 *   quick_tabs_state_v2: {
 *     tabs: [QuickTab, ...],  // ALL Quick Tabs in one array
 *     saveId: 'timestamp-random',
 *     timestamp: timestamp
 *   }
 * }
 *
 * Previous Format (Legacy - Container-based):
 * {
 *   quick_tabs_state_v2: {
 *     containers: {
 *       'firefox-default': { tabs: [...], lastUpdate: timestamp }
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
    console.log(
      '[SessionStorageAdapter] Initialized (session storage - temporary, cleared on browser close)'
    );
  }

  /**
   * Save Quick Tabs to unified storage format
   * v1.6.3.10-v7 - FIX Issue #4, #15: Standardized to unified format (no container separation)
   *
   * @param {QuickTab[]} tabs - Array of QuickTab domain entities
   * @returns {Promise<string>} Save ID for tracking race conditions
   */
  async save(tabs) {
    // Generate save ID for race condition tracking
    const saveId = this._generateSaveId();

    // v1.6.3.10-v7 - FIX Issue #4, #15: Use unified format (tabs array, not containers)
    const stateToSave = {
      [this.STORAGE_KEY]: {
        tabs: tabs.map(t => (typeof t.serialize === 'function' ? t.serialize() : t)),
        saveId: saveId,
        timestamp: Date.now()
      }
    };

    try {
      await browser.storage.session.set(stateToSave);
      console.log(
        `[SessionStorageAdapter] Saved ${tabs.length} tabs (unified format, saveId: ${saveId})`
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
   * Load Quick Tabs from unified storage format
   * v1.6.3.10-v7 - FIX Issue #4, #15: Returns unified format, migrates from container format if needed
   *
   * @returns {Promise<{tabs: Array, timestamp: number}|null>} Unified state or null if not found
   */
  async load() {
    const state = await this._loadRawState();

    // v1.6.3.10-v7 - New unified format
    // Return null if tabs array is empty to maintain backward compatibility
    if (state.tabs && Array.isArray(state.tabs) && state.tabs.length > 0) {
      return {
        tabs: state.tabs,
        timestamp: state.timestamp || Date.now()
      };
    }

    // Backward compatibility: migrate from container format
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
      console.log('[SessionStorageAdapter] Migrated and saved in unified format');
      return {
        tabs: migratedTabs,
        timestamp: state.timestamp || Date.now()
      };
    }

    return null;
  }

  /**
   * Load all Quick Tabs (alias for load in unified format)
   * v1.6.3.10-v7 - FIX Issue #4, #15: Simplified for unified format
   *
   * @returns {Promise<{tabs: Array, timestamp: number}|null>} Unified state
   */
  loadAll() {
    return this.load();
  }

  /**
   * Delete a specific Quick Tab
   * v1.6.3.10-v7 - FIX Issue #4, #15: Unified format (no container parameter)
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
        console.warn(`[SessionStorageAdapter] Quick Tab ${quickTabId} not found`);
        return;
      }

      await this._saveRawState({
        tabs: filteredTabs,
        saveId: this._generateSaveId(),
        timestamp: Date.now()
      });

      console.log(`[SessionStorageAdapter] Deleted Quick Tab ${quickTabId}`);
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

      console.log(
        `[SessionStorageAdapter] Deleted Quick Tab ${quickTabId} (migrated from container format)`
      );
    }
  }

  /**
   * Clear all Quick Tabs
   * v1.6.3.10-v7 - FIX Issue #4, #15: Unified format
   *
   * @returns {Promise<void>}
   */
  async clear() {
    await browser.storage.session.remove(this.STORAGE_KEY);
    console.log('[SessionStorageAdapter] Cleared all Quick Tabs');
  }

  /**
   * Migrate tabs from container format to unified array
   * v1.6.3.10-v7 - FIX Issue #4, #15: Backward compatibility helper
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
        console.log(
          `[SessionStorageAdapter] Migrating ${tabs.length} tabs from container: ${containerKey}`
        );
        allTabs.push(...tabs);
      }
    }

    return allTabs;
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

      // Return empty state in unified format
      return {
        tabs: [],
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
      // Return empty state on error in unified format
      return {
        tabs: [],
        timestamp: Date.now(),
        saveId: this._generateSaveId()
      };
    }
  }

  /**
   * Save raw state to storage
   * v1.6.3.10-v7 - FIX Issue #4, #15: Added for unified format save support
   * @private
   * @param {Object} state - State to save
   * @returns {Promise<void>}
   */
  async _saveRawState(state) {
    await browser.storage.session.set({
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
}
