# Solo and Mute Quick Tabs Feature Implementation Guide

## Executive Summary

This document outlines the architectural changes and implementation requirements for replacing the current "Pin to Page" functionality with new **"Solo"** and **"Mute"** features for Quick Tabs in the copy-URL-on-hover extension (v1.5.9.12+).

**Key Changes:**

- Replace `pinnedToUrl` state with two new properties: `soloedOnTabs` and `mutedOnTabs`
- Implement tab-specific visibility control rather than page-URL-based filtering
- Add visual indicators and controls in both Quick Tab toolbar and Quick Tab Manager panel
- Maintain all existing features (cross-tab sync, container isolation, position/size persistence)
- Refactor state synchronization to handle tab-specific visibility rules

---

## Current Architecture Context (v1.5.9.12)

### Existing Pin Functionality

**Current Behavior:**

- Each Quick Tab has a `pinnedToUrl` property (stores page URL or `null`)
- When pinned, Quick Tab only appears on the specific page URL it was pinned to
- Unpinned Quick Tabs appear on all tabs/pages
- Pin state syncs across browser tabs via BroadcastChannel and browser.storage

**Current Implementation Points:**

1. **QuickTabWindow class** (`src/features/quick-tabs/window.js`):
   - `pinnedToUrl` property in state
   - Pin button (📍/📌) in titlebar
   - `togglePin()` method
   - `onPin()` and `onUnpin()` callbacks

2. **QuickTabsManager class** (`src/features/quick-tabs/index.js`):
   - `handlePin()` and `handleUnpin()` methods
   - Pin state broadcasts via BroadcastChannel
   - `UPDATE_QUICK_TAB_PIN` message to background script
   - Pin state stored in `containers[cookieStoreId].tabs[].pinnedToUrl`

3. **Background script** (`background.js`):
   - Handles `UPDATE_QUICK_TAB_PIN` messages
   - Persists pin state to browser.storage.sync
   - Broadcasts pin changes to all tabs

4. **Panel Manager** (`src/features/quick-tabs/panel.js`):
   - Displays pin status in Quick Tab list (no specific indicator currently)

---

## Proposed Solo and Mute Functionality

### Solo Feature

**Definition:** "Soloing" a Quick Tab on Tab X makes it **ONLY visible on Tab X** and hidden on all other browser tabs.

**User Workflow:**

1. User opens Quick Tab on Tab 1
2. User clicks Solo button (🎯) in Quick Tab toolbar
3. Quick Tab becomes "soloed" on Tab 1 only
4. Quick Tab disappears from Tab 2, Tab 3, and all other existing tabs
5. Quick Tab does NOT appear when new tabs are opened (unless opened again)
6. Click Solo button again to un-solo (Quick Tab appears everywhere again)

**State Representation:**

```javascript
{
  id: 'qt-123',
  url: 'https://example.com',
  soloedOnTabs: [1234, 5678], // Array of Firefox tab IDs
  mutedOnTabs: [],
  // ... other properties
}
```

### Mute Feature

**Definition:** "Muting" a Quick Tab on Tab X makes it **hidden ONLY on Tab X** but visible on all other browser tabs.

**User Workflow:**

1. Quick Tab exists on Tab 1, Tab 2, Tab 3
2. User clicks Mute button (🔇) on Tab 1
3. Quick Tab disappears from Tab 1 only
4. Quick Tab remains visible on Tab 2, Tab 3, and all other tabs
5. Click Mute button on Tab 2 → Quick Tab also disappears from Tab 2
6. Click Unmute in Manager → Quick Tab reappears on previously muted tabs

**State Representation:**

```javascript
{
  id: 'qt-123',
  url: 'https://example.com',
  soloedOnTabs: [],
  mutedOnTabs: [1234], // Array of Firefox tab IDs where Quick Tab is muted
  // ... other properties
}
```

### Visibility Logic

**Pseudocode:**

```javascript
function shouldQuickTabBeVisible(quickTab, currentTabId) {
  // If soloed on specific tabs, only show on those tabs
  if (quickTab.soloedOnTabs && quickTab.soloedOnTabs.length > 0) {
    return quickTab.soloedOnTabs.includes(currentTabId);
  }

  // If muted on specific tabs, hide on those tabs only
  if (quickTab.mutedOnTabs && quickTab.mutedOnTabs.length > 0) {
    return !quickTab.mutedOnTabs.includes(currentTabId);
  }

  // Default: visible everywhere
  return true;
}
```

**Mutual Exclusivity:**

- A Quick Tab cannot be both soloed AND muted simultaneously
- Setting `soloedOnTabs` clears `mutedOnTabs` and vice versa
- This prevents logical conflicts and simplifies state management

---

## Required Architectural Changes

### 1. State Schema Updates

#### QuickTabWindow Class State

**Location:** `src/features/quick-tabs/window.js`

**Current State:**

```javascript
this.pinnedToUrl = options.pinnedToUrl || null;
```

**New State:**

```javascript
this.soloedOnTabs = options.soloedOnTabs || []; // Array of tab IDs
this.mutedOnTabs = options.mutedOnTabs || []; // Array of tab IDs
```

**Migration Strategy:**

- Remove all `pinnedToUrl` references
- Initialize both arrays as empty by default
- Update `getState()` method to include new properties

#### Storage Schema

**Location:** Background script storage format

**Current Format:**

