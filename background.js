// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication

// Store Quick Tab states per tab
const quickTabStates = new Map();

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

// Handle sidePanel toggle for Chrome (optional)
if (chrome.sidePanel) {
  chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(err => {
      console.log('Side panel not supported or error:', err);
    });
  });
}
