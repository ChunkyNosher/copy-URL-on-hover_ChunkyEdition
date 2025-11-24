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

import { createLogger, LogLevel } from '../../../utils/Logger.js';
import { validateMessage } from '../schemas/BroadcastMessageSchema.js';

export class BroadcastManager {
  constructor(eventBus, cookieStoreId = 'firefox-default') {
    this.eventBus = eventBus;
    this.cookieStoreId = cookieStoreId;

    // Gap 7: Structured logging
    this.logger = createLogger('BroadcastManager', {
      level: LogLevel.WARN // Default to WARN in production
    });

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

    // Phase 3: Broadcast message persistence for late-joining tabs
    this.BROADCAST_HISTORY_MAX_MESSAGES = 50; // Keep last 50 messages
    this.BROADCAST_HISTORY_TTL_MS = 30000; // 30 seconds replay window
    this.lastHistoryCleanup = 0; // Track last cleanup time

    // Phase 4: Periodic state snapshot broadcasting
    this.snapshotInterval = null; // Timer for periodic snapshots
    this.SNAPSHOT_INTERVAL_MS = 5000; // Broadcast snapshot every 5 seconds
    this.stateManager = null; // Will be set via setStateManager()
  }

  /**
   * Setup BroadcastChannel for cross-tab messaging
   * Gap 1: Falls back to storage if BC unavailable
   */
  setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      this.logger.warn('BroadcastChannel not available, activating storage fallback', {
        cookieStoreId: this.cookieStoreId
      });
      this._activateStorageFallback();
      return;
    }

    try {
      // Container-specific channel for isolation
      const channelName = `quick-tabs-sync-${this.cookieStoreId}`;

      // Close existing channel if present
      if (this.broadcastChannel) {
        this.logger.info('Closing old channel', {
          channelName: this.currentChannelName
        });
        this.broadcastChannel.close();
      }

      this.broadcastChannel = new BroadcastChannel(channelName);
      this.currentChannelName = channelName;
      this.useBroadcastChannel = true;
      this.useStorageFallback = false;

      this.logger.info('BroadcastChannel created', {
        channelName,
        cookieStoreId: this.cookieStoreId,
        senderId: this.senderId
      });

      // Setup message handler
      this.broadcastChannel.onmessage = event => {
        this.handleBroadcastMessage(event.data);
      };

      this.logger.info('Initialized for container', {
        cookieStoreId: this.cookieStoreId
      });
    } catch (err) {
      this.logger.error('Failed to setup BroadcastChannel', {
        error: err.message,
        cookieStoreId: this.cookieStoreId
      });
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
      this.logger.debug('Message debounced', {
        type,
        id: sanitizedData.id
      });
      return false;
    }

    return true;
  }

  /**
   * Handle incoming broadcast message
   * @param {Object} message - Message data with type and data
   */
  handleBroadcastMessage(message) {
    // Gap 7: Performance timing
    this.logger.startTimer('handleMessage');
    
    this.logger.debug('Message received', {
      type: message.type,
      hasData: !!message.data
    });

    // Gap 3: Validate message structure and data
    const validationResult = validateMessage(message);
    
    if (!validationResult.isValid()) {
      this.invalidMessageCount++;
      this.logger.error('Invalid message', {
        errors: validationResult.errors,
        messageType: message.type,
        count: this.invalidMessageCount
      });
      this.eventBus?.emit('broadcast:invalid', {
        errors: validationResult.errors,
        message,
        count: this.invalidMessageCount
      });
      return;
    }

    if (validationResult.warnings.length > 0) {
      this.logger.warn('Validation warnings', {
        warnings: validationResult.warnings,
        messageType: message.type
      });
    }

    const { type } = message;
    const sanitizedData = validationResult.sanitizedData;

    // Apply all filters (Gap 5, Gap 6)
    if (!this._shouldProcessMessage(type, sanitizedData)) {
      this.logger.endTimer('handleMessage', 'Message filtered');
      return;
    }

    // Emit event for handlers to process
    this.eventBus?.emit('broadcast:received', { type, data: sanitizedData });
    
    // Gap 7: End performance timing
    this.logger.endTimer('handleMessage', 'Message processed');
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

    // Phase 3: Persist message to history for late-joining tabs
    await this._persistBroadcastMessage(type, messageData);

    // Gap 1: Use storage fallback if BC unavailable
    if (this.useStorageFallback) {
      return this._broadcastViaStorage(type, messageData);
    }

    if (!this.broadcastChannel) {
      this.logger.warn('No broadcast channel available', {
        type,
        useStorageFallback: this.useStorageFallback
      });
      this._handleBroadcastFailure(type, new Error('Channel not available'));
      return false;
    }

    try {
      this.logger.startTimer(`broadcast-${type}`);
      this.broadcastChannel.postMessage({ type, data: messageData });
      
      this.logger.debug(`Broadcasted ${type}`, {
        id: messageData.id,
        senderId: this.senderId,
        sequence: this.messageSequence
      });
      
      // Gap 2: Track successful send
      this._handleBroadcastSuccess();
      this.logger.endTimer(`broadcast-${type}`, `${type} broadcast completed`);
      return true;
    } catch (err) {
      this.logger.error('Failed to broadcast', {
        type,
        error: err.message,
        consecutiveFailures: this.consecutiveFailures + 1
      });
      
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

    this.logger.info('Updating container', {
      oldContainer: this.cookieStoreId,
      newContainer: cookieStoreId
    });
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

    // Phase 4: Clear snapshot interval
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }

  /**
   * Phase 3: Persist broadcast message to storage for late-joining tabs
   * Stores last 50 messages with 30-second TTL for replay
   * 
   * @private
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  async _persistBroadcastMessage(type, data) {
    if (!this._hasStorageAPI()) {
      return;
    }

    // Skip persistence when in storage fallback mode (different mechanism)
    if (this.useStorageFallback) {
      return;
    }

    try {
      const historyKey = `quicktabs-broadcast-history-${this.cookieStoreId}`;
      
      // Load existing history
      const result = await globalThis.browser.storage.local.get(historyKey);
      const history = result[historyKey] || { messages: [], lastCleanup: Date.now() };

      // Add new message
      history.messages.push({
        type,
        data,
        timestamp: Date.now(),
        senderId: this.senderId
      });

      // Cleanup old messages and limit size
      const now = Date.now();
      const needsCleanup = now - history.lastCleanup > 5000;
      
      if (needsCleanup) {
        // Remove messages older than TTL
        history.messages = history.messages.filter(
          msg => now - msg.timestamp < this.BROADCAST_HISTORY_TTL_MS
        );
        
        // Keep only last N messages (extract to reduce nesting)
        this._limitHistorySize(history);
        
        history.lastCleanup = now;
      }

      // Save updated history
      await globalThis.browser.storage.local.set({ [historyKey]: history });
      
      this.logger.debug('Message persisted to history', {
        type,
        historySize: history.messages.length
      });
    } catch (err) {
      this.logger.error('Failed to persist broadcast message', {
        type,
        error: err.message
      });
    }
  }

  /**
   * Limit broadcast history size
   * @private
   * @param {Object} history - History object with messages array
   */
  _limitHistorySize(history) {
    if (history.messages.length > this.BROADCAST_HISTORY_MAX_MESSAGES) {
      history.messages = history.messages.slice(-this.BROADCAST_HISTORY_MAX_MESSAGES);
    }
  }

  /**
   * Phase 3: Replay broadcast history for late-joining tabs
   * Loads and replays messages from last 30 seconds
   * 
   * @returns {Promise<number>} - Number of messages replayed
   */
  async replayBroadcastHistory() {
    if (!this._hasStorageAPI()) {
      return 0;
    }

    try {
      const historyKey = `quicktabs-broadcast-history-${this.cookieStoreId}`;
      const result = await globalThis.browser.storage.local.get(historyKey);
      const history = result[historyKey];

      if (!history || !history.messages || history.messages.length === 0) {
        this.logger.info('No broadcast history to replay');
        return 0;
      }

      // Filter to messages within TTL window and not from self
      const now = Date.now();
      const replayableMessages = history.messages.filter(msg => {
        const withinTTL = now - msg.timestamp < this.BROADCAST_HISTORY_TTL_MS;
        const notFromSelf = msg.senderId !== this.senderId;
        return withinTTL && notFromSelf;
      });

      this.logger.info('Replaying broadcast history', {
        totalMessages: history.messages.length,
        replayableMessages: replayableMessages.length
      });

      // Replay messages in chronological order
      for (const msg of replayableMessages) {
        // Emit as if received via broadcast channel
        this.eventBus?.emit('broadcast:received', {
          type: msg.type,
          data: msg.data
        });
      }

      return replayableMessages.length;
    } catch (err) {
      this.logger.error('Failed to replay broadcast history', {
        error: err.message
      });
      return 0;
    }
  }

  /**
   * Phase 4: Set state manager reference for snapshot broadcasting
   * 
   * @param {StateManager} stateManager - State manager instance
   */
  setStateManager(stateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Phase 4: Start periodic state snapshot broadcasting
   * Broadcasts full state every 5 seconds for self-healing
   */
  startPeriodicSnapshots() {
    if (this.snapshotInterval) {
      this.logger.warn('Snapshot broadcasting already started');
      return;
    }

    this.logger.info('Starting periodic state snapshot broadcasting', {
      intervalMs: this.SNAPSHOT_INTERVAL_MS
    });

    this.snapshotInterval = setInterval(() => {
      this._broadcastStateSnapshot();
    }, this.SNAPSHOT_INTERVAL_MS);
  }

  /**
   * Phase 4: Stop periodic state snapshot broadcasting
   */
  stopPeriodicSnapshots() {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
      this.logger.info('Stopped periodic state snapshot broadcasting');
    }
  }

  /**
   * Phase 4: Broadcast complete state snapshot
   * @private
   */
  async _broadcastStateSnapshot() {
    if (!this.stateManager) {
      this.logger.debug('No state manager available for snapshot');
      return;
    }

    try {
      const allQuickTabs = this.stateManager.getAll();
      
      if (allQuickTabs.length === 0) {
        this.logger.debug('No Quick Tabs to snapshot');
        return;
      }

      // Serialize Quick Tabs for broadcast
      const serializedQuickTabs = allQuickTabs.map(qt => qt.serialize());

      await this.broadcast('SNAPSHOT', {
        quickTabs: serializedQuickTabs,
        timestamp: Date.now(),
        count: serializedQuickTabs.length
      });

      this.logger.debug('State snapshot broadcasted', {
        count: serializedQuickTabs.length
      });
    } catch (err) {
      this.logger.error('Failed to broadcast state snapshot', {
        error: err.message
      });
    }
  }
}
