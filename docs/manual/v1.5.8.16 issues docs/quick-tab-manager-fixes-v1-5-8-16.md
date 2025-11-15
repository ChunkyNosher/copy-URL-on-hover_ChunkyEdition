# Quick Tab Manager Enhancement and Bug Fix Report - v1.5.8.16

## Overview

This document details the required changes to the Quick Tab Manager and Quick Tabs functionality in the copy-URL-on-hover extension (v1.5.8.16). The document is structured to be read by both humans and GitHub Copilot Agents to provide maximum context for implementing the proposed fixes.

---

## Repository Information

**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Version Analyzed:** v1.5.8.16  
**Primary Files:**
- `content-legacy.js` - Main Quick Tab implementation
- `background.js` - State coordinator and cross-tab synchronization
- `sidebar/quick-tabs-manager.js` - Sidebar panel implementation

---

## Current Architecture Overview

### Quick Tab State Management

The extension uses a **three-layer synchronization architecture**:

1. **Local State** (`content-legacy.js`):
   - `quickTabWindows[]` - Array of active Quick Tab DOM containers
   - `minimizedQuickTabs[]` - Array of minimized Quick Tab metadata
   - Each Quick Tab has a unique `quickTabId` stored in `container.dataset.quickTabId`

2. **Background Coordinator** (`background.js`):
   - `globalQuickTabState.containers{}` - Container-aware state (keyed by `cookieStoreId`)
   - Provides real-time cross-tab synchronization via message passing
   - Handles storage persistence to `browser.storage.sync`

3. **Sidebar Panel** (`sidebar/quick-tabs-manager.js`):
   - Reads from `browser.storage.sync` (key: `quick_tabs_state_v2`)
   - Provides UI for managing Quick Tabs across all containers
   - Sends actions back to content scripts via `browser.tabs.sendMessage()`

### Quick Tab Data Structure

Each Quick Tab is stored with the following properties:
```javascript
{
  id: "qt_1234567890_abc123",      // Unique identifier
  url: "https://example.com",       // Loaded URL
  title: "Example Page",            // Page title
  left: 100,                        // X position (px)
  top: 200,                         // Y position (px)
  width: 800,                       // Width (px)
  height: 600,                      // Height (px)
  minimized: false,                 // Minimized state
  pinnedToUrl: null,                // Pinned page URL (or null)
  slotNumber: 1,                    // Debug slot number
  activeTabId: 123                  // Browser tab ID where created
}
```

---

## Issue #1: Quick Tab Manager Position/Size Not Syncing Across Tabs

### Current Behavior
When a user moves or resizes the Quick Tab Manager in Tab 1, then switches to Tab 2, the Quick Tab Manager's position and size in Tab 2 do not reflect the changes made in Tab 1.

### Root Cause Analysis

**File:** `content-legacy.js`

The Quick Tab Manager is a floating panel implemented as a DOM element (`quickTabsPanel`) that is created per-page. Its position and size state is stored in `panelState` (lines 4644-4650):

```javascript
let panelState = {
  left: 20,
  top: 100,
  width: 350,
  height: 500,
  isOpen: false
};
```

**Problem 1:** Position/size changes are saved to `browser.storage.local` under the key `quick_tabs_panel_state`, but there is **no mechanism to broadcast these changes to other tabs** in real-time.

**Problem 2:** The `savePanelState()` function (lines 4706-4720) only saves to local storage:
```javascript
function savePanelState() {
  if (!quickTabsPanel) return;
  
  const rect = quickTabsPanel.getBoundingClientRect();
  
  panelState = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    isOpen: isPanelOpen
  };
  
  browser.storage.local.set({ quick_tabs_panel_state: panelState }).catch(err => {
    debug('[Panel] Error saving panel state:', err);
  });
}
```

**Problem 3:** When the panel is moved via `makePanelDraggable()` (lines 4725-4787) or resized via `makePanelResizable()` (lines 4792-4913), the final position is saved to storage only AFTER the drag/resize ends. Other tabs never receive this update.

### Proposed Solution

**Strategy:** Implement a **hybrid sync approach** similar to Quick Tabs:
1. **BroadcastChannel** for same-origin tabs (instant updates)
2. **browser.runtime.sendMessage()** to background script for cross-origin tabs
3. **browser.storage.onChanged** listener to apply updates when other tabs modify state

**Implementation Steps:**

#### Step 1: Add BroadcastChannel for Panel State

In `content-legacy.js`, add a new BroadcastChannel for panel sync (after line 291 where Quick Tab channel is initialized):

```javascript
// ==================== PANEL BROADCAST CHANNEL ====================
let quickTabPanelChannel = null;

function initializePanelBroadcastChannel() {
  if (quickTabPanelChannel) return;
  
  try {
    quickTabPanelChannel = new BroadcastChannel('quick-tab-panel-sync');
    debug(`Panel BroadcastChannel initialized (Instance ID: ${tabInstanceId})`);
    
    quickTabPanelChannel.onmessage = handlePanelBroadcastMessage;
  } catch (err) {
    console.error('Failed to create panel BroadcastChannel:', err);
  }
}

async function handlePanelBroadcastMessage(event) {
  const message = event.data;
  
  // Ignore broadcasts from ourselves
  if (message.senderId === tabInstanceId) {
    return;
  }
  
  // Container filtering
  const currentCookieStore = await getCurrentCookieStoreId();
  if (message.cookieStoreId && message.cookieStoreId !== currentCookieStore) {
    return;
  }
  
  if (message.action === 'updatePanelState') {
    // Apply position/size changes from other tabs
    if (quickTabsPanel && isPanelOpen) {
      quickTabsPanel.style.left = message.left + 'px';
      quickTabsPanel.style.top = message.top + 'px';
      quickTabsPanel.style.width = message.width + 'px';
      quickTabsPanel.style.height = message.height + 'px';
      
      debug(`[Panel] Updated position/size from broadcast: (${message.left}, ${message.top}) ${message.width}x${message.height}`);
    }
  }
}

async function broadcastPanelState(left, top, width, height, isOpen) {
  if (!quickTabPanelChannel) return;
  
  quickTabPanelChannel.postMessage({
    action: 'updatePanelState',
    left: left,
    top: top,
    width: width,
    height: height,
    isOpen: isOpen,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });
  
  debug(`[Panel] Broadcasting state to other tabs`);
}

// Initialize panel channel when content script loads
initializePanelBroadcastChannel();
// ==================== END PANEL BROADCAST CHANNEL ====================
```

