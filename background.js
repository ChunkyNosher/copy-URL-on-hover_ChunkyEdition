// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs
// v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load

// v1.6.0 - PHASE 3.1: Import message routing infrastructure
import { LogHandler } from './src/background/handlers/LogHandler.js';
import { QuickTabHandler } from './src/background/handlers/QuickTabHandler.js';
import { TabHandler } from './src/background/handlers/TabHandler.js';
import { MessageRouter } from './src/background/MessageRouter.js';
// v1.6.0 - PHASE 3.2: Import storage format detection and migration strategies
import { LegacyMigrator } from './src/background/strategies/formatMigrators/LegacyMigrator.js';
import { V1_5_8_14_Migrator } from './src/background/strategies/formatMigrators/V1_5_8_14_Migrator.js';
import { V1_5_8_15_Migrator } from './src/background/strategies/formatMigrators/V1_5_8_15_Migrator.js';
import { StorageFormatDetector } from './src/background/strategies/StorageFormatDetector.js';

const runtimeAPI =
  (typeof browser !== 'undefined' && browser.runtime) ||
  (typeof chrome !== 'undefined' && chrome.runtime) ||
  null;

const downloadsAPI =
  (typeof browser !== 'undefined' && browser.downloads) ||
  (typeof chrome !== 'undefined' && chrome.downloads) ||
  null;

const EXTENSION_ID = runtimeAPI?.id || null;

// ==================== LOG CAPTURE FOR EXPORT ====================
// Log buffer for background script
const BACKGROUND_LOG_BUFFER = [];
const MAX_BACKGROUND_BUFFER_SIZE = 2000;

function addBackgroundLog(type, ...args) {
  if (BACKGROUND_LOG_BUFFER.length >= MAX_BACKGROUND_BUFFER_SIZE) {
    BACKGROUND_LOG_BUFFER.shift();
  }

  BACKGROUND_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: args
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' '),
    args: args
  });
}

// Override console methods to capture logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

console.log = function (...args) {
  addBackgroundLog('DEBUG', ...args);
  originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
  addBackgroundLog('ERROR', ...args);
  originalConsoleError.apply(console, args);
};

console.warn = function (...args) {
  addBackgroundLog('WARN', ...args);
  originalConsoleWarn.apply(console, args);
};

console.info = function (...args) {
  addBackgroundLog('INFO', ...args);
  originalConsoleInfo.apply(console, args);
};

// ==================== STATE MANAGEMENT ====================

// Store Quick Tab states per tab
const quickTabStates = new Map();

// ==================== REAL-TIME STATE COORDINATOR ====================
// Global state hub for real-time Quick Tab synchronization across all tabs
// v1.6.2.2 - ISSUE #35/#51 FIX: Unified format (no container separation)
// This provides instant cross-origin sync (< 50ms latency)
// v1.5.8.13 - Enhanced with eager loading for Issue #35 and #51
const globalQuickTabState = {
  // v1.6.2.2 - Unified format: single tabs array for global visibility
  tabs: [],
  lastUpdate: 0
};

// Flag to track initialization status
let isInitialized = false;

// v1.6.1.6 - Memory leak fix: State hash for deduplication
// Prevents redundant broadcasts when state hasn't actually changed
let lastBroadcastedStateHash = 0;

// v1.6.1.6 - Memory leak fix: Window for ignoring self-triggered storage events (ms)
const WRITE_IGNORE_WINDOW_MS = 100;

/**
 * Compute a simple hash of the Quick Tab state for deduplication
 * v1.6.1.6 - Memory leak fix: Used to skip redundant broadcasts
 * v1.6.2.2 - Updated for unified format
 * @param {Object} state - Quick Tab state object
 * @returns {number} 32-bit hash of the state
 */
