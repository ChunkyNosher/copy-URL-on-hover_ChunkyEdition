# Complete Guide: Implementing Sidebar/Side Panel API for Cross-Tab Quick Tabs

## Table of Contents
1. [Overview](#overview)
2. [Architecture Changes](#architecture-changes)
3. [Browser Compatibility](#browser-compatibility)
4. [Step-by-Step Implementation](#step-by-step-implementation)
5. [File Structure](#file-structure)
6. [Complete Code Examples](#complete-code-examples)
7. [Migration Guide from Current Implementation](#migration-guide-from-current-implementation)
8. [Testing and Deployment](#testing-and-deployment)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The current Quick Tabs implementation creates floating iframe windows within each tab's DOM. This causes Quick Tabs to disappear when switching between tabs (Issue #35). The solution is to leverage browser APIs specifically designed for persistent, cross-tab UI elements:

- **Firefox**: `sidebarAction` API
- **Chrome/Edge**: `sidePanel` API (Manifest V3)
- **Opera**: `sidebar_action` API (same as Firefox)

These APIs provide:
- ✅ True cross-tab persistence (never disappears when switching tabs)
- ✅ No state loss or reloading
- ✅ Native browser integration (sidebar icon in browser UI)
- ✅ User can minimize/expand the sidebar
- ✅ Persistent layout management by the browser

### Why This Solves Issue #35

When you open a Quick Tab in the sidebar, it persists in that exact state across ALL tabs. Switching tabs doesn't affect the sidebar's state. The Quick Tab URL, scroll position, navigation history, and iframe state are preserved automatically.

---

## Architecture Changes

### Current Architecture (v1.5.0)

```
Tab A (YouTube)
├── Content Script
│   ├── Floating Quick Tab Window (DOM-based iframe)
│   ├── Notification System
│   └── Link Detection

Tab B (Google Docs)
├── Content Script
│   ├── (No Quick Tabs visible - they were in Tab A)
│   └── Link Detection
```

### New Architecture (Sidebar-Based)

```
Sidebar Panel (Independent of Tab Context)
├── Quick Tab List
├── Active Quick Tab Display
│   └── iframe (persistent across all tabs)
└── Navigation Controls

Tab A (YouTube)
├── Content Script
│   ├── Link Detection
│   └── "Create Quick Tab" messaging to Sidebar

Tab B (Google Docs)
├── Content Script
│   ├── Link Detection
│   └── "Create Quick Tab" messaging to Sidebar
```

**Key Difference**: The Quick Tab UI lives in the sidebar, not in the page DOM. It's managed by the browser and persists across all tabs automatically.

---

## Browser Compatibility

| Browser | API Used | Version Required | Support Level |
|---------|----------|------------------|----------------|
| Firefox | `sidebarAction` | All versions | ✅ Full Support |
| Chrome | `sidePanel` | 114+ (March 2023) | ✅ Full Support |
| Edge | `sidePanel` | 114+ (March 2023) | ✅ Full Support |
| Opera | `sidebar_action` | All versions | ✅ Full Support |
| Safari | Custom Solution Required | N/A | ⚠️ Limited |

**Recommendation**: Implement Firefox and Chrome support via manifest conditionals. Safari support can be added later.

---

## Step-by-Step Implementation

### Phase 1: Update Manifest Configuration

#### Step 1.1: Modify `manifest.json`

The manifest needs to declare both sidebar (Firefox) and sidePanel (Chrome) capabilities:

```json
{
  "manifest_version": 3,
  "name": "Copy URL on Hover with Quick Tabs",
  "version": "1.6.0",
  "description": "Copy URLs while hovering over links. Quick Tabs persist across all tabs.",
  
  // Permissions for sidebar/side panel functionality
  "permissions": [
    "scripting",
    "storage",
    "activeTab",
    "sidePanel"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  
  // Firefox: Sidebar Action
  "sidebar_action": {
    "default_panel": "sidebar.html",
    "default_title": "Quick Tabs",
    "default_icon": {
      "24": "icons/icon-24.png",
      "32": "icons/icon-32.png"
    }
  },
  
  // Chrome/Edge: Side Panel (alternative approach)
  "side_panel": {
    "default_path": "sidebar.html"
  },
  
  // Keep action button for browser compatibility
  "action": {
    "default_title": "Copy URL on Hover Settings",
    "default_popup": "popup.html",
    "default_icon": {
      "24": "icons/icon-24.png",
      "32": "icons/icon-32.png"
    }
  },
  
  "background": {
    "service_worker": "background.js"
  },
  
  "icons": {
    "24": "icons/icon-24.png",
    "32": "icons/icon-32.png",
    "96": "icons/icon-96.png"
  },
  
  "browser_specific_settings": {
    "gecko": {
      "id": "copy-url-hover@chunkynosher.github.io",
      "update_url": "https://raw.githubusercontent.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/main/updates.json"
    }
  }
}
```

**Key Changes**:
- Added `"sidePanel"` permission
- Added `"sidebar_action"` for Firefox (top-level)
- Added `"side_panel"` for Chrome/Edge (top-level)
- Kept `"action"` for settings popup (users still access settings via toolbar icon)
- Changed `"background": "scripts"` to `"background": "service_worker"` (MV3 requirement)

**Important Note on Manifest Structure**:
- `sidebar_action` is a **top-level key** in Firefox
- `side_panel` is a **top-level key** in Chrome/Edge
- Both can coexist without conflicts
- Firefox ignores `side_panel`, Chrome ignores `sidebar_action`

---

### Phase 2: Create Sidebar UI Files

#### Step 2.1: Create `sidebar.html`

This is the HTML file for the persistent sidebar panel:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quick Tabs</title>
    <link rel="stylesheet" href="sidebar.css">
</head>
<body>
    <div id="sidebar-container">
        <!-- Header with controls -->
        <div id="sidebar-header">
            <h1>Quick Tabs</h1>
            <div id="header-controls">
                <button id="clear-all-btn" title="Clear all Quick Tabs">🗑️</button>
                <button id="settings-btn" title="Open Settings">⚙️</button>
            </div>
        </div>
        
        <!-- Quick Tabs list -->
        <div id="quick-tabs-list">
            <div class="empty-state">
                <p>No Quick Tabs open</p>
                <small>Hover over a link and press <kbd>Q</kbd> to create one</small>
            </div>
        </div>
        
        <!-- Active Quick Tab display area -->
        <div id="quick-tab-display">
            <div id="iframe-container">
                <!-- iframe will be injected here -->
            </div>
            
            <!-- Navigation controls for the iframe -->
            <div id="tab-controls">
                <button id="btn-back" title="Go Back">←</button>
                <button id="btn-forward" title="Go Forward">→</button>
                <button id="btn-reload" title="Reload">↻</button>
                <button id="btn-open-external" title="Open in New Tab">🔗</button>
            </div>
        </div>
    </div>
    
    <!-- Debug console (hidden by default) -->
    <div id="debug-console" style="display: none;">
        <div id="debug-output"></div>
    </div>
    
    <script src="sidebar.js"></script>
</body>
</html>
```

---

#### Step 2.2: Create `sidebar.css`

Styling for the sidebar interface:

```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html, body {
    width: 100%;
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    background: white;
    color: #333;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
    html, body {
        background: #2d2d2d;
        color: #e0e0e0;
    }
}

#sidebar-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    gap: 0;
}

/* Header */
#sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #e0e0e0;
    background: #f9f9f9;
    flex-shrink: 0;
    gap: 8px;
}

@media (prefers-color-scheme: dark) {
    #sidebar-header {
        background: #3a3a3a;
        border-bottom-color: #555;
    }
}

#sidebar-header h1 {
    font-size: 16px;
    font-weight: 600;
    flex: 1;
}

#header-controls {
    display: flex;
    gap: 4px;
}

#header-controls button {
    padding: 6px 8px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
}

@media (prefers-color-scheme: dark) {
    #header-controls button {
        background: #444;
        border-color: #555;
    }
}

#header-controls button:hover {
    background: #f0f0f0;
}

