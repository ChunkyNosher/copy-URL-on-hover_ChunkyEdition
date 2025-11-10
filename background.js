// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs

// Store Quick Tab states per tab
const quickTabStates = new Map();

// ==================== REAL-TIME STATE COORDINATOR ====================
// Global state hub for real-time Quick Tab synchronization across all tabs
// This provides instant cross-origin sync (< 50ms latency)
let globalQuickTabState = {
  tabs: [],
  lastUpdate: 0
};

// ==================== X-FRAME-OPTIONS BYPASS FOR QUICK TABS ====================
// This allows Quick Tabs to load any website, bypassing clickjacking protection
// Security Note: This removes X-Frame-Options and CSP frame-ancestors headers
// which normally prevent websites from being embedded in iframes. This makes
// the extension potentially vulnerable to clickjacking attacks if a malicious
// website tricks the user into clicking on a Quick Tab overlay. Use with caution.

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    // Only modify headers for sub_frame requests (iframes)
    // This prevents modifying headers for main page loads
    if (details.type !== 'sub_frame') {
      return {};
    }

    const headers = details.responseHeaders;
    const modifiedHeaders = headers.filter(header => {
      const name = header.name.toLowerCase();
      // Remove X-Frame-Options header (blocks iframe embedding)
      if (name === 'x-frame-options') {
        console.log(`[Quick Tabs] Removed X-Frame-Options header for: ${details.url}`);
        return false;
      }
      // Remove Content-Security-Policy frame-ancestors directive
      if (name === 'content-security-policy') {
        // Remove frame-ancestors directive from CSP
        const originalValue = header.value;
        header.value = header.value.replace(/frame-ancestors[^;]*(;|$)/gi, '');
        if (header.value !== originalValue) {
          console.log(`[Quick Tabs] Removed frame-ancestors from CSP for: ${details.url}`);
        }
        // If CSP is now empty, remove the header entirely
        if (header.value.trim() === '') {
          return false;
        }
      }
      return true;
    });

    return { responseHeaders: modifiedHeaders };
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'responseHeaders']
);

// ==================== END X-FRAME-OPTIONS BYPASS ====================


// Listen for tab switches to restore Quick Tabs
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
  
  // Also send current global state for immediate sync
  if (globalQuickTabState.tabs.length > 0) {
    chrome.tabs.sendMessage(activeInfo.tabId, {
      action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
      state: globalQuickTabState
    }).catch(() => {
      // Content script might not be ready yet, that's OK
    });
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  
  // ==================== REAL-TIME STATE COORDINATION ====================
  // Handle position and size updates from content scripts
  if (message.action === 'UPDATE_QUICK_TAB_POSITION') {
    console.log('[Background] Received position update:', message.url, message.left, message.top);
    
    // Update global state
    const tabIndex = globalQuickTabState.tabs.findIndex(t => t.url === message.url);
    if (tabIndex !== -1) {
      globalQuickTabState.tabs[tabIndex].left = message.left;
      globalQuickTabState.tabs[tabIndex].top = message.top;
      if (message.width !== undefined) globalQuickTabState.tabs[tabIndex].width = message.width;
      if (message.height !== undefined) globalQuickTabState.tabs[tabIndex].height = message.height;
    } else {
      globalQuickTabState.tabs.push({
        url: message.url,
        left: message.left,
        top: message.top,
        width: message.width,
        height: message.height
      });
    }
    globalQuickTabState.lastUpdate = Date.now();
    
    // Broadcast to ALL tabs immediately for real-time cross-origin sync
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
    
    // Also save to storage.sync for persistence (async, non-blocking)
    browser.storage.sync.set({ 
      quick_tabs_state_v2: {
        tabs: globalQuickTabState.tabs,
        timestamp: Date.now()
      }
    }).catch(err => {
      console.error('[Background] Error saving to storage.sync:', err);
    });
    
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'UPDATE_QUICK_TAB_SIZE') {
    console.log('[Background] Received size update:', message.url, message.width, message.height);
    
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
