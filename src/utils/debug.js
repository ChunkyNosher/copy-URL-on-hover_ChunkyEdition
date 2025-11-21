/**
 * Debug Utilities with Log Export
 * Helper functions for debugging, logging, and exporting logs
 */

import { filterLogsByExportCategories, generateExportMetadata } from './logger.js';

let DEBUG_MODE = false;

// Log buffer to store all logs
const LOG_BUFFER = [];
const MAX_BUFFER_SIZE = 5000; // Prevent memory overflow

/**
 * Log entry structure
 * @typedef {Object} LogEntry
 * @property {string} type - Log type (DEBUG, ERROR, WARN, INFO)
 * @property {number} timestamp - Unix timestamp
 * @property {string} message - Log message
 * @property {Array} args - Additional arguments
 */

/**
 * Add log entry to buffer
 * @param {string} type - Log type
 * @param {...any} args - Arguments to log
 */
function addToBuffer(type, ...args) {
  if (LOG_BUFFER.length >= MAX_BUFFER_SIZE) {
    // Remove oldest entry if buffer is full
    LOG_BUFFER.shift();
  }

  LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: args
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' '),
    args: args
  });
}

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
  addToBuffer('DEBUG', ...args);
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

/**
 * Error logging function
 * @param {...any} args - Arguments to log
 */
export function debugError(...args) {
  addToBuffer('ERROR', ...args);
  console.error('[ERROR]', ...args);
}

/**
 * Warning logging function
 * @param {...any} args - Arguments to log
 */
export function debugWarn(...args) {
  addToBuffer('WARN', ...args);
  if (DEBUG_MODE) {
    console.warn('[WARN]', ...args);
  }
}

/**
 * Info logging function
 * @param {...any} args - Arguments to log
 */
export function debugInfo(...args) {
  addToBuffer('INFO', ...args);
  console.info('[INFO]', ...args);
}

/**
 * Get all buffered logs
 * @returns {Array<LogEntry>} Array of log entries
 */
export function getLogBuffer() {
  return [...LOG_BUFFER]; // Return copy to prevent mutation
}

/**
 * Clear log buffer
 */
export function clearLogBuffer() {
  LOG_BUFFER.length = 0;
  console.log('[DEBUG] Log buffer cleared');
}

/**
 * Format logs as plain text with export metadata
 * @param {Array<LogEntry>} logs - Array of log entries
 * @param {string} version - Extension version
 * @param {number} totalLogsBeforeFilter - Total logs before filtering
 * @param {string} metadata - Filter metadata
 * @returns {string} Formatted log text
 */
export function formatLogsAsText(
  logs,
  version = '1.6.0.8',
  _totalLogsBeforeFilter = 0,
  metadata = ''
) {
  const now = new Date();
  const header = [
    '='.repeat(80),
    'Copy URL on Hover - Extension Console Logs',
    '='.repeat(80),
    '',
    `Version: ${version}`,
    `Export Date: ${now.toISOString()}`,
    `Export Date (Local): ${now.toLocaleString()}`,
    '',
    metadata,
    '',
    '='.repeat(80),
    'BEGIN LOGS',
    '='.repeat(80),
    ''
  ].join('\n');

  const logLines = logs.map(entry => {
    const date = new Date(entry.timestamp);
    const timestamp = date.toISOString();
    return `[${timestamp}] [${entry.type.padEnd(5)}] ${entry.message}`;
  });

  const footer = ['', '='.repeat(80), 'End of Logs', '='.repeat(80)].join('\n');

  return header + logLines.join('\n') + footer;
}

/**
 * Generate filename for log export
 * @param {string} version - Extension version
 * @returns {string} Filename with version and timestamp
 */
export function generateLogFilename(version = '1.6.0.8') {
  const now = new Date();
  // ISO 8601 format with hyphens instead of colons for filename compatibility
  const timestamp = now.toISOString().replace(/:/g, '-').split('.')[0];
  return `copy-url-extension-logs_v${version}_${timestamp}.txt`;
}

/**
 * Export logs as downloadable .txt file
 * @param {string} version - Extension version from manifest
 * @returns {Promise<void>}
 */
/**
 * Try to get logs from background script
 * @param {Array} logs - Logs array to append to
 * @private
 */
async function _fetchBackgroundLogs(logs) {
  try {
    const response = await browser.runtime.sendMessage({
      action: 'GET_BACKGROUND_LOGS'
    });
    if (response && response.logs) {
      logs.push(...response.logs);
    }
  } catch (error) {
    console.warn('[WARN] Could not retrieve background logs:', error);
  }
}

/**
 * Try to download using browser.downloads API
 * @param {string} logText - Formatted log text
 * @param {string} filename - Filename for download
 * @returns {boolean} True if successful
 * @private
 */
async function _tryBrowserDownloadsAPI(logText, filename) {
  if (!browser || !browser.downloads || !browser.downloads.download) {
    return false;
  }

  try {
    // Create blob
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Download via browser API
    await browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 100);

    console.log('[INFO] Logs exported successfully via browser.downloads API');
    return true;
  } catch (error) {
    console.warn('[WARN] browser.downloads failed, falling back to Blob URL:', error);
    return false;
  }
}

/**
 * Download using blob URL fallback method
 * @param {string} logText - Formatted log text
 * @param {string} filename - Filename for download
 * @private
 */
function _downloadViaBlob(logText, filename) {
  const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  // Create temporary download link
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.style.display = 'none';

  // Append to body (required for Firefox)
  document.body.appendChild(link);

  // Trigger download
  link.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }, 100);

  console.log('[INFO] Logs exported successfully via Blob URL fallback');
}

export async function exportLogs(version = '1.6.0.8') {
  try {
    // Get logs from current page
    const logs = getLogBuffer();

    // Try to get logs from background script
    await _fetchBackgroundLogs(logs);

    // Sort logs by timestamp
    logs.sort((a, b) => a.timestamp - b.timestamp);

    // Store total before filtering
    const totalLogsBeforeFilter = logs.length;

    // Apply export category filters
    const filteredLogs = await filterLogsByExportCategories(logs);

    // Generate filter metadata
    const metadata = await generateExportMetadata(totalLogsBeforeFilter, filteredLogs.length);

    // Format logs with metadata
    const logText = formatLogsAsText(filteredLogs, version, totalLogsBeforeFilter, metadata);

    // Generate filename
    const filename = generateLogFilename(version);

    // Try Method 1: browser.downloads.download() API (if permission granted)
    const browserApiSuccess = await _tryBrowserDownloadsAPI(logText, filename);
    if (browserApiSuccess) {
      return { total: totalLogsBeforeFilter, exported: filteredLogs.length };
    }

    // Method 2: Blob URL + <a> download attribute (fallback)
    _downloadViaBlob(logText, filename);

    console.log('[INFO] Logs exported successfully via Blob URL');
    return { total: totalLogsBeforeFilter, exported: filteredLogs.length };
  } catch (error) {
    console.error('[ERROR] Failed to export logs:', error);
    throw error;
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
