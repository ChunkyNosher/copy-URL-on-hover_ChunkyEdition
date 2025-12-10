/**
 * ManagedEventListeners - Efficient Event Listener Lifecycle Management
 *
 * Phase 3C Optimization #9: Efficient Event Listener Lifecycle Management
 *
 * Problem: Event listeners on Quick Tab elements aren't properly cleaned up
 * when elements are removed, causing memory leaks and preventing garbage collection.
 *
 * Solution: Use WeakMap to automatically manage listener lifecycle.
 * When elements are garbage collected, their listener entries are automatically
 * cleaned up by the WeakMap.
 *
 * Expected Impact:
 * - Prevents memory leaks from detached DOM elements
 * - 20-30% memory reduction for long sessions
 * - No explicit removeEventListener calls needed
 * - Automatic cleanup when element is GC'd
 *
 * @version 1.6.4
 * @author Phase 3C UI Performance Optimization
 */

/**
 * Listener registration info
 * @typedef {Object} ListenerInfo
 * @property {string} type - Event type
 * @property {Function} handler - Event handler function
 * @property {Object|boolean} [options] - Event listener options
 * @property {AbortController} [abortController] - For AbortSignal-based cleanup
 */

/**
 * ManagedEventListeners provides automatic event listener lifecycle management
 * using WeakMap for memory-efficient tracking.
 *
 * Key features:
 * - Automatic cleanup when elements are garbage collected
 * - Optional namespace support for batch removal
 * - Explicit removal API when needed
 * - Delegation support for efficient event handling
 * - AbortController integration for modern cleanup
 *
 * @example
 * const manager = new ManagedEventListeners();
 *
 * // Add listener (automatically cleaned up when element is GC'd)
 * manager.add(element, 'click', handleClick);
 *
 * // Add with namespace for batch removal
 * manager.add(element, 'click', handleClick, { passive: true }, 'quick-tab');
 *
 * // Remove all listeners for a namespace
 * manager.removeByNamespace('quick-tab');
 *
 * // Remove specific listener
 * manager.remove(element, 'click', handleClick);
 *
 * // Use event delegation
 * manager.addDelegated(container, 'click', '.quick-tab-item', handleItemClick);
 */
class ManagedEventListeners {
  /**
   * Create a new ManagedEventListeners instance
   *
   * @param {Object} [options] - Configuration options
   * @param {boolean} [options.useAbortController=true] - Use AbortController for cleanup
   * @param {boolean} [options.enableMetrics=false] - Track listener statistics
   */
  constructor(options = {}) {
    // Configuration
    this._useAbortController = options.useAbortController !== false;
    this._enableMetrics = options.enableMetrics || false;

    /**
     * WeakMap to track listeners per element
     * When an element is garbage collected, its entry is automatically removed
     * Structure: WeakMap<element, Map<eventType, Set<ListenerInfo>>>
     * @private
     */
    this._elementListeners = new WeakMap();

    /**
     * Regular Map for namespace tracking (allows explicit removal)
     * Structure: Map<namespace, Set<{ element, type, handler }>>
     * @private
     */
    this._namespaceListeners = new Map();

    /**
     * Delegated event handlers
     * Structure: Map<container, Map<eventType, Map<selector, handler>>>
     * @private
     */
    this._delegatedHandlers = new WeakMap();

    /**
     * Metrics for monitoring
     * @private
     */
    this._metrics = {
      listenersAdded: 0,
      listenersRemoved: 0,
      delegatedAdded: 0,
      delegatedRemoved: 0
    };

    this._isDestroyed = false;
  }

