/**
 * Console Interceptor for Log Export
 * Captures all console.log/error/warn/info calls and stores them in a buffer
 *
 * CRITICAL: This must be imported FIRST in any script that needs log capture
 * to ensure console methods are overridden before any other code runs.
 *
 * v1.6.0.13 - Added live console filter support
 */

// ==================== IMPORTS ====================
import {
  isCategoryEnabledForLiveConsole,
  getCategoryIdFromDisplayName,
  settingsReady
} from './filter-settings.js';

// ==================== LOG BUFFER CONFIGURATION ====================
const MAX_BUFFER_SIZE = 5000;
const CONSOLE_LOG_BUFFER = [];

// ==================== CONSOLE METHOD OVERRIDES ====================

/**
 * Store original console methods
 * We save these to call after capturing logs
 */
const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console)
};

/**
 * Serialize Error object to preserve stack trace and properties
 * @param {Error} error - Error object to serialize
 * @returns {string} Serialized error string
 */
function serializeError(error) {
  const errorDetails = {
    type: error.constructor.name,
    message: error.message,
    stack: error.stack || '<no stack trace available>',
    ...(error.fileName && { fileName: error.fileName }),
    ...(error.lineNumber && { lineNumber: error.lineNumber }),
    ...(error.columnNumber && { columnNumber: error.columnNumber }),
    ...(error.cause && { cause: serializeError(error.cause) })
  };

  // Include any custom enumerable properties
  Object.keys(error).forEach(key => {
    if (!errorDetails[key]) {
      errorDetails[key] = error[key];
    }
  });

  try {
    return JSON.stringify(errorDetails, null, 2);
  } catch (err) {
    return `[Error: ${error.message}]\nStack: ${error.stack || 'unavailable'}`;
  }
}

/**
 * Serialize argument to string format suitable for logging
 * @param {*} arg - Argument to serialize
 * @returns {string} Serialized string representation
 */
function serializeArgument(arg) {
  // Handle null/undefined
  if (arg === null || arg === undefined) {
    return String(arg);
  }

  // Handle Error objects specially to preserve stack traces
  if (arg instanceof Error) {
    return serializeError(arg);
  }

  // Handle regular objects
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, null, 2);
    } catch (err) {
      return String(arg);
    }
  }

  // Handle primitives
  return String(arg);
}

/**
 * Extract category from log message
 * v1.6.0.13 - Added category extraction for filtering
 * Handles various log formats used throughout extension
 */
function extractCategoryFromMessage(message) {
  // Pattern 1: [Category Display Name] [Action] Message
  const categoryPattern = /^\[([^\]]+)\]\s*\[([^\]]+)\]/;
  const match = message.match(categoryPattern);

  if (match) {
    const displayName = match[1];
    return getCategoryIdFromDisplayName(displayName);
  }

  // Pattern 2: [Component] Message (e.g., [Background], [QuickTabHandler])
  const componentPattern = /^\[([^\]]+)\]/;
  const componentMatch = message.match(componentPattern);

  if (componentMatch) {
    const component = componentMatch[1];
    return getCategoryIdFromDisplayName(component);
  }

  return 'uncategorized';
}

/**
 * Add log entry to buffer with automatic size management
 * v1.6.0.13 - Now stores category for export filtering
 */
function addToLogBuffer(type, args, category = null) {
  // Prevent buffer overflow
  if (CONSOLE_LOG_BUFFER.length >= MAX_BUFFER_SIZE) {
    CONSOLE_LOG_BUFFER.shift(); // Remove oldest entry
  }

  // Format arguments into string using enhanced serializer
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');

  // Extract category from message if not provided
  const extractedCategory = category || extractCategoryFromMessage(message);

  // Add to buffer (always stored, regardless of filter)
  CONSOLE_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: message,
    category: extractedCategory,
    context: getExecutionContext()
  });
}

/**
 * Detect execution context for debugging
 */
function getExecutionContext() {
  if (typeof document !== 'undefined' && document.currentScript) {
    return 'content-script';
  } else if (
    typeof browser !== 'undefined' &&
    browser.runtime &&
    browser.runtime.getBackgroundPage
  ) {
    return 'background';
  } else if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.protocol === 'moz-extension:'
  ) {
    return 'popup';
  }
  return 'unknown';
}

/**
 * Override console.log to capture logs AND respect live console filter
 * v1.6.0.13 - FIX: Now checks live console filter before logging
 */
console.log = function (...args) {
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');
  const category = extractCategoryFromMessage(message);

  // Always add to buffer (for export)
  addToLogBuffer('LOG', args, category);

  // Check live console filter before logging to console
  if (isCategoryEnabledForLiveConsole(category)) {
    originalConsole.log.apply(console, args);
  }
  // If disabled, log is buffered but NOT displayed in console
};