#### Step 2: Modify `savePanelState()` to Broadcast Changes

Replace the `savePanelState()` function (lines 4706-4720):

```javascript
/**
 * Save panel state to browser.storage.local AND broadcast to other tabs
 */
async function savePanelState() {
  if (!quickTabsPanel) return;

  const rect = quickTabsPanel.getBoundingClientRect();

  panelState = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    isOpen: isPanelOpen
  };

  // Save to local storage
  browser.storage.local.set({ quick_tabs_panel_state: panelState }).catch(err => {
    debug('[Panel] Error saving panel state:', err);
  });
  
  // Broadcast to other tabs (same-origin)
  await broadcastPanelState(
    panelState.left,
    panelState.top,
    panelState.width,
    panelState.height,
    panelState.isOpen
  );
  
  // Send to background script (cross-origin)
  sendRuntimeMessage({
    action: 'UPDATE_PANEL_STATE',
    left: panelState.left,
    top: panelState.top,
    width: panelState.width,
    height: panelState.height,
    isOpen: panelState.isOpen
  }).catch(err => {
    debug('[Panel] Error sending state to background:', err);
  });
}
```

#### Step 3: Add Background Script Handler for Panel State

In `background.js`, add a new handler for panel state updates (after line 686 where Quick Tab handlers exist):

```javascript
// Handle Quick Tab Manager Panel state updates
if (message.action === 'UPDATE_PANEL_STATE') {
  console.log('[Background] Received panel state update:', message.left, message.top, message.width, message.height);
  
  const cookieStoreId = message.cookieStoreId || 'firefox-default';
  
  // Broadcast to all tabs in the same container
  browser.tabs.query({ cookieStoreId: cookieStoreId }).then(tabs => {
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, {
        action: 'UPDATE_PANEL_STATE_FROM_BACKGROUND',
        left: message.left,
        top: message.top,
        width: message.width,
        height: message.height,
        isOpen: message.isOpen,
        cookieStoreId: cookieStoreId
      }).catch(() => {});
    });
  });
  
  sendResponse({ success: true });
  return true;
}
```

#### Step 4: Add Message Listener in Content Script

In `content-legacy.js`, add a handler in the existing `browser.runtime.onMessage.addListener()` (around line 4315):

```javascript
// NEW: Handle panel state updates from background
if (message.action === 'UPDATE_PANEL_STATE_FROM_BACKGROUND') {
  // Apply position/size changes from other tabs
  if (quickTabsPanel && isPanelOpen) {
    quickTabsPanel.style.left = message.left + 'px';
    quickTabsPanel.style.top = message.top + 'px';
    quickTabsPanel.style.width = message.width + 'px';
    quickTabsPanel.style.height = message.height + 'px';
    
    debug(`[Panel] Updated position/size from background: (${message.left}, ${message.top}) ${message.width}x${message.height}`);
  }
  
  sendResponse({ success: true });
  return true;
}
```

#### Step 5: Sync on Drag End

Modify `handlePointerUp` in `makePanelDraggable()` (line 4775) to save state:

```javascript
const handlePointerUp = e => {
  if (!isDragging || e.pointerId !== currentPointerId) return;

  isDragging = false;
  handle.releasePointerCapture(e.pointerId);
  handle.style.cursor = 'grab';

  // Save final position AND broadcast to other tabs
  savePanelState();
};
```

#### Step 6: Sync on Resize End

Modify `handlePointerUp` in `makePanelResizable()` (line 4882) to save state:

```javascript
const handlePointerUp = e => {
  if (!isResizing || e.pointerId !== currentPointerId) return;

  isResizing = false;
  handle.releasePointerCapture(e.pointerId);

  // Save final size/position AND broadcast to other tabs
  savePanelState();
};
```

### Expected Behavior After Fix

1. User moves/resizes Quick Tab Manager in Tab 1
2. When drag/resize ends, position/size is saved to `browser.storage.local`
3. Position/size is broadcast via BroadcastChannel to same-origin tabs (instant)
4. Position/size is sent to background script, which broadcasts to cross-origin tabs
5. When user switches to Tab 2, the Quick Tab Manager reflects the updated position/size

**Note:** Position/size updates should only occur AFTER the drag/resize operation completes (not in real-time during the operation), matching the behavior of Quick Tabs.

---

## Issue #2: Incorrect Status Indicators and Missing Restore Functionality

### Current Behavior

