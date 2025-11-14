// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs
// v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load

// Store Quick Tab states per tab
const quickTabStates = new Map();

// ==================== REAL-TIME STATE COORDINATOR ====================
// Global state hub for real-time Quick Tab synchronization across all tabs
// Container-aware since v1.5.7: State keyed by cookieStoreId for Firefox Container isolation
// This provides instant cross-origin sync (< 50ms latency)
// v1.5.8.13 - Enhanced with eager loading for Issue #35 and #51
let globalQuickTabState = {
  // Keyed by cookieStoreId (e.g., "firefox-default", "firefox-container-1")
  containers: {
    'firefox-default': { tabs: [], lastUpdate: 0 }
  }
};

// Flag to track initialization status
let isInitialized = false;

// v1.5.8.13 - EAGER LOADING: Initialize global state from storage on extension startup (container-aware)
// This runs immediately when background script loads, ensuring state is always available
async function initializeGlobalState() {
  if (isInitialized) return;

  try {
    // Try session storage first (faster)
    let result;
    if (typeof browser.storage.session !== 'undefined') {
      result = await browser.storage.session.get('quick_tabs_session');
      if (result && result.quick_tabs_session) {
        // Check if it's container-aware format (object with container keys)
        if (
          typeof result.quick_tabs_session === 'object' &&
          !Array.isArray(result.quick_tabs_session.tabs)
        ) {
          // New container-aware format
          globalQuickTabState.containers = result.quick_tabs_session;
        } else if (result.quick_tabs_session.tabs) {
          // Old format: migrate to container-aware
          globalQuickTabState.containers = {
            'firefox-default': {
              tabs: result.quick_tabs_session.tabs,
              lastUpdate: result.quick_tabs_session.timestamp || Date.now()
            }
          };
        }
        isInitialized = true;
        const totalTabs = Object.values(globalQuickTabState.containers).reduce(
          (sum, c) => sum + (c.tabs?.length || 0),
          0
        );
        console.log(
          '[Background] ✓ EAGER LOAD: Initialized from session storage:',
          totalTabs,
          'tabs across',
          Object.keys(globalQuickTabState.containers).length,
          'containers'
        );
        return;
      }
    }

    // Fall back to sync storage
    result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (result && result.quick_tabs_state_v2) {
      // Check if it's container-aware format
      if (
        typeof result.quick_tabs_state_v2 === 'object' &&
        !Array.isArray(result.quick_tabs_state_v2.tabs)
      ) {
        // New container-aware format
        globalQuickTabState.containers = result.quick_tabs_state_v2;
      } else if (result.quick_tabs_state_v2.tabs) {
        // Old format: migrate to container-aware
        globalQuickTabState.containers = {
          'firefox-default': {
            tabs: result.quick_tabs_state_v2.tabs,
            lastUpdate: result.quick_tabs_state_v2.timestamp || Date.now()
          }
        };
        // Save migrated format back to storage
        browser.storage.sync
          .set({
            quick_tabs_state_v2: globalQuickTabState.containers
          })
          .catch(err => console.error('[Background] Error saving migrated state:', err));
      }
      isInitialized = true;
      const totalTabs = Object.values(globalQuickTabState.containers).reduce(
        (sum, c) => sum + (c.tabs?.length || 0),
        0
      );
      console.log(
        '[Background] ✓ EAGER LOAD: Initialized from sync storage:',
        totalTabs,
        'tabs across',
        Object.keys(globalQuickTabState.containers).length,
        'containers'
      );
    } else {
      isInitialized = true;
      console.log('[Background] ✓ EAGER LOAD: No saved state found, starting with empty state');
    }
  } catch (err) {
    console.error('[Background] Error initializing global state:', err);
    isInitialized = true; // Mark as initialized even on error to prevent blocking
  }
}

