/**
 * Mock for storage-utils module
 * Used in unit tests to prevent actual storage operations
 */

export const STATE_KEY = 'quick_tabs_state_v2';

// v1.6.3.12 - Mock for z-index counter key
export const ZINDEX_COUNTER_KEY = 'quickTabsZIndexCounter';

// v1.6.3.4-v6 - Mock transaction tracking
export const IN_PROGRESS_TRANSACTIONS = new Set();

export function generateSaveId() {
  return `test-${Date.now()}-mockid`;
}

export function generateTransactionId() {
  return `test-txn-${Date.now()}`;
}

export function isValidQuickTabUrl(url) {
  if (!url || url === 'undefined') return false;
  if (String(url).includes('/undefined')) return false;
  if (url === 'about:blank') return true;
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('chrome-extension://')
  );
}

export function shouldProcessStorageChange(_transactionId) {
  return true;
}

export function computeStateHash(_state) {
  return 0;
}

export function hasStateChanged(_state) {
  return true;
}

export function validateStateForPersist(state) {
  if (!state) return { valid: false, errors: ['State is null'] };
  if (!state.tabs) return { valid: false, errors: ['No tabs'] };
  return { valid: true, errors: [] };
}

export function getBrowserStorageAPI() {
  // Return null in tests to skip storage operations
  return null;
}

// v1.6.3.11-v9 - Mock for getWritingContainerId
export function getWritingContainerId() {
  return null;
}

// v1.6.3.11-v9 - Mock for isIdentityReady
export function isIdentityReady() {
  return true;
}

// v1.6.3.11-v9 - Mock for waitForIdentityInit
export async function waitForIdentityInit(_timeoutMs = 3000) {
  return { isReady: true, tabId: 123, containerId: 'firefox-default' };
}

// v1.6.3.10-v6 - Mock for normalizeOriginTabId
export function normalizeOriginTabId(tabId, _context) {
  if (tabId === null || tabId === undefined) return null;
  const normalized = Number(tabId);
  if (!Number.isInteger(normalized) || normalized < 0) return null;
  return normalized;
}

export function buildStateForStorage(quickTabsMap, minimizedManager) {
  const tabs = [];
  for (const tab of quickTabsMap.values()) {
    const isMinimized = minimizedManager?.isMinimized?.(tab.id) || false;
    tabs.push({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      left: tab.left,
      top: tab.top,
      width: tab.width,
      height: tab.height,
      minimized: isMinimized,
      soloedOnTabs: tab.soloedOnTabs || [],
      mutedOnTabs: tab.mutedOnTabs || []
    });
  }
  return {
    tabs: tabs,
    timestamp: Date.now(),
    saveId: generateSaveId()
  };
}

export function persistStateToStorage(_state, _logPrefix) {
  // No-op in tests
  return Promise.resolve(true);
}

// v1.6.3.12 - FIX Issue #14: Mock StorageCoordinator
class MockStorageCoordinator {
  constructor() {
    this._writeQueue = [];
    this._isWriting = false;
    this._writeCount = 0;
    this._currentHandler = null;
  }

  async queueWrite(handlerName, writeOperation) {
    this._writeCount++;
    this._currentHandler = handlerName;
    try {
      return await writeOperation();
    } finally {
      this._currentHandler = null;
    }
  }

  getStatus() {
    return {
      queueSize: this._writeQueue.length,
      isWriting: this._isWriting,
      currentHandler: this._currentHandler,
      totalWrites: this._writeCount,
      pendingHandlers: []
    };
  }

  clearQueue() {
    this._writeQueue = [];
  }
}

const mockStorageCoordinator = new MockStorageCoordinator();

export function getStorageCoordinator() {
  return mockStorageCoordinator;
}

// v1.6.3.12 - FIX Issue #15: Mock storage listener health monitoring
export function startStorageListenerHealthMonitor() {
  return true;
}

export function stopStorageListenerHealthMonitor() {
  // No-op
}

export function getStorageListenerHealthStatus() {
  return {
    isRegistered: true,
    listenerAddress: 'test-listener',
    lastHeartbeatSent: Date.now(),
    lastHeartbeatReceived: Date.now(),
    missedHeartbeats: 0,
    reregistrationCount: 0
  };
}

// v1.6.3.12 - FIX Issue #17: Mock z-index counter persistence
export async function loadZIndexCounter(defaultValue = 1000) {
  return defaultValue;
}

export async function saveZIndexCounter(_value) {
  return true;
}

// v1.6.3.12 - FIX Issue #16: Mock originTabId validation
export function validateOriginTabIdForSerialization(quickTab, _context = 'unknown') {
  const originTabId = quickTab?.originTabId;
  if (originTabId === null || originTabId === undefined) {
    return { valid: false, originTabId: null, warning: 'originTabId is null or undefined' };
  }
  return { valid: true, originTabId };
}