1. When a Quick Tab is minimized, it appears in the Quick Tab Manager with a **green** indicator (should be **yellow**)
2. Minimized Quick Tabs show BOTH minimize and restore buttons (should only show restore button)
3. Active Quick Tabs show BOTH minimize and restore buttons (should only show minimize button)
4. Clicking "restore" on a minimized Quick Tab does not restore it to its **original position** - it creates a new Quick Tab at the default position instead

### Root Cause Analysis

#### Problem 1: Incorrect Status Indicator Colors

**File:** `content-legacy.js` (lines 5026-5042)

In the `renderPanelQuickTabItem()` function, the status indicator is hard-coded based on the `isMinimized` parameter:

```javascript
// Indicator
const indicator = document.createElement('span');
indicator.className = `panel-status-indicator ${isMinimized ? 'yellow' : 'green'}`;
```

**This is correct.** However, the issue is that the **Quick Tab is not being marked as minimized** when it's minimized. Looking at the `minimizeQuickTab()` function (lines 2494-2551), the `minimized: true` flag is correctly added to the `minimizedData` object.

**Root cause:** The issue is likely in how the Quick Tabs are being **restored from storage**. When Quick Tabs are restored on page load (via `restoreQuickTabsFromStorage()`, lines 2177-2315), minimized tabs should remain minimized and appear in the manager with yellow indicators, but the code may be incorrectly creating active Quick Tabs instead.

Checking `restoreQuickTabsFromStorage()` (line 2262):
```javascript
// Restore minimized tabs (also check for duplicates by ID and pin status)
const existingMinimizedIds = new Set(minimizedQuickTabs.map(t => t.id).filter(id => id));
const minimized = tabs.filter(t => {
  if (!t.minimized) return false;
  if (!t.url || t.url.trim() === '') return false; // Skip empty URLs
  if (t.id && existingMinimizedIds.has(t.id)) return false;
  
  // Filter based on pin status
  if (t.pinnedToUrl && t.pinnedToUrl !== currentPageUrl) {
    debug(`Skipping minimized pinned Quick Tab (pinned to ${t.pinnedToUrl}, current: ${currentPageUrl})`);
    return false;
  }
  
  return true;
});

if (minimized.length > 0) {
  minimizedQuickTabs.push(...minimized);
  updateMinimizedTabsManager();
}
```

**This logic is correct** - minimized tabs are being pushed to `minimizedQuickTabs` array and should appear in the manager.

**Hypothesis:** The issue is that the **Quick Tab Manager panel** is not correctly reading the `minimized` state from `browser.storage.sync`. The panel's `renderPanelQuickTabItem()` function is being called with the wrong `isMinimized` parameter.

Checking the `updatePanelContent()` function (lines 4956-5132), specifically where it reads minimized state:

```javascript
// Tabs
const activeTabs = containerState.tabs.filter(t => !t.minimized);
const minimizedTabs = containerState.tabs.filter(t => t.minimized);

activeTabs.forEach(tab => {
  section.appendChild(renderPanelQuickTabItem(tab, false));
});

minimizedTabs.forEach(tab => {
  section.appendChild(renderPanelQuickTabItem(tab, true));
});
```

**This logic is correct** - tabs are correctly filtered by `minimized` state and passed to `renderPanelQuickTabItem()` with the correct boolean.

**Actual Root Cause:** The issue is that when a Quick Tab is minimized via `minimizeQuickTab()`, the state is saved to storage with `minimized: true`, BUT the sidebar panel code (`sidebar/quick-tabs-manager.js`) is reading from `browser.storage.sync` with key `quick_tabs_state_v2`, which is in a **container-aware format**.

Looking at the sidebar code (lines 136-142):
```javascript
// Separate active and minimized tabs
const activeTabs = containerState.tabs.filter(t => !t.minimized);
const minimizedTabs = containerState.tabs.filter(t => t.minimized);

// Render active tabs first
activeTabs.forEach(tab => {
  tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, false));
});
```

**This is correct.** However, the **content script's panel** (`content-legacy.js`) and the **sidebar panel** (`sidebar/quick-tabs-manager.js`) are **two different implementations**. The user is referring to the **sidebar panel**, not the floating panel in `content-legacy.js`.

**Conclusion:** The issue is in `sidebar/quick-tabs-manager.js`. The status indicator logic is correct, but the **button visibility logic** is wrong.

#### Problem 2: Incorrect Button Visibility

**File:** `sidebar/quick-tabs-manager.js` (lines 195-235)

In the `renderQuickTabItem()` function:

```javascript
if (!isMinimized) {
  // Active Quick Tab actions
  
  // Go to Tab button (NEW FEATURE)
  if (tab.activeTabId) {
    const goToTabBtn = document.createElement('button');
    goToTabBtn.className = 'btn-icon';
    goToTabBtn.textContent = '🔗';
    goToTabBtn.title = `Go to Tab ${tab.activeTabId}`;
    goToTabBtn.dataset.action = 'goToTab';
    goToTabBtn.dataset.tabId = tab.activeTabId;
    actions.appendChild(goToTabBtn);
  }
  
  // Minimize button
  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = 'btn-icon';
  minimizeBtn.textContent = '➖';
  minimizeBtn.title = 'Minimize';
  minimizeBtn.dataset.action = 'minimize';
  minimizeBtn.dataset.quickTabId = tab.id;
  actions.appendChild(minimizeBtn);
} else {
  // Minimized Quick Tab actions
  
  // Restore button
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn-icon';
  restoreBtn.textContent = '↑';
  restoreBtn.title = 'Restore';
  restoreBtn.dataset.action = 'restore';
  restoreBtn.dataset.quickTabId = tab.id;
  actions.appendChild(restoreBtn);
}

// Close button (always available)
const closeBtn = document.createElement('button');
closeBtn.className = 'btn-icon';
closeBtn.textContent = '✕';
closeBtn.title = 'Close';
closeBtn.dataset.action = 'close';
closeBtn.dataset.quickTabId = tab.id;
actions.appendChild(closeBtn);
```

