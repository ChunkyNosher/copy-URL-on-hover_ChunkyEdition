// =============================================================================
// CRITICAL: Quick Tab Iframe Recursion Guard (Bug #2 Fix)
// =============================================================================
// This guard MUST be at the very top of the file to prevent browser crashes
// from infinite iframe nesting when content script runs inside Quick Tab iframes.
// =============================================================================

/**
 * Check if iframe src indicates it's a Quick Tab iframe
 * v1.6.2.5 - Helper to reduce complexity in _isQuickTabParentFrame
 *
 * @private
 * @param {Element} parentFrame - The parent frame element
 * @returns {boolean} - True if iframe src indicates Quick Tab
 */
function _hasQuickTabSrc(parentFrame) {
  try {
    const iframeSrc = parentFrame.src || '';
    // Blob URLs are commonly used by Quick Tabs
    return iframeSrc.startsWith('blob:');
  } catch (_e) {
    // Cross-origin access may throw
    return false;
  }
}

/**
 * Check parent element structure for Quick Tab patterns
 * v1.6.2.5 - Helper to reduce complexity in _isQuickTabParentFrame
 *
 * @private
 * @param {Element} parentFrame - The parent frame element
 * @returns {boolean} - True if parent structure indicates Quick Tab
 */

/**
 * Check if element has Quick Tab related attributes or classes
 * @private
 * @param {Element} element - Element to check
 * @returns {boolean} - True if element has Quick Tab indicators
 */
function _hasQuickTabIndicators(element) {
  return (
    element.hasAttribute('data-quick-tab-id') ||
    element.classList.contains('quick-tab-content') ||
    element.classList.contains('quick-tab-body') ||
    element.classList.contains('quick-tab-window')
  );
}

/**
 * Check parent element structure for Quick Tab patterns
 * @private
 * @param {Element} parentFrame - The parent frame element
 * @returns {boolean} - True if parent structure indicates Quick Tab
 */
function _hasQuickTabParentStructure(parentFrame) {
  try {
    const parent = parentFrame.parentElement;
    if (!parent) return false;

    // Check parent for Quick Tab indicators
    if (_hasQuickTabIndicators(parent)) return true;

    // Check grandparent for Quick Tab container
    const grandparent = parent.parentElement;
    if (grandparent && _hasQuickTabIndicators(grandparent)) return true;
  } catch (_e) {
    // DOM access may throw in edge cases - err on side of caution
    return true;
  }

  return false;
}

/**
 * Check if parent frame is a Quick Tab window (helper to reduce nesting)
 * v1.6.2.5 - ISSUE #3 FIX: Added multiple independent checks for defense-in-depth
 *
 * @param {Element} parentFrame - The parent frame element
 * @returns {boolean} - True if parent is a Quick Tab window
 */
function _isQuickTabParentFrame(parentFrame) {
  if (!parentFrame) return false;

  // Check 1: CSS selectors (existing, may fail if classes not applied yet)
  const quickTabSelectors = '.quick-tab-window, [data-quick-tab-id], [id^="quick-tab-"]';
  if (parentFrame.closest(quickTabSelectors) !== null) {
    return true;
  }

  // Check 2: iframe.src URL pattern check
  if (_hasQuickTabSrc(parentFrame)) {
    return true;
  }

  // Check 3: Parent element structure check
  return _hasQuickTabParentStructure(parentFrame);
}

/**
 * Check if we should skip initialization (inside Quick Tab iframe)
 * @returns {boolean} - True if initialization should be skipped
 */
function _checkShouldSkipInitialization() {
  // Not in iframe - proceed normally
  if (window.self === window.top) {
    return false;
  }

  // In iframe - check if parent is Quick Tab
  try {
    const parentFrame = window.frameElement;
    if (_isQuickTabParentFrame(parentFrame)) {
      console.log('[Content] Skipping initialization - inside Quick Tab iframe');
      window.CUO_skipped = true;
      window.CUO_skip_reason = 'quick-tab-iframe';
      return true;
    }
    return false;
  } catch (_e) {
    // Cross-origin error - err on side of caution
    console.log('[Content] Skipping initialization - cross-origin iframe (safety measure)');
    window.CUO_skipped = true;
    window.CUO_skip_reason = 'cross-origin-iframe';
    return true;
  }
}

// GUARD: Do not run extension in Quick Tab iframes or nested frames
const _shouldSkipInitialization = _checkShouldSkipInitialization();

// If inside Quick Tab iframe, stop all execution here
if (_shouldSkipInitialization) {
  // Export minimal marker for debugging and stop
  window.CUO_debug_marker = 'CUO_QUICK_TAB_IFRAME_SKIPPED';
  // Throw to prevent further module loading (caught by module loader)
  throw new Error('[Content] Intentional halt - inside Quick Tab iframe');
}

// v1.6.3.5-v10 - FIX Issue #2: Content script initialization logging
// Log immediately after iframe guard passes to confirm script loaded in this tab
console.log('[Content] ✓ Content script loaded, starting initialization');

// =============================================================================
// End of Iframe Recursion Guard - Normal extension initialization below
// =============================================================================

/**
 * Copy URL on Hover - Enhanced with Quick Tabs
 * Main Content Script Entry Point (Hybrid Architecture v1.5.9.3)
 *
 * This file serves as the main entry point and coordinates between modules.
 * URL handlers have been extracted to features/url-handlers/ for better maintainability.
 *
 * v1.5.9.3 Changes:
 * - Added console interceptor for comprehensive log capture
 * - Fixed log export "No logs found" issue by capturing all console.log() calls
 * - Console interceptor must be imported FIRST to capture all subsequent logs
 *
 * v1.5.8.10 Changes:
 * - Implemented Hybrid Modular/EventBus Architecture (Architecture #10)
 * - Moved dom.js and browser-api.js from utils/ to core/
 * - Created modular CSS files in ui/css/ (base.css, notifications.css, quick-tabs.css)
 * - Extracted notification logic into separate toast.js and tooltip.js modules
 * - Renamed quick-tab-window.js to window.js following architecture guidelines
 * - Enhanced EventBus integration for all features
 * - Follows hybrid-architecture-implementation.md
 *
 * v1.6.2.3 Changes:
 * - Added critical iframe recursion guard at top of file (Bug #2 fix)
 * - Prevents browser crashes from infinite Quick Tab nesting
 *
 * v1.6.3.6 Changes:
 * - FIX Issue #1: Added cross-tab filtering to RESTORE_QUICK_TAB and MINIMIZE_QUICK_TAB handlers
 * - Quick Tabs now only respond to operations from the tab that owns them (originTabId match)
 * - Prevents ghost Quick Tabs from appearing when Manager broadcasts to all tabs
 *
 * v1.6.3.7 Changes:
 * - FIX Issue #3: Unified deletion behavior between UI button and Manager close button
 * - CLOSE_QUICK_TAB handler now accepts 'source' parameter for cross-tab broadcast handling
 * - Background broadcasts deletion to all tabs, content scripts filter by ownership
 */

// ✅ CRITICAL: Import console interceptor FIRST to capture all logs
// This MUST be imported before any other modules to capture their logs
// eslint-disable-next-line import/order
import { getConsoleLogs, getBufferStats, clearConsoleLogs } from './utils/console-interceptor.js';

// CRITICAL: Early detection marker - must execute first
console.log('[Copy-URL-on-Hover] Script loaded! @', new Date().toISOString());

try {
  window.CUO_debug_marker = 'JS executed to top of file!';
  console.log('[Copy-URL-on-Hover] Debug marker set successfully');
} catch (e) {
  console.error('[Copy-URL-on-Hover] CRITICAL: Failed to set window marker', e);
}

// Global error handler to catch all unhandled errors
window.addEventListener('error', event => {
  console.error('[Copy-URL-on-Hover] GLOBAL ERROR:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    stack: event.error?.stack
  });
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', event => {
  console.error('[Copy-URL-on-Hover] UNHANDLED PROMISE REJECTION:', {
    reason: event.reason,
    promise: event.promise
  });
});

console.log('[Copy-URL-on-Hover] Global error handlers installed');

// Import core modules
console.log('[Copy-URL-on-Hover] Starting module imports...');
import { copyToClipboard, sendMessageToBackground } from './core/browser-api.js';
import { ConfigManager, CONSTANTS, DEFAULT_CONFIG } from './core/config.js';
import { EventBus, Events } from './core/events.js';
import { StateManager } from './core/state.js';
import { initNotifications } from './features/notifications/index.js';
import { initQuickTabs } from './features/quick-tabs/index.js';
import { getLinkText } from './features/url-handlers/generic.js';
import { URLHandlerRegistry } from './features/url-handlers/index.js';
import { clearLogBuffer, debug, enableDebug, getLogBuffer } from './utils/debug.js';
import { settingsReady } from './utils/filter-settings.js';
import { logNormal, logWarn, refreshLiveConsoleSettings } from './utils/logger.js';
// v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Import setWritingTabId to set tab ID for storage writes
// v1.6.3.10-v6 - FIX Issue #4/11/12: Import isWritingTabIdInitialized for synchronous check
import { setWritingTabId, isWritingTabIdInitialized } from './utils/storage-utils.js';

console.log('[Copy-URL-on-Hover] All module imports completed successfully');

// Initialize core systems
console.log('[Copy-URL-on-Hover] Initializing core systems...');
const configManager = new ConfigManager();
console.log('[Copy-URL-on-Hover] ConfigManager initialized');
const stateManager = new StateManager();
console.log('[Copy-URL-on-Hover] StateManager initialized');
const eventBus = new EventBus();
console.log('[Copy-URL-on-Hover] EventBus initialized');
const urlRegistry = new URLHandlerRegistry();
console.log('[Copy-URL-on-Hover] URLHandlerRegistry initialized');

// Feature managers (initialized after config is loaded)
let quickTabsManager = null;
let notificationManager = null;

// Load configuration
let CONFIG = { ...DEFAULT_CONFIG };

/**
 * v1.6.0 Phase 2.4 - Extracted helper for config loading
 */
async function loadConfiguration() {
  console.log('[Copy-URL-on-Hover] STEP: Loading user configuration...');
  try {
    const config = await configManager.load();
    console.log('[Copy-URL-on-Hover] ✓ Configuration loaded successfully');
    console.log('[Copy-URL-on-Hover] Config values:', {
      debugMode: config.debugMode,
      quickTabPersistAcrossTabs: config.quickTabPersistAcrossTabs,
      hasDefaultConfig: config !== null && config !== undefined
    });
    return config;
  } catch (configErr) {
    console.error('[Copy-URL-on-Hover] ERROR: Failed to load configuration:', configErr);
    console.log('[Copy-URL-on-Hover] Falling back to DEFAULT_CONFIG');
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for debug mode setup
 */
function setupDebugMode() {
  if (!CONFIG.debugMode) return;

  console.log('[Copy-URL-on-Hover] STEP: Enabling debug mode...');
  try {
    enableDebug();
    eventBus.enableDebug();
    debug('Debug mode enabled');
    console.log('[Copy-URL-on-Hover] ✓ Debug mode activated');
  } catch (debugErr) {
    console.error('[Copy-URL-on-Hover] ERROR: Failed to enable debug mode:', debugErr);
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for state initialization
 */
function initializeState() {
  console.log('[Copy-URL-on-Hover] STEP: Initializing state...');
  stateManager.setState({
    quickTabZIndex: CONSTANTS.QUICK_TAB_BASE_Z_INDEX
  });
  console.log('[Copy-URL-on-Hover] ✓ State initialized');
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for feature initialization
 */
/**
 * v1.6.0.3 - Helper to log Quick Tabs initialization error details
 */
/**
 * Format error details for logging
 * @private
 * @param {Error} qtErr - Error object
 * @returns {Object} - Formatted error details
 */
function _formatErrorDetails(qtErr) {
  return {
    message: qtErr?.message || 'No message',
    name: qtErr?.name || 'No name',
    stack: qtErr?.stack || 'No stack',
    type: typeof qtErr,
    stringified: JSON.stringify(qtErr),
    keys: Object.keys(qtErr || {}),
    error: qtErr
  };
}

/**
 * Log individual error properties
 * @private
 * @param {Error} qtErr - Error object
 */
function _logErrorProperties(qtErr) {
  if (!qtErr) return;
  for (const key in qtErr) {
    console.error(`[Copy-URL-on-Hover] Error property "${key}":`, qtErr[key]);
  }
}

function logQuickTabsInitError(qtErr) {
  console.error(
    '[Copy-URL-on-Hover] ❌ EXCEPTION during Quick Tabs initialization:',
    _formatErrorDetails(qtErr)
  );
  _logErrorProperties(qtErr);
}

// ==================== v1.6.3.10-v10 TAB ID RETRY CONSTANTS ====================
// FIX Issue #5: Exponential backoff retry configuration for tab ID acquisition
// Retry delays: 200ms, 500ms, 1500ms, 5000ms (total 7200ms before final failure)
const TAB_ID_RETRY_DELAYS_MS = [200, 500, 1500, 5000];
const TAB_ID_MAX_RETRIES = TAB_ID_RETRY_DELAYS_MS.length;

// v1.6.3.10-v11 - FIX Issue #1: Extended retry for background initialization
// After initial backoff exhaustion, use slower retry loop with 5-10s intervals
// Total extended timeout: 60 seconds to allow for slow background initialization
const TAB_ID_EXTENDED_RETRY_INTERVAL_MS = 5000;
const TAB_ID_EXTENDED_RETRY_MAX_ATTEMPTS = 8; // 8 x 5s = 40s additional retry window
const TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS = 60000; // 60 seconds total timeout

// v1.6.3.10-v11 - FIX Issue #1: Track background readiness for event-driven retry
let backgroundReadinessDetected = false;
let tabIdAcquisitionPending = false;
// eslint-disable-next-line prefer-const -- Resolver is assigned later in async context
let tabIdAcquisitionResolver = null;

// v1.6.3.10-v10 - FIX Code Review: Extract error strings as constants
// v1.6.3.10-v10 - FIX Code Review: Use Set for O(1) lookup performance
const RETRYABLE_ERROR_CODES = new Set(['NOT_INITIALIZED', 'GLOBAL_STATE_NOT_READY']);
// v1.6.4.15 - FIX Code Review: Convert to Set for O(1) lookup and consistency
const RETRYABLE_MESSAGE_PATTERNS = new Set(['disconnected', 'receiving end', 'Extension context']);

// ==================== v1.6.4.15 FIX ISSUE #14: MESSAGE QUEUE DURING INIT ====================
// Queue messages while content script initializes to prevent lost messages

/**
 * Track whether content script initialization is complete
 * v1.6.4.15 - FIX Issue #14: Initialization tracking
 */
let contentScriptInitialized = false;

/**
 * Track whether hydration from storage is complete
 * v1.6.3.10-v11 - FIX Issue #15: Hydration race condition prevention
 * Operations like CREATE_QUICK_TAB should wait until hydration is complete
 */
let isHydrationComplete = false;

/**
 * Timeout for hydration (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #15: If hydration doesn't complete within this time, allow operations anyway
 */
const HYDRATION_TIMEOUT_MS = 3000;

/**
 * Queue for operations that arrived during hydration
 * v1.6.3.10-v11 - FIX Issue #15: Buffer operations until hydration completes
 */
const preHydrationOperationQueue = [];

/**
 * Message queue for messages sent during initialization window
 * v1.6.4.15 - FIX Issue #14: Queue messages during init
 */
const initializationMessageQueue = [];

/**
 * Maximum queue size for initialization messages
 * v1.6.4.15 - FIX Issue #14
 * v1.6.3.10-v11 - FIX Issue #6: Increased from 20 to 100 with backpressure warning
 */
const MAX_INIT_MESSAGE_QUEUE_SIZE = 100;

/**
 * Queue backpressure warning threshold (75% of max)
 * v1.6.3.10-v11 - FIX Issue #6: Backpressure mechanism
 */
const QUEUE_BACKPRESSURE_THRESHOLD = 75;

/**
 * Track dropped messages for retry
 * v1.6.3.10-v11 - FIX Issue #6: Retry dropped messages
 */
const droppedMessageBuffer = [];
const MAX_DROPPED_MESSAGES = 10;

/**
 * Background unresponsive timeout (ms)
 * v1.6.4.15 - FIX Issue #14: Timeout-based fallback if background unresponsive
 */
const BACKGROUND_UNRESPONSIVE_TIMEOUT_MS = 5000;

/**
 * Track last successful background response time
 * v1.6.4.15 - FIX Issue #14
 */
let lastBackgroundResponseTime = Date.now();

// ==================== v1.6.3.10-v11 FIX ISSUE #2: MESSAGE ORDERING ====================
// Ensure deterministic message processing order

/**
 * Operation types for message ordering
 * v1.6.3.10-v11 - FIX Issue #2: Explicit operation type for ordering
 * @enum {string}
 */
const OPERATION_TYPE = {
  CREATE: 'CREATE',
  RESTORE: 'RESTORE',
  UPDATE: 'UPDATE',
  CLOSE: 'CLOSE',
  MINIMIZE: 'MINIMIZE'
};

/**
 * Operation type priority for sorting (lower = higher priority)
 * v1.6.3.10-v11 - FIX Issue #2: CREATE must be processed before RESTORE
 * Reserved for future use in command queue sorting
 */
const _OPERATION_PRIORITY = {
  [OPERATION_TYPE.CREATE]: 1,
  [OPERATION_TYPE.RESTORE]: 2,
  [OPERATION_TYPE.UPDATE]: 3,
  [OPERATION_TYPE.MINIMIZE]: 4,
  [OPERATION_TYPE.CLOSE]: 5
};

/**
 * Command queue for deterministic processing
 * v1.6.3.10-v11 - FIX Issue #2: Buffer operations for ordered processing
 * Reserved for future use in ordered message processing
 */
const _commandQueue = [];

/**
 * Global sequence counter for message ordering
 * v1.6.3.10-v11 - FIX Issue #2: Monotonic sequence for ordering
 */
let globalCommandSequenceId = 0;

/**
 * Map of Quick Tab IDs to pending CREATE acknowledgments
 * v1.6.3.10-v11 - FIX Issue #2: Track CREATE completion before allowing RESTORE
 * Reserved for future use in acknowledgment protocol
 */
const _pendingCreateAcks = new Map();

// ==================== v1.6.3.10-v11 FIX ISSUE #23: HEARTBEAT MECHANISM ====================
// FIX Issue #23: Background service worker restart recovery via heartbeat

/**
 * Heartbeat interval (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #23: Every 15 seconds
 */
const HEARTBEAT_INTERVAL_MS = 15000;

/**
 * Heartbeat timeout for response (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #23: 5 seconds before considering background unresponsive
 */
const HEARTBEAT_RESPONSE_TIMEOUT_MS = 5000;

/**
 * Maximum message retry attempts
 * v1.6.3.10-v11 - FIX Issue #23: Retry failed messages up to 3 times
 */
const MESSAGE_MAX_RETRIES = 3;

/**
 * Message timeout before retry (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #23
 */
const MESSAGE_RESPONSE_TIMEOUT_MS = 5000;

/**
 * Track background version/generation for restart detection
 * v1.6.3.10-v11 - FIX Issue #23
 */
let lastKnownBackgroundGeneration = null;
let _lastHeartbeatTime = 0;  // Prefixed with _ to indicate unused (available for debug logging)
let heartbeatIntervalId = null;
let heartbeatFailureCount = 0;
const HEARTBEAT_MAX_FAILURES = 3;

/**
 * Update background generation from any message response
 * v1.6.3.10-v12 - FIX Issue #8: Track generation from all responses for restart detection
 * @param {string} generation - Background generation ID from response
 * @private
 */
function _updateBackgroundGenerationFromResponse(generation) {
  if (!generation) return;
  
  // Check for restart (generation changed)
  if (lastKnownBackgroundGeneration !== null && generation !== lastKnownBackgroundGeneration) {
    console.log('[Content] v1.6.3.10-v12 GENERATION_MISMATCH_DETECTED:', {
      previousGeneration: lastKnownBackgroundGeneration,
      newGeneration: generation,
      triggeredBy: 'message_response'
    });
    
    // Trigger restart handling
    _handleBackgroundRestart(generation);
  } else if (lastKnownBackgroundGeneration === null) {
    console.log('[Content] v1.6.3.10-v12 INITIAL_GENERATION_SET:', {
      generation
    });
  }
  
  lastKnownBackgroundGeneration = generation;
}

/**
 * Track message retry state
 * v1.6.3.10-v11 - FIX Issue #23
 */
let messageIdCounter = 0;
const pendingMessages = new Map(); // messageId -> { message, retryCount, sentAt, resolve, reject }

/**
 * Generate unique message ID for correlation
 * v1.6.3.10-v11 - FIX Issue #23
 * @returns {string} Unique message ID
 */
function _generateMessageId() {
  return `msg-${Date.now()}-${++messageIdCounter}`;
}

/**
 * Send heartbeat to background and check for restart
 * v1.6.3.10-v11 - FIX Issue #23
 */
async function _sendHeartbeat() {
  const heartbeatStart = Date.now();
  const heartbeatId = _generateMessageId();
  
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage({
        type: 'HEARTBEAT',
        messageId: heartbeatId,
        timestamp: heartbeatStart,
        lastKnownGeneration: lastKnownBackgroundGeneration
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Heartbeat timeout')), HEARTBEAT_RESPONSE_TIMEOUT_MS)
      )
    ]);
    
    const latencyMs = Date.now() - heartbeatStart;
    _lastHeartbeatTime = Date.now();
    heartbeatFailureCount = 0;
    
    // v1.6.3.10-v11 - FIX Issue #5: Record latency for dynamic adoption TTL
    if (typeof _recordHandshakeLatency === 'function') {
      _recordHandshakeLatency(latencyMs);
    }
    
    // Check for background restart
    if (response?.generation && lastKnownBackgroundGeneration !== null && 
        response.generation !== lastKnownBackgroundGeneration) {
      console.log('[Content][HEARTBEAT] BACKGROUND_RESTART_DETECTED:', {
        previousGeneration: lastKnownBackgroundGeneration,
        newGeneration: response.generation,
        latencyMs
      });
      
      // Trigger reconnection/rehydration
      _handleBackgroundRestart(response.generation);
    }
    
    // Update known generation
    if (response?.generation) {
      lastKnownBackgroundGeneration = response.generation;
    }
    
    console.log('[Content][HEARTBEAT] SUCCESS:', {
      heartbeatId,
      latencyMs,
      generation: response?.generation
    });
    
  } catch (err) {
    heartbeatFailureCount++;
    console.warn('[Content][HEARTBEAT] FAILURE:', {
      heartbeatId,
      error: err.message,
      failureCount: heartbeatFailureCount,
      maxFailures: HEARTBEAT_MAX_FAILURES
    });
    
    // If too many failures, assume background restarted
    if (heartbeatFailureCount >= HEARTBEAT_MAX_FAILURES) {
      console.log('[Content][HEARTBEAT] MAX_FAILURES_REACHED: Assuming background restart');
      _handleBackgroundRestart(null);
      heartbeatFailureCount = 0;
    }
  }
}

/**
 * Handle detected background restart
 * v1.6.3.10-v11 - FIX Issue #23
 * @param {string|null} newGeneration - New background generation ID
 */
function _handleBackgroundRestart(newGeneration) {
  console.log('[Content] BACKGROUND_RESTART: Initiating recovery', {
    newGeneration,
    pendingMessages: pendingMessages.size
  });
  
  lastKnownBackgroundGeneration = newGeneration;
  
  // Notify pending tab ID acquisition to retry
  _notifyBackgroundReadiness();
  
  // Retry any pending messages
  _retryPendingMessages();
  
  // Emit event for listeners
  if (typeof eventBus !== 'undefined' && eventBus.emit) {
    eventBus.emit('background:restart', { generation: newGeneration });
  }
}

/**
 * Retry all pending messages after background restart
 * v1.6.3.10-v11 - FIX Issue #23
 */
function _retryPendingMessages() {
  if (pendingMessages.size === 0) return;
  
  console.log('[Content] RETRY_PENDING_MESSAGES:', { count: pendingMessages.size });
  
  for (const [messageId, pending] of pendingMessages) {
    if (pending.retryCount < MESSAGE_MAX_RETRIES) {
      pending.retryCount++;
      console.log('[Content] MESSAGE_RETRY:', {
        messageId,
        attempt: pending.retryCount,
        maxRetries: MESSAGE_MAX_RETRIES
      });
      
      // Re-send the message
      _sendMessageWithRetry(pending.message, pending.resolve, pending.reject, pending.retryCount);
    } else {
      // Max retries exceeded
      pending.reject(new Error(`Max retries (${MESSAGE_MAX_RETRIES}) exceeded for message ${messageId}`));
      pendingMessages.delete(messageId);
    }
  }
}

/**
 * Send message with retry and timeout support
 * v1.6.3.10-v11 - FIX Issue #23: Message envelope with retry
 * @param {Object} message - Message to send
 * @param {Function} resolve - Promise resolve function
 * @param {Function} reject - Promise reject function
 * @param {number} [retryCount=0] - Current retry count
 */
async function _sendMessageWithRetry(message, resolve, reject, retryCount = 0) {
  const messageId = message.messageId || _generateMessageId();
  const envelope = {
    ...message,
    messageId,
    timestamp: Date.now(),
    retryCount
  };
  
  // Track pending message
  pendingMessages.set(messageId, {
    message: envelope,
    retryCount,
    sentAt: Date.now(),
    resolve,
    reject
  });
  
  console.log('[Content] MESSAGE_SENT:', {
    messageId,
    action: message.action || message.type,
    retryCount
  });
  
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage(envelope),
      new Promise((_, rej) => 
        setTimeout(() => rej(new Error('Message timeout')), MESSAGE_RESPONSE_TIMEOUT_MS)
      )
    ]);
    
    console.log('[Content] MESSAGE_RECEIVED_RESPONSE:', {
      messageId,
      success: response?.success ?? true
    });
    
    pendingMessages.delete(messageId);
    resolve(response);
    
  } catch (err) {
    const pending = pendingMessages.get(messageId);
    
    if (pending && pending.retryCount < MESSAGE_MAX_RETRIES) {
      // Will be retried on next heartbeat failure or manually
      console.warn('[Content] MESSAGE_TIMEOUT: Will retry on background recovery', {
        messageId,
        retryCount: pending.retryCount,
        error: err.message
      });
    } else {
      pendingMessages.delete(messageId);
      reject(err);
    }
  }
}

