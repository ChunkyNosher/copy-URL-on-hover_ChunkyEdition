/**
 * Storage utility functions for Quick Tabs
 * v1.6.3.4 - Extracted from handlers to reduce duplication
 * v1.6.3.4-v2 - FIX Bug #1: Add Promise timeout, validation, and detailed logging
 * v1.6.3.4 - FIX Issue #3: Add z-index persistence
 * v1.6.3.4-v6 - FIX Issues #1-6: Add transaction tracking, URL validation, state validation
 * v1.6.3.4-v8 - FIX Issues #1, #7: Empty write protection, storage write queue
 * v1.6.3.4-v12 - FIX Diagnostic Report Issues #1, #6:
 *   - Enhanced storage write logging with caller identification
 *   - Transaction sequencing with pending count tracking
 *   - Improved saveId validation before writes complete
 * v1.6.3.5-v5 - FIX Quick Tab Restore Diagnostic Issues:
 *   - Issue #5: Ownership-based write filtering using originTabId
 *   - Issue #7: Event-driven cleanup replaces fixed-delay cleanup
 * v1.6.3.6 - FIX Critical Quick Tab Restore Bugs:
 *   - Issue #2, #4: Reduced transaction timeout from 5s to 2s to prevent backlog
 *   - Transaction confirmation is decoupled from rendering
 * v1.6.3.6-v3 - FIX Critical Storage Loop Issues:
 *   - Issue #1: Async Tab ID Race - Block writes with unknown tab ID instead of allowing
 *   - Issue #2: Circuit breaker to block all writes when pendingWriteCount > 15
 *   - Issue #4: Empty state corruption fixed by Issue #1's fail-closed approach
 * v1.6.3.7-v3 - API #1: storage.session support
 *   - Added SESSION_STATE_KEY for session-only Quick Tabs
 *   - Added routeTabToStorage() for permanent/session routing
 *   - Added loadAllQuickTabs() to load from both storage layers
 *   - Added saveSessionQuickTabs() for session storage writes
 *
 * Architecture (Single-Tab Model v1.6.3+):
 * - Each tab only writes state for Quick Tabs it owns (originTabId matches)
 * - Self-write detection via writingInstanceId/writingTabId
 * - Transaction IDs tracked until storage.onChanged confirms processing
 *
 * @module storage-utils
 */

import { CONSTANTS } from '../core/config.js';

// Storage key for Quick Tabs state (unified format v1.6.2.2+)
export const STATE_KEY = 'quick_tabs_state_v2';

// v1.6.3.7-v3 - API #1: Session storage key for session-only Quick Tabs
// Session storage auto-clears when browser closes (no stale data persistence)
export const SESSION_STATE_KEY = 'quick_tabs_session_state';

// v1.6.3.4-v2 - FIX Bug #1: Timeout for storage operations (5 seconds)
// v1.6.3.6 - FIX Issue #2: Reduced from 5000ms to 2000ms to prevent transaction backlog
const STORAGE_TIMEOUT_MS = 2000;

// v1.6.3.4 - FIX Issue #3: Use CONSTANTS.QUICK_TAB_BASE_Z_INDEX for consistency
const DEFAULT_ZINDEX = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;

// v1.6.3.4-v6 - FIX Issue #1: Transaction tracking for atomic storage writes
// Set of in-progress transaction IDs to prevent storage.onChanged race conditions
export const IN_PROGRESS_TRANSACTIONS = new Set();

// v1.6.3.4-v6 - FIX Issue #5: Hash tracking for deduplication
let lastPersistedStateHash = 0;

// v1.6.3.4-v6 - FIX Issue #5: Cooldown period for storage changes
const STORAGE_CHANGE_COOLDOWN_MS = 50;
let lastStorageChangeTime = 0;

// v1.6.3.6-v5 - FIX Issue #4b: Storage operation logging infrastructure
// Unique operation ID counter for tracing storage I/O
let storageOperationCounter = 0;

/**
 * Generate unique storage operation ID
 * v1.6.3.6-v5 - FIX Issue #4b: Track storage operations for debugging
 * @returns {string} Unique operation ID
 */
function generateStorageOperationId() {
  storageOperationCounter++;
  return `op-${Date.now()}-${storageOperationCounter}`;
}

/**
 * Log storage read operation (pre and post)
 * v1.6.3.6-v5 - FIX Issue #4b: Storage access visibility
 * Logs key, status, size (no payloads) and timing
 * @param {string} operationId - Unique operation ID
 * @param {string} key - Storage key being read
 * @param {string} phase - 'start' or 'complete'
 * @param {Object} details - Additional details (size, success, duration)
 */
function logStorageRead(operationId, key, phase, details = {}) {
  if (phase === 'start') {
    console.log('[StorageUtils] 📖 storage.get START:', {
      operationId,
      key,
      timestamp: Date.now()
    });
  } else if (phase === 'complete') {
    console.log('[StorageUtils] 📖 storage.get COMPLETE:', {
      operationId,
      key,
      success: details.success,
      dataFound: details.dataFound,
      tabCount: details.tabCount ?? 'N/A',
      durationMs: details.durationMs,
      timestamp: Date.now()
    });
  }
}

/**
 * Log storage write operation (pre and post)
 * v1.6.3.6-v5 - FIX Issue #4b: Storage access visibility
 * Logs operation ID, size, completion status, timing (no payloads)
 * @param {string} operationId - Unique operation ID
 * @param {string} key - Storage key being written
 * @param {string} phase - 'start' or 'complete'
 * @param {Object} details - Additional details (size, success, duration)
 */
function logStorageWrite(operationId, key, phase, details = {}) {
  if (phase === 'start') {
    console.log('[StorageUtils] 📝 storage.set START:', {
      operationId,
      key,
      tabCount: details.tabCount ?? 'N/A',
      transactionId: details.transactionId ?? 'N/A',
      timestamp: Date.now()
    });
  } else if (phase === 'complete') {
    console.log('[StorageUtils] 📝 storage.set COMPLETE:', {
      operationId,
      key,
      success: details.success,
      tabCount: details.tabCount ?? 'N/A',
      durationMs: details.durationMs,
      transactionId: details.transactionId ?? 'N/A',
      timestamp: Date.now()
    });
  }
}

// v1.6.3.5-v5 - FIX Issue #7: Event-driven transaction cleanup replaces fixed-delay
// Transaction IDs are now kept until storage.onChanged event confirms processing
// This prevents race conditions where cleanup happened before event fired
// Map from transactionId to cleanup timeout (for fallback cleanup)
const TRANSACTION_CLEANUP_TIMEOUTS = new Map();
// Map for escalation warning timeouts (separate from main cleanup timeouts)
const TRANSACTION_WARNING_TIMEOUTS = new Map();
// v1.6.3.6 - FIX Issue #4: Reduced from 5000ms to 2000ms to prevent transaction backlog
// v1.6.3.6-v3 - FIX Issue #5: Reduced from 2000ms to 500ms for faster loop detection
// Fallback cleanup delay - only used if storage.onChanged never fires
// Normal writes complete in 50-100ms; 500ms catches loops before browser freezes
const TRANSACTION_FALLBACK_CLEANUP_MS = 500;
// v1.6.3.6-v3 - FIX Issue #3: Intermediate warning at 250ms (half of TRANSACTION_FALLBACK_CLEANUP_MS)
const ESCALATION_WARNING_MS = 250;

// v1.6.3.4-v8 - FIX Issue #1: Empty write protection
// Cooldown period between empty (0 tabs) writes to prevent cascades
const EMPTY_WRITE_COOLDOWN_MS = 1000;
let lastEmptyWriteTime = 0;
// Note: previousTabCount is safe as module-level state because:
// 1. JavaScript is single-threaded for synchronous code
// 2. Storage writes are queued in FIFO order via storageWriteQueuePromise
// 3. This is only used for WARNING logging, not for correctness
let previousTabCount = 0;

// v1.6.3.4-v8 - FIX Issue #7: Storage write queue for FIFO ordering
// Each persist operation waits for previous one to complete
let storageWriteQueuePromise = Promise.resolve();

// v1.6.3.4-v12 - FIX Issue #1, #6: Track pending write count for logging
let pendingWriteCount = 0;
let lastCompletedTransactionId = null;

// v1.6.3.6-v3 - FIX Issue #2: Circuit breaker to prevent infinite storage write loops
// When pendingWriteCount exceeds this threshold, ALL new writes are blocked
const CIRCUIT_BREAKER_THRESHOLD = 15;
const CIRCUIT_BREAKER_RESET_THRESHOLD = 10; // Auto-reset when queue drains below this
let circuitBreakerTripped = false;
let circuitBreakerTripTime = null;

// v1.6.3.4-v9 - FIX Issue #16, #17: Transaction pattern with rollback capability
// Stores state snapshots for rollback on failure
let stateSnapshot = null;
let transactionActive = false;

// v1.6.3.5-v4 - FIX Diagnostic Issue #1: Per-tab ownership enforcement
// Only the tab that owns a Quick Tab (originTabId matches currentTabId) should write state
// This prevents cross-tab storage storms where non-owner tabs write stale 0-tab state
let ownershipValidationEnabled = true;

