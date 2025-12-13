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
// v1.6.3.7-v8 - Phase 3A Optimization #6: IntersectionObserver for visibility-aware link processing
import LinkVisibilityObserver from './features/url-handlers/LinkVisibilityObserver.js';
import { clearLogBuffer, debug, enableDebug, getLogBuffer } from './utils/debug.js';
import { settingsReady } from './utils/filter-settings.js';
import { logNormal, logWarn, refreshLiveConsoleSettings } from './utils/logger.js';
// v1.6.3.8-v2 - Issue #7: Import sendRequestWithTimeout for reliable message/response handling
import { sendRequestWithTimeout } from './utils/message-utils.js';
// v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Import setWritingTabId to set tab ID for storage writes
import { setWritingTabId } from './utils/storage-utils.js';

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

/**
 * Get current tab ID from background script
 * v1.6.3.5-v10 - FIX Issue #3: Content scripts cannot use browser.tabs.getCurrent()
 * Must send message to background script which has access to sender.tab.id
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #1: Add validation logging
 * v1.6.3.8-v2 - Issue #7: Use sendRequestWithTimeout for reliable ACK handling
 *
 * @returns {Promise<number|null>} Current tab ID or null if unavailable
 */
async function getCurrentTabIdFromBackground() {
  console.log('[Content] Requesting current tab ID from background...');

  // v1.6.3.8-v2 - Issue #7: Use sendRequestWithTimeout for reliable response
  const response = await sendRequestWithTimeout(
    { action: 'GET_CURRENT_TAB_ID' },
    { timeoutMs: 3000 } // 3 second timeout for tab ID request
  );

  // Check for success with valid tab ID
  if (response?.success && typeof response.data?.tabId === 'number') {
    console.log('[Content] Got current tab ID from background:', {
      tabId: response.data.tabId,
      success: response.success,
      requestId: response.requestId
    });
    return response.data.tabId;
  }

  // v1.6.3.8-v2 - Handle legacy response format (tabId at root level)
  // DEPRECATED: This format will be removed in v1.6.4. Use { success: true, data: { tabId } }
  if (response?.success && typeof response.tabId === 'number') {
    console.warn('[Content] DEPRECATED: Legacy response format detected. Migrate to { data: { tabId } }');
    console.log('[Content] Got current tab ID from background (legacy format):', {
      tabId: response.tabId,
      success: response.success
    });
    return response.tabId;
  }

  // Log detailed error information
  console.warn('[Content] Background returned invalid tab ID response:', {
    response,
    success: response?.success,
    tabId: response?.tabId || response?.data?.tabId,
    error: response?.error,
    code: response?.code,
    requestId: response?.requestId
  });
  return null;
}

// ==================== v1.6.3.6-v11 PORT CONNECTION ====================
// FIX Issue #11: Persistent port connection to background script
// FIX Issue #12: Port lifecycle logging
// FIX Issue #17: Port cleanup on tab close
// v1.6.3.8-v6 - Issue #1-4: Cross-tab sync improvements with storage.onChanged fallback

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

// v1.6.3.8-v6 - Issue #3: Port reconnection constants (exponential backoff)
const PORT_RECONNECT_INITIAL_DELAY_MS = 100;
const PORT_RECONNECT_MAX_DELAY_MS = 10000;
const PORT_RECONNECT_BACKOFF_MULTIPLIER = 2;
const PORT_RECONNECT_MAX_ATTEMPTS = 10;
const PORT_CIRCUIT_BREAKER_THRESHOLD = 3; // Failures before circuit breaker trips

/**
 * Port reconnection state object
 * v1.6.3.8-v6 - Issue #3: Encapsulated port reconnection state for maintainability
 * @type {Object}
 */
const portReconnectState = {
  attempts: 0,
  currentDelay: PORT_RECONNECT_INITIAL_DELAY_MS,
  circuitBreakerTripped: false,
  consecutiveFailures: 0,
  timeoutId: null
};

/**
 * State ordering tracking object
 * v1.6.3.8-v6 - Issue #2: Encapsulated ordering state for cross-tab sync validation
 * Tracks the highest applied revision/sequenceId to reject out-of-order or duplicate events.
 * NOTE: Using <= comparison is intentional - we reject BOTH duplicates (==) AND out-of-order (<)
 * events. This prevents re-application of the same state which could cause UI flicker.
 * @type {Object}
 */
const orderingState = {
  lastAppliedRevision: 0,
  lastAppliedSequenceId: 0
};

