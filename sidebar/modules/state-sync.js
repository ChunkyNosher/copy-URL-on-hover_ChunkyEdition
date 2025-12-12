/**
 * State Sync Constants & Utilities Module
 * sidebar/modules/state-sync.js
 *
 * v1.6.3.8-v4 - Extracted from quick-tabs-manager.js for bundle size refactoring
 *
 * Responsibilities:
 * - Port message handling constants
 * - Storage change handling constants
 * - Deduplication of messages and state
 * - State sync timeout constants
 * - SaveId-based deduplication
 *
 * MIGRATION STATUS: Phase 1 (Constants & Functions Only)
 * The state variables in this module are NOT currently used by quick-tabs-manager.js.
 * The main file retains its own local state as the authoritative source.
 * These module state variables exist for future Phase 3 migration when
 * quick-tabs-manager.js will be updated to use module state via getters/setters.
 *
 * @module sidebar/modules/state-sync
 */

// ==================== PORT CONNECTION CONSTANTS ====================

/**
 * Acknowledgment timeout (1 second)
 * v1.6.3.6-v11 - FIX Issue #10: Fallback timeout
 */
export const ACK_TIMEOUT_MS = 1000;

/**
 * Unified keepalive interval (20 seconds - same as background keepalive)
 * v1.6.3.7-v9 - Issue #1: Consolidated from separate 25s heartbeat and 20s keepalive
 */
export const UNIFIED_KEEPALIVE_INTERVAL_MS = 20000;

/**
 * Heartbeat timeout (5 seconds)
 * v1.6.3.6-v12 - FIX Issue #4: Detect unresponsive background
 */
export const HEARTBEAT_TIMEOUT_MS = 5000;

/**
 * Maximum heartbeat failures before triggering reconnection
 * v1.6.3.6-v12 - FIX Issue #4: Track for reconnection
 */
export const MAX_HEARTBEAT_FAILURES = 2;

/**
 * Number of consecutive heartbeat failures required before ZOMBIE transition
 * v1.6.3.7-v8 - FIX Issue #13: Hysteresis for heartbeat failure detection
 */
export const HEARTBEAT_FAILURES_BEFORE_ZOMBIE = 3;

/**
 * Threshold for consecutive keepalive failures before ZOMBIE transition
 * v1.6.3.7-v9 - Issue #1: Use same threshold as HEARTBEAT_FAILURES_BEFORE_ZOMBIE
 */
export const KEEPALIVE_FAILURES_BEFORE_ZOMBIE = 3;

// ==================== CIRCUIT BREAKER CONSTANTS ====================

/**
 * Initial reconnect backoff delay
 * v1.6.3.7 - FIX Issue #5: Port Reconnect Circuit Breaker
 */
export const RECONNECT_BACKOFF_INITIAL_MS = 100;

/**
 * Maximum reconnect backoff delay
 * v1.6.3.7 - FIX Issue #5: Port Reconnect Circuit Breaker
 */
export const RECONNECT_BACKOFF_MAX_MS = 10000;

/**
 * Failure threshold before opening circuit breaker
 * v1.6.3.7 - FIX Issue #5: Port Reconnect Circuit Breaker
 */
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;

/**
 * Duration circuit breaker stays open
 * v1.6.3.7-v4 - FIX Issue #8: Reduced from 10000ms to 2000ms
 */
export const CIRCUIT_BREAKER_OPEN_DURATION_MS = 2000;

/**
 * Probe interval for early recovery detection
 * v1.6.3.7-v4 - FIX Issue #8: Probe interval
 */
export const CIRCUIT_BREAKER_PROBE_INTERVAL_MS = 500;

// ==================== STATE SYNC CONSTANTS ====================

/**
 * State sync timeout (5 seconds)
 * v1.6.4.0 - FIX Issue E: Timeout for state sync request
 */
export const STATE_SYNC_TIMEOUT_MS = 5000;

/**
 * Storage read debounce interval
 * v1.6.3.7 - FIX Issue #3: UI Flicker Prevention
 */
export const RENDER_DEBOUNCE_MS = 300;