```javascript
{
  containers: {
    'firefox-default': {
      tabs: [{
        id: 'qt-123',
        url: 'https://example.com',
        pinnedToUrl: 'https://github.com',
        // ... other properties
      }]
    }
  }
}
```

**New Format:**

```javascript
{
  containers: {
    'firefox-default': {
      tabs: [{
        id: 'qt-123',
        url: 'https://example.com',
        soloedOnTabs: [1234, 5678], // Firefox tab IDs
        mutedOnTabs: [],
        // ... other properties
      }]
    }
  }
}
```

**Backward Compatibility:**

- Background script should handle old `pinnedToUrl` format gracefully
- Convert old pinned state to empty solo/mute arrays on load
- No automatic migration of pin semantics (different behavior)

---

### 2. UI Component Changes

#### Quick Tab Titlebar Controls

**Location:** `src/features/quick-tabs/window.js` → `createTitlebar()` method

**Current Pin Button:**

```javascript
const pinBtn = this.createButton(this.pinnedToUrl ? '📌' : '📍', () => this.togglePin(pinBtn));
pinBtn.title = this.pinnedToUrl ? `Pinned to: ${this.pinnedToUrl}` : 'Pin to current page';
```

**New Solo Button:**

```javascript
const soloBtn = this.createButton(this.isCurrentTabSoloed() ? '🎯' : '⭕', () =>
  this.toggleSolo(soloBtn)
);
soloBtn.title = this.isCurrentTabSoloed()
  ? 'Un-solo (show on all tabs)'
  : 'Solo (show only on this tab)';
soloBtn.style.background = this.isCurrentTabSoloed() ? '#444' : 'transparent';
```

**New Mute Button:**

```javascript
const muteBtn = this.createButton(this.isCurrentTabMuted() ? '🔇' : '🔊', () =>
  this.toggleMute(muteBtn)
);
muteBtn.title = this.isCurrentTabMuted() ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
muteBtn.style.background = this.isCurrentTabMuted() ? '#c44' : 'transparent';
```

**Button Placement:**

- Solo button: Between "Open in New Tab" (🔗) and Mute button
- Mute button: Between Solo button and Minimize (−) button
- Both buttons use same styling as existing control buttons

#### Quick Tab Manager Panel Indicators

**Location:** `src/features/quick-tabs/panel.js` → `renderQuickTab()` method

**Current Display (No Pin Indicator):**

```
📍 example.com [Slot 1]
   🔗 Go to Tab  ↑ Restore  ✕ Close
```

**New Display with Indicators:**

```
🎯 example.com [Slot 1] [Solo: Tabs 2,5]
   🔗 Go to Tab  ⭕ Un-solo  ✕ Close

🔇 github.com [Slot 2] [Muted: Tabs 1,3]
   🔗 Go to Tab  🔊 Unmute  ✕ Close

📍 wikipedia.org [Slot 3] [Visible: All tabs]
   🔗 Go to Tab  🎯 Solo  🔇 Mute  ✕ Close
```

**Visual Indicators:**

- **🎯 (Target emoji):** Quick Tab is soloed on specific tabs
- **🔇 (Mute emoji):** Quick Tab is muted on specific tabs
- **📍 (Pin emoji):** Quick Tab is visible everywhere (default state)
- **Text badge:** Display which tabs have solo/mute applied (e.g., `[Solo: Tabs 2,5]`)

**Action Buttons in Panel:**

- Solo button: Toggle solo state for current tab
- Mute button: Toggle mute state for current tab
- Un-solo button: Clear all solo states
- Unmute button: Clear all mute states (or specific tab)

---

### 3. State Management Refactoring

#### Tab ID Detection

**Challenge:** Content scripts cannot directly access Firefox tab IDs

**Solution:** Request tab ID from background script during initialization

**Implementation in QuickTabsManager:**

```javascript
// In init() method, detect current tab ID
async detectCurrentTabId() {
  if (typeof browser === 'undefined' || !browser.runtime) {
    console.warn('[QuickTabsManager] Browser API not available');
    this.currentTabId = null;
    return;
  }

  try {
    // Send message to background to get current tab ID
    const response = await browser.runtime.sendMessage({
      action: 'GET_CURRENT_TAB_ID'
    });

    if (response && response.tabId) {
      this.currentTabId = response.tabId;
      console.log(`[QuickTabsManager] Current tab ID: ${this.currentTabId}`);
    } else {
      console.warn('[QuickTabsManager] Failed to get tab ID from background');
      this.currentTabId = null;
    }
  } catch (err) {
    console.error('[QuickTabsManager] Error detecting tab ID:', err);
    this.currentTabId = null;
  }
}
```

**Background Script Handler:**

```javascript
// In background.js message listener
if (message.action === 'GET_CURRENT_TAB_ID') {
  // sender.tab is automatically provided by Firefox for content script messages
  if (sender.tab && sender.tab.id) {
    return Promise.resolve({ tabId: sender.tab.id });
  } else {
    return Promise.resolve({ tabId: null });
  }
}
```

**Critical Note:** `sender.tab.id` is automatically available in background script message handlers when the message originates from a content script. This is a standard Firefox WebExtensions API feature.

#### Visibility Filtering During Hydration

**Location:** `src/features/quick-tabs/index.js` → `syncFromStorage()` method

**Current Approach:**

- All Quick Tabs from storage are created/rendered unconditionally
- No filtering based on page URL or tab context