function computeStateHash(state) {
  if (!state) return 0;
  // Note: Intentionally excluding timestamp from hash to detect actual state changes
  // v1.6.2.2 - Unified format: single tabs array
  const stateStr = JSON.stringify({
    tabData: (state.tabs || []).map(t => ({
      id: t.id,
      url: t.url,
      left: t.left || t.position?.left,
      top: t.top || t.position?.top,
      width: t.width || t.size?.width,
      height: t.height || t.size?.height,
      minimized: t.minimized || t.visibility?.minimized
    }))
  });
  let hash = 0;
  for (let i = 0; i < stateStr.length; i++) {
    hash = ((hash << 5) - hash) + stateStr.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

// v1.6.2.2 - Format detection and migrators removed (unified format)

/**
 * v1.5.8.13 - EAGER LOADING: Initialize global state from storage on extension startup
 * v1.6.2.2 - Simplified for unified format
 */
async function initializeGlobalState() {
  // Guard: Already initialized
  if (isInitialized) {
    console.log('[Background] State already initialized');
    return;
  }

  try {
    // Try session storage first (faster)
    const loaded = await tryLoadFromSessionStorage();
    if (loaded) return;

    // Fall back to sync storage
    await tryLoadFromSyncStorage();
  } catch (err) {
    console.error('[Background] Error initializing global state:', err);
    isInitialized = true; // Mark as initialized even on error to prevent blocking
  }
}

/**
 * Helper: Try loading from session storage
 *
 * @returns {Promise<boolean>} True if loaded successfully
 */
async function tryLoadFromSessionStorage() {
  // Guard: Session storage not available
  if (typeof browser.storage.session === 'undefined') {
    return false;
  }

  const result = await browser.storage.session.get('quick_tabs_session');

  // Guard: No data in session storage
  if (!result || !result.quick_tabs_session) {
    return false;
  }

  // v1.6.2.2 - Load unified format directly
  const sessionState = result.quick_tabs_session;
  
  // v1.6.2.2 - Unified format
  if (sessionState.tabs && Array.isArray(sessionState.tabs)) {
    globalQuickTabState.tabs = sessionState.tabs;
    globalQuickTabState.lastUpdate = sessionState.timestamp || Date.now();
    logSuccessfulLoad('session storage', 'v1.6.2.2 unified');
    isInitialized = true;
    return true;
  }
  
  // Backward compatibility: container format migration
  if (sessionState.containers) {
    globalQuickTabState.tabs = migrateContainersToUnifiedFormat(sessionState.containers);
    globalQuickTabState.lastUpdate = sessionState.timestamp || Date.now();
    logSuccessfulLoad('session storage', 'migrated from container format');
    isInitialized = true;
    return true;
  }

  return false;
}

/**
 * Migrate container format to unified format
 * v1.6.2.2 - Backward compatibility helper
 * 
 * @param {Object} containers - Container data object
 * @returns {Array} Unified tabs array (deduplicated)
 */
function migrateContainersToUnifiedFormat(containers) {
  const allTabs = [];
  const seenIds = new Set();
  
  for (const containerKey of Object.keys(containers)) {
    const tabs = containers[containerKey]?.tabs || [];
    if (tabs.length === 0) continue;
    
    console.log(`[Background] Migrating ${tabs.length} tabs from container: ${containerKey}`);
    
    for (const tab of tabs) {
      // Skip duplicate tab IDs
      if (seenIds.has(tab.id)) {
        console.warn(`[Background] Skipping duplicate tab ID during migration: ${tab.id}`);
        continue;
      }
      seenIds.add(tab.id);
      allTabs.push(tab);
    }
  }
  
  return allTabs;
}

/**
 * Helper: Get storage state from local or sync storage
 * @private
 * @returns {Promise<Object|null>} Storage state or null
 */
async function _getStorageState() {
  let result = await browser.storage.local.get('quick_tabs_state_v2');
  if (result?.quick_tabs_state_v2) {
    return result.quick_tabs_state_v2;
  }
  result = await browser.storage.sync.get('quick_tabs_state_v2');
  return result?.quick_tabs_state_v2 || null;
}

/**
 * Helper: Try loading from local/sync storage
 * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
 * v1.6.2.2 - Updated for unified format
 *
 * @returns {Promise<void>}
 */
async function tryLoadFromSyncStorage() {
  const state = await _getStorageState();

  // Guard: No data
  if (!state) {
    console.log('[Background] ✓ EAGER LOAD: No saved state found, starting with empty state');
    isInitialized = true;
    return;
  }

  // v1.6.2.2 - Unified format
  if (state.tabs && Array.isArray(state.tabs)) {
    globalQuickTabState.tabs = state.tabs;
    globalQuickTabState.lastUpdate = state.timestamp || Date.now();
    logSuccessfulLoad('storage', 'v1.6.2.2 unified');
    isInitialized = true;
    return;
  }
  
  // Backward compatibility: container format migration
  if (state.containers) {
    globalQuickTabState.tabs = migrateContainersToUnifiedFormat(state.containers);
    globalQuickTabState.lastUpdate = state.timestamp || Date.now();
    logSuccessfulLoad('storage', 'migrated from container format');
    await saveMigratedToUnifiedFormat();
  }

  isInitialized = true;
}

/**
 * Helper: Save migrated state to unified format
 * v1.6.2.2 - Save in new unified format
 *
 * @returns {Promise<void>}
 */
async function saveMigratedToUnifiedFormat() {
  const saveId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    await browser.storage.local.set({
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        saveId: saveId,
        timestamp: Date.now()
      }
    });
    console.log('[Background] ✓ Migrated to v1.6.2.2 unified format');
  } catch (err) {
    console.error('[Background] Error saving migrated state:', err);
  }
}

/**
 * Helper: Log successful state load
 * v1.6.2.2 - Updated for unified format
 *
 * @param {string} source - Storage source (session/sync)
 * @param {string} format - Format name
 */
function logSuccessfulLoad(source, format) {
  const totalTabs = globalQuickTabState.tabs?.length || 0;

  console.log(
    `[Background] ✓ EAGER LOAD: Initialized from ${source} (${format}):`,
    totalTabs,
    'tabs'
  );
}

// v1.5.8.13 - EAGER LOADING: Call initialization immediately on script load
initializeGlobalState();

/**
 * v1.5.9.13 - Migrate Quick Tab state from pinnedToUrl to soloedOnTabs/mutedOnTabs
 * v1.6.2.2 - Updated for unified format
 */
async function migrateQuickTabState() {
  // Guard: State not initialized
  if (!isInitialized) {
    console.warn('[Background Migration] State not initialized, skipping migration');
    return;
  }

  let migrated = false;

  // v1.6.2.2 - Process tabs array directly (unified format)
  for (const quickTab of (globalQuickTabState.tabs || [])) {
    if (migrateTabFromPinToSoloMute(quickTab)) {
      migrated = true;
    }
  }

  // Save if any tabs were migrated
  if (migrated) {
    await saveMigratedQuickTabState();
  } else {
    console.log('[Background Migration] No migration needed');
  }
}

/**
 * Helper: Migrate individual tab from pinnedToUrl to solo/mute format
 *
 * @param {Object} quickTab - Quick Tab object to migrate
 * @returns {boolean} True if migration occurred
 */