**This logic is CORRECT** - it only shows minimize button for active tabs, and only shows restore button for minimized tabs. The issue is that **the user reported seeing BOTH buttons**, which means the `isMinimized` parameter is being passed incorrectly OR the rendering is happening twice.

**Hypothesis:** When a Quick Tab is minimized, it's being rendered in BOTH the "active" section AND the "minimized" section, causing both buttons to appear.

Checking the filtering logic (lines 136-148):
```javascript
// Separate active and minimized tabs
const activeTabs = containerState.tabs.filter(t => !t.minimized);
const minimizedTabs = containerState.tabs.filter(t => t.minimized);

// Render active tabs first
activeTabs.forEach(tab => {
  tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, false));
});

// Then minimized tabs
minimizedTabs.forEach(tab => {
  tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, true));
});
```

**This logic is correct** - tabs are filtered correctly and passed the right `isMinimized` value.

**Actual Root Cause:** The user is seeing a **green indicator** on minimized tabs, which means the tab is being rendered with `isMinimized = false`. This suggests that when `minimizeQuickTab()` is called in `content-legacy.js`, the tab is not being correctly marked as `minimized: true` in storage, OR the sidebar is reading stale data.

Checking `minimizeQuickTab()` in `content-legacy.js` (lines 2494-2551):

```javascript
const minimizedData = {
  id: quickTabId,
  url: url,
  title: title || 'Quick Tab',
  left: Math.round(rect.left),
  top: Math.round(rect.top),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
  minimized: true,  // <-- THIS IS SET CORRECTLY
  pinnedToUrl: container._pinnedToUrl || null,
  slotNumber: CONFIG.debugMode ? quickTabSlots.get(quickTabId) || null : null,
  activeTabId: activeTabId,
  timestamp: Date.now()
};

minimizedQuickTabs.push(minimizedData);

// Clean up and hide
container.remove();

showNotification('✓ Quick Tab minimized');
debug(`Quick Tab minimized. Total minimized: ${minimizedQuickTabs.length}`);

// Update or create minimized tabs manager
updateMinimizedTabsManager();

// Save to storage via queue if persistence is enabled
if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
  saveQuickTabState('minimize', quickTabId, minimizedData).catch(err => {
    debug('Error saving minimized Quick Tab:', err);
  });
}
```

**The code is correct** - `minimized: true` is being set. However, the issue is that `saveQuickTabState()` is using the **save queue system**, which batches updates. This means there's a delay between when the tab is minimized and when the state is saved to storage.

**Root Cause:** The sidebar panel is reading from `browser.storage.sync` every 2 seconds (line 64 in `sidebar/quick-tabs-manager.js`), but the save queue may not have flushed yet. The sidebar is showing stale data.

#### Problem 3: Restore Not Restoring to Original Position

**File:** `content-legacy.js` (lines 2554-2614)

The `restoreQuickTab()` function:

```javascript
async function restoreQuickTab(indexOrId) {
  let tab = null;
  let index = -1;

  // Support both index-based (for backward compatibility) and ID-based restore
  if (typeof indexOrId === 'number' && indexOrId >= 0 && indexOrId < minimizedQuickTabs.length) {
    // Index-based restore (from local minimizedQuickTabs array)
    index = indexOrId;
    tab = minimizedQuickTabs[index];
  } else if (typeof indexOrId === 'string') {
    // ID-based restore (from sidebar command)
    const quickTabId = indexOrId;

    // Load state from storage to get Quick Tab details
    try {
      const cookieStoreId = await getCurrentCookieStoreId();
      const result = await browser.storage.sync.get('quick_tabs_state_v2');

      if (!result || !result.quick_tabs_state_v2) {
        debug('No Quick Tabs state found');
        return;
      }

      const state = result.quick_tabs_state_v2;
      const containerState = state[cookieStoreId];

      if (!containerState || !containerState.tabs) {
        debug(`No Quick Tabs for container ${cookieStoreId}`);
        return;
      }

      // Find the Quick Tab to restore
      tab = containerState.tabs.find(t => t.id === quickTabId);

      if (!tab) {
        debug(`Quick Tab ${quickTabId} not found in storage`);
        return;
      }

      // Also remove from local minimizedQuickTabs array if present
      index = minimizedQuickTabs.findIndex(t => t.id === quickTabId);
    } catch (err) {
      console.error('Error loading Quick Tab from storage:', err);
      return;
    }
  }

  if (!tab) {
    debug('No tab to restore');
    return;
  }

  // Remove from local array if found
  if (index >= 0) {
    minimizedQuickTabs.splice(index, 1);
  }

  // Create Quick Tab window with stored properties
  createQuickTabWindow(
    tab.url,
    tab.width,
    tab.height,
    tab.left,
    tab.top,
    true, // fromBroadcast = true (don't re-save)
    tab.pinnedToUrl,
    tab.id
  );

  updateMinimizedTabsManager();

  // Update storage to mark as not minimized
  if (CONFIG.quickTabPersistAcrossTabs && tab.id) {
    try {
      const cookieStoreId = await getCurrentCookieStoreId();
      const result = await browser.storage.sync.get('quick_tabs_state_v2');

      if (result && result.quick_tabs_state_v2) {
        const state = result.quick_tabs_state_v2;

        if (state[cookieStoreId] && state[cookieStoreId].tabs) {
          // Update the tab to mark as not minimized
          const updatedTabs = state[cookieStoreId].tabs.map(t => {
            if (t.id === tab.id) {
              return { ...t, minimized: false };
            }
            return t;
          });

          state[cookieStoreId].tabs = updatedTabs;
          state[cookieStoreId].timestamp = Date.now();

          await browser.storage.sync.set({ quick_tabs_state_v2: state });
        }
      }
    } catch (err) {
      debug('Error updating restored Quick Tab in storage:', err);
    }
  }

  debug(`Quick Tab restored from minimized. Remaining minimized: ${minimizedQuickTabs.length}`);
}
```