**New Approach:**

- Filter Quick Tabs based on solo/mute state before rendering
- Only create Quick Tabs that should be visible on current tab

**Refactored `syncFromStorage()` Logic:**

```javascript
syncFromStorage(state, containerFilter = null) {
  // ... existing container filtering logic ...

  // Filter tabs by visibility rules BEFORE creating
  const visibleTabs = tabsToSync.filter(tabData => {
    return this.shouldQuickTabBeVisible(tabData);
  });

  console.log(`[QuickTabsManager] ${visibleTabs.length}/${tabsToSync.length} tabs visible on current tab`);

  // Create/update only visible Quick Tabs
  visibleTabs.forEach(tabData => {
    if (!this.tabs.has(tabData.id)) {
      // Create new Quick Tab
      this.createQuickTab(tabData);
    } else {
      // Update existing Quick Tab position/size
      const tab = this.tabs.get(tabData.id);
      if (tab) {
        tab.setPosition(tabData.left, tabData.top);
        tab.setSize(tabData.width, tabData.height);
      }
    }
  });

  // Remove Quick Tabs that are no longer visible
  const visibleIds = new Set(visibleTabs.map(t => t.id));
  for (const [id, tab] of this.tabs.entries()) {
    if (!visibleIds.has(id)) {
      console.log(`[QuickTabsManager] Removing Quick Tab ${id} (no longer visible on this tab)`);
      tab.destroy();
    }
  }
}
```

**New Helper Method:**

```javascript
shouldQuickTabBeVisible(tabData) {
  // Must have valid current tab ID
  if (!this.currentTabId) {
    console.warn('[QuickTabsManager] No current tab ID, cannot filter visibility');
    return true; // Show everything if we can't filter
  }

  // Solo logic: Only show on soloed tabs
  if (tabData.soloedOnTabs && tabData.soloedOnTabs.length > 0) {
    return tabData.soloedOnTabs.includes(this.currentTabId);
  }

  // Mute logic: Hide on muted tabs
  if (tabData.mutedOnTabs && tabData.mutedOnTabs.length > 0) {
    return !tabData.mutedOnTabs.includes(this.currentTabId);
  }

  // Default: visible everywhere
  return true;
}
```

#### Cross-Tab Sync with Visibility Updates

**Challenge:** When solo/mute state changes, other tabs need to show/hide Quick Tabs immediately

**Solution:** Enhance BroadcastChannel handlers to trigger visibility checks

**Refactored Message Handlers:**

```javascript
// In setupBroadcastChannel() onmessage handler
switch (type) {
  case 'SOLO':
    this.handleSoloFromBroadcast(data.id, data.soloedOnTabs);
    break;
  case 'MUTE':
    this.handleMuteFromBroadcast(data.id, data.mutedOnTabs);
    break;
  case 'UNSOLO':
    this.handleUnsoloFromBroadcast(data.id);
    break;
  case 'UNMUTE':
    this.handleUnmuteFromBroadcast(data.id);
    break;
  // ... existing cases ...
}
```

**New Handler Methods:**

```javascript
handleSoloFromBroadcast(quickTabId, soloedOnTabs) {
  const tab = this.tabs.get(quickTabId);

  if (tab) {
    // Update solo state
    tab.soloedOnTabs = soloedOnTabs;
    tab.mutedOnTabs = []; // Clear mute state (mutually exclusive)

    // Check if should be visible on current tab
    if (!this.shouldQuickTabBeVisible(tab.getState())) {
      // Hide on this tab (not in solo list)
      console.log(`[QuickTabsManager] Hiding Quick Tab ${quickTabId} (soloed on other tabs)`);
      tab.destroy();
    }
  } else {
    // Quick Tab doesn't exist locally
    // If current tab is in solo list, create it
    if (soloedOnTabs.includes(this.currentTabId)) {
      console.log(`[QuickTabsManager] Creating Quick Tab ${quickTabId} (soloed on this tab)`);
      // Need to fetch full state from storage to create
      // This will be handled by storage sync listener
    }
  }
}

handleMuteFromBroadcast(quickTabId, mutedOnTabs) {
  const tab = this.tabs.get(quickTabId);

  if (tab) {
    // Update mute state
    tab.mutedOnTabs = mutedOnTabs;
    tab.soloedOnTabs = []; // Clear solo state (mutually exclusive)

    // Check if should be visible on current tab
    if (!this.shouldQuickTabBeVisible(tab.getState())) {
      // Hide on this tab (in mute list)
      console.log(`[QuickTabsManager] Hiding Quick Tab ${quickTabId} (muted on this tab)`);
      tab.destroy();
    }
  } else {
    // Quick Tab doesn't exist locally
    // If current tab is NOT in mute list, create it
    if (!mutedOnTabs.includes(this.currentTabId)) {
      console.log(`[QuickTabsManager] Creating Quick Tab ${quickTabId} (not muted on this tab)`);
      // Need to fetch full state from storage to create
      // This will be handled by storage sync listener
    }
  }
}
```

---

### 4. Background Script Changes

#### Message Handler Updates

**Location:** `background.js`

**Remove Pin Handlers:**

```javascript
// DELETE these message handlers
case 'UPDATE_QUICK_TAB_PIN':
  // Old pin logic - no longer needed
```

**Add Solo/Mute Handlers:**