// Legacy variable references for backward compatibility (will be removed in future)
let portReconnectAttempts = 0;
let portCurrentDelay = PORT_RECONNECT_INITIAL_DELAY_MS;
let portCircuitBreakerTripped = false;
let portConsecutiveFailures = 0;
let portReconnectTimeoutId = null;
let lastAppliedRevision = 0;
let lastAppliedSequenceId = 0;

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
 * Reset port reconnection state
 * v1.6.3.8-v6 - Issue #3: Reset backoff after successful connection
 * @private
 */
function _resetPortReconnectState() {
  portReconnectAttempts = 0;
  portCurrentDelay = PORT_RECONNECT_INITIAL_DELAY_MS;
  portConsecutiveFailures = 0;
  if (portReconnectTimeoutId) {
    clearTimeout(portReconnectTimeoutId);
    portReconnectTimeoutId = null;
  }
}

/**
 * Schedule port reconnection with exponential backoff
 * v1.6.3.8-v6 - Issue #3: Implement reconnection with backoff and circuit breaker
 * @private
 * @param {number} tabId - Tab ID to reconnect
 */
function _schedulePortReconnect(tabId) {
  // Guard: Circuit breaker check
  if (portCircuitBreakerTripped) {
    console.warn('[Content] PORT_RECONNECT_BLOCKED: Circuit breaker tripped', {
      consecutiveFailures: portConsecutiveFailures,
      threshold: PORT_CIRCUIT_BREAKER_THRESHOLD
    });
    return;
  }

  // Guard: Max attempts check
  if (portReconnectAttempts >= PORT_RECONNECT_MAX_ATTEMPTS) {
    console.error('[Content] PORT_RECONNECT_MAX_ATTEMPTS_REACHED:', {
      attempts: portReconnectAttempts,
      maxAttempts: PORT_RECONNECT_MAX_ATTEMPTS
    });
    portCircuitBreakerTripped = true;
    return;
  }

  // Guard: Don't reconnect if page is hidden
  if (document.visibilityState === 'hidden') {
    console.log('[Content] PORT_RECONNECT_DEFERRED: Page hidden');
    return;
  }

  // Clear any existing timeout
  if (portReconnectTimeoutId) {
    clearTimeout(portReconnectTimeoutId);
  }

  const delay = portCurrentDelay;
  portReconnectAttempts++;

  console.log('[Content] PORT_RECONNECT_SCHEDULED:', {
    attempt: portReconnectAttempts,
    delayMs: delay,
    nextDelayMs: Math.min(delay * PORT_RECONNECT_BACKOFF_MULTIPLIER, PORT_RECONNECT_MAX_DELAY_MS)
  });

  portReconnectTimeoutId = setTimeout(() => {
    portReconnectTimeoutId = null;
    if (!backgroundPort && document.visibilityState !== 'hidden') {
      connectContentToBackground(tabId);
    }
  }, delay);

  // Update delay for next attempt (exponential backoff)
  portCurrentDelay = Math.min(portCurrentDelay * PORT_RECONNECT_BACKOFF_MULTIPLIER, PORT_RECONNECT_MAX_DELAY_MS);
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 * v1.6.3.8-v6 - Issue #3: Add exponential backoff reconnection
 * @param {number} tabId - Current tab ID
 */
function connectContentToBackground(tabId) {
  cachedTabId = tabId;

  try {
    backgroundPort = browser.runtime.connect({
      name: `quicktabs-content-${tabId}`
    });

    logContentPortLifecycle('open', { portName: backgroundPort.name });

    // v1.6.3.8-v6 - Issue #3: Reset reconnect state on successful connection
    _resetPortReconnectState();

    // Handle messages from background
    backgroundPort.onMessage.addListener(handleContentPortMessage);

    // Handle disconnect
    backgroundPort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      logContentPortLifecycle('disconnect', { error: error?.message });
      backgroundPort = null;

      // v1.6.3.8-v6 - Issue #3: Track consecutive failures for circuit breaker
      portConsecutiveFailures++;
      if (portConsecutiveFailures >= PORT_CIRCUIT_BREAKER_THRESHOLD) {
        portCircuitBreakerTripped = true;
        console.error('[Content] PORT_CIRCUIT_BREAKER_TRIPPED:', {
          consecutiveFailures: portConsecutiveFailures,
          threshold: PORT_CIRCUIT_BREAKER_THRESHOLD
        });
      }

      // v1.6.3.8-v6 - Issue #3: Schedule reconnection with exponential backoff
      _schedulePortReconnect(tabId);
    });

    console.log('[Content] v1.6.3.6-v11 Port connection established to background');
  } catch (err) {
    console.error('[Content] Failed to connect to background:', err.message);
    logContentPortLifecycle('error', { error: err.message });

    // v1.6.3.8-v6 - Issue #3: Track failure and schedule reconnection
    portConsecutiveFailures++;
    _schedulePortReconnect(tabId);
  }
}

