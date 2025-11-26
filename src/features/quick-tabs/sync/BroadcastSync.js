/**
 * BroadcastSync - Real-time cross-tab messaging via BroadcastChannel
 * v1.6.2.1 - NEW: Ephemeral state sync for drag/resize/focus
 *
 * Responsibilities:
 * - Send real-time position updates during drag
 * - Send real-time size updates during resize
 * - Send focus/blur events for z-index coordination
 * - Receive updates from other tabs and apply to local DOM
 * - ONE CHANNEL PER CONTAINER (scoped by cookieStoreId)
 *
 * Memory Leak Prevention:
 * - Layer 1: Rate Limiting (60 msgs/sec max)
 * - Layer 2: Message Deduplication (30 second TTL)
 * - Layer 3: Lifecycle Management (beforeunload, visibilitychange hooks)
 * - Layer 5: Circuit Breaker (auto-recovery after 60s)
 *
 * Architecture:
 * Tab A drags → BroadcastChannel.postMessage → Tab B/C/D update immediately
 * Tab A drag ends → Storage write (persistent) + BroadcastChannel (final)
 *
 * Performance:
 * - Latency: 2-5ms (vs 15-50ms for storage)
 * - No serialization overhead (structured clone)
 * - No storage pollution (ephemeral only)
 *
 * @version 1.6.2.1
 */

import { CircuitBreaker } from './CircuitBreaker.js';

export class BroadcastSync {
  // Message types
  static MESSAGE_TYPES = {
    POSITION_UPDATE: 'POSITION_UPDATE', // During drag
    POSITION_FINAL: 'POSITION_FINAL', // Drag end (also saved to storage)
    SIZE_UPDATE: 'SIZE_UPDATE', // During resize
    SIZE_FINAL: 'SIZE_FINAL', // Resize end (also saved to storage)
    FOCUS: 'FOCUS', // Quick Tab brought to front
    HEARTBEAT: 'HEARTBEAT' // Tab alive signal
  };

  // Rate limiting constants
  static MAX_MESSAGES_PER_SECOND = 60; // 60fps = 16.67ms between messages
  static MIN_MESSAGE_INTERVAL_MS = 1000 / 60; // ~16.67ms

  // Deduplication constants
  static MESSAGE_TTL_MS = 30000; // 30 second TTL
  static CLEANUP_INTERVAL_MS = 5000; // Clean up every 5 seconds
  static MAX_RATE_LIMITER_SIZE = 100; // Max entries in rate limiter map
  static RATE_LIMITER_TTL_MS = 5000; // Rate limiter entry TTL

  /**
   * @param {string} cookieStoreId - Firefox container ID
   * @param {string} tabId - Current browser tab ID
   */
  constructor(cookieStoreId, tabId) {
    this.cookieStoreId = cookieStoreId;
    this.tabId = tabId;

    // Layer 1: Rate limiter - action:id → last send time
    this.rateLimiter = new Map();

    // Layer 2: Deduplication tracking - messageId → timestamp
    this.processedMessages = new Map();
    this.lastCleanup = Date.now();

    // Layer 3: Listener registry - action → [callbacks]
    this.listeners = new Map();

    // Layer 5: Circuit breaker
    this.circuitBreaker = new CircuitBreaker('BroadcastSync', {
      maxOperationsPerSecond: 100,
      maxFailures: 10,
      resetTimeout: 60000
    });

    // State flags
    this._closed = false;
    this._paused = false;

    // Create channel scoped to container
    // Multiple containers = multiple channels (isolation)
    this.channel = new BroadcastChannel(`quick-tabs-${cookieStoreId}`);

    // Setup message handler
    this.channel.onmessage = event => {
      this._handleMessage(event.data);
    };

    // Layer 3: Setup lifecycle hooks
    this._setupLifecycleHooks();

    console.log(`[BroadcastSync] Channel opened: quick-tabs-${cookieStoreId} (tab ${tabId})`);
  }

