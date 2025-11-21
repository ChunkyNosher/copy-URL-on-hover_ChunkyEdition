/**
 * StorageManager - Handles persistent storage for Quick Tabs
 * Phase 2.1: Extracted from QuickTabsManager
 *
 * Responsibilities:
 * - Save Quick Tabs to browser.storage
 * - Load Quick Tabs from browser.storage
 * - Listen for storage changes
 * - Track pending saves to prevent race conditions
 * - Container-aware storage operations
 *
 * Uses:
 * - SyncStorageAdapter from @storage layer
 * - QuickTab from @domain layer
 */

import { Container as _Container } from '@domain/Container.js';
import { QuickTab } from '@domain/QuickTab.js';

import { SessionStorageAdapter } from '@storage/SessionStorageAdapter.js';
import { SyncStorageAdapter } from '@storage/SyncStorageAdapter.js';

export class StorageManager {
  constructor(eventBus, cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.cookieStoreId = cookieStoreId;

    // Storage adapters
    this.syncAdapter = new SyncStorageAdapter();
    this.sessionAdapter = new SessionStorageAdapter();

    // Transaction tracking to prevent race conditions
    this.pendingSaveIds = new Set();
    this.saveIdTimers = new Map();
    this.SAVE_ID_GRACE_MS = 1000;

    // Debounced sync
    this.latestStorageSnapshot = null;
    this.storageSyncTimer = null;
    this.STORAGE_SYNC_DELAY_MS = 100;
  }

  /**
   * Save Quick Tabs to persistent storage
   * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
   * @returns {Promise<string>} - Save ID for tracking
   */
  async save(quickTabs) {
    if (!quickTabs || quickTabs.length === 0) {
      console.log('[StorageManager] No Quick Tabs to save');
      return null;
    }

    try {
      // Serialize QuickTab domain entities to storage format
      const serializedTabs = quickTabs.map(qt => qt.serialize());

      // Save using SyncStorageAdapter (handles quota, fallback, etc.)
      const saveId = await this.syncAdapter.save(this.cookieStoreId, serializedTabs);

      // Track saveId to prevent race conditions
      this.trackPendingSave(saveId);

      // Emit event
      this.eventBus?.emit('storage:saved', { cookieStoreId: this.cookieStoreId, saveId });

      console.log(
        `[StorageManager] Saved ${quickTabs.length} Quick Tabs for container ${this.cookieStoreId}`
      );
      return saveId;
    } catch (error) {
      console.error('[StorageManager] Save error:', error);
      this.eventBus?.emit('storage:error', { operation: 'save', error });
      throw error;
    }
  }

  /**
   * Load all Quick Tabs for current container
   * CRITICAL FIX for Issue #35 and #51: Load from background script's authoritative state
   * Background script maintains the single source of truth across all tabs
   *
   * @returns {Promise<Array<QuickTab>>} - Array of QuickTab domain entities
   */
  async loadAll() {
    try {
      // STEP 1: Request state from background script (authoritative source)
      // This ensures tabs always load the latest state, even when switching tabs
      // Use global browser object (not imported) for test compatibility
      const browserAPI =
        (typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome);

      const response = await browserAPI.runtime.sendMessage({
        action: 'GET_QUICK_TABS_STATE',
        cookieStoreId: this.cookieStoreId
      });

      if (response && response.success && response.tabs && response.tabs.length > 0) {
        // Deserialize to QuickTab domain entities
        const quickTabs = response.tabs.map(tabData => QuickTab.fromStorage(tabData));
        console.log(
          `[StorageManager] Loaded ${quickTabs.length} Quick Tabs from background for container ${this.cookieStoreId}`
        );
        return quickTabs;
      }

      // STEP 2: Fallback - Try session storage (faster, temporary)
      let containerData = await this.sessionAdapter.load(this.cookieStoreId);

      // STEP 3: Fallback - Try sync storage
      if (!containerData) {
        containerData = await this.syncAdapter.load(this.cookieStoreId);
      }

      if (!containerData || !containerData.tabs) {
        console.log(`[StorageManager] No data found for container ${this.cookieStoreId}`);
        return [];
      }

      // Deserialize to QuickTab domain entities
      const quickTabs = containerData.tabs.map(tabData => QuickTab.fromStorage(tabData));

      console.log(
        `[StorageManager] Loaded ${quickTabs.length} Quick Tabs for container ${this.cookieStoreId}`
      );
      return quickTabs;
    } catch (error) {
      console.error('[StorageManager] Load error:', error);
      this.eventBus?.emit('storage:error', { operation: 'load', error });
      return [];
    }
  }

  /**
   * Setup storage change listeners
   * v1.6.0.12 - FIX: Listen for local storage changes (where we now save)
   */
  setupStorageListeners() {
    if (typeof browser === 'undefined' || !browser.storage) {
      console.warn('[StorageManager] Storage API not available');
      return;
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
      console.log('[StorageManager] Storage changed:', areaName, Object.keys(changes));

      // v1.6.0.12 - FIX: Handle local storage changes (primary storage)
      if (areaName === 'local' && changes.quick_tabs_state_v2) {
        this.handleStorageChange(changes.quick_tabs_state_v2.newValue);
      }

      // Handle sync storage changes (for backward compatibility)
      if (areaName === 'sync' && changes.quick_tabs_state_v2) {
        this.handleStorageChange(changes.quick_tabs_state_v2.newValue);
      }

      // Handle session storage changes
      if (areaName === 'session' && changes.quick_tabs_session) {
        this.handleStorageChange(changes.quick_tabs_session.newValue);
      }
    });

