// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs
// v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load
// v1.6.3.10-v3 - Phase 2: Tabs API Integration - TabLifecycleHandler, ORIGIN_TAB_CLOSED, Smart Adoption
// v1.6.3.10-v5 - FIX Issues #1 & #2: Atomic operations via Scripting API fallback for timeout recovery
// v1.6.3.10-v6 - FIX Issue #14: Storage.onChanged listener health check logging
//
// === v1.6.3.12-v2 ARCHITECTURE UPDATE ===
// PRIMARY SYNC: Port messaging ('quick-tabs-port') - Option 4 Architecture
//   - quickTabsSessionState object is SINGLE SOURCE OF TRUTH (in-memory)
//   - All content scripts and sidebar use port messaging for Quick Tab operations
//   - On browser restart, background reloads with empty memory (session-only)
//
// === v1.6.3.12-v4 STORAGE FIX ===
// IMPORTANT: browser.storage.session does NOT exist in Firefox Manifest V2
//   - All storage.session calls have been replaced with storage.local
//   - Session-only behavior is achieved via explicit startup cleanup (_clearQuickTabsOnStartup)
//   - Port messaging is the primary mechanism for real-time sync
//   - storage.local is used for persistence between page reloads (during browser session)
//
// === v1.6.3.12-v7 FIX Bug #3 ===
// Added QUICKTAB_REMOVED handler for content script UI close notifications
//   - When content script closes Quick Tab via its own close button (not Manager)
//   - DestroyHandler sends QUICKTAB_REMOVED message to background
//   - Background updates session state and notifies sidebar for Manager UI update

// v1.6.0 - PHASE 3.1: Import message routing infrastructure
import { LogHandler } from './src/background/handlers/LogHandler.js';
import { QuickTabHandler } from './src/background/handlers/QuickTabHandler.js';
import { TabHandler } from './src/background/handlers/TabHandler.js';
// v1.6.3.10-v3 - Phase 2: Tabs API Integration - Tab lifecycle handler
import { TabLifecycleHandler } from './src/background/handlers/TabLifecycleHandler.js';
import { MessageRouter } from './src/background/MessageRouter.js';

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

// ==================== VERSION-BASED LOG CLEANUP ====================
// v1.6.3.12 - Clear accumulated logs on version upgrade to prevent confusion
// and reduce storage waste from old logs across version updates
const EXTENSION_VERSION_KEY = 'extensionVersion';

/**
 * Get the storage.local API (browser or chrome)
 * v1.6.3.12 - Extracted for complexity reduction
 * @private
 * @returns {Object|null} storage.local API or null
 */
function _getStorageLocalAPI() {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

/**
 * Handle first install - record version without clearing logs
 * v1.6.3.12 - Extracted for complexity reduction
 * @private
 */
async function _handleFirstInstall(storageAPI, currentVersion) {
  await storageAPI.set({ [EXTENSION_VERSION_KEY]: currentVersion });
  console.log('[Background] VERSION_INIT: First install detected', {
    version: currentVersion,
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle version upgrade - clear logs and update version
 * v1.6.3.12 - Extracted for complexity reduction
 * @private
 */
async function _handleVersionUpgrade(storageAPI, storedVersion, currentVersion) {
  const previousLogCount = BACKGROUND_LOG_BUFFER.length;
  BACKGROUND_LOG_BUFFER.length = 0; // Clear the array

  await storageAPI.set({ [EXTENSION_VERSION_KEY]: currentVersion });

  console.log('[Background] VERSION_UPGRADE: Logs cleared on upgrade', {
    previousVersion: storedVersion,
    currentVersion: currentVersion,
    clearedLogCount: previousLogCount,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get current manifest version
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 * @returns {string|null} Version string or null if unavailable
 */
function _getManifestVersion() {
  const manifest = runtimeAPI?.getManifest?.();
  if (!manifest?.version) {
    console.warn('[Background] Version check skipped: manifest.version unavailable');
    return null;
  }
  return manifest.version;
}

/**
 * Handle version comparison result
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
async function _handleVersionComparison(storageAPI, storedVersion, currentVersion) {
  if (storedVersion === undefined) {
    await _handleFirstInstall(storageAPI, currentVersion);
  } else if (storedVersion !== currentVersion) {
    await _handleVersionUpgrade(storageAPI, storedVersion, currentVersion);
  } else {
    console.log('[Background] VERSION_CHECK: No version change', {
      version: currentVersion,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Check if extension version changed and clear logs if needed
 * v1.6.3.12 - Version-based log history cleanup
 * v1.6.3.12-v7 - Refactored: Extract helpers to reduce cyclomatic complexity
 * This runs early in initialization to clear logs before new logging begins
 */
async function checkVersionAndClearLogs() {
  try {
    const currentVersion = _getManifestVersion();
    if (!currentVersion) return;

    const storageAPI = _getStorageLocalAPI();
    if (!storageAPI) {
      console.warn('[Background] Version check skipped: storage.local unavailable');
      return;
    }

    const result = await storageAPI.get(EXTENSION_VERSION_KEY);
    await _handleVersionComparison(storageAPI, result?.[EXTENSION_VERSION_KEY], currentVersion);
  } catch (err) {
    console.error('[Background] VERSION_CHECK_ERROR:', err.message);
  }
}

// Run version check immediately (async, non-blocking)
// This is called early before main initialization to clear stale logs
checkVersionAndClearLogs();

// ==================== v1.6.3.12-v4 STARTUP CLEANUP ====================
// FIX: browser.storage.session doesn't exist in Firefox MV2
// Implement explicit startup cleanup to simulate session-only behavior
// Quick Tabs survive page reload but NOT browser restart

/**
 * Flag to track if startup cleanup has run this session
 * v1.6.3.12-v4 - FIX: Prevent multiple cleanups in same session
 */
let _startupCleanupCompleted = false;

/**
 * Storage key used for Quick Tabs state
 * v1.6.3.12-v4 - Must match SessionStorageAdapter and SyncStorageAdapter STORAGE_KEY
 */
const QUICK_TABS_STORAGE_KEY = 'quick_tabs_state_v2';

/**
 * Session storage key used by QuickTabStateManager
 * v1.6.3.12-v4 - Must match QuickTabStateManager sessionKey
 */
const QUICK_TABS_SESSION_KEY = 'quick_tabs_session';

/**
 * Clear Quick Tabs from storage on browser startup
 * v1.6.3.12-v4 - FIX: Explicit cleanup to simulate session-only behavior
 * This runs once per browser session to clear any Quick Tabs from previous session
 * @returns {Promise<void>}
 */
async function _clearQuickTabsOnStartup() {
  if (_startupCleanupCompleted) {
    console.log('[Background] v1.6.3.12-v4 Startup cleanup already completed this session');
    return;
  }

  try {
    const storageAPI = _getStorageLocalAPI();
    if (!storageAPI) {
      console.warn('[Background] v1.6.3.12-v4 Startup cleanup skipped: storage.local unavailable');
      _startupCleanupCompleted = true;
      return;
    }

    // Remove Quick Tabs state from storage
    await storageAPI.remove([QUICK_TABS_STORAGE_KEY, QUICK_TABS_SESSION_KEY]);

    _startupCleanupCompleted = true;

    console.log('[Background] v1.6.3.12-v4 STARTUP_CLEANUP: Quick Tabs cleared on startup', {
      keysCleared: [QUICK_TABS_STORAGE_KEY, QUICK_TABS_SESSION_KEY],
      timestamp: new Date().toISOString(),
      reason: 'session-scoped behavior (simulating storage.session via explicit cleanup)'
    });
  } catch (err) {
    console.error('[Background] v1.6.3.12-v4 STARTUP_CLEANUP_ERROR:', err.message);
    // Mark as completed even on error to prevent retry loops
    _startupCleanupCompleted = true;
  }
}

// Run startup cleanup immediately (async, non-blocking)
// This is called early before main initialization to clear Quick Tabs from previous session
_clearQuickTabsOnStartup();

// ==================== END v1.6.3.12-v4 STARTUP CLEANUP ====================

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

// ==================== CRITICAL: SYNCHRONOUS MESSAGE LISTENER REGISTRATION ====================
// v1.6.3.11-v10 - FIX 8-Second Delay Root Cause
// Per Mozilla WebExtensions spec: "Listeners must be registered synchronously at module top-level"
// This handler MUST be registered BEFORE any async initialization code runs
// The GET_CURRENT_TAB_ID handler responds IMMEDIATELY using sender.tab.id without any state checks

console.log('[INIT][Background] PHASE_START:', {
  timestamp: new Date().toISOString(),
  phase: 'EARLY_LISTENER_REGISTRATION'
});

// v1.6.3.11-v10 - CRITICAL: Early message listener for GET_CURRENT_TAB_ID
// This listener is registered synchronously at module top-level (NOT inside any async function)
// It handles the critical GET_CURRENT_TAB_ID action that content scripts need immediately
// sender.tab.id is available instantly from the message context - NO storage/state checks needed
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // v1.6.3.11-v10 - Handle GET_CURRENT_TAB_ID immediately without initialization checks
  // This is the FIX for the 8-second delay - respond instantly using sender.tab.id
  // v1.6.3.11-v11 - FIX Issue #47 Problem 1 & 3: Also return cookieStoreId for container isolation
  if (message.action === 'GET_CURRENT_TAB_ID') {
    const tabId = sender?.tab?.id;
    // v1.6.3.11-v11 - FIX Issue #47: Extract cookieStoreId for Firefox Multi-Account Container support
    const cookieStoreId = sender?.tab?.cookieStoreId ?? null;

    console.log('[INIT][Background] GET_CURRENT_TAB_ID_EARLY:', {
      timestamp: new Date().toISOString(),
      'sender.tab.id': tabId,
      'sender.tab.cookieStoreId': cookieStoreId,
      hasValidTabId: typeof tabId === 'number' && tabId > 0
    });

    if (typeof tabId === 'number' && tabId > 0) {
      // SUCCESS: Return tab ID and container ID immediately - this is the fast path
      // Response format matches QuickTabHandler._buildTabIdSuccessResponse() for consistency
      // v1.6.3.11-v11 - FIX Issue #47: Include cookieStoreId in response
      sendResponse({
        success: true,
        data: {
          currentTabId: tabId,
          cookieStoreId: cookieStoreId // v1.6.3.11-v11: Include container ID
        },
        tabId: tabId, // Backward compatibility
        cookieStoreId: cookieStoreId, // v1.6.3.11-v11: Backward compatibility
        source: 'early_listener'
      });
      return true; // Indicate we handled the response - prevents MessageRouter from processing
    }

    // sender.tab.id not available (rare edge case - maybe sidebar or devtools)
    // Return error but with retryable flag so content script can fallback
    // Response format matches QuickTabHandler._buildTabIdErrorResponse() for consistency
    console.warn('[INIT][Background] GET_CURRENT_TAB_ID_EARLY: sender.tab.id not available', {
      sender: {
        id: sender?.id,
        url: sender?.url,
        frameId: sender?.frameId,
        tab: sender?.tab ? 'present' : 'missing'
      }
    });

    sendResponse({
      success: false,
      data: { currentTabId: null, cookieStoreId: null },
      tabId: null,
      cookieStoreId: null,
      error: 'sender.tab.id not available from early listener',
      code: 'SENDER_TAB_UNAVAILABLE',
      retryable: true,
      source: 'early_listener'
    });
    return true; // Indicate we handled the response - prevents MessageRouter from processing
  }

  // Other messages are NOT handled by this early listener
  // Return false so they can be processed by the MessageRouter registered later
  return false;
});

console.log('[INIT][Background] MESSAGE_HANDLER_REGISTRATION:', {
  timestamp: new Date().toISOString(),
  handler: 'GET_CURRENT_TAB_ID_EARLY',
  status: 'REGISTERED_SYNCHRONOUSLY'
});

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

// ==================== v1.6.3.12 OPTION 4: IN-MEMORY QUICK TABS SESSION STATE ====================
// FIX: browser.storage.session does NOT exist in Firefox Manifest V2
// Background script is the SINGLE SOURCE OF TRUTH for all Quick Tabs data
// All content scripts and sidebar communicate with background via port messaging
// On browser restart, background reloads with empty memory (session-only behavior)

/**
 * Generate UUID v4 for session tracking
 * Implements RFC 4122 version 4 UUID using random values
 * The 4 indicates version 4, and y uses variant bits (8, 9, a, or b)
 * @returns {string} UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
function generateSessionUUID() {
  // RFC 4122 UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // x = random hex digit, 4 = version 4, y = variant (8,9,a,b)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * In-memory Quick Tabs session state (ephemeral - NOT persisted to disk)
 * This is the SINGLE SOURCE OF TRUTH for Quick Tabs in Option 4 architecture
 * v1.6.3.12 - FIX: Replace storage.session with background memory
 */
const quickTabsSessionState = {
  // Quick Tabs organized by origin tab ID: { [tabId]: [quickTab, ...] }
  quickTabsByTab: {},
  // Port connections from content scripts: { [tabId]: port }
  contentScriptPorts: {},
  // Sidebar port connection (if connected)
  sidebarPort: null,
  // Session metadata
  sessionId: generateSessionUUID(),
  sessionStartTime: Date.now()
};

console.log('[Background] v1.6.3.12 Quick Tabs Session State initialized:', {
  sessionId: quickTabsSessionState.sessionId,
  sessionStartTime: new Date(quickTabsSessionState.sessionStartTime).toISOString()
});

// ==================== END v1.6.3.12 OPTION 4 STATE ====================

// v1.6.3.10-v3 - Phase 2: Tab lifecycle handler instance
const tabLifecycleHandler = new TabLifecycleHandler();

// Flag to track initialization status
let isInitialized = false;

// v1.6.1.6 - Memory leak fix: State hash for deduplication
// Prevents redundant broadcasts when state hasn't actually changed
let lastBroadcastedStateHash = 0;

// v1.6.1.6 - Memory leak fix: Window for ignoring self-triggered storage events (ms)
const WRITE_IGNORE_WINDOW_MS = 100;

// v1.6.3.4-v6 - FIX Issue #1: Track in-progress storage transactions
// This prevents storage.onChanged from processing writes we just triggered
const IN_PROGRESS_TRANSACTIONS = new Set();

// v1.6.3.4-v6 - FIX Issue #5: Cooldown for storage.onChanged processing
const STORAGE_CHANGE_COOLDOWN_MS = 50;
let lastStorageChangeProcessed = 0;

// v1.6.3.4-v11 - FIX Issue #1, #8: Track last non-empty state timestamp to prevent clearing during transactions
// Also track consecutive 0-tab reads to require confirmation before clearing
let lastNonEmptyStateTimestamp = Date.now();
let consecutiveZeroTabReads = 0;
const ZERO_TAB_CLEAR_THRESHOLD = 2; // Require 2 consecutive 0-tab reads
const NON_EMPTY_STATE_COOLDOWN_MS = 1000; // Don't clear within 1 second of last non-empty state

// ==================== v1.6.3.6-v12 CONSTANTS ====================
// FIX Issue #2, #4: Heartbeat mechanism to prevent Firefox background script termination
const _HEARTBEAT_INTERVAL_MS = 25000; // 25 seconds (Firefox idle timeout is 30s)
const _HEARTBEAT_TIMEOUT_MS = 5000; // 5 second timeout for response

// FIX Issue #3: Multi-method deduplication
const DEDUP_SAVEID_TIMESTAMP_WINDOW_MS = 50; // Window for saveId+timestamp comparison

// v1.6.3.10-v7 - FIX Diagnostic Issue #9: Increased deletion acknowledgment timeout
// Previous value (1000ms) was too aggressive for slow networks or heavy tab loads
const DELETION_ACK_TIMEOUT_MS = 3000; // 3 second timeout for deletion acknowledgments
const pendingDeletionAcks = new Map(); // correlationId -> { pendingTabs: Set, completedTabs: Set, startTime, resolve, reject }

// v1.6.3.10-v7 - FIX Diagnostic Issue #6: Storage write retry queue constants
const STORAGE_WRITE_MAX_RETRIES = 3; // Maximum retry attempts for failed writes
const _STORAGE_WRITE_RETRY_DELAY_MS = 500; // Base delay between retries (reserved for future use)
const _storageWriteRetryQueue = []; // Queue of { state, retryCount, lastError } (reserved for future use)

// v1.6.3.10-v7 - FIX Diagnostic Issue #8: Enhanced storage.onChanged deduplication
const STORAGE_DEDUP_WINDOW_MS = 200; // 200ms window for event deduplication
let lastStorageEventHash = null; // Hash of last processed storage event
let lastStorageEventTimestamp = 0; // Timestamp of last processed storage event

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

// ==================== v1.6.3.12 J7: SCENARIO-LEVEL LOGGING ====================
// Optional scenario logger that logs scenario IDs (e.g., SCENARIO_10_STEP_4)
// Can be enabled via Test Bridge or debug flag

/**
 * Flag to enable scenario-level logging
 * v1.6.3.12 - J7: Set to true via Test Bridge or debug flag
 */
let _scenarioLoggingEnabled = false;

/**
 * Current scenario context for logging
 * v1.6.3.12 - J7: Set by Test Bridge when running scenario tests
 */
let _currentScenarioContext = null;

/**
 * Enable scenario logging
 * v1.6.3.12 - J7: Called by Test Bridge to enable detailed scenario tracking
 * @param {Object} context - Scenario context { scenarioId, scenarioName }
 */
function enableScenarioLogging(context = {}) {
  _scenarioLoggingEnabled = true;
  _currentScenarioContext = context;
  console.log('[Background] SCENARIO_LOGGING_ENABLED:', context);
}

/**
 * Disable scenario logging
 * v1.6.3.12 - J7: Called by Test Bridge to disable scenario tracking
 */
function disableScenarioLogging() {
  _scenarioLoggingEnabled = false;
  _currentScenarioContext = null;
  console.log('[Background] SCENARIO_LOGGING_DISABLED');
}

/**
 * Log a scenario step
 * v1.6.3.12 - J7: Optional scenario-level logging for test debugging
 * @param {string} scenarioId - Scenario identifier (e.g., 'SCENARIO_10')
 * @param {number} step - Step number
 * @param {string} description - Step description
 * @param {Object} data - Additional data to log
 */
function logScenarioStep(scenarioId, step, description, data = {}) {
  if (!_scenarioLoggingEnabled) return;

  console.log(`[SCENARIO_LOG] ${scenarioId}_STEP_${step}: ${description}`, {
    ...data,
    scenarioContext: _currentScenarioContext,
    timestamp: Date.now()
  });
}

// ==================== END v1.6.3.12 J7 ====================

// ==================== v1.6.3.10-v4 CONSTANTS ====================
// FIX Issue #3/6: Firefox timeout recovery - transaction cleanup
const TRANSACTION_TIMEOUT_MS = 30000; // 30s - matches Firefox background timeout
const TRANSACTION_CLEANUP_INTERVAL_MS = 10000; // 10s - cleanup stale transactions
// Map to track transaction start times: transactionId -> startTime
const transactionStartTimes = new Map();

// FIX Issue #7: State divergence detection - write retry timeout
// Note: Reserved constant for future storage write retry sequence implementation
const _STORAGE_WRITE_SEQUENCE_TIMEOUT_MS = 15000; // 15s max for entire retry sequence

// FIX Enhancement #1 & #2: Scripting API fallback for messaging failures
const MESSAGING_TIMEOUT_MS = 2000; // 2s timeout for messaging before fallback

/**
 * Generate unique correlation ID for tracing operations
 * v1.6.3.10-v5 - FIX Code Review: Extracted to reduce duplication
 * @param {string} prefix - Prefix for the ID (e.g., 'exec', 'cmd')
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId(prefix = 'op') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a timeout promise for Promise.race() usage
 * v1.6.3.10-v5 - FIX Code Review: Extracted to reduce duplication
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} errorMessage - Error message for timeout
 * @returns {Promise<never>} Promise that rejects after timeout
 */
function createTimeoutPromise(timeoutMs, errorMessage = 'Operation timeout') {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs));
}

// FIX Issue #3/6: Background restart detection - track startup time
const backgroundStartupTime = Date.now();
// Note: Reserved constant for future restart tracking implementation
const _backgroundRestartCount = 0; // Reserved for future use tracking restarts

// ==================== v1.6.3.7 KEEPALIVE MECHANISM ====================
// FIX Issue #1: Firefox 117+ Bug 1851373 - runtime.Port does NOT reset the idle timer
// Use runtime.sendMessage periodically as it DOES reset the idle timer
let keepaliveIntervalId = null;

/**
 * Start keepalive interval to reset Firefox's idle timer
 * v1.6.3.7 - FIX Issue #1: Use browser.runtime.sendMessage to reset idle timer
 */
function startKeepalive() {
  if (keepaliveIntervalId) {
    clearInterval(keepaliveIntervalId);
  }

  // Immediate ping to register activity
  triggerIdleReset();

  keepaliveIntervalId = setInterval(() => {
    triggerIdleReset();
  }, KEEPALIVE_INTERVAL_MS);

  console.log('[Background] v1.6.3.7 Keepalive started (every', KEEPALIVE_INTERVAL_MS / 1000, 's)');
}

/**
 * Trigger idle timer reset using tabs.query and sendMessage
 * v1.6.3.7 - FIX Issue #1: Firefox treats tabs.query and runtime.sendMessage as activity
 */
async function triggerIdleReset() {
  try {
    // Method 1: browser.tabs.query triggers event handlers which reset idle timer
    const tabs = await browser.tabs.query({});

    // Method 2: Self-send a message (this resets the idle timer)
    // Note: This will be caught by our own listener but that's fine
    try {
      await browser.runtime.sendMessage({ type: 'KEEPALIVE_PING', timestamp: Date.now() });
    } catch (_err) {
      // Expected to fail if no listener, but the message send itself resets the timer
    }

    console.log('[Background] KEEPALIVE: idle timer reset via tabs.query + sendMessage', {
      tabCount: tabs.length,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Background] KEEPALIVE: trigger failed:', err.message);
  }
}

/**
 * Stop keepalive interval
 * v1.6.3.7 - FIX Issue #1: Cleanup function
 */
function _stopKeepalive() {
  if (keepaliveIntervalId) {
    clearInterval(keepaliveIntervalId);
    keepaliveIntervalId = null;
    console.log('[Background] v1.6.3.7 Keepalive stopped');
  }
}

// Start keepalive on script load
startKeepalive();

// v1.6.3.10-v3 - Phase 2: Initialize Tab Lifecycle Handler
tabLifecycleHandler.start();

// ==================== v1.6.3.10-v4 TRANSACTION TIMEOUT CLEANUP ====================
// FIX Issue #7: Clean up stale transactions that may have been abandoned due to Firefox timeout

/**
 * Track a new transaction with start time
 * v1.6.3.10-v4 - FIX Issue #7: Track when transactions start for timeout cleanup
 * Note: Exported API for use by storage write operations
 * @param {string} transactionId - Transaction ID to track
 */
function _trackTransaction(transactionId) {
  if (!transactionId) return;
  IN_PROGRESS_TRANSACTIONS.add(transactionId);
  transactionStartTimes.set(transactionId, Date.now());
  console.log('[Background] v1.6.3.10-v4 Transaction tracked:', {
    transactionId,
    activeCount: IN_PROGRESS_TRANSACTIONS.size
  });
}

/**
 * Complete a transaction and remove from tracking
 * v1.6.3.10-v4 - FIX Issue #7: Clean completion of transaction
 * Note: Exported API for use by storage write operations
 * @param {string} transactionId - Transaction ID to complete
 */
function _completeTransaction(transactionId) {
  if (!transactionId) return;
  IN_PROGRESS_TRANSACTIONS.delete(transactionId);
  transactionStartTimes.delete(transactionId);
  console.log('[Background] v1.6.3.10-v4 Transaction completed:', {
    transactionId,
    remainingCount: IN_PROGRESS_TRANSACTIONS.size
  });
}

/**
 * Clean up stale transactions that have exceeded the timeout
 * v1.6.3.10-v4 - FIX Issue #7: Prevent stale transactionIds from blocking deduplication
 */
function cleanupStaleTransactions() {
  const now = Date.now();
  const staleTransactions = [];

  for (const [transactionId, startTime] of transactionStartTimes.entries()) {
    if (now - startTime > TRANSACTION_TIMEOUT_MS) {
      staleTransactions.push({ transactionId, startTime, ageMs: now - startTime });
    }
  }

  if (staleTransactions.length > 0) {
    console.warn('[Background] v1.6.3.10-v4 Cleaning up stale transactions:', {
      count: staleTransactions.length,
      transactions: staleTransactions
    });

    for (const { transactionId } of staleTransactions) {
      IN_PROGRESS_TRANSACTIONS.delete(transactionId);
      transactionStartTimes.delete(transactionId);
    }
  }
}

// Start transaction cleanup interval
const _transactionCleanupIntervalId = setInterval(
  cleanupStaleTransactions,
  TRANSACTION_CLEANUP_INTERVAL_MS
);

console.log(
  '[Background] v1.6.3.10-v4 Transaction cleanup started (every',
  TRANSACTION_CLEANUP_INTERVAL_MS / 1000,
  's)'
);

// ==================== v1.6.3.10-v4 SCRIPTING API FALLBACK ====================
// FIX Enhancement #1 & #2: Scripting API injection for atomic operations and timeout recovery

/**
 * Execute operation with messaging, falling back to Scripting API if messaging fails
 * v1.6.3.10-v4 - FIX Enhancement #1 & #2: Atomic operations + timeout recovery
 * v1.6.3.10-v5 - FIX Code Review: Use extracted helper functions
 * Note: Exported API - call from EXECUTE_COMMAND handlers when messaging fails
 * @param {number} tabId - Browser tab ID to execute operation in
 * @param {string} operation - Operation type (e.g., 'RESTORE_QUICK_TAB', 'MINIMIZE_QUICK_TAB')
 * @param {Object} params - Parameters for the operation
 * @returns {Promise<Object>} Operation result
 */
async function _executeWithScriptingFallback(tabId, operation, params) {
  const correlationId = generateCorrelationId('exec');

  console.log('[Background] v1.6.3.10-v4 executeWithScriptingFallback:', {
    tabId,
    operation,
    correlationId
  });

  try {
    // Try messaging first (fast path)
    const result = await Promise.race([
      browser.tabs.sendMessage(tabId, { type: operation, ...params, correlationId }),
      createTimeoutPromise(MESSAGING_TIMEOUT_MS, 'Messaging timeout')
    ]);

    console.log('[Background] v1.6.3.10-v4 Messaging succeeded:', {
      operation,
      correlationId,
      result
    });
    return result;
  } catch (err) {
    // Messaging failed - fall back to Scripting API
    console.log('[Background] v1.6.3.10-v4 Messaging failed, falling back to Scripting API:', {
      operation,
      error: err.message,
      correlationId
    });
    return _executeViaScripting(tabId, operation, params, correlationId);
  }
}

/**
 * Execute operation via Scripting API injection
 * v1.6.3.10-v4 - FIX Enhancement #2: Direct execution without messaging dependency
 * @param {number} tabId - Browser tab ID
 * @param {string} operation - Operation type
 * @param {Object} params - Operation parameters
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Operation result
 */
async function _executeViaScripting(tabId, operation, params, correlationId) {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: executeScriptedOperation,
      args: [operation, params, correlationId]
    });

    const result = results[0]?.result;
    console.log('[Background] v1.6.3.10-v4 Scripting API execution result:', {
      operation,
      correlationId,
      result
    });
    return result || { success: false, error: 'No result from scripted execution' };
  } catch (err) {
    console.error('[Background] v1.6.3.10-v4 Scripting API failed:', {
      operation,
      error: err.message,
      correlationId
    });
    return { success: false, error: err.message, fallbackFailed: true };
  }
}

/**
 * Scripted operation function injected into content script context
 * v1.6.3.10-v4 - FIX Enhancement #1: Atomic execution in content script
 * v1.6.3.12 - Extracted complex conditional for improved readability
 * IMPORTANT: This function runs in the content script context via browser.scripting.executeScript
 * It must be COMPLETELY SELF-CONTAINED - no external function references allowed!
 * @param {string} operation - Operation type
 * @param {Object} params - Operation parameters
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Object} Operation result
 */
/**
 * Execute a single scripted operation handler
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce executeScriptedOperation complexity
 * @private
 * @param {Object} manager - Quick Tabs manager
 * @param {string} operation - Operation to execute
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean|null} true if succeeded, false if handler unavailable, null if unknown operation
 */
function _executeScriptedOperationHandler(manager, operation, quickTabId) {
  // v1.6.3.11-v9 - Use lookup table pattern to reduce cyclomatic complexity
  const operationHandlers = {
    RESTORE_QUICK_TAB: () => {
      if (!manager.restoreById) return false;
      manager.restoreById(quickTabId, 'scripting-fallback');
      return true;
    },
    MINIMIZE_QUICK_TAB: () => {
      if (!manager.minimizeById) return false;
      manager.minimizeById(quickTabId, 'scripting-fallback');
      return true;
    },
    CLOSE_QUICK_TAB: () => {
      if (!manager.closeById) return false;
      manager.closeById(quickTabId);
      return true;
    },
    FOCUS_QUICK_TAB: () => {
      if (!manager.visibilityHandler?.handleFocus) return false;
      manager.visibilityHandler.handleFocus(quickTabId, 'scripting-fallback');
      return true;
    }
  };

  const handler = operationHandlers[operation];
  return handler ? handler() : null;
}

function executeScriptedOperation(operation, params, correlationId) {
  // Access the Quick Tabs manager from content script globals
  // Validate structure to guard against tampering in content script context
  const extension = window.CopyURLExtension;

  // v1.6.3.12 - Extracted predicate to reduce complex conditional
  const isValidManager =
    extension &&
    typeof extension === 'object' &&
    extension.quickTabsManager &&
    typeof extension.quickTabsManager === 'object';

  if (!isValidManager) {
    return { success: false, error: 'QuickTabsManager not available', correlationId };
  }

  const manager = extension.quickTabsManager;
  const quickTabId = params.quickTabId;

  console.log('[Content-Injected] v1.6.3.10-v4 Executing scripted operation:', {
    operation,
    quickTabId,
    correlationId
  });

  try {
    const result = _executeScriptedOperationHandler(manager, operation, quickTabId);

    if (result === null) {
      return { success: false, error: `Unknown operation: ${operation}`, correlationId };
    }

    if (result) {
      return { success: true, operation, quickTabId, correlationId };
    }

    return { success: false, error: 'Handler not available', correlationId };
  } catch (err) {
    return { success: false, error: err.message, correlationId };
  }
}

// ==================== v1.6.3.10-v4 BACKGROUND RESTART DETECTION ====================
// FIX Issue #3/6: Notify content scripts of background restart for port reconnection

/**
 * Get background script startup info for port handshake
 * v1.6.3.10-v4 - FIX Issue #3/6: Background restart detection
 * @returns {Object} Startup info
 */
function getBackgroundStartupInfo() {
  return {
    startupTime: backgroundStartupTime,
    restartCount: _backgroundRestartCount,
    uptime: Date.now() - backgroundStartupTime
  };
}

// ==================== END v1.6.3.10-v4 ADDITIONS ====================

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
 * v1.6.3.12-v7 - Refactored: Extracted helpers to reduce complex conditionals
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
 * v1.6.3.12 - J6: Fields included in hash are documented in return object
 * @param {Object} tab - Tab object
 * @returns {Object} Normalized tab data for hashing
 */
function _extractTabDataForHash(tab) {
  // v1.6.3.12 - J6: These are ALL fields that participate in hash computation
  // If any of these change, the hash will change, triggering a state update
  return {
    id: tab.id,
    url: tab.url,
    left: tab.left ?? tab.position?.left,
    top: tab.top ?? tab.position?.top,
    width: tab.width ?? tab.size?.width,
    height: tab.height ?? tab.size?.height,
    minimized: tab.minimized ?? tab.visibility?.minimized
    // Note: originContainerId IS NOT in hash - container changes don't trigger re-render alone
    // Note: originTabId IS NOT in hash - tab ownership changes handled separately
  };
}

/**
 * Fields included in state hash computation
 * v1.6.3.12 - J6: Exported constant for logging purposes
 * @private
 */
const _HASH_FIELDS = ['id', 'url', 'left', 'top', 'width', 'height', 'minimized', 'saveId'];

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
 * v1.5.8.13 - EAGER LOADING: Initialize global state from storage on extension startup
 * v1.6.2.2 - Simplified for unified format
 * v1.6.3.6-v12 - FIX Issue #1: Proper error handling - don't set isInitialized on failure
 * v1.6.3.6-v12 - FIX Code Review: Added retry limit to prevent infinite loop
 */
/**
 * Log initialization completion
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce initializeGlobalState complexity
 * v1.6.3.10-v10 - FIX Issue #6: Add [INIT] boundary logging
 * @private
 */
function _logInitializationComplete(source, initStartTime) {
  const durationMs = Date.now() - initStartTime;
  const tabCount = globalQuickTabState.tabs?.length || 0;

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging
  console.log('[INIT][Background] STORAGE_LOAD_COMPLETE:', {
    source,
    tabCount,
    durationMs,
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Background] PHASE_COMPLETE:', {
    success: true,
    source,
    tabCount,
    durationMs,
    isInitialized: true,
    timestamp: new Date().toISOString()
  });

  console.log(`[Background] Initialization complete from ${source}:`, {
    tabCount,
    durationMs
  });
}