function migrateTabFromPinToSoloMute(quickTab) {
  // Guard: No pinnedToUrl property
  if (!('pinnedToUrl' in quickTab)) {
    return false;
  }

  console.log(
    `[Background Migration] Converting Quick Tab ${quickTab.id} from pin to solo/mute format`
  );

  // Initialize new properties
  quickTab.soloedOnTabs = quickTab.soloedOnTabs || [];
  quickTab.mutedOnTabs = quickTab.mutedOnTabs || [];

  // Remove old property
  delete quickTab.pinnedToUrl;

  return true;
}

/**
 * Helper: Save migrated Quick Tab state to storage
 * v1.6.2.2 - Updated for unified format
 *
 * @returns {Promise<void>}
 */
async function saveMigratedQuickTabState() {
  console.log('[Background Migration] Saving migrated Quick Tab state');

  const stateToSave = {
    tabs: globalQuickTabState.tabs,
    saveId: `migration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now()
  };

  try {
    // v1.6.0.12 - FIX: Use local storage to avoid quota errors
    await browser.storage.local.set({ quick_tabs_state_v2: stateToSave });
    console.log('[Background Migration] ✓ Migration complete');
  } catch (err) {
    console.error('[Background Migration] Error saving migrated state:', err);
  }
}

// Run migration after initialization
migrateQuickTabState();

// ==================== STATE COORDINATOR ====================
// Manages canonical Quick Tab state across all tabs with conflict resolution

class StateCoordinator {
  constructor() {
    this.globalState = {
      tabs: [],
      timestamp: 0,
      version: 1 // Increment on breaking changes
    };
    this.pendingConfirmations = new Map(); // saveId → {tabId, resolve, reject}
    this.tabVectorClocks = new Map(); // tabId → vector clock
    this.initialized = false;
  }

  /**
   * Initialize from storage
   * v1.6.0 - PHASE 3.2: Refactored to flatten nested blocks (cc=15 → cc<6)
   */
  async initialize() {
    // Guard: Already initialized
    if (this.initialized) {
      console.log('[STATE COORDINATOR] Already initialized');
      return;
    }

    try {
      // Try session storage first
      const loaded = await this.tryLoadFromSessionStorage();
      if (loaded) return;

      // Fall back to sync storage
      await this.tryLoadFromSyncStorage();
    } catch (err) {
      console.error('[STATE COORDINATOR] Error initializing:', err);
      this.initialized = true;
    }
  }

  /**
   * Helper: Try loading from session storage
   *
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async tryLoadFromSessionStorage() {
    // Guard: Session storage not available
    if (typeof browser.storage.session === 'undefined') {
      return false;
    }

    const result = await browser.storage.session.get('quick_tabs_session');

    // Guard: No valid data
    if (!result || !result.quick_tabs_session || !result.quick_tabs_session.tabs) {
      return false;
    }

    this.globalState = result.quick_tabs_session;
    this.initialized = true;
    console.log(
      '[STATE COORDINATOR] Initialized from session storage:',
      this.globalState.tabs.length,
      'tabs'
    );
    return true;
  }

  /**
   * Helper: Try loading from local/sync storage
   * v1.6.0.12 - FIX: Prioritize local storage to match save behavior
   *
   * @returns {Promise<void>}
   */
  async tryLoadFromSyncStorage() {
    // v1.6.0.12 - FIX: Try local storage first (where we now save)
    let result = await browser.storage.local.get('quick_tabs_state_v2');

    // Fallback to sync storage for backward compatibility
    if (!result || !result.quick_tabs_state_v2) {
      result = await browser.storage.sync.get('quick_tabs_state_v2');
    }

    // Guard: No data
    if (!result || !result.quick_tabs_state_v2) {
      this.initialized = true;
      console.log('[STATE COORDINATOR] No saved state, starting fresh');
      return;
    }

    // Load data based on format
    this.loadStateFromSyncData(result.quick_tabs_state_v2);
    this.initialized = true;
    console.log(
      '[STATE COORDINATOR] Initialized from sync storage:',
      this.globalState.tabs.length,
      'tabs'
    );
  }

  /**
   * Helper: Extract tabs from container data
   * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (line 445)
   *
   * @param {Object} containerData - Container data object
   * @returns {Array} Array of tabs from container, or empty array
   */
  _extractContainerTabs(containerData) {
    if (!containerData || !containerData.tabs) {
      return [];
    }
    return containerData.tabs;
  }

  /**
   * Helper: Load state from sync storage data
   *
   * @param {Object} data - Storage data
   */
  loadStateFromSyncData(data) {
    // Container-aware format
    if (typeof data === 'object' && !Array.isArray(data.tabs)) {
      const allTabs = [];
      for (const containerId in data) {
        const containerData = data[containerId];
        const tabs = this._extractContainerTabs(containerData);
        allTabs.push(...tabs);
      }
      this.globalState.tabs = allTabs;
      this.globalState.timestamp = Date.now();
      return;
    }

    // Legacy format with tabs array
    if (data.tabs) {
      this.globalState = data;
    }
  }

  /**
   * Process batch update from a tab
   */
  async processBatchUpdate(tabId, operations, tabInstanceId) {
    await this.initialize();

    console.log(`[STATE COORDINATOR] Processing ${operations.length} operations from tab ${tabId}`);

    // Rebuild vector clock from operations
    const tabVectorClock = new Map();
    operations.forEach(op => {
      if (op.vectorClock) {
        op.vectorClock.forEach(([key, value]) => {
          tabVectorClock.set(key, Math.max(tabVectorClock.get(key) || 0, value));
        });
      }
    });
    this.tabVectorClocks.set(tabInstanceId, tabVectorClock);

    // Process each operation (synchronous)
    for (const op of operations) {
      this.processOperation(op);
    }

    // Save to storage
    await this.persistState();

    // Broadcast to all tabs
    await this.broadcastState();

    console.log('[STATE COORDINATOR] Batch update complete');
    return { success: true };
  }

  /**
   * Process a single operation
   * v1.6.0 - PHASE 3.2: Refactored to extract operation handlers (cc=12 → cc<6)
   */
  processOperation(op) {
    const { type, quickTabId, data } = op;

    // Route to appropriate handler
    switch (type) {
      case 'create':
        this.handleCreateOperation(quickTabId, data);
        break;
      case 'update':
        this.handleUpdateOperation(quickTabId, data);
        break;
      case 'delete':
        this.handleDeleteOperation(quickTabId);
        break;
      case 'minimize':
        this.handleMinimizeOperation(quickTabId, data);
        break;
      case 'restore':
        this.handleRestoreOperation(quickTabId);
        break;
      default:
        console.warn(`[STATE COORDINATOR] Unknown operation type: ${type}`);
    }

    this.globalState.timestamp = Date.now();
  }

  /**
   * Helper: Handle create operation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} data - Tab data
   */
  handleCreateOperation(quickTabId, data) {
    const existingIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (existingIndex === -1) {
      this.globalState.tabs.push(data);
      console.log(`[STATE COORDINATOR] Created Quick Tab ${quickTabId}`);
    } else {
      this.globalState.tabs[existingIndex] = {
        ...this.globalState.tabs[existingIndex],
        ...data
      };
      console.log(`[STATE COORDINATOR] Updated existing Quick Tab ${quickTabId}`);
    }
  }

  /**
   * Helper: Handle update operation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} data - Tab data
   */
  handleUpdateOperation(quickTabId, data) {
    const updateIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (updateIndex === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for update`);
      return;
    }

    this.globalState.tabs[updateIndex] = {
      ...this.globalState.tabs[updateIndex],
      ...data
    };
    console.log(`[STATE COORDINATOR] Updated Quick Tab ${quickTabId}`);
  }

  /**
   * Helper: Handle delete operation
   *
   * @param {string} quickTabId - Quick Tab ID
   */
  handleDeleteOperation(quickTabId) {
    const deleteIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (deleteIndex === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for delete`);
      return;
    }

    this.globalState.tabs.splice(deleteIndex, 1);
    console.log(`[STATE COORDINATOR] Deleted Quick Tab ${quickTabId}`);
  }

  /**
   * Helper: Handle minimize operation
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} data - Tab data (optional)
   */
  handleMinimizeOperation(quickTabId, data) {
    const minIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (minIndex !== -1) {
      this.globalState.tabs[minIndex].minimized = true;
      console.log(`[STATE COORDINATOR] Minimized Quick Tab ${quickTabId}`);
    } else if (data) {
      this.globalState.tabs.push({ ...data, minimized: true });
      console.log(`[STATE COORDINATOR] Created minimized Quick Tab ${quickTabId}`);
    }
  }

  /**
   * Helper: Handle restore operation
   *
   * @param {string} quickTabId - Quick Tab ID
   */
  handleRestoreOperation(quickTabId) {
    const restoreIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);

    if (restoreIndex === -1) {
      console.warn(`[STATE COORDINATOR] Tab ${quickTabId} not found for restore`);
      return;
    }

    this.globalState.tabs[restoreIndex].minimized = false;
    console.log(`[STATE COORDINATOR] Restored Quick Tab ${quickTabId}`);
  }

  /**
   * Persist state to storage
   * v1.6.0.12 - FIX: Use local storage to avoid quota errors
   */
  async persistState() {
    try {
      // v1.6.0.12 - FIX: Use local storage (much higher quota)
      await browser.storage.local.set({
        quick_tabs_state_v2: this.globalState
      });

      // Also save to session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        await browser.storage.session.set({
          quick_tabs_session: this.globalState
        });
      }

      console.log('[STATE COORDINATOR] Persisted state to storage');
    } catch (err) {
      console.error('[STATE COORDINATOR] Error persisting state:', err);
      throw err;
    }
  }

  /**
   * Broadcast canonical state to all tabs
   */
  async broadcastState() {
    try {
      const tabs = await browser.tabs.query({});

      for (const tab of tabs) {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'SYNC_STATE_FROM_COORDINATOR',
            state: this.globalState
          })
          .catch(() => {
            // Content script not loaded in this tab, that's OK
          });
      }

      console.log(`[STATE COORDINATOR] Broadcasted state to ${tabs.length} tabs`);
    } catch (err) {
      console.error('[STATE COORDINATOR] Error broadcasting state:', err);
    }
  }

  /**
   * Get current state
   */
  getState() {
    return this.globalState;
  }
}

// Global state coordinator instance
const stateCoordinator = new StateCoordinator();
// ==================== END STATE COORDINATOR ====================

// ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
// This allows Quick Tabs to load any website, bypassing clickjacking protection
// ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
// Firefox Manifest V3 - Supports blocking webRequest
// This allows Quick Tabs to load any website, bypassing clickjacking protection
// Security Note: This removes X-Frame-Options and CSP frame-ancestors headers
// which normally prevent websites from being embedded in iframes. This makes
// the extension potentially vulnerable to clickjacking attacks if a malicious
// website tricks the user into clicking on a Quick Tab overlay. Use with caution.

console.log('[Quick Tabs] Initializing Firefox MV3 X-Frame-Options bypass...');

// Track modified URLs for debugging
const modifiedUrls = new Set();

browser.webRequest.onHeadersReceived.addListener(
  details => {
    console.log(`[Quick Tabs] Processing iframe: ${details.url}`);

    const headers = details.responseHeaders;
    const modifiedHeaders = headers.filter(header => {
      const name = header.name.toLowerCase();

      // Remove X-Frame-Options header (blocks iframe embedding)
      if (name === 'x-frame-options') {
        console.log(`[Quick Tabs] ✓ Removed X-Frame-Options: ${header.value} from ${details.url}`);
        modifiedUrls.add(details.url);
        return false;
      }

      // Remove Content-Security-Policy frame-ancestors directive
      if (name === 'content-security-policy') {
        const originalValue = header.value;
        // Remove frame-ancestors directive from CSP
        header.value = header.value.replace(/frame-ancestors[^;]*(;|$)/gi, '');

        // If CSP is now empty, remove the header entirely
        if (header.value.trim() === '' || header.value.trim() === ';') {
          console.log(`[Quick Tabs] ✓ Removed empty CSP from ${details.url}`);
          modifiedUrls.add(details.url);
          return false;
        }

        // Log if we modified it
        if (header.value !== originalValue) {
          console.log(`[Quick Tabs] ✓ Modified CSP for ${details.url}`);
          modifiedUrls.add(details.url);
        }
      }

      // Remove restrictive Cross-Origin-Resource-Policy
      if (name === 'cross-origin-resource-policy') {
        const value = header.value.toLowerCase();
        if (value === 'same-origin' || value === 'same-site') {
          console.log(`[Quick Tabs] ✓ Removed CORP: ${header.value} from ${details.url}`);
          modifiedUrls.add(details.url);
          return false;
        }
      }

      return true;
    });

    return { responseHeaders: modifiedHeaders };
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame'] // Only iframes - filter at registration for better performance
  },
  ['blocking', 'responseHeaders'] // Firefox MV3 allows 'blocking'
);

// Log successful iframe loads
browser.webRequest.onCompleted.addListener(
  details => {
    if (modifiedUrls.has(details.url)) {
      console.log(`[Quick Tabs] ✅ Successfully loaded iframe: ${details.url}`);
      // Clean up old URLs to prevent memory leak
      if (modifiedUrls.size > 100) {
        modifiedUrls.clear();
      }
    }
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame']
  }
);

// Log failed iframe loads
browser.webRequest.onErrorOccurred.addListener(
  details => {
    console.error(`[Quick Tabs] ❌ Failed to load iframe: ${details.url}`);
    console.error(`[Quick Tabs] Error: ${details.error}`);
  },
  {
    urls: ['<all_urls>'],
    types: ['sub_frame']
  }
);

console.log('[Quick Tabs] ✓ Firefox MV3 X-Frame-Options bypass installed');

// ==================== END X-FRAME-OPTIONS BYPASS ====================

// Listen for tab switches to restore Quick Tabs
// v1.6.2.2 - Updated for unified format (no container filtering)
chrome.tabs.onActivated.addListener(async activeInfo => {
  console.log('[Background] Tab activated:', activeInfo.tabId);

  // Message the activated tab to potentially restore Quick Tabs from storage
  chrome.tabs
    .sendMessage(activeInfo.tabId, {
      action: 'tabActivated',
      tabId: activeInfo.tabId
    })
    .catch(_err => {
      // Content script might not be ready yet, that's OK
      console.log('[Background] Could not message tab (content script not ready)');
    });

  // v1.6.2.2 - Send global state for immediate sync (no container filtering)
  try {
    if (globalQuickTabState.tabs && globalQuickTabState.tabs.length > 0) {
      chrome.tabs
        .sendMessage(activeInfo.tabId, {
          action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
          state: {
            tabs: globalQuickTabState.tabs,
            lastUpdate: globalQuickTabState.lastUpdate
          }
        })
        .catch(() => {
          // Content script might not be ready yet, that's OK
        });
    }
  } catch (err) {
    console.error('[Background] Error syncing tab state:', err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'complete') {
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      })
      .then(() => {
        // After content script is loaded, restore Quick Tab state if it exists
        const state = quickTabStates.get(tabId);
        if (state && state.quickTabs && state.quickTabs.length > 0) {
          chrome.tabs
            .sendMessage(tabId, {
              action: 'restoreQuickTabs',
              quickTabs: state.quickTabs
            })
            .catch(_err => {
              // Ignore errors if content script isn't ready
            });
        }
      })
      .catch(_err => {
        // Silently fail for restricted pages
      });
  }
});

/**
 * Helper: Remove tab ID from Quick Tab's solo/mute arrays
 * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (lines 886, 893)
 *
 * @param {Object} quickTab - Quick Tab object to clean up
 * @param {number} tabId - Tab ID to remove
 * @returns {boolean} True if any changes were made
 */
function _removeTabFromQuickTab(quickTab, tabId) {
  let changed = false;

  // Remove from soloedOnTabs
  if (quickTab.soloedOnTabs && quickTab.soloedOnTabs.includes(tabId)) {
    quickTab.soloedOnTabs = quickTab.soloedOnTabs.filter(id => id !== tabId);
    changed = true;
    console.log(`[Background] Removed tab ${tabId} from Quick Tab ${quickTab.id} solo list`);
  }

  // Remove from mutedOnTabs
  if (quickTab.mutedOnTabs && quickTab.mutedOnTabs.includes(tabId)) {
    quickTab.mutedOnTabs = quickTab.mutedOnTabs.filter(id => id !== tabId);
    changed = true;
    console.log(`[Background] Removed tab ${tabId} from Quick Tab ${quickTab.id} mute list`);
  }

  return changed;
}

/**
 * Helper: Clean up Quick Tab state after tab closes
 * v1.6.0 - PHASE 4.3: Extracted to reduce complexity (cc=11 → cc<9)
 * v1.6.2.2 - Updated for unified format
 *
 * @param {number} tabId - Tab ID that was closed
 * @returns {Promise<boolean>} True if state was changed and saved
 */
async function _cleanupQuickTabStateAfterTabClose(tabId) {
  // Guard: Not initialized
  if (!isInitialized) {
    return false;
  }

  let stateChanged = false;

  // v1.6.2.2 - Process tabs array directly (unified format)
  for (const quickTab of (globalQuickTabState.tabs || [])) {
    if (_removeTabFromQuickTab(quickTab, tabId)) {
      stateChanged = true;
    }
  }

  // Save if state changed
  if (!stateChanged) {
    return false;
  }

  const stateToSave = {
    tabs: globalQuickTabState.tabs,
    saveId: `cleanup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now()
  };

  try {
    await browser.storage.local.set({ quick_tabs_state_v2: stateToSave });
    console.log('[Background] Cleaned up Quick Tab state after tab closure');
    return true;
  } catch (err) {
    console.error('[Background] Error saving cleaned up state:', err);
    return false;
  }
}