// v1.6.3.6-v2 - FIX Diagnostic Issue #1: Enhanced self-write detection
// writingInstanceId is unique per tab load (generated once at module load)
// This allows storage.onChanged handlers to detect and skip self-writes
// v1.6.3.6-v2 - FIX: Triple-source entropy to prevent collisions even for simultaneous tab loads
// Uses: performance.now() (high resolution), Math.random(), crypto.getRandomValues(), module-level counter
let writeCounter = 0; // v1.6.3.6-v2: Module-level counter for unique IDs
const WRITING_INSTANCE_ID = (() => {
  // Use performance.now() for higher resolution than Date.now()
  const highResTime =
    typeof performance !== 'undefined' && performance.now
      ? performance.now().toString(36).replace('.', '')
      : Date.now().toString(36);
  const timestamp = Date.now().toString(36);
  const randomPart1 = Math.random().toString(36).slice(2, 8);

  // Use crypto.getRandomValues if available for additional entropy
  let randomPart2 = Math.random().toString(36).slice(2, 6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(4);
    crypto.getRandomValues(array);
    randomPart2 = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  return `inst-${timestamp}-${highResTime}-${randomPart1}-${randomPart2}`;
})();

// v1.6.3.6-v2 - FIX Issue #1: Track last written transaction ID for deterministic self-write detection
// This provides a secondary check independent of writingInstanceId matching
let lastWrittenTransactionId = null;

// v1.6.3.6-v2 - FIX Issue #3: Track tabs that have ever created/owned Quick Tabs
// Used to validate empty writes - only tabs with ownership history can write empty state
const previouslyOwnedTabIds = new Set();

// v1.6.3.6-v2 - FIX Issue #2: Track duplicate saveId writes to detect loops
// Map of saveId → { count, firstTimestamp }
const saveIdWriteTracker = new Map();
const DUPLICATE_SAVEID_WINDOW_MS = 1000; // Track duplicates within 1 second
// v1.6.3.6-v3 - FIX Issue #3: Reduced from 2 to 1 for faster loop detection
// Warn if same saveId written more than once
const DUPLICATE_SAVEID_THRESHOLD = 1;

// Current tab ID for self-write detection (initialized lazily)
let currentWritingTabId = null;

/**
 * Initialize the writing tab ID asynchronously
 * v1.6.3.5-v3 - FIX Diagnostic Issue #1: Self-write detection
 */
async function initWritingTabId() {
  if (currentWritingTabId !== null) return currentWritingTabId;

  try {
    const browserAPI = getBrowserStorageAPI();
    const tab = await _fetchCurrentTab(browserAPI);
    if (tab?.id) {
      currentWritingTabId = tab.id;
      console.log('[StorageUtils] Initialized writingTabId:', currentWritingTabId);
    }
  } catch (err) {
    console.warn('[StorageUtils] Could not get current tab ID:', err.message);
  }

  return currentWritingTabId;
}

/**
 * Fetch current tab from browser API
 * v1.6.3.5-v3 - FIX Code Review: Added error handling
 * @private
 */
function _fetchCurrentTab(browserAPI) {
  if (!browserAPI?.tabs?.getCurrent) return Promise.resolve(null);
  return browserAPI.tabs.getCurrent().catch(err => {
    console.warn('[StorageUtils] Failed to get current tab:', err.message);
    return null;
  });
}

/**
 * Get or initialize the current tab ID for self-write detection
 * @returns {Promise<number|null>} Current tab ID or null
 */
export function getWritingTabId() {
  return initWritingTabId();
}

/**
 * Check if tabId is a valid positive integer
 * v1.6.4.8 - FIX CodeScene: Extract complex conditional from setWritingTabId
 * @private
 * @param {*} tabId - Value to validate
 * @returns {boolean} True if valid positive integer
 */
function _isValidPositiveInteger(tabId) {
  return typeof tabId === 'number' && Number.isInteger(tabId) && tabId > 0;
}

/**
 * Explicitly set the writing tab ID
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Allow content scripts to set tab ID
 * Content scripts cannot use browser.tabs.getCurrent(), so they need to
 * get the tab ID from background script and pass it here.
 *
 * @param {number} tabId - The browser tab ID to use for ownership tracking (must be positive integer)
 */
export function setWritingTabId(tabId) {
  // Validate that tabId is a positive integer (browser tab IDs are always positive)
  if (!_isValidPositiveInteger(tabId)) {
    console.warn('[StorageUtils] setWritingTabId called with invalid tabId:', {
      tabId,
      type: typeof tabId,
      isInteger: Number.isInteger(tabId),
      isPositive: tabId > 0
    });
    return;
  }

  const oldTabId = currentWritingTabId;
  currentWritingTabId = tabId;
  console.log('[StorageUtils] Writing tab ID set explicitly:', {
    oldTabId,
    newTabId: tabId
  });
}

/**
 * Get the instance ID for self-write detection
 * @returns {string} Unique instance ID for this tab load
 */
export function getWritingInstanceId() {
  return WRITING_INSTANCE_ID;
}

/**
 * Check if the transaction ID matches our last written transaction
 * v1.6.3.6-v2 - Extracted from isSelfWrite to reduce complexity
 * @private
 */
function _isMatchingTransactionId(transactionId) {
  return lastWrittenTransactionId && transactionId && transactionId === lastWrittenTransactionId;
}

/**
 * Check if the instance ID matches our own instance
 * v1.6.3.6-v2 - Extracted from isSelfWrite to reduce complexity
 * @private
 */
function _isMatchingInstanceId(writingInstanceId) {
  return writingInstanceId && writingInstanceId === WRITING_INSTANCE_ID;
}

/**
 * Check if the tab ID matches our current tab
 * v1.6.3.6-v2 - Extracted from isSelfWrite to reduce complexity
 * @private
 */
function _isMatchingTabId(writingTabId, currentTabId) {
  const tabId = currentTabId ?? currentWritingTabId;
  return tabId !== null && writingTabId && writingTabId === tabId;
}

/**
 * Check if a storage change is a self-write (from this tab/instance)
 * v1.6.3.5-v3 - FIX Diagnostic Issue #1: Skip processing of self-writes
 * v1.6.3.6-v2 - FIX Issue #1: Add lastWrittenTransactionId check for deterministic detection
 * v1.6.3.6-v2 - Refactored: Extracted helpers to reduce complexity
 * @param {Object} newValue - New storage value with writingTabId/writingInstanceId
 * @param {number|null} currentTabId - Current tab's ID (optional, uses cached if null)
 * @returns {boolean} True if this is a self-write that should be skipped
 */
export function isSelfWrite(newValue, currentTabId = null) {
  if (!newValue) return false;

  // v1.6.3.6-v2 - FIX Issue #1: Check lastWrittenTransactionId first (most deterministic)
  if (_isMatchingTransactionId(newValue.transactionId)) {
    console.log('[StorageUtils] SKIPPED self-write (lastWrittenTransactionId matches):', {
      transactionId: newValue.transactionId
    });
    return true;
  }

  // Check instance ID (second most reliable)
  if (_isMatchingInstanceId(newValue.writingInstanceId)) {
    console.log('[StorageUtils] SKIPPED self-write (writingInstanceId matches):', {
      instanceId: WRITING_INSTANCE_ID,
      transactionId: newValue.transactionId
    });
    return true;
  }

  // Fall back to tab ID check
  if (_isMatchingTabId(newValue.writingTabId, currentTabId)) {
    console.log('[StorageUtils] SKIPPED self-write (writingTabId matches):', {
      tabId: currentTabId ?? currentWritingTabId,
      transactionId: newValue.transactionId
    });
    return true;
  }

  return false;
}

/**
 * Check if this tab is the owner of a Quick Tab (has originTabId matching currentTabId)
 * v1.6.3.5-v4 - FIX Diagnostic Issue #1: Per-tab ownership enforcement
 * @param {Object} tabData - Quick Tab data with originTabId
 * @param {number|null} currentTabId - Current tab's ID (optional, uses cached if null)
 * @returns {boolean} True if this tab is the owner (can modify), false otherwise
 */
export function canCurrentTabModifyQuickTab(tabData, currentTabId = null) {
  // Get current tab ID
  const tabId = currentTabId ?? currentWritingTabId;

  // If we don't have originTabId, we can't determine ownership - allow write
  if (tabData.originTabId === null || tabData.originTabId === undefined) {
    return true;
  }

  // If we don't know our tab ID, allow write (can't validate)
  if (tabId === null) {
    return true;
  }

  return tabData.originTabId === tabId;
}

// Legacy alias for backwards compatibility
export const isOwnerOfQuickTab = canCurrentTabModifyQuickTab;

/**
 * Filter tabs to only those owned by the specified tab ID
 * v1.6.3.6-v2 - Extracted from validateOwnershipForWrite to reduce complexity
 * @private
 */
function _filterOwnedTabs(tabs, tabId) {
  return tabs.filter(tab => {
    // No originTabId means we can't determine ownership - include it
    if (tab.originTabId === null || tab.originTabId === undefined) {
      return true;
    }
    return tab.originTabId === tabId;
  });
}

/**
 * Log ownership filtering decision
 * v1.6.3.6-v2 - Extracted from validateOwnershipForWrite to reduce complexity
 * @private
 */
function _logOwnershipFiltering(tabs, ownedTabs, tabId) {
  const nonOwnedCount = tabs.length - ownedTabs.length;
  if (nonOwnedCount > 0) {
    console.log('[StorageUtils] Ownership filtering:', {
      currentTabId: tabId,
      totalTabs: tabs.length,
      ownedTabs: ownedTabs.length,
      filteredOut: nonOwnedCount,
      filteredIds: tabs
        .filter(
          t => t.originTabId !== tabId && t.originTabId !== null && t.originTabId !== undefined
        )
        .map(t => ({
          id: t.id,
          originTabId: t.originTabId
        }))
    });
  }
}

/**
 * Handle empty write validation for ownership checking
 * v1.6.3.6-v2 - Extracted from validateOwnershipForWrite to reduce complexity
 * @private
 */
function _handleEmptyWriteValidation(tabId, forceEmpty) {
  const hasOwnershipHistory = previouslyOwnedTabIds.has(tabId);

  if (!forceEmpty) {
    console.warn('[StorageUtils] Storage write BLOCKED - no owned tabs:', {
      currentTabId: tabId,
      tabCount: 0,
      forceEmpty,
      hasOwnershipHistory,
      reason: 'Empty write requires forceEmpty=true'
    });
    return {
      shouldWrite: false,
      ownedTabs: [],
      reason: 'empty write blocked - forceEmpty required'
    };
  }

  if (!hasOwnershipHistory) {
    console.warn('[StorageUtils] Storage write BLOCKED - no ownership history:', {
      currentTabId: tabId,
      tabCount: 0,
      forceEmpty,
      hasOwnershipHistory,
      reason: 'Tab never owned Quick Tabs, cannot write empty state'
    });
    return {
      shouldWrite: false,
      ownedTabs: [],
      reason: 'empty write blocked - no ownership history'
    };
  }

  // Tab has ownership history and forceEmpty=true - allow empty write
  console.log('[StorageUtils] Empty write allowed:', {
    currentTabId: tabId,
    forceEmpty,
    hasOwnershipHistory
  });
  return {
    shouldWrite: true,
    ownedTabs: [],
    reason: 'intentional empty write with ownership history'
  };
}

/**
 * Check if current tab should write to storage based on Quick Tab ownership
 * v1.6.3.5-v4 - FIX Diagnostic Issue #1: Only owner tabs should write state
 * v1.6.3.6-v2 - FIX Issue #3: Remove tabs.length === 0 bypass, require forceEmpty + ownership history
 * v1.6.3.6-v2 - Refactored: Extracted helpers to reduce complexity
 * @param {Array} tabs - Array of Quick Tab data objects
 * @param {number|null} currentTabId - Current tab's ID
 * @param {boolean} forceEmpty - Whether this is an intentional empty write (e.g., Close All)
 * @returns {{ shouldWrite: boolean, ownedTabs: Array, reason: string }}
 */
export function validateOwnershipForWrite(tabs, currentTabId = null, forceEmpty = false) {
  if (!ownershipValidationEnabled) {
    return { shouldWrite: true, ownedTabs: tabs, reason: 'ownership validation disabled' };
  }

  if (!Array.isArray(tabs)) {
    return { shouldWrite: true, ownedTabs: [], reason: 'invalid tabs array' };
  }

  const tabId = currentTabId ?? currentWritingTabId;

  // v1.6.3.6-v3 - FIX Issue #1: Block writes with unknown tab ID (fail-closed approach)
  // Previously this allowed writes with unknown tab ID, which caused:
  // - Self-write detection to fail (isSelfWrite returns false)
  // - Empty state corruption from non-owner tabs
  // Now we block writes until tab ID is initialized
  if (tabId === null) {
    console.warn('[StorageUtils] Storage write BLOCKED - unknown tab ID (initialization race?):', {
      tabCount: tabs.length,
      forceEmpty,
      suggestion:
        'Pass tabId parameter to persistStateToStorage() or wait for initWritingTabId() to complete'
    });
    return { shouldWrite: false, ownedTabs: [], reason: 'unknown tab ID - blocked for safety' };
  }

  // Filter to only tabs owned by this tab
  const ownedTabs = _filterOwnedTabs(tabs, tabId);
  _logOwnershipFiltering(tabs, ownedTabs, tabId);

  // v1.6.3.6-v2 - FIX Issue #3: Handle empty state writes properly
  if (tabs.length === 0) {
    return _handleEmptyWriteValidation(tabId, forceEmpty);
  }

  // v1.6.3.6-v2 - FIX Issue #3: Track ownership when writing tabs
  if (ownedTabs.length > 0) {
    previouslyOwnedTabIds.add(tabId);
  }

  // Should write if we own at least one tab
  const shouldWrite = ownedTabs.length > 0;

  return {
    shouldWrite,
    ownedTabs,
    reason: shouldWrite ? 'has owned tabs' : 'no owned tabs - non-owner write blocked'
  };
}

/**
 * Enable or disable ownership validation for storage writes
 * v1.6.3.5-v4 - FIX Diagnostic Issue #1: Allow toggling for backwards compatibility
 * @param {boolean} enabled - Whether to enable ownership validation
 */
export function setOwnershipValidationEnabled(enabled) {
  ownershipValidationEnabled = enabled;
  console.log('[StorageUtils] Ownership validation enabled:', enabled);
}

/**
 * Process successful snapshot capture result
 * v1.6.4.8 - FIX CodeScene: Extract from captureStateSnapshot to reduce complexity
 * @private
 * @param {Object} result - Storage read result
 * @param {string} operationId - Operation ID for logging
 * @param {number} startTime - Start time of operation
 * @param {string} logPrefix - Log prefix
 * @returns {Object} State snapshot
 */
function _processSnapshotResult(result, operationId, startTime, logPrefix) {
  const durationMs = Date.now() - startTime;

  stateSnapshot = result?.[STATE_KEY] || { tabs: [], timestamp: 0 };
  const tabCount = stateSnapshot.tabs?.length || 0;

  logStorageRead(operationId, STATE_KEY, 'complete', {
    success: true,
    dataFound: !!result?.[STATE_KEY],
    tabCount,
    durationMs
  });

  console.log(`${logPrefix} State snapshot captured:`, {
    tabCount,
    timestamp: stateSnapshot.timestamp
  });

  return stateSnapshot;
}

/**
 * Handle snapshot capture error
 * v1.6.4.8 - FIX CodeScene: Extract from captureStateSnapshot to reduce complexity
 * @private
 * @param {Error} err - Error that occurred
 * @param {string} operationId - Operation ID for logging
 * @param {number} startTime - Start time of operation
 * @param {string} logPrefix - Log prefix
 */
function _handleSnapshotError(err, operationId, startTime, logPrefix) {
  const durationMs = Date.now() - startTime;

  logStorageRead(operationId, STATE_KEY, 'complete', {
    success: false,
    dataFound: false,
    durationMs
  });

  console.error(`${logPrefix} Failed to capture state snapshot:`, err);
}

/**
 * Capture current storage state as a snapshot for potential rollback
 * v1.6.3.4-v9 - FIX Issue #16, #17: Transaction pattern implementation
 * v1.6.3.6-v5 - FIX Issue #4b: Added storage read logging
 * v1.6.4.8 - FIX CodeScene: Reduce complexity by extracting helpers
 *
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<Object|null>} Captured state snapshot or null on error
 */
export async function captureStateSnapshot(logPrefix = '[StorageUtils]') {
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI?.storage?.local) {
    console.warn(`${logPrefix} Cannot capture snapshot: storage.local API unavailable`);
    return null;
  }

  const operationId = generateStorageOperationId();
  const startTime = Date.now();

  logStorageRead(operationId, STATE_KEY, 'start');

  try {
    const result = await browserAPI.storage.local.get(STATE_KEY);
    return _processSnapshotResult(result, operationId, startTime, logPrefix);
  } catch (err) {
    _handleSnapshotError(err, operationId, startTime, logPrefix);
    return null;
  }
}

