// Content Script Message Listener
// Receives state updates from background via tabs.sendMessage

import {
  MESSAGE_TYPES,
  MessageBuilder,
  sendMessageWithTimeout,
  generateMessageId
} from '../../messaging/message-router.js';
import * as SchemaV2 from '../../storage/schema-v2.js';

let currentTabId = null;
let uiCoordinatorRef = null;
let isInitialized = false;

/**
 * Initialize the content script message listener
 * @param {UICoordinator} uiCoordinator - Reference to UICoordinator for rendering
 */
export async function initContentMessageListener(uiCoordinator) {
  if (isInitialized) {
    console.log('[ContentMessageListener] Already initialized');
    return;
  }

  uiCoordinatorRef = uiCoordinator;

  // Get current tab ID
  try {
    const response = await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.CONTENT_SCRIPT_READY,
      correlationId: generateMessageId('ready'),
      timestamp: Date.now()
    });

    if (response?.success) {
      // Get tab ID from background response
      currentTabId = response.tabId || null;
      console.log('[ContentMessageListener] Ready, tabId:', currentTabId);
    }

    // Process initial Quick Tabs from response
    const quickTabs = response?.quickTabs;
    if (quickTabs && Array.isArray(quickTabs)) {
      await hydrateQuickTabs(quickTabs);
    }
  } catch (error) {
    console.warn('[ContentMessageListener] Failed to signal ready:', error);
    // Try to get tab ID via fallback
    currentTabId = await requestTabIdFromBackground();
  }

  // Set up message listener
  browser.runtime.onMessage.addListener(handleMessage);

  // Set up storage.onChanged fallback listener
  browser.storage.onChanged.addListener(handleStorageChanged);

  // Set up unload listener
  window.addEventListener('beforeunload', handleUnload);
  window.addEventListener('pagehide', handlePageHide);

  isInitialized = true;
  console.log('[ContentMessageListener] Initialized for tab:', currentTabId);
}

/**
 * Request tab ID from background as a fallback
 * Note: browser.tabs.getCurrent() returns null in content scripts,
 * so we must request the tab ID from the background script
 */
async function requestTabIdFromBackground() {
  try {
    const response = await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.REQUEST_FULL_STATE,
      correlationId: `tab-id-request-${Date.now()}`,
      timestamp: Date.now()
    });
    return response?.tabId || null;
  } catch (error) {
    console.warn('[ContentMessageListener] Could not get tab ID:', error);
    return null;
  }
}

/**
 * Handle incoming messages from background
 */
async function handleMessage(message, sender) {
  // Only accept messages from our extension
  if (sender.id !== browser.runtime.id) {
    return;
  }

  // Handle state sync messages
  if (message.type === MESSAGE_TYPES.QT_STATE_SYNC) {
    await handleStateSync(message);
    return { success: true };
  }

  // Handle sidebar updates (for sidebar instances)
  if (message.type === MESSAGE_TYPES.SIDEBAR_UPDATE) {
    await handleStateSync(message);
    return { success: true };
  }

  return { success: false, error: 'Unknown message type' };
}

/**
 * Handle state sync from background
 */
async function handleStateSync(message) {
  if (!message.state || !uiCoordinatorRef) {
    console.warn('[ContentMessageListener] Invalid state sync:', {
      hasState: !!message.state,
      hasCoordinator: !!uiCoordinatorRef
    });
    return;
  }

  console.log('[ContentMessageListener] State sync received:', {
    correlationId: message.correlationId,
    quickTabCount: message.state.allQuickTabs?.length || 0
  });

  // Filter by originTabId for this tab
  const myQuickTabs = currentTabId
    ? SchemaV2.getQuickTabsByOriginTabId(message.state, currentTabId)
    : message.state.allQuickTabs || [];

  // Sync UI with filtered state
  await uiCoordinatorRef.syncState(myQuickTabs);
}

/**
 * Handle storage.onChanged as fallback sync
 */
async function handleStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;
  if (!changes[SchemaV2.STORAGE_KEY]) return;

  const newState = changes[SchemaV2.STORAGE_KEY].newValue;
  if (!newState || !SchemaV2.isValidState(newState)) {
    console.warn('[ContentMessageListener] Invalid state in storage change');
    return;
  }

  console.log('[ContentMessageListener] Storage fallback sync');

  // Filter by originTabId
  const myQuickTabs = currentTabId
    ? SchemaV2.getQuickTabsByOriginTabId(newState, currentTabId)
    : newState.allQuickTabs || [];

  // Sync UI
  if (uiCoordinatorRef) {
    await uiCoordinatorRef.syncState(myQuickTabs);
  }
}

/**
 * Hydrate Quick Tabs on initial load
 */