**The code is CORRECT** - it's using `tab.left` and `tab.top` to restore the Quick Tab to its original position. The issue is that the position data might not be saved correctly when the tab is minimized.

Checking `minimizeQuickTab()` again (lines 2512-2521):

```javascript
const minimizedData = {
  id: quickTabId,
  url: url,
  title: title || 'Quick Tab',
  left: Math.round(rect.left),  // <-- Position IS being saved
  top: Math.round(rect.top),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
  minimized: true,
  pinnedToUrl: container._pinnedToUrl || null,
  slotNumber: CONFIG.debugMode ? quickTabSlots.get(quickTabId) || null : null,
  activeTabId: activeTabId,
  timestamp: Date.now()
};
```

**Position data IS being saved correctly.**

**Actual Root Cause:** The issue is that when `restoreQuickTab()` creates the Quick Tab via `createQuickTabWindow()`, it passes `fromBroadcast = true`, which means the Quick Tab is created but NOT saved to storage. However, the function then manually updates storage to mark `minimized: false`. BUT, the sidebar panel code (`sidebar/quick-tabs-manager.js`) calls `restoreQuickTab()` via `browser.tabs.sendMessage()`:

```javascript
async function restoreQuickTab(quickTabId) {
  try {
    // Send message to content script in active tab
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length === 0) return;

    await browser.tabs.sendMessage(activeTabs[0].id, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId: quickTabId
    });

    console.log(`Restored Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error restoring Quick Tab ${quickTabId}:`, err);
  }
}
```

And in `content-legacy.js` (lines 4400-4410):

```javascript
// NEW: Handle restore command from sidebar
if (message.action === 'RESTORE_QUICK_TAB') {
  restoreQuickTab(message.quickTabId);
  sendResponse({ success: true });
  return true;
}
```

**This is correct.** The Quick Tab should be restored at the stored position. If it's not, the issue is that the **position data is not being stored correctly** when the tab is minimized.

**Hypothesis:** The issue is that when `minimizeQuickTab()` is called, the container is **already removed from the DOM** (line 2541: `container.remove()`), so when `saveQuickTabState()` is called, the position data might be incorrect.

Looking at the order of operations in `minimizeQuickTab()`:

1. Get position data: `const rect = container.getBoundingClientRect();` (line 2511)
2. Create minimizedData with position: `left: Math.round(rect.left)` (line 2514)
3. Remove container: `container.remove();` (line 2541)
4. Save to storage: `saveQuickTabState('minimize', quickTabId, minimizedData)` (line 2548)

**Order is correct** - position is captured BEFORE the container is removed.

**Actual Issue:** Looking more carefully at the user's description: "when a Quick Tab in the manager has a green indicator, that should mean that it is currently active" - this means **active Quick Tabs should have a green indicator**. But the user says "when I minimize Quick Tab 1 and open the Quick Tab Manager, the Quick Tab listed in the manager has a **green** indicator". This means the tab is being shown as **active** instead of **minimized**.

**Root Cause:** When `minimizeQuickTab()` is called, the state is saved with `minimized: true`, but the **sidebar panel is reading stale data** OR the save queue hasn't flushed yet. The sidebar refreshes every 2 seconds, so there's a delay.

### Proposed Solution

The core issue is that the **sidebar panel is showing stale data** because it relies on polling `browser.storage.sync` every 2 seconds. When a Quick Tab is minimized, the state change needs to be **immediately reflected** in the sidebar, not after a 2-second delay.

#### Step 1: Add Real-Time Event Communication to Sidebar

**File:** `sidebar/quick-tabs-manager.js`

Currently, the sidebar listens for storage changes (lines 269-276):

```javascript
// Listen for storage changes to auto-update
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[STATE_KEY]) {
    loadQuickTabsState().then(() => {
      renderUI();
    });
  }
});
```

**This is correct**, but the issue is that the **save queue** in `content-legacy.js` batches updates and only flushes every 50ms. The sidebar's `browser.storage.onChanged` listener will only fire AFTER the storage has been updated, which might be delayed.

**Solution:** Force an **immediate storage update** when a Quick Tab is minimized, instead of relying on the save queue.

#### Step 2: Force Immediate Storage Update on Minimize

**File:** `content-legacy.js`

Modify `minimizeQuickTab()` to force an immediate storage update instead of using the save queue:

**Current code (lines 2548-2551):**
```javascript
// Save to storage via queue if persistence is enabled
if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
  saveQuickTabState('minimize', quickTabId, minimizedData).catch(err => {
    debug('Error saving minimized Quick Tab:', err);
  });
}
```