```javascript
case 'UPDATE_QUICK_TAB_SOLO': {
  const { id, soloedOnTabs, cookieStoreId, saveId } = message;

  // Get current state from storage
  const state = await getQuickTabsState();

  // Find and update the Quick Tab
  const containerState = state.containers[cookieStoreId];
  if (containerState && containerState.tabs) {
    const tabIndex = containerState.tabs.findIndex(t => t.id === id);
    if (tabIndex >= 0) {
      // Update solo state, clear mute state
      containerState.tabs[tabIndex].soloedOnTabs = soloedOnTabs;
      containerState.tabs[tabIndex].mutedOnTabs = [];

      // Save to storage
      await saveQuickTabsState(state, saveId);

      // Broadcast to all tabs
      await broadcastToAllTabs({
        action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
        state: state,
        cookieStoreId: cookieStoreId
      });

      return { success: true };
    }
  }

  return { success: false, error: 'Quick Tab not found' };
}

case 'UPDATE_QUICK_TAB_MUTE': {
  const { id, mutedOnTabs, cookieStoreId, saveId } = message;

  // Get current state from storage
  const state = await getQuickTabsState();

  // Find and update the Quick Tab
  const containerState = state.containers[cookieStoreId];
  if (containerState && containerState.tabs) {
    const tabIndex = containerState.tabs.findIndex(t => t.id === id);
    if (tabIndex >= 0) {
      // Update mute state, clear solo state
      containerState.tabs[tabIndex].mutedOnTabs = mutedOnTabs;
      containerState.tabs[tabIndex].soloedOnTabs = [];

      // Save to storage
      await saveQuickTabsState(state, saveId);

      // Broadcast to all tabs
      await broadcastToAllTabs({
        action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
        state: state,
        cookieStoreId: cookieStoreId
      });

      return { success: true };
    }
  }

  return { success: false, error: 'Quick Tab not found' };
}

case 'GET_CURRENT_TAB_ID': {
  // New handler for tab ID detection
  if (sender.tab && sender.tab.id) {
    return Promise.resolve({ tabId: sender.tab.id });
  }
  return Promise.resolve({ tabId: null });
}
```

**Key Changes:**

- Solo and Mute handlers update storage atomically
- Mutual exclusivity enforced (setting solo clears mute and vice versa)
- Broadcast state changes to all tabs for real-time sync
- Tab ID detection handler added for content scripts

---

### 5. QuickTabWindow Class Method Updates

**Location:** `src/features/quick-tabs/window.js`

**Remove Pin Methods:**

```javascript
// DELETE these methods
togglePin(pinBtn) { ... }
```

**Add Solo/Mute Methods:**

```javascript
/**
 * Check if current tab is in solo list
 */
isCurrentTabSoloed() {
  return this.soloedOnTabs &&
         this.soloedOnTabs.length > 0 &&
         window.quickTabsManager &&
         window.quickTabsManager.currentTabId &&
         this.soloedOnTabs.includes(window.quickTabsManager.currentTabId);
}

/**
 * Check if current tab is in mute list
 */
isCurrentTabMuted() {
  return this.mutedOnTabs &&
         this.mutedOnTabs.length > 0 &&
         window.quickTabsManager &&
         window.quickTabsManager.currentTabId &&
         this.mutedOnTabs.includes(window.quickTabsManager.currentTabId);
}

/**
 * Toggle solo state for current tab
 */
toggleSolo(soloBtn) {
  if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
    console.warn('[QuickTabWindow] Cannot toggle solo - no current tab ID');
    return;
  }

  const currentTabId = window.quickTabsManager.currentTabId;

  if (this.isCurrentTabSoloed()) {
    // Un-solo: Remove current tab from solo list
    this.soloedOnTabs = this.soloedOnTabs.filter(id => id !== currentTabId);
    soloBtn.textContent = '⭕';
    soloBtn.title = 'Solo (show only on this tab)';
    soloBtn.style.background = 'transparent';

    // If no tabs left in solo list, Quick Tab becomes visible everywhere
    if (this.soloedOnTabs.length === 0) {
      console.log('[QuickTabWindow] Un-soloed - now visible on all tabs');
    }
  } else {
    // Solo: Add current tab to solo list (or set as only tab)
    this.soloedOnTabs = [currentTabId]; // Replace entire list for simplicity
    this.mutedOnTabs = []; // Clear mute state
    soloBtn.textContent = '🎯';
    soloBtn.title = 'Un-solo (show on all tabs)';
    soloBtn.style.background = '#444';

    console.log('[QuickTabWindow] Soloed - only visible on this tab');
  }

  // Notify parent manager
  if (this.onSolo) {
    this.onSolo(this.id, this.soloedOnTabs);
  }
}

/**
 * Toggle mute state for current tab
 */
toggleMute(muteBtn) {
  if (!window.quickTabsManager || !window.quickTabsManager.currentTabId) {
    console.warn('[QuickTabWindow] Cannot toggle mute - no current tab ID');
    return;
  }

  const currentTabId = window.quickTabsManager.currentTabId;

  if (this.isCurrentTabMuted()) {
    // Unmute: Remove current tab from mute list
    this.mutedOnTabs = this.mutedOnTabs.filter(id => id !== currentTabId);
    muteBtn.textContent = '🔊';
    muteBtn.title = 'Mute (hide on this tab)';
    muteBtn.style.background = 'transparent';

    console.log('[QuickTabWindow] Unmuted on this tab');
  } else {
    // Mute: Add current tab to mute list
    if (!this.mutedOnTabs.includes(currentTabId)) {
      this.mutedOnTabs.push(currentTabId);
    }
    this.soloedOnTabs = []; // Clear solo state
    muteBtn.textContent = '🔇';
    muteBtn.title = 'Unmute (show on this tab)';
    muteBtn.style.background = '#c44';

    console.log('[QuickTabWindow] Muted on this tab');
  }

  // Notify parent manager
  if (this.onMute) {
    this.onMute(this.id, this.mutedOnTabs);
  }
}
```

