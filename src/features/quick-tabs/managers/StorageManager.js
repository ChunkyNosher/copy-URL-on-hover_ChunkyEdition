/**
 * StorageManager - Handles persistent storage for Quick Tabs
 * Phase 2.1: Extracted from QuickTabsManager
 * v1.6.2 - MIGRATION: Uses storage.local + storage.onChanged exclusively
 * v1.6.2.2 - ISSUE #35/#51 FIX: Removed container isolation for global visibility
 *
 * Responsibilities:
 * - Save Quick Tabs to browser.storage.local
 * - Load Quick Tabs from browser.storage.local
 * - Listen for storage.onChanged events for cross-tab sync
 * - Track pending saves to prevent race conditions
 *
 * Migration Notes (v1.6.2):
 * - Removed browser.storage.session fallback (storage.local has 10MB+ limit)
 * - Removed browser.storage.sync (quota concerns, replaced by local)
 * - Uses storage.onChanged for cross-tab synchronization
 * - Simplified circuit breaker (no quota concerns with storage.local)
 *
 * Migration Notes (v1.6.2.2):
 * - Removed container-aware storage operations for global visibility
 * - All Quick Tabs stored in unified format (tabs array, not containers object)
 * - Backward compatible migration from container format
 *
 * Uses:
 * - SyncStorageAdapter from @storage layer (now uses storage.local internally)
 * - QuickTab from @domain layer
 */

import { QuickTab } from '@domain/QuickTab.js';

import { SyncStorageAdapter } from '@storage/SyncStorageAdapter.js';

