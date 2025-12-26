/**
 * Quick Tabs Manager Sidebar Script
 * Manages display and interaction with Quick Tabs across all containers
 *
 * v1.6.4.18 - FIX: Switch Quick Tabs from storage.local to storage.session
 *   - Quick Tabs are now session-only (cleared on browser restart)
 *   - All Quick Tab state operations use storage.session
 *   - Collapse state still uses storage.local (UI preference)
 *
 * v1.6.3.10-v5 - FIX Bug #3: Animation Playing for All Quick Tabs During Single Adoption
 *   - Implemented surgical DOM update for adoption events
 *   - Only adopted Quick Tab animates, other Quick Tabs untouched
 *   - Added _performSurgicalAdoptionUpdate() for targeted DOM manipulation
 *   - Added _moveQuickTabBetweenGroups() for cross-group moves without re-render
 *   - CSS animation classes now only applied to specific elements
 *   - Removed automatic itemFadeIn animation on all Quick Tab items
 *
 * v1.6.3.10-v3 - Phase 2: Tabs API Integration
 *   - FIX Issue #47: ADOPTION_COMPLETED port message for immediate re-render
 *   - Background broadcasts ADOPTION_COMPLETED after storage write
 *   - Manager handles port message and triggers immediate scheduleRender()
 *   - NEW: ORIGIN_TAB_CLOSED handler for orphan detection
 *
 * v1.6.3.10-v2 - FIX Manager UI Issues (Issues #1, #4, #8)
 *   - FIX Issue #1: Reduced render debounce 300ms→100ms, sliding-window debounce
 *   - FIX Issue #4: Smart circuit breaker with sliding-window backoff, action queue
 *   - FIX Issue #8: Cache staleness tracking, cache only for initial hydration
 *
 * v1.6.3.10-v1 - FIX Critical Cross-Tab Sync Issues (Issues #2, #3, #5, #6, #7)
 *   - FIX Issue #2: Port lifecycle & zombie port detection with 500ms timeout
 *   - FIX Issue #3: Storage concurrency with write serialization (transactionId + sequence)
 *   - FIX Issue #5: Reduced heartbeat interval 25s→15s, timeout 5s→2s, adaptive backoff
 *   - FIX Issue #6: Structured port/message lifecycle logging with state transitions
 *   - FIX Issue #7: Minimize/restore retry logic (2x retry + broadcast fallback)
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
import {
  computeStateHash,
  createFavicon,
  createGroupFavicon,
  animateCollapse,
  animateExpand,
  scrollIntoViewIfNeeded,
  checkAndRemoveEmptyGroups,
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
  determineRestoreSource,
  STATE_KEY
} from './utils/tab-operations.js';
import { filterInvalidTabs } from './utils/validation.js';

// ==================== CONSTANTS ====================
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';
const BROWSER_TAB_CACHE_TTL_MS = 30000;
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';
const OPERATION_TIMEOUT_MS = 2000;
const DOM_VERIFICATION_DELAY_MS = 500;

// ==================== v1.6.3.7 CONSTANTS ====================
// FIX Issue #3: UI Flicker Prevention - Debounce renderUI()
// v1.6.3.10-v2 - FIX Issue #1: Reduced from 300ms to 100ms to match storage mutation frequency
const RENDER_DEBOUNCE_MS = 100;
// FIX Issue #5: Port Reconnect Circuit Breaker
const RECONNECT_BACKOFF_INITIAL_MS = 100;
// v1.6.3.10-v2 - FIX Issue #4: Reduced max backoff from 10000ms to 2000ms
const RECONNECT_BACKOFF_MAX_MS = 2000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
// v1.6.3.10-v2 - FIX Issue #4: Reduced from 10000ms to 3000ms
const CIRCUIT_BREAKER_OPEN_DURATION_MS = 3000;
// v1.6.3.10-v2 - FIX Issue #4: Sliding window for failure tracking (failures older than this don't count)
const CIRCUIT_BREAKER_SLIDING_WINDOW_MS = 5000;

// ==================== v1.6.3.10-v1 CONSTANTS ====================
// FIX Issue #2: Zombie port detection timeout (500ms)
const PORT_MESSAGE_TIMEOUT_MS = 500;
// FIX Issue #7: Messaging retry configuration
const MESSAGE_RETRY_COUNT = 2;
const MESSAGE_RETRY_BACKOFF_MS = 150;

// ==================== v1.6.3.10-v2 CONSTANTS ====================
// FIX Issue #8: Cache staleness tracking
const CACHE_STALENESS_ALERT_MS = 30000; // Alert if cache diverges for >30 seconds
// FIX Issue #1: Sliding-window debounce maximum wait time
const RENDER_DEBOUNCE_MAX_WAIT_MS = 300; // Maximum wait time even with extensions

// ==================== v1.6.3.10-v7 CONSTANTS ====================
// FIX Bug #1: quickTabHostInfo memory leak prevention
const HOST_INFO_MAX_ENTRIES = 500; // Maximum entries before pruning old ones
const HOST_INFO_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// FIX Bug #3: Adaptive port timeout
const PORT_VIABILITY_MIN_TIMEOUT_MS = 700; // Minimum timeout (increased from 500ms)
const PORT_VIABILITY_MAX_TIMEOUT_MS = 3000; // Maximum adaptive timeout
const LATENCY_SAMPLES_MAX = 50; // Maximum latency samples to track for 95th percentile

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
// v1.6.3.10-v2 - FIX Issue #8: Cache is now ONLY used for initial hydration, not ongoing fallback
//   Cache staleness is tracked - alerts if >30 seconds without storage sync
let inMemoryTabsCache = [];
let lastKnownGoodTabCount = 0;
const MIN_TABS_FOR_CACHE_PROTECTION = 1; // Protect cache if we have at least 1 tab

// v1.6.3.10-v2 - FIX Issue #8: Cache staleness tracking
let lastCacheSyncFromStorage = 0; // Timestamp when cache was last synchronized with storage
let cacheHydrationComplete = false; // Flag to track if initial hydration is done

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

// v1.6.3.5-v3 - FIX Architecture Phase 3: Track which tab hosts each Quick Tab
// Key: quickTabId, Value: { hostTabId, lastUpdate, containerId }
// v1.6.3.10-v7 - FIX Bug #1: Added maintenance interval and max size guard
const quickTabHostInfo = new Map();
let hostInfoMaintenanceIntervalId = null;

// v1.6.3.10-v7 - FIX Bug #3: Adaptive port timeout tracking
// Track recent heartbeat latencies for 95th percentile calculation
const recentLatencySamples = [];
let adaptivePortTimeout = PORT_VIABILITY_MIN_TIMEOUT_MS;

// v1.6.3.10-v7 - FIX Bug #3: Message deduplication to prevent re-sends on reconnect
// Key: messageHash (action + quickTabId), Value: timestamp
const sentMessageDedup = new Map();
const MESSAGE_DEDUP_TTL_MS = 2000; // Dedup window: don't resend same message within 2s

// v1.6.3.5-v7 - FIX Issue #7: Track when Manager's internal state was last updated (from any source)
let lastLocalUpdateTime = 0;

// v1.6.3.11-v12 - FIX Issue #6: Track last event received for staleness detection
let lastEventReceivedTime = 0;
const STALENESS_THRESHOLD_MS = 30000; // 30 seconds - warn if no events received

// Browser tab info cache
const browserTabInfoCache = new Map();

// ==================== v1.6.3.6-v11 PORT CONNECTION ====================
// FIX Issue #11: Persistent port connection to background script
// FIX Issue #10: Message acknowledgment tracking

/**
 * Port connection to background script
 * v1.6.3.6-v11 - FIX Issue #11: Persistent connection
 */
let backgroundPort = null;

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
// v1.6.3.10-v1 - FIX Issue #5: Reduced interval for better margin

/**
 * Heartbeat interval (15 seconds - Firefox idle timeout is 30s)
 * v1.6.3.10-v1 - FIX Issue #5: Reduced from 25s to 15s for 15s safety margin
 */
const HEARTBEAT_INTERVAL_MS = 15000;

/**
 * Maximum heartbeat interval for adaptive backoff
 * v1.6.3.10-v1 - FIX Issue #5: Never exceed 20s even with network latency
 */
const HEARTBEAT_INTERVAL_MAX_MS = 20000;

/**
 * Heartbeat timeout (2 seconds)
 * v1.6.3.10-v1 - FIX Issue #5: Reduced from 5s to 2s for faster failure detection
 */
const HEARTBEAT_TIMEOUT_MS = 2000;

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

// ==================== v1.6.3.7 CIRCUIT BREAKER STATE ====================
// FIX Issue #5: Port Reconnect Circuit Breaker to prevent thundering herd
/**
 * Circuit breaker state
 * v1.6.3.7 - FIX Issue #5: Prevent thundering herd on reconnect
 * States: 'closed' (connected), 'open' (not trying), 'half-open' (attempting)
 * v1.6.3.10-v2 - FIX Issue #4: Added sliding window tracking and action queue
 */
let circuitBreakerState = 'closed';
let circuitBreakerOpenTime = 0;
let reconnectAttempts = 0;
let reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

// v1.6.3.10-v2 - FIX Issue #4: Sliding window failure tracking
/**
 * Track failure timestamps for sliding window analysis
 * v1.6.3.10-v2 - FIX Issue #4: Only failures within CIRCUIT_BREAKER_SLIDING_WINDOW_MS count
 * @type {number[]}
 */
let failureTimestamps = [];

// v1.6.3.10-v2 - FIX Issue #4: Action queue for operations during circuit open
/**
 * Queue user actions during circuit breaker open state
 * v1.6.3.10-v2 - FIX Issue #4: Actions are flushed on successful reconnect
 * @type {Array<{action: string, payload: Object, timestamp: number}>}
 */
let pendingActionQueue = [];
const MAX_PENDING_ACTIONS = 50; // Prevent queue from growing unbounded

/**
 * Failure reason classification
 * v1.6.3.10-v2 - FIX Issue #4: Different failure types have different handling
 */
const FAILURE_REASON = {
  TRANSIENT: 'transient', // Network blip - exponential backoff
  ZOMBIE_PORT: 'zombie-port', // Port dead - immediate reconnect, no count
  BACKGROUND_DEAD: 'background-dead' // Background unloaded - request state sync on reconnect
};

// ==================== v1.6.3.10-v1 PORT STATE MACHINE ====================
// FIX Issue #2: Explicit port state tracking for zombie detection
/**
 * Port connection state machine
 * v1.6.3.10-v1 - FIX Issue #2: Track port viability explicitly
 * States: 'connected', 'zombie', 'reconnecting', 'dead'
 */
let portState = 'dead';

/**
 * Timestamp of last successful port message
 * v1.6.3.10-v1 - FIX Issue #2: Track for zombie detection
 */
let lastSuccessfulPortMessage = 0;

/**
 * Current adaptive heartbeat interval
 * v1.6.3.10-v1 - FIX Issue #5: Adaptive backoff based on network latency
 */
let currentHeartbeatInterval = HEARTBEAT_INTERVAL_MS;

// ==================== v1.6.3.7 RENDER DEBOUNCE STATE ====================
// FIX Issue #3: UI Flicker Prevention
// v1.6.3.10-v2 - FIX Issue #1: Added sliding-window debounce state
let renderDebounceTimer = null;
let lastRenderedHash = 0;
let pendingRenderUI = false;

// v1.6.3.10-v2 - FIX Issue #1: Sliding-window debounce tracking
let debounceStartTimestamp = 0; // When the debounce window started
let debounceExtensionCount = 0; // How many times we've extended the debounce

/**
 * Generate correlation ID for message acknowledgment
 * v1.6.3.6-v11 - FIX Issue #10: Correlation tracking
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate correlation ID for Manager operations
 * v1.6.4.15 - FIX Code Review: Centralized correlation ID generation for operations
 * @param {string} operation - Operation type (e.g., 'min', 'restore', 'close', 'adopt')
 * @param {string} quickTabId - Quick Tab ID
 * @returns {string} Correlation ID for the operation
 */
function generateOperationCorrelationId(operation, quickTabId) {
  return `${operation}-${quickTabId}-${Date.now()}`;
}

/**
 * Log port lifecycle event with comprehensive context
 * v1.6.3.6-v11 - FIX Issue #12: Port lifecycle logging
 * v1.6.3.10-v1 - FIX Issue #6: Enhanced structured logging with state transitions
 * @param {string} event - Event name (CONNECT, DISCONNECT, ZOMBIE_DETECTED, etc.)
 * @param {Object} details - Event details
 */
function logPortLifecycle(event, details = {}) {
  const logEntry = {
    event,
    tabId: currentBrowserTabId,
    portId: backgroundPort?._portId,
    portState,
    circuitBreakerState,
    timestamp: Date.now(),
    timeSinceLastSuccess:
      lastSuccessfulPortMessage > 0 ? Date.now() - lastSuccessfulPortMessage : null,
    ...details
  };

  // v1.6.3.10-v1 - FIX Issue #6: Use appropriate log level based on event
  const errorEvents = ['ZOMBIE_DETECTED', 'HEARTBEAT_TIMEOUT', 'MESSAGE_TIMEOUT', 'CIRCUIT_OPEN'];
  const warnEvents = ['DISCONNECT', 'RECONNECT_ATTEMPT_N'];

  if (errorEvents.includes(event)) {
    console.error(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, logEntry);
  } else if (warnEvents.includes(event)) {
    console.warn(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, logEntry);
  } else {
    console.log(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, logEntry);
  }
}

/**
 * Log port state transition
 * v1.6.3.10-v1 - FIX Issue #6: Track all state transitions with context
 * @param {string} fromState - Previous state
 * @param {string} toState - New state
 * @param {string} reason - Reason for transition
 * @param {Object} context - Additional context
 */
function logPortStateTransition(fromState, toState, reason, context = {}) {
  const logEntry = {
    transition: `${fromState} → ${toState}`,
    reason,
    portId: backgroundPort?._portId,
    circuitBreakerState,
    reconnectAttempts,
    timestamp: Date.now(),
    ...context
  };

  console.log('[Manager] PORT_STATE_TRANSITION:', logEntry);

  // Update port state
  portState = toState;
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 * v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat on connect
 * v1.6.3.7 - FIX Issue #5: Implement circuit breaker with exponential backoff
 * v1.6.3.10-v1 - FIX Issue #2: Port state machine tracking
 * v1.6.3.10-v2 - FIX Issue #4: Flush pending action queue on successful reconnect
 */
function connectToBackground() {
  const previousState = portState;

  // v1.6.3.7 - FIX Issue #5: Check circuit breaker state
  if (circuitBreakerState === 'open') {
    const timeSinceOpen = Date.now() - circuitBreakerOpenTime;
    if (timeSinceOpen < CIRCUIT_BREAKER_OPEN_DURATION_MS) {
      logPortLifecycle('CIRCUIT_OPEN', {
        timeRemainingMs: CIRCUIT_BREAKER_OPEN_DURATION_MS - timeSinceOpen,
        recoveryAction: 'waiting for cooldown'
      });
      return;
    }
    // Transition to half-open state
    logPortStateTransition(portState, 'reconnecting', 'circuit breaker cooldown expired');
    circuitBreakerState = 'half-open';
    logPortLifecycle('CIRCUIT_HALF_OPEN', { attemptingReconnect: true });
  }

  // v1.6.3.10-v1 - FIX Issue #2: Update port state to reconnecting
  logPortStateTransition(previousState, 'reconnecting', 'connection attempt starting');

  try {
    backgroundPort = browser.runtime.connect({
      name: 'quicktabs-sidebar'
    });

    logPortLifecycle('CONNECT', { portName: backgroundPort.name });

    // Handle messages from background
    backgroundPort.onMessage.addListener(handlePortMessage);

    // Handle disconnect
    backgroundPort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      logPortLifecycle('DISCONNECT', {
        error: error?.message,
        recoveryAction: 'scheduling reconnect'
      });

      // v1.6.3.10-v1 - FIX Issue #2: Update port state
      logPortStateTransition(portState, 'dead', `disconnected: ${error?.message || 'unknown'}`);
      backgroundPort = null;

      // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat on disconnect
      stopHeartbeat();

      // v1.6.3.7 - FIX Issue #5: Implement exponential backoff reconnection
      scheduleReconnect();
    });

    // v1.6.3.10-v1 - FIX Issue #2: Mark port as connected
    logPortStateTransition('reconnecting', 'connected', 'connection established successfully');
    lastSuccessfulPortMessage = Date.now();

    // v1.6.3.7 - FIX Issue #5: Reset circuit breaker on successful connect
    circuitBreakerState = 'closed';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

    // v1.6.3.10-v2 - FIX Issue #4: Clear sliding window failures on successful connect
    failureTimestamps = [];

    // v1.6.3.10-v1 - FIX Issue #5: Reset adaptive heartbeat interval
    currentHeartbeatInterval = HEARTBEAT_INTERVAL_MS;

    // v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat mechanism
    startHeartbeat();

    // v1.6.4.0 - FIX Issue E: Request full state sync after reconnection
    // This ensures Manager has latest state after any disconnection
    _requestFullStateSync();

    // v1.6.3.10-v2 - FIX Issue #4: Flush pending action queue on successful reconnect
    _flushPendingActionQueue();

    console.log('[Manager] v1.6.3.10-v2 Port connection established with action queue flush');
  } catch (err) {
    console.error('[Manager] Failed to connect to background:', err.message);
    logPortLifecycle('CONNECT_ERROR', {
      error: err.message,
      recoveryAction: 'scheduling reconnect'
    });
    logPortStateTransition(portState, 'dead', `connection failed: ${err.message}`);

    // v1.6.3.7 - FIX Issue #5: Handle connection failure
    handleConnectionFailure();
  }
}

/**
 * Schedule reconnection with exponential backoff
 * v1.6.3.7 - FIX Issue #5: Exponential backoff for port reconnection
 * v1.6.3.10-v1 - FIX Issue #2: Zombie detection bypasses circuit breaker delay
 * v1.6.3.10-v2 - FIX Issue #4: Sliding-window failure tracking
 * @param {string} [failureReason=FAILURE_REASON.TRANSIENT] - Reason for failure
 */