/**
 * Begin a storage transaction - captures state snapshot
 * v1.6.3.4-v9 - FIX Issue #17: Transaction pattern with BEGIN/COMMIT/ROLLBACK
 *
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<boolean>} True if transaction started, false if already active
 */
export async function beginTransaction(logPrefix = '[StorageUtils]') {
  if (transactionActive) {
    console.warn(`${logPrefix} Transaction already active - nested transactions not supported`);
    return false;
  }

  transactionActive = true;
  const snapshot = await captureStateSnapshot(logPrefix);

  if (!snapshot) {
    transactionActive = false;
    console.error(`${logPrefix} Failed to begin transaction: could not capture snapshot`);
    return false;
  }

  console.log(`${logPrefix} Transaction BEGIN`);
  return true;
}

/**
 * Commit current transaction - clears snapshot and marks transaction complete
 * v1.6.3.4-v9 - FIX Issue #17: Transaction pattern with BEGIN/COMMIT/ROLLBACK
 *
 * @param {string} logPrefix - Prefix for log messages
 * @returns {boolean} True if committed, false if no active transaction
 */
export function commitTransaction(logPrefix = '[StorageUtils]') {
  if (!transactionActive) {
    console.warn(`${logPrefix} No active transaction to commit`);
    return false;
  }

  stateSnapshot = null;
  transactionActive = false;
  console.log(`${logPrefix} Transaction COMMIT`);
  return true;
}

/**
 * Rollback current transaction - restores state snapshot to storage
 * v1.6.3.4-v9 - FIX Issue #16, #17: Rollback on failure instead of writing empty state
 *
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<boolean>} True if rollback succeeded, false on error
 */
