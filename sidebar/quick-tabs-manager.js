/**
 * Quick Tabs Manager Sidebar Script
 * Manages display and interaction with Quick Tabs across all containers
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
// v1.6.3.7-v3 - API #2: BroadcastChannel for instant updates
import {
  initBroadcastChannel,
  addBroadcastListener,
  removeBroadcastListener,
  closeBroadcastChannel,
  isChannelAvailable as _isChannelAvailable
} from '../src/features/quick-tabs/channels/BroadcastChannelManager.js';

// ==================== CONSTANTS ====================
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';
const BROWSER_TAB_CACHE_TTL_MS = 30000;
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';
const OPERATION_TIMEOUT_MS = 2000;
const DOM_VERIFICATION_DELAY_MS = 500;

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
  console.log('[Manager] v1.6.3.7-v4 Session initialized:', { sessionId: currentSessionId });
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

/**
 * Heartbeat interval (25 seconds - Firefox idle timeout is 30s)
 * v1.6.3.6-v12 - FIX Issue #2, #4: Keep background alive
 */
const HEARTBEAT_INTERVAL_MS = 25000;

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
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 * v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat on connect
 * v1.6.3.7 - FIX Issue #5: Implement circuit breaker with exponential backoff
 */
function connectToBackground() {
  // v1.6.3.7 - FIX Issue #5: Check circuit breaker state
  if (circuitBreakerState === 'open') {
    const timeSinceOpen = Date.now() - circuitBreakerOpenTime;
    if (timeSinceOpen < CIRCUIT_BREAKER_OPEN_DURATION_MS) {
      console.log('[Manager] Circuit breaker OPEN - skipping reconnect', {
        timeRemainingMs: CIRCUIT_BREAKER_OPEN_DURATION_MS - timeSinceOpen
      });
      return;
    }
    // Transition to half-open state
    circuitBreakerState = 'half-open';
    console.log('[Manager] Circuit breaker HALF-OPEN - attempting reconnect');
  }

  try {
    backgroundPort = browser.runtime.connect({
      name: 'quicktabs-sidebar'
    });

    logPortLifecycle('open', { portName: backgroundPort.name });

    // Handle messages from background
    // v1.6.3.7-v4 - FIX Issue #10: Log listener registration
    backgroundPort.onMessage.addListener(handlePortMessage);
    console.log('[Manager] LISTENER_REGISTERED: Port onMessage listener added');

    // Handle disconnect
    // v1.6.3.7-v4 - FIX Issue #10: Log disconnect listener registration
    backgroundPort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      logPortLifecycle('disconnect', { error: error?.message });
      backgroundPort = null;

      // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat on disconnect
      stopHeartbeat();

      // v1.6.3.7-v4 - FIX Issue #8: Stop circuit breaker probes on disconnect
      _stopCircuitBreakerProbes();

      // v1.6.3.7 - FIX Issue #5: Implement exponential backoff reconnection
      scheduleReconnect();
    });
    console.log('[Manager] LISTENER_REGISTERED: Port onDisconnect listener added');

    // v1.6.3.7 - FIX Issue #5: Reset circuit breaker on successful connect
    circuitBreakerState = 'closed';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

    // v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat mechanism
    startHeartbeat();

    // v1.6.4.0 - FIX Issue E: Request full state sync after reconnection
    // This ensures Manager has latest state after any disconnection
    _requestFullStateSync();

    // v1.6.3.7-v4 - FIX Issue #10: Send test message to verify listener works
    _verifyPortListenerRegistration();

    console.log('[Manager] v1.6.3.6-v11 Port connection established');
  } catch (err) {
    console.error('[Manager] Failed to connect to background:', err.message);
    logPortLifecycle('error', { error: err.message });

    // v1.6.3.7 - FIX Issue #5: Handle connection failure
    handleConnectionFailure();
  }
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
    console.error('[Manager] LISTENER_VERIFICATION_FAILED: Could not send test message:', err.message);
  }
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
    _probeBackgroundHealth().then(healthy => {
      if (healthy && circuitBreakerState === 'open') {
        console.log('[Manager] CIRCUIT_BREAKER_EARLY_RECOVERY: Background responding - transitioning to HALF-OPEN');
        _stopCircuitBreakerProbes();
        circuitBreakerState = 'half-open';
        reconnectAttempts = 0;
        reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
        connectToBackground();
      }
    }).catch(() => {
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

// ==================== v1.6.3.6-v12 HEARTBEAT FUNCTIONS ====================

/**
 * Start heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #2, #4: Keep background alive
 */
function startHeartbeat() {
  // Clear any existing interval
  stopHeartbeat();

  // Send initial heartbeat immediately
  sendHeartbeat();

  // Start interval
  heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  console.log(
    '[Manager] v1.6.3.6-v12 Heartbeat started (every',
    HEARTBEAT_INTERVAL_MS / 1000,
    's)'
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
    console.log('[Manager] v1.6.3.6-v12 Heartbeat stopped');
  }
}

/**
 * Send heartbeat message to background
 * v1.6.3.6-v12 - FIX Issue #2, #4: Heartbeat with timeout detection
 * v1.6.3.7 - FIX Issue #2: Enhanced logging for port state transitions
 * v1.6.3.7-v4 - FIX Issue #1: Enhanced logging to distinguish port vs background state
 *
 * Three-tier communication architecture:
 * 1. BroadcastChannel (PRIMARY) - Instant cross-tab messaging
 * 2. Port messaging (SECONDARY) - Persistent connection to background
 * 3. storage.onChanged (TERTIARY) - Reliable fallback
 */
async function sendHeartbeat() {
  const heartbeatStartTime = Date.now();

  // v1.6.3.7-v4 - FIX Issue #1: Log heartbeat attempt with port state
  _logHeartbeatAttempt();

  if (!backgroundPort) {
    _handlePortDisconnected();
    return;
  }

  try {
    // v1.6.3.7 - FIX Issue #2: Send heartbeat with explicit timeout
    const response = await sendPortMessageWithTimeout(
      { type: 'HEARTBEAT', timestamp: Date.now(), source: 'sidebar' },
      HEARTBEAT_TIMEOUT_MS
    );

    _handleHeartbeatSuccess(response, heartbeatStartTime);
  } catch (err) {
    _handleHeartbeatFailure(err);
  }
}

/**
 * Log heartbeat attempt details
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _logHeartbeatAttempt() {
  console.log('[Manager] HEARTBEAT_ATTEMPT:', {
    portExists: backgroundPort !== null,
    portConnected: backgroundPort ? 'yes' : 'no',
    circuitBreakerState,
    consecutiveFailures: consecutiveHeartbeatFailures,
    timeSinceLastSuccess: Date.now() - lastHeartbeatResponse
  });
}

/**
 * Handle case when port is disconnected
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handlePortDisconnected() {
  console.warn('[Manager] HEARTBEAT_FAILED: port disconnected', {
    status: 'PORT_DISCONNECTED',
    circuitBreakerState,
    reconnectAttempts,
    diagnosis: 'Port object is null - connection was closed or never established'
  });
  consecutiveHeartbeatFailures++;
  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    console.error('[Manager] v1.6.3.6-v12 Max heartbeat failures - triggering reconnect');
    scheduleReconnect();
  }
}

/**
 * Handle successful heartbeat response
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * @private
 * @param {Object} response - Response from background
 * @param {number} startTime - When heartbeat was started
 */
function _handleHeartbeatSuccess(response, startTime) {
  consecutiveHeartbeatFailures = 0;
  lastHeartbeatResponse = Date.now();

  console.log('[Manager] HEARTBEAT_SUCCESS:', {
    status: 'BACKGROUND_ALIVE',
    roundTripMs: Date.now() - startTime,
    backgroundAlive: response?.backgroundAlive ?? true,
    isInitialized: response?.isInitialized,
    circuitBreakerState,
    diagnosis: 'Background script is alive and responding'
  });
}

/**
 * Handle heartbeat failure
 * v1.6.3.7-v4 - FIX Issue #1: Extracted to reduce sendHeartbeat complexity
 * @private
 * @param {Error} err - Error that occurred
 */
function _handleHeartbeatFailure(err) {
  consecutiveHeartbeatFailures++;

  const isTimeout = err.message === 'Heartbeat timeout';
  const isPortClosed = err.message.includes('disconnected') || err.message.includes('closed');

  console.warn('[Manager] HEARTBEAT_FAILED:', {
    status: isTimeout ? 'BACKGROUND_DEAD' : isPortClosed ? 'PORT_CLOSED' : 'UNKNOWN_ERROR',
    error: err.message,
    failures: consecutiveHeartbeatFailures,
    maxFailures: MAX_HEARTBEAT_FAILURES,
    timeSinceLastSuccess: Date.now() - lastHeartbeatResponse,
    circuitBreakerState,
    diagnosis: _getHeartbeatFailureDiagnosis(isTimeout, isPortClosed)
  });

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
  if (isTimeout) return 'Port is open but background script is not responding (Firefox 30s termination?)';
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
    console.error('[Manager] v1.6.3.7 ZOMBIE_PORT_DETECTED: Port appears alive but background is dead');
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
function sendPortMessageWithTimeout(message, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!backgroundPort) {
      reject(new Error('Port not connected'));
      return;
    }

    const correlationId = generateCorrelationId();
    const messageWithCorrelation = { ...message, correlationId };

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
      sentAt: Date.now()
    });

    // Send message
    try {
      backgroundPort.postMessage(messageWithCorrelation);
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
      {
        type: 'REQUEST_FULL_STATE_SYNC',
        timestamp: Date.now(),
        source: 'sidebar',
        currentCacheHash: computeStateHash(quickTabsState),
        currentCacheTabCount: quickTabsState?.tabs?.length ?? 0
      },
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
 * v1.6.3.7-v4 - FIX Issue #4: Enhanced deduplication with message ID tracking
 * @param {string} source - Source of render trigger for logging
 * @param {string} [messageId] - Optional message ID for deduplication
 */
function scheduleRender(source = 'unknown', messageId = null) {
  const currentHash = computeStateHash(quickTabsState);

  // v1.6.3.7-v4 - FIX Issue #4: Check message ID deduplication first
  if (messageId && _isMessageAlreadyProcessed(messageId)) {
    console.log('[Manager] RENDER_DEDUPLICATION: message already processed', {
      source,
      messageId,
      hash: currentHash
    });
    return;
  }

  // v1.6.4.0 - FIX Issue B: Deduplicate renders by hash comparison
  if (currentHash === lastRenderedStateHash) {
    console.log('[Manager] RENDER_DEDUPLICATION: prevented duplicate render (hash unchanged)', {
      source,
      hash: currentHash
    });
    return;
  }

  // v1.6.3.7-v4 - FIX Issue #4: Track this message as processed
  if (messageId) {
    _markMessageAsProcessed(messageId);
  }

  console.log('[Manager] RENDER_SCHEDULED:', {
    source,
    messageId,
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
 * Map of processed message IDs with their timestamps
 * v1.6.3.7-v4 - FIX Code Review: Use Map with timestamps for efficient cleanup
 */
const processedMessageTimestamps = new Map();

/**
 * Mark a message as processed for deduplication
 * v1.6.3.7-v4 - FIX Issue #4: Message deduplication helper
 * v1.6.3.7-v4 - FIX Code Review: Use Map with timestamps for efficient memory management
 * @private
 * @param {string} messageId - Message ID to mark
 */
function _markMessageAsProcessed(messageId) {
  if (!messageId) return;
  recentlyProcessedMessageIds.add(messageId);
  processedMessageTimestamps.set(messageId, Date.now());
}

/**
 * Cleanup expired message IDs (called periodically)
 * v1.6.3.7-v4 - FIX Code Review: Efficient periodic cleanup instead of per-message timers
 * @private
 */
function _cleanupExpiredMessageIds() {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessageTimestamps) {
    if (now - timestamp > MESSAGE_ID_MAX_AGE_MS) {
      recentlyProcessedMessageIds.delete(messageId);
      processedMessageTimestamps.delete(messageId);
    }
  }
}

// Start periodic cleanup interval (every 5 seconds)
setInterval(_cleanupExpiredMessageIds, 5000);

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
  // v1.6.3.7-v4 - FIX Issue #9: Wrap in try-catch to handle corrupted messages gracefully
  try {
    // v1.6.3.7-v4 - FIX Issue #9: Validate message structure
    if (!message || typeof message !== 'object') {
      console.warn('[Manager] PORT_MESSAGE_INVALID: Received non-object message:', typeof message);
      return;
    }

    _logPortMessageReceived(message);

    // Route message to appropriate handler
    _routePortMessage(message);
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
 * @private
 * @param {Object} message - Message from background
 */
function _logPortMessageReceived(message) {
  console.log('[Manager] PORT_MESSAGE_RECEIVED:', {
    type: message.type,
    action: message.action,
    messageId: message.messageId,
    correlationId: message.correlationId,
    source: 'port-connection',
    timestamp: Date.now()
  });

  logPortLifecycle('message', {
    type: message.type,
    action: message.action,
    correlationId: message.correlationId
  });
}

/**
 * Route port message to appropriate handler
 * v1.6.3.7-v4 - FIX Issue #9: Extracted for complexity reduction
 * @private
 * @param {Object} message - Message to route
 */
function _routePortMessage(message) {
  // v1.6.3.6-v12 - FIX Issue #4: Handle heartbeat acknowledgment
  if (message.type === 'HEARTBEAT_ACK' || message.type === 'ACKNOWLEDGMENT') {
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
    handleStateUpdateBroadcast(message);
    scheduleRender('port-STATE_UPDATE', message.messageId);
    return;
  }

  // v1.6.3.7-v4 - FIX Issue #3: Handle QUICK_TAB_STATE_UPDATED via port
  if (message.type === 'QUICK_TAB_STATE_UPDATED') {
    _handleQuickTabStateUpdate(message);
    return;
  }

  // v1.6.4.0 - FIX Issue E: Handle full state sync response
  if (message.type === 'FULL_STATE_SYNC') {
    _handleStateSyncResponse(message);
  }
}

/**
 * Handle QUICK_TAB_STATE_UPDATED message from port
 * v1.6.3.7-v4 - FIX Issue #9: Extracted for complexity reduction
 * @private
 * @param {Object} message - State update message
 */
function _handleQuickTabStateUpdate(message) {
  console.log('[Manager] PORT_STATE_UPDATE_RECEIVED:', {
    quickTabId: message.quickTabId,
    changes: message.changes,
    messageId: message.messageId,
    source: 'port'
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

// ==================== v1.6.3.7-v3 BROADCAST CHANNEL ====================
// API #2: BroadcastChannel - Real-Time Tab Messaging
// BroadcastChannel is PRIMARY (fast), storage.onChanged is FALLBACK (reliable)

/**
 * Handler function reference for cleanup
 * v1.6.3.7-v3 - API #2: Track handler for removal
 */
let broadcastHandlerRef = null;

/**
 * Initialize BroadcastChannel for real-time updates
 * v1.6.3.7-v3 - API #2: Setup channel and listener
 */
function initializeBroadcastChannel() {
  const initialized = initBroadcastChannel();
  if (!initialized) {
    console.log('[Manager] BroadcastChannel not available, using storage.onChanged only');
    return;
  }

  // Create handler function
  broadcastHandlerRef = handleBroadcastChannelMessage;

  // Add listener
  const added = addBroadcastListener(broadcastHandlerRef);
  if (added) {
    console.log('[Manager] v1.6.3.7-v3 BroadcastChannel listener added');
  }
}

/**
 * Handle messages from BroadcastChannel
 * v1.6.3.7-v3 - API #2: Process targeted updates from other tabs
 * v1.6.3.7-v4 - FIX Issue #4: Extract messageId for deduplication
 * @param {MessageEvent} event - BroadcastChannel message event
 */
function handleBroadcastChannelMessage(event) {
  const message = event.data;

  if (!message || !message.type) {
    return;
  }

  // v1.6.3.7-v4 - FIX Issue #4: Generate messageId from BroadcastChannel message for deduplication
  // BroadcastChannel messages don't have messageId, so we generate one from type+quickTabId+timestamp+random
  // Added random component to ensure uniqueness even for rapid same-type messages
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const broadcastMessageId = message.messageId || `bc-${message.type}-${message.quickTabId}-${message.timestamp || Date.now()}-${randomSuffix}`;

  console.log('[Manager] BROADCAST_CHANNEL_RECEIVED:', {
    type: message.type,
    quickTabId: message.quickTabId,
    timestamp: message.timestamp,
    messageId: broadcastMessageId,
    source: 'BroadcastChannel'
  });

  // v1.6.3.7-v4 - Route to handler based on message type
  _routeBroadcastMessage(message, broadcastMessageId);
}

/**
 * Route broadcast message to appropriate handler
 * v1.6.3.7-v4 - FIX Complexity: Extracted from handleBroadcastChannelMessage
 * @private
 * @param {Object} message - BroadcastChannel message
 * @param {string} messageId - Generated message ID for deduplication
 */
function _routeBroadcastMessage(message, messageId) {
  const handlers = {
    'quick-tab-created': handleBroadcastCreate,
    'quick-tab-updated': handleBroadcastUpdate,
    'quick-tab-deleted': handleBroadcastDelete,
    'quick-tab-minimized': handleBroadcastMinimizeRestore,
    'quick-tab-restored': handleBroadcastMinimizeRestore
  };

  const handler = handlers[message.type];
  if (handler) {
    handler(message, messageId);
  } else {
    console.log('[Manager] Unknown broadcast type:', message.type);
  }
}

/**
 * Handle quick-tab-created broadcast
 * v1.6.3.7-v3 - API #2: Add new Quick Tab to state
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * @param {Object} message - Broadcast message with data
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastCreate(message, messageId) {
  const { quickTabId, data } = message;

  if (!quickTabId || !data) {
    return;
  }

  // Check if already exists
  const existingIdx = quickTabsState.tabs?.findIndex(t => t.id === quickTabId);
  if (existingIdx >= 0) {
    console.log('[Manager] Quick Tab already exists, skipping create:', quickTabId);
    return;
  }

  // Add to state
  if (!quickTabsState.tabs) {
    quickTabsState.tabs = [];
  }
  quickTabsState.tabs.push(data);
  quickTabsState.timestamp = Date.now();

  // Update cache
  _updateInMemoryCache(quickTabsState.tabs);
  lastLocalUpdateTime = Date.now();

  console.log('[Manager] BROADCAST_CREATE: added Quick Tab:', quickTabId);

  // v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
  scheduleRender('broadcast-create', messageId);
}

/**
 * Handle quick-tab-updated broadcast
 * v1.6.3.7-v3 - API #2: Update existing Quick Tab
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * @param {Object} message - Broadcast message with changes
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastUpdate(message, messageId) {
  const { quickTabId, changes } = message;

  if (!quickTabId || !changes) {
    return;
  }

  // Find the tab
  const tabIdx = quickTabsState.tabs?.findIndex(t => t.id === quickTabId);
  if (tabIdx < 0) {
    console.log('[Manager] Quick Tab not found for update:', quickTabId);
    return;
  }

  // Apply changes
  Object.assign(quickTabsState.tabs[tabIdx], changes);
  quickTabsState.timestamp = Date.now();

  // Update cache
  _updateInMemoryCache(quickTabsState.tabs);
  lastLocalUpdateTime = Date.now();

  console.log('[Manager] BROADCAST_UPDATE: updated Quick Tab:', quickTabId, changes);

  // v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
  scheduleRender('broadcast-update', messageId);
}

/**
 * Handle quick-tab-deleted broadcast
 * v1.6.3.7-v3 - API #2: Remove Quick Tab from state
 * v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
 * @param {Object} message - Broadcast message
 * @param {string} messageId - Message ID for deduplication
 */
function handleBroadcastDelete(message, messageId) {
  const { quickTabId } = message;

  if (!quickTabId) {
    return;
  }

  // Find and remove
  const tabIdx = quickTabsState.tabs?.findIndex(t => t.id === quickTabId);
  if (tabIdx < 0) {
    console.log('[Manager] Quick Tab not found for delete:', quickTabId);
    return;
  }

  quickTabsState.tabs.splice(tabIdx, 1);
  quickTabsState.timestamp = Date.now();

  // Update cache
  _updateInMemoryCache(quickTabsState.tabs);
  lastLocalUpdateTime = Date.now();

  console.log('[Manager] BROADCAST_DELETE: removed Quick Tab:', quickTabId);

  // v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
  scheduleRender('broadcast-delete', messageId);
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

  const tabIdx = quickTabsState.tabs?.findIndex(t => t.id === quickTabId);
  if (tabIdx < 0) {
    return;
  }

  // Apply minimized state
  if (changes && 'minimized' in changes) {
    quickTabsState.tabs[tabIdx].minimized = changes.minimized;
    quickTabsState.timestamp = Date.now();

    _updateInMemoryCache(quickTabsState.tabs);
    lastLocalUpdateTime = Date.now();

    console.log('[Manager] BROADCAST_MINIMIZE:', quickTabId, 'minimized=', changes.minimized);
    // v1.6.3.7-v4 - FIX Issue #4: Pass messageId for deduplication
    scheduleRender('broadcast-minimize', messageId);
  }
}

/**
 * Cleanup BroadcastChannel on window unload
 * v1.6.3.7-v3 - API #2: Remove listener and close channel
 */
function cleanupBroadcastChannel() {
  if (broadcastHandlerRef) {
    removeBroadcastListener(broadcastHandlerRef);
    broadcastHandlerRef = null;
  }
  closeBroadcastChannel();
  console.log('[Manager] v1.6.3.7-v3 BroadcastChannel cleaned up');
}

// ==================== END BROADCAST CHANNEL ====================

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
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // v1.6.3.7-v4 - FIX Issue #4: Log message source for debugging
  console.log('[Manager] RUNTIME_MESSAGE_RECEIVED:', {
    type: message.type,
    messageId: message.messageId,
    source: 'runtime.onMessage',
    timestamp: Date.now()
  });

  if (message.type === 'QUICK_TAB_STATE_UPDATED') {
    console.log('[Manager] Received QUICK_TAB_STATE_UPDATED:', {
      quickTabId: message.quickTabId,
      changes: message.changes,
      source: message.originalSource,
      messageId: message.messageId
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
    sendResponse({ received: true });
    return true;
  }

  // v1.6.3.5-v11 - FIX Issue #6: Handle explicit QUICK_TAB_DELETED message
  if (message.type === 'QUICK_TAB_DELETED') {
    console.log('[Manager] Received QUICK_TAB_DELETED:', {
      quickTabId: message.quickTabId,
      source: message.source,
      messageId: message.messageId
    });

    handleStateDeletedMessage(message.quickTabId);
    // v1.6.3.7-v4 - FIX Issue #4: Route through scheduleRender with messageId for deduplication
    scheduleRender('runtime-QUICK_TAB_DELETED', message.messageId);
    sendResponse({ received: true });
    return true;
  }

  return false;
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

  // v1.6.3.7-v3 - API #2: Initialize BroadcastChannel for instant updates
  initializeBroadcastChannel();

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

  // v1.6.3.7-v4 - FIX Issue #7: Increased from 2s to 10s
  // BroadcastChannel is now PRIMARY for instant updates (fixed in Issue #2)
  // Storage polling is now a BACKUP fallback, so longer interval is acceptable
  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();
  }, 10000);

  console.log('[Manager] v1.6.3.7-v4 Port + BroadcastChannel + Message infrastructure initialized (storage poll: 10s)');
});

// v1.6.3.6-v11 - FIX Issue #17: Port cleanup on window unload
// v1.6.3.6-v12 - FIX Issue #4: Also stop heartbeat on unload
// v1.6.3.7-v3 - API #2: Also cleanup BroadcastChannel
window.addEventListener('unload', () => {
  // v1.6.3.7-v3 - API #2: Cleanup BroadcastChannel
  cleanupBroadcastChannel();

  // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat before disconnecting
  stopHeartbeat();

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
    console.warn('[Manager] ⚠️ STALE_CACHE_IGNORED: Cache is from different session during storm detection', {
      cacheSessionId,
      currentSessionId,
      cacheTabCount: cacheTabs.length,
      warning: 'Not using stale cache for fallback'
    });
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
 * Refactored: Extracted helpers to reduce complexity and nesting depth
 */
async function loadQuickTabsState() {
  const loadStartTime = Date.now();

  try {
    await checkStorageDebounce();

    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read start
    console.log('[Manager] Reading Quick Tab state from storage...');

    const result = await browser.storage.local.get(STATE_KEY);
    const state = result?.[STATE_KEY];

    if (!state) {
      _handleEmptyStorageState();
      console.log('[Manager] Storage read complete: empty state', {
        source: 'storage.local',
        durationMs: Date.now() - loadStartTime
      });
      return;
    }

    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read result
    console.log('[Manager] Storage read result:', {
      tabCount: state.tabs?.length ?? 0,
      saveId: state.saveId,
      timestamp: state.timestamp,
      source: 'storage.local',
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
 * @private
 * @param {Map} groups - Map of groupKey -> { quickTabs: [], tabInfo: {} }
 * @param {Object} collapseState - Collapse state for groups
 */
async function _reconcileGroups(groups, collapseState) {
  const startTime = Date.now();

  // Ensure we have a groups container
  if (!_groupsContainer || !containersList.contains(_groupsContainer)) {
    // First render or container was removed - create fresh
    _groupsContainer = document.createElement('div');
    _groupsContainer.className = 'tab-groups-container';
    containersList.innerHTML = '';
    containersList.appendChild(_groupsContainer);
    _groupElements.clear();
    _itemElements.clear();

    console.log('[Manager] RECONCILE: Created fresh groups container');
  }

  const sortedGroupKeys = _getSortedGroupKeys(groups);
  await _fetchMissingTabInfo(sortedGroupKeys, groups);
  _resortGroupKeys(sortedGroupKeys, groups);

  const existingGroupKeys = new Set(_groupElements.keys());
  const newGroupKeys = new Set(sortedGroupKeys.map(k => String(k)));

  // Calculate diff
  const groupsToRemove = [...existingGroupKeys].filter(k => !newGroupKeys.has(k));
  const groupsToAdd = sortedGroupKeys.filter(k => !existingGroupKeys.has(String(k)));
  const groupsToUpdate = sortedGroupKeys.filter(k => existingGroupKeys.has(String(k)));

  console.log('[Manager] RECONCILE_GROUPS:', {
    existing: existingGroupKeys.size,
    incoming: newGroupKeys.size,
    toRemove: groupsToRemove.length,
    toAdd: groupsToAdd.length,
    toUpdate: groupsToUpdate.length
  });

  // 1. Remove deleted groups (with exit animation)
  for (const groupKey of groupsToRemove) {
    _removeGroup(groupKey);
  }

  // 2. Update existing groups (in-place, no animation)
  for (const groupKey of groupsToUpdate) {
    const group = groups.get(groupKey);
    if (_shouldSkipGroup(group, groupKey)) {
      _removeGroup(String(groupKey));
      continue;
    }
    _updateGroup(String(groupKey), group, collapseState);
  }

  // 3. Add new groups (with entrance animation)
  for (const groupKey of groupsToAdd) {
    const group = groups.get(groupKey);
    if (_shouldSkipGroup(group, groupKey)) continue;
    _addGroup(groupKey, group, collapseState, sortedGroupKeys);
  }

  // Ensure correct order of groups in DOM
  _reorderGroups(sortedGroupKeys);

  // Attach collapse event listeners for any new groups
  attachCollapseEventListeners(_groupsContainer, collapseState);

  console.log('[Manager] RECONCILE_COMPLETE:', {
    durationMs: Date.now() - startTime,
    finalGroupCount: _groupElements.size,
    finalItemCount: _itemElements.size
  });
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
  // Update count badge
  const countEl = groupEl.querySelector('.tab-group-count');
  if (countEl) {
    const newCount = group.quickTabs?.length ?? 0;
    if (countEl.textContent !== String(newCount)) {
      animateCountBadgeIfChanged(groupKey, newCount, countEl);
      countEl.textContent = String(newCount);
      countEl.dataset.count = String(newCount);
    }
  }

  // Update title if tabInfo changed
  const titleEl = groupEl.querySelector('.tab-group-title');
  if (titleEl && group.tabInfo?.title && titleEl.textContent !== group.tabInfo.title) {
    titleEl.textContent = group.tabInfo.title;
    titleEl.title = group.tabInfo.url || '';
  }
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
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STATE_KEY]) return;
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
    return {
      requiresRender: true,
      hasDataChange: true,
      changeType: 'tab-count',
      changeReason: `Tab count changed: ${oldTabs.length} → ${newTabs.length}`,
      skipReason: null
    };
  }

  // Check for structural changes using helper
  const changeResults = _checkTabChanges(oldTabs, newTabs);

  // If only z-index changed, skip render
  if (!changeResults.hasDataChange && changeResults.hasMetadataOnlyChange) {
    return {
      requiresRender: false,
      hasDataChange: false,
      changeType: 'metadata-only',
      changeReason: 'z-index only',
      skipReason: `Only z-index changed: ${JSON.stringify(changeResults.zIndexChanges)}`
    };
  }

  // If there are data changes, render is required
  if (changeResults.hasDataChange) {
    return {
      requiresRender: true,
      hasDataChange: true,
      changeType: 'data',
      changeReason: changeResults.dataChangeReasons.join('; '),
      skipReason: null
    };
  }

  // No changes detected
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
 * @private
 * @param {Object} oldTab - Previous tab state
 * @param {Object} newTab - New tab state
 * @returns {{ hasDataChange: boolean, reasons: Array<string> }}
 */
function _checkSingleTabDataChanges(oldTab, newTab) {
  const reasons = [];

  if (oldTab.originTabId !== newTab.originTabId) {
    reasons.push(
      `originTabId changed for ${newTab.id}: ${oldTab.originTabId} → ${newTab.originTabId}`
    );
  }
  if (oldTab.minimized !== newTab.minimized) {
    reasons.push(`minimized changed for ${newTab.id}`);
  }
  if (oldTab.left !== newTab.left || oldTab.top !== newTab.top) {
    reasons.push(`position changed for ${newTab.id}`);
  }
  if (oldTab.width !== newTab.width || oldTab.height !== newTab.height) {
    reasons.push(`size changed for ${newTab.id}`);
  }
  if (oldTab.title !== newTab.title || oldTab.url !== newTab.url) {
    reasons.push(`title/url changed for ${newTab.id}`);
  }

  return {
    hasDataChange: reasons.length > 0,
    reasons
  };
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
    // v1.6.4.0 - FIX Issue A: Send command to background instead of direct storage write
    const response = await _sendActionRequest('CLOSE_MINIMIZED_TABS', {
      timestamp: Date.now()
    });

    if (response?.success || response?.timedOut) {
      console.log('[Manager] ✅ CLOSE_MINIMIZED_COMMAND_SUCCESS:', {
        closedCount: response?.closedCount || 0,
        closedIds: response?.closedIds || [],
        timedOut: response?.timedOut || false
      });

      // Re-render UI to reflect the change
      scheduleRender('close-minimized-success');
    } else {
      console.error('[Manager] ❌ CLOSE_MINIMIZED_COMMAND_FAILED:', {
        error: response?.error || 'Unknown error'
      });
    }
  } catch (err) {
    console.error('[Manager] Error sending close minimized command:', err);
  }
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
  if (response?.success || response?.timedOut) {
    // v1.6.4.0 - FIX Issue A: Command succeeded (or timed out with assumed success)
    console.log('[Manager] ✅ ADOPT_COMMAND_SUCCESS:', {
      quickTabId,
      targetTabId,
      oldOriginTabId: response?.oldOriginTabId,
      timedOut: response?.timedOut || false
    });

    // Update local tracking
    quickTabHostInfo.set(quickTabId, {
      hostTabId: targetTabId,
      lastUpdate: Date.now(),
      lastOperation: 'adopt',
      confirmed: true
    });

    // Invalidate cache for old tab (if response has it)
    if (response?.oldOriginTabId) {
      browserTabInfoCache.delete(response.oldOriginTabId);
    }

    // Re-render UI to reflect the change
    scheduleRender('adopt-success');
  } else {
    console.error('[Manager] ❌ ADOPT_COMMAND_FAILED:', {
      quickTabId,
      targetTabId,
      error: response?.error || 'Unknown error'
    });
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

  const persistResult = await _persistAdoption(
    quickTabId,
    targetTabId,
    state,
    oldOriginTabId,
    writeStartTime
  );
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
 * @private
 */
async function _persistAdoption(quickTabId, targetTabId, state, oldOriginTabId, writeStartTime) {
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