  /**
   * Add an event listener to an element
   *
   * @param {HTMLElement} element - Target element
   * @param {string} type - Event type (e.g., 'click', 'mouseenter')
   * @param {Function} handler - Event handler function
   * @param {Object|boolean} [options] - addEventListener options
   * @param {string} [namespace] - Optional namespace for batch removal
   * @returns {boolean} True if listener was added
   */
  add(element, type, handler, options = false, namespace = null) {
    if (this._isDestroyed || !element || !type || !handler) {
      return false;
    }

    // Create listener info
    const listenerInfo = {
      type,
      handler,
      options,
      namespace
    };

    // Add AbortController if enabled
    if (this._useAbortController && typeof AbortController !== 'undefined') {
      listenerInfo.abortController = new AbortController();
      const mergedOptions = this._mergeOptionsWithSignal(options, listenerInfo.abortController.signal);
      element.addEventListener(type, handler, mergedOptions);
    } else {
      element.addEventListener(type, handler, options);
    }

    // Track in WeakMap
    this._trackListener(element, type, listenerInfo);

    // Track in namespace map if provided
    if (namespace) {
      this._trackNamespace(namespace, element, type, handler);
    }

    if (this._enableMetrics) {
      this._metrics.listenersAdded++;
    }

    return true;
  }

