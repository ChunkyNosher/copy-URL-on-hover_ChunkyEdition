// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs
// v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load

// v1.6.0 - PHASE 3.1: Import message routing infrastructure
import { LogHandler } from './src/background/handlers/LogHandler.js';
import { QuickTabHandler } from './src/background/handlers/QuickTabHandler.js';
import { TabHandler } from './src/background/handlers/TabHandler.js';
import { MessageRouter } from './src/background/MessageRouter.js';
// v1.6.3.7-v7 - FIX Communication Issue #1 & #2: Import BroadcastChannelManager
// Background must broadcast state changes via BroadcastChannel for instant sidebar updates
import {
  initBroadcastChannel as initBroadcastChannelManager,
  isChannelAvailable as isBroadcastChannelAvailable,
  broadcastQuickTabCreated,
  broadcastQuickTabUpdated,
  broadcastQuickTabDeleted,
  broadcastQuickTabMinimized,
  broadcastQuickTabRestored,
  broadcastFullStateSync
} from './src/features/quick-tabs/channels/BroadcastChannelManager.js';
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
const globalQuickTabState = {
  // v1.6.2.2 - Unified format: single tabs array for global visibility
  tabs: [],
  lastUpdate: 0,
  // v1.6.3.4 - FIX Bug #7: Track saveId for hash collision detection
  saveId: null
};

// Flag to track initialization status
let isInitialized = false;

// v1.6.3.7-v10 - FIX Issue #11: Track initialization start time for listener entry logging
let initializationStartTime = Date.now();

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
 */
const RECOVERY_KEEP_PERCENTAGE = 0.75;

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

// Issue #6: Port Registry Size Warnings
const PORT_REGISTRY_WARN_THRESHOLD = 50; // Warn if registry exceeds 50 ports
const PORT_REGISTRY_CRITICAL_THRESHOLD = 100; // Critical if exceeds 100 ports

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

// ==================== v1.6.3.7-v12 PORT REGISTRY MONITORING ====================
// Issue #3, #10: Port registry threshold monitoring interval
const PORT_REGISTRY_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
let portRegistryCheckIntervalId = null;
// Track port registry size history for trend analysis
const portRegistrySizeHistory = [];
const PORT_REGISTRY_HISTORY_MAX = 5;

// ==================== v1.6.3.7-v12 DEDUP STATISTICS ====================
// Issue #6: Track deduplication statistics
let dedupStats = {
  skipped: 0,
  processed: 0,
  lastResetTime: Date.now()
};
const DEDUP_STATS_LOG_INTERVAL_MS = 60000; // Log stats every 60 seconds
let dedupStatsIntervalId = null;

// ==================== v1.6.3.7-v3 ALARM CONSTANTS ====================
// API #4: browser.alarms - Scheduled cleanup tasks
const ALARM_CLEANUP_ORPHANED = 'cleanup-orphaned';
const ALARM_SYNC_SESSION_STATE = 'sync-session-state';
const ALARM_DIAGNOSTIC_SNAPSHOT = 'diagnostic-snapshot';

// Alarm intervals in minutes
const ALARM_CLEANUP_INTERVAL_MIN = 60; // Hourly orphan cleanup
const ALARM_SYNC_INTERVAL_MIN = 5; // Every 5 minutes sync
const ALARM_DIAGNOSTIC_INTERVAL_MIN = 120; // Every 2 hours diagnostic

// ==================== v1.6.3.7 KEEPALIVE MECHANISM ====================
// FIX Issue #1: Firefox 117+ Bug 1851373 - runtime.Port does NOT reset the idle timer
// Use runtime.sendMessage periodically as it DOES reset the idle timer
let keepaliveIntervalId = null;

/**
 * Start keepalive interval to reset Firefox's idle timer
 * v1.6.3.7 - FIX Issue #1: Use browser.runtime.sendMessage to reset idle timer
 * v1.6.4.9 - Issue #5: Added health monitoring with periodic health checks
 */
