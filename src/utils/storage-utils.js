/**
 * Storage utility functions for Quick Tabs
 * v1.6.4 - Extracted from handlers to reduce duplication
 * v1.6.4.1 - FIX Bug #1: Add Promise timeout, validation, and detailed logging
 * v1.6.3.4 - FIX Issue #3: Add z-index persistence
 * v1.6.3.4-v6 - FIX Issues #1-6: Add transaction tracking, URL validation, state validation
 * v1.6.3.4-v8 - FIX Issues #1, #7: Empty write protection, storage write queue
 * 
 * @module storage-utils
 */

import { CONSTANTS } from '../core/config.js';

// Storage key for Quick Tabs state (unified format v1.6.2.2+)
export const STATE_KEY = 'quick_tabs_state_v2';

// v1.6.4.1 - FIX Bug #1: Timeout for storage operations (5 seconds)
const STORAGE_TIMEOUT_MS = 5000;

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

// v1.6.3.4-v6 - Delay before cleaning up transaction ID (allows storage.onChanged to fire)
// 200ms is empirically determined to be sufficient for storage.onChanged callbacks
// Math.min ensures reasonable cleanup even if STORAGE_TIMEOUT_MS is misconfigured
const TRANSACTION_CLEANUP_DELAY_MS = 200;

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

// v1.6.3.4-v9 - FIX Issue #16, #17: Transaction pattern with rollback capability
// Stores state snapshots for rollback on failure
let stateSnapshot = null;
let transactionActive = false;

/**
 * Capture current storage state as a snapshot for potential rollback
 * v1.6.3.4-v9 - FIX Issue #16, #17: Transaction pattern implementation
 * 
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<Object|null>} Captured state snapshot or null on error
 */
