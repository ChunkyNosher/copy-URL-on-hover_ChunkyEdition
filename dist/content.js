(function (browser$1) {
  'use strict';

  /**
   * Console Interceptor for Log Export
   * Captures all console.log/error/warn/info calls and stores them in a buffer
   *
   * CRITICAL: This must be imported FIRST in any script that needs log capture
   * to ensure console methods are overridden before any other code runs.
   */

  // ==================== LOG BUFFER CONFIGURATION ====================
  const MAX_BUFFER_SIZE$1 = 5000;
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
    if (CONSOLE_LOG_BUFFER.length >= MAX_BUFFER_SIZE$1) {
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
  function getConsoleLogs() {
    return [...CONSOLE_LOG_BUFFER]; // Return copy to prevent mutation
  }

  /**
   * Clear all captured logs
   */
  function clearConsoleLogs() {
    CONSOLE_LOG_BUFFER.length = 0;
    originalConsole.log('[Console Interceptor] Log buffer cleared');
  }

  /**
   * Get buffer statistics
   * @returns {Object} Buffer stats
   */
  function getBufferStats() {
    return {
      totalLogs: CONSOLE_LOG_BUFFER.length,
      maxSize: MAX_BUFFER_SIZE$1,
      utilizationPercent: ((CONSOLE_LOG_BUFFER.length / MAX_BUFFER_SIZE$1) * 100).toFixed(2),
      oldestTimestamp: CONSOLE_LOG_BUFFER[0]?.timestamp || null,
      newestTimestamp: CONSOLE_LOG_BUFFER[CONSOLE_LOG_BUFFER.length - 1]?.timestamp || null
    };
  }

  /**
   * Restore original console methods (for testing)
   */
  function restoreConsole() {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    originalConsole.log('[Console Interceptor] Original console methods restored');
  }

  // Log successful initialization
  originalConsole.log('[Console Interceptor] ✓ Console methods overridden successfully');
  originalConsole.log('[Console Interceptor] Buffer size:', MAX_BUFFER_SIZE$1);
  originalConsole.log('[Console Interceptor] Context:', getExecutionContext());

  /**
   * Browser API Utilities
   * Wrapper functions for WebExtension APIs
   */

  /**
   * Send message to background script
   * @param {object} message - Message object
   * @returns {Promise<any>} Response from background script
   */
  async function sendMessageToBackground(message) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err) {
      console.error('[Browser API] Failed to send message to background:', err);
      throw err;
    }
  }

  /**
   * Get data from storage
   * @param {string|string[]} keys - Storage key(s)
   * @param {string} storageType - Storage type (local, sync, or session)
   * @returns {Promise<object>} Storage data
   */
  async function getStorage(keys, storageType = 'local') {
    try {
      const storage = browser.storage[storageType];
      if (!storage) {
        throw new Error(`Storage type "${storageType}" not available`);
      }
      return await storage.get(keys);
    } catch (err) {
      console.error('[Browser API] Failed to get storage:', err);
      throw err;
    }
  }

  /**
   * Set data in storage
   * @param {object} data - Data to store
   * @param {string} storageType - Storage type (local, sync, or session)
   * @returns {Promise<void>}
   */
  async function setStorage(data, storageType = 'local') {
    try {
      const storage = browser.storage[storageType];
      if (!storage) {
        throw new Error(`Storage type "${storageType}" not available`);
      }
      await storage.set(data);
    } catch (err) {
      console.error('[Browser API] Failed to set storage:', err);
      throw err;
    }
  }

  /**
   * Remove data from storage
   * @param {string|string[]} keys - Storage key(s) to remove
   * @param {string} storageType - Storage type (local, sync, or session)
   * @returns {Promise<void>}
   */
  async function removeStorage(keys, storageType = 'local') {
    try {
      const storage = browser.storage[storageType];
      if (!storage) {
        throw new Error(`Storage type "${storageType}" not available`);
      }
      await storage.remove(keys);
    } catch (err) {
      console.error('[Browser API] Failed to remove storage:', err);
      throw err;
    }
  }

  /**
   * Clear all data from storage
   * @param {string} storageType - Storage type (local, sync, or session)
   * @returns {Promise<void>}
   */
  async function clearStorage(storageType = 'local') {
    try {
      const storage = browser.storage[storageType];
      if (!storage) {
        throw new Error(`Storage type "${storageType}" not available`);
      }
      await storage.clear();
    } catch (err) {
      console.error('[Browser API] Failed to clear storage:', err);
      throw err;
    }
  }

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @returns {Promise<boolean>} True if successful
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('[Browser API] Failed to copy to clipboard:', err);

      // Fallback to execCommand
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
      } catch (fallbackErr) {
        console.error('[Browser API] Fallback copy also failed:', fallbackErr);
        return false;
      }
    }
  }

  /**
   * Get current tab information
   * @returns {Promise<object>} Tab information
   */
  async function getCurrentTab() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      return tabs[0] || null;
    } catch (err) {
      console.error('[Browser API] Failed to get current tab:', err);
      return null;
    }
  }

  /**
   * Create a new tab
   * @param {object} options - Tab creation options
   * @returns {Promise<object>} Created tab
   */
  async function createTab(options) {
    try {
      return await browser.tabs.create(options);
    } catch (err) {
      console.error('[Browser API] Failed to create tab:', err);
      throw err;
    }
  }

  /**
   * Get container information (Firefox only)
   * @param {number} containerId - Container ID
   * @returns {Promise<object|null>} Container information
   */
  async function getContainer(containerId) {
    try {
      if (browser.contextualIdentities && browser.contextualIdentities.get) {
        return await browser.contextualIdentities.get(`firefox-container-${containerId}`);
      }
      return null;
    } catch (err) {
      console.error('[Browser API] Failed to get container:', err);
      return null;
    }
  }

  /**
   * Check if browser supports a specific API
   * @param {string} apiPath - API path (e.g., 'storage.session')
   * @returns {boolean} True if API is supported
   */
  function isApiSupported(apiPath) {
    const parts = apiPath.split('.');
    let current = browser;

    for (const part of parts) {
      if (!current || !current[part]) {
        return false;
      }
      current = current[part];
    }

    return true;
  }

  /**
   * Configuration Manager
   * Handles extension configuration and constants
   */

  const DEFAULT_CONFIG = {
    copyUrlKey: 'y',
    copyUrlCtrl: false,
    copyUrlAlt: false,
    copyUrlShift: false,

    copyTextKey: 'x',
    copyTextCtrl: false,
    copyTextAlt: false,
    copyTextShift: false,

    // Open Link in New Tab settings
    openNewTabKey: 'o',
    openNewTabCtrl: false,
    openNewTabAlt: false,
    openNewTabShift: false,
    openNewTabSwitchFocus: false,

    // Quick Tab on Hover settings
    quickTabKey: 'q',
    quickTabCtrl: false,
    quickTabAlt: false,
    quickTabShift: false,
    quickTabCloseKey: 'Escape',
    quickTabMaxWindows: 3,
    quickTabDefaultWidth: 800,
    quickTabDefaultHeight: 600,
    quickTabPosition: 'follow-cursor',
    quickTabCustomX: 100,
    quickTabCustomY: 100,
    quickTabCloseOnOpen: false,
    quickTabEnableResize: true,
    quickTabUpdateRate: 360, // Position updates per second (Hz) for dragging

    showNotification: true,
    notifDisplayMode: 'tooltip',

    // Tooltip settings
    tooltipColor: '#4CAF50',
    tooltipDuration: 1500,
    tooltipAnimation: 'fade',

    // Notification settings
    notifColor: '#4CAF50',
    notifDuration: 2000,
    notifPosition: 'bottom-right',
    notifSize: 'medium',
    notifBorderColor: '#000000',
    notifBorderWidth: 1,
    notifAnimation: 'slide',

    debugMode: false,
    darkMode: true,
    menuSize: 'medium'
  };

  const CONSTANTS = {
    GOOGLE_FAVICON_URL: 'https://www.google.com/s2/favicons?domain=',
    TOOLTIP_OFFSET_X: 10,
    TOOLTIP_OFFSET_Y: 10,
    TOOLTIP_DURATION_MS: 1500,
    TOOLTIP_FADE_OUT_MS: 200,
    QUICK_TAB_BASE_Z_INDEX: 1000000
  };

  class ConfigManager {
    constructor() {
      this.config = { ...DEFAULT_CONFIG };
      this.listeners = [];
    }

    /**
     * Load configuration from browser storage
     */
    async load() {
      console.log('[ConfigManager] Starting configuration load...');
      try {
        // Verify browser.storage is available
        if (!browser || !browser.storage || !browser.storage.local) {
          console.error('[ConfigManager] browser.storage.local is not available!');
          console.warn('[ConfigManager] Using DEFAULT_CONFIG as fallback');
          this.config = { ...DEFAULT_CONFIG };
          return this.config;
        }

        console.log('[ConfigManager] Calling browser.storage.local.get...');
        // Load all settings from storage (popup.js saves them as individual keys)
        const result = await browser.storage.local.get(DEFAULT_CONFIG);

        console.log('[ConfigManager] Storage get completed, processing result...');
        if (!result || typeof result !== 'object') {
          console.warn('[ConfigManager] Invalid storage result, using DEFAULT_CONFIG');
          this.config = { ...DEFAULT_CONFIG };
          return this.config;
        }

        // Merge with defaults (user settings override defaults)
        this.config = { ...DEFAULT_CONFIG, ...result };

        console.log('[ConfigManager] Configuration loaded successfully');
        console.log('[ConfigManager] Config summary:', {
          debugMode: this.config.debugMode,
          totalKeys: Object.keys(this.config).length
        });
      } catch (err) {
        console.error('[ConfigManager] Exception during load:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        console.warn('[ConfigManager] Falling back to DEFAULT_CONFIG due to exception');
        this.config = { ...DEFAULT_CONFIG };
      }

      return this.config;
    }

    /**
     * Save configuration to browser storage
     */
    async save() {
      try {
        // Save settings as individual keys to match popup.js behavior
        await browser.storage.local.set(this.config);
      } catch (err) {
        console.error('[Config] Failed to save configuration:', err);
      }
    }

    /**
     * Get a configuration value
     * @param {string} key - Configuration key
     * @returns {any} Configuration value
     */
    get(key) {
      return this.config[key];
    }

    /**
     * Set a configuration value
     * @param {string} key - Configuration key
     * @param {any} value - Configuration value
     */
    set(key, value) {
      this.config[key] = value;
      this.notifyListeners(key, value);
    }

    /**
     * Get all configuration
     * @returns {object} Configuration object
     */
    getAll() {
      return { ...this.config };
    }

    /**
     * Update multiple configuration values
     * @param {object} updates - Configuration updates
     */
    update(updates) {
      this.config = { ...this.config, ...updates };
      this.notifyListeners();
    }

    /**
     * Register a listener for configuration changes
     * @param {function} callback - Callback function
     */
    onChange(callback) {
      this.listeners.push(callback);
    }

    /**
     * Notify all listeners of configuration changes
     * @param {string} key - Optional key that changed
     * @param {any} value - Optional new value
     */
    notifyListeners(key, value) {
      this.listeners.forEach(listener => listener(key, value, this.config));
    }
  }

  /**
   * Event Bus
   * Pub/sub event system for inter-module communication
   */

  class EventBus {
    constructor() {
      this.events = new Map();
      this.debugMode = false;
    }

    /**
     * Subscribe to an event
     * @param {string} eventName - Event name
     * @param {function} callback - Callback function
     * @returns {function} Unsubscribe function
     */
    on(eventName, callback) {
      if (!this.events.has(eventName)) {
        this.events.set(eventName, []);
      }

      this.events.get(eventName).push(callback);

      if (this.debugMode) {
        console.log(`[EventBus] Subscribed to "${eventName}"`);
      }

      // Return unsubscribe function
      return () => this.off(eventName, callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventName - Event name
     * @param {function} callback - Callback function
     */
    off(eventName, callback) {
      if (!this.events.has(eventName)) return;

      const callbacks = this.events.get(eventName);
      const index = callbacks.indexOf(callback);

      if (index !== -1) {
        callbacks.splice(index, 1);

        if (this.debugMode) {
          console.log(`[EventBus] Unsubscribed from "${eventName}"`);
        }
      }

      // Clean up empty event arrays
      if (callbacks.length === 0) {
        this.events.delete(eventName);
      }
    }

    /**
     * Emit an event
     * @param {string} eventName - Event name
     * @param {any} data - Event data
     */
    emit(eventName, data) {
      if (!this.events.has(eventName)) return;

      if (this.debugMode) {
        console.log(`[EventBus] Emitting "${eventName}"`, data);
      }

      const callbacks = this.events.get(eventName);
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`[EventBus] Error in "${eventName}" handler:`, err);
        }
      });
    }

    /**
     * Subscribe to an event once
     * @param {string} eventName - Event name
     * @param {function} callback - Callback function
     * @returns {function} Unsubscribe function
     */
    once(eventName, callback) {
      const onceCallback = data => {
        callback(data);
        this.off(eventName, onceCallback);
      };

      return this.on(eventName, onceCallback);
    }

    /**
     * Enable debug logging
     */
    enableDebug() {
      this.debugMode = true;
    }

    /**
     * Disable debug logging
     */
    disableDebug() {
      this.debugMode = false;
    }

    /**
     * Clear all event listeners
     */
    clear() {
      this.events.clear();
    }

    /**
     * Get all registered event names
     * @returns {string[]} Array of event names
     */
    getEventNames() {
      return Array.from(this.events.keys());
    }

    /**
     * Get listener count for an event
     * @param {string} eventName - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(eventName) {
      return this.events.has(eventName) ? this.events.get(eventName).length : 0;
    }
  }

  /**
   * Predefined event names for type safety and documentation
   */
  const Events = {
    // Quick Tab events
    QUICK_TAB_CREATED: 'quickTab:created',
    QUICK_TAB_CLOSED: 'quickTab:closed',
    QUICK_TAB_MINIMIZED: 'quickTab:minimized',
    QUICK_TAB_RESTORED: 'quickTab:restored',
    QUICK_TAB_PINNED: 'quickTab:pinned',
    QUICK_TAB_UNPINNED: 'quickTab:unpinned',
    QUICK_TAB_MOVED: 'quickTab:moved',
    QUICK_TAB_RESIZED: 'quickTab:resized',
    QUICK_TAB_ALL_CLOSED: 'quickTab:allClosed',
    QUICK_TAB_REQUESTED: 'quickTab:requested',
    QUICK_TAB_FOCUS_CHANGED: 'quickTab:focusChanged',

    // Panel events
    PANEL_TOGGLED: 'panel:toggled',
    PANEL_OPENED: 'panel:opened',
    PANEL_CLOSED: 'panel:closed',
    PANEL_MOVED: 'panel:moved',
    PANEL_RESIZED: 'panel:resized',

    // URL events
    URL_COPIED: 'url:copied',
    TEXT_COPIED: 'text:copied',
    LINK_OPENED: 'link:opened',

    // Hover events
    HOVER_START: 'hover:start',
    HOVER_END: 'hover:end',

    // Storage events
    STORAGE_UPDATED: 'storage:updated',
    STORAGE_SYNCED: 'storage:synced',

    // Broadcast events
    BROADCAST_RECEIVED: 'broadcast:received',

    // Error events
    ERROR: 'error',

    // Drag events
    DRAG_START: 'drag:start',
    DRAG_MOVE: 'drag:move',
    DRAG_END: 'drag:end',

    // Resize events
    RESIZE_START: 'resize:start',
    RESIZE_MOVE: 'resize:move',
    RESIZE_END: 'resize:end'
  };

  /**
   * State Manager
   * Centralized state management for the extension
   */

  let StateManager$1 = class StateManager {
    constructor() {
      this.state = {
        currentHoveredLink: null,
        currentHoveredElement: null,
        quickTabWindows: [],
        minimizedQuickTabs: [],
        quickTabZIndex: 1000000,
        lastMouseX: 0,
        lastMouseY: 0,
        isSavingToStorage: false,
        isPanelOpen: false
      };
      this.listeners = new Map();
    }

    /**
     * Get current state
     * @returns {object} Current state
     */
    getState() {
      return { ...this.state };
    }

    /**
     * Get a specific state value
     * @param {string} key - State key
     * @returns {any} State value
     */
    get(key) {
      return this.state[key];
    }

    /**
     * Set a specific state value
     * @param {string} key - State key
     * @param {any} value - State value
     */
    set(key, value) {
      const oldValue = this.state[key];
      this.state[key] = value;
      this.notifyListeners(key, value, oldValue);
    }

    /**
     * Update multiple state values
     * @param {object} updates - State updates
     */
    setState(updates) {
      const oldState = { ...this.state };
      this.state = { ...this.state, ...updates };

      // Notify listeners for each changed key
      Object.keys(updates).forEach(key => {
        if (oldState[key] !== updates[key]) {
          this.notifyListeners(key, updates[key], oldState[key]);
        }
      });
    }

    /**
     * Subscribe to state changes
     * @param {string|function} keyOrCallback - State key or callback for all changes
     * @param {function} callback - Optional callback if key is provided
     * @returns {function} Unsubscribe function
     */
    subscribe(keyOrCallback, callback) {
      if (typeof keyOrCallback === 'function') {
        // Subscribe to all state changes
        const id = Symbol('listener');
        this.listeners.set(id, { key: '*', callback: keyOrCallback });
        return () => this.listeners.delete(id);
      } else {
        // Subscribe to specific key changes
        const id = Symbol('listener');
        this.listeners.set(id, { key: keyOrCallback, callback });
        return () => this.listeners.delete(id);
      }
    }

    /**
     * Notify listeners of state changes
     * @param {string} key - Changed key
     * @param {any} newValue - New value
     * @param {any} oldValue - Old value
     */
    notifyListeners(key, newValue, oldValue) {
      this.listeners.forEach(({ key: listenerKey, callback }) => {
        if (listenerKey === '*' || listenerKey === key) {
          try {
            callback(key, newValue, oldValue, this.state);
          } catch (err) {
            console.error('[State] Listener error:', err);
          }
        }
      });
    }

    /**
     * Reset state to initial values
     */
    reset() {
      this.state = {
        currentHoveredLink: null,
        currentHoveredElement: null,
        quickTabWindows: [],
        minimizedQuickTabs: [],
        quickTabZIndex: 1000000,
        lastMouseX: 0,
        lastMouseY: 0,
        isSavingToStorage: false,
        isPanelOpen: false
      };
      this.notifyListeners('*', this.state, {});
    }
  };

  /**
   * DOM Utilities
   * Helper functions for DOM manipulation
   */

  /**
   * Create an element with attributes
   * @param {string} tag - HTML tag name
   * @param {object} attributes - Element attributes
   * @param {string|Element|Element[]} children - Child content
   * @returns {Element} Created element
   */
  function createElement$1(tag, attributes = {}, children = null) {
    const element = document.createElement(tag);

    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.substring(2).toLowerCase();
        element.addEventListener(eventName, value);
      } else {
        element.setAttribute(key, value);
      }
    });

    // Add children
    if (children) {
      if (typeof children === 'string') {
        element.textContent = children;
      } else if (Array.isArray(children)) {
        children.forEach(child => {
          if (child instanceof Element) {
            element.appendChild(child);
          } else if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
          }
        });
      } else if (children instanceof Element) {
        element.appendChild(children);
      }
    }

    return element;
  }

  /**
   * Find closest ancestor matching selector
   * @param {Element} element - Starting element
   * @param {string} selector - CSS selector
   * @returns {Element|null} Matching ancestor or null
   */
  function findClosest$1(element, selector) {
    return element ? element.closest(selector) : null;
  }

  /**
   * Remove an element from the DOM
   * @param {Element|string} elementOrSelector - Element or CSS selector
   */
  function removeElement$1(elementOrSelector) {
    const element =
      typeof elementOrSelector === 'string'
        ? document.querySelector(elementOrSelector)
        : elementOrSelector;

    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  /**
   * Check if element is visible
   * @param {Element} element - Element to check
   * @returns {boolean} True if visible
   */
  function isVisible$1(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * Get element position relative to viewport
   * @param {Element} element - Element
   * @returns {object} Position object with x, y, width, height
   */
  function getElementPosition$1(element) {
    if (!element) return { x: 0, y: 0, width: 0, height: 0 };

    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  /**
   * Set element position
   * @param {Element} element - Element
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function setElementPosition$1(element, x, y) {
    if (!element) return;

    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  /**
   * Set element size
   * @param {Element} element - Element
   * @param {number} width - Width
   * @param {number} height - Height
   */
  function setElementSize$1(element, width, height) {
    if (!element) return;

    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }

  /**
   * Add CSS class to element
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   */
  function addClass$1(element, className) {
    if (element) {
      element.classList.add(className);
    }
  }

  /**
   * Remove CSS class from element
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   */
  function removeClass$1(element, className) {
    if (element) {
      element.classList.remove(className);
    }
  }

  /**
   * Toggle CSS class on element
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   * @returns {boolean} True if class is now present
   */
  function toggleClass$1(element, className) {
    if (element) {
      return element.classList.toggle(className);
    }
    return false;
  }

  /**
   * Check if element has CSS class
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   * @returns {boolean} True if element has class
   */
  function hasClass$1(element, className) {
    return element ? element.classList.contains(className) : false;
  }

  /**
   * Toast Notification Module
   * Handles toast notifications (for Quick Tabs - appears in corner)
   * v1.5.8.10 - Extracted from notifications/index.js
   */


  /**
   * Show toast notification in configured corner
   * @param {string} message - Message to display
   * @param {string} type - Notification type (info, success, warning, error)
   * @param {object} config - Configuration object
   */
  function showToast(message, type, config) {
    const existing = document.getElementById('copy-url-toast');
    if (existing) existing.remove();

    const positions = {
      'top-left': { top: '20px', left: '20px' },
      'top-right': { top: '20px', right: '20px' },
      'bottom-left': { bottom: '20px', left: '20px' },
      'bottom-right': { bottom: '20px', right: '20px' }
    };

    const pos = positions[config?.notifPosition] || positions['bottom-right'];

    // Determine animation class with null-safe config access
    let animClass = 'cuo-anim-fade'; // Default
    if (config?.notifAnimation === 'slide') {
      animClass = 'cuo-anim-slide';
    } else if (config?.notifAnimation === 'bounce') {
      animClass = 'cuo-anim-bounce';
    }

    // Ensure border width is a number with null-safe access
    const borderWidth = parseInt(config?.notifBorderWidth) || 1;

    const toast = createElement$1(
      'div',
      {
        id: 'copy-url-toast',
        className: animClass,
        style: {
          position: 'fixed',
          ...pos,
          backgroundColor: config?.notifColor || '#333',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '4px',
          fontSize: '14px',
          zIndex: '999999998',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          border: `${borderWidth}px solid ${config?.notifBorderColor || '#444'}`,
          pointerEvents: 'none',
          opacity: '1'
        }
      },
      message
    );

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, config?.notifDuration || 2000);

    console.log('[Toast] Displayed:', message);
  }

  /**
   * Tooltip Notification Module
   * Handles tooltip notifications (for Copy URL - appears at cursor)
   * v1.5.8.10 - Extracted from notifications/index.js
   */


  /**
   * Get mouse coordinate from state manager safely
   * @param {object} stateManager - State manager
   * @param {string} key - Key to get (lastMouseX or lastMouseY)
   * @returns {number} Mouse coordinate or 0 if unavailable
   */
  function getMouseCoordinate(stateManager, key) {
    if (!stateManager || typeof stateManager.get !== 'function') {
      return 0;
    }
    return stateManager.get(key) || 0;
  }

  /**
   * Get animation class based on config
   * @param {object} config - Configuration object
   * @returns {string} Animation class name
   */
  function getAnimationClass(config) {
    return config?.tooltipAnimation === 'bounce' ? 'cuo-anim-bounce' : 'cuo-anim-fade';
  }

  /**
   * Show tooltip notification at cursor position
   * @param {string} message - Message to display
   * @param {object} config - Configuration object
   * @param {object} stateManager - State manager for mouse position
   */
  function showTooltip(message, config, stateManager) {
    const existing = document.getElementById('copy-url-tooltip');
    if (existing) existing.remove();

    const mouseX = getMouseCoordinate(stateManager, 'lastMouseX');
    const mouseY = getMouseCoordinate(stateManager, 'lastMouseY');

    const tooltip = createElement$1(
      'div',
      {
        id: 'copy-url-tooltip',
        className: getAnimationClass(config),
        style: {
          position: 'fixed',
          left: `${mouseX + CONSTANTS.TOOLTIP_OFFSET_X}px`,
          top: `${mouseY + CONSTANTS.TOOLTIP_OFFSET_Y}px`,
          backgroundColor: config?.tooltipColor || '#333',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '14px',
          zIndex: '999999999',
          pointerEvents: 'none',
          opacity: '1'
        }
      },
      message
    );

    document.body.appendChild(tooltip);

    setTimeout(() => {
      tooltip.style.opacity = '0';
      tooltip.style.transition = 'opacity 0.2s';
      setTimeout(() => tooltip.remove(), CONSTANTS.TOOLTIP_FADE_OUT_MS);
    }, config?.tooltipDuration || 1000);

    console.log('[Tooltip] Displayed:', message);
  }

  /**
   * Notifications Feature Module
   * Handles tooltip and toast notifications with animations
   *
   * v1.5.8.10 - Hybrid Architecture: Modularized with separate toast/tooltip files
   * and CSS extracted to ui/css/notifications.css
   */


  // CSS content will be injected from string
  const notificationsCss = `
/* Notification Animations */
@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* Animation Classes */
.cuo-anim-slide {
  animation: slideInRight 0.3s ease-out;
}

.cuo-anim-fade {
  animation: fadeIn 0.3s ease-out;
}

.cuo-anim-bounce {
  animation: bounce 0.5s ease-out;
}

/* Tooltip Base Styles */
.cuo-tooltip {
  position: fixed;
  background-color: #333;
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  z-index: 999999999;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.2s;
}

/* Toast Base Styles */
.cuo-toast {
  position: fixed;
  background-color: #333;
  color: white;
  padding: 12px 20px;
  border-radius: 4px;
  font-size: 14px;
  z-index: 999999998;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  border: 1px solid #444;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.3s;
}
`;

  /**
   * NotificationManager - Coordinates notification display
   */
  class NotificationManager {
    constructor() {
      this.config = null;
      this.stateManager = null;
      this.styleInjected = false;
    }

    /**
     * Initialize the notification manager
     */
    init(config, stateManager) {
      this.config = config;
      this.stateManager = stateManager;

      console.log('[NotificationManager] Initializing...');

      // Inject notification styles from CSS module
      this.injectStyles();

      console.log('[NotificationManager] Initialized successfully');
    }

    /**
     * Inject notification CSS from external CSS module
     */
    injectStyles() {
      if (this.styleInjected) return;

      const styleElement = document.createElement('style');
      styleElement.id = 'cuo-notification-styles';
      styleElement.textContent = notificationsCss;

      document.head.appendChild(styleElement);
      this.styleInjected = true;
      console.log('[NotificationManager] Styles injected from CSS module');
    }

    /**
     * Show a notification (auto-selects tooltip or toast based on config)
     */
    showNotification(message, type = 'info') {
      if (!this.config || !this.config.showNotification) {
        console.log('[NotificationManager] Notifications disabled');
        return;
      }

      console.log('[NotificationManager] Showing notification:', message, type);

      if (this.config.notifDisplayMode === 'tooltip') {
        this.showTooltip(message);
      } else {
        this.showToast(message, type);
      }
    }

    /**
     * Show tooltip notification (for Copy URL - appears at cursor)
     */
    showTooltip(message) {
      showTooltip(message, this.config, this.stateManager);
    }

    /**
     * Show toast notification (for Quick Tabs - appears in corner)
     */
    showToast(message, type = 'info') {
      showToast(message, type, this.config);
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
      this.config = newConfig;
      console.log('[NotificationManager] Configuration updated');
    }
  }

  // Create singleton instance
  const notificationManager$1 = new NotificationManager();

  /**
   * Initialize Notifications feature
   * Called from content.js during initialization
   */
  function initNotifications(config, stateManager) {
    console.log('[Notifications] Initializing Notifications feature module...');
    notificationManager$1.init(config, stateManager);
    console.log('[Notifications] Notifications feature module initialized');
    return notificationManager$1;
  }

  var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  function getDefaultExportFromCjs (x) {
  	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
  }

  function getDefaultExportFromNamespaceIfPresent (n) {
  	return n && Object.prototype.hasOwnProperty.call(n, 'default') ? n['default'] : n;
  }

  function getDefaultExportFromNamespaceIfNotNamed (n) {
  	return n && Object.prototype.hasOwnProperty.call(n, 'default') && Object.keys(n).length === 1 ? n['default'] : n;
  }

  function getAugmentedNamespace(n) {
    if (n.__esModule) return n;
    var f = n.default;
  	if (typeof f == "function") {
  		var a = function a () {
  			if (this instanceof a) {
          return Reflect.construct(f, arguments, this.constructor);
  			}
  			return f.apply(this, arguments);
  		};
  		a.prototype = f.prototype;
    } else a = {};
    Object.defineProperty(a, '__esModule', {value: true});
  	Object.keys(n).forEach(function (k) {
  		var d = Object.getOwnPropertyDescriptor(n, k);
  		Object.defineProperty(a, k, d.get ? d : {
  			enumerable: true,
  			get: function () {
  				return n[k];
  			}
  		});
  	});
  	return a;
  }

  var eventemitter3$1 = {exports: {}};

  var eventemitter3 = eventemitter3$1.exports;

  (function (module) {
  	'use strict';

  	var has = Object.prototype.hasOwnProperty
  	  , prefix = '~';

  	/**
  	 * Constructor to create a storage for our `EE` objects.
  	 * An `Events` instance is a plain object whose properties are event names.
  	 *
  	 * @constructor
  	 * @private
  	 */
  	function Events() {}

  	//
  	// We try to not inherit from `Object.prototype`. In some engines creating an
  	// instance in this way is faster than calling `Object.create(null)` directly.
  	// If `Object.create(null)` is not supported we prefix the event names with a
  	// character to make sure that the built-in object properties are not
  	// overridden or used as an attack vector.
  	//
  	if (Object.create) {
  	  Events.prototype = Object.create(null);

  	  //
  	  // This hack is needed because the `__proto__` property is still inherited in
  	  // some old browsers like Android 4, iPhone 5.1, Opera 11 and Safari 5.
  	  //
  	  if (!new Events().__proto__) prefix = false;
  	}

  	/**
  	 * Representation of a single event listener.
  	 *
  	 * @param {Function} fn The listener function.
  	 * @param {*} context The context to invoke the listener with.
  	 * @param {Boolean} [once=false] Specify if the listener is a one-time listener.
  	 * @constructor
  	 * @private
  	 */
  	function EE(fn, context, once) {
  	  this.fn = fn;
  	  this.context = context;
  	  this.once = once || false;
  	}

  	/**
  	 * Add a listener for a given event.
  	 *
  	 * @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
  	 * @param {(String|Symbol)} event The event name.
  	 * @param {Function} fn The listener function.
  	 * @param {*} context The context to invoke the listener with.
  	 * @param {Boolean} once Specify if the listener is a one-time listener.
  	 * @returns {EventEmitter}
  	 * @private
  	 */
  	function addListener(emitter, event, fn, context, once) {
  	  if (typeof fn !== 'function') {
  	    throw new TypeError('The listener must be a function');
  	  }

  	  var listener = new EE(fn, context || emitter, once)
  	    , evt = prefix ? prefix + event : event;

  	  if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
  	  else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
  	  else emitter._events[evt] = [emitter._events[evt], listener];

  	  return emitter;
  	}

  	/**
  	 * Clear event by name.
  	 *
  	 * @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
  	 * @param {(String|Symbol)} evt The Event name.
  	 * @private
  	 */
  	function clearEvent(emitter, evt) {
  	  if (--emitter._eventsCount === 0) emitter._events = new Events();
  	  else delete emitter._events[evt];
  	}

  	/**
  	 * Minimal `EventEmitter` interface that is molded against the Node.js
  	 * `EventEmitter` interface.
  	 *
  	 * @constructor
  	 * @public
  	 */
  	function EventEmitter() {
  	  this._events = new Events();
  	  this._eventsCount = 0;
  	}

  	/**
  	 * Return an array listing the events for which the emitter has registered
  	 * listeners.
  	 *
  	 * @returns {Array}
  	 * @public
  	 */
  	EventEmitter.prototype.eventNames = function eventNames() {
  	  var names = []
  	    , events
  	    , name;

  	  if (this._eventsCount === 0) return names;

  	  for (name in (events = this._events)) {
  	    if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
  	  }

  	  if (Object.getOwnPropertySymbols) {
  	    return names.concat(Object.getOwnPropertySymbols(events));
  	  }

  	  return names;
  	};

  	/**
  	 * Return the listeners registered for a given event.
  	 *
  	 * @param {(String|Symbol)} event The event name.
  	 * @returns {Array} The registered listeners.
  	 * @public
  	 */
  	EventEmitter.prototype.listeners = function listeners(event) {
  	  var evt = prefix ? prefix + event : event
  	    , handlers = this._events[evt];

  	  if (!handlers) return [];
  	  if (handlers.fn) return [handlers.fn];

  	  for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
  	    ee[i] = handlers[i].fn;
  	  }

  	  return ee;
  	};

  	/**
  	 * Return the number of listeners listening to a given event.
  	 *
  	 * @param {(String|Symbol)} event The event name.
  	 * @returns {Number} The number of listeners.
  	 * @public
  	 */
  	EventEmitter.prototype.listenerCount = function listenerCount(event) {
  	  var evt = prefix ? prefix + event : event
  	    , listeners = this._events[evt];

  	  if (!listeners) return 0;
  	  if (listeners.fn) return 1;
  	  return listeners.length;
  	};

  	/**
  	 * Calls each of the listeners registered for a given event.
  	 *
  	 * @param {(String|Symbol)} event The event name.
  	 * @returns {Boolean} `true` if the event had listeners, else `false`.
  	 * @public
  	 */
  	EventEmitter.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
  	  var evt = prefix ? prefix + event : event;

  	  if (!this._events[evt]) return false;

  	  var listeners = this._events[evt]
  	    , len = arguments.length
  	    , args
  	    , i;

  	  if (listeners.fn) {
  	    if (listeners.once) this.removeListener(event, listeners.fn, undefined, true);

  	    switch (len) {
  	      case 1: return listeners.fn.call(listeners.context), true;
  	      case 2: return listeners.fn.call(listeners.context, a1), true;
  	      case 3: return listeners.fn.call(listeners.context, a1, a2), true;
  	      case 4: return listeners.fn.call(listeners.context, a1, a2, a3), true;
  	      case 5: return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
  	      case 6: return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
  	    }

  	    for (i = 1, args = new Array(len -1); i < len; i++) {
  	      args[i - 1] = arguments[i];
  	    }

  	    listeners.fn.apply(listeners.context, args);
  	  } else {
  	    var length = listeners.length
  	      , j;

  	    for (i = 0; i < length; i++) {
  	      if (listeners[i].once) this.removeListener(event, listeners[i].fn, undefined, true);

  	      switch (len) {
  	        case 1: listeners[i].fn.call(listeners[i].context); break;
  	        case 2: listeners[i].fn.call(listeners[i].context, a1); break;
  	        case 3: listeners[i].fn.call(listeners[i].context, a1, a2); break;
  	        case 4: listeners[i].fn.call(listeners[i].context, a1, a2, a3); break;
  	        default:
  	          if (!args) for (j = 1, args = new Array(len -1); j < len; j++) {
  	            args[j - 1] = arguments[j];
  	          }

  	          listeners[i].fn.apply(listeners[i].context, args);
  	      }
  	    }
  	  }

  	  return true;
  	};

  	/**
  	 * Add a listener for a given event.
  	 *
  	 * @param {(String|Symbol)} event The event name.
  	 * @param {Function} fn The listener function.
  	 * @param {*} [context=this] The context to invoke the listener with.
  	 * @returns {EventEmitter} `this`.
  	 * @public
  	 */
  	EventEmitter.prototype.on = function on(event, fn, context) {
  	  return addListener(this, event, fn, context, false);
  	};

  	/**
  	 * Add a one-time listener for a given event.
  	 *
  	 * @param {(String|Symbol)} event The event name.
  	 * @param {Function} fn The listener function.
  	 * @param {*} [context=this] The context to invoke the listener with.
  	 * @returns {EventEmitter} `this`.
  	 * @public
  	 */
  	EventEmitter.prototype.once = function once(event, fn, context) {
  	  return addListener(this, event, fn, context, true);
  	};

  	/**
  	 * Remove the listeners of a given event.
  	 *
  	 * @param {(String|Symbol)} event The event name.
  	 * @param {Function} fn Only remove the listeners that match this function.
  	 * @param {*} context Only remove the listeners that have this context.
  	 * @param {Boolean} once Only remove one-time listeners.
  	 * @returns {EventEmitter} `this`.
  	 * @public
  	 */
  	EventEmitter.prototype.removeListener = function removeListener(event, fn, context, once) {
  	  var evt = prefix ? prefix + event : event;

  	  if (!this._events[evt]) return this;
  	  if (!fn) {
  	    clearEvent(this, evt);
  	    return this;
  	  }

  	  var listeners = this._events[evt];

  	  if (listeners.fn) {
  	    if (
  	      listeners.fn === fn &&
  	      (!once || listeners.once) &&
  	      (!context || listeners.context === context)
  	    ) {
  	      clearEvent(this, evt);
  	    }
  	  } else {
  	    for (var i = 0, events = [], length = listeners.length; i < length; i++) {
  	      if (
  	        listeners[i].fn !== fn ||
  	        (once && !listeners[i].once) ||
  	        (context && listeners[i].context !== context)
  	      ) {
  	        events.push(listeners[i]);
  	      }
  	    }

  	    //
  	    // Reset the array, or remove it completely if we have no more listeners.
  	    //
  	    if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
  	    else clearEvent(this, evt);
  	  }

  	  return this;
  	};

  	/**
  	 * Remove all listeners, or those of the specified event.
  	 *
  	 * @param {(String|Symbol)} [event] The event name.
  	 * @returns {EventEmitter} `this`.
  	 * @public
  	 */
  	EventEmitter.prototype.removeAllListeners = function removeAllListeners(event) {
  	  var evt;

  	  if (event) {
  	    evt = prefix ? prefix + event : event;
  	    if (this._events[evt]) clearEvent(this, evt);
  	  } else {
  	    this._events = new Events();
  	    this._eventsCount = 0;
  	  }

  	  return this;
  	};

  	//
  	// Alias methods names because people roll like that.
  	//
  	EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
  	EventEmitter.prototype.addListener = EventEmitter.prototype.on;

  	//
  	// Expose the prefix.
  	//
  	EventEmitter.prefixed = prefix;

  	//
  	// Allow `EventEmitter` to be imported as module namespace.
  	//
  	EventEmitter.EventEmitter = EventEmitter;

  	//
  	// Expose the module.
  	//
  	if ('undefined' !== 'object') {
  	  module.exports = EventEmitter;
  	} 
  } (eventemitter3$1));

  var eventemitter3Exports = eventemitter3$1.exports;
  var EventEmitter = /*@__PURE__*/getDefaultExportFromCjs(eventemitter3Exports);

  /**
   * SyncCoordinator - Coordinates storage and broadcast synchronization
   *
   * Responsibilities:
   * - Route broadcast messages to appropriate handlers
   * - Coordinate storage ↔ state sync
   * - Ignore own storage changes to prevent loops
   * - Handle cross-tab communication
   *
   * Complexity: cc ≤ 3 per method
   */

  class SyncCoordinator {
    /**
     * @param {StateManager} stateManager - State manager instance
     * @param {StorageManager} storageManager - Storage manager instance
     * @param {BroadcastManager} broadcastManager - Broadcast manager instance
     * @param {Object} handlers - Handler instances {create, update, visibility, destroy}
     * @param {EventEmitter} eventBus - Internal event bus
     */
    constructor(stateManager, storageManager, broadcastManager, handlers, eventBus) {
      this.stateManager = stateManager;
      this.storageManager = storageManager;
      this.broadcastManager = broadcastManager;
      this.handlers = handlers;
      this.eventBus = eventBus;
    }

    /**
     * Setup event listeners for storage and broadcast events
     */
    setupListeners() {
      console.log('[SyncCoordinator] Setting up listeners');

      // Listen to storage changes
      this.eventBus.on('storage:changed', newValue => {
        this.handleStorageChange(newValue);
      });

      // Listen to broadcast messages
      this.eventBus.on('broadcast:received', ({ type, data }) => {
        this.handleBroadcastMessage(type, data);
      });

      console.log('[SyncCoordinator] Listeners setup complete');
    }

    /**
     * Handle storage change events
     *
     * @param {Object} newValue - New storage value
     */
    handleStorageChange(newValue) {
      // Handle null/undefined
      if (!newValue) {
        console.log('[SyncCoordinator] Ignoring null storage change');
        return;
      }

      console.log('[SyncCoordinator] Storage changed, checking if should sync');

      // Ignore changes from our own saves to prevent loops
      if (this.storageManager.shouldIgnoreStorageChange(newValue.saveId)) {
        console.log('[SyncCoordinator] Ignoring own storage change');
        return;
      }

      console.log('[SyncCoordinator] Syncing state from storage');

      // Sync state from storage
      // This will trigger state:added, state:updated, state:deleted events
      this.stateManager.hydrate(newValue.quickTabs || []);
    }

    /**
     * Handle broadcast messages and route to appropriate handlers
     *
     * @param {string} type - Message type
     * @param {Object} data - Message data
     */
    handleBroadcastMessage(type, data) {
      // Handle null/undefined data
      if (!data) {
        console.warn('[SyncCoordinator] Received broadcast with null data, ignoring');
        return;
      }

      console.log('[SyncCoordinator] Received broadcast:', type);

      // Route to appropriate handler based on message type
      this._routeMessage(type, data);
    }

    /**
     * Route message to appropriate handler
     * @private
     *
     * @param {string} type - Message type
     * @param {Object} data - Message data
     */
    _routeMessage(type, data) {
      switch (type) {
        case 'CREATE':
          this.handlers.create.create(data);
          break;

        case 'UPDATE_POSITION':
          this.handlers.update.handlePositionChangeEnd(data.id, data.left, data.top);
          break;

        case 'UPDATE_SIZE':
          this.handlers.update.handleSizeChangeEnd(data.id, data.width, data.height);
          break;

        case 'SOLO':
          this.handlers.visibility.handleSoloToggle(data.id, data.soloedOnTabs);
          break;

        case 'MUTE':
          this.handlers.visibility.handleMuteToggle(data.id, data.mutedOnTabs);
          break;

        case 'MINIMIZE':
          this.handlers.visibility.handleMinimize(data.id);
          break;

        case 'RESTORE':
          this.handlers.visibility.handleRestore(data.id);
          break;

        case 'CLOSE':
          this.handlers.destroy.handleDestroy(data.id);
          break;

        default:
          console.warn('[SyncCoordinator] Unknown broadcast type:', type);
      }
    }
  }

  /**
   * UICoordinator - Coordinates QuickTabWindow rendering and lifecycle
   *
   * Responsibilities:
   * - Render QuickTabWindow instances from QuickTab entities
   * - Update UI when state changes
   * - Manage QuickTabWindow lifecycle
   * - Listen to state events and trigger UI updates
   *
   * Complexity: cc ≤ 3 per method
   */

  /* global createQuickTabWindow */

  class UICoordinator {
    /**
     * @param {StateManager} stateManager - State manager instance
     * @param {MinimizedManager} minimizedManager - Minimized manager instance
     * @param {PanelManager} panelManager - Panel manager instance
     * @param {EventEmitter} eventBus - Internal event bus
     */
    constructor(stateManager, minimizedManager, panelManager, eventBus) {
      this.stateManager = stateManager;
      this.minimizedManager = minimizedManager;
      this.panelManager = panelManager;
      this.eventBus = eventBus;
      this.renderedTabs = new Map(); // id -> QuickTabWindow
    }

    /**
     * Initialize coordinator - setup listeners and render initial state
     */
    init() {
      console.log('[UICoordinator] Initializing...');

      // Setup state listeners
      this.setupStateListeners();

      // Render initial state
      this.renderAll();

      console.log('[UICoordinator] Initialized');
    }

    /**
     * Render all visible Quick Tabs from state
     */
    renderAll() {
      console.log('[UICoordinator] Rendering all visible tabs');

      const visibleTabs = this.stateManager.getVisible();

      for (const quickTab of visibleTabs) {
        this.render(quickTab);
      }

      console.log(`[UICoordinator] Rendered ${visibleTabs.length} tabs`);
    }

    /**
     * Render a single QuickTabWindow from QuickTab entity
     *
     * @param {QuickTab} quickTab - QuickTab domain entity
     * @returns {QuickTabWindow} Rendered tab window
     */
    render(quickTab) {
      // Skip if already rendered
      if (this.renderedTabs.has(quickTab.id)) {
        console.log('[UICoordinator] Tab already rendered:', quickTab.id);
        return this.renderedTabs.get(quickTab.id);
      }

      console.log('[UICoordinator] Rendering tab:', quickTab.id);

      // Create QuickTabWindow from QuickTab entity
      const tabWindow = this._createWindow(quickTab);

      // Store in map
      this.renderedTabs.set(quickTab.id, tabWindow);

      console.log('[UICoordinator] Tab rendered:', quickTab.id);
      return tabWindow;
    }

    /**
     * Update an existing QuickTabWindow
     *
     * @param {QuickTab} quickTab - Updated QuickTab entity
     */
    update(quickTab) {
      const tabWindow = this.renderedTabs.get(quickTab.id);

      if (!tabWindow) {
        console.warn('[UICoordinator] Tab not rendered, rendering now:', quickTab.id);
        return this.render(quickTab);
      }

      console.log('[UICoordinator] Updating tab:', quickTab.id);

      // Update tab properties
      tabWindow.updatePosition(quickTab.position.left, quickTab.position.top);
      tabWindow.updateSize(quickTab.size.width, quickTab.size.height);
      tabWindow.updateZIndex(quickTab.zIndex);

      console.log('[UICoordinator] Tab updated:', quickTab.id);
    }

    /**
     * Destroy a QuickTabWindow
     *
     * @param {string} quickTabId - ID of tab to destroy
     */
    destroy(quickTabId) {
      const tabWindow = this.renderedTabs.get(quickTabId);

      if (!tabWindow) {
        console.warn('[UICoordinator] Tab not found for destruction:', quickTabId);
        return;
      }

      console.log('[UICoordinator] Destroying tab:', quickTabId);

      // Call tab's destroy method if it exists
      if (tabWindow.destroy) {
        tabWindow.destroy();
      }

      // Remove from map
      this.renderedTabs.delete(quickTabId);

      console.log('[UICoordinator] Tab destroyed:', quickTabId);
    }

    /**
     * Setup state event listeners
     */
    setupStateListeners() {
      console.log('[UICoordinator] Setting up state listeners');

      // Listen to state changes and trigger UI updates
      this.eventBus.on('state:added', ({ quickTab }) => {
        this.render(quickTab);
      });

      this.eventBus.on('state:updated', ({ quickTab }) => {
        this.update(quickTab);
      });

      this.eventBus.on('state:deleted', ({ id }) => {
        this.destroy(id);
      });
    }

    /**
     * Create QuickTabWindow from QuickTab entity
     * @private
     *
     * @param {QuickTab} quickTab - QuickTab domain entity
     * @returns {QuickTabWindow} Created window
     */
    _createWindow(quickTab) {
      // Use global createQuickTabWindow function
      // (This function is defined in window.js and attached to global scope)
      return createQuickTabWindow({
        id: quickTab.id,
        url: quickTab.url,
        left: quickTab.position.left,
        top: quickTab.position.top,
        width: quickTab.size.width,
        height: quickTab.size.height,
        title: quickTab.title,
        cookieStoreId: quickTab.container,
        minimized: quickTab.visibility.minimized,
        zIndex: quickTab.zIndex,
        soloedOnTabs: quickTab.visibility.soloedOnTabs,
        mutedOnTabs: quickTab.visibility.mutedOnTabs
        // Note: Callbacks are passed through from QuickTabsManager facade
        // They will be added when QuickTabsManager calls this with options
      });
    }
  }

  /**
   * DragController - Handles drag operations using Pointer Events API
   *
   * Uses Pointer Events API (pointerdown/pointermove/pointerup/pointercancel) instead
   * of Mouse Events to support Issue #51 fix (handling tab switch during drag).
   * The pointercancel event is critical for saving state when drag is interrupted.
   *
   * Prevents "slipping" on high-refresh monitors by using requestAnimationFrame
   * and tracking actual pointer position. Extracted from QuickTabWindow.js as part
   * of v1.6.0 Phase 2.9 refactoring.
   *
   * @see docs/misc/v1.6.0-REFACTORING-PHASE3.4-NEXT-STEPS.md
   */

  class DragController {
    /**
     * Create a drag controller
     * @param {HTMLElement} element - Element to make draggable
     * @param {Object} callbacks - Event callbacks
     * @param {Function} callbacks.onDragStart - Called when drag starts (x, y)
     * @param {Function} callbacks.onDrag - Called during drag (newX, newY)
     * @param {Function} callbacks.onDragEnd - Called when drag ends (finalX, finalY)
     * @param {Function} callbacks.onDragCancel - Called when drag is cancelled (lastX, lastY)
     */
    constructor(element, callbacks = {}) {
      this.element = element;
      this.onDragStart = callbacks.onDragStart || null;
      this.onDrag = callbacks.onDrag || null;
      this.onDragEnd = callbacks.onDragEnd || null;
      this.onDragCancel = callbacks.onDragCancel || null;

      this.isDragging = false;
      this.currentPointerId = null;
      this.offsetX = 0;
      this.offsetY = 0;
      this.currentX = 0;
      this.currentY = 0;
      this.rafId = null;

      this.boundHandlePointerDown = this.handlePointerDown.bind(this);
      this.boundHandlePointerMove = this.handlePointerMove.bind(this);
      this.boundHandlePointerUp = this.handlePointerUp.bind(this);
      this.boundHandlePointerCancel = this.handlePointerCancel.bind(this);

      this.attach();
    }

    /**
     * Attach drag listeners
     */
    attach() {
      this.element.addEventListener('pointerdown', this.boundHandlePointerDown);
      this.element.addEventListener('pointermove', this.boundHandlePointerMove);
      this.element.addEventListener('pointerup', this.boundHandlePointerUp);
      this.element.addEventListener('pointercancel', this.boundHandlePointerCancel);
    }

    /**
     * Handle pointer down - start drag
     * @param {PointerEvent} e
     */
    handlePointerDown(e) {
      // Don't drag if clicking on button or other interactive element
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
        return;
      }

      this.isDragging = true;
      this.currentPointerId = e.pointerId;

      // Calculate offset from current element position
      const rect = this.element.parentElement.getBoundingClientRect();
      this.currentX = rect.left;
      this.currentY = rect.top;
      this.offsetX = e.clientX - this.currentX;
      this.offsetY = e.clientY - this.currentY;

      // Capture pointer events
      this.element.setPointerCapture(e.pointerId);

      if (this.onDragStart) {
        this.onDragStart(this.currentX, this.currentY);
      }
    }

    /**
     * Handle pointer move - update position
     * Uses requestAnimationFrame to prevent slipping on high-refresh monitors
     * @param {PointerEvent} e
     */
    handlePointerMove(e) {
      if (!this.isDragging) return;

      // Use requestAnimationFrame to prevent excessive updates
      if (this.rafId) return;

      this.rafId = requestAnimationFrame(() => {
        const newX = e.clientX - this.offsetX;
        const newY = e.clientY - this.offsetY;

        this.currentX = newX;
        this.currentY = newY;

        if (this.onDrag) {
          this.onDrag(newX, newY);
        }

        this.rafId = null;
      });
    }

    /**
     * Handle pointer up - end drag
     * @param {PointerEvent} e
     */
    handlePointerUp(e) {
      if (!this.isDragging) return;

      this.isDragging = false;

      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      // Release pointer capture
      if (this.currentPointerId !== null) {
        this.element.releasePointerCapture(this.currentPointerId);
        this.currentPointerId = null;
      }

      // Calculate final position
      const finalX = e.clientX - this.offsetX;
      const finalY = e.clientY - this.offsetY;

      if (this.onDragEnd) {
        this.onDragEnd(finalX, finalY);
      }
    }

    /**
     * Handle pointer cancel - CRITICAL FOR ISSUE #51
     * This fires when drag is interrupted (e.g., user switches tabs during drag)
     * @param {PointerEvent} _e
     */
    handlePointerCancel(_e) {
      if (!this.isDragging) return;

      this.isDragging = false;

      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      // Call onDragCancel with last known position (or onDragEnd as fallback)
      const callback = this.onDragCancel || this.onDragEnd;
      if (callback) {
        callback(this.currentX, this.currentY);
      }

      this.currentPointerId = null;
    }

    /**
     * Detach drag listeners and cleanup
     */
    destroy() {
      this.element.removeEventListener('pointerdown', this.boundHandlePointerDown);
      this.element.removeEventListener('pointermove', this.boundHandlePointerMove);
      this.element.removeEventListener('pointerup', this.boundHandlePointerUp);
      this.element.removeEventListener('pointercancel', this.boundHandlePointerCancel);

      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      this.isDragging = false;
      this.currentPointerId = null;
    }
  }

  /**
   * DOM Utilities
   * Helper functions for DOM manipulation
   */

  /**
   * Create an element with attributes
   * @param {string} tag - HTML tag name
   * @param {object} attributes - Element attributes
   * @param {string|Element|Element[]} children - Child content
   * @returns {Element} Created element
   */
  function createElement(tag, attributes = {}, children = null) {
    const element = document.createElement(tag);

    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.substring(2).toLowerCase();
        element.addEventListener(eventName, value);
      } else {
        element.setAttribute(key, value);
      }
    });

    // Add children
    if (children) {
      if (typeof children === 'string') {
        element.textContent = children;
      } else if (Array.isArray(children)) {
        children.forEach(child => {
          if (child instanceof Element) {
            element.appendChild(child);
          } else if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
          }
        });
      } else if (children instanceof Element) {
        element.appendChild(children);
      }
    }

    return element;
  }

  /**
   * Find closest ancestor matching selector
   * @param {Element} element - Starting element
   * @param {string} selector - CSS selector
   * @returns {Element|null} Matching ancestor or null
   */
  function findClosest(element, selector) {
    return element ? element.closest(selector) : null;
  }

  /**
   * Remove an element from the DOM
   * @param {Element|string} elementOrSelector - Element or CSS selector
   */
  function removeElement(elementOrSelector) {
    const element =
      typeof elementOrSelector === 'string'
        ? document.querySelector(elementOrSelector)
        : elementOrSelector;

    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  /**
   * Check if element is visible
   * @param {Element} element - Element to check
   * @returns {boolean} True if visible
   */
  function isVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * Get element position relative to viewport
   * @param {Element} element - Element
   * @returns {object} Position object with x, y, width, height
   */
  function getElementPosition(element) {
    if (!element) return { x: 0, y: 0, width: 0, height: 0 };

    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  /**
   * Set element position
   * @param {Element} element - Element
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function setElementPosition(element, x, y) {
    if (!element) return;

    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  /**
   * Set element size
   * @param {Element} element - Element
   * @param {number} width - Width
   * @param {number} height - Height
   */
  function setElementSize(element, width, height) {
    if (!element) return;

    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }

  /**
   * Add CSS class to element
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   */
  function addClass(element, className) {
    if (element) {
      element.classList.add(className);
    }
  }

  /**
   * Remove CSS class from element
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   */
  function removeClass(element, className) {
    if (element) {
      element.classList.remove(className);
    }
  }

  /**
   * Toggle CSS class on element
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   * @returns {boolean} True if class is now present
   */
  function toggleClass(element, className) {
    if (element) {
      return element.classList.toggle(className);
    }
    return false;
  }

  /**
   * Check if element has CSS class
   * @param {Element} element - Element
   * @param {string} className - CSS class name
   * @returns {boolean} True if element has class
   */
  function hasClass(element, className) {
    return element ? element.classList.contains(className) : false;
  }

  /**
   * ResizeHandle - Individual resize handle with table-driven configuration
   * Part of Phase 2.3 refactoring to reduce window.js complexity
   *
   * This demonstrates the table-driven configuration pattern from the refactoring plan.
   * Reduces complexity from cc=25 to cc=3 by eliminating directional conditionals.
   */


  /**
   * Configuration for each resize direction
   * Eliminates conditional logic - direction behavior is data-driven
   */
  const RESIZE_CONFIGS$1 = {
    // Corner handles
    se: {
      cursor: 'se-resize',
      position: { bottom: 0, right: 0 },
      size: { width: 10, height: 10 },
      directions: ['e', 's']
    },
    sw: {
      cursor: 'sw-resize',
      position: { bottom: 0, left: 0 },
      size: { width: 10, height: 10 },
      directions: ['w', 's']
    },
    ne: {
      cursor: 'ne-resize',
      position: { top: 0, right: 0 },
      size: { width: 10, height: 10 },
      directions: ['e', 'n']
    },
    nw: {
      cursor: 'nw-resize',
      position: { top: 0, left: 0 },
      size: { width: 10, height: 10 },
      directions: ['w', 'n']
    },
    // Edge handles
    e: {
      cursor: 'e-resize',
      position: { top: 10, right: 0, bottom: 10 },
      size: { width: 10 },
      directions: ['e']
    },
    w: {
      cursor: 'w-resize',
      position: { top: 10, left: 0, bottom: 10 },
      size: { width: 10 },
      directions: ['w']
    },
    s: {
      cursor: 's-resize',
      position: { bottom: 0, left: 10, right: 10 },
      size: { height: 10 },
      directions: ['s']
    },
    n: {
      cursor: 'n-resize',
      position: { top: 0, left: 10, right: 10 },
      size: { height: 10 },
      directions: ['n']
    }
  };

  /**
   * ResizeHandle class - Manages a single resize handle
   * Generic implementation works for all 8 directions via configuration
   */
  class ResizeHandle {
    constructor(direction, window, options = {}) {
      this.direction = direction;
      this.window = window;
      this.config = RESIZE_CONFIGS$1[direction];
      this.minWidth = options.minWidth || 400;
      this.minHeight = options.minHeight || 300;

      if (!this.config) {
        throw new Error(`Invalid resize direction: ${direction}`);
      }

      this.element = null;
      this.isResizing = false;
      this.startState = null;
    }

    /**
     * Create and attach the handle element
     */
    create() {
      const { cursor, position, size } = this.config;

      // Build style object from configuration
      const style = {
        position: 'absolute',
        cursor,
        zIndex: '10',
        backgroundColor: 'transparent', // Invisible but interactive
        ...Object.entries(position).reduce((acc, [key, value]) => {
          acc[key] = `${value}px`;
          return acc;
        }, {}),
        ...Object.entries(size).reduce((acc, [key, value]) => {
          acc[key] = `${value}px`;
          return acc;
        }, {})
      };

      this.element = createElement('div', {
        className: `quick-tab-resize-handle-${this.direction}`,
        style
      });

      this.attachEventListeners();
      return this.element;
    }

    /**
     * Attach pointer event listeners
     */
    attachEventListeners() {
      this.element.addEventListener('pointerdown', this.handlePointerDown.bind(this));
      this.element.addEventListener('pointermove', this.handlePointerMove.bind(this));
      this.element.addEventListener('pointerup', this.handlePointerUp.bind(this));
      this.element.addEventListener('pointercancel', this.handlePointerCancel.bind(this));
    }

    /**
     * Start resize operation
     */
    handlePointerDown(e) {
      if (e.button !== 0) return;

      e.stopPropagation();
      e.preventDefault();

      this.isResizing = true;
      this.element.setPointerCapture(e.pointerId);

      this.startState = {
        x: e.clientX,
        y: e.clientY,
        width: this.window.width,
        height: this.window.height,
        left: this.window.left,
        top: this.window.top
      };
    }

    /**
     * Handle resize drag
     * Uses configuration to determine which dimensions to modify
     */
    handlePointerMove(e) {
      if (!this.isResizing) return;

      const dx = e.clientX - this.startState.x;
      const dy = e.clientY - this.startState.y;

      const newDimensions = this.calculateNewDimensions(dx, dy);

      // Apply dimensions
      Object.assign(this.window, newDimensions);

      // Update DOM
      this.window.container.style.width = `${newDimensions.width}px`;
      this.window.container.style.height = `${newDimensions.height}px`;
      this.window.container.style.left = `${newDimensions.left}px`;
      this.window.container.style.top = `${newDimensions.top}px`;

      // Notify callbacks
      this.notifyChanges(newDimensions);

      e.preventDefault();
    }

    /**
     * Calculate new dimensions based on direction configuration
     * This is where the table-driven approach shines - no directional conditionals!
     */
    calculateNewDimensions(dx, dy) {
      const { directions } = this.config;
      const { width, height, left, top } = this.startState;

      let newWidth = width;
      let newHeight = height;
      let newLeft = left;
      let newTop = top;

      // Process each direction in the configuration
      for (const dir of directions) {
        switch (dir) {
          case 'e': // East - expand right
            newWidth = Math.max(this.minWidth, width + dx);
            break;
          case 'w': // West - expand left
            {
              const maxDx = width - this.minWidth;
              const constrainedDx = Math.min(dx, maxDx);
              newWidth = width - constrainedDx;
              newLeft = left + constrainedDx;
            }
            break;
          case 's': // South - expand down
            newHeight = Math.max(this.minHeight, height + dy);
            break;
          case 'n': // North - expand up
            {
              const maxDy = height - this.minHeight;
              const constrainedDy = Math.min(dy, maxDy);
              newHeight = height - constrainedDy;
              newTop = top + constrainedDy;
            }
            break;
        }
      }

      return { width: newWidth, height: newHeight, left: newLeft, top: newTop };
    }

    /**
     * Notify parent of dimension changes
     */
    notifyChanges(newDimensions) {
      const { width, height, left, top } = newDimensions;
      const { width: oldWidth, height: oldHeight, left: oldLeft, top: oldTop } = this.startState;

      // Size changed
      if (width !== oldWidth || height !== oldHeight) {
        this.window.onSizeChange?.(this.window.id, width, height);
      }

      // Position changed
      if (left !== oldLeft || top !== oldTop) {
        this.window.onPositionChange?.(this.window.id, left, top);
      }
    }

    /**
     * End resize operation
     */
    handlePointerUp(e) {
      if (!this.isResizing) return;

      this.isResizing = false;
      this.element.releasePointerCapture(e.pointerId);

      // Prevent click propagation
      e.preventDefault();
      e.stopPropagation();

      // Final save callbacks
      this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height);

      if (this.window.left !== this.startState.left || this.window.top !== this.startState.top) {
        this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top);
      }

      this.startState = null;
    }

    /**
     * Handle resize cancellation
     */
    handlePointerCancel(_e) {
      if (!this.isResizing) return;

      this.isResizing = false;

      // Emergency save
      this.window.onSizeChangeEnd?.(this.window.id, this.window.width, this.window.height);
      this.window.onPositionChangeEnd?.(this.window.id, this.window.left, this.window.top);

      this.startState = null;
    }

    /**
     * Cleanup event listeners
     */
    destroy() {
      if (this.element) {
        this.element.remove();
        this.element = null;
      }
    }
  }

  /**
   * ResizeController - Coordinates all resize handles for a Quick Tab window
   * Part of Phase 2.3 refactoring to reduce window.js complexity
   *
   * This demonstrates the facade/coordinator pattern from the refactoring plan.
   * Reduces setupResizeHandlers from 195 lines to ~15 lines of orchestration.
   */


  /**
   * All 8 resize directions
   * Adding a new direction is as simple as adding to this array
   */
  const RESIZE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  /**
   * ResizeController class - Manages all resize handles for a window
   */
  class ResizeController {
    constructor(window, options = {}) {
      this.window = window;
      this.options = options;
      this.handles = [];
    }

    /**
     * Create and attach all resize handles
     * This replaces 195 lines of repeated code in setupResizeHandlers()
     */
    attachHandles() {
      // Create a handle for each direction
      for (const direction of RESIZE_DIRECTIONS) {
        const handle = new ResizeHandle(direction, this.window, this.options);
        const element = handle.create();

        // Append to window container
        this.window.container.appendChild(element);

        // Track for cleanup
        this.handles.push(handle);
      }

      return this.handles;
    }

    /**
     * Remove all resize handles and cleanup
     */
    detachAll() {
      for (const handle of this.handles) {
        handle.destroy();
      }
      this.handles = [];
    }

    /**
     * Get specific handle by direction
     */
    getHandle(direction) {
      return this.handles.find(h => h.direction === direction);
    }
  }

  /**
   * TitlebarBuilder Component - v1.6.0 Phase 2.9 Task 4
   *
   * Extracted from QuickTabWindow.createTitlebar() (157 lines, cc unknown)
   * Follows facade pattern used by ResizeController and DragController
   *
   * Responsibilities:
   * - Build titlebar with left section (navigation + favicon + title)
   * - Build control buttons (solo/mute/minimize/close)
   * - Manage button state updates
   * - Handle button event delegation
   *
   * @created 2025-11-19
   * @refactoring Phase 2.9 Task 4
   */


  /**
   * TitlebarBuilder - Builds and manages Quick Tab titlebar
   *
   * Follows facade pattern - encapsulates titlebar creation logic
   * that was previously in QuickTabWindow.createTitlebar()
   */
  class TitlebarBuilder {
    /**
     * @param {Object} config - Titlebar configuration
     * @param {string} config.title - Initial title text
     * @param {string} config.url - URL for favicon extraction
     * @param {Array<number>} config.soloedOnTabs - Solo tab IDs
     * @param {Array<number>} config.mutedOnTabs - Mute tab IDs
     * @param {number} config.currentTabId - Current tab ID for solo/mute checks
     * @param {HTMLIFrameElement} config.iframe - Iframe element for navigation/zoom
     * @param {Object} callbacks - Event callbacks
     * @param {Function} callbacks.onClose - Close button clicked
     * @param {Function} callbacks.onMinimize - Minimize button clicked
     * @param {Function} callbacks.onSolo - Solo button clicked
     * @param {Function} callbacks.onMute - Mute button clicked
     * @param {Function} callbacks.onOpenInTab - Open in tab button clicked
     */
    constructor(config, callbacks) {
      this.config = config;
      this.callbacks = callbacks;

      // DOM element references (public for window.js access)
      this.titlebar = null;
      this.titleElement = null;
      this.soloButton = null;
      this.muteButton = null;
      this.faviconElement = null;

      // Zoom state (internal to titlebar)
      this.currentZoom = 100;
      this.zoomDisplay = null;
    }

    /**
     * Build and return the complete titlebar element
     * @returns {HTMLElement} The titlebar DOM element
     */
    build() {
      this.titlebar = this._createContainer();

      // Build sections
      const leftSection = this._createLeftSection();
      const controls = this._createRightSection();

      this.titlebar.appendChild(leftSection);
      this.titlebar.appendChild(controls);

      return this.titlebar;
    }

    /**
     * Update title text dynamically
     * @param {string} newTitle - New title text
     */
    updateTitle(newTitle) {
      if (this.titleElement) {
        this.titleElement.textContent = newTitle;
      }
    }

    /**
     * Update solo button state
     * @param {boolean} isSoloed - Whether currently soloed on this tab
     */
    updateSoloButton(isSoloed) {
      if (this.soloButton) {
        this.soloButton.textContent = isSoloed ? '🎯' : '⭕';
        this.soloButton.title = isSoloed
          ? 'Un-solo (show on all tabs)'
          : 'Solo (show only on this tab)';
        this.soloButton.style.background = isSoloed ? '#444' : 'transparent';
      }
    }

    /**
     * Update mute button state
     * @param {boolean} isMuted - Whether currently muted on this tab
     */
    updateMuteButton(isMuted) {
      if (this.muteButton) {
        this.muteButton.textContent = isMuted ? '🔇' : '🔊';
        this.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
        this.muteButton.style.background = isMuted ? '#c44' : 'transparent';
      }
    }

    // ============================================================================
    // Private Helper Methods
    // ============================================================================

    /**
     * Create titlebar container
     * @private
     */
    _createContainer() {
      return createElement('div', {
        className: 'quick-tab-titlebar',
        style: {
          height: '40px',
          backgroundColor: '#2d2d2d',
          borderBottom: '1px solid #444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          cursor: 'move',
          userSelect: 'none'
        }
      });
    }

    /**
     * Create left section with navigation + favicon + title
     * @private
     */
    _createLeftSection() {
      const leftSection = createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          flex: '1',
          overflow: 'hidden',
          gap: '8px'
        }
      });

      // Navigation buttons container
      const navContainer = this._createNavigationButtons();
      leftSection.appendChild(navContainer);

      // Favicon
      this.faviconElement = this._createFavicon();
      leftSection.appendChild(this.faviconElement);

      // Title text
      this.titleElement = this._createTitle();
      leftSection.appendChild(this.titleElement);

      return leftSection;
    }

    /**
     * Create navigation buttons container (back/forward/reload/zoom)
     * @private
     */
    _createNavigationButtons() {
      const navContainer = createElement('div', {
        style: {
          display: 'flex',
          gap: '4px',
          alignItems: 'center'
        }
      });

      this._appendHistoryButtons(navContainer);
      this._appendZoomControls(navContainer);

      return navContainer;
    }

    /**
     * Append history navigation buttons (back/forward/reload)
     * @private
     */
    _appendHistoryButtons(navContainer) {
      // Back button
      const backBtn = this._createButton('←', () => {
        if (this.config.iframe.contentWindow) {
          try {
            this.config.iframe.contentWindow.history.back();
          } catch (err) {
            console.warn('[QuickTab] Cannot navigate back - cross-origin restriction');
          }
        }
      });
      backBtn.title = 'Back';
      navContainer.appendChild(backBtn);

      // Forward button
      const forwardBtn = this._createButton('→', () => {
        if (this.config.iframe.contentWindow) {
          try {
            this.config.iframe.contentWindow.history.forward();
          } catch (err) {
            console.warn('[QuickTab] Cannot navigate forward - cross-origin restriction');
          }
        }
      });
      forwardBtn.title = 'Forward';
      navContainer.appendChild(forwardBtn);

      // Reload button
      const reloadBtn = this._createButton('↻', () => {
        // Proper iframe reload technique (fixes no-self-assign ESLint error)
        const currentSrc = this.config.iframe.src;
        this.config.iframe.src = 'about:blank';
        setTimeout(() => {
          this.config.iframe.src = currentSrc;
        }, 10);
      });
      reloadBtn.title = 'Reload';
      navContainer.appendChild(reloadBtn);
    }

    /**
     * Append zoom controls (zoom out/display/zoom in)
     * @private
     */
    _appendZoomControls(navContainer) {
      // Zoom out button
      const zoomOutBtn = this._createButton('−', () => {
        if (this.currentZoom > 50) {
          this.currentZoom -= 10;
          this._applyZoom(this.currentZoom);
        }
      });
      zoomOutBtn.title = 'Zoom Out';
      navContainer.appendChild(zoomOutBtn);

      // Zoom display
      this.zoomDisplay = createElement(
        'span',
        {
          style: {
            fontSize: '11px',
            color: '#fff',
            minWidth: '38px',
            textAlign: 'center',
            fontWeight: '500'
          }
        },
        '100%'
      );
      navContainer.appendChild(this.zoomDisplay);

      // Zoom in button
      const zoomInBtn = this._createButton('+', () => {
        if (this.currentZoom < 200) {
          this.currentZoom += 10;
          this._applyZoom(this.currentZoom);
        }
      });
      zoomInBtn.title = 'Zoom In';
      navContainer.appendChild(zoomInBtn);
    }

    /**
     * Create favicon element
     * @private
     */
    _createFavicon() {
      const favicon = createElement('img', {
        className: 'quick-tab-favicon',
        style: {
          width: '16px',
          height: '16px',
          marginLeft: '5px',
          marginRight: '5px',
          flexShrink: '0'
        }
      });

      // Extract domain for favicon
      try {
        const urlObj = new URL(this.config.url);
        const GOOGLE_FAVICON_URL = 'https://www.google.com/s2/favicons?domain=';
        favicon.src = `${GOOGLE_FAVICON_URL}${urlObj.hostname}&sz=32`;
        favicon.onerror = () => {
          favicon.style.display = 'none';
        };
      } catch (e) {
        favicon.style.display = 'none';
      }

      return favicon;
    }

    /**
     * Create title text element
     * @private
     */
    _createTitle() {
      return createElement(
        'div',
        {
          className: 'quick-tab-title',
          style: {
            color: '#fff',
            fontSize: '14px',
            fontWeight: 'bold',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1'
          }
        },
        this.config.title
      );
    }

    /**
     * Create right section with control buttons
     * @private
     */
    _createRightSection() {
      const controls = createElement('div', {
        style: {
          display: 'flex',
          gap: '8px'
        }
      });

      // Open in New Tab button
      const openBtn = this._createButton('🔗', () => {
        if (this.callbacks.onOpenInTab) {
          this.callbacks.onOpenInTab();
        }
      });
      openBtn.title = 'Open in New Tab';
      controls.appendChild(openBtn);

      // v1.5.9.13 - Solo button
      const isSoloed = this._isCurrentTabSoloed();
      this.soloButton = this._createButton(isSoloed ? '🎯' : '⭕', () => {
        if (this.callbacks.onSolo) {
          this.callbacks.onSolo(this.soloButton);
        }
      });
      this.soloButton.title = isSoloed
        ? 'Un-solo (show on all tabs)'
        : 'Solo (show only on this tab)';
      this.soloButton.style.background = isSoloed ? '#444' : 'transparent';
      controls.appendChild(this.soloButton);

      // v1.5.9.13 - Mute button
      const isMuted = this._isCurrentTabMuted();
      this.muteButton = this._createButton(isMuted ? '🔇' : '🔊', () => {
        if (this.callbacks.onMute) {
          this.callbacks.onMute(this.muteButton);
        }
      });
      this.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
      this.muteButton.style.background = isMuted ? '#c44' : 'transparent';
      controls.appendChild(this.muteButton);

      // Minimize button
      const minimizeBtn = this._createButton('−', () => {
        if (this.callbacks.onMinimize) {
          this.callbacks.onMinimize();
        }
      });
      minimizeBtn.title = 'Minimize';
      controls.appendChild(minimizeBtn);

      // Close button
      const closeBtn = this._createButton('×', () => {
        if (this.callbacks.onClose) {
          this.callbacks.onClose();
        }
      });
      closeBtn.title = 'Close';
      controls.appendChild(closeBtn);

      return controls;
    }

    /**
     * Create a button element with hover effects
     * @private
     * @param {string} text - Button text/icon
     * @param {Function} onClick - Click handler
     * @returns {HTMLElement} Button element
     */
    _createButton(text, onClick) {
      const button = createElement(
        'button',
        {
          style: {
            width: '24px',
            height: '24px',
            backgroundColor: 'transparent',
            border: '1px solid #666',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            transition: 'background-color 0.2s'
          }
        },
        text
      );

      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = '#444';
      });

      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = 'transparent';
      });

      button.addEventListener('click', e => {
        e.stopPropagation();
        onClick();
      });

      return button;
    }

    /**
     * Apply zoom level to iframe
     * @private
     * @param {number} zoomLevel - Zoom percentage (50-200)
     */
    _applyZoom(zoomLevel) {
      const zoomFactor = zoomLevel / 100;
      if (this.config.iframe.contentWindow) {
        try {
          this.config.iframe.contentWindow.document.body.style.zoom = zoomFactor;
        } catch (err) {
          // Cross-origin restriction - use CSS transform fallback
          this.config.iframe.style.transform = `scale(${zoomFactor})`;
          this.config.iframe.style.transformOrigin = 'top left';
          this.config.iframe.style.width = `${100 / zoomFactor}%`;
          this.config.iframe.style.height = `${100 / zoomFactor}%`;
        }
      }
      if (this.zoomDisplay) {
        this.zoomDisplay.textContent = `${zoomLevel}%`;
      }
      console.log(`[TitlebarBuilder] Zoom applied: ${zoomLevel}% on ${this.config.url}`);
    }

    /**
     * Check if current tab is soloed
     * @private
     * @returns {boolean} True if current tab is in soloedOnTabs array
     */
    _isCurrentTabSoloed() {
      return this.config.soloedOnTabs && this.config.soloedOnTabs.includes(this.config.currentTabId);
    }

    /**
     * Check if current tab is muted
     * @private
     * @returns {boolean} True if current tab is in mutedOnTabs array
     */
    _isCurrentTabMuted() {
      return this.config.mutedOnTabs && this.config.mutedOnTabs.includes(this.config.currentTabId);
    }
  }

  /**
   * Quick Tab Window Component
   * Handles creation, rendering, and lifecycle of individual Quick Tab overlay windows
   *
   * v1.5.9.0 - Restored missing UI logic identified in v1589-quick-tabs-root-cause.md
   */


  /**
   * QuickTabWindow class - Manages a single Quick Tab overlay instance
   */
  class QuickTabWindow {
    constructor(options) {
      // v1.6.0 Phase 2.4 - Extract initialization methods to reduce complexity
      this._initializeBasicProperties(options);
      this._initializePositionAndSize(options);
      this._initializeVisibility(options);
      this._initializeCallbacks(options);
      this._initializeState();
    }

    /**
     * Initialize basic properties (id, url, title, etc.)
     */
    _initializeBasicProperties(options) {
      this.id = options.id;
      this.url = options.url;
      this.title = options.title || 'Quick Tab';
      this.cookieStoreId = options.cookieStoreId || 'firefox-default';
    }

    /**
     * Initialize position and size properties
     */
    _initializePositionAndSize(options) {
      this.left = options.left || 100;
      this.top = options.top || 100;
      this.width = options.width || 800;
      this.height = options.height || 600;
      this.zIndex = options.zIndex || CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
    }

    /**
     * Initialize visibility-related properties (minimized, solo, mute)
     */
    _initializeVisibility(options) {
      this.minimized = options.minimized || false;
      // v1.5.9.13 - Replace pinnedToUrl with solo/mute arrays
      this.soloedOnTabs = options.soloedOnTabs || [];
      this.mutedOnTabs = options.mutedOnTabs || [];
    }

    /**
     * Initialize lifecycle and event callbacks
     * v1.6.0 Phase 2.4 - Table-driven to reduce complexity
     */
    _initializeCallbacks(options) {
      const noop = () => {};
      const callbacks = [
        'onDestroy',
        'onMinimize',
        'onFocus',
        'onPositionChange',
        'onPositionChangeEnd',
        'onSizeChange',
        'onSizeChangeEnd',
        'onSolo', // v1.5.9.13
        'onMute' // v1.5.9.13
      ];

      callbacks.forEach(name => {
        this[name] = options[name] || noop;
      });
    }

    /**
     * Initialize internal state properties
     */
    _initializeState() {
      this.container = null;
      this.iframe = null;
      this.rendered = false; // v1.5.9.10 - Track rendering state to prevent rendering bugs
      // v1.6.0 Phase 2.9 - isDragging kept for external checks, managed by DragController
      this.isDragging = false;
      this.isResizing = false;
      // v1.6.0 Phase 2.9 - dragStartX/Y removed, managed internally by DragController
      this.resizeStartWidth = 0;
      this.resizeStartHeight = 0;
      this.soloButton = null; // v1.5.9.13 - Reference to solo button
      this.muteButton = null; // v1.5.9.13 - Reference to mute button
      // v1.6.0 Phase 2.9 - Controllers for drag and resize
      this.dragController = null;
      this.resizeController = null;
    }

    /**
     * Create and render the Quick Tab window
     */
    render() {
      if (this.container) {
        console.warn('[QuickTabWindow] Already rendered:', this.id);
        return this.container;
      }

      const targetLeft = Number.isFinite(this.left) ? this.left : 100;
      const targetTop = Number.isFinite(this.top) ? this.top : 100;
      this.left = targetLeft;
      this.top = targetTop;

      // Create main container
      this.container = createElement('div', {
        id: `quick-tab-${this.id}`,
        className: 'quick-tab-window',
        style: {
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          width: `${this.width}px`,
          height: `${this.height}px`,
          zIndex: this.zIndex.toString(),
          backgroundColor: '#1e1e1e',
          border: '2px solid #444',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          display: this.minimized ? 'none' : 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'box-shadow 0.2s, opacity 0.15s ease-in',
          visibility: 'hidden',
          opacity: '0'
        }
      });

      // v1.6.0 Phase 2.9 Task 4 - Use TitlebarBuilder facade pattern
      // Create titlebar using TitlebarBuilder component
      this.titlebarBuilder = new TitlebarBuilder(
        {
          title: this.title,
          url: this.url,
          soloedOnTabs: this.soloedOnTabs,
          mutedOnTabs: this.mutedOnTabs,
          currentTabId: this.currentTabId,
          iframe: null // Will be set after iframe creation
        },
        {
          onClose: () => this.destroy(),
          onMinimize: () => this.minimize(),
          onSolo: btn => this.toggleSolo(btn),
          onMute: btn => this.toggleMute(btn),
          onOpenInTab: () => {
            const currentSrc = this.iframe.src || this.iframe.getAttribute('data-deferred-src');
            browser$1.runtime.sendMessage({
              action: 'openTab',
              url: currentSrc,
              switchFocus: true
            });
          }
        }
      );

      // Note: iframe is null during titlebar build, will be updated before first use
      const titlebar = this.titlebarBuilder.build();
      this.container.appendChild(titlebar);

      // Store button references for updating (solo/mute state changes)
      this.soloButton = this.titlebarBuilder.soloButton;
      this.muteButton = this.titlebarBuilder.muteButton;

      // Create iframe content area
      this.iframe = createElement('iframe', {
        src: this.url,
        style: {
          flex: '1',
          border: 'none',
          width: '100%',
          height: 'calc(100% - 40px)'
        },
        sandbox:
          'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
      });

      this.container.appendChild(this.iframe);

      // Update TitlebarBuilder with iframe reference (needed for navigation/zoom)
      this.titlebarBuilder.config.iframe = this.iframe;

      // Setup iframe load listener to update title
      this.setupIframeLoadHandler();

      // Add to document
      document.body.appendChild(this.container);

      // v1.5.9.10 - Mark as rendered
      this.rendered = true;

      // Fix Quick Tab flash by moving into place after a frame
      requestAnimationFrame(() => {
        this.container.style.left = `${targetLeft}px`;
        this.container.style.top = `${targetTop}px`;
        this.container.style.visibility = 'visible';
        this.container.style.opacity = '1';
      });

      // v1.6.0 Phase 2.9 Task 3 - Use DragController facade pattern
      this.dragController = new DragController(titlebar, {
        onDragStart: (x, y) => {
          console.log('[QuickTabWindow] Drag started:', this.id, x, y);
          this.isDragging = true;
          this.onFocus(this.id);
        },
        onDrag: (newX, newY) => {
          // Update position
          this.left = newX;
          this.top = newY;
          this.container.style.left = `${newX}px`;
          this.container.style.top = `${newY}px`;

          // Call position change callback (throttled by DragController's RAF)
          if (this.onPositionChange) {
            this.onPositionChange(this.id, newX, newY);
          }
        },
        onDragEnd: (finalX, finalY) => {
          console.log('[QuickTabWindow] Drag ended:', this.id, finalX, finalY);
          this.isDragging = false;

          // Final save on drag end
          if (this.onPositionChangeEnd) {
            this.onPositionChangeEnd(this.id, finalX, finalY);
          }
        },
        onDragCancel: (lastX, lastY) => {
          // CRITICAL FOR ISSUE #51: Emergency save position when drag is interrupted
          console.log('[QuickTabWindow] Drag cancelled:', this.id, lastX, lastY);
          this.isDragging = false;

          // Emergency save position before tab loses focus
          if (this.onPositionChangeEnd) {
            this.onPositionChangeEnd(this.id, lastX, lastY);
          }
        }
      });

      // v1.6.0 Phase 2.4 - Use ResizeController facade pattern
      this.resizeController = new ResizeController(this, {
        minWidth: 400,
        minHeight: 300
      });
      this.resizeController.attachHandles();

      this.setupFocusHandlers();

      console.log('[QuickTabWindow] Rendered:', this.id);
      return this.container;
    }

    // v1.6.0 Phase 2.9 Task 4 - createFavicon() moved to TitlebarBuilder

    // v1.6.0 Phase 2.9 Task 4 - createTitlebar() moved to TitlebarBuilder (157 lines)
    // v1.6.0 Phase 2.9 Task 4 - createButton() moved to TitlebarBuilder (38 lines)
    // v1.6.0 Phase 2.9 Task 4 - createFavicon() moved to TitlebarBuilder (26 lines)
    // See TitlebarBuilder.js for extracted implementation

    /**
     * v1.6.0 Phase 2.9 Task 4 - applyZoom() REMOVED
     * Zoom functionality now handled internally by TitlebarBuilder
     * Old method signature: applyZoom(zoomLevel, displayElement)
     * If zoom needs to be exposed externally, add public method to TitlebarBuilder
     */

    // The following event handlers still in window.js (toggleSolo, toggleMute, minimize, destroy, etc.)

    /**
     * Setup drag handlers using Pointer Events API
     */
    /**
     * v1.6.0 Phase 2.9 Task 3 - setupDragHandlers removed
     * Replaced with DragController facade pattern (see render() method)
     * This eliminates ~50 lines of drag logic and uses Pointer Events API
     * for Issue #51 fix (pointercancel handles tab switch during drag)
     */

    /**
     * v1.6.0 Phase 2.4 - setupResizeHandlers removed
     * Replaced with ResizeController facade pattern (see render() method)
     * This eliminates 195 lines of complex conditional logic
     */

    /**
     * Setup focus handlers
     */
    setupFocusHandlers() {
      this.container.addEventListener('mousedown', () => {
        this.onFocus(this.id);
      });
    }

    /**
     * Minimize the Quick Tab window
     */
    minimize() {
      this.minimized = true;
      this.container.style.display = 'none';

      // Enhanced logging for console log export (Issue #1)
      console.log(
        `[Quick Tab] Minimized - URL: ${this.url}, Title: ${this.title}, ID: ${this.id}, Position: (${this.left}, ${this.top}), Size: ${this.width}x${this.height}`
      );

      this.onMinimize(this.id);
    }

    /**
     * Restore minimized Quick Tab window
     * v1.5.9.8 - FIX: Explicitly re-apply position to ensure it's in the same place
     */
    restore() {
      this.minimized = false;
      this.container.style.display = 'flex';

      // v1.5.9.8 - FIX: Explicitly re-apply position to ensure it's restored to the same place
      this.container.style.left = `${this.left}px`;
      this.container.style.top = `${this.top}px`;
      this.container.style.width = `${this.width}px`;
      this.container.style.height = `${this.height}px`;

      // Enhanced logging for console log export (Issue #1)
      console.log(
        `[Quick Tab] Restored - URL: ${this.url}, Title: ${this.title}, ID: ${this.id}, Position: (${this.left}, ${this.top}), Size: ${this.width}x${this.height}`
      );

      this.onFocus(this.id);
    }

    // v1.6.0 Phase 2.9 Task 4 - applyZoom() removed (now in TitlebarBuilder._applyZoom())

    /**
     * Update z-index for stacking
     */
    updateZIndex(newZIndex) {
      this.zIndex = newZIndex;
      if (this.container) {
        this.container.style.zIndex = newZIndex.toString();
      }
    }

    /**
     * Setup iframe load handler to update title
     * v1.6.0 Phase 2.4 - Extracted helper to reduce nesting
     */
    setupIframeLoadHandler() {
      this.iframe.addEventListener('load', () => {
        this._updateTitleFromIframe();
      });
    }

    /**
     * Update title from iframe content or URL
     * v1.6.0 Phase 2.4 - Extracted to reduce nesting depth
     */
    _updateTitleFromIframe() {
      // Try same-origin title first
      const iframeTitle = this._tryGetIframeTitle();
      if (iframeTitle) {
        this._setTitle(iframeTitle, iframeTitle);
        return;
      }

      // Fallback to hostname
      const hostname = this._tryGetHostname();
      if (hostname) {
        this._setTitle(hostname, this.iframe.src);
        return;
      }

      // Final fallback
      this.title = 'Quick Tab';
    }

    /**
     * Try to get title from iframe (same-origin only)
     */
    _tryGetIframeTitle() {
      try {
        return this.iframe.contentDocument?.title;
      } catch (_e) {
        return null;
      }
    }

    /**
     * Try to get hostname from iframe URL
     */
    _tryGetHostname() {
      try {
        const urlObj = new URL(this.iframe.src);
        return urlObj.hostname;
      } catch (_e) {
        return null;
      }
    }

    /**
     * Set title in both property and UI
     */
    _setTitle(title, tooltip) {
      this.title = title;
      // v1.6.0 Phase 2.9 Task 4 - Use TitlebarBuilder to update title
      if (this.titlebarBuilder) {
        this.titlebarBuilder.updateTitle(title);
        // Update tooltip on title element
        if (this.titlebarBuilder.titleElement) {
          this.titlebarBuilder.titleElement.title = tooltip;
        }
      }
    }

    /**
     * v1.5.9.13 - Check if current tab is in solo list
     */
    isCurrentTabSoloed() {
      return (
        this.soloedOnTabs &&
        this.soloedOnTabs.length > 0 &&
        window.quickTabsManager &&
        window.quickTabsManager.currentTabId &&
        this.soloedOnTabs.includes(window.quickTabsManager.currentTabId)
      );
    }

    /**
     * v1.5.9.13 - Check if current tab is in mute list
     */
    isCurrentTabMuted() {
      return (
        this.mutedOnTabs &&
        this.mutedOnTabs.length > 0 &&
        window.quickTabsManager &&
        window.quickTabsManager.currentTabId &&
        this.mutedOnTabs.includes(window.quickTabsManager.currentTabId)
      );
    }

    /**
     * v1.5.9.13 - Toggle solo state for current tab
     */
    toggleSolo(soloBtn) {
      console.log('[QuickTabWindow] toggleSolo called for:', this.id);
      console.log('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
      console.log('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);

      if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
        console.warn('[QuickTabWindow] Cannot toggle solo - no current tab ID');
        console.warn('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
        console.warn('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);
        return;
      }

      const currentTabId = window.quickTabsManager.currentTabId;

      if (this.isCurrentTabSoloed()) {
        // Un-solo: Remove current tab from solo list
        this.soloedOnTabs = this.soloedOnTabs.filter(id => id !== currentTabId);
        soloBtn.textContent = '⭕';
        soloBtn.title = 'Solo (show only on this tab)';
        soloBtn.style.background = 'transparent';

        // If no tabs left in solo list, Quick Tab becomes visible everywhere
        if (this.soloedOnTabs.length === 0) {
          console.log('[QuickTabWindow] Un-soloed - now visible on all tabs');
        }
      } else {
        // Solo: Set current tab as the only tab (replace entire list for simplicity)
        this.soloedOnTabs = [currentTabId];
        this.mutedOnTabs = []; // Clear mute state (mutually exclusive)
        soloBtn.textContent = '🎯';
        soloBtn.title = 'Un-solo (show on all tabs)';
        soloBtn.style.background = '#444';

        // Update mute button if it exists
        if (this.muteButton) {
          this.muteButton.textContent = '🔊';
          this.muteButton.title = 'Mute (hide on this tab)';
          this.muteButton.style.background = 'transparent';
        }

        console.log('[QuickTabWindow] Soloed - only visible on this tab');
      }

      // Notify parent manager
      if (this.onSolo) {
        this.onSolo(this.id, this.soloedOnTabs);
      }
    }

    /**
     * v1.5.9.13 - Toggle mute state for current tab
     */
    toggleMute(muteBtn) {
      console.log('[QuickTabWindow] toggleMute called for:', this.id);
      console.log('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
      console.log('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);

      if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
        console.warn('[QuickTabWindow] Cannot toggle mute - no current tab ID');
        console.warn('[QuickTabWindow] window.quickTabsManager:', window.quickTabsManager);
        console.warn('[QuickTabWindow] currentTabId:', window.quickTabsManager?.currentTabId);
        return;
      }

      const currentTabId = window.quickTabsManager.currentTabId;

      if (this.isCurrentTabMuted()) {
        // Unmute: Remove current tab from mute list
        this.mutedOnTabs = this.mutedOnTabs.filter(id => id !== currentTabId);
        muteBtn.textContent = '🔊';
        muteBtn.title = 'Mute (hide on this tab)';
        muteBtn.style.background = 'transparent';

        console.log('[QuickTabWindow] Unmuted on this tab');
      } else {
        // Mute: Add current tab to mute list
        if (!this.mutedOnTabs.includes(currentTabId)) {
          this.mutedOnTabs.push(currentTabId);
        }
        this.soloedOnTabs = []; // Clear solo state (mutually exclusive)
        muteBtn.textContent = '🔇';
        muteBtn.title = 'Unmute (show on this tab)';
        muteBtn.style.background = '#c44';

        // Update solo button if it exists
        if (this.soloButton) {
          this.soloButton.textContent = '⭕';
          this.soloButton.title = 'Solo (show only on this tab)';
          this.soloButton.style.background = 'transparent';
        }

        console.log('[QuickTabWindow] Muted on this tab');
      }

      // Notify parent manager
      if (this.onMute) {
        this.onMute(this.id, this.mutedOnTabs);
      }
    }

    /**
     * Set position of Quick Tab window (v1.5.8.13 - for sync from other tabs)
     * @param {number} left - X position
     * @param {number} top - Y position
     */
    setPosition(left, top) {
      this.left = left;
      this.top = top;
      if (this.container) {
        this.container.style.left = `${left}px`;
        this.container.style.top = `${top}px`;
      }
    }

    /**
     * Set size of Quick Tab window (v1.5.8.13 - for sync from other tabs)
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     */
    setSize(width, height) {
      this.width = width;
      this.height = height;
      if (this.container) {
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;
      }
    }

    /**
     * v1.5.9.10 - Check if Quick Tab is rendered on the page
     * @returns {boolean} True if rendered and attached to DOM
     */
    isRendered() {
      return this.rendered && this.container && this.container.parentNode;
    }

    /**
     * Destroy the Quick Tab window
     */
    destroy() {
      // v1.6.0 Phase 2.9 - Cleanup drag controller
      if (this.dragController) {
        this.dragController.destroy();
        this.dragController = null;
      }

      // v1.6.0 Phase 2.4 - Cleanup resize controller
      if (this.resizeController) {
        this.resizeController.detachAll();
        this.resizeController = null;
      }

      if (this.container) {
        this.container.remove();
        this.container = null;
        this.iframe = null;
        this.rendered = false; // v1.5.9.10 - Reset rendering state
      }
      this.onDestroy(this.id);
      console.log('[QuickTabWindow] Destroyed:', this.id);
    }

    /**
     * Get current state for persistence
     * v1.5.9.13 - Updated to include soloedOnTabs and mutedOnTabs
     */
    getState() {
      return {
        id: this.id,
        url: this.url,
        left: this.left,
        top: this.top,
        width: this.width,
        height: this.height,
        title: this.title,
        cookieStoreId: this.cookieStoreId,
        minimized: this.minimized,
        zIndex: this.zIndex,
        soloedOnTabs: this.soloedOnTabs, // v1.5.9.13
        mutedOnTabs: this.mutedOnTabs // v1.5.9.13
      };
    }
  }

  /**
   * Create a Quick Tab window
   * @param {Object} options - Quick Tab configuration
   * @returns {QuickTabWindow} The created Quick Tab window instance
   */
  function createQuickTabWindow$1(options) {
    const window = new QuickTabWindow(options);
    window.render();
    return window;
  }

  /**
   * CreateHandler
   * Handles Quick Tab creation logic
   *
   * Extracted from QuickTabsManager to reduce complexity
   * Lines 903-992 from original index.js
   */


  /**
   * CreateHandler - Responsible for creating new Quick Tabs
   *
   * Responsibilities:
   * - Generate ID if not provided
   * - Auto-assign container if not provided
   * - Handle existing tabs (render if not rendered)
   * - Create QuickTabWindow instance
   * - Store in tabs Map
   * - Broadcast CREATE message
   * - Emit QUICK_TAB_CREATED event
   */
  class CreateHandler {
    /**
     * @param {Map} quickTabsMap - Map of id -> QuickTabWindow
     * @param {Object} currentZIndex - Ref object { value: number }
     * @param {string} cookieStoreId - Current container ID
     * @param {Object} broadcastManager - BroadcastManager instance
     * @param {Object} eventBus - EventEmitter for DOM events
     * @param {Object} Events - Event constants
     * @param {Function} generateId - ID generation function
     */
    constructor(
      quickTabsMap,
      currentZIndex,
      cookieStoreId,
      broadcastManager,
      eventBus,
      Events,
      generateId
    ) {
      this.quickTabsMap = quickTabsMap;
      this.currentZIndex = currentZIndex;
      this.cookieStoreId = cookieStoreId;
      this.broadcastManager = broadcastManager;
      this.eventBus = eventBus;
      this.Events = Events;
      this.generateId = generateId;
    }

    /**
     * Create a new Quick Tab
     *
     * @param {Object} options - Quick Tab options
     * @returns {{ tabWindow: Object, newZIndex: number }} Created tab and new z-index
     */
    create(options) {
      console.log('[CreateHandler] Creating Quick Tab with options:', options);

      const id = options.id || this.generateId();
      const cookieStoreId = options.cookieStoreId || this.cookieStoreId || 'firefox-default';

      // Handle existing tab
      if (this.quickTabsMap.has(id)) {
        return this._handleExistingTab(id);
      }

      // Create new tab
      return this._createNewTab(id, cookieStoreId, options);
    }

    /**
     * Handle existing tab (render if not rendered, bring to front)
     * @private
     */
    _handleExistingTab(id) {
      const existingTab = this.quickTabsMap.get(id);

      // v1.5.9.10 - Ensure tab is rendered
      if (!existingTab.isRendered || !existingTab.isRendered()) {
        console.log('[CreateHandler] Tab exists but not rendered, rendering now:', id);
        existingTab.render();
      } else {
        console.warn('[CreateHandler] Quick Tab already exists and is rendered:', id);
      }

      this.currentZIndex.value++;
      existingTab.updateZIndex(this.currentZIndex.value);

      return {
        tabWindow: existingTab,
        newZIndex: this.currentZIndex.value
      };
    }

    /**
     * Create and store new tab
     * @private
     */
    _createNewTab(id, cookieStoreId, options) {
      this.currentZIndex.value++;

      const defaults = this._getDefaults();
      const tabOptions = this._buildTabOptions(id, cookieStoreId, options, defaults);
      const tabWindow = createQuickTabWindow$1(tabOptions);

      this.quickTabsMap.set(id, tabWindow);
      this._broadcastCreation(id, cookieStoreId, options, defaults);
      this._emitCreationEvent(id, options.url);

      console.log('[CreateHandler] Quick Tab created successfully:', id);

      return {
        tabWindow,
        newZIndex: this.currentZIndex.value
      };
    }

    /**
     * Get default option values
     * @private
     */
    _getDefaults() {
      return {
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        title: 'Quick Tab',
        minimized: false,
        soloedOnTabs: [],
        mutedOnTabs: []
      };
    }

    /**
     * Build options for createQuickTabWindow
     * @private
     */
    _buildTabOptions(id, cookieStoreId, options, defaults) {
      return {
        id,
        url: options.url,
        left: options.left ?? defaults.left,
        top: options.top ?? defaults.top,
        width: options.width ?? defaults.width,
        height: options.height ?? defaults.height,
        title: options.title ?? defaults.title,
        cookieStoreId,
        minimized: options.minimized ?? defaults.minimized,
        zIndex: this.currentZIndex.value,
        soloedOnTabs: options.soloedOnTabs ?? defaults.soloedOnTabs,
        mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs,
        onDestroy: options.onDestroy,
        onMinimize: options.onMinimize,
        onFocus: options.onFocus,
        onPositionChange: options.onPositionChange,
        onPositionChangeEnd: options.onPositionChangeEnd,
        onSizeChange: options.onSizeChange,
        onSizeChangeEnd: options.onSizeChangeEnd,
        onSolo: options.onSolo,
        onMute: options.onMute
      };
    }

    /**
     * Broadcast creation to other tabs
     * @private
     */
    _broadcastCreation(id, cookieStoreId, options, defaults) {
      this.broadcastManager.broadcast('CREATE', {
        id,
        url: options.url,
        left: options.left ?? defaults.left,
        top: options.top ?? defaults.top,
        width: options.width ?? defaults.width,
        height: options.height ?? defaults.height,
        title: options.title ?? defaults.title,
        cookieStoreId,
        minimized: options.minimized ?? defaults.minimized,
        soloedOnTabs: options.soloedOnTabs ?? defaults.soloedOnTabs,
        mutedOnTabs: options.mutedOnTabs ?? defaults.mutedOnTabs
      });
    }

    /**
     * Emit creation event
     * @private
     */
    _emitCreationEvent(id, url) {
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_CREATED, { id, url });
      }
    }
  }

  /**
   * @fileoverview DestroyHandler - Handles Quick Tab destruction and cleanup
   * Extracted from QuickTabsManager Phase 2.1 refactoring
   *
   * Responsibilities:
   * - Handle single Quick Tab destruction
   * - Close Quick Tabs via closeById (calls tab.destroy())
   * - Close all Quick Tabs via closeAll
   * - Cleanup minimized manager references
   * - Reset z-index when all tabs closed
   * - Emit destruction events
   *
   * @version 1.6.0
   * @author refactor-specialist
   */

  /**
   * DestroyHandler class
   * Manages Quick Tab destruction and cleanup operations
   */
  class DestroyHandler {
    /**
     * @param {Map} quickTabsMap - Map of Quick Tab instances
     * @param {BroadcastManager} broadcastManager - Broadcast manager for cross-tab sync
     * @param {MinimizedManager} minimizedManager - Manager for minimized Quick Tabs
     * @param {EventEmitter} eventBus - Event bus for internal communication
     * @param {Object} currentZIndex - Reference object with value property for z-index
     * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
     * @param {Function} releasePendingSave - Function to release pending saveId
     * @param {Object} Events - Events constants object
     * @param {number} baseZIndex - Base z-index value to reset to
     */
    constructor(
      quickTabsMap,
      broadcastManager,
      minimizedManager,
      eventBus,
      currentZIndex,
      generateSaveId,
      releasePendingSave,
      Events,
      baseZIndex
    ) {
      this.quickTabsMap = quickTabsMap;
      this.broadcastManager = broadcastManager;
      this.minimizedManager = minimizedManager;
      this.eventBus = eventBus;
      this.currentZIndex = currentZIndex;
      this.generateSaveId = generateSaveId;
      this.releasePendingSave = releasePendingSave;
      this.Events = Events;
      this.baseZIndex = baseZIndex;
    }

    /**
     * Handle Quick Tab destruction
     * v1.5.8.13 - Broadcast close to other tabs
     * v1.5.8.16 - Send to background to update storage and notify all tabs
     *
     * @param {string} id - Quick Tab ID
     * @returns {Promise<void>}
     */
    async handleDestroy(id) {
      console.log('[DestroyHandler] Handling destroy for:', id);

      // Get tab info and cleanup
      const tabInfo = this._getTabInfoAndCleanup(id);

      // Generate save ID for transaction tracking
      const saveId = this.generateSaveId();

      // Broadcast and persist
      this.broadcastManager.notifyClose(id);
      await this._sendCloseToBackground(id, tabInfo, saveId);

      // Emit destruction event
      this._emitDestructionEvent(id);

      // Reset z-index if all tabs are closed
      this._resetZIndexIfEmpty();
    }

    /**
     * Get tab info and perform cleanup
     * @private
     * @param {string} id - Quick Tab ID
     * @returns {Object} Tab info with url and cookieStoreId
     */
    _getTabInfoAndCleanup(id) {
      const tabWindow = this.quickTabsMap.get(id);
      const url = tabWindow && tabWindow.url ? tabWindow.url : null;
      const cookieStoreId = tabWindow
        ? tabWindow.cookieStoreId || 'firefox-default'
        : 'firefox-default';

      // Delete from map and minimized manager
      this.quickTabsMap.delete(id);
      this.minimizedManager.remove(id);

      return { url, cookieStoreId };
    }

    /**
     * Send close message to background
     * @private
     * @param {string} id - Quick Tab ID
     * @param {Object} tabInfo - Tab info with url and cookieStoreId
     * @param {string} saveId - Save ID for transaction tracking
     * @returns {Promise<void>}
     */
    async _sendCloseToBackground(id, tabInfo, saveId) {
      if (typeof browser !== 'undefined' && browser.runtime) {
        try {
          await browser.runtime.sendMessage({
            action: 'CLOSE_QUICK_TAB',
            id: id,
            url: tabInfo.url,
            cookieStoreId: tabInfo.cookieStoreId,
            saveId: saveId
          });
        } catch (err) {
          console.error('[DestroyHandler] Error closing Quick Tab in background:', err);
          this.releasePendingSave(saveId);
        }
      } else {
        this.releasePendingSave(saveId);
      }
    }

    /**
     * Emit destruction event
     * @private
     * @param {string} id - Quick Tab ID
     */
    _emitDestructionEvent(id) {
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_CLOSED, { id });
      }
    }

    /**
     * Reset z-index if all tabs are closed
     * @private
     */
    _resetZIndexIfEmpty() {
      if (this.quickTabsMap.size === 0) {
        this.currentZIndex.value = this.baseZIndex;
        console.log('[DestroyHandler] All tabs closed, reset z-index');
      }
    }

    /**
     * Close Quick Tab by ID (calls tab.destroy() method)
     *
     * @param {string} id - Quick Tab ID
     */
    closeById(id) {
      const tabWindow = this.quickTabsMap.get(id);
      if (tabWindow && tabWindow.destroy) {
        tabWindow.destroy();
      }
    }

    /**
     * Close all Quick Tabs
     * Calls destroy() on each tab, clears map, clears minimized manager, resets z-index
     */
    closeAll() {
      console.log('[DestroyHandler] Closing all Quick Tabs');

      // Destroy all tabs
      for (const tabWindow of this.quickTabsMap.values()) {
        if (tabWindow.destroy) {
          tabWindow.destroy();
        }
      }

      // Clear everything
      this.quickTabsMap.clear();
      this.minimizedManager.clear();
      this.currentZIndex.value = this.baseZIndex;
    }
  }

  /**
   * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
   * Extracted from QuickTabsManager Phase 2.1 refactoring
   *
   * Responsibilities:
   * - Handle position updates during drag (no broadcast/save)
   * - Handle position updates at drag end (broadcast + save)
   * - Handle size updates during resize (no broadcast/save)
   * - Handle size updates at resize end (broadcast + save)
   * - Emit update events for coordinators
   *
   * @version 1.6.0
   * @author refactor-specialist
   */

  /**
   * UpdateHandler class
   * Manages Quick Tab position and size updates with throttling and broadcast coordination
   */
  class UpdateHandler {
    /**
     * @param {Map} quickTabsMap - Map of Quick Tab instances
     * @param {BroadcastManager} broadcastManager - Broadcast manager for cross-tab sync
     * @param {StorageManager} storageManager - Storage manager (currently unused, kept for future use)
     * @param {EventEmitter} eventBus - Event bus for internal communication
     * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
     * @param {Function} releasePendingSave - Function to release pending saveId
     */
    constructor(
      quickTabsMap,
      broadcastManager,
      storageManager,
      eventBus,
      generateSaveId,
      releasePendingSave
    ) {
      this.quickTabsMap = quickTabsMap;
      this.broadcastManager = broadcastManager;
      this.storageManager = storageManager;
      this.eventBus = eventBus;
      this.generateSaveId = generateSaveId;
      this.releasePendingSave = releasePendingSave;

      // Throttle tracking (for future use if needed)
      this.positionChangeThrottle = new Map();
      this.sizeChangeThrottle = new Map();
    }

    /**
     * Handle position change during drag
     * v1.5.8.15 - No longer broadcasts or syncs during drag
     * This prevents excessive BroadcastChannel messages and storage writes
     * Position syncs only on drag end via handlePositionChangeEnd
     *
     * @param {string} id - Quick Tab ID
     * @param {number} left - New left position
     * @param {number} top - New top position
     */
    handlePositionChange(_id, _left, _top) {
      // v1.5.8.15 - No longer broadcasts or syncs during drag
      // This prevents excessive BroadcastChannel messages and storage writes
      // Position syncs only on drag end via handlePositionChangeEnd
      // Local UI update happens automatically via pointer events
    }

    /**
     * Handle position change end (drag end) - broadcast and save
     * v1.5.8.13 - Enhanced with BroadcastChannel sync
     * v1.5.8.14 - Added transaction ID for race condition prevention
     * v1.5.9.12 - Container integration: Include container context
     *
     * @param {string} id - Quick Tab ID
     * @param {number} left - Final left position
     * @param {number} top - Final top position
     * @returns {Promise<void>}
     */
    async handlePositionChangeEnd(id, left, top) {
      // Clear throttle (if exists)
      if (this.positionChangeThrottle.has(id)) {
        this.positionChangeThrottle.delete(id);
      }

      // Round values
      const roundedLeft = Math.round(left);
      const roundedTop = Math.round(top);

      // v1.5.8.13 - Final position broadcast
      this.broadcastManager.notifyPositionUpdate(id, roundedLeft, roundedTop);

      // v1.5.8.14 - Generate save ID for transaction tracking
      const saveId = this.generateSaveId();

      // v1.5.9.12 - Get cookieStoreId from tab
      const tabWindow = this.quickTabsMap.get(id);
      const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

      // Send final position to background
      if (typeof browser !== 'undefined' && browser.runtime) {
        try {
          await browser.runtime.sendMessage({
            action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
            id: id,
            left: roundedLeft,
            top: roundedTop,
            cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
            saveId: saveId, // v1.5.8.14 - Include save ID
            timestamp: Date.now()
          });
        } catch (err) {
          console.error('[UpdateHandler] Final position save error:', err);
          this.releasePendingSave(saveId);
        }
      } else {
        this.releasePendingSave(saveId);
      }

      // Emit event for coordinators
      this.eventBus?.emit('tab:position-updated', {
        id,
        left: roundedLeft,
        top: roundedTop
      });
    }

    /**
     * Handle size change during resize
     * v1.5.8.15 - REMOVED broadcast/sync during resize to prevent performance issues
     * Size only syncs on resize end for optimal performance
     *
     * @param {string} id - Quick Tab ID
     * @param {number} width - New width
     * @param {number} height - New height
     */
    handleSizeChange(_id, _width, _height) {
      // v1.5.8.15 - No longer broadcasts or syncs during resize
      // This prevents excessive BroadcastChannel messages and storage writes
      // Size syncs only on resize end via handleSizeChangeEnd
      // Local UI update happens automatically via pointer events
    }

    /**
     * Handle size change end (resize end) - broadcast and save
     * v1.5.8.13 - Enhanced with BroadcastChannel sync
     * v1.5.8.14 - Added transaction ID for race condition prevention
     * v1.5.9.12 - Container integration: Include container context
     *
     * @param {string} id - Quick Tab ID
     * @param {number} width - Final width
     * @param {number} height - Final height
     * @returns {Promise<void>}
     */
    async handleSizeChangeEnd(id, width, height) {
      // Clear throttle (if exists)
      if (this.sizeChangeThrottle.has(id)) {
        this.sizeChangeThrottle.delete(id);
      }

      // Round values
      const roundedWidth = Math.round(width);
      const roundedHeight = Math.round(height);

      // v1.5.8.13 - Final size broadcast
      this.broadcastManager.notifySizeUpdate(id, roundedWidth, roundedHeight);

      // v1.5.8.14 - Generate save ID for transaction tracking
      const saveId = this.generateSaveId();

      // v1.5.9.12 - Get cookieStoreId from tab
      const tabWindow = this.quickTabsMap.get(id);
      const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

      // Send final size to background
      if (typeof browser !== 'undefined' && browser.runtime) {
        try {
          await browser.runtime.sendMessage({
            action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
            id: id,
            width: roundedWidth,
            height: roundedHeight,
            cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
            saveId: saveId, // v1.5.8.14 - Include save ID
            timestamp: Date.now()
          });
        } catch (err) {
          console.error('[UpdateHandler] Final size save error:', err);
          this.releasePendingSave(saveId);
        }
      } else {
        this.releasePendingSave(saveId);
      }

      // Emit event for coordinators
      this.eventBus?.emit('tab:size-updated', {
        id,
        width: roundedWidth,
        height: roundedHeight
      });
    }
  }

  /**
   * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
   * Extracted from QuickTabsManager Phase 2.1 refactoring
   *
   * Responsibilities:
   * - Handle solo toggle (show only on specific tabs)
   * - Handle mute toggle (hide on specific tabs)
   * - Handle minimize operation
   * - Handle focus operation (bring to front)
   * - Update button appearances
   * - Emit events for coordinators
   *
   * @version 1.6.0
   * @author refactor-specialist
   */

  /**
   * VisibilityHandler class
   * Manages Quick Tab visibility states (solo, mute, minimize, focus)
   */
  class VisibilityHandler {
    /**
     * @param {Map} quickTabsMap - Map of Quick Tab instances
     * @param {BroadcastManager} broadcastManager - Broadcast manager for cross-tab sync
     * @param {StorageManager} storageManager - Storage manager (currently unused, kept for future use)
     * @param {MinimizedManager} minimizedManager - Manager for minimized Quick Tabs
     * @param {EventEmitter} eventBus - Event bus for internal communication
     * @param {Object} currentZIndex - Reference object with value property for z-index
     * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
     * @param {Function} trackPendingSave - Function to track pending saveId
     * @param {Function} releasePendingSave - Function to release pending saveId
     * @param {number} currentTabId - Current browser tab ID
     * @param {Object} Events - Events constants object
     */
    constructor(
      quickTabsMap,
      broadcastManager,
      storageManager,
      minimizedManager,
      eventBus,
      currentZIndex,
      generateSaveId,
      trackPendingSave,
      releasePendingSave,
      currentTabId,
      Events
    ) {
      this.quickTabsMap = quickTabsMap;
      this.broadcastManager = broadcastManager;
      this.storageManager = storageManager;
      this.minimizedManager = minimizedManager;
      this.eventBus = eventBus;
      this.currentZIndex = currentZIndex;
      this.generateSaveId = generateSaveId;
      this.trackPendingSave = trackPendingSave;
      this.releasePendingSave = releasePendingSave;
      this.currentTabId = currentTabId;
      this.Events = Events;
    }

    /**
     * Handle solo toggle from Quick Tab window or panel
     * v1.5.9.13 - Solo feature: show Quick Tab ONLY on specific tabs
     *
     * @param {string} quickTabId - Quick Tab ID
     * @param {number[]} newSoloedTabs - Array of tab IDs where Quick Tab should be visible
     * @returns {Promise<void>}
     */
    async handleSoloToggle(quickTabId, newSoloedTabs) {
      console.log(`[VisibilityHandler] Toggling solo for ${quickTabId}:`, newSoloedTabs);

      const tab = this.quickTabsMap.get(quickTabId);
      if (!tab) return;

      // Update solo state
      tab.soloedOnTabs = newSoloedTabs;
      tab.mutedOnTabs = []; // Clear mute state (mutually exclusive)

      // Update button states if tab has them
      this._updateSoloButton(tab, newSoloedTabs);

      // Broadcast to other tabs
      this.broadcastManager.notifySolo(quickTabId, newSoloedTabs);

      // Save to background
      await this._sendToBackground(quickTabId, tab, 'SOLO', {
        soloedOnTabs: newSoloedTabs
      });
    }

    /**
     * Handle mute toggle from Quick Tab window or panel
     * v1.5.9.13 - Mute feature: hide Quick Tab ONLY on specific tabs
     *
     * @param {string} quickTabId - Quick Tab ID
     * @param {number[]} newMutedTabs - Array of tab IDs where Quick Tab should be hidden
     * @returns {Promise<void>}
     */
    async handleMuteToggle(quickTabId, newMutedTabs) {
      console.log(`[VisibilityHandler] Toggling mute for ${quickTabId}:`, newMutedTabs);

      const tab = this.quickTabsMap.get(quickTabId);
      if (!tab) return;

      // Update mute state
      tab.mutedOnTabs = newMutedTabs;
      tab.soloedOnTabs = []; // Clear solo state (mutually exclusive)

      // Update button states if tab has them
      this._updateMuteButton(tab, newMutedTabs);

      // Broadcast to other tabs
      this.broadcastManager.notifyMute(quickTabId, newMutedTabs);

      // Save to background
      await this._sendToBackground(quickTabId, tab, 'MUTE', {
        mutedOnTabs: newMutedTabs
      });
    }

    /**
     * Handle Quick Tab minimize
     * v1.5.8.13 - Broadcast minimize to other tabs
     * v1.5.9.8 - Update storage immediately to reflect minimized state
     *
     * @param {string} id - Quick Tab ID
     * @returns {Promise<void>}
     */
    async handleMinimize(id) {
      console.log('[VisibilityHandler] Handling minimize for:', id);

      const tabWindow = this.quickTabsMap.get(id);
      if (!tabWindow) return;

      // Add to minimized manager
      this.minimizedManager.add(id, tabWindow);

      // v1.5.8.13 - Broadcast minimize to other tabs
      this.broadcastManager.notifyMinimize(id);

      // Emit minimize event
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id });
      }

      // v1.5.9.8 - FIX: Update storage immediately to reflect minimized state
      const saveId = this.generateSaveId();
      this.trackPendingSave(saveId);

      // v1.5.9.12 - Get cookieStoreId from tab
      const cookieStoreId = tabWindow.cookieStoreId || 'firefox-default';

      if (typeof browser !== 'undefined' && browser.runtime) {
        try {
          await browser.runtime.sendMessage({
            action: 'UPDATE_QUICK_TAB_MINIMIZE',
            id: id,
            minimized: true,
            cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
            saveId: saveId,
            timestamp: Date.now()
          });
          this.releasePendingSave(saveId);
        } catch (err) {
          console.error('[VisibilityHandler] Error updating minimize state:', err);
          this.releasePendingSave(saveId);
        }
      } else {
        this.releasePendingSave(saveId);
      }
    }

    /**
     * Handle Quick Tab focus (bring to front)
     *
     * @param {string} id - Quick Tab ID
     */
    handleFocus(id) {
      console.log('[VisibilityHandler] Bringing to front:', id);

      const tabWindow = this.quickTabsMap.get(id);
      if (!tabWindow) return;

      // Increment z-index and update tab
      this.currentZIndex.value++;
      tabWindow.updateZIndex(this.currentZIndex.value);

      // Emit focus event
      if (this.eventBus && this.Events) {
        this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, { id });
      }
    }

    /**
     * Update solo button appearance
     * @private
     * @param {Object} tab - Quick Tab instance
     * @param {number[]} soloedOnTabs - Array of tab IDs
     */
    _updateSoloButton(tab, soloedOnTabs) {
      if (!tab.soloButton) return;

      const isSoloed = soloedOnTabs.length > 0;
      tab.soloButton.textContent = isSoloed ? '🎯' : '⭕';
      tab.soloButton.title = isSoloed ? 'Un-solo (show on all tabs)' : 'Solo (show only on this tab)';
      tab.soloButton.style.background = isSoloed ? '#444' : 'transparent';
    }

    /**
     * Update mute button appearance
     * @private
     * @param {Object} tab - Quick Tab instance
     * @param {number[]} mutedOnTabs - Array of tab IDs
     */
    _updateMuteButton(tab, mutedOnTabs) {
      if (!tab.muteButton) return;

      const isMuted = mutedOnTabs.includes(this.currentTabId);
      tab.muteButton.textContent = isMuted ? '🔇' : '🔊';
      tab.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
      tab.muteButton.style.background = isMuted ? '#c44' : 'transparent';
    }

    /**
     * Send message to background for persistence
     * @private
     * @param {string} quickTabId - Quick Tab ID
     * @param {Object} tab - Quick Tab instance
     * @param {string} action - Action type ('SOLO' or 'MUTE')
     * @param {Object} data - Additional data to send
     * @returns {Promise<void>}
     */
    async _sendToBackground(quickTabId, tab, action, data) {
      const saveId = this.generateSaveId();
      const cookieStoreId = tab?.cookieStoreId || 'firefox-default';

      if (typeof browser !== 'undefined' && browser.runtime) {
        try {
          await browser.runtime.sendMessage({
            action: `UPDATE_QUICK_TAB_${action}`,
            id: quickTabId,
            ...data,
            cookieStoreId: cookieStoreId,
            saveId: saveId,
            timestamp: Date.now()
          });
        } catch (err) {
          console.error(`[VisibilityHandler] ${action} update error:`, err);
          this.releasePendingSave(saveId);
        }
      } else {
        this.releasePendingSave(saveId);
      }
    }
  }

  /**
   * BroadcastManager - Handles cross-tab real-time messaging
   * Phase 2.1: Extracted from QuickTabsManager
   *
   * Responsibilities:
   * - Setup BroadcastChannel for container-specific messaging
   * - Send broadcast messages to other tabs
   * - Receive and route broadcast messages
   * - Debounce rapid broadcasts to prevent loops
   * - Container-aware channel management
   *
   * Uses:
   * - BroadcastChannel API for <10ms cross-tab sync
   * - EventBus for decoupled message handling
   */

  class BroadcastManager {
    constructor(eventBus, cookieStoreId = 'firefox-default') {
      this.eventBus = eventBus;
      this.cookieStoreId = cookieStoreId;

      // Broadcast channel
      this.broadcastChannel = null;
      this.currentChannelName = null;

      // Debounce to prevent message loops
      this.broadcastDebounce = new Map(); // key -> timestamp
      this.BROADCAST_DEBOUNCE_MS = 50; // Ignore duplicate broadcasts within 50ms
    }

    /**
     * Setup BroadcastChannel for cross-tab messaging
     */
    setupBroadcastChannel() {
      if (typeof BroadcastChannel === 'undefined') {
        console.warn('[BroadcastManager] BroadcastChannel not available, using storage-only sync');
        return;
      }

      try {
        // Container-specific channel for isolation
        const channelName = `quick-tabs-sync-${this.cookieStoreId}`;

        // Close existing channel if present
        if (this.broadcastChannel) {
          console.log(`[BroadcastManager] Closing old channel: ${this.currentChannelName}`);
          this.broadcastChannel.close();
        }

        this.broadcastChannel = new BroadcastChannel(channelName);
        this.currentChannelName = channelName;

        console.log(`[BroadcastManager] BroadcastChannel created: ${channelName}`);

        // Setup message handler
        this.broadcastChannel.onmessage = event => {
          this.handleBroadcastMessage(event.data);
        };

        console.log(`[BroadcastManager] Initialized for container: ${this.cookieStoreId}`);
      } catch (err) {
        console.error('[BroadcastManager] Failed to setup BroadcastChannel:', err);
      }
    }

    /**
     * Handle incoming broadcast message
     * @param {Object} message - Message data with type and data
     */
    handleBroadcastMessage(message) {
      console.log('[BroadcastManager] Message received:', message);

      const { type, data } = message;

      // Debounce rapid messages to prevent loops
      if (this.shouldDebounce(type, data)) {
        console.log('[BroadcastManager] Ignoring duplicate broadcast (debounced):', type, data.id);
        return;
      }

      // Emit event for handlers to process
      this.eventBus?.emit('broadcast:received', { type, data });
    }

    /**
     * Check if message should be debounced
     * @param {string} type - Message type
     * @param {Object} data - Message data
     * @returns {boolean} - True if should skip
     */
    shouldDebounce(type, data) {
      if (!data || !data.id) {
        return false;
      }

      const debounceKey = `${type}-${data.id}`;
      const now = Date.now();
      const lastProcessed = this.broadcastDebounce.get(debounceKey);

      if (lastProcessed && now - lastProcessed < this.BROADCAST_DEBOUNCE_MS) {
        return true;
      }

      // Update timestamp
      this.broadcastDebounce.set(debounceKey, now);

      // Clean up old entries to prevent memory leak
      this._cleanupOldDebounceEntries(now);

      return false;
    }

    /**
     * Clean up old debounce entries to prevent memory leak
     * @private
     */
    _cleanupOldDebounceEntries(now) {
      if (this.broadcastDebounce.size <= 100) {
        return;
      }

      const oldestAllowed = now - this.BROADCAST_DEBOUNCE_MS * 2;
      for (const [key, timestamp] of this.broadcastDebounce.entries()) {
        if (timestamp < oldestAllowed) {
          this.broadcastDebounce.delete(key);
        }
      }
    }

    /**
     * Broadcast message to other tabs
     * @param {string} type - Message type (CREATE, UPDATE_POSITION, etc.)
     * @param {Object} data - Message payload
     */
    broadcast(type, data) {
      if (!this.broadcastChannel) {
        console.warn('[BroadcastManager] No broadcast channel available');
        return;
      }

      try {
        this.broadcastChannel.postMessage({ type, data });
        console.log(`[BroadcastManager] Broadcasted ${type}:`, data);
      } catch (err) {
        console.error('[BroadcastManager] Failed to broadcast:', err);
      }
    }

    /**
     * Broadcast Quick Tab creation
     * @param {Object} quickTabData - Quick Tab data to broadcast
     */
    async notifyCreate(quickTabData) {
      await this.broadcast('CREATE', quickTabData);
    }

    /**
     * Broadcast position update
     * @param {string} id - Quick Tab ID
     * @param {number} left - Left position
     * @param {number} top - Top position
     */
    async notifyPositionUpdate(id, left, top) {
      await this.broadcast('UPDATE_POSITION', { id, left, top });
    }

    /**
     * Broadcast size update
     * @param {string} id - Quick Tab ID
     * @param {number} width - Width
     * @param {number} height - Height
     */
    async notifySizeUpdate(id, width, height) {
      await this.broadcast('UPDATE_SIZE', { id, width, height });
    }

    /**
     * Broadcast minimize
     * @param {string} id - Quick Tab ID
     */
    async notifyMinimize(id) {
      await this.broadcast('MINIMIZE', { id });
    }

    /**
     * Broadcast restore
     * @param {string} id - Quick Tab ID
     */
    async notifyRestore(id) {
      await this.broadcast('RESTORE', { id });
    }

    /**
     * Broadcast close
     * @param {string} id - Quick Tab ID
     */
    async notifyClose(id) {
      await this.broadcast('CLOSE', { id });
    }

    /**
     * Broadcast solo state change
     * @param {string} id - Quick Tab ID
     * @param {Array<number>} soloedOnTabs - Array of tab IDs where Quick Tab is soloed
     */
    async notifySolo(id, soloedOnTabs) {
      await this.broadcast('SOLO', { id, soloedOnTabs });
    }

    /**
     * Broadcast mute state change
     * @param {string} id - Quick Tab ID
     * @param {Array<number>} mutedOnTabs - Array of tab IDs where Quick Tab is muted
     */
    async notifyMute(id, mutedOnTabs) {
      await this.broadcast('MUTE', { id, mutedOnTabs });
    }

    /**
     * Update container context (re-creates channel)
     * @param {string} cookieStoreId - New container ID
     */
    updateContainer(cookieStoreId) {
      if (this.cookieStoreId === cookieStoreId) {
        return; // No change
      }

      console.log(`[BroadcastManager] Updating container: ${this.cookieStoreId} → ${cookieStoreId}`);
      this.cookieStoreId = cookieStoreId;
      this.setupBroadcastChannel(); // Re-create channel for new container
    }

    /**
     * Close broadcast channel
     */
    close() {
      if (this.broadcastChannel) {
        console.log(`[BroadcastManager] Closing channel: ${this.currentChannelName}`);
        this.broadcastChannel.close();
        this.broadcastChannel = null;
        this.currentChannelName = null;
      }
    }
  }

  /**
   * EventManager - Manages window-level DOM event listeners
   *
   * Responsibilities:
   * - Setup emergency save handlers (beforeunload, visibilitychange, pagehide)
   * - Coordinate window event listeners
   * - Clean up event listeners on teardown
   *
   * @module EventManager
   */

  class EventManager {
    /**
     * @param {EventEmitter} eventBus - Event bus for inter-component communication
     * @param {Map} quickTabsMap - Reference to Quick Tabs map for size checking
     */
    constructor(eventBus, quickTabsMap) {
      this.eventBus = eventBus;
      this.quickTabsMap = quickTabsMap;

      // Store bound handlers for cleanup
      this.boundHandlers = {
        visibilityChange: null,
        beforeUnload: null,
        pageHide: null
      };
    }

    /**
     * Setup emergency save handlers for tab visibility and page unload
     * These ensure Quick Tabs state is preserved when:
     * - User switches tabs (visibilitychange)
     * - User closes tab or navigates away (beforeunload)
     * - Page is hidden (pagehide)
     */
    setupEmergencySaveHandlers() {
      // Emergency save when tab becomes hidden (user switches tabs)
      this.boundHandlers.visibilityChange = () => {
        if (document.hidden && this.quickTabsMap.size > 0) {
          console.log('[EventManager] Tab hidden - triggering emergency save');
          this.eventBus?.emit('event:emergency-save', { trigger: 'visibilitychange' });
        }
      };

      // Emergency save before page unload
      this.boundHandlers.beforeUnload = () => {
        if (this.quickTabsMap.size > 0) {
          console.log('[EventManager] Page unloading - triggering emergency save');
          this.eventBus?.emit('event:emergency-save', { trigger: 'beforeunload' });
        }
      };

      // Emergency save before page is hidden (more reliable than beforeunload in some browsers)
      this.boundHandlers.pageHide = () => {
        if (this.quickTabsMap.size > 0) {
          console.log('[EventManager] Page hiding - triggering emergency save');
          this.eventBus?.emit('event:emergency-save', { trigger: 'pagehide' });
        }
      };

      // Attach listeners
      document.addEventListener('visibilitychange', this.boundHandlers.visibilityChange);
      window.addEventListener('beforeunload', this.boundHandlers.beforeUnload);
      window.addEventListener('pagehide', this.boundHandlers.pageHide);

      console.log('[EventManager] Emergency save handlers attached');
    }

    /**
     * Teardown all event listeners
     * Call this when QuickTabsManager is being destroyed
     */
    teardown() {
      if (this.boundHandlers.visibilityChange) {
        document.removeEventListener('visibilitychange', this.boundHandlers.visibilityChange);
      }

      if (this.boundHandlers.beforeUnload) {
        window.removeEventListener('beforeunload', this.boundHandlers.beforeUnload);
      }

      if (this.boundHandlers.pageHide) {
        window.removeEventListener('pagehide', this.boundHandlers.pageHide);
      }

      console.log('[EventManager] Event handlers removed');
    }
  }

  /**
   * QuickTab Domain Entity
   * v1.6.0 - Pure business logic, no browser APIs or UI dependencies
   *
   * Represents a Quick Tab with its state and behavior.
   * Extracted from QuickTabsManager to separate domain logic from infrastructure.
   */

  /**
   * Validate string parameter
   * @private
   */
  function _validateString(value, name) {
    if (!value || typeof value !== 'string') {
      throw new Error(`QuickTab requires a valid string ${name}`);
    }
  }

  /**
   * Validate position object
   * @private
   */
  function _validatePosition(position) {
    if (!position || typeof position.left !== 'number' || typeof position.top !== 'number') {
      throw new Error('QuickTab requires valid position {left, top}');
    }
  }

  /**
   * Validate size object
   * @private
   */
  function _validateSize(size) {
    if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') {
      throw new Error('QuickTab requires valid size {width, height}');
    }
  }

  /**
   * Validate QuickTab constructor parameters
   * @private
   */
  function _validateParams({ id, url, position, size }) {
    _validateString(id, 'id');
    _validateString(url, 'url');
    _validatePosition(position);
    _validateSize(size);
  }

  class QuickTab {
    /**
     * Create a new QuickTab instance
     * @param {Object} params - QuickTab parameters
     * @param {string} params.id - Unique identifier
     * @param {string} params.url - URL of the Quick Tab
     * @param {Object} params.position - {left, top} position
     * @param {Object} params.size - {width, height} size
     * @param {Object} params.visibility - Visibility state
     * @param {string} params.container - Firefox container ID (cookieStoreId)
     * @param {number} [params.createdAt] - Creation timestamp
     * @param {string} [params.title] - Tab title
     * @param {number} [params.zIndex] - Z-index for stacking
     */
    constructor({
      id,
      url,
      position,
      size,
      visibility,
      container,
      createdAt = Date.now(),
      title = 'Quick Tab',
      zIndex = 1000
    }) {
      // Validation
      _validateParams({ id, url, position, size });

      // Immutable core properties
      this.id = id;
      this.url = url;
      this.container = container || 'firefox-default';
      this.createdAt = createdAt;

      // Mutable properties
      this.title = title;
      this.position = { ...position }; // Clone to prevent external mutation
      this.size = { ...size };
      this.zIndex = zIndex;

      // Visibility state (v1.5.9.13 - Solo/Mute feature)
      this.visibility = {
        minimized: visibility?.minimized || false,
        soloedOnTabs: visibility?.soloedOnTabs || [],
        mutedOnTabs: visibility?.mutedOnTabs || []
      };
    }

    /**
     * Determine if this Quick Tab should be visible on a specific tab
     * v1.5.9.13 - Implements Solo/Mute visibility logic
     *
     * Business Rules:
     * 1. If minimized, never visible
     * 2. If soloedOnTabs has entries, only visible on those tabs
     * 3. If mutedOnTabs has entries, NOT visible on those tabs
     * 4. Solo takes precedence over mute
     *
     * @param {number} tabId - Browser tab ID to check visibility for
     * @returns {boolean} - True if Quick Tab should be visible on this tab
     */
    shouldBeVisible(tabId) {
      // Rule 1: Minimized tabs are never visible
      if (this.visibility.minimized) {
        return false;
      }

      // Rule 2: Solo mode - only visible on specific tabs
      if (this.visibility.soloedOnTabs.length > 0) {
        return this.visibility.soloedOnTabs.includes(tabId);
      }

      // Rule 3: Mute mode - NOT visible on specific tabs
      if (this.visibility.mutedOnTabs.length > 0) {
        return !this.visibility.mutedOnTabs.includes(tabId);
      }

      // Default: visible everywhere
      return true;
    }

    /**
     * Toggle solo mode for a specific tab
     * v1.5.9.13 - Solo: Show ONLY on this tab
     *
     * @param {number} tabId - Tab ID to solo on
     * @returns {boolean} - True if tab was added to solo list, false if removed
     */
    toggleSolo(tabId) {
      const index = this.visibility.soloedOnTabs.indexOf(tabId);

      if (index === -1) {
        // Add to solo list
        this.visibility.soloedOnTabs.push(tabId);
        // Clear mute list (mutual exclusivity)
        this.visibility.mutedOnTabs = [];
        return true;
      } else {
        // Remove from solo list
        this.visibility.soloedOnTabs.splice(index, 1);
        return false;
      }
    }

    /**
     * Add tab to solo list (make visible ONLY on this tab)
     * v1.5.9.13
     *
     * @param {number} tabId - Tab ID to solo on
     */
    solo(tabId) {
      if (!this.visibility.soloedOnTabs.includes(tabId)) {
        this.visibility.soloedOnTabs.push(tabId);
      }
      // Clear mute list (mutual exclusivity)
      this.visibility.mutedOnTabs = [];
    }

    /**
     * Remove tab from solo list
     * v1.5.9.13
     *
     * @param {number} tabId - Tab ID to remove from solo list
     */
    unsolo(tabId) {
      this.visibility.soloedOnTabs = this.visibility.soloedOnTabs.filter(id => id !== tabId);
    }

    /**
     * Clear all solo tabs
     * v1.5.9.13
     */
    clearSolo() {
      this.visibility.soloedOnTabs = [];
    }

    /**
     * Toggle mute mode for a specific tab
     * v1.5.9.13 - Mute: Hide ONLY on this tab
     *
     * @param {number} tabId - Tab ID to mute on
     * @returns {boolean} - True if tab was added to mute list, false if removed
     */
    toggleMute(tabId) {
      const index = this.visibility.mutedOnTabs.indexOf(tabId);

      if (index === -1) {
        // Add to mute list
        this.visibility.mutedOnTabs.push(tabId);
        // Clear solo list (mutual exclusivity)
        this.visibility.soloedOnTabs = [];
        return true;
      } else {
        // Remove from mute list
        this.visibility.mutedOnTabs.splice(index, 1);
        return false;
      }
    }

    /**
     * Add tab to mute list (hide ONLY on this tab)
     * v1.5.9.13
     *
     * @param {number} tabId - Tab ID to mute on
     */
    mute(tabId) {
      if (!this.visibility.mutedOnTabs.includes(tabId)) {
        this.visibility.mutedOnTabs.push(tabId);
      }
      // Clear solo list (mutual exclusivity)
      this.visibility.soloedOnTabs = [];
    }

    /**
     * Remove tab from mute list
     * v1.5.9.13
     *
     * @param {number} tabId - Tab ID to remove from mute list
     */
    unmute(tabId) {
      this.visibility.mutedOnTabs = this.visibility.mutedOnTabs.filter(id => id !== tabId);
    }

    /**
     * Clear all muted tabs
     * v1.5.9.13
     */
    clearMute() {
      this.visibility.mutedOnTabs = [];
    }

    /**
     * Toggle minimized state
     *
     * @returns {boolean} - New minimized state
     */
    toggleMinimized() {
      this.visibility.minimized = !this.visibility.minimized;
      return this.visibility.minimized;
    }

    /**
     * Set minimized state
     *
     * @param {boolean} minimized - New minimized state
     */
    setMinimized(minimized) {
      this.visibility.minimized = minimized;
    }

    /**
     * Update position
     *
     * @param {number} left - New left position
     * @param {number} top - New top position
     */
    updatePosition(left, top) {
      if (typeof left !== 'number' || typeof top !== 'number') {
        throw new Error('Position must be numeric {left, top}');
      }
      this.position = { left, top };
    }

    /**
     * Update size
     *
     * @param {number} width - New width
     * @param {number} height - New height
     */
    updateSize(width, height) {
      if (typeof width !== 'number' || typeof height !== 'number') {
        throw new Error('Size must be numeric {width, height}');
      }
      if (width <= 0 || height <= 0) {
        throw new Error('Size must be positive');
      }
      this.size = { width, height };
    }

    /**
     * Update z-index for stacking order
     *
     * @param {number} zIndex - New z-index
     */
    updateZIndex(zIndex) {
      if (typeof zIndex !== 'number') {
        throw new Error('zIndex must be a number');
      }
      this.zIndex = zIndex;
    }

    /**
     * Update title
     *
     * @param {string} title - New title
     */
    updateTitle(title) {
      if (typeof title !== 'string') {
        throw new Error('Title must be a string');
      }
      this.title = title;
    }

    /**
     * Clean up dead tab IDs from solo/mute arrays
     * Should be called when tabs are closed
     *
     * @param {number[]} activeTabIds - Array of currently active tab IDs
     */
    cleanupDeadTabs(activeTabIds) {
      const activeSet = new Set(activeTabIds);

      this.visibility.soloedOnTabs = this.visibility.soloedOnTabs.filter(id => activeSet.has(id));

      this.visibility.mutedOnTabs = this.visibility.mutedOnTabs.filter(id => activeSet.has(id));
    }

    /**
     * Check if this Quick Tab belongs to a specific container
     *
     * @param {string} containerIdOrCookieStoreId - Container ID or cookieStoreId to check
     * @returns {boolean} - True if this Quick Tab belongs to the container
     */
    belongsToContainer(containerIdOrCookieStoreId) {
      return this.container === containerIdOrCookieStoreId;
    }

    /**
     * Serialize to storage format
     * Converts domain entity to plain object for storage
     *
     * @returns {Object} - Plain object suitable for storage
     */
    serialize() {
      return {
        id: this.id,
        url: this.url,
        title: this.title,
        position: { ...this.position },
        size: { ...this.size },
        visibility: {
          minimized: this.visibility.minimized,
          soloedOnTabs: [...this.visibility.soloedOnTabs],
          mutedOnTabs: [...this.visibility.mutedOnTabs]
        },
        container: this.container,
        zIndex: this.zIndex,
        createdAt: this.createdAt
      };
    }

    /**
     * Create QuickTab from storage format
     * Static factory method to hydrate from plain object
     *
     * @param {Object} data - Plain object from storage
     * @returns {QuickTab} - QuickTab domain entity
     */
    static fromStorage(data) {
      return new QuickTab({
        id: data.id,
        url: data.url,
        title: data.title || 'Quick Tab',
        position: data.position || { left: 100, top: 100 },
        size: data.size || { width: 800, height: 600 },
        visibility: data.visibility || {
          minimized: false,
          soloedOnTabs: [],
          mutedOnTabs: []
        },
        container: data.container || data.cookieStoreId || 'firefox-default',
        zIndex: data.zIndex || 1000,
        createdAt: data.createdAt || Date.now()
      });
    }

    /**
     * Create QuickTab with defaults
     * Convenience factory method for creating new Quick Tabs
     *
     * @param {Object} params - Partial parameters
     * @returns {QuickTab} - QuickTab domain entity with defaults
     */
    static create({ id, url, left = 100, top = 100, width = 800, height = 600, container, title }) {
      if (!id) {
        throw new Error('QuickTab.create requires id');
      }
      if (!url) {
        throw new Error('QuickTab.create requires url');
      }

      return new QuickTab({
        id,
        url,
        title: title || 'Quick Tab',
        position: { left, top },
        size: { width, height },
        visibility: {
          minimized: false,
          soloedOnTabs: [],
          mutedOnTabs: []
        },
        container: container || 'firefox-default',
        zIndex: 1000,
        createdAt: Date.now()
      });
    }
  }

  var QuickTab$1 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    QuickTab: QuickTab
  });

  /**
   * StateManager - Manages local in-memory Quick Tab state
   * Phase 2.1: Extracted from QuickTabsManager
   *
   * Responsibilities:
   * - Maintain Map of QuickTab instances
   * - Add/update/delete Quick Tabs
   * - Query Quick Tabs by ID or criteria
   * - Hydrate state from storage
   * - Track current tab ID for visibility filtering
   *
   * Uses:
   * - QuickTab domain entities (not QuickTabWindow UI components)
   * - Map for O(1) lookups
   */


  class StateManager {
    constructor(eventBus, currentTabId = null) {
      this.eventBus = eventBus;
      this.currentTabId = currentTabId;

      // In-memory state: Map<id, QuickTab>
      this.quickTabs = new Map();

      // Z-index management
      this.currentZIndex = 10000; // Base z-index from CONSTANTS
    }

    /**
     * Add Quick Tab to state
     * @param {QuickTab} quickTab - QuickTab domain entity
     */
    add(quickTab) {
      if (!(quickTab instanceof QuickTab)) {
        throw new Error('StateManager.add() requires QuickTab instance');
      }

      this.quickTabs.set(quickTab.id, quickTab);
      this.eventBus?.emit('state:added', quickTab);

      console.log(`[StateManager] Added Quick Tab: ${quickTab.id}`);
    }

    /**
     * Get Quick Tab by ID
     * @param {string} id - Quick Tab ID
     * @returns {QuickTab|undefined} - Quick Tab instance or undefined
     */
    get(id) {
      return this.quickTabs.get(id);
    }

    /**
     * Check if Quick Tab exists
     * @param {string} id - Quick Tab ID
     * @returns {boolean} - True if exists
     */
    has(id) {
      return this.quickTabs.has(id);
    }

    /**
     * Update Quick Tab
     * @param {QuickTab} quickTab - Updated QuickTab domain entity
     */
    update(quickTab) {
      if (!(quickTab instanceof QuickTab)) {
        throw new Error('StateManager.update() requires QuickTab instance');
      }

      if (!this.quickTabs.has(quickTab.id)) {
        console.warn(`[StateManager] Cannot update non-existent Quick Tab: ${quickTab.id}`);
        return;
      }

      this.quickTabs.set(quickTab.id, quickTab);
      this.eventBus?.emit('state:updated', quickTab);

      console.log(`[StateManager] Updated Quick Tab: ${quickTab.id}`);
    }

    /**
     * Delete Quick Tab from state
     * @param {string} id - Quick Tab ID
     * @returns {boolean} - True if deleted
     */
    delete(id) {
      const quickTab = this.quickTabs.get(id);
      const deleted = this.quickTabs.delete(id);

      if (deleted) {
        this.eventBus?.emit('state:deleted', quickTab);
        console.log(`[StateManager] Deleted Quick Tab: ${id}`);
      }

      return deleted;
    }

    /**
     * Get all Quick Tabs
     * @returns {Array<QuickTab>} - Array of all Quick Tabs
     */
    getAll() {
      return Array.from(this.quickTabs.values());
    }

    /**
     * Get visible Quick Tabs based on current tab ID
     * @returns {Array<QuickTab>} - Array of visible Quick Tabs
     */
    getVisible() {
      if (!this.currentTabId) {
        // No filtering if current tab ID unknown
        return this.getAll();
      }

      return this.getAll().filter(qt => qt.shouldBeVisible(this.currentTabId));
    }

    /**
     * Get minimized Quick Tabs
     * @returns {Array<QuickTab>} - Array of minimized Quick Tabs
     */
    getMinimized() {
      return this.getAll().filter(qt => qt.visibility.minimized);
    }

    /**
     * Get Quick Tabs for specific container
     * @param {string} cookieStoreId - Container ID
     * @returns {Array<QuickTab>} - Array of Quick Tabs for container
     */
    getByContainer(cookieStoreId) {
      return this.getAll().filter(qt => qt.belongsToContainer(cookieStoreId));
    }

    /**
     * Hydrate state from array of QuickTab entities
     * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
     */
    hydrate(quickTabs) {
      if (!Array.isArray(quickTabs)) {
        throw new Error('StateManager.hydrate() requires array of QuickTab instances');
      }

      this.quickTabs.clear();

      for (const qt of quickTabs) {
        if (qt instanceof QuickTab) {
          this.quickTabs.set(qt.id, qt);
        } else {
          console.warn('[StateManager] Skipping non-QuickTab instance during hydration');
        }
      }

      this.eventBus?.emit('state:hydrated', { count: quickTabs.length });
      console.log(`[StateManager] Hydrated ${quickTabs.length} Quick Tabs`);
    }

    /**
     * Clear all Quick Tabs
     */
    clear() {
      const count = this.quickTabs.size;
      this.quickTabs.clear();
      this.currentZIndex = 10000; // Reset z-index

      this.eventBus?.emit('state:cleared', { count });
      console.log(`[StateManager] Cleared ${count} Quick Tabs`);
    }

    /**
     * Get count of Quick Tabs
     * @returns {number} - Number of Quick Tabs
     */
    count() {
      return this.quickTabs.size;
    }

    /**
     * Update current tab ID for visibility filtering
     * @param {number} tabId - Firefox tab ID
     */
    setCurrentTabId(tabId) {
      this.currentTabId = tabId;
      console.log(`[StateManager] Current tab ID set to: ${tabId}`);
    }

    /**
     * Get next z-index for new Quick Tab
     * @returns {number} - Next z-index value
     */
    getNextZIndex() {
      this.currentZIndex += 1;
      return this.currentZIndex;
    }

    /**
     * Update Quick Tab z-index
     * @param {string} id - Quick Tab ID
     * @param {number} zIndex - New z-index
     */
    updateZIndex(id, zIndex) {
      const quickTab = this.quickTabs.get(id);
      if (quickTab) {
        quickTab.updateZIndex(zIndex);
        this.quickTabs.set(id, quickTab);

        // Track highest z-index
        if (zIndex > this.currentZIndex) {
          this.currentZIndex = zIndex;
        }
      }
    }

    /**
     * Bring Quick Tab to front
     * @param {string} id - Quick Tab ID
     */
    bringToFront(id) {
      const nextZIndex = this.getNextZIndex();
      this.updateZIndex(id, nextZIndex);
      this.eventBus?.emit('state:z-index-changed', { id, zIndex: nextZIndex });
    }

    /**
     * Clean up dead tab IDs from solo/mute arrays
     * @param {Array<number>} activeTabIds - Array of currently active tab IDs
     */
    cleanupDeadTabs(activeTabIds) {
      let cleaned = 0;

      for (const quickTab of this.quickTabs.values()) {
        const before =
          quickTab.visibility.soloedOnTabs.length + quickTab.visibility.mutedOnTabs.length;
        quickTab.cleanupDeadTabs(activeTabIds);
        const after =
          quickTab.visibility.soloedOnTabs.length + quickTab.visibility.mutedOnTabs.length;

        if (before !== after) {
          this.quickTabs.set(quickTab.id, quickTab);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[StateManager] Cleaned dead tabs from ${cleaned} Quick Tabs`);
        this.eventBus?.emit('state:cleaned', { count: cleaned });
      }
    }
  }

  /**
   * Container Domain Entity
   * v1.6.0 - Firefox Multi-Account Containers support
   *
   * Represents a Firefox container (contextual identity) for state isolation.
   * Extracted from background.js to separate domain logic from infrastructure.
   */

  class Container {
    /**
     * Create a new Container instance
     * @param {Object} params - Container parameters
     * @param {string} params.id - Container ID (cookieStoreId)
     * @param {string} [params.name] - Human-readable container name
     * @param {string} [params.color] - Container color
     * @param {string} [params.icon] - Container icon
     */
    constructor({ id, name, color, icon }) {
      // Validation
      if (!id || typeof id !== 'string') {
        throw new Error('Container requires a valid string id');
      }

      this.id = id;
      this.name = name || this.getDefaultName(id);
      this.color = color || 'grey';
      this.icon = icon || 'circle';
    }

    /**
     * Get default name for a container ID
     * @private
     * @param {string} id - Container ID (cookieStoreId)
     * @returns {string} - Default name
     */
    getDefaultName(id) {
      if (id === 'firefox-default') {
        return 'Default';
      }
      if (id.startsWith('firefox-container-')) {
        const num = id.split('-').pop();
        return `Container ${num}`;
      }
      if (id.startsWith('firefox-private')) {
        return 'Private';
      }
      return 'Unknown Container';
    }

    /**
     * Check if this is the default container
     * @returns {boolean} - True if this is the default container
     */
    isDefault() {
      return this.id === 'firefox-default';
    }

    /**
     * Check if this is a private container
     * @returns {boolean} - True if this is a private browsing container
     */
    isPrivate() {
      return this.id.startsWith('firefox-private');
    }

    /**
     * Check if this is a custom container
     * @returns {boolean} - True if this is a custom multi-account container
     */
    isCustom() {
      return this.id.startsWith('firefox-container-');
    }

    /**
     * Get container number (for custom containers)
     * @returns {number|null} - Container number or null if not a custom container
     */
    getContainerNumber() {
      if (!this.isCustom()) {
        return null;
      }
      const match = this.id.match(/firefox-container-(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    }

    /**
     * Validate container ID format
     * @static
     * @param {string} id - Container ID to validate
     * @returns {boolean} - True if valid Firefox container ID
     */
    static isValidId(id) {
      if (!id || typeof id !== 'string') {
        return false;
      }

      return (
        id === 'firefox-default' ||
        id.startsWith('firefox-container-') ||
        id.startsWith('firefox-private')
      );
    }

    /**
     * Sanitize container ID
     * Ensures the ID is a valid Firefox container ID
     *
     * @static
     * @param {string} id - Container ID to sanitize
     * @returns {string} - Sanitized container ID (defaults to 'firefox-default' if invalid)
     */
    static sanitize(id) {
      if (!id || typeof id !== 'string') {
        return 'firefox-default';
      }

      if (Container.isValidId(id)) {
        return id;
      }

      return 'firefox-default';
    }

    /**
     * Extract container number from ID
     * @static
     * @param {string} id - Container ID
     * @returns {number|null} - Container number or null
     */
    static extractNumber(id) {
      if (!id || typeof id !== 'string') {
        return null;
      }

      const match = id.match(/firefox-container-(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    }

    /**
     * Create Container from Firefox contextualIdentities API response
     * @static
     * @param {Object} identity - Firefox contextualIdentities.get() response
     * @returns {Container} - Container domain entity
     */
    static fromContextualIdentity(identity) {
      return new Container({
        id: identity.cookieStoreId,
        name: identity.name,
        color: identity.color,
        icon: identity.icon
      });
    }

    /**
     * Create default container
     * @static
     * @returns {Container} - Default container
     */
    static default() {
      return new Container({
        id: 'firefox-default',
        name: 'Default',
        color: 'grey',
        icon: 'circle'
      });
    }

    /**
     * Serialize to storage format
     * @returns {Object} - Plain object suitable for storage
     */
    serialize() {
      return {
        id: this.id,
        name: this.name,
        color: this.color,
        icon: this.icon
      };
    }

    /**
     * Create Container from storage format
     * @static
     * @param {Object} data - Plain object from storage
     * @returns {Container} - Container domain entity
     */
    static fromStorage(data) {
      return new Container({
        id: data.id,
        name: data.name,
        color: data.color,
        icon: data.icon
      });
    }
  }

  /**
   * StorageAdapter - Abstract base class for storage implementations
   *
   * Defines the contract that all storage adapters must implement.
   * Ensures consistent async-first API across all storage backends.
   *
   * @abstract
   */
  /* eslint-disable require-await */
  class StorageAdapter {
    /**
     * Save Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID (e.g., 'firefox-default', 'firefox-container-1')
     * @param {QuickTab[]} tabs - Array of QuickTab domain entities
     * @returns {Promise<string>} Save ID for tracking race conditions
     * @throws {Error} If not implemented by subclass
     */
    async save(_containerId, _tabs) {
      throw new Error('StorageAdapter.save() must be implemented by subclass');
    }

    /**
     * Load Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @returns {Promise<{tabs: QuickTab[], lastUpdate: number}|null>} Container data or null if not found
     * @throws {Error} If not implemented by subclass
     */
    async load(_containerId) {
      throw new Error('StorageAdapter.load() must be implemented by subclass');
    }

    /**
     * Load all Quick Tabs across all containers
     *
     * @returns {Promise<Object.<string, {tabs: QuickTab[], lastUpdate: number}>>} Map of container ID to container data
     * @throws {Error} If not implemented by subclass
     */
    async loadAll() {
      throw new Error('StorageAdapter.loadAll() must be implemented by subclass');
    }

    /**
     * Delete a specific Quick Tab from a container
     *
     * @param {string} containerId - Firefox container ID
     * @param {string} quickTabId - Quick Tab ID to delete
     * @returns {Promise<void>}
     * @throws {Error} If not implemented by subclass
     */
    async delete(_containerId, _quickTabId) {
      throw new Error('StorageAdapter.delete() must be implemented by subclass');
    }

    /**
     * Delete all Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @returns {Promise<void>}
     * @throws {Error} If not implemented by subclass
     */
    async deleteContainer(_containerId) {
      throw new Error('StorageAdapter.deleteContainer() must be implemented by subclass');
    }

    /**
     * Clear all Quick Tabs across all containers
     *
     * @returns {Promise<void>}
     * @throws {Error} If not implemented by subclass
     */
    async clear() {
      throw new Error('StorageAdapter.clear() must be implemented by subclass');
    }
  }

  /**
   * SessionStorageAdapter - Storage adapter for browser.storage.session API
   *
   * Features:
   * - Container-aware storage format
   * - Temporary storage (cleared on browser restart)
   * - No quota limits (unlike sync storage)
   * - Faster than sync storage (no cross-device sync overhead)
   * - SaveId tracking to prevent race conditions
   *
   * Use Cases:
   * - Quick Tab state during active browser session
   * - Temporary caching to reduce sync storage writes
   * - Rollback buffer before committing to sync storage
   *
   * Storage Format (same as SyncStorageAdapter):
   * {
   *   quick_tabs_state_v2: {
   *     containers: {
   *       'firefox-default': {
   *         tabs: [QuickTab, ...],
   *         lastUpdate: timestamp
   *       }
   *     },
   *     saveId: 'timestamp-random',
   *     timestamp: timestamp
   *   }
   * }
   */
  class SessionStorageAdapter extends StorageAdapter {
    constructor() {
      super();
      this.STORAGE_KEY = 'quick_tabs_state_v2';
    }

    /**
     * Save Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @param {QuickTab[]} tabs - Array of QuickTab domain entities
     * @returns {Promise<string>} Save ID for tracking race conditions
     */
    async save(containerId, tabs) {
      // Load existing state
      const existingState = await this._loadRawState();

      // Update container
      if (!existingState.containers) {
        existingState.containers = {};
      }

      existingState.containers[containerId] = {
        tabs: tabs.map(t => t.serialize()),
        lastUpdate: Date.now()
      };

      // Generate save ID for race condition tracking
      const saveId = this._generateSaveId();
      existingState.saveId = saveId;
      existingState.timestamp = Date.now();

      // Wrap in storage key
      const stateToSave = {
        [this.STORAGE_KEY]: existingState
      };

      try {
        await browser$1.storage.session.set(stateToSave);
        console.log(
          `[SessionStorageAdapter] Saved ${tabs.length} tabs for container ${containerId} (saveId: ${saveId})`
        );
        return saveId;
      } catch (error) {
        console.error('[SessionStorageAdapter] Save failed:', error);
        throw error;
      }
    }

    /**
     * Load Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @returns {Promise<{tabs: Array, lastUpdate: number}|null>} Container data or null if not found
     */
    async load(containerId) {
      const state = await this._loadRawState();

      if (!state.containers || !state.containers[containerId]) {
        return null;
      }

      return state.containers[containerId];
    }

    /**
     * Load all Quick Tabs across all containers
     *
     * @returns {Promise<Object.<string, {tabs: Array, lastUpdate: number}>>} Map of container ID to container data
     */
    async loadAll() {
      const state = await this._loadRawState();
      return state.containers || {};
    }

    /**
     * Delete a specific Quick Tab from a container
     *
     * @param {string} containerId - Firefox container ID
     * @param {string} quickTabId - Quick Tab ID to delete
     * @returns {Promise<void>}
     */
    async delete(containerId, quickTabId) {
      const containerData = await this.load(containerId);

      if (!containerData) {
        console.warn(`[SessionStorageAdapter] Container ${containerId} not found for deletion`);
        return;
      }

      // Filter out the tab
      const filteredTabs = containerData.tabs.filter(t => t.id !== quickTabId);

      if (filteredTabs.length === containerData.tabs.length) {
        console.warn(
          `[SessionStorageAdapter] Quick Tab ${quickTabId} not found in container ${containerId}`
        );
        return;
      }

      // Save updated tabs
      // Note: We need to reconstruct QuickTab objects for save()
      const { QuickTab } = await Promise.resolve().then(function () { return QuickTab$1; });
      const quickTabs = filteredTabs.map(data => QuickTab.fromStorage(data));
      await this.save(containerId, quickTabs);

      console.log(
        `[SessionStorageAdapter] Deleted Quick Tab ${quickTabId} from container ${containerId}`
      );
    }

    /**
     * Delete all Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @returns {Promise<void>}
     */
    async deleteContainer(containerId) {
      const existingState = await this._loadRawState();

      if (!existingState.containers || !existingState.containers[containerId]) {
        console.warn(`[SessionStorageAdapter] Container ${containerId} not found for deletion`);
        return;
      }

      delete existingState.containers[containerId];
      existingState.timestamp = Date.now();
      existingState.saveId = this._generateSaveId();

      await browser$1.storage.session.set({
        [this.STORAGE_KEY]: existingState
      });

      console.log(`[SessionStorageAdapter] Deleted all Quick Tabs for container ${containerId}`);
    }

    /**
     * Clear all Quick Tabs across all containers
     *
     * @returns {Promise<void>}
     */
    async clear() {
      await browser$1.storage.session.remove(this.STORAGE_KEY);
      console.log('[SessionStorageAdapter] Cleared all Quick Tabs');
    }

    /**
     * Load raw state from storage
     *
     * @private
     * @returns {Promise<Object>} Raw state object
     */
    async _loadRawState() {
      try {
        const result = await browser$1.storage.session.get(this.STORAGE_KEY);

        if (result[this.STORAGE_KEY]) {
          return result[this.STORAGE_KEY];
        }

        // Return empty state
        return {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      } catch (error) {
        console.error('[SessionStorageAdapter] Load failed:', error);
        // Return empty state on error
        return {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      }
    }

    /**
     * Generate unique save ID for race condition tracking
     *
     * @private
     * @returns {string} Save ID in format 'timestamp-random'
     */
    _generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  /**
   * SyncStorageAdapter - Storage adapter for browser.storage.sync API
   *
   * Features:
   * - Container-aware storage format
   * - Quota management (100KB limit for sync storage)
   * - Automatic fallback to local storage on quota exceeded
   * - SaveId tracking to prevent race conditions
   * - Error handling with user feedback
   *
   * Storage Format (v1.5.8.15+):
   * {
   *   quick_tabs_state_v2: {
   *     containers: {
   *       'firefox-default': {
   *         tabs: [QuickTab, ...],
   *         lastUpdate: timestamp
   *       },
   *       'firefox-container-1': {
   *         tabs: [QuickTab, ...],
   *         lastUpdate: timestamp
   *       }
   *     },
   *     saveId: 'timestamp-random',
   *     timestamp: timestamp
   *   }
   * }
   */
  class SyncStorageAdapter extends StorageAdapter {
    constructor() {
      super();
      this.STORAGE_KEY = 'quick_tabs_state_v2';
      this.MAX_SYNC_SIZE = 100 * 1024; // 100KB limit for sync storage
    }

    /**
     * Save Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @param {QuickTab[]} tabs - Array of QuickTab domain entities
     * @returns {Promise<string>} Save ID for tracking race conditions
     */
    async save(containerId, tabs) {
      // Load existing state
      const existingState = await this._loadRawState();

      // Update container
      if (!existingState.containers) {
        existingState.containers = {};
      }

      existingState.containers[containerId] = {
        tabs: tabs.map(t => t.serialize()),
        lastUpdate: Date.now()
      };

      // Generate save ID for race condition tracking
      const saveId = this._generateSaveId();
      existingState.saveId = saveId;
      existingState.timestamp = Date.now();

      // Wrap in storage key
      const stateToSave = {
        [this.STORAGE_KEY]: existingState
      };

      // Check size
      const size = this._calculateSize(stateToSave);

      try {
        if (size > this.MAX_SYNC_SIZE) {
          console.warn(
            `[SyncStorageAdapter] State size ${size} bytes exceeds sync limit of ${this.MAX_SYNC_SIZE} bytes`
          );
          throw new Error(
            `QUOTA_BYTES: State too large (${size} bytes, max ${this.MAX_SYNC_SIZE} bytes)`
          );
        }

        await browser$1.storage.sync.set(stateToSave);
        console.log(
          `[SyncStorageAdapter] Saved ${tabs.length} tabs for container ${containerId} (saveId: ${saveId})`
        );
        return saveId;
      } catch (error) {
        return this._handleSaveError(error, stateToSave, saveId);
      }
    }

    /**
     * Handle save error with fallback to local storage
     * @private
     */
    async _handleSaveError(error, stateToSave, saveId) {
      // Handle quota exceeded - fallback to local storage
      if (!error.message || !error.message.includes('QUOTA_BYTES')) {
        console.error('[SyncStorageAdapter] Save failed:', error);
        throw error;
      }

      console.error(
        '[SyncStorageAdapter] Sync storage quota exceeded, falling back to local storage'
      );

      try {
        await browser$1.storage.local.set(stateToSave);
        console.log(`[SyncStorageAdapter] Fallback: Saved to local storage (saveId: ${saveId})`);
        return saveId;
      } catch (localError) {
        console.error('[SyncStorageAdapter] Local storage fallback failed:', localError);
        throw new Error(`Failed to save: ${localError.message}`);
      }
    }

    /**
     * Load Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @returns {Promise<{tabs: Array, lastUpdate: number}|null>} Container data or null if not found
     */
    async load(containerId) {
      const state = await this._loadRawState();

      if (!state.containers || !state.containers[containerId]) {
        return null;
      }

      return state.containers[containerId];
    }

    /**
     * Load all Quick Tabs across all containers
     *
     * @returns {Promise<Object.<string, {tabs: Array, lastUpdate: number}>>} Map of container ID to container data
     */
    async loadAll() {
      const state = await this._loadRawState();
      return state.containers || {};
    }

    /**
     * Delete a specific Quick Tab from a container
     *
     * @param {string} containerId - Firefox container ID
     * @param {string} quickTabId - Quick Tab ID to delete
     * @returns {Promise<void>}
     */
    async delete(containerId, quickTabId) {
      const containerData = await this.load(containerId);

      if (!containerData) {
        console.warn(`[SyncStorageAdapter] Container ${containerId} not found for deletion`);
        return;
      }

      // Filter out the tab
      const filteredTabs = containerData.tabs.filter(t => t.id !== quickTabId);

      if (filteredTabs.length === containerData.tabs.length) {
        console.warn(
          `[SyncStorageAdapter] Quick Tab ${quickTabId} not found in container ${containerId}`
        );
        return;
      }

      // Save updated tabs
      // Note: We need to reconstruct QuickTab objects for save()
      const { QuickTab } = await Promise.resolve().then(function () { return QuickTab$1; });
      const quickTabs = filteredTabs.map(data => QuickTab.fromStorage(data));
      await this.save(containerId, quickTabs);

      console.log(
        `[SyncStorageAdapter] Deleted Quick Tab ${quickTabId} from container ${containerId}`
      );
    }

    /**
     * Delete all Quick Tabs for a specific container
     *
     * @param {string} containerId - Firefox container ID
     * @returns {Promise<void>}
     */
    async deleteContainer(containerId) {
      const existingState = await this._loadRawState();

      if (!existingState.containers || !existingState.containers[containerId]) {
        console.warn(`[SyncStorageAdapter] Container ${containerId} not found for deletion`);
        return;
      }

      delete existingState.containers[containerId];
      existingState.timestamp = Date.now();
      existingState.saveId = this._generateSaveId();

      await browser$1.storage.sync.set({
        [this.STORAGE_KEY]: existingState
      });

      console.log(`[SyncStorageAdapter] Deleted all Quick Tabs for container ${containerId}`);
    }

    /**
     * Clear all Quick Tabs across all containers
     *
     * @returns {Promise<void>}
     */
    async clear() {
      await browser$1.storage.sync.remove(this.STORAGE_KEY);
      console.log('[SyncStorageAdapter] Cleared all Quick Tabs');
    }

    /**
     * Load raw state from storage (checks both sync and local for fallback)
     *
     * @private
     * @returns {Promise<Object>} Raw state object
     */
    async _loadRawState() {
      try {
        // Try sync first
        const result = await browser$1.storage.sync.get(this.STORAGE_KEY);

        if (result[this.STORAGE_KEY]) {
          return result[this.STORAGE_KEY];
        }

        // Fallback to local if sync is empty
        const localResult = await browser$1.storage.local.get(this.STORAGE_KEY);

        if (localResult[this.STORAGE_KEY]) {
          console.log('[SyncStorageAdapter] Loaded from local storage (fallback)');
          return localResult[this.STORAGE_KEY];
        }

        // Return empty state
        return {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      } catch (error) {
        console.error('[SyncStorageAdapter] Load failed:', error);
        // Return empty state on error
        return {
          containers: {},
          timestamp: Date.now(),
          saveId: this._generateSaveId()
        };
      }
    }

    /**
     * Generate unique save ID for race condition tracking
     *
     * @private
     * @returns {string} Save ID in format 'timestamp-random'
     */
    _generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Calculate size of data in bytes
     *
     * @private
     * @param {Object} data - Data to measure
     * @returns {number} Size in bytes
     */
    _calculateSize(data) {
      try {
        const jsonString = JSON.stringify(data);
        return new Blob([jsonString]).size;
      } catch (error) {
        console.error('[SyncStorageAdapter] Size calculation failed:', error);
        return 0;
      }
    }
  }

  /**
   * StorageManager - Handles persistent storage for Quick Tabs
   * Phase 2.1: Extracted from QuickTabsManager
   *
   * Responsibilities:
   * - Save Quick Tabs to browser.storage
   * - Load Quick Tabs from browser.storage
   * - Listen for storage changes
   * - Track pending saves to prevent race conditions
   * - Container-aware storage operations
   *
   * Uses:
   * - SyncStorageAdapter from @storage layer
   * - QuickTab from @domain layer
   */


  class StorageManager {
    constructor(eventBus, cookieStoreId = 'firefox-default') {
      this.eventBus = eventBus;
      this.cookieStoreId = cookieStoreId;

      // Storage adapters
      this.syncAdapter = new SyncStorageAdapter();
      this.sessionAdapter = new SessionStorageAdapter();

      // Transaction tracking to prevent race conditions
      this.pendingSaveIds = new Set();
      this.saveIdTimers = new Map();
      this.SAVE_ID_GRACE_MS = 1000;

      // Debounced sync
      this.latestStorageSnapshot = null;
      this.storageSyncTimer = null;
      this.STORAGE_SYNC_DELAY_MS = 100;
    }

    /**
     * Save Quick Tabs to persistent storage
     * @param {Array<QuickTab>} quickTabs - Array of QuickTab domain entities
     * @returns {Promise<string>} - Save ID for tracking
     */
    async save(quickTabs) {
      if (!quickTabs || quickTabs.length === 0) {
        console.log('[StorageManager] No Quick Tabs to save');
        return null;
      }

      try {
        // Serialize QuickTab domain entities to storage format
        const serializedTabs = quickTabs.map(qt => qt.serialize());

        // Save using SyncStorageAdapter (handles quota, fallback, etc.)
        const saveId = await this.syncAdapter.save(this.cookieStoreId, serializedTabs);

        // Track saveId to prevent race conditions
        this.trackPendingSave(saveId);

        // Emit event
        this.eventBus?.emit('storage:saved', { cookieStoreId: this.cookieStoreId, saveId });

        console.log(
          `[StorageManager] Saved ${quickTabs.length} Quick Tabs for container ${this.cookieStoreId}`
        );
        return saveId;
      } catch (error) {
        console.error('[StorageManager] Save error:', error);
        this.eventBus?.emit('storage:error', { operation: 'save', error });
        throw error;
      }
    }

    /**
     * Load all Quick Tabs for current container
     * @returns {Promise<Array<QuickTab>>} - Array of QuickTab domain entities
     */
    async loadAll() {
      try {
        // Try session storage first (faster, temporary)
        let containerData = await this.sessionAdapter.load(this.cookieStoreId);

        // Fall back to sync storage
        if (!containerData) {
          containerData = await this.syncAdapter.load(this.cookieStoreId);
        }

        if (!containerData || !containerData.tabs) {
          console.log(`[StorageManager] No data found for container ${this.cookieStoreId}`);
          return [];
        }

        // Deserialize to QuickTab domain entities
        const quickTabs = containerData.tabs.map(tabData => QuickTab.fromStorage(tabData));

        console.log(
          `[StorageManager] Loaded ${quickTabs.length} Quick Tabs for container ${this.cookieStoreId}`
        );
        return quickTabs;
      } catch (error) {
        console.error('[StorageManager] Load error:', error);
        this.eventBus?.emit('storage:error', { operation: 'load', error });
        return [];
      }
    }

    /**
     * Setup storage change listeners
     */
    setupStorageListeners() {
      if (typeof browser === 'undefined' || !browser.storage) {
        console.warn('[StorageManager] Storage API not available');
        return;
      }

      browser.storage.onChanged.addListener((changes, areaName) => {
        console.log('[StorageManager] Storage changed:', areaName, Object.keys(changes));

        // Handle sync storage changes
        if (areaName === 'sync' && changes.quick_tabs_state_v2) {
          this.handleStorageChange(changes.quick_tabs_state_v2.newValue);
        }

        // Handle session storage changes
        if (areaName === 'session' && changes.quick_tabs_session) {
          this.handleStorageChange(changes.quick_tabs_session.newValue);
        }
      });

      console.log('[StorageManager] Storage listeners attached');
    }

    /**
     * Handle storage change event
     * @param {Object} newValue - New storage value
     */
    handleStorageChange(newValue) {
      if (!newValue) {
        return;
      }

      // Ignore changes from our own saves (race condition prevention)
      if (this.shouldIgnoreStorageChange(newValue?.saveId)) {
        return;
      }

      // Ignore changes while saves are pending
      if (this.pendingSaveIds.size > 0 && !newValue?.saveId) {
        console.log(
          '[StorageManager] Ignoring change while pending saves in-flight:',
          Array.from(this.pendingSaveIds)
        );
        return;
      }

      // Extract container-specific state
      if (newValue.containers && this.cookieStoreId) {
        const containerState = newValue.containers[this.cookieStoreId];
        if (containerState) {
          console.log(`[StorageManager] Scheduling sync for container ${this.cookieStoreId}`);
          // Create container-filtered snapshot
          const filteredState = {
            containers: {
              [this.cookieStoreId]: containerState
            }
          };
          this.scheduleStorageSync(filteredState);
        }
      } else {
        // Legacy format - process as-is
        console.log('[StorageManager] Scheduling sync (legacy format)');
        this.scheduleStorageSync(newValue);
      }
    }

    /**
     * Check if storage change should be ignored
     * @param {string} saveId - Save ID from storage change
     * @returns {boolean} - True if should ignore
     */
    shouldIgnoreStorageChange(saveId) {
      if (saveId && this.pendingSaveIds.has(saveId)) {
        console.log('[StorageManager] Ignoring storage change for pending save:', saveId);
        return true;
      }
      return false;
    }

    /**
     * Schedule debounced storage sync
     * @param {Object} stateSnapshot - Storage state snapshot
     */
    scheduleStorageSync(stateSnapshot) {
      this.latestStorageSnapshot = stateSnapshot;

      if (this.storageSyncTimer) {
        clearTimeout(this.storageSyncTimer);
      }

      // eslint-disable-next-line require-await
      this.storageSyncTimer = setTimeout(async () => {
        const snapshot = this.latestStorageSnapshot;
        this.latestStorageSnapshot = null;
        this.storageSyncTimer = null;

        // Emit event for coordinator to handle sync
        this.eventBus?.emit('storage:changed', {
          containerFilter: this.cookieStoreId,
          state: snapshot
        });
      }, this.STORAGE_SYNC_DELAY_MS);
    }

    /**
     * Track pending save to prevent race conditions
     * @param {string} saveId - Unique save identifier
     */
    trackPendingSave(saveId) {
      if (!saveId) {
        return;
      }

      // Clear existing timer if present
      if (this.saveIdTimers.has(saveId)) {
        clearTimeout(this.saveIdTimers.get(saveId));
        this.saveIdTimers.delete(saveId);
      }

      this.pendingSaveIds.add(saveId);

      // Auto-release after grace period
      const timer = setTimeout(() => {
        this.releasePendingSave(saveId);
      }, this.SAVE_ID_GRACE_MS);

      this.saveIdTimers.set(saveId, timer);
    }

    /**
     * Release pending save ID
     * @param {string} saveId - Save identifier to release
     */
    releasePendingSave(saveId) {
      if (!saveId) {
        return;
      }

      if (this.saveIdTimers.has(saveId)) {
        clearTimeout(this.saveIdTimers.get(saveId));
        this.saveIdTimers.delete(saveId);
      }

      if (this.pendingSaveIds.delete(saveId)) {
        console.log('[StorageManager] Released saveId:', saveId);
      }
    }

    /**
     * Delete specific Quick Tab from storage
     * @param {string} quickTabId - Quick Tab ID to delete
     */
    async delete(quickTabId) {
      try {
        await this.syncAdapter.delete(this.cookieStoreId, quickTabId);
        this.eventBus?.emit('storage:deleted', { cookieStoreId: this.cookieStoreId, quickTabId });
      } catch (error) {
        console.error('[StorageManager] Delete error:', error);
        this.eventBus?.emit('storage:error', { operation: 'delete', error });
        throw error;
      }
    }

    /**
     * Clear all Quick Tabs for current container
     */
    async clear() {
      try {
        await this.syncAdapter.deleteContainer(this.cookieStoreId);
        this.eventBus?.emit('storage:cleared', { cookieStoreId: this.cookieStoreId });
      } catch (error) {
        console.error('[StorageManager] Clear error:', error);
        this.eventBus?.emit('storage:error', { operation: 'clear', error });
        throw error;
      }
    }
  }

  /**
   * Minimized Quick Tabs Manager
   * Manages the minimized state of Quick Tabs and provides restoration interface
   *
   * v1.5.9.0 - New module following modular-architecture-blueprint.md
   */

  /**
   * MinimizedManager class - Tracks and manages minimized Quick Tabs
   */
  class MinimizedManager {
    constructor() {
      this.minimizedTabs = new Map(); // id -> QuickTabWindow instance
    }

    /**
     * Add a minimized Quick Tab
     */
    add(id, tabWindow) {
      this.minimizedTabs.set(id, tabWindow);
      console.log('[MinimizedManager] Added minimized tab:', id);
    }

    /**
     * Remove a minimized Quick Tab
     */
    remove(id) {
      this.minimizedTabs.delete(id);
      console.log('[MinimizedManager] Removed minimized tab:', id);
    }

    /**
     * Restore a minimized Quick Tab
     * v1.5.9.8 - FIX: Ensure position state is preserved before calling restore
     */
    restore(id) {
      const tabWindow = this.minimizedTabs.get(id);
      if (tabWindow) {
        // v1.5.9.8 - FIX: Ensure position state is preserved before calling restore
        const savedLeft = tabWindow.left;
        const savedTop = tabWindow.top;
        const savedWidth = tabWindow.width;
        const savedHeight = tabWindow.height;

        tabWindow.restore();

        // Double-check position was applied (defensive)
        if (tabWindow.container) {
          tabWindow.container.style.left = `${savedLeft}px`;
          tabWindow.container.style.top = `${savedTop}px`;
          tabWindow.container.style.width = `${savedWidth}px`;
          tabWindow.container.style.height = `${savedHeight}px`;
        }

        this.minimizedTabs.delete(id);
        console.log('[MinimizedManager] Restored tab with position:', {
          id,
          left: savedLeft,
          top: savedTop
        });
        return true;
      }
      return false;
    }

    /**
     * Get all minimized tabs
     */
    getAll() {
      return Array.from(this.minimizedTabs.values());
    }

    /**
     * Get minimized tab count
     */
    getCount() {
      return this.minimizedTabs.size;
    }

    /**
     * Check if a tab is minimized
     */
    isMinimized(id) {
      return this.minimizedTabs.has(id);
    }

    /**
     * Clear all minimized tabs
     */
    clear() {
      this.minimizedTabs.clear();
      console.log('[MinimizedManager] Cleared all minimized tabs');
    }
  }

  /**
   * Debug Utilities with Log Export
   * Helper functions for debugging, logging, and exporting logs
   */

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
  function enableDebug() {
    DEBUG_MODE = true;
  }

  /**
   * Disable debug mode
   */
  function disableDebug() {
    DEBUG_MODE = false;
  }

  /**
   * Check if debug mode is enabled
   * @returns {boolean} True if debug mode is enabled
   */
  function isDebugEnabled() {
    return DEBUG_MODE;
  }

  /**
   * Debug logging function
   * @param {...any} args - Arguments to log
   */
  function debug(...args) {
    addToBuffer('DEBUG', ...args);
    if (DEBUG_MODE) {
      console.log('[DEBUG]', ...args);
    }
  }

  /**
   * Error logging function
   * @param {...any} args - Arguments to log
   */
  function debugError(...args) {
    addToBuffer('ERROR', ...args);
    console.error('[ERROR]', ...args);
  }

  /**
   * Warning logging function
   * @param {...any} args - Arguments to log
   */
  function debugWarn(...args) {
    addToBuffer('WARN', ...args);
    if (DEBUG_MODE) {
      console.warn('[WARN]', ...args);
    }
  }

  /**
   * Info logging function
   * @param {...any} args - Arguments to log
   */
  function debugInfo(...args) {
    addToBuffer('INFO', ...args);
    console.info('[INFO]', ...args);
  }

  /**
   * Get all buffered logs
   * @returns {Array<LogEntry>} Array of log entries
   */
  function getLogBuffer() {
    return [...LOG_BUFFER]; // Return copy to prevent mutation
  }

  /**
   * Clear log buffer
   */
  function clearLogBuffer() {
    LOG_BUFFER.length = 0;
    console.log('[DEBUG] Log buffer cleared');
  }

  /**
   * Format logs as plain text
   * @param {Array<LogEntry>} logs - Array of log entries
   * @param {string} version - Extension version
   * @returns {string} Formatted log text
   */
  function formatLogsAsText(logs, version = '1.5.9') {
    const now = new Date();
    const header = [
      '='.repeat(80),
      'Copy URL on Hover - Extension Console Logs',
      '='.repeat(80),
      '',
      `Version: ${version}`,
      `Export Date: ${now.toISOString()}`,
      `Export Date (Local): ${now.toLocaleString()}`,
      `Total Logs: ${logs.length}`,
      '',
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
  function generateLogFilename(version = '1.5.9') {
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

  async function exportLogs(version = '1.5.9') {
    try {
      // Get logs from current page
      const logs = getLogBuffer();

      // Try to get logs from background script
      await _fetchBackgroundLogs(logs);

      // Sort logs by timestamp
      logs.sort((a, b) => a.timestamp - b.timestamp);

      // Format logs
      const logText = formatLogsAsText(logs, version);

      // Generate filename
      const filename = generateLogFilename(version);

      // Try Method 1: browser.downloads.download() API (if permission granted)
      const browserApiSuccess = await _tryBrowserDownloadsAPI(logText, filename);
      if (browserApiSuccess) {
        return;
      }

      // Method 2: Blob URL + <a> download attribute (fallback)
      _downloadViaBlob(logText, filename);

      console.log('[INFO] Logs exported successfully via Blob URL');
    } catch (error) {
      console.error('[ERROR] Failed to export logs:', error);
      throw error;
    }
  }

  /**
   * Generate a unique ID
   * @returns {string} Unique ID
   */
  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Throttle function execution
   * @param {function} func - Function to throttle
   * @param {number} delay - Delay in milliseconds
   * @returns {function} Throttled function
   */
  function throttle(func, delay) {
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
  function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  /**
   * PanelContentManager Component
   * Handles content updates and Quick Tab operations for the Manager Panel
   *
   * Extracted from panel.js as part of Phase 2.10 refactoring
   * Responsibilities:
   * - Update panel content from storage
   * - Fetch and display Quick Tabs grouped by container
   * - Handle bulk operations (close minimized, close all)
   * - Handle individual Quick Tab actions (minimize, restore, close, go to tab)
   * - Setup event listeners with event delegation
   *
   * v1.6.0 - Phase 2.10: Extracted content management logic
   */


  /**
   * PanelContentManager
   * Manages panel content updates and user interactions
   */
  class PanelContentManager {
    /**
     * Create a new PanelContentManager
     * @param {HTMLElement} panelElement - The panel DOM element
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.uiBuilder - PanelUIBuilder instance
     * @param {Object} dependencies.stateManager - PanelStateManager instance
     * @param {Object} dependencies.quickTabsManager - QuickTabsManager instance
     * @param {string} dependencies.currentContainerId - Current container ID
     */
    constructor(panelElement, dependencies) {
      this.panel = panelElement;
      this.uiBuilder = dependencies.uiBuilder;
      this.stateManager = dependencies.stateManager;
      this.quickTabsManager = dependencies.quickTabsManager;
      this.currentContainerId = dependencies.currentContainerId;
      this.eventListeners = [];
      this.isOpen = false;
    }

    /**
     * Update panel open state
     * @param {boolean} isOpen - Whether panel is open
     */
    setIsOpen(isOpen) {
      this.isOpen = isOpen;
    }

    /**
     * Update panel content with current Quick Tabs state
     * v1.5.9.12 - Container integration: Filter by current container
     */
    async updateContent() {
      if (!this.panel || !this.isOpen) return;

      // Fetch Quick Tabs from storage
      const quickTabsState = await this._fetchQuickTabsFromStorage();
      if (!quickTabsState) return;

      // Get current container's tabs
      const currentContainerState = quickTabsState[this.currentContainerId];
      const currentContainerTabs = currentContainerState?.tabs || [];
      const latestTimestamp = currentContainerState?.lastUpdate || 0;

      // Update statistics
      this._updateStatistics(currentContainerTabs.length, latestTimestamp);

      // Show/hide empty state
      if (currentContainerTabs.length === 0) {
        this._renderEmptyState();
        return;
      }

      // Fetch container info
      const containerInfo = await this._fetchContainerInfo();

      // Render container section
      this._renderContainerSection(currentContainerState, containerInfo);
    }

    /**
     * Fetch Quick Tabs state from browser storage
     * @returns {Object|null} Quick Tabs state by container
     * @private
     */
    async _fetchQuickTabsFromStorage() {
      try {
        const result = await browser.storage.sync.get('quick_tabs_state_v2');
        if (!result || !result.quick_tabs_state_v2) return null;

        const state = result.quick_tabs_state_v2;
        // v1.5.8.15: Handle wrapped format
        return state.containers || state;
      } catch (err) {
        console.error('[PanelContentManager] Error loading Quick Tabs:', err);
        return null;
      }
    }

    /**
     * Fetch container info from browser API
     * @returns {Object} Container info (name, icon, color)
     * @private
     */
    async _fetchContainerInfo() {
      const defaultInfo = {
        name: 'Default',
        icon: '📁',
        color: 'grey'
      };

      try {
        if (
          this.currentContainerId === 'firefox-default' ||
          typeof browser.contextualIdentities === 'undefined'
        ) {
          return defaultInfo;
        }

        const containers = await browser.contextualIdentities.query({});
        const container = containers.find(c => c.cookieStoreId === this.currentContainerId);

        if (!container) return defaultInfo;

        return {
          name: container.name,
          icon: this.uiBuilder.getContainerIcon(container.icon),
          color: container.color
        };
      } catch (err) {
        console.error('[PanelContentManager] Error loading container:', err);
        return defaultInfo;
      }
    }

    /**
     * Update statistics display
     * @param {number} tabCount - Number of tabs
     * @param {number} timestamp - Last update timestamp
     * @private
     */
    _updateStatistics(tabCount, timestamp) {
      const totalTabsEl = this.panel.querySelector('#panel-totalTabs');
      const lastSyncEl = this.panel.querySelector('#panel-lastSync');

      if (totalTabsEl) {
        totalTabsEl.textContent = `${tabCount} Quick Tab${tabCount !== 1 ? 's' : ''}`;
      }

      if (lastSyncEl) {
        if (timestamp > 0) {
          const date = new Date(timestamp);
          lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
        } else {
          lastSyncEl.textContent = 'Last sync: Never';
        }
      }
    }

    /**
     * Render empty state when no Quick Tabs exist
     * @private
     */
    _renderEmptyState() {
      const containersList = this.panel.querySelector('#panel-containersList');
      const emptyState = this.panel.querySelector('#panel-emptyState');

      if (containersList) {
        containersList.style.display = 'none';
      }
      if (emptyState) {
        emptyState.style.display = 'flex';
      }
    }

    /**
     * Render container section with Quick Tabs
     * @param {Object} containerState - Container state with tabs
     * @param {Object} containerInfo - Container info (name, icon, color)
     * @private
     */
    _renderContainerSection(containerState, containerInfo) {
      const containersList = this.panel.querySelector('#panel-containersList');
      const emptyState = this.panel.querySelector('#panel-emptyState');

      if (emptyState) {
        emptyState.style.display = 'none';
      }
      if (containersList) {
        containersList.style.display = 'block';
        containersList.innerHTML = '';

        // Use UIBuilder to render the section
        this.uiBuilder.renderContainerSection(
          containersList,
          this.currentContainerId,
          containerInfo,
          containerState
        );
      }
    }

    /**
     * Setup event listeners for panel interactions
     */
    setupEventListeners() {
      // Close button
      const closeBtn = this.panel.querySelector('.panel-close');
      const closeBtnHandler = e => {
        e.stopPropagation();
        if (this.onClose) this.onClose();
      };
      closeBtn.addEventListener('click', closeBtnHandler);
      this.eventListeners.push({ element: closeBtn, type: 'click', handler: closeBtnHandler });

      // Minimize button (same as close)
      const minimizeBtn = this.panel.querySelector('.panel-minimize');
      const minimizeBtnHandler = e => {
        e.stopPropagation();
        if (this.onClose) this.onClose();
      };
      minimizeBtn.addEventListener('click', minimizeBtnHandler);
      this.eventListeners.push({
        element: minimizeBtn,
        type: 'click',
        handler: minimizeBtnHandler
      });

      // Close Minimized button
      const closeMinimizedBtn = this.panel.querySelector('#panel-closeMinimized');
      const closeMinimizedHandler = async e => {
        e.stopPropagation();
        await this.handleCloseMinimized();
      };
      closeMinimizedBtn.addEventListener('click', closeMinimizedHandler);
      this.eventListeners.push({
        element: closeMinimizedBtn,
        type: 'click',
        handler: closeMinimizedHandler
      });

      // Close All button
      const closeAllBtn = this.panel.querySelector('#panel-closeAll');
      const closeAllHandler = async e => {
        e.stopPropagation();
        await this.handleCloseAll();
      };
      closeAllBtn.addEventListener('click', closeAllHandler);
      this.eventListeners.push({
        element: closeAllBtn,
        type: 'click',
        handler: closeAllHandler
      });

      // Delegated listener for Quick Tab item actions
      const containersList = this.panel.querySelector('#panel-containersList');
      const actionHandler = async e => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        e.stopPropagation();

        const action = button.dataset.action;
        const quickTabId = button.dataset.quickTabId;
        const tabId = button.dataset.tabId;

        await this._handleQuickTabAction(action, quickTabId, tabId);
      };
      containersList.addEventListener('click', actionHandler);
      this.eventListeners.push({
        element: containersList,
        type: 'click',
        handler: actionHandler
      });

      debug('[PanelContentManager] Event listeners setup');
    }

    /**
     * Handle Quick Tab action button clicks
     * @param {string} action - Action type (goToTab, minimize, restore, close)
     * @param {string} quickTabId - Quick Tab ID
     * @param {string} tabId - Browser tab ID
     * @private
     */
    async _handleQuickTabAction(action, quickTabId, tabId) {
      switch (action) {
        case 'goToTab':
          await this.handleGoToTab(parseInt(tabId, 10));
          break;
        case 'minimize':
          await this.handleMinimizeTab(quickTabId);
          break;
        case 'restore':
          await this.handleRestoreTab(quickTabId);
          break;
        case 'close':
          await this.handleCloseTab(quickTabId);
          break;
        default:
          console.warn(`[PanelContentManager] Unknown action: ${action}`);
      }

      // Update panel after action
      setTimeout(() => this.updateContent(), 100);
    }

    /**
     * Close all minimized Quick Tabs
     * v1.5.8.15 - Fixed to handle wrapped container format
     */
    async handleCloseMinimized() {
      try {
        const result = await browser.storage.sync.get('quick_tabs_state_v2');
        if (!result || !result.quick_tabs_state_v2) return;

        const state = result.quick_tabs_state_v2;
        let hasChanges = false;

        // v1.5.8.15: Handle wrapped format
        const containers = state.containers || state;

        // Iterate through containers
        Object.keys(containers).forEach(key => {
          // Skip metadata keys
          if (key === 'saveId' || key === 'timestamp') return;

          const containerState = containers[key];
          if (!containerState?.tabs || !Array.isArray(containerState.tabs)) {
            return;
          }

          const originalLength = containerState.tabs.length;

          // Filter out minimized tabs
          containerState.tabs = containerState.tabs.filter(t => !t.minimized);

          if (containerState.tabs.length !== originalLength) {
            hasChanges = true;
            containerState.lastUpdate = Date.now();
          }
        });

        if (hasChanges) {
          // Save with proper wrapper format
          const stateToSave = {
            containers,
            saveId: this._generateSaveId(),
            timestamp: Date.now()
          };

          await browser.storage.sync.set({ quick_tabs_state_v2: stateToSave });

          // Update session storage
          await this._updateSessionStorage(stateToSave);

          debug('[PanelContentManager] Closed minimized Quick Tabs');
          await this.updateContent();
        }
      } catch (err) {
        console.error('[PanelContentManager] Error closing minimized:', err);
      }
    }

    /**
     * Update session storage helper
     * @param {Object} state - State to save
     * @private
     */
    async _updateSessionStorage(state) {
      if (typeof browser.storage.session !== 'undefined') {
        await browser.storage.session.set({ quick_tabs_session: state });
      }
    }

    /**
     * Close all Quick Tabs
     * v1.5.8.15 - Fixed to use proper wrapped format
     */
    async handleCloseAll() {
      try {
        // Use wrapped container format
        const emptyState = {
          containers: {
            'firefox-default': { tabs: [], lastUpdate: Date.now() }
          },
          saveId: this._generateSaveId(),
          timestamp: Date.now()
        };

        await browser.storage.sync.set({ quick_tabs_state_v2: emptyState });

        // Clear session storage
        await this._updateSessionStorage(emptyState);

        // Notify all tabs via background
        browser.runtime
          .sendMessage({
            action: 'CLEAR_ALL_QUICK_TABS'
          })
          .catch(() => {
            // Ignore errors when background script is not available
          });

        debug('[PanelContentManager] Closed all Quick Tabs');
        await this.updateContent();
      } catch (err) {
        console.error('[PanelContentManager] Error closing all:', err);
      }
    }

    /**
     * Go to browser tab
     * @param {number} tabId - Browser tab ID
     */
    async handleGoToTab(tabId) {
      try {
        await browser.tabs.update(tabId, { active: true });
        debug(`[PanelContentManager] Switched to tab ${tabId}`);
      } catch (err) {
        console.error('[PanelContentManager] Error switching to tab:', err);
      }
    }

    /**
     * Minimize Quick Tab
     * @param {string} quickTabId - Quick Tab ID
     */
    handleMinimizeTab(quickTabId) {
      if (this.quickTabsManager?.minimizeById) {
        this.quickTabsManager.minimizeById(quickTabId);
      }
    }

    /**
     * Restore Quick Tab
     * @param {string} quickTabId - Quick Tab ID
     */
    handleRestoreTab(quickTabId) {
      if (this.quickTabsManager?.restoreById) {
        this.quickTabsManager.restoreById(quickTabId);
      }
    }

    /**
     * Close Quick Tab
     * @param {string} quickTabId - Quick Tab ID
     */
    handleCloseTab(quickTabId) {
      if (this.quickTabsManager?.closeById) {
        this.quickTabsManager.closeById(quickTabId);
      }
    }

    /**
     * Generate unique save ID for transaction tracking
     * @returns {string} Unique save ID
     * @private
     */
    _generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Set callback for panel close
     * @param {Function} callback - Close callback
     */
    setOnClose(callback) {
      this.onClose = callback;
    }

    /**
     * Cleanup event listeners and references
     */
    destroy() {
      // Remove all event listeners
      this.eventListeners.forEach(({ element, type, handler }) => {
        if (element) {
          element.removeEventListener(type, handler);
        }
      });
      this.eventListeners = [];

      // Clear references
      this.panel = null;
      this.uiBuilder = null;
      this.stateManager = null;
      this.quickTabsManager = null;
      this.onClose = null;

      debug('[PanelContentManager] Destroyed');
    }
  }

  /**
   * PanelDragController Component
   * Handles drag operations for the Quick Tabs Manager Panel using Pointer Events API
   *
   * Extracted from panel.js as part of Phase 2.10 refactoring
   * Based on window/DragController.js pattern from Phase 2.9
   *
   * Responsibilities:
   * - Handle panel dragging via header/drag handle
   * - Use Pointer Events API (pointerdown/move/up/cancel)
   * - Update panel position during drag
   * - Save state and broadcast position on drag end
   * - Handle drag cancellation gracefully
   *
   * v1.6.0 - Phase 2.10: Extracted drag logic from PanelManager
   */

  class PanelDragController {
    /**
     * Create a drag controller for the panel
     * @param {HTMLElement} panel - Panel element
     * @param {HTMLElement} handle - Drag handle element (usually panel header)
     * @param {Object} callbacks - Event callbacks
     * @param {Function} callbacks.onDragEnd - Called when drag ends (left, top)
     * @param {Function} callbacks.onBroadcast - Called to broadcast position updates
     */
    constructor(panel, handle, callbacks = {}) {
      this.panel = panel;
      this.handle = handle;
      this.onDragEnd = callbacks.onDragEnd || null;
      this.onBroadcast = callbacks.onBroadcast || null;

      this.isDragging = false;
      this.currentPointerId = null;
      this.offsetX = 0;
      this.offsetY = 0;

      this._setupEventListeners();
    }

    /**
     * Setup drag event listeners on handle
     * @private
     */
    _setupEventListeners() {
      this.handle.addEventListener('pointerdown', this._handlePointerDown.bind(this));
      this.handle.addEventListener('pointermove', this._handlePointerMove.bind(this));
      this.handle.addEventListener('pointerup', this._handlePointerUp.bind(this));
      this.handle.addEventListener('pointercancel', this._handlePointerCancel.bind(this));
    }

    /**
     * Handle pointer down - start drag
     * @param {PointerEvent} e - Pointer event
     * @private
     */
    _handlePointerDown(e) {
      // Only left click
      if (e.button !== 0) return;

      // Ignore clicks on buttons
      if (e.target.classList.contains('panel-btn')) return;

      this.isDragging = true;
      this.currentPointerId = e.pointerId;

      // Capture pointer
      this.handle.setPointerCapture(e.pointerId);

      // Calculate offset from panel position
      const rect = this.panel.getBoundingClientRect();
      this.offsetX = e.clientX - rect.left;
      this.offsetY = e.clientY - rect.top;

      // Visual feedback
      this.handle.style.cursor = 'grabbing';

      e.preventDefault();
    }

    /**
     * Handle pointer move - update position
     * @param {PointerEvent} e - Pointer event
     * @private
     */
    _handlePointerMove(e) {
      if (!this.isDragging || e.pointerId !== this.currentPointerId) return;

      // Calculate new position
      const newLeft = e.clientX - this.offsetX;
      const newTop = e.clientY - this.offsetY;

      // Apply position
      this.panel.style.left = `${newLeft}px`;
      this.panel.style.top = `${newTop}px`;

      e.preventDefault();
    }

    /**
     * Handle pointer up - end drag
     * @param {PointerEvent} e - Pointer event
     * @private
     */
    _handlePointerUp(e) {
      if (!this.isDragging || e.pointerId !== this.currentPointerId) return;

      this.isDragging = false;
      this.handle.releasePointerCapture(e.pointerId);
      this.handle.style.cursor = 'grab';

      // Get final position
      const rect = this.panel.getBoundingClientRect();
      const finalLeft = rect.left;
      const finalTop = rect.top;

      // Save final position
      if (this.onDragEnd) {
        this.onDragEnd(finalLeft, finalTop);
      }

      // Broadcast position to other tabs
      if (this.onBroadcast) {
        this.onBroadcast({ left: finalLeft, top: finalTop });
      }
    }

    /**
     * Handle pointer cancel - drag interrupted
     * @param {PointerEvent} _e - Pointer event
     * @private
     */
    _handlePointerCancel(_e) {
      if (!this.isDragging) return;

      this.isDragging = false;
      this.handle.style.cursor = 'grab';

      // Save position even though drag was cancelled
      const rect = this.panel.getBoundingClientRect();
      if (this.onDragEnd) {
        this.onDragEnd(rect.left, rect.top);
      }
    }

    /**
     * Destroy controller and clean up
     */
    destroy() {
      // Remove event listeners
      this.handle.removeEventListener('pointerdown', this._handlePointerDown);
      this.handle.removeEventListener('pointermove', this._handlePointerMove);
      this.handle.removeEventListener('pointerup', this._handlePointerUp);
      this.handle.removeEventListener('pointercancel', this._handlePointerCancel);

      // Clear references
      this.panel = null;
      this.handle = null;
      this.onDragEnd = null;
      this.onBroadcast = null;
    }
  }

  /**
   * PanelResizeController - Manages 8-direction resize handles for Quick Tabs Manager Panel
   * Part of Phase 2.10 refactoring - Panel component extraction
   *
   * Follows the table-driven configuration pattern established in Phase 2.3
   * (window/ResizeHandle.js and window/ResizeController.js)
   *
   * Features:
   * - 8-direction resize (n, s, e, w, ne, nw, se, sw)
   * - Pointer Events API (pointerdown/move/up/cancel)
   * - Min constraints: 250px width, 300px height
   * - Position updates for nw/ne/sw directions
   * - Broadcasts size/position on resize end
   *
   * Extracted from panel.js (lines 957-1096, cc=high) → (cc=3 target)
   */


  /**
   * Configuration for each resize direction
   * Table-driven approach eliminates conditional complexity
   */
  const RESIZE_CONFIGS = {
    // Corner handles
    nw: {
      cursor: 'nw-resize',
      position: { top: 0, left: 0 },
      size: { width: 10, height: 10 },
      directions: ['w', 'n']
    },
    ne: {
      cursor: 'ne-resize',
      position: { top: 0, right: 0 },
      size: { width: 10, height: 10 },
      directions: ['e', 'n']
    },
    sw: {
      cursor: 'sw-resize',
      position: { bottom: 0, left: 0 },
      size: { width: 10, height: 10 },
      directions: ['w', 's']
    },
    se: {
      cursor: 'se-resize',
      position: { bottom: 0, right: 0 },
      size: { width: 10, height: 10 },
      directions: ['e', 's']
    },
    // Edge handles
    n: {
      cursor: 'n-resize',
      position: { top: 0, left: 10, right: 10 },
      size: { height: 10 },
      directions: ['n']
    },
    s: {
      cursor: 's-resize',
      position: { bottom: 0, left: 10, right: 10 },
      size: { height: 10 },
      directions: ['s']
    },
    e: {
      cursor: 'e-resize',
      position: { top: 10, right: 0, bottom: 10 },
      size: { width: 10 },
      directions: ['e']
    },
    w: {
      cursor: 'w-resize',
      position: { top: 10, left: 0, bottom: 10 },
      size: { width: 10 },
      directions: ['w']
    }
  };

  /**
   * PanelResizeController class
   *
   * Public API:
   * - constructor(panel, callbacks) - Initialize with panel element and callbacks
   * - destroy() - Clean up handles and listeners
   *
   * Callbacks:
   * - onSizeChange(width, height) - Called during resize
   * - onPositionChange(left, top) - Called when position changes (nw/ne/sw)
   * - onResizeEnd(width, height, left, top) - Called when resize completes
   * - onBroadcast({width, height, left, top}) - Called to broadcast to other tabs
   */
  class PanelResizeController {
    constructor(panel, callbacks = {}) {
      this.panel = panel;
      this.callbacks = callbacks;
      this.handles = [];
      this.minWidth = 250;
      this.minHeight = 300;

      this._attachHandles();
    }

    /**
     * Create and attach all resize handles
     * Private method - called in constructor
     */
    _attachHandles() {
      Object.entries(RESIZE_CONFIGS).forEach(([direction, config]) => {
        const handle = this._createHandle(direction, config);
        this.panel.appendChild(handle);
        this.handles.push({ direction, element: handle });
      });

      debug('[PanelResizeController] Attached 8 resize handles');
    }

    /**
     * Create a single resize handle element
     * Returns DOM element with event listeners attached
     */
    _createHandle(direction, config) {
      const handle = document.createElement('div');
      handle.className = `panel-resize-handle ${direction}`;

      // Apply positioning and sizing from config
      const styleProps = {
        position: 'absolute',
        cursor: config.cursor,
        zIndex: '10',
        ...this._buildPositionStyles(config.position),
        ...this._buildSizeStyles(config.size)
      };

      handle.style.cssText = Object.entries(styleProps)
        .map(([key, value]) => `${this._camelToKebab(key)}: ${value};`)
        .join(' ');

      // Attach pointer event handlers
      this._attachHandleListeners(handle, direction, config);

      return handle;
    }

    /**
     * Build CSS position styles from config
     */
    _buildPositionStyles(position) {
      const styles = {};
      if (position.top !== undefined) styles.top = `${position.top}px`;
      if (position.bottom !== undefined) styles.bottom = `${position.bottom}px`;
      if (position.left !== undefined) styles.left = `${position.left}px`;
      if (position.right !== undefined) styles.right = `${position.right}px`;
      return styles;
    }

    /**
     * Build CSS size styles from config
     */
    _buildSizeStyles(size) {
      const styles = {};
      if (size.width) styles.width = `${size.width}px`;
      if (size.height) styles.height = `${size.height}px`;
      return styles;
    }

    /**
     * Convert camelCase to kebab-case for CSS properties
     */
    _camelToKebab(str) {
      return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    }

    /**
     * Attach pointer event listeners to a handle
     */
    _attachHandleListeners(handle, direction, config) {
      let isResizing = false;
      let currentPointerId = null;
      let startState = null;

      const handlePointerDown = e => {
        startState = this._initResize(e, handle);
        if (!startState) return;

        isResizing = true;
        currentPointerId = e.pointerId;
      };

      const handlePointerMove = e => {
        if (!isResizing || e.pointerId !== currentPointerId) return;

        this._performResize(e, startState, config, direction);
        e.preventDefault();
      };

      const handlePointerUp = e => {
        if (!isResizing || e.pointerId !== currentPointerId) return;

        this._finishResize(handle, e.pointerId);
        isResizing = false;
      };

      const handlePointerCancel = _e => {
        if (!isResizing) return;
        this._finishResize(handle, null);
        isResizing = false;
      };

      // Attach listeners
      handle.addEventListener('pointerdown', handlePointerDown);
      handle.addEventListener('pointermove', handlePointerMove);
      handle.addEventListener('pointerup', handlePointerUp);
      handle.addEventListener('pointercancel', handlePointerCancel);
    }

    /**
     * Initialize resize operation on pointerdown
     */
    _initResize(e, handle) {
      if (e.button !== 0) return null; // Left button only

      if (handle.setPointerCapture) {
        handle.setPointerCapture(e.pointerId);
      }

      const rect = this.panel.getBoundingClientRect();
      const startState = {
        x: e.clientX,
        y: e.clientY,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top
      };

      e.preventDefault();
      e.stopPropagation();

      return startState;
    }

    /**
     * Perform resize on pointermove
     */
    _performResize(e, startState, config, direction) {
      const dx = e.clientX - startState.x;
      const dy = e.clientY - startState.y;

      const { newWidth, newHeight, newLeft, newTop } = this._calculateNewDimensions(
        direction,
        config.directions,
        startState,
        dx,
        dy
      );

      // Apply new dimensions
      this.panel.style.width = `${newWidth}px`;
      this.panel.style.height = `${newHeight}px`;
      this.panel.style.left = `${newLeft}px`;
      this.panel.style.top = `${newTop}px`;

      // Notify via callbacks
      if (this.callbacks.onSizeChange) {
        this.callbacks.onSizeChange(newWidth, newHeight);
      }
      if (
        this.callbacks.onPositionChange &&
        (newLeft !== startState.left || newTop !== startState.top)
      ) {
        this.callbacks.onPositionChange(newLeft, newTop);
      }
    }

    /**
     * Finish resize on pointerup/pointercancel
     */
    _finishResize(handle, pointerId) {
      if (pointerId && handle.releasePointerCapture) {
        handle.releasePointerCapture(pointerId);
      }

      const rect = this.panel.getBoundingClientRect();

      // Notify resize end
      if (this.callbacks.onResizeEnd) {
        this.callbacks.onResizeEnd(rect.width, rect.height, rect.left, rect.top);
      }

      // Broadcast to other tabs (v1.5.9.8 fix)
      if (this.callbacks.onBroadcast) {
        this.callbacks.onBroadcast({
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top
        });
      }

      debug(
        `[PanelResizeController] Resize end: ${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`
      );
    }

    /**
     * Calculate new dimensions based on resize direction
     * Handles min constraints and position updates for nw/ne/sw directions
     */
    _calculateNewDimensions(direction, directions, startState, dx, dy) {
      let newWidth = startState.width;
      let newHeight = startState.height;
      let newLeft = startState.left;
      let newTop = startState.top;

      // East (right edge)
      if (directions.includes('e')) {
        newWidth = Math.max(this.minWidth, startState.width + dx);
      }

      // West (left edge) - also moves position
      if (directions.includes('w')) {
        const maxDx = startState.width - this.minWidth;
        const constrainedDx = Math.min(dx, maxDx);
        newWidth = startState.width - constrainedDx;
        newLeft = startState.left + constrainedDx;
      }

      // South (bottom edge)
      if (directions.includes('s')) {
        newHeight = Math.max(this.minHeight, startState.height + dy);
      }

      // North (top edge) - also moves position
      if (directions.includes('n')) {
        const maxDy = startState.height - this.minHeight;
        const constrainedDy = Math.min(dy, maxDy);
        newHeight = startState.height - constrainedDy;
        newTop = startState.top + constrainedDy;
      }

      return { newWidth, newHeight, newLeft, newTop };
    }

    /**
     * Clean up all handles and listeners
     */
    destroy() {
      this.handles.forEach(({ element }) => {
        element.remove();
      });
      this.handles = [];

      debug('[PanelResizeController] Destroyed all handles');
    }
  }

  /**
   * PanelStateManager - Manages state persistence and cross-tab synchronization
   * Part of Phase 2.10 refactoring - Panel component extraction
   *
   * Features:
   * - Container context detection (Firefox Multi-Account Containers)
   * - BroadcastChannel setup for cross-tab sync
   * - State persistence to browser.storage.local
   * - Debounced broadcast message handling (50ms, v1.5.9.8 fix)
   * - Local-only state updates (prevents infinite broadcast loops)
   *
   * Extracted from panel.js (lines 430-451, 457-528, 596-650, cc=high) → (cc=3 target)
   */


  /**
   * PanelStateManager class
   *
   * Public API:
   * - constructor(callbacks) - Initialize with callbacks
   * - async init() - Initialize (detect container, setup broadcast, load state)
   * - async detectContainerContext() - Detect and return current container ID
   * - setupBroadcastChannel() - Setup BroadcastChannel for cross-tab sync
   * - async loadPanelState() - Load panel state from browser.storage.local
   * - async savePanelState(panel) - Save panel state to storage + broadcast
   * - savePanelStateLocal(panel) - Save state locally without storage write (v1.5.9.8)
   * - broadcast(type, data) - Broadcast message to other tabs
   * - destroy() - Clean up broadcast channel
   *
   * Callbacks:
   * - onStateLoaded(state) - Called when state is loaded from storage
   * - onBroadcastReceived(type, data) - Called when broadcast message received
   */
  class PanelStateManager {
    constructor(callbacks = {}) {
      this.callbacks = callbacks;
      this.currentContainerId = 'firefox-default';
      this.broadcastChannel = null;
      this.broadcastDebounce = new Map();
      this.BROADCAST_DEBOUNCE_MS = 50;
      this.panelState = {
        left: 100,
        top: 100,
        width: 350,
        height: 500,
        isOpen: false
      };
    }

    /**
     * Initialize all components
     */
    async init() {
      await this.detectContainerContext();
      this.setupBroadcastChannel();
      await this.loadPanelState();
      debug('[PanelStateManager] Initialized');
    }

    /**
     * Detect container context (Firefox Multi-Account Containers)
     * Returns the current tab's cookieStoreId
     */
    async detectContainerContext() {
      this.currentContainerId = 'firefox-default';

      if (typeof browser === 'undefined' || !browser.tabs) {
        debug('[PanelStateManager] Browser tabs API not available, using default container');
        return this.currentContainerId;
      }

      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs.length > 0 && tabs[0].cookieStoreId) {
          this.currentContainerId = tabs[0].cookieStoreId;
          debug(`[PanelStateManager] Container detected: ${this.currentContainerId}`);
        } else {
          debug('[PanelStateManager] No cookieStoreId, using default container');
        }
      } catch (err) {
        debug('[PanelStateManager] Failed to detect container:', err);
      }

      return this.currentContainerId;
    }

    /**
     * Setup BroadcastChannel for cross-tab panel sync
     * v1.5.9.8 - Added position/size sync and debouncing
     */
    setupBroadcastChannel() {
      if (typeof BroadcastChannel === 'undefined') {
        debug('[PanelStateManager] BroadcastChannel not available');
        return;
      }

      try {
        this.broadcastChannel = new BroadcastChannel('quick-tabs-panel-sync');

        this.broadcastChannel.onmessage = event => {
          this._handleBroadcast(event.data);
        };

        debug('[PanelStateManager] BroadcastChannel initialized');
      } catch (err) {
        console.error('[PanelStateManager] Failed to setup BroadcastChannel:', err);
      }
    }

    /**
     * Handle incoming broadcast messages
     * v1.5.9.8 - Debounce rapid messages (50ms)
     */
    _handleBroadcast(eventData) {
      const { type, data } = eventData;

      // Debounce rapid messages
      const now = Date.now();
      const lastProcessed = this.broadcastDebounce.get(type);

      if (lastProcessed && now - lastProcessed < this.BROADCAST_DEBOUNCE_MS) {
        debug(`[PanelStateManager] Ignoring duplicate broadcast: ${type}`);
        return;
      }

      this.broadcastDebounce.set(type, now);

      // Notify via callback
      if (this.callbacks.onBroadcastReceived) {
        this.callbacks.onBroadcastReceived(type, data);
      }
    }

    /**
     * Load panel state from browser.storage.local
     */
    async loadPanelState() {
      try {
        const result = await browser.storage.local.get('quick_tabs_panel_state');
        if (!result || !result.quick_tabs_panel_state) {
          return this.panelState;
        }

        this.panelState = { ...this.panelState, ...result.quick_tabs_panel_state };
        debug('[PanelStateManager] Loaded panel state:', this.panelState);

        // Notify via callback
        if (this.callbacks.onStateLoaded) {
          this.callbacks.onStateLoaded(this.panelState);
        }
      } catch (err) {
        console.error('[PanelStateManager] Error loading panel state:', err);
      }

      return this.panelState;
    }

    /**
     * Save panel state to browser.storage.local
     * Also broadcasts to other tabs
     */
    async savePanelState(panel) {
      if (!panel) return;

      const rect = panel.getBoundingClientRect();

      this.panelState = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        isOpen: this.panelState.isOpen
      };

      try {
        await browser.storage.local.set({ quick_tabs_panel_state: this.panelState });
        debug('[PanelStateManager] Saved panel state');
      } catch (err) {
        console.error('[PanelStateManager] Error saving panel state:', err);
      }
    }

    /**
     * v1.5.9.8 - Save panel state locally without storage write
     * Prevents infinite loops when receiving broadcast messages
     */
    savePanelStateLocal(panel) {
      if (!panel) return;

      const rect = panel.getBoundingClientRect();

      this.panelState = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        isOpen: this.panelState.isOpen
      };

      debug('[PanelStateManager] Updated local state (no storage write)');
    }

    /**
     * Broadcast message to other tabs
     */
    broadcast(type, data) {
      if (!this.broadcastChannel) return;

      try {
        this.broadcastChannel.postMessage({ type, data, timestamp: Date.now() });
        debug(`[PanelStateManager] Broadcast sent: ${type}`);
      } catch (err) {
        console.error('[PanelStateManager] Error broadcasting:', err);
      }
    }

    /**
     * Update isOpen state
     */
    setIsOpen(isOpen) {
      this.panelState.isOpen = isOpen;
    }

    /**
     * Get current state
     */
    getState() {
      return { ...this.panelState };
    }

    /**
     * Clean up broadcast channel
     */
    destroy() {
      if (this.broadcastChannel) {
        this.broadcastChannel.close();
        this.broadcastChannel = null;
      }

      this.broadcastDebounce.clear();
      debug('[PanelStateManager] Destroyed');
    }
  }

  /**
   * PanelUIBuilder Component
   * Handles DOM creation and rendering for the Quick Tabs Manager Panel
   *
   * Extracted from panel.js as part of Phase 2.10 refactoring
   * Responsibilities:
   * - Inject CSS styles into document
   * - Create panel DOM structure from HTML template
   * - Render container sections with Quick Tabs
   * - Render individual Quick Tab items
   * - Get container icon emojis
   *
   * v1.6.0 - Phase 2.10: Extracted UI building logic
   */

  // Panel HTML template
  const PANEL_HTML = `
<div id="quick-tabs-manager-panel" class="quick-tabs-manager-panel" style="display: none;">
  <div class="panel-header">
    <span class="panel-drag-handle">≡</span>
    <h2 class="panel-title">Quick Tabs Manager</h2>
    <div class="panel-controls">
      <button class="panel-btn panel-minimize" title="Minimize Panel">−</button>
      <button class="panel-btn panel-close" title="Close Panel (Ctrl+Alt+Z)">✕</button>
    </div>
  </div>
  
  <div class="panel-actions">
    <button id="panel-closeMinimized" class="panel-btn-secondary" title="Close all minimized Quick Tabs">
      Close Minimized
    </button>
    <button id="panel-closeAll" class="panel-btn-danger" title="Close all Quick Tabs">
      Close All
    </button>
  </div>
  
  <div class="panel-stats">
    <span id="panel-totalTabs">0 Quick Tabs</span>
    <span id="panel-lastSync">Last sync: Never</span>
  </div>
  
  <div id="panel-containersList" class="panel-containers-list">
    <!-- Dynamically populated -->
  </div>
  
  <div id="panel-emptyState" class="panel-empty-state" style="display: none;">
    <div class="empty-icon">📭</div>
    <div class="empty-text">No Quick Tabs</div>
    <div class="empty-hint">Press Q while hovering over a link</div>
  </div>
</div>
`;

  // Panel CSS styles
  const PANEL_CSS = `
/* Quick Tabs Manager Floating Panel Styles */

.quick-tabs-manager-panel {
  position: fixed;
  top: 100px;
  right: 20px;
  width: 350px;
  height: 500px;
  background: #2d2d2d;
  border: 2px solid #555;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 999999999; /* Above all Quick Tabs */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 250px;
  min-height: 300px;
}

/* Panel Header (draggable) */
.panel-header {
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
}

.panel-header:active {
  cursor: grabbing;
}

.panel-drag-handle {
  font-size: 18px;
  color: #888;
  cursor: grab;
}

.panel-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel-controls {
  display: flex;
  gap: 4px;
}

.panel-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  color: #e0e0e0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.panel-btn:hover {
  background: #444;
}

.panel-close:hover {
  background: #ff5555;
}

/* Panel Actions */
.panel-actions {
  padding: 10px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #555;
  display: flex;
  gap: 8px;
}

.panel-btn-secondary,
.panel-btn-danger {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.panel-btn-secondary {
  background: #4a90e2;
  color: white;
}

.panel-btn-secondary:hover {
  opacity: 0.8;
}

.panel-btn-danger {
  background: #f44336;
  color: white;
}

.panel-btn-danger:hover {
  opacity: 0.8;
}

/* Panel Stats */
.panel-stats {
  padding: 8px 12px;
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #999;
}

/* Containers List */
.panel-containers-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

/* Container Section */
.panel-container-section {
  margin-bottom: 16px;
}

.panel-container-header {
  padding: 8px 12px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  background: #1e1e1e;
  border-top: 1px solid #555;
  border-bottom: 1px solid #555;
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-container-icon {
  font-size: 14px;
}

.panel-container-count {
  margin-left: auto;
  font-weight: normal;
  color: #999;
  font-size: 11px;
}

/* Quick Tab Items */
.panel-quick-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #555;
  transition: background 0.2s;
  cursor: pointer;
}

.panel-quick-tab-item:hover {
  background: #3a3a3a;
}

.panel-quick-tab-item.active {
  border-left: 3px solid #4CAF50;
  padding-left: 9px;
}

.panel-quick-tab-item.minimized {
  border-left: 3px solid #FFC107;
  padding-left: 9px;
}

.panel-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.panel-status-indicator.green {
  background: #4CAF50;
}

.panel-status-indicator.yellow {
  background: #FFC107;
}

.panel-favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.panel-tab-info {
  flex: 1;
  min-width: 0;
}

.panel-tab-title {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-tab-meta {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
}

.panel-tab-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.panel-btn-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e0e0e0;
}

.panel-btn-icon:hover {
  background: #555;
}

/* Empty State */
.panel-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #999;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 12px;
}

/* Resize Handles */
.panel-resize-handle {
  position: absolute;
  z-index: 10;
}

.panel-resize-handle.n { top: 0; left: 10px; right: 10px; height: 10px; cursor: n-resize; }
.panel-resize-handle.s { bottom: 0; left: 10px; right: 10px; height: 10px; cursor: s-resize; }
.panel-resize-handle.e { right: 0; top: 10px; bottom: 10px; width: 10px; cursor: e-resize; }
.panel-resize-handle.w { left: 0; top: 10px; bottom: 10px; width: 10px; cursor: w-resize; }
.panel-resize-handle.ne { top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; }
.panel-resize-handle.nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; }
.panel-resize-handle.se { bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; }
.panel-resize-handle.sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; }

/* Scrollbar Styling */
.panel-containers-list::-webkit-scrollbar {
  width: 8px;
}

.panel-containers-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.panel-containers-list::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 4px;
}

.panel-containers-list::-webkit-scrollbar-thumb:hover {
  background: #666;
}
`;

  /**
   * PanelUIBuilder - Handles DOM creation and rendering for panel UI
   */
  class PanelUIBuilder {
    /**
     * Inject panel styles into the document
     * @returns {boolean} - True if styles were injected, false if already present
     */
    static injectStyles() {
      // Check if already injected
      if (document.getElementById('quick-tabs-manager-panel-styles')) {
        return false;
      }

      const style = document.createElement('style');
      style.id = 'quick-tabs-manager-panel-styles';
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);

      return true;
    }

    /**
     * Create panel DOM structure
     * @param {Object} state - Panel state with position and size
     * @returns {HTMLElement} - Panel element
     */
    static createPanel(state) {
      const container = document.createElement('div');
      container.innerHTML = PANEL_HTML;
      const panel = container.firstElementChild;

      // Apply saved position and size
      panel.style.left = `${state.left}px`;
      panel.style.top = `${state.top}px`;
      panel.style.width = `${state.width}px`;
      panel.style.height = `${state.height}px`;

      // Show panel if it was open before
      if (state.isOpen) {
        panel.style.display = 'flex';
      }

      return panel;
    }

    /**
     * Render a container section with Quick Tabs
     * @param {string} cookieStoreId - Container ID
     * @param {Object} containerInfo - Container display info
     * @param {Object} containerState - Container state with tabs
     * @returns {HTMLElement} - Container section element
     */
    static renderContainerSection(cookieStoreId, containerInfo, containerState) {
      const section = document.createElement('div');
      section.className = 'panel-container-section';

      // Header
      const header = PanelUIBuilder._createHeader(containerInfo, containerState);
      section.appendChild(header);

      // Tabs
      const activeTabs = containerState.tabs.filter(t => !t.minimized);
      const minimizedTabs = containerState.tabs.filter(t => t.minimized);

      activeTabs.forEach(tab => {
        section.appendChild(PanelUIBuilder.renderQuickTabItem(tab, false));
      });

      minimizedTabs.forEach(tab => {
        section.appendChild(PanelUIBuilder.renderQuickTabItem(tab, true));
      });

      return section;
    }

    /**
     * Create container header element
     * @param {Object} containerInfo - Container display info
     * @param {Object} containerState - Container state with tabs
     * @returns {HTMLElement} - Header element
     * @private
     */
    static _createHeader(containerInfo, containerState) {
      const header = document.createElement('h3');
      header.className = 'panel-container-header';

      const tabCount = containerState.tabs.length;
      const plural = tabCount !== 1 ? 's' : '';

      header.innerHTML = `
      <span class="panel-container-icon">${containerInfo.icon}</span>
      <span class="panel-container-name">${containerInfo.name}</span>
      <span class="panel-container-count">(${tabCount} tab${plural})</span>
    `;

      return header;
    }

    /**
     * Render a Quick Tab item element
     * @param {Object} tab - Quick Tab data
     * @param {boolean} isMinimized - Whether tab is minimized
     * @returns {HTMLElement} - Quick Tab item element
     */
    static renderQuickTabItem(tab, isMinimized) {
      // Convert to boolean explicitly to prevent string 'false' issues
      const minimized = Boolean(isMinimized);

      const item = document.createElement('div');
      item.className = `panel-quick-tab-item ${minimized ? 'minimized' : 'active'}`;

      // Indicator
      const indicator = PanelUIBuilder._createIndicator(minimized);
      item.appendChild(indicator);

      // Favicon
      const favicon = PanelUIBuilder._createFavicon(tab.url);
      item.appendChild(favicon);

      // Info
      const info = PanelUIBuilder._createInfo(tab, minimized);
      item.appendChild(info);

      // Actions
      const actions = PanelUIBuilder._createActions(tab, minimized);
      item.appendChild(actions);

      return item;
    }

    /**
     * Create status indicator element
     * @param {boolean} minimized - Whether tab is minimized
     * @returns {HTMLElement} - Indicator element
     * @private
     */
    static _createIndicator(minimized) {
      const indicator = document.createElement('span');
      indicator.className = `panel-status-indicator ${minimized ? 'yellow' : 'green'}`;
      return indicator;
    }

    /**
     * Create favicon element
     * @param {string} url - Tab URL
     * @returns {HTMLElement} - Favicon element
     * @private
     */
    static _createFavicon(url) {
      const favicon = document.createElement('img');
      favicon.className = 'panel-favicon';

      try {
        const urlObj = new URL(url);
        favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
        favicon.onerror = () => (favicon.style.display = 'none');
      } catch (e) {
        favicon.style.display = 'none';
      }

      return favicon;
    }

    /**
     * Create tab info element
     * @param {Object} tab - Tab data
     * @param {boolean} minimized - Whether tab is minimized
     * @returns {HTMLElement} - Info element
     * @private
     */
    static _createInfo(tab, minimized) {
      const info = document.createElement('div');
      info.className = 'panel-tab-info';

      const title = document.createElement('div');
      title.className = 'panel-tab-title';
      title.textContent = tab.title || 'Quick Tab';

      const meta = document.createElement('div');
      meta.className = 'panel-tab-meta';

      const metaParts = [];
      if (minimized) metaParts.push('Minimized');
      if (tab.activeTabId) metaParts.push(`Tab ${tab.activeTabId}`);
      if (tab.width && tab.height) {
        metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
      }
      meta.textContent = metaParts.join(' • ');

      info.appendChild(title);
      info.appendChild(meta);

      return info;
    }

    /**
     * Create action buttons element
     * @param {Object} tab - Tab data
     * @param {boolean} minimized - Whether tab is minimized
     * @returns {HTMLElement} - Actions element
     * @private
     */
    static _createActions(tab, minimized) {
      const actions = document.createElement('div');
      actions.className = 'panel-tab-actions';

      if (!minimized) {
        // Go to Tab button
        if (tab.activeTabId) {
          const goToBtn = PanelUIBuilder._createButton('🔗', 'Go to Tab', 'goToTab', {
            tabId: tab.activeTabId
          });
          actions.appendChild(goToBtn);
        }

        // Minimize button
        const minBtn = PanelUIBuilder._createButton('➖', 'Minimize', 'minimize', {
          quickTabId: tab.id
        });
        actions.appendChild(minBtn);
      } else {
        // Restore button
        const restoreBtn = PanelUIBuilder._createButton('↑', 'Restore', 'restore', {
          quickTabId: tab.id
        });
        actions.appendChild(restoreBtn);
      }

      // Close button (always present)
      const closeBtn = PanelUIBuilder._createButton('✕', 'Close', 'close', {
        quickTabId: tab.id
      });
      actions.appendChild(closeBtn);

      return actions;
    }

    /**
     * Create action button element
     * @param {string} text - Button text
     * @param {string} title - Button tooltip
     * @param {string} action - Action type
     * @param {Object} data - Data attributes
     * @returns {HTMLElement} - Button element
     * @private
     */
    static _createButton(text, title, action, data) {
      const button = document.createElement('button');
      button.className = 'panel-btn-icon';
      button.textContent = text;
      button.title = title;
      button.dataset.action = action;

      // Set data attributes
      Object.entries(data).forEach(([key, value]) => {
        button.dataset[key] = value;
      });

      return button;
    }

    /**
     * Get container icon emoji
     * @param {string} icon - Icon name
     * @returns {string} - Icon emoji
     */
    static getContainerIcon(icon) {
      const iconMap = {
        fingerprint: '🔒',
        briefcase: '💼',
        dollar: '💰',
        cart: '🛒',
        circle: '⭕',
        gift: '🎁',
        vacation: '🏖️',
        food: '🍴',
        fruit: '🍎',
        pet: '🐾',
        tree: '🌳',
        chill: '❄️',
        fence: '🚧'
      };

      return iconMap[icon] || '📁';
    }
  }

  /**
   * Quick Tabs Manager Persistent Floating Panel
   * Facade integrating all panel components
   *
   * v1.6.0 - Phase 2.10: Refactored to facade pattern
   * Previously 1497 lines → Now ~300 lines facade orchestrating components
   *
   * Components:
   * - PanelUIBuilder: DOM creation and rendering
   * - PanelDragController: Drag handling
   * - PanelResizeController: Resize handling
   * - PanelStateManager: State persistence and BroadcastChannel
   * - PanelContentManager: Content updates and Quick Tab operations
   *
   * Features:
   * - Persistent across page navigations (re-injected on load)
   * - Draggable using Pointer Events API
   * - Resizable from all edges/corners
   * - Position/size persisted to browser.storage.local
   * - Container-aware Quick Tabs categorization
   * - Action buttons: Close Minimized, Close All
   * - Individual tab actions: Minimize, Restore, Close, Go to Tab
   */


  /**
   * PanelManager - Facade for Quick Tabs Manager Panel
   */
  class PanelManager {
    /**
     * Create a new PanelManager
     * @param {Object} quickTabsManager - QuickTabsManager instance
     */
    constructor(quickTabsManager) {
      this.quickTabsManager = quickTabsManager;
      this.panel = null;
      this.isOpen = false;
      this.currentContainerId = 'firefox-default';

      // Component instances
      this.uiBuilder = new PanelUIBuilder();
      this.dragController = null;
      this.resizeController = null;
      this.stateManager = null;
      this.contentManager = null;

      // Auto-refresh interval
      this.updateInterval = null;
    }

    /**
     * Initialize the panel
     * v1.5.9.12 - Container integration: Detect container context
     */
    async init() {
      debug('[PanelManager] Initializing...');

      // Detect container context
      await this.detectContainerContext();

      // Initialize state manager
      this.stateManager = new PanelStateManager({
        onStateLoaded: state => this._applyState(state),
        onBroadcastReceived: (type, data) => this._handleBroadcast(type, data)
      });
      await this.stateManager.init();

      // Inject CSS
      this.uiBuilder.injectStyles();

      // Create panel (hidden by default)
      const savedState = this.stateManager.getState();
      this.panel = this.uiBuilder.createPanel(savedState);
      document.body.appendChild(this.panel);

      // Initialize controllers
      this._initializeControllers();

      // Set up message listener for toggle command
      this.setupMessageListener();

      debug('[PanelManager] Initialized');
    }

    /**
     * Detect and store the current tab's container context
     * v1.5.9.12 - Container integration
     * @private
     */
    async detectContainerContext() {
      this.currentContainerId = 'firefox-default';

      if (typeof browser === 'undefined' || !browser.tabs) {
        debug('[PanelManager] Browser tabs API not available');
        return;
      }

      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true
        });
        if (tabs?.[0]?.cookieStoreId) {
          this.currentContainerId = tabs[0].cookieStoreId;
          debug(`[PanelManager] Container: ${this.currentContainerId}`);
        } else {
          debug('[PanelManager] Using default container');
        }
      } catch (err) {
        debug('[PanelManager] Failed to detect container:', err);
      }
    }

    /**
     * Initialize all controllers
     * @private
     */
    _initializeControllers() {
      const handle = this.panel.querySelector('.panel-header');

      // Drag controller
      this.dragController = new PanelDragController(this.panel, handle, {
        onDragEnd: (_left, _top) => {
          this.stateManager.savePanelState(this.panel);
        },
        onBroadcast: data => {
          this.stateManager.broadcast('PANEL_POSITION_UPDATED', data);
        }
      });

      // Resize controller
      this.resizeController = new PanelResizeController(this.panel, {
        onSizeChange: (_width, _height) => {
          // Optional: Update UI during resize
        },
        onPositionChange: (_left, _top) => {
          // Optional: Update UI during position change
        },
        onResizeEnd: (_w, _h, _l, _t) => {
          this.stateManager.savePanelState(this.panel);
        },
        onBroadcast: data => {
          this.stateManager.broadcast('PANEL_SIZE_UPDATED', {
            width: data.width,
            height: data.height
          });
          this.stateManager.broadcast('PANEL_POSITION_UPDATED', {
            left: data.left,
            top: data.top
          });
        }
      });

      // Content manager
      this.contentManager = new PanelContentManager(this.panel, {
        uiBuilder: this.uiBuilder,
        stateManager: this.stateManager,
        quickTabsManager: this.quickTabsManager,
        currentContainerId: this.currentContainerId
      });
      this.contentManager.setOnClose(() => this.close());
      this.contentManager.setupEventListeners();
    }

    /**
     * Setup message listener for toggle command
     */
    setupMessageListener() {
      browser.runtime.onMessage.addListener((message, _sender) => {
        if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
          this.toggle();
          return Promise.resolve({ success: true });
        }
        return false;
      });
    }

    /**
     * Toggle panel visibility
     */
    toggle() {
      if (!this.panel) {
        console.error('[PanelManager] Panel not initialized');
        return;
      }

      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    /**
     * Open panel
     */
    open() {
      if (!this.panel) {
        console.error('[PanelManager] Panel not initialized');
        return;
      }

      this.panel.style.display = 'flex';
      this.isOpen = true;
      this.stateManager.setIsOpen(true);

      // Bring to front
      this.panel.style.zIndex = '999999999';

      // Update content
      this.contentManager.setIsOpen(true);
      this.contentManager.updateContent();

      // Start auto-refresh
      if (!this.updateInterval) {
        this.updateInterval = setInterval(() => {
          this.contentManager.updateContent();
        }, 2000);
      }

      // Save state and broadcast
      this.stateManager.savePanelState(this.panel);
      this.stateManager.broadcast('PANEL_OPENED', {});

      debug('[PanelManager] Panel opened');
    }

    /**
     * Close panel
     */
    close() {
      if (!this.panel) return;

      this.panel.style.display = 'none';
      this.isOpen = false;
      this.stateManager.setIsOpen(false);
      this.contentManager.setIsOpen(false);

      // Stop auto-refresh
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Save state and broadcast
      this.stateManager.savePanelState(this.panel);
      this.stateManager.broadcast('PANEL_CLOSED', {});

      debug('[PanelManager] Panel closed');
    }

    /**
     * Open panel silently (no broadcast)
     * Used when responding to broadcasts from other tabs
     */
    openSilent() {
      if (!this.panel) return;

      this.panel.style.display = 'flex';
      this.isOpen = true;
      this.stateManager.setIsOpen(true);
      this.contentManager.setIsOpen(true);

      // Update content
      this.contentManager.updateContent();

      // Start auto-refresh
      if (!this.updateInterval) {
        this.updateInterval = setInterval(() => {
          this.contentManager.updateContent();
        }, 2000);
      }

      debug('[PanelManager] Panel opened (silent)');
    }

    /**
     * Close panel silently (no broadcast)
     * Used when responding to broadcasts from other tabs
     */
    closeSilent() {
      if (!this.panel) return;

      this.panel.style.display = 'none';
      this.isOpen = false;
      this.stateManager.setIsOpen(false);
      this.contentManager.setIsOpen(false);

      // Stop auto-refresh
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      debug('[PanelManager] Panel closed (silent)');
    }

    /**
     * Apply loaded state to panel
     * @param {Object} state - State object with position/size/isOpen
     * @private
     */
    _applyState(state) {
      if (!this.panel) return;

      // Apply position and size
      this.panel.style.left = `${state.left}px`;
      this.panel.style.top = `${state.top}px`;
      this.panel.style.width = `${state.width}px`;
      this.panel.style.height = `${state.height}px`;

      // Apply open state
      if (state.isOpen) {
        this.open();
      }
    }

    /**
     * Handle broadcast messages from other tabs
     * @param {string} type - Message type
     * @param {Object} data - Message data
     * @private
     */
    _handleBroadcast(type, data) {
      const handlers = {
        PANEL_OPENED: () => !this.isOpen && this.openSilent(),
        PANEL_CLOSED: () => this.isOpen && this.closeSilent(),
        PANEL_POSITION_UPDATED: () => this._updatePosition(data),
        PANEL_SIZE_UPDATED: () => this._updateSize(data)
      };

      const handler = handlers[type];
      if (handler) {
        handler();
      } else {
        debug(`[PanelManager] Unknown broadcast: ${type}`);
      }
    }

    /**
     * Update panel position from broadcast
     * @param {Object} data - Position data
     * @private
     */
    _updatePosition(data) {
      if (data.left === undefined || data.top === undefined) return;

      this.panel.style.left = `${data.left}px`;
      this.panel.style.top = `${data.top}px`;
      this.stateManager.savePanelStateLocal(this.panel);
    }

    /**
     * Update panel size from broadcast
     * @param {Object} data - Size data
     * @private
     */
    _updateSize(data) {
      if (data.width === undefined || data.height === undefined) return;

      this.panel.style.width = `${data.width}px`;
      this.panel.style.height = `${data.height}px`;
      this.stateManager.savePanelStateLocal(this.panel);
    }

    /**
     * Destroy panel and cleanup
     */
    destroy() {
      // Stop auto-refresh
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Destroy controllers
      if (this.dragController) {
        this.dragController.destroy();
        this.dragController = null;
      }
      if (this.resizeController) {
        this.resizeController.destroy();
        this.resizeController = null;
      }
      if (this.contentManager) {
        this.contentManager.destroy();
        this.contentManager = null;
      }
      if (this.stateManager) {
        this.stateManager.destroy();
        this.stateManager = null;
      }

      // Remove panel from DOM
      if (this.panel) {
        this.panel.remove();
        this.panel = null;
      }

      debug('[PanelManager] Destroyed');
    }
  }

  /**
   * Quick Tabs Feature Module - REFACTORED FACADE
   * Main entrypoint for Quick Tabs functionality
   *
   * v1.6.0 - PHASE 2.2: Facade pattern implementation
   * Reduces complexity from 1453 lines to ~400 lines by delegating to extracted components
   *
   * Architecture:
   * - Facade orchestrates 4 managers, 4 handlers, 2 coordinators
   * - Maintains backward compatibility with legacy API
   * - Delegates all business logic to specialized components
   */


  /**
   * QuickTabsManager - Facade for Quick Tab management
   * v1.6.0 - Simplified to orchestration layer, delegates to specialized components
   */
  class QuickTabsManager {
    constructor() {
      // Backward compatibility fields (MUST KEEP - other code depends on these)
      this.tabs = new Map(); // id -> QuickTabWindow instance (used by panel.js, etc.)
      this.currentZIndex = { value: CONSTANTS.QUICK_TAB_BASE_Z_INDEX }; // Changed to ref object
      this.initialized = false;
      this.cookieStoreId = null;
      this.currentTabId = null;
      this.pendingSaveIds = new Set(); // For saveId tracking (backward compat)

      // Internal event bus for component communication (NEW in v1.6.0)
      this.internalEventBus = new EventEmitter();

      // Managers (initialized in init())
      this.storage = null;
      this.broadcast = null;
      this.state = null;
      this.events = null;

      // Handlers (initialized in init())
      this.createHandler = null;
      this.updateHandler = null;
      this.visibilityHandler = null;
      this.destroyHandler = null;

      // Coordinators (initialized in init())
      this.uiCoordinator = null;
      this.syncCoordinator = null;

      // Legacy UI managers (KEEP - used by other modules)
      this.minimizedManager = new MinimizedManager();
      this.panelManager = null;

      // Legacy fields for backward compatibility (KEEP - required by old code)
      this.eventBus = null; // External event bus from content.js
      this.Events = null; // Event constants
      this.broadcastChannel = null; // Legacy field (now handled by BroadcastManager)
    }

    /**
     * Initialize the Quick Tabs manager
     * v1.6.0 - Refactored to wire together extracted components
     *
     * @param {EventEmitter} eventBus - External event bus from content.js
     * @param {Object} Events - Event constants
     */
    async init(eventBus, Events) {
      if (this.initialized) {
        console.log('[QuickTabsManager] Already initialized, skipping');
        return;
      }

      this.eventBus = eventBus;
      this.Events = Events;

      console.log('[QuickTabsManager] Initializing facade...');

      // STEP 1: Detect context (container, tab ID)
      await this.detectContainerContext();
      await this.detectCurrentTabId();

      // STEP 2: Initialize managers
      this._initializeManagers();

      // STEP 3: Initialize handlers
      this._initializeHandlers();

      // STEP 4: Initialize panel manager (must happen before coordinators)
      this.panelManager = new PanelManager(this);
      await this.panelManager.init();
      console.log('[QuickTabsManager] Panel manager initialized');

      // STEP 5: Initialize coordinators
      this._initializeCoordinators();

      // STEP 6: Setup managers (attach listeners)
      this._setupComponents();

      // STEP 7: Hydrate state from storage (EAGER LOADING)
      await this._hydrateState();

      // STEP 8: Expose manager globally for QuickTabWindow button access (backward compat)
      if (typeof window !== 'undefined') {
        window.__quickTabsManager = this;
        console.log('[QuickTabsManager] Manager exposed globally');
      }

      this.initialized = true;
      console.log('[QuickTabsManager] Facade initialized successfully');
    }

    /**
     * Initialize manager components
     * @private
     */
    _initializeManagers() {
      this.storage = new StorageManager(this.internalEventBus, this.cookieStoreId);
      this.broadcast = new BroadcastManager(this.internalEventBus, this.cookieStoreId);
      this.state = new StateManager(this.internalEventBus, this.currentTabId);
      this.events = new EventManager(this.internalEventBus, this.tabs);
    }

    /**
     * Initialize handler components
     * @private
     */
    _initializeHandlers() {
      this.createHandler = new CreateHandler(
        this.tabs,
        this.currentZIndex,
        this.cookieStoreId,
        this.broadcast,
        this.eventBus,
        this.Events,
        this.generateId.bind(this)
      );

      this.updateHandler = new UpdateHandler(
        this.tabs,
        this.broadcast,
        this.storage,
        this.internalEventBus,
        this.generateSaveId.bind(this),
        this.releasePendingSave.bind(this)
      );

      this.visibilityHandler = new VisibilityHandler(
        this.tabs,
        this.broadcast,
        this.storage,
        this.minimizedManager,
        this.internalEventBus,
        this.currentZIndex,
        this.generateSaveId.bind(this),
        this.trackPendingSave.bind(this),
        this.releasePendingSave.bind(this),
        this.currentTabId,
        this.Events
      );

      this.destroyHandler = new DestroyHandler(
        this.tabs,
        this.broadcast,
        this.minimizedManager,
        this.eventBus,
        this.currentZIndex,
        this.generateSaveId.bind(this),
        this.releasePendingSave.bind(this),
        this.Events,
        CONSTANTS.QUICK_TAB_BASE_Z_INDEX
      );
    }

    /**
     * Initialize coordinator components
     * @private
     */
    _initializeCoordinators() {
      this.uiCoordinator = new UICoordinator(
        this.state,
        this.minimizedManager,
        this.panelManager,
        this.internalEventBus
      );

      this.syncCoordinator = new SyncCoordinator(
        this.state,
        this.storage,
        this.broadcast,
        {
          create: this.createHandler,
          update: this.updateHandler,
          visibility: this.visibilityHandler,
          destroy: this.destroyHandler
        },
        this.internalEventBus
      );
    }

    /**
     * Setup component listeners and event flows
     * @private
     */
    async _setupComponents() {
      this.storage.setupStorageListeners();
      this.broadcast.setupBroadcastChannel();
      this.events.setupEmergencySaveHandlers();
      this.syncCoordinator.setupListeners();
      await this.uiCoordinator.init();
    }

    /**
     * Detect Firefox container context
     * v1.5.9.12 - Container integration
     */
    async detectContainerContext() {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].cookieStoreId) {
          this.cookieStoreId = tabs[0].cookieStoreId;
          console.log('[QuickTabsManager] Detected container:', this.cookieStoreId);
        } else {
          this.cookieStoreId = 'firefox-default';
          console.log('[QuickTabsManager] Using default container');
        }
      } catch (err) {
        console.error('[QuickTabsManager] Failed to detect container:', err);
        this.cookieStoreId = 'firefox-default';
      }
    }

    /**
     * Get current container context (backward compat)
     */
    async getCurrentContainer() {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].cookieStoreId) {
          return tabs[0].cookieStoreId;
        }
        return 'firefox-default';
      } catch (err) {
        console.error('[QuickTabsManager] Failed to get current container:', err);
        return this.cookieStoreId || 'firefox-default';
      }
    }

    /**
     * Detect current Firefox tab ID
     * v1.5.9.13 - Solo/Mute functionality
     */
    async detectCurrentTabId() {
      try {
        const response = await browser.runtime.sendMessage({ action: 'GET_CURRENT_TAB_ID' });
        if (response && response.tabId) {
          this.currentTabId = response.tabId;
          console.log('[QuickTabsManager] Detected current tab ID:', this.currentTabId);
        }
      } catch (err) {
        console.error('[QuickTabsManager] Failed to detect tab ID:', err);
      }
    }

    /**
     * Hydrate state from storage
     * @private
     */
    async _hydrateState() {
      console.log('[QuickTabsManager] Hydrating state from storage...');
      try {
        const quickTabs = await this.storage.loadAll();
        this.state.hydrate(quickTabs);
        console.log(`[QuickTabsManager] Hydrated ${quickTabs.length} Quick Tabs`);
      } catch (err) {
        console.error('[QuickTabsManager] Failed to hydrate state:', err);
      }
    }

    // ============================================================================
    // PUBLIC API - Delegate to handlers and coordinators
    // ============================================================================

    /**
     * Create a new Quick Tab
     * Delegates to CreateHandler
     */
    createQuickTab(options) {
      // Add callbacks to options (required by QuickTabWindow)
      const optionsWithCallbacks = {
        ...options,
        onDestroy: tabId => this.handleDestroy(tabId),
        onMinimize: tabId => this.handleMinimize(tabId),
        onFocus: tabId => this.handleFocus(tabId),
        onPositionChange: (tabId, left, top) => this.handlePositionChange(tabId, left, top),
        onPositionChangeEnd: (tabId, left, top) => this.handlePositionChangeEnd(tabId, left, top),
        onSizeChange: (tabId, width, height) => this.handleSizeChange(tabId, width, height),
        onSizeChangeEnd: (tabId, width, height) => this.handleSizeChangeEnd(tabId, width, height),
        onSolo: (tabId, soloedOnTabs) => this.handleSoloToggle(tabId, soloedOnTabs),
        onMute: (tabId, mutedOnTabs) => this.handleMuteToggle(tabId, mutedOnTabs)
      };

      const result = this.createHandler.create(optionsWithCallbacks);
      this.currentZIndex.value = result.newZIndex;
      return result.tabWindow;
    }

    /**
     * Handle Quick Tab destruction
     * Delegates to DestroyHandler
     */
    handleDestroy(id) {
      return this.destroyHandler.handleDestroy(id);
    }

    /**
     * Handle Quick Tab minimize
     * Delegates to VisibilityHandler
     */
    handleMinimize(id) {
      return this.visibilityHandler.handleMinimize(id);
    }

    /**
     * Handle Quick Tab focus
     * Delegates to VisibilityHandler
     */
    handleFocus(id) {
      return this.visibilityHandler.handleFocus(id);
    }

    /**
     * Handle position change (during drag)
     * Delegates to UpdateHandler
     */
    handlePositionChange(id, left, top) {
      return this.updateHandler.handlePositionChange(id, left, top);
    }

    /**
     * Handle position change end (drag complete)
     * Delegates to UpdateHandler
     */
    handlePositionChangeEnd(id, left, top) {
      return this.updateHandler.handlePositionChangeEnd(id, left, top);
    }

    /**
     * Handle size change (during resize)
     * Delegates to UpdateHandler
     */
    handleSizeChange(id, width, height) {
      return this.updateHandler.handleSizeChange(id, width, height);
    }

    /**
     * Handle size change end (resize complete)
     * Delegates to UpdateHandler
     */
    handleSizeChangeEnd(id, width, height) {
      return this.updateHandler.handleSizeChangeEnd(id, width, height);
    }

    /**
     * Handle solo toggle
     * Delegates to VisibilityHandler
     */
    handleSoloToggle(quickTabId, newSoloedTabs) {
      return this.visibilityHandler.handleSoloToggle(quickTabId, newSoloedTabs);
    }

    /**
     * Handle mute toggle
     * Delegates to VisibilityHandler
     */
    handleMuteToggle(quickTabId, newMutedTabs) {
      return this.visibilityHandler.handleMuteToggle(quickTabId, newMutedTabs);
    }

    /**
     * Close Quick Tab by ID
     * Delegates to DestroyHandler
     */
    closeById(id) {
      return this.destroyHandler.closeById(id);
    }

    /**
     * Close all Quick Tabs
     * Delegates to DestroyHandler
     */
    closeAll() {
      return this.destroyHandler.closeAll();
    }

    /**
     * Restore Quick Tab from minimized state
     * Delegates to VisibilityHandler
     */
    restoreQuickTab(id) {
      return this.visibilityHandler.restoreQuickTab(id);
    }

    /**
     * Minimize Quick Tab by ID (backward compat)
     * Delegates to VisibilityHandler
     */
    minimizeById(id) {
      return this.handleMinimize(id);
    }

    /**
     * Restore Quick Tab by ID (backward compat)
     * Delegates to VisibilityHandler
     */
    restoreById(id) {
      return this.visibilityHandler.restoreById(id);
    }

    /**
     * Get Quick Tab by ID (backward compat)
     */
    getQuickTab(id) {
      return this.tabs.get(id);
    }

    /**
     * Get all Quick Tabs (backward compat)
     */
    getAllQuickTabs() {
      return Array.from(this.tabs.values());
    }

    /**
     * Get minimized Quick Tabs (backward compat)
     */
    getMinimizedQuickTabs() {
      return this.minimizedManager.getAll();
    }

    // ============================================================================
    // UTILITY METHODS (KEEP - core functionality)
    // ============================================================================

    /**
     * Generate unique ID for Quick Tab
     */
    generateId() {
      return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate unique save ID for transaction tracking
     */
    generateSaveId() {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Track pending save to prevent race conditions
     */
    trackPendingSave(saveId) {
      this.pendingSaveIds.add(saveId);
      console.log('[QuickTabsManager] Tracking pending save:', saveId);
    }

    /**
     * Release pending save
     */
    releasePendingSave(saveId) {
      this.pendingSaveIds.delete(saveId);
      console.log('[QuickTabsManager] Released pending save:', saveId);
    }

    // ============================================================================
    // LEGACY METHODS (kept for backward compatibility, delegate to new components)
    // ============================================================================

    /**
     * Update Quick Tab position (legacy - backward compat)
     * @deprecated Use handlePositionChange instead
     */
    updateQuickTabPosition(id, left, top) {
      return this.handlePositionChange(id, left, top);
    }

    /**
     * Update Quick Tab size (legacy - backward compat)
     * @deprecated Use handleSizeChange instead
     */
    updateQuickTabSize(id, width, height) {
      return this.handleSizeChange(id, width, height);
    }
  }

  // ============================================================================
  // MODULE INITIALIZATION
  // ============================================================================

  const quickTabsManager$1 = new QuickTabsManager();

  /**
   * Initialize Quick Tabs feature module
   * v1.6.0 - Facade pattern, delegates to extracted components
   *
   * @param {EventEmitter} eventBus - External event bus from content.js
   * @param {Object} Events - Event constants
   * @returns {QuickTabsManager} Initialized manager instance
   */
  async function initQuickTabs(eventBus, Events) {
    console.log('[QuickTabs] Initializing Quick Tabs feature module...');
    await quickTabsManager$1.init(eventBus, Events);
    console.log('[QuickTabs] Quick Tabs feature module initialized');
    return quickTabsManager$1;
  }

  /**
   * Generic URL Handler
   * Fallback URL detection for any website
   */

  /**
   * Check if element is a container that should be searched for links
   * @param {Element} element - DOM element
   * @returns {boolean} True if element is a link container
   */
  function isLinkContainer(element) {
    return (
      element.tagName === 'ARTICLE' ||
      element.getAttribute('role') === 'article' ||
      element.getAttribute('role') === 'link' ||
      element.classList.contains('post') ||
      element.hasAttribute('data-testid') ||
      element.hasAttribute('data-id')
    );
  }

  /**
   * Find generic URL from any element
   * @param {Element} element - DOM element
   * @returns {string|null} Found URL or null
   */
  function findGenericUrl(element) {
    // Look for direct href on clicked element
    if (element.href) return element.href;

    // Look for closest link
    const link = element.closest('a[href]');
    if (link?.href) return link.href;

    // Only search within element if it's a clear container
    if (isLinkContainer(element)) {
      const innerLink = element.querySelector('a[href]');
      if (innerLink?.href) return innerLink.href;
    }

    // Don't search siblings - that's too broad and causes false positives
    return null;
  }

  /**
   * Get link text from element
   * @param {Element} element - DOM element
   * @returns {string} Link text
   */
  function getLinkText(element) {
    if (element.tagName === 'A') {
      return element.textContent.trim();
    }

    const link = element.querySelector('a[href]');
    if (link) {
      return link.textContent.trim();
    }

    return element.textContent.trim().substring(0, 100);
  }

  /**
   * Blogging URL Handlers
   * URL detection for blogging platforms
   */


  function findMediumUrl(element) {
    const article = element.closest('[data-post-id], article');
    if (!article) return findGenericUrl(element);

    const link = article.querySelector('a[data-action="open-post"], h2 a, h3 a');
    if (link?.href) return link.href;

    return null;
  }

  function findDevToUrl(element) {
    const article = element.closest('.crayons-story, [data-article-id]');
    if (!article) return findGenericUrl(element);

    const link = article.querySelector('a[id*="article-link"], h2 a, h3 a');
    if (link?.href) return link.href;

    return null;
  }

  function findHashnodeUrl(element) {
    const article = element.closest('[data-post-id], .post-card');
    if (!article) return findGenericUrl(element);

    const link = article.querySelector('a[href*="/post/"], h1 a, h2 a');
    if (link?.href) return link.href;

    return null;
  }

  function findSubstackUrl(element) {
    const article = element.closest('.post, [data-testid="post-preview"]');
    if (!article) return findGenericUrl(element);

    const link = article.querySelector('a[href*="/p/"], h2 a, h3 a');
    if (link?.href) return link.href;

    return null;
  }

  function findWordpressUrl(element) {
    const post = element.closest('.post, .hentry, article');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a.entry-title-link, h2 a, .entry-title a');
    if (link?.href) return link.href;

    return null;
  }

  function findBloggerUrl(element) {
    const post = element.closest('.post, .post-outer');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('h3.post-title a, a.post-title');
    if (link?.href) return link.href;

    return null;
  }

  function findGhostUrl(element) {
    const article = element.closest('.post-card, article');
    if (!article) return findGenericUrl(element);

    const link = article.querySelector('.post-card-title a, h2 a');
    if (link?.href) return link.href;

    return null;
  }

  function findNotionUrl(_element) {
    // Notion typically uses current page URL
    return window.location.href;
  }

  const bloggingHandlers = {
    medium: findMediumUrl,
    devTo: findDevToUrl,
    hashnode: findHashnodeUrl,
    substack: findSubstackUrl,
    wordpress: findWordpressUrl,
    blogger: findBloggerUrl,
    ghost: findGhostUrl,
    notion: findNotionUrl
  };

  /**
   * Developer URL Handlers
   * URL detection for developer platforms
   */


  function findGitHubUrl(element) {
    const item = element.closest('[data-testid="issue-row"], .Box-row, .issue, [role="article"]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector(
      'a[href*="/issues/"], a[href*="/pull/"], a[href*="/discussions/"]'
    );
    if (link?.href) return link.href;

    return null;
  }

  function findGitLabUrl(element) {
    const item = element.closest('.issue, .merge-request, [data-qa-selector]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/issues/"], a[href*="/merge_requests/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findBitbucketUrl(element) {
    const item = element.closest('[data-testid="issue-row"], .iterable-item');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/issues/"], a[href*="/pull-requests/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findStackOverflowUrl(element) {
    const question = element.closest('.s-post-summary, [data-post-id]');
    if (!question) return findGenericUrl(element);

    const link = question.querySelector('a.s-link[href*="/questions/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findStackExchangeUrl(element) {
    const question = element.closest('.s-post-summary, .question-summary');
    if (!question) return findGenericUrl(element);

    const link = question.querySelector('a[href*="/questions/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findServerFaultUrl(element) {
    // Server Fault uses the same Stack Exchange structure
    return findStackExchangeUrl(element);
  }

  function findSuperUserUrl(element) {
    // Super User uses the same Stack Exchange structure
    return findStackExchangeUrl(element);
  }

  function findCodepenUrl(element) {
    const pen = element.closest('[data-slug], .single-pen');
    if (!pen) return findGenericUrl(element);

    const link = pen.querySelector('a[href*="/pen/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findJSFiddleUrl(element) {
    const fiddle = element.closest('.fiddle, [data-id]');
    if (!fiddle) return findGenericUrl(element);

    const link = fiddle.querySelector('a[href*="jsfiddle.net"]');
    if (link?.href) return link.href;

    return null;
  }

  function findReplitUrl(element) {
    const repl = element.closest('[data-repl-id], .repl-item');
    if (!repl) return findGenericUrl(element);

    const link = repl.querySelector('a[href*="/@"]');
    if (link?.href) return link.href;

    return null;
  }

  function findGlitchUrl(element) {
    const project = element.closest('.project, [data-project-id]');
    if (!project) return findGenericUrl(element);

    const link = project.querySelector('a[href*="glitch.com/~"]');
    if (link?.href) return link.href;

    return null;
  }

  function findCodesandboxUrl(element) {
    const sandbox = element.closest('[data-id], .sandbox-item');
    if (!sandbox) return findGenericUrl(element);

    const link = sandbox.querySelector('a[href*="/s/"]');
    if (link?.href) return link.href;

    return null;
  }

  const developerHandlers = {
    gitHub: findGitHubUrl,
    gitLab: findGitLabUrl,
    bitbucket: findBitbucketUrl,
    stackOverflow: findStackOverflowUrl,
    stackExchange: findStackExchangeUrl,
    serverFault: findServerFaultUrl,
    superUser: findSuperUserUrl,
    codepen: findCodepenUrl,
    jSFiddle: findJSFiddleUrl,
    replit: findReplitUrl,
    glitch: findGlitchUrl,
    codesandbox: findCodesandboxUrl
  };

  /**
   * Ecommerce URL Handlers
   * URL detection for ecommerce platforms
   */


  function findAmazonUrl(element) {
    const product = element.closest(
      '[data-component-type="s-search-result"], .s-result-item, [data-asin]'
    );
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
    if (link?.href) return link.href;

    return null;
  }

  function findEbayUrl(element) {
    const item = element.closest('.s-item, [data-view="mi"]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a.s-item__link, .vip a');
    if (link?.href) return link.href;

    return null;
  }

  function findEtsyUrl(element) {
    const listing = element.closest('[data-listing-id], .listing-link');
    if (!listing) return findGenericUrl(element);

    const link = listing.querySelector('a[href*="/listing/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findWalmartUrl(element) {
    const product = element.closest('[data-item-id], .search-result-gridview-item');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/ip/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findFlipkartUrl(element) {
    const product = element.closest('[data-id], ._2kHMtA');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/p/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findAliexpressUrl(element) {
    const product = element.closest('[data-product-id], .product-item');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/item/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findAlibabaUrl(element) {
    const product = element.closest('[data-content], .organic-list-offer');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/product-detail/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findShopifyUrl(element) {
    const product = element.closest('.product-item, .grid-item, [data-product-id]');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/products/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findTargetUrl(element) {
    const product = element.closest('[data-test="product-grid-item"]');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/p/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findBestBuyUrl(element) {
    const product = element.closest('.sku-item, [data-sku-id]');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/site/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findNeweggUrl(element) {
    const item = element.closest('.item-cell, [data-item]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a.item-title');
    if (link?.href) return link.href;

    return null;
  }

  function findWishUrl(element) {
    const product = element.closest('[data-productid], .ProductCard');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/product/"]');
    if (link?.href) return link.href;

    return null;
  }

  const ecommerceHandlers = {
    amazon: findAmazonUrl,
    ebay: findEbayUrl,
    etsy: findEtsyUrl,
    walmart: findWalmartUrl,
    flipkart: findFlipkartUrl,
    aliexpress: findAliexpressUrl,
    alibaba: findAlibabaUrl,
    shopify: findShopifyUrl,
    target: findTargetUrl,
    bestBuy: findBestBuyUrl,
    newegg: findNeweggUrl,
    wish: findWishUrl
  };

  /**
   * Entertainment URL Handlers
   * URL detection for entertainment platforms
   */


  function findWikipediaUrl(element) {
    // Only return URL if hovering over an actual link element
    // Don't default to current page URL
    return findGenericUrl(element);
  }

  function findImdbUrl(element) {
    const item = element.closest('.lister-item, [data-testid="title"]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/title/"], a[href*="/name/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findRottenTomatoesUrl(element) {
    const item = element.closest('[data-qa="discovery-media-list-item"]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/m/"], a[href*="/tv/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findNetflixUrl(_element) {
    // Netflix uses current page URL
    return window.location.href;
  }

  function findLetterboxdUrl(element) {
    const film = element.closest('.film-poster, [data-film-id]');
    if (!film) return findGenericUrl(element);

    const link = film.querySelector('a[href*="/film/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findGoodreadsUrl(element) {
    const book = element.closest('.bookBox, [data-book-id]');
    if (!book) return findGenericUrl(element);

    const link = book.querySelector('a[href*="/book/show/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findMyAnimeListUrl(element) {
    const anime = element.closest('.anime_ranking_h3, [data-id]');
    if (!anime) return findGenericUrl(element);

    const link = anime.querySelector('a[href*="/anime/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findAniListUrl(element) {
    const media = element.closest('.media-card, [data-media-id]');
    if (!media) return findGenericUrl(element);

    const link = media.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findKitsuUrl(element) {
    const media = element.closest('.media-card');
    if (!media) return findGenericUrl(element);

    const link = media.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findLastFmUrl(element) {
    const item = element.closest('.chartlist-row, [data-track-id]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/music/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findSpotifyUrl(element) {
    const item = element.closest('[data-testid="tracklist-row"], .track');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/track/"], a[href*="/album/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findSoundcloudUrl(element) {
    const track = element.closest('.searchItem, .soundList__item');
    if (!track) return findGenericUrl(element);

    const link = track.querySelector('a[href*="soundcloud.com/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findBandcampUrl(_element) {
    const item = _element.closest('.item-details, [data-item-id]');
    if (!item) return findGenericUrl(_element);

    const link = item.querySelector('a[href*="/track/"], a[href*="/album/"]');
    if (link?.href) return link.href;

    return null;
  }

  const entertainmentHandlers = {
    wikipedia: findWikipediaUrl,
    imdb: findImdbUrl,
    rottenTomatoes: findRottenTomatoesUrl,
    netflix: findNetflixUrl,
    letterboxd: findLetterboxdUrl,
    goodreads: findGoodreadsUrl,
    myAnimeList: findMyAnimeListUrl,
    aniList: findAniListUrl,
    kitsu: findKitsuUrl,
    lastFm: findLastFmUrl,
    spotify: findSpotifyUrl,
    soundcloud: findSoundcloudUrl,
    bandcamp: findBandcampUrl
  };

  /**
   * Gaming URL Handlers
   * URL detection for gaming platforms
   */


  function findSteamUrl(element) {
    const item = element.closest('[data-ds-appid], .search_result_row');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/app/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findSteamPoweredUrl(element) {
    const item = element.closest('[data-ds-appid], .game_area');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/app/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findEpicGamesUrl(element) {
    const game = element.closest('[data-component="Card"]');
    if (!game) return findGenericUrl(element);

    const link = game.querySelector('a[href*="/p/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findGOGUrl(element) {
    const product = element.closest('.product-row, [data-game-id]');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="/game/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findItchIoUrl(element) {
    const game = element.closest('.game_cell, [data-game_id]');
    if (!game) return findGenericUrl(element);

    const link = game.querySelector('a.game_link, a.title');
    if (link?.href) return link.href;

    return null;
  }

  function findGameJoltUrl(element) {
    const game = element.closest('.game-card, [data-game-id]');
    if (!game) return findGenericUrl(element);

    const link = game.querySelector('a[href*="/games/"]');
    if (link?.href) return link.href;

    return null;
  }

  const gamingHandlers = {
    steam: findSteamUrl,
    steamPowered: findSteamPoweredUrl,
    epicGames: findEpicGamesUrl,
    gOG: findGOGUrl,
    itchIo: findItchIoUrl,
    gameJolt: findGameJoltUrl
  };

  /**
   * Image Design URL Handlers
   * URL detection for image design platforms
   */


  function findPinterestUrl(element) {
    const pin = element.closest('[data-test-id="pin"], [role="button"]');
    if (!pin) return findGenericUrl(element);

    const link = pin.querySelector('a[href*="/pin/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findTumblrUrl(element) {
    const post = element.closest('[data-id], article');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/post/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findDribbbleUrl(element) {
    const shot = element.closest('[data-thumbnail-target], .shot-thumbnail');
    if (!shot) return findGenericUrl(element);

    const link = shot.querySelector('a[href*="/shots/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findBehanceUrl(element) {
    const project = element.closest('[data-project-id], .Project');
    if (!project) return findGenericUrl(element);

    const link = project.querySelector('a[href*="/gallery/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findDeviantartUrl(element) {
    const deviation = element.closest('[data-deviationid], ._2vUXu');
    if (!deviation) return findGenericUrl(element);

    const link = deviation.querySelector('a[data-hook="deviation_link"]');
    if (link?.href) return link.href;

    return null;
  }

  function findFlickrUrl(element) {
    const photo = element.closest('.photo-list-photo-view, [data-photo-id]');
    if (!photo) return findGenericUrl(element);

    const link = photo.querySelector('a[href*="/photos/"]');
    if (link?.href) return link.href;

    return null;
  }

  function find500pxUrl(element) {
    const photo = element.closest('[data-test="photo-item"]');
    if (!photo) return findGenericUrl(element);

    const link = photo.querySelector('a[href*="/photo/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findUnsplashUrl(element) {
    const photo = element.closest('figure, [data-test="photo-grid-single-column-figure"]');
    if (!photo) return findGenericUrl(element);

    const link = photo.querySelector('a[href*="/photos/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findPexelsUrl(element) {
    const photo = element.closest('[data-photo-modal-medium], article');
    if (!photo) return findGenericUrl(element);

    const link = photo.querySelector('a[href*="/photo/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findPixabayUrl(element) {
    const photo = element.closest('[data-id], .item');
    if (!photo) return findGenericUrl(element);

    const link = photo.querySelector('a[href*="/photos/"], a[href*="/illustrations/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findArtstationUrl(element) {
    const project = element.closest('.project, [data-project-id]');
    if (!project) return findGenericUrl(element);

    const link = project.querySelector('a[href*="/artwork/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findImgurUrl(element) {
    const post = element.closest('[id^="post-"], .Post');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/gallery/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findGiphyUrl(element) {
    const gif = element.closest('[data-giphy-id], .gif');
    if (!gif) return findGenericUrl(element);

    const link = gif.querySelector('a[href*="/gifs/"]');
    if (link?.href) return link.href;

    return null;
  }

  const image_designHandlers = {
    pinterest: findPinterestUrl,
    tumblr: findTumblrUrl,
    dribbble: findDribbbleUrl,
    behance: findBehanceUrl,
    deviantart: findDeviantartUrl,
    flickr: findFlickrUrl,
    '500px': find500pxUrl,
    unsplash: findUnsplashUrl,
    pexels: findPexelsUrl,
    pixabay: findPixabayUrl,
    artstation: findArtstationUrl,
    imgur: findImgurUrl,
    giphy: findGiphyUrl
  };

  /**
   * Learning URL Handlers
   * URL detection for learning platforms
   */


  function findCourseraUrl(element) {
    const course = element.closest('[data-e2e="CourseCard"], .CourseCard');
    if (!course) return findGenericUrl(element);

    const link = course.querySelector('a[href*="/learn/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findUdemyUrl(element) {
    const course = element.closest('[data-purpose="course-card"]');
    if (!course) return findGenericUrl(element);

    const link = course.querySelector('a[href*="/course/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findEdXUrl(element) {
    const course = element.closest('.course-card, [data-course-id]');
    if (!course) return findGenericUrl(element);

    const link = course.querySelector('a[href*="/course/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findKhanAcademyUrl(element) {
    const item = element.closest('[data-test-id], .link-item');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/math/"], a[href*="/science/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findSkillshareUrl(element) {
    const classCard = element.closest('[data-class-id], .class-card');
    if (!classCard) return findGenericUrl(element);

    const link = classCard.querySelector('a[href*="/classes/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findPluralsightUrl(element) {
    const course = element.closest('[data-course-id], .course-card');
    if (!course) return findGenericUrl(element);

    const link = course.querySelector('a[href*="/courses/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findUdacityUrl(element) {
    const course = element.closest('[data-testid="catalog-card"]');
    if (!course) return findGenericUrl(element);

    const link = course.querySelector('a[href*="/course/"]');
    if (link?.href) return link.href;

    return null;
  }

  const learningHandlers = {
    coursera: findCourseraUrl,
    udemy: findUdemyUrl,
    edX: findEdXUrl,
    khanAcademy: findKhanAcademyUrl,
    skillshare: findSkillshareUrl,
    pluralsight: findPluralsightUrl,
    udacity: findUdacityUrl
  };

  /**
   * News Discussion URL Handlers
   * URL detection for news discussion platforms
   */


  function findHackerNewsUrl(element) {
    const row = element.closest('.athing');
    if (!row) return findGenericUrl(element);

    const link = row.querySelector('a.titlelink, .storylink');
    if (link?.href) return link.href;

    return null;
  }

  function findProductHuntUrl(element) {
    const item = element.closest('[data-test="post-item"]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/posts/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findQuoraUrl(element) {
    const question = element.closest('[data-scroll-id], .q-box');
    if (!question) return findGenericUrl(element);

    const link = question.querySelector('a[href*="/q/"], a[href*="/question/"], a.question_link');
    if (link?.href) return link.href;

    return null;
  }

  function findDiscordUrl(element) {
    const message = element.closest('[id^="chat-messages-"], .message');
    if (!message) return findGenericUrl(element);

    const link = message.querySelector('a[href]');
    if (link?.href) return link.href;

    return null;
  }

  function findSlackUrl(element) {
    const message = element.closest('[data-qa="message_container"]');
    if (!message) return findGenericUrl(element);

    const link = message.querySelector('a[href*="/archives/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findLobstersUrl(element) {
    const story = element.closest('.story');
    if (!story) return findGenericUrl(element);

    const link = story.querySelector('a.u-url');
    if (link?.href) return link.href;

    return null;
  }

  function findGoogleNewsUrl(element) {
    const article = element.closest('article, [data-n-tid]');
    if (!article) return findGenericUrl(element);

    const link = article.querySelector('a[href*="./articles/"], h3 a, h4 a');
    if (link?.href) return link.href;

    return null;
  }

  function findFeedlyUrl(element) {
    const entry = element.closest('[data-entry-id], .entry');
    if (!entry) return findGenericUrl(element);

    const link = entry.querySelector('a.entry__title');
    if (link?.href) return link.href;

    return null;
  }

  const news_discussionHandlers = {
    hackerNews: findHackerNewsUrl,
    productHunt: findProductHuntUrl,
    quora: findQuoraUrl,
    discord: findDiscordUrl,
    slack: findSlackUrl,
    lobsters: findLobstersUrl,
    googleNews: findGoogleNewsUrl,
    feedly: findFeedlyUrl
  };

  /**
   * Other URL Handlers
   * URL detection for other platforms
   */


  function findArchiveOrgUrl(element) {
    const item = element.closest('.item-ia, [data-id]');
    if (!item) return findGenericUrl(element);

    const link = item.querySelector('a[href*="/details/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findPatreonUrl(element) {
    const post = element.closest('[data-tag="post-card"]');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/posts/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findKoFiUrl(element) {
    const post = element.closest('.feed-item, [data-post-id]');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/post/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findBuyMeACoffeeUrl(element) {
    const post = element.closest('.feed-card');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/p/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findGumroadUrl(element) {
    const product = element.closest('[data-permalink], .product-card');
    if (!product) return findGenericUrl(element);

    const link = product.querySelector('a[href*="gumroad.com/"]');
    if (link?.href) return link.href;

    return null;
  }

  const otherHandlers = {
    archiveOrg: findArchiveOrgUrl,
    patreon: findPatreonUrl,
    koFi: findKoFiUrl,
    buyMeACoffee: findBuyMeACoffeeUrl,
    gumroad: findGumroadUrl
  };

  /**
   * Social Media URL Handlers
   * URL detection for social media platforms
   */


  function findTwitterUrl(element) {
    debug('=== TWITTER URL FINDER ===');
    debug('Hovered element: ' + element.tagName + ' - ' + element.className);

    if (element && element.href) {
      debug(`URL found directly from hovered element: ${element.href}`);
      return element.href;
    }

    debug('No Twitter URL found on the provided element.');
    return null;
  }

  function findRedditUrl(element) {
    const post = element.closest(
      '[data-testid="post-container"], .Post, .post-container, [role="article"]'
    );
    if (!post) return findGenericUrl(element);

    const titleLink = post.querySelector(
      'a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a'
    );
    if (titleLink?.href) return titleLink.href;

    return null;
  }

  function findLinkedInUrl(element) {
    const post = element.closest('[data-id], .feed-shared-update-v2, [data-test="activity-item"]');
    if (!post) return findGenericUrl(element);

    const links = post.querySelectorAll('a[href]');
    for (const link of links) {
      const url = link.href;
      if (url.includes('/feed/') || url.includes('/posts/')) return url;
    }

    return null;
  }

  function findInstagramUrl(element) {
    const post = element.closest('[role="article"], article');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/p/"], a[href*="/reel/"], time a');
    if (link?.href) return link.href;

    return null;
  }

  function findFacebookUrl(element) {
    const post = element.closest('[role="article"], [data-testid="post"]');
    if (!post) return findGenericUrl(element);

    const links = post.querySelectorAll(
      'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]'
    );
    if (links.length > 0) return links[0].href;

    return null;
  }

  function findTikTokUrl(element) {
    const video = element.closest('[data-e2e="user-post-item"], .video-feed-item');
    if (!video) return findGenericUrl(element);

    const link = video.querySelector('a[href*="/@"]');
    if (link?.href) return link.href;

    return null;
  }

  function findThreadsUrl(element) {
    const post = element.closest('[role="article"]');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/t/"], time a');
    if (link?.href) return link.href;

    return null;
  }

  function findBlueskyUrl(element) {
    const post = element.closest('[data-testid="postThreadItem"], [role="article"]');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a[href*="/post/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findMastodonUrl(element) {
    const post = element.closest('.status, [data-id]');
    if (!post) return findGenericUrl(element);

    const link = post.querySelector('a.status__relative-time, a.detailed-status__datetime');
    if (link?.href) return link.href;

    return null;
  }

  function findSnapchatUrl(element) {
    const story = element.closest('[role="article"], .Story');
    if (!story) return findGenericUrl(element);

    const link = story.querySelector('a[href*="/add/"], a[href*="/spotlight/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findWhatsappUrl(_element) {
    // WhatsApp Web doesn't use traditional links - it's a single-page app
    // The current chat/conversation URL is the most relevant URL to copy
    return window.location.href;
  }

  function findTelegramUrl(element) {
    const message = element.closest('.message, [data-mid]');
    if (!message) return findGenericUrl(element);

    const link = message.querySelector('a[href*="t.me"]');
    if (link?.href) return link.href;

    return null;
  }

  const social_mediaHandlers = {
    twitter: findTwitterUrl,
    reddit: findRedditUrl,
    linkedIn: findLinkedInUrl,
    instagram: findInstagramUrl,
    facebook: findFacebookUrl,
    tikTok: findTikTokUrl,
    threads: findThreadsUrl,
    bluesky: findBlueskyUrl,
    mastodon: findMastodonUrl,
    snapchat: findSnapchatUrl,
    whatsapp: findWhatsappUrl,
    telegram: findTelegramUrl
  };

  /**
   * Video URL Handlers
   * URL detection for video platforms
   */


  function findYouTubeUrl(element) {
    const videoCard = element.closest(
      'ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]'
    );
    if (!videoCard) return findGenericUrl(element);

    const thumbnailLink = videoCard.querySelector('a#thumbnail[href*="watch?v="]');
    if (thumbnailLink?.href) return thumbnailLink.href;

    const watchLink = videoCard.querySelector('a[href*="watch?v="]');
    if (watchLink?.href) return watchLink.href;

    return null;
  }

  function findVimeoUrl(element) {
    const video = element.closest('[data-clip-id], .clip_grid_item');
    if (!video) return findGenericUrl(element);

    const link = video.querySelector('a[href*="/video/"], a[href*="vimeo.com/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findDailyMotionUrl(element) {
    const video = element.closest('[data-video], .sd_video_item');
    if (!video) return findGenericUrl(element);

    const link = video.querySelector('a[href*="/video/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findTwitchUrl(element) {
    const stream = element.closest('[data-a-target="video-card"], .video-card');
    if (!stream) return findGenericUrl(element);

    const link = stream.querySelector('a[href*="/videos/"], a[href*="/clip/"]');
    if (link?.href) return link.href;

    return null;
  }

  function findRumbleUrl(element) {
    const video = element.closest('.video-item, [data-video]');
    if (!video) return findGenericUrl(element);

    const link = video.querySelector('a[href*=".html"]');
    if (link?.href) return link.href;

    return null;
  }

  function findOdyseeUrl(element) {
    const video = element.closest('.claim-preview, [data-id]');
    if (!video) return findGenericUrl(element);

    const link = video.querySelector('a[href*="/@"]');
    if (link?.href) return link.href;

    return null;
  }

  function findBitchuteUrl(element) {
    const video = element.closest('.video-card, .channel-videos-container');
    if (!video) return findGenericUrl(element);

    const link = video.querySelector('a[href*="/video/"]');
    if (link?.href) return link.href;

    return null;
  }

  const videoHandlers = {
    youTube: findYouTubeUrl,
    vimeo: findVimeoUrl,
    dailyMotion: findDailyMotionUrl,
    twitch: findTwitchUrl,
    rumble: findRumbleUrl,
    odysee: findOdyseeUrl,
    bitchute: findBitchuteUrl
  };

  /**
   * URL Handler Registry
   * Main entry point for URL detection across all supported sites
   */


  /**
   * URL Handler Registry
   * Manages URL detection for all supported sites
   */
  class URLHandlerRegistry {
    constructor() {
      // Merge all handler categories
      this.handlers = {
        ...social_mediaHandlers,
        ...videoHandlers,
        ...developerHandlers,
        ...bloggingHandlers,
        ...ecommerceHandlers,
        ...image_designHandlers,
        ...news_discussionHandlers,
        ...entertainmentHandlers,
        ...gamingHandlers,
        ...learningHandlers,
        ...otherHandlers
      };
    }

    /**
     * Find URL for an element based on domain type
     * @param {Element} element - DOM element
     * @param {string} domainType - Domain type (e.g., 'twitter', 'github')
     * @returns {string|null} Found URL or null
     */
    findURL(element, domainType) {
      // Try direct link first
      if (element.tagName === 'A' && element.href) {
        return element.href;
      }

      // Check parents for href (up to 20 levels)
      let parent = element.parentElement;
      for (let i = 0; i < 20; i++) {
        if (!parent) break;
        if (parent.tagName === 'A' && parent.href) {
          return parent.href;
        }
        parent = parent.parentElement;
      }

      // Try site-specific handler
      if (this.handlers[domainType]) {
        const url = this.handlers[domainType](element);
        if (url) return url;
      }

      // Final fallback - find ANY link
      return findGenericUrl(element);
    }

    /**
     * Get all supported domain types
     * @returns {string[]} Array of supported domain types
     */
    getSupportedDomains() {
      return Object.keys(this.handlers);
    }

    /**
     * Check if a domain type is supported
     * @param {string} domainType - Domain type to check
     * @returns {boolean} True if supported
     */
    isSupported(domainType) {
      // Use 'in' operator instead of hasOwnProperty (ESLint compliant)
      return domainType in this.handlers;
    }
  }

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
   */


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

  console.log('[Copy-URL-on-Hover] All module imports completed successfully');

  // Initialize core systems
  console.log('[Copy-URL-on-Hover] Initializing core systems...');
  const configManager = new ConfigManager();
  console.log('[Copy-URL-on-Hover] ConfigManager initialized');
  const stateManager = new StateManager$1();
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
  async function initializeFeatures() {
    console.log('[Copy-URL-on-Hover] STEP: Initializing feature modules...');

    // Quick Tabs feature
    try {
      quickTabsManager = await initQuickTabs(eventBus, Events);
      console.log('[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized');
    } catch (qtErr) {
      console.error('[Copy-URL-on-Hover] ERROR: Failed to initialize Quick Tabs:', qtErr);
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
   */
  (async function initExtension() {
    try {
      console.log('[Copy-URL-on-Hover] STEP: Starting extension initialization...');

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
   * Set up hover detection
   */
  function setupHoverDetection() {
    document.addEventListener('mouseover', event => {
      const domainType = getDomainType();
      const element = event.target;

      // Find URL using the modular URL registry
      const url = urlRegistry.findURL(element, domainType);

      // Always set element, URL can be null
      stateManager.setState({
        currentHoveredLink: url || null, // Set to null if not found
        currentHoveredElement: element
      });

      if (url) {
        eventBus.emit(Events.HOVER_START, { url, element, domainType });
      }
    });

    document.addEventListener('mouseout', _event => {
      stateManager.setState({
        currentHoveredLink: null,
        currentHoveredElement: null
      });

      eventBus.emit(Events.HOVER_END);
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
      !checkShortcut(
        event,
        CONFIG[keyConfig],
        CONFIG[ctrlConfig],
        CONFIG[altConfig],
        CONFIG[shiftConfig]
      )
    ) {
      return false;
    }

    // Check prerequisites
    if (shortcut.needsLink && !hoveredLink) return false;
    if (shortcut.needsElement && !hoveredElement) return false;

    return true;
  }

  /**
   * v1.6.0 Phase 2.4 - Extracted handler for keyboard shortcuts
   * Reduced complexity and nesting using table-driven pattern with guard clauses
   */
  async function handleKeyboardShortcut(event) {
    // Ignore if typing in an interactive field
    if (isInputField(event.target)) return;

    const hoveredLink = stateManager.get('currentHoveredLink');
    const hoveredElement = stateManager.get('currentHoveredElement');

    // Check each shortcut using table-driven approach
    for (const shortcut of SHORTCUT_HANDLERS) {
      if (!matchesShortcut(event, shortcut, hoveredLink, hoveredElement)) continue;

      event.preventDefault();
      await shortcut.handler(hoveredLink, hoveredElement);
      return;
    }
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
  function checkShortcut(event, key, needCtrl, needAlt, needShift) {
    return (
      event.key.toLowerCase() === key.toLowerCase() &&
      event.ctrlKey === needCtrl &&
      event.altKey === needAlt &&
      event.shiftKey === needShift
    );
  }

  /**
   * Handle copy URL action
   */
  async function handleCopyURL(url) {
    try {
      const success = await copyToClipboard(url);

      if (success) {
        eventBus.emit(Events.URL_COPIED, { url });
        showNotification('✓ URL copied!', 'success');
        debug('Copied URL:', url);
      } else {
        showNotification('✗ Failed to copy URL', 'error');
      }
    } catch (err) {
      console.error('[Copy URL] Failed:', err);
      showNotification('✗ Failed to copy URL', 'error');
    }
  }

  /**
   * Handle copy text action
   */
  async function handleCopyText(element) {
    try {
      const text = getLinkText(element);
      const success = await copyToClipboard(text);

      if (success) {
        eventBus.emit(Events.TEXT_COPIED, { text });
        showNotification('✓ Text copied!', 'success');
        debug('Copied text:', text);
      } else {
        showNotification('✗ Failed to copy text', 'error');
      }
    } catch (err) {
      console.error('[Copy Text] Failed:', err);
      showNotification('✗ Failed to copy text', 'error');
    }
  }

  /**
   * Handle create Quick Tab action
   */
  /**
   * v1.6.0 Phase 2.4 - Extracted helper for Quick Tab data structure
   */
  function buildQuickTabData(url, quickTabId, position, width, height, title) {
    return {
      id: quickTabId,
      url,
      left: position.left,
      top: position.top,
      width,
      height,
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
    const quickTabData = buildQuickTabData(url, quickTabId, position, width, height, title);

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
   * v1.6.0 - Helper function to handle Quick Tabs panel toggle
   * Extracted to meet max-depth=2 ESLint requirement
   *
   * @param {Function} sendResponse - Response callback from message listener
   */
  function _handleQuickTabsPanelToggle(sendResponse) {
    console.log('[Content] Received TOGGLE_QUICK_TABS_PANEL request');

    try {
      // Guard: Quick Tabs manager not initialized
      if (!quickTabsManager) {
        console.error('[Content] Quick Tabs manager not initialized');
        sendResponse({
          success: false,
          error: 'Quick Tabs manager not initialized'
        });
        return;
      }

      // Guard: Panel manager not available
      if (!quickTabsManager.panelManager) {
        console.error('[Content] Quick Tabs panel manager not available');
        sendResponse({
          success: false,
          error: 'Panel manager not available'
        });
        return;
      }

      // Toggle the panel
      quickTabsManager.panelManager.toggle();
      console.log('[Content] ✓ Quick Tabs panel toggled successfully');

      sendResponse({ success: true });
    } catch (error) {
      console.error('[Content] Error toggling Quick Tabs panel:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  // ==================== LOG EXPORT MESSAGE HANDLER ====================
  // Listen for log export requests from popup
  if (typeof browser !== 'undefined' && browser.runtime) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'GET_CONTENT_LOGS') {
        console.log('[Content] Received GET_CONTENT_LOGS request');

        try {
          // ✅ NEW: Get logs from console interceptor (captures ALL console calls)
          const consoleLogs = getConsoleLogs();

          // ✅ NEW: Also get logs from debug.js (if any code uses debug() functions)
          const debugLogs = getLogBuffer();

          // ✅ NEW: Merge both sources
          const allLogs = [...consoleLogs, ...debugLogs];

          // Sort by timestamp
          allLogs.sort((a, b) => a.timestamp - b.timestamp);

          console.log(`[Content] Sending ${allLogs.length} logs to popup`);
          console.log(
            `[Content] Console logs: ${consoleLogs.length}, Debug logs: ${debugLogs.length}`
          );

          // ✅ NEW: Get buffer stats for debugging
          const stats = getBufferStats();
          console.log('[Content] Buffer stats:', stats);

          sendResponse({
            logs: allLogs,
            stats: stats
          });
        } catch (error) {
          console.error('[Content] Error getting log buffer:', error);
          sendResponse({ logs: [], error: error.message });
        }

        return true; // Keep message channel open for async response
      }

      if (message.action === 'CLEAR_CONTENT_LOGS') {
        try {
          clearConsoleLogs();
          clearLogBuffer();
          sendResponse({ success: true, clearedAt: Date.now() });
        } catch (error) {
          console.error('[Content] Error clearing log buffer:', error);
          sendResponse({ success: false, error: error.message });
        }

        return true;
      }

      // ==================== QUICK TABS PANEL TOGGLE HANDLER ====================
      // v1.6.0 - Added to support keyboard shortcut (Ctrl+Alt+Z)
      // Refactored with early returns to meet max-depth=2 requirement
      if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
        _handleQuickTabsPanelToggle(sendResponse);
        return true; // Keep message channel open for async response
      }
      // ==================== END QUICK TABS PANEL TOGGLE HANDLER ====================
    });
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

})(browser);
//# sourceMappingURL=content.js.map
