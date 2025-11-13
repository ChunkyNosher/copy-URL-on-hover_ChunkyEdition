/**
 * State Manager
 * Centralized state management for the extension
 */

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
      isPanelOpen: false,
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
    Object.keys(updates).forEach((key) => {
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
    if (typeof keyOrCallback === "function") {
      // Subscribe to all state changes
      const id = Symbol("listener");
      this.listeners.set(id, { key: "*", callback: keyOrCallback });
      return () => this.listeners.delete(id);
    } else {
      // Subscribe to specific key changes
      const id = Symbol("listener");
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
      if (listenerKey === "*" || listenerKey === key) {
        try {
          callback(key, newValue, oldValue, this.state);
        } catch (err) {
          console.error("[State] Listener error:", err);
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
      isPanelOpen: false,
    };
    this.notifyListeners("*", this.state, {});
  }
}