export async function rollbackTransaction(logPrefix = '[StorageUtils]') {
  if (!transactionActive) {
    console.warn(`${logPrefix} No active transaction to rollback`);
    return false;
  }

  if (!stateSnapshot) {
    console.error(`${logPrefix} Cannot rollback: no snapshot available`);
    transactionActive = false;
    return false;
  }

  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.error(`${logPrefix} Cannot rollback: storage API unavailable`);
    transactionActive = false;
    return false;
  }

  try {
    console.log(`${logPrefix} Transaction ROLLBACK - restoring snapshot:`, {
      tabCount: stateSnapshot.tabs?.length || 0
    });

    await browserAPI.storage.local.set({ [STATE_KEY]: stateSnapshot });

    stateSnapshot = null;
    transactionActive = false;
    console.log(`${logPrefix} Rollback completed successfully`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} Rollback FAILED:`, err);
    transactionActive = false;
    return false;
  }
}

/**
 * Check if a transaction is currently active
 * v1.6.3.4-v9 - FIX Issue #17: Helper for transaction state
 *
 * @returns {boolean} True if transaction is active
 */
export function isTransactionActive() {
  return transactionActive;
}

/**
 * Get the current state snapshot (if transaction is active)
 * v1.6.3.4-v9 - FIX Issue #17: Helper for accessing snapshot
 *
 * @returns {Object|null} Current snapshot or null
 */
export function getStateSnapshot() {
  return stateSnapshot;
}

/**
 * Generate unique save ID for storage deduplication
 * Format: 'timestamp-random9chars'
 *
 * @returns {string} Unique save ID
 */
export function generateSaveId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Generate unique transaction ID for storage write tracking
 * v1.6.3.4-v6 - FIX Issue #1: Transaction IDs for atomic storage writes
 * v1.6.3.6-v2 - FIX Issue #1: Include writeCounter for truly unique IDs
 * Format: 'txn-timestamp-counter-random6chars'
 *
 * @returns {string} Unique transaction ID
 */
export function generateTransactionId() {
  // Increment counter for each transaction (prevents collisions even in same millisecond)
  writeCounter++;
  return `txn-${Date.now()}-${writeCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if URL is null, undefined, or empty
 * v1.6.3.4-v6 - Extracted to reduce isValidQuickTabUrl complexity
 * @private
 * @param {*} url - URL to check
 * @returns {boolean} True if URL is nullish
 */
function _isNullishUrl(url) {
  return url === undefined || url === null || url === '';
}

/**
 * Check if URL is the literal "undefined" string
 * v1.6.3.4-v6 - Extracted to reduce isValidQuickTabUrl complexity
 * @private
 * @param {*} url - URL to check
 * @returns {boolean} True if URL is literal "undefined"
 */
function _isLiteralUndefined(url) {
  return url === 'undefined' || String(url) === 'undefined';
}

/**
 * Check if URL string starts with a valid protocol
 * v1.6.3.4-v6 - Extracted to reduce isValidQuickTabUrl complexity
 * @private
 * @param {string} urlStr - URL string
 * @returns {boolean} True if protocol is valid
 */
function _hasValidProtocol(urlStr) {
  const validProtocols = ['http://', 'https://', 'moz-extension://', 'chrome-extension://'];
  return validProtocols.some(proto => urlStr.startsWith(proto));
}

/**
 * Validate URL is valid for Quick Tab creation
 * v1.6.3.4-v6 - FIX Issue #2: Reject malformed URLs
 * Refactored: Extracted helpers to reduce complexity
 *
 * @param {*} url - URL to validate
 * @returns {boolean} True if URL is valid
 */
export function isValidQuickTabUrl(url) {
  // Reject undefined, null, empty string or literal "undefined"
  if (_isNullishUrl(url) || _isLiteralUndefined(url)) {
    return false;
  }

  const urlStr = String(url);

  // Reject URLs containing /undefined path
  if (urlStr.includes('/undefined')) {
    return false;
  }

  // Allow about:blank for testing
  if (urlStr === 'about:blank') {
    return true;
  }

  // Must start with valid protocol and be parseable
  if (!_hasValidProtocol(urlStr)) {
    return false;
  }

  try {
    new URL(urlStr);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Check if storage change should be processed (deduplication)
 * v1.6.3.4-v6 - FIX Issue #5: Prevent processing identical changes
 * v1.6.3.5-v5 - FIX Issue #7: Event-driven transaction cleanup
 *
 * @param {string} transactionId - Transaction ID from the change
 * @returns {boolean} True if change should be processed
 */
export function shouldProcessStorageChange(transactionId) {
  // Check if this is our own write
  if (transactionId && IN_PROGRESS_TRANSACTIONS.has(transactionId)) {
    console.log('[StorageUtils] Ignoring self-write:', transactionId);

    // v1.6.3.5-v5 - FIX Issue #7: Event-driven cleanup - now that we've seen the event,
    // we can clean up the transaction immediately instead of waiting for timeout
    cleanupTransactionId(transactionId);

    return false;
  }

  // Check cooldown period
  const now = Date.now();
  if (now - lastStorageChangeTime < STORAGE_CHANGE_COOLDOWN_MS) {
    console.log('[StorageUtils] Change within cooldown period, may skip');
  }
  lastStorageChangeTime = now;

  return true;
}

/**
 * Clean up a transaction ID after it has been confirmed processed
 * v1.6.3.5-v5 - FIX Issue #7: Event-driven cleanup for transaction IDs
 * v1.6.3.6-v3 - FIX Issue #3: Also clean up escalation warning timeout
 * @param {string} transactionId - Transaction ID to clean up
 */
export function cleanupTransactionId(transactionId) {
  if (!transactionId) return;

  // Remove from in-progress set
  const wasPresent = IN_PROGRESS_TRANSACTIONS.delete(transactionId);

  // Clear any pending fallback timeout (only if present)
  if (TRANSACTION_CLEANUP_TIMEOUTS.has(transactionId)) {
    clearTimeout(TRANSACTION_CLEANUP_TIMEOUTS.get(transactionId));
    TRANSACTION_CLEANUP_TIMEOUTS.delete(transactionId);
  }

  // v1.6.3.6-v3 - FIX Issue #3: Clear any pending escalation warning timeout
  if (TRANSACTION_WARNING_TIMEOUTS.has(transactionId)) {
    clearTimeout(TRANSACTION_WARNING_TIMEOUTS.get(transactionId));
    TRANSACTION_WARNING_TIMEOUTS.delete(transactionId);
  }

  if (wasPresent) {
    console.log('[StorageUtils] Transaction cleanup (event-driven):', transactionId);
  }
}

/**
 * Clear existing timeout if present
 * v1.6.4.8 - FIX CodeScene: Extract from scheduleFallbackCleanup
 * @private
 * @param {Map} timeoutMap - Map containing timeouts
 * @param {string} transactionId - Transaction ID to clear
 */
function _clearExistingTimeout(timeoutMap, transactionId) {
  const existingTimeout = timeoutMap.get(transactionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }
}

/**
 * Handle escalation warning for stale transaction
 * v1.6.4.8 - FIX CodeScene: Extract from scheduleFallbackCleanup
 * @private
 * @param {string} transactionId - Transaction ID
 * @param {number} scheduleTime - When cleanup was scheduled
 */
function _handleEscalationWarning(transactionId, scheduleTime) {
  if (!IN_PROGRESS_TRANSACTIONS.has(transactionId)) return;

  const elapsedMs = Date.now() - scheduleTime;
  console.warn('[StorageUtils] ⚠️ TRANSACTION STALE WARNING:', {
    transactionId,
    elapsedMs,
    warning: `storage.onChanged has not fired in ${ESCALATION_WARNING_MS}ms`,
    suggestion: 'Transaction may be stuck - monitoring for timeout'
  });
}

/**
 * Handle transaction timeout - cleanup and log error
 * v1.6.3.7 - FIX Issue #6: Enhanced diagnostic logging with recent storage events
 * v1.6.4.8 - FIX CodeScene: Extract from scheduleFallbackCleanup
 * @private
 * @param {string} transactionId - Transaction ID
 * @param {number} scheduleTime - When cleanup was scheduled
 */
function _handleTransactionTimeout(transactionId, scheduleTime) {
  // Clear the warning timeout if it hasn't been cleaned up yet
  if (TRANSACTION_WARNING_TIMEOUTS.has(transactionId)) {
    clearTimeout(TRANSACTION_WARNING_TIMEOUTS.get(transactionId));
    TRANSACTION_WARNING_TIMEOUTS.delete(transactionId);
  }

  if (IN_PROGRESS_TRANSACTIONS.has(transactionId)) {
    const elapsedMs = Date.now() - scheduleTime;

    // v1.6.3.7 - FIX Issue #6: Enhanced diagnostic logging
    console.error('[StorageUtils] ⚠️ TRANSACTION TIMEOUT - possible infinite loop:', {
      transactionId,
      expectedEvent: 'storage.onChanged never fired',
      elapsedMs,
      triggerModule: 'storage-utils (fallback timer)',
      pendingTransactions: IN_PROGRESS_TRANSACTIONS.size,
      pendingTransactionIds: [...IN_PROGRESS_TRANSACTIONS],
      pendingWriteCount,
      lastCompletedTransactionId,
      recentWriteCount: saveIdWriteTracker.size,
      // v1.6.3.7 - FIX Issue #6: List recent storage events for diagnosis
      diagnosticHint: 'Check browser devtools Network tab for storage.local operations',
      suggestion:
        'If this repeats, self-write detection may be broken. Check isSelfWrite() function.'
    });

    // v1.6.3.7 - FIX Issue #6: Log whether transaction should have matched
    console.warn('[StorageUtils] TRANSACTION_TIMEOUT diagnostic:', {
      transactionId,
      timeoutThresholdMs: TRANSACTION_FALLBACK_CLEANUP_MS,
      actualDelayMs: elapsedMs,
      expectedBehavior: 'storage.onChanged should fire within 100-200ms of write',
      possibleCauses: [
        'Firefox extension storage delay (normal: 50-100ms)',
        'Self-write detection failed in storage.onChanged handler',
        'Storage write never completed',
        'storage.onChanged listener not registered'
      ]
    });

    IN_PROGRESS_TRANSACTIONS.delete(transactionId);
  }
  TRANSACTION_CLEANUP_TIMEOUTS.delete(transactionId);
}

/**
 * Schedule fallback cleanup for a transaction ID
 * v1.6.3.5-v5 - FIX Issue #7: Fallback if storage.onChanged never fires
 * v1.6.3.6-v3 - FIX Issue #3: Add intermediate escalation warning at 250ms
 * v1.6.4.8 - FIX CodeScene: Reduce complexity by extracting handlers
 * @param {string} transactionId - Transaction ID to schedule cleanup for
 */
function scheduleFallbackCleanup(transactionId) {
  if (!transactionId) return;

  // Clear any existing timeouts for this transaction
  _clearExistingTimeout(TRANSACTION_CLEANUP_TIMEOUTS, transactionId);
  _clearExistingTimeout(TRANSACTION_WARNING_TIMEOUTS, transactionId);

  const scheduleTime = Date.now();

  // Schedule intermediate warning at 250ms
  const warningTimeoutId = setTimeout(() => {
    try {
      _handleEscalationWarning(transactionId, scheduleTime);
    } catch (err) {
      console.warn('[StorageUtils] Error in escalation warning:', err.message);
    }
  }, ESCALATION_WARNING_MS);

  TRANSACTION_WARNING_TIMEOUTS.set(transactionId, warningTimeoutId);

  // Schedule fallback cleanup at 500ms
  const timeoutId = setTimeout(() => {
    try {
      _handleTransactionTimeout(transactionId, scheduleTime);
    } catch (err) {
      console.error(
        '[StorageUtils] Error in transaction fallback cleanup:',
        transactionId,
        err.message
      );
    }
  }, TRANSACTION_FALLBACK_CLEANUP_MS);

  TRANSACTION_CLEANUP_TIMEOUTS.set(transactionId, timeoutId);
}

/**
 * Serialize a single tab to hash-friendly format
 * v1.6.4.8 - FIX CodeScene: Extract from computeStateHash
 * @private
 * @param {Object} tab - Tab to serialize
 * @returns {Object} Serialized tab data for hashing
 */
function _serializeTabForHash(tab) {
  return {
    id: tab.id,
    url: tab.url,
    left: tab.left ?? tab.position?.left,
    top: tab.top ?? tab.position?.top,
    width: tab.width ?? tab.size?.width,
    height: tab.height ?? tab.size?.height,
    minimized: tab.minimized ?? tab.visibility?.minimized,
    zIndex: tab.zIndex
  };
}

/**
 * Compute 32-bit hash from string using djb2 algorithm
 * v1.6.4.8 - FIX CodeScene: Extract from computeStateHash
 * @private
 * @param {string} str - String to hash
 * @returns {number} 32-bit hash
 */
function _computeStringHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Compute hash of state for deduplication
 * v1.6.3.4-v6 - FIX Issue #5: Prevent duplicate writes
 * v1.6.4.8 - FIX CodeScene: Reduce complexity by extracting helpers
 *
 * @param {Object} state - State object to hash
 * @returns {number} 32-bit hash
 */
export function computeStateHash(state) {
  if (!state) return 0;

  const tabs = state.tabs || [];
  const tabData = tabs.map(_serializeTabForHash);
  const stateStr = JSON.stringify({ saveId: state.saveId, tabData });

  return _computeStringHash(stateStr);
}

/**
 * Check if state has changed compared to last persist
 * v1.6.3.4-v6 - FIX Issue #5: Prevent duplicate writes
 *
 * @param {Object} state - State to check
 * @returns {boolean} True if state has changed
 */
export function hasStateChanged(state) {
  const newHash = computeStateHash(state);
  if (newHash === lastPersistedStateHash) {
    console.log('[StorageUtils] State unchanged (same hash), skipping persist');
    return false;
  }
  lastPersistedStateHash = newHash;
  return true;
}

/**
 * Check if Firefox browser API is available
 * v1.6.4.8 - FIX CodeScene: Extract from getBrowserStorageAPI
 * @private
 * @returns {boolean} True if Firefox browser API is available
 */
function _hasFirefoxBrowserAPI() {
  return typeof browser !== 'undefined' && browser?.storage?.local?.set;
}

/**
 * Check if Chrome browser API is available
 * v1.6.4.8 - FIX CodeScene: Extract from getBrowserStorageAPI
 * @private
 * @returns {boolean} True if Chrome browser API is available
 */
function _hasChromeBrowserAPI() {
  return typeof chrome !== 'undefined' && chrome?.storage?.local?.set;
}

/**
 * Get browser storage API (browser or chrome)
 * Returns null if not available (e.g., in unit tests)
 * v1.6.4.8 - FIX CodeScene: Reduce complexity by extracting environment checks
 *
 * @returns {Object|null} Browser storage API or null
 */
export function getBrowserStorageAPI() {
  try {
    if (_hasFirefoxBrowserAPI()) return browser;
    if (_hasChromeBrowserAPI()) return chrome;
  } catch (_err) {
    // Ignore errors accessing browser/chrome globals
  }
  return null;
}

/**
 * Options for _getNumericValue
 * @typedef {Object} NumericValueOptions
 * @property {string} flatKey - Key for flat format (e.g., 'left')
 * @property {string} [nestedObj] - Nested object name (e.g., 'position')
 * @property {string} [nestedKey] - Nested property name (e.g., 'left')
 * @property {number} defaultVal - Default value if not found
 */

/**
 * Get numeric value from flat or nested tab property
 * v1.6.3.4-v3 - Helper to reduce complexity
 * v1.6.4.8 - FIX CodeScene: Reduce arguments from 5 to 2 using options object
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {NumericValueOptions} options - Options for value resolution
 * @returns {number} Resolved value
 */
function _getNumericValue(tab, options) {
  const { flatKey, nestedObj, nestedKey, defaultVal } = options;
  // v1.6.3.4-v3 - Use nullish coalescing to properly handle 0 values
  const flatVal = tab[flatKey];
  const nestedVal = nestedObj ? tab[nestedObj]?.[nestedKey] : undefined;
  const rawVal = flatVal ?? nestedVal ?? defaultVal;
  // v1.6.3.4-v4 - FIX: Validate that Number() produces a valid number (not NaN)
  const numVal = Number(rawVal);
  return isNaN(numVal) ? defaultVal : numVal;
}

/**
 * Get array value from flat or nested tab property
 * v1.6.3.4-v3 - Helper to reduce complexity
 * v1.6.3.4-v4 - Note: Unlike _getNumericValue, this function doesn't have a defaultVal
 *            parameter because arrays always default to empty []. The nestedKey
 *            parameter accesses tab.visibility[nestedKey] specifically.
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {string} flatKey - Key for flat format (e.g., 'soloedOnTabs')
 * @param {string} nestedKey - Nested key in visibility object (e.g., 'soloedOnTabs')
 * @returns {Array} Resolved array (copied), defaults to empty array
 */
function _getArrayValue(tab, flatKey, nestedKey) {
  const flatVal = tab[flatKey];
  const nestedVal = tab.visibility?.[nestedKey];
  const arr = Array.isArray(flatVal) ? flatVal : Array.isArray(nestedVal) ? nestedVal : [];
  return [...arr];
}

/**
 * Log when originTabId is undefined on instance (will become null)
 * v1.6.3.7-v3 - FIX Issue #4: Helper for adoption flow diagnostic logging
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {*} rawOriginTabId - Raw value from instance
 * @param {*} rawActiveTabId - Fallback value from instance
 */
function _logOriginTabIdUndefined(tab, rawOriginTabId, rawActiveTabId) {
  if (rawOriginTabId !== undefined) return;
  console.log(
    '[StorageUtils] ADOPTION_FLOW: serializeTabForStorage - originTabId read from instance:',
    {
      quickTabId: tab.id,
      rawOriginTabId: 'undefined',
      rawActiveTabId: rawActiveTabId !== undefined ? rawActiveTabId : 'undefined',
      willFallbackTo: rawActiveTabId ?? 'null'
    }
  );
}

/**
 * Log when final extracted originTabId is null
 * v1.6.3.7-v3 - FIX Issue #4: Helper for adoption flow diagnostic logging
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {*} extractedOriginTabId - Final extracted value
 * @param {*} rawOriginTabId - Raw value from instance
 * @param {*} rawActiveTabId - Fallback value from instance
 */
function _logOriginTabIdNull(tab, extractedOriginTabId, rawOriginTabId, rawActiveTabId) {
  if (extractedOriginTabId !== null) return;
  console.warn('[StorageUtils] ADOPTION_FLOW: serializeTabForStorage - originTabId is NULL', {
    quickTabId: tab.id,
    originTabId: extractedOriginTabId,
    hasOriginTabId: rawOriginTabId !== undefined && rawOriginTabId !== null,
    hasActiveTabId: rawActiveTabId !== undefined && rawActiveTabId !== null,
    action: 'serialize',
    result: 'null'
  });
}

/**
 * Serialize a single Quick Tab to storage format
 * v1.6.3.4-v2 - FIX Bug #1: Extracted to reduce complexity
 * v1.6.3.4-v3 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
 * v1.6.3.4 - FIX Issue #3: Include zIndex in serialized data for persistence
 * v1.6.3.5-v2 - FIX Report 1 Issue #2: Include originTabId for cross-tab filtering
 * v1.6.3.7 - FIX Issue #2, #7: Enhanced originTabId preservation with logging
 *   - Issue #2: Preserve originTabId during ALL state changes (minimize, resize, move)
 *   - Issue #7: Log originTabId extraction for debugging adoption data flow
 * v1.6.3.7-v3 - FIX Issue #4: Enhanced diagnostic logging for originTabId adoption flow
 *   - Log raw instance value BEFORE fallback chain to detect undefined → null conversion
 *   - Extracted logging helpers to reduce function complexity
 * v1.6.4.8 - FIX CodeScene: Updated to use options object for _getNumericValue
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {Object} Serialized tab data for storage
 */
function serializeTabForStorage(tab, isMinimized) {
  // v1.6.3.7-v3 - FIX Issue #4: Enhanced logging to trace originTabId extraction
  // Log the raw instance value BEFORE the fallback chain to detect undefined → null conversion
  const rawOriginTabId = tab.originTabId;
  const rawActiveTabId = tab.activeTabId;

  // v1.6.3.7-v3 - FIX Issue #4: Log when undefined is being converted to null
  _logOriginTabIdUndefined(tab, rawOriginTabId, rawActiveTabId);

  // v1.6.3.7 - FIX Issue #7: Extract originTabId with fallback chain
  const extractedOriginTabId = rawOriginTabId ?? rawActiveTabId ?? null;

  // v1.6.3.7 - FIX Issue #7: Adoption flow logging - only log when originTabId is problematic (null)
  _logOriginTabIdNull(tab, extractedOriginTabId, rawOriginTabId, rawActiveTabId);

  return {
    id: String(tab.id),
    url: String(tab.url || ''),
    title: String(tab.title || ''),
    left: _getNumericValue(tab, {
      flatKey: 'left',
      nestedObj: 'position',
      nestedKey: 'left',
      defaultVal: 0
    }),
    top: _getNumericValue(tab, {
      flatKey: 'top',
      nestedObj: 'position',
      nestedKey: 'top',
      defaultVal: 0
    }),
    width: _getNumericValue(tab, {
      flatKey: 'width',
      nestedObj: 'size',
      nestedKey: 'width',
      defaultVal: 400
    }),
    height: _getNumericValue(tab, {
      flatKey: 'height',
      nestedObj: 'size',
      nestedKey: 'height',
      defaultVal: 300
    }),
    zIndex: _getNumericValue(tab, { flatKey: 'zIndex', defaultVal: DEFAULT_ZINDEX }),
    minimized: Boolean(isMinimized),
    soloedOnTabs: _getArrayValue(tab, 'soloedOnTabs', 'soloedOnTabs'),
    mutedOnTabs: _getArrayValue(tab, 'mutedOnTabs', 'mutedOnTabs'),
    // v1.6.3.5-v2 - FIX Report 1 Issue #2: Track originating tab ID for cross-tab filtering
    // v1.6.3.7 - FIX Issue #2: This value MUST be preserved across all operations
    originTabId: extractedOriginTabId
  };
}

/**
 * Validate that a state object can be serialized to JSON
 * v1.6.3.4-v2 - FIX Bug #1: Extracted to reduce complexity
 * @private
 * @param {Object} state - State object to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateStateSerializable(state) {
  try {
    JSON.stringify(state);
    return true;
  } catch (jsonErr) {
    console.error('[StorageUtils] State is not JSON-serializable:', jsonErr);
    return false;
  }
}

/**
 * Check if tab has valid ID
 * v1.6.3.4-v6 - Extracted to reduce validateTab complexity
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {boolean} True if ID is valid
 */
function _hasValidId(tab) {
  if (!tab.id) {
    console.error('[StorageUtils] Tab missing id');
    return false;
  }
  return true;
}

/**
 * Check if tab has valid URL
 * v1.6.3.4-v6 - Extracted to reduce validateTab complexity
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {boolean} True if URL is valid
 */
function _hasValidUrl(tab) {
  if (!isValidQuickTabUrl(tab.url)) {
    console.error('[StorageUtils] Tab has invalid URL:', { id: tab.id, url: tab.url });
    return false;
  }
  return true;
}

/**
 * Check if tab has valid position
 * v1.6.3.4-v6 - Extracted to reduce validateTab complexity
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {boolean} True if position is valid
 */
function _hasValidPosition(tab) {
  const left = tab.left ?? tab.position?.left;
  const top = tab.top ?? tab.position?.top;

  if (typeof left !== 'number' || typeof top !== 'number') {
    console.error('[StorageUtils] Tab has invalid position:', { id: tab.id, left, top });
    return false;
  }
  return true;
}

/**
 * Check if a dimension value is valid (positive number)
 * v1.6.4.8 - FIX CodeScene: Extract from _hasValidSize to reduce complex conditionals
 * @private
 * @param {*} value - Dimension value to check
 * @returns {boolean} True if valid positive number
 */
function _isValidDimension(value) {
  return typeof value === 'number' && value > 0;
}

/**
 * Check if tab has valid size
 * v1.6.3.4-v6 - Extracted to reduce validateTab complexity
 * v1.6.4.8 - FIX CodeScene: Extract dimension validation to reduce complex conditionals
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {boolean} True if size is valid
 */
function _hasValidSize(tab) {
  const width = tab.width ?? tab.size?.width;
  const height = tab.height ?? tab.size?.height;

  const isValid = _isValidDimension(width) && _isValidDimension(height);
  if (!isValid) {
    console.error('[StorageUtils] Tab has invalid size:', { id: tab.id, width, height });
  }
  return isValid;
}

/**
 * Validate a single tab has all required properties
 * v1.6.3.4-v6 - FIX Issue #6: State validation before persist
 * Refactored: Extracted helpers to reduce complexity
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {boolean} True if tab is valid
 */
function validateTab(tab) {
  return _hasValidId(tab) && _hasValidUrl(tab) && _hasValidPosition(tab) && _hasValidSize(tab);
}

/**
 * Validate state object before persisting
 * v1.6.3.4-v6 - FIX Issue #6: Comprehensive state validation
 * @param {Object} state - State to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateStateForPersist(state) {
  const errors = [];

  if (!state) {
    errors.push('State is null/undefined');
    return { valid: false, errors };
  }

  if (!state.tabs || !Array.isArray(state.tabs)) {
    errors.push('State.tabs is not an array');
    return { valid: false, errors };
  }

  // Check for duplicate IDs
  const ids = new Set();
  for (const tab of state.tabs) {
    if (ids.has(tab.id)) {
      errors.push(`Duplicate tab ID: ${tab.id}`);
    }
    ids.add(tab.id);
  }

  // Validate each tab
  const invalidTabs = state.tabs.filter(tab => !validateTab(tab));
  if (invalidTabs.length > 0) {
    errors.push(`${invalidTabs.length} tabs failed validation`);
  }

  // Validate minimized count matches actual count
  const minimizedCount = state.tabs.filter(t => t.minimized === true).length;
  const nonMinimizedCount = state.tabs.filter(t => t.minimized !== true).length;
  console.log('[StorageUtils] State validation:', {
    totalTabs: state.tabs.length,
    minimizedCount,
    nonMinimizedCount
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Process a single tab for serialization
 * v1.6.3.4-v6 - Extracted to reduce buildStateForStorage complexity
 * @private
 * @param {Object} tab - Tab to process
 * @param {Object} minimizedManager - Minimized manager
 * @returns {{tabData: Object|null, skipped: boolean}} Result
 */
function _processTabForStorage(tab, minimizedManager) {
  if (!tab?.id) {
    console.warn('[StorageUtils] buildStateForStorage: Skipping invalid tab (no id)');
    return { tabData: null, skipped: true };
  }

  if (!isValidQuickTabUrl(tab.url)) {
    console.warn('[StorageUtils] buildStateForStorage: Skipping tab with invalid URL:', {
      id: tab.id,
      url: tab.url
    });
    return { tabData: null, skipped: true };
  }

  const isMinimized = minimizedManager?.isMinimized?.(tab.id) || tab.minimized || false;
  const tabData = serializeTabForStorage(tab, isMinimized);
  return { tabData, skipped: false };
}

/**
 * Build current state from quickTabsMap for storage
 * v1.6.3.4 - Extracted from handlers to reduce duplication
 * v1.6.3.4-v2 - FIX Bug #1: Add validation and error handling
 * v1.6.3.4-v6 - FIX Issue #2, #6: Filter invalid URLs, validate before return
 * Refactored: Extracted _processTabForStorage to reduce complexity
 * Uses minimizedManager.isMinimized() for consistent minimized state
 *
 * @param {Map} quickTabsMap - Map of Quick Tab instances
 * @param {Object} minimizedManager - Manager for minimized Quick Tabs
 * @returns {Object|null} - State object in unified format, or null if error
 */
export function buildStateForStorage(quickTabsMap, minimizedManager) {
  if (!quickTabsMap) {
    console.warn('[StorageUtils] buildStateForStorage: quickTabsMap is null/undefined');
    return null;
  }

  const tabs = [];
  let skippedCount = 0;

  for (const tab of quickTabsMap.values()) {
    const { tabData, skipped } = _processTabForStorage(tab, minimizedManager);
    if (skipped) {
      skippedCount++;
    } else if (tabData) {
      tabs.push(tabData);
    }
  }

  if (skippedCount > 0) {
    console.log('[StorageUtils] buildStateForStorage: Skipped', skippedCount, 'invalid tabs');
  }

  const state = { tabs, timestamp: Date.now(), saveId: generateSaveId() };

  if (!validateStateSerializable(state)) {
    return null;
  }

  const validation = validateStateForPersist(state);
  if (!validation.valid) {
    console.error('[StorageUtils] State validation failed:', validation.errors);
  }

  return state;
}

/**
 * Create a Promise that rejects after a timeout
 * v1.6.3.4-v2 - FIX Bug #1: Helper for Promise timeout wrapper
 * @private
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Description of the operation for error message
 * @returns {{promise: Promise, clear: Function}} Object with timeout promise and cleanup function
 */
function createTimeoutPromise(ms, operation) {
  // v1.6.3.4-v4 - FIX: Initialize timeoutId to null for safer cleanup
  let timeoutId = null;
  const promise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);
  });
  // v1.6.3.4-v4 - FIX: Only clear if timeoutId was set (safety check)
  const clear = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
  return { promise, clear };
}

/**
 * Check if empty write should be rejected (cooldown protection)
 * v1.6.3.4-v8 - FIX Issue #1: Prevent empty write cascades
 * v1.6.3.4-v11 - FIX Issue #8: Add explicit warning when forceEmpty is required
 * v1.6.3.5-v10 - FIX Issue #4: Stricter empty write protection
 *   - Tabs with 0 Quick Tabs should NEVER write unless forceEmpty=true
 *   - This prevents non-owner tabs from overwriting valid state
 * @private
 * @param {number} tabCount - Number of tabs in state
 * @param {boolean} forceEmpty - Whether to force the empty write
 * @param {string} logPrefix - Log prefix for messages
 * @param {string} transactionId - Transaction ID for logging
 * @returns {boolean} True if write should be rejected
 */
function _shouldRejectEmptyWrite(tabCount, forceEmpty, logPrefix, transactionId) {
  if (tabCount > 0) {
    return false; // Not an empty write
  }

  // v1.6.3.5-v10 - FIX Issue #4: Stricter empty write protection
  // Tabs with 0 Quick Tabs should NEVER write unless forceEmpty=true (e.g., Close All action)
  // This prevents storage corruption where non-owner tabs overwrite valid state
  if (!forceEmpty) {
    console.warn(
      `${logPrefix} BLOCKED: Empty write rejected (forceEmpty required) [${transactionId}]`
    );
    console.warn(`${logPrefix} │ This prevents non-owner tabs from corrupting storage`);
    console.warn(`${logPrefix} │ Use forceEmpty=true for intentional "Close All" operations`);
    return true;
  }

  // v1.6.3.4-v8 - FIX Issue #1: Log WARNING when going from N tabs to 0
  if (previousTabCount > 0) {
    console.warn(
      `${logPrefix} ⚠️ WARNING: State going from ${previousTabCount} tabs → 0 tabs [${transactionId}]`
    );
    console.warn(`${logPrefix} Stack trace:`, new Error().stack);
  }

  console.log(`${logPrefix} Empty write allowed (forceEmpty=true) [${transactionId}]`);

  const now = Date.now();
  if (now - lastEmptyWriteTime < EMPTY_WRITE_COOLDOWN_MS) {
    console.warn(
      `${logPrefix} REJECTED: Empty write within cooldown (${now - lastEmptyWriteTime}ms < ${EMPTY_WRITE_COOLDOWN_MS}ms) [${transactionId}]`
    );
    return true;
  }

  lastEmptyWriteTime = now;
  return false;
}

/**
 * Clean up expired entries from saveId tracker
 * v1.6.4.8 - FIX CodeScene: Extract from _trackDuplicateSaveIdWrite to flatten bumpy road
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupExpiredSaveIdEntries(now) {
  for (const [id, data] of saveIdWriteTracker.entries()) {
    if (now - data.firstTimestamp > DUPLICATE_SAVEID_WINDOW_MS) {
      saveIdWriteTracker.delete(id);
    }
  }
}

/**
 * Log duplicate write warning
 * v1.6.4.8 - FIX CodeScene: Extract from _trackDuplicateSaveIdWrite to flatten bumpy road
 * @private
 * @param {string} saveId - Save ID
 * @param {Object} existing - Existing tracker entry
 * @param {string} transactionId - Current transaction ID
 * @param {number} now - Current timestamp
 */
function _logDuplicateWriteWarning(saveId, existing, transactionId, now) {
  const elapsedMs = now - existing.firstTimestamp;
  console.error(
    `[StorageUtils] ⚠️ DUPLICATE WRITE DETECTED: saveId "${saveId}" written ${existing.count} times in ${elapsedMs}ms`
  );
  console.error(
    '[StorageUtils] This indicates a storage write loop - same saveId should not be written multiple times.'
  );
  console.error(
    `[StorageUtils] Transaction: ${transactionId}, First transaction: ${existing.firstTransaction}`
  );
}

/**
 * Track duplicate saveId writes to detect storage write loops
 * v1.6.3.6-v2 - FIX Issue #2: Log warning when same saveId is written multiple times
 * v1.6.4.8 - FIX CodeScene: Flatten bumpy road by extracting nested conditions
 * @private
 * @param {string} saveId - Save ID being written
 * @param {string} transactionId - Transaction ID for logging
 * @param {string} _logPrefix - Log prefix for messages (unused, kept for consistency)
 */
function _trackDuplicateSaveIdWrite(saveId, transactionId, _logPrefix) {
  const now = Date.now();

  // Clean up old entries outside the tracking window
  _cleanupExpiredSaveIdEntries(now);

  // Track this write
  const existing = saveIdWriteTracker.get(saveId);
  if (!existing) {
    saveIdWriteTracker.set(saveId, {
      count: 1,
      firstTimestamp: now,
      firstTransaction: transactionId
    });
    return;
  }

  existing.count++;

  // Log warning if threshold exceeded
  if (existing.count > DUPLICATE_SAVEID_THRESHOLD) {
    _logDuplicateWriteWarning(saveId, existing, transactionId, now);
  }
}

/**
 * Perform the actual storage write operation
 * v1.6.3.4-v8 - FIX Issue #7: Extracted for queue implementation
 * v1.6.3.4-v12 - FIX Issue #1, #6: Enhanced logging with transaction sequencing
 * v1.6.3.6-v2 - FIX Issue #1, #2: Update lastWrittenTransactionId, add duplicate saveId tracking
 * v1.6.3.6-v5 - FIX Issue #4b: Added storage write operation logging
 * @private
 */
async function _executeStorageWrite(stateWithTxn, tabCount, logPrefix, transactionId) {
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.warn(`${logPrefix} Storage API not available, cannot persist`);
    pendingWriteCount = Math.max(0, pendingWriteCount - 1);
    return false;
  }

  // v1.6.3.6-v2 - FIX Issue #2: Track duplicate saveId writes to detect loops
  const saveId = stateWithTxn.saveId;
  if (saveId) {
    _trackDuplicateSaveIdWrite(saveId, transactionId, logPrefix);
  }

  // v1.6.3.4-v6 - FIX Issue #1: Track in-progress transaction
  IN_PROGRESS_TRANSACTIONS.add(transactionId);

  // v1.6.3.5-v5 - FIX Issue #7: Schedule fallback cleanup (in case storage.onChanged doesn't fire)
  scheduleFallbackCleanup(transactionId);

  // v1.6.3.6-v5 - FIX Issue #4b: Generate operation ID for storage write logging
  const operationId = generateStorageOperationId();
  const startTime = Date.now();

  // v1.6.3.6-v5 - Log storage write start
  logStorageWrite(operationId, STATE_KEY, 'start', {
    tabCount,
    transactionId
  });

  // v1.6.3.4-v12 - FIX Issue #6: Log transaction sequencing
  console.log(`${logPrefix} Storage write executing:`, {
    transaction: transactionId,
    prevTransaction: lastCompletedTransactionId,
    pendingCount: pendingWriteCount,
    tabCount
  });

  // v1.6.3.4-v2 - FIX Bug #1: Create timeout with cleanup to prevent race condition
  const timeout = createTimeoutPromise(STORAGE_TIMEOUT_MS, 'storage.local.set');

  try {
    // v1.6.3.4-v2 - FIX Bug #1: Wrap storage.local.set with timeout
    const storagePromise = browserAPI.storage.local.set({ [STATE_KEY]: stateWithTxn });

    await Promise.race([storagePromise, timeout.promise]);

    const durationMs = Date.now() - startTime;

    // v1.6.3.4-v8 - Update previous tab count after successful write
    previousTabCount = tabCount;

    // v1.6.3.4-v12 - FIX Issue #6: Update last completed transaction
    lastCompletedTransactionId = transactionId;

    // v1.6.3.6-v2 - FIX Issue #1: Update lastWrittenTransactionId for self-write detection
    lastWrittenTransactionId = transactionId;

    pendingWriteCount = Math.max(0, pendingWriteCount - 1);

    // v1.6.3.6-v3 - FIX Issue #2: Reset circuit breaker if queue has drained below threshold
    if (circuitBreakerTripped && pendingWriteCount < CIRCUIT_BREAKER_RESET_THRESHOLD) {
      const tripDuration = Date.now() - circuitBreakerTripTime;
      circuitBreakerTripped = false;
      circuitBreakerTripTime = null;
      console.log(
        `[StorageUtils] Circuit breaker RESET - queue drained (was tripped for ${tripDuration}ms)`
      );
    }

    // v1.6.3.6-v5 - Log storage write complete (success)
    logStorageWrite(operationId, STATE_KEY, 'complete', {
      success: true,
      tabCount,
      durationMs,
      transactionId
    });

    console.log(`${logPrefix} Storage write COMPLETED [${transactionId}] (${tabCount} tabs)`);
    return true;
  } catch (err) {
    const durationMs = Date.now() - startTime;

    pendingWriteCount = Math.max(0, pendingWriteCount - 1);

    // v1.6.3.6-v5 - Log storage write complete (failure)
    logStorageWrite(operationId, STATE_KEY, 'complete', {
      success: false,
      tabCount,
      durationMs,
      transactionId
    });

    console.error(`${logPrefix} Storage write FAILED [${transactionId}]:`, err.message || err);
    return false;
  } finally {
    // v1.6.3.4-v3 - FIX: Always clear timeout to prevent memory leak
    timeout.clear();

    // v1.6.3.5-v5 - FIX Issue #7: Transaction cleanup is now event-driven
    // The fallback cleanup scheduled above will handle cases where storage.onChanged doesn't fire
    // The cleanupTransactionId() function is called from shouldProcessStorageChange() when
    // storage.onChanged is received, providing immediate cleanup in the normal case
  }
}

