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

// ============================================================
// QUICK TABS INTEGRATION - Firefox Preferences Bridge
// ============================================================

// Handle messages from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    // Handle Quick Tabs hover detection messages
    if (message.type === 'HOVER_DETECTED') {
        
        if (message.action === 'SET_LINK') {
            // Write to browser.storage.local (which maps to Firefox preferences)
            browser.storage.local.set({
                quicktabs_hovered_url: message.url || '',
                quicktabs_hovered_title: message.title || '',
                quicktabs_hovered_state: 'hovering',
                quicktabs_hover_timestamp: message.timestamp || Date.now()
            }).then(() => {
                console.log('[CopyURL-BG] Preference updated:', message.url);
                sendResponse({ success: true });
                // ---------------------------------------------------------------
                // SYNC TO DOM FOR UC.JS BRIDGE
                // ---------------------------------------------------------------
                browser.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        browser.tabs.sendMessage(tab.id, {
                            type: 'SYNC_TO_DOM',
                            url: message.url || '',
                            title: message.title || '',
                            state: 'hovering'
                        }).catch(() => {});
                    });
                });
            }).catch(error => {
                console.error('[CopyURL-BG] Failed to set preference:', error);
                sendResponse({ success: false, error: error.message });
            });
            
            // Return true to indicate we'll respond asynchronously
            return true;
            
        } else if (message.action === 'CLEAR_LINK') {
            // Clear the preference
            browser.storage.local.set({
                quicktabs_hovered_url: '',
                quicktabs_hovered_title: '',
                quicktabs_hovered_state: 'idle',
                quicktabs_hover_timestamp: null
            }).then(() => {
                console.log('[CopyURL-BG] Preference cleared');
                sendResponse({ success: true });
                // ---------------------------------------------------------------
                // SYNC TO DOM FOR UC.JS BRIDGE
                // ---------------------------------------------------------------
                browser.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        browser.tabs.sendMessage(tab.id, {
                            type: 'SYNC_TO_DOM',
                            url: '',
                            title: '',
                            state: 'idle'
                        }).catch(() => {});
                    });
                });
            }).catch(error => {
                console.error('[CopyURL-BG] Failed to clear preference:', error);
                sendResponse({ success: false, error: error.message });
            });
            
            return true;
        }
        
    } else if (message.type === 'REQUEST_LINK') {
        // Handle REQUEST_LINK messages (for Quick Tabs to query current state)
        browser.storage.local.get([
            'quicktabs_hovered_url',
            'quicktabs_hovered_title',
            'quicktabs_hovered_state'
        ]).then(result => {
            console.log('[CopyURL-BG] Sending link status:', result);
            sendResponse({
                success: true,
                data: result
            });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        
        return true;
        
    } else if (message.action === 'openTab') {
        // Handle open tab requests
        browser.tabs.create({
            url: message.url,
            active: message.switchFocus
        });
    }
    
});

console.log('[CopyURL-BG] Background script loaded with Quick Tabs integration');