**Update Constructor:**

```javascript
constructor(options) {
  // ... existing properties ...
  this.soloedOnTabs = options.soloedOnTabs || [];
  this.mutedOnTabs = options.mutedOnTabs || [];

  // ... existing properties ...
  this.onSolo = options.onSolo || (() => {});
  this.onMute = options.onMute || (() => {});

  // Store reference to manager for tab ID access
  this.soloButton = null;
  this.muteButton = null;
}
```

---

### 6. QuickTab Manager Panel Updates

**Location:** `src/features/quick-tabs/panel.js`

**Current Rendering (No Indicators):**

```javascript
const tabItem = document.createElement('div');
tabItem.className = 'quick-tab-item';
tabItem.innerHTML = `
  <div class="tab-info">
    <span class="tab-title">${tab.title}</span>
    <span class="tab-meta">...</span>
  </div>
  <div class="tab-actions">
    <button class="goto">🔗 Go to Tab</button>
    ...
  </div>
`;
```

**New Rendering with Solo/Mute Indicators:**

```javascript
renderQuickTab(tab) {
  const tabItem = document.createElement('div');
  tabItem.className = 'quick-tab-item';

  // Determine indicator emoji and badge text
  let indicator = '📍'; // Default: visible everywhere
  let badgeText = 'Visible: All tabs';

  if (tab.soloedOnTabs && tab.soloedOnTabs.length > 0) {
    indicator = '🎯';
    badgeText = `Solo: Tabs ${tab.soloedOnTabs.join(', ')}`;
  } else if (tab.mutedOnTabs && tab.mutedOnTabs.length > 0) {
    indicator = '🔇';
    badgeText = `Muted: Tabs ${tab.mutedOnTabs.join(', ')}`;
  }

  tabItem.innerHTML = `
    <div class="tab-info">
      <span class="tab-indicator">${indicator}</span>
      <span class="tab-title">${tab.title}</span>
      <span class="tab-badge">[${badgeText}]</span>
      <span class="tab-meta">[Slot ${tab.slotNumber || '?'}]</span>
    </div>
    <div class="tab-actions">
      ${this.renderActionButtons(tab)}
    </div>
  `;

  return tabItem;
}

renderActionButtons(tab) {
  const currentTabId = this.manager.currentTabId;
  let buttons = '<button class="goto">🔗 Go to Tab</button>';

  // Determine which action buttons to show
  if (tab.soloedOnTabs && tab.soloedOnTabs.length > 0) {
    // Quick Tab is soloed
    buttons += '<button class="unsolo">⭕ Un-solo</button>';
  } else if (tab.mutedOnTabs && tab.mutedOnTabs.length > 0) {
    // Quick Tab is muted (show unmute options)
    if (currentTabId && tab.mutedOnTabs.includes(currentTabId)) {
      buttons += '<button class="unmute-this">🔊 Unmute on This Tab</button>';
    }
    buttons += '<button class="unmute-all">🔊 Unmute on All Tabs</button>';
  } else {
    // Quick Tab is visible everywhere - offer solo/mute options
    buttons += '<button class="solo">🎯 Solo on This Tab</button>';
    buttons += '<button class="mute">🔇 Mute on This Tab</button>';
  }

  // Always show minimize/restore and close
  if (tab.minimized) {
    buttons += '<button class="restore">↑ Restore</button>';
  } else {
    buttons += '<button class="minimize">➖ Minimize</button>';
  }
  buttons += '<button class="close">✕ Close</button>';

  return buttons;
}
```

**Button Event Handlers:**

```javascript
setupEventHandlers(tabItem, tab) {
  // ... existing handlers for goto, minimize, restore, close ...

  // Solo button
  const soloBtn = tabItem.querySelector('.solo');
  if (soloBtn) {
    soloBtn.addEventListener('click', () => {
      if (this.manager.currentTabId) {
        this.manager.handleSoloToggle(tab.id, [this.manager.currentTabId]);
      }
    });
  }

  // Mute button
  const muteBtn = tabItem.querySelector('.mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (this.manager.currentTabId) {
        const newMutedTabs = [...(tab.mutedOnTabs || []), this.manager.currentTabId];
        this.manager.handleMuteToggle(tab.id, newMutedTabs);
      }
    });
  }

  // Un-solo button
  const unsoloBtn = tabItem.querySelector('.unsolo');
  if (unsoloBtn) {
    unsoloBtn.addEventListener('click', () => {
      this.manager.handleSoloToggle(tab.id, []); // Clear solo list
    });
  }

  // Unmute on this tab
  const unmuteThisBtn = tabItem.querySelector('.unmute-this');
  if (unmuteThisBtn) {
    unmuteThisBtn.addEventListener('click', () => {
      if (this.manager.currentTabId) {
        const newMutedTabs = (tab.mutedOnTabs || [])
          .filter(id => id !== this.manager.currentTabId);
        this.manager.handleMuteToggle(tab.id, newMutedTabs);
      }
    });
  }

  // Unmute on all tabs
  const unmuteAllBtn = tabItem.querySelector('.unmute-all');
  if (unmuteAllBtn) {
    unmuteAllBtn.addEventListener('click', () => {
      this.manager.handleMuteToggle(tab.id, []); // Clear mute list
    });
  }
}
```