/**
 * Queue a storage write operation (FIFO ordering)
 * v1.6.3.4-v8 - FIX Issue #7: Ensures writes are serialized
 * v1.6.3.4-v10 - FIX Issue #7: Reset queue on failure to break error propagation
 *   The problem was that when writeOperation fails, .catch() returned `false`,
 *   which contaminated the Promise chain for subsequent writes.
 *   Now we reset the queue on failure so each write is independent.
 * v1.6.3.4-v12 - FIX Issue #6: Log queue state for debugging
 *   Note: New parameters are optional with defaults for backward compatibility
 * v1.6.3.5 - FIX Issue #5: Enhanced queue reset logging with dropped writes count
 * v1.6.3.6-v2 - FIX Issue #2: Add backlog warnings when pendingWriteCount > 5 or >10
 * v1.6.3.6-v3 - FIX Issue #2: Circuit breaker blocks ALL writes when queue exceeds threshold
 * @param {Function} writeOperation - Async function to execute
 * @param {string} [logPrefix='[StorageUtils]'] - Prefix for logging (optional)
 * @param {string} [transactionId=''] - Transaction ID for logging (optional)
 * @returns {Promise<boolean>} Result of the write operation
 */
export function queueStorageWrite(
  writeOperation,
  logPrefix = '[StorageUtils]',
  transactionId = ''
) {
  // v1.6.3.6-v3 - FIX Issue #2: Circuit breaker check BEFORE incrementing pendingWriteCount
  // This prevents infinite storage write loops from overwhelming the system
  if (pendingWriteCount >= CIRCUIT_BREAKER_THRESHOLD) {
    if (!circuitBreakerTripped) {
      circuitBreakerTripped = true;
      circuitBreakerTripTime = Date.now();
      console.error('[StorageUtils] ⚠️⚠️⚠️ CIRCUIT BREAKER TRIPPED - INFINITE LOOP DETECTED');
      console.error(
        `[StorageUtils] Blocking ALL new storage writes (threshold: ${CIRCUIT_BREAKER_THRESHOLD})`
      );
      console.error('[StorageUtils] Current queue depth:', pendingWriteCount);
      console.error(`[StorageUtils] Last completed: ${lastCompletedTransactionId || 'none'}`);
      console.error(
        '[StorageUtils] To recover: Close tabs using this extension, then go to about:addons, disable and re-enable the extension'
      );
    }
    console.error(`[StorageUtils] Write BLOCKED by circuit breaker [${transactionId}]`);
    return Promise.resolve(false);
  }

  // v1.6.3.4-v12 - FIX Issue #6: Log queue state with previous transaction
  pendingWriteCount++;
  console.log(`${logPrefix} Storage write queued:`, {
    pending: pendingWriteCount,
    transaction: transactionId,
    prevTransaction: lastCompletedTransactionId,
    queueDepth: pendingWriteCount
  });

  // v1.6.3.6-v2 - FIX Issue #2: Backlog detection warnings
  if (pendingWriteCount > 10) {
    console.error(
      `[StorageUtils] ⚠️⚠️⚠️ CRITICAL STORAGE WRITE BACKLOG: ${pendingWriteCount} pending transactions!`
    );
    console.error('[StorageUtils] This strongly indicates an infinite storage write loop.');
    console.error(
      '[StorageUtils] Check for self-write detection failure in storage.onChanged listener.'
    );
    console.error(`[StorageUtils] Last completed: ${lastCompletedTransactionId || 'none'}`);
    console.error(`[StorageUtils] Current transaction: ${transactionId}`);
  } else if (pendingWriteCount > 5) {
    console.warn(
      `[StorageUtils] ⚠️ STORAGE WRITE BACKLOG DETECTED: ${pendingWriteCount} pending transactions`
    );
    console.warn(
      '[StorageUtils] Possible infinite loop - check storage.onChanged listener for self-write.'
    );
    console.warn(
      `[StorageUtils] Last completed: ${lastCompletedTransactionId || 'none'}, Current: ${transactionId}`
    );
  }

  // Chain this operation to the previous one
  storageWriteQueuePromise = storageWriteQueuePromise
    .then(() => writeOperation())
    .catch(err => {
      // v1.6.3.5 - FIX Issue #5: Enhanced logging for queue reset
      const droppedWrites = pendingWriteCount - 1; // Current write failed, others are dropped
      console.error(
        `[StorageUtils] Queue RESET after failure [${transactionId}] - ${droppedWrites} pending writes dropped:`,
        err
      );

      pendingWriteCount = Math.max(0, pendingWriteCount - 1);
      // v1.6.3.4-v10 - FIX Issue #7: Reset queue to break error propagation chain
      // Without this reset, the `false` return value contaminates subsequent writes
      // because the Promise chain carries the error state forward.
      // By resetting to a fresh Promise.resolve(), subsequent writes start fresh.
      storageWriteQueuePromise = Promise.resolve();
      return false;
    });

  return storageWriteQueuePromise;
}

