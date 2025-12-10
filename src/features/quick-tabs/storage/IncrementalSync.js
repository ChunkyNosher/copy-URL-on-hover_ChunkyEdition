/**
 * IncrementalSync - Incremental State Persistence
 * v1.6.4.15 - Phase 3B Optimization #2: Track and persist only changed fields
 *
 * Purpose: Reduce storage write payload from 5-15KB to 0.5-2KB (85% reduction)
 * by tracking which fields changed and persisting only deltas to storage.
 *
 * Features:
 * - Track change paths (e.g., tabs[id].minimized, tabs[id].position)
 * - Write only changed paths to storage under `quick-tabs-delta` key
 * - Apply delta to baseline state on load
 * - Periodic compaction of deltas back to full state
 *
 * Architecture:
 * - Deltas are stored separately from full state
 * - Full state is the source of truth, deltas are optimizations
 * - Compaction threshold prevents delta log bloat
 *
 * Expected Impact: 50-70% faster storage writes
 *
 * @module IncrementalSync
 */

// Delta storage key
const DELTA_STORAGE_KEY = 'quick_tabs_delta';

// Configuration constants
const MAX_DELTA_COUNT = 50; // Compact when deltas exceed this count
const DELTA_AGE_THRESHOLD_MS = 300000; // Compact deltas older than 5 minutes
const COMPACT_CHECK_INTERVAL_MS = 60000; // Check for compaction every minute

// Debug flag
const DEBUG_INCREMENTAL = false;

/**
 * Delta entry structure
 * @typedef {Object} DeltaEntry
 * @property {string} id - Quick Tab ID affected
 * @property {string} path - Change path (e.g., 'minimized', 'position.left')
 * @property {*} value - New value
 * @property {number} timestamp - When the change occurred
 * @property {string} operation - 'update', 'create', or 'delete'
 */

/**
 * Delta state structure
 * @typedef {Object} DeltaState
 * @property {DeltaEntry[]} entries - Array of delta entries
 * @property {string} baselineSaveId - SaveId of the baseline state
 * @property {number} lastCompaction - Timestamp of last compaction
 */

// In-memory delta state
let _deltaEntries = [];
let _baselineSaveId = null;
let _lastCompaction = Date.now();
let _compactCheckIntervalId = null;

// Metrics
const _metrics = {
  deltasTracked: 0,
  deltasApplied: 0,
  compactions: 0,
  bytesSaved: 0
};

/**
 * Log incremental sync operation if debug is enabled
 * @private
 * @param {string} operation - Operation name
 * @param {Object} details - Operation details
 */
