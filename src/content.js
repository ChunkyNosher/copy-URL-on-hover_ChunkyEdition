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
 * Check if DOM is ready for safe element access
 * v1.6.3.11 - FIX Issue #37: Explicit DOM readiness check before parentElement access
 * @returns {boolean} - True if DOM is ready for safe access
 */
function _isDomReadyForElementAccess() {
  // Check if document is in a state where we can safely access elements
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    return true;
  }
  // If document is still loading, we may not have safe access
  return false;
}

/**
 * Check if we should skip initialization (inside Quick Tab iframe)
 * v1.6.3.11 - FIX Issue #37: Add DOM readiness check before parentElement access
 * @returns {boolean} - True if initialization should be skipped
 */
function _checkShouldSkipInitialization() {
  // Not in iframe - proceed normally
  if (window.self === window.top) {
    return false;
  }

  // v1.6.3.11 - FIX Issue #37: Check DOM readiness before accessing frame elements
  // If DOM isn't ready, err on side of caution and skip (fail-safe)
  if (!_isDomReadyForElementAccess()) {
    console.log('[Content] Skipping initialization - DOM not ready for frame check (fail-safe)');
    window.CUO_skipped = true;
    window.CUO_skip_reason = 'dom-not-ready';
    return true;
  }

  // In iframe - check if parent is Quick Tab
  try {
    const parentFrame = window.frameElement;
    // v1.6.3.11 - FIX Issue #37: Handle null parentFrame gracefully
    if (parentFrame === null) {
      // Cross-origin iframe or restricted access - err on side of caution
      console.log('[Content] Skipping initialization - frameElement is null (restricted access)');
      window.CUO_skipped = true;
      window.CUO_skip_reason = 'null-frame-element';
      return true;
    }
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
 *
 * v1.6.3.10-v12 Changes:
 * - FIX Issue #5: Add sequenceId to CREATE_QUICK_TAB messages for ordering enforcement
 * - FIX Issue #22: VisibilityHandler consistency checks started automatically
 * - FIX Issue #3: Extended state machine with CREATING, CLOSING, ERROR states
 * - FIX Issue #1: Port onDisconnect race condition during initialization (port-disconnect-racing.md)
 * - FIX Issue #2: BFCache silent port disconnection handling (pagehide/pageshow listeners)
 * - FIX Issue #4: Periodic adoption TTL recalculation via heartbeat latency updates
 * - FIX Issue #11: PORT_CONNECTION_STATE.RECONNECTING state for backoff distinction
 * - FIX Issue #12: Adoption cache cleared on cross-domain navigation (beforeunload)
 *
 * v1.6.3.11-v2 Changes (Diagnostic Report Part 1 Fixes):
 * - FIX Issue #1: BFCache PORT_VERIFY timeout increased to 2000ms with enhanced logging
 * - FIX Issue #2: Document port listener registration order (Firefox limitation)
 * - FIX Issue #3: User-friendly message when shortcut pressed during initialization
 * - FIX Issue #4: Extended Tab ID timeout to 120s, NOT_INITIALIZED delay to 1000ms
 * - FIX Issue #5: RESTORE message ordering - queue instead of reject out-of-order messages
 * - FIX Issue #7: Hydration timeout increased to 10s with progress warnings at 3s/6s/9s
 * - FIX Issue #8: Comprehensive port lifecycle logging (state transitions, latency)
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
// v1.6.3.10-v13 - FIX Issue #9: Import periodic latency measurement functions
import {
  setWritingTabId,
  isWritingTabIdInitialized,
  startPeriodicLatencyMeasurement,
  stopPeriodicLatencyMeasurement
} from './utils/storage-utils.js';

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
// v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Extended total timeout to 120 seconds
// After initial backoff exhaustion, use slower retry loop with 5-10s intervals
// Total extended timeout: 120 seconds to allow for very slow background initialization
const TAB_ID_EXTENDED_RETRY_INTERVAL_MS = 5000;
const TAB_ID_EXTENDED_RETRY_MAX_ATTEMPTS = 20; // 20 x 5s = 100s additional retry window
const TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS = 120000; // 120 seconds total timeout

// v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Longer initial delay for NOT_INITIALIZED
// When background reports NOT_INITIALIZED, wait 1000ms instead of 500ms
// Rationale for 1000ms:
// - 500ms was too short for slow systems where background initialization takes 300-800ms
// - 1000ms provides 2x safety margin (observed max init time ~600ms + 400ms buffer)
// - Still fast enough to not impact perceived startup time
const TAB_ID_NOT_INITIALIZED_DELAY_MS = 1000;

// v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Warning thresholds for approaching timeout
const TAB_ID_TIMEOUT_WARNING_THRESHOLDS = [60000, 90000, 110000]; // Warn at 60s, 90s, 110s

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

// ==================== v1.6.3.11-v3 FIX ISSUE #48: CROSS-BROWSER MESSAGE TIMEOUT ====================
// Firefox browser.runtime.sendMessage has NO built-in timeout unlike Chrome's ~9s implicit timeout
// This wrapper enforces explicit timeouts for cross-browser compatibility

/**
 * Default message timeout (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #48: Explicit timeout for Firefox compatibility
 */
const DEFAULT_MESSAGE_TIMEOUT_MS = 5000;

/**
 * Minimum message timeout (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #48: Never go below this threshold
 */
const MIN_MESSAGE_TIMEOUT_MS = 1000;

/**
 * Maximum message timeout (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #48: Cap adaptive timeout at reasonable limit
 */
const MAX_MESSAGE_TIMEOUT_MS = 15000;

/**
 * Message latency tracking for adaptive timeout
 * v1.6.3.11-v3 - FIX Issue #48: Array of recent message latencies
 */
const recentMessageLatencies = [];

/**
 * Maximum latency samples to keep
 * v1.6.3.11-v3 - FIX Issue #48
 */
const MAX_LATENCY_SAMPLES = 10;

/**
 * Multiplier for adaptive timeout (based on 95th percentile latency)
 * v1.6.3.11-v3 - FIX Issue #48: timeout = max latency * multiplier
 */
const ADAPTIVE_TIMEOUT_MULTIPLIER = 3;

/**
 * Record a message latency for adaptive timeout calculation
 * v1.6.3.11-v3 - FIX Issue #48
 * @param {number} latencyMs - Message round-trip latency in milliseconds
 */
function _recordMessageLatency(latencyMs) {
  if (typeof latencyMs !== 'number' || latencyMs <= 0) return;

  recentMessageLatencies.push(latencyMs);

  // Keep only recent samples
  while (recentMessageLatencies.length > MAX_LATENCY_SAMPLES) {
    recentMessageLatencies.shift();
  }
}

/**
 * Calculate adaptive timeout based on recent message latencies
 * v1.6.3.11-v3 - FIX Issue #48
 * @returns {number} Adaptive timeout in milliseconds
 */
function _getAdaptiveTimeout() {
  if (recentMessageLatencies.length < 3) {
    // Not enough samples - use default
    return DEFAULT_MESSAGE_TIMEOUT_MS;
  }

  // Sort for percentile calculation
  const sorted = [...recentMessageLatencies].sort((a, b) => a - b);

  // Use 95th percentile (or max if small sample)
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95Latency = sorted[Math.min(p95Index, sorted.length - 1)];

  // Apply multiplier and clamp to range
  const adaptiveTimeout = Math.round(p95Latency * ADAPTIVE_TIMEOUT_MULTIPLIER);

  return Math.max(MIN_MESSAGE_TIMEOUT_MS, Math.min(adaptiveTimeout, MAX_MESSAGE_TIMEOUT_MS));
}

/**
 * Error class for message timeout
 * v1.6.3.11-v3 - FIX Issue #48: Distinct error type for timeout vs handler error
 */
class MessageTimeoutError extends Error {
  constructor(messageType, timeoutMs, elapsedMs) {
    super(
      `Message timeout: ${messageType} did not respond within ${timeoutMs}ms (elapsed: ${elapsedMs}ms)`
    );
    this.name = 'MessageTimeoutError';
    this.messageType = messageType;
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;
    this.isTimeout = true;
  }
}

/**
 * Check if error is a retryable timeout error
 * v1.6.3.11-v3 - Helper to reduce nesting depth
 * @private
 */
function _isRetryableTimeoutError(err) {
  return err instanceof MessageTimeoutError;
}

/**
 * Handle timeout retry with exponential backoff
 * v1.6.3.11-v3 - Helper to reduce nesting depth
 * @private
 */
function _handleTimeoutRetry(err, attempts, maxRetries, context) {
  const { messageType, effectiveTimeout, startTime, useAdaptiveTimeout } = context;
  const elapsed = Date.now() - startTime;

  console.warn('[Content][MSG_TIMEOUT] Message timeout:', {
    messageType,
    attempt: attempts,
    maxRetries,
    timeoutMs: effectiveTimeout,
    elapsedMs: elapsed,
    adaptiveTimeout: useAdaptiveTimeout,
    recentLatencies: recentMessageLatencies.slice(-3)
  });

  // Return backoff delay if retries remaining, otherwise null
  if (attempts <= maxRetries) {
    const backoffMs = Math.min(1000 * Math.pow(2, attempts - 1), 5000);
    console.log('[Content][MSG_TIMEOUT] Retrying after backoff:', {
      attempt: attempts + 1,
      backoffMs
    });
    return backoffMs;
  }

  return null; // No retry
}

/**
 * Compute effective timeout for message
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce sendMessageWithTimeout complexity
 * @private
 */
function _computeEffectiveTimeout(options) {
  const { timeout, useAdaptiveTimeout = true } = options;
  if (timeout) return timeout;
  return useAdaptiveTimeout ? _getAdaptiveTimeout() : DEFAULT_MESSAGE_TIMEOUT_MS;
}

/**
 * Execute retry loop for sending messages
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce sendMessageWithTimeout complexity
 * @private
 */
async function _executeMessageRetryLoop(message, effectiveTimeout, maxRetries, context) {
  let lastError = null;
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts++;
    const result = await _attemptSendMessage(message, effectiveTimeout);

    if (result.success) {
      return { success: true, response: result.response };
    }

    lastError = result.error;
    const shouldRetry = _shouldRetryAfterError(lastError, attempts, maxRetries, context);
    if (!shouldRetry) break;

    await new Promise(resolve => setTimeout(resolve, shouldRetry.backoffMs));
  }

  return { success: false, error: lastError };
}

/**
 * Send message to background with explicit timeout
 * v1.6.3.11-v3 - FIX Issue #48: Cross-browser message wrapper with timeout enforcement
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (cc=9→4)
 *
 * @param {Object} message - Message to send
 * @param {Object} options - Options
 * @param {number} [options.timeout] - Custom timeout in ms (default: adaptive)
 * @param {boolean} [options.useAdaptiveTimeout=true] - Use adaptive timeout based on latency
 * @param {number} [options.maxRetries=0] - Maximum retries for timeout errors
 * @returns {Promise<any>} Response from background
 * @throws {MessageTimeoutError} If message times out
 */
async function sendMessageWithTimeout(message, options = {}) {
  const { useAdaptiveTimeout = true, maxRetries = 0 } = options;
  const effectiveTimeout = _computeEffectiveTimeout(options);
  const messageType = message.action || message.type || 'unknown';
  const startTime = Date.now();
  const context = { messageType, effectiveTimeout, startTime, useAdaptiveTimeout };

  const result = await _executeMessageRetryLoop(message, effectiveTimeout, maxRetries, context);

  if (result.success) {
    return result.response;
  }

  throw result.error;
}

/**
 * Attempt to send a single message with timeout
 * v1.6.3.11-v3 - Helper to reduce nesting depth
 * @private
 */
async function _attemptSendMessage(message, effectiveTimeout) {
  const attemptStart = Date.now();
  const messageType = message.action || message.type || 'unknown';

  try {
    const response = await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) => {
        setTimeout(() => {
          const elapsed = Date.now() - attemptStart;
          reject(new MessageTimeoutError(messageType, effectiveTimeout, elapsed));
        }, effectiveTimeout);
      })
    ]);

    // Record successful latency for adaptive timeout
    const latency = Date.now() - attemptStart;
    _recordMessageLatency(latency);

    return { success: true, response };
  } catch (err) {
    return { success: false, error: err };
  }
}

/**
 * Determine if error should trigger a retry
 * v1.6.3.11-v3 - Helper to reduce nesting depth
 * @private
 * @returns {{backoffMs: number}|null} Backoff info if should retry, null otherwise
 */
function _shouldRetryAfterError(err, attempts, maxRetries, context) {
  if (!_isRetryableTimeoutError(err)) return null;

  const backoffMs = _handleTimeoutRetry(err, attempts, maxRetries, context);
  if (backoffMs === null) return null;

  return { backoffMs };
}

// ==================== END ISSUE #48 FIX ====================

// ==================== v1.6.3.11-v3 FIX ISSUE #52: STALE EVENT REJECTION ====================
// Events received after BFCache restoration may have old timestamps

/**
 * Timestamp when page became inactive (entered BFCache)
 * v1.6.3.11-v3 - FIX Issue #52: Track inactivity start for stale event rejection
 */
let pageInactiveTimestamp = null;

/**
 * Check if an event timestamp is stale (occurred while page was inactive)
 * v1.6.3.11-v3 - FIX Issue #52
 * @param {number} eventTimestamp - Timestamp of the event
 * @returns {boolean} True if event is stale and should be rejected
 */
function _isStaleEvent(eventTimestamp) {
  if (!pageInactiveTimestamp || !eventTimestamp) return false;

  // Event occurred before page became inactive
  return eventTimestamp < pageInactiveTimestamp;
}

/**
 * Mark page as inactive (entering BFCache)
 * v1.6.3.11-v3 - FIX Issue #52
 */
function _markPageInactive() {
  pageInactiveTimestamp = Date.now();
}

/**
 * Mark page as active (restored from BFCache)
 * v1.6.3.11-v3 - FIX Issue #52: Clear inactive timestamp on restoration
 */
function _markPageActive() {
  if (pageInactiveTimestamp) {
    console.log('[Content][BFCACHE] PAGE_ACTIVE: Cleared inactive timestamp', {
      wasInactiveSince: pageInactiveTimestamp,
      inactiveDuration: Date.now() - pageInactiveTimestamp
    });
  }
  pageInactiveTimestamp = null;
}

// ==================== END ISSUE #52 FIX ====================

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

// ==================== v1.6.3.11-v5 FIX ISSUE #15: STATE READINESS TRACKING ====================
// Track state readiness to gate feature activation until hydration complete

/**
 * State readiness flag - true when state is fully hydrated and features can use it
 * v1.6.3.11-v5 - FIX Issue #15: Gate feature activation until state ready
 */
let isStateReady = false;

/**
 * Timestamp when initialization phases started
 * v1.6.3.11-v5 - FIX Issue #15: Track initialization timing
 */
let initPhaseStartTime = 0;

/**
 * Timestamp when hydration phase started
 * v1.6.3.11-v5 - FIX Issue #15: Track hydration timing separately
 */
let hydrationPhaseStartTime = 0;

/**
 * Track completion of individual initialization phases
 * v1.6.3.11-v5 - FIX Issue #15: Structured phase tracking
 */
const initPhaseStatus = {
  moduleLoad: { complete: false, timestamp: 0, durationMs: 0 },
  managerInit: { complete: false, timestamp: 0, durationMs: 0 },
  configLoad: { complete: false, timestamp: 0, durationMs: 0 },
  stateHydration: { complete: false, timestamp: 0, durationMs: 0 },
  featureActivation: { complete: false, timestamp: 0, durationMs: 0 }
};

/**
 * Log initialization phase start
 * v1.6.3.11-v5 - FIX Issue #15: Structured phase logging
 * @param {string} phase - Phase name
 */
function _logInitPhaseStart(phase) {
  const now = Date.now();
  console.log(`[Content][INIT_PHASE] ${phase} started:`, {
    phase,
    elapsedSinceInitMs: initPhaseStartTime > 0 ? now - initPhaseStartTime : 0,
    timestamp: now
  });
}

/**
 * Log initialization phase complete
 * v1.6.3.11-v5 - FIX Issue #15: Structured phase logging
 * @param {string} phase - Phase name
 * @param {number} startTime - Phase start timestamp
 */
function _logInitPhaseComplete(phase, startTime) {
  const now = Date.now();
  const durationMs = now - startTime;
  
  if (initPhaseStatus[phase]) {
    initPhaseStatus[phase].complete = true;
    initPhaseStatus[phase].timestamp = now;
    initPhaseStatus[phase].durationMs = durationMs;
  }
  
  console.log(`[Content][INIT_PHASE] ${phase} complete:`, {
    phase,
    durationMs,
    elapsedSinceInitMs: initPhaseStartTime > 0 ? now - initPhaseStartTime : 0,
    timestamp: now
  });
}

/**
 * Check if state is ready for feature use
 * v1.6.3.11-v5 - FIX Issue #15: Gate feature operations
 * @returns {boolean} True if state is ready
 */
function _isStateReadyForFeatures() {
  return isStateReady && isHydrationComplete;
}

/**
 * Log attempt to use uninitialized state
 * v1.6.3.11-v5 - FIX Issue #15: Track uninitialized state access
 * @param {string} feature - Feature that attempted access
 * @param {string} operation - Operation that was attempted
 */
function _logUninitializedStateAccess(feature, operation) {
  console.warn('[Content][STATE_READY] Attempt to use uninitialized state:', {
    feature,
    operation,
    isStateReady,
    isHydrationComplete,
    contentScriptInitialized,
    initPhaseStatus: Object.entries(initPhaseStatus)
      .filter(([_, v]) => v.complete)
      .map(([k]) => k),
    timestamp: Date.now()
  });
}

/**
 * Mark state as ready and log transition
 * v1.6.3.11-v5 - FIX Issue #15: State readiness transition
 */
function _markStateReady() {
  if (isStateReady) return;
  
  isStateReady = true;
  const now = Date.now();
  const totalInitTime = initPhaseStartTime > 0 ? now - initPhaseStartTime : 0;
  
  console.log('[Content][STATE_READY] State now ready for features:', {
    totalInitTimeMs: totalInitTime,
    phases: initPhaseStatus,
    timestamp: now
  });
}

// ==================== END ISSUE #15 STATE READINESS ====================

/**
 * Timeout for hydration (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #15: If hydration doesn't complete within this time, allow operations anyway
 * v1.6.3.11-v2 - FIX Issue #7 (Diagnostic Report): Increased from 3s to 10s for slow systems
 */
const HYDRATION_TIMEOUT_MS = 10000;

/**
 * Warning thresholds for hydration progress (milliseconds)
 * v1.6.3.11-v2 - FIX Issue #7 (Diagnostic Report): Log warnings at 3s, 6s, 9s marks
 */
const HYDRATION_WARNING_THRESHOLDS_MS = [3000, 6000, 9000];

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

// ==================== v1.6.3.11 FIX ISSUE #26: CROSS-QUEUE OVERFLOW PROTECTION ====================
// Unified tracking across all message queues to prevent memory/timeout issues

/**
 * Global backpressure threshold for combined queue depth
 * v1.6.3.11 - FIX Issue #26: Total messages across all queues before warning
 */
const GLOBAL_QUEUE_BACKPRESSURE_THRESHOLD = 300;

/**
 * Queue priority order for flush operations
 * v1.6.3.11 - FIX Issue #26: INIT_MESSAGES first, then HYDRATION, COMMANDS, PORT_MESSAGES
 * Prefixed with _ to indicate reserved for future ordered flush implementation
 * @enum {number}
 */
const _QUEUE_PRIORITY = {
  INIT_MESSAGES: 1,
  HYDRATION: 2,
  COMMANDS: 3,
  PORT_MESSAGES: 4
};

/**
 * Get total message count across all queues
 * v1.6.3.11 - FIX Issue #26: Unified queue depth tracking
 * @returns {Object} Queue depths and total
 */
function _getTotalQueueDepth() {
  // Note: messageQueue and pendingCommandsBuffer are declared later in the file
  // We use optional chaining and fallback to handle the declaration order
  const initQueueSize = initializationMessageQueue.length;
  const hydrationQueueSize = preHydrationOperationQueue.length;
  const portQueueSize = typeof messageQueue !== 'undefined' ? messageQueue.length : 0;
  const commandsQueueSize =
    typeof pendingCommandsBuffer !== 'undefined' ? pendingCommandsBuffer.length : 0;

  return {
    initializationMessageQueue: initQueueSize,
    preHydrationOperationQueue: hydrationQueueSize,
    messageQueue: portQueueSize,
    pendingCommandsBuffer: commandsQueueSize,
    total: initQueueSize + hydrationQueueSize + portQueueSize + commandsQueueSize
  };
}

/**
 * Check and log global backpressure warning
 * v1.6.3.11 - FIX Issue #26: Warn when combined depth exceeds threshold
 * @returns {boolean} True if backpressure threshold exceeded
 */
function _checkGlobalBackpressure() {
  const depths = _getTotalQueueDepth();

  if (depths.total >= GLOBAL_QUEUE_BACKPRESSURE_THRESHOLD) {
    console.warn('[Content][BACKPRESSURE] GLOBAL_THRESHOLD_EXCEEDED:', {
      threshold: GLOBAL_QUEUE_BACKPRESSURE_THRESHOLD,
      ...depths,
      timestamp: Date.now()
    });
    return true;
  }

  return false;
}

// ==================== END ISSUE #26 FIX ====================

/**
 * Track dropped messages for retry
 * v1.6.3.10-v11 - FIX Issue #6: Retry dropped messages
 * v1.6.3.10-v13 - FIX Issue #6: Dynamic buffer sizing based on backpressure
 */
const droppedMessageBuffer = [];

/**
 * Base dropped messages buffer size
 * v1.6.3.10-v13 - FIX Issue #6: Scales up during backpressure
 */
const BASE_DROPPED_MESSAGES = 10;

/**
 * Maximum dropped messages buffer size during high backpressure
 * v1.6.3.10-v13 - FIX Issue #6: Increased from fixed 10 to dynamic max 50
 */
const MAX_DROPPED_MESSAGES_BACKPRESSURE = 50;

/**
 * Get current dropped message buffer limit based on queue backpressure
 * v1.6.3.10-v13 - FIX Issue #6: Dynamic buffer sizing
 * @returns {number} Current buffer limit
 */
function _getDroppedMessageBufferLimit() {
  const queueDepth = initializationMessageQueue.length;
  const queuePercent = (queueDepth / MAX_INIT_MESSAGE_QUEUE_SIZE) * 100;

  // If queue is above 80%, increase buffer to max
  if (queuePercent > 80) {
    return MAX_DROPPED_MESSAGES_BACKPRESSURE;
  }
  // If queue is above 50%, use intermediate size
  if (queuePercent > 50) {
    return Math.floor(
      BASE_DROPPED_MESSAGES + (MAX_DROPPED_MESSAGES_BACKPRESSURE - BASE_DROPPED_MESSAGES) * 0.5
    );
  }

  return BASE_DROPPED_MESSAGES;
}

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
let _lastHeartbeatTime = 0; // Prefixed with _ to indicate unused (available for debug logging)
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
 * Port generation counter - incremented on each port reconnection
 * v1.6.3.11-v3 - FIX Issue #27: Include port generation in message IDs to prevent collision across reconnections
 * @type {number}
 */
let portGeneration = 0;

