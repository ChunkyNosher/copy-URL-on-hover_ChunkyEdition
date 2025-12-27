/**
 * ReactiveQuickTab - Proxy-wrapped Quick Tab with automatic change detection
 * v1.6.2.1 - NEW: Reactive state management for Quick Tabs
 * v1.6.3.12 - Removed Solo/Mute functionality (always visible on all tabs)
 *
 * Features:
 * - Automatic change detection via Proxy
 * - Computed properties (isVisible)
 * - Validation (returns boolean, logs warnings - no exceptions)
 * - Watch API for reactive UI updates
 * - Computed property caching with dependency tracking
 *
 * Architecture:
 * QuickTab state → Proxy intercepts set/get → Triggers sync + watchers
 *
 * Performance:
 * - +1-3ms overhead per property assignment (negligible)
 * - Computed properties cached until dependencies change
 * - Deep proxy limited to MAX_PROXY_DEPTH levels
 */

/** @constant {number} Maximum depth for recursive proxy creation */
const MAX_PROXY_DEPTH = 3;

/**
 * @typedef {Object} ReactiveQuickTabData
 * @property {string} id - Unique identifier
 * @property {number} left - Left position
 * @property {number} top - Top position
 * @property {number} width - Width
 * @property {number} height - Height
 * @property {number} zIndex - Z-index for stacking
 * @property {boolean} minimized - Whether minimized
 * @property {string} [url] - URL of the Quick Tab
 * @property {string} [title] - Title of the Quick Tab
 * @property {string} [cookieStoreId] - Firefox container ID
 * @property {number} [createdAt] - Creation timestamp
 * @property {number} [lastModified] - Last modification timestamp
 */

export class ReactiveQuickTab {
  /**
   * Create a new ReactiveQuickTab instance
   * @param {ReactiveQuickTabData} data - Initial Quick Tab data
   * @param {Function|null} [onSync] - Callback when property changes: (id, prop, value) => void
   * @param {number|null} [currentTabId] - Current browser tab ID (for computed properties)
   */
  constructor(data, onSync = null, currentTabId = null) {
    if (!data || typeof data.id !== 'string') {
      throw new Error('ReactiveQuickTab requires data with a valid string id');
    }

    /** @type {string} */
    this.id = data.id;

    /** @type {Function|null} */
    this.onSync = onSync;

    /** @type {number|null} */
    this.currentTabId = currentTabId;

    // Internal data storage - normalize with defaults
    /** @private @type {ReactiveQuickTabData} */
    this._data = this._normalizeData(data);

    // Watchers: property → Set of callbacks
    /** @private @type {Map<string, Set<Function>>} */
    this._watchers = new Map();

    // Computed property cache
    /** @private @type {Map<string, any>} */
    this._computedCache = new Map();

    /** @private @type {Set<string>} */
    this._computedDirty = new Set();

    // Track dependencies: computed property → Set of data properties
    // v1.6.3.12 - Simplified: Only isVisible depends on minimized (Solo/Mute removed)
    /** @private @type {Map<string, Set<string>>} */
    this._dependencies = new Map();
    this._dependencies.set('isVisible', new Set(['minimized']));

    // Create reactive proxy
    /** @type {Proxy<ReactiveQuickTabData>} */
    this.state = this._createProxy(this._data, 0);
  }

  /**
   * Get number with default
   * @private
   */
  _getNumber(value, defaultValue) {
    return typeof value === 'number' ? value : defaultValue;
  }

  /**
   * Normalize data with defaults
   * v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   * @private
   * @param {Object} data - Raw data
   * @returns {ReactiveQuickTabData} - Normalized data
   */
  _normalizeData(data) {
    const now = Date.now();
    return {
      id: data.id,
      left: this._getNumber(data.left, 100),
      top: this._getNumber(data.top, 100),
      width: this._getNumber(data.width, 800),
      height: this._getNumber(data.height, 600),
      zIndex: this._getNumber(data.zIndex, 1000),
      minimized: typeof data.minimized === 'boolean' ? data.minimized : false,
      url: data.url || '',
      title: data.title || 'Quick Tab',
      cookieStoreId: data.cookieStoreId || 'firefox-default',
      createdAt: data.createdAt || now,
      lastModified: data.lastModified || now
    };
  }

