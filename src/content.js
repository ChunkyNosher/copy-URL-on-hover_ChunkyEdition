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

// v1.6.3.11-v9 - FIX Issue C: Identity initialization logging marker
console.log('[IDENTITY_INIT] SCRIPT_LOAD: Content script loaded, identity not yet initialized', {
  timestamp: new Date().toISOString(),
  phase: 'SCRIPT_LOAD'
});

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
// v1.6.3.11-v11 - FIX Issue #47: Import setWritingContainerId for container isolation
// v1.6.3.12-v3 - FIX Issue E: Import TAB_ID_CALLER_CONTEXT to identify caller context
// v1.6.4-v4 - FIX Issue #47 Container Filter: Import getWritingContainerId for originContainerId in Quick Tab creation
import {
  setWritingTabId,
  isWritingTabIdInitialized,
  setWritingContainerId,
  getWritingContainerId,
  TAB_ID_CALLER_CONTEXT
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

// v1.6.3.10-v10 - FIX Code Review: Extract error strings as constants
// v1.6.3.10-v10 - FIX Code Review: Use Set for O(1) lookup performance
const RETRYABLE_ERROR_CODES = new Set(['NOT_INITIALIZED', 'GLOBAL_STATE_NOT_READY']);
// v1.6.3.12-v7 - FIX Code Review: Convert to Set for O(1) lookup and consistency
const RETRYABLE_MESSAGE_PATTERNS = new Set(['disconnected', 'receiving end', 'Extension context']);

// ==================== v1.6.3.12-v7 FIX ISSUE #14: MESSAGE QUEUE DURING INIT ====================
// Queue messages while content script initializes to prevent lost messages

/**
 * Track whether content script initialization is complete
 * v1.6.3.12-v7 - FIX Issue #14: Initialization tracking
 */
let contentScriptInitialized = false;

/**
 * Message queue for messages sent during initialization window
 * v1.6.3.12-v7 - FIX Issue #14: Queue messages during init
 */
const initializationMessageQueue = [];

/**
 * Maximum queue size for initialization messages
 * v1.6.3.12-v7 - FIX Issue #14
 */
const MAX_INIT_MESSAGE_QUEUE_SIZE = 20;

/**
 * Background unresponsive timeout (ms)
 * v1.6.3.12-v7 - FIX Issue #14: Timeout-based fallback if background unresponsive
 */
const BACKGROUND_UNRESPONSIVE_TIMEOUT_MS = 5000;

/**
 * Track last successful background response time
 * v1.6.3.12-v7 - FIX Issue #14
 */
let lastBackgroundResponseTime = Date.now();

/**
 * Check if a message has valid format for sending
 * v1.6.3.12-v7 - FIX Issue #14: Pre-flight validation
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
 * v1.6.3.12-v7 - FIX Issue #14: Queue messages during init
 * @param {Object} message - Message to queue
 * @param {Function} callback - Callback to execute when message can be sent
 */
function _queueInitializationMessage(message, callback) {
  if (initializationMessageQueue.length >= MAX_INIT_MESSAGE_QUEUE_SIZE) {
    const dropped = initializationMessageQueue.shift();
    console.warn('[MSG][Content] INIT_QUEUE_OVERFLOW: Dropped oldest message:', {
      droppedAction: dropped?.message?.action,
      queueSize: initializationMessageQueue.length
    });
  }

  initializationMessageQueue.push({
    message,
    callback,
    queuedAt: Date.now()
  });

  console.log('[MSG][Content] MESSAGE_QUEUED_DURING_INIT:', {
    action: message.action || message.type,
    queueSize: initializationMessageQueue.length
  });
}

/**
 * Flush queued messages after initialization completes
 * v1.6.3.12-v7 - FIX Issue #14: Process queued messages
 */
async function _flushInitializationMessageQueue() {
  if (initializationMessageQueue.length === 0) return;

  console.log('[MSG][Content] FLUSHING_INIT_MESSAGE_QUEUE:', {
    queueSize: initializationMessageQueue.length
  });

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
 * v1.6.3.12-v7 - FIX Issue #14: Timeout-based fallback
 * @returns {boolean} True if background is responsive
 */
function _isBackgroundResponsive() {
  const timeSinceLastResponse = Date.now() - lastBackgroundResponseTime;
  return timeSinceLastResponse < BACKGROUND_UNRESPONSIVE_TIMEOUT_MS;
}

/**
 * Update last background response time
 * v1.6.3.12-v7 - FIX Issue #14
 */
function _updateBackgroundResponseTime() {
  lastBackgroundResponseTime = Date.now();
}

/**
 * Mark content script as initialized and flush queued messages
 * v1.6.3.12-v7 - FIX Issue #14
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
 * v1.6.3.12-v7 - FIX Code Review: Use Set.forEach with short-circuit for O(1) average lookup
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
 * Extract tab ID and container ID from response, supporting both v1 and v2 formats
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce nesting depth
 * v1.6.3.11-v11 - FIX Issue #47: Also extract cookieStoreId for container isolation
 * @private
 * @param {Object} response - Response from GET_CURRENT_TAB_ID
 * @returns {{found: boolean, tabId?: number, cookieStoreId?: string|null, format?: string}}
 */
function _extractTabIdFromResponse(response) {
  if (!response?.success) {
    return { found: false };
  }

  // v1.6.3.12-v7 - Support both new format (data.currentTabId) and old format (tabId)
  const tabId = response.data?.currentTabId ?? response.tabId;
  if (typeof tabId !== 'number') {
    return { found: false };
  }

  // v1.6.3.11-v11 - FIX Issue #47: Extract cookieStoreId for container isolation
  const cookieStoreId = response.data?.cookieStoreId ?? response.cookieStoreId ?? null;

  const format = response.data ? 'v2 (data.currentTabId)' : 'v1 (tabId)';
  return { found: true, tabId, cookieStoreId, format };
}

/**
 * Single attempt to get tab ID and container ID from background
 * v1.6.3.10-v10 - FIX Issue #5: Extracted to support retry logic
 * v1.6.3.12-v7 - FIX Issue #15: Check response.success and response.data
 * v1.6.3.11-v11 - FIX Issue #47: Also return cookieStoreId for container isolation
 * @private
 * @param {number} attemptNumber - Current attempt number (1-based)
 * @returns {Promise<{tabId: number|null, cookieStoreId: string|null, error: string|null, retryable: boolean}>}
 */
async function _attemptGetTabIdFromBackground(attemptNumber) {
  const startTime = Date.now();

  try {
    const response = await browser.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' });
    const duration = Date.now() - startTime;

    // v1.6.3.12-v7 - FIX Issue #15: Check response.success first
    // v1.6.3.12-v7 - FIX Code Health: Extract tabId handling to avoid nested depth
    const tabIdResult = _extractTabIdFromResponse(response);
    if (tabIdResult.found) {
      // v1.6.3.11-v11 - FIX Issue #47: Also log cookieStoreId
      console.log('[Content][TabID][INIT] ATTEMPT_SUCCESS:', {
        attempt: attemptNumber,
        tabId: tabIdResult.tabId,
        cookieStoreId: tabIdResult.cookieStoreId,
        responseFormat: tabIdResult.format,
        durationMs: duration
      });
      return {
        tabId: tabIdResult.tabId,
        cookieStoreId: tabIdResult.cookieStoreId,
        error: null,
        retryable: false
      };
    }

    // Check if error is retryable (background not initialized yet)
    const isRetryable = _isRetryableResponse(response);

    console.warn('[Content][TabID][INIT] ATTEMPT_FAILED:', {
      attempt: attemptNumber,
      response,
      error: response?.error,
      code: response?.code, // v1.6.3.12-v7 - Log error code
      retryable: isRetryable,
      durationMs: duration
    });

    return {
      tabId: null,
      cookieStoreId: null,
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
      cookieStoreId: null,
      error: err.message,
      retryable: isRetryable
    };
  }
}

/**
 * Log successful tab ID acquisition
 * v1.6.3.11-v9 - FIX Code Health: Extracted from getCurrentTabIdFromBackground
 * v1.6.3.11-v11 - FIX Issue #47: Also log cookieStoreId
 * @private
 * @param {number} tabId - The acquired tab ID
 * @param {string|null} cookieStoreId - The container ID (if available)
 * @param {number} durationMs - Total duration in milliseconds
 * @param {number|null} attemptNumber - Attempt number (null for first attempt)
 */
function _logTabIdAcquisitionSuccess(tabId, cookieStoreId, durationMs, attemptNumber) {
  const isFirstAttempt = attemptNumber === null;
  const message = isFirstAttempt
    ? 'Tab ID received on first attempt'
    : 'Tab ID received after retry';

  console.log(`[IDENTITY_INIT] TAB_ID_RESPONSE: ${message}`, {
    tabId,
    cookieStoreId,
    ...(attemptNumber !== null && { attemptNumber }),
    durationMs,
    timestamp: new Date().toISOString(),
    phase: 'TAB_ID_RESPONSE'
  });

  console.log(
    `[Content][TabID][INIT] COMPLETE: Tab ID acquired ${isFirstAttempt ? 'on first attempt' : 'on retry'}`,
    {
      tabId,
      cookieStoreId,
      ...(attemptNumber !== null && { attemptNumber }),
      totalDurationMs: durationMs
    }
  );
}

/**
 * Log failed tab ID acquisition after all retries exhausted
 * v1.6.3.11-v9 - FIX Code Health: Extracted from getCurrentTabIdFromBackground
 * @private
 * @param {string} lastError - The last error message
 * @param {number} totalDurationMs - Total duration in milliseconds
 */
function _logTabIdAcquisitionFailure(lastError, totalDurationMs) {
  console.error('[IDENTITY_INIT] TAB_ID_FAILED: All retries exhausted', {
    totalAttempts: TAB_ID_MAX_RETRIES + 1,
    lastError,
    totalDurationMs,
    timestamp: new Date().toISOString(),
    phase: 'TAB_ID_FAILED'
  });

  console.error('[Content][TabID][INIT] FAILED: All retries exhausted', {
    totalAttempts: TAB_ID_MAX_RETRIES + 1,
    lastError,
    totalDurationMs,
    timestamp: new Date().toISOString()
  });
}

/**
 * Execute retry loop for tab ID acquisition
 * v1.6.3.11-v9 - FIX Code Health: Extracted from getCurrentTabIdFromBackground
 * v1.6.3.11-v11 - FIX Issue #47: Also return cookieStoreId
 * @private
 * @param {Object} initialResult - Result from first attempt
 * @param {number} overallStartTime - Start time for duration tracking
 * @returns {Promise<{tabId: number|null, cookieStoreId: string|null, error: string|null}>}
 */
async function _executeTabIdRetryLoop(initialResult, overallStartTime) {
  let result = initialResult;

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
      break;
    }

    console.log('[Content][TabID][INIT] RETRY_SCHEDULED:', {
      retryNumber: retryIndex + 1,
      attemptNumber,
      delayMs,
      previousError: result.error,
      elapsedMs: Date.now() - overallStartTime
    });

    await new Promise(resolve => setTimeout(resolve, delayMs));
    result = await _attemptGetTabIdFromBackground(attemptNumber);

    if (result.tabId !== null) {
      _logTabIdAcquisitionSuccess(
        result.tabId,
        result.cookieStoreId,
        Date.now() - overallStartTime,
        attemptNumber
      );
      return { tabId: result.tabId, cookieStoreId: result.cookieStoreId, error: null };
    }
  }

  return { tabId: null, cookieStoreId: null, error: result.error };
}

