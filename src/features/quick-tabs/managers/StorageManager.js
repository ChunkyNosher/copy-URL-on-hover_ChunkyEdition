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

    // MEMORY LEAK FIX: Circuit breaker to prevent storage operation storms
    // See: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
    this.circuitState = 'CLOSED'; // CLOSED = normal, OPEN = blocking, HALF_OPEN = testing
    this.failureCount = 0;
    this.successCount = 0;
    this.failureThreshold = 5; // Open circuit after 5 failures
    this.successThreshold = 2; // Close circuit after 2 successes in half-open
    this.resetTimeoutMs = 10000; // Try again after 10 seconds
    this.lastFailureTime = 0;
    this.circuitResetTimer = null;
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
      // Save using SyncStorageAdapter (handles quota, fallback, serialization, etc.)
      // Note: SyncStorageAdapter.save() expects QuickTab instances and handles serialization
      const saveId = await this.syncAdapter.save(this.cookieStoreId, quickTabs);

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
   * Load all Quick Tabs globally from ALL containers
   * ✅ ENHANCED for cross-domain sync (Scenarios 1 & 2)
   * 
   * CRITICAL FIX for Issue #35, #51, and #47:
   * - First tries to get state from background script (authoritative source)
   * - If background fails, falls back to loading from ALL containers in storage
   * - Quick Tabs should be visible globally unless Solo/Mute rules apply
   *
   * See: docs/manual/v1.6.0/quick-tab-sync-restoration-guide.md
   *
   * @returns {Promise<Array<QuickTab>>} - Array of QuickTab domain entities from ALL containers
   */
  async loadAll() {
    try {
      const browserAPI = this._getBrowserAPI();

      // STEP 1: Try background script (authoritative source)
      const backgroundResult = await this._tryLoadFromBackground(browserAPI);
      if (backgroundResult) return backgroundResult;

      // STEP 2: Try loading from ALL containers for global visibility
      const globalResult = await this._tryLoadFromAllContainers(browserAPI);
      if (globalResult) return globalResult;

      // STEP 3: Fallback to session/sync storage
      return await this._tryLoadFromFallbackStorage(browserAPI);
    } catch (error) {
      console.error('[StorageManager] Load error:', error);
      this.eventBus?.emit('storage:error', { operation: 'load', error });
      return [];
    }
  }

  /**
   * Get browser API reference
   * @private
   * @returns {Object} Browser API
   */
  _getBrowserAPI() {
    return (typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome);
  }

  /**
   * Try to load Quick Tabs from background script
   * @private
   * @param {Object} browserAPI - Browser API reference
   * @returns {Promise<Array<QuickTab>|null>} Quick Tabs or null if not available
   */
  async _tryLoadFromBackground(browserAPI) {
    const response = await browserAPI.runtime.sendMessage({
      action: 'GET_QUICK_TABS_STATE',
      cookieStoreId: this.cookieStoreId
    });

    if (response?.success && response.tabs?.length > 0) {
      const quickTabs = response.tabs.map(tabData => QuickTab.fromStorage(tabData));
      console.log(
        `[StorageManager] Loaded ${quickTabs.length} Quick Tabs from background for container ${this.cookieStoreId}`
      );
      return quickTabs;
    }
    return null;
  }

  /**
   * Try to load Quick Tabs from ALL containers in storage
   * @private
   * @param {Object} browserAPI - Browser API reference
   * @returns {Promise<Array<QuickTab>|null>} Quick Tabs or null if not available
   */
  async _tryLoadFromAllContainers(browserAPI) {
    console.log('[StorageManager] Loading Quick Tabs from ALL containers');
    
    const data = await browserAPI.storage.local.get('quick_tabs_state_v2');
    const containers = data?.quick_tabs_state_v2?.containers || {};
    
    const allQuickTabs = this._flattenContainers(containers);
    
    console.log(`[StorageManager] Total Quick Tabs loaded globally: ${allQuickTabs.length}`);
    
    return allQuickTabs.length > 0 ? allQuickTabs : null;
  }

  /**
   * Flatten all containers into a single Quick Tab array
   * @private
   * @param {Object} containers - Container data object
   * @returns {Array<QuickTab>} Flattened Quick Tab array
   */
  _flattenContainers(containers) {
    const allQuickTabs = [];
    
    for (const containerKey of Object.keys(containers)) {
      const tabs = containers[containerKey]?.tabs || [];
      if (tabs.length === 0) continue;
      
      console.log(`[StorageManager] Loaded ${tabs.length} Quick Tabs from container: ${containerKey}`);
      const quickTabs = tabs.map(tabData => QuickTab.fromStorage(tabData));
      allQuickTabs.push(...quickTabs);
    }
    
    return allQuickTabs;
  }

  /**
   * Try to load from fallback storage (session/sync)
   * @private
   * @param {Object} browserAPI - Browser API reference
   * @returns {Promise<Array<QuickTab>>} Quick Tabs (empty array if not found)
   */
  async _tryLoadFromFallbackStorage(browserAPI) {
    // Try session storage if available
    let containerData = null;
    if (browserAPI?.storage?.session) {
      containerData = await this.sessionAdapter.load(this.cookieStoreId);
    }

    // Try sync storage
    if (!containerData) {
      containerData = await this.syncAdapter.load(this.cookieStoreId);
    }

    if (!containerData?.tabs) {
      console.log(`[StorageManager] No data found for container ${this.cookieStoreId}`);
      return [];
    }

    const quickTabs = containerData.tabs.map(tabData => QuickTab.fromStorage(tabData));
    console.log(
      `[StorageManager] Loaded ${quickTabs.length} Quick Tabs for container ${this.cookieStoreId}`
    );
    return quickTabs;
  }

  /**
   * Load Quick Tabs ONLY from current container
   * Use this when container isolation is explicitly needed
   *
   * @returns {Promise<Array<QuickTab>>} - Quick Tabs from current container only
   */
  async loadFromCurrentContainer() {
    try {
      const browserAPI =
        (typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome);

      const data = await browserAPI.storage.local.get('quick_tabs_state_v2');
      const containerData = data?.quick_tabs_state_v2?.containers?.[this.cookieStoreId];

      if (!containerData || !containerData.tabs) {
        console.log(`[StorageManager] No data found for container ${this.cookieStoreId}`);
        return [];
      }

      // Deserialize to QuickTab domain entities
      const quickTabs = containerData.tabs.map(tabData => QuickTab.fromStorage(tabData));

      console.log(
        `[StorageManager] Loaded ${quickTabs.length} Quick Tabs from current container ${this.cookieStoreId}`
      );
      return quickTabs;
    } catch (error) {
      console.error('[StorageManager] loadFromCurrentContainer error:', error);
      return [];
    }
  }

  /**
   * Setup storage change listeners
   * v1.6.0.12 - FIX: Listen for local storage changes (where we now save)
   * 
   * MEMORY LEAK FIX: Added filtering to ignore broadcast history and sync message keys
   * These keys cause feedback loops when written by BroadcastManager.
   * See: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
   */
  setupStorageListeners() {
    if (typeof browser === 'undefined' || !browser.storage) {
      console.warn('[StorageManager] Storage API not available');
      return;
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
      this._onStorageChanged(changes, areaName);
    });

    console.log('[StorageManager] Storage listeners attached');
  }

  /**
   * Handle raw storage changes and filter out internal keys
   * @private
   * @param {Object} changes - Storage changes object
   * @param {string} areaName - Storage area name
   */
  _onStorageChanged(changes, areaName) {
    // Filter out broadcast history and sync message keys to prevent feedback loops
    const filteredChanges = this._filterStorageChanges(changes);
    
    // If all keys were filtered out, return early
    if (Object.keys(filteredChanges).length === 0) {
      return;
    }

    console.log('[StorageManager] Storage changed:', areaName, Object.keys(filteredChanges));

    // Route changes to appropriate handlers based on area
    this._routeStorageChange(filteredChanges, areaName);
  }

  /**
   * Filter storage changes to exclude internal keys
   * @private
   * @param {Object} changes - Storage changes object
   * @returns {Object} Filtered changes object
   */
  _filterStorageChanges(changes) {
    const filteredChanges = {};
    
    for (const [key, value] of Object.entries(changes)) {
      if (this._isInternalStorageKey(key)) {
        continue;
      }
      filteredChanges[key] = value;
    }
    
    return filteredChanges;
  }

  /**
   * Check if storage key is internal and should be filtered
   * 
   * NOTE: Two broadcast history key prefixes are used for backward compatibility:
   * - 'quicktabs-broadcast-history-' (legacy, from storage fallback path)
   * - 'quick_tabs_broadcast_history_' (current, from _persistBroadcastMessage)
   * Both must be filtered to prevent storage change feedback loops.
   * 
   * @private
   * @param {string} key - Storage key
   * @returns {boolean} True if internal key
   */
  _isInternalStorageKey(key) {
    // Filter broadcast history keys (both legacy and current variants)
    if (key.startsWith('quicktabs-broadcast-history-') || key.startsWith('quick_tabs_broadcast_history_')) {
      return true;
    }
    
    // Filter sync message keys (storage fallback path)
    if (key.startsWith('quick-tabs-sync-')) {
      return true;
    }
    
    return false;
  }

  /**
   * Route storage changes to appropriate handlers
   * @private
   * @param {Object} filteredChanges - Filtered changes object
   * @param {string} areaName - Storage area name
   */
  _routeStorageChange(filteredChanges, areaName) {
    // Handle local storage changes (primary storage)
    if (areaName === 'local' && filteredChanges.quick_tabs_state_v2) {
      this.handleStorageChange(filteredChanges.quick_tabs_state_v2.newValue);
      return;
    }

    // Handle sync storage changes (backward compatibility)
    if (areaName === 'sync' && filteredChanges.quick_tabs_state_v2) {
      this.handleStorageChange(filteredChanges.quick_tabs_state_v2.newValue);
      return;
    }

    // Handle session storage changes
    if (areaName === 'session' && filteredChanges.quick_tabs_session) {
      this.handleStorageChange(filteredChanges.quick_tabs_session.newValue);
    }
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

  // ============================================================================
  // MEMORY LEAK FIX: Circuit Breaker Methods
  // See: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
  // ============================================================================

  /**
   * Check if circuit breaker allows operation
   * @returns {boolean} True if operation is allowed
   */
  isCircuitAllowed() {
    if (this.circuitState === 'CLOSED') {
      return true;
    }
    
    if (this.circuitState === 'OPEN') {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this._attemptCircuitReset();
        return this.circuitState === 'HALF_OPEN';
      }
      return false;
    }
    
    // HALF_OPEN state - allow limited operations to test
    return true;
  }

  /**
   * Record a circuit breaker failure
   * @private
   */
  _recordCircuitFailure() {
    this.failureCount++;
    this.successCount = 0;
    this.lastFailureTime = Date.now();
    
    console.warn('[StorageManager] Circuit breaker failure recorded', {
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      state: this.circuitState
    });
    
    if (this.failureCount >= this.failureThreshold) {
      this._openCircuit();
    }
  }

  /**
   * Open the circuit breaker (block operations)
   * @private
   */
  _openCircuit() {
    this.circuitState = 'OPEN';
    this.failureCount = 0;
    
    console.error('[StorageManager] ⚠️ Circuit breaker OPENED - storage operations blocked', {
      resetTimeoutMs: this.resetTimeoutMs
    });
    
    this.eventBus?.emit('storage:circuit-opened', {
      resetTimeoutMs: this.resetTimeoutMs,
      timestamp: Date.now()
    });
    
    // Schedule automatic reset attempt
    if (this.circuitResetTimer) {
      clearTimeout(this.circuitResetTimer);
    }
    
    this.circuitResetTimer = setTimeout(() => {
      this._attemptCircuitReset();
    }, this.resetTimeoutMs);
  }

  /**
   * Attempt to reset circuit to half-open state
   * @private
   */
  _attemptCircuitReset() {
    if (this.circuitState !== 'OPEN') {
      return;
    }
    
    console.log('[StorageManager] Circuit breaker attempting reset (HALF_OPEN)');
    this.circuitState = 'HALF_OPEN';
    this.successCount = 0;
    
    this.eventBus?.emit('storage:circuit-half-open', {
      timestamp: Date.now()
    });
  }

  /**
   * Record a circuit breaker success
   * @private
   */
  _recordCircuitSuccess() {
    if (this.circuitState === 'HALF_OPEN') {
      this.successCount++;
      
      if (this.successCount >= this.successThreshold) {
        this._closeCircuit();
      }
    } else if (this.circuitState === 'CLOSED') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Close the circuit breaker (allow normal operations)
   * @private
   */
  _closeCircuit() {
    console.log('[StorageManager] ✓ Circuit breaker CLOSED - storage operations restored');
    this.circuitState = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    
    if (this.circuitResetTimer) {
      clearTimeout(this.circuitResetTimer);
      this.circuitResetTimer = null;
    }
    
    this.eventBus?.emit('storage:circuit-closed', {
      timestamp: Date.now()
    });
  }

  /**
   * Get circuit breaker statistics
   * @returns {Object} Circuit breaker stats
   */
  getCircuitBreakerStats() {
    return {
      state: this.circuitState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      lastFailureTime: this.lastFailureTime,
      resetTimeoutMs: this.resetTimeoutMs
    };
  }
}