/**
 * Pending message garbage collection interval (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #33: Periodically clean up stale entries
 * @type {number}
 */
const PENDING_MESSAGE_GC_INTERVAL_MS = 30000; // 30 seconds

/**
 * Maximum age for pending messages before garbage collection (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #33: Messages older than this are stale
 * @type {number}
 */
const PENDING_MESSAGE_MAX_AGE_MS = 30000; // 30 seconds (same as timeout threshold from issue)

/**
 * Garbage collection interval ID
 * v1.6.3.11-v3 - FIX Issue #33
 * @type {number|null}
 */
let pendingMessageGcIntervalId = null;

/**
 * Check if message IDs match between request and response
 * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce _validateResponseMatchesRequest complexity
 * @private
 */
function _checkMessageIdMatch(request, response) {
  const requestMessageId = request.messageId;
  const responseMessageId = response?.messageId;

  if (responseMessageId && responseMessageId !== requestMessageId) {
    console.warn('[Content] RESPONSE_ID_MISMATCH:', {
      requestMessageId,
      responseMessageId,
      requestAction: request.action || request.type
    });
    return {
      valid: false,
      reason: `Message ID mismatch: expected ${requestMessageId}, got ${responseMessageId}`
    };
  }
  return { valid: true };
}

/**
 * Check if Quick Tab ID matches for CREATE operations
 * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce _validateResponseMatchesRequest complexity
 * @private
 */
function _checkQuickTabIdMatch(request, response) {
  if (request.action !== 'CREATE_QUICK_TAB') {
    return { valid: true };
  }

  if (response.quickTabId && response.quickTabId !== request.id) {
    console.warn('[Content] RESPONSE_QUICKTAB_ID_MISMATCH:', {
      requestId: request.id,
      responseQuickTabId: response.quickTabId,
      requestAction: request.action
    });
    return {
      valid: false,
      reason: `Quick Tab ID mismatch: expected ${request.id}, got ${response.quickTabId}`
    };
  }
  return { valid: true };
}

/**
 * Check if generation values are valid for comparison
 * v1.6.3.11-v4 - FIX Code Health: Encapsulate complex conditional
 * @private
 * @param {number|null} requestGen - Parsed request generation
 * @param {*} responseGeneration - Response generation value
 * @returns {boolean} True if both generations are valid for comparison
 */
function _areGenerationsComparable(requestGen, responseGeneration) {
  return requestGen !== null && typeof responseGeneration === 'number';
}

/**
 * Check if response generation is stale (older than request)
 * v1.6.3.11-v4 - FIX Code Health: Encapsulate complex conditional
 * @private
 * @param {number} requestGen - Request generation number
 * @param {number} responseGeneration - Response generation number
 * @returns {boolean} True if response generation is stale
 */
function _isResponseGenerationStale(requestGen, responseGeneration) {
  return responseGeneration < requestGen;
}

/**
 * Warn if response generation is stale compared to request
 * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce _validateResponseMatchesRequest complexity
 * v1.6.3.11-v4 - FIX Code Health: Encapsulated complex conditionals
 * @private
 */
function _warnIfGenerationStale(requestMessageId, responseGeneration) {
  if (responseGeneration === undefined || responseGeneration === null) {
    return; // No generation to check
  }

  const requestGenMatch = requestMessageId?.match(/g(\d+)-/);
  const requestGen = requestGenMatch ? parseInt(requestGenMatch[1], 10) : null;

  if (!_areGenerationsComparable(requestGen, responseGeneration)) {
    return;
  }

  if (_isResponseGenerationStale(requestGen, responseGeneration)) {
    console.warn('[Content] RESPONSE_GENERATION_STALE:', {
      requestGeneration: requestGen,
      responseGeneration,
      messageId: requestMessageId
    });
  }
}

/**
 * Validate that a response matches the expected request
 * v1.6.3.11-v3 - FIX Issue #73: Prevent out-of-order response matching
 * v1.6.3.11-v3 - FIX Code Health: Refactored to reduce complexity
 *
 * Validates:
 * 1. Response messageId matches request messageId
 * 2. Response echoes expected request parameters (action, quickTabId, etc.)
 *
 * @param {Object} response - Response from background
 * @param {Object} pendingEntry - Pending message entry from pendingMessages Map
 * @returns {{valid: boolean, reason?: string}}
 */
function _validateResponseMatchesRequest(response, pendingEntry) {
  const request = pendingEntry?.message;

  if (!request) {
    return { valid: false, reason: 'No pending request found' };
  }

  // Validate messageId matches
  const idCheck = _checkMessageIdMatch(request, response);
  if (!idCheck.valid) return idCheck;

  // Validate Quick Tab ID for CREATE operations
  const qtCheck = _checkQuickTabIdMatch(request, response);
  if (!qtCheck.valid) return qtCheck;

  // Warn if generation is stale (doesn't invalidate response)
  _warnIfGenerationStale(request.messageId, response?.generation);

  return { valid: true };
}

/**
 * Generate unique message ID for correlation
 * v1.6.3.10-v11 - FIX Issue #23
 * v1.6.3.11 - FIX Issue #28: Add namespace prefix to prevent collision with background
 * v1.6.3.11-v3 - FIX Issue #27: Include portGeneration to prevent collision across reconnections
 * @returns {string} Unique message ID with content script namespace and port generation
 */
function _generateMessageId() {
  const newId = `msg-content-g${portGeneration}-${Date.now()}-${++messageIdCounter}`;

  // v1.6.3.11 - FIX Issue #28: Collision detection
  if (pendingMessages.has(newId)) {
    console.warn('[Content] MESSAGE_ID_COLLISION: Regenerating ID', { collided: newId });
    return _generateMessageId(); // Recursive regeneration
  }

  return newId;
}

/**
 * Garbage collect stale pending messages
 * v1.6.3.11-v3 - FIX Issue #33: Prevent unbounded Map growth from network timeouts
 * @private
 */
function _gcPendingMessages() {
  const now = Date.now();
  let collectedCount = 0;

  for (const [messageId, pending] of pendingMessages) {
    const messageAge = now - pending.sentAt;
    const isStale = messageAge >= PENDING_MESSAGE_MAX_AGE_MS;

    if (!isStale) continue;

    // Reject the stale message before removing
    if (pending.reject) {
      pending.reject(new Error(`Message timeout after ${messageAge}ms (garbage collected)`));
    }
    pendingMessages.delete(messageId);
    collectedCount++;
  }

  if (collectedCount > 0) {
    console.log('[Content][GC] PENDING_MESSAGES_COLLECTED:', {
      collectedCount,
      remainingCount: pendingMessages.size,
      thresholdMs: PENDING_MESSAGE_MAX_AGE_MS,
      timestamp: now
    });
  }
}

/**
 * Start periodic garbage collection of pending messages
 * v1.6.3.11-v3 - FIX Issue #33
 * @private
 */
function _startPendingMessageGc() {
  if (pendingMessageGcIntervalId) {
    clearInterval(pendingMessageGcIntervalId);
  }
  pendingMessageGcIntervalId = setInterval(_gcPendingMessages, PENDING_MESSAGE_GC_INTERVAL_MS);
  console.log('[Content][GC] PENDING_MESSAGE_GC_STARTED:', {
    intervalMs: PENDING_MESSAGE_GC_INTERVAL_MS,
    timestamp: Date.now()
  });
}

/**
 * Stop periodic garbage collection of pending messages
 * v1.6.3.11-v3 - FIX Issue #33
 * @private
 */
function _stopPendingMessageGc() {
  if (pendingMessageGcIntervalId) {
    clearInterval(pendingMessageGcIntervalId);
    pendingMessageGcIntervalId = null;
    console.log('[Content][GC] PENDING_MESSAGE_GC_STOPPED');
  }
}

/**
 * Check if background generation has changed (indicates restart)
 * v1.6.3.11-v4 - FIX Code Health: Encapsulate complex conditional
 * @private
 * @param {Object} response - Heartbeat response from background
 * @returns {boolean} True if background generation has changed
 */
function _hasBackgroundGenerationChanged(response) {
  return (
    response?.generation &&
    lastKnownBackgroundGeneration !== null &&
    response.generation !== lastKnownBackgroundGeneration
  );
}

/**
 * Process successful heartbeat response
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _sendHeartbeat complexity
 * @private
 * @param {Object} response - Heartbeat response from background
 * @param {string} heartbeatId - The heartbeat message ID
 * @param {number} heartbeatStart - Start timestamp of heartbeat
 */