/**
 * Get current tab ID from background script with exponential backoff retry
 * v1.6.3.5-v10 - FIX Issue #3: Content scripts cannot use browser.tabs.getCurrent()
 * Must send message to background script which has access to sender.tab.id
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #1: Add validation logging
 * v1.6.3.10-v10 - FIX Issue #5: Implement exponential backoff retry loop
 * v1.6.3.11-v9 - FIX Issue C: Add [IDENTITY_INIT] logging markers
 * v1.6.3.11-v9 - FIX Code Health: Extracted helpers to reduce function length
 * v1.6.3.11-v11 - FIX Issue #47: Also return cookieStoreId for container isolation
 *
 * Retry delays: 200ms, 500ms, 1500ms, 5000ms
 * Maximum 5 attempts (initial + 4 retries)
 *
 * @returns {Promise<{tabId: number|null, cookieStoreId: string|null}>} Current tab ID and container ID or nulls if all retries exhausted
 */
async function getCurrentTabIdFromBackground() {
  console.log('[IDENTITY_INIT] TAB_ID_REQUEST: Requesting tab ID from background', {
    timestamp: new Date().toISOString(),
    phase: 'TAB_ID_REQUEST'
  });

  console.log('[Content][TabID][INIT] BEGIN: Starting tab ID acquisition with retry', {
    maxRetries: TAB_ID_MAX_RETRIES,
    retryDelays: TAB_ID_RETRY_DELAYS_MS,
    timestamp: new Date().toISOString()
  });

  const overallStartTime = Date.now();

  // Initial attempt (attempt #1)
  const initialResult = await _attemptGetTabIdFromBackground(1);

  if (initialResult.tabId !== null) {
    _logTabIdAcquisitionSuccess(
      initialResult.tabId,
      initialResult.cookieStoreId,
      Date.now() - overallStartTime,
      null
    );
    return { tabId: initialResult.tabId, cookieStoreId: initialResult.cookieStoreId };
  }

  // Execute retry loop
  const retryResult = await _executeTabIdRetryLoop(initialResult, overallStartTime);

  if (retryResult.tabId !== null) {
    return { tabId: retryResult.tabId, cookieStoreId: retryResult.cookieStoreId };
  }

  // All retries exhausted
  _logTabIdAcquisitionFailure(retryResult.error, Date.now() - overallStartTime);
  return { tabId: null, cookieStoreId: null };
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
 * v1.6.3.11-v10 - FIX Issue #13: Track identity initialization state
 * This flag gates Quick Tab operations until identity is fully initialized
 * Set to true only AFTER getCurrentTabIdFromBackground() completes successfully
 */
let identityReady = false;

/**
 * v1.6.3.11-v10 - FIX Issue #13: Identity ready timeout (15 seconds)
 */
const IDENTITY_READY_TIMEOUT_MS = 15000;

/**
 * v1.6.3.11-v10 - FIX Issue #13: Promise that resolves when identity is ready
 * Used to block Quick Tab operations until identity is initialized
 */
let identityReadyPromise = null;
let identityReadyResolver = null;

/**
 * v1.6.3.10-v4 - FIX Issue #3/6: Track last known background startup time for restart detection
 */
let lastKnownBackgroundStartupTime = null;

// ==================== v1.6.3.10-v7 CIRCUIT BREAKER ====================
// FIX Issue #1: Circuit breaker state machine for port reconnection

/**
 * Circuit breaker states for port connection
 * v1.6.3.10-v7 - FIX Issue #1: Circuit breaker state machine
 */
const PORT_CONNECTION_STATE = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  FAILED: 'FAILED'
};

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

/**
 * Message ID counter for queue tracking
 * v1.6.3.10-v7 - FIX Issue #5
 */