export class StorageManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    // v1.6.2.2 - REMOVED: cookieStoreId for global visibility (Issue #35, #51, #47)

    // Storage adapter (uses storage.local exclusively as of v1.6.2)
    this.syncAdapter = new SyncStorageAdapter();

    // Transaction tracking to prevent race conditions
    this.pendingSaveIds = new Set();
    this.saveIdTimers = new Map();
    this.SAVE_ID_GRACE_MS = 1000;

    // Debounced sync
    this.latestStorageSnapshot = null;
    this.storageSyncTimer = null;
    this.STORAGE_SYNC_DELAY_MS = 100;

    // Simplified circuit breaker (v1.6.2 - no quota concerns with storage.local)
    // Circuit breaker now only protects against rapid error storms
    this.circuitState = 'CLOSED'; // CLOSED = normal, OPEN = blocking, HALF_OPEN = testing
    this.failureCount = 0;
    this.successCount = 0;
    // v1.6.2 - MIGRATION: Updated thresholds for storage.local reliability
    // storage.local has 10MB+ quota (vs 100KB for sync), so quota errors are rare
    // Higher failure threshold allows for transient errors without circuit opening
    this.failureThreshold = 10; // Increased from 5 (sync had frequent quota issues)
    this.successThreshold = 2; // Close circuit after 2 successes in half-open
    // Shorter reset timeout for faster recovery since failures are less common with storage.local
    this.resetTimeoutMs = 5000; // Reduced from 10000ms (faster recovery)
    this.lastFailureTime = 0;
    this.circuitResetTimer = null;
  }

  /**
   * Save Quick Tabs to persistent storage
   * v1.6.2.2 - Changed to unified storage format (no container separation)
   * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
   * @returns {Promise<string>} - Save ID for tracking
   */
  async save(quickTabs) {
    if (!quickTabs || quickTabs.length === 0) {
      console.log('[StorageManager] No Quick Tabs to save');
      return null;
    }

    try {
      // Save using SyncStorageAdapter (handles serialization, migration, etc.)
      // v1.6.2.2 - Uses unified format without container separation
      const saveId = await this.syncAdapter.save(quickTabs);

      // Track saveId to prevent race conditions
      this.trackPendingSave(saveId);

      // Emit event
      this.eventBus?.emit('storage:saved', { saveId });

      console.log(`[StorageManager] Saved ${quickTabs.length} Quick Tabs (unified format)`);
      return saveId;
    } catch (error) {
      console.error('[StorageManager] Save error:', error);
      this.eventBus?.emit('storage:error', { operation: 'save', error });
      throw error;
    }
  }

  /**
   * Load all Quick Tabs globally
   * v1.6.2 - MIGRATION: Simplified to use storage.local exclusively
   * v1.6.2.2 - ISSUE #35/#51 FIX: Unified format, no container separation
   * 
   * CRITICAL FIX for Issue #35, #51, and #47:
   * - First tries to get state from background script (authoritative source)
   * - If background fails, falls back to loading from storage.local
   * - Quick Tabs should be visible globally unless Solo/Mute rules apply
   *
   * @returns {Promise<Array<QuickTab>>} - Array of QuickTab domain entities
   */
  async loadAll() {
    try {
      const browserAPI = this._getBrowserAPI();

      // STEP 1: Try background script (authoritative source)
      const backgroundResult = await this._tryLoadFromBackground(browserAPI);
      if (backgroundResult) return backgroundResult;

      // STEP 2: Load from storage.local (unified format)
      const localResult = await this._tryLoadFromGlobalStorage(browserAPI);
      if (localResult) return localResult;

      // STEP 3: Empty state
      console.log('[StorageManager] No Quick Tab data found');
      return [];
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
   * v1.6.2.2 - Simplified for unified format
   * @private
   * @param {Object} browserAPI - Browser API reference
   * @returns {Promise<Array<QuickTab>|null>} Quick Tabs or null if not available
   */
  async _tryLoadFromBackground(browserAPI) {
    const response = await browserAPI.runtime.sendMessage({
      action: 'GET_QUICK_TABS_STATE'
    });

    if (response?.success && response.tabs?.length > 0) {
      const quickTabs = response.tabs.map(tabData => QuickTab.fromStorage(tabData));
      console.log(`[StorageManager] Loaded ${quickTabs.length} Quick Tabs from background`);
      return quickTabs;
    }
    return null;
  }

  /**
   * Try to load Quick Tabs from global storage (unified format)
   * v1.6.2.2 - ISSUE #35/#51 FIX: Unified format with backward compatibility
   * @private
   * @param {Object} browserAPI - Browser API reference
   * @returns {Promise<Array<QuickTab>|null>} Quick Tabs or null if not available
   */
  async _tryLoadFromGlobalStorage(browserAPI) {
    console.log('[StorageManager] Loading Quick Tabs from global storage');
    
    const data = await browserAPI.storage.local.get('quick_tabs_state_v2');
    const state = data?.quick_tabs_state_v2;
    
    if (!state) {
      return null;
    }
    
    // v1.6.2.2 - New unified format: { tabs: [...], timestamp, saveId }
    if (state.tabs && Array.isArray(state.tabs)) {
      const quickTabs = state.tabs.map(tabData => QuickTab.fromStorage(tabData));
      console.log(`[StorageManager] Loaded ${quickTabs.length} Quick Tabs (unified format)`);
      return quickTabs.length > 0 ? quickTabs : null;
    }
    
    // v1.6.2.1 and earlier - Container format: { containers: {...} }
    // Backward compatible migration
    if (state.containers) {
      const allQuickTabs = this._migrateFromContainerFormat(state.containers);
      console.log(`[StorageManager] Migrated ${allQuickTabs.length} Quick Tabs from container format`);
      return allQuickTabs.length > 0 ? allQuickTabs : null;
    }
    
    return null;
  }

  /**
   * Migrate from container format to unified format
   * v1.6.2.2 - Backward compatibility helper
   * @private
   * @param {Object} containers - Container data object
   * @returns {Array<QuickTab>} Flattened Quick Tab array
   */
  _migrateFromContainerFormat(containers) {
    const allQuickTabs = [];
    
    for (const containerKey of Object.keys(containers)) {
      const tabs = containers[containerKey]?.tabs || [];
      if (tabs.length === 0) continue;
      
      console.log(`[StorageManager] Migrating ${tabs.length} Quick Tabs from container: ${containerKey}`);
      const quickTabs = tabs.map(tabData => QuickTab.fromStorage(tabData));
      allQuickTabs.push(...quickTabs);
    }
    
    return allQuickTabs;
  }

  // v1.6.2.2 - REMOVED: loadFromCurrentContainer() method
  // Container isolation removed for global visibility (Issue #35, #51, #47)

  /**
   * Setup storage change listeners
   * v1.6.2 - MIGRATION: Listen ONLY for storage.local changes
   * v1.6.2.1 - ISSUE #35 FIX: Enhanced logging to track listener context
   * 
   * CRITICAL: This listener MUST be registered in EACH content script context.
   * Mozilla docs: "storage.onChanged fires in all contexts where the storage API is available"
   * Each tab's content script must have its own listener - they are NOT shared!
   * 
   * Cross-tab sync is now handled exclusively via storage.onChanged events.
   * When any tab writes to storage.local, all OTHER tabs receive the change.
   * Note: The tab that made the change does NOT receive the event.
   */
  setupStorageListeners() {
    // Detect execution context for debugging
    const context = typeof window !== 'undefined' ? 'content-script' : 'background';
    const tabUrl = typeof window !== 'undefined' ? window.location?.href : 'N/A';
    
    console.log('[StorageManager] Setting up storage.onChanged listener', {
      context,
      tabUrl: tabUrl?.substring(0, 50),
      timestamp: Date.now()
    });

    if (typeof browser === 'undefined' || !browser.storage) {
      console.warn('[StorageManager] Storage API not available in context:', context);
      return;
    }

    // CRITICAL: Register listener - this MUST run in each content script
    browser.storage.onChanged.addListener((changes, areaName) => {
      // Issue #35 Fix: Log EVERY time listener fires to confirm it's working
      console.log('[StorageManager] *** LISTENER FIRED ***', {
        context: typeof window !== 'undefined' ? 'content-script' : 'background',
        tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A',
        areaName,
        changedKeys: Object.keys(changes),
        timestamp: Date.now()
      });
      
      this._onStorageChanged(changes, areaName);
    });

    console.log('[StorageManager] ✓ Storage listeners attached successfully', {
      context,
      tabUrl: tabUrl?.substring(0, 50),
      cookieStoreId: this.cookieStoreId
    });
  }

  /**
   * Handle raw storage changes and filter out internal keys
   * v1.6.2.1 - ISSUE #35 FIX: Added context-aware debug logging
   * @private
   * @param {Object} changes - Storage changes object
   * @param {string} areaName - Storage area name
   */
  _onStorageChanged(changes, areaName) {
    // Detect execution context
    const context = typeof window !== 'undefined' ? 'content-script' : 'background';
    
    // Filter out broadcast history and sync message keys to prevent feedback loops
    const filteredChanges = this._filterStorageChanges(changes);
    
    // If all keys were filtered out, return early
    if (Object.keys(filteredChanges).length === 0) {
      return;
    }

    console.log('[StorageManager] Storage changed:', {
      context,
      areaName,
      changedKeys: Object.keys(filteredChanges),
      tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A'
    });

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
   * v1.6.2 - MIGRATION: Simplified after BroadcastManager removal
   * Note: Still filters legacy broadcast history keys for backward compatibility
   * 
   * @private
   * @param {string} key - Storage key
   * @returns {boolean} True if internal key
   */
  _isInternalStorageKey(key) {
    // Filter internal sync/tracking keys
    if (key.startsWith('quicktabs-internal-') || key.startsWith('quick-tabs-sync-')) {
      return true;
    }
    
    // Filter legacy broadcast history keys (for backward compatibility)
    // Note: These are no longer generated as of v1.6.2 but may exist in storage
    if (key.startsWith('quicktabs-broadcast-history-') || key.startsWith('quick_tabs_broadcast_history_')) {
      return true;
    }
    
    return false;
  }

  /**
   * Route storage changes to appropriate handlers
   * v1.6.2 - MIGRATION: Only handles storage.local changes
   * 
   * @private
   * @param {Object} filteredChanges - Filtered changes object
   * @param {string} areaName - Storage area name
   */
  _routeStorageChange(filteredChanges, areaName) {
    // Only handle local storage changes (primary and only storage as of v1.6.2)
    if (areaName !== 'local') {
      return;
    }

    // Handle Quick Tabs state changes
    if (filteredChanges.quick_tabs_state_v2) {
      this.handleStorageChange(filteredChanges.quick_tabs_state_v2.newValue);
    }
  }

  /**
   * Handle storage change event
   * v1.6.2 - Added debug logging to track sync pipeline
   * v1.6.2.1 - ISSUE #35 FIX: Enhanced context-aware logging
   * v1.6.2.2 - Updated for unified format
   * @param {Object} newValue - New storage value
   */
  handleStorageChange(newValue) {
    const context = typeof window !== 'undefined' ? 'content-script' : 'background';
    const willSkip = !newValue || this._shouldSkipStorageChange(newValue);
    
    // Debug logging to track the sync pipeline
    console.log('[StorageManager] Processing storage change:', {
      context,
      tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A',
      saveId: newValue?.saveId,
      tabCount: newValue?.tabs?.length ?? 0,
      willScheduleSync: !willSkip,
      timestamp: Date.now()
    });
    
    if (willSkip) {
      console.log('[StorageManager] Skipping storage change (own save or pending)', {
        context,
        saveId: newValue?.saveId
      });
      return;
    }

    // v1.6.2.2 - Simplified: pass the new value directly (unified format)
    console.log('[StorageManager] Scheduling sync...', { context });
    this.scheduleStorageSync(newValue);
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

  // v1.6.2.2 - REMOVED: _extractSyncState() and _extractContainerState() methods
  // Container filtering removed for global visibility (Issue #35, #51, #47)

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
   * v1.6.2.1 - ISSUE #35 FIX: Enhanced debug logging and EventBus verification
   * v1.6.2.2 - ISSUE #35 FIX: Added listenerCount logging to verify listeners exist
   * @param {Object} stateSnapshot - Storage state snapshot
   */
  scheduleStorageSync(stateSnapshot) {
    this.latestStorageSnapshot = stateSnapshot;

    if (this.storageSyncTimer) {
      clearTimeout(this.storageSyncTimer);
    }

    const context = typeof window !== 'undefined' ? 'content-script' : 'background';

    this.storageSyncTimer = setTimeout(() => {
      const snapshot = this.latestStorageSnapshot;
      this.latestStorageSnapshot = null;
      this.storageSyncTimer = null;

      // Issue #35 Fix: Comprehensive logging to verify EventBus connection
      const listenerCount = this.eventBus?.listenerCount?.('storage:changed') ?? 'unknown';
      console.log('[StorageManager] Emitting storage:changed event', {
        context,
        tabUrl: typeof window !== 'undefined' ? window.location?.href?.substring(0, 50) : 'N/A',
        hasEventBus: !!this.eventBus,
        eventBusType: this.eventBus?.constructor?.name || 'none',
        listenerCount,
        hasSnapshot: !!snapshot,
        timestamp: Date.now()
      });

      // Issue #35 Critical: Verify EventBus exists before emit
      if (!this.eventBus) {
        console.error('[StorageManager] ❌ EventBus is null/undefined! Cannot emit storage:changed event');
        return;
      }

      // Emit event for coordinator to handle sync
      // v1.6.2.2 - Simplified: no container filter for global visibility
      this.eventBus.emit('storage:changed', {
        state: snapshot
      });

      console.log('[StorageManager] ✓ storage:changed event emitted successfully');
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
   * v1.6.2.2 - Updated for unified format
   * @param {string} quickTabId - Quick Tab ID to delete
   */
  async delete(quickTabId) {
    await this._executeStorageOperation(
      'delete',
      () => this.syncAdapter.delete(quickTabId),
      { quickTabId }
    );
  }

  /**
   * Clear all Quick Tabs
   * v1.6.2.2 - Updated for unified format
   */
  async clear() {
    await this._executeStorageOperation(
      'clear',
      () => this.syncAdapter.clear(),
      {}
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
  // Circuit Breaker Methods
  // v1.6.2 - Simplified: No quota concerns with storage.local
  // Protects against rapid error storms from storage failures
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
