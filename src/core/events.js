/**
 * Event Bus
 * Pub/sub event system for inter-module communication
 *
 * v1.6.3.11-v4 - FIX Issue #81: Added context scoping support
 *   - Each content script instance gets its own EventBus via createScopedEventBus()
 *   - Context ID prevents events from different contexts from interfering
 *   - Optional namespace prefix for event isolation
 */

/**
 * Global counter for generating unique context IDs
 * v1.6.3.11-v4 - FIX Issue #81: Ensure unique IDs across instances
 * @type {number}
 */
let _contextIdCounter = 0;

/**
 * Generate a unique context ID for EventBus scoping
 * v1.6.3.11-v4 - FIX Issue #81
 * @returns {string} Unique context ID
 */
function _generateContextId() {
  return `ctx-${Date.now()}-${++_contextIdCounter}`;
}

export class EventBus {
  /**
   * Create a new EventBus instance
   * v1.6.3.11-v4 - FIX Issue #81: Added contextId for scoping
   * @param {Object} options - Options
   * @param {string} [options.contextId] - Unique context ID for scoping
   * @param {string} [options.namespace] - Namespace prefix for events
   */
  constructor(options = {}) {
    this.events = new Map();
    this.debugMode = false;

    // v1.6.3.11-v4 - FIX Issue #81: Context scoping
    this.contextId = options.contextId || null;
    this.namespace = options.namespace || null;

    if (this.contextId) {
      console.log('[EventBus] Created with context:', {
        contextId: this.contextId,
        namespace: this.namespace
      });
    }
  }

  /**
   * Subscribe to an event
   * v1.6.3.11-v4 - FIX Issue #81: Uses scoped event names
   * @param {string} eventName - Event name
   * @param {function} callback - Callback function
   * @returns {function} Unsubscribe function
   */
  on(eventName, callback) {
    const scopedName = this._getScopedEventName(eventName);

    if (!this.events.has(scopedName)) {
      this.events.set(scopedName, []);
    }

    this.events.get(scopedName).push(callback);

    if (this.debugMode) {
      console.log(`[EventBus] Subscribed to "${scopedName}"`, {
        contextId: this.contextId
      });
    }

    // Return unsubscribe function
    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe from an event
   * v1.6.3.11-v4 - FIX Issue #81: Uses scoped event names
   * @param {string} eventName - Event name
   * @param {function} callback - Callback function
   */
  off(eventName, callback) {
    const scopedName = this._getScopedEventName(eventName);

    if (!this.events.has(scopedName)) return;

    const callbacks = this.events.get(scopedName);
    const index = callbacks.indexOf(callback);

    if (index !== -1) {
      callbacks.splice(index, 1);

      if (this.debugMode) {
        console.log(`[EventBus] Unsubscribed from "${scopedName}"`, {
          contextId: this.contextId
        });
      }
    }

    // Clean up empty event arrays
    if (callbacks.length === 0) {
      this.events.delete(scopedName);
    }
  }

  /**
   * Emit an event
   * v1.6.3.11-v4 - FIX Issue #81: Uses scoped event names
   * @param {string} eventName - Event name
   * @param {any} data - Event data
   */
  emit(eventName, data) {
    const scopedName = this._getScopedEventName(eventName);

    if (!this.events.has(scopedName)) return;

    if (this.debugMode) {
      console.log(`[EventBus] Emitting "${scopedName}"`, {
        contextId: this.contextId,
        data
      });
    }

    const callbacks = this.events.get(scopedName);
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[EventBus] Error in "${scopedName}" handler:`, err);
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
    const scopedName = this._getScopedEventName(eventName);
    return this.events.has(scopedName) ? this.events.get(scopedName).length : 0;
  }

  /**
   * Get scoped event name (with namespace prefix if configured)
   * v1.6.3.11-v4 - FIX Issue #81: Event name scoping
   * @private
   * @param {string} eventName - Original event name
   * @returns {string} Scoped event name
   */
  _getScopedEventName(eventName) {
    if (this.namespace) {
      return `${this.namespace}:${eventName}`;
    }
    return eventName;
  }

  /**
   * Get context ID of this EventBus
   * v1.6.3.11-v4 - FIX Issue #81
   * @returns {string|null} Context ID or null if not scoped
   */
  getContextId() {
    return this.contextId;
  }

  /**
   * Check if this EventBus is scoped (has a context ID)
   * v1.6.3.11-v4 - FIX Issue #81
   * @returns {boolean}
   */
  isScoped() {
    return this.contextId !== null;
  }
}

/**
 * Predefined event names for type safety and documentation
 */
export const Events = {
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
 * Create a scoped EventBus instance for a specific context
 * v1.6.3.11-v4 - FIX Issue #81: Factory function for scoped EventBus
 *
 * Each content script instance should call this to get its own EventBus
 * that won't interfere with EventBus instances in other contexts.
 *
 * @param {Object} options - Options
 * @param {string} [options.namespace] - Namespace prefix for events
 * @returns {EventBus} Scoped EventBus instance
 *
 * @example
 * // In content script initialization:
 * const eventBus = createScopedEventBus({ namespace: 'quicktabs' });
 */
export function createScopedEventBus(options = {}) {
  const contextId = _generateContextId();

  console.log('[EventBus] createScopedEventBus:', {
    contextId,
    namespace: options.namespace || null
  });

  return new EventBus({
    contextId,
    namespace: options.namespace || null
  });
}
