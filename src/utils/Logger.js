/**
 * Structured Logger Utility
 * Provides consistent logging with levels, context, and timing
 * Implements Gap 7: Structured Logging from test-to-prod guide
 */

/**
 * Log levels in order of severity
 */
const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

/**
 * Log level names for output
 */
const LogLevelNames = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
};

/**
 * Configuration for logger
 */
const DEFAULT_CONFIG = {
  level: LogLevel.WARN, // Default to WARN in production
  enableTimestamp: true,
  enableContext: true,
  enablePerformanceTiming: true,
  prefix: 'QuickTabs',
};

/**
 * Structured Logger class
 */
class Logger {
  /**
   * Create a logger instance
   * @param {string} component - Component name (e.g., 'BroadcastManager')
   * @param {Object} config - Logger configuration
   */
  constructor(component, config = {}) {
    this.component = component;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.timers = new Map(); // For performance timing
  }

  /**
   * Set log level
   * @param {number} level - LogLevel value
   */
  setLevel(level) {
    this.config.level = level;
  }

  /**
   * Get current log level
   * @returns {number} Current LogLevel
   */
  getLevel() {
    return this.config.level;
  }

  /**
   * Check if level should be logged
   * @param {number} level - LogLevel to check
   * @returns {boolean} True if level should be logged
   */
  shouldLog(level) {
    return level <= this.config.level;
  }

  /**
   * Format log message with metadata
   * @param {number} level - LogLevel
   * @param {string} message - Log message
   * @param {Object} context - Additional context data
   * @returns {Array} Formatted log arguments
   */
  _formatMessage(level, message, context = {}) {
    const parts = [];

    // Add timestamp if enabled
    if (this.config.enableTimestamp) {
      const timestamp = new Date().toISOString();
      parts.push(`[${timestamp}]`);
    }

    // Add level name
    parts.push(`[${LogLevelNames[level]}]`);

    // Add prefix and component
    parts.push(`[${this.config.prefix}:${this.component}]`);

    // Add message
    parts.push(message);

    // Prepare context data
    const logArgs = [parts.join(' ')];

    // Add context if enabled and provided
    if (this.config.enableContext && Object.keys(context).length > 0) {
      logArgs.push(context);
    }

    return logArgs;
  }

  /**
   * Log error message
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   */
  error(message, context = {}) {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    const args = this._formatMessage(LogLevel.ERROR, message, context);
    console.error(...args);
  }

  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    if (!this.shouldLog(LogLevel.WARN)) return;
    const args = this._formatMessage(LogLevel.WARN, message, context);
    console.warn(...args);
  }

  /**
   * Log info message
   * @param {string} message - Info message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    if (!this.shouldLog(LogLevel.INFO)) return;
    const args = this._formatMessage(LogLevel.INFO, message, context);
    console.info(...args);
  }

  /**
   * Log debug message
   * @param {string} message - Debug message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    const args = this._formatMessage(LogLevel.DEBUG, message, context);
    console.log(...args);
  }

  /**
   * Start performance timer
   * @param {string} label - Timer label
   */
  startTimer(label) {
    if (!this.config.enablePerformanceTiming) return;
    this.timers.set(label, performance.now());
  }

  /**
   * End performance timer and log duration
   * @param {string} label - Timer label
   * @param {string} message - Optional message
   * @param {Object} context - Additional context
   * @returns {number|null} Duration in milliseconds or null if timer not found
   */
  endTimer(label, message = null, context = {}) {
    if (!this.config.enablePerformanceTiming) return null;

    const startTime = this.timers.get(label);
    if (!startTime) {
      this.warn(`Timer '${label}' not found`);
      return null;
    }

    const duration = performance.now() - startTime;
    this.timers.delete(label);

    const logMessage = message || `Timer '${label}' completed`;
    const logContext = {
      ...context,
      duration: `${duration.toFixed(2)}ms`,
      durationMs: duration,
    };

    // Log as warning if operation is slow (>100ms)
    if (duration > 100) {
      this.warn(`${logMessage} (SLOW)`, logContext);
    } else {
      this.debug(logMessage, logContext);
    }

    return duration;
  }

  /**
   * Log state snapshot
   * @param {Object} state - State object to log
   * @param {string} label - Optional label for snapshot
   */
  snapshot(state, label = 'State Snapshot') {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    this.debug(label, { state });
  }

  /**
   * Create child logger with additional context
   * @param {string} childComponent - Child component name
   * @param {Object} additionalConfig - Additional config overrides
   * @returns {Logger} New logger instance
   */
  child(childComponent, additionalConfig = {}) {
    const fullComponent = `${this.component}.${childComponent}`;
    const config = { ...this.config, ...additionalConfig };
    return new Logger(fullComponent, config);
  }

  /**
   * Group related logs together (console.group)
   * @param {string} label - Group label
   */
  startGroup(label) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    console.group(`[${this.config.prefix}:${this.component}] ${label}`);
  }

  /**
   * End log group (console.groupEnd)
   */
  endGroup() {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    console.groupEnd();
  }
}

/**
 * Create a logger instance
 * @param {string} component - Component name
 * @param {Object} config - Logger configuration
 * @returns {Logger} Logger instance
 */
function createLogger(component, config = {}) {
  return new Logger(component, config);
}

/**
 * Set global log level for all loggers
 * @param {number} level - LogLevel value
 */
function setGlobalLogLevel(level) {
  DEFAULT_CONFIG.level = level;
}

/**
 * Get log level from environment
 * Checks for DEBUG flag or development mode
 * @returns {number} Appropriate log level
 */
function getLogLevelFromEnvironment() {
  // Check if in development mode (web-ext uses NODE_ENV)
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    return LogLevel.DEBUG;
  }

  // Check for debug flag in storage (async, so default to WARN)
  return LogLevel.WARN;
}

// Export LogLevel for external use
export { LogLevel, createLogger, setGlobalLogLevel, getLogLevelFromEnvironment };

// Export default
export default Logger;