function _logOperation(operation, details = {}) {
  if (!DEBUG_INCREMENTAL) return;
  console.log(`[IncrementalSync] ${operation}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Get browser storage API
 * @private
 * @returns {Object|null} Browser API or null
 */
function _getBrowserAPI() {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local) {
      return browser;
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return chrome;
    }
  } catch (_err) {
    // Ignore
  }
  return null;
}

/**
 * Track a change to Quick Tab state
 * Records the delta for incremental persistence
 *
 * @param {string} quickTabId - ID of the Quick Tab that changed
 * @param {string} path - Property path that changed (e.g., 'minimized', 'left')
 * @param {*} newValue - New value for the property
 * @param {string} [operation='update'] - Type of operation
 * @returns {DeltaEntry} The created delta entry
 */
export function trackChange(quickTabId, path, newValue, operation = 'update') {
  const entry = {
    id: quickTabId,
    path,
    value: newValue,
    timestamp: Date.now(),
    operation
  };

  _deltaEntries.push(entry);
  _metrics.deltasTracked++;

  _logOperation('CHANGE_TRACKED', {
    quickTabId,
    path,
    operation,
    totalDeltas: _deltaEntries.length
  });

  return entry;
}

/**
 * Track multiple changes for a Quick Tab (batch operation)
 * More efficient than multiple individual trackChange calls
 *
 * @param {string} quickTabId - ID of the Quick Tab that changed
 * @param {Object} changes - Object with changed properties
 * @param {string} [operation='update'] - Type of operation
 * @returns {DeltaEntry[]} Array of created delta entries
 */
export function trackBatchChanges(quickTabId, changes, operation = 'update') {
  if (!changes || typeof changes !== 'object') {
    return [];
  }

  const entries = [];
  const timestamp = Date.now();

  for (const [path, value] of Object.entries(changes)) {
    // Skip undefined values
    if (value === undefined) continue;

    const entry = {
      id: quickTabId,
      path,
      value,
      timestamp,
      operation
    };

    _deltaEntries.push(entry);
    entries.push(entry);
    _metrics.deltasTracked++;
  }

  _logOperation('BATCH_CHANGES_TRACKED', {
    quickTabId,
    changeCount: entries.length,
    paths: Object.keys(changes),
    totalDeltas: _deltaEntries.length
  });

  return entries;
}

/**
 * Track a Quick Tab creation
 *
 * @param {string} quickTabId - ID of the new Quick Tab
 * @param {Object} tabData - Full Quick Tab data
 * @returns {DeltaEntry} The created delta entry
 */
export function trackCreation(quickTabId, tabData) {
  return trackChange(quickTabId, '_full', tabData, 'create');
}

/**
 * Track a Quick Tab deletion
 *
 * @param {string} quickTabId - ID of the deleted Quick Tab
 * @returns {DeltaEntry} The created delta entry
 */
export function trackDeletion(quickTabId) {
  return trackChange(quickTabId, '_deleted', true, 'delete');
}

/**
 * Get pending deltas that haven't been persisted
 *
 * @returns {DeltaEntry[]} Array of pending delta entries
 */
export function getPendingDeltas() {
  return [..._deltaEntries];
}

/**
 * Get delta count for a specific Quick Tab
 *
 * @param {string} quickTabId - Quick Tab ID to count deltas for
 * @returns {number} Number of deltas for this Quick Tab
 */
export function getDeltaCountForTab(quickTabId) {
  return _deltaEntries.filter(entry => entry.id === quickTabId).length;
}

/**
 * Check if compaction is needed
 * @private
 * @returns {boolean} True if compaction should be performed
 */
function _shouldCompact() {
  // Compact if too many deltas
  if (_deltaEntries.length > MAX_DELTA_COUNT) {
    return true;
  }

  // Compact if oldest delta is too old
  if (_deltaEntries.length > 0) {
    const oldestTimestamp = Math.min(..._deltaEntries.map(e => e.timestamp));
    if (Date.now() - oldestTimestamp > DELTA_AGE_THRESHOLD_MS) {
      return true;
    }
  }

  return false;
}

/**
 * Handle delete operation delta
 * @private
 * @param {Object} state - State object
 * @param {number} tabIndex - Current tab index
 * @returns {number} New tab index after delete
 */
function _handleDeleteDelta(state, tabIndex) {
  if (tabIndex !== -1) {
    state.tabs.splice(tabIndex, 1);
    return -1;
  }
  return tabIndex;
}

/**
 * Handle create operation delta
 * @private
 * @param {Object} state - State object
 * @param {number} tabIndex - Current tab index
 * @param {*} value - New tab value
 * @returns {number} New tab index after create
 */
function _handleCreateDelta(state, tabIndex, value) {
  if (tabIndex === -1) {
    state.tabs.push(value);
    return state.tabs.length - 1;
  }
  // Replace existing
  state.tabs[tabIndex] = value;
  return tabIndex;
}

/**
 * Check if property key is a dangerous prototype property
 * @private
 * @param {string} key - Property key to check
 * @returns {boolean} True if key could cause prototype pollution
 */
function _isDangerousKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * Validate that a path contains only safe property keys
 * @private
 * @param {string[]} parts - Path parts to validate
 * @returns {boolean} True if all parts are safe
 */
function _validatePathParts(parts) {
  // Check all path parts for dangerous keys (prototype pollution prevention)
  return parts.every(part => !_isDangerousKey(part));
}

/**
 * Set a value at a specific level in the object hierarchy
 * Uses Object.hasOwn for safe property access
 * @private
 * @param {Object} target - Target object
 * @param {string} key - Property key (already validated as safe)
 * @param {*} value - Value to set (or undefined to ensure property exists)
 * @returns {Object} The child object at the key
 */
function _ensurePropertyExists(target, key) {
  // Use hasOwn check to ensure we only access own properties
  if (!Object.prototype.hasOwnProperty.call(target, key) || target[key] === null || target[key] === undefined) {
    target[key] = {};
  }
  return target[key];
}

/**
 * Set nested property value using dot-notation path
 * Includes prototype pollution protection
 * @private
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-notation path (e.g., 'position.left')
 * @param {*} value - Value to set
 * @returns {boolean} True if property was set, false if blocked
 */
function _setNestedProperty(obj, path, value) {
  const parts = path.split('.');

  // Validate all path parts before any modification
  if (!_validatePathParts(parts)) {
    console.warn('[IncrementalSync] Blocked dangerous property path:', path);
    return false;
  }

  // Navigate to parent object, creating intermediate objects as needed
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    // Additional runtime check for prototype pollution
    if (_isDangerousKey(part)) {
      return false;
    }
    target = _ensurePropertyExists(target, part);
  }

  // Set the final property value
  const finalKey = parts[parts.length - 1];
  // Additional runtime check for prototype pollution
  if (_isDangerousKey(finalKey)) {
    return false;
  }
  target[finalKey] = value;
  return true;
}

/**
 * Handle update operation delta
 * @private
 * @param {Object} state - State object
 * @param {number} tabIndex - Tab index to update
 * @param {Object} delta - Delta entry
 */
function _handleUpdateDelta(state, tabIndex, delta) {
  if (tabIndex === -1) {
    // Tab doesn't exist, skip update
    return;
  }

  if (delta.path === '_full') {
    state.tabs[tabIndex] = { ...delta.value };
  } else if (delta.path.includes('.')) {
    _setNestedProperty(state.tabs[tabIndex], delta.path, delta.value);
  } else {
    state.tabs[tabIndex][delta.path] = delta.value;
  }

  _metrics.deltasApplied++;
}

/**
 * Apply a single delta to state
 * @private
 * @param {Object} state - State object
 * @param {number} tabIndex - Current tab index
 * @param {Object} delta - Delta entry
 * @returns {number} New tab index after operation
 */
function _applySingleDelta(state, tabIndex, delta) {
  if (delta.operation === 'delete') {
    return _handleDeleteDelta(state, tabIndex);
  }

  if (delta.operation === 'create') {
    return _handleCreateDelta(state, tabIndex, delta.value);
  }

  // Update operation
  _handleUpdateDelta(state, tabIndex, delta);
  return tabIndex;
}

/**
 * Apply deltas to a baseline state to reconstruct current state
 *
 * @param {Object} baselineState - The baseline state object
 * @param {DeltaEntry[]} [deltas] - Deltas to apply (uses pending deltas if not provided)
 * @returns {Object} State with deltas applied
 */
export function applyDeltas(baselineState, deltas = null) {
  const deltasToApply = deltas || _deltaEntries;

  if (!baselineState || !baselineState.tabs) {
    _logOperation('APPLY_DELTAS_SKIP', { reason: 'invalid baseline' });
    return baselineState;
  }

  if (deltasToApply.length === 0) {
    return baselineState;
  }

  // Clone the baseline to avoid mutation
  const state = {
    ...baselineState,
    tabs: baselineState.tabs.map(tab => ({ ...tab }))
  };

  // Group deltas by Quick Tab ID for efficient processing
  const deltasByTab = new Map();
  for (const delta of deltasToApply) {
    if (!deltasByTab.has(delta.id)) {
      deltasByTab.set(delta.id, []);
    }
    deltasByTab.get(delta.id).push(delta);
  }

  // Apply deltas to each affected tab
  for (const [tabId, tabDeltas] of deltasByTab) {
    // Sort by timestamp to apply in order
    tabDeltas.sort((a, b) => a.timestamp - b.timestamp);

    // Find the tab in state
    let tabIndex = state.tabs.findIndex(t => t.id === tabId);

    for (const delta of tabDeltas) {
      tabIndex = _applySingleDelta(state, tabIndex, delta);
    }
  }

  _logOperation('DELTAS_APPLIED', {
    deltaCount: deltasToApply.length,
    tabsAffected: deltasByTab.size,
    resultTabCount: state.tabs.length
  });

  return state;
}

/**
 * Persist delta entries to storage
 * This is a lightweight write compared to full state persistence
 *
 * @returns {Promise<boolean>} True if persistence succeeded
 */
export async function persistDeltas() {
  const browserAPI = _getBrowserAPI();
  if (!browserAPI) {
    _logOperation('PERSIST_DELTAS_SKIP', { reason: 'no browser API' });
    return false;
  }

  if (_deltaEntries.length === 0) {
    _logOperation('PERSIST_DELTAS_SKIP', { reason: 'no deltas' });
    return true;
  }

  const deltaState = {
    entries: _deltaEntries,
    baselineSaveId: _baselineSaveId,
    lastCompaction: _lastCompaction,
    timestamp: Date.now()
  };

  try {
    await browserAPI.storage.local.set({ [DELTA_STORAGE_KEY]: deltaState });

    _logOperation('DELTAS_PERSISTED', {
      entryCount: _deltaEntries.length,
      baselineSaveId: _baselineSaveId
    });

    return true;
  } catch (err) {
    console.error('[IncrementalSync] Failed to persist deltas:', err.message);
    return false;
  }
}

/**
 * Load delta entries from storage
 *
 * @returns {Promise<DeltaState|null>} Delta state or null if not found
 */
export async function loadDeltas() {
  const browserAPI = _getBrowserAPI();
  if (!browserAPI) {
    return null;
  }

  try {
    const result = await browserAPI.storage.local.get(DELTA_STORAGE_KEY);
    const deltaState = result?.[DELTA_STORAGE_KEY];

    if (!deltaState || !Array.isArray(deltaState.entries)) {
      return null;
    }

    _logOperation('DELTAS_LOADED', {
      entryCount: deltaState.entries.length,
      baselineSaveId: deltaState.baselineSaveId
    });

    return deltaState;
  } catch (err) {
    console.error('[IncrementalSync] Failed to load deltas:', err.message);
    return null;
  }
}

/**
 * Clear all pending deltas (after full state write or compaction)
 *
 * @param {string} [newBaselineSaveId] - SaveId of the new baseline state
 */
export function clearDeltas(newBaselineSaveId = null) {
  const clearedCount = _deltaEntries.length;
  _deltaEntries = [];

  if (newBaselineSaveId) {
    _baselineSaveId = newBaselineSaveId;
  }

  _logOperation('DELTAS_CLEARED', {
    clearedCount,
    newBaselineSaveId
  });
}

/**
 * Set the baseline save ID (called after full state load)
 *
 * @param {string} saveId - SaveId of the baseline state
 */
export function setBaselineSaveId(saveId) {
  _baselineSaveId = saveId;
  _logOperation('BASELINE_SET', { saveId });
}

/**
 * Get the current baseline save ID
 *
 * @returns {string|null} Current baseline save ID
 */
export function getBaselineSaveId() {
  return _baselineSaveId;
}

/**
 * Perform compaction - merge deltas into baseline and clear
 * This should be called periodically or when delta count exceeds threshold
 *
 * @param {Object} currentState - Current full state to use as new baseline
 * @param {string} newSaveId - SaveId for the new baseline
 * @returns {boolean} True if compaction was performed
 */
export function compact(currentState, newSaveId) {
  if (_deltaEntries.length === 0) {
    return false;
  }

  const deltaCount = _deltaEntries.length;
  _deltaEntries = [];
  _baselineSaveId = newSaveId;
  _lastCompaction = Date.now();
  _metrics.compactions++;

  _logOperation('COMPACTION_COMPLETE', {
    deltasCompacted: deltaCount,
    newBaselineSaveId: newSaveId
  });

  return true;
}

/**
 * Check if compaction is recommended and return status
 *
 * @returns {{ shouldCompact: boolean, reason: string, deltaCount: number }}
 */
export function getCompactionStatus() {
  const deltaCount = _deltaEntries.length;

  if (deltaCount > MAX_DELTA_COUNT) {
    return {
      shouldCompact: true,
      reason: `Delta count (${deltaCount}) exceeds threshold (${MAX_DELTA_COUNT})`,
      deltaCount
    };
  }

  if (_deltaEntries.length > 0) {
    // Use reduce to find minimum timestamp efficiently (avoids creating intermediate array)
    const oldestTimestamp = _deltaEntries.reduce(
      (min, e) => (e.timestamp < min ? e.timestamp : min),
      _deltaEntries[0].timestamp
    );
    const ageMs = Date.now() - oldestTimestamp;

    if (ageMs > DELTA_AGE_THRESHOLD_MS) {
      return {
        shouldCompact: true,
        reason: `Oldest delta (${Math.round(ageMs / 1000)}s) exceeds age threshold (${DELTA_AGE_THRESHOLD_MS / 1000}s)`,
        deltaCount
      };
    }
  }

  return {
    shouldCompact: false,
    reason: 'No compaction needed',
    deltaCount
  };
}

// Cache for delta size to avoid repeated JSON.stringify calls
let _cachedDeltaSize = 0;
let _cachedDeltaCount = 0;

/**
 * Calculate estimated bytes saved by using incremental sync
 *
 * @param {number} fullStateSize - Size of full state in bytes
 * @returns {number} Estimated bytes saved
 */
export function calculateBytesSaved(fullStateSize) {
  if (_deltaEntries.length === 0) {
    return 0;
  }

  // Only recalculate if delta count changed (cache invalidation)
  if (_deltaEntries.length !== _cachedDeltaCount) {
    _cachedDeltaSize = JSON.stringify(_deltaEntries).length;
    _cachedDeltaCount = _deltaEntries.length;
  }

  const saved = Math.max(0, fullStateSize - _cachedDeltaSize);

  _metrics.bytesSaved += saved;
  return saved;
}

/**
 * Get incremental sync metrics
 *
 * @returns {Object} Metrics object
 */
export function getMetrics() {
  return {
    ..._metrics,
    pendingDeltas: _deltaEntries.length,
    baselineSaveId: _baselineSaveId,
    lastCompaction: _lastCompaction,
    timeSinceCompaction: Date.now() - _lastCompaction
  };
}

/**
 * Reset all metrics
 */
export function resetMetrics() {
  _metrics.deltasTracked = 0;
  _metrics.deltasApplied = 0;
  _metrics.compactions = 0;
  _metrics.bytesSaved = 0;
}

/**
 * Start periodic compaction check
 *
 * @param {Function} [onCompactNeeded] - Callback when compaction is needed
 */
export function startCompactionMonitor(onCompactNeeded = null) {
  if (_compactCheckIntervalId) {
    clearInterval(_compactCheckIntervalId);
  }

  _compactCheckIntervalId = setInterval(() => {
    if (_shouldCompact() && onCompactNeeded) {
      onCompactNeeded(getCompactionStatus());
    }
  }, COMPACT_CHECK_INTERVAL_MS);

  _logOperation('COMPACTION_MONITOR_STARTED', {
    intervalMs: COMPACT_CHECK_INTERVAL_MS
  });
}

/**
 * Stop periodic compaction check
 */
export function stopCompactionMonitor() {
  if (_compactCheckIntervalId) {
    clearInterval(_compactCheckIntervalId);
    _compactCheckIntervalId = null;
    _logOperation('COMPACTION_MONITOR_STOPPED', {});
  }
}

/**
 * Initialize incremental sync from storage
 * Call this on startup to restore delta state
 *
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function initialize() {
  const deltaState = await loadDeltas();

  if (deltaState) {
    _deltaEntries = deltaState.entries || [];
    _baselineSaveId = deltaState.baselineSaveId || null;
    _lastCompaction = deltaState.lastCompaction || Date.now();

    _logOperation('INITIALIZED_FROM_STORAGE', {
      deltaCount: _deltaEntries.length,
      baselineSaveId: _baselineSaveId
    });

    return true;
  }

  _logOperation('INITIALIZED_FRESH', {});
  return true;
}

// Export default object with all methods
export default {
  trackChange,
  trackBatchChanges,
  trackCreation,
  trackDeletion,
  getPendingDeltas,
  getDeltaCountForTab,
  applyDeltas,
  persistDeltas,
  loadDeltas,
  clearDeltas,
  setBaselineSaveId,
  getBaselineSaveId,
  compact,
  getCompactionStatus,
  calculateBytesSaved,
  getMetrics,
  resetMetrics,
  startCompactionMonitor,
  stopCompactionMonitor,
  initialize
};
