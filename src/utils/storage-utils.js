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
 * v1.6.3.10-v6 - FIX Diagnostic Issues #4, #11, #12, #14:
 *   - Issue #4/11: Add waitForTabIdInit() for content script tab ID initialization
 *   - Issue #12: Ensure tab ID is set before storage writes via promise resolution
 *   - Issue #14: Enhanced logging showing how currentWritingTabId was obtained
 *   - Issue #1, #6: Add normalizeOriginTabId() with Number() casting and Number.isInteger() validation
 *   - Issue #7: Unified type normalization for all originTabId deserialization paths
 *   - Issue #8: Enhanced type visibility logging in serialization/deserialization operations
 * v1.6.3.10-v6 - FIX Issue #13: Complete originContainerId implementation for Firefox Multi-Account Containers
 *   - Add normalizeOriginContainerId() for container ID validation (strings like "firefox-default")
 *   - Add _extractOriginContainerId() helper with proper validation
 *   - Update canCurrentTabModifyQuickTab() to compare BOTH originTabId AND originContainerId
 *   - Update _filterOwnedTabs() to filter by both tab ID AND container ID
 *   - Track currentWritingContainerId alongside currentWritingTabId
 *   - Legacy fallback: Allow writes if originContainerId is null (pre-v4 Quick Tabs)
 * v1.6.3.10-v9 - FIX Critical Storage & Lifecycle Issues:
 *   - Issue A/O/S: Identity-ready gating blocks hydration until tabId AND containerId are known
 *   - Issue F: Storage write queue recovery on unload/timeout edge cases
 *   - Issue G: Container matching fail-closed until identity is known (INITIALIZING mode)
 *   - Issue M/D: Preflight quota check using navigator.storage.estimate()
 *   - Issue E: Tighten normalizeOriginTabId() with rejection reason codes
 *   - Issue L: Label transaction IDs when identity is unknown
 *   - Issue V: Document rollbackTransaction() dead code (kept for future error recovery)
 *   - Issue W: Log retry attempts with attempt number for correlation
 *
 * Architecture (Single-Tab Model v1.6.3+):
 * - Each tab only writes state for Quick Tabs it owns (originTabId matches)
 * - Self-write detection via writingInstanceId/writingTabId
 * - Transaction IDs tracked until storage.onChanged confirms processing
 * - Content scripts must call waitForIdentityInit() before storage operations
 *
 * @module storage-utils
 */

import { CONSTANTS } from '../core/config.js';

// Storage key for Quick Tabs state (unified format v1.6.2.2+)
export const STATE_KEY = 'quick_tabs_state_v2';

// v1.6.3.10-v10 - FIX Code Review: Use constant for unknown tab ID in transaction IDs
// String is intentional for debugging - makes it clear in logs when identity wasn't ready
const UNKNOWN_TAB_ID_LABEL = 'UNKNOWN';

// v1.6.3.4-v2 - FIX Bug #1: Timeout for storage operations (5 seconds)
// v1.6.3.6 - FIX Issue #2: Reduced from 5000ms to 2000ms to prevent transaction backlog
const STORAGE_TIMEOUT_MS = 2000;

// v1.6.3.10-v6 - FIX Issue A20: Retry configuration for storage write failures
// Exponential backoff delays between retries (not including initial attempt)
// Total attempts = 1 (initial) + STORAGE_RETRY_DELAYS_MS.length (retries) = 4 attempts
const STORAGE_RETRY_DELAYS_MS = [100, 500, 1000];
const STORAGE_MAX_RETRIES = STORAGE_RETRY_DELAYS_MS.length;

// v1.6.3.10-v9 - FIX Issue M/D: Quota monitoring constants
// Minimum available bytes required before allowing a storage write
const STORAGE_QUOTA_MIN_HEADROOM_BYTES = 1024 * 1024; // 1MB minimum headroom
// Threshold for logging quota warnings
const STORAGE_QUOTA_WARNING_THRESHOLD = 0.8; // Warn when 80% full
// Sampling interval for quota logging (log every N writes)
const STORAGE_QUOTA_LOG_SAMPLING_INTERVAL = 50;

// v1.6.3.10-v9 - FIX Issue F: Storage write queue recovery constants
const WRITE_QUEUE_STALL_TIMEOUT_MS = 10000; // 10s max stall before recovery
const WRITE_QUEUE_MAX_PENDING = 20; // Max pending writes before queue reset

// v1.6.3.10-v9 - FIX Issue E: Normalization rejection reason codes
/**
 * Reason codes for originTabId normalization rejection
 * @enum {string}
 */
export const NORMALIZATION_REJECTION_REASON = {
  NULLISH: 'NULLISH',
  NAN: 'NAN',
  NON_INTEGER: 'NON_INTEGER',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  MALFORMED_STRING: 'MALFORMED_STRING'
};

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
// v1.6.3.10-v10 - FIX Issue U: Documented rationale for cooldown value
// RATIONALE: 1000ms cooldown prevents rapid-fire empty writes during:
// - Page unload/reload scenarios (DOMContentLoaded ~200-500ms, full load ~500-2000ms)
// - Tab switching storms where multiple tabs emit storage events
// - Browser crash recovery where storage events may replay
// LIMITATION: May block legitimate rapid Close All operations if user clicks multiple times
// within 1 second. This is acceptable because Close All is idempotent - repeated calls
// have the same effect as a single call. Consider adaptive logic in future if users report issues.
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

// v1.6.3.10-v10 - FIX Issue K: Ownership filter reason codes
/**
 * Reason codes for ownership filtering decisions
 * @enum {string}
 */
export const OWNERSHIP_FILTER_REASON = {
  TABID_MISMATCH: 'TABID_MISMATCH',
  CONTAINER_MISMATCH: 'CONTAINER_MISMATCH',
  ORPHAN_POLICY: 'ORPHAN_POLICY', // Tab owner may have closed
  STRICT_MATCH: 'STRICT_MATCH',   // Both tabId and containerId match exactly
  LEGACY_FALLBACK: 'LEGACY_FALLBACK', // originContainerId is null (pre-v4 Quick Tab)
  NO_OWNERSHIP_DATA: 'NO_OWNERSHIP_DATA' // originTabId is null - can't determine ownership
};

// v1.6.3.4-v9 - FIX Issue #16, #17: Transaction pattern with rollback capability
// Stores state snapshots for rollback on failure
let stateSnapshot = null;
let transactionActive = false;
// v1.6.3.10-v10 - FIX Issue J: Transaction correlation ID for logging
let currentTransactionCorrelationId = null;

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
// v1.6.3.10-v5 - FIX Code Review: Counter wrap limit constant
const COUNTER_WRAP_LIMIT = 1000000;
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

// v1.6.3.10-v10 - FIX Issue N: Storage event sequence numbering for ordering validation
// Per MDN: storage.onChanged event fires "when one or more items change" with no sequencing guarantee
// These variables track event ordering to detect when events arrive out-of-order across tabs
let lastObservedStorageEventTimestamp = 0; // Timestamp from storage event's transactionId or timestamp field
let lastObservedStorageEventSequence = 0; // Our internal sequence counter for received events
let storageEventOutOfOrderCount = 0; // Counter for diagnostic purposes

// v1.6.3.10-v10 - FIX Issue N: Tolerance for out-of-order detection (clock skew + concurrent writes)
const STORAGE_EVENT_ORDER_TOLERANCE_MS = 100;

/**
 * Extract timestamp from transaction ID
 * v1.6.3.10-v10 - FIX Issue N: Helper to reduce validateStorageEventOrdering complexity
 * @private
 * @param {string|undefined} transactionId - Transaction ID to parse
 * @returns {number} Extracted timestamp or 0
 */
function _extractTimestampFromTransactionId(transactionId) {
  if (!transactionId) return 0;
  const txnParts = transactionId.split('-');
  if (txnParts.length < 2) return 0;
  const parsedTs = parseInt(txnParts[1], 10);
  return (!isNaN(parsedTs) && parsedTs > 0) ? parsedTs : 0;
}

/**
 * Check if storage event is out-of-order based on timestamp
 * v1.6.3.10-v10 - FIX Issue N: Helper to reduce validateStorageEventOrdering complexity
 * @private
 * @param {number} eventTimestamp - Event timestamp
 * @param {number} lastTimestamp - Last observed timestamp
 * @returns {boolean} True if out-of-order
 */
function _isStorageEventOutOfOrder(eventTimestamp, lastTimestamp) {
  return eventTimestamp > 0 && 
         lastTimestamp > 0 && 
         eventTimestamp < (lastTimestamp - STORAGE_EVENT_ORDER_TOLERANCE_MS);
}

/**
 * Validate storage event ordering and log if out-of-order
 * v1.6.3.10-v10 - FIX Issue N: Detect when storage.onChanged events arrive out-of-order
 * 
 * Per MDN documentation, storage.onChanged events have no ordering guarantee.
 * This function tracks event timestamps and logs warnings when events appear to arrive
 * out of their original write order.
 * 
 * @param {Object} newValue - New storage value containing transactionId/timestamp
 * @returns {{inOrder: boolean, sequenceNumber: number, details: Object}} Ordering validation result
 */
export function validateStorageEventOrdering(newValue) {
  lastObservedStorageEventSequence++;
  const currentSequence = lastObservedStorageEventSequence;
  
  // Extract timestamp from transaction ID or explicit field
  let eventTimestamp = newValue?.timestamp ?? 0;
  if (!eventTimestamp) {
    eventTimestamp = _extractTimestampFromTransactionId(newValue?.transactionId);
  }
  
  const details = {
    currentSequence,
    eventTimestamp,
    lastTimestamp: lastObservedStorageEventTimestamp,
    transactionId: newValue?.transactionId,
    writingTabId: newValue?.writingTabId,
    timestampDelta: eventTimestamp - lastObservedStorageEventTimestamp
  };
  
  const isOutOfOrder = _isStorageEventOutOfOrder(eventTimestamp, lastObservedStorageEventTimestamp);
  
  if (isOutOfOrder) {
    storageEventOutOfOrderCount++;
    console.warn('[StorageUtils] v1.6.3.10-v10 STORAGE_EVENT_OUT_OF_ORDER:', {
      ...details,
      outOfOrderCount: storageEventOutOfOrderCount,
      warning: 'Event arrived with timestamp older than previous event',
      recommendation: 'Check for concurrent writes from multiple tabs'
    });
  }
  
  // Update tracking state (always use latest timestamp regardless of order)
  if (eventTimestamp > lastObservedStorageEventTimestamp) {
    lastObservedStorageEventTimestamp = eventTimestamp;
  }
  
  return { inOrder: !isOutOfOrder, sequenceNumber: currentSequence, details };
}

// v1.6.3.6-v2 - FIX Issue #3: Track tabs that have ever created/owned Quick Tabs
// Used to validate empty writes - only tabs with ownership history can write empty state
const previouslyOwnedTabIds = new Set();

// v1.6.3.6-v2 - FIX Issue #2: Track duplicate saveId writes to detect loops
// Map of saveId → { count, firstTimestamp }
const saveIdWriteTracker = new Map();
// v1.6.3.10-v10 - FIX Issue I: Increased from 1000ms to 5000ms to align with worst-case storage timing
// Window must be >= STORAGE_TIMEOUT_MS (2000ms) + CIRCUIT_BREAKER_BACKOFF_MAX (30s) patterns
// Using 5s as practical compromise between false-positive loop detection and cascade detection
const DUPLICATE_SAVEID_WINDOW_MS = 5000;
// v1.6.3.6-v3 - FIX Issue #3: Reduced from 2 to 1 for faster loop detection
// Warn if same saveId written more than once
const DUPLICATE_SAVEID_THRESHOLD = 1;

// v1.6.3.10-v10 - FIX Issue H: Write coalescing/rate-limiting constants
// Minimum interval between persisting the same state hash (debounce)
const WRITE_COALESCE_MIN_INTERVAL_MS = 100;
// Last write timestamp for rate limiting
let lastWriteTimestamp = 0;
// Last state hash that was persisted (for hash-unchanged detection)
let lastPersistedHash = null;
// Counter for coalesced writes (for logging)
let coalescedWriteCount = 0;

// Current tab ID for self-write detection (initialized lazily)
let currentWritingTabId = null;

// v1.6.3.10-v6 - FIX Issue #13: Current container ID for Firefox Multi-Account Container isolation
// This tracks the cookieStoreId of the current tab (e.g., "firefox-default", "firefox-container-1")
let currentWritingContainerId = null;

// v1.6.3.10-v6 - FIX Issue #4/11: Promise for tab ID initialization
// Resolves when setWritingTabId() is called or initWritingTabId() completes
let tabIdInitResolver = null;
let tabIdInitPromise = null;

// v1.6.3.10-v9 - FIX Issue S: Promise for container ID initialization
// Resolves when setWritingContainerId() is called or initWritingTabId() completes
let containerIdInitResolver = null;
let containerIdInitPromise = null;

// v1.6.3.10-v9 - FIX Issue A/O/G: Identity state mode tracking
// Tracks whether identity (tabId + containerId) is fully initialized
/**
 * Identity state modes for container matching behavior
 * @enum {string}
 */
export const IDENTITY_STATE_MODE = {
  INITIALIZING: 'INITIALIZING', // Identity not yet known - fail-closed
  READY: 'READY',               // Both tabId and containerId are known
  LEGACY_FALLBACK: 'LEGACY_FALLBACK' // Legacy Quick Tab without containerId
};

// Current identity state mode
let identityStateMode = IDENTITY_STATE_MODE.INITIALIZING;

// v1.6.3.10-v9 - FIX Issue F: Track write queue state for recovery
let writeQueueStallStartTime = null;
let writeQueueRecoveryCount = 0;

/**
 * Initialize the tab ID init promise
 * v1.6.3.10-v6 - FIX Issue #4/11: Create promise for waitForTabIdInit()
 * @private
 */