/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #11: Process messages from background
 * v1.6.3.8 - Issue #4 (arch): Added PORT_PING handler for zombie detection
 * v1.6.3.8-v6 - Issue #2: Added STATE_UPDATE handler with ordering validation
 * @param {Object} message - Message from background
 */
function handleContentPortMessage(message) {
  logContentPortLifecycle('message', {
    type: message.type,
    action: message.action
  });

  // v1.6.3.8-v6 - Reset consecutive failures on successful message
  portConsecutiveFailures = 0;

  // v1.6.3.8 - Issue #4 (arch): Handle PORT_PING for zombie port detection
  if (message.type === 'PORT_PING') {
    _handlePortPingFromBackground(message);
    return;
  }

  // v1.6.3.8 - Issue #2 (arch): Handle ALIVE_PING from background keepalive
  if (message.type === 'ALIVE_PING') {
    console.log('[Content] Received ALIVE_PING from background:', {
      timestamp: message.timestamp,
      isInitialized: message.isInitialized
    });
    return;
  }

  // v1.6.3.8-v6 - Issue #2: Handle STATE_UPDATE with ordering validation
  if (message.type === 'STATE_UPDATE') {
    _handleStateUpdateFromPort(message);
    return;
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
 * Handle STATE_UPDATE message from background via port
 * v1.6.3.8-v6 - Issue #2: Validate ordering before applying
 * @private
 * @param {Object} message - State update message
 */
function _handleStateUpdateFromPort(message) {
  const { state, sequenceId, revision } = message;

  console.log('[Content] STATE_UPDATE received via port:', {
    sequenceId,
    revision,
    tabCount: state?.tabs?.length || 0,
    lastAppliedSequenceId,
    lastAppliedRevision
  });

  // Validate ordering
  const stateWithMeta = { ...state, sequenceId, revision };
  const orderingResult = _validateStorageEventOrdering(stateWithMeta);

  if (!orderingResult.valid) {
    console.warn('[Content] STATE_UPDATE rejected (ordering):', {
      reason: orderingResult.reason,
      sequenceId,
      revision
    });
    // Request fresh state on ordering failure
    _requestStateRecovery(`port-${orderingResult.reason}`);
    return;
  }

  // Update ordering state
  _updateAppliedOrderingState(stateWithMeta);

  // Notify QuickTabsManager
  _notifyManagerOfStorageUpdate(state, 'port-state-update');
}

/**
 * Handle PORT_PING from background for zombie detection
 * v1.6.3.8 - Issue #4 (arch): Respond with PORT_PONG to confirm alive
 * @private
 * @param {Object} message - Ping message from background
 */
function _handlePortPingFromBackground(message) {
  console.log('[Content] PORT_PING received:', {
    portId: message.portId,
    timestamp: message.timestamp
  });

  // Send pong response to confirm we're alive (not a BFCache zombie)
  if (backgroundPort) {
    try {
      backgroundPort.postMessage({
        type: 'PORT_PONG',
        originalTimestamp: message.timestamp,
        timestamp: Date.now(),
        tabId: cachedTabId
      });
      console.log('[Content] PORT_PONG sent');
    } catch (err) {
      console.error('[Content] Failed to send PORT_PONG:', err.message);
    }
  } else {
    console.warn('[Content] Cannot send PORT_PONG - no backgroundPort');
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
  // v1.6.3.8-v6 - Clear reconnect timeout on unload
  if (portReconnectTimeoutId) {
    clearTimeout(portReconnectTimeoutId);
    portReconnectTimeoutId = null;
  }
});

// v1.6.3.8-v6 - Issue #3: Reset circuit breaker when tab becomes visible
// This allows reconnection attempts when user returns to the tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    console.log('[Content] TAB_VISIBILITY_VISIBLE:', {
      hasPort: !!backgroundPort,
      circuitBreakerTripped: portCircuitBreakerTripped,
      consecutiveFailures: portConsecutiveFailures
    });

    // Reset circuit breaker when tab becomes visible
    if (portCircuitBreakerTripped) {
      console.log('[Content] CIRCUIT_BREAKER_RESET: Tab became visible');
      portCircuitBreakerTripped = false;
      portConsecutiveFailures = 0;
      portReconnectAttempts = 0;
      portCurrentDelay = PORT_RECONNECT_INITIAL_DELAY_MS;
    }

    // Attempt reconnection if port is dead
    if (!backgroundPort && cachedTabId !== null) {
      console.log('[Content] ATTEMPTING_RECONNECT: Tab visible, no port');
      connectContentToBackground(cachedTabId);
    }
  }
});