    console.log('[StorageManager] Storage listeners attached');
  }

  /**
   * Handle storage change event
   * @param {Object} newValue - New storage value
   */
  handleStorageChange(newValue) {
    if (!newValue || this._shouldSkipStorageChange(newValue)) {
      return;
    }

    const stateToSync = this._extractSyncState(newValue);
    if (stateToSync) {
      this.scheduleStorageSync(stateToSync);
    }
  }

  /**
   * Determine if storage change should be skipped
   * @private
   * @param {Object} newValue - New storage value
   * @returns {boolean} True if should skip
   */
  _shouldSkipStorageChange(newValue) {
    // Ignore changes from our own saves (race condition prevention)
    if (this.shouldIgnoreStorageChange(newValue?.saveId)) {
      return true;
    }

    // Ignore changes while saves are pending
    if (this.pendingSaveIds.size > 0 && !newValue?.saveId) {
      console.log(
        '[StorageManager] Ignoring change while pending saves in-flight:',
        Array.from(this.pendingSaveIds)
      );
      return true;
    }

    return false;
  }

  /**
   * Extract state to sync from storage change
   * @private
   * @param {Object} newValue - New storage value
   * @returns {Object|null} State to sync, or null if none
   */
  _extractSyncState(newValue) {
    // Modern container-aware format
    if (newValue.containers && this.cookieStoreId) {
      return this._extractContainerState(newValue);
    }

    // Legacy format - process as-is
    console.log('[StorageManager] Scheduling sync (legacy format)');
    return newValue;
  }

  /**
   * Extract container-specific state
   * @private
   * @param {Object} newValue - Storage value with containers
   * @returns {Object|null} Filtered state or null
   */
  _extractContainerState(newValue) {
    const containerState = newValue.containers[this.cookieStoreId];
    if (!containerState) {
      return null;
    }

    console.log(`[StorageManager] Scheduling sync for container ${this.cookieStoreId}`);
    return {
      containers: {
        [this.cookieStoreId]: containerState
      }
    };
  }

  /**
   * Check if storage change should be ignored
   * @param {string} saveId - Save ID from storage change
   * @returns {boolean} - True if should ignore
   */
  shouldIgnoreStorageChange(saveId) {
    if (saveId && this.pendingSaveIds.has(saveId)) {
      console.log('[StorageManager] Ignoring storage change for pending save:', saveId);
      return true;
    }
    return false;
  }

  /**
   * Schedule debounced storage sync
   * @param {Object} stateSnapshot - Storage state snapshot
   */
  scheduleStorageSync(stateSnapshot) {
    this.latestStorageSnapshot = stateSnapshot;

    if (this.storageSyncTimer) {
      clearTimeout(this.storageSyncTimer);
    }

    // eslint-disable-next-line require-await
    this.storageSyncTimer = setTimeout(async () => {
      const snapshot = this.latestStorageSnapshot;
      this.latestStorageSnapshot = null;
      this.storageSyncTimer = null;

      // Emit event for coordinator to handle sync
      this.eventBus?.emit('storage:changed', {
        containerFilter: this.cookieStoreId,
        state: snapshot
      });
    }, this.STORAGE_SYNC_DELAY_MS);
  }

  /**
   * Track pending save to prevent race conditions
   * @param {string} saveId - Unique save identifier
   */
  trackPendingSave(saveId) {
    if (!saveId) {
      return;
    }

    // Clear existing timer if present
    if (this.saveIdTimers.has(saveId)) {
      clearTimeout(this.saveIdTimers.get(saveId));
      this.saveIdTimers.delete(saveId);
    }

    this.pendingSaveIds.add(saveId);

    // Auto-release after grace period
    const timer = setTimeout(() => {
      this.releasePendingSave(saveId);
    }, this.SAVE_ID_GRACE_MS);

    this.saveIdTimers.set(saveId, timer);
  }

  /**
   * Release pending save ID
   * @param {string} saveId - Save identifier to release
   */
  releasePendingSave(saveId) {
    if (!saveId) {
      return;
    }

    if (this.saveIdTimers.has(saveId)) {
      clearTimeout(this.saveIdTimers.get(saveId));
      this.saveIdTimers.delete(saveId);
    }

    if (this.pendingSaveIds.delete(saveId)) {
      console.log('[StorageManager] Released saveId:', saveId);
    }
  }

  /**
   * Delete specific Quick Tab from storage
   * @param {string} quickTabId - Quick Tab ID to delete
   */
  async delete(quickTabId) {
    await this._executeStorageOperation(
      'delete',
      () => this.syncAdapter.delete(this.cookieStoreId, quickTabId),
      { cookieStoreId: this.cookieStoreId, quickTabId }
    );
  }

  /**
   * Clear all Quick Tabs for current container
   */
  async clear() {
    await this._executeStorageOperation(
      'clear',
      () => this.syncAdapter.deleteContainer(this.cookieStoreId),
      { cookieStoreId: this.cookieStoreId }
    );
  }

  /**
   * Execute storage operation with consistent error handling
   * @private
   * @param {string} operation - Operation name ('delete' or 'clear')
   * @param {Function} action - Async function to execute
   * @param {Object} eventData - Data to emit with success event
   * @returns {Promise<void>}
   */
  async _executeStorageOperation(operation, action, eventData) {
    try {
      await action();
      // Emit success event based on operation type
      const successEvent = operation === 'delete' ? 'storage:deleted' : 'storage:cleared';
      this.eventBus?.emit(successEvent, eventData);
    } catch (error) {
      console.error(
        `[StorageManager] ${operation.charAt(0).toUpperCase() + operation.slice(1)} error:`,
        error
      );
      this.eventBus?.emit('storage:error', { operation, error });
      throw error;
    }
  }
}