---

### 7. QuickTabsManager Handler Methods

**Location:** `src/features/quick-tabs/index.js`

**Add New Handler Methods:**

```javascript
/**
 * Handle solo toggle from panel or Quick Tab window
 */
handleSoloToggle(quickTabId, newSoloedTabs) {
  console.log(`[QuickTabsManager] Toggling solo for ${quickTabId}:`, newSoloedTabs);

  const tab = this.tabs.get(quickTabId);
  if (tab) {
    tab.soloedOnTabs = newSoloedTabs;
    tab.mutedOnTabs = []; // Clear mute state

    // Update button states if tab has them
    if (tab.soloButton) {
      const isSoloed = newSoloedTabs.length > 0;
      tab.soloButton.textContent = isSoloed ? '🎯' : '⭕';
      tab.soloButton.title = isSoloed
        ? 'Un-solo (show on all tabs)'
        : 'Solo (show only on this tab)';
      tab.soloButton.style.background = isSoloed ? '#444' : 'transparent';
    }
  }

  // Broadcast to other tabs
  this.broadcast('SOLO', {
    id: quickTabId,
    soloedOnTabs: newSoloedTabs
  });

  // Save to background
  const saveId = this.generateSaveId();
  const cookieStoreId = tab?.cookieStoreId || this.cookieStoreId || 'firefox-default';

  if (typeof browser !== 'undefined' && browser.runtime) {
    browser.runtime.sendMessage({
      action: 'UPDATE_QUICK_TAB_SOLO',
      id: quickTabId,
      soloedOnTabs: newSoloedTabs,
      cookieStoreId: cookieStoreId,
      saveId: saveId,
      timestamp: Date.now()
    }).catch(err => {
      console.error('[QuickTabsManager] Solo update error:', err);
      this.releasePendingSave(saveId);
    });
  } else {
    this.releasePendingSave(saveId);
  }
}

/**
 * Handle mute toggle from panel or Quick Tab window
 */
handleMuteToggle(quickTabId, newMutedTabs) {
  console.log(`[QuickTabsManager] Toggling mute for ${quickTabId}:`, newMutedTabs);

  const tab = this.tabs.get(quickTabId);
  if (tab) {
    tab.mutedOnTabs = newMutedTabs;
    tab.soloedOnTabs = []; // Clear solo state

    // Update button states if tab has them
    if (tab.muteButton) {
      const isMuted = newMutedTabs.includes(this.currentTabId);
      tab.muteButton.textContent = isMuted ? '🔇' : '🔊';
      tab.muteButton.title = isMuted
        ? 'Unmute (show on this tab)'
        : 'Mute (hide on this tab)';
      tab.muteButton.style.background = isMuted ? '#c44' : 'transparent';
    }
  }

  // Broadcast to other tabs
  this.broadcast('MUTE', {
    id: quickTabId,
    mutedOnTabs: newMutedTabs
  });

  // Save to background
  const saveId = this.generateSaveId();
  const cookieStoreId = tab?.cookieStoreId || this.cookieStoreId || 'firefox-default';

  if (typeof browser !== 'undefined' && browser.runtime) {
    browser.runtime.sendMessage({
      action: 'UPDATE_QUICK_TAB_MUTE',
      id: quickTabId,
      mutedOnTabs: newMutedTabs,
      cookieStoreId: cookieStoreId,
      saveId: saveId,
      timestamp: Date.now()
    }).catch(err => {
      console.error('[QuickTabsManager] Mute update error:', err);
      this.releasePendingSave(saveId);
    });
  } else {
    this.releasePendingSave(saveId);
  }
}
```

---

## Edge Cases and Considerations

### 1. Tab Closure and Cleanup

**Scenario:** User closes a Firefox tab that has Quick Tabs soloed or muted

**Behavior:**

- Solo: If Tab 2 is closed and Quick Tab is soloed on Tab 2, remove Tab 2 from `soloedOnTabs` array
- Mute: If Tab 3 is closed and Quick Tab is muted on Tab 3, remove Tab 3 from `mutedOnTabs` array
- Automatic cleanup prevents dead tab IDs from accumulating in arrays

**Implementation:**

- Background script listens for `browser.tabs.onRemoved` event
- When tab closes, iterate through all Quick Tabs and remove closed tab ID from solo/mute arrays
- Broadcast updated state to all remaining tabs

```javascript
// In background.js
browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  console.log(`[Background] Tab ${tabId} closed - cleaning up Quick Tab references`);

  const state = await getQuickTabsState();
  let stateChanged = false;

  // Iterate through all containers and tabs
  for (const containerId in state.containers) {
    const containerTabs = state.containers[containerId].tabs || [];

    for (const quickTab of containerTabs) {
      // Remove from soloedOnTabs
      if (quickTab.soloedOnTabs && quickTab.soloedOnTabs.includes(tabId)) {
        quickTab.soloedOnTabs = quickTab.soloedOnTabs.filter(id => id !== tabId);
        stateChanged = true;
      }

      // Remove from mutedOnTabs
      if (quickTab.mutedOnTabs && quickTab.mutedOnTabs.includes(tabId)) {
        quickTab.mutedOnTabs = quickTab.mutedOnTabs.filter(id => id !== tabId);
        stateChanged = true;
      }
    }
  }

  // Save and broadcast if state changed
  if (stateChanged) {
    await saveQuickTabsState(state);
    await broadcastToAllTabs({
      action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
      state: state
    });
  }
});
```