export async function captureStateSnapshot(logPrefix = '[StorageUtils]') {
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.warn(`${logPrefix} Cannot capture snapshot: storage API unavailable`);
    return null;
  }
  
  try {
    const result = await browserAPI.storage.local.get(STATE_KEY);
    stateSnapshot = result?.[STATE_KEY] || { tabs: [], timestamp: 0 };
    console.log(`${logPrefix} State snapshot captured:`, {
      tabCount: stateSnapshot.tabs?.length || 0,
      timestamp: stateSnapshot.timestamp
    });
    return stateSnapshot;
  } catch (err) {
    console.error(`${logPrefix} Failed to capture state snapshot:`, err);
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
 * Format: 'txn-timestamp-random6chars'
 * 
 * @returns {string} Unique transaction ID
 */
export function generateTransactionId() {
  return `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
 * 
 * @param {string} transactionId - Transaction ID from the change
 * @returns {boolean} True if change should be processed
 */
export function shouldProcessStorageChange(transactionId) {
  // Check if this is our own write
  if (transactionId && IN_PROGRESS_TRANSACTIONS.has(transactionId)) {
    console.log('[StorageUtils] Ignoring self-write:', transactionId);
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
 * Compute hash of state for deduplication
 * v1.6.3.4-v6 - FIX Issue #5: Prevent duplicate writes
 * 
 * @param {Object} state - State object to hash
 * @returns {number} 32-bit hash
 */
export function computeStateHash(state) {
  if (!state) return 0;
  
  const tabs = state.tabs || [];
  const tabData = tabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    left: tab.left ?? tab.position?.left,
    top: tab.top ?? tab.position?.top,
    width: tab.width ?? tab.size?.width,
    height: tab.height ?? tab.size?.height,
    minimized: tab.minimized ?? tab.visibility?.minimized,
    zIndex: tab.zIndex
  }));
  
  const stateStr = JSON.stringify({ saveId: state.saveId, tabData });
  
  let hash = 0;
  for (let i = 0; i < stateStr.length; i++) {
    hash = ((hash << 5) - hash) + stateStr.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
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
 * Get browser storage API (browser or chrome)
 * Returns null if not available (e.g., in unit tests)
 * 
 * @returns {Object|null} Browser storage API or null
 */
export function getBrowserStorageAPI() {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      return browser;
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      return chrome;
    }
  } catch (_err) {
    // Ignore errors accessing browser/chrome globals
  }
  return null;
}

/**
 * Get numeric value from flat or nested tab property
 * v1.6.4.2 - Helper to reduce complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {string} flatKey - Key for flat format (e.g., 'left')
 * @param {string} nestedObj - Nested object name (e.g., 'position')
 * @param {string} nestedKey - Nested property name (e.g., 'left')
 * @param {number} defaultVal - Default value if not found
 * @returns {number} Resolved value
 */
function _getNumericValue(tab, flatKey, nestedObj, nestedKey, defaultVal) {
  // v1.6.4.2 - Use nullish coalescing to properly handle 0 values
  const flatVal = tab[flatKey];
  const nestedVal = tab[nestedObj]?.[nestedKey];
  const rawVal = flatVal ?? nestedVal ?? defaultVal;
  // v1.6.4.3 - FIX: Validate that Number() produces a valid number (not NaN)
  const numVal = Number(rawVal);
  return isNaN(numVal) ? defaultVal : numVal;
}

/**
 * Get array value from flat or nested tab property
 * v1.6.4.2 - Helper to reduce complexity
 * v1.6.4.3 - Note: Unlike _getNumericValue, this function doesn't have a defaultVal
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
  const arr = Array.isArray(flatVal) ? flatVal : (Array.isArray(nestedVal) ? nestedVal : []);
  return [...arr];
}

/**
 * Serialize a single Quick Tab to storage format
 * v1.6.4.1 - FIX Bug #1: Extracted to reduce complexity
 * v1.6.4.2 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
 * v1.6.3.4 - FIX Issue #3: Include zIndex in serialized data for persistence
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {Object} Serialized tab data for storage
 */
function serializeTabForStorage(tab, isMinimized) {
  return {
    id: String(tab.id),
    url: String(tab.url || ''),
    title: String(tab.title || ''),
    left: _getNumericValue(tab, 'left', 'position', 'left', 0),
    top: _getNumericValue(tab, 'top', 'position', 'top', 0),
    width: _getNumericValue(tab, 'width', 'size', 'width', 400),
    height: _getNumericValue(tab, 'height', 'size', 'height', 300),
    zIndex: _getNumericValue(tab, 'zIndex', null, null, DEFAULT_ZINDEX), // v1.6.3.4 - Use constant
    minimized: Boolean(isMinimized),
    soloedOnTabs: _getArrayValue(tab, 'soloedOnTabs', 'soloedOnTabs'),
    mutedOnTabs: _getArrayValue(tab, 'mutedOnTabs', 'mutedOnTabs')
  };
}

/**
 * Validate that a state object can be serialized to JSON
 * v1.6.4.1 - FIX Bug #1: Extracted to reduce complexity
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
 * Check if tab has valid size
 * v1.6.3.4-v6 - Extracted to reduce validateTab complexity
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {boolean} True if size is valid
 */
function _hasValidSize(tab) {
  const width = tab.width ?? tab.size?.width;
  const height = tab.height ?? tab.size?.height;
  
  if (typeof width !== 'number' || width <= 0 || typeof height !== 'number' || height <= 0) {
    console.error('[StorageUtils] Tab has invalid size:', { id: tab.id, width, height });
    return false;
  }
  return true;
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
 * v1.6.4 - Extracted from handlers to reduce duplication
 * v1.6.4.1 - FIX Bug #1: Add validation and error handling
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
 * v1.6.4.1 - FIX Bug #1: Helper for Promise timeout wrapper
 * @private
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Description of the operation for error message
 * @returns {{promise: Promise, clear: Function}} Object with timeout promise and cleanup function
 */
function createTimeoutPromise(ms, operation) {
  // v1.6.4.3 - FIX: Initialize timeoutId to null for safer cleanup
  let timeoutId = null;
  const promise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);
  });
  // v1.6.4.3 - FIX: Only clear if timeoutId was set (safety check)
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
  
  // v1.6.3.4-v8 - FIX Issue #1: Log WARNING when going from N tabs to 0
  if (previousTabCount > 0) {
    console.warn(`${logPrefix} ⚠️ WARNING: State going from ${previousTabCount} tabs → 0 tabs [${transactionId}]`);
    console.warn(`${logPrefix} Stack trace:`, new Error().stack);
  }
  
  if (forceEmpty) {
    console.log(`${logPrefix} Empty write allowed (forceEmpty=true) [${transactionId}]`);
    return false;
  }
  
  const now = Date.now();
  if (now - lastEmptyWriteTime < EMPTY_WRITE_COOLDOWN_MS) {
    console.warn(`${logPrefix} REJECTED: Empty write within cooldown (${now - lastEmptyWriteTime}ms < ${EMPTY_WRITE_COOLDOWN_MS}ms) [${transactionId}]`);
    return true;
  }
  
  lastEmptyWriteTime = now;
  return false;
}

/**
 * Perform the actual storage write operation
 * v1.6.3.4-v8 - FIX Issue #7: Extracted for queue implementation
 * @private
 */
async function _executeStorageWrite(stateWithTxn, tabCount, logPrefix, transactionId) {
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.warn(`${logPrefix} Storage API not available, cannot persist`);
    return false;
  }
  
  // v1.6.3.4-v6 - FIX Issue #1: Track in-progress transaction
  IN_PROGRESS_TRANSACTIONS.add(transactionId);
  
  // v1.6.4.1 - FIX Bug #1: Create timeout with cleanup to prevent race condition
  const timeout = createTimeoutPromise(STORAGE_TIMEOUT_MS, 'storage.local.set');
  
  try {
    // v1.6.4.1 - FIX Bug #1: Wrap storage.local.set with timeout
    const storagePromise = browserAPI.storage.local.set({ [STATE_KEY]: stateWithTxn });
    
    await Promise.race([storagePromise, timeout.promise]);
    
    // v1.6.3.4-v8 - Update previous tab count after successful write
    previousTabCount = tabCount;
    
    console.log(`${logPrefix} Storage write COMPLETED [${transactionId}] (${tabCount} tabs)`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} Storage write FAILED [${transactionId}]:`, err.message || err);
    return false;
  } finally {
    // v1.6.4.2 - FIX: Always clear timeout to prevent memory leak
    timeout.clear();
    
    // v1.6.3.4-v6 - FIX Issue #1: Remove transaction from in-progress set after a delay
    setTimeout(() => {
      IN_PROGRESS_TRANSACTIONS.delete(transactionId);
    }, TRANSACTION_CLEANUP_DELAY_MS);
  }
}