  /**
   * Setup lifecycle hooks for cleanup
   * @private
   */
  _setupLifecycleHooks() {
    if (typeof window !== 'undefined') {
      // Hook 1: Page unload (tab close, navigation)
      this._beforeUnloadHandler = () => {
        this.close();
      };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);

      // Hook 2: Visibility change (tab hidden - pause broadcasting)
      this._visibilityChangeHandler = () => {
        if (document.hidden) {
          this._pauseBroadcasting();
        } else {
          this._resumeBroadcasting();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityChangeHandler);
    }

    // Hook 3: Extension unload (rare, but critical)
    if (typeof browser !== 'undefined' && browser.runtime?.onSuspend) {
      this._suspendHandler = () => {
        this.close();
      };
      browser.runtime.onSuspend.addListener(this._suspendHandler);
    }
  }

  /**
   * Send message to all other tabs in same container
   * Uses rate limiting and circuit breaker protection
   *
   * @param {string} action - Message type (from MESSAGE_TYPES)
   * @param {Object} payload - Message data
   * @returns {boolean} - True if sent, false if rate limited or circuit open
   */
  send(action, payload) {
    // Check if active
    if (!this._isActive()) {
      return false;
    }

    // Layer 1: Check rate limit
    const rateLimitKey = `${action}-${payload.id || 'global'}`;
    const now = Date.now();
    const lastSend = this.rateLimiter.get(rateLimitKey) || 0;

    if (now - lastSend < BroadcastSync.MIN_MESSAGE_INTERVAL_MS) {
      // Rate limited - skip this message
      console.debug(`[BroadcastSync] Rate limited: ${action}`);
      return false;
    }

    // Update rate limiter
    this.rateLimiter.set(rateLimitKey, now);

    // Clean up old entries (prevent Map growth)
    if (this.rateLimiter.size > BroadcastSync.MAX_RATE_LIMITER_SIZE) {
      this._cleanupRateLimiter(now);
    }

    // Layer 5: Execute with circuit breaker
    try {
      // Use sync execution (postMessage is sync)
      if (this.circuitBreaker.isOpen()) {
        console.warn('[BroadcastSync] Circuit breaker open, skipping send');
        return false;
      }

      const message = {
        senderId: this.tabId,
        action,
        payload,
        timestamp: now,
        messageId: this._generateMessageId()
      };

      // Send to all tabs (including self, but we'll ignore it)
      // Uses structured clone (native) - no JSON.stringify needed
      this.channel.postMessage(message);

      // Track sent message to ignore when received
      this._recordMessage(message.messageId);

      return true;
    } catch (err) {
      console.error('[BroadcastSync] Send error:', err);
      return false;
    }
  }

  /**
   * Register listener for specific action type
   * @param {string} action - Action type to listen for
   * @param {Function} callback - Handler function (payload) => void
   */
  on(action, callback) {
    if (!this.listeners.has(action)) {
      this.listeners.set(action, []);
    }
    this.listeners.get(action).push(callback);
  }