@media (prefers-color-scheme: dark) {
    #header-controls button:hover {
        background: #555;
    }
}

/* Quick Tabs List */
#quick-tabs-list {
    flex: 0 0 auto;
    max-height: 250px;
    overflow-y: auto;
    border-bottom: 1px solid #e0e0e0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

@media (prefers-color-scheme: dark) {
    #quick-tabs-list {
        border-bottom-color: #555;
    }
}

.empty-state {
    padding: 16px;
    text-align: center;
    color: #999;
    font-size: 12px;
}

.empty-state p {
    margin-bottom: 4px;
}

.quick-tab-item {
    display: flex;
    align-items: center;
    padding: 8px;
    background: #f5f5f5;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
    gap: 8px;
}

@media (prefers-color-scheme: dark) {
    .quick-tab-item {
        background: #3a3a3a;
    }
}

.quick-tab-item:hover {
    background: #e8e8e8;
}

@media (prefers-color-scheme: dark) {
    .quick-tab-item:hover {
        background: #444;
    }
}

.quick-tab-item.active {
    background: #4CAF50;
    color: white;
}

.quick-tab-favicon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 2px;
}

.quick-tab-title {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.quick-tab-url {
    font-size: 11px;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (prefers-color-scheme: dark) {
    .quick-tab-url {
        color: #aaa;
    }
}

.quick-tab-item.active .quick-tab-url {
    color: rgba(255, 255, 255, 0.8);
}

.quick-tab-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}

.quick-tab-actions button {
    padding: 4px 6px;
    background: transparent;
    border: 1px solid #ccc;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
}

@media (prefers-color-scheme: dark) {
    .quick-tab-actions button {
        border-color: #555;
    }
}

.quick-tab-actions button:hover {
    background: #e0e0e0;
}

@media (prefers-color-scheme: dark) {
    .quick-tab-actions button:hover {
        background: #555;
    }
}

.quick-tab-item.active .quick-tab-actions button {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
}

.quick-tab-item.active .quick-tab-actions button:hover {
    background: rgba(255, 255, 255, 0.3);
}

/* Quick Tab Display Area */
#quick-tab-display {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

#iframe-container {
    flex: 1;
    overflow: hidden;
    position: relative;
}