function scheduleReconnect(failureReason = FAILURE_REASON.TRANSIENT) {
  // v1.6.3.10-v2 - FIX Issue #4: Zombie port doesn't count toward failures
  if (failureReason === FAILURE_REASON.ZOMBIE_PORT) {
    logPortLifecycle('RECONNECT_ZOMBIE_BYPASS', {
      reason: 'zombie port detection - bypassing failure count',
      failureTimestampsCount: failureTimestamps.length
    });
    // Don't increment failure count for zombie ports - reconnect immediately
    setTimeout(() => {
      console.log('[Manager] Attempting reconnect after zombie detection');
      connectToBackground();
    }, RECONNECT_BACKOFF_INITIAL_MS);
    return;
  }

  // v1.6.3.10-v2 - FIX Issue #4: Track failure with timestamp for sliding window
  const now = Date.now();
  failureTimestamps.push(now);

  // Remove failures older than the sliding window
  _pruneOldFailures(now);

  reconnectAttempts = failureTimestamps.length;

  logPortLifecycle('RECONNECT_ATTEMPT_N', {
    attempt: reconnectAttempts,
    backoffMs: reconnectBackoffMs,
    maxFailures: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    failureReason,
    slidingWindowFailures: failureTimestamps.length,
    recoveryAction: `waiting ${reconnectBackoffMs}ms before retry`
  });

  // v1.6.3.10-v2 - FIX Issue #4: Only count recent failures for circuit breaker
  if (failureTimestamps.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
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
 * Prune failure timestamps older than sliding window
 * v1.6.3.10-v2 - FIX Issue #4: Failures older than CIRCUIT_BREAKER_SLIDING_WINDOW_MS don't count
 * @private
 * @param {number} now - Current timestamp
 */
function _pruneOldFailures(now) {
  const windowStart = now - CIRCUIT_BREAKER_SLIDING_WINDOW_MS;
  failureTimestamps = failureTimestamps.filter(ts => ts > windowStart);
}

/**
 * Force immediate reconnect (bypass circuit breaker)
 * v1.6.3.10-v1 - FIX Issue #2: Used when zombie port detected
 * v1.6.3.10-v2 - FIX Issue #4: Zombie detection uses ZOMBIE_PORT failure reason
 * Zombie detection means background unloaded, not transient failure
 */
function forceImmediateReconnect() {
  // v1.6.3.10-v1 - FIX Code Review: Store previous state for proper logging
  const previousPortState = portState;

  logPortLifecycle('ZOMBIE_DETECTED', {
    recoveryAction: 'forcing immediate reconnect (bypassing circuit breaker)',
    previousState: previousPortState
  });

  // v1.6.3.10-v2 - FIX Issue #4: Reset circuit breaker - zombie is not a transient failure
  // Clear failure timestamps to prevent zombie detection from polluting sliding window
  circuitBreakerState = 'half-open';
  circuitBreakerOpenTime = 0;
  reconnectAttempts = 0;
  reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

  // Mark port as zombie before reconnect attempt
  logPortStateTransition(previousPortState, 'zombie', 'message timeout detected');

  // Clean up old port
  if (backgroundPort) {
    try {
      backgroundPort.disconnect();
    } catch (_err) {
      // Port may already be invalid
    }
    backgroundPort = null;
  }

  stopHeartbeat();

  // v1.6.3.10-v2 - FIX Issue #4: Use scheduleReconnect with ZOMBIE_PORT reason
  // This bypasses the failure counting
  scheduleReconnect(FAILURE_REASON.ZOMBIE_PORT);
}

/**
 * Handle connection failure
 * v1.6.3.7 - FIX Issue #5: Track failures for circuit breaker
 * v1.6.3.10-v2 - FIX Issue #4: Pass failure reason for sliding window tracking
 */
function handleConnectionFailure() {
  // v1.6.3.10-v2 - FIX Issue #4: Always schedule reconnect, let sliding window handle thresholds
  scheduleReconnect(FAILURE_REASON.TRANSIENT);
}

/**
 * Trip the circuit breaker to "open" state
 * v1.6.3.7 - FIX Issue #5: Stop reconnection attempts for cooldown period
 * v1.6.3.10-v1 - FIX Issue #6: Enhanced logging for circuit breaker events
 * v1.6.3.10-v2 - FIX Issue #4: Clear failure timestamps, flush pending actions on reopen
 */
function tripCircuitBreaker() {
  const previousState = circuitBreakerState;
  circuitBreakerState = 'open';
  circuitBreakerOpenTime = Date.now();

  // v1.6.3.10-v2 - FIX Issue #4: Log pending actions that are queued
  logPortLifecycle('CIRCUIT_OPEN', {
    previousState,
    attempts: reconnectAttempts,
    slidingWindowFailures: failureTimestamps.length,
    cooldownMs: CIRCUIT_BREAKER_OPEN_DURATION_MS,
    reopenAt: new Date(circuitBreakerOpenTime + CIRCUIT_BREAKER_OPEN_DURATION_MS).toISOString(),
    pendingActionsQueued: pendingActionQueue.length,
    recoveryAction: `will retry after ${CIRCUIT_BREAKER_OPEN_DURATION_MS / 1000}s cooldown`
  });

  // Schedule attempt to reopen circuit breaker
  setTimeout(() => {
    logPortLifecycle('CIRCUIT_HALF_OPEN', {
      reason: 'cooldown expired',
      recoveryAction: 'attempting reconnection'
    });
    circuitBreakerState = 'half-open';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
    // v1.6.3.10-v2 - FIX Issue #4: Clear sliding window failures on reopen
    failureTimestamps = [];
    connectToBackground();
  }, CIRCUIT_BREAKER_OPEN_DURATION_MS);
}

/**
 * Queue a user action during circuit breaker open state
 * v1.6.3.10-v2 - FIX Issue #4: Actions are queued and flushed on successful reconnect
 * @param {string} action - Action name (e.g., 'MINIMIZE_QUICK_TAB')
 * @param {Object} payload - Action payload
 * @returns {boolean} True if queued, false if circuit is not open or queue full
 */
function _queuePendingAction(action, payload) {
  if (circuitBreakerState !== 'open') {
    return false; // Only queue when circuit is open
  }

  if (pendingActionQueue.length >= MAX_PENDING_ACTIONS) {
    console.warn('[Manager] Pending action queue full, discarding oldest action');
    pendingActionQueue.shift(); // Remove oldest
  }

  pendingActionQueue.push({
    action,
    payload,
    timestamp: Date.now()
  });

  console.log('[Manager] ACTION_QUEUED:', {
    action,
    payload,
    queueLength: pendingActionQueue.length
  });

  return true;
}

/**
 * Flush pending action queue after successful reconnect
 * v1.6.3.10-v2 - FIX Issue #4: Send queued actions to background
 * v1.6.3.10-v2 - FIX Code Review: Prune stale actions and use sendMessageToAllTabs for broadcast
 * @private
 */
async function _flushPendingActionQueue() {
  if (pendingActionQueue.length === 0) {
    return;
  }

  // v1.6.3.10-v2 - FIX Code Review: Prune actions older than 30 seconds as stale
  const MAX_ACTION_AGE_MS = 30000;
  const now = Date.now();
  const actionsToFlush = pendingActionQueue.filter(a => now - a.timestamp < MAX_ACTION_AGE_MS);
  const staleCount = pendingActionQueue.length - actionsToFlush.length;
  pendingActionQueue = [];

  console.log('[Manager] FLUSHING_PENDING_ACTIONS:', {
    count: actionsToFlush.length,
    staleDiscarded: staleCount,
    actions: actionsToFlush.map(a => a.action)
  });

  for (const queuedAction of actionsToFlush) {
    await _flushSingleAction(queuedAction, now);
  }
}

/**
 * Flush a single queued action
 * v1.6.3.10-v2 - FIX Code Review: Extracted to reduce nesting depth
 * @private
 * @param {Object} queuedAction - Queued action object
 * @param {number} now - Current timestamp
 */
async function _flushSingleAction(queuedAction, now) {
  const { action, payload, timestamp } = queuedAction;
  const age = now - timestamp;
  console.log('[Manager] FLUSHING_ACTION:', { action, payload, ageMs: age });

  try {
    const quickTabId = payload?.quickTabId;
    if (quickTabId) {
      await sendMessageToAllTabs(action, quickTabId);
    } else {
      await browser.runtime.sendMessage({ action, ...payload });
    }
  } catch (err) {
    console.warn('[Manager] Failed to flush queued action:', { action, error: err.message });
  }
}

// ==================== v1.6.3.6-v12 HEARTBEAT FUNCTIONS ====================
// v1.6.3.10-v1 - FIX Issue #5: Reduced interval (15s), adaptive backoff, faster timeout (2s)

/**
 * Start heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #2, #4: Keep background alive
 * v1.6.3.10-v1 - FIX Issue #5: Adaptive interval based on latency
 */
function startHeartbeat() {
  // Clear any existing interval
  stopHeartbeat();

  // Send initial heartbeat immediately
  sendHeartbeat();

  // v1.6.3.10-v1 - FIX Issue #5: Use adaptive interval
  heartbeatIntervalId = setInterval(sendHeartbeat, currentHeartbeatInterval);
  logPortLifecycle('HEARTBEAT_STARTED', {
    intervalMs: currentHeartbeatInterval,
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
    safetyMarginMs: 30000 - currentHeartbeatInterval
  });
}

/**
 * Stop heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #4: Cleanup on disconnect/unload
 */
function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    logPortLifecycle('HEARTBEAT_STOPPED', {
      reason: 'cleanup'
    });
  }
}

/**
 * Adjust heartbeat interval based on observed latency
 * v1.6.3.10-v1 - FIX Issue #5: Adaptive backoff based on network latency
 * @param {number} latencyMs - Observed round-trip latency
 */
function adjustHeartbeatInterval(latencyMs) {
  const previousInterval = currentHeartbeatInterval;

  // If latency is high (>500ms), increase interval slightly to reduce load
  // But never exceed the maximum (20s) to maintain safety margin
  if (latencyMs > 500) {
    currentHeartbeatInterval = Math.min(currentHeartbeatInterval + 1000, HEARTBEAT_INTERVAL_MAX_MS);
  } else if (latencyMs < 100 && currentHeartbeatInterval > HEARTBEAT_INTERVAL_MS) {
    // Low latency - can reduce interval back toward baseline
    currentHeartbeatInterval = Math.max(currentHeartbeatInterval - 500, HEARTBEAT_INTERVAL_MS);
  }

  // If interval changed, restart heartbeat with new interval
  if (currentHeartbeatInterval !== previousInterval) {
    console.log('[Manager] HEARTBEAT_ADAPTIVE:', {
      previousIntervalMs: previousInterval,
      newIntervalMs: currentHeartbeatInterval,
      observedLatencyMs: latencyMs,
      safetyMarginMs: 30000 - currentHeartbeatInterval
    });

    // Restart heartbeat with new interval
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = setInterval(sendHeartbeat, currentHeartbeatInterval);
    }
  }
}

/**
 * Send heartbeat message to background
 * v1.6.3.6-v12 - FIX Issue #2, #4: Heartbeat with timeout detection
 * v1.6.3.7 - FIX Issue #2: Enhanced logging for port state transitions
 * v1.6.3.10-v1 - FIX Issue #2, #5: Zombie detection, adaptive interval
 */
/**
 * Handle heartbeat when port is not connected
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handleHeartbeatNoPort() {
  logPortLifecycle('HEARTBEAT_SKIPPED', {
    reason: 'port not connected',
    circuitBreakerState,
    reconnectAttempts
  });
  consecutiveHeartbeatFailures++;
  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    logPortLifecycle('HEARTBEAT_TIMEOUT', {
      failures: consecutiveHeartbeatFailures,
      recoveryAction: 'triggering reconnect'
    });
    scheduleReconnect();
  }
}

/**
 * Handle successful heartbeat response
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handleHeartbeatSuccess(timestamp, response) {
  const latencyMs = Date.now() - timestamp;
  consecutiveHeartbeatFailures = 0;
  lastHeartbeatResponse = Date.now();
  lastSuccessfulPortMessage = Date.now();

  if (portState === 'zombie') {
    logPortStateTransition('zombie', 'connected', 'heartbeat success confirmed');
  }

  logPortLifecycle('HEARTBEAT_SENT', {
    roundTripMs: latencyMs,
    backgroundAlive: response?.backgroundAlive,
    isInitialized: response?.isInitialized,
    adaptiveInterval: currentHeartbeatInterval
  });
  adjustHeartbeatInterval(latencyMs);
}

/**
 * Handle heartbeat failure
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handleHeartbeatFailure(err) {
  consecutiveHeartbeatFailures++;
  logPortLifecycle('HEARTBEAT_TIMEOUT', {
    error: err.message,
    failures: consecutiveHeartbeatFailures,
    maxFailures: MAX_HEARTBEAT_FAILURES,
    timeSinceLastSuccess: Date.now() - lastHeartbeatResponse,
    recoveryAction:
      consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES
        ? 'forcing immediate reconnect'
        : 'will retry'
  });

  if (err.message === 'Heartbeat timeout' || err.message === 'Port message timeout') {
    forceImmediateReconnect();
    return true; // Early return signal
  }

  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    logPortLifecycle('HEARTBEAT_MAX_FAILURES', {
      failures: consecutiveHeartbeatFailures,
      recoveryAction: 'forcing immediate reconnect'
    });
    forceImmediateReconnect();
  }
  return false;
}

async function sendHeartbeat() {
  if (!backgroundPort) {
    _handleHeartbeatNoPort();
    return;
  }

  const timestamp = Date.now();

  try {
    const response = await sendPortMessageWithTimeout(
      { type: 'HEARTBEAT', timestamp, source: 'sidebar' },
      HEARTBEAT_TIMEOUT_MS
    );
    _handleHeartbeatSuccess(timestamp, response);
  } catch (err) {
    _handleHeartbeatFailure(err);
  }
}

/**
 * Send port message with timeout
 * v1.6.3.6-v12 - FIX Issue #4: Wrap port messages with timeout
 * v1.6.3.10-v1 - FIX Issue #2: Short timeout for zombie detection (500ms default)
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds (defaults to PORT_MESSAGE_TIMEOUT_MS)
 * @returns {Promise<Object>} Response from background
 */
function sendPortMessageWithTimeout(message, timeoutMs = PORT_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!backgroundPort) {
      reject(new Error('Port not connected'));
      return;
    }

    const correlationId = generateCorrelationId();
    const messageWithCorrelation = { ...message, correlationId };
    const sentAt = Date.now();

    // v1.6.3.10-v1 - FIX Issue #6: Log message send with context
    logPortLifecycle('MESSAGE_ACK_PENDING', {
      messageType: message.type,
      correlationId,
      timeoutMs
    });

    // Set up timeout
    const timeout = setTimeout(() => {
      pendingAcks.delete(correlationId);

      // v1.6.3.10-v1 - FIX Issue #6: Log timeout with context
      logPortLifecycle('MESSAGE_TIMEOUT', {
        messageType: message.type,
        correlationId,
        waitedMs: Date.now() - sentAt,
        timeoutMs,
        recoveryAction: 'treating as zombie port'
      });

      reject(new Error('Port message timeout'));
    }, timeoutMs);

    // Track pending ack
    pendingAcks.set(correlationId, {
      resolve,
      reject,
      timeout,
      sentAt,
      messageType: message.type
    });

    // Send message
    try {
      backgroundPort.postMessage(messageWithCorrelation);
    } catch (err) {
      clearTimeout(timeout);
      pendingAcks.delete(correlationId);

      // v1.6.3.10-v1 - FIX Issue #6: Log send failure
      logPortLifecycle('MESSAGE_SEND_FAILED', {
        messageType: message.type,
        correlationId,
        error: err.message,
        recoveryAction: 'treating as zombie port'
      });

      reject(err);
    }
  });
}

/**
 * Verify port is viable before critical operation
 * v1.6.3.10-v1 - FIX Issue #2: Verify port viability before minimize/restore/close
 * v1.6.3.10-v7 - FIX Bug #3: Adaptive timeout based on 95th percentile latency
 * @returns {Promise<boolean>} True if port is viable, false if zombie detected
 */
async function verifyPortViability() {
  if (!backgroundPort) {
    logPortLifecycle('PORT_VIABILITY_CHECK', {
      result: 'failed',
      reason: 'port not connected'
    });
    return false;
  }

  // v1.6.3.10-v7 - FIX Bug #3: Use adaptive timeout instead of fixed 500ms
  const timeoutMs = _calculateAdaptiveTimeout();
  const startTime = Date.now();

  // Quick ping to verify background is responsive
  try {
    await sendPortMessageWithTimeout(
      {
        type: 'HEARTBEAT',
        timestamp: Date.now(),
        source: 'viability-check'
      },
      timeoutMs
    );

    // v1.6.3.10-v7 - FIX Bug #3: Track latency for adaptive timeout
    const latencyMs = Date.now() - startTime;
    _recordLatencySample(latencyMs);

    lastSuccessfulPortMessage = Date.now();
    logPortLifecycle('PORT_VIABILITY_CHECK', {
      result: 'success',
      portState,
      latencyMs,
      adaptiveTimeoutMs: timeoutMs
    });
    return true;
  } catch (err) {
    const elapsedMs = Date.now() - startTime;

    // v1.6.3.10-v7 - FIX Bug #3: Check if port is actually disconnected vs just slow
    // If we're close to timeout but port is still connected, might just be slow
    if (elapsedMs < timeoutMs && backgroundPort) {
      console.log('[Manager] PORT_VIABILITY_CHECK: Possible slow response, not zombie', {
        elapsedMs,
        timeoutMs,
        error: err.message
      });
    }

    logPortLifecycle('PORT_VIABILITY_CHECK', {
      result: 'failed',
      error: err.message,
      elapsedMs,
      adaptiveTimeoutMs: timeoutMs,
      recoveryAction: 'triggering reconnect'
    });

    // Port is zombie - trigger reconnect
    forceImmediateReconnect();
    return false;
  }
}

// ==================== v1.6.3.10-v7 ADAPTIVE TIMEOUT ====================
// FIX Bug #3: Adaptive port timeout based on observed latency

/**
 * Record a latency sample for adaptive timeout calculation
 * v1.6.3.10-v7 - FIX Bug #3: Track heartbeat latencies
 * @private
 * @param {number} latencyMs - Observed round-trip latency
 */
function _recordLatencySample(latencyMs) {
  recentLatencySamples.push(latencyMs);

  // Keep only the most recent samples
  if (recentLatencySamples.length > LATENCY_SAMPLES_MAX) {
    recentLatencySamples.shift();
  }

  // Recalculate adaptive timeout
  _updateAdaptiveTimeout();
}

/**
 * Calculate 95th percentile of latency samples
 * v1.6.3.10-v7 - FIX Bug #3: Statistical latency analysis
 * @private
 * @returns {number} 95th percentile latency in ms
 */