/**
 * Start heartbeat interval
 * v1.6.3.10-v11 - FIX Issue #23
 */
function _startHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
  }
  
  // Send initial heartbeat
  _sendHeartbeat();
  
  // Start interval
  heartbeatIntervalId = setInterval(_sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  
  console.log('[Content][HEARTBEAT] STARTED:', {
    intervalMs: HEARTBEAT_INTERVAL_MS,
    timestamp: Date.now()
  });
}

/**
 * Stop heartbeat interval
 * v1.6.3.10-v11 - FIX Issue #23
 */
function _stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    console.log('[Content][HEARTBEAT] STOPPED');
  }
}

// ==================== END ISSUE #23 FIX ====================

/**
 * Check if a message has valid format for sending
 * v1.6.4.15 - FIX Issue #14: Pre-flight validation
 * @param {Object} message - Message to validate
 * @returns {{valid: boolean, error?: string}}
 */
function _validateMessageFormat(message) {
  if (!message) {
    return { valid: false, error: 'Message is null or undefined' };
  }
  
  if (typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }
  
  // Must have action or type
  if (!message.action && !message.type) {
    return { valid: false, error: 'Message must have action or type property' };
  }
  
  return { valid: true };
}

/**
 * Queue a message during initialization window
 * v1.6.4.15 - FIX Issue #14: Queue messages during init
 * v1.6.3.10-v11 - FIX Issue #6: Backpressure mechanism with detailed logging
 * @param {Object} message - Message to queue
 * @param {Function} callback - Callback to execute when message can be sent
 */
function _queueInitializationMessage(message, callback) {
  const queueSize = initializationMessageQueue.length;
  
  // v1.6.3.10-v11 - FIX Issue #6: Check and emit backpressure warning
  _checkQueueBackpressure(queueSize);
  
  // v1.6.3.10-v11 - FIX Issue #6: Handle queue overflow
  if (queueSize >= MAX_INIT_MESSAGE_QUEUE_SIZE) {
    _handleQueueOverflow();
  }
  
  initializationMessageQueue.push({
    message,
    callback,
    queuedAt: Date.now(),
    sequenceId: ++globalCommandSequenceId // v1.6.3.10-v11 - FIX Issue #2: Add sequence ID
  });
  
  console.log('[MSG][Content] MESSAGE_QUEUED_DURING_INIT:', {
    action: message.action || message.type,
    quickTabId: message.id || message.quickTabId,
    sequenceId: globalCommandSequenceId,
    queueSize: initializationMessageQueue.length
  });
}

/**
 * Check and emit backpressure warning if queue is approaching limit
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * @private
 * @param {number} queueSize - Current queue size
 */
function _checkQueueBackpressure(queueSize) {
  if (queueSize >= QUEUE_BACKPRESSURE_THRESHOLD && queueSize < MAX_INIT_MESSAGE_QUEUE_SIZE) {
    console.warn('[MSG][Content] QUEUE_BACKPRESSURE: Queue approaching limit, slow down message send rate', {
      currentSize: queueSize,
      threshold: QUEUE_BACKPRESSURE_THRESHOLD,
      maxSize: MAX_INIT_MESSAGE_QUEUE_SIZE,
      percentFull: Math.round((queueSize / MAX_INIT_MESSAGE_QUEUE_SIZE) * 100)
    });
  }
}

/**
 * Handle queue overflow by dropping oldest message and buffering for retry
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * @private
 */
function _handleQueueOverflow() {
  const dropped = initializationMessageQueue.shift();
  const queueSize = initializationMessageQueue.length;
  
  // v1.6.3.10-v11 - FIX Issue #6: Log dropped message with full metadata
  console.error('[MSG][Content] INIT_QUEUE_OVERFLOW: Dropped message (queue full)', {
    droppedMessageType: dropped?.message?.action || dropped?.message?.type,
    droppedQuickTabId: dropped?.message?.id || dropped?.message?.quickTabId,
    droppedTimestamp: dropped?.queuedAt,
    queueSizeAtDrop: queueSize + 1,
    dropTime: Date.now(),
    messageAgeMs: dropped?.queuedAt ? Date.now() - dropped.queuedAt : null
  });
  
  // v1.6.3.10-v11 - FIX Issue #6: Buffer dropped messages for retry
  _bufferDroppedMessage(dropped);
}

/**
 * Buffer a dropped message for later retry
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * @private
 * @param {Object} dropped - Dropped message entry
 */
function _bufferDroppedMessage(dropped) {
  if (!dropped || droppedMessageBuffer.length >= MAX_DROPPED_MESSAGES) return;
  
  droppedMessageBuffer.push({
    message: dropped.message,
    callback: dropped.callback,
    originalQueuedAt: dropped.queuedAt,
    droppedAt: Date.now()
  });
  console.log('[MSG][Content] DROPPED_MESSAGE_BUFFERED: Will retry after background ready', {
    bufferSize: droppedMessageBuffer.length,
    maxBuffer: MAX_DROPPED_MESSAGES
  });
}

/**
 * Retry a single dropped message
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * @private
 * @param {Object} dropped - Dropped message entry
 */
async function _retryDroppedMessage(dropped) {
  try {
    await dropped.callback(dropped.message);
    console.log('[MSG][Content] DROPPED_MESSAGE_RETRY_SUCCESS:', {
      action: dropped.message.action || dropped.message.type,
      totalDelayMs: Date.now() - dropped.originalQueuedAt
    });
  } catch (err) {
    console.error('[MSG][Content] DROPPED_MESSAGE_RETRY_FAILED:', {
      action: dropped.message.action || dropped.message.type,
      error: err.message
    });
  }
}

/**
 * Flush queued messages after initialization completes
 * v1.6.4.15 - FIX Issue #14: Process queued messages
 * v1.6.3.10-v11 - FIX Issue #6: Also retry dropped messages
 */
async function _flushInitializationMessageQueue() {
  // v1.6.3.10-v11 - FIX Issue #6: First retry dropped messages
  await _retryDroppedMessages();
  
  if (initializationMessageQueue.length === 0) return;
  
  console.log('[MSG][Content] FLUSHING_INIT_MESSAGE_QUEUE:', {
    queueSize: initializationMessageQueue.length
  });
  
  // v1.6.3.10-v11 - FIX Issue #7: Log queue state at thresholds
  _logQueueStateWarnings();
  
  await _processQueuedMessages();
}

/**
 * Retry all dropped messages
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * @private
 */
async function _retryDroppedMessages() {
  if (droppedMessageBuffer.length === 0) return;
  
  console.log('[MSG][Content] RETRYING_DROPPED_MESSAGES:', {
    count: droppedMessageBuffer.length
  });
  
  while (droppedMessageBuffer.length > 0) {
    const dropped = droppedMessageBuffer.shift();
    await _retryDroppedMessage(dropped);
  }
}

/**
 * Log warnings if queue depth exceeds thresholds
 * v1.6.3.10-v11 - FIX Issue #7: Extracted to reduce complexity
 * @private
 */
function _logQueueStateWarnings() {
  const size = initializationMessageQueue.length;
  // Check thresholds in descending order to log most severe first
  if (size >= 1000) {
    console.error('[MSG][Content] QUEUE_STATE_CRITICAL: Queue depth exceeds 1000 items', { queueSize: size });
  } else if (size >= 500) {
    console.warn('[MSG][Content] QUEUE_STATE_WARNING: Queue depth exceeds 500 items', { queueSize: size });
  } else if (size >= 100) {
    console.warn('[MSG][Content] QUEUE_STATE_WARNING: Queue depth exceeds 100 items', { queueSize: size });
  }
}

/**
 * Process all queued messages
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * @private
 */
async function _processQueuedMessages() {
  while (initializationMessageQueue.length > 0) {
    const { message, callback, queuedAt } = initializationMessageQueue.shift();
    const queueDuration = Date.now() - queuedAt;
    
    try {
      const result = await callback(message);
      console.log('[MSG][Content] QUEUED_MESSAGE_SENT:', {
        action: message.action || message.type,
        queueDurationMs: queueDuration,
        success: result?.success ?? true
      });
    } catch (err) {
      console.error('[MSG][Content] QUEUED_MESSAGE_FAILED:', {
        action: message.action || message.type,
        error: err.message,
        queueDurationMs: queueDuration
      });
    }
  }
}

/**
 * Check if background is responsive based on last response time
 * v1.6.4.15 - FIX Issue #14: Timeout-based fallback
 * @returns {boolean} True if background is responsive
 */
function _isBackgroundResponsive() {
  const timeSinceLastResponse = Date.now() - lastBackgroundResponseTime;
  return timeSinceLastResponse < BACKGROUND_UNRESPONSIVE_TIMEOUT_MS;
}

/**
 * Update last background response time
 * v1.6.4.15 - FIX Issue #14
 */
function _updateBackgroundResponseTime() {
  lastBackgroundResponseTime = Date.now();
}

/**
 * Mark content script as initialized and flush queued messages
 * v1.6.4.15 - FIX Issue #14
 */
async function _markContentScriptInitialized() {
  if (contentScriptInitialized) return;
  
  contentScriptInitialized = true;
  console.log('[MSG][Content] INITIALIZATION_COMPLETE:', {
    timestamp: new Date().toISOString()
  });
  
  // Flush any queued messages
  await _flushInitializationMessageQueue();
}

// ==================== v1.6.3.10-v11 FIX ISSUE #15: HYDRATION GATING ====================
// Prevent operations from running before state is hydrated from storage

/**
 * Mark hydration as complete and drain the operation queue
 * v1.6.3.10-v11 - FIX Issue #15: Signal hydration complete
 * @param {number} [loadedTabCount=0] - Number of tabs loaded from storage
 */
async function _markHydrationComplete(loadedTabCount = 0) {
  if (isHydrationComplete) return;
  
  isHydrationComplete = true;
  console.log('[Content] HYDRATION_COMPLETE:', {
    loadedTabCount,
    queuedOperations: preHydrationOperationQueue.length,
    timestamp: Date.now()
  });
  
  // Drain queued operations
  await _drainPreHydrationQueue();
}

/**
 * Queue an operation that arrived before hydration completed
 * v1.6.3.10-v11 - FIX Issue #15: Buffer operations during hydration
 * @param {Object} operation - Operation to queue
 * @param {string} operation.type - Operation type
 * @param {Object} operation.data - Operation data
 * @param {Function} [operation.callback] - Callback to execute when operation is processed
 */
function _queuePreHydrationOperation(operation) {
  preHydrationOperationQueue.push({
    ...operation,
    queuedAt: Date.now()
  });
  
  console.log('[Content] OPERATION_QUEUED_DURING_HYDRATION:', {
    operationType: operation.type,
    queueSize: preHydrationOperationQueue.length,
    quickTabId: operation.data?.id || operation.data?.quickTabId
  });
}

/**
 * Execute a single queued operation callback
 * v1.6.3.10-v11 - FIX Code Health: Extracted to reduce nesting depth
 * @private
 * @param {Object} operation - Operation from queue
 * @param {number} queueDuration - Time spent in queue
 */
async function _executeQueuedOperation(operation, queueDuration) {
  console.log('[Content] PROCESSING_QUEUED_OPERATION:', {
    operationType: operation.type,
    queueDurationMs: queueDuration
  });
  
  try {
    if (typeof operation.callback === 'function') {
      await operation.callback(operation.data);
    }
  } catch (err) {
    console.error('[Content] QUEUED_OPERATION_FAILED:', {
      operationType: operation.type,
      error: err.message
    });
  }
}

/**
 * Drain the pre-hydration operation queue
 * v1.6.3.10-v11 - FIX Issue #15: Process queued operations after hydration
 * @private
 */
async function _drainPreHydrationQueue() {
  if (preHydrationOperationQueue.length === 0) return;
  
  console.log('[Content] DRAINING_PRE_HYDRATION_QUEUE:', {
    queueSize: preHydrationOperationQueue.length
  });
  
  while (preHydrationOperationQueue.length > 0) {
    const operation = preHydrationOperationQueue.shift();
    const queueDuration = Date.now() - operation.queuedAt;
    await _executeQueuedOperation(operation, queueDuration);
  }
}

/**
 * Check if operation should wait for hydration
 * v1.6.3.10-v11 - FIX Issue #15: Gate operations until hydration complete
 * @param {string} operationType - Type of operation
 * @returns {boolean} True if operation should be queued, false if it can proceed
 */
function _shouldWaitForHydration(operationType) {
  // If hydration is already complete, no need to wait
  if (isHydrationComplete) {
    return false;
  }
  
  // Operations that should wait for hydration
  const hydrationBlockedOperations = new Set([
    'CREATE_QUICK_TAB',
    'RESTORE_QUICK_TAB',
    'UPDATE_QUICK_TAB_POSITION',
    'UPDATE_QUICK_TAB_SIZE'
  ]);
  
  return hydrationBlockedOperations.has(operationType);
}

/**
 * Initialize hydration timeout safety
 * v1.6.3.10-v11 - FIX Issue #15: If hydration doesn't complete within timeout, proceed anyway
 */
function _initHydrationTimeout() {
  setTimeout(() => {
    if (!isHydrationComplete) {
      console.warn('[Content] HYDRATION_TIMEOUT: Forcing hydration complete after timeout', {
        timeoutMs: HYDRATION_TIMEOUT_MS,
        queuedOperations: preHydrationOperationQueue.length
      });
      _markHydrationComplete(0);
    }
  }, HYDRATION_TIMEOUT_MS);
}

// ==================== END HYDRATION GATING ====================

/**
 * Check if an error response is retryable
 * v1.6.3.10-v10 - FIX Code Review: Extracted to helper function
 * @private
 */
function _isRetryableResponse(response) {
  if (response?.retryable === true) return true;
  if (RETRYABLE_ERROR_CODES.has(response?.error)) return true;
  return false;
}

/**
 * Check if an error message indicates a retryable condition
 * v1.6.3.10-v10 - FIX Code Review: Extracted to helper function
 * v1.6.4.15 - FIX Code Review: Use Set.forEach with short-circuit for O(1) average lookup
 * @private
 */
function _isRetryableError(message) {
  if (!message) return false;
  // RETRYABLE_MESSAGE_PATTERNS is now a Set
  for (const pattern of RETRYABLE_MESSAGE_PATTERNS) {
    if (message.includes(pattern)) return true;
  }
  return false;
}

/**
 * Extract tab ID from response, supporting both v1 and v2 formats
 * v1.6.4.15 - FIX Code Health: Extracted to reduce nesting depth
 * @private
 * @param {Object} response - Response from GET_CURRENT_TAB_ID
 * @returns {{found: boolean, tabId?: number, format?: string}}
 */
function _extractTabIdFromResponse(response) {
  if (!response?.success) {
    return { found: false };
  }
  
  // v1.6.4.15 - Support both new format (data.currentTabId) and old format (tabId)
  const tabId = response.data?.currentTabId ?? response.tabId;
  if (typeof tabId !== 'number') {
    return { found: false };
  }
  
  const format = response.data ? 'v2 (data.currentTabId)' : 'v1 (tabId)';
  return { found: true, tabId, format };
}

/**
 * Single attempt to get tab ID from background
 * v1.6.3.10-v10 - FIX Issue #5: Extracted to support retry logic
 * v1.6.4.15 - FIX Issue #15: Check response.success and response.data
 * @private
 * @param {number} attemptNumber - Current attempt number (1-based)
 * @returns {Promise<{tabId: number|null, error: string|null, retryable: boolean}>}
 */
async function _attemptGetTabIdFromBackground(attemptNumber) {
  const startTime = Date.now();
  
  try {
    const response = await browser.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' });
    const duration = Date.now() - startTime;

    // v1.6.3.10-v12 - FIX Issue #8: Update generation ID from response for restart detection
    if (response?.generation) {
      _updateBackgroundGenerationFromResponse(response.generation);
    }

    // v1.6.4.15 - FIX Issue #15: Check response.success first
    // v1.6.4.15 - FIX Code Health: Extract tabId handling to avoid nested depth
    const tabIdResult = _extractTabIdFromResponse(response);
    if (tabIdResult.found) {
      console.log('[Content][TabID][INIT] ATTEMPT_SUCCESS:', {
        attempt: attemptNumber,
        tabId: tabIdResult.tabId,
        responseFormat: tabIdResult.format,
        generation: response?.generation,
        durationMs: duration
      });
      return { tabId: tabIdResult.tabId, error: null, retryable: false };
    }

    // Check if error is retryable (background not initialized yet)
    const isRetryable = _isRetryableResponse(response);

    console.warn('[Content][TabID][INIT] ATTEMPT_FAILED:', {
      attempt: attemptNumber,
      response,
      error: response?.error,
      code: response?.code, // v1.6.4.15 - Log error code
      generation: response?.generation,
      retryable: isRetryable,
      durationMs: duration
    });

    return { 
      tabId: null, 
      error: response?.error || 'Invalid response from background',
      retryable: isRetryable
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    
    // Network/messaging errors are usually retryable
    const isRetryable = _isRetryableError(err.message);

    console.error('[Content][TabID][INIT] ATTEMPT_ERROR:', {
      attempt: attemptNumber,
      error: err.message,
      retryable: isRetryable,
      durationMs: duration
    });

    return { 
      tabId: null, 
      error: err.message,
      retryable: isRetryable
    };
  }
}

/**
 * Notify pending tab ID acquisition of background readiness
 * v1.6.3.10-v11 - FIX Issue #1: Event-driven retry trigger
 */
function _notifyBackgroundReadiness() {
  if (tabIdAcquisitionPending && tabIdAcquisitionResolver) {
    console.log('[Content][TabID] BACKGROUND_READINESS_DETECTED: Triggering pending acquisition');
    backgroundReadinessDetected = true;
    // Resolver will be called by the extended retry loop
  }
}

/**
 * Extended retry loop for tab ID acquisition after initial backoff exhaustion
 * v1.6.3.10-v11 - FIX Issue #1: Background initialization retry loop with 60s total timeout
 * @param {number} overallStartTime - Original start time
 * @param {Object} _lastResult - Last retry result (unused, kept for API compatibility)
 * @returns {Promise<number|null>} Tab ID or null
 * @private
 */
async function _extendedTabIdRetryLoop(overallStartTime, _lastResult) {
  let extendedAttempt = 0;
  
  console.log('[Content][TabID][EXTENDED] STARTING: Extended retry loop for background initialization', {
    intervalMs: TAB_ID_EXTENDED_RETRY_INTERVAL_MS,
    maxAttempts: TAB_ID_EXTENDED_RETRY_MAX_ATTEMPTS,
    totalTimeoutMs: TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS,
    elapsedSoFar: Date.now() - overallStartTime
  });
  
  tabIdAcquisitionPending = true;
  
  while (extendedAttempt < TAB_ID_EXTENDED_RETRY_MAX_ATTEMPTS) {
    const totalElapsed = Date.now() - overallStartTime;
    
    // Check total timeout
    if (totalElapsed >= TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS) {
      console.error('[Content][TabID][EXTENDED] TIMEOUT: Extended retry timeout exceeded', {
        totalElapsedMs: totalElapsed,
        timeoutMs: TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS
      });
      break;
    }
    
    // Check if background readiness was signaled
    if (backgroundReadinessDetected) {
      console.log('[Content][TabID][EXTENDED] BACKGROUND_READY: Attempting immediate retry');
      backgroundReadinessDetected = false;
    }
    
    extendedAttempt++;
    const attemptNumber = TAB_ID_MAX_RETRIES + 1 + extendedAttempt;
    
    console.log(`[Content][TabID][EXTENDED] Retry #${extendedAttempt} with delay ${TAB_ID_EXTENDED_RETRY_INTERVAL_MS}ms, elapsed ${totalElapsed}ms`);
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, TAB_ID_EXTENDED_RETRY_INTERVAL_MS));
    
    // Retry attempt
    const result = await _attemptGetTabIdFromBackground(attemptNumber);
    
    if (result.tabId !== null) {
      tabIdAcquisitionPending = false;
      console.log('[Content][TabID][EXTENDED] RECOVERY_SUCCESS: Tab ID acquired in extended loop', {
        tabId: result.tabId,
        extendedAttempt,
        totalElapsedMs: Date.now() - overallStartTime
      });
      return result.tabId;
    }
    
    // If not retryable, stop
    if (!result.retryable) {
      console.warn('[Content][TabID][EXTENDED] NON_RETRYABLE: Stopping extended retry', {
        error: result.error,
        extendedAttempt
      });
      break;
    }
  }
  
  tabIdAcquisitionPending = false;
  console.error(`[Content][TabID][EXTENDED] Tab ID acquisition exhausted all ${TAB_ID_MAX_RETRIES + 1 + extendedAttempt} retries after ${Date.now() - overallStartTime}ms, final result: null`);
  
  return null;
}

/**
 * Get current tab ID from background script with exponential backoff retry
 * v1.6.3.5-v10 - FIX Issue #3: Content scripts cannot use browser.tabs.getCurrent()
 * Must send message to background script which has access to sender.tab.id
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #1: Add validation logging
 * v1.6.3.10-v10 - FIX Issue #5: Implement exponential backoff retry loop
 * v1.6.3.10-v11 - FIX Issue #1: Extended retry with event-driven recovery
 *
 * Retry delays: 200ms, 500ms, 1500ms, 5000ms (initial phase)
 * Extended retry: 5s intervals for 40s after initial exhaustion
 * Total timeout: 60 seconds
 *
 * @returns {Promise<number|null>} Current tab ID or null if all retries exhausted
 */
async function getCurrentTabIdFromBackground() {
  console.log('[Content][TabID][INIT] BEGIN: Starting tab ID acquisition with retry', {
    maxRetries: TAB_ID_MAX_RETRIES,
    retryDelays: TAB_ID_RETRY_DELAYS_MS,
    extendedRetryEnabled: true,
    timestamp: new Date().toISOString()
  });
  
  const overallStartTime = Date.now();
  
  // Initial attempt (attempt #1)
  let result = await _attemptGetTabIdFromBackground(1);
  
  if (result.tabId !== null) {
    console.log('[Content][TabID][INIT] COMPLETE: Tab ID acquired on first attempt', {
      tabId: result.tabId,
      totalDurationMs: Date.now() - overallStartTime
    });
    return result.tabId;
  }
  
  // Retry loop with exponential backoff
  for (let retryIndex = 0; retryIndex < TAB_ID_MAX_RETRIES; retryIndex++) {
    const attemptNumber = retryIndex + 2; // First retry is attempt #2
    const delayMs = TAB_ID_RETRY_DELAYS_MS[retryIndex];
    
    // Only retry if the error was retryable
    if (!result.retryable) {
      console.warn('[Content][TabID][INIT] ABORT: Error is not retryable', {
        lastError: result.error,
        attemptsTried: attemptNumber - 1,
        totalDurationMs: Date.now() - overallStartTime
      });
      // v1.6.3.10-v11 - Non-retryable errors skip extended loop
      return null;
    }
    
    console.log(`[Content][TabID][INIT] Retry #${retryIndex + 1} with delay ${delayMs}ms, elapsed ${Date.now() - overallStartTime}ms`);
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    // Retry attempt
    result = await _attemptGetTabIdFromBackground(attemptNumber);
    
    if (result.tabId !== null) {
      console.log('[Content][TabID][INIT] COMPLETE: Tab ID acquired on retry', {
        tabId: result.tabId,
        attemptNumber,
        totalDurationMs: Date.now() - overallStartTime
      });
      return result.tabId;
    }
  }
  
  // Initial retries exhausted - log exhaustion
  const initialPhaseDuration = Date.now() - overallStartTime;
  console.error(`[Content][TabID][INIT] Tab ID acquisition exhausted all ${TAB_ID_MAX_RETRIES + 1} retries after ${initialPhaseDuration}ms, final result: null`);
  
  // v1.6.3.10-v11 - FIX Issue #1: Enter extended retry loop for background initialization
  if (result.retryable) {
    console.log('[Content][TabID][INIT] ENTERING_EXTENDED_RETRY: Background may still be initializing', {
      lastError: result.error,
      initialPhaseDurationMs: initialPhaseDuration
    });
    return _extendedTabIdRetryLoop(overallStartTime, result);
  }
  
  return null;
}