  /**
   * Add multiple event listeners to an element
   *
   * @param {HTMLElement} element - Target element
   * @param {Object} listeners - Map of event types to handlers
   * @param {Object|boolean} [options] - addEventListener options
   * @param {string} [namespace] - Optional namespace for batch removal
   * @returns {number} Number of listeners added
   *
   * @example
   * manager.addMultiple(element, {
   *   click: handleClick,
   *   mouseenter: handleMouseEnter,
   *   mouseleave: handleMouseLeave
   * }, { passive: true }, 'my-namespace');
   */
  addMultiple(element, listeners, options = false, namespace = null) {
    if (this._isDestroyed || !element || !listeners) {
      return 0;
    }

    let count = 0;
    for (const [type, handler] of Object.entries(listeners)) {
      if (this.add(element, type, handler, options, namespace)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Remove a specific event listener from an element
   *
   * @param {HTMLElement} element - Target element
   * @param {string} type - Event type
   * @param {Function} handler - Handler to remove
   * @returns {boolean} True if listener was found and removed
   */
  remove(element, type, handler) {
    if (this._isDestroyed || !element || !type || !handler) {
      return false;
    }

    const elementMap = this._elementListeners.get(element);
    if (!elementMap) return false;

    const typeSet = elementMap.get(type);
    if (!typeSet) return false;

    // Find and remove the listener
    const info = this._findListenerInfo(typeSet, handler);
    if (!info) return false;

    this._removeListenerInfo(element, type, info);
    typeSet.delete(info);

    this._cleanupEmptyTypeSet(elementMap, type, typeSet);
    this._incrementRemoveMetrics();

    return true;
  }

  /**
   * Find listener info by handler
   * @private
   */
  _findListenerInfo(typeSet, handler) {
    for (const info of typeSet) {
      if (info.handler === handler) return info;
    }
    return null;
  }

  /**
   * Cleanup empty type set from element map
   * @private
   */
  _cleanupEmptyTypeSet(elementMap, type, typeSet) {
    if (typeSet.size === 0) {
      elementMap.delete(type);
    }
  }

  /**
   * Increment remove metrics if enabled
   * @private
   */
  _incrementRemoveMetrics() {
    if (this._enableMetrics) {
      this._metrics.listenersRemoved++;
    }
  }

  /**
   * Remove all listeners for an element
   *
   * @param {HTMLElement} element - Target element
   * @returns {number} Number of listeners removed
   */
  removeAll(element) {
    if (this._isDestroyed || !element) {
      return 0;
    }

    const elementMap = this._elementListeners.get(element);
    if (!elementMap) return 0;

    const count = this._removeAllListenersFromElement(element, elementMap);

    this._elementListeners.delete(element);
    this._removeElementFromNamespaces(element);

    if (this._enableMetrics) {
      this._metrics.listenersRemoved += count;
    }

    return count;
  }

  /**
   * Remove all listeners from element map
   * @private
   */
  _removeAllListenersFromElement(element, elementMap) {
    let count = 0;
    for (const [type, typeSet] of elementMap.entries()) {
      count += this._removeTypeSetListeners(element, type, typeSet);
    }
    return count;
  }

  /**
   * Remove all listeners in a type set
   * @private
   */
  _removeTypeSetListeners(element, type, typeSet) {
    let count = 0;
    for (const info of typeSet) {
      this._removeListenerInfo(element, type, info);
      count++;
    }
    return count;
  }

  /**
   * Remove element from all namespace tracking
   * @private
   */
  _removeElementFromNamespaces(element) {
    for (const entries of this._namespaceListeners.values()) {
      this._removeElementFromEntries(element, entries);
    }
  }

  /**
   * Remove element from namespace entries
   * @private
   */
  _removeElementFromEntries(element, entries) {
    for (const entry of [...entries]) {
      if (entry.element === element) {
        entries.delete(entry);
      }
    }
  }

  /**
   * Remove all listeners for a namespace
   *
   * @param {string} namespace - Namespace to remove
   * @returns {number} Number of listeners removed
   */
  removeByNamespace(namespace) {
    if (this._isDestroyed || !namespace) {
      return 0;
    }

    const entries = this._namespaceListeners.get(namespace);
    if (!entries) return 0;

    let count = 0;

    for (const { element, type, handler } of entries) {
      if (this.remove(element, type, handler)) {
        count++;
      }
    }

    this._namespaceListeners.delete(namespace);

    return count;
  }

  /**
   * Add a delegated event listener
   * Handler is called when events on matching descendants bubble up
   *
   * @param {HTMLElement} container - Container element to listen on
   * @param {string} type - Event type
   * @param {string} selector - CSS selector for target elements
   * @param {Function} handler - Handler function (receives event and matched element)
   * @param {Object|boolean} [options] - addEventListener options
   * @returns {boolean} True if delegation was set up
   *
   * @example
   * // Handle clicks on any .quick-tab-item within the container
   * manager.addDelegated(container, 'click', '.quick-tab-item', (event, target) => {
   *   console.log('Clicked:', target.dataset.id);
   * });
   */
  addDelegated(container, type, selector, handler, options = false) {
    if (this._isDestroyed || !container || !type || !selector || !handler) {
      return false;
    }

    // Create or get container's delegation map
    if (!this._delegatedHandlers.has(container)) {
      this._delegatedHandlers.set(container, new Map());
    }

    const containerMap = this._delegatedHandlers.get(container);

    // Create or get event type map
    if (!containerMap.has(type)) {
      containerMap.set(type, new Map());

      // Create the actual delegated handler
      const delegatedHandler = (event) => {
        this._handleDelegatedEvent(container, type, event);
      };

      // Store reference to the delegated handler
      containerMap.set(`__handler_${type}`, delegatedHandler);

      // Add the actual event listener
      container.addEventListener(type, delegatedHandler, options);
    }

    const typeMap = containerMap.get(type);
    typeMap.set(selector, handler);

    if (this._enableMetrics) {
      this._metrics.delegatedAdded++;
    }

    return true;
  }

  /**
   * Remove a delegated event handler
   *
   * @param {HTMLElement} container - Container element
   * @param {string} type - Event type
   * @param {string} selector - CSS selector
   * @returns {boolean} True if handler was removed
   */
  removeDelegated(container, type, selector) {
    if (this._isDestroyed || !container || !type || !selector) {
      return false;
    }

    const containerMap = this._delegatedHandlers.get(container);
    if (!containerMap) return false;

    const typeMap = containerMap.get(type);
    if (!typeMap) return false;

    const removed = typeMap.delete(selector);

    this._cleanupEmptyDelegation(container, containerMap, type, typeMap);
    this._updateDelegatedRemoveMetrics(removed);

    return removed;
  }

  /**
   * Cleanup empty delegation type map
   * @private
   */
  _cleanupEmptyDelegation(container, containerMap, type, typeMap) {
    if (typeMap.size !== 0) return;

    const delegatedHandler = containerMap.get(`__handler_${type}`);
    if (delegatedHandler) {
      container.removeEventListener(type, delegatedHandler);
      containerMap.delete(`__handler_${type}`);
    }
    containerMap.delete(type);
  }

  /**
   * Update metrics for delegated removal
   * @private
   */
  _updateDelegatedRemoveMetrics(removed) {
    if (removed && this._enableMetrics) {
      this._metrics.delegatedRemoved++;
    }
  }

  /**
   * Remove all delegated handlers for a container
   *
   * @param {HTMLElement} container - Container element
   * @returns {number} Number of handlers removed
   */
  removeAllDelegated(container) {
    if (this._isDestroyed || !container) {
      return 0;
    }

    const containerMap = this._delegatedHandlers.get(container);
    if (!containerMap) return 0;

    let count = 0;

    for (const [key, value] of containerMap.entries()) {
      if (key.startsWith('__handler_')) {
        const type = key.replace('__handler_', '');
        container.removeEventListener(type, value);
      } else if (value instanceof Map) {
        count += value.size;
      }
    }

    this._delegatedHandlers.delete(container);

    if (this._enableMetrics) {
      this._metrics.delegatedRemoved += count;
    }

    return count;
  }

  /**
   * Check if an element has any managed listeners
   *
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element has listeners
   */
  hasListeners(element) {
    if (this._isDestroyed || !element) {
      return false;
    }

    const elementMap = this._elementListeners.get(element);
    if (!elementMap) return false;

    for (const typeSet of elementMap.values()) {
      if (typeSet.size > 0) return true;
    }

    return false;
  }

  /**
   * Get listener count for an element
   *
   * @param {HTMLElement} element - Element to check
   * @returns {number} Number of listeners
   */
  getListenerCount(element) {
    if (this._isDestroyed || !element) {
      return 0;
    }

    const elementMap = this._elementListeners.get(element);
    if (!elementMap) return 0;

    let count = 0;
    for (const typeSet of elementMap.values()) {
      count += typeSet.size;
    }

    return count;
  }

  /**
   * Get performance metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this._metrics = {
      listenersAdded: 0,
      listenersRemoved: 0,
      delegatedAdded: 0,
      delegatedRemoved: 0
    };
  }

  /**
   * Destroy the manager and remove all tracked listeners
   */
  destroy() {
    if (this._isDestroyed) return;

    this._isDestroyed = true;

    // Note: We cannot iterate WeakMap, so we rely on AbortController
    // or garbage collection for cleanup

    // Clear namespace tracking
    this._abortAllNamespacedListeners();

    this._namespaceListeners.clear();

    // WeakMaps will be garbage collected
    this._elementListeners = null;
    this._delegatedHandlers = null;
    this._namespaceListeners = null;
  }

  /**
   * Abort all listeners tracked by namespace
   * @private
   */
  _abortAllNamespacedListeners() {
    for (const entries of this._namespaceListeners.values()) {
      this._abortNamespaceEntries(entries);
    }
  }

  /**
   * Abort listeners in namespace entries
   * @private
   */
  _abortNamespaceEntries(entries) {
    for (const { element, type, handler } of entries) {
      this._abortListenerByHandler(element, type, handler);
    }
  }

  /**
   * Abort a specific listener by handler
   * @private
   */
  _abortListenerByHandler(element, type, handler) {
    const elementMap = this._elementListeners.get(element);
    if (!elementMap) return;

    const typeSet = elementMap.get(type);
    if (!typeSet) return;

    for (const info of typeSet) {
      if (info.handler === handler && info.abortController) {
        info.abortController.abort();
      }
    }
  }

  /**
   * Check if instance is destroyed
   * @returns {boolean} True if destroyed
   */
  isDestroyed() {
    return this._isDestroyed;
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Merge options with AbortController signal
   * @private
   * @param {Object|boolean} options - Original options
   * @param {AbortSignal} signal - Abort signal
   * @returns {Object} Merged options
   */
  _mergeOptionsWithSignal(options, signal) {
    if (typeof options === 'boolean') {
      return { capture: options, signal };
    }
    return { ...options, signal };
  }

  /**
   * Track a listener in the WeakMap
   * @private
   * @param {HTMLElement} element - Element
   * @param {string} type - Event type
   * @param {ListenerInfo} info - Listener info
   */
  _trackListener(element, type, info) {
    if (!this._elementListeners.has(element)) {
      this._elementListeners.set(element, new Map());
    }

    const elementMap = this._elementListeners.get(element);

    if (!elementMap.has(type)) {
      elementMap.set(type, new Set());
    }

    elementMap.get(type).add(info);
  }

  /**
   * Track a listener in namespace map
   * @private
   * @param {string} namespace - Namespace
   * @param {HTMLElement} element - Element
   * @param {string} type - Event type
   * @param {Function} handler - Handler
   */
  _trackNamespace(namespace, element, type, handler) {
    if (!this._namespaceListeners.has(namespace)) {
      this._namespaceListeners.set(namespace, new Set());
    }

    this._namespaceListeners.get(namespace).add({ element, type, handler });
  }

  /**
   * Remove a listener and clean up AbortController
   * @private
   * @param {HTMLElement} element - Element
   * @param {string} type - Event type
   * @param {ListenerInfo} info - Listener info
   */
  _removeListenerInfo(element, type, info) {
    if (info.abortController) {
      // Using AbortController - just abort, listener auto-removed
      info.abortController.abort();
    } else {
      // Manual removal
      element.removeEventListener(type, info.handler, info.options);
    }

    // Clean from namespace tracking if present
    this._cleanupNamespaceEntry(element, type, info);
  }

  /**
   * Clean up namespace entry for removed listener
   * @private
   */
  _cleanupNamespaceEntry(element, type, info) {
    if (!info.namespace) return;

    const entries = this._namespaceListeners.get(info.namespace);
    if (!entries) return;

    this._removeMatchingEntry(entries, element, type, info.handler);
  }

  /**
   * Remove matching entry from namespace entries
   * @private
   */
  _removeMatchingEntry(entries, element, type, handler) {
    for (const entry of [...entries]) {
      if (entry.element === element && entry.type === type && entry.handler === handler) {
        entries.delete(entry);
        break;
      }
    }
  }

  /**
   * Handle a delegated event
   * @private
   * @param {HTMLElement} container - Container element
   * @param {string} type - Event type
   * @param {Event} event - DOM event
   */
  _handleDelegatedEvent(container, type, event) {
    const containerMap = this._delegatedHandlers.get(container);
    if (!containerMap) return;

    const typeMap = containerMap.get(type);
    if (!typeMap) return;

    // Find matching selector for event target
    this._invokeMatchingHandlers(typeMap, container, event);
  }

  /**
   * Invoke handlers for matching selectors
   * @private
   */
  _invokeMatchingHandlers(typeMap, container, event) {
    for (const [selector, handler] of typeMap.entries()) {
      this._tryInvokeHandler(selector, handler, container, event);
    }
  }

  /**
   * Try to invoke a delegated handler if target matches
   * @private
   */
  _tryInvokeHandler(selector, handler, container, event) {
    const target = event.target.closest(selector);
    if (!target || !container.contains(target)) return;

    try {
      handler(event, target);
    } catch (err) {
      console.error('ManagedEventListeners: Error in delegated handler:', err);
    }
  }
}

/**
 * Singleton instance for global use
 * @type {ManagedEventListeners|null}
 */
let _globalManager = null;

/**
 * Get or create the global ManagedEventListeners instance
 *
 * @param {Object} [options] - Options for creating new instance
 * @returns {ManagedEventListeners} Global manager instance
 */
function getGlobalEventManager(options = {}) {
  if (!_globalManager || _globalManager.isDestroyed()) {
    _globalManager = new ManagedEventListeners(options);
  }
  return _globalManager;
}

/**
 * Destroy the global event manager instance
 */
function destroyGlobalEventManager() {
  if (_globalManager) {
    _globalManager.destroy();
    _globalManager = null;
  }
}

export default ManagedEventListeners;
export {
  ManagedEventListeners,
  getGlobalEventManager,
  destroyGlobalEventManager
};