// Clean up state when tab is closed
// v1.5.9.13 - Also clean up solo/mute arrays when tabs close
// v1.6.0 - PHASE 4.3: Extracted cleanup logic to fix complexity and max-depth
chrome.tabs.onRemoved.addListener(async tabId => {
  quickTabStates.delete(tabId);
  console.log(`[Background] Tab ${tabId} closed - cleaning up Quick Tab references`);
  await _cleanupQuickTabStateAfterTabClose(tabId);
});

// ==================== MESSAGE ROUTING SETUP (v1.6.0 Phase 3.1) ====================
// Initialize message router and handlers for modular message processing
console.log('[Background] Initializing MessageRouter and handlers...');

const messageRouter = new MessageRouter();
messageRouter.setExtensionId(EXTENSION_ID);

// Create handler instances
const logHandler = new LogHandler(BACKGROUND_LOG_BUFFER, downloadsAPI, browser);

const quickTabHandler = new QuickTabHandler(
  globalQuickTabState,
  stateCoordinator,
  browser,
  initializeGlobalState
);

const tabHandler = new TabHandler(quickTabStates, browser);

// Set initialization flag for QuickTabHandler if state is already initialized
if (isInitialized) {
  quickTabHandler.setInitialized(true);
}

// Register log handlers (3 actions)
messageRouter.register('CLEAR_CONSOLE_LOGS', (msg, sender) =>
  logHandler.handleClearLogs(msg, sender)
);
messageRouter.register('GET_BACKGROUND_LOGS', (msg, sender) =>
  logHandler.handleGetLogs(msg, sender)
);
messageRouter.register('EXPORT_LOGS', (msg, sender) => logHandler.handleExportLogs(msg, sender));

