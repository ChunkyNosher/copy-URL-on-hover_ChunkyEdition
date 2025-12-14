/**
 * StorageManager - Centralized storage operations with validation
 *
 * Features:
 * - Deduplication via correlationId
 * - Readback validation to detect corruption
 * - Retry logic with exponential backoff
 * - Storage recovery mechanisms
 *
 * @module storage/storage-manager
 * @version 1.6.3.9 - GAP-7: Import shared dedup constant
 */

import { STORAGE_KEY, getEmptyState, isValidState, SCHEMA_VERSION } from './schema-v2.js';
import { MESSAGE_DEDUP_WINDOW_MS } from '../constants.js';

// v1.6.3.8-v13 - GAP-7: Use shared constant for deduplication window
const DEDUP_WINDOW_MS = MESSAGE_DEDUP_WINDOW_MS;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [100, 200, 400]; // Exponential backoff

/**
 * StorageManager class for centralized storage operations
 */
export class StorageManager {
  /**
   * Create a StorageManager instance
   *
   * @param {string} storageKey - Storage key to use (defaults to STORAGE_KEY)
   */
  constructor(storageKey = STORAGE_KEY) {
    this.storageKey = storageKey;
    this.lastWriteCorrelationId = null;
    this.lastWriteTime = 0;
    this.writeMetrics = {
      totalWrites: 0,
      successfulWrites: 0,
      failedWrites: 0,
      retriesNeeded: 0,
      duplicatesSkipped: 0
    };
  }

  /**
   * Read state from storage
   *
   * @returns {Promise<Object>} Current state or empty state if invalid/missing
   */
  async readState() {
    try {
      const result = await browser.storage.local.get(this.storageKey);
      const state = result[this.storageKey];

      if (!state || !isValidState(state)) {
        console.log('[StorageManager] No valid state found, returning empty state');
        return getEmptyState();
      }

      return state;
    } catch (error) {
      console.error('[StorageManager] Read error:', error);
      return getEmptyState();
    }
  }

  /**
   * Write state with validation and retry logic
   *
   * @param {Object} newState - State to write
   * @param {string} correlationId - Unique ID for deduplication
   * @returns {Promise<Object>} Result with success status
   */
  async writeStateWithValidation(newState, correlationId) {
    // Check for duplicate write
    if (this._isDuplicateWrite(correlationId)) {
      this.writeMetrics.duplicatesSkipped++;
      console.log('[StorageManager] Duplicate write skipped:', correlationId);
      return { success: true, skipped: true };
    }

    this.lastWriteCorrelationId = correlationId;
    this.lastWriteTime = Date.now();
    this.writeMetrics.totalWrites++;

    // Ensure state has latest modification time and version
    const stateToWrite = {
      ...newState,
      version: SCHEMA_VERSION,
      lastModified: Date.now()
    };

    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const result = await this._executeWriteAttempt(stateToWrite, correlationId, attempt);

      if (result.success) {
        return result;
      }

      lastError = result.error;
      if (attempt < MAX_RETRIES - 1) {
        await this._delay(RETRY_DELAYS[attempt]);
      }
    }

    // All retries failed
    this.writeMetrics.failedWrites++;
    console.error('[StorageManager] All write attempts failed:', lastError);

    // Trigger recovery
    await this.triggerStorageRecovery(correlationId);

