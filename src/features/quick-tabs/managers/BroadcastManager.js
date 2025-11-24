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
 * - Validate incoming messages (Gap 3)
 *
 * Uses:
 * - BroadcastChannel API for <10ms cross-tab sync
 * - EventBus for decoupled message handling
 * - BroadcastMessageSchema for message validation
 */

import { v4 as uuidv4 } from 'uuid';

import { validateMessage } from '../schemas/BroadcastMessageSchema.js';

export class BroadcastManager {
  constructor(eventBus, cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.cookieStoreId = cookieStoreId;

    // Broadcast channel
    this.broadcastChannel = null;
    this.currentChannelName = null;

    // Gap 5: Sender identification and sequence tracking
    this.senderId = uuidv4(); // Unique ID for this tab
    this.messageSequence = 0; // Incrementing sequence number
    this.receivedSequences = new Map(); // senderId -> last sequence number

    // Gap 5: Configurable debounce windows per message type
    this.DEBOUNCE_WINDOWS = {
      UPDATE_POSITION: 50,  // Rapid updates expected
      UPDATE_SIZE: 50,      // Rapid updates expected
      CREATE: 200,          // Should be infrequent
      CLOSE: 200,           // Should be infrequent
      MINIMIZE: 100,        // Moderate frequency
      RESTORE: 100,         // Moderate frequency
      SOLO: 100,            // Moderate frequency
      MUTE: 100             // Moderate frequency
    };

    // Debounce to prevent message loops
    this.broadcastDebounce = new Map(); // key -> timestamp
    this.BROADCAST_DEBOUNCE_MS = 50; // Default (overridden by DEBOUNCE_WINDOWS)

    // Message validation metrics (Gap 3)
    this.invalidMessageCount = 0;

    // Container boundary validation metrics (Gap 6)
    this.containerViolationCount = 0;

    // Gap 5: Loop detection metrics
    this.selfMessageCount = 0; // Messages from self (should be filtered)
    this.sequenceAnomalyCount = 0; // Out-of-order or duplicate sequences

    // Gap 1: Storage-based fallback
    this.useBroadcastChannel = true; // Use BC by default
    this.useStorageFallback = false; // Fallback when BC unavailable
    this.storageListener = null; // Storage change listener
    this.STORAGE_TTL_MS = 5000; // Clean up messages older than 5 seconds
    this.lastCleanupTime = 0; // Track last cleanup

    // Gap 2: Channel health tracking and error recovery
    this.lastSuccessfulSend = 0; // Timestamp of last successful send
    this.consecutiveFailures = 0; // Count of consecutive send failures
    this.isChannelHealthy = true; // Current health status
    this.reconnectionAttempts = 0; // Count of reconnection attempts
    this.reconnectionTimer = null; // Timer for scheduled reconnections
    this.FAILURE_THRESHOLD = 3; // Trigger reconnection after 3 failures
    this.MAX_RECONNECTION_ATTEMPTS = 5; // Switch to fallback after 5 attempts
    this.BACKOFF_INTERVALS = [100, 500, 2000, 5000, 5000]; // Exponential backoff
  }

  /**
   * Setup BroadcastChannel for cross-tab messaging
   * Gap 1: Falls back to storage if BC unavailable
   */
  setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[BroadcastManager] BroadcastChannel not available, activating storage fallback');
      this._activateStorageFallback();
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
      this.useBroadcastChannel = true;
      this.useStorageFallback = false;

      console.log(`[BroadcastManager] BroadcastChannel created: ${channelName}`);

      // Setup message handler
      this.broadcastChannel.onmessage = event => {
        this.handleBroadcastMessage(event.data);
      };