  /**
   * Create recursive Proxy for reactivity
   * @private
   * @param {Object} target - Object to wrap
   * @param {number} depth - Current recursion depth
   * @returns {Proxy} - Proxied object
   */
  _createProxy(target, depth) {
    // Limit recursion depth to prevent performance issues
    if (depth >= MAX_PROXY_DEPTH) {
      return target;
    }

    const self = this;

    return new Proxy(target, {
      get(obj, prop) {
        // Handle computed properties
        if (self._isComputedProperty(prop)) {
          return self._getComputed(prop);
        }

        // Handle Symbol and internal properties
        if (typeof prop === 'symbol') {
          return obj[prop];
        }

        const value = obj[prop];

        // Recursively proxy nested plain objects (not arrays or special objects)
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !self._isSpecialObject(value)
        ) {
          return self._createProxy(value, depth + 1);
        }

        return value;
      },

      set(obj, prop, value) {
        // Handle Symbol properties
        if (typeof prop === 'symbol') {
          obj[prop] = value;
          return true;
        }

        const oldValue = obj[prop];

        // Skip if unchanged (deep equality for arrays)
        if (self._areEqual(oldValue, value)) {
          return true;
        }

        // Validate change (returns boolean, logs warning if invalid)
        if (!self._validate(prop, value)) {
          console.warn(`[ReactiveQuickTab] Invalid value for ${prop}:`, value, '(ignoring)');
          return true; // Return true to prevent TypeError, but don't apply change
        }

        // Capture old computed values BEFORE changing data
        const oldComputedValues = self._captureAffectedComputedValues(prop);

        // Apply change
        obj[prop] = value;

        // Update lastModified
        if (prop !== 'lastModified') {
          obj.lastModified = Date.now();
        }

        // Invalidate computed properties that depend on this property
        self._invalidateComputed(prop, oldComputedValues);

        // Notify watchers
        self._notify(prop, oldValue, value);

        // Auto-sync to other tabs/contexts
        if (self.onSync) {
          try {
            self.onSync(self.id, prop, value);
          } catch (err) {
            console.error('[ReactiveQuickTab] onSync callback error:', err);
          }
        }

        return true;
      }
    });
  }

  /**
   * Check if two values are equal (supports arrays)
   * @private
   * @param {any} a - First value
   * @param {any} b - Second value
   * @returns {boolean} - True if equal
   */
  _areEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => val === b[i]);
    }
    return false;
  }

  /**
   * Check if object is a special object that shouldn't be proxied
   * @private
   * @param {any} value - Value to check
   * @returns {boolean} - True if special object
   */
  _isSpecialObject(value) {
    return (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Map ||
      value instanceof Set ||
      value instanceof WeakMap ||
      value instanceof WeakSet ||
      value instanceof Error
    );
  }

  /**
   * Validation rules for each property type
   * v1.6.3.12 - Removed tabArray validator (Solo/Mute removed)
   * @private
   */
  static _validators = {
    position: v => typeof v === 'number' && v >= 0 && v < 10000,
    size: v => typeof v === 'number' && v >= 100 && v < 5000,
    zIndex: v => typeof v === 'number' && v >= 0,
    boolean: v => typeof v === 'boolean',
    string: v => typeof v === 'string',
    timestamp: v => typeof v === 'number' && v >= 0
  };

  /**
   * Property to validator mapping
   * v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   * @private
   */
  static _validatorMap = {
    left: 'position',
    top: 'position',
    width: 'size',
    height: 'size',
    zIndex: 'zIndex',
    minimized: 'boolean',
    url: 'string',
    title: 'string',
    cookieStoreId: 'string',
    id: 'string',
    createdAt: 'timestamp',
    lastModified: 'timestamp'
  };

  /**
   * Validate property value (returns boolean, doesn't throw)
   * @private
   * @param {string} prop - Property name
   * @param {any} value - Value to validate
   * @returns {boolean} - True if valid
   */
  _validate(prop, value) {
    const validatorType = ReactiveQuickTab._validatorMap[prop];
    if (!validatorType) {
      return true; // Allow unknown properties
    }
    const validator = ReactiveQuickTab._validators[validatorType];
    return validator ? validator(value) : true;
  }

  /**
   * Check if property is computed
   * v1.6.3.12 - Simplified: Only isVisible (Solo/Mute removed)
   * @private
   * @param {string|symbol} prop - Property name
   * @returns {boolean} - True if computed
   */
  _isComputedProperty(prop) {
    return prop === 'isVisible';
  }

  /**
   * Get computed property value (with caching)
   * v1.6.3.12 - Simplified: Only isVisible (Solo/Mute removed)
   * @private
   * @param {string} prop - Computed property name
   * @returns {any} - Computed value
   */
  _getComputed(prop) {
    // Check cache first
    if (!this._computedDirty.has(prop) && this._computedCache.has(prop)) {
      return this._computedCache.get(prop);
    }

    let value;
    switch (prop) {
      case 'isVisible':
        value = this._computeVisibility();
        break;
      default:
        return undefined;
    }

    // Cache result
    this._computedCache.set(prop, value);
    this._computedDirty.delete(prop);

    return value;
  }

  /**
   * Compute visibility based on minimized state
   * v1.6.3.12 - Simplified: Only checks minimized (Solo/Mute removed)
   * @private
   * @returns {boolean} - True if visible
   */
  _computeVisibility() {
    const { minimized } = this._data;

    // Minimized = always hidden
    if (minimized) return false;

    // Global mode = always visible (Solo/Mute removed in v1.6.3.12)
    return true;
  }

  /**
   * Capture current values of computed properties affected by a property change
   * Call this BEFORE changing the data
   * @private
   * @param {string} changedProp - Property that will change
   * @returns {Map<string, any>} - Map of computed prop name to current value
   */
  _captureAffectedComputedValues(changedProp) {
    const capturedValues = new Map();

    for (const [computedProp, deps] of this._dependencies.entries()) {
      if (deps.has(changedProp)) {
        // Get current value (compute if not cached)
        const currentValue = this._computedCache.has(computedProp)
          ? this._computedCache.get(computedProp)
          : this._getComputed(computedProp);
        capturedValues.set(computedProp, currentValue);
      }
    }

    return capturedValues;
  }

  /**
   * Get old value for a computed property
   * @private
   */
  _getOldComputedValue(computedProp, oldComputedValues) {
    if (oldComputedValues.has(computedProp)) {
      return oldComputedValues.get(computedProp);
    }
    if (this._computedCache.has(computedProp)) {
      return this._computedCache.get(computedProp);
    }
    return undefined;
  }

  /**
   * Invalidate a single computed property
   * @private
   */
  _invalidateSingleComputed(computedProp, oldComputedValues) {
    const oldValue = this._getOldComputedValue(computedProp, oldComputedValues);

    // Invalidate cache
    this._computedDirty.add(computedProp);
    this._computedCache.delete(computedProp);

    // Compute new value
    const newValue = this._getComputed(computedProp);

    // Notify if changed
    if (oldValue !== newValue) {
      this._notify(computedProp, oldValue, newValue);
    }
  }

  /**
   * Invalidate computed properties that depend on changed property
   * @private
   * @param {string} changedProp - Property that changed
   * @param {Map<string, any>} oldComputedValues - Pre-captured old values from _captureAffectedComputedValues
   */
  _invalidateComputed(changedProp, oldComputedValues = new Map()) {
    for (const [computedProp, deps] of this._dependencies.entries()) {
      if (!deps.has(changedProp)) continue;
      this._invalidateSingleComputed(computedProp, oldComputedValues);
    }
  }

  /**
   * Notify watchers of property change
   * @private
   * @param {string} prop - Property name
   * @param {any} oldValue - Previous value
   * @param {any} newValue - New value
   */
  _notify(prop, oldValue, newValue) {
    const watchers = this._watchers.get(prop);
    if (!watchers || watchers.size === 0) return;

    for (const callback of watchers) {
      try {
        callback(newValue, oldValue);
      } catch (err) {
        console.error(`[ReactiveQuickTab] Watcher error for ${prop}:`, err);
      }
    }
  }

  /**
   * Watch property for changes
   * @param {string} prop - Property name (or computed property)
   * @param {Function} callback - (newValue, oldValue) => void
   * @returns {Function} - Unwatch function
   */
  watch(prop, callback) {
    if (typeof callback !== 'function') {
      throw new Error('ReactiveQuickTab.watch requires a callback function');
    }

    if (!this._watchers.has(prop)) {
      this._watchers.set(prop, new Set());
    }

    this._watchers.get(prop).add(callback);

    // Return unwatch function
    return () => {
      const watchers = this._watchers.get(prop);
      if (watchers) {
        watchers.delete(callback);
        if (watchers.size === 0) {
          this._watchers.delete(prop);
        }
      }
    };
  }

  /**
   * Serialize for storage (strip Proxy wrapper)
   * v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   * @returns {Object} - Plain object suitable for JSON serialization
   */
  toJSON() {
    return {
      id: this._data.id,
      left: this._data.left,
      top: this._data.top,
      width: this._data.width,
      height: this._data.height,
      zIndex: this._data.zIndex,
      minimized: this._data.minimized,
      url: this._data.url,
      title: this._data.title,
      cookieStoreId: this._data.cookieStoreId,
      createdAt: this._data.createdAt,
      lastModified: this._data.lastModified
    };
  }

  /**
   * Update current tab ID (for visibility computation)
   * v1.6.3.12 - Simplified: Only invalidates isVisible (Solo/Mute removed)
   * @param {number} tabId - New current tab ID
   */
  updateCurrentTabId(tabId) {
    if (typeof tabId !== 'number') {
      console.warn('[ReactiveQuickTab] updateCurrentTabId requires a number');
      return;
    }

    const oldTabId = this.currentTabId;
    if (oldTabId === tabId) {
      return; // No change
    }

    // Get old visibility BEFORE updating tabId
    const wasVisible = this._getComputed('isVisible');

    this.currentTabId = tabId;

    // Clear isVisible cache - need to recompute with new tabId
    this._computedCache.delete('isVisible');
    this._computedDirty.add('isVisible');

    // Compute new visibility
    const isVisible = this._getComputed('isVisible');

    // Notify watchers about visibility change if it changed
    if (wasVisible !== isVisible) {
      this._notify('isVisible', wasVisible, isVisible);
    }
  }

  /**
   * Destroy and clean up resources
   */
  destroy() {
    this._watchers.clear();
    this._computedCache.clear();
    this._computedDirty.clear();
    this.onSync = null;
  }
}