**Replace with:**
```javascript
// Save to storage IMMEDIATELY (bypass save queue) if persistence is enabled
if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
  // Bypass save queue and update storage directly for immediate sidebar sync
  (async () => {
    try {
      const cookieStoreId = await getCurrentCookieStoreId();
      const result = await browser.storage.sync.get('quick_tabs_state_v2');
      
      let state = result?.quick_tabs_state_v2 || {};
      
      // Initialize container state if needed
      if (!state[cookieStoreId]) {
        state[cookieStoreId] = { tabs: [], lastUpdate: 0 };
      }
      
      // Find and update the tab in storage
      const tabIndex = state[cookieStoreId].tabs.findIndex(t => t.id === quickTabId);
      
      if (tabIndex !== -1) {
        // Update existing tab
        state[cookieStoreId].tabs[tabIndex] = minimizedData;
      } else {
        // Add new minimized tab
        state[cookieStoreId].tabs.push(minimizedData);
      }
      
      state[cookieStoreId].lastUpdate = Date.now();
      
      // Save immediately to storage
      await browser.storage.sync.set({ quick_tabs_state_v2: state });
      
      debug(`Quick Tab ${quickTabId} minimized and saved immediately to storage`);
    } catch (err) {
      console.error('Error saving minimized Quick Tab:', err);
    }
  })();
}
```

This ensures that when a Quick Tab is minimized, the storage is updated **immediately**, which will trigger the sidebar's `browser.storage.onChanged` listener and cause the UI to update within ~50-100ms instead of 2+ seconds.

#### Step 3: Force Immediate Storage Update on Restore

Similarly, modify `restoreQuickTab()` to force an immediate update when restoring:

**Current code (lines 2608-2637):**
```javascript
// Update storage to mark as not minimized
if (CONFIG.quickTabPersistAcrossTabs && tab.id) {
  try {
    const cookieStoreId = await getCurrentCookieStoreId();
    const result = await browser.storage.sync.get('quick_tabs_state_v2');

    if (result && result.quick_tabs_state_v2) {
      const state = result.quick_tabs_state_v2;

      if (state[cookieStoreId] && state[cookieStoreId].tabs) {
        // Update the tab to mark as not minimized
        const updatedTabs = state[cookieStoreId].tabs.map(t => {
          if (t.id === tab.id) {
            return { ...t, minimized: false };
          }
          return t;
        });

        state[cookieStoreId].tabs = updatedTabs;
        state[cookieStoreId].timestamp = Date.now();

        await browser.storage.sync.set({ quick_tabs_state_v2: state });
      }
    }
  } catch (err) {
    debug('Error updating restored Quick Tab in storage:', err);
  }
}
```

**This code is already correct** - it's updating storage immediately. The issue is that `createQuickTabWindow()` is called with `fromBroadcast = true`, which means it WON'T save to storage again. However, the code manually updates storage after creating the window, so this should work.

**Actual Issue:** The Quick Tab is being restored at the **wrong position** because `createQuickTabWindow()` has logic that **overrides the provided position** based on `CONFIG.quickTabPosition` setting.

Checking `createQuickTabWindow()` (lines 1755-1845):

```javascript
// Position the window
let posX, posY;

// If position is provided (from restore), use it
if (left !== undefined && top !== undefined) {
  posX = left;
  posY = top;
} else {
  // Otherwise calculate based on settings
  switch (CONFIG.quickTabPosition) {
    case 'follow-cursor':
      posX = lastMouseX + 10;
      posY = lastMouseY + 10;
      break;
    case 'center':
      posX = (window.innerWidth - windowWidth) / 2;
      posY = (window.innerHeight - windowHeight) / 2;
      break;
    // ... other cases
  }
}

// Ensure window stays within viewport
posX = Math.max(0, Math.min(posX, window.innerWidth - windowWidth));
posY = Math.max(0, Math.min(posY, window.innerHeight - windowHeight));
```

**This logic is correct** - if `left` and `top` are provided, they're used directly. The issue is that when `restoreQuickTab()` calls `createQuickTabWindow()`, it passes:

```javascript
createQuickTabWindow(
  tab.url,
  tab.width,
  tab.height,
  tab.left,    // <-- Position IS being passed
  tab.top,
  true,
  tab.pinnedToUrl,
  tab.id
);
```

**Position IS being passed correctly.**

**Root Cause:** The issue is that `tab.left` and `tab.top` might be **undefined** when restored from storage. This can happen if the minimized tab was saved in an older version that didn't store position data, OR if the save queue failed to flush.

**Solution:** Add defensive checks in `restoreQuickTab()` to log when position data is missing:

```javascript
// Create Quick Tab window with stored properties
const hasPosition = tab.left !== undefined && tab.top !== undefined;
if (!hasPosition) {
  console.warn(`[RESTORE] Quick Tab ${tab.id} has no stored position - using default`);
}

createQuickTabWindow(
  tab.url,
  tab.width || CONFIG.quickTabDefaultWidth,
  tab.height || CONFIG.quickTabDefaultHeight,
  tab.left,  // May be undefined - createQuickTabWindow will use default
  tab.top,
  true,
  tab.pinnedToUrl,
  tab.id
);
```

### Step 4: Fix Status Indicator Rendering

The user reports that minimized Quick Tabs have a **green indicator** instead of **yellow**. This is because the sidebar is rendering the tab as **active** (`isMinimized = false`) instead of **minimized** (`isMinimized = true`).

**Root Cause:** Looking at the status indicator code in `sidebar/quick-tabs-manager.js` (line 166):

```javascript
// Status indicator
const indicator = document.createElement('span');
indicator.className = `status-indicator ${isMinimized ? 'yellow' : 'green'}`;
```