function startKeepalive() {
  if (keepaliveIntervalId) {
    clearInterval(keepaliveIntervalId);
  }

  // v1.6.4.9 - Issue #5: Initialize health tracking
  lastKeepaliveSuccessTime = Date.now();
  consecutiveKeepaliveFailures = 0;
  keepaliveSuccessCount = 0;

  // Immediate ping to register activity
  triggerIdleReset();

  keepaliveIntervalId = setInterval(() => {
    triggerIdleReset();
  }, KEEPALIVE_INTERVAL_MS);

  // v1.6.4.9 - Issue #5: Start health check interval
  _startKeepaliveHealthCheck();

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
 * @private
 * @param {Object} context - Keepalive context with results
 * @param {number} attemptStartTime - When the attempt started
 */
function _handleKeepaliveSuccess(context, attemptStartTime) {
  lastKeepaliveSuccessTime = Date.now();
  consecutiveKeepaliveFailures = 0;
  firstKeepaliveFailureLogged = false;
  keepaliveSuccessCount++;

  // Rate-limited success logging (every 10th success)
  if (keepaliveSuccessCount % KEEPALIVE_LOG_EVERY_N === 0) {
    console.log('[Background] KEEPALIVE_RESET_SUCCESS:', {
      tabCount: context.tabCount,
      successCount: keepaliveSuccessCount,
      failureCount: consecutiveKeepaliveFailures,
      tabsQuerySuccess: context.tabsQuerySuccess,
      sendMessageSuccess: context.sendMessageSuccess,
      durationMs: Date.now() - attemptStartTime,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle keepalive reset failure
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce triggerIdleReset complexity
 * @private
 * @param {Error} err - Error that occurred
 * @param {boolean} tabsQuerySuccess - Whether tabs.query succeeded
 * @param {number} attemptStartTime - When the attempt started
 */
function _handleKeepaliveFailure(err, tabsQuerySuccess, attemptStartTime) {
  consecutiveKeepaliveFailures++;
  
  // Issue #2: Always log first failure, then sample every Nth thereafter (deterministic)
  // v1.6.3.7-v12 - FIX Code Review: Counter-based sampling for predictable, testable behavior
  const shouldLogFailure = !firstKeepaliveFailureLogged || 
    (consecutiveKeepaliveFailures % KEEPALIVE_FAILURE_LOG_EVERY_N === 0);
  
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
      samplingStrategy: firstKeepaliveFailureLogged ? `every ${KEEPALIVE_FAILURE_LOG_EVERY_N}th` : 'first',
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
}

// Start keepalive on script load
startKeepalive();

// ==================== v1.6.3.7-v7 BROADCASTCHANNEL INITIALIZATION ====================
// FIX Communication Issue #1 & #2: Initialize BroadcastChannel for instant sidebar updates
// This is Tier 1 (PRIMARY) messaging - instant cross-tab sync

/**
 * Initialize BroadcastChannel for background-to-Manager communication
 * v1.6.3.7-v7 - FIX Issue #1 & #2: Background must use BroadcastChannel
 */
function initializeBackgroundBroadcastChannel() {
  const initialized = initBroadcastChannelManager();
  if (initialized) {
    console.log('[Background] [BC] BroadcastChannel initialized for state broadcasts');
  } else {
    console.warn('[Background] [BC] BroadcastChannel NOT available - Manager will use polling fallback');
  }
  return initialized;
}

// Initialize BroadcastChannel on script load
initializeBackgroundBroadcastChannel();

// ==================== v1.6.3.7-v3 ALARMS MECHANISM ====================
// API #4: browser.alarms - Scheduled cleanup tasks

/**
 * Initialize browser.alarms for scheduled cleanup tasks
 * v1.6.3.7-v3 - API #4: Create alarms on extension startup
 */
async function initializeAlarms() {
  console.log('[Background] v1.6.3.7-v3 Initializing browser.alarms...');

  try {
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

    console.log('[Background] v1.6.3.7-v3 All alarms initialized successfully');
  } catch (err) {
    console.error('[Background] Failed to initialize alarms:', err.message);
  }
}

/**
 * Handle alarm events
 * v1.6.3.7-v3 - API #4: Route alarms to appropriate handlers
 * @param {Object} alarm - Alarm info object
 */
async function handleAlarm(alarm) {
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

    default:
      console.warn('[Background] Unknown alarm:', alarm.name);
  }
}

/**
 * Cleanup orphaned Quick Tabs whose origin tabs no longer exist
 * v1.6.3.7-v3 - API #4: Hourly orphan cleanup
 */
async function cleanupOrphanedQuickTabs() {
  console.log('[Background] Running orphaned Quick Tab cleanup...');

  const initGuard = checkInitializationGuard('cleanupOrphanedQuickTabs');
  if (!initGuard.initialized) {
    console.warn('[Background] Skipping cleanup - not initialized');
    return;
  }

  try {
    // Get all open browser tabs
    const openTabs = await browser.tabs.query({});
    const openTabIds = new Set(openTabs.map(t => t.id));

    // Find orphaned Quick Tabs (their origin tab no longer exists)
    const orphanedTabs = globalQuickTabState.tabs.filter(qt => {
      const originTabId = qt.originTabId;
      // Quick Tab is orphaned if it has an originTabId that is no longer open
      return originTabId != null && !openTabIds.has(originTabId);
    });

    if (orphanedTabs.length === 0) {
      console.log('[Background] No orphaned Quick Tabs found');
      return;
    }

    console.log(
      '[Background] Found',
      orphanedTabs.length,
      'orphaned Quick Tabs:',
      orphanedTabs.map(t => ({ id: t.id, originTabId: t.originTabId }))
    );

    // Mark as orphaned in state instead of deleting (for user review in Manager)
    for (const orphan of orphanedTabs) {
      orphan.orphaned = true;
    }

    // Update global state
    globalQuickTabState.lastUpdate = Date.now();

    // Save to storage
    // v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
    const saveId = `cleanup-${Date.now()}`;
    const sequenceId = _getNextStorageSequenceId();
    await browser.storage.local.set({
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        saveId,
        sequenceId,
        timestamp: Date.now()
      }
    });

    console.log('[Background] Marked', orphanedTabs.length, 'Quick Tabs as orphaned');
  } catch (err) {
    console.error('[Background] Orphan cleanup failed:', err.message);
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
 * Log diagnostic snapshot of current state
 * v1.6.3.7-v3 - API #4: Periodic diagnostic logging
 * v1.6.3.7-v12 - Issue #3, #10: Include port registry threshold check and trend
 * v1.6.3.7-v13 - Issue #4: Enhanced format with "connectedPorts: N (STATUS, trend)"
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
  
  // v1.6.3.7-v12 - Issue #3, #10: Enhanced port registry logging with thresholds
  // v1.6.3.7-v13 - Issue #4: Format as "connectedPorts: N (STATUS, trend)"
  const portCount = portRegistry.size;
  const portTrend = _computePortRegistryTrend();
  const portHealthStatus = _getPortRegistryThresholdStatus(portCount);
  console.log('[Background] Port registry:', {
    summary: `connectedPorts: ${portCount} (${portHealthStatus}, ${portTrend} trend)`,
    connectedPorts: portCount,
    warnThreshold: PORT_REGISTRY_WARN_THRESHOLD,
    criticalThreshold: PORT_REGISTRY_CRITICAL_THRESHOLD,
    thresholdStatus: portHealthStatus,
    trend: portTrend,
    portIds: [...portRegistry.keys()]
  });
  
  console.log('[Background] Quick Tab host tracking:', {
    trackedQuickTabs: quickTabHostTabs.size
  });
  
  // v1.6.3.7-v12 - Issue #6: Include dedup statistics
  console.log('[Background] Dedup statistics:', {
    skipped: dedupStats.skipped,
    processed: dedupStats.processed,
    totalSinceReset: dedupStats.skipped + dedupStats.processed,
    skipRate: dedupStats.processed > 0 
      ? ((dedupStats.skipped / (dedupStats.skipped + dedupStats.processed)) * 100).toFixed(1) + '%'
      : 'N/A',
    lastResetTime: new Date(dedupStats.lastResetTime).toISOString()
  });
  
  console.log('[Background] =================================================================');
}

/**
 * Get port registry threshold status
 * v1.6.3.7-v12 - Issue #3, #10: Helper for threshold status
 * @private
 * @param {number} count - Current port count
 * @returns {string} Status string
 */
function _getPortRegistryThresholdStatus(count) {
  if (count >= PORT_REGISTRY_CRITICAL_THRESHOLD) return 'CRITICAL';
  if (count >= PORT_REGISTRY_WARN_THRESHOLD) return 'WARNING';
  return 'OK';
}

/**
 * Compute port registry trend from history
 * v1.6.3.7-v12 - Issue #3, #10: Helper for trend analysis
 * @private
 * @returns {string} Trend description
 */
function _computePortRegistryTrend() {
  if (portRegistrySizeHistory.length < 2) return 'insufficient_data';
  
  const oldest = portRegistrySizeHistory[0];
  const newest = portRegistrySizeHistory[portRegistrySizeHistory.length - 1];
  const diff = newest - oldest;
  
  if (diff > 5) return 'increasing';
  if (diff < -5) return 'decreasing';
  return 'stable';
}

/**
 * Check port registry thresholds and log warnings
 * v1.6.3.7-v12 - Issue #3, #10: Implement threshold monitoring
 * Called periodically to check port registry health
 */
function checkPortRegistryThresholds() {
  const count = portRegistry.size;
  
  // Update history for trend analysis
  portRegistrySizeHistory.push(count);
  if (portRegistrySizeHistory.length > PORT_REGISTRY_HISTORY_MAX) {
    portRegistrySizeHistory.shift();
  }
  
  const trend = _computePortRegistryTrend();
  
  // v1.6.3.7-v12 - Issue #10: Check CRITICAL threshold
  if (count >= PORT_REGISTRY_CRITICAL_THRESHOLD) {
    console.error('[Background] [PORT] PORT_REGISTRY_CRITICAL:', {
      currentSize: count,
      criticalThreshold: PORT_REGISTRY_CRITICAL_THRESHOLD,
      trend,
      recommendation: 'Attempting automatic cleanup of stale ports',
      timestamp: Date.now()
    });
    
    // Attempt automatic cleanup of stale ports
    _attemptStalePortCleanup();
    return;
  }
  
  // v1.6.3.7-v12 - Issue #10: Check WARN threshold
  if (count >= PORT_REGISTRY_WARN_THRESHOLD) {
    console.warn('[Background] [PORT] PORT_REGISTRY_WARNING:', {
      currentSize: count,
      warnThreshold: PORT_REGISTRY_WARN_THRESHOLD,
      criticalThreshold: PORT_REGISTRY_CRITICAL_THRESHOLD,
      trend,
      recommendation: 'Investigate stale ports - approaching critical threshold',
      timestamp: Date.now()
    });
    return;
  }
  
  // Log health snapshot (only when DEBUG_DIAGNOSTICS is enabled)
  if (DEBUG_DIAGNOSTICS) {
    console.log('[Background] [PORT] PORT_REGISTRY_HEALTH:', {
      currentSize: count,
      thresholdStatus: 'OK',
      trend,
      sizeHistory: [...portRegistrySizeHistory],
      timestamp: Date.now()
    });
  }
}

/**
 * Attempt to clean up stale ports (inactive for 60+ seconds)
 * v1.6.3.7-v12 - Issue #3, #10: Automatic cleanup when critical threshold reached
 * v1.6.3.7-v12 - FIX ESLint: Extracted helpers to reduce complexity (cc=10 → cc=5)
 * @private
 */
function _attemptStalePortCleanup() {
  const STALE_PORT_AGE_MS = 60000; // 60 seconds
  const now = Date.now();
  const beforeCount = portRegistry.size;
  
  const stalePorts = _findStalePorts(now, STALE_PORT_AGE_MS);
  
  _logStalePortCleanupAttempt(beforeCount, stalePorts, STALE_PORT_AGE_MS, now);
  _removeStalePortsFromRegistry(stalePorts);
  _logStalePortCleanupComplete(beforeCount);
}

/**
 * Find all stale ports in the registry
 * v1.6.3.7-v12 - FIX ESLint: Extracted from _attemptStalePortCleanup
 * @private
 */
function _findStalePorts(now, thresholdMs) {
  const stalePorts = [];
  
  for (const [portId, portInfo] of portRegistry.entries()) {
    const stalePortInfo = _checkPortStaleness(portId, portInfo, now, thresholdMs);
    if (stalePortInfo) {
      stalePorts.push(stalePortInfo);
    }
  }
  
  return stalePorts;
}

/**
 * Check if a port is stale and return info if so
 * v1.6.3.7-v12 - FIX ESLint: Extracted from _attemptStalePortCleanup
 * v1.6.3.7-v13 - FIX Issue #4: Use correct property names (lastActivityTime, lastMessageAt)
 *   Bug fix: was using non-existent lastMessageTime property
 * @private
 */
function _checkPortStaleness(portId, portInfo, now, thresholdMs) {
  // v1.6.3.7-v13 - FIX: Use correct property names from port registry
  const createdAt = portInfo.connectedAt || portInfo.createdAt || now;
  const age = now - createdAt;
  const lastActivity = portInfo.lastActivityTime || portInfo.lastMessageAt || createdAt;
  const inactiveTime = now - lastActivity;
  
  if (inactiveTime > thresholdMs) {
    return { portId, age, inactiveTime, type: portInfo.type };
  }
  return null;
}

/**
 * Log stale port cleanup attempt
 * v1.6.3.7-v12 - FIX ESLint: Extracted from _attemptStalePortCleanup
 * @private
 */
function _logStalePortCleanupAttempt(beforeCount, stalePorts, thresholdMs, now) {
  console.log('[Background] [PORT] STALE_PORT_CLEANUP_ATTEMPT:', {
    beforeCount,
    stalePortsFound: stalePorts.length,
    stalePortDetails: stalePorts.slice(0, 5),
    thresholdMs,
    timestamp: now
  });
}

/**
 * Remove stale ports from the registry
 * v1.6.3.7-v12 - FIX ESLint: Extracted from _attemptStalePortCleanup
 * @private
 */
function _removeStalePortsFromRegistry(stalePorts) {
  for (const { portId } of stalePorts) {
    _disconnectAndRemovePort(portId);
  }
}

/**
 * Disconnect and remove a single port from registry
 * v1.6.3.7-v12 - FIX ESLint: Extracted to reduce nesting depth
 * @private
 */
function _disconnectAndRemovePort(portId) {
  try {
    const port = portRegistry.get(portId)?.port;
    if (port) {
      port.disconnect();
    }
    portRegistry.delete(portId);
  } catch (err) {
    console.warn('[Background] [PORT] STALE_PORT_CLEANUP_ERROR:', {
      portId,
      error: err.message
    });
  }
}

/**
 * Log stale port cleanup completion
 * v1.6.3.7-v12 - FIX ESLint: Extracted from _attemptStalePortCleanup
 * @private
 */
function _logStalePortCleanupComplete(beforeCount) {
  const afterCount = portRegistry.size;
  console.log('[Background] [PORT] STALE_PORT_CLEANUP_COMPLETE:', {
    beforeCount,
    afterCount,
    removed: beforeCount - afterCount,
    timestamp: Date.now()
  });
}

/**
 * Start port registry monitoring
 * v1.6.3.7-v12 - Issue #3, #10: Periodic threshold checks
 */
function startPortRegistryMonitoring() {
  if (portRegistryCheckIntervalId) {
    clearInterval(portRegistryCheckIntervalId);
  }
  
  portRegistryCheckIntervalId = setInterval(() => {
    checkPortRegistryThresholds();
  }, PORT_REGISTRY_CHECK_INTERVAL_MS);
  
  console.log('[Background] [PORT] Port registry monitoring started (every', PORT_REGISTRY_CHECK_INTERVAL_MS / 1000, 's)');
}

/**
 * Start dedup statistics logging
 * v1.6.3.7-v12 - Issue #6: Log dedup statistics every 60 seconds
 */
function startDedupStatsLogging() {
  if (dedupStatsIntervalId) {
    clearInterval(dedupStatsIntervalId);
  }
  
  dedupStatsIntervalId = setInterval(() => {
    const total = dedupStats.skipped + dedupStats.processed;
    if (total > 0) {
      console.log('[Background] [STORAGE] DEDUP_STATS:', {
        skipped: dedupStats.skipped,
        processed: dedupStats.processed,
        total,
        skipRate: ((dedupStats.skipped / total) * 100).toFixed(1) + '%',
        intervalMs: DEDUP_STATS_LOG_INTERVAL_MS,
        timestamp: Date.now()
      });
    }
    
    // Reset stats after logging
    dedupStats = {
      skipped: 0,
      processed: 0,
      lastResetTime: Date.now()
    };
  }, DEDUP_STATS_LOG_INTERVAL_MS);
  
  console.log('[Background] [STORAGE] Dedup stats logging started (every', DEDUP_STATS_LOG_INTERVAL_MS / 1000, 's)');
}

// Start port registry monitoring and dedup stats logging on script load
startPortRegistryMonitoring();
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
    () => _validateRuntimeChecksum({
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
function _logValidationFailed({ operationId, errorCode, storageKey, retryAttempt, validationStart, extraInfo = {} }) {
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
function _validateRuntimeChecksum({ operationId, expectedData, readBack, tabCount, retryAttempt, validationStart }) {
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
 * Validate readback data against expected state
 * v1.6.3.7-v13 - Issue #2: Helper to reduce _writeQuickTabStateWithValidation complexity
 * @private
 */
function _validateWriteReadback(stateToWrite, readBack, context) {
  const { operationId, expectedTabs, writeStart } = context;
  
  // Check for null read
  if (!readBack) {
    _logWriteValidationFailure(operationId, 'READ_RETURNED_NULL', {
      expectedTabs, actualTabs: 0, saveId: stateToWrite.saveId,
      durationMs: Date.now() - writeStart
    });
    return { valid: false, failureType: 'READ_RETURNED_NULL' };
  }
  
  // Check saveId
  if (readBack.saveId !== stateToWrite.saveId) {
    _logWriteValidationFailure(operationId, 'SAVEID_MISMATCH', {
      expectedSaveId: stateToWrite.saveId, actualSaveId: readBack.saveId,
      expectedTabs, actualTabs: readBack?.tabs?.length || 0,
      durationMs: Date.now() - writeStart
    });
    return { valid: false, failureType: 'SAVEID_MISMATCH', readBack };
  }
  
  // Check tab count
  const actualTabs = readBack?.tabs?.length || 0;
  if (expectedTabs !== actualTabs) {
    _logWriteValidationFailure(operationId, 'TAB_COUNT_MISMATCH', {
      expectedTabs, actualTabs, difference: expectedTabs - actualTabs,
      saveId: stateToWrite.saveId, durationMs: Date.now() - writeStart
    });
    return { valid: false, failureType: 'TAB_COUNT_MISMATCH' };
  }
  
  // Check checksum
  const expectedChecksum = _computeStorageChecksum(stateToWrite);
  const actualChecksum = _computeStorageChecksum(readBack);
  if (expectedChecksum !== actualChecksum) {
    _logWriteValidationFailure(operationId, 'CHECKSUM_MISMATCH', {
      expectedChecksum, actualChecksum, expectedTabs, actualTabs,
      saveId: stateToWrite.saveId, durationMs: Date.now() - writeStart
    });
    return { valid: false, failureType: 'CHECKSUM_MISMATCH' };
  }
  
  return { valid: true, actualTabs };
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
      operationId, operationName, saveId: stateToWrite.saveId,
      expectedTabs, sequenceId: stateToWrite.sequenceId, timestamp: writeStart
    });
  }
  
  try {
    await browser.storage.local.set({ [storageKey]: stateToWrite });
    const readResult = await browser.storage.local.get(storageKey);
    const readBack = readResult?.[storageKey];
    
    const validation = _validateWriteReadback(stateToWrite, readBack, context);
    
    if (!validation.valid) {
      const recoveryResult = await _attemptStorageWriteRecovery(
        operationId, stateToWrite, validation.failureType, validation.readBack
      );
      return { success: false, operationId, error: validation.failureType, recovered: recoveryResult.recovered };
    }
    
    console.log('[Background] STORAGE_WRITE_VALIDATION:', {
      operationId, result: 'PASSED', saveId: stateToWrite.saveId,
      expectedTabs, actualTabs: validation.actualTabs, checksumMatch: true,
      durationMs: Date.now() - writeStart
    });
    return { success: true, operationId, error: null, recovered: false };
    
  } catch (err) {
    console.error('[Background] STORAGE_WRITE_VALIDATION:', {
      operationId, result: 'ERROR', error: err.message,
      expectedTabs, saveId: stateToWrite.saveId, durationMs: Date.now() - writeStart
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
async function _attemptStorageWriteRecovery(operationId, intendedState, failureType, readBackState = null) {
  console.log('[Background] RECOVERY_ATTEMPT:', {
    operationId,
    failureType,
    intendedTabCount: intendedState?.tabs?.length || 0,
    timestamp: Date.now()
  });
  
  try {
    switch (failureType) {
      case 'READ_RETURNED_NULL':
        // Quota likely exceeded - try clearing oldest Quick Tabs
        return await _recoverFromNullRead(operationId, intendedState);
        
      case 'TAB_COUNT_MISMATCH':
        // Corruption - re-write the entire state
        return await _recoverFromTabCountMismatch(operationId, intendedState);
        
      case 'SAVEID_MISMATCH':
        // Check if this is out-of-order event via sequence ID
        return await _recoverFromSaveIdMismatch(operationId, intendedState, readBackState);
        
      case 'CHECKSUM_MISMATCH':
        // Data corruption - re-write with verification
        return await _recoverFromChecksumMismatch(operationId, intendedState);
        
      default:
        console.warn('[Background] RECOVERY_UNKNOWN_FAILURE_TYPE:', { operationId, failureType });
        return { recovered: false, method: 'none', reason: `Unknown failure type: ${failureType}` };
    }
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
 * @private
 */
async function _recoverFromNullRead(operationId, intendedState) {
  console.log('[Background] RECOVERY_STRATEGY: Clearing oldest Quick Tabs (quota likely exceeded)');
  
  // If not enough tabs to clear, fail early
  if (!intendedState?.tabs?.length || intendedState.tabs.length <= 1) {
    return _logRecoveryFailure(operationId, 'READ_RETURNED_NULL', 'storage quota may be exhausted');
  }
  
  // Sort by creationTime and remove oldest tabs (keep RECOVERY_KEEP_PERCENTAGE)
  const sortedTabs = [...intendedState.tabs].sort((a, b) => 
    (a.creationTime || 0) - (b.creationTime || 0)
  );
  
  const keepCount = Math.max(1, Math.floor(sortedTabs.length * RECOVERY_KEEP_PERCENTAGE));
  const reducedTabs = sortedTabs.slice(-keepCount); // Keep newest tabs
  
  const recoverySaveId = `recovery-null-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const recoveryState = {
    ...intendedState,
    tabs: reducedTabs,
    saveId: recoverySaveId,
    recoveredFrom: 'READ_RETURNED_NULL',
    recoveryTimestamp: Date.now()
  };
  
  const writeResult = await _tryRecoveryWrite(operationId, recoveryState, recoverySaveId);
  if (!writeResult.success) {
    return _logRecoveryFailure(operationId, 'READ_RETURNED_NULL', 'storage quota may be exhausted');
  }
  
  console.log('[Background] RECOVERY_SUCCESS:', {
    operationId,
    method: 'clear-oldest-tabs',
    originalTabCount: intendedState.tabs.length,
    newTabCount: reducedTabs.length,
    removedCount: intendedState.tabs.length - reducedTabs.length,
    timestamp: Date.now()
  });
  return { recovered: true, method: 'clear-oldest-tabs', reason: 'Cleared oldest 25% of tabs' };
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
 * Recover from tab count mismatch (corruption)
 * v1.6.3.7-v13 - Issue #7: Re-write state with verification
 * @private
 */
async function _recoverFromTabCountMismatch(operationId, intendedState) {
  console.log('[Background] RECOVERY_STRATEGY: Re-writing state (tab count mismatch corruption)');
  
  const recoverySaveId = `recovery-count-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const recoveryState = {
    ...intendedState,
    saveId: recoverySaveId,
    sequenceId: _getNextStorageSequenceId(),
    recoveredFrom: 'TAB_COUNT_MISMATCH',
    recoveryTimestamp: Date.now()
  };
  
  const writeResult = await _tryRecoveryWriteWithTabCount(operationId, recoveryState, recoverySaveId, intendedState?.tabs?.length);
  if (!writeResult.success) {
    return _logRecoveryFailure(operationId, 'TAB_COUNT_MISMATCH', 'state corruption persists - recommend clearing storage');
  }
  
  console.log('[Background] RECOVERY_SUCCESS:', {
    operationId, method: 're-write', tabCount: writeResult.tabCount,
    recoverySaveId, timestamp: Date.now()
  });
  return { recovered: true, method: 're-write', reason: 'Successfully re-wrote state' };
}

/**
 * Try a recovery write and verify with tab count check
 * v1.6.3.7-v13 - Issue #7: Helper for tab count mismatch recovery
 * @private
 */
async function _tryRecoveryWriteWithTabCount(operationId, recoveryState, expectedSaveId, expectedTabCount) {
  try {
    await browser.storage.local.set({ quick_tabs_state_v2: recoveryState });
    const verifyResult = await browser.storage.local.get('quick_tabs_state_v2');
    const verifyData = verifyResult?.quick_tabs_state_v2;
    const success = verifyData?.saveId === expectedSaveId && verifyData?.tabs?.length === expectedTabCount;
    return { success, tabCount: verifyData?.tabs?.length || 0 };
  } catch (err) {
    console.error('[Background] RECOVERY_RETRY_FAILED:', { operationId, error: err.message });
    return { success: false };
  }
}

/**
 * Recover from saveId mismatch (check sequence ID ordering)
 * v1.6.3.7-v13 - Issue #7: Verify sequence ID ordering
 * @private
 */
async function _recoverFromSaveIdMismatch(operationId, intendedState, readBackState) {
  console.log('[Background] RECOVERY_STRATEGY: Checking sequence ID ordering (saveId mismatch)');
  
  const intendedSeqId = intendedState?.sequenceId;
  const actualSeqId = readBackState?.sequenceId;
  
  // If both have sequence IDs, check ordering
  if (typeof intendedSeqId === 'number' && typeof actualSeqId === 'number' && actualSeqId > intendedSeqId) {
    console.log('[Background] RECOVERY_OUT_OF_ORDER_EVENT:', {
      operationId, intendedSequenceId: intendedSeqId, actualSequenceId: actualSeqId,
      explanation: 'Storage contains newer write - our write was superseded, no recovery needed',
      timestamp: Date.now()
    });
    return { recovered: true, method: 'sequence-superseded', reason: 'Storage has newer sequence ID - no action needed' };
  }
  
  // Log out-of-order if applicable
  if (typeof intendedSeqId === 'number' && typeof actualSeqId === 'number') {
    console.log('[Background] OUT_OF_ORDER_EVENTS: Older sequence fired after newer', {
      intendedSequenceId: intendedSeqId, actualSequenceId: actualSeqId, operationId
    });
  }
  
  // Try re-writing with force
  const recoverySaveId = `recovery-saveid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const recoveryState = {
    ...intendedState,
    saveId: recoverySaveId,
    sequenceId: _getNextStorageSequenceId(),
    recoveredFrom: 'SAVEID_MISMATCH',
    recoveryTimestamp: Date.now()
  };
  
  const writeResult = await _tryRecoveryWrite(operationId, recoveryState, recoverySaveId);
  if (!writeResult.success) {
    return _logRecoveryFailure(operationId, 'SAVEID_MISMATCH', 'concurrent writes may be blocking');
  }
  
  console.log('[Background] RECOVERY_SUCCESS:', {
    operationId, method: 're-write-force', recoverySaveId, timestamp: Date.now()
  });
  return { recovered: true, method: 're-write-force', reason: 'Forced re-write with new saveId' };
}

/**
 * Recover from checksum mismatch (data corruption)
 * v1.6.3.7-v13 - Issue #7: Re-write with verification
 * @private
 */
async function _recoverFromChecksumMismatch(operationId, intendedState) {
  console.log('[Background] RECOVERY_STRATEGY: Re-writing state (checksum mismatch corruption)');
  
  const recoverySaveId = `recovery-checksum-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const recoveryState = {
    ...intendedState,
    saveId: recoverySaveId,
    sequenceId: _getNextStorageSequenceId(),
    recoveredFrom: 'CHECKSUM_MISMATCH',
    recoveryTimestamp: Date.now()
  };
  
  const writeResult = await _tryRecoveryWriteWithChecksum(operationId, recoveryState, recoverySaveId);
  if (!writeResult.success) {
    return _logRecoveryFailure(operationId, 'CHECKSUM_MISMATCH', 'persistent data corruption - recommend clearing storage');
  }
  
  console.log('[Background] RECOVERY_SUCCESS:', {
    operationId, method: 're-write-verified', tabCount: writeResult.tabCount,
    checksumVerified: true, timestamp: Date.now()
  });
  return { recovered: true, method: 're-write-verified', reason: 'Successfully re-wrote state with checksum verification' };
}

/**
 * Try a recovery write and verify with checksum check
 * v1.6.3.7-v13 - Issue #7: Helper for checksum mismatch recovery
 * @private
 */
async function _tryRecoveryWriteWithChecksum(operationId, recoveryState, expectedSaveId) {
  try {
    await browser.storage.local.set({ quick_tabs_state_v2: recoveryState });
    const verifyResult = await browser.storage.local.get('quick_tabs_state_v2');
    const verifyData = verifyResult?.quick_tabs_state_v2;
    const expectedChecksum = _computeStorageChecksum(recoveryState);
    const actualChecksum = _computeStorageChecksum(verifyData);
    const success = verifyData?.saveId === expectedSaveId && expectedChecksum === actualChecksum;
    return { success, tabCount: verifyData?.tabs?.length || 0 };
  } catch (err) {
    console.error('[Background] RECOVERY_RETRY_FAILED:', { operationId, error: err.message });
    return { success: false };
  }
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
    const result = await _tryWriteAttempt({ stateToWrite, storageKey, operationId, attempt, writeStart });
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
    console.error('[Background] STORAGE_WRITE_ERROR:', { operationId, attempt, error: err.message });
  }
  
  // Wait before next retry
  await new Promise(resolve => setTimeout(resolve, STORAGE_VALIDATION_RETRY_DELAY_MS * (attempt + 1)));
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
 * @private
 */
async function _writeRecoveredState(operationId, backup) {
  const recoveredState = {
    tabs: backup.tabs,
    saveId: `recovered-${operationId}`,
    sequenceId: _getNextStorageSequenceId(),
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
    console.error('[Background] STORAGE_INTEGRITY_CHECK_ERROR:', { operationId, error: err.message });
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
    
    const mismatchResult = _detectChecksumMismatch(localChecksum, syncChecksum, localTabCount, syncTabCount);
    
    if (!mismatchResult.hasMismatch) {
      return noMismatchResult;
    }
    
    return await _handleChecksumMismatch({
      operationId, localChecksum, syncChecksum, localTabCount, syncTabCount, mismatchResult, localState
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
  const checksumMismatch = localChecksum !== 'empty' && syncChecksum !== 'empty' && localChecksum !== syncChecksum;
  
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
async function _handleChecksumMismatch({ operationId, localChecksum, syncChecksum, localTabCount, syncTabCount, mismatchResult, localState }) {
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
    console.log('[Background] STORAGE_INTEGRITY_RECOVERY: Restoring from sync backup (more complete)');
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

/**
 * Valid URL protocols for Quick Tab creation
 * @private
 */
const VALID_QUICKTAB_PROTOCOLS = ['http://', 'https://', 'moz-extension://', 'chrome-extension://'];

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
 * Check if URL starts with a valid protocol
 * @private
 * @param {string} urlStr - URL string to check
 * @returns {boolean} True if URL has valid protocol
 */
function _hasValidProtocol(urlStr) {
  return VALID_QUICKTAB_PROTOCOLS.some(proto => urlStr.startsWith(proto));
}

/**
 * Check if a URL is valid for Quick Tab creation
 * v1.6.3.4-v6 - FIX Issue #2: Filter corrupted tabs before broadcast
 * v1.6.4.8 - Refactored: Extracted helpers to reduce complex conditionals
 * @param {*} url - URL to validate
 * @returns {boolean} True if URL is valid
 */
function isValidQuickTabUrl(url) {
  if (_isUrlNullOrEmpty(url)) return false;
  if (_isUrlCorruptedWithUndefined(url)) return false;
  return _hasValidProtocol(String(url));
}

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
    console.error('[Background] v1.6.3.6-v12 Max retries exceeded - marking as initialized with empty state');
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
 *
 * @returns {Promise<void>}
 */
async function saveMigratedToUnifiedFormat() {
  const saveId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const sequenceId = _getNextStorageSequenceId();

  try {
    await browser.storage.local.set({
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        saveId: saveId,
        sequenceId,
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
 *
 * @returns {Promise<void>}
 */
async function saveMigratedQuickTabState() {
  console.log('[Background Migration] Saving migrated Quick Tab state');

  const stateToSave = {
    tabs: globalQuickTabState.tabs,
    saveId: `migration-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sequenceId: _getNextStorageSequenceId(),
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
// Firefox Manifest V3 - Supports blocking webRequest
// This allows Quick Tabs to load any website, bypassing clickjacking protection
// Security Note: This removes X-Frame-Options and CSP frame-ancestors headers
// which normally prevent websites from being embedded in iframes. This makes
// the extension potentially vulnerable to clickjacking attacks if a malicious
// website tricks the user into clicking on a Quick Tab overlay. Use with caution.

console.log('[Quick Tabs] Initializing Firefox MV3 X-Frame-Options bypass...');

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

console.log('[Quick Tabs] ✓ Firefox MV3 X-Frame-Options bypass installed');

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
  const stateToSave = {
    tabs: globalQuickTabState.tabs,
    saveId: `cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sequenceId: _getNextStorageSequenceId(),
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
function _createSkipResult(method, reason, logDetails = {}) {
  // v1.6.3.7-v12 - Issue #6: Track skipped count
  dedupStats.skipped++;
  
  const result = { shouldSkip: true, method, reason };
  
  // v1.6.3.7-v12 - Issue #6: Always log dedup decisions regardless of DEBUG_MESSAGING
  console.log('[Background] [STORAGE] DEDUP_DECISION:', {
    ...result,
    decision: 'skip',
    dedupStatsSnapshot: {
      skipped: dedupStats.skipped,
      processed: dedupStats.processed,
      total: dedupStats.skipped + dedupStats.processed
    },
    ...logDetails,
    timestamp: Date.now()
  });
  return result;
}

/**
 * Create a dedup result indicating the change should be processed
 * v1.6.4.13 - FIX Complexity: Extracted to reduce _multiMethodDeduplication cc
 * v1.6.3.7-v12 - Issue #6: Track dedup statistics and log all decisions
 * v1.6.3.7-v13 - Issue #8: Add optional logDetails parameter for context
 * @private
 * @param {Object} logDetails - Optional details for logging (saveId, sequenceId, etc.)
 * @returns {{ shouldSkip: boolean, method: string, reason: string }}
 */
function _createProcessResult(logDetails = {}) {
  // v1.6.3.7-v12 - Issue #6: Track processed count
  dedupStats.processed++;
  
  const result = { shouldSkip: false, method: 'none', reason: 'Legitimate change' };
  
  // v1.6.3.7-v12 - Issue #6: Always log dedup decisions regardless of DEBUG_MESSAGING
  // v1.6.3.7-v13 - Issue #8: Include context details for better debugging
  console.log('[Background] [STORAGE] DEDUP_DECISION:', {
    ...result,
    decision: 'process',
    dedupStatsSnapshot: {
      skipped: dedupStats.skipped,
      processed: dedupStats.processed,
      total: dedupStats.skipped + dedupStats.processed
    },
    ...logDetails,
    timestamp: Date.now()
  });
  return result;
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
function _multiMethodDeduplication(newValue, oldValue) {
  // v1.6.3.7-v9 - FIX Issue #3: Log dedup check start with comparison values
  console.log('[Background] [STORAGE] DEDUP_CHECK:', _buildDedupLogDetails(newValue, oldValue));

  // v1.6.3.7-v12 - Issue #9: Method 0 (PRIMARY) - Sequence ID ordering
  // Sequence IDs are assigned at write time and provide stronger ordering guarantees
  // than timestamp-based windows because Firefox's storage.onChanged events can fire
  // out of order due to async listener processing
  const sequenceResult = _checkSequenceIdOrdering(newValue, oldValue);
  if (sequenceResult.shouldSkip) {
    return _createSkipResult('sequenceId', sequenceResult.reason, {
      newSequenceId: newValue?.sequenceId,
      oldSequenceId: oldValue?.sequenceId,
      explanation: 'Sequence ID ordering: events with lower or equal sequenceId than already-processed events are duplicates'
    });
  }

  // v1.6.3.7-v9 - FIX Issue #3: Method 1 (SECONDARY) - saveId + timestamp comparison
  // Fallback for writes without sequenceId (legacy or external)
  if (_isSaveIdTimestampDuplicate(newValue, oldValue)) {
    return _createSkipResult('saveId+timestamp', 'Same saveId and timestamp within window', {
      comparison: _buildSaveIdComparisonDetails(newValue, oldValue),
      note: 'Fallback method - new writes should use sequenceId'
    });
  }

  // v1.6.3.7-v9 - FIX Issue #3: Method 2 (TERTIARY) - Content hash comparison
  if (_isContentHashDuplicate(newValue, oldValue)) {
    return _createSkipResult('contentHash', 'Identical content (tertiary safeguard for no-saveId messages)', {
      hasSaveId: !!newValue?.saveId
    });
  }

  // v1.6.3.7-v13 - Issue #8: Pass context to _createProcessResult for debugging
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
function _checkSequenceIdOrdering(newValue, oldValue) {
  const newSeqId = newValue?.sequenceId;
  const oldSeqId = oldValue?.sequenceId;
  
  // Can't use sequence ordering if either lacks sequenceId
  if (typeof newSeqId !== 'number' || typeof oldSeqId !== 'number') {
    if (DEBUG_DIAGNOSTICS) {
      console.log('[Background] [STORAGE] SEQUENCE_ID_CHECK: Missing sequenceId, falling back to other methods', {
        hasNewSeqId: typeof newSeqId === 'number',
        hasOldSeqId: typeof oldSeqId === 'number'
      });
    }
    return { shouldSkip: false, reason: 'No sequenceId available' };
  }
  
  // If new event has same or lower sequence ID, it's a duplicate or out-of-order event
  if (newSeqId <= oldSeqId) {
    // v1.6.3.7-v13 - Issue #3: Log out-of-order events for diagnostics
    const isOutOfOrder = newSeqId < oldSeqId;
    if (isOutOfOrder) {
      console.log('[Background] [STORAGE] OUT_OF_ORDER_EVENTS: Older sequence fired after newer sequence', {
        olderSequenceId: newSeqId,
        newerSequenceId: oldSeqId,
        explanation: 'Firefox storage.onChanged events can fire in any order - this older write arrived late'
      });
    }
    
    console.log('[Background] [STORAGE] SEQUENCE_ID_SKIP: Old or duplicate event detected', {
      newSequenceId: newSeqId,
      oldSequenceId: oldSeqId,
      isDuplicate: newSeqId === oldSeqId,
      isOutOfOrder
    });
    return { 
      shouldSkip: true, 
      reason: newSeqId === oldSeqId 
        ? 'Same sequenceId (duplicate event)' 
        : 'Lower sequenceId (out-of-order event from older write)'
    };
  }
  
  // New event has higher sequence ID - this is the expected case
  if (DEBUG_DIAGNOSTICS) {
    console.log('[Background] [STORAGE] SEQUENCE_ID_PASS: Valid new event', {
      newSequenceId: newSeqId,
      oldSequenceId: oldSeqId,
      increment: newSeqId - oldSeqId
    });
  }
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
  const mode = (!newHasSaveId || !oldHasSaveId) ? 'secondary-no-saveId' : 'firefox-spurious';
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
 * @param {Object} newValue - New storage value
 */
function _processStorageUpdate(newValue) {
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
  // v1.6.4.13 - FIX Issue #1 & #2: ALSO broadcast to BroadcastChannel for Manager updates
  console.log('[Background] [STORAGE] STATE_CHANGE_DETECTED:', {
    tabCount: filteredValue.tabs?.length || 0,
    saveId: filteredValue.saveId,
    timestamp: Date.now()
  });
  _updateGlobalStateFromStorage(filteredValue);

  // v1.6.4.13 - FIX Issue #1 & #2: Broadcast state change via BroadcastChannel (Tier 1)
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

// ==================== v1.6.3.6-v11 PORT LIFECYCLE MANAGEMENT ====================
// FIX Issue #11: Persistent port connections to keep background script alive
// FIX Issue #12: Port lifecycle logging

/**
 * Port registry for tracking connected ports
 * v1.6.3.6-v11 - FIX Issue #11: Persistent port connections
 * Structure: portId -> { port, origin, tabId, type, connectedAt, lastMessageAt, messageCount }
 */
const portRegistry = new Map();

/**
 * Port ID counter for unique identification
 * v1.6.3.6-v11 - FIX Issue #12: Track port IDs
 */
let portIdCounter = 0;

/**
 * Port cleanup interval (5 minutes)
 * v1.6.3.6-v11 - FIX Issue #17: Periodic cleanup
 */
const PORT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Port inactivity threshold for logging warnings (10 minutes)
 * v1.6.3.6-v11 - FIX Issue #17: Inactivity monitoring
 */
const PORT_INACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;

// ==================== v1.6.3.7-v9 PORT AGE THRESHOLDS (Issue #4) ====================
// Maximum age and inactivity thresholds for port cleanup

/**
 * Maximum port lifetime (90 seconds)
 * v1.6.3.7-v9 - Issue #4: Ports older than this are removed regardless of activity
 */
const PORT_MAX_AGE_MS = 90 * 1000;

/**
 * Port inactivity timeout for stale marking (30 seconds)
 * v1.6.3.7-v9 - Issue #4: Ports with no messages for this duration are marked stale
 */
const PORT_STALE_TIMEOUT_MS = 30 * 1000;

// ==================== v1.6.3.7-v9 PORT MESSAGE SEQUENCING (Issue #9) ====================
// Monotonic sequence counter for port messages to detect reordering

/**
 * Monotonic sequence counter for outgoing port messages
 * v1.6.3.7-v9 - Issue #9: Detect message reordering
 */
let portMessageSequenceCounter = 0;

/**
 * Map of expected sequence numbers per port
 * v1.6.3.7-v9 - Issue #9: Track expected sequence per port connection
 * Key: portId, Value: { lastReceivedSeq: number, reorderBuffer: Map<seq, message> }
 */
const portSequenceTracking = new Map();

/**
 * Maximum reorder buffer size before forced flush
 * v1.6.3.7-v9 - Issue #9: Prevent unbounded buffer growth
 */
const MAX_REORDER_BUFFER_SIZE = 10;

/**
 * Get next message sequence number for port messages
 * v1.6.3.7-v9 - Issue #9: Generate monotonically increasing sequence
 * @returns {number} Next sequence number
 */
function _getNextPortMessageSequence() {
  portMessageSequenceCounter++;
  return portMessageSequenceCounter;
}

// v1.6.3.7-v10 - FIX Issue #9: Timeout for stuck queue messages (1 second)
// v1.6.3.7-v10 - FIX Code Review: Different timeouts for different scenarios:
//   - PORT_MESSAGE_QUEUE_TIMEOUT_MS (1s): Port messages need faster recovery since ports
//     are synchronous and in-order within a single connection
//   - STORAGE_WATCHDOG_TIMEOUT_MS (2s in manager): Storage events can be delayed by browser's
//     storage API and need more time before triggering fallback
const PORT_MESSAGE_QUEUE_TIMEOUT_MS = 1000;

/**
 * Map of buffer timeout timers per port
 * v1.6.3.7-v10 - FIX Issue #9: Track timeout timers for message reordering fallback
 * Key: portId, Value: timerId
 */
const portBufferTimeouts = new Map();

/**
 * Initialize sequence tracking for a new port
 * v1.6.3.7-v9 - Issue #9: Set up tracking when port connects
 * v1.6.3.7-v10 - FIX Issue #9: Added lastProcessedPortMessageSequence tracking
 * @param {string} portId - Port ID to track
 */
function _initPortSequenceTracking(portId) {
  portSequenceTracking.set(portId, {
    lastReceivedSeq: 0,
    lastProcessedPortMessageSequence: 0, // v1.6.3.7-v10 - FIX Issue #9: Track last processed sequence
    reorderBuffer: new Map()
  });
  console.log('[Background] PORT_SEQUENCE_TRACKING_INIT:', { portId, timestamp: Date.now() });
}

/**
 * Clean up sequence tracking for disconnected port
 * v1.6.3.7-v9 - Issue #9: Remove tracking when port disconnects
 * v1.6.3.7-v10 - FIX Issue #9: Also clear buffer timeout
 * @param {string} portId - Port ID to clean up
 */
function _cleanupPortSequenceTracking(portId) {
  // v1.6.3.7-v10 - FIX Issue #9: Clear any pending buffer timeout
  const timerId = portBufferTimeouts.get(portId);
  if (timerId) {
    clearTimeout(timerId);
    portBufferTimeouts.delete(portId);
  }
  portSequenceTracking.delete(portId);
  console.log('[Background] PORT_SEQUENCE_TRACKING_CLEANUP:', { portId, timestamp: Date.now() });
}

/**
 * Start a timeout for stuck port message queue
 * v1.6.3.7-v10 - FIX Issue #9: Process out-of-order messages after timeout
 * @private
 * @param {string} portId - Port ID
 */
function _startPortBufferTimeout(portId) {
  // Clear existing timeout if any
  _clearPortBufferTimeout(portId);

  const timerId = setTimeout(() => {
    const tracking = portSequenceTracking.get(portId);
    if (!tracking || tracking.reorderBuffer.size === 0) {
      portBufferTimeouts.delete(portId);
      return;
    }

    console.warn('[Background] PORT_MESSAGE_TIMEOUT:', {
      portId,
      bufferSize: tracking.reorderBuffer.size,
      timeoutMs: PORT_MESSAGE_QUEUE_TIMEOUT_MS,
      timestamp: Date.now()
    });

    // Force process all buffered messages in sequence order
    _forceProcessBufferedMessagesAfterTimeout(portId, tracking);
    portBufferTimeouts.delete(portId);
  }, PORT_MESSAGE_QUEUE_TIMEOUT_MS);

  portBufferTimeouts.set(portId, timerId);
}

/**
 * Clear port buffer timeout
 * v1.6.3.7-v10 - FIX Issue #9: Helper to clear timeout
 * @private
 * @param {string} portId - Port ID
 */
function _clearPortBufferTimeout(portId) {
  const timerId = portBufferTimeouts.get(portId);
  if (timerId) {
    clearTimeout(timerId);
    portBufferTimeouts.delete(portId);
  }
}

/**
 * Force process all buffered messages after timeout expires
 * v1.6.3.7-v10 - FIX Issue #9: Fallback to process out-of-order
 * @private
 * @param {string} portId - Port ID
 * @param {Object} tracking - Sequence tracking object
 */
async function _forceProcessBufferedMessagesAfterTimeout(portId, tracking) {
  if (!tracking.reorderBuffer || tracking.reorderBuffer.size === 0) {
    return;
  }

  // Get sorted sequence numbers and process all
  const sequences = Array.from(tracking.reorderBuffer.keys()).sort((a, b) => a - b);
  const portInfo = portRegistry.get(portId);
  let processedCount = 0;

  for (const seq of sequences) {
    const message = tracking.reorderBuffer.get(seq);
    if (!message) continue;

    tracking.reorderBuffer.delete(seq);
    tracking.lastReceivedSeq = Math.max(tracking.lastReceivedSeq, seq);
    processedCount++;

    console.log('[Background] PORT_MESSAGE_DEQUEUED:', {
      portId,
      messageSequence: seq,
      reason: 'timeout',
      remainingBuffered: tracking.reorderBuffer.size,
      timestamp: Date.now()
    });

    // Route the message
    try {
      await routePortMessage(message, portInfo);
    } catch (err) {
      console.error('[Background] Error processing timeout-dequeued message:', {
        portId,
        messageSequence: seq,
        error: err.message
      });
    }
  }

  console.log('[Background] PORT_BUFFER_TIMEOUT_FLUSH_COMPLETE:', {
    portId,
    processedCount,
    newLastReceivedSeq: tracking.lastReceivedSeq,
    timestamp: Date.now()
  });
}

/**
 * Generate unique port ID
 * v1.6.3.6-v11 - FIX Issue #12: Port identification
 * @returns {string} Unique port ID
 */
function generatePortId() {
  portIdCounter++;
  return `port-${Date.now()}-${portIdCounter}`;
}

/**
 * Log port lifecycle event
 * v1.6.3.6-v11 - FIX Issue #12: Comprehensive port logging
 * v1.6.3.7-v7 - FIX Issue #8: Use [PORT] prefix for unified logging
 * @param {string} origin - Origin of the port (sidebar, content-tab-X)
 * @param {string} event - Event type (open, close, disconnect, error, message)
 * @param {Object} details - Event details
 */
function logPortLifecycle(origin, event, details = {}) {
  console.log(`[Background] [PORT] PORT_LIFECYCLE [${origin}] [${event}]:`, {
    tabId: details.tabId,
    portId: details.portId,
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Register a new port connection
 * v1.6.3.6-v11 - FIX Issue #11: Track connected ports
 * v1.6.4.13: Converted to options object pattern
 * @param {Object} options - Registration options
 * @param {browser.runtime.Port} options.port - The connected port
 * @param {string} options.origin - Origin identifier
 * @param {number|null} options.tabId - Tab ID (if from content script)
 * @param {string} options.type - Port type ('sidebar' or 'content')
 * @param {number|null} [options.windowId=null] - Window ID for sidebar ports (v1.6.3.7-v9)
 * @returns {string} Generated port ID
 */
function registerPort({ port, origin, tabId, type, windowId = null }) {
  const portId = generatePortId();
  const beforeCount = portRegistry.size;
  const now = Date.now();
  const resolvedWindowId = windowId || port.sender?.tab?.windowId || null;

  portRegistry.set(portId, {
    port,
    origin,
    tabId,
    type,
    // v1.6.3.7-v9 - Issue #4: Enhanced metadata tracking
    windowId: resolvedWindowId,
    connectedAt: now,
    lastMessageAt: null,
    lastActivityTime: now, // v1.6.3.7-v9: Tracks both sent and received
    messageCount: 0
  });

  // v1.6.3.7-v9 - Issue #9: Initialize sequence tracking for this port
  _initPortSequenceTracking(portId);

  // v1.6.4.9 - Issue #6: Enhanced PORT_REGISTERED logging
  console.log('[Background] PORT_REGISTERED:', {
    portId,
    origin,
    tabId,
    type,
    windowId: resolvedWindowId, // v1.6.3.7-v9
    registrySize: portRegistry.size,
    previousSize: beforeCount
  });

  // v1.6.4.9 - Issue #6: Warn if registry size exceeds thresholds
  _checkPortRegistrySizeWarnings();

  logPortLifecycle(origin, 'open', { tabId, portId, type, totalPorts: portRegistry.size });

  return portId;
}

/**
 * Check port registry size and log warnings if thresholds exceeded
 * v1.6.4.9 - Issue #6: Port registry size monitoring
 * @private
 */
function _checkPortRegistrySizeWarnings() {
  const size = portRegistry.size;
  if (size >= PORT_REGISTRY_CRITICAL_THRESHOLD) {
    console.error('[Background] PORT_REGISTRY_CRITICAL:', {
      size,
      threshold: PORT_REGISTRY_CRITICAL_THRESHOLD,
      message: 'Port registry exceeds critical threshold - possible memory leak'
    });
  } else if (size >= PORT_REGISTRY_WARN_THRESHOLD) {
    console.warn('[Background] PORT_REGISTRY_WARNING:', {
      size,
      threshold: PORT_REGISTRY_WARN_THRESHOLD,
      message: 'Port registry exceeds warning threshold'
    });
  }
}

/**
 * Unregister a port connection
 * v1.6.3.6-v11 - FIX Issue #11: Clean up disconnected ports
 * v1.6.4.9 - Issue #6: Enhanced PORT_UNREGISTERED logging
 * v1.6.3.7-v9 - Issue #9: Clean up sequence tracking
 * @param {string} portId - Port ID to unregister
 * @param {string} reason - Reason for disconnect
 */
function unregisterPort(portId, reason = 'disconnect') {
  const portInfo = portRegistry.get(portId);
  const beforeCount = portRegistry.size;

  if (portInfo) {
    // v1.6.4.9 - Issue #6: Enhanced PORT_UNREGISTERED logging
    console.log('[Background] PORT_UNREGISTERED:', {
      portId,
      origin: portInfo.origin,
      tabId: portInfo.tabId,
      windowId: portInfo.windowId, // v1.6.3.7-v9
      reason,
      messageCount: portInfo.messageCount,
      duration: Date.now() - portInfo.connectedAt,
      registrySizeBefore: beforeCount,
      registrySizeAfter: beforeCount - 1
    });

    logPortLifecycle(portInfo.origin, 'close', {
      tabId: portInfo.tabId,
      portId,
      reason,
      messageCount: portInfo.messageCount,
      duration: Date.now() - portInfo.connectedAt
    });
    portRegistry.delete(portId);
    
    // v1.6.3.7-v9 - Issue #9: Clean up sequence tracking
    _cleanupPortSequenceTracking(portId);
  }
}

/**
 * Update port activity timestamp
 * v1.6.3.6-v11 - FIX Issue #12: Track port activity
 * v1.6.3.7-v9 - Issue #4: Update lastActivityTime
 * @param {string} portId - Port ID
 */
function updatePortActivity(portId) {
  const portInfo = portRegistry.get(portId);
  if (portInfo) {
    const now = Date.now();
    portInfo.lastMessageAt = now;
    portInfo.lastActivityTime = now; // v1.6.3.7-v9
    portInfo.messageCount++;
  }
}

/**
 * Check if a port's tab still exists
 * v1.6.3.6-v11 - FIX Issue #17: Helper to reduce nesting in cleanupStalePorts
 * @param {Object} portInfo - Port info object
 * @returns {Promise<boolean>} True if tab exists or port is not content type
 */
async function _checkPortTabExists(portInfo) {
  if (portInfo.type !== 'content' || !portInfo.tabId) {
    return true;
  }

  try {
    await browser.tabs.get(portInfo.tabId);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Check if a port is inactive (for logging purposes)
 * v1.6.3.6-v11 - FIX Issue #17: Helper to reduce nesting
 * @param {Object} portInfo - Port info object
 * @param {number} now - Current timestamp
 * @param {string} portId - Port ID
 */
function _checkPortInactivity(portInfo, now, portId) {
  const lastActivity = portInfo.lastActivityTime || portInfo.lastMessageAt || portInfo.connectedAt;
  if (now - lastActivity > PORT_INACTIVITY_THRESHOLD_MS) {
    console.warn('[Background] PORT_CLEANUP: Port has been inactive:', {
      portId,
      origin: portInfo.origin,
      tabId: portInfo.tabId,
      windowId: portInfo.windowId, // v1.6.3.7-v9
      inactiveMs: now - lastActivity
    });
  }
}

/**
 * Check if port exceeds maximum age threshold
 * v1.6.3.7-v9 - Issue #4: Age-based cleanup
 * @private
 * @param {Object} portInfo - Port info object
 * @param {number} now - Current timestamp
 * @param {string} portId - Port ID for logging
 * @returns {boolean} True if port exceeds max age
 */
function _isPortTooOld(portInfo, now, portId) {
  const age = now - portInfo.connectedAt;
  if (age > PORT_MAX_AGE_MS) {
    console.warn('[Background] [PORT] PORT_MAX_AGE_EXCEEDED:', {
      portId,
      origin: portInfo.origin,
      ageMs: age,
      maxAgeMs: PORT_MAX_AGE_MS,
      windowId: portInfo.windowId
    });
    return true;
  }
  return false;
}

/**
 * Check if port is stale (no activity for timeout period)
 * v1.6.3.7-v9 - Issue #4: Inactivity-based cleanup
 * @private
 * @param {Object} portInfo - Port info object
 * @param {number} now - Current timestamp
 * @param {string} portId - Port ID for logging
 * @returns {boolean} True if port is stale
 */
function _isPortStale(portInfo, now, portId) {
  const lastActivity = portInfo.lastActivityTime || portInfo.lastMessageAt || portInfo.connectedAt;
  const inactivityMs = now - lastActivity;
  
  if (inactivityMs > PORT_STALE_TIMEOUT_MS) {
    console.warn('[Background] [PORT] PORT_STALE_DETECTED:', {
      portId,
      origin: portInfo.origin,
      inactivityMs,
      staleTimeoutMs: PORT_STALE_TIMEOUT_MS,
      windowId: portInfo.windowId,
      messageCount: portInfo.messageCount
    });
    return true;
  }
  return false;
}

/**
 * Clean up stale ports (e.g., from closed tabs)
 * v1.6.3.6-v11 - FIX Issue #17: Periodic cleanup every 5 minutes
 * v1.6.4.9 - Issue #6: Enhanced PORT_CLEANUP logging with before/after counts
 * v1.6.3.7-v9 - Issue #4: Added age-based and inactivity-based cleanup
 */
async function cleanupStalePorts() {
  const beforeCount = portRegistry.size;

  // v1.6.4.9 - Issue #6: Log cleanup start
  console.log('[Background] PORT_CLEANUP_START:', {
    currentRegistrySize: beforeCount,
    maxAgeMs: PORT_MAX_AGE_MS,
    staleTimeoutMs: PORT_STALE_TIMEOUT_MS,
    timestamp: Date.now()
  });

  const now = Date.now();
  const stalePorts = [];

  for (const [portId, portInfo] of portRegistry.entries()) {
    // v1.6.3.7-v9 - Issue #4: Check max age first (hard limit)
    if (_isPortTooOld(portInfo, now, portId)) {
      stalePorts.push({ portId, reason: 'max-age-exceeded' });
      continue;
    }

    // Check if tab still exists
    const tabExists = await _checkPortTabExists(portInfo);
    if (!tabExists) {
      stalePorts.push({ portId, reason: 'tab-closed' });
      continue;
    }

    // v1.6.3.7-v9 - Issue #4: Check inactivity (30s stale timeout)
    if (_isPortStale(portInfo, now, portId)) {
      stalePorts.push({ portId, reason: 'stale-inactivity' });
      continue;
    }

    // Original inactivity check (logging only, 10 min threshold)
    _checkPortInactivity(portInfo, now, portId);
  }

  // Remove stale ports
  for (const { portId, reason } of stalePorts) {
    unregisterPort(portId, reason);
  }

  const afterCount = portRegistry.size;

  // v1.6.4.9 - Issue #6: Enhanced PORT_CLEANUP_COMPLETE logging
  // v1.6.3.7-v9 - Issue #4: Enhanced with reason breakdown
  const reasonCounts = {};
  for (const { reason } of stalePorts) {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  console.log('[Background] PORT_CLEANUP_COMPLETE:', {
    beforeCount,
    afterCount,
    removedCount: stalePorts.length,
    reasonBreakdown: reasonCounts, // v1.6.3.7-v9
    removedPorts: stalePorts.map(p => ({ id: p.portId, reason: p.reason })),
    timestamp: Date.now()
  });
}

// Start periodic cleanup
setInterval(cleanupStalePorts, PORT_CLEANUP_INTERVAL_MS);

/**
 * Parse port name to extract connection info
 * v1.6.4.13 - FIX Complexity: Extracted from handlePortConnect (cc=11 → cc=5)
 * @private
 * @param {browser.runtime.Port} port - The connecting port
/**
 * Parse tab ID from port name or sender
 * v1.6.4.14 - FIX Complexity: Extracted to reduce _parsePortConnectionInfo cc
 * @private
 */
function _parsePortTabId(nameParts, port) {
  if (nameParts[2]) return parseInt(nameParts[2], 10);
  return port.sender?.tab?.id || null;
}

/**
 * Parse port connection information from port name
 * v1.6.4.13 - FIX Complexity: Extracted from handlePortConnect
 * v1.6.4.14 - FIX Complexity: Extracted _parsePortTabId helper (cc=10 → cc=4)
 * @private
 * @param {browser.runtime.Port} port - The connecting port
 * @returns {{ type: string, tabId: number|null, origin: string, windowId: number|null }}
 */
function _parsePortConnectionInfo(port) {
  const nameParts = port.name.split('-');
  const type = nameParts[1] || 'unknown';
  const tabId = _parsePortTabId(nameParts, port);
  const origin = type === 'sidebar' ? 'sidebar' : `content-tab-${tabId}`;
  const windowId = port.sender?.tab?.windowId || null;
  return { type, tabId, origin, windowId };
}

/**
 * Handle port disconnect event
 * v1.6.4.13 - FIX Complexity: Extracted from handlePortConnect
 * @private
 * @param {string} portId - Port ID
 * @param {number|null} tabId - Tab ID
 * @param {string} origin - Port origin
 */
function _handlePortDisconnect(portId, tabId, origin) {
  const error = browser.runtime.lastError;
  if (error) {
    logPortLifecycle(origin, 'error', { portId, tabId, error: error.message });
  }
  unregisterPort(portId, 'client-disconnect');
}

/**
 * Handle incoming port connection
 * v1.6.3.6-v11 - FIX Issue #11: Persistent port connections
 * v1.6.3.7-v9 - Issue #4: Extract window ID for sidebar tracking
 * v1.6.4.13 - FIX Complexity: Extracted helpers (cc=11 → cc=3)
 * @param {browser.runtime.Port} port - The connecting port
 */
function handlePortConnect(port) {
  const { type, tabId, origin, windowId } = _parsePortConnectionInfo(port);
  const portId = registerPort({ port, origin, tabId, type, windowId });

  // Store portId on the port for later reference
  port._portId = portId;

  // Handle messages from this port
  port.onMessage.addListener(message => {
    handlePortMessage(port, portId, message);
  });

  // Handle port disconnect
  port.onDisconnect.addListener(() => _handlePortDisconnect(portId, tabId, origin));
}

/**
 * Send acknowledgment for a port message
 * v1.6.4.13 - FIX Complexity: Extracted from handlePortMessage (cc=11 → cc=5)
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 * @param {browser.runtime.Port} options.port - The port to send ack to
 * @param {Object} options.message - Original message with correlationId
 * @param {Object} options.response - Handler response
 * @param {Object} options.portInfo - Port info for logging
 * @param {string} options.portId - Port ID for logging
 */
function _sendPortAcknowledgment({ port, message, response, portInfo, portId }) {
  const ack = {
    type: 'ACKNOWLEDGMENT',
    correlationId: message.correlationId,
    originalType: message.type,
    success: response?.success ?? true,
    timestamp: Date.now(),
    messageSequence: _getNextPortMessageSequence(),
    ...response
  };

  try {
    port.postMessage(ack);
    logPortLifecycle(portInfo?.origin || 'unknown', 'ack-sent', {
      portId,
      correlationId: message.correlationId,
      success: ack.success
    });
  } catch (err) {
    console.error('[Background] Failed to send acknowledgment:', err.message);
  }
}

/**
 * Handle message received via port
 * v1.6.3.6-v11 - FIX Issue #10: Message acknowledgment system
 * v1.6.3.7-v9 - Issue #9: Message sequence tracking and reordering
 * v1.6.4.13 - FIX Complexity: Extracted helpers (cc=11 → cc=5)
 * @param {browser.runtime.Port} port - The port that sent the message
 * @param {string} portId - Port ID
 * @param {Object} message - The message
 */
async function handlePortMessage(port, portId, message) {
  const portInfo = portRegistry.get(portId);
  updatePortActivity(portId);

  // v1.6.3.7-v9 - Issue #9: Check message sequence if present
  if (typeof message.messageSequence === 'number') {
    const sequenceResult = _processPortMessageSequence(portId, message);
    if (sequenceResult.buffered) {
      console.log('[Background] [PORT] MESSAGE_BUFFERED:', {
        portId,
        messageSequence: message.messageSequence,
        expectedSequence: sequenceResult.expectedSequence,
        bufferSize: sequenceResult.bufferSize
      });
      return;
    }
  }

  logPortLifecycle(portInfo?.origin || 'unknown', 'message', {
    portId,
    tabId: portInfo?.tabId,
    messageType: message.type,
    correlationId: message.correlationId,
    messageSequence: message.messageSequence
  });

  // Route message based on type
  const response = await routePortMessage(message, portInfo);

  // v1.6.3.7-v9 - Issue #9: Process any buffered messages that are now in order
  _processBufferedMessages(port, portId);

  // Send acknowledgment if correlationId present
  if (message.correlationId) {
    _sendPortAcknowledgment({ port, message, response, portInfo, portId });
  }
}

/**
 * Process port message sequence number for reordering
 * v1.6.3.7-v9 - Issue #9: Track and buffer out-of-order messages
 * v1.6.3.7-v10 - FIX Issue #9: Add 1-second timeout for stuck queue messages
 * @private
 * @param {string} portId - Port ID
 * @param {Object} message - Message with messageSequence
 * @returns {{ buffered: boolean, expectedSequence: number, bufferSize: number }}
 */
function _processPortMessageSequence(portId, message) {
  let tracking = portSequenceTracking.get(portId);
  if (!tracking) {
    // Initialize if not exists (shouldn't happen but handle gracefully)
    _initPortSequenceTracking(portId);
    tracking = portSequenceTracking.get(portId);
  }

  const expectedSeq = tracking.lastReceivedSeq + 1;
  const receivedSeq = message.messageSequence;

  // Message is in order
  if (receivedSeq === expectedSeq || tracking.lastReceivedSeq === 0) {
    tracking.lastReceivedSeq = receivedSeq;
    // v1.6.3.7-v10 - FIX Issue #9: Clear timeout since we received expected message
    _clearPortBufferTimeout(portId);
    return { buffered: false, expectedSequence: expectedSeq, bufferSize: tracking.reorderBuffer.size };
  }

  // Message is out of order - future message arrived early
  if (receivedSeq > expectedSeq) {
    console.warn('[Background] [PORT] OUT_OF_ORDER_MESSAGE:', {
      portId,
      expectedSequence: expectedSeq,
      receivedSequence: receivedSeq,
      gap: receivedSeq - expectedSeq
    });

    // Buffer it for later processing
    tracking.reorderBuffer.set(receivedSeq, message);
    // v1.6.3.7-v10 - FIX Issue #9: Log buffered message
    console.log('[Background] PORT_MESSAGE_QUEUED:', {
      portId,
      messageSequence: receivedSeq,
      expectedSequence: expectedSeq,
      bufferSize: tracking.reorderBuffer.size,
      timestamp: Date.now()
    });

    // v1.6.3.7-v10 - FIX Issue #9: Start timeout for stuck queue messages
    _startPortBufferTimeout(portId);

    // Check buffer size limit
    if (tracking.reorderBuffer.size > MAX_REORDER_BUFFER_SIZE) {
      console.warn('[Background] [PORT] REORDER_BUFFER_FLUSH:', {
        portId,
        bufferSize: tracking.reorderBuffer.size,
        maxSize: MAX_REORDER_BUFFER_SIZE
      });
      // Force process oldest messages in buffer
      _forceFlushReorderBuffer(portId, tracking);
    }

    return { buffered: true, expectedSequence: expectedSeq, bufferSize: tracking.reorderBuffer.size };
  }

  // receivedSeq < expectedSeq: Old/duplicate message, ignore
  console.log('[Background] [PORT] DUPLICATE_MESSAGE_IGNORED:', {
    portId,
    receivedSequence: receivedSeq,
    lastReceivedSequence: tracking.lastReceivedSeq
  });
  return { buffered: false, expectedSequence: expectedSeq, bufferSize: tracking.reorderBuffer.size };
}

/**
 * Process any buffered messages that are now in order
 * v1.6.3.7-v9 - Issue #9: Drain buffer after processing a message
 * @private
 * @param {browser.runtime.Port} port - Port to process messages for
 * @param {string} portId - Port ID
 */
async function _processBufferedMessages(port, portId) {
  const tracking = portSequenceTracking.get(portId);
  if (!tracking || tracking.reorderBuffer.size === 0) {
    return;
  }

  let processedCount = 0;
  // Process messages in sequence order
  let hasMoreMessages = true;
  while (hasMoreMessages) {
    const nextExpected = tracking.lastReceivedSeq + 1;
    const bufferedMessage = tracking.reorderBuffer.get(nextExpected);
    
    if (!bufferedMessage) {
      hasMoreMessages = false;
      continue;
    }

    // Remove from buffer and process
    tracking.reorderBuffer.delete(nextExpected);
    tracking.lastReceivedSeq = nextExpected;
    processedCount++;

    console.log('[Background] [PORT] BUFFERED_MESSAGE_PROCESSED:', {
      portId,
      messageSequence: nextExpected,
      remainingBuffered: tracking.reorderBuffer.size
    });

    // Route the buffered message
    const portInfo = portRegistry.get(portId);
    await routePortMessage(bufferedMessage, portInfo);
  }

  if (processedCount > 0) {
    console.log('[Background] [PORT] REORDER_BUFFER_DRAINED:', {
      portId,
      processedCount,
      remainingBuffered: tracking.reorderBuffer.size
    });
  }
}

/**
 * Force flush reorder buffer when it exceeds max size
 * v1.6.3.7-v9 - Issue #9: Prevent unbounded buffer growth
 * @private
 * @param {string} portId - Port ID
 * @param {Object} tracking - Sequence tracking object
 */
function _forceFlushReorderBuffer(portId, tracking) {
  // Get sorted sequence numbers
  const sequences = Array.from(tracking.reorderBuffer.keys()).sort((a, b) => a - b);
  
  // Remove oldest half of buffer
  const toRemove = Math.floor(sequences.length / 2);
  for (let i = 0; i < toRemove; i++) {
    tracking.reorderBuffer.delete(sequences[i]);
  }

  // Update lastReceivedSeq to skip the gap
  if (sequences.length > toRemove) {
    tracking.lastReceivedSeq = sequences[toRemove] - 1;
  }

  console.warn('[Background] [PORT] BUFFER_FORCE_FLUSHED:', {
    portId,
    removedCount: toRemove,
    newLastReceivedSeq: tracking.lastReceivedSeq,
    remainingBuffered: tracking.reorderBuffer.size
  });
}

/**
 * Port message handlers lookup table
 * v1.6.4.13 - FIX Complexity: Extracted from routePortMessage switch (cc=10 → cc=4)
 * @private
 */
const PORT_MESSAGE_HANDLERS = {
  HEARTBEAT: handleHeartbeat,
  HEALTH_PROBE: handleHealthProbe,
  LISTENER_VERIFICATION: handleListenerVerification,
  ACTION_REQUEST: handleActionRequest,
  STATE_UPDATE: handleStateUpdate,
  BROADCAST: handleBroadcastRequest,
  DELETION_ACK: handleDeletionAck,
  REQUEST_FULL_STATE_SYNC: handleFullStateSyncRequest
};

/**
 * Route port message to appropriate handler
 * v1.6.3.6-v11 - FIX Issue #15: Message type discrimination
 * v1.6.3.6-v12 - FIX Issue #2, #4: Added HEARTBEAT handling
 * v1.6.4.0 - FIX Issue E: Added REQUEST_FULL_STATE_SYNC handling
 * v1.6.3.7-v4 - FIX Issue #8, #10: Added HEALTH_PROBE and LISTENER_VERIFICATION handling
 * v1.6.4.13 - FIX Complexity: Uses lookup table (cc=10 → cc=4)
 * @param {Object} message - Message to route
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Handler response
 */
function routePortMessage(message, portInfo) {
  const { type, action } = message;

  const handler = PORT_MESSAGE_HANDLERS[type];
  if (handler) {
    return handler(message, portInfo);
  }

  return _handleUnknownPortMessage(type, action, message, portInfo);
}

/**
 * Handle unknown port message types
 * v1.6.3.7-v4 - Extracted for complexity reduction
 * @private
 */
function _handleUnknownPortMessage(type, action, message, portInfo) {
  // Fallback to action-based routing for backwards compatibility
  if (action) {
    return handleLegacyAction(message, portInfo);
  }
  console.warn('[Background] Unknown message type:', type);
  return Promise.resolve({ success: false, error: 'Unknown message type' });
}

/**
 * Handle HEALTH_PROBE message for circuit breaker early recovery
 * v1.6.3.7-v4 - FIX Issue #8: Lightweight probe to detect if background is responsive
 * @param {Object} message - Health probe message
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Health acknowledgment
 */
function handleHealthProbe(message, portInfo) {
  console.log('[Background] HEALTH_PROBE received:', {
    source: message.source || portInfo?.origin || 'unknown',
    timestamp: message.timestamp,
    portId: portInfo?.port?._portId
  });

  return Promise.resolve({
    success: true,
    type: 'HEALTH_ACK',
    healthy: true,
    timestamp: Date.now(),
    originalTimestamp: message.timestamp,
    isInitialized,
    cacheTabCount: globalQuickTabState.tabs?.length || 0
  });
}

/**
 * Handle LISTENER_VERIFICATION message to confirm port listener is working
 * v1.6.3.7-v4 - FIX Issue #10: Test message to verify listener registration succeeded
 * @param {Object} message - Verification message
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Verification acknowledgment
 */
function handleListenerVerification(message, portInfo) {
  console.log('[Background] LISTENER_VERIFICATION received:', {
    source: message.source || portInfo?.origin || 'unknown',
    timestamp: message.timestamp,
    portId: portInfo?.port?._portId
  });

  return Promise.resolve({
    success: true,
    type: 'LISTENER_VERIFICATION_ACK',
    verified: true,
    timestamp: Date.now(),
    originalTimestamp: message.timestamp
  });
}

/**
 * Handle HEARTBEAT message to keep background script alive
 * v1.6.3.6-v12 - FIX Issue #2, #4: Heartbeat mechanism prevents Firefox 30s termination
 * v1.6.4.16 - FIX Issue #11: Echo correlationId for proper ACK matching
 * @param {Object} message - Heartbeat message
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Heartbeat acknowledgment
 */
function handleHeartbeat(message, portInfo) {
  const { timestamp, source, correlationId, messageSequence } = message;
  const now = Date.now();
  const latencyMs = now - (timestamp || now);

  console.log('[Background] PORT_HEARTBEAT received:', {
    source: source || portInfo?.origin || 'unknown',
    correlationId, // v1.6.4.16 - FIX Issue #11: Log correlationId
    messageSequence, // v1.6.3.7-v9: Log sequence
    latencyMs,
    portId: portInfo?.port?._portId,
    tabId: portInfo?.tabId
  });

  // Log successful heartbeat for monitoring
  console.log('[Background] PORT_HEARTBEAT: success', {
    portCount: portRegistry.size,
    isInitialized
  });

  return Promise.resolve({
    success: true,
    type: 'HEARTBEAT_ACK',
    correlationId, // v1.6.4.16 - FIX Issue #11: Echo correlationId for proper ACK matching
    originalTimestamp: timestamp,
    timestamp: now,
    latencyMs,
    backgroundAlive: true,
    isInitialized
  });
}

/**
 * Handle deletion acknowledgment from content scripts
 * v1.6.3.6-v12 - FIX Issue #6: Track acknowledgments for deletion ordering
 * @param {Object} message - Deletion ack message
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Ack response
 */
function handleDeletionAck(message, portInfo) {
  const { correlationId, quickTabId, tabId } = message;

  console.log('[Background] DELETION_ACK received:', {
    correlationId,
    quickTabId,
    fromTabId: tabId || portInfo?.tabId
  });

  // Find pending deletion tracking
  const pending = pendingDeletionAcks.get(correlationId);
  if (!pending) {
    console.warn('[Background] No pending deletion for correlationId:', correlationId);
    return Promise.resolve({ success: false, error: 'No pending deletion' });
  }

  // Mark tab as completed
  const ackTabId = tabId || portInfo?.tabId;
  if (ackTabId) {
    pending.completedTabs.add(ackTabId);
    pending.pendingTabs.delete(ackTabId);
  }

  console.log('[Background] Deletion progress:', {
    correlationId,
    completed: pending.completedTabs.size,
    pending: pending.pendingTabs.size
  });

  // Check if all tabs have acknowledged
  if (pending.pendingTabs.size === 0) {
    console.log('[Background] All tabs acknowledged deletion:', correlationId);
    pending.resolve({ success: true, allAcked: true });
    pendingDeletionAcks.delete(correlationId);
  }

  return Promise.resolve({ success: true, recorded: true });
}

/**
 * Action handlers lookup table for ACTION_REQUEST messages
 * v1.6.4.13 - FIX Complexity: Extracted from handleActionRequest switch (cc=12 → cc=4)
 * @private
 */
const ACTION_REQUEST_HANDLERS = {
  TOGGLE_GROUP: () => ({ success: true }),
  MINIMIZE_TAB: (payload, portInfo) => executeManagerCommand('MINIMIZE_QUICK_TAB', payload.quickTabId, portInfo?.tabId),
  RESTORE_TAB: (payload, portInfo) => executeManagerCommand('RESTORE_QUICK_TAB', payload.quickTabId, portInfo?.tabId),
  CLOSE_TAB: (payload, portInfo) => executeManagerCommand('CLOSE_QUICK_TAB', payload.quickTabId, portInfo?.tabId),
  ADOPT_TAB: (payload) => handleAdoptAction(payload),
  CLOSE_MINIMIZED_TABS: () => handleCloseMinimizedTabsCommand(),
  DELETE_GROUP: () => ({ success: false, error: 'Not implemented' })
};

/**
 * Handle ACTION_REQUEST type messages
 * v1.6.3.6-v11 - FIX Issue #15: Action request handling
 * v1.6.4.0 - FIX Issue A: Added CLOSE_MINIMIZED_TABS handler
 * v1.6.4.13 - FIX Complexity: Uses lookup table (cc=12 → cc=4)
 * @param {Object} message - Action request message
 * @param {Object} portInfo - Port info
 */
function handleActionRequest(message, portInfo) {
  const { action, payload } = message;

  console.log('[Background] Handling ACTION_REQUEST:', { action, portInfo: portInfo?.origin });

  const handler = ACTION_REQUEST_HANDLERS[action];
  if (handler) {
    return handler(payload, portInfo);
  }

  console.warn('[Background] Unknown action:', action);
  return { success: false, error: `Unknown action: ${action}` };
}

/**
 * Handle STATE_UPDATE type messages
 * v1.6.3.6-v11 - FIX Issue #13: Background as sole writer
 * @param {Object} message - State update message
 * @param {Object} portInfo - Port info
 */
async function handleStateUpdate(message, portInfo) {
  const { quickTabId, changes } = message.payload || {};

  console.log('[Background] Handling STATE_UPDATE:', {
    quickTabId,
    changes,
    source: portInfo?.origin
  });

  // Update global state
  _updateGlobalQuickTabCache(quickTabId, changes, portInfo?.tabId);

  // v1.6.3.6-v11 - FIX Issue #14: Storage write verification
  const writeResult = await writeStateWithVerification();

  // v1.6.3.6-v11 - FIX Issue #19: Broadcast visibility changes to all ports
  if (changes?.minimized !== undefined || changes?.visibility !== undefined) {
    broadcastToAllPorts({
      type: 'BROADCAST',
      action: 'VISIBILITY_CHANGE',
      quickTabId,
      changes,
      timestamp: Date.now()
    });
  }

  return writeResult;
}

/**
 * Handle BROADCAST type messages
 * v1.6.3.6-v11 - FIX Issue #19: Visibility state sync
 * @param {Object} message - Broadcast message
 * @param {Object} portInfo - Port info
 */
function handleBroadcastRequest(message, portInfo) {
  const excludePortId = portInfo ? portInfo.port?._portId : null;

  console.log('[Background] Broadcasting to all ports:', {
    action: message.action,
    excludePortId
  });

  broadcastToAllPorts(message, excludePortId);

  return Promise.resolve({
    success: true,
    broadcastedTo: portRegistry.size - (excludePortId ? 1 : 0)
  });
}

/**
 * Handle legacy action-based messages (backwards compatibility)
 * v1.6.3.6-v11 - Backwards compatibility with existing message format
 * @param {Object} message - Legacy message
 * @param {Object} portInfo - Port info
 */
function handleLegacyAction(message, portInfo) {
  const { action, quickTabId } = message;

  console.log('[Background] Handling legacy action:', { action, quickTabId });

  // Map legacy actions to new handlers
  if (action === 'MANAGER_COMMAND') {
    return handleManagerCommand(message);
  }

  if (action === 'QUICK_TAB_STATE_CHANGE') {
    return handleQuickTabStateChange(message, { tab: { id: portInfo?.tabId } });
  }

  return Promise.resolve({ success: false, error: 'Unknown legacy action' });
}

/**
 * Build adoption error response
 * v1.6.4.14 - FIX Large Method: Extracted from handleAdoptAction
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Error options
 * @param {string} options.quickTabId - Quick Tab ID
 * @param {string} options.targetTabId - Target tab ID
 * @param {string} options.corrId - Correlation ID
 * @param {string} options.reason - Error reason
 * @param {Object} [options.extraInfo={}] - Extra info for logging
 */
function _buildAdoptionError({ quickTabId, targetTabId, corrId, reason, extraInfo = {} }) {
  console.error('[Background] ADOPTION_FAILED:', {
    quickTabId,
    targetTabId,
    correlationId: corrId,
    reason,
    ...extraInfo
  });
  return { success: false, error: reason };
}

/**
 * Perform adoption storage write
 * v1.6.4.14 - FIX Large Method: Extracted from handleAdoptAction
 * v1.6.3.7-v13 - Issue #2: Add write validation
 * @private
 * @param {Object} state - Current state with tabs array
 * @param {string} quickTabId - Quick Tab being adopted
 * @param {number} targetTabId - Target tab adopting the Quick Tab
 * @returns {Promise<{saveId: string, sequenceId: number, validated: boolean, recovered: boolean}>}
 *          - validated: true if write was verified successfully
 *          - recovered: true if validation failed but recovery succeeded
 *          - Caller should check `validated || recovered` to determine if state is consistent
 */
async function _performAdoptionStorageWrite(state, quickTabId, targetTabId) {
  const saveId = `adopt-${quickTabId}-${Date.now()}`;
  const sequenceId = _getNextStorageSequenceId();
  
  const stateToWrite = {
    tabs: state.tabs,
    saveId,
    sequenceId,
    timestamp: Date.now(),
    writingTabId: targetTabId,
    writingInstanceId: `background-adopt-${Date.now()}`
  };
  
  // v1.6.3.7-v13 - Issue #2: Use centralized validation
  const result = await _writeQuickTabStateWithValidation(stateToWrite, 'adoption');
  
  if (!result.success && !result.recovered) {
    console.warn('[Background] ADOPTION_WRITE_INCONSISTENT:', {
      quickTabId,
      targetTabId,
      error: result.error,
      recommendation: 'State may be inconsistent - consider retrying adoption'
    });
  }
  
  return { saveId, sequenceId, validated: result.success, recovered: result.recovered };
}

/**
 * Update cache after adoption
 * v1.6.4.14 - FIX Large Method: Extracted from handleAdoptAction
 * @private
 */
function _updateCacheAfterAdoption(quickTabId, targetTabId, saveId) {
  const cachedTab = globalQuickTabState.tabs.find(t => t.id === quickTabId);
  if (cachedTab) {
    cachedTab.originTabId = targetTabId;
  }
  globalQuickTabState.saveId = saveId;
  globalQuickTabState.lastUpdate = Date.now();
  quickTabHostTabs.set(quickTabId, targetTabId);
}

/**
 * Handle adopt action (atomic single write)
 * v1.6.3.6-v11 - FIX Issue #18: Adoption atomicity
 * v1.6.4.9 - Issue #9: Enhanced adoption lifecycle logging
 * v1.6.4.14 - FIX Large Method: Extracted helpers (72 lines → 45 lines)
 * @param {Object} payload - Adoption payload
 */
async function handleAdoptAction(payload) {
  const { quickTabId, targetTabId, correlationId } = payload;
  const corrId = correlationId || `adopt-${Date.now()}-${quickTabId?.substring(0, 8) || 'unknown'}`;

  console.log('[Background] ADOPTION_STARTED:', { quickTabId, targetTabId, correlationId: corrId, timestamp: Date.now() });

  // Read entire state
  const result = await browser.storage.local.get('quick_tabs_state_v2');
  const state = result?.quick_tabs_state_v2;

  if (!state?.tabs) {
    return _buildAdoptionError({ quickTabId, targetTabId, corrId, reason: 'No state to adopt from' });
  }

  // Find and update the tab locally
  const tabIndex = state.tabs.findIndex(t => t.id === quickTabId);
  if (tabIndex === -1) {
    return _buildAdoptionError({
      quickTabId, targetTabId, corrId,
      reason: 'Quick Tab not found',
      extraInfo: { availableTabIds: state.tabs.map(t => t.id).slice(0, 10) }
    });
  }

  const oldOriginTabId = state.tabs[tabIndex].originTabId;
  const adoptedTabUrl = state.tabs[tabIndex].url;
  state.tabs[tabIndex].originTabId = targetTabId;

  // Single atomic write
  const { saveId, sequenceId } = await _performAdoptionStorageWrite(state, quickTabId, targetTabId);

  // Update caches
  _updateCacheAfterAdoption(quickTabId, targetTabId, saveId);

  // Broadcast via all channels
  _broadcastOperationConfirmation({
    operationType: 'ADOPT_CONFIRMED',
    quickTabId,
    changes: { originTabId: targetTabId, oldOriginTabId },
    saveId,
    correlationId: corrId
  });
  _sendStateUpdateViaPorts(quickTabId, { originTabId: targetTabId }, 'adopt', corrId);
  _broadcastStorageWriteConfirmation({ tabs: state.tabs, saveId, sequenceId }, saveId);

  console.log('[Background] ADOPTION_COMPLETED:', {
    quickTabId, url: adoptedTabUrl, oldOriginTabId, newOriginTabId: targetTabId, correlationId: corrId, timestamp: Date.now()
  });

  return { success: true, oldOriginTabId, newOriginTabId: targetTabId };
}

/**
 * Write state to storage with verification
 * v1.6.3.6-v11 - FIX Issue #14: Storage write verification
 * v1.6.3.7-v7 - FIX Issue #6: Add BroadcastChannel confirmation after successful write
 * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
 * @returns {Promise<Object>} Write result with verification status
 */
async function writeStateWithVerification() {
  const saveId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const sequenceId = _getNextStorageSequenceId();

  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    saveId,
    sequenceId,
    timestamp: Date.now()
  };

  try {
    // Write
    await browser.storage.local.set({ quick_tabs_state_v2: stateToWrite });

    // v1.6.3.6-v11 - FIX Issue #14: Read-back verification
    const result = await browser.storage.local.get('quick_tabs_state_v2');
    const readBack = result?.quick_tabs_state_v2;

    const verified = readBack?.saveId === saveId;

    if (!verified) {
      console.error('[Background] Storage write verification FAILED:', {
        expectedSaveId: saveId,
        actualSaveId: readBack?.saveId,
        expectedTabs: stateToWrite.tabs.length,
        actualTabs: readBack?.tabs?.length
      });
    } else {
      console.log('[Background] Storage write verified:', {
        saveId,
        sequenceId,
        tabCount: stateToWrite.tabs.length
      });

      // v1.6.3.7-v7 - FIX Issue #6: Broadcast confirmation via BroadcastChannel
      _broadcastStorageWriteConfirmation(stateToWrite, saveId);
    }

    return { success: verified, saveId, sequenceId, verified };
  } catch (err) {
    console.error('[Background] Storage write error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Broadcast storage write confirmation via BroadcastChannel
 * v1.6.3.7-v7 - FIX Issue #6: Notify Manager of successful storage writes
 * v1.6.3.7-v10 - FIX Issue #6: Also notify Manager to start watchdog timer via port
 * @private
 * @param {Object} state - State that was written
 * @param {string} saveId - Save ID for deduplication
 */
function _broadcastStorageWriteConfirmation(state, saveId) {
  // v1.6.3.7-v10 - FIX Issue #6: Notify Manager to start watchdog via port message
  _notifyManagerToStartWatchdog(saveId, state?.sequenceId);

  if (!isBroadcastChannelAvailable()) {
    if (DEBUG_MESSAGING) {
      console.log('[Background] [BC] BroadcastChannel not available for write confirmation');
    }
    return;
  }

  const bcSuccess = broadcastFullStateSync(state, saveId);
  if (DEBUG_MESSAGING) {
    console.log('[Background] [BC] Storage write confirmation broadcast:', {
      saveId,
      tabCount: state?.tabs?.length || 0,
      success: bcSuccess,
      timestamp: Date.now()
    });
  }
}

// v1.6.3.7-v10 - FIX Code Review: Define storage watchdog timeout constant
// This is communicated to Manager for informational purposes; Manager uses its own local constant
const BACKGROUND_STORAGE_WATCHDOG_TIMEOUT_MS = 2000;

/**
 * Notify Manager to start storage watchdog timer
 * v1.6.3.7-v10 - FIX Issue #6: Send PORT message to Manager to start 2s watchdog
 * If storage.onChanged doesn't fire within 2s, Manager will re-read storage
 * @private
 * @param {string} expectedSaveId - Save ID we expect Manager to receive
 * @param {number} sequenceId - Sequence ID for tracking
 */
function _notifyManagerToStartWatchdog(expectedSaveId, sequenceId) {
  const watchdogMessage = {
    type: 'START_STORAGE_WATCHDOG',
    expectedSaveId,
    sequenceId,
    timeoutMs: BACKGROUND_STORAGE_WATCHDOG_TIMEOUT_MS, // v1.6.3.7-v10 - Use constant
    timestamp: Date.now()
  };

  let notifiedCount = 0;
  for (const [portId, portInfo] of portRegistry.entries()) {
    // Only notify sidebar ports (Manager)
    if (portInfo.origin !== 'sidebar' && !portInfo.port?.name?.includes('sidebar')) {
      continue;
    }

    try {
      portInfo.port.postMessage(watchdogMessage);
      notifiedCount++;
      console.log('[Background] STORAGE_WATCHDOG_NOTIFICATION_SENT:', {
        portId,
        expectedSaveId,
        sequenceId,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('[Background] Failed to send watchdog notification:', {
        portId,
        error: err.message
      });
    }
  }

  if (notifiedCount === 0) {
    console.log('[Background] STORAGE_WATCHDOG_NOTIFICATION_SKIPPED: No sidebar ports connected');
  }
}

// ==================== v1.6.4.13 MESSAGING HELPER FUNCTIONS ====================
// FIX Issues #1-8: Centralized messaging helpers for all state operations

/**
 * Broadcast operation confirmation via BroadcastChannel (Tier 1)
 * v1.6.4.13 - FIX Issue #1 & #2: Background broadcasts state changes to Manager
 * @private
 * @param {string} operationType - Type of operation (e.g., 'MINIMIZE_CONFIRMED', 'RESTORE_CONFIRMED')
/**
 * Broadcast operation confirmation via BroadcastChannel (Tier 1)
 * v1.6.4.13 - FIX Issue #1 & #2: Use BC for confirmations
 * v1.6.4.14 - FIX Complexity: Converted switch to lookup table
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Broadcast options
 * @param {string} options.operationType - Operation type (e.g., 'MINIMIZE_CONFIRMED', 'RESTORE_CONFIRMED')
 * @param {string} options.quickTabId - Quick Tab ID affected
 * @param {Object} options.changes - State changes made
 * @param {string} options.saveId - Save ID for deduplication
 * @param {string} [options.correlationId] - Correlation ID for tracing
 */
function _broadcastOperationConfirmation({ operationType, quickTabId, changes, saveId, correlationId }) {
  if (!isBroadcastChannelAvailable()) {
    if (DEBUG_MESSAGING) {
      console.log('[Background] [BC] BROADCAST_SKIPPED: Channel not available for operation confirmation', {
        operationType,
        quickTabId,
        timestamp: Date.now()
      });
    }
    return;
  }

  // v1.6.4.14 - FIX Complexity: Use lookup table for broadcast function selection
  const OPERATION_BROADCAST_FNS = {
    MINIMIZE_CONFIRMED: () => broadcastQuickTabMinimized(quickTabId),
    RESTORE_CONFIRMED: () => broadcastQuickTabRestored(quickTabId),
    DELETE_CONFIRMED: () => broadcastQuickTabDeleted(quickTabId),
    ADOPT_CONFIRMED: () => broadcastQuickTabUpdated(quickTabId, changes),
    UPDATE_CONFIRMED: () => broadcastQuickTabUpdated(quickTabId, changes)
  };

  const broadcastFn = OPERATION_BROADCAST_FNS[operationType];
  const bcSuccess = broadcastFn
    ? broadcastFn()
    : broadcastFullStateSync({ tabs: globalQuickTabState.tabs, saveId }, saveId);

  // Log broadcast result
  if (DEBUG_MESSAGING) {
    console.log('[Background] [BC] OPERATION_BROADCAST:', {
      type: operationType,
      quickTabId,
      correlationId,
      success: bcSuccess,
      timestamp: Date.now()
    });
  }
}

/**
 * Send STATE_UPDATE message via connected ports (Tier 2)
 * v1.6.4.13 - FIX Issue #3: Port used for state updates, not just heartbeat
 * @private
 * @param {string} quickTabId - Quick Tab ID affected
 * @param {Object} changes - State changes made
 * @param {string} operation - Operation name (e.g., 'minimize', 'restore', 'delete', 'adopt')
 * @param {string} correlationId - Correlation ID for tracing
 */
function _sendStateUpdateViaPorts(quickTabId, changes, operation, correlationId) {
  const message = {
    type: 'STATE_UPDATE',
    quickTabId,
    changes,
    operation,
    correlationId,
    saveId: globalQuickTabState.saveId,
    source: 'background',
    timestamp: Date.now()
  };

  const result = _sendMessageToSidebarPorts(message, quickTabId, operation, correlationId);

  if (DEBUG_MESSAGING) {
    console.log('[Background] [PORT] STATE_UPDATE_BROADCAST_COMPLETE:', {
      quickTabId,
      operation,
      sentCount: result.sentCount,
      errorCount: result.errorCount,
      totalPorts: portRegistry.size,
      timestamp: Date.now()
    });
  }
}

/**
 * Send message to all sidebar ports and track results
 * v1.6.4.13 - Extracted to reduce nesting depth in _sendStateUpdateViaPorts
 * @private
 * @param {Object} message - Message to send
 * @param {string} quickTabId - Quick Tab ID for logging
 * @param {string} operation - Operation name for logging  
 * @param {string} correlationId - Correlation ID for logging
 * @returns {{ sentCount: number, errorCount: number }} Send results
 */
function _sendMessageToSidebarPorts(message, quickTabId, operation, correlationId) {
  let sentCount = 0;
  let errorCount = 0;

  for (const [portId, portInfo] of portRegistry.entries()) {
    if (!_isSidebarPort(portInfo)) {
      continue;
    }

    const result = _trySendToPort({ port: portInfo.port, message, portId, quickTabId, operation, correlationId });
    if (result.success) {
      sentCount++;
    } else {
      errorCount++;
    }
  }

  return { sentCount, errorCount };
}

/**
 * Check if port is a sidebar port
 * @private
 * @param {Object} portInfo - Port info from registry
 * @returns {boolean} True if sidebar port
 */
function _isSidebarPort(portInfo) {
  return portInfo.origin === 'sidebar' || portInfo.port?.name?.includes('sidebar');
}

/**
 * Try to send message to a port
 * v1.6.4.13 - Helper for _sendMessageToSidebarPorts
 * v1.6.4.14 - FIX Excess Args: Converted to options object
 * @private
 * @param {Object} options - Options object
 * @param {browser.runtime.Port} options.port - Port to send to
 * @param {Object} options.message - Message to send
 * @param {string} options.portId - Port ID for logging
 * @param {string} options.quickTabId - Quick Tab ID for logging
 * @param {string} options.operation - Operation name for logging
 * @param {string} options.correlationId - Correlation ID for logging
 * @returns {{ success: boolean }} success: true if postMessage succeeded, false if an error was thrown
 */
function _trySendToPort({ port, message, portId, quickTabId, operation, correlationId }) {
  try {
    port.postMessage(message);
    _logPortSendSuccess(portId, quickTabId, operation, correlationId);
    return { success: true };
  } catch (err) {
    _logPortSendFailure(portId, quickTabId, err.message);
    return { success: false };
  }
}

/**
 * Log successful port send
 * @private
 */
function _logPortSendSuccess(portId, quickTabId, operation, correlationId) {
  if (DEBUG_MESSAGING) {
    console.log('[Background] [PORT] STATE_UPDATE_SENT:', {
      portId,
      quickTabId,
      operation,
      correlationId,
      timestamp: Date.now()
    });
  }
}

/**
 * Log failed port send
 * @private
 */
function _logPortSendFailure(portId, quickTabId, errorMessage) {
  console.warn('[Background] [PORT] STATE_UPDATE_FAILED:', {
    portId,
    quickTabId,
    error: errorMessage,
    timestamp: Date.now()
  });
}

// ==================== END v1.6.4.13 MESSAGING HELPERS ====================

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
    saveId, operation, attempt: `1/${STORAGE_WRITE_MAX_RETRIES}`, tabCount
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
      saveId, operation, tabCount, stateHash, timestamp: Date.now()
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
    const result = await _attemptStorageWriteWithVerification(operation, saveId, attempt, backoffMs);

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
    saveId, operation, attemptNumber, totalAttempts: STORAGE_WRITE_MAX_RETRIES, tabCount
  });

  if (DEBUG_MESSAGING) {
    console.log('[Background] [STORAGE] WRITE_SUCCESS:', {
      saveId, operation, tabCount, stateHash, attemptNumber, timestamp: Date.now()
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
    saveId, operation, attempt: `${attempt + 1}/${STORAGE_WRITE_MAX_RETRIES}`, backoffMs, reason: 'verification pending'
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
    operation, saveId, totalAttempts: STORAGE_WRITE_MAX_RETRIES, tabCount
  });

  if (DEBUG_MESSAGING) {
    console.error('[Background] [STORAGE] WRITE_FAILED:', {
      saveId, operation, tabCount, stateHash, totalAttempts: STORAGE_WRITE_MAX_RETRIES, timestamp: Date.now()
    });
  }
}

/**
 * Attempt a single storage write with verification
 * v1.6.4.0 - FIX Issue F: Extracted to reduce nesting depth
 * v1.6.3.7-v9 - FIX Issue #6: Add sequenceId for event ordering
 * @private
 * @param {string} operation - Operation name
 * @param {string} saveId - Save ID
 * @param {number} attempt - Current attempt number
 * @param {number} backoffMs - Current backoff time
 * @returns {Promise<{ success: boolean, verified: boolean, needsRetry: boolean, attempts?: number, saveId?: string }>}
 */
async function _attemptStorageWriteWithVerification(operation, saveId, attempt, backoffMs) {
  const sequenceId = _getNextStorageSequenceId();
  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    saveId,
    sequenceId,
    timestamp: Date.now()
  };

  try {
    await browser.storage.local.set({ quick_tabs_state_v2: stateToWrite });
    return await _verifyStorageWrite({
      operation,
      saveId,
      sequenceId,
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

    // v1.6.3.7-v7 - FIX Issue #6: Broadcast confirmation via BroadcastChannel after verified write
    _broadcastStorageWriteConfirmation(readBack, saveId);

    return { success: true, saveId, sequenceId, verified: true, attempts: attempt, needsRetry: false };
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
 * Broadcast message to all connected ports
 * v1.6.3.6-v11 - FIX Issue #19: Visibility state sync
 * @param {Object} message - Message to broadcast
 * @param {string} excludePortId - Port ID to exclude from broadcast
 */
function broadcastToAllPorts(message, excludePortId = null) {
  let sentCount = 0;
  let errorCount = 0;

  for (const [portId, portInfo] of portRegistry.entries()) {
    if (portId === excludePortId) continue;

    try {
      portInfo.port.postMessage(message);
      sentCount++;
    } catch (err) {
      console.warn('[Background] Failed to broadcast to port:', { portId, error: err.message });
      errorCount++;
    }
  }

  console.log('[Background] Broadcast complete:', {
    action: message.action || message.type,
    sentCount,
    errorCount,
    excludedPortId: excludePortId
  });
}

// Register port connection listener
browser.runtime.onConnect.addListener(handlePortConnect);

console.log('[Background] v1.6.3.6-v11 Port lifecycle management initialized');

// ==================== END PORT LIFECYCLE MANAGEMENT ====================

// ==================== v1.6.3.6-v11 TAB LIFECYCLE EVENTS ====================
// FIX Issue #16: Track browser tab lifecycle for orphan detection

/**
 * Handle browser tab removal
 * v1.6.3.6-v11 - FIX Issue #16: Mark Quick Tabs as orphaned when their browser tab closes
 * @param {number} tabId - ID of the removed tab
 * @param {Object} removeInfo - Removal info
 */
function handleTabRemoved(tabId, removeInfo) {
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

  // Broadcast tab lifecycle change to all connected ports
  broadcastToAllPorts({
    type: 'BROADCAST',
    action: 'TAB_LIFECYCLE_CHANGE',
    event: 'tab-removed',
    tabId,
    affectedQuickTabs: orphanedQuickTabs.map(t => t.id),
    timestamp: Date.now()
  });

  // Clean up ports associated with this tab
  for (const [portId, portInfo] of portRegistry.entries()) {
    if (portInfo.tabId === tabId) {
      unregisterPort(portId, 'tab-removed');
    }
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
 * @private
 * @returns {{ messageId: string, quickTabId: string, changes: Object, source: string, sourceTabId: number }}
 */
function _prepareStateChangeContext(message, sender) {
  const { quickTabId, changes, source } = message;
  const sourceTabId = sender?.tab?.id ?? message.sourceTabId;
  const messageId = message.messageId || generateMessageId();
  
  logMessageReceipt(messageId, 'QUICK_TAB_STATE_CHANGE', sourceTabId);
  console.log('[Background] QUICK_TAB_STATE_CHANGE received:', { quickTabId, changes, source, sourceTabId });
  
  return { messageId, quickTabId, changes, source, sourceTabId };
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

  const { quickTabId, changes, source, sourceTabId } = _prepareStateChangeContext(message, sender);

  // Track which tab hosts this Quick Tab
  _updateQuickTabHostTracking(quickTabId, sourceTabId);

  // v1.6.3.5-v11 - FIX Issue #6: Handle deletion changes
  if (_isDeletionChange(changes, source)) {
    await _handleQuickTabDeletion(quickTabId, source, sourceTabId);
    return { success: true };
  }

  // Update globalQuickTabState cache
  _updateGlobalQuickTabCache(quickTabId, changes, sourceTabId);

  // Broadcast to all interested parties
  await broadcastQuickTabStateUpdate(quickTabId, changes, source, sourceTabId);

  return { success: true };
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
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} source - Source of deletion
 * @param {number} sourceTabId - Source browser tab ID
 */
async function _handleQuickTabDeletion(quickTabId, source, sourceTabId) {
  // v1.6.3.6-v5 - FIX Issue #4e: Generate correlation ID for deletion tracing
  const correlationId = `del-${Date.now()}-${quickTabId.substring(0, 8)}`;

  // v1.6.3.6-v5 - Log deletion submission
  logDeletionPropagation(correlationId, 'submit', quickTabId, {
    source,
    excludeTabId: sourceTabId
  });

  console.log('[Background] Processing deletion for:', quickTabId);
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
    sourceTabId
  );
}

/**
 * Update global Quick Tab state cache
 * v1.6.3.5-v11 - Extracted from handleQuickTabStateChange to reduce complexity
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @param {number} sourceTabId - Source browser tab ID
 */
function _updateGlobalQuickTabCache(quickTabId, changes, sourceTabId) {
  if (!changes || !quickTabId) return;

  const existingTab = globalQuickTabState.tabs.find(t => t.id === quickTabId);
  if (existingTab) {
    Object.assign(existingTab, changes);
    globalQuickTabState.lastUpdate = Date.now();
    console.log('[Background] Updated cache for:', quickTabId, changes);
  } else if (changes.url) {
    // New Quick Tab
    globalQuickTabState.tabs.push({
      id: quickTabId,
      ...changes,
      originTabId: sourceTabId
    });
    globalQuickTabState.lastUpdate = Date.now();
    console.log('[Background] Added new tab to cache:', quickTabId);
  }
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
 * v1.6.3.7-v7 - FIX Issue #1 & #2: Added BroadcastChannel as Tier 1 (PRIMARY) messaging
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @param {string} source - Source of change
 * @param {number} excludeTabId - Tab to exclude from broadcast (the source tab)
 */
async function broadcastQuickTabStateUpdate(quickTabId, changes, source, excludeTabId) {
  // v1.6.3.6-v4 - FIX Issue #4: Check broadcast limits
  const broadcastCheck = _shouldAllowBroadcast(quickTabId, changes);
  if (!broadcastCheck.allowed) {
    console.log('[Background] Broadcast BLOCKED:', {
      quickTabId,
      reason: broadcastCheck.reason,
      source
    });
    return;
  }

  // v1.6.3.6-v5 - FIX Issue #4c: Generate message ID for correlation
  const messageId = generateMessageId();

  const message = {
    type: 'QUICK_TAB_STATE_UPDATED',
    messageId, // v1.6.3.6-v5: Include message ID for tracing
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
    triggerSource: source
  });

  // v1.6.3.7-v7 - FIX Issue #1 & #2: Tier 1 (PRIMARY) - BroadcastChannel for instant updates
  // BroadcastChannel provides instant cross-tab messaging without port connections
  _broadcastViaBroadcastChannel(quickTabId, changes, messageId);

  // v1.6.3.7-v4 - FIX Issue #3: Tier 2 - Route state updates through PORT (secondary)
  // Port-based messaging is more reliable than runtime.sendMessage for sidebar
  let sentViaPort = false;
  const sidebarPortsSent = _broadcastToSidebarPorts(message);
  if (sidebarPortsSent > 0) {
    sentViaPort = true;
    console.log('[Background] [PORT] STATE_UPDATE sent to', sidebarPortsSent, 'sidebar(s):', {
      messageId,
      quickTabId
    });
  }

  // v1.6.3.7-v4 - FIX Issue #3: Tier 3 - Fall back to runtime.sendMessage if no ports available
  // This ensures sidebar gets the message even if port connection hasn't been established yet
  if (!sentViaPort) {
    try {
      await browser.runtime.sendMessage(message);
      console.log('[Background] STATE_UPDATE sent via runtime.sendMessage (no port available):', {
        messageId,
        quickTabId
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
    await _broadcastDeletionToAllTabs(quickTabId, source, excludeTabId, changes.correlationId);
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
 * Determine the broadcast type and function based on state changes
 * v1.6.4.13 - FIX Complexity: Extracted from _broadcastViaBroadcastChannel
 * v1.6.4.14 - FIX Complexity: Simplified conditionals (cc=10 → cc=4)
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @returns {{ broadcastType: string, broadcastFn: Function }}
 */
function _determineBroadcastTypeAndFn(quickTabId, changes) {
  // Priority-ordered checks for state changes
  if (changes?.deleted === true) {
    return { broadcastType: 'quick-tab-deleted', broadcastFn: () => broadcastQuickTabDeleted(quickTabId) };
  }
  if (changes?.minimized === true) {
    return { broadcastType: 'quick-tab-minimized', broadcastFn: () => broadcastQuickTabMinimized(quickTabId) };
  }
  if (changes?.minimized === false) {
    return { broadcastType: 'quick-tab-restored', broadcastFn: () => broadcastQuickTabRestored(quickTabId) };
  }
  if (_isQuickTabCreation(changes, quickTabId)) {
    return { broadcastType: 'quick-tab-created', broadcastFn: () => broadcastQuickTabCreated(quickTabId, changes) };
  }
  return { broadcastType: 'quick-tab-updated', broadcastFn: () => broadcastQuickTabUpdated(quickTabId, changes) };
}

/**
 * Broadcast state update via BroadcastChannel (Tier 1 - PRIMARY)
 * v1.6.3.7-v7 - FIX Issue #1 & #2: Use BroadcastChannel for instant Manager updates
 * v1.6.4.13 - FIX Complexity: Extracted _determineBroadcastTypeAndFn (cc=12 → cc=4)
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @param {string} messageId - Message ID for correlation
 */
function _broadcastViaBroadcastChannel(quickTabId, changes, messageId) {
  if (!isBroadcastChannelAvailable()) {
    if (DEBUG_MESSAGING) {
      console.log('[Background] [BC] BROADCAST_SKIPPED: BroadcastChannel not available', {
        quickTabId,
        messageId,
        timestamp: Date.now()
      });
    }
    return;
  }

  const { broadcastType, broadcastFn } = _determineBroadcastTypeAndFn(quickTabId, changes);
  const bcSuccess = broadcastFn();

  // v1.6.4.13 - Issue #5: Log BROADCAST_SENT with consistent format
  console.log('[Background] [BC] BROADCAST_SENT:', {
    type: broadcastType,
    quickTabId,
    messageId,
    success: bcSuccess,
    timestamp: Date.now()
  });
}

/**
 * Broadcast message to all connected sidebar ports
 * v1.6.3.7-v4 - FIX Issue #3: Send state updates via port for reliable delivery
 * @private
 * @param {Object} message - Message to send
 * @returns {number} Number of ports the message was sent to
 */
function _broadcastToSidebarPorts(message) {
  let sentCount = 0;

  for (const [portId, portInfo] of portRegistry.entries()) {
    // Only send to sidebar ports (not content script ports)
    if (portInfo.origin !== 'sidebar' && !portInfo.port?.name?.includes('sidebar')) {
      continue;
    }

    try {
      portInfo.port.postMessage(message);
      sentCount++;
      console.log('[Background] PORT_MESSAGE_SENT:', {
        portId,
        messageType: message.type,
        messageId: message.messageId,
        quickTabId: message.quickTabId
      });
    } catch (err) {
      console.warn('[Background] Failed to send to port:', { portId, error: err.message });
    }
  }

  return sentCount;
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
async function _createNotification({ idPrefix, title, message, priority = 1, clearTimeoutMultiplier = 1 }) {
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

    console.log(`[Background] Notification sent:`, { notificationId, title });
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