/**
 * Handle initialization failure with retry logic
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce initializeGlobalState complexity
 * v1.6.3.10-v10 - FIX Issue #6: Add [INIT] boundary logging
 * @private
 */
function _handleInitializationFailure(err, initStartTime) {
  const durationMs = Date.now() - initStartTime;

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for failure
  console.error('[INIT][Background] PHASE_FAILED:', {
    error: err.message,
    durationMs,
    retryCount: initializationRetryCount,
    maxRetries: MAX_INITIALIZATION_RETRIES,
    willRetry: initializationRetryCount < MAX_INITIALIZATION_RETRIES,
    timestamp: new Date().toISOString()
  });

  console.error('[Background] INITIALIZATION FAILED:', {
    error: err.message,
    durationMs,
    retryCount: initializationRetryCount,
    maxRetries: MAX_INITIALIZATION_RETRIES
  });

  if (initializationRetryCount < MAX_INITIALIZATION_RETRIES) {
    initializationRetryCount++;
    const backoffMs = Math.pow(2, initializationRetryCount) * 500;
    console.log('[INIT][Background] RETRY_SCHEDULED:', {
      attempt: initializationRetryCount,
      maxRetries: MAX_INITIALIZATION_RETRIES,
      backoffMs,
      timestamp: new Date().toISOString()
    });
    console.log(
      `[Background] Retrying initialization in ${backoffMs}ms (attempt ${initializationRetryCount}/${MAX_INITIALIZATION_RETRIES})`
    );
    setTimeout(() => initializeGlobalState(), backoffMs);
  } else {
    console.error('[INIT][Background] MAX_RETRIES_EXCEEDED:', {
      totalAttempts: initializationRetryCount + 1,
      fallback: 'empty state',
      timestamp: new Date().toISOString()
    });
    console.error('[Background] Max retries exceeded - marking as initialized with empty state');
    globalQuickTabState.tabs = [];
    globalQuickTabState.lastUpdate = Date.now();
    isInitialized = true;
  }
}

async function initializeGlobalState() {
  if (isInitialized) {
    console.log('[Background] State already initialized');
    return;
  }

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for initialization phases
  console.log('[INIT][Background] PHASE_START: Beginning state initialization', {
    timestamp: new Date().toISOString(),
    isInitialized: false
  });
  const initStartTime = Date.now();

  try {
    console.log('[INIT][Background] STORAGE_LOAD_START:', {
      timestamp: new Date().toISOString()
    });

    const loaded = await tryLoadFromSessionStorage();
    if (loaded) {
      initializationRetryCount = 0;
      _logInitializationComplete('session storage', initStartTime);
      return;
    }

    await tryLoadFromSyncStorage();
    initializationRetryCount = 0;
    _logInitializationComplete('local storage', initStartTime);
  } catch (err) {
    _handleInitializationFailure(err, initStartTime);
  }
}

/**
 * Check if local storage has valid session state
 * v1.6.3.4-v11 - Extracted to reduce complexity and fix complex conditional
 * v1.6.3.12-v4 - FIX: Updated to reference storage.local (storage.session not available in Firefox MV2)
 * @param {Object} result - Result from browser.storage.local.get()
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
 * Helper: Try loading from local storage (session-scoped via explicit cleanup)
 * v1.6.3.4-v11 - Refactored: Extracted helpers to reduce cc below 9
 * v1.6.3.12-v4 - FIX: Use storage.local instead of storage.session (Firefox MV2 compatibility)
 *
 * @returns {Promise<boolean>} True if loaded successfully
 */