function _ensureTabIdInitPromise() {
  if (tabIdInitPromise === null) {
    tabIdInitPromise = new Promise(resolve => {
      tabIdInitResolver = resolve;
    });
  }
  return tabIdInitPromise;
}

/**
 * Initialize the container ID init promise
 * v1.6.3.10-v9 - FIX Issue S: Create promise for waitForContainerIdInit()
 * @private
 */
function _ensureContainerIdInitPromise() {
  if (containerIdInitPromise === null) {
    containerIdInitPromise = new Promise(resolve => {
      containerIdInitResolver = resolve;
    });
  }
  return containerIdInitPromise;
}

/**
 * Update identity state mode based on current initialization state
 * v1.6.3.10-v9 - FIX Issue G: Track identity mode for fail-closed container matching
 * v1.6.3.10-v10 - FIX Gap 1.2: State machine logging for identity phases
 * @private
 */
function _updateIdentityStateMode() {
  const previousMode = identityStateMode;
  
  if (currentWritingTabId !== null && currentWritingContainerId !== null) {
    identityStateMode = IDENTITY_STATE_MODE.READY;
  } else if (currentWritingTabId !== null && currentWritingContainerId === null) {
    // Tab ID known but container not set yet - still initializing
    // Could also be legacy context without container support
    identityStateMode = IDENTITY_STATE_MODE.INITIALIZING;
  } else {
    identityStateMode = IDENTITY_STATE_MODE.INITIALIZING;
  }
  
  // v1.6.3.10-v10 - FIX Gap 1.2: State machine logging for identity phases
  if (previousMode !== identityStateMode) {
    console.log('[Storage-Identity] STATE_TRANSITION:', {
      from: previousMode,
      to: identityStateMode,
      tabId: currentWritingTabId !== null ? `KNOWN(${currentWritingTabId})` : 'UNKNOWN',
      containerId: currentWritingContainerId !== null ? `KNOWN(${currentWritingContainerId})` : 'UNKNOWN',
      isFullyReady: identityStateMode === IDENTITY_STATE_MODE.READY,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Get current identity state mode
 * v1.6.3.10-v9 - FIX Issue G: Expose identity mode for container matching decisions
 * @returns {string} Current identity state mode
 */
export function getIdentityStateMode() {
  return identityStateMode;
}

/**
 * Check if identity is ready for storage operations
 * v1.6.3.10-v9 - FIX Issue A/O: Check if both tabId and containerId are initialized
 * @returns {boolean} True if identity is ready
 */
export function isIdentityReady() {
  return identityStateMode === IDENTITY_STATE_MODE.READY;
}

/**
 * Wait for container ID to be initialized
 * v1.6.3.10-v9 - FIX Issue S: Parallel to waitForTabIdInit() for container ID
 * Content scripts must wait for container ID for proper container isolation.
 *
 * @param {number} timeoutMs - Maximum time to wait in milliseconds (default: 5000)
 * @returns {Promise<string|null>} Current container ID or null if timeout
 */
export async function waitForContainerIdInit(timeoutMs = 5000) {
  // Fast path: already initialized
  if (currentWritingContainerId !== null) {
    console.log('[StorageUtils] v1.6.3.10-v9 waitForContainerIdInit: Already initialized', {
      containerId: currentWritingContainerId,
      source: 'cached'
    });
    return currentWritingContainerId;
  }

  console.log('[StorageUtils] v1.6.3.10-v9 waitForContainerIdInit: Waiting for container ID initialization', {
    timeoutMs
  });

  const promise = _ensureContainerIdInitPromise();

  let timeoutId = null;
  try {
    const result = await Promise.race([
      promise.then(r => {
        if (timeoutId) clearTimeout(timeoutId);
        return r;
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Container ID initialization timeout')), timeoutMs);
      })
    ]);

    console.log('[StorageUtils] v1.6.3.10-v9 waitForContainerIdInit: Resolved', {
      containerId: result,
      source: 'promise'
    });
    return result;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    console.warn('[StorageUtils] v1.6.3.10-v9 waitForContainerIdInit: Timeout waiting for container ID', {
      timeoutMs,
      error: err.message
    });
    return null;
  }
}

/**
 * Wait for full identity (both tabId AND containerId) to be initialized
 * v1.6.3.10-v9 - FIX Issue A/O: Combined wait for complete identity initialization
 * This should be called before any hydration or storage operations.
 *
 * @param {number} timeoutMs - Maximum time to wait in milliseconds (default: 5000)
 * @returns {Promise<{tabId: number|null, containerId: string|null, isReady: boolean}>}
 */
export async function waitForIdentityInit(timeoutMs = 5000) {
  console.log('[StorageUtils] v1.6.3.10-v9 waitForIdentityInit: Waiting for identity', {
    timeoutMs,
    currentTabId: currentWritingTabId,
    currentContainerId: currentWritingContainerId,
    identityMode: identityStateMode
  });

  const startTime = Date.now();

  // Wait for both in parallel
  const [tabId, containerId] = await Promise.all([
    waitForTabIdInit(timeoutMs),
    waitForContainerIdInit(timeoutMs)
  ]);

  const duration = Date.now() - startTime;
  const isReady = tabId !== null && containerId !== null;

  console.log('[StorageUtils] v1.6.3.10-v9 waitForIdentityInit: Complete', {
    tabId,
    containerId,
    isReady,
    identityMode: identityStateMode,
    durationMs: duration
  });

  return { tabId, containerId, isReady };
}

/**
 * Wait for writing tab ID to be initialized
 * v1.6.3.10-v6 - FIX Issue #4/11/12: Content scripts must wait for tab ID before storage writes
 * This is critical because content scripts cannot use browser.tabs.getCurrent() and must
 * get tab ID from background script via messaging. Storage writes will fail ownership
 * validation if currentWritingTabId is null.
 *
 * @param {number} timeoutMs - Maximum time to wait in milliseconds (default: 5000)
 * @returns {Promise<number|null>} Current tab ID or null if timeout
 */
export async function waitForTabIdInit(timeoutMs = 5000) {
  // Fast path: already initialized
  if (currentWritingTabId !== null) {
    console.log('[StorageUtils] v1.6.3.10-v6 waitForTabIdInit: Already initialized', {
      tabId: currentWritingTabId,
      source: 'cached'
    });
    return currentWritingTabId;
  }

  console.log('[StorageUtils] v1.6.3.10-v6 waitForTabIdInit: Waiting for tab ID initialization', {
    timeoutMs
  });

  const promise = _ensureTabIdInitPromise();

  // v1.6.3.10-v6 - FIX Code Review: Clean up timeout timer to prevent unnecessary execution
  let timeoutId = null;
  try {
    // Wait for tab ID with timeout
    const result = await Promise.race([
      promise.then(r => {
        if (timeoutId) clearTimeout(timeoutId);
        return r;
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Tab ID initialization timeout')), timeoutMs);
      })
    ]);

    console.log('[StorageUtils] v1.6.3.10-v6 waitForTabIdInit: Resolved', {
      tabId: result,
      source: 'promise'
    });
    return result;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    console.warn('[StorageUtils] v1.6.3.10-v6 waitForTabIdInit: Timeout waiting for tab ID', {
      timeoutMs,
      error: err.message
    });
    return null;
  }
}

/**
 * Check if writing tab ID is initialized
 * v1.6.3.10-v6 - FIX Issue #12: Synchronous check for tab ID availability
 * @returns {boolean} True if tab ID is initialized
 */
export function isWritingTabIdInitialized() {
  return currentWritingTabId !== null;
}

/**
 * Resolve the tab ID init promise if resolver exists
 * v1.6.3.10-v6 - FIX Issue #4/11: Extracted to reduce nesting depth
 * v1.6.3.10-v9 - FIX Issue G: Update identity state mode after resolution
 * @private
 * @param {number} tabId - Tab ID to resolve with
 * @param {string} source - Source of tab ID for logging
 */
function _resolveTabIdInitPromise(tabId, source) {
  if (!tabIdInitResolver) return;

  tabIdInitResolver(tabId);
  console.log('[StorageUtils] v1.6.3.10-v6 Tab ID init promise resolved via', source);
  
  // v1.6.3.10-v9 - FIX Issue G: Update identity state mode
  _updateIdentityStateMode();
}

/**
 * Resolve the container ID init promise if resolver exists
 * v1.6.3.10-v9 - FIX Issue S: Extracted to reduce nesting depth
 * @private
 * @param {string} containerId - Container ID to resolve with
 * @param {string} source - Source of container ID for logging
 */
function _resolveContainerIdInitPromise(containerId, source) {
  if (!containerIdInitResolver) return;

  containerIdInitResolver(containerId);
  console.log('[StorageUtils] v1.6.3.10-v9 Container ID init promise resolved via', source);
  
  // Update identity state mode
  _updateIdentityStateMode();
}

/**
 * Initialize the writing tab ID asynchronously
 * v1.6.3.5-v3 - FIX Diagnostic Issue #1: Self-write detection
 * v1.6.3.10-v6 - FIX Issue #4/11: Resolve tab ID init promise on success
 * v1.6.3.10-v6 - FIX Issue #13: Also extract container ID for Firefox Multi-Account Container isolation
 * v1.6.3.10-v9 - FIX Issue S: Resolve container ID promise too
 */
async function initWritingTabId() {
  if (currentWritingTabId !== null) return currentWritingTabId;

  try {
    const browserAPI = getBrowserStorageAPI();
    const tab = await _fetchCurrentTab(browserAPI);
    if (!tab?.id) return currentWritingTabId;

    currentWritingTabId = tab.id;

    // v1.6.3.10-v6 - FIX Issue #13: Extract container ID from cookieStoreId
    currentWritingContainerId = tab.cookieStoreId ?? null;

    console.log('[StorageUtils] Initialized writingTabId and containerId:', {
      tabId: currentWritingTabId,
      containerId: currentWritingContainerId,
      source: 'browser.tabs.getCurrent()'
    });

    // v1.6.3.10-v6 - FIX Issue #4/11: Resolve the waiting promise
    _resolveTabIdInitPromise(currentWritingTabId, 'getCurrent()');
    
    // v1.6.3.10-v9 - FIX Issue S: Resolve container ID promise too
    if (currentWritingContainerId !== null) {
      _resolveContainerIdInitPromise(currentWritingContainerId, 'getCurrent()');
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

// v1.6.3.10-v10 - FIX Issue Q: Caller context types for setWritingTabId validation
/**
 * Known caller context types for tab ID initialization
 * @enum {string}
 */
export const TAB_ID_CALLER_CONTEXT = {
  CONTENT_SCRIPT: 'content-script',      // Valid: content scripts get tabId from background
  SIDEBAR: 'sidebar',                     // Valid: sidebar gets tabId from background
  BACKGROUND: 'background',               // WARNING: Background scripts shouldn't write Quick Tabs
  OPTIONS_PAGE: 'options-page',           // WARNING: Options page shouldn't write Quick Tabs
  POPUP: 'popup',                         // WARNING: Popup shouldn't write Quick Tabs
  UNKNOWN: 'unknown'                      // WARNING: Caller didn't identify themselves
};

/**
 * Explicitly set the writing tab ID
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Allow content scripts to set tab ID
 * v1.6.3.10-v6 - FIX Issue #4/11/12: Resolve tab ID init promise when set
 * v1.6.3.10-v10 - FIX Issue Q: Add context parameter to track which context is calling
 * Content scripts cannot use browser.tabs.getCurrent(), so they need to
 * get the tab ID from background script and pass it here.
 *
 * @param {number} tabId - The browser tab ID to use for ownership tracking (must be positive integer)
 * @param {string} [callerContext='unknown'] - Context identifying the caller (content-script, sidebar, etc.)
 */
export function setWritingTabId(tabId, callerContext = TAB_ID_CALLER_CONTEXT.UNKNOWN) {
  // v1.6.3.10-v10 - FIX Gap 1.1: Log identity initialization milestone
  const setStartTime = Date.now();
  console.log('[Storage-Init] setWritingTabId CALLED:', {
    tabId,
    callerContext,
    previousTabId: currentWritingTabId,
    previousIdentityMode: identityStateMode,
    timestamp: new Date().toISOString()
  });
  
  // v1.6.3.10-v10 - FIX Issue Q: Log caller context for diagnostics
  const validContexts = [TAB_ID_CALLER_CONTEXT.CONTENT_SCRIPT, TAB_ID_CALLER_CONTEXT.SIDEBAR];
  const isValidContext = validContexts.includes(callerContext);
  
  // Warn if called from non-tab context (background, options, popup shouldn't write Quick Tabs)
  if (!isValidContext) {
    console.warn('[Storage-Init] setWritingTabId: Called from non-tab context', {
      callerContext,
      tabId,
      warning: 'Only content scripts and sidebar should set writing tab ID',
      validContexts,
      recommendation: 'Background scripts, options pages, and popups should not write Quick Tab state'
    });
  }
  
  // Validate that tabId is a positive integer (browser tab IDs are always positive)
  if (!_isValidPositiveInteger(tabId)) {
    console.warn('[Storage-Init] setWritingTabId REJECTED: Invalid tabId', {
      tabId,
      type: typeof tabId,
      isInteger: Number.isInteger(tabId),
      isPositive: tabId > 0,
      callerContext,
      rejectionReason: 'INVALID_TAB_ID'
    });
    return;
  }

  const oldTabId = currentWritingTabId;
  currentWritingTabId = tabId;
  
  // v1.6.3.10-v10 - FIX Gap 1.1: Log identity initialization completion
  console.log('[Storage-Init] setWritingTabId COMPLETE:', {
    oldTabId: oldTabId !== null ? oldTabId : 'NONE',
    newTabId: tabId,
    source: 'setWritingTabId()',
    callerContext,
    isValidContext,
    durationMs: Date.now() - setStartTime,
    timestamp: new Date().toISOString()
  });

  // v1.6.3.10-v6 - FIX Issue #4/11/12: Resolve waiting promise for waitForTabIdInit()
  _resolveTabIdInitPromise(tabId, 'setWritingTabId()');
}

/**
 * Explicitly set the writing container ID
 * v1.6.3.10-v6 - FIX Issue #13: Allow content scripts to set container ID for Firefox Multi-Account Containers
 * v1.6.3.10-v9 - FIX Issue S: Resolve container ID init promise
 * v1.6.3.10-v10 - FIX Gap 1.1: Log identity initialization milestone
 * Content scripts cannot use browser.tabs.getCurrent(), so they need to
 * get the container ID from background script and pass it here.
 *
 * @param {string|null} containerId - The container ID to use (e.g., "firefox-default", "firefox-container-1")
 */
export function setWritingContainerId(containerId) {
  // v1.6.3.10-v10 - FIX Gap 1.1: Log identity initialization milestone
  const setStartTime = Date.now();
  console.log('[Storage-Init] setWritingContainerId CALLED:', {
    containerId,
    previousContainerId: currentWritingContainerId,
    previousIdentityMode: identityStateMode,
    timestamp: new Date().toISOString()
  });

  // Use normalizeOriginContainerId for validation
  const normalizedContainerId = normalizeOriginContainerId(containerId, 'setWritingContainerId');

  const oldContainerId = currentWritingContainerId;
  currentWritingContainerId = normalizedContainerId;
  
  // v1.6.3.10-v10 - FIX Gap 1.1: Log identity initialization completion
  console.log('[Storage-Init] setWritingContainerId COMPLETE:', {
    oldContainerId: oldContainerId !== null ? oldContainerId : 'NONE',
    newContainerId: normalizedContainerId,
    source: 'setWritingContainerId()',
    durationMs: Date.now() - setStartTime,
    timestamp: new Date().toISOString()
  });
  
  // v1.6.3.10-v9 - FIX Issue S: Resolve waiting promise for waitForContainerIdInit()
  if (normalizedContainerId !== null) {
    _resolveContainerIdInitPromise(normalizedContainerId, 'setWritingContainerId()');
  }
}

/**
 * Get the current writing container ID
 * v1.6.3.10-v6 - FIX Issue #13: Get cached container ID for Firefox Multi-Account Container isolation
 * @returns {string|null} Current container ID or null if not initialized
 */
export function getWritingContainerId() {
  return currentWritingContainerId;
}

/**
 * Get the instance ID for self-write detection
 * @returns {string} Unique instance ID for this tab load
 */
export function getWritingInstanceId() {
  return WRITING_INSTANCE_ID;
}

/**
 * Log rejection with reason code
 * v1.6.3.10-v9 - FIX Issue E: Helper for normalizeOriginTabId
 * @private
 */
function _logTabIdRejection(context, originalValue, reason, extra = {}) {
  const logLevel = reason === NORMALIZATION_REJECTION_REASON.NULLISH ? 'log' : 'warn';
  console[logLevel]('[StorageUtils] normalizeOriginTabId: Rejected', {
    context,
    originalValue,
    rejectionReason: reason,
    ...extra
  });
}

/**
 * Validate string format for tab ID conversion
 * v1.6.3.10-v9 - FIX Issue E: Helper for normalizeOriginTabId
 * @private
 * @returns {string|null} Rejection reason or null if valid
 */
function _validateStringTabId(value, context) {
  const trimmed = value.trim();
  if (trimmed !== value) {
    _logTabIdRejection(context, value, NORMALIZATION_REJECTION_REASON.MALFORMED_STRING, { trimmedValue: trimmed });
    return NORMALIZATION_REJECTION_REASON.MALFORMED_STRING;
  }
  // Only accept positive integers (no leading zeros except for "0", no negative)
  if (!/^\d+$/.test(trimmed)) {
    _logTabIdRejection(context, value, NORMALIZATION_REJECTION_REASON.MALFORMED_STRING);
    return NORMALIZATION_REJECTION_REASON.MALFORMED_STRING;
  }
  return null;
}

/**
 * Validate numeric value for tab ID
 * v1.6.3.10-v9 - FIX Issue E: Helper for normalizeOriginTabId
 * @private
 * @returns {string|null} Rejection reason or null if valid
 */
function _validateNumericTabId(numericValue, context, originalValue, originalType) {
  if (Number.isNaN(numericValue)) {
    _logTabIdRejection(context, originalValue, NORMALIZATION_REJECTION_REASON.NAN, { originalType });
    return NORMALIZATION_REJECTION_REASON.NAN;
  }
  if (!Number.isInteger(numericValue)) {
    _logTabIdRejection(context, originalValue, NORMALIZATION_REJECTION_REASON.NON_INTEGER, { originalType, numericValue });
    return NORMALIZATION_REJECTION_REASON.NON_INTEGER;
  }
  if (numericValue <= 0) {
    _logTabIdRejection(context, originalValue, NORMALIZATION_REJECTION_REASON.OUT_OF_RANGE, { originalType, numericValue });
    return NORMALIZATION_REJECTION_REASON.OUT_OF_RANGE;
  }
  return null;
}

/**
 * Normalize originTabId to ensure type safety
 * v1.6.3.10-v6 - FIX Diagnostic Issues #1, #6, #7: Unified type normalization
 * v1.6.3.10-v9 - FIX Issue E: Tighten parsing rules with rejection reason codes (refactored)
 * Converts string representations of numbers back to numeric type and validates
 * that the result is a valid positive integer (browser tab IDs are always positive >= 1).
 *
 * Note: Browser tab IDs in Firefox/Chrome are always positive integers starting from 1.
 * The value 0 is never a valid tab ID - background pages and extension pages return
 * undefined/null when querying for tab ID, not 0.
 *
 * @param {*} value - Value to normalize (may be number, string, null, undefined)
 * @param {string} [context='unknown'] - Context for logging (e.g., function name)
 * @returns {number|null} Normalized numeric tab ID or null if invalid
 */
export function normalizeOriginTabId(value, context = 'unknown') {
  // Handle null/undefined early
  if (value === null || value === undefined) {
    _logTabIdRejection(context, value, NORMALIZATION_REJECTION_REASON.NULLISH);
    return null;
  }

  const originalType = typeof value;

  // Validate string format before conversion
  if (originalType === 'string') {
    const stringError = _validateStringTabId(value, context);
    if (stringError) return null;
  }

  // Attempt numeric conversion
  const numericValue = Number(value);

  // Validate numeric result
  const numericError = _validateNumericTabId(numericValue, context, value, originalType);
  if (numericError) return null;

  // Log type conversion if one occurred (string → number)
  if (originalType === 'string') {
    console.log('[StorageUtils] normalizeOriginTabId: Type conversion (string→number)', {
      context, originalValue: value, normalizedValue: numericValue
    });
  }

  return numericValue;
}

/**
 * Normalize originContainerId to ensure type safety
 * v1.6.3.10-v6 - FIX Issue #13: Complete originContainerId implementation for Firefox Multi-Account Containers
 * Validates that the value is a non-empty string (container IDs are strings like "firefox-default").
 *
 * Note: Firefox Multi-Account Container IDs are strings:
 * - "firefox-default" for no container (default)
 * - "firefox-container-1", "firefox-container-2", etc. for containers
 * - "firefox-private" for private browsing
 *
 * @param {*} value - Value to normalize (may be string, null, undefined)
 * @param {string} [context='unknown'] - Context for logging (e.g., function name)
 * @returns {string|null} Normalized container ID string or null if invalid
 */
export function normalizeOriginContainerId(value, context = 'unknown') {
  // Handle null/undefined early
  if (value === null || value === undefined) {
    return null;
  }

  // Container IDs must be non-empty strings
  if (typeof value !== 'string') {
    console.warn('[StorageUtils] normalizeOriginContainerId: Invalid type (expected string)', {
      context,
      originalValue: value,
      originalType: typeof value,
      result: null
    });
    return null;
  }

  // Reject empty strings
  const trimmedValue = value.trim();
  if (trimmedValue === '') {
    console.warn('[StorageUtils] normalizeOriginContainerId: Empty string rejected', {
      context,
      originalValue: value,
      result: null
    });
    return null;
  }

  // Valid container ID - return trimmed value
  return trimmedValue;
}

/**
 * Check if container IDs match for ownership validation
 * v1.6.3.10-v6 - FIX Code Review: Extract duplicated container matching logic
 * v1.6.3.10-v9 - FIX Issue G: Fail-closed when identity is unknown (INITIALIZING mode)
 * v1.6.3.10-v10 - FIX Gap 5.2: Container match logging with fallback detection
 * If originContainerId is null, this is a legacy Quick Tab created before v1.6.3.10-v4
 * Allow these to be modified by any tab that matches the originTabId (backwards compatibility)
 * @private
 * @param {string|null} normalizedOriginContainerId - Normalized origin container ID
 * @param {string|null} currentContainerId - Current tab's container ID
 * @returns {boolean} True if containers match (or legacy fallback applies)
 */
function _isContainerMatch(normalizedOriginContainerId, currentContainerId) {
  // Legacy Quick Tab (null originContainerId) - always matches (LEGACY_FALLBACK mode)
  if (normalizedOriginContainerId === null) {
    // v1.6.3.10-v10 - FIX Gap 5.2: Log legacy fallback with clear indication
    console.log('[ContainerFilter] MATCH_RESULT:', {
      originContainerId: 'NULL (legacy)',
      currentContainerId: currentContainerId ?? 'UNKNOWN',
      result: true,
      matchRule: 'LEGACY_FALLBACK',
      identityStateMode,
      explanation: 'Legacy Quick Tab (pre-v4) without originContainerId - allowing match'
    });
    return true;
  }
  
  // v1.6.3.10-v9 - FIX Issue G: Current container unknown - FAIL-CLOSED in INITIALIZING mode
  if (currentContainerId === null) {
    // v1.6.3.10-v10 - FIX Gap 5.2: Log fail-closed with warning
    console.warn('[ContainerFilter] MATCH_RESULT:', {
      originContainerId: normalizedOriginContainerId,
      currentContainerId: 'UNKNOWN',
      result: false,
      matchRule: 'FAIL_CLOSED',
      identityStateMode,
      warning: 'Using fallback during identity-not-ready window',
      explanation: 'Current container unknown - blocking to prevent cross-container leakage'
    });
    return false;
  }
  
  // Both have values - compare them
  const result = normalizedOriginContainerId === currentContainerId;
  // v1.6.3.10-v10 - FIX Gap 5.2: Log strict comparison result
  console.log('[ContainerFilter] MATCH_RESULT:', {
    originContainerId: normalizedOriginContainerId,
    currentContainerId,
    result,
    matchRule: result ? 'STRICT_MATCH' : 'MISMATCH',
    identityStateMode
  });
  return result;
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
 * Log warning if heuristics conflict
 * v1.6.3.10-v10 - FIX Issue T: Extracted to reduce isSelfWrite complexity
 * v1.6.3.10-v10 - FIX Gap 8.1: Heuristic match attribution
 * @private
 */
function _logHeuristicConflict(newValue, currentTabId, heuristicsMatched) {
  const matched = Object.entries(heuristicsMatched).filter(([, v]) => v).map(([k]) => k);
  const unmatched = Object.entries(heuristicsMatched).filter(([, v]) => !v).map(([k]) => k);
  
  // Only warn if we have both matches and non-matches (actual conflict)
  if (matched.length > 0 && unmatched.length > 0) {
    // v1.6.3.10-v10 - FIX Gap 8.1: Detailed heuristic conflict logging
    console.warn('[SelfWrite] HEURISTIC_CONFLICT:', {
      transactionId: newValue.transactionId,
      writingInstanceId: newValue.writingInstanceId,
      writingTabId: newValue.writingTabId,
      currentTabId: currentTabId ?? currentWritingTabId,
      ourInstanceId: WRITING_INSTANCE_ID,
      ourLastTransactionId: lastWrittenTransactionId,
      heuristicsMatched,
      matchedHeuristics: matched,
      unmatchedHeuristics: unmatched,
      priorityOrder: 'transactionId(1) > instanceId(2) > tabId(3)',
      decision: 'Using highest-priority match'
    });
  }
}

/**
 * Check heuristics and return self-write detection result
 * v1.6.3.10-v10 - FIX Issue T: Extracted to reduce isSelfWrite complexity
 * v1.6.3.10-v10 - FIX Gap 8.1: Log all heuristic evaluations for diagnostics
 * @private
 */
function _checkSelfWriteHeuristics(newValue, currentTabId) {
  const heuristicsMatched = {
    transactionId: _isMatchingTransactionId(newValue.transactionId),
    instanceId: _isMatchingInstanceId(newValue.writingInstanceId),
    tabId: _isMatchingTabId(newValue.writingTabId, currentTabId)
  };
  
  const matchCount = Object.values(heuristicsMatched).filter(Boolean).length;
  
  // v1.6.3.10-v10 - FIX Gap 8.1: Log all heuristic evaluations
  console.log('[SelfWrite] HEURISTICS_EVALUATED:', {
    incoming: {
      transactionId: newValue.transactionId,
      instanceId: newValue.writingInstanceId,
      tabId: newValue.writingTabId
    },
    local: {
      transactionId: lastWrittenTransactionId,
      instanceId: WRITING_INSTANCE_ID,
      tabId: currentTabId ?? currentWritingTabId
    },
    matches: heuristicsMatched,
    matchCount,
    isSelfWrite: matchCount > 0
  });
  
  // Check for conflicts (some match, some don't)
  if (matchCount > 0 && matchCount < 3) {
    _logHeuristicConflict(newValue, currentTabId, heuristicsMatched);
  }
  
  return heuristicsMatched;
}

/**
 * Check if a storage change is a self-write (from this tab/instance)
 * v1.6.3.5-v3 - FIX Diagnostic Issue #1: Skip processing of self-writes
 * v1.6.3.6-v2 - FIX Issue #1: Add lastWrittenTransactionId check for deterministic detection
 * v1.6.3.6-v2 - Refactored: Extracted helpers to reduce complexity
 * v1.6.3.10-v10 - FIX Issue T: Document priority order and log which heuristics matched
 * v1.6.3.10-v10 - FIX Gap 8.1: Heuristic match attribution logging
 * 
 * HEURISTIC PRIORITY ORDER (Issue T):
 * 1. transactionId - HIGHEST: Most deterministic, matches specific write operation
 * 2. instanceId - MEDIUM: Unique per tab load, survives across tab navigations
 * 3. tabId - LOWEST: Can match after page reload with different instance
 * 
 * @param {Object} newValue - New storage value with writingTabId/writingInstanceId
 * @param {number|null} currentTabId - Current tab's ID (optional, uses cached if null)
 * @returns {boolean} True if this is a self-write that should be skipped
 */
export function isSelfWrite(newValue, currentTabId = null) {
  if (!newValue) return false;

  const heuristicsMatched = _checkSelfWriteHeuristics(newValue, currentTabId);

  // v1.6.3.10-v10 - FIX Gap 8.1: Log which heuristic determined the result
  if (heuristicsMatched.transactionId) {
    console.log('[SelfWrite] DETECTED (matched: transactionId):', {
      matchedBy: 'transactionId',
      priority: 1,
      transactionId: newValue.transactionId,
      allMatches: heuristicsMatched
    });
    return true;
  }

  if (heuristicsMatched.instanceId) {
    console.log('[SelfWrite] DETECTED (matched: instanceId):', {
      matchedBy: 'instanceId',
      priority: 2,
      instanceId: WRITING_INSTANCE_ID,
      allMatches: heuristicsMatched
    });
    return true;
  }

  if (heuristicsMatched.tabId) {
    console.log('[SelfWrite] DETECTED (matched: tabId):', {
      matchedBy: 'tabId',
      priority: 3,
      tabId: currentTabId ?? currentWritingTabId,
      allMatches: heuristicsMatched
    });
    return true;
  }

  return false;
}

/**
 * Check if this tab is the owner of a Quick Tab (has originTabId AND originContainerId matching current tab)
 * v1.6.3.5-v4 - FIX Diagnostic Issue #1: Per-tab ownership enforcement
 * v1.6.3.10-v6 - FIX Diagnostic Issue #7, #8: Use normalizeOriginTabId for type safety,
 *   add detailed logging showing comparison values, types, and result
 * v1.6.3.10-v6 - FIX Issue #13: Also compare originContainerId for Firefox Multi-Account Container isolation
 *   - Both originTabId AND originContainerId must match for ownership
 *   - If originContainerId is null/undefined, that's a legacy Quick Tab - allow it (fallback behavior)
 * @param {Object} tabData - Quick Tab data with originTabId and originContainerId
 * @param {number|null} currentTabId - Current tab's ID (optional, uses cached if null)
 * @param {string|null} currentContainerId - Current tab's container ID (optional, uses cached if null)
 * @returns {boolean} True if this tab is the owner (can modify), false otherwise
 */
export function canCurrentTabModifyQuickTab(tabData, currentTabId = null, currentContainerId = null) {
  // Get current tab ID and container ID
  const tabId = currentTabId ?? currentWritingTabId;
  const containerId = currentContainerId ?? currentWritingContainerId;

  // v1.6.3.10-v6 - FIX Issue #7: Normalize originTabId for type safety
  const normalizedOriginTabId = normalizeOriginTabId(
    tabData.originTabId,
    'canCurrentTabModifyQuickTab'
  );

  // v1.6.3.10-v6 - FIX Issue #13: Normalize originContainerId for type safety
  const normalizedOriginContainerId = normalizeOriginContainerId(
    tabData.originContainerId,
    'canCurrentTabModifyQuickTab'
  );

  // If we don't have originTabId, we can't determine ownership - allow write
  if (normalizedOriginTabId === null) {
    // v1.6.3.10-v6 - FIX Issue #8: Log when ownership check is bypassed due to null originTabId
    console.log('[StorageUtils] canCurrentTabModifyQuickTab: Ownership check bypassed', {
      quickTabId: tabData.id,
      originTabId: tabData.originTabId,
      originTabIdType: typeof tabData.originTabId,
      normalizedOriginTabId,
      originContainerId: tabData.originContainerId,
      normalizedOriginContainerId,
      reason: 'originTabId is null or invalid'
    });
    return true;
  }

  // If we don't know our tab ID, allow write (can't validate)
  if (tabId === null) {
    console.log('[StorageUtils] canCurrentTabModifyQuickTab: Ownership check bypassed', {
      quickTabId: tabData.id,
      normalizedOriginTabId,
      currentTabId: tabId,
      normalizedOriginContainerId,
      currentContainerId: containerId,
      reason: 'currentTabId is null'
    });
    return true;
  }

  // v1.6.3.10-v6 - FIX Issue #13: Check tab ID match first
  const isTabIdMatch = normalizedOriginTabId === tabId;

  // v1.6.3.10-v6 - FIX Issue #13: Check container ID match using helper
  // v1.6.3.10-v6 - FIX Code Review: Use _isContainerMatch helper to reduce duplication
  const isContainerMatchResult = _isContainerMatch(normalizedOriginContainerId, containerId);

  // v1.6.3.10-v6 - FIX Issue #13: Both must match for ownership
  const isOwner = isTabIdMatch && isContainerMatchResult;

  // v1.6.3.10-v6 - FIX Issue #8: Log comparison values, types, and result including container info
  console.log('[StorageUtils] canCurrentTabModifyQuickTab: Ownership comparison', {
    quickTabId: tabData.id,
    // Tab ID comparison
    originTabIdRaw: tabData.originTabId,
    originTabIdRawType: typeof tabData.originTabId,
    normalizedOriginTabId,
    normalizedOriginTabIdType: typeof normalizedOriginTabId,
    currentTabId: tabId,
    currentTabIdType: typeof tabId,
    isTabIdMatch,
    // Container ID comparison (v1.6.3.10-v6)
    originContainerIdRaw: tabData.originContainerId,
    normalizedOriginContainerId,
    currentContainerId: containerId,
    isContainerMatch: isContainerMatchResult,
    isLegacyQuickTab: normalizedOriginContainerId === null,
    // Final result
    comparisonResult: isOwner,
    operator: 'tabId === && containerId ==='
  });

  return isOwner;
}

// Legacy alias for backwards compatibility
export const isOwnerOfQuickTab = canCurrentTabModifyQuickTab;

/**
 * Determine the ownership filter reason for a tab
 * v1.6.3.10-v10 - FIX Issue K: Add filter reason codes for diagnostics
 * @private
 * @param {number|null} normalizedOriginTabId - Normalized origin tab ID
 * @param {string|null} normalizedOriginContainerId - Normalized origin container ID
 * @param {number} currentTabId - Current tab ID
 * @param {string|null} currentContainerId - Current container ID
 * @param {boolean} isTabIdMatch - Whether tab IDs match
 * @param {boolean} isContainerMatch - Whether containers match
 * @returns {string} Ownership filter reason code
 */
function _determineOwnershipFilterReason(
  normalizedOriginTabId,
  normalizedOriginContainerId,
  currentTabId,
  currentContainerId,
  isTabIdMatch,
  isContainerMatch
) {
  // No ownership data - can't determine ownership
  if (normalizedOriginTabId === null) {
    return OWNERSHIP_FILTER_REASON.NO_OWNERSHIP_DATA;
  }
  
  // Legacy Quick Tab (no container info) - use legacy fallback
  if (normalizedOriginContainerId === null && isTabIdMatch) {
    return OWNERSHIP_FILTER_REASON.LEGACY_FALLBACK;
  }
  
  // Both match - strict match
  if (isTabIdMatch && isContainerMatch) {
    return OWNERSHIP_FILTER_REASON.STRICT_MATCH;
  }
  
  // Tab ID doesn't match
  if (!isTabIdMatch) {
    return OWNERSHIP_FILTER_REASON.TABID_MISMATCH;
  }
  
  // Container doesn't match
  if (!isContainerMatch) {
    return OWNERSHIP_FILTER_REASON.CONTAINER_MISMATCH;
  }
  
  // Default (should not reach here)
  return OWNERSHIP_FILTER_REASON.ORPHAN_POLICY;
}

/**
 * Filter tabs to only those owned by the specified tab ID and container ID
 * v1.6.3.6-v2 - Extracted from validateOwnershipForWrite to reduce complexity
 * v1.6.3.10-v6 - FIX Diagnostic Issue #7, #8: Use normalizeOriginTabId for type safety,
 *   add per-tab logging showing originTabId value, type, currentTabId, and comparison result
 * v1.6.3.10-v6 - FIX Issue #13: Also filter by originContainerId for Firefox Multi-Account Container isolation
 *   - Both originTabId AND originContainerId must match for ownership
 *   - If originContainerId is null, that's a legacy Quick Tab - allow it if originTabId matches
 * v1.6.3.10-v10 - FIX Issue K: Add ownership filter reason codes for diagnostics
 * @private
 * @param {Array} tabs - Array of Quick Tab data objects
 * @param {number} tabId - Current tab ID to filter by
 * @param {string|null} containerId - Current container ID to filter by (optional)
 * @returns {Array} Filtered array of owned tabs
 */
function _filterOwnedTabs(tabs, tabId, containerId = null) {
  // v1.6.3.10-v6 - FIX Issue #13: Get normalized container ID for comparison
  const normalizedCurrentContainerId = normalizeOriginContainerId(containerId, '_filterOwnedTabs');

  return tabs.filter(tab => {
    // v1.6.3.10-v6 - FIX Issue #7: Normalize originTabId for type safety
    const normalizedOriginTabId = normalizeOriginTabId(tab.originTabId, '_filterOwnedTabs');

    // v1.6.3.10-v6 - FIX Issue #13: Normalize originContainerId for type safety
    const normalizedOriginContainerId = normalizeOriginContainerId(tab.originContainerId, '_filterOwnedTabs');

    // No originTabId means we can't determine ownership - include it
    if (normalizedOriginTabId === null) {
      // v1.6.3.10-v10 - FIX Issue K: Log ownership check with reason code
      console.log('[StorageUtils] _filterOwnedTabs: Tab included (no ownership)', {
        quickTabId: tab.id,
        originTabIdRaw: tab.originTabId,
        originTabIdRawType: typeof tab.originTabId,
        normalizedOriginTabId,
        originContainerIdRaw: tab.originContainerId,
        normalizedOriginContainerId,
        currentTabId: tabId,
        currentContainerId: normalizedCurrentContainerId,
        included: true,
        filterReason: OWNERSHIP_FILTER_REASON.NO_OWNERSHIP_DATA,
        reason: 'originTabId is null or invalid'
      });
      return true;
    }

    // v1.6.3.10-v6 - FIX Issue #13: Check tab ID match
    const isTabIdMatch = normalizedOriginTabId === tabId;

    // v1.6.3.10-v6 - FIX Issue #13: Check container ID match using helper
    // v1.6.3.10-v6 - FIX Code Review: Use _isContainerMatch helper to reduce duplication
    const isContainerMatchResult = _isContainerMatch(normalizedOriginContainerId, normalizedCurrentContainerId);

    // v1.6.3.10-v6 - FIX Issue #13: Both must match for ownership
    const isOwned = isTabIdMatch && isContainerMatchResult;
    
    // v1.6.3.10-v10 - FIX Issue K: Determine filter reason for diagnostics
    const filterReason = _determineOwnershipFilterReason(
      normalizedOriginTabId,
      normalizedOriginContainerId,
      tabId,
      normalizedCurrentContainerId,
      isTabIdMatch,
      isContainerMatchResult
    );

    // v1.6.3.10-v10 - FIX Issue K: Enhanced logging with ownership match type
    console.log('[StorageUtils] _filterOwnedTabs: Tab ownership check', {
      quickTabId: tab.id,
      // Tab ID comparison
      originTabIdRaw: tab.originTabId,
      originTabIdRawType: typeof tab.originTabId,
      normalizedOriginTabId,
      normalizedOriginTabIdType: typeof normalizedOriginTabId,
      currentTabId: tabId,
      currentTabIdType: typeof tabId,
      isTabIdMatch,
      // Container ID comparison (v1.6.3.10-v6)
      originContainerIdRaw: tab.originContainerId,
      normalizedOriginContainerId,
      currentContainerId: normalizedCurrentContainerId,
      isContainerMatch: isContainerMatchResult,
      isLegacyQuickTab: normalizedOriginContainerId === null,
      // v1.6.3.10-v10 - FIX Issue K: Include filter reason
      filterReason,
      matchType: isOwned ? filterReason : 'FILTERED_OUT',
      // Final result
      comparisonResult: isOwned,
      included: isOwned
    });

    return isOwned;
  });
}

/**
 * Log ownership filtering decision
 * v1.6.3.6-v2 - Extracted from validateOwnershipForWrite to reduce complexity
 * v1.6.3.10-v5 - FIX Diagnostic Issue #3: Enhanced logging with filtered tab details
 * v1.6.3.10-v6 - FIX Diagnostic Issue #8: Enhanced logging with type information for originTabId
 * v1.6.3.10-v6 - FIX Issue #13: Include container ID information in logging
 * @private
 * @param {Array} tabs - All tabs being filtered
 * @param {Array} ownedTabs - Tabs that passed ownership filter
 * @param {number} tabId - Current tab ID
 * @param {string|null} containerId - Current container ID
 */
function _logOwnershipFiltering(tabs, ownedTabs, tabId, containerId = null) {
  const nonOwnedCount = tabs.length - ownedTabs.length;
  const normalizedCurrentContainerId = normalizeOriginContainerId(containerId, '_logOwnershipFiltering');

  // v1.6.3.10-v6 - FIX Issue #13: Filter tabs considering both tab ID and container ID
  const filteredTabs = tabs.filter(t => {
    const normalizedOriginTabId = normalizeOriginTabId(t.originTabId, '_logOwnershipFiltering');
    const normalizedOriginContainerId = normalizeOriginContainerId(t.originContainerId, '_logOwnershipFiltering');

    // If originTabId is null, tab is included (legacy), so not filtered out
    if (normalizedOriginTabId === null) return false;

    // Check tab ID match
    const isTabIdMatch = normalizedOriginTabId === tabId;

    // Check container ID match (legacy Quick Tabs with null originContainerId always match)
    let isContainerMatch = true;
    if (normalizedOriginContainerId !== null && normalizedCurrentContainerId !== null) {
      isContainerMatch = normalizedOriginContainerId === normalizedCurrentContainerId;
    }

    // Tab is filtered out if it doesn't match both
    return !(isTabIdMatch && isContainerMatch);
  });

  // v1.6.3.10-v5 - FIX Diagnostic Issue #3: Always log filtering decision for traceability
  // v1.6.3.10-v6 - FIX Diagnostic Issue #8: Include type information
  // v1.6.3.10-v6 - FIX Issue #13: Include container ID information
  console.log('[StorageUtils] v1.6.3.10-v6 Ownership filtering:', {
    currentTabId: tabId,
    currentTabIdType: typeof tabId,
    currentContainerId: normalizedCurrentContainerId,
    totalTabs: tabs.length,
    ownedTabs: ownedTabs.length,
    filteredOut: nonOwnedCount,
    // v1.6.3.10-v5 - FIX Diagnostic Issue #3: Include which tabs filtered out and originTabId values
    // v1.6.3.10-v6 - FIX Diagnostic Issue #8: Include type information for each tab
    // v1.6.3.10-v6 - FIX Issue #13: Include container ID information
    filteredTabDetails:
      filteredTabs.length > 0
        ? filteredTabs.map(t => ({
            quickTabId: t.id,
            originTabIdRaw: t.originTabId,
            originTabIdType: typeof t.originTabId,
            originTabIdNormalized: normalizeOriginTabId(t.originTabId, '_logOwnershipFiltering'),
            originContainerId: t.originContainerId,
            originContainerIdNormalized: normalizeOriginContainerId(t.originContainerId, '_logOwnershipFiltering'),
            url: t.url?.substring(0, 50) + (t.url?.length > 50 ? '...' : '')
          }))
        : [],
    // v1.6.3.10-v5 - FIX Diagnostic Issue #3: Include owned tab IDs for correlation
    ownedTabIds: ownedTabs.map(t => t.id)
  });
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
 * v1.6.3.10-v6 - FIX Issue #13: Add currentContainerId parameter for Firefox Multi-Account Container isolation
 * @param {Array} tabs - Array of Quick Tab data objects
 * @param {number|null} currentTabId - Current tab's ID
 * @param {boolean} forceEmpty - Whether this is an intentional empty write (e.g., Close All)
 * @param {string|null} currentContainerId - Current tab's container ID (optional, uses cached if null)
 * @returns {{ shouldWrite: boolean, ownedTabs: Array, reason: string }}
 */
export function validateOwnershipForWrite(tabs, currentTabId = null, forceEmpty = false, currentContainerId = null) {
  if (!ownershipValidationEnabled) {
    return { shouldWrite: true, ownedTabs: tabs, reason: 'ownership validation disabled' };
  }

  if (!Array.isArray(tabs)) {
    return { shouldWrite: true, ownedTabs: [], reason: 'invalid tabs array' };
  }

  const tabId = currentTabId ?? currentWritingTabId;
  // v1.6.3.10-v6 - FIX Issue #13: Get container ID for filtering
  const containerId = currentContainerId ?? currentWritingContainerId;

  // v1.6.3.6-v3 - FIX Issue #1: Block writes with unknown tab ID (fail-closed approach)
  // v1.6.3.10-v7 - FIX Diagnostic Issue #1, #2, #14: Enhanced logging showing which check failed
  // Previously this allowed writes with unknown tab ID, which caused:
  // - Self-write detection to fail (isSelfWrite returns false)
  // - Empty state corruption from non-owner tabs
  // Now we block writes until tab ID is initialized
  if (tabId === null) {
    // v1.6.3.10-v7 - FIX Issue #14: Specific diagnostic log showing currentTabId check failed
    console.warn('[StorageUtils] Storage write BLOCKED - DUAL-BLOCK CHECK FAILED:', {
      checkFailed: 'currentTabId is null',
      currentWritingTabId,
      passedTabId: currentTabId,
      resolvedTabId: tabId,
      tabCount: tabs.length,
      forceEmpty,
      currentContainerId: containerId,
      isWritingTabIdInitialized: currentWritingTabId !== null,
      suggestion:
        'Pass tabId parameter to persistStateToStorage() or wait for initWritingTabId() to complete'
    });
    return { shouldWrite: false, ownedTabs: [], reason: 'unknown tab ID - blocked for safety (currentTabId null)' };
  }

  // v1.6.3.10-v6 - FIX Issue #13: Filter by both tab ID and container ID
  const ownedTabs = _filterOwnedTabs(tabs, tabId, containerId);
  _logOwnershipFiltering(tabs, ownedTabs, tabId, containerId);

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
 * v1.6.3.10-v10 - FIX Issue J: Add correlation ID logging at INFO level
 *
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<boolean>} True if transaction started, false if already active
 */
export async function beginTransaction(logPrefix = '[StorageUtils]') {
  // v1.6.3.10-v10 - FIX Issue J: Generate correlation ID for transaction tracking
  const correlationId = `txn-begin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  if (transactionActive) {
    console.warn(`${logPrefix} v1.6.3.10-v10 Transaction BEGIN BLOCKED - nested transaction attempt`, {
      correlationId,
      existingCorrelationId: currentTransactionCorrelationId,
      reason: 'nested transactions not supported'
    });
    return false;
  }

  transactionActive = true;
  currentTransactionCorrelationId = correlationId;
  
  console.info(`${logPrefix} v1.6.3.10-v10 Transaction BEGIN`, {
    correlationId,
    phase: 'capturing_snapshot'
  });
  
  const snapshot = await captureStateSnapshot(logPrefix);

  if (!snapshot) {
    console.error(`${logPrefix} v1.6.3.10-v10 Transaction BEGIN FAILED - snapshot capture error`, {
      correlationId,
      reason: 'could not capture snapshot'
    });
    transactionActive = false;
    currentTransactionCorrelationId = null;
    return false;
  }

  console.info(`${logPrefix} v1.6.3.10-v10 Transaction BEGIN SUCCESS`, {
    correlationId,
    snapshotTabCount: snapshot.tabs?.length ?? 0,
    snapshotTimestamp: snapshot.timestamp
  });
  return true;
}

/**
 * Commit current transaction - clears snapshot and marks transaction complete
 * v1.6.3.4-v9 - FIX Issue #17: Transaction pattern with BEGIN/COMMIT/ROLLBACK
 * v1.6.3.10-v10 - FIX Issue J: Add correlation ID logging at INFO level
 *
 * @param {string} logPrefix - Prefix for log messages
 * @returns {boolean} True if committed, false if no active transaction
 */
export function commitTransaction(logPrefix = '[StorageUtils]') {
  const correlationId = currentTransactionCorrelationId;
  
  if (!transactionActive) {
    console.warn(`${logPrefix} v1.6.3.10-v10 Transaction COMMIT BLOCKED - no active transaction`, {
      correlationId: correlationId ?? 'none',
      reason: 'no active transaction to commit'
    });
    return false;
  }

  const snapshotTabCount = stateSnapshot?.tabs?.length ?? 0;
  stateSnapshot = null;
  transactionActive = false;
  currentTransactionCorrelationId = null;
  
  console.info(`${logPrefix} v1.6.3.10-v10 Transaction COMMIT SUCCESS`, {
    correlationId,
    clearedSnapshotTabCount: snapshotTabCount
  });
  return true;
}

/**
 * Rollback current transaction - restores state snapshot to storage
 * v1.6.3.4-v9 - FIX Issue #16, #17: Rollback on failure instead of writing empty state
 * v1.6.3.10-v10 - FIX Issue J: Add correlation ID logging at INFO level
 * 
 * NOTE (v1.6.3.10-v9 - Issue V): This function is currently not called in any code path.
 * It was designed for error recovery but the current architecture uses queue reset instead.
 * KEPT FOR FUTURE USE: Could be integrated into _executeStorageWrite() error handling
 * to provide atomic rollback capability for failed multi-step transactions.
 * 
 * ROLLBACK POLICY (v1.6.3.10-v10 - Issue J):
 * - TRIGGERS: Could be triggered after all write retries fail in _executeStorageWrite()
 * - RESTORES: The state snapshot captured at beginTransaction() time
 * - PREVENTS RE-TRIGGER: Use transactionActive flag - rollback clears it, preventing cascade
 * - INTEGRATION POINT: In _handleFailedWrite() after STORAGE_MAX_RETRIES exhausted
 * 
 * Potential integration point: In _executeStorageWrite() after all retries fail,
 * could call rollbackTransaction() to restore previous known-good state.
 *
 * @param {string} logPrefix - Prefix for log messages
 * @param {string} [reason='unspecified'] - Reason for rollback (for logging)
 * @returns {Promise<boolean>} True if rollback succeeded, false on error
 */
export async function rollbackTransaction(logPrefix = '[StorageUtils]', reason = 'unspecified') {
  const correlationId = currentTransactionCorrelationId;
  
  if (!transactionActive) {
    console.warn(`${logPrefix} v1.6.3.10-v10 Transaction ROLLBACK BLOCKED - no active transaction`, {
      correlationId: correlationId ?? 'none',
      reason: 'no active transaction to rollback',
      triggerReason: reason
    });
    return false;
  }

  if (!stateSnapshot) {
    console.error(`${logPrefix} v1.6.3.10-v10 Transaction ROLLBACK FAILED - no snapshot`, {
      correlationId,
      reason: 'no snapshot available',
      triggerReason: reason
    });
    transactionActive = false;
    currentTransactionCorrelationId = null;
    return false;
  }

  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    console.error(`${logPrefix} v1.6.3.10-v10 Transaction ROLLBACK FAILED - no storage API`, {
      correlationId,
      reason: 'storage API unavailable',
      triggerReason: reason
    });
    transactionActive = false;
    currentTransactionCorrelationId = null;
    return false;
  }

  const snapshotTabCount = stateSnapshot.tabs?.length ?? 0;
  
  console.info(`${logPrefix} v1.6.3.10-v10 Transaction ROLLBACK INITIATED`, {
    correlationId,
    triggerReason: reason,
    restoringTabCount: snapshotTabCount,
    snapshotTimestamp: stateSnapshot.timestamp
  });

  try {
    await browserAPI.storage.local.set({ [STATE_KEY]: stateSnapshot });

    stateSnapshot = null;
    transactionActive = false;
    currentTransactionCorrelationId = null;
    
    console.info(`${logPrefix} v1.6.3.10-v10 Transaction ROLLBACK SUCCESS`, {
      correlationId,
      triggerReason: reason,
      restoredTabCount: snapshotTabCount
    });
    return true;
  } catch (err) {
    console.error(`${logPrefix} v1.6.3.10-v10 Transaction ROLLBACK ERROR`, {
      correlationId,
      triggerReason: reason,
      error: err.message,
      snapshotTabCount
    });
    transactionActive = false;
    currentTransactionCorrelationId = null;
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
 * v1.6.3.10-v5 - FIX Issue #8: Higher entropy - include tabId, wrap counter, use crypto
 * v1.6.3.10-v9 - FIX Issue L: Label transaction ID when identity is unknown
 * Format: 'txn-timestamp-tabId-counter-random8chars' or 'txn-timestamp-UNKNOWN-counter-random8chars'
 *
 * @returns {string} Unique transaction ID
 */
export function generateTransactionId() {
  // v1.6.3.10-v5 - FIX Issue #8: Wrap counter to prevent overflow
  writeCounter = (writeCounter + 1) % COUNTER_WRAP_LIMIT;

  // v1.6.3.10-v9 - FIX Issue L: Label when identity is unknown
  // Using UNKNOWN_TAB_ID_LABEL makes debugging easier when tab ID wasn't initialized
  const tabId = currentWritingTabId ?? UNKNOWN_TAB_ID_LABEL;
  
  // v1.6.3.10-v9 - FIX Issue L: Log warning if generating transaction ID before identity is ready
  if (currentWritingTabId === null) {
    console.warn('[StorageUtils] v1.6.3.10-v9 generateTransactionId: Identity not initialized', {
      tabId,
      identityStateMode,
      warning: 'Transaction ID generated before tab ID initialized'
    });
  }

  // v1.6.3.10-v5 - FIX Issue #8: Use crypto.getRandomValues for higher entropy
  let randomPart;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(4);
    crypto.getRandomValues(array);
    randomPart = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  } else {
    randomPart = Math.random().toString(36).slice(2, 10);
  }

  return `txn-${Date.now()}-${tabId}-${writeCounter}-${randomPart}`;
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
 * Serialize a single Quick Tab to storage format
 * v1.6.3.4-v2 - FIX Bug #1: Extracted to reduce complexity
 * v1.6.3.4-v3 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
 * v1.6.3.4 - FIX Issue #3: Include zIndex in serialized data for persistence
 * v1.6.3.5-v2 - FIX Report 1 Issue #2: Include originTabId for cross-tab filtering
 * v1.6.3.7 - FIX Issue #2, #7: Enhanced originTabId preservation with logging
 *   - Issue #2: Preserve originTabId during ALL state changes (minimize, resize, move)
 *   - Issue #7: Log originTabId extraction for debugging adoption data flow
 * v1.6.4.8 - FIX CodeScene: Updated to use options object for _getNumericValue
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {Object} Serialized tab data for storage
 */
/**
 * Determine the source field for originTabId
 * v1.6.3.10-v6 - FIX Diagnostic Issue #8: Extract to reduce _extractOriginTabId complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @returns {string} Source field name ('originTabId', 'activeTabId', or 'none')
 */
function _getOriginTabIdSourceField(tab) {
  if (tab.originTabId !== undefined && tab.originTabId !== null) {
    return 'originTabId';
  }
  if (tab.activeTabId !== undefined && tab.activeTabId !== null) {
    return 'activeTabId';
  }
  return 'none';
}

/**
 * Log extraction result for originTabId
 * v1.6.3.10-v6 - FIX Diagnostic Issue #8: Extract to reduce _extractOriginTabId complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {*} rawOriginTabId - Raw value before normalization
 * @param {number|null} normalizedOriginTabId - Normalized value
 */
function _logOriginTabIdExtractionResult(tab, rawOriginTabId, normalizedOriginTabId) {
  const typeConversionOccurred =
    typeof rawOriginTabId !== typeof normalizedOriginTabId && normalizedOriginTabId !== null;

  console.log('[StorageUtils] _extractOriginTabId: Extraction completed', {
    quickTabId: tab.id,
    rawOriginTabId,
    rawOriginTabIdType: typeof rawOriginTabId,
    normalizedOriginTabId,
    normalizedOriginTabIdType: typeof normalizedOriginTabId,
    typeConversionOccurred,
    action: 'serialize',
    result: normalizedOriginTabId === null ? 'null' : 'valid'
  });
}

/**
 * Log warning when originTabId is null
 * v1.6.3.10-v6 - FIX Diagnostic Issue #8: Extract to reduce _extractOriginTabId complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {*} rawOriginTabId - Raw value before normalization
 */
function _logNullOriginTabIdWarning(tab, rawOriginTabId) {
  const hasOriginTabId = tab.originTabId !== undefined && tab.originTabId !== null;
  const hasActiveTabId = tab.activeTabId !== undefined && tab.activeTabId !== null;

  console.warn('[StorageUtils] ADOPTION_FLOW: serializeTabForStorage - originTabId is NULL', {
    quickTabId: tab.id,
    rawOriginTabId,
    rawOriginTabIdType: typeof rawOriginTabId,
    normalizedOriginTabId: null,
    hasOriginTabId,
    hasActiveTabId,
    action: 'serialize',
    result: 'null'
  });
}

/**
 * Extract originTabId with fallback and type normalization
 * v1.6.3.10-v4 - FIX: Extract to reduce serializeTabForStorage complexity
 * v1.6.3.10-v6 - FIX Diagnostic Issues #1, #6, #8:
 *   - Use normalizeOriginTabId() for explicit numeric type casting
 *   - Validate with Number.isInteger() check
 *   - Add detailed type visibility logging showing value and typeof
 *   - Extract helpers to reduce cyclomatic complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @returns {number|null} Extracted and normalized originTabId
 */
function _extractOriginTabId(tab) {
  // Get raw value from tab (prefer originTabId, fallback to activeTabId)
  const rawOriginTabId = tab.originTabId ?? tab.activeTabId ?? null;
  const sourceField = _getOriginTabIdSourceField(tab);

  // v1.6.3.10-v6 - FIX Issue #8: Log raw value and type before normalization
  console.log('[StorageUtils] _extractOriginTabId: Extraction started', {
    quickTabId: tab.id,
    rawOriginTabId,
    rawOriginTabIdType: typeof rawOriginTabId,
    sourceField
  });

  // v1.6.3.10-v6 - FIX Issues #1, #6: Use normalizeOriginTabId for type safety
  const normalizedOriginTabId = normalizeOriginTabId(rawOriginTabId, '_extractOriginTabId');

  // v1.6.3.10-v6 - FIX Issue #8: Log the result with full type visibility
  _logOriginTabIdExtractionResult(tab, rawOriginTabId, normalizedOriginTabId);

  // Log when originTabId is problematic (null) - enhanced from v1.6.3.10-v4
  if (normalizedOriginTabId === null) {
    _logNullOriginTabIdWarning(tab, rawOriginTabId);
  }

  return normalizedOriginTabId;
}

/**
 * Determine the source field for originContainerId
 * v1.6.3.10-v6 - FIX Code Review: Extract to reduce _extractOriginContainerId complexity
 * Similar to _getOriginTabIdSourceField for consistency
 * @private
 * @param {Object} tab - Quick Tab instance
 * @returns {string} Source field name ('originContainerId', 'cookieStoreId', or 'none')
 */
function _getOriginContainerIdSourceField(tab) {
  if (tab.originContainerId !== undefined && tab.originContainerId !== null) {
    return 'originContainerId';
  }
  if (tab.cookieStoreId !== undefined && tab.cookieStoreId !== null) {
    return 'cookieStoreId';
  }
  return 'none';
}

/**
 * Extract originContainerId with proper validation
 * v1.6.3.10-v6 - FIX Issue #13: Add _extractOriginContainerId helper for Firefox Multi-Account Container isolation
 *   - Uses normalizeOriginContainerId() for validation (strings like "firefox-default")
 *   - Fallback to cookieStoreId if originContainerId not present
 *   - Adds detailed logging showing extraction source and result
 * v1.6.3.10-v6 - FIX Code Review: Use _getOriginContainerIdSourceField helper
 * @private
 * @param {Object} tab - Quick Tab instance
 * @returns {string|null} Extracted and normalized originContainerId
 */
function _extractOriginContainerId(tab) {
  // Get raw value from tab (prefer originContainerId, fallback to cookieStoreId)
  const rawOriginContainerId = tab.originContainerId ?? tab.cookieStoreId ?? null;
  // v1.6.3.10-v6 - FIX Code Review: Use helper for source field determination
  const sourceField = _getOriginContainerIdSourceField(tab);

  // v1.6.3.10-v6 - FIX Issue #13: Log raw value and type before normalization
  console.log('[StorageUtils] _extractOriginContainerId: Extraction started', {
    quickTabId: tab.id,
    rawOriginContainerId,
    rawOriginContainerIdType: typeof rawOriginContainerId,
    sourceField
  });

  // v1.6.3.10-v6 - FIX Issue #13: Use normalizeOriginContainerId for type safety
  const normalizedOriginContainerId = normalizeOriginContainerId(rawOriginContainerId, '_extractOriginContainerId');

  // v1.6.3.10-v6 - FIX Issue #13: Log the result with full type visibility
  console.log('[StorageUtils] _extractOriginContainerId: Extraction completed', {
    quickTabId: tab.id,
    rawOriginContainerId,
    rawOriginContainerIdType: typeof rawOriginContainerId,
    normalizedOriginContainerId,
    normalizedOriginContainerIdType: typeof normalizedOriginContainerId,
    sourceField,
    action: 'serialize',
    result: normalizedOriginContainerId === null ? 'null' : 'valid'
  });

  return normalizedOriginContainerId;
}

/**
 * Log serialization result
 * v1.6.3.10-v6 - FIX Diagnostic Issue #8: Extract to reduce serializeTabForStorage complexity
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {number|null} extractedOriginTabId - Extracted and normalized originTabId
 * @param {string|null} extractedOriginContainerId - Extracted container ID
 */
function _logSerializationResult(tab, extractedOriginTabId, extractedOriginContainerId) {
  const sourceField = _getOriginTabIdSourceField(tab);
  const rawOriginTabId = tab.originTabId ?? tab.activeTabId ?? null;

  console.log('[StorageUtils] serializeTabForStorage: Serialization completed', {
    quickTabId: tab.id,
    originTabIdSource: sourceField === 'originTabId'
      ? 'tab.originTabId'
      : sourceField === 'activeTabId'
        ? 'tab.activeTabId'
        : 'null',
    originTabIdRaw: rawOriginTabId,
    originTabIdRawType: typeof rawOriginTabId,
    extractedOriginTabId,
    extractedOriginTabIdType: typeof extractedOriginTabId,
    originContainerId: extractedOriginContainerId
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
 * v1.6.3.10-v4 - FIX Issue #13: Include originContainerId for Firefox Multi-Account Container isolation
 * v1.6.3.10-v6 - FIX Diagnostic Issue #8: Add logging showing originTabId source and type
 *   - Extract _logSerializationResult to reduce cyclomatic complexity
 * v1.6.4.8 - FIX CodeScene: Updated to use options object for _getNumericValue
 * @private
 * @param {Object} tab - Quick Tab instance
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {Object} Serialized tab data for storage
 */
function serializeTabForStorage(tab, isMinimized) {
  const extractedOriginTabId = _extractOriginTabId(tab);

  // v1.6.3.10-v6 - FIX Issue #13: Use _extractOriginContainerId helper for proper validation
  const extractedOriginContainerId = _extractOriginContainerId(tab);

  // v1.6.3.10-v6 - FIX Diagnostic Issue #8: Log serialization with originTabId source and type
  _logSerializationResult(tab, extractedOriginTabId, extractedOriginContainerId);

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
    originTabId: extractedOriginTabId,
    // v1.6.3.10-v4 - FIX Issue #13: Track originating container ID for Firefox Multi-Account Container isolation
    // v1.6.3.10-v6 - FIX Issue #13: Use _extractOriginContainerId for proper validation
    originContainerId: extractedOriginContainerId
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
 * v1.6.3.10-v10 - FIX Issue U: Enhanced logging showing cooldown rationale and timing
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
  const timeSinceLastEmptyWrite = now - lastEmptyWriteTime;
  
  if (timeSinceLastEmptyWrite < EMPTY_WRITE_COOLDOWN_MS) {
    // v1.6.3.10-v10 - FIX Issue U: Enhanced cooldown logging with timing correlation
    console.warn(
      `${logPrefix} v1.6.3.10-v10 EMPTY_WRITE_COOLDOWN_BLOCKED [${transactionId}]`, {
        timeSinceLastEmptyWriteMs: timeSinceLastEmptyWrite,
        cooldownMs: EMPTY_WRITE_COOLDOWN_MS,
        remainingCooldownMs: EMPTY_WRITE_COOLDOWN_MS - timeSinceLastEmptyWrite,
        lastEmptyWriteTime,
        currentTime: now,
        rationale: 'Prevents rapid-fire empty writes during page reload/tab switching storms',
        typicalPageLoadMs: '200-500 DOMContentLoaded, 500-2000 full load',
        limitation: 'May block rapid intentional Close All clicks (idempotent operation)'
      }
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
 * v1.6.3.10-v10 - FIX Issue I: Enhanced logging with timing correlation
 * @private
 * @param {string} saveId - Save ID
 * @param {Object} existing - Existing tracker entry
 * @param {string} transactionId - Current transaction ID
 * @param {number} now - Current timestamp
 */
function _logDuplicateWriteWarning(saveId, existing, transactionId, now) {
  const elapsedMs = now - existing.firstTimestamp;
  
  // v1.6.3.10-v10 - FIX Issue I: Check if elapsed time coincides with storage timeout windows
  const coincidenceFlags = {
    coincidesToStorageTimeout: elapsedMs >= STORAGE_TIMEOUT_MS && elapsedMs < STORAGE_TIMEOUT_MS * 2,
    coincidesToEscalationWarning: elapsedMs >= ESCALATION_WARNING_MS && elapsedMs < TRANSACTION_FALLBACK_CLEANUP_MS,
    coincidesToFallbackCleanup: elapsedMs >= TRANSACTION_FALLBACK_CLEANUP_MS && elapsedMs < STORAGE_TIMEOUT_MS,
    withinDedupWindow: elapsedMs <= DUPLICATE_SAVEID_WINDOW_MS
  };
  
  console.error(
    `[StorageUtils] ⚠️ DUPLICATE WRITE DETECTED: saveId "${saveId}" written ${existing.count} times in ${elapsedMs}ms`
  );
  console.error('[StorageUtils] v1.6.3.10-v10 FIX Issue I - Duplicate timing details:', {
    saveId,
    duplicateCount: existing.count,
    firstSeenTimestamp: existing.firstTimestamp,
    currentTimestamp: now,
    elapsedMs,
    storageTimeoutMs: STORAGE_TIMEOUT_MS,
    escalationWarningMs: ESCALATION_WARNING_MS,
    fallbackCleanupMs: TRANSACTION_FALLBACK_CLEANUP_MS,
    dedupWindowMs: DUPLICATE_SAVEID_WINDOW_MS,
    coincidenceFlags,
    firstTransaction: existing.firstTransaction,
    currentTransaction: transactionId
  });
  console.error(
    '[StorageUtils] This indicates a storage write loop - same saveId should not be written multiple times.'
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
 * Sleep utility for retry delays
 * v1.6.3.10-v6 - FIX Issue A20: Helper for exponential backoff
 * @private
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt a single storage write operation
 * v1.6.3.10-v6 - FIX Issue A20: Extracted from _executeStorageWrite for retry support
 * @private
 * @param {Object} browserAPI - Browser storage API
 * @param {Object} stateWithTxn - State with transaction metadata
 * @param {string} logPrefix - Log prefix
 * @param {number} attemptNumber - Current attempt (1-based)
 * @returns {Promise<boolean>} True if write succeeded
 */
async function _attemptStorageWrite(browserAPI, stateWithTxn, logPrefix, attemptNumber) {
  const timeout = createTimeoutPromise(STORAGE_TIMEOUT_MS, 'storage.local.set');

  try {
    const storagePromise = browserAPI.storage.local.set({ [STATE_KEY]: stateWithTxn });
    await Promise.race([storagePromise, timeout.promise]);
    return true;
  } catch (err) {
    console.warn(`${logPrefix} Storage write attempt ${attemptNumber} failed:`, err.message || err);
    return false;
  } finally {
    timeout.clear();
  }
}

/**
 * Handle successful storage write - update state and log
 * v1.6.3.10-v6 - FIX Issue A20: Extracted to reduce _executeStorageWrite complexity
 * @private
 * @param {string} operationId - Operation ID for logging
 * @param {string} transactionId - Transaction ID
 * @param {number} tabCount - Number of tabs written
 * @param {number} startTime - Start time for duration calculation
 * @param {number} attempt - Attempt number (1-based)
 * @param {string} logPrefix - Log prefix
 */
function _handleSuccessfulWrite(operationId, transactionId, tabCount, startTime, attempt, logPrefix) {
  const durationMs = Date.now() - startTime;

  // v1.6.3.4-v8 - Update previous tab count after successful write
  previousTabCount = tabCount;

  // v1.6.3.4-v12 - FIX Issue #6: Update last completed transaction
  lastCompletedTransactionId = transactionId;

  // v1.6.3.6-v2 - FIX Issue #1: Update lastWrittenTransactionId for self-write detection
  lastWrittenTransactionId = transactionId;

  pendingWriteCount = Math.max(0, pendingWriteCount - 1);

  // v1.6.3.6-v3 - FIX Issue #2: Reset circuit breaker if queue has drained below threshold
  _checkCircuitBreakerReset();

  // v1.6.3.6-v5 - Log storage write complete (success)
  logStorageWrite(operationId, STATE_KEY, 'complete', {
    success: true,
    tabCount,
    durationMs,
    transactionId,
    // v1.6.3.10-v6 - FIX Issue A20: Log retry attempt number
    attempt
  });

  // v1.6.3.10-v6 - FIX Issue A20: Log if retry was needed
  if (attempt > 1) {
    console.log(`${logPrefix} Storage write SUCCEEDED after ${attempt} attempts [${transactionId}]`);
  } else {
    console.log(`${logPrefix} Storage write COMPLETED [${transactionId}] (${tabCount} tabs)`);
  }
}

/**
 * Check and reset circuit breaker if queue has drained
 * v1.6.3.10-v6 - FIX Issue A20: Extracted to reduce nesting depth
 * @private
 */
function _checkCircuitBreakerReset() {
  if (circuitBreakerTripped && pendingWriteCount < CIRCUIT_BREAKER_RESET_THRESHOLD) {
    const tripDuration = Date.now() - circuitBreakerTripTime;
    circuitBreakerTripped = false;
    circuitBreakerTripTime = null;
    console.log(
      `[StorageUtils] Circuit breaker RESET - queue drained (was tripped for ${tripDuration}ms)`
    );
  }
}

/**
 * Build quota check result object
 * v1.6.3.10-v9 - FIX Issue M/D: Helper for checkStorageQuota
 * @private
 */
function _buildQuotaResult(canWrite, bytesUsed, bytesAvailable, usagePercent) {
  return { canWrite, bytesUsed, bytesAvailable, usagePercent };
}

/**
 * Log quota status if at sampling interval or above warning threshold
 * v1.6.3.10-v9 - FIX Issue M/D: Helper for checkStorageQuota
 * @private
 */
function _logQuotaStatusIfNeeded(logPrefix, bytesUsed, bytesQuota, bytesAvailable, usagePercent) {
  const shouldLog = pendingWriteCount % STORAGE_QUOTA_LOG_SAMPLING_INTERVAL === 0 || usagePercent > STORAGE_QUOTA_WARNING_THRESHOLD * 100;
  if (shouldLog) {
    console.log(`${logPrefix} v1.6.3.10-v9 Storage quota status:`, {
      bytesUsed, bytesQuota, bytesAvailable,
      usagePercent: `${usagePercent.toFixed(2)}%`,
      headroomBytes: STORAGE_QUOTA_MIN_HEADROOM_BYTES
    });
  }
}

/**
 * Check storage quota before write operation
 * v1.6.3.10-v9 - FIX Issue M/D: Preflight quota check using navigator.storage.estimate() (refactored)
 * @param {string} logPrefix - Log prefix for messages
 * @returns {Promise<{canWrite: boolean, bytesUsed: number, bytesAvailable: number, usagePercent: number}>}
 */
export async function checkStorageQuota(logPrefix = '[StorageUtils]') {
  // Check if navigator.storage.estimate is available
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return _buildQuotaResult(true, 0, Infinity, 0);
  }

  try {
    const estimate = await navigator.storage.estimate();
    const bytesUsed = estimate.usage ?? 0;
    const bytesQuota = estimate.quota ?? 0;
    const bytesAvailable = bytesQuota - bytesUsed;
    const usagePercent = bytesQuota > 0 ? (bytesUsed / bytesQuota) * 100 : 0;

    _logQuotaStatusIfNeeded(logPrefix, bytesUsed, bytesQuota, bytesAvailable, usagePercent);

    // Check if quota exceeded
    if (bytesAvailable < STORAGE_QUOTA_MIN_HEADROOM_BYTES) {
      console.error(`${logPrefix} v1.6.3.10-v9 INSUFFICIENT_STORAGE_HEADROOM`);
      return _buildQuotaResult(false, bytesUsed, bytesAvailable, usagePercent);
    }

    return _buildQuotaResult(true, bytesUsed, bytesAvailable, usagePercent);
  } catch (err) {
    console.warn(`${logPrefix} v1.6.3.10-v9 Quota check failed:`, err.message);
    return _buildQuotaResult(true, 0, Infinity, 0);
  }
}

/**
 * Initialize storage write tracking and return context
 * v1.6.3.10-v9 - FIX Issue W: Extracted from _executeStorageWrite to reduce lines
 * @private
 */
function _initStorageWriteContext(stateWithTxn, tabCount, transactionId, logPrefix) {
  const saveId = stateWithTxn.saveId;
  if (saveId) _trackDuplicateSaveIdWrite(saveId, transactionId, logPrefix);
  
  IN_PROGRESS_TRANSACTIONS.add(transactionId);
  scheduleFallbackCleanup(transactionId);
  
  const operationId = generateStorageOperationId();
  logStorageWrite(operationId, STATE_KEY, 'start', { tabCount, transactionId });
  
  return { operationId, startTime: Date.now() };
}

/**
 * Handle failed storage write after all retries
 * v1.6.3.10-v9 - FIX Issue W: Extracted from _executeStorageWrite
 * @private
 */
function _handleFailedWrite(operationId, transactionId, tabCount, startTime, totalAttempts, logPrefix) {
  const durationMs = Date.now() - startTime;
  pendingWriteCount = Math.max(0, pendingWriteCount - 1);
  logStorageWrite(operationId, STATE_KEY, 'complete', { success: false, tabCount, durationMs, transactionId, attempts: totalAttempts });
  console.error(`${logPrefix} v1.6.3.10-v9 WRITE_FAILED_AFTER_RETRIES:`, { transactionId, totalAttempts, durationMs });
}

/**
 * Execute retry loop for storage write
 * v1.6.3.10-v9 - FIX Issue W: Extracted from _executeStorageWrite
 * v1.6.3.10-v10 - FIX Gap 3.1: Add write lifecycle SUCCESS logging
 * @private
 */
async function _executeWriteRetryLoop(browserAPI, stateWithTxn, logPrefix, transactionId, context, tabCount) {
  const totalAttempts = STORAGE_MAX_RETRIES + 1;
  
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (attempt > 1) {
      // v1.6.3.10-v10 - FIX Gap 3.1: Retry attempt logging
      console.warn('[StorageWrite] LIFECYCLE_RETRY:', {
        correlationId: context.writeCorrelationId,
        transactionId,
        attemptNumber: attempt,
        totalAttempts,
        previousDelayMs: STORAGE_RETRY_DELAYS_MS[attempt - 2] || 0,
        timestamp: new Date().toISOString()
      });
    }
    
    const success = await _attemptStorageWrite(browserAPI, stateWithTxn, logPrefix, attempt);
    if (success) {
      // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle SUCCESS
      const totalDurationMs = context.writeStartTime ? Date.now() - context.writeStartTime : 0;
      console.log('[StorageWrite] LIFECYCLE_SUCCESS:', {
        correlationId: context.writeCorrelationId,
        transactionId,
        tabCount,
        attempt,
        totalAttempts,
        durationMs: totalDurationMs,
        timestamp: new Date().toISOString()
      });
      
      _handleSuccessfulWrite(context.operationId, transactionId, tabCount, context.startTime, attempt, logPrefix);
      return true;
    }
    
    // Wait before retry if more attempts remain
    if (attempt < totalAttempts && attempt - 1 < STORAGE_RETRY_DELAYS_MS.length) {
      await _sleep(STORAGE_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  
  // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle FAILURE after all retries
  const totalDurationMs = context.writeStartTime ? Date.now() - context.writeStartTime : 0;
  console.error('[StorageWrite] LIFECYCLE_FAILURE:', {
    correlationId: context.writeCorrelationId,
    transactionId,
    phase: 'ALL_RETRIES_EXHAUSTED',
    tabCount,
    totalAttempts,
    durationMs: totalDurationMs,
    timestamp: new Date().toISOString()
  });
  
  _handleFailedWrite(context.operationId, transactionId, tabCount, context.startTime, totalAttempts, logPrefix);
  return false;
}

/**
 * Perform the actual storage write operation with retry logic
 * v1.6.3.10-v6 - FIX Issue A20: Added exponential backoff retry
 * v1.6.3.10-v9 - FIX Issue M/D: Added preflight quota check (refactored)
 * v1.6.3.10-v10 - FIX Gap 3.1: Added write correlation ID and success logging
 * @private
 */
async function _executeStorageWrite(stateWithTxn, tabCount, logPrefix, transactionId, writeCorrelationId = null, startTime = null) {
  const actualStartTime = startTime || Date.now();
  const browserAPI = getBrowserStorageAPI();
  if (!browserAPI) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Log failure
    console.warn('[StorageWrite] LIFECYCLE_FAILURE:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'API_CHECK',
      reason: 'Storage API not available',
      timestamp: new Date().toISOString()
    });
    pendingWriteCount = Math.max(0, pendingWriteCount - 1);
    return false;
  }

  // Preflight quota check
  const quotaCheck = await checkStorageQuota(logPrefix);
  if (!quotaCheck.canWrite) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Log quota failure
    console.error('[StorageWrite] LIFECYCLE_FAILURE:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'QUOTA_CHECK',
      reason: 'Quota exceeded',
      quotaInfo: quotaCheck,
      timestamp: new Date().toISOString()
    });
    pendingWriteCount = Math.max(0, pendingWriteCount - 1);
    return false;
  }

  const context = _initStorageWriteContext(stateWithTxn, tabCount, transactionId, logPrefix);
  // v1.6.3.10-v10 - FIX Gap 3.1: Pass correlation ID to retry loop
  context.writeCorrelationId = writeCorrelationId;
  context.writeStartTime = actualStartTime;
  
  return _executeWriteRetryLoop(browserAPI, stateWithTxn, logPrefix, transactionId, context, tabCount);
}

/**
 * Perform queue stall recovery - reset queue and circuit breaker
 * v1.6.3.10-v9 - FIX Issue F: Helper to reduce _checkAndRecoverStalledQueue complexity
 * @private
 */
function _performQueueRecovery(logPrefix, transactionId, stallDuration, reason) {
  writeQueueRecoveryCount++;
  
  console.error(`${logPrefix} v1.6.3.10-v9 WRITE_QUEUE_STALL_RECOVERY:`, {
    transactionId, stallDurationMs: stallDuration, pendingWriteCount,
    recoveryCount: writeQueueRecoveryCount, reason, action: 'RESETTING_QUEUE'
  });
  
  // Reset queue state
  storageWriteQueuePromise = Promise.resolve();
  pendingWriteCount = 0;
  writeQueueStallStartTime = null;
  
  // Reset circuit breaker if it was tripped
  if (circuitBreakerTripped) {
    circuitBreakerTripped = false;
    circuitBreakerTripTime = null;
    console.log(`${logPrefix} v1.6.3.10-v9 Circuit breaker reset during queue recovery`);
  }
}

/**
 * Check if queue has stalled based on timeout or max pending
 * v1.6.3.10-v9 - FIX Issue F: Helper to reduce complexity
 * @private
 */
function _isQueueStalled(stallDuration) {
  return stallDuration > WRITE_QUEUE_STALL_TIMEOUT_MS || pendingWriteCount >= WRITE_QUEUE_MAX_PENDING;
}

/**
 * Check if write queue has stalled and needs recovery
 * v1.6.3.10-v9 - FIX Issue F: Detect stalled write queue (refactored)
 * @private
 * @param {string} logPrefix - Log prefix
 * @param {string} transactionId - Transaction ID
 * @returns {boolean} True if queue was recovered
 */
function _checkAndRecoverStalledQueue(logPrefix, transactionId) {
  // Queue is empty - reset stall timer
  if (pendingWriteCount === 0) {
    writeQueueStallStartTime = null;
    return false;
  }
  
  // Start tracking stall time
  if (writeQueueStallStartTime === null) {
    writeQueueStallStartTime = Date.now();
    return false;
  }
  
  const stallDuration = Date.now() - writeQueueStallStartTime;
  
  // Check if stalled
  if (!_isQueueStalled(stallDuration)) {
    return false;
  }
  
  const reason = stallDuration > WRITE_QUEUE_STALL_TIMEOUT_MS ? 'timeout' : 'max_pending_reached';
  _performQueueRecovery(logPrefix, transactionId, stallDuration, reason);
  return true;
}

/**
 * Log queue state transition for diagnostics
 * v1.6.3.10-v9 - FIX Issue F: Enhanced queue state logging
 * v1.6.3.10-v10 - FIX Gap 3.3: Queue state transition logging (ENQUEUE, DEQUEUE_START, DEQUEUE_SUCCESS/FAILURE, QUEUE_RESET)
 * @private
 * @param {string} logPrefix - Log prefix
 * @param {string} transactionId - Transaction ID
 * @param {string} event - Queue event type (enqueue, dequeue_start, dequeue_success, dequeue_failure, reset)
 * @param {Object} details - Additional details
 */
function _logQueueStateTransition(logPrefix, transactionId, event, details = {}) {
  // v1.6.3.10-v10 - FIX Gap 3.3: Structured queue state logging
  const eventUpper = event.toUpperCase();
  console.log(`[StorageQueue] ${eventUpper}:`, {
    transactionId,
    queueDepth: pendingWriteCount,
    circuitBreakerTripped,
    circuitBreakerTripTime: circuitBreakerTripTime ? new Date(circuitBreakerTripTime).toISOString() : null,
    writeQueueRecoveryCount,
    stallDurationMs: writeQueueStallStartTime ? Date.now() - writeQueueStallStartTime : 0,
    timestamp: new Date().toISOString(),
    ...details
  });
}

/**
 * Trip the circuit breaker with full logging
 * v1.6.3.10-v9 - FIX Issue F: Extracted from queueStorageWrite
 * v1.6.3.10-v10 - FIX Gap 3.3: Circuit breaker logging
 * @private
 */
function _tripCircuitBreaker(transactionId, threshold) {
  circuitBreakerTripped = true;
  circuitBreakerTripTime = Date.now();
  
  // v1.6.3.10-v10 - FIX Gap 3.3: Structured circuit breaker logging
  console.error('[StorageQueue] CIRCUIT_BREAKER_TRIPPED:', {
    transactionId,
    threshold,
    queueDepth: pendingWriteCount,
    lastCompletedTransactionId: lastCompletedTransactionId || 'NONE',
    stallDurationMs: writeQueueStallStartTime ? Date.now() - writeQueueStallStartTime : 0,
    timestamp: new Date().toISOString(),
    warning: 'INFINITE LOOP DETECTED - All writes blocked'
  });
}

/**
 * Log backlog warnings based on queue depth
 * v1.6.3.10-v9 - FIX Issue F: Extracted from queueStorageWrite
 * v1.6.3.10-v10 - FIX Gap 3.3: Backlog warning logging
 * @private
 */
function _logBacklogWarnings(transactionId) {
  if (pendingWriteCount > 10) {
    // v1.6.3.10-v10 - FIX Gap 3.3: Critical backlog logging
    console.error('[StorageQueue] CRITICAL_BACKLOG:', {
      transactionId,
      queueDepth: pendingWriteCount,
      threshold: 10,
      warning: 'Possible infinite loop',
      lastCompletedTransactionId: lastCompletedTransactionId || 'NONE',
      timestamp: new Date().toISOString()
    });
  } else if (pendingWriteCount > 5) {
    console.warn('[StorageQueue] BACKLOG_WARNING:', {
      transactionId,
      queueDepth: pendingWriteCount,
      threshold: 5,
      suggestion: 'Check self-write detection',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Queue a storage write operation (FIFO ordering)
 * v1.6.3.4-v8 - FIX Issue #7: Ensures writes are serialized
 * v1.6.3.4-v10 - FIX Issue #7: Reset queue on failure to break error propagation
 * v1.6.3.5 - FIX Issue #5: Enhanced queue reset logging with dropped writes count
 * v1.6.3.6-v3 - FIX Issue #2: Circuit breaker blocks ALL writes when queue exceeds threshold
 * v1.6.3.10-v9 - FIX Issue F: Recovery logic for stalled queue / unload edge cases (refactored)
 * @param {Function} writeOperation - Async function to execute
 * @param {string} [logPrefix='[StorageUtils]'] - Prefix for logging (optional)
 * @param {string} [transactionId=''] - Transaction ID for logging (optional)
 * @returns {Promise<boolean>} Result of the write operation
 */
export function queueStorageWrite(writeOperation, logPrefix = '[StorageUtils]', transactionId = '') {
  _checkAndRecoverStalledQueue(logPrefix, transactionId);

  // Circuit breaker check
  if (pendingWriteCount >= CIRCUIT_BREAKER_THRESHOLD) {
    if (!circuitBreakerTripped) _tripCircuitBreaker(transactionId, CIRCUIT_BREAKER_THRESHOLD);
    _logQueueStateTransition(logPrefix, transactionId, 'blocked', { reason: 'circuit_breaker' });
    return Promise.resolve(false);
  }

  pendingWriteCount++;
  _logQueueStateTransition(logPrefix, transactionId, 'enqueue', { prevTransaction: lastCompletedTransactionId });
  _logBacklogWarnings(transactionId);

  // Chain operation to queue
  storageWriteQueuePromise = storageWriteQueuePromise
    .then(() => {
      _logQueueStateTransition(logPrefix, transactionId, 'dequeue_start');
      return writeOperation();
    })
    .then(result => {
      _logQueueStateTransition(logPrefix, transactionId, 'dequeue_success', { result });
      if (pendingWriteCount <= 1) writeQueueStallStartTime = null;
      return result;
    })
    .catch(err => {
      const droppedWrites = pendingWriteCount - 1;
      _logQueueStateTransition(logPrefix, transactionId, 'dequeue_failure', { error: err.message, droppedWrites });
      pendingWriteCount = Math.max(0, pendingWriteCount - 1);
      storageWriteQueuePromise = Promise.resolve();
      writeQueueStallStartTime = null;
      return false;
    });

  return storageWriteQueuePromise;
}

/**
 * Validate ownership for persist operation
 * v1.6.3.5-v4 - Extracted to reduce persistStateToStorage complexity
 * v1.6.3.6-v2 - FIX Issue #3: Pass forceEmpty to validateOwnershipForWrite for proper empty write validation
 * v1.6.3.10-v7 - FIX Diagnostic Issue #7, #14: Enhanced logging showing storage write status
 * @private
 * @param {Object} state - State to validate
 * @param {boolean} forceEmpty - Whether empty writes are forced
 * @param {string} logPrefix - Logging prefix
 * @param {string} transactionId - Transaction ID for logging
 * @returns {{ shouldProceed: boolean }}
 */
function _validatePersistOwnership(state, forceEmpty, logPrefix, transactionId) {
  // v1.6.3.10-v7 - FIX Issue #7: Log storage write initiated
  console.log(`${logPrefix} STORAGE_WRITE_INITIATED [${transactionId}]:`, {
    tabCount: state.tabs.length,
    forceEmpty,
    currentWritingTabId,
    isTabIdInitialized: currentWritingTabId !== null,
    phase: 'ownership-validation'
  });

  // v1.6.3.6-v2 - FIX Issue #3: Pass forceEmpty to ownership validation
  // This allows validateOwnershipForWrite to properly handle empty writes
  const ownershipCheck = validateOwnershipForWrite(state.tabs, currentWritingTabId, forceEmpty);
  if (!ownershipCheck.shouldWrite) {
    // v1.6.3.10-v7 - FIX Issue #7, #14: Enhanced diagnostic logging when blocked
    console.warn(`${logPrefix} STORAGE_WRITE_BLOCKED [${transactionId}]:`, {
      reason: ownershipCheck.reason,
      currentTabId: currentWritingTabId,
      currentTabIdType: typeof currentWritingTabId,
      isTabIdInitialized: currentWritingTabId !== null,
      tabCount: state.tabs.length,
      forceEmpty,
      blockingCheck: currentWritingTabId === null ? 'dual-block (currentTabId null)' : 'ownership-filter',
      suggestion: currentWritingTabId === null
        ? 'Ensure setWritingTabId() is called before storage writes'
        : 'Current tab does not own any Quick Tabs in the state'
    });
    return { shouldProceed: false };
  }
  return { shouldProceed: true };
}

/**
 * Check if write should be coalesced/rate-limited
 * v1.6.3.10-v10 - FIX Issue H: Add write scheduling policy for high-frequency UI events
 * 
 * This function implements a write coalescing policy that:
 * 1. Checks if the last write was too recent (rate limiting)
 * 2. Checks if the state hash is unchanged (hash-based dedup)
 * 3. Logs when writes are coalesced with the reason
 * 
 * @private
 * @param {Object} state - State to check
 * @param {string} logPrefix - Log prefix
 * @param {string} transactionId - Transaction ID for logging
 * @returns {{shouldCoalesce: boolean, reason: string|null}}
 */
function _checkWriteCoalescing(state, logPrefix, transactionId) {
  const now = Date.now();
  const timeSinceLastWrite = now - lastWriteTimestamp;
  
  // Compute current state hash for comparison
  const currentHash = computeStateHash(state);
  
  // Check 1: Hash unchanged (same content as last persisted)
  if (currentHash === lastPersistedHash && lastPersistedHash !== null) {
    coalescedWriteCount++;
    console.log(`${logPrefix} v1.6.3.10-v10 WRITE_COALESCED [${transactionId}]:`, {
      reason: 'hash_unchanged',
      timeSinceLastWriteMs: timeSinceLastWrite,
      coalescedCount: coalescedWriteCount,
      hashValue: currentHash
    });
    return { shouldCoalesce: true, reason: 'hash_unchanged' };
  }
  
  // Check 2: Rate limiting - writes too close together
  if (timeSinceLastWrite < WRITE_COALESCE_MIN_INTERVAL_MS) {
    coalescedWriteCount++;
    console.log(`${logPrefix} v1.6.3.10-v10 WRITE_COALESCED [${transactionId}]:`, {
      reason: 'rate_limit',
      timeSinceLastWriteMs: timeSinceLastWrite,
      minIntervalMs: WRITE_COALESCE_MIN_INTERVAL_MS,
      coalescedCount: coalescedWriteCount
    });
    return { shouldCoalesce: true, reason: 'rate_limit' };
  }
  
  // Write is allowed - update tracking state
  lastWriteTimestamp = now;
  lastPersistedHash = currentHash;
  
  // Log if we had coalesced writes that are now being flushed
  if (coalescedWriteCount > 0) {
    console.log(`${logPrefix} v1.6.3.10-v10 WRITE_FLUSHED [${transactionId}]:`, {
      coalescedWritesSinceLastFlush: coalescedWriteCount,
      timeSinceLastWriteMs: timeSinceLastWrite
    });
    coalescedWriteCount = 0;
  }
  
  return { shouldCoalesce: false, reason: null };
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
 * v1.6.3.10-v5 - FIX Diagnostic Issue #3: Enhanced phase logging with correlation ID
 *
 * @param {Object} state - State object to persist
 * @param {string} logPrefix - Prefix for log messages (e.g., '[DestroyHandler]')
 * @param {boolean} forceEmpty - Allow empty (0 tabs) writes (default: false)
 * @returns {Promise<boolean>} - Promise resolving to true on success, false on failure
 */
export function persistStateToStorage(state, logPrefix = '[StorageUtils]', forceEmpty = false) {
  const transactionId = generateTransactionId();
  const startTime = Date.now();
  
  // v1.6.3.10-v10 - FIX Gap 3.1: Generate write correlation ID
  const writeCorrelationId = `write-${new Date().toISOString()}-${Math.random().toString(36).substring(2, 8)}`;

  // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle QUEUED
  console.log('[StorageWrite] LIFECYCLE_QUEUED:', {
    correlationId: writeCorrelationId,
    transactionId,
    tabCount: state?.tabs?.length ?? 0,
    forceEmpty,
    caller: logPrefix.replace(/\[|\]/g, ''),
    timestamp: new Date().toISOString()
  });

  // Phase 1: Validate state structure
  if (!_validateStateStructure(state, logPrefix).valid) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle FAILURE
    console.log('[StorageWrite] LIFECYCLE_FAILURE:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'VALIDATE_STRUCTURE',
      reason: 'Invalid state structure',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    return Promise.resolve(false);
  }

  const tabCount = state.tabs.length;
  const minimizedCount = state.tabs.filter(t => t.minimized).length;

  // v1.6.3.10-v10 - FIX Issue H: Phase 1.5: Check write coalescing (rate limiting)
  // This must be early to avoid unnecessary validation work for coalesced writes
  const coalesceResult = _checkWriteCoalescing(state, logPrefix, transactionId);
  if (coalesceResult.shouldCoalesce) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle COALESCED
    console.log('[StorageWrite] LIFECYCLE_COALESCED:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'RATE_LIMIT',
      reason: coalesceResult.reason,
      tabCount,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    // Return true because the state will be persisted by a later write
    return Promise.resolve(true);
  }

  // Phase 2: Check empty write protection
  if (_shouldRejectEmptyWrite(tabCount, forceEmpty, logPrefix, transactionId)) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle FAILURE
    console.log('[StorageWrite] LIFECYCLE_FAILURE:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'EMPTY_CHECK',
      reason: 'Empty write rejected',
      tabCount,
      forceEmpty,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    return Promise.resolve(false);
  }

  // Phase 3: Validate ownership
  const ownershipResult = _validatePersistOwnership(state, forceEmpty, logPrefix, transactionId);
  if (!ownershipResult.shouldProceed) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle FAILURE
    console.log('[StorageWrite] LIFECYCLE_FAILURE:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'OWNERSHIP_FILTER',
      reason: 'Ownership validation failed',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    return Promise.resolve(false);
  }

  // Phase 4: Check for state changes
  if (!hasStateChanged(state)) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle SKIPPED
    console.log('[StorageWrite] LIFECYCLE_SKIPPED:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'HASH_CHECK',
      reason: 'No changes detected',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    return Promise.resolve(true);
  }

  // Phase 5: Validate state content
  const validation = validateStateForPersist(state);
  if (!validation.valid) {
    // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle FAILURE
    console.error('[StorageWrite] LIFECYCLE_FAILURE:', {
      correlationId: writeCorrelationId,
      transactionId,
      phase: 'VALIDATE_CONTENT',
      reason: 'State validation failed',
      errors: validation.errors,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    return Promise.resolve(false);
  }

  // Phase 6: Log and execute write
  // v1.6.3.10-v10 - FIX Gap 3.1: Write lifecycle EXECUTE_START
  console.log('[StorageWrite] LIFECYCLE_EXECUTE_START:', {
    correlationId: writeCorrelationId,
    transactionId,
    tabCount,
    minimizedCount,
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString()
  });

  _logPersistInitiation({ logPrefix, transactionId, tabCount, minimizedCount, forceEmpty });

  const stateWithTxn = _prepareStateForWrite(state, transactionId);
  
  // v1.6.3.10-v10 - FIX Gap 3.1: Add write correlation ID to state for tracking
  stateWithTxn._writeCorrelationId = writeCorrelationId;

  return queueStorageWrite(
    () => _executeStorageWrite(stateWithTxn, tabCount, logPrefix, transactionId, writeCorrelationId, startTime),
    logPrefix,
    transactionId
  );
}
