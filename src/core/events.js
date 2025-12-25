/**
 * Event Bus
 * Pub/sub event system for inter-module communication
 * 
 * v1.6.3.11-v10 - FIX Issue #12: Added singleton instance tracking with unique IDs
 *   Each EventBus instance gets a unique instanceId to detect instance mismatches
 *   Use getSharedEventBus() to get the singleton instance
 */

// v1.6.3.11-v10 - FIX Issue #12: Global instance counter for unique IDs
let _instanceCounter = 0;

// v1.6.3.11-v10 - FIX Issue #12: Singleton instance storage
let _sharedEventBus = null;

export class EventBus {
  constructor() {
    this.events = new Map();
    this.debugMode = false;
    // v1.6.3.11-v10 - FIX Issue #12: Assign unique instance ID for debugging
    this.instanceId = `eventbus-${++_instanceCounter}-${Date.now()}`;
    console.log(`[EventBus] Instance created: ${this.instanceId}`);
  }

  /**
   * Get the instance ID for debugging
   * v1.6.3.11-v10 - FIX Issue #12: Instance identity tracking
   * @returns {string} Unique instance identifier
   */
  getInstanceId() {
    return this.instanceId;
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

  /**
   * Validate that another EventBus is the same instance
   * v1.6.3.11-v10 - FIX Issue #12: Instance validation for debugging
   * @param {EventBus} otherEventBus - EventBus to compare
   * @returns {boolean} True if same instance
   */
  isSameInstance(otherEventBus) {
    if (!otherEventBus || typeof otherEventBus.getInstanceId !== 'function') {
      return false;
    }
    const isSame = this.instanceId === otherEventBus.getInstanceId();
    if (!isSame) {
      console.error('[EVENTBUS_MISMATCH] Different instances detected!', {
        thisInstance: this.instanceId,
        otherInstance: otherEventBus.getInstanceId()
      });
    }
    return isSame;
  }

  /**
   * Remove all listeners for all events
   * v1.6.3.11-v10 - Added for compatibility with eventemitter3 API
   */
  removeAllListeners() {
    this.events.clear();
    if (this.debugMode) {
      console.log('[EventBus] All listeners removed');
    }
  }
}

/**
 * Get or create the shared EventBus singleton instance
 * v1.6.3.11-v10 - FIX Issue #12: Provides a guaranteed singleton
 * @returns {EventBus} The shared EventBus instance
 */
export function getSharedEventBus() {
  if (!_sharedEventBus) {
    _sharedEventBus = new EventBus();
    console.log('[EventBus] Created shared singleton: ' + _sharedEventBus.instanceId);
  }
  return _sharedEventBus;
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
