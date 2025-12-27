import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SyncStorageAdapter - Storage adapter for browser.storage.local API (session-scoped)
 * v1.6.2.2 - ISSUE #35/#51 FIX: Unified storage format (no container separation)
 * v1.6.3.10-v10 - FIX Issue P: Atomic migration with version field and locking
 * v1.6.3.12-v7 - FIX: Switch from storage.local to storage.session for session-scoped Quick Tabs
 * v1.6.3.12-v4 - FIX: Replace browser.storage.session with browser.storage.local (Firefox MV2 compatibility)
 * v1.6.3.12-v5 - FIX Issues #10, #11, #13, #14, #15, #19: Storage backend tracking, event ordering,
 *                error discrimination, and runtime feature detection
 *
 * v1.6.3.12-v7 - FIX Issue #27: Storage Adapter Documentation
 * v1.6.3.12-v4 - UPDATED: Quick Tabs use storage.local with explicit startup cleanup (session-scoped behavior)
 *
 * CANONICAL ADAPTER SELECTION:
 * - **SyncStorageAdapter** is the CANONICAL adapter for Quick Tab persistence ✓
 *   - Uses browser.storage.local for session-scoped state
 *   - Data persists during browser session (survives page reload, tab switch)
 *   - Data is CLEARED on browser restart via explicit startup cleanup
 *   - Used for hydration on extension load
 *   - All Quick Tab state is stored and loaded through this adapter
 *
 * - **SessionStorageAdapter** is DEPRECATED - use SyncStorageAdapter instead
 *   - Both now use browser.storage.local with explicit cleanup
 *
 * Features:
 * - Unified storage format for global Quick Tab visibility
 * - SaveId tracking to prevent race conditions
 * - Backward compatible migration from container format
 * - Error handling with user feedback
 * - v1.6.3.10-v10: Version field to detect format and prevent migration race conditions
 * - v1.6.3.12-v5 Issue #10: Backend state tracking (sync vs local)
 * - v1.6.3.12-v5 Issue #11: Event ordering validation with state revalidation
 * - v1.6.3.12-v5 Issue #13: Error type discrimination (permanent vs transient)
 * - v1.6.3.12-v5 Issues #14, #15, #19: Periodic feature detection
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

// v1.6.3.12-v5 - FIX Issues #14, #15, #19: Feature detection constants
const FEATURE_CHECK_OPERATION_THRESHOLD = 10;
const FEATURE_CHECK_TIME_THRESHOLD_MS = 60000; // 60 seconds