// v1.5.8.13 - EAGER LOADING: Call initialization immediately on script load
initializeGlobalState();

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
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Try session storage first
      if (typeof browser.storage.session !== 'undefined') {
        const result = await browser.storage.session.get('quick_tabs_session');
        if (result && result.quick_tabs_session && result.quick_tabs_session.tabs) {
          this.globalState = result.quick_tabs_session;
          this.initialized = true;
          console.log(
            '[STATE COORDINATOR] Initialized from session storage:',
            this.globalState.tabs.length,
            'tabs'
          );
          return;
        }
      }

      // Fall back to sync storage
      const result = await browser.storage.sync.get('quick_tabs_state_v2');
      if (result && result.quick_tabs_state_v2) {
        // Handle container-aware format from existing code
        if (
          typeof result.quick_tabs_state_v2 === 'object' &&
          !Array.isArray(result.quick_tabs_state_v2.tabs)
        ) {
          // Container-aware format - merge all containers into single state
          const allTabs = [];
          for (const containerId in result.quick_tabs_state_v2) {
            const containerData = result.quick_tabs_state_v2[containerId];
            if (containerData && containerData.tabs) {
              allTabs.push(...containerData.tabs);
            }
          }
          this.globalState.tabs = allTabs;
          this.globalState.timestamp = Date.now();
        } else if (result.quick_tabs_state_v2.tabs) {
          this.globalState = result.quick_tabs_state_v2;
        }
        this.initialized = true;
        console.log(
          '[STATE COORDINATOR] Initialized from sync storage:',
          this.globalState.tabs.length,
          'tabs'
        );
      } else {
        this.initialized = true;
        console.log('[STATE COORDINATOR] No saved state, starting fresh');
      }
    } catch (err) {
      console.error('[STATE COORDINATOR] Error initializing:', err);
      this.initialized = true;
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

    // Process each operation
    for (const op of operations) {
      await this.processOperation(op);
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
   */
  async processOperation(op) {
    const { type, quickTabId, data } = op;

    switch (type) {
      case 'create':
        // Check if already exists
        const existingIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);
        if (existingIndex === -1) {
          this.globalState.tabs.push(data);
          console.log(`[STATE COORDINATOR] Created Quick Tab ${quickTabId}`);
        } else {
          // Update existing
          this.globalState.tabs[existingIndex] = {
            ...this.globalState.tabs[existingIndex],
            ...data
          };
          console.log(`[STATE COORDINATOR] Updated existing Quick Tab ${quickTabId}`);
        }
        break;

      case 'update':
        const updateIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);
        if (updateIndex !== -1) {
          this.globalState.tabs[updateIndex] = { ...this.globalState.tabs[updateIndex], ...data };
          console.log(`[STATE COORDINATOR] Updated Quick Tab ${quickTabId}`);
        }
        break;

      case 'delete':
        const deleteIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);
        if (deleteIndex !== -1) {
          this.globalState.tabs.splice(deleteIndex, 1);
          console.log(`[STATE COORDINATOR] Deleted Quick Tab ${quickTabId}`);
        }
        break;

      case 'minimize':
        const minIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);
        if (minIndex !== -1) {
          this.globalState.tabs[minIndex].minimized = true;
          console.log(`[STATE COORDINATOR] Minimized Quick Tab ${quickTabId}`);
        } else if (data) {
          // Add minimized tab if not in state
          this.globalState.tabs.push({ ...data, minimized: true });
        }
        break;

      case 'restore':
        const restoreIndex = this.globalState.tabs.findIndex(t => t.id === quickTabId);
        if (restoreIndex !== -1) {
          this.globalState.tabs[restoreIndex].minimized = false;
          console.log(`[STATE COORDINATOR] Restored Quick Tab ${quickTabId}`);
        }
        break;
    }

    this.globalState.timestamp = Date.now();
  }

  /**
   * Persist state to storage
   */
  async persistState() {
    try {
      await browser.storage.sync.set({
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

// Listen for tab switches to restore Quick Tabs (container-aware)
chrome.tabs.onActivated.addListener(async activeInfo => {
  console.log('[Background] Tab activated:', activeInfo.tabId);

  // Message the activated tab to potentially restore Quick Tabs from storage
  chrome.tabs
    .sendMessage(activeInfo.tabId, {
      action: 'tabActivated',
      tabId: activeInfo.tabId
    })
    .catch(err => {
      // Content script might not be ready yet, that's OK
      console.log('[Background] Could not message tab (content script not ready)');
    });

  // Get the tab's cookieStoreId to send only relevant state
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    const cookieStoreId = tab.cookieStoreId || 'firefox-default';

    // Send container-specific state for immediate sync
    if (
      globalQuickTabState.containers[cookieStoreId] &&
      globalQuickTabState.containers[cookieStoreId].tabs.length > 0
    ) {
      chrome.tabs
        .sendMessage(activeInfo.tabId, {
          action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
          state: {
            tabs: globalQuickTabState.containers[cookieStoreId].tabs,
            lastUpdate: globalQuickTabState.containers[cookieStoreId].lastUpdate
          },
          cookieStoreId: cookieStoreId
        })
        .catch(() => {
          // Content script might not be ready yet, that's OK
        });
    }
  } catch (err) {
    console.error('[Background] Error getting tab info:', err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
            .catch(err => {
              // Ignore errors if content script isn't ready
            });
        }
      })
      .catch(err => {
        // Silently fail for restricted pages
      });
  }
});

// Clean up state when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  quickTabStates.delete(tabId);
});