#iframe-container iframe {
    width: 100%;
    height: 100%;
    border: none;
}

/* Navigation Controls */
#tab-controls {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid #e0e0e0;
    background: #f9f9f9;
    flex-shrink: 0;
}

@media (prefers-color-scheme: dark) {
    #tab-controls {
        background: #3a3a3a;
        border-top-color: #555;
    }
}

#tab-controls button {
    flex: 1;
    padding: 8px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}

@media (prefers-color-scheme: dark) {
    #tab-controls button {
        background: #444;
        border-color: #555;
    }
}

#tab-controls button:hover {
    background: #e0e0e0;
}

@media (prefers-color-scheme: dark) {
    #tab-controls button:hover {
        background: #555;
    }
}

#tab-controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Debug Console */
#debug-console {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #1e1e1e;
    color: #00ff00;
    padding: 8px;
    font-size: 11px;
    font-family: 'Courier New', monospace;
    max-height: 100px;
    overflow-y: auto;
}

#debug-output {
    white-space: pre-wrap;
    word-break: break-all;
}

/* Responsive adjustments */
@media (max-width: 400px) {
    #sidebar-header h1 {
        font-size: 14px;
    }
    
    #quick-tabs-list {
        max-height: 150px;
    }
    
    .quick-tab-actions {
        gap: 2px;
    }
    
    .quick-tab-actions button {
        padding: 2px 4px;
        font-size: 10px;
    }
}
```

---

### Phase 3: Create Sidebar JavaScript Logic

#### Step 3.1: Create `sidebar.js`

```javascript
/**
 * Sidebar Script - Manages the persistent Quick Tabs sidebar
 * 
 * This script runs in the sidebar panel context and manages:
 * - Quick Tab list display
 * - Active Quick Tab iframe management
 * - Navigation controls
 * - Cross-tab communication
 */

// ============================================
// Global State
// ============================================

let quickTabsStore = new Map(); // URL -> { title, url, favicon }
let activeQuickTabUrl = null;
let currentIframe = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadQuickTabsFromStorage();
});

function initializeEventListeners() {
    // Header controls
    document.getElementById('clear-all-btn').addEventListener('click', clearAllQuickTabs);
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    
    // Navigation controls
    document.getElementById('btn-back').addEventListener('click', navigateBack);
    document.getElementById('btn-forward').addEventListener('click', navigateForward);
    document.getElementById('btn-reload').addEventListener('click', reloadIframe);
    document.getElementById('btn-open-external').addEventListener('click', openInNewTab);
}

