/**
 * EventBus - FIFO-guaranteed event emitter using native EventTarget
 *
 * Replaces EventEmitter3 with native browser API that guarantees
 * listener execution order (first-registered-first-fired).
 *
 * This fixes Issue #3 (race conditions) by ensuring deterministic
 * listener execution order.
 *
 * @example
 * const eventBus = new EventBus();
 * eventBus.on('state:changed', (data) => console.log('Handler 1', data));
 * eventBus.on('state:changed', (data) => console.log('Handler 2', data));
 * eventBus.emit('state:changed', { minimized: true }); // Handler 1, then Handler 2 (FIFO)
 *
 * @version 1.6.3.8-v11 - Phase 7: Replace EventEmitter3 with native EventTarget
 */

// Check if DEBUG_EVENTBUS is enabled (for development diagnostics)
const isDebugEnabled = () => globalThis.DEBUG_EVENTBUS === true;

/**
 * EventBus class - FIFO-guaranteed event emitter
 *
 * Uses native EventTarget for guaranteed listener execution order.
 * Provides EventEmitter3-compatible API for drop-in replacement.
 *
 * @extends EventTarget
 */
export class EventBus extends EventTarget {
  /**
   * Create a new EventBus instance
   * @param {string} [name='EventBus'] - Name for this event bus (for debugging)
   */
  constructor(name = 'EventBus') {
    super();
    this._name = name;
    this._listenerCount = new Map(); // Track listener counts by event type
    this._listenerMap = new Map(); // Store listeners for removal

    if (isDebugEnabled()) {
      console.log(`[${this._name}] Initialized with FIFO-guaranteed EventTarget`);
    }
  }

  /**
   * Register an event listener (EventEmitter3-compatible API)
   * @param {string} eventType - The event type to listen for
   * @param {Function} handler - The handler function
   * @returns {this} - For chaining
   */
  on(eventType, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    // Create wrapper that extracts event.detail
    const wrapper = event => {
      try {
        handler(event.detail);
      } catch (error) {
        console.error(`[${this._name}] Handler error for "${eventType}":`, error);
      }
    };

    // Store mapping for removal
    if (!this._listenerMap.has(handler)) {
      this._listenerMap.set(handler, new Map());
    }
    this._listenerMap.get(handler).set(eventType, wrapper);

    // Add listener
    this.addEventListener(eventType, wrapper);

    // Update count
    const count = (this._listenerCount.get(eventType) || 0) + 1;
    this._listenerCount.set(eventType, count);

    return this;
  }

  /**
   * Register a one-time event listener
   * @param {string} eventType - The event type to listen for
   * @param {Function} handler - The handler function
   * @returns {this} - For chaining
   */
  once(eventType, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    // Create a wrapper that removes itself before calling the handler
    const onceWrapper = detail => {
      // Remove the wrapper from the listener map using itself as key
      this.off(eventType, onceWrapper);
      handler(detail);
    };

    // The wrapper uses itself as the key in listenerMap via on()
    // We don't need _originalHandler for self-removal
    return this.on(eventType, onceWrapper);
  }

  /**
   * Remove an event listener (EventEmitter3-compatible API)
   * @param {string} eventType - The event type
   * @param {Function} handler - The handler to remove
   * @returns {this} - For chaining
   */
  off(eventType, handler) {
    // The handler itself is the key in listenerMap
    const handlerMap = this._listenerMap.get(handler);
    if (!handlerMap) return this;

    const wrapper = handlerMap.get(eventType);
    if (!wrapper) return this;

    // Remove listener
    this.removeEventListener(eventType, wrapper);

    // Clean up maps
    handlerMap.delete(eventType);
    if (handlerMap.size === 0) {
      this._listenerMap.delete(handler);
    }

    // Update count
    const count = (this._listenerCount.get(eventType) || 1) - 1;
    if (count <= 0) {
      this._listenerCount.delete(eventType);
    } else {
      this._listenerCount.set(eventType, count);
    }

    return this;
  }