// Handle messages from content script and sidebar
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // ==================== PROMISE-BASED SAVE QUEUE HANDLER ====================
  // NEW: Handle batch updates from save queue
  if (message.action === 'BATCH_QUICK_TAB_UPDATE') {
    try {
      const result = await stateCoordinator.processBatchUpdate(
        tabId,
        message.operations,
        message.tabInstanceId
      );
      sendResponse(result); // { success: true }
      return true; // Keep channel open for async response
    } catch (err) {
      console.error('[Background] Batch update failed:', err);
      sendResponse({ success: false, error: err.message });
      return true;
    }
  }
  // ==================== END SAVE QUEUE HANDLER ====================

  // ==================== REAL-TIME STATE COORDINATION ====================

  // Handle Quick Tab creation (container-aware)
  if (message.action === 'CREATE_QUICK_TAB') {
    console.log(
      '[Background] Received create Quick Tab:',
      message.url,
      'ID:',
      message.id,
      'Container:',
      message.cookieStoreId
    );

    // Wait for initialization if needed
    if (!isInitialized) {
      await initializeGlobalState();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // Initialize container state if it doesn't exist
    if (!globalQuickTabState.containers[cookieStoreId]) {
      globalQuickTabState.containers[cookieStoreId] = { tabs: [], lastUpdate: 0 };
    }

    const containerState = globalQuickTabState.containers[cookieStoreId];

    // Check if tab already exists in global state by ID (not URL)
    // This allows multiple Quick Tabs with the same URL
    const existingIndex = containerState.tabs.findIndex(t => t.id === message.id);

    if (existingIndex !== -1) {
      // Update existing entry
      containerState.tabs[existingIndex] = {
        id: message.id,
        url: message.url,
        left: message.left,
        top: message.top,
        width: message.width,
        height: message.height,
        pinnedToUrl: message.pinnedToUrl || null,
        title: message.title || 'Quick Tab',
        minimized: message.minimized || false
      };
    } else {
      // Add new entry
      containerState.tabs.push({
        id: message.id,
        url: message.url,
        left: message.left,
        top: message.top,
        width: message.width,
        height: message.height,
        pinnedToUrl: message.pinnedToUrl || null,
        title: message.title || 'Quick Tab',
        minimized: message.minimized || false
      });
    }

    containerState.lastUpdate = Date.now();

    // Save to storage for persistence
    browser.storage.sync
      .set({
        quick_tabs_state_v2: globalQuickTabState.containers
      })
      .catch(err => {
        console.error('[Background] Error saving created tab to storage:', err);
      });

    // Also save to session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      browser.storage.session
        .set({
          quick_tabs_session: globalQuickTabState.containers
        })
        .catch(err => {
          console.error('[Background] Error saving to session storage:', err);
        });
    }

    // Broadcast ONLY to tabs in the same container
    browser.tabs.query({ cookieStoreId: cookieStoreId }).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'CREATE_QUICK_TAB_FROM_BACKGROUND',
            id: message.id,
            url: message.url,
            left: message.left,
            top: message.top,
            width: message.width,
            height: message.height,
            title: message.title,
            cookieStoreId: cookieStoreId
          })
          .catch(() => {});
      });
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle Quick Tab close (container-aware)
  if (message.action === 'CLOSE_QUICK_TAB') {
    console.log(
      '[Background] Received close Quick Tab:',
      message.url,
      'ID:',
      message.id,
      'Container:',
      message.cookieStoreId
    );

    // Wait for initialization if needed
    if (!isInitialized) {
      await initializeGlobalState();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // Check if container state exists
    if (!globalQuickTabState.containers[cookieStoreId]) {
      sendResponse({ success: false, error: 'Container state not found' });
      return true;
    }

    const containerState = globalQuickTabState.containers[cookieStoreId];

    // Remove from global state by ID (not URL) to avoid closing wrong duplicate
    const tabIndex = containerState.tabs.findIndex(t => t.id === message.id);
    if (tabIndex !== -1) {
      containerState.tabs.splice(tabIndex, 1);
      containerState.lastUpdate = Date.now();

      // Broadcast to all tabs in the SAME container
      browser.tabs.query({ cookieStoreId: cookieStoreId }).then(tabs => {
        tabs.forEach(tab => {
          browser.tabs
            .sendMessage(tab.id, {
              action: 'CLOSE_QUICK_TAB_FROM_BACKGROUND',
              id: message.id,
              url: message.url,
              cookieStoreId: cookieStoreId
            })
            .catch(() => {});
        });
      });

      // Save updated state to storage
      browser.storage.sync
        .set({
          quick_tabs_state_v2: globalQuickTabState.containers
        })
        .catch(err => {
          console.error('[Background] Error saving after close:', err);
        });

      // Also save to session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        browser.storage.session
          .set({
            quick_tabs_session: globalQuickTabState.containers
          })
          .catch(err => {
            console.error('[Background] Error saving to session storage:', err);
          });
      }
    }

    sendResponse({ success: true });
    return true;
  }

  // Handle position and size updates from content scripts (container-aware)
  // v1.5.8.14 - Enhanced with transaction ID (saveId) to prevent race conditions
  if (message.action === 'UPDATE_QUICK_TAB_POSITION' || message.action === 'UPDATE_QUICK_TAB_POSITION_FINAL') {
    console.log(
      '[Background] Received position update:',
      message.url,
      'ID:',
      message.id,
      message.left,
      message.top,
      'Container:',
      message.cookieStoreId
    );

    // Wait for initialization if needed
    if (!isInitialized) {
      await initializeGlobalState();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // Initialize container state if it doesn't exist
    if (!globalQuickTabState.containers[cookieStoreId]) {
      globalQuickTabState.containers[cookieStoreId] = { tabs: [], lastUpdate: 0 };
    }

    const containerState = globalQuickTabState.containers[cookieStoreId];

    // Update global state by ID (not URL) to avoid updating wrong duplicate
    const tabIndex = containerState.tabs.findIndex(t => t.id === message.id);
    if (tabIndex !== -1) {
      containerState.tabs[tabIndex].left = message.left;
      containerState.tabs[tabIndex].top = message.top;
      if (message.width !== undefined) containerState.tabs[tabIndex].width = message.width;
      if (message.height !== undefined) containerState.tabs[tabIndex].height = message.height;
    } else {
      // Tab doesn't exist in global state - add it
      containerState.tabs.push({
        id: message.id,
        url: message.url,
        left: message.left,
        top: message.top,
        width: message.width,
        height: message.height
      });
    }
    containerState.lastUpdate = Date.now();

    // Broadcast to tabs in the SAME container immediately for real-time sync
    browser.tabs.query({ cookieStoreId: cookieStoreId }).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'UPDATE_QUICK_TAB_FROM_BACKGROUND',
            id: message.id,
            url: message.url,
            left: message.left,
            top: message.top,
            width: message.width,
            height: message.height,
            cookieStoreId: cookieStoreId
          })
          .catch(() => {
            // Content script might not be loaded in this tab
          });
      });
    });

    // v1.5.8.14 - Include saveId in storage for transaction tracking
    const stateToSave = {
      ...globalQuickTabState.containers,
      saveId: message.saveId || null, // Include save ID if provided
      timestamp: Date.now()
    };

    // Also save to storage.sync for persistence (async, non-blocking)
    browser.storage.sync
      .set({
        quick_tabs_state_v2: stateToSave
      })
      .catch(err => {
        console.error('[Background] Error saving to storage.sync:', err);
      });

    // Also save to session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      browser.storage.session
        .set({
          quick_tabs_session: stateToSave
        })
        .catch(err => {
          console.error('[Background] Error saving to session storage:', err);
        });
    }

    sendResponse({ success: true });
    return true;
  }

  // Handle Quick Tab pin/unpin updates (container-aware)
  if (message.action === 'UPDATE_QUICK_TAB_PIN') {
    console.log(
      '[Background] Received pin update:',
      message.id,
      'pinnedToUrl:',
      message.pinnedToUrl,
      'Container:',
      message.cookieStoreId
    );

    // Wait for initialization if needed
    if (!isInitialized) {
      await initializeGlobalState();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // Initialize container state if it doesn't exist
    if (!globalQuickTabState.containers[cookieStoreId]) {
      globalQuickTabState.containers[cookieStoreId] = { tabs: [], lastUpdate: 0 };
    }

    const containerState = globalQuickTabState.containers[cookieStoreId];

    // Update global state
    const tabIndex = containerState.tabs.findIndex(t => t.id === message.id);
    if (tabIndex !== -1) {
      containerState.tabs[tabIndex].pinnedToUrl = message.pinnedToUrl;
      containerState.lastUpdate = Date.now();

      // Save to storage
      browser.storage.sync
        .set({
          quick_tabs_state_v2: globalQuickTabState.containers
        })
        .catch(err => {
          console.error('[Background] Error saving pin state to storage:', err);
        });

      // Also save to session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        browser.storage.session
          .set({
            quick_tabs_session: globalQuickTabState.containers
          })
          .catch(err => {
            console.error('[Background] Error saving to session storage:', err);
          });
      }
    }

    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'UPDATE_QUICK_TAB_SIZE' || message.action === 'UPDATE_QUICK_TAB_SIZE_FINAL') {
    console.log('[Background] Received size update:', message.url, message.width, message.height);

    // Wait for initialization if needed
    if (!isInitialized) {
      await initializeGlobalState();
    }

    const cookieStoreId = message.cookieStoreId || 'firefox-default';

    // Initialize container state if it doesn't exist
    if (!globalQuickTabState.containers[cookieStoreId]) {
      globalQuickTabState.containers[cookieStoreId] = { tabs: [], lastUpdate: 0 };
    }

    const containerState = globalQuickTabState.containers[cookieStoreId];

    // Update global state by ID
    const tabIndex = containerState.tabs.findIndex(t => t.id === message.id);
    if (tabIndex !== -1) {
      containerState.tabs[tabIndex].width = message.width;
      containerState.tabs[tabIndex].height = message.height;
      if (message.left !== undefined) containerState.tabs[tabIndex].left = message.left;
      if (message.top !== undefined) containerState.tabs[tabIndex].top = message.top;
    } else {
      containerState.tabs.push({
        id: message.id,
        url: message.url,
        width: message.width,
        height: message.height,
        left: message.left,
        top: message.top
      });
    }
    containerState.lastUpdate = Date.now();

    // Broadcast to tabs in the SAME container immediately
    browser.tabs.query({ cookieStoreId: cookieStoreId }).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'UPDATE_QUICK_TAB_FROM_BACKGROUND',
            id: message.id,
            url: message.url,
            width: message.width,
            height: message.height,
            left: message.left,
            top: message.top,
            cookieStoreId: cookieStoreId
          })
          .catch(() => {
            // Content script might not be loaded
          });
      });
    });

    // v1.5.8.14 - Include saveId in storage for transaction tracking
    const stateToSave = {
      ...globalQuickTabState.containers,
      saveId: message.saveId || null,
      timestamp: Date.now()
    };

    // Save to storage.sync
    browser.storage.sync
      .set({
        quick_tabs_state_v2: stateToSave
      })
      .catch(err => {
        console.error('[Background] Error saving size to storage.sync:', err);
      });

    // Save to session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      browser.storage.session
        .set({
          quick_tabs_session: stateToSave
        })
        .catch(err => {
          console.error('[Background] Error saving to session storage:', err);
        });
    }

    sendResponse({ success: true });
    return true;
  }
  // ==================== END REAL-TIME STATE COORDINATION ====================

  if (message.action === 'openTab') {
    chrome.tabs.create({
      url: message.url,
      active: message.switchFocus
    });
  } else if (message.action === 'saveQuickTabState' && tabId) {
    // Store Quick Tab state for this tab
    quickTabStates.set(tabId, {
      quickTabs: message.quickTabs,
      timestamp: Date.now()
    });
  } else if (message.action === 'getQuickTabState' && tabId) {
    // Retrieve Quick Tab state for this tab
    const state = quickTabStates.get(tabId);
    sendResponse({
      quickTabs: state?.quickTabs || []
    });
    return true; // Keep channel open for async response
  } else if (message.action === 'clearQuickTabState' && tabId) {
    // Clear Quick Tab state for this tab
    quickTabStates.delete(tabId);
  } else if (message.action === 'createQuickTab') {
    // Forward Quick Tab creation message to the sidebar
    // The sidebar panel listens for this message via browser.runtime.onMessage
    console.log('[Background] Forwarding createQuickTab to sidebar:', message);

    // Send message to the sidebar extension page
    // Note: This uses the broadcast approach - all listeners will receive it
    browser.runtime
      .sendMessage({
        action: 'createQuickTab',
        url: message.url,
        title: message.title || document.title,
        sourceTabId: tabId // Tell sidebar which tab it came from (optional)
      })
      .then(response => {
        console.log('[Background] Sidebar responded:', response);
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[Background] Error forwarding to sidebar:', err);
        // Still send success response to content script
        // The content script already showed the notification
        sendResponse({ success: true });
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }
});