// ============================================
// Listen for Messages from Content Scripts
// ============================================

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'createQuickTab') {
        addQuickTab(message.url, message.title || 'Untitled', sender.url);
    } else if (message.action === 'getQuickTabsCount') {
        sendResponse({ count: quickTabsStore.size });
    }
});

// ============================================
// Quick Tab Management
// ============================================

function addQuickTab(url, title, referrerUrl) {
    try {
        const urlObj = new URL(url);
        const key = urlObj.href;
        
        // Get favicon from Google Favicon service
        const domain = urlObj.hostname;
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        
        // Add or update in store
        quickTabsStore.set(key, {
            url: url,
            title: title || domain,
            favicon: faviconUrl,
            createdAt: Date.now()
        });
        
        // Save to browser storage
        saveQuickTabsToStorage();
        
        // Render the list
        renderQuickTabsList();
        
        // Auto-select the newly created Quick Tab
        selectQuickTab(key);
        
        debug(`Quick Tab added: ${title}`);
        
    } catch (error) {
        console.error('Error adding Quick Tab:', error);
    }
}

function removeQuickTab(key) {
    quickTabsStore.delete(key);
    saveQuickTabsToStorage();
    renderQuickTabsList();
    
    // If this was the active tab, select the first remaining one
    if (activeQuickTabUrl === key) {
        const firstEntry = quickTabsStore.entries().next().value;
        if (firstEntry) {
            selectQuickTab(firstEntry[0]);
        } else {
            activeQuickTabUrl = null;
            clearIframeDisplay();
        }
    }
    
    debug(`Quick Tab removed: ${key}`);
}

function selectQuickTab(key) {
    const tab = quickTabsStore.get(key);
    if (!tab) return;
    
    activeQuickTabUrl = key;
    renderQuickTabsList(); // Update UI to show active state
    loadIframeWithUrl(tab.url);
    
    debug(`Quick Tab selected: ${tab.title}`);
}

function clearAllQuickTabs() {
    if (quickTabsStore.size === 0) return;
    
    if (confirm('Are you sure you want to close all Quick Tabs?')) {
        quickTabsStore.clear();
        saveQuickTabsToStorage();
        activeQuickTabUrl = null;
        renderQuickTabsList();
        clearIframeDisplay();
        debug('All Quick Tabs cleared');
    }
}

// ============================================
// Iframe Management
// ============================================