// ==================== v1.6.3.6-v11 PORT CONNECTION ====================
// FIX Issue #11: Persistent port connection to background script
// FIX Issue #12: Port lifecycle logging
// FIX Issue #17: Port cleanup on tab close
// v1.6.3.10-v4 - FIX Issue #3/6: Background restart detection
// v1.6.3.10-v7 - FIX Issue #1: Circuit breaker for port reconnection
// v1.6.3.10-v7 - FIX Issue #2: Background handshake ready signal
// v1.6.3.10-v7 - FIX Issue #4: Port message ordering
// v1.6.3.10-v7 - FIX Issue #5: Port message queueing during backoff

/**
 * Port connection to background script
 * v1.6.3.6-v11 - FIX Issue #11: Persistent connection
 */
let backgroundPort = null;

/**
 * Current tab ID cached after background connection
 * v1.6.3.6-v11 - Used for port name and logging
 */
let cachedTabId = null;

/**
 * v1.6.3.10-v4 - FIX Issue #3/6: Track last known background startup time for restart detection
 */
let lastKnownBackgroundStartupTime = null;

// ==================== v1.6.3.10-v7 CIRCUIT BREAKER ====================
// FIX Issue #1: Circuit breaker state machine for port reconnection

/**
 * Circuit breaker states for port connection
 * v1.6.3.10-v7 - FIX Issue #1: Circuit breaker state machine
 * v1.6.3.10-v11 - FIX Issue #24: Added READY state for three-phase handshake
 */
const PORT_CONNECTION_STATE = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  READY: 'READY',           // v1.6.3.10-v11 - FIX Issue #24: Handshake complete
  FAILED: 'FAILED'
};

// v1.6.3.10-v11 - FIX Issue #24: Three-phase handshake states
const HANDSHAKE_PHASE = {
  NONE: 'NONE',
  INIT_REQUEST_SENT: 'INIT_REQUEST_SENT',
  INIT_RESPONSE_RECEIVED: 'INIT_RESPONSE_RECEIVED',
  INIT_COMPLETE_SENT: 'INIT_COMPLETE_SENT'
};

/**
 * Current handshake phase
 * v1.6.3.10-v11 - FIX Issue #24
 */
let currentHandshakePhase = HANDSHAKE_PHASE.NONE;

/**
 * Timeout for each handshake phase (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #24: 2 seconds per phase
 */
const HANDSHAKE_PHASE_TIMEOUT_MS = 2000;

/**
 * Handshake timeout ID
 * v1.6.3.10-v11 - FIX Issue #24
 */
let handshakeTimeoutId = null;

/**
 * Current circuit breaker state
 * v1.6.3.10-v7 - FIX Issue #1
 */
let portConnectionState = PORT_CONNECTION_STATE.DISCONNECTED;

/**
 * Maximum consecutive failures before circuit breaker opens
 * v1.6.3.10-v7 - FIX Issue #1
 */
const CIRCUIT_BREAKER_MAX_FAILURES = 5;

/**
 * Grace period after successful reconnect (ms)
 * v1.6.3.10-v7 - FIX Issue #1
 */
const RECONNECT_GRACE_PERIOD_MS = 5000;

/**
 * Timestamp when grace period started
 * v1.6.3.10-v7 - FIX Issue #1
 */
let reconnectGracePeriodStart = null;

// ==================== v1.6.3.10-v7 BACKGROUND READY SIGNAL ====================
// FIX Issue #2: Track background readiness state

/**
 * Whether background is ready to receive commands
 * v1.6.3.10-v7 - FIX Issue #2: Ready signal tracking
 */
let isBackgroundReady = false;

/**
 * Command buffer for messages sent before background ready
 * v1.6.3.10-v7 - FIX Issue #2
 */
const pendingCommandsBuffer = [];

/**
 * Maximum pending commands buffer size
 * v1.6.3.10-v7 - FIX Issue #2
 */
const MAX_PENDING_COMMANDS = 50;

/**
 * Timestamp when handshake request was sent
 * v1.6.3.10-v7 - FIX Issue #2: Latency tracking
 */
let handshakeRequestTimestamp = null;

/**
 * Last known background handshake roundtrip latency (ms)
 * v1.6.3.10-v7 - FIX Issue #3: Adaptive dedup window
 */
let lastKnownBackgroundLatencyMs = null;

// ==================== v1.6.3.10-v7 PORT MESSAGE ORDERING ====================
// FIX Issue #4: Message sequence tracking

/**
 * Monotonic sequence counter for outgoing messages
 * v1.6.3.10-v7 - FIX Issue #4
 */
let outgoingSequenceId = 0;

/**
 * Last received sequence ID for ordering validation
 * v1.6.3.10-v7 - FIX Issue #4
 */
let lastReceivedSequenceId = 0;

// ==================== v1.6.3.10-v7 MESSAGE QUEUE ====================
// FIX Issue #5: Queue messages during port reconnection

/**
 * Message queue for messages sent while port is unavailable
 * v1.6.3.10-v7 - FIX Issue #5
 */
const messageQueue = [];

/**
 * Maximum message queue size
 * v1.6.3.10-v7 - FIX Issue #5
 */
const MAX_MESSAGE_QUEUE_SIZE = 50;

// v1.6.3.10-v11 - FIX Issue #23: Removed duplicate messageIdCounter (now declared earlier in heartbeat section)

// ==================== v1.6.3.10-v5 PORT RECONNECTION BACKOFF ====================
// FIX Issue #4: Exponential backoff with jitter to prevent thundering herd

/**
 * Reconnection attempt counter for exponential backoff
 * v1.6.3.10-v5 - FIX Issue #4: Track attempts for backoff calculation
 */
let reconnectionAttempts = 0;

/**
 * Initial reconnection delay (milliseconds)
 * v1.6.3.10-v5 - FIX Issue #4: Start with 150ms (midpoint of 100-200ms range)
 */
const INITIAL_RECONNECT_DELAY_MS = 150;

/**
 * Maximum reconnection delay (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #1: Increased from 8s to 30s
 */
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * Backoff multiplier per retry
 * v1.6.3.10-v5 - FIX Issue #4: Multiply delay by 1.5x per attempt
 */
const RECONNECT_BACKOFF_MULTIPLIER = 1.5;

/**
 * Jitter range (±20% randomization)
 * v1.6.3.10-v5 - FIX Issue #4: Spread reconnections to avoid thundering herd
 */
const RECONNECT_JITTER_RANGE = 0.2;

/**
 * Calculate reconnection delay with exponential backoff and jitter
 * v1.6.3.10-v5 - FIX Issue #4: Prevent thundering herd effect
 * @returns {number} Delay in milliseconds
 */
function _calculateReconnectDelay() {
  // Exponential backoff: initialDelay * multiplier^attempts
  const baseDelay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, reconnectionAttempts),
    MAX_RECONNECT_DELAY_MS
  );

  // Add jitter (±20% randomization)
  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER_RANGE;
  const delayWithJitter = Math.round(baseDelay * jitterMultiplier);

  return Math.max(INITIAL_RECONNECT_DELAY_MS, Math.min(delayWithJitter, MAX_RECONNECT_DELAY_MS));
}

/**
 * Transition circuit breaker state with logging
 * v1.6.3.10-v7 - FIX Issue #1: Circuit breaker state transitions
 * @param {string} newState - New state to transition to
 * @param {string} reason - Reason for transition
 */
function _transitionPortState(newState, reason) {
  const oldState = portConnectionState;
  portConnectionState = newState;
  console.log('[Content] PORT_STATE_TRANSITION:', {
    from: oldState,
    to: newState,
    reason,
    attempts: reconnectionAttempts,
    timestamp: Date.now()
  });
}

/**
 * Check if circuit breaker should open (enter FAILED state)
 * v1.6.3.10-v7 - FIX Issue #1
 * @returns {boolean} True if should enter FAILED state
 */
function _shouldOpenCircuitBreaker() {
  return reconnectionAttempts >= CIRCUIT_BREAKER_MAX_FAILURES;
}

/**
 * Check if still in reconnect grace period
 * v1.6.3.10-v7 - FIX Issue #1
 * @returns {boolean} True if in grace period
 */
function _isInGracePeriod() {
  if (!reconnectGracePeriodStart) return false;
  return Date.now() - reconnectGracePeriodStart < RECONNECT_GRACE_PERIOD_MS;
}

/**
 * Reset reconnection attempt counter after successful connection
 * v1.6.3.10-v5 - FIX Issue #4: Reset backoff on success
 * v1.6.3.10-v7 - FIX Issue #1: Also start grace period
 */
function _resetReconnectionAttempts() {
  if (reconnectionAttempts > 0) {
    console.log('[Content] v1.6.3.10-v7 Reconnection successful, resetting attempt count from:', reconnectionAttempts);
    reconnectionAttempts = 0;
  }
  // Start grace period
  reconnectGracePeriodStart = Date.now();
  _transitionPortState(PORT_CONNECTION_STATE.CONNECTED, 'connection-established');
}

// ==================== v1.6.3.10-v11 FIX ISSUE #24: THREE-PHASE HANDSHAKE ====================

/**
 * Start the three-phase handshake process
 * v1.6.3.10-v11 - FIX Issue #24: Phase 1: Send INIT_REQUEST
 * @param {Object} port - The port connection
 */
function _startThreePhaseHandshake(port) {
  if (!port) {
    console.warn('[Content][HANDSHAKE] Cannot start - port is null');
    return;
  }
  
  // Phase 1: Send INIT_REQUEST
  currentHandshakePhase = HANDSHAKE_PHASE.INIT_REQUEST_SENT;
  
  console.log('[Content][HANDSHAKE] Phase 1: INIT_REQUEST sent', {
    phase: currentHandshakePhase,
    portName: port.name,
    timestamp: Date.now()
  });
  
  port.postMessage({
    type: 'INIT_REQUEST',
    timestamp: Date.now(),
    tabId: cachedTabId,
    phase: 1
  });
  
  // Set timeout for Phase 1
  _setHandshakeTimeout('INIT_REQUEST', () => {
    console.error('[Content][HANDSHAKE] Phase 1 timeout: No INIT_RESPONSE received');
    _handleHandshakeFailure('Phase 1 timeout');
  });
}

/**
 * Handle INIT_RESPONSE from background (Phase 2)
 * v1.6.3.10-v11 - FIX Issue #24
 * @param {Object} message - Response message
 * @param {Object} port - The port connection
 */
function _handleInitResponse(message, port) {
  if (currentHandshakePhase !== HANDSHAKE_PHASE.INIT_REQUEST_SENT) {
    console.warn('[Content][HANDSHAKE] Unexpected INIT_RESPONSE in phase:', currentHandshakePhase);
    return;
  }
  
  // Clear Phase 1 timeout
  _clearHandshakeTimeout();
  
  currentHandshakePhase = HANDSHAKE_PHASE.INIT_RESPONSE_RECEIVED;
  
  console.log('[Content][HANDSHAKE] Phase 2: INIT_RESPONSE received', {
    phase: currentHandshakePhase,
    backgroundGeneration: message.generation,
    timestamp: Date.now()
  });
  
  // Phase 3: Send INIT_COMPLETE
  currentHandshakePhase = HANDSHAKE_PHASE.INIT_COMPLETE_SENT;
  
  port.postMessage({
    type: 'INIT_COMPLETE',
    timestamp: Date.now(),
    tabId: cachedTabId,
    acknowledgedGeneration: message.generation,
    phase: 3
  });
  
  console.log('[Content][HANDSHAKE] Phase 3: INIT_COMPLETE sent', {
    phase: currentHandshakePhase,
    timestamp: Date.now()
  });
  
  // Set timeout for Phase 3 confirmation
  _setHandshakeTimeout('INIT_COMPLETE', () => {
    // If no explicit confirmation, assume success after timeout
    console.log('[Content][HANDSHAKE] Phase 3 timeout - assuming handshake complete');
    _completeHandshake();
  });
}

/**
 * Complete the handshake and transition to READY state
 * v1.6.3.10-v11 - FIX Issue #24
 */
function _completeHandshake() {
  _clearHandshakeTimeout();
  currentHandshakePhase = HANDSHAKE_PHASE.NONE;
  
  _transitionPortState(PORT_CONNECTION_STATE.READY, 'handshake-complete');
  
  console.log('[Content][HANDSHAKE] COMPLETE: Connection ready', {
    portState: portConnectionState,
    timestamp: Date.now()
  });
}

/**
 * Handle handshake failure
 * v1.6.3.10-v11 - FIX Issue #24
 * @param {string} reason - Failure reason
 */
function _handleHandshakeFailure(reason) {
  _clearHandshakeTimeout();
  currentHandshakePhase = HANDSHAKE_PHASE.NONE;
  
  console.error('[Content][HANDSHAKE] FAILED:', {
    reason,
    willRetry: reconnectionAttempts < CIRCUIT_BREAKER_MAX_FAILURES,
    attempts: reconnectionAttempts
  });
  
  // Increment failure count and try reconnection
  if (cachedTabId) {
    _handleReconnection(cachedTabId, `handshake-${reason}`);
  }
}

/**
 * Set handshake phase timeout
 * v1.6.3.10-v11 - FIX Issue #24
 * @param {string} phase - Current phase name
 * @param {Function} callback - Callback on timeout
 */
function _setHandshakeTimeout(phase, callback) {
  _clearHandshakeTimeout();
  
  handshakeTimeoutId = setTimeout(() => {
    handshakeTimeoutId = null;
    callback();
  }, HANDSHAKE_PHASE_TIMEOUT_MS);
  
  console.log('[Content][HANDSHAKE] Timeout set for phase:', {
    phase,
    timeoutMs: HANDSHAKE_PHASE_TIMEOUT_MS
  });
}

/**
 * Clear handshake timeout
 * v1.6.3.10-v11 - FIX Issue #24
 */
function _clearHandshakeTimeout() {
  if (handshakeTimeoutId) {
    clearTimeout(handshakeTimeoutId);
    handshakeTimeoutId = null;
  }
}

// ==================== END ISSUE #24 FIX ====================

/**
 * Get next sequence ID for outgoing messages
 * v1.6.3.10-v7 - FIX Issue #4: Monotonic sequence counter
 * @returns {number} Next sequence ID
 */
function _getNextSequenceId() {
  return ++outgoingSequenceId;
}

/**
 * Validate incoming message sequence
 * v1.6.3.10-v7 - FIX Issue #4: Detect out-of-order messages
 * @param {number} sequenceId - Received sequence ID
 * @returns {boolean} True if in order
 */
function _validateMessageSequence(sequenceId) {
  if (typeof sequenceId !== 'number') return true; // Skip validation if no sequence
  
  if (sequenceId <= lastReceivedSequenceId) {
    console.warn('[Content] MESSAGE_ORDER_VIOLATION: Received out-of-order message:', {
      received: sequenceId,
      lastReceived: lastReceivedSequenceId,
      timestamp: Date.now()
    });
    return false;
  }
  
  lastReceivedSequenceId = sequenceId;
  return true;
}

// ==================== v1.6.3.10-v10 RESTORE MESSAGE ORDERING ====================
// FIX Issue R: Enforce ordering for storage-dependent RESTORE operations

/**
 * Track in-progress RESTORE operations to enforce ordering
 * v1.6.3.10-v10 - FIX Issue R: Map of quickTabId -> { sequenceId, timestamp, status }
 */
const pendingRestoreOperations = new Map();

/**
 * Maximum age for pending RESTORE tracking (ms)
 * v1.6.3.10-v10 - FIX Issue R: Clear stale entries after 10s
 */
const RESTORE_TRACKING_MAX_AGE_MS = 10000;

/**
 * Counter for RESTORE operation sequence
 * v1.6.3.10-v10 - FIX Issue R: Monotonic counter for ordering
 */
let restoreSequenceCounter = 0;

/**
 * Cleanup stale pending restore entries
 * v1.6.3.10-v10 - FIX Issue R: Extracted to reduce _checkRestoreOrderingEnforcement complexity
 * @private
 */
function _cleanupStaleRestoreEntries(now) {
  for (const [id, entry] of pendingRestoreOperations.entries()) {
    if (now - entry.timestamp > RESTORE_TRACKING_MAX_AGE_MS) {
      pendingRestoreOperations.delete(id);
    }
  }
}

/**
 * Check if incoming restore should be rejected due to sequence ordering
 * v1.6.3.10-v10 - FIX Issue R: Extracted to reduce _checkRestoreOrderingEnforcement complexity
 * @private
 */
function _shouldRejectRestoreOrder(existingOp, messageSequenceId, details) {
  if (!existingOp || existingOp.status !== 'pending') return false;
  if (messageSequenceId === undefined || existingOp.sequenceId === undefined) return false;
  
  if (messageSequenceId < existingOp.sequenceId) {
    console.warn('[Content] v1.6.3.10-v10 RESTORE_ORDER_REJECTED:', {
      ...details, reason: 'out-of-order: newer operation already pending', action: 'rejected'
    });
    return true;
  }
  return false;
}

/**
 * Check if a RESTORE operation should be rejected due to ordering violation
 * v1.6.3.10-v10 - FIX Issue R: Enforce ordering for storage-dependent RESTORE operations
 * 
 * Out-of-order RESTORE messages are rejected to prevent ownership lookups from
 * resolving incorrectly during rapid tab switching (Scenario 17).
 * 
 * @param {string} quickTabId - Quick Tab ID being restored
 * @param {number|undefined} messageSequenceId - Sequence ID from message (if present)
 * @returns {{allowed: boolean, reason: string|null, details: Object}}
 */
function _checkRestoreOrderingEnforcement(quickTabId, messageSequenceId) {
  const now = Date.now();
  _cleanupStaleRestoreEntries(now);
  
  const existingOperation = pendingRestoreOperations.get(quickTabId);
  const effectiveSequence = messageSequenceId ?? ++restoreSequenceCounter;
  
  const details = {
    quickTabId,
    messageSequenceId,
    effectiveSequence,
    existingOperation: existingOperation ? {
      sequenceId: existingOperation.sequenceId,
      status: existingOperation.status,
      age: now - existingOperation.timestamp
    } : null,
    pendingCount: pendingRestoreOperations.size
  };
  
  // Check if should reject due to ordering
  if (_shouldRejectRestoreOrder(existingOperation, messageSequenceId, details)) {
    return { allowed: false, reason: 'out-of-order', details };
  }
  
  // Log if queued behind pending operation
  if (existingOperation && existingOperation.status === 'pending') {
    console.log('[Content] v1.6.3.10-v10 RESTORE_ORDER_QUEUED:', {
      ...details, reason: 'existing operation pending', action: 'will proceed after existing completes'
    });
  }
  
  // Track this operation
  pendingRestoreOperations.set(quickTabId, {
    sequenceId: effectiveSequence, timestamp: now, status: 'pending'
  });
  
  console.log('[Content] v1.6.3.10-v10 RESTORE_ORDER_ALLOWED:', details);
  return { allowed: true, reason: null, details };
}

/**
 * Mark a RESTORE operation as complete
 * v1.6.3.10-v10 - FIX Issue R: Update tracking after operation completes
 * @param {string} quickTabId - Quick Tab ID that was restored
 * @param {boolean} success - Whether operation succeeded
 */
function _markRestoreComplete(quickTabId, success) {
  const operation = pendingRestoreOperations.get(quickTabId);
  if (operation) {
    operation.status = success ? 'completed' : 'failed';
    console.log('[Content] v1.6.3.10-v10 RESTORE_COMPLETE:', {
      quickTabId, success, sequenceId: operation.sequenceId, duration: Date.now() - operation.timestamp
    });
  }
}

/**
 * Queue a message when port is unavailable
 * v1.6.3.10-v7 - FIX Issue #5: Message queueing
 * @param {Object} message - Message to queue
 * @returns {number} Message ID for tracking
 */
function _queueMessage(message) {
  const messageId = ++messageIdCounter;
  const queuedMessage = {
    messageId,
    message,
    queuedAt: Date.now(),
    retryCount: 0
  };
  
  if (messageQueue.length >= MAX_MESSAGE_QUEUE_SIZE) {
    const dropped = messageQueue.shift();
    console.warn('[Content] MESSAGE_QUEUE_OVERFLOW: Dropped oldest message:', {
      droppedId: dropped.messageId,
      droppedAge: Date.now() - dropped.queuedAt,
      queueSize: messageQueue.length
    });
  }
  
  messageQueue.push(queuedMessage);
  console.log('[Content] MESSAGE_QUEUED:', {
    messageId,
    type: message.type,
    queueSize: messageQueue.length
  });
  
  return messageId;
}

/**
 * Drain message queue after successful reconnect
 * v1.6.3.10-v7 - FIX Issue #5: Drain queued messages in order
 */
function _drainMessageQueue() {
  if (messageQueue.length === 0) return;
  
  console.log('[Content] DRAINING_MESSAGE_QUEUE:', {
    queueSize: messageQueue.length,
    timestamp: Date.now()
  });
  
  while (messageQueue.length > 0 && backgroundPort) {
    const queuedMessage = messageQueue.shift();
    queuedMessage.retryCount++;
    
    try {
      backgroundPort.postMessage(queuedMessage.message);
      console.log('[Content] QUEUE_MESSAGE_SENT:', {
        messageId: queuedMessage.messageId,
        queuedDuration: Date.now() - queuedMessage.queuedAt,
        retryCount: queuedMessage.retryCount
      });
    } catch (err) {
      console.error('[Content] QUEUE_MESSAGE_FAILED:', {
        messageId: queuedMessage.messageId,
        error: err.message
      });
      // Put back at front and stop draining if send fails
      messageQueue.unshift(queuedMessage);
      break;
    }
  }
}

/**
 * Buffer a command when background is not ready
 * v1.6.3.10-v7 - FIX Issue #2: Buffer commands until ready
 * @param {Object} command - Command to buffer
 */
function _bufferCommand(command) {
  if (pendingCommandsBuffer.length >= MAX_PENDING_COMMANDS) {
    const dropped = pendingCommandsBuffer.shift();
    console.warn('[Content] COMMAND_BUFFER_OVERFLOW: Dropped oldest command:', {
      droppedType: dropped.type,
      bufferSize: pendingCommandsBuffer.length
    });
  }
  
  pendingCommandsBuffer.push({
    ...command,
    bufferedAt: Date.now()
  });
  
  console.log('[Content] COMMAND_BUFFERED:', {
    type: command.type,
    bufferSize: pendingCommandsBuffer.length
  });
}

/**
 * Check if port is ready to receive commands
 * v1.6.3.10-v8 - FIX Code Health: Extracted complex conditional
 * @private
 */
function _canFlushCommands() {
  return pendingCommandsBuffer.length > 0 && backgroundPort && isBackgroundReady;
}

/**
 * Flush buffered commands after background becomes ready
 * v1.6.3.10-v7 - FIX Issue #2
 */
function _flushCommandBuffer() {
  if (pendingCommandsBuffer.length === 0) return;
  
  console.log('[Content] FLUSHING_COMMAND_BUFFER:', { bufferSize: pendingCommandsBuffer.length });
  
  while (_canFlushCommands()) {
    const command = pendingCommandsBuffer.shift();
    try {
      backgroundPort.postMessage(command);
      console.log('[Content] BUFFERED_COMMAND_SENT:', {
        type: command.type, bufferedDuration: Date.now() - command.bufferedAt
      });
    } catch (err) {
      console.error('[Content] BUFFERED_COMMAND_FAILED:', { type: command.type, error: err.message });
      pendingCommandsBuffer.unshift(command);
      break;
    }
  }
}

/**
 * Send a port message with queueing support
 * v1.6.3.10-v7 - FIX Issue #5: Queue if port unavailable
 * @param {Object} message - Message to send
 * @param {boolean} isCritical - Whether to add sequence ID
 * @returns {boolean} True if sent immediately, false if queued
 */
function _sendPortMessage(message, isCritical = false) {
  // Add sequence ID to critical messages
  if (isCritical) {
    message.sequenceId = _getNextSequenceId();
  }
  
  // Check if port is available and connected
  if (!backgroundPort || portConnectionState !== PORT_CONNECTION_STATE.CONNECTED) {
    _queueMessage(message);
    return false;
  }
  
  try {
    backgroundPort.postMessage(message);
    return true;
  } catch (err) {
    console.error('[Content] PORT_MESSAGE_FAILED:', {
      error: err.message,
      queueing: true
    });
    _queueMessage(message);
    return false;
  }
}

// ==================== END v1.6.3.10-v5 PORT RECONNECTION BACKOFF ====================

/**
 * Log port lifecycle event
 * v1.6.3.6-v11 - FIX Issue #12: Port lifecycle logging
 * @param {string} event - Event name
 * @param {Object} details - Event details
 */