### 2. Creating Quick Tabs on Non-Visible Tabs

**Scenario:** Quick Tab is soloed on Tab 2, user is on Tab 1, and creates new Quick Tab

**Expected Behavior:**

- New Quick Tab appears on Tab 1 (current tab)
- New Quick Tab does NOT automatically inherit solo state
- New Quick Tab starts in default "visible everywhere" state

**Implementation:**

- `createQuickTab()` always initializes with empty solo/mute arrays
- User must explicitly solo/mute after creation

### 3. Solo/Mute Conflict Resolution

**Scenario:** User tries to solo a Quick Tab that is already muted on the current tab

**Resolution:**

- Setting solo state **always clears mute state** (and vice versa)
- Mutual exclusivity enforced in all handlers
- Last action wins (e.g., if muted then soloed, solo takes precedence)

### 4. Container Isolation with Solo/Mute

**Scenario:** Quick Tabs in different Firefox Containers have same tab IDs

**Behavior:**

- Tab IDs are **globally unique** across all Firefox containers
- Solo/mute state is container-scoped via storage structure
- No conflicts possible (each container maintains its own Quick Tab state)

### 5. Storage Migration from Old Versions

**Scenario:** User upgrades from v1.5.9.12 (with pin) to new version (with solo/mute)

**Migration Strategy:**

- Background script detects old `pinnedToUrl` property on load
- Converts to default solo/mute state (empty arrays)
- Old pinned Quick Tabs become "visible everywhere" (not automatically converted to solo)
- User must manually re-configure solo/mute as desired

**Migration Code:**

```javascript
// In background.js - run on extension startup
async function migrateQuickTabState() {
  const state = await getQuickTabsState();
  let migrated = false;

  for (const containerId in state.containers) {
    const containerTabs = state.containers[containerId].tabs || [];

    for (const quickTab of containerTabs) {
      // Check for old pinnedToUrl property
      if ('pinnedToUrl' in quickTab) {
        console.log(`[Migration] Converting Quick Tab ${quickTab.id} from pin to solo/mute format`);

        // Initialize new properties
        quickTab.soloedOnTabs = [];
        quickTab.mutedOnTabs = [];

        // Remove old property
        delete quickTab.pinnedToUrl;

        migrated = true;
      }
    }
  }

  if (migrated) {
    console.log('[Migration] Saving migrated Quick Tab state');
    await saveQuickTabsState(state);
  }
}

// Call on extension install/update
browser.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'update') {
    await migrateQuickTabState();
  }
});
```

---

## Testing Checklist

### Functional Testing

**Solo Functionality:**

- [ ] Solo button appears in Quick Tab toolbar
- [ ] Clicking solo on Tab 1 hides Quick Tab from Tab 2 and Tab 3
- [ ] Quick Tab still visible on Tab 1 after soloing
- [ ] Un-soloing restores Quick Tab to all tabs
- [ ] Soloing on multiple tabs works correctly (Tab 1 and Tab 3)
- [ ] Panel shows correct solo indicator (🎯) and badge text

**Mute Functionality:**

- [ ] Mute button appears in Quick Tab toolbar
- [ ] Clicking mute on Tab 1 hides Quick Tab only on Tab 1
- [ ] Quick Tab still visible on Tab 2 and Tab 3 after muting Tab 1
- [ ] Muting on Tab 2 also hides Quick Tab from Tab 2
- [ ] Unmuting restores Quick Tab to previously muted tabs
- [ ] Panel shows correct mute indicator (🔇) and badge text

**Cross-Tab Sync:**

- [ ] Soloing on Tab 1 immediately updates visibility on Tab 2 and Tab 3
- [ ] Muting on Tab 2 immediately hides Quick Tab only on Tab 2
- [ ] Panel updates in real-time when solo/mute state changes
- [ ] BroadcastChannel messages propagate correctly

**Storage Persistence:**