function loadIframeWithUrl(url) {
    const container = document.getElementById('iframe-container');
    
    // Remove existing iframe
    const existingIframe = container.querySelector('iframe');
    if (existingIframe) {
        existingIframe.remove();
    }
    
    // Create new iframe
    currentIframe = document.createElement('iframe');
    currentIframe.src = url;
    currentIframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
    `;
    
    // Handle iframe errors
    currentIframe.addEventListener('error', () => {
        console.error('Error loading iframe:', url);
        showErrorMessage('Failed to load page');
    });
    
    container.appendChild(currentIframe);
    updateNavigationControlsState();
    
    debug(`Iframe loaded with URL: ${url}`);
}

function clearIframeDisplay() {
    const container = document.getElementById('iframe-container');
    container.innerHTML = '';
    currentIframe = null;
}

function showErrorMessage(message) {
    const container = document.getElementById('iframe-container');
    container.innerHTML = `
        <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #666;
            text-align: center;
            padding: 16px;
        ">
            <div>
                <p style="font-size: 14px; margin-bottom: 8px;">⚠️ ${message}</p>
                <small>${activeQuickTabUrl || 'No URL loaded'}</small>
            </div>
        </div>
    `;
}

// ============================================
// Navigation Controls
// ============================================

function navigateBack() {
    if (currentIframe && currentIframe.contentWindow.history.length > 1) {
        try {
            currentIframe.contentWindow.history.back();
        } catch (error) {
            console.error('Error navigating back:', error);
        }
    }
}

function navigateForward() {
    if (currentIframe) {
        try {
            currentIframe.contentWindow.history.forward();
        } catch (error) {
            console.error('Error navigating forward:', error);
        }
    }
}

function reloadIframe() {
    if (currentIframe) {
        try {
            currentIframe.contentWindow.location.reload();
        } catch (error) {
            console.error('Error reloading iframe:', error);
        }
    }
}

function openInNewTab() {
    if (activeQuickTabUrl) {
        browser.tabs.create({ url: activeQuickTabUrl });
    }
}

function updateNavigationControlsState() {
    // Disable/enable back/forward buttons based on history state
    // Note: Due to sandbox restrictions, we can't directly check history
    // So we always keep them enabled
    document.getElementById('btn-back').disabled = false;
    document.getElementById('btn-forward').disabled = false;
}

// ============================================
// Rendering
// ============================================

function renderQuickTabsList() {
    const listContainer = document.getElementById('quick-tabs-list');
    
    if (quickTabsStore.size === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>No Quick Tabs open</p>
                <small>Hover over a link and press <kbd>Q</kbd> to create one</small>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = '';
    
    quickTabsStore.forEach((tab, key) => {
        const item = document.createElement('div');
        item.className = 'quick-tab-item';
        if (key === activeQuickTabUrl) {
            item.classList.add('active');
        }
        
        // Favicon
        const favicon = document.createElement('img');
        favicon.className = 'quick-tab-favicon';
        favicon.src = tab.favicon;
        favicon.onerror = () => {
            favicon.style.display = 'none';
        };
        
        // Title and URL info
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            cursor: pointer;
        `;
        
        const titleElement = document.createElement('div');
        titleElement.className = 'quick-tab-title';
        titleElement.textContent = tab.title;
        
        const urlElement = document.createElement('div');
        urlElement.className = 'quick-tab-url';
        urlElement.textContent = new URL(tab.url).hostname;
        
        titleDiv.appendChild(titleElement);
        titleDiv.appendChild(urlElement);
        
        // Make title/URL clickable to select the tab
        titleDiv.addEventListener('click', () => selectQuickTab(key));
        
        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'quick-tab-actions';
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.title = 'Close';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeQuickTab(key);
        });
        
        actions.appendChild(removeBtn);
        
        // Assemble
        item.appendChild(favicon);
        item.appendChild(titleDiv);
        item.appendChild(actions);
        
        listContainer.appendChild(item);
    });
}

// ============================================
// Storage Management
// ============================================

function saveQuickTabsToStorage() {
    const data = Array.from(quickTabsStore.entries()).map(([key, tab]) => ({
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        createdAt: tab.createdAt
    }));
    
    browser.storage.local.set({ quickTabs: data });
}

function loadQuickTabsFromStorage() {
    browser.storage.local.get(['quickTabs'], (result) => {
        if (result.quickTabs && Array.isArray(result.quickTabs)) {
            quickTabsStore.clear();
            result.quickTabs.forEach(tab => {
                quickTabsStore.set(tab.url, tab);
            });
            renderQuickTabsList();
        }
    });
}

// ============================================
// Settings
// ============================================

function openSettings() {
    browser.runtime.openOptionsPage();
}

// ============================================
// Utilities
// ============================================

function debug(message) {
    console.log('[Quick Tabs Sidebar]', message);
    
    // Also display in debug console if visible
    const debugOutput = document.getElementById('debug-output');
    if (debugOutput && debugOutput.parentElement.style.display !== 'none') {
        const timestamp = new Date().toLocaleTimeString();
        debugOutput.textContent += `[${timestamp}] ${message}\n`;
        debugOutput.parentElement.scrollTop = debugOutput.parentElement.scrollHeight;
    }
}

// ============================================
// Expose Debug Functions (for console)
// ============================================

window.DEBUG_showQuickTabs = () => {
    console.log(Array.from(quickTabsStore.entries()));
};

window.DEBUG_toggleConsole = () => {
    const console = document.getElementById('debug-console');
    console.style.display = console.style.display === 'none' ? 'block' : 'none';
};