function logContentPortLifecycle(event, details = {}) {
  console.log(`[Content] PORT_LIFECYCLE [content-tab-${cachedTabId || 'unknown'}] [${event}]:`, {
    tabId: cachedTabId,
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Handle background restart detection and state re-sync
 * v1.6.3.10-v4 - FIX Issue #3/6: Detect when background script was restarted
 * v1.6.3.10-v5 - FIX Diagnostic Issue #3: Add port operation timing instrumentation
 * @param {number} newStartupTime - New background startup time
 */
function handleBackgroundRestartDetected(newStartupTime) {
  const operationStart = Date.now();

  console.warn('[Content] v1.6.3.10-v4 BACKGROUND RESTART DETECTED:', {
    previousStartupTime: lastKnownBackgroundStartupTime,
    newStartupTime,
    tabId: cachedTabId
  });

  lastKnownBackgroundStartupTime = newStartupTime;

  // Request full state sync after background restart
  // v1.6.3.10-v7 - Use _sendPortMessage for consistent queueing
  const operationEnd = Date.now();
  const syncMessage = {
    type: 'REQUEST_FULL_STATE_SYNC',
    reason: 'background-restart-detected',
    tabId: cachedTabId,
    timestamp: Date.now()
  };
  
  const sent = _sendPortMessage(syncMessage, true);
  console.log('[Content] v1.6.3.10-v7 State sync request:', {
    sent,
    totalOperationMs: operationEnd - operationStart,
    tabId: cachedTabId
  });
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 * v1.6.3.10-v4 - FIX Issue #3/6: Handle background handshake for restart detection
 * v1.6.3.10-v5 - FIX Issue #4: Exponential backoff with jitter for reconnection
 * v1.6.3.10-v7 - FIX Issue #1: Circuit breaker integration
 * v1.6.3.10-v7 - FIX Issue #2: Handshake ready signal and latency tracking
 * v1.6.3.10-v7 - FIX Issue #5: Drain message queue on reconnect
 * @param {number} tabId - Current tab ID
 */
/**
 * Handle reconnection after disconnect or error
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 */
function _handleReconnection(tabId, reason) {
  reconnectionAttempts++;

  // Check circuit breaker
  if (_shouldOpenCircuitBreaker()) {
    _transitionPortState(PORT_CONNECTION_STATE.FAILED, 'max-failures-reached');
    console.error('[Content] CIRCUIT_BREAKER_OPEN:', { attempts: reconnectionAttempts });
    return;
  }

  const reconnectDelay = _calculateReconnectDelay();
  console.log('[Content] Scheduling reconnection:', { attempt: reconnectionAttempts, delayMs: reconnectDelay, reason });

  setTimeout(() => {
    if (!backgroundPort && document.visibilityState !== 'hidden') {
      connectContentToBackground(tabId);
    }
  }, reconnectDelay);
}

function connectContentToBackground(tabId) {
  cachedTabId = tabId;

  // v1.6.3.10-v7 - FIX Issue #1: Check circuit breaker state
  if (portConnectionState === PORT_CONNECTION_STATE.FAILED) {
    console.warn('[Content] CIRCUIT_BREAKER_OPEN: Refusing to reconnect', { attempts: reconnectionAttempts });
    return;
  }

  _transitionPortState(PORT_CONNECTION_STATE.CONNECTING, 'connect-attempt');
  handshakeRequestTimestamp = Date.now();
  isBackgroundReady = false;

  try {
    backgroundPort = browser.runtime.connect({ name: `quicktabs-content-${tabId}` });
    logContentPortLifecycle('open', { portName: backgroundPort.name });
    _resetReconnectionAttempts();
    _drainMessageQueue();

    backgroundPort.onMessage.addListener(handleContentPortMessage);

    backgroundPort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      logContentPortLifecycle('disconnect', { error: error?.message });
      backgroundPort = null;
      isBackgroundReady = false;
      _transitionPortState(PORT_CONNECTION_STATE.DISCONNECTED, 'port-disconnected');
      _handleReconnection(tabId, 'disconnect');
    });

    console.log('[Content] Port connection established');
  } catch (err) {
    console.error('[Content] Failed to connect:', err.message);
    logContentPortLifecycle('error', { error: err.message });
    _transitionPortState(PORT_CONNECTION_STATE.DISCONNECTED, 'connection-error');
    _handleReconnection(tabId, 'error');
  }
}

/**
 * Process startup time from background for restart detection
 * v1.6.3.10-v4 - FIX Issue #3/6: Helper to reduce nesting depth
 * @private
 * @param {number} startupTime - Background startup time
 */
function _processBackgroundStartupTime(startupTime) {
  // Use explicit null check - startupTime of 0 would be valid (though unlikely)
  if (startupTime == null) return;

  if (lastKnownBackgroundStartupTime === null) {
    // First connection - just record the startup time
    lastKnownBackgroundStartupTime = startupTime;
    console.log('[Content] v1.6.3.10-v4 Background startup time recorded:', startupTime);
    return;
  }

  if (startupTime !== lastKnownBackgroundStartupTime) {
    // Background was restarted - trigger re-sync
    handleBackgroundRestartDetected(startupTime);
  }
}

/**
 * Handle background handshake message
 * v1.6.3.10-v4 - FIX Issue #3/6: Helper to reduce nesting depth
 * v1.6.3.10-v7 - FIX Issue #2: Handle ready signal and track latency
 * v1.6.3.10-v7 - FIX Issue #3: Update adaptive dedup window based on latency
 * v1.6.3.10-v11 - FIX Issue #1: Notify pending tab ID acquisition of background readiness
 * @private
 * @param {Object} message - Handshake message
 */
function _handleBackgroundHandshake(message) {
  // v1.6.3.10-v7 - FIX Issue #2: Calculate handshake roundtrip latency
  const latencyMs = handshakeRequestTimestamp ? Date.now() - handshakeRequestTimestamp : null;
  
  console.log('[Content] v1.6.3.10-v7 Background handshake received:', {
    startupTime: message.startupTime,
    uptime: message.uptime,
    portId: message.portId,
    isReadyForCommands: message.isReadyForCommands,
    latencyMs,
    previousReadyState: isBackgroundReady
  });

  // v1.6.3.10-v7 - FIX Issue #3: Track latency for adaptive dedup window
  if (latencyMs !== null) {
    lastKnownBackgroundLatencyMs = latencyMs;
    
    // Log warning if latency exceeds 5s
    if (latencyMs > 5000) {
      console.warn('[Content] HIGH_HANDSHAKE_LATENCY: Background response took too long:', {
        latencyMs,
        threshold: 5000
      });
    }
  }

  // v1.6.3.10-v7 - FIX Issue #2: Update ready state
  // Note: Default to true for backward compatibility with background scripts that don't send this field.
  // This ensures existing installations continue working after upgrade.
  const wasReady = isBackgroundReady;
  const isNowReady = message.isReadyForCommands !== false; // Default to true if not specified
  isBackgroundReady = isNowReady;

  // Log state transition
  if (!wasReady && isNowReady) {
    console.log('[Content] BACKGROUND_READY: Transitioned from INITIALIZING to READY:', {
      latencyMs,
      timestamp: Date.now()
    });
    
    // v1.6.3.10-v7 - FIX Issue #2: Flush buffered commands
    _flushCommandBuffer();
    
    // v1.6.3.10-v11 - FIX Issue #1: Notify pending tab ID acquisition of background readiness
    console.log('[Content][TabID] BACKGROUND_READINESS_DETECTED: Background ready, resuming tab ID acquisition');
    _notifyBackgroundReadiness();
  } else if (wasReady && !isNowReady) {
    console.warn('[Content] BACKGROUND_NOT_READY: Transitioned from READY to INITIALIZING');
  }
}

/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #11: Process messages from background
 * v1.6.3.10-v4 - FIX Issue #3/6: Handle background handshake for restart detection
 * v1.6.3.10-v7 - FIX Issue #4: Validate message sequence ordering
 * @param {Object} message - Message from background
 */
function handleContentPortMessage(message) {
  logContentPortLifecycle('message', {
    type: message.type,
    action: message.action
  });

  // v1.6.3.10-v7 - FIX Issue #4: Validate message sequence if present
  if (message.sequenceId !== undefined) {
    _validateMessageSequence(message.sequenceId);
  }

  // v1.6.3.10-v4 - FIX Issue #3/6: Handle background handshake for restart detection
  if (message.type === 'BACKGROUND_HANDSHAKE' || message.type === 'HEARTBEAT_ACK') {
    _processBackgroundStartupTime(message.startupTime);

    // BACKGROUND_HANDSHAKE is informational only, don't need further processing
    if (message.type === 'BACKGROUND_HANDSHAKE') {
      _handleBackgroundHandshake(message);
      return;
    }
  }

  // Handle broadcasts
  if (message.type === 'BROADCAST') {
    handleContentBroadcast(message);
    return;
  }

  // Handle acknowledgments (if content script sends requests)
  if (message.type === 'ACKNOWLEDGMENT') {
    console.log('[Content] Received acknowledgment:', message.correlationId);
  }
}

/**
 * Handle broadcast messages from background
 * v1.6.3.6-v11 - FIX Issue #19: Handle visibility state sync
 * @param {Object} message - Broadcast message
 */
function handleContentBroadcast(message) {
  const { action } = message;

  switch (action) {
    case 'VISIBILITY_CHANGE':
      console.log('[Content] Received visibility change broadcast:', {
        quickTabId: message.quickTabId,
        changes: message.changes
      });
      // Quick Tabs manager will handle this via its own listeners
      break;

    case 'TAB_LIFECYCLE_CHANGE':
      console.log('[Content] Received tab lifecycle broadcast:', {
        event: message.event,
        tabId: message.tabId,
        affectedQuickTabs: message.affectedQuickTabs
      });
      break;

    default:
      console.log('[Content] Received broadcast:', message);
  }
}

// v1.6.3.6-v11 - FIX Issue #17: Port cleanup on window unload
window.addEventListener('unload', () => {
  if (backgroundPort) {
    logContentPortLifecycle('unload', { reason: 'window-unload' });
    backgroundPort.disconnect();
    backgroundPort = null;
  }
});

// ==================== END PORT CONNECTION ====================

/**
 * v1.6.0.3 - Helper to initialize Quick Tabs
 * v1.6.3.5-v10 - FIX Issue #3: Get tab ID from background before initializing Quick Tabs
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Set writing tab ID for storage ownership
 * v1.6.3.10-v6 - FIX Issue #4/11/12: Enhanced logging showing tab ID acquisition flow
 * v1.6.3.10-v10 - FIX Issue #6: Add [INIT] prefix boundary logging for initialization phases
 */
async function initializeQuickTabsFeature() {
  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging
  const initStartTime = Date.now();
  console.log('[INIT][Content] PHASE_START: Quick Tabs initialization beginning', {
    timestamp: new Date().toISOString(),
    isWritingTabIdInitialized: isWritingTabIdInitialized()
  });

  // v1.6.3.10-v6 - FIX Issue #4/11: Log before tab ID request
  console.log('[INIT][Content] TAB_ID_ACQUISITION_START:', {
    isWritingTabIdInitialized: isWritingTabIdInitialized(),
    timestamp: new Date().toISOString()
  });

  // v1.6.3.5-v10 - FIX Issue #3: Get tab ID FIRST from background script
  // This is critical for cross-tab scoping - Quick Tabs should only render
  // in the tab they were created in (originTabId must match currentTabId)
  const currentTabId = await getCurrentTabIdFromBackground();
  const tabIdAcquisitionDuration = Date.now() - initStartTime;

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for tab ID result
  console.log('[INIT][Content] TAB_ID_ACQUISITION_COMPLETE:', {
    currentTabId: currentTabId !== null ? currentTabId : 'FAILED',
    durationMs: tabIdAcquisitionDuration,
    success: currentTabId !== null,
    timestamp: new Date().toISOString()
  });

  // v1.6.3.10-v6 - FIX Issue #4/11: Log tab ID acquisition result
  console.log('[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_RESULT: Tab ID acquired', {
    currentTabId,
    source: 'background messaging (GET_CURRENT_TAB_ID)',
    success: currentTabId !== null
  });

  // v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Set writing tab ID for storage ownership
  // This is CRITICAL: content scripts cannot use browser.tabs.getCurrent(), so they must
  // explicitly set the tab ID for storage-utils to validate ownership during writes
  if (currentTabId !== null) {
    setWritingTabId(currentTabId);
    // v1.6.3.10-v6 - FIX Issue #12: Verify tab ID was set
    console.log('[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_COMPLETE: Writing tab ID set', {
      tabId: currentTabId,
      isWritingTabIdInitializedAfter: isWritingTabIdInitialized()
    });

    // v1.6.3.6-v11 - FIX Issue #11: Establish persistent port connection
    console.log('[INIT][Content] PORT_CONNECTION_START:', { tabId: currentTabId });
    connectContentToBackground(currentTabId);
    console.log('[INIT][Content] PORT_CONNECTION_INITIATED:', { tabId: currentTabId });
  } else {
    // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for failure
    console.error('[INIT][Content] TAB_ID_ACQUISITION_FAILED:', {
      timestamp: new Date().toISOString(),
      warning: 'Storage writes may fail ownership validation without tab ID'
    });
    console.warn(
      '[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_FAILED: Could not acquire tab ID from background'
    );
    console.warn(
      '[Copy-URL-on-Hover] WARNING: Storage writes may fail ownership validation without tab ID'
    );
  }

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for manager init
  console.log('[INIT][Content] QUICKTABS_MANAGER_INIT_START:', {
    currentTabId: currentTabId !== null ? currentTabId : 'NULL',
    timestamp: new Date().toISOString()
  });

  // Pass currentTabId as option so UICoordinator can filter by originTabId
  quickTabsManager = await initQuickTabs(eventBus, Events, { currentTabId });

  const initEndTime = Date.now();
  const totalInitDuration = initEndTime - initStartTime;

  if (quickTabsManager) {
    // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for completion
    console.log('[INIT][Content] PHASE_COMPLETE:', {
      success: true,
      currentTabId: currentTabId !== null ? currentTabId : 'NULL',
      totalDurationMs: totalInitDuration,
      hasManager: true,
      timestamp: new Date().toISOString()
    });
    console.log('[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized successfully');
    console.log(
      '[Copy-URL-on-Hover] Manager has createQuickTab:',
      typeof quickTabsManager.createQuickTab
    );
    console.log('[Copy-URL-on-Hover] Manager currentTabId:', quickTabsManager.currentTabId);
  } else {
    console.error('[INIT][Content] PHASE_COMPLETE:', {
      success: false,
      currentTabId: currentTabId !== null ? currentTabId : 'NULL',
      totalDurationMs: totalInitDuration,
      hasManager: false,
      error: 'Manager is null after initialization',
      timestamp: new Date().toISOString()
    });
    console.error('[Copy-URL-on-Hover] ✗ Quick Tabs manager is null after initialization!');
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for feature initialization
 * v1.6.0.3 - Extracted Quick Tabs init to reduce complexity
 */
async function initializeFeatures() {
  console.log('[Copy-URL-on-Hover] STEP: Initializing feature modules...');

  // Quick Tabs feature
  try {
    await initializeQuickTabsFeature();
  } catch (qtErr) {
    logQuickTabsInitError(qtErr);
  }

  // Notifications feature
  try {
    notificationManager = initNotifications(CONFIG, stateManager);
    console.log('[Copy-URL-on-Hover] ✓ Notifications feature initialized');
  } catch (notifErr) {
    console.error('[Copy-URL-on-Hover] ERROR: Failed to initialize Notifications:', notifErr);
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for error reporting
 */
function reportInitializationError(err) {
  console.error('[Copy-URL-on-Hover] ❌ CRITICAL INITIALIZATION ERROR ❌');
  console.error('[Copy-URL-on-Hover] Error details:', {
    message: err.message,
    stack: err.stack,
    name: err.name
  });

  try {
    const errorMsg = `Copy-URL-on-Hover failed to initialize.\n\nError: ${err.message}\n\nPlease check the browser console (F12) for details.`;
    console.error('[Copy-URL-on-Hover] User will see alert:', errorMsg);
    // Uncomment for production debugging: alert(errorMsg);
  } catch (alertErr) {
    console.error('[Copy-URL-on-Hover] Could not show error alert:', alertErr);
  }
}

/**
 * v1.6.0 Phase 2.4 - Refactored to reduce complexity from 10 to <9
 * v1.6.1 - Added explicit filter settings initialization before logging starts
 * v1.6.2.3 - Iframe guard moved to top of file (halts execution before reaching here)
 */
(async function initExtension() {
  try {
    // v1.6.1: Wait for filter settings to load from storage BEFORE starting extension logs
    // This ensures user's filter preferences are active from the very first log
    const settingsResult = await settingsReady;
    if (settingsResult.success) {
      console.log(
        `[Copy-URL-on-Hover] ✓ Filter settings loaded (source: ${settingsResult.source})`
      );
    } else {
      console.warn(
        `[Copy-URL-on-Hover] ⚠ Using default filter settings (${settingsResult.source})`
      );
    }

    console.log('[Copy-URL-on-Hover] STEP: Starting extension initialization...');

    // v1.6.3.5-v4 - FIX Diagnostic Issue #7: Log content script identity on init
    // This helps track which tab ID owns which Quick Tabs
    try {
      const tabInfo = await browser.tabs.getCurrent();
      console.log('[Copy-URL-on-Hover] Content Script Identity:', {
        tabId: tabInfo?.id || 'unknown',
        url: window.location.href,
        timestamp: Date.now()
      });
    } catch (tabErr) {
      console.log(
        '[Copy-URL-on-Hover] Content Script Identity: tab ID unavailable (running in background context?)'
      );
    }

    // Load configuration
    CONFIG = await loadConfiguration();

    // Setup debug mode
    setupDebugMode();

    // Initialize state (critical - will throw on error)
    initializeState();

    // Initialize features
    await initializeFeatures();

    debug('Extension initialized successfully');

    // Start main functionality
    console.log('[Copy-URL-on-Hover] STEP: Starting main features...');
    await initMainFeatures();
    console.log('[Copy-URL-on-Hover] ✓✓✓ EXTENSION FULLY INITIALIZED ✓✓✓');

    // Set success marker
    window.CUO_initialized = true;
    console.log('[Copy-URL-on-Hover] Extension is ready for use!');
  } catch (err) {
    reportInitializationError(err);
  }
})();

/**
 * Initialize main features
 */
function initMainFeatures() {
  debug('Loading main features...');

  // Note: Notification styles now injected by notifications module (v1.5.9.0)

  // Track mouse position for Quick Tab placement
  document.addEventListener(
    'mousemove',
    event => {
      stateManager.set('lastMouseX', event.clientX);
      stateManager.set('lastMouseY', event.clientY);
    },
    true
  );

  // Set up hover detection
  setupHoverDetection();

  // Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // Note: Quick Tabs now initialized in main initExtension (v1.5.9.0)
  // Note: Panel Manager is separate feature - not reimplemented in modular architecture yet
}

/**
 * Get domain type from current URL
 */
function getDomainType() {
  const hostname = window.location.hostname.toLowerCase();

  // Check against all supported domains
  const domainMappings = {
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'reddit.com': 'reddit',
    'linkedin.com': 'linkedin',
    'instagram.com': 'instagram',
    'facebook.com': 'facebook',
    'tiktok.com': 'tiktok',
    'threads.net': 'threads',
    'bsky.app': 'bluesky',
    'youtube.com': 'youtube',
    'vimeo.com': 'vimeo',
    'github.com': 'github',
    'gitlab.com': 'gitlab',
    'stackoverflow.com': 'stackoverflow',
    'medium.com': 'medium',
    'amazon.com': 'amazon',
    'ebay.com': 'ebay',
    'pinterest.com': 'pinterest',
    'wikipedia.org': 'wikipedia',
    'netflix.com': 'netflix',
    'spotify.com': 'spotify',
    'twitch.tv': 'twitch',
    steam: 'steam'
    // Add more mappings as needed
  };

  // Check for exact matches
  for (const [domain, type] of Object.entries(domainMappings)) {
    if (hostname.includes(domain)) {
      return type;
    }
  }

  return 'generic';
}

/**
 * Log URL detection result
 * @private
 * @param {string|null} url - Detected URL
 * @param {Element} element - Element that was checked
 * @param {string} domainType - Domain type
 * @param {number} detectionDuration - Time taken for detection
 */
function _logUrlDetectionResult(url, element, domainType, detectionDuration) {
  const detectionTime = `${detectionDuration.toFixed(2)}ms`;
  if (url) {
    logNormal('url-detection', 'Success', 'URL found', {
      url,
      domainType,
      detectionTime
    });
  } else {
    logNormal('url-detection', 'Failure', 'No URL found', {
      elementTag: element.tagName,
      elementClasses: element.className || '<none>',
      domainType,
      detectionTime
    });
  }
}

/**
 * Handle mouseover event
 * @private
 * @param {Event} event - Mouse event
 * @param {Object} context - Shared context with hoverStartTime
 */
function _handleMouseover(event, context) {
  context.hoverStartTime = performance.now();
  const domainType = getDomainType();
  const element = event.target;

  // Log hover start with element context
  logNormal('hover', 'Start', 'Mouse entered element', {
    elementTag: element.tagName,
    elementClasses: element.className || '<none>',
    elementId: element.id || '<none>',
    elementText: element.textContent?.substring(0, 100) || '<empty>',
    domainType
  });

  // Find URL using the modular URL registry
  const urlDetectionStart = performance.now();
  const url = urlRegistry.findURL(element, domainType);
  const urlDetectionDuration = performance.now() - urlDetectionStart;

  _logUrlDetectionResult(url, element, domainType, urlDetectionDuration);

  // Always set element, URL can be null
  stateManager.setState({
    currentHoveredLink: url || null,
    currentHoveredElement: element
  });

  if (url) {
    eventBus.emit(Events.HOVER_START, { url, element, domainType });
  }
}

/**
 * Set up hover detection
 * v1.6.0.7 - Enhanced logging for hover lifecycle and URL detection
 */
function setupHoverDetection() {
  // Track hover start time for duration calculation (shared context)
  const context = { hoverStartTime: null };

  document.addEventListener('mouseover', event => _handleMouseover(event, context));

  document.addEventListener('mouseout', event => {
    const hoverDuration = context.hoverStartTime ? performance.now() - context.hoverStartTime : 0;
    const wasURLDetected = !!stateManager.get('currentHoveredLink');

    // Log hover end with duration and context
    logNormal('hover', 'End', 'Mouse left element', {
      duration: `${hoverDuration.toFixed(2)}ms`,
      urlWasDetected: wasURLDetected,
      elementTag: event.target.tagName
    });

    stateManager.setState({
      currentHoveredLink: null,
      currentHoveredElement: null
    });

    eventBus.emit(Events.HOVER_END);
    context.hoverStartTime = null;
  });
}

/**
 * Check if element is an input field or editable
 */
function isInputField(element) {
  return (
    element &&
    (element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.isContentEditable ||
      element.closest('[contenteditable="true"]'))
  );
}

/**
 * v1.6.0 Phase 2.4 - Table-driven shortcut handling
 */
const SHORTCUT_HANDLERS = [
  {
    name: 'copyUrl',
    needsLink: true,
    needsElement: false,
    handler: handleCopyURL
  },
  {
    name: 'copyText',
    needsLink: false,
    needsElement: true,
    handler: handleCopyText
  },
  {
    name: 'quickTab',
    needsLink: true,
    needsElement: true,
    handler: handleCreateQuickTab
  },
  {
    name: 'openNewTab',
    needsLink: true,
    needsElement: false,
    handler: handleOpenInNewTab
  }
];

/**
 * v1.6.0 Phase 2.4 - Check if shortcut matches and prerequisites are met
 */
function matchesShortcut(event, shortcut, hoveredLink, hoveredElement) {
  const keyConfig = `${shortcut.name}Key`;
  const ctrlConfig = `${shortcut.name}Ctrl`;
  const altConfig = `${shortcut.name}Alt`;
  const shiftConfig = `${shortcut.name}Shift`;

  if (
    !checkShortcut(event, {
      key: CONFIG[keyConfig],
      ctrl: CONFIG[ctrlConfig],
      alt: CONFIG[altConfig],
      shift: CONFIG[shiftConfig]
    })
  ) {
    return false;
  }

  // Check prerequisites
  if (shortcut.needsLink && !hoveredLink) return false;
  if (shortcut.needsElement && !hoveredElement) return false;

  return true;
}

/**
 * Execute matched shortcut handler
 * v1.6.0.10 - Added logging for matched shortcuts only
 */
async function executeShortcutHandler(shortcut, hoveredLink, hoveredElement, event) {
  const executionStart = performance.now();

  // Log matched shortcut execution
  logNormal('keyboard', 'Matched', 'Keyboard shortcut matched and executing', {
    shortcutName: shortcut.name,
    key: event.key,
    modifiers: `Ctrl:${event.ctrlKey} Alt:${event.altKey} Shift:${event.shiftKey}`,
    hasLink: !!hoveredLink,
    hasElement: !!hoveredElement
  });

  // Pass correct parameters based on handler's requirements
  if (shortcut.needsLink && shortcut.needsElement) {
    await shortcut.handler(hoveredLink, hoveredElement);
  } else if (shortcut.needsLink) {
    await shortcut.handler(hoveredLink);
  } else if (shortcut.needsElement) {
    await shortcut.handler(hoveredElement);
  }

  const executionDuration = performance.now() - executionStart;

  logNormal('keyboard', 'Complete', 'Handler execution finished', {
    shortcutName: shortcut.name,
    executionTime: `${executionDuration.toFixed(2)}ms`
  });
}

/**
 * v1.6.0 Phase 2.4 - Extracted handler for keyboard shortcuts
 * Reduced complexity and nesting using table-driven pattern with guard clauses
 * v1.6.0.3 - Fixed parameter passing: pass correct args based on handler's needs
 * v1.6.0.7 - Enhanced logging for keyboard event detection and shortcut matching
 * v1.6.0.10 - ARCHITECTURAL FIX: Only log matched shortcuts, not every keystroke
 *             Removes noise from console by logging only when shortcuts are executed
 */
async function handleKeyboardShortcut(event) {
  // Check if in input field first - silently ignore
  const isInInputField = isInputField(event.target);
  if (isInInputField) {
    return;
  }

  const hoveredLink = stateManager.get('currentHoveredLink');
  const hoveredElement = stateManager.get('currentHoveredElement');

  // Check each shortcut using table-driven approach
  for (const shortcut of SHORTCUT_HANDLERS) {
    const matches = matchesShortcut(event, shortcut, hoveredLink, hoveredElement);

    if (!matches) continue;

    // Shortcut matched - prevent default and execute
    event.preventDefault();

    // Execute with logging (logging happens inside executeShortcutHandler)
    await executeShortcutHandler(shortcut, hoveredLink, hoveredElement, event);

    return;
  }

  // No shortcut matched - silently ignore (no noise in console)
}

/**
 * Set up keyboard shortcuts
 * v1.6.0 Phase 2.4 - Extracted handler to reduce complexity
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', handleKeyboardShortcut);
}

/**
 * Check if keyboard shortcut matches configuration
 */
/**
 * Check if keyboard shortcut matches configuration
 * @param {KeyboardEvent} event - The keyboard event
 * @param {Object} config - Shortcut configuration
 * @param {string} config.key - Required key
 * @param {boolean} config.ctrl - Requires Ctrl modifier
 * @param {boolean} config.alt - Requires Alt modifier
 * @param {boolean} config.shift - Requires Shift modifier
 * @returns {boolean} - True if shortcut matches
 */
function checkShortcut(event, config) {
  if (!config) return false;
  const { key, ctrl, alt, shift } = config;
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    event.ctrlKey === ctrl &&
    event.altKey === alt &&
    event.shiftKey === shift
  );
}

/**
 * Handle copy URL action
 * v1.6.0.7 - Enhanced logging for clipboard operations and action context
 */
async function handleCopyURL(url) {
  logNormal('clipboard', 'Action', 'Copy URL requested', {
    url: url,
    urlLength: url?.length || 0,
    currentPage: window.location.href,
    triggeredBy: 'keyboard-shortcut'
  });

  try {
    const copyStart = performance.now();
    const success = await copyToClipboard(url);
    const copyDuration = performance.now() - copyStart;

    logNormal('clipboard', 'Result', 'Copy operation completed', {
      success: success,
      url: url,
      duration: `${copyDuration.toFixed(2)}ms`
    });

    if (success) {
      eventBus.emit(Events.URL_COPIED, { url });
      showNotification('✓ URL copied!', 'success');
      debug('Copied URL:', url);
    } else {
      console.error('[Clipboard] [Failure] Copy operation returned false', {
        url: url,
        timestamp: Date.now()
      });
      showNotification('✗ Failed to copy URL', 'error');
    }
  } catch (err) {
    console.error('[Copy URL] Failed:', err);
    showNotification('✗ Failed to copy URL', 'error');
  }
}

/**
 * Extract text from element with logging
 * @private
 * @param {Element} element - Element to extract text from
 * @returns {{ text: string|null, duration: number }} - Extracted text and duration
 */
function _extractTextWithLogging(element) {
  const extractStart = performance.now();
  const text = getLinkText(element);
  const extractDuration = performance.now() - extractStart;

  logNormal('clipboard', 'Extract', 'Text extraction completed', {
    textLength: text?.length || 0,
    textPreview: text?.substring(0, 100) || '<empty>',
    extractionTime: `${extractDuration.toFixed(2)}ms`
  });

  return { text, duration: extractDuration };
}

/**
 * Perform clipboard copy operation with logging
 * @private
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - True if successful
 */
async function _performCopyWithLogging(text) {
  const copyStart = performance.now();
  const success = await copyToClipboard(text);
  const copyDuration = performance.now() - copyStart;

  logNormal('clipboard', 'Result', 'Copy operation completed', {
    success,
    textLength: text.length,
    duration: `${copyDuration.toFixed(2)}ms`
  });

  return success;
}

/**
 * Handle successful text copy
 * @private
 * @param {string} text - Copied text
 */
function _handleCopySuccess(text) {
  eventBus.emit(Events.TEXT_COPIED, { text });
  showNotification('✓ Text copied!', 'success');
  debug('Copied text:', text);
}

/**
 * Validate extracted text is not empty
 * @private
 * @param {string|null} text - Text to validate
 * @param {Element} element - Source element for logging
 * @returns {boolean} - True if text is valid
 */
function _validateText(text, element) {
  if (!text || text.trim().length === 0) {
    logWarn('clipboard', 'Validation', 'No text found to copy', { element });
    showNotification('✗ No text found', 'error');
    return false;
  }
  return true;
}

/**
 * Handle copy failure
 * @private
 * @param {string} text - Text that failed to copy
 */
function _handleCopyFailure(text) {
  showNotification('✗ Failed to copy text', 'error');
  console.error('[Copy Text] [Failure] Clipboard operation returned false', {
    textLength: text.length,
    timestamp: Date.now()
  });
}

/**
 * Build log data for copy text request
 * @private
 * @param {Element} element - Element being copied from
 * @returns {Object} - Log data object
 */
function _buildCopyTextLogData(element) {
  return {
    elementTag: element?.tagName || '<none>',
    elementText: element?.textContent?.substring(0, 100) || '<empty>',
    triggeredBy: 'keyboard-shortcut'
  };
}

/**
 * Handle copy text error
 * @private
 * @param {Error} err - Error object
 */
function _handleCopyTextError(err) {
  console.error('[Copy Text] Failed:', {
    message: err.message,
    name: err.name,
    stack: err.stack,
    error: err
  });
  showNotification('✗ Failed to copy text', 'error');
}

/**
 * Handle copy text action
 * v1.6.0.1 - Added validation for empty text
 * v1.6.0.7 - Enhanced logging for text extraction and clipboard operations
 * @param {Element} element - Element to extract text from
 */
async function handleCopyText(element) {
  logNormal('clipboard', 'Action', 'Copy text requested', _buildCopyTextLogData(element));

  try {
    const { text } = _extractTextWithLogging(element);
    if (!_validateText(text, element)) return;

    const success = await _performCopyWithLogging(text);
    success ? _handleCopySuccess(text) : _handleCopyFailure(text);
  } catch (err) {
    _handleCopyTextError(err);
  }
}

/**
 * Handle create Quick Tab action
 */
/**
 * v1.6.0 Phase 2.4 - Extracted helper for Quick Tab data structure
 * v1.6.3 - Refactored to use options object pattern (4 args max)
 * v1.6.3.10-v7 - FIX Diagnostic Issues #3, #11: Include originTabId in Quick Tab data
 *
 * @param {Object} options - Quick Tab configuration
 * @param {string} options.url - URL to load in Quick Tab
 * @param {string} options.id - Unique Quick Tab ID
 * @param {Object} options.position - Position { left, top }
 * @param {Object} options.size - Size { width, height }
 * @param {string} options.title - Quick Tab title
 * @returns {Object} - Quick Tab data object
 */
function buildQuickTabData(options) {
  if (!options) {
    throw new Error('buildQuickTabData: options object is required');
  }
  const { url, id, position = {}, size = {}, title } = options;

  // v1.6.3.10-v7 - FIX Diagnostic Issues #3, #11: Include originTabId
  // cachedTabId is set during background port connection and contains the current tab ID
  const originTabId = cachedTabId ?? null;

  // v1.6.3.10-v7 - FIX Issue #11: Diagnostic logging for originTabId in creation payload
  if (originTabId === null) {
    console.warn('[Content] QUICK_TAB_CREATE_WARNING: originTabId is null, tab ID not yet initialized', {
      url,
      id,
      cachedTabId,
      suggestion: 'Ensure connectContentToBackground() completes before creating Quick Tabs'
    });
  } else {
    console.log('[Content] QUICK_TAB_CREATE: Including originTabId in creation payload', {
      url,
      id,
      originTabId
    });
  }

  return {
    id,
    url,
    left: position.left,
    top: position.top,
    width: size.width,
    height: size.height,
    title,
    cookieStoreId: 'firefox-default',
    minimized: false,
    pinnedToUrl: null,
    // v1.6.3.10-v7 - FIX Issues #3, #11: Pass originTabId to background
    originTabId
  };
}

// ==================== v1.6.3.10-v11 FIX ISSUE #25: QUICK TAB CREATION QUEUE ====================
// FIX Issue #25: Serialize Quick Tab creation to prevent race conditions and ID collisions

/**
 * Queue of pending Quick Tab creation operations
 * v1.6.3.10-v11 - FIX Issue #25: Serial creation queue
 */
const quickTabCreationQueue = [];

/**
 * Track if creation is currently in progress
 * v1.6.3.10-v11 - FIX Issue #25
 */
let isCreationInProgress = false;

/**
 * Monotonically increasing counter for atomic ID generation
 * v1.6.3.10-v11 - FIX Issue #25
 */
let quickTabIdCounter = 0;

/**
 * Set of existing Quick Tab IDs for collision detection
 * v1.6.3.10-v11 - FIX Issue #25
 */
const existingQuickTabIds = new Set();

/**
 * Generate collision-free Quick Tab ID using atomic counter
 * v1.6.3.10-v11 - FIX Issue #25: Format qt-{originTabId}-{counter}-{random}
 * @returns {string} Unique Quick Tab ID
 */
function _generateAtomicQuickTabId() {
  const tabId = cachedTabId ?? 'unknown';
  const counter = ++quickTabIdCounter;
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  
  let candidateId = `qt-${tabId}-${counter}-${randomSuffix}`;
  
  // Collision detection (extremely unlikely but check anyway)
  let collisionCount = 0;
  while (existingQuickTabIds.has(candidateId)) {
    collisionCount++;
    const newRandom = Math.random().toString(36).slice(2, 6);
    candidateId = `qt-${tabId}-${counter}-${newRandom}-${collisionCount}`;
    
    if (collisionCount > 10) {
      console.error('[Content] QUICK_TAB_ID_COLLISION: Too many collisions', {
        attempts: collisionCount,
        tabId,
        counter
      });
      break;
    }
  }
  
  existingQuickTabIds.add(candidateId);
  
  console.log('[Content] QUICK_TAB_ID_GENERATED:', {
    id: candidateId,
    counter,
    collisionDetected: collisionCount > 0,
    existingCount: existingQuickTabIds.size
  });
  
  return candidateId;
}

/**
 * Queue a Quick Tab creation operation
 * v1.6.3.10-v11 - FIX Issue #25: Serialize creation operations
 * @param {Object} quickTabData - Quick Tab data
 * @param {string} saveId - Save tracking ID
 * @param {boolean} canUseManagerSaveId - Whether Manager save ID can be used
 * @returns {Promise<void>}
 */
function _queueQuickTabCreation(quickTabData, saveId, canUseManagerSaveId) {
  return new Promise((resolve, reject) => {
    quickTabCreationQueue.push({
      quickTabData,
      saveId,
      canUseManagerSaveId,
      queuedAt: Date.now(),
      resolve,
      reject
    });
    
    console.log('[Content] QUICK_TAB_CREATION_QUEUED:', {
      id: quickTabData.id,
      queueSize: quickTabCreationQueue.length,
      isCreationInProgress
    });
    
    // Process queue if not already processing
    _processCreationQueue();
  });
}

/**
 * Process the Quick Tab creation queue serially
 * v1.6.3.10-v11 - FIX Issue #25
 */
async function _processCreationQueue() {
  if (isCreationInProgress || quickTabCreationQueue.length === 0) {
    return;
  }
  
  isCreationInProgress = true;
  
  while (quickTabCreationQueue.length > 0) {
    const operation = quickTabCreationQueue.shift();
    const { quickTabData, saveId, canUseManagerSaveId, queuedAt, resolve, reject } = operation;
    
    const queueDuration = Date.now() - queuedAt;
    console.log('[Content] QUICK_TAB_CREATION_STARTED:', {
      id: quickTabData.id,
      queueDurationMs: queueDuration,
      remainingInQueue: quickTabCreationQueue.length
    });
    
    try {
      await executeQuickTabCreation(quickTabData, saveId, canUseManagerSaveId);
      
      console.log('[Content] QUICK_TAB_CREATION_COMPLETED:', {
        id: quickTabData.id,
        totalDurationMs: Date.now() - queuedAt
      });
      
      resolve();
      
    } catch (err) {
      console.error('[Content] QUICK_TAB_CREATION_FAILED:', {
        id: quickTabData.id,
        error: err.message
      });
      
      handleQuickTabCreationError(err, saveId, canUseManagerSaveId);
      reject(err);
    }
  }
  
  isCreationInProgress = false;
  console.log('[Content] QUICK_TAB_CREATION_QUEUE_DRAINED');
}

/**
 * Track an existing Quick Tab ID (e.g., from hydration)
 * v1.6.3.10-v11 - FIX Issue #25
 * @param {string} id - Quick Tab ID to track
 */
function _trackExistingQuickTabId(id) {
  if (id) {
    existingQuickTabIds.add(id);
  }
}

/**
 * Clear a Quick Tab ID from tracking (on close)
 * v1.6.3.10-v11 - FIX Issue #25
 * @param {string} id - Quick Tab ID to clear
 */
function _clearQuickTabId(id) {
  existingQuickTabIds.delete(id);
}

// ==================== END ISSUE #25 FIX ====================

/**
 * v1.6.0 Phase 2.4 - Extracted helper for Quick Tab IDs
 * v1.6.3.10-v11 - FIX Issue #25: Prefixed with _ as now using _generateAtomicQuickTabId instead
 */
function _generateQuickTabIds() {
  const canUseManagerSaveId = Boolean(
    quickTabsManager && typeof quickTabsManager.generateSaveId === 'function'
  );
  const quickTabId =
    quickTabsManager && typeof quickTabsManager.generateId === 'function'
      ? quickTabsManager.generateId()
      : generateQuickTabId();
  const saveId = canUseManagerSaveId ? quickTabsManager.generateSaveId() : generateSaveTrackingId();

  return { quickTabId, saveId, canUseManagerSaveId };
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for local Quick Tab creation
 */
function createQuickTabLocally(quickTabData, saveId, canUseManagerSaveId) {
  if (canUseManagerSaveId && quickTabsManager.trackPendingSave) {
    quickTabsManager.trackPendingSave(saveId);
  }
  quickTabsManager.createQuickTab(quickTabData);
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for background persistence
 */
async function persistQuickTabToBackground(quickTabData, saveId) {
  await sendMessageToBackground({
    action: 'CREATE_QUICK_TAB',
    ...quickTabData,
    saveId
  });
}

/**
 * v1.6.0 Phase 2.4 - Create Quick Tab (handle success)
 */
async function executeQuickTabCreation(quickTabData, saveId, canUseManagerSaveId) {
  const hasManager = quickTabsManager && typeof quickTabsManager.createQuickTab === 'function';

  if (hasManager) {
    createQuickTabLocally(quickTabData, saveId, canUseManagerSaveId);
  } else {
    console.warn('[Quick Tab] Manager not available, using legacy creation path');
  }

  await persistQuickTabToBackground(quickTabData, saveId);
  showNotification('✓ Quick Tab created!', 'success');
  debug('Quick Tab created successfully');
}

/**
 * v1.6.0 Phase 2.4 - Handle Quick Tab creation failure
 */
function handleQuickTabCreationError(err, saveId, canUseManagerSaveId) {
  console.error('[Quick Tab] Failed:', err);
  if (canUseManagerSaveId && quickTabsManager?.releasePendingSave) {
    quickTabsManager.releasePendingSave(saveId);
  }
  showNotification('✗ Failed to create Quick Tab', 'error');
}

/**
 * v1.6.0 Phase 2.4 - Refactored to reduce complexity from 18 to <9
 * v1.6.3.10-v11 - FIX Issue #25: Use creation queue to serialize operations
 */
async function handleCreateQuickTab(url, targetElement = null) {
  // Early validation
  if (!url) {
    console.warn('[Quick Tab] Missing URL for creation');
    return;
  }

  // Setup and emit event
  debug('Creating Quick Tab for:', url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });

  // Prepare Quick Tab data
  const width = CONFIG.quickTabDefaultWidth || 800;
  const height = CONFIG.quickTabDefaultHeight || 600;
  const position = calculateQuickTabPosition(targetElement, width, height);
  const title = targetElement?.textContent?.trim() || 'Quick Tab';
  
  // v1.6.3.10-v11 - FIX Issue #25: Use atomic ID generation instead of default
  const quickTabId = _generateAtomicQuickTabId();
  const saveId = generateSaveTrackingId();
  const canUseManagerSaveId = Boolean(
    quickTabsManager && typeof quickTabsManager.generateSaveId === 'function'
  );
  
  const quickTabData = buildQuickTabData({
    url,
    id: quickTabId,
    position,
    size: { width, height },
    title
  });

  // v1.6.3.10-v11 - FIX Issue #25: Queue creation instead of direct execution
  console.log('[Content] QUICK_TAB_CREATE_REQUEST:', {
    id: quickTabId,
    url: url.substring(0, 100),
    queueSize: quickTabCreationQueue.length
  });

  try {
    await _queueQuickTabCreation(quickTabData, saveId, canUseManagerSaveId);
  } catch (err) {
    // Error already handled in queue processing
    console.error('[Quick Tab] Queue creation failed:', err.message);
  }
}

function calculateQuickTabPosition(targetElement, width, height) {
  const padding = 16;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || height;

  let left = stateManager.get('lastMouseX') ?? padding;
  let top = stateManager.get('lastMouseY') ?? padding;

  if (targetElement?.getBoundingClientRect) {
    try {
      const rect = targetElement.getBoundingClientRect();
      left = rect.right + padding;
      top = rect.top;
    } catch (error) {
      console.warn('[Quick Tab] Failed to read target bounds:', error);
    }
  }

  const maxLeft = Math.max(padding, viewportWidth - width - padding);
  const maxTop = Math.max(padding, viewportHeight - height - padding);

  left = Math.min(Math.max(left, padding), maxLeft);
  top = Math.min(Math.max(top, padding), maxTop);

  return {
    left: Math.round(left),
    top: Math.round(top)
  };
}

/**
 * Helper function to generate unique Quick Tab ID
 */
function generateQuickTabId() {
  return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateSaveTrackingId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Handle open in new tab action
 */
async function handleOpenInNewTab(url) {
  try {
    await sendMessageToBackground({
      action: 'openTab',
      url: url,
      switchFocus: CONFIG.openNewTabSwitchFocus
    });

    eventBus.emit(Events.LINK_OPENED, { url });
    showNotification('✓ Opened in new tab', 'success');
    debug('Opened in new tab:', url);
  } catch (err) {
    console.error('[Open Tab] Failed:', err);
    showNotification('✗ Failed to open tab', 'error');
  }
}

/**
 * Show notification to user
 * v1.5.9.0 - Now delegates to notification manager
 */
function showNotification(message, type = 'info') {
  debug('Notification:', message, type);

  // Delegate to notification manager
  if (notificationManager) {
    notificationManager.showNotification(message, type);
  } else {
    console.warn('[Content] Notification manager not initialized, skipping notification');
  }
}

/**
 * v1.6.3 - Helper function to handle clearing all Quick Tabs
 * Extracted to meet max-depth=2 ESLint requirement
 * Called from popup.js when user clicks "Clear Quick Tab Storage" button
 *
 * @param {Function} sendResponse - Response callback from message listener
 */
function _handleClearAllQuickTabs(sendResponse) {
  console.log('[Content] Received CLEAR_ALL_QUICK_TABS request');

  try {
    // Guard: Quick Tabs manager not initialized
    if (!quickTabsManager) {
      console.warn('[Content] QuickTabsManager not initialized, nothing to clear');
      sendResponse({ success: true, message: 'No Quick Tabs to clear', count: 0 });
      return;
    }

    // Close all Quick Tabs using the manager
    const tabIds = Array.from(quickTabsManager.tabs.keys());
    console.log(`[Content] Clearing ${tabIds.length} Quick Tabs`);
    quickTabsManager.closeAll();

    sendResponse({
      success: true,
      message: 'All Quick Tabs cleared',
      count: tabIds.length
    });
  } catch (error) {
    console.error('[Content] Error clearing Quick Tabs:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

/**
 * v1.6.3.4 - FIX Bug #5: Handle QUICK_TABS_CLEARED message from background
 * This clears local Quick Tab state WITHOUT writing to storage
 * (Background already cleared storage, we just need to clean up UI)
 *
 * @param {Function} sendResponse - Response callback from message listener
 */

/**
 * Destroy a single Quick Tab window if it exists
 * @private
 * @param {Map} tabs - The tabs map
 * @param {string} id - Tab ID to destroy
 */
function _destroyTabWindow(tabs, id) {
  const tabWindow = tabs.get(id);
  if (tabWindow && tabWindow.destroy) {
    tabWindow.destroy();
  }
  tabs.delete(id);
}

function _handleQuickTabsCleared(sendResponse) {
  console.log('[Content] Received QUICK_TABS_CLEARED - clearing local state only');

  try {
    // Guard: Quick Tabs manager not initialized
    if (!quickTabsManager) {
      console.warn('[Content] QuickTabsManager not initialized, nothing to clear');
      sendResponse({ success: true, message: 'No Quick Tabs to clear', count: 0 });
      return;
    }

    // Clear all Quick Tabs from UI without triggering storage write
    // We need to destroy each tab's DOM elements but not call closeAll()
    // which would write to storage
    const tabIds = Array.from(quickTabsManager.tabs.keys());
    console.log(`[Content] Clearing ${tabIds.length} Quick Tabs (local only, no storage write)`);

    // Destroy each Quick Tab's DOM directly
    for (const id of tabIds) {
      _destroyTabWindow(quickTabsManager.tabs, id);
    }

    // Clear minimized manager
    if (quickTabsManager.minimizedManager) {
      quickTabsManager.minimizedManager.clear();
    }

    sendResponse({
      success: true,
      message: 'Local Quick Tabs cleared (storage already cleared by background)',
      count: tabIds.length
    });
  } catch (error) {
    console.error('[Content] Error clearing local Quick Tabs:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

/**
 * Check if action result indicates failure
 * v1.6.3.4-v7 - Helper to reduce _handleManagerAction complexity
 * @private
 * @param {Object|undefined} result - Result from action function
 * @returns {boolean} True if result indicates failure
 */
function _isActionFailure(result) {
  if (!result || typeof result !== 'object') return false;
  return Boolean(result.error) || result.success === false;
}

/**
 * Get error message from action result
 * v1.6.3.4-v7 - Helper to reduce _handleManagerAction complexity
 * @private
 * @param {Object} result - Result from action function
 * @returns {string} Error message
 */
function _getActionError(result) {
  return result.error || 'Operation failed';
}

// ==================== v1.6.3.10-v7 ADOPTION-AWARE OWNERSHIP ====================
// FIX Issue #7: Track recently-adopted Quick Tab IDs to override ID pattern extraction
// v1.6.3.10-v11 - FIX Issue #5: Dynamic TTL based on observed network latency

/**
 * Map of recently-adopted Quick Tab IDs -> { newOriginTabId, adoptedAt, ttl }
 * v1.6.3.10-v7 - FIX Issue #7: Adoption-aware ownership validation
 * v1.6.3.10-v11 - FIX Issue #5: Now stores per-entry TTL
 */
const recentlyAdoptedQuickTabs = new Map();

/**
 * Default TTL for recently-adopted Quick Tab entries (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #5: Safe default when latency unavailable (30 seconds)
 */
const ADOPTION_DEFAULT_TTL_MS = 30000;

/**
 * Minimum TTL for adoption tracking (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #5: Never go below 5 seconds
 */
const ADOPTION_MIN_TTL_MS = 5000;

/**
 * Maximum TTL for adoption tracking (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #5: Cap at 60 seconds to prevent memory leaks
 */
const ADOPTION_MAX_TTL_MS = 60000;

/**
 * Multiplier for latency to compute TTL (3x for safety margin)
 * v1.6.3.10-v11 - FIX Issue #5
 */
const ADOPTION_TTL_LATENCY_MULTIPLIER = 3;

/**
 * Cleanup interval for recently-adopted Quick Tab entries (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #7: Clean up every 30 seconds
 */
const ADOPTION_CLEANUP_INTERVAL_MS = 30000;

/**
 * Track observed handshake latencies for dynamic TTL calculation
 * v1.6.3.10-v11 - FIX Issue #5
 */
const adoptionLatencySamples = [];
const MAX_ADOPTION_LATENCY_SAMPLES = 10;

/**
 * Adoption cache metrics for logging
 * v1.6.3.10-v11 - FIX Issue #5
 */
const adoptionCacheMetrics = {
  hitCount: 0,
  missCount: 0,
  ttlExpiredCount: 0,
  totalTracked: 0
};

/**
 * Get current observed handshake latency average
 * v1.6.3.10-v11 - FIX Issue #5
 * @returns {number|null} Average latency in ms, or null if no samples
 */
function _getObservedHandshakeLatency() {
  if (adoptionLatencySamples.length === 0) {
    return null;
  }
  const sum = adoptionLatencySamples.reduce((a, b) => a + b, 0);
  return Math.round(sum / adoptionLatencySamples.length);
}

/**
 * Record a handshake latency sample
 * v1.6.3.10-v11 - FIX Issue #5
 * @param {number} latencyMs - Observed latency in milliseconds
 */
function _recordHandshakeLatency(latencyMs) {
  if (typeof latencyMs !== 'number' || latencyMs < 0) return;
  
  adoptionLatencySamples.push(latencyMs);
  if (adoptionLatencySamples.length > MAX_ADOPTION_LATENCY_SAMPLES) {
    adoptionLatencySamples.shift();
  }
  
  console.log('[Content] ADOPTION_LATENCY_RECORDED:', {
    latencyMs,
    sampleCount: adoptionLatencySamples.length,
    averageLatency: _getObservedHandshakeLatency()
  });
}

/**
 * Calculate dynamic TTL based on observed latency
 * v1.6.3.10-v11 - FIX Issue #5
 * @returns {number} TTL in milliseconds, clamped to [MIN, MAX]
 */
function _calculateDynamicAdoptionTTL() {
  const observedLatency = _getObservedHandshakeLatency();
  
  // Use default if no latency measurements available
  if (observedLatency === null) {
    return ADOPTION_DEFAULT_TTL_MS;
  }
  
  // Calculate 3x latency with clamping
  const calculatedTTL = observedLatency * ADOPTION_TTL_LATENCY_MULTIPLIER;
  return Math.max(ADOPTION_MIN_TTL_MS, Math.min(calculatedTTL, ADOPTION_MAX_TTL_MS));
}

/**
 * Track a recently-adopted Quick Tab ID
 * v1.6.3.10-v7 - FIX Issue #7
 * v1.6.3.10-v11 - FIX Issue #5: Store dynamic TTL per entry
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {number} newOriginTabId - New owner tab ID
 */
function _trackAdoptedQuickTab(quickTabId, newOriginTabId) {
  const dynamicTTL = _calculateDynamicAdoptionTTL();
  
  recentlyAdoptedQuickTabs.set(quickTabId, {
    newOriginTabId,
    adoptedAt: Date.now(),
    ttl: dynamicTTL
  });
  
  adoptionCacheMetrics.totalTracked++;
  
  console.log('[Content] ADOPTION_TRACKED:', {
    quickTabId,
    newOriginTabId,
    ttl: dynamicTTL,
    observedLatency: _getObservedHandshakeLatency(),
    trackedCount: recentlyAdoptedQuickTabs.size,
    metrics: adoptionCacheMetrics
  });
}

/**
 * Check if Quick Tab was recently adopted and get cached ownership
 * v1.6.3.10-v7 - FIX Issue #7
 * v1.6.3.10-v11 - FIX Issue #5: Use per-entry dynamic TTL
 * @param {string} quickTabId - Quick Tab ID to check
 * @returns {{ wasAdopted: boolean, newOriginTabId: number|null }} Adoption info
 */
function _getAdoptionOwnership(quickTabId) {
  const adoptionInfo = recentlyAdoptedQuickTabs.get(quickTabId);
  
  if (!adoptionInfo) {
    adoptionCacheMetrics.missCount++;
    return { wasAdopted: false, newOriginTabId: null };
  }
  
  // v1.6.3.10-v11 - FIX Issue #5: Check per-entry TTL
  const entryAge = Date.now() - adoptionInfo.adoptedAt;
  const entryTTL = adoptionInfo.ttl ?? ADOPTION_DEFAULT_TTL_MS;
  
  if (entryAge > entryTTL) {
    adoptionCacheMetrics.ttlExpiredCount++;
    recentlyAdoptedQuickTabs.delete(quickTabId);
    
    console.log('[Content] ADOPTION_TTL_EXPIRED:', {
      quickTabId,
      entryAge,
      entryTTL,
      metrics: adoptionCacheMetrics
    });
    
    return { wasAdopted: false, newOriginTabId: null };
  }
  
  adoptionCacheMetrics.hitCount++;
  return { wasAdopted: true, newOriginTabId: adoptionInfo.newOriginTabId };
}

/**
 * Clean up expired adoption tracking entries
 * v1.6.3.10-v7 - FIX Issue #7
 * v1.6.3.10-v11 - FIX Issue #5: Use per-entry TTL for cleanup
 */
function _cleanupAdoptionTracking() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [quickTabId, adoptionInfo] of recentlyAdoptedQuickTabs) {
    const entryTTL = adoptionInfo.ttl ?? ADOPTION_DEFAULT_TTL_MS;
    if (now - adoptionInfo.adoptedAt > entryTTL) {
      recentlyAdoptedQuickTabs.delete(quickTabId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log('[Content] ADOPTION_CLEANUP:', {
      cleanedCount,
      remainingCount: recentlyAdoptedQuickTabs.size,
      metrics: adoptionCacheMetrics
    });
  }
}

// Start periodic cleanup of adoption tracking entries
setInterval(_cleanupAdoptionTracking, ADOPTION_CLEANUP_INTERVAL_MS);

// ==================== END ADOPTION-AWARE OWNERSHIP ====================

// ==================== v1.6.3.10-v7 STORAGE EVENT DE-DUPLICATION ====================
// FIX Issue #6: Prevent duplicate storage event handler executions

/**
 * Map of storage key -> { timestamp, version } for deduplication
 * v1.6.3.10-v7 - FIX Issue #6: Storage event de-duplication
 */
const recentStorageEvents = new Map();

/**
 * Base de-duplication window for storage events (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #6: 200ms window
 * v1.6.3.10-v11 - FIX Issue #12: Now a minimum, actual window is adaptive
 */
const STORAGE_EVENT_BASE_DEDUP_WINDOW_MS = 200;

/**
 * Maximum storage event dedup window (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #12: Cap to prevent excessive delays
 */
const STORAGE_EVENT_MAX_DEDUP_WINDOW_MS = 1000;

/**
 * Get adaptive storage event dedup window based on observed storage latency
 * v1.6.3.10-v11 - FIX Issue #12: Account for Firefox's async storage.onChanged timing (300-500ms)
 * Uses 2x observed latency, clamped to [200ms, 1000ms]
 * @returns {number} Dedup window in milliseconds
 */
function _getAdaptiveStorageEventDedupWindow() {
  // Use the same latency tracking as message dedup
  if (lastKnownBackgroundLatencyMs === null) {
    return STORAGE_EVENT_BASE_DEDUP_WINDOW_MS;
  }
  
  // v1.6.3.10-v11 - FIX Issue #12: Storage events can take 300-500ms to fire
  // Use 2x observed latency, with minimum of 500ms for storage events specifically
  const minStorageWindow = Math.max(STORAGE_EVENT_BASE_DEDUP_WINDOW_MS, 500);
  const adaptiveWindow = Math.min(
    Math.max(lastKnownBackgroundLatencyMs * 2, minStorageWindow),
    STORAGE_EVENT_MAX_DEDUP_WINDOW_MS
  );
  
  return adaptiveWindow;
}

/**
 * Check if storage event is a duplicate and should be skipped
 * v1.6.3.10-v7 - FIX Issue #6
 * @param {string} key - Storage key
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if duplicate that should be skipped
 */
/**
 * Check if event is within dedup window with same version
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce complexity
 * v1.6.3.10-v11 - FIX Issue #12: Use adaptive dedup window
 * @private
 */
function _isWithinDedupWindow(lastEvent, newVersion, now) {
  if (!lastEvent) return false;
  const timeSinceLastEvent = now - lastEvent.timestamp;
  // v1.6.3.10-v11 - FIX Issue #12: Use adaptive window instead of fixed constant
  const dedupWindowMs = _getAdaptiveStorageEventDedupWindow();
  const isDuplicate = timeSinceLastEvent < dedupWindowMs && lastEvent.version === newVersion;
  if (isDuplicate) {
    console.debug('[Content] STORAGE_EVENT_DUPLICATE:', { 
      timeSinceLastEvent, 
      version: newVersion,
      dedupWindowMs,
      observedLatencyMs: lastKnownBackgroundLatencyMs 
    });
  }
  return isDuplicate;
}

function _isStorageEventDuplicate(key, newValue) {
  const now = Date.now();
  const newVersion = newValue?.correlationId || newValue?.timestamp || null;
  
  if (_isWithinDedupWindow(recentStorageEvents.get(key), newVersion, now)) {
    return true;
  }
  
  // Track this event
  recentStorageEvents.set(key, { timestamp: now, version: newVersion });
  
  // Clean up old entries
  if (recentStorageEvents.size > 20) {
    _cleanupOldStorageEvents(now);
  }
  
  return false;
}

/**
 * Clean up old storage event tracking entries
 * v1.6.3.10-v7 - FIX Issue #6
 * v1.6.3.10-v11 - FIX Issue #12: Use adaptive dedup window for cleanup
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupOldStorageEvents(now) {
  // v1.6.3.10-v11 - FIX Issue #12: Use adaptive window for cleanup calculation
  const dedupWindowMs = _getAdaptiveStorageEventDedupWindow();
  const cutoff = now - dedupWindowMs * 10;
  for (const [key, eventInfo] of recentStorageEvents) {
    if (eventInfo.timestamp < cutoff) {
      recentStorageEvents.delete(key);
    }
  }
}

// ==================== END STORAGE EVENT DE-DUPLICATION ====================

// v1.6.3.4-v11 - FIX Issue #2: Message deduplication to prevent duplicate RESTORE_QUICK_TAB processing
// v1.6.3.10-v7 - FIX Issue #3: Adaptive dedup window based on handshake latency
// Map of quickTabId -> timestamp of last processed restore message
const recentRestoreMessages = new Map();

/**
 * Base dedup window (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #3: Minimum 2s window
 */
const BASE_RESTORE_DEDUP_WINDOW_MS = 2000;

/**
 * Maximum dedup window (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #3: Maximum 10s window
 */
const MAX_RESTORE_DEDUP_WINDOW_MS = 10000;

/**
 * Calculate adaptive dedup window based on observed latency
 * v1.6.3.10-v7 - FIX Issue #3: 2x observed latency, clamped to [2s, 10s]
 * @returns {number} Dedup window in milliseconds
 */
function _getAdaptiveDedupWindow() {
  if (lastKnownBackgroundLatencyMs === null) {
    return BASE_RESTORE_DEDUP_WINDOW_MS;
  }
  
  // 2x observed latency, clamped to range
  const adaptiveWindow = Math.min(
    Math.max(lastKnownBackgroundLatencyMs * 2, BASE_RESTORE_DEDUP_WINDOW_MS),
    MAX_RESTORE_DEDUP_WINDOW_MS
  );
  
  return adaptiveWindow;
}

/**
 * Check if restore message is a duplicate (within deduplication window)
 * v1.6.3.4-v11 - FIX Issue #2: Prevent duplicate restore processing
 * v1.6.3.10-v7 - FIX Issue #3: Use adaptive dedup window
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if this is a duplicate that should be rejected
 */
function _isDuplicateRestoreMessage(quickTabId) {
  const now = Date.now();
  const lastProcessed = recentRestoreMessages.get(quickTabId);
  const dedupWindowMs = _getAdaptiveDedupWindow();

  if (lastProcessed && now - lastProcessed < dedupWindowMs) {
    console.warn('[Content] BLOCKED duplicate RESTORE_QUICK_TAB:', {
      quickTabId,
      timeSinceLastRestore: now - lastProcessed,
      dedupWindowMs,
      lastKnownBackgroundLatencyMs,
      adaptive: lastKnownBackgroundLatencyMs !== null
    });
    return true;
  }

  // Update the timestamp
  recentRestoreMessages.set(quickTabId, now);

  // Clean up old entries to prevent memory leak
  if (recentRestoreMessages.size > 50) {
    _cleanupOldRestoreEntries(now);
  }

  return false;
}

/**
 * Clean up old entries from recentRestoreMessages Map
 * v1.6.3.4-v11 - FIX Issue #2: Extracted to reduce nesting depth
 * v1.6.3.10-v7 - FIX Issue #3: Use adaptive window for cutoff
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupOldRestoreEntries(now) {
  const dedupWindowMs = _getAdaptiveDedupWindow();
  const cutoff = now - dedupWindowMs * 5;
  for (const [id, timestamp] of recentRestoreMessages) {
    if (timestamp < cutoff) {
      recentRestoreMessages.delete(id);
    }
  }
}

/**
 * Build error response for manager action
 * v1.6.4.8 - Extracted for code health, uses options object to reduce args
 * @private
 * @param {Object} options - Error response options
 * @param {string} options.action - Action name
 * @param {string} options.quickTabId - Quick Tab ID
 * @param {number|null} options.currentTabId - Current tab ID
 * @param {string} options.error - Error message
 * @param {string} options.reason - Error reason code
 * @param {Object} [options.extra] - Additional properties to include
 */
function _buildActionErrorResponse(options) {
  const { action, quickTabId, currentTabId, error, reason, extra = {} } = options;
  return {
    success: false,
    action,
    quickTabId,
    originTabId: currentTabId,
    error,
    reason,
    completedAt: Date.now(),
    ...extra
  };
}

/**
 * Build success response for manager action
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _buildActionSuccessResponse(action, quickTabId, currentTabId, durationMs) {
  return {
    success: true,
    action,
    quickTabId,
    originTabId: currentTabId,
    durationMs,
    completedAt: Date.now()
  };
}

/**
 * Validate manager action prerequisites
 * v1.6.4.8 - Extracted for code health
 * @private
 * @returns {string|null} Error message if validation fails, null if valid
 */
function _validateManagerAction(quickTabId) {
  if (!quickTabsManager) return 'QuickTabsManager not initialized';
  if (!quickTabId) return 'Missing quickTabId';
  return null;
}

/**
 * Generic manager action handler wrapper
 * v1.6.3.4-v7 - FIX Issue #3: Check result from handler and send proper error responses
 * v1.6.3.7-v1 - FIX ISSUE #3 & #6: Enhanced confirmation response with structured format
 *   Response includes: success, action, quickTabId, originTabId, reason, completedAt
 * v1.6.4.8 - Refactored to reduce LoC from 70 to <50
 * @private
 */
function _handleManagerAction(quickTabId, action, actionFn, sendResponse) {
  const startTime = Date.now();
  const currentTabId = quickTabsManager?.currentTabId;

  try {
    // Validate prerequisites
    const validationError = _validateManagerAction(quickTabId);
    if (validationError) {
      const isManagerNotReady = !quickTabsManager;
      const reason = isManagerNotReady ? 'manager_not_ready' : 'invalid_params';
      // Log warning only if manager not ready (avoid nested if)
      isManagerNotReady && console.warn('[Content] QuickTabsManager not initialized');
      sendResponse(
        _buildActionErrorResponse({
          action,
          quickTabId,
          currentTabId,
          error: validationError,
          reason
        })
      );
      return;
    }

    // Execute action and check result
    const result = actionFn(quickTabId);

    if (_isActionFailure(result)) {
      console.warn(`[Content] ${action} Quick Tab failed (source: Manager): ${quickTabId}`, result);
      sendResponse(
        _buildActionErrorResponse({
          action,
          quickTabId,
          currentTabId,
          error: _getActionError(result),
          reason: 'handler_failed',
          extra: { handlerResult: result }
        })
      );
      return;
    }

    // Success
    const durationMs = Date.now() - startTime;
    console.log(`[Content] ✅ ${action} Quick Tab (source: Manager): ${quickTabId}`, {
      durationMs,
      originTabId: currentTabId
    });
    sendResponse(_buildActionSuccessResponse(action, quickTabId, currentTabId, durationMs));
  } catch (error) {
    console.error(`[Content] Error ${action.toLowerCase()} Quick Tab:`, error);
    sendResponse(
      _buildActionErrorResponse({
        action,
        quickTabId,
        currentTabId,
        error: error.message,
        reason: 'exception'
      })
    );
  }
}

/**
 * Check if Quick Tab is owned by current tab
 * v1.6.4.8 - Extracted predicate for code health
 * @private
 * @param {string} quickTabId - Quick Tab ID to check
 * @returns {{ hasInMap: boolean, hasSnapshot: boolean, currentTabId: number|null }} Ownership info
 */
function _getQuickTabOwnership(quickTabId) {
  return {
    hasInMap: quickTabsManager?.tabs?.has(quickTabId) ?? false,
    hasSnapshot: quickTabsManager?.minimizedManager?.hasSnapshot?.(quickTabId) ?? false,
    currentTabId: quickTabsManager?.currentTabId ?? null
  };
}

/**
 * Log deletion receipt with correlation ID
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _logDeletionReceipt(correlationId, quickTabId, ownership, source) {
  if (!correlationId) return;
  console.log('[Content] 🗑️ DELETION RECEIVED:', {
    correlationId,
    quickTabId,
    receiverTabId: ownership.currentTabId,
    hasInMap: ownership.hasInMap,
    hasSnapshot: ownership.hasSnapshot,
    source,
    timestamp: Date.now()
  });
}

/**
 * Log deletion applied with correlation ID
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _logDeletionApplied(correlationId, quickTabId, currentTabId) {
  if (!correlationId) return;
  console.log('[Content] 🗑️ DELETION APPLIED:', {
    correlationId,
    quickTabId,
    receiverTabId: currentTabId,
    stateApplied: true,
    timestamp: Date.now()
  });
}

/**
 * Handle close for Quick Tab not present in this tab
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _handleCloseNotPresent(quickTabId, sendResponse, source, ownership) {
  if (source !== 'background-broadcast') return false;

  console.log('[Content] CLOSE_QUICK_TAB: Ignoring broadcast - Quick Tab not owned by this tab:', {
    quickTabId,
    currentTabId: ownership.currentTabId,
    source
  });
  sendResponse({
    success: true,
    message: 'Quick Tab not present in this tab',
    quickTabId,
    reason: 'not-present'
  });
  return true;
}

/**
 * Handle close via background broadcast (direct destroy, no re-broadcast)
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _handleCloseFromBroadcast(quickTabId, sendResponse, correlationId, ownership) {
  console.log('[Content] CLOSE_QUICK_TAB: Processing background broadcast:', {
    quickTabId,
    currentTabId: ownership.currentTabId,
    hasInMap: ownership.hasInMap,
    hasSnapshot: ownership.hasSnapshot
  });

  _handleManagerAction(
    quickTabId,
    'Closed (from broadcast)',
    id => {
      if (quickTabsManager?.destroyHandler?.handleDestroy) {
        quickTabsManager.destroyHandler.handleDestroy(id, 'background-broadcast');
      }
      _logDeletionApplied(correlationId, quickTabId, ownership.currentTabId);
    },
    sendResponse
  );
}

/**
 * Handle CLOSE_QUICK_TAB message
 * v1.6.3.7 - FIX Issue #3: Handle broadcasts from background
 *   When source is 'background-broadcast', do local cleanup without re-broadcasting.
 *   When source is 'Manager' or other, use standard closeById() path.
 * v1.6.3.6-v5 - FIX Issue #4e: Added deletion receipt logging with correlation ID
 * v1.6.4.8 - Refactored to reduce complexity (cc=16 -> cc<9)
 * @private
 * @param {string} quickTabId - Quick Tab ID to close
 * @param {Function} sendResponse - Response callback
 * @param {string} source - Source of the close request ('Manager', 'background-broadcast', etc.)
 * @param {string} correlationId - Correlation ID for end-to-end tracing (optional)
 */
function _handleCloseQuickTab(quickTabId, sendResponse, source = 'Manager', correlationId = null) {
  const ownership = _getQuickTabOwnership(quickTabId);

  _logDeletionReceipt(correlationId, quickTabId, ownership, source);

  // Guard: Quick Tab not present - handle for background broadcasts
  if (!ownership.hasInMap && !ownership.hasSnapshot) {
    if (_handleCloseNotPresent(quickTabId, sendResponse, source, ownership)) return;
  }

  // Background broadcast path: direct destroy without re-broadcast
  if (source === 'background-broadcast') {
    _handleCloseFromBroadcast(quickTabId, sendResponse, correlationId, ownership);
    return;
  }

  // Standard path: closeById() triggers full destroy flow
  _handleManagerAction(
    quickTabId,
    'Closed',
    id => quickTabsManager.destroyHandler.closeById(id, source),
    sendResponse
  );
}

/**
 * Handle MINIMIZE_QUICK_TAB message with cross-tab filtering
 * v1.6.3.6 - FIX Issue #1: Add cross-tab filtering to prevent operations on non-owned Quick Tabs
 * @private
 * @param {string} quickTabId - Quick Tab ID to minimize
 * @param {Function} sendResponse - Response callback
 */
function _handleMinimizeQuickTab(quickTabId, sendResponse) {
  // v1.6.3.6 - FIX Issue #1: Cross-tab filtering for minimize requests
  const hasInMap = quickTabsManager?.tabs?.has(quickTabId);
  const currentTabId = quickTabsManager?.currentTabId;

  if (!hasInMap) {
    console.log(
      '[Content] MINIMIZE_QUICK_TAB: Ignoring broadcast - Quick Tab not owned by this tab:',
      {
        quickTabId,
        currentTabId,
        hasInMap,
        reason: 'cross-tab filtering'
      }
    );
    sendResponse({
      success: false,
      error: 'Quick Tab not owned by this tab',
      quickTabId,
      currentTabId,
      reason: 'cross-tab-filtered'
    });
    return;
  }

  _handleManagerAction(
    quickTabId,
    'Minimized',
    id => quickTabsManager.minimizeById(id, 'Manager'),
    sendResponse
  );
}

/**
 * Extract tab ID from Quick Tab ID pattern
 * v1.6.3.6-v8 - FIX Issue #4: Fallback extraction from ID pattern for Manager restore
 * Quick Tab IDs follow pattern: qt-{tabId}-{timestamp}-{random}
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {number|null} Extracted tab ID or null
 */
function _extractTabIdFromQuickTabId(quickTabId) {
  if (!quickTabId || typeof quickTabId !== 'string') return null;
  const match = quickTabId.match(/^qt-(\d+)-/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Log ownership divergence warning when pattern and adoption mismatch
 * v1.6.3.10-v7 - FIX Issue #7: Extracted to reduce complexity
 * @private
 */
function _logOwnershipDivergence(quickTabId, extractedTabId, adoptionInfo, currentTabId) {
  if (!adoptionInfo.wasAdopted || extractedTabId === null) return;
  if (extractedTabId === adoptionInfo.newOriginTabId) return;
  
  console.warn('[Content] OWNERSHIP_DIVERGENCE: Pattern and adoption ownership mismatch:', {
    quickTabId,
    patternTabId: extractedTabId,
    adoptedOwnerTabId: adoptionInfo.newOriginTabId,
    currentTabId
  });
}

/**
 * Determine if this tab owns the Quick Tab
 * v1.6.3.10-v7 - FIX Issue #7: Extracted to reduce complexity
 * @private
 */
function _determineOwnership(ownership, matchesAdoptedOwnership, wasAdopted, matchesIdPattern) {
  // Direct ownership (in map or snapshot) takes highest precedence
  if (ownership.hasInMap || ownership.hasSnapshot) return true;
  // Adoption ownership takes precedence over pattern extraction
  if (matchesAdoptedOwnership) return true;
  // Pattern match only counts if not adopted
  return !wasAdopted && matchesIdPattern;
}

/**
 * Build restore ownership info with ID pattern fallback
 * v1.6.4.8 - Extracted for code health
 * v1.6.3.10-v7 - FIX Issue #7: Adoption-aware ownership validation
 * @private
 * @param {string} quickTabId - Quick Tab ID to check
 * @returns {Object} Ownership details including ID pattern match and adoption info
 */
function _getRestoreOwnership(quickTabId) {
  const ownership = _getQuickTabOwnership(quickTabId);
  const extractedTabId = _extractTabIdFromQuickTabId(quickTabId);
  const matchesIdPattern = extractedTabId !== null && extractedTabId === ownership.currentTabId;
  
  // v1.6.3.10-v7 - FIX Issue #7: Check adoption cache
  const adoptionInfo = _getAdoptionOwnership(quickTabId);
  const matchesAdoptedOwnership = adoptionInfo.wasAdopted && 
    adoptionInfo.newOriginTabId === ownership.currentTabId;
  
  // Log warning if pattern and adoption ownership diverge
  _logOwnershipDivergence(quickTabId, extractedTabId, adoptionInfo, ownership.currentTabId);

  return {
    ...ownership,
    extractedTabId,
    matchesIdPattern,
    wasAdopted: adoptionInfo.wasAdopted,
    adoptedOwnerTabId: adoptionInfo.newOriginTabId,
    matchesAdoptedOwnership,
    ownsQuickTab: _determineOwnership(ownership, matchesAdoptedOwnership, adoptionInfo.wasAdopted, matchesIdPattern)
  };
}

/**
 * Send cross-tab filtered rejection response
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _sendCrossTabFilteredResponse(quickTabId, sendResponse, restoreOwnership) {
  console.log(
    '[Content] RESTORE_QUICK_TAB: Ignoring broadcast - Quick Tab not owned by this tab:',
    {
      quickTabId,
      currentTabId: restoreOwnership.currentTabId,
      hasInMap: restoreOwnership.hasInMap,
      hasSnapshot: restoreOwnership.hasSnapshot,
      extractedTabId: restoreOwnership.extractedTabId,
      matchesIdPattern: restoreOwnership.matchesIdPattern,
      reason: 'cross-tab filtering'
    }
  );
  sendResponse({
    success: false,
    error: 'Quick Tab not owned by this tab',
    quickTabId,
    currentTabId: restoreOwnership.currentTabId,
    reason: 'cross-tab-filtered'
  });
}

/**
 * Handle RESTORE_QUICK_TAB message with deduplication and cross-tab filtering
 * v1.6.3.4-v11 - FIX Issue #2: Prevent duplicate restore processing
 * v1.6.3.6 - FIX Issue #1: Add cross-tab filtering to prevent ghost Quick Tabs
 *   Check if Quick Tab belongs to this tab before attempting restore.
 *   Quick Tabs should only render in the tab that created them (originTabId).
 * v1.6.3.6-v8 - FIX Issue #4: Add ID pattern extraction fallback for Manager restore
 *   When a Quick Tab is minimized and the page is reloaded, quickTabsMap and
 *   minimizedManager may be empty - but the Quick Tab still belongs to this tab.
 *   Use the tab ID embedded in the Quick Tab ID pattern as a fallback check.
 * v1.6.4.8 - Refactored to reduce complexity (cc=12 -> cc<9)
 * v1.6.3.10-v10 - FIX Issue R: Enforce ordering for storage-dependent RESTORE operations
 * @private
 * @param {string} quickTabId - Quick Tab ID to restore
 * @param {Function} sendResponse - Response callback
 * @param {number} [messageSequenceId] - Optional sequence ID from message for ordering
 */
function _handleRestoreQuickTab(quickTabId, sendResponse, messageSequenceId = undefined) {
  // Guard: Deduplicate restore within window
  if (_isDuplicateRestoreMessage(quickTabId)) {
    sendResponse({
      success: false,
      error: 'Duplicate restore request rejected',
      quickTabId,
      reason: 'deduplication'
    });
    return;
  }

  // v1.6.3.10-v10 - FIX Issue R: Check ordering enforcement
  const orderingCheck = _checkRestoreOrderingEnforcement(quickTabId, messageSequenceId);
  if (!orderingCheck.allowed) {
    sendResponse({
      success: false,
      error: 'RESTORE operation rejected due to ordering violation',
      quickTabId,
      reason: orderingCheck.reason,
      orderingDetails: orderingCheck.details
    });
    return;
  }

  const restoreOwnership = _getRestoreOwnership(quickTabId);

  console.log('[Content] RESTORE_QUICK_TAB: Ownership check:', {
    quickTabId,
    currentTabId: restoreOwnership.currentTabId,
    hasInMap: restoreOwnership.hasInMap,
    hasSnapshot: restoreOwnership.hasSnapshot,
    extractedTabId: restoreOwnership.extractedTabId,
    matchesIdPattern: restoreOwnership.matchesIdPattern,
    ownsQuickTab: restoreOwnership.ownsQuickTab,
    orderingSequence: orderingCheck.details.effectiveSequence
  });

  // Guard: Cross-tab filtering
  if (!restoreOwnership.ownsQuickTab) {
    _markRestoreComplete(quickTabId, false);
    _sendCrossTabFilteredResponse(quickTabId, sendResponse, restoreOwnership);
    return;
  }

  console.log('[Content] RESTORE_QUICK_TAB: Processing - Quick Tab is owned by this tab:', {
    quickTabId,
    currentTabId: restoreOwnership.currentTabId,
    hasInMap: restoreOwnership.hasInMap,
    hasSnapshot: restoreOwnership.hasSnapshot
  });

  // v1.6.3.10-v10 - FIX Issue R: Log which RESTORE operation owns which Quick Tab after execution
  _handleManagerAction(
    quickTabId,
    'Restored',
    id => {
      const result = quickTabsManager.restoreById(id, 'Manager');
      console.log('[Content] v1.6.3.10-v10 RESTORE_OWNERSHIP_RESULT:', {
        quickTabId: id,
        currentTabId: restoreOwnership.currentTabId,
        orderingSequence: orderingCheck.details.effectiveSequence,
        restoreResult: result,
        timestamp: Date.now()
      });
      _markRestoreComplete(id, true);
      return result;
    },
    sendResponse
  );
}

// ==================== MESSAGE HANDLER FUNCTIONS ====================
// Extracted from message listener to reduce complexity and nesting depth

/**
 * Handle GET_CONTENT_LOGS action
 * @private
 */
function _handleGetContentLogs(sendResponse) {
  console.log('[Content] Received GET_CONTENT_LOGS request');
  try {
    const consoleLogs = getConsoleLogs();
    const debugLogs = getLogBuffer();
    const allLogs = [...consoleLogs, ...debugLogs];
    allLogs.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Content] Sending ${allLogs.length} logs to popup`);
    console.log(`[Content] Console logs: ${consoleLogs.length}, Debug logs: ${debugLogs.length}`);

    const stats = getBufferStats();
    console.log('[Content] Buffer stats:', stats);

    sendResponse({ logs: allLogs, stats });
  } catch (error) {
    console.error('[Content] Error getting log buffer:', error);
    sendResponse({ logs: [], error: error.message });
  }
}

/**
 * Generic try/catch wrapper for action handlers with standard response format
 * v1.6.3.10-v8 - FIX Code Health: Consolidated duplicate handler pattern
 * @private
 * @param {Function} action - Action to execute
 * @param {Function} sendResponse - Response callback  
 * @param {string} timestampField - Field name for timestamp (e.g. 'clearedAt')
 * @param {string} errorContext - Error log context
 */
function _executeWithResponse(action, sendResponse, timestampField, errorContext) {
  try {
    action();
    sendResponse({ success: true, [timestampField]: Date.now() });
  } catch (error) {
    console.error(`[Content] Error ${errorContext}:`, error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle CLEAR_CONTENT_LOGS action
 * @private
 */
function _handleClearContentLogs(sendResponse) {
  _executeWithResponse(
    () => { clearConsoleLogs(); clearLogBuffer(); },
    sendResponse, 'clearedAt', 'clearing log buffer'
  );
}

/**
 * Handle REFRESH_LIVE_CONSOLE_FILTERS action
 * @private
 */
function _handleRefreshLiveConsoleFilters(sendResponse) {
  _executeWithResponse(
    refreshLiveConsoleSettings,
    sendResponse, 'refreshedAt', 'refreshing live console filters'
  );
}

/**
 * Handle CLOSE_MINIMIZED_QUICK_TABS action (legacy)
 * @private
 */
function _handleCloseMinimizedQuickTabs(sendResponse) {
  console.log('[Content] Received CLOSE_MINIMIZED_QUICK_TABS request (legacy)');
  sendResponse({ success: true, message: 'Handled by individual CLOSE_QUICK_TAB messages' });
}

/**
 * Handle ADOPTION_COMPLETED broadcast from background
 * v1.6.4.13 - FIX BUG #4: Cross-Tab Restore Using Wrong Tab Context
 * v1.6.4.15 - FIX Issue #22: Update MinimizedManager snapshot originTabId after adoption
 *
 * This handler updates the local Quick Tab cache when adoption occurs.
 * Without this, content scripts have stale originTabId values which causes
 * restore operations to target the wrong tab after adoption.
 *
 * @private
 * @param {Object} message - Adoption completion message
 * @param {string} message.adoptedQuickTabId - The Quick Tab that was adopted
 * @param {number} message.previousOriginTabId - The old owner tab ID
 * @param {number} message.newOriginTabId - The new owner tab ID
 * @param {number} message.timestamp - When adoption occurred
 * @param {Function} sendResponse - Response callback
 */
/**
 * Generic helper to update originTabId on an object with logging
 * v1.6.3.10-v8 - FIX Code Health: Consolidated duplicate update functions
 * NOTE: Intentionally mutates target in-place and returns boolean for update tracking.
 * The boolean return is used to aggregate whether any updates occurred.
 * @private
 * @param {Object} target - Object with originTabId property (mutated in-place)
 * @param {string} adoptedQuickTabId - Quick Tab ID being adopted
 * @param {number} newOriginTabId - New origin tab ID
 * @param {string} location - Location name for logging
 * @returns {boolean} True if target was mutated, false if target was null
 */
function _updateOriginTabIdWithLog(target, adoptedQuickTabId, newOriginTabId, location) {
  if (!target) return false;
  console.log('[Content] ADOPTION_CACHE_UPDATE:', {
    adoptedQuickTabId, oldOriginTabId: target.originTabId, newOriginTabId, location
  });
  target.originTabId = newOriginTabId;
  return true;
}

/**
 * Update tab entry's originTabId for adoption
 * @private
 */
function _updateTabEntryOriginTabId(tabEntry, adoptedQuickTabId, newOriginTabId) {
  return _updateOriginTabIdWithLog(tabEntry, adoptedQuickTabId, newOriginTabId, 'tabs-map');
}

/**
 * Update minimized snapshot's originTabId for adoption
 * @private
 */
function _updateMinimizedSnapshotOriginTabId(snapshot, adoptedQuickTabId, newOriginTabId) {
  return _updateOriginTabIdWithLog(snapshot, adoptedQuickTabId, newOriginTabId, 'minimized-snapshot');
}

/**
 * Handle ADOPTION_COMPLETED broadcast from background
 * v1.6.4.13 - FIX BUG #4: Cross-Tab Restore Using Wrong Tab Context
 * v1.6.4.15 - FIX Issue #22: Update MinimizedManager snapshot originTabId after adoption
 * v1.6.4.16 - FIX Code Health: Refactored to reduce line count (95 -> ~55)
 *
 * @private
 * @param {Object} message - Adoption completion message
 * @param {Function} sendResponse - Response callback
 */
/**
 * Update MinimizedManager snapshot via API if available
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce _handleAdoptionCompleted complexity
 * @private
 */
function _tryUpdateMinimizedManagerSnapshot(adoptedQuickTabId, newOriginTabId, previousOriginTabId) {
  if (!quickTabsManager?.minimizedManager?.updateSnapshotOriginTabId) return false;
  return quickTabsManager.minimizedManager.updateSnapshotOriginTabId(
    adoptedQuickTabId, newOriginTabId, previousOriginTabId
  );
}

function _handleAdoptionCompleted(message, sendResponse) {
  const { adoptedQuickTabId, previousOriginTabId, newOriginTabId, timestamp } = message;
  const currentTabId = quickTabsManager?.currentTabId ?? null;

  // Track adoption and get cache state
  _trackAdoptedQuickTab(adoptedQuickTabId, newOriginTabId);
  const tabEntry = quickTabsManager?.tabs?.get(adoptedQuickTabId);
  const minimizedSnapshot = quickTabsManager?.minimizedManager?.getSnapshot?.(adoptedQuickTabId);

  console.log('[Content] ADOPTION_COMPLETED received:', {
    adoptedQuickTabId, previousOriginTabId, newOriginTabId, currentTabId,
    hasInMap: !!tabEntry, hasSnapshot: !!minimizedSnapshot
  });

  // Update caches
  const tabUpdated = _updateTabEntryOriginTabId(tabEntry, adoptedQuickTabId, newOriginTabId);
  const directSnapshotUpdated = _updateMinimizedSnapshotOriginTabId(minimizedSnapshot, adoptedQuickTabId, newOriginTabId);
  const cacheUpdated = tabUpdated || directSnapshotUpdated;
  const snapshotUpdated = _tryUpdateMinimizedManagerSnapshot(adoptedQuickTabId, newOriginTabId, previousOriginTabId);

  console.log('[Content] ADOPTION_COMPLETED completed:', {
    adoptedQuickTabId, cacheUpdated, snapshotUpdated, timeSinceAdoption: Date.now() - timestamp
  });

  sendResponse({ success: true, cacheUpdated, snapshotUpdated, currentTabId, timestamp: Date.now() });
}

// ==================== v1.6.4.14 FIX Issue #17: TAB ACTIVATED HANDLER ====================
// Handle tabActivated action from background when a tab becomes active
// This enables content script hydration and adoption state refresh

/**
 * Handle tabActivated message from background
 * v1.6.4.14 - FIX Issue #17: Missing tabActivated handler in content script
 *
 * This handler is called when background broadcasts tabActivated due to
 * chrome.tabs.onActivated. It triggers:
 * 1. Hydration if Quick Tabs exist for this tab
 * 2. Update currentTabId context
 * 3. Refresh adoption state
 *
 * @private
 * @param {Object} message - Tab activated message
 * @param {number} message.tabId - The tab ID that was activated
 * @param {Function} sendResponse - Response callback
 */
function _handleTabActivated(message, sendResponse) {
  const { tabId } = message;
  const currentTabId = quickTabsManager?.currentTabId ?? null;

  console.log('[Content] TAB_ACTIVATED_HANDLER: Processing tab activation:', {
    receivedTabId: tabId,
    currentTabId,
    hasQuickTabsManager: !!quickTabsManager,
    timestamp: Date.now()
  });

  // v1.6.4.14 - FIX Issue #16: Refresh adoption state on tab activation
  // After adoption, content scripts need to refresh their cache to pick up
  // new originTabId values
  let stateUpdated = false;

  // Update currentTabId if provided and manager exists
  if (quickTabsManager && typeof tabId === 'number') {
    // Note: We don't update currentTabId here as it should remain the tab's own ID
    // The tabId in the message is which tab was activated (this one)
    console.log('[Content] TAB_ACTIVATED_HANDLER: Tab is now active:', {
      tabId,
      isThisTab: tabId === currentTabId
    });
  }

  // Trigger hydration if Quick Tabs manager exists
  // This helps restore state after tab becomes visible
  if (quickTabsManager?.hydrateFromStorage) {
    console.log('[Content] TAB_ACTIVATED_HANDLER: Triggering hydration');
    try {
      // Trigger async hydration (don't await in handler)
      quickTabsManager.hydrateFromStorage().then(result => {
        console.log('[Content] TAB_ACTIVATED_HANDLER: Hydration complete:', result);
      }).catch(err => {
        console.warn('[Content] TAB_ACTIVATED_HANDLER: Hydration failed:', err.message);
      });
      stateUpdated = true;
    } catch (err) {
      console.warn('[Content] TAB_ACTIVATED_HANDLER: Hydration error:', err.message);
    }
  }

  sendResponse({
    success: true,
    handled: true,
    stateUpdated,
    currentTabId,
    timestamp: Date.now()
  });
}

/**
 * Handle SYNC_QUICK_TAB_STATE_FROM_BACKGROUND message
 * v1.6.4.14 - FIX Issue #17: State sync on tab activation
 *
 * Background sends full Quick Tab state when a tab becomes active.
 * This ensures content script has latest state including any adoption changes.
 *
 * @private
 * @param {Object} message - State sync message
 * @param {Object} message.state - Full Quick Tab state from background
 * @param {Array} message.state.tabs - Array of Quick Tab objects
 * @param {number} message.state.lastUpdate - Timestamp of last update
 * @param {Function} sendResponse - Response callback
 */
function _handleStateSyncFromBackground(message, sendResponse) {
  const { state } = message;
  const currentTabId = quickTabsManager?.currentTabId ?? null;

  console.log('[Content] STATE_SYNC_FROM_BACKGROUND: Processing state sync:', {
    tabCount: state?.tabs?.length ?? 0,
    lastUpdate: state?.lastUpdate,
    currentTabId,
    timestamp: Date.now()
  });

  if (!state?.tabs || !Array.isArray(state.tabs)) {
    console.log('[Content] STATE_SYNC_FROM_BACKGROUND: No tabs in state');
    sendResponse({
      success: true,
      synced: false,
      reason: 'no-tabs-in-state',
      timestamp: Date.now()
    });
    return;
  }

  // v1.6.4.14 - FIX Issue #16: Update local cache with new originTabId values from adoption
  const updatedCount = _syncStateTabs(state.tabs, currentTabId);

  console.log('[Content] STATE_SYNC_FROM_BACKGROUND: Sync complete:', {
    totalTabs: state.tabs.length,
    updatedCount,
    currentTabId,
    timestamp: Date.now()
  });

  sendResponse({
    success: true,
    synced: true,
    updatedCount,
    totalTabs: state.tabs.length,
    timestamp: Date.now()
  });
}

/**
 * Sync tabs from state to local cache
 * v1.6.4.14 - Extracted to reduce complexity
 * @private
 * @param {Array} tabs - Array of tab data objects
 * @param {number|null} currentTabId - Current tab ID
 * @returns {number} Count of updated entries
 */
function _syncStateTabs(tabs, currentTabId) {
  let updatedCount = 0;

  for (const tabData of tabs) {
    updatedCount += _syncSingleTabEntry(tabData);
    updatedCount += _syncSingleTabSnapshot(tabData);
    _trackAdoptionIfNeeded(tabData, currentTabId);
  }

  return updatedCount;
}

/**
 * Generic helper to sync originTabId on target object
 * v1.6.3.10-v8 - FIX Code Health: Consolidated duplicate sync functions
 * @private
 * @param {Object} target - Object with originTabId property
 * @param {Object} tabData - Tab data with new originTabId
 * @param {string} location - Location name for logging
 * @returns {number} 1 if updated, 0 otherwise
 */
function _syncOriginTabId(target, tabData, location) {
  if (!target || target.originTabId === tabData.originTabId) return 0;
  console.log(`[Content] STATE_SYNC_FROM_BACKGROUND: Updating ${location}:`, {
    quickTabId: tabData.id, oldOriginTabId: target.originTabId, newOriginTabId: tabData.originTabId
  });
  target.originTabId = tabData.originTabId;
  return 1;
}

/**
 * Sync single tab entry in tabs map
 * @private
 */
function _syncSingleTabEntry(tabData) {
  const tabEntry = quickTabsManager?.tabs?.get(tabData.id);
  return _syncOriginTabId(tabEntry, tabData, 'originTabId');
}

/**
 * Sync single tab snapshot in minimized manager
 * @private
 */
function _syncSingleTabSnapshot(tabData) {
  const snapshot = quickTabsManager?.minimizedManager?.getSnapshot?.(tabData.id);
  return _syncOriginTabId(snapshot, tabData, 'snapshot originTabId');
}

/**
 * Track adoption if tab belongs to different origin
 * v1.6.4.14 - Extracted to reduce complexity
 * @private
 */
function _trackAdoptionIfNeeded(tabData, currentTabId) {
  if (tabData.originTabId !== currentTabId) {
    _trackAdoptedQuickTab(tabData.id, tabData.originTabId);
  }
}

// ==================== END TAB ACTIVATED HANDLER ====================

// ==================== TEST BRIDGE HANDLER FUNCTIONS ====================
// v1.6.3.6-v11 - FIX Bundle Size Issue #3: Conditional test infrastructure
// Test handlers are only included in test builds (process.env.TEST_MODE === 'true')
// In production builds, this entire block is eliminated by dead code removal

// Single constant for test mode check to ensure consistency
const IS_TEST_MODE = process.env.TEST_MODE === 'true';

let _testHandleCreateQuickTab;
let _testHandleMinimizeQuickTab;
let _testHandleRestoreQuickTab;
let _testHandlePinQuickTab;
let _testHandleUnpinQuickTab;
let _testHandleCloseQuickTab;
let _testHandleClearAllQuickTabs;
let _testHandleToggleSolo;
let _testHandleToggleMute;
let _testHandleGetVisibilityState;
let _testHandleGetManagerState;
let _testHandleSetManagerPosition;
let _testHandleSetManagerSize;
let _testHandleCloseAllMinimized;
let _testHandleGetContainerInfo;
let _testHandleCreateQuickTabInContainer;
let _testHandleVerifyContainerIsolation;
let _testHandleGetSlotNumbering;
let _testHandleSetDebugMode;
let _testHandleGetQuickTabGeometry;
let _testHandleVerifyZIndexOrder;

// Only define test handlers when TEST_MODE is enabled
if (IS_TEST_MODE) {
  /**
   * Verify QuickTabsManager is initialized
   * @private
   */
  const _requireQuickTabsManager = () => {
    if (!quickTabsManager) {
      throw new Error('QuickTabsManager not initialized');
    }
    return quickTabsManager;
  };

  /**
   * Generic sync test handler wrapper to reduce duplication
   * @private
   */
  const _wrapSyncTestHandler = (name, handler) => {
    return (data, sendResponse) => {
      console.log(`[Test Bridge Handler] ${name}:`, data);
      try {
        const result = handler(_requireQuickTabsManager(), data);
        sendResponse({ success: true, ...result });
      } catch (error) {
        console.error(`[Test Bridge Handler] ${name} error:`, error);
        sendResponse({ success: false, error: error.message });
      }
    };
  };

  /**
   * Generic async test handler wrapper to reduce duplication
   * @private
   */
  const _wrapAsyncTestHandler = (name, handler) => {
    return (data, sendResponse) => {
      console.log(`[Test Bridge Handler] ${name}:`, data);
      (async () => {
        try {
          const result = await handler(_requireQuickTabsManager(), data);
          sendResponse({ success: true, ...result });
        } catch (error) {
          console.error(`[Test Bridge Handler] ${name} error:`, error);
          sendResponse({ success: false, error: error.message });
        }
      })();
    };
  };

  // Test handler implementations using wrapper pattern
  _testHandleCreateQuickTab = _wrapSyncTestHandler('TEST_CREATE_QUICK_TAB', (manager, data) => {
    const { url, options = {} } = data;
    manager.createQuickTab({ url, title: options.title || 'Test Quick Tab', ...options });
    return { message: 'Quick Tab created', data: { url, options } };
  });

  _testHandleMinimizeQuickTab = _wrapSyncTestHandler('TEST_MINIMIZE_QUICK_TAB', (manager, data) => {
    manager.minimizeById(data.id);
    return { message: 'Quick Tab minimized', data: { id: data.id } };
  });

  _testHandleRestoreQuickTab = _wrapSyncTestHandler('TEST_RESTORE_QUICK_TAB', (manager, data) => {
    manager.restoreById(data.id);
    return { message: 'Quick Tab restored', data: { id: data.id } };
  });

  _testHandlePinQuickTab = _wrapAsyncTestHandler('TEST_PIN_QUICK_TAB', async (manager, data) => {
    const tab = manager.tabs.get(data.id);
    if (!tab) throw new Error(`Quick Tab not found: ${data.id}`);
    const currentUrl = window.location.href;
    tab.pinnedToUrl = currentUrl;
    await manager.storage.saveQuickTab(tab);
    return { message: 'Quick Tab pinned', data: { id: data.id, pinnedToUrl: currentUrl } };
  });

  _testHandleUnpinQuickTab = _wrapAsyncTestHandler(
    'TEST_UNPIN_QUICK_TAB',
    async (manager, data) => {
      const tab = manager.tabs.get(data.id);
      if (!tab) throw new Error(`Quick Tab not found: ${data.id}`);
      tab.pinnedToUrl = null;
      await manager.storage.saveQuickTab(tab);
      return { message: 'Quick Tab unpinned', data: { id: data.id } };
    }
  );

  _testHandleCloseQuickTab = _wrapSyncTestHandler('TEST_CLOSE_QUICK_TAB', (manager, data) => {
    manager.closeById(data.id);
    return { message: 'Quick Tab closed', data: { id: data.id } };
  });

  _testHandleClearAllQuickTabs = _wrapSyncTestHandler('TEST_CLEAR_ALL_QUICK_TAB', manager => {
    const tabIds = Array.from(manager.tabs.keys());
    manager.closeAll();
    return { message: 'All Quick Tabs cleared', data: { count: tabIds.length } };
  });

  /**
   * Get domain tab and validate it exists
   * @private
   */
  const _getDomainTab = (manager, id) => {
    const tab = manager.tabs.get(id);
    if (!tab) throw new Error(`Quick Tab not found: ${id}`);
    const domainTab = tab.domainTab;
    if (!domainTab) throw new Error(`Domain model not found for Quick Tab: ${id}`);
    return { tab, domainTab };
  };

  /**
   * Generic visibility toggle handler (Solo/Mute)
   * @private
   */
  const _toggleVisibility = (manager, data, toggleFn, mode) => {
    const { id, tabId } = data;
    const { domainTab } = _getDomainTab(manager, id);
    const isNowActive = toggleFn.call(domainTab, tabId);

    if (manager.broadcast) {
      const broadcastData =
        mode === 'SOLO'
          ? { id, tabId, isNowSoloed: isNowActive, soloedOnTabs: domainTab.visibility.soloedOnTabs }
          : { id, tabId, isNowMuted: isNowActive, mutedOnTabs: domainTab.visibility.mutedOnTabs };
      manager.broadcast.broadcastMessage(mode, broadcastData);
    }

    return {
      message: isNowActive ? `${mode} enabled` : `${mode} disabled`,
      data: {
        id,
        tabId,
        ...(mode === 'SOLO' ? { isNowSoloed: isNowActive } : { isNowMuted: isNowActive }),
        soloedOnTabs: domainTab.visibility.soloedOnTabs,
        mutedOnTabs: domainTab.visibility.mutedOnTabs
      }
    };
  };

  _testHandleToggleSolo = _wrapAsyncTestHandler('TEST_TOGGLE_SOLO', async (manager, data) => {
    const { domainTab } = _getDomainTab(manager, data.id);
    const result = _toggleVisibility(manager, data, domainTab.toggleSolo, 'SOLO');
    await manager.storage.saveQuickTab(domainTab);
    return result;
  });

  _testHandleToggleMute = _wrapAsyncTestHandler('TEST_TOGGLE_MUTE', async (manager, data) => {
    const { domainTab } = _getDomainTab(manager, data.id);
    const result = _toggleVisibility(manager, data, domainTab.toggleMute, 'MUTE');
    await manager.storage.saveQuickTab(domainTab);
    return result;
  });

  /**
   * Process a single tab for visibility state
   * @private
   */
  const _processTabVisibility = (id, tab, tabId, visibilityState) => {
    const domainTab = tab.domainTab;
    if (!domainTab) return;

    const shouldBeVisible = domainTab.shouldBeVisible(tabId);
    const isSoloed = domainTab.visibility.soloedOnTabs.includes(tabId);
    const isMuted = domainTab.visibility.mutedOnTabs.includes(tabId);

    visibilityState.quickTabs[id] = {
      id,
      url: domainTab.url,
      title: domainTab.title,
      shouldBeVisible,
      isSoloed,
      isMuted,
      soloedOnTabs: domainTab.visibility.soloedOnTabs,
      mutedOnTabs: domainTab.visibility.mutedOnTabs
    };

    (shouldBeVisible ? visibilityState.visible : visibilityState.hidden).push(id);
  };

  /**
   * Handle TEST_GET_VISIBILITY_STATE message
   * @private
   */
  _testHandleGetVisibilityState = (data, sendResponse) => {
    console.log('[Test Bridge Handler] TEST_GET_VISIBILITY_STATE:', data);
    try {
      const manager = _requireQuickTabsManager();
      const { tabId } = data;
      const visibilityState = { tabId, visible: [], hidden: [], quickTabs: {} };

      for (const [id, tab] of manager.tabs) {
        _processTabVisibility(id, tab, tabId, visibilityState);
      }

      sendResponse({ success: true, data: visibilityState });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_GET_VISIBILITY_STATE error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Handle TEST_GET_MANAGER_STATE message (deprecated)
   * @private
   */
  _testHandleGetManagerState = sendResponse => {
    console.log(
      '[Test Bridge Handler] TEST_GET_MANAGER_STATE (deprecated - floating panel removed)'
    );
    try {
      const manager = _requireQuickTabsManager();
      const minimizedTabs = manager.minimizedManager?.getAll() || [];

      sendResponse({
        success: true,
        data: {
          visible: false,
          position: null,
          size: null,
          minimizedTabs: minimizedTabs.map(tab => ({ id: tab.id, url: tab.url, title: tab.title })),
          minimizedCount: minimizedTabs.length,
          deprecationNotice:
            'Floating panel removed in v1.6.3.4. Use sidebar Quick Tabs Manager instead.'
        }
      });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_GET_MANAGER_STATE error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Handle TEST_SET_MANAGER_POSITION message (deprecated)
   * @private
   */
  _testHandleSetManagerPosition = sendResponse => {
    console.log(
      '[Test Bridge Handler] TEST_SET_MANAGER_POSITION (deprecated - floating panel removed)'
    );
    sendResponse({
      success: false,
      error: 'Floating panel removed in v1.6.3.4. Use sidebar Quick Tabs Manager instead.'
    });
  };

  /**
   * Handle TEST_SET_MANAGER_SIZE message (deprecated)
   * @private
   */
  _testHandleSetManagerSize = sendResponse => {
    console.log(
      '[Test Bridge Handler] TEST_SET_MANAGER_SIZE (deprecated - floating panel removed)'
    );
    sendResponse({
      success: false,
      error: 'Floating panel removed in v1.6.3.4. Use sidebar Quick Tabs Manager instead.'
    });
  };

  /**
   * Handle TEST_CLOSE_ALL_MINIMIZED message
   * @private
   */
  _testHandleCloseAllMinimized = sendResponse => {
    console.log('[Test Bridge Handler] TEST_CLOSE_ALL_MINIMIZED');
    try {
      const manager = _requireQuickTabsManager();
      const minimizedTabs = manager.minimizedManager?.getAll() || [];
      const minimizedIds = minimizedTabs.map(tab => tab.id);

      for (const id of minimizedIds) {
        manager.closeById(id);
      }

      sendResponse({
        success: true,
        message: 'All minimized Quick Tabs closed',
        data: { count: minimizedIds.length, closedIds: minimizedIds }
      });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_CLOSE_ALL_MINIMIZED error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Process tab for container info
   * @private
   */
  const _processTabContainer = (id, tab, containerInfo) => {
    const domainTab = tab.domainTab;
    if (!domainTab) return;

    const containerId = domainTab.cookieStoreId || 'firefox-default';

    if (!containerInfo.containers[containerId]) {
      containerInfo.containers[containerId] = { id: containerId, quickTabs: [] };
    }

    containerInfo.containers[containerId].quickTabs.push({
      id,
      url: domainTab.url,
      title: domainTab.title,
      cookieStoreId: domainTab.cookieStoreId
    });
  };

  _testHandleGetContainerInfo = sendResponse => {
    console.log('[Test Bridge Handler] TEST_GET_CONTAINER_INFO');
    try {
      const manager = _requireQuickTabsManager();
      const containerInfo = {
        currentContainer: manager.cookieStoreId || 'firefox-default',
        containers: {}
      };

      for (const [id, tab] of manager.tabs) {
        _processTabContainer(id, tab, containerInfo);
      }

      sendResponse({ success: true, data: containerInfo });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_GET_CONTAINER_INFO error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Handle TEST_CREATE_QUICK_TAB_IN_CONTAINER message
   * @private
   */
  _testHandleCreateQuickTabInContainer = (data, sendResponse) => {
    console.log('[Test Bridge Handler] TEST_CREATE_QUICK_TAB_IN_CONTAINER:', data);
    try {
      const manager = _requireQuickTabsManager();
      const { url, cookieStoreId } = data;
      manager.createQuickTab({ url, title: 'Test Quick Tab', cookieStoreId });
      sendResponse({
        success: true,
        message: 'Quick Tab created in container',
        data: { url, cookieStoreId }
      });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_CREATE_QUICK_TAB_IN_CONTAINER error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Handle TEST_VERIFY_CONTAINER_ISOLATION message
   * @private
   */
  const _getTabContainerId = (manager, tabId) => {
    const tab = manager.tabs.get(tabId);
    if (!tab || !tab.domainTab) throw new Error(`Quick Tab not found: ${tabId}`);
    return tab.domainTab.cookieStoreId || 'firefox-default';
  };

  _testHandleVerifyContainerIsolation = (data, sendResponse) => {
    console.log('[Test Bridge Handler] TEST_VERIFY_CONTAINER_ISOLATION:', data);
    try {
      const manager = _requireQuickTabsManager();
      const { id1, id2 } = data;
      const container1 = _getTabContainerId(manager, id1);
      const container2 = _getTabContainerId(manager, id2);
      const isIsolated = container1 !== container2;

      sendResponse({ success: true, data: { id1, id2, container1, container2, isIsolated } });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_VERIFY_CONTAINER_ISOLATION error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Handle TEST_GET_SLOT_NUMBERING message
   * @private
   */
  _testHandleGetSlotNumbering = sendResponse => {
    console.log('[Test Bridge Handler] TEST_GET_SLOT_NUMBERING');
    try {
      const manager = _requireQuickTabsManager();
      const slotInfo = { slots: [] };

      if (manager.minimizedManager) {
        const slots = manager.minimizedManager.slots || [];
        slotInfo.slots = slots.map((slot, index) => ({
          slotNumber: index + 1,
          isOccupied: slot !== null,
          quickTabId: slot ? slot.id : null
        }));
      }

      sendResponse({ success: true, data: slotInfo });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_GET_SLOT_NUMBERING error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Handle TEST_SET_DEBUG_MODE message
   * @private
   */
  _testHandleSetDebugMode = (data, sendResponse) => {
    console.log('[Test Bridge Handler] TEST_SET_DEBUG_MODE:', data);
    (async () => {
      try {
        const { enabled } = data;
        await browser.storage.local.set({ debugMode: enabled });
        sendResponse({
          success: true,
          message: enabled ? 'Debug mode enabled' : 'Debug mode disabled',
          data: { enabled }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_SET_DEBUG_MODE error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
  };

  /**
   * Get element geometry data
   * @private
   */
  const _getElementGeometry = element => {
    const rect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);
    return {
      position: {
        left: parseFloat(element.style.left) || rect.left,
        top: parseFloat(element.style.top) || rect.top
      },
      size: {
        width: parseFloat(element.style.width) || rect.width,
        height: parseFloat(element.style.height) || rect.height
      },
      zIndex: parseInt(computedStyle.zIndex, 10) || 0
    };
  };

  _testHandleGetQuickTabGeometry = (data, sendResponse) => {
    console.log('[Test Bridge Handler] TEST_GET_QUICK_TAB_GEOMETRY:', data);
    try {
      const manager = _requireQuickTabsManager();
      const { id } = data;
      const tab = manager.tabs.get(id);
      if (!tab) throw new Error(`Quick Tab not found: ${id}`);
      if (!tab.element) throw new Error(`DOM element not found for Quick Tab: ${id}`);

      sendResponse({ success: true, data: { id, ..._getElementGeometry(tab.element) } });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_GET_QUICK_TAB_GEOMETRY error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  /**
   * Get z-index for a tab element
   * @private
   */
  const _getTabZIndex = (manager, id) => {
    const tab = manager.tabs.get(id);
    if (!tab || !tab.element) throw new Error(`Quick Tab or element not found: ${id}`);

    const computedStyle = window.getComputedStyle(tab.element);
    return { id, zIndex: parseInt(computedStyle.zIndex, 10) || 0 };
  };

  /**
   * Verify z-index order is descending
   * @private
   */
  const _verifyDescendingZIndex = zIndexData => {
    for (let i = 0; i < zIndexData.length - 1; i++) {
      if (zIndexData[i].zIndex <= zIndexData[i + 1].zIndex) return false;
    }
    return true;
  };

  /**
   * Handle TEST_VERIFY_ZINDEX_ORDER message
   * @private
   */
  _testHandleVerifyZIndexOrder = (data, sendResponse) => {
    console.log('[Test Bridge Handler] TEST_VERIFY_ZINDEX_ORDER:', data);
    try {
      const manager = _requireQuickTabsManager();
      const { ids } = data;
      const zIndexData = ids.map(id => _getTabZIndex(manager, id));
      const isCorrectOrder = _verifyDescendingZIndex(zIndexData);

      sendResponse({ success: true, data: { ids, zIndexData, isCorrectOrder } });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_VERIFY_ZINDEX_ORDER error:', error);
      sendResponse({ success: false, error: error.message });
    }
  };

  console.log('[Content] TEST_MODE enabled - test bridge handlers loaded');
}
// ==================== END TEST BRIDGE HANDLER FUNCTIONS ====================

// ==================== MESSAGE DISPATCHER ====================

/**
 * Action handlers map for message.action-based messages
 */
const ACTION_HANDLERS = {
  GET_CONTENT_LOGS: (message, sendResponse) => {
    _handleGetContentLogs(sendResponse);
    return true;
  },
  CLEAR_CONTENT_LOGS: (message, sendResponse) => {
    _handleClearContentLogs(sendResponse);
    return true;
  },
  REFRESH_LIVE_CONSOLE_FILTERS: (message, sendResponse) => {
    _handleRefreshLiveConsoleFilters(sendResponse);
    return true;
  },
  CLEAR_ALL_QUICK_TABS: (message, sendResponse) => {
    _handleClearAllQuickTabs(sendResponse);
    return true;
  },
  QUICK_TABS_CLEARED: (message, sendResponse) => {
    _handleQuickTabsCleared(sendResponse);
    return true;
  },
  CLOSE_QUICK_TAB: (message, sendResponse) => {
    // v1.6.3.7 - FIX Issue #3: Pass source parameter for cross-tab broadcast handling
    // v1.6.3.6-v5 - FIX Issue #4e: Pass correlationId for deletion tracing
    const source = message.source || 'Manager';
    const correlationId = message.correlationId || null;
    console.log('[Content] Received CLOSE_QUICK_TAB request:', {
      quickTabId: message.quickTabId,
      source,
      correlationId
    });
    _handleCloseQuickTab(message.quickTabId, sendResponse, source, correlationId);
    return true;
  },
  MINIMIZE_QUICK_TAB: (message, sendResponse) => {
    console.log('[Content] Received MINIMIZE_QUICK_TAB request:', message.quickTabId);
    _handleMinimizeQuickTab(message.quickTabId, sendResponse);
    return true;
  },
  RESTORE_QUICK_TAB: (message, sendResponse) => {
    // v1.6.3.10-v10 - FIX Issue R: Pass sequenceId for ordering enforcement
    console.log('[Content] Received RESTORE_QUICK_TAB request:', {
      quickTabId: message.quickTabId,
      sequenceId: message.sequenceId
    });
    _handleRestoreQuickTab(message.quickTabId, sendResponse, message.sequenceId);
    return true;
  },
  CLOSE_MINIMIZED_QUICK_TABS: (message, sendResponse) => {
    _handleCloseMinimizedQuickTabs(sendResponse);
    return true;
  },
  // v1.6.4.13 - FIX BUG #4: Handle ADOPTION_COMPLETED to update local cache
  // This prevents cross-tab restore from using wrong tab context after adoption
  ADOPTION_COMPLETED: (message, sendResponse) => {
    console.log('[Content] Received ADOPTION_COMPLETED broadcast:', {
      adoptedQuickTabId: message.adoptedQuickTabId,
      previousOriginTabId: message.previousOriginTabId,
      newOriginTabId: message.newOriginTabId,
      timestamp: message.timestamp
    });
    _handleAdoptionCompleted(message, sendResponse);
    return true;
  },
  // v1.6.4.14 - FIX Issue #17: Handle tabActivated action from background
  // Background broadcasts this when a tab becomes active via chrome.tabs.onActivated
  tabActivated: (message, sendResponse) => {
    console.log('[Content] Received tabActivated broadcast:', {
      tabId: message.tabId,
      currentTabId: quickTabsManager?.currentTabId,
      timestamp: Date.now()
    });
    _handleTabActivated(message, sendResponse);
    return true;
  },
  // v1.6.4.14 - FIX Issue #17: Handle SYNC_QUICK_TAB_STATE_FROM_BACKGROUND action
  // Background sends this with full state when tab becomes active
  SYNC_QUICK_TAB_STATE_FROM_BACKGROUND: (message, sendResponse) => {
    console.log('[Content] Received SYNC_QUICK_TAB_STATE_FROM_BACKGROUND:', {
      tabCount: message.state?.tabs?.length ?? 0,
      lastUpdate: message.state?.lastUpdate,
      timestamp: Date.now()
    });
    _handleStateSyncFromBackground(message, sendResponse);
    return true;
  }
};

/**
 * Type handlers map for message.type-based test bridge messages
 */

/**
 * Command handler lookup table
 * v1.6.3.5-v3 - Extracted to reduce _executeQuickTabCommand complexity
 * v1.6.3.6-v7 - FIX Issue #5: Enhanced logging at restoration pipeline stages
 * @private
 */
/**
 * Log restore command stages for diagnostics
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _logRestoreStage(stage, quickTabId, source, extra = {}) {
  const stageLabels = {
    1: 'received',
    2: 'invoking handler',
    3: 'handler complete'
  };
  console.log(`[Content] RESTORE_QUICK_TAB command - Stage ${stage} (${stageLabels[stage]}):`, {
    quickTabId,
    source: source || 'manager',
    timestamp: Date.now(),
    ...extra
  });
}

/**
 * Execute restore via visibility handler
 * v1.6.4.8 - Extracted for code health
 * @private
 */
function _executeRestoreCommand(quickTabId, source) {
  _logRestoreStage(1, quickTabId, source, {
    hasVisibilityHandler: !!quickTabsManager?.visibilityHandler,
    currentTabId: quickTabsManager?.currentTabId
  });

  const handler = quickTabsManager?.visibilityHandler?.handleRestore;
  if (!handler) {
    console.warn('[Content] RESTORE_QUICK_TAB command - Handler not available:', {
      quickTabId,
      hasManager: !!quickTabsManager,
      hasVisibilityHandler: !!quickTabsManager?.visibilityHandler
    });
    return {
      success: false,
      error: 'Quick Tabs manager not initialized or visibility handler not ready'
    };
  }

  _logRestoreStage(2, quickTabId, source);
  const result = handler.call(quickTabsManager.visibilityHandler, quickTabId, source || 'manager');
  _logRestoreStage(3, quickTabId, source, { result });

  return { success: true, action: 'restored', handlerResult: result };
}

/**
 * Generic command handler factory for visibility operations
 * v1.6.3.10-v8 - FIX Code Health: Consolidated duplicate handler pattern
 * @private
 */
function _createVisibilityHandler(methodName, actionName) {
  return (quickTabId, source) => {
    const handler = quickTabsManager?.visibilityHandler?.[methodName];
    if (!handler) {
      return { success: false, error: 'Quick Tabs manager not initialized or visibility handler not ready' };
    }
    handler.call(quickTabsManager.visibilityHandler, quickTabId, source || 'manager');
    return { success: true, action: actionName };
  };
}

const QUICK_TAB_COMMAND_HANDLERS = {
  MINIMIZE_QUICK_TAB: _createVisibilityHandler('handleMinimize', 'minimized'),
  RESTORE_QUICK_TAB: (quickTabId, source) => _executeRestoreCommand(quickTabId, source),
  CLOSE_QUICK_TAB: (quickTabId, _source) => {
    const handler = quickTabsManager?.closeById;
    if (!handler) {
      return { success: false, error: 'Quick Tabs manager not initialized - closeById not available' };
    }
    handler.call(quickTabsManager, quickTabId);
    return { success: true, action: 'closed' };
  },
  FOCUS_QUICK_TAB: _createVisibilityHandler('handleFocus', 'focused')
};

/**
 * Execute a single Quick Tab command
 * v1.6.3.5-v3 - Extracted to reduce EXECUTE_COMMAND handler complexity
 * @private
 */
function _executeQuickTabCommand(command, quickTabId, source) {
  const handler = QUICK_TAB_COMMAND_HANDLERS[command];
  if (!handler) return { success: false, error: `Unknown command: ${command}` };
  return handler(quickTabId, source);
}

const TYPE_HANDLERS = {
  // v1.6.3.5-v3 - FIX Architecture Phase 3: Handle EXECUTE_COMMAND from background
  // This enables Manager sidebar to control Quick Tabs in this tab remotely
  EXECUTE_COMMAND: (message, sendResponse) => {
    const { command, quickTabId, source } = message;
    console.log('[Content] EXECUTE_COMMAND received:', { command, quickTabId, source });

    if (!quickTabsManager) {
      console.warn('[Content] quickTabsManager not available');
      sendResponse({ success: false, error: 'quickTabsManager not available' });
      return true;
    }

    try {
      const result = _executeQuickTabCommand(command, quickTabId, source);
      console.log('[Content] EXECUTE_COMMAND result:', result);
      sendResponse(result);
    } catch (err) {
      console.error('[Content] EXECUTE_COMMAND error:', err);
      sendResponse({ success: false, error: err.message });
    }

    return true;
  },

  // v1.6.3.5-v3 - FIX Architecture Phase 1: Handle state update notifications
  QUICK_TAB_STATE_UPDATED: (message, sendResponse) => {
    console.log('[Content] QUICK_TAB_STATE_UPDATED received:', {
      quickTabId: message.quickTabId,
      changes: message.changes
    });
    // Content script doesn't need to do anything - it manages its own state
    // This handler is mainly for logging and potential future use
    sendResponse({ received: true });
    return true;
  }
};

// v1.6.3.6-v11 - FIX Bundle Size Issue #3: Conditionally add test handlers only in test mode
// This allows Rollup's dead code elimination to remove test handlers in production builds
if (IS_TEST_MODE) {
  Object.assign(TYPE_HANDLERS, {
    TEST_CREATE_QUICK_TAB: (message, sendResponse) => {
      _testHandleCreateQuickTab(message.data, sendResponse);
      return true;
    },
    TEST_MINIMIZE_QUICK_TAB: (message, sendResponse) => {
      _testHandleMinimizeQuickTab(message.data, sendResponse);
      return true;
    },
    TEST_RESTORE_QUICK_TAB: (message, sendResponse) => {
      _testHandleRestoreQuickTab(message.data, sendResponse);
      return true;
    },
    TEST_PIN_QUICK_TAB: (message, sendResponse) => {
      _testHandlePinQuickTab(message.data, sendResponse);
      return true;
    },
    TEST_UNPIN_QUICK_TAB: (message, sendResponse) => {
      _testHandleUnpinQuickTab(message.data, sendResponse);
      return true;
    },
    TEST_CLOSE_QUICK_TAB: (message, sendResponse) => {
      _testHandleCloseQuickTab(message.data, sendResponse);
      return true;
    },
    TEST_CLEAR_ALL_QUICK_TAB: (message, sendResponse) => {
      _testHandleClearAllQuickTabs(sendResponse);
      return true;
    },
    TEST_TOGGLE_SOLO: (message, sendResponse) => {
      _testHandleToggleSolo(message.data, sendResponse);
      return true;
    },
    TEST_TOGGLE_MUTE: (message, sendResponse) => {
      _testHandleToggleMute(message.data, sendResponse);
      return true;
    },
    TEST_GET_VISIBILITY_STATE: (message, sendResponse) => {
      _testHandleGetVisibilityState(message.data, sendResponse);
      return true;
    },
    TEST_GET_MANAGER_STATE: (message, sendResponse) => {
      _testHandleGetManagerState(sendResponse);
      return true;
    },
    TEST_SET_MANAGER_POSITION: (message, sendResponse) => {
      _testHandleSetManagerPosition(sendResponse);
      return true;
    },
    TEST_SET_MANAGER_SIZE: (message, sendResponse) => {
      _testHandleSetManagerSize(sendResponse);
      return true;
    },
    TEST_CLOSE_ALL_MINIMIZED: (message, sendResponse) => {
      _testHandleCloseAllMinimized(sendResponse);
      return true;
    },
    TEST_GET_CONTAINER_INFO: (message, sendResponse) => {
      _testHandleGetContainerInfo(sendResponse);
      return true;
    },
    TEST_CREATE_QUICK_TAB_IN_CONTAINER: (message, sendResponse) => {
      _testHandleCreateQuickTabInContainer(message.data, sendResponse);
      return true;
    },
    TEST_VERIFY_CONTAINER_ISOLATION: (message, sendResponse) => {
      _testHandleVerifyContainerIsolation(message.data, sendResponse);
      return true;
    },
    TEST_GET_SLOT_NUMBERING: (message, sendResponse) => {
      _testHandleGetSlotNumbering(sendResponse);
      return true;
    },
    TEST_SET_DEBUG_MODE: (message, sendResponse) => {
      _testHandleSetDebugMode(message.data, sendResponse);
      return true;
    },
    TEST_GET_QUICK_TAB_GEOMETRY: (message, sendResponse) => {
      _testHandleGetQuickTabGeometry(message.data, sendResponse);
      return true;
    },
    TEST_VERIFY_ZINDEX_ORDER: (message, sendResponse) => {
      _testHandleVerifyZIndexOrder(message.data, sendResponse);
      return true;
    }
  });
  console.log('[Content] Test bridge TYPE_HANDLERS registered');
}

/**
 * Main message dispatcher
 * Routes messages to appropriate handler based on action or type
 * v1.6.3.5-v10 - FIX Issue #3: Added entry/exit logging for message tracing
 * @private
 */
function _dispatchMessage(message, _sender, sendResponse) {
  // v1.6.3.5-v10 - FIX Issue #3: Log all incoming messages for diagnostic tracing
  console.log('[Content] Message received:', {
    action: message.action || 'none',
    type: message.type || 'none',
    hasData: !!message.data
  });

  // Check action-based handlers first
  if (message.action && ACTION_HANDLERS[message.action]) {
    console.log('[Content] Dispatching to ACTION_HANDLERS:', message.action);
    return ACTION_HANDLERS[message.action](message, sendResponse);
  }

  // Check type-based handlers (test bridge)
  if (message.type && TYPE_HANDLERS[message.type]) {
    console.log('[Content] Dispatching to TYPE_HANDLERS:', message.type);
    return TYPE_HANDLERS[message.type](message, sendResponse);
  }

  // v1.6.3.5-v10 - FIX Issue #3: Warn about unknown messages with available handlers
  console.warn('[Content] ⚠️ Unknown message - no handler found:', {
    action: message.action,
    type: message.type,
    availableActions: Object.keys(ACTION_HANDLERS),
    availableTypes: Object.keys(TYPE_HANDLERS).slice(0, 10) // First 10 to avoid noise
  });

  // Message not handled by this listener
  return false;
}

// ==================== BEFOREUNLOAD CLEANUP HANDLER ====================
// v1.6.3.4-v11 - FIX Issue #3: Cleanup resources on page navigation to prevent memory leaks
// This handler ensures storage listeners and other resources are properly released
// Note: Content scripts are injected once per page load, but we add a guard for safety

/**
 * Handler for beforeunload event to cleanup resources
 * @private
 */
function _handleBeforeUnload() {
  console.log('[Content] beforeunload event - starting cleanup');

  if (quickTabsManager?.destroy) {
    console.log('[Content] Calling quickTabsManager.destroy() for resource cleanup');
    quickTabsManager.destroy();
  } else {
    console.log('[Content] quickTabsManager not available or no destroy method, skipping cleanup');
  }
}

// Guard: Only add listener if not already added (safety for any edge cases)
if (!window._CUO_beforeunload_registered) {
  window.addEventListener('beforeunload', _handleBeforeUnload);
  window._CUO_beforeunload_registered = true;
}
// ==================== END BEFOREUNLOAD CLEANUP HANDLER ====================

// ==================== LOG EXPORT MESSAGE HANDLER ====================
// Listen for log export requests from popup
if (typeof browser !== 'undefined' && browser.runtime) {
  browser.runtime.onMessage.addListener(_dispatchMessage);
  // v1.6.3.5-v10 - FIX Issue #2: Confirm message listener registration
  console.log('[Content] ✓ Message listener registered');
}
// ==================== END LOG EXPORT MESSAGE HANDLER ====================

// Export for testing and module access
if (typeof window !== 'undefined') {
  window.CopyURLExtension = {
    configManager,
    stateManager,
    eventBus,
    urlRegistry,
    quickTabsManager,
    notificationManager,
    CONFIG
  };
}