// Register Quick Tab handlers (13 actions)
messageRouter.register('BATCH_QUICK_TAB_UPDATE', (msg, sender) =>
  quickTabHandler.handleBatchUpdate(msg, sender)
);
messageRouter.register('CREATE_QUICK_TAB', (msg, sender) =>
  quickTabHandler.handleCreate(msg, sender)
);
messageRouter.register('CLOSE_QUICK_TAB', (msg, sender) =>
  quickTabHandler.handleClose(msg, sender)
);
messageRouter.register(
  ['UPDATE_QUICK_TAB_POSITION', 'UPDATE_QUICK_TAB_POSITION_FINAL'],
  (msg, sender) => quickTabHandler.handlePositionUpdate(msg, sender)
);
messageRouter.register(['UPDATE_QUICK_TAB_SIZE', 'UPDATE_QUICK_TAB_SIZE_FINAL'], (msg, sender) =>
  quickTabHandler.handleSizeUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_PIN', (msg, sender) =>
  quickTabHandler.handlePinUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_SOLO', (msg, sender) =>
  quickTabHandler.handleSoloUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_MUTE', (msg, sender) =>
  quickTabHandler.handleMuteUpdate(msg, sender)
);
messageRouter.register('UPDATE_QUICK_TAB_MINIMIZE', (msg, sender) =>
  quickTabHandler.handleMinimizeUpdate(msg, sender)
);
// v1.6.0.12 - NEW: Handle z-index updates for cross-tab sync
messageRouter.register('UPDATE_QUICK_TAB_ZINDEX', (msg, sender) =>
  quickTabHandler.handleZIndexUpdate(msg, sender)
);
messageRouter.register('GET_CURRENT_TAB_ID', (msg, sender) =>
  quickTabHandler.handleGetCurrentTabId(msg, sender)
);
messageRouter.register('GET_CONTAINER_CONTEXT', (msg, sender) =>
  quickTabHandler.handleGetContainerContext(msg, sender)
);
messageRouter.register('SWITCH_TO_TAB', (msg, sender) =>
  quickTabHandler.handleSwitchToTab(msg, sender)
);
messageRouter.register('GET_QUICK_TABS_STATE', (msg, sender) =>
  quickTabHandler.handleGetQuickTabsState(msg, sender)
);

