import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SyncStorageAdapter - Storage adapter for browser.storage.local API
 * v1.6.2.2 - ISSUE #35/#51 FIX: Unified storage format (no container separation)
 * v1.6.3.10-v10 - FIX Issue P: Atomic migration with version field and locking
 *
 * Features:
 * - Unified storage format for global Quick Tab visibility
 * - SaveId tracking to prevent race conditions
 * - Backward compatible migration from container format
 * - Error handling with user feedback
 * - v1.6.3.10-v10: Version field to detect format and prevent migration race conditions
 *
 * Storage Format (v1.6.2.2+ - Unified, with version field):
 * {
 *   quick_tabs_state_v2: {
 *     tabs: [QuickTab, ...],  // ALL Quick Tabs in one array
 *     saveId: 'timestamp-random',
 *     timestamp: timestamp,
 *     formatVersion: 2        // v1.6.3.10-v10: Format version for migration detection
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
 *     timestamp: timestamp,
 *     formatVersion: 1        // Implicit for container format, or missing
 *   }
 * }
 */

// v1.6.3.10-v10 - FIX Issue P: Format version constants
const FORMAT_VERSION_CONTAINER = 1;
const FORMAT_VERSION_UNIFIED = 2;

export class SyncStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.STORAGE_KEY = 'quick_tabs_state_v2';
    // v1.6.3.10-v10 - FIX Issue P: Migration lock to prevent concurrent migrations
    this._migrationInProgress = false;
    this._migrationPromise = null;
  }

  /**
   * Save Quick Tabs to unified storage format
   * v1.6.2.2 - Unified format (no container separation)
   * v1.6.3.10-v10 - FIX Issue P: Include formatVersion field
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
        timestamp: Date.now(),
        // v1.6.3.10-v10 - FIX Issue P: Always include format version
        formatVersion: FORMAT_VERSION_UNIFIED
      }
    };

    const size = this._calculateSize(stateToSave);

    try {
      await browser.storage.local.set(stateToSave);
      console.log(
        `[SyncStorageAdapter] Saved ${tabs.length} tabs (unified format v${FORMAT_VERSION_UNIFIED}, saveId: ${saveId}, size: ${size} bytes)`
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
   * Load Quick Tabs from unified storage format
   * v1.6.2.2 - Returns unified format, migrates from container format if needed
   * v1.6.3.10-v10 - FIX Issue P: Atomic migration with version checking
   *
   * @returns {Promise<{tabs: Array, timestamp: number}|null>} Unified state or null if not found
   */
  async load() {
    const state = await this._loadRawState();
    
    // v1.6.3.10-v10 - FIX Issue P: Detect format using version field
    const detectedFormat = this._detectStorageFormat(state);
    
    console.log('[SyncStorageAdapter] v1.6.3.10-v10 Format detection:', {
      detectedFormat,
      hasFormatVersion: state.formatVersion !== undefined,
      formatVersion: state.formatVersion,
      hasContainers: !!state.containers,
      hasTabs: !!state.tabs,
      tabCount: state.tabs?.length ?? 0
    });

    // v1.6.2.2+ Unified format - return directly
    if (detectedFormat === 'unified') {
      if (state.tabs.length === 0) {
        return null;
      }
      return {
        tabs: state.tabs,
        timestamp: state.timestamp || Date.now()
      };
    }

    // Container format - needs migration
    if (detectedFormat === 'container') {
      return this._performAtomicMigration(state);
    }

    // Empty or unknown format
    return null;
  }

  /**
   * Detect storage format based on state structure
   * v1.6.3.10-v10 - FIX Issue P: Determine format for migration decision
   * @private
   * @param {Object} state - Raw state object
   * @returns {'unified'|'container'|'empty'} Detected format type
   */
  _detectStorageFormat(state) {
    // Check explicit version field first
    if (state.formatVersion === FORMAT_VERSION_UNIFIED) {
      return 'unified';
    }
    if (state.formatVersion === FORMAT_VERSION_CONTAINER) {
      return 'container';
    }
    
    // Infer from structure (pre-version field data)
    if (state.tabs && Array.isArray(state.tabs)) {
      return 'unified';
    }
    if (state.containers && typeof state.containers === 'object') {
      return 'container';
    }
    
    return 'empty';
  }

  /**
   * Perform atomic migration from container to unified format
   * v1.6.3.10-v10 - FIX Issue P: Prevents race condition during migration
   * v1.6.3.10-v10 - FIX Gap 2.2: Migration trace logging with correlation ID
   * 
   * RACE CONDITION ADDRESSED:
   * - Tab A calls load() → finds container format → starts migration
   * - Tab B calls _saveRawState() → overwrites container format
   * - Tab A's migration returns incomplete data
   * 
   * SOLUTION:
   * - Use migration lock to serialize migrations
   * - Re-read state after lock acquisition to verify format hasn't changed
   * - Include formatVersion in saved state to prevent re-migration
   * 
   * @private
   * @param {Object} state - State with container format
   * @returns {Promise<{tabs: Array, timestamp: number}|null>}
   */
  _performAtomicMigration(state) {
    // v1.6.3.10-v10 - FIX Gap 2.2: Generate migration correlation ID
    const migrationCorrelationId = `migration-${new Date().toISOString()}-${Math.random().toString(36).substring(2, 8)}`;
    
    // v1.6.3.10-v10 - FIX Issue P: Prevent concurrent migrations
    if (this._migrationInProgress) {
      console.log('[StorageAdapter] MIGRATION_BLOCKED:', {
        correlationId: migrationCorrelationId,
        reason: 'already_in_progress',
        timestamp: new Date().toISOString()
      });
      // Wait for existing migration to complete
      if (this._migrationPromise) {
        return this._migrationPromise;
      }
    }
    
    this._migrationInProgress = true;
    
    this._migrationPromise = (async () => {
      try {
        // v1.6.3.10-v10 - FIX Gap 2.2: Migration STARTED trace
        console.log('[StorageAdapter] MIGRATION_STARTED:', {
          correlationId: migrationCorrelationId,
          phase: 'LOCK_ACQUIRED',
          containerCount: Object.keys(state.containers || {}).length,
          timestamp: new Date().toISOString()
        });
        
        // Re-read state to check if another tab already migrated
        const currentState = await this._loadRawState();
        const currentFormat = this._detectStorageFormat(currentState);
        
        // v1.6.3.10-v10 - FIX Gap 2.2: Log re-read result
        console.log('[StorageAdapter] MIGRATION_REREAD:', {
          correlationId: migrationCorrelationId,
          phase: 'STATE_VERIFICATION',
          detectedFormat: currentFormat,
          hasFormatVersion: currentState.formatVersion !== undefined,
          formatVersion: currentState.formatVersion,
          timestamp: new Date().toISOString()
        });
        
        if (currentFormat === 'unified') {
          console.log('[StorageAdapter] MIGRATION_SKIPPED:', {
            correlationId: migrationCorrelationId,
            reason: 'ALREADY_MIGRATED_BY_ANOTHER_TAB',
            tabCount: currentState.tabs?.length ?? 0,
            timestamp: new Date().toISOString()
          });
          return currentState.tabs?.length > 0 ? {
            tabs: currentState.tabs,
            timestamp: currentState.timestamp || Date.now()
          } : null;
        }
        
        // Perform migration
        const containersToMigrate = currentState.containers || state.containers;
        const containerKeys = Object.keys(containersToMigrate || {});
        
        // v1.6.3.10-v10 - FIX Gap 2.2: Log migration data extraction
        console.log('[StorageAdapter] MIGRATION_EXTRACTING:', {
          correlationId: migrationCorrelationId,
          phase: 'DATA_EXTRACTION',
          containerKeys,
          containerCount: containerKeys.length,
          timestamp: new Date().toISOString()
        });
        
        const migratedTabs = this._migrateFromContainerFormat(containersToMigrate);
        
        if (migratedTabs.length === 0) {
          console.log('[StorageAdapter] MIGRATION_COMPLETED:', {
            correlationId: migrationCorrelationId,
            result: 'EMPTY',
            tabCount: 0,
            timestamp: new Date().toISOString()
          });
          return null;
        }
        
        // Save with version field to prevent re-migration
        const migratedState = {
          tabs: migratedTabs,
          saveId: this._generateSaveId(),
          timestamp: Date.now(),
          formatVersion: FORMAT_VERSION_UNIFIED,
          // v1.6.3.10-v10 - Track migration source for debugging
          migratedFrom: 'container_format',
          migratedAt: Date.now()
        };
        
        await this._saveRawState(migratedState);
        
        // v1.6.3.10-v10 - FIX Gap 2.2: Log migration completion
        console.log('[StorageAdapter] MIGRATION_COMPLETED:', {
          correlationId: migrationCorrelationId,
          result: 'SUCCESS',
          tabCount: migratedTabs.length,
          formatVersion: FORMAT_VERSION_UNIFIED,
          saveId: migratedState.saveId,
          timestamp: new Date().toISOString()
        });
        
        return {
          tabs: migratedTabs,
          timestamp: migratedState.timestamp
        };
      } finally {
        this._migrationInProgress = false;
        this._migrationPromise = null;
      }
    })();
    
    return this._migrationPromise;
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
   * v1.6.3.10-v10 - FIX Issue P: Include formatVersion in saves
   *
   * @param {string} quickTabId - Quick Tab ID to delete
   * @returns {Promise<void>}
   */
  async delete(quickTabId) {
    const state = await this._loadRawState();
    const format = this._detectStorageFormat(state);

    // Handle unified format
    if (format === 'unified') {
      const filteredTabs = state.tabs.filter(t => t.id !== quickTabId);

      if (filteredTabs.length === state.tabs.length) {
        console.warn(`[SyncStorageAdapter] Quick Tab ${quickTabId} not found`);
        return;
      }

      await this._saveRawState({
        tabs: filteredTabs,
        saveId: this._generateSaveId(),
        timestamp: Date.now(),
        formatVersion: FORMAT_VERSION_UNIFIED
      });

      console.log(`[SyncStorageAdapter] Deleted Quick Tab ${quickTabId}`);
      return;
    }

    // Backward compatibility: container format migration then delete
    if (format === 'container') {
      const migratedTabs = this._migrateFromContainerFormat(state.containers);
      const filteredTabs = migratedTabs.filter(t => t.id !== quickTabId);

      await this._saveRawState({
        tabs: filteredTabs,
        saveId: this._generateSaveId(),
        timestamp: Date.now(),
        formatVersion: FORMAT_VERSION_UNIFIED
      });

      console.log(
        `[SyncStorageAdapter] Deleted Quick Tab ${quickTabId} (migrated from container format)`
      );
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

    if (!containers || typeof containers !== 'object') {
      return allTabs;
    }

    for (const containerKey of Object.keys(containers)) {
      const tabs = containers[containerKey]?.tabs || [];
      if (tabs.length > 0) {
        console.log(
          `[SyncStorageAdapter] Migrating ${tabs.length} tabs from container: ${containerKey}`
        );
        allTabs.push(...tabs);
      }
    }

    return allTabs;
  }

  /**
   * Load raw state from storage
   * v1.6.2.2 - Only uses local storage (no sync storage fallback)
   * v1.6.3.10-v10 - FIX Issue P: Include formatVersion in empty state
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

      // Return empty state with version
      return {
        tabs: [],
        timestamp: Date.now(),
        saveId: this._generateSaveId(),
        formatVersion: FORMAT_VERSION_UNIFIED
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
        saveId: this._generateSaveId(),
        formatVersion: FORMAT_VERSION_UNIFIED
      };
    }
  }

  /**
   * Save raw state to storage
   * v1.6.3.10-v10 - FIX Issue P: Ensure formatVersion is always present
   * @private
   * @param {Object} state - State to save
   * @returns {Promise<void>}
   */
  async _saveRawState(state) {
    // v1.6.3.10-v10 - FIX Issue P: Ensure version is always set
    const stateWithVersion = {
      ...state,
      formatVersion: state.formatVersion ?? FORMAT_VERSION_UNIFIED
    };
    
    await browser.storage.local.set({
      [this.STORAGE_KEY]: stateWithVersion
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
