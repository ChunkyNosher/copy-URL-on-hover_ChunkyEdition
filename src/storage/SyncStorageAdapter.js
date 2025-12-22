import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SyncStorageAdapter - Storage adapter for browser.storage.local API
 * v1.6.2.2 - ISSUE #35/#51 FIX: Unified storage format (no container separation)
 * v1.6.3.10-v10 - FIX Issue P: Atomic migration with version field and locking
 *
 * v1.6.4.16 - FIX Issue #27: Storage Adapter Documentation
 *
 * v1.6.3.11-v2 - FIX Issue #69: Storage Quota Exceeded Detection
 *   - Added preflight quota check before writes
 *   - Added write verification (read-back after write)
 *   - Added garbage collection for oldest Quick Tabs when quota exceeded
 *   - Added local quota check using browser.storage.local.getBytesInUse()
 *
 * CANONICAL ADAPTER SELECTION:
 * - **SyncStorageAdapter** is the CANONICAL adapter for Quick Tab persistence ✓
 *   - Uses browser.storage.local for permanent state
 *   - Data survives browser restart
 *   - Used for hydration on extension load
 *   - All Quick Tab state is stored and loaded through this adapter
 *
 * - **SessionStorageAdapter** is for TEMPORARY session state only
 *   - Uses browser.storage.session (cleared on browser close)
 *   - NOT used for Quick Tab persistence
 *
 * Features:
 * - Unified storage format for global Quick Tab visibility
 * - SaveId tracking to prevent race conditions
 * - Backward compatible migration from container format
 * - Error handling with user feedback
 * - v1.6.3.10-v10: Version field to detect format and prevent migration race conditions
 * - v1.6.3.11-v2: Storage quota detection and write verification
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

// v1.6.3.11-v2 - FIX Issue #69: Storage quota constants
// Firefox storage.local quota is 10MB by default
const STORAGE_LOCAL_QUOTA_BYTES = 10 * 1024 * 1024; // 10MB
// Minimum headroom to maintain before blocking writes
const STORAGE_QUOTA_HEADROOM_BYTES = 500 * 1024; // 500KB
// Warning threshold percentage
const STORAGE_QUOTA_WARNING_THRESHOLD = 0.8; // 80%
// Maximum number of oldest Quick Tabs to garbage collect at once
const GARBAGE_COLLECTION_MAX_TABS = 10;

