// Background Message Handler
// Handles all Quick Tabs messages using tabs.sendMessage architecture

import { MESSAGE_TYPES, MessageValidator } from '../messaging/message-router.js';
import * as SchemaV2 from '../storage/schema-v2.js';
import { StorageManager, generateCorrelationId } from '../storage/storage-manager.js';

const storageManager = new StorageManager();

// Message handler registry
const messageHandlers = {
  [MESSAGE_TYPES.QT_POSITION_CHANGED]: handlePositionChanged,
  [MESSAGE_TYPES.QT_SIZE_CHANGED]: handleSizeChanged,
  [MESSAGE_TYPES.QT_CREATED]: handleQuickTabCreated,
  [MESSAGE_TYPES.QT_MINIMIZED]: handleMinimize,
  [MESSAGE_TYPES.QT_RESTORED]: handleRestore,
  [MESSAGE_TYPES.QT_CLOSED]: handleClose,
  [MESSAGE_TYPES.MANAGER_CLOSE_ALL]: handleCloseAll,
  [MESSAGE_TYPES.MANAGER_CLOSE_MINIMIZED]: handleCloseMinimized,
  [MESSAGE_TYPES.REQUEST_FULL_STATE]: handleRequestFullState,
  [MESSAGE_TYPES.CONTENT_SCRIPT_READY]: handleContentScriptReady,
  [MESSAGE_TYPES.CONTENT_SCRIPT_UNLOAD]: handleContentScriptUnload
};

// v1.6.3.8-v12 GAP-11 fix: Track first message received for diagnostics
let firstMessageReceived = false;
let handlerRegistrationTime = null;

/**
 * Initialize the message handler
 * v1.6.3.8-v12 GAP-11 fix: Add early-load logging with timestamp
 */
export function initializeMessageHandler() {
  handlerRegistrationTime = Date.now();
  console.log('[MessageHandler] INIT_START:', {
    timestamp: handlerRegistrationTime
  });

  browser.runtime.onMessage.addListener(handleMessage);

  console.log('[MessageHandler] INIT_COMPLETE: Listener registered:', {
    timestamp: Date.now(),
    durationMs: Date.now() - handlerRegistrationTime
  });
}

/**
 * Main message handler
 *
 * @param {Object} message - Message object
 * @param {Object} sender - Message sender
 * @returns {Promise<Object>} Handler response
 */
async function handleMessage(message, sender) {
  // v1.6.3.8-v12 GAP-11 fix: Log first message received
  if (!firstMessageReceived) {
    firstMessageReceived = true;
    console.log('[MessageHandler] FIRST_MESSAGE_RECEIVED:', {
      type: message.type,
      senderTabId: sender?.tab?.id,
      timeSinceInit: handlerRegistrationTime ? Date.now() - handlerRegistrationTime : 'unknown',
      timestamp: Date.now()
    });
  }

  // Validate message
  const validation = MessageValidator.validate(message);
  if (!validation.valid) {
    console.warn('[MessageHandler] Invalid message:', validation.errors);
    return {
      success: false,
      error: 'Invalid message',
      details: validation.errors
    };
  }

  const handler = messageHandlers[message.type];
  if (!handler) {
    console.warn('[MessageHandler] Unknown message type:', message.type);
    return { success: false, error: `Unknown message type: ${message.type}` };
  }

  try {
    console.log('[MessageHandler] Processing:', message.type, {
      correlationId: message.correlationId,
      sender: sender?.tab?.id
    });

    const result = await handler(message, sender);
    return { success: true, ...result };
  } catch (error) {
    console.error('[MessageHandler] Handler error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// Pattern A: Local Updates (no broadcast)
// ============================================

/**
 * Handle position change message
 *
 * @param {Object} message - Message with quickTabId and newPosition
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result
 */
async function handlePositionChanged(message, _sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    position: message.newPosition
  });

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  return { updated: true, pattern: 'LOCAL' };
}

/**
 * Handle size change message
 *
 * @param {Object} message - Message with quickTabId and newSize
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result
 */
async function handleSizeChanged(message, _sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    size: message.newSize
  });

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  return { updated: true, pattern: 'LOCAL' };
}

