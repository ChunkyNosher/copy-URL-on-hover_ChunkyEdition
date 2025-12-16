// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest/declarativeNetRequest to remove X-Frame-Options for Quick Tabs
// v1.6.3.8-v8 - Critical Bug Fixes:
//   - Transaction timeout: Increased from 500ms to 1000ms for Firefox listener delay
//   - BroadcastChannel: Completely removed - port + storage.onChanged only
// v1.6.3.8-v6 - Core Architecture Fixes:
//   - Issue #2: MessageBatcher queue size limits (MAX_QUEUE_SIZE=100) and TTL (MAX_MESSAGE_AGE_MS=30000)
//   - Issue #4: Storage quota monitoring (every 5 min) with warnings at 50%, 75%, 90% thresholds
//   - Issue #5: Enhanced correlation ID and timestamp tracing
// v1.6.3.8-v5 - Issue 5: declarativeNetRequest feature detection with webRequest fallback
// v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load

// v1.6.0 - PHASE 3.1: Import message routing infrastructure
import { LogHandler } from './src/background/handlers/LogHandler.js';
import { QuickTabHandler } from './src/background/handlers/QuickTabHandler.js';
import { TabHandler } from './src/background/handlers/TabHandler.js';
import { MessageRouter } from './src/background/MessageRouter.js';
// v1.6.3.8-v12 GAP-1, GAP-10 fix: Import Quick Tabs v2 bootstrap
import {
  bootstrapQuickTabs,
  getActiveArchitecture
} from './src/background/quick-tabs-v2-integration.js';
// v1.6.3.9-v2 - Issue #6: Import tab events for container isolation and cleanup
import { initializeTabEvents, getTabEventsDiagnostics } from './src/background/tab-events.js';
// v1.6.3.8-v8 - ARCHITECTURE: BroadcastChannel COMPLETELY REMOVED
// All BC imports and functions removed - Port + storage.onChanged ONLY
// See Issue #13: Any remaining BC references are comments for historical context
// v1.6.4.14 - Phase 3A Optimization imports
import MemoryMonitor from './src/features/quick-tabs/MemoryMonitor.js';
import PerformanceMetrics from './src/features/quick-tabs/PerformanceMetrics.js';
import StorageCache from './src/features/quick-tabs/storage/StorageCache.js';

const runtimeAPI =
  (typeof browser !== 'undefined' && browser.runtime) ||
  (typeof chrome !== 'undefined' && chrome.runtime) ||
  null;

const downloadsAPI =
  (typeof browser !== 'undefined' && browser.downloads) ||
  (typeof chrome !== 'undefined' && chrome.downloads) ||
  null;

const EXTENSION_ID = runtimeAPI?.id || null;

// ==================== LOG CAPTURE FOR EXPORT ====================
// Log buffer for background script
const BACKGROUND_LOG_BUFFER = [];
const MAX_BACKGROUND_BUFFER_SIZE = 2000;

function addBackgroundLog(type, ...args) {
  if (BACKGROUND_LOG_BUFFER.length >= MAX_BACKGROUND_BUFFER_SIZE) {
    BACKGROUND_LOG_BUFFER.shift();
  }

  BACKGROUND_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: args
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' '),
    args: args
  });
}

// Override console methods to capture logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

console.log = function (...args) {
  addBackgroundLog('DEBUG', ...args);
  originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
  addBackgroundLog('ERROR', ...args);
  originalConsoleError.apply(console, args);
};

console.warn = function (...args) {
  addBackgroundLog('WARN', ...args);
  originalConsoleWarn.apply(console, args);
};

console.info = function (...args) {
  addBackgroundLog('INFO', ...args);
  originalConsoleInfo.apply(console, args);
};

// ==================== STATE MANAGEMENT ====================

// Store Quick Tab states per tab
const quickTabStates = new Map();

// ==================== REAL-TIME STATE COORDINATOR ====================
// Global state hub for real-time Quick Tab synchronization across all tabs
// v1.6.2.2 - ISSUE #35/#51 FIX: Unified format (no container separation)
// This provides instant cross-origin sync (< 50ms latency)
// v1.5.8.13 - Enhanced with eager loading for Issue #35 and #51
// v1.6.3.9-v4 - Per ROBUST-QUICKTABS-ARCHITECTURE.md: Added lastModified field
const globalQuickTabState = {
  // v1.6.2.2 - Unified format: single tabs array for global visibility
  tabs: [],
  // v1.6.3.9-v4 - lastModified (per spec), aliased as lastUpdate for backwards compatibility
  lastModified: 0,
  lastUpdate: 0, // Deprecated alias - use lastModified
  // v1.6.3.4 - FIX Bug #7: Track saveId for hash collision detection
  saveId: null,
  // v1.6.3.9-v4 - Per spec: Track initialization status in state object
  isInitialized: false
};

// Flag to track initialization status (external reference for backwards compatibility)
let isInitialized = false;

// v1.6.3.7-v10 - FIX Issue #11: Track initialization start time for listener entry logging
const initializationStartTime = Date.now();

// v1.6.1.6 - Memory leak fix: State hash for deduplication
// Prevents redundant broadcasts when state hasn't actually changed
let lastBroadcastedStateHash = 0;

// v1.6.1.6 - Memory leak fix: Window for ignoring self-triggered storage events (ms)
const WRITE_IGNORE_WINDOW_MS = 100;

// v1.6.3.7-v9 - FIX Issue #3: REMOVED IN_PROGRESS_TRANSACTIONS (dead code)
// The set was declared but NEVER populated anywhere in the codebase
// Transaction-based dedup is replaced by unified saveId-based deduplication
// See _multiMethodDeduplication() for the unified dedup strategy

// v1.6.3.7-v9 - FIX Issue #5: Increased cooldown from 50ms to 200ms
// Cooldown is now applied conditionally only when dedup filter triggers
const STORAGE_CHANGE_COOLDOWN_MS = 200;
let lastStorageChangeProcessed = 0;

// v1.6.3.7-v9 - FIX Issue #6: Sequence ID for event ordering validation
// Incremented on every storage write to ensure Manager processes in correct order
let storageWriteSequenceId = 0;

/**
 * Get the next sequence ID for storage writes
 * v1.6.3.7-v9 - FIX Issue #6: Monotonically increasing sequence ID
 * @returns {number} Next sequence ID
 */
function _getNextStorageSequenceId() {
  storageWriteSequenceId++;
  return storageWriteSequenceId;
}

// ==================== v1.6.3.8-v5 MONOTONIC REVISION VERSIONING ====================
// FIX Issue #1 (comprehensive-diagnostic-report.md): Storage Event Ordering
// IndexedDB delivers storage.onChanged events in arbitrary order. Revision numbers
// provide a definitive ordering mechanism that listeners can use to reject stale updates.

/**
 * Global revision counter for storage writes
 * v1.6.3.8-v5 - FIX Issue #1: Monotonic counter that NEVER resets during session
 * Initialized to Date.now() to ensure uniqueness across browser restarts
 */
let _globalRevisionCounter = Date.now();

/**
 * Get the next revision number for storage writes
 * v1.6.3.8-v5 - FIX Issue #1: Always incrementing, never resets
 * Each state snapshot includes this revision number. Listeners reject any update
 * with revision ≤ their _lastAppliedRevision.
 * @returns {number} Next revision number
 */
function _getNextRevision() {
  _globalRevisionCounter++;
  return _globalRevisionCounter;
}

/**
 * Get current revision without incrementing (for diagnostic purposes)
 * v1.6.3.8-v5 - FIX Issue #1: Used for logging/debugging
 * @returns {number} Current revision number
 */
function _getCurrentRevision() {
  return _globalRevisionCounter;
}

// ==================== v1.6.3.9-v4 STATE CHECKSUM & PERSISTENCE ====================
// Per ROBUST-QUICKTABS-ARCHITECTURE.md: Simplified state management with checksum validation

/**
 * Compute a deterministic checksum for Quick Tab state.
 *
 * v1.6.3.9-v4 - Per state-data-structure-spec.md: Checksum for corruption detection
 *
 * Format: v{version}:{tabCount}:{hash}
 * - version: Checksum algorithm version (v1)
 * - tabCount: Number of tabs (quick sanity check)
 * - hash: 8-character hex hash of all tab signatures
 *
 * @param {Array} tabs - Array of Quick Tab objects
 * @returns {string} Checksum string in format 'v1:{count}:{hash}'
 */
function _computeStateChecksum(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return 'v1:0:00000000';
  }

  // Create deterministic signature of state
  // Sort to ensure consistent ordering regardless of array order
  const signatures = tabs
    .map(_tabToSignature)
    .sort()
    .join('||');

  // Simple hash (not cryptographic, just collision detection)
  let hash = 0;
  for (let i = 0; i < signatures.length; i++) {
    const char = signatures.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return `v1:${tabs.length}:${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Get a numeric property from tab with fallbacks.
 * v1.6.3.9-v4 - Helper to reduce _tabToSignature complexity
 * @param {Object} t - Quick Tab object
 * @param {string} primary - Primary property name
 * @param {string} secondary - Secondary property path (e.g., 'position')
 * @param {string} nested - Nested property name under secondary
 * @param {number} defaultVal - Default value if not found
 * @returns {number} Property value
 */
function _getTabProp(t, primary, secondary, nested, defaultVal) {
  if (t[primary] != null) return t[primary];
  if (t[secondary]?.[nested] != null) return t[secondary][nested];
  return defaultVal;
}

/**
 * Convert a Quick Tab object to a signature string for checksum.
 * v1.6.3.9-v4 - Extracted to reduce _computeStateChecksum complexity
 * @param {Object} t - Quick Tab object
 * @returns {string} Signature string
 */
function _tabToSignature(t) {
  const left = _getTabProp(t, 'left', 'position', 'left', 0);
  const top = _getTabProp(t, 'top', 'position', 'top', 0);
  const width = _getTabProp(t, 'width', 'size', 'width', 800);
  const height = _getTabProp(t, 'height', 'size', 'height', 600);
  const minimized = t.minimized ? 1 : 0;
  return `${t.id}|${left}|${top}|${width}|${height}|${minimized}`;
}

/**
 * Simplified storage persistence function.
 *
 * v1.6.3.9-v4 - Per ROBUST-QUICKTABS-ARCHITECTURE.md Section 1: Background Script
 *
 * This function:
 * 1. Writes state to primary storage (storage.local)
 * 2. Writes backup to storage.sync (non-blocking)
 * 3. Validates write via read-back checksum comparison
 * 4. Triggers corruption recovery if validation fails
 *
 * @returns {Promise<boolean>} True if write succeeded and validated
 */
async function _persistToStorage() {
  const STORAGE_KEY = 'quick_tabs_state_v2';

  // Increment counters BEFORE write (per spec)
  storageWriteSequenceId++;
  _globalRevisionCounter++;

  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    lastModified: Date.now(),
    writeSequence: storageWriteSequenceId,
    revision: _globalRevisionCounter,
    checksum: _computeStateChecksum(globalQuickTabState.tabs),
    // Preserve existing saveId format for backwards compatibility
    saveId: `persist-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    timestamp: Date.now()
  };

  console.log('[Background] _persistToStorage: Writing state', {
    tabCount: stateToWrite.tabs.length,
    revision: stateToWrite.revision,
    writeSequence: stateToWrite.writeSequence,
    checksum: stateToWrite.checksum
  });

  try {
    // Write to primary storage
    await browser.storage.local.set({
      [STORAGE_KEY]: stateToWrite
    });

    // Write to backup (non-blocking)
    if (ENABLE_SYNC_STORAGE_BACKUP) {
      browser.storage.sync.set({
        [SYNC_BACKUP_KEY]: {
          tabs: stateToWrite.tabs,
          lastModified: stateToWrite.lastModified,
          checksum: stateToWrite.checksum
        }
      }).catch(err => {
        console.warn('[Background] Sync backup failed:', err.message || err);
      });
    }

    // Validate write-back
    const readBack = await browser.storage.local.get(STORAGE_KEY);
    if (!readBack[STORAGE_KEY] ||
        readBack[STORAGE_KEY].checksum !== stateToWrite.checksum) {
      console.error('[Background] WRITE VALIDATION FAILED - checksum mismatch', {
        expected: stateToWrite.checksum,
        actual: readBack[STORAGE_KEY]?.checksum
      });
      _triggerCorruptionRecovery();
      return false;
    }

    // Update global state tracking
    globalQuickTabState.lastUpdate = stateToWrite.lastModified;
    globalQuickTabState.saveId = stateToWrite.saveId;

    console.log('[Background] _persistToStorage: SUCCESS', {
      tabCount: stateToWrite.tabs.length,
      revision: stateToWrite.revision,
      checksum: stateToWrite.checksum
    });

    return true;
  } catch (err) {
    console.error('[Background] Storage write error:', err.message || err);
    return false;
  }
}

/**
 * Generate a unique Quick Tab ID.
 *
 * v1.6.3.9-v4 - Per state-data-structure-spec.md: ID Generation
 *
 * Format: qt-{timestamp}-{randomId}
 * - qt-: Prefix (always 'qt-')
 * - timestamp: 13-digit millisecond timestamp
 * - randomId: 6 random alphanumeric characters
 *
 * @returns {string} Unique Quick Tab ID
 */
function _generateQuickTabId() {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  return `qt-${timestamp}-${randomId}`;
}

/**
 * Trigger corruption recovery process.
 *
 * v1.6.3.9-v4 - Simplified wrapper for corruption recovery
 *
 * This is called when write validation fails (checksum mismatch).
 * It logs the issue and triggers async recovery if available.
 */
function _triggerCorruptionRecovery() {
  const operationId = _generateStorageOperationId();

  console.error('[Background] _triggerCorruptionRecovery: Corruption detected', {
    operationId,
    tabCount: globalQuickTabState.tabs.length,
    timestamp: Date.now()
  });

  // Delegate to the existing handleStorageCorruption if available
  // This is a non-blocking call to avoid blocking the write path
  setTimeout(() => {
    handleStorageCorruption(operationId, {
      tabs: globalQuickTabState.tabs,
      timestamp: Date.now()
    }).catch(err => {
      console.error('[Background] Corruption recovery failed:', err.message || err);
    });
  }, 0);
}

// v1.6.3.4-v11 - FIX Issue #1, #8: Track last non-empty state timestamp to prevent clearing during transactions
// Also track consecutive 0-tab reads to require confirmation before clearing
let lastNonEmptyStateTimestamp = Date.now();
let consecutiveZeroTabReads = 0;
const ZERO_TAB_CLEAR_THRESHOLD = 2; // Require 2 consecutive 0-tab reads
const NON_EMPTY_STATE_COOLDOWN_MS = 1000; // Don't clear within 1 second of last non-empty state

// ==================== v1.6.3.7-v9 ISSUE #8: INDEXEDDB CORRUPTION DETECTION ====================
// FIX Issue #8: Firefox bugs 1979997 and 1885297 cause silent IndexedDB corruption
// Implement storage integrity validation with redundant backup to storage.sync

/**
 * Operation ID counter for storage operation tracing
 * v1.6.3.7-v9 - FIX Issue #8: Unique operation IDs for all storage operations
 */
let storageOperationIdCounter = 0;

/**
 * Generate unique operation ID for storage operation tracing
 * v1.6.3.7-v9 - FIX Issue #8: All storage operations have unique IDs
 * @returns {string} Unique operation ID
 */
function _generateStorageOperationId() {
  storageOperationIdCounter++;
  return `storage-op-${Date.now()}-${storageOperationIdCounter}`;
}

/**
 * Maximum retries for storage write validation
 * v1.6.3.7-v9 - FIX Issue #8: Retry on validation failure
 */
const STORAGE_VALIDATION_MAX_RETRIES = 3;

/**
 * Delay between validation retries (ms)
 * v1.6.3.7-v9 - FIX Issue #8: Give IndexedDB time to sync
 */
const STORAGE_VALIDATION_RETRY_DELAY_MS = 100;

/**
 * Flag to enable storage.sync redundant backup
 * v1.6.3.7-v9 - FIX Issue #8: Optional recovery mechanism
 */
const ENABLE_SYNC_STORAGE_BACKUP = true;

/**
 * Key for redundant backup in storage.sync
 * v1.6.3.7-v9 - FIX Issue #8: Uses separate IndexedDB instance
 */
const SYNC_BACKUP_KEY = 'quick_tabs_backup_v1';

/**
 * Timestamp of last corruption detection (for rate limiting recovery)
 * v1.6.3.7-v9 - FIX Issue #8: Prevent recovery loops
 */
let lastCorruptionDetectedAt = 0;

/**
 * Minimum time between corruption recovery attempts (ms)
 * v1.6.3.7-v9 - FIX Issue #8: 30 second cooldown
 */
const CORRUPTION_RECOVERY_COOLDOWN_MS = 30000;

/**
 * Percentage of Quick Tabs to keep during quota-exceeded recovery
 * v1.6.3.7-v13 - Issue #7: Configurable recovery strategy
 * When storage quota is exceeded, keep newest 75% of tabs (clear oldest 25%)
 * v1.6.3.8-v5 - Issue #4: DEPRECATED - Now superseded by RECOVERY_PERCENTAGES array
 * Kept for documentation purposes only
 */
const _RECOVERY_KEEP_PERCENTAGE = 0.75;

// ==================== v1.6.3.8-v5 ITERATIVE STORAGE RECOVERY (Issue #4) ====================
// When storage quota is exceeded, progressively reduce data until write succeeds
/**
 * Iterative recovery percentages for storage quota recovery
 * v1.6.3.8-v5 - Issue #4: Progressive reduction: 75% → 50% → 25%
 * @type {number[]}
 */
const RECOVERY_PERCENTAGES = [0.75, 0.5, 0.25];

/**
 * Maximum number of recovery attempts before giving up
 * v1.6.3.8-v5 - Issue #4: Prevent infinite loops
 */
const RECOVERY_MAX_ATTEMPTS = 3;

/**
 * Base delay for exponential backoff between recovery attempts (ms)
 * v1.6.3.8-v5 - Issue #4: Exponential backoff: 500ms, 1000ms, 2000ms
 */
const RECOVERY_BACKOFF_BASE_MS = 500;

// ==================== v1.6.3.8-v8 STATE CHANGE AGE ENFORCEMENT (Issue #18) ====================
/**
 * Maximum age for state change events (5 minutes)
 * v1.6.3.8-v8 - Issue #18: Events older than this are rejected as stale
 * Prevents reapplying ancient operations from stuck queues
 */
const MAX_STATE_CHANGE_AGE_MS = 300000;

// ==================== v1.6.3.8-v8 PORT DIAGNOSTIC DATA ROTATION (Issue #20) ====================
/**
 * Maximum messageCount tracked before capping
 * v1.6.3.8-v8 - Issue #20: Cap messageCount to prevent unbounded growth
 */
const MAX_MESSAGE_COUNT_TRACKED = 999999;

/**
 * Idle duration before clearing port diagnostic data (24 hours)
 * v1.6.3.8-v8 - Issue #20: Clear old diagnostic data for idle ports
 */
const PORT_IDLE_CLEANUP_MS = 86400000;

// ==================== v1.6.3.6-v12 CONSTANTS ====================
// FIX Issue #2, #4: Heartbeat mechanism to prevent Firefox background script termination
const _HEARTBEAT_INTERVAL_MS = 25000; // 25 seconds (Firefox idle timeout is 30s)
const _HEARTBEAT_TIMEOUT_MS = 5000; // 5 second timeout for response

// FIX Issue #3: Multi-method deduplication
// v1.6.3.7-v13 - Issue #3: Documentation of 50ms window rationale
// IMPORTANT: The 50ms timestamp window is a SECONDARY safety net, NOT the primary ordering mechanism.
// Primary ordering uses sequence IDs (added v1.6.3.7-v9) which are assigned at write-time before
// storage.local.set() call. Firefox does NOT reorder events from same JS execution, so sequence
// IDs provide a reliable ordering guarantee that timestamps cannot provide.
// Timestamp-based dedup alone is INSUFFICIENT because:
//   1. Firefox storage.onChanged events can fire in any order (MDN: "The order listeners are called is not defined")
//   2. Timestamps assigned at write-time, but events may fire out of order due to IndexedDB batching
//   3. Two writes 100ms apart may have their onChanged events fire in reverse order
// See _checkSequenceIdOrdering() for the primary ordering mechanism.
const DEDUP_SAVEID_TIMESTAMP_WINDOW_MS = 50; // Window for saveId+timestamp comparison (SECONDARY fallback)

// FIX Issue #6: Deletion acknowledgment tracking
const DELETION_ACK_TIMEOUT_MS = 1000; // 1 second timeout for deletion acknowledgments
const pendingDeletionAcks = new Map(); // correlationId -> { pendingTabs: Set, completedTabs: Set, startTime, resolve, reject }

// ==================== v1.6.3.7 CONSTANTS ====================
// FIX Issue #1: Background alive keepalive using runtime.sendMessage to reset Firefox idle timer
const KEEPALIVE_INTERVAL_MS = 20000; // 20 seconds - slightly less than heartbeat to ensure alive state
// FIX Issue #5: Reconnect backoff constants (used in sidebar/quick-tabs-manager.js)
// These are exported via the existing port-based messaging system
const _RECONNECT_BACKOFF_INITIAL_MS = 100;
const _RECONNECT_BACKOFF_MAX_MS = 10000;
const _CIRCUIT_BREAKER_OPEN_DURATION_MS = 10000; // 10s cooldown in "open" state

// FIX Issue #7: Enhanced logging state tracking
let _lastCacheUpdateLog = null; // Track last cache state for before/after logging

// ==================== v1.6.4.9 LOGGING ENHANCEMENT TRACKING VARIABLES ====================
// Issue #4: Deduplication Decision Logging
// v1.6.3.7-v9 - FIX Issue #3: Dedup now tracked via saveId in _multiMethodDeduplication()

// Issue #5: Keepalive Health Monitoring
let lastKeepaliveSuccessTime = Date.now(); // Track last successful keepalive reset
let keepaliveSuccessCount = 0; // Counter for rate-limited success logging (every 10th)
let consecutiveKeepaliveFailures = 0; // Track consecutive failures for warning
const KEEPALIVE_LOG_EVERY_N = 10; // Log success every Nth keepalive
const KEEPALIVE_HEALTH_CHECK_INTERVAL_MS = 60000; // Health check every 60 seconds
const KEEPALIVE_HEALTH_WARNING_THRESHOLD_MS = 90000; // Warn if no success for 90+ seconds
let keepaliveHealthCheckIntervalId = null; // Health check interval ID

// ==================== v1.6.3.8 KEEPALIVE HEALTH TRACKING ====================
// Issue #9: Comprehensive keepalive success/failure rate tracking
// Track successes and failures within 60-second window for rate calculation
// v1.6.3.8-v6 - Issue #9: Added first keepalive logging flag
const KEEPALIVE_HEALTH_REPORT_INTERVAL_MS = 60000; // Report every 60 seconds
let keepaliveHealthReportIntervalId = null;
let keepaliveHealthStats = {
  successCount: 0,
  failureCount: 0,
  totalDurationMs: 0,
  fastestMs: Infinity,
  slowestMs: 0,
  lastResetTime: Date.now()
};
// v1.6.3.8-v6 - Issue #9: Track first keepalive for unconditional logging
let firstKeepaliveLogged = false;

// ==================== v1.6.4.13 DEBUG MESSAGING FLAG ====================
// Issue #5: Feature flag for verbose message routing logs
// Set to true to enable detailed logging of message routing at all tiers
const DEBUG_MESSAGING = true;

// ==================== v1.6.3.7-v12 DEBUG DIAGNOSTICS FLAG ====================
// Issue #6: Separate flag for verbose diagnostic logging (dedup decisions, validation, etc.)
// Set to true to enable detailed diagnostic logging without affecting DEBUG_MESSAGING
const DEBUG_DIAGNOSTICS = true;

// ==================== v1.6.3.7-v12 KEEPALIVE SAMPLING ====================
// Issue #2: Keepalive health monitoring - log first failure + sample 10% thereafter
// v1.6.3.7-v12 - FIX Code Review: Counter-based sampling instead of random for determinism
// Track whether first failure has been logged in this session
let firstKeepaliveFailureLogged = false;
const KEEPALIVE_FAILURE_LOG_EVERY_N = 10; // Log every Nth failure after first (deterministic)

// ==================== v1.6.3.7-v12 DEDUP STATISTICS ====================
// Issue #6: Track deduplication statistics
// v1.6.3.8-v6 - Issue #11: Enhanced dedup stats with tier tracking and longer history
// v1.6.3.8-v8 - Issue #18: Added staleEventAge tier for max age enforcement
let dedupStats = {
  skipped: 0,
  processed: 0,
  lastResetTime: Date.now(),
  // v1.6.3.8-v6 - Issue #11: Track which dedup tier was reached
  // v1.6.3.8-v8 - Issue #18: Added staleEventAge tier
  tierCounts: {
    staleEventAge: 0, // Tier 0: Max event age check (Issue #18)
    saveId: 0, // Tier 1: saveId match
    sequenceId: 0, // Tier 2: sequenceId ordering
    revision: 0, // Tier 3: revision check
    contentHash: 0 // Tier 4: content hash
  }
};
// v1.6.3.8-v6 - Issue #11: Longer-lived dedup history (last 5 minutes in 60s buckets)
const DEDUP_HISTORY_BUCKETS = 5;
const DEDUP_STATS_LOG_INTERVAL_MS = 60000; // Log stats every 60 seconds
let dedupStatsIntervalId = null;
const dedupStatsHistory = []; // Array of { timestamp, skipped, processed, tierCounts }
// v1.6.3.8-v6 - Issue #7: Map dedup method names to tier count keys
// v1.6.3.8-v8 - Issue #18: Added staleEventAge mapping
const DEDUP_TIER_MAP = {
  staleEventAge: 'staleEventAge', // Issue #18: Max event age check
  'saveId-timestamp': 'saveId',
  sequenceId: 'sequenceId',
  revision: 'revision',
  contentHash: 'contentHash'
};

// ==================== v1.6.3.7-v3 ALARM CONSTANTS ====================
// API #4: browser.alarms - Scheduled cleanup tasks
const ALARM_CLEANUP_ORPHANED = 'cleanup-orphaned';
const ALARM_SYNC_SESSION_STATE = 'sync-session-state';
const ALARM_DIAGNOSTIC_SNAPSHOT = 'diagnostic-snapshot';
// v1.6.3.8 - Issue #2 (arch): Keepalive alarm as backup to interval-based keepalive
const ALARM_KEEPALIVE_BACKUP = 'keepalive-backup';

// Alarm intervals in minutes
const ALARM_CLEANUP_INTERVAL_MIN = 60; // Hourly orphan cleanup
const ALARM_SYNC_INTERVAL_MIN = 5; // Every 5 minutes sync
const ALARM_DIAGNOSTIC_INTERVAL_MIN = 120; // Every 2 hours diagnostic
// v1.6.3.8 - Issue #2 (arch): Keepalive alarm every 25 seconds (0.42 min)
// Firefox idle timer is 30s, so 25s gives us 5s buffer
const ALARM_KEEPALIVE_INTERVAL_MIN = 25 / 60; // 25 seconds in minutes

// ==================== v1.6.3.8-v6 STORAGE QUOTA MONITORING ====================
// FIX Issue #4: Monitor storage.local quota usage and log warnings at thresholds

/**
 * Alarm name for storage quota monitoring
 * v1.6.3.8-v6 - Issue #4: Storage quota monitoring alarm
 */
const ALARM_STORAGE_QUOTA_CHECK = 'storage-quota-check';

/**
 * Interval for storage quota checks (5 minutes - normal)
 * v1.6.3.8-v6 - Issue #4: Every 5 minutes
 */
const ALARM_STORAGE_QUOTA_INTERVAL_MIN = 5;

/**
 * Interval for storage quota checks (1 minute - fast mode when quota high)
 * v1.6.3.8-v8 - Issue #4: Adaptive monitoring - switch to 1 minute when quota > 50%
 */
const ALARM_STORAGE_QUOTA_INTERVAL_FAST_MIN = 1;

/**
 * Threshold to switch to fast monitoring (50%)
 * v1.6.3.8-v8 - Issue #4: Adaptive monitoring threshold
 */
const STORAGE_QUOTA_HIGH_USAGE_THRESHOLD = 0.5;

/**
 * Threshold to switch back to normal monitoring (40%)
 * v1.6.3.8-v8 - Issue #4: Hysteresis to prevent oscillation
 */
const STORAGE_QUOTA_LOW_USAGE_THRESHOLD = 0.4;

/**
 * Track current monitoring mode for adaptive frequency
 * v1.6.3.8-v8 - Issue #4: 'normal' (5 min) or 'fast' (1 min)
 */
let _storageQuotaMonitoringMode = 'normal';

/**
 * Storage quota warning thresholds (percentage of 10MB limit)
 * v1.6.3.8-v6 - Issue #4: Log warnings at 50%, 75%, 90%
 */
const STORAGE_QUOTA_WARNING_THRESHOLDS = [
  { percent: 0.5, level: 'INFO', message: '50% storage quota used' },
  { percent: 0.75, level: 'WARN', message: '75% storage quota used - consider cleanup' },
  { percent: 0.9, level: 'CRITICAL', message: '90% storage quota used - cleanup required' }
];

/**
 * Firefox storage.local quota limit (10MB for MV2 extensions)
 * v1.6.3.8-v6 - Issue #4: Used for percentage calculations
 */
const STORAGE_LOCAL_QUOTA_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Track last triggered threshold to avoid duplicate logs
 * v1.6.3.8-v6 - Issue #4: Prevent repeated warnings at same level
 */
let _lastStorageQuotaThresholdLevel = null;

/**
 * Storage quota usage snapshot for diagnostic reports
 * v1.6.3.8-v6 - Issue #4: Included in diagnostic snapshots
 * v1.6.3.8-v8 - Issue #17: Added aggregated storage tracking
 */
let _lastStorageQuotaSnapshot = {
  bytesInUse: 0,
  percentUsed: 0,
  lastChecked: 0,
  thresholdLevel: null,
  // v1.6.3.8-v8 - Issue #17: Per-area usage tracking
  localBytes: 0,
  syncBytes: 0,
  sessionBytes: 0,
  aggregatedBytes: 0
};

// ==================== v1.6.3.7 KEEPALIVE MECHANISM ====================
// FIX Issue #1: Firefox 117+ Bug 1851373 - runtime.Port does NOT reset the idle timer
// Use runtime.sendMessage periodically as it DOES reset the idle timer
let keepaliveIntervalId = null;

/**
 * Start keepalive interval to reset Firefox's idle timer
 * v1.6.3.7 - FIX Issue #1: Use browser.runtime.sendMessage to reset idle timer
 * v1.6.4.9 - Issue #5: Added health monitoring with periodic health checks
 * v1.6.3.8 - Issue #9: Added comprehensive health reporting every 60 seconds
 */
function startKeepalive() {
  if (keepaliveIntervalId) {
    clearInterval(keepaliveIntervalId);
  }

  // v1.6.4.9 - Issue #5: Initialize health tracking
  lastKeepaliveSuccessTime = Date.now();
  consecutiveKeepaliveFailures = 0;
  keepaliveSuccessCount = 0;

  // v1.6.3.8 - Issue #9: Reset health stats
  keepaliveHealthStats = {
    successCount: 0,
    failureCount: 0,
    totalDurationMs: 0,
    fastestMs: Infinity,
    slowestMs: 0,
    lastResetTime: Date.now()
  };

  // Immediate ping to register activity
  triggerIdleReset();

  keepaliveIntervalId = setInterval(() => {
    triggerIdleReset();
  }, KEEPALIVE_INTERVAL_MS);

  // v1.6.4.9 - Issue #5: Start health check interval
  _startKeepaliveHealthCheck();

  // v1.6.3.8 - Issue #9: Start health report interval
  _startKeepaliveHealthReport();

  console.log('[Background] v1.6.3.7 Keepalive started (every', KEEPALIVE_INTERVAL_MS / 1000, 's)');
}

/**
 * Start periodic health check for keepalive mechanism
 * v1.6.4.9 - Issue #5: Check if keepalive is functioning properly
 * @private
 */
function _startKeepaliveHealthCheck() {
  if (keepaliveHealthCheckIntervalId) {
    clearInterval(keepaliveHealthCheckIntervalId);
  }

  keepaliveHealthCheckIntervalId = setInterval(() => {
    const timeSinceLastSuccess = Date.now() - lastKeepaliveSuccessTime;
    if (timeSinceLastSuccess > KEEPALIVE_HEALTH_WARNING_THRESHOLD_MS) {
      console.warn('[Background] KEEPALIVE_HEALTH_WARNING:', {
        timeSinceLastSuccessMs: timeSinceLastSuccess,
        lastSuccessTime: new Date(lastKeepaliveSuccessTime).toISOString(),
        consecutiveFailures: consecutiveKeepaliveFailures,
        threshold: KEEPALIVE_HEALTH_WARNING_THRESHOLD_MS
      });
    }
  }, KEEPALIVE_HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Trigger idle timer reset using tabs.query and sendMessage
 * v1.6.3.7 - FIX Issue #1: Firefox treats tabs.query and runtime.sendMessage as activity
 * v1.6.4.9 - Issue #5: Added health tracking and rate-limited success logging
 * v1.6.3.7-v12 - Issue #2: Log first failure + sample 10% thereafter instead of rate-limiting
 * v1.6.3.7-v12 - FIX ESLint: Extracted helpers to reduce complexity (cc=10 → cc=5)
 */
async function triggerIdleReset() {
  const attemptStartTime = Date.now();
  const context = { tabsQuerySuccess: false, sendMessageSuccess: false, tabCount: 0 };

  try {
    await _performKeepaliveQueries(context);
    _handleKeepaliveSuccess(context, attemptStartTime);
  } catch (err) {
    _handleKeepaliveFailure(err, context.tabsQuerySuccess, attemptStartTime);
  }
}

/**
 * Perform keepalive queries (tabs.query and runtime.sendMessage)
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce triggerIdleReset complexity
 * @private
 * @param {Object} context - Context object to update with results
 */
async function _performKeepaliveQueries(context) {
  // Method 1: browser.tabs.query triggers event handlers which reset idle timer
  const tabs = await browser.tabs.query({});
  context.tabsQuerySuccess = true;
  context.tabCount = tabs.length;

  // Method 2: Self-send a message (this resets the idle timer)
  try {
    await browser.runtime.sendMessage({ type: 'KEEPALIVE_PING', timestamp: Date.now() });
    context.sendMessageSuccess = true;
  } catch (_err) {
    // Expected to fail if no listener, but the message send itself resets the timer
    context.sendMessageSuccess = false;
  }
}

/**
 * Handle successful keepalive reset
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce triggerIdleReset complexity
 * v1.6.3.8 - Issue #9: Track comprehensive health stats for rate calculation
 * v1.6.3.8-v6 - Issue #9: Log first keepalive unconditionally
 * @private
 * @param {Object} context - Keepalive context with results
 * @param {number} attemptStartTime - When the attempt started
 */
function _handleKeepaliveSuccess(context, attemptStartTime) {
  const durationMs = Date.now() - attemptStartTime;

  lastKeepaliveSuccessTime = Date.now();
  consecutiveKeepaliveFailures = 0;
  firstKeepaliveFailureLogged = false;
  keepaliveSuccessCount++;

  // v1.6.3.8 - Issue #9: Update health stats for rate tracking
  keepaliveHealthStats.successCount++;
  keepaliveHealthStats.totalDurationMs += durationMs;
  keepaliveHealthStats.fastestMs = Math.min(keepaliveHealthStats.fastestMs, durationMs);
  keepaliveHealthStats.slowestMs = Math.max(keepaliveHealthStats.slowestMs, durationMs);

  // v1.6.3.8-v6 - Issue #9: Log first keepalive unconditionally
  const isFirst = !firstKeepaliveLogged;
  if (isFirst) {
    firstKeepaliveLogged = true;
  }

  // Log first success unconditionally, then rate-limited (every 10th success)
  if (isFirst || keepaliveSuccessCount % KEEPALIVE_LOG_EVERY_N === 0) {
    console.log('[Background] KEEPALIVE_RESET_SUCCESS:', {
      isFirstKeepalive: isFirst,
      tabCount: context.tabCount,
      successCount: keepaliveSuccessCount,
      failureCount: consecutiveKeepaliveFailures,
      tabsQuerySuccess: context.tabsQuerySuccess,
      sendMessageSuccess: context.sendMessageSuccess,
      durationMs,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle keepalive reset failure
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce triggerIdleReset complexity
 * v1.6.3.8 - Issue #9: Track failures for rate calculation
 * @private
 * @param {Error} err - Error that occurred
 * @param {boolean} tabsQuerySuccess - Whether tabs.query succeeded
 * @param {number} attemptStartTime - When the attempt started
 */
function _handleKeepaliveFailure(err, tabsQuerySuccess, attemptStartTime) {
  consecutiveKeepaliveFailures++;

  // v1.6.3.8 - Issue #9: Update health stats for rate tracking
  keepaliveHealthStats.failureCount++;

  // Issue #2: Always log first failure, then sample every Nth thereafter (deterministic)
  // v1.6.3.7-v12 - FIX Code Review: Counter-based sampling for predictable, testable behavior
  const shouldLogFailure =
    !firstKeepaliveFailureLogged ||
    consecutiveKeepaliveFailures % KEEPALIVE_FAILURE_LOG_EVERY_N === 0;

  if (shouldLogFailure) {
    console.error('[Background] KEEPALIVE_RESET_FAILED:', {
      error: err.message,
      failedApi: tabsQuerySuccess ? 'runtime.sendMessage' : 'tabs.query',
      tabsQuerySuccess,
      consecutiveFailures: consecutiveKeepaliveFailures,
      lastSuccessTime: new Date(lastKeepaliveSuccessTime).toISOString(),
      timeSinceLastSuccessMs: Date.now() - lastKeepaliveSuccessTime,
      durationMs: Date.now() - attemptStartTime,
      isFirstFailure: !firstKeepaliveFailureLogged,
      samplingStrategy: firstKeepaliveFailureLogged
        ? `every ${KEEPALIVE_FAILURE_LOG_EVERY_N}th`
        : 'first',
      timestamp: Date.now()
    });
    firstKeepaliveFailureLogged = true;
  }

  // Warn if > 2 consecutive failures
  if (consecutiveKeepaliveFailures > 2) {
    console.warn('[Background] KEEPALIVE_CONSECUTIVE_FAILURES_WARNING:', {
      failureCount: consecutiveKeepaliveFailures,
      timeSinceLastSuccessMs: Date.now() - lastKeepaliveSuccessTime,
      healthStatus: consecutiveKeepaliveFailures > 5 ? 'critical' : 'degraded'
    });
  }
}

/**
 * Stop keepalive interval
 * v1.6.3.7 - FIX Issue #1: Cleanup function
 * v1.6.4.9 - Issue #5: Also stop health check interval
 * v1.6.3.8 - Issue #9: Also stop health report interval
 */
function _stopKeepalive() {
  if (keepaliveIntervalId) {
    clearInterval(keepaliveIntervalId);
    keepaliveIntervalId = null;
    console.log('[Background] v1.6.3.7 Keepalive stopped');
  }

  // v1.6.4.9 - Issue #5: Stop health check interval
  if (keepaliveHealthCheckIntervalId) {
    clearInterval(keepaliveHealthCheckIntervalId);
    keepaliveHealthCheckIntervalId = null;
  }

  // v1.6.3.8 - Issue #9: Stop health report interval
  if (keepaliveHealthReportIntervalId) {
    clearInterval(keepaliveHealthReportIntervalId);
    keepaliveHealthReportIntervalId = null;
  }
}

/**
 * Start periodic keepalive health reporting
 * v1.6.3.8 - Issue #9: Log comprehensive success/failure rates every 60 seconds
 * @private
 */
function _startKeepaliveHealthReport() {
  if (keepaliveHealthReportIntervalId) {
    clearInterval(keepaliveHealthReportIntervalId);
  }

  keepaliveHealthReportIntervalId = setInterval(() => {
    _logKeepaliveHealthReport();
  }, KEEPALIVE_HEALTH_REPORT_INTERVAL_MS);
}

/**
 * Log keepalive health report with success/failure rates and timing metrics
 * v1.6.3.8 - Issue #9: Comprehensive health metrics
 * @private
 */
function _logKeepaliveHealthReport() {
  const total = keepaliveHealthStats.successCount + keepaliveHealthStats.failureCount;

  // Skip if no attempts in this window
  if (total === 0) {
    return;
  }

  const successRate = (keepaliveHealthStats.successCount / total) * 100;
  const averageMs =
    keepaliveHealthStats.successCount > 0
      ? keepaliveHealthStats.totalDurationMs / keepaliveHealthStats.successCount
      : 0;

  // Determine health status based on success rate
  let healthStatus = 'excellent';
  if (successRate < 90) {
    healthStatus = 'degraded';
  }
  if (successRate < 70) {
    healthStatus = 'poor';
  }
  if (successRate < 50) {
    healthStatus = 'critical';
  }

  // Log health report
  console.log('[Background] KEEPALIVE_HEALTH_REPORT:', {
    window: `last ${KEEPALIVE_HEALTH_REPORT_INTERVAL_MS / 1000}s`,
    successes: keepaliveHealthStats.successCount,
    failures: keepaliveHealthStats.failureCount,
    successRate: `${successRate.toFixed(1)}%`,
    healthStatus,
    averageMethod: 'tabs.query + runtime.sendMessage',
    timing: {
      fastestMs: keepaliveHealthStats.fastestMs === Infinity ? 0 : keepaliveHealthStats.fastestMs,
      slowestMs: keepaliveHealthStats.slowestMs,
      averageMs: averageMs.toFixed(1)
    },
    timestamp: Date.now()
  });

  // Log warning if success rate drops below 90%
  if (successRate < 90) {
    console.warn('[Background] KEEPALIVE_HEALTH_WARNING:', {
      successRate: `${successRate.toFixed(1)}%`,
      recommendation: 'Inspect Firefox idle state or API availability',
      consecutiveFailures: consecutiveKeepaliveFailures,
      timeSinceLastSuccessMs: Date.now() - lastKeepaliveSuccessTime
    });
  }

  // Reset stats for next window
  keepaliveHealthStats = {
    successCount: 0,
    failureCount: 0,
    totalDurationMs: 0,
    fastestMs: Infinity,
    slowestMs: 0,
    lastResetTime: Date.now()
  };
}

/**
 * Get keepalive health summary for diagnostic snapshot
 * v1.6.3.8 - Issue #9: Include in diagnostic snapshot
 * @returns {string} Health summary string
 */
function _getKeepaliveHealthSummary() {
  const total = keepaliveHealthStats.successCount + keepaliveHealthStats.failureCount;
  if (total === 0) {
    return 'no data';
  }

  const successRate = (keepaliveHealthStats.successCount / total) * 100;
  let status = 'excellent';
  if (successRate < 90) status = 'degraded';
  if (successRate < 70) status = 'poor';
  if (successRate < 50) status = 'critical';

  return `${successRate.toFixed(0)}% (${status})`;
}

// Start keepalive on script load
startKeepalive();

// ==================== v1.6.3.8-v8 BROADCASTCHANNEL REMOVED ====================
// ARCHITECTURE: BroadcastChannel COMPLETELY REMOVED per architecture-redesign.md
// v1.6.3.8-v8 - Issue #13: BroadcastChannel removal complete
// All BC code removed - Port + storage.onChanged ONLY
// The new architecture uses:
// - Layer 1a: runtime.Port for real-time metadata sync (PRIMARY)
// - Layer 2: storage.local with monotonic revision versioning + storage.onChanged (FALLBACK)

// ==================== v1.6.3.7-v3 ALARMS MECHANISM ====================
// API #4: browser.alarms - Scheduled cleanup tasks

/**
 * Initialize browser.alarms for scheduled cleanup tasks
 * v1.6.3.7-v3 - API #4: Create alarms on extension startup
 * v1.6.3.8 - Issue #2 (arch): Add keepalive backup alarm
 */
async function initializeAlarms() {
  console.log('[Background] v1.6.3.7-v3 Initializing browser.alarms...');

  try {
    // v1.6.3.8 - Issue #2 (arch): Create keepalive-backup alarm - most reliable keepalive method
    // This alarm fires every 25 seconds and resets Firefox's idle timer
    // Even if setInterval-based keepalive fails, alarms will keep background alive
    await browser.alarms.create(ALARM_KEEPALIVE_BACKUP, {
      delayInMinutes: ALARM_KEEPALIVE_INTERVAL_MIN, // First run after 25 seconds
      periodInMinutes: ALARM_KEEPALIVE_INTERVAL_MIN
    });
    console.log(
      '[Background] Created alarm:',
      ALARM_KEEPALIVE_BACKUP,
      '(every',
      Math.round(ALARM_KEEPALIVE_INTERVAL_MIN * 60),
      'sec) - backup keepalive'
    );

    // Create cleanup-orphaned alarm - runs hourly
    await browser.alarms.create(ALARM_CLEANUP_ORPHANED, {
      delayInMinutes: 30, // First run after 30 minutes
      periodInMinutes: ALARM_CLEANUP_INTERVAL_MIN
    });
    console.log(
      '[Background] Created alarm:',
      ALARM_CLEANUP_ORPHANED,
      '(every',
      ALARM_CLEANUP_INTERVAL_MIN,
      'min)'
    );

    // Create sync-session-state alarm - runs every 5 minutes
    await browser.alarms.create(ALARM_SYNC_SESSION_STATE, {
      delayInMinutes: 1, // First run after 1 minute
      periodInMinutes: ALARM_SYNC_INTERVAL_MIN
    });
    console.log(
      '[Background] Created alarm:',
      ALARM_SYNC_SESSION_STATE,
      '(every',
      ALARM_SYNC_INTERVAL_MIN,
      'min)'
    );

    // Create diagnostic-snapshot alarm - runs every 2 hours
    await browser.alarms.create(ALARM_DIAGNOSTIC_SNAPSHOT, {
      delayInMinutes: 60, // First run after 1 hour
      periodInMinutes: ALARM_DIAGNOSTIC_INTERVAL_MIN
    });
    console.log(
      '[Background] Created alarm:',
      ALARM_DIAGNOSTIC_SNAPSHOT,
      '(every',
      ALARM_DIAGNOSTIC_INTERVAL_MIN,
      'min)'
    );

    // v1.6.3.8-v6 - Issue #4: Create storage-quota-check alarm - runs every 5 minutes
    await browser.alarms.create(ALARM_STORAGE_QUOTA_CHECK, {
      delayInMinutes: 1, // First run after 1 minute
      periodInMinutes: ALARM_STORAGE_QUOTA_INTERVAL_MIN
    });
    console.log(
      '[Background] Created alarm:',
      ALARM_STORAGE_QUOTA_CHECK,
      '(every',
      ALARM_STORAGE_QUOTA_INTERVAL_MIN,
      'min) - storage quota monitoring'
    );

    console.log('[Background] v1.6.3.7-v3 All alarms initialized successfully');
  } catch (err) {
    console.error('[Background] Failed to initialize alarms:', err.message);
  }
}

/**
 * Handle alarm events
 * v1.6.3.7-v3 - API #4: Route alarms to appropriate handlers
 * v1.6.3.8 - Issue #2 (arch): Add keepalive backup alarm handler
 * v1.6.3.8-v5 - FIX Issue #6: Add initialization guards to prevent race conditions
 * @param {Object} alarm - Alarm info object
 */
async function handleAlarm(alarm) {
  // v1.6.3.8-v5 - FIX Issue #6: Keepalive alarm can run without full init
  // but must skip state-dependent operations until initialized
  if (alarm.name === ALARM_KEEPALIVE_BACKUP) {
    // Simply receiving the alarm event resets Firefox's idle timer
    // Also trigger our idle reset for consistency
    await _handleKeepaliveAlarm();
    return;
  }

  // v1.6.3.8-v5 - FIX Issue #6: All non-keepalive alarms require initialization
  // These alarms access globalQuickTabState and perform storage operations
  if (!isInitialized) {
    console.warn('[Background] v1.6.3.8-v5 ALARM_SKIPPED_NOT_INITIALIZED:', {
      alarmName: alarm.name,
      timestamp: Date.now(),
      isInitialized: false
    });
    return;
  }

  console.log('[Background] ALARM_FIRED:', alarm.name, 'at', new Date().toISOString());

  switch (alarm.name) {
    case ALARM_CLEANUP_ORPHANED:
      await cleanupOrphanedQuickTabs();
      break;

    case ALARM_SYNC_SESSION_STATE:
      await syncSessionState();
      break;

    case ALARM_DIAGNOSTIC_SNAPSHOT:
      logDiagnosticSnapshot();
      break;

    // v1.6.3.8-v6 - Issue #4: Storage quota monitoring
    case ALARM_STORAGE_QUOTA_CHECK:
      await checkStorageQuota();
      break;

    default:
      console.warn('[Background] Unknown alarm:', alarm.name);
  }
}

/**
 * Handle keepalive alarm event
 * v1.6.3.8 - Issue #2 (arch): Backup keepalive mechanism via browser.alarms
 * v1.6.3.8-v5 - FIX Issue #6: Skip sidebar pings during initialization
 * This is the most reliable way to keep MV2 background scripts alive in Firefox
 * @private
 */
async function _handleKeepaliveAlarm() {
  // Receiving alarm callback already resets idle timer, but also trigger our reset
  try {
    // Perform a lightweight API call to ensure activity is registered
    await browser.tabs.query({ active: true, currentWindow: true });

    // v1.6.3.8-v5 - FIX Issue #6: Only send sidebar pings after initialization
    // Sending pings before init could reference uninitialized state
    if (isInitialized) {
      // v1.6.3.8 - Issue #2 (arch): Send proactive ALIVE ping to all connected sidebars
      _sendAlivePingToSidebars();
    }

    // Update keepalive health stats (success via alarm)
    const now = Date.now();
    lastKeepaliveSuccessTime = now;
    keepaliveHealthStats.successCount++;

    // Rate-limited logging (every 12th alarm = ~5 minutes)
    if (keepaliveSuccessCount % 12 === 0) {
      console.log('[Background] KEEPALIVE_ALARM_SUCCESS:', {
        alarmCount: keepaliveSuccessCount,
        timestamp: now,
        isInitialized
      });
    }
    keepaliveSuccessCount++;
  } catch (err) {
    console.error('[Background] KEEPALIVE_ALARM_FAILED:', {
      error: err.message,
      timestamp: Date.now()
    });
    keepaliveHealthStats.failureCount++;
  }
}

/**
 * Send alive ping to a single sidebar
 * v1.6.3.8-v12 - Port infrastructure removed, this is now a no-op
 * @private
 * @param {string} _portId - Port ID (unused)
 * @param {Object} _portInfo - Port info (unused)
 * @param {Object} _alivePing - Ping message (unused)
 */
function _sendAlivePingToPort(_portId, _portInfo, _alivePing) {
  // v1.6.3.8-v12 - Port infrastructure removed, no-op
}

/**
 * Send proactive ALIVE ping to sidebar
 * v1.6.3.8-v12 - Port infrastructure removed, this is now a no-op
 * Sidebar communicates via runtime.sendMessage and storage.onChanged
 * @private
 */
function _sendAlivePingToSidebars() {
  // v1.6.3.8-v12 - Port infrastructure removed
  // Sidebar now uses runtime.sendMessage and storage.onChanged for communication
  // This function is kept as a no-op for keepalive alarm compatibility
  if (DEBUG_DIAGNOSTICS) {
    console.log('[Background] v1.6.3.8-v12 ALIVE_PING skipped (port infrastructure removed)');
  }
}

/**
 * Cleanup orphaned Quick Tabs whose origin tabs no longer exist.
 *
 * v1.6.3.7-v3 - API #4: Hourly orphan cleanup via browser.alarms
 * v1.6.3.9-v4 - Per ROBUST-QUICKTABS-ARCHITECTURE.md: Remove orphans and use _persistToStorage
 */
async function cleanupOrphanedQuickTabs() {
  console.info('[Background] ORPHAN_CLEANUP_START tabCount=' + globalQuickTabState.tabs.length);

  const initGuard = checkInitializationGuard('cleanupOrphanedQuickTabs');
  if (!initGuard.initialized) {
    console.warn('[Background] Skipping cleanup - not initialized');
    return;
  }

  try {
    // Get all open browser tabs
    const allTabs = await browser.tabs.query({});
    const validTabIds = new Set(allTabs.map(t => t.id));

    // Find orphaned Quick Tabs (their origin tab no longer exists)
    const orphaned = globalQuickTabState.tabs.filter(qt => !validTabIds.has(qt.originTabId));

    if (orphaned.length === 0) {
      console.log('[Background] No orphaned Quick Tabs found');
      return;
    }

    console.log(
      '[Background] Found',
      orphaned.length,
      'orphaned Quick Tabs:',
      orphaned.map(t => ({ id: t.id, originTabId: t.originTabId }))
    );

    // v1.6.3.9-v4 - Remove orphans from state (per spec - was marking before)
    globalQuickTabState.tabs = globalQuickTabState.tabs.filter(qt => validTabIds.has(qt.originTabId));
    globalQuickTabState.lastModified = Date.now();
    globalQuickTabState.lastUpdate = Date.now(); // Backwards compatibility

    // Persist using new simplified function
    await _persistToStorage();

    console.info('[Background] ORPHAN_CLEANUP_COMPLETE removed=' + orphaned.length);
  } catch (err) {
    console.error('[Background] ORPHAN_CLEANUP_ERROR error=' + err.message);
  }
}

/**
 * Sync session state between storage layers
 * v1.6.3.7-v3 - API #4: Periodic session state validation
 */
async function syncSessionState() {
  console.log('[Background] Running session state sync...');

  const initGuard = checkInitializationGuard('syncSessionState');
  if (!initGuard.initialized) {
    console.warn('[Background] Skipping sync - not initialized');
    return;
  }

  // Early exit if session storage not available
  if (typeof browser.storage.session === 'undefined') {
    console.log('[Background] Session storage not available, skipping sync');
    return;
  }

  try {
    await _performSessionSync();
  } catch (err) {
    console.error('[Background] Session sync failed:', err.message);
  }
}

/**
 * Extract tabs array from storage result
 * v1.6.4.14 - FIX Complexity: Extracted to reduce _performSessionSync cc
 * @private
 * @param {Object} result - Storage get result
 * @param {string} key - Storage key
 * @returns {Array} Tabs array or empty array
 */
function _extractTabsFromResult(result, key) {
  return result?.[key]?.tabs || [];
}

/**
 * Perform the actual session sync operation
 * v1.6.3.7-v3 - API #4: Extracted to reduce max-depth in syncSessionState
 * v1.6.4.14 - FIX Complexity: Extracted _extractTabsFromResult (cc=10 → cc=4)
 * @private
 */
async function _performSessionSync() {
  const sessionResult = await browser.storage.session.get('quick_tabs_session');
  const localResult = await browser.storage.local.get('quick_tabs_state_v2');

  const sessionTabs = _extractTabsFromResult(sessionResult, 'quick_tabs_session');
  const localTabs = _extractTabsFromResult(localResult, 'quick_tabs_state_v2');

  console.log('[Background] Session sync check:', {
    sessionTabCount: sessionTabs.length,
    localTabCount: localTabs.length,
    cacheTabCount: globalQuickTabState.tabs?.length || 0
  });

  // If session storage has fewer tabs than local, re-sync
  if (sessionTabs.length < localTabs.length) {
    console.log('[Background] Session storage out of sync - re-syncing from local');
    await browser.storage.session.set({
      quick_tabs_session: {
        tabs: localTabs,
        timestamp: Date.now()
      }
    });
  }
}

/**
 * Check storage.local quota usage and log warnings at thresholds
 * v1.6.3.8-v6 - Issue #4: Storage quota monitoring
 * v1.6.3.8-v8 - Issue #4: Adaptive monitoring frequency
 * v1.6.3.8-v8 - Issue #17: Aggregated storage usage tracking
 * Logs warnings at 50%, 75%, 90% of 10MB limit
 */
async function checkStorageQuota() {
  console.log('[Background] v1.6.3.8-v8 Running storage quota check...');

  try {
    // v1.6.3.8-v8 - Issue #17: Get aggregated usage across all storage areas
    const aggregatedUsage = await _getAggregatedStorageUsage();
    const bytesInUse = aggregatedUsage.localBytes;
    const percentUsed = aggregatedUsage.aggregatedBytes / STORAGE_LOCAL_QUOTA_BYTES;

    _updateStorageQuotaSnapshot(bytesInUse, percentUsed, aggregatedUsage);
    _checkAndLogThresholdWarning(bytesInUse, percentUsed);
    _checkThresholdRecovery(bytesInUse, percentUsed);
    _logStorageQuotaStatus(bytesInUse, percentUsed, aggregatedUsage);

    // v1.6.3.8-v8 - Issue #4: Adjust monitoring frequency based on usage
    await _adjustStorageQuotaMonitoringFrequency(percentUsed);
  } catch (err) {
    console.error('[Background] STORAGE_QUOTA_CHECK_FAILED:', {
      error: err.message,
      timestamp: Date.now()
    });
  }
}

/**
 * Get storage bytes in use
 * v1.6.3.8-v6 - Issue #4: Extracted to reduce nesting
 * @private
 * @returns {Promise<number>} Bytes in use
 */
async function _getStorageBytesInUse() {
  if (typeof browser.storage.local.getBytesInUse === 'function') {
    return browser.storage.local.getBytesInUse(null);
  }
  return _estimateStorageUsage();
}

/**
 * Update storage quota snapshot
 * v1.6.3.8-v6 - Issue #4: Extracted to reduce nesting
 * v1.6.3.8-v8 - Issue #17: Include aggregated usage details
 * @private
 * @param {number} bytesInUse - Local storage bytes
 * @param {number} percentUsed - Usage percentage (0-1)
 * @param {Object} [aggregatedUsage] - Per-area usage breakdown
 */
function _updateStorageQuotaSnapshot(bytesInUse, percentUsed, aggregatedUsage = null) {
  _lastStorageQuotaSnapshot = {
    bytesInUse,
    percentUsed,
    lastChecked: Date.now(),
    thresholdLevel: null,
    // v1.6.3.8-v8 - Issue #17: Per-area usage tracking
    localBytes: aggregatedUsage?.localBytes || bytesInUse,
    syncBytes: aggregatedUsage?.syncBytes || 0,
    sessionBytes: aggregatedUsage?.sessionBytes || 0,
    aggregatedBytes: aggregatedUsage?.aggregatedBytes || bytesInUse
  };
}

/**
 * Check and log threshold warning if needed
 * v1.6.3.8-v6 - Issue #4: Extracted to reduce nesting
 * @private
 */
function _checkAndLogThresholdWarning(bytesInUse, percentUsed) {
  for (let i = STORAGE_QUOTA_WARNING_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = STORAGE_QUOTA_WARNING_THRESHOLDS[i];
    if (percentUsed < threshold.percent) continue;

    _lastStorageQuotaSnapshot.thresholdLevel = threshold.level;
    if (_lastStorageQuotaThresholdLevel !== threshold.level) {
      _logStorageQuotaWarning(bytesInUse, percentUsed, threshold);
      _lastStorageQuotaThresholdLevel = threshold.level;
    }
    break;
  }
}

/**
 * Check and log threshold recovery if needed
 * v1.6.3.8-v6 - Issue #4: Extracted to reduce nesting
 * @private
 */
function _checkThresholdRecovery(bytesInUse, percentUsed) {
  if (percentUsed >= STORAGE_QUOTA_WARNING_THRESHOLDS[0].percent) return;
  if (_lastStorageQuotaThresholdLevel === null) return;

  console.log('[Background] STORAGE_QUOTA_RECOVERED:', {
    bytesInUse,
    percentUsed: (percentUsed * 100).toFixed(1) + '%',
    previousLevel: _lastStorageQuotaThresholdLevel,
    timestamp: Date.now()
  });
  _lastStorageQuotaThresholdLevel = null;
}

/**
 * Log storage quota status
 * v1.6.3.8-v6 - Issue #4: Extracted to reduce nesting
 * v1.6.3.8-v8 - Issue #17: Include per-area usage breakdown
 * @private
 * @param {number} bytesInUse - Local storage bytes
 * @param {number} percentUsed - Usage percentage (0-1)
 * @param {Object} [aggregatedUsage] - Per-area usage breakdown
 */
function _logStorageQuotaStatus(bytesInUse, percentUsed, aggregatedUsage = null) {
  console.log('[Background] STORAGE_QUOTA_STATUS:', {
    bytesInUse,
    bytesInUseMB: (bytesInUse / (1024 * 1024)).toFixed(2) + 'MB',
    percentUsed: (percentUsed * 100).toFixed(1) + '%',
    quotaLimitMB: (STORAGE_LOCAL_QUOTA_BYTES / (1024 * 1024)).toFixed(0) + 'MB',
    thresholdLevel: _lastStorageQuotaSnapshot.thresholdLevel || 'OK',
    // v1.6.3.8-v8 - Issue #17: Per-area usage breakdown
    perAreaUsage: aggregatedUsage
      ? {
          localMB: (aggregatedUsage.localBytes / (1024 * 1024)).toFixed(3) + 'MB',
          syncMB: (aggregatedUsage.syncBytes / (1024 * 1024)).toFixed(3) + 'MB',
          sessionMB: (aggregatedUsage.sessionBytes / (1024 * 1024)).toFixed(3) + 'MB',
          aggregatedMB: (aggregatedUsage.aggregatedBytes / (1024 * 1024)).toFixed(3) + 'MB'
        }
      : null,
    monitoringMode: _storageQuotaMonitoringMode,
    timestamp: Date.now()
  });
}

/**
 * Estimate storage usage by serializing storage contents
 * v1.6.3.8-v6 - Issue #4: Fallback for browsers without getBytesInUse
 * @private
 * @returns {Promise<number>} Estimated bytes in use
 */
async function _estimateStorageUsage() {
  try {
    const data = await browser.storage.local.get(null);
    const serialized = JSON.stringify(data);
    return new Blob([serialized]).size;
  } catch (_err) {
    return 0;
  }
}

/**
 * Get aggregated storage usage across all storage areas
 * v1.6.3.8-v8 - Issue #17: Track usage across local, sync, and session storage
 * Firefox MV2 extensions have a shared 10MB quota for storage.local
 * storage.sync has a 5KB item limit and 100KB total limit
 * storage.session has variable limits
 * @private
 * @returns {Promise<Object>} Per-area and aggregated usage
 */
async function _getAggregatedStorageUsage() {
  const usage = {
    localBytes: 0,
    syncBytes: 0,
    sessionBytes: 0,
    aggregatedBytes: 0
  };

  try {
    // Get storage.local usage (primary)
    usage.localBytes = await _getLocalStorageBytes();

    // Get storage.sync usage
    usage.syncBytes = await _getSyncStorageBytes();

    // Estimate storage.session usage (Firefox 115+)
    usage.sessionBytes = await _getSessionStorageBytes();

    // Calculate aggregated total
    usage.aggregatedBytes = usage.localBytes + usage.syncBytes + usage.sessionBytes;

    console.log('[Background] STORAGE_USAGE_AGGREGATED:', {
      localBytes: usage.localBytes,
      syncBytes: usage.syncBytes,
      sessionBytes: usage.sessionBytes,
      aggregatedBytes: usage.aggregatedBytes,
      timestamp: Date.now()
    });

    return usage;
  } catch (err) {
    console.error('[Background] _getAggregatedStorageUsage error:', err.message);
    // Fall back to local-only usage
    usage.aggregatedBytes = usage.localBytes;
    return usage;
  }
}

/**
 * Get storage.local bytes in use
 * v1.6.3.8-v8 - Issue #17: Extracted to reduce nesting
 * @private
 * @returns {Promise<number>} Bytes in use
 */
async function _getLocalStorageBytes() {
  if (typeof browser.storage.local.getBytesInUse === 'function') {
    return browser.storage.local.getBytesInUse(null);
  }
  return _estimateStorageUsage();
}

/**
 * Get storage.sync bytes in use
 * v1.6.3.8-v8 - Issue #17: Extracted to reduce nesting
 * @private
 * @returns {Promise<number>} Bytes in use
 */
async function _getSyncStorageBytes() {
  try {
    if (typeof browser.storage.sync?.getBytesInUse === 'function') {
      return browser.storage.sync.getBytesInUse(null);
    }
    if (browser.storage.sync) {
      // Estimate sync storage size
      const syncData = await browser.storage.sync.get(null);
      return new Blob([JSON.stringify(syncData)]).size;
    }
    return 0;
  } catch (_syncErr) {
    // storage.sync may not be available or may throw
    return 0;
  }
}

/**
 * Get storage.session bytes in use (Firefox 115+)
 * v1.6.3.8-v8 - Issue #17: Extracted to reduce nesting
 * @private
 * @returns {Promise<number>} Estimated bytes in use
 */
async function _getSessionStorageBytes() {
  try {
    if (!browser.storage.session) return 0;
    const sessionData = await browser.storage.session.get(null);
    const sessionKeys = Object.keys(sessionData);
    if (sessionKeys.length === 0) return 0;
    return new Blob([JSON.stringify(sessionData)]).size;
  } catch (_sessionErr) {
    // storage.session may not be available
    return 0;
  }
}

/**
 * Check if storage quota is in high usage state (>50%)
 * v1.6.3.8-v8 - Issue #4: Helper for adaptive monitoring decision
 * @private
 * @param {number} percentUsed - Usage percentage (0-1)
 * @returns {boolean} True if quota exceeds high usage threshold
 */
function _isQuotaHighUsage(percentUsed) {
  return percentUsed >= STORAGE_QUOTA_HIGH_USAGE_THRESHOLD;
}

/**
 * Determine target monitoring mode based on usage with hysteresis
 * v1.6.3.8-v8 - Issue #4: Extracted to reduce complexity
 * @private
 * @param {number} percentUsed - Usage percentage (0-1)
 * @returns {string} Target mode ('fast' or 'normal')
 */
function _determineTargetMonitoringMode(percentUsed) {
  const wasHighUsage = _storageQuotaMonitoringMode === 'fast';
  const isHighUsage = _isQuotaHighUsage(percentUsed);
  const isLowUsage = percentUsed < STORAGE_QUOTA_LOW_USAGE_THRESHOLD;

  // Apply hysteresis to prevent oscillation
  if (isHighUsage && !wasHighUsage) return 'fast';
  if (isLowUsage && wasHighUsage) return 'normal';
  return _storageQuotaMonitoringMode;
}

/**
 * Update storage quota alarm with new interval
 * v1.6.3.8-v8 - Issue #4: Extracted to reduce complexity
 * @private
 * @param {string} targetMode - Target monitoring mode
 * @param {number} percentUsed - Current usage percentage
 */
async function _updateStorageQuotaAlarm(targetMode, percentUsed) {
  const wasHighUsage = _storageQuotaMonitoringMode === 'fast';
  _storageQuotaMonitoringMode = targetMode;

  const newInterval =
    targetMode === 'fast'
      ? ALARM_STORAGE_QUOTA_INTERVAL_FAST_MIN
      : ALARM_STORAGE_QUOTA_INTERVAL_MIN;

  console.log('[Background] STORAGE_QUOTA_MONITORING_MODE_CHANGED:', {
    previousMode: wasHighUsage ? 'fast' : 'normal',
    newMode: targetMode,
    newIntervalMin: newInterval,
    percentUsed: (percentUsed * 100).toFixed(1) + '%',
    timestamp: Date.now()
  });

  try {
    await browser.alarms.clear(ALARM_STORAGE_QUOTA_CHECK);
    await browser.alarms.create(ALARM_STORAGE_QUOTA_CHECK, {
      delayInMinutes: newInterval,
      periodInMinutes: newInterval
    });
  } catch (err) {
    console.error('[Background] Failed to update storage quota alarm:', err.message);
  }
}

/**
 * Adjust storage quota monitoring frequency based on usage level
 * v1.6.3.8-v8 - Issue #4: Adaptive monitoring - fast (1 min) when >50%, normal (5 min) when <40%
 * Uses hysteresis (50%/40%) to prevent oscillation between modes
 * @private
 * @param {number} percentUsed - Current usage percentage (0-1)
 */
async function _adjustStorageQuotaMonitoringFrequency(percentUsed) {
  const targetMode = _determineTargetMonitoringMode(percentUsed);

  // Only update alarm if mode changed
  if (targetMode === _storageQuotaMonitoringMode) return;

  await _updateStorageQuotaAlarm(targetMode, percentUsed);
}

/**
 * Log storage quota warning at threshold level
 * v1.6.3.8-v6 - Issue #4: Threshold-based logging
 * @private
 * @param {number} bytesInUse - Current bytes in use
 * @param {number} percentUsed - Usage as decimal (0-1)
 * @param {Object} threshold - Threshold config with level and message
 */
function _logStorageQuotaWarning(bytesInUse, percentUsed, threshold) {
  const logData = {
    bytesInUse,
    bytesInUseMB: (bytesInUse / (1024 * 1024)).toFixed(2) + 'MB',
    percentUsed: (percentUsed * 100).toFixed(1) + '%',
    threshold: threshold.percent * 100 + '%',
    level: threshold.level,
    message: threshold.message,
    quotaLimitMB: (STORAGE_LOCAL_QUOTA_BYTES / (1024 * 1024)).toFixed(0) + 'MB',
    timestamp: Date.now()
  };

  if (threshold.level === 'CRITICAL') {
    console.error('[Background] STORAGE_QUOTA_CRITICAL:', logData);
  } else if (threshold.level === 'WARN') {
    console.warn('[Background] STORAGE_QUOTA_WARNING:', logData);
  } else {
    console.info('[Background] STORAGE_QUOTA_INFO:', logData);
  }
}

/**
 * Get storage quota snapshot for diagnostic reports
 * v1.6.3.8-v6 - Issue #4: Include in diagnostic snapshots
 * @returns {Object} Storage quota snapshot
 */
function _getStorageQuotaSnapshot() {
  return { ..._lastStorageQuotaSnapshot };
}

/**
 * Log diagnostic snapshot of current state
 * v1.6.3.7-v3 - API #4: Periodic diagnostic logging
 * v1.6.3.8-v12 - Port infrastructure removed, simplified logging
 */
function logDiagnosticSnapshot() {
  console.log('[Background] ==================== DIAGNOSTIC SNAPSHOT ====================');
  console.log('[Background] Timestamp:', new Date().toISOString());
  console.log('[Background] Cache state:', {
    tabCount: globalQuickTabState.tabs?.length || 0,
    lastUpdate: globalQuickTabState.lastUpdate,
    saveId: globalQuickTabState.saveId,
    isInitialized
  });

  // v1.6.3.8 - Issue #9: Include keepalive health in diagnostic snapshot
  console.log('[Background] Keepalive health:', {
    summary: `keepalive health: ${_getKeepaliveHealthSummary()}`,
    lastSuccessTime: new Date(lastKeepaliveSuccessTime).toISOString(),
    timeSinceLastSuccessMs: Date.now() - lastKeepaliveSuccessTime,
    consecutiveFailures: consecutiveKeepaliveFailures,
    totalSuccessCount: keepaliveSuccessCount
  });

  // v1.6.3.8-v12 - Port infrastructure removed
  console.log('[Background] Messaging:', {
    architecture: 'tabs.sendMessage + storage.onChanged',
    portInfrastructure: 'REMOVED in v1.6.3.8-v12'
  });

  console.log('[Background] Quick Tab host tracking:', {
    trackedQuickTabs: quickTabHostTabs.size
  });

  // v1.6.3.9-v2 - Issue #6: Include tab events diagnostics
  console.log('[Background] Tab events:', getTabEventsDiagnostics());

  // v1.6.3.7-v12 - Issue #6: Include dedup statistics
  // v1.6.3.8-v6 - Issue #11: Enhanced with tier counts and history
  const total = dedupStats.skipped + dedupStats.processed;
  console.log('[Background] Dedup statistics:', {
    skipped: dedupStats.skipped,
    processed: dedupStats.processed,
    totalSinceReset: total,
    skipRate: total > 0 ? ((dedupStats.skipped / total) * 100).toFixed(1) + '%' : 'N/A',
    tierCounts: dedupStats.tierCounts,
    historyBuckets: dedupStatsHistory.length,
    // v1.6.3.8-v6 - Issue #11: Include 5-minute average skip rate
    avgSkipRateLast5Min: _calculateAvgSkipRate(),
    lastResetTime: new Date(dedupStats.lastResetTime).toISOString()
  });

  // v1.6.3.8-v6 - Issue #4: Include storage quota in diagnostic snapshot
  const quotaSnapshot = _getStorageQuotaSnapshot();
  console.log('[Background] Storage quota:', {
    bytesInUse: quotaSnapshot.bytesInUse,
    bytesInUseMB:
      quotaSnapshot.bytesInUse > 0
        ? (quotaSnapshot.bytesInUse / (1024 * 1024)).toFixed(2) + 'MB'
        : 'unknown',
    percentUsed:
      quotaSnapshot.percentUsed > 0
        ? (quotaSnapshot.percentUsed * 100).toFixed(1) + '%'
        : 'unknown',
    thresholdLevel: quotaSnapshot.thresholdLevel || 'OK',
    lastChecked:
      quotaSnapshot.lastChecked > 0 ? new Date(quotaSnapshot.lastChecked).toISOString() : 'never'
  });

  console.log('[Background] =================================================================');
}

/**
 * Calculate average skip rate from dedup history
 * v1.6.3.8-v6 - Issue #11: Helper for 5-minute average skip rate
 * @private
 * @returns {string} Average skip rate or 'N/A' if no history
 */
function _calculateAvgSkipRate() {
  if (!dedupStatsHistory || dedupStatsHistory.length === 0) {
    return 'N/A';
  }
  const totalSkipped = dedupStatsHistory.reduce((sum, h) => sum + h.skipped, 0);
  const totalProcessed = dedupStatsHistory.reduce((sum, h) => sum + h.processed, 0);
  const total = totalSkipped + totalProcessed;
  if (total === 0) return 'N/A';
  return ((totalSkipped / total) * 100).toFixed(1) + '%';
}

/**
 * Format milliseconds as human-readable duration
 * v1.6.3.8 - Issue #10: Helper for formatting duration
 * @private
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function _formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

/**
 * Start dedup statistics logging
 * v1.6.3.7-v12 - Issue #6: Log dedup statistics every 60 seconds
 * v1.6.3.8-v6 - Issue #11: Include tier counts, longer history, and port failure correlation
 */
function startDedupStatsLogging() {
  if (dedupStatsIntervalId) {
    clearInterval(dedupStatsIntervalId);
  }

  dedupStatsIntervalId = setInterval(() => {
    const total = dedupStats.skipped + dedupStats.processed;
    if (total > 0) {
      // v1.6.3.8-v6 - Issue #11: Calculate skip rate for correlation
      const skipRate = ((dedupStats.skipped / total) * 100).toFixed(1);

      // v1.6.3.8-v6 - Issue #11: Correlate with port failures
      const portFailureCorrelation =
        consecutiveKeepaliveFailures > 2
          ? 'HIGH_PORT_FAILURES'
          : consecutiveKeepaliveFailures > 0
            ? 'SOME_PORT_FAILURES'
            : 'HEALTHY';

      console.log('[Background] [STORAGE] DEDUP_STATS:', {
        skipped: dedupStats.skipped,
        processed: dedupStats.processed,
        total,
        skipRate: skipRate + '%',
        tierCounts: dedupStats.tierCounts,
        portFailureCorrelation,
        consecutivePortFailures: consecutiveKeepaliveFailures,
        historyBuckets: dedupStatsHistory.length,
        intervalMs: DEDUP_STATS_LOG_INTERVAL_MS,
        timestamp: Date.now()
      });

      // v1.6.3.8-v6 - Issue #11: Add to longer-lived history
      dedupStatsHistory.push({
        timestamp: Date.now(),
        skipped: dedupStats.skipped,
        processed: dedupStats.processed,
        tierCounts: { ...dedupStats.tierCounts },
        skipRate: parseFloat(skipRate)
      });

      // Keep only last N buckets
      if (dedupStatsHistory.length > DEDUP_HISTORY_BUCKETS) {
        dedupStatsHistory.shift();
      }
    }

    // Reset stats after logging (but keep history)
    // v1.6.3.8-v8 - Issue #18: Include staleEventAge in reset
    dedupStats = {
      skipped: 0,
      processed: 0,
      lastResetTime: Date.now(),
      tierCounts: {
        staleEventAge: 0, // Issue #18: Max event age check
        saveId: 0,
        sequenceId: 0,
        revision: 0,
        contentHash: 0
      }
    };
  }, DEDUP_STATS_LOG_INTERVAL_MS);

  console.log(
    '[Background] [STORAGE] Dedup stats logging started (every',
    DEDUP_STATS_LOG_INTERVAL_MS / 1000,
    's)'
  );
}

// Start dedup stats logging on script load (port registry monitoring removed)
// v1.6.3.8-v12 - Port infrastructure removed
startDedupStatsLogging();

// Register alarm listener
browser.alarms.onAlarm.addListener(handleAlarm);

// Initialize alarms on script load
initializeAlarms();

// ==================== v1.6.4.14 PHASE 3A OPTIMIZATION INITIALIZATION ====================

/**
 * Initialize Phase 3A optimization modules
 * v1.6.4.14 - StorageCache, MemoryMonitor, PerformanceMetrics
 */
function initializePhase3AOptimizations() {
  console.log('[Background] v1.6.4.14 Initializing Phase 3A optimizations...');

  // 1. Initialize PerformanceMetrics collection
  PerformanceMetrics.startCollection({ flushIntervalMs: 60000 }); // Flush every minute
  console.log('[Background] PerformanceMetrics collection started');

  // 2. Initialize MemoryMonitor with cleanup callbacks
  const memoryOptions = {
    memoryLimitMB: 150,
    thresholdPercent: 0.8,
    intervalMs: 60000 // Check every 60 seconds
  };

  // Register cleanup callbacks for when memory threshold is exceeded
  MemoryMonitor.registerCleanupCallback('invalidate-storage-cache', snapshot => {
    console.log('[Background] Memory cleanup: Invalidating storage cache', {
      usedMB: snapshot.usedMB
    });
    StorageCache.clearCache();
  });

  MemoryMonitor.registerCleanupCallback('clear-performance-samples', snapshot => {
    console.log('[Background] Memory cleanup: Clearing old performance samples', {
      usedMB: snapshot.usedMB
    });
    // Log metrics count before clearing for visibility
    const operationCount = Object.keys(PerformanceMetrics.getMetricsSummary()).length;
    console.log('[Background] Clearing metrics for', operationCount, 'tracked operations');
    PerformanceMetrics.clearMetrics();
  });

  MemoryMonitor.startMonitoring(memoryOptions);
  console.log('[Background] MemoryMonitor started with', memoryOptions.memoryLimitMB, 'MB limit');

  // 3. StorageCache is used on-demand (initialized in-module)
  // Configure TTL
  StorageCache.setTTL(30000); // 30 second TTL
  console.log('[Background] StorageCache configured with 30s TTL');

  console.log('[Background] v1.6.4.14 Phase 3A optimizations initialized');
}

// Initialize Phase 3A optimizations on script load
initializePhase3AOptimizations();

// ==================== END PHASE 3A OPTIMIZATION INITIALIZATION ====================

// ==================== END ALARMS MECHANISM ====================

// ==================== v1.6.3.7-v9 ISSUE #8: STORAGE INTEGRITY VALIDATION ====================
// FIX Issue #8: Implement storage integrity validation to detect IndexedDB corruption

/**
 * Run all validation checks on read-back data
 * v1.6.4.14 - FIX Complexity: Extracted to reduce validateStorageWrite cc from 16
 * @private
/**
 * Run validation sequence and return first failure
 * v1.6.4.14 - FIX Complexity: Extracted from _runValidationChecks
 * @private
 */
function _runValidatorSequence(validators) {
  for (const validator of validators) {
    const result = validator();
    if (result) return result;
  }
  return null;
}

/**
 * Run all validation checks on read-back data
 * v1.6.4.14 - FIX Complexity: Extracted to reduce validateStorageWrite cc from 16
 * v1.6.4.14 - FIX Complexity: Extracted _runValidatorSequence (cc=9 → cc=5)
 * @private
 * @param {Object} validationContext - Context for validation
 * @param {Object} readBack - Data read back from storage
 * @param {string} storageKey - Storage key used
 * @returns {Object|null} Error result if validation failed, null if passed
 */
function _runValidationChecks(validationContext, readBack, storageKey) {
  const { expectedData } = validationContext;

  // Check if data exists
  if (!readBack) {
    const tabCount = expectedData?.tabs?.length || 0;
    return _logValidationFailed({
      ...validationContext,
      errorCode: 'READ_RETURNED_NULL',
      storageKey,
      extraInfo: { expectedTabCount: tabCount }
    });
  }

  // Run validation sequence - return first failure or null
  return _runValidatorSequence([
    () => _validateSaveId({ ...validationContext, readBack }),
    () => _validateTabCount({ ...validationContext, readBack }),
    () =>
      _validateRuntimeChecksum({
        ...validationContext,
        readBack,
        tabCount: readBack.tabs?.length || 0
      })
  ]);
}

/**
 * Validate that storage write was successful by reading back and comparing
 * v1.6.3.7-v9 - FIX Issue #8: Detect IndexedDB corruption after writes
 * v1.6.4.14 - FIX Complexity: Extracted _runValidationChecks helper (cc=16 → cc=5)
 * @param {string} operationId - Unique operation ID for tracing
 * @param {Object} expectedData - Data that was written
 * @param {string} storageKey - Storage key used
 * @param {number} retryAttempt - Current retry attempt (0-based)
 * @returns {Promise<{valid: boolean, readBack: Object|null, error: string|null}>}
 */
async function validateStorageWrite(operationId, expectedData, storageKey, retryAttempt = 0) {
  const validationStart = Date.now();
  const validationContext = { operationId, expectedData, retryAttempt, validationStart };

  try {
    // Read back the data immediately after write
    const result = await browser.storage.local.get(storageKey);
    const readBack = result?.[storageKey];

    // Run all validation checks
    const failureResult = _runValidationChecks(validationContext, readBack, storageKey);
    if (failureResult) return failureResult;

    // Validation passed
    console.log('[Background] STORAGE_VALIDATION_PASSED:', {
      operationId,
      saveId: expectedData.saveId,
      tabCount: readBack?.tabs?.length || 0,
      checksum: _computeStorageChecksum(readBack),
      retryAttempt,
      validationDurationMs: Date.now() - validationStart
    });

    return { valid: true, readBack, error: null };
  } catch (err) {
    console.error('[Background] STORAGE_VALIDATION_ERROR:', {
      operationId,
      error: err.message,
      retryAttempt,
      validationDurationMs: Date.now() - validationStart
    });
    return { valid: false, readBack: null, error: `VALIDATION_EXCEPTION: ${err.message}` };
  }
}

/**
 * Log validation failure and return error result
 * v1.6.4.13 - FIX Issue #17: Extracted to reduce validateStorageWrite complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 * @param {string} options.operationId - Operation ID
 * @param {string} options.errorCode - Error code
 * @param {string} options.storageKey - Storage key
 * @param {number} options.retryAttempt - Retry attempt
 * @param {number} options.validationStart - Validation start time
 * @param {Object} [options.extraInfo={}] - Extra info for logging
 */
function _logValidationFailed({
  operationId,
  errorCode,
  storageKey,
  retryAttempt,
  validationStart,
  extraInfo = {}
}) {
  console.error(`[Background] STORAGE_VALIDATION_FAILED: ${errorCode}`, {
    operationId,
    storageKey,
    retryAttempt,
    validationDurationMs: Date.now() - validationStart,
    ...extraInfo
  });
  return { valid: false, readBack: null, error: errorCode };
}

/**
 * Validate saveId matches
 * v1.6.4.13 - FIX Issue #17: Extracted to reduce validateStorageWrite complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 */
function _validateSaveId({ operationId, expectedData, readBack, retryAttempt, validationStart }) {
  if (expectedData.saveId && readBack.saveId !== expectedData.saveId) {
    console.error('[Background] STORAGE_VALIDATION_FAILED: SaveId mismatch', {
      operationId,
      expectedSaveId: expectedData.saveId,
      actualSaveId: readBack.saveId,
      retryAttempt,
      validationDurationMs: Date.now() - validationStart
    });
    return { valid: false, readBack, error: 'SAVEID_MISMATCH' };
  }
  return null;
}

/**
 * Validate tab count matches
 * v1.6.4.13 - FIX Issue #17: Extracted to reduce validateStorageWrite complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 */
function _validateTabCount({ operationId, expectedData, readBack, retryAttempt, validationStart }) {
  const expectedTabCount = expectedData?.tabs?.length || 0;
  const actualTabCount = readBack?.tabs?.length || 0;

  if (expectedTabCount !== actualTabCount) {
    console.error('[Background] STORAGE_VALIDATION_FAILED: Tab count mismatch', {
      operationId,
      expectedTabCount,
      actualTabCount,
      retryAttempt,
      validationDurationMs: Date.now() - validationStart
    });
    return { valid: false, readBack, error: 'TAB_COUNT_MISMATCH' };
  }
  return null;
}

/**
 * Validate checksums match during runtime storage write validation
 * v1.6.4.13 - FIX Issue #17: Extracted to reduce validateStorageWrite complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 * @returns {Object|null} Error result if checksum mismatch, null if valid
 */
function _validateRuntimeChecksum({
  operationId,
  expectedData,
  readBack,
  tabCount,
  retryAttempt,
  validationStart
}) {
  const expectedChecksum = _computeStorageChecksum(expectedData);
  const actualChecksum = _computeStorageChecksum(readBack);

  if (expectedChecksum !== actualChecksum) {
    console.error('[Background] STORAGE_VALIDATION_FAILED: Checksum mismatch', {
      operationId,
      expectedChecksum,
      actualChecksum,
      tabCount,
      retryAttempt,
      validationDurationMs: Date.now() - validationStart
    });
    return { valid: false, readBack, error: 'CHECKSUM_MISMATCH' };
  }

  return null; // Checksum valid
}

/**
 * Perform single write attempt with validation
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce writeStorageWithValidation complexity
 * @private
 * @param {Object} stateToWrite - State to write
 * @param {string} storageKey - Storage key
 * @param {string} operationId - Operation ID
 * @param {number} attempt - Attempt number (0-based)
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function _performWriteAttempt(stateToWrite, storageKey, operationId, attempt) {
  // Perform the write
  await browser.storage.local.set({ [storageKey]: stateToWrite });

  // Wait a small delay before validation on retries
  if (attempt > 0) {
    await new Promise(resolve => setTimeout(resolve, STORAGE_VALIDATION_RETRY_DELAY_MS));
  }

  // Validate the write
  const validation = await validateStorageWrite(operationId, stateToWrite, storageKey, attempt);
  return validation;
}

/**
 * Log validation failure and return failure result
 * v1.6.3.7-v13 - Issue #2: Helper for _writeQuickTabStateWithValidation
 * @private
 */
function _logWriteValidationFailure(operationId, failureType, details) {
  console.error('[Background] STORAGE_WRITE_VALIDATION:', {
    operationId,
    result: 'FAILED',
    failureType,
    ...details
  });
}

/**
 * Build validation context metadata for logging
 * v1.6.3.7-v14 - FIX Complexity: Extracted to reduce _validateWriteReadback cc
 * @private
 */
function _buildValidationMeta(context) {
  return { durationMs: Date.now() - context.writeStart };
}

/**
 * Check if readback data is null/undefined
 * v1.6.3.7-v14 - FIX Complexity: Extracted validation check
 * @private
 */
function _checkNullReadback(readBack, stateToWrite, context) {
  if (readBack) return null;

  _logWriteValidationFailure(context.operationId, 'READ_RETURNED_NULL', {
    expectedTabs: context.expectedTabs,
    actualTabs: 0,
    saveId: stateToWrite.saveId,
    ..._buildValidationMeta(context)
  });
  return { valid: false, failureType: 'READ_RETURNED_NULL' };
}

/**
 * Check if saveId matches expected value
 * v1.6.3.7-v14 - FIX Complexity: Extracted validation check
 * @private
 */
function _checkSaveIdMatch(readBack, stateToWrite, context) {
  if (readBack.saveId === stateToWrite.saveId) return null;

  _logWriteValidationFailure(context.operationId, 'SAVEID_MISMATCH', {
    expectedSaveId: stateToWrite.saveId,
    actualSaveId: readBack.saveId,
    expectedTabs: context.expectedTabs,
    actualTabs: readBack?.tabs?.length || 0,
    ..._buildValidationMeta(context)
  });
  return { valid: false, failureType: 'SAVEID_MISMATCH', readBack };
}

/**
 * Check if tab count matches expected value
 * v1.6.3.7-v14 - FIX Complexity: Extracted validation check
 * @private
 */
function _checkTabCountMatch(readBack, stateToWrite, context) {
  const actualTabs = readBack?.tabs?.length || 0;
  if (context.expectedTabs === actualTabs) return null;

  _logWriteValidationFailure(context.operationId, 'TAB_COUNT_MISMATCH', {
    expectedTabs: context.expectedTabs,
    actualTabs,
    difference: context.expectedTabs - actualTabs,
    saveId: stateToWrite.saveId,
    ..._buildValidationMeta(context)
  });
  return { valid: false, failureType: 'TAB_COUNT_MISMATCH' };
}

/**
 * Check if checksum matches expected value
 * v1.6.3.7-v14 - FIX Complexity: Extracted validation check
 * @private
 */
function _checkChecksumMatch(readBack, stateToWrite, context) {
  const expectedChecksum = _computeStorageChecksum(stateToWrite);
  const actualChecksum = _computeStorageChecksum(readBack);
  if (expectedChecksum === actualChecksum) return null;

  const actualTabs = readBack?.tabs?.length || 0;
  _logWriteValidationFailure(context.operationId, 'CHECKSUM_MISMATCH', {
    expectedChecksum,
    actualChecksum,
    expectedTabs: context.expectedTabs,
    actualTabs,
    saveId: stateToWrite.saveId,
    ..._buildValidationMeta(context)
  });
  return { valid: false, failureType: 'CHECKSUM_MISMATCH' };
}

/**
 * Validate readback data against expected state
 * v1.6.3.7-v13 - Issue #2: Helper to reduce _writeQuickTabStateWithValidation complexity
 * v1.6.3.7-v14 - FIX Complexity: Extracted checks into separate functions
 * @private
 */
function _validateWriteReadback(stateToWrite, readBack, context) {
  // Run validation checks in order, return first failure
  const nullCheck = _checkNullReadback(readBack, stateToWrite, context);
  if (nullCheck) return nullCheck;

  const saveIdCheck = _checkSaveIdMatch(readBack, stateToWrite, context);
  if (saveIdCheck) return saveIdCheck;

  const tabCountCheck = _checkTabCountMatch(readBack, stateToWrite, context);
  if (tabCountCheck) return tabCountCheck;

  const checksumCheck = _checkChecksumMatch(readBack, stateToWrite, context);
  if (checksumCheck) return checksumCheck;

  return { valid: true, actualTabs: readBack?.tabs?.length || 0 };
}

/**
 * Centralized storage write with validation for direct writes in background.js
 * v1.6.3.7-v13 - Issue #2: Centralize all storage writes through validated path
 * @param {Object} stateToWrite - State object to write (must have saveId, tabs)
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<{success: boolean, operationId: string, error: string|null, recovered: boolean}>}
 */
async function _writeQuickTabStateWithValidation(stateToWrite, operationName) {
  const operationId = `${operationName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const storageKey = 'quick_tabs_state_v2';
  const writeStart = Date.now();
  const expectedTabs = stateToWrite?.tabs?.length || 0;
  const context = { operationId, expectedTabs, writeStart };

  if (DEBUG_DIAGNOSTICS) {
    console.log('[Background] STORAGE_WRITE_VALIDATION_START:', {
      operationId,
      operationName,
      saveId: stateToWrite.saveId,
      expectedTabs,
      sequenceId: stateToWrite.sequenceId,
      timestamp: writeStart
    });
  }

  try {
    await browser.storage.local.set({ [storageKey]: stateToWrite });
    const readResult = await browser.storage.local.get(storageKey);
    const readBack = readResult?.[storageKey];

    const validation = _validateWriteReadback(stateToWrite, readBack, context);

    if (!validation.valid) {
      const recoveryResult = await _attemptStorageWriteRecovery(
        operationId,
        stateToWrite,
        validation.failureType,
        validation.readBack
      );
      return {
        success: false,
        operationId,
        error: validation.failureType,
        recovered: recoveryResult.recovered
      };
    }

    console.log('[Background] STORAGE_WRITE_VALIDATION:', {
      operationId,
      result: 'PASSED',
      saveId: stateToWrite.saveId,
      expectedTabs,
      actualTabs: validation.actualTabs,
      checksumMatch: true,
      durationMs: Date.now() - writeStart
    });
    return { success: true, operationId, error: null, recovered: false };
  } catch (err) {
    console.error('[Background] STORAGE_WRITE_VALIDATION:', {
      operationId,
      result: 'ERROR',
      error: err.message,
      expectedTabs,
      saveId: stateToWrite.saveId,
      durationMs: Date.now() - writeStart
    });
    return { success: false, operationId, error: err.message, recovered: false };
  }
}

/**
 * Attempt recovery when storage write validation fails
 * v1.6.3.7-v13 - Issue #7: Type-specific recovery strategies
 *
 * Recovery strategies by failure type:
 * - READ_RETURNED_NULL: Likely quota exceeded - clear oldest Quick Tabs and retry
 * - TAB_COUNT_MISMATCH: Likely corruption - re-write state
 * - SAVEID_MISMATCH: Check sequence ID ordering - may be out-of-order event
 * - CHECKSUM_MISMATCH: Re-write state with new saveId
 *
 * @param {string} operationId - Operation ID for tracing
 * @param {Object} intendedState - State that failed to write
 * @param {string} failureType - Type of failure
 * @param {Object} [readBackState] - State read back from storage (if available)
 * @returns {Promise<{recovered: boolean, method: string, reason: string}>}
 */
/**
 * Map of recovery strategies by failure type
 * v1.6.3.7-v14 - FIX Complexity: Strategy map to reduce switch complexity
 * Note: All strategies receive (operationId, intendedState, readBackState) but some ignore readBackState
 * @private
 */
const RECOVERY_STRATEGIES = {
  READ_RETURNED_NULL: (operationId, intendedState, _readBackState) =>
    _recoverFromNullRead(operationId, intendedState),
  TAB_COUNT_MISMATCH: (operationId, intendedState, _readBackState) =>
    _recoverFromTabCountMismatch(operationId, intendedState),
  SAVEID_MISMATCH: (operationId, intendedState, readBackState) =>
    _recoverFromSaveIdMismatch(operationId, intendedState, readBackState),
  CHECKSUM_MISMATCH: (operationId, intendedState, _readBackState) =>
    _recoverFromChecksumMismatch(operationId, intendedState)
};

async function _attemptStorageWriteRecovery(
  operationId,
  intendedState,
  failureType,
  readBackState = null
) {
  console.log('[Background] RECOVERY_ATTEMPT:', {
    operationId,
    failureType,
    intendedTabCount: intendedState?.tabs?.length || 0,
    timestamp: Date.now()
  });

  try {
    const strategy = RECOVERY_STRATEGIES[failureType];
    if (!strategy) {
      console.warn('[Background] RECOVERY_UNKNOWN_FAILURE_TYPE:', { operationId, failureType });
      return { recovered: false, method: 'none', reason: `Unknown failure type: ${failureType}` };
    }
    return await strategy(operationId, intendedState, readBackState);
  } catch (err) {
    console.error('[Background] RECOVERY_ERROR:', {
      operationId,
      failureType,
      error: err.message,
      timestamp: Date.now()
    });
    return { recovered: false, method: 'error', reason: err.message };
  }
}

/**
 * Recover from null read (likely quota exceeded)
 * v1.6.3.7-v13 - Issue #7: Clear oldest Quick Tabs and retry
 * v1.6.3.8-v5 - Issue #4: Iterative recovery with progressive reduction (75% → 50% → 25%)
 * @private
 */
async function _recoverFromNullRead(operationId, intendedState) {
  console.log('[Background] RECOVERY_STRATEGY: Iterative quota recovery starting', {
    operationId,
    tabCount: intendedState?.tabs?.length || 0,
    recoveryPercentages: RECOVERY_PERCENTAGES,
    maxAttempts: RECOVERY_MAX_ATTEMPTS
  });

  // If not enough tabs to clear, fail early
  if (!intendedState?.tabs?.length || intendedState.tabs.length <= 1) {
    return _logRecoveryFailure(
      operationId,
      'READ_RETURNED_NULL',
      'storage quota may be exhausted - insufficient tabs to clear'
    );
  }

  // Sort by creationTime once (oldest first)
  const sortedTabs = [...intendedState.tabs].sort(
    (a, b) => (a.creationTime || 0) - (b.creationTime || 0)
  );

  // v1.6.3.8-v5 - Issue #4: Try each recovery percentage iteratively
  for (
    let attempt = 0;
    attempt < RECOVERY_PERCENTAGES.length && attempt < RECOVERY_MAX_ATTEMPTS;
    attempt++
  ) {
    const result = await _tryRecoveryAttempt(operationId, intendedState, sortedTabs, attempt);
    if (result.success) {
      return result.recoveryResult;
    }
  }

  // All attempts failed
  return _handleRecoveryExhausted(operationId, intendedState.tabs.length);
}

/**
 * Try a single recovery attempt at a given percentage
 * v1.6.3.8-v5 - Issue #4: Helper to reduce complexity in _recoverFromNullRead
 * @private
 */
async function _tryRecoveryAttempt(operationId, intendedState, sortedTabs, attempt) {
  const keepPercentage = RECOVERY_PERCENTAGES[attempt];
  const keepCount = Math.max(1, Math.floor(sortedTabs.length * keepPercentage));
  const reducedTabs = sortedTabs.slice(-keepCount); // Keep newest tabs
  const removedCount = intendedState.tabs.length - reducedTabs.length;

  _logRecoveryAttempt(
    operationId,
    attempt,
    keepPercentage,
    intendedState.tabs.length,
    keepCount,
    removedCount
  );

  const recoverySaveId = `recovery-null-${attempt + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const recoveryState = _buildIterativeRecoveryState(
    intendedState,
    reducedTabs,
    recoverySaveId,
    attempt,
    keepPercentage
  );

  const writeResult = await _tryRecoveryWrite(operationId, recoveryState, recoverySaveId);

  if (writeResult.success) {
    return {
      success: true,
      recoveryResult: _buildRecoverySuccessResult(
        operationId,
        intendedState,
        reducedTabs,
        removedCount,
        attempt,
        keepPercentage
      )
    };
  }

  // Apply backoff if more attempts remain
  await _applyRecoveryBackoff(operationId, attempt);
  return { success: false };
}

/**
 * Log a recovery attempt
 * v1.6.3.8-v5 - Issue #4: Helper for logging
 * @private
 */
function _logRecoveryAttempt(
  operationId,
  attempt,
  keepPercentage,
  originalCount,
  keepCount,
  removedCount
) {
  console.log('[Background] RECOVERY_ATTEMPT:', {
    operationId,
    attempt: attempt + 1,
    maxAttempts: RECOVERY_MAX_ATTEMPTS,
    keepPercentage: `${keepPercentage * 100}%`,
    originalTabCount: originalCount,
    keepCount,
    removedCount,
    timestamp: Date.now()
  });
}

/**
 * Build recovery state for iterative recovery
 * v1.6.3.8-v5 - Issue #4: Helper to build state object
 * @private
 */
function _buildIterativeRecoveryState(
  intendedState,
  reducedTabs,
  recoverySaveId,
  attempt,
  keepPercentage
) {
  return {
    ...intendedState,
    tabs: reducedTabs,
    saveId: recoverySaveId,
    recoveredFrom: 'READ_RETURNED_NULL',
    recoveryTimestamp: Date.now(),
    recoveryAttempt: attempt + 1,
    recoveryKeepPercentage: keepPercentage
  };
}

/**
 * Build success result and notify user if critical
 * v1.6.3.8-v5 - Issue #4: Helper for success handling
 * @private
 */
function _buildRecoverySuccessResult(
  operationId,
  intendedState,
  reducedTabs,
  removedCount,
  attempt,
  keepPercentage
) {
  console.log('[Background] RECOVERY_SUCCESS:', {
    operationId,
    method: 'clear-oldest-tabs',
    attempt: attempt + 1,
    keepPercentage: `${keepPercentage * 100}%`,
    originalTabCount: intendedState.tabs.length,
    newTabCount: reducedTabs.length,
    removedCount,
    timestamp: Date.now()
  });

  // Notify user at critical pruning levels (50% or more removed)
  if (keepPercentage <= 0.5) {
    _notifyUserOfDataPruning(operationId, attempt + 1, removedCount, intendedState.tabs.length);
  }

  return {
    recovered: true,
    method: 'clear-oldest-tabs',
    reason: `Cleared ${((1 - keepPercentage) * 100).toFixed(0)}% of oldest tabs (attempt ${attempt + 1})`,
    attempt: attempt + 1,
    keepPercentage,
    removedCount
  };
}

/**
 * Apply exponential backoff between recovery attempts
 * v1.6.3.8-v5 - Issue #4: Helper for backoff logic
 * @private
 */
async function _applyRecoveryBackoff(operationId, attempt) {
  if (attempt < RECOVERY_PERCENTAGES.length - 1) {
    const backoffMs = RECOVERY_BACKOFF_BASE_MS * Math.pow(2, attempt);
    console.log('[Background] RECOVERY_BACKOFF:', {
      operationId,
      attempt: attempt + 1,
      backoffMs,
      nextPercentage: `${RECOVERY_PERCENTAGES[attempt + 1] * 100}%`,
      timestamp: Date.now()
    });
    await _sleepMs(backoffMs);
  }
}

/**
 * Handle when all recovery attempts are exhausted
 * v1.6.3.8-v5 - Issue #4: Helper for exhausted handling
 * @private
 */
function _handleRecoveryExhausted(operationId, originalTabCount) {
  console.error('[Background] RECOVERY_EXHAUSTED:', {
    operationId,
    attemptsExhausted: RECOVERY_MAX_ATTEMPTS,
    percentagesTried: RECOVERY_PERCENTAGES.map(p => `${p * 100}%`).join(', '),
    timestamp: Date.now()
  });

  _notifyUserOfRecoveryFailure(operationId, originalTabCount);
  return _logRecoveryFailure(
    operationId,
    'READ_RETURNED_NULL',
    'storage quota recovery exhausted all attempts'
  );
}

/**
 * Sleep for specified milliseconds
 * v1.6.3.8-v5 - Issue #4: Helper for exponential backoff
 * @private
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function _sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Notify user of significant data pruning during quota recovery
 * v1.6.3.8-v5 - Issue #4: User notification at critical pruning levels
 * @private
 * @param {string} operationId - Operation ID for tracking
 * @param {number} attempt - Recovery attempt number
 * @param {number} removedCount - Number of tabs removed
 * @param {number} originalCount - Original tab count
 */
function _notifyUserOfDataPruning(operationId, attempt, removedCount, originalCount) {
  console.warn('[Background] RECOVERY_DATA_PRUNED:', {
    operationId,
    attempt,
    removedCount,
    originalCount,
    remainingCount: originalCount - removedCount,
    message: 'Significant Quick Tab data was pruned due to storage quota limits',
    timestamp: Date.now()
  });

  // Create notification if API available
  if (browser.notifications?.create) {
    browser.notifications
      .create(`quota-recovery-${operationId}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('images/icon48.png'),
        title: 'Quick Tabs Data Pruned',
        message: `${removedCount} oldest Quick Tab(s) were removed due to storage limits. ${originalCount - removedCount} tabs remain.`
      })
      .catch(err => {
        console.warn('[Background] Failed to create notification:', err.message);
      });
  }
}

/**
 * Notify user of complete quota recovery failure
 * v1.6.3.8-v5 - Issue #4: User notification when all recovery attempts fail
 * @private
 * @param {string} operationId - Operation ID for tracking
 * @param {number} originalCount - Original tab count before recovery attempts
 */
function _notifyUserOfRecoveryFailure(operationId, originalCount) {
  console.error('[Background] RECOVERY_COMPLETE_FAILURE:', {
    operationId,
    originalCount,
    message: 'All quota recovery attempts failed - manual intervention required',
    timestamp: Date.now()
  });

  // Create notification if API available
  if (browser.notifications?.create) {
    browser.notifications
      .create(`quota-failure-${operationId}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('images/icon48.png'),
        title: 'Quick Tabs Storage Error',
        message:
          'Storage quota exceeded and recovery failed. Please manually close some Quick Tabs to free space.'
      })
      .catch(err => {
        console.warn('[Background] Failed to create notification:', err.message);
      });
  }
}

/**
 * Try a recovery write and verify
 * v1.6.3.7-v13 - Issue #7: Helper to reduce nesting depth in recovery functions
 * @private
 */
async function _tryRecoveryWrite(operationId, recoveryState, expectedSaveId) {
  try {
    await browser.storage.local.set({ quick_tabs_state_v2: recoveryState });
    const verifyResult = await browser.storage.local.get('quick_tabs_state_v2');
    return { success: verifyResult?.quick_tabs_state_v2?.saveId === expectedSaveId };
  } catch (err) {
    console.error('[Background] RECOVERY_RETRY_FAILED:', { operationId, error: err.message });
    return { success: false };
  }
}

/**
 * Log recovery failure and return failure result
 * v1.6.3.7-v13 - Issue #7: Helper to reduce duplication in recovery functions
 * @private
 */
function _logRecoveryFailure(operationId, failureType, recommendation) {
  console.error('[Background] RECOVERY_FAILED:', {
    operationId,
    failureType,
    recommendation: `Manual intervention required - ${recommendation}`,
    timestamp: Date.now()
  });
  return { recovered: false, method: 'none', reason: `Unable to recover from ${failureType}` };
}

/**
 * Generate recovery save ID with type prefix
 * v1.6.3.7-v14 - FIX Duplication: Extracted common pattern
 * @private
 */
function _generateRecoverySaveId(type) {
  return `recovery-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Build recovery state from intended state
 * v1.6.3.7-v14 - FIX Duplication: Extracted common pattern
 * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
 * @private
 */
function _buildRecoveryState(intendedState, recoverySaveId, failureType) {
  return {
    ...intendedState,
    saveId: recoverySaveId,
    sequenceId: _getNextStorageSequenceId(),
    revision: _getNextRevision(),
    recoveredFrom: failureType,
    recoveryTimestamp: Date.now()
  };
}

/**
 * Log recovery success with details
 * v1.6.3.7-v14 - FIX Duplication: Extracted common logging
 * @private
 */
function _logRecoverySuccess(operationId, method, recoverySaveId, additionalDetails = {}) {
  console.log('[Background] RECOVERY_SUCCESS:', {
    operationId,
    method,
    recoverySaveId,
    ...additionalDetails,
    timestamp: Date.now()
  });
}

/**
 * Execute recovery with write and verification
 * v1.6.3.7-v14 - FIX Duplication: Unified recovery execution pattern
 * @private
 */
async function _executeRecoveryWithVerification(config) {
  const {
    operationId,
    intendedState,
    failureType,
    saveIdPrefix,
    method,
    verifyFn,
    successDetails = {},
    failureRecommendation
  } = config;

  console.log(
    `[Background] RECOVERY_STRATEGY: Re-writing state (${failureType.toLowerCase().replace('_', ' ')})`
  );

  const recoverySaveId = _generateRecoverySaveId(saveIdPrefix);
  const recoveryState = _buildRecoveryState(intendedState, recoverySaveId, failureType);

  const writeResult = await _tryRecoveryWriteAndVerify(
    operationId,
    recoveryState,
    recoverySaveId,
    verifyFn
  );
  if (!writeResult.success) {
    return _logRecoveryFailure(operationId, failureType, failureRecommendation);
  }

  _logRecoverySuccess(operationId, method, recoverySaveId, {
    ...successDetails,
    tabCount: writeResult.tabCount
  });
  return { recovered: true, method, reason: 'Successfully re-wrote state' };
}

/**
 * Recover from tab count mismatch (corruption)
 * v1.6.3.7-v13 - Issue #7: Re-write state with verification
 * v1.6.3.7-v14 - FIX Duplication: Use unified recovery execution
 * @private
 */
async function _recoverFromTabCountMismatch(operationId, intendedState) {
  const expectedTabCount = intendedState?.tabs?.length;
  return _executeRecoveryWithVerification({
    operationId,
    intendedState,
    failureType: 'TAB_COUNT_MISMATCH',
    saveIdPrefix: 'count',
    method: 're-write',
    verifyFn: (_expected, actual) => actual?.tabs?.length === expectedTabCount,
    failureRecommendation: 'state corruption persists - recommend clearing storage'
  });
}

/**
 * Unified recovery write and verify operation
 * v1.6.3.7-v14 - FIX Duplication: Replaces _tryRecoveryWriteWithTabCount and _tryRecoveryWriteWithChecksum
 * @private
 */
async function _tryRecoveryWriteAndVerify(operationId, recoveryState, expectedSaveId, verifyFn) {
  try {
    await browser.storage.local.set({ quick_tabs_state_v2: recoveryState });
    const verifyResult = await browser.storage.local.get('quick_tabs_state_v2');
    const verifyData = verifyResult?.quick_tabs_state_v2;
    const success = verifyData?.saveId === expectedSaveId && verifyFn(recoveryState, verifyData);
    return { success, tabCount: verifyData?.tabs?.length || 0 };
  } catch (err) {
    console.error('[Background] RECOVERY_RETRY_FAILED:', { operationId, error: err.message });
    return { success: false };
  }
}

/**
 * Check if sequence ordering indicates write was superseded
 * v1.6.3.7-v14 - FIX Complexity: Extracted from _recoverFromSaveIdMismatch
 * @private
 */
function _checkSequenceSuperseded(operationId, intendedState, readBackState) {
  const intendedSeqId = intendedState?.sequenceId;
  const actualSeqId = readBackState?.sequenceId;

  if (typeof intendedSeqId !== 'number' || typeof actualSeqId !== 'number') {
    return null;
  }

  if (actualSeqId > intendedSeqId) {
    console.log('[Background] RECOVERY_OUT_OF_ORDER_EVENT:', {
      operationId,
      intendedSequenceId: intendedSeqId,
      actualSequenceId: actualSeqId,
      explanation: 'Storage contains newer write - our write was superseded, no recovery needed',
      timestamp: Date.now()
    });
    return {
      recovered: true,
      method: 'sequence-superseded',
      reason: 'Storage has newer sequence ID - no action needed'
    };
  }

  console.log('[Background] OUT_OF_ORDER_EVENTS: Older sequence fired after newer', {
    intendedSequenceId: intendedSeqId,
    actualSequenceId: actualSeqId,
    operationId
  });
  return null;
}

/**
 * Recover from saveId mismatch (check sequence ID ordering)
 * v1.6.3.7-v13 - Issue #7: Verify sequence ID ordering
 * v1.6.3.7-v14 - FIX Complexity: Extracted sequence check
 * @private
 */
async function _recoverFromSaveIdMismatch(operationId, intendedState, readBackState) {
  console.log('[Background] RECOVERY_STRATEGY: Checking sequence ID ordering (saveId mismatch)');

  // Check if our write was superseded by a newer one
  const supersededResult = _checkSequenceSuperseded(operationId, intendedState, readBackState);
  if (supersededResult) return supersededResult;

  // Try re-writing with force
  const recoverySaveId = _generateRecoverySaveId('saveid');
  const recoveryState = _buildRecoveryState(intendedState, recoverySaveId, 'SAVEID_MISMATCH');

  const writeResult = await _tryRecoveryWrite(operationId, recoveryState, recoverySaveId);
  if (!writeResult.success) {
    return _logRecoveryFailure(operationId, 'SAVEID_MISMATCH', 'concurrent writes may be blocking');
  }

  _logRecoverySuccess(operationId, 're-write-force', recoverySaveId);
  return { recovered: true, method: 're-write-force', reason: 'Forced re-write with new saveId' };
}

/**
 * Recover from checksum mismatch (data corruption)
 * v1.6.3.7-v13 - Issue #7: Re-write with verification
 * v1.6.3.7-v14 - FIX Duplication: Use unified recovery execution
 * @private
 */
async function _recoverFromChecksumMismatch(operationId, intendedState) {
  return _executeRecoveryWithVerification({
    operationId,
    intendedState,
    failureType: 'CHECKSUM_MISMATCH',
    saveIdPrefix: 'checksum',
    method: 're-write-verified',
    verifyFn: (expected, actual) =>
      _computeStorageChecksum(expected) === _computeStorageChecksum(actual),
    successDetails: { checksumVerified: true },
    failureRecommendation: 'persistent data corruption - recommend clearing storage'
  });
}

/**
 * Handle successful write validation
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce complexity
 * @private
 */
function _handleWriteSuccess(operationId, attempt, writeStart, stateToWrite) {
  console.log('[Background] STORAGE_WRITE_COMPLETE:', {
    operationId,
    success: true,
    attempts: attempt + 1,
    totalDurationMs: Date.now() - writeStart
  });

  // Update redundant backup if enabled
  if (ENABLE_SYNC_STORAGE_BACKUP) {
    _updateSyncBackup(stateToWrite, operationId);
  }
}

/**
 * Write to storage with integrity validation and retry
 * v1.6.3.7-v9 - FIX Issue #8: Validate writes and retry on failure
 * @param {Object} stateToWrite - State object to write
 * @param {string} storageKey - Storage key
 * @returns {Promise<{success: boolean, operationId: string, retries: number, error: string|null}>}
 */
async function writeStorageWithValidation(stateToWrite, storageKey) {
  const operationId = _generateStorageOperationId();
  const writeStart = Date.now();

  console.log('[Background] STORAGE_WRITE_START:', {
    operationId,
    storageKey,
    saveId: stateToWrite.saveId,
    tabCount: stateToWrite?.tabs?.length || 0,
    timestamp: writeStart
  });

  for (let attempt = 0; attempt < STORAGE_VALIDATION_MAX_RETRIES; attempt++) {
    const result = await _tryWriteAttempt({
      stateToWrite,
      storageKey,
      operationId,
      attempt,
      writeStart
    });
    if (result.done) return result.value;
  }

  // All retries failed - potential corruption
  return _handleAllRetriesFailed(operationId, stateToWrite, writeStart);
}

/**
 * Try a single write attempt
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce nesting in writeStorageWithValidation
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Write attempt options
 * @param {Object} options.stateToWrite - State object to write
 * @param {string} options.storageKey - Storage key
 * @param {string} options.operationId - Operation ID for tracing
 * @param {number} options.attempt - Current attempt number
 * @param {number} options.writeStart - Write start timestamp
 */
async function _tryWriteAttempt({ stateToWrite, storageKey, operationId, attempt, writeStart }) {
  try {
    const validation = await _performWriteAttempt(stateToWrite, storageKey, operationId, attempt);

    if (validation.valid) {
      _handleWriteSuccess(operationId, attempt, writeStart, stateToWrite);
      return { done: true, value: { success: true, operationId, retries: attempt, error: null } };
    }

    // Validation failed, log retry
    console.warn('[Background] STORAGE_WRITE_RETRY:', {
      operationId,
      attempt: attempt + 1,
      maxAttempts: STORAGE_VALIDATION_MAX_RETRIES,
      error: validation.error
    });
  } catch (err) {
    console.error('[Background] STORAGE_WRITE_ERROR:', {
      operationId,
      attempt,
      error: err.message
    });
  }

  // Wait before next retry
  await new Promise(resolve =>
    setTimeout(resolve, STORAGE_VALIDATION_RETRY_DELAY_MS * (attempt + 1))
  );
  return { done: false };
}

/**
 * Handle case when all retries failed
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce complexity
 * @private
 */
async function _handleAllRetriesFailed(operationId, stateToWrite, writeStart) {
  console.error('[Background] CRITICAL: STORAGE_WRITE_ALL_RETRIES_FAILED:', {
    operationId,
    totalAttempts: STORAGE_VALIDATION_MAX_RETRIES,
    totalDurationMs: Date.now() - writeStart,
    action: 'TRIGGERING_CORRUPTION_RECOVERY'
  });

  await handleStorageCorruption(operationId, stateToWrite);

  return {
    success: false,
    operationId,
    retries: STORAGE_VALIDATION_MAX_RETRIES,
    error: 'ALL_VALIDATION_RETRIES_FAILED'
  };
}

/**
 * Update redundant backup in storage.sync
 * v1.6.3.7-v9 - FIX Issue #8: Keep second copy for recovery
 * @param {Object} stateToWrite - State to backup
 * @param {string} operationId - Operation ID for tracing
 */
async function _updateSyncBackup(stateToWrite, operationId) {
  try {
    // storage.sync has lower quota limits, so we store essential data only
    const backupData = {
      tabs: stateToWrite.tabs,
      timestamp: Date.now(),
      saveId: stateToWrite.saveId,
      backupOperationId: operationId
    };

    await browser.storage.sync.set({ [SYNC_BACKUP_KEY]: backupData });

    console.log('[Background] SYNC_BACKUP_UPDATED:', {
      operationId,
      tabCount: backupData.tabs?.length || 0,
      timestamp: backupData.timestamp
    });
  } catch (err) {
    // storage.sync failures are non-critical (quota exceeded is common)
    console.warn('[Background] SYNC_BACKUP_FAILED:', {
      operationId,
      error: err.message
    });
  }
}

/**
 * Handle detected storage corruption
 * v1.6.3.7-v9 - FIX Issue #8: Recovery mechanism using storage.sync backup
 * @param {string} operationId - Operation ID for tracing
 * @param {Object} intendedState - State that failed to write
 */
async function handleStorageCorruption(operationId, intendedState) {
  const now = Date.now();

  // Rate limit recovery attempts
  if (now - lastCorruptionDetectedAt < CORRUPTION_RECOVERY_COOLDOWN_MS) {
    console.warn('[Background] CORRUPTION_RECOVERY_RATE_LIMITED:', {
      operationId,
      timeSinceLastMs: now - lastCorruptionDetectedAt,
      cooldownMs: CORRUPTION_RECOVERY_COOLDOWN_MS
    });
    return;
  }

  lastCorruptionDetectedAt = now;

  console.error('[Background] CRITICAL: STORAGE_CORRUPTION_DETECTED:', {
    operationId,
    intendedTabCount: intendedState?.tabs?.length || 0,
    timestamp: now
  });

  // Try to recover from storage.sync backup
  if (ENABLE_SYNC_STORAGE_BACKUP) {
    await attemptRecoveryFromSyncBackup(operationId, intendedState);
  }
}

/**
 * Attempt to recover state from storage.sync backup
 * v1.6.3.7-v9 - FIX Issue #8: Recovery from redundant backup
 * @param {string} operationId - Operation ID for tracing
 * @param {Object} intendedState - State that failed to write
 */
/**
 * Handle case when sync backup is empty
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce attemptRecoveryFromSyncBackup complexity
 * @private
 */
function _handleEmptyBackup(operationId, backup, intendedState) {
  console.warn('[Background] SYNC_BACKUP_EMPTY: No backup available for recovery', {
    operationId,
    hasBackup: !!backup,
    backupTabCount: backup?.tabs?.length || 0
  });

  // Fall back to intended state if we have it
  if (intendedState?.tabs?.length > 0) {
    console.log('[Background] USING_INTENDED_STATE_FOR_RECOVERY:', {
      operationId,
      tabCount: intendedState.tabs.length
    });
    globalQuickTabState.tabs = intendedState.tabs;
    globalQuickTabState.lastUpdate = Date.now();
  }
}

/**
 * Write recovered state to local storage
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce attemptRecoveryFromSyncBackup complexity
 * v1.6.3.7-v13 - Issue #2: Use centralized write validation
 * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
 * @private
 */
async function _writeRecoveredState(operationId, backup) {
  const recoveredState = {
    tabs: backup.tabs,
    saveId: `recovered-${operationId}`,
    sequenceId: _getNextStorageSequenceId(),
    revision: _getNextRevision(),
    timestamp: Date.now(),
    recoveredFrom: 'sync-backup'
  };

  // v1.6.3.7-v13 - Issue #2: Use centralized validation
  const result = await _writeQuickTabStateWithValidation(recoveredState, 'sync-backup-recovery');

  if (result.success) {
    console.log('[Background] RECOVERY_COMPLETE: State restored from backup', {
      operationId,
      tabCount: backup.tabs.length,
      validated: true
    });
  } else {
    console.error('[Background] RECOVERY_WRITE_FAILED:', {
      operationId,
      error: result.error,
      recovered: result.recovered
    });
  }
}

/**
 * Check if backup is valid for recovery
 * v1.6.4.14 - FIX Complex Conditional: Extracted from attemptRecoveryFromSyncBackup
 * @private
 */
function _isBackupValidForRecovery(backup) {
  return backup && backup.tabs && backup.tabs.length > 0;
}

/**
 * Attempt to recover state from storage.sync backup
 * v1.6.3.7-v9 - FIX Issue #8: Recovery from redundant backup
 * v1.6.4.14 - FIX Complex Conditional: Extracted _isBackupValidForRecovery
 * @param {string} operationId - Operation ID for tracing
 * @param {Object} intendedState - State that failed to write
 */
async function attemptRecoveryFromSyncBackup(operationId, intendedState) {
  try {
    console.log('[Background] ATTEMPTING_SYNC_BACKUP_RECOVERY:', { operationId });

    const result = await browser.storage.sync.get(SYNC_BACKUP_KEY);
    const backup = result?.[SYNC_BACKUP_KEY];

    // Check if backup is valid
    if (!_isBackupValidForRecovery(backup)) {
      _handleEmptyBackup(operationId, backup, intendedState);
      return;
    }

    // Check backup age - don't restore very old backups (> 1 hour)
    const backupAgeMs = Date.now() - backup.timestamp;
    if (backupAgeMs > 3600000) {
      console.warn('[Background] SYNC_BACKUP_TOO_OLD: Backup is over 1 hour old', {
        operationId,
        backupAgeMs,
        backupTimestamp: backup.timestamp
      });
      return;
    }

    // Restore from backup
    console.log('[Background] RESTORING_FROM_SYNC_BACKUP:', {
      operationId,
      backupTabCount: backup.tabs.length,
      backupSaveId: backup.saveId,
      backupAgeMs
    });

    // Update global state
    globalQuickTabState.tabs = backup.tabs;
    globalQuickTabState.lastUpdate = Date.now();
    globalQuickTabState.saveId = backup.saveId;

    // Write recovered state to local storage
    await _writeRecoveredState(operationId, backup);
  } catch (err) {
    console.error('[Background] SYNC_BACKUP_RECOVERY_ERROR:', { operationId, error: err.message });
  }
}

/**
 * Try to restore from sync backup on startup
 * v1.6.3.7-v9 - FIX Issue #8: Helper to reduce checkStorageIntegrityOnStartup complexity
 * @private
 */
async function _tryRestoreFromStartupBackup(operationId) {
  const syncResult = await browser.storage.sync.get(SYNC_BACKUP_KEY);
  const backup = syncResult?.[SYNC_BACKUP_KEY];

  if (!backup?.tabs || backup.tabs.length === 0) {
    return { hasBackup: false, recovered: false };
  }

  console.warn('[Background] STORAGE_INTEGRITY_MISMATCH: Local empty but backup has data', {
    operationId,
    localTabCount: 0,
    backupTabCount: backup.tabs.length,
    backupAge: Date.now() - backup.timestamp
  });

  // Check if backup is recent enough to restore (< 24 hours)
  const backupAgeMs = Date.now() - backup.timestamp;
  if (backupAgeMs >= 86400000) {
    console.warn('[Background] STARTUP_BACKUP_TOO_OLD:', {
      operationId,
      backupAgeHours: Math.round(backupAgeMs / 3600000)
    });
    return { hasBackup: true, recovered: false };
  }

  console.log('[Background] RESTORING_FROM_STARTUP_BACKUP:', {
    operationId,
    backupTabCount: backup.tabs.length
  });

  await attemptRecoveryFromSyncBackup(operationId, null);
  return { hasBackup: true, recovered: true };
}

/**
 * Check storage integrity on startup
 * v1.6.3.7-v9 - FIX Issue #8: Verify storage.local data on initialization
 * v1.6.3.7-v10 - FIX Issue #8: Add checksum comparison with sync backup
 * @returns {Promise<{healthy: boolean, recovered: boolean, error: string|null}>}
 */
async function checkStorageIntegrityOnStartup() {
  const operationId = _generateStorageOperationId();
  console.log('[Background] STORAGE_INTEGRITY_CHECK_START:', { operationId });

  try {
    // Read from storage.local
    const localResult = await browser.storage.local.get('quick_tabs_state_v2');
    const localState = localResult?.quick_tabs_state_v2;

    // v1.6.3.7-v10 - FIX Issue #8: Compute checksums for comparison
    const localChecksum = _computeStorageChecksum(localState);

    // If sync backup is enabled, compare checksums
    const checksumResult = await _performChecksumComparison(operationId, localState, localChecksum);
    if (checksumResult.shouldReturn) {
      return checksumResult.result;
    }

    // If local storage has data, we're good
    if (_hasValidLocalState(localState)) {
      return _logAndReturnHealthy(operationId, localState, localChecksum);
    }

    // Local storage is empty - check if we have a backup and try recovery
    return await _attemptBackupRecovery(operationId);
  } catch (err) {
    console.error('[Background] STORAGE_INTEGRITY_CHECK_ERROR:', {
      operationId,
      error: err.message
    });
    return { healthy: false, recovered: false, error: err.message };
  }
}

/**
 * Perform checksum comparison if sync backup is enabled
 * v1.6.3.7-v10 - FIX Issue #8: Extracted to reduce checkStorageIntegrityOnStartup max-depth
 * @private
 */
async function _performChecksumComparison(operationId, localState, localChecksum) {
  if (!ENABLE_SYNC_STORAGE_BACKUP) {
    return { shouldReturn: false, result: null };
  }

  const checksumResult = await _compareStorageChecksums(operationId, localState, localChecksum);
  if (checksumResult.mismatch && checksumResult.recovered) {
    return { shouldReturn: true, result: { healthy: false, recovered: true, error: null } };
  }
  return { shouldReturn: false, result: null };
}

/**
 * Check if local state has valid tabs
 * v1.6.3.7-v10 - FIX Issue #8: Extracted to reduce checkStorageIntegrityOnStartup max-depth
 * @private
 */
function _hasValidLocalState(localState) {
  return localState?.tabs && localState.tabs.length > 0;
}

/**
 * Log and return healthy result
 * v1.6.3.7-v10 - FIX Issue #8: Extracted to reduce checkStorageIntegrityOnStartup max-depth
 * @private
 */
function _logAndReturnHealthy(operationId, localState, localChecksum) {
  console.log('[Background] STORAGE_INTEGRITY_CHECK_PASSED:', {
    operationId,
    localTabCount: localState.tabs.length,
    localChecksum,
    saveId: localState.saveId
  });
  return { healthy: true, recovered: false, error: null };
}

/**
 * Attempt backup recovery if local storage is empty
 * v1.6.3.7-v10 - FIX Issue #8: Extracted to reduce checkStorageIntegrityOnStartup max-depth
 * @private
 */
async function _attemptBackupRecovery(operationId) {
  const backupResult = ENABLE_SYNC_STORAGE_BACKUP
    ? await _tryRestoreFromStartupBackup(operationId)
    : { hasBackup: false, recovered: false };

  if (backupResult.recovered) {
    return { healthy: false, recovered: true, error: null };
  }

  // No data in either storage - this is expected for new installations
  console.log('[Background] STORAGE_INTEGRITY_CHECK_COMPLETE: No existing data', { operationId });
  return { healthy: true, recovered: false, error: null };
}

/**
 * Compute a checksum for storage state (hash of tab IDs + states)
 * v1.6.3.7-v10 - FIX Issue #8: Data checksum for corruption detection
 * @private
 * @param {Object} state - State object with tabs array
 * @returns {string} Checksum string or 'empty' if no tabs
 */
function _computeStorageChecksum(state) {
  if (!state?.tabs || state.tabs.length === 0) {
    return 'empty';
  }

  // Build a deterministic string from tab IDs and their minimized states
  const tabSignatures = state.tabs
    .map(t => `${t.id}:${t.minimized ? '1' : '0'}:${t.originTabId || '?'}`)
    .sort()
    .join('|');

  // v1.6.3.7-v10 - FIX Code Review: djb2-like hash algorithm explanation
  // hash = hash * 33 + char is equivalent to (hash << 5) - hash + char
  // This is a simple, fast string hash used for corruption detection (not crypto)
  let hash = state.tabs.length;
  for (let i = 0; i < tabSignatures.length; i++) {
    hash = ((hash << 5) - hash + tabSignatures.charCodeAt(i)) | 0;
  }

  return `chk-${state.tabs.length}-${Math.abs(hash).toString(16)}`;
}

/**
 * Compare local storage checksum with sync backup checksum
 * v1.6.3.7-v10 - FIX Issue #8: Detect subtle corruption via checksum mismatch
 * v1.6.4.14 - FIX Complexity: Simplified with early returns (cc=10 → cc=5)
 * @private
/**
 * Check if sync backup is valid for comparison
 * v1.6.4.14 - FIX Complexity: Extracted predicate
 * @private
 */
function _isSyncBackupValid(syncBackup) {
  return syncBackup?.tabs && syncBackup.tabs.length > 0;
}

/**
 * Compare local storage checksum with sync backup checksum
 * v1.6.3.7-v10 - FIX Issue #8: Detect subtle corruption via checksum mismatch
 * v1.6.4.14 - FIX Complexity: Extracted _isSyncBackupValid (cc=10 → cc=6)
 * @private
 * @param {string} operationId - Operation ID for logging
 * @param {Object} localState - Local storage state
 * @param {string} localChecksum - Computed local checksum
 * @returns {Promise<{mismatch: boolean, recovered: boolean}>}
 */
async function _compareStorageChecksums(operationId, localState, localChecksum) {
  const noMismatchResult = { mismatch: false, recovered: false };

  try {
    const syncResult = await browser.storage.sync.get('quick_tabs_backup');
    const syncBackup = syncResult?.quick_tabs_backup;

    // No sync backup to compare against
    if (!_isSyncBackupValid(syncBackup)) {
      return noMismatchResult;
    }

    const syncChecksum = _computeStorageChecksum(syncBackup);
    const localTabCount = localState?.tabs?.length || 0;
    const syncTabCount = syncBackup.tabs.length;

    const mismatchResult = _detectChecksumMismatch(
      localChecksum,
      syncChecksum,
      localTabCount,
      syncTabCount
    );

    if (!mismatchResult.hasMismatch) {
      return noMismatchResult;
    }

    return await _handleChecksumMismatch({
      operationId,
      localChecksum,
      syncChecksum,
      localTabCount,
      syncTabCount,
      mismatchResult,
      localState
    });
  } catch (err) {
    console.warn('[Background] STORAGE_CHECKSUM_COMPARISON_ERROR:', {
      operationId,
      error: err.message
    });
    return noMismatchResult;
  }
}

/**
 * Detect if there is a checksum or count mismatch between local and sync
 * v1.6.3.7-v10 - FIX Issue #8: Extracted to reduce _compareStorageChecksums complexity
 * @private
 */
function _detectChecksumMismatch(localChecksum, syncChecksum, localTabCount, syncTabCount) {
  const countMismatch = localTabCount !== syncTabCount && localTabCount > 0 && syncTabCount > 0;
  const checksumMismatch =
    localChecksum !== 'empty' && syncChecksum !== 'empty' && localChecksum !== syncChecksum;

  return {
    hasMismatch: countMismatch || checksumMismatch,
    countMismatch,
    checksumMismatch
  };
}

/**
 * Handle detected checksum mismatch
 * v1.6.3.7-v10 - FIX Issue #8: Extracted to reduce _compareStorageChecksums complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 * @param {string} options.operationId - Operation ID for logging
 * @param {string} options.localChecksum - Local storage checksum
 * @param {string} options.syncChecksum - Sync backup checksum
 * @param {number} options.localTabCount - Local tab count
 * @param {number} options.syncTabCount - Sync tab count
 * @param {Object} options.mismatchResult - Result of mismatch detection
 * @param {Object} options.localState - Local state for recovery
 */
async function _handleChecksumMismatch({
  operationId,
  localChecksum,
  syncChecksum,
  localTabCount,
  syncTabCount,
  mismatchResult,
  localState
}) {
  console.warn('[Background] STORAGE_INTEGRITY_CHECKSUM_MISMATCH:', {
    operationId,
    localChecksum,
    syncChecksum,
    localTabCount,
    syncTabCount,
    countMismatch: mismatchResult.countMismatch,
    checksumMismatch: mismatchResult.checksumMismatch,
    timestamp: Date.now()
  });

  // Determine which source to trust (prefer the one with more data)
  if (syncTabCount > localTabCount) {
    console.log(
      '[Background] STORAGE_INTEGRITY_RECOVERY: Restoring from sync backup (more complete)'
    );
    await attemptRecoveryFromSyncBackup(operationId, localState);
    return { mismatch: true, recovered: true };
  }

  console.log('[Background] STORAGE_INTEGRITY_MISMATCH_KEPT_LOCAL: Local has more or equal data', {
    localTabCount,
    syncTabCount
  });
  return { mismatch: true, recovered: false };
}

// ==================== END ISSUE #8: STORAGE INTEGRITY VALIDATION ====================

// ==================== v1.6.3.8-v5 FIX Issue #7: ROBUST URL VALIDATION ====================

/**
 * Whitelisted URL protocols for Quick Tab creation
 * v1.6.3.8-v5 - FIX Issue #7: Strictly whitelisted protocols only
 * Note: chrome-extension:// included for Chromium compatibility but filtered in Firefox
 * @private
 */
const VALID_QUICKTAB_PROTOCOLS = new Set([
  'http:',
  'https:',
  'moz-extension:',
  'chrome-extension:'
]);

/**
 * Dangerous URL protocols that should always be rejected
 * v1.6.3.8-v5 - FIX Issue #7: Explicit blocklist for security audit logging
 * @private
 */
// eslint-disable-next-line no-script-url -- Used for validation/rejection, not execution
const DANGEROUS_PROTOCOLS = new Set(['javascript:', 'data:', 'blob:', 'vbscript:', 'file:']);

/**
 * Maximum length for parsed URL logging (protocol + hostname + pathname)
 * v1.6.3.8-v5 - FIX Issue #7: Named constant for URL logging truncation
 * @private
 */
const URL_LOG_MAX_PARSED_LENGTH = 80;

/**
 * Maximum length for unparseable raw URL logging
 * v1.6.3.8-v5 - FIX Issue #7: Named constant for raw URL logging truncation
 * @private
 */
const URL_LOG_MAX_RAW_LENGTH = 50;

/**
 * Check if URL is null, undefined, or empty
 * @private
 * @param {*} url - URL to check
 * @returns {boolean} True if URL is empty or undefined
 */
function _isUrlNullOrEmpty(url) {
  return url === undefined || url === null || url === '';
}

/**
 * Check if URL contains undefined string literals
 * @private
 * @param {*} url - URL to check
 * @returns {boolean} True if URL is corrupted with 'undefined'
 */
function _isUrlCorruptedWithUndefined(url) {
  if (url === 'undefined' || String(url) === 'undefined') return true;
  return String(url).includes('/undefined');
}

/**
 * Safely extract loggable parts from a URL for security audit
 * v1.6.3.8-v5 - FIX Issue #7: Better URL sanitization for logging
 * Preserves protocol and domain while safely truncating query/fragment
 * @private
 * @param {string} url - The URL to sanitize
 * @returns {string} Sanitized URL safe for logging
 */
function _sanitizeUrlForLogging(url) {
  const urlStr = String(url);
  try {
    const parsed = new URL(urlStr);
    // Keep protocol + hostname + pathname (truncated), remove query/fragment
    const basePart = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    const truncated = basePart.substring(0, URL_LOG_MAX_PARSED_LENGTH);
    return truncated.length < basePart.length ? truncated + '...[TRUNCATED]' : truncated;
  } catch (_err) {
    // If URL can't be parsed, just show first chars of raw string
    const truncated = urlStr.substring(0, URL_LOG_MAX_RAW_LENGTH);
    return truncated.length < urlStr.length ? truncated + '...[UNPARSEABLE]' : truncated;
  }
}

/**
 * Log rejected URL for security audit
 * v1.6.3.8-v5 - FIX Issue #7: Security audit logging for rejected URLs
 * @private
 * @param {string} url - The URL that was rejected
 * @param {string} reason - Reason for rejection
 */
function _logRejectedUrl(url, reason) {
  console.warn('[Background] URL_VALIDATION_REJECTED:', {
    url: _sanitizeUrlForLogging(url),
    reason,
    timestamp: Date.now()
  });
}

/**
 * Parse and validate URL using URL constructor
 * v1.6.3.8-v5 - FIX Issue #7: Robust URL validation using URL constructor
 * @private
 * @param {string} urlStr - URL string to validate
 * @returns {{ valid: boolean, protocol: string|null, reason: string|null }} Validation result
 */
function _parseAndValidateUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);

    // v1.6.3.8-v5 - FIX Issue #7: Check for dangerous protocols first (security audit)
    if (DANGEROUS_PROTOCOLS.has(parsed.protocol)) {
      return {
        valid: false,
        protocol: parsed.protocol,
        reason: `DANGEROUS_PROTOCOL: ${parsed.protocol}`
      };
    }

    // v1.6.3.8-v5 - FIX Issue #7: Strict whitelist enforcement
    if (!VALID_QUICKTAB_PROTOCOLS.has(parsed.protocol)) {
      return {
        valid: false,
        protocol: parsed.protocol,
        reason: `PROTOCOL_NOT_WHITELISTED: ${parsed.protocol}`
      };
    }

    // v1.6.3.8-v5 - FIX Issue #7: Additional validation - ensure hostname exists for http/https
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
      return {
        valid: false,
        protocol: parsed.protocol,
        reason: 'MISSING_HOSTNAME'
      };
    }

    return { valid: true, protocol: parsed.protocol, reason: null };
  } catch (err) {
    // URL constructor throws on invalid URLs
    // v1.6.3.8-v5: Log error type for debugging (but not the URL content for security)
    return {
      valid: false,
      protocol: null,
      reason: `INVALID_URL_FORMAT: ${err.name || 'TypeError'}`
    };
  }
}

/**
 * Check if a URL is valid for Quick Tab creation
 * v1.6.3.4-v6 - FIX Issue #2: Filter corrupted tabs before broadcast
 * v1.6.4.8 - Refactored: Extracted helpers to reduce complex conditionals
 * v1.6.3.8-v5 - FIX Issue #7: Robust URL validation with URL constructor and security logging
 * @param {*} url - URL to validate
 * @returns {boolean} True if URL is valid
 */
function isValidQuickTabUrl(url) {
  // Quick checks first
  if (_isUrlNullOrEmpty(url)) {
    return false;
  }
  if (_isUrlCorruptedWithUndefined(url)) {
    _logRejectedUrl(url, 'CORRUPTED_UNDEFINED');
    return false;
  }

  const urlStr = String(url);

  // v1.6.3.8-v5 - FIX Issue #7: Use URL constructor for robust validation
  const validation = _parseAndValidateUrl(urlStr);

  if (!validation.valid) {
    _logRejectedUrl(urlStr, validation.reason);
    return false;
  }

  return true;
}

// ==================== END v1.6.3.8-v5 FIX Issue #7: ROBUST URL VALIDATION ====================

/**
 * Filter out tabs with invalid URLs from state
 * v1.6.3.4-v6 - FIX Issue #2: Prevent ghost iframes
 * @param {Object} state - State object with tabs array
 * @returns {Object} State with only valid tabs
 */
function filterValidTabs(state) {
  if (!state?.tabs || !Array.isArray(state.tabs)) {
    return state;
  }

  const originalCount = state.tabs.length;
  const validTabs = state.tabs.filter(tab => {
    if (!isValidQuickTabUrl(tab.url)) {
      console.warn('[Background] Filtering out tab with invalid URL:', {
        id: tab.id,
        url: tab.url
      });
      return false;
    }
    return true;
  });

  if (validTabs.length !== originalCount) {
    console.log('[Background] Filtered', originalCount - validTabs.length, 'invalid tabs');
  }

  return { ...state, tabs: validTabs };
}

// ==================== v1.6.3.6-v12 INITIALIZATION GUARDS ====================
// FIX Issue #1: All handlers must check initialization before accessing globalQuickTabState

/**
 * Check if background script is initialized and return error response if not
 * v1.6.3.6-v12 - FIX Issue #1: Initialization guard pattern
 * @param {string} handlerName - Name of the calling handler for logging
 * @returns {{ initialized: boolean, errorResponse: Object|null }} Guard result
 */
function checkInitializationGuard(handlerName) {
  if (!isInitialized) {
    console.warn(`[Background] v1.6.3.6-v12 Handler called before initialization: ${handlerName}`);
    return {
      initialized: false,
      errorResponse: {
        success: false,
        error: 'NOT_INITIALIZED',
        message: 'Background script still initializing. Please retry.',
        retryable: true
      }
    };
  }
  return { initialized: true, errorResponse: null };
}

/**
 * Wait for initialization to complete with timeout
 * v1.6.3.6-v12 - FIX Issue #1: Blocking wait for handlers that need state
 * @param {number} timeoutMs - Maximum time to wait (default 5000ms)
 * @returns {Promise<boolean>} True if initialized, false if timeout
 */
async function waitForInitialization(timeoutMs = 5000) {
  if (isInitialized) return true;

  console.log('[Background] Waiting for initialization to complete...');
  const startTime = Date.now();

  while (!isInitialized && Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!isInitialized) {
    console.warn('[Background] Initialization wait timeout after', timeoutMs, 'ms');
    return false;
  }

  console.log('[Background] Initialization completed after', Date.now() - startTime, 'ms wait');
  return true;
}

/**
 * Extract relevant tab data for hashing
 * v1.6.3.4-v11 - Extracted from computeStateHash to reduce complexity
 * @param {Object} tab - Tab object
 * @returns {Object} Normalized tab data for hashing
 */
function _extractTabDataForHash(tab) {
  return {
    id: tab.id,
    url: tab.url,
    left: tab.left ?? tab.position?.left,
    top: tab.top ?? tab.position?.top,
    width: tab.width ?? tab.size?.width,
    height: tab.height ?? tab.size?.height,
    minimized: tab.minimized ?? tab.visibility?.minimized
  };
}

/**
 * Compute 32-bit hash from string
 * v1.6.3.4-v11 - Extracted from computeStateHash to reduce complexity
 * @param {string} str - String to hash
 * @returns {number} 32-bit hash value
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
 * Compute a simple hash of the Quick Tab state for deduplication
 * v1.6.1.6 - Memory leak fix: Used to skip redundant broadcasts
 * v1.6.2.2 - Updated for unified format
 * v1.6.3.2 - FIX Bug #2: Include saveId in hash to detect different writes with same content
 * v1.6.3.4-v11 - Refactored: Extracted _extractTabDataForHash and _computeStringHash (cc reduced)
 * @param {Object} state - Quick Tab state object
 * @returns {number} 32-bit hash of the state
 */
function computeStateHash(state) {
  if (!state) return 0;

  const tabs = state.tabs || [];
  const tabData = tabs.map(_extractTabDataForHash);

  // v1.6.3.2 - FIX: Include saveId in hash calculation
  const stateStr = JSON.stringify({ saveId: state.saveId, tabData });

  return _computeStringHash(stateStr);
}

// v1.6.2.2 - Format detection and migrators removed (unified format)

// v1.6.3.6-v12 - FIX Issue #1: Retry limit for initialization
let initializationRetryCount = 0;
const MAX_INITIALIZATION_RETRIES = 3;

/**
 * Log successful initialization completion
 * v1.6.4.13 - FIX Complexity: Extracted from initializeGlobalState (cc=12 → cc=6)
 * @private
 * @param {string} source - Source of state (e.g., 'session storage', 'local storage')
 * @param {number} initStartTime - Initialization start timestamp
 */
function _logInitializationComplete(source, initStartTime) {
  initializationRetryCount = 0;
  console.log(`[Background] v1.6.3.6-v12 Initialization complete from ${source}:`, {
    tabCount: globalQuickTabState.tabs?.length || 0,
    durationMs: Date.now() - initStartTime
  });
}

/**
 * Handle initialization error with retry logic
 * v1.6.4.13 - FIX Complexity: Extracted from initializeGlobalState (cc=12 → cc=6)
 * @private
 * @param {Error} err - The error that occurred
 * @param {number} initStartTime - Initialization start timestamp
 */
function _handleInitializationError(err, initStartTime) {
  console.error('[Background] v1.6.3.6-v12 INITIALIZATION_FAILED:', {
    error: err.message,
    durationMs: Date.now() - initStartTime,
    retryCount: initializationRetryCount,
    maxRetries: MAX_INITIALIZATION_RETRIES
  });

  if (initializationRetryCount < MAX_INITIALIZATION_RETRIES) {
    initializationRetryCount++;
    const backoffMs = Math.pow(2, initializationRetryCount) * 500;
    console.log(
      `[Background] Retrying initialization in ${backoffMs}ms (attempt ${initializationRetryCount}/${MAX_INITIALIZATION_RETRIES})`
    );
    setTimeout(() => initializeGlobalState(), backoffMs);
  } else {
    console.error(
      '[Background] v1.6.3.6-v12 Max retries exceeded - marking as initialized with empty state'
    );
    globalQuickTabState.tabs = [];
    globalQuickTabState.lastUpdate = Date.now();
    isInitialized = true;
  }
}

/**
 * v1.5.8.13 - EAGER LOADING: Initialize global state from storage on extension startup
 * v1.6.2.2 - Simplified for unified format
 * v1.6.3.6-v12 - FIX Issue #1: Proper error handling - don't set isInitialized on failure
 * v1.6.3.6-v12 - FIX Code Review: Added retry limit to prevent infinite loop
 * v1.6.3.7-v9 - FIX Issue #8: Check storage integrity on startup
 * v1.6.4.13 - FIX Complexity: Extracted helpers (cc=12 → cc=6)
 */
async function initializeGlobalState() {
  // Guard: Already initialized
  if (isInitialized) {
    console.log('[Background] State already initialized');
    return;
  }

  console.log('[Background] Starting state initialization...');
  const initStartTime = Date.now();

  try {
    // v1.6.3.7-v9 - FIX Issue #8: Check storage integrity before loading
    const integrityResult = await checkStorageIntegrityOnStartup();
    console.log('[Background] Storage integrity check result:', {
      healthy: integrityResult.healthy,
      recovered: integrityResult.recovered,
      error: integrityResult.error
    });

    // If we recovered from backup, our state is already populated
    if (integrityResult.recovered && globalQuickTabState.tabs?.length > 0) {
      _logInitializationComplete('backup recovery', initStartTime);
      return;
    }

    // Try session storage first (faster)
    if (await tryLoadFromSessionStorage()) {
      _logInitializationComplete('session storage', initStartTime);
      return;
    }

    // Fall back to sync storage
    await tryLoadFromSyncStorage();
    _logInitializationComplete('local storage', initStartTime);
  } catch (err) {
    _handleInitializationError(err, initStartTime);
  }
}

/**
 * Check if session storage has valid session state
 * v1.6.3.4-v11 - Extracted to reduce complexity and fix complex conditional
 * @param {Object} result - Result from browser.storage.session.get()
 * @returns {boolean} true if valid session data exists
 */
function _hasValidSessionState(result) {
  if (!result) return false;
  if (!result.quick_tabs_session) return false;
  return true;
}

/**
 * Check if state has valid tabs array (unified format)
 * v1.6.3.4-v11 - Extracted to reduce complexity
 * @param {Object} state - State object to check
 * @returns {boolean} true if state has valid tabs array
 */
function _hasValidTabsArray(state) {
  return state && state.tabs && Array.isArray(state.tabs);
}

/**
 * Apply unified format state to global state
 * v1.6.3.4-v11 - Extracted to reduce complexity in tryLoadFromSessionStorage
 * @param {Object} sessionState - Session state with tabs array
 * @param {string} source - Source name for logging
 * @param {string} format - Format name for logging
 */
function _applyUnifiedFormatState(sessionState, source, format) {
  globalQuickTabState.tabs = sessionState.tabs;
  globalQuickTabState.lastUpdate = sessionState.timestamp || Date.now();
  logSuccessfulLoad(source, format);
  isInitialized = true;
}

/**
 * Apply migrated container format state to global state
 * v1.6.3.4-v11 - Extracted to reduce complexity in tryLoadFromSessionStorage
 * @param {Object} sessionState - Session state with containers object
 * @param {string} source - Source name for logging
 */
function _applyMigratedContainerState(sessionState, source) {
  globalQuickTabState.tabs = migrateContainersToUnifiedFormat(sessionState.containers);
  globalQuickTabState.lastUpdate = sessionState.timestamp || Date.now();
  logSuccessfulLoad(source, 'migrated from container format');
  isInitialized = true;
}

/**
 * Helper: Try loading from session storage
 * v1.6.3.4-v11 - Refactored: Extracted helpers to reduce cc below 9
 *
 * @returns {Promise<boolean>} True if loaded successfully
 */
async function tryLoadFromSessionStorage() {
  // Guard: Session storage not available
  if (typeof browser.storage.session === 'undefined') {
    return false;
  }

  const result = await browser.storage.session.get('quick_tabs_session');

  // Guard: No data in session storage
  if (!_hasValidSessionState(result)) {
    return false;
  }

  const sessionState = result.quick_tabs_session;

  // v1.6.2.2 - Unified format
  if (_hasValidTabsArray(sessionState)) {
    _applyUnifiedFormatState(sessionState, 'session storage', 'v1.6.2.2 unified');
    return true;
  }

  // Backward compatibility: container format migration
  if (sessionState.containers) {
    _applyMigratedContainerState(sessionState, 'session storage');
    return true;
  }

  return false;
}

/**
 * Process a single container for migration
 * v1.6.3.4-v11 - Extracted from migrateContainersToUnifiedFormat to fix max-depth
 * @param {string} containerKey - Container identifier
 * @param {Array} tabs - Tabs in the container
 * @param {Set} seenIds - Set of already processed tab IDs
 * @param {Array} allTabs - Target array for deduplicated tabs
 */
function _processContainerTabs(containerKey, tabs, seenIds, allTabs) {
  console.log(`[Background] Migrating ${tabs.length} tabs from container: ${containerKey}`);

  for (const tab of tabs) {
    if (seenIds.has(tab.id)) {
      console.warn(`[Background] Skipping duplicate tab ID during migration: ${tab.id}`);
      continue;
    }
    seenIds.add(tab.id);
    allTabs.push(tab);
  }
}

/**
 * Migrate container format to unified format
 * v1.6.2.2 - Backward compatibility helper
 * v1.6.3.4-v11 - Refactored: Extracted _processContainerTabs to fix max-depth (bumps reduced)
 *
 * @param {Object} containers - Container data object
 * @returns {Array} Unified tabs array (deduplicated)
 */
function migrateContainersToUnifiedFormat(containers) {
  const allTabs = [];
  const seenIds = new Set();

  for (const containerKey of Object.keys(containers)) {
    const tabs = containers[containerKey]?.tabs || [];
    if (tabs.length === 0) continue;

    _processContainerTabs(containerKey, tabs, seenIds, allTabs);
  }

  return allTabs;
}

/**
 * Helper: Get storage state from local or sync storage
 * @private
 * @returns {Promise<Object|null>} Storage state or null
 */
async function _getStorageState() {
  let result = await browser.storage.local.get('quick_tabs_state_v2');
  if (result?.quick_tabs_state_v2) {
    return result.quick_tabs_state_v2;
  }
  result = await browser.storage.sync.get('quick_tabs_state_v2');
  return result?.quick_tabs_state_v2 || null;
}

/**
 * Helper: Try loading from local/sync storage
 * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
 * v1.6.2.2 - Updated for unified format
 *
 * @returns {Promise<void>}
 */
async function tryLoadFromSyncStorage() {
  const state = await _getStorageState();

  // Guard: No data
  if (!state) {
    console.log('[Background] ✓ EAGER LOAD: No saved state found, starting with empty state');
    isInitialized = true;
    return;
  }

  // v1.6.2.2 - Unified format
  if (state.tabs && Array.isArray(state.tabs)) {
    globalQuickTabState.tabs = state.tabs;
    globalQuickTabState.lastUpdate = state.timestamp || Date.now();
    logSuccessfulLoad('storage', 'v1.6.2.2 unified');
    isInitialized = true;
    return;
  }

  // Backward compatibility: container format migration
  if (state.containers) {
    globalQuickTabState.tabs = migrateContainersToUnifiedFormat(state.containers);
    globalQuickTabState.lastUpdate = state.timestamp || Date.now();
    logSuccessfulLoad('storage', 'migrated from container format');
    await saveMigratedToUnifiedFormat();
  }

  isInitialized = true;
}

/**
 * Helper: Save migrated state to unified format
 * v1.6.2.2 - Save in new unified format
 * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
 * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
 *
 * @returns {Promise<void>}
 */
async function saveMigratedToUnifiedFormat() {
  const saveId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const sequenceId = _getNextStorageSequenceId();
  const revision = _getNextRevision();

  try {
    await browser.storage.local.set({
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        saveId: saveId,
        sequenceId,
        revision,
        timestamp: Date.now()
      }
    });
    console.log('[Background] ✓ Migrated to v1.6.2.2 unified format');
  } catch (err) {
    console.error('[Background] Error saving migrated state:', err);
  }
}

/**
 * Helper: Log successful state load
 * v1.6.2.2 - Updated for unified format
 *
 * @param {string} source - Storage source (session/sync)
 * @param {string} format - Format name
 */
function logSuccessfulLoad(source, format) {
  const totalTabs = globalQuickTabState.tabs?.length || 0;

  console.log(
    `[Background] ✓ EAGER LOAD: Initialized from ${source} (${format}):`,
    totalTabs,
    'tabs'
  );
}

// v1.5.8.13 - EAGER LOADING: Call initialization immediately on script load
initializeGlobalState();

// v1.6.3.8-v12 GAP-1, GAP-10, GAP-11 fix: Bootstrap Quick Tabs v2 after state initialization
// This must happen after initializeGlobalState() but before content scripts run
// The bootstrapQuickTabs() function checks the feature flag and initializes the appropriate architecture
// v1.6.3.9-v2 - Issue #6: Also initializes tab events for container isolation
(async function bootstrapQuickTabsV2() {
  console.log('[Background] v1.6.3.8-v12 Initiating Quick Tabs v2 bootstrap...');
  try {
    const result = await bootstrapQuickTabs();
    console.log('[Background] v1.6.3.8-v12 Quick Tabs bootstrap complete:', {
      architecture: result.architecture,
      success: result.success,
      activeArchitecture: getActiveArchitecture()
    });

    // v1.6.3.9-v2 - Issue #6: Initialize tab events for container isolation and cleanup
    const tabEventsResult = initializeTabEvents();
    console.log('[Background] v1.6.3.9-v2 Tab events initialized:', {
      success: tabEventsResult.success,
      listeners: tabEventsResult.listenersRegistered
    });
  } catch (err) {
    console.error('[Background] v1.6.3.8-v12 Quick Tabs bootstrap failed:', err.message);
  }
})();

/**
 * v1.5.9.13 - Migrate Quick Tab state from pinnedToUrl to soloedOnTabs/mutedOnTabs
 * v1.6.2.2 - Updated for unified format
 */
async function migrateQuickTabState() {
  // Guard: State not initialized
  if (!isInitialized) {
    console.warn('[Background Migration] State not initialized, skipping migration');
    return;
  }

  let migrated = false;

  // v1.6.2.2 - Process tabs array directly (unified format)
  for (const quickTab of globalQuickTabState.tabs || []) {
    if (migrateTabFromPinToSoloMute(quickTab)) {
      migrated = true;
    }
  }

  // Save if any tabs were migrated
  if (migrated) {
    await saveMigratedQuickTabState();
  } else {
    console.log('[Background Migration] No migration needed');
  }
}

/**
 * Helper: Migrate individual tab from pinnedToUrl to solo/mute format
 *
 * @param {Object} quickTab - Quick Tab object to migrate
 * @returns {boolean} True if migration occurred
 */
function migrateTabFromPinToSoloMute(quickTab) {
  // Guard: No pinnedToUrl property
  if (!('pinnedToUrl' in quickTab)) {
    return false;
  }

  console.log(
    `[Background Migration] Converting Quick Tab ${quickTab.id} from pin to solo/mute format`
  );

  // Initialize new properties
  quickTab.soloedOnTabs = quickTab.soloedOnTabs || [];
  quickTab.mutedOnTabs = quickTab.mutedOnTabs || [];

  // Remove old property
  delete quickTab.pinnedToUrl;

  return true;
}

/**
 * Helper: Save migrated Quick Tab state to storage
 * v1.6.2.2 - Updated for unified format
 * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
 * v1.6.3.7-v13 - Issue #2: Use centralized write validation
 * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
 *
 * @returns {Promise<void>}
 */
async function saveMigratedQuickTabState() {
  console.log('[Background Migration] Saving migrated Quick Tab state');

  const stateToSave = {
    tabs: globalQuickTabState.tabs,
    saveId: `migration-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sequenceId: _getNextStorageSequenceId(),
    revision: _getNextRevision(),
    timestamp: Date.now()
  };

  // v1.6.3.7-v13 - Issue #2: Use centralized validation
  const result = await _writeQuickTabStateWithValidation(stateToSave, 'migration');

  if (result.success) {
    console.log('[Background Migration] ✓ Migration complete (validated)');
  } else {
    console.error('[Background Migration] Error saving migrated state:', {
      error: result.error,
      recovered: result.recovered
    });
  }
}

// Run migration after initialization
migrateQuickTabState();

// ==================== STATE COORDINATOR ====================
// Manages canonical Quick Tab state across all tabs with conflict resolution

class StateCoordinator {
  constructor() {
    this.globalState = {
      tabs: [],
      timestamp: 0,
      version: 1 // Increment on breaking changes
    };
    this.pendingConfirmations = new Map(); // saveId → {tabId, resolve, reject}
    this.tabVectorClocks = new Map(); // tabId → vector clock
    this.initialized = false;
  }

  /**
   * Initialize from storage
   * v1.6.0 - PHASE 3.2: Refactored to flatten nested blocks (cc=15 → cc<6)
   */
  async initialize() {
    // Guard: Already initialized
    if (this.initialized) {
      console.log('[STATE COORDINATOR] Already initialized');
      return;
    }

    try {
      // Try session storage first
      const loaded = await this.tryLoadFromSessionStorage();
      if (loaded) return;

      // Fall back to sync storage
      await this.tryLoadFromSyncStorage();
    } catch (err) {
      console.error('[STATE COORDINATOR] Error initializing:', err);
      this.initialized = true;
    }
  }

  /**
   * Check if session storage result has valid Quick Tab data
   * v1.6.3.4-v11 - Extracted to fix complex conditional
   * @param {Object} result - Session storage result
   * @returns {boolean} true if valid data exists
   */
  _hasValidSessionData(result) {
    if (!result) return false;
    if (!result.quick_tabs_session) return false;
    if (!result.quick_tabs_session.tabs) return false;
    return true;
  }

  /**
   * Helper: Try loading from session storage
   * v1.6.3.4-v11 - Refactored: Extracted _hasValidSessionData to fix complex conditional
   *
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async tryLoadFromSessionStorage() {
    // Guard: Session storage not available
    if (typeof browser.storage.session === 'undefined') {
      return false;
    }

    const result = await browser.storage.session.get('quick_tabs_session');

    // Guard: No valid data
    if (!this._hasValidSessionData(result)) {
      return false;
    }

    this.globalState = result.quick_tabs_session;
    this.initialized = true;
    console.log(
      '[STATE COORDINATOR] Initialized from session storage:',
      this.globalState.tabs.length,
      'tabs'
    );
    return true;
  }

  /**
   * Helper: Try loading from local/sync storage
   * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
   *
   * @returns {Promise<void>}
   */
  async tryLoadFromSyncStorage() {
    // v1.6.0.12 - FIX: Try local storage first (where we now save)
    let result = await browser.storage.local.get('quick_tabs_state_v2');

    // Fallback to sync storage for backward compatibility
    if (!result || !result.quick_tabs_state_v2) {
      result = await browser.storage.sync.get('quick_tabs_state_v2');
    }

    // Guard: No data
    if (!result || !result.quick_tabs_state_v2) {
      this.initialized = true;
      console.log('[STATE COORDINATOR] No saved state, starting fresh');
      return;
    }

    // Load data based on format
    this.loadStateFromSyncData(result.quick_tabs_state_v2);
    this.initialized = true;
    console.log(
      '[STATE COORDINATOR] Initialized from sync storage:',
      this.globalState.tabs.length,
      'tabs'
    );
  }

  /**
   * Helper: Extract tabs from container data
   * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (line 445)
   *
   * @param {Object} containerData - Container data object
   * @returns {Array} Array of tabs from container, or empty array
   */
  _extractContainerTabs(containerData) {
    if (!containerData || !containerData.tabs) {
      return [];
    }
    return containerData.tabs;
  }

  /**
   * Helper: Load state from sync storage data
   *
   * @param {Object} data - Storage data
   */
  loadStateFromSyncData(data) {
    // Container-aware format
    if (typeof data === 'object' && !Array.isArray(data.tabs)) {
      const allTabs = [];
      for (const containerId in data) {
        const containerData = data[containerId];
        const tabs = this._extractContainerTabs(containerData);
        allTabs.push(...tabs);
      }
      this.globalState.tabs = allTabs;
      this.globalState.timestamp = Date.now();
      return;
    }

    // Legacy format with tabs array
    if (data.tabs) {
      this.globalState = data;
    }
  }

  /**
   * Process batch update from a tab
   */
  async processBatchUpdate(tabId, operations, tabInstanceId) {
    await this.initialize();

    console.log(`[STATE COORDINATOR] Processing ${operations.length} operations from tab ${tabId}`);

    // Rebuild vector clock from operations
    const tabVectorClock = new Map();
    operations.forEach(op => {
      if (op.vectorClock) {
        op.vectorClock.forEach(([key, value]) => {
          tabVectorClock.set(key, Math.max(tabVectorClock.get(key) || 0, value));
        });
      }
    });
    this.tabVectorClocks.set(tabInstanceId, tabVectorClock);

    // Process each operation (synchronous)
    for (const op of operations) {
      this.processOperation(op);
    }

    // Save to storage
    await this.persistState();

    // Broadcast to all tabs
    await this.broadcastState();

    console.log('[STATE COORDINATOR] Batch update complete');
    return { success: true };
  }

  /**
   * Process a single operation
   * v1.6.0 - PHASE 3.2: Refactored to extract operation handlers (cc=12 → cc<6)
   */
  processOperation(op) {
    const { type, quickTabId, data } = op;

    // Route to appropriate handler
    switch (type) {
      case 'create':
        this.handleCreateOperation(quickTabId, data);
        break;
      case 'update':
        this.handleUpdateOperation(quickTabId, data);
        break;
      case 'delete':
        this.handleDeleteOperation(quickTabId);
        break;
      case 'minimize':
        this.handleMinimizeOperation(quickTabId, data);
        break;
      case 'restore':
        this.handleRestoreOperation(quickTabId);
        break;
      default:
        console.warn(`[STATE COORDINATOR] Unknown operation type: ${type}`);
    }

    this.globalState.timestamp = Date.now();
  }

  /**
   * Helper: Handle create operation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} data - Tab data
   */
  handleCreateOperation(quickTabId, data) {
    const existingIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (existingIndex === -1) {
      this.globalState.tabs.push(data);
      console.log(`[STATE COORDINATOR] Created Quick Tab ${quickTabId}`);
    } else {
      this.globalState.tabs[existingIndex] = {
        ...this.globalState.tabs[existingIndex],
        ...data
      };
      console.log(`[STATE COORDINATOR] Updated existing Quick Tab ${quickTabId}`);
    }
  }

  /**
   * Helper: Handle update operation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} data - Tab data
   */
  handleUpdateOperation(quickTabId, data) {
    const updateIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (updateIndex === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for update`);
      return;
    }

    this.globalState.tabs[updateIndex] = {
      ...this.globalState.tabs[updateIndex],
      ...data
    };
    console.log(`[STATE COORDINATOR] Updated Quick Tab ${quickTabId}`);
  }

  /**
   * Helper: Handle delete operation
   *
   * @param {string} quickTabId - Quick Tab ID
   */
  handleDeleteOperation(quickTabId) {
    const deleteIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (deleteIndex === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for delete`);
      return;
    }

    this.globalState.tabs.splice(deleteIndex, 1);
    console.log(`[STATE COORDINATOR] Deleted Quick Tab ${quickTabId}`);
  }

  /**
   * Helper: Handle minimize operation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} data - Tab data (optional)
   */
  handleMinimizeOperation(quickTabId, data) {
    const minIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (minIndex !== -1) {
      this.globalState.tabs[minIndex].minimized = true;
      console.log(`[STATE COORDINATOR] Minimized Quick Tab ${quickTabId}`);
    } else if (data) {
      this.globalState.tabs.push({ ...data, minimized: true });
      console.log(`[STATE COORDINATOR] Created minimized Quick Tab ${quickTabId}`);
    }
  }

  /**
   * Helper: Handle restore operation
   *
   * @param {string} quickTabId - Quick Tab ID
   */
  handleRestoreOperation(quickTabId) {
    const restoreIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (restoreIndex === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for restore`);
      return;
    }

    this.globalState.tabs[restoreIndex].minimized = false;
    console.log(`[STATE COORDINATOR] Restored Quick Tab ${quickTabId}`);
  }

  /**
   * Persist state to storage
   * v1.6.0.12 - FIX: Use local storage to avoid quota errors
   */
  async persistState() {
    try {
      // v1.6.0.12 - FIX: Use local storage (much higher quota)
      await browser.storage.local.set({
        quick_tabs_state_v2: this.globalState
      });

      // Also save to session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        await browser.storage.session.set({
          quick_tabs_session: this.globalState
        });
      }

      console.log('[STATE COORDINATOR] Persisted state to storage');
    } catch (err) {
      console.error('[STATE COORDINATOR] Error persisting state:', err);
      throw err;
    }
  }

  /**
   * Broadcast canonical state to all tabs
   */
  async broadcastState() {
    try {
      const tabs = await browser.tabs.query({});

      for (const tab of tabs) {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'SYNC_STATE_FROM_COORDINATOR',
            state: this.globalState
          })
          .catch(() => {
            // Content script not loaded in this tab, that's OK
          });
      }

      console.log(`[STATE COORDINATOR] Broadcasted state to ${tabs.length} tabs`);
    } catch (err) {
      console.error('[STATE COORDINATOR] Error broadcasting state:', err);
    }
  }

  /**
   * Get current state
   */
  getState() {
    return this.globalState;
  }
}

// Global state coordinator instance
const stateCoordinator = new StateCoordinator();
// ==================== END STATE COORDINATOR ====================

// ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
// This allows Quick Tabs to load any website, bypassing clickjacking protection
// ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
// v1.6.3.8-v5 - Issue 5: declarativeNetRequest feature detection with webRequest fallback
// Firefox Manifest V2 currently supports blocking webRequest, but Mozilla may enforce MV3-only
// in the future. This implementation provides future-proofing with declarativeNetRequest support.
// Security Note: This removes X-Frame-Options and CSP frame-ancestors headers
// which normally prevent websites from being embedded in iframes. This makes
// the extension potentially vulnerable to clickjacking attacks if a malicious
// website tricks the user into clicking on a Quick Tab overlay. Use with caution.

console.log('[Quick Tabs] Initializing X-Frame-Options bypass...');

// ==================== v1.6.3.8-v5 DECLARATIVENETREQUEST FEATURE DETECTION ====================
// Issue 5: Feature detection for MV3 compatibility

/**
 * Check if declarativeNetRequest API is available
 * v1.6.3.8-v5 - Issue 5: Feature detection for MV3 future-proofing
 * @returns {boolean} True if declarativeNetRequest API is available
 */
function isDeclarativeNetRequestAvailable() {
  return (
    typeof browser !== 'undefined' &&
    typeof browser.declarativeNetRequest !== 'undefined' &&
    typeof browser.declarativeNetRequest.updateSessionRules === 'function'
  );
}

/**
 * Track which API mode is being used for header modification
 * v1.6.3.8-v5 - Issue 5: Logged at startup for diagnostics
 * @type {'declarativeNetRequest' | 'webRequest' | 'none'}
 */
let headerModificationApiMode = 'none';

/**
 * Rule IDs for declarativeNetRequest session rules
 * v1.6.3.8-v5 - Issue 5: Unique IDs for each header rule
 */
const DNR_RULE_IDS = {
  REMOVE_X_FRAME_OPTIONS: 1,
  REMOVE_CSP: 2,
  REMOVE_CORP: 3
};

/**
 * Array of our rule IDs for cleanup operations
 * v1.6.3.8-v5 - Issue 5: Pre-computed to avoid repeated Object.values() calls
 */
const DNR_OUR_RULE_IDS = Object.values(DNR_RULE_IDS);

/**
 * Initialize declarativeNetRequest rules for iframe header modification
 * v1.6.3.8-v5 - Issue 5: Uses session rules (cleared on browser restart)
 * @returns {Promise<boolean>} True if initialization succeeded
 */
async function initializeDeclarativeNetRequest() {
  if (!isDeclarativeNetRequestAvailable()) {
    // v1.6.3.8-v5 - Issue 5: API not available, let caller handle fallback
    return false;
  }

  console.log('[Quick Tabs] Attempting to initialize declarativeNetRequest rules...');

  try {
    // Define session rules to modify response headers for sub_frame requests
    const rules = [
      {
        id: DNR_RULE_IDS.REMOVE_X_FRAME_OPTIONS,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            {
              header: 'X-Frame-Options',
              operation: 'remove'
            }
          ]
        },
        condition: {
          resourceTypes: ['sub_frame']
        }
      },
      {
        id: DNR_RULE_IDS.REMOVE_CSP,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            {
              header: 'Content-Security-Policy',
              operation: 'remove'
            }
          ]
        },
        condition: {
          resourceTypes: ['sub_frame']
        }
      },
      {
        id: DNR_RULE_IDS.REMOVE_CORP,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            {
              header: 'Cross-Origin-Resource-Policy',
              operation: 'remove'
            }
          ]
        },
        condition: {
          resourceTypes: ['sub_frame']
        }
      }
    ];

    // v1.6.3.8-v5 - Only remove our own rules to avoid interfering with other extensions
    // Use pre-computed DNR_OUR_RULE_IDS rather than clearing all existing rules

    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: DNR_OUR_RULE_IDS,
      addRules: rules
    });

    // Verify rules were added
    const addedRules = await browser.declarativeNetRequest.getSessionRules();
    console.log('[Quick Tabs] declarativeNetRequest session rules registered:', {
      ruleCount: addedRules.length,
      ruleIds: addedRules.map(r => r.id)
    });

    headerModificationApiMode = 'declarativeNetRequest';
    return true;
  } catch (err) {
    console.error('[Quick Tabs] Failed to initialize declarativeNetRequest:', {
      error: err.message,
      name: err.name
    });
    return false;
  }
}

/**
 * Initialize header modification using either declarativeNetRequest or webRequest
 * v1.6.3.8-v5 - Issue 5: Feature detection with fallback
 */
async function initializeHeaderModification() {
  // Try declarativeNetRequest first (MV3 future-proofing)
  const dnrSuccess = await initializeDeclarativeNetRequest();

  if (dnrSuccess) {
    console.log('[Quick Tabs] WEBREQUEST_API_MODE: declarativeNetRequest');
    console.log('[Quick Tabs] ✓ Using declarativeNetRequest for header modification (MV3-ready)');
    return;
  }

  // Fall back to webRequest (current MV2 implementation)
  // v1.6.3.8-v5 - Log why fallback is being used
  console.log('[Quick Tabs] declarativeNetRequest not available, using webRequest fallback');
  headerModificationApiMode = 'webRequest';
  console.log('[Quick Tabs] WEBREQUEST_API_MODE: webRequest');
  console.log('[Quick Tabs] ✓ Using webRequest for header modification (MV2 fallback)');
  initializeWebRequestHeaderModification();
}

/**
 * Initialize webRequest-based header modification (fallback)
 * v1.6.3.8-v5 - Issue 5: Wrapped in function for conditional initialization
 */
function initializeWebRequestHeaderModification() {
  console.log('[Quick Tabs] Initializing webRequest header modification...');

  // Track modified URLs for debugging
  const modifiedUrls = new Set();

  // v1.6.3.4-v11 - FIX Issue #6: Track recently processed iframe URLs to prevent spam logging
  const recentlyProcessedIframes = new Map(); // url -> timestamp
  const IFRAME_DEDUP_WINDOW_MS = 200; // Skip logging if same URL processed within 200ms

  /**
   * Clean up old entries from recentlyProcessedIframes Map
   * v1.6.3.4-v11 - FIX Issue #6: Extracted to reduce nesting depth
   * @private
   * @param {number} now - Current timestamp
   */
  function _cleanupOldIframeEntries(now) {
    const cutoff = now - IFRAME_DEDUP_WINDOW_MS * 10;
    for (const [url, timestamp] of recentlyProcessedIframes) {
      if (timestamp < cutoff) {
        recentlyProcessedIframes.delete(url);
      }
    }
  }

  /**
   * Handle X-Frame-Options header removal
   * v1.6.3.4-v11 - Extracted from onHeadersReceived to reduce complexity
   * @param {Object} header - HTTP header object
   * @param {string} url - Request URL for logging
   * @returns {boolean} false to remove header, true to keep
   */
  function _handleXFrameOptionsHeader(header, url) {
    console.log(`[Quick Tabs] ✓ Removed X-Frame-Options: ${header.value} from ${url}`);
    modifiedUrls.add(url);
    return false;
  }

  /**
   * Handle CSP header modification
   * v1.6.3.4-v11 - Extracted from onHeadersReceived to reduce complexity
   * @param {Object} header - HTTP header object (modified in place)
   * @param {string} url - Request URL for logging
   * @returns {boolean} false to remove header, true to keep
   */
  function _handleCSPHeader(header, url) {
    const originalValue = header.value;
    header.value = header.value.replace(/frame-ancestors[^;]*(;|$)/gi, '');

    // If CSP is now empty, remove the header entirely
    const trimmedValue = header.value.trim();
    if (trimmedValue === '' || trimmedValue === ';') {
      console.log(`[Quick Tabs] ✓ Removed empty CSP from ${url}`);
      modifiedUrls.add(url);
      return false;
    }

    // Log if we modified it
    if (header.value !== originalValue) {
      console.log(`[Quick Tabs] ✓ Modified CSP for ${url}`);
      modifiedUrls.add(url);
    }
    return true;
  }

  /**
   * Handle CORP header removal
   * v1.6.3.4-v11 - Extracted from onHeadersReceived to reduce complexity
   * @param {Object} header - HTTP header object
   * @param {string} url - Request URL for logging
   * @returns {boolean} false to remove header, true to keep
   */
  function _handleCORPHeader(header, url) {
    const value = header.value.toLowerCase();
    if (value === 'same-origin' || value === 'same-site') {
      console.log(`[Quick Tabs] ✓ Removed CORP: ${header.value} from ${url}`);
      modifiedUrls.add(url);
      return false;
    }
    return true;
  }

  /**
   * Filter security headers for Quick Tab iframe embedding
   * v1.6.3.4-v11 - Refactored: Extracted handlers (cc reduced from 9 to ~3)
   * @param {Object} header - HTTP header object
   * @param {string} url - Request URL for logging
   * @returns {boolean} false to remove header, true to keep
   */
  function _filterSecurityHeader(header, url) {
    const name = header.name.toLowerCase();

    if (name === 'x-frame-options') {
      return _handleXFrameOptionsHeader(header, url);
    }
    if (name === 'content-security-policy') {
      return _handleCSPHeader(header, url);
    }
    if (name === 'cross-origin-resource-policy') {
      return _handleCORPHeader(header, url);
    }
    return true;
  }

  browser.webRequest.onHeadersReceived.addListener(
    details => {
      // v1.6.3.4-v11 - FIX Issue #6: Deduplicate iframe processing logs
      const now = Date.now();
      const lastProcessed = recentlyProcessedIframes.get(details.url);
      const shouldLog = !lastProcessed || now - lastProcessed >= IFRAME_DEDUP_WINDOW_MS;

      if (shouldLog) {
        console.log(`[Quick Tabs] Processing iframe: ${details.url}`);
        recentlyProcessedIframes.set(details.url, now);

        // Clean up old entries to prevent memory leak
        if (recentlyProcessedIframes.size > 100) {
          _cleanupOldIframeEntries(now);
        }
      }

      const modifiedHeaders = details.responseHeaders.filter(header =>
        _filterSecurityHeader(header, details.url)
      );

      return { responseHeaders: modifiedHeaders };
    },
    {
      urls: ['<all_urls>'],
      types: ['sub_frame'] // Only iframes - filter at registration for better performance
    },
    ['blocking', 'responseHeaders'] // Firefox MV3 allows 'blocking'
  );

  // Log successful iframe loads
  browser.webRequest.onCompleted.addListener(
    details => {
      if (modifiedUrls.has(details.url)) {
        console.log(`[Quick Tabs] ✅ Successfully loaded iframe: ${details.url}`);
        // Clean up old URLs to prevent memory leak
        if (modifiedUrls.size > 100) {
          modifiedUrls.clear();
        }
      }
    },
    {
      urls: ['<all_urls>'],
      types: ['sub_frame']
    }
  );

  // Log failed iframe loads
  browser.webRequest.onErrorOccurred.addListener(
    details => {
      console.error(`[Quick Tabs] ❌ Failed to load iframe: ${details.url}`);
      console.error(`[Quick Tabs] Error: ${details.error}`);
    },
    {
      urls: ['<all_urls>'],
      types: ['sub_frame']
    }
  );

  console.log('[Quick Tabs] ✓ webRequest header modification installed');
} // End initializeWebRequestHeaderModification()

// ==================== HEADER MODIFICATION INITIALIZATION ====================
// v1.6.3.8-v5 - Issue 5: Initialize header modification with feature detection
// Call the async initialization function - fallback is handled within initializeHeaderModification()
initializeHeaderModification().catch(err => {
  // Only log error - fallback is already handled in initializeHeaderModification()
  console.error(
    '[Quick Tabs] Header modification initialization error:',
    err?.message || String(err)
  );
});

// ==================== END X-FRAME-OPTIONS BYPASS ====================

// Listen for tab switches to restore Quick Tabs
// v1.6.2.2 - Updated for unified format (no container filtering)
// v1.6.3.4-v11 - Fixed: Removed async since we use .catch() chains (require-await)
chrome.tabs.onActivated.addListener(activeInfo => {
  console.log('[Background] Tab activated:', activeInfo.tabId);

  // Message the activated tab to potentially restore Quick Tabs from storage
  chrome.tabs
    .sendMessage(activeInfo.tabId, {
      action: 'tabActivated',
      tabId: activeInfo.tabId
    })
    .catch(_err => {
      // Content script might not be ready yet, that's OK
      console.log('[Background] Could not message tab (content script not ready)');
    });

  // v1.6.2.2 - Send global state for immediate sync (no container filtering)
  if (globalQuickTabState.tabs && globalQuickTabState.tabs.length > 0) {
    chrome.tabs
      .sendMessage(activeInfo.tabId, {
        action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
        state: {
          tabs: globalQuickTabState.tabs,
          lastUpdate: globalQuickTabState.lastUpdate
        }
      })
      .catch(() => {
        // Content script might not be ready yet, that's OK
      });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'complete') {
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      })
      .then(() => {
        // After content script is loaded, restore Quick Tab state if it exists
        const state = quickTabStates.get(tabId);
        if (state && state.quickTabs && state.quickTabs.length > 0) {
          chrome.tabs
            .sendMessage(tabId, {
              action: 'restoreQuickTabs',
              quickTabs: state.quickTabs
            })
            .catch(_err => {
              // Ignore errors if content script isn't ready
            });
        }
      })
      .catch(_err => {
        // Silently fail for restricted pages
      });
  }
});

/**
 * Helper: Remove tab ID from Quick Tab's solo/mute arrays
 * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (lines 886, 893)
 *
 * @param {Object} quickTab - Quick Tab object to clean up
 * @param {number} tabId - Tab ID to remove
 * @returns {boolean} True if any changes were made
 */
function _removeTabFromQuickTab(quickTab, tabId) {
  let changed = false;

  // Remove from soloedOnTabs
  if (quickTab.soloedOnTabs && quickTab.soloedOnTabs.includes(tabId)) {
    quickTab.soloedOnTabs = quickTab.soloedOnTabs.filter(id => id !== tabId);
    changed = true;
    console.log(`[Background] Removed tab ${tabId} from Quick Tab ${quickTab.id} solo list`);
  }

  // Remove from mutedOnTabs
  if (quickTab.mutedOnTabs && quickTab.mutedOnTabs.includes(tabId)) {
    quickTab.mutedOnTabs = quickTab.mutedOnTabs.filter(id => id !== tabId);
    changed = true;
    console.log(`[Background] Removed tab ${tabId} from Quick Tab ${quickTab.id} mute list`);
  }

  return changed;
}

/**
 * Helper: Clean up Quick Tab state after tab closes
 * v1.6.0 - PHASE 4.3: Extracted to reduce complexity (cc=11 → cc<9)
 * v1.6.2.2 - Updated for unified format
 * v1.6.3.7-v13 - Issue #2: Use centralized write validation
 *
 * @param {number} tabId - Tab ID that was closed
 * @returns {Promise<boolean>} True if state was changed and persisted (either validated or recovered)
 */
async function _cleanupQuickTabStateAfterTabClose(tabId) {
  // Guard: Not initialized
  if (!isInitialized) {
    return false;
  }

  let stateChanged = false;

  // v1.6.2.2 - Process tabs array directly (unified format)
  for (const quickTab of globalQuickTabState.tabs || []) {
    if (_removeTabFromQuickTab(quickTab, tabId)) {
      stateChanged = true;
    }
  }

  // Save if state changed
  if (!stateChanged) {
    return false;
  }

  // v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
  // v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
  const stateToSave = {
    tabs: globalQuickTabState.tabs,
    saveId: `cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sequenceId: _getNextStorageSequenceId(),
    revision: _getNextRevision(),
    timestamp: Date.now()
  };

  // v1.6.3.7-v13 - Issue #2: Use centralized validation
  const result = await _writeQuickTabStateWithValidation(stateToSave, 'tab-cleanup');

  // Return true if write was validated OR if recovery succeeded
  const persistedSuccessfully = result.success || result.recovered;

  if (persistedSuccessfully) {
    console.log('[Background] Cleaned up Quick Tab state after tab closure', {
      validated: result.success,
      recovered: result.recovered
    });
  } else {
    console.error('[Background] Error saving cleaned up state:', {
      error: result.error,
      recovered: result.recovered,
      note: 'State may be inconsistent with storage'
    });
  }

  return persistedSuccessfully;
}

// Clean up state when tab is closed
// v1.5.9.13 - Also clean up solo/mute arrays when tabs close
// v1.6.0 - PHASE 4.3: Extracted cleanup logic to fix complexity and max-depth
chrome.tabs.onRemoved.addListener(async tabId => {
  quickTabStates.delete(tabId);
  console.log(`[Background] Tab ${tabId} closed - cleaning up Quick Tab references`);
  await _cleanupQuickTabStateAfterTabClose(tabId);
});

// ==================== MESSAGE ROUTING SETUP (v1.6.0 Phase 3.1) ====================
// Initialize message router and handlers for modular message processing
console.log('[Background] Initializing MessageRouter and handlers...');

const messageRouter = new MessageRouter();
messageRouter.setExtensionId(EXTENSION_ID);

// Create handler instances
const logHandler = new LogHandler(BACKGROUND_LOG_BUFFER, downloadsAPI, browser);

const quickTabHandler = new QuickTabHandler(
  globalQuickTabState,
  stateCoordinator,
  browser,
  initializeGlobalState
);

const tabHandler = new TabHandler(quickTabStates, browser);

// Set initialization flag for QuickTabHandler if state is already initialized
if (isInitialized) {
  quickTabHandler.setInitialized(true);
}

// Register log handlers (3 actions)
messageRouter.register('CLEAR_CONSOLE_LOGS', (msg, sender) =>
  logHandler.handleClearLogs(msg, sender)
);
messageRouter.register('GET_BACKGROUND_LOGS', (msg, sender) =>
  logHandler.handleGetLogs(msg, sender)
);
messageRouter.register('EXPORT_LOGS', (msg, sender) => logHandler.handleExportLogs(msg, sender));

// Register Quick Tab handlers (13 actions)
messageRouter.register('BATCH_QUICK_TAB_UPDATE', (msg, sender) =>
  quickTabHandler.handleBatchUpdate(msg, sender)
);
messageRouter.register('CREATE_QUICK_TAB', (msg, sender) =>
  quickTabHandler.handleCreate(msg, sender)
);
messageRouter.register('CLOSE_QUICK_TAB', (msg, sender) =>
  quickTabHandler.handleClose(msg, sender)
);
messageRouter.register(
  ['UPDATE_QUICK_TAB_POSITION', 'UPDATE_QUICK_TAB_POSITION_FINAL'],
  (msg, sender) => quickTabHandler.handlePositionUpdate(msg, sender)
);
messageRouter.register(['UPDATE_QUICK_TAB_SIZE', 'UPDATE_QUICK_TAB_SIZE_FINAL'], (msg, sender) =>
  quickTabHandler.handleSizeUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_PIN', (msg, sender) =>
  quickTabHandler.handlePinUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_SOLO', (msg, sender) =>
  quickTabHandler.handleSoloUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_MUTE', (msg, sender) =>
  quickTabHandler.handleMuteUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_MINIMIZE', (msg, sender) =>
  quickTabHandler.handleMinimizeUpdate(msg, sender)
);
// v1.6.0.12 - NEW: Handle z-index updates for cross-tab sync
messageRouter.register('UPDATE_QUICK_TAB_ZINDEX', (msg, sender) =>
  quickTabHandler.handleZIndexUpdate(msg, sender)
);
messageRouter.register('GET_CURRENT_TAB_ID', (msg, sender) =>
  quickTabHandler.handleGetCurrentTabId(msg, sender)
);
messageRouter.register('GET_CONTAINER_CONTEXT', (msg, sender) =>
  quickTabHandler.handleGetContainerContext(msg, sender)
);
messageRouter.register('SWITCH_TO_TAB', (msg, sender) =>
  quickTabHandler.handleSwitchToTab(msg, sender)
);
messageRouter.register('GET_QUICK_TABS_STATE', (msg, sender) =>
  quickTabHandler.handleGetQuickTabsState(msg, sender)
);

// Register tab handlers (5 actions)
messageRouter.register('openTab', (msg, sender) => tabHandler.handleOpenTab(msg, sender));
messageRouter.register('saveQuickTabState', (msg, sender) =>
  tabHandler.handleSaveState(msg, sender)
);
messageRouter.register('getQuickTabState', (msg, sender) => tabHandler.handleGetState(msg, sender));
messageRouter.register('clearQuickTabState', (msg, sender) =>
  tabHandler.handleClearState(msg, sender)
);
messageRouter.register('createQuickTab', (msg, sender) =>
  tabHandler.handleLegacyCreate(msg, sender)
);

// v1.6.3 - FIX: Handler for resetting globalQuickTabState cache when storage is cleared from popup
// This is called after popup.js clears storage to ensure background's cache is also reset
messageRouter.register('RESET_GLOBAL_QUICK_TAB_STATE', () => {
  console.log('[Background] Resetting globalQuickTabState cache (storage cleared from popup)');
  globalQuickTabState.tabs = [];
  globalQuickTabState.lastUpdate = Date.now();
  // Reset the state hash to allow next storage write to proceed
  lastBroadcastedStateHash = 0;
  return { success: true, message: 'Global Quick Tab state cache reset' };
});

/**
 * v1.6.3.5-v10 - FIX Issue #1: Broadcast QUICK_TABS_CLEARED to all tabs with per-tab logging
 * Extracted from COORDINATED_CLEAR_ALL_QUICK_TABS to reduce nesting depth
 * @param {Array} tabs - Browser tabs to broadcast to
 * @returns {Promise<Object>} - Broadcast result with success/fail counts
 */
async function _broadcastQuickTabsClearedToTabs(tabs) {
  let successCount = 0;
  let failCount = 0;
  const failures = [];

  for (const tab of tabs) {
    try {
      await browser.tabs.sendMessage(tab.id, {
        action: 'QUICK_TABS_CLEARED' // Different message: clear local only, no storage write
      });
      successCount++;
      console.log(`[Background] ✓ Notified tab ${tab.id}`);
    } catch (err) {
      failCount++;
      failures.push({ tabId: tab.id, error: err.message });
      console.log(`[Background] ✗ Failed tab ${tab.id}: ${err.message}`);
    }
  }

  // Log broadcast summary
  console.log(
    `[Background] Broadcast summary: ${successCount} success, ${failCount} failed, ${tabs.length} total`
  );
  if (failures.length > 0 && failures.length <= 10) {
    console.log('[Background] First failures:', failures.slice(0, 10));
  }

  return { successCount, failCount, totalTabs: tabs.length };
}

// v1.6.3.4 - FIX Bug #5: Coordinated clear handler to prevent storage write storm
// Settings page sends this message instead of clearing storage + broadcasting to all tabs
// Background clears storage ONCE, then broadcasts QUICK_TABS_CLEARED to all tabs
messageRouter.register('COORDINATED_CLEAR_ALL_QUICK_TABS', async () => {
  console.log('[Background] Coordinated clear: Clearing Quick Tab storage once');

  try {
    // v1.6.3.5-v8 - FIX Issue #8: Reset zero-tab tracking to prevent thrashing
    // Mark as "intentionally cleared" by setting counter to threshold value
    // This tells storage.onChanged to accept zero-tab states as valid
    consecutiveZeroTabReads = ZERO_TAB_CLEAR_THRESHOLD; // Intentionally cleared marker
    lastNonEmptyStateTimestamp = 0; // Allow immediate clear

    // Step 1: Clear storage once (single write instead of N writes from N tabs)
    await browser.storage.local.remove('quick_tabs_state_v2');

    // Step 2: Clear session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      await browser.storage.session.remove('quick_tabs_session');
    }

    // Step 3: Reset background's cache
    globalQuickTabState.tabs = [];
    globalQuickTabState.lastUpdate = Date.now();
    globalQuickTabState.saveId = `cleared-${Date.now()}`;
    lastBroadcastedStateHash = 0;

    // v1.6.3.5-v8 - FIX Issue #7: Clear quickTabHostTabs to prevent phantom Quick Tabs
    quickTabHostTabs.clear();

    // Step 4: Broadcast to all tabs to clear LOCAL state only (no storage write)
    // v1.6.3.5-v10 - FIX Issue #1: Use extracted function for per-tab logging
    const tabs = await browser.tabs.query({});
    const result = await _broadcastQuickTabsClearedToTabs(tabs);

    console.log(`[Background] Coordinated clear complete: Notified ${tabs.length} tabs`);
    return { success: true, ...result };
  } catch (err) {
    console.error('[Background] Coordinated clear failed:', err);
    return { success: false, error: err.message };
  }
});

console.log(
  `[Background] MessageRouter initialized with ${messageRouter.handlers.size} registered handlers`
);

// Handle messages from content script and sidebar - using MessageRouter
chrome.runtime.onMessage.addListener(messageRouter.createListener());

// ==================== KEYBOARD COMMAND LISTENER ====================
// v1.6.0 - Removed obsolete toggle-minimized-manager listener
// Now handled by the toggle-quick-tabs-manager listener below (line 1240)
// ==================== END KEYBOARD COMMAND LISTENER ====================

// Handle sidePanel toggle for Chrome (optional)
if (chrome.sidePanel) {
  chrome.action.onClicked.addListener(tab => {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(err => {
      console.log('Side panel not supported or error:', err);
    });
  });
}

/**
/**
 * Create a snapshot of current global state for logging
 * v1.6.4.14 - FIX Complexity: Extracted to reduce _applyUnifiedFormatFromStorage cc
 * @private
 */
function _createGlobalStateSnapshot() {
  const tabs = globalQuickTabState.tabs || [];
  return {
    tabCount: tabs.length,
    saveId: globalQuickTabState.saveId,
    tabIds: tabs.slice(0, 5).map(t => t.id) // Sample first 5
  };
}

/**
 * Apply unified format state to global state from storage
 * v1.6.3.4-v11 - Extracted from _updateGlobalStateFromStorage to reduce complexity
 * v1.6.3.6-v12 - FIX Issue #7: Enhanced logging with before/after state snapshots
 * v1.6.4.14 - FIX Complexity: Extracted _createGlobalStateSnapshot (cc=9 → cc=4)
 * @param {Object} newValue - Storage value with tabs array
 */
function _applyUnifiedFormatFromStorage(newValue) {
  // v1.6.3.6-v12 - FIX Issue #7: Log before state for before/after comparison
  const beforeState = _createGlobalStateSnapshot();

  globalQuickTabState.tabs = newValue.tabs;
  globalQuickTabState.lastUpdate = newValue.timestamp || Date.now();
  // v1.6.3.4 - FIX Bug #7: Track saveId for hash collision detection
  globalQuickTabState.saveId = newValue.saveId || null;

  // v1.6.3.6-v12 - FIX Issue #7: Log after state with comparison
  const afterState = _createGlobalStateSnapshot();

  console.log('[Background] v1.6.3.6-v12 CACHE_UPDATE:', {
    before: beforeState,
    after: afterState,
    delta: afterState.tabCount - beforeState.tabCount,
    saveIdChanged: beforeState.saveId !== afterState.saveId
  });

  // Store for debugging
  _lastCacheUpdateLog = { beforeState, afterState, timestamp: Date.now() };
}

/**
 * Check if value has container format (legacy)
 * v1.6.3.4-v11 - Extracted to reduce complexity
 * @param {Object} value - Value to check
 * @returns {boolean} true if value has containers property
 */
function _hasContainerFormat(value) {
  return typeof value === 'object' && value.containers;
}

/**
 * Apply migrated container format state from storage
 * v1.6.3.4-v11 - Extracted from _updateGlobalStateFromStorage to reduce complexity
 * @param {Object} newValue - Storage value with containers object
 */
function _applyMigratedContainerFromStorage(newValue) {
  globalQuickTabState.tabs = migrateContainersToUnifiedFormat(newValue.containers);
  globalQuickTabState.lastUpdate = newValue.timestamp || Date.now();
  console.log(
    '[Background] Updated global state from storage (migrated from container format):',
    globalQuickTabState.tabs.length,
    'tabs'
  );
}

/**
 * Helper: Update global state from storage value
 * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (lines 1087, 1095)
 * v1.6.2.2 - Updated for unified format
 * v1.6.3.4 - FIX Bug #7: Track saveId for hash collision detection
 * v1.6.3.4-v11 - Refactored: Extracted helpers to reduce cc below 9
 *
 * @param {Object|null} newValue - New storage value
 */
function _updateGlobalStateFromStorage(newValue) {
  // Guard: No value (storage cleared)
  if (!newValue) {
    console.log('[Background] Storage cleared, checking if intentional...');
    return;
  }

  // v1.6.2.2 - Unified format
  if (_hasValidTabsArray(newValue)) {
    _applyUnifiedFormatFromStorage(newValue);
    return;
  }

  // Backward compatibility: container format migration
  if (_hasContainerFormat(newValue)) {
    _applyMigratedContainerFromStorage(newValue);
  }
}

/**
 * Helper: Broadcast message to all tabs
 * v1.6.0 - PHASE 4.3: Extracted to reduce complexity
 *
 * @param {string} action - Message action type
 * @param {*} data - Data to send with message
 */
async function _broadcastToAllTabs(action, data) {
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    try {
      await browser.tabs.sendMessage(tab.id, { action, ...data });
    } catch (_err) {
      // Content script might not be loaded in this tab
    }
  }
}

/**
 * Helper: Check if this is our own write (prevents feedback loop)
 * v1.6.3.2 - Extracted from _handleQuickTabStateChange to reduce complexity
 * @param {Object} newValue - New storage value
 * @param {Object} handler - QuickTabHandler instance to check write timestamp
 * @returns {boolean} True if this is a self-write that should be ignored
 */
function _isSelfWrite(newValue, handler) {
  if (!newValue?.writeSourceId || !handler) return false;

  const lastWrite = handler.getLastWriteTimestamp();
  const isSameSourceId = lastWrite?.writeSourceId === newValue.writeSourceId;
  const isWithinWindow = Date.now() - (lastWrite?.timestamp || 0) < WRITE_IGNORE_WINDOW_MS;

  return isSameSourceId && isWithinWindow;
}

/**
 * Check if cache clear is within cooldown period
 * @private
 * @param {number} now - Current timestamp
 * @returns {boolean} True if within cooldown (should reject clear)
 */
function _isWithinClearCooldown(now) {
  const timeSinceNonEmpty = now - lastNonEmptyStateTimestamp;
  if (timeSinceNonEmpty < NON_EMPTY_STATE_COOLDOWN_MS) {
    console.warn('[Background] │ ⚠️ REJECTED: Clear within cooldown period:', {
      timeSinceNonEmpty,
      cooldownMs: NON_EMPTY_STATE_COOLDOWN_MS,
      reason: 'May be intermediate transaction state'
    });
    return true;
  }
  return false;
}

/**
 * Check if enough consecutive zero-tab reads have occurred
 * @private
 * @returns {boolean} True if threshold not met (should defer clear)
 */
function _shouldDeferClearForConfirmation() {
  consecutiveZeroTabReads++;
  if (consecutiveZeroTabReads < ZERO_TAB_CLEAR_THRESHOLD) {
    console.warn(
      '[Background] │ ⚠️ DEFERRED: Zero-tab read',
      consecutiveZeroTabReads,
      '/',
      ZERO_TAB_CLEAR_THRESHOLD
    );
    console.warn('[Background] │ Waiting for confirmation before clearing cache');
    return true;
  }
  return false;
}

/**
 * Execute the actual cache clear operation
 * @private
 * @param {Object} newValue - New storage value
 */
function _executeCacheClear(newValue) {
  const timeSinceNonEmpty = Date.now() - lastNonEmptyStateTimestamp;
  console.warn('[Background] ⚠️ WARNING: Clearing cache with 0 tabs:', {
    consecutiveReads: consecutiveZeroTabReads,
    timeSinceNonEmpty,
    currentCacheTabCount: globalQuickTabState.tabs?.length || 0
  });

  console.log('[Background] Storage cleared (empty/missing tabs), clearing cache');
  globalQuickTabState.tabs = [];
  globalQuickTabState.lastUpdate = newValue?.timestamp || Date.now();
  globalQuickTabState.saveId = newValue?.saveId || null;
  lastBroadcastedStateHash = computeStateHash(newValue);
  consecutiveZeroTabReads = 0;
}

/**
 * Helper: Clear cache when storage is empty
 * v1.6.3.2 - Extracted from _handleQuickTabStateChange to reduce complexity
 * v1.6.3.4 - FIX Bug #7: Reset saveId when cache is cleared
 * v1.6.3.4-v11 - FIX Issue #1, #8: Add cooldown and consecutive read validation
 * v1.6.4.8 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if cache was cleared, false if rejected
 */
function _clearCacheForEmptyStorage(newValue) {
  const now = Date.now();

  if (_isWithinClearCooldown(now)) return false;
  if (_shouldDeferClearForConfirmation()) return false;

  _executeCacheClear(newValue);
  return true;
}

/**
 * Check if tabs array is empty or missing
 * v1.6.3.4-v11 - Extracted from _handleQuickTabStateChange to reduce complexity
 * @param {Object} newValue - Storage value to check
 * @returns {boolean} true if tabs is empty or missing
 */
function _isTabsEmptyOrMissing(newValue) {
  return !newValue?.tabs || newValue.tabs.length === 0;
}

/**
 * Check if saveId has changed between current and new state
 * v1.6.3.4-v11 - Extracted from _handleQuickTabStateChange to reduce complexity
 * @param {Object} newValue - New storage value
 * @returns {boolean} true if saveId changed
 */
function _hasSaveIdChanged(newValue) {
  const currentSaveId = globalQuickTabState.saveId;
  const newSaveId = newValue?.saveId;
  return newSaveId && newSaveId !== currentSaveId;
}

/**
 * Check if state requires update (hash or saveId changed)
 * v1.6.3.4-v11 - Extracted from _handleQuickTabStateChange to reduce complexity
 * @param {Object} newValue - New storage value
 * @returns {boolean} true if state should be updated
 */
function _shouldUpdateState(newValue) {
  const newHash = computeStateHash(newValue);
  const hashChanged = newHash !== lastBroadcastedStateHash;
  const saveIdChanged = _hasSaveIdChanged(newValue);

  if (!hashChanged && !saveIdChanged) {
    console.log('[Background] State unchanged (same hash and saveId), skipping cache update');
    return false;
  }

  lastBroadcastedStateHash = newHash;
  return true;
}

/**
 * Handle Quick Tab state changes from storage
 * v1.6.2 - MIGRATION: Removed legacy _broadcastToAllTabs call
 * v1.6.2.2 - Updated for unified format
 * v1.6.3.2 - FIX Bug #1, #6: ALWAYS update cache when tabs is empty or missing
 *            Refactored to reduce complexity by extracting helpers
 * v1.6.3.4 - FIX Bug #7: Check saveId before hash comparison
 * v1.6.3.4-v11 - Refactored: Extracted helpers to reduce cc below 9
 * v1.6.3.4-v6 - FIX Issues #1, #2, #5: Transaction tracking, URL filtering, cooldown
 * v1.6.3.4-v8 - FIX Issue #8: Extracted logging and validation helpers
 *
 * Cross-tab sync is now handled exclusively via storage.onChanged:
 * - When any tab writes to storage.local, ALL OTHER tabs automatically receive the change
 * - Each tab's StorageManager listens for storage.onChanged events
 * - Background script only needs to keep its own cache (globalQuickTabState) updated
 *
 * @param {Object} changes - Storage changes object
 */
function _handleQuickTabStateChange(changes) {
  const newValue = changes.quick_tabs_state_v2.newValue;
  const oldValue = changes.quick_tabs_state_v2.oldValue;

  // v1.6.4.9 - Issue #4: Log storage change received with incoming values
  console.log('[Background] STORAGE_CHANGE_RECEIVED:', {
    saveId: newValue?.saveId,
    timestamp: newValue?.timestamp,
    transactionId: newValue?.transactionId,
    tabCount: newValue?.tabs?.length ?? 0,
    oldSaveId: oldValue?.saveId
  });

  // v1.6.3.4-v8 - Log state change for debugging
  _logStorageChange(oldValue, newValue);

  // v1.6.3.4-v8 - Check early exit conditions
  if (_shouldIgnoreStorageChange(newValue, oldValue)) {
    return;
  }

  // v1.6.3.4-v8 - Process and cache the update
  _processStorageUpdate(newValue);
}

/**
 * Extract tab count from storage value safely
 * @private
 * @param {Object} value - Storage value
 * @returns {number} Tab count or 0
 */
function _getTabCount(value) {
  return value?.tabs?.length ?? 0;
}

/**
 * Get saveId from storage value or 'none' placeholder
 * @private
 * @param {Object} value - Storage value
 * @returns {string} SaveId or 'none'
 */
function _getSaveIdOrNone(value) {
  return value?.saveId ?? 'none';
}

/**
 * Build sample tab info for logging
 * @private
 * @param {Object} newValue - New storage value
 * @returns {Object|null} Sample tab info or null
 */
function _buildSampleTabInfo(newValue) {
  const sampleTab = newValue?.tabs?.[0];
  if (!sampleTab) return null;
  return { id: sampleTab.id, zIndex: sampleTab.zIndex, minimized: sampleTab.minimized };
}

/**
 * Log storage change with comprehensive details for debugging
 * v1.6.3.4-v8 - FIX Issue #8: Extracted from _handleQuickTabStateChange
 * v1.6.4.8 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 */
function _logStorageChange(oldValue, newValue) {
  const oldCount = _getTabCount(oldValue);
  const newCount = _getTabCount(newValue);

  console.log('[Background] ┌─ storage.onChanged RECEIVED ─────────────────────────');
  console.log('[Background] │ tabs:', oldCount, '→', newCount);
  console.log(
    '[Background] │ saveId:',
    _getSaveIdOrNone(oldValue),
    '→',
    _getSaveIdOrNone(newValue)
  );
  console.log('[Background] Storage updated - sample tabs:', {
    tabCount: newCount,
    sampleTab: _buildSampleTabInfo(newValue)
  });

  _logCorruptionWarning(oldCount, newCount);
  console.log('[Background] └──────────────────────────────────────────────────────');
}

/**
 * Log warning for potential storage corruption (N → 0 tabs)
 * v1.6.3.4-v8 - Extracted to reduce _logStorageChange complexity
 * @param {number} oldCount - Previous tab count
 * @param {number} newCount - New tab count
 */
function _logCorruptionWarning(oldCount, newCount) {
  if (oldCount > 0 && newCount === 0) {
    console.warn('[Background] │ ⚠️ WARNING: Tab count dropped from', oldCount, 'to 0!');
    console.warn('[Background] │ This may indicate a storage corruption cascade');
  }
}

/**
 * Check if storage change should be ignored (early exit conditions)
 * v1.6.3.4-v8 - FIX Issue #8: Extracted from _handleQuickTabStateChange
 * v1.6.3.5-v3 - FIX Diagnostic Issue #1: Add writingInstanceId/writingTabId detection
 * v1.6.3.5-v3 - FIX Diagnostic Issue #8: Check for Firefox spurious events (no data change)
 * v1.6.3.6-v2 - FIX Issue #1: Removed _isSpuriousFirefoxEvent check - causes false negatives during loops
 *              Content scripts handle self-write detection via isSelfWrite(), background just updates cache
 * v1.6.3.6-v12 - FIX Issue #3: Multi-method deduplication restored with improved logic
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {boolean} True if change should be ignored
 */
function _shouldIgnoreStorageChange(newValue, oldValue) {
  // v1.6.3.6-v12 - FIX Issue #3: Multi-method deduplication in priority order
  const dedupResult = _multiMethodDeduplication(newValue, oldValue);
  if (dedupResult.shouldSkip) {
    console.log('[Background] v1.6.3.6-v12 Storage change SKIPPED:', {
      method: dedupResult.method,
      reason: dedupResult.reason
    });
    return true;
  }

  // Update cooldown tracking and log comparison
  _updateCooldownAndLogChange(newValue, oldValue);

  return false;
}

/**
 * Create a dedup result indicating the change should be skipped
 * v1.6.4.13 - FIX Complexity: Extracted to reduce _multiMethodDeduplication cc
 * v1.6.3.7-v12 - Issue #6: Track dedup statistics and log all decisions
 * @private
 * @param {string} method - Dedup method that triggered the skip
 * @param {string} reason - Reason for skipping
 * @param {Object} logDetails - Additional details for logging
 * @returns {{ shouldSkip: boolean, method: string, reason: string }}
 */
/**
 * Get current dedup stats snapshot
 * v1.6.3.7-v14 - FIX Duplication: Extracted common stats getter
 * @private
 */
function _getDedupStatsSnapshot() {
  return {
    skipped: dedupStats.skipped,
    processed: dedupStats.processed,
    total: dedupStats.skipped + dedupStats.processed
  };
}

/**
 * Update dedup tier counts based on the method used
 * v1.6.3.8-v6 - Issue #7: Extracted to reduce _createDedupResult complexity
 * @private
 * @param {string} method - Dedup method used
 */
function _incrementDedupTierCount(method) {
  if (!dedupStats.tierCounts) return;

  const tierKey = DEDUP_TIER_MAP[method];
  if (tierKey) {
    dedupStats.tierCounts[tierKey]++;
  }
}

/**
 * Create a dedup result with logging
 * v1.6.3.7-v14 - FIX Duplication: Unified factory for skip/process results
 * v1.6.3.7-v14 - FIX Excess Args: Use options object pattern
 * v1.6.3.8-v6 - Issue #7: Log dedup tier reached (saveId/sequenceId/revision/contentHash)
 * @private
 * @param {Object} options - Result configuration
 * @param {boolean} options.shouldSkip - Whether to skip processing
 * @param {string} options.method - Dedup method used
 * @param {string} options.reason - Reason for decision
 * @param {string} options.decision - Decision type (skip/process)
 * @param {Object} options.logDetails - Additional logging details
 */
function _createDedupResult({ shouldSkip, method, reason, decision, logDetails = {} }) {
  if (shouldSkip) {
    dedupStats.skipped++;
    // v1.6.3.8-v6 - Issue #7: Track tier reached
    _incrementDedupTierCount(method);
  } else {
    dedupStats.processed++;
  }

  const result = { shouldSkip, method, reason };

  // v1.6.3.8-v6 - Issue #7: Enhanced logging with tier and correlation ID
  const correlationId =
    logDetails.correlationId || `dedup-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  console.log('[Background] [STORAGE] DEDUP_DECISION:', {
    ...result,
    decision,
    tierReached: method,
    correlationId,
    dedupStatsSnapshot: _getDedupStatsSnapshot(),
    tierCounts: dedupStats.tierCounts,
    ...logDetails,
    timestamp: Date.now()
  });
  return result;
}

function _createSkipResult(method, reason, logDetails = {}) {
  return _createDedupResult({ shouldSkip: true, method, reason, decision: 'skip', logDetails });
}

/**
 * Create a dedup result indicating the change should be processed
 * v1.6.4.13 - FIX Complexity: Extracted to reduce _multiMethodDeduplication cc
 * v1.6.3.7-v12 - Issue #6: Track dedup statistics and log all decisions
 * v1.6.3.7-v13 - Issue #8: Add optional logDetails parameter for context
 * v1.6.3.7-v14 - FIX Duplication: Delegates to unified factory
 * @private
 * @param {Object} logDetails - Optional details for logging (saveId, sequenceId, etc.)
 * @returns {{ shouldSkip: boolean, method: string, reason: string }}
 */
function _createProcessResult(logDetails = {}) {
  return _createDedupResult({
    shouldSkip: false,
    method: 'none',
    reason: 'Legitimate change',
    decision: 'process',
    logDetails
  });
}

// ==================== EVENT ORDERING ARCHITECTURE (v1.6.3.7-v9, v1.6.3.7-v13) ====================
/**
 * Event Ordering Architecture (v1.6.3.7-v9)
 *
 * Firefox storage.onChanged provides NO ordering guarantees across multiple writes.
 * Two writes 100ms apart may have their onChanged events fire in any order.
 * MDN Reference: "The order in which listeners are called is not defined."
 *
 * Sequence IDs (assigned at write-time, not event-fire time) provide reliable
 * ordering because Firefox does not reorder messages from same JS execution.
 *
 * WHY SEQUENCE IDs WORK:
 * 1. Write A gets sequenceId=5, then calls storage.local.set()
 * 2. Write B gets sequenceId=6, then calls storage.local.set()
 * 3. Even if B's onChanged fires BEFORE A's, we detect this because:
 *    - B has sequenceId=6, A has sequenceId=5
 *    - If we've already processed sequenceId=6, sequenceId=5 is stale
 *
 * WHY TIMESTAMPS ARE INSUFFICIENT:
 * 1. Timestamps are assigned at write-time, same as sequence IDs
 * 2. BUT: Two writes 100ms apart may fire in reverse order
 * 3. The 50ms timestamp window cannot detect 150ms+ delays
 *
 * DEDUP PRIORITY ORDER:
 * 1. PRIMARY: Sequence ID comparison (strongest guarantee)
 * 2. SECONDARY: saveId + timestamp (50ms window, for legacy writes)
 * 3. TERTIARY: Content hash (for messages without saveId)
 *
 * See: _getNextStorageSequenceId(), _checkSequenceIdOrdering()
 */
// ==================== END EVENT ORDERING ARCHITECTURE ====================

/**
 * Build deduplication check log details
 * v1.6.4.14 - FIX Complexity: Extracted to reduce _multiMethodDeduplication cc
 * @private
 */
function _buildDedupLogDetails(newValue, oldValue) {
  return {
    newSaveId: newValue?.saveId,
    oldSaveId: oldValue?.saveId,
    newTimestamp: newValue?.timestamp,
    oldTimestamp: oldValue?.timestamp,
    newSequenceId: newValue?.sequenceId,
    oldSequenceId: oldValue?.sequenceId
  };
}

/**
 * Build saveId comparison details for logging
 * v1.6.4.14 - FIX Complexity: Extracted to reduce _multiMethodDeduplication cc
 * @private
 */
function _buildSaveIdComparisonDetails(newValue, oldValue) {
  const newTs = newValue?.timestamp || 0;
  const oldTs = oldValue?.timestamp || 0;
  return {
    saveId: newValue?.saveId,
    newTs,
    oldTs,
    diffMs: Math.abs(newTs - oldTs)
  };
}

/**
 * Multi-method deduplication for storage changes
 * v1.6.3.6-v12 - FIX Issue #3: Check multiple dedup methods in priority order
 * v1.6.4.9 - Issue #4: Enhanced logging with comparison values
 * v1.6.3.7-v9 - FIX Issue #3: Unified dedup strategy - removed dead transactionId code
 * v1.6.4.13 - FIX Complexity: Extracted result helpers (cc=17 → cc=7)
 * v1.6.4.14 - FIX Complexity: Extracted log builders (cc=17 → cc=4)
 * v1.6.3.7-v12 - Issue #9: Prioritize sequence ID ordering over arbitrary 50ms window
 *   - PRIMARY: Sequence ID comparison (stronger ordering guarantee)
 *   - SECONDARY: saveId + timestamp comparison (fallback for legacy writes)
 *   - TERTIARY: Content hash comparison for messages without saveId
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {{ shouldSkip: boolean, method: string, reason: string }}
 */
/**
 * Run sequence ID dedup check
 * v1.6.3.7-v14 - FIX Complexity: Extracted dedup step
 * @private
 */
function _runSequenceIdCheck(newValue, oldValue) {
  const sequenceResult = _checkSequenceIdOrdering(newValue, oldValue);
  if (sequenceResult.shouldSkip) {
    return _createSkipResult('sequenceId', sequenceResult.reason, {
      newSequenceId: newValue?.sequenceId,
      oldSequenceId: oldValue?.sequenceId,
      explanation:
        'Sequence ID ordering: events with lower or equal sequenceId than already-processed events are duplicates'
    });
  }
  return null;
}

/**
 * Run saveId + timestamp dedup check
 * v1.6.3.7-v14 - FIX Complexity: Extracted dedup step
 * @private
 */
function _runSaveIdTimestampCheck(newValue, oldValue) {
  if (_isSaveIdTimestampDuplicate(newValue, oldValue)) {
    return _createSkipResult('saveId+timestamp', 'Same saveId and timestamp within window', {
      comparison: _buildSaveIdComparisonDetails(newValue, oldValue),
      note: 'Fallback method - new writes should use sequenceId'
    });
  }
  return null;
}

/**
 * Run content hash dedup check
 * v1.6.3.7-v14 - FIX Complexity: Extracted dedup step
 * @private
 */
function _runContentHashCheck(newValue, oldValue) {
  if (_isContentHashDuplicate(newValue, oldValue)) {
    return _createSkipResult(
      'contentHash',
      'Identical content (tertiary safeguard for no-saveId messages)',
      {
        hasSaveId: !!newValue?.saveId
      }
    );
  }
  return null;
}

/**
 * Check if event is too old and should be rejected
 * v1.6.3.8-v8 - Issue #18: Maximum event age enforcement (5 minutes)
 * @private
 * @param {Object} newValue - New storage value
 * @returns {{ shouldSkip: boolean, reason: string, ageMs: number } | null} Skip result if stale, null if valid
 */
function _runMaxEventAgeCheck(newValue) {
  const eventTimestamp = newValue?.timestamp;
  if (!eventTimestamp) {
    // No timestamp - can't check age, allow processing
    return null;
  }

  const eventAgeMs = Date.now() - eventTimestamp;
  if (eventAgeMs > MAX_STATE_CHANGE_AGE_MS) {
    console.warn('[Background] STALE_EVENT_REJECTED:', {
      eventAgeMs,
      maxAgeMs: MAX_STATE_CHANGE_AGE_MS,
      eventTimestamp,
      saveId: newValue?.saveId,
      sequenceId: newValue?.sequenceId,
      tabCount: newValue?.tabs?.length,
      reason: 'Event exceeds maximum age threshold - likely from stuck queue'
    });

    return _createSkipResult(
      'staleEventAge',
      `Event is ${Math.round(eventAgeMs / 1000)}s old (max: ${MAX_STATE_CHANGE_AGE_MS / 1000}s)`,
      {
        eventAgeMs,
        maxAgeMs: MAX_STATE_CHANGE_AGE_MS,
        eventTimestamp
      }
    );
  }

  return null;
}

function _multiMethodDeduplication(newValue, oldValue) {
  console.log('[Background] [STORAGE] DEDUP_CHECK:', _buildDedupLogDetails(newValue, oldValue));

  // v1.6.3.8-v8 - Issue #18: Check max event age FIRST (reject ancient operations)
  const ageCheck = _runMaxEventAgeCheck(newValue);
  if (ageCheck) return ageCheck;

  // Run dedup checks in priority order, return first match
  const sequenceCheck = _runSequenceIdCheck(newValue, oldValue);
  if (sequenceCheck) return sequenceCheck;

  const saveIdCheck = _runSaveIdTimestampCheck(newValue, oldValue);
  if (saveIdCheck) return saveIdCheck;

  const hashCheck = _runContentHashCheck(newValue, oldValue);
  if (hashCheck) return hashCheck;

  return _createProcessResult({
    saveId: newValue?.saveId,
    sequenceId: newValue?.sequenceId,
    tabCount: newValue?.tabs?.length
  });
}

/**
 * Check if sequence ID indicates this is an old/duplicate event
 * v1.6.3.7-v12 - Issue #9: Sequence ID-based ordering replaces arbitrary timestamp window
 * v1.6.3.7-v12 - FIX Code Review: Renamed 'skip' to 'shouldSkip' for clarity
 * v1.6.3.7-v13 - Issue #3: Added comprehensive explanation of ordering guarantees
 *
 * IMPORTANT: Why Sequence IDs Provide Ordering Guarantees
 * ========================================================
 * Firefox's storage.onChanged provides NO ordering guarantees across multiple writes.
 * Two writes made 100ms apart may have their storage.onChanged events fire in ANY order
 * due to Firefox's async event processing, IndexedDB batching, and internal scheduling.
 *
 * Sequence IDs solve this because they are assigned BEFORE the storage.local.set() call,
 * during the same synchronous JS execution that initiates the write. This means:
 *
 * 1. Write A gets sequenceId=5, then calls storage.local.set()
 * 2. Write B gets sequenceId=6, then calls storage.local.set()
 *
 * Even if B's storage.onChanged fires BEFORE A's (which Firefox allows), we can detect
 * this because B will have sequenceId=6 and A will have sequenceId=5. If we've already
 * processed sequenceId=6, we know sequenceId=5 is stale data from an older write.
 *
 * The 50ms timestamp window (DEDUP_SAVEID_TIMESTAMP_WINDOW_MS) is kept as a SECONDARY
 * fallback for legacy writes that don't have sequenceId, but it cannot reliably detect
 * out-of-order events because timestamps are also assigned at write-time, not event-fire time.
 *
 * @private
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {{ shouldSkip: boolean, reason: string }}
 */
/**
 * Check if both values have valid numeric sequence IDs
 * v1.6.3.7-v14 - FIX Complexity: Extracted predicate to reduce cc
 * @private
 */
function _hasValidSequenceIds(newValue, oldValue) {
  return typeof newValue?.sequenceId === 'number' && typeof oldValue?.sequenceId === 'number';
}

/**
 * Log missing sequence ID diagnostic
 * v1.6.3.7-v14 - FIX Complexity: Extracted logger to reduce cc
 * @private
 */
function _logMissingSequenceId(newSeqId, oldSeqId) {
  if (DEBUG_DIAGNOSTICS) {
    console.log(
      '[Background] [STORAGE] SEQUENCE_ID_CHECK: Missing sequenceId, falling back to other methods',
      {
        hasNewSeqId: typeof newSeqId === 'number',
        hasOldSeqId: typeof oldSeqId === 'number'
      }
    );
  }
}

/**
 * Log and return skip result for stale/duplicate sequence
 * v1.6.3.7-v14 - FIX Complexity: Extracted to reduce cc and flatten conditionals
 * @private
 */
function _handleStaleSequenceId(newSeqId, oldSeqId) {
  const isDuplicate = newSeqId === oldSeqId;
  const isOutOfOrder = newSeqId < oldSeqId;

  if (isOutOfOrder) {
    console.log(
      '[Background] [STORAGE] OUT_OF_ORDER_EVENTS: Older sequence fired after newer sequence',
      {
        olderSequenceId: newSeqId,
        newerSequenceId: oldSeqId,
        explanation:
          'Firefox storage.onChanged events can fire in any order - this older write arrived late'
      }
    );
  }

  console.log('[Background] [STORAGE] SEQUENCE_ID_SKIP: Old or duplicate event detected', {
    newSequenceId: newSeqId,
    oldSequenceId: oldSeqId,
    isDuplicate,
    isOutOfOrder
  });

  const reason = isDuplicate
    ? 'Same sequenceId (duplicate event)'
    : 'Lower sequenceId (out-of-order event from older write)';
  return { shouldSkip: true, reason };
}

/**
 * Log valid sequence progression diagnostic
 * v1.6.3.7-v14 - FIX Complexity: Extracted logger to reduce cc
 * @private
 */
function _logValidSequenceProgression(newSeqId, oldSeqId) {
  if (DEBUG_DIAGNOSTICS) {
    console.log('[Background] [STORAGE] SEQUENCE_ID_PASS: Valid new event', {
      newSequenceId: newSeqId,
      oldSequenceId: oldSeqId,
      increment: newSeqId - oldSeqId
    });
  }
}

function _checkSequenceIdOrdering(newValue, oldValue) {
  const newSeqId = newValue?.sequenceId;
  const oldSeqId = oldValue?.sequenceId;

  // Can't use sequence ordering if either lacks sequenceId
  if (!_hasValidSequenceIds(newValue, oldValue)) {
    _logMissingSequenceId(newSeqId, oldSeqId);
    return { shouldSkip: false, reason: 'No sequenceId available' };
  }

  // Stale or duplicate event - sequence ID is same or lower
  if (newSeqId <= oldSeqId) {
    return _handleStaleSequenceId(newSeqId, oldSeqId);
  }

  // Valid sequence progression
  _logValidSequenceProgression(newSeqId, oldSeqId);
  return { shouldSkip: false, reason: 'Valid sequence progression' };
}

/**
 * Check if saveId + timestamp indicate a duplicate write
 * v1.6.3.6-v12 - FIX Issue #3: Second dedup method
 * v1.6.3.7-v9 - FIX Issue #3: Now the PRIMARY dedup method
 * @private
 */
function _isSaveIdTimestampDuplicate(newValue, oldValue) {
  if (!newValue?.saveId || !oldValue?.saveId) return false;
  if (newValue.saveId !== oldValue.saveId) return false;

  // Same saveId - check if timestamps are close enough to be same write
  const newTs = newValue.timestamp || 0;
  const oldTs = oldValue.timestamp || 0;
  return Math.abs(newTs - oldTs) < DEDUP_SAVEID_TIMESTAMP_WINDOW_MS;
}

/**
 * Check if saveIds indicate different writes (not a duplicate)
 * v1.6.3.7-v9 - FIX Issue #3: Extracted helper to reduce complexity
 * @private
 */
function _areSaveIdsDifferent(newValue, oldValue) {
  const newHasSaveId = !!newValue?.saveId;
  const oldHasSaveId = !!oldValue?.saveId;

  if (!newHasSaveId || !oldHasSaveId) {
    return false; // Can't determine if different without both saveIds
  }

  return newValue.saveId !== oldValue.saveId;
}

/**
 * Log content hash match details
 * v1.6.3.7-v9 - FIX Issue #3: Extracted helper to reduce complexity
 * @private
 */
function _logContentHashMatch(newHasSaveId, oldHasSaveId, saveIdMatch) {
  const mode = !newHasSaveId || !oldHasSaveId ? 'secondary-no-saveId' : 'firefox-spurious';
  console.log('[Background] v1.6.3.7-v9 Content hash match detected:', {
    mode,
    newHasSaveId,
    oldHasSaveId,
    saveIdMatch
  });
}

/**
 * Check if content hash indicates a duplicate (Firefox spurious event)
 * v1.6.3.6-v12 - FIX Issue #3: Third dedup method (safe version)
 * v1.6.3.7-v9 - FIX Issue #3: Updated as SECONDARY safeguard for messages without saveId
 *   - If neither has saveId: use pure content comparison (secondary safeguard)
/**
 * Check if content hashes match (non-empty and equal)
 * v1.6.4.14 - FIX Complexity: Extracted predicate
 * @private
 */
function _doContentHashesMatch(newContentKey, oldContentKey) {
  return newContentKey !== '' && newContentKey === oldContentKey;
}

/**
 * Determine if saveIds indicate a match
 * v1.6.4.14 - FIX Complexity: Extracted computation
 * @private
 */
function _computeSaveIdMatch(newValue, oldValue) {
  const newHasSaveId = !!newValue?.saveId;
  const oldHasSaveId = !!oldValue?.saveId;
  return newHasSaveId && oldHasSaveId && newValue.saveId === oldValue.saveId;
}

/**
 * Check if content hash indicates a duplicate (Firefox spurious event)
 * v1.6.3.6-v12 - FIX Issue #3: Third dedup method (safe version)
 * v1.6.3.7-v9 - FIX Issue #3: Updated as SECONDARY safeguard for messages without saveId
 *   - If neither has saveId: use pure content comparison (secondary safeguard)
 *   - If both have same saveId: check content to catch Firefox spurious events
 *   - If saveIds differ: not a duplicate (different writes)
 * v1.6.4.14 - FIX Complexity: Extracted helpers (cc=10 → cc=4)
 * @private
 */
function _isContentHashDuplicate(newValue, oldValue) {
  // Early exit checks
  if (!newValue || !oldValue) return false;
  if (_areSaveIdsDifferent(newValue, oldValue)) return false;

  // Compute and compare content keys
  const newContentKey = _computeQuickTabContentKey(newValue);
  const oldContentKey = _computeQuickTabContentKey(oldValue);

  if (!_doContentHashesMatch(newContentKey, oldContentKey)) return false;

  // Content matches - log and return true
  const saveIdMatch = _computeSaveIdMatch(newValue, oldValue);
  _logContentHashMatch(!!newValue?.saveId, !!oldValue?.saveId, saveIdMatch);

  return true;
}

// v1.6.3.7-v9 - FIX Issue #3: REMOVED _isTransactionSelfWrite function (dead code)
// The IN_PROGRESS_TRANSACTIONS set was never populated, making this function useless
// Transaction-based dedup is replaced by saveId-based deduplication

/**
 * Check and log if storage change is within cooldown period
 * v1.6.3.7-v9 - FIX Issue #5: Cooldown now applied conditionally only when dedup triggers
 * @private
 * @param {number} now - Current timestamp
 * @returns {boolean} True if within cooldown
 */
function _checkAndLogCooldown(now) {
  const isWithinCooldown = now - lastStorageChangeProcessed < STORAGE_CHANGE_COOLDOWN_MS;
  if (isWithinCooldown) {
    console.log('[Background] Storage change within cooldown, may skip');
  }
  lastStorageChangeProcessed = now;
  return isWithinCooldown;
}

/**
 * Build storage change comparison object for logging
 * v1.6.3.7-v9 - FIX Issue #3, #6: Replaced transactionId with sequenceId for event ordering
 * @private
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {Object} Comparison object
 */
function _buildStorageChangeComparison(newValue, oldValue) {
  return {
    oldTabCount: _getTabCount(oldValue),
    newTabCount: _getTabCount(newValue),
    oldSaveId: oldValue?.saveId,
    newSaveId: newValue?.saveId,
    oldSequenceId: oldValue?.sequenceId,
    newSequenceId: newValue?.sequenceId,
    writingInstanceId: newValue?.writingInstanceId,
    writingTabId: newValue?.writingTabId
  };
}

/**
 * Update cooldown tracking and log the storage change
 * v1.6.3.5-v3 - Extracted to reduce _shouldIgnoreStorageChange complexity
 * v1.6.4.8 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 */
function _updateCooldownAndLogChange(newValue, oldValue) {
  _checkAndLogCooldown(Date.now());
  console.log(
    '[Background] Storage change comparison:',
    _buildStorageChangeComparison(newValue, oldValue)
  );
}

/**
 * Check if saveId and tabCount match between two storage values
 * v1.6.3.5-v3 - Helper to reduce _isSpuriousFirefoxEvent complexity
 * @private
 */
function _hasMatchingSaveIdAndTabCount(newValue, oldValue) {
  const sameSaveId = newValue.saveId && oldValue.saveId && newValue.saveId === oldValue.saveId;
  const oldTabCount = oldValue.tabs?.length ?? 0;
  const newTabCount = newValue.tabs?.length ?? 0;
  return sameSaveId && oldTabCount === newTabCount;
}

/**
 * Compute simple tab content hash for comparison
 * v1.6.3.5-v3 - FIX Code Review: Verify actual tab contents, not just counts
 * @private
 */
function _computeQuickTabContentKey(value) {
  if (!value?.tabs || !Array.isArray(value.tabs)) return '';
  // Create a deterministic key from tab IDs and minimized states
  return value.tabs
    .map(t => `${t.id}:${t.minimized ? 1 : 0}`)
    .sort()
    .join(',');
}

/**
 * Check if both values exist (non-null/undefined)
 * @private
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {boolean} True if both values exist
 */
function _bothValuesExist(newValue, oldValue) {
  return newValue && oldValue;
}

/**
 * Check if tab contents differ between old and new values
 * @private
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {boolean} True if contents differ
 */
function _tabContentsDiffer(newValue, oldValue) {
  const oldContentKey = _computeQuickTabContentKey(oldValue);
  const newContentKey = _computeQuickTabContentKey(newValue);
  return oldContentKey !== newContentKey;
}

/**
 * Check if timestamps match exactly
 * @private
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {boolean} True if timestamps match
 */
function _timestampsMatch(newValue, oldValue) {
  return newValue.timestamp && oldValue.timestamp && newValue.timestamp === oldValue.timestamp;
}

/**
 * Log spurious event detection result
 * @private
 * @param {boolean} sameTimestamp - Whether timestamps match
 * @param {Object} newValue - New storage value
 */
function _logSpuriousEventDetection(sameTimestamp, newValue) {
  if (sameTimestamp) {
    console.log('[Background] Spurious event detected (same saveId, tabCount, timestamp, content)');
  } else {
    console.log('[Background] Probable spurious event (same saveId, tabCount, content):', {
      saveId: newValue.saveId,
      tabCount: _getTabCount(newValue)
    });
  }
}

/**
 * Check if this is a Firefox spurious storage.onChanged event (no actual data change)
 * v1.6.3.5-v3 - FIX Diagnostic Issue #8: Firefox fires onChanged even without data change
 * v1.6.4.8 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * NOTE: We use multiple criteria to avoid false positives from saveId collisions
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {boolean} True if this is a spurious event
 */
function _isSpuriousFirefoxEvent(newValue, oldValue) {
  if (!_bothValuesExist(newValue, oldValue)) return false;
  if (!_hasMatchingSaveIdAndTabCount(newValue, oldValue)) return false;

  if (_tabContentsDiffer(newValue, oldValue)) {
    console.log('[Background] Not spurious - tab content differs despite matching saveId/count');
    return false;
  }

  _logSpuriousEventDetection(_timestampsMatch(newValue, oldValue), newValue);
  return true;
}

// Track recently processed instance writes to prevent double-processing
const _recentlyProcessedWrites = new Map(); // instanceId+saveId -> timestamp
const RECENT_WRITE_EXPIRY_MS = 500;

/**
 * Check if a write from this instance was recently processed
 * v1.6.3.5-v3 - FIX Diagnostic Issue #1: Prevent double-processing
 * @param {string} instanceId - Writing instance ID
 * @param {string} saveId - Save ID
 * @returns {boolean} True if recently processed
 */
function _isRecentlyProcessedInstanceWrite(instanceId, saveId) {
  const key = `${instanceId}-${saveId}`;
  const now = Date.now();

  // Clean up old entries
  for (const [k, timestamp] of _recentlyProcessedWrites.entries()) {
    if (now - timestamp > RECENT_WRITE_EXPIRY_MS) {
      _recentlyProcessedWrites.delete(k);
    }
  }

  // Check if this write was recently processed
  if (_recentlyProcessedWrites.has(key)) {
    return true;
  }

  // Mark as processed
  _recentlyProcessedWrites.set(key, now);
  return false;
}

/**
 * Process storage update and update global cache
 * v1.6.3.4-v8 - FIX Issue #8: Extracted from _handleQuickTabStateChange
 * v1.6.3.4-v11 - FIX Issue #3, #8: Cache update only, no broadcast; reset consecutive counter
 * v1.6.3.8-v6 - Issue #7: Enhanced logging with correlation ID
 * @param {Object} newValue - New storage value
 */
function _processStorageUpdate(newValue) {
  // v1.6.3.8-v6 - Issue #7: Generate correlation ID for tracking this storage event
  const correlationId = `storage-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  // Handle empty/missing tabs
  if (_isTabsEmptyOrMissing(newValue)) {
    _clearCacheForEmptyStorage(newValue);
    return;
  }

  // v1.6.3.4-v11 - FIX Issue #8: Reset consecutive counter and update timestamp when we get valid tabs
  consecutiveZeroTabReads = 0;
  lastNonEmptyStateTimestamp = Date.now();

  // Check if state actually requires update
  if (!_shouldUpdateState(newValue)) {
    return;
  }

  // Filter out tabs with invalid URLs
  const filteredValue = filterValidTabs(newValue);

  // v1.6.3.4-v11 - Background caches state for popup/sidebar queries
  // Each tab handles its own sync via storage.onChanged listener in StorageManager
  // v1.6.3.8-v8 - Issue #13: BC removed, port-based notification only
  // v1.6.3.8-v6 - Issue #7: Enhanced logging with correlation ID and sequenceId
  console.log('[Background] [STORAGE] STATE_CHANGE_DETECTED:', {
    tabCount: filteredValue.tabs?.length || 0,
    saveId: filteredValue.saveId,
    sequenceId: filteredValue.sequenceId,
    revisionId: filteredValue.revisionId,
    correlationId,
    timestamp: Date.now()
  });
  _updateGlobalStateFromStorage(filteredValue);

  // v1.6.3.8-v8 - Issue #13: Broadcast via port-based messaging (BC removed)
  // This ensures Manager receives instant updates when storage changes
  _broadcastStorageWriteConfirmation(filteredValue, filteredValue.saveId);
}

/**
 * Helper: Handle settings changes
 * v1.6.0 - PHASE 4.3: Extracted to reduce complexity
 *
 * @param {Object} changes - Storage changes object
 */
async function _handleSettingsChange(changes) {
  console.log('[Background] Settings changed, broadcasting to all tabs');

  await _broadcastToAllTabs('SETTINGS_UPDATED', {
    settings: changes.quick_tab_settings.newValue
  });
}

// ==================== STORAGE SYNC BROADCASTING ====================
// Listen for local/sync storage changes and broadcast them to all tabs
// This enables real-time Quick Tab state synchronization across all tabs
// v1.6.0 - PHASE 4.3: Refactored to extract handlers (cc=11 → cc<9, max-depth fixed)
// v1.6.0.12 - FIX: Listen for local storage changes (where we now save)
// v1.6.3.7-v9 - FIX Issue #11: Add initialization guard to prevent race condition

/**
 * Handle storage.onChanged events with initialization guard
 * v1.6.3.7-v9 - FIX Issue #11: Explicit initialization check before processing
 * v1.6.3.7-v10 - FIX Issue #11: Added time since init start for logging
 * @param {Object} changes - Storage changes
 * @param {string} areaName - Storage area name
 */
function _handleStorageOnChanged(changes, areaName) {
  // v1.6.3.7-v10 - FIX Issue #11: Log listener entry with initialization status + time since init start
  const timeSinceInitStartMs = Date.now() - initializationStartTime;
  console.log('[Background] LISTENER_ENTRY: storage.onChanged', {
    isInitialized,
    timeSinceInitStartMs,
    areaName,
    changedKeys: Object.keys(changes),
    timestamp: Date.now()
  });

  // v1.6.3.7-v9 - FIX Issue #11: Guard against processing before initialization
  if (!isInitialized) {
    console.warn('[Background] LISTENER_CALLED_BEFORE_INIT: storage.onChanged', {
      areaName,
      changedKeys: Object.keys(changes),
      timeSinceInitStartMs,
      message: 'Skipping - background script not yet initialized',
      timestamp: Date.now()
    });
    return;
  }

  // v1.6.0.12 - FIX: Process both local (primary) and sync (fallback) storage
  if (areaName !== 'local' && areaName !== 'sync') {
    return;
  }

  // Handle Quick Tab state changes
  if (changes.quick_tabs_state_v2) {
    _handleQuickTabStateChange(changes);
  }

  // Handle settings changes
  if (changes.quick_tab_settings) {
    _handleSettingsChange(changes);
  }
}

// Register storage.onChanged listener
// v1.6.3.7-v9 - FIX Issue #11: Listener is registered at script load, but handler has init guard
// v1.6.3.7-v10 - FIX Issue #11: Enhanced logging with initialization status
browser.storage.onChanged.addListener(_handleStorageOnChanged);
console.log('[Background] LISTENER_REGISTERED: storage.onChanged', {
  isInitialized,
  hasInitGuard: true,
  timestamp: Date.now()
});

// ==================== END STORAGE SYNC BROADCASTING ====================

// v1.6.3.4-v2 - Sidebar initialization delay constant (time for DOM ready + scripts loaded)
const SIDEBAR_INIT_DELAY_MS = 300;

/**
 * Open sidebar and switch to Manager tab
 * v1.6.1.4 - Extracted to fix max-depth eslint error
 * v1.6.2.0 - Fixed: Improved timing and retry logic for sidebar message delivery
 */
async function _openSidebarAndSwitchToManager() {
  try {
    // Check if sidebar is already open
    const isOpen = await browser.sidebarAction.isOpen({});

    if (!isOpen) {
      // Open sidebar if closed
      await browser.sidebarAction.open();
      // Wait for sidebar to fully initialize (DOM ready + scripts loaded)
      await new Promise(resolve => setTimeout(resolve, SIDEBAR_INIT_DELAY_MS));
    }

    // Send message to sidebar to switch to Manager tab with retry logic
    await _sendManagerTabMessage();

    console.log('[Sidebar] Opened sidebar and switched to Manager tab');
  } catch (error) {
    console.error('[Sidebar] Error opening sidebar:', error);
  }
}

/**
 * Log detailed error information for message sending failures
 * v1.6.3.4-v4 - FIX: Extracted utility function to reduce code duplication
 * @param {string} prefix - Log message prefix (e.g., '[Background] Failed to send X:')
 * @param {Error} error - The error object
 */
function _logMessageError(prefix, error) {
  console.debug(prefix, {
    name: error?.name || 'Unknown',
    message: error?.message || 'No message',
    stack: error?.stack || 'No stack'
  });
}

/**
 * Attempt to send a single sidebar message
 * v1.6.3.4-v11 - Extracted from _sendSidebarMessage to fix max-depth
 * @param {string} messageType - Message type to send
 * @returns {Promise<boolean>} true if successful, false otherwise
 */
async function _trySendSidebarMessage(messageType) {
  try {
    await browser.runtime.sendMessage({ type: messageType });
    return true;
  } catch (error) {
    _logMessageError(`[Background] Failed to send ${messageType}:`, error);
    return false;
  }
}

/**
 * Generic sidebar message sender with retry logic
 * v1.6.3.4-v11 - Consolidated from _sendManagerTabMessage and _sendSettingsTabMessage
 *           - Extracted _trySendSidebarMessage to fix max-depth
 * @param {string} messageType - Message type to send (e.g., 'SWITCH_TO_MANAGER_TAB')
 * @param {string} logPrefix - Prefix for logging (e.g., 'Manager')
 * @returns {Promise<boolean>} true if sent successfully, false otherwise
 */
async function _sendSidebarMessage(messageType, logPrefix) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 150; // ms between retries

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const success = await _trySendSidebarMessage(messageType);
    if (success) return true;

    // Sidebar might not be ready yet, wait before retry
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  console.warn(`[Background] Could not send ${logPrefix} message after ${MAX_RETRIES} attempts`);
  return false;
}

/**
 * Send message to sidebar to switch to Manager tab
 * v1.6.1.4 - Extracted to reduce nesting
 * v1.6.2.0 - Enhanced retry logic with multiple attempts
 * v1.6.3.4-v11 - Refactored: Uses generic _sendSidebarMessage
 */
function _sendManagerTabMessage() {
  return _sendSidebarMessage('SWITCH_TO_MANAGER_TAB', 'Manager');
}

/**
 * Send message to sidebar to switch to Settings tab
 * v1.6.3.4 - Added for Alt+Shift+S to always open to Settings tab
 * v1.6.3.4-v11 - Refactored: Uses generic _sendSidebarMessage
 */
function _sendSettingsTabMessage() {
  return _sendSidebarMessage('SWITCH_TO_SETTINGS_TAB', 'Settings');
}

/**
 * Get current primary tab state from sidebar
 * v1.6.3.4 - Added for Ctrl+Alt+Z toggle behavior
 * @returns {Promise<string|null>} 'settings', 'manager', or null if sidebar not responding
 */
async function _getCurrentPrimaryTab() {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_CURRENT_PRIMARY_TAB'
    });
    return response?.primaryTab || null;
  } catch (error) {
    // Sidebar may not be open or not responding
    return null;
  }
}

// ==================== KEYBOARD COMMANDS ====================
// Listen for keyboard commands
// v1.6.0 - PHASE 4.3: Extracted toggle logic to fix max-depth
// v1.6.1.4 - Updated for dual-sidebar implementation
// v1.6.3.5 - FIX Bug #8: Use synchronous handler to preserve user input context
//            browser.sidebarAction.open() requires synchronous call from user input
// v1.6.3.4 - Removed floating panel and duplicate command. Only toggle-quick-tabs-manager remains.
// v1.6.3.4-v2 - Enhanced toggle behavior: Alt+Shift+S opens to Settings, Ctrl+Alt+Z toggles Manager
browser.commands.onCommand.addListener(command => {
  // v1.6.3.4-v2 - toggle-quick-tabs-manager (Ctrl+Alt+Z) toggles Manager tab
  // If sidebar is open and showing Manager, close it; otherwise open to Manager
  if (command === 'toggle-quick-tabs-manager') {
    _handleToggleQuickTabsManager();
  }

  // v1.6.3.4-v2 - _execute_sidebar_action (Alt+Shift+S) always opens to Settings tab
  if (command === '_execute_sidebar_action') {
    _handleOpenToSettingsTab();
  }
});

/**
 * Handle toggle-quick-tabs-manager command (Ctrl+Alt+Z)
 * v1.6.3.4-v2 - Toggle behavior: close if Manager showing, otherwise open to Manager
 * v1.6.3.4-v5 - FIX Bug #1: Use sidebarAction.toggle() to preserve user gesture context
 *            browser.sidebarAction.isOpen() breaks the gesture context when awaited
 */
async function _handleToggleQuickTabsManager() {
  try {
    // v1.6.3.4-v5 - FIX Bug #1: Set storage FIRST (synchronous-ish, non-blocking)
    // This ensures the sidebar knows to show Manager tab when it opens
    browser.storage.local.set({ _requestedPrimaryTab: 'manager' }).catch(err => {
      console.warn('[Sidebar] Failed to set _requestedPrimaryTab:', err);
    });

    // v1.6.3.4-v5 - FIX Bug #1: Use toggle() API if available (Firefox 57+)
    // toggle() properly handles user gesture context
    if (browser.sidebarAction.toggle) {
      await browser.sidebarAction.toggle();
      console.log('[Sidebar] Toggled sidebar via toggle() API');

      // After toggle, try to switch to Manager if sidebar is now open
      // Use setTimeout to let the sidebar initialize
      setTimeout(async () => {
        try {
          await _sendManagerTabMessage();
        } catch (_e) {
          // Sidebar may have closed or not ready - ignore
        }
      }, SIDEBAR_INIT_DELAY_MS);
      return;
    }

    // Fallback for older Firefox without toggle()
    // v1.6.3.4-v5 - FIX Bug #1: Call open() FIRST without any awaits to preserve gesture
    // We can't check isOpen() first because that breaks the gesture context
    console.log('[Sidebar] Using fallback approach (no toggle API)');
    await browser.sidebarAction.open();

    // Wait for sidebar to initialize, then send message
    await new Promise(resolve => setTimeout(resolve, SIDEBAR_INIT_DELAY_MS));
    await _sendManagerTabMessage();
    console.log('[Sidebar] Opened sidebar and switched to Manager tab');
  } catch (err) {
    console.error('[Sidebar] Error handling toggle-quick-tabs-manager:', err);
  }
}

/**
 * Open sidebar and switch to Manager tab
 * v1.6.3.4-v2 - Helper to reduce nesting depth
 * v1.6.3.4-v3 - FIX Bug #3: Use storage to set initial tab before opening sidebar
 *            This ensures the sidebar opens to the correct tab even on first use
 */
async function _openSidebarToManager() {
  // v1.6.3.4-v3 - Set requested tab in storage BEFORE opening sidebar
  // The sidebar will read this on DOMContentLoaded and show the correct tab
  await browser.storage.local.set({ _requestedPrimaryTab: 'manager' });
  console.debug('[Background] Set _requestedPrimaryTab to manager');

  await browser.sidebarAction.open();

  // Wait for sidebar to initialize, then send message as backup
  // The message may still fail on very first open, but storage ensures correct tab
  await new Promise(resolve => setTimeout(resolve, SIDEBAR_INIT_DELAY_MS));
  await _sendManagerTabMessage();
  console.log('[Sidebar] Opened sidebar and switched to Manager tab');
}

/**
 * Toggle Manager when sidebar is already open
 * v1.6.3.4-v2 - Helper to reduce nesting depth
 */
async function _toggleManagerWhenSidebarOpen() {
  const currentTab = await _getCurrentPrimaryTab();

  if (currentTab === 'manager') {
    // Manager is already showing - close the sidebar
    await browser.sidebarAction.close();
    console.log('[Sidebar] Closed sidebar (Manager was showing)');
  } else {
    // Settings or other tab is showing - switch to Manager
    await _sendManagerTabMessage();
    console.log('[Sidebar] Switched to Manager tab');
  }
}

/**
 * Handle _execute_sidebar_action command (Alt+Shift+S)
 * v1.6.3.4-v2 - Always open sidebar to Settings tab
 * v1.6.3.4-v3 - FIX Bug #3: Use storage to set initial tab before opening sidebar
 * v1.6.3.4-v5 - FIX Bug #1: Use sidebarAction.toggle() to preserve user gesture context
 */
async function _handleOpenToSettingsTab() {
  try {
    // v1.6.3.4-v5 - FIX Bug #1: Set storage FIRST (synchronous-ish, non-blocking)
    browser.storage.local.set({ _requestedPrimaryTab: 'settings' }).catch(err => {
      console.warn('[Sidebar] Failed to set _requestedPrimaryTab:', err);
    });

    // v1.6.3.4-v5 - FIX Bug #1: Use toggle() API if available (Firefox 57+)
    if (browser.sidebarAction.toggle) {
      await browser.sidebarAction.toggle();
      console.log('[Sidebar] Toggled sidebar via toggle() API');

      // After toggle, try to switch to Settings if sidebar is now open
      setTimeout(async () => {
        try {
          await _sendSettingsTabMessage();
        } catch (_e) {
          // Sidebar may have closed or not ready - ignore
        }
      }, SIDEBAR_INIT_DELAY_MS);
      return;
    }

    // Fallback: Call open() FIRST without awaits
    console.log('[Sidebar] Using fallback approach (no toggle API)');
    await browser.sidebarAction.open();
    await new Promise(resolve => setTimeout(resolve, SIDEBAR_INIT_DELAY_MS));

    // Switch to Settings tab
    await _sendSettingsTabMessage();
    console.log('[Sidebar] Opened sidebar and switched to Settings tab');
  } catch (err) {
    console.error('[Sidebar] Error handling _execute_sidebar_action:', err);
  }
}
// ==================== END KEYBOARD COMMANDS ====================

// ==================== BROWSER ACTION HANDLER ====================
// Toggle sidebar when toolbar button is clicked (Firefox only)
// Chrome will continue using popup.html since it doesn't support sidebar_action
// v1.6.2.0 - Fixed: Now toggles sidebar open/close instead of only opening
if (typeof browser !== 'undefined' && browser.browserAction && browser.sidebarAction) {
  browser.browserAction.onClicked.addListener(async () => {
    try {
      // Use toggle() API for clean open/close behavior
      if (browser.sidebarAction && browser.sidebarAction.toggle) {
        await browser.sidebarAction.toggle();
        console.log('[Sidebar] Toggled via toolbar button');
      } else if (browser.sidebarAction && browser.sidebarAction.open) {
        // Fallback for older Firefox versions without toggle()
        await browser.sidebarAction.open();
        console.log('[Sidebar] Opened via toolbar button (fallback)');
      }
    } catch (err) {
      console.error('[Sidebar] Error toggling sidebar:', err);
      // If sidebar fails, user can still access settings via options page
    }
  });
  console.log('[Sidebar] Browser action handler registered for Firefox');
} else {
  // Chrome doesn't support sidebarAction, so toolbar button will show popup.html
  console.log('[Sidebar] Browser action uses popup (Chrome compatibility)');
}
// ==================== END BROWSER ACTION HANDLER ====================

// ==================== v1.6.3.8-v12 PORT INFRASTRUCTURE REMOVED ====================
// Port-based messaging has been completely removed and replaced with tabs.sendMessage
// The following are minimal stub implementations for backward compatibility

/**
 * Clean up ports for tab stub - no-op
 * v1.6.3.8-v12 - Port infrastructure removed
 */
function _cleanupPortsForTab(_tabId) {
  // No-op - port infrastructure removed
}

/**
 * Clean up Quick Tab host tracking when a tab unloads
 * v1.6.3.8-v12 - Tab host tracking cleanup
 * @param {number} tabId - Tab ID that is unloading
 */
function _cleanupQuickTabHostTracking(tabId) {
  // Remove all Quick Tab host entries for this tab
  for (const [quickTabId, hostTabId] of quickTabHostTabs.entries()) {
    if (hostTabId === tabId) {
      quickTabHostTabs.delete(quickTabId);
    }
  }
}

/**
 * Notify manager to start watchdog - use runtime.sendMessage
 * v1.6.3.8-v12 - Port infrastructure removed
 */
async function _notifyManagerToStartWatchdog(expectedSaveId, sequenceId) {
  try {
    await browser.runtime.sendMessage({
      type: 'START_STORAGE_WATCHDOG',
      expectedSaveId,
      sequenceId,
      timestamp: Date.now()
    });
  } catch (_err) {
    // Sidebar may not be open - this is expected
  }
}

/**
 * Send state update via runtime.sendMessage
 * v1.6.3.8-v12 - Port infrastructure removed
 */
async function _sendStateUpdateViaPorts(quickTabId, changes, operation, correlationId) {
  try {
    await browser.runtime.sendMessage({
      type: 'STATE_UPDATE',
      quickTabId,
      changes,
      operation,
      correlationId,
      source: 'background',
      timestamp: Date.now()
    });
  } catch (_err) {
    // Sidebar may not be open - this is expected
  }
}

/**
 * Handle legacy action messages
 * v1.6.3.8-v12 - Simplified legacy action handler
 */
function handleLegacyAction(message, _portInfo) {
  if (message.action === 'MANAGER_COMMAND') {
    return handleManagerCommand(message);
  }
  if (message.action === 'QUICK_TAB_STATE_CHANGE') {
    return handleQuickTabStateChange(message, { tab: { id: message.sourceTabId } });
  }
  return Promise.resolve({ success: false, error: 'Unknown legacy action' });
}

/**
 * Broadcast storage write confirmation - no-op (port infrastructure removed)
 * v1.6.3.8-v12 - Port infrastructure removed
 * @private
 */
function _broadcastStorageWriteConfirmation(_state, _saveId) {
  // No-op - port infrastructure removed
  // Sidebar receives updates via storage.onChanged
}

/**
 * Broadcast operation confirmation - no-op (port infrastructure removed)
 * v1.6.3.8-v12 - Port infrastructure removed
 * @private
 */
function _broadcastOperationConfirmation(_options) {
  // No-op - port infrastructure removed
  // Sidebar receives updates via storage.onChanged
}

console.log('[Background] v1.6.3.8-v12 Port infrastructure removed - using tabs.sendMessage');

// ==================== END PORT INFRASTRUCTURE REMOVED ====================

// ==================== v1.6.4.0 COMMAND HANDLERS ====================
// FIX Issue A: Background as sole storage writer
// FIX Issue E: State sync on port reconnection
// FIX Issue F: Storage write verification with retry

/**
 * Maximum retries for storage write verification
 * v1.6.4.0 - FIX Issue F: Storage timing uncertainty
 */
const STORAGE_WRITE_MAX_RETRIES = 3;

/**
 * Initial backoff for storage write retry
 * v1.6.4.0 - FIX Issue F: Exponential backoff
 */
const STORAGE_WRITE_BACKOFF_INITIAL_MS = 100;

/**
 * Handle REQUEST_FULL_STATE_SYNC message
 * v1.6.4.0 - FIX Issue E: State sync on port reconnection
 * @param {Object} message - Sync request message
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} State sync response
 */
async function handleFullStateSyncRequest(message, portInfo) {
  const { currentCacheHash, currentCacheTabCount, timestamp } = message;
  const now = Date.now();
  const latencyMs = now - (timestamp || now);

  console.log('[Background] REQUEST_FULL_STATE_SYNC received:', {
    source: portInfo?.origin,
    clientCacheHash: currentCacheHash,
    clientCacheTabCount: currentCacheTabCount,
    latencyMs
  });

  // Check initialization
  const guard = checkInitializationGuard('handleFullStateSyncRequest');
  if (!guard.initialized) {
    const initialized = await waitForInitialization(2000);
    if (!initialized) {
      return {
        success: false,
        error: 'Background not initialized',
        retryable: true
      };
    }
  }

  const serverHash = computeStateHash({ tabs: globalQuickTabState.tabs });
  const serverTabCount = globalQuickTabState.tabs?.length ?? 0;

  console.log('[Background] STATE_SYNC_RESPONSE:', {
    serverTabCount,
    serverHash,
    clientCacheHash: currentCacheHash,
    clientCacheTabCount: currentCacheTabCount,
    diverged: serverHash !== currentCacheHash
  });

  return {
    success: true,
    type: 'FULL_STATE_SYNC',
    state: {
      tabs: globalQuickTabState.tabs,
      lastUpdate: globalQuickTabState.lastUpdate,
      saveId: globalQuickTabState.saveId
    },
    serverHash,
    serverTabCount,
    timestamp: now
  };
}

/**
 * Check if a tab is minimized
 * v1.6.4.14 - FIX Complexity: Extracted predicate
 * @private
 */
function _isTabMinimized(tab) {
  return tab.minimized === true || tab.visibility?.minimized === true;
}

/**
 * Process closed tab cleanup after deletion
 * v1.6.4.14 - FIX Complexity: Extracted to reduce handleCloseMinimizedTabsCommand cc
 * @private
 */
function _processClosedTabCleanup(closedIds, saveId) {
  for (const id of closedIds) {
    quickTabHostTabs.delete(id);
    _broadcastOperationConfirmation({
      operationType: 'DELETE_CONFIRMED',
      quickTabId: id,
      changes: { deleted: true },
      saveId,
      correlationId: null
    });
    _sendStateUpdateViaPorts(id, { deleted: true }, 'close-minimized', null);
  }
}

/**
 * Handle CLOSE_MINIMIZED_TABS command
 * v1.6.4.0 - FIX Issue A: Background as sole storage writer
 * v1.6.4.14 - FIX Complexity: Extracted helpers (cc=9 → cc=5)
 * @returns {Promise<Object>} Command result
 */
async function handleCloseMinimizedTabsCommand() {
  console.log('[Background] Handling CLOSE_MINIMIZED_TABS command');

  // Check initialization
  const guard = checkInitializationGuard('handleCloseMinimizedTabsCommand');
  if (!guard.initialized) {
    const initialized = await waitForInitialization(2000);
    if (!initialized) {
      return guard.errorResponse;
    }
  }

  // Find minimized tabs
  const minimizedTabs = globalQuickTabState.tabs.filter(_isTabMinimized);

  if (minimizedTabs.length === 0) {
    console.log('[Background] No minimized tabs to close');
    return { success: true, closedCount: 0, closedIds: [] };
  }

  const closedIds = minimizedTabs.map(tab => tab.id);
  console.log('[Background] Closing minimized tabs:', { count: closedIds.length, ids: closedIds });

  // Broadcast close messages to content scripts first
  await _broadcastCloseManyToAllTabs(closedIds);

  // Remove minimized tabs from state
  globalQuickTabState.tabs = globalQuickTabState.tabs.filter(tab => !_isTabMinimized(tab));
  globalQuickTabState.lastUpdate = Date.now();

  // Write to storage with verification (FIX Issue F)
  const writeResult = await writeStateWithVerificationAndRetry('close-minimized');

  // v1.6.4.14 - Combined cleanup + broadcast + state updates
  _processClosedTabCleanup(closedIds, writeResult.saveId);

  console.log('[Background] CLOSE_MINIMIZED_TABS complete:', {
    closedCount: closedIds.length,
    closedIds,
    writeVerified: writeResult.verified
  });

  return {
    success: true,
    closedCount: closedIds.length,
    closedIds,
    verified: writeResult.verified
  };
}

/**
 * Broadcast close messages for multiple Quick Tabs to all content scripts
 * v1.6.4.0 - FIX Issue A: Helper for CLOSE_MINIMIZED_TABS
 * @private
 * @param {Array<string>} quickTabIds - Quick Tab IDs to close
 */
async function _broadcastCloseManyToAllTabs(quickTabIds) {
  try {
    const tabs = await browser.tabs.query({});
    await _sendCloseMessagesToAllTabs(tabs, quickTabIds);
  } catch (err) {
    console.error('[Background] Error broadcasting close messages:', err.message);
  }
}

/**
 * Send close messages to all browser tabs for given Quick Tab IDs
 * v1.6.4.0 - FIX Issue A: Extracted to reduce nesting depth
 * @private
 * @param {Array} tabs - Browser tabs
 * @param {Array<string>} quickTabIds - Quick Tab IDs to close
 */
async function _sendCloseMessagesToAllTabs(tabs, quickTabIds) {
  for (const quickTabId of quickTabIds) {
    _sendCloseMessageToTabs(tabs, quickTabId);
  }
}

/**
 * Send close message to all browser tabs for a single Quick Tab
 * v1.6.4.0 - FIX Issue A: Extracted to reduce nesting depth
 * @private
 * @param {Array} tabs - Browser tabs
 * @param {string} quickTabId - Quick Tab ID to close
 */
function _sendCloseMessageToTabs(tabs, quickTabId) {
  for (const tab of tabs) {
    browser.tabs
      .sendMessage(tab.id, {
        action: 'CLOSE_QUICK_TAB',
        quickTabId,
        source: 'background-command'
      })
      .catch(() => {
        // Content script may not be loaded
      });
  }
}

/**
 * Write state to storage with verification and exponential backoff retry
 * v1.6.4.0 - FIX Issue F: Storage timing uncertainty
 * v1.6.4.9 - Issue #8: Enhanced logging with attempt numbers and success signals
 * v1.6.4.13 - Issue #5: Added [STORAGE] prefix for consistent logging
 * @param {string} operation - Operation name for logging
 * @returns {Promise<Object>} Write result with verification status
 */
async function writeStateWithVerificationAndRetry(operation) {
  const saveId = `bg-${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const tabCount = globalQuickTabState.tabs?.length ?? 0;
  const stateHash = computeStateHash({ tabs: globalQuickTabState.tabs, saveId });

  // v1.6.4.13 - Issue #5: Log storage write start with [STORAGE] prefix
  _logStorageWriteStarted(saveId, operation, tabCount, stateHash);

  // v1.6.4.9 - Issue #8: Log initial write attempt
  console.log('[Background] STORAGE_WRITE_ATTEMPT:', {
    saveId,
    operation,
    attempt: `1/${STORAGE_WRITE_MAX_RETRIES}`,
    tabCount
  });

  const result = await _executeStorageWriteLoop(operation, saveId, tabCount, stateHash);

  // Log final result
  _logStorageWriteFinalResult({ result, saveId, operation, tabCount, stateHash });

  return result;
}

/**
 * Log storage write start event
 * v1.6.4.13 - Issue #5: Extracted to reduce complexity
 * @private
 */
function _logStorageWriteStarted(saveId, operation, tabCount, stateHash) {
  if (DEBUG_MESSAGING) {
    console.log('[Background] [STORAGE] WRITE_STARTED:', {
      saveId,
      operation,
      tabCount,
      stateHash,
      timestamp: Date.now()
    });
  }
}

/**
 * Execute the storage write retry loop
 * v1.6.4.13 - Issue #5: Extracted to reduce complexity
 * @private
 */
async function _executeStorageWriteLoop(operation, saveId, tabCount, stateHash) {
  let backoffMs = STORAGE_WRITE_BACKOFF_INITIAL_MS;

  for (let attempt = 1; attempt <= STORAGE_WRITE_MAX_RETRIES; attempt++) {
    const result = await _attemptStorageWriteWithVerification(
      operation,
      saveId,
      attempt,
      backoffMs
    );

    if (result.success && result.verified) {
      _logStorageWriteSuccess({ saveId, operation, tabCount, stateHash, attemptNumber: attempt });
      return result;
    }

    if (result.needsRetry && attempt < STORAGE_WRITE_MAX_RETRIES) {
      _logStorageWriteRetry(saveId, operation, attempt, backoffMs);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      backoffMs *= 2; // Exponential backoff
    }
  }

  return { success: false, saveId, verified: false, attempts: STORAGE_WRITE_MAX_RETRIES };
}

/**
 * Log storage write success event
 * v1.6.4.13 - Issue #5: Extracted to reduce complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 */
function _logStorageWriteSuccess({ saveId, operation, tabCount, stateHash, attemptNumber }) {
  console.log('[Background] STORAGE_WRITE_SUCCESS:', {
    saveId,
    operation,
    attemptNumber,
    totalAttempts: STORAGE_WRITE_MAX_RETRIES,
    tabCount
  });

  if (DEBUG_MESSAGING) {
    console.log('[Background] [STORAGE] WRITE_SUCCESS:', {
      saveId,
      operation,
      tabCount,
      stateHash,
      attemptNumber,
      timestamp: Date.now()
    });
  }
}

/**
 * Log storage write retry event
 * v1.6.4.13 - Issue #5: Extracted to reduce complexity
 * @private
 */
function _logStorageWriteRetry(saveId, operation, attempt, backoffMs) {
  console.log('[Background] STORAGE_WRITE_RETRY:', {
    saveId,
    operation,
    attempt: `${attempt + 1}/${STORAGE_WRITE_MAX_RETRIES}`,
    backoffMs,
    reason: 'verification pending'
  });
}

/**
 * Log final storage write result
 * v1.6.4.13 - Issue #5: Extracted to reduce complexity
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 */
function _logStorageWriteFinalResult({ result, saveId, operation, tabCount, stateHash }) {
  if (result.success) return;

  console.error('[Background] STORAGE_WRITE_FINAL_FAILURE:', {
    operation,
    saveId,
    totalAttempts: STORAGE_WRITE_MAX_RETRIES,
    tabCount
  });

  if (DEBUG_MESSAGING) {
    console.error('[Background] [STORAGE] WRITE_FAILED:', {
      saveId,
      operation,
      tabCount,
      stateHash,
      totalAttempts: STORAGE_WRITE_MAX_RETRIES,
      timestamp: Date.now()
    });
  }
}

/**
 * Attempt a single storage write with verification
 * v1.6.4.0 - FIX Issue F: Extracted to reduce nesting depth
 * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
 * v1.6.3.8-v5 - FIX Issue #1: Add revision for monotonic versioning
 * @private
 * @param {string} operation - Operation name
 * @param {string} saveId - Save ID
 * @param {number} attempt - Current attempt number
 * @param {number} backoffMs - Current backoff time
 * @returns {Promise<{ success: boolean, verified: boolean, needsRetry: boolean, attempts?: number, saveId?: string }>}
 */
async function _attemptStorageWriteWithVerification(operation, saveId, attempt, backoffMs) {
  const sequenceId = _getNextStorageSequenceId();
  const revision = _getNextRevision();
  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    saveId,
    sequenceId,
    revision,
    timestamp: Date.now()
  };

  try {
    await browser.storage.local.set({ quick_tabs_state_v2: stateToWrite });
    return await _verifyStorageWrite({
      operation,
      saveId,
      sequenceId,
      revision,
      tabCount: stateToWrite.tabs.length,
      attempt
    });
  } catch (err) {
    console.error(`[Background] Storage write error (attempt ${attempt}):`, err.message);
    return { success: false, verified: false, needsRetry: true };
  }
}

/**
 * Verify storage write by reading back the data
 * v1.6.4.0 - FIX Issue F: Extracted to reduce nesting depth
 * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId parameter
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 * @param {string} options.operation - Operation name for logging
 * @param {string} options.saveId - Save ID to verify
 * @param {number} options.sequenceId - Sequence ID for tracking
 * @param {number} options.tabCount - Tab count for logging
 * @param {number} options.attempt - Current attempt number
 */
async function _verifyStorageWrite({ operation, saveId, sequenceId, tabCount, attempt }) {
  const result = await browser.storage.local.get('quick_tabs_state_v2');
  const readBack = result?.quick_tabs_state_v2;
  const verified = readBack?.saveId === saveId;

  if (verified) {
    console.log(`[Background] Write confirmed: saveId matches (attempt ${attempt})`, {
      operation,
      saveId,
      sequenceId,
      tabCount
    });

    // v1.6.3.8-v8 - Issue #13: Broadcast via port-based notification (BC removed)
    _broadcastStorageWriteConfirmation(readBack, saveId);

    return {
      success: true,
      saveId,
      sequenceId,
      verified: true,
      attempts: attempt,
      needsRetry: false
    };
  }

  console.warn(
    `[Background] Write pending: retrying (attempt ${attempt}/${STORAGE_WRITE_MAX_RETRIES})`,
    {
      operation,
      expectedSaveId: saveId,
      actualSaveId: readBack?.saveId
    }
  );

  return { success: false, verified: false, needsRetry: true };
}

// ==================== END v1.6.4.0 COMMAND HANDLERS ====================

/**
 * Broadcast message to all tabs via tabs.sendMessage
 * v1.6.3.8-v12 - Port infrastructure removed, replaced with tabs.sendMessage
 * @param {Object} message - Message to broadcast
 * @param {number|null} excludeTabId - Tab ID to exclude from broadcast (optional)
 */
/**
 * Send message to a single tab
 * v1.6.3.8-v12 - Extracted helper to reduce nesting depth
 * @private
 */
async function _sendMessageToTab(tabId, message) {
  try {
    await browser.tabs.sendMessage(tabId, message);
    return { success: true };
  } catch (_err) {
    // Content script may not be loaded - this is expected for system pages
    return { success: false };
  }
}

/**
 * Process broadcast results and return counts
 * v1.6.3.8-v12 - Extracted helper to reduce nesting depth
 * @private
 */
function _countBroadcastResults(results) {
  return results.reduce(
    (acc, result) => {
      if (result.success) {
        acc.sentCount++;
      } else {
        acc.errorCount++;
      }
      return acc;
    },
    { sentCount: 0, errorCount: 0 }
  );
}

async function broadcastToAllTabs(message, excludeTabId = null) {
  // v1.6.3.8-v12 - Port infrastructure removed, use tabs.sendMessage
  try {
    const tabs = await browser.tabs.query({});
    const targetTabs = excludeTabId ? tabs.filter(tab => tab.id !== excludeTabId) : tabs;
    const results = await Promise.all(targetTabs.map(tab => _sendMessageToTab(tab.id, message)));
    const { sentCount, errorCount } = _countBroadcastResults(results);

    console.log('[Background] Broadcast complete (tabs.sendMessage):', {
      action: message.action || message.type,
      sentCount,
      errorCount,
      excludeTabId
    });
  } catch (err) {
    console.error('[Background] Broadcast failed:', err.message);
  }
}

// Alias for backward compatibility (kept for any external references)
const broadcastToAllPorts = broadcastToAllTabs;
// Mark as exported for potential external use
void broadcastToAllPorts;

// v1.6.3.8-v12 - Port infrastructure removed
// Port-based messaging replaced with tabs.sendMessage + storage.onChanged
console.log('[Background] v1.6.3.8-v12 Port infrastructure removed - using tabs.sendMessage');

// ==================== END PORT LIFECYCLE MANAGEMENT (REMOVED v1.6.3.8-v12) ====================

// ==================== v1.6.3.6-v11 TAB LIFECYCLE EVENTS ====================
// FIX Issue #16: Track browser tab lifecycle for orphan detection

/**
 * Handle browser tab removal
 * v1.6.3.6-v11 - FIX Issue #16: Mark Quick Tabs as orphaned when their browser tab closes
 * v1.6.3.8-v12 - Uses broadcastToAllTabs for consistency
 * @param {number} tabId - ID of the removed tab
 * @param {Object} removeInfo - Removal info
 */
async function handleTabRemoved(tabId, removeInfo) {
  console.log('[Background] TAB_REMOVED:', { tabId, removeInfo });

  // Find Quick Tabs that belonged to this tab
  const orphanedQuickTabs = globalQuickTabState.tabs.filter(t => t.originTabId === tabId);

  if (orphanedQuickTabs.length === 0) {
    console.log('[Background] No Quick Tabs affected by tab closure:', tabId);
    return;
  }

  console.log('[Background] Quick Tabs orphaned by tab closure:', {
    tabId,
    count: orphanedQuickTabs.length,
    quickTabIds: orphanedQuickTabs.map(t => t.id)
  });

  // Remove from host tracking
  for (const qt of orphanedQuickTabs) {
    quickTabHostTabs.delete(qt.id);
  }

  // v1.6.3.8-v12 - Broadcast tab lifecycle change via broadcastToAllTabs for consistency
  try {
    const message = {
      type: 'BROADCAST',
      action: 'TAB_LIFECYCLE_CHANGE',
      event: 'tab-removed',
      tabId,
      affectedQuickTabs: orphanedQuickTabs.map(t => t.id),
      timestamp: Date.now()
    };
    await broadcastToAllTabs(message, tabId);
  } catch (err) {
    console.error('[Background] Error broadcasting tab removal:', err.message);
  }
}

// Register tab removal listener
browser.tabs.onRemoved.addListener(handleTabRemoved);

console.log('[Background] v1.6.3.6-v11 Tab lifecycle events initialized');

// ==================== END TAB LIFECYCLE EVENTS ====================

// ==================== v1.6.3.5-v3 MESSAGE INFRASTRUCTURE ====================
// Background-as-Coordinator architecture for Quick Tab state synchronization
// Phase 1: Message handlers (non-breaking, parallel with storage events)
// Phase 2-3: Content script state changes via messages + Manager remote control

// ==================== v1.6.3.6-v5 MESSAGE LOGGING INFRASTRUCTURE ====================
// FIX Issue #4c: Cross-tab message broadcast logging
// Provides visibility into message dispatch and receipt

/**
 * Unique message ID counter for tracing message flow
 * v1.6.3.6-v5 - FIX Issue #4c: Track message flow across tabs
 */
let messageIdCounter = 0;

/**
 * Generate unique message ID for correlation
 * v1.6.3.6-v5 - FIX Issue #4c: Correlation IDs for message tracing
 * @returns {string} Unique message ID
 */
function generateMessageId() {
  messageIdCounter++;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

/**
 * Correlation ID counter for state change operations
 * v1.6.3.8-v7 - Issue #9: Unique correlation IDs for full state change tracing
 */
let _correlationIdCounter = 0;

/**
 * Generate unique correlation ID for state change tracing
 * v1.6.3.8-v7 - Issue #9: Format: op-{timestamp}-{id_short}-{random}
 * Used to trace state changes from origin through background to all contexts
 * @param {string} [quickTabId=''] - Optional Quick Tab ID to include in correlation ID
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId(quickTabId = '') {
  _correlationIdCounter++;
  const timestamp = Date.now();
  const idShort = quickTabId ? quickTabId.substring(0, 8) : 'gen';
  const random = Math.random().toString(36).substring(2, 6);
  return `op-${timestamp}-${idShort}-${random}`;
}

/**
 * Log message dispatch (outgoing)
 * v1.6.3.6-v5 - FIX Issue #4c: Cross-tab message broadcast logging
 * Logs sender tab ID, message type, timestamp (no payloads)
 * @param {string} messageId - Unique message ID for correlation
 * @param {string} messageType - Type of message being sent
 * @param {number} senderTabId - Sender tab ID
 * @param {string} target - Target description ('broadcast', 'sidebar', or specific tab ID)
 */
function logMessageDispatch(messageId, messageType, senderTabId, target) {
  console.log('[Background] 📤 MESSAGE DISPATCH:', {
    messageId,
    messageType,
    senderTabId,
    target,
    timestamp: Date.now()
  });
}

/**
 * Log message receipt (incoming)
 * v1.6.3.6-v5 - FIX Issue #4c: Cross-tab message logging
 * Logs receiver context, message type, timestamp
 * @param {string} messageId - Unique message ID for correlation (if available)
 * @param {string} messageType - Type of message received
 * @param {number} senderTabId - Sender tab ID
 */
function logMessageReceipt(messageId, messageType, senderTabId) {
  console.log('[Background] 📥 MESSAGE RECEIPT:', {
    messageId: messageId || 'N/A',
    messageType,
    senderTabId,
    timestamp: Date.now()
  });
}

/**
 * Log deletion event propagation
 * v1.6.3.6-v5 - FIX Issue #4e: State deletion propagation logging
 * Logs when deletion event is submitted and received
 * @param {string} correlationId - Unique ID for end-to-end tracing
 * @param {string} phase - 'submit' or 'received'
 * @param {string} quickTabId - Quick Tab ID being deleted
 * @param {Object} details - Additional context (source, target tabs, etc.)
 */
function logDeletionPropagation(correlationId, phase, quickTabId, details = {}) {
  if (phase === 'submit') {
    console.log('[Background] 🗑️ DELETION SUBMIT:', {
      correlationId,
      quickTabId,
      source: details.source,
      excludeTabId: details.excludeTabId,
      timestamp: Date.now()
    });
  } else if (phase === 'received') {
    console.log('[Background] 🗑️ DELETION RECEIVED:', {
      correlationId,
      quickTabId,
      receiverTabId: details.receiverTabId,
      stateApplied: details.stateApplied,
      timestamp: Date.now()
    });
  } else if (phase === 'broadcast-complete') {
    console.log('[Background] 🗑️ DELETION BROADCAST COMPLETE:', {
      correlationId,
      quickTabId,
      totalTabs: details.totalTabs,
      successCount: details.successCount,
      timestamp: Date.now()
    });
  }
}

// ==================== END MESSAGE LOGGING INFRASTRUCTURE ====================

/**
 * Track which tab hosts each Quick Tab
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Enable Manager remote control
 * Key: quickTabId, Value: browser tab ID
 */
const quickTabHostTabs = new Map();

/**
 * Validate and log Quick Tab state change message
 * v1.6.4.14 - FIX Complexity: Extracted to reduce handleQuickTabStateChange cc
 * v1.6.3.8-v7 - Issue #9: Include correlationId for full state change tracing
 * v1.6.3.8-v7 - Issue #12: Include clientTimestamp for rapid operation ordering
 * @private
 * @returns {{ messageId: string, quickTabId: string, changes: Object, source: string, sourceTabId: number, correlationId: string, clientTimestamp: number|null }}
 */
function _prepareStateChangeContext(message, sender) {
  const { quickTabId, changes, source, clientTimestamp } = message;
  const sourceTabId = sender?.tab?.id ?? message.sourceTabId;
  const messageId = message.messageId || generateMessageId();
  // v1.6.3.8-v7 - Issue #9: Generate correlationId if not provided
  const correlationId = message.correlationId || generateCorrelationId(quickTabId);

  logMessageReceipt(messageId, 'QUICK_TAB_STATE_CHANGE', sourceTabId);
  console.log('[Background] QUICK_TAB_STATE_CHANGE received:', {
    quickTabId,
    changes,
    source,
    sourceTabId,
    // v1.6.3.8-v7 - Issue #9: Log correlationId for tracing
    correlationId,
    // v1.6.3.8-v7 - Issue #12: Log clientTimestamp for ordering validation
    clientTimestamp: clientTimestamp || null
  });

  return {
    messageId,
    quickTabId,
    changes,
    source,
    sourceTabId,
    correlationId,
    clientTimestamp: clientTimestamp || null
  };
}

/**
 * Check if this is a deletion change
 * v1.6.4.14 - FIX Complexity: Extracted predicate
 * @private
 */
function _isDeletionChange(changes, source) {
  return changes?.deleted === true || source === 'destroy';
}

/**
 * Handle QUICK_TAB_STATE_CHANGE message from content scripts
 * v1.6.3.5-v3 - FIX Architecture Phase 1-2: Content scripts report state changes to background
 * v1.6.3.5-v11 - FIX Issue #6: Handle deletion changes (deleted: true) by removing from cache
 * v1.6.3.6-v5 - FIX Issue #4c: Added message receipt logging
 * v1.6.3.6-v12 - FIX Issue #1: Added initialization guard
 * v1.6.4.14 - FIX Complexity: Extracted helpers (cc=9 → cc=5)
 * Background becomes the coordinator, updating cache and broadcasting to other contexts
 * @param {Object} message - Message containing state change
 * @param {Object} sender - Sender info (includes tab.id)
 */
async function handleQuickTabStateChange(message, sender) {
  // v1.6.3.6-v12 - FIX Issue #1: Check initialization before processing
  const guard = checkInitializationGuard('handleQuickTabStateChange');
  if (!guard.initialized) {
    const initialized = await waitForInitialization(2000);
    if (!initialized) {
      console.warn('[Background] v1.6.3.6-v12 State change rejected - not initialized');
      return guard.errorResponse;
    }
  }

  // v1.6.3.8-v7 - Issue #9, #12: Include correlationId and clientTimestamp
  const { quickTabId, changes, source, sourceTabId, correlationId, clientTimestamp } =
    _prepareStateChangeContext(message, sender);

  // Track which tab hosts this Quick Tab
  _updateQuickTabHostTracking(quickTabId, sourceTabId);

  // v1.6.3.5-v11 - FIX Issue #6: Handle deletion changes
  if (_isDeletionChange(changes, source)) {
    // v1.6.3.8-v7 - Issue #9: Pass correlationId for deletion tracing
    await _handleQuickTabDeletion(quickTabId, source, sourceTabId, correlationId);
    return { success: true, correlationId };
  }

  // Update globalQuickTabState cache
  // v1.6.3.8-v7 - Issue #12: Pass clientTimestamp for rapid operation ordering
  _updateGlobalQuickTabCache(quickTabId, changes, sourceTabId, clientTimestamp);

  // Broadcast to all interested parties
  // v1.6.3.8-v7 - Issue #9: Pass correlationId for tracing
  await broadcastQuickTabStateUpdate(quickTabId, changes, source, sourceTabId, correlationId);

  return { success: true, correlationId };
}

/**
 * Update Quick Tab host tracking
 * v1.6.3.5-v11 - Extracted from handleQuickTabStateChange to reduce complexity
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} sourceTabId - Source browser tab ID
 */
function _updateQuickTabHostTracking(quickTabId, sourceTabId) {
  if (quickTabId && sourceTabId) {
    quickTabHostTabs.set(quickTabId, sourceTabId);
    console.log('[Background] Updated quickTabHostTabs:', {
      quickTabId,
      hostTabId: sourceTabId,
      totalTracked: quickTabHostTabs.size
    });
  }
}

/**
 * Handle Quick Tab deletion
 * v1.6.3.5-v11 - Extracted from handleQuickTabStateChange to reduce complexity
 * v1.6.3.6-v5 - FIX Issue #4e: Added deletion propagation logging
 * v1.6.3.8-v7 - Issue #9: Accept correlationId parameter for tracing
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} source - Source of deletion
 * @param {number} sourceTabId - Source browser tab ID
 * @param {string} [providedCorrelationId] - Optional correlation ID from caller
 */
async function _handleQuickTabDeletion(
  quickTabId,
  source,
  sourceTabId,
  providedCorrelationId = null
) {
  // v1.6.3.8-v7 - Issue #9: Use provided correlationId or generate one
  const correlationId = providedCorrelationId || generateCorrelationId(quickTabId);

  // v1.6.3.6-v5 - Log deletion submission
  logDeletionPropagation(correlationId, 'submit', quickTabId, {
    source,
    excludeTabId: sourceTabId
  });

  console.log('[Background] Processing deletion for:', quickTabId, {
    correlationId,
    source
  });
  const beforeCount = globalQuickTabState.tabs.length;
  globalQuickTabState.tabs = globalQuickTabState.tabs.filter(t => t.id !== quickTabId);
  globalQuickTabState.lastUpdate = Date.now();

  // Remove from host tracking
  quickTabHostTabs.delete(quickTabId);

  console.log('[Background] Removed tab from cache:', {
    quickTabId,
    beforeCount,
    afterCount: globalQuickTabState.tabs.length,
    correlationId
  });

  // Broadcast deletion to Manager (with correlation ID for tracing)
  await broadcastQuickTabStateUpdate(
    quickTabId,
    { deleted: true, correlationId },
    source,
    sourceTabId,
    correlationId
  );
}

/**
 * Check if client timestamp should skip this update (stale operation)
 * v1.6.3.8-v7 - Issue #12: Extracted to reduce max-depth
 * @private
 * @param {Object} existingTab - Existing tab in cache
 * @param {number|null} clientTimestamp - Client-side timestamp
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Changes being applied
 * @returns {boolean} True if should skip this update
 */
function _shouldSkipStaleUpdate(existingTab, clientTimestamp, quickTabId, changes) {
  if (!clientTimestamp || !existingTab._lastClientTimestamp) return false;
  if (clientTimestamp >= existingTab._lastClientTimestamp) return false;

  console.warn('[Background] RAPID_OPERATION_ORDERING_SKIP:', {
    quickTabId,
    reason: 'clientTimestamp is older than last applied operation',
    incomingTimestamp: clientTimestamp,
    lastAppliedTimestamp: existingTab._lastClientTimestamp,
    changes
  });
  return true;
}

/**
 * Update global Quick Tab state cache
 * v1.6.3.5-v11 - Extracted from handleQuickTabStateChange to reduce complexity
 * v1.6.3.8-v7 - Issue #12: Add clientTimestamp validation for rapid operation ordering
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @param {number} sourceTabId - Source browser tab ID
 * @param {number|null} clientTimestamp - Client-side timestamp for ordering validation
 */
function _updateGlobalQuickTabCache(quickTabId, changes, sourceTabId, clientTimestamp = null) {
  if (!changes || !quickTabId) return;

  const existingTab = globalQuickTabState.tabs.find(t => t.id === quickTabId);
  if (existingTab) {
    // v1.6.3.8-v7 - Issue #12: Validate timestamp ordering for rapid operations
    if (_shouldSkipStaleUpdate(existingTab, clientTimestamp, quickTabId, changes)) {
      return; // Skip stale operation
    }

    Object.assign(existingTab, changes);
    // v1.6.3.8-v7 - Issue #12: Track last applied client timestamp
    if (clientTimestamp) {
      existingTab._lastClientTimestamp = clientTimestamp;
    }
    globalQuickTabState.lastUpdate = Date.now();
    console.log('[Background] Updated cache for:', quickTabId, changes);
    return;
  }

  // New Quick Tab (only create if has url)
  if (!changes.url) return;

  globalQuickTabState.tabs.push({
    id: quickTabId,
    ...changes,
    originTabId: sourceTabId,
    // v1.6.3.8-v7 - Issue #12: Initialize client timestamp tracking
    _lastClientTimestamp: clientTimestamp || Date.now()
  });
  globalQuickTabState.lastUpdate = Date.now();
  console.log('[Background] Added new tab to cache:', quickTabId);
}

// v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #4: Broadcast deduplication and circuit breaker
// Track recent broadcasts to prevent storms
const _broadcastHistory = [];
// 100ms window chosen based on typical user interaction timing - broadcasts within this window
// are likely duplicates from the same user action (e.g., drag event fires multiple times)
const BROADCAST_HISTORY_WINDOW_MS = 100;
// Limit of 10 broadcasts per window based on empirical observation that legitimate operations
// rarely generate more than 2-3 broadcasts per 100ms. 10 provides safety margin while catching loops.
const BROADCAST_CIRCUIT_BREAKER_LIMIT = 10;
let _circuitBreakerTripped = false;
let _lastCircuitBreakerReset = 0;

/**
 * Try to reset circuit breaker if cooldown elapsed
 * @private
 * @param {number} now - Current timestamp
 */
function _tryResetCircuitBreaker(now) {
  if (_circuitBreakerTripped && now - _lastCircuitBreakerReset > 1000) {
    _circuitBreakerTripped = false;
    console.log('[Background] Broadcast circuit breaker RESET');
  }
}

/**
 * Clean up expired entries from broadcast history
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupBroadcastHistory(now) {
  while (
    _broadcastHistory.length > 0 &&
    now - _broadcastHistory[0].time > BROADCAST_HISTORY_WINDOW_MS
  ) {
    _broadcastHistory.shift();
  }
}

/**
 * Check if broadcast is a duplicate within the dedup window
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} changesHash - Hash of changes object
 * @returns {boolean} True if duplicate
 */
function _isDuplicateBroadcast(quickTabId, changesHash) {
  return _broadcastHistory.some(
    entry => entry.quickTabId === quickTabId && entry.changesHash === changesHash
  );
}

/**
 * Trip the circuit breaker and return blocked response
 * @private
 * @param {number} now - Current timestamp
 * @returns {{ allowed: boolean, reason: string }}
 */
function _tripCircuitBreaker(now) {
  _circuitBreakerTripped = true;
  _lastCircuitBreakerReset = now;
  console.error(
    '[Background] ⚠️ BROADCAST CIRCUIT BREAKER TRIPPED - too many broadcasts within',
    BROADCAST_HISTORY_WINDOW_MS,
    'ms'
  );
  console.error('[Background] Broadcasts in window:', _broadcastHistory.length);
  return { allowed: false, reason: 'circuit breaker limit exceeded' };
}

/**
 * Check if broadcast should be allowed (circuit breaker + deduplication)
 * v1.6.3.6-v4 - FIX Issue #4: Prevent broadcast storms
 * v1.6.4.8 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @returns {{ allowed: boolean, reason: string }}
 */
function _shouldAllowBroadcast(quickTabId, changes) {
  const now = Date.now();

  _tryResetCircuitBreaker(now);
  if (_circuitBreakerTripped) {
    return { allowed: false, reason: 'circuit breaker tripped' };
  }

  _cleanupBroadcastHistory(now);

  const changesHash = JSON.stringify(changes);
  if (_isDuplicateBroadcast(quickTabId, changesHash)) {
    return { allowed: false, reason: 'duplicate broadcast within window' };
  }

  if (_broadcastHistory.length >= BROADCAST_CIRCUIT_BREAKER_LIMIT) {
    return _tripCircuitBreaker(now);
  }

  _broadcastHistory.push({ time: now, quickTabId, changesHash });
  return { allowed: true, reason: 'ok' };
}

/**
 * Broadcast QUICK_TAB_STATE_UPDATED to Manager and other tabs
 * v1.6.3.5-v3 - FIX Architecture Phase 1: Background broadcasts state changes
 * v1.6.3.6-v4 - FIX Issue #4: Added broadcast deduplication and circuit breaker
 * v1.6.3.6-v5 - FIX Issue #4c: Added message dispatch logging
 * v1.6.3.7 - FIX Issue #3: Broadcast deletions to ALL tabs for unified deletion behavior
 * v1.6.3.7-v4 - FIX Issue #3: Route state updates through PORT when available (primary)
 *              then fall back to runtime.sendMessage (secondary)
 * v1.6.3.8-v7 - Issue #9: Include correlationId in broadcast messages for tracing
 * v1.6.3.8-v8 - Issue #13: BC removed, port-based messaging is now PRIMARY
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @param {string} source - Source of change
 * @param {number} excludeTabId - Tab to exclude from broadcast (the source tab)
 * @param {string} [correlationId] - Optional correlation ID for tracing
 */
async function broadcastQuickTabStateUpdate(
  quickTabId,
  changes,
  source,
  excludeTabId,
  correlationId = null
) {
  // v1.6.3.6-v4 - FIX Issue #4: Check broadcast limits
  const broadcastCheck = _shouldAllowBroadcast(quickTabId, changes);
  if (!broadcastCheck.allowed) {
    console.log('[Background] Broadcast BLOCKED:', {
      quickTabId,
      reason: broadcastCheck.reason,
      source,
      correlationId
    });
    return;
  }

  // v1.6.3.6-v5 - FIX Issue #4c: Generate message ID for correlation
  const messageId = generateMessageId();
  // v1.6.3.8-v7 - Issue #9: Generate correlationId if not provided
  const effectiveCorrelationId = correlationId || generateCorrelationId(quickTabId);

  const message = {
    type: 'QUICK_TAB_STATE_UPDATED',
    messageId, // v1.6.3.6-v5: Include message ID for tracing
    // v1.6.3.8-v7 - Issue #9: Include correlationId for full tracing
    correlationId: effectiveCorrelationId,
    quickTabId,
    changes,
    source: 'background',
    originalSource: source,
    timestamp: Date.now()
  };

  // v1.6.3.6-v5 - FIX Issue #4c: Log message dispatch to sidebar
  logMessageDispatch(messageId, 'QUICK_TAB_STATE_UPDATED', excludeTabId, 'sidebar');

  // v1.6.3.6-v4 - FIX Issue #4: Log trigger source before broadcast
  console.log('[Background] Broadcasting QUICK_TAB_STATE_UPDATED:', {
    quickTabId,
    changes,
    source,
    excludeTabId,
    triggerSource: source,
    // v1.6.3.8-v7 - Issue #9: Log correlationId for tracing
    correlationId: effectiveCorrelationId
  });

  // v1.6.3.8-v6 - BC REMOVED: Skip BC broadcast, port-based messaging is primary
  // _broadcastViaBroadcastChannel removed - just log for debugging

  // v1.6.3.7-v4 - FIX Issue #3: Tier 2 (now PRIMARY) - Route state updates through PORT
  // Port-based messaging is more reliable than runtime.sendMessage for sidebar
  let sentViaPort = false;
  const sidebarPortsSent = _broadcastToSidebarPorts(message);
  if (sidebarPortsSent > 0) {
    sentViaPort = true;
    console.log('[Background] [PORT] STATE_UPDATE sent to', sidebarPortsSent, 'sidebar(s):', {
      messageId,
      quickTabId,
      correlationId: effectiveCorrelationId
    });
  }

  // v1.6.3.7-v4 - FIX Issue #3: Tier 2 (now fallback) - Fall back to runtime.sendMessage if no ports available
  // This ensures sidebar gets the message even if port connection hasn't been established yet
  if (!sentViaPort) {
    try {
      await browser.runtime.sendMessage(message);
      console.log('[Background] STATE_UPDATE sent via runtime.sendMessage (no port available):', {
        messageId,
        quickTabId,
        correlationId: effectiveCorrelationId
      });
    } catch (_err) {
      // Sidebar may not be open - ignore
      console.log('[Background] No port or runtime listener available for state update');
    }
  }

  // v1.6.3.7 - FIX Issue #3: For deletions, broadcast to ALL tabs (except sender)
  // This ensures UI button and Manager button produce identical cross-tab results
  if (changes?.deleted === true) {
    // v1.6.3.6-v5 - FIX Issue #4e: Pass correlation ID for deletion tracing
    await _broadcastDeletionToAllTabs(
      quickTabId,
      source,
      excludeTabId,
      changes.correlationId || effectiveCorrelationId
    );
  }
}

/**
 * Determine broadcast type and function based on changes
 * v1.6.4.13 - FIX Complexity: Extracted to reduce _broadcastViaBroadcastChannel cc
/**
 * Check if this is a create operation (new Quick Tab)
 * v1.6.4.14 - FIX Complexity: Extracted to simplify _determineBroadcastTypeAndFn
 * @private
 */
function _isQuickTabCreation(changes, quickTabId) {
  return changes?.url && !globalQuickTabState.tabs.find(t => t.id === quickTabId);
}

/**
 * Determine the broadcast type based on state changes (for logging)
 * v1.6.3.8-v6 - BC REMOVED: Used only for logging, no BC function calls
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @returns {{ broadcastType: string }}
 */
function _determineBroadcastType(quickTabId, changes) {
  // Priority-ordered checks for state changes
  if (changes?.deleted === true) {
    return { broadcastType: 'quick-tab-deleted' };
  }
  if (changes?.minimized === true) {
    return { broadcastType: 'quick-tab-minimized' };
  }
  if (changes?.minimized === false) {
    return { broadcastType: 'quick-tab-restored' };
  }
  if (_isQuickTabCreation(changes, quickTabId)) {
    return { broadcastType: 'quick-tab-created' };
  }
  return { broadcastType: 'quick-tab-updated' };
}

// v1.6.3.8-v12 - Port infrastructure removed - use runtime.sendMessage in broadcastQuickTabStateUpdate

/**
 * Broadcast message to sidebar - no-op (port infrastructure removed)
 * v1.6.3.8-v12 - Port infrastructure removed
 * @private
 * @param {Object} _message - Message to send (unused)
 * @returns {number} Always returns 0 (no ports available)
 */
function _broadcastToSidebarPorts(_message) {
  // v1.6.3.8-v12 - Port infrastructure removed, return 0 sent
  // Sidebar communication now handled via runtime.sendMessage fallback
  return 0;
}

/**
 * Send deletion message to a single tab
 * v1.6.3.7 - FIX Issue #3: Extracted to reduce _broadcastDeletionToAllTabs nesting depth
 * v1.6.3.6-v5 - FIX Issue #4e: Added correlationId for end-to-end tracing
 * @private
 * @param {number} tabId - Tab ID to send message to
 * @param {string} quickTabId - Quick Tab ID being deleted
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<boolean>} True if message was sent successfully
 */
async function _sendDeletionToTab(tabId, quickTabId, correlationId) {
  try {
    await browser.tabs.sendMessage(tabId, {
      action: 'CLOSE_QUICK_TAB',
      quickTabId,
      source: 'background-broadcast',
      correlationId // v1.6.3.6-v5: Pass correlation ID for deletion tracing
    });
    return true;
  } catch (_err) {
    // Content script may not be loaded in this tab - ignore
    return false;
  }
}

/**
 * Process single tab for deletion broadcast
 * v1.6.3.7 - Extracted to reduce nesting depth in _broadcastDeletionToAllTabs
 * v1.6.3.6-v5 - FIX Issue #4e: Added correlationId for end-to-end tracing
 * @private
 * @param {Object} tab - Browser tab object
 * @param {string} quickTabId - Quick Tab ID being deleted
 * @param {number} excludeTabId - Tab to exclude from broadcast
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<{ sent: boolean, skipped: boolean }>}
 */
async function _processDeletionForTab(tab, quickTabId, excludeTabId, correlationId) {
  // Skip the sender tab to prevent echo/loop
  if (tab.id === excludeTabId) {
    return { sent: false, skipped: true };
  }

  const success = await _sendDeletionToTab(tab.id, quickTabId, correlationId);
  return { sent: success, skipped: false };
}

/**
 * Broadcast deletion event to all content scripts except the sender tab
 * v1.6.3.7 - FIX Issue #3: Unified deletion behavior across UI and Manager paths
 * v1.6.3.6-v5 - FIX Issue #4e: Added deletion propagation logging with correlation IDs
 * v1.6.3.6-v12 - FIX Issue #6: Added acknowledgment tracking for message ordering
 * @private
 * @param {string} quickTabId - Quick Tab ID being deleted
 * @param {string} source - Source of deletion
 * @param {number} excludeTabId - Tab to exclude from broadcast (the source tab)
 * @param {string} correlationId - Correlation ID for end-to-end tracing
 */
async function _broadcastDeletionToAllTabs(quickTabId, source, excludeTabId, correlationId) {
  // v1.6.3.6-v5 - FIX Issue #4e: Use provided correlation ID or generate one
  const corrId = correlationId || `del-${Date.now()}-${quickTabId.substring(0, 8)}`;

  console.log('[Background] Broadcasting deletion to all tabs:', {
    quickTabId,
    source,
    excludeTabId,
    correlationId: corrId
  });

  try {
    const tabs = await browser.tabs.query({});

    // v1.6.3.6-v12 - FIX Issue #6: Track pending acknowledgments
    const pendingTabs = new Set(tabs.filter(t => t.id !== excludeTabId).map(t => t.id));

    // Set up acknowledgment tracking with timeout
    const ackPromise = _setupDeletionAckTracking(corrId, pendingTabs);

    // Send deletion messages to all tabs
    const results = await Promise.all(
      tabs.map(tab => _processDeletionForTab(tab, quickTabId, excludeTabId, corrId))
    );

    const successCount = results.filter(r => r.sent).length;
    const skipCount = results.filter(r => r.skipped).length;

    // v1.6.3.6-v12 - FIX Issue #6: Wait for acknowledgments (with timeout)
    await _waitForDeletionAcks(corrId, ackPromise);

    // v1.6.3.6-v5 - FIX Issue #4e: Log deletion broadcast complete with correlation ID
    logDeletionPropagation(corrId, 'broadcast-complete', quickTabId, {
      totalTabs: tabs.length,
      successCount,
      skipCount
    });

    console.log('[Background] Deletion broadcast complete:', {
      quickTabId,
      totalTabs: tabs.length,
      successCount,
      skipCount,
      correlationId: corrId
    });
  } catch (err) {
    console.error('[Background] Error broadcasting deletion:', err.message);
  }
}

/**
 * Wait for deletion acknowledgments with timeout
 * v1.6.3.6-v12 - FIX Code Review: Extracted to reduce nesting depth
 * @private
 * @param {string} corrId - Correlation ID
 * @param {Promise} ackPromise - Promise that resolves when acks received
 */
async function _waitForDeletionAcks(corrId, ackPromise) {
  let timeoutId = null;
  try {
    await Promise.race([
      ackPromise.then(result => {
        if (timeoutId) clearTimeout(timeoutId);
        return result;
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Ack timeout')), DELETION_ACK_TIMEOUT_MS);
      })
    ]);
    console.log('[Background] v1.6.3.6-v12 All deletion acks received:', corrId);
  } catch (ackErr) {
    if (timeoutId) clearTimeout(timeoutId);
    _logDeletionAckTimeout(corrId, ackErr);
  }
}

/**
 * Log deletion acknowledgment timeout with details
 * v1.6.3.6-v12 - FIX Code Review: Extracted to reduce nesting
 * @private
 * @param {string} corrId - Correlation ID
 * @param {Error} ackErr - The timeout error
 */
function _logDeletionAckTimeout(corrId, ackErr) {
  const pending = pendingDeletionAcks.get(corrId);
  console.warn('[Background] v1.6.3.6-v12 Deletion ack timeout:', {
    correlationId: corrId,
    pendingTabs: pending ? Array.from(pending.pendingTabs) : [],
    completedTabs: pending ? Array.from(pending.completedTabs) : [],
    error: ackErr.message
  });
  // Clean up on timeout
  pendingDeletionAcks.delete(corrId);
}

/**
 * Set up tracking for deletion acknowledgments
 * v1.6.3.6-v12 - FIX Issue #6: Message ordering via acknowledgments
 * @private
 * @param {string} correlationId - Correlation ID
 * @param {Set<number>} pendingTabs - Set of tab IDs expected to acknowledge
 * @returns {Promise<Object>} Promise that resolves when all acks received
 */
function _setupDeletionAckTracking(correlationId, pendingTabs) {
  return new Promise((resolve, reject) => {
    pendingDeletionAcks.set(correlationId, {
      pendingTabs: new Set(pendingTabs),
      completedTabs: new Set(),
      startTime: Date.now(),
      resolve,
      reject
    });
  });
}

/**
 * Handle MANAGER_COMMAND message from sidebar
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Manager can control Quick Tabs in any tab
 * @param {Object} message - Message containing command
 */
function handleManagerCommand(message) {
  const { command, quickTabId, sourceContext } = message;

  console.log('[Background] MANAGER_COMMAND received:', {
    command,
    quickTabId,
    sourceContext
  });

  // Find which tab hosts this Quick Tab
  const hostTabId = quickTabHostTabs.get(quickTabId);

  if (!hostTabId) {
    console.warn('[Background] Cannot execute command - Quick Tab host unknown:', quickTabId);
    // Try to find from cache
    const cachedTab = globalQuickTabState.tabs.find(t => t.id === quickTabId);
    if (cachedTab?.originTabId) {
      console.log('[Background] Found host from cache:', cachedTab.originTabId);
      quickTabHostTabs.set(quickTabId, cachedTab.originTabId);
      return executeManagerCommand(command, quickTabId, cachedTab.originTabId);
    }
    return Promise.resolve({ success: false, error: 'Quick Tab host unknown' });
  }

  return executeManagerCommand(command, quickTabId, hostTabId);
}

/**
 * Valid Manager commands (allowlist for security)
 * v1.6.3.5-v3 - FIX Code Review: Command validation
 */
const VALID_MANAGER_COMMANDS = new Set([
  'MINIMIZE_QUICK_TAB',
  'RESTORE_QUICK_TAB',
  'CLOSE_QUICK_TAB',
  'FOCUS_QUICK_TAB'
]);

/**
 * Execute Manager command by sending to target content script
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Route commands to correct tab
 * @param {string} command - Command to execute
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} hostTabId - Tab ID hosting the Quick Tab
 */
async function executeManagerCommand(command, quickTabId, hostTabId) {
  // v1.6.3.5-v3 - FIX Code Review: Validate command against allowlist
  if (!VALID_MANAGER_COMMANDS.has(command)) {
    console.warn('[Background] Invalid command rejected:', { command, quickTabId });
    return { success: false, error: `Unknown command: ${command}` };
  }

  const executeMessage = {
    type: 'EXECUTE_COMMAND',
    command,
    quickTabId,
    source: 'manager'
  };

  console.log('[Background] Routing command to tab:', {
    command,
    quickTabId,
    hostTabId
  });

  try {
    const response = await browser.tabs.sendMessage(hostTabId, executeMessage);
    console.log('[Background] Command executed successfully:', response);
    return { success: true, response };
  } catch (err) {
    console.error('[Background] Failed to execute command:', {
      command,
      quickTabId,
      hostTabId,
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

// Register message handlers for Quick Tab coordination
// This extends the existing runtime.onMessage listener
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // v1.6.3.7-v4 - FIX Issue #8: Handle HEALTH_PROBE for circuit breaker early recovery
  // This handles probes sent via sendMessage when port is down
  if (message.type === 'HEALTH_PROBE') {
    console.log('[Background] HEALTH_PROBE via sendMessage received:', {
      source: message.source,
      timestamp: message.timestamp
    });
    sendResponse({
      success: true,
      type: 'HEALTH_ACK',
      healthy: true,
      timestamp: Date.now(),
      originalTimestamp: message.timestamp,
      isInitialized,
      cacheTabCount: globalQuickTabState.tabs?.length || 0
    });
    return true;
  }

  // v1.6.3.8-v6 - BC REMOVED: BC_VERIFICATION_REQUEST returns deprecated response
  if (message.type === 'BC_VERIFICATION_REQUEST') {
    console.log('[Background] BC_VERIFICATION_REQUEST received (BC REMOVED):', {
      requestId: message.requestId,
      source: message.source,
      timestamp: message.timestamp,
      note: 'BroadcastChannel removed - use Port-based messaging'
    });

    sendResponse({
      success: true,
      type: 'BC_VERIFICATION_REQUEST_ACK',
      bcAvailable: false,
      deprecated: true,
      message: 'BroadcastChannel removed - use Port-based messaging',
      timestamp: Date.now()
    });
    return true;
  }

  // v1.6.3.5-v3 - FIX Architecture Phase 1-3: Handle Quick Tab coordination messages
  if (message.type === 'QUICK_TAB_STATE_CHANGE') {
    handleQuickTabStateChange(message, sender)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'MANAGER_COMMAND') {
    handleManagerCommand(message)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // v1.6.3.8-v8 - Issue #19: Handle CONTENT_SCRIPT_UNLOAD from content script
  // This provides explicit cleanup when content script is about to unload
  if (message.action === 'CONTENT_SCRIPT_UNLOAD' || message.type === 'CONTENT_SCRIPT_UNLOAD') {
    const tabId = message.tabId || sender?.tab?.id;
    console.log('[Background] CONTENT_SCRIPT_UNLOAD received:', {
      tabId,
      reason: message.reason,
      timestamp: message.timestamp,
      senderTabId: sender?.tab?.id
    });

    // Clean up any port associated with this tab
    _cleanupPortsForTab(tabId);

    // Clean up Quick Tab host tracking
    _cleanupQuickTabHostTracking(tabId);

    sendResponse({
      success: true,
      type: 'CONTENT_SCRIPT_UNLOAD_ACK',
      timestamp: Date.now()
    });
    return true;
  }

  // Let other handlers process the message
  return false;
});

console.log('[Background] v1.6.3.5-v3 Message infrastructure registered');
// ==================== END MESSAGE INFRASTRUCTURE ====================

// ==================== v1.6.3.7-v3 CONTEXT MENUS ====================
// API #7: Enhanced contextMenus for Quick Tab grouping options

/**
 * Context menu IDs for Quick Tab grouping
 * v1.6.3.7-v3 - API #7: Context menu constants
 */
const CONTEXT_MENU_IDS = {
  GROUPING_SUBMENU: 'qt-grouping-submenu',
  CREATE_NEW_GROUP: 'create-new-group',
  ADD_TO_GROUP: 'add-to-group'
};

/**
 * Initialize context menus for Quick Tab grouping
 * v1.6.3.7-v3 - API #7: Creates submenu with grouping options
 */
function initializeContextMenus() {
  console.log('[Background] v1.6.3.7-v3 Initializing context menus...');

  try {
    // Create main submenu for Quick Tab Grouping
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.GROUPING_SUBMENU,
      title: 'Quick Tab Grouping',
      contexts: ['page', 'link']
    });

    // Create "Create new group..." option
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.CREATE_NEW_GROUP,
      parentId: CONTEXT_MENU_IDS.GROUPING_SUBMENU,
      title: 'Create new Quick Tab group...',
      contexts: ['page', 'link']
    });

    // Create "Add to group..." option
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.ADD_TO_GROUP,
      parentId: CONTEXT_MENU_IDS.GROUPING_SUBMENU,
      title: 'Add to group...',
      contexts: ['page', 'link']
    });

    console.log('[Background] v1.6.3.7-v3 Context menus created successfully');
  } catch (err) {
    console.error('[Background] Failed to create context menus:', err.message);
  }
}

/**
 * Handle context menu click events
 * v1.6.3.7-v3 - API #7: Route menu clicks to appropriate handlers
 * @param {Object} info - Click info (menuItemId, linkUrl, pageUrl, etc.)
 * @param {Object} tab - Tab where the menu was clicked
 */
async function handleContextMenuClick(info, tab) {
  const { menuItemId, linkUrl, pageUrl } = info;
  const tabId = tab?.id;

  console.log('[Background] Context menu clicked:', {
    menuItemId,
    linkUrl,
    pageUrl,
    tabId
  });

  switch (menuItemId) {
    case CONTEXT_MENU_IDS.CREATE_NEW_GROUP:
      await handleCreateNewGroup(linkUrl || pageUrl, tabId);
      break;

    case CONTEXT_MENU_IDS.ADD_TO_GROUP:
      await handleAddToGroup(linkUrl || pageUrl, tabId);
      break;

    default:
      console.log('[Background] Unknown context menu item:', menuItemId);
  }
}

/**
 * Handle "Create new Quick Tab group..." menu action
 * v1.6.3.7-v3 - API #7: Creates group with current tab
 * @param {string} url - URL from context menu
 * @param {number} tabId - Current tab ID
 */
async function handleCreateNewGroup(url, tabId) {
  console.log('[Background] Creating new Quick Tab group:', { url, tabId });

  // Check if tabs.group API is available (Firefox 138+)
  if (typeof browser.tabs.group !== 'function') {
    console.warn('[Background] tabs.group API not available (requires Firefox 138+)');
    // Show notification about unavailable feature
    await notifyGroupingUnavailable();
    return;
  }

  try {
    // Create group with current tab
    const groupId = await browser.tabs.group({
      tabIds: [tabId],
      createProperties: {
        windowId: browser.windows.WINDOW_ID_CURRENT
      }
    });

    // Store group metadata
    const metadata = {
      groupId,
      name: `Quick Tab Group ${groupId}`,
      tabIds: [tabId],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await saveQuickTabGroupMetadata(metadata);

    console.log('[Background] Quick Tab group created:', metadata);

    // Notify user of success
    await notifyGroupCreated(metadata.name);
  } catch (err) {
    console.error('[Background] Failed to create Quick Tab group:', err.message);
  }
}

/**
 * Handle "Add to group..." menu action
 * v1.6.3.7-v3 - API #7: Shows prompt to select group
 * @param {string} url - URL from context menu
 * @param {number} tabId - Current tab ID
 */
async function handleAddToGroup(url, tabId) {
  console.log('[Background] Add to group requested:', { url, tabId });

  // Check if tabs.group API is available (Firefox 138+)
  if (typeof browser.tabs.group !== 'function') {
    console.warn('[Background] tabs.group API not available (requires Firefox 138+)');
    await notifyGroupingUnavailable();
    return;
  }

  // For now, log the request - full UI would require popup/sidebar interaction
  console.log('[Background] Add to group: Feature requires group selection UI (coming soon)');

  // Notify user that this feature is coming
  await notifyFeatureComingSoon('Add to group');
}

/**
 * Save Quick Tab group metadata to storage
 * v1.6.3.7-v3 - API #7: Persist group data
 * @param {Object} metadata - Group metadata
 */
async function saveQuickTabGroupMetadata(metadata) {
  try {
    const result = await browser.storage.local.get('quickTabGroups');
    const groups = result.quickTabGroups || [];
    groups.push(metadata);
    await browser.storage.local.set({ quickTabGroups: groups });
    console.log('[Background] Group metadata saved:', metadata.groupId);
  } catch (err) {
    console.error('[Background] Failed to save group metadata:', err.message);
  }
}

// Register context menu click listener
browser.contextMenus.onClicked.addListener(handleContextMenuClick);

// Initialize context menus on script load
initializeContextMenus();

console.log('[Background] v1.6.3.7-v3 Context menus initialized');
// ==================== END CONTEXT MENUS ====================

// ==================== v1.6.3.7-v3 NOTIFICATIONS API ====================
// API #6: browser.notifications for user feedback

/**
 * Notification icon path
 * v1.6.3.7-v3 - API #6: Notification constants
 */
const NOTIFICATION_ICON_PATH = '/icons/icon-48.png';

/**
 * Auto-clear timeout for notifications (ms)
 * v1.6.3.7-v3 - API #6: 5 second auto-clear
 */
const NOTIFICATION_AUTO_CLEAR_MS = 5000;

/**
 * Check if notifications API is available
 * v1.6.3.7-v3 - API #6: Feature detection
 * @returns {boolean} True if available
 */
function isNotificationsAvailable() {
  return (
    typeof browser.notifications !== 'undefined' &&
    typeof browser.notifications.create === 'function'
  );
}

/**
 * Notify when Quick Tab is created
 * v1.6.3.7-v3 - API #6: User feedback for creation
 * @param {Object} quickTab - Quick Tab data { id, title, url }
 */
async function notifyQuickTabCreated(quickTab) {
  if (!isNotificationsAvailable()) {
    return null;
  }

  try {
    const notificationId = `qt-created-${quickTab.id}`;
    const title = quickTab.title || 'Quick Tab';
    const truncatedTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

    await browser.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_PATH,
      title: 'Quick Tab Created',
      message: `"${truncatedTitle}" is now a Quick Tab`,
      priority: 1
    });

    // Auto-clear after timeout
    setTimeout(() => {
      browser.notifications.clear(notificationId).catch(() => {});
    }, NOTIFICATION_AUTO_CLEAR_MS);

    console.log('[Background] Quick Tab created notification sent:', notificationId);
    return notificationId;
  } catch (err) {
    console.warn('[Background] Failed to send notification:', err.message);
    return null;
  }
}

/**
 * Notify about storage warning
 * v1.6.3.7-v3 - API #6: Storage issue alerts
 * @param {string} message - Warning message
 */
/**
 * Create and display a notification with auto-clear
 * v1.6.4.13 - FIX Code Duplication: Extracted common notification logic
 * @private
 * @param {Object} config - Notification configuration
 * @param {string} config.idPrefix - Prefix for notification ID (e.g., 'qt-storage-warning')
 * @param {string} config.title - Notification title
 * @param {string} config.message - Notification message
 * @param {number} [config.priority=1] - Notification priority (1-2)
 * @param {number} [config.clearTimeoutMultiplier=1] - Multiplier for auto-clear timeout
 * @returns {Promise<string|null>} Notification ID or null on failure
 */
async function _createNotification({
  idPrefix,
  title,
  message,
  priority = 1,
  clearTimeoutMultiplier = 1
}) {
  if (!isNotificationsAvailable()) {
    return null;
  }

  try {
    const notificationId = `${idPrefix}-${Date.now()}`;

    await browser.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_PATH,
      title,
      message,
      priority
    });

    setTimeout(() => {
      browser.notifications.clear(notificationId).catch(() => {});
    }, NOTIFICATION_AUTO_CLEAR_MS * clearTimeoutMultiplier);

    console.log('[Background] Notification sent:', { notificationId, title });
    return notificationId;
  } catch (err) {
    console.warn('[Background] Failed to send notification:', err.message);
    return null;
  }
}

async function notifyStorageWarning(message) {
  return _createNotification({
    idPrefix: 'qt-storage-warning',
    title: 'Quick Tabs Storage Issue',
    message: message || 'A storage issue was detected',
    priority: 2,
    clearTimeoutMultiplier: 2
  });
}

/**
 * Notify that grouping is unavailable (Firefox < 138)
 * v1.6.3.7-v3 - API #6: Feature unavailable notification
 * v1.6.4.13 - FIX Code Duplication: Uses _createNotification helper
 */
async function notifyGroupingUnavailable() {
  return _createNotification({
    idPrefix: 'qt-grouping-unavailable',
    title: 'Tab Grouping Unavailable',
    message: 'Tab grouping requires Firefox 138 or newer'
  });
}

/**
 * Notify that Quick Tab group was created
 * v1.6.3.7-v3 - API #6: Group creation success notification
 * v1.6.4.13 - FIX Code Duplication: Uses _createNotification helper
 * @param {string} groupName - Name of the created group
 */
async function notifyGroupCreated(groupName) {
  return _createNotification({
    idPrefix: 'qt-group-created',
    title: 'Quick Tab Group Created',
    message: `Group "${groupName}" created successfully`
  });
}

/**
 * Notify that a feature is coming soon
 * v1.6.3.7-v3 - API #6: Coming soon notification
 * v1.6.4.13 - FIX Code Duplication: Uses _createNotification helper
 * @param {string} featureName - Name of the feature
 */
async function notifyFeatureComingSoon(featureName) {
  return _createNotification({
    idPrefix: 'qt-coming-soon',
    title: 'Feature Coming Soon',
    message: `"${featureName}" will be available in a future update`
  });
}

/**
 * Check if sidebar can be opened
 * v1.6.3.7-v3 - Extracted to reduce nesting depth
 * @returns {boolean} True if sidebarAction.open is available
 */
function canOpenSidebar() {
  return typeof browser.sidebarAction?.open === 'function';
}

/**
 * Handle notification click events
 * v1.6.3.7-v3 - API #6: Notification click handler
 * @param {string} notificationId - ID of clicked notification
 */
async function handleNotificationClick(notificationId) {
  console.log('[Background] Notification clicked:', notificationId);

  try {
    // If it's a Quick Tab created notification, open the sidebar
    const isQuickTabNotification = notificationId.startsWith('qt-created-');
    if (isQuickTabNotification && canOpenSidebar()) {
      await browser.sidebarAction.open();
      console.log('[Background] Sidebar opened from notification click');
    }

    // Clear the notification after handling
    await browser.notifications.clear(notificationId);
  } catch (err) {
    console.error('[Background] Error handling notification click:', err.message);
  }
}

// Register notification click listener if available
if (isNotificationsAvailable() && browser.notifications.onClicked) {
  browser.notifications.onClicked.addListener(handleNotificationClick);
  console.log('[Background] v1.6.3.7-v3 Notification click listener registered');
}

console.log('[Background] v1.6.3.7-v3 Notifications API initialized');
// ==================== END NOTIFICATIONS API ====================