function _calculate95thPercentileLatency() {
  if (recentLatencySamples.length < 3) {
    return PORT_VIABILITY_MIN_TIMEOUT_MS; // Not enough data
  }

  const sorted = [...recentLatencySamples].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Update adaptive timeout based on recent latencies
 * v1.6.3.10-v7 - FIX Bug #3: Set timeout to max(700ms, 2x observed latency)
 * @private
 */
function _updateAdaptiveTimeout() {
  const p95Latency = _calculate95thPercentileLatency();

  // timeout = max(700ms, 2x observed latency), capped at max
  const calculatedTimeout = Math.max(PORT_VIABILITY_MIN_TIMEOUT_MS, p95Latency * 2);
  adaptivePortTimeout = Math.min(calculatedTimeout, PORT_VIABILITY_MAX_TIMEOUT_MS);

  console.log('[Manager] ADAPTIVE_TIMEOUT_UPDATED:', {
    p95LatencyMs: p95Latency,
    newTimeoutMs: adaptivePortTimeout,
    sampleCount: recentLatencySamples.length
  });
}

/**
 * Calculate current adaptive timeout for port viability check
 * v1.6.3.10-v7 - FIX Bug #3: Returns adaptive or default timeout
 * @private
 * @returns {number} Timeout in milliseconds
 */
function _calculateAdaptiveTimeout() {
  return adaptivePortTimeout;
}

// ==================== v1.6.3.10-v7 MESSAGE DEDUPLICATION ====================
// FIX Bug #3: Prevent re-sending same message on reconnect

/**
 * Check if a message was recently sent (deduplication)
 * v1.6.3.10-v7 - FIX Bug #3: Prevent duplicate sends on reconnect
 * @private
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if message was recently sent and should be skipped
 */
function _isDuplicateMessage(action, quickTabId) {
  const hash = `${action}:${quickTabId}`;
  const lastSent = sentMessageDedup.get(hash);

  if (!lastSent) {
    return false;
  }

  const age = Date.now() - lastSent;
  if (age < MESSAGE_DEDUP_TTL_MS) {
    console.log('[Manager] MESSAGE_DEDUP_DETECTED:', {
      action,
      quickTabId,
      ageMs: age,
      ttlMs: MESSAGE_DEDUP_TTL_MS
    });
    return true;
  }

  return false;
}

/**
 * Mark a message as sent for deduplication
 * v1.6.3.10-v7 - FIX Bug #3: Track sent messages
 * @private
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 */
function _markMessageSent(action, quickTabId) {
  const hash = `${action}:${quickTabId}`;
  sentMessageDedup.set(hash, Date.now());

  // Cleanup old entries periodically
  _cleanupSentMessageDedup();
}

/**
 * Cleanup old dedup entries
 * v1.6.3.10-v7 - FIX Bug #3: Prevent memory growth
 * @private
 */
function _cleanupSentMessageDedup() {
  const now = Date.now();
  for (const [hash, timestamp] of sentMessageDedup.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL_MS * 2) {
      sentMessageDedup.delete(hash);
    }
  }
}

// ==================== END ADAPTIVE TIMEOUT & DEDUP ====================

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
 * Build state sync request message
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _requestFullStateSync
 * @private
 */
function _buildStateSyncRequest() {
  return {
    type: 'REQUEST_FULL_STATE_SYNC',
    timestamp: Date.now(),
    source: 'sidebar',
    currentCacheHash: computeStateHash(quickTabsState),
    currentCacheTabCount: quickTabsState?.tabs?.length ?? 0
  };
}

/**
 * Request full state sync from background after port reconnection
 * v1.6.4.0 - FIX Issue E: Ensure Manager has latest state after reconnection
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 * @private
 */