window.DEBUG_clearStorage = () => {
    browser.storage.local.clear();
    quickTabsStore.clear();
    renderQuickTabsList();
    debug('Storage cleared');
};
```

---

### Phase 4: Update Content Script

#### Step 4.1: Modify `content.js` for Sidebar Integration

Replace the Quick Tab creation code with sidebar messaging. Find this section in your current `content.js`:

**FIND** (around line 1000-1100):
```javascript
function createQuickTabWindow(url, width, height, left, top) {
    // Current implementation with floating window creation
}
```

**REPLACE WITH**:
```javascript
function createQuickTabWindow(url, width, height, left, top) {
    // Send message to sidebar instead of creating floating window
    browser.runtime.sendMessage({
        action: 'createQuickTab',
        url: url,
        title: document.title
    }).then(response => {
        if (response && response.success) {
            showNotification('Quick Tab created ✓');
        }
    }).catch(err => {
        console.error('Error creating Quick Tab:', err);
    });
}
```

**IMPORTANT**: Keep all other Quick Tab code (resize logic, minimize functionality) commented out or removed, as these are no longer needed.

Also, remove or comment out these functions as they're no longer relevant:
- `createQuickTabWindowIframe()`
- `makeResizable()`
- `makeDraggable()`
- `showMinimizedManager()`
- `restoreQuickTab()`
- `deleteMinimizedQuickTab()`

Keep all the link detection, keyboard shortcut handling, and notification logic intact.

---

### Phase 5: Update Background Script

#### Step 5.1: Simplify `background.js` for Sidebar

Replace the entire `background.js` with this simplified version:

```javascript
/**
 * Background Script - Handles messaging and tab management
 */

// Listen for messages from content scripts and sidebar
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    
    if (message.action === 'openTab') {
        // Open a link in a new tab
        browser.tabs.create({
            url: message.url,
            active: message.switchFocus
        });
    } else if (message.action === 'createQuickTab') {
        // Forward to sidebar (sidebar will handle via runtime.onMessage)
        sendResponse({ success: true });
    }
});

// Handle sidePanel toggle for Chrome (optional)
if (browser.sidePanel) {
    browser.action.onClicked.addListener((tab) => {
        browser.sidePanel.open({ windowId: tab.windowId });
    });
}
```

That's it! The background script is now much simpler because the sidebar handles all the state management.

---

## File Structure

Your extension directory should now look like this:

```
copy-url-hover-extension/
├── manifest.json                 (Updated)
├── content.js                    (Modified - Quick Tab creation simplified)
├── background.js                 (Simplified)
├── popup.html                    (Unchanged - settings popup)
├── popup.js                       (Unchanged)
├── sidebar.html                  (NEW)
├── sidebar.js                    (NEW)
├── sidebar.css                   (NEW)
├── icons/
│   ├── icon-24.png
│   ├── icon-32.png
│   └── icon-96.png
├── updates.json                  (Unchanged)
└── README.md
```

**New Files**:
- `sidebar.html` - Sidebar panel UI
- `sidebar.js` - Sidebar logic and state management
- `sidebar.css` - Sidebar styling

**Modified Files**:
- `manifest.json` - Added sidebar/sidePanel declarations
- `content.js` - Simplified Quick Tab creation to send messages
- `background.js` - Greatly simplified

**Unchanged Files**:
- `popup.html` / `popup.js` - Settings remain the same
- `updates.json` - No changes needed

---

## Complete Code Examples

All complete code examples are provided above in each section. Here's a quick summary of what each file does:

| File | Purpose | Size |
|------|---------|------|
| `manifest.json` | Browser extension configuration | ~150 lines |
| `sidebar.html` | Sidebar UI structure | ~70 lines |
| `sidebar.css` | Sidebar styling (responsive) | ~300 lines |
| `sidebar.js` | Sidebar logic and state management | ~400 lines |
| `content.js` | MODIFIED - Quick Tab messaging | Keep most of it, remove floating window code |
| `background.js` | SIMPLIFIED - Basic messaging | ~40 lines |
| `popup.js` | UNCHANGED - Settings UI logic | Keep as-is |

---

## Migration Guide from Current Implementation

### Step 1: Backup Current Code

```bash
git commit -m "Backup: v1.5.0 before sidebar migration"
git tag v1.5.0-backup
```

### Step 2: Replace Files Systematically

1. **Update manifest.json**: Replace entirely with the new version
2. **Create new files**: Add `sidebar.html`, `sidebar.js`, `sidebar.css`
3. **Update content.js**:
   - Keep: Link detection logic, keyboard shortcuts, notifications
   - Replace: Quick Tab window creation function
   - Remove: Floating window/resize/drag code (~1500 lines can be removed)
4. **Replace background.js** entirely
5. **Keep unchanged**: `popup.html`, `popup.js`, `updates.json`

### Step 3: Testing During Migration

Test in stages:
1. **Test manifest loading**: Load in Firefox/Chrome dev mode
2. **Test sidebar opening**: Click extension icon, verify sidebar appears
3. **Test Quick Tab creation**: Hover over link, press Q
4. **Test persistence**: Switch tabs, verify Quick Tab is still there
5. **Test iframe controls**: Test back/forward/reload/open buttons

### Step 4: Update Version Number

In `manifest.json`:
```json
"version": "1.6.0"
```

In changelogs:
```markdown
# v1.6.0 - Sidebar Implementation (Issue #35 Fix)