/**
 * Validate ownership for persist operation
 * v1.6.3.5-v4 - Extracted to reduce persistStateToStorage complexity
 * v1.6.3.6-v2 - FIX Issue #3: Pass forceEmpty to validateOwnershipForWrite for proper empty write validation
 * @private
 * @param {Object} state - State to validate
 * @param {boolean} forceEmpty - Whether empty writes are forced
 * @param {string} logPrefix - Logging prefix
 * @param {string} transactionId - Transaction ID for logging
 * @returns {{ shouldProceed: boolean }}
 */
function _validatePersistOwnership(state, forceEmpty, logPrefix, transactionId) {
  // v1.6.3.6-v2 - FIX Issue #3: Pass forceEmpty to ownership validation
  // This allows validateOwnershipForWrite to properly handle empty writes
  const ownershipCheck = validateOwnershipForWrite(state.tabs, currentWritingTabId, forceEmpty);
  if (!ownershipCheck.shouldWrite) {
    console.warn(`${logPrefix} Storage write BLOCKED [${transactionId}]:`, {
      reason: ownershipCheck.reason,
      currentTabId: currentWritingTabId,
      tabCount: state.tabs.length,
      forceEmpty
    });
    return { shouldProceed: false };
  }
  return { shouldProceed: true };
}