async function _requestFullStateSync() {
  if (!backgroundPort) {
    console.warn('[Manager] Cannot request state sync - port not connected');
    return;
  }

  console.log('[Manager] STATE_SYNC_REQUESTED: requesting full state from background');

  try {
    const response = await sendPortMessageWithTimeout(
      _buildStateSyncRequest(),
      STATE_SYNC_TIMEOUT_MS
    );

    if (response?.success && response?.state) {
      _handleStateSyncResponse(response);
    } else {
      console.warn('[Manager] State sync response did not include state:', response);
    }
  } catch (err) {
    console.warn(
      '[Manager] State sync timed out after',
      STATE_SYNC_TIMEOUT_MS,
      'ms, proceeding with cached state (may be stale):',
      err.message
    );
  }
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
 * @param {string} source - Source of render trigger for logging
 */
function scheduleRender(source = 'unknown') {
  const currentHash = computeStateHash(quickTabsState);

  // v1.6.4.0 - FIX Issue B: Deduplicate renders by hash comparison
  if (currentHash === lastRenderedStateHash) {
    console.log('[Manager] RENDER_DEDUPLICATION: prevented duplicate render (hash unchanged)', {
      source,
      hash: currentHash
    });
    return;
  }

  console.log('[Manager] RENDER_SCHEDULED:', {
    source,
    newHash: currentHash,
    previousHash: lastRenderedStateHash,
    timestamp: Date.now()
  });

  // Route to the debounced renderUI
  renderUI();
}

// ==================== END STATE SYNC & UNIFIED RENDER ====================

/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #10: Process acknowledgments
 * v1.6.3.6-v12 - FIX Issue #4: Handle HEARTBEAT_ACK
 * v1.6.4.0 - FIX Issue E: Handle FULL_STATE_SYNC response
 * @param {Object} message - Message from background
 */
function handlePortMessage(message) {
  logPortLifecycle('message', {
    type: message.type,
    action: message.action,
    correlationId: message.correlationId
  });

  // v1.6.3.6-v12 - FIX Issue #4: Handle heartbeat acknowledgment
  if (message.type === 'HEARTBEAT_ACK') {
    handleAcknowledgment(message);
    return;
  }

  // Handle acknowledgment
  if (message.type === 'ACKNOWLEDGMENT') {
    handleAcknowledgment(message);
    return;
  }

  // Handle broadcasts
  if (message.type === 'BROADCAST') {
    handleBroadcast(message);
    return;
  }

  // Handle state updates
  if (message.type === 'STATE_UPDATE') {
    // v1.6.4.0 - FIX Issue B: Route through unified render entry point
    handleStateUpdateBroadcast(message);
    scheduleRender('port-STATE_UPDATE');
    return;
  }

  // v1.6.4.0 - FIX Issue E: Handle full state sync response
  if (message.type === 'FULL_STATE_SYNC') {
    _handleStateSyncResponse(message);
    return;
  }

  // v1.6.3.10-v3 - FIX Issue #47: Handle adoption completion for immediate re-render
  if (message.type === 'ADOPTION_COMPLETED') {
    handleAdoptionCompletion(message);
    return;
  }

  // v1.6.3.10-v3 - Phase 2: Handle origin tab closed for orphan detection
  if (message.type === 'ORIGIN_TAB_CLOSED') {
    handleOriginTabClosed(message);
    return;
  }
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
 * @param {Object} message - Broadcast message
 */
function handleBroadcast(message) {
  const { action } = message;

  switch (action) {
    case 'VISIBILITY_CHANGE':
      console.log('[Manager] Received visibility change broadcast:', message);
      // v1.6.4.0 - FIX Issue B: Route through unified entry point
      scheduleRender('broadcast-VISIBILITY_CHANGE');
      break;

    case 'TAB_LIFECYCLE_CHANGE':
      console.log('[Manager] Received tab lifecycle broadcast:', message);
      // Refresh browser tab info cache for affected tabs
      if (message.tabId) {
        browserTabInfoCache.delete(message.tabId);
      }
      // v1.6.4.0 - FIX Issue B: Route through unified entry point
      scheduleRender('broadcast-TAB_LIFECYCLE_CHANGE');
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
 * Handle adoption completion from background
 * v1.6.3.10-v3 - FIX Issue #47: Adoption re-render fix
 * v1.6.3.10-v5 - FIX Bug #3: Surgical DOM update to prevent all Quick Tabs animating
 * v1.6.4.13 - FIX BUG #4: Update quickTabHostInfo to prevent stale host tab routing
 * v1.6.3.10-v7 - FIX Bug #2: Container validation for adoption
 * @param {Object} message - Adoption completion message
 */
/**
 * Invalidate browser tab info cache for affected tabs during adoption
 * v1.6.3.11-v3 - FIX CodeScene: Extract from handleAdoptionCompletion
 * @private
 */
function _invalidateAffectedTabCaches(oldOriginTabId, newOriginTabId) {
  if (oldOriginTabId) browserTabInfoCache.delete(oldOriginTabId);
  if (newOriginTabId) browserTabInfoCache.delete(newOriginTabId);
}

/**
 * Update quickTabHostInfo for adopted Quick Tab
 * v1.6.3.11-v3 - FIX CodeScene: Extract from handleAdoptionCompletion
 * @private
 */
function _updateHostInfoForAdoption(adoptedQuickTabId, newOriginTabId, newContainerId) {
  if (!adoptedQuickTabId || !newOriginTabId) return;

  const previousHostInfo = quickTabHostInfo.get(adoptedQuickTabId);
  quickTabHostInfo.set(adoptedQuickTabId, {
    hostTabId: newOriginTabId,
    containerId: newContainerId || null,
    lastUpdate: Date.now(),
    lastOperation: 'adoption',
    confirmed: true
  });
  console.log('[Manager] ADOPTION_HOST_INFO_UPDATED:', {
    adoptedQuickTabId,
    previousHostTabId: previousHostInfo?.hostTabId ?? null,
    newHostTabId: newOriginTabId,
    containerId: newContainerId
  });
}

/**
 * Handle adoption completion from background script
 * v1.6.4.13 - FIX BUG #4: Update quickTabHostInfo to prevent stale host tab routing
 * v1.6.3.10-v7 - FIX Bug #2: Container validation for adoption
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 * @param {Object} message - Adoption completion message
 */
async function handleAdoptionCompletion(message) {
  const { adoptedQuickTabId, oldOriginTabId, newOriginTabId, timestamp } = message;

  console.log('[Manager] ADOPTION_COMPLETED received via port:', {
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId,
    timestamp,
    timeSinceBroadcast: Date.now() - timestamp
  });

  // Validate containers match before processing adoption
  const containerValidation = await _validateAdoptionContainers(oldOriginTabId, newOriginTabId);
  if (!containerValidation.valid) {
    console.warn('[Manager] ADOPTION_CONTAINER_MISMATCH:', {
      adoptedQuickTabId,
      oldOriginTabId,
      newOriginTabId,
      oldContainerId: containerValidation.oldContainerId,
      newContainerId: containerValidation.newContainerId,
      reason: containerValidation.reason,
      action: 'proceeding with warning - cross-container adoption'
    });
  }

  lastCacheSyncFromStorage = Date.now();
  _invalidateAffectedTabCaches(oldOriginTabId, newOriginTabId);
  _updateHostInfoForAdoption(adoptedQuickTabId, newOriginTabId, containerValidation.newContainerId);

  // Attempt surgical DOM update first (prevents all Quick Tabs from animating)
  const surgicalUpdateSuccess = await _performSurgicalAdoptionUpdate(
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId
  );

  if (surgicalUpdateSuccess) {
    console.log('[Manager] ADOPTION_SURGICAL_UPDATE_SUCCESS:', {
      adoptedQuickTabId,
      oldOriginTabId,
      newOriginTabId,
      message: 'Only adopted Quick Tab updated - no full rebuild'
    });
  } else {
    console.log('[Manager] ADOPTION_SURGICAL_UPDATE_FAILED, falling back to full render:', {
      adoptedQuickTabId,
      reason: 'surgical update returned false'
    });
    scheduleRender('adoption-completed-fallback');
  }
}

/**
 * Validate containers match for adoption
 * v1.6.3.10-v7 - FIX Bug #2: Container validation for cross-container adoption detection
 * @private
 * @param {number|string|null} oldOriginTabId - Previous origin tab ID
 * @param {number} newOriginTabId - New origin tab ID
 * @returns {Promise<{valid: boolean, oldContainerId: string|null, newContainerId: string|null, reason?: string}>}
 */
async function _validateAdoptionContainers(oldOriginTabId, newOriginTabId) {
  // Skip validation if old tab ID is not a valid number (orphaned, null, etc.)
  if (typeof oldOriginTabId !== 'number' || oldOriginTabId <= 0) {
    console.log('[Manager] ADOPTION_CONTAINER_VALIDATION_SKIPPED:', {
      reason: 'old tab ID is not valid',
      oldOriginTabId,
      newOriginTabId
    });
    // Try to get new container ID even if we can't compare
    const newContainerId = await _getTabContainerId(newOriginTabId);
    return { valid: true, oldContainerId: null, newContainerId, reason: 'old tab not available' };
  }

  try {
    // Get container IDs for both tabs in parallel
    const [oldContainerId, newContainerId] = await Promise.all([
      _getTabContainerId(oldOriginTabId),
      _getTabContainerId(newOriginTabId)
    ]);

    // If either tab doesn't exist or container can't be determined, allow adoption
    if (oldContainerId === null || newContainerId === null) {
      return {
        valid: true,
        oldContainerId,
        newContainerId,
        reason: 'container ID not available for one or both tabs'
      };
    }

    // Compare containers
    const containersMatch = oldContainerId === newContainerId;
    return {
      valid: containersMatch,
      oldContainerId,
      newContainerId,
      reason: containersMatch ? 'containers match' : 'containers differ'
    };
  } catch (err) {
    console.warn('[Manager] ADOPTION_CONTAINER_VALIDATION_ERROR:', {
      oldOriginTabId,
      newOriginTabId,
      error: err.message
    });
    // On error, allow adoption but log warning
    return {
      valid: true,
      oldContainerId: null,
      newContainerId: null,
      reason: `validation error: ${err.message}`
    };
  }
}

/**
 * Get container ID (cookieStoreId) for a browser tab
 * v1.6.3.10-v7 - FIX Bug #2: Helper for container validation
 * @private
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<string|null>} Container ID or null if tab doesn't exist
 */
async function _getTabContainerId(tabId) {
  if (!tabId || tabId <= 0) {
    return null;
  }

  try {
    const tab = await browser.tabs.get(tabId);
    return tab?.cookieStoreId || 'firefox-default';
  } catch (err) {
    // Tab may not exist anymore
    console.log('[Manager] CONTAINER_ID_LOOKUP_FAILED:', {
      tabId,
      error: err.message
    });
    return null;
  }
}

/**
 * Perform surgical DOM update for adoption - only update the adopted Quick Tab
 * v1.6.3.10-v5 - FIX Bug #3: Prevents animation on all Quick Tabs during single adoption
 * @private
 * @param {string} adoptedQuickTabId - ID of the adopted Quick Tab
 * @param {number|string|null} oldOriginTabId - Previous origin tab ID (may be 'orphaned' or null)
 * @param {number} newOriginTabId - New origin tab ID
 * @returns {Promise<boolean>} True if surgical update succeeded, false if full render needed
 */
async function _performSurgicalAdoptionUpdate(adoptedQuickTabId, oldOriginTabId, newOriginTabId) {
  const startTime = Date.now();

  try {
    // Step 1: Load fresh state from storage
    const stateLoadResult = await _loadFreshAdoptionState(adoptedQuickTabId);
    if (!stateLoadResult.success) {
      return false;
    }

    const { adoptedTab } = stateLoadResult;

    // Step 2: Try to move existing element between groups
    const existingElement = _findQuickTabDOMElement(adoptedQuickTabId);
    const moveResult = await _tryMoveExistingElement({
      existingElement,
      adoptedTab,
      oldOriginTabId,
      newOriginTabId,
      adoptedQuickTabId,
      startTime
    });

    if (moveResult.handled) {
      return moveResult.success;
    }

    // Step 3: Try inserting into correct group as fallback
    return await _tryInsertAsNewElement({
      adoptedTab,
      existingElement,
      oldOriginTabId,
      newOriginTabId,
      adoptedQuickTabId,
      startTime
    });
  } catch (err) {
    console.error('[Manager] SURGICAL_UPDATE_ERROR:', {
      adoptedQuickTabId,
      error: err.message,
      durationMs: Date.now() - startTime
    });
    return false;
  }
}

/**
 * Load fresh state from storage for adoption surgical update
 * @private
 * @param {string} adoptedQuickTabId - ID of the adopted Quick Tab
 * @returns {Promise<{success: boolean, adoptedTab?: Object}>}
 */
async function _loadFreshAdoptionState(adoptedQuickTabId) {
  // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
  if (typeof browser.storage.session === 'undefined') {
    console.warn('[Manager] SURGICAL_UPDATE: storage.session unavailable');
    return { success: false };
  }
  const result = await browser.storage.session.get(STATE_KEY);
  const state = result?.[STATE_KEY];

  if (!state?.tabs) {
    console.warn('[Manager] SURGICAL_UPDATE: No tabs in storage');
    return { success: false };
  }

  // Update local state
  quickTabsState = state;
  _updateInMemoryCache(state.tabs);

  // Find the adopted Quick Tab
  const adoptedTab = state.tabs.find(t => t.id === adoptedQuickTabId);
  if (!adoptedTab) {
    console.warn('[Manager] SURGICAL_UPDATE: Adopted Quick Tab not found in state:', {
      adoptedQuickTabId
    });
    return { success: false };
  }

  return { success: true, adoptedTab };
}

/**
 * Try to move an existing DOM element between groups
 * @private
 * @returns {Promise<{handled: boolean, success: boolean}>}
 */
/**
 * Try to move an existing element between groups
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _tryMoveExistingElement({
  existingElement,
  adoptedTab,
  oldOriginTabId,
  newOriginTabId,
  adoptedQuickTabId,
  startTime
}) {
  if (!existingElement) return { handled: false, success: false };

  const moved = await _moveQuickTabBetweenGroups(
    existingElement,
    adoptedTab,
    oldOriginTabId,
    newOriginTabId
  );
  if (!moved) return { handled: false, success: false };

  console.log('[Manager] SURGICAL_UPDATE_COMPLETE:', {
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId,
    method: 'move-between-groups',
    durationMs: Date.now() - startTime
  });
  return { handled: true, success: true };
}

/**
 * Try to insert as a new element in the target group
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _tryInsertAsNewElement({
  adoptedTab,
  existingElement,
  oldOriginTabId,
  newOriginTabId,
  adoptedQuickTabId,
  startTime
}) {
  const inserted = await _insertQuickTabIntoGroup(adoptedTab, newOriginTabId);
  if (!inserted) {
    console.warn('[Manager] SURGICAL_UPDATE: Could not insert into target group');
    return false;
  }

  if (existingElement) {
    _removeQuickTabFromDOM(existingElement, oldOriginTabId);
  }

  console.log('[Manager] SURGICAL_UPDATE_COMPLETE:', {
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId,
    method: 'insert-into-group',
    durationMs: Date.now() - startTime
  });
  return true;
}

/**
 * Find existing DOM element for a Quick Tab by ID
 * v1.6.3.10-v5 - FIX Bug #3: Helper for surgical DOM updates
 * @private
 * @param {string} quickTabId - Quick Tab ID to find
 * @returns {HTMLElement|null} The DOM element or null if not found
 */
function _findQuickTabDOMElement(quickTabId) {
  return containersList.querySelector(`.quick-tab-item[data-tab-id="${quickTabId}"]`);
}

/**
 * Move a Quick Tab DOM element between groups
 * v1.6.3.10-v5 - FIX Bug #3: Moves element without recreating (prevents animation)
 * @private
 * @param {HTMLElement} element - The Quick Tab DOM element to move
 * @param {Object} tabData - Updated Quick Tab data
 * @param {number|string|null} oldOriginTabId - Previous group key
 * @param {number} newOriginTabId - New group key
 * @returns {boolean} True if move succeeded
 */
function _moveQuickTabBetweenGroups(element, tabData, oldOriginTabId, newOriginTabId) {
  // Find the target group
  const targetGroup = containersList.querySelector(
    `.tab-group[data-origin-tab-id="${newOriginTabId}"]`
  );

  if (!targetGroup) {
    // Target group doesn't exist - need to create it
    console.log('[Manager] SURGICAL_UPDATE: Target group not found, will create:', {
      newOriginTabId
    });
    return false;
  }

  const targetContent = targetGroup.querySelector('.tab-group-content');
  if (!targetContent) {
    console.warn('[Manager] SURGICAL_UPDATE: Target group has no content container');
    return false;
  }

  return _executeElementMove({ element, tabData, targetContent, oldOriginTabId, newOriginTabId });
}

/**
 * Execute element move between groups
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _executeElementMove({ element, tabData, targetContent, oldOriginTabId, newOriginTabId }) {
  const oldParent = element.parentElement;
  element.remove();
  element.classList.remove('orphaned-item');
  element.classList.add('adoption-animation');

  const isMinimized = isTabMinimizedHelper(tabData);
  const insertionPoint = _findInsertionPoint(targetContent, isMinimized);

  if (insertionPoint) {
    targetContent.insertBefore(element, insertionPoint);
  } else {
    targetContent.appendChild(element);
  }

  _updateGroupCountAfterMove(oldOriginTabId, newOriginTabId);
  _cleanupEmptySourceGroup(oldParent, oldOriginTabId);

  setTimeout(() => element.classList.remove('adoption-animation'), ANIMATION_DURATION_MS);

  console.log('[Manager] SURGICAL_MOVE_COMPLETE:', {
    quickTabId: tabData.id,
    fromGroup: oldOriginTabId,
    toGroup: newOriginTabId
  });
  return true;
}

/**
 * Find the correct insertion point within a group's content
 * v1.6.3.10-v5 - FIX Bug #3: Helper for surgical DOM insertion
 * @private
 * @param {HTMLElement} content - The group content container
 * @param {boolean} isMinimized - Whether the Quick Tab is minimized
 * @returns {HTMLElement|null} The element to insert before, or null to append
 */
function _findInsertionPoint(content, isMinimized) {
  if (isMinimized) {
    // Minimized tabs go at the end
    return null;
  }

  // Active tabs go before minimized tabs
  // Find the first minimized item or section divider
  const minimizedItem = content.querySelector('.quick-tab-item.minimized');
  const sectionDivider = content.querySelector('.section-divider');

  return sectionDivider || minimizedItem || null;
}

/**
 * Insert a Quick Tab into its target group
 * v1.6.3.10-v5 - FIX Bug #3: Creates element and inserts with animation
 * @private
 * @param {Object} tabData - Quick Tab data
 * @param {number} targetOriginTabId - Target group's origin tab ID
 * @returns {boolean} True if insertion succeeded
 */
function _insertQuickTabIntoGroup(tabData, targetOriginTabId) {
  const targetGroup = containersList.querySelector(
    `.tab-group[data-origin-tab-id="${targetOriginTabId}"]`
  );

  if (!targetGroup) {
    console.log('[Manager] SURGICAL_INSERT: Target group not found:', { targetOriginTabId });
    return false;
  }

  const targetContent = targetGroup.querySelector('.tab-group-content');
  if (!targetContent) {
    return false;
  }

  // Create and insert the element
  return _createAndInsertQuickTabElement(tabData, targetContent, targetOriginTabId);
}

/**
 * Create and insert a Quick Tab element into target content
 * v1.6.3.10-v5 - FIX Bug #3: Extracted to reduce nesting depth
 * @private
 * @param {Object} tabData - Quick Tab data
 * @param {HTMLElement} targetContent - Target content container
 * @param {number} targetOriginTabId - Target group's origin tab ID
 * @returns {boolean} True if successful
 */
function _createAndInsertQuickTabElement(tabData, targetContent, targetOriginTabId) {
  // Create the Quick Tab element
  const isMinimized = isTabMinimizedHelper(tabData);
  const newElement = renderQuickTabItem(tabData, 'global', isMinimized);

  // Add adoption animation class ONLY to this new element
  newElement.classList.add('adoption-animation');

  // Find insertion point and insert
  const insertionPoint = _findInsertionPoint(targetContent, isMinimized);
  if (insertionPoint) {
    targetContent.insertBefore(newElement, insertionPoint);
  } else {
    targetContent.appendChild(newElement);
  }

  // Update group count
  _incrementGroupCount(targetOriginTabId);

  // Remove animation class after animation completes
  setTimeout(() => {
    newElement.classList.remove('adoption-animation');
  }, ANIMATION_DURATION_MS);

  console.log('[Manager] SURGICAL_INSERT_COMPLETE:', {
    quickTabId: tabData.id,
    targetGroup: targetOriginTabId
  });

  return true;
}

/**
 * Remove a Quick Tab element from DOM and clean up source group
 * v1.6.3.10-v5 - FIX Bug #3: Helper for surgical removal
 * @private
 * @param {HTMLElement} element - The element to remove
 * @param {number|string|null} sourceGroupKey - The source group's key
 */
function _removeQuickTabFromDOM(element, sourceGroupKey) {
  const parent = element.parentElement;
  element.remove();

  // Update source group count
  _decrementGroupCount(sourceGroupKey);

  // Clean up empty source group
  _cleanupEmptySourceGroup(parent, sourceGroupKey);
}

/**
 * Update group counts after moving a Quick Tab
 * v1.6.3.10-v5 - FIX Bug #3: Updates count badges without re-render
 * @private
 * @param {number|string|null} oldGroupKey - Previous group key
 * @param {number} newGroupKey - New group key
 */
function _updateGroupCountAfterMove(oldGroupKey, newGroupKey) {
  _decrementGroupCount(oldGroupKey);
  _incrementGroupCount(newGroupKey);
}

/**
 * Decrement a group's count badge
 * v1.6.3.10-v5 - FIX Bug #3: Refactored with early returns for nesting depth compliance
 * @private
 * @param {number|string|null} groupKey - Group key
 */
function _decrementGroupCount(groupKey) {
  if (groupKey === null || groupKey === undefined) return;

  const group = containersList.querySelector(`.tab-group[data-origin-tab-id="${groupKey}"]`);
  if (!group) return;

  const countBadge = group.querySelector('.tab-group-count');
  if (!countBadge) return;

  const currentCount = parseInt(countBadge.textContent, 10) || 0;
  const newCount = Math.max(0, currentCount - 1);
  countBadge.textContent = String(newCount);
  countBadge.dataset.count = String(newCount);

  // Add visual feedback
  countBadge.classList.add('count-decreased');
  setTimeout(() => countBadge.classList.remove('count-decreased'), 300);
}

/**
 * Increment a group's count badge
 * v1.6.3.10-v5 - FIX Bug #3: Refactored with early returns for nesting depth compliance
 * @private
 * @param {number} groupKey - Group key
 */
function _incrementGroupCount(groupKey) {
  const group = containersList.querySelector(`.tab-group[data-origin-tab-id="${groupKey}"]`);
  if (!group) return;

  const countBadge = group.querySelector('.tab-group-count');
  if (!countBadge) return;

  const currentCount = parseInt(countBadge.textContent, 10) || 0;
  const newCount = currentCount + 1;
  countBadge.textContent = String(newCount);
  countBadge.dataset.count = String(newCount);

  // Add visual feedback
  countBadge.classList.add('count-increased');
  setTimeout(() => countBadge.classList.remove('count-increased'), 300);
}

/**
 * Clean up a source group if it's now empty after moving a Quick Tab
 * v1.6.3.10-v5 - FIX Bug #3: Removes empty groups with animation
 * Refactored with early returns to reduce nesting depth
 * @private
 * @param {HTMLElement|null} contentParent - The content container that was the parent
 * @param {number|string|null} groupKey - The group key
 */
function _cleanupEmptySourceGroup(contentParent, groupKey) {
  if (!contentParent) return;

  // Check if the content has any remaining Quick Tab items
  const remainingItems = contentParent.querySelectorAll('.quick-tab-item');
  if (remainingItems.length > 0) return;

  // Find the parent details element
  const groupElement = contentParent.closest('.tab-group');
  if (!groupElement) return;

  // Perform the cleanup
  _animateGroupRemovalAndCleanup(groupElement, groupKey);
}

/**
 * Animate group removal and clean up tracking
 * v1.6.3.10-v5 - FIX Bug #3: Extracted to reduce nesting depth
 * @private
 * @param {HTMLElement} groupElement - The group element to remove
 * @param {number|string|null} groupKey - The group key
 */
function _animateGroupRemovalAndCleanup(groupElement, groupKey) {
  console.log('[Manager] SURGICAL_CLEANUP: Removing empty group:', { groupKey });

  // Use the existing animation for group removal
  groupElement.classList.add('removing');
  setTimeout(() => {
    if (groupElement.parentNode) {
      groupElement.remove();
    }
  }, ANIMATION_DURATION_MS);

  // Update previousGroupCounts tracking
  if (previousGroupCounts.has(String(groupKey))) {
    previousGroupCounts.delete(String(groupKey));
  }
}

/**
 * Handle origin tab closed - mark Quick Tabs as orphaned in UI
 * v1.6.3.10-v3 - Phase 2: Orphan detection
 * @param {Object} message - Origin tab closed message
 */
function handleOriginTabClosed(message) {
  const { originTabId, orphanedQuickTabIds, orphanedCount, timestamp } = message;

  console.log('[Manager] ORIGIN_TAB_CLOSED received:', {
    originTabId,
    orphanedCount,
    orphanedIds: orphanedQuickTabIds,
    timeSinceBroadcast: Date.now() - timestamp
  });

  // Update cache staleness tracking
  lastCacheSyncFromStorage = Date.now();

  // Invalidate browser tab info cache for the closed tab
  browserTabInfoCache.delete(originTabId);

  // Schedule high-priority re-render to show orphan warnings
  scheduleRender('origin-tab-closed');

  console.log('[Manager] ORPHAN_RENDER_SCHEDULED:', {
    orphanedCount,
    trigger: 'port-ORIGIN_TAB_CLOSED'
  });
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

/**
 * Dispatch incoming runtime message to appropriate handler
 * v1.6.3.11-v12 - FIX Issue #5: Refactored from inline listener to reduce complexity
 * @param {Object} message - Incoming message
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} True if message was handled, false otherwise
 */
function _dispatchRuntimeMessage(message, sendResponse) {
  const handlers = {
    'QUICK_TAB_STATE_UPDATED': () => _handleStateUpdatedMessage(message, sendResponse),
    'QUICK_TAB_DELETED': () => _handleDeletedMessage(message, sendResponse),
    'QUICKTAB_MOVED': () => _handleMovedMessage(message, sendResponse),
    'QUICKTAB_RESIZED': () => _handleResizedMessage(message, sendResponse),
    'QUICKTAB_MINIMIZED': () => _handleMinimizedMessage(message, sendResponse),
    'QUICKTAB_REMOVED': () => _handleRemovedMessage(message, sendResponse)
  };

  const handler = handlers[message.type];
  if (handler) {
    return handler();
  }
  return false;
}

/**
 * Handle QUICK_TAB_STATE_UPDATED message
 * @private
 */
function _handleStateUpdatedMessage(message, sendResponse) {
  console.log('[Manager] Received QUICK_TAB_STATE_UPDATED:', {
    quickTabId: message.quickTabId,
    changes: message.changes,
    source: message.originalSource
  });

  if (message.changes?.deleted === true || message.originalSource === 'destroy') {
    handleStateDeletedMessage(message.quickTabId);
  } else if (message.quickTabId && message.changes) {
    handleStateUpdateMessage(message.quickTabId, message.changes);
  }

  // v1.6.3.11-v12 - FIX: Route through scheduleRender for consistency
  scheduleRender('QUICK_TAB_STATE_UPDATED');
  sendResponse({ received: true });
  return true;
}

/**
 * Handle QUICK_TAB_DELETED message
 * @private
 */
function _handleDeletedMessage(message, sendResponse) {
  console.log('[Manager] Received QUICK_TAB_DELETED:', {
    quickTabId: message.quickTabId,
    source: message.source
  });

  handleStateDeletedMessage(message.quickTabId);
  // v1.6.3.11-v12 - FIX: Route through scheduleRender for consistency
  scheduleRender('QUICK_TAB_DELETED');
  sendResponse({ received: true });
  return true;
}

/**
 * Handle QUICKTAB_MOVED message
 * @private
 */
function _handleMovedMessage(message, sendResponse) {
  console.log('[Manager] 📍 Received QUICKTAB_MOVED:', {
    quickTabId: message.quickTabId,
    left: message.left,
    top: message.top,
    originTabId: message.originTabId
  });

  handleQuickTabMovedMessage(message);
  sendResponse({ received: true });
  return true;
}

/**
 * Handle QUICKTAB_RESIZED message
 * @private
 */
function _handleResizedMessage(message, sendResponse) {
  console.log('[Manager] 📐 Received QUICKTAB_RESIZED:', {
    quickTabId: message.quickTabId,
    width: message.width,
    height: message.height,
    originTabId: message.originTabId
  });

  handleQuickTabResizedMessage(message);
  sendResponse({ received: true });
  return true;
}

/**
 * Handle QUICKTAB_MINIMIZED message
 * @private
 */
function _handleMinimizedMessage(message, sendResponse) {
  console.log('[Manager] 🔽 Received QUICKTAB_MINIMIZED:', {
    quickTabId: message.quickTabId,
    minimized: message.minimized,
    originTabId: message.originTabId
  });

  handleQuickTabMinimizedMessage(message);
  sendResponse({ received: true });
  return true;
}

/**
 * Handle QUICKTAB_REMOVED message
 * @private
 */
function _handleRemovedMessage(message, sendResponse) {
  // v1.6.3.11-v12 - FIX Issue #6: Track event for staleness detection
  _markEventReceived();

  console.log('[Manager] ❌ Received QUICKTAB_REMOVED:', {
    quickTabId: message.quickTabId,
    originTabId: message.originTabId,
    source: message.source
  });

  handleStateDeletedMessage(message.quickTabId);
  scheduleRender('QUICKTAB_REMOVED');
  sendResponse({ received: true });
  return true;
}

// v1.6.3.5-v3 - FIX Architecture Phase 1: Listen for state updates from background
// v1.6.3.5-v11 - FIX Issue #6: Handle QUICK_TAB_DELETED message and deletion via QUICK_TAB_STATE_UPDATED
// v1.6.3.11-v12 - FIX Issue #5: Handle QUICKTAB_MOVED, QUICKTAB_RESIZED, QUICKTAB_MINIMIZED, QUICKTAB_REMOVED
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  return _dispatchRuntimeMessage(message, sendResponse);
});

/**
 * Handle state update message from background
 * v1.6.3.5-v3 - FIX Architecture Phase 1: Update local state from message
 * v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime for accurate "Last sync"
 * v1.6.3.7-v1 - FIX ISSUE #7: Update quickTabHostInfo on ALL state changes (not just when originTabId provided)
 *   - Track last operation type (minimize/restore/update)
 *   - Validate and clean stale entries
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function handleStateUpdateMessage(quickTabId, changes) {
  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }

  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    // Update existing tab
    Object.assign(quickTabsState.tabs[existingIndex], changes);
    console.log('[Manager] Updated tab from message:', quickTabId);
  } else if (changes.url) {
    // Add new tab
    quickTabsState.tabs.push({ id: quickTabId, ...changes });
    console.log('[Manager] Added new tab from message:', quickTabId);
  }

  // v1.6.3.7-v1 - FIX ISSUE #7: Update quickTabHostInfo on ANY state change
  // This ensures the Map stays in sync even when operations originate from content scripts
  _updateQuickTabHostInfo(quickTabId, changes);

  // Update timestamp
  quickTabsState.timestamp = Date.now();

  // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive state updates
  lastLocalUpdateTime = Date.now();
}

/**
 * Handle QUICKTAB_MOVED message from content script
 * v1.6.3.11-v12 - FIX Issue #5: Real-time position update handler
 * @param {Object} message - QUICKTAB_MOVED message
 */
function handleQuickTabMovedMessage(message) {
  const { quickTabId, left, top, originTabId } = message;

  // v1.6.3.11-v12 - FIX Issue #6: Track event for staleness detection
  _markEventReceived();

  console.log('[Manager] [MOVE_HANDLER] Processing position update:', {
    quickTabId, left, top, originTabId
  });

  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }

  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    quickTabsState.tabs[existingIndex].left = left;
    quickTabsState.tabs[existingIndex].top = top;
    console.log('[Manager] [MOVE_HANDLER] Updated position for:', quickTabId);
  } else {
    console.warn('[Manager] [MOVE_HANDLER] Tab not found in state:', quickTabId);
  }

  // Update host info if originTabId provided
  if (originTabId != null) {
    _updateQuickTabHostInfo(quickTabId, { originTabId, left, top });
  }

  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();

  // Schedule render for UI update
  scheduleRender('QUICKTAB_MOVED');
}

/**
 * Handle QUICKTAB_RESIZED message from content script
 * v1.6.3.11-v12 - FIX Issue #5: Real-time size update handler
 * @param {Object} message - QUICKTAB_RESIZED message
 */
function handleQuickTabResizedMessage(message) {
  const { quickTabId, width, height, originTabId } = message;

  // v1.6.3.11-v12 - FIX Issue #6: Track event for staleness detection
  _markEventReceived();

  console.log('[Manager] [RESIZE_HANDLER] Processing size update:', {
    quickTabId, width, height, originTabId
  });

  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }

  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    quickTabsState.tabs[existingIndex].width = width;
    quickTabsState.tabs[existingIndex].height = height;
    console.log('[Manager] [RESIZE_HANDLER] Updated size for:', quickTabId);
  } else {
    console.warn('[Manager] [RESIZE_HANDLER] Tab not found in state:', quickTabId);
  }

  // Update host info if originTabId provided
  if (originTabId != null) {
    _updateQuickTabHostInfo(quickTabId, { originTabId, width, height });
  }

  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();

  // Schedule render for UI update
  scheduleRender('QUICKTAB_RESIZED');
}