// ==================== KEYBOARD COMMAND LISTENER ====================
// Handle keyboard shortcuts defined in manifest.json
browser.commands.onCommand.addListener(command => {
  if (command === 'toggle-minimized-manager') {
    console.log('[Background] Toggle minimized manager command received');

    // Send message to active tab
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs.length > 0) {
        browser.tabs
          .sendMessage(tabs[0].id, {
            action: 'TOGGLE_MINIMIZED_MANAGER'
          })
          .catch(err => {
            console.error('[Background] Error sending toggle command:', err);
          });
      }
    });
  }
});
// ==================== END KEYBOARD COMMAND LISTENER ====================

// Handle sidePanel toggle for Chrome (optional)
if (chrome.sidePanel) {
  chrome.action.onClicked.addListener(tab => {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(err => {
      console.log('Side panel not supported or error:', err);
    });
  });
}

// ==================== STORAGE SYNC BROADCASTING ====================
// Listen for sync storage changes and broadcast them to all tabs
// This enables real-time Quick Tab state synchronization across all tabs
browser.storage.onChanged.addListener((changes, areaName) => {
  console.log('[Background] Storage changed:', areaName, Object.keys(changes));

  // Broadcast Quick Tab state changes
  if (areaName === 'sync' && changes.quick_tabs_state_v2) {
    console.log('[Background] Quick Tab state changed, broadcasting to all tabs');

    // UPDATE: Sync globalQuickTabState with storage changes (v1.5.8.14 - container-aware)
    const newValue = changes.quick_tabs_state_v2.newValue;

    // v1.5.8.14 FIX: Only clear state if explicitly requested by user action
    // This prevents race conditions where storage clears during normal operations
    if (!newValue) {
      // Storage was explicitly cleared - only reset if intentional
      console.log('[Background] Storage cleared, checking if intentional...');
      // Don't automatically reset - let content scripts handle their own state
      // This prevents the "Quick Tab immediately closes" bug
    } else {
      // Storage was updated - sync global state (container-aware)
      if (typeof newValue === 'object' && newValue.containers) {
        // Container-aware format
        globalQuickTabState.containers = newValue;
        console.log(
          '[Background] Updated global state from storage (container-aware):',
          Object.keys(newValue).length,
          'containers'
        );
      } else if (newValue.tabs && Array.isArray(newValue.tabs)) {
        // Legacy format - migrate
        globalQuickTabState.containers = {
          'firefox-default': {
            tabs: newValue.tabs,
            lastUpdate: newValue.timestamp || Date.now()
          }
        };
        console.log(
          '[Background] Updated global state from storage (legacy format):',
          newValue.tabs.length,
          'tabs'
        );
      }
    }

    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'SYNC_QUICK_TAB_STATE',
            state: changes.quick_tabs_state_v2.newValue
          })
          .catch(err => {
            // Content script might not be loaded in this tab
          });
      });
    });
  }

  // Broadcast settings changes
  if (areaName === 'sync' && changes.quick_tab_settings) {
    console.log('[Background] Settings changed, broadcasting to all tabs');
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs
          .sendMessage(tab.id, {
            action: 'SETTINGS_UPDATED',
            settings: changes.quick_tab_settings.newValue
          })
          .catch(err => {
            // Content script might not be loaded in this tab
          });
      });
    });
  }
});