/**
 * Override console.error to capture errors
 * v1.6.0.13 - Errors ALWAYS logged regardless of filter (critical)
 */
console.error = function (...args) {
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');
  const category = extractCategoryFromMessage(message);

  addToLogBuffer('ERROR', args, category);

  // Errors ALWAYS logged to console (critical for debugging)
  originalConsole.error.apply(console, args);
};

/**
 * Override console.warn to capture warnings
 * v1.6.0.13 - Warnings ALWAYS logged regardless of filter
 */
console.warn = function (...args) {
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');
  const category = extractCategoryFromMessage(message);

  addToLogBuffer('WARN', args, category);

  // Warnings ALWAYS logged to console
  originalConsole.warn.apply(console, args);
};

/**
 * Override console.info to capture info
 * v1.6.0.13 - Respects live console filter
 */
console.info = function (...args) {
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');
  const category = extractCategoryFromMessage(message);

  addToLogBuffer('INFO', args, category);

  if (isCategoryEnabledForLiveConsole(category)) {
    originalConsole.info.apply(console, args);
  }
};

/**
 * Override console.debug to capture debug messages
 * v1.6.0.13 - Respects live console filter
 */
console.debug = function (...args) {
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');
  const category = extractCategoryFromMessage(message);

  addToLogBuffer('DEBUG', args, category);

  if (isCategoryEnabledForLiveConsole(category)) {
    originalConsole.debug.apply(console, args);
  }
};

// ==================== GLOBAL ERROR CAPTURE ====================
// Capture errors that don't go through console.* methods

// Only add listeners if in browser context (not in background/service worker without window)
if (typeof window !== 'undefined') {
  // Capture uncaught exceptions
  window.addEventListener(
    'error',
    event => {
      const errorInfo = {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      };

      addToLogBuffer('ERROR', ['[Uncaught Exception]', errorInfo]);
    },
    true
  ); // Use capture phase to get it first

  // Capture unhandled promise rejections
  window.addEventListener(
    'unhandledrejection',
    event => {
      addToLogBuffer('ERROR', ['[Unhandled Promise Rejection]', event.reason]);
    },
    true
  );

  originalConsole.log('[Console Interceptor] Global error handlers installed');
}

// ==================== EXPORT API ====================

/**
 * Get all captured logs
 * @returns {Array<Object>} Array of log entries
 */
export function getConsoleLogs() {
  return [...CONSOLE_LOG_BUFFER]; // Return copy to prevent mutation
}

/**
 * Get console logs with export filtering applied
 * @param {Function} filterFn - Filter function to apply
 * @returns {Array<Object>} Filtered log entries
 */
export function getFilteredConsoleLogs(filterFn) {
  const logs = getConsoleLogs();
  if (typeof filterFn === 'function') {
    return filterFn(logs);
  }
  return logs;
}

/**
 * Clear all captured logs
 */
export function clearConsoleLogs() {
  CONSOLE_LOG_BUFFER.length = 0;
  originalConsole.log('[Console Interceptor] Log buffer cleared');
}

/**
 * Get buffer statistics
 * @returns {Object} Buffer stats
 */
export function getBufferStats() {
  return {
    totalLogs: CONSOLE_LOG_BUFFER.length,
    maxSize: MAX_BUFFER_SIZE,
    utilizationPercent: ((CONSOLE_LOG_BUFFER.length / MAX_BUFFER_SIZE) * 100).toFixed(2),
    oldestTimestamp: CONSOLE_LOG_BUFFER[0]?.timestamp || null,
    newestTimestamp: CONSOLE_LOG_BUFFER[CONSOLE_LOG_BUFFER.length - 1]?.timestamp || null
  };
}

/**
 * Restore original console methods (for testing)
 */
export function restoreConsole() {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
  originalConsole.log('[Console Interceptor] Original console methods restored');
}

// Log successful initialization
originalConsole.log('[Console Interceptor] ✓ Console methods overridden successfully');
originalConsole.log('[Console Interceptor] Buffer size:', MAX_BUFFER_SIZE);
originalConsole.log('[Console Interceptor] Context:', getExecutionContext());

// ==================== ASYNC INITIALIZATION ====================
// Wait for filter settings to load from storage in background
// This doesn't block console interception (already active with defaults)
// but ensures settings are synced as soon as possible
settingsReady
  .then(result => {
    if (result.success) {
      originalConsole.log(
        `[Console Interceptor] ✓ Filter settings loaded (source: ${result.source})`
      );
    } else {
      originalConsole.warn(
        `[Console Interceptor] ⚠ Using default filters (${result.source}):`,
        result.error
      );
    }
  })
  .catch(error => {
    // This should never happen since settingsReady always resolves
    originalConsole.error('[Console Interceptor] Unexpected promise rejection:', error);
  });
