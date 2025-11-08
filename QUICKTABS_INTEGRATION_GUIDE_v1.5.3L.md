# Firefox Preferences Method: Complete Implementation Guide for Quick-Tabs

**Version:** 1.5.3L  
**Date:** 2025-11-08  
**Repository:** Quick-Tabs (https://github.com/ChunkyNosher/Quick-Tabs)

---

## Overview

This guide explains how to implement the Firefox Preferences Method for integrating the Copy-URL extension with Quick-Tabs. This method uses Firefox's preference system as a communication bridge between the browser extension and the uc.js script.

## How Firefox Preferences Work

Think of Firefox Preferences as a **global key-value database** that:
- Both extensions AND userChrome.js scripts can read from
- Both can write to (with proper APIs)
- Automatically syncs across the entire browser
- Persists data across browser restarts
- Can notify listeners when values change in real-time

### The Preference Architecture

```
Firefox Preference Store (prefs.js in profile folder)
│
├─ quicktabs_hovered_url          → "https://example.com"
├─ quicktabs_hovered_title        → "Example Page"
├─ quicktabs_hovered_state        → "hovering" or "idle"
├─ quicktabs_hover_timestamp      → 1731000000
│
└─ [Accessible from BOTH:]
   ├─ Firefox Extension (via browser.storage.local)
   └─ UC.JS Script (via Services.prefs)
```

---

## System Flow: Step-by-Step

### Step 1: User Hovers Over a Link on a Webpage

```
┌─────────────────────────────────────────────────────────┐
│  User Visits: https://www.youtube.com                   │
│  User Hovers Over: Video Link                           │
│  Mouse Position: (x=345, y=200)                         │
└─────────────────────────────────────────────────────────┘
                        ↓
          [Copy-URL Extension Detects Hover]
                        ↓
         Extension's mouseover event fires
                        ↓
   Extract link URL: "https://youtu.be/abc123"
```

### Step 2: Extension Writes to Preference

The Copy-URL extension's **content script** detects the hover and sends a message to the background script:

**Content Script** (content.js):
```javascript
// When user hovers over a link
document.addEventListener('mouseover', (event) => {
    const link = event.target.closest('a');
    
    if (link && link.href) {
        const url = link.href;
        const title = link.textContent.trim() || link.getAttribute('title');
        
        console.log('[CopyURL] Hover detected:', url);
        
        // Send message to background script
        browser.runtime.sendMessage({
            type: 'HOVER_DETECTED',
            action: 'SET_LINK',
            url: url,
            title: title,
            timestamp: Date.now()
        });
    }
});

// When mouse leaves a link
document.addEventListener('mouseout', (event) => {
    const link = event.target.closest('a');
    
    if (link) {
        console.log('[CopyURL] Mouse left link');
        
        browser.runtime.sendMessage({
            type: 'HOVER_DETECTED',
            action: 'CLEAR_LINK'
        });
    }
});
```

### Step 3: Background Script Writes to Firefox Preference

The background script receives the message and writes to browser.storage.local (which maps to Firefox preferences):

**Background Script** (background.js):
```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    if (message.type === 'HOVER_DETECTED') {
        
        if (message.action === 'SET_LINK') {
            // Write to browser.storage.local
            browser.storage.local.set({
                quicktabs_hovered_url: message.url,
                quicktabs_hovered_title: message.title,
                quicktabs_hovered_state: 'hovering',
                quicktabs_hover_timestamp: message.timestamp
            }).then(() => {
                console.log('[CopyURL-BG] Stored link in preference:', message.url);
                sendResponse({ success: true });
            });
            
            return true; // Async response
        }
        
        else if (message.action === 'CLEAR_LINK') {
            // Clear the preference
            browser.storage.local.set({
                quicktabs_hovered_url: '',
                quicktabs_hovered_title: '',
                quicktabs_hovered_state: 'idle',
                quicktabs_hover_timestamp: null
            }).then(() => {
                console.log('[CopyURL-BG] Cleared link preference');
                sendResponse({ success: true });
            });
            
            return true;
        }
    }
});
```

### Step 4: UC.JS Script Watches for Changes

The Quick-Tabs UC.JS script observes these preference changes in real-time:

**Quick-Tabs Script** (Quick_Tabs.uc.js):
```javascript
// ========================================
// COPY-URL EXTENSION INTEGRATION
// Using Firefox Preferences as Bridge
// ========================================

// Global variable to store the current hovered link from extension
let quickTabsExtensionLink = {
    url: null,
    title: null,
    state: 'idle',
    timestamp: null
};

// Global variable to store the observer object
let quickTabsPrefObserver = null;

/**
 * Set up listener for preference changes
 */
function setupQuickTabsExtensionBridge() {
    console.log('[QuickTabs] Setting up extension preference bridge');
    
    // Create observer object that receives notifications
    quickTabsPrefObserver = {
        // This is called whenever a watched preference changes
        observe(subject, topic, data) {
            // topic will be "nsPref:changed"
            // data will be the preference name that changed
            
            if (topic !== 'nsPref:changed') {
                return;
            }
            
            console.log('[QuickTabs] Preference changed:', data);
            
            // Check if this is one of our QuickTabs preferences
            if (!data.startsWith('quicktabs_')) {
                return;
            }
            
            // Handle preference changes
            if (data === 'quicktabs_hovered_url' || 
                data === 'quicktabs_hovered_state') {
                
                // Read all the preference values
                try {
                    const url = Services.prefs.getStringPref(
                        'quicktabs_hovered_url', 
                        ''
                    );
                    
                    const title = Services.prefs.getStringPref(
                        'quicktabs_hovered_title',
                        ''
                    );
                    
                    const state = Services.prefs.getStringPref(
                        'quicktabs_hovered_state',
                        'idle'
                    );
                    
                    let timestamp = null;
                    try {
                        timestamp = Services.prefs.getIntPref(
                            'quicktabs_hover_timestamp',
                            null
                        );
                    } catch (e) {
                        // Preference doesn't exist, that's fine
                    }
                    
                    // Update our global variable
                    quickTabsExtensionLink = {
                        url: url,
                        title: title,
                        state: state,
                        timestamp: timestamp
                    };
                    
                    console.log('[QuickTabs] Extension link updated:', {
                        url: url,
                        title: title,
                        state: state
                    });
                    
                } catch (error) {
                    console.warn('[QuickTabs] Error reading preferences:', error);
                }
            }
        }
    };
    
    // Register the observer with Firefox preferences
    // Watch all prefs starting with "quicktabs_"
    try {
        Services.prefs.addObserver('quicktabs_', quickTabsPrefObserver);
        console.log('[QuickTabs] Preference observer registered successfully');
    } catch (error) {
        console.error('[QuickTabs] Failed to register preference observer:', error);
    }
}

/**
 * Listen for Ctrl+E keyboard shortcut
 */
function setupCtrlEListener() {
    console.log('[QuickTabs] Setting up Ctrl+E keyboard listener for extension links');
    
    document.addEventListener('keydown', (event) => {
        // Check for Ctrl+E (Cmd+E on Mac)
        const isCtrlE = (event.ctrlKey || event.metaKey) && 
                        event.key === 'e' &&
                        !event.shiftKey &&
                        !event.altKey;
        
        if (!isCtrlE) {
            return;
        }
        
        console.log('[QuickTabs] Ctrl+E pressed - checking for extension link');
        
        event.preventDefault();
        event.stopPropagation();
        
        // Check if we have a link from the extension
        if (!quickTabsExtensionLink || !quickTabsExtensionLink.url) {
            console.log('[QuickTabs] No active hovered link from extension');
            return;
        }
        
        const url = quickTabsExtensionLink.url;
        const title = quickTabsExtensionLink.title;
        
        // Validate the URL
        if (!url || url.length === 0) {
            console.warn('[QuickTabs] Invalid URL from extension');
            return;
        }
        
        // Don't open internal Firefox URLs
        if (url.startsWith('about:') || 
            url.startsWith('chrome:') ||
            url.startsWith('moz-extension:') ||
            url.startsWith('resource:')) {
            console.warn('[QuickTabs] Skipping internal Firefox URL:', url);
            return;
        }
        
        console.log('[QuickTabs] Creating Quick Tab for extension link:', {
            url: url,
            title: title
        });
        
        // Create the Quick Tab
        try {
            const result = createQuickTabContainer(url, title);
            
            if (result) {
                console.log('[QuickTabs] Quick Tab created successfully');
            } else {
                console.warn('[QuickTabs] Failed to create Quick Tab');
            }
        } catch (error) {
            console.error('[QuickTabs] Error creating Quick Tab:', error);
        }
        
    }, true); // Use capture phase
    
    console.log('[QuickTabs] Ctrl+E keyboard listener registered');
}

/**
 * Initialize the extension bridge
 */
function initializeExtensionBridge() {
    console.log('[QuickTabs] Initializing Copy-URL extension bridge');
    
    try {
        // Set up preference listener
        setupQuickTabsExtensionBridge();
        
        // Set up keyboard shortcut listener
        setupCtrlEListener();
        
        console.log('[QuickTabs] Extension bridge initialized successfully');
        return true;
        
    } catch (error) {
        console.error('[QuickTabs] Failed to initialize extension bridge:', error);
        return false;
    }
}

/**
 * Cleanup function
 */
function cleanupExtensionBridge() {
    if (quickTabsPrefObserver) {
        try {
            Services.prefs.removeObserver('quicktabs_', quickTabsPrefObserver);
            console.log('[QuickTabs] Preference observer removed');
            quickTabsPrefObserver = null;
        } catch (error) {
            console.warn('[QuickTabs] Error removing preference observer:', error);
        }
    }
}

// ========================================
// INITIALIZE THE INTEGRATION
// ========================================
initializeExtensionBridge();

// Cleanup on unload
window.addEventListener('unload', cleanupExtensionBridge);
```

### Step 5: User Presses Ctrl+E

When the user presses the keyboard shortcut, Quick-Tabs reads from the stored data and creates the Quick Tab.

---

## Data Flow Diagram

```
TIME PROGRESSION →

T=0ms: User hovers link on webpage
    │
    └─→ [Copy-URL Content Script]
            │ Detects mouseover event
            │ Extracts URL: "https://youtu.be/abc"
            │ Extracts Title: "Cool Video"
            │
            └─→ Sends message to background script
                    │ message.type = "HOVER_DETECTED"
                    │ message.url = "https://youtu.be/abc"
                    │ message.title = "Cool Video"
                    │
                    └─→ [Copy-URL Background Script]
                            │ Receives message
                            │ Writes to browser.storage.local:
                            │   quicktabs_hovered_url = "https://youtu.be/abc"
                            │   quicktabs_hovered_title = "Cool Video"
                            │   quicktabs_hovered_state = "hovering"
                            │
T=1ms:                      └─→ Firefox Preference Store UPDATED
                                    │
                                    └─→ [UC.JS Script - Listener]
                                            │ Notification fires!
                                            │ topic = "nsPref:changed"
                                            │ data = "quicktabs_hovered_url"
                                            │
                                            └─→ UC.JS reads the preference
                                                    │ url = "https://youtu.be/abc"
                                                    │ title = "Cool Video"
                                                    │ state = "hovering"
                                                    │
                                                    └─→ Stores in: quickTabsExtensionLink

T=2s: User presses Ctrl+E
    │
    └─→ [UC.JS Keyboard Listener]
            │ event.ctrlKey = true
            │ event.key = 'e'
            │
            └─→ Reads quickTabsExtensionLink
                    │ url = "https://youtu.be/abc"
                    │ title = "Cool Video"
                    │
                    └─→ Calls createQuickTabContainer(url, title)
                            │
                            └─→ Quick Tab OPENS! ✓
```

---

## Integration Instructions for Quick-Tabs Repository

### Location

Add the integration code to your `Quick_Tabs.uc.js` file, near the beginning after variable declarations.

### Code to Add

Copy the complete UC.JS code from **Step 4** above and paste it into your Quick-Tabs script.

### Initialization

The code includes automatic initialization:
```javascript
initializeExtensionBridge();
window.addEventListener('unload', cleanupExtensionBridge);
```

These lines should be placed at the end of your main script initialization.

### Testing

1. Install Copy-URL extension v1.5.3L or later
2. Reload Quick-Tabs script or restart browser
3. Navigate to any website (e.g., YouTube, Twitter)
4. Hover over a link
5. Press Ctrl+E
6. Quick Tab should open with the link!

### Debugging

Enable debug mode in the Copy-URL extension settings. Check the browser console for:

**Copy-URL Extension:**
- `[CopyURL] Hover detected: <url>`
- `[CopyURL-BG] Preference updated: <url>`

**Quick-Tabs Script:**
- `[QuickTabs] Extension bridge initialized successfully`
- `[QuickTabs] Preference changed: quicktabs_hovered_url`
- `[QuickTabs] Extension link updated: {url, title, state}`
- `[QuickTabs] Creating Quick Tab for extension link`

### Manual Testing

You can manually test the preference system in the browser console:

```javascript
// Check current preference values
Services.prefs.getStringPref('quicktabs_hovered_url', 'NOT SET');

// Manually set a test value
browser.storage.local.set({
    quicktabs_hovered_url: 'https://example.com',
    quicktabs_hovered_title: 'Test',
    quicktabs_hovered_state: 'hovering'
});
```

---

## Advantages of This Method

| Feature | Benefit |
|---------|---------|
| **Real-Time** | Preferences update instantly, observer notifies immediately |
| **No Files** | No filesystem I/O, no race conditions, no file locking |
| **Secure** | No clipboard pollution, secure preference system |
| **Simple** | Just reading/writing strings to a database |
| **Reliable** | Firefox has been using this for 20+ years |
| **Built-In** | No additional APIs or permissions needed |
| **Cross-Tab** | Works across all browser windows and tabs |
| **Persistent** | Data survives browser restart (if needed) |

---

## Requirements

### For Users

1. **Zen Browser** with [Fx-Autoconfig](https://github.com/MrOtherGuy/fx-autoconfig/)
2. **Quick Tabs uc.js** script installed
3. **Copy-URL extension** v1.5.3L or later

### For Developers

The extension side (v1.5.3L) already implements:
- Content script hover detection
- Background script preference writing
- Proper message passing
- Error handling

The Quick-Tabs side needs:
- Preference observer setup
- Keyboard listener for Ctrl+E
- Link validation
- Quick Tab creation logic

---

## Preference Keys Reference

| Preference Key | Type | Description | Example Value |
|---------------|------|-------------|---------------|
| `quicktabs_hovered_url` | String | The URL of the hovered link | `"https://example.com"` |
| `quicktabs_hovered_title` | String | The title/text of the link | `"Example Page"` |
| `quicktabs_hovered_state` | String | Current hover state | `"hovering"` or `"idle"` |
| `quicktabs_hover_timestamp` | Integer | Timestamp of last hover | `1731000000` |

---

## Troubleshooting

### Issue: Preferences not updating

**Solution:** Check browser console for errors:
```javascript
// In browser console
browser.storage.local.get().then(console.log);
```

### Issue: Observer not firing

**Solution:** Verify observer is registered:
```javascript
// The observer should be registered on script load
// Check console for: "[QuickTabs] Preference observer registered successfully"
```

### Issue: Ctrl+E not working

**Solution:** 
1. Check that the keyboard listener is registered
2. Verify no other extension is capturing Ctrl+E
3. Check console for: `[QuickTabs] Ctrl+E pressed`

### Issue: Quick Tab not opening

**Solution:**
1. Verify `createQuickTabContainer()` function exists
2. Check URL validation (no internal URLs)
3. Review console logs for error messages

---

## Version History

- **v1.5.3L** (2025-11-08): Firefox Preferences Method implementation
- **v1.5.0L** (Previous): postMessage bridge implementation

---

## Related Links

- **Quick-Tabs Repository**: https://github.com/ChunkyNosher/Quick-Tabs
- **Copy-URL Repository**: https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition
- **Issue #5**: https://github.com/ChunkyNosher/Quick-Tabs/issues/5

---

## License

This integration method is provided as-is for use with the Quick-Tabs and Copy-URL projects.