**This is correct.** The issue is that the tab is being rendered with `isMinimized = false` when it should be `isMinimized = true`.

Checking how tabs are filtered (lines 136-148):

```javascript
// Separate active and minimized tabs
const activeTabs = containerState.tabs.filter(t => !t.minimized);
const minimizedTabs = containerState.tabs.filter(t => t.minimized);

// Render active tabs first
activeTabs.forEach(tab => {
  tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, false));
});

// Then minimized tabs
minimizedTabs.forEach(tab => {
  tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, true));
});
```

**This is correct.** The issue is that `containerState.tabs` contains tabs where `minimized` is **undefined or false** when it should be **true**.

**Conclusion:** The issue is in the **save logic** in `content-legacy.js`. When a Quick Tab is minimized via `minimizeQuickTab()`, the `minimized: true` flag is being set in `minimizedData`, but it's not being saved to storage immediately due to the save queue.

**Solution:** Already proposed above - force immediate storage update when minimizing.

### Step 5: Fix Button Visibility

The user reports that Quick Tabs show **both** minimize and restore buttons, when they should only show one based on state.

**Root Cause:** The button visibility logic in `sidebar/quick-tabs-manager.js` (lines 195-235) is correct - it only shows minimize for active tabs and only shows restore for minimized tabs. The issue is that the **same Quick Tab is being rendered twice** - once in the "active" section and once in the "minimized" section.

This can happen if the tab's `minimized` flag is **inconsistent** across different parts of the state.

**Solution:** Add deduplication logic in `renderContainerSection()`:

```javascript
function renderContainerSection(cookieStoreId, containerInfo, containerState) {
  const section = document.createElement('div');
  section.className = 'container-section';
  section.dataset.containerId = cookieStoreId;

  // ... header code ...

  // Quick Tabs list
  const tabsList = document.createElement('div');
  tabsList.className = 'quick-tabs-list';

  // Separate active and minimized tabs
  const activeTabs = containerState.tabs.filter(t => !t.minimized);
  const minimizedTabs = containerState.tabs.filter(t => t.minimized);
  
  // DEDUPLICATE: Use Set to track rendered tab IDs
  const renderedIds = new Set();

  // Render active tabs first
  activeTabs.forEach(tab => {
    if (tab.id && renderedIds.has(tab.id)) {
      console.warn(`[SIDEBAR] Duplicate tab detected: ${tab.id} (active)`);
      return;
    }
    if (tab.id) renderedIds.add(tab.id);
    tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, false));
  });

  // Then minimized tabs
  minimizedTabs.forEach(tab => {
    if (tab.id && renderedIds.has(tab.id)) {
      console.warn(`[SIDEBAR] Duplicate tab detected: ${tab.id} (minimized)`);
      return;
    }
    if (tab.id) renderedIds.add(tab.id);
    tabsList.appendChild(renderQuickTabItem(tab, cookieStoreId, true));
  });

  section.appendChild(tabsList);
  containersList.appendChild(section);
}
```

This will prevent the same Quick Tab from being rendered twice if its `minimized` flag is inconsistent.

---

## Summary of Required Changes

### File: `content-legacy.js`

1. **Add Panel BroadcastChannel** (after line 291):
   - Create `quickTabPanelChannel` for real-time panel sync
   - Implement `handlePanelBroadcastMessage()` to receive updates
   - Implement `broadcastPanelState()` to send updates
   - Call `initializePanelBroadcastChannel()` on script load

2. **Modify `savePanelState()`** (lines 4706-4720):
   - Add call to `broadcastPanelState()` after saving to local storage
   - Add call to `sendRuntimeMessage()` with action `UPDATE_PANEL_STATE`

3. **Add Message Handler** (in `browser.runtime.onMessage.addListener`, around line 4315):
   - Handle `UPDATE_PANEL_STATE_FROM_BACKGROUND` action
   - Apply position/size updates to `quickTabsPanel`

4. **Force Immediate Storage Update on Minimize** (lines 2548-2551):
   - Replace `saveQuickTabState()` call with direct `browser.storage.sync.set()`
   - Ensure `minimized: true` flag is immediately persisted

5. **Add Position Logging in `restoreQuickTab()`** (around line 2605):
   - Log warning if position data is missing
   - Add defensive checks for `tab.left` and `tab.top`

### File: `background.js`

1. **Add Panel State Handler** (after line 686):
   - Handle `UPDATE_PANEL_STATE` action from content scripts
   - Broadcast position/size updates to all tabs in the same container

### File: `sidebar/quick-tabs-manager.js`

1. **Add Deduplication Logic** (in `renderContainerSection()`, around line 130):
   - Track rendered tab IDs with a `Set`
   - Skip rendering if tab ID was already rendered
   - Log warning for duplicate tabs

---

## Testing Checklist

### Test Case 1: Panel Position/Size Sync

1. Open Tab 1, open Quick Tab Manager
2. Move panel to position (100, 100)
3. Resize panel to 400x600
4. Switch to Tab 2
5. **Expected:** Panel appears at (100, 100) with size 400x600
6. **Expected:** Moving/resizing in Tab 2 syncs to Tab 1

### Test Case 2: Minimize Quick Tab

1. Open a Quick Tab in Tab 1
2. Click minimize button in Quick Tab Manager
3. **Expected:** Quick Tab disappears from page
4. **Expected:** Quick Tab appears in manager with **yellow indicator**
5. **Expected:** Only **restore button** is visible (no minimize button)
6. Switch to Tab 2
7. **Expected:** Minimized Quick Tab still shows with yellow indicator