let messageIdCounter = 0;

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
      ...details,
      reason: 'out-of-order: newer operation already pending',
      action: 'rejected'
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
    existingOperation: existingOperation
      ? {
          sequenceId: existingOperation.sequenceId,
          status: existingOperation.status,
          age: now - existingOperation.timestamp
        }
      : null,
    pendingCount: pendingRestoreOperations.size
  };

  // Check if should reject due to ordering
  if (_shouldRejectRestoreOrder(existingOperation, messageSequenceId, details)) {
    return { allowed: false, reason: 'out-of-order', details };
  }

  // Log if queued behind pending operation
  if (existingOperation && existingOperation.status === 'pending') {
    console.log('[Content] v1.6.3.10-v10 RESTORE_ORDER_QUEUED:', {
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

  const reconnectDelay = _calculateReconnectDelay();
  console.log('[Content] Scheduling reconnection:', {
    attempt: reconnectionAttempts,
    delayMs: reconnectDelay,
    reason
  });

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
    console.warn('[Content] CIRCUIT_BREAKER_OPEN: Refusing to reconnect', {
      attempts: reconnectionAttempts
    });
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
  // v1.6.3.12 - Option 4: Also cleanup Quick Tabs port
  if (quickTabsPort) {
    console.log('[Content] Disconnecting Quick Tabs port on unload');
    quickTabsPort.disconnect();
    quickTabsPort = null;
  }
});

// ==================== END PORT CONNECTION ====================

// ==================== v1.6.3.12 OPTION 4: QUICK TABS PORT MESSAGING ====================
// FIX: browser.storage.session does NOT exist in Firefox Manifest V2
// Content scripts communicate with background via 'quick-tabs-port' for Quick Tab operations

/**
 * Timeout for Quick Tabs port requests (5 seconds)
 * v1.6.3.12 - Option 4: Centralized timeout constant
 */
const QUICK_TABS_REQUEST_TIMEOUT_MS = 5000;

/**
 * Delay before attempting Quick Tabs port reconnection (1 second)
 * v1.6.3.12 - Option 4: Centralized reconnect delay constant
 */
const QUICK_TABS_RECONNECT_DELAY_MS = 1000;

/**
 * Port connection to background for Quick Tabs operations
 * v1.6.3.12 - Option 4: Replaces storage.session with port messaging
 */
let quickTabsPort = null;

/**
 * Local cache of Quick Tabs for this tab
 * v1.6.3.12 - Option 4: In-memory cache synchronized via port messaging
 * NOTE: Cache is updated optimistically before background confirms.
 * If background operation fails, cache may be inconsistent until next sync.
 */
const sessionQuickTabs = new Map();

/**
 * Pending requests waiting for responses
 * v1.6.3.12 - Option 4: Track request/response pairs
 */
const pendingQuickTabRequests = new Map();

/**
 * Request ID counter for pending requests
 */
let quickTabRequestIdCounter = 0;

/**
 * Query background with timeout
 * v1.6.3.12 - Option 4: Send request and wait for response
 * @param {string} messageType - Message type to send
 * @param {Object} payload - Additional payload
 * @param {number} timeoutMs - Timeout in milliseconds (default: QUICK_TABS_REQUEST_TIMEOUT_MS)
 * @returns {Promise<Object>} Response from background
 */
function queryQuickTabsBackground(
  messageType,
  payload = {},
  timeoutMs = QUICK_TABS_REQUEST_TIMEOUT_MS
) {
  return new Promise((resolve, reject) => {
    if (!quickTabsPort) {
      reject(new Error('Quick Tabs port not connected'));
      return;
    }

    const requestId = ++quickTabRequestIdCounter;
    const message = {
      type: messageType,
      requestId,
      timestamp: Date.now(),
      ...payload
    };

    // Set up timeout
    const timeoutId = setTimeout(() => {
      pendingQuickTabRequests.delete(requestId);
      reject(new Error(`Quick Tabs request timeout: ${messageType}`));
    }, timeoutMs);

    // Store pending request
    pendingQuickTabRequests.set(requestId, {
      resolve,
      reject,
      timeoutId,
      messageType
    });

    try {
      quickTabsPort.postMessage(message);
      console.log(`[Content] Sending message to background: ${messageType}`, { requestId });
    } catch (err) {
      clearTimeout(timeoutId);
      pendingQuickTabRequests.delete(requestId);
      reject(err);
    }
  });
}

/**
 * Check if message is a sidebar command
 * v1.6.3.12-v2 - FIX Code Health: Extract predicate
 * @private
 * @param {string} type - Message type
 * @returns {boolean}
 */
function _isCommandMessage(type) {
  return type && type.endsWith('_COMMAND');
}

/**
 * Check if message is a state update notification
 * v1.6.3.12-v2 - FIX Code Health: Extract predicate
 * @private
 * @param {string} type - Message type
 * @returns {boolean}
 */
function _isStateUpdateMessage(type) {
  return type === 'QUICK_TABS_UPDATED' || type === 'STATE_CHANGED';
}

/**
 * Check if message is a cross-tab transfer message
 * v1.6.4 - FIX BUG #1: Add handler for cross-tab transfer messages
 * @private
 * @param {string} type - Message type
 * @returns {boolean}
 */
function _isTransferMessage(type) {
  return (
    type === 'QUICK_TAB_TRANSFERRED_IN' ||
    type === 'QUICK_TAB_TRANSFERRED_OUT' ||
    type === 'CREATE_QUICK_TAB_FROM_DUPLICATE'
  );
}

/**
 * Validate if a Quick Tab object has valid structure with required id
 * v1.6.4-v2 - FIX Code Health: Extract complex conditional from _validateTransferredInMessage
 * @private
 * @param {*} quickTab - Object to validate
 * @returns {boolean} - True if quickTab is a valid object with an id property
 */
function _isValidQuickTabObject(quickTab) {
  return quickTab && typeof quickTab === 'object' && Boolean(quickTab.id);
}

/**
 * Check if message is an acknowledgment (ACK) message
 * v1.6.4-v2 - FIX Code Health: Extract predicate from handleQuickTabsPortResponse
 * @private
 * @param {string} type - Message type
 * @returns {boolean} - True if type ends with '_ACK'
 */
function _isAckMessage(type) {
  return type && type.endsWith('_ACK');
}

/**
 * Handle QUICK_TAB_TRANSFERRED_OUT message - remove Quick Tab from this tab
 * v1.6.4 - FIX BUG #1: Cross-tab transfer not working
 * When a Quick Tab is transferred to another tab, the source tab receives this message
 * and should remove/minimize the Quick Tab from its display.
 * @private
 * @param {Object} message - Transfer out message
 * @param {string} message.quickTabId - ID of Quick Tab to remove
 * @param {number} message.newOriginTabId - The new tab where Quick Tab is going (logged for debugging)
 */
function _handleQuickTabTransferredOut(message) {
  // v1.6.4 - Validate message is an object with required properties
  if (!message || typeof message !== 'object') {
    console.error('[Content] QUICK_TAB_TRANSFERRED_OUT: Invalid message (not an object):', message);
    return;
  }

  const { quickTabId, newOriginTabId } = message;

  // v1.6.4 - Validate quickTabId is present
  if (!quickTabId) {
    console.error('[Content] QUICK_TAB_TRANSFERRED_OUT: Missing quickTabId in message');
    return;
  }

  // Log includes newOriginTabId for debugging cross-tab transfer flow
  console.log('[Content] QUICK_TAB_TRANSFERRED_OUT: Removing Quick Tab from this tab:', {
    quickTabId,
    newOriginTabId, // Logged for transfer tracing, not used in removal logic
    currentTabId: quickTabsManager?.currentTabId,
    hasManager: !!quickTabsManager,
    timestamp: Date.now()
  });

  // Remove from local session cache FIRST to keep state consistent
  // regardless of whether closeById() succeeds
  sessionQuickTabs.delete(quickTabId);

  if (!quickTabsManager) {
    console.warn('[Content] QUICK_TAB_TRANSFERRED_OUT: QuickTabsManager not available');
    return;
  }

  // Close the Quick Tab on this tab (it's being moved to another tab)
  try {
    // v1.6.4 - Type-safe check for closeById method
    if (typeof quickTabsManager.closeById === 'function') {
      quickTabsManager.closeById(quickTabId);
      console.log('[Content] QUICK_TAB_TRANSFERRED_OUT: Quick Tab removed:', quickTabId);
    } else {
      console.warn('[Content] QUICK_TAB_TRANSFERRED_OUT: closeById not available');
    }
  } catch (err) {
    console.error('[Content] QUICK_TAB_TRANSFERRED_OUT: Failed to close Quick Tab:', {
      quickTabId,
      error: err.message
    });
  }
}

/**
 * Validate QUICK_TAB_TRANSFERRED_IN message has required properties
 * v1.6.4 - FIX Code Health: Extract validation to reduce complexity
 * v1.6.4-v2 - FIX Code Health: Use _isValidQuickTabObject helper for complex conditional
 * @private
 * @param {Object} message - Message to validate
 * @returns {{ valid: boolean, quickTab?: Object, oldOriginTabId?: number }}
 */
function _validateTransferredInMessage(message) {
  if (!message || typeof message !== 'object') {
    console.error('[Content] QUICK_TAB_TRANSFERRED_IN: Invalid message (not an object):', message);
    return { valid: false };
  }

  const { quickTab, oldOriginTabId } = message;

  // Log includes oldOriginTabId for debugging cross-tab transfer flow
  console.log('[Content] QUICK_TAB_TRANSFERRED_IN: Creating Quick Tab on this tab:', {
    quickTabId: quickTab?.id,
    url: quickTab?.url,
    oldOriginTabId, // Logged for transfer tracing, not used in creation logic
    currentTabId: quickTabsManager?.currentTabId,
    hasManager: !!quickTabsManager,
    timestamp: Date.now()
  });

  if (!quickTabsManager) {
    console.warn('[Content] QUICK_TAB_TRANSFERRED_IN: QuickTabsManager not available');
    return { valid: false };
  }

  if (!_isValidQuickTabObject(quickTab)) {
    console.error('[Content] QUICK_TAB_TRANSFERRED_IN: Invalid Quick Tab data:', quickTab);
    return { valid: false };
  }

  return { valid: true, quickTab, oldOriginTabId };
}

/**
 * Store minimized snapshot for transferred Quick Tab
 * v1.6.4-v4 - Extracted helper to reduce _handleQuickTabTransferredIn complexity
 * v1.6.4-v5 - Note: After storing, updateTransferredSnapshotWindow must be called
 *   with the created window to enable restore
 * v1.6.4-v5 - FIX: Pass currentTabId as newOriginTabId to update savedOriginTabId to destination tab
 *   This fixes the bug where minimized Quick Tabs transferred to another tab could not be restored
 *   because the snapshot still contained the OLD origin tab ID from the source tab
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {boolean} isMinimized - Whether Quick Tab is minimized
 * @param {Object|null} minimizedSnapshot - Snapshot data from transfer message
 */
function _storeTransferredMinimizedSnapshot(quickTabId, isMinimized, minimizedSnapshot) {
  if (!isMinimized) return;

  if (minimizedSnapshot && quickTabsManager?.minimizedManager) {
    // v1.6.4-v5 - FIX: Pass currentTabId (destination tab) as newOriginTabId
    // This updates savedOriginTabId to the NEW destination tab instead of keeping the OLD source tab
    const stored = quickTabsManager.minimizedManager.storeTransferredSnapshot(
      quickTabId,
      minimizedSnapshot,
      quickTabsManager.currentTabId  // Pass destination tab ID to update savedOriginTabId
    );
    console.log('[Content] QUICK_TAB_TRANSFERRED_IN: Stored minimized snapshot:', {
      quickTabId,
      stored,
      newOriginTabId: quickTabsManager.currentTabId,
      oldOriginTabId: minimizedSnapshot.originTabId,
      snapshot: minimizedSnapshot
    });
  } else {
    console.warn('[Content] QUICK_TAB_TRANSFERRED_IN: Minimized Quick Tab has no snapshot:', {
      quickTabId,
      hasMinimizedSnapshot: !!minimizedSnapshot,
      hasMinimizedManager: !!quickTabsManager?.minimizedManager
    });
  }
}

/**
 * Handle QUICK_TAB_TRANSFERRED_IN message - create Quick Tab on this tab
 * v1.6.4 - FIX BUG #1: Cross-tab transfer not working
 * v1.6.4 - FIX BUG #2: Skip initial overlay for transferred Quick Tabs
 * v1.6.4-v3 - FIX BUG #1: Add deduplication check to prevent duplicate creation
 * v1.6.4-v4 - FIX BUG #2 (Minimized Drag Restore): Store minimizedSnapshot for restore
 * v1.6.4-v5 - FIX BUG #3: Call updateTransferredSnapshotWindow after creation
 * @private
 * @param {Object} message - Transfer in message
 * @param {Object} message.quickTab - Full Quick Tab data to create
 * @param {number} message.oldOriginTabId - The previous tab where Quick Tab came from
 * @param {Object} message.minimizedSnapshot - Snapshot for restore if minimized
 */
function _handleQuickTabTransferredIn(message) {
  const validation = _validateTransferredInMessage(message);
  if (!validation.valid) return;

  const { quickTab } = validation;
  const { minimizedSnapshot } = message;

  // Deduplication check
  const existingQuickTab = sessionQuickTabs.get(quickTab.id);
  if (existingQuickTab) {
    console.log('[Content] QUICK_TAB_TRANSFERRED_IN: Skipping duplicate:', {
      quickTabId: quickTab.id,
      existingOriginTabId: existingQuickTab.originTabId
    });
    return;
  }

  // Store snapshot for minimized Quick Tabs before creation
  _storeTransferredMinimizedSnapshot(quickTab.id, quickTab.minimized, minimizedSnapshot);

  // Create the Quick Tab with received properties
  const createOptions = {
    id: quickTab.id,
    url: quickTab.url,
    title: quickTab.title || 'Quick Tab',
    left: quickTab.left,
    top: quickTab.top,
    width: quickTab.width,
    height: quickTab.height,
    minimized: quickTab.minimized || false,
    zIndex: quickTab.zIndex,
    originTabId: quickTabsManager.currentTabId,
    skipInitialOverlay: true
  };

  console.log('[Content] QUICK_TAB_TRANSFERRED_IN: Creating with options:', createOptions);
  _executeTransferredQuickTabCreation(quickTab, createOptions);
}

/**
 * Execute Quick Tab creation for transfer
 * v1.6.4-v4 - Extracted helper to reduce _handleQuickTabTransferredIn lines
 * v1.6.4-v5 - FIX BUG #3: Update transferred snapshot with window reference for restore
 * @private
 */
function _executeTransferredQuickTabCreation(quickTab, createOptions) {
  try {
    const cachedQuickTab = {
      id: quickTab.id,
      url: quickTab.url,
      title: quickTab.title,
      left: quickTab.left,
      top: quickTab.top,
      width: quickTab.width,
      height: quickTab.height,
      minimized: quickTab.minimized,
      zIndex: quickTab.zIndex,
      originTabId: quickTabsManager.currentTabId
    };
    sessionQuickTabs.set(quickTab.id, cachedQuickTab);

    const result = quickTabsManager.createQuickTab(createOptions);
    console.log('[Content] QUICK_TAB_TRANSFERRED_IN: Quick Tab created successfully:', quickTab.id);

    // v1.6.4-v5 - FIX BUG #3: Update transferred snapshot with window reference
    // This is critical for minimized Quick Tabs to be restorable after transfer
    // NOTE: createQuickTab() returns result.tabWindow directly, NOT an object containing tabWindow
    if (quickTab.minimized && result && quickTabsManager?.minimizedManager) {
      const updated = quickTabsManager.minimizedManager.updateTransferredSnapshotWindow(
        quickTab.id,
        result // result IS the tabWindow - createQuickTab() returns tabWindow directly
      );
      console.log('[Content] QUICK_TAB_TRANSFERRED_IN: Updated snapshot window:', {
        quickTabId: quickTab.id,
        updated,
        hasWindow: !!result
      });
    }

    _trackAdoptedQuickTab(quickTab.id, quickTabsManager.currentTabId);
  } catch (err) {
    sessionQuickTabs.delete(quickTab.id);
    console.error('[Content] QUICK_TAB_TRANSFERRED_IN: Failed to create Quick Tab:', {
      quickTabId: quickTab.id,
      error: err.message
    });
  }
}

/**
 * Handle cross-tab transfer messages
 * v1.6.4 - FIX BUG #1: Route transfer messages to appropriate handlers
 * @private
 * @param {Object} message - Transfer message
 * @returns {boolean} True if message was handled
 */
function _handleTransferMessage(message) {
  const { type } = message;

  if (type === 'QUICK_TAB_TRANSFERRED_OUT') {
    _handleQuickTabTransferredOut(message);
    return true;
  }

  if (type === 'QUICK_TAB_TRANSFERRED_IN') {
    _handleQuickTabTransferredIn(message);
    return true;
  }

  // v1.6.4 - FIX BUG #6/#8: Handle duplicate creation from Manager
  if (type === 'CREATE_QUICK_TAB_FROM_DUPLICATE') {
    _handleQuickTabTransferredIn(message);
    return true;
  }

  return false;
}

/**
 * Handle pending request response
 * v1.6.3.12-v2 - FIX Code Health: Extract handler
 * @private
 * @param {string} requestId - Request ID
 * @param {Object} message - Response message
 * @returns {boolean} Whether the message was handled
 */
function _handlePendingRequest(requestId, message) {
  if (!requestId || !pendingQuickTabRequests.has(requestId)) return false;

  const pending = pendingQuickTabRequests.get(requestId);
  clearTimeout(pending.timeoutId);
  pendingQuickTabRequests.delete(requestId);
  pending.resolve(message);
  return true;
}

/**
 * Handle response from background for pending requests
 * v1.6.3.12-v2 - FIX Code Health: Reduced complexity using helpers
 * v1.6.4 - FIX BUG #1: Add handler for cross-tab transfer messages
 * v1.6.4-v2 - FIX Code Health: Use _isAckMessage helper for ACK detection
 * @param {Object} message - Response message from background
 */
function handleQuickTabsPortResponse(message) {
  const { requestId, type } = message;

  // v1.6.3.12-v13 - FIX Issue #48: Log ALL incoming port messages for debugging
  console.log('[Content] PORT_MESSAGE_RECEIVED:', {
    type,
    requestId: requestId || 'none',
    hasQuickTabId: !!message.quickTabId,
    quickTabId: message.quickTabId || 'none',
    isCommand: _isCommandMessage(type),
    isStateUpdate: _isStateUpdateMessage(type),
    isTransfer: _isTransferMessage(type),
    timestamp: Date.now()
  });

  if (_isCommandMessage(type)) {
    handleQuickTabsCommand(message);
    return;
  }

  if (_isStateUpdateMessage(type)) {
    handleQuickTabsStateUpdate(message);
    return;
  }

  // v1.6.4 - FIX BUG #1: Handle cross-tab transfer messages
  if (_isTransferMessage(type)) {
    _handleTransferMessage(message);
    return;
  }

  if (_handlePendingRequest(requestId, message)) return;

  if (_isAckMessage(type)) {
    console.log(`[Content] Received ACK: ${type}`, message);
    return;
  }

  console.log(`[Content] Received Quick Tabs message: ${type}`, message);
}

/**
 * Handle state update from background
 * v1.6.3.12 - Option 4: Update local cache when background notifies of changes
 * @param {Object} message - State update message
 */
function handleQuickTabsStateUpdate(message) {
  const { quickTabs } = message;

  if (Array.isArray(quickTabs)) {
    sessionQuickTabs.clear();
    for (const qt of quickTabs) {
      sessionQuickTabs.set(qt.id, qt);
    }
    console.log(`[Content] Quick Tabs state updated: ${quickTabs.length} tabs`);
  }
}

// ==================== v1.6.3.12-v13 COMMAND DEDUPLICATION ====================
/**
 * Map to track recently executed commands for deduplication
 * v1.6.3.12-v13 - FIX Issue #48: Deduplicate redundant command delivery
 * @private
 * @type {Map<string, number>}
 * @description Key format: `${commandType}-${quickTabId}` (e.g., "CLOSE_QUICK_TAB_COMMAND-qt-123")
 *              Value: Unix timestamp (milliseconds) when command was executed
 */
const _recentCommandsExecuted = new Map();

/**
 * Deduplication window in milliseconds
 * Commands with the same type+quickTabId within this window are considered duplicates
 * @private
 */
const COMMAND_DEDUP_WINDOW_MS = 1000;

/**
 * Check if command is a duplicate (recently executed)
 * v1.6.3.12-v13 - FIX Issue #48: Prevent duplicate command execution
 * @private
 * @param {string} commandType - Command type
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if duplicate
 */
function _isCommandDuplicate(commandType, quickTabId) {
  const key = `${commandType}-${quickTabId}`;
  const lastExecuted = _recentCommandsExecuted.get(key);
  const now = Date.now();

  if (lastExecuted && now - lastExecuted < COMMAND_DEDUP_WINDOW_MS) {
    return true;
  }

  // Mark as executed
  _recentCommandsExecuted.set(key, now);

  // Cleanup old entries (older than 5x the dedup window)
  const cutoff = now - COMMAND_DEDUP_WINDOW_MS * 5;
  for (const [k, timestamp] of _recentCommandsExecuted) {
    if (timestamp < cutoff) {
      _recentCommandsExecuted.delete(k);
    }
  }

  return false;
}

// ==================== v1.6.3.12-v2 COMMAND HANDLER LOOKUP TABLE ====================
/**
 * Quick Tab command handlers lookup table
 * v1.6.3.12-v2 - FIX Code Health: Replace switch with lookup table
 * @private
 */
const _quickTabCommandHandlers = {
  CLOSE_QUICK_TAB_COMMAND: id => quickTabsManager?.closeById?.(id),
  MINIMIZE_QUICK_TAB_COMMAND: id => quickTabsManager?.minimizeById?.(id),
  RESTORE_QUICK_TAB_COMMAND: id => quickTabsManager?.restoreById?.(id)
};

/**
 * Handle command from sidebar (via background)
 * v1.6.3.12-v2 - FIX Code Health: Use lookup table instead of switch
 * v1.6.3.12-v13 - FIX Issue #48: Enhanced logging for command execution
 * v1.6.3.12-v13 - FIX Issue #48: Add deduplication for redundant command delivery
 * @param {Object} message - Command message
 */
function handleQuickTabsCommand(message) {
  const { type, quickTabId } = message;

  // v1.6.3.12-v13 - FIX Issue #48: Enhanced logging
  console.log(`[Content] COMMAND_RECEIVED: ${type}`, {
    quickTabId,
    hasManager: !!quickTabsManager,
    hasCloseById: !!quickTabsManager?.closeById,
    hasMinimizeById: !!quickTabsManager?.minimizeById,
    hasRestoreById: !!quickTabsManager?.restoreById,
    currentTabId: cachedTabId,
    timestamp: Date.now()
  });

  // v1.6.3.12-v13 - FIX Issue #48: Deduplicate redundant command delivery
  // Background now sends commands via BOTH port AND tabs.sendMessage for reliability
  // This deduplication ensures the command is only executed once
  if (_isCommandDuplicate(type, quickTabId)) {
    console.log(`[Content] COMMAND_DEDUPLICATED: ${type}`, {
      quickTabId,
      reason: 'recently_executed',
      dedupWindowMs: COMMAND_DEDUP_WINDOW_MS
    });
    return;
  }

  const handler = _quickTabCommandHandlers[type];
  if (handler) {
    console.log(`[Content] COMMAND_EXECUTING: ${type}`, { quickTabId });
    handler(quickTabId);
    console.log(`[Content] COMMAND_EXECUTED: ${type}`, { quickTabId });
  } else {
    console.warn(`[Content] Unknown Quick Tabs command: ${type}`);
  }
}

/**
 * Handle Quick Tabs port disconnection
 * v1.6.3.12 - Helper to reduce nesting depth
 * @private
 */
function _handleQuickTabsPortDisconnect() {
  console.warn('[Content] Quick Tabs port disconnected from background');
  quickTabsPort = null;

  // Attempt reconnection after a delay
  setTimeout(_attemptQuickTabsPortReconnection, QUICK_TABS_RECONNECT_DELAY_MS);
}

/**
 * Attempt Quick Tabs port reconnection
 * v1.6.3.12 - Helper to reduce nesting depth
 * @private
 */
function _attemptQuickTabsPortReconnection() {
  if (quickTabsPort) return; // Already connected
  if (document.visibilityState === 'hidden') return; // Page not visible

  console.log('[Content] Attempting Quick Tabs port reconnection');
  initializeQuickTabsPort().catch(err => {
    console.error('[Content] Quick Tabs port reconnection failed:', err.message);
  });
}

/**
 * Hydrate Quick Tabs from background
 * v1.6.3.12 - Helper to reduce nesting depth
 * @private
 */
async function _hydrateQuickTabsFromBackground() {
  try {
    const response = await queryQuickTabsBackground('HYDRATE_ON_LOAD', {});
    if (!response?.quickTabs) return;

    sessionQuickTabs.clear();
    for (const qt of response.quickTabs) {
      sessionQuickTabs.set(qt.id, qt);
    }
    console.log(`[Content] Hydrated ${response.quickTabs.length} Quick Tabs from background`);
  } catch (err) {
    console.warn('[Content] Quick Tabs hydration failed:', err.message);
  }
}

/**
 * Initialize Quick Tabs port connection
 * v1.6.3.12 - Option 4: Connect to background via 'quick-tabs-port'
 * @returns {Promise<void>}
 */
async function initializeQuickTabsPort() {
  console.log('[Content] Initializing Quick Tabs port connection');

  quickTabsPort = browser.runtime.connect({ name: 'quick-tabs-port' });
  console.log('[Content] Connected to background via quick-tabs-port');

  quickTabsPort.onMessage.addListener(handleQuickTabsPortResponse);
  quickTabsPort.onDisconnect.addListener(_handleQuickTabsPortDisconnect);

  // Request hydration - get existing Quick Tabs for this tab
  await _hydrateQuickTabsFromBackground();
}

// ==================== v1.6.3.12-v2 PORT OPERATION HELPERS ====================
// These helpers reduce duplication in port messaging functions

/**
 * Generate correlation ID for content script operations
 * v1.6.3.12 - Gap #8: Correlation IDs for async operations
 * @private
 * @returns {string} Unique correlation ID
 */
function _generateContentCorrelationId() {
  return `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Execute Quick Tab port operation with error handling
 * v1.6.3.12-v2 - FIX Code Health: Generic port operation wrapper
 * v1.6.3.12 - Gap #7 & #8: End-to-end state sync path logging with correlation IDs
 * @private
 * @param {string} operationType - Type of operation (e.g., 'CREATE_QUICK_TAB')
 * @param {Object} payload - Message payload
 * @param {Function} [cacheUpdater] - Optional function to update local cache
 * @returns {boolean} Success status
 */
function _executeQuickTabPortOperation(operationType, payload, cacheUpdater) {
  if (!quickTabsPort) {
    console.warn(`[Content] Cannot ${operationType} - port not connected`);
    return false;
  }

  const correlationId = _generateContentCorrelationId();
  const sentAt = Date.now();

  // v1.6.3.12 - Gap #7: Log content script state change initiated
  console.log('[Content] STATE_SYNC_PATH_INITIATED:', {
    timestamp: sentAt,
    operationType,
    correlationId,
    quickTabId: payload.quickTabId || payload.quickTab?.id,
    tabId: cachedTabId
  });

  try {
    quickTabsPort.postMessage({
      type: operationType,
      ...payload,
      timestamp: sentAt,
      correlationId // v1.6.3.12 - Gap #8: Include correlation ID
    });

    if (cacheUpdater) cacheUpdater();

    // v1.6.3.12 - Gap #7: Log state serialized and sent
    console.log('[Content] STATE_SYNC_PATH_SENT:', {
      timestamp: Date.now(),
      operationType,
      correlationId,
      quickTabId: payload.quickTabId || payload.quickTab?.id,
      latencyMs: Date.now() - sentAt
    });

    return true;
  } catch (err) {
    console.error(`[Content] Failed to ${operationType} via port:`, err.message);
    return false;
  }
}

/**
 * Create Quick Tab via port messaging
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * @param {Object} quickTab - Quick Tab data to create
 * @returns {boolean} Success status
 */
function createQuickTabViaPort(quickTab) {
  return _executeQuickTabPortOperation('CREATE_QUICK_TAB', { quickTab }, () => {
    sessionQuickTabs.set(quickTab.id, quickTab);
  });
}

/**
 * Update Quick Tab via port messaging
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * @param {string} quickTabId - Quick Tab ID to update
 * @param {Object} updates - Properties to update
 * @returns {boolean} Success status
 */
function updateQuickTabViaPort(quickTabId, updates) {
  return _executeQuickTabPortOperation('UPDATE_QUICK_TAB', { quickTabId, updates }, () => {
    const existing = sessionQuickTabs.get(quickTabId);
    if (existing) Object.assign(existing, updates);
  });
}

/**
 * Delete Quick Tab via port messaging
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * @param {string} quickTabId - Quick Tab ID to delete
 * @returns {boolean} Success status
 */
function deleteQuickTabViaPort(quickTabId) {
  return _executeQuickTabPortOperation('DELETE_QUICK_TAB', { quickTabId }, () => {
    sessionQuickTabs.delete(quickTabId);
  });
}

/**
 * Minimize Quick Tab via port messaging
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * @param {string} quickTabId - Quick Tab ID to minimize
 * @returns {boolean} Success status
 */
function minimizeQuickTabViaPort(quickTabId) {
  return _executeQuickTabPortOperation('MINIMIZE_QUICK_TAB', { quickTabId }, () => {
    const existing = sessionQuickTabs.get(quickTabId);
    if (existing) existing.minimized = true;
  });
}

/**
 * Restore Quick Tab via port messaging
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * @param {string} quickTabId - Quick Tab ID to restore
 * @returns {boolean} Success status
 */
function restoreQuickTabViaPort(quickTabId) {
  return _executeQuickTabPortOperation('RESTORE_QUICK_TAB', { quickTabId }, () => {
    const existing = sessionQuickTabs.get(quickTabId);
    if (existing) existing.minimized = false;
  });
}

// Export Quick Tabs port API for use by Quick Tabs manager
if (typeof window !== 'undefined') {
  window.QuickTabsPortAPI = {
    createQuickTab: createQuickTabViaPort,
    updateQuickTab: updateQuickTabViaPort,
    deleteQuickTab: deleteQuickTabViaPort,
    minimizeQuickTab: minimizeQuickTabViaPort,
    restoreQuickTab: restoreQuickTabViaPort,
    getLocalCache: () => sessionQuickTabs,
    isConnected: () => quickTabsPort !== null
  };
}

console.log('[Content] v1.6.3.12 Quick Tabs port API initialized');

// ==================== END v1.6.3.12 OPTION 4 PORT MESSAGING ====================

/**
 * Log successful Quick Tabs initialization
 * v1.6.3.12 - Extracted helper to reduce initializeQuickTabsFeature complexity
 * @private
 * @param {number|null} currentTabId - The current tab ID
 * @param {number} totalDurationMs - Total initialization duration in ms
 */
function _logInitSuccess(currentTabId, totalDurationMs) {
  console.log('[INIT][Content] PHASE_COMPLETE:', {
    success: true,
    currentTabId: currentTabId !== null ? currentTabId : 'NULL',
    totalDurationMs,
    hasManager: true,
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
 * Log failed Quick Tabs initialization
 * v1.6.3.12 - Extracted helper to reduce initializeQuickTabsFeature complexity
 * @private
 * @param {number|null} currentTabId - The current tab ID
 * @param {number} totalDurationMs - Total initialization duration in ms
 */
function _logInitFailure(currentTabId, totalDurationMs) {
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
 * Log tab ID acquisition failure and warnings
 * v1.6.3.12 - Extracted helper to reduce initializeQuickTabsFeature complexity
 * @private
 */
function _logTabIdAcquisitionFailed() {
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
 * Handle successful tab ID acquisition - set writing tab ID and establish port connection
 * v1.6.3.12 - Extracted helper to reduce initializeQuickTabsFeature complexity
 * v1.6.3.11-v9 - FIX Issue C: Add [IDENTITY_INIT] READY logging
 * v1.6.3.11-v10 - FIX Issue #13: Set identityReady flag and resolve promise
 * v1.6.3.12 - Option 4: Also initialize Quick Tabs port for in-memory storage
 * @private
 * @param {number} tabId - The acquired tab ID
 */
function _handleTabIdAcquired(tabId, cookieStoreId = null) {
  // v1.6.3.11-v8 - FIX Diagnostic Logging #3: Identity state transition logging
  // Note: Full identity acquisition duration is tracked by TAB_ID_ACQUISITION logs
  // This measures only the local state update portion of the transition
  const localUpdateStartTime = Date.now();
  console.log('[Identity] State transitioning: INITIALIZING → READY');

  // v1.6.3.12-v3 - FIX Issue E: Pass caller context to identify content script
  setWritingTabId(tabId, TAB_ID_CALLER_CONTEXT.CONTENT_SCRIPT);

  // v1.6.3.11-v11 - FIX Issue #47: Also set container ID for container isolation
  // This is critical for the identity state machine to transition to READY
  if (cookieStoreId !== null) {
    setWritingContainerId(cookieStoreId);
    console.log('[Identity] Container ID set:', cookieStoreId);
  } else {
    // If no cookieStoreId was provided, use a default value for non-container environments
    // This allows the identity state machine to transition to READY even without containers
    setWritingContainerId('firefox-default');
    console.log(
      '[Identity] Container ID set to default: firefox-default (no container info available)'
    );
  }

  // v1.6.3.11-v8 - FIX Diagnostic Logging #3: Log identity state completion
  const localUpdateDuration = Date.now() - localUpdateStartTime;
  console.log('[Identity] Initialization duration:', localUpdateDuration + 'ms');
  console.log('[Identity] Tab ID acquired:', tabId);
  console.log('[Identity] Container ID acquired:', cookieStoreId ?? 'firefox-default');

  // v1.6.3.11-v9 - FIX Issue C: Log identity ready status
  // v1.6.3.11-v11 - FIX Issue #47: Include cookieStoreId in identity ready log
  console.log('[IDENTITY_INIT] IDENTITY_READY: Tab identity fully initialized', {
    tabId,
    cookieStoreId: cookieStoreId ?? 'firefox-default',
    phase: 'IDENTITY_READY',
    timestamp: new Date().toISOString()
  });

  console.log('[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_COMPLETE: Writing tab ID set', {
    tabId,
    cookieStoreId: cookieStoreId ?? 'firefox-default',
    isWritingTabIdInitializedAfter: isWritingTabIdInitialized()
  });

  // v1.6.3.11-v10 - FIX Issue #13: Set identity ready flag
  console.log(
    '[IDENTITY_STATE] Ready state transitioned: false → true, tabId=' +
      tabId +
      ', cookieStoreId=' +
      (cookieStoreId ?? 'firefox-default')
  );
  identityReady = true;

  // Resolve the identity ready promise if waiting
  if (identityReadyResolver) {
    identityReadyResolver(tabId);
    identityReadyResolver = null;
  }

  // Establish persistent port connection
  console.log('[INIT][Content] PORT_CONNECTION_START:', { tabId, cookieStoreId });
  connectContentToBackground(tabId);
  console.log('[INIT][Content] PORT_CONNECTION_INITIATED:', { tabId, cookieStoreId });

  // v1.6.3.12 - Option 4: Initialize Quick Tabs port for in-memory storage
  // This is the new port-based communication that replaces storage.session
  console.log('[INIT][Content] QUICK_TABS_PORT_START:', { tabId, cookieStoreId });
  initializeQuickTabsPort()
    .then(() => {
      console.log('[INIT][Content] QUICK_TABS_PORT_CONNECTED:', { tabId, cookieStoreId });
    })
    .catch(err => {
      console.warn('[INIT][Content] QUICK_TABS_PORT_FAILED:', {
        tabId,
        cookieStoreId,
        error: err.message
      });
    });
}

/**
 * v1.6.0.3 - Helper to initialize Quick Tabs
 * v1.6.3.5-v10 - FIX Issue #3: Get tab ID from background before initializing Quick Tabs
 * v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Set writing tab ID for storage ownership
 * v1.6.3.10-v6 - FIX Issue #4/11/12: Enhanced logging showing tab ID acquisition flow
 * v1.6.3.10-v10 - FIX Issue #6: Add [INIT] prefix boundary logging for initialization phases
 * v1.6.3.12 - Refactored to use helper functions for Code Health 9.0+
 */
async function initializeQuickTabsFeature() {
  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging
  const initStartTime = Date.now();
  console.log('[INIT][Content] PHASE_START: Quick Tabs initialization beginning', {
    timestamp: new Date().toISOString(),
    isWritingTabIdInitialized: isWritingTabIdInitialized()
  });

  // v1.6.3.11-v8 - FIX Diagnostic Logging #6: Log sending GET_QUICK_TABS_STATE
  console.log('[ContentScript][Init] Sending GET_QUICK_TABS_STATE');

  // v1.6.3.10-v6 - FIX Issue #4/11: Log before tab ID request
  console.log('[INIT][Content] TAB_ID_ACQUISITION_START:', {
    isWritingTabIdInitialized: isWritingTabIdInitialized(),
    timestamp: new Date().toISOString()
  });

  // v1.6.3.5-v10 - FIX Issue #3: Get tab ID FIRST from background script
  // This is critical for cross-tab scoping - Quick Tabs should only render
  // in the tab they were created in (originTabId must match currentTabId)
  // v1.6.3.11-v11 - FIX Issue #47: Also get cookieStoreId for container isolation
  const identityResult = await getCurrentTabIdFromBackground();
  const currentTabId = identityResult.tabId;
  const currentCookieStoreId = identityResult.cookieStoreId;
  const tabIdAcquisitionDuration = Date.now() - initStartTime;

  // v1.6.3.11-v8 - FIX Diagnostic Logging #6: Log response received
  // v1.6.3.11-v11 - FIX Issue #47: Also log cookieStoreId
  console.log('[ContentScript][Init] Received response:', {
    success: currentTabId !== null,
    cookieStoreId: currentCookieStoreId,
    tabCountStatus: 'awaiting-hydration' // Numeric count available after hydration
  });

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for tab ID result
  // v1.6.3.11-v11 - FIX Issue #47: Also log cookieStoreId
  console.log('[INIT][Content] TAB_ID_ACQUISITION_COMPLETE:', {
    currentTabId: currentTabId !== null ? currentTabId : 'FAILED',
    cookieStoreId: currentCookieStoreId,
    durationMs: tabIdAcquisitionDuration,
    success: currentTabId !== null,
    timestamp: new Date().toISOString()
  });

  // v1.6.3.10-v6 - FIX Issue #4/11: Log tab ID acquisition result
  // v1.6.3.11-v11 - FIX Issue #47: Also log cookieStoreId
  console.log('[Copy-URL-on-Hover][TabID] v1.6.3.10-v6 INIT_RESULT: Tab ID acquired', {
    currentTabId,
    cookieStoreId: currentCookieStoreId,
    source: 'background messaging (GET_CURRENT_TAB_ID)',
    success: currentTabId !== null
  });

  // v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #3: Set writing tab ID for storage ownership
  // This is CRITICAL: content scripts cannot use browser.tabs.getCurrent(), so they must
  // explicitly set the tab ID for storage-utils to validate ownership during writes
  // v1.6.3.11-v11 - FIX Issue #47: Also set container ID for container isolation
  if (currentTabId !== null) {
    _handleTabIdAcquired(currentTabId, currentCookieStoreId);
  } else {
    _logTabIdAcquisitionFailed();
  }

  // v1.6.3.10-v10 - FIX Issue #6: [INIT] boundary logging for manager init
  console.log('[INIT][Content] QUICKTABS_MANAGER_INIT_START:', {
    currentTabId: currentTabId !== null ? currentTabId : 'NULL',
    cookieStoreId: currentCookieStoreId,
    timestamp: new Date().toISOString()
  });

  // v1.6.3.11-v8 - FIX Diagnostic Logging #6: Log hydration filtering
  console.log('[ContentScript][Hydration] Filtering by originTabId:', currentTabId);

  // v1.6.3.11-v12 - FIX Issue 1: Pass BOTH currentTabId AND cookieStoreId to initQuickTabs
  // This ensures the QuickTabsManager uses the same container ID that was already acquired
  // and avoids a second network request to detect container context
  quickTabsManager = await initQuickTabs(eventBus, Events, {
    currentTabId,
    cookieStoreId: currentCookieStoreId
  });

  const initEndTime = Date.now();
  const totalInitDuration = initEndTime - initStartTime;

  // v1.6.3.11-v8 - FIX Diagnostic Logging #6: Log rendering count
  const tabCount = quickTabsManager?.tabs?.size ?? 0;
  console.log('[ContentScript][Hydration] Rendering Quick Tabs:', tabCount);

  // v1.6.3.12 - Use extracted helpers for Code Health 9.0+
  if (quickTabsManager) {
    _logInitSuccess(currentTabId, totalInitDuration);
  } else {
    _logInitFailure(currentTabId, totalInitDuration);
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

    // v1.6.3.11-v8 - FIX Diagnostic Logging #6: Content script lifecycle logging
    console.log('[ContentScript][Init] Page loaded:', {
      url: window.location.href,
      tabId: 'pending',
      container: 'firefox-default'
    });

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

    // v1.6.3.11-v8 - FIX Diagnostic Logging #6: Content script ready
    console.log('[ContentScript][Ready] Hydration complete, listeners attached');

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

  // v1.6.4-v4 - FIX Issue #47 Container Filter: Get container ID from Identity system
  // getWritingContainerId() returns the current container ID set during content script initialization
  // This ensures Quick Tabs inherit the correct Firefox Container context
  const identityContainerId = getWritingContainerId();
  // v1.6.4-v4 - Use CONSTANTS.DEFAULT_CONTAINER for consistency with codebase
  const originContainerId = identityContainerId ?? CONSTANTS.DEFAULT_CONTAINER;

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
    // v1.6.4-v4 - FIX Issue #47: Enhanced logging to include container context
    console.log(
      '[Content] QUICK_TAB_CREATE: Including originTabId and originContainerId in creation payload',
      {
        url,
        id,
        originTabId,
        originContainerId,
        identityContainerId
      }
    );
  }

  return {
    id,
    url,
    left: position.left,
    top: position.top,
    width: size.width,
    height: size.height,
    title,
    // v1.6.4-v4 - FIX Issue #47 Container Filter: Use actual container ID from Identity system
    // cookieStoreId is Firefox's field for container identity (from contextualIdentities API)
    cookieStoreId: originContainerId,
    minimized: false,
    pinnedToUrl: null,
    // v1.6.3.10-v7 - FIX Issues #3, #11: Pass originTabId to background
    originTabId,
    // v1.6.4-v4 - FIX Issue #47 Container Filter: Include originContainerId for Manager filtering
    originContainerId
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
 * Wait for identity to be ready before proceeding
 * v1.6.3.11-v10 - FIX Issue #13: Identity ready gate with timeout
 * @returns {Promise<number|null>} Tab ID when ready, null if timeout
 */
function waitForIdentityReady() {
  // Fast path: already ready
  if (identityReady) {
    return Promise.resolve(cachedTabId);
  }

  // Create promise if not already waiting
  if (!identityReadyPromise) {
    identityReadyPromise = new Promise((resolve, _reject) => {
      identityReadyResolver = resolve;

      // Timeout after IDENTITY_READY_TIMEOUT_MS
      setTimeout(() => {
        if (!identityReady) {
          console.error('[IDENTITY_STATE] Timeout waiting for identity:', {
            timeoutMs: IDENTITY_READY_TIMEOUT_MS,
            identityReady,
            cachedTabId
          });
          resolve(null);
        }
      }, IDENTITY_READY_TIMEOUT_MS);
    });
  }

  return identityReadyPromise;
}

/**
 * Check if Quick Tab operations are gated due to identity not ready
 * v1.6.3.11-v10 - FIX Issue #13: Gate check with logging
 * @param {string} operation - Operation being attempted (for logging)
 * @returns {boolean} True if operation should be blocked
 */
function isQuickTabOperationGated(operation) {
  if (!identityReady) {
    console.warn('[OPERATION_GATED] Blocking operation:', {
      reason: 'IDENTITY_NOT_READY',
      operation,
      identityReady,
      cachedTabId,
      timestamp: new Date().toISOString()
    });
    return true;
  }
  return false;
}

/**
 * v1.6.0 Phase 2.4 - Refactored to reduce complexity from 18 to <9
 * v1.6.3.11-v10 - FIX Issue #13: Add identity ready gate
 */
/**
 * Handle Quick Tab creation with identity gating
 * v1.6.3.11-v10 - FIX Code Health: Extracted helpers to reduce cyclomatic complexity
 */
async function handleCreateQuickTab(url, targetElement = null) {
  if (!url) {
    console.warn('[Quick Tab] Missing URL for creation');
    return;
  }

  const gateResult = await _handleIdentityGating('CREATE_QUICK_TAB', url);
  if (!gateResult.proceed) {
    return;
  }

  debug('Creating Quick Tab for:', url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });

  const quickTabData = _prepareQuickTabData(url, targetElement);

  try {
    await executeQuickTabCreation(
      quickTabData.data,
      quickTabData.saveId,
      quickTabData.canUseManagerSaveId
    );
  } catch (err) {
    handleQuickTabCreationError(err, quickTabData.saveId, quickTabData.canUseManagerSaveId);
  }
}

/**
 * Handle identity gating for Quick Tab operations
 * v1.6.3.11-v10 - Extracted to reduce cyclomatic complexity
 * @private
 */
async function _handleIdentityGating(operation, url) {
  if (!isQuickTabOperationGated(operation)) {
    return { proceed: true };
  }

  showNotification('⏳ Initializing...', 'info');
  const tabId = await waitForIdentityReady();

  if (tabId === null) {
    console.error('[OPERATION_GATED] Quick Tab creation BLOCKED - identity timeout:', {
      operation,
      url,
      reason: 'Identity initialization timed out after ' + IDENTITY_READY_TIMEOUT_MS + 'ms'
    });
    showNotification('✗ Quick Tab unavailable - please refresh the page', 'error');
    return { proceed: false };
  }

  console.log('[OPERATION_GATED] Quick Tab creation UNBLOCKED - identity ready:', {
    operation,
    tabId
  });
  return { proceed: true, tabId };
}

/**
 * Prepare Quick Tab data for creation
 * v1.6.3.11-v10 - Extracted to reduce cyclomatic complexity
 * @private
 */
function _prepareQuickTabData(url, targetElement) {
  const width = CONFIG.quickTabDefaultWidth || 800;
  const height = CONFIG.quickTabDefaultHeight || 600;
  const position = calculateQuickTabPosition(targetElement, width, height);
  const title = targetElement?.textContent?.trim() || 'Quick Tab';
  const { quickTabId, saveId, canUseManagerSaveId } = generateQuickTabIds();

  return {
    data: buildQuickTabData({
      url,
      id: quickTabId,
      position,
      size: { width, height },
      title
    }),
    saveId,
    canUseManagerSaveId
  };
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

/**
 * Map of recently-adopted Quick Tab IDs -> { newOriginTabId, adoptedAt }
 * v1.6.3.10-v7 - FIX Issue #7: Adoption-aware ownership validation
 */
const recentlyAdoptedQuickTabs = new Map();

/**
 * TTL for recently-adopted Quick Tab entries (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #7: 5 second TTL
 */
const ADOPTION_TRACKING_TTL_MS = 5000;

/**
 * Cleanup interval for recently-adopted Quick Tab entries (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #7: Clean up every 30 seconds
 */
const ADOPTION_CLEANUP_INTERVAL_MS = 30000;

/**
 * Track a recently-adopted Quick Tab ID
 * v1.6.3.10-v7 - FIX Issue #7
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {number} newOriginTabId - New owner tab ID
 */
function _trackAdoptedQuickTab(quickTabId, newOriginTabId) {
  recentlyAdoptedQuickTabs.set(quickTabId, {
    newOriginTabId,
    adoptedAt: Date.now()
  });

  console.log('[Content] ADOPTION_TRACKED:', {
    quickTabId,
    newOriginTabId,
    trackedCount: recentlyAdoptedQuickTabs.size
  });
}

/**
 * Check if Quick Tab was recently adopted and get cached ownership
 * v1.6.3.10-v7 - FIX Issue #7
 * @param {string} quickTabId - Quick Tab ID to check
 * @returns {{ wasAdopted: boolean, newOriginTabId: number|null }} Adoption info
 */
function _getAdoptionOwnership(quickTabId) {
  const adoptionInfo = recentlyAdoptedQuickTabs.get(quickTabId);

  if (!adoptionInfo) {
    return { wasAdopted: false, newOriginTabId: null };
  }

  // Check if TTL expired
  if (Date.now() - adoptionInfo.adoptedAt > ADOPTION_TRACKING_TTL_MS) {
    recentlyAdoptedQuickTabs.delete(quickTabId);
    return { wasAdopted: false, newOriginTabId: null };
  }

  return { wasAdopted: true, newOriginTabId: adoptionInfo.newOriginTabId };
}

/**
 * Clean up expired adoption tracking entries
 * v1.6.3.10-v7 - FIX Issue #7
 */
function _cleanupAdoptionTracking() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [quickTabId, adoptionInfo] of recentlyAdoptedQuickTabs) {
    if (now - adoptionInfo.adoptedAt > ADOPTION_TRACKING_TTL_MS) {
      recentlyAdoptedQuickTabs.delete(quickTabId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log('[Content] ADOPTION_CLEANUP:', {
      cleanedCount,
      remainingCount: recentlyAdoptedQuickTabs.size
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
 * De-duplication window for storage events (milliseconds)
 * v1.6.3.10-v7 - FIX Issue #6: 200ms window
 */
const STORAGE_EVENT_DEDUP_WINDOW_MS = 200;

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
 * @private
 */
function _isWithinDedupWindow(lastEvent, newVersion, now) {
  if (!lastEvent) return false;
  const timeSinceLastEvent = now - lastEvent.timestamp;
  const isDuplicate =
    timeSinceLastEvent < STORAGE_EVENT_DEDUP_WINDOW_MS && lastEvent.version === newVersion;
  if (isDuplicate) {
    console.debug('[Content] STORAGE_EVENT_DUPLICATE:', {
      timeSinceLastEvent,
      version: newVersion
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
 * @private
 * @param {number} now - Current timestamp
 */
function _cleanupOldStorageEvents(now) {
  const cutoff = now - STORAGE_EVENT_DEDUP_WINDOW_MS * 10;
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
 * v1.6.3.12-v7 - Extracted for code health, uses options object to reduce args
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Refactored to reduce LoC from 70 to <50
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
 * v1.6.3.12-v7 - Extracted predicate for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Refactored to reduce complexity (cc=16 -> cc<9)
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Refactored to reduce complexity (cc=12 -> cc<9)
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
 * v1.6.3.12-v7 - FIX BUG #4: Cross-Tab Restore Using Wrong Tab Context
 * v1.6.3.12-v7 - FIX Issue #22: Update MinimizedManager snapshot originTabId after adoption
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
 * v1.6.3.12-v7 - FIX BUG #4: Cross-Tab Restore Using Wrong Tab Context
 * v1.6.3.12-v7 - FIX Issue #22: Update MinimizedManager snapshot originTabId after adoption
 * v1.6.3.12-v7 - FIX Code Health: Refactored to reduce line count (95 -> ~55)
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

// ==================== v1.6.3.12-v7 FIX Issue #17: TAB ACTIVATED HANDLER ====================
// Handle tabActivated action from background when a tab becomes active
// This enables content script hydration and adoption state refresh

/**
 * Handle tabActivated message from background
 * v1.6.3.12-v7 - FIX Issue #17: Missing tabActivated handler in content script
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

  // v1.6.3.12-v7 - FIX Issue #16: Refresh adoption state on tab activation
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
 * v1.6.3.12-v7 - FIX Issue #17: State sync on tab activation
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

  // v1.6.3.12-v7 - FIX Issue #16: Update local cache with new originTabId values from adoption
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
 * v1.6.3.12-v7 - Extracted to reduce complexity
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
 * v1.6.3.12-v7 - Extracted to reduce complexity
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
// v1.6.3.11-v12 - Removed _testHandleToggleSolo and _testHandleToggleMute (Solo/Mute feature removed)
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

  // v1.6.3.11-v12 - Removed _toggleVisibility helper and _testHandleToggleSolo/_testHandleToggleMute handlers (Solo/Mute feature removed)

  /**
   * Process a single tab for visibility state
   * v1.6.3.11-v12 - Simplified: Solo/Mute removed, only check shouldBeVisible and minimized
   * @private
   */
  const _processTabVisibility = (id, tab, tabId, visibilityState) => {
    const domainTab = tab.domainTab;
    if (!domainTab) return;

    const shouldBeVisible = domainTab.shouldBeVisible(tabId);

    visibilityState.quickTabs[id] = {
      id,
      url: domainTab.url,
      title: domainTab.title,
      shouldBeVisible,
      minimized: domainTab.visibility?.minimized ?? false
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

    // v1.6.3.12-v13 - FIX Issue #48: Deduplicate commands from redundant delivery
    // Background sends via both port and tabs.sendMessage for reliability
    if (_isCommandDuplicate('CLOSE_QUICK_TAB', message.quickTabId)) {
      console.log('[Content] CLOSE_QUICK_TAB deduplicated:', {
        quickTabId: message.quickTabId,
        reason: 'recently_executed'
      });
      sendResponse({ success: true, deduplicated: true });
      return true;
    }

    _handleCloseQuickTab(message.quickTabId, sendResponse, source, correlationId);
    return true;
  },
  MINIMIZE_QUICK_TAB: (message, sendResponse) => {
    console.log('[Content] Received MINIMIZE_QUICK_TAB request:', message.quickTabId);

    // v1.6.3.12-v13 - FIX Issue #48: Deduplicate commands from redundant delivery
    if (_isCommandDuplicate('MINIMIZE_QUICK_TAB', message.quickTabId)) {
      console.log('[Content] MINIMIZE_QUICK_TAB deduplicated:', {
        quickTabId: message.quickTabId,
        reason: 'recently_executed'
      });
      sendResponse({ success: true, deduplicated: true });
      return true;
    }

    _handleMinimizeQuickTab(message.quickTabId, sendResponse);
    return true;
  },
  RESTORE_QUICK_TAB: (message, sendResponse) => {
    // v1.6.3.10-v10 - FIX Issue R: Pass sequenceId for ordering enforcement
    console.log('[Content] Received RESTORE_QUICK_TAB request:', {
      quickTabId: message.quickTabId,
      sequenceId: message.sequenceId
    });

    // v1.6.3.12-v13 - FIX Issue #48: Deduplicate commands from redundant delivery
    if (_isCommandDuplicate('RESTORE_QUICK_TAB', message.quickTabId)) {
      console.log('[Content] RESTORE_QUICK_TAB deduplicated:', {
        quickTabId: message.quickTabId,
        reason: 'recently_executed'
      });
      sendResponse({ success: true, deduplicated: true });
      return true;
    }

    _handleRestoreQuickTab(message.quickTabId, sendResponse, message.sequenceId);
    return true;
  },
  CLOSE_MINIMIZED_QUICK_TABS: (message, sendResponse) => {
    _handleCloseMinimizedQuickTabs(sendResponse);
    return true;
  },
  // v1.6.3.12-v7 - FIX BUG #4: Handle ADOPTION_COMPLETED to update local cache
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
  // v1.6.3.12-v7 - FIX Issue #17: Handle tabActivated action from background
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
  // v1.6.3.12-v7 - FIX Issue #17: Handle SYNC_QUICK_TAB_STATE_FROM_BACKGROUND action
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
 * v1.6.3.12-v7 - Extracted for code health
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
 * v1.6.3.12-v7 - Extracted for code health
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
  },

  // v1.6.4 - FIX BUG #2: Handle transfer messages received via browser.runtime.onMessage
  // These are sent by background when the port is not available for the target tab
  QUICK_TAB_TRANSFERRED_IN: (message, sendResponse) => {
    console.log('[Content] QUICK_TAB_TRANSFERRED_IN via sendMessage:', {
      quickTabId: message.quickTab?.id,
      source: message.source
    });
    _handleQuickTabTransferredIn(message);
    sendResponse({ success: true, handled: true });
    return true;
  },

  QUICK_TAB_TRANSFERRED_OUT: (message, sendResponse) => {
    console.log('[Content] QUICK_TAB_TRANSFERRED_OUT via sendMessage:', {
      quickTabId: message.quickTabId,
      newOriginTabId: message.newOriginTabId
    });
    _handleQuickTabTransferredOut(message);
    sendResponse({ success: true, handled: true });
    return true;
  },

  // v1.6.4 - FIX Code Review: Document that this handler intentionally reuses
  // _handleQuickTabTransferredIn because both operations create a Quick Tab on the
  // target tab with the same properties. The only difference is in the background
  // script's handling (transfer removes from source, duplicate creates new ID).
  CREATE_QUICK_TAB_FROM_DUPLICATE: (message, sendResponse) => {
    console.log('[Content] CREATE_QUICK_TAB_FROM_DUPLICATE via sendMessage:', {
      quickTabId: message.quickTab?.id,
      source: message.source
    });
    // Reuse the same handler as QUICK_TAB_TRANSFERRED_IN since both create a Quick Tab
    // from the provided quickTab data. The background handles the source tab differently.
    _handleQuickTabTransferredIn(message);
    sendResponse({ success: true, handled: true });
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
    // v1.6.3.11-v12 - Removed TEST_TOGGLE_SOLO and TEST_TOGGLE_MUTE handlers (Solo/Mute feature removed)
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
