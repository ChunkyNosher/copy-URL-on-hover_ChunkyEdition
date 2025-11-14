/**
 * Debug Utilities
 * Helper functions for debugging and logging
 */

let DEBUG_MODE = false;

/**
 * Enable debug mode
 */
export function enableDebug() {
  DEBUG_MODE = true;
}

/**
 * Disable debug mode
 */
export function disableDebug() {
  DEBUG_MODE = false;
}

/**
 * Check if debug mode is enabled
 * @returns {boolean} True if debug mode is enabled
 */
export function isDebugEnabled() {
  return DEBUG_MODE;
}

/**
 * Debug logging function
 * @param {...any} args - Arguments to log
 */
export function debug(...args) {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

/**
 * Error logging function
 * @param {...any} args - Arguments to log
 */
export function debugError(...args) {
  console.error('[ERROR]', ...args);
}

/**
 * Warning logging function
 * @param {...any} args - Arguments to log
 */
export function debugWarn(...args) {
  if (DEBUG_MODE) {
    console.warn('[WARN]', ...args);
  }
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Throttle function execution
 * @param {function} func - Function to throttle
 * @param {number} delay - Delay in milliseconds
 * @returns {function} Throttled function
 */
export function throttle(func, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
}

/**
 * Debounce function execution
 * @param {function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {function} Debounced function
 */
export function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}
