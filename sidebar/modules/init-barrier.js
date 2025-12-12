/**
 * Initialization & Barrier Coordinator Module
 * sidebar/modules/init-barrier.js
 *
 * v1.6.3.8-v4 - Extracted from quick-tabs-manager.js for bundle size refactoring
 *
 * Responsibilities:
 * - Storage listener readiness tracking
 * - Port readiness tracking
 * - Ensures first render only after all barriers satisfied
 * - Initialization barrier Promise management
 * - Message queuing during initialization
 *
 * MIGRATION STATUS: Phase 1 (Constants & Functions Only)
 * The state variables in this module are NOT currently used by quick-tabs-manager.js.
 * The main file retains its own local state as the authoritative source.
 * These module state variables exist for future Phase 3 migration when
 * quick-tabs-manager.js will be updated to use module state via getters/setters.
 *
 * @module sidebar/modules/init-barrier
 */

// ==================== CONSTANTS ====================

/**
 * Maximum time to wait for initialization barrier to resolve
 * v1.6.3.8-v4 - FIX Issue #5: 10 second max init time with clear error message
 */
export const INIT_BARRIER_TIMEOUT_MS = 10000;

/**
 * Exponential backoff intervals for storage listener verification retry
 * v1.6.3.8-v4 - FIX Issue #4: Don't permanently disable Tier 3 on single timeout
 */
export const STORAGE_VERIFICATION_RETRY_MS = [1000, 2000, 4000];

/**
 * Interval for periodic state freshness check when sidebar becomes visible
 * v1.6.3.8-v4 - FIX Issue #3: Active state refresh when visible
 */
export const VISIBILITY_REFRESH_INTERVAL_MS = 15000;

/**
 * Connection state enum
 * v1.6.3.7-v5 - FIX Issue #1: Track three explicit states
 */
export const CONNECTION_STATE = {
  CONNECTED: 'connected',
  ZOMBIE: 'zombie',
  DISCONNECTED: 'disconnected'
};

// ==================== STATE ====================

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
 * Flag indicating storage listener is verified working
 * v1.6.3.8-v3 - FIX Issue #5: If false, Tier 3 fallback should be disabled
 */
let storageListenerVerified = false;

/**
 * Current connection state
 * v1.6.3.7-v5 - FIX Issue #1: Explicit state tracking
 */
let connectionState = CONNECTION_STATE.DISCONNECTED;

// Named constant for uninitialized timestamp
const INIT_TIME_NOT_STARTED = -1;

// ==================== MESSAGE REPLAY HANDLERS ====================
// These are set by the main module to handle replayed messages
let _portMessageHandler = null;
let _storageChangeHandler = null;

// ==================== GETTER/SETTER FUNCTIONS ====================

/**
 * Check if sidebar is fully initialized
 * v1.6.3.7-v9 - FIX Issue #11: Guard function for listeners
 * @returns {boolean} True if initialization is complete
 */
export function isFullyInitialized() {
  return initializationStarted && initializationComplete;
}

/**
 * Get initialization started flag
 * @returns {boolean}
 */
export function getInitializationStarted() {
  return initializationStarted;
}

/**
 * Set initialization started flag
 * @param {boolean} value
 */
export function setInitializationStarted(value) {
  initializationStarted = value;
}

/**
 * Get initialization complete flag
 * @returns {boolean}
 */
export function getInitializationComplete() {
  return initializationComplete;
}

/**
 * Set initialization complete flag
 * @param {boolean} value
 */
export function setInitializationComplete(value) {
  initializationComplete = value;
}

/**
 * Get initialization start time
 * @returns {number}
 */
export function getInitializationStartTime() {
  return initializationStartTime;
}

/**
 * Set initialization start time
 * @param {number} value
 */
export function setInitializationStartTime(value) {
  initializationStartTime = value;
}

/**
 * Get current initialization phase
 * @returns {string}
 */
export function getCurrentInitPhase() {
  return currentInitPhase;
}

/**
 * Set current initialization phase
 * @param {string} phase
 */
export function setCurrentInitPhase(phase) {
  currentInitPhase = phase;
}

/**
 * Get storage listener verified flag
 * @returns {boolean}
 */
export function getStorageListenerVerified() {
  return storageListenerVerified;
}

/**
 * Set storage listener verified flag
 * @param {boolean} value
 */
export function setStorageListenerVerified(value) {
  storageListenerVerified = value;
}

/**
 * Get current connection state
 * @returns {string}
 */
export function getConnectionState() {
  return connectionState;
}

/**
 * Set current connection state
 * @param {string} state
 */
export function setConnectionState(state) {
  connectionState = state;
}

/**
 * Get storage verification retry count
 * @returns {number}
 */
export function getStorageVerificationRetryCount() {
  return storageVerificationRetryCount;
}

/**
 * Set storage verification retry count
 * @param {number} count
 */
export function setStorageVerificationRetryCount(count) {
  storageVerificationRetryCount = count;
}

/**
 * Reset storage verification retry count to 0
 */
export function resetStorageVerificationRetryCount() {
  storageVerificationRetryCount = 0;
}