/**
 * Validate state structure for persistence
 * v1.6.4.8 - FIX CodeScene: Extract from persistStateToStorage to reduce complexity
 * @private
 * @param {Object} state - State to validate
 * @param {string} logPrefix - Log prefix
 * @returns {{valid: boolean}} Validation result
 */
function _validateStateStructure(state, logPrefix) {
  if (!state) {
    console.error(`${logPrefix} Cannot persist: state is null/undefined`);
    return { valid: false };
  }

  if (!state.tabs || !Array.isArray(state.tabs)) {
    console.error(`${logPrefix} Cannot persist: state.tabs is invalid`);
    return { valid: false };
  }

  return { valid: true };
}

/**
 * Prepare state with transaction metadata for persistence
 * v1.6.4.8 - FIX CodeScene: Extract from persistStateToStorage to reduce complexity
 * @private
 * @param {Object} state - State to prepare
 * @param {string} transactionId - Transaction ID
 * @returns {Object} State with transaction metadata
 */
function _prepareStateForWrite(state, transactionId) {
  return {
    ...state,
    transactionId,
    writingInstanceId: WRITING_INSTANCE_ID,
    writingTabId: currentWritingTabId
  };
}

/**
 * Options for _logPersistInitiation
 * @typedef {Object} PersistInitiationOptions
 * @property {string} logPrefix - Log prefix
 * @property {string} transactionId - Transaction ID
 * @property {number} tabCount - Number of tabs
 * @property {number} minimizedCount - Number of minimized tabs
 * @property {boolean} forceEmpty - Force empty flag
 */