// ============================================
// Pattern B: Global Actions (broadcast to all)
// ============================================

/**
 * Handle Quick Tab creation message
 *
 * @param {Object} message - Message with quickTab data
 * @param {Object} sender - Message sender
 * @returns {Promise<Object>} Handler result with created quickTabId
 */
async function handleQuickTabCreated(message, sender) {
  const state = await storageManager.readState();

  const newQuickTab = {
    id: message.quickTab.id || generateCorrelationId('qt'),
    originTabId: message.quickTab.originTabId || sender?.tab?.id || 0,
    url: message.quickTab.url,
    position: message.quickTab.position || { x: 100, y: 100 },
    size: message.quickTab.size || { w: 800, h: 600 },
    minimized: false,
    createdAt: Date.now()
  };

  const updated = SchemaV2.addQuickTab(state, newQuickTab);
  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { created: true, quickTabId: newQuickTab.id, pattern: 'GLOBAL' };
}

/**
 * Handle minimize message
 *
 * @param {Object} message - Message with quickTabId
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result
 */
async function handleMinimize(message, _sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    minimized: true
  });

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { minimized: true, pattern: 'GLOBAL' };
}

/**
 * Handle restore message
 *
 * @param {Object} message - Message with quickTabId
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result
 */
async function handleRestore(message, _sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.updateQuickTab(state, message.quickTabId, {
    minimized: false
  });

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { restored: true, pattern: 'GLOBAL' };
}

/**
 * Handle close message
 *
 * @param {Object} message - Message with quickTabId
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result
 */
async function handleClose(message, _sender) {
  const state = await storageManager.readState();
  const updated = SchemaV2.removeQuickTab(state, message.quickTabId);

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { closed: true, pattern: 'GLOBAL' };
}

// ============================================
// Pattern C: Manager Actions (broadcast to all)
// ============================================

/**
 * Handle close all Quick Tabs message
 *
 * @param {Object} message - Message object
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result with closed count
 */
async function handleCloseAll(message, _sender) {
  const state = await storageManager.readState();
  const closedCount = state.allQuickTabs.length;

  const updated = SchemaV2.clearAllQuickTabs(state);
  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { closedCount, pattern: 'MANAGER' };
}

/**
 * Handle close minimized Quick Tabs message
 *
 * @param {Object} message - Message object
 * @param {Object} _sender - Message sender (unused)
 * @returns {Promise<Object>} Handler result with closed count
 */
async function handleCloseMinimized(message, _sender) {
  const state = await storageManager.readState();
  const minimized = SchemaV2.getMinimizedQuickTabs(state);
  const closedCount = minimized.length;

  let updated = state;
  for (const qt of minimized) {
    updated = SchemaV2.removeQuickTab(updated, qt.id);
  }

  await storageManager.writeStateWithValidation(updated, message.correlationId);

  // Broadcast to all tabs
  await broadcastStateToAllTabs(updated);
  await notifyManager(updated);

  return { closedCount, pattern: 'MANAGER' };
}

// ============================================
// State Sync & Lifecycle
// ============================================

/**
 * Handle request for full state
 *
 * @param {Object} _message - Message object (unused)
 * @param {Object} sender - Message sender
 * @returns {Promise<Object>} Handler result with state
 */
async function handleRequestFullState(_message, sender) {
  const state = await storageManager.readState();
  const tabId = sender?.tab?.id;

  // Filter by originTabId if tab is known
  let relevantTabs = state.allQuickTabs;
  if (tabId) {
    relevantTabs = SchemaV2.getQuickTabsByOriginTabId(state, tabId);
  }

  return {
    tabId: tabId,
    state: {
      ...state,
      allQuickTabs: relevantTabs
    },
    pattern: 'SYNC'
  };
}