/**
 * Get the pre-init message queue
 * @returns {Array}
 */
export function getPreInitMessageQueue() {
  return preInitMessageQueue;
}

// ==================== MESSAGE HANDLER REGISTRATION ====================

/**
 * Register handlers for message replay
 * @param {Object} handlers - Object with portMessage and storageChange handlers
 */
export function registerMessageReplayHandlers(handlers) {
  _portMessageHandler = handlers.portMessage;
  _storageChangeHandler = handlers.storageChange;
}

// ==================== INITIALIZATION BARRIER FUNCTIONS ====================

/**
 * Initialize the initialization barrier Promise
 * v1.6.3.8-v4 - FIX Issue #5: Create single barrier for ALL async init
 */
export function initializeBarrier() {
  currentInitPhase = 'barrier-creating';
  initializationBarrier = new Promise((resolve, reject) => {
    _initBarrierResolve = resolve;
    _initBarrierReject = reject;
  });

  // Set timeout for barrier
  initBarrierTimeoutId = setTimeout(() => {
    handleInitBarrierTimeout();
  }, INIT_BARRIER_TIMEOUT_MS);

  console.log('[Manager] INITIALIZATION_BARRIER: phase=created', {
    timeoutMs: INIT_BARRIER_TIMEOUT_MS,
    timestamp: Date.now()
  });
}

/**
 * Handle initialization barrier timeout
 * v1.6.3.8-v4 - FIX Issue #5: Clear error message on timeout
 */
export function handleInitBarrierTimeout() {
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
  if (_initBarrierResolve) {
    currentInitPhase = 'timeout-resolved';
    _initBarrierResolve();
    initializationComplete = true;
    replayQueuedMessages();
  }

  initBarrierTimeoutId = null;
}

/**
 * Resolve the initialization barrier after successful init
 * v1.6.3.8-v4 - FIX Issue #5: Called when ALL async init is complete
 */
export function resolveInitBarrier() {
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

  if (_initBarrierResolve) {
    _initBarrierResolve();
  }

  initializationComplete = true;

  // Replay any queued messages
  replayQueuedMessages();
}

/**
 * Queue a message received before initialization is complete
 * v1.6.3.8-v4 - FIX Issue #9: Enforcing guard that queues messages
 * @param {string} source - Message source (port, storage, bc)
 * @param {Object} message - Message to queue
 */
export function queueMessageDuringInit(source, message) {
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
 */
export function replayQueuedMessages() {
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
    processQueuedInitMessage(item);
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
 */
function processQueuedInitMessage(item) {
  console.log('[Manager] INIT_MESSAGE_REPLAY: processing', {
    source: item.source,
    messageType: item.message?.type || item.message?.action || 'unknown',
    queuedAt: item.timestamp,
    delayMs: Date.now() - item.timestamp
  });

  try {
    routeInitMessage(item);
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
 */
function routeInitMessage(item) {
  if (item.source === 'port' && _portMessageHandler) {
    _portMessageHandler(item.message);
  } else if (item.source === 'storage' && _storageChangeHandler) {
    _storageChangeHandler(item.message);
  }
  // BC messages are demoted, so we skip them during replay
}

/**
 * Await initialization barrier before processing (for use in listeners)
 * v1.6.3.8-v4 - FIX Issue #5: Async guard that actually blocks
 * @returns {Promise<boolean>} True if barrier resolved, false if should skip
 */
export async function awaitInitBarrier() {
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

/**
 * Log listener entry with initialization status
 * v1.6.3.7-v9 - FIX Issue #11: Diagnostic logging for race detection
 * @param {string} listenerName - Name of the listener
 * @param {Object} context - Additional context to log
 */
export function logListenerEntry(listenerName, context = {}) {
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

/**
 * Guard against processing before initialization - ENFORCING version
 * v1.6.3.8-v4 - FIX Issue #9: Made ENFORCING - queues messages instead of skipping
 * @param {string} listenerName - Name of listener for logging
 * @param {Object} [changeData] - Data to queue if not initialized
 * @returns {boolean} True if should skip processing (caller should return)
 */
export function guardBeforeInit(listenerName, changeData = null) {
  if (!isFullyInitialized()) {
    const timeSinceInitStartMs =
      initializationStartTime > 0 ? Date.now() - initializationStartTime : INIT_TIME_NOT_STARTED;

    if (changeData) {
      queueMessageDuringInit('storage', changeData);
      console.log(`[Manager] LISTENER_CALLED_BEFORE_INIT: ${listenerName} - QUEUED`, {
        initializationStarted,
        initializationComplete,
        timeSinceInitStartMs,
        queueSize: preInitMessageQueue.length,
        message: 'Message queued - will be processed after init barrier resolves',
        timestamp: Date.now()
      });
    } else {
      console.warn(`[Manager] LISTENER_CALLED_BEFORE_INIT: ${listenerName} - SKIP (no data)`, {
        initializationStarted,
        initializationComplete,
        timeSinceInitStartMs,
        message: 'Skipping - no change data provided to queue',
        timestamp: Date.now()
      });
    }
    return true;
  }
  return false;
}