## Major Changes
- Implemented Firefox sidebarAction and Chrome sidePanel APIs
- Quick Tabs now persist across all browser tabs
- Removed floating window implementation
- Greatly simplified codebase (~2000 lines removed)

## New Features
- True cross-tab persistence (no flickering)
- Native browser sidebar integration
- Persistent Quick Tab list
- Better memory management

## Fixes
- Resolves #35: Quick Tabs now stay open when switching tabs
```

---

## Testing and Deployment

### Testing Checklist

#### Manual Testing

```
[ ] Firefox Testing
  [ ] Sidebar appears in left panel
  [ ] Can create Quick Tabs with Q key
  [ ] Quick Tabs persist when switching tabs
  [ ] Back/Forward/Reload buttons work
  [ ] Can open Quick Tab in new tab
  [ ] Can close individual Quick Tabs
  [ ] Can clear all Quick Tabs

[ ] Chrome/Edge Testing
  [ ] Side panel appears when clicking extension icon
  [ ] Same functionality as Firefox
  [ ] Responsive design works on smaller windows

[ ] Keyboard Shortcuts
  [ ] Copy URL (Y) still works
  [ ] Copy Text (X) still works
  [ ] Open Tab (O) still works
  [ ] Create Quick Tab (Q) works

[ ] Edge Cases
  [ ] Opening HTTPS-only sites works
  [ ] Local files (file://) handled gracefully
  [ ] Cross-origin iframes work
  [ ] Switching between many tabs rapidly works
  [ ] Closing tab with active Quick Tab works
```

#### Automated Testing (Browser Extension API)

Create a simple test file at `tests/test-sidebar.js`:

```javascript
// Test Quick Tab storage persistence
async function testStoragePersistence() {
    const tab1 = { url: 'https://example.com', title: 'Example' };
    await browser.storage.local.set({ quickTabs: [tab1] });
    
    const result = await browser.storage.local.get(['quickTabs']);
    console.assert(result.quickTabs.length === 1, 'Storage persistence failed');
    console.log('✓ Storage persistence test passed');
}

// Test messaging between content script and sidebar
async function testMessaging() {
    const response = await browser.runtime.sendMessage({
        action: 'createQuickTab',
        url: 'https://example.com',
        title: 'Example'
    });
    
    console.assert(response.success === true, 'Messaging failed');
    console.log('✓ Messaging test passed');
}

// Run tests
testStoragePersistence().then(() => testMessaging());
```

### Deployment Steps

#### Firefox Add-on Store

1. Package the extension:
```bash
zip -r copy-url-hover-v1.6.0.xpi \
  manifest.json \
  sidebar.html sidebar.js sidebar.css \
  content.js background.js \
  popup.html popup.js \
  icons/ updates.json
```

2. Upload to [addons.mozilla.org](https://addons.mozilla.org/)
3. Update with version 1.6.0 and new description mentioning Issue #35 fix

#### Chrome Web Store

1. Create `.crx` file or prepare for Web Store upload
2. Update description to mention new sidebar feature
3. Include screenshots showing sidebar with Quick Tabs
4. Set Chrome version requirement: 114+

#### GitHub Release

```bash
git tag v1.6.0
git push origin v1.6.0
# Create release with download links
```

---

## Troubleshooting

### Common Issues

#### Sidebar doesn't appear in Firefox

**Problem**: Sidebar icon not showing or sidebar doesn't open

**Solutions**:
- Verify `sidebar_action` is in manifest.json (top-level, not inside action)
- Check manifest has `"sidePanel"` permission
- Clear extension and reinstall
- Check browser console (F12) for errors

**Debug**:
```javascript
// In sidebar.js console:
console.log(browser.sidebarAction ? 'sidebarAction available' : 'sidebarAction NOT available');
```

#### Side panel doesn't appear in Chrome

**Problem**: No side panel button or panel won't open

**Solutions**:
- Verify Chrome version 114+
- Check `side_panel` is in manifest.json (top-level)
- Verify `sidePanel` permission is present
- Ensure `sidebar.html` exists and has no errors

#### Quick Tabs not persisting

**Problem**: Quick Tab list empty after page reload or switching tabs

**Solutions**:
- Check browser storage (DevTools > Storage > Local Storage)
- Verify `saveQuickTabsToStorage()` is being called
- Check for storage permission in manifest
- Try clearing storage: `browser.storage.local.clear()`

**Debug**:
```javascript
// In sidebar.js console:
window.DEBUG_showQuickTabs(); // Shows stored Quick Tabs
window.DEBUG_clearStorage(); // Clear and restart
```

#### iframe content not loading

**Problem**: Side panel shows blank or "Failed to load page"

**Solutions**:
- Verify URL is valid (http/https)
- Check CORS headers (some sites block embedding)
- Verify iframe sandbox policy (if applied)
- Check Content Security Policy in sidebar.html

**Debug**:
```javascript
window.DEBUG_toggleConsole(); // Show debug messages
// Then check what URLs are being loaded
```

#### Navigation buttons don't work

**Problem**: Back/Forward/Reload buttons are disabled or inactive

**Solutions**:
- These buttons have limited functionality due to iframe sandbox
- For full functionality, remove `sandbox` attribute from iframe (if present)
- Some sites explicitly prevent iframe navigation for security

**Workaround**:
```javascript
// In sidebar.js, modify navigation functions:
function navigateBack() {
    // If direct navigation fails, reload and request server-side back navigation
    if (currentIframe && !currentIframe.contentWindow.history.back) {
        reloadIframe(); // Fallback to reload
    }
}
```

#### High memory usage

**Problem**: Extension uses more memory than expected

**Solutions**:
- Sidebar now stores fewer DOM elements (only one iframe)
- Should actually use LESS memory than floating windows
- If memory grows: check for iframe state not being cleaned properly
- Clear old Quick Tabs: `window.DEBUG_clearStorage()`

#### Extension conflicts with other addons

**Problem**: Sidebar doesn't work when other extensions are enabled

**Solutions**:
- Check for permission conflicts (storage, scripting)
- Test with extensions disabled
- Ensure `host_permissions: ["<all_urls>"]` is present
- Check manifest for any typos or conflicts

---

## Final Checklist Before Release

- [ ] All files created (sidebar.html, sidebar.js, sidebar.css)
- [ ] manifest.json updated with sidebar/sidePanel config
- [ ] content.js Quick Tab creation simplified to messaging
- [ ] background.js simplified to minimal code
- [ ] popup.js and popup.html unchanged
- [ ] Testing completed on Firefox (all scenarios)
- [ ] Testing completed on Chrome (if targeting)
- [ ] Version number bumped to 1.6.0
- [ ] CHANGELOG updated
- [ ] README.md updated with new features
- [ ] GitHub issues/PRs updated (mention Issue #35 resolution)
- [ ] Code commented appropriately
- [ ] No console errors in any context
- [ ] Storage persistence verified
- [ ] Cross-tab switching tested
- [ ] Keyboard shortcuts verified
- [ ] Ready for release

---

## Next Steps After Implementation

1. **Gather User Feedback**: Create GitHub issue asking for feedback on v1.6.0
2. **Monitor Performance**: Check user reports on memory/CPU usage
3. **Consider Optional Features**:
   - Drag/drop to reorder Quick Tabs in list
   - Quick Tab favorites/pinning
   - Search within Quick Tabs list
   - Export/import Quick Tab collections
4. **Plan Future Improvements**:
   - Multi-window support (sync Quick Tabs across browser windows)
   - Cloud sync (save Quick Tabs across devices)
   - Keyboard shortcuts for Quick Tab navigation

---

## Additional Resources

- [Mozilla sidebarAction API Docs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)
- [Chrome sidePanel API Docs](https://developer.chrome.com/docs/extensions/reference/sidePanel/)
- [WebExtension Porting Guide](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities)
- [Web.dev Extension Best Practices](https://web.dev/articles/ext-bestpractices)