// ==================== v1.6.3.8 BFCACHE HANDLING ====================
// Issue #4 (arch): Handle BFCache "Zombie" Port Connections
// When pages enter BFCache, ports remain open but cannot receive messages.
// Explicitly disconnect port when entering BFCache and re-sync when restored.

/**
 * Disconnect port safely during BFCache entry
 * v1.6.3.8 - Issue #4 (arch): Extracted to reduce nesting depth
 * @private
 */
function _disconnectPortForBFCache() {
  if (!backgroundPort) return;

  logContentPortLifecycle('bfcache-enter', { reason: 'entering-bfcache' });
  try {
    backgroundPort.disconnect();
  } catch (_err) {
    // Port may already be in bad state
  }
  backgroundPort = null;
}

/**
 * Handle page entering BFCache (Back/Forward Cache)
 * v1.6.3.8 - Issue #4 (arch): Explicitly disconnect port to prevent zombie connections
 * v1.6.3.8-v3 - Issue #2: Use PAGE_LIFECYCLE_BFCACHE_ENTER log event name
 * @param {PageTransitionEvent} event - The pagehide event
 */
function _handleBFCachePageHide(event) {
  // event.persisted is true when page is being placed in BFCache
  if (!event.persisted) return;

  // v1.6.3.8-v3 - Issue #2: Log with specific event name for visibility
  console.log('[Content] PAGE_LIFECYCLE_BFCACHE_ENTER:', {
    reason: 'pagehide with persisted=true',
    tabId: cachedTabId,
    hadPort: !!backgroundPort,
    timestamp: Date.now()
  });

  // Explicitly disconnect port to prevent zombie connection
  _disconnectPortForBFCache();
}

/**
 * Handle page restored from BFCache
 * v1.6.3.8 - Issue #4 (arch): Request full state sync after BFCache restore
 * v1.6.3.8-v3 - Issue #2: Use PAGE_LIFECYCLE_BFCACHE_RESTORE log event name
 * @param {PageTransitionEvent} event - The pageshow event
 */
function _handleBFCachePageShow(event) {
  // event.persisted is true when page is restored from BFCache
  if (event.persisted) {
    // v1.6.3.8-v3 - Issue #2: Log with specific event name for visibility
    console.log('[Content] PAGE_LIFECYCLE_BFCACHE_RESTORE:', {
      reason: 'pageshow with persisted=true',
      tabId: cachedTabId,
      hadPort: !!backgroundPort,
      timestamp: Date.now()
    });

    // Re-establish port connection
    if (cachedTabId !== null && !backgroundPort) {
      console.log('[Content] Re-establishing port connection after BFCache restore');
      connectContentToBackground(cachedTabId);
    }

    // Trigger full state sync to get updates missed while in BFCache
    _triggerFullStateSyncAfterBFCache();
  }
}

/**
 * Trigger full state sync after BFCache restoration
 * v1.6.3.8 - Issue #4 (arch): Content script may have missed updates while in BFCache
 * @private
 */
function _triggerFullStateSyncAfterBFCache() {
  console.log('[Content] Requesting full state sync after BFCache restore');

  // Method 1: Send message via port if available
  if (backgroundPort) {
    try {
      backgroundPort.postMessage({
        type: 'REQUEST_FULL_STATE_SYNC',
        source: 'content-bfcache-restore',
        tabId: cachedTabId,
        timestamp: Date.now()
      });
      return;
    } catch (err) {
      console.warn('[Content] Port message failed, trying runtime.sendMessage:', err.message);
    }
  }

  // Method 2: Fallback to runtime.sendMessage
  browser.runtime
    .sendMessage({
      action: 'REQUEST_FULL_STATE_SYNC',
      source: 'content-bfcache-restore',
      tabId: cachedTabId,
      timestamp: Date.now()
    })
    .catch(err => {
      console.warn('[Content] Failed to request state sync after BFCache restore:', err.message);
    });
}

// Register BFCache handlers
window.addEventListener('pagehide', _handleBFCachePageHide);
window.addEventListener('pageshow', _handleBFCachePageShow);

console.log('[Content] v1.6.3.8 BFCache handlers registered');

// ==================== END BFCACHE HANDLING ====================

// ==================== v1.6.3.8-v6 STORAGE FALLBACK & ORDERING ====================
// Issue #1: storage.onChanged listener as fallback when port messaging fails
// Issue #2: Storage event ordering validation using sequenceId and revision
// Issue #4: Fallback when port.postMessage fails

// Storage key for Quick Tabs state (must match storage-utils.js)
const CONTENT_STATE_KEY = 'quick_tabs_state_v2';