  /**
   * Emit an event (EventEmitter3-compatible API)
   * @param {string} eventType - The event type to emit
   * @param {*} detail - Data to pass to listeners
   * @returns {boolean} - True if there were listeners
   */
  emit(eventType, detail) {
    const hasListeners = (this._listenerCount.get(eventType) || 0) > 0;

    const event = new CustomEvent(eventType, {
      detail,
      bubbles: false,
      cancelable: false
    });

    this.dispatchEvent(event);

    return hasListeners;
  }

  /**
   * Remove all listeners for an event type (or all events)
   * @param {string} [eventType] - Optional event type to clear
   * @returns {this} - For chaining
   */
  removeAllListeners(eventType) {
    if (eventType) {
      this._removeListenersForEventType(eventType);
    } else {
      this._removeAllListenersFromAllTypes();
    }

    return this;
  }

  /**
   * Remove listeners for a specific event type
   * @private
   * @param {string} eventType - The event type to clear listeners for
   */
  _removeListenersForEventType(eventType) {
    for (const [handler, handlerMap] of this._listenerMap) {
      if (!handlerMap.has(eventType)) continue;

      const wrapper = handlerMap.get(eventType);
      this.removeEventListener(eventType, wrapper);
      handlerMap.delete(eventType);

      if (handlerMap.size === 0) {
        this._listenerMap.delete(handler);
      }
    }
    this._listenerCount.delete(eventType);
  }

  /**
   * Remove all listeners from all event types
   * @private
   */
  _removeAllListenersFromAllTypes() {
    for (const [, handlerMap] of this._listenerMap) {
      for (const [type, wrapper] of handlerMap) {
        this.removeEventListener(type, wrapper);
      }
    }
    this._listenerMap.clear();
    this._listenerCount.clear();
  }

  /**
   * Get listener count for an event type
   * @param {string} eventType - The event type
   * @returns {number} - Number of listeners
   */
  listenerCount(eventType) {
    return this._listenerCount.get(eventType) || 0;
  }

  /**
   * Get all event types that have listeners
   * @returns {string[]} - Array of event types
   */
  eventNames() {
    return Array.from(this._listenerCount.keys());
  }

  /**
   * Alias for on() - EventEmitter3 compatibility
   * @param {string} eventType - The event type to listen for
   * @param {Function} handler - The handler function
   * @returns {this} - For chaining
   */
  addListener(eventType, handler) {
    return this.on(eventType, handler);
  }

  /**
   * Alias for off() - EventEmitter3 compatibility
   * @param {string} eventType - The event type
   * @param {Function} handler - The handler to remove
   * @returns {this} - For chaining
   */
  removeListener(eventType, handler) {
    return this.off(eventType, handler);
  }

  /**
   * Get debug info about the event bus state
   * @returns {Object} Debug information
   */
  getDebugInfo() {
    return {
      name: this._name,
      eventTypes: this.eventNames(),
      listenerCounts: Object.fromEntries(this._listenerCount)
    };
  }
}

/**
 * Create a named EventBus instance
 * @param {string} name - Name for the event bus (for debugging)
 * @returns {EventBus}
 */
export function createEventBus(name) {
  return new EventBus(name);
}

/**
 * Global event bus singleton (replaces EventEmitter3 global instance)
 * @type {EventBus|null}
 */
let globalEventBus = null;

/**
 * Get the global event bus singleton
 * Creates it if it doesn't exist yet.
 * @returns {EventBus}
 */
export function getGlobalEventBus() {
  if (!globalEventBus) {
    globalEventBus = new EventBus('GlobalEventBus');
  }
  return globalEventBus;
}

/**
 * Reset global event bus (for testing)
 * Clears all listeners and recreates the singleton.
 */
export function resetGlobalEventBus() {
  if (globalEventBus) {
    globalEventBus.removeAllListeners();
  }
  globalEventBus = null;
}

// Default export for drop-in replacement
export default EventBus;