/**
 * Log persistence initiation details
 * v1.6.4.8 - FIX CodeScene: Extract from persistStateToStorage to reduce complexity
 * v1.6.4.8 - FIX CodeScene: Reduce arguments using options object
 * @private
 * @param {PersistInitiationOptions} options - Logging options
 */
function _logPersistInitiation(options) {
  const { logPrefix, transactionId, tabCount, minimizedCount, forceEmpty } = options;
  console.log(`${logPrefix} Storage write initiated:`, {
    file: logPrefix.replace(/\[|\]/g, ''),
    operation: forceEmpty ? 'forceEmpty' : 'persist',
    tabCount,
    minimizedCount,
    transaction: transactionId
  });

  console.log(
    `${logPrefix} Persisting ${tabCount} tabs (${minimizedCount} minimized) [${transactionId}]`
  );
}

/**
 * Persist Quick Tab state to storage.local
 * v1.6.3.4 - Extracted from handlers
 * v1.6.3.4-v2 - FIX Bug #1: Add Promise timeout, validation, and detailed logging
 * v1.6.3.4-v3 - FIX: Ensure timeout is always cleared to prevent memory leak
 * v1.6.3.4-v6 - FIX Issue #1, #5: Transaction tracking and deduplication
 * v1.6.3.4-v8 - FIX Issues #1, #7: Empty write protection, storage write queue
 * v1.6.3.5-v4 - FIX Diagnostic Issue #1: Ownership validation extracted
 * v1.6.4.8 - FIX CodeScene: Reduce complexity by extracting phases
 *
 * @param {Object} state - State object to persist
 * @param {string} logPrefix - Prefix for log messages (e.g., '[DestroyHandler]')
 * @param {boolean} forceEmpty - Allow empty (0 tabs) writes (default: false)
 * @returns {Promise<boolean>} - Promise resolving to true on success, false on failure
 */
export function persistStateToStorage(state, logPrefix = '[StorageUtils]', forceEmpty = false) {
  const transactionId = generateTransactionId();
  console.log(`${logPrefix} Storage write STARTED [${transactionId}]`);

  // Phase 1: Validate state structure
  if (!_validateStateStructure(state, logPrefix).valid) {
    return Promise.resolve(false);
  }

  const tabCount = state.tabs.length;
  const minimizedCount = state.tabs.filter(t => t.minimized).length;

  // Phase 2: Check empty write protection
  if (_shouldRejectEmptyWrite(tabCount, forceEmpty, logPrefix, transactionId)) {
    return Promise.resolve(false);
  }

  // Phase 3: Validate ownership
  if (!_validatePersistOwnership(state, forceEmpty, logPrefix, transactionId).shouldProceed) {
    return Promise.resolve(false);
  }

  // Phase 4: Check for state changes
  if (!hasStateChanged(state)) {
    console.log(`${logPrefix} Storage write SKIPPED [${transactionId}] (no changes)`);
    return Promise.resolve(true);
  }

  // Phase 5: Validate state content
  const validation = validateStateForPersist(state);
  if (!validation.valid) {
    console.error(`${logPrefix} State validation failed [${transactionId}]:`, validation.errors);
  }

  // Phase 6: Log and execute write
  _logPersistInitiation({ logPrefix, transactionId, tabCount, minimizedCount, forceEmpty });

  const stateWithTxn = _prepareStateForWrite(state, transactionId);

  return queueStorageWrite(
    () => _executeStorageWrite(stateWithTxn, tabCount, logPrefix, transactionId),
    logPrefix,
    transactionId
  );
}

// ==================== v1.6.3.7-v3 SESSION STORAGE FUNCTIONS ====================
// API #1: storage.session - Session-Scoped Quick Tabs
// Session Quick Tabs auto-clear when browser closes (no stale data persistence)

/**
 * Check if storage.session API is available
 * v1.6.3.7-v3 - API #1: Session storage availability check
 * @returns {boolean} True if storage.session is available
 */
export function isSessionStorageAvailable() {
  const browserAPI = getBrowserStorageAPI();
  return !!(browserAPI?.storage?.session?.set && browserAPI?.storage?.session?.get);
}

/**
 * Separate tabs into permanent and session-only categories
 * v1.6.3.7-v3 - API #1: Route tabs based on permanent property
 * @param {Array} tabs - Array of Quick Tab data
 * @returns {{ permanentTabs: Array, sessionTabs: Array }}
 */
export function routeTabsToStorageLayers(tabs) {
  if (!Array.isArray(tabs)) {
    return { permanentTabs: [], sessionTabs: [] };
  }

  // Session tabs have permanent === false (explicit)
  // All other tabs go to permanent storage (default behavior)
  const sessionTabs = tabs.filter(tab => tab.permanent === false);
  const permanentTabs = tabs.filter(tab => tab.permanent !== false);

  console.log('[StorageUtils] Routed tabs to storage layers:', {
    permanentCount: permanentTabs.length,
    sessionCount: sessionTabs.length
  });

  return { permanentTabs, sessionTabs };
}

/**
 * Save session-only Quick Tabs to storage.session
 * v1.6.3.7-v3 - API #1: Session storage write
 * @param {Array} sessionTabs - Array of session Quick Tab data
 * @param {string} logPrefix - Log prefix for messages
 * @returns {Promise<boolean>} True if saved successfully
 */
export async function saveSessionQuickTabs(sessionTabs, logPrefix = '[StorageUtils]') {
  if (!isSessionStorageAvailable()) {
    console.warn(`${logPrefix} storage.session not available`);
    return false;
  }

  const browserAPI = getBrowserStorageAPI();

  try {
    const state = {
      tabs: sessionTabs,
      saveId: generateSaveId(),
      timestamp: Date.now()
    };

    await browserAPI.storage.session.set({ [SESSION_STATE_KEY]: state });
    console.log(`${logPrefix} Saved ${sessionTabs.length} session Quick Tabs to storage.session`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} Failed to save session Quick Tabs:`, err.message);
    return false;
  }
}

/**
 * Load session-only Quick Tabs from storage.session
 * v1.6.3.7-v3 - API #1: Session storage read
 * @param {string} logPrefix - Log prefix for messages
 * @returns {Promise<Array>} Array of session Quick Tabs (empty if none)
 */
export async function loadSessionQuickTabs(logPrefix = '[StorageUtils]') {
  if (!isSessionStorageAvailable()) {
    console.log(`${logPrefix} storage.session not available, returning empty array`);
    return [];
  }

  const browserAPI = getBrowserStorageAPI();

  try {
    const result = await browserAPI.storage.session.get(SESSION_STATE_KEY);
    const state = result?.[SESSION_STATE_KEY];

    if (!state?.tabs || !Array.isArray(state.tabs)) {
      console.log(`${logPrefix} No session Quick Tabs found`);
      return [];
    }

    console.log(`${logPrefix} Loaded ${state.tabs.length} session Quick Tabs from storage.session`);
    return state.tabs;
  } catch (err) {
    console.error(`${logPrefix} Failed to load session Quick Tabs:`, err.message);
    return [];
  }
}

/**
 * Load all Quick Tabs from both storage layers (local + session)
 * v1.6.3.7-v3 - API #1: Unified loading from both storage layers
 * @param {string} logPrefix - Log prefix for messages
 * @returns {Promise<{ tabs: Array, saveId: string, timestamp: number }>}
 */
export async function loadAllQuickTabs(logPrefix = '[StorageUtils]') {
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.warn(`${logPrefix} Browser API not available`);
    return { tabs: [], saveId: null, timestamp: 0 };
  }

  // Load from local storage (permanent tabs)
  let permanentTabs = [];
  let permanentSaveId = null;
  let permanentTimestamp = 0;

  try {
    const localResult = await browserAPI.storage.local.get(STATE_KEY);
    const localState = localResult?.[STATE_KEY];

    if (localState?.tabs && Array.isArray(localState.tabs)) {
      permanentTabs = localState.tabs;
      permanentSaveId = localState.saveId;
      permanentTimestamp = localState.timestamp || 0;
    }
  } catch (err) {
    console.error(`${logPrefix} Failed to load permanent Quick Tabs:`, err.message);
  }

  // Load from session storage (session-only tabs)
  const sessionTabs = await loadSessionQuickTabs(logPrefix);

  // Merge results (permanent tabs first, then session tabs)
  const allTabs = [...permanentTabs, ...sessionTabs];

  console.log(`${logPrefix} Loaded Quick Tabs from all layers:`, {
    permanentCount: permanentTabs.length,
    sessionCount: sessionTabs.length,
    totalCount: allTabs.length
  });

  return {
    tabs: allTabs,
    saveId: permanentSaveId || generateSaveId(),
    timestamp: permanentTimestamp || Date.now()
  };
}

/**
 * Clear all session Quick Tabs from storage.session
 * v1.6.3.7-v3 - API #1: Session storage clear
 * @param {string} logPrefix - Log prefix for messages
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clearSessionQuickTabs(logPrefix = '[StorageUtils]') {
  if (!isSessionStorageAvailable()) {
    return false;
  }

  const browserAPI = getBrowserStorageAPI();

  try {
    await browserAPI.storage.session.remove(SESSION_STATE_KEY);
    console.log(`${logPrefix} Cleared session Quick Tabs from storage.session`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} Failed to clear session Quick Tabs:`, err.message);
    return false;
  }
}

// ==================== END SESSION STORAGE FUNCTIONS ====================
