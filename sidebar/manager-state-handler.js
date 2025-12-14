// Manager State Handler
// Handles state management and UI for the Quick Tabs Manager sidebar

import {
  MESSAGE_TYPES,
  MessageBuilder,
  sendMessageWithTimeout
} from '../src/messaging/message-router.js';
import * as SchemaV2 from '../src/storage/schema-v2.js';

let currentState = null;
let renderCallback = null;
let isInitialized = false;

/**
 * Initialize the Manager state handler
 * @param {Function} onStateChange - Callback to render UI when state changes
 */
export async function initManagerState(onStateChange) {
  if (isInitialized) {
    console.log('[ManagerState] Already initialized');
    return;
  }

  renderCallback = onStateChange;

  // Set up message listener for state updates
  browser.runtime.onMessage.addListener(handleMessage);

  // Set up storage.onChanged fallback
  browser.storage.onChanged.addListener(handleStorageChanged);

  // Request initial state
  await requestFullState();

  isInitialized = true;
  console.log('[ManagerState] Initialized');
}

/**
 * Handle incoming messages
 */
function handleMessage(message, _sender) {
  if (
    message.type === MESSAGE_TYPES.SIDEBAR_UPDATE ||
    message.type === MESSAGE_TYPES.QT_STATE_SYNC
  ) {
    handleStateUpdate(message.state);
    return { success: true };
  }
}

/**
 * Handle storage.onChanged fallback
 */
function handleStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;
  if (!changes[SchemaV2.STORAGE_KEY]) return;

  const newState = changes[SchemaV2.STORAGE_KEY].newValue;
  if (SchemaV2.isValidState(newState)) {
    handleStateUpdate(newState);
  }
}

/**
 * Handle state update
 */
function handleStateUpdate(state) {
  if (!state) return;

  currentState = state;
  console.log('[ManagerState] State updated:', {
    quickTabCount: state.allQuickTabs?.length || 0
  });

  if (renderCallback) {
    renderCallback(state);
  }
}

/**
 * Request full state from background
 */
export async function requestFullState() {
  try {
    const response = await sendMessageWithTimeout(
      {
        type: MESSAGE_TYPES.REQUEST_FULL_STATE,
        correlationId: `manager-request-${Date.now()}`,
        timestamp: Date.now()
      },
      5000
    );

    if (response?.success && response.state) {
      handleStateUpdate(response.state);
    }
  } catch (error) {
    console.warn('[ManagerState] Failed to request state:', error);
    await fallbackToStorage();
  }
}

/**
 * Fallback to read directly from storage
 */
async function fallbackToStorage() {
  try {
    const result = await browser.storage.local.get(SchemaV2.STORAGE_KEY);
    if (result[SchemaV2.STORAGE_KEY]) {
      handleStateUpdate(result[SchemaV2.STORAGE_KEY]);
    }
  } catch (storageError) {
    console.error('[ManagerState] Storage fallback failed:', storageError);
  }
}

/**
 * Get Quick Tabs grouped by origin tab
 */
export function getQuickTabsGroupedByOrigin() {
  if (!currentState?.allQuickTabs) return new Map();

  const grouped = new Map();

  for (const qt of currentState.allQuickTabs) {
    const originTabId = qt.originTabId || 0;
    if (!grouped.has(originTabId)) {
      grouped.set(originTabId, []);
    }
    grouped.get(originTabId).push(qt);
  }

  return grouped;
}

/**
 * Get all Quick Tabs
 */
export function getAllQuickTabs() {
  return currentState?.allQuickTabs || [];
}

/**
 * Get minimized Quick Tabs
 */
export function getMinimizedQuickTabs() {
  if (!currentState) return [];
  return SchemaV2.getMinimizedQuickTabs(currentState);
}

/**
 * Get active (non-minimized) Quick Tabs
 */
export function getActiveQuickTabs() {
  if (!currentState) return [];
  return SchemaV2.getActiveQuickTabs(currentState);
}

/**
 * Get Quick Tabs count
 */
export function getQuickTabsCount() {
  return currentState?.allQuickTabs?.length || 0;
}

// ============================================
// Manager Actions (Pattern C)
// ============================================

/**
 * Minimize a Quick Tab
 */
export async function minimizeQuickTab(quickTabId) {
  try {
    const message = MessageBuilder.buildManagerAction(MESSAGE_TYPES.QT_MINIMIZED, {
      quickTabId
    });

    await sendMessageWithTimeout(message, 5000);
    console.log('[ManagerState] Minimized:', quickTabId);
  } catch (error) {
    console.error('[ManagerState] Minimize failed:', error);
    throw error;
  }
}

/**
 * Restore a Quick Tab
 */
export async function restoreQuickTab(quickTabId) {
  try {
    const message = MessageBuilder.buildManagerAction(MESSAGE_TYPES.QT_RESTORED, {
      quickTabId
    });

    await sendMessageWithTimeout(message, 5000);
    console.log('[ManagerState] Restored:', quickTabId);
  } catch (error) {
    console.error('[ManagerState] Restore failed:', error);
    throw error;
  }
}

/**
 * Close a Quick Tab
 */
export async function closeQuickTab(quickTabId) {
  try {
    const message = MessageBuilder.buildManagerAction(MESSAGE_TYPES.QT_CLOSED, {
      quickTabId
    });

    await sendMessageWithTimeout(message, 5000);
    console.log('[ManagerState] Closed:', quickTabId);
  } catch (error) {
    console.error('[ManagerState] Close failed:', error);
    throw error;
  }
}

/**
 * Close all Quick Tabs
 */
export async function closeAllQuickTabs() {
  try {
    const message = MessageBuilder.buildManagerAction(MESSAGE_TYPES.MANAGER_CLOSE_ALL, {});

    const response = await sendMessageWithTimeout(message, 5000);
    console.log('[ManagerState] Closed all:', response?.closedCount);
    return response?.closedCount || 0;
  } catch (error) {
    console.error('[ManagerState] Close all failed:', error);
    throw error;
  }
}

/**
 * Close all minimized Quick Tabs
 */
export async function closeMinimizedQuickTabs() {
  try {
    const message = MessageBuilder.buildManagerAction(MESSAGE_TYPES.MANAGER_CLOSE_MINIMIZED, {});

    const response = await sendMessageWithTimeout(message, 5000);
    console.log('[ManagerState] Closed minimized:', response?.closedCount);
    return response?.closedCount || 0;
  } catch (error) {
    console.error('[ManagerState] Close minimized failed:', error);
    throw error;
  }
}

/**
 * Focus a Quick Tab's origin tab
 */
export async function focusOriginTab(originTabId) {
  try {
    await browser.tabs.update(originTabId, { active: true });
    const tab = await browser.tabs.get(originTabId);
    if (tab.windowId) {
      await browser.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    console.warn('[ManagerState] Failed to focus tab:', error);
  }
}

/**
 * Get current state
 */
export function getCurrentState() {
  return currentState;
}

/**
 * Clean up
 */
export function cleanup() {
  browser.runtime.onMessage.removeListener(handleMessage);
  browser.storage.onChanged.removeListener(handleStorageChanged);
  isInitialized = false;
  currentState = null;
  renderCallback = null;
  console.log('[ManagerState] Cleaned up');
}