  /**
   * Remove listener
   * @param {string} action - Action type
   * @param {Function} callback - Handler to remove
   */
  off(action, callback) {
    const callbacks = this.listeners.get(action);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Handle incoming message from channel
   * @private
   * @param {Object} message - Message from other tab
   */
  _handleMessage(message) {
    const { senderId, action, payload, messageId } = message;

    // Layer 2A: Ignore own messages (prevent self-echo)
    if (senderId === this.tabId) {
      return;
    }

    // Layer 2B: Ignore duplicate messages (edge case: rapid sends)
    if (this._isDuplicate(messageId)) {
      console.debug(`[BroadcastSync] Ignoring duplicate message ${messageId}`);
      return;
    }

    // Record message as processed
    this._recordMessage(messageId);

    // Dispatch to registered listeners
    const callbacks = this.listeners.get(action) || [];
    callbacks.forEach(cb => {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[BroadcastSync] Listener error for ${action}:`, err);
      }
    });

    // Periodic cleanup
    if (Date.now() - this.lastCleanup > BroadcastSync.CLEANUP_INTERVAL_MS) {
      this._cleanupProcessedMessages();
    }
  }

  /**
   * Generate unique message ID
   * Format: ${tabId}-${timestamp}-${random9chars}
   * @private
   * @returns {string}
   */
  _generateMessageId() {
    // Use crypto.randomUUID if available, otherwise fallback to Math.random
    // The random component ensures uniqueness even with same tabId and timestamp
    const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    return `${this.tabId}-${Date.now()}-${randomPart}`;
  }

  /**
   * Record message to prevent duplicate processing
   * @private
   * @param {string} messageId
   */
  _recordMessage(messageId) {
    this.processedMessages.set(messageId, Date.now());
  }

  /**
   * Check if message has been processed
   * @private
   * @param {string} messageId
   * @returns {boolean}
   */
  _isDuplicate(messageId) {
    return this.processedMessages.has(messageId);
  }

  /**
   * Clean up old tracked messages (older than TTL)
   * @private
   */
  _cleanupProcessedMessages() {
    const now = Date.now();
    const cutoff = now - BroadcastSync.MESSAGE_TTL_MS;

    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (timestamp < cutoff) {
        this.processedMessages.delete(messageId);
      }
    }

    this.lastCleanup = now;

    console.debug(
      `[BroadcastSync] Cleanup: ${this.processedMessages.size} messages tracked`
    );
  }

  /**
   * Clean up old rate limiter entries
   * @private
   * @param {number} now - Current timestamp
   */
  _cleanupRateLimiter(now) {
    const cutoff = now - BroadcastSync.RATE_LIMITER_TTL_MS;
    for (const [key, timestamp] of this.rateLimiter.entries()) {
      if (timestamp < cutoff) {
        this.rateLimiter.delete(key);
      }
    }
  }

  /**
   * Pause broadcasting (when tab hidden)
   * @private
   */
  _pauseBroadcasting() {
    this._paused = true;
    console.log('[BroadcastSync] Paused (tab hidden)');
  }

  /**
   * Resume broadcasting (when tab visible)
   * @private
   */
  _resumeBroadcasting() {
    this._paused = false;
    console.log('[BroadcastSync] Resumed (tab visible)');
  }

  /**
   * Check if broadcasting is active
   * @private
   * @returns {boolean}
   */
  _isActive() {
    return !this._closed && !this._paused;
  }

  /**
   * Close channel and cleanup ALL resources
   * CRITICAL: Must be idempotent (safe to call multiple times)
   */
  close() {
    if (this._closed) return; // Already closed

    console.log(`[BroadcastSync] Closing channel: quick-tabs-${this.cookieStoreId}`);

    this._closeChannel();
    this._clearMaps();
    this._removeLifecycleHooks();

    // Mark as closed (prevent double-close)
    this._closed = true;
  }

  /**
   * Close the BroadcastChannel
   * @private
   */
  _closeChannel() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // Ignore errors on close
      }
      this.channel = null;
    }
  }

  /**
   * Clear all Maps to free memory
   * @private
   */
  _clearMaps() {
    if (this.listeners) {
      this.listeners.clear();
      this.listeners = null;
    }

    if (this.rateLimiter) {
      this.rateLimiter.clear();
      this.rateLimiter = null;
    }

    if (this.processedMessages) {
      this.processedMessages.clear();
      this.processedMessages = null;
    }
  }

  /**
   * Remove lifecycle event hooks
   * @private
   */
  _removeLifecycleHooks() {
    if (typeof window !== 'undefined') {
      this._removeWindowHooks();
    }

    this._removeBrowserHooks();
  }

  /**
   * Remove window event listeners
   * @private
   */
  _removeWindowHooks() {
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    if (this._visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
      this._visibilityChangeHandler = null;
    }
  }

  /**
   * Remove browser runtime hooks
   * @private
   */
  _removeBrowserHooks() {
    if (typeof browser !== 'undefined' && browser.runtime?.onSuspend && this._suspendHandler) {
      browser.runtime.onSuspend.removeListener(this._suspendHandler);
      this._suspendHandler = null;
    }
  }

  /**
   * Send heartbeat to other tabs (for connection monitoring)
   * @returns {boolean} - True if sent successfully
   */
  sendHeartbeat() {
    return this.send(BroadcastSync.MESSAGE_TYPES.HEARTBEAT, {
      tabId: this.tabId,
      timestamp: Date.now()
    });
  }

  /**
   * Check if channel is closed
   * @returns {boolean}
   */
  isClosed() {
    return this._closed;
  }

  /**
   * Check if channel is paused
   * @returns {boolean}
   */
  isPaused() {
    return this._paused;
  }
}
