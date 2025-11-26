/**
 * @fileoverview UpdateHandler - Handles Quick Tab position and size updates
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.2 - MIGRATION: Removed BroadcastManager, uses storage.onChanged for cross-tab sync
 * v1.6.2.1 - Added BroadcastSync for real-time drag/resize sync
 *
 * Responsibilities:
 * - Handle position updates during drag (broadcast to other tabs)
 * - Handle position updates at drag end (save to storage + broadcast final)
 * - Handle size updates during resize (broadcast to other tabs)
 * - Handle size updates at resize end (save to storage + broadcast final)
 * - Receive remote updates and apply to local Quick Tabs
 * - Emit update events for coordinators
 *
 * Architecture (v1.6.2.1):
 * - BroadcastChannel for ephemeral updates during drag/resize (2-5ms latency)
 * - storage.local for final persistence (triggers storage.onChanged in other tabs)
 * - 60fps throttle (16ms) for broadcast during drag/resize
 *
 * @version 1.6.2.1
 * @author refactor-specialist
 */

import { BroadcastChannelFactory } from '../sync/BroadcastChannelFactory.js';
import { BroadcastSync } from '../sync/BroadcastSync.js';

/**
 * UpdateHandler class
 * Manages Quick Tab position and size updates with storage-based cross-tab sync
 * v1.6.2.1 - Added BroadcastSync for real-time drag/resize sync
 */
export class UpdateHandler {
  /**
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {StorageManager} storageManager - Storage manager for persistence
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
   * @param {Function} releasePendingSave - Function to release pending saveId
   * @param {string} cookieStoreId - Firefox container ID
   * @param {string|number} tabId - Current browser tab ID
   */
  constructor(
    quickTabsMap,
    storageManager,
    eventBus,
    generateSaveId,
    releasePendingSave,
    cookieStoreId = 'firefox-default',
    tabId = null
  ) {
    this.quickTabsMap = quickTabsMap;
    this.storageManager = storageManager;
    this.eventBus = eventBus;
    this.generateSaveId = generateSaveId;
    this.releasePendingSave = releasePendingSave;
    this.cookieStoreId = cookieStoreId;
    this.tabId = tabId;

    // Throttle tracking (for future use if needed)
    this.positionChangeThrottle = new Map();
    this.sizeChangeThrottle = new Map();

    // v1.6.2.1 - BroadcastSync for real-time updates
    this.broadcastSync = null;
    this.broadcastThrottle = 16; // 60fps = 16.67ms
    this.lastBroadcastTime = new Map(); // id -> timestamp

    // v1.6.2.3 - Bug #3 Fix: Pending updates queue for Quick Tabs not yet rendered
    // When updates arrive before Quick Tab is rendered (lazy loading), queue them
    // Map<quickTabId, { position?: {left, top}, size?: {width, height}, timestamp }>
    this.pendingUpdates = new Map();

    // Initialize BroadcastSync if we have required params
    if (cookieStoreId && tabId) {
      this._initializeBroadcastSync();
    }
  }

  /**
   * Initialize BroadcastSync for real-time cross-tab updates
   * @private
   */
  _initializeBroadcastSync() {
    try {
      this.broadcastSync = BroadcastChannelFactory.getChannel(
        this.cookieStoreId,
        String(this.tabId)
      );
      this._setupBroadcastListeners();
      console.log('[UpdateHandler] BroadcastSync initialized for container:', this.cookieStoreId);
    } catch (err) {
      console.error('[UpdateHandler] Failed to initialize BroadcastSync:', err);
      this.broadcastSync = null;
    }
  }

  /**
   * Setup listeners for remote position/size updates
   * @private
   */
  _setupBroadcastListeners() {
    if (!this.broadcastSync) return;

    // Listen for position updates during drag
    this.broadcastSync.on(
      BroadcastSync.MESSAGE_TYPES.POSITION_UPDATE,
      payload => this._handleRemotePositionUpdate(payload)
    );

    // Listen for final position (drag end)
    this.broadcastSync.on(
      BroadcastSync.MESSAGE_TYPES.POSITION_FINAL,
      payload => this._handleRemotePositionUpdate(payload)
    );

    // Listen for size updates during resize
    this.broadcastSync.on(
      BroadcastSync.MESSAGE_TYPES.SIZE_UPDATE,
      payload => this._handleRemoteSizeUpdate(payload)
    );

    // Listen for final size (resize end)
    this.broadcastSync.on(
      BroadcastSync.MESSAGE_TYPES.SIZE_FINAL,
      payload => this._handleRemoteSizeUpdate(payload)
    );

    console.log('[UpdateHandler] Broadcast listeners setup complete');
  }

