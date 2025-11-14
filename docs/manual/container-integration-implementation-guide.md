# Firefox Container Tabs Integration Implementation Guide

**Repository**: copy-URL-on-hover_ChunkyEdition  
**Current Version**: 1.5.5.10  
**Target Feature**: Container-Aware Quick Tabs  
**Document Version**: 1.0  
**Last Updated**: November 11, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Understanding Firefox Containers](#understanding-firefox-containers)
3. [Current Architecture Analysis](#current-architecture-analysis)
4. [Container Integration Architecture](#container-integration-architecture)
5. [Implementation Steps](#implementation-steps)
6. [Code Changes Required](#code-changes-required)
7. [Testing Procedures](#testing-procedures)
8. [Troubleshooting](#troubleshooting)
9. [Additional Resources](#additional-resources)

---

## Overview

### Goal

Modify the copy-URL-on-hover extension to make Quick Tabs container-aware, so
that Quick Tabs opened in Firefox Container 1 **do not** appear in Firefox
Container 2, and vice versa. Each container should maintain its own independent
Quick Tab state.

### Current Behavior (Version 1.5.5.10)

- Quick Tabs are synchronized globally across all browser tabs regardless of
  which Firefox Container they're in
- A Quick Tab opened in Container 1 appears in all tabs, including tabs in
  Container 2, Container 3, etc.
- The extension uses `browser.storage.sync` and `BroadcastChannel` for cross-tab
  synchronization
- State is keyed only by URL, not by container identity

### Desired Behavior After Implementation

**Scenario 1**: User opens a Quick Tab of Wikipedia in a tab within Firefox
Container 1  
**Scenario 2**: User switches to a tab in Firefox Container 2  
**Expected Result**: The Quick Tab from Container 1 **does not** appear in
Container 2

Each Firefox Container should have its own isolated Quick Tab state that
persists only within tabs belonging to that container.

---

## Understanding Firefox Containers

### What Are Firefox Containers?

Firefox Containers (also called Contextual Identities) allow users to
compartmentalize their browsing by isolating cookies, localStorage, IndexedDB,
and other web storage for different contexts (Personal, Work, Banking, Shopping,
etc.).

Each container has:

- A **unique `cookieStoreId`** (e.g., `"firefox-container-1"`,
  `"firefox-container-2"`)
- A **`userContextId`** (numeric identifier)
- Isolated storage for cookies, localStorage, indexedDB, cache, etc.
- Visual indicators (colored tabs with container names)

### cookieStoreId Values

| Container Type         | cookieStoreId           |
| ---------------------- | ----------------------- |
| Default (no container) | `"firefox-default"`     |
| Private browsing       | `"firefox-private"`     |
| Container 1            | `"firefox-container-1"` |
| Container 2            | `"firefox-container-2"` |
| Container N            | `"firefox-container-N"` |

**Source**: Mozilla Developer Documentation [1][2]

### Firefox Container APIs

Firefox provides the **`contextualIdentities` API** to work with containers:

```javascript
// Get all containers
const containers = await browser.contextualIdentities.query({});

// Get a specific container by cookieStoreId
const container = await browser.contextualIdentities.get(cookieStoreId);

// Create a new container
const newContainer = await browser.contextualIdentities.create({
  name: 'Work',
  color: 'blue',
  icon: 'briefcase'
});
```

**Key API**: `browser.tabs.query()` supports filtering by `cookieStoreId`:

```javascript
// Get all tabs in Container 1
const containerTabs = await browser.tabs.query({
  cookieStoreId: 'firefox-container-1'
});
```

**Source**: MDN Web Docs - contextualIdentities API [3][4]

---

## Current Architecture Analysis

### Current State Management

The extension currently uses a **multi-layer synchronization architecture**:

1. **BroadcastChannel** - Real-time same-origin tab synchronization
2. **browser.storage.sync** - Persistent cross-device storage
3. **browser.storage.session** - Fast ephemeral storage (Firefox 115+)
4. **Background script** - Central coordinator for cross-origin sync via
   `browser.runtime.sendMessage()`

### Current Storage Structure

```javascript
// browser.storage.sync
{
  "quick_tabs_state_v2": {
    "tabs": [
      {
        "id": "qt-1699999999999-abc123",
        "url": "https://en.wikipedia.org/wiki/Firefox",
        "title": "Firefox - Wikipedia",
        "left": 100,
        "top": 200,
        "width": 600,
        "height": 400,
        "pinnedToUrl": null,
        "minimized": false
      },
      // ... more Quick Tabs
    ],
    "timestamp": 1699999999999
  }
}
```

### Why Current Architecture is Container-Agnostic

The storage key `"quick_tabs_state_v2"` is **global** - it doesn't distinguish
between containers. When background.js broadcasts Quick Tab state updates, it
sends them to **all tabs** without checking their `cookieStoreId`.

---

## Container Integration Architecture

### High-Level Design

Instead of storing Quick Tabs in a single global array, we'll **namespace Quick
Tab state by `cookieStoreId`**:

```javascript
// NEW structure: Container-keyed state
{
  "quick_tabs_state_v3": {
    "firefox-default": {
      "tabs": [...],
      "timestamp": 1699999999999
    },
    "firefox-container-1": {
      "tabs": [...],
      "timestamp": 1699999999999
    },
    "firefox-container-2": {
      "tabs": [...],
      "timestamp": 1699999999999
    }
  }
}
```

### Container Detection Flow

```
┌─────────────────────────────────────────┐
│  User presses Q to open Quick Tab      │
│  (content.js)                           │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Get current tab's cookieStoreId        │
│  await browser.tabs.getCurrent()        │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Create Quick Tab with container ID     │
│  sendMessage({                          │
│    action: "CREATE_QUICK_TAB",          │
│    cookieStoreId: "firefox-container-1" │
│  })                                     │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Background script receives message     │
│  Updates state for that container only  │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Broadcast to tabs in SAME container    │
│  Filter by cookieStoreId                │
└─────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Update manifest.json Permissions

**File**: `manifest.json`

**Add** the `contextualIdentities` and `cookies` permissions:

```json
{
  "manifest_version": 2,
  "name": "Copy URL on Hover Custom",
  "version": "1.5.6",
  "permissions": [
    "storage",
    "tabs",
    "webRequest",
    "webRequestBlocking",
    "<all_urls>",
    "contextualIdentities",
    "cookies"
  ]
}
```

**Why**:

- `contextualIdentities` - Access to container management API
- `cookies` - Required to access the `cookieStoreId` property of tabs

**Source**: Mozilla Add-ons WebExtensions API [5][6]

---

### Step 2: Create Container Detection Helper

**File**: `state-manager.js` (add new helper function)

**Add this function** near the top of `state-manager.js`:

```javascript
/**
 * Get the cookieStoreId of the current tab
 * @returns {Promise<string>} The cookieStoreId (e.g., "firefox-container-1")
 */
async function getCurrentCookieStoreId() {
  try {
    // For content scripts: query for active tab in current window
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    if (tabs && tabs.length > 0) {
      // Default to "firefox-default" if cookieStoreId is missing
      return tabs[0].cookieStoreId || 'firefox-default';
    }

    // Fallback to default container
    return 'firefox-default';
  } catch (err) {
    console.error('[QuickTabStateManager] Error getting cookieStoreId:', err);
    return 'firefox-default';
  }
}
```

---

### Step 3: Modify QuickTabStateManager for Container-Aware Storage

**File**: `state-manager.js`

**Replace** the `save()` method:

```javascript
/**
 * Save Quick Tab state to storage (container-aware)
 * @param {Array} tabs - Array of Quick Tab objects to save
 * @param {string} cookieStoreId - Optional cookieStoreId (will auto-detect if not provided)
 * @returns {Promise<Object>} - The saved state object
 */
async save(tabs, cookieStoreId = null) {
  // Auto-detect container if not provided
  if (!cookieStoreId) {
    cookieStoreId = await getCurrentCookieStoreId();
  }

  this.log(`Saving ${tabs.length} Quick Tabs for container: ${cookieStoreId}`);

  try {
    // Load existing state for all containers
    const existingData = await browser.storage.sync.get(this.stateKey) || {};
    const containerStates = existingData[this.stateKey] || {};

    // Update state for this specific container
    containerStates[cookieStoreId] = {
      tabs: tabs || [],
      timestamp: Date.now()
    };

    // Save back to storage
    const promises = [];

    // Save to sync storage
    promises.push(
      browser.storage.sync.set({
        [this.stateKey]: containerStates
      })
        .then(() => this.log(`Saved to sync storage for ${cookieStoreId}`))
        .catch(err => console.error('Error saving to sync storage:', err))
    );

    // Also save to session storage if available
    if (this.hasSessionStorage) {
      promises.push(
        browser.storage.session.set({
          [this.sessionKey]: containerStates
        })
          .then(() => this.log(`Saved to session storage for ${cookieStoreId}`))
          .catch(err => console.error('Error saving to session storage:', err))
      );
    }

    await Promise.all(promises);

    return containerStates[cookieStoreId];
  } catch (err) {
    console.error('[QuickTabStateManager] Error in save():', err);
    throw err;
  }
}
```

**Replace** the `load()` method:

```javascript
/**
 * Load Quick Tab state from storage (container-aware)
 * @param {string} cookieStoreId - Optional cookieStoreId (will auto-detect if not provided)
 * @returns {Promise<Object>} - The loaded state object with { tabs: [], timestamp: number }
 */
async load(cookieStoreId = null) {
  // Auto-detect container if not provided
  if (!cookieStoreId) {
    cookieStoreId = await getCurrentCookieStoreId();
  }

  this.log(`Loading Quick Tab state for container: ${cookieStoreId}`);

  try {
    // Try session storage first (faster)
    if (this.hasSessionStorage) {
      const sessionResult = await browser.storage.session.get(this.sessionKey);
      if (sessionResult && sessionResult[this.sessionKey]) {
        const containerStates = sessionResult[this.sessionKey];
        if (containerStates[cookieStoreId]) {
          this.log(`Loaded ${containerStates[cookieStoreId].tabs.length} tabs from session storage`);
          return containerStates[cookieStoreId];
        }
      }
    }

    // Fall back to sync storage
    const syncResult = await browser.storage.sync.get(this.stateKey);
    if (syncResult && syncResult[this.stateKey]) {
      const containerStates = syncResult[this.stateKey];

      // Populate session storage for faster future reads
      if (this.hasSessionStorage) {
        await browser.storage.session.set({
          [this.sessionKey]: containerStates
        }).catch(err => console.error('Error populating session storage:', err));
      }

      if (containerStates[cookieStoreId]) {
        this.log(`Loaded ${containerStates[cookieStoreId].tabs.length} tabs from sync storage`);
        return containerStates[cookieStoreId];
      }
    }

    // No state found for this container
    this.log(`No saved state found for ${cookieStoreId}, returning empty state`);
    return { tabs: [], timestamp: Date.now() };

  } catch (err) {
    console.error('[QuickTabStateManager] Error loading Quick Tab state:', err);
    return { tabs: [], timestamp: Date.now() };
  }
}
```

**Update** the `addTab()`, `removeTab()`, `updatePosition()`, and `updateSize()`
methods to accept and use `cookieStoreId`:

```javascript
/**
 * Add a new Quick Tab (container-aware)
 * @param {Object} tab - Quick Tab object
 * @param {string} cookieStoreId - Optional cookieStoreId
 * @returns {Promise<Object>} - The updated state
 */
async addTab(tab, cookieStoreId = null) {
  if (!cookieStoreId) {
    cookieStoreId = await getCurrentCookieStoreId();
  }

  const currentState = await this.load(cookieStoreId);

  // Check if tab already exists (by ID)
  const existingIndex = currentState.tabs.findIndex(t => t.id === tab.id);
  if (existingIndex !== -1) {
    // Update existing tab
    currentState.tabs[existingIndex] = { ...currentState.tabs[existingIndex], ...tab };
  } else {
    // Add new tab
    currentState.tabs.push(tab);
  }

  return await this.save(currentState.tabs, cookieStoreId);
}

/**
 * Remove a Quick Tab by ID (container-aware)
 * @param {string} tabId - ID of the Quick Tab to remove
 * @param {string} cookieStoreId - Optional cookieStoreId
 * @returns {Promise<Object>} - The updated state
 */
async removeTab(tabId, cookieStoreId = null) {
  if (!cookieStoreId) {
    cookieStoreId = await getCurrentCookieStoreId();
  }

  const currentState = await this.load(cookieStoreId);
  const updatedTabs = currentState.tabs.filter(tab => tab.id !== tabId);
  return await this.save(updatedTabs, cookieStoreId);
}

/**
 * Update a specific Quick Tab's position (container-aware)
 * @param {string} tabId - ID of the Quick Tab
 * @param {number} left - Left position
 * @param {number} top - Top position
 * @param {string} cookieStoreId - Optional cookieStoreId
 * @returns {Promise<Object>} - The updated state
 */
async updatePosition(tabId, left, top, cookieStoreId = null) {
  if (!cookieStoreId) {
    cookieStoreId = await getCurrentCookieStoreId();
  }

  const currentState = await this.load(cookieStoreId);
  const updatedTabs = currentState.tabs.map(tab =>
    tab.id === tabId ? { ...tab, left, top } : tab
  );
  return await this.save(updatedTabs, cookieStoreId);
}

/**
 * Update a specific Quick Tab's size (container-aware)
 * @param {string} tabId - ID of the Quick Tab
 * @param {number} width - Width in pixels
 * @param {number} height - Height in pixels
 * @param {string} cookieStoreId - Optional cookieStoreId
 * @returns {Promise<Object>} - The updated state
 */
async updateSize(tabId, width, height, cookieStoreId = null) {
  if (!cookieStoreId) {
    cookieStoreId = await getCurrentCookieStoreId();
  }

  const currentState = await this.load(cookieStoreId);
  const updatedTabs = currentState.tabs.map(tab =>
    tab.id === tabId ? { ...tab, width, height } : tab
  );
  return await this.save(updatedTabs, cookieStoreId);
}
```

---

### Step 4: Update background.js for Container-Aware Broadcasting

**File**: `background.js`

**Replace** the `globalQuickTabState` initialization:

```javascript
// ==================== REAL-TIME STATE COORDINATOR ====================
// Container-aware global state hub
let globalQuickTabState = {
  // Keyed by cookieStoreId
  containers: {
    'firefox-default': { tabs: [], lastUpdate: 0 }
  }
};
```

**Replace** the `initializeGlobalState()` function:

```javascript
// Initialize global state from storage on extension startup (container-aware)
async function initializeGlobalState() {
  if (isInitialized) return;

  try {
    // Try session storage first (faster)
    let result;
    if (typeof browser.storage.session !== 'undefined') {
      result = await browser.storage.session.get('quick_tabs_session');
      if (result && result.quick_tabs_session) {
        // Expecting container-keyed structure
        globalQuickTabState.containers = result.quick_tabs_session;
        isInitialized = true;
        console.log('[Background] Initialized from session storage');
        return;
      }
    }

    // Fall back to sync storage
    result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (result && result.quick_tabs_state_v2) {
      globalQuickTabState.containers = result.quick_tabs_state_v2;
      isInitialized = true;
      console.log('[Background] Initialized from sync storage');
    } else {
      isInitialized = true;
      console.log('[Background] No saved state found, starting with empty state');
    }
  } catch (err) {
    console.error('[Background] Error initializing global state:', err);
    isInitialized = true;
  }
}
```

**Update** the `CREATE_QUICK_TAB` message handler:

```javascript
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

  // Check if tab already exists by ID
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
```

**Update** the `CLOSE_QUICK_TAB` message handler:

```javascript
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

  // Remove from global state by ID
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
```

**Update** the `UPDATE_QUICK_TAB_POSITION` and `UPDATE_QUICK_TAB_SIZE` handlers
similarly to filter broadcasts by `cookieStoreId`.

---

### Step 5: Update content.js to Pass cookieStoreId

**File**: `content.js`

**Modify** the Quick Tab creation code to detect and pass the container ID:

Find the section where Quick Tabs are created (around the keyboard event handler
for the Quick Tab key):

```javascript
// BEFORE (current implementation)
browser.runtime.sendMessage({
  action: 'CREATE_QUICK_TAB',
  id: quickTabId,
  url: url,
  left: left,
  top: top,
  width: width,
  height: height,
  title: title
});

// AFTER (container-aware)
// Detect current container
browser.tabs
  .getCurrent()
  .then(tab => {
    const cookieStoreId = tab ? tab.cookieStoreId || 'firefox-default' : 'firefox-default';

    browser.runtime.sendMessage({
      action: 'CREATE_QUICK_TAB',
      id: quickTabId,
      url: url,
      left: left,
      top: top,
      width: width,
      height: height,
      title: title,
      cookieStoreId: cookieStoreId // ADD THIS
    });
  })
  .catch(err => {
    console.error('[Quick Tabs] Error getting current tab:', err);
    // Fallback to default container
    browser.runtime.sendMessage({
      action: 'CREATE_QUICK_TAB',
      id: quickTabId,
      url: url,
      left: left,
      top: top,
      width: width,
      height: height,
      title: title,
      cookieStoreId: 'firefox-default'
    });
  });
```

**Modify** the Quick Tab close message similarly:

```javascript
// AFTER (container-aware)
browser.tabs.getCurrent().then(tab => {
  const cookieStoreId = tab ? tab.cookieStoreId || 'firefox-default' : 'firefox-default';

  browser.runtime.sendMessage({
    action: 'CLOSE_QUICK_TAB',
    id: quickTabId,
    url: url,
    cookieStoreId: cookieStoreId // ADD THIS
  });
});
```

**Modify** position and size update messages to include `cookieStoreId`.

---

### Step 6: Update BroadcastChannel to Filter by Container

**File**: `content.js` (BroadcastChannel section)

**Modify** the broadcast message listener to filter by container:

```javascript
// Listen to broadcasts from other same-origin tabs (container-aware)
if (window.quickTabsBroadcast) {
  window.quickTabsBroadcast.addEventListener('message', async event => {
    // Get current tab's cookieStoreId
    const currentTab = await browser.tabs.getCurrent();
    const currentCookieStoreId = currentTab
      ? currentTab.cookieStoreId || 'firefox-default'
      : 'firefox-default';

    // Ignore messages from different containers
    if (event.data.cookieStoreId && event.data.cookieStoreId !== currentCookieStoreId) {
      console.log(
        '[BroadcastChannel] Ignoring message from different container:',
        event.data.cookieStoreId
      );
      return;
    }

    // Process the message...
    if (event.data.type === 'QUICKTAB_MOVE') {
      // Handle Quick Tab move
    }
    // ... rest of message handling
  });
}
```

**Modify** the broadcast send to include `cookieStoreId`:

```javascript
// Broadcast Quick Tab position update (container-aware)
async function broadcastQuickTabMove(tabId, left, top) {
  if (window.quickTabsBroadcast) {
    const currentTab = await browser.tabs.getCurrent();
    const cookieStoreId = currentTab
      ? currentTab.cookieStoreId || 'firefox-default'
      : 'firefox-default';

    window.quickTabsBroadcast.postMessage({
      type: 'QUICKTAB_MOVE',
      id: tabId,
      left: left,
      top: top,
      cookieStoreId: cookieStoreId, // ADD THIS
      timestamp: Date.now()
    });
  }
}
```

---

## Code Changes Required

### Summary of Files to Modify

| File               | Changes Required                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`    | Add `contextualIdentities` and `cookies` permissions                                                                 |
| `state-manager.js` | Add `getCurrentCookieStoreId()` helper, modify `save()` and `load()` to be container-aware, update all state methods |
| `background.js`    | Modify `globalQuickTabState` structure, update message handlers to filter by `cookieStoreId`, update broadcast logic |
| `content.js`       | Detect and pass `cookieStoreId` in all Quick Tab messages, filter BroadcastChannel messages by container             |

---

## Testing Procedures

### Test 1: Basic Container Isolation

**Prerequisites**:

- Firefox with Multi-Account Containers extension installed
- Create at least 2 containers (e.g., "Personal", "Work")

**Steps**:

1. Open a tab in Container 1 (Personal)
2. Hover over a Wikipedia link
3. Press Q to open a Quick Tab
4. Verify the Quick Tab appears
5. Switch to a tab in Container 2 (Work)
6. **Expected Result**: The Quick Tab from Container 1 should **NOT** appear in
   Container 2

**Pass Criteria**: ✅ Quick Tab is not visible in Container 2

---

### Test 2: Multiple Quick Tabs Per Container

**Steps**:

1. Open a tab in Container 1
2. Open 3 different Quick Tabs (e.g., Wikipedia, GitHub, Reddit)
3. Switch to a tab in Container 2
4. Open 2 different Quick Tabs (e.g., YouTube, Twitter)
5. Switch back to Container 1
6. **Expected Result**: Only the 3 Quick Tabs from step 2 should appear
7. Switch back to Container 2
8. **Expected Result**: Only the 2 Quick Tabs from step 4 should appear

**Pass Criteria**: ✅ Each container maintains its own independent Quick Tab
list

---

### Test 3: Cross-Tab Persistence Within Container

**Steps**:

1. Open Tab A in Container 1
2. Open a Quick Tab of Wikipedia
3. Move the Quick Tab to position (200, 300)
4. Resize it to 700x500
5. Open Tab B in Container 1 (same container, different tab)
6. **Expected Result**: The Wikipedia Quick Tab should appear in Tab B at
   position (200, 300) with size 700x500

**Pass Criteria**: ✅ Quick Tab position and size persist across tabs in the
same container

---

### Test 4: Pin to Page with Containers

**Steps**:

1. Open Tab A in Container 1 at `https://example.com`
2. Open a Quick Tab of Wikipedia
3. Pin the Quick Tab to the current page
4. Navigate Tab A to `https://different.com`
5. **Expected Result**: Wikipedia Quick Tab should disappear (pinned to
   `example.com`)
6. Navigate Tab A back to `https://example.com`
7. **Expected Result**: Wikipedia Quick Tab should reappear

**Pass Criteria**: ✅ Pinned Quick Tabs work correctly within containers

---

### Test 5: Default Container (No Container)

**Steps**:

1. Open a regular tab (not in any container)
2. Open a Quick Tab
3. Open a tab in Container 1
4. **Expected Result**: The Quick Tab from the default container should **NOT**
   appear

**Pass Criteria**: ✅ Default container is isolated from numbered containers

---

### Test 6: Private Browsing

**Steps**:

1. Open a regular tab
2. Open a Quick Tab
3. Open a private browsing window
4. **Expected Result**: The Quick Tab from the regular tab should **NOT** appear
   in the private window

**Pass Criteria**: ✅ Private browsing has its own isolated Quick Tab state
(`firefox-private`)

---

## Troubleshooting

### Issue 1: Quick Tabs Appear in All Containers

**Symptom**: Quick Tabs from Container 1 appear in Container 2

**Diagnosis**:

- Check if `cookieStoreId` is being passed in messages
- Verify `browser.tabs.query({ cookieStoreId })` is filtering correctly
- Check console for errors

**Solution**:

1. Open Developer Tools (F12)
2. Check console for `[Background]` logs
3. Verify messages include `cookieStoreId` property
4. Ensure background.js is using `browser.tabs.query({ cookieStoreId })` when
   broadcasting

---

### Issue 2: Quick Tabs Don't Persist Across Tabs

**Symptom**: Quick Tabs disappear when switching tabs within the same container

**Diagnosis**:

- Check if state is being saved to `browser.storage.sync`
- Verify `load()` is using the correct `cookieStoreId`

**Solution**:

1. Check if `save()` is being called after Quick Tab creation
2. Verify storage structure has container-keyed data
3. Test with `browser.storage.sync.get('quick_tabs_state_v2')` in console

---

### Issue 3: Cannot Detect cookieStoreId

**Symptom**: `cookieStoreId` is always `undefined` or `null`

**Diagnosis**:

- Missing permissions in `manifest.json`
- `browser.tabs.getCurrent()` failing in content script context

**Solution**:

1. Verify `manifest.json` has `"contextualIdentities"` and `"cookies"`
   permissions
2. Use `browser.tabs.query({ active: true, currentWindow: true })` instead of
   `browser.tabs.getCurrent()` in content scripts
3. Ensure fallback to `"firefox-default"` is in place

---

## Additional Resources

### Mozilla Developer Documentation

1. **contextualIdentities API**  
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities

2. **Work with contextual identities**  
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Work_with_contextual_identities

3. **tabs.query() API**  
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query

4. **cookies.CookieStore**  
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/CookieStore

### Community Examples

5. **Multi-Account Containers Extension (GitHub)**  
   https://github.com/mozilla/multi-account-containers

6. **Temporary Containers Extension**  
   https://github.com/stoically/temporary-containers

7. **Firefox Containers Blog Post**  
   https://blog.mozilla.org/en/mozilla/introducing-firefox-multi-account-containers/

### Related Issues

8. **Request browser API change for cookieStoreId**  
   https://github.com/mozilla/multi-account-containers/issues/1029

9. **Firefox Container detection using cookieStoreId**  
   https://discourse.mozilla.org/t/firefox-container-detection-using-cookiestoreid/95554

---

## Version History

| Version | Date       | Changes                              |
| ------- | ---------- | ------------------------------------ |
| 1.0     | 2025-11-11 | Initial implementation guide created |

---

## Notes for GitHub Copilot

This implementation guide is designed to be processed by GitHub Copilot
Workspace. Key implementation points:

1. **All storage operations must be container-aware** - Always pass or detect
   `cookieStoreId`
2. **Background script is the central coordinator** - It broadcasts state
   updates only to tabs in the same container
3. **BroadcastChannel provides same-origin sync** - Messages should include
   `cookieStoreId` and be filtered on receipt
4. **State structure changes** - Migrate from flat array to container-keyed
   object
5. **Backward compatibility** - Consider migrating existing Quick Tab state from
   v1.5.5.10 to container-aware format

### Migration Strategy

When users upgrade from v1.5.5.10 to the container-aware version:

```javascript
// In background.js initialization
async function migrateOldState() {
  const oldState = await browser.storage.sync.get('quick_tabs_state_v2');

  if (oldState && oldState.quick_tabs_state_v2 && oldState.quick_tabs_state_v2.tabs) {
    // Old format: { tabs: [...], timestamp: ... }
    // Migrate to: { "firefox-default": { tabs: [...], timestamp: ... } }

    const migrated = {
      'firefox-default': oldState.quick_tabs_state_v2
    };

    await browser.storage.sync.set({
      quick_tabs_state_v2: migrated
    });

    console.log('[Background] Migrated old Quick Tab state to container-aware format');
  }
}
```

---

**End of Implementation Guide**