// Register tab handlers (5 actions)
messageRouter.register('openTab', (msg, sender) => tabHandler.handleOpenTab(msg, sender));
messageRouter.register('saveQuickTabState', (msg, sender) =>
  tabHandler.handleSaveState(msg, sender)
);
messageRouter.register('getQuickTabState', (msg, sender) => tabHandler.handleGetState(msg, sender));
messageRouter.register('clearQuickTabState', (msg, sender) =>
  tabHandler.handleClearState(msg, sender)
);
messageRouter.register('createQuickTab', (msg, sender) =>
  tabHandler.handleLegacyCreate(msg, sender)
);

// v1.6.3 - FIX: Handler for resetting globalQuickTabState cache when storage is cleared from popup
// This is called after popup.js clears storage to ensure background's cache is also reset
messageRouter.register('RESET_GLOBAL_QUICK_TAB_STATE', () => {
  console.log('[Background] Resetting globalQuickTabState cache (storage cleared from popup)');
  globalQuickTabState.tabs = [];
  globalQuickTabState.lastUpdate = Date.now();
  // Reset the state hash to allow next storage write to proceed
  lastBroadcastedStateHash = 0;
  return { success: true, message: 'Global Quick Tab state cache reset' };
});

console.log('[Background] MessageRouter initialized with 26 registered handlers');