async function hydrateQuickTabs(quickTabs) {
  if (!uiCoordinatorRef) {
    console.warn('[ContentMessageListener] No UICoordinator for hydration');
    return;
  }

  console.log('[ContentMessageListener] Hydrating', quickTabs.length, 'Quick Tabs');

  for (const qt of quickTabs) {
    try {
      await uiCoordinatorRef.render(qt);
    } catch (error) {
      console.error('[ContentMessageListener] Failed to render QT:', qt.id, error);
    }
  }
}

/**
 * Handle page unload
 */
function handleUnload() {
  notifyUnload();
}

/**
 * Handle page hide (BFCache)
 */
function handlePageHide(event) {
  if (event.persisted) {
    // Page is being cached - don't clean up
    console.log('[ContentMessageListener] Page entering BFCache');
  } else {
    notifyUnload();
  }
}

/**
 * Notify background of content script unload
 */
async function notifyUnload() {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.CONTENT_SCRIPT_UNLOAD,
      tabId: currentTabId,
      correlationId: generateMessageId('unload'),
      timestamp: Date.now()
    });
  } catch (_error) {
    // Tab closing - expected error
  }
}

/**
 * Send position change to background (Pattern A - local)
 */
export async function notifyPositionChanged(quickTabId, newPosition) {
  try {
    const message = MessageBuilder.buildLocalUpdate(
      MESSAGE_TYPES.QT_POSITION_CHANGED,
      quickTabId,
      { newPosition },
      currentTabId
    );

    await sendMessageWithTimeout(message, 5000);
  } catch (error) {
    console.warn('[ContentMessageListener] Position update failed:', error);
    // Fallback: storage.onChanged will eventually sync
  }
}

/**
 * Send size change to background (Pattern A - local)
 */
export async function notifySizeChanged(quickTabId, newSize) {
  try {
    const message = MessageBuilder.buildLocalUpdate(
      MESSAGE_TYPES.QT_SIZE_CHANGED,
      quickTabId,
      { newSize },
      currentTabId
    );

    await sendMessageWithTimeout(message, 5000);
  } catch (error) {
    console.warn('[ContentMessageListener] Size update failed:', error);
  }
}

/**
 * Send minimize action to background (Pattern B - global)
 */
export async function notifyMinimized(quickTabId) {
  try {
    const message = MessageBuilder.buildGlobalAction(
      MESSAGE_TYPES.QT_MINIMIZED,
      quickTabId,
      {},
      currentTabId
    );

    await sendMessageWithTimeout(message, 5000);
  } catch (error) {
    console.error('[ContentMessageListener] Minimize failed:', error);
    throw error;
  }
}

/**
 * Send restore action to background (Pattern B - global)
 */
export async function notifyRestored(quickTabId) {
  try {
    const message = MessageBuilder.buildGlobalAction(
      MESSAGE_TYPES.QT_RESTORED,
      quickTabId,
      {},
      currentTabId
    );

    await sendMessageWithTimeout(message, 5000);
  } catch (error) {
    console.error('[ContentMessageListener] Restore failed:', error);
    throw error;
  }
}

/**
 * Send close action to background (Pattern B - global)
 */
export async function notifyClosed(quickTabId) {
  try {
    const message = MessageBuilder.buildGlobalAction(
      MESSAGE_TYPES.QT_CLOSED,
      quickTabId,
      {},
      currentTabId
    );

    await sendMessageWithTimeout(message, 5000);
  } catch (error) {
    console.error('[ContentMessageListener] Close failed:', error);
    throw error;
  }
}

/**
 * Request Quick Tab creation (Pattern B - global)
 */
export async function requestQuickTabCreation(quickTabData) {
  try {
    const message = MessageBuilder.buildGlobalAction(
      MESSAGE_TYPES.QT_CREATED,
      null,
      { quickTab: { ...quickTabData, originTabId: currentTabId } },
      currentTabId
    );

    const response = await sendMessageWithTimeout(message, 5000);
    return response?.quickTabId;
  } catch (error) {
    console.error('[ContentMessageListener] Creation failed:', error);
    throw error;
  }
}

/**
 * Get current tab ID
 */
export function getTabId() {
  return currentTabId;
}

/**
 * Check if initialized
 */
export function isListenerInitialized() {
  return isInitialized;
}

/**
 * Clean up listeners
 */
export function cleanup() {
  browser.runtime.onMessage.removeListener(handleMessage);
  browser.storage.onChanged.removeListener(handleStorageChanged);
  window.removeEventListener('beforeunload', handleUnload);
  window.removeEventListener('pagehide', handlePageHide);
  isInitialized = false;
  uiCoordinatorRef = null;
  console.log('[ContentMessageListener] Cleaned up');
}