/**
 * Validate incoming storage event ordering
 * v1.6.3.8-v6 - Issue #2: Reject out-of-order updates using sequenceId and revision
 * @param {Object} newValue - New storage value
 * @returns {{valid: boolean, reason: string}} Validation result
 */
function _validateStorageEventOrdering(newValue) {
  if (!newValue) {
    return { valid: false, reason: 'empty-value' };
  }

  const incomingRevision = newValue.revision;
  const incomingSequenceId = newValue.sequenceId;

  // Check revision ordering (primary)
  if (typeof incomingRevision === 'number') {
    if (incomingRevision <= lastAppliedRevision) {
      console.warn('[Content] STORAGE_EVENT_REJECTED (revision):', {
        incomingRevision,
        lastAppliedRevision,
        reason: incomingRevision === lastAppliedRevision ? 'duplicate' : 'out-of-order'
      });
      return { valid: false, reason: 'revision-rejected' };
    }
  }

  // Check sequenceId ordering (secondary)
  if (typeof incomingSequenceId === 'number') {
    if (incomingSequenceId <= lastAppliedSequenceId) {
      console.warn('[Content] STORAGE_EVENT_REJECTED (sequenceId):', {
        incomingSequenceId,
        lastAppliedSequenceId,
        reason: incomingSequenceId === lastAppliedSequenceId ? 'duplicate' : 'out-of-order'
      });
      return { valid: false, reason: 'sequenceId-rejected' };
    }
  }

  return { valid: true, reason: 'passed' };
}

/**
 * Update ordering tracking after applying state
 * v1.6.3.8-v6 - Issue #2: Track highest applied revision/sequenceId
 * @param {Object} newValue - Applied storage value
 */
function _updateAppliedOrderingState(newValue) {
  if (typeof newValue.revision === 'number' && newValue.revision > lastAppliedRevision) {
    lastAppliedRevision = newValue.revision;
  }
  if (typeof newValue.sequenceId === 'number' && newValue.sequenceId > lastAppliedSequenceId) {
    lastAppliedSequenceId = newValue.sequenceId;
  }
}

/**
 * Request fresh state from background when ordering fails
 * v1.6.3.8-v6 - Issue #2: Recovery mechanism for out-of-order events
 * @param {string} reason - Reason for recovery request
 */
function _requestStateRecovery(reason) {
  console.log('[Content] STORAGE_STATE_RECOVERY_REQUESTED:', {
    reason,
    lastAppliedRevision,
    lastAppliedSequenceId,
    hasPort: !!backgroundPort,
    timestamp: Date.now()
  });

  // Try port first
  if (backgroundPort) {
    try {
      backgroundPort.postMessage({
        type: 'REQUEST_FULL_STATE_SYNC',
        source: 'content-ordering-recovery',
        reason,
        tabId: cachedTabId,
        lastAppliedRevision,
        lastAppliedSequenceId,
        timestamp: Date.now()
      });
      return;
    } catch (err) {
      console.warn('[Content] Port recovery request failed:', err.message);
    }
  }

  // Fallback to storage.local.get
  _fallbackToStorageRead(reason);
}

/**
 * Fallback to storage.local.get when port fails
 * v1.6.3.8-v6 - Issue #4: Fallback mechanism when port.postMessage fails
 * @param {string} reason - Reason for fallback
 */
async function _fallbackToStorageRead(reason) {
  console.log('[Content] STORAGE_FALLBACK_READ:', { reason, timestamp: Date.now() });

  try {
    const result = await browser.storage.local.get(CONTENT_STATE_KEY);
    const storedState = result?.[CONTENT_STATE_KEY];

    if (!storedState) {
      console.warn('[Content] STORAGE_FALLBACK_EMPTY: No state in storage');
      return;
    }

    console.log('[Content] STORAGE_FALLBACK_SUCCESS:', {
      tabCount: storedState.tabs?.length || 0,
      revision: storedState.revision,
      sequenceId: storedState.sequenceId,
      saveId: storedState.saveId
    });

    // Update ordering state and notify QuickTabsManager if available
    _updateAppliedOrderingState(storedState);
    _notifyManagerOfStorageUpdate(storedState, 'storage-fallback');
  } catch (err) {
    console.error('[Content] STORAGE_FALLBACK_ERROR:', err.message);
  }
}

/**
 * Notify QuickTabsManager of storage update
 * v1.6.3.8-v6 - Issue #1: Bridge storage events to QuickTabsManager
 * @param {Object} state - State from storage
 * @param {string} source - Source of the update
 */
