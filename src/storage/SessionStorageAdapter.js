import browser from 'webextension-polyfill';

import { StorageAdapter } from './StorageAdapter.js';

/**
 * SessionStorageAdapter - Storage adapter for browser.storage.local API (session-scoped)
 * v1.6.3.10-v7 - FIX Diagnostic Issues #4, #15: Standardized to unified format (matching SyncStorageAdapter)
 * v1.6.3.12-v4 - FIX: Replace browser.storage.session with browser.storage.local (Firefox MV2 compatibility)
 * v1.6.3.12-v5 - FIX Issues #13, #14, #15, #19: Error discrimination and runtime feature detection
 *
 * v1.6.4.16 - FIX Issue #27: Storage Adapter Documentation
 *
 * CANONICAL ADAPTER SELECTION:
 * - **SyncStorageAdapter** is the CANONICAL adapter for Quick Tab persistence
 *   - Uses browser.storage.local for session-scoped state
 *   - Data survives page reload but NOT browser restart (explicit startup cleanup)
 *   - Used for hydration on extension load
 *
 * - **SessionStorageAdapter** is for TEMPORARY session state only
 *   - Uses browser.storage.local (session-scoped via explicit startup cleanup)
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
 * - v1.6.3.12-v5 Issue #13: Error type discrimination (permanent vs transient)
 * - v1.6.3.12-v5 Issues #14, #15, #19: Periodic feature detection
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

// v1.6.3.12-v5 - FIX Issues #14, #15, #19: Feature detection constants
const FEATURE_CHECK_OPERATION_THRESHOLD = 10;
const FEATURE_CHECK_TIME_THRESHOLD_MS = 60000; // 60 seconds

export class SessionStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.STORAGE_KEY = 'quick_tabs_state_v2';

    // v1.6.3.12-v5 - FIX Issues #14, #15, #19: Runtime feature detection
    this.operationCount = 0;
    this.lastFeatureCheck = Date.now();
    this.isLocalAvailable = this._checkLocalStorageAvailability();

    // v1.6.3.12-v4 - FIX: Use storage.local (session-scoped via explicit startup cleanup)
    console.log(
      '[SessionStorageAdapter] Initialized (storage.local - session-scoped with explicit startup cleanup)',
      {
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
   * @returns {string} The error type
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
   * Save Quick Tabs to unified storage format
   * v1.6.3.10-v7 - FIX Issue #4, #15: Standardized to unified format (no container separation)
   * v1.6.3.12-v5 - FIX Issues #13, #14, #15, #19: Feature detection and error handling
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

    // v1.6.3.12-v5 - Check if storage is available
    if (!this.isLocalAvailable) {
      console.error('[STORAGE_API_UNAVAILABLE] save() called but storage.local unavailable');
      throw new Error('Storage API unavailable');
    }

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
      // v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
      await browser.storage.local.set(stateToSave);
      console.log(
        `[SessionStorageAdapter] Saved ${tabs.length} tabs to local storage (unified format, saveId: ${saveId})`
      );
      return saveId;
    } catch (error) {
      // v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
      const errorType = this._handleStorageError(error, 'save');

      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SessionStorageAdapter] Save failed:', {
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
   * v1.6.3.10-v7 - FIX Issue #4, #15: Returns unified format, migrates from container format if needed
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

    // v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
    await browser.storage.local.remove(this.STORAGE_KEY);
    console.log('[SessionStorageAdapter] Cleared all Quick Tabs from local storage');
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
   * v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
   *
   * @private
   * @returns {Promise<Object>} Raw state object
   */
  async _loadRawState() {
    try {
      // v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
      const result = await browser.storage.local.get(this.STORAGE_KEY);

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
      // v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
      const errorType = this._handleStorageError(error, '_loadRawState');

      // DOMException and browser-native errors don't serialize properly
      // Extract properties explicitly for proper logging
      console.error('[SessionStorageAdapter] Load from local storage failed:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        errorType,
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
   * v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
   * @private
   * @param {Object} state - State to save
   * @returns {Promise<void>}
   */
  async _saveRawState(state) {
    try {
      // v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
      await browser.storage.local.set({
        [this.STORAGE_KEY]: state
      });
    } catch (error) {
      // v1.6.3.12-v5 - FIX Issue #13: Error type discrimination
      const errorType = this._handleStorageError(error, '_saveRawState');

      console.error('[SessionStorageAdapter] Save raw state failed:', {
        message: error?.message,
        errorType
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
}