// Handle messages from content script and sidebar - using MessageRouter
chrome.runtime.onMessage.addListener(messageRouter.createListener());

// ==================== KEYBOARD COMMAND LISTENER ====================
// v1.6.0 - Removed obsolete toggle-minimized-manager listener
// Now handled by the toggle-quick-tabs-manager listener below (line 1240)
// ==================== END KEYBOARD COMMAND LISTENER ====================

// Handle sidePanel toggle for Chrome (optional)
if (chrome.sidePanel) {
  chrome.action.onClicked.addListener(tab => {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(err => {
      console.log('Side panel not supported or error:', err);
    });
  });
}

/**
 * Helper: Update global state from storage value
 * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (lines 1087, 1095)
 * v1.6.2.2 - Updated for unified format
 *
 * @param {Object|null} newValue - New storage value
 */
function _updateGlobalStateFromStorage(newValue) {
  // Guard: No value (storage cleared)
  if (!newValue) {
    console.log('[Background] Storage cleared, checking if intentional...');
    return;
  }

  // v1.6.2.2 - Unified format
  if (newValue.tabs && Array.isArray(newValue.tabs)) {
    globalQuickTabState.tabs = newValue.tabs;
    globalQuickTabState.lastUpdate = newValue.timestamp || Date.now();
    console.log(
      '[Background] Updated global state from storage (unified format):',
      newValue.tabs.length,
      'tabs'
    );
    return;
  }

  // Backward compatibility: container format migration
  if (typeof newValue === 'object' && newValue.containers) {
    globalQuickTabState.tabs = migrateContainersToUnifiedFormat(newValue.containers);
    globalQuickTabState.lastUpdate = newValue.timestamp || Date.now();
    console.log(
      '[Background] Updated global state from storage (migrated from container format):',
      globalQuickTabState.tabs.length,
      'tabs'
    );
  }
}

/**
 * Helper: Broadcast message to all tabs
 * v1.6.0 - PHASE 4.3: Extracted to reduce complexity
 *
 * @param {string} action - Message action type
 * @param {*} data - Data to send with message
 */
async function _broadcastToAllTabs(action, data) {
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    try {
      await browser.tabs.sendMessage(tab.id, { action, ...data });
    } catch (_err) {
      // Content script might not be loaded in this tab
    }
  }
}

/**
 * Handle Quick Tab state changes from storage
 * v1.6.2 - MIGRATION: Removed legacy _broadcastToAllTabs call
 * v1.6.2.2 - Updated for unified format
 * 
 * Cross-tab sync is now handled exclusively via storage.onChanged:
 * - When any tab writes to storage.local, ALL OTHER tabs automatically receive the change
 * - Each tab's StorageManager listens for storage.onChanged events
 * - Background script only needs to keep its own cache (globalQuickTabState) updated
 * 
 * @param {Object} changes - Storage changes object
 */
function _handleQuickTabStateChange(changes) {
  const newValue = changes.quick_tabs_state_v2.newValue;

  // v1.6.1.6 - FIX: Check if this is our own write (prevents feedback loop)
  if (newValue && newValue.writeSourceId) {
    const lastWrite = quickTabHandler.getLastWriteTimestamp();
    if (
      lastWrite &&
      lastWrite.writeSourceId === newValue.writeSourceId &&
      Date.now() - lastWrite.timestamp < WRITE_IGNORE_WINDOW_MS
    ) {
      console.log('[Background] Ignoring self-write:', newValue.writeSourceId);
      return; // BREAKS THE LOOP
    }
  }

  // v1.6.1.6 - FIX: Check if state actually changed (prevents redundant cache updates)
  const newHash = computeStateHash(newValue);
  if (newHash === lastBroadcastedStateHash) {
    console.log('[Background] State unchanged, skipping cache update');
    return;
  }

  lastBroadcastedStateHash = newHash;
  
  // v1.6.2 - MIGRATION: Only update background's cache, no broadcast needed
  // storage.onChanged automatically fires in all OTHER tabs (not this one)
  // Each tab's StorageManager handles its own sync via storage.onChanged listener
  console.log('[Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)');
  _updateGlobalStateFromStorage(newValue);
}

/**
 * Helper: Handle settings changes
 * v1.6.0 - PHASE 4.3: Extracted to reduce complexity
 *
 * @param {Object} changes - Storage changes object
 */
async function _handleSettingsChange(changes) {
  console.log('[Background] Settings changed, broadcasting to all tabs');

  await _broadcastToAllTabs('SETTINGS_UPDATED', {
    settings: changes.quick_tab_settings.newValue
  });
}

// ==================== STORAGE SYNC BROADCASTING ====================
// Listen for local/sync storage changes and broadcast them to all tabs
// This enables real-time Quick Tab state synchronization across all tabs
// v1.6.0 - PHASE 4.3: Refactored to extract handlers (cc=11 → cc<9, max-depth fixed)
// v1.6.0.12 - FIX: Listen for local storage changes (where we now save)
browser.storage.onChanged.addListener((changes, areaName) => {
  console.log('[Background] Storage changed:', areaName, Object.keys(changes));

  // v1.6.0.12 - FIX: Process both local (primary) and sync (fallback) storage
  if (areaName !== 'local' && areaName !== 'sync') {
    return;
  }

  // Handle Quick Tab state changes
  if (changes.quick_tabs_state_v2) {
    _handleQuickTabStateChange(changes);
  }

  // Handle settings changes
  if (changes.quick_tab_settings) {
    _handleSettingsChange(changes);
  }
});