function _notifyManagerOfStorageUpdate(state, source) {
  // Check if QuickTabsManager is available and initialized
  if (!quickTabsManager?.internalEventBus) {
    console.log('[Content] STORAGE_UPDATE_DEFERRED: QuickTabsManager not ready');
    return;
  }

  // Emit internal event for QuickTabsManager to handle
  quickTabsManager.internalEventBus.emit('storage:updated', {
    state,
    source,
    tabCount: state.tabs?.length || 0,
    revision: state.revision,
    sequenceId: state.sequenceId,
    timestamp: Date.now()
  });

  console.log('[Content] STORAGE_UPDATE_NOTIFIED:', {
    source,
    tabCount: state.tabs?.length || 0,
    revision: state.revision
  });
}

/**
 * Handle storage.onChanged event for Quick Tabs state
 * v1.6.3.8-v6 - Issue #1: Fallback when port messaging fails
 * @param {Object} changes - Storage changes
 * @param {string} areaName - Storage area ('local', 'sync', etc.)
 */
function _handleStorageChange(changes, areaName) {
  // Only handle local storage changes
  if (areaName !== 'local') return;

  // Only handle Quick Tabs state changes
  const stateChange = changes[CONTENT_STATE_KEY];
  if (!stateChange) return;

  const newValue = stateChange.newValue;
  const oldValue = stateChange.oldValue;

  console.log('[Content] STORAGE_CHANGE_RECEIVED:', {
    hasNewValue: !!newValue,
    hasOldValue: !!oldValue,
    newRevision: newValue?.revision,
    oldRevision: oldValue?.revision,
    newSequenceId: newValue?.sequenceId,
    newTabCount: newValue?.tabs?.length || 0,
    timestamp: Date.now()
  });

  // Validate ordering
  const orderingResult = _validateStorageEventOrdering(newValue);
  if (!orderingResult.valid) {
    // Request fresh state if ordering fails
    if (orderingResult.reason !== 'empty-value') {
      _requestStateRecovery(orderingResult.reason);
    }
    return;
  }

  // Update ordering state
  _updateAppliedOrderingState(newValue);

  // Notify QuickTabsManager
  _notifyManagerOfStorageUpdate(newValue, 'storage.onChanged');
}

/**
 * Send message via port with fallback to storage.local.get
 * v1.6.3.8-v6 - Issue #4: Graceful fallback when port fails
 * @param {Object} message - Message to send
 * @param {Object} options - Options for sending
 * @param {number} [options.maxRetries=3] - Max retry attempts
 * @param {number} [options.retryDelayMs=100] - Initial retry delay
 * @returns {Promise<Object>} Response or fallback result
 */