async function tryLoadFromSessionStorage() {
  // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
  if (typeof browser.storage.local === 'undefined') {
    return false;
  }

  const result = await browser.storage.local.get('quick_tabs_session');

  // Guard: No data in local storage
  if (!_hasValidSessionState(result)) {
    return false;
  }

  const sessionState = result.quick_tabs_session;

  // v1.6.2.2 - Unified format
  if (_hasValidTabsArray(sessionState)) {
    _applyUnifiedFormatState(sessionState, 'local storage (session-scoped)', 'v1.6.2.2 unified');
    return true;
  }

  // Backward compatibility: container format migration
  if (sessionState.containers) {
    _applyMigratedContainerState(sessionState, 'local storage (session-scoped)');
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
 * Helper: Get storage state from local storage (session-scoped via explicit cleanup)
 * v1.6.3.12-v7 - FIX: Use storage.session for Quick Tabs (session-only)
 * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
 * Quick Tabs are cleared on browser restart via explicit startup cleanup
 * @private
 * @returns {Promise<Object|null>} Storage state or null
 */
async function _getStorageState() {
  // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
  // Session-only behavior achieved via explicit startup cleanup in _clearQuickTabsOnStartup()
  if (typeof browser.storage.local === 'undefined') {
    console.log('[Background] storage.local unavailable, returning null');
    return null;
  }
  const result = await browser.storage.local.get('quick_tabs_state_v2');
  return result?.quick_tabs_state_v2 || null;
}

/**
 * Helper: Try loading from sync storage
 * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
 * v1.6.2.2 - Updated for unified format
 * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
 *
 * @returns {Promise<void>}
 */
async function tryLoadFromSyncStorage() {
  const state = await _getStorageState();

  // Guard: No data - this is expected on fresh browser start
  // v1.6.3.12-v4 - Quick Tabs are now session-scoped via explicit startup cleanup
  if (!state) {
    console.log(
      '[Background] ✓ EAGER LOAD: No local state found, starting with empty state (session-scoped)'
    );
    isInitialized = true;
    return;
  }

  // v1.6.2.2 - Unified format
  if (state.tabs && Array.isArray(state.tabs)) {
    globalQuickTabState.tabs = state.tabs;
    globalQuickTabState.lastUpdate = state.timestamp || Date.now();
    logSuccessfulLoad('local storage', 'v1.6.2.2 unified (session-scoped)');
    isInitialized = true;
    return;
  }

  // v1.6.3.12-v4 - No migration needed for session-scoped storage
  // Container format migration removed - Quick Tabs don't persist across sessions
  isInitialized = true;
}

/**
 * Helper: Save migrated state to unified format
 * v1.6.2.2 - Save in new unified format
 * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
 *
 * @returns {Promise<void>}
 */
async function saveMigratedToUnifiedFormat() {
  const saveId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
    if (typeof browser.storage.local === 'undefined') {
      console.warn('[Background] storage.local unavailable, cannot save migrated state');
      return;
    }
    await browser.storage.local.set({
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        saveId: saveId,
        timestamp: Date.now()
      }
    });
    console.log('[Background] ✓ Migrated to v1.6.2.2 unified format (session-scoped)');
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

// v1.6.3.11-v12 - Removed migration functions (Solo/Mute feature removed)

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
   * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
   *
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async tryLoadFromSessionStorage() {
    // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
    if (typeof browser.storage.local === 'undefined') {
      return false;
    }

    const result = await browser.storage.local.get('quick_tabs_session');

    // Guard: No valid data
    if (!this._hasValidSessionData(result)) {
      return false;
    }

    this.globalState = result.quick_tabs_session;
    this.initialized = true;
    console.log(
      '[STATE COORDINATOR] Initialized from local storage (session-scoped):',
      this.globalState.tabs.length,
      'tabs'
    );
    return true;
  }

  /**
   * Helper: Try loading from local storage (session-scoped)
   * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
   * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
   *
   * @returns {Promise<void>}
   */
  async tryLoadFromSyncStorage() {
    // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
    if (typeof browser.storage.local === 'undefined') {
      this.initialized = true;
      console.log('[STATE COORDINATOR] storage.local unavailable, starting fresh');
      return;
    }

    const result = await browser.storage.local.get('quick_tabs_state_v2');

    // Guard: No data - this is expected on fresh browser start
    if (!result || !result.quick_tabs_state_v2) {
      this.initialized = true;
      console.log('[STATE COORDINATOR] No local state found, starting fresh (session-scoped)');
      return;
    }

    // Load data based on format
    this.loadStateFromSyncData(result.quick_tabs_state_v2);
    this.initialized = true;
    console.log(
      '[STATE COORDINATOR] Initialized from local storage (session-scoped):',
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
   * Find tab index in global state, logging if not found
   * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce duplication
   * @private
   */
  _findTabIndex(quickTabId, operation) {
    const index = this.globalState.tabs.findIndex(t => t.id === quickTabId);
    if (index === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for ${operation}`);
    }
    return index;
  }

  /**
   * Helper: Handle update operation
   */
  handleUpdateOperation(quickTabId, data) {
    const index = this._findTabIndex(quickTabId, 'update');
    if (index === -1) return;
    this.globalState.tabs[index] = { ...this.globalState.tabs[index], ...data };
    console.log(`[STATE COORDINATOR] Updated Quick Tab ${quickTabId}`);
  }

  /**
   * Helper: Handle delete operation
   */
  handleDeleteOperation(quickTabId) {
    const index = this._findTabIndex(quickTabId, 'delete');
    if (index === -1) return;
    this.globalState.tabs.splice(index, 1);
    console.log(`[STATE COORDINATOR] Deleted Quick Tab ${quickTabId}`);
  }

  /**
   * Helper: Handle minimize operation
   */
  handleMinimizeOperation(quickTabId, data) {
    const index = this.globalState.tabs.findIndex(t => t.id === quickTabId);
    if (index !== -1) {
      this.globalState.tabs[index].minimized = true;
      console.log(`[STATE COORDINATOR] Minimized Quick Tab ${quickTabId}`);
    } else if (data) {
      this.globalState.tabs.push({ ...data, minimized: true });
      console.log(`[STATE COORDINATOR] Created minimized Quick Tab ${quickTabId}`);
    }
  }

  /**
   * Helper: Handle restore operation
   */
  handleRestoreOperation(quickTabId) {
    const index = this._findTabIndex(quickTabId, 'restore');
    if (index === -1) return;
    this.globalState.tabs[index].minimized = false;
    console.log(`[STATE COORDINATOR] Restored Quick Tab ${quickTabId}`);
  }

  /**
   * Persist state to storage
   * v1.6.0.12 - FIX: Use local storage to avoid quota errors
   * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
   */
  async persistState() {
    try {
      // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
      // Session-only behavior achieved via explicit startup cleanup in _clearQuickTabsOnStartup()
      if (typeof browser.storage.local !== 'undefined') {
        await browser.storage.local.set({
          quick_tabs_state_v2: this.globalState
        });
        // Also save to quick_tabs_session for backward compatibility
        await browser.storage.local.set({
          quick_tabs_session: this.globalState
        });
      }

      console.log('[STATE COORDINATOR] Persisted state to local storage (session-scoped)');
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

// Clean up state when tab is closed
// v1.6.3.11-v12 - Simplified: Solo/Mute cleanup removed, only clean up quickTabStates map
chrome.tabs.onRemoved.addListener(tabId => {
  quickTabStates.delete(tabId);
  console.log(`[Background] Tab ${tabId} closed - removed from quickTabStates`);
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

// v1.6.3.11-v8 - FIX Issue #10: Wire up transaction tracking to QuickTabHandler
// This enables storage write deduplication via _isTransactionSelfWrite()
quickTabHandler.setTransactionCallbacks(_trackTransaction, _completeTransaction);

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
// v1.6.3.12-v3 - FIX Issue F: Notify sidebar after Quick Tab creation via runtime.sendMessage
// The handleCreate returns a result, and we notify the sidebar if creation was successful
messageRouter.register('CREATE_QUICK_TAB', async (msg, sender) => {
  const result = await quickTabHandler.handleCreate(msg, sender);
  // v1.6.3.12-v3 - FIX Issue F: Notify sidebar if creation was successful
  if (result?.success && !result?.duplicate) {
    notifySidebarOfStateChange();
    console.log('[Background] v1.6.3.12-v3 CREATE_QUICK_TAB: Notified sidebar of state change', {
      quickTabId: msg.id,
      success: result.success
    });
  }
  return result;
});
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
// v1.6.3.11-v12 - Removed UPDATE_QUICK_TAB_SOLO and UPDATE_QUICK_TAB_MUTE registrations (Solo/Mute feature removed)
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

    // v1.6.3.12-v4 - FIX: Clear local storage (storage.session not available in Firefox MV2)
    // Step 1: Clear local storage (primary storage for Quick Tabs - session-scoped via explicit cleanup)
    if (typeof browser.storage.local !== 'undefined') {
      await browser.storage.local.remove('quick_tabs_state_v2');
      await browser.storage.local.remove('quick_tabs_session');
    }

    // Step 2: Reset background's cache
    globalQuickTabState.tabs = [];
    globalQuickTabState.lastUpdate = Date.now();
    globalQuickTabState.saveId = `cleared-${Date.now()}`;
    lastBroadcastedStateHash = 0;

    // v1.6.3.5-v8 - FIX Issue #7: Clear quickTabHostTabs to prevent phantom Quick Tabs
    quickTabHostTabs.clear();

    // Step 3: Broadcast to all tabs to clear LOCAL state only (no storage write)
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
 * Apply unified format state to global state from storage
 * v1.6.3.4-v11 - Extracted from _updateGlobalStateFromStorage to reduce complexity
 * v1.6.3.6-v12 - FIX Issue #7: Enhanced logging with before/after state snapshots
 * @param {Object} newValue - Storage value with tabs array
 */
/**
 * Build state snapshot for cache update logging
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce _applyUnifiedFormatFromStorage complexity
 * @private
 * @param {Object} state - Global state object
 * @returns {Object} State snapshot with tabCount, saveId, tabIds
 */
function _buildCacheStateSnapshot(state) {
  const tabs = state.tabs || [];
  return {
    tabCount: tabs.length,
    saveId: state.saveId,
    tabIds: tabs.slice(0, 5).map(t => t.id) // Sample first 5 for logging
  };
}

function _applyUnifiedFormatFromStorage(newValue) {
  // v1.6.3.6-v12 - FIX Issue #7: Log before state for before/after comparison
  const beforeState = _buildCacheStateSnapshot(globalQuickTabState);

  globalQuickTabState.tabs = newValue.tabs;
  globalQuickTabState.lastUpdate = newValue.timestamp || Date.now();
  // v1.6.3.4 - FIX Bug #7: Track saveId for hash collision detection
  globalQuickTabState.saveId = newValue.saveId || null;

  // v1.6.3.6-v12 - FIX Issue #7: Log after state with comparison
  const afterState = _buildCacheStateSnapshot(globalQuickTabState);

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
 * v1.6.3.12-v7 - Refactored: Extracted helpers to reduce cyclomatic complexity
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

// ==================== v1.6.3.11-v8 STORAGE EVENT LOGGING HELPERS ====================
// FIX Diagnostic Logging #1: Helper functions for storage.onChanged event cascade logging

/**
 * Classify the source of a storage write for diagnostic logging
 * v1.6.3.11-v8 - FIX Diagnostic Logging #1: Identify write source
 * @param {Object} newValue - New storage value
 * @returns {string} Classification: 'self-write' | 'external-write' | 'other-extension'
 */
function _classifyWriteSource(newValue) {
  if (!newValue) return 'unknown';

  // Check for transaction ID (our own writes track this)
  const transactionId = newValue.transactionId;
  if (transactionId && IN_PROGRESS_TRANSACTIONS.has(transactionId)) {
    return 'self-write';
  }

  // Check for write source ID pattern
  const writeSourceId = newValue.writeSourceId;
  if (writeSourceId && writeSourceId.startsWith('bg-')) {
    return 'self-write';
  }

  // Check for writing tab ID or instance ID (content script writes)
  if (newValue.writingTabId || newValue.writingInstanceId) {
    return 'external-write';
  }

  // No identifiable source
  return 'other-extension';
}

/**
 * Check if a single field changed between old and new values
 * v1.6.3.11-v8 - FIX Code Health: Extracted to reduce _identifyChangedFields complexity
 * @private
 */
function _checkFieldChange(oldValue, newValue, fieldName) {
  const oldVal = oldValue?.[fieldName];
  const newVal = newValue?.[fieldName];
  return oldVal !== newVal ? fieldName : null;
}

/**
 * Get the tab count from a storage value safely
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce complexity
 * @private
 * @param {Object} value - Storage value
 * @returns {number} Tab count (0 if missing)
 */
function _getTabCount(value) {
  return value?.tabs?.length ?? 0;
}

/**
 * Check if tabs content has changed (for same count comparison)
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce complexity
 * @private
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if content changed
 */
function _hasTabsContentChanged(oldValue, newValue) {
  return JSON.stringify(oldValue?.tabs) !== JSON.stringify(newValue?.tabs);
}

/**
 * Check if tabs array changed between old and new values
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce _identifyChangedFields complexity
 * @private
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @returns {string|null} Description of tabs change, or null if unchanged
 */
function _checkTabsArrayChange(oldValue, newValue) {
  const oldTabCount = _getTabCount(oldValue);
  const newTabCount = _getTabCount(newValue);

  // Fast path: count changed
  if (oldTabCount !== newTabCount) {
    return `tabs (${oldTabCount}→${newTabCount})`;
  }

  // Slow path: same count, check content (only when non-empty)
  if (oldTabCount > 0 && _hasTabsContentChanged(oldValue, newValue)) {
    return 'tabs (content changed)';
  }

  return null;
}

/**
 * Identify which fields changed between old and new storage values
 * v1.6.3.11-v8 - FIX Diagnostic Logging #1: Detailed change tracking
 * v1.6.3.11-v9 - FIX Code Health: Refactored to reduce complexity (cc: 13 → 6)
 * NOTE: JSON.stringify is used for diagnostic logging only. For performance-critical
 * comparisons, use hash-based approaches. This is acceptable here as it only runs
 * during storage events (infrequent) and provides accurate change detection.
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @returns {string[]} List of changed field names
 */
function _identifyChangedFields(oldValue, newValue) {
  const changedFields = [];

  // Check tabs array changes
  const tabsChange = _checkTabsArrayChange(oldValue, newValue);
  if (tabsChange) {
    changedFields.push(tabsChange);
  }

  // Check simple fields using helper
  const simpleFields = ['saveId', 'timestamp', 'version', 'transactionId'];
  for (const field of simpleFields) {
    const result = _checkFieldChange(oldValue, newValue, field);
    if (result) changedFields.push(result);
  }

  return changedFields.length > 0 ? changedFields : ['none'];
}

// ==================== END STORAGE EVENT LOGGING HELPERS ====================

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
  // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Entry/exit with timing
  const handlerStartTime = Date.now();
  console.log('[Storage][Event] storage.onChanged triggered', {
    handlerName: '_handleQuickTabStateChange',
    timestamp: new Date().toISOString()
  });

  const newValue = changes.quick_tabs_state_v2.newValue;
  const oldValue = changes.quick_tabs_state_v2.oldValue;

  // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Classify write source
  const writeSource = _classifyWriteSource(newValue);
  console.log('[Storage][Event] Cause:', writeSource);

  // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Log version changes if available
  const prevVersion = oldValue?.version ?? 'N/A';
  const newVersion = newValue?.version ?? 'N/A';
  console.log('[Storage][Event] Previous version:', prevVersion);
  console.log('[Storage][Event] New version:', newVersion);

  // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Log changed fields
  const changedFields = _identifyChangedFields(oldValue, newValue);
  console.log('[Storage][Event] Changed fields:', changedFields);

  // v1.6.3.4-v8 - Log state change for debugging
  _logStorageChange(oldValue, newValue);

  // v1.6.3.4-v8 - Check early exit conditions
  console.log('[Storage][Event] Processing handler: _handleQuickTabStateChange');
  if (_shouldIgnoreStorageChange(newValue, oldValue)) {
    // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Log deduplication result
    console.log('[Storage][Event] Deduplication result: skipped');
    const handlerDuration = Date.now() - handlerStartTime;
    console.log('[Storage][Event] Handler completed in', handlerDuration + 'ms');
    return;
  }

  // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Log deduplication result
  console.log('[Storage][Event] Deduplication result: processed');

  // v1.6.3.4-v8 - Process and cache the update
  _processStorageUpdate(newValue);

  // v1.6.3.11-v8 - FIX Diagnostic Logging #1: Log completion time
  const handlerDuration = Date.now() - handlerStartTime;
  console.log('[Storage][Event] Handler completed in', handlerDuration + 'ms');
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
 * v1.6.3.12-v7 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 */
function _logStorageChange(oldValue, newValue) {
  const oldCount = _getTabCount(oldValue);
  const newCount = _getTabCount(newValue);

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for storage changes
  console.log('[Background][Storage] CHANGE_RECEIVED: Storage change event detected', {
    key: 'quick_tabs_state_v2',
    hasOldValue: !!oldValue,
    hasNewValue: !!newValue,
    tabCountBefore: oldCount,
    tabCountAfter: newCount
  });

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

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for deduplication
  console.log('[Background][Storage] DEDUP_CHECK: Evaluating deduplication', {
    method: dedupResult.method,
    saveId: newValue?.saveId,
    transactionId: newValue?.transactionId,
    contentHash: _computeQuickTabContentKey(newValue) || 'N/A',
    result: dedupResult.shouldSkip ? 'SKIP' : 'PROCESS'
  });

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
 * Multi-method deduplication for storage changes
 * v1.6.3.6-v12 - FIX Issue #3: Check multiple dedup methods in priority order
 * v1.6.3.10-v5 - FIX Diagnostic Issue #3: Enhanced self-write detection logging
 * v1.6.3.10-v7 - FIX Diagnostic Issue #8: Enhanced deduplication with 200ms window and content hash
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @returns {{ shouldSkip: boolean, method: string, reason: string }}
 */
/**
 * Check timestamp window deduplication
 * v1.6.3.10-v8 - FIX Code Health: Extracted for dedup checks
 * @private
 */
function _checkTimestampWindowDedup(newValue, now) {
  const eventHash = _computeEventDeduplicationHash(newValue);
  if (
    lastStorageEventHash === eventHash &&
    now - lastStorageEventTimestamp < STORAGE_DEDUP_WINDOW_MS
  ) {
    return {
      method: 'timestamp-window',
      reason: `Duplicate event within ${STORAGE_DEDUP_WINDOW_MS}ms window`
    };
  }
  lastStorageEventHash = eventHash;
  lastStorageEventTimestamp = now;
  return null;
}

/**
 * Check transaction-based self-write deduplication
 * v1.6.3.10-v8 - FIX Code Review: Extracted for readability
 * @private
 */
function _checkTransactionDedup(newValue) {
  if (!_isTransactionSelfWrite(newValue)) return null;
  return { method: 'transactionId', reason: `Transaction ${newValue.transactionId} in progress` };
}

/**
 * Check saveId+timestamp deduplication
 * v1.6.3.10-v8 - FIX Code Review: Extracted for readability
 * @private
 */
function _checkSaveIdDedup(newValue, oldValue) {
  if (!_isSaveIdTimestampDuplicate(newValue, oldValue)) return null;
  return { method: 'saveId+timestamp', reason: 'Same saveId and timestamp within window' };
}

/**
 * Check content hash deduplication
 * v1.6.3.10-v8 - FIX Code Review: Extracted for readability
 * @private
 */
function _checkContentHashDedup(newValue, oldValue) {
  if (!_isContentHashDuplicate(newValue, oldValue)) return null;
  return { method: 'contentHash', reason: 'Identical content with same saveId' };
}

function _multiMethodDeduplication(newValue, oldValue) {
  const now = Date.now();
  const logMatch = (method, reason) =>
    console.log('[Background] Self-write detected:', { method, reason, saveId: newValue?.saveId });

  // Check each dedup method in priority order using extracted helpers
  const checks = [
    () => _checkTimestampWindowDedup(newValue, now),
    () => _checkTransactionDedup(newValue),
    () => _checkSaveIdDedup(newValue, oldValue),
    () => _checkContentHashDedup(newValue, oldValue)
  ];

  for (const check of checks) {
    const result = check();
    if (result) {
      logMatch(result.method, result.reason);
      return { shouldSkip: true, ...result };
    }
  }

  return { shouldSkip: false, method: 'none', reason: 'Legitimate change' };
}

/**
 * Check if saveId + timestamp indicate a duplicate write
 * v1.6.3.6-v12 - FIX Issue #3: Second dedup method
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
 * Check if content hash indicates a duplicate (Firefox spurious event)
 * v1.6.3.6-v12 - FIX Issue #3: Third dedup method (safe version)
 * Only skips if BOTH saveId matches AND content is identical
 * This prevents false negatives during rapid legitimate writes
 * @private
 */
function _isContentHashDuplicate(newValue, oldValue) {
  if (!newValue || !oldValue) return false;

  // Only apply this check if saveId matches (same source)
  if (newValue.saveId !== oldValue.saveId) return false;

  // Compute content keys
  const newContentKey = _computeQuickTabContentKey(newValue);
  const oldContentKey = _computeQuickTabContentKey(oldValue);

  if (newContentKey === oldContentKey && newContentKey !== '') {
    console.log('[Background] v1.6.3.6-v12 Content hash match detected (Firefox spurious event)');
    return true;
  }

  return false;
}

/**
 * Check if this is a self-write via transaction ID
 * v1.6.3.6-v2 - FIX Issue #1: Simplified from _isAnySelfWrite to only check transaction ID
 * v1.6.3.6-v12 - Note: This is also called by _multiMethodDeduplication() as Method 1
 * v1.6.3.10-v5 - FIX Issue #7: Add lazy cleanup of stale transactions during lookup
 * Other self-write detection methods are handled by content scripts
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if self-write
 */
function _isTransactionSelfWrite(newValue) {
  const transactionId = newValue?.transactionId;

  // Check transaction ID - the most deterministic method
  if (transactionId && IN_PROGRESS_TRANSACTIONS.has(transactionId)) {
    // v1.6.3.10-v5 - FIX Issue #7: Lazy cleanup - check if transaction is stale during lookup
    const startTime = transactionStartTimes.get(transactionId);
    const now = Date.now();

    // If transaction is stale (exceeded timeout), clean it up and don't treat as self-write
    if (startTime && now - startTime > TRANSACTION_TIMEOUT_MS) {
      console.warn('[Background] v1.6.3.10-v5 Lazy cleanup - stale transaction found:', {
        transactionId,
        ageMs: now - startTime,
        timeoutMs: TRANSACTION_TIMEOUT_MS
      });
      IN_PROGRESS_TRANSACTIONS.delete(transactionId);
      transactionStartTimes.delete(transactionId);
      return false;
    }

    console.log('[Background] Ignoring self-write (transaction):', transactionId);
    return true;
  }

  return false;
}

/**
 * Check and log if storage change is within cooldown period
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
 * Compute hash for event deduplication
 * v1.6.3.10-v7 - FIX Diagnostic Issue #8: Hash based on saveId + correlationId + timestamp
 * @private
 * @param {Object} value - Storage value
 * @returns {string} Deduplication hash
 */
function _computeEventDeduplicationHash(value) {
  if (!value) return '';
  // Combine saveId, correlationId, and timestamp for unique identification
  return `${value.saveId || ''}|${value.correlationId || ''}|${value.timestamp || 0}`;
}

/**
 * Build storage change comparison object for logging
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
    transactionId: newValue?.transactionId,
    writingInstanceId: newValue?.writingInstanceId,
    writingTabId: newValue?.writingTabId
  };
}

/**
 * Update cooldown tracking and log the storage change
 * v1.6.3.5-v3 - Extracted to reduce _shouldIgnoreStorageChange complexity
 * v1.6.3.12-v7 - Refactored: Extracted helpers to reduce cyclomatic complexity
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
 * v1.6.3.12-v7 - Refactored: Extracted helpers to reduce cyclomatic complexity
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
/**
 * Log broadcast decision for storage updates
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce duplication
 * @private
 */
function _logBroadcastDecision(decision, reason, targetTabCount = 0, filteredCount = 0) {
  console.log('[Background][Storage] BROADCAST_DECISION:', {
    decision,
    reason,
    targetTabCount,
    filteredCount
  });
}

/**
 * Reset non-empty state tracking counters
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce _processStorageUpdate complexity
 * @private
 */
function _resetNonEmptyStateTracking() {
  consecutiveZeroTabReads = 0;
  lastNonEmptyStateTimestamp = Date.now();
}

/**
 * Filter and update cache with valid tabs
 * v1.6.3.11-v9 - FIX Code Health: Extracted to reduce _processStorageUpdate complexity
 * @private
 * @param {Object} newValue - New storage value
 */
function _filterAndUpdateCache(newValue) {
  const filteredValue = filterValidTabs(newValue);
  const originalCount = _getTabCount(newValue);
  const filteredCount = originalCount - _getTabCount(filteredValue);
  _logBroadcastDecision(
    'UPDATE_CACHE',
    'proceeding with cache update',
    _getTabCount(filteredValue),
    filteredCount
  );
  _updateGlobalStateFromStorage(filteredValue);
}

function _processStorageUpdate(newValue) {
  // Handle empty/missing tabs
  if (_isTabsEmptyOrMissing(newValue)) {
    _logBroadcastDecision('SKIP', 'tabs empty or missing - clearing cache instead');
    _clearCacheForEmptyStorage(newValue);
    return;
  }

  // Reset counters for valid tabs
  _resetNonEmptyStateTracking();

  // Check if state actually requires update
  if (!_shouldUpdateState(newValue)) {
    _logBroadcastDecision('SKIP', 'state unchanged', _getTabCount(newValue));
    return;
  }

  // Filter out tabs with invalid URLs and update cache
  _filterAndUpdateCache(newValue);
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
// v1.6.3.10-v6 - FIX Issue #14: Health check logging for storage.onChanged listener

// v1.6.3.10-v6 - FIX Issue #14: Track storage listener health
let storageOnChangedEventCount = 0;
let storageOnChangedLastEventTime = 0;
const STORAGE_LISTENER_LOG_INTERVAL = 100; // Log health every 100 events

/**
 * Log storage listener health status
 * v1.6.3.10-v6 - FIX Issue #14: Verify storage.onChanged listener is active
 * @private
 * @param {string} areaName - Storage area name
 * @param {string[]} changedKeys - Keys that changed
 */
function _logStorageListenerHealth(areaName, changedKeys) {
  storageOnChangedEventCount++;
  const now = Date.now();
  const timeSinceLastEvent =
    storageOnChangedLastEventTime > 0 ? now - storageOnChangedLastEventTime : 0;
  storageOnChangedLastEventTime = now;

  // Log every N events as health check (at 100, 200, 300, etc.)
  // v1.6.3.10-v6 - FIX Code Review: Use === 0 to log at round intervals
  if (storageOnChangedEventCount % STORAGE_LISTENER_LOG_INTERVAL === 0) {
    console.log('[Background][StorageListener] v1.6.3.10-v6 HEALTH_CHECK: Listener active', {
      totalEventsProcessed: storageOnChangedEventCount,
      timeSinceLastEventMs: timeSinceLastEvent,
      lastEventArea: areaName,
      lastEventKeys: changedKeys
    });
  }
}

browser.storage.onChanged.addListener((changes, areaName) => {
  const changedKeys = Object.keys(changes);

  // v1.6.3.10-v6 - FIX Issue #14: Log storage listener health
  _logStorageListenerHealth(areaName, changedKeys);

  console.log('[Background][StorageListener] v1.6.3.10-v6 EVENT_RECEIVED:', {
    areaName,
    keys: changedKeys,
    eventNumber: storageOnChangedEventCount,
    timestamp: Date.now()
  });

  // v1.6.3.12-v6 - FIX: Process local storage for Quick Tabs (Firefox MV2 - storage.session NOT available)
  // Quick Tabs use storage.local with explicit startup cleanup for session-scoped behavior
  if (areaName !== 'local') {
    return;
  }

  // v1.6.3.12-v6 - FIX Issue #1, #4: Handle Quick Tab state changes (storage.local - NOT session)
  // BUG FIX: Previous code checked for areaName === 'session' which never fires in Firefox MV2
  // because browser.storage.session API does not exist. Changed to 'local' to match actual storage usage.
  if (changes.quick_tabs_state_v2 && areaName === 'local') {
    console.log(
      '[Background][StorageListener] v1.6.3.12-v6 PROCESSING: quick_tabs_state_v2 change (storage.local)'
    );
    _handleQuickTabStateChange(changes);
  }

  // Handle settings changes (also in local storage)
  if (changes.quick_tab_settings && areaName === 'local') {
    console.log('[Background][StorageListener] v1.6.3.10-v6 PROCESSING: quick_tab_settings change');
    _handleSettingsChange(changes);
  }
});

console.log(
  '[Background][StorageListener] v1.6.3.12-v6 Listener registered successfully (storage.local - Firefox MV2 compatible)',
  {
    timestamp: Date.now()
  }
);

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
 * Port cleanup interval
 * v1.6.3.6-v11 - FIX Issue #17: Periodic cleanup
 * v1.6.3.10-v5 - FIX Issue #5: Reduced from 5 min to 30s to prevent memory pressure
 */
const PORT_CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Port inactivity threshold for logging warnings
 * v1.6.3.6-v11 - FIX Issue #17: Inactivity monitoring
 * v1.6.3.10-v5 - FIX Issue #5: Reduced from 10 min to 60s for faster cleanup
 */
const PORT_INACTIVITY_THRESHOLD_MS = 60 * 1000; // 60 seconds

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
 * @param {string} origin - Origin of the port (sidebar, content-tab-X)
 * @param {string} event - Event type (open, close, disconnect, error, message)
 * @param {Object} details - Event details
 */
function logPortLifecycle(origin, event, details = {}) {
  console.log(`[Manager] PORT_LIFECYCLE [${origin}] [${event}]:`, {
    tabId: details.tabId,
    portId: details.portId,
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Register a new port connection
 * v1.6.3.6-v11 - FIX Issue #11: Track connected ports
 * @param {browser.runtime.Port} port - The connected port
 * @param {string} origin - Origin identifier
 * @param {number|null} tabId - Tab ID (if from content script)
 * @param {string} type - Port type ('sidebar' or 'content')
 * @returns {string} Generated port ID
 */
function registerPort(port, origin, tabId, type) {
  const portId = generatePortId();

  portRegistry.set(portId, {
    port,
    origin,
    tabId,
    type,
    connectedAt: Date.now(),
    lastMessageAt: null,
    messageCount: 0
  });

  logPortLifecycle(origin, 'open', { tabId, portId, type, totalPorts: portRegistry.size });

  return portId;
}

/**
 * Unregister a port connection
 * v1.6.3.6-v11 - FIX Issue #11: Clean up disconnected ports
 * @param {string} portId - Port ID to unregister
 * @param {string} reason - Reason for disconnect
 */
function unregisterPort(portId, reason = 'disconnect') {
  const portInfo = portRegistry.get(portId);
  if (portInfo) {
    logPortLifecycle(portInfo.origin, 'close', {
      tabId: portInfo.tabId,
      portId,
      reason,
      messageCount: portInfo.messageCount,
      duration: Date.now() - portInfo.connectedAt
    });
    portRegistry.delete(portId);
  }
}

/**
 * Update port activity timestamp
 * v1.6.3.6-v11 - FIX Issue #12: Track port activity
 * @param {string} portId - Port ID
 */
function updatePortActivity(portId) {
  const portInfo = portRegistry.get(portId);
  if (portInfo) {
    portInfo.lastMessageAt = Date.now();
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
  const lastActivity = portInfo.lastMessageAt || portInfo.connectedAt;
  if (now - lastActivity > PORT_INACTIVITY_THRESHOLD_MS) {
    console.warn('[Background] PORT_CLEANUP: Port has been inactive:', {
      portId,
      origin: portInfo.origin,
      tabId: portInfo.tabId,
      inactiveMs: now - lastActivity
    });
  }
}

/**
 * Clean up stale ports (e.g., from closed tabs)
 * v1.6.3.6-v11 - FIX Issue #17: Periodic cleanup every 5 minutes
 */
async function cleanupStalePorts() {
  console.log('[Background] PORT_CLEANUP: Starting periodic port cleanup...');

  const now = Date.now();
  const stalePorts = [];

  for (const [portId, portInfo] of portRegistry.entries()) {
    const tabExists = await _checkPortTabExists(portInfo);
    if (!tabExists) {
      stalePorts.push({ portId, reason: 'tab-closed' });
      continue;
    }

    _checkPortInactivity(portInfo, now, portId);
  }

  // Remove stale ports
  for (const { portId, reason } of stalePorts) {
    unregisterPort(portId, reason);
  }

  console.log('[Background] PORT_CLEANUP: Complete.', {
    removedCount: stalePorts.length,
    remainingPorts: portRegistry.size
  });
}

// Start periodic cleanup
setInterval(cleanupStalePorts, PORT_CLEANUP_INTERVAL_MS);

/**
 * Parse port name to extract type and tab ID
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce handlePortConnect complexity
 * @private
 */
function _parsePortName(port) {
  const nameParts = port.name.split('-');
  const type = nameParts[1] || 'unknown';
  const tabId = nameParts[2] ? parseInt(nameParts[2], 10) : port.sender?.tab?.id || null;
  const origin = type === 'sidebar' ? 'sidebar' : `content-tab-${tabId}`;
  return { type, tabId, origin };
}

// v1.6.3.12-v7 - FIX Issue #16: Pending port connection queue during initialization
const _pendingPortConnections = [];

/**
 * Send background handshake to port after initialization
 * v1.6.3.10-v8 - FIX Code Health: Extracted async handshake logic
 * v1.6.3.12-v7 - FIX Issue #16: Enhanced logging for port lifecycle
 * @private
 */
async function _sendBackgroundHandshake(port, portId, tabId, origin) {
  try {
    const handshakeStartTime = Date.now();
    const initReady = await waitForInitialization(5000);
    const handshakeDuration = Date.now() - handshakeStartTime;

    // v1.6.3.12-v7 - FIX Issue #16: Log port lifecycle - initialized
    console.log('[PORT_LIFECYCLE] Port initialized:', {
      event: 'initialized',
      portId,
      tabId,
      origin,
      isInitialized: initReady,
      handshakeDurationMs: handshakeDuration,
      timestamp: new Date().toISOString()
    });

    port.postMessage({
      type: 'BACKGROUND_HANDSHAKE',
      ...getBackgroundStartupInfo(),
      isInitialized: initReady,
      // v1.6.3.12-v7 - FIX Issue #16: Add isReadyForCommands field
      isReadyForCommands: initReady,
      portId,
      tabId,
      timestamp: Date.now()
    });
    console.log('[Background] Sent BACKGROUND_HANDSHAKE:', {
      portId,
      origin,
      isInitialized: initReady
    });
  } catch (err) {
    console.warn('[Background] Failed to send handshake:', err.message);
  }
}

/**
 * Handle incoming port connection
 * v1.6.3.6-v11 - FIX Issue #11: Persistent port connections
 * v1.6.3.10-v8 - FIX Code Health: Reduced complexity via extraction
 * v1.6.3.12-v7 - FIX Issue #16: Port lifecycle logging and initialization coordination
 */
function handlePortConnect(port) {
  const connectTime = Date.now();
  const { type, tabId, origin } = _parsePortName(port);

  // v1.6.3.12-v7 - FIX Issue #16: Log port lifecycle - created
  console.log('[PORT_LIFECYCLE] Port created:', {
    event: 'created',
    portName: port.name,
    tabId,
    type,
    origin,
    isBackgroundInitialized: isInitialized,
    timestamp: new Date().toISOString()
  });

  const portId = registerPort(port, origin, tabId, type);
  port._portId = portId;

  _sendBackgroundHandshake(port, portId, tabId, origin);

  // v1.6.3.12-v7 - FIX Issue #16: Enhanced port message handler with lifecycle logging
  port.onMessage.addListener(message => {
    console.log('[PORT_LIFECYCLE] Message sent:', {
      event: 'message-sent',
      portId,
      messageType: message.type || message.action,
      timestamp: new Date().toISOString()
    });
    handlePortMessage(port, portId, message);
  });

  port.onDisconnect.addListener(() => {
    const error = browser.runtime.lastError;
    const connectionDuration = Date.now() - connectTime;

    // v1.6.3.12-v7 - FIX Issue #16: Log port lifecycle - closed
    console.log('[PORT_LIFECYCLE] Port closed:', {
      event: 'closed',
      portId,
      tabId,
      origin,
      connectionDurationMs: connectionDuration,
      hadError: !!error,
      errorMessage: error?.message,
      timestamp: new Date().toISOString()
    });

    if (error) {
      logPortLifecycle(origin, 'error', { portId, tabId, error: error.message });
    }
    unregisterPort(portId, 'client-disconnect');
  });
}

/**
 * Handle message received via port
 * v1.6.3.6-v11 - FIX Issue #10: Message acknowledgment system
 * @param {browser.runtime.Port} port - The port that sent the message
 * @param {string} portId - Port ID
 * @param {Object} message - The message
 */
/**
 * Send acknowledgment response to port
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _sendAcknowledgment({ port, message, response, portInfo, portId }) {
  if (!message.correlationId) return;

  // Spread response first, then set explicit properties to ensure they take precedence
  const ack = {
    ...response,
    type: 'ACKNOWLEDGMENT',
    correlationId: message.correlationId,
    originalType: message.type,
    success: response?.success ?? true,
    timestamp: Date.now()
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

async function handlePortMessage(port, portId, message) {
  const portInfo = portRegistry.get(portId);
  updatePortActivity(portId);

  logPortLifecycle(portInfo?.origin || 'unknown', 'message', {
    portId,
    tabId: portInfo?.tabId,
    messageType: message.type,
    correlationId: message.correlationId
  });

  const response = await routePortMessage(message, portInfo);
  _sendAcknowledgment({ port, message, response, portInfo, portId });
}

/**
 * Route port message to appropriate handler
 * v1.6.3.6-v11 - FIX Issue #15: Message type discrimination
 * v1.6.3.6-v12 - FIX Issue #2, #4: Added HEARTBEAT handling
 * v1.6.3.12-v7 - FIX Issue E: Added REQUEST_FULL_STATE_SYNC handling
 * @param {Object} message - Message to route
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Handler response
 */
/**
 * Handle GET_BACKGROUND_INFO message
 * v1.6.3.10-v8 - FIX Code Review: Extracted to named function for consistency
 * @private
 */
function handleGetBackgroundInfo() {
  return Promise.resolve({
    success: true,
    type: 'BACKGROUND_INFO',
    ...getBackgroundStartupInfo(),
    isInitialized,
    timestamp: Date.now()
  });
}

/**
 * Port message handlers lookup
 * v1.6.3.10-v8 - FIX Code Health: Converted switch to lookup table
 * @private
 */
const PORT_MESSAGE_HANDLERS = {
  HEARTBEAT: (msg, portInfo) => handleHeartbeat(msg, portInfo),
  ACTION_REQUEST: (msg, portInfo) => handleActionRequest(msg, portInfo),
  STATE_UPDATE: (msg, portInfo) => handleStateUpdate(msg, portInfo),
  BROADCAST: (msg, portInfo) => handleBroadcastRequest(msg, portInfo),
  DELETION_ACK: (msg, portInfo) => handleDeletionAck(msg, portInfo),
  REQUEST_FULL_STATE_SYNC: (msg, portInfo) => handleFullStateSyncRequest(msg, portInfo),
  GET_BACKGROUND_INFO: () => handleGetBackgroundInfo()
};

function routePortMessage(message, portInfo) {
  const { type, action } = message;

  const handler = PORT_MESSAGE_HANDLERS[type];
  if (handler) {
    return handler(message, portInfo);
  }

  // Fallback to action-based routing for backwards compatibility
  if (action) {
    return handleLegacyAction(message, portInfo);
  }

  console.warn('[Background] Unknown message type:', type);
  return Promise.resolve({ success: false, error: 'Unknown message type' });
}

/**
 * Handle HEARTBEAT message to keep background script alive
 * v1.6.3.6-v12 - FIX Issue #2, #4: Heartbeat mechanism prevents Firefox 30s termination
 * v1.6.3.10-v4 - FIX Issue #3/6: Include background startup info for restart detection
 * @param {Object} message - Heartbeat message
 * @param {Object} portInfo - Port info
 * @returns {Promise<Object>} Heartbeat acknowledgment
 */
function handleHeartbeat(message, portInfo) {
  const { timestamp, source } = message;
  const now = Date.now();
  const latencyMs = now - (timestamp || now);

  console.log('[Background] PORT_HEARTBEAT received:', {
    source: source || portInfo?.origin || 'unknown',
    latencyMs,
    portId: portInfo?.port?._portId,
    tabId: portInfo?.tabId
  });

  // Log successful heartbeat for monitoring
  console.log('[Background] PORT_HEARTBEAT: success', {
    portCount: portRegistry.size,
    isInitialized
  });

  // v1.6.3.10-v4 - FIX Issue #3/6: Include startup info for restart detection
  return Promise.resolve({
    success: true,
    type: 'HEARTBEAT_ACK',
    originalTimestamp: timestamp,
    timestamp: now,
    latencyMs,
    backgroundAlive: true,
    isInitialized,
    ...getBackgroundStartupInfo()
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
 * Handle ACTION_REQUEST type messages
 * v1.6.3.6-v11 - FIX Issue #15: Action request handling
 * v1.6.3.12-v7 - FIX Issue A: Added CLOSE_MINIMIZED_TABS handler
 * @param {Object} message - Action request message
 * @param {Object} portInfo - Port info
 */
/**
 * Action handlers map for ACTION_REQUEST messages
 * v1.6.3.10-v8 - FIX Code Health: Converted switch to lookup
 * @private
 */
const ACTION_REQUEST_HANDLERS = {
  TOGGLE_GROUP: () => ({ success: true }),
  MINIMIZE_TAB: (payload, portInfo) =>
    executeManagerCommand('MINIMIZE_QUICK_TAB', payload.quickTabId, portInfo?.tabId),
  RESTORE_TAB: (payload, portInfo) =>
    executeManagerCommand('RESTORE_QUICK_TAB', payload.quickTabId, portInfo?.tabId),
  CLOSE_TAB: (payload, portInfo) =>
    executeManagerCommand('CLOSE_QUICK_TAB', payload.quickTabId, portInfo?.tabId),
  ADOPT_TAB: payload => handleAdoptAction(payload),
  CLOSE_MINIMIZED_TABS: () => handleCloseMinimizedTabsCommand(),
  DELETE_GROUP: () => ({ success: false, error: 'Not implemented' })
};

function handleActionRequest(message, portInfo) {
  const { action, payload } = message;
  console.log('[Background] Handling ACTION_REQUEST:', { action, portInfo: portInfo?.origin });

  const handler = ACTION_REQUEST_HANDLERS[action];
  if (!handler) {
    console.warn('[Background] Unknown action:', action);
    return { success: false, error: `Unknown action: ${action}` };
  }
  return handler(payload, portInfo);
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
 * Validate adoption prerequisites
 * v1.6.3.12-v7 - FIX Issue #20: Extracted to reduce handleAdoptAction complexity
 * @private
 */
function _validateAdoptionPrerequisites(quickTabId, targetTabId, correlationId) {
  // Validate target tab exists using TabLifecycleHandler
  const validation = tabLifecycleHandler.validateAdoptionTarget(targetTabId);
  if (!validation.valid) {
    console.error('[Background] MANAGER_ACTION_REJECTED:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      reason: 'validation-failed',
      validationReason: validation.reason
    });
    console.error('[Background] ADOPT_TAB validation failed:', validation.reason);
    return { valid: false, error: validation.reason };
  }
  return { valid: true };
}

/**
 * Find Quick Tab in state and update originTabId
 * v1.6.3.12-v7 - FIX Issue #20: Extracted to reduce handleAdoptAction complexity
 * @private
 */
function _findAndUpdateQuickTab(state, quickTabId, targetTabId, correlationId) {
  if (!state?.tabs) {
    console.log('[Background] MANAGER_ACTION_REJECTED:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      reason: 'no-state'
    });
    return { found: false, error: 'No state to adopt from' };
  }

  const tabIndex = state.tabs.findIndex(t => t.id === quickTabId);
  if (tabIndex === -1) {
    console.log('[Background] MANAGER_ACTION_REJECTED:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      reason: 'quick-tab-not-found'
    });
    return { found: false, error: 'Quick Tab not found' };
  }

  const oldOriginTabId = state.tabs[tabIndex].originTabId;
  state.tabs[tabIndex].originTabId = targetTabId;

  // Clear orphan status if Quick Tab was orphaned
  if (state.tabs[tabIndex].isOrphaned) {
    delete state.tabs[tabIndex].isOrphaned;
    delete state.tabs[tabIndex].orphanedAt;
    console.log('[Background] ADOPT_TAB: Clearing orphan status for Quick Tab:', quickTabId);
  }

  return { found: true, oldOriginTabId, tabIndex };
}

/**
 * Write and verify adoption state
 * v1.6.3.12-v7 - FIX Issue #20: Extracted to reduce handleAdoptAction complexity
 * @private
 */
/**
 * Write and verify adoption state to storage
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
/**
 * Log adoption write failure
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 * @param {Object} context - Failure context
 */
function _logAdoptionWriteFailure(context) {
  const { action, quickTabId, targetTabId, correlationId, error, startTime } = context;
  console.error('[Background] MANAGER_ACTION_FAILED:', {
    action,
    quickTabId,
    targetTabId,
    correlationId,
    status: 'failed',
    error,
    durationMs: Date.now() - startTime
  });
}

/**
 * Build adoption state object for storage
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _buildAdoptionStatePayload(state, saveId, targetTabId) {
  return {
    tabs: state.tabs,
    saveId,
    timestamp: Date.now(),
    writingTabId: targetTabId,
    writingInstanceId: `background-adopt-${Date.now()}`
  };
}

async function _writeAndVerifyAdoptionState({
  state,
  quickTabId,
  targetTabId,
  correlationId,
  startTime
}) {
  const saveId = `adopt-${quickTabId}-${Date.now()}`;
  const writeStartTime = Date.now();

  if (!_isStorageSessionAvailable()) {
    console.error('[Background] storage.local unavailable for adoption write');
    return { success: false, error: 'storage.local unavailable', reason: 'storage-unavailable' };
  }

  try {
    // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
    await browser.storage.local.set({
      quick_tabs_state_v2: _buildAdoptionStatePayload(state, saveId, targetTabId)
    });

    const verifyResult = await browser.storage.local.get('quick_tabs_state_v2');
    const verifiedState = verifyResult?.quick_tabs_state_v2;

    if (!verifiedState || verifiedState.saveId !== saveId) {
      _logAdoptionWriteFailure({
        action: 'ADOPT_TAB',
        quickTabId,
        targetTabId,
        correlationId,
        error: 'storage-verification-failed',
        startTime
      });
      return {
        success: false,
        error: 'Storage write verification failed',
        reason: 'storage-verification-failed'
      };
    }

    console.log('[Background] ADOPT_TAB: Storage write verified:', {
      saveId,
      correlationId,
      durationMs: Date.now() - writeStartTime
    });
    return { success: true, saveId };
  } catch (writeErr) {
    _logAdoptionWriteFailure({
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      error: writeErr.message,
      startTime
    });
    return {
      success: false,
      error: `Storage write failed: ${writeErr.message}`,
      reason: 'storage-write-error'
    };
  }
}

/**
 * Handle adopt action (atomic single write)
 * v1.6.3.6-v11 - FIX Issue #18: Adoption atomicity
 * v1.6.3.10-v3 - Phase 2: Smart adoption validation using TabLifecycleHandler
 * v1.6.3.12-v7 - FIX Issue #21: Ensure storage write completes before broadcast
 * v1.6.3.12-v7 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * @param {Object} payload - Adoption payload
 */
/**
 * Read Quick Tab state from storage.local for adoption
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
 * @private
 * @returns {Promise<Object>} Result with state or error
 */
async function _readAdoptionState() {
  if (!_isStorageSessionAvailable()) {
    console.error('[Background] storage.local unavailable for adoption read');
    return { success: false, error: 'storage.local unavailable' };
  }
  // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
  const result = await browser.storage.local.get('quick_tabs_state_v2');
  return { success: true, state: result?.quick_tabs_state_v2 };
}

/**
 * Update global cache after adoption
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _updateGlobalCacheForAdoption(quickTabId, targetTabId) {
  const cachedTab = globalQuickTabState.tabs.find(t => t.id === quickTabId);
  if (cachedTab) {
    cachedTab.originTabId = targetTabId;
    delete cachedTab.isOrphaned;
    delete cachedTab.orphanedAt;
  }
  quickTabHostTabs.set(quickTabId, targetTabId);
}

/**
 * Broadcast adoption completion to all ports and tabs
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
async function _broadcastAdoptionCompletion(
  quickTabId,
  oldOriginTabId,
  targetTabId,
  correlationId
) {
  broadcastToAllPorts({
    type: 'ADOPTION_COMPLETED',
    adoptedQuickTabId: quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    previousOriginTabId: oldOriginTabId,
    correlationId,
    timestamp: Date.now()
  });
  await _broadcastAdoptionToAllTabs(quickTabId, oldOriginTabId, targetTabId);
}

/**
 * Log successful adoption completion
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 * @param {Object} context - Success context
 */
function _logAdoptionSuccess(context) {
  const { quickTabId, targetTabId, oldOriginTabId, correlationId, startTime } = context;
  const durationMs = Date.now() - startTime;
  console.log('[Background] MANAGER_ACTION_COMPLETED:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    status: 'success',
    oldOriginTabId,
    newOriginTabId: targetTabId,
    durationMs
  });
  console.log('[Background] ADOPT_TAB complete:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId
  });
}

async function handleAdoptAction(payload) {
  const { quickTabId, targetTabId, correlationId: payloadCorrelationId } = payload;
  const correlationId = payloadCorrelationId || generateCorrelationId('adopt');
  const startTime = Date.now();

  console.log('[Background] MANAGER_ACTION_REQUESTED:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    timestamp: startTime
  });

  const validation = _validateAdoptionPrerequisites(quickTabId, targetTabId, correlationId);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const stateResult = await _readAdoptionState();
  if (!stateResult.success) {
    return stateResult;
  }

  const findResult = _findAndUpdateQuickTab(
    stateResult.state,
    quickTabId,
    targetTabId,
    correlationId
  );
  if (!findResult.found) {
    return { success: false, error: findResult.error };
  }

  const writeResult = await _writeAndVerifyAdoptionState({
    state: stateResult.state,
    quickTabId,
    targetTabId,
    correlationId,
    startTime
  });
  if (!writeResult.success) {
    return writeResult;
  }

  _updateGlobalCacheForAdoption(quickTabId, targetTabId);
  await _broadcastAdoptionCompletion(
    quickTabId,
    findResult.oldOriginTabId,
    targetTabId,
    correlationId
  );
  _logAdoptionSuccess({
    quickTabId,
    targetTabId,
    oldOriginTabId: findResult.oldOriginTabId,
    correlationId,
    startTime
  });

  return { success: true, oldOriginTabId: findResult.oldOriginTabId, newOriginTabId: targetTabId };
}

/**
 * Broadcast ADOPTION_COMPLETED to all content scripts via tabs.sendMessage
 * v1.6.3.12-v7 - FIX BUG #4: Cross-Tab Restore Using Wrong Tab Context
 * v1.6.3.12-v7 - FIX Issue #19: Retry mechanism for transient failures
 * v1.6.3.12-v7 - FIX Issue #23: Classified error metrics (permanent vs transient)
 *
 * This ensures all content scripts update their local Quick Tab cache
 * with the new originTabId after adoption. Without this, restore operations
 * would use stale cache data and target the wrong tab.
 *
 * @private
 * @param {string} quickTabId - The Quick Tab that was adopted
 * @param {number} oldOriginTabId - The previous owner tab ID
 * @param {number} newOriginTabId - The new owner tab ID
 */
async function _broadcastAdoptionToAllTabs(quickTabId, oldOriginTabId, newOriginTabId) {
  const timestamp = Date.now();
  const message = {
    action: 'ADOPTION_COMPLETED',
    adoptedQuickTabId: quickTabId,
    previousOriginTabId: oldOriginTabId,
    newOriginTabId,
    timestamp
  };

  console.log(
    '[Background] ADOPTION_BROADCAST_TO_TABS: Starting broadcast to all content scripts:',
    {
      quickTabId,
      previousOriginTabId: oldOriginTabId,
      newOriginTabId
    }
  );

  try {
    const tabs = await browser.tabs.query({});
    const results = await _sendAdoptionToTabsWithRetry(tabs, message, quickTabId);

    // v1.6.3.12-v7 - FIX Issue #23: Log classified metrics
    console.log('[Background] ADOPTION_BROADCAST_TO_TABS_COMPLETE:', {
      quickTabId,
      totalTabs: tabs.length,
      sent: results.successCount + results.permanentFailures + results.transientFailures,
      succeeded: results.successCount,
      permanent_failures: results.permanentFailures,
      transient_failures: results.transientFailures,
      durationMs: Date.now() - timestamp
    });
  } catch (err) {
    console.error('[Background] ADOPTION_BROADCAST_TO_TABS_ERROR:', {
      quickTabId,
      error: err.message
    });
  }
}

// v1.6.3.12-v7 - FIX Issue #19: Constants for retry mechanism
const ADOPTION_BROADCAST_MAX_RETRIES = 3;
const ADOPTION_BROADCAST_RETRY_DELAY_MS = 200;

/**
 * Classify error as permanent or transient
 * v1.6.3.12-v7 - FIX Issue #19: Error classification for retry decisions
 * @private
 * @param {Error} error - The error to classify
 * @returns {{ isPermanent: boolean, reason: string }}
 */
/**
 * Permanent error patterns - tab doesn't exist or can't receive messages
 * v1.6.3.12-v7 - FIX Code Health: Extracted to flatten _classifyBroadcastError
 * @const {string[]}
 */
const PERMANENT_ERROR_PATTERNS = [
  'No tab with id',
  'Invalid tab ID',
  'Tab not found',
  'Cannot access',
  'Permission denied',
  'extension context invalidated'
];

/**
 * Transient error patterns - tab exists but content script may not be ready
 * v1.6.3.12-v7 - FIX Code Health: Extracted to flatten _classifyBroadcastError
 * @const {string[]}
 */
const TRANSIENT_ERROR_PATTERNS = [
  'Receiving end does not exist',
  'Could not establish connection',
  'Message manager disconnected',
  'Connection was reset'
];

/**
 * Check if error message matches any pattern in an array
 * v1.6.3.12-v7 - FIX Code Health: Helper to reduce duplication
 * @private
 * @param {string} errorMessage - Error message to check
 * @param {string[]} patterns - Array of patterns to match
 * @returns {string|null} Matched pattern or null
 */
function _matchErrorPattern(errorMessage, patterns) {
  for (const pattern of patterns) {
    if (errorMessage.includes(pattern)) return pattern;
  }
  return null;
}

/**
 * Classify broadcast error as permanent or transient
 * v1.6.3.12-v7 - FIX Code Health: Refactored to use extracted helpers (bumpy road fix)
 * @private
 * @param {Error} error - Error to classify
 * @returns {{ isPermanent: boolean, reason: string }}
 */
function _classifyBroadcastError(error) {
  const errorMessage = error?.message || String(error);

  const permanentMatch = _matchErrorPattern(errorMessage, PERMANENT_ERROR_PATTERNS);
  if (permanentMatch) return { isPermanent: true, reason: permanentMatch };

  const transientMatch = _matchErrorPattern(errorMessage, TRANSIENT_ERROR_PATTERNS);
  if (transientMatch) return { isPermanent: false, reason: transientMatch };

  // Default: treat unknown errors as transient (will retry)
  return { isPermanent: false, reason: 'unknown-error' };
}

/**
 * Send adoption message to a list of tabs with retry for transient failures
 * v1.6.3.12-v7 - FIX Issue #19: Retry mechanism with error classification
 * v1.6.3.12-v7 - FIX Issue #23: Classified error metrics
 * @private
 * @param {Array} tabs - List of browser tabs
 * @param {Object} message - Adoption message to send
 * @param {string} quickTabId - Quick Tab ID for logging
 * @returns {Promise<{successCount: number, permanentFailures: number, transientFailures: number}>}
 */
async function _sendAdoptionToTabsWithRetry(tabs, message, quickTabId) {
  // Track tabs that need retry
  const pendingTabs = tabs.map(tab => ({ tabId: tab.id, retryCount: 0 }));
  const completedTabs = new Set();
  const metrics = { successCount: 0, permanentFailures: 0, transientFailures: 0 };

  // First pass - try all tabs
  await _sendAdoptionFirstPass({ pendingTabs, completedTabs, metrics, message, quickTabId });

  // Retry pass for transient failures
  const tabsToRetry = pendingTabs.filter(p => !completedTabs.has(p.tabId));
  if (tabsToRetry.length > 0) {
    await _sendAdoptionRetryPass({
      tabsToRetry,
      pendingTabs,
      completedTabs,
      metrics,
      message,
      quickTabId
    });
  }

  return metrics;
}

/**
 * First pass of adoption broadcast - try all tabs once
 * v1.6.3.12-v7 - Extracted to reduce complexity
 * @private
 */
/**
 * First pass of adoption broadcast
 * v1.6.3.12-v7 - Extracted to reduce complexity
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _sendAdoptionFirstPass({
  pendingTabs,
  completedTabs,
  metrics,
  message,
  quickTabId
}) {
  for (const pending of pendingTabs) {
    const result = await _sendAdoptionToSingleTabClassified(pending.tabId, message, quickTabId);
    _processSendResult(result, pending.tabId, completedTabs, metrics);
  }
}

/**
 * Process send result and update metrics
 * v1.6.3.12-v7 - Extracted to reduce complexity
 * @private
 */
function _processSendResult(result, tabId, completedTabs, metrics) {
  if (result.success) {
    metrics.successCount++;
    completedTabs.add(tabId);
  } else if (result.isPermanent) {
    metrics.permanentFailures++;
    completedTabs.add(tabId);
  }
}

/**
 * Retry pass of adoption broadcast - retry transient failures
 * v1.6.3.12-v7 - Extracted to reduce complexity
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _sendAdoptionRetryPass({
  tabsToRetry,
  pendingTabs,
  completedTabs,
  metrics,
  message,
  quickTabId
}) {
  console.log('[Background] ADOPTION_BROADCAST_RETRY:', {
    quickTabId,
    tabCount: tabsToRetry.length
  });

  for (let retryAttempt = 1; retryAttempt <= ADOPTION_BROADCAST_MAX_RETRIES; retryAttempt++) {
    await new Promise(resolve =>
      setTimeout(resolve, ADOPTION_BROADCAST_RETRY_DELAY_MS * retryAttempt)
    );
    await _sendAdoptionRetryAttempt({
      tabsToRetry,
      completedTabs,
      metrics,
      message,
      quickTabId,
      retryAttempt
    });
    if (completedTabs.size === pendingTabs.length) break;
  }

  _countRemainingTransientFailures(tabsToRetry, completedTabs, metrics, quickTabId);
}

/**
 * Single retry attempt for all pending tabs
 * v1.6.3.12-v7 - Extracted to reduce complexity
 * @private
 */
async function _sendAdoptionRetryAttempt({
  tabsToRetry,
  completedTabs,
  metrics,
  message,
  quickTabId,
  retryAttempt
}) {
  for (const pending of tabsToRetry) {
    if (completedTabs.has(pending.tabId)) continue;

    pending.retryCount++;
    const result = await _sendAdoptionToSingleTabClassified(pending.tabId, message, quickTabId);

    if (result.success) {
      metrics.successCount++;
      completedTabs.add(pending.tabId);
      console.log('[Background] ADOPTION_BROADCAST_RETRY_SUCCESS:', {
        tabId: pending.tabId,
        quickTabId,
        attempt: retryAttempt
      });
    } else if (result.isPermanent) {
      metrics.permanentFailures++;
      completedTabs.add(pending.tabId);
    }
  }
}

/**
 * Count remaining tabs as transient failures
 * v1.6.3.12-v7 - Extracted to reduce complexity
 * @private
 */
function _countRemainingTransientFailures(tabsToRetry, completedTabs, metrics, quickTabId) {
  for (const pending of tabsToRetry) {
    if (!completedTabs.has(pending.tabId)) {
      metrics.transientFailures++;
      console.log('[Background] ADOPTION_BROADCAST_FINAL_FAILURE:', {
        tabId: pending.tabId,
        quickTabId,
        retryCount: pending.retryCount,
        failureType: 'transient'
      });
    }
  }
}

/**
 * Send adoption message to a single tab with error classification
 * v1.6.3.12-v7 - FIX Issue #19 & #23: Classified error handling
 * @private
 * @param {number} tabId - Browser tab ID
 * @param {Object} message - Adoption message to send
 * @param {string} quickTabId - Quick Tab ID for logging
 * @returns {Promise<{success: boolean, isPermanent?: boolean, reason?: string}>}
 */
async function _sendAdoptionToSingleTabClassified(tabId, message, quickTabId) {
  try {
    await browser.tabs.sendMessage(tabId, message);
    console.log('[Background] ADOPTION_BROADCAST_TO_TAB:', {
      tabId,
      quickTabId,
      status: 'sent'
    });
    return { success: true };
  } catch (err) {
    const classification = _classifyBroadcastError(err);

    // Only log if permanent or first transient (to reduce noise)
    if (classification.isPermanent) {
      console.log('[Background] ADOPTION_BROADCAST_PERMANENT_FAILURE:', {
        tabId,
        quickTabId,
        reason: classification.reason,
        error: err.message
      });
    }

    return {
      success: false,
      isPermanent: classification.isPermanent,
      reason: classification.reason
    };
  }
}

/**
 * Check if storage.local is available
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * v1.6.3.12-v4 - FIX: Renamed and updated to check storage.local (storage.session not available in Firefox MV2)
 * @private
 * @returns {boolean} True if storage.local is available
 */
function _isStorageSessionAvailable() {
  // v1.6.3.12-v4 - FIX: Check storage.local (storage.session not available in Firefox MV2)
  return typeof browser.storage.local !== 'undefined';
}

/**
 * Log storage write verification result
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _logVerificationResult(verified, saveId, stateToWrite, readBack) {
  if (!verified) {
    console.error('[Background] Storage write verification FAILED:', {
      expectedSaveId: saveId,
      actualSaveId: readBack?.saveId,
      expectedTabs: stateToWrite.tabs.length,
      actualTabs: readBack?.tabs?.length
    });
  } else {
    console.log('[Background] Storage write verified (session-only):', {
      saveId,
      tabCount: stateToWrite.tabs.length
    });
  }
}

/**
 * Write state to storage with verification
 * v1.6.3.6-v11 - FIX Issue #14: Storage write verification
 * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
 * v1.6.3.12-v7 - Refactored: Extract helpers to reduce cyclomatic complexity
 * @returns {Promise<Object>} Write result with verification status
 */
async function writeStateWithVerification() {
  const saveId = `bg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    saveId,
    timestamp: Date.now()
  };

  if (!_isStorageSessionAvailable()) {
    console.error('[Background] storage.local unavailable for state write');
    return { success: false, saveId, error: 'storage.local unavailable' };
  }

  try {
    // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
    await browser.storage.local.set({ quick_tabs_state_v2: stateToWrite });

    const result = await browser.storage.local.get('quick_tabs_state_v2');
    const readBack = result?.quick_tabs_state_v2;
    const verified = readBack?.saveId === saveId;

    _logVerificationResult(verified, saveId, stateToWrite, readBack);

    return { success: verified, saveId, verified };
  } catch (err) {
    console.error('[Background] Storage write error:', err.message);
    return { success: false, error: err.message };
  }
}

// ==================== v1.6.3.12-v7 COMMAND HANDLERS ====================
// FIX Issue A: Background as sole storage writer
// FIX Issue E: State sync on port reconnection
// FIX Issue F: Storage write verification with retry

/**
 * Initial backoff for storage write retry
 * v1.6.3.12-v7 - FIX Issue F: Exponential backoff
 * v1.6.3.10-v7 - Note: STORAGE_WRITE_MAX_RETRIES is defined earlier at line 136
 */
const STORAGE_WRITE_BACKOFF_INITIAL_MS = 100;

/**
 * Handle REQUEST_FULL_STATE_SYNC message
 * v1.6.3.12-v7 - FIX Issue E: State sync on port reconnection
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
 * Find minimized tabs in global state
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce handleCloseMinimizedTabsCommand complexity
 * @private
 */
function _findMinimizedTabs() {
  return globalQuickTabState.tabs.filter(
    tab => tab.minimized === true || tab.visibility?.minimized === true
  );
}

/**
 * Remove minimized tabs from global state
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce handleCloseMinimizedTabsCommand complexity
 * @private
 */
function _removeMinimizedTabsFromState() {
  globalQuickTabState.tabs = globalQuickTabState.tabs.filter(
    tab => !(tab.minimized === true || tab.visibility?.minimized === true)
  );
  globalQuickTabState.lastUpdate = Date.now();
}

/**
 * Handle CLOSE_MINIMIZED_TABS command
 * v1.6.3.12-v7 - FIX Issue A: Background as sole storage writer
 * v1.6.3.10-v8 - FIX Code Health: Reduced complexity via extraction
 */
async function handleCloseMinimizedTabsCommand() {
  console.log('[Background] Handling CLOSE_MINIMIZED_TABS command');

  const guard = checkInitializationGuard('handleCloseMinimizedTabsCommand');
  if (!guard.initialized) {
    const initialized = await waitForInitialization(2000);
    if (!initialized) return guard.errorResponse;
  }

  const minimizedTabs = _findMinimizedTabs();
  if (minimizedTabs.length === 0) {
    console.log('[Background] No minimized tabs to close');
    return { success: true, closedCount: 0, closedIds: [] };
  }

  const closedIds = minimizedTabs.map(tab => tab.id);
  console.log('[Background] Closing minimized tabs:', { count: closedIds.length, ids: closedIds });

  await _broadcastCloseManyToAllTabs(closedIds);
  _removeMinimizedTabsFromState();
  const writeResult = await writeStateWithVerificationAndRetry('close-minimized');
  closedIds.forEach(id => quickTabHostTabs.delete(id));

  console.log('[Background] CLOSE_MINIMIZED_TABS complete:', {
    closedCount: closedIds.length,
    verified: writeResult.verified
  });

  // v1.6.3.12-v7 - FIX Issue #3: Notify sidebar of state change after closing minimized tabs
  // This ensures the Manager UI updates immediately to reflect the removed tabs
  notifySidebarOfStateChange();

  return {
    success: true,
    closedCount: closedIds.length,
    closedIds,
    verified: writeResult.verified
  };
}

/**
 * Broadcast close messages for multiple Quick Tabs to all content scripts
 * v1.6.3.12-v7 - FIX Issue A: Helper for CLOSE_MINIMIZED_TABS
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
 * v1.6.3.12-v7 - FIX Issue A: Extracted to reduce nesting depth
 * @private
 * @param {Array} tabs - Browser tabs
 * @param {Array<string>} quickTabIds - Quick Tab IDs to close
 */
/**
 * Send close messages to all browser tabs for multiple Quick Tabs
 * v1.6.3.12-v7 - FIX Issue A: Extracted to reduce nesting depth
 * v1.6.3.12-v7 - FIX Code Health: Changed from async to sync (no await needed)
 * @private
 * @param {Array} tabs - Browser tabs
 * @param {Array} quickTabIds - Array of Quick Tab IDs
 */
function _sendCloseMessagesToAllTabs(tabs, quickTabIds) {
  for (const quickTabId of quickTabIds) {
    _sendCloseMessageToTabs(tabs, quickTabId);
  }
}

/**
 * Send close message to all browser tabs for a single Quick Tab
 * v1.6.3.12-v7 - FIX Issue A: Extracted to reduce nesting depth
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
 * v1.6.3.12-v7 - FIX Issue F: Storage timing uncertainty
 * @param {string} operation - Operation name for logging
 * @returns {Promise<Object>} Write result with verification status
 */
async function writeStateWithVerificationAndRetry(operation) {
  const saveId = `bg-${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  let backoffMs = STORAGE_WRITE_BACKOFF_INITIAL_MS;

  for (let attempt = 1; attempt <= STORAGE_WRITE_MAX_RETRIES; attempt++) {
    const result = await _attemptStorageWriteWithVerification(
      operation,
      saveId,
      attempt,
      backoffMs
    );

    if (result.success && result.verified) {
      return result;
    }

    if (result.needsRetry && attempt < STORAGE_WRITE_MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      backoffMs *= 2; // Exponential backoff
    }
  }

  console.error('[Background] Storage write verification FAILED after max retries:', {
    operation,
    saveId,
    maxRetries: STORAGE_WRITE_MAX_RETRIES
  });

  return { success: false, saveId, verified: false, attempts: STORAGE_WRITE_MAX_RETRIES };
}

/**
 * Attempt a single storage write with verification
 * v1.6.3.12-v7 - FIX Issue F: Extracted to reduce nesting depth
 * v1.6.3.12-v7 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 * @param {string} operation - Operation name
 * @param {string} saveId - Save ID
 * @param {number} attempt - Current attempt number
 * @param {number} backoffMs - Current backoff time
 * @returns {Promise<{ success: boolean, verified: boolean, needsRetry: boolean, attempts?: number, saveId?: string }>}
 */
async function _attemptStorageWriteWithVerification(operation, saveId, attempt, backoffMs) {
  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    saveId,
    timestamp: Date.now()
  };

  try {
    // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
    if (typeof browser.storage.local === 'undefined') {
      console.error('[Background] storage.local unavailable for write attempt');
      return { success: false, verified: false, needsRetry: false };
    }
    await browser.storage.local.set({ quick_tabs_state_v2: stateToWrite });
    return await _verifyStorageWrite({
      operation,
      saveId,
      tabCount: stateToWrite.tabs.length,
      attempt,
      backoffMs
    });
  } catch (err) {
    console.error(`[Background] Storage write error (attempt ${attempt}):`, err.message);
    return { success: false, verified: false, needsRetry: true };
  }
}

/**
 * Verify storage write by reading back the data
 * v1.6.3.12-v7 - FIX Issue F: Extracted to reduce nesting depth
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
 * @private
 */
async function _verifyStorageWrite({ operation, saveId, tabCount, attempt, backoffMs }) {
  // v1.6.3.12-v4 - FIX: Use storage.local (storage.session not available in Firefox MV2)
  const result = await browser.storage.local.get('quick_tabs_state_v2');
  const readBack = result?.quick_tabs_state_v2;
  const verified = readBack?.saveId === saveId;

  if (verified) {
    console.log(`[Background] Write confirmed: saveId matches (attempt ${attempt})`, {
      operation,
      saveId,
      tabCount
    });
    return { success: true, saveId, verified: true, attempts: attempt, needsRetry: false };
  }

  console.warn(
    `[Background] Write pending: retrying (attempt ${attempt}/${STORAGE_WRITE_MAX_RETRIES})`,
    {
      operation,
      expectedSaveId: saveId,
      actualSaveId: readBack?.saveId,
      backoffMs
    }
  );
  return { success: false, verified: false, needsRetry: true };
}

// ==================== END v1.6.3.12-v7 COMMAND HANDLERS ====================

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

// ==================== v1.6.3.12 OPTION 4: QUICK TABS PORT MESSAGING ====================
// FIX: browser.storage.session does NOT exist in Firefox Manifest V2
// This new port-based messaging system replaces storage.session for Quick Tabs

/**
 * Get all Quick Tabs as a flat array from in-memory state
 * v1.6.3.12 - Option 4: Helper for sidebar queries
 * @returns {Array} All Quick Tabs across all tabs
 */
function getAllQuickTabsFromMemory() {
  const allTabs = [];
  const originTabStats = {}; // v1.6.4 - FIX Issue #11/#14: Track tabs per origin for logging

  for (const tabId in quickTabsSessionState.quickTabsByTab) {
    const tabQuickTabs = quickTabsSessionState.quickTabsByTab[tabId];
    if (Array.isArray(tabQuickTabs)) {
      allTabs.push(...tabQuickTabs);
      // v1.6.4 - FIX Issue #11/#14: Count Quick Tabs per origin tab
      originTabStats[tabId] = tabQuickTabs.length;
    }
  }

  // v1.6.4 - FIX Issue #11/#14: Log cross-tab aggregation for diagnostics
  const originTabCount = Object.keys(originTabStats).length;
  if (allTabs.length > 0 || originTabCount > 0) {
    console.log('[Background] GET_ALL_QUICK_TABS_AGGREGATION:', {
      timestamp: Date.now(),
      totalQuickTabs: allTabs.length,
      originTabCount,
      quickTabsPerOriginTab: originTabStats,
      message: `Aggregated ${allTabs.length} Quick Tabs from ${originTabCount} browser tabs`
    });
  }

  return allTabs;
}

/**
 * Notify sidebar of Quick Tab state change
 * v1.6.3.12 - Option 4: Push state updates to sidebar
 * v1.6.3.12 - J5: Enhanced broadcast error handling and logging
 */
function notifySidebarOfStateChange() {
  if (!quickTabsSessionState.sidebarPort) {
    // v1.6.3.12 - J5: Log when message dropped due to missing port
    console.log('[Background] BROADCAST_DROPPED: No sidebar port connected', {
      timestamp: Date.now(),
      totalQuickTabs: getAllQuickTabsFromMemory().length,
      reason: 'sidebar_port_null'
    });
    return;
  }

  const allTabs = getAllQuickTabsFromMemory();
  const correlationId = `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const message = {
    type: 'STATE_CHANGED',
    quickTabs: allTabs,
    tabCount: allTabs.length,
    timestamp: Date.now(),
    sessionId: quickTabsSessionState.sessionId,
    correlationId // v1.6.3.12 - Gap #8: Add correlation ID
  };

  try {
    quickTabsSessionState.sidebarPort.postMessage(message);
    // v1.6.3.12 - J5: Log successful broadcast with target info
    console.log('[Background] BROADCAST_SUCCESS: STATE_CHANGED sent to sidebar', {
      correlationId,
      tabCount: allTabs.length,
      timestamp: message.timestamp,
      targetPort: 'sidebar'
    });
  } catch (err) {
    // v1.6.3.12 - J5: Log broadcast failure and mark port as dead
    console.error('[Background] BROADCAST_FAILED: Error sending to sidebar', {
      correlationId,
      error: err.message,
      timestamp: Date.now(),
      tabCount: allTabs.length,
      action: 'removing_stale_port'
    });
    quickTabsSessionState.sidebarPort = null;
  }
}

/**
 * Handle QUICKTAB_MINIMIZED message from VisibilityHandler
 * v1.6.3.12-v2 - FIX Issue #1 (issue-47-extended-analysis): Add missing QUICKTAB_MINIMIZED handler
 *
 * When a Quick Tab is minimized or restored in a content script, the VisibilityHandler
 * sends a QUICKTAB_MINIMIZED message. This handler:
 * 1. Updates the in-memory state with the new minimized status
 * 2. Notifies the sidebar via STATE_CHANGED to update its UI immediately
 *
 * @param {Object} message - Message payload
 * @param {string} message.quickTabId - Quick Tab ID
 * @param {boolean} message.minimized - New minimized state
 * @param {number} message.originTabId - Tab where Quick Tab resides
 * @param {string} message.source - Source of the action
 * @param {Object} sender - Message sender info
 * @returns {{success: boolean, error?: string}}
 */
function handleQuickTabMinimizedMessage(message, sender) {
  const { quickTabId, minimized, originTabId, source, timestamp } = message;
  const senderTabId = sender?.tab?.id ?? originTabId;

  console.log('[Background] v1.6.3.12-v2 QUICKTAB_MINIMIZED received:', {
    quickTabId,
    minimized,
    originTabId,
    senderTabId,
    source,
    timestamp
  });

  // Find and update the Quick Tab in session state
  const quickTabs = quickTabsSessionState.quickTabsByTab[senderTabId] || [];
  const quickTab = quickTabs.find(qt => qt.id === quickTabId);

  if (quickTab) {
    const previousMinimized = quickTab.minimized;
    quickTab.minimized = minimized;

    console.log('[Background] v1.6.3.12-v2 Quick Tab minimized state updated:', {
      quickTabId,
      previousMinimized,
      newMinimized: minimized,
      originTabId: senderTabId
    });

    // Update globalQuickTabState as well for backward compatibility
    const globalQuickTab = globalQuickTabState.tabs.find(qt => qt.id === quickTabId);
    if (globalQuickTab) {
      globalQuickTab.minimized = minimized;
    }

    // Notify sidebar of state change for immediate UI update
    notifySidebarOfStateChange();

    return { success: true, quickTabId, minimized };
  }

  console.warn('[Background] v1.6.3.12-v2 Quick Tab not found for QUICKTAB_MINIMIZED:', {
    quickTabId,
    senderTabId,
    availableTabIds: Object.keys(quickTabsSessionState.quickTabsByTab)
  });

  // v1.6.3.12-v2 - Do NOT notify sidebar when Quick Tab not found
  // Notifying on failure could cause unnecessary sidebar updates and
  // potential UI flickering when the Quick Tab genuinely doesn't exist

  return {
    success: false,
    error: 'Quick Tab not found in session state',
    quickTabId
  };
}

/**
 * Handle QUICKTAB_REMOVED message from content script
 * v1.6.3.12-v7 - FIX Bug #3: When content script closes Quick Tab via UI button,
 * DestroyHandler sends this message to notify background for state sync.
 * This ensures the Manager sidebar gets updated when Quick Tabs are closed
 * from their own close buttons, not just from Manager buttons.
 *
 * @param {Object} message - Message containing quickTabId, originTabId, source
 * @param {browser.runtime.MessageSender} sender - Message sender info
 */
function handleQuickTabRemovedMessage(message, sender) {
  const { quickTabId, originTabId, source, timestamp } = message;
  const senderTabId = sender?.tab?.id ?? originTabId;

  console.log('[Background] v1.6.3.12-v7 QUICKTAB_REMOVED received:', {
    quickTabId,
    originTabId,
    senderTabId,
    source,
    timestamp: timestamp || Date.now()
  });

  // Remove the Quick Tab from session state
  const { ownerTabId, found } = _removeQuickTabFromSessionState(quickTabId);

  // Also remove from globalQuickTabState for backward compatibility
  const globalIndex = globalQuickTabState.tabs.findIndex(qt => qt.id === quickTabId);
  if (globalIndex >= 0) {
    globalQuickTabState.tabs.splice(globalIndex, 1);
    globalQuickTabState.lastUpdate = Date.now();
  }

  if (found) {
    console.log('[Background] v1.6.3.12-v7 Quick Tab removed from session state:', {
      quickTabId,
      ownerTabId,
      source,
      remainingTabsInOwner: quickTabsSessionState.quickTabsByTab[ownerTabId]?.length || 0,
      totalGlobalTabs: globalQuickTabState.tabs.length
    });

    // Notify sidebar of state change for immediate UI update
    notifySidebarOfStateChange();
  } else {
    console.warn('[Background] v1.6.3.12-v7 Quick Tab not found for QUICKTAB_REMOVED:', {
      quickTabId,
      senderTabId,
      availableTabIds: Object.keys(quickTabsSessionState.quickTabsByTab)
    });
  }
}

/**
 * Notify specific content script of its Quick Tabs
 * v1.6.3.12 - Option 4: Send updates to content scripts
 * v1.6.3.12 - J5: Enhanced broadcast error handling with per-target logging
 * @param {number} tabId - Tab ID to notify
 */
function notifyContentScriptOfStateChange(tabId) {
  const port = quickTabsSessionState.contentScriptPorts[tabId];
  if (!port) {
    // v1.6.3.12 - J5: Log when message dropped due to missing port
    console.log('[Background] BROADCAST_DROPPED: No content script port for tab', {
      tabId,
      timestamp: Date.now(),
      reason: 'port_not_found',
      availablePorts: Object.keys(quickTabsSessionState.contentScriptPorts)
    });
    return;
  }

  const quickTabs = quickTabsSessionState.quickTabsByTab[tabId] || [];
  const correlationId = `cs-broadcast-${tabId}-${Date.now()}`;
  const message = {
    type: 'QUICK_TABS_UPDATED',
    quickTabs,
    tabCount: quickTabs.length,
    timestamp: Date.now(),
    correlationId // v1.6.3.12 - Gap #8: Add correlation ID
  };

  try {
    port.postMessage(message);
    // v1.6.3.12 - J5: Log successful broadcast
    console.log('[Background] BROADCAST_SUCCESS: QUICK_TABS_UPDATED sent to content script', {
      tabId,
      correlationId,
      tabCount: quickTabs.length
    });
  } catch (err) {
    // v1.6.3.12 - J5: Log failure and remove dead port
    console.error('[Background] BROADCAST_FAILED: Error sending to content script', {
      tabId,
      correlationId,
      error: err.message,
      action: 'removing_dead_port'
    });
    delete quickTabsSessionState.contentScriptPorts[tabId];
  }
}

/**
 * Handle CREATE_QUICK_TAB message from content script
 * v1.6.3.12 - Option 4: Add Quick Tab to in-memory state
 * v1.6.3.12 - J3: Log container info for Manager labeling
 * @param {number} tabId - Origin tab ID
 * @param {Object} quickTab - Quick Tab data
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleCreateQuickTab(tabId, quickTab, port) {
  // v1.6.3.12 - J3: Include container info in logging for Manager labeling
  console.log(`[Background] CREATE_QUICK_TAB from tab ${tabId}:`, {
    quickTabId: quickTab.id,
    url: quickTab.url,
    originContainerId: quickTab.originContainerId || 'firefox-default',
    originTabId: quickTab.originTabId || tabId
  });

  // Initialize tab's Quick Tab array if needed
  if (!quickTabsSessionState.quickTabsByTab[tabId]) {
    quickTabsSessionState.quickTabsByTab[tabId] = [];
  }

  // Add Quick Tab to memory
  const tabQuickTabs = quickTabsSessionState.quickTabsByTab[tabId];

  // Check for duplicate
  const existingIndex = tabQuickTabs.findIndex(qt => qt.id === quickTab.id);
  if (existingIndex >= 0) {
    tabQuickTabs[existingIndex] = quickTab;
    console.log(`[Background] Updated existing Quick Tab: ${quickTab.id}`);
  } else {
    tabQuickTabs.push(quickTab);
    console.log(`[Background] Created new Quick Tab: ${quickTab.id}`);
  }

  // Also update globalQuickTabState for backward compatibility
  const globalIndex = globalQuickTabState.tabs.findIndex(qt => qt.id === quickTab.id);
  if (globalIndex >= 0) {
    globalQuickTabState.tabs[globalIndex] = quickTab;
  } else {
    globalQuickTabState.tabs.push(quickTab);
  }
  globalQuickTabState.lastUpdate = Date.now();

  // Send ACK to content script
  port.postMessage({
    type: 'CREATE_QUICK_TAB_ACK',
    success: true,
    quickTabId: quickTab.id,
    timestamp: Date.now()
  });

  // Notify sidebar
  notifySidebarOfStateChange();
}

// ==================== v1.6.3.12-v2 PORT HANDLER HELPERS ====================
// These helpers reduce duplication in port message handlers

/**
 * Update Quick Tab property in both session and global state
 * v1.6.3.12-v2 - FIX Code Health: Unified state update helper
 * @private
 * @param {number} tabId - Origin tab ID
 * @param {string} quickTabId - Quick Tab ID to update
 * @param {Function} updater - Function to update the Quick Tab (receives qt, returns boolean)
 * @returns {boolean} Whether the Quick Tab was found and updated
 */
function _updateQuickTabProperty(tabId, quickTabId, updater) {
  let found = false;
  const tabQuickTabs = quickTabsSessionState.quickTabsByTab[tabId] || [];

  for (const qt of tabQuickTabs) {
    if (qt.id === quickTabId) {
      updater(qt);
      found = true;
      break;
    }
  }

  const globalQt = globalQuickTabState.tabs.find(qt => qt.id === quickTabId);
  if (globalQt) {
    updater(globalQt);
    found = true;
  }
  globalQuickTabState.lastUpdate = Date.now();

  return found;
}

/**
 * Send acknowledgment response via port
 * v1.6.3.12-v2 - FIX Code Health: Unified ACK sender
 * @private
 * @param {browser.runtime.Port} port - Port to send response on
 * @param {string} ackType - Type of acknowledgment (e.g., 'MINIMIZE_QUICK_TAB_ACK')
 * @param {boolean} success - Whether the operation succeeded
 * @param {string} quickTabId - Quick Tab ID
 */
function _sendQuickTabAck(port, ackType, success, quickTabId) {
  port.postMessage({
    type: ackType,
    success,
    quickTabId,
    timestamp: Date.now()
  });
}

/**
 * Generic Quick Tab property update handler
 * v1.6.3.12-v8 - FIX Code Health: Unified helper to reduce duplication
 * @private
 * @param {Object} options - Handler options
 * @param {number} options.tabId - Origin tab ID
 * @param {string} options.quickTabId - Quick Tab ID to update
 * @param {browser.runtime.Port} options.port - Source port for response
 * @param {string} options.operation - Operation name for logging
 * @param {string} options.ackType - ACK message type to send
 * @param {Function} options.updateFn - Function to apply updates to Quick Tab
 */
function _handleQuickTabUpdate({ tabId, quickTabId, port, operation, ackType, updateFn }) {
  console.log(`[Background] ${operation} from tab ${tabId}:`, { quickTabId });

  const found = _updateQuickTabProperty(tabId, quickTabId, updateFn);

  _sendQuickTabAck(port, ackType, found, quickTabId);
  if (found) notifySidebarOfStateChange();
}

/**
 * Handle MINIMIZE_QUICK_TAB message from content script
 * v1.6.3.12-v2 - FIX Code Health: Use unified helpers
 * v1.6.3.12-v8 - FIX Code Health: Use generic handler to reduce duplication
 * @param {number} tabId - Origin tab ID
 * @param {string} quickTabId - Quick Tab ID to minimize
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleMinimizeQuickTabPort(tabId, quickTabId, port) {
  _handleQuickTabUpdate({
    tabId,
    quickTabId,
    port,
    operation: 'MINIMIZE_QUICK_TAB',
    ackType: 'MINIMIZE_QUICK_TAB_ACK',
    updateFn: qt => {
      qt.minimized = true;
      qt.minimizedAt = Date.now();
    }
  });
}

/**
 * Handle RESTORE_QUICK_TAB message from content script
 * v1.6.3.12-v2 - FIX Code Health: Use unified helpers
 * v1.6.3.12-v8 - FIX Code Health: Use generic handler to reduce duplication
 * @param {number} tabId - Origin tab ID
 * @param {string} quickTabId - Quick Tab ID to restore
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleRestoreQuickTabPort(tabId, quickTabId, port) {
  _handleQuickTabUpdate({
    tabId,
    quickTabId,
    port,
    operation: 'RESTORE_QUICK_TAB',
    ackType: 'RESTORE_QUICK_TAB_ACK',
    updateFn: qt => {
      qt.minimized = false;
      qt.restoredAt = Date.now();
    }
  });
}

/**
 * Handle DELETE_QUICK_TAB message from content script
 * v1.6.3.12-v2 - FIX Code Health: Reduced duplication
 * @param {number} tabId - Origin tab ID
 * @param {string} quickTabId - Quick Tab ID to delete
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleDeleteQuickTabPort(tabId, quickTabId, port) {
  // v1.6.3.12-v5 - FIX Issue #3: Add handler ENTRY/EXIT logging
  const handlerStartTime = performance.now();
  const correlationId = port._lastCorrelationId || `delete-${quickTabId}-${Date.now()}`;

  console.log(
    `[QUICKTABREMOVED_HANDLER_ENTRY] id=${quickTabId}, correlationId=${correlationId}, timestamp=${Date.now()}`,
    {
      quickTabId,
      tabId,
      correlationId,
      handlerType: 'DELETE_QUICK_TAB'
    }
  );

  const tabQuickTabs = quickTabsSessionState.quickTabsByTab[tabId] || [];
  const index = tabQuickTabs.findIndex(qt => qt.id === quickTabId);
  let found = index >= 0;

  if (found) tabQuickTabs.splice(index, 1);

  const globalIndex = globalQuickTabState.tabs.findIndex(qt => qt.id === quickTabId);
  if (globalIndex >= 0) {
    globalQuickTabState.tabs.splice(globalIndex, 1);
    found = true;
  }
  globalQuickTabState.lastUpdate = Date.now();

  _sendQuickTabAck(port, 'DELETE_QUICK_TAB_ACK', found, quickTabId);
  if (found) notifySidebarOfStateChange();

  // v1.6.3.12-v5 - FIX Issue #3: Handler EXIT log with outcome and duration
  const durationMs = performance.now() - handlerStartTime;
  const outcome = found ? 'success' : 'not_found';
  console.log(
    `[QUICKTABREMOVED_HANDLER_EXIT] id=${quickTabId}, outcome=${outcome}, durationMs=${durationMs.toFixed(2)}, correlationId=${correlationId}`,
    {
      quickTabId,
      tabId,
      outcome,
      durationMs: durationMs.toFixed(2),
      correlationId,
      tabsRemainingInTab: tabQuickTabs.length,
      globalTabsRemaining: globalQuickTabState.tabs.length
    }
  );
}

/**
 * Handle QUERY_MY_QUICK_TABS message from content script
 * v1.6.3.12 - Option 4: Return Quick Tabs for specific tab
 * @param {number} tabId - Tab ID to query
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleQueryMyQuickTabs(tabId, port) {
  const quickTabs = quickTabsSessionState.quickTabsByTab[tabId] || [];
  console.log(`[Background] QUERY_MY_QUICK_TABS for tab ${tabId}:`, { count: quickTabs.length });
  _sendQuickTabsListResponse(port, 'QUERY_MY_QUICK_TABS_RESPONSE', quickTabs, false);
}

/**
 * Handle HYDRATE_ON_LOAD message from content script
 * v1.6.3.12-v2 - FIX Code Health: Use shared response builder
 * v1.6.3.12 - J4: Container-aware hydration logging
 * @param {number} tabId - Tab ID requesting hydration
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleHydrateOnLoad(tabId, port) {
  const quickTabs = quickTabsSessionState.quickTabsByTab[tabId] || [];
  const cookieStoreId = port.sender?.tab?.cookieStoreId || 'unknown';

  // v1.6.3.12 - J4: Log container-aware hydration details
  console.log(`[Background] HYDRATE_ON_LOAD for tab ${tabId}:`, {
    count: quickTabs.length,
    sessionId: quickTabsSessionState.sessionId,
    requestingContainer: cookieStoreId
  });

  // v1.6.3.12 - J4: Log container mismatch decisions if any Quick Tabs have different containers
  if (quickTabs.length > 0) {
    const containerMismatches = quickTabs.filter(
      qt => qt.originContainerId && qt.originContainerId !== cookieStoreId
    );

    if (containerMismatches.length > 0) {
      console.log('[Background] HYDRATION_CONTAINER_MISMATCH:', {
        tabId,
        requestingContainer: cookieStoreId,
        mismatchedQuickTabs: containerMismatches.map(qt => ({
          id: qt.id,
          originContainerId: qt.originContainerId
        })),
        note: 'Quick Tabs with different containers still returned (filtering at content script)'
      });
    }
  }

  _sendQuickTabsListResponse(port, 'HYDRATE_ON_LOAD_RESPONSE', quickTabs, true);
}

/**
 * Handle UPDATE_QUICK_TAB message from content script
 * v1.6.3.12-v2 - FIX Code Health: Use unified helpers
 * v1.6.3.12-v8 - FIX Code Health: Use generic handler to reduce duplication
 * @param {number} tabId - Origin tab ID
 * @param {Object} msg - Message with quickTabId and updates
 * @param {browser.runtime.Port} port - Source port for response
 */
function handleUpdateQuickTab(tabId, msg, port) {
  const { quickTabId, updates } = msg;
  // v1.6.3.12-v8 - Log updates object separately for diagnostics
  console.log(`[Background] UPDATE_QUICK_TAB from tab ${tabId}:`, { quickTabId, updates });

  _handleQuickTabUpdate({
    tabId,
    quickTabId,
    port,
    operation: 'UPDATE_QUICK_TAB',
    ackType: 'UPDATE_QUICK_TAB_ACK',
    updateFn: qt => {
      Object.assign(qt, updates);
      qt.lastUpdate = Date.now();
    }
  });
}

/**
 * Send Quick Tabs list response via port
 * v1.6.3.12-v2 - FIX Code Health: Shared response builder
 * @private
 * @param {browser.runtime.Port} port - Port to send response on
 * @param {string} responseType - Type of response message
 * @param {Array} quickTabs - Quick Tabs array
 * @param {boolean} includeSessionInfo - Whether to include session info
 */
function _sendQuickTabsListResponse(port, responseType, quickTabs, includeSessionInfo) {
  const response = {
    type: responseType,
    quickTabs,
    tabCount: quickTabs.length,
    timestamp: Date.now()
  };

  if (includeSessionInfo) {
    response.sessionId = quickTabsSessionState.sessionId;
    response.sessionStartTime = quickTabsSessionState.sessionStartTime;
  }

  port.postMessage(response);
}

/**
 * Handle GET_ALL_QUICK_TABS message from sidebar
 * v1.6.3.12-v2 - FIX Code Health: Use shared response builder
 * v1.6.4 - FIX Issue #11/#14: Enhanced logging showing cross-tab aggregation
 * @param {browser.runtime.Port} port - Sidebar port
 */
function handleGetAllQuickTabs(port) {
  const allTabs = getAllQuickTabsFromMemory();

  // v1.6.4 - FIX Issue #11/#14: Compute origin tab grouping for logging
  const originTabGroups = {};
  for (const tab of allTabs) {
    const originKey = tab.originTabId || 'orphaned';
    if (!originTabGroups[originKey]) {
      originTabGroups[originKey] = [];
    }
    originTabGroups[originKey].push(tab.id);
  }

  // v1.6.4 - FIX Issue #11/#14: Log detailed response showing ALL tabs from ALL browser tabs
  console.log('[Background] GET_ALL_QUICK_TABS_RESPONSE_DETAIL:', {
    timestamp: Date.now(),
    totalQuickTabs: allTabs.length,
    originTabCount: Object.keys(originTabGroups).length,
    groupedByOriginTab: originTabGroups,
    sessionId: quickTabsSessionState.sessionId,
    message: `Returning ${allTabs.length} Quick Tabs from ${Object.keys(originTabGroups).length} origin tabs to Manager`
  });

  console.log('[Background] GET_ALL_QUICK_TABS for sidebar:', {
    count: allTabs.length,
    sessionId: quickTabsSessionState.sessionId
  });
  _sendQuickTabsListResponse(port, 'GET_ALL_QUICK_TABS_RESPONSE', allTabs, true);
}

/**
 * Handle SIDEBAR_READY message from sidebar
 * v1.6.3.12-v2 - FIX Code Health: Use shared response builder
 * @param {browser.runtime.Port} port - Sidebar port
 */
function handleSidebarReady(port) {
  const allTabs = getAllQuickTabsFromMemory();
  console.log('[Background] SIDEBAR_READY - sending full state:', {
    count: allTabs.length,
    sessionId: quickTabsSessionState.sessionId
  });
  _sendQuickTabsListResponse(port, 'SIDEBAR_STATE_SYNC', allTabs, true);
}

// ==================== v1.6.3.12-v2 MESSAGE HANDLER LOOKUP TABLES ====================
// These lookup tables reduce cyclomatic complexity in message routing

/**
 * Content script message handlers lookup table
 * v1.6.3.12-v2 - FIX Code Health: Replace switch with lookup table
 * @private
 */
const _contentScriptMessageHandlers = {
  CREATE_QUICK_TAB: (tabId, msg, port) => handleCreateQuickTab(tabId, msg.quickTab, port),
  MINIMIZE_QUICK_TAB: (tabId, msg, port) => handleMinimizeQuickTabPort(tabId, msg.quickTabId, port),
  RESTORE_QUICK_TAB: (tabId, msg, port) => handleRestoreQuickTabPort(tabId, msg.quickTabId, port),
  DELETE_QUICK_TAB: (tabId, msg, port) => handleDeleteQuickTabPort(tabId, msg.quickTabId, port),
  QUERY_MY_QUICK_TABS: (tabId, _msg, port) => handleQueryMyQuickTabs(tabId, port),
  HYDRATE_ON_LOAD: (tabId, _msg, port) => handleHydrateOnLoad(tabId, port),
  UPDATE_QUICK_TAB: (tabId, msg, port) => handleUpdateQuickTab(tabId, msg, port)
};

/**
 * Sidebar message handlers lookup table
 * v1.6.3.12-v2 - FIX Code Health: Replace switch with lookup table
 * @private
 */
const _sidebarMessageHandlers = {
  GET_ALL_QUICK_TABS: (_msg, port) => handleGetAllQuickTabs(port),
  SIDEBAR_READY: (_msg, port) => handleSidebarReady(port),
  CLOSE_QUICK_TAB: (msg, port) => handleSidebarCloseQuickTab(msg.quickTabId, port),
  MINIMIZE_QUICK_TAB: (msg, port) => handleSidebarMinimizeQuickTab(msg.quickTabId, port),
  RESTORE_QUICK_TAB: (msg, port) => handleSidebarRestoreQuickTab(msg.quickTabId, port),
  // v1.6.3.12-v7 - FIX Issue #15: Add Close All Quick Tabs handler
  CLOSE_ALL_QUICK_TABS: (msg, port) => handleSidebarCloseAllQuickTabs(msg, port),
  // v1.6.4 - FIX Issue #12: Add Close Minimized Quick Tabs handler
  CLOSE_MINIMIZED_QUICK_TABS: (msg, port) => handleSidebarCloseMinimizedQuickTabs(msg, port)
};

/**
 * Send error response for unknown message type
 * v1.6.3.12-v2 - FIX Code Health: Extracted helper
 * @private
 */
function _sendUnknownMessageError(port, source, msgType) {
  console.warn(`[Background] Unknown message type from ${source}:`, msgType);
  port.postMessage({
    type: 'ERROR',
    error: `Unknown message type: ${msgType}`,
    timestamp: Date.now()
  });
}

/**
 * Log port handler entry
 * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce duplication
 * v1.6.3.12-v8 - FIX Code Health: Converted to options object (5 args -> 1)
 * @private
 * @param {Object} options - Logging options
 * @param {string} options.msgType - Message type
 * @param {string} options.correlationId - Correlation ID for tracing
 * @param {string} options.source - Source identifier
 * @param {number} [options.tabId] - Tab ID (optional)
 * @param {string[]} options.payloadKeys - Keys in the message payload
 */
function _logPortHandlerEntry({ msgType, correlationId, source, tabId, payloadKeys }) {
  const logData = {
    type: msgType,
    correlationId,
    source,
    payloadKeys
  };
  if (tabId !== undefined) {
    logData.tabId = tabId;
  }
  console.log(
    `[PORT_HANDLER_ENTRY] type=${msgType}, correlationId=${correlationId}, timestamp=${Date.now()}`,
    logData
  );
}

/**
 * Log port handler exit
 * v1.6.3.12-v8 - FIX Code Health: Extracted to reduce duplication
 * v1.6.3.12-v8 - FIX Code Health: Converted to options object (5 args -> 1)
 * @private
 * @param {Object} options - Logging options
 * @param {string} options.msgType - Message type
 * @param {string} options.outcome - Handler outcome
 * @param {string} options.durationMs - Duration in milliseconds (formatted string)
 * @param {string} options.correlationId - Correlation ID for tracing
 * @param {number} [options.tabId] - Tab ID (optional)
 */
function _logPortHandlerExit({ msgType, outcome, durationMs, correlationId, tabId }) {
  const logData = {
    type: msgType,
    outcome,
    durationMs,
    correlationId
  };
  if (tabId !== undefined) {
    logData.tabId = tabId;
  }
  console.log(
    `[PORT_HANDLER_EXIT] type=${msgType}, outcome=${outcome}, durationMs=${durationMs}`,
    logData
  );
}

/**
 * Generic port message handler
 * v1.6.3.12-v8 - FIX Code Health: Unified helper to reduce duplication between
 * handleContentScriptPortMessage and handleSidebarPortMessage
 * @private
 * @param {Object} options - Handler options
 * @param {Object} options.msg - Message object
 * @param {browser.runtime.Port} options.port - Port to respond on
 * @param {string} options.source - Source identifier for logging
 * @param {string} options.correlationPrefix - Prefix for auto-generated correlation IDs
 * @param {Object} options.handlers - Lookup table of message handlers
 * @param {Function} options.invokeHandler - Function to invoke the handler
 * @param {number} [options.tabId] - Tab ID (optional, for content script messages)
 */
function _handlePortMessage({
  msg,
  port,
  source,
  correlationPrefix,
  handlers,
  invokeHandler,
  tabId
}) {
  const handlerStartTime = performance.now();
  const correlationId = msg.correlationId || `${correlationPrefix}-${msg.type}-${Date.now()}`;

  // v1.6.3.12-v8 - Use options object for logging
  _logPortHandlerEntry({
    msgType: msg.type,
    correlationId,
    source,
    tabId,
    payloadKeys: Object.keys(msg)
  });

  // Store correlationId on port for downstream handlers
  port._lastCorrelationId = correlationId;

  const handler = handlers[msg.type];
  let outcome = 'unknown_type';

  if (handler) {
    invokeHandler(handler, msg, port);
    outcome = 'success';
  } else {
    const sourceLabel = tabId !== undefined ? `tab ${tabId}` : source;
    _sendUnknownMessageError(port, sourceLabel, msg.type);
  }

  const durationMs = (performance.now() - handlerStartTime).toFixed(2);
  // v1.6.3.12-v8 - Use options object for logging
  _logPortHandlerExit({ msgType: msg.type, outcome, durationMs, correlationId, tabId });
}

/**
 * Handle content script port message
 * v1.6.3.12-v2 - FIX Code Health: Use lookup table instead of switch
 * v1.6.3.12-v5 - FIX Issue #7: Add handler ENTRY/EXIT logging
 * v1.6.3.12-v8 - FIX Code Health: Use generic handler to reduce duplication
 * @param {number} tabId - Tab ID of the content script
 * @param {Object} msg - Message from content script
 * @param {browser.runtime.Port} port - Source port
 */
function handleContentScriptPortMessage(tabId, msg, port) {
  _handlePortMessage({
    msg,
    port,
    source: 'content-script',
    correlationPrefix: 'cs',
    handlers: _contentScriptMessageHandlers,
    invokeHandler: (handler, message, p) => handler(tabId, message, p),
    tabId
  });
}

/**
 * Handle sidebar port message
 * v1.6.3.12-v2 - FIX Code Health: Use lookup table instead of switch
 * v1.6.3.12-v5 - FIX Issue #7: Add handler ENTRY/EXIT logging
 * v1.6.3.12-v8 - FIX Code Health: Use generic handler to reduce duplication
 * v1.6.3.12-v10 - FIX Issue #48: Enhanced logging for sidebar message debugging
 * @param {Object} msg - Message from sidebar
 * @param {browser.runtime.Port} port - Sidebar port
 */
function handleSidebarPortMessage(msg, port) {
  // v1.6.3.12-v10 - FIX Issue #48: Log sidebar message receipt with handler availability
  const handlerExists = !!_sidebarMessageHandlers[msg.type];
  console.log('[Background] SIDEBAR_MESSAGE_RECEIVED:', {
    type: msg.type,
    handlerExists,
    availableHandlers: Object.keys(_sidebarMessageHandlers),
    timestamp: Date.now(),
    correlationId: msg.correlationId || 'none',
    quickTabId: msg.quickTabId || 'none'
  });

  _handlePortMessage({
    msg,
    port,
    source: 'sidebar',
    correlationPrefix: 'sidebar',
    handlers: _sidebarMessageHandlers,
    invokeHandler: (handler, message, p) => handler(message, p)
  });
}

/**
 * Handle sidebar request to close a Quick Tab
 * v1.6.3.12-v2 - FIX Code Health: Reduced duplication
 * @param {string} quickTabId - Quick Tab ID to close
 * @param {browser.runtime.Port} sidebarPort - Sidebar port for response
 */
function handleSidebarCloseQuickTab(quickTabId, sidebarPort) {
  // v1.6.3.12-v5 - FIX Issue #3: Add handler ENTRY/EXIT logging
  const handlerStartTime = performance.now();
  const correlationId =
    sidebarPort._lastCorrelationId || `sidebar-close-${quickTabId}-${Date.now()}`;

  console.log(
    `[QUICKTABREMOVED_HANDLER_ENTRY] id=${quickTabId}, correlationId=${correlationId}, timestamp=${Date.now()}`,
    {
      quickTabId,
      correlationId,
      handlerType: 'SIDEBAR_CLOSE_QUICK_TAB',
      source: 'sidebar'
    }
  );

  const { ownerTabId, found } = _removeQuickTabFromSessionState(quickTabId);

  const globalIndex = globalQuickTabState.tabs.findIndex(qt => qt.id === quickTabId);
  if (globalIndex >= 0) globalQuickTabState.tabs.splice(globalIndex, 1);
  globalQuickTabState.lastUpdate = Date.now();

  _notifyContentScriptOfCommand(ownerTabId, found, 'CLOSE_QUICK_TAB_COMMAND', quickTabId);
  _sendQuickTabAck(sidebarPort, 'CLOSE_QUICK_TAB_ACK', found, quickTabId);
  notifySidebarOfStateChange();

  // v1.6.3.12-v5 - FIX Issue #3: Handler EXIT log with outcome and duration
  const durationMs = performance.now() - handlerStartTime;
  const outcome = found ? 'success' : 'not_found';
  console.log(
    `[QUICKTABREMOVED_HANDLER_EXIT] id=${quickTabId}, outcome=${outcome}, durationMs=${durationMs.toFixed(2)}, correlationId=${correlationId}`,
    {
      quickTabId,
      outcome,
      durationMs: durationMs.toFixed(2),
      correlationId,
      ownerTabId,
      globalTabsRemaining: globalQuickTabState.tabs.length
    }
  );
}

/**
 * Remove Quick Tab from session state
 * v1.6.3.12 - Helper to reduce nesting depth
 * @private
 * @param {string} quickTabId - Quick Tab ID to remove
 * @returns {{ ownerTabId: number|null, found: boolean }}
 */
function _removeQuickTabFromSessionState(quickTabId) {
  return _findAndModifyQuickTabInSession(quickTabId, (tabQuickTabs, index) => {
    tabQuickTabs.splice(index, 1);
  });
}

/**
 * Find Quick Tab in session state and apply a modifier function
 * v1.6.3.12-v2 - FIX Code Health: Unified session state modifier
 * @private
 * @param {string} quickTabId - Quick Tab ID to find
 * @param {Function} modifier - Function to modify the Quick Tab or array (receives tabQuickTabs, index, qt)
 * @returns {{ ownerTabId: number|null, found: boolean }}
 */
function _findAndModifyQuickTabInSession(quickTabId, modifier) {
  for (const tabId in quickTabsSessionState.quickTabsByTab) {
    const tabQuickTabs = quickTabsSessionState.quickTabsByTab[tabId];
    const index = tabQuickTabs.findIndex(qt => qt.id === quickTabId);
    if (index >= 0) {
      modifier(tabQuickTabs, index, tabQuickTabs[index]);
      return { ownerTabId: parseInt(tabId, 10), found: true };
    }
  }
  return { ownerTabId: null, found: false };
}

/**
 * Notify content script of a command
 * v1.6.3.12 - Helper to reduce nesting depth
 * v1.6.4 - FIX Issue #48: Add fallback to browser.tabs.sendMessage when port unavailable
 * @private
 * @param {number|null} ownerTabId - Tab ID that owns the Quick Tab
 * @param {boolean} found - Whether the Quick Tab was found
 * @param {string} commandType - Command type to send (e.g., CLOSE_QUICK_TAB_COMMAND)
 * @param {string} quickTabId - Quick Tab ID
 */
function _notifyContentScriptOfCommand(ownerTabId, found, commandType, quickTabId) {
  if (!found || ownerTabId === null) return;

  const message = {
    type: commandType,
    quickTabId,
    source: 'sidebar',
    timestamp: Date.now()
  };

  const contentPort = quickTabsSessionState.contentScriptPorts[ownerTabId];
  if (contentPort) {
    try {
      contentPort.postMessage(message);
      console.log(`[Background] Command sent via port: ${commandType}`, { ownerTabId, quickTabId });
      return;
    } catch (err) {
      console.warn('[Background] Port message failed, trying tabs.sendMessage:', err.message);
    }
  }

  // v1.6.4 - FIX Issue #48: Fallback to browser.tabs.sendMessage when port unavailable
  // This ensures commands reach content scripts even if port was disconnected
  // Convert _COMMAND suffix to match ACTION_HANDLERS (e.g., CLOSE_QUICK_TAB_COMMAND -> CLOSE_QUICK_TAB)
  const action = commandType.replace(/_COMMAND$/, '');

  // Validate that the action was converted correctly
  const validActions = ['CLOSE_QUICK_TAB', 'MINIMIZE_QUICK_TAB', 'RESTORE_QUICK_TAB'];
  if (!validActions.includes(action)) {
    console.warn(`[Background] Invalid action after conversion: ${action}`, {
      originalCommandType: commandType,
      ownerTabId,
      quickTabId
    });
    return; // Don't send invalid actions
  }

  console.log(`[Background] Using tabs.sendMessage fallback for: ${commandType}`, {
    ownerTabId,
    quickTabId,
    action,
    reason: contentPort ? 'port_error' : 'no_port'
  });

  browser.tabs.sendMessage(ownerTabId, {
    action,
    quickTabId,
    source: 'sidebar',
    timestamp: Date.now()
  }).catch(err => {
    console.warn(`[Background] tabs.sendMessage also failed for tab ${ownerTabId}:`, err.message);
  });
}

/**
 * Sidebar minimize/restore operation config
 * v1.6.3.12-v2 - FIX Code Health: Reduce function arguments with config object
 * @private
 */
const _sidebarMinimizeConfig = {
  true: {
    commandType: 'MINIMIZE_QUICK_TAB_COMMAND',
    ackType: 'MINIMIZE_QUICK_TAB_ACK',
    logLabel: 'SIDEBAR_MINIMIZE_QUICK_TAB',
    timestampField: 'minimizedAt'
  },
  false: {
    commandType: 'RESTORE_QUICK_TAB_COMMAND',
    ackType: 'RESTORE_QUICK_TAB_ACK',
    logLabel: 'SIDEBAR_RESTORE_QUICK_TAB',
    timestampField: 'restoredAt'
  }
};

/**
 * Handle sidebar request to toggle Quick Tab minimized state
 * v1.6.3.12-v2 - FIX Code Health: Reduced to 3 arguments using config lookup
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {boolean} minimized - Target minimized state
 * @param {browser.runtime.Port} sidebarPort - Sidebar port
 */
function _handleSidebarMinimizedToggle(quickTabId, minimized, sidebarPort) {
  const config = _sidebarMinimizeConfig[minimized];
  console.log(`[Background] ${config.logLabel}:`, { quickTabId });

  const { ownerTabId, found } = _updateQuickTabMinimizedState(quickTabId, minimized);

  const globalQt = globalQuickTabState.tabs.find(qt => qt.id === quickTabId);
  if (globalQt) {
    globalQt.minimized = minimized;
    globalQt[config.timestampField] = Date.now();
  }
  globalQuickTabState.lastUpdate = Date.now();

  _notifyContentScriptOfCommand(ownerTabId, found, config.commandType, quickTabId);
  _sendQuickTabAck(sidebarPort, config.ackType, found, quickTabId);
  notifySidebarOfStateChange();
}

/**
 * Handle sidebar request to minimize a Quick Tab
 * v1.6.3.12-v2 - FIX Code Health: Use unified toggle handler
 * @param {string} quickTabId - Quick Tab ID to minimize
 * @param {browser.runtime.Port} sidebarPort - Sidebar port for response
 */
function handleSidebarMinimizeQuickTab(quickTabId, sidebarPort) {
  _handleSidebarMinimizedToggle(quickTabId, true, sidebarPort);
}

/**
 * Handle sidebar request to restore a Quick Tab
 * v1.6.3.12-v2 - FIX Code Health: Use unified toggle handler
 * @param {string} quickTabId - Quick Tab ID to restore
 * @param {browser.runtime.Port} sidebarPort - Sidebar port for response
 */
function handleSidebarRestoreQuickTab(quickTabId, sidebarPort) {
  _handleSidebarMinimizedToggle(quickTabId, false, sidebarPort);
}

/**
 * Handle sidebar request to close all Quick Tabs
 * v1.6.3.12-v7 - FIX Issue #15: Implement Close All button via port messaging
 * @param {Object} msg - Message from sidebar
 * @param {browser.runtime.Port} sidebarPort - Sidebar port for response
 */
function handleSidebarCloseAllQuickTabs(msg, sidebarPort) {
  const handlerStartTime = performance.now();
  // Use msg.correlationId if available, otherwise generate a new one
  const correlationId = msg.correlationId || `close-all-${Date.now()}`;

  console.log('[Background] SIDEBAR_CLOSE_ALL_QUICK_TABS:', {
    correlationId,
    timestamp: Date.now(),
    currentQuickTabCount: getAllQuickTabsFromMemory().length
  });

  // Count Quick Tabs before clearing
  const allQuickTabs = getAllQuickTabsFromMemory();
  const closedCount = allQuickTabs.length;
  const quickTabIds = allQuickTabs.map(qt => qt.id);

  // Notify all content scripts to close their Quick Tabs
  for (const quickTab of allQuickTabs) {
    const ownerTabId = quickTab.originTabId;
    if (ownerTabId) {
      _notifyContentScriptOfCommand(ownerTabId, true, 'CLOSE_QUICK_TAB_COMMAND', quickTab.id);
    }
  }

  // Clear all Quick Tabs from session state
  quickTabsSessionState.quickTabsByTab = {};

  // Clear global state
  globalQuickTabState.tabs = [];
  globalQuickTabState.lastUpdate = Date.now();
  globalQuickTabState.saveId = `close-all-${Date.now()}`;

  // Clear Quick Tab host tracking
  quickTabHostTabs.clear();

  // Send ACK to sidebar
  if (sidebarPort) {
    sidebarPort.postMessage({
      type: 'CLOSE_ALL_QUICK_TABS_ACK',
      success: true,
      closedCount,
      quickTabIds,
      correlationId,
      timestamp: Date.now()
    });
  }

  // Notify sidebar of state change (empty state)
  notifySidebarOfStateChange();

  // Log completion
  const durationMs = performance.now() - handlerStartTime;
  console.log('[Background] CLOSE_ALL_QUICK_TABS completed:', {
    correlationId,
    closedCount,
    durationMs: durationMs.toFixed(2),
    globalTabsRemaining: globalQuickTabState.tabs.length
  });
}

/**
 * Handle sidebar request to close only minimized Quick Tabs
 * v1.6.4 - FIX Issue #12: Implement Close Minimized button via port messaging
 * @param {Object} msg - Message from sidebar
 * @param {browser.runtime.Port} sidebarPort - Sidebar port for response
 */
/**
 * Notify content script to close a Quick Tab
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleSidebarCloseMinimizedQuickTabs
 * @private
 * @param {Object} quickTab - Quick Tab to close
 */
function _notifyOwnerToCloseQuickTab(quickTab) {
  const ownerTabId = quickTab.originTabId;
  if (ownerTabId) {
    _notifyContentScriptOfCommand(ownerTabId, true, 'CLOSE_QUICK_TAB_COMMAND', quickTab.id);
  }
}

/**
 * Remove Quick Tabs from session state by ID set
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleSidebarCloseMinimizedQuickTabs
 * @private
 * @param {Set<string>} idSet - Set of Quick Tab IDs to remove
 */
function _removeQuickTabsFromSessionState(idSet) {
  for (const tabId of Object.keys(quickTabsSessionState.quickTabsByTab)) {
    const tabQuickTabs = quickTabsSessionState.quickTabsByTab[tabId];
    if (Array.isArray(tabQuickTabs)) {
      quickTabsSessionState.quickTabsByTab[tabId] = tabQuickTabs.filter(qt => !idSet.has(qt.id));
    }
  }
}

/**
 * Update global state after closing Quick Tabs
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleSidebarCloseMinimizedQuickTabs
 * @private
 * @param {Set<string>} idSet - Set of Quick Tab IDs that were closed
 */
function _updateGlobalStateAfterClose(idSet) {
  globalQuickTabState.tabs = globalQuickTabState.tabs.filter(qt => !idSet.has(qt.id));
  globalQuickTabState.lastUpdate = Date.now();
  globalQuickTabState.saveId = `close-minimized-${Date.now()}`;
}

/**
 * Send ACK for close minimized operation
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleSidebarCloseMinimizedQuickTabs
 * @private
 * @param {browser.runtime.Port} sidebarPort - Sidebar port
 * @param {number} closedCount - Number of Quick Tabs closed
 * @param {Array<string>} quickTabIds - IDs of closed Quick Tabs
 * @param {string} correlationId - Correlation ID for tracking
 */
function _sendCloseMinimizedAck(sidebarPort, closedCount, quickTabIds, correlationId) {
  if (!sidebarPort) return;

  sidebarPort.postMessage({
    type: 'CLOSE_MINIMIZED_QUICK_TABS_ACK',
    success: true,
    closedCount,
    quickTabIds,
    correlationId,
    timestamp: Date.now()
  });
}

function handleSidebarCloseMinimizedQuickTabs(msg, sidebarPort) {
  const handlerStartTime = performance.now();
  const correlationId = msg.correlationId || `close-minimized-${Date.now()}`;

  const allQuickTabs = getAllQuickTabsFromMemory();
  const minimizedQuickTabs = allQuickTabs.filter(qt => qt.minimized === true);

  console.log('[Background] SIDEBAR_CLOSE_MINIMIZED_QUICK_TABS:', {
    correlationId,
    timestamp: Date.now(),
    totalQuickTabs: allQuickTabs.length,
    minimizedCount: minimizedQuickTabs.length
  });

  const closedCount = minimizedQuickTabs.length;
  const quickTabIds = minimizedQuickTabs.map(qt => qt.id);
  const minimizedIdSet = new Set(quickTabIds);

  // Notify content scripts to close their minimized Quick Tabs
  minimizedQuickTabs.forEach(_notifyOwnerToCloseQuickTab);

  // Remove minimized Quick Tabs from session state
  _removeQuickTabsFromSessionState(minimizedIdSet);

  // Update global state
  _updateGlobalStateAfterClose(minimizedIdSet);

  // Remove from host tracking
  quickTabIds.forEach(id => quickTabHostTabs.delete(id));

  // Send ACK to sidebar
  _sendCloseMinimizedAck(sidebarPort, closedCount, quickTabIds, correlationId);

  // Notify sidebar of state change
  notifySidebarOfStateChange();

  // Log completion
  const durationMs = performance.now() - handlerStartTime;
  console.log('[Background] CLOSE_MINIMIZED_QUICK_TABS completed:', {
    correlationId,
    closedCount,
    durationMs: durationMs.toFixed(2),
    globalTabsRemaining: globalQuickTabState.tabs.length
  });
}

/**
 * Update Quick Tab minimized state in session state
 * v1.6.3.12-v2 - FIX Code Health: Use shared session modifier
 * @private
 * @param {string} quickTabId - Quick Tab ID to update
 * @param {boolean} minimized - Whether to minimize or restore
 * @returns {{ ownerTabId: number|null, found: boolean }}
 */
function _updateQuickTabMinimizedState(quickTabId, minimized) {
  const timestampField = minimized ? 'minimizedAt' : 'restoredAt';
  return _findAndModifyQuickTabInSession(quickTabId, (_tabQuickTabs, _index, qt) => {
    qt.minimized = minimized;
    qt[timestampField] = Date.now();
  });
}

/**
 * Capture disconnect reason from runtime.lastError
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 * @returns {string} Disconnect reason
 */
function _captureDisconnectReason() {
  try {
    return browser.runtime?.lastError?.message || 'unknown';
  } catch (_e) {
    return 'unknown';
  }
}

/**
 * Log content script port replacement
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _logContentPortReplacement(tabId, cookieStoreId) {
  console.log('[Background] PORT_ROUTING: Replacing existing content script port', {
    tabId,
    cookieStoreId,
    reason: 'reconnection',
    previousPortExists: true
  });
}

/**
 * Create content script port disconnect handler
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 * @param {number} tabId - Tab ID
 * @param {string} cookieStoreId - Container ID
 * @returns {Function} Disconnect handler
 */
function _createContentPortDisconnectHandler(tabId, cookieStoreId) {
  return () => {
    const disconnectReason = _captureDisconnectReason();
    console.log('[Background] PORT_DISCONNECT: Content script port disconnected', {
      tabId,
      cookieStoreId,
      reason: disconnectReason,
      timestamp: Date.now(),
      quickTabsCount: quickTabsSessionState.quickTabsByTab[tabId]?.length || 0,
      remainingPorts: Object.keys(quickTabsSessionState.contentScriptPorts).length - 1
    });
    delete quickTabsSessionState.contentScriptPorts[tabId];
    notifySidebarOfStateChange();
  };
}

/**
 * Setup content script port handlers
 * v1.6.3.12-v2 - FIX Code Health: Extract to reduce handleQuickTabsPortConnect complexity
 * v1.6.3.12 - J1: Enhanced port lifecycle logging with container context
 * v1.6.3.12-v7 - Refactored: Extract helpers to reduce cyclomatic complexity
 * @private
 * @param {number} tabId - Tab ID
 * @param {browser.runtime.Port} port - The port
 */
function _setupContentScriptPort(tabId, port) {
  const existingPort = quickTabsSessionState.contentScriptPorts[tabId];
  const cookieStoreId = port.sender?.tab?.cookieStoreId || 'unknown';

  if (existingPort) {
    _logContentPortReplacement(tabId, cookieStoreId);
  }

  quickTabsSessionState.contentScriptPorts[tabId] = port;

  if (!quickTabsSessionState.quickTabsByTab[tabId]) {
    quickTabsSessionState.quickTabsByTab[tabId] = [];
  }

  port.onMessage.addListener(msg => handleContentScriptPortMessage(tabId, msg, port));
  port.onDisconnect.addListener(_createContentPortDisconnectHandler(tabId, cookieStoreId));

  console.log('[Background] PORT_ROUTING: Content script port registered', {
    tabId,
    cookieStoreId,
    totalContentPorts: Object.keys(quickTabsSessionState.contentScriptPorts).length,
    existingQuickTabs: quickTabsSessionState.quickTabsByTab[tabId]?.length || 0
  });
}

/**
 * Create sidebar port disconnect handler
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 * @returns {Function} Disconnect handler
 */
function _createSidebarPortDisconnectHandler() {
  return () => {
    const disconnectReason = _captureDisconnectReason();
    console.log('[Background] PORT_DISCONNECT: Sidebar port disconnected', {
      reason: disconnectReason,
      timestamp: Date.now(),
      totalQuickTabs: getAllQuickTabsFromMemory().length
    });
    quickTabsSessionState.sidebarPort = null;
  };
}

/**
 * Setup sidebar port handlers
 * v1.6.3.12-v2 - FIX Code Health: Extract to reduce handleQuickTabsPortConnect complexity
 * v1.6.3.12 - J1: Enhanced port lifecycle logging
 * v1.6.3.12-v7 - Refactored: Use shared disconnect reason capture
 * @private
 * @param {browser.runtime.Port} port - The port
 */
function _setupSidebarPort(port) {
  const previousSidebarPort = quickTabsSessionState.sidebarPort;

  if (previousSidebarPort) {
    console.log('[Background] PORT_ROUTING: Replacing existing sidebar port', {
      reason: 'new_connection',
      previousPortExists: true
    });
  }

  quickTabsSessionState.sidebarPort = port;

  port.onMessage.addListener(msg => handleSidebarPortMessage(msg, port));
  port.onDisconnect.addListener(_createSidebarPortDisconnectHandler());

  console.log('[Background] PORT_ROUTING: Sidebar port registered', {
    timestamp: Date.now(),
    connectedContentPorts: Object.keys(quickTabsSessionState.contentScriptPorts).length
  });

  handleSidebarReady(port);
}

/**
 * Check if port URL indicates sidebar origin
 * v1.6.3.12-v10 - FIX Code Health: Extracted to reduce handleQuickTabsPortConnect complexity
 * @private
 * @param {string|undefined} url - Sender URL to check
 * @returns {boolean} True if URL indicates sidebar origin
 */
function _isSidebarUrl(url) {
  if (!url) return false;
  return (
    url.includes('sidebar/') || url.includes('sidebar.html') || url.includes('quick-tabs-manager')
  );
}

/**
 * Check if tab ID is valid for content script
 * v1.6.3.12-v10 - FIX Code Health: Extracted to reduce handleQuickTabsPortConnect complexity
 * @private
 * @param {*} tabId - Tab ID to validate
 * @returns {boolean} True if tab ID is a valid positive number
 */
function _isValidContentScriptTabId(tabId) {
  return typeof tabId === 'number' && tabId > 0;
}

/**
 * Analyze port sender to determine connection type
 * v1.6.3.12-v10 - FIX Code Health: Extracted to reduce handleQuickTabsPortConnect complexity
 * @private
 * @param {Object} sender - Port sender object
 * @returns {{ isSidebar: boolean, isContentScript: boolean, tabId: number|undefined, hasValidTabId: boolean }}
 */
function _analyzePortSender(sender) {
  const tabId = sender.tab?.id;
  const isSidebar = _isSidebarUrl(sender.url);
  const hasValidTabId = _isValidContentScriptTabId(tabId);
  const isContentScript = hasValidTabId && !isSidebar;

  return { isSidebar, isContentScript, tabId, hasValidTabId };
}

/**
 * Log unhandled port connection
 * v1.6.3.12-v10 - FIX Code Health: Extracted to reduce handleQuickTabsPortConnect complexity
 * @private
 * @param {Object} analysis - Port analysis result
 * @param {string} url - Sender URL
 */
function _logUnhandledPortConnection(analysis, url) {
  console.warn('[Background] QUICK_TABS_PORT_UNHANDLED:', {
    timestamp: Date.now(),
    reason: 'Neither sidebar nor content script',
    isSidebar: analysis.isSidebar,
    isContentScript: analysis.isContentScript,
    hasValidTabId: analysis.hasValidTabId,
    tabId: analysis.tabId,
    url
  });
}

/**
 * Route port connection to appropriate handler
 * v1.6.3.12-v10 - FIX Code Health: Extracted to reduce handleQuickTabsPortConnect complexity
 * @private
 * @param {browser.runtime.Port} port - The connecting port
 * @param {Object} analysis - Port analysis result
 */
function _routePortConnection(port, analysis) {
  if (analysis.isSidebar) {
    _setupSidebarPort(port);
  } else if (analysis.isContentScript) {
    _setupContentScriptPort(analysis.tabId, port);
  } else {
    _logUnhandledPortConnection(analysis, port.sender?.url);
  }
}

/**
 * Handle Quick Tabs port connection (port name: 'quick-tabs-port')
 * v1.6.3.12-v2 - FIX Code Health: Reduced complexity by extracting helpers
 * v1.6.3.12-v10 - FIX Code Health: Refactored to reduce cc from 12 to <9
 * @param {browser.runtime.Port} port - The connecting port
 */
function handleQuickTabsPortConnect(port) {
  if (port.name !== 'quick-tabs-port') return false;

  const sender = port.sender;
  const analysis = _analyzePortSender(sender);

  console.log('[Background] QUICK_TABS_PORT_CONNECT:', {
    isContentScript: analysis.isContentScript,
    isSidebar: analysis.isSidebar,
    tabId: analysis.tabId,
    hasValidTabId: analysis.hasValidTabId,
    url: sender.url,
    senderFrameId: sender.frameId,
    hasTab: !!sender.tab
  });

  _routePortConnection(port, analysis);

  return true;
}

// Register the Quick Tabs port handler
// This runs BEFORE handlePortConnect for matching ports
browser.runtime.onConnect.addListener(port => {
  if (port.name === 'quick-tabs-port') {
    handleQuickTabsPortConnect(port);
  }
  // Other ports are handled by handlePortConnect
});

console.log('[Background] v1.6.3.12 Quick Tabs port messaging initialized');

// ==================== END v1.6.3.12 OPTION 4 PORT MESSAGING ====================

// ==================== v1.6.3.6-v11 TAB LIFECYCLE EVENTS ====================
// FIX Issue #16: Track browser tab lifecycle for orphan detection
// v1.6.3.10-v3 - Phase 2: Enhanced orphan detection with ORIGIN_TAB_CLOSED broadcast

/**
 * Mark Quick Tabs as orphaned in cache
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleTabRemoved
 * @private
 * @param {Array} orphanedQuickTabs - Array of Quick Tabs to mark as orphaned
 * @param {number} operationTimestamp - Timestamp for orphaned marking
 */
function _markQuickTabsAsOrphaned(orphanedQuickTabs, operationTimestamp) {
  for (const qt of orphanedQuickTabs) {
    qt.isOrphaned = true;
    qt.orphanedAt = operationTimestamp;
    quickTabHostTabs.delete(qt.id);
  }
}

/**
 * Notify sidebar of tab closed via quick-tabs-port
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleTabRemoved
 * @private
 * @param {Object} originTabClosedMessage - Message to send
 */
function _notifySidebarOfTabClosed(originTabClosedMessage) {
  if (!quickTabsSessionState.sidebarPort) return;

  try {
    quickTabsSessionState.sidebarPort.postMessage(originTabClosedMessage);
    console.log('[Background] ORIGIN_TAB_CLOSED sent to sidebar via quick-tabs-port');
  } catch (err) {
    console.warn('[Background] Failed to send ORIGIN_TAB_CLOSED to sidebar:', err.message);
  }
}

/**
 * Save orphan status to storage
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleTabRemoved
 * @private
 * @param {number} tabId - Closed tab ID
 * @param {number} operationTimestamp - Timestamp for save operation
 */
function _saveOrphanStatusToStorage(tabId, operationTimestamp) {
  if (typeof browser.storage.local === 'undefined') return;

  const saveId = `orphan-${tabId}-${operationTimestamp}`;
  browser.storage.local
    .set({
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        saveId,
        timestamp: operationTimestamp
      }
    })
    .catch(err => console.error('[Background] Error saving orphan status:', err));
}

/**
 * Clean up ports associated with removed tab
 * v1.6.3.12-v8 - FIX Code Health: Extracted from handleTabRemoved
 * @private
 * @param {number} tabId - Closed tab ID
 */
function _cleanupPortsForTab(tabId) {
  for (const [portId, portInfo] of portRegistry.entries()) {
    if (portInfo.tabId === tabId) {
      unregisterPort(portId, 'tab-removed');
    }
  }
}

/**
 * Handle browser tab removal
 * v1.6.3.6-v11 - FIX Issue #16: Mark Quick Tabs as orphaned when their browser tab closes
 * v1.6.3.10-v3 - Phase 2: Enhanced orphan detection with isOrphaned flag and ORIGIN_TAB_CLOSED broadcast
 * v1.6.3.12-v8 - FIX Code Health: Reduced cc from 10 to <9 via extraction
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

  const orphanedIds = orphanedQuickTabs.map(t => t.id);
  const operationTimestamp = Date.now();

  console.log('[Background] ORIGIN_TAB_CLOSED - Found orphaned Quick Tabs:', {
    closedTabId: tabId,
    orphanedCount: orphanedIds.length,
    orphanedIds
  });

  // v1.6.3.12-v8 - Mark orphaned and remove from host tracking
  _markQuickTabsAsOrphaned(orphanedQuickTabs, operationTimestamp);

  // v1.6.3.12-v7 - FIX Issue #12: Build message object once
  const originTabClosedMessage = {
    type: 'ORIGIN_TAB_CLOSED',
    originTabId: tabId,
    orphanedQuickTabIds: orphanedIds,
    orphanedCount: orphanedIds.length,
    timestamp: operationTimestamp
  };

  // Broadcast to all ports and sidebar
  broadcastToAllPorts(originTabClosedMessage);
  _notifySidebarOfTabClosed(originTabClosedMessage);

  // Broadcast legacy TAB_LIFECYCLE_CHANGE for backward compatibility
  broadcastToAllPorts({
    type: 'BROADCAST',
    action: 'TAB_LIFECYCLE_CHANGE',
    event: 'tab-removed',
    tabId,
    affectedQuickTabs: orphanedIds,
    timestamp: operationTimestamp
  });

  // Save to storage and cleanup ports
  _saveOrphanStatusToStorage(tabId, operationTimestamp);
  _cleanupPortsForTab(tabId);
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
 * Counter wrap limit to prevent integer overflow
 * v1.6.3.10-v5 - FIX Code Review: Centralized constant
 */
const COUNTER_WRAP_LIMIT = 1000000;

/**
 * Generate unique message ID for correlation
 * v1.6.3.6-v5 - FIX Issue #4c: Correlation IDs for message tracing
 * v1.6.3.10-v5 - FIX Issue #11: Message ID counter wrapping to prevent overflow
 * @returns {string} Unique message ID
 */
function generateMessageId() {
  // v1.6.3.10-v5 - FIX Issue #11: Wrap counter to prevent overflow
  messageIdCounter = (messageIdCounter + 1) % COUNTER_WRAP_LIMIT;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

// v1.6.3.10-v5 - FIX Issue #11: Message logging throttle infrastructure
// Throttle period (1 second) to reduce console spam under heavy load
const LOGGING_THROTTLE_MS = 1000;
// Debug mode flag - set to true to enable verbose logging
// v1.6.3.10-v5 - Use globalThis for service worker compatibility
const _debugModeEnabled = typeof globalThis !== 'undefined' && globalThis.DEBUG_MODE === true;

/**
 * Check if logging should be throttled for a specific log type
 * v1.6.3.10-v5 - FIX Issue #11: Logging throttle to reduce console spam
 * @private
 * @param {number} lastLogTime - Last logged time for this type
 * @returns {boolean} True if logging should be throttled (skipped)
 */
function _shouldThrottleLog(lastLogTime) {
  return Date.now() - lastLogTime < LOGGING_THROTTLE_MS && !_debugModeEnabled;
}

/**
 * Generic throttled log helper
 * v1.6.3.10-v8 - FIX Code Health: Consolidated duplicate logging
 * @private
 */
function _logThrottled(emoji, category, lastTimeRef, data) {
  if (_shouldThrottleLog(lastTimeRef.time)) return;
  const now = Date.now();
  lastTimeRef.time = now;
  console.log(`[Background] ${emoji} ${category}:`, { ...data, timestamp: now });
}

// Throttle trackers using objects for reference passing
const _dispatchThrottle = { time: 0 };
const _receiptThrottle = { time: 0 };

/**
 * Log message dispatch (outgoing)
 */
function logMessageDispatch(messageId, messageType, senderTabId, target) {
  _logThrottled('📤', 'MESSAGE DISPATCH', _dispatchThrottle, {
    messageId,
    messageType,
    senderTabId,
    target
  });
}

/**
 * Log message receipt (incoming)
 */
function logMessageReceipt(messageId, messageType, senderTabId) {
  _logThrottled('📥', 'MESSAGE RECEIPT', _receiptThrottle, {
    messageId: messageId || 'N/A',
    messageType,
    senderTabId
  });
}

// Throttle tracker for deletion logs
const _deletionThrottle = { time: 0 };

/**
 * Log deletion event propagation
 * v1.6.3.10-v8 - FIX Code Health: Use consolidated throttle pattern
 */
function logDeletionPropagation(correlationId, phase, quickTabId, details = {}) {
  if (_shouldThrottleLog(_deletionThrottle.time)) return;
  _deletionThrottle.time = Date.now();

  const phaseEmoji = {
    submit: '🗑️ DELETION SUBMIT',
    received: '🗑️ DELETION RECEIVED',
    'broadcast-complete': '🗑️ DELETION BROADCAST COMPLETE'
  };
  const baseData = { correlationId, quickTabId, timestamp: Date.now() };

  if (phase === 'submit') {
    console.log(`[Background] ${phaseEmoji[phase]}:`, {
      ...baseData,
      source: details.source,
      excludeTabId: details.excludeTabId
    });
  } else if (phase === 'received') {
    console.log(`[Background] ${phaseEmoji[phase]}:`, {
      ...baseData,
      receiverTabId: details.receiverTabId,
      stateApplied: details.stateApplied
    });
  } else if (phase === 'broadcast-complete') {
    console.log(`[Background] ${phaseEmoji[phase]}:`, {
      ...baseData,
      totalTabs: details.totalTabs,
      successCount: details.successCount
    });
  }
}

// ==================== END MESSAGE LOGGING INFRASTRUCTURE ====================

// ==================== v1.6.3.11-v8 HANDLER INSTRUMENTATION ====================
// FIX Diagnostic Logging #5: Handler message entry/exit logging

/**
 * Log handler entry with parameters
 * v1.6.3.11-v8 - FIX Diagnostic Logging #5: Entry logging for handlers
 * @param {string} handlerName - Name of the handler
 * @param {Object} params - Handler parameters
 * @param {number|null} senderTabId - Sender tab ID
 * @returns {number} Start timestamp for duration calculation
 */
function _logHandlerEntry(handlerName, params, senderTabId = null) {
  const startTime = Date.now();
  console.log(`[Handler][ENTRY] ${handlerName}:`, {
    'sender.tab.id': senderTabId,
    parameters: params,
    timestamp: new Date().toISOString()
  });
  return startTime;
}

/**
 * Format result for logging, handling tabs array specially
 * v1.6.3.11-v8 - FIX Code Review: Extracted to improve readability
 * @private
 */
function _formatResultForLogging(result) {
  if (!result) return 'N/A';
  if (typeof result !== 'object') return result;
  // For objects, replace tabs array with count to avoid verbose output
  return { ...result, tabs: result.tabs?.length ?? 'N/A' };
}

/**
 * Log handler exit with result and duration
 * v1.6.3.11-v8 - FIX Diagnostic Logging #5: Exit logging for handlers
 * @param {string} handlerName - Name of the handler
 * @param {number} startTime - Start timestamp from entry
 * @param {boolean} success - Whether handler succeeded
 * @param {*} result - Handler result (optional)
 */
function _logHandlerExit(handlerName, startTime, success, result = null) {
  const duration = Date.now() - startTime;
  console.log(`[Handler][EXIT] ${handlerName}:`, {
    duration: duration + 'ms',
    success,
    result: _formatResultForLogging(result)
  });
}

// ==================== END HANDLER INSTRUMENTATION ====================

/**
 * Track which tab hosts each Quick Tab
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Enable Manager remote control
 * Key: quickTabId, Value: browser tab ID
 */
const quickTabHostTabs = new Map();

/**
 * Ensure initialization is complete before processing
 * v1.6.3.10-v8 - FIX Code Health: Extracted initialization logic
 * @private
 */
async function _ensureInitializedForHandler(handlerName) {
  const guard = checkInitializationGuard(handlerName);
  if (guard.initialized) return { ready: true };

  const initialized = await waitForInitialization(2000);
  if (!initialized) {
    console.warn(`[Background] ${handlerName} rejected - not initialized`);
    return { ready: false, errorResponse: guard.errorResponse };
  }
  return { ready: true };
}

/**
 * Handle QUICK_TAB_STATE_CHANGE message from content scripts
 * v1.6.3.5-v3 - FIX Architecture Phase 1-2: Content scripts report state changes to background
 * v1.6.3.10-v8 - FIX Code Health: Reduced complexity via extraction
 * v1.6.3.11-v8 - FIX Diagnostic Logging #5: Handler entry/exit instrumentation
 */
async function handleQuickTabStateChange(message, sender) {
  const sourceTabId = sender?.tab?.id ?? message.sourceTabId;
  const { quickTabId, changes, source } = message;

  // v1.6.3.11-v8 - FIX Diagnostic Logging #5: Entry logging
  const startTime = _logHandlerEntry(
    'handleQuickTabStateChange',
    { quickTabId, changes, source },
    sourceTabId
  );

  const initCheck = await _ensureInitializedForHandler('handleQuickTabStateChange');
  if (!initCheck.ready) {
    _logHandlerExit('handleQuickTabStateChange', startTime, false, initCheck.errorResponse);
    return initCheck.errorResponse;
  }

  const messageId = message.messageId || generateMessageId();
  logMessageReceipt(messageId, 'QUICK_TAB_STATE_CHANGE', sourceTabId);
  console.log('[Background] QUICK_TAB_STATE_CHANGE:', { quickTabId, changes, source, sourceTabId });

  _updateQuickTabHostTracking(quickTabId, sourceTabId);

  // Handle deletion
  if (changes?.deleted === true || source === 'destroy') {
    await _handleQuickTabDeletion(quickTabId, source, sourceTabId);
    _logHandlerExit('handleQuickTabStateChange', startTime, true, { deleted: true });
    return { success: true };
  }

  _updateGlobalQuickTabCache(quickTabId, changes, sourceTabId);
  await broadcastQuickTabStateUpdate(quickTabId, changes, source, sourceTabId);

  _logHandlerExit('handleQuickTabStateChange', startTime, true, { success: true });
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
// v1.6.3.10-v5 - FIX Issue #9: Per-Quick Tab circuit breaker instead of global
// Track recent broadcasts to prevent storms
let _broadcastHistory = []; // Use let for cleanup mutation in Issue #10 fix
// 100ms window chosen based on typical user interaction timing - broadcasts within this window
// are likely duplicates from the same user action (e.g., drag event fires multiple times)
const BROADCAST_HISTORY_WINDOW_MS = 100;
// Limit of 10 broadcasts per window based on empirical observation that legitimate operations
// rarely generate more than 2-3 broadcasts per 100ms. 10 provides safety margin while catching loops.
const BROADCAST_CIRCUIT_BREAKER_LIMIT = 10;
// v1.6.3.10-v5 - FIX Issue #9: Per-Quick Tab circuit breaker state
// Map: quickTabId -> { tripped: boolean, resetTime: number }
const _perTabCircuitBreakers = new Map();
// Circuit breaker cooldown period (1 second)
const CIRCUIT_BREAKER_COOLDOWN_MS = 1000;

/**
 * Try to reset circuit breaker for a specific Quick Tab if cooldown elapsed
 * v1.6.3.10-v5 - FIX Issue #9: Per-Quick Tab circuit breaker
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} now - Current timestamp
 * @returns {boolean} True if circuit breaker was reset or not tripped
 */
function _tryResetPerTabCircuitBreaker(quickTabId, now) {
  const state = _perTabCircuitBreakers.get(quickTabId);
  if (!state || !state.tripped) {
    return true; // Not tripped
  }

  if (now - state.resetTime > CIRCUIT_BREAKER_COOLDOWN_MS) {
    _perTabCircuitBreakers.delete(quickTabId);
    console.log('[Background] Per-tab circuit breaker RESET for:', quickTabId);
    return true; // Reset
  }

  return false; // Still tripped
}

/**
 * Check if per-tab circuit breaker is tripped
 * v1.6.3.10-v5 - FIX Issue #9: Per-Quick Tab circuit breaker
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} now - Current timestamp
 * @returns {boolean} True if circuit breaker is tripped
 */
function _isPerTabCircuitBreakerTripped(quickTabId, now) {
  return !_tryResetPerTabCircuitBreaker(quickTabId, now);
}

/**
 * Clean up expired entries from broadcast history
 * v1.6.3.10-v5 - FIX Issue #10: Cleanup BEFORE duplicate check to prevent race condition
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupBroadcastHistory(now) {
  // v1.6.3.10-v5 - FIX Issue #10: Use filter for atomic cleanup before checks
  _broadcastHistory = _broadcastHistory.filter(
    entry => now - entry.time <= BROADCAST_HISTORY_WINDOW_MS
  );
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
 * Trip the circuit breaker for a specific Quick Tab
 * v1.6.3.10-v5 - FIX Issue #9: Per-Quick Tab circuit breaker
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} now - Current timestamp
 * @returns {{ allowed: boolean, reason: string }}
 */
function _tripPerTabCircuitBreaker(quickTabId, now) {
  _perTabCircuitBreakers.set(quickTabId, { tripped: true, resetTime: now });
  console.error(
    '[Background] ⚠️ PER-TAB CIRCUIT BREAKER TRIPPED for',
    quickTabId,
    '- too many broadcasts within',
    BROADCAST_HISTORY_WINDOW_MS,
    'ms'
  );
  // Count broadcasts for this specific Quick Tab
  const tabBroadcastCount = _broadcastHistory.filter(e => e.quickTabId === quickTabId).length;
  console.error('[Background] Broadcasts for this Quick Tab in window:', tabBroadcastCount);
  return { allowed: false, reason: 'per-tab circuit breaker limit exceeded' };
}

/**
 * Check if broadcast should be allowed (circuit breaker + deduplication)
 * v1.6.3.6-v4 - FIX Issue #4: Prevent broadcast storms
 * v1.6.3.12-v7 - Refactored: Extracted helpers to reduce cyclomatic complexity
 * v1.6.3.10-v5 - FIX Issue #9: Per-Quick Tab circuit breaker (not global)
 * v1.6.3.10-v5 - FIX Issue #10: Cleanup before duplicate check to prevent race condition
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 * @returns {{ allowed: boolean, reason: string }}
 */
function _shouldAllowBroadcast(quickTabId, changes) {
  const now = Date.now();

  // v1.6.3.10-v5 - FIX Issue #10: Cleanup BEFORE any checks to prevent race condition
  _cleanupBroadcastHistory(now);

  // v1.6.3.10-v5 - FIX Issue #9: Check per-tab circuit breaker (not global)
  if (_isPerTabCircuitBreakerTripped(quickTabId, now)) {
    return { allowed: false, reason: 'per-tab circuit breaker tripped' };
  }

  const changesHash = JSON.stringify(changes);
  if (_isDuplicateBroadcast(quickTabId, changesHash)) {
    return { allowed: false, reason: 'duplicate broadcast within window' };
  }

  // v1.6.3.10-v5 - FIX Issue #9: Count broadcasts per Quick Tab, not global
  const tabBroadcastCount = _broadcastHistory.filter(e => e.quickTabId === quickTabId).length;
  if (tabBroadcastCount >= BROADCAST_CIRCUIT_BREAKER_LIMIT) {
    return _tripPerTabCircuitBreaker(quickTabId, now);
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

  // Broadcast to Manager sidebar (if open)
  try {
    await browser.runtime.sendMessage(message);
    console.log('[Background] Sent state update to sidebar/popup');
  } catch (_err) {
    // Sidebar may not be open - ignore
  }

  // v1.6.3.7 - FIX Issue #3: For deletions, broadcast to ALL tabs (except sender)
  // This ensures UI button and Manager button produce identical cross-tab results
  if (changes?.deleted === true) {
    // v1.6.3.6-v5 - FIX Issue #4e: Pass correlation ID for deletion tracing
    await _broadcastDeletionToAllTabs(quickTabId, source, excludeTabId, changes.correlationId);
  }
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
 * v1.6.3.11-v8 - FIX Diagnostic Logging #5: Handler entry/exit instrumentation
 * @param {Object} message - Message containing command
 */
function handleManagerCommand(message) {
  const { command, quickTabId, sourceContext } = message;

  // v1.6.3.11-v8 - FIX Diagnostic Logging #5: Entry logging
  const startTime = _logHandlerEntry(
    'handleManagerCommand',
    { command, quickTabId, sourceContext },
    null
  );

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
      const result = executeManagerCommand(command, quickTabId, cachedTab.originTabId);
      _logHandlerExit('handleManagerCommand', startTime, true, {
        routed: true,
        hostFromCache: true
      });
      return result;
    }
    _logHandlerExit('handleManagerCommand', startTime, false, { error: 'Quick Tab host unknown' });
    return Promise.resolve({ success: false, error: 'Quick Tab host unknown' });
  }

  _logHandlerExit('handleManagerCommand', startTime, true, { routed: true, hostTabId });
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
 * Log Manager action result
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce executeManagerCommand complexity
 * @private
 */
/**
 * Log Manager action result
 * v1.6.3.10-v8 - FIX Code Health: Use options object instead of 7 parameters
 * @param {Object} opts - Logging options
 */
function _logManagerActionResult({
  action,
  quickTabId,
  hostTabId,
  correlationId,
  result,
  startTime,
  method
}) {
  const durationMs = Date.now() - startTime;
  const baseData = { action, quickTabId, hostTabId, correlationId, method, durationMs };
  if (result.success !== false) {
    console.log('[Background] MANAGER_ACTION_COMPLETED:', { ...baseData, status: 'success' });
  } else {
    console.error('[Background] MANAGER_ACTION_FAILED:', {
      ...baseData,
      status: 'failed',
      error: result.error
    });
  }
}

/**
 * Execute Manager command by sending to target content script
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Route commands to correct tab
 * v1.6.3.10-v5 - FIX Issues #1 & #2: Timeout-protected messaging with Scripting API fallback
 * v1.6.3.12-v7 - FIX Code Health: Refactored to reduce line count (99 -> ~55)
 * @param {string} command - Command to execute
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} hostTabId - Tab ID hosting the Quick Tab
 * @returns {Promise<Object>} Result object with success status
 */
/**
 * Execute manager command with messaging and scripting fallback
 * v1.6.3.11-v10 - FIX Code Health: Extracted helpers to reduce function size
 */
function executeManagerCommand(command, quickTabId, hostTabId) {
  const context = _initManagerCommandContext(command, quickTabId, hostTabId);

  if (!_validateManagerCommand(command, context)) {
    return Promise.resolve({ success: false, error: `Unknown command: ${command}` });
  }

  const executeMessage = _buildExecuteMessage(command, quickTabId, context.correlationId);
  _logCommandRouting(context, executeMessage);

  return _executeWithFallback(executeMessage, context);
}

/**
 * Initialize context for manager command execution
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
function _initManagerCommandContext(command, quickTabId, hostTabId) {
  const correlationId = generateCorrelationId('mgr-cmd');
  const startTime = Date.now();

  console.log('[Background] MANAGER_ACTION_REQUESTED:', {
    action: command,
    quickTabId,
    hostTabId,
    correlationId,
    timestamp: startTime
  });

  return { correlationId, startTime, command, quickTabId, hostTabId };
}

/**
 * Validate manager command against allowlist
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
function _validateManagerCommand(command, context) {
  if (!VALID_MANAGER_COMMANDS.has(command)) {
    console.warn('[Background] MANAGER_ACTION_REJECTED:', {
      action: command,
      quickTabId: context.quickTabId,
      correlationId: context.correlationId,
      reason: 'invalid-command'
    });
    return false;
  }
  return true;
}

/**
 * Build execute message for manager command
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
function _buildExecuteMessage(command, quickTabId, correlationId) {
  return {
    type: 'EXECUTE_COMMAND',
    command,
    quickTabId,
    source: 'manager',
    correlationId
  };
}

/**
 * Log command routing
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
function _logCommandRouting(context, _executeMessage) {
  console.log('[Background] Routing command to tab:', {
    command: context.command,
    quickTabId: context.quickTabId,
    hostTabId: context.hostTabId,
    correlationId: context.correlationId
  });
}

/**
 * Execute command with messaging and scripting fallback
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
async function _executeWithFallback(executeMessage, context) {
  try {
    return await _executeViaMessaging(executeMessage, context);
  } catch (messagingErr) {
    return _handleMessagingFailure(executeMessage, context, messagingErr);
  }
}

/**
 * Execute command via messaging
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
async function _executeViaMessaging(executeMessage, context) {
  const response = await Promise.race([
    browser.tabs.sendMessage(context.hostTabId, executeMessage),
    createTimeoutPromise(MESSAGING_TIMEOUT_MS, 'Messaging timeout')
  ]);
  _logManagerActionResult({
    action: context.command,
    quickTabId: context.quickTabId,
    hostTabId: context.hostTabId,
    correlationId: context.correlationId,
    result: { success: true },
    startTime: context.startTime,
    method: 'messaging'
  });
  console.log('[Background] Command executed successfully:', response);
  return { success: true, response };
}

/**
 * Handle messaging failure with scripting fallback
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
async function _handleMessagingFailure(executeMessage, context, messagingErr) {
  console.log('[Background] Messaging failed, falling back to Scripting API:', {
    command: context.command,
    quickTabId: context.quickTabId,
    correlationId: context.correlationId,
    error: messagingErr.message
  });

  try {
    const fallbackResult = await _executeViaScripting(
      context.hostTabId,
      context.command,
      { quickTabId: context.quickTabId },
      context.correlationId
    );
    _logManagerActionResult({
      action: context.command,
      quickTabId: context.quickTabId,
      hostTabId: context.hostTabId,
      correlationId: context.correlationId,
      result: fallbackResult,
      startTime: context.startTime,
      method: 'scripting-fallback'
    });
    return fallbackResult;
  } catch (fallbackErr) {
    return _handleBothMethodsFailed(context, messagingErr, fallbackErr);
  }
}

/**
 * Handle both messaging and scripting methods failed
 * v1.6.3.11-v10 - Extracted for clarity
 * @private
 */
function _handleBothMethodsFailed(context, messagingErr, fallbackErr) {
  _logManagerActionResult({
    action: context.command,
    quickTabId: context.quickTabId,
    hostTabId: context.hostTabId,
    correlationId: context.correlationId,
    result: { success: false, error: fallbackErr.message },
    startTime: context.startTime,
    method: 'scripting-fallback'
  });
  console.error('[Background] Both messaging and scripting failed:', {
    command: context.command,
    quickTabId: context.quickTabId,
    hostTabId: context.hostTabId,
    messagingError: messagingErr.message,
    scriptingError: fallbackErr.message
  });
  return { success: false, error: fallbackErr.message, fallbackFailed: true };
}

// Register message handlers for Quick Tab coordination
// This extends the existing runtime.onMessage listener
// v1.6.3.10-v10 - FIX Issue #6: Add [INIT] boundary logging for handler registration timestamp
console.log('[INIT][Background] MESSAGE_HANDLER_REGISTRATION:', {
  timestamp: new Date().toISOString(),
  handler: 'QUICK_TAB_STATE_CHANGE + MANAGER_COMMAND',
  isInitialized
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  // v1.6.3.12-v2 - FIX Issue #1 (issue-47-extended-analysis): Add missing QUICKTAB_MINIMIZED handler
  // This routes minimize/restore state changes to sidebar for immediate UI update
  if (message.type === 'QUICKTAB_MINIMIZED') {
    const result = handleQuickTabMinimizedMessage(message, sender);
    sendResponse(result);
    return false; // Synchronous response
  }

  // v1.6.3.12-v7 - FIX Bug #3: Handle QUICKTAB_REMOVED message from content scripts
  // When content script's DestroyHandler closes a Quick Tab, it sends this message
  // to notify background, which then updates session state and notifies sidebar
  if (message.type === 'QUICKTAB_REMOVED') {
    handleQuickTabRemovedMessage(message, sender);
    sendResponse({ success: true });
    return false; // Synchronous response
  }

  // Let other handlers process the message
  return false;
});

console.log('[Background] v1.6.3.5-v3 Message infrastructure registered');
// ==================== END MESSAGE INFRASTRUCTURE ====================
