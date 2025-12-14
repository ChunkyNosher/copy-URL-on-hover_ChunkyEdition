/**
 * StructuredLogger - Consistent structured logging across the extension
 *
 * Provides a unified logging interface with structured output for
 * easier debugging, filtering, and log aggregation.
 *
 * @module utils/structured-logger
 * @version 1.6.3.9
 */

/**
 * Log levels with numeric priority for filtering
 * @readonly
 * @enum {number}
 */
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

/**
 * Log level names for output
 * @readonly
 * @enum {string}
 */
const LEVEL_NAMES = {
  [LOG_LEVELS.DEBUG]: 'DEBUG',
  [LOG_LEVELS.INFO]: 'INFO',
  [LOG_LEVELS.WARN]: 'WARN',
  [LOG_LEVELS.ERROR]: 'ERROR',
  [LOG_LEVELS.CRITICAL]: 'CRITICAL'
};

/**
 * StructuredLogger class for consistent logging with context
 *
 * @example
 * const logger = new StructuredLogger('[Background]');
 * logger.info('init', 'Initialization complete', { version: '1.6.3.9' });
 * // Output: { timestamp: 1702577324000, level: 'INFO', context: '[Background]',
 * //          operation: 'init', message: 'Initialization complete', data: { version: '1.6.3.9' } }
 */
export class StructuredLogger {
  /**
   * Create a new StructuredLogger instance
   *
   * @param {string} context - Context prefix for this logger (e.g., '[Background]', '[Content]')
   * @param {Object} [options={}] - Logger options
   * @param {number} [options.minLevel=LOG_LEVELS.DEBUG] - Minimum log level to output
   * @param {boolean} [options.includeTimestamp=true] - Whether to include ISO timestamp
   */
  constructor(context, options = {}) {
    this.context = context;
    this.minLevel = options.minLevel ?? LOG_LEVELS.DEBUG;
    this.includeTimestamp = options.includeTimestamp ?? true;
  }

  /**
   * Build structured log entry
   *
   * @private
   * @param {number} level - Log level
   * @param {string} operation - Operation name
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data to include
   * @returns {Object} Structured log entry
   */
  _buildEntry(level, operation, message, data = {}) {
    // timestamp (ms) is always included for calculations/sorting
    // isoTime is optional human-readable format
    const entry = {
      timestamp: Date.now(),
      level: LEVEL_NAMES[level],
      context: this.context,
      operation,
      message
    };

    // Add human-readable ISO timestamp if enabled
    if (this.includeTimestamp) {
      entry.isoTime = new Date(entry.timestamp).toISOString();
    }

    // Only include data if non-empty
    if (data && Object.keys(data).length > 0) {
      entry.data = data;
    }

    return entry;
  }

  /**
   * Output log entry to console
   *
   * @private
   * @param {number} level - Log level
   * @param {Object} entry - Structured log entry
   */
  _output(level, entry) {
    if (level < this.minLevel) {
      return;
    }

    const prefix = `${entry.context} [${entry.operation}]`;
    const msg = entry.message;

    switch (level) {
      case LOG_LEVELS.DEBUG:
        console.debug(prefix, msg, entry);
        break;
      case LOG_LEVELS.INFO:
        console.info(prefix, msg, entry);
        break;
      case LOG_LEVELS.WARN:
        console.warn(prefix, msg, entry);
        break;
      case LOG_LEVELS.ERROR:
      case LOG_LEVELS.CRITICAL:
        console.error(prefix, msg, entry);
        break;
      default:
        console.log(prefix, msg, entry);
    }
  }

  /**
   * Log at DEBUG level
   *
   * @param {string} operation - Operation name
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data
   */
  debug(operation, message, data = {}) {
    const entry = this._buildEntry(LOG_LEVELS.DEBUG, operation, message, data);
    this._output(LOG_LEVELS.DEBUG, entry);
  }

  /**
   * Log at INFO level
   *
   * @param {string} operation - Operation name
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data
   */
  info(operation, message, data = {}) {
    const entry = this._buildEntry(LOG_LEVELS.INFO, operation, message, data);
    this._output(LOG_LEVELS.INFO, entry);
  }

  /**
   * Log at WARN level
   *
   * @param {string} operation - Operation name
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data
   */
  warn(operation, message, data = {}) {
    const entry = this._buildEntry(LOG_LEVELS.WARN, operation, message, data);
    this._output(LOG_LEVELS.WARN, entry);
  }

  /**
   * Log at ERROR level
   *
   * @param {string} operation - Operation name
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data
   */
  error(operation, message, data = {}) {
    const entry = this._buildEntry(LOG_LEVELS.ERROR, operation, message, data);
    this._output(LOG_LEVELS.ERROR, entry);
  }

  /**
   * Log at CRITICAL level
   *
   * @param {string} operation - Operation name
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data
   */
  critical(operation, message, data = {}) {
    const entry = this._buildEntry(LOG_LEVELS.CRITICAL, operation, message, data);
    this._output(LOG_LEVELS.CRITICAL, entry);
  }

  /**
   * Create a child logger with additional context
   *
   * @param {string} subContext - Additional context to append
   * @returns {StructuredLogger} New logger with combined context
   */
  child(subContext) {
    return new StructuredLogger(`${this.context}${subContext}`, {
      minLevel: this.minLevel,
      includeTimestamp: this.includeTimestamp
    });
  }
}

// ==================== PRE-CONFIGURED LOGGER INSTANCES ====================

/**
 * Background script logger
 * @type {StructuredLogger}
 */
export const backgroundLogger = new StructuredLogger('[Background]');

/**
 * Content script logger
 * @type {StructuredLogger}
 */
export const contentLogger = new StructuredLogger('[Content]');

/**
 * Manager (sidebar) logger
 * @type {StructuredLogger}
 */
export const managerLogger = new StructuredLogger('[Manager]');

/**
 * Storage operations logger
 * @type {StructuredLogger}
 */
export const storageLogger = new StructuredLogger('[Storage]');

/**
 * Messaging logger
 * @type {StructuredLogger}
 */
export const messagingLogger = new StructuredLogger('[Messaging]');

/**
 * Create a logger for a specific module
 *
 * @param {string} moduleName - Module name (will be wrapped in brackets)
 * @param {Object} [options={}] - Logger options
 * @returns {StructuredLogger} Configured logger instance
 */
export function createLogger(moduleName, options = {}) {
  const context = moduleName.startsWith('[') ? moduleName : `[${moduleName}]`;
  return new StructuredLogger(context, options);
}

// Default export
export default StructuredLogger;