async function sendPortMessageWithFallback(message, options = {}) {
  const { maxRetries = 3, retryDelayMs = 100 } = options;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Try port if available
    if (backgroundPort) {
      try {
        backgroundPort.postMessage(message);
        console.log('[Content] PORT_MESSAGE_SENT:', {
          type: message.type || message.action,
          attempt: attempt + 1
        });
        return { success: true, method: 'port', attempt: attempt + 1 };
      } catch (err) {
        lastError = err;
        console.warn('[Content] PORT_MESSAGE_FAILED:', {
          attempt: attempt + 1,
          error: err.message
        });
      }
    }

    // Wait before retry with exponential backoff
    if (attempt < maxRetries - 1) {
      const delay = retryDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed - fallback to storage read
  console.warn('[Content] PORT_MESSAGE_ALL_RETRIES_FAILED:', {
    totalAttempts: maxRetries,
    lastError: lastError?.message,
    fallbackAction: 'storage.local.get'
  });

  // Fallback: read from storage.local
  try {
    const result = await browser.storage.local.get(CONTENT_STATE_KEY);
    const state = result?.[CONTENT_STATE_KEY];

    if (state) {
      console.log('[Content] PORT_FALLBACK_STORAGE_SUCCESS:', {
        tabCount: state.tabs?.length || 0,
        revision: state.revision
      });
      return { success: true, method: 'storage-fallback', state };
    }
  } catch (storageErr) {
    console.error('[Content] PORT_FALLBACK_STORAGE_ERROR:', storageErr.message);
  }

  return { success: false, method: 'none', error: lastError?.message || 'Port unavailable' };
}

// v1.6.3.8-v6 - Issue #1: Register storage.onChanged listener as fallback
browser.storage.onChanged.addListener(_handleStorageChange);
console.log('[Content] v1.6.3.8-v6 storage.onChanged listener registered');

// ==================== END STORAGE FALLBACK & ORDERING ====================

/**
 * v1.6.0.3 - Helper to initialize Quick Tabs
 * v1.6.3.5-v10 - FIX Issue #3: Get tab ID from background before initializing Quick Tabs
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Set writing tab ID for storage ownership
 */
async function initializeQuickTabsFeature() {
  console.log('[Copy-URL-on-Hover] About to initialize Quick Tabs...');

  // v1.6.3.5-v10 - FIX Issue #3: Get tab ID FIRST from background script
  // This is critical for cross-tab scoping - Quick Tabs should only render
  // in the tab they were created in (originTabId must match currentTabId)
  const currentTabId = await getCurrentTabIdFromBackground();
  console.log('[Copy-URL-on-Hover] Current tab ID for Quick Tabs initialization:', currentTabId);

  // v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Set writing tab ID for storage ownership
  // This is CRITICAL: content scripts cannot use browser.tabs.getCurrent(), so they must
  // explicitly set the tab ID for storage-utils to validate ownership during writes
  if (currentTabId !== null) {
    setWritingTabId(currentTabId);
    console.log('[Copy-URL-on-Hover] Set writing tab ID for storage ownership:', currentTabId);

    // v1.6.3.6-v11 - FIX Issue #11: Establish persistent port connection
    connectContentToBackground(currentTabId);
  } else {
    console.warn(
      '[Copy-URL-on-Hover] WARNING: Could not set writing tab ID - storage writes may fail ownership validation'
    );
  }

  // Pass currentTabId as option so UICoordinator can filter by originTabId
  quickTabsManager = await initQuickTabs(eventBus, Events, { currentTabId });

  if (quickTabsManager) {
    console.log('[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized successfully');
    console.log(
      '[Copy-URL-on-Hover] Manager has createQuickTab:',
      typeof quickTabsManager.createQuickTab
    );
    console.log('[Copy-URL-on-Hover] Manager currentTabId:', quickTabsManager.currentTabId);
  } else {
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

  // v1.6.3.7-v8 - Phase 3A Optimization #6: Initialize LinkVisibilityObserver
  // This enables IntersectionObserver-based visibility tracking for links
  // to reduce CPU usage on link-heavy pages by skipping hover processing
  // for links that are not currently visible in the viewport
  if (LinkVisibilityObserver.isSupported()) {
    LinkVisibilityObserver.initialize();
    console.log('[Copy-URL-on-Hover] LinkVisibilityObserver initialized');
  } else {
    console.log('[Copy-URL-on-Hover] IntersectionObserver not supported, using fallback');
  }

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

  // v1.6.3.7-v8 - Phase 3A Optimization #6: Skip processing for off-screen links
  // This optimization reduces CPU usage on link-heavy pages by only processing
  // hover events for links that are currently visible in the viewport
  if (!LinkVisibilityObserver.isLinkVisible(element)) {
    // Link is off-screen, skip URL detection to save CPU
    return;
  }

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
    pinnedToUrl: null
  };
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for Quick Tab IDs
 */
function generateQuickTabIds() {
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
  const { quickTabId, saveId, canUseManagerSaveId } = generateQuickTabIds();
  const quickTabData = buildQuickTabData({
    url,
    id: quickTabId,
    position,
    size: { width, height },
    title
  });

  // Execute creation with error handling
  try {
    await executeQuickTabCreation(quickTabData, saveId, canUseManagerSaveId);
  } catch (err) {
    handleQuickTabCreationError(err, saveId, canUseManagerSaveId);
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

// v1.6.3.4-v11 - FIX Issue #2: Message deduplication to prevent duplicate RESTORE_QUICK_TAB processing
// Map of quickTabId -> timestamp of last processed restore message
const recentRestoreMessages = new Map();
const RESTORE_DEDUP_WINDOW_MS = 2000; // Reject duplicates within 2000ms window

/**
 * Check if restore message is a duplicate (within deduplication window)
 * v1.6.3.4-v11 - FIX Issue #2: Prevent duplicate restore processing
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if this is a duplicate that should be rejected
 */
function _isDuplicateRestoreMessage(quickTabId) {
  const now = Date.now();
  const lastProcessed = recentRestoreMessages.get(quickTabId);

  if (lastProcessed && now - lastProcessed < RESTORE_DEDUP_WINDOW_MS) {
    console.warn('[Content] BLOCKED duplicate RESTORE_QUICK_TAB:', {
      quickTabId,
      timeSinceLastRestore: now - lastProcessed,
      dedupWindowMs: RESTORE_DEDUP_WINDOW_MS
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
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupOldRestoreEntries(now) {
  const cutoff = now - RESTORE_DEDUP_WINDOW_MS * 5;
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
 * Build restore ownership info with ID pattern fallback
 * v1.6.4.8 - Extracted for code health
 * @private
 * @param {string} quickTabId - Quick Tab ID to check
 * @returns {Object} Ownership details including ID pattern match
 */
function _getRestoreOwnership(quickTabId) {
  const ownership = _getQuickTabOwnership(quickTabId);
  const extractedTabId = _extractTabIdFromQuickTabId(quickTabId);
  const matchesIdPattern = extractedTabId !== null && extractedTabId === ownership.currentTabId;

  return {
    ...ownership,
    extractedTabId,
    matchesIdPattern,
    ownsQuickTab: ownership.hasInMap || ownership.hasSnapshot || matchesIdPattern
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
 * @private
 * @param {string} quickTabId - Quick Tab ID to restore
 * @param {Function} sendResponse - Response callback
 */
function _handleRestoreQuickTab(quickTabId, sendResponse) {
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

  const restoreOwnership = _getRestoreOwnership(quickTabId);

  console.log('[Content] RESTORE_QUICK_TAB: Ownership check:', {
    quickTabId,
    currentTabId: restoreOwnership.currentTabId,
    hasInMap: restoreOwnership.hasInMap,
    hasSnapshot: restoreOwnership.hasSnapshot,
    extractedTabId: restoreOwnership.extractedTabId,
    matchesIdPattern: restoreOwnership.matchesIdPattern,
    ownsQuickTab: restoreOwnership.ownsQuickTab
  });

  // Guard: Cross-tab filtering
  if (!restoreOwnership.ownsQuickTab) {
    _sendCrossTabFilteredResponse(quickTabId, sendResponse, restoreOwnership);
    return;
  }

  console.log('[Content] RESTORE_QUICK_TAB: Processing - Quick Tab is owned by this tab:', {
    quickTabId,
    currentTabId: restoreOwnership.currentTabId,
    hasInMap: restoreOwnership.hasInMap,
    hasSnapshot: restoreOwnership.hasSnapshot
  });

  _handleManagerAction(
    quickTabId,
    'Restored',
    id => quickTabsManager.restoreById(id, 'Manager'),
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
 * Handle CLEAR_CONTENT_LOGS action
 * @private
 */
function _handleClearContentLogs(sendResponse) {
  try {
    clearConsoleLogs();
    clearLogBuffer();
    sendResponse({ success: true, clearedAt: Date.now() });
  } catch (error) {
    console.error('[Content] Error clearing log buffer:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle REFRESH_LIVE_CONSOLE_FILTERS action
 * @private
 */
function _handleRefreshLiveConsoleFilters(sendResponse) {
  try {
    refreshLiveConsoleSettings();
    sendResponse({ success: true, refreshedAt: Date.now() });
  } catch (error) {
    console.error('[Content] Error refreshing live console filters:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle CLOSE_MINIMIZED_QUICK_TABS action (legacy)
 * @private
 */
function _handleCloseMinimizedQuickTabs(sendResponse) {
  console.log('[Content] Received CLOSE_MINIMIZED_QUICK_TABS request (legacy)');
  sendResponse({ success: true, message: 'Handled by individual CLOSE_QUICK_TAB messages' });
}

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
    console.log('[Content] Received RESTORE_QUICK_TAB request:', message.quickTabId);
    _handleRestoreQuickTab(message.quickTabId, sendResponse);
    return true;
  },
  CLOSE_MINIMIZED_QUICK_TABS: (message, sendResponse) => {
    _handleCloseMinimizedQuickTabs(sendResponse);
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

const QUICK_TAB_COMMAND_HANDLERS = {
  MINIMIZE_QUICK_TAB: (quickTabId, source) => {
    const handler = quickTabsManager?.visibilityHandler?.handleMinimize;
    if (!handler)
      return {
        success: false,
        error: 'Quick Tabs manager not initialized or visibility handler not ready'
      };
    handler.call(quickTabsManager.visibilityHandler, quickTabId, source || 'manager');
    return { success: true, action: 'minimized' };
  },
  RESTORE_QUICK_TAB: (quickTabId, source) => _executeRestoreCommand(quickTabId, source),
  CLOSE_QUICK_TAB: (quickTabId, _source) => {
    const handler = quickTabsManager?.closeById;
    if (!handler)
      return {
        success: false,
        error: 'Quick Tabs manager not initialized - closeById not available'
      };
    handler.call(quickTabsManager, quickTabId);
    return { success: true, action: 'closed' };
  },
  FOCUS_QUICK_TAB: (quickTabId, source) => {
    const handler = quickTabsManager?.visibilityHandler?.handleFocus;
    if (!handler)
      return {
        success: false,
        error: 'Quick Tabs manager not initialized or visibility handler not ready'
      };
    handler.call(quickTabsManager.visibilityHandler, quickTabId, source || 'manager');
    return { success: true, action: 'focused' };
  }
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