/**
 * Handle QUICKTAB_MINIMIZED message from content script
 * v1.6.3.11-v12 - FIX Issue #5: Real-time minimize state update handler
 * @param {Object} message - QUICKTAB_MINIMIZED message
 */
function handleQuickTabMinimizedMessage(message) {
  const { quickTabId, minimized, originTabId } = message;

  // v1.6.3.11-v12 - FIX Issue #6: Track event for staleness detection
  _markEventReceived();

  console.log('[Manager] [MINIMIZE_HANDLER] Processing minimize state update:', {
    quickTabId, minimized, originTabId
  });

  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }

  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    quickTabsState.tabs[existingIndex].minimized = minimized;
    console.log('[Manager] [MINIMIZE_HANDLER] Updated minimize state for:', quickTabId, minimized);
  } else {
    console.warn('[Manager] [MINIMIZE_HANDLER] Tab not found in state:', quickTabId);
  }

  // Update host info if originTabId provided
  if (originTabId != null) {
    _updateQuickTabHostInfo(quickTabId, { originTabId, minimized });
  }

  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();

  // Schedule render for UI update
  scheduleRender('QUICKTAB_MINIMIZED');
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

// ==================== v1.6.3.10-v7 HOST INFO MAINTENANCE ====================
// FIX Bug #1: Periodic cleanup to prevent memory leaks

/**
 * Start periodic maintenance task for quickTabHostInfo
 * v1.6.3.10-v7 - FIX Bug #1: Prevents memory leak from orphaned entries
 */
function _startHostInfoMaintenance() {
  // Clear any existing interval
  if (hostInfoMaintenanceIntervalId) {
    clearInterval(hostInfoMaintenanceIntervalId);
  }

  // Run maintenance every 5 minutes
  hostInfoMaintenanceIntervalId = setInterval(() => {
    _performHostInfoMaintenance();
  }, HOST_INFO_MAINTENANCE_INTERVAL_MS);

  console.log('[Manager] HOST_INFO_MAINTENANCE_STARTED:', {
    intervalMs: HOST_INFO_MAINTENANCE_INTERVAL_MS,
    maxEntries: HOST_INFO_MAX_ENTRIES
  });
}

/**
 * Stop periodic maintenance task
 * v1.6.3.10-v7 - FIX Bug #1: Cleanup on unload
 */
function _stopHostInfoMaintenance() {
  if (hostInfoMaintenanceIntervalId) {
    clearInterval(hostInfoMaintenanceIntervalId);
    hostInfoMaintenanceIntervalId = null;
    console.log('[Manager] HOST_INFO_MAINTENANCE_STOPPED');
  }
}

/**
 * Get set of valid Quick Tab IDs from current state
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _performHostInfoMaintenance
 * @private
 * @returns {Set} Set of valid Quick Tab IDs
 */
function _getValidQuickTabIds() {
  const validIds = new Set();
  if (quickTabsState?.tabs && Array.isArray(quickTabsState.tabs)) {
    quickTabsState.tabs.forEach(tab => validIds.add(tab.id));
  }
  return validIds;
}

/**
 * Find orphaned host info entries
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _performHostInfoMaintenance
 * @private
 * @param {Set} validQuickTabIds - Set of valid Quick Tab IDs
 * @returns {Array} Array of orphaned entry IDs
 */
function _findOrphanedHostInfoEntries(validQuickTabIds) {
  const orphaned = [];
  for (const [quickTabId] of quickTabHostInfo.entries()) {
    if (!validQuickTabIds.has(quickTabId)) {
      orphaned.push(quickTabId);
    }
  }
  return orphaned;
}

/**
 * Perform maintenance on quickTabHostInfo - remove orphaned entries
 * v1.6.3.10-v7 - FIX Bug #1: Validates entries against current quickTabsState
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 */
function _performHostInfoMaintenance() {
  const startTime = Date.now();
  const entriesBefore = quickTabHostInfo.size;

  if (entriesBefore === 0) return;

  const validQuickTabIds = _getValidQuickTabIds();
  const orphanedEntries = _findOrphanedHostInfoEntries(validQuickTabIds);

  // Delete orphaned entries
  orphanedEntries.forEach(id => quickTabHostInfo.delete(id));

  // Check if we still exceed max size - prune oldest entries
  const prunedOldest = _pruneOldestHostInfoEntries();

  if (orphanedEntries.length > 0 || prunedOldest > 0) {
    console.log('[Manager] HOST_INFO_MAINTENANCE_COMPLETE:', {
      entriesBefore,
      entriesAfter: quickTabHostInfo.size,
      orphanedRemoved: orphanedEntries.length,
      oldestPruned: prunedOldest,
      validQuickTabCount: validQuickTabIds.size,
      durationMs: Date.now() - startTime
    });
  }
}

/**
 * Prune oldest entries if map exceeds max size
 * v1.6.3.10-v7 - FIX Bug #1: Max size guard (500 entries)
 * @returns {number} Number of entries pruned
 */
function _pruneOldestHostInfoEntries() {
  if (quickTabHostInfo.size <= HOST_INFO_MAX_ENTRIES) {
    return 0;
  }

  // Convert to array and sort by lastUpdate (oldest first)
  const entries = Array.from(quickTabHostInfo.entries()).sort(
    (a, b) => (a[1].lastUpdate || 0) - (b[1].lastUpdate || 0)
  );

  // Calculate how many to remove
  const toRemove = quickTabHostInfo.size - HOST_INFO_MAX_ENTRIES;
  const removed = entries.slice(0, toRemove);

  // Remove oldest entries
  removed.forEach(([id]) => quickTabHostInfo.delete(id));

  console.log('[Manager] HOST_INFO_PRUNED_OLDEST:', {
    removed: toRemove,
    oldestRemovedIds: removed.slice(0, 5).map(([id]) => id), // Log first 5 for debug
    newSize: quickTabHostInfo.size
  });

  return toRemove;
}

// ==================== END HOST INFO MAINTENANCE ====================

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
  // Cache DOM elements
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');

  // v1.6.3.5-v2 - FIX Report 1 Issue #2: Get current tab ID for origin filtering
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentBrowserTabId = tabs[0].id;
      console.log('[Manager] Current browser tab ID:', currentBrowserTabId);
    }
  } catch (err) {
    console.warn('[Manager] Could not get current tab ID:', err);
  }

  // v1.6.3.6-v11 - FIX Issue #11: Establish persistent port connection
  connectToBackground();

  // Load container information from Firefox API
  await loadContainerInfo();

  // Load Quick Tabs state from storage
  await loadQuickTabsState();

  // Render initial UI
  renderUI();

  // Setup event listeners
  setupEventListeners();

  // v1.6.3.7-v1 - FIX ISSUE #1: Setup tab switch detection
  // Re-render UI when user switches browser tabs to show context-relevant Quick Tabs
  setupTabSwitchListener();

  // v1.6.3.10-v7 - FIX Bug #1: Start periodic maintenance for quickTabHostInfo
  _startHostInfoMaintenance();

  // Auto-refresh every 2 seconds
  // v1.6.3.11-v12 - FIX Issue #6: Enhanced with staleness detection
  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();

    // v1.6.3.11-v12 - FIX Issue #6: Check for staleness
    _checkStaleness();
  }, 2000);

  // v1.6.3.11-v12 - FIX Issue #6: Request immediate sync on Manager open
  _requestImmediateSync();

  console.log(
    '[Manager] v1.6.3.11-v12 Port connection + Message infrastructure + Host info maintenance + Staleness tracking initialized'
  );
});

/**
 * Check for staleness and log warning if no events received for threshold period
 * v1.6.3.11-v12 - FIX Issue #6: Staleness tracking for fallback sync
 * @private
 */
function _checkStaleness() {
  if (lastEventReceivedTime === 0) {
    // No events received yet - this is normal on startup
    return;
  }

  const timeSinceLastEvent = Date.now() - lastEventReceivedTime;
  if (timeSinceLastEvent > STALENESS_THRESHOLD_MS) {
    console.warn('[Manager] ⚠️ STALENESS_WARNING: No events received for', {
      timeSinceLastEventMs: timeSinceLastEvent,
      thresholdMs: STALENESS_THRESHOLD_MS,
      lastEventReceivedTime,
      lastLocalUpdateTime,
      recommendation: 'Consider checking content script connectivity'
    });
  }
}

/**
 * Request immediate state sync from background when Manager opens
 * v1.6.3.11-v12 - FIX Issue #6: Ensure Manager has current state on open
 * @private
 */
async function _requestImmediateSync() {
  try {
    console.log('[Manager] [SYNC] Requesting immediate state sync on open');

    await browser.runtime.sendMessage({
      type: 'REQUEST_FULL_STATE_SYNC',
      source: 'Manager',
      timestamp: Date.now()
    });

    console.log('[Manager] [SYNC] Sync request sent');
  } catch (err) {
    console.debug('[Manager] [SYNC] Could not request sync:', err.message);
  }
}

/**
 * Update lastEventReceivedTime when any event is processed
 * v1.6.3.11-v12 - FIX Issue #6: Track last event for staleness detection
 * @private
 */
function _markEventReceived() {
  lastEventReceivedTime = Date.now();
}

