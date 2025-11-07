// Browser API compatibility shim for Chrome/Firefox support
if (typeof browser === 'undefined') {
  var browser = chrome;
}

// Background script handles injecting content script into all tabs
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    browser.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(err => {
      // Silently fail for restricted pages
    });
  }
});

// Handle messages from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openTab') {
    browser.tabs.create({
      url: message.url,
      active: message.switchFocus
    });
  }
});