// ==================== END STORAGE SYNC BROADCASTING ====================

/**
 * Helper: Toggle Quick Tabs panel in active tab
 * v1.6.0 - PHASE 4.3: Extracted to fix max-depth (line 1205)
 *
 * @returns {Promise<void>}
 */
async function _toggleQuickTabsPanel() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });

  // Guard: No active tab
  if (tabs.length === 0) {
    console.error('[QuickTabsManager] No active tab found');
    return;
  }

  const activeTab = tabs[0];

  try {
    // Send toggle message to content script
    await browser.tabs.sendMessage(activeTab.id, {
      action: 'TOGGLE_QUICK_TABS_PANEL'
    });
    console.log('[QuickTabsManager] Toggle command sent to tab', activeTab.id);
  } catch (err) {
    console.error('[QuickTabsManager] Error sending toggle message:', err);
    // Content script may not be loaded yet - inject it
    try {
      await browser.tabs.executeScript(activeTab.id, {
        file: 'content.js'
      });
      // Try again after injection
      await browser.tabs.sendMessage(activeTab.id, {
        action: 'TOGGLE_QUICK_TABS_PANEL'
      });
    } catch (injectErr) {
      console.error('[QuickTabsManager] Error injecting content script:', injectErr);
    }
  }
}

/**
 * Open sidebar and switch to Manager tab
 * v1.6.1.4 - Extracted to fix max-depth eslint error
 * v1.6.2.0 - Fixed: Improved timing and retry logic for sidebar message delivery
 */
async function _openSidebarAndSwitchToManager() {
  try {
    // Check if sidebar is already open
    const isOpen = await browser.sidebarAction.isOpen({});
    
    if (!isOpen) {
      // Open sidebar if closed
      await browser.sidebarAction.open();
      // Wait longer for sidebar to fully initialize (DOM ready + scripts loaded)
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Send message to sidebar to switch to Manager tab with retry logic
    await _sendManagerTabMessage();
    
    console.log('[Sidebar] Opened sidebar and switched to Manager tab');
  } catch (error) {
    console.error('[Sidebar] Error opening sidebar:', error);
  }
}

/**
 * Send message to sidebar to switch to Manager tab
 * v1.6.1.4 - Extracted to reduce nesting
 * v1.6.2.0 - Enhanced retry logic with multiple attempts
 */
async function _sendManagerTabMessage() {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 150; // ms between retries
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const success = await _trySendManagerMessage();
    if (success) {
      return;
    }
    // Sidebar might not be ready yet, wait before retry
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  console.warn('[Background] Could not send message to sidebar after', MAX_RETRIES, 'attempts');
}

/**
 * Attempt to send SWITCH_TO_MANAGER_TAB message
 * @returns {Promise<boolean>} true if successful, false otherwise
 */
async function _trySendManagerMessage() {
  try {
    await browser.runtime.sendMessage({
      type: 'SWITCH_TO_MANAGER_TAB'
    });
    return true;
  } catch (error) {
    return false;
  }
}

// ==================== KEYBOARD COMMANDS ====================
// Listen for keyboard commands
// v1.6.0 - PHASE 4.3: Extracted toggle logic to fix max-depth
// v1.6.1.4 - Updated for dual-sidebar implementation
browser.commands.onCommand.addListener(async command => {
  // Handle Quick Tabs Manager panel (floating panel, not sidebar)
  if (command === 'toggle-quick-tabs-manager') {
    await _toggleQuickTabsPanel();
  }
  
  // Handle opening sidebar and switching to Manager tab
  if (command === 'open-quick-tabs-manager') {
    await _openSidebarAndSwitchToManager();
  }
  
  // _execute_sidebar_action is handled automatically by Firefox
  // Just log for debugging
  if (command === '_execute_sidebar_action') {
    console.log('[Sidebar] Keyboard shortcut triggered (Alt+Shift+S)');
  }
});
// ==================== END KEYBOARD COMMANDS ====================

// ==================== BROWSER ACTION HANDLER ====================
// Toggle sidebar when toolbar button is clicked (Firefox only)
// Chrome will continue using popup.html since it doesn't support sidebar_action
// v1.6.2.0 - Fixed: Now toggles sidebar open/close instead of only opening
if (typeof browser !== 'undefined' && browser.browserAction && browser.sidebarAction) {
  browser.browserAction.onClicked.addListener(async () => {
    try {
      // Use toggle() API for clean open/close behavior
      if (browser.sidebarAction && browser.sidebarAction.toggle) {
        await browser.sidebarAction.toggle();
        console.log('[Sidebar] Toggled via toolbar button');
      } else if (browser.sidebarAction && browser.sidebarAction.open) {
        // Fallback for older Firefox versions without toggle()
        await browser.sidebarAction.open();
        console.log('[Sidebar] Opened via toolbar button (fallback)');
      }
    } catch (err) {
      console.error('[Sidebar] Error toggling sidebar:', err);
      // If sidebar fails, user can still access settings via options page
    }
  });
  console.log('[Sidebar] Browser action handler registered for Firefox');
} else {
  // Chrome doesn't support sidebarAction, so toolbar button will show popup.html
  console.log('[Sidebar] Browser action uses popup (Chrome compatibility)');
}
// ==================== END BROWSER ACTION HANDLER ====================