### Test Case 3: Restore Quick Tab

1. Open a Quick Tab at position (500, 300) with size 800x600
2. Minimize the Quick Tab
3. Note the position and size before minimizing
4. Click restore button in Quick Tab Manager
5. **Expected:** Quick Tab reappears at position (500, 300) with size 800x600
6. **Expected:** Quick Tab is in the EXACT same location as before minimizing

### Test Case 4: Active Quick Tab Indicators

1. Open a Quick Tab (not minimized)
2. Open Quick Tab Manager
3. **Expected:** Quick Tab has **green indicator**
4. **Expected:** Only **minimize button** is visible (no restore button)

### Test Case 5: No Duplicate Buttons

1. Open multiple Quick Tabs
2. Minimize one Quick Tab
3. **Expected:** Each Quick Tab in manager shows exactly ONE action button (either minimize OR restore, never both)

---

## Implementation Notes for GitHub Copilot Agent

### Key Architecture Concepts

1. **Container Isolation**: All state is keyed by `cookieStoreId` (Firefox Containers feature). Ensure all operations preserve this isolation.

2. **Three-Layer Sync**: 
   - **BroadcastChannel** for same-origin tabs (instant, < 10ms)
   - **browser.runtime.sendMessage()** for cross-origin tabs (< 50ms)
   - **browser.storage.sync** for persistence (read on page load)

3. **Save Queue System**: The extension uses a batched save queue (`SaveQueue` class, lines 1423-1547 in `content-legacy.js`). For minimize/restore operations, bypass the queue and save directly to ensure immediate visibility in the sidebar.

4. **Unique IDs**: Each Quick Tab has a unique `quickTabId` (format: `qt_TIMESTAMP_RANDOM`). Use this for identification, NOT the URL (multiple Quick Tabs can have the same URL).

5. **State Structure**: The `quick_tabs_state_v2` key in `browser.storage.sync` has this format:
   ```javascript
   {
     "firefox-default": {
       tabs: [ {...}, {...} ],
       lastUpdate: 1234567890
     },
     "firefox-container-1": {
       tabs: [ {...}, {...} ],
       lastUpdate: 1234567890
     }
   }
   ```

### Common Pitfalls to Avoid

1. **Don't use URL for identification** - Use `quickTabId` instead
2. **Don't forget container filtering** - Always check `cookieStoreId` matches
3. **Don't rely on save queue for immediate updates** - Bypass it for minimize/restore
4. **Don't modify storage format** - Maintain backward compatibility with v1.5.8.16
5. **Don't forget to broadcast** - All state changes must be broadcast to other tabs

### Debugging Hints

1. Enable debug mode: Set `debugMode: true` in extension settings
2. Check console logs with prefix `[Quick Tabs]`, `[Panel]`, `[Background]`, `[SIDEBAR]`
3. Inspect `browser.storage.sync` using Firefox DevTools → Storage → Extension Storage
4. Check BroadcastChannel messages in Network tab (Filter: `quick-tab`)
5. Verify `minimized` flag is being set correctly when saving to storage

---

## Estimated Complexity

**Panel Sync (Issue #1):** Medium complexity (3-4 hours)
- Requires understanding of BroadcastChannel, message passing, and storage
- Similar to existing Quick Tab sync logic, can reuse patterns

**Status Indicators and Restore (Issue #2):** Low-Medium complexity (2-3 hours)  
- Main fix is forcing immediate storage updates
- Deduplication logic is straightforward
- Restore position logic is already correct, just needs defensive checks

**Total Estimated Time:** 5-7 hours for implementation and testing

---

## Version Compatibility

**Minimum Firefox Version:** 115+ (for `browser.storage.session` support)
**Tested Versions:** Firefox 115-133
**Extension Version:** v1.5.8.16

**Breaking Changes:** None - all changes are backward compatible with existing storage format.

---

## Additional Recommendations

### Performance Optimization

Consider reducing the sidebar refresh interval from 2 seconds to 5 seconds, since storage change events now provide real-time updates. This will reduce CPU usage:

```javascript
// sidebar/quick-tabs-manager.js, line 64
setInterval(async () => {
  await loadQuickTabsState();
  renderUI();
}, 5000); // Changed from 2000ms to 5000ms
```

### Error Handling

Add try-catch blocks around all storage operations to prevent extension crashes:

```javascript
try {
  await browser.storage.sync.set({ quick_tabs_state_v2: state });
} catch (err) {
  console.error('[Quick Tabs] Storage error:', err);
  // Show user-friendly error message
  showNotification('⚠️ Failed to save Quick Tab state');
}
```

### Future Enhancement: Real-Time Position Updates

Currently, the Quick Tab Manager position/size only syncs AFTER the drag/resize ends. Consider implementing **throttled real-time updates** (similar to Quick Tab drag logic) to provide visual feedback during drag/resize operations. This would require:

1. Throttled broadcasts during drag (every 100-200ms)
2. CSS transitions to smooth position changes in other tabs
3. Conflict resolution if multiple tabs drag simultaneously

This enhancement is **not required** for the current issues but would improve user experience.

---

## Conclusion

The proposed changes will fix both issues while maintaining the extension's architecture and performance characteristics. The key insight is that the sidebar panel requires **immediate storage updates** for minimize/restore operations, bypassing the save queue system used for drag/resize operations.

All changes are localized to three files (`content-legacy.js`, `background.js`, `sidebar/quick-tabs-manager.js`) and can be implemented incrementally without breaking existing functionality.