- [ ] Solo state persists after browser restart
- [ ] Mute state persists after browser restart
- [ ] Quick Tabs restore with correct visibility on each tab
- [ ] Container isolation maintained (solo/mute doesn't leak across containers)

**Edge Cases:**

- [ ] Closing Tab 2 removes it from solo/mute arrays
- [ ] Solo/mute state clears correctly when mutually exclusive
- [ ] Creating new Quick Tab defaults to "visible everywhere"
- [ ] Panel actions (solo/mute buttons) work correctly
- [ ] Migration from old pin format works without errors

### UI/UX Testing

**Button States:**

- [ ] Solo button shows correct icon (🎯 when soloed, ⭕ when not)
- [ ] Mute button shows correct icon (🔇 when muted, 🔊 when not)
- [ ] Button backgrounds highlight correctly (gray for solo, red for mute)
- [ ] Tooltips display correct information

**Panel Display:**

- [ ] Indicators render correctly (🎯, 🔇, 📍)
- [ ] Badge text shows correct tab IDs
- [ ] Action buttons appear based on current state
- [ ] Button labels are clear and actionable

### Performance Testing

**State Updates:**

- [ ] No lag when toggling solo/mute on Quick Tabs
- [ ] No visible flicker when Quick Tabs hide/show
- [ ] Panel updates smoothly without delays
- [ ] Storage writes are debounced (no excessive writes)

**Memory Usage:**

- [ ] No memory leaks from tab ID arrays
- [ ] Dead tab IDs cleaned up promptly
- [ ] BroadcastChannel messages don't accumulate

---

## Implementation Priority and Sequencing

### Phase 1: Core State Management (Critical)

1. Add `soloedOnTabs` and `mutedOnTabs` properties to QuickTabWindow class
2. Update storage schema in background script
3. Implement tab ID detection in QuickTabsManager
4. Implement visibility filtering logic in `syncFromStorage()`
5. Add migration code for old pin format

### Phase 2: UI Components (High Priority)

6. Add solo and mute buttons to Quick Tab titlebar
7. Implement `toggleSolo()` and `toggleMute()` methods
8. Add `isCurrentTabSoloed()` and `isCurrentTabMuted()` helper methods
9. Update button states dynamically

### Phase 3: Cross-Tab Sync (High Priority)

10. Add SOLO/MUTE/UNSOLO/UNMUTE broadcast handlers
11. Implement background script message handlers
12. Add tab cleanup on tab close event
13. Test BroadcastChannel propagation

### Phase 4: Panel Integration (Medium Priority)

14. Add solo/mute indicators to panel display
15. Render action buttons based on state
16. Implement panel button event handlers
17. Test panel updates in real-time

### Phase 5: Testing and Polish (Medium Priority)

18. Comprehensive functional testing
19. Cross-browser testing (Firefox, Zen Browser)
20. Performance profiling
21. Documentation updates (README, changelogs)

---

## API and Method Reference Summary

### QuickTabWindow Class

**New Properties:**

- `soloedOnTabs: number[]` - Array of Firefox tab IDs where Quick Tab is soloed
- `mutedOnTabs: number[]` - Array of Firefox tab IDs where Quick Tab is muted
- `soloButton: HTMLElement` - Reference to solo button element
- `muteButton: HTMLElement` - Reference to mute button element

**New Methods:**

- `isCurrentTabSoloed(): boolean` - Check if current tab is in solo list
- `isCurrentTabMuted(): boolean` - Check if current tab is in mute list
- `toggleSolo(soloBtn: HTMLElement): void` - Toggle solo state
- `toggleMute(muteBtn: HTMLElement): void` - Toggle mute state

**New Callbacks:**

- `onSolo(id: string, soloedOnTabs: number[]): void` - Called when solo state changes
- `onMute(id: string, mutedOnTabs: number[]): void` - Called when mute state changes

### QuickTabsManager Class

**New Properties:**

- `currentTabId: number | null` - Current Firefox tab ID

**New Methods:**

- `detectCurrentTabId(): Promise<void>` - Detect current tab ID from background
- `shouldQuickTabBeVisible(tabData: object): boolean` - Check visibility based on solo/mute
- `handleSoloToggle(id: string, soloedOnTabs: number[]): void` - Handle solo state change
- `handleMuteToggle(id: string, mutedOnTabs: number[]): void` - Handle mute state change
- `handleSoloFromBroadcast(id: string, soloedOnTabs: number[]): void` - Handle solo broadcast
- `handleMuteFromBroadcast(id: string, mutedOnTabs: number[]): void` - Handle mute broadcast

### Background Script Messages

**New Message Actions:**

- `GET_CURRENT_TAB_ID` - Returns current tab ID
  - **Response:** `{ tabId: number }`
- `UPDATE_QUICK_TAB_SOLO` - Update solo state
  - **Params:** `{ id, soloedOnTabs, cookieStoreId, saveId }`
- `UPDATE_QUICK_TAB_MUTE` - Update mute state
  - **Params:** `{ id, mutedOnTabs, cookieStoreId, saveId }`

**Removed Message Actions:**

- `UPDATE_QUICK_TAB_PIN` - No longer used

### BroadcastChannel Messages

**New Message Types:**

- `SOLO` - Quick Tab soloed
  - **Data:** `{ id, soloedOnTabs }`
- `MUTE` - Quick Tab muted
  - **Data:** `{ id, mutedOnTabs }`
- `UNSOLO` - Quick Tab un-soloed (deprecated - use SOLO with empty array)
- `UNMUTE` - Quick Tab unmuted (deprecated - use MUTE with empty array)

**Removed Message Types:**

- `PIN` - No longer used
- `UNPIN` - No longer used

---

## Conclusion

This implementation guide provides a comprehensive roadmap for replacing the pin functionality with Solo and Mute features. The key architectural changes focus on:

1. **Tab ID-based filtering** instead of URL-based filtering
2. **Mutual exclusivity** between solo and mute states
3. **Real-time cross-tab synchronization** via BroadcastChannel
4. **Automatic cleanup** of dead tab IDs when tabs close
5. **Container isolation** maintained through existing architecture

The implementation requires changes across 6 core files (window.js, index.js, panel.js, background.js, storage schema, migration logic) while preserving all existing features like container integration, position/size persistence, and cross-tab state sync.

All code examples provided are architectural guidance and implementation patterns. The GitHub Copilot agent will handle specific code changes based on this framework document.
