/**
 * State Manager
 * Centralized state management for the extension
 * v1.6.3.10-v9 - FIX Issue B: Add subscription tracking and cleanup enforcement
 */

// Throttle warning to once per minute
const SUBSCRIPTION_WARNING_THROTTLE_MS = 60000;

export class StateManager {
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
    
    // v1.6.3.10-v9 - FIX Issue B: Track subscription count for diagnostics
    this._subscriptionCount = 0;
    this._maxSubscriptions = 100; // Warn if exceeded
    this._disposed = false;
    this._lastWarningTime = 0; // Throttle subscription warnings
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
   * v1.6.3.10-v9 - FIX Issue B: Track subscriptions and warn on potential leak
   * v1.6.3.10-v10 - FIX Gap 7.1: Subscription lifecycle logging (CREATED/FIRED/DISPOSED)
   * @param {string|function} keyOrCallback - State key or callback for all changes
   * @param {function} callback - Optional callback if key is provided
   * @returns {function} Unsubscribe function
   */
  subscribe(keyOrCallback, callback) {
    // v1.6.3.10-v9 - FIX Issue B: Check if already disposed
    if (this._disposed) {
      console.warn('[Subscription] CREATED_AFTER_DISPOSE:', {
        warning: 'Attempted to subscribe after StateManager was disposed',
        timestamp: new Date().toISOString()
      });
      return () => {}; // Return no-op unsubscribe
    }
    
    this._subscriptionCount++;
    const id = Symbol('listener');
    const subscriptionKey = typeof keyOrCallback === 'function' ? '*' : keyOrCallback;
    
    // v1.6.3.10-v10 - FIX Gap 7.1: Log subscription creation
    console.log('[Subscription] CREATED:', {
      subscriptionId: id.toString(),
      key: subscriptionKey,
      totalActive: this._subscriptionCount,
      timestamp: new Date().toISOString()
    });
    
    // v1.6.3.10-v9 - FIX Issue B: Warn on potential memory leak (throttled)
    this._checkSubscriptionLeakThrottled();
    
    if (typeof keyOrCallback === 'function') {
      // Subscribe to all state changes
      this.listeners.set(id, { key: '*', callback: keyOrCallback });
      return () => this._unsubscribe(id, '*');
    } else {
      // Subscribe to specific key changes
      this.listeners.set(id, { key: keyOrCallback, callback });
      return () => this._unsubscribe(id, keyOrCallback);
    }
  }
  
  /**
   * Check for subscription leak and warn (throttled)
   * v1.6.3.10-v9 - FIX Issue B: Throttle warning to reduce performance impact
   * v1.6.3.10-v10 - FIX Gap 7.2: Memory leak detection telemetry
   * @private
   */
  _checkSubscriptionLeakThrottled() {
    if (this._subscriptionCount <= this._maxSubscriptions) return;
    
    const now = Date.now();
    if (now - this._lastWarningTime < SUBSCRIPTION_WARNING_THROTTLE_MS) return;
    
    this._lastWarningTime = now;
    // v1.6.3.10-v10 - FIX Gap 7.2: Memory leak detection
    console.warn('[Subscription] LEAK_WARNING:', {
      subscriptionCount: this._subscriptionCount,
      threshold: this._maxSubscriptions,
      subscriptionsByKey: this._countSubscriptionsByKey(),
      warning: 'Possible memory leak - too many active subscriptions',
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Internal unsubscribe helper
   * v1.6.3.10-v9 - FIX Issue B: Track unsubscriptions
   * v1.6.3.10-v10 - FIX Gap 7.1: Subscription DISPOSED logging
   * @private
   */
  _unsubscribe(id, key) {
    const wasDeleted = this.listeners.delete(id);
    if (wasDeleted) {
      this._subscriptionCount = Math.max(0, this._subscriptionCount - 1);
      // v1.6.3.10-v10 - FIX Gap 7.1: Log subscription disposal
      console.log('[Subscription] DISPOSED:', {
        subscriptionId: id.toString(),
        key,
        remainingActive: this.listeners.size,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Notify listeners of state changes
   * v1.6.3.10-v10 - FIX Gap 7.1: Log subscription FIRED events
   * @param {string} key - Changed key
   * @param {any} newValue - New value
   * @param {any} oldValue - Old value
   */
  notifyListeners(key, newValue, oldValue) {
    let firedCount = 0;
    this.listeners.forEach(({ key: listenerKey, callback }) => {
      if (listenerKey === '*' || listenerKey === key) {
        try {
          callback(key, newValue, oldValue, this.state);
          firedCount++;
        } catch (err) {
          console.error('[Subscription] FIRED_ERROR:', {
            key,
            listenerKey,
            error: err.message,
            timestamp: new Date().toISOString()
          });
        }
      }
    });
    
    // v1.6.3.10-v10 - FIX Gap 7.1: Log subscription firing summary (only if listeners fired)
    if (firedCount > 0) {
      console.log('[Subscription] FIRED:', {
        key,
        listenersFired: firedCount,
        totalListeners: this.listeners.size,
        timestamp: new Date().toISOString()
      });
    }
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
  
  /**
   * Dispose of all subscriptions and cleanup
   * v1.6.3.10-v9 - FIX Issue B: Enforce subscription cleanup on teardown
   */
  dispose() {
    const subscriptionCount = this.listeners.size;
    
    // v1.6.3.10-v9 - FIX Issue B: Log teardown warning if subscriptions weren't cleaned up
    if (subscriptionCount > 0) {
      console.warn('[State] v1.6.3.10-v9 TEARDOWN_WARNING: Disposing StateManager with active subscriptions:', {
        activeSubscriptions: subscriptionCount,
        warning: 'Subscriptions should be cleaned up before disposal'
      });
    }
    
    // Clear all listeners
    this.listeners.clear();
    this._subscriptionCount = 0;
    this._disposed = true;
    
    console.log('[State] v1.6.3.10-v9 DISPOSED: StateManager cleaned up');
  }
  
  /**
   * Get subscription statistics for diagnostics
   * v1.6.3.10-v9 - FIX Issue B: Diagnostic helper
   * @returns {Object} Subscription stats
   */
  getSubscriptionStats() {
    return {
      activeSubscriptions: this.listeners.size,
      totalSubscribed: this._subscriptionCount,
      isDisposed: this._disposed,
      subscriptionsByKey: this._countSubscriptionsByKey()
    };
  }
  
  /**
   * Count subscriptions by key
   * v1.6.3.10-v9 - FIX Issue B: Diagnostic helper
   * @private
   */
  _countSubscriptionsByKey() {
    const counts = {};
    this.listeners.forEach(({ key }) => {
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }
}
