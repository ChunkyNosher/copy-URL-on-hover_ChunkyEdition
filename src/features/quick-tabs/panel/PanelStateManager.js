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

import { debug } from '../../../utils/debug.js';

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
export class PanelStateManager {
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