// ==================== END STORAGE SYNC BROADCASTING ====================

// ==================== KEYBOARD COMMANDS ====================
// Listen for keyboard commands to toggle floating panel
browser.commands.onCommand.addListener(async command => {
  if (command === 'toggle-quick-tabs-manager') {
    // Get active tab in current window
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });

      if (tabs.length === 0) {
        console.error('[QuickTabsManager] No active tab found');
        return;
      }

      const activeTab = tabs[0];

      // Send message to content script to toggle panel
      browser.tabs
        .sendMessage(activeTab.id, {
          action: 'TOGGLE_QUICK_TABS_PANEL'
        })
        .catch(err => {
          console.error('[QuickTabsManager] Error sending toggle message:', err);
          // Content script may not be loaded yet - inject it
          browser.tabs
            .executeScript(activeTab.id, {
              file: 'content.js'
            })
            .then(() => {
              // Try again after injection
              browser.tabs.sendMessage(activeTab.id, {
                action: 'TOGGLE_QUICK_TABS_PANEL'
              });
            });
        });

      console.log('[QuickTabsManager] Toggle command sent to tab', activeTab.id);
    } catch (err) {
      console.error('[QuickTabsManager] Error handling toggle command:', err);
    }
  }
});
// ==================== END KEYBOARD COMMANDS ====================