  /**
   * Handle remote position update from another tab
   * v1.6.2.3 - Bug #3 Fix: Queue update if Quick Tab not yet rendered
   * @private
   * @param {Object} payload - { id, left, top }
   */
  _handleRemotePositionUpdate({ id, left, top }) {
    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      // v1.6.2.3 - Bug #3 Fix: Queue update for when Quick Tab is created
      this._queuePendingUpdate(id, 'position', { left, top });
      console.debug(`[UpdateHandler] Remote position update queued: Quick Tab ${id} not yet rendered`);
      return;
    }

    // Update DOM position directly (no storage write needed - already handled by sender)
    if (typeof tabWindow.updatePosition === 'function') {
      tabWindow.updatePosition(left, top);
    } else if (tabWindow.element) {
      // Fallback to direct DOM manipulation
      tabWindow.element.style.left = `${left}px`;
      tabWindow.element.style.top = `${top}px`;
    }

    console.log(`[UpdateHandler] Remote position update: ${id} → (${left}, ${top})`);
  }

  /**
   * Handle remote size update from another tab
   * v1.6.2.3 - Bug #3 Fix: Queue update if Quick Tab not yet rendered
   * @private
   * @param {Object} payload - { id, width, height }
   */
  _handleRemoteSizeUpdate({ id, width, height }) {
    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      // v1.6.2.3 - Bug #3 Fix: Queue update for when Quick Tab is created
      this._queuePendingUpdate(id, 'size', { width, height });
      console.debug(`[UpdateHandler] Remote size update queued: Quick Tab ${id} not yet rendered`);
      return;
    }

    // Update DOM size directly (no storage write needed - already handled by sender)
    if (typeof tabWindow.updateSize === 'function') {
      tabWindow.updateSize(width, height);
    } else if (tabWindow.element) {
      // Fallback to direct DOM manipulation
      tabWindow.element.style.width = `${width}px`;
      tabWindow.element.style.height = `${height}px`;
    }

    console.log(`[UpdateHandler] Remote size update: ${id} → (${width}x${height})`);
  }

  /**
   * Queue a pending update for a Quick Tab that doesn't exist yet
   * v1.6.2.3 - Bug #3 Fix: Store updates for lazy-loaded Quick Tabs
   * @private
   * @param {string} id - Quick Tab ID
   * @param {string} type - Update type ('position' or 'size')
   * @param {Object} data - Update data
   */
  _queuePendingUpdate(id, type, data) {
    let pending = this.pendingUpdates.get(id);
    if (!pending) {
      pending = { timestamp: Date.now() };
      this.pendingUpdates.set(id, pending);
    }

    // Update the appropriate field (latest wins)
    pending[type] = data;
    pending.timestamp = Date.now();

    console.log(`[UpdateHandler] Queued pending ${type} update for ${id}:`, data);
  }

  /**
   * Apply pending updates to a Quick Tab when it becomes available
   * v1.6.2.3 - Bug #3 Fix: Called when Quick Tab is created/rendered
   * @param {string} id - Quick Tab ID
   */
  applyPendingUpdates(id) {
    const pending = this.pendingUpdates.get(id);
    if (!pending) {
      return; // No pending updates
    }

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      console.warn(`[UpdateHandler] Cannot apply pending updates - Quick Tab ${id} still not available`);
      return;
    }

    // Apply position update if queued
    if (pending.position) {
      const { left, top } = pending.position;
      if (typeof tabWindow.updatePosition === 'function') {
        tabWindow.updatePosition(left, top);
      }
      console.log(`[UpdateHandler] Applied pending position update: ${id} → (${left}, ${top})`);
    }

    // Apply size update if queued
    if (pending.size) {
      const { width, height } = pending.size;
      if (typeof tabWindow.updateSize === 'function') {
        tabWindow.updateSize(width, height);
      }
      console.log(`[UpdateHandler] Applied pending size update: ${id} → (${width}x${height})`);
    }

    // Clear pending updates for this Quick Tab
    this.pendingUpdates.delete(id);
    console.log(`[UpdateHandler] Cleared pending updates for ${id}`);
  }

  /**
   * Check if a Quick Tab has pending updates
   * v1.6.2.3 - Bug #3 Fix: Helper to check pending state
   * @param {string} id - Quick Tab ID
   * @returns {boolean} True if there are pending updates
   */
  hasPendingUpdates(id) {
    return this.pendingUpdates.has(id);
  }

  /**
   * Get pending updates for a Quick Tab
   * v1.6.2.3 - Bug #3 Fix: Helper to retrieve pending updates
   * @param {string} id - Quick Tab ID
   * @returns {Object|null} Pending updates or null
   */
  getPendingUpdates(id) {
    return this.pendingUpdates.get(id) || null;
  }

  /**
   * Handle position change during drag
   * v1.6.2.1 - Broadcasts position to other tabs via BroadcastChannel
   * This enables real-time sync (2-5ms latency) during drag
   *
   * @param {string} id - Quick Tab ID
   * @param {number} left - New left position
   * @param {number} top - New top position
   */
  handlePositionChange(id, left, top) {
    // v1.6.2.1 - Broadcast position to other tabs (throttled at 60fps)
    if (this.broadcastSync) {
      const now = Date.now();
      const lastBroadcast = this.lastBroadcastTime.get(`pos-${id}`) || 0;

      if (now - lastBroadcast >= this.broadcastThrottle) {
        this.broadcastSync.send(BroadcastSync.MESSAGE_TYPES.POSITION_UPDATE, {
          id,
          left: Math.round(left),
          top: Math.round(top)
        });
        this.lastBroadcastTime.set(`pos-${id}`, now);
      }
    }
    // No storage writes during drag - handled by handlePositionChangeEnd
  }

  /**
   * Handle position change end (drag end) - save to storage
   * v1.6.2.1 - Broadcasts final position AND saves to storage
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
    this.lastBroadcastTime.delete(`pos-${id}`);

    // Round values
    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);

    // v1.6.2.1 - Broadcast final position to other tabs
    if (this.broadcastSync) {
      this.broadcastSync.send(BroadcastSync.MESSAGE_TYPES.POSITION_FINAL, {
        id,
        left: roundedLeft,
        top: roundedTop
      });
    }

    // Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // Get cookieStoreId from tab
    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || this.cookieStoreId || 'firefox-default';

    // v1.6.2 - Save to storage (triggers storage.onChanged in other tabs)
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_POSITION_FINAL',
          id: id,
          left: roundedLeft,
          top: roundedTop,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[UpdateHandler] Final position save error:', err);
        this.releasePendingSave(saveId);
        return;
      }
    }

    this.releasePendingSave(saveId);

    // Emit event for coordinators
    this.eventBus?.emit('tab:position-updated', {
      id,
      left: roundedLeft,
      top: roundedTop
    });
  }

  /**
   * Handle size change during resize
   * v1.6.2.1 - Broadcasts size to other tabs via BroadcastChannel
   * This enables real-time sync (2-5ms latency) during resize
   *
   * @param {string} id - Quick Tab ID
   * @param {number} width - New width
   * @param {number} height - New height
   */
  handleSizeChange(id, width, height) {
    // v1.6.2.1 - Broadcast size to other tabs (throttled at 60fps)
    if (this.broadcastSync) {
      const now = Date.now();
      const lastBroadcast = this.lastBroadcastTime.get(`size-${id}`) || 0;

      if (now - lastBroadcast >= this.broadcastThrottle) {
        this.broadcastSync.send(BroadcastSync.MESSAGE_TYPES.SIZE_UPDATE, {
          id,
          width: Math.round(width),
          height: Math.round(height)
        });
        this.lastBroadcastTime.set(`size-${id}`, now);
      }
    }
    // No storage writes during resize - handled by handleSizeChangeEnd
  }

  /**
   * Handle size change end (resize end) - save to storage
   * v1.6.2.1 - Broadcasts final size AND saves to storage
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
    this.lastBroadcastTime.delete(`size-${id}`);

    // Round values
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    // v1.6.2.1 - Broadcast final size to other tabs
    if (this.broadcastSync) {
      this.broadcastSync.send(BroadcastSync.MESSAGE_TYPES.SIZE_FINAL, {
        id,
        width: roundedWidth,
        height: roundedHeight
      });
    }

    // Generate save ID for transaction tracking
    const saveId = this.generateSaveId();

    // Get cookieStoreId from tab
    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || this.cookieStoreId || 'firefox-default';

    // v1.6.2 - Save to storage (triggers storage.onChanged in other tabs)
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_SIZE_FINAL',
          id: id,
          width: roundedWidth,
          height: roundedHeight,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[UpdateHandler] Final size save error:', err);
        this.releasePendingSave(saveId);
        return;
      }
    }

    this.releasePendingSave(saveId);

    // Emit event for coordinators
    this.eventBus?.emit('tab:size-updated', {
      id,
      width: roundedWidth,
      height: roundedHeight
    });
  }

  /**
   * Destroy handler and cleanup resources
   * v1.6.2.1 - Close BroadcastSync channel
   * v1.6.2.3 - Clear pending updates queue
   */
  destroy() {
    // Clear throttle maps
    this.positionChangeThrottle.clear();
    this.sizeChangeThrottle.clear();
    this.lastBroadcastTime.clear();

    // v1.6.2.3 - Clear pending updates queue
    this.pendingUpdates.clear();

    // Close BroadcastSync channel for this container
    if (this.broadcastSync && this.cookieStoreId) {
      BroadcastChannelFactory.closeChannel(this.cookieStoreId);
      this.broadcastSync = null;
      console.log('[UpdateHandler] BroadcastSync destroyed for container:', this.cookieStoreId);
    }
  }
}