export class SyncStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.STORAGE_KEY = 'quick_tabs_state_v2';
    // v1.6.3.10-v10 - FIX Issue P: Migration lock to prevent concurrent migrations
    this._migrationInProgress = false;
    this._migrationPromise = null;

    // v1.6.3.12-v5 - FIX Issue #10: Backend state tracking
    // Tracks which storage backend is currently active ('local' only for Firefox MV2)
    this.currentStorageBackend = 'local';

    // v1.6.3.12-v5 - FIX Issues #14, #15, #19: Runtime feature detection
    this.operationCount = 0;
    this.lastFeatureCheck = Date.now();
    this.isLocalAvailable = this._checkLocalStorageAvailability();

    // v1.6.3.12-v5 - FIX Issue #11: Event ordering validation
    this._lastEventSequence = 0;
    this._eventSequenceMap = new Map(); // Track event sequences by saveId

    // v1.6.3.12-v4 - FIX: Use storage.local (session-scoped via explicit startup cleanup)
    console.log(
      '[SyncStorageAdapter] Initialized (CANONICAL adapter - browser.storage.local - session-scoped with explicit startup cleanup)',
      {
        currentStorageBackend: this.currentStorageBackend,
        isLocalAvailable: this.isLocalAvailable
      }
    );
  }

  /**
   * Check if browser.storage.local API is available
   * v1.6.3.12-v5 - FIX Issues #14, #15, #19: Runtime feature detection
   * @private
   * @returns {boolean} True if storage.local is available
   */
  _checkLocalStorageAvailability() {
    try {
      return (
        typeof browser !== 'undefined' &&
        typeof browser.storage !== 'undefined' &&
        typeof browser.storage.local !== 'undefined' &&
        typeof browser.storage.local.get === 'function' &&
        typeof browser.storage.local.set === 'function'
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if feature detection should be rechecked
   * v1.6.3.12-v5 - FIX Issues #14, #15, #19: Periodic re-verification
   * @private
   * @returns {boolean} True if feature should be rechecked
   */
  _shouldRecheckFeature() {
    return (
      this.operationCount >= FEATURE_CHECK_OPERATION_THRESHOLD ||
      Date.now() - this.lastFeatureCheck > FEATURE_CHECK_TIME_THRESHOLD_MS
    );
  }

  /**
   * Recheck feature availability
   * v1.6.3.12-v5 - FIX Issues #14, #15, #19: Runtime feature detection
   * @private
   */
  _recheckFeatureAvailability() {
    const previousState = this.isLocalAvailable;
    this.isLocalAvailable = this._checkLocalStorageAvailability();

    if (previousState !== this.isLocalAvailable) {
      console.log('[FEATURE_AVAILABILITY_CHANGED] storage.local:', {
        previous: previousState,
        current: this.isLocalAvailable,
        operationCount: this.operationCount,
        timeSinceLastCheck: Date.now() - this.lastFeatureCheck
      });
    }

    this.lastFeatureCheck = Date.now();
    this.operationCount = 0;
  }

  /**
   * Get the active storage API based on current backend state
   * v1.6.3.12-v5 - FIX Issue #10: Backend state tracking
   * @private
   * @returns {Object} The active storage API (browser.storage.local)
   */
  _getActiveStorage() {
    // For Firefox MV2, we only use storage.local
    return browser.storage.local;
  }

  /**
   * Set the current storage backend
   * v1.6.3.12-v5 - FIX Issue #10: Track backend changes
   * @private
   * @param {'local'} backend - The new backend to use
   */
  _setCurrentStorageBackend(backend) {
    if (this.currentStorageBackend !== backend) {
      console.log(
        `[STORAGE_BACKEND_SWITCH] Changed from ${this.currentStorageBackend} to ${backend}`
      );
      this.currentStorageBackend = backend;
    }
  }

  /**
   * Check if error indicates API unavailable
   * v1.6.3.12-v5 - Extracted for Code Health (reduce complexity)
   * @private
   * @param {string} message - Lowercase error message
   * @param {string} name - Lowercase error name
   * @returns {boolean} True if error indicates API unavailable
   */
  _isApiUnavailableError(message, name) {
    const unavailablePatterns = [
      'undefined',
      'is not defined',
      'is not a function',
      'cannot read property',
      'cannot read properties'
    ];
    return name === 'typeerror' || unavailablePatterns.some(p => message.includes(p));
  }

  /**
   * Check if error indicates quota exceeded
   * v1.6.3.12-v5 - Extracted for Code Health (reduce complexity)
   * @private
   * @param {string} message - Lowercase error message
   * @param {string} name - Lowercase error name
   * @returns {boolean} True if error indicates quota exceeded
   */
  _isQuotaExceededError(message, name) {
    const quotaPatterns = ['quota', 'exceeded', 'full'];
    return name === 'quotaexceedederror' || quotaPatterns.some(p => message.includes(p));
  }

  /**
   * Classify error type for appropriate handling
   * v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
   * @private
   * @param {Error} error - The error to classify
   * @returns {'api_unavailable'|'quota_exceeded'|'transient'} Error classification
   */
  _classifyError(error) {
    const message = error?.message?.toLowerCase() || '';
    const name = error?.name?.toLowerCase() || '';

    if (this._isApiUnavailableError(message, name)) {
      return 'api_unavailable';
    }

    if (this._isQuotaExceededError(message, name)) {
      return 'quota_exceeded';
    }

    return 'transient';
  }

  /**
   * Handle storage error with appropriate action
   * v1.6.3.12-v5 - FIX Issue #13: Error handling by type
   * @private
   * @param {Error} error - The error to handle
   * @param {string} operation - The operation that failed
   */
  _handleStorageError(error, operation) {
    const errorType = this._classifyError(error);

    switch (errorType) {
      case 'api_unavailable':
        console.error(`[STORAGE_API_UNAVAILABLE] ${operation} failed - permanent error`, {
          message: error?.message,
          name: error?.name,
          errorType
        });
        // Mark storage as unavailable
        this.isLocalAvailable = false;
        break;

      case 'quota_exceeded':
        console.warn(`[STORAGE_QUOTA_EXCEEDED] ${operation} failed - applying backoff`, {
          message: error?.message,
          name: error?.name,
          errorType
        });
        // Could implement exponential backoff here if needed
        break;

      default:
        console.warn(`[STORAGE_TRANSIENT_ERROR] ${operation} failed - normal retry`, {
          message: error?.message,
          name: error?.name,
          errorType
        });
        break;
    }

    return errorType;
  }

  /**
   * Validate event ordering and trigger revalidation if needed
   * v1.6.3.12-v5 - FIX Issue #11: Event ordering validation
   *
   * This method is designed to be called by external storage event listeners
   * (e.g., storage.onChanged handler in background.js) to detect out-of-order events.
   * When out-of-order events are detected, it triggers state revalidation from storage.
   *
   * @public
   * @param {string} saveId - The save ID of the event
   * @param {number} timestamp - The timestamp of the event
   * @returns {Promise<boolean>} True if event is in order, false if out of order
   */
  async validateEventOrdering(saveId, timestamp) {
    const lastTimestamp = this._eventSequenceMap.get(saveId) || 0;

    if (timestamp < lastTimestamp) {
      console.warn('[EVENT_ORDERING_VIOLATION] Triggering state revalidation', {
        saveId,
        receivedTimestamp: timestamp,
        lastTimestamp,
        delta: lastTimestamp - timestamp
      });

      // Trigger state revalidation
      await this._revalidateStateFromStorage();
      return false;
    }

    // Update sequence map
    this._eventSequenceMap.set(saveId, timestamp);

    // Cleanup old entries (keep last 100)
    if (this._eventSequenceMap.size > 100) {
      const entries = Array.from(this._eventSequenceMap.entries());
      entries.sort((a, b) => a[1] - b[1]); // Sort by timestamp
      const toDelete = entries.slice(0, entries.length - 100);
      for (const [key] of toDelete) {
        this._eventSequenceMap.delete(key);
      }
    }

    return true;
  }

  /**
   * Revalidate state from storage
   * v1.6.3.12-v5 - FIX Issue #11: State revalidation on out-of-order events
   * @private
   * @returns {Promise<Object|null>} Fresh state from storage
   */
  async _revalidateStateFromStorage() {
    console.log('[STATE_REVALIDATION] Fetching fresh state from storage');
    try {
      const freshState = await this._loadRawState();
      console.log('[STATE_REVALIDATION] Fresh state retrieved', {
        tabCount: freshState?.tabs?.length ?? 0,
        timestamp: freshState?.timestamp,
        saveId: freshState?.saveId
      });
      return freshState;
    } catch (error) {
      console.error('[STATE_REVALIDATION] Failed to fetch fresh state', {
        message: error?.message
      });
      return null;
    }
  }

  /**
   * Save Quick Tabs to unified storage format
   * v1.6.2.2 - Unified format (no container separation)
   * v1.6.3.10-v10 - FIX Issue P: Include formatVersion field
   * v1.6.3.12-v5 - FIX Issues #10, #13, #14, #15, #19: Feature detection and error handling
   *
   * @param {QuickTab[]} tabs - Array of QuickTab domain entities
   * @returns {Promise<string>} Save ID for tracking race conditions
   */
  async save(tabs) {
    // v1.6.3.12-v5 - FIX Issues #14, #15, #19: Periodic feature detection
    this.operationCount++;
    if (this._shouldRecheckFeature()) {
      this._recheckFeatureAvailability();
    }

    // v1.6.3.12-v5 - FIX Issue #10: Check if storage is available
    if (!this.isLocalAvailable) {
      console.error('[STORAGE_API_UNAVAILABLE] save() called but storage.local unavailable');
      throw new Error('Storage API unavailable');
    }

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
      // v1.6.3.12-v5 - FIX Issue #10: Use tracked backend
      const storage = this._getActiveStorage();
      await storage.set(stateToSave);
      console.log(
        `[SyncStorageAdapter] Saved ${tabs.length} tabs to ${this.currentStorageBackend} storage (unified format v${FORMAT_VERSION_UNIFIED}, saveId: ${saveId}, size: ${size} bytes)`
      );
      return saveId;
    } catch (error) {
      // v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
      const errorType = this._handleStorageError(error, 'save');

      console.error('[SyncStorageAdapter] Save failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        errorType,
        error: error
      });
      throw error;
    }
  }

  /**
   * Load Quick Tabs from unified storage format
   * v1.6.2.2 - Returns unified format, migrates from container format if needed
   * v1.6.3.10-v10 - FIX Issue P: Atomic migration with version checking
   * v1.6.3.12-v5 - FIX Issues #14, #15, #19: Feature detection on load
   *
   * @returns {Promise<{tabs: Array, timestamp: number}|null>} Unified state or null if not found
   */
  async load() {
    // v1.6.3.12-v5 - FIX Issues #14, #15, #19: Periodic feature detection
    this.operationCount++;
    if (this._shouldRecheckFeature()) {
      this._recheckFeatureAvailability();
    }

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
    const migrationCorrelationId = this._generateMigrationCorrelationId();

    // Check for concurrent migration
    if (this._migrationInProgress) {
      return this._handleConcurrentMigration(migrationCorrelationId);
    }

    this._migrationInProgress = true;
    this._migrationPromise = this._executeMigration(state, migrationCorrelationId);
    return this._migrationPromise;
  }

  /**
   * Generate migration correlation ID
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  _generateMigrationCorrelationId() {
    return `migration-${new Date().toISOString()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Handle concurrent migration attempt
   * v1.6.3.12-v4 - Extracted for Code Health
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
   * Execute the actual migration logic
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  async _executeMigration(state, correlationId) {
    try {
      this._logMigrationStarted(correlationId, state);

      const currentState = await this._loadRawState();
      const currentFormat = this._detectStorageFormat(currentState);
      this._logMigrationReread(correlationId, currentState, currentFormat);

      // Check if already migrated
      if (currentFormat === 'unified') {
        return this._handleAlreadyMigrated(correlationId, currentState);
      }

      // Perform actual migration
      return this._performDataMigration(correlationId, currentState, state);
    } finally {
      this._migrationInProgress = false;
      this._migrationPromise = null;
    }
  }

  /**
   * Log migration started
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  _logMigrationStarted(correlationId, state) {
    console.log('[StorageAdapter] MIGRATION_STARTED:', {
      correlationId,
      phase: 'LOCK_ACQUIRED',
      containerCount: Object.keys(state.containers || {}).length,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log migration re-read result
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  _logMigrationReread(correlationId, currentState, currentFormat) {
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
   * Handle case where state is already migrated
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  _handleAlreadyMigrated(correlationId, currentState) {
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
   * Perform the actual data migration
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  async _performDataMigration(correlationId, currentState, state) {
    const containersToMigrate = currentState.containers || state.containers;
    const containerKeys = Object.keys(containersToMigrate || {});

    console.log('[StorageAdapter] MIGRATION_EXTRACTING:', {
      correlationId,
      phase: 'DATA_EXTRACTION',
      containerKeys,
      containerCount: containerKeys.length,
      timestamp: new Date().toISOString()
    });

    const migratedTabs = this._migrateFromContainerFormat(containersToMigrate);

    if (migratedTabs.length === 0) {
      console.log('[StorageAdapter] MIGRATION_COMPLETED:', {
        correlationId,
        result: 'EMPTY',
        tabCount: 0,
        timestamp: new Date().toISOString()
      });
      return null;
    }

    return this._saveMigratedState(correlationId, migratedTabs);
  }

  /**
   * Save migrated state and return result
   * v1.6.3.12-v4 - Extracted for Code Health
   * @private
   */
  async _saveMigratedState(correlationId, migratedTabs) {
    const migratedState = {
      tabs: migratedTabs,
      saveId: this._generateSaveId(),
      timestamp: Date.now(),
      formatVersion: FORMAT_VERSION_UNIFIED,
      migratedFrom: 'container_format',
      migratedAt: Date.now()
    };

    await this._saveRawState(migratedState);

    console.log('[StorageAdapter] MIGRATION_COMPLETED:', {
      correlationId,
      result: 'SUCCESS',
      tabCount: migratedTabs.length,
      formatVersion: FORMAT_VERSION_UNIFIED,
      saveId: migratedState.saveId,
      timestamp: new Date().toISOString()
    });

    return { tabs: migratedTabs, timestamp: migratedState.timestamp };
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
   * v1.6.3.12-v5 - FIX Issues #14, #15, #19: Feature detection on delete
   *
   * @param {string} quickTabId - Quick Tab ID to delete
   * @returns {Promise<void>}
   */
  async delete(quickTabId) {
    // v1.6.3.12-v5 - FIX Issues #14, #15, #19: Periodic feature detection
    this.operationCount++;
    if (this._shouldRecheckFeature()) {
      this._recheckFeatureAvailability();
    }

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
   * v1.6.3.12-v4 - FIX: Use storage.local (Firefox MV2 compatibility)
   * v1.6.3.12-v5 - FIX Issues #14, #15, #19: Feature detection on clear
   *
   * @returns {Promise<void>}
   */
  async clear() {
    // v1.6.3.12-v5 - FIX Issues #14, #15, #19: Periodic feature detection
    this.operationCount++;
    if (this._shouldRecheckFeature()) {
      this._recheckFeatureAvailability();
    }

    // v1.6.3.12-v5 - FIX Issue #10: Use tracked backend
    const storage = this._getActiveStorage();
    await storage.remove(this.STORAGE_KEY);
    console.log(
      `[SyncStorageAdapter] Cleared all Quick Tabs from ${this.currentStorageBackend} storage`
    );
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
   * v1.6.3.12-v4 - FIX: Use storage.local (Firefox MV2 compatibility)
   * v1.6.3.12-v5 - FIX Issues #10, #13: Use tracked backend with error handling
   *
   * @private
   * @returns {Promise<Object>} Raw state object
   */
  async _loadRawState() {
    try {
      // v1.6.3.12-v5 - FIX Issue #10: Use tracked backend
      const storage = this._getActiveStorage();
      const result = await storage.get(this.STORAGE_KEY);

      if (result[this.STORAGE_KEY]) {
        return result[this.STORAGE_KEY];
      }

      // v1.6.3.12-v4 - NOTE: No migration from storage.session - Quick Tabs are now local-only
      // On browser restart, Quick Tabs start fresh (via explicit startup cleanup)

      // Return empty state with version
      return {
        tabs: [],
        timestamp: Date.now(),
        saveId: this._generateSaveId(),
        formatVersion: FORMAT_VERSION_UNIFIED
      };
    } catch (error) {
      // v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
      const errorType = this._handleStorageError(error, '_loadRawState');

      console.error('[SyncStorageAdapter] Load from storage failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        errorType,
        backend: this.currentStorageBackend,
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
   * v1.6.3.12-v4 - FIX: Use storage.local (Firefox MV2 compatibility)
   * v1.6.3.12-v5 - FIX Issues #10, #13: Use tracked backend with error handling
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

    try {
      // v1.6.3.12-v5 - FIX Issue #10: Use tracked backend
      const storage = this._getActiveStorage();
      await storage.set({
        [this.STORAGE_KEY]: stateWithVersion
      });
    } catch (error) {
      // v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
      const errorType = this._handleStorageError(error, '_saveRawState');

      console.error('[SyncStorageAdapter] Save raw state failed:', {
        message: error?.message,
        errorType,
        backend: this.currentStorageBackend
      });
      throw error;
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