      console.log(`[BroadcastManager] Initialized for container: ${this.cookieStoreId}`);
    } catch (err) {
      console.error('[BroadcastManager] Failed to setup BroadcastChannel:', err);
      this._activateStorageFallback();
    }
  }

  /**
   * Validate sequence number for duplicate/replay detection (Gap 5)
   * @private
   */
  _validateSequence(senderId, sequence, messageType) {
    const lastSequence = this.receivedSequences.get(senderId);
    
    if (lastSequence === undefined) {
      this.receivedSequences.set(senderId, sequence);
      return true;
    }
    
    if (sequence <= lastSequence) {
      this.sequenceAnomalyCount++;
      console.warn(
        '[BroadcastManager] Sequence anomaly:',
        `Sender: ${senderId}, Last: ${lastSequence}, Current: ${sequence}`
      );
      
      this.eventBus?.emit('broadcast:sequence-anomaly', {
        senderId,
        lastSequence,
        currentSequence: sequence,
        messageType,
        count: this.sequenceAnomalyCount
      });
      
      return false;
    }
    
    this.receivedSequences.set(senderId, sequence);
    return true;
  }

  /**
   * Check if message is from self (Gap 5)
   * @private
   */
  _isSelfMessage(senderId, messageType) {
    if (senderId === this.senderId) {
      this.selfMessageCount++;
      console.log('[BroadcastManager] Ignoring self message:', messageType);
      return true;
    }
    return false;
  }

  /**
   * Validate container boundary (Gap 6)
   * @private
   */
  _validateContainer(containerID, messageType) {
    if (!containerID || containerID === this.cookieStoreId) {
      return true;
    }
    
    this.containerViolationCount++;
    console.warn(
      '[BroadcastManager] Container violation:',
      `Expected: ${this.cookieStoreId}, Got: ${containerID}`
    );
    
    this.eventBus?.emit('broadcast:container-violation', {
      expectedContainer: this.cookieStoreId,
      actualContainer: containerID,
      messageType,
      count: this.containerViolationCount
    });
    
    return false;
  }

  /**
   * Process validated message through filters (Gap 5, Gap 6)
   * @private
   */
  _shouldProcessMessage(type, sanitizedData) {
    // Check for self-message
    if (sanitizedData.senderId && this._isSelfMessage(sanitizedData.senderId, type)) {
      return false;
    }

    // Validate sequence number
    const hasSequence = sanitizedData.senderId && sanitizedData.sequence !== undefined;
    if (hasSequence && !this._validateSequence(sanitizedData.senderId, sanitizedData.sequence, type)) {
      return false;
    }

    // Validate container boundary
    if (!this._validateContainer(sanitizedData.cookieStoreId, type)) {
      return false;
    }

    // Check debounce
    if (this.shouldDebounce(type, sanitizedData)) {
      console.log('[BroadcastManager] Debounced:', type, sanitizedData.id);
      return false;
    }

    return true;
  }

  /**
   * Handle incoming broadcast message
   * @param {Object} message - Message data with type and data
   */
  handleBroadcastMessage(message) {
    console.log('[BroadcastManager] Message received:', message);

    // Gap 3: Validate message structure and data
    const validationResult = validateMessage(message);
    
    if (!validationResult.isValid()) {
      this.invalidMessageCount++;
      console.error('[BroadcastManager] Invalid message:', validationResult.errors);
      this.eventBus?.emit('broadcast:invalid', {
        errors: validationResult.errors,
        message,
        count: this.invalidMessageCount
      });
      return;
    }

    if (validationResult.warnings.length > 0) {
      console.warn('[BroadcastManager] Validation warnings:', validationResult.warnings);
    }

    const { type } = message;
    const sanitizedData = validationResult.sanitizedData;

    // Apply all filters (Gap 5, Gap 6)
    if (!this._shouldProcessMessage(type, sanitizedData)) {
      return;
    }

    // Emit event for handlers to process
    this.eventBus?.emit('broadcast:received', { type, data: sanitizedData });
  }

  /**
   * Check if message should be debounced
   * Gap 5: Enhanced with sender ID and configurable windows
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {boolean} - True if should skip
   */
  shouldDebounce(type, data) {
    if (!data || !data.id) {
      return false;
    }

    // Gap 5: Include sender ID in debounce key to allow simultaneous updates from different tabs
    const senderId = data.senderId || 'unknown';
    const debounceKey = `${senderId}-${type}-${data.id}`;
    const now = Date.now();
    const lastProcessed = this.broadcastDebounce.get(debounceKey);

    // Gap 5: Use configurable debounce window per message type
    const debounceWindow = this.DEBOUNCE_WINDOWS[type] || this.BROADCAST_DEBOUNCE_MS;

    if (lastProcessed && now - lastProcessed < debounceWindow) {
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
   * Gap 1: Uses storage fallback if BC unavailable
   * @param {string} type - Message type (CREATE, UPDATE_POSITION, etc.)
   * @param {Object} data - Message payload
   */
  async broadcast(type, data) {
    // Gap 5: Increment sequence number
    this.messageSequence++;

    // Gap 6: Include container ID
    // Gap 5: Include sender ID and sequence number
    const messageData = {
      ...data,
      cookieStoreId: this.cookieStoreId,
      senderId: this.senderId,
      sequence: this.messageSequence
    };

    // Gap 1: Use storage fallback if BC unavailable
    if (this.useStorageFallback) {
      return this._broadcastViaStorage(type, messageData);
    }

    if (!this.broadcastChannel) {
      console.warn('[BroadcastManager] No broadcast channel available');
      this._handleBroadcastFailure(type, new Error('Channel not available'));
      return false;
    }

    try {
      this.broadcastChannel.postMessage({ type, data: messageData });
      console.log(`[BroadcastManager] Broadcasted ${type}:`, messageData);
      
      // Gap 2: Track successful send
      this._handleBroadcastSuccess();
      return true;
    } catch (err) {
      console.error('[BroadcastManager] Failed to broadcast:', err);
      
      // Gap 2: Handle broadcast failure
      this._handleBroadcastFailure(type, err);
      return false;
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
   * Activate storage-based fallback (Gap 1)
   * @private
   */
  _activateStorageFallback() {
    console.log('[BroadcastManager] Activating storage-based fallback');
    
    this.useBroadcastChannel = false;
    this.useStorageFallback = true;

    // Setup storage.onChanged listener
    if (this._hasStorageAPI()) {
      this.storageListener = this._handleStorageChange.bind(this);
      globalThis.browser.storage.local.onChanged.addListener(this.storageListener);
      console.log('[BroadcastManager] Storage listener registered');
    } else {
      console.error('[BroadcastManager] browser.storage.onChanged not available');
    }
  }

  /**
   * Check if storage API is available (Gap 1)
   * @private
   */
  _hasStorageAPI() {
    return typeof globalThis.browser !== 'undefined' && 
           globalThis.browser.storage && 
           globalThis.browser.storage.onChanged;
  }

  /**
   * Handle storage change events (Gap 1)
   * @private
   */
  _handleStorageChange(changes, areaName) {
    if (areaName !== 'local') {
      return;
    }

    // Look for sync message keys: quick-tabs-sync-{containerId}-{timestamp}
    const syncKeyPrefix = `quick-tabs-sync-${this.cookieStoreId}-`;
    
    for (const key of Object.keys(changes)) {
      if (!key.startsWith(syncKeyPrefix)) {
        continue;
      }

      const change = changes[key];
      
      // Only process new values (messages being written)
      if (!change.newValue) {
        continue;
      }

      const message = change.newValue;
      console.log('[BroadcastManager] Storage sync message received:', message);
      
      // Process as if it came from BroadcastChannel
      this.handleBroadcastMessage(message);
      
      // Clean up old messages
      this._cleanupStorageMessages();
    }
  }

  /**
   * Send message via storage fallback (Gap 1)
   * @private
   */
  async _broadcastViaStorage(type, data) {
    if (!this._hasStorageAPI()) {
      console.error('[BroadcastManager] Storage API not available');
      return false;
    }

    try {
      const timestamp = Date.now();
      const key = `quick-tabs-sync-${this.cookieStoreId}-${timestamp}`;
      
      const message = { type, data };
      
      await globalThis.browser.storage.local.set({ [key]: message });
      console.log(`[BroadcastManager] Broadcasted via storage: ${type}`);
      
      // Clean up old messages after write
      this._cleanupStorageMessages();
      
      return true;
    } catch (err) {
      console.error('[BroadcastManager] Storage broadcast failed:', err);
      return false;
    }
  }

  /**
   * Clean up old storage sync messages (Gap 1)
   * @private
   */
  async _cleanupStorageMessages() {
    if (!this._hasStorageAPI()) {
      return;
    }

    const now = Date.now();
    
    // Only run cleanup every 5 seconds
    if (now - this.lastCleanupTime < this.STORAGE_TTL_MS) {
      return;
    }
    
    this.lastCleanupTime = now;
    
    try {
      const allStorage = await globalThis.browser.storage.local.get(null);
      const keysToRemove = this._findExpiredStorageKeys(allStorage, now);
      
      if (keysToRemove.length > 0) {
        await globalThis.browser.storage.local.remove(keysToRemove);
        console.log(`[BroadcastManager] Cleaned up ${keysToRemove.length} old storage messages`);
      }
    } catch (err) {
      console.error('[BroadcastManager] Storage cleanup failed:', err);
    }
  }

  /**
   * Find expired storage keys (Gap 1)
   * @private
   */
  _findExpiredStorageKeys(allStorage, now) {
    const keysToRemove = [];
    const syncKeyPrefix = `quick-tabs-sync-${this.cookieStoreId}-`;
    
    for (const key of Object.keys(allStorage)) {
      if (!key.startsWith(syncKeyPrefix)) {
        continue;
      }

      // Extract timestamp from key
      const timestampStr = key.substring(syncKeyPrefix.length);
      const timestamp = parseInt(timestampStr, 10);
      
      // Remove if older than TTL
      if (!isNaN(timestamp) && (now - timestamp > this.STORAGE_TTL_MS)) {
        keysToRemove.push(key);
      }
    }
    
    return keysToRemove;
  }

  /**
   * Handle successful broadcast (Gap 2)
   * @private
   */
  _handleBroadcastSuccess() {
    this.lastSuccessfulSend = Date.now();
    this.consecutiveFailures = 0;
    this.reconnectionAttempts = 0;
    this.isChannelHealthy = true;
  }

  /**
   * Handle broadcast failure (Gap 2)
   * @private
   */
  _handleBroadcastFailure(messageType, error) {
    this.consecutiveFailures++;
    this.isChannelHealthy = false;

    // Emit error event
    this.eventBus?.emit('broadcast:error', {
      messageType,
      error: error.message,
      consecutiveFailures: this.consecutiveFailures,
      timestamp: Date.now()
    });

    // Trigger reconnection if threshold reached
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this._scheduleReconnection();
    }
  }

  /**
   * Schedule channel reconnection (Gap 2)
   * @private
   */
  _scheduleReconnection() {
    // Don't schedule if already scheduled
    if (this.reconnectionTimer) {
      return;
    }

    // Switch to fallback if max attempts reached
    if (this.reconnectionAttempts >= this.MAX_RECONNECTION_ATTEMPTS) {
      console.warn('[BroadcastManager] Max reconnection attempts reached, switching to storage fallback');
      this._activateStorageFallback();
      return;
    }

    const backoffIndex = Math.min(this.reconnectionAttempts, this.BACKOFF_INTERVALS.length - 1);
    const delay = this.BACKOFF_INTERVALS[backoffIndex];

    console.log(`[BroadcastManager] Scheduling reconnection attempt ${this.reconnectionAttempts + 1} in ${delay}ms`);

    this.reconnectionTimer = setTimeout(() => {
      this._attemptReconnection();
    }, delay);
  }

  /**
   * Attempt to reconnect channel (Gap 2)
   * @private
   */
  _attemptReconnection() {
    this.reconnectionTimer = null;
    this.reconnectionAttempts++;

    console.log(`[BroadcastManager] Reconnection attempt ${this.reconnectionAttempts}/${this.MAX_RECONNECTION_ATTEMPTS}`);

    try {
      // Close existing channel
      if (this.broadcastChannel) {
        this.broadcastChannel.close();
        this.broadcastChannel = null;
      }

      // Recreate channel
      this.setupBroadcastChannel();

      // Test the channel
      this._testChannelHealth();
    } catch (err) {
      console.error('[BroadcastManager] Reconnection failed:', err);
      this._scheduleReconnection();
    }
  }

  /**
   * Test channel health (Gap 2)
   * @private
   */
  _testChannelHealth() {
    if (!this.broadcastChannel) {
      this.isChannelHealthy = false;
      return;
    }

    try {
      // Send empty ping message to test channel
      this.broadcastChannel.postMessage({ type: '__PING__', data: {} });
      this.isChannelHealthy = true;
      this.consecutiveFailures = 0;
      console.log('[BroadcastManager] Channel health test passed');
    } catch (err) {
      console.error('[BroadcastManager] Channel health test failed:', err);
      this.isChannelHealthy = false;
      this._scheduleReconnection();
    }
  }

  /**
   * Close broadcast channel
   */
  close() {
    // Gap 2: Clear reconnection timer
    if (this.reconnectionTimer) {
      clearTimeout(this.reconnectionTimer);
      this.reconnectionTimer = null;
    }

    if (this.broadcastChannel) {
      console.log(`[BroadcastManager] Closing channel: ${this.currentChannelName}`);
      this.broadcastChannel.close();
      this.broadcastChannel = null;
      this.currentChannelName = null;
    }

    // Gap 1: Remove storage listener if active
    if (this.storageListener && this._hasStorageAPI()) {
      globalThis.browser.storage.local.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
      console.log('[BroadcastManager] Storage listener removed');
    }
  }
}