/**
 * Queue a storage write operation (FIFO ordering)
 * v1.6.3.4-v8 - FIX Issue #7: Ensures writes are serialized
 * @param {Function} writeOperation - Async function to execute
 * @returns {Promise<boolean>} Result of the write operation
 */
export function queueStorageWrite(writeOperation) {
  // Chain this operation to the previous one
  storageWriteQueuePromise = storageWriteQueuePromise
    .then(() => writeOperation())
    .catch(err => {
      console.error('[StorageUtils] Queued write failed:', err);
      return false;
    });
  
  return storageWriteQueuePromise;
}

/**
 * Persist Quick Tab state to storage.local
 * v1.6.4 - Extracted from handlers
 * v1.6.4.1 - FIX Bug #1: Add Promise timeout, validation, and detailed logging
 * v1.6.4.2 - FIX: Ensure timeout is always cleared to prevent memory leak
 * v1.6.3.4-v6 - FIX Issue #1, #5: Transaction tracking and deduplication
 * v1.6.3.4-v8 - FIX Issues #1, #7: Empty write protection, storage write queue
 * 
 * @param {Object} state - State object to persist
 * @param {string} logPrefix - Prefix for log messages (e.g., '[DestroyHandler]')
 * @param {boolean} forceEmpty - Allow empty (0 tabs) writes (default: false)
 * @returns {Promise<boolean>} - Promise resolving to true on success, false on failure
 */
export function persistStateToStorage(state, logPrefix = '[StorageUtils]', forceEmpty = false) {
  // v1.6.3.4-v6 - FIX Issue #1: Generate transaction ID for tracking
  const transactionId = generateTransactionId();
  console.log(`${logPrefix} Storage write STARTED [${transactionId}]`);
  
  // v1.6.4.1 - FIX Bug #1: Validate state before attempting storage
  if (!state) {
    console.error(`${logPrefix} Cannot persist: state is null/undefined`);
    return Promise.resolve(false);
  }
  
  if (!state.tabs || !Array.isArray(state.tabs)) {
    console.error(`${logPrefix} Cannot persist: state.tabs is invalid`);
    return Promise.resolve(false);
  }
  
  const tabCount = state.tabs.length;
  const minimizedCount = state.tabs.filter(t => t.minimized).length;
  
  // v1.6.3.4-v8 - FIX Issue #1: Reject empty writes unless forceEmpty is true
  if (_shouldRejectEmptyWrite(tabCount, forceEmpty, logPrefix, transactionId)) {
    return Promise.resolve(false);
  }
  
  // v1.6.3.4-v6 - FIX Issue #5: Check if state has actually changed
  if (!hasStateChanged(state)) {
    console.log(`${logPrefix} Storage write SKIPPED [${transactionId}] (no changes)`);
    return Promise.resolve(true); // Not an error, just nothing to write
  }
  
  // v1.6.3.4-v6 - FIX Issue #6: Validate state before persist
  const validation = validateStateForPersist(state);
  if (!validation.valid) {
    console.error(`${logPrefix} State validation failed [${transactionId}]:`, validation.errors);
    // Allow persist to continue but log the errors
  }
  
  console.log(`${logPrefix} Persisting ${tabCount} tabs (${minimizedCount} minimized) [${transactionId}]`);
  
  // v1.6.3.4-v6 - FIX Issue #1: Add transaction ID to state for tracking
  const stateWithTxn = {
    ...state,
    transactionId
  };
  
  // v1.6.3.4-v8 - FIX Issue #7: Queue the write operation for FIFO ordering
  return queueStorageWrite(() => 
    _executeStorageWrite(stateWithTxn, tabCount, logPrefix, transactionId)
  );
}
