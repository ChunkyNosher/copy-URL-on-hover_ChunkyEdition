/**
 * Console Interceptor for Log Export
 * Captures all console.log/error/warn/info calls and stores them in a buffer
 *
 * CRITICAL: This must be imported FIRST in any script that needs log capture
 * to ensure console methods are overridden before any other code runs.
 */

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
 * Add log entry to buffer with automatic size management
 */
function addToLogBuffer(type, args) {
  // Prevent buffer overflow
  if (CONSOLE_LOG_BUFFER.length >= MAX_BUFFER_SIZE) {
    CONSOLE_LOG_BUFFER.shift(); // Remove oldest entry
  }

  // Format arguments into string
  const message = Array.from(args)
    .map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (err) {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');

  // Add to buffer
  CONSOLE_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: message,
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
 * Override console.log to capture logs
 */
console.log = function (...args) {
  addToLogBuffer('LOG', args);
  originalConsole.log.apply(console, args);
};

/**
 * Override console.error to capture errors
 */
console.error = function (...args) {
  addToLogBuffer('ERROR', args);
  originalConsole.error.apply(console, args);
};

/**
 * Override console.warn to capture warnings
 */
console.warn = function (...args) {
  addToLogBuffer('WARN', args);
  originalConsole.warn.apply(console, args);
};

/**
 * Override console.info to capture info
 */
console.info = function (...args) {
  addToLogBuffer('INFO', args);
  originalConsole.info.apply(console, args);
};

/**
 * Override console.debug to capture debug messages
 */
console.debug = function (...args) {
  addToLogBuffer('DEBUG', args);
  originalConsole.debug.apply(console, args);
};

// ==================== EXPORT API ====================

/**
 * Get all captured logs
 * @returns {Array<Object>} Array of log entries
 */
export function getConsoleLogs() {
  return [...CONSOLE_LOG_BUFFER]; // Return copy to prevent mutation
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
