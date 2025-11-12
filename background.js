// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs

// Store Quick Tab states per tab
const quickTabStates = new Map();

// ==================== REAL-TIME STATE COORDINATOR ====================
// Global state hub for real-time Quick Tab synchronization across all tabs
// Container-aware since v1.5.7: State keyed by cookieStoreId for Firefox Container isolation
// This provides instant cross-origin sync (< 50ms latency)
let globalQuickTabState = {
  // Keyed by cookieStoreId (e.g., "firefox-default", "firefox-container-1")
  containers: {
    "firefox-default": { tabs: [], lastUpdate: 0 }
  }
};

// Flag to track initialization status
let isInitialized = false;

// Initialize global state from storage on extension startup (container-aware)
async function initializeGlobalState() {
  if (isInitialized) return;
  
  try {
    // Try session storage first (faster)
    let result;
    if (typeof browser.storage.session !== 'undefined') {
      result = await browser.storage.session.get('quick_tabs_session');
      if (result && result.quick_tabs_session) {
        // Check if it's container-aware format (object with container keys)
        if (typeof result.quick_tabs_session === 'object' && !Array.isArray(result.quick_tabs_session.tabs)) {
          // New container-aware format
          globalQuickTabState.containers = result.quick_tabs_session;
        } else if (result.quick_tabs_session.tabs) {
          // Old format: migrate to container-aware
          globalQuickTabState.containers = {
            "firefox-default": {
              tabs: result.quick_tabs_session.tabs,
              lastUpdate: result.quick_tabs_session.timestamp || Date.now()
            }
          };
        }
        isInitialized = true;
        const totalTabs = Object.values(globalQuickTabState.containers).reduce((sum, c) => sum + (c.tabs?.length || 0), 0);
        console.log('[Background] Initialized from session storage:', totalTabs, 'tabs across', Object.keys(globalQuickTabState.containers).length, 'containers');
        return;
      }
    }
    
    // Fall back to sync storage
    result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (result && result.quick_tabs_state_v2) {
      // Check if it's container-aware format
      if (typeof result.quick_tabs_state_v2 === 'object' && !Array.isArray(result.quick_tabs_state_v2.tabs)) {
        // New container-aware format
        globalQuickTabState.containers = result.quick_tabs_state_v2;
      } else if (result.quick_tabs_state_v2.tabs) {
        // Old format: migrate to container-aware
        globalQuickTabState.containers = {
          "firefox-default": {
            tabs: result.quick_tabs_state_v2.tabs,
            lastUpdate: result.quick_tabs_state_v2.timestamp || Date.now()
          }
        };
        // Save migrated format back to storage
        browser.storage.sync.set({
          quick_tabs_state_v2: globalQuickTabState.containers
        }).catch(err => console.error('[Background] Error saving migrated state:', err));
      }
      isInitialized = true;
      const totalTabs = Object.values(globalQuickTabState.containers).reduce((sum, c) => sum + (c.tabs?.length || 0), 0);
      console.log('[Background] Initialized from sync storage:', totalTabs, 'tabs across', Object.keys(globalQuickTabState.containers).length, 'containers');
    } else {
      isInitialized = true;
      console.log('[Background] No saved state found, starting with empty state');
    }
  } catch (err) {
    console.error('[Background] Error initializing global state:', err);
    isInitialized = true; // Mark as initialized even on error to prevent blocking
  }
}

// Call initialization immediately
initializeGlobalState();

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
  (details) => {
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
    types: ['sub_frame']  // Only iframes - filter at registration for better performance
  },
  ['blocking', 'responseHeaders']  // Firefox MV3 allows 'blocking'
);

// Log successful iframe loads
browser.webRequest.onCompleted.addListener(
  (details) => {
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
  (details) => {
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
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('[Background] Tab activated:', activeInfo.tabId);
  
  // Message the activated tab to potentially restore Quick Tabs from storage
  chrome.tabs.sendMessage(activeInfo.tabId, {
    action: 'tabActivated',
    tabId: activeInfo.tabId
  }).catch(err => {
    // Content script might not be ready yet, that's OK
    console.log('[Background] Could not message tab (content script not ready)');
  });
  
  // Get the tab's cookieStoreId to send only relevant state
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    const cookieStoreId = tab.cookieStoreId || 'firefox-default';
    
    // Send container-specific state for immediate sync
    if (globalQuickTabState.containers[cookieStoreId] && 
        globalQuickTabState.containers[cookieStoreId].tabs.length > 0) {
      chrome.tabs.sendMessage(activeInfo.tabId, {
        action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
        state: {
          tabs: globalQuickTabState.containers[cookieStoreId].tabs,
          lastUpdate: globalQuickTabState.containers[cookieStoreId].lastUpdate
        },
        cookieStoreId: cookieStoreId
      }).catch(() => {
        // Content script might not be ready yet, that's OK
      });
    }
  } catch (err) {
    console.error('[Background] Error getting tab info:', err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).then(() => {
      // After content script is loaded, restore Quick Tab state if it exists
      const state = quickTabStates.get(tabId);
      if (state && state.quickTabs && state.quickTabs.length > 0) {
        chrome.tabs.sendMessage(tabId, {
          action: 'restoreQuickTabs',
          quickTabs: state.quickTabs
        }).catch(err => {
          // Ignore errors if content script isn't ready
        });
      }
    }).catch(err => {
      // Silently fail for restricted pages
    });
  }
});

