/**
 * Quick Tabs Manager Sidebar Script
 * Manages display and interaction with Quick Tabs across all containers
 *
 * v1.6.3.8-v5 - FIX Issue #1 (comprehensive-diagnostic-report.md): Storage Event Ordering
 *   - NEW: Monotonic revision versioning for storage event ordering
 *   - NEW: _lastAppliedRevision tracking - listeners reject revision ≤ current
 *   - NEW: _revisionEventBuffer for out-of-order event handling
 *   - NEW: _validateRevision() - validates incoming revision numbers
 *   - NEW: _bufferRevisionEvent() - buffers out-of-order events
 *   - NEW: _processBufferedRevisionEvents() - applies buffered events in order
 *   - NEW: _cleanupRevisionBuffer() - periodic cleanup of stale events
 *   - NEW: REVISION_BUFFER_MAX_AGE_MS (5s) - max age for buffered events
 *   - NEW: REVISION_BUFFER_MAX_SIZE (50) - max buffer size before cleanup
 *   - ARCHITECTURE: Revision validation runs after sequence ID validation
 *
 * v1.6.3.8-v4 - FIX 9 Critical Issues from quick-tabs-sync-critical.md:
 *   - FIX Issue #5: Initialization barrier Promise - ALL async tasks must complete before listeners process messages
 *   - FIX Issue #4: Storage listener verification with exponential backoff retry (1s, 2s, 4s)
 *   - FIX Issue #1: Sequential hydration barrier - blocks render until all tiers verified
 *   - FIX Issue #2: Port message queue guards during reconnection - prevents lost button clicks
 *   - FIX Issue #3: document.visibilitychange listener + periodic state freshness check (15s)
 *   - FIX Issue #6: Query background via port BEFORE rendering on hydration
 *   - FIX Issue #7: Proactive dedup cleanup at 50% capacity, sliding window eviction at 95%
 *   - FIX Issue #8: Probe queuing with min interval (500ms) and force-reset timeout (1000ms)
 *   - FIX Issue #9: Enforcing initialization guard - queue messages until barrier resolves
 *   - NEW: initializationBarrier Promise for true async init blocking
 *   - NEW: _queueMessageDuringInit() for pre-barrier message queuing
 *   - NEW: VISIBILITY_REFRESH_INTERVAL_MS (15s) periodic state freshness check
 *   - NEW: Storage listener verification retry with exponential backoff
 *   - ARCHITECTURE: All event listeners await initializationBarrier before processing
 *
 * v1.6.3.8-v3 - FIX Cross-Tab Communication Issues from diagnostic reports:
 *   - FIX Issue #1: BroadcastChannel demoted from Tier 1 - Port-based messaging is now PRIMARY for sidebar
 *   - FIX Issue #6: BC verification replaced with explicit state test + clear failure logging
 *   - FIX Issue #10: Port message queue now validates sequence numbers during flush (monotonic check)
 *   - FIX Issue #11: Old port onMessage listener explicitly removed on reconnection via stored reference
 *   - FIX Issue #16: Disconnect check added before flushing queue - logs warning if port is DISCONNECTED
 *   - NEW: _portOnMessageHandler reference stored for explicit cleanup
 *   - NEW: _lastReceivedSequence tracking for incoming message sequence validation
 *   - ARCHITECTURE: Port-based messaging is Tier 1 for sidebar, BroadcastChannel is Tier 2 (tab-to-tab only)
 *
 * v1.6.3.7-v13 - FIX Sidebar Communication Fallback Issues #5, #12, arch #1, #6:
 *   - FIX Issue #5: Sidebar BroadcastChannel fallback logging with SIDEBAR_BC_UNAVAILABLE message
 *   - FIX Issue #5: Explicit fallback mechanism type documentation (port-based + storage.onChanged)
 *   - FIX Issue #12: Enhanced fallback health monitoring with stall detection (60s threshold)
 *   - FIX Issue #12: Latency tracking in fallback stats (avgLatencyMs, lastLatencyMs)
 *   - FIX Issue #12: FALLBACK_HEALTH log with expected messages per interval (~6 if state changes every 5s)
 *   - FIX Issue #12: FALLBACK_STALLED warning when no updates for 60+ seconds
 *   - FIX arch #1: BC verification handshake (PING/PONG) to detect if BC actually works in sidebar
 *   - FIX arch #1: BC_VERIFICATION_FAILED log when messages don't cross sidebar boundary
 *   - FIX arch #6: Storage health probe - write timestamp to _sidebar_health_ping key
 *   - FIX arch #6: STORAGE_TIER_BROKEN log when onChanged doesn't fire within 500ms
 *   - FIX arch #6: Storage tier latency measurement (healthy/acceptable/degraded classification)
 *
 * v1.6.3.7-v10 - FIX Issue #10 (state-persistence-issues.md): Tab Affinity Map Desynchronization
 *   - FIX Issue #10: Enhanced cleanup job logging with before/after sizes and age bucket counts
 *   - FIX Issue #10: Age bucket distribution (< 1h, 1-6h, 6-24h, > 24h) in diagnostics
 *   - FIX Issue #10: Defensive cleanup via browser.tabs.query() cross-check
 *   - FIX Issue #10: Sample entries logging (first 5 entries with ages) every 60s
 *
 * v1.6.3.7-v9 - FIX Issues #2, #10:
 *   - FIX Issue #2: Unified MESSAGE_RECEIVED logging with [PORT], [BC], [RUNTIME] prefixes
 *   - FIX Issue #2: Correlation ID tracking across all three message paths
 *   - FIX Issue #2: Message entry/exit logging with duration for performance tracking
 *   - FIX Issue #10: Tab affinity map (quickTabHostInfo) 24-hour TTL cleanup
 *   - FIX Issue #10: browser.tabs.onRemoved listener to clean up closed tab entries
 *   - FIX Issue #10: Diagnostic logging for quickTabHostInfo size and age stats (60s)
 *
 * v1.6.3.7-v5 - FIX State Sync Issues #1-10 from quick-tabs-state-sync-issues.md
 *   - FIX Issue #1: Three explicit connection states (connected/zombie/disconnected)
 *   - FIX Issue #3: Unified message routing with logging for port vs runtime path
 *   - FIX Issue #4: State versioning with saveId deduplication
 *   - FIX Issue #5: Close All error feedback with user notifications
 *   - FIX Issue #6: Session cache validation with sessionId
 *   - FIX Issue #9: Message error handling with try-catch in all listeners
 *   - FIX Issue #10: Listener registration verification with test messages
 *
 * v1.6.3.7-v3 - FIX Issue #3: DOM Reconciliation for CSS animation flickering
 *   - Implements differential DOM updates instead of full re-renders
 *   - Tracks existing DOM elements by Quick Tab ID (_itemElements Map)
 *   - Tracks existing group elements by originTabId (_groupElements Map)
 *   - Only creates/removes DOM for added/deleted Quick Tabs
 *   - Updates existing elements in-place without triggering CSS animations
 *   - New items animate in correctly; existing items remain stable
 *
 * v1.6.3.6-v11 - FIX Issues #1-9 from comprehensive diagnostics
 *   - FIX Issue #1: Animations properly invoked on toggle
 *   - FIX Issue #2: Removed inline maxHeight conflicts, JS calculates scrollHeight
 *   - FIX Issue #3: Comprehensive animation lifecycle logging
 *   - FIX Issue #4: Favicon container uses CSS classes
 *   - FIX Issue #5: Consistent state terminology (STATE_OPEN/STATE_CLOSED)
 *   - FIX Issue #6: Section header creation logging
 *   - FIX Issue #7: Count badge update animation
 *   - FIX Issue #8: Unified storage event logging
 *   - FIX Issue #9: Adoption verification logging
 *
 * v1.6.3.6-v11 - ARCH: Architectural improvements (Issues #10-21)
 *   - FIX Issue #10: Message acknowledgment system with correlationId
 *   - FIX Issue #11: Persistent port connection to background script
 *   - FIX Issue #12: Port lifecycle logging
 *   - FIX Issue #17: Port cleanup on window unload
 *   - FIX Issue #20: Count badge diff-based animation
 *
 * v1.6.4.12 - REFACTOR: Major refactoring for code health improvement
 *   - Code Health: 5.34 → 9.09 (+70% improvement)
 *   - Extracted utilities to sidebar/utils/ modules
 *   - Reduced cyclomatic complexity: max CC 17 → no functions over CC 9
 *   - Converted to ES modules for clean imports
 *   - All complex methods refactored with helper functions
 *
 * Previous versions:
 * v1.6.4.10 - FIX Issues #1-12: Comprehensive UI/UX improvements
 * v1.6.3.6 - FIX Issue #3: Added comprehensive logging
 * v1.6.3.5-v11 - FIX Issue #6: Manager list updates when last Quick Tab closed
 */

// ==================== IMPORTS ====================
// v1.6.3.8-v4 - Bundle size refactoring: Import utilities from sidebar modules
// These modules contain shared constants and utility functions extracted for maintainability.
// 
// MIGRATION STRATEGY (v1.6.3.8-v4):
// Phase 1 (Current): Modules export constants and stateless utility functions.
//   - Main file (quick-tabs-manager.js) retains all state variables locally.
//   - Module functions are available but not yet integrated.
//   - No duplicate state - modules contain constants/functions only.
// Phase 2 (Future): Gradually migrate local constants to module imports.
// Phase 3 (Future): Migrate state management to modules with proper getters/setters.
//
// NOTE: The modules' state variables (e.g., in init-barrier.js) are NOT used yet.
//       The local state in this file remains authoritative.
import {
  // Diagnostics utilities (non-conflicting)
  generateCorrelationId as _generateCorrelationIdFromModule,
  generateSessionId as _generateSessionIdFromModule,
  formatDuration as _formatDuration,
  getAgeBucket as _getAgeBucket,
  // Health metrics utilities (non-conflicting) - NOT importing storageHealthStats as it's declared locally
  canStartProbe as _canStartProbeFromModule,
  startStorageProbe as _startStorageProbeFromModule,
  completeStorageProbe as _completeStorageProbeFromModule,
  getStorageSuccessRate as _getStorageSuccessRate,
  getStorageHealthTier as _getStorageHealthTier,
  getStorageHealthSnapshot as _getStorageHealthSnapshot,
  recordFallbackMessage as _recordFallbackMessage,
  checkFallbackStall as _checkFallbackStall,
  getFallbackHealthSnapshot as _getFallbackHealthSnapshot,
  generateHealthReport as _generateHealthReport
} from './modules/index.js';
import {
  computeStateHash,
  createFavicon,
  createGroupFavicon,
  animateCollapse,
  animateExpand,
  scrollIntoViewIfNeeded,
  animateGroupRemoval,
  extractTabsFromState,
  groupQuickTabsByOriginTab,
  logStateTransition,
  STATE_OPEN,
  STATE_CLOSED,
  ANIMATION_DURATION_MS
} from './utils/render-helpers.js';
import {
  STORAGE_READ_DEBOUNCE_MS,
  queryAllContentScriptsForQuickTabs,
  restoreStateFromContentScripts
} from './utils/storage-handlers.js';
import {
  isOperationPending,
  setupPendingOperation,
  sendMessageToAllTabs,
  isTabMinimizedHelper,
  filterMinimizedFromState,
  validateRestoreTabData,
  findTabInState,
  STATE_KEY
} from './utils/tab-operations.js';
import { filterInvalidTabs } from './utils/validation.js';
// v1.6.3.8-v5 - ARCHITECTURE: BroadcastChannel removed per architecture-redesign.md
// Imports kept for backwards compatibility - all functions are now NO-OP stubs
// eslint-disable-next-line no-unused-vars
import {
  initBroadcastChannel,
  addBroadcastListener,
  removeBroadcastListener,
  closeBroadcastChannel,
  isChannelAvailable as _isChannelAvailable,
  setGapDetectionCallback,
  processReceivedSequence,
  resetSequenceTracking,
  isBroadcastChannelStale
} from '../src/features/quick-tabs/channels/BroadcastChannelManager.js';
// v1.6.3.7-v8 - Phase 3A Optimization: Performance metrics
import PerformanceMetrics from '../src/features/quick-tabs/PerformanceMetrics.js';

// ==================== CONSTANTS ====================
// v1.6.3.8-v4 - Bundle refactoring: Shared constants/utilities in ./modules/
// Local constants remain here for now; modules provide a foundation for future refactoring.
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';
const BROWSER_TAB_CACHE_TTL_MS = 30000;
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';
const OPERATION_TIMEOUT_MS = 2000;
const DOM_VERIFICATION_DELAY_MS = 500;

// ==================== v1.6.3.8-v4 INITIALIZATION BARRIER CONSTANTS ====================
// FIX Issue #5: True async initialization barrier with Promise-based blocking

/**
 * Maximum time to wait for initialization barrier to resolve
 * v1.6.3.8-v4 - FIX Issue #5: 10 second max init time with clear error message
 */
const INIT_BARRIER_TIMEOUT_MS = 10000;

/**
 * Exponential backoff intervals for storage listener verification retry
 * v1.6.3.8-v4 - FIX Issue #4: Don't permanently disable Tier 3 on single timeout
 */
const STORAGE_VERIFICATION_RETRY_MS = [1000, 2000, 4000];

/**
 * Interval for periodic state freshness check when sidebar becomes visible
 * v1.6.3.8-v4 - FIX Issue #3: Active state refresh when visible
 */
const VISIBILITY_REFRESH_INTERVAL_MS = 15000;

/**
 * Capacity threshold for proactive dedup map cleanup
 * v1.6.3.8-v4 - FIX Issue #7: Cleanup at 50% capacity instead of waiting for 90%
 */
const DEDUP_CLEANUP_THRESHOLD = 0.5;

/**
 * Sliding window eviction threshold
 * v1.6.3.8-v4 - FIX Issue #7: Remove oldest 10% when hitting 95%
 */
const DEDUP_EVICTION_THRESHOLD = 0.95;

/**
 * Minimum time between storage health probes
 * v1.6.3.8-v4 - FIX Issue #8: Prevent rapid probe requests
 */
const PROBE_MIN_INTERVAL_MS = 500;

/**
 * Force reset timeout for stuck probe flag
 * v1.6.3.8-v4 - FIX Issue #8: If probe running >1000ms, force-reset flag
 */
const PROBE_FORCE_RESET_MS = 1000;

/**
 * Timeout for waiting on listener registration before sending messages
 * v1.6.3.8-v4 - FIX Issue #2: Extracted from inline timeout
 */
const LISTENER_REGISTRATION_TIMEOUT_MS = 3000;

// ==================== v1.6.4.13 DEBUG MESSAGING FLAG ====================
// Issue #5: Feature flag for verbose message routing logs
// Set to true to enable detailed logging of message routing at all tiers
const DEBUG_MESSAGING = true;

// ==================== v1.6.3.7-v9 Issue #10: TAB AFFINITY MAP CLEANUP ====================
// Constants for quickTabHostInfo TTL-based cleanup and browser.tabs.onRemoved handling

/**
 * TTL for quickTabHostInfo entries (24 hours in milliseconds)
 * v1.6.3.7-v9 - Issue #10: Remove stale entries older than this
 */
const HOST_INFO_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Cleanup interval for quickTabHostInfo stale entries (60 seconds)
 * v1.6.3.7-v9 - Issue #10: Run cleanup every 60 seconds
 */
const HOST_INFO_CLEANUP_INTERVAL_MS = 60000;

/**
 * Interval ID for quickTabHostInfo cleanup job
 * v1.6.3.7-v9 - Issue #10: Track for potential cleanup
 */
let hostInfoCleanupIntervalId = null;

// ==================== v1.6.3.7 CONSTANTS ====================
// FIX Issue #3: UI Flicker Prevention - Debounce renderUI()
const RENDER_DEBOUNCE_MS = 300;
// FIX Issue #5: Port Reconnect Circuit Breaker
const RECONNECT_BACKOFF_INITIAL_MS = 100;
const RECONNECT_BACKOFF_MAX_MS = 10000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
// v1.6.3.7-v4 - FIX Issue #8: Reduced from 10000ms to 2000ms
// Shorter blackout period with early recovery probes
const CIRCUIT_BREAKER_OPEN_DURATION_MS = 2000;
// v1.6.3.7-v4 - FIX Issue #8: Probe interval for early recovery detection
const CIRCUIT_BREAKER_PROBE_INTERVAL_MS = 500;

// ==================== v1.6.3.7-v4 MESSAGE DEDUPLICATION ====================
// FIX Issue #4: Prevent multiple renders from independent message listeners
// Track processed state versions to avoid duplicate processing
/**
 * Set of recently processed message IDs (for correlation ID based dedup)
 * v1.6.3.7-v4 - FIX Issue #4: Message deduplication
 */
const recentlyProcessedMessageIds = new Set();

/**
 * Max age for message ID tracking (ms)
 * v1.6.3.7-v4 - FIX Issue #4: Cleanup old message IDs
 */
const MESSAGE_ID_MAX_AGE_MS = 5000;

/**
 * Maximum deduplication entries before forced eviction
 * v1.6.4.16 - FIX Issue #13: Prevent unbounded growth of dedup map
 * 1000 entries * ~50 bytes per entry = ~50KB max memory
 */
const MESSAGE_DEDUP_MAX_SIZE = 1000;

// ==================== v1.6.3.7-v5 CONNECTION STATE TRACKING ====================
// FIX Issue #1: Three explicit connection states for background detection
/**
 * Connection state enum
 * v1.6.3.7-v5 - FIX Issue #1: Track three explicit states
 * - 'connected': Port is open AND background is responding to heartbeats
 * - 'zombie': Port appears open but background is not responding (Firefox 30s termination)
 * - 'disconnected': Port is closed, no connection
 */
const CONNECTION_STATE = {
  CONNECTED: 'connected',
  ZOMBIE: 'zombie',
  DISCONNECTED: 'disconnected'
};

/**
 * Current connection state
 * v1.6.3.7-v5 - FIX Issue #1: Explicit state tracking
 */
let connectionState = CONNECTION_STATE.DISCONNECTED;

/**
 * Timestamp of last connection state transition
 * v1.6.3.7-v5 - FIX Issue #1: State transition logging
 */
let lastConnectionStateChange = 0;

/**
 * Consecutive connection failures counter for state transition context
 * v1.6.3.7-v6 - Issue #3: Track consecutive failures for transition logging
 */
let consecutiveConnectionFailures = 0;

// ==================== v1.6.3.7-v6 INITIALIZATION TRACKING ====================
// Gap #1: State Loading & Initialization Race Condition
/**
 * Timeout ID for initial empty state wait
 * v1.6.3.7-v6 - Gap #1: Wait 2 seconds before rendering empty if initial load is empty
 */
let initialLoadTimeoutId = null;

/**
 * Start time for state load duration tracking
 * v1.6.3.7-v6 - Gap #1: Track load duration for diagnostics
 */
let stateLoadStartTime = 0;

/**
 * Flag to track if initial state load has completed
 * v1.6.3.7-v6 - Gap #1: Prevent duplicate initialization
 */
let initialStateLoadComplete = false;

// ==================== v1.6.3.7-v9 ISSUE #11: INITIALIZATION BARRIER ====================
// FIX Issue #11: Prevent race conditions between initialization and listeners

/**
 * Flag indicating initialization has started (DOMContentLoaded fired)
 * v1.6.3.7-v9 - FIX Issue #11: Part of initialization barrier
 */
let initializationStarted = false;

/**
 * Flag indicating all async initialization is complete
 * v1.6.3.7-v9 - FIX Issue #11: Part of initialization barrier
 */
let initializationComplete = false;

/**
 * v1.6.3.7-v10 - FIX Issue #11: Track initialization start time for time-since-init logging
 */
let initializationStartTime = 0;

/**
 * Check if sidebar is fully initialized
 * v1.6.3.7-v9 - FIX Issue #11: Guard function for listeners
 * @returns {boolean} True if initialization is complete
 */
function isFullyInitialized() {
  return initializationStarted && initializationComplete;
}

// v1.6.3.7-v10 - FIX Code Review: Named constant for uninitialized timestamp
const INIT_TIME_NOT_STARTED = -1;

/**
 * Log listener entry with initialization status
 * v1.6.3.7-v9 - FIX Issue #11: Diagnostic logging for race detection
 * v1.6.3.7-v10 - FIX Issue #11: Added time since init start
 * @param {string} listenerName - Name of the listener
 * @param {Object} context - Additional context to log
 */
function logListenerEntry(listenerName, context = {}) {
  const fullyInit = isFullyInitialized();
  const timeSinceInitStartMs =
    initializationStartTime > 0 ? Date.now() - initializationStartTime : INIT_TIME_NOT_STARTED;
  console.log(`[Manager] LISTENER_ENTRY: ${listenerName}`, {
    isFullyInitialized: fullyInit,
    initializationStarted,
    initializationComplete,
    timeSinceInitStartMs,
    connectionState,
    timestamp: Date.now(),
    ...context
  });
}

// ==================== v1.6.3.7-v5 SAVEID DEDUPLICATION ====================
// FIX Issue #4: State versioning using saveId for deduplication
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

// ==================== v1.6.3.8-v4 INITIALIZATION BARRIER PROMISE ====================
// FIX Issue #5: True async initialization barrier with Promise-based blocking

/**
 * Promise that resolves when ALL async initialization is complete
 * v1.6.3.8-v4 - FIX Issue #5: Single barrier that blocks ALL event listeners
 */
let initializationBarrier = null;

/**
 * Resolver for initialization barrier Promise
 * v1.6.3.8-v4 - FIX Issue #5: Called when init is complete
 */
let _initBarrierResolve = null;

/**
 * Rejecter for initialization barrier Promise
 * v1.6.3.8-v4 - FIX Issue #5: Called on init timeout
 */
let _initBarrierReject = null;

/**
 * Queue for messages received before initialization barrier resolves
 * v1.6.3.8-v4 - FIX Issue #9: Messages are queued and replayed after barrier
 */
const preInitMessageQueue = [];

/**
 * Timer ID for initialization barrier timeout
 * v1.6.3.8-v4 - FIX Issue #5: 10 second timeout with clear error
 */
let initBarrierTimeoutId = null;

/**
 * Track current phase of initialization for logging
 * v1.6.3.8-v4 - FIX Issue #5: Explicit logging of barrier transitions
 */
let currentInitPhase = 'not-started';

/**
 * Storage listener verification retry attempt counter
 * v1.6.3.8-v4 - FIX Issue #4: Exponential backoff retry tracking
 */
let storageVerificationRetryCount = 0;

/**
 * Timer ID for visibility refresh interval
 * v1.6.3.8-v4 - FIX Issue #3: Periodic state freshness check when visible
 */
let visibilityRefreshIntervalId = null;

/**
 * Timestamp when last probe was started
 * v1.6.3.8-v4 - FIX Issue #8: Track for min interval enforcement
 */
let lastProbeStartTime = 0;

/**
 * Initialize the initialization barrier Promise
 * v1.6.3.8-v4 - FIX Issue #5: Create single barrier for ALL async init
 * @private
 */
function _initializeBarrier() {
  currentInitPhase = 'barrier-creating';
  initializationBarrier = new Promise((resolve, reject) => {
    _initBarrierResolve = resolve;
    _initBarrierReject = reject;
  });
  
  // Set timeout for barrier
  initBarrierTimeoutId = setTimeout(() => {
    _handleInitBarrierTimeout();
  }, INIT_BARRIER_TIMEOUT_MS);
  
  console.log('[Manager] INITIALIZATION_BARRIER: phase=created', {
    timeoutMs: INIT_BARRIER_TIMEOUT_MS,
    timestamp: Date.now()
  });
}

/**
 * Handle initialization barrier timeout
 * v1.6.3.8-v4 - FIX Issue #5: Clear error message on timeout
 * @private
 */
function _handleInitBarrierTimeout() {
  const elapsed = initializationStartTime > 0 ? Date.now() - initializationStartTime : 0;
  
  console.error('[Manager] INITIALIZATION_BARRIER: phase=TIMEOUT', {
    elapsedMs: elapsed,
    timeoutMs: INIT_BARRIER_TIMEOUT_MS,
    lastPhase: currentInitPhase,
    storageListenerVerified,
    connectionState,
    message: `Initialization did not complete within ${INIT_BARRIER_TIMEOUT_MS}ms - proceeding with partial state`,
    timestamp: Date.now()
  });
  
  // Resolve barrier anyway to unblock listeners (with warning logged)
  // This prevents permanent lockup while still flagging the issue
  if (_initBarrierResolve) {
    currentInitPhase = 'timeout-resolved';
    // v1.6.3.8-v4 - FIX: Resolve barrier BEFORE setting initializationComplete
    // to prevent race condition where code sees init as complete but barrier not resolved
    _initBarrierResolve();
    initializationComplete = true;
    _replayQueuedMessages();
  }
  
  initBarrierTimeoutId = null;
}

/**
 * Resolve the initialization barrier after successful init
 * v1.6.3.8-v4 - FIX Issue #5: Called when ALL async init is complete
 * @private
 */
function _resolveInitBarrier() {
  if (initBarrierTimeoutId) {
    clearTimeout(initBarrierTimeoutId);
    initBarrierTimeoutId = null;
  }
  
  const elapsed = initializationStartTime > 0 ? Date.now() - initializationStartTime : 0;
  
  currentInitPhase = 'complete';
  
  console.log('[Manager] INITIALIZATION_BARRIER: phase=resolved', {
    elapsedMs: elapsed,
    storageListenerVerified,
    connectionState,
    queuedMessagesCount: preInitMessageQueue.length,
    timestamp: Date.now()
  });
  
  // v1.6.3.8-v4 - FIX: Resolve barrier BEFORE setting initializationComplete
  // to prevent race condition where code sees init as complete but barrier not resolved
  if (_initBarrierResolve) {
    _initBarrierResolve();
  }
  
  initializationComplete = true;
  
  // Replay any queued messages
  _replayQueuedMessages();
}

/**
 * Queue a message received before initialization is complete
 * v1.6.3.8-v4 - FIX Issue #9: Enforcing guard that queues messages
 * @param {string} source - Message source (port, storage, bc)
 * @param {Object} message - Message to queue
 * @private
 */
function _queueMessageDuringInit(source, message) {
  preInitMessageQueue.push({
    source,
    message,
    timestamp: Date.now()
  });
  
  console.log('[Manager] INIT_MESSAGE_QUEUED:', {
    source,
    messageType: message?.type || message?.action || 'unknown',
    queueSize: preInitMessageQueue.length,
    initPhase: currentInitPhase,
    timestamp: Date.now()
  });
}

/**
 * Replay queued messages after initialization barrier resolves
 * v1.6.3.8-v4 - FIX Issue #9: Process queued messages in order
 * @private
 */
function _replayQueuedMessages() {
  if (preInitMessageQueue.length === 0) {
    console.log('[Manager] INIT_MESSAGE_REPLAY: no queued messages', {
      timestamp: Date.now()
    });
    return;
  }
  
  console.log('[Manager] INIT_MESSAGE_REPLAY: starting', {
    count: preInitMessageQueue.length,
    timestamp: Date.now()
  });
  
  const messages = [...preInitMessageQueue];
  preInitMessageQueue.length = 0; // Clear queue
  
  for (const item of messages) {
    _processQueuedInitMessage(item);
  }
  
  console.log('[Manager] INIT_MESSAGE_REPLAY: completed', {
    processedCount: messages.length,
    timestamp: Date.now()
  });
}

/**
 * Process a single queued init message with error handling
 * v1.6.3.8-v4 - FIX Issue #9: Extracted to reduce nesting depth
 * @param {Object} item - Queued message item with source, message, timestamp
 * @private
 */
function _processQueuedInitMessage(item) {
  console.log('[Manager] INIT_MESSAGE_REPLAY: processing', {
    source: item.source,
    messageType: item.message?.type || item.message?.action || 'unknown',
    queuedAt: item.timestamp,
    delayMs: Date.now() - item.timestamp
  });
  
  try {
    _routeInitMessage(item);
  } catch (err) {
    console.error('[Manager] INIT_MESSAGE_REPLAY: error processing message', {
      source: item.source,
      error: err.message,
      timestamp: Date.now()
    });
  }
}

/**
 * Route a queued init message based on source
 * v1.6.3.8-v4 - FIX Issue #9: Extracted to reduce nesting depth
 * @param {Object} item - Queued message item with source, message
 * @private
 */
function _routeInitMessage(item) {
  if (item.source === 'port') {
    handlePortMessage(item.message);
  } else if (item.source === 'storage') {
    _handleStorageChange(item.message);
  }
  // BC messages are demoted, so we skip them during replay
}

/**
 * Await initialization barrier before processing (for use in listeners)
 * v1.6.3.8-v4 - FIX Issue #5: Async guard that actually blocks
 * @returns {Promise<boolean>} True if barrier resolved, false if should skip
 * @private
 */
async function _awaitInitBarrier() {
  if (initializationComplete) {
    return true;
  }
  
  if (!initializationBarrier) {
    console.warn('[Manager] INIT_BARRIER_MISSING: barrier not created, allowing through', {
      timestamp: Date.now()
    });
    return true;
  }
  
  console.log('[Manager] INIT_BARRIER_WAITING: listener waiting for barrier', {
    currentPhase: currentInitPhase,
    timestamp: Date.now()
  });
  
  try {
    await initializationBarrier;
    return true;
  } catch (err) {
    console.error('[Manager] INIT_BARRIER_ERROR:', {
      error: err.message,
      timestamp: Date.now()
    });
    return false;
  }
}

// ==================== v1.6.3.7-v9 SEQUENCE ID EVENT ORDERING ====================
// FIX Issue #6: Validate storage event ordering using sequence IDs
/**
 * Last applied sequence ID to validate event ordering
 * v1.6.3.7-v9 - FIX Issue #6: Events with sequenceId <= lastAppliedSequenceId are rejected
 */
let lastAppliedSequenceId = 0;

// ==================== v1.6.3.8-v5 MONOTONIC REVISION VERSIONING ====================
// FIX Issue #1 (comprehensive-diagnostic-report.md): Storage Event Ordering
// IndexedDB delivers storage.onChanged events in arbitrary order. Revision numbers
// provide a definitive ordering mechanism - listeners reject updates with revision ≤ current.

/**
 * Last applied revision number
 * v1.6.3.8-v5 - FIX Issue #1: Monotonic revision counter for storage event ordering
 * All updates with revision ≤ _lastAppliedRevision are rejected as stale
 */
let _lastAppliedRevision = 0;

/**
 * Event buffer for out-of-order handling
 * v1.6.3.8-v5 - FIX Issue #1: Buffer events keyed by revision when they arrive out of order
 * Structure: Map<revision, { data, timestamp }>
 */
const _revisionEventBuffer = new Map();

/**
 * Maximum age for buffered events (5 seconds)
 * v1.6.3.8-v5 - FIX Issue #1: Events older than this are discarded
 */
const REVISION_BUFFER_MAX_AGE_MS = 5000;

/**
 * Maximum buffer size before cleanup
 * v1.6.3.8-v5 - FIX Issue #1: Prevent memory bloat from stuck events
 */
const REVISION_BUFFER_MAX_SIZE = 50;

/**
 * Interval for buffer cleanup (10 seconds)
 * v1.6.3.8-v5 - FIX Issue #1: Periodic cleanup of stale buffered events
 */
const REVISION_BUFFER_CLEANUP_INTERVAL_MS = 10000;

/**
 * Timer ID for revision buffer cleanup
 * v1.6.3.8-v5 - FIX Issue #1: Track cleanup interval
 */
let _revisionBufferCleanupTimerId = null;

/**
 * Watchdog timer ID for storage.onChanged verification
 * v1.6.3.7-v9 - FIX Issue #6: If no event within 2s of expected write, re-read storage
 */
let storageWatchdogTimerId = null;

/**
 * Watchdog timeout duration (ms)
 * v1.6.3.7-v9 - FIX Issue #6: 2 second timeout before explicit re-read
 */
const STORAGE_WATCHDOG_TIMEOUT_MS = 2000;

// ==================== v1.6.3.8-v3 STORAGE LISTENER VERIFICATION ====================
// FIX Issues #2, #5, #9, #15: Explicit storage.onChanged listener registration verification

/**
 * Test key for storage listener verification
 * v1.6.3.8-v3 - FIX Issue #5: Write-then-verify pattern
 */
const STORAGE_LISTENER_TEST_KEY = '__storage_listener_verification_test__';

/**
 * Timeout for storage listener verification (ms)
 * v1.6.3.8-v3 - FIX Issue #5: If callback doesn't fire within this time, listener failed
 */
const STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS = 1000;

/**
 * Flag indicating storage listener is verified working
 * v1.6.3.8-v3 - FIX Issue #5: If false, Tier 3 fallback should be disabled
 */
let storageListenerVerified = false;

/**
 * Timer ID for storage listener verification timeout
 * v1.6.3.8-v3 - FIX Issue #5: Track timeout for cleanup
 */
let storageListenerVerificationTimerId = null;

/**
 * Timestamp when storage listener verification started
 * v1.6.3.8-v3 - FIX Issue #5: Track latency of verification
 */
let storageListenerVerificationStartTime = 0;

/**
 * Promise resolver for storage listener verification barrier
 * v1.6.3.8-v3 - FIX Issue #9: Initialization barrier for listener registration
 */
let _storageListenerReadyResolve = null;

/**
 * Promise for awaiting storage listener verification
 * v1.6.3.8-v3 - FIX Issue #9: Barrier to ensure listener is working before main init
 */
let storageListenerReadyPromise = null;

/**
 * Reference to the storage.onChanged handler for verification
 * v1.6.3.8-v3 - FIX Issue #15: Store callback reference as named variable
 */
let _storageOnChangedHandler = null;

// Pending operations tracking (for spam-click prevention)
const PENDING_OPERATIONS = new Set();

// Error notification styles
const ERROR_NOTIFICATION_STYLES = {
  position: 'fixed',
  top: '10px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#d32f2f',
  color: 'white',
  padding: '8px 16px',
  borderRadius: '4px',
  zIndex: '10000',
  fontSize: '14px'
};

// Storage read debounce timer
let storageReadDebounceTimer = null;
let lastStorageReadTime = 0;

// v1.6.3.5-v2 - FIX Report 1 Issue #2: Track current tab ID for Quick Tab origin filtering
let currentBrowserTabId = null;

// v1.6.3.7-v1 - FIX ISSUE #1: Track tab switches for real-time filtering
let previousBrowserTabId = null;

// v1.6.3.4-v6 - FIX Issue #5: Track last rendered state hash to avoid unnecessary re-renders
let lastRenderedStateHash = 0;

// v1.6.3.5-v4 - FIX Diagnostic Issue #2: In-memory state cache to prevent list clearing during storage storms
// v1.6.3.5-v6 - ARCHITECTURE NOTE (Issue #6 - Manager as Pure Consumer):
//   This cache exists as a FALLBACK to protect against storage storms/corruption.
//   It is NOT a competing authority with background's state.
//   Normal operation: Manager receives state from storage.onChanged/messages
//   Recovery operation: Manager uses cache when storage returns suspicious 0-tab results
//   The cache should NEVER be used to overwrite background's authoritative state.
//   See v1.6.3.5-architectural-issues.md Architecture Issue #6 for context.
// v1.6.3.7-v4 - FIX Issue #6: Added sessionId and timestamp to prevent restoring ghost tabs
//   Cache now has structure: { tabs: [], timestamp: number, sessionId: string }
//   On fallback, we validate that cache is from current session
let inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
let lastKnownGoodTabCount = 0;
const MIN_TABS_FOR_CACHE_PROTECTION = 1; // Protect cache if we have at least 1 tab

// v1.6.3.7-v4 - FIX Issue #6: Session ID to identify current browser session
// This prevents restoring cache from a previous browser session
let currentSessionId = '';

/**
 * Generate a unique session ID for this browser session
 * v1.6.3.7-v4 - FIX Issue #6: Session validation for cache
 * @returns {string} Unique session identifier
 */
function _generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Initialize session ID on sidebar load
 * v1.6.3.7-v4 - FIX Issue #6: Must be called during DOMContentLoaded
 */
function _initializeSessionId() {
  currentSessionId = _generateSessionId();
  console.log('[Manager] v1.6.3.7-v5 Session initialized:', { sessionId: currentSessionId });
}

// ==================== v1.6.3.8-v3 STORAGE LISTENER INITIALIZATION ====================
// FIX Issues #2, #5, #9, #15: Explicit storage.onChanged listener registration and verification

/**
 * Initialize the storage listener verification promise barrier
 * v1.6.3.8-v3 - FIX Issue #9: Create promise for init barrier
 * @private
 */
function _initStorageListenerReadyPromise() {
  storageListenerReadyPromise = new Promise((resolve) => {
    _storageListenerReadyResolve = resolve;
  });
  console.log('[Manager] STORAGE_LISTENER_PROMISE_BARRIER_INITIALIZED:', {
    timestamp: Date.now()
  });
}

/**
 * Storage.onChanged handler callback (named for explicit reference)
 * v1.6.3.8-v3 - FIX Issue #15: Named callback instead of inline arrow function
 * v1.6.4.18 - Refactored to reduce complexity below 9
 * @private
 * @param {Object} changes - Storage changes object
 * @param {string} areaName - Storage area name
 */
function _handleStorageOnChanged(changes, areaName) {
  // v1.6.3.8-v3 - FIX Issue #5: Handle verification test key
  if (_handleVerificationTestKey(changes, areaName)) return;

  // v1.6.3.7-v9 - FIX Issue #11: Log listener entry with init status
  logListenerEntry('storage.onChanged', {
    areaName,
    hasStateKey: !!changes[STATE_KEY],
    hasHealthProbeKey: !!changes[STORAGE_HEALTH_PROBE_KEY]
  });

  // v1.6.3.7-v13 - Issue #6 (arch): Handle storage health probe response
  if (_handleHealthProbeKey(changes, areaName)) return;

  // v1.6.3.7-v9 - FIX Issue #11: Guard against processing before initialization
  // v1.6.3.8-v4 - FIX Issue #9: Pass change data for queueing (null if undefined)
  const stateChange = changes[STATE_KEY] || null;
  if (_guardBeforeInit(areaName, stateChange)) return;

  if (areaName !== 'local' || !changes[STATE_KEY]) return;
  _handleStorageChange(changes[STATE_KEY]);
}

/**
 * Handle verification test key if present
 * v1.6.4.18 - Extracted to reduce complexity
 * @private
 * @param {Object} changes - Storage changes object
 * @param {string} areaName - Storage area name
 * @returns {boolean} True if handled (caller should return)
 */
function _handleVerificationTestKey(changes, areaName) {
  if (areaName === 'local' && changes[STORAGE_LISTENER_TEST_KEY]) {
    _handleStorageListenerVerification(changes[STORAGE_LISTENER_TEST_KEY]);
    return true;
  }
  return false;
}

/**
 * Handle health probe key if present
 * v1.6.4.18 - Extracted to reduce complexity
 * @private
 * @param {Object} changes - Storage changes object
 * @param {string} areaName - Storage area name
 * @returns {boolean} True if handled (caller should return)
 */
function _handleHealthProbeKey(changes, areaName) {
  if (areaName === 'local' && changes[STORAGE_HEALTH_PROBE_KEY]) {
    const probeData = changes[STORAGE_HEALTH_PROBE_KEY].newValue;
    if (probeData?.timestamp) {
      _handleStorageProbeResponse(probeData.timestamp);
    }
    return true;
  }
  return false;
}

/**
 * Guard against processing before initialization - ENFORCING version
 * v1.6.4.18 - Extracted to reduce complexity
 * v1.6.3.8-v4 - FIX Issue #9: Made ENFORCING - queues messages instead of skipping
 * @private
 * @param {string} areaName - Storage area name for logging
 * @param {Object} [changeData] - Storage change data to queue if not initialized
 * @returns {boolean} True if should skip processing (caller should return)
 */
function _guardBeforeInit(areaName, changeData = null) {
  if (!isFullyInitialized()) {
    const timeSinceInitStartMs =
      initializationStartTime > 0 ? Date.now() - initializationStartTime : -1;
    
    // v1.6.3.8-v4 - FIX Issue #9: Queue the message for later processing instead of dropping
    if (changeData) {
      _queueMessageDuringInit('storage', changeData);
      console.log('[Manager] LISTENER_CALLED_BEFORE_INIT: storage.onChanged - QUEUED', {
        initializationStarted,
        initializationComplete,
        timeSinceInitStartMs,
        areaName,
        queueSize: preInitMessageQueue.length,
        message: 'Message queued - will be processed after init barrier resolves',
        timestamp: Date.now()
      });
    } else {
      console.warn('[Manager] LISTENER_CALLED_BEFORE_INIT: storage.onChanged - SKIP (no data)', {
        initializationStarted,
        initializationComplete,
        timeSinceInitStartMs,
        areaName,
        message: 'Skipping - no change data provided to queue',
        timestamp: Date.now()
      });
    }
    return true;
  }
  return false;
}

/**
 * Handle storage listener verification callback
 * v1.6.3.8-v3 - FIX Issue #5: Called when test key change is detected
 * @private
 * @param {Object} change - Storage change object for test key
 */
function _handleStorageListenerVerification(change) {
  const latencyMs = Date.now() - storageListenerVerificationStartTime;
  
  // Clear verification timeout
  if (storageListenerVerificationTimerId !== null) {
    clearTimeout(storageListenerVerificationTimerId);
    storageListenerVerificationTimerId = null;
  }
  
  // Mark listener as verified
  storageListenerVerified = true;
  
  console.log('[Manager] STORAGE_LISTENER_VERIFIED: success', {
    latencyMs,
    testValue: change.newValue,
    callbackReference: '_handleStorageOnChanged',
    timestamp: Date.now()
  });
  
  // Clean up the test key
  browser.storage.local.remove(STORAGE_LISTENER_TEST_KEY).catch(err => {
    console.warn('[Manager] Failed to clean up storage listener test key:', err.message);
  });
  
  // Resolve the verification promise barrier
  if (_storageListenerReadyResolve) {
    _storageListenerReadyResolve();
    console.log('[Manager] STORAGE_LISTENER_PROMISE_BARRIER_RESOLVED:', {
      latencyMs,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle storage listener verification timeout (listener did not fire)
 * v1.6.3.8-v3 - FIX Issue #5: Called when verification times out
 * v1.6.3.8-v4 - FIX Issue #4: Implement exponential backoff retry instead of permanent disable
 * @private
 */
function _handleStorageListenerVerificationTimeout() {
  const latencyMs = Date.now() - storageListenerVerificationStartTime;
  
  storageListenerVerificationTimerId = null;
  
  // v1.6.3.8-v4 - FIX Issue #4: Check if we should retry with exponential backoff
  if (storageVerificationRetryCount < STORAGE_VERIFICATION_RETRY_MS.length) {
    const retryDelay = STORAGE_VERIFICATION_RETRY_MS[storageVerificationRetryCount];
    storageVerificationRetryCount++;
    
    console.warn('[Manager] STORAGE_VERIFICATION: status=retry', {
      attempt: storageVerificationRetryCount,
      totalAttempts: STORAGE_VERIFICATION_RETRY_MS.length,
      latencyMs,
      retryDelayMs: retryDelay,
      message: `Verification timeout - retrying in ${retryDelay}ms`,
      timestamp: Date.now()
    });
    
    // Clean up the test key before retry
    browser.storage.local.remove(STORAGE_LISTENER_TEST_KEY).catch(() => {});
    
    // Schedule retry
    setTimeout(() => {
      _retryStorageListenerVerification();
    }, retryDelay);
    
    return; // Don't resolve barrier yet - wait for retry
  }
  
  // All retries exhausted - mark as unverified but don't permanently disable
  storageListenerVerified = false;
  
  console.error('[Manager] STORAGE_LISTENER_VERIFICATION_FAILED: all retries exhausted', {
    timeoutMs: STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS,
    latencyMs,
    retryAttempts: storageVerificationRetryCount,
    callbackReference: '_handleStorageOnChanged',
    tier3Status: 'unverified-but-available-on-demand',
    message: 'storage.onChanged listener verification failed - Tier 3 marked UNVERIFIED (will retry on port failure)',
    timestamp: Date.now()
  });
  
  // Clean up the test key anyway
  browser.storage.local.remove(STORAGE_LISTENER_TEST_KEY).catch(() => {});
  
  // Resolve the promise barrier (with failure state, but don't block init)
  if (_storageListenerReadyResolve) {
    _storageListenerReadyResolve();
    console.warn('[Manager] STORAGE_LISTENER_PROMISE_BARRIER_RESOLVED: with unverified status', {
      storageListenerVerified: false,
      retryCount: storageVerificationRetryCount,
      message: 'Tier 3 will be attempted on port failure despite unverified status',
      timestamp: Date.now()
    });
  }
}

/**
 * Retry storage listener verification with new test key
 * v1.6.3.8-v4 - FIX Issue #4: Exponential backoff retry
 * @private
 */
async function _retryStorageListenerVerification() {
  console.log('[Manager] STORAGE_VERIFICATION: status=retrying', {
    attempt: storageVerificationRetryCount,
    timestamp: Date.now()
  });
  
  try {
    // Start verification by writing test key
    storageListenerVerificationStartTime = Date.now();
    
    // Use dynamic timeout based on observed latency
    const dynamicTimeout = _calculateDynamicVerificationTimeout();
    
    // Set verification timeout
    storageListenerVerificationTimerId = setTimeout(
      _handleStorageListenerVerificationTimeout,
      dynamicTimeout
    );
    
    // Write test key to trigger storage.onChanged
    const testValue = `verify-retry-${storageVerificationRetryCount}-${Date.now()}`;
    
    console.log('[Manager] STORAGE_LISTENER_VERIFICATION_RETRY:', {
      testKey: STORAGE_LISTENER_TEST_KEY,
      testValue,
      timeoutMs: dynamicTimeout,
      attempt: storageVerificationRetryCount,
      timestamp: Date.now()
    });
    
    await browser.storage.local.set({ [STORAGE_LISTENER_TEST_KEY]: testValue });
    
  } catch (err) {
    console.error('[Manager] STORAGE_LISTENER_VERIFICATION_RETRY_FAILED:', {
      error: err.message,
      attempt: storageVerificationRetryCount,
      timestamp: Date.now()
    });
    
    // Continue to next retry or fail
    _handleStorageListenerVerificationTimeout();
  }
}

/**
 * Calculate dynamic verification timeout based on observed latencies
 * v1.6.3.8-v4 - FIX Issue #4: Use dynamic timeout based on actual latency
 * @returns {number} Timeout in milliseconds
 * @private
 */
function _calculateDynamicVerificationTimeout() {
  // If we have probe latency data, use it to set a more realistic timeout
  if (storageHealthStats.avgLatencyMs > 0) {
    // Use 2x the average latency as timeout, minimum 500ms, max 2000ms
    return Math.min(2000, Math.max(500, storageHealthStats.avgLatencyMs * 2));
  }
  // Default to base timeout
  return STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS;
}

/**
 * Attempt Tier 3 fallback even if originally unverified
 * v1.6.3.8-v4 - FIX Issue #4: If port fails, immediately attempt Tier 3
 * @private
 */
async function _attemptTier3FallbackOnPortFailure() {
  console.log('[Manager] TIER3_FALLBACK_ATTEMPT: port failure triggered Tier 3 attempt', {
    storageListenerVerified,
    timestamp: Date.now()
  });
  
  // If already verified, nothing special needed
  if (storageListenerVerified) {
    return;
  }
  
  // Try to verify now - port has failed so we need Tier 3
  storageVerificationRetryCount = 0; // Reset retry count for this attempt
  
  try {
    storageListenerVerificationStartTime = Date.now();
    
    const testValue = `fallback-verify-${Date.now()}`;
    await browser.storage.local.set({ [STORAGE_LISTENER_TEST_KEY]: testValue });
    
    // Wait briefly for verification
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('[Manager] TIER3_FALLBACK_VERIFICATION:', {
      verified: storageListenerVerified,
      message: storageListenerVerified 
        ? 'Tier 3 now verified and active'
        : 'Tier 3 still unverified but will be used as last resort',
      timestamp: Date.now()
    });
    
  } catch (err) {
    console.error('[Manager] TIER3_FALLBACK_VERIFICATION_FAILED:', {
      error: err.message,
      timestamp: Date.now()
    });
  }
}

/**
 * Initialize storage.onChanged listener with explicit verification
 * v1.6.3.8-v3 - FIX Issues #2, #5, #9, #15: Explicit registration with verification pattern
 * 
 * This function:
 * 1. Registers the storage.onChanged listener with try/catch
 * 2. Logs registration attempt and success/failure
 * 3. Writes a test key to storage
 * 4. Sets timeout expecting callback within 1000ms
 * 5. If callback fires, verifies listener works and resolves barrier
 * 6. If timeout occurs, logs error and disables Tier 3 fallback
 * 
 * @returns {Promise<void>} Resolves when verification completes (success or failure)
 */
async function _initializeStorageListener() {
  console.log('[Manager] STORAGE_LISTENER_INITIALIZATION: attempting registration', {
    callbackFunction: '_handleStorageOnChanged',
    timestamp: Date.now()
  });
  
  // Initialize the promise barrier
  _initStorageListenerReadyPromise();
  
  try {
    // Store callback reference as module-level named variable
    _storageOnChangedHandler = _handleStorageOnChanged;
    
    // Register the listener
    browser.storage.onChanged.addListener(_storageOnChangedHandler);
    
    console.log('[Manager] STORAGE_LISTENER_INITIALIZED: success', {
      callbackReference: '_handleStorageOnChanged',
      callbackStored: _storageOnChangedHandler !== null,
      timestamp: Date.now()
    });
    
    // Start verification by writing test key
    storageListenerVerificationStartTime = Date.now();
    
    // Set verification timeout
    storageListenerVerificationTimerId = setTimeout(
      _handleStorageListenerVerificationTimeout,
      STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS
    );
    
    // Write test key to trigger storage.onChanged
    const testValue = `verify-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    console.log('[Manager] STORAGE_LISTENER_VERIFICATION_STARTED:', {
      testKey: STORAGE_LISTENER_TEST_KEY,
      testValue,
      timeoutMs: STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS,
      timestamp: Date.now()
    });
    
    await browser.storage.local.set({ [STORAGE_LISTENER_TEST_KEY]: testValue });
    
  } catch (err) {
    console.error('[Manager] STORAGE_LISTENER_INITIALIZATION_FAILED: exception', {
      error: err.message,
      tier3Disabled: true,
      timestamp: Date.now()
    });
    
    storageListenerVerified = false;
    
    // Clear any pending timeout
    if (storageListenerVerificationTimerId !== null) {
      clearTimeout(storageListenerVerificationTimerId);
      storageListenerVerificationTimerId = null;
    }
    
    // Resolve barrier with failure
    if (_storageListenerReadyResolve) {
      _storageListenerReadyResolve();
    }
  }
  
  // Return the promise - caller can await verification completion
  return storageListenerReadyPromise;
}

/**
 * Check if storage listener is verified and Tier 3 fallback is enabled
 * v1.6.3.8-v3 - FIX Issue #5: Guard function for fallback decisions
 * @returns {boolean} True if storage listener is verified working
 */
function isStorageListenerVerified() {
  return storageListenerVerified;
}

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

// v1.6.3.5-v3 - FIX Architecture Phase 3: Track which tab hosts each Quick Tab
// Key: quickTabId, Value: { hostTabId, lastUpdate }
const quickTabHostInfo = new Map();

// v1.6.3.5-v7 - FIX Issue #7: Track when Manager's internal state was last updated (from any source)
let lastLocalUpdateTime = 0;

// Browser tab info cache
const browserTabInfoCache = new Map();

// ==================== v1.6.3.7-v3 DOM RECONCILIATION ====================
// FIX Issue #3: Track DOM elements for differential updates (prevents CSS animation flickering)

/**
 * Map of Quick Tab ID -> DOM element for reconciliation
 * v1.6.3.7-v3 - FIX Issue #3: Track individual Quick Tab items
 */
const _itemElements = new Map();

/**
 * Map of originTabId (group key) -> DOM details element for reconciliation
 * v1.6.3.7-v3 - FIX Issue #3: Track group containers
 */
const _groupElements = new Map();

/**
 * Last known groups container reference for reconciliation
 * v1.6.3.7-v3 - FIX Issue #3: Cache the container reference
 */
let _groupsContainer = null;

// ==================== v1.6.3.6-v11 PORT CONNECTION ====================
// FIX Issue #11: Persistent port connection to background script
// FIX Issue #10: Message acknowledgment tracking

/**
 * Port connection to background script
 * v1.6.3.6-v11 - FIX Issue #11: Persistent connection
 */
let backgroundPort = null;

/**
 * Reference to the port onMessage handler for explicit cleanup
 * v1.6.3.8-v3 - FIX Issue #11: Store handler reference for removeListener on reconnection
 * @private
 */
let _portOnMessageHandler = null;

/**
 * Last received sequence number from background for incoming message validation
 * v1.6.3.8-v3 - FIX Issue #10: Track incoming sequence for monotonic validation during queue flush
 * @private
 */
let _lastReceivedSequence = 0;

/**
 * Pending acknowledgments map
 * v1.6.3.6-v11 - FIX Issue #10: Track pending acknowledgments
 * Key: correlationId, Value: { resolve, reject, timeout, sentAt }
 */
const pendingAcks = new Map();

/**
 * Acknowledgment timeout (1 second)
 * v1.6.3.6-v11 - FIX Issue #10: Fallback timeout
 */
const ACK_TIMEOUT_MS = 1000;

// ==================== v1.6.3.6-v12 HEARTBEAT MECHANISM ====================
// FIX Issue #2, #4: Heartbeat to prevent Firefox 30s background script termination
// v1.6.3.7-v9 - Issue #1: Consolidated heartbeat (25s) and keepalive (20s) into unified 20s system

/**
 * Unified keepalive interval (20 seconds - same as background keepalive)
 * v1.6.3.7-v9 - Issue #1: Consolidated from separate 25s heartbeat and 20s keepalive
 * Firefox idle timeout is 30s, so 20s gives ~10s safety margin
 */
const UNIFIED_KEEPALIVE_INTERVAL_MS = 20000;

/**
 * Heartbeat interval - kept for backwards compatibility but now uses unified timing
 * v1.6.3.6-v12 - FIX Issue #2, #4: Keep background alive
 * v1.6.3.7-v9 - Issue #1: Now equals UNIFIED_KEEPALIVE_INTERVAL_MS
 */
const HEARTBEAT_INTERVAL_MS = UNIFIED_KEEPALIVE_INTERVAL_MS;

/**
 * Heartbeat timeout (5 seconds)
 * v1.6.3.6-v12 - FIX Issue #4: Detect unresponsive background
 */
const HEARTBEAT_TIMEOUT_MS = 5000;

/**
 * Heartbeat interval ID
 * v1.6.3.6-v12 - FIX Issue #4: Track interval for cleanup
 */
let heartbeatIntervalId = null;

/**
 * Last heartbeat response time
 * v1.6.3.6-v12 - FIX Issue #4: Track background responsiveness
 */
let lastHeartbeatResponse = Date.now();

/**
 * Consecutive heartbeat failures
 * v1.6.3.6-v12 - FIX Issue #4: Track for reconnection
 */
let consecutiveHeartbeatFailures = 0;
const MAX_HEARTBEAT_FAILURES = 2;

// ==================== v1.6.3.7-v9 UNIFIED KEEPALIVE STATE (Issue #1) ====================
// Consolidated keepalive system with correlation IDs and immediate fallback

/**
 * Counter for keepalive correlation IDs
 * v1.6.3.7-v9 - Issue #1: Track keepalive cycles for debugging
 */
let keepaliveCorrelationCounter = 0;

/**
 * Current keepalive cycle correlation ID
 * v1.6.3.7-v9 - Issue #1: Unique ID per keepalive round
 */
let currentKeepaliveCorrelationId = null;

/**
 * Timestamp when current keepalive cycle started
 * v1.6.3.7-v9 - Issue #1: Track round-trip time
 */
let currentKeepaliveStartTime = 0;

/**
 * Threshold for consecutive keepalive failures before ZOMBIE transition
 * v1.6.3.7-v9 - Issue #1: Use same threshold as HEARTBEAT_FAILURES_BEFORE_ZOMBIE
 */
const KEEPALIVE_FAILURES_BEFORE_ZOMBIE = 3;

/**
 * Counter for consecutive keepalive failures (unified tracking)
 * v1.6.3.7-v9 - Issue #1: Combined heartbeat + keepalive failure tracking
 */
let consecutiveKeepaliveFailures = 0;

// ==================== v1.6.3.7 CIRCUIT BREAKER STATE ====================
// FIX Issue #5: Port Reconnect Circuit Breaker to prevent thundering herd
/**
 * Circuit breaker state
 * v1.6.3.7 - FIX Issue #5: Prevent thundering herd on reconnect
 * v1.6.3.7-v4 - FIX Issue #8: Add probing for early recovery detection
 * States: 'closed' (connected), 'open' (not trying), 'half-open' (attempting)
 */
let circuitBreakerState = 'closed';
let circuitBreakerOpenTime = 0;
let reconnectAttempts = 0;
let reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
// v1.6.3.7-v4 - FIX Issue #8: Timer for early recovery probes
let circuitBreakerProbeTimerId = null;

// ==================== v1.6.3.7-v8 PORT MESSAGE QUEUE ====================
// FIX Issue #9: Buffer messages arriving before listener registration
/**
 * Queue for port messages that arrive before listener is fully registered
 * v1.6.3.7-v8 - FIX Issue #9: Prevent silent message drops on reconnection
 */
let portMessageQueue = [];

/**
 * Flag indicating if listener is fully registered (kept for backward compatibility)
 * v1.6.3.7-v8 - FIX Issue #9: Track listener registration state
 * @deprecated Use listenerReadyPromise instead for async operations
 */
let listenerFullyRegistered = false;

/**
 * Promise-based barrier for listener registration
 * v1.6.4.16 - FIX Issue #9: Replace boolean with Promise for reliable race prevention
 * Resolves when listener is fully registered and ready to process messages
 */
let listenerReadyPromise = null;
let _listenerReadyResolve = null;
let _listenerReadyReject = null;

/**
 * Initialize the listener ready promise
 * v1.6.4.16 - FIX Issue #9: Create new promise barrier
 * @private
 */
function _initListenerReadyPromise() {
  listenerReadyPromise = new Promise((resolve, reject) => {
    _listenerReadyResolve = resolve;
    _listenerReadyReject = reject;
  });
  console.log('[Manager] [PORT] [PROMISE_BARRIER_INITIALIZED]:', {
    timestamp: Date.now()
  });
}

/**
 * Mark listener as ready and resolve the promise barrier
 * v1.6.4.16 - FIX Issue #9: Signal listener is ready
 * @private
 */
function _markListenerReady() {
  listenerFullyRegistered = true; // Maintain backward compatibility
  if (_listenerReadyResolve) {
    _listenerReadyResolve();
    console.log('[Manager] [PORT] [PROMISE_BARRIER_RESOLVED]:', {
      timestamp: Date.now()
    });
  }
}

/**
 * Reset listener ready state (on disconnect)
 * v1.6.4.16 - FIX Issue #9: Reset for reconnection
 * @private
 */
function _resetListenerReadyState() {
  listenerFullyRegistered = false;
  _initListenerReadyPromise(); // Create new promise for next connection
}

// Initialize the promise barrier on module load
_initListenerReadyPromise();

// ==================== v1.6.3.7-v8 RECONNECTION GUARD ====================
// FIX Issue #10: Prevent concurrent reconnection attempts
/**
 * Atomic guard for reconnection - prevents multiple simultaneous attempts
 * v1.6.3.7-v8 - FIX Issue #10: Race condition prevention
 */
let isReconnecting = false;

// ==================== v1.6.3.7-v8 HEARTBEAT HYSTERESIS ====================
// FIX Issue #13: Require consecutive failures before ZOMBIE
/**
 * Number of consecutive heartbeat failures required before ZOMBIE transition
 * v1.6.3.7-v8 - FIX Issue #13: Hysteresis for heartbeat failure detection
 */
const HEARTBEAT_FAILURES_BEFORE_ZOMBIE = 3;

/**
 * Counter for consecutive heartbeat timeouts (separate from general failures)
 * v1.6.3.7-v8 - FIX Issue #13: Track timeout-specific failures for hysteresis
 */
let consecutiveHeartbeatTimeouts = 0;

// ==================== v1.6.3.7-v8 BACKGROUND ACTIVITY DETECTION ====================
// FIX Issue #14: Detect Firefox background script termination
/**
 * Interval for background activity check (10 seconds)
 * v1.6.3.7-v8 - FIX Issue #14: Detect idle background before Firefox terminates it
 */
const BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS = 10000;

/**
 * Warning threshold for stale background state (30 seconds)
 * v1.6.3.7-v8 - FIX Issue #14: Firefox terminates at 30s idle
 */
const BACKGROUND_STALE_WARNING_THRESHOLD_MS = 30000;

/**
 * Timestamp of last message received from background via port
 * v1.6.3.7-v8 - FIX Issue #14: Track background activity
 */
let lastBackgroundMessageTime = Date.now();

/**
 * Timer ID for background activity check
 * v1.6.3.7-v8 - FIX Issue #14: Periodic health check
 */
let backgroundActivityCheckTimerId = null;

// ==================== v1.6.3.7 RENDER DEBOUNCE STATE ====================
// FIX Issue #3: UI Flicker Prevention
let renderDebounceTimer = null;
let lastRenderedHash = 0;
let pendingRenderUI = false;

/**
 * Generate correlation ID for message acknowledgment
 * v1.6.3.6-v11 - FIX Issue #10: Correlation tracking
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Log port lifecycle event
 * v1.6.3.6-v11 - FIX Issue #12: Port lifecycle logging
 * @param {string} event - Event name
 * @param {Object} details - Event details
 */
function logPortLifecycle(event, details = {}) {
  console.log(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, {
    tabId: currentBrowserTabId,
    portId: backgroundPort?._portId,
    connectionState,
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Transition connection state with logging
 * v1.6.3.7-v5 - FIX Issue #1: Explicit state transitions
 * v1.6.3.7-v6 - Issue #3: Enhanced context logging with duration, reason, and failure count
 * @param {string} newState - New connection state
 * @param {string} reason - Reason for state change
 */
function _transitionConnectionState(newState, reason) {
  const oldState = connectionState;
  const now = Date.now();
  const durationInPreviousState =
    lastConnectionStateChange > 0 ? now - lastConnectionStateChange : 0;

  connectionState = newState;
  lastConnectionStateChange = now;

  _updateConsecutiveFailures(newState);
  _logConnectionStateTransition({
    oldState,
    newState,
    reason,
    duration: durationInPreviousState,
    timestamp: now
  });
  _logFallbackModeIfNeeded(newState);
}

/**
 * Update consecutive failure counter based on state
 * v1.6.3.7-v6 - Extracted to reduce _transitionConnectionState complexity
 * @private
 * @param {string} newState - New connection state
 */
function _updateConsecutiveFailures(newState) {
  if (newState === CONNECTION_STATE.DISCONNECTED || newState === CONNECTION_STATE.ZOMBIE) {
    consecutiveConnectionFailures++;
  } else if (newState === CONNECTION_STATE.CONNECTED) {
    consecutiveConnectionFailures = 0;
  }
}

/**
 * Log connection state transition with context
 * v1.6.3.7-v6 - Extracted to reduce _transitionConnectionState complexity
 * v1.6.4.17 - Refactored to use options object (5 args → 1)
 * @private
 * @param {Object} options - Transition options
 * @param {string} options.oldState - Previous connection state
 * @param {string} options.newState - New connection state
 * @param {string} options.reason - Reason for transition
 * @param {number} options.duration - Duration in previous state (ms)
 * @param {number} options.timestamp - Current timestamp
 */
function _logConnectionStateTransition({ oldState, newState, reason, duration, timestamp }) {
  const isFallbackMode =
    newState === CONNECTION_STATE.ZOMBIE || newState === CONNECTION_STATE.DISCONNECTED;
  console.log('[Manager] CONNECTION_STATE_TRANSITION:', {
    previousState: oldState,
    newState,
    reason,
    durationInPreviousStateMs: duration,
    consecutiveFailures: consecutiveConnectionFailures,
    fallbackModeActive: isFallbackMode,
    broadcastChannelAvailable: isFallbackMode ? _isChannelAvailable() : null,
    timestamp
  });
}

/**
 * Log fallback mode activation if entering zombie or disconnected state
 * v1.6.3.7-v6 - Extracted to reduce _transitionConnectionState complexity
 * @private
 * @param {string} newState - New connection state
 */
function _logFallbackModeIfNeeded(newState) {
  if (newState === CONNECTION_STATE.ZOMBIE) {
    _logZombieFallback();
  } else if (newState === CONNECTION_STATE.DISCONNECTED) {
    _logDisconnectedFallback();
  }
}

/**
 * Log zombie state fallback
 * @private
 */
function _logZombieFallback() {
  console.log('[Manager] ZOMBIE_STATE_ENTERED: Switching to BroadcastChannel fallback immediately');
  if (_isChannelAvailable()) {
    console.log(
      '[Manager] FALLBACK_CHANNEL_ACTIVATED: BroadcastChannel is ACTIVE - will receive updates via broadcast'
    );
  } else {
    console.warn(
      '[Manager] FALLBACK_CHANNEL_UNAVAILABLE: BroadcastChannel NOT available - relying on storage polling only'
    );
  }
}

/**
 * Log disconnected state fallback
 * @private
 */
function _logDisconnectedFallback() {
  console.log(
    '[Manager] FALLBACK_MODE_ACTIVE: Port disconnected, using BroadcastChannel + storage polling',
    {
      broadcastAvailable: _isChannelAvailable(),
      storagePollingMs: 10000
    }
  );
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 * v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat on connect
 * v1.6.3.7 - FIX Issue #5: Implement circuit breaker with exponential backoff
 * v1.6.3.7-v5 - FIX Issue #1: Update connection state on connect
 * v1.6.3.7-v8 - FIX Issue #9: Port message queue for buffering pre-listener messages
 * v1.6.3.7-v8 - FIX Issue #10: Atomic reconnection guard with isReconnecting flag
 * v1.6.3.8-v3 - Refactored to extract helpers for max-lines-per-function compliance
 */
function connectToBackground() {
  if (!_canAttemptConnection()) return;

  _prepareForReconnection();
  _cleanupOldPortListener();

  try {
    _establishPortConnection();
    _setupPortListeners();
    _finalizeConnection();
    console.log('[Manager] v1.6.3.8-v3 Port connection established');
  } catch (err) {
    _handlePortConnectionError(err);
  } finally {
    isReconnecting = false;
  }
}

/**
 * Check if connection attempt is allowed (not already reconnecting, circuit breaker)
 * v1.6.3.8-v3 - Extracted from connectToBackground
 * @private
 * @returns {boolean} True if connection can be attempted
 */
function _canAttemptConnection() {
  if (isReconnecting) {
    console.log('[Manager] [PORT] [RECONNECT_BLOCKED]:', {
      reason: 'already_in_progress',
      timestamp: Date.now()
    });
    return false;
  }

  if (circuitBreakerState === 'open') {
    const timeSinceOpen = Date.now() - circuitBreakerOpenTime;
    if (timeSinceOpen < CIRCUIT_BREAKER_OPEN_DURATION_MS) {
      console.log('[Manager] Circuit breaker OPEN - skipping reconnect', {
        timeRemainingMs: CIRCUIT_BREAKER_OPEN_DURATION_MS - timeSinceOpen
      });
      return false;
    }
    circuitBreakerState = 'half-open';
    console.log('[Manager] Circuit breaker HALF-OPEN - attempting reconnect');
  }

  return true;
}

/**
 * Prepare state for reconnection
 * v1.6.3.8-v3 - Extracted from connectToBackground
 * @private
 */
function _prepareForReconnection() {
  isReconnecting = true;
  listenerFullyRegistered = false;
  portMessageQueue = [];
  _lastReceivedSequence = 0;
}

/**
 * Establish the port connection to background
 * v1.6.3.8-v3 - Extracted from connectToBackground
 * @private
 */
function _establishPortConnection() {
  backgroundPort = browser.runtime.connect({ name: 'quicktabs-sidebar' });
  logPortLifecycle('open', { portName: backgroundPort.name });
}

/**
 * Set up port message and disconnect listeners
 * v1.6.3.8-v3 - Extracted from connectToBackground
 * @private
 */
function _setupPortListeners() {
  _portOnMessageHandler = _handlePortMessageWithQueue;
  backgroundPort.onMessage.addListener(_portOnMessageHandler);
  console.log('[Manager] [PORT] [LISTENER_REGISTERED]:', {
    type: 'onMessage',
    handlerStored: true,
    timestamp: Date.now()
  });

  backgroundPort.onDisconnect.addListener(_handlePortDisconnect);
  console.log('[Manager] [PORT] [LISTENER_REGISTERED]:', {
    type: 'onDisconnect',
    timestamp: Date.now()
  });
}

/**
 * Handle port disconnect event
 * v1.6.3.8-v3 - Extracted from connectToBackground inline handler
 * @private
 */
function _handlePortDisconnect() {
  const error = browser.runtime.lastError;
  logPortLifecycle('disconnect', { error: error?.message });
  _cleanupOldPortListener();
  backgroundPort = null;
  _resetListenerReadyState();
  _transitionConnectionState(CONNECTION_STATE.DISCONNECTED, 'port-disconnected');
  stopHeartbeat();
  _stopBackgroundActivityCheck();
  _stopCircuitBreakerProbes();
  scheduleReconnect();
}

/**
 * Finalize successful connection (reset circuit breaker, start heartbeat)
 * v1.6.3.8-v3 - Extracted from connectToBackground
 * @private
 */
function _finalizeConnection() {
  _markListenerReady();
  _flushPortMessageQueue();
  circuitBreakerState = 'closed';
  reconnectAttempts = 0;
  reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
  _transitionConnectionState(CONNECTION_STATE.CONNECTED, 'port-connected');
  startHeartbeat();
  _startBackgroundActivityCheck();
  _requestFullStateSync();
  _verifyPortListenerRegistration();
}

/**
 * Handle port connection error
 * v1.6.3.8-v3 - Extracted from connectToBackground
 * @private
 * @param {Error} err - Connection error
 */
function _handlePortConnectionError(err) {
  console.error('[Manager] Failed to connect to background:', err.message);
  logPortLifecycle('error', { error: err.message });
  _transitionConnectionState(CONNECTION_STATE.DISCONNECTED, 'connection-error');
  handleConnectionFailure();
}

/**
 * Verify port listener registration by sending a test message
 * v1.6.3.7-v4 - FIX Issue #10: Confirm listener is actually receiving messages
 * @private
 */
function _verifyPortListenerRegistration() {
  if (!backgroundPort) return;

  try {
    // Send a ping message that should get an acknowledgment
    backgroundPort.postMessage({
      type: 'LISTENER_VERIFICATION',
      timestamp: Date.now(),
      source: 'sidebar'
    });
    console.log('[Manager] LISTENER_VERIFICATION: Test message sent to verify port listener');
  } catch (err) {
    console.error(
      '[Manager] LISTENER_VERIFICATION_FAILED: Could not send test message:',
      err.message
    );
  }
}

/**
 * Clean up old port onMessage listener before reconnection
 * v1.6.3.8-v3 - FIX Issue #11: Prevent dual message processing from old + new listeners
 * @private
 */
function _cleanupOldPortListener() {
  if (_portOnMessageHandler && backgroundPort) {
    try {
      backgroundPort.onMessage.removeListener(_portOnMessageHandler);
      console.log('[Manager] [PORT] [OLD_LISTENER_REMOVED]:', {
        reason: 'reconnection-cleanup',
        timestamp: Date.now()
      });
    } catch (err) {
      // Port may already be disconnected, which is fine
      console.log('[Manager] [PORT] [OLD_LISTENER_REMOVAL_SKIPPED]:', {
        reason: err.message,
        timestamp: Date.now()
      });
    }
  }
  _portOnMessageHandler = null;
}

/**
 * Schedule reconnection with exponential backoff
 * v1.6.3.7 - FIX Issue #5: Exponential backoff for port reconnection
 */
function scheduleReconnect() {
  reconnectAttempts++;

  console.log('[Manager] RECONNECT_SCHEDULED:', {
    attempt: reconnectAttempts,
    backoffMs: reconnectBackoffMs,
    circuitBreakerState,
    maxFailures: CIRCUIT_BREAKER_FAILURE_THRESHOLD
  });

  // Check if we should trip the circuit breaker
  if (reconnectAttempts >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    tripCircuitBreaker();
    return;
  }

  // Schedule reconnect with current backoff
  setTimeout(() => {
    console.log('[Manager] Attempting reconnect (attempt', reconnectAttempts, ')');
    connectToBackground();
  }, reconnectBackoffMs);

  // Calculate next backoff with exponential increase, capped at max
  reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, RECONNECT_BACKOFF_MAX_MS);
}

/**
 * Handle connection failure
 * v1.6.3.7 - FIX Issue #5: Track failures for circuit breaker
 */
function handleConnectionFailure() {
  // Note: scheduleReconnect() handles the increment, so we don't double-count here
  if (reconnectAttempts >= CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1) {
    // One more failure will trip the breaker, call scheduleReconnect to handle it
    scheduleReconnect();
  } else {
    scheduleReconnect();
  }
}

/**
 * Trip the circuit breaker to "open" state
 * v1.6.3.7 - FIX Issue #5: Stop reconnection attempts for cooldown period
 * v1.6.3.7-v4 - FIX Issue #8: Add early recovery probes during open period
 */
function tripCircuitBreaker() {
  circuitBreakerState = 'open';
  circuitBreakerOpenTime = Date.now();

  console.warn('[Manager] CIRCUIT_BREAKER_TRIPPED:', {
    attempts: reconnectAttempts,
    cooldownMs: CIRCUIT_BREAKER_OPEN_DURATION_MS,
    probeIntervalMs: CIRCUIT_BREAKER_PROBE_INTERVAL_MS,
    reopenAt: new Date(circuitBreakerOpenTime + CIRCUIT_BREAKER_OPEN_DURATION_MS).toISOString()
  });

  // v1.6.3.7-v4 - FIX Issue #8: Start probing for early recovery
  _startCircuitBreakerProbes();

  // Schedule hard reopen at max cooldown time
  setTimeout(() => {
    _stopCircuitBreakerProbes();
    console.log('[Manager] Circuit breaker cooldown expired - transitioning to HALF-OPEN');
    circuitBreakerState = 'half-open';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
    connectToBackground();
  }, CIRCUIT_BREAKER_OPEN_DURATION_MS);
}

/**
 * Start periodic probes during circuit breaker open period
 * v1.6.3.7-v4 - FIX Issue #8: Detect early background recovery
 * @private
 */
function _startCircuitBreakerProbes() {
  _stopCircuitBreakerProbes(); // Clear any existing probe timer

  circuitBreakerProbeTimerId = setInterval(() => {
    if (circuitBreakerState !== 'open') {
      _stopCircuitBreakerProbes();
      return;
    }

    const timeSinceOpen = Date.now() - circuitBreakerOpenTime;
    console.log('[Manager] CIRCUIT_BREAKER_PROBE:', {
      state: circuitBreakerState,
      timeSinceOpenMs: timeSinceOpen,
      timeRemainingMs: CIRCUIT_BREAKER_OPEN_DURATION_MS - timeSinceOpen
    });

    // Attempt a lightweight probe to detect if background recovered
    _probeBackgroundHealth()
      .then(healthy => {
        if (healthy && circuitBreakerState === 'open') {
          console.log(
            '[Manager] CIRCUIT_BREAKER_EARLY_RECOVERY: Background responding - transitioning to HALF-OPEN'
          );
          _stopCircuitBreakerProbes();
          circuitBreakerState = 'half-open';
          reconnectAttempts = 0;
          reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
          connectToBackground();
        }
      })
      .catch(() => {
        // Probe failed, continue waiting
        console.log('[Manager] CIRCUIT_BREAKER_PROBE_FAILED: Background still unresponsive');
      });
  }, CIRCUIT_BREAKER_PROBE_INTERVAL_MS);
}

/**
 * Stop circuit breaker probes
 * v1.6.3.7-v4 - FIX Issue #8: Cleanup probe timer
 * @private
 */
function _stopCircuitBreakerProbes() {
  if (circuitBreakerProbeTimerId) {
    clearInterval(circuitBreakerProbeTimerId);
    circuitBreakerProbeTimerId = null;
  }
}

/**
 * Probe background health with a lightweight ping
 * v1.6.3.7-v4 - FIX Issue #8: Quick check if background is responsive
 * @private
 * @returns {Promise<boolean>} True if background is healthy
 */
async function _probeBackgroundHealth() {
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage({ type: 'HEALTH_PROBE', timestamp: Date.now() }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
    ]);
    return response?.healthy === true || response?.type === 'HEALTH_ACK';
  } catch {
    return false;
  }
}

// ==================== v1.6.3.7-v8 PORT MESSAGE QUEUE ====================
// FIX Issue #9: Buffer messages arriving before listener registration

/**
 * Handle port message with queue support
 * v1.6.3.7-v8 - FIX Issue #9: Buffer messages if listener not fully registered
 * v1.6.4.16 - FIX Issue #9: Use Promise barrier for reliable race prevention
 * v1.6.3.8-v3 - FIX Issue #10: Track incoming sequence numbers for validation
 * @private
 * @param {Object} message - Message from background
 */
function _handlePortMessageWithQueue(message) {
  // v1.6.3.7-v8 - FIX Issue #14: Update last background message time
  lastBackgroundMessageTime = Date.now();

  // v1.6.3.8-v3 - FIX Issue #10: Track incoming sequence number for validation
  const incomingSequence = message?.messageSequence;
  if (typeof incomingSequence === 'number') {
    message._receivedAt = Date.now();
    message._previousSequence = _lastReceivedSequence;
  }

  // v1.6.4.16 - FIX Issue #9: Use boolean for sync check (Promise for async operations)
  if (!listenerFullyRegistered) {
    portMessageQueue.push(message);
    console.log('[Manager] [PORT] [MESSAGE_QUEUED]:', {
      type: message?.type || message?.action || 'unknown',
      queueSize: portMessageQueue.length,
      listenerReady: listenerFullyRegistered,
      incomingSequence,
      timestamp: Date.now()
    });
    return;
  }

  // v1.6.3.8-v3 - FIX Issue #10: Update sequence after queue check
  if (typeof incomingSequence === 'number') {
    _lastReceivedSequence = incomingSequence;
  }

  // Process message normally
  handlePortMessage(message);
}

/**
 * Wait for listener to be ready before processing
 * v1.6.4.16 - FIX Issue #9: Async barrier for operations that need listener ready
 * @param {number} [timeoutMs=5000] - Timeout in milliseconds
 * @returns {Promise<void>} Resolves when listener is ready
 */
async function waitForListenerReady(timeoutMs = 5000) {
  if (listenerFullyRegistered) return;

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Listener ready timeout')), timeoutMs);
  });

  try {
    await Promise.race([listenerReadyPromise, timeoutPromise]);
    console.log('[Manager] [PORT] [LISTENER_READY_WAIT_RESOLVED]:', {
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Manager] [PORT] [LISTENER_READY_TIMEOUT]:', {
      timeoutMs,
      error: err.message,
      timestamp: Date.now()
    });
    throw err;
  }
}

/**
 * Flush queued port messages after listener is fully registered
 * v1.6.3.7-v8 - FIX Issue #9: Process buffered messages
 * v1.6.3.8-v3 - FIX Issue #16: Check connection state before flushing
 * v1.6.3.8-v3 - FIX Issue #10: Validate sequence ordering during flush
 * @private
 */
function _flushPortMessageQueue() {
  if (portMessageQueue.length === 0) {
    console.log('[Manager] [PORT] [QUEUE_FLUSH]: No messages to flush');
    return;
  }

  // v1.6.3.8-v3 - FIX Issue #16: Check connection state before processing
  if (connectionState === CONNECTION_STATE.DISCONNECTED) {
    console.warn('[Manager] [PORT] [QUEUE_FLUSH_BLOCKED]:', {
      reason: 'port-disconnected',
      connectionState,
      queueSize: portMessageQueue.length,
      warning: 'Queue will be preserved for reconnection',
      timestamp: Date.now()
    });
    return;
  }

  const messagesToProcess = _extractQueuedMessages();

  // v1.6.3.8-v3 - FIX Issue #10: Validate and potentially reorder messages by sequence
  const validatedMessages = _validateAndSortQueuedMessages(messagesToProcess);

  _processQueuedMessages(validatedMessages);
}

/**
 * Extract and clear queued messages
 * v1.6.4.17 - Extracted to reduce _flushPortMessageQueue CC
 * @private
 * @returns {Array} Messages to process
 */
function _extractQueuedMessages() {
  console.log('[Manager] [PORT] [QUEUE_FLUSH_STARTED]:', {
    messageCount: portMessageQueue.length,
    timestamp: Date.now()
  });

  const messages = [...portMessageQueue];
  portMessageQueue = [];
  return messages;
}

/**
 * Validate and sort queued messages by sequence number
 * v1.6.3.8-v3 - FIX Issue #10: Ensure monotonically increasing sequence during flush
 * @private
 * @param {Array} messages - Messages to validate
 * @returns {Array} Validated and sorted messages
 */
function _validateAndSortQueuedMessages(messages) {
  const { sequencedMessages, unsequencedMessages } = _partitionMessagesBySequence(messages);

  // Sort sequenced messages by sequence number
  sequencedMessages.sort((a, b) => a.messageSequence - b.messageSequence);

  // Validate sequence ordering and log any issues
  const validationResult = _validateSequenceOrdering(sequencedMessages);

  // Update last received sequence to highest in queue
  _updateLastReceivedSequence(sequencedMessages);

  // Log validation summary if issues detected
  _logValidationSummaryIfNeeded(messages, sequencedMessages, unsequencedMessages, validationResult);

  // Return sorted sequenced messages first, then unsequenced
  return [...sequencedMessages, ...unsequencedMessages];
}

/**
 * Partition messages into sequenced and unsequenced groups
 * v1.6.3.8-v3 - Extracted to reduce _validateAndSortQueuedMessages CC
 * @private
 * @param {Array} messages - Messages to partition
 * @returns {Object} Object with sequencedMessages and unsequencedMessages arrays
 */
function _partitionMessagesBySequence(messages) {
  const sequencedMessages = [];
  const unsequencedMessages = [];

  for (const msg of messages) {
    if (typeof msg?.messageSequence === 'number') {
      sequencedMessages.push(msg);
    } else {
      unsequencedMessages.push(msg);
    }
  }

  return { sequencedMessages, unsequencedMessages };
}

/**
 * Validate sequence ordering and log reordering/gaps
 * v1.6.3.8-v3 - Extracted to reduce _validateAndSortQueuedMessages CC
 * @private
 * @param {Array} sequencedMessages - Sorted sequenced messages
 * @returns {Object} Validation result with reorderDetected and gapsDetected
 */
function _validateSequenceOrdering(sequencedMessages) {
  let lastSeq = _lastReceivedSequence;
  let reorderDetected = false;
  let gapsDetected = 0;

  for (const msg of sequencedMessages) {
    const seq = msg.messageSequence;
    const result = _checkSequenceIssue(seq, lastSeq, msg);
    if (result.reorder) reorderDetected = true;
    if (result.gap) gapsDetected++;
    lastSeq = seq;
  }

  return { reorderDetected, gapsDetected };
}

/**
 * Check for sequence issue (reorder or gap) and log if found
 * v1.6.3.8-v3 - Extracted to reduce _validateSequenceOrdering CC
 * @private
 * @param {number} seq - Current sequence number
 * @param {number} lastSeq - Previous sequence number
 * @param {Object} msg - Message object
 * @returns {Object} Result with reorder and gap flags
 */
function _checkSequenceIssue(seq, lastSeq, msg) {
  const messageType = msg.type || msg.action || 'unknown';

  if (seq < lastSeq) {
    console.warn('[Manager] [PORT] [QUEUE_SEQUENCE_REORDER]:', {
      expectedMinSequence: lastSeq,
      receivedSequence: seq,
      messageType,
      timestamp: Date.now()
    });
    return { reorder: true, gap: false };
  }

  if (seq > lastSeq + 1) {
    console.warn('[Manager] [PORT] [QUEUE_SEQUENCE_GAP]:', {
      expectedSequence: lastSeq + 1,
      receivedSequence: seq,
      gapSize: seq - lastSeq - 1,
      messageType,
      timestamp: Date.now()
    });
    return { reorder: false, gap: true };
  }

  return { reorder: false, gap: false };
}

/**
 * Update last received sequence from sequenced messages
 * v1.6.3.8-v3 - Extracted to reduce _validateAndSortQueuedMessages CC
 * @private
 * @param {Array} sequencedMessages - Sorted sequenced messages
 */
function _updateLastReceivedSequence(sequencedMessages) {
  if (sequencedMessages.length > 0) {
    _lastReceivedSequence = sequencedMessages[sequencedMessages.length - 1].messageSequence;
  }
}

/**
 * Log validation summary if issues were detected
 * v1.6.3.8-v3 - Extracted to reduce _validateAndSortQueuedMessages CC
 * @private
 */
function _logValidationSummaryIfNeeded(messages, sequencedMessages, unsequencedMessages, result) {
  if (!result.reorderDetected && result.gapsDetected === 0) return;

  console.log('[Manager] [PORT] [QUEUE_VALIDATION_SUMMARY]:', {
    totalMessages: messages.length,
    sequencedCount: sequencedMessages.length,
    unsequencedCount: unsequencedMessages.length,
    reorderDetected: result.reorderDetected,
    gapsDetected: result.gapsDetected,
    finalSequence: _lastReceivedSequence,
    timestamp: Date.now()
  });
}

/**
 * Process a batch of queued messages
 * v1.6.4.17 - Extracted to reduce _flushPortMessageQueue CC
 * @private
 * @param {Array} messages - Messages to process
 */
function _processQueuedMessages(messages) {
  for (const message of messages) {
    _processQueuedMessage(message);
  }

  console.log('[Manager] [PORT] [QUEUE_FLUSH_COMPLETED]:', {
    processedCount: messages.length,
    timestamp: Date.now()
  });
}

/**
 * Process a single queued message with error handling
 * v1.6.4.17 - Extracted to reduce _flushPortMessageQueue CC
 * v1.6.4.17 - Refactored to reduce CC from 10 to ~3
 * @private
 * @param {Object} message - Message to process
 */
function _processQueuedMessage(message) {
  const messageType = _getMessageType(message);
  try {
    _logQueuedMessageProcessing(messageType);
    handlePortMessage(message);
  } catch (err) {
    _logQueuedMessageError(messageType, err);
  }
}

/**
 * Get message type for logging
 * v1.6.4.17 - Extracted from _processQueuedMessage
 * @private
 * @param {Object} message - Message object
 * @returns {string} Message type
 */
function _getMessageType(message) {
  if (!message) return 'unknown';
  return message.type || message.action || 'unknown';
}

/**
 * Log queued message processing start
 * v1.6.4.17 - Extracted from _processQueuedMessage
 * @private
 * @param {string} messageType - Message type
 */
function _logQueuedMessageProcessing(messageType) {
  console.log('[Manager] [PORT] [QUEUE_MESSAGE_PROCESSING]:', {
    type: messageType,
    timestamp: Date.now()
  });
}

/**
 * Log queued message error
 * v1.6.4.17 - Extracted from _processQueuedMessage
 * @private
 * @param {string} messageType - Message type
 * @param {Error} err - Error object
 */
function _logQueuedMessageError(messageType, err) {
  console.error('[Manager] [PORT] [QUEUE_MESSAGE_ERROR]:', {
    type: messageType,
    error: err.message,
    timestamp: Date.now()
  });
}

// ==================== v1.6.3.7-v8 BACKGROUND ACTIVITY DETECTION ====================
// FIX Issue #14: Detect Firefox background script termination

/**
 * Start background activity monitoring
 * v1.6.3.7-v8 - FIX Issue #14: Periodic check to detect idle background
 * @private
 */
function _startBackgroundActivityCheck() {
  _stopBackgroundActivityCheck(); // Clear any existing check

  lastBackgroundMessageTime = Date.now();

  backgroundActivityCheckTimerId = setInterval(() => {
    _checkBackgroundActivity();
  }, BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS);

  console.log('[Manager] [HEALTH_CHECK] Background activity monitoring started', {
    checkIntervalMs: BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS,
    staleThresholdMs: BACKGROUND_STALE_WARNING_THRESHOLD_MS
  });
}

/**
 * Stop background activity monitoring
 * v1.6.3.7-v8 - FIX Issue #14: Cleanup timer
 * @private
 */
function _stopBackgroundActivityCheck() {
  if (backgroundActivityCheckTimerId) {
    clearInterval(backgroundActivityCheckTimerId);
    backgroundActivityCheckTimerId = null;
    console.log('[Manager] [HEALTH_CHECK] Background activity monitoring stopped');
  }
}

/**
 * Check if background is still active and responsive
 * v1.6.3.7-v8 - FIX Issue #14: Detect Firefox 30s termination
 * @private
 */
async function _checkBackgroundActivity() {
  const now = Date.now();
  const timeSinceLastMessage = now - lastBackgroundMessageTime;

  // Check if background might be stale (approaching Firefox 30s termination)
  if (timeSinceLastMessage >= BACKGROUND_STALE_WARNING_THRESHOLD_MS) {
    console.warn('[Manager] [WARNING] [BACKGROUND_POSSIBLY_DEAD]:', {
      timeSinceLastMessageMs: timeSinceLastMessage,
      thresholdMs: BACKGROUND_STALE_WARNING_THRESHOLD_MS,
      lastMessageTime: new Date(lastBackgroundMessageTime).toISOString(),
      timestamp: now
    });
  }

  // If no messages for 10 seconds, send a ping to keep background alive
  if (timeSinceLastMessage >= BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS) {
    await _sendBackgroundHealthPing(timeSinceLastMessage);
  }
}

/**
 * Send health ping to background and handle response
 * v1.6.3.7-v8 - FIX Issue #14: Extracted to reduce _checkBackgroundActivity depth
 * @private
 * @param {number} timeSinceLastMessage - Time since last background message
 */
async function _sendBackgroundHealthPing(timeSinceLastMessage) {
  console.log('[Manager] [HEALTH_CHECK] [PING_SENT]:', {
    reason: 'no_messages_received',
    timeSinceLastMessageMs: timeSinceLastMessage,
    timestamp: Date.now()
  });

  try {
    const healthy = await _probeBackgroundHealth();
    _handleHealthPingResult(healthy, timeSinceLastMessage);
  } catch (err) {
    console.error('[Manager] [HEALTH_CHECK] [PING_FAILED]:', {
      error: err.message,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle the result of a background health ping
 * v1.6.3.7-v8 - FIX Issue #14: Extracted to reduce nesting depth
 * @private
 * @param {boolean} healthy - Whether background responded successfully
 * @param {number} timeSinceLastMessage - Time since last background message
 */
function _handleHealthPingResult(healthy, timeSinceLastMessage) {
  if (healthy) {
    // Update last message time since background responded
    lastBackgroundMessageTime = Date.now();
    console.log('[Manager] [HEALTH_CHECK] [PING_SUCCESS]:', {
      backgroundResponsive: true,
      timestamp: Date.now()
    });
    return;
  }

  console.warn('[Manager] [HEALTH_CHECK] [BACKGROUND_UNRESPONSIVE]:', {
    timeSinceLastMessageMs: timeSinceLastMessage,
    connectionState,
    timestamp: Date.now()
  });

  // If background is unresponsive and we're in CONNECTED state, transition to ZOMBIE
  if (connectionState === CONNECTION_STATE.CONNECTED) {
    _transitionConnectionState(CONNECTION_STATE.ZOMBIE, 'health-check-unresponsive');
  }
}

// ==================== v1.6.3.6-v12 HEARTBEAT FUNCTIONS ====================

/**
 * Start heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #2, #4: Keep background alive
 */
function startHeartbeat() {
  // Clear any existing interval
  stopHeartbeat();

  // v1.6.3.7-v9 - Issue #1: Reset unified keepalive failure counter
  consecutiveKeepaliveFailures = 0;

  // Send initial heartbeat immediately
  sendHeartbeat();

  // Start interval - v1.6.3.7-v9: Uses unified UNIFIED_KEEPALIVE_INTERVAL_MS (20s)
  heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  console.log(
    '[Manager] v1.6.3.7-v9 Unified keepalive started (every',
    HEARTBEAT_INTERVAL_MS / 1000,
    's) - consolidated heartbeat + keepalive'
  );
}

/**
 * Stop heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #4: Cleanup on disconnect/unload
 */
function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    console.log('[Manager] v1.6.3.7-v9 Unified keepalive stopped');
  }
}

/**
 * Generate keepalive correlation ID
 * v1.6.3.7-v9 - Issue #1: Unique ID per keepalive round for tracing
 * @private
 * @returns {string} Correlation ID
 */
function _generateKeepaliveCorrelationId() {
  keepaliveCorrelationCounter++;
  return `ka-${Date.now()}-${keepaliveCorrelationCounter}`;
}

/**
 * Send heartbeat message to background (unified keepalive)
 * v1.6.3.6-v12 - FIX Issue #2, #4: Heartbeat with timeout detection
 * v1.6.3.7 - FIX Issue #2: Enhanced logging for port state transitions
 * v1.6.3.7-v4 - FIX Issue #1: Enhanced logging to distinguish port vs background state
 * v1.6.3.7-v9 - Issue #1: Unified keepalive with correlation IDs and START/COMPLETE logs
 *
 * Three-tier communication architecture:
 * 1. BroadcastChannel (PRIMARY) - Instant cross-tab messaging
 * 2. Port messaging (SECONDARY) - Persistent connection to background
 * 3. storage.onChanged (TERTIARY) - Reliable fallback
 */
async function sendHeartbeat() {
  // v1.6.3.7-v9 - Issue #1: Generate correlation ID for this keepalive round
  currentKeepaliveCorrelationId = _generateKeepaliveCorrelationId();
  currentKeepaliveStartTime = Date.now();

  // v1.6.3.7-v9 - Issue #1: Log keepalive START with correlation ID
  console.log('[Manager] [KEEPALIVE] START:', {
    correlationId: currentKeepaliveCorrelationId,
    portExists: backgroundPort !== null,
    connectionState,
    consecutiveFailures: consecutiveKeepaliveFailures,
    timestamp: currentKeepaliveStartTime
  });

  // v1.6.3.7-v4 - FIX Issue #1: Log heartbeat attempt with port state
  _logHeartbeatAttempt();

  if (!backgroundPort) {
    _handlePortDisconnected();
    // v1.6.3.7-v9 - Issue #1: Log keepalive COMPLETE (failed - no port)
    _logKeepaliveComplete(false, 'port-disconnected');
    return;
  }

  try {
    // v1.6.3.7 - FIX Issue #2: Send heartbeat with explicit timeout
    const response = await sendPortMessageWithTimeout(
      {
        type: 'HEARTBEAT',
        timestamp: Date.now(),
        source: 'sidebar',
        correlationId: currentKeepaliveCorrelationId // v1.6.3.7-v9: Include correlation ID
      },
      HEARTBEAT_TIMEOUT_MS
    );

    _handleHeartbeatSuccess(response, currentKeepaliveStartTime);
    // v1.6.3.7-v9 - Issue #1: Log keepalive COMPLETE (success)
    _logKeepaliveComplete(true, 'success');
  } catch (err) {
    _handleHeartbeatFailure(err);
    // v1.6.3.7-v9 - Issue #1: Log keepalive COMPLETE (failed)
    _logKeepaliveComplete(false, err.message);
    // v1.6.3.7-v9 - Issue #1: Trigger immediate fallback on failure
    _triggerKeepaliveFallback(err);
  }
}

/**
 * Log keepalive cycle completion
 * v1.6.3.7-v9 - Issue #1: COMPLETE log with correlation ID
 * @private
 * @param {boolean} success - Whether keepalive succeeded
 * @param {string} reason - Success/failure reason
 */
function _logKeepaliveComplete(success, reason) {
  const duration = Date.now() - currentKeepaliveStartTime;
  console.log('[Manager] [KEEPALIVE] COMPLETE:', {
    correlationId: currentKeepaliveCorrelationId,
    success,
    reason,
    durationMs: duration,
    consecutiveFailures: consecutiveKeepaliveFailures,
    timestamp: Date.now()
  });
}

/**
 * Trigger immediate fallback mechanism on keepalive failure
 * v1.6.3.7-v9 - Issue #1: Backpressure detection with immediate fallback
 * @private
 * @param {Error} err - The error that caused failure
 */
function _triggerKeepaliveFallback(err) {
  consecutiveKeepaliveFailures++;

  console.warn('[Manager] [KEEPALIVE] FALLBACK_TRIGGERED:', {
    correlationId: currentKeepaliveCorrelationId,
    error: err.message,
    consecutiveFailures: consecutiveKeepaliveFailures,
    threshold: KEEPALIVE_FAILURES_BEFORE_ZOMBIE,
    timestamp: Date.now()
  });

  // v1.6.3.7-v9 - Issue #1: Check if we should transition to ZOMBIE
  if (consecutiveKeepaliveFailures >= KEEPALIVE_FAILURES_BEFORE_ZOMBIE) {
    if (connectionState === CONNECTION_STATE.CONNECTED) {
      console.warn(
        '[Manager] [KEEPALIVE] ZOMBIE_TRANSITION: Consecutive failure threshold reached',
        {
          consecutiveFailures: consecutiveKeepaliveFailures,
          threshold: KEEPALIVE_FAILURES_BEFORE_ZOMBIE
        }
      );
      _transitionConnectionState(CONNECTION_STATE.ZOMBIE, 'keepalive-failure-threshold');
    }
  }
}

/**
 * Log heartbeat attempt details
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * v1.6.3.7-v5 - FIX Issue #1: Added connectionState to logging
 * v1.6.3.7-v9 - Issue #1: Added keepalive correlation ID
 * @private
 */
function _logHeartbeatAttempt() {
  console.log('[Manager] HEARTBEAT_ATTEMPT:', {
    correlationId: currentKeepaliveCorrelationId, // v1.6.3.7-v9
    portExists: backgroundPort !== null,
    portConnected: backgroundPort ? 'yes' : 'no',
    connectionState, // v1.6.3.7-v5 - FIX Issue #1: Explicit connection state
    circuitBreakerState,
    consecutiveFailures: consecutiveHeartbeatFailures,
    consecutiveKeepaliveFailures, // v1.6.3.7-v9
    timeSinceLastSuccess: Date.now() - lastHeartbeatResponse
  });
}

/**
 * Handle case when port is disconnected
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * v1.6.3.7-v5 - FIX Issue #1: Update connection state
 * v1.6.3.7-v9 - Issue #1: Increment unified failure counter
 * v1.6.3.8-v4 - FIX Issue #4: Attempt Tier 3 fallback on port failure
 * @private
 */
function _handlePortDisconnected() {
  console.warn('[Manager] HEARTBEAT_FAILED: port disconnected', {
    correlationId: currentKeepaliveCorrelationId, // v1.6.3.7-v9
    status: 'PORT_DISCONNECTED',
    connectionState,
    circuitBreakerState,
    reconnectAttempts,
    diagnosis: 'Port object is null - connection was closed or never established'
  });

  // v1.6.3.7-v5 - FIX Issue #1: Update connection state
  if (connectionState !== CONNECTION_STATE.DISCONNECTED) {
    _transitionConnectionState(CONNECTION_STATE.DISCONNECTED, 'heartbeat-port-null');
  }

  consecutiveHeartbeatFailures++;
  // v1.6.3.7-v9 - Issue #1: Also increment unified counter
  consecutiveKeepaliveFailures++;

  // v1.6.3.8-v4 - FIX Issue #4: Attempt Tier 3 fallback on port failure
  _attemptTier3FallbackOnPortFailure().catch(err => {
    console.warn('[Manager] TIER3_FALLBACK_ERROR:', {
      error: err.message,
      timestamp: Date.now()
    });
  });

  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    console.error('[Manager] v1.6.3.7-v9 Max heartbeat failures - triggering reconnect');
    scheduleReconnect();
  }
}

/**
 * Handle successful heartbeat response
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * v1.6.3.7-v5 - FIX Issue #1: Update connection state on success
 * v1.6.3.7-v8 - FIX Issue #13: Reset timeout counter on success
 * v1.6.3.7-v9 - Issue #1: Reset unified keepalive failure counter
 * @private
 * @param {Object} response - Response from background
 * @param {number} startTime - When heartbeat was started
 */
function _handleHeartbeatSuccess(response, startTime) {
  consecutiveHeartbeatFailures = 0;
  // v1.6.3.7-v8 - FIX Issue #13: Reset timeout-specific counter on success
  consecutiveHeartbeatTimeouts = 0;
  // v1.6.3.7-v9 - Issue #1: Reset unified keepalive failure counter
  consecutiveKeepaliveFailures = 0;
  lastHeartbeatResponse = Date.now();

  // v1.6.3.7-v5 - FIX Issue #1: Confirm we're in CONNECTED state (recovered from zombie)
  if (connectionState !== CONNECTION_STATE.CONNECTED) {
    _transitionConnectionState(CONNECTION_STATE.CONNECTED, 'heartbeat-success');
  }

  console.log('[Manager] [HEARTBEAT] SUCCESS:', {
    correlationId: currentKeepaliveCorrelationId, // v1.6.3.7-v9
    status: 'BACKGROUND_ALIVE',
    connectionState,
    roundTripMs: Date.now() - startTime,
    backgroundAlive: response?.backgroundAlive ?? true,
    isInitialized: response?.isInitialized,
    circuitBreakerState,
    consecutiveTimeouts: consecutiveHeartbeatTimeouts,
    consecutiveKeepaliveFailures, // v1.6.3.7-v9
    diagnosis: 'Background script is alive and responding'
  });
}

/**
 * Handle heartbeat failure
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * v1.6.3.7-v5 - FIX Issue #1: Immediately detect zombie state and switch to BroadcastChannel
 * v1.6.3.7-v8 - FIX Issue #13: Implement hysteresis - require 2-3 consecutive failures before ZOMBIE
 * @private
 * @param {Error} err - Error that occurred
 */
function _handleHeartbeatFailure(err) {
  consecutiveHeartbeatFailures++;

  const isTimeout = err.message === 'Heartbeat timeout';
  const isPortClosed = err.message.includes('disconnected') || err.message.includes('closed');

  // v1.6.3.7-v8 - FIX Issue #13: Track timeout-specific failures for hysteresis
  if (isTimeout) {
    consecutiveHeartbeatTimeouts++;
  } else {
    // Non-timeout failures (like port closed) still count but reset timeout counter
    consecutiveHeartbeatTimeouts = 0;
  }

  console.warn('[Manager] [HEARTBEAT] [FAILURE]:', {
    status: isTimeout ? 'TIMEOUT' : isPortClosed ? 'PORT_CLOSED' : 'UNKNOWN_ERROR',
    error: err.message,
    count: consecutiveHeartbeatTimeouts,
    maxBeforeZombie: HEARTBEAT_FAILURES_BEFORE_ZOMBIE,
    totalFailures: consecutiveHeartbeatFailures,
    maxTotalFailures: MAX_HEARTBEAT_FAILURES,
    timeSinceLastSuccess: Date.now() - lastHeartbeatResponse,
    connectionState,
    circuitBreakerState,
    diagnosis: _getHeartbeatFailureDiagnosis(isTimeout, isPortClosed)
  });

  // v1.6.3.7-v8 - FIX Issue #13: Implement hysteresis - require consecutive failures before ZOMBIE
  // Instead of immediately transitioning on first timeout, require 2-3 consecutive timeouts
  if (isTimeout && connectionState === CONNECTION_STATE.CONNECTED) {
    if (consecutiveHeartbeatTimeouts >= HEARTBEAT_FAILURES_BEFORE_ZOMBIE) {
      console.warn(
        '[Manager] [HEARTBEAT] [ZOMBIE_TRANSITION]: Consecutive timeout threshold reached',
        {
          consecutiveTimeouts: consecutiveHeartbeatTimeouts,
          threshold: HEARTBEAT_FAILURES_BEFORE_ZOMBIE
        }
      );
      _transitionConnectionState(CONNECTION_STATE.ZOMBIE, 'heartbeat-timeout-zombie');
      // BroadcastChannel fallback is activated in _transitionConnectionState
    } else {
      console.log('[Manager] [HEARTBEAT] [TIMEOUT_WARNING]: Timeout detected but below threshold', {
        consecutiveTimeouts: consecutiveHeartbeatTimeouts,
        threshold: HEARTBEAT_FAILURES_BEFORE_ZOMBIE,
        remainingBeforeZombie: HEARTBEAT_FAILURES_BEFORE_ZOMBIE - consecutiveHeartbeatTimeouts
      });
    }
  }

  _processHeartbeatFailureRecovery(isTimeout);
}

/**
 * Get diagnosis message for heartbeat failure
 * v1.6.3.7-v4 - Extracted to reduce _handleHeartbeatFailure complexity
 * @private
 * @param {boolean} isTimeout - Whether failure was timeout
 * @param {boolean} isPortClosed - Whether port was closed
 * @returns {string} Diagnosis message
 */
function _getHeartbeatFailureDiagnosis(isTimeout, isPortClosed) {
  if (isTimeout)
    return 'Port is open but background script is not responding (Firefox 30s termination?)';
  if (isPortClosed) return 'Port was closed by background script';
  return 'Unknown heartbeat failure';
}

/**
 * Process recovery actions after heartbeat failure
 * v1.6.3.7-v4 - Extracted to reduce _handleHeartbeatFailure complexity
 * @private
 * @param {boolean} isTimeout - Whether failure was timeout
 */
function _processHeartbeatFailureRecovery(isTimeout) {
  if (isTimeout) {
    console.error(
      '[Manager] v1.6.3.7 ZOMBIE_PORT_DETECTED: Port appears alive but background is dead'
    );
    backgroundPort = null;
  }

  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    console.error('[Manager] v1.6.3.6-v12 Background unresponsive - triggering reconnect');
    backgroundPort = null;
    stopHeartbeat();
    scheduleReconnect();
  }
}

/**
 * Send port message with timeout
 * v1.6.3.6-v12 - FIX Issue #4: Wrap port messages with timeout
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from background
 */
// ==================== v1.6.3.7-v9 PORT MESSAGE SEQUENCING (Issue #9) ====================
// Monotonic sequence counter for outgoing port messages

/**
 * Monotonic sequence counter for outgoing port messages from Manager
 * v1.6.3.7-v9 - Issue #9: Detect message reordering
 */
let _managerPortMessageSequence = 0;

/**
 * Get next message sequence number for port messages
 * v1.6.3.7-v9 - Issue #9: Generate monotonically increasing sequence
 * @private
 * @returns {number} Next sequence number
 */
function _getNextManagerPortMessageSequence() {
  _managerPortMessageSequence++;
  return _managerPortMessageSequence;
}

/**
 * Send a message via port with timeout and correlation ID
 * v1.6.3.6-v12 - FIX Issue #4: Send messages with acknowledgment tracking
 * v1.6.3.7-v9 - Issue #9: Added message sequence number for ordering
 * v1.6.3.8-v4 - FIX Issue #2: Guard against sending during reconnection/registration
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from background
 */
async function sendPortMessageWithTimeout(message, timeoutMs) {
  // v1.6.3.8-v4 - FIX Issue #2: Pre-flight checks before creating Promise
  if (!backgroundPort) {
    throw new Error('Port not connected');
  }

  // v1.6.3.8-v4 - FIX Issue #2: Wait for listener registration before sending
  if (!listenerFullyRegistered && listenerReadyPromise) {
    console.log('[Manager] [PORT] MESSAGE_AWAITING_REGISTRATION:', {
      type: message.type,
      timestamp: Date.now()
    });
    
    try {
      // Wait for listener registration with a timeout
      await Promise.race([
        listenerReadyPromise,
        new Promise((_, timeoutReject) => 
          setTimeout(() => timeoutReject(new Error('Listener registration timeout')), LISTENER_REGISTRATION_TIMEOUT_MS)
        )
      ]);
    } catch (err) {
      console.warn('[Manager] [PORT] MESSAGE_REGISTRATION_WAIT_FAILED:', {
        type: message.type,
        error: err.message,
        timestamp: Date.now()
      });
      throw new Error('Listener registration timeout - message not sent');
    }
  }

  // v1.6.3.8-v4 - FIX Issue #2: Double-check port is still connected after await
  if (!backgroundPort) {
    throw new Error('Port disconnected during registration wait');
  }

  // Now create the Promise for the actual message send/response
  return new Promise((resolve, reject) => {
    const correlationId = generateCorrelationId();
    // v1.6.3.7-v9 - Issue #9: Add message sequence number
    const messageSequence = _getNextManagerPortMessageSequence();
    const messageWithCorrelation = {
      ...message,
      correlationId,
      messageSequence // v1.6.3.7-v9
    };

    // Set up timeout
    const timeout = setTimeout(() => {
      pendingAcks.delete(correlationId);
      reject(new Error('Heartbeat timeout'));
    }, timeoutMs);

    // Track pending ack
    pendingAcks.set(correlationId, {
      resolve,
      reject,
      timeout,
      sentAt: Date.now(),
      messageSequence // v1.6.3.7-v9: Track sequence for debugging
    });

    // Send message
    try {
      backgroundPort.postMessage(messageWithCorrelation);

      // v1.6.3.7-v9 - Issue #9: Log sequence for debugging
      if (DEBUG_MESSAGING) {
        console.log('[Manager] [PORT] MESSAGE_SENT:', {
          type: message.type,
          correlationId,
          messageSequence,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      clearTimeout(timeout);
      pendingAcks.delete(correlationId);
      reject(err);
    }
  });
}

// ==================== END HEARTBEAT FUNCTIONS ====================

// ==================== v1.6.4.0 STATE SYNC & UNIFIED RENDER ====================
// FIX Issue E: State sync on port reconnection
// FIX Issue B: Unified render entry point
// FIX Issue D: Hash-based state staleness detection

/**
 * State hash captured when debounce timer was set
 * v1.6.4.0 - FIX Issue D: Detect state staleness during debounce
 */
let capturedStateHashAtDebounce = 0;

/**
 * Timestamp when debounce was set
 * v1.6.4.0 - FIX Issue D: Track debounce timing
 */
let debounceSetTimestamp = 0;

/**
 * State sync timeout (5 seconds)
 * v1.6.4.0 - FIX Issue E: Timeout for state sync request
 */
const STATE_SYNC_TIMEOUT_MS = 5000;

/**
 * Request full state sync from background after port reconnection
 * v1.6.4.0 - FIX Issue E: Ensure Manager has latest state after reconnection
 * v1.6.3.7-v6 - Gap #3 & Gap #4: Enhanced logging for state sync request/response/timeout
 * @private
 */
async function _requestFullStateSync() {
  if (!backgroundPort) {
    console.warn('[Manager] Cannot request state sync - port not connected');
    return;
  }

  const syncRequestTime = Date.now();
  _logStateSyncStart(syncRequestTime);

  try {
    const request = _buildStateSyncRequest(syncRequestTime);
    const response = await sendPortMessageWithTimeout(request, STATE_SYNC_TIMEOUT_MS);

    _processStateSyncResponse(response, syncRequestTime);
  } catch (err) {
    _logStateSyncTimeout(err);
  }
}

/**
 * Log state sync request start
 * v1.6.4.17 - Extracted to reduce _requestFullStateSync CC
 * @private
 */
function _logStateSyncStart(syncRequestTime) {
  console.log('[Manager] STATE_SYNC_REQUESTED:', {
    timestamp: syncRequestTime,
    timeoutMs: STATE_SYNC_TIMEOUT_MS,
    currentCacheTabCount: quickTabsState?.tabs?.length ?? 0
  });
}

/**
 * Build state sync request message
 * v1.6.4.17 - Extracted to reduce _requestFullStateSync CC
 * @private
 */
function _buildStateSyncRequest(syncRequestTime) {
  return {
    type: 'REQUEST_FULL_STATE_SYNC',
    timestamp: syncRequestTime,
    source: 'sidebar',
    currentCacheHash: computeStateHash(quickTabsState),
    currentCacheTabCount: quickTabsState?.tabs?.length ?? 0
  };
}

/**
 * Process state sync response
 * v1.6.4.17 - Extracted to reduce _requestFullStateSync CC
 * @private
 */
function _processStateSyncResponse(response, syncRequestTime) {
  if (response?.success && response?.state) {
    _logStateSyncSuccess(response, syncRequestTime);
    _handleStateSyncResponse(response);
  } else {
    console.warn('[Manager] State sync response did not include state:', response);
  }
}

/**
 * Log successful state sync response
 * v1.6.4.17 - Extracted helper
 * @private
 */
function _logStateSyncSuccess(response, syncRequestTime) {
  const responseTime = Date.now();
  console.log('[Manager] STATE_SYNC_RESPONSE_RECEIVED:', {
    timestamp: responseTime,
    roundTripMs: responseTime - syncRequestTime,
    serverTabCount: response.state?.tabs?.length ?? 0
  });
}

/**
 * Log state sync timeout
 * v1.6.4.17 - Extracted helper
 * @private
 */
function _logStateSyncTimeout(err) {
  console.warn('[Manager] STATE_SYNC_TIMEOUT:', {
    timestamp: Date.now(),
    timeoutMs: STATE_SYNC_TIMEOUT_MS,
    error: err.message,
    message: `State sync did not complete within ${STATE_SYNC_TIMEOUT_MS}ms`
  });
}

/**
 * Handle state sync response from background
 * v1.6.4.0 - FIX Issue E: Compare and update state
 * @private
 * @param {Object} response - Response from background with state
 */
function _handleStateSyncResponse(response) {
  const serverState = response.state;
  const serverTabCount = serverState?.tabs?.length ?? 0;
  const cacheTabCount = quickTabsState?.tabs?.length ?? 0;

  const serverHash = computeStateHash(serverState);
  const cacheHash = computeStateHash(quickTabsState);
  const hashDiverged = serverHash !== cacheHash;

  console.log('[Manager] STATE_SYNC_RECEIVED:', {
    serverTabCount,
    cacheTabCount,
    serverHash,
    cacheHash,
    diverged: hashDiverged
  });

  if (hashDiverged) {
    console.log(
      '[Manager] STATE_DIVERGENCE_DETECTED: server has',
      serverTabCount,
      'tabs, cache had',
      cacheTabCount,
      'tabs - updating'
    );

    // Update local state from server
    quickTabsState = serverState;
    _updateInMemoryCache(serverState.tabs || []);
    lastKnownGoodTabCount = serverTabCount;
    lastLocalUpdateTime = Date.now();

    // Trigger UI update
    scheduleRender('state-sync-divergence');
  } else {
    console.log('[Manager] State sync complete - no divergence detected');
  }
}

/**
 * Unified render entry point - ALL render triggers go through here
 * v1.6.4.0 - FIX Issue B: Single entry point prevents cascading render triggers
 * v1.6.3.7-v4 - FIX Issue #4: Enhanced deduplication with message ID tracking
 * v1.6.3.7-v5 - FIX Issue #4: Added saveId-based deduplication
 * v1.6.3.7-v6 - Gap #5: Enhanced deduplication logging with reason codes
 * v1.6.4.17 - Refactored to reduce CC from 11 to ~4
 * @param {string} source - Source of render trigger for logging
 * @param {string} [messageId] - Optional message ID for deduplication
 */
function scheduleRender(source = 'unknown', messageId = null) {
  const context = _buildRenderContext(source, messageId);

  if (_shouldForceRender(context)) {
    _proceedToRender(source, messageId, context.currentSaveId, context.currentHash);
    return;
  }

  if (_shouldSkipRender(context, messageId)) {
    return;
  }

  _proceedToRender(source, messageId, context.currentSaveId, context.currentHash);
}

/**
 * Build render context with computed values
 * v1.6.4.17 - Extracted from scheduleRender
 * @private
 * @param {string} source - Render source
 * @param {string} messageId - Message ID
 * @returns {Object} Render context
 */
function _buildRenderContext(source, messageId) {
  return {
    source,
    messageId,
    currentHash: computeStateHash(quickTabsState),
    currentTabCount: quickTabsState?.tabs?.length ?? 0,
    currentSaveId: _getValidSaveId(quickTabsState?.saveId)
  };
}

/**
 * Check if render should be forced (empty→populated transition)
 * v1.6.4.17 - Extracted from scheduleRender
 * @private
 * @param {Object} context - Render context
 * @returns {boolean} True if render should be forced
 */
function _shouldForceRender(context) {
  if (lastRenderedStateHash !== 0 || context.currentTabCount <= 0) {
    return false;
  }

  console.log('[Manager] RENDER_SPECIAL_CASE: Previous state was empty, forcing render', {
    source: context.source,
    previousHash: lastRenderedStateHash,
    currentHash: context.currentHash,
    currentTabCount: context.currentTabCount
  });
  return true;
}

/**
 * Check if render should be skipped due to deduplication
 * v1.6.4.17 - Extracted from scheduleRender
 * @private
 * @param {Object} context - Render context
 * @param {string} messageId - Message ID
 * @returns {boolean} True if render should be skipped
 */
function _shouldSkipRender(context, messageId) {
  return (
    _checkSaveIdDedup(context) ||
    _checkMessageIdDedup(context, messageId) ||
    _checkHashDedup(context)
  );
}

/**
 * Check saveId-based deduplication
 * v1.6.4.17 - Extracted from scheduleRender
 * @private
 * @param {Object} context - Render context
 * @returns {boolean} True if should skip
 */
function _checkSaveIdDedup(context) {
  if (!context.currentSaveId || context.currentSaveId !== lastProcessedSaveId) {
    return false;
  }

  console.log('[Manager] RENDER_SKIPPED:', {
    reason: 'saveId_match',
    source: context.source,
    saveId: context.currentSaveId,
    lastProcessedSaveId,
    hash: context.currentHash
  });
  return true;
}

/**
 * Check message ID deduplication
 * v1.6.4.17 - Extracted from scheduleRender
 * @private
 * @param {Object} context - Render context
 * @param {string} messageId - Message ID
 * @returns {boolean} True if should skip
 */
function _checkMessageIdDedup(context, messageId) {
  if (!messageId || !_isMessageAlreadyProcessed(messageId)) {
    return false;
  }

  console.log('[Manager] RENDER_SKIPPED:', {
    reason: 'message_dedup',
    source: context.source,
    messageId,
    hash: context.currentHash
  });
  return true;
}

/**
 * Check hash-based deduplication
 * v1.6.4.17 - Extracted from scheduleRender
 * @private
 * @param {Object} context - Render context
 * @returns {boolean} True if should skip
 */
function _checkHashDedup(context) {
  if (context.currentHash !== lastRenderedStateHash) {
    return false;
  }

  console.log('[Manager] RENDER_SKIPPED:', {
    reason: 'hash_match',
    source: context.source,
    hash: context.currentHash
  });
  return true;
}

/**
 * Proceed with rendering after passing deduplication checks
 * v1.6.3.7-v6 - Gap #5: Extracted to support special case rendering
 * @private
 */
function _proceedToRender(source, messageId, currentSaveId, currentHash) {
  // v1.6.3.7-v5 - FIX Issue #4: Track this saveId as processed
  if (currentSaveId) {
    lastProcessedSaveId = currentSaveId;
    lastSaveIdProcessedAt = Date.now();
    console.log('[Manager] SAVEID_PROCESSED:', {
      saveId: currentSaveId,
      source,
      timestamp: lastSaveIdProcessedAt
    });
  }

  // v1.6.3.7-v4 - FIX Issue #4: Track this message as processed
  if (messageId) {
    _markMessageAsProcessed(messageId);
  }

  console.log('[Manager] RENDER_SCHEDULED:', {
    source,
    messageId,
    saveId: currentSaveId,
    newHash: currentHash,
    previousHash: lastRenderedStateHash,
    timestamp: Date.now()
  });

  // Route to the debounced renderUI
  renderUI();
}

/**
 * Check if a message was already processed (deduplication)
 * v1.6.3.7-v4 - FIX Issue #4: Message deduplication helper
 * @private
 * @param {string} messageId - Message ID to check
 * @returns {boolean} True if already processed
 */
function _isMessageAlreadyProcessed(messageId) {
  if (!messageId) return false;
  return recentlyProcessedMessageIds.has(messageId);
}

/**
 * Validate and return saveId as string
 * v1.6.3.7-v5 - FIX Code Review: Type validation for saveId
 * @private
 * @param {*} saveId - Value to validate
 * @returns {string} Valid saveId string or empty string
 */
function _getValidSaveId(saveId) {
  if (typeof saveId === 'string' && saveId.length > 0) {
    return saveId;
  }
  // Handle unexpected types gracefully
  if (saveId != null && typeof saveId !== 'string') {
    console.warn('[Manager] SAVEID_INVALID_TYPE: saveId is not a string', {
      type: typeof saveId,
      value: saveId
    });
  }
  return '';
}

/**
 * Map of processed message IDs with their timestamps
 * v1.6.3.7-v4 - FIX Code Review: Use Map with timestamps for efficient cleanup
 */
const processedMessageTimestamps = new Map();

/**
 * Mark a message as processed for deduplication
 * v1.6.3.7-v4 - FIX Issue #4: Message deduplication helper
 * v1.6.3.7-v4 - FIX Code Review: Use Map with timestamps for efficient memory management
 * v1.6.4.16 - FIX Issue #13: Trigger cleanup if approaching max size
 * v1.6.3.8-v4 - FIX Issue #7: Proactive cleanup at 50%, sliding window at 95%
 * @private
 * @param {string} messageId - Message ID to mark
 */
function _markMessageAsProcessed(messageId) {
  if (!messageId) return;

  // v1.6.3.8-v4 - FIX Issue #7: Proactive cleanup at 50% capacity
  const currentCapacity = processedMessageTimestamps.size / MESSAGE_DEDUP_MAX_SIZE;
  
  if (currentCapacity >= DEDUP_EVICTION_THRESHOLD) {
    // v1.6.3.8-v4 - At 95% capacity, use sliding window eviction (remove oldest 10%)
    _slidingWindowEviction();
  } else if (currentCapacity >= DEDUP_CLEANUP_THRESHOLD) {
    // v1.6.3.8-v4 - At 50% capacity, do proactive cleanup
    _cleanupExpiredMessageIds();
  }

  recentlyProcessedMessageIds.add(messageId);
  processedMessageTimestamps.set(messageId, Date.now());
}

/**
 * Sliding window eviction - remove oldest 10% when hitting 95% capacity
 * v1.6.3.8-v4 - FIX Issue #7: More aggressive cleanup to prevent unbounded growth
 * @private
 */
function _slidingWindowEviction() {
  const currentSize = processedMessageTimestamps.size;
  const evictCount = Math.ceil(currentSize * 0.1); // Remove oldest 10%
  
  if (evictCount === 0) return;
  
  // Sort by timestamp (oldest first)
  const sortedEntries = [...processedMessageTimestamps.entries()].sort((a, b) => a[1] - b[1]);
  
  for (let i = 0; i < evictCount && i < sortedEntries.length; i++) {
    const [messageId] = sortedEntries[i];
    recentlyProcessedMessageIds.delete(messageId);
    processedMessageTimestamps.delete(messageId);
  }
  
  console.log('[Manager] [DEDUP] SLIDING_WINDOW_EVICTION:', {
    evictedCount: evictCount,
    previousSize: currentSize,
    remainingSize: processedMessageTimestamps.size,
    capacityBefore: ((currentSize / MESSAGE_DEDUP_MAX_SIZE) * 100).toFixed(1) + '%',
    capacityAfter: ((processedMessageTimestamps.size / MESSAGE_DEDUP_MAX_SIZE) * 100).toFixed(1) + '%',
    timestamp: Date.now()
  });
}

/**
 * Cleanup expired message IDs (called periodically)
 * v1.6.3.7-v4 - FIX Code Review: Efficient periodic cleanup instead of per-message timers
 * v1.6.4.16 - FIX Issue #13: Size-based eviction when over max capacity
 * v1.6.4.17 - Refactored to flatten bumpy road (bumps=2)
 * v1.6.3.8-v4 - FIX Issue #7: Enhanced with hybrid cleanup strategy
 * @private
 */
function _cleanupExpiredMessageIds() {
  const now = Date.now();
  const sizeBefore = processedMessageTimestamps.size;
  const expiredCount = _removeExpiredMessages(now);
  
  // v1.6.3.8-v4 - FIX Issue #7: Also check size-based eviction after age-based cleanup
  _evictOldestIfOverCapacity(now);
  
  _logExpiredCleanup(expiredCount, sizeBefore, now);
}

/**
 * Remove messages older than max age
 * v1.6.4.17 - Extracted from _cleanupExpiredMessageIds
 * @private
 * @param {number} now - Current timestamp
 * @returns {number} Number of expired messages removed
 */
function _removeExpiredMessages(now) {
  let expiredCount = 0;

  for (const [messageId, timestamp] of processedMessageTimestamps) {
    if (now - timestamp > MESSAGE_ID_MAX_AGE_MS) {
      recentlyProcessedMessageIds.delete(messageId);
      processedMessageTimestamps.delete(messageId);
      expiredCount++;
    }
  }

  return expiredCount;
}

/**
 * Evict oldest messages if over capacity (LRU-style)
 * v1.6.4.17 - Extracted from _cleanupExpiredMessageIds
 * @private
 * @param {number} now - Current timestamp
 */
function _evictOldestIfOverCapacity(now) {
  if (processedMessageTimestamps.size <= MESSAGE_DEDUP_MAX_SIZE) {
    return;
  }

  const evictCount = processedMessageTimestamps.size - MESSAGE_DEDUP_MAX_SIZE;
  const sortedEntries = [...processedMessageTimestamps.entries()].sort((a, b) => a[1] - b[1]);

  for (let i = 0; i < evictCount; i++) {
    const [messageId] = sortedEntries[i];
    recentlyProcessedMessageIds.delete(messageId);
    processedMessageTimestamps.delete(messageId);
  }

  console.log('[Manager] [DEDUP] SIZE_EVICTION:', {
    evictedCount: evictCount,
    remainingSize: processedMessageTimestamps.size,
    maxSize: MESSAGE_DEDUP_MAX_SIZE,
    timestamp: now
  });
}

/**
 * Log expired message cleanup if any were removed
 * v1.6.4.17 - Extracted from _cleanupExpiredMessageIds
 * v1.6.3.8-v4 - FIX Issue #7: Enhanced logging with capacity percentage
 * @private
 * @param {number} expiredCount - Number of expired messages
 * @param {number} sizeBefore - Size before cleanup
 * @param {number} now - Current timestamp
 */
function _logExpiredCleanup(expiredCount, sizeBefore, now) {
  if (expiredCount > 0) {
    const sizeAfter = processedMessageTimestamps.size;
    console.log('[Manager] [DEDUP] EXPIRED_CLEANUP:', {
      expiredCount,
      sizeBefore,
      sizeAfter,
      capacityBefore: ((sizeBefore / MESSAGE_DEDUP_MAX_SIZE) * 100).toFixed(1) + '%',
      capacityAfter: ((sizeAfter / MESSAGE_DEDUP_MAX_SIZE) * 100).toFixed(1) + '%',
      timestamp: now
    });
  }
}

// Start periodic cleanup interval (every 5 seconds)
setInterval(_cleanupExpiredMessageIds, 5000);

// ==================== v1.6.3.7-v13 DEDUP MAP SIZE LOGGING ====================
// Issue #5: Periodic logging of dedup Map size for memory monitoring
const DEDUP_MAP_SIZE_LOG_INTERVAL_MS = 60000; // Log every 60 seconds
const ESTIMATED_BYTES_PER_ENTRY = 50; // Approximate memory per Map entry (key + value + overhead)

/**
 * Log the current size of the deduplication Map
 * v1.6.3.7-v13 - Issue #5: Periodic memory monitoring for dedup map
 * @private
 */
function _logDedupMapSize() {
  const size = processedMessageTimestamps.size;
  const estimatedKB = ((size * ESTIMATED_BYTES_PER_ENTRY) / 1024).toFixed(1);
  const capacityPercent = ((size / MESSAGE_DEDUP_MAX_SIZE) * 100).toFixed(1);

  console.log('[Manager] [DEDUP] DEDUP_MAP_SIZE:', {
    entries: size,
    maxSize: MESSAGE_DEDUP_MAX_SIZE,
    capacityPercent: capacityPercent + '%',
    estimatedMemoryKB: estimatedKB + 'KB',
    timestamp: Date.now()
  });
}

// Start periodic dedup map size logging (every 60 seconds)
setInterval(_logDedupMapSize, DEDUP_MAP_SIZE_LOG_INTERVAL_MS);

// ==================== END STATE SYNC & UNIFIED RENDER ====================

/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #10: Process acknowledgments
 * v1.6.3.6-v12 - FIX Issue #4: Handle HEARTBEAT_ACK
 * v1.6.4.0 - FIX Issue E: Handle FULL_STATE_SYNC response
 * v1.6.3.7-v4 - FIX Issue #3: Handle STATE_UPDATE from port (not just runtime.onMessage)
 * v1.6.3.7-v4 - FIX Issue #9: Wrapped in try-catch for error handling
 * @param {Object} message - Message from background
 */
function handlePortMessage(message) {
  // v1.6.3.7-v9 - Issue #2: Track start time for duration logging
  const messageEntryTime = Date.now();

  // v1.6.3.7-v4 - FIX Issue #9: Wrap in try-catch to handle corrupted messages gracefully
  try {
    // v1.6.3.7-v4 - FIX Issue #9: Validate message structure
    if (!message || typeof message !== 'object') {
      console.warn('[Manager] PORT_MESSAGE_INVALID: Received non-object message:', typeof message);
      return;
    }

    _logPortMessageReceived(message, messageEntryTime);

    // Route message to appropriate handler
    _routePortMessage(message);

    // v1.6.3.7-v9 - Issue #2: Log message exit with duration
    const processingDurationMs = Date.now() - messageEntryTime;
    if (DEBUG_MESSAGING) {
      console.log(
        `[Manager] MESSAGE_PROCESSED [PORT] [${message.type || message.action || 'UNKNOWN'}]:`,
        {
          quickTabId: message.quickTabId,
          correlationId: message.correlationId,
          durationMs: processingDurationMs,
          timestamp: Date.now()
        }
      );
    }
  } catch (err) {
    // v1.6.3.7-v4 - FIX Issue #9: Log error with context and continue
    console.error('[Manager] PORT_MESSAGE_ERROR: Error processing port message:', {
      error: err.message,
      stack: err.stack,
      messageType: message?.type,
      messageAction: message?.action,
      timestamp: Date.now()
    });
    // Don't rethrow - graceful degradation
  }
}

/**
 * Log port message received with details
 * v1.6.3.7-v4 - FIX Issue #9: Extracted for complexity reduction
 * v1.6.3.7-v5 - FIX Issue #3: Added path indicator for unified message routing logging
 * v1.6.4.13 - Issue #5: Consolidated MESSAGE_RECEIVED logging (single log entry)
 * v1.6.3.7-v9 - Issue #2: Added entryTime parameter for timing, generate correlationId if missing
 * @private
 * @param {Object} message - Message from background
 * @param {number} entryTime - Timestamp when message was received
 */
function _logPortMessageReceived(message, entryTime) {
  // v1.6.3.7-v9 - Issue #2: Generate correlationId if not present (for correlation tracking)
  const correlationId =
    message.correlationId || `port-${entryTime}-${Math.random().toString(36).substring(2, 7)}`;

  // v1.6.4.13 - Issue #5: Consolidated log with [PORT] prefix and all details
  console.log(
    `[Manager] MESSAGE_RECEIVED [PORT] [${message.type || message.action || 'UNKNOWN'}]:`,
    {
      quickTabId: message.quickTabId,
      messageId: message.messageId,
      saveId: message.saveId,
      correlationId,
      from: 'background',
      path: 'port-connection',
      connectionState,
      timestamp: entryTime
    }
  );

  logPortLifecycle('message', {
    type: message.type,
    action: message.action,
    correlationId
  });
}

/**
 * Route port message to appropriate handler
 * v1.6.3.7-v4 - FIX Issue #9: Extracted for complexity reduction
 * v1.6.3.7-v5 - FIX Issue #3: Added logging for STATE_UPDATE via port path
 * v1.6.3.7-v10 - FIX Issue #6: Handle START_STORAGE_WATCHDOG message
 * v1.6.3.7-v10 - FIX ESLint: Refactored to use lookup table to reduce complexity
 * @private
 * @param {Object} message - Message to route
 */
function _routePortMessage(message) {
  // v1.6.3.6-v12 - FIX Issue #4: Handle heartbeat acknowledgment (combined check)
  if (message.type === 'HEARTBEAT_ACK' || message.type === 'ACKNOWLEDGMENT') {
    handleAcknowledgment(message);
    return;
  }

  // v1.6.3.7-v10 - Use handler lookup for simple routes
  const handled = _tryRoutePortMessageByType(message);
  if (handled) return;

  // v1.6.3.7-v7 - FIX Issue #7: Handle operation confirmations from background
  if (_isOperationConfirmation(message.type)) {
    _handleOperationConfirmation(message);
    return;
  }

  // v1.6.3.7-v7 - FIX Issue #7: Log unknown message types for debugging
  console.log('[Manager] [PORT] UNKNOWN_MESSAGE_TYPE:', {
    type: message.type,
    action: message.action,
    messageId: message.messageId,
    timestamp: Date.now()
  });
}

/**
 * Try to route port message by type using lookup table
 * v1.6.3.7-v10 - FIX ESLint: Extracted to reduce _routePortMessage complexity
 * @private
 * @param {Object} message - Message to route
 * @returns {boolean} True if message was handled
 */
function _tryRoutePortMessageByType(message) {
  const handlers = {
    START_STORAGE_WATCHDOG: _handleStartStorageWatchdog,
    BROADCAST: handleBroadcast,
    QUICK_TAB_STATE_UPDATED: _handleQuickTabStateUpdate,
    FULL_STATE_SYNC: _handleStateSyncResponse
  };

  const handler = handlers[message.type];
  if (handler) {
    handler(message);
    return true;
  }

  // Special handling for STATE_UPDATE with logging
  if (message.type === 'STATE_UPDATE') {
    _handlePortStateUpdate(message);
    return true;
  }

  return false;
}

/**
 * Handle STATE_UPDATE message via port
 * v1.6.3.7-v10 - FIX ESLint: Extracted to reduce _routePortMessage complexity
 * v1.6.3.7-v12 - Issue #5: Track fallback updates for health monitoring
 * @private
 * @param {Object} message - State update message
 */
function _handlePortStateUpdate(message) {
  console.log('[Manager] PORT_STATE_UPDATE:', {
    type: message.type,
    quickTabId: message.quickTabId || message.payload?.quickTabId,
    path: 'port-connection',
    timestamp: Date.now()
  });
  handleStateUpdateBroadcast(message);
  scheduleRender('port-STATE_UPDATE', message.messageId);

  // v1.6.3.7-v12 - Issue #5: Track as port-based fallback update
  _trackFallbackUpdate('port');
}

/**
 * Handle START_STORAGE_WATCHDOG message from background
 * v1.6.3.7-v10 - FIX Issue #6: Start watchdog timer when background notifies of storage write
 * v1.6.3.7-v10 - FIX Code Review: timeoutMs destructured for logging but timer uses STORAGE_WATCHDOG_TIMEOUT_MS
 * @private
 * @param {Object} message - Watchdog message with expectedSaveId and timeoutMs
 */
function _handleStartStorageWatchdog(message) {
  const { expectedSaveId, sequenceId, timeoutMs } = message;

  // Note: timeoutMs from message is logged for debugging, but timer uses local constant
  // STORAGE_WATCHDOG_TIMEOUT_MS (2000ms) to ensure consistent behavior
  console.log('[Manager] START_STORAGE_WATCHDOG received:', {
    expectedSaveId,
    sequenceId,
    backgroundTimeoutMs: timeoutMs, // v1.6.3.7-v10 - Renamed for clarity
    localTimeoutMs: STORAGE_WATCHDOG_TIMEOUT_MS,
    timestamp: Date.now()
  });

  // Start the watchdog timer - if storage.onChanged doesn't arrive in time,
  // _handleWatchdogTimeout will re-read storage explicitly
  _startStorageWatchdog(expectedSaveId);
}

/**
 * Check if message type is an operation confirmation
 * v1.6.3.7-v7 - FIX Issue #7: Support operation confirmation messages
 * @private
 * @param {string} type - Message type
 * @returns {boolean} True if this is an operation confirmation
 */
function _isOperationConfirmation(type) {
  const confirmationTypes = [
    'MINIMIZE_CONFIRMED',
    'RESTORE_CONFIRMED',
    'DELETE_CONFIRMED',
    'UPDATE_CONFIRMED',
    'ADOPT_CONFIRMED',
    'CLEAR_ALL_CONFIRMED'
  ];
  return confirmationTypes.includes(type);
}

/**
 * Handle operation confirmation from background
 * v1.6.3.7-v7 - FIX Issue #7: Process confirmations and trigger UI update
 * @private
 * @param {Object} message - Confirmation message
 */
function _handleOperationConfirmation(message) {
  const { type, quickTabId, correlationId, success, error } = message;

  // Default success to true if not explicitly false (confirmation messages typically indicate success)
  const isSuccess = success !== false;

  console.log('[Manager] [PORT] OPERATION_CONFIRMED:', {
    type,
    quickTabId,
    correlationId,
    success: isSuccess,
    error: error || null,
    timestamp: Date.now()
  });

  // If there's a pending acknowledgment for this correlationId, resolve it
  if (correlationId && pendingAcks.has(correlationId)) {
    const pending = pendingAcks.get(correlationId);
    clearTimeout(pending.timeout);
    pending.resolve({ success: isSuccess, type, quickTabId });
    pendingAcks.delete(correlationId);
  }

  // Schedule render to reflect the confirmed operation
  scheduleRender(`port-${type}`, message.messageId);
}

/**
 * Handle QUICK_TAB_STATE_UPDATED message from port
 * v1.6.3.7-v4 - FIX Issue #9: Extracted for complexity reduction
 * v1.6.3.7-v5 - FIX Issue #3: Enhanced path logging
 * @private
 * @param {Object} message - State update message
 */
function _handleQuickTabStateUpdate(message) {
  console.log('[Manager] PORT_STATE_UPDATE_RECEIVED:', {
    quickTabId: message.quickTabId,
    changes: message.changes,
    messageId: message.messageId,
    saveId: message.saveId,
    path: 'port-connection' // v1.6.3.7-v5 - FIX Issue #3: Explicit path
  });

  handleStateUpdateBroadcast(message);
  scheduleRender('port-QUICK_TAB_STATE_UPDATED', message.messageId);
}

/**
 * Handle acknowledgment from background
 * v1.6.3.6-v11 - FIX Issue #10: Complete pending operation
 * @param {Object} ack - Acknowledgment message
 */
function handleAcknowledgment(ack) {
  const { correlationId, success, originalType } = ack;

  const pending = pendingAcks.get(correlationId);
  if (!pending) {
    console.warn('[Manager] Received ack for unknown correlationId:', correlationId);
    return;
  }

  // Clear timeout
  clearTimeout(pending.timeout);

  // Resolve promise
  if (success) {
    pending.resolve(ack);
  } else {
    pending.reject(new Error(ack.error || 'Operation failed'));
  }

  // Clean up
  pendingAcks.delete(correlationId);

  console.log('[Manager] ✅ Acknowledgment received:', {
    correlationId,
    originalType,
    success,
    roundTripMs: Date.now() - pending.sentAt
  });
}

/**
 * Handle broadcast messages from background
 * v1.6.3.6-v11 - FIX Issue #19: Handle visibility state sync
 * v1.6.4.0 - FIX Issue B: Route all renders through scheduleRender()
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * @param {Object} message - Broadcast message
 */
function handleBroadcast(message) {
  const { action, messageId } = message;

  switch (action) {
    case 'VISIBILITY_CHANGE':
      console.log('[Manager] Received visibility change broadcast:', message);
      // v1.6.4.0 - FIX Issue B: Route through unified entry point
      scheduleRender('broadcast-VISIBILITY_CHANGE', messageId);
      break;

    case 'TAB_LIFECYCLE_CHANGE':
      console.log('[Manager] Received tab lifecycle broadcast:', message);
      // Refresh browser tab info cache for affected tabs
      if (message.tabId) {
        browserTabInfoCache.delete(message.tabId);
      }
      // v1.6.4.0 - FIX Issue B: Route through unified entry point
      scheduleRender('broadcast-TAB_LIFECYCLE_CHANGE', messageId);
      break;

    default:
      console.log('[Manager] Received broadcast:', message);
  }
}

/**
 * Handle state update broadcasts
 * v1.6.3.6-v11 - FIX Issue #19: State sync via port
 * v1.6.4.0 - FIX Issue B: No longer calls renderUI directly - caller must route through scheduleRender
 * @param {Object} message - State update message
 */
function handleStateUpdateBroadcast(message) {
  const { quickTabId, changes } = message.payload || message;

  if (quickTabId && changes) {
    handleStateUpdateMessage(quickTabId, changes);
    // v1.6.4.0 - FIX Issue B: renderUI() removed - caller (handlePortMessage) now routes through scheduleRender()
  }
}

/**
 * Send message via port with acknowledgment tracking
 * v1.6.3.6-v11 - FIX Issue #10: Request-acknowledgment pattern
 * @param {Object} message - Message to send
 * @returns {Promise<Object>} Acknowledgment response
 */
function sendWithAck(message) {
  return new Promise((resolve, reject) => {
    if (!backgroundPort) {
      reject(new Error('No port connection'));
      return;
    }

    const correlationId = generateCorrelationId();
    const messageWithCorrelation = {
      ...message,
      correlationId,
      timestamp: Date.now()
    };

    // Set up timeout fallback
    const timeout = setTimeout(() => {
      pendingAcks.delete(correlationId);
      console.warn('[Manager] Acknowledgment timeout for:', correlationId);

      // Fallback: trigger re-render anyway
      renderUI();

      // Resolve with timeout indicator
      resolve({ success: true, timedOut: true, correlationId });
    }, ACK_TIMEOUT_MS);

    // Store pending ack
    pendingAcks.set(correlationId, {
      resolve,
      reject,
      timeout,
      sentAt: Date.now()
    });

    // Send message
    try {
      backgroundPort.postMessage(messageWithCorrelation);
      console.log('[Manager] Sent message with ack request:', {
        type: message.type,
        action: message.action,
        correlationId
      });
    } catch (err) {
      clearTimeout(timeout);
      pendingAcks.delete(correlationId);
      reject(err);
    }
  });
}

/**
 * Send ACTION_REQUEST via port
 * v1.6.3.6-v11 - FIX Issue #15: Typed messages
 * Note: Prefixed with _ as it's prepared for future use but not yet integrated
 * @param {string} action - Action name
 * @param {Object} payload - Action payload
 * @returns {Promise<Object>} Response
 */
function _sendActionRequest(action, payload) {
  return sendWithAck({
    type: 'ACTION_REQUEST',
    action,
    payload,
    source: 'sidebar'
  });
}

// ==================== END PORT CONNECTION ====================

// ==================== v1.6.3.8-v5 BROADCAST CHANNEL REMOVED ====================
// ARCHITECTURE: BroadcastChannel removed per architecture-redesign.md
// The new architecture uses:
// - Layer 1a: runtime.Port for real-time metadata sync (PRIMARY)
// - Layer 2: storage.local with monotonic revision versioning + storage.onChanged (FALLBACK)
//
// BroadcastChannel was removed because:
// 1. Firefox Sidebar runs in separate origin context - BC messages never arrive
// 2. Cross-origin iframes cannot receive BC messages due to W3C spec origin isolation
// 3. Port-based messaging is more reliable and works across all contexts
// 4. storage.onChanged provides reliable fallback for all scenarios
//
// All BC functions below are kept as NO-OP stubs for backwards compatibility.

// eslint-disable-next-line no-unused-vars -- BC removed, kept for compatibility
let broadcastHandlerRef = null;

// eslint-disable-next-line no-unused-vars -- BC removed, kept for compatibility
let bcVerificationPending = false;
// eslint-disable-next-line no-unused-vars -- BC removed, kept for compatibility
let bcVerificationReceived = false;
// eslint-disable-next-line no-unused-vars -- BC removed, kept for compatibility
let bcVerificationTimeoutId = null;

// eslint-disable-next-line no-unused-vars -- BC removed, kept for compatibility
const BC_VERIFICATION_TIMEOUT_MS = 1000;

/**
 * Initialize BroadcastChannel for real-time updates
 * v1.6.3.8-v5 - NO-OP STUB: BroadcastChannel removed per architecture-redesign.md
 * The new architecture uses Port + storage.onChanged instead.
 */
function initializeBroadcastChannel() {
  console.log('[Manager] [BC] DEPRECATED: initializeBroadcastChannel called - BC removed per architecture-redesign.md');
  console.log('[Manager] [BC] Using Port-based messaging (PRIMARY) + storage.onChanged (FALLBACK)');
  // BC removed - just log and return
  // All state sync now happens via Port + storage.onChanged
}

/**
 * Start BroadcastChannel verification handshake
 * v1.6.3.8-v5 - NO-OP STUB: BC removed per architecture-redesign.md
 * @private
 */
function _startBCVerificationHandshake() {
  // NO-OP - BC removed
  console.log('[Manager] [BC] DEPRECATED: _startBCVerificationHandshake called - BC removed');
}

/**
 * Handle BC verification timeout
 * v1.6.3.8-v5 - NO-OP STUB: BC removed per architecture-redesign.md
 * @private
 */
function _handleBCVerificationTimeout() {
  // NO-OP - BC removed
}

/**
 * Handle BC verification PONG received
 * v1.6.3.8-v5 - NO-OP STUB: BC removed per architecture-redesign.md
 * @param {Object} message - PONG message from background
 * @private
 */
function _handleBCVerificationPong(_message) {
  // NO-OP - BC removed
}

// ==================== v1.6.3.7-v12/v13 FALLBACK HEALTH MONITORING ====================
// v1.6.3.8-v5 - NOTE: "Fallback" now refers to storage.onChanged (Port is PRIMARY)
// Issue #5: Periodic fallback status logging when BC is unavailable
// Issue #12: Enhanced health monitoring with stall detection and latency tracking
// Issue #6 (arch): Storage tier health instrumentation

/**
 * Fallback health monitoring interval ID
 * v1.6.3.7-v12 - Issue #5: Track interval for cleanup
 */
let fallbackHealthIntervalId = null;

/**
 * Storage health probe interval ID
 * v1.6.3.7-v13 - Issue #6 (arch): Track storage probe interval
 */
let storageHealthProbeIntervalId = null;

/**
 * Fallback statistics for health monitoring
 * v1.6.3.7-v12 - Issue #5: Track state updates received via fallback
 * v1.6.3.7-v13 - Issue #12: Enhanced with latency tracking
 * v1.6.3.8-v3 - FIX Issue #20: Added reset function for clean cycle separation
 */
const fallbackStats = {
  stateUpdatesReceived: 0,
  lastUpdateTime: 0,
  portMessagesReceived: 0,
  storageEventsReceived: 0,
  startTime: Date.now(),
  // v1.6.3.7-v13 - Issue #12: Latency tracking
  latencySum: 0,
  latencyCount: 0,
  lastLatencyMs: 0
};

/**
 * Reset fallback stats for a new monitoring cycle
 * v1.6.3.8-v3 - FIX Issue #20: Clear all counters to prevent cross-cycle accumulation
 * @private
 */
function _resetFallbackStats() {
  const previousStats = { ...fallbackStats };
  
  fallbackStats.stateUpdatesReceived = 0;
  fallbackStats.lastUpdateTime = 0;
  fallbackStats.portMessagesReceived = 0;
  fallbackStats.storageEventsReceived = 0;
  fallbackStats.startTime = Date.now();
  fallbackStats.latencySum = 0;
  fallbackStats.latencyCount = 0;
  fallbackStats.lastLatencyMs = 0;
  
  console.log('[Manager] FALLBACK_STATS_RESET:', {
    previousCycle: {
      stateUpdatesReceived: previousStats.stateUpdatesReceived,
      portMessages: previousStats.portMessagesReceived,
      storageEvents: previousStats.storageEventsReceived,
      durationMs: Date.now() - previousStats.startTime
    },
    timestamp: Date.now()
  });
}

/**
 * Storage health probe statistics
 * v1.6.3.7-v13 - Issue #6 (arch): Track storage tier health
 * v1.6.3.8-v3 - FIX Issue #17: Added probeInProgress flag to prevent concurrent probes
 */
const storageHealthStats = {
  probesSent: 0,
  probesReceived: 0,
  lastProbeTime: 0,
  lastProbeLatencyMs: 0,
  avgLatencyMs: 0,
  latencySum: 0,
  lastSuccessfulProbe: 0,
  consecutiveFailures: 0,
  // v1.6.3.8-v3 - FIX Issue #17: Guard flag to prevent concurrent probes
  probeInProgress: false
};

/**
 * Fallback health check interval (30 seconds)
 * v1.6.3.7-v12 - Issue #5: Log fallback status periodically
 */
const FALLBACK_HEALTH_CHECK_INTERVAL_MS = 30000;

/**
 * Stall detection threshold (60 seconds)
 * v1.6.3.7-v13 - Issue #12: Warn if no updates received for this long
 */
const FALLBACK_STALL_THRESHOLD_MS = 60000;

/**
 * Storage health probe interval (30 seconds)
 * v1.6.3.7-v13 - Issue #6 (arch): Check storage tier health periodically
 */
const STORAGE_HEALTH_PROBE_INTERVAL_MS = 30000;

/**
 * Storage health probe timeout (500ms)
 * v1.6.3.7-v13 - Issue #6 (arch): Max wait for probe response
 */
const STORAGE_HEALTH_PROBE_TIMEOUT_MS = 500;

/**
 * Storage health probe key
 * v1.6.3.7-v13 - Issue #6 (arch): Dedicated key for health probes
 */
const STORAGE_HEALTH_PROBE_KEY = '_sidebar_health_ping';

/**
 * Track if fallback mode is active
 * v1.6.3.7-v13 - Issue #5, #12: Used for UI badge display
 */
let fallbackModeActive = false;

/**
 * Start fallback health monitoring
 * v1.6.3.7-v12 - Issue #5: Log periodic fallback status when BC unavailable
 * v1.6.3.7-v13 - Issue #12: Enhanced with stall detection and degraded warnings
 * v1.6.3.8-v3 - FIX Issue #20: Reset stats at start for clean cycle separation
 * @private
 */
function _startFallbackHealthMonitoring() {
  if (fallbackHealthIntervalId) {
    clearInterval(fallbackHealthIntervalId);
  }

  // v1.6.3.8-v3 - FIX Issue #20: Reset stats at start of new monitoring cycle
  _resetFallbackStats();
  fallbackModeActive = true;

  // v1.6.3.7-v13 - Issue #6 (arch): Also start storage health probing
  _startStorageHealthProbe();

  fallbackHealthIntervalId = setInterval(() => {
    _logFallbackHealthStatus();
  }, FALLBACK_HEALTH_CHECK_INTERVAL_MS);

  console.log(
    '[Manager] FALLBACK_SESSION_START: using [port-based + storage.onChanged], will check fallback health every 30s',
    {
      healthCheckIntervalMs: FALLBACK_HEALTH_CHECK_INTERVAL_MS,
      stallThresholdMs: FALLBACK_STALL_THRESHOLD_MS,
      storageProbeIntervalMs: STORAGE_HEALTH_PROBE_INTERVAL_MS,
      timestamp: Date.now()
    }
  );
}

/**
 * Log fallback health status with stall detection
 * v1.6.3.7-v13 - Issue #12: Extracted for clarity with enhanced monitoring
 * @private
 */
function _logFallbackHealthStatus() {
  const now = Date.now();
  const elapsedMs = now - fallbackStats.startTime;
  const timeSinceLastUpdate =
    fallbackStats.lastUpdateTime > 0 ? now - fallbackStats.lastUpdateTime : elapsedMs;

  // Calculate average time between updates
  const avgTimeBetweenUpdatesMs =
    fallbackStats.stateUpdatesReceived > 0
      ? Math.round(elapsedMs / fallbackStats.stateUpdatesReceived)
      : null;

  // Calculate average latency
  const avgLatencyMs =
    fallbackStats.latencyCount > 0
      ? Math.round(fallbackStats.latencySum / fallbackStats.latencyCount)
      : null;

  // Expected updates: ~6 per interval if state changes every 5s
  const expectedUpdates = Math.floor(FALLBACK_HEALTH_CHECK_INTERVAL_MS / 5000);

  // v1.6.3.7-v13 - Issue #12: Detect stall condition
  const isStalled = timeSinceLastUpdate >= FALLBACK_STALL_THRESHOLD_MS;

  if (isStalled) {
    console.warn(
      '[Manager] FALLBACK_STALLED: no state updates for 60+ seconds, fallback may be broken',
      {
        timeSinceLastUpdateMs: timeSinceLastUpdate,
        thresholdMs: FALLBACK_STALL_THRESHOLD_MS,
        portMessagesReceived: fallbackStats.portMessagesReceived,
        storageEventsReceived: fallbackStats.storageEventsReceived,
        connectionState,
        lastUpdateTime:
          fallbackStats.lastUpdateTime > 0
            ? new Date(fallbackStats.lastUpdateTime).toISOString()
            : 'never',
        timestamp: now
      }
    );
  }

  // v1.6.3.7-v13 - Issue #12: Log health status with all metrics
  console.log('[Manager] FALLBACK_HEALTH:', {
    receivedMessages: fallbackStats.stateUpdatesReceived,
    expectedPerInterval: expectedUpdates,
    avgLatencyMs,
    lastLatencyMs: fallbackStats.lastLatencyMs,
    lastUpdateAgoMs: timeSinceLastUpdate,
    isStalled,
    broadcastChannelAvailable: false,
    fallbackActive: true,
    portMessages: fallbackStats.portMessagesReceived,
    storageEvents: fallbackStats.storageEventsReceived,
    lastUpdateTime:
      fallbackStats.lastUpdateTime > 0
        ? new Date(fallbackStats.lastUpdateTime).toISOString()
        : 'never',
    avgTimeBetweenUpdatesMs,
    uptimeMs: elapsedMs,
    storageHealthy: storageHealthStats.consecutiveFailures === 0,
    timestamp: now
  });
}

/**
 * Stop fallback health monitoring
 * v1.6.3.7-v13 - Issue #12: Cleanup on channel recovery
 * v1.6.3.8-v3 - FIX Issue #20: Log final session stats before stopping
 * @private
 */
function _stopFallbackHealthMonitoring() {
  if (fallbackHealthIntervalId) {
    clearInterval(fallbackHealthIntervalId);
    fallbackHealthIntervalId = null;
    
    // v1.6.3.8-v3 - FIX Issue #20: Log final stats for this session
    const sessionDurationMs = Date.now() - fallbackStats.startTime;
    const avgLatencyMs = fallbackStats.latencyCount > 0
      ? Math.round(fallbackStats.latencySum / fallbackStats.latencyCount)
      : 0;
    
    console.log('[Manager] FALLBACK_SESSION_ENDED:', {
      sessionDurationMs,
      totalStateUpdates: fallbackStats.stateUpdatesReceived,
      portMessages: fallbackStats.portMessagesReceived,
      storageEvents: fallbackStats.storageEventsReceived,
      avgLatencyMs,
      lastLatencyMs: fallbackStats.lastLatencyMs,
      timestamp: Date.now()
    });
  }
  _stopStorageHealthProbe();
  fallbackModeActive = false;
  console.log('[Manager] Fallback health monitoring stopped');
}

/**
 * Start storage health probe
 * v1.6.3.7-v13 - Issue #6 (arch): Periodic storage tier health check
 * @private
 */
function _startStorageHealthProbe() {
  if (storageHealthProbeIntervalId) {
    clearInterval(storageHealthProbeIntervalId);
  }

  // Set up listener for probe responses
  _setupStorageHealthProbeListener();

  // Send initial probe
  _sendStorageHealthProbe();

  // Schedule periodic probes
  storageHealthProbeIntervalId = setInterval(() => {
    _sendStorageHealthProbe();
  }, STORAGE_HEALTH_PROBE_INTERVAL_MS);

  console.log(
    `[Manager] Storage health probe started (every ${STORAGE_HEALTH_PROBE_INTERVAL_MS / 1000}s)`
  );
}

/**
 * Stop storage health probe
 * v1.6.3.7-v13 - Issue #6 (arch): Cleanup
 * @private
 */
function _stopStorageHealthProbe() {
  if (storageHealthProbeIntervalId) {
    clearInterval(storageHealthProbeIntervalId);
    storageHealthProbeIntervalId = null;
  }
}

/**
 * Set up listener for storage health probe responses
 * v1.6.3.7-v13 - Issue #6 (arch): Listen for our own probe writes
 * @private
 */
function _setupStorageHealthProbeListener() {
  // This is called once during init - the actual listener is in setupEventListeners
  // We just track the state here
  console.log('[Manager] Storage health probe listener ready');
}

/**
 * Send a storage health probe
 * v1.6.3.7-v13 - Issue #6 (arch): Write timestamp to storage and measure round-trip
 * v1.6.3.8-v3 - FIX Issue #17: Added guard to prevent concurrent probes
 * v1.6.3.8-v4 - FIX Issue #8: Track lastProbeTime, queue next probe, force-reset timeout
 * @private
 */
async function _sendStorageHealthProbe() {
  const now = Date.now();
  
  // v1.6.3.8-v4 - FIX Issue #8: Enforce minimum interval between probes
  const timeSinceLastProbe = lastProbeStartTime > 0 ? now - lastProbeStartTime : PROBE_MIN_INTERVAL_MS + 1;
  if (timeSinceLastProbe < PROBE_MIN_INTERVAL_MS) {
    console.log('[Manager] STORAGE_HEALTH_PROBE_THROTTLED: too soon since last probe', {
      lastProbeTime: lastProbeStartTime,
      timeSinceLastProbeMs: timeSinceLastProbe,
      minIntervalMs: PROBE_MIN_INTERVAL_MS,
      timestamp: now
    });
    // Queue next probe for later
    setTimeout(_sendStorageHealthProbe, PROBE_MIN_INTERVAL_MS - timeSinceLastProbe + 100);
    return;
  }
  
  // v1.6.3.8-v3 - FIX Issue #17: Prevent concurrent health probes
  if (storageHealthStats.probeInProgress) {
    // v1.6.3.8-v4 - FIX Issue #8: Check if probe is stuck and force-reset if needed
    const probeRunTime = now - lastProbeStartTime;
    if (probeRunTime > PROBE_FORCE_RESET_MS) {
      console.warn('[Manager] STORAGE_HEALTH_PROBE_FORCE_RESET: probe stuck, resetting flag', {
        probeRunTimeMs: probeRunTime,
        forceResetThresholdMs: PROBE_FORCE_RESET_MS,
        lastProbeTime: lastProbeStartTime,
        timestamp: now
      });
      storageHealthStats.probeInProgress = false;
      storageHealthStats.consecutiveFailures++;
    } else {
      console.log('[Manager] STORAGE_HEALTH_PROBE_SKIPPED: probe already in progress', {
        lastProbeTime: storageHealthStats.lastProbeTime,
        probeRunTimeMs: probeRunTime,
        timestamp: now
      });
      // Queue next probe for 100ms later instead of just skipping
      setTimeout(_sendStorageHealthProbe, 100);
      return;
    }
  }
  
  storageHealthStats.probeInProgress = true;
  lastProbeStartTime = now;
  const probeTimestamp = now;
  storageHealthStats.probesSent++;
  storageHealthStats.lastProbeTime = probeTimestamp;

  // Set up timeout for probe response
  const timeoutId = setTimeout(() => {
    _handleStorageProbeTimeout(probeTimestamp);
  }, STORAGE_HEALTH_PROBE_TIMEOUT_MS);

  try {
    // Write probe timestamp to storage
    await browser.storage.local.set({
      [STORAGE_HEALTH_PROBE_KEY]: {
        timestamp: probeTimestamp,
        source: 'sidebar-health-probe'
      }
    });

    // Store timeout ID for cleanup
    storageHealthStats._currentProbeTimeoutId = timeoutId;

    if (DEBUG_MESSAGING) {
      console.log('[Manager] STORAGE_HEALTH_PROBE_SENT:', {
        probeTimestamp,
        probesSent: storageHealthStats.probesSent,
        timestamp: Date.now()
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    // v1.6.3.8-v3 - FIX Issue #17: Clear probe in progress on failure
    storageHealthStats.probeInProgress = false;
    console.error('[Manager] STORAGE_HEALTH_PROBE_FAILED:', {
      error: err.message,
      timestamp: Date.now()
    });
    storageHealthStats.consecutiveFailures++;
  }
}

/**
 * Handle storage health probe response (called from storage.onChanged)
 * v1.6.3.7-v13 - Issue #6 (arch): Measure round-trip latency
 * v1.6.3.8-v3 - FIX Issue #17: Clear probeInProgress flag on response
 * @param {number} probeTimestamp - Original probe timestamp
 * @private
 */
function _handleStorageProbeResponse(probeTimestamp) {
  const now = Date.now();
  const latencyMs = now - probeTimestamp;

  // v1.6.3.8-v3 - FIX Issue #17: Clear probe in progress flag
  storageHealthStats.probeInProgress = false;

  // Clear any pending timeout
  if (storageHealthStats._currentProbeTimeoutId) {
    clearTimeout(storageHealthStats._currentProbeTimeoutId);
    storageHealthStats._currentProbeTimeoutId = null;
  }

  storageHealthStats.probesReceived++;
  storageHealthStats.lastProbeLatencyMs = latencyMs;
  storageHealthStats.latencySum += latencyMs;
  storageHealthStats.avgLatencyMs = Math.round(
    storageHealthStats.latencySum / storageHealthStats.probesReceived
  );
  storageHealthStats.lastSuccessfulProbe = now;
  storageHealthStats.consecutiveFailures = 0;

  // Classify health based on latency
  const healthStatus = latencyMs < 100 ? 'healthy' : latencyMs < 500 ? 'acceptable' : 'degraded';

  if (DEBUG_MESSAGING) {
    console.log(`[Manager] Storage Tier Latency: ${latencyMs}ms (${healthStatus})`, {
      probeTimestamp,
      latencyMs,
      avgLatencyMs: storageHealthStats.avgLatencyMs,
      probesReceived: storageHealthStats.probesReceived,
      healthStatus,
      timestamp: now
    });
  }
}

/**
 * Handle storage probe timeout
 * v1.6.3.7-v13 - Issue #6 (arch): storage.onChanged didn't fire in time
 * v1.6.3.8-v4 - FIX Issue #8: Clear probeInProgress flag on timeout
 * @param {number} probeTimestamp - Original probe timestamp
 * @private
 */
function _handleStorageProbeTimeout(probeTimestamp) {
  // v1.6.3.8-v4 - FIX Issue #8: Clear probeInProgress flag on timeout
  storageHealthStats.probeInProgress = false;
  storageHealthStats.consecutiveFailures++;
  storageHealthStats._currentProbeTimeoutId = null;

  console.warn('[Manager] STORAGE_TIER_BROKEN: onChanged not firing', {
    probeTimestamp,
    timeoutMs: STORAGE_HEALTH_PROBE_TIMEOUT_MS,
    consecutiveFailures: storageHealthStats.consecutiveFailures,
    lastSuccessfulProbe:
      storageHealthStats.lastSuccessfulProbe > 0
        ? new Date(storageHealthStats.lastSuccessfulProbe).toISOString()
        : 'never',
    timestamp: Date.now()
  });
}

/**
 * Track fallback state update received
 * v1.6.3.7-v12 - Issue #5: Increment counters for health monitoring
 * v1.6.3.7-v13 - Issue #12: Enhanced with latency tracking
 * @param {string} source - Source of update ('port' or 'storage')
 * @param {number} [latencyMs] - Optional latency measurement
 */
function _trackFallbackUpdate(source, latencyMs = null) {
  const now = Date.now();
  fallbackStats.stateUpdatesReceived++;
  fallbackStats.lastUpdateTime = now;

  if (source === 'port') {
    fallbackStats.portMessagesReceived++;
  } else if (source === 'storage') {
    fallbackStats.storageEventsReceived++;
  }

  // v1.6.3.7-v13 - Issue #12: Track latency if provided
  if (latencyMs !== null && latencyMs >= 0) {
    fallbackStats.latencySum += latencyMs;
    fallbackStats.latencyCount++;
    fallbackStats.lastLatencyMs = latencyMs;
  }
}

/**
 * Handle messages from BroadcastChannel
 * v1.6.3.8-v5 - DEPRECATED: BC removed per architecture-redesign.md
 * This function is kept for backwards compatibility but is never called.
 * @param {MessageEvent} _event - BroadcastChannel message event
 * @deprecated BC removed - function kept for backwards compatibility
 */
// eslint-disable-next-line no-unused-vars -- BC removed, kept for compatibility
function handleBroadcastChannelMessage(_event) {
  // NO-OP - BC removed
  console.log('[Manager] [BC] DEPRECATED: handleBroadcastChannelMessage called - BC removed');
}

/**
 * Check BroadcastChannel health and trigger fallback if needed
 * v1.6.3.7-v10 - FIX ESLint: Extracted to reduce handleBroadcastChannelMessage complexity
 * @private
 * @param {Object} message - Message being processed
 */
function _checkBroadcastChannelHealth(message) {
  // Check if BroadcastChannel is stale
  if (isBroadcastChannelStale()) {
    console.warn(
      '[Manager] [BC] STALE_CHANNEL_DETECTED: BroadcastChannel is stale, triggering storage fallback'
    );
    console.log('[Manager] STORAGE_FALLBACK_ACTIVATED:', {
      reason: 'stale-broadcast-channel',
      timestamp: Date.now()
    });
    _triggerStorageFallbackOnGap(0);
    return;
  }

  // Check for sequence gap if sequenceNumber present
  if (typeof message.sequenceNumber === 'number') {
    _checkSequenceGap(message);
  }
}

/**
 * Check for sequence gap in message
 * v1.6.3.7-v10 - FIX ESLint: Extracted to reduce complexity
 * @private
 * @param {Object} message - Message with sequenceNumber
 */
function _checkSequenceGap(message) {
  const seqResult = processReceivedSequence(message.sequenceNumber);
  if (!seqResult.hasGap) return;

  const expectedSeq = message.sequenceNumber - seqResult.gapSize;
  console.warn('[Manager] [BC] SEQUENCE_GAP_DETECTED:', {
    expectedSequence: expectedSeq,
    receivedSequence: message.sequenceNumber,
    gapSize: seqResult.gapSize,
    type: message.type,
    quickTabId: message.quickTabId
  });
  console.log('[Manager] STORAGE_FALLBACK_ACTIVATED:', {
    reason: 'sequence-gap',
    gapSize: seqResult.gapSize,
    timestamp: Date.now()
  });
  _triggerStorageFallbackOnGap(seqResult.gapSize);
}

/**
 * Generate message ID and correlation ID for broadcast message
 * v1.6.3.7-v10 - FIX ESLint: Extracted to reduce handleBroadcastChannelMessage complexity
 * @private
 * @param {Object} message - Broadcast message
 * @param {number} messageEntryTime - Timestamp when message was received
 * @returns {{ broadcastMessageId: string, correlationId: string }}
 */
function _generateBroadcastMessageIds(message, messageEntryTime) {
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const broadcastMessageId =
    message.messageId ||
    `bc-${message.type}-${message.quickTabId}-${message.timestamp || Date.now()}-${randomSuffix}`;
  const correlationId = message.correlationId || `bc-${messageEntryTime}-${randomSuffix}`;
  return { broadcastMessageId, correlationId };
}

/**
 * Log broadcast message processed with duration
 * v1.6.3.7-v10 - FIX ESLint: Extracted to reduce handleBroadcastChannelMessage complexity
 * @private
 * @param {Object} message - Processed message
 * @param {string} correlationId - Correlation ID
 * @param {number} messageEntryTime - Timestamp when message was received
 */
function _logBroadcastMessageProcessed(message, correlationId, messageEntryTime) {
  if (!DEBUG_MESSAGING) return;

  const processingDurationMs = Date.now() - messageEntryTime;
  console.log(`[Manager] MESSAGE_PROCESSED [BC] [${message.type}]:`, {
    quickTabId: message.quickTabId,
    correlationId,
    durationMs: processingDurationMs,
    timestamp: Date.now()
  });
}

/**
 * Trigger storage fallback read when sequence gap is detected
 * v1.6.3.7-v9 - Issue #7: Recover from message loss via storage read
 * @private
 * @param {number} gapSize - Number of missed messages
 */
async function _triggerStorageFallbackOnGap(gapSize) {
  console.log('[Manager] [BC] STORAGE_FALLBACK_TRIGGERED:', {
    reason: 'sequence-gap',
    gapSize,
    timestamp: Date.now()
  });

  try {
    // Read full state from storage to recover any missed updates
    const result = await browser.storage.local.get('quick_tabs_state_v2');
    const state = result?.quick_tabs_state_v2;

    if (state?.tabs) {
      console.log('[Manager] [BC] STORAGE_FALLBACK_SUCCESS:', {
        tabCount: state.tabs.length,
        saveId: state.saveId
      });

      // Update local state
      quickTabsState.tabs = [...state.tabs];
      quickTabsState.saveId = state.saveId;
      quickTabsState.timestamp = state.timestamp || Date.now();

      // Update cache and trigger render
      _updateInMemoryCache(state.tabs);
      lastLocalUpdateTime = Date.now();
      scheduleRender('storage-fallback');
    }
  } catch (err) {
    console.error('[Manager] [BC] STORAGE_FALLBACK_FAILED:', {
      error: err.message
    });
  }
}

/**
 * Route broadcast message to appropriate handler
 * v1.6.3.7-v4 - FIX Complexity: Extracted from handleBroadcastChannelMessage
 * v1.6.3.7-v7 - FIX Issue #6: Added full-state-sync handler
 * v1.6.3.7-v13 - Issue #1 (arch): Added BC_VERIFICATION_PONG handling
 * @private
 * @param {Object} message - BroadcastChannel message
 * @param {string} messageId - Generated message ID for deduplication
 */
function _routeBroadcastMessage(message, messageId) {
  // v1.6.3.7-v13 - Issue #1 (arch): Handle verification PONG first
  if (message.type === 'BC_VERIFICATION_PONG') {
    _handleBCVerificationPong(message);
    return;
  }

  const handlers = {
    'quick-tab-created': handleBroadcastCreate,
    'quick-tab-updated': handleBroadcastUpdate,
    'quick-tab-deleted': handleBroadcastDelete,
    'quick-tab-minimized': handleBroadcastMinimizeRestore,
    'quick-tab-restored': handleBroadcastMinimizeRestore,
    'full-state-sync': handleBroadcastFullStateSync
  };

  const handler = handlers[message.type];
  if (handler) {
    handler(message, messageId);
  } else {
    // v1.6.3.7-v7 - FIX Issue #7: Use consistent [BC] prefix for BroadcastChannel messages
    console.log('[Manager] [BC] UNKNOWN_MESSAGE_TYPE:', {
      type: message.type,
      quickTabId: message.quickTabId,
      messageId,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle full-state-sync broadcast
 * v1.6.3.7-v7 - FIX Issue #6: Handle full state sync from background
 * This provides instant state updates after storage writes
 * @param {Object} message - Broadcast message with state and saveId
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastFullStateSync(message, messageId) {
  const { state, saveId } = message;

  if (!state || !state.tabs) {
    console.log('[Manager] [BC] Invalid full-state-sync message, skipping');
    return;
  }

  // Check saveId deduplication
  if (saveId && saveId === lastProcessedSaveId) {
    console.log('[Manager] [BC] full-state-sync DEDUP_SKIPPED:', {
      saveId,
      reason: 'already processed'
    });
    return;
  }

  console.log('[Manager] [BC] FULL_STATE_SYNC received:', {
    tabCount: state.tabs.length,
    saveId,
    messageId
  });

  // Update local state with full state
  // v1.6.3.7-v7 - FIX Code Review: Use defensive copy to avoid shared reference issues
  quickTabsState.tabs = [...state.tabs];
  quickTabsState.saveId = saveId;
  quickTabsState.timestamp = state.timestamp || Date.now();

  // Update cache
  _updateInMemoryCache(state.tabs);
  lastLocalUpdateTime = Date.now();

  // Track processed saveId
  if (saveId) {
    lastProcessedSaveId = saveId;
    lastSaveIdProcessedAt = Date.now();
  }

  console.log('[Manager] [BC] Full state sync applied:', {
    tabCount: state.tabs.length,
    saveId
  });

  // Schedule render
  scheduleRender('broadcast-full-state-sync', messageId);
}

/**
 * Handle quick-tab-created broadcast
 * v1.6.3.7-v3 - API #2: Add new Quick Tab to state
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * v1.6.4.18 - Refactored to use shared helper to reduce code duplication
 * @param {Object} message - Broadcast message with data
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastCreate(message, messageId) {
  const { quickTabId, data } = message;

  if (!quickTabId || !data) {
    return;
  }

  // Check if already exists
  const existingIdx = _findTabIndex(quickTabId);
  if (existingIdx >= 0) {
    console.log('[Manager] Quick Tab already exists, skipping create:', quickTabId);
    return;
  }

  // Add to state
  if (!quickTabsState.tabs) {
    quickTabsState.tabs = [];
  }
  quickTabsState.tabs.push(data);
  _updateStateAfterMutation();

  console.log('[Manager] BROADCAST_CREATE: added Quick Tab:', quickTabId);
  scheduleRender('broadcast-create', messageId);
}

/**
 * Handle quick-tab-updated broadcast
 * v1.6.3.7-v3 - API #2: Update existing Quick Tab
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * v1.6.4.18 - Refactored to use shared helpers to reduce code duplication
 * @param {Object} message - Broadcast message with changes
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastUpdate(message, messageId) {
  const { quickTabId, changes } = message;

  if (!quickTabId || !changes) {
    return;
  }

  // Find the tab
  const tabIdx = _findTabIndex(quickTabId);
  if (tabIdx < 0) {
    console.log('[Manager] Quick Tab not found for update:', quickTabId);
    return;
  }

  // Apply changes
  Object.assign(quickTabsState.tabs[tabIdx], changes);
  _updateStateAfterMutation();

  console.log('[Manager] BROADCAST_UPDATE: updated Quick Tab:', quickTabId, changes);
  scheduleRender('broadcast-update', messageId);
}

/**
 * Handle quick-tab-deleted broadcast
 * v1.6.3.7-v3 - API #2: Remove Quick Tab from state
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * v1.6.4.18 - Refactored to use shared helpers to reduce code duplication
 * @param {Object} message - Broadcast message
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastDelete(message, messageId) {
  const { quickTabId } = message;

  if (!quickTabId) {
    return;
  }

  // Find and remove
  const tabIdx = _findTabIndex(quickTabId);
  if (tabIdx < 0) {
    console.log('[Manager] Quick Tab not found for delete:', quickTabId);
    return;
  }

  quickTabsState.tabs.splice(tabIdx, 1);
  _updateStateAfterMutation();

  console.log('[Manager] BROADCAST_DELETE: removed Quick Tab:', quickTabId);
  scheduleRender('broadcast-delete', messageId);
}

/**
 * Find tab index by quickTabId
 * v1.6.4.18 - Extracted to reduce code duplication in broadcast handlers
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {number} Tab index or -1 if not found
 */
function _findTabIndex(quickTabId) {
  return quickTabsState.tabs?.findIndex(t => t.id === quickTabId) ?? -1;
}

/**
 * Update state timestamps and cache after mutation
 * v1.6.4.18 - Extracted to reduce code duplication in broadcast handlers
 * @private
 */
function _updateStateAfterMutation() {
  quickTabsState.timestamp = Date.now();
  _updateInMemoryCache(quickTabsState.tabs);
  lastLocalUpdateTime = Date.now();
}

/**
 * Handle quick-tab-minimized and quick-tab-restored broadcasts
 * v1.6.3.7-v3 - API #2: Update minimized state
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * @param {Object} message - Broadcast message
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastMinimizeRestore(message, messageId) {
  const { quickTabId, changes } = message;

  if (!quickTabId) {
    return;
  }

  const tabIdx = _findTabIndex(quickTabId);
  if (tabIdx < 0) {
    return;
  }

  // Apply minimized state
  if (changes && 'minimized' in changes) {
    quickTabsState.tabs[tabIdx].minimized = changes.minimized;
    _updateStateAfterMutation();

    console.log('[Manager] BROADCAST_MINIMIZE:', quickTabId, 'minimized=', changes.minimized);
    scheduleRender('broadcast-minimize', messageId);
  }
}

/**
 * Cleanup BroadcastChannel on window unload
 * v1.6.3.8-v5 - NO-OP STUB: BC removed per architecture-redesign.md
 */
function cleanupBroadcastChannel() {
  // NO-OP - BC removed
  console.log('[Manager] [BC] DEPRECATED: cleanupBroadcastChannel called - BC removed');
}

// ==================== END BROADCAST CHANNEL (DEPRECATED) ====================

// ==================== v1.6.3.6-v11 COUNT BADGE ANIMATION ====================
// FIX Issue #20: Diff-based rendering for count badge animation

/**
 * Track previous count values for diff-based animation
 * v1.6.3.6-v11 - FIX Issue #20: Count badge animation
 * Key: groupKey, Value: previous count
 */
const previousGroupCounts = new Map();

/**
 * Animation duration for count badge updates
 * v1.6.3.6-v11 - FIX Issue #20: Count badge animation
 */
const COUNT_BADGE_ANIMATION_MS = 500;

/**
 * Check if group count changed and apply animation class
 * v1.6.3.6-v11 - FIX Issue #20: Diff-based rendering
 * @param {string} groupKey - Group key
 * @param {number} newCount - New tab count
 * @param {HTMLElement} countElement - Count badge element
 */
function animateCountBadgeIfChanged(groupKey, newCount, countElement) {
  const previousCount = previousGroupCounts.get(String(groupKey));

  // Update stored count
  previousGroupCounts.set(String(groupKey), newCount);

  // Skip animation if this is the first render for this group
  if (previousCount === undefined) {
    return;
  }

  // Skip if count hasn't changed
  if (previousCount === newCount) {
    return;
  }

  // Apply animation class
  countElement.classList.add('updated');

  // Add direction indicator for accessibility/styling
  if (newCount > previousCount) {
    countElement.classList.add('count-increased');
  } else {
    countElement.classList.add('count-decreased');
  }

  console.log('[Manager] 🔢 Count badge animated:', {
    groupKey,
    previousCount,
    newCount,
    delta: newCount - previousCount
  });

  // Remove animation class after animation completes
  setTimeout(() => {
    countElement.classList.remove('updated', 'count-increased', 'count-decreased');
  }, COUNT_BADGE_ANIMATION_MS);
}

/**
 * Clear stored counts for removed groups
 * v1.6.3.6-v11 - FIX Issue #20: Clean up stale count tracking
 * @param {Set} currentGroupKeys - Set of current group keys
 */
function cleanupPreviousGroupCounts(currentGroupKeys) {
  for (const key of previousGroupCounts.keys()) {
    if (!currentGroupKeys.has(key)) {
      previousGroupCounts.delete(key);
    }
  }
}

// ==================== END COUNT BADGE ANIMATION ====================

/**
 * Fetch browser tab information with caching (30s TTL)
 * v1.6.3.6-v8 - Browser tab metadata caching
 * @param {number|string} tabId - Browser tab ID
 * @returns {Promise<Object|null>} Tab info or null if tab is closed
 */
async function fetchBrowserTabInfo(tabId) {
  // Handle non-numeric keys (like 'orphaned')
  if (tabId === 'orphaned' || tabId == null) {
    return null;
  }

  const numericTabId = Number(tabId);
  if (isNaN(numericTabId)) {
    return null;
  }

  // Check cache first
  const cached = browserTabInfoCache.get(numericTabId);
  if (cached && Date.now() - cached.timestamp < BROWSER_TAB_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const tabInfo = await browser.tabs.get(numericTabId);
    const data = {
      id: tabInfo.id,
      title: tabInfo.title,
      url: tabInfo.url,
      favIconUrl: tabInfo.favIconUrl
    };

    // Update cache
    browserTabInfoCache.set(numericTabId, {
      data,
      timestamp: Date.now()
    });

    return data;
  } catch (_err) {
    // Tab doesn't exist (closed)
    browserTabInfoCache.set(numericTabId, {
      data: null,
      timestamp: Date.now()
    });
    return null;
  }
}

/**
 * Load collapse state from browser.storage.local
 * v1.6.3.6-v8 - Collapse state persistence
 * @returns {Promise<Object>} Collapse state object (tabId -> boolean)
 */
async function loadCollapseState() {
  try {
    const result = await browser.storage.local.get(COLLAPSE_STATE_KEY);
    return result?.[COLLAPSE_STATE_KEY] || {};
  } catch (err) {
    console.warn('[Manager] Failed to load collapse state:', err);
    return {};
  }
}

/**
 * Save collapse state to browser.storage.local
 * v1.6.3.6-v8 - Collapse state persistence
 * @param {Object} collapseState - Collapse state object (tabId -> boolean)
 */
async function saveCollapseState(collapseState) {
  try {
    await browser.storage.local.set({ [COLLAPSE_STATE_KEY]: collapseState });
  } catch (err) {
    console.warn('[Manager] Failed to save collapse state:', err);
  }
}

// v1.6.3.5-v3 - FIX Architecture Phase 1: Listen for state updates from background
// v1.6.3.5-v11 - FIX Issue #6: Handle QUICK_TAB_DELETED message and deletion via QUICK_TAB_STATE_UPDATED
// v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
// v1.6.3.7-v5 - FIX Issue #9: Wrapped in try-catch for error handling
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // v1.6.3.7-v5 - FIX Issue #9: Wrap entire handler in try-catch
  try {
    return _processRuntimeMessage(message, sendResponse);
  } catch (err) {
    // v1.6.3.7-v5 - FIX Issue #9: Log error with full context and continue gracefully
    console.error('[Manager] RUNTIME_MESSAGE_ERROR: Error processing runtime message:', {
      error: err.message,
      stack: err.stack,
      messageType: message?.type,
      timestamp: Date.now()
    });
    // Don't rethrow - graceful degradation
    return false;
  }
});
// v1.6.3.7-v5 - FIX Issue #10: Log listener registration confirmation
console.log('[Manager] LISTENER_REGISTERED: browser.runtime.onMessage listener added');

/**
 * Process runtime message
 * v1.6.3.7-v5 - FIX Issue #9: Extracted to reduce nesting depth
 * @private
 * @param {Object} message - Incoming message
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} True if message was handled asynchronously
 */
function _processRuntimeMessage(message, sendResponse) {
  // v1.6.3.7-v9 - Issue #2: Track start time for duration logging
  const messageEntryTime = Date.now();

  // v1.6.3.7-v5 - FIX Issue #9: Validate message structure
  if (!message || typeof message !== 'object') {
    console.warn('[Manager] RUNTIME_MESSAGE_INVALID: Received non-object message:', typeof message);
    return false;
  }

  // v1.6.3.7-v9 - Issue #2: Generate correlationId if not present (for correlation tracking)
  const correlationId =
    message.correlationId || `runtime-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // v1.6.3.7-v9 - Issue #2: Unified MESSAGE_RECEIVED logging with [RUNTIME] prefix
  // Matches format of [PORT] and [BC] paths
  console.log(`[Manager] MESSAGE_RECEIVED [RUNTIME] [${message.type || 'UNKNOWN'}]:`, {
    quickTabId: message.quickTabId,
    messageId: message.messageId,
    saveId: message.saveId,
    correlationId,
    from: 'runtime.onMessage',
    path: 'runtime-onMessage',
    timestamp: messageEntryTime
  });

  let handled = false;

  if (message.type === 'QUICK_TAB_STATE_UPDATED') {
    _handleRuntimeStateUpdated(message, sendResponse, correlationId);
    handled = true;
  } else if (message.type === 'QUICK_TAB_DELETED') {
    // v1.6.3.5-v11 - FIX Issue #6: Handle explicit QUICK_TAB_DELETED message
    _handleRuntimeDeleted(message, sendResponse, correlationId);
    handled = true;
  }

  // v1.6.3.7-v9 - Issue #2: Log message exit with duration
  const processingDurationMs = Date.now() - messageEntryTime;
  if (DEBUG_MESSAGING) {
    console.log(`[Manager] MESSAGE_PROCESSED [RUNTIME] [${message.type || 'UNKNOWN'}]:`, {
      quickTabId: message.quickTabId,
      correlationId,
      handled,
      durationMs: processingDurationMs,
      timestamp: Date.now()
    });
  }

  return handled;
}

/**
 * Handle QUICK_TAB_STATE_UPDATED via runtime.onMessage
 * v1.6.3.7-v5 - FIX Issue #9: Extracted to reduce complexity
 * v1.6.3.7-v9 - Issue #2: Added correlationId parameter for tracking
 * @private
 * @param {Object} message - State update message
 * @param {Function} sendResponse - Response callback
 * @param {string} correlationId - Correlation ID for tracking
 */
function _handleRuntimeStateUpdated(message, sendResponse, correlationId) {
  // v1.6.3.7-v9 - Issue #2: Use [RUNTIME] prefix and include correlationId
  console.log('[Manager] [RUNTIME] STATE_UPDATE_RECEIVED:', {
    quickTabId: message.quickTabId,
    changes: message.changes,
    source: message.originalSource,
    messageId: message.messageId,
    correlationId,
    path: 'runtime-onMessage'
  });

  // v1.6.3.5-v11 - FIX Issue #6: Check if this is a deletion notification
  if (message.changes?.deleted === true || message.originalSource === 'destroy') {
    handleStateDeletedMessage(message.quickTabId);
  } else if (message.quickTabId && message.changes) {
    // Update local state cache
    handleStateUpdateMessage(message.quickTabId, message.changes);
  }

  // v1.6.3.7-v4 - FIX Issue #4: Route through scheduleRender with messageId for deduplication
  scheduleRender('runtime-QUICK_TAB_STATE_UPDATED', message.messageId);
  sendResponse({ received: true, correlationId });
}

/**
 * Handle QUICK_TAB_DELETED via runtime.onMessage
 * v1.6.3.7-v5 - FIX Issue #9: Extracted to reduce complexity
 * v1.6.3.7-v9 - Issue #2: Added correlationId parameter for tracking
 * @private
 * @param {Object} message - Deletion message
 * @param {Function} sendResponse - Response callback
 * @param {string} correlationId - Correlation ID for tracking
 */
function _handleRuntimeDeleted(message, sendResponse, correlationId) {
  // v1.6.3.7-v9 - Issue #2: Use [RUNTIME] prefix and include correlationId
  console.log('[Manager] [RUNTIME] DELETE_RECEIVED:', {
    quickTabId: message.quickTabId,
    source: message.source,
    messageId: message.messageId,
    correlationId,
    path: 'runtime-onMessage'
  });

  handleStateDeletedMessage(message.quickTabId);
  // v1.6.3.7-v4 - FIX Issue #4: Route through scheduleRender with messageId for deduplication
  scheduleRender('runtime-QUICK_TAB_DELETED', message.messageId);
  sendResponse({ received: true, correlationId });
}

/**
 * Handle state update message from background
 * v1.6.3.5-v3 - FIX Architecture Phase 1: Update local state from message
 * v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime for accurate "Last sync"
 * v1.6.3.7-v1 - FIX ISSUE #7: Update quickTabHostInfo on ALL state changes (not just when originTabId provided)
 *   - Track last operation type (minimize/restore/update)
 *   - Validate and clean stale entries
 * v1.6.4.17 - Refactored to flatten bumpy road (bumps=3)
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function handleStateUpdateMessage(quickTabId, changes) {
  _ensureTabsArrayExists();
  _applyStateChange(quickTabId, changes);
  _updateQuickTabHostInfo(quickTabId, changes);
  _updateStateTimestamps();
}

/**
 * Ensure quickTabsState.tabs array exists
 * v1.6.4.17 - Extracted from handleStateUpdateMessage to flatten bumpy road
 * @private
 */
function _ensureTabsArrayExists() {
  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }
}

/**
 * Apply state change to tabs array (update, add, or skip)
 * v1.6.4.17 - Extracted from handleStateUpdateMessage to flatten bumpy road
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function _applyStateChange(quickTabId, changes) {
  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);

  if (existingIndex >= 0) {
    _updateExistingTab(existingIndex, quickTabId, changes);
    return;
  }

  if (changes.url) {
    _addNewTab(quickTabId, changes);
    return;
  }

  _logSkippedUpdate(quickTabId, changes);
}

/**
 * Update an existing tab with new changes
 * v1.6.4.17 - Extracted from handleStateUpdateMessage
 * @private
 * @param {number} index - Tab index in array
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function _updateExistingTab(index, quickTabId, changes) {
  Object.assign(quickTabsState.tabs[index], changes);
  if (DEBUG_MESSAGING) {
    console.log('[Manager] [STATE] TAB_UPDATED:', {
      quickTabId,
      changes,
      timestamp: Date.now()
    });
  }
}

/**
 * Add a new tab to state
 * v1.6.4.17 - Extracted from handleStateUpdateMessage
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes including URL
 */
function _addNewTab(quickTabId, changes) {
  quickTabsState.tabs.push({ id: quickTabId, ...changes });
  if (DEBUG_MESSAGING) {
    console.log('[Manager] [STATE] TAB_ADDED:', {
      quickTabId,
      changes,
      timestamp: Date.now()
    });
  }
}

/**
 * Log when update is skipped (tab not found and no URL)
 * v1.6.4.17 - Extracted from handleStateUpdateMessage
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function _logSkippedUpdate(quickTabId, changes) {
  if (DEBUG_MESSAGING) {
    console.log('[Manager] [STATE] UPDATE_SKIPPED: Tab not found and no URL in changes', {
      quickTabId,
      changesKeys: Object.keys(changes),
      timestamp: Date.now()
    });
  }
}

/**
 * Update state timestamps after state change
 * v1.6.4.17 - Extracted from handleStateUpdateMessage
 * @private
 */
function _updateStateTimestamps() {
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();
}

/**
 * Update quickTabHostInfo Map with latest info from state changes
 * v1.6.3.7-v1 - FIX ISSUE #7: Ensure Tab Affinity Map stays current
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes that occurred
 */
/**
 * Update Quick Tab host info
 * v1.6.4.11 - Refactored to reduce cyclomatic complexity from 17 to <9
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Changes object
 */
function _updateQuickTabHostInfo(quickTabId, changes) {
  const existingEntry = quickTabHostInfo.get(quickTabId) || {};
  const hostTabId = _resolveHostTabId(quickTabId, changes, existingEntry);
  const lastOperation = _resolveLastOperation(changes, existingEntry);

  if (hostTabId != null) {
    _applyHostInfoUpdate(quickTabId, {
      hostTabId,
      lastOperation,
      minimized: changes.minimized ?? existingEntry.minimized ?? false
    });
  } else {
    _logHostInfoUpdateFailure(quickTabId, existingEntry, changes);
  }
}

/**
 * Resolve host tab ID from changes, existing entry, or state
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Changes object
 * @param {Object} existingEntry - Existing host info entry
 * @returns {number|null} Host tab ID or null
 */
function _resolveHostTabId(quickTabId, changes, existingEntry) {
  // Priority 1: originTabId in changes (most authoritative)
  if (changes.originTabId != null) {
    return changes.originTabId;
  }

  // Priority 2: Existing entry
  if (existingEntry.hostTabId != null) {
    return existingEntry.hostTabId;
  }

  // Priority 3: Find from existing state
  const tabInState = quickTabsState?.tabs?.find(t => t.id === quickTabId);
  return tabInState?.originTabId ?? null;
}

/**
 * Resolve last operation type from changes
 * @private
 * @param {Object} changes - Changes object
 * @param {Object} existingEntry - Existing host info entry
 * @returns {string} Operation type
 */
function _resolveLastOperation(changes, existingEntry) {
  if (changes.minimized === true) return 'minimize';
  if (changes.minimized === false) return 'restore';
  if (_hasPositionChanges(changes)) return 'position-update';
  if (changes.zIndex != null) return 'focus';
  return existingEntry.lastOperation || 'unknown';
}

/**
 * Check if changes contain position updates
 * @private
 */
function _hasPositionChanges(changes) {
  return (
    changes.left != null || changes.top != null || changes.width != null || changes.height != null
  );
}

/**
 * Apply host info update to the Map
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} options - Host info options
 * @param {number} options.hostTabId - Host tab ID
 * @param {string} options.lastOperation - Last operation type
 * @param {boolean} [options.minimized=false] - Minimized state
 */
function _applyHostInfoUpdate(quickTabId, { hostTabId, lastOperation, minimized = false }) {
  const newEntry = {
    hostTabId,
    lastUpdate: Date.now(),
    lastOperation,
    minimized
  };

  quickTabHostInfo.set(quickTabId, newEntry);

  console.log('[Manager] 📍 QUICK_TAB_HOST_INFO_UPDATED:', {
    quickTabId,
    hostTabId,
    lastOperation,
    minimized
  });
}

/**
 * Log host info update failure
 * @private
 */
function _logHostInfoUpdateFailure(quickTabId, existingEntry, changes) {
  console.warn('[Manager] ⚠️ Cannot update quickTabHostInfo - no hostTabId available:', {
    quickTabId,
    hasExistingEntry: !!existingEntry.hostTabId,
    changesHasOriginTabId: changes.originTabId != null
  });
}

/**
 * Handle state deleted message from background
 * v1.6.3.5-v11 - FIX Issue #6: Remove deleted Quick Tab from local state and cache
 *   This ensures Manager list updates when a Quick Tab is closed via UI or Manager command.
 * @param {string} quickTabId - Quick Tab ID that was deleted
 */
function handleStateDeletedMessage(quickTabId) {
  console.log('[Manager] Handling state:deleted for:', quickTabId);

  // Remove from quickTabsState
  const wasRemoved = _removeTabFromState(quickTabId);
  if (wasRemoved) {
    _updateCacheAfterDeletion(quickTabId);
  }

  // Remove from host info tracking
  _removeFromHostInfo(quickTabId);

  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();
}

/**
 * Remove tab from quickTabsState
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID to remove
 * @returns {boolean} True if tab was removed
 */
function _removeTabFromState(quickTabId) {
  if (!quickTabsState.tabs || !Array.isArray(quickTabsState.tabs)) {
    return false;
  }

  const beforeCount = quickTabsState.tabs.length;
  quickTabsState.tabs = quickTabsState.tabs.filter(t => t.id !== quickTabId);
  const afterCount = quickTabsState.tabs.length;

  if (beforeCount === afterCount) {
    return false;
  }

  console.log('[Manager] Removed tab from local state:', {
    quickTabId,
    beforeCount,
    afterCount
  });
  return true;
}

/**
 * Update cache after tab deletion
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID that was removed
 */
function _updateCacheAfterDeletion(quickTabId) {
  const afterCount = quickTabsState.tabs?.length ?? 0;

  if (afterCount === 0) {
    console.log('[Manager] Last Quick Tab deleted - clearing cache');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
  } else {
    // Update cache to remove this tab
    inMemoryTabsCache = inMemoryTabsCache.filter(t => t.id !== quickTabId);
    lastKnownGoodTabCount = afterCount;
  }
}

/**
 * Remove from host info tracking
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID to remove from tracking
 */
function _removeFromHostInfo(quickTabId) {
  if (quickTabHostInfo.has(quickTabId)) {
    quickTabHostInfo.delete(quickTabId);
    console.log('[Manager] Removed from quickTabHostInfo:', quickTabId);
  }
}

// ==================== v1.6.3.7-v9 Issue #10: TAB AFFINITY MAP CLEANUP ====================
// Functions for TTL-based cleanup and browser.tabs.onRemoved handling

/**
 * Clean up stale quickTabHostInfo entries older than TTL
 * v1.6.3.7-v9 - Issue #10: Remove entries older than 24 hours
 * v1.6.3.7-v10 - FIX Issue #10: Enhanced logging with before/after sizes and age buckets
 * @private
 * @returns {Object} Cleanup result with before/after counts and removed entries
 */
function _cleanupStaleHostInfoEntries() {
  const now = Date.now();
  const ttlThreshold = now - HOST_INFO_TTL_MS;

  // v1.6.3.7-v10 - FIX Issue #10: Track before size for logging
  const sizeBeforeCleanup = quickTabHostInfo.size;
  let removedCount = 0;
  const removedEntries = [];

  for (const [quickTabId, entry] of quickTabHostInfo.entries()) {
    // Skip null entries (consistent with _getHostInfoAgeStats)
    if (!entry || !entry.lastUpdate) continue;

    if (entry.lastUpdate < ttlThreshold) {
      quickTabHostInfo.delete(quickTabId);
      removedCount++;
      removedEntries.push({
        quickTabId,
        hostTabId: entry.hostTabId,
        ageHours: Math.round((now - entry.lastUpdate) / (1000 * 60 * 60))
      });
    }
  }

  // v1.6.3.7-v10 - FIX Issue #10: Always log cleanup result with before/after sizes
  const sizeAfterCleanup = quickTabHostInfo.size;
  console.log('[Manager] [HOST_INFO_CLEANUP] TTL_CLEANUP_COMPLETE:', {
    sizeBeforeCleanup,
    sizeAfterCleanup,
    removedCount,
    removedEntries: removedCount > 0 ? removedEntries : [],
    ttlHours: HOST_INFO_TTL_MS / (1000 * 60 * 60),
    timestamp: now
  });

  return { sizeBeforeCleanup, sizeAfterCleanup, removedCount, removedEntries };
}

// v1.6.3.7-v10 - FIX Issue #10: Time constants for age bucket boundaries
const AGE_BUCKET_BOUNDARIES = {
  ONE_HOUR_MS: 60 * 60 * 1000,
  SIX_HOURS_MS: 6 * 60 * 60 * 1000,
  TWENTY_FOUR_HOURS_MS: 24 * 60 * 60 * 1000
};

/**
 * Categorize age into bucket
 * v1.6.3.7-v10 - FIX Issue #10: Helper to reduce complexity
 * @private
 * @param {number} ageMs - Age in milliseconds
 * @returns {string} Bucket key
 */
function _getAgeBucketKey(ageMs) {
  if (ageMs < AGE_BUCKET_BOUNDARIES.ONE_HOUR_MS) return 'lessThan1h';
  if (ageMs < AGE_BUCKET_BOUNDARIES.SIX_HOURS_MS) return 'oneToSixH';
  if (ageMs < AGE_BUCKET_BOUNDARIES.TWENTY_FOUR_HOURS_MS) return 'sixTo24H';
  return 'moreThan24h';
}

/**
 * Update min/max entry tracking
 * v1.6.3.7-v10 - FIX Issue #10: Helper to reduce complexity
 * @private
 */
function _updateMinMaxEntries(ageMs, quickTabId, hostTabId, stats) {
  if (ageMs < stats.minAgeMs) {
    stats.minAgeMs = ageMs;
    stats.newestEntry = { quickTabId, hostTabId, ageMs };
  }
  if (ageMs > stats.maxAgeMs) {
    stats.maxAgeMs = ageMs;
    stats.oldestEntry = { quickTabId, hostTabId, ageMs };
  }
}

/**
 * Get age statistics for quickTabHostInfo entries
 * v1.6.3.7-v9 - Issue #10: Calculate min/max/avg age for diagnostics
 * v1.6.3.7-v10 - FIX Issue #10: Add age bucket counts (< 1h, 1-6h, 6-24h, > 24h)
 * @private
 * @returns {Object} Age statistics with bucket counts
 */
function _getHostInfoAgeStats() {
  const now = Date.now();
  const stats = {
    minAgeMs: Infinity,
    maxAgeMs: 0,
    newestEntry: null,
    oldestEntry: null
  };
  let totalAgeMs = 0;
  let entryCount = 0;

  // v1.6.3.7-v10 - FIX Issue #10: Age bucket counts
  const ageBuckets = {
    lessThan1h: 0,
    oneToSixH: 0,
    sixTo24H: 0,
    moreThan24h: 0
  };

  for (const [quickTabId, entry] of quickTabHostInfo.entries()) {
    if (!entry || !entry.lastUpdate) continue;

    const ageMs = now - entry.lastUpdate;
    totalAgeMs += ageMs;
    entryCount++;

    // v1.6.3.7-v10 - FIX Issue #10: Categorize into age buckets
    ageBuckets[_getAgeBucketKey(ageMs)]++;

    // Update min/max tracking
    _updateMinMaxEntries(ageMs, quickTabId, entry.hostTabId, stats);
  }

  return {
    entryCount,
    minAgeMs: entryCount > 0 ? stats.minAgeMs : 0,
    maxAgeMs: entryCount > 0 ? stats.maxAgeMs : 0,
    avgAgeMs: entryCount > 0 ? Math.round(totalAgeMs / entryCount) : 0,
    oldestEntry: stats.oldestEntry,
    newestEntry: stats.newestEntry,
    ageBuckets
  };
}

/**
 * Log quickTabHostInfo diagnostic statistics
 * v1.6.3.7-v9 - Issue #10: Log size and age stats every 60 seconds
 * v1.6.3.7-v10 - FIX Issue #10: Enhanced with age buckets and sample entries
 * @private
 */
function _logHostInfoDiagnostics() {
  const stats = _getHostInfoAgeStats();
  const now = Date.now();

  // Convert ms to human-readable format
  const msToTimeStr = ms => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  // v1.6.3.7-v10 - FIX Issue #10: Get first 5 sample entries for diagnostics
  const sampleEntries = _getSampleHostInfoEntries(5, now, msToTimeStr);

  console.log('[Manager] [HOST_INFO_DIAGNOSTICS]:', {
    mapSize: quickTabHostInfo.size,
    entryCount: stats.entryCount,
    // v1.6.3.7-v10 - FIX Issue #10: Age bucket distribution
    ageBuckets: {
      '<1h': stats.ageBuckets.lessThan1h,
      '1-6h': stats.ageBuckets.oneToSixH,
      '6-24h': stats.ageBuckets.sixTo24H,
      '>24h': stats.ageBuckets.moreThan24h
    },
    minAge: msToTimeStr(stats.minAgeMs),
    maxAge: msToTimeStr(stats.maxAgeMs),
    avgAge: msToTimeStr(stats.avgAgeMs),
    oldestEntry: stats.oldestEntry
      ? {
          quickTabId: stats.oldestEntry.quickTabId,
          hostTabId: stats.oldestEntry.hostTabId,
          age: msToTimeStr(stats.oldestEntry.ageMs)
        }
      : null,
    // v1.6.3.7-v10 - FIX Issue #10: Sample entries for diagnostics
    sampleEntries,
    timestamp: now
  });
}

/**
 * Get sample host info entries for diagnostic logging
 * v1.6.3.7-v10 - FIX Issue #10: Extract first N entries with their ages
 * @private
 * @param {number} count - Number of sample entries to retrieve
 * @param {number} now - Current timestamp
 * @param {Function} msToTimeStr - Time formatter function
 * @returns {Array} Array of sample entry objects
 */
function _getSampleHostInfoEntries(count, now, msToTimeStr) {
  const samples = [];
  let i = 0;

  for (const [quickTabId, entry] of quickTabHostInfo.entries()) {
    if (i >= count) break;
    if (!entry || !entry.lastUpdate) continue;

    const ageMs = now - entry.lastUpdate;
    samples.push({
      quickTabId,
      hostTabId: entry.hostTabId,
      age: msToTimeStr(ageMs),
      lastOperation: entry.lastOperation || 'unknown'
    });
    i++;
  }

  return samples;
}

/**
 * Run cleanup job for quickTabHostInfo: remove stale entries and log diagnostics
 * v1.6.3.7-v9 - Issue #10: Combined cleanup and diagnostic logging
 * v1.6.3.7-v10 - FIX Issue #10: Added defensive cleanup against browser.tabs.query()
 * @private
 */
async function _runHostInfoCleanupJob() {
  // First log diagnostics
  _logHostInfoDiagnostics();

  // v1.6.3.7-v10 - FIX Issue #10: Defensive cleanup - cross-check against open tabs
  await _defensiveCleanupStaleHostInfo();

  // Then clean up stale entries (TTL-based)
  _cleanupStaleHostInfoEntries();
}

/**
 * Start the periodic cleanup job for quickTabHostInfo
 * v1.6.3.7-v9 - Issue #10: Run cleanup every 60 seconds
 */
function _startHostInfoCleanupInterval() {
  // Don't start if already running
  if (hostInfoCleanupIntervalId !== null) {
    return;
  }

  hostInfoCleanupIntervalId = setInterval(_runHostInfoCleanupJob, HOST_INFO_CLEANUP_INTERVAL_MS);
  console.log('[Manager] [HOST_INFO_CLEANUP] Cleanup job started:', {
    intervalMs: HOST_INFO_CLEANUP_INTERVAL_MS,
    ttlMs: HOST_INFO_TTL_MS,
    timestamp: Date.now()
  });
}

/**
 * Stop the periodic cleanup job for quickTabHostInfo
 * v1.6.3.7-v9 - Issue #10: Stop cleanup on unload
 */
function _stopHostInfoCleanupInterval() {
  if (hostInfoCleanupIntervalId !== null) {
    clearInterval(hostInfoCleanupIntervalId);
    hostInfoCleanupIntervalId = null;
    console.log('[Manager] [HOST_INFO_CLEANUP] Cleanup job stopped');
  }
}

/**
 * Remove quickTabHostInfo entries for a closed browser tab
 * v1.6.3.7-v9 - Issue #10: Clean up entries when browser tab closes
 * @param {number} closedTabId - ID of the closed browser tab
 */
function _cleanupHostInfoForClosedTab(closedTabId) {
  const removedQuickTabIds = [];

  for (const [quickTabId, entry] of quickTabHostInfo.entries()) {
    if (entry.hostTabId === closedTabId) {
      quickTabHostInfo.delete(quickTabId);
      removedQuickTabIds.push(quickTabId);
    }
  }

  if (removedQuickTabIds.length > 0) {
    console.log('[Manager] [HOST_INFO_CLEANUP] BROWSER_TAB_CLOSED:', {
      closedTabId,
      removedQuickTabIds,
      remainingCount: quickTabHostInfo.size,
      timestamp: Date.now()
    });
  }
}

/**
 * Check if host info entry should be removed based on open tabs
 * v1.6.3.7-v10 - FIX Issue #10: Helper to reduce nesting depth
 * @private
 * @param {Object} entry - Host info entry
 * @param {Set} openTabIds - Set of open tab IDs
 * @returns {boolean} True if entry is stale and should be removed
 */
function _isStaleHostInfoEntry(entry, openTabIds) {
  if (!entry || !entry.hostTabId) return false;
  return !openTabIds.has(entry.hostTabId);
}

/**
 * Remove stale entries from quickTabHostInfo and collect results
 * v1.6.3.7-v10 - FIX Issue #10: Helper to reduce nesting depth
 * @private
 * @param {Set} openTabIds - Set of open tab IDs
 * @returns {Object} Removed entries and stale host tab IDs
 */
function _removeStaleHostInfoEntries(openTabIds) {
  const removedEntries = [];
  const staleHostTabIds = new Set();

  for (const [quickTabId, entry] of quickTabHostInfo.entries()) {
    if (_isStaleHostInfoEntry(entry, openTabIds)) {
      staleHostTabIds.add(entry.hostTabId);
      quickTabHostInfo.delete(quickTabId);
      removedEntries.push({
        quickTabId,
        hostTabId: entry.hostTabId,
        lastOperation: entry.lastOperation || 'unknown'
      });
    }
  }

  return { removedEntries, staleHostTabIds };
}

/**
 * Defensive cleanup: Remove quickTabHostInfo entries for tabs that are no longer open
 * v1.6.3.7-v10 - FIX Issue #10: Cross-check against browser.tabs.query() to remove stale entries
 * Called during cleanup job to ensure Map doesn't contain entries for closed tabs
 * @private
 * @returns {Promise<Object>} Cleanup result with removed count
 */
async function _defensiveCleanupStaleHostInfo() {
  const now = Date.now();

  try {
    // Query all open tabs
    const openTabs = await browser.tabs.query({ status: 'complete' });
    const openTabIds = new Set(openTabs.map(tab => tab.id));

    // v1.6.3.7-v10 - FIX Issue #10: Extracted to helper for reduced nesting
    const { removedEntries, staleHostTabIds } = _removeStaleHostInfoEntries(openTabIds);

    if (removedEntries.length > 0) {
      console.log('[Manager] [HOST_INFO_CLEANUP] STALE_HOST_INFO_REMOVED:', {
        removedCount: removedEntries.length,
        staleHostTabIds: Array.from(staleHostTabIds),
        removedEntries,
        remainingCount: quickTabHostInfo.size,
        openTabCount: openTabs.length,
        timestamp: now
      });
    }

    return { removedCount: removedEntries.length, removedEntries };
  } catch (error) {
    console.warn('[Manager] [HOST_INFO_CLEANUP] Defensive cleanup failed:', {
      error: error.message,
      timestamp: now
    });
    return { removedCount: 0, removedEntries: [], error: error.message };
  }
}

/**
 * Handler for browser.tabs.onRemoved event
 * v1.6.3.7-v9 - Issue #10: Remove quickTabHostInfo entries for closed tabs
 * @param {number} tabId - ID of the closed tab
 * @param {Object} removeInfo - Information about the removal
 */
function _handleBrowserTabRemoved(tabId, removeInfo) {
  // Clean up quickTabHostInfo entries for this tab
  _cleanupHostInfoForClosedTab(tabId);

  // Also invalidate browser tab info cache
  browserTabInfoCache.delete(tabId);

  if (DEBUG_MESSAGING) {
    console.log('[Manager] [BROWSER_TAB_REMOVED]:', {
      tabId,
      windowClosing: removeInfo?.isWindowClosing,
      timestamp: Date.now()
    });
  }
}

/**
 * Initialize browser.tabs.onRemoved listener
 * v1.6.3.7-v9 - Issue #10: Listen for tab closures to clean up quickTabHostInfo
 */
function _initBrowserTabsOnRemovedListener() {
  if (browser?.tabs?.onRemoved) {
    browser.tabs.onRemoved.addListener(_handleBrowserTabRemoved);
    console.log('[Manager] LISTENER_REGISTERED: browser.tabs.onRemoved listener added');
  } else {
    console.warn('[Manager] browser.tabs.onRemoved API not available');
  }
}

// ==================== END v1.6.3.7-v9 Issue #10 ====================

/**
 * Send MANAGER_COMMAND to background for remote Quick Tab control
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Manager can control Quick Tabs in any tab
 * v1.6.3.5-v6 - ARCHITECTURE NOTE: This is the PREFERRED approach for Quick Tab control.
 *   Background routes commands to specific host tabs via quickTabHostTabs Map.
 *   This enables per-tab ownership and prevents cross-tab ghosting.
 *
 * Currently used for: none (minimize/restore still use targeted messaging)
 * Should be used for: MINIMIZE_QUICK_TAB, RESTORE_QUICK_TAB, CLOSE_QUICK_TAB, FOCUS_QUICK_TAB
 *
 * @param {string} command - Command to execute (MINIMIZE_QUICK_TAB, RESTORE_QUICK_TAB, etc.)
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<Object>} Response from background
 */
async function _sendManagerCommand(command, quickTabId) {
  console.log('[Manager] Sending MANAGER_COMMAND:', { command, quickTabId });

  try {
    const response = await browser.runtime.sendMessage({
      type: 'MANAGER_COMMAND',
      command,
      quickTabId,
      sourceContext: 'sidebar'
    });

    console.log('[Manager] Command response:', response);
    return response;
  } catch (err) {
    console.error('[Manager] Failed to send command:', { command, quickTabId, error: err.message });
    return { success: false, error: err.message };
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  _initializeManager();
});

/**
 * Main initialization function for the Manager
 * v1.6.4.17 - Extracted from DOMContentLoaded to reduce CC and line count
 * v1.6.3.8-v4 - FIX Issue #5: Implements true sequential initialization barrier
 * @private
 */
async function _initializeManager() {
  // v1.6.3.8-v4 - FIX Issue #5: Create initialization barrier FIRST
  _initializeBarrier();
  currentInitPhase = 'flags';
  
  _initializeFlags();
  _cacheDOMElements();
  _initializeSessionId();

  // v1.6.3.8-v4 - FIX Issue #1: Sequential initialization - port must connect first
  currentInitPhase = 'tab-id';
  await _initializeCurrentTabId();
  
  // v1.6.3.8-v4 - FIX Issue #1: Establish port connection before anything else
  currentInitPhase = 'port-connection';
  _initializeConnections();
  
  // v1.6.3.8-v4 - FIX Issue #6: Query background for state via port BEFORE storage read
  currentInitPhase = 'hydration';
  await _hydrateStateFromBackground();
  
  // v1.6.3.8-v4 - FIX Issue #1: Storage listener must be verified before state load
  currentInitPhase = 'storage-listener';
  await _initializeState();
  
  currentInitPhase = 'listeners';
  await _setupListeners();
  
  currentInitPhase = 'periodic-tasks';
  _startPeriodicTasks();
  
  // v1.6.3.8-v4 - FIX Issue #3: Setup visibility change listener
  _setupVisibilityChangeListener();
  
  // v1.6.3.8-v4 - FIX Issue #5: Resolve initialization barrier AFTER all async init complete
  _resolveInitBarrier();
  
  _markInitializationComplete();
}

/**
 * Hydrate state from background via port BEFORE rendering
 * v1.6.3.8-v4 - FIX Issue #6: Query background for authoritative state
 * @private
 */
async function _hydrateStateFromBackground() {
  const hydrationStart = Date.now();
  
  console.log('[Manager] STATE_HYDRATION: source=port, starting', {
    timestamp: hydrationStart,
    portConnected: backgroundPort !== null,
    connectionState
  });
  
  if (!backgroundPort) {
    console.warn('[Manager] STATE_HYDRATION: port not connected, will use storage fallback', {
      elapsed: Date.now() - hydrationStart
    });
    return;
  }
  
  try {
    // Request full state from background with timeout
    const response = await sendPortMessageWithTimeout(
      {
        type: 'REQUEST_FULL_STATE_SYNC',
        timestamp: hydrationStart,
        source: 'sidebar-hydration',
        isInitialHydration: true
      },
      STATE_SYNC_TIMEOUT_MS
    );
    
    if (response?.success && response?.state) {
      const tabCount = response.state?.tabs?.length ?? 0;
      
      console.log('[Manager] STATE_HYDRATION: source=port, success', {
        tabCount,
        elapsed: Date.now() - hydrationStart + 'ms',
        saveId: response.state?.saveId,
        timestamp: Date.now()
      });
      
      // Update local state from background's authoritative state
      quickTabsState = response.state;
      _updateInMemoryCache(response.state.tabs || []);
      lastKnownGoodTabCount = tabCount;
      lastLocalUpdateTime = Date.now();
      
      // Mark initial state load complete since we got state from port
      initialStateLoadComplete = true;
    } else {
      console.warn('[Manager] STATE_HYDRATION: port response invalid, will use storage fallback', {
        hasResponse: !!response,
        hasState: !!response?.state,
        elapsed: Date.now() - hydrationStart
      });
    }
  } catch (err) {
    console.warn('[Manager] STATE_HYDRATION: port request failed, will use storage fallback', {
      error: err.message,
      elapsed: Date.now() - hydrationStart
    });
  }
}

/**
 * Initialize flags and timing
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
function _initializeFlags() {
  initializationStarted = true;
  initializationStartTime = Date.now();

  console.log('[Manager] DOM_CONTENT_LOADED:', {
    timestamp: initializationStartTime,
    url: window.location.href,
    initializationStarted,
    initializationComplete
  });
}

/**
 * Cache DOM elements
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
function _cacheDOMElements() {
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');
}

/**
 * Initialize current tab ID for origin filtering
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
async function _initializeCurrentTabId() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentBrowserTabId = tabs[0].id;
      console.log('[Manager] Current browser tab ID:', currentBrowserTabId);
    }
  } catch (err) {
    console.warn('[Manager] Could not get current tab ID:', err);
  }
}

/**
 * Initialize port and broadcast channel connections
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * v1.6.3.8-v3 - FIX Issue #1: Port is Tier 1 (PRIMARY), BC is Tier 2 (tab-to-tab only)
 * @private
 */
function _initializeConnections() {
  // v1.6.3.8-v3 - FIX Issue #1: Port-based messaging is PRIMARY for sidebar
  // Must be initialized first as it's the authoritative communication channel
  console.log('[Manager] [PORT] Initializing Tier 1 (PRIMARY): Port-based messaging');
  connectToBackground();

  // v1.6.3.8-v3 - FIX Issue #1: BroadcastChannel is SECONDARY (tab-to-tab only)
  // NOT reliable for sidebar↔background due to Firefox isolation
  console.log('[Manager] [BC] Initializing Tier 2 (SECONDARY): BroadcastChannel (tab-to-tab)');
  initializeBroadcastChannel();
}

/**
 * Initialize state from storage and containers
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
async function _initializeState() {
  await loadContainerInfo();
  stateLoadStartTime = Date.now();

  await loadQuickTabsState();
  const tabCount = quickTabsState?.tabs?.length ?? 0;

  _handleInitialLoadState(tabCount);
}

/**
 * Handle initial load state - render or wait
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
function _handleInitialLoadState(tabCount) {
  if (tabCount === 0 && !initialStateLoadComplete) {
    _setupInitialLoadTimeout();
  } else {
    initialStateLoadComplete = true;
    renderUI();
  }
}

/**
 * Setup timeout for initial empty state
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
function _setupInitialLoadTimeout() {
  console.log(
    '[Manager] INITIAL_LOAD_EMPTY: Waiting 2s for storage.onChanged before rendering empty',
    {
      timestamp: Date.now()
    }
  );

  initialLoadTimeoutId = setTimeout(_handleInitialLoadTimeout, 2000);
}

/**
 * Handle initial load timeout callback
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
function _handleInitialLoadTimeout() {
  initialLoadTimeoutId = null;
  initialStateLoadComplete = true;
  const currentTabCount = quickTabsState?.tabs?.length ?? 0;

  if (currentTabCount === 0) {
    console.log(
      '[Manager] INITIAL_LOAD_TIMEOUT: No tabs received after 2s wait, rendering empty state',
      {
        timestamp: Date.now()
      }
    );
    renderUI();
  } else {
    console.log('[Manager] INITIAL_LOAD_TIMEOUT: Tabs received during wait period', {
      tabCount: currentTabCount,
      timestamp: Date.now()
    });
  }
}

/**
 * Setup all event listeners
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * v1.6.3.8-v3 - FIX Issues #2, #5, #9, #15: Initialize storage listener FIRST with verification
 * @private
 */
async function _setupListeners() {
  // v1.6.3.8-v3 - FIX Issue #9: Initialize storage listener FIRST
  // This ensures listener is registered before any storage writes from background
  // and provides verification barrier for init sequence
  await _initializeStorageListener();
  
  // v1.6.3.8-v3 - FIX Issue #5: Log storage listener verification status
  console.log('[Manager] STORAGE_LISTENER_VERIFIED_AT:', {
    verified: storageListenerVerified,
    timeSinceInitStartMs: Date.now() - initializationStartTime,
    tier3FallbackEnabled: storageListenerVerified,
    timestamp: Date.now()
  });
  
  setupEventListeners();
  setupTabSwitchListener();
  _initBrowserTabsOnRemovedListener();
}

/**
 * Setup document visibility change listener
 * v1.6.3.8-v4 - FIX Issue #3: Listen for sidebar visibility changes
 * @private
 */
function _setupVisibilityChangeListener() {
  document.addEventListener('visibilitychange', _handleVisibilityChange);
  
  console.log('[Manager] VISIBILITY_LISTENER_REGISTERED:', {
    initialVisibility: document.visibilityState,
    refreshIntervalMs: VISIBILITY_REFRESH_INTERVAL_MS,
    timestamp: Date.now()
  });
}

/**
 * Handle document visibility change event
 * v1.6.3.8-v4 - FIX Issue #3: Trigger state refresh when sidebar becomes visible
 * @private
 */
function _handleVisibilityChange() {
  const isVisible = document.visibilityState === 'visible';
  
  console.log('[Manager] VISIBILITY_CHANGE:', {
    state: document.visibilityState,
    isVisible,
    wasHidden: !isVisible,
    timestamp: Date.now()
  });
  
  if (isVisible) {
    // Sidebar became visible - trigger active state refresh
    _onSidebarBecameVisible();
    // Start periodic state freshness check while visible
    _startVisibilityRefreshInterval();
  } else {
    // Sidebar became hidden - stop the interval
    _stopVisibilityRefreshInterval();
  }
}

/**
 * Handle sidebar becoming visible
 * v1.6.3.8-v4 - FIX Issue #3: Active state refresh on visibility change
 * @private
 */
async function _onSidebarBecameVisible() {
  const refreshStart = Date.now();
  
  console.log('[Manager] VISIBILITY_REFRESH: hidden→visible, requesting state', {
    timestamp: refreshStart,
    connectionState,
    lastLocalUpdateTime,
    timeSinceLastUpdate: lastLocalUpdateTime > 0 ? refreshStart - lastLocalUpdateTime : -1
  });
  
  // Request fresh state from background
  try {
    await _requestFullStateSync();
    
    console.log('[Manager] VISIBILITY_REFRESH: completed', {
      durationMs: Date.now() - refreshStart,
      tabCount: quickTabsState?.tabs?.length ?? 0,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Manager] VISIBILITY_REFRESH: failed, falling back to storage read', {
      error: err.message,
      durationMs: Date.now() - refreshStart,
      timestamp: Date.now()
    });
    
    // Fallback to storage read
    await loadQuickTabsState();
    renderUI();
  }
}

/**
 * Start periodic state freshness check while sidebar is visible
 * v1.6.3.8-v4 - FIX Issue #3: Check state freshness every 15 seconds
 * @private
 */
function _startVisibilityRefreshInterval() {
  _stopVisibilityRefreshInterval(); // Clear any existing interval
  
  visibilityRefreshIntervalId = setInterval(async () => {
    await _checkStateFreshness();
  }, VISIBILITY_REFRESH_INTERVAL_MS);
  
  console.log('[Manager] VISIBILITY_REFRESH_INTERVAL_STARTED:', {
    intervalMs: VISIBILITY_REFRESH_INTERVAL_MS,
    timestamp: Date.now()
  });
}

/**
 * Stop periodic state freshness check
 * v1.6.3.8-v4 - FIX Issue #3: Stop interval when sidebar becomes hidden
 * @private
 */
function _stopVisibilityRefreshInterval() {
  if (visibilityRefreshIntervalId) {
    clearInterval(visibilityRefreshIntervalId);
    visibilityRefreshIntervalId = null;
    
    console.log('[Manager] VISIBILITY_REFRESH_INTERVAL_STOPPED:', {
      timestamp: Date.now()
    });
  }
}

/**
 * Check if local state is stale and refresh if needed
 * v1.6.3.8-v4 - FIX Issue #3: Periodic state freshness verification
 * @private
 */
async function _checkStateFreshness() {
  const now = Date.now();
  const timeSinceLastUpdate = lastLocalUpdateTime > 0 ? now - lastLocalUpdateTime : -1;
  
  // If state is older than 30 seconds, request fresh state
  const STALE_THRESHOLD_MS = 30000;
  
  if (timeSinceLastUpdate < 0 || timeSinceLastUpdate > STALE_THRESHOLD_MS) {
    console.log('[Manager] STATE_FRESHNESS_CHECK: state is stale, refreshing', {
      timeSinceLastUpdateMs: timeSinceLastUpdate,
      staleThresholdMs: STALE_THRESHOLD_MS,
      timestamp: now
    });
    
    try {
      await _requestFullStateSync();
    } catch (err) {
      console.warn('[Manager] STATE_FRESHNESS_CHECK: refresh failed', {
        error: err.message,
        timestamp: now
      });
    }
  } else {
    console.log('[Manager] STATE_FRESHNESS_CHECK: state is fresh', {
      timeSinceLastUpdateMs: timeSinceLastUpdate,
      staleThresholdMs: STALE_THRESHOLD_MS,
      timestamp: now
    });
  }
}

/**
 * Start periodic background tasks
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * v1.6.3.8-v5 - FIX Issue #1: Start revision buffer cleanup
 * @private
 */
function _startPeriodicTasks() {
  _startHostInfoCleanupInterval();
  
  // v1.6.3.8-v5 - FIX Issue #1: Start revision buffer cleanup interval
  _startRevisionBufferCleanup();

  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();
  }, 10000);
}

/**
 * Mark initialization as complete and log
 * v1.6.4.17 - Extracted from DOMContentLoaded
 * @private
 */
function _markInitializationComplete() {
  initializationComplete = true;

  console.log('[Manager] v1.6.3.7-v9 INITIALIZATION_COMPLETE:', {
    initializationStarted,
    initializationComplete,
    storagePollingMs: 10000,
    sessionId: currentSessionId,
    connectionState,
    hostInfoCleanupIntervalMs: HOST_INFO_CLEANUP_INTERVAL_MS,
    hostInfoTTLMs: HOST_INFO_TTL_MS,
    timestamp: Date.now()
  });
}

// v1.6.3.6-v11 - FIX Issue #17: Port cleanup on window unload
// v1.6.3.6-v12 - FIX Issue #4: Also stop heartbeat on unload
// v1.6.3.7-v3 - API #2: Also cleanup BroadcastChannel
// v1.6.3.7-v9 - Issue #10: Also stop hostInfo cleanup interval
// v1.6.3.7-v13 - Issue #12: Also stop fallback health monitoring
// v1.6.3.8-v3 - FIX Issue #19: Also clear quickTabHostInfo map
// v1.6.3.8-v4 - FIX Issue #3: Also stop visibility refresh interval
window.addEventListener('unload', () => {
  // v1.6.3.7-v3 - API #2: Cleanup BroadcastChannel
  cleanupBroadcastChannel();

  // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat before disconnecting
  stopHeartbeat();

  // v1.6.3.7-v9 - Issue #10: Stop hostInfo cleanup interval
  _stopHostInfoCleanupInterval();

  // v1.6.3.7-v13 - Issue #12: Stop fallback health monitoring
  _stopFallbackHealthMonitoring();

  // v1.6.3.8-v4 - FIX Issue #3: Stop visibility refresh interval
  _stopVisibilityRefreshInterval();
  
  // v1.6.3.8-v4 - FIX Issue #3: Remove visibility change listener
  document.removeEventListener('visibilitychange', _handleVisibilityChange);

  // v1.6.3.8-v5 - FIX Issue #1: Stop revision buffer cleanup interval
  _stopRevisionBufferCleanup();

  // v1.6.3.8-v3 - FIX Issue #19: Clear quickTabHostInfo map to prevent memory leak
  const hostInfoEntriesBefore = quickTabHostInfo.size;
  quickTabHostInfo.clear();
  console.log('[Manager] HOST_INFO_MAP_CLEARED:', {
    entriesRemoved: hostInfoEntriesBefore,
    reason: 'window-unload',
    timestamp: Date.now()
  });

  if (backgroundPort) {
    logPortLifecycle('unload', { reason: 'window-unload' });
    backgroundPort.disconnect();
    backgroundPort = null;
  }

  // Clear pending acks
  for (const [_correlationId, pending] of pendingAcks.entries()) {
    clearTimeout(pending.timeout);
  }
  pendingAcks.clear();
});

/**
 * Load Firefox Container Tab information
 * Uses contextualIdentities API to get container names, icons, colors
 * Cross-browser: Falls back gracefully if containers not supported (Chrome)
 */
async function loadContainerInfo() {
  try {
    // Cross-browser: Check if contextualIdentities API is available
    // Firefox: Native container support
    // Chrome: No container support, use default
    if (typeof browser.contextualIdentities === 'undefined') {
      console.warn('[Cross-browser] Contextual Identities API not available (Chrome/Edge)');
      // Fallback: Only show default container
      containersData['firefox-default'] = {
        name: 'Default',
        icon: '📁',
        color: 'grey',
        cookieStoreId: 'firefox-default'
      };
      return;
    }

    // Get all Firefox containers
    const containers = await browser.contextualIdentities.query({});

    // Map containers
    containersData = {};
    containers.forEach(container => {
      containersData[container.cookieStoreId] = {
        name: container.name,
        icon: getContainerIcon(container.icon),
        color: container.color,
        colorCode: container.colorCode,
        cookieStoreId: container.cookieStoreId
      };
    });

    // Always add default container
    containersData['firefox-default'] = {
      name: 'Default',
      icon: '📁',
      color: 'grey',
      colorCode: '#808080',
      cookieStoreId: 'firefox-default'
    };

    console.log('Loaded container info:', containersData);
  } catch (err) {
    console.error('Error loading container info:', err);
  }
}

/**
 * Convert Firefox container icon identifier to emoji
 */
function getContainerIcon(icon) {
  const iconMap = {
    fingerprint: '🔒',
    briefcase: '💼',
    dollar: '💰',
    cart: '🛒',
    circle: '⭕',
    gift: '🎁',
    vacation: '🏖️',
    food: '🍴',
    fruit: '🍎',
    pet: '🐾',
    tree: '🌳',
    chill: '❄️',
    fence: '🚧'
  };

  return iconMap[icon] || '📁';
}

/**
 * Check if storage read should be debounced
 * v1.6.3.4-v6 - Extracted to reduce loadQuickTabsState complexity
 * Simply uses timing-based debounce (no storage read needed)
 * v1.6.3.5-v2 - FIX Report 2 Issue #2: Reduced debounce from 300ms to 50ms
 * @returns {Promise<void>} Resolves when ready to read
 */
async function checkStorageDebounce() {
  const now = Date.now();
  const timeSinceLastRead = now - lastStorageReadTime;

  // If within debounce period, wait the remaining time
  if (timeSinceLastRead < STORAGE_READ_DEBOUNCE_MS) {
    const waitTime = STORAGE_READ_DEBOUNCE_MS - timeSinceLastRead;
    console.log('[Manager] Debouncing storage read, waiting', waitTime, 'ms');
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastStorageReadTime = Date.now();
}

/**
 * Handle empty storage state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Clear cache when storage is legitimately empty
 *   If storage is empty and cache has only 1 tab, this is a legitimate single-tab deletion.
 *   Sets quickTabsState and logs appropriately - used as flow control signal
 * v1.6.3.7-v4 - FIX Issue #6: Validate session before using cache as fallback
 */
function _handleEmptyStorageState() {
  const cacheTabs = inMemoryTabsCache.tabs || [];
  const cacheSessionId = inMemoryTabsCache.sessionId || '';

  // v1.6.3.5-v11 - FIX Issue #6: Check if this is a legitimate single-tab deletion
  if (cacheTabs.length === 1) {
    console.log(
      '[Manager] Storage empty with single-tab cache - clearing cache (legitimate deletion)'
    );
    inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
    lastKnownGoodTabCount = 0;
    quickTabsState = {};
    return;
  }

  // v1.6.3.7-v4 - FIX Issue #6: Validate session before using cache as fallback
  if (cacheTabs.length > 1 && cacheSessionId === currentSessionId) {
    console.log(
      '[Manager] Storage returned empty but cache has',
      cacheTabs.length,
      'tabs - using cache (same session)'
    );
    quickTabsState = { tabs: cacheTabs, timestamp: Date.now() };
  } else if (cacheTabs.length > 1 && cacheSessionId !== currentSessionId) {
    // v1.6.3.7-v4 - FIX Issue #6: Cache from different session - reject with warning
    console.warn('[Manager] ⚠️ STALE_CACHE_REJECTED: Cache is from different session', {
      cacheSessionId,
      currentSessionId,
      cacheTabs: cacheTabs.length,
      cacheTimestamp: inMemoryTabsCache.timestamp,
      warning: 'Not restoring ghost tabs from previous session'
    });
    inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
    lastKnownGoodTabCount = 0;
    quickTabsState = {};
    console.log('[Manager] Loaded Quick Tabs state: empty (cache rejected)');
  } else {
    // Cache is empty too - normal empty state
    quickTabsState = {};
    console.log('[Manager] Loaded Quick Tabs state: empty');
  }
}

/**
 * Detect and handle storage storm (0 tabs but cache has tabs)
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Allow legitimate single-tab deletions (cache=1, storage=0)
 *   Storage storms are detected when MULTIPLE tabs vanish unexpectedly.
 *   A single tab going to 0 is legitimate user action.
 * v1.6.3.6-v12 - FIX Issue #5: Trigger reconciliation instead of silently using cache
 * v1.6.3.7-v4 - FIX Issue #6: Validate session before using cache in storm detection
 * @param {Object} state - Storage state
 * @returns {boolean} True if storm detected and handled
 */
function _detectStorageStorm(state) {
  const storageTabs = state.tabs || [];
  const cacheTabs = inMemoryTabsCache.tabs || [];
  const cacheSessionId = inMemoryTabsCache.sessionId || '';

  // No storm if storage has tabs
  if (storageTabs.length !== 0) {
    return false;
  }

  // No cache to protect - no storm possible
  if (cacheTabs.length < MIN_TABS_FOR_CACHE_PROTECTION) {
    return false;
  }

  // v1.6.3.7-v4 - FIX Issue #6: Validate session before using cache
  if (cacheSessionId !== currentSessionId) {
    console.warn(
      '[Manager] ⚠️ STALE_CACHE_IGNORED: Cache is from different session during storm detection',
      {
        cacheSessionId,
        currentSessionId,
        cacheTabCount: cacheTabs.length,
        warning: 'Not using stale cache for fallback'
      }
    );
    inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
    lastKnownGoodTabCount = 0;
    return false; // No valid cache to use
  }

  // v1.6.3.5-v11 - FIX Issue #6: Single tab deletion is legitimate, not a storm
  // If cache has exactly 1 tab and storage has 0, user closed the last Quick Tab
  if (cacheTabs.length === 1) {
    console.log(
      '[Manager] Single tab→0 transition detected - clearing cache (legitimate deletion)'
    );
    // Clear the cache to accept the new 0-tab state
    inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
    lastKnownGoodTabCount = 0;
    return false; // Not a storm - proceed with normal update
  }

  // v1.6.3.6-v12 - FIX Issue #5: CACHE_DIVERGENCE - trigger reconciliation
  console.warn('[Manager] v1.6.3.6-v12 CACHE_DIVERGENCE:', {
    storageTabCount: storageTabs.length,
    cacheTabCount: cacheTabs.length,
    lastKnownGoodCount: lastKnownGoodTabCount,
    saveId: state.saveId,
    cacheSessionId,
    currentSessionId
  });

  // v1.6.3.7-v4 - FIX Issue #6: Log fallback rescue with warning
  console.warn('[Manager] ⚠️ FALLBACK_RESCUE_TRIGGERED:', {
    reason: 'Storage shows 0 tabs but cache has valid data from current session',
    cacheTabs: cacheTabs.length,
    sessionMatch: cacheSessionId === currentSessionId,
    action: 'Using cache temporarily while reconciling with content scripts'
  });

  // v1.6.3.6-v12 - FIX Issue #5: Trigger reconciliation with content scripts
  _triggerCacheReconciliation();

  // Temporarily use cache to prevent blank UI while reconciliation runs
  quickTabsState = { tabs: cacheTabs, timestamp: Date.now() };
  console.log('[Manager] Using in-memory cache temporarily during reconciliation');
  return true;
}

/**
 * Trigger reconciliation with content scripts when cache diverges from storage
 * v1.6.3.6-v12 - FIX Issue #5: Query content scripts and restore to STORAGE if needed
 * v1.6.3.6-v12 - FIX Code Review: Use module-level imports instead of dynamic import
 * v1.6.3.7-v4 - FIX Issue #6: Update cache with new object structure
 */
async function _triggerCacheReconciliation() {
  console.log('[Manager] v1.6.3.6-v12 Starting cache reconciliation...');

  try {
    // Query all content scripts for their Quick Tabs
    // v1.6.3.6-v12 - FIX Code Review: Using module-level import
    const contentScriptTabs = await queryAllContentScriptsForQuickTabs();
    const cacheTabs = inMemoryTabsCache.tabs || [];

    console.log('[Manager] v1.6.3.6-v12 Reconciliation found:', {
      contentScriptTabCount: contentScriptTabs.length,
      cacheTabCount: cacheTabs.length
    });

    if (contentScriptTabs.length > 0) {
      // v1.6.3.6-v12 - FIX Issue #5: Content scripts have tabs - restore to STORAGE
      console.warn(
        '[Manager] CORRUPTION CONFIRMED: Content scripts have tabs but storage is empty'
      );
      console.log('[Manager] v1.6.3.6-v12 Restoring state to storage...');

      const restoredState = await restoreStateFromContentScripts(contentScriptTabs);
      quickTabsState = restoredState;
      // v1.6.3.7-v4 - FIX Issue #6: Update cache with new object structure
      inMemoryTabsCache = {
        tabs: [...restoredState.tabs],
        timestamp: Date.now(),
        sessionId: currentSessionId
      };
      lastKnownGoodTabCount = restoredState.tabs.length;

      console.log(
        '[Manager] v1.6.3.6-v12 Reconciliation complete: Restored',
        contentScriptTabs.length,
        'tabs to storage'
      );
      renderUI(); // Re-render with restored state
    } else {
      // v1.6.3.6-v12 - FIX Issue #5: Content scripts also show 0 - accept 0 and clear cache
      console.log('[Manager] v1.6.3.6-v12 Content scripts confirm 0 tabs - accepting empty state');
      // v1.6.3.7-v4 - FIX Issue #6: Clear cache with new object structure
      inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
      lastKnownGoodTabCount = 0;
      quickTabsState = { tabs: [], timestamp: Date.now() };
      renderUI();
    }
  } catch (err) {
    console.error('[Manager] v1.6.3.6-v12 Reconciliation error:', err.message);
    // Keep using cache on error - better than showing blank
  }
}

/**
 * Update in-memory cache with valid state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Also update cache when tabs.length is 0 (legitimate deletion)
 *   The cache must be cleared when tabs legitimately reach 0, not just updated when > 0.
 * v1.6.3.7-v4 - FIX Issue #6: Added session ID and timestamp to cache structure
 * @param {Array} tabs - Tabs array from storage
 */
function _updateInMemoryCache(tabs) {
  if (tabs.length > 0) {
    // v1.6.3.7-v4 - FIX Issue #6: Store with session ID and timestamp
    inMemoryTabsCache = {
      tabs: [...tabs],
      timestamp: Date.now(),
      sessionId: currentSessionId
    };
    lastKnownGoodTabCount = tabs.length;
    console.log('[Manager] Updated in-memory cache:', {
      tabCount: tabs.length,
      sessionId: currentSessionId,
      timestamp: inMemoryTabsCache.timestamp
    });
  } else if (lastKnownGoodTabCount === 1) {
    // v1.6.3.5-v11 - FIX Issue #6: Clear cache when going from 1→0 (single-tab deletion)
    console.log('[Manager] Clearing in-memory cache (single-tab deletion detected)');
    inMemoryTabsCache = { tabs: [], timestamp: 0, sessionId: '' };
    lastKnownGoodTabCount = 0;
  }
  // Note: If lastKnownGoodTabCount > 1 and tabs.length === 0, we don't clear the cache
  // because this might be a storage storm. _detectStorageStorm handles that case.
}

/**
 * Load Quick Tabs state from browser.storage.local
 * v1.6.3 - FIX: Changed from storage.sync to storage.local (storage location since v1.6.0.12)
 * v1.6.3.4-v6 - FIX Issue #1: Debounce reads to avoid mid-transaction reads
 * v1.6.3.5-v4 - FIX Diagnostic Issue #2: Use in-memory cache to protect against storage storms
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read operations
 * v1.6.3.7-v6 - Gap #1: STATE_LOAD_STARTED and STATE_LOAD_COMPLETED logging
 * v1.6.4.18 - Refactored to reduce CC from 10 to ~5
 * Refactored: Extracted helpers to reduce complexity and nesting depth
 */
async function loadQuickTabsState() {
  const loadStartTime = Date.now();
  _logStateLoadStarted(loadStartTime);

  try {
    const state = await _fetchStorageState(loadStartTime);
    _processStorageStateResult(state, loadStartTime);
  } catch (err) {
    _handleStateLoadError(err, loadStartTime);
  }
}

/**
 * Log state load started event
 * v1.6.4.18 - Extracted from loadQuickTabsState to reduce CC
 * @private
 * @param {number} loadStartTime - Load start timestamp
 */
function _logStateLoadStarted(loadStartTime) {
  console.log('[Manager] STATE_LOAD_STARTED:', {
    timestamp: loadStartTime,
    sessionId: currentSessionId,
    existingTabCount: quickTabsState?.tabs?.length ?? 0
  });
}

/**
 * Fetch state from storage with debounce check
 * v1.6.4.18 - Extracted from loadQuickTabsState to reduce CC
 * @private
 * @param {number} loadStartTime - Load start timestamp
 * @returns {Promise<Object|null>} Storage state or null
 */
async function _fetchStorageState(loadStartTime) {
  await checkStorageDebounce();
  console.log('[Manager] Reading Quick Tab state from storage...');

  const result = await browser.storage.local.get(STATE_KEY);
  const state = result?.[STATE_KEY];

  if (state) {
    _logStorageReadResult(state, loadStartTime);
  }

  return state;
}

/**
 * Log storage read result
 * v1.6.4.18 - Extracted from loadQuickTabsState
 * @private
 * @param {Object} state - Loaded state
 * @param {number} loadStartTime - Load start timestamp
 */
function _logStorageReadResult(state, loadStartTime) {
  console.log('[Manager] Storage read result:', {
    tabCount: state.tabs?.length ?? 0,
    saveId: state.saveId,
    timestamp: state.timestamp,
    source: 'storage.local',
    durationMs: Date.now() - loadStartTime
  });
}

/**
 * Process storage state result
 * v1.6.4.18 - Extracted from loadQuickTabsState to reduce CC
 * @private
 * @param {Object|null} state - Loaded state or null
 * @param {number} loadStartTime - Load start timestamp
 */
function _processStorageStateResult(state, loadStartTime) {
  if (!state) {
    _handleEmptyStorageState();
    _logStateLoadCompleted('empty', 0, loadStartTime);
    return;
  }

  if (_isStateUnchanged(state, loadStartTime)) {
    return;
  }

  if (_detectStorageStorm(state)) {
    return;
  }

  _processLoadedState(state, loadStartTime);
}

/**
 * Check if state is unchanged (hash match)
 * v1.6.4.18 - Extracted from loadQuickTabsState to reduce CC
 * @private
 * @param {Object} state - Loaded state
 * @param {number} loadStartTime - Load start timestamp
 * @returns {boolean} True if unchanged
 */
function _isStateUnchanged(state, loadStartTime) {
  const newHash = computeStateHash(state);
  if (newHash !== lastRenderedStateHash) {
    return false;
  }

  console.log('[Manager] Storage state unchanged (hash match), skipping update');
  _logStateLoadCompleted('skipped-hash-match', state.tabs?.length ?? 0, loadStartTime);
  return true;
}

/**
 * Handle state load error
 * v1.6.4.18 - Extracted from loadQuickTabsState to reduce CC
 * @private
 * @param {Error} err - Error object
 * @param {number} loadStartTime - Load start timestamp
 */
function _handleStateLoadError(err, loadStartTime) {
  _logStateLoadCompleted('error', 0, loadStartTime, err.message);
  console.error('[Manager] Error loading Quick Tabs state:', err);
}

/**
 * Log state load completed event
 * v1.6.3.7-v6 - Gap #1: Extracted to reduce loadQuickTabsState complexity
 * @private
 * @param {string} status - Load status
 * @param {number} tabCount - Number of tabs loaded
 * @param {number} startTime - Load start time
 * @param {string} [error] - Error message if failed
 */
function _logStateLoadCompleted(status, tabCount, startTime, error = null) {
  const logData = {
    status,
    tabCount,
    durationMs: Date.now() - startTime,
    source: 'storage.local'
  };
  if (error) {
    logData.error = error;
  }
  if (status === 'success') {
    logData.saveId = quickTabsState?.saveId;
  }
  console.log('[Manager] STATE_LOAD_COMPLETED:', logData);
}

/**
 * Process loaded state and update local cache
 * v1.6.3.7-v6 - Extracted to reduce loadQuickTabsState complexity
 * @private
 * @param {Object} state - Loaded state object
 * @param {number} loadStartTime - When load started
 */
function _processLoadedState(state, loadStartTime) {
  // v1.6.3.5-v4 - Update cache with new valid state
  _updateInMemoryCache(state.tabs || []);

  quickTabsState = state;
  filterInvalidTabs(quickTabsState);

  // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive new state from storage
  lastLocalUpdateTime = Date.now();

  _logStateLoadCompleted('success', quickTabsState.tabs?.length ?? 0, loadStartTime);
  console.log('[Manager] Loaded Quick Tabs state:', quickTabsState);
}

/**
 * Update UI stats (total tabs and last sync time)
 * @param {number} totalTabs - Number of Quick Tabs
 * @param {number} latestTimestamp - Timestamp of last sync
 */
function updateUIStats(totalTabs, latestTimestamp) {
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  const effectiveTimestamp = lastLocalUpdateTime > 0 ? lastLocalUpdateTime : latestTimestamp;

  if (effectiveTimestamp > 0) {
    const date = new Date(effectiveTimestamp);
    const timeStr = date.toLocaleTimeString();
    lastSyncEl.textContent = `Last sync: ${timeStr}`;

    console.log('[Manager] Last sync updated:', {
      timestamp: effectiveTimestamp,
      formatted: timeStr,
      totalTabs
    });
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
  }
}

/**
 * Render the Quick Tabs Manager UI (debounced)
 * v1.6.3.7 - FIX Issue #3: Debounced to max once per 300ms to prevent UI flicker
 * v1.6.4.0 - FIX Issue D: Hash-based state staleness detection during debounce
 * This is the public API - all callers should use this function.
 */
function renderUI() {
  // v1.6.3.7 - FIX Issue #3: Set flag indicating render is pending
  pendingRenderUI = true;

  // v1.6.4.0 - FIX Issue D: Capture state hash when debounce is set
  capturedStateHashAtDebounce = computeStateHash(quickTabsState);
  debounceSetTimestamp = Date.now();

  // Clear any existing debounce timer
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }

  // Schedule the actual render
  renderDebounceTimer = setTimeout(async () => {
    renderDebounceTimer = null;

    // Only render if still pending (wasn't cancelled)
    if (!pendingRenderUI) {
      console.log('[Manager] Skipping debounced render - no longer pending');
      return;
    }

    pendingRenderUI = false;

    // v1.6.4.0 - FIX Issue D: Check if state changed during debounce wait
    const staleCheckResult = await _checkAndReloadStaleState();
    if (staleCheckResult.stateReloaded) {
      console.log(
        '[Manager] State changed while debounce was waiting, rendering with fresh state',
        staleCheckResult
      );
    }

    // Recalculate hash after potential fresh load
    const finalHash = computeStateHash(quickTabsState);
    if (finalHash === lastRenderedHash) {
      console.log('[Manager] Skipping render - state hash unchanged', {
        hash: finalHash,
        tabCount: quickTabsState?.tabs?.length ?? 0
      });
      return;
    }

    // v1.6.3.7 - Update hash before render to prevent re-render loops even if _renderUIImmediate() throws
    // This ensures consistent state even on render failure
    lastRenderedHash = finalHash;
    lastRenderedStateHash = finalHash;

    // Synchronize DOM mutation with requestAnimationFrame
    requestAnimationFrame(() => {
      _renderUIImmediate();
    });
  }, RENDER_DEBOUNCE_MS);
}

/**
 * Check for stale state during debounce and reload if needed
 * v1.6.4.0 - FIX Issue D: Extracted to reduce nesting depth
 * @private
 * @returns {Promise<{ stateReloaded: boolean, capturedHash: number, currentHash: number, debounceWaitMs: number }>}
 */
async function _checkAndReloadStaleState() {
  const currentHash = computeStateHash(quickTabsState);
  const debounceWaitTime = Date.now() - debounceSetTimestamp;

  if (currentHash === capturedStateHashAtDebounce) {
    return {
      stateReloaded: false,
      capturedHash: capturedStateHashAtDebounce,
      currentHash,
      debounceWaitMs: debounceWaitTime
    };
  }

  // State changed during wait - fetch fresh state from storage to ensure consistency
  await _loadFreshStateFromStorage();

  return {
    stateReloaded: true,
    capturedHash: capturedStateHashAtDebounce,
    currentHash,
    debounceWaitMs: debounceWaitTime
  };
}

/**
 * Load fresh state from storage during debounce stale check
 * v1.6.4.0 - FIX Issue D: Extracted to reduce nesting depth
 * @private
 */
async function _loadFreshStateFromStorage() {
  try {
    const freshResult = await browser.storage.local.get(STATE_KEY);
    const freshState = freshResult?.[STATE_KEY];
    if (freshState?.tabs) {
      quickTabsState = freshState;
      _updateInMemoryCache(freshState.tabs);
      console.log('[Manager] Loaded fresh state from storage (stale prevention)');
    }
  } catch (err) {
    console.warn('[Manager] Failed to load fresh state, using current:', err.message);
  }
}

/**
 * Force immediate render (bypasses debounce)
 * v1.6.3.7 - FIX Issue #3: Use for critical updates that can't wait
 */
function _renderUIImmediate_force() {
  pendingRenderUI = false;
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
}

/**
 * Internal render function - performs actual DOM manipulation
 * v1.6.3.7-v3 - FIX Issue #3: Uses reconciliation for differential updates
 *   - Prevents CSS animation flickering by keeping existing DOM elements
 *   - Only adds/removes DOM for actual changes
 *   - Updates existing elements in-place
 * v1.6.3.7 - FIX Issue #3: Renamed from renderUI, now called via debounce wrapper
 * v1.6.3.7 - FIX Issue #8: Enhanced render logging for debugging
 */
async function _renderUIImmediate() {
  const renderStartTime = Date.now();
  const { allTabs, latestTimestamp } = extractTabsFromState(quickTabsState);

  // v1.6.3.7 - FIX Issue #8: Log render entry with trigger reason
  const triggerReason = pendingRenderUI ? 'debounced' : 'direct';
  console.log('[Manager] RENDER_UI: entry', {
    triggerReason,
    tabCount: allTabs.length,
    timestamp: renderStartTime
  });

  _logRenderStart(allTabs);
  updateUIStats(allTabs.length, latestTimestamp);

  if (allTabs.length === 0) {
    _showEmptyState();
    // v1.6.3.6-v11 - FIX Issue #20: Clean up count tracking when empty
    previousGroupCounts.clear();

    // v1.6.3.7 - FIX Issue #8: Log render exit
    console.log('[Manager] RENDER_UI: exit (empty state)', {
      triggerReason,
      tabsRendered: 0,
      groupsCreated: 0,
      durationMs: Date.now() - renderStartTime
    });
    return;
  }

  _showContentState();
  const groups = groupQuickTabsByOriginTab(allTabs);
  const collapseState = await loadCollapseState();

  _logGroupRendering(groups);

  // v1.6.3.6-v11 - FIX Issue #20: Clean up stale count tracking
  const currentGroupKeys = new Set([...groups.keys()].map(String));
  cleanupPreviousGroupCounts(currentGroupKeys);

  // v1.6.3.7-v3 - FIX Issue #3: Use reconciliation instead of full rebuild
  await _reconcileGroups(groups, collapseState);

  // v1.6.3.7 - FIX Issue #3: Update hash tracker after successful render
  lastRenderedHash = computeStateHash(quickTabsState);
  lastRenderedStateHash = lastRenderedHash; // Keep both in sync for compatibility

  // v1.6.3.7 - FIX Issue #8: Log render exit with summary
  console.log('[Manager] RENDER_UI: exit', {
    triggerReason,
    tabsRendered: allTabs.length,
    groupsCreated: groups.size,
    durationMs: Date.now() - renderStartTime
  });

  _logRenderComplete(allTabs, groups, renderStartTime);
}

/**
 * Log render start with comprehensive details
 * @private
 */
function _logRenderStart(allTabs) {
  const activeTabs = allTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = allTabs.filter(t => isTabMinimizedHelper(t));

  console.log('[Manager] UI Rebuild starting:', {
    totalTabs: allTabs.length,
    activeCount: activeTabs.length,
    minimizedCount: minimizedTabs.length,
    cacheCount: inMemoryTabsCache.length,
    lastRenderedHash: lastRenderedStateHash,
    trigger: '_renderUIImmediate()',
    timestamp: Date.now()
  });

  console.log('[Manager] UI List contents:', {
    activeTabIds: activeTabs.map(t => ({ id: t.id, url: t.url?.substring(0, 50) })),
    minimizedTabIds: minimizedTabs.map(t => ({ id: t.id, minimized: true }))
  });
}

/**
 * Show empty state UI
 * v1.6.3.7-v3 - FIX Issue #3: Clear DOM element tracking maps when empty
 * @private
 */
function _showEmptyState() {
  containersList.style.display = 'none';
  emptyState.style.display = 'flex';

  // v1.6.3.7-v3 - FIX Issue #3: Clear tracking maps when going to empty state
  _itemElements.clear();
  _groupElements.clear();
  _groupsContainer = null;
  containersList.innerHTML = '';

  console.log('[Manager] UI showing empty state (0 tabs)');
}

/**
 * Show content state UI (prepare for reconciliation)
 * v1.6.3.7-v3 - FIX Issue #3: No longer clears innerHTML, uses reconciliation instead
 * @private
 */
function _showContentState() {
  containersList.style.display = 'block';
  emptyState.style.display = 'none';
  // v1.6.3.7-v3 - FIX Issue #3: Removed innerHTML = '' to enable reconciliation
  // DOM elements are now managed via _reconcileGroups()
}

/**
 * Log group rendering info
 * @private
 */
function _logGroupRendering(groups) {
  console.log('[Manager] Issue #1: Rendering groups directly (no global header)', {
    groupCount: groups.size,
    groupKeys: [...groups.keys()]
  });
}

/**
 * Build the groups container with all tab groups
 * @private
 */
async function _buildGroupsContainer(groups, collapseState) {
  const groupsContainer = document.createElement('div');
  groupsContainer.className = 'tab-groups-container';

  const sortedGroupKeys = _getSortedGroupKeys(groups);
  await _fetchMissingTabInfo(sortedGroupKeys, groups);
  _resortGroupKeys(sortedGroupKeys, groups);

  for (const groupKey of sortedGroupKeys) {
    const group = groups.get(groupKey);
    if (_shouldSkipGroup(group, groupKey)) continue;

    const detailsEl = renderTabGroup(groupKey, group, collapseState);
    groupsContainer.appendChild(detailsEl);
  }

  return groupsContainer;
}

// ==================== v1.6.3.7-v3 DOM RECONCILIATION FUNCTIONS ====================
// FIX Issue #3: Differential DOM updates to prevent CSS animation flickering

/**
 * Reconcile groups - differential update of the groups container
 * v1.6.3.7-v3 - FIX Issue #3: Main reconciliation entry point
 * v1.6.4.17 - Refactored to flatten bumpy road (bumps=2)
 * @private
 * @param {Map} groups - Map of groupKey -> { quickTabs: [], tabInfo: {} }
 * @param {Object} collapseState - Collapse state for groups
 */
async function _reconcileGroups(groups, collapseState) {
  const startTime = Date.now();

  _ensureGroupsContainerExists();

  const sortedGroupKeys = _getSortedGroupKeys(groups);
  await _fetchMissingTabInfo(sortedGroupKeys, groups);
  _resortGroupKeys(sortedGroupKeys, groups);

  const existingGroupKeys = new Set(_groupElements.keys());
  const newGroupKeys = new Set(sortedGroupKeys.map(k => String(k)));

  const diff = _calculateGroupsDiff(existingGroupKeys, newGroupKeys, sortedGroupKeys);
  _logReconcileDiff(existingGroupKeys, newGroupKeys, diff);
  _applyGroupsDiff(diff, groups, collapseState, sortedGroupKeys);

  _reorderGroups(sortedGroupKeys);
  attachCollapseEventListeners(_groupsContainer, collapseState);

  console.log('[Manager] RECONCILE_COMPLETE:', {
    durationMs: Date.now() - startTime,
    finalGroupCount: _groupElements.size,
    finalItemCount: _itemElements.size
  });
}

/**
 * Ensure groups container exists and is in DOM
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 */
function _ensureGroupsContainerExists() {
  if (_groupsContainer && containersList.contains(_groupsContainer)) {
    return;
  }

  _groupsContainer = document.createElement('div');
  _groupsContainer.className = 'tab-groups-container';
  containersList.innerHTML = '';
  containersList.appendChild(_groupsContainer);
  _groupElements.clear();
  _itemElements.clear();

  console.log('[Manager] RECONCILE: Created fresh groups container');
}

/**
 * Calculate diff between existing and new group keys
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 * @param {Set} existingGroupKeys - Keys currently in DOM
 * @param {Set} newGroupKeys - Keys in new state
 * @param {Array} sortedGroupKeys - Sorted array of group keys
 * @returns {Object} Diff with toRemove, toAdd, toUpdate arrays
 */
function _calculateGroupsDiff(existingGroupKeys, newGroupKeys, sortedGroupKeys) {
  return {
    toRemove: [...existingGroupKeys].filter(k => !newGroupKeys.has(k)),
    toAdd: sortedGroupKeys.filter(k => !existingGroupKeys.has(String(k))),
    toUpdate: sortedGroupKeys.filter(k => existingGroupKeys.has(String(k)))
  };
}

/**
 * Log reconcile diff summary
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 * @param {Set} existingGroupKeys - Keys currently in DOM
 * @param {Set} newGroupKeys - Keys in new state
 * @param {Object} diff - Calculated diff
 */
function _logReconcileDiff(existingGroupKeys, newGroupKeys, diff) {
  console.log('[Manager] RECONCILE_GROUPS:', {
    existing: existingGroupKeys.size,
    incoming: newGroupKeys.size,
    toRemove: diff.toRemove.length,
    toAdd: diff.toAdd.length,
    toUpdate: diff.toUpdate.length
  });
}

/**
 * Apply groups diff to DOM
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 * @param {Object} diff - Diff with toRemove, toAdd, toUpdate arrays
 * @param {Map} groups - Groups map
 * @param {Object} collapseState - Collapse state
 * @param {Array} sortedGroupKeys - Sorted group keys
 */
function _applyGroupsDiff(diff, groups, collapseState, sortedGroupKeys) {
  _removeDeletedGroups(diff.toRemove);
  _updateExistingGroups(diff.toUpdate, groups, collapseState);
  _addNewGroups(diff.toAdd, groups, collapseState, sortedGroupKeys);
}

/**
 * Remove deleted groups with exit animation
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 * @param {Array} groupsToRemove - Group keys to remove
 */
function _removeDeletedGroups(groupsToRemove) {
  for (const groupKey of groupsToRemove) {
    _removeGroup(groupKey);
  }
}

/**
 * Update existing groups in-place
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 * @param {Array} groupsToUpdate - Group keys to update
 * @param {Map} groups - Groups map
 * @param {Object} collapseState - Collapse state
 */
function _updateExistingGroups(groupsToUpdate, groups, collapseState) {
  for (const groupKey of groupsToUpdate) {
    const group = groups.get(groupKey);
    if (_shouldSkipGroup(group, groupKey)) {
      _removeGroup(String(groupKey));
      continue;
    }
    _updateGroup(String(groupKey), group, collapseState);
  }
}

/**
 * Add new groups with entrance animation
 * v1.6.4.17 - Extracted from _reconcileGroups
 * @private
 * @param {Array} groupsToAdd - Group keys to add
 * @param {Map} groups - Groups map
 * @param {Object} collapseState - Collapse state
 * @param {Array} sortedGroupKeys - Sorted group keys for ordering
 */
function _addNewGroups(groupsToAdd, groups, collapseState, sortedGroupKeys) {
  for (const groupKey of groupsToAdd) {
    const group = groups.get(groupKey);
    if (_shouldSkipGroup(group, groupKey)) continue;
    _addGroup(groupKey, group, collapseState, sortedGroupKeys);
  }
}

/**
 * Remove a group from the DOM with exit animation
 * v1.6.3.7-v3 - FIX Issue #3: Animated group removal
 * @private
 * @param {string} groupKey - Group key to remove
 */
function _removeGroup(groupKey) {
  const groupEl = _groupElements.get(groupKey);
  if (!groupEl) return;

  console.log('[Manager] RECONCILE_REMOVE_GROUP:', { groupKey });

  // Remove item tracking for this group's items
  const itemsInGroup = groupEl.querySelectorAll('.quick-tab-item[data-tab-id]');
  itemsInGroup.forEach(item => {
    _itemElements.delete(item.dataset.tabId);
  });

  // Use animated removal from render-helpers
  animateGroupRemoval(groupEl);
  _groupElements.delete(groupKey);
}

/**
 * Add a new group to the DOM
 * v1.6.3.7-v3 - FIX Issue #3: New groups get entrance animation
 * @private
 * @param {string|number} groupKey - Group key
 * @param {Object} group - Group data
 * @param {Object} collapseState - Collapse state
 * @param {Array} sortedGroupKeys - Sorted keys for positioning
 */
function _addGroup(groupKey, group, collapseState, sortedGroupKeys) {
  console.log('[Manager] RECONCILE_ADD_GROUP:', {
    groupKey,
    tabCount: group.quickTabs?.length ?? 0
  });

  const detailsEl = renderTabGroup(groupKey, group, collapseState);
  _groupElements.set(String(groupKey), detailsEl);

  // Track all items in this new group and add new-item class for animation
  const itemsInGroup = detailsEl.querySelectorAll('.quick-tab-item[data-tab-id]');
  itemsInGroup.forEach(item => {
    _itemElements.set(item.dataset.tabId, item);
    // v1.6.3.7-v3 - FIX Issue #3: Items in new groups get entrance animation
    item.classList.add('new-item');
    setTimeout(() => item.classList.remove('new-item'), ANIMATION_DURATION_MS);
  });

  // Insert at correct position
  const keyIndex = sortedGroupKeys.indexOf(groupKey);
  const nextGroupKey = sortedGroupKeys[keyIndex + 1];
  const nextGroupEl = nextGroupKey ? _groupElements.get(String(nextGroupKey)) : null;

  if (nextGroupEl && _groupsContainer.contains(nextGroupEl)) {
    _groupsContainer.insertBefore(detailsEl, nextGroupEl);
  } else {
    _groupsContainer.appendChild(detailsEl);
  }
}

/**
 * Update an existing group in-place without recreating it
 * v1.6.3.7-v3 - FIX Issue #3: Updates header and reconciles items without animation
 * @private
 * @param {string} groupKey - Group key
 * @param {Object} group - Group data
 * @param {Object} _collapseState - Collapse state (unused, kept for API consistency)
 */
function _updateGroup(groupKey, group, _collapseState) {
  const groupEl = _groupElements.get(groupKey);
  if (!groupEl) return;

  // Update header elements (count, title, badges)
  _updateGroupHeader(groupEl, groupKey, group);

  // Reconcile items within the group
  const content = groupEl.querySelector('.tab-group-content');
  if (content) {
    _reconcileGroupItems(content, group.quickTabs, groupKey);
  }
}

/**
 * Update group header elements without recreating the group
 * v1.6.3.7-v3 - FIX Issue #3: In-place header updates
 * @private
 * @param {HTMLElement} groupEl - Group details element
 * @param {string} groupKey - Group key
 * @param {Object} group - Group data
 */
function _updateGroupHeader(groupEl, groupKey, group) {
  _updateCountBadge(groupEl, groupKey, group);
  _updateGroupTitle(groupEl, group);
}

/**
 * Update count badge in group header
 * v1.6.4.18 - Extracted from _updateGroupHeader to reduce CC
 * @private
 * @param {HTMLElement} groupEl - Group details element
 * @param {string} groupKey - Group key
 * @param {Object} group - Group data
 */
function _updateCountBadge(groupEl, groupKey, group) {
  const countEl = groupEl.querySelector('.tab-group-count');
  if (!countEl) {
    return;
  }

  const newCount = group.quickTabs?.length ?? 0;
  if (countEl.textContent === String(newCount)) {
    return;
  }

  animateCountBadgeIfChanged(groupKey, newCount, countEl);
  countEl.textContent = String(newCount);
  countEl.dataset.count = String(newCount);
}

/**
 * Update title in group header
 * v1.6.4.18 - Extracted from _updateGroupHeader to reduce CC
 * @private
 * @param {HTMLElement} groupEl - Group details element
 * @param {Object} group - Group data
 */
function _updateGroupTitle(groupEl, group) {
  const titleEl = groupEl.querySelector('.tab-group-title');
  if (!titleEl) {
    return;
  }

  const newTitle = group.tabInfo?.title;
  if (!newTitle || titleEl.textContent === newTitle) {
    return;
  }

  titleEl.textContent = newTitle;
  titleEl.title = group.tabInfo.url || '';
}

/**
 * Reconcile items within a group content element
 * v1.6.3.7-v3 - FIX Issue #3: Differential item updates within groups
 * @private
 * @param {HTMLElement} content - Group content element
 * @param {Array} quickTabs - Array of Quick Tab data
 * @param {string} groupKey - Group key for logging
 */
function _reconcileGroupItems(content, quickTabs, groupKey) {
  // Sort: active first, then minimized
  const sortedTabs = [...quickTabs].sort((a, b) => {
    return (isTabMinimizedHelper(a) ? 1 : 0) - (isTabMinimizedHelper(b) ? 1 : 0);
  });

  const existingItemIds = new Set();
  content.querySelectorAll('.quick-tab-item[data-tab-id]').forEach(item => {
    existingItemIds.add(item.dataset.tabId);
  });

  const newItemIds = new Set(sortedTabs.map(t => t.id));

  // Calculate diff
  const itemsToRemove = [...existingItemIds].filter(id => !newItemIds.has(id));
  const itemsToAdd = sortedTabs.filter(t => !existingItemIds.has(t.id));
  const itemsToUpdate = sortedTabs.filter(t => existingItemIds.has(t.id));

  // 1. Remove deleted items
  for (const itemId of itemsToRemove) {
    _removeQuickTabItem(itemId, content);
  }

  // 2. Update existing items (in-place)
  for (const tab of itemsToUpdate) {
    _updateQuickTabItem(tab);
  }

  // 3. Add new items
  for (const tab of itemsToAdd) {
    _addQuickTabItem(tab, content, sortedTabs);
  }

  // Update section headers if needed
  _updateSectionHeaders(content, sortedTabs);

  console.log('[Manager] RECONCILE_GROUP_ITEMS:', {
    groupKey,
    removed: itemsToRemove.length,
    added: itemsToAdd.length,
    updated: itemsToUpdate.length
  });
}

/**
 * Remove a Quick Tab item from the DOM
 * v1.6.3.7-v3 - FIX Issue #3: Item removal with exit animation
 * @private
 * @param {string} itemId - Quick Tab ID to remove
 * @param {HTMLElement} _content - Content container (unused, kept for API consistency)
 */
function _removeQuickTabItem(itemId, _content) {
  const item = _itemElements.get(itemId);
  if (!item) return;

  console.log('[Manager] RECONCILE_REMOVE_ITEM:', { itemId });

  // Add removing class for exit animation
  item.classList.add('removing');

  // v1.6.3.7-v3 - FIX: Delete from tracking map immediately to prevent
  // duplicate operations during animation, but keep DOM element until animation completes
  _itemElements.delete(itemId);

  // Remove DOM element after animation completes
  setTimeout(() => {
    if (item.parentNode) {
      item.remove();
    }
  }, ANIMATION_DURATION_MS);
}

/**
 * Add a new Quick Tab item to the DOM
 * v1.6.3.7-v3 - FIX Issue #3: New items get entrance animation via .new-item class
 * @private
 * @param {Object} tab - Quick Tab data
 * @param {HTMLElement} content - Content container
 * @param {Array} sortedTabs - All tabs in sorted order for positioning
 */
function _addQuickTabItem(tab, content, sortedTabs) {
  const isMinimized = isTabMinimizedHelper(tab);
  const item = renderQuickTabItem(tab, 'global', isMinimized);

  // v1.6.3.7-v3 - FIX Issue #3: Add new-item class for entrance animation
  item.classList.add('new-item');

  _itemElements.set(tab.id, item);

  // Find correct position
  const tabIndex = sortedTabs.findIndex(t => t.id === tab.id);
  const nextTab = sortedTabs[tabIndex + 1];
  const nextItem = nextTab ? _itemElements.get(nextTab.id) : null;

  // Insert at correct position (after section headers if applicable)
  if (nextItem && content.contains(nextItem)) {
    content.insertBefore(item, nextItem);
  } else {
    // Append at end
    content.appendChild(item);
  }

  // v1.6.3.7-v3 - FIX Issue #3: Remove new-item class after animation completes
  setTimeout(() => {
    item.classList.remove('new-item');
  }, ANIMATION_DURATION_MS);

  console.log('[Manager] RECONCILE_ADD_ITEM:', {
    itemId: tab.id,
    isMinimized,
    position: tabIndex
  });
}

/**
 * Update an existing Quick Tab item in-place
 * v1.6.3.7-v3 - FIX Issue #3: In-place property updates without recreation
 * @private
 * @param {Object} tab - Quick Tab data
 */
function _updateQuickTabItem(tab) {
  const item = _itemElements.get(tab.id);
  if (!item) return;

  const isMinimized = isTabMinimizedHelper(tab);

  // Update minimized state if changed
  _updateItemMinimizedState(item, tab, isMinimized);

  // Update title text
  _updateItemTitle(item, tab);

  // Update meta info (size/position)
  _updateItemMeta(item, tab, isMinimized);

  // Update domVerified warning indicator
  _updateItemStatusIndicator(item, tab, isMinimized);
}

/**
 * Update the minimized state classes and related UI
 * v1.6.3.7-v3 - FIX Issue #3: Extracted to reduce _updateQuickTabItem complexity
 * @private
 */
function _updateItemMinimizedState(item, tab, isMinimized) {
  const wasMinimized = item.classList.contains('minimized');

  if (isMinimized !== wasMinimized) {
    item.classList.toggle('minimized', isMinimized);
    item.classList.toggle('active', !isMinimized);

    // Update action buttons (minimize <-> restore)
    _updateItemActionButtons(item, tab, isMinimized);
  }
}

/**
 * Update the title element of a Quick Tab item
 * v1.6.3.7-v3 - FIX Issue #3: Extracted to reduce _updateQuickTabItem complexity
 * @private
 */
function _updateItemTitle(item, tab) {
  const titleEl = item.querySelector('.tab-title');
  const newTitle = tab.title || 'Quick Tab';

  if (titleEl && titleEl.textContent !== newTitle) {
    titleEl.textContent = newTitle;
    titleEl.title = tab.title || tab.url;
  }
}

/**
 * Update the meta element of a Quick Tab item
 * v1.6.3.7-v3 - FIX Issue #3: Extracted to reduce _updateQuickTabItem complexity
 * @private
 */
function _updateItemMeta(item, tab, isMinimized) {
  const metaEl = item.querySelector('.tab-meta');
  if (!metaEl) return;

  const newMeta = _buildMetaText(tab, isMinimized);
  if (metaEl.textContent !== newMeta) {
    metaEl.textContent = newMeta;
  }
}

/**
 * Update status indicator for a Quick Tab item
 * v1.6.3.7-v3 - FIX Issue #3: In-place status indicator update
 * @private
 */
function _updateItemStatusIndicator(item, tab, isMinimized) {
  const indicator = item.querySelector('.status-indicator');
  if (!indicator) return;

  const indicatorClass = _getIndicatorClass(tab, isMinimized);

  // Remove all indicator classes and add the correct one
  indicator.classList.remove('green', 'yellow', 'orange');
  indicator.classList.add(indicatorClass);

  // Update tooltip for warning state
  if (indicatorClass === 'orange') {
    indicator.title = 'Warning: Window may not be visible. Try restoring again.';
  } else {
    indicator.title = '';
  }
}

/**
 * Update action buttons for a Quick Tab item
 * v1.6.3.7-v3 - FIX Issue #3: Swap minimize/restore buttons on state change
 * @private
 */
function _updateItemActionButtons(item, tab, isMinimized) {
  const actionsEl = item.querySelector('.tab-actions');
  if (!actionsEl) return;

  // Clear existing buttons and add new ones
  // Note: Event delegation is used, so no listeners to preserve
  const newActions = _createTabActions(tab, isMinimized);
  actionsEl.replaceChildren(...newActions.childNodes);
}

/**
 * Build meta text for a Quick Tab item
 * v1.6.3.7-v3 - FIX Issue #3: Helper for meta text generation
 * @private
 */
function _buildMetaText(tab, isMinimized) {
  const metaParts = [];

  if (isMinimized) {
    metaParts.push('Minimized');
  }

  if (tab.activeTabId) {
    metaParts.push(`Tab ${tab.activeTabId}`);
  }

  const sizePosition = _formatSizePosition(tab);
  if (sizePosition) {
    metaParts.push(sizePosition);
  }

  if (tab.slotNumber) {
    metaParts.push(`Slot ${tab.slotNumber}`);
  }

  return metaParts.join(' • ');
}

/**
 * Update section headers in group content
 * v1.6.3.7-v3 - FIX Issue #3: Update section counts without full rebuild
 * @private
 */
function _updateSectionHeaders(content, sortedTabs) {
  // v1.6.3.7-v3 - Optimized: Single pass to count active/minimized tabs
  let activeCount = 0;
  let minimizedCount = 0;
  for (const tab of sortedTabs) {
    if (isTabMinimizedHelper(tab)) {
      minimizedCount++;
    } else {
      activeCount++;
    }
  }

  const hasBothSections = activeCount > 0 && minimizedCount > 0;

  if (hasBothSections) {
    _updateSectionHeaderCounts(content, activeCount, minimizedCount);
  } else {
    _removeSectionElements(content);
  }
}

/**
 * Update section header counts
 * v1.6.3.7-v3 - FIX Issue #3: Extracted to reduce nesting depth
 * @private
 */
function _updateSectionHeaderCounts(content, activeCount, minimizedCount) {
  const headers = content.querySelectorAll('.section-header');
  if (headers[0]) headers[0].textContent = `Active (${activeCount})`;
  if (headers[1]) headers[1].textContent = `Minimized (${minimizedCount})`;
}

/**
 * Remove section elements when only one type of tab exists
 * v1.6.3.7-v3 - FIX Issue #3: Extracted to reduce nesting depth
 * @private
 */
function _removeSectionElements(content) {
  const activeHeader = content.querySelector('.section-header');
  const divider = content.querySelector('.section-divider');
  const minimizedHeader = content.querySelectorAll('.section-header')[1];

  if (activeHeader) activeHeader.remove();
  if (divider) divider.remove();
  if (minimizedHeader) minimizedHeader.remove();
}

/**
 * Reorder groups in the DOM to match sorted order
 * v1.6.3.7-v3 - FIX Issue #3: Ensure correct visual order without recreation
 * @private
 * @param {Array} sortedGroupKeys - Group keys in desired order
 */
function _reorderGroups(sortedGroupKeys) {
  let previousEl = null;

  for (const groupKey of sortedGroupKeys) {
    const groupEl = _groupElements.get(String(groupKey));
    if (!groupEl) continue;

    _repositionGroupElement(groupEl, previousEl);
    previousEl = groupEl;
  }
}

/**
 * Position a group element in the correct location in the DOM
 * v1.6.3.7-v3 - FIX Issue #3: Extracted to reduce nesting depth
 * @private
 */
function _repositionGroupElement(groupEl, previousEl) {
  if (previousEl && groupEl.previousElementSibling !== previousEl) {
    previousEl.after(groupEl);
    return;
  }

  if (!previousEl && _groupsContainer.firstChild !== groupEl) {
    _groupsContainer.insertBefore(groupEl, _groupsContainer.firstChild);
  }
}

// ==================== END DOM RECONCILIATION FUNCTIONS ====================

/**
 * Get sorted group keys (orphaned last, closed before orphaned)
 * @private
 */
function _getSortedGroupKeys(groups) {
  return [...groups.keys()].sort((a, b) => _compareGroupKeys(a, b, groups));
}

/**
 * Compare group keys for sorting
 * @private
 */
function _compareGroupKeys(a, b, groups) {
  if (a === 'orphaned') return 1;
  if (b === 'orphaned') return -1;

  const aGroup = groups.get(a);
  const bGroup = groups.get(b);
  const aClosed = !aGroup.tabInfo;
  const bClosed = !bGroup.tabInfo;

  if (aClosed && !bClosed) return 1;
  if (!aClosed && bClosed) return -1;

  return Number(a) - Number(b);
}

/**
 * Fetch missing browser tab info
 * @private
 */
async function _fetchMissingTabInfo(sortedGroupKeys, groups) {
  for (const groupKey of sortedGroupKeys) {
    const group = groups.get(groupKey);
    if (groupKey !== 'orphaned' && !group.tabInfo) {
      group.tabInfo = await fetchBrowserTabInfo(groupKey);
    }
  }
}

/**
 * Re-sort group keys after fetching tab info
 * @private
 */
function _resortGroupKeys(sortedGroupKeys, groups) {
  sortedGroupKeys.sort((a, b) => _compareGroupKeys(a, b, groups));
}

/**
 * Check if a group should be skipped
 * @private
 */
function _shouldSkipGroup(group, groupKey) {
  if (!group.quickTabs || group.quickTabs.length === 0) {
    console.log(`[Manager] Skipping empty group [${groupKey}]`);
    return true;
  }
  return false;
}

/**
 * Log render completion
 * @private
 */
function _logRenderComplete(allTabs, groups, renderStartTime) {
  const activeTabs = allTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = allTabs.filter(t => isTabMinimizedHelper(t));
  const renderDuration = Date.now() - renderStartTime;

  console.log('[Manager] UI Rebuild complete:', {
    renderedActive: activeTabs.length,
    renderedMinimized: minimizedTabs.length,
    groupCount: groups.size,
    newHash: lastRenderedStateHash,
    durationMs: renderDuration
  });
}

/**
 * Issue #4: Render a single tab group as a <details> element
 * v1.6.4.10 - Enhanced with Issues #2, #4, #5, #6, #8, #9 improvements
 * v1.6.4.0 - FIX Issue C: Added comprehensive logging for orphaned group rendering
 * Refactored to reduce complexity by extracting helper functions
 * @param {number|string} groupKey - originTabId or 'orphaned'
 * @param {Object} group - { quickTabs: Array, tabInfo: Object | null }
 * @param {Object} collapseState - Current collapse state
 * @returns {HTMLDetailsElement}
 */
function renderTabGroup(groupKey, group, collapseState) {
  const details = document.createElement('details');
  details.className = 'tab-group';
  details.dataset.originTabId = String(groupKey);

  const isOrphaned = groupKey === 'orphaned';
  const isClosedTab = !isOrphaned && !group.tabInfo;

  // v1.6.4.0 - FIX Issue C: Log orphaned group rendering
  if (isOrphaned) {
    console.log('[Manager] ORPHANED_GROUP_RENDER:', {
      groupKey,
      tabCount: group.quickTabs.length,
      tabIds: group.quickTabs.map(t => t.id),
      message: 'Rendering orphaned Quick Tabs with adoption UI',
      timestamp: Date.now()
    });
  }

  // Issue #5/#6: Add special classes
  if (isOrphaned) details.classList.add('orphaned');
  if (isClosedTab) details.classList.add('closed-tab-group');

  // Issue #3: Apply saved collapse state (default: expanded)
  details.open = collapseState[groupKey] !== true;

  // Build header and content
  const summary = _createGroupHeader(groupKey, group, isOrphaned, isClosedTab);
  const content = _createGroupContent(group.quickTabs, details.open);

  details.appendChild(summary);
  details.appendChild(content);

  return details;
}

/**
 * Create the group header (summary element)
 * @private
 * @param {number|string} groupKey - Group key
 * @param {Object} group - Group data
 * @param {boolean} isOrphaned - Whether this is the orphaned group
 * @param {boolean} isClosedTab - Whether the browser tab is closed
 * @returns {HTMLElement}
 */
function _createGroupHeader(groupKey, group, isOrphaned, isClosedTab) {
  const summary = document.createElement('summary');
  summary.className = 'tab-group-header';

  // Issue #9: Favicon - use imported createGroupFavicon
  createGroupFavicon(summary, groupKey, group);

  // Title
  const title = _createGroupTitle(groupKey, group, isOrphaned, isClosedTab);
  summary.appendChild(title);

  // Issue #2: Tab ID (non-orphaned only)
  if (!isOrphaned) {
    const tabIdSpan = document.createElement('span');
    tabIdSpan.className = 'tab-group-tab-id';
    tabIdSpan.textContent = `#${groupKey}`;
    summary.appendChild(tabIdSpan);
  }

  // Issue #6: Closed tab badge with detailed tooltip
  if (isClosedTab) {
    const closedBadge = document.createElement('span');
    closedBadge.className = 'closed-tab-badge';
    closedBadge.textContent = '🚫 Closed';
    // Issue #6: Detailed tooltip explaining why tabs cannot be restored
    closedBadge.title =
      'Browser tab has been closed. Quick Tabs in this group cannot be restored to their original tab. Close them or use "Adopt" to move to current tab.';
    summary.appendChild(closedBadge);
  }

  // Issue #5: Orphaned badge with detailed tooltip
  if (isOrphaned) {
    const orphanedBadge = document.createElement('span');
    orphanedBadge.className = 'orphaned-badge';
    orphanedBadge.textContent = '⚠️ Cannot restore';
    // Issue #5: Detailed tooltip explaining orphaned state
    orphanedBadge.title =
      'These Quick Tabs have no associated browser tab (originTabId is null). They cannot be restored. Use "Adopt" button to assign to current tab, or close them.';
    summary.appendChild(orphanedBadge);
  }

  // Issue #2/#10/#20: Count badge with update tracking and animation
  const count = document.createElement('span');
  count.className = 'tab-group-count';
  count.textContent = String(group.quickTabs.length);
  count.dataset.count = String(group.quickTabs.length); // For tracking updates
  // v1.6.3.6-v11 - FIX Issue #20: Apply animation if count changed
  animateCountBadgeIfChanged(groupKey, group.quickTabs.length, count);
  summary.appendChild(count);

  return summary;
}

/**
 * Create group title element
 * @private
 */
function _createGroupTitle(groupKey, group, isOrphaned, _isClosedTab) {
  const title = document.createElement('span');
  title.className = 'tab-group-title';

  if (isOrphaned) {
    title.textContent = '⚠️ Orphaned Quick Tabs';
    title.title =
      'These Quick Tabs belong to browser tabs that have closed. They cannot be restored.';
  } else if (group.tabInfo?.title) {
    title.textContent = group.tabInfo.title;
    title.title = group.tabInfo.url || '';
  } else {
    title.textContent = `Tab ${groupKey}`;
    title.classList.add('closed-tab');
    title.title = 'This browser tab has been closed. Quick Tabs cannot be restored.';
  }

  return title;
}

/**
 * Create group content element with Quick Tab items
 * Issue #2: Removed inline maxHeight initialization - CSS handles initial state
 * Issue #6: Added logging for section header creation
 * @private
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @param {boolean} isOpen - Whether group starts open
 * @returns {HTMLElement}
 */
function _createGroupContent(quickTabs, isOpen) {
  const content = document.createElement('div');
  content.className = 'tab-group-content';

  // Sort: active first, then minimized
  const sortedTabs = [...quickTabs].sort((a, b) => {
    return (isTabMinimizedHelper(a) ? 1 : 0) - (isTabMinimizedHelper(b) ? 1 : 0);
  });

  const activeTabs = sortedTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = sortedTabs.filter(t => isTabMinimizedHelper(t));
  const hasBothSections = activeTabs.length > 0 && minimizedTabs.length > 0;

  // Issue #6: Log section creation with counts before DOM insertion
  console.log('[Manager] Creating group content sections:', {
    activeCount: activeTabs.length,
    minimizedCount: minimizedTabs.length,
    hasBothSections,
    isOpen,
    timestamp: Date.now()
  });

  // Issue #8: Section headers and dividers
  if (hasBothSections) {
    const activeHeader = _createSectionHeader(`Active (${activeTabs.length})`);
    content.appendChild(activeHeader);
    // Issue #6: Confirm DOM insertion
    console.log('[Manager] Section header inserted: Active', { count: activeTabs.length });
  }

  activeTabs.forEach(tab => content.appendChild(renderQuickTabItem(tab, 'global', false)));

  if (hasBothSections) {
    content.appendChild(_createSectionDivider('minimized'));
    const minimizedHeader = _createSectionHeader(`Minimized (${minimizedTabs.length})`);
    content.appendChild(minimizedHeader);
    // Issue #6: Confirm DOM insertion
    console.log('[Manager] Section header inserted: Minimized', { count: minimizedTabs.length });
  }

  minimizedTabs.forEach(tab => content.appendChild(renderQuickTabItem(tab, 'global', true)));

  // Issue #2: DO NOT set inline maxHeight - CSS handles initial state via :not([open])
  // The animation functions (animateCollapse/animateExpand) calculate scrollHeight dynamically
  // Setting inline styles here conflicts with CSS rules and JS animations
  if (!isOpen) {
    // Only set for initially collapsed state - will be managed by animation functions
    content.style.maxHeight = '0';
    content.style.opacity = '0';
  }
  // Issue #2: For open state, rely on CSS defaults (no inline styles)

  return content;
}

/**
 * Create section header element
 * @private
 */
function _createSectionHeader(text) {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = text;
  return header;
}

/**
 * Create section divider element
 * @private
 */
function _createSectionDivider(label) {
  const divider = document.createElement('div');
  divider.className = 'section-divider';
  divider.dataset.label = label;
  return divider;
}

/**
 * Issue #9: Create favicon element with timeout and fallback
/**
 * Issue #1/#5: Attach event listeners for collapse toggle with smooth animations
 * v1.6.3.6-v11 - FIX Issues #1, #5: Animations properly invoked, consistent state terminology
 * v1.6.4.10 - Enhanced with smooth height animations and scroll-into-view
 * @param {HTMLElement} container - Container with <details> elements
 * @param {Object} collapseState - Current collapse state (will be modified)
 */
function attachCollapseEventListeners(container, collapseState) {
  const detailsElements = container.querySelectorAll('details.tab-group');

  for (const details of detailsElements) {
    const content = details.querySelector('.tab-group-content');
    let isAnimating = false;

    // Issue #1: Override default toggle behavior to invoke animation functions
    details.querySelector('summary').addEventListener('click', async e => {
      // Issue #1: Prevent default toggle to manually control via animation functions
      e.preventDefault();

      // Issue #1: isAnimating flag prevents rapid-click issues
      if (isAnimating) {
        console.log(
          `[Manager] Toggle ignored - animation in progress for [${details.dataset.originTabId}]`
        );
        return;
      }
      isAnimating = true;

      const originTabId = details.dataset.originTabId;
      const isCurrentlyOpen = details.open;

      // Issue #5: Use consistent state terminology via imported constants
      const fromState = isCurrentlyOpen ? STATE_OPEN : STATE_CLOSED;
      const toState = isCurrentlyOpen ? STATE_CLOSED : STATE_OPEN;

      // Issue #5: Use unified state transition logging
      logStateTransition(originTabId, 'toggle', fromState, toState, {
        trigger: 'user-click',
        animationPending: true
      });

      if (isCurrentlyOpen) {
        // Issue #1: INVOKE animateCollapse - this was previously not being called
        console.log(`[Manager] Invoking animateCollapse() for group [${originTabId}]`);
        const result = await animateCollapse(details, content);
        console.log(`[Manager] animateCollapse() completed for group [${originTabId}]:`, result);
      } else {
        // Issue #1: INVOKE animateExpand - this was previously not being called
        console.log(`[Manager] Invoking animateExpand() for group [${originTabId}]`);
        const result = await animateExpand(details, content);
        console.log(`[Manager] animateExpand() completed for group [${originTabId}]:`, result);

        // Issue #4: Scroll into view if group is off-screen after expanding
        scrollIntoViewIfNeeded(details);
      }

      // Update collapse state
      const isNowCollapsed = !details.open;
      if (isNowCollapsed) {
        collapseState[originTabId] = true;
      } else {
        delete collapseState[originTabId];
      }

      // Issue #3: Save to storage
      await saveCollapseState(collapseState);

      isAnimating = false;
    });
  }
}

/**
 * Render a single Quick Tab item
 */

/**
 * v1.6.3.4-v3 - Helper to get position value from flat or nested format
 * @param {Object} tab - Quick Tab data
 * @param {string} flatKey - Key for flat format (e.g., 'width')
 * @param {string} nestedKey - Key for nested format (e.g., 'size')
 * @param {string} prop - Property name (e.g., 'width')
 * @returns {number|undefined} The value or undefined
 */
function _getValue(tab, flatKey, nestedKey, prop) {
  return tab[flatKey] ?? tab[nestedKey]?.[prop];
}

/**
 * v1.6.3.4 - Helper to format size and position string for tab metadata
 * Extracted to reduce complexity in _createTabInfo
 * FIX Issue #3: Only show position if both left and top are defined
 * v1.6.3.4-v3 - FIX TypeError: Handle both flat and nested position/size formats
 * @param {Object} tab - Quick Tab data
 * @returns {string|null} Formatted size/position string or null
 */
function _formatSizePosition(tab) {
  // v1.6.3.4-v3 - FIX TypeError: Handle both flat (width/height) and nested (size.width) formats
  const width = _getValue(tab, 'width', 'size', 'width');
  const height = _getValue(tab, 'height', 'size', 'height');

  if (!width || !height) {
    return null;
  }

  let sizeStr = `${Math.round(width)}×${Math.round(height)}`;

  // v1.6.3.4-v3 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
  const left = _getValue(tab, 'left', 'position', 'left');
  const top = _getValue(tab, 'top', 'position', 'top');

  // v1.6.3.4 - FIX Issue #3: Only show position if both values exist
  if (left != null && top != null) {
    sizeStr += ` at (${Math.round(left)}, ${Math.round(top)})`;
  }

  return sizeStr;
}

/**
 * Create tab info section (title + metadata)
 * v1.6.3.4 - FIX Bug #6: Added position display (x, y) alongside size
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Tab info element
 */
function _createTabInfo(tab, isMinimized) {
  const tabInfo = document.createElement('div');
  tabInfo.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Quick Tab';
  title.title = tab.title || tab.url;

  const meta = document.createElement('div');
  meta.className = 'tab-meta';

  // Build metadata string
  const metaParts = [];

  if (isMinimized) {
    metaParts.push('Minimized');
  }

  if (tab.activeTabId) {
    metaParts.push(`Tab ${tab.activeTabId}`);
  }

  // v1.6.3.4 - FIX Bug #6: Size with position display
  const sizePosition = _formatSizePosition(tab);
  if (sizePosition) {
    metaParts.push(sizePosition);
  }

  if (tab.slotNumber) {
    metaParts.push(`Slot ${tab.slotNumber}`);
  }

  meta.textContent = metaParts.join(' • ');

  tabInfo.appendChild(title);
  tabInfo.appendChild(meta);

  return tabInfo;
}

/**
 * Create action buttons for Quick Tab
 * v1.6.3.4-v5 - FIX Issue #4: Disable restore button when operation in progress (domVerified=false)
 * v1.6.3.7-v1 - FIX ISSUE #8: Add visual indicator and "Adopt" button for orphaned tabs
 *   - Orphaned = originTabId is null/undefined OR originTabId browser tab is closed
 *   - "Adopt" button moves Quick Tab to current browser tab
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Actions element
 */
/**
 * Create tab action buttons
 * v1.6.4.11 - Refactored to reduce bumpy road complexity
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLElement} Actions container
 */
function _createTabActions(tab, isMinimized) {
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  const context = _buildTabActionContext(tab, isMinimized);

  if (!isMinimized) {
    _appendActiveTabActions(actions, tab, context);
  } else {
    _appendMinimizedTabActions(actions, tab, context);
  }

  // Adopt button for orphaned tabs
  if (context.isOrphaned && currentBrowserTabId) {
    _appendAdoptButton(actions, tab);
  }

  // Close button (always available)
  _appendCloseButton(actions, tab);

  return actions;
}

/**
 * Build context for tab action creation
 * @private
 */
function _buildTabActionContext(tab, isMinimized) {
  return {
    isRestorePending: !isMinimized && tab.domVerified === false,
    isOrphaned: _isOrphanedQuickTab(tab)
  };
}

/**
 * Append action buttons for active (non-minimized) tabs
 * @private
 */
function _appendActiveTabActions(actions, tab, context) {
  // Go to Tab button
  if (tab.activeTabId) {
    const goToTabBtn = _createActionButton('🔗', `Go to Tab ${tab.activeTabId}`, {
      action: 'goToTab',
      tabId: tab.activeTabId
    });
    actions.appendChild(goToTabBtn);
  }

  // Minimize button
  const minimizeBtn = _createActionButton('➖', 'Minimize', {
    action: 'minimize',
    quickTabId: tab.id
  });

  if (context.isRestorePending) {
    minimizeBtn.disabled = true;
    minimizeBtn.title = 'Restore in progress...';
  }

  actions.appendChild(minimizeBtn);
}

/**
 * Append action buttons for minimized tabs
 * @private
 */
function _appendMinimizedTabActions(actions, tab, context) {
  const restoreBtn = _createActionButton('↑', 'Restore', {
    action: 'restore',
    quickTabId: tab.id
  });

  if (context.isOrphaned) {
    restoreBtn.disabled = true;
    restoreBtn.title = 'Cannot restore - browser tab was closed. Use "Adopt to Current Tab" first.';
  }

  actions.appendChild(restoreBtn);
}

/**
 * Append adopt button for orphaned tabs
 * @private
 */
function _appendAdoptButton(actions, tab) {
  const adoptBtn = _createActionButton('📥', `Adopt to current tab (Tab #${currentBrowserTabId})`, {
    action: 'adoptToCurrentTab',
    quickTabId: tab.id,
    targetTabId: currentBrowserTabId
  });
  adoptBtn.classList.add('btn-adopt');
  actions.appendChild(adoptBtn);
}

/**
 * Append close button
 * @private
 */
function _appendCloseButton(actions, tab) {
  const closeBtn = _createActionButton('✕', 'Close', {
    action: 'close',
    quickTabId: tab.id
  });
  actions.appendChild(closeBtn);
}

/**
 * Create a standard action button
 * @private
 * @param {string} text - Button text
 * @param {string} title - Button title/tooltip
 * @param {Object} dataset - Data attributes to set
 * @returns {HTMLButtonElement}
 */
function _createActionButton(text, title, dataset) {
  const btn = document.createElement('button');
  btn.className = 'btn-icon';
  btn.textContent = text;
  btn.title = title;

  for (const [key, value] of Object.entries(dataset)) {
    btn.dataset[key] = value;
  }

  return btn;
}

/**
 * Check if a Quick Tab is orphaned (no valid browser tab to restore to)
 * v1.6.3.7-v1 - FIX ISSUE #8: Detect orphaned tabs
 * @private
 * @param {Object} tab - Quick Tab data
 * @returns {boolean} True if orphaned
 */
function _isOrphanedQuickTab(tab) {
  // No originTabId means definitely orphaned
  if (tab.originTabId == null) {
    return true;
  }

  // Check if the origin tab is still open using cached browser tab info
  const cachedInfo = browserTabInfoCache.get(tab.originTabId);
  if (cachedInfo && cachedInfo.data === null) {
    // Cache indicates this tab was closed
    return true;
  }

  // Not orphaned (or we don't have confirmation yet)
  return false;
}

/**
 * Determine status indicator class based on tab state
 * v1.6.3.4-v10 - FIX Issue #4: Check domVerified for warning indicator
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {string} - CSS class for indicator color
 */
function _getIndicatorClass(tab, isMinimized) {
  // Minimized tabs show yellow indicator
  if (isMinimized) {
    return 'yellow';
  }

  // v1.6.3.4-v10 - FIX Issue #4: Check domVerified property
  // If domVerified is explicitly false, show orange/warning indicator
  // This means restore was attempted but DOM wasn't actually rendered
  if (tab.domVerified === false) {
    return 'orange';
  }

  // Active tabs with verified DOM show green
  return 'green';
}

function renderQuickTabItem(tab, cookieStoreId, isMinimized) {
  const item = document.createElement('div');
  item.className = `quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;
  item.dataset.tabId = tab.id;
  item.dataset.containerId = cookieStoreId;

  // Status indicator
  // v1.6.3.4-v10 - FIX Issue #4: Use helper function for indicator class
  const indicator = document.createElement('span');
  const indicatorClass = _getIndicatorClass(tab, isMinimized);
  indicator.className = `status-indicator ${indicatorClass}`;

  // v1.6.3.4-v10 - FIX Issue #4: Add tooltip for warning state
  if (indicatorClass === 'orange') {
    indicator.title = 'Warning: Window may not be visible. Try restoring again.';
  }

  // Create components - using imported createFavicon
  const favicon = createFavicon(tab.url);
  const tabInfo = _createTabInfo(tab, isMinimized);
  const actions = _createTabActions(tab, isMinimized);

  // Assemble item
  item.appendChild(indicator);
  item.appendChild(favicon);
  item.appendChild(tabInfo);
  item.appendChild(actions);

  return item;
}

/**
 * Setup event listeners for user interactions
 */
function setupEventListeners() {
  // Close Minimized button
  document.getElementById('closeMinimized').addEventListener('click', async () => {
    await closeMinimizedTabs();
  });

  // Close All button
  document.getElementById('closeAll').addEventListener('click', async () => {
    await closeAllTabs();
  });

  // Delegated event listener for Quick Tab actions
  containersList.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    switch (action) {
      case 'goToTab':
        await goToTab(parseInt(tabId));
        break;
      case 'minimize':
        await minimizeQuickTab(quickTabId);
        break;
      case 'restore':
        await restoreQuickTab(quickTabId);
        break;
      case 'close':
        await closeQuickTab(quickTabId);
        break;
      // v1.6.3.7-v1 - FIX ISSUE #8: Handle adopt to current tab action
      case 'adoptToCurrentTab':
        await adoptQuickTabToCurrentTab(quickTabId, parseInt(button.dataset.targetTabId));
        break;
    }
  });

  // Listen for storage changes to auto-update
  // v1.6.3 - FIX: Changed from 'sync' to 'local' (storage location since v1.6.0.12)
  // v1.6.3.4-v6 - FIX Issue #1: Debounce storage reads to avoid mid-transaction reads
  // v1.6.3.4-v9 - FIX Issue #18: Add reconciliation logic for suspicious storage changes
  // v1.6.3.5-v2 - FIX Report 2 Issue #6: Refactored to reduce complexity
  // v1.6.3.7-v9 - FIX Issue #11: Add initialization guard
  // v1.6.3.7-v10 - FIX Issue #11: Enhanced LISTENER_REGISTERED logging
  // v1.6.3.7-v13 - Issue #6 (arch): Add storage health probe handling
  // v1.6.3.8-v3 - FIX Issues #2, #5, #9, #15: Refactored to _initializeStorageListener()
  //              with explicit registration verification pattern
  // NOTE: Listener registration is now handled by _initializeStorageListener() 
  //       called from DOMContentLoaded initialization sequence
  console.log('[Manager] STORAGE_LISTENER_SETUP: delegated to _initializeStorageListener()', {
    timestamp: Date.now()
  });
}

/**
 * Setup browser tab activation listener for real-time context updates
 * v1.6.3.7-v1 - FIX ISSUE #1: Manager Panel Shows Orphaned Quick Tabs
 * v1.6.3.7-v9 - FIX Issue #11: Add initialization guards
 * When user switches between browser tabs, update the Manager to show
 * context-relevant Quick Tabs (those with originTabId matching current tab)
 */
function setupTabSwitchListener() {
  // Listen for tab activation (user switches to a different tab)
  browser.tabs.onActivated.addListener(activeInfo => {
    // v1.6.3.7-v9 - FIX Issue #11: Log listener entry
    logListenerEntry('tabs.onActivated', { tabId: activeInfo.tabId });

    // v1.6.3.7-v9 - FIX Issue #11: Guard against processing before initialization
    if (!isFullyInitialized()) {
      console.warn('[Manager] LISTENER_CALLED_BEFORE_INIT: tabs.onActivated', {
        initializationStarted,
        initializationComplete,
        tabId: activeInfo.tabId,
        message: 'Skipping - sidebar not yet fully initialized',
        timestamp: Date.now()
      });
      return;
    }

    const newTabId = activeInfo.tabId;

    // Only process if tab actually changed
    if (newTabId === currentBrowserTabId) {
      return;
    }

    previousBrowserTabId = currentBrowserTabId;
    currentBrowserTabId = newTabId;

    console.log('[Manager] 🔄 TAB_SWITCH_DETECTED:', {
      previousTabId: previousBrowserTabId,
      currentTabId: currentBrowserTabId,
      timestamp: Date.now()
    });

    // Clear browser tab info cache for the previous tab to ensure fresh data
    browserTabInfoCache.delete(previousBrowserTabId);

    // Re-render UI with filtered Quick Tabs for new tab context
    renderUI();
  });

  // Also listen for window focus changes (user switches browser windows)
  browser.windows.onFocusChanged.addListener(async windowId => {
    // v1.6.3.7-v9 - FIX Issue #11: Log listener entry
    logListenerEntry('windows.onFocusChanged', { windowId });

    // v1.6.3.7-v9 - FIX Issue #11: Guard against processing before initialization
    if (!isFullyInitialized()) {
      console.warn('[Manager] LISTENER_CALLED_BEFORE_INIT: windows.onFocusChanged', {
        initializationStarted,
        initializationComplete,
        windowId,
        message: 'Skipping - sidebar not yet fully initialized',
        timestamp: Date.now()
      });
      return;
    }

    if (windowId === browser.windows.WINDOW_ID_NONE) {
      return; // Window lost focus
    }

    try {
      // Get the active tab in the newly focused window
      const tabs = await browser.tabs.query({ active: true, windowId });
      if (tabs[0] && tabs[0].id !== currentBrowserTabId) {
        previousBrowserTabId = currentBrowserTabId;
        currentBrowserTabId = tabs[0].id;

        console.log('[Manager] 🪟 WINDOW_FOCUS_CHANGED:', {
          previousTabId: previousBrowserTabId,
          currentTabId: currentBrowserTabId,
          windowId
        });

        renderUI();
      }
    } catch (err) {
      console.warn('[Manager] Error handling window focus change:', err);
    }
  });

  console.log('[Manager] v1.6.3.7-v9 Tab switch listener initialized with init guards');
}

/**
 * Handle storage change event
 * v1.6.3.5-v2 - Extracted to reduce setupEventListeners complexity
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Added comprehensive logging
 * v1.6.3.7 - FIX Issue #3: Skip renderUI() if only z-index changed (flicker prevention)
 * v1.6.3.7 - FIX Issue #4: Update lastLocalUpdateTime on storage.onChanged
 * v1.6.3.7 - FIX Issue #8: Enhanced storage synchronization logging
 * v1.6.3.7-v1 - FIX ISSUE #5: Added writingTabId source identification
 * v1.6.3.7-v6 - Gap #2 & Issue #7: Enhanced deduplication logging with channel source
 * v1.6.3.7-v9 - FIX Issue #6: Added sequenceId validation for event ordering
 * v1.6.3.8-v5 - FIX Issue #1: Added revision validation for monotonic ordering
 * v1.6.4.11 - Refactored to reduce cyclomatic complexity from 23 to <9
 * @param {Object} change - The storage change object
 */
function _handleStorageChange(change) {
  const context = _buildStorageChangeContext(change);

  // v1.6.3.7-v9 - FIX Issue #6: Cancel any pending watchdog timer
  _cancelStorageWatchdog();

  _logStorageMessageReceived(context);
  _logStorageChangeEvent(context);
  _logTabIdChanges(context);
  _logPositionSizeChanges(context);

  // v1.6.3.7-v12 - Issue #5: Track as storage-based fallback update (when BC unavailable)
  _trackFallbackUpdate('storage');

  // v1.6.3.7-v9 - FIX Issue #6: Validate sequence ID to ensure correct event ordering
  if (!_validateSequenceId(context)) {
    return; // Event is out of order (sequence ID), reject it
  }

  // v1.6.3.8-v5 - FIX Issue #1: Validate revision for monotonic ordering
  const revisionResult = _validateRevision(context);
  if (!revisionResult.valid) {
    return; // Stale revision, reject it
  }

  // v1.6.3.8-v5 - FIX Issue #1: If gap detected, buffer the event and return
  if (revisionResult.shouldBuffer) {
    _bufferRevisionEvent(context.newValue.revision, context.newValue);
    return; // Wait for missing events
  }

  // v1.6.3.7-v6 - Gap #2: Special case - if oldValue was empty and newValue has tabs
  if (_handleEmptyToPopulatedTransition(context)) {
    // v1.6.3.8-v5 - FIX Issue #1: Process any buffered events after this one
    const bufferedEvents = _processBufferedRevisionEvents();
    _applyBufferedEvents(bufferedEvents);
    return;
  }

  // Check for and handle suspicious drops
  if (_isSuspiciousStorageDrop(context.oldTabCount, context.newTabCount, context.newValue)) {
    _handleSuspiciousStorageDrop(context.oldValue);
    return;
  }

  _processStorageChangeAnalysis(context);

  // v1.6.3.8-v5 - FIX Issue #1: Process any buffered events after this one
  const bufferedEvents = _processBufferedRevisionEvents();
  _applyBufferedEvents(bufferedEvents);
}

/**
 * Apply buffered events after processing the current event
 * v1.6.3.8-v5 - FIX Issue #1: Process events that were buffered due to gaps
 * @private
 * @param {Array} bufferedEvents - Array of { revision, data } objects
 */
function _applyBufferedEvents(bufferedEvents) {
  if (!bufferedEvents || bufferedEvents.length === 0) {
    return;
  }

  const now = Date.now();
  console.log('[Manager] APPLYING_BUFFERED_EVENTS:', {
    count: bufferedEvents.length,
    revisions: bufferedEvents.map(e => e.revision),
    timestamp: now
  });

  for (const event of bufferedEvents) {
    // Create a mock context for the buffered event
    const context = _buildStorageChangeContext({
      oldValue: quickTabsState, // Use current state as "old"
      newValue: event.data
    });

    // Skip validation since we already did it when buffering
    // Process the change directly
    _processStorageChangeAnalysis(context);
  }
}

/**
 * Validate sequence ID for event ordering
 * v1.6.3.7-v9 - FIX Issue #6: Reject updates with sequenceId <= lastAppliedSequenceId
 * @private
 * @param {Object} context - Storage change context
 * @returns {boolean} True if valid (should process), false if out-of-order (reject)
 */
function _validateSequenceId(context) {
  const newSequenceId = context.newValue?.sequenceId;

  // If no sequenceId, process the event (backward compatibility)
  if (newSequenceId === undefined || newSequenceId === null) {
    console.log(
      '[Manager] SEQUENCE_VALIDATION: No sequenceId present, processing event (backward compat)',
      {
        saveId: context.newValue?.saveId,
        timestamp: Date.now()
      }
    );
    return true;
  }

  // Check if this is a newer event
  if (newSequenceId <= lastAppliedSequenceId) {
    console.warn('[Manager] SEQUENCE_VALIDATION_REJECTED: Out-of-order event detected', {
      newSequenceId,
      lastAppliedSequenceId,
      saveId: context.newValue?.saveId,
      decision: 'reject',
      timestamp: Date.now()
    });
    return false;
  }

  // Valid sequence - update tracking and proceed
  const previousSequenceId = lastAppliedSequenceId;
  lastAppliedSequenceId = newSequenceId;

  console.log('[Manager] SEQUENCE_VALIDATION_ACCEPTED:', {
    previousSequenceId,
    newSequenceId,
    saveId: context.newValue?.saveId,
    decision: 'process',
    timestamp: Date.now()
  });

  return true;
}

// ==================== v1.6.3.8-v5 REVISION VALIDATION FUNCTIONS ====================
// FIX Issue #1 (comprehensive-diagnostic-report.md): Storage Event Ordering

/**
 * Validate incoming revision number
 * v1.6.3.8-v5 - FIX Issue #1: Reject stale updates with revision ≤ _lastAppliedRevision
 * @private
 * @param {Object} context - Storage change context containing newValue
 * @returns {Object} { valid: boolean, shouldBuffer: boolean, reason: string }
 */
function _validateRevision(context) {
  const newRevision = context.newValue?.revision;
  const now = Date.now();

  // If no revision, allow for backward compatibility
  if (newRevision === undefined || newRevision === null) {
    console.log('[Manager] REVISION_VALIDATION: No revision present, processing (backward compat)', {
      saveId: context.newValue?.saveId,
      sequenceId: context.newValue?.sequenceId,
      timestamp: now
    });
    return { valid: true, shouldBuffer: false, reason: 'no_revision_backward_compat' };
  }

  // Check if this revision is stale (already processed or older)
  if (newRevision <= _lastAppliedRevision) {
    console.warn('[Manager] REVISION_REJECTED: Stale revision detected', {
      incomingRevision: newRevision,
      lastAppliedRevision: _lastAppliedRevision,
      saveId: context.newValue?.saveId,
      reason: newRevision === _lastAppliedRevision ? 'duplicate' : 'out_of_order',
      timestamp: now
    });
    return { valid: false, shouldBuffer: false, reason: 'stale_revision' };
  }

  // Check if this revision is next in sequence
  const expectedRevision = _lastAppliedRevision + 1;
  if (newRevision > expectedRevision) {
    // Gap detected - this event arrived out of order
    // Buffer it and wait for the missing events
    console.log('[Manager] REVISION_GAP_DETECTED: Buffering out-of-order event', {
      incomingRevision: newRevision,
      expectedRevision,
      lastAppliedRevision: _lastAppliedRevision,
      gapSize: newRevision - expectedRevision,
      saveId: context.newValue?.saveId,
      bufferSize: _revisionEventBuffer.size,
      timestamp: now
    });
    return { valid: true, shouldBuffer: true, reason: 'gap_detected' };
  }

  // Valid revision - accept and update tracking
  const previousRevision = _lastAppliedRevision;
  _lastAppliedRevision = newRevision;

  console.log('[Manager] REVISION_ACCEPTED:', {
    previousRevision,
    newRevision,
    saveId: context.newValue?.saveId,
    timestamp: now
  });

  return { valid: true, shouldBuffer: false, reason: 'valid_sequential' };
}

/**
 * Buffer an out-of-order event for later processing
 * v1.6.3.8-v5 - FIX Issue #1: Store events that arrive ahead of their expected order
 * @private
 * @param {number} revision - Revision number of the event
 * @param {Object} data - Event data to buffer
 */
function _bufferRevisionEvent(revision, data) {
  const now = Date.now();

  // Check buffer size and cleanup if needed
  if (_revisionEventBuffer.size >= REVISION_BUFFER_MAX_SIZE) {
    _cleanupRevisionBuffer(true); // Force cleanup
  }

  _revisionEventBuffer.set(revision, {
    data,
    timestamp: now
  });

  console.log('[Manager] REVISION_EVENT_BUFFERED:', {
    revision,
    saveId: data?.saveId,
    bufferSize: _revisionEventBuffer.size,
    timestamp: now
  });
}

/**
 * Process buffered events in order after receiving expected revision
 * v1.6.3.8-v5 - FIX Issue #1: Apply buffered events once gaps are filled
 * @private
 * @returns {Array} Array of processed events
 */
function _processBufferedRevisionEvents() {
  const processed = [];
  const now = Date.now();

  // Process buffered events in order starting from current lastAppliedRevision + 1
  let nextExpected = _lastAppliedRevision + 1;

  while (_revisionEventBuffer.has(nextExpected)) {
    const buffered = _revisionEventBuffer.get(nextExpected);
    _revisionEventBuffer.delete(nextExpected);

    // Skip if event is too old
    if (now - buffered.timestamp > REVISION_BUFFER_MAX_AGE_MS) {
      console.warn('[Manager] REVISION_BUFFER_EVENT_EXPIRED:', {
        revision: nextExpected,
        ageMs: now - buffered.timestamp,
        maxAgeMs: REVISION_BUFFER_MAX_AGE_MS,
        timestamp: now
      });
      nextExpected++;
      continue;
    }

    _lastAppliedRevision = nextExpected;
    processed.push({
      revision: nextExpected,
      data: buffered.data
    });

    console.log('[Manager] REVISION_BUFFER_EVENT_APPLIED:', {
      revision: nextExpected,
      saveId: buffered.data?.saveId,
      ageMs: now - buffered.timestamp,
      remainingBufferSize: _revisionEventBuffer.size,
      timestamp: now
    });

    nextExpected++;
  }

  if (processed.length > 0) {
    console.log('[Manager] REVISION_BUFFER_FLUSH_COMPLETE:', {
      eventsProcessed: processed.length,
      newLastAppliedRevision: _lastAppliedRevision,
      remainingBufferSize: _revisionEventBuffer.size,
      timestamp: now
    });
  }

  return processed;
}

/**
 * Clean up stale entries from the revision buffer
 * v1.6.3.8-v5 - FIX Issue #1: Periodic cleanup of expired buffered events
 * @private
 * @param {boolean} force - Force cleanup regardless of age
 */
function _cleanupRevisionBuffer(force = false) {
  const now = Date.now();
  const initialSize = _revisionEventBuffer.size;
  let removedCount = 0;

  for (const [revision, buffered] of _revisionEventBuffer.entries()) {
    const age = now - buffered.timestamp;
    if (force || age > REVISION_BUFFER_MAX_AGE_MS) {
      _revisionEventBuffer.delete(revision);
      removedCount++;
      console.log('[Manager] REVISION_BUFFER_CLEANUP: Removed stale event', {
        revision,
        ageMs: age,
        reason: force ? 'forced_cleanup' : 'expired',
        timestamp: now
      });
    }
  }

  if (removedCount > 0) {
    console.log('[Manager] REVISION_BUFFER_CLEANUP_COMPLETE:', {
      initialSize,
      removedCount,
      finalSize: _revisionEventBuffer.size,
      timestamp: now
    });
  }
}

/**
 * Start the revision buffer cleanup interval
 * v1.6.3.8-v5 - FIX Issue #1: Periodic cleanup to prevent memory bloat
 * @private
 */
function _startRevisionBufferCleanup() {
  if (_revisionBufferCleanupTimerId) {
    clearInterval(_revisionBufferCleanupTimerId);
  }

  _revisionBufferCleanupTimerId = setInterval(() => {
    _cleanupRevisionBuffer(false);
  }, REVISION_BUFFER_CLEANUP_INTERVAL_MS);

  console.log('[Manager] REVISION_BUFFER_CLEANUP_STARTED:', {
    intervalMs: REVISION_BUFFER_CLEANUP_INTERVAL_MS,
    maxAgeMs: REVISION_BUFFER_MAX_AGE_MS,
    maxBufferSize: REVISION_BUFFER_MAX_SIZE,
    timestamp: Date.now()
  });
}

/**
 * Stop the revision buffer cleanup interval
 * v1.6.3.8-v5 - FIX Issue #1: Cleanup on unload
 * @private
 */
function _stopRevisionBufferCleanup() {
  if (_revisionBufferCleanupTimerId) {
    clearInterval(_revisionBufferCleanupTimerId);
    _revisionBufferCleanupTimerId = null;
    console.log('[Manager] REVISION_BUFFER_CLEANUP_STOPPED');
  }
}

/**
 * Cancel the storage watchdog timer
 * v1.6.3.7-v9 - FIX Issue #6: Helper function for watchdog management
 * @private
 */
function _cancelStorageWatchdog() {
  if (storageWatchdogTimerId !== null) {
    clearTimeout(storageWatchdogTimerId);
    storageWatchdogTimerId = null;
  }
}

/**
 * Apply state from watchdog recovery
 * v1.6.3.7-v9 - FIX Issue #6: Extracted helper to reduce nesting depth
 * v1.6.3.8-v5 - FIX Issue #1: Also update revision tracking
 * @private
 * @param {Object} currentState - State from storage
 * @param {string} expectedSaveId - Expected save ID
 */
function _applyWatchdogRecoveryState(currentState, expectedSaveId) {
  quickTabsState = currentState;
  _updateInMemoryCache(currentState.tabs);
  if (currentState.sequenceId) {
    lastAppliedSequenceId = currentState.sequenceId;
  }
  // v1.6.3.8-v5 - FIX Issue #1: Also update revision tracking
  if (currentState.revision) {
    _lastAppliedRevision = currentState.revision;
  }
  scheduleRender('storage-watchdog-recovery', expectedSaveId);
}

/**
 * Handle watchdog timeout and verify storage state
 * v1.6.3.7-v9 - FIX Issue #6: Extracted helper to reduce nesting depth
 * @private
 * @param {string} expectedSaveId - Expected save ID
 */
async function _handleWatchdogTimeout(expectedSaveId) {
  console.warn(
    '[Manager] STORAGE_WATCHDOG_TIMEOUT: No storage.onChanged received within',
    STORAGE_WATCHDOG_TIMEOUT_MS,
    'ms'
  );
  console.log(
    '[Manager] STORAGE_WATCHDOG: Explicitly re-reading storage to verify state consistency'
  );

  try {
    const result = await browser.storage.local.get('quick_tabs_state_v2');
    const currentState = result?.quick_tabs_state_v2;

    if (currentState?.saveId === expectedSaveId) {
      console.log(
        '[Manager] STORAGE_WATCHDOG: Storage matches expected state - event may have been lost'
      );
      _applyWatchdogRecoveryState(currentState, expectedSaveId);
    } else {
      console.log('[Manager] STORAGE_WATCHDOG: Storage state differs from expected', {
        expectedSaveId,
        actualSaveId: currentState?.saveId,
        actualSequenceId: currentState?.sequenceId
      });
    }
  } catch (err) {
    console.error('[Manager] STORAGE_WATCHDOG: Failed to re-read storage:', err.message);
  }

  storageWatchdogTimerId = null;
}

/**
 * Start watchdog timer for storage event verification
 * v1.6.3.7-v9 - FIX Issue #6: If no storage.onChanged within timeout, re-read storage
 * @param {string} expectedSaveId - Save ID we're expecting to receive
 */
function _startStorageWatchdog(expectedSaveId) {
  _cancelStorageWatchdog();

  storageWatchdogTimerId = setTimeout(() => {
    _handleWatchdogTimeout(expectedSaveId);
  }, STORAGE_WATCHDOG_TIMEOUT_MS);
}

/**
 * Log storage message received with channel source
 * v1.6.3.7-v6 - Issue #7: Extracted for complexity reduction
 * v1.6.3.7-v9 - FIX Issue #6: Added sequenceId to logging
 * v1.6.4.17 - Refactored to reduce CC from 10 to ~2
 * @private
 * @param {Object} context - Storage change context
 */
function _logStorageMessageReceived(context) {
  const messageData = _extractStorageMessageData(context);
  const listenerData = _extractStorageListenerData(context);

  console.log('[Manager] MESSAGE_RECEIVED [STORAGE]:', messageData);
  console.log('[Manager] STORAGE_LISTENER:', listenerData);
}

/**
 * Extract data for MESSAGE_RECEIVED log
 * v1.6.4.17 - Extracted from _logStorageMessageReceived
 * @private
 * @param {Object} context - Storage change context
 * @returns {Object} Log data
 */
function _extractStorageMessageData(context) {
  const newVal = context.newValue || {};
  return {
    saveId: newVal.saveId || 'none',
    sequenceId: newVal.sequenceId ?? 'none',
    oldTabCount: context.oldTabCount,
    newTabCount: context.newTabCount,
    timestamp: Date.now()
  };
}

/**
 * Extract data for STORAGE_LISTENER log
 * v1.6.4.17 - Extracted from _logStorageMessageReceived
 * @private
 * @param {Object} context - Storage change context
 * @returns {Object} Log data
 */
function _extractStorageListenerData(context) {
  const oldVal = context.oldValue || {};
  const newVal = context.newValue || {};
  return {
    event: 'storage.onChanged',
    oldSaveId: oldVal.saveId || 'none',
    newSaveId: newVal.saveId || 'none',
    oldSequenceId: oldVal.sequenceId ?? 'none',
    newSequenceId: newVal.sequenceId ?? 'none',
    lastAppliedSequenceId,
    timestamp: Date.now()
  };
}

/**
 * Handle special case: empty state to populated state transition
 * v1.6.3.7-v6 - Gap #2: Extracted for complexity reduction
 * v1.6.3.7-v6 - FIX Code Review: Use clearer positive check (> 0) instead of (<= 0)
 * @private
 * @param {Object} context - Storage change context
 * @returns {boolean} True if handled (early return), false otherwise
 */
function _handleEmptyToPopulatedTransition(context) {
  // Skip if not a transition from empty to populated
  if (context.oldTabCount !== 0 || context.newTabCount <= 0) {
    return false;
  }

  console.log(
    '[Manager] STORAGE_SPECIAL_CASE: Old state was empty, new state has tabs - forcing render',
    {
      oldTabCount: context.oldTabCount,
      newTabCount: context.newTabCount,
      saveId: context.newValue?.saveId,
      channel: 'STORAGE'
    }
  );

  // Cancel pending initial load timeout since data arrived during wait period
  _cancelInitialLoadTimeout();

  _updateLocalStateCache(context.newValue);
  lastLocalUpdateTime = Date.now();
  scheduleRender('storage-empty-to-populated', context.newValue?.saveId);
  return true;
}

/**
 * Cancel initial load timeout if it exists
 * v1.6.3.7-v6 - FIX Code Review: Extracted to prevent race conditions
 * @private
 */
function _cancelInitialLoadTimeout() {
  if (initialLoadTimeoutId !== null) {
    clearTimeout(initialLoadTimeoutId);
    initialLoadTimeoutId = null;
    initialStateLoadComplete = true;
    console.log('[Manager] INITIAL_LOAD_TIMEOUT_CANCELLED: Data received during wait period');
  }
}

/**
 * Process storage change analysis and schedule update if needed
 * v1.6.3.7-v6 - Extracted for complexity reduction
 * @private
 * @param {Object} context - Storage change context
 */
function _processStorageChangeAnalysis(context) {
  const changeAnalysis = _analyzeStorageChange(context.oldValue, context.newValue);

  // Update lastLocalUpdateTime for ANY real data change
  if (changeAnalysis.hasDataChange) {
    lastLocalUpdateTime = Date.now();
    console.log('[Manager] STORAGE_LISTENER: lastLocalUpdateTime updated', {
      newTimestamp: lastLocalUpdateTime,
      reason: changeAnalysis.changeReason
    });
  }

  // v1.6.3.7-v6 - Gap #2 & Gap #5: Log deduplication decision
  if (!changeAnalysis.requiresRender) {
    console.log('[Manager] RENDER_SKIPPED:', {
      reason: changeAnalysis.changeType === 'metadata-only' ? 'metadata_only' : 'no_changes',
      channel: 'STORAGE',
      changeType: changeAnalysis.changeType,
      skipReason: changeAnalysis.skipReason
    });
    _updateLocalStateCache(context.newValue);
    return;
  }

  _scheduleStorageUpdate();
}

/**
 * Analyze storage change to determine if renderUI() is needed
 * v1.6.3.7 - FIX Issue #3: Differential update detection
 * Refactored to reduce complexity by extracting helper functions
 * @private
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @returns {{ requiresRender: boolean, hasDataChange: boolean, changeType: string, changeReason: string, skipReason: string }}
 */
function _analyzeStorageChange(oldValue, newValue) {
  const oldTabs = oldValue?.tabs || [];
  const newTabs = newValue?.tabs || [];

  // Tab count change always requires render
  if (oldTabs.length !== newTabs.length) {
    return _buildTabCountChangeResult(oldTabs, newTabs);
  }

  // Check for structural changes using helper
  const changeResults = _checkTabChanges(oldTabs, newTabs);

  return _buildChangeResultFromTabAnalysis(changeResults);
}

/**
 * Build result for tab count change
 * v1.6.4.18 - Extracted from _analyzeStorageChange to reduce CC
 * @private
 * @param {Array} oldTabs - Previous tabs
 * @param {Array} newTabs - New tabs
 * @returns {Object} Change analysis result
 */
function _buildTabCountChangeResult(oldTabs, newTabs) {
  return {
    requiresRender: true,
    hasDataChange: true,
    changeType: 'tab-count',
    changeReason: `Tab count changed: ${oldTabs.length} → ${newTabs.length}`,
    skipReason: null
  };
}

/**
 * Build change result from tab analysis
 * v1.6.4.18 - Extracted from _analyzeStorageChange to reduce CC
 * @private
 * @param {Object} changeResults - Results from _checkTabChanges
 * @returns {Object} Change analysis result
 */
function _buildChangeResultFromTabAnalysis(changeResults) {
  // Metadata-only changes (z-index) don't require render
  if (!changeResults.hasDataChange && changeResults.hasMetadataOnlyChange) {
    return _buildMetadataOnlyResult(changeResults);
  }

  // Data changes require render
  if (changeResults.hasDataChange) {
    return _buildDataChangeResult(changeResults);
  }

  // No changes
  return _buildNoChangeResult();
}

/**
 * Build result for metadata-only change
 * v1.6.4.18 - Extracted from _analyzeStorageChange
 * @private
 * @param {Object} changeResults - Tab change analysis
 * @returns {Object} Change analysis result
 */
function _buildMetadataOnlyResult(changeResults) {
  return {
    requiresRender: false,
    hasDataChange: false,
    changeType: 'metadata-only',
    changeReason: 'z-index only',
    skipReason: `Only z-index changed: ${JSON.stringify(changeResults.zIndexChanges)}`
  };
}

/**
 * Build result for data change
 * v1.6.4.18 - Extracted from _analyzeStorageChange
 * @private
 * @param {Object} changeResults - Tab change analysis
 * @returns {Object} Change analysis result
 */
function _buildDataChangeResult(changeResults) {
  return {
    requiresRender: true,
    hasDataChange: true,
    changeType: 'data',
    changeReason: changeResults.dataChangeReasons.join('; '),
    skipReason: null
  };
}

/**
 * Build result for no change
 * v1.6.4.18 - Extracted from _analyzeStorageChange
 * @private
 * @returns {Object} Change analysis result
 */
function _buildNoChangeResult() {
  return {
    requiresRender: false,
    hasDataChange: false,
    changeType: 'none',
    changeReason: 'no changes',
    skipReason: 'No detectable changes between old and new state'
  };
}

/**
 * Check a single tab for data changes
 * v1.6.3.7 - FIX Issue #3: Helper to reduce _analyzeStorageChange complexity
 * v1.6.4.17 - Refactored to reduce CC from 9 to ~2
 * @private
 * @param {Object} oldTab - Previous tab state
 * @param {Object} newTab - New tab state
 * @returns {{ hasDataChange: boolean, reasons: Array<string> }}
 */
function _checkSingleTabDataChanges(oldTab, newTab) {
  const reasons = [];

  _checkOriginTabIdChange(oldTab, newTab, reasons);
  _checkMinimizedChange(oldTab, newTab, reasons);
  _checkPositionChange(oldTab, newTab, reasons);
  _checkSizeChange(oldTab, newTab, reasons);
  _checkTitleUrlChange(oldTab, newTab, reasons);

  return {
    hasDataChange: reasons.length > 0,
    reasons
  };
}

/**
 * Check for originTabId change
 * v1.6.4.17 - Extracted from _checkSingleTabDataChanges
 * @private
 */
function _checkOriginTabIdChange(oldTab, newTab, reasons) {
  if (oldTab.originTabId !== newTab.originTabId) {
    reasons.push(
      `originTabId changed for ${newTab.id}: ${oldTab.originTabId} → ${newTab.originTabId}`
    );
  }
}

/**
 * Check for minimized change
 * v1.6.4.17 - Extracted from _checkSingleTabDataChanges
 * @private
 */
function _checkMinimizedChange(oldTab, newTab, reasons) {
  if (oldTab.minimized !== newTab.minimized) {
    reasons.push(`minimized changed for ${newTab.id}`);
  }
}

/**
 * Check for position change
 * v1.6.4.17 - Extracted from _checkSingleTabDataChanges
 * @private
 */
function _checkPositionChange(oldTab, newTab, reasons) {
  if (oldTab.left !== newTab.left || oldTab.top !== newTab.top) {
    reasons.push(`position changed for ${newTab.id}`);
  }
}

/**
 * Check for size change
 * v1.6.4.17 - Extracted from _checkSingleTabDataChanges
 * @private
 */
function _checkSizeChange(oldTab, newTab, reasons) {
  if (oldTab.width !== newTab.width || oldTab.height !== newTab.height) {
    reasons.push(`size changed for ${newTab.id}`);
  }
}

/**
 * Check for title/url change
 * v1.6.4.17 - Extracted from _checkSingleTabDataChanges
 * @private
 */
function _checkTitleUrlChange(oldTab, newTab, reasons) {
  if (oldTab.title !== newTab.title || oldTab.url !== newTab.url) {
    reasons.push(`title/url changed for ${newTab.id}`);
  }
}

/**
 * Check all tabs for data and metadata changes
 * v1.6.3.7 - FIX Issue #3: Helper to reduce _analyzeStorageChange complexity
 * @private
 * @param {Array} oldTabs - Previous tabs array
 * @param {Array} newTabs - New tabs array
 * @returns {{ hasDataChange: boolean, hasMetadataOnlyChange: boolean, zIndexChanges: Array, dataChangeReasons: Array }}
 */
function _checkTabChanges(oldTabs, newTabs) {
  const oldTabMap = new Map(oldTabs.map(t => [t.id, t]));

  let hasDataChange = false;
  let hasMetadataOnlyChange = false;
  const zIndexChanges = [];
  const dataChangeReasons = [];

  for (const newTab of newTabs) {
    const oldTab = oldTabMap.get(newTab.id);

    if (!oldTab) {
      // New tab ID - requires render
      hasDataChange = true;
      dataChangeReasons.push(`New tab: ${newTab.id}`);
      continue;
    }

    // Check for data changes
    const dataResult = _checkSingleTabDataChanges(oldTab, newTab);
    if (dataResult.hasDataChange) {
      hasDataChange = true;
      dataChangeReasons.push(...dataResult.reasons);
    }

    // Check for metadata-only changes (z-index)
    if (oldTab.zIndex !== newTab.zIndex) {
      hasMetadataOnlyChange = true;
      zIndexChanges.push({ id: newTab.id, old: oldTab.zIndex, new: newTab.zIndex });
    }
  }

  return {
    hasDataChange,
    hasMetadataOnlyChange,
    zIndexChanges,
    dataChangeReasons
  };
}

/**
 * Update local state cache without triggering renderUI()
 * v1.6.3.7 - FIX Issue #3: Keep local state in sync during metadata-only updates
 * @private
 * @param {Object} newValue - New storage value
 */
function _updateLocalStateCache(newValue) {
  if (newValue?.tabs) {
    quickTabsState = newValue;
    _updateInMemoryCache(newValue.tabs);
  }
}

/**
 * Build context object for storage change handling
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * @private
 * @param {Object} change - Storage change object
 * @returns {Object} Context with parsed values
 */
function _buildStorageChangeContext(change) {
  const newValue = change.newValue;
  const oldValue = change.oldValue;
  const oldTabCount = oldValue?.tabs?.length ?? 0;
  const newTabCount = newValue?.tabs?.length ?? 0;
  const sourceTabId = newValue?.writingTabId;
  const sourceInstanceId = newValue?.writingInstanceId;
  const isFromCurrentTab = sourceTabId === currentBrowserTabId;

  return {
    newValue,
    oldValue,
    oldTabCount,
    newTabCount,
    sourceTabId,
    sourceInstanceId,
    isFromCurrentTab
  };
}

/**
 * Log storage change event with comprehensive details
 * Issue #8: Unified logStorageEvent() format for sequence analysis
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * v1.6.3.6-v11 - FIX Issue #8: Unified storage event logging format
 * v1.6.4.13 - Issue #5: Added [STORAGE] prefix for message routing logging
 * v1.6.4.17 - Refactored to reduce CC from 10 to ~3
 * @private
 * @param {Object} context - Storage change context
 */
function _logStorageChangeEvent(context) {
  const tabChanges = _calculateTabIdChanges(context);

  _logStorageMessageReceived(context);
  _logStorageChangedDetails(context, tabChanges);
}

/**
 * Calculate added and removed tab IDs between old and new state
 * v1.6.4.17 - Extracted from _logStorageChangeEvent
 * @private
 * @param {Object} context - Storage change context
 * @returns {Object} Object with addedIds and removedIds arrays
 */
function _calculateTabIdChanges(context) {
  const oldIds = new Set((context.oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((context.newValue?.tabs || []).map(t => t.id));

  return {
    addedIds: [...newIds].filter(id => !oldIds.has(id)),
    removedIds: [...oldIds].filter(id => !newIds.has(id))
  };
}

/**
 * Log MESSAGE_RECEIVED with [STORAGE] prefix
 * v1.6.4.17 - Extracted from _logStorageChangeEvent
 * @private
 * @param {Object} context - Storage change context
 */
function _logStorageMessageReceivedPrefix(context) {
  if (!DEBUG_MESSAGING) return;

  console.log('[Manager] MESSAGE_RECEIVED [STORAGE] [storage.onChanged]:', {
    saveId: context.newValue?.saveId,
    tabCount: context.newTabCount,
    delta: context.newTabCount - context.oldTabCount,
    source: `tab-${context.sourceTabId || 'unknown'}`,
    timestamp: Date.now()
  });
}

/**
 * Log detailed storage change information
 * v1.6.4.17 - Extracted from _logStorageChangeEvent
 * @private
 * @param {Object} context - Storage change context
 * @param {Object} tabChanges - Calculated tab changes
 */
function _logStorageChangedDetails(context, tabChanges) {
  const delta = context.newTabCount - context.oldTabCount;
  const saveId = context.newValue?.saveId || 'none';
  const sourceTab = context.sourceTabId || 'unknown';

  console.log(
    `[Manager] STORAGE_CHANGED: tabs ${context.oldTabCount}→${context.newTabCount} (delta: ${delta}), saveId: '${saveId}', source: tab-${sourceTab}`,
    {
      changes: {
        added: tabChanges.addedIds,
        removed: tabChanges.removedIds
      },
      oldTabCount: context.oldTabCount,
      newTabCount: context.newTabCount,
      delta,
      saveId: context.newValue?.saveId,
      transactionId: context.newValue?.transactionId,
      writingTabId: context.sourceTabId,
      writingInstanceId: context.sourceInstanceId,
      isFromCurrentTab: context.isFromCurrentTab,
      currentBrowserTabId,
      timestamp: context.newValue?.timestamp,
      processedAt: Date.now()
    }
  );
}

/**
 * Log tab ID changes (added/removed)
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * @private
 * @param {Object} context - Storage change context
 */
function _logTabIdChanges(context) {
  const oldIds = new Set((context.oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((context.newValue?.tabs || []).map(t => t.id));
  const addedIds = [...newIds].filter(id => !oldIds.has(id));
  const removedIds = [...oldIds].filter(id => !newIds.has(id));

  if (addedIds.length > 0 || removedIds.length > 0) {
    console.log('[Manager] storage.onChanged tab changes:', {
      addedIds,
      removedIds,
      addedCount: addedIds.length,
      removedCount: removedIds.length
    });
  }
}

/**
 * Log position/size changes for tabs
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * @private
 * @param {Object} context - Storage change context
 */
function _logPositionSizeChanges(context) {
  if (!context.newValue?.tabs || !context.oldValue?.tabs) {
    return;
  }

  const changedTabs = _identifyChangedTabs(context.oldValue.tabs, context.newValue.tabs);
  const hasChanges = changedTabs.positionChanged.length > 0 || changedTabs.sizeChanged.length > 0;

  if (hasChanges) {
    console.log('[Manager] 📐 POSITION_SIZE_UPDATE_RECEIVED:', {
      positionChangedIds: changedTabs.positionChanged,
      sizeChangedIds: changedTabs.sizeChanged,
      sourceTabId: context.sourceTabId,
      isFromCurrentTab: context.isFromCurrentTab
    });
  }
}

/**
 * Identify tabs that changed position or size
 * v1.6.3.7-v1 - FIX ISSUE #4: Track position/size updates
 * @param {Array} oldTabs - Previous tabs array
 * @param {Array} newTabs - New tabs array
 * @returns {Object} Object with positionChanged and sizeChanged arrays
 */
/**
 * Identify tabs that have position or size changes
 * v1.6.4.11 - Refactored to reduce bumpy road complexity
 * @param {Array} oldTabs - Previous tab array
 * @param {Array} newTabs - New tab array
 * @returns {{ positionChanged: Array, sizeChanged: Array }}
 */
function _identifyChangedTabs(oldTabs, newTabs) {
  const oldTabMap = new Map(oldTabs.map(t => [t.id, t]));
  const positionChanged = [];
  const sizeChanged = [];

  for (const newTab of newTabs) {
    const oldTab = oldTabMap.get(newTab.id);
    if (!oldTab) continue;

    if (_hasPositionDiff(oldTab, newTab)) {
      positionChanged.push(newTab.id);
    }

    if (_hasSizeDiff(oldTab, newTab)) {
      sizeChanged.push(newTab.id);
    }
  }

  return { positionChanged, sizeChanged };
}

/**
 * Check if position has changed between tabs
 * @private
 */
function _hasPositionDiff(oldTab, newTab) {
  if (!newTab.position || !oldTab.position) return false;
  return newTab.position.x !== oldTab.position.x || newTab.position.y !== oldTab.position.y;
}

/**
 * Check if size has changed between tabs
 * @private
 */
function _hasSizeDiff(oldTab, newTab) {
  if (!newTab.size || !oldTab.size) return false;
  return newTab.size.width !== oldTab.size.width || newTab.size.height !== oldTab.size.height;
}

/**
 * Check if storage change is a suspicious drop (potential corruption)
 * v1.6.3.5-v2 - FIX Report 2 Issue #6: Better heuristics for corruption detection
 * v1.6.3.5-v11 - FIX Issue #6: Recognize single-tab deletions as legitimate (N→0 where N=1)
 *   A drop to 0 is only suspicious if:
 *   - More than 1 tab existed before (sudden multi-tab wipe)
 *   - It's not an explicit clear operation (reconciled/cleared saveId)
 * @param {number} oldTabCount - Previous tab count
 * @param {number} newTabCount - New tab count
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if suspicious
 */
function _isSuspiciousStorageDrop(oldTabCount, newTabCount, newValue) {
  // Single tab deletion (1→0) is always legitimate - user closed last Quick Tab
  if (_isSingleTabDeletion(oldTabCount, newTabCount)) {
    console.log('[Manager] Single tab deletion detected (1→0) - legitimate operation');
    return false;
  }

  // Multi-tab drop to 0 is suspicious unless explicitly cleared
  const isMultiTabDrop = oldTabCount > 1 && newTabCount === 0;
  return isMultiTabDrop && !_isExplicitClearOperation(newValue);
}

/**
 * Check if this is a single tab deletion (legitimate)
 * @private
 */
function _isSingleTabDeletion(oldTabCount, newTabCount) {
  return oldTabCount === 1 && newTabCount === 0;
}

/**
 * Check if this is an explicit clear operation
 * @private
 */
function _isExplicitClearOperation(newValue) {
  if (!newValue) return true;
  const saveId = newValue.saveId || '';
  return saveId.includes(SAVEID_RECONCILED) || saveId.includes(SAVEID_CLEARED);
}

/**
 * Handle suspicious storage drop (potential corruption)
 * v1.6.3.5-v2 - Extracted for clarity
 * @param {Object} oldValue - Previous storage value
 */
function _handleSuspiciousStorageDrop(oldValue) {
  console.warn('[Manager] ⚠️ SUSPICIOUS: Tab count dropped to 0!');
  console.warn('[Manager] This may indicate storage corruption. Querying content scripts...');

  _reconcileWithContentScripts(oldValue).catch(err => {
    console.error('[Manager] Reconciliation error:', err);
    _showErrorNotification('Failed to recover Quick Tab state. Data may be lost.');
  });
}

/**
 * Schedule debounced storage update
 * v1.6.3.5-v2 - Extracted to reduce complexity
 * v1.6.4.0 - FIX Issue B: Route through unified scheduleRender entry point
 */
function _scheduleStorageUpdate() {
  if (storageReadDebounceTimer) {
    clearTimeout(storageReadDebounceTimer);
  }

  storageReadDebounceTimer = setTimeout(() => {
    storageReadDebounceTimer = null;
    loadQuickTabsState().then(() => {
      // v1.6.4.0 - FIX Issue B: Route through unified entry point
      scheduleRender('storage.onChanged');
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Reconcile storage state with content scripts when suspicious changes detected
 * v1.6.3.4-v9 - FIX Issue #18: Query content scripts before clearing UI
 * @param {Object} _previousState - The previous state before the suspicious change (unused but kept for future use)
 */
async function _reconcileWithContentScripts(_previousState) {
  console.log('[Manager] Starting reconciliation with content scripts...');

  try {
    const foundQuickTabs = await _queryAllContentScriptsForQuickTabs();
    const uniqueQuickTabs = _deduplicateQuickTabs(foundQuickTabs);

    console.log(
      '[Manager] Reconciliation found',
      uniqueQuickTabs.length,
      'unique Quick Tabs in content scripts'
    );

    await _processReconciliationResult(uniqueQuickTabs);
  } catch (err) {
    console.error('[Manager] Reconciliation failed:', err);
    _scheduleNormalUpdate();
  }
}

/**
 * Query all content scripts for their Quick Tabs state
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @returns {Promise<Array>} Array of Quick Tabs from all tabs
 */
async function _queryAllContentScriptsForQuickTabs() {
  const tabs = await browser.tabs.query({});
  const foundQuickTabs = [];

  for (const tab of tabs) {
    const quickTabs = await _queryContentScriptForQuickTabs(tab.id);
    foundQuickTabs.push(...quickTabs);
  }

  return foundQuickTabs;
}

/**
 * Query a single content script for Quick Tabs
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<Array>} Quick Tabs from this tab
 */
async function _queryContentScriptForQuickTabs(tabId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      action: 'GET_QUICK_TABS_STATE'
    });

    if (response?.quickTabs && Array.isArray(response.quickTabs)) {
      console.log(`[Manager] Received ${response.quickTabs.length} Quick Tabs from tab ${tabId}`);
      return response.quickTabs;
    }
    return [];
  } catch (_err) {
    // Content script may not be loaded - this is expected
    return [];
  }
}

/**
 * Deduplicate Quick Tabs by ID
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {Array} quickTabs - Array of Quick Tabs (may contain duplicates)
 * @returns {Array} Deduplicated array
 */
function _deduplicateQuickTabs(quickTabs) {
  const uniqueQuickTabs = [];
  const seenIds = new Set();

  for (const qt of quickTabs) {
    if (!seenIds.has(qt.id)) {
      seenIds.add(qt.id);
      uniqueQuickTabs.push(qt);
    }
  }

  return uniqueQuickTabs;
}

/**
 * Process reconciliation result - restore or proceed with normal update
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {Array} uniqueQuickTabs - Deduplicated Quick Tabs from content scripts
 */
async function _processReconciliationResult(uniqueQuickTabs) {
  if (uniqueQuickTabs.length > 0) {
    // Content scripts have Quick Tabs but storage is empty - this is corruption!
    console.warn(
      '[Manager] CORRUPTION DETECTED: Content scripts have Quick Tabs but storage is empty'
    );
    await _restoreStateFromContentScripts(uniqueQuickTabs);
  } else {
    // No Quick Tabs found in content scripts - the empty state may be valid
    console.log('[Manager] No Quick Tabs found in content scripts - empty state appears valid');
    _scheduleNormalUpdate();
  }
}

/**
 * Restore state from content scripts data
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * v1.6.3.5-v2 - FIX Code Review: Use SAVEID_RECONCILED constant
 * v1.6.4.0 - FIX Issue B: Route through unified scheduleRender entry point
 *
 * ARCHITECTURE NOTE (v1.6.3.5-v6):
 * This function writes directly to storage as a RECOVERY operation.
 * This is an intentional exception to the "single-writer" architecture because:
 * 1. It only runs when storage corruption is detected
 * 2. Background's cache may be corrupted, so we need to restore from content scripts
 * 3. The SAVEID_RECONCILED prefix allows other components to recognize this write
 *
 * DO NOT use this pattern for normal operations - use message-based control instead.
 * See v1.6.3.5-architectural-issues.md Architecture Issue #6.
 *
 * @param {Array} quickTabs - Quick Tabs from content scripts
 */
async function _restoreStateFromContentScripts(quickTabs) {
  console.warn('[Manager] Restoring from content script state...');

  const restoredState = {
    tabs: quickTabs,
    timestamp: Date.now(),
    saveId: `${SAVEID_RECONCILED}-${Date.now()}`
  };

  await browser.storage.local.set({ [STATE_KEY]: restoredState });
  console.log('[Manager] State restored from content scripts:', quickTabs.length, 'tabs');

  // Update local state and re-render
  quickTabsState = restoredState;
  // v1.6.4.0 - FIX Issue B: Route through unified entry point
  scheduleRender('restore-from-content-scripts');
}

/**
 * Schedule normal state update after delay
 * v1.6.3.4-v9 - Extracted to reduce code duplication
 * v1.6.4.0 - FIX Issue B: Route through unified scheduleRender entry point
 */
function _scheduleNormalUpdate() {
  setTimeout(() => {
    loadQuickTabsState().then(() => {
      // v1.6.4.0 - FIX Issue B: Route through unified entry point
      scheduleRender('reconciliation-complete');
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local and updated for unified format
 * v1.6.3.4-v6 - FIX Issue #4: Send CLOSE_QUICK_TAB to content scripts BEFORE updating storage
 * v1.6.4.0 - FIX Issue A: Send command to background instead of direct storage write
 *   - Manager sends CLOSE_MINIMIZED_TABS command
 *   - Background processes command, updates state, writes to storage
 *   - Background sends confirmation back to Manager
 */
async function closeMinimizedTabs() {
  console.log('[Manager] Close Minimized Tabs requested');

  try {
    const response = await _sendActionRequest('CLOSE_MINIMIZED_TABS', {
      timestamp: Date.now()
    });

    _processCloseMinimizedResponse(response);
  } catch (err) {
    console.error('[Manager] Error sending close minimized command:', err);
  }
}

/**
 * Process close minimized tabs response
 * v1.6.4.17 - Extracted to reduce closeMinimizedTabs CC
 * @private
 * @param {Object} response - Response from background
 */
function _processCloseMinimizedResponse(response) {
  const isSuccess = response?.success || response?.timedOut;

  if (isSuccess) {
    _logCloseMinimizedSuccess(response);
    scheduleRender('close-minimized-success');
  } else {
    _logCloseMinimizedFailure(response);
  }
}

/**
 * Log close minimized success
 * v1.6.4.17 - Extracted helper
 * @private
 */
function _logCloseMinimizedSuccess(response) {
  console.log('[Manager] ✅ CLOSE_MINIMIZED_COMMAND_SUCCESS:', {
    closedCount: response?.closedCount || 0,
    closedIds: response?.closedIds || [],
    timedOut: response?.timedOut || false
  });
}

/**
 * Log close minimized failure
 * v1.6.4.17 - Extracted helper
 * @private
 */
function _logCloseMinimizedFailure(response) {
  console.error('[Manager] ❌ CLOSE_MINIMIZED_COMMAND_FAILED:', {
    error: response?.error || 'Unknown error'
  });
}

/**
 * Load state from storage
 * @private
 */
async function _loadStorageState() {
  const result = await browser.storage.local.get(STATE_KEY);
  return result?.[STATE_KEY] ?? null;
}

/**
 * Collect minimized tab IDs from state
 * @private
 */
function _collectMinimizedTabIds(state) {
  if (!state.tabs || !Array.isArray(state.tabs)) return [];
  return state.tabs.filter(tab => isTabMinimizedHelper(tab)).map(tab => tab.id);
}

/**
 * Broadcast close messages to all browser tabs
 * @private
 */
async function _broadcastCloseMessages(minimizedTabIds) {
  const browserTabs = await browser.tabs.query({});

  for (const quickTabId of minimizedTabIds) {
    _sendCloseMessageToAllTabs(browserTabs, quickTabId);
  }
}

/**
 * Send close message to all browser tabs
 * @private
 */
function _sendCloseMessageToAllTabs(browserTabs, quickTabId) {
  browserTabs.forEach(tab => {
    browser.tabs
      .sendMessage(tab.id, {
        action: 'CLOSE_QUICK_TAB',
        quickTabId
      })
      .catch(() => {
        // Ignore errors for tabs where content script isn't loaded
      });
  });
}

/**
 * Update storage after closing minimized tabs
 * @private
 */
async function _updateStorageAfterClose(state) {
  const hasChanges = filterMinimizedFromState(state);

  if (hasChanges) {
    await browser.storage.local.set({ [STATE_KEY]: state });
    await _broadcastLegacyCloseMessage();
    console.log('Closed all minimized Quick Tabs');
  }
}

/**
 * Broadcast legacy close minimized message for backwards compat
 * @private
 */
async function _broadcastLegacyCloseMessage() {
  const browserTabs = await browser.tabs.query({});
  browserTabs.forEach(tab => {
    browser.tabs.sendMessage(tab.id, { action: 'CLOSE_MINIMIZED_QUICK_TABS' }).catch(() => {
      // Ignore errors
    });
  });
}

/**
 * Close all Quick Tabs - both active and minimized (NEW FEATURE #2)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local
 * v1.6.3.5-v6 - FIX Architecture Issue #1: Use background-coordinated clear
 * v1.6.4.12 - Refactored to reduce cyclomatic complexity
 */
async function closeAllTabs() {
  const startTime = Date.now();

  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ Close All button clicked');
  console.log('[Manager] └─────────────────────────────────────────────────────────');

  try {
    const preActionState = _capturePreActionState();
    _logPreActionState(preActionState);

    const response = await _sendClearAllMessage();
    _logClearAllResponse(response, startTime);

    // v1.6.3.7-v4 - FIX Issue #5: Handle explicit failure response with user feedback
    if (!response?.success) {
      const errorReason = response?.error || response?.reason || 'Unknown error';
      console.error('[Manager] Close All: Operation FAILED:', {
        reason: errorReason,
        response,
        durationMs: Date.now() - startTime
      });
      // Show user-facing error notification
      _showCloseAllErrorNotification(errorReason);
      return; // Don't reset local state if operation failed
    }

    const hostInfoBeforeClear = quickTabHostInfo.size;
    quickTabHostInfo.clear();

    _logPostActionCleanup(preActionState.clearedIds, hostInfoBeforeClear, startTime);
    _resetLocalState();

    console.log('[Manager] Close All: UI updated, operation complete');
  } catch (err) {
    _logCloseAllError(err, startTime);
    // v1.6.3.7-v4 - FIX Issue #5: Show user-facing error notification
    _showCloseAllErrorNotification(err.message);
  }
}

/**
 * Show error notification to user when Close All fails
 * v1.6.3.7-v4 - FIX Issue #5: User feedback for failed operations
 * @private
 * @param {string} reason - Reason for failure
 */
function _showCloseAllErrorNotification(reason) {
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.textContent = `Close All failed: ${reason}`;
  Object.assign(notification.style, ERROR_NOTIFICATION_STYLES);

  document.body.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 5000);

  console.log('[Manager] Close All: Error notification shown to user:', reason);
}

/**
 * Capture pre-action state for closeAll
 * @private
 */
function _capturePreActionState() {
  const clearedIds = quickTabsState?.tabs?.map(t => t.id) || [];
  const originTabIds = quickTabsState?.tabs?.map(t => t.originTabId).filter(Boolean) || [];
  return { clearedIds, originTabIds };
}

/**
 * Log pre-action state for closeAll
 * @private
 */
function _logPreActionState({ clearedIds, originTabIds }) {
  console.log('[Manager] Close All: Pre-action state:', {
    tabCount: clearedIds.length,
    ids: clearedIds,
    originTabIds: [...new Set(originTabIds)],
    cacheCount: inMemoryTabsCache.length,
    hostInfoCount: quickTabHostInfo.size,
    timestamp: Date.now()
  });
}

/**
 * Send COORDINATED_CLEAR_ALL_QUICK_TABS message to background
 * @private
 * @returns {Promise<Object>} Response from background
 */
function _sendClearAllMessage() {
  console.log('[Manager] Close All: Dispatching COORDINATED_CLEAR_ALL_QUICK_TABS to background...');
  return browser.runtime.sendMessage({
    action: 'COORDINATED_CLEAR_ALL_QUICK_TABS'
  });
}

/**
 * Log clearAll response from background
 * @private
 */
function _logClearAllResponse(response, startTime) {
  console.log('[Manager] Close All: Background response:', {
    success: response?.success,
    response,
    durationMs: Date.now() - startTime
  });

  if (response?.success) {
    console.log('[Manager] Close All: Coordinated clear successful');
  } else {
    console.warn('[Manager] Close All: Coordinated clear returned non-success:', response);
  }
}

/**
 * Log post-action cleanup for closeAll
 * @private
 */
function _logPostActionCleanup(clearedIds, hostInfoCleared, startTime) {
  console.log('[Manager] Close All: Post-action cleanup:', {
    clearedIds,
    clearedCount: clearedIds.length,
    hostInfoCleared,
    totalDurationMs: Date.now() - startTime
  });
}

/**
 * Reset local state after closeAll
 * @private
 */
function _resetLocalState() {
  quickTabsState = {};
  inMemoryTabsCache = [];
  lastKnownGoodTabCount = 0;
  lastLocalUpdateTime = Date.now();
  renderUI();
}

/**
 * Log closeAll error
 * @private
 */
function _logCloseAllError(err, startTime) {
  console.error('[Manager] Close All: ERROR:', {
    message: err.message,
    stack: err.stack,
    durationMs: Date.now() - startTime
  });
}

/**
 * Go to the browser tab containing this Quick Tab (NEW FEATURE #3)
 */
async function goToTab(tabId) {
  try {
    await browser.tabs.update(tabId, { active: true });
    console.log(`Switched to tab ${tabId}`);
  } catch (err) {
    console.error(`Error switching to tab ${tabId}:`, err);
    alert('Could not switch to tab - it may have been closed.');
  }
}

/**
 * Minimize an active Quick Tab
 * v1.6.3.4-v11 - FIX Issue #4: Send to ALL tabs, not just active tab
 *   Quick Tab may exist in a different browser tab than the active one.
 *   Cross-tab minimize was failing because message was only sent to active tab.
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 * v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging via quickTabHostInfo or originTabId
 */
async function minimizeQuickTab(quickTabId) {
  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `minimize-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log(`[Manager] Ignoring duplicate minimize for ${quickTabId} (operation pending)`);
    return;
  }

  // Mark operation as pending
  PENDING_OPERATIONS.add(operationKey);

  // Auto-clear pending state after timeout (safety net)
  setTimeout(() => {
    PENDING_OPERATIONS.delete(operationKey);
  }, OPERATION_TIMEOUT_MS);

  // v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging - using imported findTabInState
  const tabData = findTabInState(quickTabId, quickTabsState);
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const originTabId = tabData?.originTabId;
  const targetTabId = hostInfo?.hostTabId || originTabId;

  if (targetTabId) {
    console.log('[Manager] Sending MINIMIZE_QUICK_TAB to specific host tab:', {
      quickTabId,
      targetTabId,
      source: hostInfo ? 'quickTabHostInfo' : 'originTabId'
    });

    try {
      await browser.tabs.sendMessage(targetTabId, {
        action: 'MINIMIZE_QUICK_TAB',
        quickTabId
      });
      console.log(
        `[Manager] Minimized Quick Tab ${quickTabId} via targeted message to tab ${targetTabId}`
      );
    } catch (err) {
      console.warn(
        `[Manager] Targeted minimize failed (tab ${targetTabId} may be closed), falling back to broadcast:`,
        err.message
      );
      // Fallback to broadcast if targeted message fails - using imported sendMessageToAllTabs
      const result = await sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
      console.log(
        `[Manager] Minimized Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`
      );
    }
  } else {
    // No host info available - fall back to broadcast
    console.log('[Manager] No host tab info found, using broadcast for minimize:', quickTabId);
    const result = await sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
    console.log(
      `[Manager] Minimized Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`
    );
  }
}

/**
 * Show error notification to user
 * v1.6.3.4-v9 - FIX Issue #15: User feedback for invalid operations
 * @param {string} message - Error message to display
 */
function _showErrorNotification(message) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.textContent = message;
  // v1.6.3.4-v9: Use extracted styles constant for maintainability
  Object.assign(notification.style, ERROR_NOTIFICATION_STYLES);
  document.body.appendChild(notification);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * Send restore message to target tab with confirmation tracking
 * v1.6.3.6-v8 - Extracted to reduce restoreQuickTab complexity
 * v1.6.3.7-v1 - FIX ISSUE #2: Implement per-message confirmation with timeout
 * v1.6.4.12 - Refactored to reduce cyclomatic complexity
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} tabData - Tab data with originTabId
 * @returns {Promise<{ success: boolean, confirmedBy?: number, error?: string }>}
 */
function _sendRestoreMessage(quickTabId, tabData) {
  const targetTabId = _resolveRestoreTarget(quickTabId, tabData);

  _logRestoreTargetResolution(quickTabId, tabData, targetTabId);

  if (!targetTabId) {
    console.log('[Manager] ⚠️ No host tab info found, using broadcast for restore:', quickTabId);
    return _sendRestoreMessageWithConfirmationBroadcast(quickTabId);
  }

  return _tryTargetedRestoreWithFallback(quickTabId, targetTabId);
}

/**
 * Resolve the target tab ID for restore operation
 * @private
 */
function _resolveRestoreTarget(quickTabId, tabData) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  return hostInfo?.hostTabId || tabData.originTabId || null;
}

/**
 * Log restore target resolution details
 * @private
 */
function _logRestoreTargetResolution(quickTabId, tabData, targetTabId) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const source = hostInfo ? 'quickTabHostInfo' : tabData.originTabId ? 'originTabId' : 'broadcast';

  console.log('[Manager] 🎯 RESTORE_TARGET_RESOLUTION:', {
    quickTabId,
    targetTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    originTabId: tabData.originTabId,
    source
  });
}

/**
 * Try targeted restore, fall back to broadcast on failure
 * @private
 */
async function _tryTargetedRestoreWithFallback(quickTabId, targetTabId) {
  try {
    const response = await _sendRestoreMessageWithTimeout(targetTabId, quickTabId, 500);

    _logRestoreConfirmation(quickTabId, targetTabId, response);

    if (response?.success) {
      _updateHostInfoAfterRestore(quickTabId, targetTabId);
    }

    return { success: response?.success ?? false, confirmedBy: targetTabId };
  } catch (err) {
    console.warn(
      `[Manager] Targeted restore failed (tab ${targetTabId} may be closed), falling back to broadcast:`,
      err.message
    );
    return _sendRestoreMessageWithConfirmationBroadcast(quickTabId);
  }
}

/**
 * Log restore confirmation details
 * @private
 */
function _logRestoreConfirmation(quickTabId, targetTabId, response) {
  console.log('[Manager] ✅ RESTORE_CONFIRMATION:', {
    quickTabId,
    targetTabId,
    success: response?.success,
    action: response?.action,
    completedAt: response?.completedAt || Date.now(),
    responseDetails: response
  });
}

/**
 * Update quickTabHostInfo after successful restore
 * @private
 */
function _updateHostInfoAfterRestore(quickTabId, targetTabId) {
  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'restore',
    confirmed: true
  });
}

/**
 * Send restore message with timeout for confirmation
 * v1.6.3.7-v1 - FIX ISSUE #2: Timeout mechanism for message confirmation
 * @private
 * @param {number} tabId - Target browser tab ID
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from content script
 */
function _sendRestoreMessageWithTimeout(tabId, quickTabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[Manager] Restore confirmation timeout (${timeoutMs}ms) for:`, {
        quickTabId,
        targetTabId: tabId
      });
      reject(new Error(`Confirmation timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    browser.tabs
      .sendMessage(tabId, {
        action: 'RESTORE_QUICK_TAB',
        quickTabId,
        // v1.6.3.7-v1 - FIX ISSUE #6: Include metadata for tracking
        _meta: {
          requestId: `restore-${quickTabId}-${Date.now()}`,
          sentAt: Date.now(),
          expectsConfirmation: true
        }
      })
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Send restore message to all tabs and track first confirmation
 * v1.6.3.7-v1 - FIX ISSUE #2: Broadcast with confirmation tracking
 * v1.6.4.11 - Refactored to reduce nesting depth
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<{ success: boolean, confirmedBy?: number, broadcastResults: Object }>}
 */
async function _sendRestoreMessageWithConfirmationBroadcast(quickTabId) {
  const tabs = await browser.tabs.query({});
  console.log(`[Manager] Broadcasting RESTORE_QUICK_TAB to ${tabs.length} tabs for:`, quickTabId);

  const results = await _broadcastRestoreToTabs(tabs, quickTabId);
  const result = _buildBroadcastResult(results, tabs.length);

  console.log(`[Manager] Restored Quick Tab ${quickTabId} via broadcast:`, result);
  return result;
}

/**
 * Broadcast restore message to all tabs
 * v1.6.4.11 - Refactored to reduce nesting depth to 2
 * @private
 */
async function _broadcastRestoreToTabs(tabs, quickTabId) {
  let confirmedBy = null;
  let successCount = 0;
  let errorCount = 0;

  for (const tab of tabs) {
    const result = await _sendRestoreToSingleTab(tab, quickTabId);
    const counts = _processRestoreResult(result, tab, quickTabId, confirmedBy);

    errorCount += counts.errorDelta;
    successCount += counts.successDelta;

    if (counts.newConfirmedBy) {
      confirmedBy = counts.newConfirmedBy;
    }
  }

  return { confirmedBy, successCount, errorCount };
}

/**
 * Process a single restore result
 * @private
 */
function _processRestoreResult(result, tab, quickTabId, existingConfirmedBy) {
  if (result.error) {
    return { errorDelta: 1, successDelta: 0, newConfirmedBy: null };
  }

  if (!result.success) {
    return { errorDelta: 0, successDelta: 0, newConfirmedBy: null };
  }

  // First successful confirmation
  if (!existingConfirmedBy) {
    _handleFirstConfirmation(quickTabId, tab.id, result.response);
    return { errorDelta: 0, successDelta: 1, newConfirmedBy: tab.id };
  }

  return { errorDelta: 0, successDelta: 1, newConfirmedBy: null };
}

/**
 * Send restore message to a single tab
 * @private
 */
async function _sendRestoreToSingleTab(tab, quickTabId) {
  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      _meta: {
        requestId: `restore-${quickTabId}-${Date.now()}`,
        sentAt: Date.now(),
        expectsConfirmation: true
      }
    });

    return { success: response?.success, response, error: false };
  } catch (_err) {
    return { success: false, response: null, error: true };
  }
}

/**
 * Handle first successful restore confirmation
 * @private
 */
function _handleFirstConfirmation(quickTabId, tabId, response) {
  console.log('[Manager] ✅ RESTORE_CONFIRMED_BY_TAB:', {
    quickTabId,
    confirmedBy: tabId,
    response
  });

  quickTabHostInfo.set(quickTabId, {
    hostTabId: tabId,
    lastUpdate: Date.now(),
    lastOperation: 'restore',
    confirmed: true
  });
}

/**
 * Build broadcast result object
 * @private
 */
function _buildBroadcastResult(results, totalTabs) {
  return {
    success: results.successCount > 0,
    confirmedBy: results.confirmedBy,
    broadcastResults: {
      success: results.successCount,
      errors: results.errorCount,
      totalTabs
    }
  };
}

/**
 * Restore a minimized Quick Tab
 * v1.6.3.4-v11 - FIX Issue #4: Send to ALL tabs, not just active tab
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 * v1.6.3.4-v9 - FIX Issue #15: Validate tab is actually minimized before restore
 * v1.6.3.5-v2 - FIX Report 2 Issue #8: DOM-verified handshake before UI update
 * v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging via quickTabHostInfo or originTabId
 * v1.6.3.6-v8 - FIX Issue #5: Enhanced diagnostic logging + refactored for complexity
 * v1.6.3.7-v1 - FIX ISSUE #2: Track confirmation responses from content scripts
 * v1.6.4.12 - Refactored to reduce cyclomatic complexity
 */
async function restoreQuickTab(quickTabId) {
  const startTime = Date.now();

  _logRestoreRequest(quickTabId, startTime);

  const operationKey = `restore-${quickTabId}`;
  if (isOperationPending(operationKey)) {
    console.log(`[Manager] Ignoring duplicate restore for ${quickTabId} (operation pending)`);
    return;
  }

  const validation = validateRestoreTabData(quickTabId, quickTabsState);
  if (!validation.valid) {
    _showErrorNotification(validation.error);
    return;
  }

  console.log('[Manager] Restore validated - tab is minimized:', quickTabId);
  setupPendingOperation(operationKey);

  const confirmationResult = await _sendRestoreMessage(quickTabId, validation.tabData);
  _logRestoreResult(quickTabId, confirmationResult, startTime);

  _scheduleRestoreVerification(quickTabId);
}

/**
 * Log restore request with context
 * @private
 */
function _logRestoreRequest(quickTabId, timestamp) {
  console.log('[Manager] 🔄 RESTORE_REQUEST:', {
    quickTabId,
    timestamp,
    quickTabsStateTabCount: quickTabsState?.tabs?.length ?? 0,
    currentBrowserTabId
  });
}

/**
 * Log restore result
 * @private
 */
function _logRestoreResult(quickTabId, confirmationResult, startTime) {
  console.log('[Manager] 🔄 RESTORE_RESULT:', {
    quickTabId,
    success: confirmationResult?.success,
    confirmedBy: confirmationResult?.confirmedBy,
    durationMs: Date.now() - startTime
  });

  if (!confirmationResult?.success) {
    console.warn('[Manager] ⚠️ Restore not confirmed by any tab:', quickTabId);
  }
}

/**
 * Schedule DOM verification after restore operation
 * @private
 * @param {string} quickTabId - Quick Tab ID to verify
 */
function _scheduleRestoreVerification(quickTabId) {
  setTimeout(() => _verifyRestoreDOM(quickTabId), DOM_VERIFICATION_DELAY_MS);
}

/**
 * Verify DOM was rendered after restore
 * @private
 * @param {string} quickTabId - Quick Tab ID to verify
 */
async function _verifyRestoreDOM(quickTabId) {
  try {
    const tab = await _getQuickTabFromStorage(quickTabId);
    _logRestoreVerificationResult(quickTabId, tab);
  } catch (err) {
    console.error('[Manager] Error verifying restore:', err);
  }
}

/**
 * Get Quick Tab from storage by ID
 * @private
 */
async function _getQuickTabFromStorage(quickTabId) {
  const stateResult = await browser.storage.local.get(STATE_KEY);
  const state = stateResult?.[STATE_KEY];
  return state?.tabs?.find(t => t.id === quickTabId) || null;
}

/**
 * Log restore verification result
 * @private
 */
function _logRestoreVerificationResult(quickTabId, tab) {
  if (tab?.domVerified === false) {
    console.warn('[Manager] Restore WARNING: DOM not verified after restore:', quickTabId);
  } else if (tab && !tab.minimized) {
    console.log('[Manager] Restore confirmed: DOM verified for:', quickTabId);
  }
}

/**
 * Close a Quick Tab
 */
async function closeQuickTab(quickTabId) {
  try {
    // Send message to all tabs to close this Quick Tab
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLOSE_QUICK_TAB',
          quickTabId: quickTabId
        })
        .catch(() => {
          // Ignore errors
        });
    });

    console.log(`Closed Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error closing Quick Tab ${quickTabId}:`, err);
  }
}

/**
 * Adopt an orphaned Quick Tab to the current browser tab
 * v1.6.3.7-v1 - FIX ISSUE #8: Allow users to "rescue" orphaned Quick Tabs
 * v1.6.4.0 - FIX Issue A: Send ADOPT_TAB command to background instead of direct storage write
 *   - Manager sends command, background is sole writer
 *   - Background updates state, writes to storage, sends confirmation
 * @param {string} quickTabId - The Quick Tab ID to adopt
 * @param {number} targetTabId - The browser tab ID to adopt to
 */
async function adoptQuickTabToCurrentTab(quickTabId, targetTabId) {
  _logAdoptRequest(quickTabId, targetTabId);

  // Validate targetTabId
  if (!_isValidTargetTabId(targetTabId)) {
    console.error('[Manager] ❌ Invalid targetTabId for adopt:', targetTabId);
    return;
  }

  try {
    // v1.6.4.0 - FIX Issue A: Send command to background instead of direct storage write
    console.log('[Manager] Sending ADOPT_QUICK_TAB command to background:', {
      quickTabId,
      targetTabId
    });

    const response = await _sendActionRequest('ADOPT_TAB', { quickTabId, targetTabId });

    _handleAdoptResponse(quickTabId, targetTabId, response);
  } catch (err) {
    console.error('[Manager] ❌ Error sending adopt command:', err);
  }
}

/**
 * Handle adoption command response
 * v1.6.4.0 - FIX Issue A: Extracted to reduce nesting depth
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} targetTabId - Target browser tab ID
 * @param {Object} response - Response from background
 */
function _handleAdoptResponse(quickTabId, targetTabId, response) {
  const isSuccess = response?.success || response?.timedOut;

  if (isSuccess) {
    _handleAdoptSuccess(quickTabId, targetTabId, response);
  } else {
    _handleAdoptFailure(quickTabId, targetTabId, response);
  }
}

/**
 * Handle successful adoption
 * v1.6.4.17 - Extracted to reduce _handleAdoptResponse CC
 * @private
 */
function _handleAdoptSuccess(quickTabId, targetTabId, response) {
  console.log('[Manager] ✅ ADOPT_COMMAND_SUCCESS:', {
    quickTabId,
    targetTabId,
    oldOriginTabId: response?.oldOriginTabId,
    timedOut: response?.timedOut || false
  });

  _updateHostInfoAfterAdopt(quickTabId, targetTabId);
  _invalidateOldTabCache(response);
  scheduleRender('adopt-success');
}

/**
 * Handle failed adoption
 * v1.6.4.17 - Extracted to reduce _handleAdoptResponse CC
 * @private
 */
function _handleAdoptFailure(quickTabId, targetTabId, response) {
  console.error('[Manager] ❌ ADOPT_COMMAND_FAILED:', {
    quickTabId,
    targetTabId,
    error: response?.error || 'Unknown error'
  });
}

/**
 * Update host info after successful adoption
 * v1.6.4.17 - Extracted helper
 * @private
 */
function _updateHostInfoAfterAdopt(quickTabId, targetTabId) {
  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'adopt',
    confirmed: true
  });
}

/**
 * Invalidate cache for old tab if response has it
 * v1.6.4.17 - Extracted helper
 * @private
 */
function _invalidateOldTabCache(response) {
  if (response?.oldOriginTabId) {
    browserTabInfoCache.delete(response.oldOriginTabId);
  }
}

/**
 * Log adopt request
 * v1.6.3.7 - FIX Issue #7: Enhanced adoption data flow logging
 * v1.6.4.0 - FIX Issue C: Added ADOPTION_INITIATED log as specified in acceptance criteria
 * @private
 */
function _logAdoptRequest(quickTabId, targetTabId) {
  // v1.6.4.0 - FIX Issue C: Log ADOPTION_INITIATED as specified in issue requirements
  console.log('[Manager] ADOPTION_INITIATED:', {
    quickTabId,
    targetTabId,
    message: `${quickTabId} → tab-${targetTabId}`,
    timestamp: Date.now()
  });

  // v1.6.3.7 - FIX Issue #7: Use standardized format for adoption flow tracking
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'adopt_button_clicked',
    result: 'pending',
    currentBrowserTabId,
    timestamp: Date.now()
  });

  console.log('[Manager] 📥 ADOPT_TO_CURRENT_TAB:', {
    quickTabId,
    targetTabId,
    currentBrowserTabId,
    timestamp: Date.now()
  });
}

/**
 * Check if target tab ID is valid
 * @private
 */
function _isValidTargetTabId(targetTabId) {
  return targetTabId && targetTabId > 0;
}

/**
 * Perform the adoption operation
 * Issue #9: Enhanced with storage verification logging
 * v1.6.3.6-v11 - FIX Issue #9: Adoption verification logging
 * v1.6.3.7 - FIX Issue #7: Added adoption data flow logging throughout
 * Refactored to reduce function length by extracting helpers
 * @private
 * @returns {Promise<{ oldOriginTabId: number, saveId: string, writeTimestamp: number }|null>} Result or null if failed
 */
async function _performAdoption(quickTabId, targetTabId) {
  const writeStartTime = Date.now();

  // Read current state
  const stateResult = await _readStorageForAdoption(quickTabId, targetTabId);
  if (!stateResult.success) {
    return null;
  }

  const { state, quickTab, tabIndex: _tabIndex, oldOriginTabId } = stateResult;

  // Update and persist
  quickTab.originTabId = targetTabId;
  _logAdoptionUpdate(quickTabId, oldOriginTabId, targetTabId);

  const persistResult = await _persistAdoption({
    quickTabId,
    targetTabId,
    state,
    oldOriginTabId,
    writeStartTime
  });
  return persistResult;
}

/**
 * Read storage state for adoption
 * v1.6.3.7 - FIX Issue #7: Helper for adoption with logging
 * @private
 */
async function _readStorageForAdoption(quickTabId, targetTabId) {
  const result = await browser.storage.local.get(STATE_KEY);
  const state = result?.[STATE_KEY];

  if (!state?.tabs?.length) {
    console.warn('[Manager] No Quick Tabs in storage to adopt');
    console.log('[Manager] ADOPTION_FLOW:', {
      quickTabId,
      originTabId: targetTabId,
      action: 'storage_read',
      result: 'failed_no_tabs'
    });
    return { success: false };
  }

  const tabIndex = state.tabs.findIndex(t => t.id === quickTabId);
  if (tabIndex === -1) {
    console.warn('[Manager] Quick Tab not found for adopt:', quickTabId);
    console.log('[Manager] ADOPTION_FLOW:', {
      quickTabId,
      originTabId: targetTabId,
      action: 'find_tab',
      result: 'failed_tab_not_found'
    });
    return { success: false };
  }

  const quickTab = state.tabs[tabIndex];
  const oldOriginTabId = quickTab.originTabId;

  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: oldOriginTabId,
    action: 'before_update',
    result: 'read_existing',
    existingOriginTabId: oldOriginTabId
  });

  return { success: true, state, quickTab, tabIndex, oldOriginTabId };
}

/**
 * Log adoption update (before persist)
 * v1.6.3.7 - FIX Issue #7: Helper for adoption logging
 * @private
 */
function _logAdoptionUpdate(quickTabId, oldOriginTabId, targetTabId) {
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'after_update',
    result: 'updated_in_memory',
    oldOriginTabId,
    newOriginTabId: targetTabId
  });
}

/**
 * Persist adoption to storage
 * v1.6.3.7 - FIX Issue #7: Helper for adoption persistence with logging
 * v1.6.4.17 - Refactored to use options object (5 args → 1)
 * @private
 * @param {Object} options - Adoption options
 * @param {string} options.quickTabId - Quick Tab ID
 * @param {number} options.targetTabId - Target tab ID
 * @param {Object} options.state - State to persist
 * @param {number} options.oldOriginTabId - Previous origin tab ID
 * @param {number} options.writeStartTime - Write start timestamp
 */
async function _persistAdoption({
  quickTabId,
  targetTabId,
  state,
  oldOriginTabId,
  writeStartTime
}) {
  const saveId = `adopt-${quickTabId}-${Date.now()}`;
  const writeTimestamp = Date.now();
  const stateToWrite = {
    tabs: state.tabs,
    saveId,
    timestamp: writeTimestamp,
    writingTabId: targetTabId,
    writingInstanceId: `manager-adopt-${writeTimestamp}`
  };

  console.log('[Manager] 📝 ADOPT_STORAGE_WRITE:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId,
    timestamp: writeTimestamp,
    tabCount: state.tabs.length
  });

  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'before_persist',
    result: 'pending',
    saveId
  });

  await browser.storage.local.set({ [STATE_KEY]: stateToWrite });

  const writeEndTime = Date.now();

  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'after_persist',
    result: 'success',
    saveId,
    durationMs: writeEndTime - writeStartTime
  });

  console.log('[Manager] ✅ ADOPT_COMPLETED:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId,
    writeDurationMs: writeEndTime - writeStartTime
  });

  // Issue #9: Set up temporary listener for storage.onChanged to verify write confirmation
  _verifyAdoptionInStorage(quickTabId, saveId, writeTimestamp);

  return { oldOriginTabId, saveId, writeTimestamp };
}

/**
 * Issue #9: Verify adoption was persisted by monitoring storage.onChanged
 * Logs time delta between write and confirmation, warns if no confirmation within 2 seconds
 * @private
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {string} expectedSaveId - SaveId to look for in storage change
 * @param {number} writeTimestamp - Timestamp when write occurred
 */
function _verifyAdoptionInStorage(quickTabId, expectedSaveId, writeTimestamp) {
  let confirmed = false;
  const CONFIRMATION_TIMEOUT_MS = 2000;

  // Issue #9: Temporary listener for this specific saveId
  const verificationListener = (changes, areaName) => {
    if (areaName !== 'local' || !changes[STATE_KEY]) return;

    const newValue = changes[STATE_KEY].newValue;
    if (newValue?.saveId === expectedSaveId) {
      confirmed = true;
      const confirmationTime = Date.now();
      const timeDelta = confirmationTime - writeTimestamp;

      console.log('[Manager] ✅ ADOPT_VERIFICATION_CONFIRMED:', {
        quickTabId,
        saveId: expectedSaveId,
        writeTimestamp,
        confirmationTimestamp: confirmationTime,
        timeDeltaMs: timeDelta
      });

      // Clean up listener
      browser.storage.onChanged.removeListener(verificationListener);
    }
  };

  browser.storage.onChanged.addListener(verificationListener);

  // Issue #9: Warning if no confirmation within timeout
  setTimeout(() => {
    if (!confirmed) {
      console.warn('[Manager] ⚠️ ADOPT_VERIFICATION_TIMEOUT:', {
        quickTabId,
        saveId: expectedSaveId,
        writeTimestamp,
        timeoutMs: CONFIRMATION_TIMEOUT_MS,
        message: 'No storage.onChanged confirmation received within timeout'
      });

      // Clean up listener
      browser.storage.onChanged.removeListener(verificationListener);
    }
  }, CONFIRMATION_TIMEOUT_MS);
}

/**
 * Finalize adoption by updating local state and UI
 * @private
 */
function _finalizeAdoption(quickTabId, targetTabId, oldOriginTabId) {
  // Update local quickTabHostInfo
  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'adopt',
    confirmed: true
  });

  // Invalidate cache for old tab
  browserTabInfoCache.delete(oldOriginTabId);

  // Re-render UI to reflect the change
  renderUI();
}
