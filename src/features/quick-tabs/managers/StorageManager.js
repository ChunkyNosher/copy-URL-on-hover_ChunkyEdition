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

import { Container } from '@domain/Container.js';
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
   * @returns {Promise<Array<QuickTab>>} - Array of QuickTab domain entities
   */
  async loadAll() {
    try {
      // Try session storage first (faster, temporary)
      let containerData = await this.sessionAdapter.load(this.cookieStoreId);

      // Fall back to sync storage
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
   */
  setupStorageListeners() {
    if (typeof browser === 'undefined' || !browser.storage) {
      console.warn('[StorageManager] Storage API not available');
      return;
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
      console.log('[StorageManager] Storage changed:', areaName, Object.keys(changes));

      // Handle sync storage changes
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
    if (!newValue) {
      return;
    }

    // Ignore changes from our own saves (race condition prevention)
    if (this.shouldIgnoreStorageChange(newValue?.saveId)) {
      return;
    }

    // Ignore changes while saves are pending
    if (this.pendingSaveIds.size > 0 && !newValue?.saveId) {
      console.log(
        '[StorageManager] Ignoring change while pending saves in-flight:',
        Array.from(this.pendingSaveIds)
      );
      return;
    }

    // Extract container-specific state
    if (newValue.containers && this.cookieStoreId) {
      const containerState = newValue.containers[this.cookieStoreId];
      if (containerState) {
        console.log(`[StorageManager] Scheduling sync for container ${this.cookieStoreId}`);
        // Create container-filtered snapshot
        const filteredState = {
          containers: {
            [this.cookieStoreId]: containerState
          }
        };
        this.scheduleStorageSync(filteredState);
      }
    } else {
      // Legacy format - process as-is
      console.log('[StorageManager] Scheduling sync (legacy format)');
      this.scheduleStorageSync(newValue);
    }
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
    try {
      await this.syncAdapter.delete(this.cookieStoreId, quickTabId);
      this.eventBus?.emit('storage:deleted', { cookieStoreId: this.cookieStoreId, quickTabId });
    } catch (error) {
      console.error('[StorageManager] Delete error:', error);
      this.eventBus?.emit('storage:error', { operation: 'delete', error });
      throw error;
    }
  }

  /**
   * Clear all Quick Tabs for current container
   */
  async clear() {
    try {
      await this.syncAdapter.deleteContainer(this.cookieStoreId);
      this.eventBus?.emit('storage:cleared', { cookieStoreId: this.cookieStoreId });
    } catch (error) {
      console.error('[StorageManager] Clear error:', error);
      this.eventBus?.emit('storage:error', { operation: 'clear', error });
      throw error;
    }
  }
}