/**
 * Timeout for waiting on listener registration before sending messages
 * v1.6.3.8-v4 - FIX Issue #2: Extracted from inline timeout
 */
export const LISTENER_REGISTRATION_TIMEOUT_MS = 3000;

// ==================== BACKGROUND ACTIVITY CONSTANTS ====================

/**
 * Interval for background activity check (10 seconds)
 * v1.6.3.7-v8 - FIX Issue #14: Detect idle background before Firefox terminates it
 */
export const BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS = 10000;

/**
 * Warning threshold for stale background state (30 seconds)
 * v1.6.3.7-v8 - FIX Issue #14: Firefox terminates at 30s idle
 */
export const BACKGROUND_STALE_WARNING_THRESHOLD_MS = 30000;

// ==================== OPERATION CONSTANTS ====================

/**
 * Operation timeout for pending operations
 */
export const OPERATION_TIMEOUT_MS = 2000;

/**
 * DOM verification delay after operations
 */
export const DOM_VERIFICATION_DELAY_MS = 500;

/**
 * Browser tab cache TTL
 */
export const BROWSER_TAB_CACHE_TTL_MS = 30000;

// ==================== STORAGE LISTENER CONSTANTS ====================

/**
 * Test key for storage listener verification
 * v1.6.3.8-v3 - FIX Issue #5: Write-then-verify pattern
 */
export const STORAGE_LISTENER_TEST_KEY = '__storage_listener_verification_test__';

/**
 * Timeout for storage listener verification (ms)
 * v1.6.3.8-v3 - FIX Issue #5: If callback doesn't fire within this time, listener failed
 */
export const STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS = 1000;

/**
 * Watchdog timeout duration (ms)
 * v1.6.3.7-v9 - FIX Issue #6: 2 second timeout before explicit re-read
 */
export const STORAGE_WATCHDOG_TIMEOUT_MS = 2000;

// ==================== SAVEID CONSTANTS ====================

/**
 * Special saveId for reconciled state
 */
export const SAVEID_RECONCILED = 'reconciled';

/**
 * Special saveId for cleared state
 */
export const SAVEID_CLEARED = 'cleared';

// ==================== SAVEID DEDUPLICATION STATE ====================

/**
 * Last processed saveId to prevent duplicate renders
 * v1.6.3.7-v5 - FIX Issue #4: SaveId-based deduplication
 */
let lastProcessedSaveId = '';

/**
 * Timestamp of last saveId processing
 * v1.6.3.7-v5 - FIX Issue #4: Track when saveId was processed
 */
let lastSaveIdProcessedAt = 0;

// ==================== SAVEID FUNCTIONS ====================

/**
 * Get last processed saveId
 * @returns {string}
 */
export function getLastProcessedSaveId() {
  return lastProcessedSaveId;
}

/**
 * Set last processed saveId
 * @param {string} saveId
 */
export function setLastProcessedSaveId(saveId) {
  lastProcessedSaveId = saveId;
  lastSaveIdProcessedAt = Date.now();
}

/**
 * Get timestamp of last saveId processing
 * @returns {number}
 */
export function getLastSaveIdProcessedAt() {
  return lastSaveIdProcessedAt;
}

/**
 * Check if a saveId should be processed (not a duplicate)
 * @param {string} saveId - SaveId to check
 * @returns {boolean} True if should process, false if duplicate
 */
export function shouldProcessSaveId(saveId) {
  // Always process special saveIds
  if (saveId === SAVEID_RECONCILED || saveId === SAVEID_CLEARED) {
    return true;
  }

  // Check for duplicate
  if (saveId === lastProcessedSaveId) {
    return false;
  }

  return true;
}

// ==================== SEQUENCE ID STATE ====================

/**
 * Last applied sequence ID to validate event ordering
 * v1.6.3.7-v9 - FIX Issue #6: Events with sequenceId <= lastAppliedSequenceId are rejected
 */
let lastAppliedSequenceId = 0;

/**
 * Get last applied sequence ID
 * @returns {number}
 */
export function getLastAppliedSequenceId() {
  return lastAppliedSequenceId;
}