export class SyncStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.STORAGE_KEY = 'quick_tabs_state_v2';
    // v1.6.3.10-v10 - FIX Issue P: Migration lock to prevent concurrent migrations
    this._migrationInProgress = false;
    this._migrationPromise = null;
    console.log('[SyncStorageAdapter] Initialized (CANONICAL adapter - browser.storage.local)');
  }

  /**
   * Save Quick Tabs to unified storage format
   * v1.6.2.2 - Unified format (no container separation)
   * v1.6.3.10-v10 - FIX Issue P: Include formatVersion field
   * v1.6.3.11-v2 - FIX Issue #69: Added quota check, write verification, and garbage collection
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

    // v1.6.3.11-v2 - FIX Issue #69: Preflight quota check
    const quotaCheck = await this._checkStorageQuota(size);
    if (!quotaCheck.canWrite) {
      console.warn('[SyncStorageAdapter] QUOTA_EXCEEDED: Attempting garbage collection', {
        bytesNeeded: size,
        bytesAvailable: quotaCheck.bytesAvailable,
        tabsToSave: tabs.length
      });

      // Attempt garbage collection and retry
      const gcResult = await this._garbageCollectOldestTabs(stateToSave[this.STORAGE_KEY].tabs);
      if (!gcResult.success) {
        throw new Error(
          `Storage quota exceeded: need ${size} bytes, only ${quotaCheck.bytesAvailable} available`
        );
      }

      // Update state with GC'd tabs
      stateToSave[this.STORAGE_KEY].tabs = gcResult.remainingTabs;
      console.log('[SyncStorageAdapter] GARBAGE_COLLECTION_COMPLETE:', {
        removedCount: gcResult.removedCount,
        remainingCount: gcResult.remainingTabs.length
      });
    }

    try {
      await browser.storage.local.set(stateToSave);

      // v1.6.3.11-v2 - FIX Issue #69: Verify write succeeded by reading back
      const verifyResult = await this._verifyWriteSuccess(saveId);
      if (!verifyResult.success) {
        console.error('[SyncStorageAdapter] WRITE_VERIFICATION_FAILED:', {
          expectedSaveId: saveId,
          actualSaveId: verifyResult.actualSaveId,
          tabCount: tabs.length
        });
        throw new Error('Storage write verification failed - data may not have been persisted');
      }

      console.log(
        `[SyncStorageAdapter] Saved ${tabs.length} tabs (unified format v${FORMAT_VERSION_UNIFIED}, saveId: ${saveId}, size: ${size} bytes, verified: true)`
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
   * v1.6.3.11-v2 - FIX Issue #69: Check storage quota before write
   * @private
   * @param {number} bytesToWrite - Bytes about to be written
   * @returns {Promise<{canWrite: boolean, bytesUsed: number, bytesAvailable: number, usagePercent: number}>}
   */
  async _checkStorageQuota(bytesToWrite) {
    try {
      // Try browser.storage.local.getBytesInUse (Firefox-specific)
      let bytesUsed = 0;
      if (browser.storage.local.getBytesInUse) {
        bytesUsed = await browser.storage.local.getBytesInUse(null);
      } else {
        // Fallback: estimate from current state
        const currentState = await this._loadRawState();
        bytesUsed = this._calculateSize({ [this.STORAGE_KEY]: currentState });
      }

      const bytesAvailable = STORAGE_LOCAL_QUOTA_BYTES - bytesUsed;
      const usagePercent = (bytesUsed / STORAGE_LOCAL_QUOTA_BYTES) * 100;

      console.log('[SyncStorageAdapter] QUOTA_CHECK:', {
        bytesUsed,
        bytesAvailable,
        bytesToWrite,
        usagePercent: usagePercent.toFixed(2) + '%',
        quota: STORAGE_LOCAL_QUOTA_BYTES
      });

      // Check if we have enough headroom
      const canWrite = bytesAvailable - bytesToWrite > STORAGE_QUOTA_HEADROOM_BYTES;

      // Emit warning if above threshold
      if (usagePercent > STORAGE_QUOTA_WARNING_THRESHOLD * 100) {
        console.warn('[SyncStorageAdapter] STORAGE_QUOTA_WARNING:', {
          usagePercent: usagePercent.toFixed(2) + '%',
          threshold: STORAGE_QUOTA_WARNING_THRESHOLD * 100 + '%',
          bytesAvailable
        });
      }

      return { canWrite, bytesUsed, bytesAvailable, usagePercent };
    } catch (err) {
      console.warn('[SyncStorageAdapter] Quota check failed, allowing write:', err.message);
      return {
        canWrite: true,
        bytesUsed: 0,
        bytesAvailable: STORAGE_LOCAL_QUOTA_BYTES,
        usagePercent: 0
      };
    }
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #69: Verify write succeeded by reading back
   * @private
   * @param {string} expectedSaveId - Save ID that should be in storage
   * @returns {Promise<{success: boolean, actualSaveId: string|null}>}
   */
  async _verifyWriteSuccess(expectedSaveId) {
    try {
      const result = await browser.storage.local.get(this.STORAGE_KEY);
      const state = result[this.STORAGE_KEY];

      if (!state) {
        return { success: false, actualSaveId: null };
      }

      if (state.saveId === expectedSaveId) {
        return { success: true, actualSaveId: state.saveId };
      }

      // SaveId doesn't match - write may have been overwritten or silently failed
      return { success: false, actualSaveId: state.saveId };
    } catch (err) {
      console.error('[SyncStorageAdapter] Write verification read failed:', err.message);
      return { success: false, actualSaveId: null };
    }
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #69: Garbage collect oldest Quick Tabs to free space
   * @private
   * @param {Array} tabs - Current tabs array
   * @returns {{success: boolean, removedCount: number, remainingTabs: Array}}
   */
  _garbageCollectOldestTabs(tabs) {
    if (!Array.isArray(tabs) || tabs.length === 0) {
      return { success: false, removedCount: 0, remainingTabs: tabs || [] };
    }

    // Sort by timestamp/createdAt to find oldest
    const sortedTabs = [...tabs].sort((a, b) => {
      const aTime = a.createdAt || a.timestamp || 0;
      const bTime = b.createdAt || b.timestamp || 0;
      return aTime - bTime; // Oldest first
    });

    // Remove oldest tabs up to limit
    const tabsToRemove = Math.min(GARBAGE_COLLECTION_MAX_TABS, Math.ceil(tabs.length * 0.2)); // Remove up to 20% or max limit
    const removedTabs = sortedTabs.slice(0, tabsToRemove);
    const remainingTabs = sortedTabs.slice(tabsToRemove);

    console.log('[SyncStorageAdapter] GARBAGE_COLLECTION:', {
      originalCount: tabs.length,
      removedCount: removedTabs.length,
      remainingCount: remainingTabs.length,
      removedIds: removedTabs.map(t => t.id),
      oldestRemovedTimestamp: removedTabs[0]?.createdAt || removedTabs[0]?.timestamp
    });

    return {
      success: remainingTabs.length < tabs.length,
      removedCount: removedTabs.length,
      remainingTabs
    };
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
   * - v1.6.3.11-v2 - FIX Issue #32: Added validation and rollback marker
   *
   * @private
   * @param {Object} state - State with container format
   * @returns {Promise<{tabs: Array, timestamp: number}|null>}
   */
  _performAtomicMigration(state) {
    const correlationId = this._generateMigrationCorrelationId();

    if (this._migrationInProgress) {
      return this._handleConcurrentMigration(correlationId);
    }

    this._migrationInProgress = true;
    this._migrationPromise = this._executeMigration(state, correlationId);
    return this._migrationPromise;
  }

  /**
   * v1.6.3.11-v2 - Generate migration correlation ID
   * @private
   */
  _generateMigrationCorrelationId() {
    return `migration-${new Date().toISOString()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * v1.6.3.11-v2 - Handle concurrent migration attempt
   * @private
   */
  _handleConcurrentMigration(correlationId) {
    console.log('[StorageAdapter] MIGRATION_BLOCKED:', {
      correlationId,
      reason: 'already_in_progress',
      timestamp: new Date().toISOString()
    });
    return this._migrationPromise || Promise.resolve(null);
  }

  /**
   * v1.6.3.11-v2 - Execute the migration operation
   * @private
   */
  async _executeMigration(state, correlationId) {
    let backupState = null;

    try {
      console.log('[StorageAdapter] MIGRATION_STARTED:', {
        correlationId,
        phase: 'LOCK_ACQUIRED',
        containerCount: Object.keys(state.containers || {}).length,
        timestamp: new Date().toISOString()
      });

      const currentState = await this._loadRawState();
      this._clearStaleMarker(currentState, correlationId);

      const currentFormat = this._detectStorageFormat(currentState);
      this._logMigrationReread(correlationId, currentFormat, currentState);

      if (currentFormat === 'unified') {
        return this._returnExistingUnifiedState(currentState, correlationId);
      }

      const containersToMigrate = currentState.containers || state.containers;
      const validationResult = this._validateContainerData(containersToMigrate, correlationId);
      if (!validationResult.valid) {
        this._logValidationFailure(correlationId, validationResult.errors, containersToMigrate);
        return null;
      }

      backupState = JSON.parse(JSON.stringify(currentState));
      await this._setMigrationMarker(currentState, correlationId);

      const migratedTabs = this._migrateFromContainerFormat(containersToMigrate);
      if (migratedTabs.length === 0) {
        return this._handleEmptyMigration(correlationId);
      }

      const tabValidation = this._validateMigratedTabs(migratedTabs, correlationId);
      if (!tabValidation.valid) {
        await this._rollbackMigration(backupState, correlationId, 'output_validation');
        return null;
      }

      const migratedState = this._buildMigratedState(migratedTabs);
      await this._saveRawState(migratedState);

      const verified = await this._verifyMigration(migratedTabs, correlationId);
      if (!verified) {
        await this._rollbackMigration(backupState, correlationId, 'verification');
        return null;
      }

      this._logMigrationSuccess(correlationId, migratedTabs.length, migratedState.saveId);
      return { tabs: migratedTabs, timestamp: migratedState.timestamp };
    } catch (error) {
      await this._handleMigrationError(error, backupState, correlationId);
      return null;
    } finally {
      this._migrationInProgress = false;
      this._migrationPromise = null;
    }
  }

  /**
   * v1.6.3.11-v2 - Clear stale migration marker
   * @private
   */
  _clearStaleMarker(currentState, correlationId) {
    if (currentState._migrationInProgress) {
      console.warn('[StorageAdapter] MIGRATION_RECOVERY: Found incomplete migration marker', {
        correlationId,
        markerTimestamp: currentState._migrationStartedAt
      });
      delete currentState._migrationInProgress;
      delete currentState._migrationStartedAt;
    }
  }

  /**
   * v1.6.3.11-v2 - Log migration re-read result
   * @private
   */
  _logMigrationReread(correlationId, currentFormat, currentState) {
    console.log('[StorageAdapter] MIGRATION_REREAD:', {
      correlationId,
      phase: 'STATE_VERIFICATION',
      detectedFormat: currentFormat,
      hasFormatVersion: currentState.formatVersion !== undefined,
      formatVersion: currentState.formatVersion,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * v1.6.3.11-v2 - Return existing unified state
   * @private
   */
  _returnExistingUnifiedState(currentState, correlationId) {
    console.log('[StorageAdapter] MIGRATION_SKIPPED:', {
      correlationId,
      reason: 'ALREADY_MIGRATED_BY_ANOTHER_TAB',
      tabCount: currentState.tabs?.length ?? 0,
      timestamp: new Date().toISOString()
    });
    return currentState.tabs?.length > 0
      ? { tabs: currentState.tabs, timestamp: currentState.timestamp || Date.now() }
      : null;
  }

  /**
   * v1.6.3.11-v2 - Log validation failure
   * @private
   */
  _logValidationFailure(correlationId, errors, containers) {
    console.error('[StorageAdapter] MIGRATION_VALIDATION_FAILED:', {
      correlationId,
      errors,
      containerCount: Object.keys(containers || {}).length
    });
  }

  /**
   * v1.6.3.11-v2 - Set migration in-progress marker
   * @private
   */
  async _setMigrationMarker(currentState, correlationId) {
    console.log('[StorageAdapter] MIGRATION_EXTRACTING:', {
      correlationId,
      phase: 'DATA_EXTRACTION',
      timestamp: new Date().toISOString()
    });
    await this._saveRawState({
      ...currentState,
      _migrationInProgress: true,
      _migrationStartedAt: Date.now(),
      _migrationCorrelationId: correlationId
    });
  }

  /**
   * v1.6.3.11-v2 - Handle empty migration result
   * @private
   */
  async _handleEmptyMigration(correlationId) {
    await this._saveRawState({
      tabs: [],
      saveId: this._generateSaveId(),
      timestamp: Date.now(),
      formatVersion: FORMAT_VERSION_UNIFIED
    });
    console.log('[StorageAdapter] MIGRATION_COMPLETED:', {
      correlationId,
      result: 'EMPTY',
      tabCount: 0,
      timestamp: new Date().toISOString()
    });
    return null;
  }

  /**
   * v1.6.3.11-v2 - Build migrated state object
   * @private
   */
  _buildMigratedState(migratedTabs) {
    return {
      tabs: migratedTabs,
      saveId: this._generateSaveId(),
      timestamp: Date.now(),
      formatVersion: FORMAT_VERSION_UNIFIED,
      migratedFrom: 'container_format',
      migratedAt: Date.now()
    };
  }

  /**
   * v1.6.3.11-v2 - Verify migration succeeded
   * @private
   */
  async _verifyMigration(migratedTabs, correlationId) {
    const verifyState = await this._loadRawState();
    const verified =
      verifyState.formatVersion === FORMAT_VERSION_UNIFIED &&
      Array.isArray(verifyState.tabs) &&
      verifyState.tabs.length === migratedTabs.length;
    if (!verified) {
      console.error('[StorageAdapter] MIGRATION_VERIFICATION_FAILED:', {
        correlationId,
        expectedTabs: migratedTabs.length,
        actualTabs: verifyState.tabs?.length,
        formatVersion: verifyState.formatVersion
      });
    }
    return verified;
  }

  /**
   * v1.6.3.11-v2 - Rollback migration
   * @private
   */
  async _rollbackMigration(backupState, correlationId, reason) {
    if (!backupState) return;
    console.error('[StorageAdapter] MIGRATION_OUTPUT_VALIDATION_FAILED:', {
      correlationId,
      reason,
      attemptingRollback: true
    });
    await this._saveRawState(backupState);
    console.log('[StorageAdapter] MIGRATION_ROLLBACK_COMPLETE:', { correlationId, reason });
  }

  /**
   * v1.6.3.11-v2 - Log migration success
   * @private
   */
  _logMigrationSuccess(correlationId, tabCount, saveId) {
    console.log('[StorageAdapter] MIGRATION_COMPLETED:', {
      correlationId,
      result: 'SUCCESS',
      tabCount,
      formatVersion: FORMAT_VERSION_UNIFIED,
      saveId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * v1.6.3.11-v2 - Handle migration error with rollback
   * @private
   */
  async _handleMigrationError(error, backupState, correlationId) {
    console.error('[StorageAdapter] MIGRATION_ERROR:', {
      correlationId,
      error: error.message,
      attemptingRollback: !!backupState
    });
    if (backupState) {
      try {
        await this._saveRawState(backupState);
        console.log('[StorageAdapter] MIGRATION_ROLLBACK_ON_ERROR:', { correlationId });
      } catch (rollbackError) {
        console.error('[StorageAdapter] MIGRATION_ROLLBACK_FAILED:', {
          correlationId,
          error: rollbackError.message
        });
      }
    }
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #32: Validate container data before migration
   * @private
   * @param {Object} containers - Container data to validate
   * @param {string} correlationId - Correlation ID for logging
   * @returns {{valid: boolean, errors: string[]}}
   */
  _validateContainerData(containers, correlationId) {
    const errors = [];

    if (!containers || typeof containers !== 'object') {
      errors.push('Containers data is null or not an object');
      return { valid: false, errors };
    }

    for (const [containerKey, containerData] of Object.entries(containers)) {
      this._validateSingleContainer(containerKey, containerData, errors);
    }

    if (errors.length > 0) {
      console.log('[StorageAdapter] MIGRATION_PRE_VALIDATION:', {
        correlationId,
        errorCount: errors.length,
        errors: errors.slice(0, 10) // Limit log output
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #32: Validate a single container's data
   * @private
   */
  _validateSingleContainer(containerKey, containerData, errors) {
    if (!containerData || typeof containerData !== 'object') {
      errors.push(`Container "${containerKey}" is not an object`);
      return;
    }

    const tabs = containerData.tabs;
    if (tabs !== undefined && !Array.isArray(tabs)) {
      errors.push(`Container "${containerKey}" tabs is not an array`);
      return;
    }

    if (Array.isArray(tabs)) {
      this._validateContainerTabs(containerKey, tabs, errors);
    }
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #32: Validate tabs within a container
   * @private
   */
  _validateContainerTabs(containerKey, tabs, errors) {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (!tab || typeof tab !== 'object') {
        errors.push(`Container "${containerKey}" tab[${i}] is not an object`);
        continue;
      }
      if (!tab.id) errors.push(`Container "${containerKey}" tab[${i}] missing id`);
      if (!tab.url) errors.push(`Container "${containerKey}" tab[${i}] missing url`);
    }
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #32: Validate migrated tabs before saving
   * @private
   * @param {Array} tabs - Migrated tabs array
   * @param {string} correlationId - Correlation ID for logging
   * @returns {{valid: boolean, errors: string[]}}
   */
  _validateMigratedTabs(tabs, correlationId) {
    const errors = [];

    if (!Array.isArray(tabs)) {
      errors.push('Migrated tabs is not an array');
      return { valid: false, errors };
    }

    for (let i = 0; i < tabs.length; i++) {
      this._validateSingleMigratedTab(tabs[i], i, errors);
    }

    if (errors.length > 0) {
      console.log('[StorageAdapter] MIGRATION_POST_VALIDATION:', {
        correlationId,
        tabCount: tabs.length,
        errorCount: errors.length,
        errors: errors.slice(0, 10)
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * v1.6.3.11-v2 - FIX Issue #32: Validate a single migrated tab
   * @private
   */
  _validateSingleMigratedTab(tab, index, errors) {
    if (!tab || typeof tab !== 'object') {
      errors.push(`Migrated tab[${index}] is not an object`);
      return;
    }
    if (!tab.id || typeof tab.id !== 'string') {
      errors.push(`Migrated tab[${index}] has invalid id`);
    }
    if (!tab.url || typeof tab.url !== 'string') {
      errors.push(`Migrated tab[${index}] has invalid url`);
    }
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