    return { success: false, error: lastError?.message };
  }

  /**
   * Execute a single write attempt with validation
   *
   * @param {Object} stateToWrite - State to write
   * @param {string} correlationId - Correlation ID for logging
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {Promise<Object>} Result with success flag
   * @private
   */
  async _executeWriteAttempt(stateToWrite, correlationId, attempt) {
    try {
      await browser.storage.local.set({ [this.storageKey]: stateToWrite });
      const readBack = await this.readState();

      if (!this._validateReadback(stateToWrite, readBack)) {
        return { success: false, error: new Error('Readback validation failed') };
      }

      this.writeMetrics.successfulWrites++;
      if (attempt > 0) {
        this.writeMetrics.retriesNeeded++;
      }

      console.log('[StorageManager] Write successful:', {
        correlationId,
        attempt: attempt + 1,
        quickTabCount: stateToWrite.allQuickTabs.length
      });

      return { success: true, attempt: attempt + 1 };
    } catch (error) {
      console.warn(`[StorageManager] Write attempt ${attempt + 1} failed:`, error.message);
      return { success: false, error };
    }
  }

  /**
   * Check if this is a duplicate write based on correlationId
   *
   * @param {string} correlationId - Correlation ID to check
   * @returns {boolean} True if duplicate
   * @private
   */
  _isDuplicateWrite(correlationId) {
    return (
      correlationId === this.lastWriteCorrelationId &&
      Date.now() - this.lastWriteTime < DEDUP_WINDOW_MS
    );
  }

  /**
   * Validate that readback matches what was written
   *
   * @param {Object} written - State that was written
   * @param {Object} readBack - State read back from storage
   * @returns {boolean} True if valid
   * @private
   */
  _validateReadback(written, readBack) {
    if (!readBack || !isValidState(readBack)) {
      return false;
    }

    // Validate array length match
    if (readBack.allQuickTabs.length !== written.allQuickTabs.length) {
      console.error('[StorageManager] Validation failed: array length mismatch');
      return false;
    }

    // Validate checksum (simple approach)
    const writtenChecksum = this._computeChecksum(written);
    const readBackChecksum = this._computeChecksum(readBack);

    if (writtenChecksum !== readBackChecksum) {
      console.error('[StorageManager] Validation failed: checksum mismatch');
      return false;
    }

    return true;
  }

  /**
   * Compute a simple checksum for state validation
   *
   * @param {Object} state - State to compute checksum for
   * @returns {number} Unsigned 32-bit checksum
   * @private
   */
  _computeChecksum(state) {
    // DJB2-like hash of tab IDs and states
    let hash = 5381;
    for (const qt of state.allQuickTabs) {
      hash = ((hash << 5) + hash + qt.id) | 0;
      hash = ((hash << 5) + hash + (qt.minimized ? 1 : 0)) | 0;
      hash = ((hash << 5) + hash + qt.originTabId) | 0;
    }
    return hash >>> 0; // Convert to unsigned 32-bit
  }

  /**
   * Delay execution for a specified duration
   *
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Trigger storage recovery after write failures
   *
   * @param {string} correlationId - Correlation ID of failed write
   * @returns {Promise<Object>} Recovery result
   */
  async triggerStorageRecovery(correlationId) {
    console.error('[StorageManager] Triggering storage recovery:', correlationId);

    try {
      // Attempt to read backup from sync storage
      const syncResult = await browser.storage.sync.get('quick_tabs_backup');

      if (syncResult.quick_tabs_backup && isValidState(syncResult.quick_tabs_backup)) {
        console.log('[StorageManager] Restoring from sync backup');
        await browser.storage.local.set({
          [this.storageKey]: syncResult.quick_tabs_backup
        });
        return { recovered: true, source: 'sync_backup' };
      }
    } catch (syncError) {
      console.warn('[StorageManager] Sync backup read failed:', syncError);
    }

    // If no backup, reset to empty state
    console.log('[StorageManager] No backup available, resetting to empty state');
    await browser.storage.local.set({
      [this.storageKey]: getEmptyState()
    });

    // Notify user
    try {
      const notificationId = `storage-recovery-${Date.now()}`;
      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon.png'),
        title: 'Quick Tabs Recovery',
        message: 'Quick Tabs state was reset due to storage issues. Your data has been cleared.'
      });
    } catch (notifError) {
      console.warn('[StorageManager] Could not show notification:', notifError);
    }

    return { recovered: true, source: 'reset' };
  }

  /**
   * Get current write metrics
   *
   * @returns {Object} Copy of write metrics
   */
  getMetrics() {
    return { ...this.writeMetrics };
  }

  /**
   * Reset write metrics to initial values
   */
  resetMetrics() {
    this.writeMetrics = {
      totalWrites: 0,
      successfulWrites: 0,
      failedWrites: 0,
      retriesNeeded: 0,
      duplicatesSkipped: 0
    };
  }
}

// Singleton instance for app-wide use
let storageManagerInstance = null;

/**
 * Get the singleton StorageManager instance
 *
 * @returns {StorageManager} Singleton instance
 */
export function getStorageManager() {
  if (!storageManagerInstance) {
    storageManagerInstance = new StorageManager();
  }
  return storageManagerInstance;
}

/**
 * Generate a unique correlation ID for tracking operations
 *
 * @param {number|string} tabId - Tab ID to include in the correlation ID
 * @returns {string} Unique correlation ID
 */
export function generateCorrelationId(tabId) {
  return `${tabId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