// Clean up state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  quickTabStates.delete(tabId);
});

// Handle messages from content script and sidebar
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  
  // ==================== REAL-TIME STATE COORDINATION ====================
  
  // Handle Quick Tab creation (container-aware)
  if (message.action === 'CREATE_QUICK_TAB') {
    console.log('[Background] Received create Quick Tab:', message.url, 'ID:', message.id, 'Container:', message.cookieStoreId);
    
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
    browser.storage.sync.set({ 
      quick_tabs_state_v2: globalQuickTabState.containers
    }).catch(err => {
      console.error('[Background] Error saving created tab to storage:', err);
    });
    
    // Also save to session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      browser.storage.session.set({
        quick_tabs_session: globalQuickTabState.containers
      }).catch(err => {
        console.error('[Background] Error saving to session storage:', err);
      });
    }
    
    // Broadcast ONLY to tabs in the same container
    browser.tabs.query({ cookieStoreId: cookieStoreId }).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs.sendMessage(tab.id, {
          action: 'CREATE_QUICK_TAB_FROM_BACKGROUND',
          id: message.id,
          url: message.url,
          left: message.left,
          top: message.top,
          width: message.width,
          height: message.height,
          title: message.title,
          cookieStoreId: cookieStoreId
        }).catch(() => {});
      });
    });
    
    sendResponse({ success: true });
    return true;
  }
  
  // Handle Quick Tab close (container-aware)
  if (message.action === 'CLOSE_QUICK_TAB') {
    console.log('[Background] Received close Quick Tab:', message.url, 'ID:', message.id, 'Container:', message.cookieStoreId);
    
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
          browser.tabs.sendMessage(tab.id, {
            action: 'CLOSE_QUICK_TAB_FROM_BACKGROUND',
            id: message.id,
            url: message.url,
            cookieStoreId: cookieStoreId
          }).catch(() => {});
        });
      });
      
      // Save updated state to storage
      browser.storage.sync.set({ 
        quick_tabs_state_v2: globalQuickTabState.containers
      }).catch(err => {
        console.error('[Background] Error saving after close:', err);
      });
      
      // Also save to session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        browser.storage.session.set({
          quick_tabs_session: globalQuickTabState.containers
        }).catch(err => {
          console.error('[Background] Error saving to session storage:', err);
        });
      }
    }
    
    sendResponse({ success: true });
    return true;
  }
  
  // Handle position and size updates from content scripts (container-aware)
  if (message.action === 'UPDATE_QUICK_TAB_POSITION') {
    console.log('[Background] Received position update:', message.url, 'ID:', message.id, message.left, message.top, 'Container:', message.cookieStoreId);
    
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
        browser.tabs.sendMessage(tab.id, {
          action: 'UPDATE_QUICK_TAB_FROM_BACKGROUND',
          id: message.id,
          url: message.url,
          left: message.left,
          top: message.top,
          width: message.width,
          height: message.height,
          cookieStoreId: cookieStoreId
        }).catch(() => {
          // Content script might not be loaded in this tab
        });
      });
    });
    
    // Also save to storage.sync for persistence (async, non-blocking)
    browser.storage.sync.set({ 
      quick_tabs_state_v2: globalQuickTabState.containers
    }).catch(err => {
      console.error('[Background] Error saving to storage.sync:', err);
    });
    
    // Also save to session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      browser.storage.session.set({
        quick_tabs_session: globalQuickTabState.containers
      }).catch(err => {
        console.error('[Background] Error saving to session storage:', err);
      });
    }
    
    sendResponse({ success: true });
    return true;
  }
  
  // Handle Quick Tab pin/unpin updates (container-aware)
  if (message.action === 'UPDATE_QUICK_TAB_PIN') {
    console.log('[Background] Received pin update:', message.id, 'pinnedToUrl:', message.pinnedToUrl, 'Container:', message.cookieStoreId);
    
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
      browser.storage.sync.set({ 
        quick_tabs_state_v2: globalQuickTabState.containers
      }).catch(err => {
        console.error('[Background] Error saving pin state to storage:', err);
      });
      
      // Also save to session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        browser.storage.session.set({
          quick_tabs_session: globalQuickTabState.containers
        }).catch(err => {
          console.error('[Background] Error saving to session storage:', err);
        });
      }
    }
    
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'UPDATE_QUICK_TAB_SIZE') {
    console.log('[Background] Received size update:', message.url, message.width, message.height);
    
    // Wait for initialization if needed
    if (!isInitialized) {
      await initializeGlobalState();
    }
    
    // Update global state
    const tabIndex = globalQuickTabState.tabs.findIndex(t => t.url === message.url);
    if (tabIndex !== -1) {
      globalQuickTabState.tabs[tabIndex].width = message.width;
      globalQuickTabState.tabs[tabIndex].height = message.height;
      if (message.left !== undefined) globalQuickTabState.tabs[tabIndex].left = message.left;
      if (message.top !== undefined) globalQuickTabState.tabs[tabIndex].top = message.top;
    } else {
      globalQuickTabState.tabs.push({
        url: message.url,
        width: message.width,
        height: message.height,
        left: message.left,
        top: message.top
      });
    }
    globalQuickTabState.lastUpdate = Date.now();
    
    // Broadcast to ALL tabs immediately
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs.sendMessage(tab.id, {
          action: 'UPDATE_QUICK_TAB_FROM_BACKGROUND',
          url: message.url,
          left: message.left,
          top: message.top,
          width: message.width,
          height: message.height
        }).catch(() => {
          // Content script might not be loaded in this tab
        });
      });
    });
    
    // Save to storage.sync for persistence (async, non-blocking)
    browser.storage.sync.set({ 
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        timestamp: Date.now()
      }
    }).catch(err => {
      console.error('[Background] Error saving to storage.sync:', err);
    });
    
    // Also save to session storage if available
    if (typeof browser.storage.session !== 'undefined') {
      browser.storage.session.set({
        quick_tabs_session: {
          tabs: globalQuickTabState.tabs,
          timestamp: Date.now()
        }
      }).catch(err => {
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
    browser.runtime.sendMessage({
        action: 'createQuickTab',
        url: message.url,
        title: message.title || document.title,
        sourceTabId: tabId  // Tell sidebar which tab it came from (optional)
    }).then(response => {
        console.log('[Background] Sidebar responded:', response);
        sendResponse({ success: true });
    }).catch(err => {
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
browser.commands.onCommand.addListener((command) => {
  if (command === 'toggle-minimized-manager') {
    console.log('[Background] Toggle minimized manager command received');
    
    // Send message to active tab
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs.length > 0) {
        browser.tabs.sendMessage(tabs[0].id, {
          action: 'TOGGLE_MINIMIZED_MANAGER'
        }).catch(err => {
          console.error('[Background] Error sending toggle command:', err);
        });
      }
    });
  }
});
// ==================== END KEYBOARD COMMAND LISTENER ====================

// Handle sidePanel toggle for Chrome (optional)
if (chrome.sidePanel) {
  chrome.action.onClicked.addListener((tab) => {
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
    
    // UPDATE: Sync globalQuickTabState with storage changes
    const newValue = changes.quick_tabs_state_v2.newValue;
    
    // Handle storage being cleared (newValue is undefined)
    if (!newValue || !newValue.tabs) {
      // Storage was cleared - reset global state
      globalQuickTabState.tabs = [];
      globalQuickTabState.lastUpdate = Date.now();
      console.log('[Background] Storage cleared, reset global state');
    } else {
      // Storage was updated - sync global state
      // Only update if storage has MORE tabs than our global state
      // This prevents overwriting global state with stale data
      if (newValue.tabs.length >= globalQuickTabState.tabs.length) {
        globalQuickTabState.tabs = newValue.tabs;
        globalQuickTabState.lastUpdate = newValue.timestamp;
        console.log('[Background] Updated global state from storage:', globalQuickTabState.tabs.length, 'tabs');
      }
    }
    
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs.sendMessage(tab.id, { 
          action: 'SYNC_QUICK_TAB_STATE', 
          state: changes.quick_tabs_state_v2.newValue 
        }).catch(err => {
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
        browser.tabs.sendMessage(tab.id, {
          action: 'SETTINGS_UPDATED',
          settings: changes.quick_tab_settings.newValue
        }).catch(err => {
          // Content script might not be loaded in this tab
        });
      });
    });
  }
});

// ==================== END STORAGE SYNC BROADCASTING ====================