function _handleHeartbeatSuccess(response, heartbeatId, heartbeatStart) {
  const latencyMs = Date.now() - heartbeatStart;
  _lastHeartbeatTime = Date.now();
  heartbeatFailureCount = 0;

  // v1.6.3.10-v11 - FIX Issue #5: Record latency for dynamic adoption TTL
  if (typeof _recordHandshakeLatency === 'function') {
    _recordHandshakeLatency(latencyMs);
  }

  // Check for background restart
  if (_hasBackgroundGenerationChanged(response)) {
    console.log('[Content][HEARTBEAT] BACKGROUND_RESTART_DETECTED:', {
      previousGeneration: lastKnownBackgroundGeneration,
      newGeneration: response.generation,
      latencyMs
    });
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
}

/**
 * Process heartbeat failure
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _sendHeartbeat complexity
 * @private
 * @param {Error} err - The error that occurred
 * @param {string} heartbeatId - The heartbeat message ID
 */
function _handleHeartbeatFailure(err, heartbeatId) {
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

/**
 * Send heartbeat to background and check for restart
 * v1.6.3.10-v11 - FIX Issue #23
 * v1.6.3.11-v4 - FIX Code Health: Extracted success/failure handlers to reduce complexity
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

    _handleHeartbeatSuccess(response, heartbeatId, heartbeatStart);
  } catch (err) {
    _handleHeartbeatFailure(err, heartbeatId);
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
      pending.reject(
        new Error(`Max retries (${MESSAGE_MAX_RETRIES}) exceeded for message ${messageId}`)
      );
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
/**
 * Create message envelope with tracking data
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _sendMessageWithRetry complexity
 * @private
 * @param {Object} message - Original message
 * @param {number} retryCount - Current retry count
 * @returns {{envelope: Object, messageId: string}} The envelope and messageId
 */
function _createMessageEnvelope(message, retryCount) {
  const messageId = message.messageId || _generateMessageId();
  const envelope = {
    ...message,
    messageId,
    timestamp: Date.now(),
    retryCount
  };
  return { envelope, messageId };
}

/**
 * Track a pending message in the Map
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _sendMessageWithRetry complexity
 * @private
 * @param {Object} options - Tracking options
 * @param {string} options.messageId - Message ID
 * @param {Object} options.envelope - Message envelope
 * @param {number} options.retryCount - Retry count
 * @param {Function} options.resolve - Promise resolve
 * @param {Function} options.reject - Promise reject
 */
function _trackPendingMessage({ messageId, envelope, retryCount, resolve, reject }) {
  pendingMessages.set(messageId, {
    message: envelope,
    retryCount,
    sentAt: Date.now(),
    resolve,
    reject
  });
}

/**
 * Handle successful message response
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _sendMessageWithRetry complexity
 * @private
 */
function _handleMessageSuccess(response, messageId, message, resolve) {
  const pendingEntry = pendingMessages.get(messageId);
  const validation = _validateResponseMatchesRequest(response, pendingEntry);

  if (!validation.valid) {
    console.error('[Content] RESPONSE_VALIDATION_FAILED:', {
      messageId,
      reason: validation.reason,
      responseMessageId: response?.messageId,
      action: message.action || message.type
    });
  }

  console.log('[Content] MESSAGE_RECEIVED_RESPONSE:', {
    messageId,
    success: response?.success ?? true,
    validationPassed: validation.valid
  });

  pendingMessages.delete(messageId);
  resolve(response);
}

/**
 * Handle message timeout with retry logic
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _sendMessageWithRetry complexity
 * @private
 */
function _handleMessageTimeout(err, messageId, reject) {
  const pending = pendingMessages.get(messageId);
  const canRetry = pending && pending.retryCount < MESSAGE_MAX_RETRIES;

  if (canRetry) {
    pendingMessages.delete(messageId);
    pending.retryCount++;
    pendingMessages.set(messageId, pending);

    console.warn('[Content] MESSAGE_TIMEOUT: Will retry on background recovery', {
      messageId,
      retryCount: pending.retryCount,
      error: err.message,
      pendingMessagesSize: pendingMessages.size
    });
    return;
  }

  pendingMessages.delete(messageId);
  reject(err);
}

/**
 * Send a message with automatic retry support
 * v1.6.3.11 - FIX Issue #10
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (cc=10→5)
 * @private
 * @param {Object} message - Message to send
 * @param {Function} resolve - Promise resolve function
 * @param {Function} reject - Promise reject function
 * @param {number} [retryCount=0] - Current retry count
 */
async function _sendMessageWithRetry(message, resolve, reject, retryCount = 0) {
  const { envelope, messageId } = _createMessageEnvelope(message, retryCount);
  _trackPendingMessage({ messageId, envelope, retryCount, resolve, reject });

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

    _handleMessageSuccess(response, messageId, message, resolve);
  } catch (err) {
    _handleMessageTimeout(err, messageId, reject);
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

// ==================== v1.6.3.11-v3 FIX ISSUE #33: START GC ON INIT ====================
// Start pending message garbage collection alongside heartbeat

/**
 * Start all periodic maintenance tasks
 * v1.6.3.11-v3 - FIX Issue #33: Centralized maintenance start
 * @private
 */
function _startPeriodicMaintenance() {
  _startHeartbeat();
  _startPendingMessageGc();
}

/**
 * Stop all periodic maintenance tasks
 * v1.6.3.11-v3 - FIX Issue #33: Centralized maintenance stop
 * @private
 */
function _stopPeriodicMaintenance() {
  _stopHeartbeat();
  _stopPendingMessageGc();
}

// ==================== END ISSUE #33 FIX ====================

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
 * v1.6.3.11 - FIX Issue #26: Add global backpressure check
 * @param {Object} message - Message to queue
 * @param {Function} callback - Callback to execute when message can be sent
 */
function _queueInitializationMessage(message, callback) {
  const queueSize = initializationMessageQueue.length;

  // v1.6.3.11 - FIX Issue #26: Check global backpressure across all queues
  _checkGlobalBackpressure();

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
    console.warn(
      '[MSG][Content] QUEUE_BACKPRESSURE: Queue approaching limit, slow down message send rate',
      {
        currentSize: queueSize,
        threshold: QUEUE_BACKPRESSURE_THRESHOLD,
        maxSize: MAX_INIT_MESSAGE_QUEUE_SIZE,
        percentFull: Math.round((queueSize / MAX_INIT_MESSAGE_QUEUE_SIZE) * 100)
      }
    );
  }
}

/**
 * Extract logging metadata from dropped message
 * v1.6.3.11-v4 - FIX Code Health: Helper to reduce _handleQueueOverflow complexity
 * @private
 * @param {Object|null} dropped - Dropped message entry
 * @returns {Object} Logging metadata
 */
function _getDroppedMessageMetadata(dropped) {
  if (!dropped) {
    return {
      droppedMessageType: null,
      droppedQuickTabId: null,
      droppedTimestamp: null,
      messageAgeMs: null
    };
  }

  const message = dropped.message || {};
  const messageType = message.action || message.type || null;
  const quickTabId = message.id || message.quickTabId || null;
  const queuedAt = dropped.queuedAt;
  const messageAge = queuedAt ? Date.now() - queuedAt : null;

  return {
    droppedMessageType: messageType,
    droppedQuickTabId: quickTabId,
    droppedTimestamp: queuedAt,
    messageAgeMs: messageAge
  };
}

/**
 * Handle queue overflow by dropping oldest message and buffering for retry
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * v1.6.3.11-v4 - FIX Code Health: Extracted metadata helper (cc=14→4)
 * @private
 */
function _handleQueueOverflow() {
  const dropped = initializationMessageQueue.shift();
  const queueSize = initializationMessageQueue.length;
  const metadata = _getDroppedMessageMetadata(dropped);

  console.error('[MSG][Content] INIT_QUEUE_OVERFLOW: Dropped message (queue full)', {
    ...metadata,
    queueSizeAtDrop: queueSize + 1,
    dropTime: Date.now()
  });

  _bufferDroppedMessage(dropped);
}

/**
 * Buffer a dropped message for later retry
 * v1.6.3.10-v11 - FIX Issue #6: Extracted to reduce complexity
 * v1.6.3.10-v13 - FIX Issue #6: Dynamic buffer limit based on backpressure
 * @private
 * @param {Object} dropped - Dropped message entry
 */
function _bufferDroppedMessage(dropped) {
  const currentLimit = _getDroppedMessageBufferLimit();

  if (!dropped || droppedMessageBuffer.length >= currentLimit) {
    if (dropped) {
      console.warn('[MSG][Content] DROPPED_MESSAGE_REJECTED: Buffer at capacity', {
        bufferSize: droppedMessageBuffer.length,
        currentLimit,
        action: dropped.message?.action || dropped.message?.type || 'unknown'
      });
    }
    return;
  }

  droppedMessageBuffer.push({
    message: dropped.message,
    callback: dropped.callback,
    originalQueuedAt: dropped.queuedAt,
    droppedAt: Date.now()
  });
  console.log('[MSG][Content] DROPPED_MESSAGE_BUFFERED: Will retry after background ready', {
    bufferSize: droppedMessageBuffer.length,
    currentLimit,
    isBackpressureMode: currentLimit > BASE_DROPPED_MESSAGES
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
    console.error('[MSG][Content] QUEUE_STATE_CRITICAL: Queue depth exceeds 1000 items', {
      queueSize: size
    });
  } else if (size >= 500) {
    console.warn('[MSG][Content] QUEUE_STATE_WARNING: Queue depth exceeds 500 items', {
      queueSize: size
    });
  } else if (size >= 100) {
    console.warn('[MSG][Content] QUEUE_STATE_WARNING: Queue depth exceeds 100 items', {
      queueSize: size
    });
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
 * v1.6.3.11-v5 - FIX Issue #15: Gate feature activation until state ready
 */
async function _markContentScriptInitialized() {
  if (contentScriptInitialized) return;

  // v1.6.3.11-v5 - FIX Issue #15: Log feature activation phase start
  const featureActivationStart = Date.now();
  _logInitPhaseStart('featureActivation');

  // v1.6.3.11-v5 - FIX Issue #15: Wait for state readiness before activating features
  if (!_isStateReadyForFeatures()) {
    console.log('[Content][FEATURE_GATE] Deferring feature activation until state ready:', {
      isStateReady,
      isHydrationComplete,
      timestamp: Date.now()
    });
    
    // v1.6.3.11-v5 - FIX Issue #15: Wait for state readiness with exponential backoff
    // This avoids inefficient polling while still being responsive
    const maxWaitMs = 500; // Max wait for state readiness
    const startWait = Date.now();
    let waitInterval = 25; // Start with 25ms, double each iteration up to 100ms max
    
    while (!_isStateReadyForFeatures() && (Date.now() - startWait) < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, waitInterval));
      waitInterval = Math.min(waitInterval * 2, 100); // Exponential backoff capped at 100ms
    }
    
    if (!_isStateReadyForFeatures()) {
      console.warn('[Content][FEATURE_GATE] Proceeding with feature activation despite incomplete state:', {
        isStateReady,
        isHydrationComplete,
        waitedMs: Date.now() - startWait,
        timestamp: Date.now()
      });
    } else {
      console.log('[Content][FEATURE_GATE] State became ready, proceeding with feature activation:', {
        waitedMs: Date.now() - startWait,
        timestamp: Date.now()
      });
    }
  }

  contentScriptInitialized = true;
  
  // v1.6.3.11-v5 - FIX Issue #15: Log feature activation complete
  _logInitPhaseComplete('featureActivation', featureActivationStart);
  
  console.log('[MSG][Content] INITIALIZATION_COMPLETE:', {
    timestamp: new Date().toISOString(),
    isStateReady,
    isHydrationComplete,
    totalInitTimeMs: initPhaseStartTime > 0 ? Date.now() - initPhaseStartTime : 0
  });

  // Flush any queued messages
  await _flushInitializationMessageQueue();
}

// ==================== v1.6.3.10-v11 FIX ISSUE #15: HYDRATION GATING ====================
// Prevent operations from running before state is hydrated from storage

// ==================== v1.6.3.11 FIX ISSUE #27: DRAIN LOCK ====================
// Prevent concurrent hydration timeout and drain execution

/**
 * Lock state for hydration queue drain
 * v1.6.3.11 - FIX Issue #27: Prevent concurrent drain/timeout execution
 */
let isHydrationDrainInProgress = false;

// ==================== END ISSUE #27 DECLARATIONS ====================

/**
 * Mark hydration as complete and drain the operation queue
 * v1.6.3.10-v11 - FIX Issue #15: Signal hydration complete
 * v1.6.3.11 - FIX Issue #27: Use drain lock to prevent race conditions
 * @param {number} [loadedTabCount=0] - Number of tabs loaded from storage
 */
async function _markHydrationComplete(loadedTabCount = 0) {
  // v1.6.3.11 - FIX Issue #27: Check drain lock to prevent concurrent execution
  if (isHydrationComplete || isHydrationDrainInProgress) {
    console.log('[Content] HYDRATION_SKIPPED:', {
      alreadyComplete: isHydrationComplete,
      drainInProgress: isHydrationDrainInProgress
    });
    return;
  }

  isHydrationComplete = true;
  
  // v1.6.3.11-v5 - FIX Issue #15: Log hydration phase complete with correct start time
  // Use hydrationPhaseStartTime if set, otherwise fall back to initPhaseStartTime
  const hydrationStartForLogging = hydrationPhaseStartTime > 0 ? hydrationPhaseStartTime : initPhaseStartTime;
  _logInitPhaseComplete('stateHydration', hydrationStartForLogging);
  
  console.log('[Content] HYDRATION_COMPLETE:', {
    loadedTabCount,
    queuedOperations: preHydrationOperationQueue.length,
    timestamp: Date.now()
  });

  // v1.6.3.11-v5 - FIX Issue #15: Mark state as ready after hydration
  _markStateReady();

  // Drain queued operations
  await _drainPreHydrationQueue();
}

/**
 * Queue an operation that arrived before hydration completed
 * v1.6.3.10-v11 - FIX Issue #15: Buffer operations during hydration
 * v1.6.3.11 - FIX Issue #26: Add global backpressure check
 * @param {Object} operation - Operation to queue
 * @param {string} operation.type - Operation type
 * @param {Object} operation.data - Operation data
 * @param {Function} [operation.callback] - Callback to execute when operation is processed
 */
function _queuePreHydrationOperation(operation) {
  // v1.6.3.11 - FIX Issue #26: Check global backpressure across all queues
  _checkGlobalBackpressure();

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
 * v1.6.3.11 - FIX Issue #27: Use drain lock to prevent duplicate execution
 * @private
 */
async function _drainPreHydrationQueue() {
  if (preHydrationOperationQueue.length === 0) return;

  // v1.6.3.11 - FIX Issue #27: Acquire drain lock
  if (isHydrationDrainInProgress) {
    console.log('[Content] DRAIN_SKIPPED: Already in progress');
    return;
  }

  isHydrationDrainInProgress = true;
  console.log('[Content] DRAIN_IN_PROGRESS:', {
    queueSize: preHydrationOperationQueue.length
  });

  try {
    while (preHydrationOperationQueue.length > 0) {
      const operation = preHydrationOperationQueue.shift();
      const queueDuration = Date.now() - operation.queuedAt;
      await _executeQueuedOperation(operation, queueDuration);
    }

    console.log('[Content] DRAIN_COMPLETE:', {
      timestamp: Date.now()
    });
  } finally {
    // v1.6.3.11 - FIX Issue #27: Always release lock
    isHydrationDrainInProgress = false;
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
 * v1.6.3.11 - FIX Issue #27: Check drain lock before forcing completion
 * v1.6.3.11-v2 - FIX Issue #7 (Diagnostic Report): Extended timeout with progress warnings
 */
function _initHydrationTimeout() {
  // v1.6.3.11-v5 - FIX Issue #15: Set global hydration phase start time
  hydrationPhaseStartTime = Date.now();
  const loggedWarnings = new Set();

  // v1.6.3.11-v5 - FIX Issue #15: Log hydration phase start
  _logInitPhaseStart('stateHydration');

  // v1.6.3.11-v2 - FIX Issue #7: Set up warning interval for progress logging
  const warningIntervalId = setInterval(() => {
    if (isHydrationComplete) {
      clearInterval(warningIntervalId);
      return;
    }

    const elapsed = Date.now() - hydrationPhaseStartTime;

    // Log warnings at each threshold
    for (const threshold of HYDRATION_WARNING_THRESHOLDS_MS) {
      if (elapsed >= threshold && !loggedWarnings.has(threshold)) {
        loggedWarnings.add(threshold);
        const remaining = HYDRATION_TIMEOUT_MS - elapsed;
        console.warn(
          '[Content] HYDRATION_PROGRESS_WARNING: Hydration taking longer than expected',
          {
            elapsedMs: elapsed,
            remainingMs: remaining,
            thresholdMs: threshold,
            totalTimeoutMs: HYDRATION_TIMEOUT_MS,
            queuedOperations: preHydrationOperationQueue.length,
            timestamp: Date.now()
          }
        );
      }
    }

    // Stop interval if we've passed all thresholds
    if (loggedWarnings.size >= HYDRATION_WARNING_THRESHOLDS_MS.length) {
      clearInterval(warningIntervalId);
    }
  }, 500); // Check every 500ms

  // v1.6.3.11-v2 - FIX Issue #7: Final timeout with forced completion
  setTimeout(() => {
    clearInterval(warningIntervalId); // Cleanup interval

    // v1.6.3.11 - FIX Issue #27: Don't force completion if drain is in progress
    if (isHydrationDrainInProgress) {
      console.log(
        '[Content] HYDRATION_TIMEOUT_DEFERRED: Drain in progress, skipping timeout action'
      );
      return;
    }

    if (!isHydrationComplete) {
      console.warn('[Content] HYDRATION_TIMEOUT: Forcing hydration complete after timeout', {
        timeoutMs: HYDRATION_TIMEOUT_MS,
        queuedOperations: preHydrationOperationQueue.length,
        note: 'Storage hydration did not complete in time - proceeding with incomplete state'
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
 * Handle successful tab ID response
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _attemptGetTabIdFromBackground complexity
 * @private
 */
function _handleTabIdSuccess(tabIdResult, attemptNumber, response, duration) {
  console.log('[Content][TabID][INIT] ATTEMPT_SUCCESS:', {
    attempt: attemptNumber,
    tabId: tabIdResult.tabId,
    responseFormat: tabIdResult.format,
    generation: response?.generation,
    durationMs: duration
  });
  return { tabId: tabIdResult.tabId, error: null, retryable: false };
}

/**
 * Handle failed tab ID response (retryable)
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _attemptGetTabIdFromBackground complexity
 * @private
 */
function _handleTabIdFailure(attemptNumber, response, duration) {
  const isRetryable = _isRetryableResponse(response);

  console.warn('[Content][TabID][INIT] ATTEMPT_FAILED:', {
    attempt: attemptNumber,
    response,
    error: response?.error,
    code: response?.code,
    generation: response?.generation,
    retryable: isRetryable,
    durationMs: duration
  });

  return {
    tabId: null,
    error: response?.error || 'Invalid response from background',
    retryable: isRetryable
  };
}

/**
 * Handle tab ID request error
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _attemptGetTabIdFromBackground complexity
 * @private
 */
function _handleTabIdError(err, attemptNumber, duration) {
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

/**
 * Single attempt to get tab ID from background
 * v1.6.3.10-v10 - FIX Issue #5: Extracted to support retry logic
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (cc=11→4)
 * @private
 * @param {number} attemptNumber - Current attempt number (1-based)
 * @returns {Promise<{tabId: number|null, error: string|null, retryable: boolean}>}
 */
async function _attemptGetTabIdFromBackground(attemptNumber) {
  const startTime = Date.now();

  try {
    const response = await browser.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' });
    const duration = Date.now() - startTime;

    if (response?.generation) {
      _updateBackgroundGenerationFromResponse(response.generation);
    }

    const tabIdResult = _extractTabIdFromResponse(response);
    if (tabIdResult.found) {
      return _handleTabIdSuccess(tabIdResult, attemptNumber, response, duration);
    }

    return _handleTabIdFailure(attemptNumber, response, duration);
  } catch (err) {
    return _handleTabIdError(err, attemptNumber, Date.now() - startTime);
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
 * Log timeout approaching warnings during extended Tab ID acquisition
 * v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Extracted to reduce _extendedTabIdRetryLoop depth
 * @private
 * @param {number} totalElapsed - Total elapsed time in ms
 * @param {Set<number>} loggedWarnings - Set of already logged thresholds
 * @param {number} extendedAttempt - Current attempt number
 */
function _logTabIdTimeoutWarnings(totalElapsed, loggedWarnings, extendedAttempt) {
  for (const threshold of TAB_ID_TIMEOUT_WARNING_THRESHOLDS) {
    if (totalElapsed >= threshold && !loggedWarnings.has(threshold)) {
      loggedWarnings.add(threshold);
      const remaining = TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS - totalElapsed;
      console.warn(
        '[Content][TabID][EXTENDED] TIMEOUT_APPROACHING: Tab ID acquisition taking longer than expected',
        {
          elapsedMs: totalElapsed,
          remainingMs: remaining,
          thresholdMs: threshold,
          totalTimeoutMs: TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS,
          attempt: extendedAttempt,
          timestamp: Date.now()
        }
      );
    }
  }
}

/**
 * Extended retry loop for tab ID acquisition after initial backoff exhaustion
 * v1.6.3.10-v11 - FIX Issue #1: Background initialization retry loop with 60s total timeout
 * v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Extended to 120s total timeout
 * @param {number} overallStartTime - Original start time
 * @param {Object} _lastResult - Last retry result (unused, kept for API compatibility)
 * @returns {Promise<number|null>} Tab ID or null
 * @private
 */
async function _extendedTabIdRetryLoop(overallStartTime, _lastResult) {
  let extendedAttempt = 0;

  console.log(
    '[Content][TabID][EXTENDED] STARTING: Extended retry loop for background initialization',
    {
      intervalMs: TAB_ID_EXTENDED_RETRY_INTERVAL_MS,
      maxAttempts: TAB_ID_EXTENDED_RETRY_MAX_ATTEMPTS,
      totalTimeoutMs: TAB_ID_EXTENDED_TOTAL_TIMEOUT_MS,
      elapsedSoFar: Date.now() - overallStartTime
    }
  );

  tabIdAcquisitionPending = true;

  // v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Track which warnings have been logged
  const loggedWarnings = new Set();

  while (extendedAttempt < TAB_ID_EXTENDED_RETRY_MAX_ATTEMPTS) {
    const totalElapsed = Date.now() - overallStartTime;

    // v1.6.3.11-v2 - FIX Issue #4 (Diagnostic Report): Log warnings as timeout approaches (extracted helper)
    _logTabIdTimeoutWarnings(totalElapsed, loggedWarnings, extendedAttempt);

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

    console.log(
      `[Content][TabID][EXTENDED] Retry #${extendedAttempt} with delay ${TAB_ID_EXTENDED_RETRY_INTERVAL_MS}ms, elapsed ${totalElapsed}ms`
    );

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
  console.error(
    `[Content][TabID][EXTENDED] Tab ID acquisition exhausted all ${TAB_ID_MAX_RETRIES + 1 + extendedAttempt} retries after ${Date.now() - overallStartTime}ms, final result: null`
  );

  return null;
}

/**
 * Handle special NOT_INITIALIZED error case
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce getCurrentTabIdFromBackground complexity
 * @private
 * @param {number} overallStartTime - Start timestamp of acquisition
 * @returns {Promise<{tabId: number|null, result: Object, goToExtended: boolean}>}
 */
async function _handleNotInitializedError(overallStartTime) {
  console.log('[Content][TabID][INIT] Background initializing, waiting for initialization', {
    delayMs: TAB_ID_NOT_INITIALIZED_DELAY_MS,
    timestamp: Date.now()
  });

  await new Promise(resolve => setTimeout(resolve, TAB_ID_NOT_INITIALIZED_DELAY_MS));

  const notInitRetryAttemptNum = 2;
  const notInitRetry = await _attemptGetTabIdFromBackground(notInitRetryAttemptNum);

  if (notInitRetry.tabId !== null) {
    console.log('[Content][TabID][INIT] COMPLETE: Tab ID acquired after NOT_INITIALIZED wait', {
      tabId: notInitRetry.tabId,
      totalDurationMs: Date.now() - overallStartTime
    });
    return { tabId: notInitRetry.tabId, result: notInitRetry, goToExtended: false };
  }

  if (notInitRetry.error === 'NOT_INITIALIZED') {
    console.log(
      '[Content][TabID][INIT] Still NOT_INITIALIZED after single retry, entering extended retry loop'
    );
    return { tabId: null, result: notInitRetry, goToExtended: true };
  }

  return { tabId: null, result: notInitRetry, goToExtended: false };
}

/**
 * Execute exponential backoff retry loop for tab ID acquisition
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce getCurrentTabIdFromBackground complexity
 * @private
 * @param {number} overallStartTime - Start timestamp of acquisition
 * @param {Object} result - Last attempt result
 * @returns {Promise<{tabId: number|null, result: Object}>}
 */
async function _executeExponentialBackoffRetries(overallStartTime, result) {
  let currentResult = result;

  for (let retryIndex = 0; retryIndex < TAB_ID_MAX_RETRIES; retryIndex++) {
    const attemptNumber = retryIndex + 2;
    const delayMs = TAB_ID_RETRY_DELAYS_MS[retryIndex];

    if (!currentResult.retryable) {
      console.warn('[Content][TabID][INIT] ABORT: Error is not retryable', {
        lastError: currentResult.error,
        attemptsTried: attemptNumber - 1,
        totalDurationMs: Date.now() - overallStartTime
      });
      return { tabId: null, result: currentResult };
    }

    console.log(
      `[Content][TabID][INIT] Retry #${retryIndex + 1} with delay ${delayMs}ms, elapsed ${Date.now() - overallStartTime}ms`
    );

    await new Promise(resolve => setTimeout(resolve, delayMs));
    currentResult = await _attemptGetTabIdFromBackground(attemptNumber);

    if (currentResult.tabId !== null) {
      console.log('[Content][TabID][INIT] COMPLETE: Tab ID acquired on retry', {
        tabId: currentResult.tabId,
        attemptNumber,
        totalDurationMs: Date.now() - overallStartTime
      });
      return { tabId: currentResult.tabId, result: currentResult };
    }
  }

  return { tabId: null, result: currentResult };
}

/**
 * Get current tab ID from background script with exponential backoff retry
 * v1.6.3.5-v10 - FIX Issue #3: Content scripts cannot use browser.tabs.getCurrent()
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (81→40 lines)
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
  let result = await _attemptGetTabIdFromBackground(1);

  if (result.tabId !== null) {
    console.log('[Content][TabID][INIT] COMPLETE: Tab ID acquired on first attempt', {
      tabId: result.tabId,
      totalDurationMs: Date.now() - overallStartTime
    });
    return result.tabId;
  }

  // Handle NOT_INITIALIZED specially
  if (result.error === 'NOT_INITIALIZED') {
    const notInitResult = await _handleNotInitializedError(overallStartTime);
    if (notInitResult.tabId !== null) return notInitResult.tabId;
    if (notInitResult.goToExtended) {
      return _extendedTabIdRetryLoop(overallStartTime, notInitResult.result);
    }
    result = notInitResult.result;
  }

  // Exponential backoff retry loop
  const backoffResult = await _executeExponentialBackoffRetries(overallStartTime, result);
  if (backoffResult.tabId !== null) return backoffResult.tabId;
  result = backoffResult.result;

  // Initial retries exhausted
  const initialPhaseDuration = Date.now() - overallStartTime;
  console.error(
    `[Content][TabID][INIT] Tab ID acquisition exhausted all ${TAB_ID_MAX_RETRIES + 1} retries after ${initialPhaseDuration}ms, final result: null`
  );

  if (result.retryable) {
    console.log(
      '[Content][TabID][INIT] ENTERING_EXTENDED_RETRY: Background may still be initializing',
      { lastError: result.error, initialPhaseDurationMs: initialPhaseDuration }
    );
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
  READY: 'READY', // v1.6.3.10-v11 - FIX Issue #24: Handshake complete
  RECONNECTING: 'RECONNECTING', // v1.6.3.10-v12 - FIX Issue #11: Backoff retry state
  FAILED: 'FAILED'
};

// v1.6.3.10-v12 - FIX Issue #1: Track if port disconnected during setup
let portDisconnectedDuringSetup = false;

// v1.6.3.10-v12 - FIX Issue #1: Track if port listener registration is complete
let portListenersRegistered = false;

// v1.6.3.10-v12 - FIX Issue #2: Track if port is potentially invalid due to BFCache
let portPotentiallyInvalidDueToBFCache = false;

/**
 * Check if port is in recovery state (reconnecting or backoff)
 * v1.6.3.10-v12 - FIX Issue #11: Distinguish retry from permanent failure
 * @returns {boolean} True if port is in recovery state
 */
function isPortInRecovery() {
  return portConnectionState === PORT_CONNECTION_STATE.RECONNECTING;
}

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
 * v1.6.3.11 - FIX Issue #30: Reduced to 500ms per phase to align with reconnection backoff
 *   - Reconnection backoff starts at 150ms, multiplies by 1.5x
 *   - 3 phases × 500ms = 1500ms total (vs 6000ms before)
 *   - Ensures predictable recovery timing
 * v1.6.3.11-v3 - FIX Issue #49: Now serves as default; actual timeout is adaptive
 */
const DEFAULT_HANDSHAKE_PHASE_TIMEOUT_MS = 1000;

/**
 * Minimum handshake phase timeout (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #49: Floor for adaptive timeout
 */
const MIN_HANDSHAKE_PHASE_TIMEOUT_MS = 1000;

/**
 * Maximum handshake phase timeout (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #49: Ceiling for adaptive timeout
 */
const MAX_HANDSHAKE_PHASE_TIMEOUT_MS = 5000;

/**
 * Multiplier for adaptive handshake timeout
 * v1.6.3.11-v3 - FIX Issue #49: timeout = baseline * multiplier
 */
const HANDSHAKE_TIMEOUT_MULTIPLIER = 3;

/**
 * Measured baseline handshake latency from first successful connection
 * v1.6.3.11-v3 - FIX Issue #49: Used for adaptive timeout calculation
 */
let measuredHandshakeBaselineMs = null;

/**
 * Record handshake latency for adaptive timeout
 * v1.6.3.11-v3 - FIX Issue #49
 * @param {number} latencyMs - Handshake latency in milliseconds
 */
function _recordHandshakeLatency(latencyMs) {
  if (typeof latencyMs !== 'number' || latencyMs <= 0) return;

  if (measuredHandshakeBaselineMs === null) {
    measuredHandshakeBaselineMs = latencyMs;
    console.log('[Content][HANDSHAKE] BASELINE_RECORDED:', {
      baselineMs: latencyMs,
      timestamp: Date.now()
    });
  } else {
    // Update with exponential moving average (α = 0.3)
    measuredHandshakeBaselineMs = Math.round(0.3 * latencyMs + 0.7 * measuredHandshakeBaselineMs);
  }
}

/**
 * Get adaptive handshake phase timeout based on measured baseline
 * v1.6.3.11-v3 - FIX Issue #49: timeout = max(MIN, baseline * multiplier)
 * @returns {number} Timeout in milliseconds
 */
function _getAdaptiveHandshakeTimeout() {
  if (measuredHandshakeBaselineMs === null) {
    // No baseline yet - use default
    return DEFAULT_HANDSHAKE_PHASE_TIMEOUT_MS;
  }

  const adaptiveTimeout = Math.round(measuredHandshakeBaselineMs * HANDSHAKE_TIMEOUT_MULTIPLIER);

  return Math.max(
    MIN_HANDSHAKE_PHASE_TIMEOUT_MS,
    Math.min(adaptiveTimeout, MAX_HANDSHAKE_PHASE_TIMEOUT_MS)
  );
}

// Backward compatibility: keep HANDSHAKE_PHASE_TIMEOUT_MS as getter
const HANDSHAKE_PHASE_TIMEOUT_MS = DEFAULT_HANDSHAKE_PHASE_TIMEOUT_MS;

// ==================== v1.6.3.11-v3 FIX ISSUE #51: BFCACHE MESSAGE QUEUE ====================
// Queue messages when page is frozen in BFCache and drain on restoration

/**
 * Whether port is frozen due to BFCache (messages should be queued)
 * v1.6.3.11-v3 - FIX Issue #51
 */
let _isPortFrozenDueToBFCache = false;

/**
 * Message queue for messages that arrived while page was in BFCache
 * v1.6.3.11-v3 - FIX Issue #51
 */
const _bfcacheMessageQueue = [];

/**
 * Maximum BFCache message queue size
 * v1.6.3.11-v3 - FIX Issue #51
 */
const MAX_BFCACHE_MESSAGE_QUEUE_SIZE = 50;

// ==================== v1.6.3.12 FIX ISSUE #9: MESSAGE ORDERING BUFFER ====================
// Buffer out-of-order messages by sequence number and process in order

/**
 * Highest processed operation sequence number
 * v1.6.3.12 - FIX Issue #9: Track which messages have been processed
 */
let _highestProcessedSequence = 0;

/**
 * Buffer for out-of-order messages awaiting processing
 * v1.6.3.12 - FIX Issue #9: Map of operationSequence -> message
 */
const _messageOrderingBuffer = new Map();

/**
 * Maximum size of message ordering buffer
 * v1.6.3.12 - FIX Issue #9: Prevent unbounded growth
 */
const MAX_MESSAGE_ORDERING_BUFFER_SIZE = 100;

/**
 * Timeout for buffered messages (milliseconds)
 * v1.6.3.12 - FIX Issue #9: Discard stale buffered messages
 */
const MESSAGE_ORDERING_BUFFER_TIMEOUT_MS = 10000;

/**
 * Check if message should be processed based on sequence ordering
 * v1.6.3.12 - FIX Issue #9: Validate message ordering
 * @param {number} operationSequence - Message sequence number
 * @returns {{ shouldProcess: boolean, reason: string }}
 */
function _shouldProcessMessageBySequence(operationSequence) {
  // No sequence - process immediately (legacy message)
  if (operationSequence === undefined || operationSequence === null) {
    return { shouldProcess: true, reason: 'no-sequence' };
  }
  
  // Already processed a higher sequence - discard
  if (operationSequence <= _highestProcessedSequence) {
    console.log('[Content] MESSAGE_SEQUENCE_CHECK:', {
      action: 'discarded',
      reason: 'already-processed-newer',
      incomingSequence: operationSequence,
      highestProcessed: _highestProcessedSequence,
      timestamp: Date.now()
    });
    return { shouldProcess: false, reason: 'already-processed-newer' };
  }
  
  // Next expected sequence - process now
  if (operationSequence === _highestProcessedSequence + 1) {
    return { shouldProcess: true, reason: 'in-order' };
  }
  
  // Out of order - buffer for later
  console.log('[Content] MESSAGE_SEQUENCE_CHECK:', {
    action: 'buffering',
    reason: 'out-of-order',
    incomingSequence: operationSequence,
    expectedSequence: _highestProcessedSequence + 1,
    timestamp: Date.now()
  });
  return { shouldProcess: false, reason: 'out-of-order' };
}

/**
 * Buffer a message for later processing
 * v1.6.3.12 - FIX Issue #9: Store out-of-order messages
 * @param {number} operationSequence - Message sequence number
 * @param {Object} message - Message to buffer
 */
function _bufferMessageForOrdering(operationSequence, message) {
  // Prevent unbounded growth
  if (_messageOrderingBuffer.size >= MAX_MESSAGE_ORDERING_BUFFER_SIZE) {
    // Remove oldest entry
    const oldestKey = Math.min(..._messageOrderingBuffer.keys());
    _messageOrderingBuffer.delete(oldestKey);
    console.warn('[Content] MESSAGE_BUFFERED:', {
      action: 'evicted-oldest',
      evictedSequence: oldestKey,
      bufferSize: _messageOrderingBuffer.size,
      timestamp: Date.now()
    });
  }
  
  _messageOrderingBuffer.set(operationSequence, {
    message,
    bufferedAt: Date.now()
  });
  
  console.log('[Content] MESSAGE_BUFFERED:', {
    operationSequence,
    messageType: message.type || message.action,
    bufferSize: _messageOrderingBuffer.size,
    timestamp: Date.now()
  });
}

/**
 * Process buffered messages in order
 * v1.6.3.12 - FIX Issue #9: Drain buffer after processing a message
 * @param {Function} processMessage - Function to process each message
 */
async function _processBufferedMessages(processMessage) {
  const now = Date.now();
  
  // Clean up stale buffered messages
  for (const [seq, entry] of _messageOrderingBuffer.entries()) {
    if (now - entry.bufferedAt > MESSAGE_ORDERING_BUFFER_TIMEOUT_MS) {
      _messageOrderingBuffer.delete(seq);
      console.warn('[Content] MESSAGE_BUFFERED:', {
        action: 'expired',
        operationSequence: seq,
        ageMs: now - entry.bufferedAt,
        timestamp: now
      });
    }
  }
  
  // Process buffered messages in order
  let processed = 0;
  while (_messageOrderingBuffer.has(_highestProcessedSequence + 1)) {
    const nextSeq = _highestProcessedSequence + 1;
    const entry = _messageOrderingBuffer.get(nextSeq);
    _messageOrderingBuffer.delete(nextSeq);
    
    console.log('[Content] MESSAGE_SEQUENCE_CHECK:', {
      action: 'processing-buffered',
      operationSequence: nextSeq,
      bufferedForMs: now - entry.bufferedAt,
      timestamp: now
    });
    
    await processMessage(entry.message);
    _highestProcessedSequence = nextSeq;
    processed++;
  }
  
  if (processed > 0) {
    console.log('[Content] MESSAGE_BUFFERED:', {
      action: 'drain-complete',
      processedCount: processed,
      remainingBuffered: _messageOrderingBuffer.size,
      highestProcessed: _highestProcessedSequence,
      timestamp: now
    });
  }
}

/**
 * Update highest processed sequence and process buffer
 * v1.6.3.12 - FIX Issue #9: Called after successfully processing a message
 * @param {number} operationSequence - Processed sequence number
 * @param {Function} processMessage - Function to process buffered messages
 */
async function _markSequenceProcessed(operationSequence, processMessage) {
  if (operationSequence !== undefined && operationSequence !== null) {
    _highestProcessedSequence = operationSequence;
    
    // Process any buffered messages that are now in order
    await _processBufferedMessages(processMessage);
  }
}

// ==================== END ISSUE #9 FIX ====================

// ==================== v1.6.3.12 FIX ISSUE #14: PORT READINESS FLAG ====================
// Synchronous flag to track port readiness for BFCache restoration

/**
 * Flag indicating port is ready for messages
 * v1.6.3.12 - FIX Issue #14: Set to false on pagehide, true after port connection completes
 */
let _isPortReadyForMessagesFlag = true;

/**
 * Message queue for messages that arrived before port was ready
 * v1.6.3.12 - FIX Issue #14: Buffer messages during port reconnection
 */
const _portReadinessMessageQueue = [];

/**
 * Maximum port readiness queue size
 * v1.6.3.12 - FIX Issue #14
 */
const MAX_PORT_READINESS_QUEUE_SIZE = 50;

/**
 * Check if port is ready for sending messages
 * v1.6.3.12 - FIX Issue #14: Synchronous check before port usage
 * @returns {boolean} True if port is ready
 */
function _isPortReadyForMessages() {
  return _isPortReadyForMessagesFlag && !_isPortFrozenDueToBFCache;
}

/**
 * Mark port as not ready (entering BFCache or disconnected)
 * v1.6.3.12 - FIX Issue #14
 */
function markPortNotReady() {
  const wasReady = _isPortReadyForMessagesFlag;
  _isPortReadyForMessagesFlag = false;
  
  if (wasReady) {
    console.log('[Content] BFCACHE_PORT_STATE:', {
      state: 'not-ready',
      previousState: 'ready',
      timestamp: Date.now()
    });
  }
}

/**
 * Mark port as ready (connection complete after BFCache restore)
 * v1.6.3.12 - FIX Issue #14
 */
function markPortReady() {
  const wasReady = _isPortReadyForMessagesFlag;
  _isPortReadyForMessagesFlag = true;
  
  console.log('[Content] BFCACHE_PORT_STATE:', {
    state: 'ready',
    previousState: wasReady ? 'ready' : 'not-ready',
    queuedMessages: _portReadinessMessageQueue.length,
    timestamp: Date.now()
  });
  
  // Drain queued messages
  _drainPortReadinessQueue();
}

/**
 * Queue a message for sending after port becomes ready
 * v1.6.3.12 - FIX Issue #14
 * @param {Object} message - Message to queue
 * @returns {boolean} True if queued
 */
function _queueMessageUntilPortReady(message) {
  if (_portReadinessMessageQueue.length >= MAX_PORT_READINESS_QUEUE_SIZE) {
    console.warn('[Content] BFCACHE_PORT_STATE:', {
      action: 'queue-full',
      queueSize: _portReadinessMessageQueue.length,
      messageType: message?.type || message?.action,
      timestamp: Date.now()
    });
    return false;
  }
  
  _portReadinessMessageQueue.push({
    message,
    queuedAt: Date.now()
  });
  
  console.log('[Content] BFCACHE_PORT_STATE:', {
    action: 'message-queued',
    queueSize: _portReadinessMessageQueue.length,
    messageType: message?.type || message?.action,
    timestamp: Date.now()
  });
  
  return true;
}

/**
 * Send a single queued port readiness message
 * v1.6.3.12 - FIX Code Health: Extracted to reduce nesting depth
 * @private
 */
async function _sendQueuedPortReadinessMessage(message) {
  if (backgroundPort) {
    backgroundPort.postMessage(message);
    return;
  }
  await browser.runtime.sendMessage(message);
}

/**
 * Drain port readiness queue after port becomes ready
 * v1.6.3.12 - FIX Issue #14
 * @private
 */
async function _drainPortReadinessQueue() {
  if (_portReadinessMessageQueue.length === 0) return;
  
  console.log('[Content] BFCACHE_PORT_STATE:', {
    action: 'draining-queue',
    queueSize: _portReadinessMessageQueue.length,
    timestamp: Date.now()
  });
  
  while (_portReadinessMessageQueue.length > 0) {
    const entry = _portReadinessMessageQueue.shift();
    const { message, queuedAt } = entry;
    const queueDuration = Date.now() - queuedAt;
    
    try {
      await _sendQueuedPortReadinessMessage(message);
      
      console.log('[Content] BFCACHE_PORT_STATE:', {
        action: 'queued-message-sent',
        messageType: message?.type || message?.action,
        queueDurationMs: queueDuration,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('[Content] BFCACHE_PORT_STATE:', {
        action: 'queued-message-failed',
        messageType: message?.type || message?.action,
        error: err.message,
        timestamp: Date.now()
      });
    }
  }
}

// ==================== END ISSUE #14 FIX ====================

/**
 * Queue a message for retry after BFCache restoration
 * v1.6.3.11-v3 - FIX Issue #51
 * @param {Object} message - Message to queue
 * @returns {boolean} True if queued, false if queue full
 */
function _queueMessageForBFCacheRetry(message) {
  if (_bfcacheMessageQueue.length >= MAX_BFCACHE_MESSAGE_QUEUE_SIZE) {
    console.warn('[Content][BFCACHE] MESSAGE_QUEUE_FULL: Dropping message', {
      queueSize: _bfcacheMessageQueue.length,
      messageType: message?.type || message?.action
    });
    return false;
  }

  _bfcacheMessageQueue.push({
    message,
    queuedAt: Date.now()
  });

  console.log('[Content][BFCACHE] MESSAGE_QUEUED: Will retry after restoration', {
    queueSize: _bfcacheMessageQueue.length,
    messageType: message?.type || message?.action
  });

  return true;
}

/**
 * Send a single queued message
 * v1.6.3.11-v3 - Helper to reduce nesting depth
 * @private
 */
async function _sendQueuedMessage(message) {
  if (backgroundPort) {
    backgroundPort.postMessage(message);
  } else {
    await browser.runtime.sendMessage(message);
  }
}

/**
 * Process a single BFCache queued message
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _drainBFCacheMessageQueue complexity
 * @private
 * @param {Object} entry - Queue entry with message and queuedAt
 */
async function _processBFCacheQueueEntry(entry) {
  const { message, queuedAt } = entry;
  const queueDuration = Date.now() - queuedAt;

  try {
    await _sendQueuedMessage(message);
    console.log('[Content][BFCACHE] QUEUED_MESSAGE_SENT:', {
      messageType: message?.type || message?.action,
      queueDurationMs: queueDuration
    });
  } catch (err) {
    console.error('[Content][BFCACHE] QUEUED_MESSAGE_FAILED:', {
      messageType: message?.type || message?.action,
      error: err.message,
      queueDurationMs: queueDuration
    });
  }
}

/**
 * Drain BFCache message queue after restoration
 * v1.6.3.11-v3 - FIX Issue #51
 * v1.6.3.11-v4 - FIX Code Health: Extracted helper to reduce complexity (cc=10→4)
 */
async function _drainBFCacheMessageQueue() {
  if (_bfcacheMessageQueue.length === 0) return;

  console.log('[Content][BFCACHE] DRAINING_MESSAGE_QUEUE:', {
    queueSize: _bfcacheMessageQueue.length,
    timestamp: Date.now()
  });

  while (_bfcacheMessageQueue.length > 0) {
    const entry = _bfcacheMessageQueue.shift();
    await _processBFCacheQueueEntry(entry);
  }
}

/**
 * Handle successful state refresh response
 * v1.6.3.11-v3 - Helper to reduce nesting depth
 * @private
 */
async function _handleStateRefreshResponse(response) {
  if (!response?.success || !response?.data) return;

  console.log('[Content][BFCACHE] STATE_REFRESH_RECEIVED:', {
    tabCount: response.data.tabs?.length ?? 0,
    lastUpdate: response.data.lastUpdate
  });

  // Trigger hydration with fresh state if Quick Tabs manager exists
  if (quickTabsManager?.hydrateFromStorage) {
    await quickTabsManager.hydrateFromStorage();
  }
}

/**
 * Request state refresh from backend after BFCache restoration
 * v1.6.3.11-v3 - FIX Issue #52: Query backend for current state instead of relying on stale events
 */
async function _requestStateRefreshAfterBFCache() {
  try {
    console.log('[Content][BFCACHE] REQUESTING_STATE_REFRESH: Querying backend for current state');

    const response = await sendMessageWithTimeout(
      {
        action: 'GET_QUICK_TABS_STATE',
        reason: 'bfcache-restore',
        timestamp: Date.now()
      },
      { timeout: 5000 }
    );

    await _handleStateRefreshResponse(response);
  } catch (err) {
    console.warn('[Content][BFCACHE] STATE_REFRESH_FAILED:', {
      error: err.message,
      isTimeout: err.isTimeout
    });
  }
}

/**
 * Check if port is frozen (in BFCache) and message should be queued
 * v1.6.3.11-v3 - FIX Issue #51
 * @returns {boolean} True if port is frozen
 */
function _isPortFrozen() {
  return _isPortFrozenDueToBFCache;
}

// ==================== END ISSUE #51 FIX ====================

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
    console.log(
      '[Content] v1.6.3.10-v7 Reconnection successful, resetting attempt count from:',
      reconnectionAttempts
    );
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

  // Set timeout for Phase 1 (v1.6.3.11 - FIX Issue #9: 2-3s timeout on INIT_RESPONSE wait)
  _setHandshakeTimeout('INIT_REQUEST', () => {
    // v1.6.3.11 - FIX Issue #9: Combined timeout warning with fallback info
    console.warn('[Content] ⚠️ INIT_RESPONSE timeout, falling back to retry loop', {
      phase: 'Phase 1 timeout',
      timeoutMs: HANDSHAKE_PHASE_TIMEOUT_MS,
      recoveryAction: 'exponential-backoff-reconnection'
    });
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
 * v1.6.3.11-v3 - FIX Issue #33: Start periodic maintenance on handshake complete
 */
function _completeHandshake() {
  _clearHandshakeTimeout();
  currentHandshakePhase = HANDSHAKE_PHASE.NONE;

  _transitionPortState(PORT_CONNECTION_STATE.READY, 'handshake-complete');

  // v1.6.3.11-v3 - FIX Issue #33: Start periodic maintenance (heartbeat + GC) on successful connection
  _startPeriodicMaintenance();

  console.log('[Content][HANDSHAKE] COMPLETE: Connection ready', {
    portState: portConnectionState,
    timestamp: Date.now()
  });
}

/**
 * Handle handshake failure
 * v1.6.3.10-v11 - FIX Issue #24
 * v1.6.3.10-v13 - FIX Issue #24: Enhanced logging with "Port connection phase X"
 * @param {string} reason - Failure reason
 */
function _handleHandshakeFailure(reason) {
  _clearHandshakeTimeout();

  // v1.6.3.10-v13 - FIX Issue #24: Log which phase failed
  const failedPhase = currentHandshakePhase;
  currentHandshakePhase = HANDSHAKE_PHASE.NONE;

  console.error('[Content][HANDSHAKE] FAILED:', {
    reason,
    failedPhase,
    willRetry: reconnectionAttempts < CIRCUIT_BREAKER_MAX_FAILURES,
    attempts: reconnectionAttempts,
    recoveryStrategy: 'exponential-backoff'
  });

  // v1.6.3.10-v13 - FIX Issue #24: Log disconnect recovery plan
  const backoffDelays = [100, 200, 400]; // Base delays for documentation
  const nextDelay = backoffDelays[Math.min(reconnectionAttempts, backoffDelays.length - 1)] || 400;
  console.log('[Content][HANDSHAKE] Port connection phase failed:', {
    phaseDescription: _getHandshakePhaseDescription(failedPhase),
    nextRetryDelayMs: nextDelay,
    maxAttempts: CIRCUIT_BREAKER_MAX_FAILURES
  });

  // Increment failure count and try reconnection
  if (cachedTabId) {
    _handleReconnection(cachedTabId, `handshake-${reason}`);
  }
}

/**
 * Get human-readable description for handshake phase
 * v1.6.3.10-v13 - FIX Issue #24: Helper for clearer logging
 * @param {string} phase - Handshake phase enum value
 * @returns {string} Human-readable description
 */
function _getHandshakePhaseDescription(phase) {
  const descriptions = {
    [HANDSHAKE_PHASE.NONE]: 'Not started',
    [HANDSHAKE_PHASE.INIT_REQUEST_SENT]: 'Phase 1: Waiting for INIT_RESPONSE',
    [HANDSHAKE_PHASE.INIT_RESPONSE_RECEIVED]: 'Phase 2: Processing INIT_RESPONSE',
    [HANDSHAKE_PHASE.INIT_COMPLETE_SENT]: 'Phase 3: Waiting for acknowledgment'
  };
  return descriptions[phase] || `Unknown phase: ${phase}`;
}

/**
 * Set handshake phase timeout
 * v1.6.3.10-v11 - FIX Issue #24
 * v1.6.3.11-v3 - FIX Issue #49: Use adaptive timeout based on measured baseline
 * @param {string} phase - Current phase name
 * @param {Function} callback - Callback on timeout
 */
function _setHandshakeTimeout(phase, callback) {
  _clearHandshakeTimeout();

  // v1.6.3.11-v3 - FIX Issue #49: Use adaptive timeout
  const timeoutMs = _getAdaptiveHandshakeTimeout();

  handshakeTimeoutId = setTimeout(() => {
    handshakeTimeoutId = null;
    callback();
  }, timeoutMs);

  console.log('[Content][HANDSHAKE] Timeout set for phase:', {
    phase,
    timeoutMs,
    isAdaptive: measuredHandshakeBaselineMs !== null,
    baselineMs: measuredHandshakeBaselineMs
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
// v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Queue instead of reject out-of-order messages

/**
 * Track in-progress RESTORE operations to enforce ordering
 * v1.6.3.10-v10 - FIX Issue R: Map of quickTabId -> { sequenceId, timestamp, status }
 */
const pendingRestoreOperations = new Map();

/**
 * Queue for out-of-order RESTORE operations that should be processed later
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Queue instead of reject
 * Structure: { quickTabId, sequenceId, callback, queuedAt }
 */
const restoreOperationQueue = [];

/**
 * Maximum queue size for RESTORE operations
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Prevent memory growth
 */
const MAX_RESTORE_QUEUE_SIZE = 50;

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
 * Check if incoming restore should be queued due to sequence ordering
 * v1.6.3.10-v10 - FIX Issue R: Extracted to reduce _checkRestoreOrderingEnforcement complexity
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Changed from reject to queue
 * @private
 */
function _shouldQueueRestoreOrder(existingOp, messageSequenceId, details) {
  if (!existingOp || existingOp.status !== 'pending') return false;
  if (messageSequenceId === undefined || existingOp.sequenceId === undefined) return false;

  if (messageSequenceId < existingOp.sequenceId) {
    console.log('[Content] v1.6.3.11-v2 RESTORE_ORDER_QUEUED:', {
      ...details,
      reason: 'out-of-order: newer operation already pending',
      action: 'queued-for-later'
    });
    return true;
  }
  return false;
}

/**
 * Queue a RESTORE operation for later processing
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Queue instead of reject
 * @private
 */
function _queueRestoreOperation(quickTabId, sequenceId, callback) {
  // Check queue size limit
  if (restoreOperationQueue.length >= MAX_RESTORE_QUEUE_SIZE) {
    const dropped = restoreOperationQueue.shift();
    console.warn('[Content] RESTORE_QUEUE_OVERFLOW: Dropped oldest operation', {
      droppedQuickTabId: dropped?.quickTabId,
      droppedSequenceId: dropped?.sequenceId,
      queueSizeBeforeDrop: MAX_RESTORE_QUEUE_SIZE,
      queueSizeAfterDrop: restoreOperationQueue.length // Will be MAX_RESTORE_QUEUE_SIZE - 1
    });
  }

  restoreOperationQueue.push({
    quickTabId,
    sequenceId,
    callback,
    queuedAt: Date.now()
  });

  console.log('[Content] RESTORE_QUEUED: Operation queued for sequence order', {
    quickTabId,
    sequenceId,
    queueSize: restoreOperationQueue.length
  });
}

/**
 * Determine if an operation can be processed based on pending state
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processRestoreQueue complexity
 * @private
 * @param {Object} op - The restore operation
 * @param {Object|undefined} existingOp - Existing pending operation for the same quickTabId
 * @returns {boolean} True if operation can be processed now
 */
function _canProcessRestoreOperation(op, existingOp) {
  // Can process if no pending operation or pending operation is complete
  if (!existingOp || existingOp.status !== 'pending') {
    return true;
  }
  // Can process if our sequence >= pending sequence
  return op.sequenceId >= existingOp.sequenceId;
}

/**
 * Partition queue into processable and remaining operations
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processRestoreQueue complexity
 * @private
 * @returns {{toProcess: Object[], remaining: Object[]}}
 */
function _partitionRestoreQueue() {
  const toProcess = [];
  const remaining = [];

  for (const op of restoreOperationQueue) {
    const existingOp = pendingRestoreOperations.get(op.quickTabId);
    if (_canProcessRestoreOperation(op, existingOp)) {
      toProcess.push(op);
    } else {
      remaining.push(op);
    }
  }

  return { toProcess, remaining };
}

/**
 * Execute a single restore operation callback
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processRestoreQueue complexity
 * @private
 * @param {Object} op - The restore operation
 */
async function _executeRestoreOperation(op) {
  console.log('[Content] RESTORE_QUEUE_PROCESSING: Processing queued operation', {
    quickTabId: op.quickTabId,
    sequenceId: op.sequenceId,
    waitedMs: Date.now() - op.queuedAt
  });

  try {
    if (typeof op.callback === 'function') {
      await op.callback();
    }
  } catch (err) {
    console.error('[Content] RESTORE_QUEUE_ERROR: Queued operation failed (will not retry)', {
      quickTabId: op.quickTabId,
      error: err.message,
      note: 'storage.onChanged will trigger fresh RESTORE if state is still out of sync'
    });
  }
}

/**
 * Process queued RESTORE operations in sequence order
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Process queue after pending completes
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (cc=9→4)
 * @private
 */
async function _processRestoreQueue() {
  if (restoreOperationQueue.length === 0) return;

  // Sort by sequence ID to process in order
  restoreOperationQueue.sort((a, b) => a.sequenceId - b.sequenceId);

  // Partition operations
  const { toProcess, remaining } = _partitionRestoreQueue();

  // Update queue with remaining operations
  restoreOperationQueue.length = 0;
  restoreOperationQueue.push(...remaining);

  // Execute processable operations
  for (const op of toProcess) {
    await _executeRestoreOperation(op);
  }
}

/**
 * Check if a RESTORE operation should proceed, be queued, or be processed
 * v1.6.3.10-v10 - FIX Issue R: Enforce ordering for storage-dependent RESTORE operations
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Queue instead of reject out-of-order messages
 *
 * Out-of-order RESTORE messages are now queued and processed in sequence order
 * to prevent ownership lookups from resolving incorrectly during rapid tab switching.
 *
 * @param {string} quickTabId - Quick Tab ID being restored
 * @param {number|undefined} messageSequenceId - Sequence ID from message (if present)
 * @param {Function} [callback] - Optional callback to execute if queued
 * @returns {{allowed: boolean, reason: string|null, details: Object, queued: boolean}}
 */
function _checkRestoreOrderingEnforcement(quickTabId, messageSequenceId, callback) {
  const now = Date.now();
  _cleanupStaleRestoreEntries(now);

  const existingOperation = pendingRestoreOperations.get(quickTabId);
  const effectiveSequence = messageSequenceId ?? ++restoreSequenceCounter;

  const details = {
    quickTabId,
    messageSequenceId,
    effectiveSequence,
    existingOperation: existingOperation
      ? {
          sequenceId: existingOperation.sequenceId,
          status: existingOperation.status,
          age: now - existingOperation.timestamp
        }
      : null,
    pendingCount: pendingRestoreOperations.size
  };

  // v1.6.3.11-v2 - FIX Issue #5: Check if should queue due to ordering
  if (_shouldQueueRestoreOrder(existingOperation, messageSequenceId, details)) {
    // Queue the operation instead of rejecting
    if (callback) {
      _queueRestoreOperation(quickTabId, effectiveSequence, callback);
    }
    return { allowed: false, reason: 'queued', details, queued: true };
  }

  // Log if queued behind pending operation
  if (existingOperation && existingOperation.status === 'pending') {
    console.log('[Content] v1.6.3.10-v10 RESTORE_ORDER_PENDING:', {
      ...details,
      reason: 'existing operation pending',
      action: 'will proceed after existing completes'
    });
  }

  // Track this operation
  pendingRestoreOperations.set(quickTabId, {
    sequenceId: effectiveSequence,
    timestamp: now,
    status: 'pending'
  });

  console.log('[Content] v1.6.3.10-v10 RESTORE_ORDER_ALLOWED:', details);
  return { allowed: true, reason: null, details };
}

/**
 * Mark a RESTORE operation as complete
 * v1.6.3.10-v10 - FIX Issue R: Update tracking after operation completes
 * v1.6.3.11-v2 - FIX Issue #5 (Diagnostic Report): Process queued operations after completion
 * @param {string} quickTabId - Quick Tab ID that was restored
 * @param {boolean} success - Whether operation succeeded
 */
function _markRestoreComplete(quickTabId, success) {
  const operation = pendingRestoreOperations.get(quickTabId);
  if (operation) {
    operation.status = success ? 'completed' : 'failed';
    console.log('[Content] v1.6.3.10-v10 RESTORE_COMPLETE:', {
      quickTabId,
      success,
      sequenceId: operation.sequenceId,
      duration: Date.now() - operation.timestamp
    });

    // v1.6.3.11-v2 - FIX Issue #5: Process any queued operations waiting for this to complete
    _processRestoreQueue();
  }
}

/**
 * Queue a message when port is unavailable
 * v1.6.3.10-v7 - FIX Issue #5: Message queueing
 * v1.6.3.11 - FIX Issue #26: Add global backpressure check
 * @param {Object} message - Message to queue
 * @returns {number} Message ID for tracking
 */
function _queueMessage(message) {
  // v1.6.3.11 - FIX Issue #26: Check global backpressure across all queues
  _checkGlobalBackpressure();

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
 * v1.6.3.11 - FIX Issue #26: Add global backpressure check
 * @param {Object} command - Command to buffer
 */
function _bufferCommand(command) {
  // v1.6.3.11 - FIX Issue #26: Check global backpressure across all queues
  _checkGlobalBackpressure();

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
        type: command.type,
        bufferedDuration: Date.now() - command.bufferedAt
      });
    } catch (err) {
      console.error('[Content] BUFFERED_COMMAND_FAILED:', {
        type: command.type,
        error: err.message
      });
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

  // v1.6.3.10-v12 - FIX Issue #11: Transition to RECONNECTING state during backoff
  const reconnectDelay = _calculateReconnectDelay();
  _transitionPortState(PORT_CONNECTION_STATE.RECONNECTING, 'backoff-scheduled');

  console.log('[Content] PORT_RECONNECTING (backoff): Scheduling reconnection', {
    attempt: reconnectionAttempts,
    delayMs: reconnectDelay,
    reason,
    isInRecovery: isPortInRecovery()
  });

  setTimeout(() => {
    if (!backgroundPort && document.visibilityState !== 'hidden') {
      connectContentToBackground(tabId);
    }
  }, reconnectDelay);
}

/**
 * Categorize the disconnect reason from runtime.lastError
 * v1.6.3.11-v3 - FIX Issue #62: Provide human-readable disconnect reason
 * @private
 * @param {Object|null} error - Error object from browser.runtime.lastError
 * @returns {string} Categorized reason
 */
function _categorizeDisconnectReason(error) {
  if (!error || !error.message) {
    return 'UNKNOWN';
  }

  const msg = error.message.toLowerCase();

  if (msg.includes('receiving end does not exist')) {
    return 'BACKGROUND_NOT_RUNNING';
  }
  if (msg.includes('extension context invalidated')) {
    return 'EXTENSION_CONTEXT_INVALIDATED';
  }
  if (msg.includes('message port closed')) {
    return 'PORT_CLOSED_BY_PEER';
  }
  if (msg.includes('disconnected')) {
    return 'EXPLICIT_DISCONNECT';
  }

  return 'OTHER';
}

/**
 * Clear pending messages on port disconnect
 * v1.6.3.11 - FIX Code Health: Extracted to reduce nesting depth in onDisconnect handler
 * v1.6.3.11-v3 - FIX Issue #27: Increment portGeneration on disconnect to prevent message ID collision
 * @private
 */
function _clearPendingMessagesOnDisconnect() {
  const pendingCount = pendingMessages.size;

  // v1.6.3.11-v3 - FIX Issue #27: Increment port generation BEFORE clearing
  // This ensures new messages after reconnection have different generation prefix
  const previousGeneration = portGeneration;
  portGeneration++;

  console.log(
    '[Content][PORT_LIFECYCLE] CLEARING_PENDING_MESSAGES: Port disconnected, clearing in-flight messages',
    {
      pendingCount,
      previousPortGeneration: previousGeneration,
      newPortGeneration: portGeneration,
      timestamp: Date.now()
    }
  );

  if (pendingCount === 0) return;

  // Reject all pending messages before clearing
  for (const [messageId, pending] of pendingMessages) {
    if (pending.reject) {
      pending.reject(new Error(`Port disconnected (generation ${previousGeneration})`));
    }
    console.log('[Content][PORT_LIFECYCLE] PENDING_MESSAGE_REJECTED:', {
      messageId,
      age: Date.now() - pending.sentAt,
      retryCount: pending.retryCount
    });
  }
  pendingMessages.clear();
}

/**
 * Handle disconnect that occurs during listener registration
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 * @param {Error|null} error - Runtime error if any
 */
function _handleDisconnectDuringInit(error) {
  portDisconnectedDuringSetup = true;
  console.log(
    '[Content][PORT_LIFECYCLE] DISCONNECT_DURING_INIT: Disconnect occurred during listener registration',
    {
      error: error?.message,
      timestamp: Date.now()
    }
  );
}

/**
 * Handle normal port disconnect (after listeners registered)
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 * @param {Error|null} error - Runtime error if any
 * @param {number} tabId - Current tab ID for reconnection
 */
function _handleNormalDisconnect(error, tabId) {
  console.log(
    '[Content][PORT_LIFECYCLE] DISCONNECT_NORMAL: Port disconnected in normal operation',
    {
      error: error?.message,
      disconnectReason: _categorizeDisconnectReason(error),
      previousState: portConnectionState,
      portState: {
        wasBackgroundReady: isBackgroundReady,
        hadPort: !!backgroundPort,
        portName: backgroundPort?.name || 'unknown'
      },
      pendingMessagesAtDisconnect: pendingMessages.size,
      timestamp: Date.now()
    }
  );

  logContentPortLifecycle('disconnect', { error: error?.message });
  backgroundPort = null;
  isBackgroundReady = false;
  _transitionPortState(PORT_CONNECTION_STATE.DISCONNECTED, 'port-disconnected');
  _handleReconnection(tabId, 'disconnect');
}

/**
 * Create and configure the port disconnect handler
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 * @param {number} tabId - Current tab ID for reconnection
 * @returns {Function} The disconnect handler
 */
function _createDisconnectHandler(tabId) {
  return () => {
    const error = browser.runtime.lastError;
    _clearPendingMessagesOnDisconnect();

    if (!portListenersRegistered) {
      _handleDisconnectDuringInit(error);
      return;
    }

    _handleNormalDisconnect(error, tabId);
  };
}

/**
 * Handle deferred disconnect detected after listener registration
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 * @param {number} tabId - Current tab ID for reconnection
 */
function _handleDeferredDisconnect(tabId) {
  console.log(
    '[Content][PORT_LIFECYCLE] DISCONNECT_DURING_SETUP_DETECTED: Handling deferred disconnect',
    { timestamp: Date.now() }
  );
  backgroundPort = null;
  isBackgroundReady = false;
  _transitionPortState(PORT_CONNECTION_STATE.DISCONNECTED, 'port-disconnected-during-setup');
  _handleReconnection(tabId, 'disconnect-during-setup');
}

/**
 * Initialize port connection state and create connection
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 * @param {number} tabId - Current tab ID
 * @returns {Object} The connected port
 */
function _initializePortConnection(tabId) {
  portDisconnectedDuringSetup = false;
  portListenersRegistered = false;

  _transitionPortState(PORT_CONNECTION_STATE.CONNECTING, 'connect-attempt');
  handshakeRequestTimestamp = Date.now();
  isBackgroundReady = false;

  const port = browser.runtime.connect({ name: `quicktabs-content-${tabId}` });
  logContentPortLifecycle('open', { portName: port.name });

  console.log('[Content][PORT_LIFECYCLE] LISTENER_REGISTRATION_START: Registering port listeners', {
    portName: port.name,
    timestamp: Date.now()
  });

  return port;
}

/**
 * Finalize port setup after listeners are registered
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce connectContentToBackground complexity
 * @private
 * @param {number} tabId - Current tab ID for reconnection
 * @returns {boolean} True if setup was successful, false if deferred disconnect occurred
 */
function _finalizePortSetup(tabId) {
  portListenersRegistered = true;

  console.log('[Content][PORT_LIFECYCLE] LISTENER_REGISTRATION_COMPLETE: Both listeners attached', {
    portName: backgroundPort.name,
    hasOnDisconnect: true,
    hasOnMessage: true,
    timestamp: Date.now()
  });

  if (portDisconnectedDuringSetup) {
    _handleDeferredDisconnect(tabId);
    return false;
  }

  _resetReconnectionAttempts();
  _drainMessageQueue();

  console.log('[Content][PORT_LIFECYCLE] CONNECTION_ESTABLISHED: Port ready for messaging', {
    portName: backgroundPort.name,
    state: portConnectionState,
    timestamp: Date.now()
  });

  return true;
}

/**
 * Connect content script to background via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Persistent port connection
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (99→30 lines)
 */
function connectContentToBackground(tabId) {
  cachedTabId = tabId;

  if (portConnectionState === PORT_CONNECTION_STATE.FAILED) {
    console.warn('[Content] CIRCUIT_BREAKER_OPEN: Refusing to reconnect', {
      attempts: reconnectionAttempts
    });
    return;
  }

  try {
    backgroundPort = _initializePortConnection(tabId);

    // Register onDisconnect listener FIRST (within 5ms of connect())
    backgroundPort.onDisconnect.addListener(_createDisconnectHandler(tabId));

    // Register onMessage listener SECOND (after onDisconnect)
    backgroundPort.onMessage.addListener(handleContentPortMessage);

    _finalizePortSetup(tabId);
  } catch (err) {
    console.error('[Content][PORT_LIFECYCLE] CONNECTION_ERROR: Failed to connect', {
      error: err.message,
      timestamp: Date.now()
    });
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
    console.log(
      '[Content][TabID] BACKGROUND_READINESS_DETECTED: Background ready, resuming tab ID acquisition'
    );
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

  // v1.6.3.11 - FIX Issue #32: Handle PORT_VERIFY_RESPONSE for BFCache verification
  if (message.type === 'PORT_VERIFY_RESPONSE') {
    _handlePortVerifyResponse();
    return;
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

// ==================== v1.6.3.11 FIX ISSUE #39: BROADCAST DEDUPLICATION ====================
// Track received broadcast messageIds to prevent duplicate processing

/**
 * Set of already-processed broadcast messageIds
 * v1.6.3.11 - FIX Issue #39: Idempotency tracking for broadcast handlers
 */
const processedBroadcastMessageIds = new Set();

/**
 * Maximum size of dedup set before cleanup
 * v1.6.3.11 - FIX Issue #39
 */
const MAX_PROCESSED_BROADCAST_IDS = 1000;

/**
 * Check if broadcast was already processed (idempotency check)
 * v1.6.3.11 - FIX Issue #39
 * @param {string} messageId - Broadcast message ID
 * @returns {boolean} True if already processed (should skip)
 */
function _wasBroadcastAlreadyProcessed(messageId) {
  if (!messageId) return false;

  if (processedBroadcastMessageIds.has(messageId)) {
    console.log('[Content] BROADCAST_DEDUPED: Already processed', messageId);
    return true;
  }

  // Track this messageId
  processedBroadcastMessageIds.add(messageId);

  // Cleanup if set is too large
  if (processedBroadcastMessageIds.size > MAX_PROCESSED_BROADCAST_IDS) {
    // Convert to array, remove oldest half
    const arr = Array.from(processedBroadcastMessageIds);
    const toRemove = arr.slice(0, Math.floor(arr.length / 2));
    toRemove.forEach(id => processedBroadcastMessageIds.delete(id));
  }

  return false;
}

// ==================== END ISSUE #39 FIX ====================

/**
 * Handle broadcast messages from background
 * v1.6.3.6-v11 - FIX Issue #19: Handle visibility state sync
 * v1.6.3.11 - FIX Issue #39: Add idempotency tracking for broadcast handlers
 * @param {Object} message - Broadcast message
 */
function handleContentBroadcast(message) {
  const { action, messageId } = message;

  // v1.6.3.11 - FIX Issue #39: Check for duplicate broadcast
  if (_wasBroadcastAlreadyProcessed(messageId)) {
    return;
  }

  switch (action) {
    case 'VISIBILITY_CHANGE':
      console.log('[Content] Received visibility change broadcast:', {
        quickTabId: message.quickTabId,
        changes: message.changes,
        messageId
      });
      // Quick Tabs manager will handle this via its own listeners
      break;

    case 'TAB_LIFECYCLE_CHANGE':
      console.log('[Content] Received tab lifecycle broadcast:', {
        event: message.event,
        tabId: message.tabId,
        affectedQuickTabs: message.affectedQuickTabs,
        messageId
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

// ==================== v1.6.3.10-v12 FIX ISSUE #2: BFCACHE HANDLING ====================
// Firefox does not fire port.onDisconnect when tab enters BFCache
// Add pagehide/pageshow event listeners to detect BFCache transitions

/**
 * Handle pagehide event for BFCache entry detection
 * v1.6.3.10-v12 - FIX Issue #2: Mark port as potentially invalid on BFCache entry
 * v1.6.3.11-v3 - FIX Issue #51: Queue messages while frozen, prevent sending
 * v1.6.3.11-v3 - FIX Issue #52: Mark page as inactive for stale event rejection
 * v1.6.3.12 - FIX Issue #14: Set port readiness flag to false
 * @param {PageTransitionEvent} event - Page transition event
 */
function _handlePageHide(event) {
  if (event.persisted) {
    // Page is going into BFCache
    console.log('[Content][BFCACHE] ENTRY_DETECTED: Page entering BFCache', {
      timestamp: Date.now(),
      hasPort: !!backgroundPort,
      portState: portConnectionState
    });

    portPotentiallyInvalidDueToBFCache = true;

    // v1.6.3.11-v3 - FIX Issue #51: Mark port as frozen (messages will be queued)
    _isPortFrozenDueToBFCache = true;

    // v1.6.3.12 - FIX Issue #14: Mark port as not ready for messages
    markPortNotReady();

    // v1.6.3.11-v3 - FIX Issue #52: Mark page inactive for stale event rejection
    _markPageInactive();

    // Mark port as potentially invalid but don't disconnect
    // It may still work when restored
  }
}

/**
 * Handle pageshow event for BFCache exit detection
 * v1.6.3.10-v12 - FIX Issue #2: Verify port functionality after BFCache restore
 * v1.6.3.11-v3 - FIX Issue #51: Drain queued messages after restore
 * v1.6.3.11-v3 - FIX Issue #52: Mark page as active, query backend for current state
 * v1.6.3.11-v3 - FIX Issue #26/#77: Check for hostname change on BFCache restore and refresh tab ID
 * v1.6.3.12 - FIX Issue #14: Port readiness restored after verification
 * @param {PageTransitionEvent} event - Page transition event
 */
function _handlePageShow(event) {
  if (event.persisted) {
    // Page was restored from BFCache
    console.log('[Content][BFCACHE] EXIT_DETECTED: Page restored from BFCache', {
      timestamp: Date.now(),
      hasPort: !!backgroundPort,
      portState: portConnectionState,
      wasMarkedInvalid: portPotentiallyInvalidDueToBFCache,
      wasFrozen: _isPortFrozenDueToBFCache,
      queuedMessages: _bfcacheMessageQueue.length,
      portReadinessQueueSize: _portReadinessMessageQueue.length
    });

    // v1.6.3.11-v3 - FIX Issue #52: Mark page as active
    _markPageActive();

    // v1.6.3.11-v3 - FIX Issue #51: Unfreeze port
    _isPortFrozenDueToBFCache = false;

    // v1.6.3.11-v3 - FIX Issue #26/#77: Check for hostname change on BFCache restore
    // This handles cross-domain navigation detected after back/forward cache restore
    _checkHostnameChange();

    if (portPotentiallyInvalidDueToBFCache) {
      // Verify port functionality by attempting a ping
      // v1.6.3.12 - FIX Issue #14: Port readiness will be restored after verification
      _verifyPortAfterBFCache();
    } else if (backgroundPort && _bfcacheMessageQueue.length > 0) {
      // v1.6.3.11-v3 - FIX Issue #51: Port still valid, drain queued messages
      // v1.6.3.12 - FIX Issue #14: Mark port ready before draining
      markPortReady();
      _drainBFCacheMessageQueue();
    } else if (backgroundPort) {
      // v1.6.3.12 - FIX Issue #14: Port exists and is valid, mark ready
      markPortReady();
    }

    // v1.6.3.11-v3 - FIX Issue #52: Query backend for current state to avoid stale events
    _requestStateRefreshAfterBFCache();
  }
}

/**
 * Trigger port reconnection after BFCache restore when no port exists
 * v1.6.3.10-v12 - FIX Code Health: Extracted to reduce nesting depth
 * @private
 */
function _handleNoPortAfterBFCache() {
  console.log('[Content][BFCACHE] VERIFY_PORT: No port exists, triggering reconnect');
  portPotentiallyInvalidDueToBFCache = false;
  if (cachedTabId) {
    _handleReconnection(cachedTabId, 'bfcache-restore');
  }
}

/**
 * Handle port verification failure after BFCache restore
 * v1.6.3.10-v12 - FIX Code Health: Extracted to reduce nesting depth
 * v1.6.3.11 - FIX Issue #7: Add explicit BFCache recovery reconnection with logging
 * @private
 * @param {Error} err - Error from port verification
 */
function _handlePortVerifyFailure(err) {
  console.warn('[Content][BFCACHE] VERIFY_PORT_FAILED: Port not functional after BFCache', {
    error: err.message,
    timestamp: Date.now()
  });

  // v1.6.3.11 - FIX Issue #7: Close broken port before reconnection
  if (backgroundPort) {
    try {
      backgroundPort.disconnect();
    } catch (disconnectErr) {
      // Port may already be disconnected, ignore
      console.log('[Content][BFCACHE] Port already disconnected:', disconnectErr.message);
    }
  }

  // Port is dead, trigger reconnection
  backgroundPort = null;
  portPotentiallyInvalidDueToBFCache = false;
  _transitionPortState(PORT_CONNECTION_STATE.DISCONNECTED, 'bfcache-port-dead');

  // v1.6.3.11 - FIX Issue #7: Explicit BFCache recovery logging before reconnection
  console.log('[Content] BFCache recovery: reconnecting port', {
    cachedTabId,
    timestamp: Date.now()
  });

  if (cachedTabId) {
    // v1.6.3.11 - FIX Issue #7: Brief delay before reconnection (50ms)
    setTimeout(() => {
      console.log('[Content] BFCache recovery: initiating reconnection after delay');
      _handleReconnection(cachedTabId, 'bfcache-port-dead');
    }, 50);
  }
}

/**
 * Timeout for BFCache PORT_VERIFY response (milliseconds)
 * v1.6.3.11 - FIX Issue #32: Add timeout to prevent indefinite hangs
 * v1.6.3.11-v2 - FIX Issue #1 (Diagnostic Report): Increased from 1000ms to 2000ms
 *   - Firefox BFCache restore can delay message delivery by 500-1500ms
 *   - 2000ms provides sufficient margin for slow systems
 *   - On timeout: log warning with latency, always trigger reconnection
 */
const BFCACHE_VERIFY_TIMEOUT_MS = 2000;

/**
 * Timeout ID for BFCache verification
 * v1.6.3.11 - FIX Issue #32
 */
let bfcacheVerifyTimeoutId = null;

/**
 * Timestamp when PORT_VERIFY was sent for latency tracking
 * v1.6.3.11-v2 - FIX Issue #8 (Diagnostic Report): Track PORT_VERIFY latency
 */
let bfcacheVerifyStartTime = 0;

/**
 * Clear BFCache verify timeout
 * v1.6.3.11 - FIX Issue #32
 */
function _clearBFCacheVerifyTimeout() {
  if (bfcacheVerifyTimeoutId) {
    clearTimeout(bfcacheVerifyTimeoutId);
    bfcacheVerifyTimeoutId = null;
  }
}

/**
 * Handle PORT_VERIFY response from background
 * v1.6.3.11 - FIX Issue #32: Clear timeout on successful response
 * v1.6.3.11-v2 - FIX Issue #8 (Diagnostic Report): Log PORT_VERIFY success with latency
 * v1.6.3.12 - FIX Issue #14: Mark port ready after successful verification
 */
function _handlePortVerifyResponse() {
  _clearBFCacheVerifyTimeout();
  portPotentiallyInvalidDueToBFCache = false;

  // v1.6.3.11-v2 - FIX Issue #8: Log PORT_VERIFY success with latency measurement
  const latencyMs = bfcacheVerifyStartTime > 0 ? Date.now() - bfcacheVerifyStartTime : null;
  console.log(
    '[Content][BFCACHE][PORT_LIFECYCLE] VERIFY_SUCCESS: Port verified functional after BFCache',
    {
      latencyMs,
      timestamp: Date.now()
    }
  );
  bfcacheVerifyStartTime = 0; // Reset
  
  // v1.6.3.12 - FIX Issue #14: Mark port ready and drain queued messages
  markPortReady();
}

/**
 * Verify port functionality after BFCache restore
 * v1.6.3.10-v12 - FIX Issue #2: Attempt handshake to verify port is still functional
 * v1.6.3.10-v12 - FIX Code Health: Extracted helpers, removed unnecessary async
 * v1.6.3.11 - FIX Issue #32: Add 1000ms timeout to prevent indefinite hangs
 * v1.6.3.11-v2 - FIX Issue #1, #8 (Diagnostic Report): Enhanced timeout + latency tracking
 * @private
 */
function _verifyPortAfterBFCache() {
  console.log(
    '[Content][BFCACHE][PORT_LIFECYCLE] VERIFY_PORT_START: Checking port functionality after BFCache restore'
  );

  // No port exists - trigger reconnect immediately
  if (!backgroundPort) {
    _handleNoPortAfterBFCache();
    return;
  }

  // v1.6.3.11-v2 - FIX Issue #8: Track verify start time for latency measurement
  bfcacheVerifyStartTime = Date.now();

  // Try to send a test message via the port
  try {
    const testMessage = {
      type: 'PORT_VERIFY',
      timestamp: bfcacheVerifyStartTime,
      reason: 'bfcache-restore'
    };

    backgroundPort.postMessage(testMessage);
    console.log('[Content][BFCACHE][PORT_LIFECYCLE] VERIFY_PORT_SENT: Test message sent', {
      timestamp: bfcacheVerifyStartTime,
      portName: backgroundPort.name
    });

    // v1.6.3.11 - FIX Issue #32: Set timeout for response
    // v1.6.3.11-v2 - FIX Issue #1 (Diagnostic Report): Enhanced logging with timing details
    _clearBFCacheVerifyTimeout(); // Clear any existing timeout
    const verifyStartTime = Date.now();
    bfcacheVerifyTimeoutId = setTimeout(() => {
      const elapsedMs = Date.now() - verifyStartTime;
      console.warn(
        '[Content][BFCACHE][PORT_LIFECYCLE] VERIFY_TIMEOUT: No response after BFCache restore',
        {
          timeoutMs: BFCACHE_VERIFY_TIMEOUT_MS,
          elapsedMs,
          timestamp: Date.now(),
          portName: backgroundPort?.name || 'unknown',
          action: 'triggering-reconnection'
        }
      );

      // Timeout expired - trigger reconnection
      // v1.6.3.11-v2 - FIX Issue #1: ALWAYS reconnect when PORT_VERIFY times out
      // Firefox BFCache silently breaks port connections without firing onDisconnect
      portPotentiallyInvalidDueToBFCache = false;
      _handlePortVerifyFailure(new Error('PORT_VERIFY timeout'));
    }, BFCACHE_VERIFY_TIMEOUT_MS);
  } catch (err) {
    _handlePortVerifyFailure(err);
  }
}

// Register BFCache event listeners
window.addEventListener('pagehide', _handlePageHide);
window.addEventListener('pageshow', _handlePageShow);
console.log('[Content] v1.6.3.10-v12 BFCache event listeners registered');

// ==================== END BFCACHE HANDLING ====================

// ==================== v1.6.3.10-v12 FIX ISSUE #12: ADOPTION CACHE NAVIGATION CLEAR ====================
// Clear adoption cache on page navigation to prevent cross-domain leakage

/**
 * Current page hostname for adoption cache keying
 * v1.6.3.10-v12 - FIX Issue #12: Track hostname for compound key
 */
let currentPageHostname = null;

try {
  currentPageHostname = window.location.hostname;
} catch (_e) {
  // Cross-origin access may throw
  currentPageHostname = 'unknown';
}

/**
 * Clear adoption cache on navigation
 * v1.6.3.10-v12 - FIX Issue #12: Prevent cross-domain Quick Tab leakage
 */
function _clearAdoptionCacheOnNavigation() {
  if (recentlyAdoptedQuickTabs.size > 0) {
    console.log('[Content] ADOPTION_CACHE_CLEARED_ON_NAVIGATION:', {
      previousCount: recentlyAdoptedQuickTabs.size,
      previousHostname: currentPageHostname,
      timestamp: Date.now()
    });

    recentlyAdoptedQuickTabs.clear();
    adoptionCacheMetrics.clearedOnNavigation = (adoptionCacheMetrics.clearedOnNavigation || 0) + 1;
  }
}

/**
 * Check if hostname changed and clear adoption cache if needed
 * v1.6.3.10-v12 - FIX Issue #12: Detect cross-domain navigation
 * v1.6.3.11 - FIX Issue #26: Clear cachedTabId on hostname change and re-acquire
 */
function _checkHostnameChange() {
  let newHostname = null;
  try {
    newHostname = window.location.hostname;
  } catch (_e) {
    newHostname = 'unknown';
  }

  if (currentPageHostname !== null && newHostname !== currentPageHostname) {
    console.log('[Content] HOSTNAME_CHANGE_DETECTED:', {
      previousHostname: currentPageHostname,
      newHostname,
      timestamp: Date.now()
    });

    _clearAdoptionCacheOnNavigation();

    // v1.6.3.11 - FIX Issue #26: Clear cached tab ID on hostname change (cross-domain nav)
    // Tab ID may be stale after navigation, clear to force re-acquisition
    if (cachedTabId !== null) {
      console.log('[Content] CACHED_TAB_ID_CLEARED: Hostname changed, clearing cached tab ID', {
        previousCachedTabId: cachedTabId,
        previousHostname: currentPageHostname,
        newHostname
      });
      cachedTabId = null;

      // Re-acquire tab ID asynchronously
      getCurrentTabIdFromBackground('hostname-change').catch(err => {
        console.warn('[Content] Failed to re-acquire tab ID after hostname change:', err.message);
      });
    }
  }

  currentPageHostname = newHostname;
}

// Clear adoption cache on beforeunload (navigation away)
window.addEventListener('beforeunload', _clearAdoptionCacheOnNavigation);

// ==================== END ADOPTION CACHE NAVIGATION CLEAR ====================

// ==================== END PORT CONNECTION ====================

/**
 * Log initial phases of Quick Tabs initialization
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce initializeQuickTabsFeature complexity
 * @private
 */
function _logInitialPhases() {
  console.log('[INIT][Content] INIT_PHASE_1: Content script loaded', {
    timestamp: new Date().toISOString(),
    location: window.location.href.substring(0, 100)
  });

  console.log('[INIT][Content] PHASE_START: Quick Tabs initialization beginning', {
    timestamp: new Date().toISOString(),
    isWritingTabIdInitialized: isWritingTabIdInitialized()
  });

  console.log('[INIT][Content] INIT_PHASE_2: Message listener registered', {
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Content] TAB_ID_ACQUISITION_START:', {
    isWritingTabIdInitialized: isWritingTabIdInitialized(),
    timestamp: new Date().toISOString()
  });
}

/**
 * Log tab ID acquisition result
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce initializeQuickTabsFeature complexity
 * @private
 * @param {number|null} currentTabId - Acquired tab ID or null
 * @param {number} durationMs - Acquisition duration in milliseconds
 */
function _logTabIdAcquisitionResult(currentTabId, durationMs) {
  console.log('[INIT][Content] INIT_PHASE_3: Tab ID obtained', {
    tabId: currentTabId,
    durationMs,
    success: currentTabId !== null,
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Content] TAB_ID_ACQUISITION_COMPLETE:', {
    currentTabId: currentTabId !== null ? currentTabId : 'FAILED',
    durationMs,
    success: currentTabId !== null,
    timestamp: new Date().toISOString()
  });

  console.log('[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_RESULT: Tab ID acquired', {
    currentTabId,
    source: 'background messaging (GET_CURRENT_TAB_ID)',
    success: currentTabId !== null
  });
}

/**
 * Configure tab ID and port connection
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce initializeQuickTabsFeature complexity
 * @private
 * @param {number} currentTabId - Acquired tab ID
 */
function _configureTabIdAndPort(currentTabId) {
  setWritingTabId(currentTabId);
  console.log('[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_COMPLETE: Writing tab ID set', {
    tabId: currentTabId,
    isWritingTabIdInitializedAfter: isWritingTabIdInitialized()
  });

  console.log('[INIT][Content] INIT_PHASE_4: Handler initialized', {
    handlerType: 'StorageWritingTabId',
    tabId: currentTabId,
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Content] PORT_CONNECTION_START:', { tabId: currentTabId });
  connectContentToBackground(currentTabId);
  console.log('[INIT][Content] PORT_CONNECTION_INITIATED:', { tabId: currentTabId });
}

/**
 * Log tab ID acquisition failure
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce initializeQuickTabsFeature complexity
 * @private
 */
function _logTabIdAcquisitionFailure() {
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

/**
 * Log successful manager initialization
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce initializeQuickTabsFeature complexity
 * @private
 * @param {number|null} currentTabId - Tab ID
 * @param {number} totalDurationMs - Total initialization duration
 */
function _logManagerInitSuccess(currentTabId, totalDurationMs) {
  const tabIdStr = currentTabId !== null ? currentTabId : 'NULL';

  console.log('[INIT][Content] INIT_PHASE_5: Adoption message sent', {
    hasManager: true,
    currentTabId: tabIdStr,
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Content] INIT_PHASE_6: Background adoption confirmed', {
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Content] PHASE_COMPLETE:', {
    success: true,
    currentTabId: tabIdStr,
    totalDurationMs,
    hasManager: true,
    timestamp: new Date().toISOString()
  });

  console.log('[INIT][Content] INIT_COMPLETE: All systems ready', {
    totalDurationMs,
    tabId: currentTabId,
    timestamp: new Date().toISOString()
  });

  console.log('[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized successfully');
  console.log(
    '[Copy-URL-on-Hover] Manager has createQuickTab:',
    typeof quickTabsManager.createQuickTab
  );
  console.log('[Copy-URL-on-Hover] Manager currentTabId:', quickTabsManager.currentTabId);
}

/**
 * Log manager initialization failure
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce initializeQuickTabsFeature complexity
 * @private
 * @param {number|null} currentTabId - Tab ID
 * @param {number} totalDurationMs - Total initialization duration
 */
function _logManagerInitFailure(currentTabId, totalDurationMs) {
  console.error('[INIT][Content] PHASE_COMPLETE:', {
    success: false,
    currentTabId: currentTabId !== null ? currentTabId : 'NULL',
    totalDurationMs,
    hasManager: false,
    error: 'Manager is null after initialization',
    timestamp: new Date().toISOString()
  });
  console.error('[Copy-URL-on-Hover] ✗ Quick Tabs manager is null after initialization!');
}

/**
 * v1.6.0.3 - Helper to initialize Quick Tabs
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (109→35 lines)
 */
async function initializeQuickTabsFeature() {
  const initStartTime = Date.now();

  _logInitialPhases();

  const currentTabId = await getCurrentTabIdFromBackground();
  const tabIdAcquisitionDuration = Date.now() - initStartTime;

  _logTabIdAcquisitionResult(currentTabId, tabIdAcquisitionDuration);

  if (currentTabId !== null) {
    _configureTabIdAndPort(currentTabId);
  } else {
    _logTabIdAcquisitionFailure();
  }

  console.log('[INIT][Content] QUICKTABS_MANAGER_INIT_START:', {
    currentTabId: currentTabId !== null ? currentTabId : 'NULL',
    timestamp: new Date().toISOString()
  });

  quickTabsManager = await initQuickTabs(eventBus, Events, { currentTabId });

  const totalInitDuration = Date.now() - initStartTime;

  if (quickTabsManager) {
    _logManagerInitSuccess(currentTabId, totalInitDuration);
    startPeriodicLatencyMeasurement();
  } else {
    _logManagerInitFailure(currentTabId, totalInitDuration);
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
    // v1.6.3.11-v5 - FIX Issue #15: Track initialization start time
    initPhaseStartTime = Date.now();
    _logInitPhaseStart('moduleLoad');
    
    // v1.6.1: Wait for filter settings to load from storage BEFORE starting extension logs
    // This ensures user's filter preferences are active from the very first log
    const settingsResult = await settingsReady;
    
    // v1.6.3.11-v5 - FIX Issue #15: Log module load complete
    _logInitPhaseComplete('moduleLoad', initPhaseStartTime);
    
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

    // v1.6.3.11-v5 - FIX Issue #15: Log config load phase start
    const configLoadStart = Date.now();
    _logInitPhaseStart('configLoad');
    
    // Load configuration
    CONFIG = await loadConfiguration();
    
    // v1.6.3.11-v5 - FIX Issue #15: Log config load complete
    _logInitPhaseComplete('configLoad', configLoadStart);

    // Setup debug mode
    setupDebugMode();

    // Initialize state (critical - will throw on error)
    initializeState();

    // v1.6.3.11-v5 - FIX Issue #15: Log manager init phase start
    const managerInitStart = Date.now();
    _logInitPhaseStart('managerInit');
    
    // Initialize features
    await initializeFeatures();
    
    // v1.6.3.11-v5 - FIX Issue #15: Log manager init complete
    _logInitPhaseComplete('managerInit', managerInitStart);

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

// ==================== v1.6.3.11-v4 FIX ISSUE #2 & #5: HOVER DETECTION CONSTANTS ====================
/**
 * Debounce delay for hover detection (milliseconds)
 * v1.6.3.11-v4 - FIX Issue #2: Reduces CPU usage from 40-60% to 5-10%
 */
const HOVER_DEBOUNCE_DELAY_MS = 100;

/**
 * Track the last processed element to avoid redundant processing
 * v1.6.3.11-v4 - FIX Issue #2: Skip if element unchanged
 */
let lastProcessedElement = null;

/**
 * Track last hover processing time for debouncing
 * v1.6.3.11-v4 - FIX Issue #2
 */
let lastHoverProcessTime = 0;

/**
 * Pending hover processing timeout ID
 * v1.6.3.11-v4 - FIX Issue #2
 */
let pendingHoverTimeoutId = null;

// ==================== END HOVER DETECTION CONSTANTS ====================

/**
 * Initialize main features
 * v1.6.3.11-v4 - FIX Issue #5: Migrated from mouse events to Pointer Events API
 */
function initMainFeatures() {
  debug('Loading main features...');

  // Note: Notification styles now injected by notifications module (v1.5.9.0)

  // v1.6.3.11-v4 - FIX Issue #5: Track pointer position for Quick Tab placement
  // Using Pointer Events API for cross-input support (mouse, touch, pen)
  document.addEventListener(
    'pointermove',
    event => {
      stateManager.set('lastMouseX', event.clientX);
      stateManager.set('lastMouseY', event.clientY);
    },
    { passive: true, capture: true }
  );

  // Fallback for older browsers without Pointer Events
  if (!window.PointerEvent) {
    console.log('[HOVER_EVENT] Pointer Events not supported, using mousemove fallback');
    document.addEventListener(
      'mousemove',
      event => {
        stateManager.set('lastMouseX', event.clientX);
        stateManager.set('lastMouseY', event.clientY);
      },
      { passive: true, capture: true }
    );
  }

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
 * Handle pointer/mouse over event with debouncing
 * v1.6.3.11-v4 - FIX Issue #2 & #3: Debounced hover with structured logging
 * @private
 * @param {PointerEvent|MouseEvent} event - Pointer/Mouse event
 * @param {Object} context - Shared context with hoverStartTime
 */
function _handleHoverEvent(event, context) {
  const element = event.target;
  const now = performance.now();

  // v1.6.3.11-v4 - FIX Issue #2: Skip if same element (avoid redundant processing)
  if (element === lastProcessedElement) {
    return;
  }

  // v1.6.3.11-v4 - FIX Issue #2: Debounce rapid events
  const timeSinceLastProcess = now - lastHoverProcessTime;
  if (timeSinceLastProcess < HOVER_DEBOUNCE_DELAY_MS) {
    // Cancel any pending processing
    if (pendingHoverTimeoutId) {
      clearTimeout(pendingHoverTimeoutId);
    }

    // Schedule processing after debounce delay
    pendingHoverTimeoutId = setTimeout(() => {
      _processHoverElement(event, context);
    }, HOVER_DEBOUNCE_DELAY_MS - timeSinceLastProcess);

    return;
  }

  // Process immediately
  _processHoverElement(event, context);
}

/**
 * Get safe element identifiers for logging
 * v1.6.3.11-v4 - FIX Code Health: Helper to reduce _logHoverEntry complexity
 * @private
 * @param {Element} element - Element to extract info from
 * @returns {Object} Safe element identifiers
 */
function _getElementLogInfo(element) {
  return {
    tag: element.tagName,
    id: element.id || 'none',
    classes: element.className || 'none',
    text: element.textContent?.substring(0, 100) || '<empty>'
  };
}

/**
 * Log hover event entry
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processHoverElement complexity
 * @private
 */
function _logHoverEntry(element, event, domainType) {
  const elementInfo = _getElementLogInfo(element);
  const pointerType = event.pointerType || 'mouse';

  console.log('[HOVER_EVENT] Pointer entered element:', {
    tag: elementInfo.tag,
    id: elementInfo.id,
    classes: elementInfo.classes,
    pointerType,
    timestamp: Date.now()
  });

  console.log('[PLATFORM_DETECT] Domain type detected:', {
    domainType,
    hostname: window.location.hostname
  });

  logNormal('hover', 'Start', 'Pointer entered element', {
    elementTag: elementInfo.tag,
    elementClasses: elementInfo.classes,
    elementId: elementInfo.id,
    elementText: elementInfo.text,
    domainType,
    pointerType
  });
}

/**
 * Perform URL detection and logging
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processHoverElement complexity
 * @private
 */
function _detectAndLogUrl(element, domainType) {
  const urlDetectionStart = performance.now();
  const url = urlRegistry.findURL(element, domainType);
  const urlDetectionDuration = performance.now() - urlDetectionStart;

  console.log('[URL_EXTRACT] Detection complete:', {
    found: !!url,
    url: url || 'none',
    domainType,
    durationMs: urlDetectionDuration.toFixed(2)
  });

  _logUrlDetectionResult(url, element, domainType, urlDetectionDuration);
  return url;
}

/**
 * Process hover element after debouncing
 * v1.6.3.11-v4 - FIX Issue #2 & #3: Core hover processing with logging
 * v1.6.3.11-v5 - FIX Issue #7: Add error recovery integration
 * @private
 * @param {PointerEvent|MouseEvent} event - Event object
 * @param {Object} context - Shared context
 */
function _processHoverElement(event, context) {
  // v1.6.3.11-v5 - FIX Issue #7: Skip processing if in recovery mode
  if (_shouldSkipForRecovery()) {
    console.debug('[Content] HOVER_SKIPPED: In recovery mode', {
      backoffMs: hoverBackoffDelay,
      errorCount: hoverErrorCounter
    });
    return;
  }

  try {
    const element = event.target;
    const now = performance.now();

    // Update tracking
    lastProcessedElement = element;
    lastHoverProcessTime = now;
    pendingHoverTimeoutId = null;
    context.hoverStartTime = now;

    const domainType = getDomainType();

    // Log hover entry
    _logHoverEntry(element, event, domainType);

    // Detect URL
    const url = _detectAndLogUrl(element, domainType);

    // Always set element, URL can be null
    stateManager.setState({
      currentHoveredLink: url || null,
      currentHoveredElement: element
    });

    if (url) {
      // v1.6.3.11-v4 - FIX Issue #3: [TOOLTIP] logging (for display operations)
      console.log('[TOOLTIP] URL ready for display:', { url });
      eventBus.emit(Events.HOVER_START, { url, element, domainType });
      
      // v1.6.3.11-v5 - FIX Issue #7: Reset errors on successful URL detection
      _resetHoverErrors();
    }
  } catch (error) {
    // v1.6.3.11-v5 - FIX Issue #7: Record hover detection error
    console.error('[Content] HOVER_DETECTION_ERROR:', {
      error: error.message,
      stack: error.stack?.substring(0, 200),
      target: event?.target?.tagName,
      timestamp: Date.now()
    });
    _recordHoverError(error);
  }
}

/**
 * Handle pointer/mouse out event
 * v1.6.3.11-v4 - FIX Issue #3: Enhanced logging
 * @private
 * @param {PointerEvent|MouseEvent} event - Event object
 * @param {Object} context - Shared context
 */
function _handleHoverEndEvent(event, context) {
  const hoverDuration = context.hoverStartTime ? performance.now() - context.hoverStartTime : 0;
  const wasURLDetected = !!stateManager.get('currentHoveredLink');

  // v1.6.3.11-v4 - FIX Issue #3: [HOVER_EVENT] end logging
  console.log('[HOVER_EVENT] Pointer left element:', {
    tag: event.target.tagName,
    durationMs: hoverDuration.toFixed(2),
    urlDetected: wasURLDetected,
    pointerType: event.pointerType || 'mouse'
  });

  // Log hover end with duration and context
  logNormal('hover', 'End', 'Pointer left element', {
    duration: `${hoverDuration.toFixed(2)}ms`,
    urlWasDetected: wasURLDetected,
    elementTag: event.target.tagName
  });

  stateManager.setState({
    currentHoveredLink: null,
    currentHoveredElement: null
  });

  // v1.6.3.11-v4 - FIX Code Review: Cancel timeout BEFORE clearing lastProcessedElement
  // to prevent race condition where timeout fires after hover ends
  if (pendingHoverTimeoutId) {
    clearTimeout(pendingHoverTimeoutId);
    pendingHoverTimeoutId = null;
  }

  // Clear tracking (after cancelling timeout to prevent race)
  lastProcessedElement = null;

  eventBus.emit(Events.HOVER_END);
  context.hoverStartTime = null;
}

/**
 * Set up hover detection using Pointer Events API
 * v1.6.3.11-v4 - FIX Issue #2 & #5: Debounced detection with Pointer Events
 * v1.6.0.7 - Enhanced logging for hover lifecycle and URL detection
 *
 * Changes:
 * - Issue #2: Added debouncing to reduce CPU from 40-60% to 5-10%
 * - Issue #3: Added [HOVER_EVENT], [PLATFORM_DETECT], [URL_EXTRACT] logging
 * - Issue #5: Migrated from mouse events to Pointer Events API
 */
function setupHoverDetection() {
  // Track hover start time for duration calculation (shared context)
  const context = { hoverStartTime: null };

  console.log('[HOVER_EVENT] Setting up hover detection:', {
    pointerEventsSupported: !!window.PointerEvent,
    debounceMs: HOVER_DEBOUNCE_DELAY_MS
  });

  // v1.6.3.11-v4 - FIX Issue #5: Use Pointer Events API for cross-input support
  if (window.PointerEvent) {
    // Primary: Pointer Events (supports mouse, touch, pen)
    document.addEventListener('pointerover', event => _handleHoverEvent(event, context), {
      passive: true
    });

    document.addEventListener('pointerout', event => _handleHoverEndEvent(event, context), {
      passive: true
    });

    console.log('[HOVER_EVENT] Using Pointer Events API (pointerover/pointerout)');
  } else {
    // Fallback: Mouse events for older browsers (Firefox < 59, Safari < 13)
    document.addEventListener('mouseover', event => _handleHoverEvent(event, context), {
      passive: true
    });

    document.addEventListener('mouseout', event => _handleHoverEndEvent(event, context), {
      passive: true
    });

    console.log('[HOVER_EVENT] Fallback to mouse events (mouseover/mouseout)');
  }
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
 * Check if event has potential extension shortcut modifiers
 * v1.6.3.11-v4 - FIX Code Health: Encapsulate complex conditional
 * @private
 * @param {KeyboardEvent} event - The keyboard event
 * @returns {boolean} True if event has modifiers suggesting an extension shortcut
 */
function _hasPotentialShortcutModifiers(event) {
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * Handle shortcut pressed during initialization
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce handleKeyboardShortcut complexity
 * @private
 * @param {KeyboardEvent} event - The keyboard event
 */
function _handleShortcutDuringInit(event) {
  if (_hasPotentialShortcutModifiers(event)) {
    console.log('[INIT] Extension initializing, shortcut will work shortly', {
      key: event.key,
      modifiers: `Ctrl:${event.ctrlKey} Alt:${event.altKey} Shift:${event.shiftKey} Meta:${event.metaKey}`,
      timestamp: Date.now()
    });
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted handler for keyboard shortcuts
 * v1.6.3.11 - FIX Issue #38: Add guard for initialization window
 * v1.6.3.11-v4 - FIX Code Health: Encapsulated complex conditionals, flattened structure
 * v1.6.3.11-v5 - FIX Issue #15: Check state readiness before using state
 */
async function handleKeyboardShortcut(event) {
  if (!contentScriptInitialized) {
    _handleShortcutDuringInit(event);
    return;
  }

  // v1.6.3.11-v5 - FIX Issue #15: Log if state not ready but still proceeding
  if (!_isStateReadyForFeatures()) {
    _logUninitializedStateAccess('keyboard', 'handleKeyboardShortcut');
  }

  if (isInputField(event.target)) {
    return;
  }

  const hoveredLink = stateManager.get('currentHoveredLink');
  const hoveredElement = stateManager.get('currentHoveredElement');

  for (const shortcut of SHORTCUT_HANDLERS) {
    if (!matchesShortcut(event, shortcut, hoveredLink, hoveredElement)) {
      continue;
    }

    event.preventDefault();
    await executeShortcutHandler(shortcut, hoveredLink, hoveredElement, event);
    return;
  }
}

/**
 * Set up keyboard shortcuts
 * v1.6.0 Phase 2.4 - Extracted handler to reduce complexity
 * v1.6.3.11 - FIX Issue #38: Now safe to register early due to guard in handleKeyboardShortcut
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', handleKeyboardShortcut);
  console.log('[Content] Keyboard shortcuts registered (guarded until initialization complete)');
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
    console.warn(
      '[Content] QUICK_TAB_CREATE_WARNING: originTabId is null, tab ID not yet initialized',
      {
        url,
        id,
        cachedTabId,
        suggestion: 'Ensure connectContentToBackground() completes before creating Quick Tabs'
      }
    );
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
 * Build message data for CREATE_QUICK_TAB operation
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce persistQuickTabToBackground complexity
 * @private
 * @param {Object} quickTabData - Quick Tab data
 * @param {string} saveId - Save tracking ID
 * @param {number|null} originTabId - Origin tab ID
 * @returns {Object} Message data
 */
function _buildCreateQuickTabMessage(quickTabData, saveId, originTabId) {
  return {
    action: 'CREATE_QUICK_TAB',
    ...quickTabData,
    originTabId,
    saveId,
    operationType: OPERATION_TYPE.CREATE
  };
}

/**
 * Log successful CREATE_QUICK_TAB response
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _logCreateQuickTabSuccess(response, originTabId, quickTabId, attempt) {
  console.log('[Content] CREATE_QUICK_TAB response received:', {
    success: response.success,
    returnedOriginTabId: response.originTabId,
    sequenceId: response.sequenceId,
    validationMatch: response.originTabId === originTabId,
    attempt
  });

  if (response.originTabId !== undefined && response.originTabId !== originTabId) {
    console.warn('[Content] OWNERSHIP_VALIDATION: Background assigned different originTabId', {
      sentOriginTabId: originTabId,
      assignedOriginTabId: response.originTabId,
      quickTabId
    });
  }
}

/**
 * Log retry attempt for handler operation
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _logHandlerRetryAttempt(operation, quickTabId, attempt, delayMs, errorInfo) {
  console.log('[Content] HANDLER_RETRY_ATTEMPT:', {
    operation,
    quickTabId,
    attempt: attempt + 1,
    maxRetries: HANDLER_RETRY_CONFIG.maxRetries,
    delayMs,
    ...errorInfo
  });
}

/**
 * Perform a single attempt to persist Quick Tab to background
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce complexity (cc=9→4)
 * @private
 */
async function _attemptPersistQuickTab(messageData, context, originTabId, attempt) {
  const response = await sendMessageToBackground(messageData);
  const result = _processHandlerResponse(response, 'CREATE_QUICK_TAB', context);

  if (result.success) {
    _logCreateQuickTabSuccess(response, originTabId, context.quickTabId, attempt);
    return { success: true, response };
  }

  // Handler returned error
  if (!result.shouldRetry || attempt >= HANDLER_RETRY_CONFIG.maxRetries) {
    _showHandlerErrorNotification('CREATE_QUICK_TAB', response);
    const errorMsg = response?.error?.message || response?.errorMessage || 'Handler returned error';
    return { success: false, shouldRetry: false, error: new Error(errorMsg) };
  }

  // Transient error - need retry
  const delayMs = _calculateHandlerRetryDelay(attempt);
  _logHandlerRetryAttempt('CREATE_QUICK_TAB', context.quickTabId, attempt, delayMs, {
    errorType: response?.errorType
  });
  
  return { success: false, shouldRetry: true, delayMs };
}

/**
 * Handle error during persist attempt - determine retry behavior
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce nesting depth
 * @private
 */
function _handlePersistError(err, attempt, quickTabId) {
  if (attempt >= HANDLER_RETRY_CONFIG.maxRetries) {
    return { shouldRetry: false, error: err };
  }
  
  const delayMs = _calculateHandlerRetryDelay(attempt);
  _logHandlerRetryAttempt('CREATE_QUICK_TAB', quickTabId, attempt, delayMs, {
    error: err.message
  });
  
  return { shouldRetry: true, delayMs };
}

/**
 * Execute single persist attempt with error handling
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce complexity
 * @private
 * @returns {Object} Result with {done, response, error, delayMs}
 */
async function _executePersistAttempt(messageData, context, originTabId, attempt) {
  try {
    const result = await _attemptPersistQuickTab(messageData, context, originTabId, attempt);
    
    if (result.success) return { done: true, response: result.response };
    if (!result.shouldRetry) return { done: true, error: result.error };
    
    return { done: false, delayMs: result.delayMs };
  } catch (err) {
    const errorResult = _handlePersistError(err, attempt, context.quickTabId);
    if (!errorResult.shouldRetry) return { done: true, error: err };
    return { done: false, delayMs: errorResult.delayMs, lastError: err };
  }
}

/**
 * Log CREATE_QUICK_TAB request initialization
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce complexity
 * @private
 */
function _logCreateQuickTabInit(quickTabId, originTabId, hasExplicitOriginTabId) {
  console.log('[Content] Sending CREATE_QUICK_TAB with originTabId:', {
    quickTabId,
    originTabId,
    hasExplicitOriginTabId,
    fallbackToCurrentTabId: !hasExplicitOriginTabId && originTabId !== null,
    timestamp: Date.now(),
    note: 'Background will validate ownership and assign global sequenceId'
  });
}

/**
 * Execute retry loop for persist operation
 * v1.6.3.11-v5 - FIX Code Health: Extracted to reduce complexity (cc=11→4)
 * @private
 * @returns {Object} {response} on success, throws on failure
 */
async function _executeRetryLoop(messageData, context, originTabId) {
  let lastError = null;

  for (let attempt = 0; attempt <= HANDLER_RETRY_CONFIG.maxRetries; attempt++) {
    const result = await _executePersistAttempt(messageData, context, originTabId, attempt);
    
    if (result.done && result.response) return result.response;
    if (result.done && result.error) throw result.error;
    if (result.lastError) lastError = result.lastError;
    
    await new Promise(resolve => setTimeout(resolve, result.delayMs));
  }

  console.error('[Content] HANDLER_RESPONSE_ERROR: All retries exhausted for CREATE_QUICK_TAB', {
    quickTabId: context.quickTabId,
    originTabId,
    lastError: lastError?.message
  });

  throw lastError || new Error('Failed to persist Quick Tab after retries');
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for background persistence
 * v1.6.3.10-v12 - FIX Issue #5: Add sequenceId for CREATE ordering enforcement
 * v1.6.3.11 - FIX Issue #31: Remove client-side sequence ID generation for CREATE
 * v1.6.3.11-v3 - FIX Issue #15: Enhanced logging for originTabId sent with message
 * v1.6.3.11-v5 - FIX Issue #5: Add handler response checking with retry logic
 * v1.6.3.11-v5 - FIX Code Health: Refactored to extract helpers (cc=11→3)
 */
async function persistQuickTabToBackground(quickTabData, saveId) {
  const originTabId = quickTabData.originTabId || quickTabsManager?.currentTabId || null;
  const hasExplicitOriginTabId = quickTabData.originTabId !== undefined;
  
  _logCreateQuickTabInit(quickTabData.id, originTabId, hasExplicitOriginTabId);

  const messageData = _buildCreateQuickTabMessage(quickTabData, saveId, originTabId);
  const context = { quickTabId: quickTabData.id, originTabId, operation: 'CREATE_QUICK_TAB' };
  
  return _executeRetryLoop(messageData, context, originTabId);
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
 * Prepare Quick Tab data for creation
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce handleCreateQuickTab complexity
 * @private
 * @param {string} url - URL for the Quick Tab
 * @param {Element|null} targetElement - Target element for positioning
 * @returns {Object} Quick Tab creation data
 */
function _prepareQuickTabCreationData(url, targetElement) {
  const width = CONFIG.quickTabDefaultWidth || 800;
  const height = CONFIG.quickTabDefaultHeight || 600;
  const position = calculateQuickTabPosition(targetElement, width, height);
  const title = targetElement?.textContent?.trim() || 'Quick Tab';

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

  return { quickTabData, quickTabId, saveId, canUseManagerSaveId };
}

/**
 * v1.6.0 Phase 2.4 - Refactored to reduce complexity from 18 to <9
 * v1.6.3.10-v11 - FIX Issue #25: Use creation queue to serialize operations
 * v1.6.3.11-v4 - FIX Code Health: Extracted helper to reduce complexity (cc=9→4)
 */
async function handleCreateQuickTab(url, targetElement = null) {
  if (!url) {
    console.warn('[Quick Tab] Missing URL for creation');
    return;
  }

  debug('Creating Quick Tab for:', url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });

  const { quickTabData, quickTabId, saveId, canUseManagerSaveId } = _prepareQuickTabCreationData(
    url,
    targetElement
  );

  console.log('[Content] QUICK_TAB_CREATE_REQUEST:', {
    id: quickTabId,
    url: url.substring(0, 100),
    queueSize: quickTabCreationQueue.length
  });

  try {
    await _queueQuickTabCreation(quickTabData, saveId, canUseManagerSaveId);
  } catch (err) {
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
 * v1.6.3.11-v5 - FIX Issue #6: Use verification wrapper for delivery checking
 */
function showNotification(message, type = 'info') {
  // v1.6.3.11-v5 - FIX Issue #6: Use verification wrapper
  _showNotificationWithVerification(message, type);
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
 * v1.6.3.11 - FIX Issue #33: Increased to 5 minutes for adoption cache
 */
const ADOPTION_DEFAULT_TTL_MS = 300000;

/**
 * Minimum TTL for adoption tracking (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #5: Never go below 5 seconds
 */
const ADOPTION_MIN_TTL_MS = 5000;

/**
 * Maximum TTL for adoption tracking (milliseconds)
 * v1.6.3.10-v11 - FIX Issue #5: Cap at 60 seconds to prevent memory leaks
 * v1.6.3.11 - FIX Issue #33: Increased max to 5 minutes for adoption cache
 */
const ADOPTION_MAX_TTL_MS = 300000;

/**
 * Multiplier for latency to compute TTL (3x for safety margin)
 * v1.6.3.10-v11 - FIX Issue #5
 */
const ADOPTION_TTL_LATENCY_MULTIPLIER = 3;

/**
 * Cleanup interval for recently-adopted Quick Tab entries (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #7: Clean up every 30 seconds
 * v1.6.3.11 - FIX Issue #33: Changed to 60 seconds for adoption cache
 */
const ADOPTION_CLEANUP_INTERVAL_MS = 60000;

/**
 * Track observed handshake latencies for dynamic TTL calculation
 * v1.6.3.10-v11 - FIX Issue #5
 */
const adoptionLatencySamples = [];
const MAX_ADOPTION_LATENCY_SAMPLES = 10;

/**
 * Counter for heartbeats to trigger periodic latency re-measurement
 * v1.6.3.10-v12 - FIX Issue #4: Re-measure latency every 10 heartbeats
 */
let heartbeatCountSinceLatencyUpdate = 0;
const HEARTBEATS_PER_LATENCY_UPDATE = 10;

/**
 * Adoption cache metrics for logging
 * v1.6.3.10-v11 - FIX Issue #5
 * v1.6.3.10-v12 - FIX Issue #12: Added clearedOnNavigation counter
 */
const adoptionCacheMetrics = {
  hitCount: 0,
  missCount: 0,
  ttlExpiredCount: 0,
  totalTracked: 0,
  clearedOnNavigation: 0, // v1.6.3.10-v12 - FIX Issue #12
  latencyUpdates: 0 // v1.6.3.10-v12 - FIX Issue #4
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
 * Record an adoption latency sample (used for dynamic TTL calculation)
 * v1.6.3.10-v11 - FIX Issue #5
 * v1.6.3.10-v12 - FIX Issue #4: Track heartbeat count for periodic recalculation
 * v1.6.3.11-v3 - Renamed from _recordHandshakeLatency to avoid conflict
 * @param {number} latencyMs - Observed latency in milliseconds
 */
function _recordAdoptionLatencySample(latencyMs) {
  if (typeof latencyMs !== 'number' || latencyMs < 0) return;

  // v1.6.3.10-v12 - FIX Issue #4: Track heartbeat count
  heartbeatCountSinceLatencyUpdate++;

  const oldLatency = lastKnownBackgroundLatencyMs;

  adoptionLatencySamples.push(latencyMs);
  if (adoptionLatencySamples.length > MAX_ADOPTION_LATENCY_SAMPLES) {
    adoptionLatencySamples.shift();
  }

  const newAverageLatency = _getObservedHandshakeLatency();

  // v1.6.3.10-v12 - FIX Issue #4: Update lastKnownBackgroundLatencyMs periodically
  // Recalculate every 10 heartbeats to adapt to network condition changes
  if (heartbeatCountSinceLatencyUpdate >= HEARTBEATS_PER_LATENCY_UPDATE) {
    heartbeatCountSinceLatencyUpdate = 0;
    adoptionCacheMetrics.latencyUpdates++;

    if (oldLatency !== null && newAverageLatency !== null) {
      console.log('[Content] LATENCY_UPDATED: Periodic latency recalculation', {
        oldLatencyMs: oldLatency,
        newLatencyMs: newAverageLatency,
        change: newAverageLatency - oldLatency,
        newAdoptionTTL: _calculateDynamicAdoptionTTL(),
        updateCount: adoptionCacheMetrics.latencyUpdates
      });
    }

    lastKnownBackgroundLatencyMs = newAverageLatency;
  }

  console.log('[Content] ADOPTION_LATENCY_RECORDED:', {
    latencyMs,
    sampleCount: adoptionLatencySamples.length,
    averageLatency: newAverageLatency,
    heartbeatsSinceUpdate: heartbeatCountSinceLatencyUpdate
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
 * v1.6.3.11 - FIX Issue #34: Add size limit with eviction of oldest entries
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {number} newOriginTabId - New owner tab ID
 */
function _trackAdoptedQuickTab(quickTabId, newOriginTabId) {
  const dynamicTTL = _calculateDynamicAdoptionTTL();

  // v1.6.3.11 - FIX Issue #34: Evict oldest entries if cache is too large (max 100 entries)
  _evictOldestAdoptionEntriesIfNeeded();

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
 * Evict oldest entries from adoption cache if size limit exceeded
 * v1.6.3.11 - FIX Code Health: Extracted to reduce _trackAdoptedQuickTab complexity
 * @private
 */
function _evictOldestAdoptionEntriesIfNeeded() {
  const ADOPTION_CACHE_MAX_SIZE = 100;
  if (recentlyAdoptedQuickTabs.size < ADOPTION_CACHE_MAX_SIZE) return;

  // Evict oldest 10% of entries
  const evictCount = Math.ceil(ADOPTION_CACHE_MAX_SIZE * 0.1);
  let evicted = 0;

  // Map iterates in insertion order, so first entries are oldest
  for (const [oldId] of recentlyAdoptedQuickTabs) {
    recentlyAdoptedQuickTabs.delete(oldId);
    evicted++;
    if (evicted >= evictCount) break;
  }

  console.log('[Content] ADOPTION_CACHE_EVICTION:', {
    evictedCount: evicted,
    sizeAfter: recentlyAdoptedQuickTabs.size,
    maxSize: ADOPTION_CACHE_MAX_SIZE
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
 * v1.6.3.11 - FIX Issue #33: Add specific logging format for adoption cache cleanup
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

  // v1.6.3.11 - FIX Issue #33: Log cleanup with specific format
  if (cleanedCount > 0) {
    console.log(
      '[Content] ADOPTION_CACHE_CLEANUP:',
      cleanedCount,
      'entries expired,',
      recentlyAdoptedQuickTabs.size,
      'remaining'
    );
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
  const matchesAdoptedOwnership =
    adoptionInfo.wasAdopted && adoptionInfo.newOriginTabId === ownership.currentTabId;

  // Log warning if pattern and adoption ownership diverge
  _logOwnershipDivergence(quickTabId, extractedTabId, adoptionInfo, ownership.currentTabId);

  return {
    ...ownership,
    extractedTabId,
    matchesIdPattern,
    wasAdopted: adoptionInfo.wasAdopted,
    adoptedOwnerTabId: adoptionInfo.newOriginTabId,
    matchesAdoptedOwnership,
    ownsQuickTab: _determineOwnership(
      ownership,
      matchesAdoptedOwnership,
      adoptionInfo.wasAdopted,
      matchesIdPattern
    )
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
    () => {
      clearConsoleLogs();
      clearLogBuffer();
    },
    sendResponse,
    'clearedAt',
    'clearing log buffer'
  );
}

/**
 * Handle REFRESH_LIVE_CONSOLE_FILTERS action
 * @private
 */
function _handleRefreshLiveConsoleFilters(sendResponse) {
  _executeWithResponse(
    refreshLiveConsoleSettings,
    sendResponse,
    'refreshedAt',
    'refreshing live console filters'
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
    adoptedQuickTabId,
    oldOriginTabId: target.originTabId,
    newOriginTabId,
    location
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
  return _updateOriginTabIdWithLog(
    snapshot,
    adoptedQuickTabId,
    newOriginTabId,
    'minimized-snapshot'
  );
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
function _tryUpdateMinimizedManagerSnapshot(
  adoptedQuickTabId,
  newOriginTabId,
  previousOriginTabId
) {
  if (!quickTabsManager?.minimizedManager?.updateSnapshotOriginTabId) return false;
  return quickTabsManager.minimizedManager.updateSnapshotOriginTabId(
    adoptedQuickTabId,
    newOriginTabId,
    previousOriginTabId
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
    adoptedQuickTabId,
    previousOriginTabId,
    newOriginTabId,
    currentTabId,
    hasInMap: !!tabEntry,
    hasSnapshot: !!minimizedSnapshot
  });

  // Update caches
  const tabUpdated = _updateTabEntryOriginTabId(tabEntry, adoptedQuickTabId, newOriginTabId);
  const directSnapshotUpdated = _updateMinimizedSnapshotOriginTabId(
    minimizedSnapshot,
    adoptedQuickTabId,
    newOriginTabId
  );
  const cacheUpdated = tabUpdated || directSnapshotUpdated;
  const snapshotUpdated = _tryUpdateMinimizedManagerSnapshot(
    adoptedQuickTabId,
    newOriginTabId,
    previousOriginTabId
  );

  console.log('[Content] ADOPTION_COMPLETED completed:', {
    adoptedQuickTabId,
    cacheUpdated,
    snapshotUpdated,
    timeSinceAdoption: Date.now() - timestamp
  });

  sendResponse({
    success: true,
    cacheUpdated,
    snapshotUpdated,
    currentTabId,
    timestamp: Date.now()
  });
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
      quickTabsManager
        .hydrateFromStorage()
        .then(result => {
          console.log('[Content] TAB_ACTIVATED_HANDLER: Hydration complete:', result);
        })
        .catch(err => {
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
    quickTabId: tabData.id,
    oldOriginTabId: target.originTabId,
    newOriginTabId: tabData.originTabId
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

    // v1.6.3.11 - FIX Issue #36: Validate message has quickTabId field
    if (!message.quickTabId || typeof message.quickTabId !== 'string') {
      console.warn('[Content] RESTORE_QUICK_TAB: Invalid message - missing quickTabId', {
        hasQuickTabId: !!message.quickTabId,
        type: typeof message.quickTabId
      });
      sendResponse({
        success: false,
        error: 'Invalid message: missing quickTabId field',
        code: 'MISSING_QUICK_TAB_ID'
      });
      return true;
    }

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
      return {
        success: false,
        error: 'Quick Tabs manager not initialized or visibility handler not ready'
      };
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
      return {
        success: false,
        error: 'Quick Tabs manager not initialized - closeById not available'
      };
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
  // v1.6.3.11-v6 - FIX Issue #11: Handle storage state sync from background re-broadcast
  STORAGE_STATE_SYNC: (message, sendResponse) => {
    const { state, context } = message;
    const startTime = Date.now();

    console.log('[Content][STORAGE_SYNC] STORAGE_STATE_SYNC received from background:', {
      tabCount: state?.tabs?.length ?? 0,
      timestamp: state?.timestamp,
      source: context?.source,
      addedCount: context?.addedIds?.length ?? 0,
      removedCount: context?.removedIds?.length ?? 0
    });

    // Trigger hydration with the new state
    if (quickTabsManager?.hydrateFromStorage) {
      quickTabsManager
        .hydrateFromStorage()
        .then(() => {
          const duration = Date.now() - startTime;
          console.log('[Content][STORAGE_SYNC] Hydration complete:', {
            durationMs: duration,
            tabCount: state?.tabs?.length ?? 0
          });
        })
        .catch(err => {
          console.warn('[Content][STORAGE_SYNC] Hydration failed:', err.message);
        });
    }

    // Emit event for any listeners
    if (typeof eventBus !== 'undefined' && eventBus.emit) {
      eventBus.emit('storage:synced', {
        tabs: state?.tabs || [],
        context,
        timestamp: startTime
      });
    }

    sendResponse({
      success: true,
      received: true,
      tabCount: state?.tabs?.length ?? 0,
      timestamp: Date.now()
    });
    return true;
  },

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
  // v1.6.3.12 - FIX Issue #9: Add message ordering support
  QUICK_TAB_STATE_UPDATED: (message, sendResponse) => {
    const { operationSequence, quickTabId, changes, messageId } = message;
    
    console.log('[Content] MESSAGE_SEQUENCE_CHECK:', {
      action: 'received',
      messageId,
      operationSequence: operationSequence ?? 'none',
      highestProcessed: _highestProcessedSequence,
      quickTabId,
      changeType: Object.keys(changes || {})[0] || 'unknown',
      timestamp: Date.now()
    });
    
    // v1.6.3.12 - FIX Issue #9: Check message ordering
    const orderCheck = _shouldProcessMessageBySequence(operationSequence);
    
    if (!orderCheck.shouldProcess && orderCheck.reason === 'out-of-order') {
      // Buffer for later processing
      _bufferMessageForOrdering(operationSequence, message);
      sendResponse({ received: true, buffered: true, operationSequence });
      return true;
    }
    
    if (!orderCheck.shouldProcess) {
      // Already processed newer - discard
      sendResponse({ received: true, discarded: true, reason: orderCheck.reason });
      return true;
    }
    
    // Process the message
    console.log('[Content] QUICK_TAB_STATE_UPDATED processing:', {
      quickTabId,
      changes,
      operationSequence
    });
    
    // Content script doesn't need to do anything - it manages its own state
    // This handler is mainly for logging and potential future use
    
    // v1.6.3.12 - FIX Issue #9: Mark sequence as processed and drain buffer
    if (operationSequence !== undefined && operationSequence !== null) {
      _highestProcessedSequence = operationSequence;
      
      // Async processing of buffered messages
      _processBufferedMessages((bufferedMsg) => {
        console.log('[Content] Processing buffered QUICK_TAB_STATE_UPDATED:', {
          quickTabId: bufferedMsg.quickTabId,
          operationSequence: bufferedMsg.operationSequence
        });
        // Process buffered state update (logging only for now)
        return Promise.resolve();
      }).catch(err => {
        console.warn('[Content] Error processing buffered messages:', err.message);
      });
    }
    
    sendResponse({ received: true, processed: true, operationSequence });
    return true;
  },
  
  // v1.6.3.12 - FIX Issue #10: Handle PORT_HEARTBEAT_PING from background
  PORT_HEARTBEAT_PING: (message, sendResponse) => {
    const { heartbeatId, timestamp } = message;
    const latencyMs = Date.now() - timestamp;
    
    console.log('[Content] PORT_HEARTBEAT_PING received:', {
      heartbeatId,
      latencyMs,
      timestamp: Date.now()
    });
    
    // Respond to heartbeat
    sendResponse({
      type: 'PORT_HEARTBEAT_PONG',
      heartbeatId,
      receivedAt: Date.now(),
      latencyMs
    });
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
 * Check if message is intended for current tab
 * v1.6.3.11 - FIX Issue #40: Validate targetTabId before processing broadcast
 * @private
 * @param {Object} message - Message to validate
 * @returns {{ shouldProcess: boolean, reason: string }}
 */
function _shouldProcessMessageForThisTab(message) {
  // If message has no targetTabId, process it (legacy compatibility)
  if (message.targetTabId === undefined || message.targetTabId === null) {
    return { shouldProcess: true, reason: 'no-target-specified' };
  }

  // Get current tab ID
  const currentTabId = quickTabsManager?.currentTabId ?? null;

  // If we don't know our tab ID yet, process to be safe
  if (currentTabId === null) {
    return { shouldProcess: true, reason: 'current-tab-id-unknown' };
  }

  // Check if message is for this tab
  if (message.targetTabId !== currentTabId) {
    console.log(
      '[Content] BROADCAST_IGNORED: targetTabId',
      message.targetTabId,
      '!= currentTabId',
      currentTabId
    );
    return { shouldProcess: false, reason: 'target-mismatch' };
  }

  return { shouldProcess: true, reason: 'target-matches' };
}

/**
 * Main message dispatcher
 * Routes messages to appropriate handler based on action or type
 * v1.6.3.5-v10 - FIX Issue #3: Added entry/exit logging for message tracing
 * v1.6.3.11 - FIX Issue #40: Add targetTabId validation for broadcasts
 * @private
 */
function _dispatchMessage(message, _sender, sendResponse) {
  // v1.6.3.5-v10 - FIX Issue #3: Log all incoming messages for diagnostic tracing
  console.log('[Content] Message received:', {
    action: message.action || 'none',
    type: message.type || 'none',
    hasData: !!message.data
  });

  // v1.6.3.11 - FIX Issue #40: Check if message is intended for this tab
  const targetCheck = _shouldProcessMessageForThisTab(message);
  if (!targetCheck.shouldProcess) {
    // Message not for this tab - silently acknowledge
    sendResponse({ success: true, ignored: true, reason: targetCheck.reason });
    return true;
  }

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

// ==================== v1.6.3.11-v3 FIX ISSUE #1 & #6: STORAGE.ONCHANGED LISTENER ====================
// Issue #1: Content script state sync via storage.onChanged
// Issue #6: Cross-tab state propagation (<500ms)

/**
 * Debounce timer for storage change handling
 * v1.6.3.11-v3 - FIX Issue #70: Prevent cascading updates
 */
let storageChangeDebounceTimer = null;

/**
 * Debounce interval for storage changes (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #70
 */
const STORAGE_CHANGE_DEBOUNCE_MS = 100;

/**
 * Handle storage changes to sync state across tabs
 * v1.6.3.11-v3 - FIX Issue #1: React to storage updates for cross-tab sync
 * v1.6.3.11-v3 - FIX Issue #6: Ensure <500ms propagation
 * v1.6.3.11-v6 - FIX Issue #3: Enhanced logging with [Content][STORAGE_SYNC] prefix
 *
 * @param {Object} changes - Storage changes object
 * @param {string} areaName - Storage area that changed ('local', 'sync', 'session')
 */
function _handleStorageChange(changes, areaName) {
  const startTime = Date.now();

  // Only handle local storage changes (Quick Tab state)
  if (areaName !== 'local') {
    return;
  }

  // Check for Quick Tab state changes
  const stateChange = changes['quick_tabs_state_v2'];
  if (!stateChange) {
    return;
  }

  const newValue = stateChange.newValue;
  const oldValue = stateChange.oldValue;

  // v1.6.3.11-v6 - FIX Issue #3: Enhanced logging with timestamps
  console.log('[Content][STORAGE_SYNC] Storage change detected:', {
    hasNewValue: !!newValue,
    hasOldValue: !!oldValue,
    newTabCount: newValue?.tabs?.length ?? 0,
    oldTabCount: oldValue?.tabs?.length ?? 0,
    saveId: newValue?.saveId,
    writeSourceId: newValue?.writeSourceId?.substring(0, 16),
    timestamp: startTime
  });

  // v1.6.3.11-v3 - FIX Issue #70: Debounce rapid storage changes
  if (storageChangeDebounceTimer) {
    clearTimeout(storageChangeDebounceTimer);
  }

  storageChangeDebounceTimer = setTimeout(() => {
    storageChangeDebounceTimer = null;
    _processStorageChange(newValue, oldValue, startTime);
  }, STORAGE_CHANGE_DEBOUNCE_MS);
}

/**
 * Trigger hydration from storage change
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processStorageChange complexity
 * v1.6.3.11-v6 - FIX Issue #3: Enhanced logging with [Content][STORAGE_SYNC] prefix
 * @private
 */
function _triggerHydrationFromStorageChange() {
  if (!quickTabsManager?.hydrateFromStorage) {
    console.log('[Content][STORAGE_SYNC] Hydration skipped: manager not available');
    return;
  }

  const startTime = Date.now();
  console.log('[Content][STORAGE_SYNC] Triggering hydration from storage change');

  quickTabsManager
    .hydrateFromStorage()
    .then(() => {
      const duration = Date.now() - startTime;
      console.log('[Content][STORAGE_SYNC] Hydration completed:', {
        durationMs: duration,
        timestamp: Date.now()
      });
    })
    .catch(err => {
      console.warn('[Content][STORAGE_SYNC] Hydration failed:', err.message);
    });
}

/**
 * Emit storage change event to listeners
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce _processStorageChange complexity
 * @private
 * @param {Array} newTabs - New tabs array
 * @param {Array} oldTabs - Old tabs array
 */
function _emitStorageChangeEvent(newTabs, oldTabs) {
  if (typeof eventBus === 'undefined' || !eventBus.emit) return;

  eventBus.emit('storage:changed', {
    newTabs,
    oldTabs,
    timestamp: Date.now()
  });
}

/**
 * Process storage change after debounce
 * v1.6.3.11-v3 - FIX Code Health: Extracted to reduce nesting depth
 * v1.6.3.11-v4 - FIX Code Health: Extracted helpers to reduce complexity (cc=11→4)
 * v1.6.3.11-v6 - FIX Issue #3: Added timing tracking for <500ms validation
 * @private
 * @param {Object} newValue - New storage value
 * @param {Object} oldValue - Previous storage value
 * @param {number} detectionTime - Timestamp when change was detected
 */
function _processStorageChange(newValue, oldValue, detectionTime) {
  const processStartTime = Date.now();
  const debounceDelay = processStartTime - detectionTime;

  if (!newValue) {
    console.log('[Content][STORAGE_SYNC] State cleared from storage');
    return;
  }

  const newTabs = newValue.tabs || [];
  const oldTabs = oldValue?.tabs || [];

  console.log('[Content][STORAGE_SYNC] Processing state change:', {
    newTabCount: newTabs.length,
    oldTabCount: oldTabs.length,
    timestamp: newValue.timestamp,
    writeSourceId: newValue.writeSourceId?.substring(0, 16),
    debounceDelayMs: debounceDelay,
    processStartTime
  });

  _triggerHydrationFromStorageChange();
  _emitStorageChangeEvent(newTabs, oldTabs);

  const totalDuration = Date.now() - detectionTime;
  console.log('[Content][STORAGE_SYNC] Processing complete:', {
    totalDurationMs: totalDuration,
    withinTarget: totalDuration < 500,
    timestamp: Date.now()
  });
}

// Register storage.onChanged listener (once during module load)
// v1.6.3.11-v6 - FIX Issue #3: Enhanced logging for storage listener registration
if (typeof browser !== 'undefined' && browser.storage?.onChanged) {
  browser.storage.onChanged.addListener(_handleStorageChange);
  console.log('[Content][STORAGE_SYNC] ✓ storage.onChanged listener registered:', {
    api: 'browser.storage.onChanged',
    key: 'quick_tabs_state_v2',
    purpose: 'cross-tab-sync',
    timestamp: Date.now()
  });
} else {
  console.warn('[Content][STORAGE_SYNC] ⚠ storage.onChanged not available:', {
    hasBrowser: typeof browser !== 'undefined',
    hasStorage: typeof browser !== 'undefined' && !!browser.storage,
    timestamp: Date.now()
  });
}

// ==================== END STORAGE.ONCHANGED LISTENER ====================

// ==================== v1.6.3.11-v3 FIX ISSUE #5: ERROR RECOVERY MECHANISM ====================
// Track hover detection failures and implement exponential backoff

/**
 * Error counter for hover detection failures
 * v1.6.3.11-v3 - FIX Issue #5
 */
let hoverErrorCounter = 0;

/**
 * Timestamp of first error in current window
 * v1.6.3.11-v3 - FIX Issue #5
 */
let hoverErrorWindowStart = 0;

/**
 * Error threshold before notification (5 errors in 10 seconds)
 * v1.6.3.11-v3 - FIX Issue #5
 */
const HOVER_ERROR_THRESHOLD = 5;

/**
 * Error window duration (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #5
 */
const HOVER_ERROR_WINDOW_MS = 10000;

/**
 * Current backoff delay (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #5: Starts at 100ms, doubles on each failure
 */
let hoverBackoffDelay = 100;

/**
 * Maximum backoff delay (milliseconds)
 * v1.6.3.11-v3 - FIX Issue #5
 */
const MAX_HOVER_BACKOFF_MS = 5000;

/**
 * Flag to indicate if recovery mode is active
 * v1.6.3.11-v3 - FIX Issue #5
 */
let isInRecoveryMode = false;

/**
 * Record a hover detection error
 * v1.6.3.11-v3 - FIX Issue #5
 * @param {Error} error - The error that occurred
 */
function _recordHoverError(error) {
  const now = Date.now();

  // Reset window if expired
  if (now - hoverErrorWindowStart > HOVER_ERROR_WINDOW_MS) {
    hoverErrorCounter = 0;
    hoverErrorWindowStart = now;
  }

  hoverErrorCounter++;

  // v1.6.3.11-v5 - FIX Issue #7: Use correct logging prefix
  console.warn('[Content] HOVER_ERROR_RECORDED:', {
    errorCount: hoverErrorCounter,
    threshold: HOVER_ERROR_THRESHOLD,
    windowMs: HOVER_ERROR_WINDOW_MS,
    currentBackoffMs: hoverBackoffDelay,
    error: error?.message || 'Unknown error',
    timestamp: now
  });

  // Check if threshold exceeded
  if (hoverErrorCounter >= HOVER_ERROR_THRESHOLD && !isInRecoveryMode) {
    _enterRecoveryMode();
  }

  // Apply exponential backoff
  hoverBackoffDelay = Math.min(hoverBackoffDelay * 2, MAX_HOVER_BACKOFF_MS);
}

/**
 * Reset error counter on successful detection
 * v1.6.3.11-v3 - FIX Issue #5
 * v1.6.3.11-v5 - FIX Issue #7: Called on successful URL detection
 */
function _resetHoverErrors() {
  if (hoverErrorCounter > 0) {
    console.log('[Content] HOVER_ERRORS_RESET: Successful detection - resetting error counter', {
      previousCount: hoverErrorCounter,
      previousBackoffMs: hoverBackoffDelay,
      timestamp: Date.now()
    });
  }
  hoverErrorCounter = 0;
  hoverBackoffDelay = 100; // Reset backoff
  isInRecoveryMode = false;
}

/**
 * Enter recovery mode when error threshold exceeded
 * v1.6.3.11-v3 - FIX Issue #5
 * v1.6.3.11-v5 - FIX Issue #7: Send diagnostic message to background
 * @private
 */
function _enterRecoveryMode() {
  isInRecoveryMode = true;

  // v1.6.3.11-v5 - FIX Issue #7: Use correct logging prefix
  console.error('[Content] HOVER_THRESHOLD_EXCEEDED: Entering recovery mode', {
    errorCount: hoverErrorCounter,
    threshold: HOVER_ERROR_THRESHOLD,
    backoffMs: hoverBackoffDelay,
    timestamp: Date.now()
  });

  // v1.6.3.11-v5 - FIX Issue #7: Send diagnostic message to background
  _sendHoverDiagnosticToBackground();

  // Notify user via console (and toast if available)
  const message = 'Copy URL on Hover: Experiencing connection issues. Auto-recovering...';
  console.warn(`[Content] HOVER_RECOVERY_NOTIFICATION: ${message}`);

  // Try to show notification to user
  // v1.6.3.11-v4 - FIX Code Review: Handle Promise from showToast (non-blocking)
  _tryShowRecoveryNotification(message);

  // Schedule recovery attempt
  setTimeout(() => {
    console.log('[Content] HOVER_RECOVERY_ATTEMPT: Attempting recovery after backoff', {
      backoffMs: hoverBackoffDelay,
      timestamp: Date.now()
    });
    isInRecoveryMode = false;
  }, hoverBackoffDelay);
}

/**
 * Send hover diagnostic message to background
 * v1.6.3.11-v5 - FIX Issue #7
 * @private
 */
function _sendHoverDiagnosticToBackground() {
  try {
    browser.runtime.sendMessage({
      action: 'HOVER_DIAGNOSTIC',
      data: {
        errorCount: hoverErrorCounter,
        threshold: HOVER_ERROR_THRESHOLD,
        windowMs: HOVER_ERROR_WINDOW_MS,
        backoffMs: hoverBackoffDelay,
        userAgent: navigator.userAgent,
        url: window.location.href.substring(0, 100),
        timestamp: Date.now()
      }
    }).catch(() => {
      // Non-critical - just log locally
      console.debug('[Content] HOVER_DIAGNOSTIC: Failed to send to background');
    });
  } catch (_e) {
    // Non-critical diagnostic
  }
}

/**
 * Try to show recovery notification (non-blocking)
 * v1.6.3.11-v4 - FIX Code Health: Extracted to reduce nesting depth
 * @private
 */
function _tryShowRecoveryNotification(message) {
  if (!notificationManager?.showToast) {
    return;
  }

  try {
    const toastPromise = notificationManager.showToast(message, 'warning');
    if (toastPromise?.catch) {
      toastPromise.catch(_err => {
        // Already handled by fallback in toast.js
      });
    }
  } catch (_e) {
    // Fallback to console only (handled above)
  }
}

/**
 * Check if we should skip due to recovery backoff
 * v1.6.3.11-v3 - FIX Issue #5
 * @returns {boolean} True if should skip this operation
 */
function _shouldSkipForRecovery() {
  return isInRecoveryMode;
}

// ==================== END ERROR RECOVERY MECHANISM ====================

// ==================== v1.6.3.11-v5 FIX ISSUE #5: HANDLER RESPONSE ERROR CHECKING ====================
// Check handler response success field and implement retry logic for transient failures

/**
 * Transient error types that should trigger retry
 * v1.6.3.11-v5 - FIX Issue #5
 */
const TRANSIENT_ERROR_TYPES = ['TIMEOUT', 'NETWORK', 'VERSION_MISMATCH', 'TRANSIENT'];

/**
 * Handler retry configuration
 * v1.6.3.11-v5 - FIX Issue #5
 */
const HANDLER_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000
};

/**
 * Check if an error is transient and should trigger retry
 * v1.6.3.11-v5 - FIX Issue #5
 * @private
 * @param {Object} response - Handler response
 * @returns {boolean} True if error is transient
 */
function _isTransientHandlerError(response) {
  if (!response || response.success !== false) return false;
  
  const errorType = response.errorType || response.error?.type || '';
  const errorMessage = response.error?.message || response.errorMessage || '';
  
  // Check error type
  if (TRANSIENT_ERROR_TYPES.includes(errorType.toUpperCase())) {
    return true;
  }
  
  // Check error message patterns
  const transientPatterns = ['timeout', 'network', 'connection', 'temporary', 'retry'];
  return transientPatterns.some(pattern => errorMessage.toLowerCase().includes(pattern));
}

/**
 * Calculate retry delay with exponential backoff
 * v1.6.3.11-v5 - FIX Issue #5
 * @private
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function _calculateHandlerRetryDelay(attempt) {
  const delay = HANDLER_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, HANDLER_RETRY_CONFIG.maxDelayMs);
}

/**
 * Log handler response error with full context
 * v1.6.3.11-v5 - FIX Issue #5
 * @private
 * @param {string} operation - Operation name (e.g., 'CREATE_QUICK_TAB')
 * @param {Object} response - Handler response
 * @param {Object} context - Additional context (quickTabId, etc.)
 */
function _logHandlerResponseError(operation, response, context = {}) {
  console.error('[Content] HANDLER_RESPONSE_ERROR:', {
    operation,
    success: response?.success,
    errorType: response?.errorType || response?.error?.type,
    errorMessage: response?.error?.message || response?.errorMessage,
    errorCode: response?.errorCode || response?.error?.code,
    quickTabId: context.quickTabId,
    originTabId: context.originTabId,
    timestamp: Date.now(),
    isTransient: _isTransientHandlerError(response)
  });
}

/**
 * Process handler response and handle errors
 * v1.6.3.11-v5 - FIX Issue #5
 * @param {Object} response - Handler response
 * @param {string} operation - Operation name
 * @param {Object} context - Context for error logging
 * @returns {{success: boolean, shouldRetry: boolean, response: Object}}
 */
function _processHandlerResponse(response, operation, context = {}) {
  // No response indicates a send failure (different from handler error)
  if (!response) {
    console.warn('[Content] HANDLER_RESPONSE_ERROR: No response received', {
      operation,
      ...context,
      timestamp: Date.now()
    });
    return { success: false, shouldRetry: true, response: null };
  }
  
  // Success case
  if (response.success !== false) {
    return { success: true, shouldRetry: false, response };
  }
  
  // Handler returned error
  _logHandlerResponseError(operation, response, context);
  
  const shouldRetry = _isTransientHandlerError(response);
  return { success: false, shouldRetry, response };
}

/**
 * Show error notification to user for handler failures
 * v1.6.3.11-v5 - FIX Issue #5
 * @private
 * @param {string} operation - Operation that failed
 * @param {Object} response - Handler response
 */
function _showHandlerErrorNotification(operation, response) {
  const operationNames = {
    CREATE_QUICK_TAB: 'create Quick Tab',
    CLOSE_QUICK_TAB: 'close Quick Tab',
    UPDATE_QUICK_TAB: 'update Quick Tab',
    openTab: 'open tab'
  };
  
  const friendlyName = operationNames[operation] || operation;
  const errorMessage = response?.error?.message || response?.errorMessage || 'Unknown error';
  
  _showNotificationWithVerification(
    `✗ Failed to ${friendlyName}: ${errorMessage.substring(0, 50)}`,
    'error'
  );
}

// ==================== END ISSUE #5 FIX ====================

// ==================== v1.6.3.11-v5 FIX ISSUE #6: NOTIFICATION DELIVERY VERIFICATION ====================
// Verify toast notifications are delivered and retry on failure

/**
 * Notification delivery configuration
 * v1.6.3.11-v5 - FIX Issue #6
 */
const NOTIFICATION_RETRY_DELAY_MS = 500;
const NOTIFICATION_MAX_RETRIES = 2;

/**
 * Notification success tracking
 * v1.6.3.11-v5 - FIX Issue #6
 */
let notificationSuccessCount = 0;
let notificationFailureCount = 0;

/**
 * Show notification with delivery verification and retry
 * v1.6.3.11-v5 - FIX Issue #6
 * @param {string} message - Notification message
 * @param {string} type - Notification type (info, success, warning, error)
 * @param {number} retryCount - Current retry attempt (internal)
 */
function _showNotificationWithVerification(message, type = 'info', retryCount = 0) {
  debug('Notification with verification:', message, type);
  
  if (!notificationManager) {
    console.warn('[Content] NOTIFICATION_DELIVERY_FAILED: Manager not initialized', {
      message: message.substring(0, 50),
      type,
      timestamp: Date.now()
    });
    notificationFailureCount++;
    return;
  }
  
  // Use showToast directly to get return value (showNotification doesn't return)
  let result;
  try {
    // Check if we should use toast mode based on config
    if (notificationManager.config?.notifDisplayMode === 'tooltip') {
      // Tooltip mode - no verification available
      notificationManager.showTooltip(message);
      notificationSuccessCount++;
      return;
    }
    
    // Toast mode - get verification result
    result = notificationManager.showToast(message, type);
  } catch (err) {
    result = { success: false, error: err.message };
  }
  
  // Check delivery success
  if (result?.success) {
    notificationSuccessCount++;
    
    // Log success rate periodically (every 10 notifications)
    if ((notificationSuccessCount + notificationFailureCount) % 10 === 0) {
      console.log('[Content] NOTIFICATION_SUCCESS_RATE:', {
        success: notificationSuccessCount,
        failure: notificationFailureCount,
        rate: `${((notificationSuccessCount / (notificationSuccessCount + notificationFailureCount)) * 100).toFixed(1)}%`
      });
    }
    return;
  }
  
  // Delivery failed
  notificationFailureCount++;
  console.warn('[Content] NOTIFICATION_DELIVERY_FAILED:', {
    message: message.substring(0, 50),
    type,
    error: result?.error || 'Unknown error',
    retryCount,
    timestamp: Date.now()
  });
  
  // Retry if under max retries
  if (retryCount < NOTIFICATION_MAX_RETRIES) {
    console.log('[Content] NOTIFICATION_RETRY:', {
      message: message.substring(0, 50),
      type,
      retryCount: retryCount + 1,
      delayMs: NOTIFICATION_RETRY_DELAY_MS
    });
    
    setTimeout(() => {
      _showNotificationWithVerification(message, type, retryCount + 1);
    }, NOTIFICATION_RETRY_DELAY_MS);
  } else {
    // Max retries exceeded - fallback to console
    console.warn(`[Content] NOTIFICATION_FALLBACK: ${type.toUpperCase()}: ${message}`);
  }
}

// ==================== END ISSUE #6 FIX ====================

// ==================== BEFOREUNLOAD CLEANUP HANDLER ====================
// v1.6.3.4-v11 - FIX Issue #3: Cleanup resources on page navigation to prevent memory leaks
// This handler ensures storage listeners and other resources are properly released
// Note: Content scripts are injected once per page load, but we add a guard for safety

/**
 * Reset all initialization flags on navigation
 * v1.6.3.11 - FIX Issue #34: Reset initialization flags on beforeunload
 * @private
 * @returns {number} Count of flags that were reset
 */
function _resetInitializationFlags() {
  let flagsReset = 0;

  // Reset contentScriptInitialized
  if (contentScriptInitialized) {
    contentScriptInitialized = false;
    flagsReset++;
  }

  // Reset isHydrationComplete
  if (isHydrationComplete) {
    isHydrationComplete = false;
    flagsReset++;
  }

  // Reset isBackgroundReady
  if (isBackgroundReady) {
    isBackgroundReady = false;
    flagsReset++;
  }

  // Reset portListenersRegistered
  if (portListenersRegistered) {
    portListenersRegistered = false;
    flagsReset++;
  }

  return flagsReset;
}

/**
 * Handler for beforeunload event to cleanup resources
 * v1.6.3.10-v13 - FIX Issue #9: Also stop periodic latency measurement
 * v1.6.3.11 - FIX Issue #34: Reset initialization flags on navigation
 * v1.6.3.11-v3 - FIX Issue #19: Clear pendingRestoreOperations to prevent memory leaks
 * v1.6.3.11-v3 - FIX Issue #33: Stop pending message garbage collection
 * @private
 */
function _handleBeforeUnload() {
  console.log('[Content] beforeunload event - starting cleanup');

  // v1.6.3.11 - FIX Issue #34: Reset initialization flags on navigation
  const flagsReset = _resetInitializationFlags();
  if (flagsReset > 0) {
    console.log('[Content] STATE_RESET_ON_NAVIGATION:', flagsReset, 'flags reset');
  }

  // v1.6.3.11-v3 - FIX Issue #19: Clear pendingRestoreOperations to prevent memory leaks
  // This Map can grow unbounded across rapid tab switches if not cleaned up
  if (pendingRestoreOperations && pendingRestoreOperations.size > 0) {
    console.log('[Content] CLEANUP_PENDING_OPERATIONS:', {
      pendingRestoreOperations: pendingRestoreOperations.size,
      timestamp: Date.now()
    });
    pendingRestoreOperations.clear();
  }

  // v1.6.3.11-v3 - FIX Issue #19: Also clear the restore operation queue
  if (typeof restoreOperationQueue !== 'undefined' && restoreOperationQueue.length > 0) {
    console.log('[Content] CLEANUP_RESTORE_QUEUE:', {
      queueSize: restoreOperationQueue.length
    });
    restoreOperationQueue.length = 0;
  }

  // v1.6.3.10-v13 - FIX Issue #9: Stop periodic latency measurement
  stopPeriodicLatencyMeasurement();

  // v1.6.3.11-v3 - FIX Issue #33: Stop periodic maintenance (heartbeat + GC)
  _stopPeriodicMaintenance();

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