/**
 * Handle content script ready message
 *
 * @param {Object} _message - Message object (unused)
 * @param {Object} sender - Message sender
 * @returns {Promise<Object>} Handler result with Quick Tabs for this tab
 */
async function handleContentScriptReady(_message, sender) {
  const tabId = sender?.tab?.id;
  console.log('[MessageHandler] Content script ready:', tabId);

  // Send initial state to the tab
  const state = await storageManager.readState();
  const myQuickTabs = tabId ? SchemaV2.getQuickTabsByOriginTabId(state, tabId) : [];

  return {
    ready: true,
    tabId: tabId,
    quickTabs: myQuickTabs,
    pattern: 'LIFECYCLE'
  };
}

/**
 * Handle content script unload message
 *
 * @param {Object} _message - Message object (unused)
 * @param {Object} sender - Message sender
 * @returns {Object} Handler result
 */
function handleContentScriptUnload(_message, sender) {
  const tabId = sender?.tab?.id;
  console.log('[MessageHandler] Content script unloading:', tabId);

  // Note: We don't remove Quick Tabs when content script unloads
  // because the user might reload the page

  return { acknowledged: true, pattern: 'LIFECYCLE' };
}

// ============================================
// Broadcasting Utilities
// ============================================

/**
 * Broadcast state update to all tabs
 * v1.6.3.8-v12 GAP-5, GAP-14 fix: Enhanced logging to confirm broadcast execution
 *
 * @param {Object} state - State to broadcast
 * @returns {Promise<void>}
 */
async function broadcastStateToAllTabs(state) {
  const broadcastStartTime = Date.now();
  const correlationId = generateCorrelationId('broadcast');

  console.log('[MessageHandler] BROADCAST_START:', {
    correlationId,
    quickTabCount: state?.allQuickTabs?.length || 0,
    timestamp: broadcastStartTime
  });

  try {
    const tabs = await browser.tabs.query({});
    const httpTabs = tabs.filter(tab => tab.url?.startsWith('http'));

    console.log('[MessageHandler] BROADCAST_TARGETS:', {
      correlationId,
      totalTabs: tabs.length,
      httpTabs: httpTabs.length
    });

    const promises = httpTabs.map(tab =>
      browser.tabs
        .sendMessage(tab.id, {
          type: MESSAGE_TYPES.QT_STATE_SYNC,
          state: state,
          correlationId,
          timestamp: Date.now()
        })
        .then(() => ({ tabId: tab.id, success: true }))
        .catch(() => ({ tabId: tab.id, success: false }))
    );

    const results = await Promise.allSettled(promises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;

    console.log('[MessageHandler] BROADCAST_COMPLETE:', {
      correlationId,
      totalTargets: httpTabs.length,
      successCount,
      failedCount: httpTabs.length - successCount,
      durationMs: Date.now() - broadcastStartTime
    });
  } catch (error) {
    console.warn('[MessageHandler] BROADCAST_ERROR:', {
      correlationId,
      error: error.message,
      durationMs: Date.now() - broadcastStartTime
    });
    // Not critical - storage.onChanged provides fallback
  }
}

/**
 * Notify the sidebar manager of state changes
 *
 * @param {Object} state - State to send to manager
 * @returns {Promise<void>}
 */
async function notifyManager(state) {
  try {
    // Send to sidebar via runtime.sendMessage (will be caught by sidebar listener)
    await browser.runtime
      .sendMessage({
        type: MESSAGE_TYPES.SIDEBAR_UPDATE,
        state: state,
        correlationId: generateCorrelationId('manager'),
        timestamp: Date.now()
      })
      .catch(() => {
        // Sidebar not open - OK
      });
  } catch (_error) {
    // Sidebar not open - OK
  }
}

// ============================================
// Exports
// ============================================

export { handleMessage, broadcastStateToAllTabs, notifyManager, storageManager };