// v1.6.3.6-v11 - FIX Issue #17: Port cleanup on window unload
// v1.6.3.6-v12 - FIX Issue #4: Also stop heartbeat on unload
// v1.6.3.10-v7 - FIX Bug #1: Also stop host info maintenance on unload
window.addEventListener('unload', () => {
  // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat before disconnecting
  stopHeartbeat();

  // v1.6.3.10-v7 - FIX Bug #1: Stop host info maintenance
  _stopHostInfoMaintenance();

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
 */
function _handleEmptyStorageState() {
  // v1.6.3.5-v11 - FIX Issue #6: Check if this is a legitimate single-tab deletion
  if (inMemoryTabsCache.length === 1) {
    console.log(
      '[Manager] Storage empty with single-tab cache - clearing cache (legitimate deletion)'
    );
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    quickTabsState = {};
    return;
  }

  // Multiple tabs in cache but storage empty - use cache (potential storm protection)
  if (inMemoryTabsCache.length > 1) {
    console.log(
      '[Manager] Storage returned empty but cache has',
      inMemoryTabsCache.length,
      'tabs - using cache'
    );
    quickTabsState = { tabs: inMemoryTabsCache, timestamp: Date.now() };
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
 * v1.6.3.10-v2 - FIX Issue #8: Cache NOT used as fallback for corrupted storage
 *   - Trigger immediate reconciliation instead
 *   - Cache only used for initial hydration on page load
 *   - Track cache staleness
 * @param {Object} state - Storage state
 * @returns {boolean} True if storm detected and handled
 */
function _detectStorageStorm(state) {
  const storageTabs = state.tabs || [];

  // No storm if storage has tabs
  if (storageTabs.length !== 0) {
    // v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp when storage has valid data
    lastCacheSyncFromStorage = Date.now();
    return false;
  }

  // No cache to protect - no storm possible
  if (inMemoryTabsCache.length < MIN_TABS_FOR_CACHE_PROTECTION) {
    return false;
  }

  // v1.6.3.5-v11 - FIX Issue #6: Single tab deletion is legitimate, not a storm
  // If cache has exactly 1 tab and storage has 0, user closed the last Quick Tab
  if (inMemoryTabsCache.length === 1) {
    console.log(
      '[Manager] Single tab→0 transition detected - clearing cache (legitimate deletion)'
    );
    // Clear the cache to accept the new 0-tab state
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    lastCacheSyncFromStorage = Date.now();
    return false; // Not a storm - proceed with normal update
  }

  // v1.6.3.10-v2 - FIX Issue #8: Check cache staleness - alert if >30 seconds without refresh
  const cacheStalenessMs = Date.now() - lastCacheSyncFromStorage;
  if (cacheStalenessMs > CACHE_STALENESS_ALERT_MS) {
    console.warn('[Manager] CACHE_STALENESS_ALERT:', {
      stalenessMs: cacheStalenessMs,
      alertThresholdMs: CACHE_STALENESS_ALERT_MS,
      cacheTabCount: inMemoryTabsCache.length,
      lastSyncTimestamp: lastCacheSyncFromStorage
    });
  }

  // v1.6.3.6-v12 - FIX Issue #5: CACHE_DIVERGENCE - trigger reconciliation
  // v1.6.3.10-v2 - FIX Issue #8: Cache NOT used as fallback - reconciliation is authoritative
  console.warn('[Manager] v1.6.3.10-v2 CACHE_DIVERGENCE (no fallback):', {
    storageTabCount: storageTabs.length,
    cacheTabCount: inMemoryTabsCache.length,
    lastKnownGoodCount: lastKnownGoodTabCount,
    cacheStalenessMs,
    saveId: state.saveId,
    action: 'triggering immediate reconciliation'
  });

  // v1.6.3.6-v12 - FIX Issue #5: Trigger reconciliation with content scripts
  // v1.6.3.10-v2 - FIX Issue #8: Do NOT use cache as fallback - let reconciliation determine truth
  _triggerCacheReconciliation();

  // v1.6.3.10-v2 - FIX Issue #8: Return true to skip normal processing
  // UI will be updated by reconciliation callback
  return true;
}

/**
 * Trigger reconciliation with content scripts when cache diverges from storage
 * v1.6.3.6-v12 - FIX Issue #5: Query content scripts and restore to STORAGE if needed
 * v1.6.3.6-v12 - FIX Code Review: Use module-level imports instead of dynamic import
 * v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp after reconciliation
 */
async function _triggerCacheReconciliation() {
  console.log('[Manager] v1.6.3.10-v2 Starting cache reconciliation...');

  try {
    // Query all content scripts for their Quick Tabs
    // v1.6.3.6-v12 - FIX Code Review: Using module-level import
    const contentScriptTabs = await queryAllContentScriptsForQuickTabs();

    console.log('[Manager] v1.6.3.10-v2 Reconciliation found:', {
      contentScriptTabCount: contentScriptTabs.length,
      cacheTabCount: inMemoryTabsCache.length
    });

    if (contentScriptTabs.length > 0) {
      // v1.6.3.6-v12 - FIX Issue #5: Content scripts have tabs - restore to STORAGE
      console.warn(
        '[Manager] CORRUPTION_CONFIRMED: Content scripts have tabs but storage is empty'
      );
      console.log('[Manager] v1.6.3.10-v2 Restoring state to storage...');

      const restoredState = await restoreStateFromContentScripts(contentScriptTabs);
      quickTabsState = restoredState;
      inMemoryTabsCache = [...restoredState.tabs];
      lastKnownGoodTabCount = restoredState.tabs.length;
      // v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp
      lastCacheSyncFromStorage = Date.now();

      console.log(
        '[Manager] v1.6.3.10-v2 Reconciliation complete: Restored',
        contentScriptTabs.length,
        'tabs to storage'
      );
      renderUI(); // Re-render with restored state
    } else {
      // v1.6.3.6-v12 - FIX Issue #5: Content scripts also show 0 - accept 0 and clear cache
      console.log('[Manager] v1.6.3.10-v2 Content scripts confirm 0 tabs - accepting empty state');
      inMemoryTabsCache = [];
      lastKnownGoodTabCount = 0;
      // v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp
      lastCacheSyncFromStorage = Date.now();
      quickTabsState = { tabs: [], timestamp: Date.now() };
      renderUI();
    }
  } catch (err) {
    console.error('[Manager] v1.6.3.10-v2 Reconciliation error:', err.message);
    // v1.6.3.10-v2 - FIX Issue #8: Do NOT use cache as fallback on error
    // Log the error but don't silently mask storage issues
    console.warn(
      '[Manager] RECONCILIATION_ERROR: Not using cache fallback - showing current state'
    );
  }
}

/**
 * Update in-memory cache with valid state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Also update cache when tabs.length is 0 (legitimate deletion)
 *   The cache must be cleared when tabs legitimately reach 0, not just updated when > 0.
 * v1.6.3.10-v2 - FIX Issue #8: Track cache staleness timestamp
 * @param {Array} tabs - Tabs array from storage
 */
function _updateInMemoryCache(tabs) {
  // v1.6.3.10-v2 - FIX Issue #8: Always update cache sync timestamp
  lastCacheSyncFromStorage = Date.now();

  // v1.6.3.10-v2 - FIX Issue #8: Mark initial hydration as complete
  if (!cacheHydrationComplete && tabs.length >= 0) {
    cacheHydrationComplete = true;
    console.log('[Manager] CACHE_HYDRATION_COMPLETE:', {
      tabCount: tabs.length,
      timestamp: lastCacheSyncFromStorage
    });
  }

  if (tabs.length > 0) {
    inMemoryTabsCache = [...tabs];
    lastKnownGoodTabCount = tabs.length;
    console.log('[Manager] Updated in-memory cache:', {
      tabCount: tabs.length,
      syncTimestamp: lastCacheSyncFromStorage
    });
  } else if (lastKnownGoodTabCount === 1) {
    // v1.6.3.5-v11 - FIX Issue #6: Clear cache when going from 1→0 (single-tab deletion)
    console.log('[Manager] Clearing in-memory cache (single-tab deletion detected)');
    inMemoryTabsCache = [];
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
 * Refactored: Extracted helpers to reduce complexity and nesting depth
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 */
async function loadQuickTabsState() {
  const loadStartTime = Date.now();

  try {
    await checkStorageDebounce();

    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read start
    console.log('[Manager] Reading Quick Tab state from storage...');

    // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
    if (typeof browser.storage.session === 'undefined') {
      console.warn('[Manager] storage.session unavailable');
      _handleEmptyStorageState();
      return;
    }
    const result = await browser.storage.session.get(STATE_KEY);
    const state = result?.[STATE_KEY];

    if (!state) {
      _handleEmptyStorageState();
      console.log('[Manager] Storage read complete: empty state', {
        source: 'storage.session',
        durationMs: Date.now() - loadStartTime
      });
      return;
    }

    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read result
    console.log('[Manager] Storage read result:', {
      tabCount: state.tabs?.length ?? 0,
      saveId: state.saveId,
      timestamp: state.timestamp,
      source: 'storage.session',
      durationMs: Date.now() - loadStartTime
    });

    // v1.6.3.4-v6 - FIX Issue #5: Check if state has actually changed
    const newHash = computeStateHash(state);
    if (newHash === lastRenderedStateHash) {
      console.log('[Manager] Storage state unchanged (hash match), skipping update');
      return;
    }

    // v1.6.3.5-v4 - FIX Diagnostic Issue #2: Protect against storage storms
    if (_detectStorageStorm(state)) return;

    // v1.6.3.5-v4 - Update cache with new valid state
    _updateInMemoryCache(state.tabs || []);

    quickTabsState = state;
    filterInvalidTabs(quickTabsState);

    // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive new state from storage
    lastLocalUpdateTime = Date.now();

    console.log('[Manager] Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('[Manager] Error loading Quick Tabs state:', err);
  }
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
 * Execute the debounced render operation
 * v1.6.3.11-v3 - FIX CodeScene: Extract from renderUI to reduce complexity
 * @private
 * @param {number} debounceTime - The debounce time used
 */
async function _executeDebounceRender(debounceTime) {
  renderDebounceTimer = null;

  // Only render if still pending (wasn't cancelled)
  if (!pendingRenderUI) {
    console.log('[Manager] Skipping debounced render - no longer pending');
    return;
  }

  pendingRenderUI = false;
  const completionTime = Date.now();
  console.log('[Manager] RENDER_DEBOUNCE_COMPLETE:', {
    totalWaitMs: completionTime - debounceStartTimestamp,
    extensions: debounceExtensionCount,
    finalDebounceMs: debounceTime
  });

  // Reset sliding window tracking
  debounceStartTimestamp = 0;
  debounceExtensionCount = 0;

  // Fetch CURRENT state from storage, not captured hash
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

  // Update hash before render to prevent re-render loops even if _renderUIImmediate() throws
  lastRenderedHash = finalHash;
  lastRenderedStateHash = finalHash;

  // Synchronize DOM mutation with requestAnimationFrame
  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
}

/**
 * Render the Quick Tabs Manager UI (debounced)
 * v1.6.3.7 - FIX Issue #3: Debounced to max once per 300ms to prevent UI flicker
 * v1.6.4.0 - FIX Issue D: Hash-based state staleness detection during debounce
 * v1.6.3.10-v2 - FIX Issue #1: Sliding-window debounce that extends timer on new changes
 *   - Reduced debounce from 300ms to 100ms
 *   - Timer extends on each new change (up to RENDER_DEBOUNCE_MAX_WAIT_MS)
 *   - Compares against CURRENT storage read, not captured hash
 * v1.6.3.11-v3 - FIX CodeScene: Extract debounce callback to reduce complexity
 * This is the public API - all callers should use this function.
 */
function renderUI() {
  const now = Date.now();
  pendingRenderUI = true;

  // Sliding-window debounce logic
  const isNewDebounceWindow = debounceStartTimestamp === 0 || !renderDebounceTimer;

  if (isNewDebounceWindow) {
    debounceStartTimestamp = now;
    debounceExtensionCount = 0;
    capturedStateHashAtDebounce = computeStateHash(quickTabsState);
  } else {
    debounceExtensionCount++;
    const totalWaitTime = now - debounceStartTimestamp;
    if (totalWaitTime >= RENDER_DEBOUNCE_MAX_WAIT_MS) {
      _forceRenderOnMaxWait(totalWaitTime);
      return;
    }
  }

  debounceSetTimestamp = now;
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }

  // Calculate remaining wait time for sliding window
  const elapsedSinceStart = now - debounceStartTimestamp;
  const remainingMaxWait = RENDER_DEBOUNCE_MAX_WAIT_MS - elapsedSinceStart;
  const debounceTime = Math.min(RENDER_DEBOUNCE_MS, remainingMaxWait);

  // Schedule the actual render
  renderDebounceTimer = setTimeout(() => _executeDebounceRender(debounceTime), debounceTime);
}

/**
 * Build stale check result object
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _checkAndReloadStaleState
 * @private
 */
function _buildStaleCheckResult(stateReloaded, inMemoryHash, storageHash, debounceWaitTime) {
  return {
    stateReloaded,
    capturedHash: capturedStateHashAtDebounce,
    currentHash: inMemoryHash,
    storageHash,
    debounceWaitMs: debounceWaitTime
  };
}

/**
 * Apply fresh state from storage if valid
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _checkAndReloadStaleState
 * @private
 */
function _applyFreshStorageState(storageState, inMemoryHash, storageHash) {
  if (storageState?.tabs) {
    quickTabsState = storageState;
    _updateInMemoryCache(storageState.tabs);
    console.log('[Manager] STALE_STATE_RELOADED:', {
      inMemoryHash,
      storageHash,
      inMemoryTabCount: quickTabsState?.tabs?.length ?? 0,
      storageTabCount: storageState.tabs.length
    });
  }
}

/**
 * Check for stale state during debounce and reload if needed
 * v1.6.4.0 - FIX Issue D: Extracted to reduce nesting depth
 * v1.6.3.10-v2 - FIX Issue #1: Always fetch CURRENT storage state, not just on hash mismatch
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 * @returns {Promise<{ stateReloaded: boolean, capturedHash: number, currentHash: number, storageHash: number, debounceWaitMs: number }>}
 */
async function _checkAndReloadStaleState() {
  const inMemoryHash = computeStateHash(quickTabsState);
  const debounceWaitTime = Date.now() - debounceSetTimestamp;

  try {
    // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
    if (typeof browser.storage.session === 'undefined') {
      return _buildStaleCheckResult(false, inMemoryHash, 0, debounceWaitTime);
    }
    const freshResult = await browser.storage.session.get(STATE_KEY);
    const storageState = freshResult?.[STATE_KEY];
    const storageHash = computeStateHash(storageState || {});

    // Compare in-memory state against storage state
    if (storageHash === inMemoryHash) {
      return _buildStaleCheckResult(false, inMemoryHash, storageHash, debounceWaitTime);
    }

    // Storage has different state - reload it
    _applyFreshStorageState(storageState, inMemoryHash, storageHash);
    return _buildStaleCheckResult(true, inMemoryHash, storageHash, debounceWaitTime);
  } catch (err) {
    console.warn('[Manager] Failed to check storage state, using in-memory:', err.message);
    return _buildStaleCheckResult(false, inMemoryHash, 0, debounceWaitTime);
  }
}

/**
 * Load fresh state from storage during debounce stale check
 * v1.6.4.0 - FIX Issue D: Extracted to reduce nesting depth
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 */
async function _loadFreshStateFromStorage() {
  try {
    // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
    if (typeof browser.storage.session === 'undefined') {
      console.warn('[Manager] storage.session unavailable');
      return;
    }
    const freshResult = await browser.storage.session.get(STATE_KEY);
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
 * Force render when max debounce wait time reached
 * v1.6.3.10-v2 - FIX Issue #1: Extracted to reduce nesting depth in renderUI()
 * @private
 * @param {number} totalWaitTime - Total time waited since debounce started
 */
function _forceRenderOnMaxWait(totalWaitTime) {
  console.log('[Manager] RENDER_DEBOUNCE_MAX_REACHED:', {
    totalWaitMs: totalWaitTime,
    extensions: debounceExtensionCount,
    maxWaitMs: RENDER_DEBOUNCE_MAX_WAIT_MS
  });

  // Clear timer and render immediately
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  debounceStartTimestamp = 0;
  debounceExtensionCount = 0;
  pendingRenderUI = false;

  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
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
 * v1.6.3.7 - FIX Issue #3: Renamed from renderUI, now called via debounce wrapper
 * v1.6.3.7 - FIX Issue #8: Enhanced render logging for debugging
 * v1.6.4.16 - FIX Area E: Enhanced render performance logging with [RENDER_PERF] prefix
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

    // v1.6.4.16 - FIX Area E: Log render performance even for empty state
    const emptyDuration = Date.now() - renderStartTime;
    console.log('[RENDER_PERF] Empty state render completed:', {
      durationMs: emptyDuration,
      tabsRendered: 0,
      groupsCreated: 0
    });
    return;
  }

  _showContentState();
  const groupStartTime = Date.now();
  const groups = groupQuickTabsByOriginTab(allTabs);
  const groupDuration = Date.now() - groupStartTime;

  const collapseStateStartTime = Date.now();
  const collapseState = await loadCollapseState();
  const collapseStateDuration = Date.now() - collapseStateStartTime;

  _logGroupRendering(groups);

  // v1.6.3.6-v11 - FIX Issue #20: Clean up stale count tracking
  const currentGroupKeys = new Set([...groups.keys()].map(String));
  cleanupPreviousGroupCounts(currentGroupKeys);

  const domStartTime = Date.now();
  const groupsContainer = await _buildGroupsContainer(groups, collapseState);
  checkAndRemoveEmptyGroups(groupsContainer, groups);

  containersList.appendChild(groupsContainer);
  attachCollapseEventListeners(groupsContainer, collapseState);
  const domDuration = Date.now() - domStartTime;

  // v1.6.3.7 - FIX Issue #3: Update hash tracker after successful render
  lastRenderedHash = computeStateHash(quickTabsState);
  lastRenderedStateHash = lastRenderedHash; // Keep both in sync for compatibility

  // v1.6.4.16 - FIX Area E: Enhanced render performance logging
  const totalDuration = Date.now() - renderStartTime;
  console.log('[RENDER_PERF] Render completed:', {
    totalDurationMs: totalDuration,
    phases: {
      groupingMs: groupDuration,
      collapseStateMs: collapseStateDuration,
      domManipulationMs: domDuration
    },
    tabsRendered: allTabs.length,
    groupsCreated: groups.size,
    isSlowRender: totalDuration > 100
  });

  // v1.6.3.7 - FIX Issue #8: Log render exit with summary
  console.log('[Manager] RENDER_UI: exit', {
    triggerReason,
    tabsRendered: allTabs.length,
    groupsCreated: groups.size,
    durationMs: totalDuration
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
 * @private
 */
function _showEmptyState() {
  containersList.style.display = 'none';
  emptyState.style.display = 'flex';
  console.log('[Manager] UI showing empty state (0 tabs)');
}

/**
 * Show content state UI
 * @private
 */
function _showContentState() {
  containersList.style.display = 'block';
  emptyState.style.display = 'none';
  containersList.innerHTML = '';
}

/**
 * Log group rendering info
 * @private
 */
function _logGroupRendering(groups) {
  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for Manager display GROUPING
  console.log('[Manager][Display] GROUPING: Organizing Quick Tabs by originTabId', {
    totalQuickTabs: [...groups.values()].reduce((sum, g) => sum + g.length, 0),
    groups: [...groups.entries()].map(([tabId, tabs]) => ({
      originTabId: tabId,
      count: tabs.length
    }))
  });

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
    console.log('[Manager] BUTTON_CLICKED: closeMinimized button');
    await closeMinimizedTabs();
  });

  // Close All button
  document.getElementById('closeAll').addEventListener('click', async () => {
    console.log('[Manager] BUTTON_CLICKED: closeAll button');
    await closeAllTabs();
  });

  // Delegated event listener for Quick Tab actions
  // v1.6.3.11-v11 - FIX Issue #47 Problem 4: Add detailed logging for button clicks
  containersList.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) {
      // v1.6.3.11-v11 - FIX Issue #47: Log when click doesn't match a button
      console.log('[Manager] CLICK_NOT_BUTTON:', {
        tagName: e.target.tagName,
        className: e.target.className,
        id: e.target.id
      });
      return;
    }

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    // v1.6.3.11-v11 - FIX Issue #47 Problem 4: Log button click with all relevant data
    console.log('[Manager] BUTTON_CLICKED:', {
      action,
      quickTabId,
      tabId,
      buttonText: button.textContent,
      buttonTitle: button.title,
      timestamp: new Date().toISOString()
    });

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
      default:
        // v1.6.3.11-v11 - FIX Issue #47: Log unknown actions
        console.warn('[Manager] UNKNOWN_ACTION:', {
          action,
          quickTabId,
          tabId
        });
    }
  });

  // v1.6.3.11-v11 - FIX Issue #47: Log event listener setup completion
  console.log('[Manager] EVENT_LISTENERS_SETUP_COMPLETE:', {
    timestamp: new Date().toISOString(),
    containersListElement: !!containersList,
    closeMinimizedElement: !!document.getElementById('closeMinimized'),
    closeAllElement: !!document.getElementById('closeAll')
  });

  // Listen for storage changes to auto-update
  // v1.6.3 - FIX: Changed from 'sync' to 'local' (storage location since v1.6.0.12)
  // v1.6.4.18 - FIX: Changed from 'local' to 'session' (Quick Tabs are now session-only)
  // v1.6.3.4-v6 - FIX Issue #1: Debounce storage reads to avoid mid-transaction reads
  // v1.6.3.4-v9 - FIX Issue #18: Add reconciliation logic for suspicious storage changes
  // v1.6.3.5-v2 - FIX Report 2 Issue #6: Refactored to reduce complexity
  browser.storage.onChanged.addListener((changes, areaName) => {
    // v1.6.4.18 - FIX: Listen for 'session' area changes for Quick Tabs state
    if (areaName !== 'session' || !changes[STATE_KEY]) return;
    _handleStorageChange(changes[STATE_KEY]);
  });
}

/**
 * Setup browser tab activation listener for real-time context updates
 * v1.6.3.7-v1 - FIX ISSUE #1: Manager Panel Shows Orphaned Quick Tabs
 * When user switches between browser tabs, update the Manager to show
 * context-relevant Quick Tabs (those with originTabId matching current tab)
 */
function setupTabSwitchListener() {
  // Listen for tab activation (user switches to a different tab)
  browser.tabs.onActivated.addListener(activeInfo => {
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

  console.log('[Manager] Tab switch listener initialized');
}

/**
 * Handle storage change event
 * v1.6.3.5-v2 - Extracted to reduce setupEventListeners complexity
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Added comprehensive logging
 * v1.6.3.7 - FIX Issue #3: Skip renderUI() if only z-index changed (flicker prevention)
 * v1.6.3.7 - FIX Issue #4: Update lastLocalUpdateTime on storage.onChanged
 * v1.6.3.7 - FIX Issue #8: Enhanced storage synchronization logging
 * v1.6.3.7-v1 - FIX ISSUE #5: Added writingTabId source identification
 * v1.6.4.11 - Refactored to reduce cyclomatic complexity from 23 to <9
 * @param {Object} change - The storage change object
 */
function _handleStorageChange(change) {
  const context = _buildStorageChangeContext(change);

  // v1.6.3.7 - FIX Issue #8: Log storage listener entry
  console.log('[Manager] STORAGE_LISTENER:', {
    event: 'storage.onChanged',
    oldSaveId: context.oldValue?.saveId || 'none',
    newSaveId: context.newValue?.saveId || 'none',
    timestamp: Date.now()
  });

  // Log the storage change
  _logStorageChangeEvent(context);

  // Log tab ID changes (added/removed)
  _logTabIdChanges(context);

  // Log position/size updates
  _logPositionSizeChanges(context);

  // Check for and handle suspicious drops
  if (_isSuspiciousStorageDrop(context.oldTabCount, context.newTabCount, context.newValue)) {
    _handleSuspiciousStorageDrop(context.oldValue);
    return;
  }

  // v1.6.3.7 - FIX Issue #3: Check if only metadata changed (z-index, etc.)
  const changeAnalysis = _analyzeStorageChange(context.oldValue, context.newValue);

  // v1.6.3.7 - FIX Issue #4: Update lastLocalUpdateTime for ANY real data change
  if (changeAnalysis.hasDataChange) {
    lastLocalUpdateTime = Date.now();
    console.log('[Manager] STORAGE_LISTENER: lastLocalUpdateTime updated', {
      newTimestamp: lastLocalUpdateTime,
      reason: changeAnalysis.changeReason
    });
  }

  // v1.6.3.7 - FIX Issue #3: Skip renderUI if only metadata changed
  if (!changeAnalysis.requiresRender) {
    console.log('[Manager] STORAGE_LISTENER: Skipping renderUI (metadata-only change)', {
      changeType: changeAnalysis.changeType,
      reason: changeAnalysis.skipReason
    });
    // Still update local state cache but don't re-render
    _updateLocalStateCache(context.newValue);
    return;
  }

  _scheduleStorageUpdate();
}

/**
 * Build analysis result for storage change
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _analyzeStorageChange
 * v1.6.3.11-v9 - FIX CodeScene: Use options object to reduce argument count
 * @private
 * @param {Object} options - Analysis result options
 * @param {boolean} options.requiresRender - Whether render is required
 * @param {boolean} options.hasDataChange - Whether data changed
 * @param {string} options.changeType - Type of change
 * @param {string} options.changeReason - Reason for change
 * @param {string} [options.skipReason] - Reason for skipping (optional)
 * @returns {Object} Analysis result
 */
function _buildAnalysisResult(options) {
  return {
    requiresRender: options.requiresRender,
    hasDataChange: options.hasDataChange,
    changeType: options.changeType,
    changeReason: options.changeReason,
    skipReason: options.skipReason ?? null
  };
}

/**
 * Create analysis result for tab count change
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @private
 * @param {number} oldCount - Previous tab count
 * @param {number} newCount - New tab count
 * @returns {Object} Analysis result
 */
function _buildTabCountChangeResult(oldCount, newCount) {
  return _buildAnalysisResult({
    requiresRender: true,
    hasDataChange: true,
    changeType: 'tab-count',
    changeReason: `Tab count changed: ${oldCount} → ${newCount}`
  });
}

/**
 * Create analysis result for metadata-only change
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @private
 * @param {Object} zIndexChanges - Z-index change details
 * @returns {Object} Analysis result
 */
function _buildMetadataOnlyResult(zIndexChanges) {
  return _buildAnalysisResult({
    requiresRender: false,
    hasDataChange: false,
    changeType: 'metadata-only',
    changeReason: 'z-index only',
    skipReason: `Only z-index changed: ${JSON.stringify(zIndexChanges)}`
  });
}

/**
 * Create analysis result for data change
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @private
 * @param {Array<string>} dataChangeReasons - Reasons for data change
 * @returns {Object} Analysis result
 */
function _buildDataChangeResult(dataChangeReasons) {
  return _buildAnalysisResult({
    requiresRender: true,
    hasDataChange: true,
    changeType: 'data',
    changeReason: dataChangeReasons.join('; ')
  });
}

/**
 * Create analysis result for no changes
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @private
 * @returns {Object} Analysis result
 */
function _buildNoChangesResult() {
  return _buildAnalysisResult({
    requiresRender: false,
    hasDataChange: false,
    changeType: 'none',
    changeReason: 'no changes',
    skipReason: 'No detectable changes between old and new state'
  });
}

/**
 * Get tabs array from storage value safely
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @private
 * @param {Object} value - Storage value object
 * @returns {Array} Tabs array or empty array
 */
function _getTabsFromValue(value) {
  return value?.tabs || [];
}

/**
 * Determine the appropriate result based on change analysis
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @private
 * @param {Object} changeResults - Results from _checkTabChanges
 * @returns {Object} Analysis result
 */
function _buildResultFromChangeAnalysis(changeResults) {
  // If only z-index changed, skip render
  if (!changeResults.hasDataChange && changeResults.hasMetadataOnlyChange) {
    return _buildMetadataOnlyResult(changeResults.zIndexChanges);
  }

  // If there are data changes, render is required
  if (changeResults.hasDataChange) {
    return _buildDataChangeResult(changeResults.dataChangeReasons);
  }

  // No changes detected
  return _buildNoChangesResult();
}

/**
 * Analyze storage change to determine if renderUI() is needed
 * v1.6.3.7 - FIX Issue #3: Differential update detection
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting result builder
 * v1.6.3.11-v9 - FIX CodeScene: Reduce complexity by extracting result factories and change analysis
 * @private
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @returns {{ requiresRender: boolean, hasDataChange: boolean, changeType: string, changeReason: string, skipReason: string }}
 */
function _analyzeStorageChange(oldValue, newValue) {
  const oldTabs = _getTabsFromValue(oldValue);
  const newTabs = _getTabsFromValue(newValue);

  // Tab count change always requires render
  if (oldTabs.length !== newTabs.length) {
    return _buildTabCountChangeResult(oldTabs.length, newTabs.length);
  }

  // Check for structural changes and determine result
  const changeResults = _checkTabChanges(oldTabs, newTabs);
  return _buildResultFromChangeAnalysis(changeResults);
}

/**
 * Check a single tab for data changes
 * v1.6.3.7 - FIX Issue #3: Helper to reduce _analyzeStorageChange complexity
 * v1.6.3.11-v3 - FIX CodeScene: Use data-driven approach to reduce complexity
 * @private
 * @param {Object} oldTab - Previous tab state
 * @param {Object} newTab - New tab state
 * @returns {{ hasDataChange: boolean, reasons: Array<string> }}
 */
function _checkSingleTabDataChanges(oldTab, newTab) {
  const reasons = [];
  const tabId = newTab.id;

  // Data-driven change checks
  const checks = [
    {
      cond: oldTab.originTabId !== newTab.originTabId,
      msg: `originTabId changed for ${tabId}: ${oldTab.originTabId} → ${newTab.originTabId}`
    },
    { cond: oldTab.minimized !== newTab.minimized, msg: `minimized changed for ${tabId}` },
    {
      cond: oldTab.left !== newTab.left || oldTab.top !== newTab.top,
      msg: `position changed for ${tabId}`
    },
    {
      cond: oldTab.width !== newTab.width || oldTab.height !== newTab.height,
      msg: `size changed for ${tabId}`
    },
    {
      cond: oldTab.title !== newTab.title || oldTab.url !== newTab.url,
      msg: `title/url changed for ${tabId}`
    }
  ];

  checks.forEach(check => {
    if (check.cond) reasons.push(check.msg);
  });

  return { hasDataChange: reasons.length > 0, reasons };
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
 * @private
 * @param {Object} context - Storage change context
 */
function _logStorageChangeEvent(context) {
  // Issue #8: Determine what changed (added/removed tab IDs)
  const oldIds = new Set((context.oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((context.newValue?.tabs || []).map(t => t.id));
  const addedIds = [...newIds].filter(id => !oldIds.has(id));
  const removedIds = [...oldIds].filter(id => !newIds.has(id));

  // Issue #8: Unified format for storage event logging
  console.log(
    `[Manager] STORAGE_CHANGED: tabs ${context.oldTabCount}→${context.newTabCount} (delta: ${context.newTabCount - context.oldTabCount}), saveId: '${context.newValue?.saveId || 'none'}', source: tab-${context.sourceTabId || 'unknown'}`,
    {
      changes: {
        added: addedIds,
        removed: removedIds
      },
      oldTabCount: context.oldTabCount,
      newTabCount: context.newTabCount,
      delta: context.newTabCount - context.oldTabCount,
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
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
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

  // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
  if (typeof browser.storage.session !== 'undefined') {
    await browser.storage.session.set({ [STATE_KEY]: restoredState });
  }
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
/**
 * Log successful close minimized command
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce closeMinimizedTabs complexity
 * @private
 * @param {Object} response - Response from background script
 */
function _logCloseMinimizedSuccess(response) {
  console.log('[Manager] ✅ CLOSE_MINIMIZED_COMMAND_SUCCESS:', {
    closedCount: response?.closedCount || 0,
    closedIds: response?.closedIds || [],
    timedOut: response?.timedOut || false
  });
}

/**
 * Log failed close minimized command
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce closeMinimizedTabs complexity
 * @private
 * @param {Object} response - Response from background script
 */
function _logCloseMinimizedFailure(response) {
  console.error('[Manager] ❌ CLOSE_MINIMIZED_COMMAND_FAILED:', {
    error: response?.error || 'Unknown error'
  });
}

/**
 * Check if close minimized response indicates success
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce closeMinimizedTabs complexity
 * @private
 * @param {Object} response - Response from background script
 * @returns {boolean} True if operation succeeded
 */
function _isCloseMinimizedSuccessful(response) {
  return response?.success || response?.timedOut;
}

async function closeMinimizedTabs() {
  console.log('[Manager] Close Minimized Tabs requested');

  try {
    // v1.6.4.0 - FIX Issue A: Send command to background instead of direct storage write
    const response = await _sendActionRequest('CLOSE_MINIMIZED_TABS', {
      timestamp: Date.now()
    });

    if (_isCloseMinimizedSuccessful(response)) {
      _logCloseMinimizedSuccess(response);
      // Re-render UI to reflect the change
      scheduleRender('close-minimized-success');
    } else {
      _logCloseMinimizedFailure(response);
    }
  } catch (err) {
    console.error('[Manager] Error sending close minimized command:', err);
  }
}

/**
 * Load state from storage
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 */
async function _loadStorageState() {
  // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
  if (typeof browser.storage.session === 'undefined') {
    return null;
  }
  const result = await browser.storage.session.get(STATE_KEY);
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
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 */
async function _updateStorageAfterClose(state) {
  const hasChanges = filterMinimizedFromState(state);

  if (hasChanges) {
    // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
    if (typeof browser.storage.session !== 'undefined') {
      await browser.storage.session.set({ [STATE_KEY]: state });
    }
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

    const hostInfoBeforeClear = quickTabHostInfo.size;
    quickTabHostInfo.clear();

    _logPostActionCleanup(preActionState.clearedIds, hostInfoBeforeClear, startTime);
    _resetLocalState();

    console.log('[Manager] Close All: UI updated, operation complete');
  } catch (err) {
    _logCloseAllError(err, startTime);
  }
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

// ==================== v1.6.4.16 OPERATION HELPERS ====================
// FIX Code Health: Extracted helpers to reduce minimizeQuickTab/closeQuickTab line count

/**
 * Check if operation should be queued due to circuit breaker
 * v1.6.4.16 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} action - Action name
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} correlationId - Correlation ID for logging
 * @returns {boolean} True if operation was queued
 */
function _shouldQueueForCircuitBreaker(action, quickTabId, correlationId) {
  if (circuitBreakerState !== 'open') return false;
  const queued = _queuePendingAction(action, { quickTabId });
  if (queued) {
    console.log('[Manager] OPERATION_QUEUED: Circuit breaker open:', {
      action,
      quickTabId,
      correlationId,
      reason: 'circuit-breaker-open'
    });
    _showErrorNotification('Connection temporarily unavailable. Action queued.');
  }
  return queued;
}

/**
 * Check port viability and queue if not viable
 * v1.6.4.16 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} action - Action name
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise<boolean>} True if port is viable, false if operation was deferred
 */
async function _checkPortViabilityOrQueue(action, quickTabId, correlationId) {
  const portViable = await verifyPortViability();
  if (portViable) return true;
  console.warn('[Manager] OPERATION_DEFERRED: Port not viable:', {
    action,
    quickTabId,
    correlationId,
    reason: 'port-not-viable'
  });
  _queuePendingAction(action, { quickTabId });
  _showErrorNotification('Connection lost. Action queued for retry.');
  return false;
}

/**
 * Resolve target tab ID from host info or origin tab ID
 * v1.6.4.16 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} action - Action name for logging
 * @param {string} correlationId - Correlation ID for logging
 * @returns {{ targetTabId: number|null, originTabId: number|null }}
 */
function _resolveTargetTab(quickTabId, action, correlationId) {
  const tabData = findTabInState(quickTabId, quickTabsState);
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const originTabId = tabData?.originTabId;
  const targetTabId = hostInfo?.hostTabId || originTabId;
  console.log('[Manager] OPERATION_TARGET_RESOLVED:', {
    action,
    quickTabId,
    correlationId,
    targetTabId,
    originTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    source: hostInfo?.hostTabId ? 'hostInfo' : 'originTabId'
  });
  return { targetTabId, originTabId };
}

/**
 * Log operation completion or failure
 * v1.6.4.16 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} action - Action name
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} correlationId - Correlation ID
 * @param {Object} result - Operation result
 * @param {number} durationMs - Operation duration
 * @param {number|null} targetTabId - Target tab ID
 */
/**
 * Log operation result (success or failure)
 * v1.6.3.10-v8 - FIX Code Health: Use options object instead of 6 parameters
 * @private
 * @param {Object} opts - Logging options
 */
function _logOperationResult({
  action,
  quickTabId,
  correlationId,
  result,
  durationMs,
  targetTabId
}) {
  const baseData = { action, quickTabId, correlationId, durationMs, attempts: result.attempts };
  if (result.success) {
    console.log('[Manager] OPERATION_COMPLETED:', {
      ...baseData,
      status: 'success',
      method: result.method,
      targetTabId: result.targetTabId
    });
  } else {
    console.error('[Manager] OPERATION_FAILED:', {
      ...baseData,
      status: 'failed',
      error: result.error,
      targetTabId
    });
  }
}

// ==================== END v1.6.4.16 OPERATION HELPERS ====================

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
 * v1.6.3.10-v2 - FIX Issue #4: Queue action if circuit breaker is open
 * v1.6.4.15 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * v1.6.4.16 - FIX Code Health: Refactored to reduce line count (107 -> ~55)
 */
async function minimizeQuickTab(quickTabId) {
  const correlationId = generateOperationCorrelationId('min', quickTabId);
  const startTime = Date.now();

  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'MINIMIZE_QUICK_TAB',
    quickTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `minimize-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log('[Manager] OPERATION_REJECTED: Duplicate operation pending:', {
      action: 'MINIMIZE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'duplicate-pending'
    });
    return;
  }
  PENDING_OPERATIONS.add(operationKey);
  setTimeout(() => PENDING_OPERATIONS.delete(operationKey), OPERATION_TIMEOUT_MS);

  // v1.6.3.10-v2 - FIX Issue #4: Queue if circuit breaker open
  if (_shouldQueueForCircuitBreaker('MINIMIZE_QUICK_TAB', quickTabId, correlationId)) {
    PENDING_OPERATIONS.delete(operationKey);
    return;
  }

  // v1.6.3.10-v1 - FIX Issue #2: Verify port viability
  if (!(await _checkPortViabilityOrQueue('MINIMIZE_QUICK_TAB', quickTabId, correlationId))) {
    PENDING_OPERATIONS.delete(operationKey);
    return;
  }

  // Resolve target tab
  const { targetTabId, originTabId } = _resolveTargetTab(
    quickTabId,
    'MINIMIZE_QUICK_TAB',
    correlationId
  );

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging
  console.log('[Manager][Operation] VALIDATION: Checking cross-tab operation', {
    operation: 'MINIMIZE',
    quickTabId,
    quickTabOriginTabId: originTabId,
    requestingTabId: currentBrowserTabId,
    targetTabId,
    decision: 'ALLOW'
  });

  // Send message with retry
  const result = await _sendMessageWithRetry(
    { action: 'MINIMIZE_QUICK_TAB', quickTabId, correlationId },
    targetTabId,
    'minimize'
  );

  const durationMs = Date.now() - startTime;
  _logOperationResult({
    action: 'MINIMIZE_QUICK_TAB',
    quickTabId,
    correlationId,
    result,
    durationMs,
    targetTabId
  });

  if (!result.success) {
    _showErrorNotification(`Failed to minimize Quick Tab: ${result.error}`);
  }
}

// ==================== v1.6.3.10-v1 MESSAGE RETRY LOGIC ====================
// FIX Issue #7: Retry logic for minimize/restore/close operations

/**
 * Attempt targeted message with retry
 * v1.6.3.10-v1 - FIX Issue #7: Extracted to reduce nesting depth
 * @private
 * @param {Object} message - Message to send
 * @param {number} targetTabId - Target tab ID
 * @param {string} operation - Operation name for logging
 * @returns {Promise<{ success: boolean, attempts: number, targetTabId?: number }|null>}
 */
async function _attemptTargetedMessageWithRetry(message, targetTabId, operation) {
  for (let retry = 0; retry <= MESSAGE_RETRY_COUNT; retry++) {
    const result = await _trySingleTargetedMessage(message, targetTabId, operation, retry);
    if (result.success) {
      return result;
    }
    // Wait before next retry (unless last attempt)
    if (retry < MESSAGE_RETRY_COUNT) {
      await _delay(MESSAGE_RETRY_BACKOFF_MS);
    }
  }
  return null; // All retries failed
}

/**
 * Try a single targeted message
 * v1.6.3.10-v1 - FIX Issue #7: Extracted to reduce nesting
 * @private
 */
async function _trySingleTargetedMessage(message, targetTabId, operation, retry) {
  const attempts = retry + 1;
  console.log(`[Manager] MESSAGE_RETRY: ${operation} attempt ${attempts}`, {
    quickTabId: message.quickTabId,
    targetTabId,
    retry
  });

  try {
    const response = await _sendMessageWithTimeout(targetTabId, message, PORT_MESSAGE_TIMEOUT_MS);
    if (response?.success) {
      logPortLifecycle('MESSAGE_ACK_RECEIVED', {
        operation,
        quickTabId: message.quickTabId,
        targetTabId,
        attempts,
        method: 'targeted'
      });
      return { success: true, attempts, targetTabId };
    }
    return { success: false, attempts };
  } catch (err) {
    console.warn(`[Manager] MESSAGE_RETRY: ${operation} attempt ${attempts} failed`, {
      quickTabId: message.quickTabId,
      targetTabId,
      error: err.message,
      willRetry: retry < MESSAGE_RETRY_COUNT
    });
    return { success: false, attempts };
  }
}

/**
 * Send message with retry logic and broadcast fallback
 * v1.6.3.10-v1 - FIX Issue #7: Retry 2x before broadcast fallback
 * v1.6.3.10-v7 - FIX Bug #3: Message deduplication to prevent re-sends
 * @private
 * @param {Object} message - Message to send (action, quickTabId)
 * @param {number|null} targetTabId - Target tab ID (null for broadcast-only)
 * @param {string} operation - Operation name for logging (minimize/restore/close)
 * @returns {Promise<{ success: boolean, method: string, targetTabId?: number, attempts: number, error?: string }>}
 */
async function _sendMessageWithRetry(message, targetTabId, operation) {
  let attempts = 0;

  // v1.6.3.10-v7 - FIX Bug #3: Check for duplicate message
  if (_isDuplicateMessage(message.action, message.quickTabId)) {
    console.log('[Manager] MESSAGE_DEDUP_SKIPPED:', {
      action: message.action,
      quickTabId: message.quickTabId,
      operation
    });
    return {
      success: true, // Treat as success since message was already sent
      method: 'dedup',
      attempts: 0,
      error: 'Duplicate message skipped'
    };
  }

  // v1.6.3.11-v11 - FIX Issue 48 #5: Log message send
  console.log(
    `[Manager] MESSAGE_SENDING: action=${message.action}, quickTabId=${message.quickTabId}, targetTabId=${targetTabId ?? 'broadcast'}`,
    {
      action: message.action,
      quickTabId: message.quickTabId,
      targetTabId: targetTabId ?? 'broadcast',
      correlationId: message.correlationId,
      timestamp: new Date().toISOString()
    }
  );

  // v1.6.3.10-v7 - FIX Bug #3: Mark message as sent before attempting
  _markMessageSent(message.action, message.quickTabId);

  // v1.6.3.10-v1 - FIX Issue #7: Try targeted message first (if target known)
  if (targetTabId) {
    const targetedResult = await _attemptTargetedMessageWithRetry(message, targetTabId, operation);
    if (targetedResult?.success) {
      // v1.6.3.11-v11 - FIX Issue 48 #5: Log message response
      console.log(`[Manager] MESSAGE_RESPONSE: action=${message.action}, success=true`, {
        action: message.action,
        quickTabId: message.quickTabId,
        targetTabId: targetedResult.targetTabId,
        method: 'targeted',
        attempts: targetedResult.attempts
      });
      return {
        success: true,
        method: 'targeted',
        targetTabId: targetedResult.targetTabId,
        attempts: targetedResult.attempts
      };
    }
    attempts = MESSAGE_RETRY_COUNT + 1; // Count all targeted attempts
  }

  // v1.6.3.10-v1 - FIX Issue #7: Fall back to broadcast
  const broadcastResult = await _sendMessageViaBroadcast(message, operation, attempts);

  // v1.6.3.11-v11 - FIX Issue 48 #5: Log broadcast response
  console.log(
    `[Manager] MESSAGE_RESPONSE: action=${message.action}, success=${broadcastResult.success}`,
    {
      action: message.action,
      quickTabId: message.quickTabId,
      method: broadcastResult.method,
      success: broadcastResult.success,
      attempts: broadcastResult.attempts,
      error: broadcastResult.error ?? null
    }
  );

  return broadcastResult;
}

/**
 * Send message via broadcast fallback
 * v1.6.3.10-v1 - FIX Issue #7: Extracted to reduce function length
 * @private
 */
async function _sendMessageViaBroadcast(message, operation, previousAttempts) {
  console.log(`[Manager] MESSAGE_RETRY: ${operation} falling back to broadcast`, {
    quickTabId: message.quickTabId,
    previousAttempts,
    reason: previousAttempts > 0 ? 'targeted messages failed' : 'no target tab'
  });

  try {
    const broadcastResult = await sendMessageToAllTabs(message.action, message.quickTabId);
    const totalAttempts = previousAttempts + 1;

    if (broadcastResult.success > 0) {
      logPortLifecycle('MESSAGE_ACK_RECEIVED', {
        operation,
        quickTabId: message.quickTabId,
        attempts: totalAttempts,
        method: 'broadcast',
        successCount: broadcastResult.success
      });
      return { success: true, method: 'broadcast', attempts: totalAttempts };
    }

    return {
      success: false,
      method: 'broadcast',
      attempts: totalAttempts,
      error: 'No tabs responded'
    };
  } catch (err) {
    return {
      success: false,
      method: 'broadcast',
      attempts: previousAttempts + 1,
      error: err.message
    };
  }
}

/**
 * Send message to specific tab with timeout
 * v1.6.3.10-v1 - FIX Issue #7: Wrapped tabs.sendMessage with timeout
 * @private
 * @param {number} tabId - Target tab ID
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from content script
 */
function _sendMessageWithTimeout(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Message timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    browser.tabs
      .sendMessage(tabId, message)
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
 * Async delay helper
 * v1.6.3.10-v1 - FIX Issue #7: Use instead of setTimeout for race conditions
 * @private
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== END MESSAGE RETRY LOGIC ====================

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
 * v1.6.4.13 - FIX BUG #4: Prioritize originTabId from storage over quickTabHostInfo
 *
 * After adoption, storage contains the correct originTabId but quickTabHostInfo
 * may still have the old host tab ID. We should prioritize storage (tabData.originTabId)
 * as the source of truth.
 *
 * @private
 */
function _resolveRestoreTarget(quickTabId, tabData) {
  const hostInfo = quickTabHostInfo.get(quickTabId);

  // v1.6.4.13 - FIX BUG #4: Prioritize storage originTabId over quickTabHostInfo
  // After adoption, storage has the correct originTabId but hostInfo may be stale
  if (tabData.originTabId) {
    return tabData.originTabId;
  }

  // Fall back to hostInfo if no originTabId in storage
  return hostInfo?.hostTabId || null;
}

/**
 * Log restore target resolution details
 * v1.6.4.13 - FIX BUG #4: Enhanced logging to show source of truth
 * v1.6.4.13 - Use shared determineRestoreSource utility to reduce code duplication
 * @private
 */
function _logRestoreTargetResolution(quickTabId, tabData, targetTabId) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  // v1.6.4.13 - Use shared utility for source determination
  const source = determineRestoreSource(tabData, hostInfo);

  console.log('[Manager] 🎯 RESTORE_TARGET_RESOLUTION:', {
    quickTabId,
    targetTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    originTabId: tabData.originTabId,
    source,
    // v1.6.4.13 - Show if hostInfo was overridden by storage originTabId
    hostInfoOverridden:
      hostInfo?.hostTabId && tabData.originTabId && hostInfo.hostTabId !== tabData.originTabId
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
 * Check restore preconditions and return early if not met
 * v1.6.4.15 - FIX Issue #20: Extracted to reduce complexity
 * @private
 * @returns {Object|null} { validation, operationKey } if preconditions met, null otherwise
 */
function _checkRestorePreconditions(quickTabId, correlationId) {
  const operationKey = `restore-${quickTabId}`;
  if (isOperationPending(operationKey)) {
    console.log('[Manager] OPERATION_REJECTED: Duplicate operation pending:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'duplicate-pending'
    });
    return null;
  }

  const validation = validateRestoreTabData(quickTabId, quickTabsState);
  if (!validation.valid) {
    console.log('[Manager] OPERATION_REJECTED: Validation failed:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'validation-failed',
      error: validation.error
    });
    _showErrorNotification(validation.error);
    return null;
  }

  return { validation, operationKey };
}

/**
 * Check connectivity prerequisites for restore
 * v1.6.4.15 - FIX Issue #20: Extracted to reduce complexity
 * @private
 * @returns {Promise<boolean>} true if connectivity is available
 */
async function _checkRestoreConnectivity(quickTabId, correlationId) {
  // v1.6.3.10-v2 - FIX Issue #4: Queue action if circuit breaker is open
  if (circuitBreakerState === 'open') {
    const queued = _queuePendingAction('RESTORE_QUICK_TAB', { quickTabId });
    if (queued) {
      console.log('[Manager] OPERATION_QUEUED: Circuit breaker open:', {
        action: 'RESTORE_QUICK_TAB',
        quickTabId,
        correlationId,
        reason: 'circuit-breaker-open'
      });
      _showErrorNotification('Connection temporarily unavailable. Action queued.');
      return false;
    }
  }

  // v1.6.3.10-v1 - FIX Issue #2: Verify port viability before critical operation
  const portViable = await verifyPortViability();
  if (!portViable) {
    console.warn('[Manager] OPERATION_DEFERRED: Port not viable:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'port-not-viable'
    });
    _queuePendingAction('RESTORE_QUICK_TAB', { quickTabId });
    _showErrorNotification('Connection lost. Action queued for retry.');
    return false;
  }

  return true;
}

/**
 * Handle restore operation result
 * v1.6.4.15 - FIX Issue #20: Extracted to reduce complexity
 * @private
 */
function _handleRestoreOperationResult(quickTabId, result, correlationId, durationMs) {
  if (result.success) {
    console.log('[Manager] OPERATION_COMPLETED: Manager action completed:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      status: 'success',
      method: result.method,
      targetTabId: result.targetTabId,
      attempts: result.attempts,
      durationMs
    });

    // v1.6.3.10-v1 - Update host info after successful restore
    if (result.targetTabId) {
      quickTabHostInfo.set(quickTabId, {
        hostTabId: result.targetTabId,
        lastUpdate: Date.now(),
        lastOperation: 'restore',
        confirmed: true
      });
    }
  } else {
    console.error('[Manager] OPERATION_FAILED: Manager action failed:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      status: 'failed',
      error: result.error,
      attempts: result.attempts,
      durationMs
    });
    _showErrorNotification(`Failed to restore Quick Tab: ${result.error}`);
  }
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
 * v1.6.4.15 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 */
async function restoreQuickTab(quickTabId) {
  const correlationId = generateOperationCorrelationId('restore', quickTabId);
  const startTime = Date.now();

  // v1.6.4.15 - FIX Issue #20: Log operation start
  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'RESTORE_QUICK_TAB',
    quickTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  _logRestoreRequest(quickTabId, startTime, correlationId);

  // Check preconditions
  const preconditions = _checkRestorePreconditions(quickTabId, correlationId);
  if (!preconditions) return;

  const { validation, operationKey } = preconditions;

  // Check connectivity
  const connectivityOk = await _checkRestoreConnectivity(quickTabId, correlationId);
  if (!connectivityOk) return;

  console.log('[Manager] Restore validated - tab is minimized:', quickTabId);
  setupPendingOperation(operationKey);

  // Resolve target
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const targetTabId = hostInfo?.hostTabId || validation.tabData.originTabId;

  // v1.6.4.15 - FIX Issue #20: Log target resolution
  console.log('[Manager] OPERATION_TARGET_RESOLVED:', {
    action: 'RESTORE_QUICK_TAB',
    quickTabId,
    correlationId,
    targetTabId,
    originTabId: validation.tabData.originTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    source: hostInfo?.hostTabId ? 'hostInfo' : 'originTabId'
  });

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for cross-tab operation VALIDATION
  console.log('[Manager][Operation] VALIDATION: Checking cross-tab operation', {
    operation: 'RESTORE',
    quickTabId: quickTabId,
    quickTabOriginTabId: validation.tabData.originTabId,
    requestingTabId: currentBrowserTabId,
    targetTabId: targetTabId,
    decision: 'ALLOW'
  });

  const result = await _sendMessageWithRetry(
    {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId
    },
    targetTabId,
    'restore'
  );

  const durationMs = Date.now() - startTime;

  _logRestoreResult(
    quickTabId,
    { success: result.success, confirmedBy: result.targetTabId },
    startTime,
    correlationId
  );

  _handleRestoreOperationResult(quickTabId, result, correlationId, durationMs);

  _scheduleRestoreVerification(quickTabId);
}

/**
 * Log restore request with context
 * v1.6.4.15 - FIX Issue #20: Added correlationId parameter
 * @private
 */
function _logRestoreRequest(quickTabId, timestamp, correlationId = null) {
  console.log('[Manager] 🔄 RESTORE_REQUEST:', {
    quickTabId,
    timestamp,
    correlationId,
    quickTabsStateTabCount: quickTabsState?.tabs?.length ?? 0,
    currentBrowserTabId
  });
}

/**
 * Log restore result
 * v1.6.4.15 - FIX Issue #20: Added correlationId parameter
 * @private
 */
function _logRestoreResult(quickTabId, confirmationResult, startTime, correlationId = null) {
  console.log('[Manager] 🔄 RESTORE_RESULT:', {
    quickTabId,
    correlationId,
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
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 */
async function _getQuickTabFromStorage(quickTabId) {
  // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
  if (typeof browser.storage.session === 'undefined') {
    return null;
  }
  const stateResult = await browser.storage.session.get(STATE_KEY);
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
 * v1.6.3.10-v2 - FIX Issue #4: Queue action if circuit breaker is open
 * v1.6.4.15 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * v1.6.4.16 - FIX Code Health: Refactored to reduce line count (91 -> ~40)
 */
async function closeQuickTab(quickTabId) {
  const correlationId = generateOperationCorrelationId('close', quickTabId);
  const startTime = Date.now();

  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'CLOSE_QUICK_TAB',
    quickTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  // v1.6.3.10-v2 - FIX Issue #4: Queue if circuit breaker open
  if (_shouldQueueForCircuitBreaker('CLOSE_QUICK_TAB', quickTabId, correlationId)) {
    return;
  }

  // v1.6.3.10-v1 - FIX Issue #2: Verify port viability
  if (!(await _checkPortViabilityOrQueue('CLOSE_QUICK_TAB', quickTabId, correlationId))) {
    return;
  }

  // Resolve target tab
  const { targetTabId, originTabId } = _resolveTargetTab(
    quickTabId,
    'CLOSE_QUICK_TAB',
    correlationId
  );

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging
  console.log('[Manager][Operation] VALIDATION: Checking cross-tab operation', {
    operation: 'CLOSE',
    quickTabId,
    quickTabOriginTabId: originTabId,
    requestingTabId: currentBrowserTabId,
    targetTabId,
    decision: 'ALLOW'
  });

  // Send message with retry
  const result = await _sendMessageWithRetry(
    { action: 'CLOSE_QUICK_TAB', quickTabId, correlationId },
    targetTabId,
    'close'
  );

  const durationMs = Date.now() - startTime;
  _logOperationResult({
    action: 'CLOSE_QUICK_TAB',
    quickTabId,
    correlationId,
    result,
    durationMs,
    targetTabId
  });

  if (result.success) {
    quickTabHostInfo.delete(quickTabId);
  } else {
    _showErrorNotification(`Failed to close Quick Tab: ${result.error}`);
  }
}

/**
 * Adopt an orphaned Quick Tab to the current browser tab
 * v1.6.3.7-v1 - FIX ISSUE #8: Allow users to "rescue" orphaned Quick Tabs
 * v1.6.4.0 - FIX Issue A: Send ADOPT_TAB command to background instead of direct storage write
 *   - Manager sends command, background is sole writer
 *   - Background updates state, writes to storage, sends confirmation
 * v1.6.4.15 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * @param {string} quickTabId - The Quick Tab ID to adopt
 * @param {number} targetTabId - The browser tab ID to adopt to
 */
async function adoptQuickTabToCurrentTab(quickTabId, targetTabId) {
  const correlationId = generateOperationCorrelationId('adopt', quickTabId);
  const startTime = Date.now();

  // v1.6.4.15 - FIX Issue #20: Log operation start
  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  _logAdoptRequest(quickTabId, targetTabId, correlationId);

  // Validate targetTabId
  if (!_isValidTargetTabId(targetTabId)) {
    console.error('[Manager] OPERATION_REJECTED: Invalid targetTabId:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      reason: 'invalid-target-tab-id'
    });
    return;
  }

  try {
    // v1.6.4.0 - FIX Issue A: Send command to background instead of direct storage write
    console.log('[Manager] Sending ADOPT_QUICK_TAB command to background:', {
      quickTabId,
      targetTabId,
      correlationId
    });

    const response = await _sendActionRequest('ADOPT_TAB', {
      quickTabId,
      targetTabId,
      correlationId
    });

    _handleAdoptResponse({ quickTabId, targetTabId, response, correlationId, startTime });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error('[Manager] OPERATION_FAILED:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      status: 'failed',
      error: err.message,
      durationMs
    });
  }
}

/**
 * Handle adoption command response
 * v1.6.4.0 - FIX Issue A: Extracted to reduce nesting depth
 * v1.6.4.15 - FIX Issue #20: Added correlationId and timing parameters
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} targetTabId - Target browser tab ID
 * @param {Object} response - Response from background
 * @param {string} correlationId - Correlation ID for tracing
 * @param {number} startTime - Operation start timestamp
 */
/**
 * Handle successful adoption response
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _handleAdoptSuccess({ quickTabId, targetTabId, response, correlationId, durationMs }) {
  console.log('[Manager] OPERATION_COMPLETED:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    status: 'success',
    oldOriginTabId: response?.oldOriginTabId,
    newOriginTabId: targetTabId,
    timedOut: response?.timedOut || false,
    durationMs
  });
  console.log('[Manager] ✅ ADOPT_COMMAND_SUCCESS:', {
    quickTabId,
    targetTabId,
    timedOut: response?.timedOut || false
  });

  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'adopt',
    confirmed: true
  });
  if (response?.oldOriginTabId) browserTabInfoCache.delete(response.oldOriginTabId);
  scheduleRender('adopt-success');
}

/**
 * Handle failed adoption response
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _handleAdoptFailure({ quickTabId, targetTabId, response, correlationId, durationMs }) {
  const error = response?.error || 'Unknown error';
  console.error('[Manager] OPERATION_FAILED:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    status: 'failed',
    error,
    durationMs
  });
  console.error('[Manager] ❌ ADOPT_COMMAND_FAILED:', { quickTabId, targetTabId, error });
}

/**
 * Handle adoption response
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _handleAdoptResponse({
  quickTabId,
  targetTabId,
  response,
  correlationId = null,
  startTime = null
}) {
  const durationMs = startTime ? Date.now() - startTime : null;
  const opts = { quickTabId, targetTabId, response, correlationId, durationMs };
  if (response?.success || response?.timedOut) {
    _handleAdoptSuccess(opts);
  } else {
    _handleAdoptFailure(opts);
  }
}

/**
 * Log adopt request
 * v1.6.3.7 - FIX Issue #7: Enhanced adoption data flow logging
 * v1.6.4.0 - FIX Issue C: Added ADOPTION_INITIATED log as specified in acceptance criteria
 * v1.6.4.15 - FIX Issue #20: Added correlationId parameter
 * @private
 */
function _logAdoptRequest(quickTabId, targetTabId, correlationId = null) {
  // v1.6.4.0 - FIX Issue C: Log ADOPTION_INITIATED as specified in issue requirements
  console.log('[Manager] ADOPTION_INITIATED:', {
    quickTabId,
    targetTabId,
    correlationId,
    message: `${quickTabId} → tab-${targetTabId}`,
    timestamp: Date.now()
  });

  // v1.6.3.7 - FIX Issue #7: Use standardized format for adoption flow tracking
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    correlationId,
    action: 'adopt_button_clicked',
    result: 'pending',
    currentBrowserTabId,
    timestamp: Date.now()
  });

  console.log('[Manager] 📥 ADOPT_TO_CURRENT_TAB:', {
    quickTabId,
    targetTabId,
    correlationId,
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

  const stateResult = await _readStorageForAdoption(quickTabId, targetTabId);
  if (!stateResult.success) return null;

  const { state, quickTab, tabIndex: _tabIndex, oldOriginTabId } = stateResult;

  quickTab.originTabId = targetTabId;
  _logAdoptionUpdate(quickTabId, oldOriginTabId, targetTabId);

  return _persistAdoption({ quickTabId, targetTabId, state, oldOriginTabId, writeStartTime });
}

/**
 * Read storage state for adoption
 * v1.6.3.7 - FIX Issue #7: Helper for adoption with logging
 * v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
 * @private
 */
async function _readStorageForAdoption(quickTabId, targetTabId) {
  // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
  if (typeof browser.storage.session === 'undefined') {
    console.warn('[Manager] storage.session unavailable for adoption');
    return { success: false };
  }
  const result = await browser.storage.session.get(STATE_KEY);
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
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
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

  console.log('[Manager] ADOPT_STORAGE_WRITE:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId,
    tabCount: state.tabs.length
  });
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'before_persist',
    saveId
  });

  // v1.6.4.18 - FIX: Use storage.session for Quick Tabs (session-only)
  if (typeof browser.storage.session !== 'undefined') {
    await browser.storage.session.set({ [STATE_KEY]: stateToWrite });
  }
  const writeEndTime = Date.now();

  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'after_persist',
    saveId,
    durationMs: writeEndTime - writeStartTime
  });
  console.log('[Manager] ✅ ADOPT_COMPLETED:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId
  });

  _verifyAdoptionInStorage(quickTabId, saveId, writeTimestamp);
  return { oldOriginTabId, saveId, writeTimestamp };
}

/**
 * Issue #9: Verify adoption was persisted by monitoring storage.onChanged
 * Logs time delta between write and confirmation, warns if no confirmation within 2 seconds
 * v1.6.4.18 - FIX: Listen for 'session' area changes for Quick Tabs state
 * @private
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {string} expectedSaveId - SaveId to look for in storage change
 * @param {number} writeTimestamp - Timestamp when write occurred
 */
function _verifyAdoptionInStorage(quickTabId, expectedSaveId, writeTimestamp) {
  let confirmed = false;
  const CONFIRMATION_TIMEOUT_MS = 2000;

  // Issue #9: Temporary listener for this specific saveId
  // v1.6.4.18 - FIX: Listen for 'session' area changes for Quick Tabs state
  const verificationListener = (changes, areaName) => {
    if (areaName !== 'session' || !changes[STATE_KEY]) return;

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