/**
 * Set last applied sequence ID
 * @param {number} sequenceId
 */
export function setLastAppliedSequenceId(sequenceId) {
  lastAppliedSequenceId = sequenceId;
}

/**
 * Check and update sequence ID
 * @param {number} sequenceId - Sequence ID to check
 * @returns {boolean} True if valid (should process), false if out of order
 */
export function checkAndUpdateSequenceId(sequenceId) {
  if (typeof sequenceId !== 'number') {
    return true; // No sequence ID, allow processing
  }

  if (sequenceId <= lastAppliedSequenceId) {
    console.warn('[Manager] STORAGE_SEQUENCE_REJECTED:', {
      expected: lastAppliedSequenceId + 1,
      received: sequenceId,
      timestamp: Date.now()
    });
    return false;
  }

  lastAppliedSequenceId = sequenceId;
  return true;
}

// ==================== PORT MESSAGE SEQUENCE STATE ====================

/**
 * Monotonic sequence counter for outgoing port messages from Manager
 * v1.6.3.7-v9 - Issue #9: Detect message reordering
 */
let managerPortMessageSequence = 0;

/**
 * Get next message sequence number for port messages
 * v1.6.3.7-v9 - Issue #9: Generate monotonically increasing sequence
 * @returns {number} Next sequence number
 */
export function getNextPortMessageSequence() {
  managerPortMessageSequence++;
  return managerPortMessageSequence;
}

/**
 * Get current port message sequence (for diagnostics)
 * @returns {number}
 */
export function getCurrentPortMessageSequence() {
  return managerPortMessageSequence;
}

// ==================== IN-MEMORY CACHE STATE ====================

/**
 * In-memory tabs cache structure
 * v1.6.3.5-v4 - FIX Diagnostic Issue #2: In-memory state cache
 * @type {{tabs: Array, timestamp: number, sessionId: string}}
 */
let inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };

/**
 * Last known good tab count
 * @type {number}
 */
let lastKnownGoodTabCount = 0;

/**
 * Minimum tabs required for cache protection
 */
export const MIN_TABS_FOR_CACHE_PROTECTION = 1;

/**
 * Get in-memory tabs cache
 * @returns {{tabs: Array, timestamp: number, sessionId: string}}
 */
export function getInMemoryTabsCache() {
  return inMemoryTabsCache;
}

/**
 * Update in-memory tabs cache
 * @param {Array} tabs - Tabs array
 * @param {string} sessionId - Session ID
 */
export function updateInMemoryTabsCache(tabs, sessionId) {
  inMemoryTabsCache = {
    tabs: [...tabs],
    timestamp: Date.now(),
    sessionId
  };
  lastKnownGoodTabCount = tabs.length;
}

/**
 * Get last known good tab count
 * @returns {number}
 */
export function getLastKnownGoodTabCount() {
  return lastKnownGoodTabCount;
}

/**
 * Set last known good tab count
 * @param {number} count
 */
export function setLastKnownGoodTabCount(count) {
  lastKnownGoodTabCount = count;
}

// ==================== PENDING ACKNOWLEDGMENTS ====================

/**
 * Pending acknowledgments map
 * v1.6.3.6-v11 - FIX Issue #10: Track pending acknowledgments
 * Key: correlationId, Value: { resolve, reject, timeout, sentAt }
 */
export const pendingAcks = new Map();

/**
 * Clear pending ack by correlation ID
 * @param {string} correlationId
 */
export function clearPendingAck(correlationId) {
  const pending = pendingAcks.get(correlationId);
  if (pending?.timeout) {
    clearTimeout(pending.timeout);
  }
  pendingAcks.delete(correlationId);
}

/**
 * Clear all pending acks
 */
export function clearAllPendingAcks() {
  for (const [, pending] of pendingAcks) {
    if (pending?.timeout) {
      clearTimeout(pending.timeout);
    }
  }
  pendingAcks.clear();
}

/**
 * Get pending acks count
 * @returns {number}
 */
export function getPendingAcksCount() {
  return pendingAcks.size;
}
