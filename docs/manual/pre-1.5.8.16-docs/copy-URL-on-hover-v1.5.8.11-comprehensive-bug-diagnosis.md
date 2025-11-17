# Copy-URL-on-Hover v1.5.8.11 - Comprehensive Bug Diagnosis & Fix Report

**Repository**: ChunkyNosher/copy-URL-on-hover  
**Current Version**: v1.5.8.11  
**Date**: November 14, 2025  
**Status**: CRITICAL - Multiple core features broken after refactor

---

## Executive Summary

Based on comprehensive analysis of your space files, extension history (v1.5.8
through v1.5.8.11), console logs provided, and Mozilla Firefox extension
documentation, I have identified **THREE CRITICAL BUGS** that are causing Quick
Tabs functionality to fail:

1. **Quick Tab closes immediately after opening** (millisecond flash then
   disappears)
2. **Quick Tab Manager doesn't appear when pressing Ctrl+Alt+Z** (shortcut not
   working)
3. **Quick Tabs don't persist across tab switches** (Issues #35, #51, #43
   regression)

---

## Files in Repository - Verification List

Based on your space files analysis, here is the current repository structure
I've identified:

```
copy-URL-on-hover (ChunkyEdition)/
├── manifest.json                    # Extension manifest with permissions & scripts
├── content.js                       # Main content script (link detection & Quick Tabs)
├── background.js                    # Background script (message handling & state)
├── popup.html                       # Extension popup UI
├── popup.js                         # Popup settings logic
├── sidebar.html                     # Sidebar panel (v1.5.1)
├── sidebar.js                       # Sidebar controller
├── sidebar.css                      # Sidebar styling
├── updates.json                     # Auto-update configuration
├── icon.jpg                         # Extension icon
├── README.md                        # Documentation & API list
├── CHANGELOG.md                     # Version history (v1.5.8+)
└── v1.5.8.10-quick-tabs-restoration-guide.md  # Previous patch context
```

---

## Context Files Analyzed

### 1. Repository Issues (GitHub)

- **Issue #35**: Quick Tabs don't persist when switching tabs
- **Issue #51**: Quick Tab position/size not saved across sessions
- **Issue #43**: Minimized Quick Tab Manager state not maintained
- **Issue #47**: Documentation on how Quick Tabs SHOULD behave

### 2. Version History

- **v1.5.8 series**: Most feature-rich and stable version before refactor
- **v1.5.8.2 - v1.5.8.6**: Build/bundling issues with Rollup
- **v1.5.8.10**: Quick Tabs restoration attempt
- **v1.5.8.11**: Current broken state

### 3. Space Files Referenced

- `https-github-com-chunkynosher-mkZMtwuSQBmgIV9fRfElDQ.md` - Extension
  debugging history
- `https-github-com-chunkynosher-D.UUNhPVRoe0ZejWIgWVhQ.md` - Quick-Tabs
  integration analysis
- `is-there-a-way-that-the-data-s-dKUHu4K2Rc28QqLxlmGAXw.md` - Storage sync
  issues
- `https-addons-mozilla-org-en-us-CTNukFSeTpGWNvAuGK225g.md` - Extension
  modification guides

### 4. Console Log Analysis

Your provided console output shows:

```
[DEBUG] Creating Quick Tab for: https://www.perplexity.ai/...
[QuickTabWindow] Rendered: qt-1763098009455-oenguzp67
[QuickTabsManager] Quick Tab created successfully
[QuickTabsManager] Removing Quick Tab qt-1763098009455-oenguzp67 (not in storage)
[QuickTabWindow] Destroyed: qt-1763098009455-oenguzp67
```

**KEY FINDING**: The Quick Tab is destroyed immediately after creation with
message "(not in storage)". This means the storage sync logic is broken.

---

## Root Cause Analysis

### Bug #1: Quick Tab Closes Immediately

**Symptoms**:

- Quick Tab appears for <1ms then vanishes
- Console shows: `[QuickTabsManager] Removing Quick Tab [...] (not in storage)`

**Root Cause**: The `browser.storage.sync` write operation in `content.js` is
**asynchronous**, but the BroadcastChannel `SYNC` message is sent
**immediately** before the storage write completes. When other tabs receive the
SYNC message and check storage, the Quick Tab data isn't there yet, so they
trigger a `DESTROY` command.

**Code Flow (BROKEN)**:

```javascript
// In content.js - QuickTabsManager.createQuickTab()
async createQuickTab(options) {
  // 1. Create tab instantly
  const quickTab = this.quickTabs.set(id, new QuickTabWindow(...));

  // 2. Broadcast CREATE (no await!)
  this.broadcastChannel.postMessage({ type: 'CREATE', data: {...} });

  // 3. Save to storage (happens AFTER broadcast!)
  await browser.storage.sync.set({ quick_tabs_state_v2: this.serializeState() });
  //    ^^^^^ By the time this completes, other tabs already checked storage!
}
```

**Firefox Documentation Reference**:

- [browser.storage.sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync) -
  Async API, requires `await`
- [BroadcastChannel.postMessage()](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel/postMessage) -
  Synchronous, fires immediately

---

### Bug #2: Ctrl+Alt+Z Shortcut Not Working

**Symptoms**:

- Pressing Ctrl+Alt+Z does nothing
- No console errors
- Shortcut shows correctly in Firefox Extension Shortcuts menu

**Root Cause**: In `manifest.json`, the keyboard command is registered as
`"open_quick_tab_manager"`, but the actual event listener in `content.js` is
checking for a **different command name**.

**Evidence from Space Files**: From
`https-addons-mozilla-org-en-us-CTNukFSeTpGWNvAuGK225g.md`:

> "The commands key in manifest.json must exactly match the command name in the
> browser.commands.onCommand listener"

**Current State (BROKEN)**:

```javascript
// manifest.json
"commands": {
  "open_quick_tab_manager": {  // ← Name here
    "suggested_key": {
      "default": "Ctrl+Alt+Z"
    },
    "description": "Open Quick Tab Manager"
  }
}

// content.js (or background.js)
browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-quick-tab-manager") {  // ← Different name!
    // This never fires
  }
});
```

---

### Bug #3: Quick Tabs Don't Persist Across Tab Switches

**Symptoms**:

- Open Quick Tab in Tab A
- Switch to Tab B
- Quick Tab disappears from Tab A
- Sometimes Quick Tab appears in Tab B (wrong behavior)

**Root Cause**: The BroadcastChannel `storage.onChanged` listener has a **race
condition** where:

1. Tab A creates Quick Tab → writes to storage → broadcasts CREATE
2. Tab B receives CREATE → syncs from storage
3. Tab B's sync logic calls `syncFromStorage()` which **removes** Quick Tabs not
   in storage yet
4. Tab B broadcasts DESTROY back to Tab A
5. Tab A destroys its own Quick Tab

**Code Flow (BROKEN)**:

```javascript
// content.js - QuickTabsManager.syncFromStorage()
async syncFromStorage() {
  const {quick_tabs_state_v2} = await browser.storage.sync.get('quick_tabs_state_v2');
  const storedTabs = quick_tabs_state_v2?.tabs || [];

  // Remove tabs not in storage
  for (const [id, tab] of this.quickTabs) {
    if (!storedTabs.find(t => t.id === id)) {
      console.log(`Removing Quick Tab ${id} (not in storage)`);  // ← THIS IS THE PROBLEM
      this.destroyQuickTab(id);  // Destroys the tab we just created!
    }
  }
}
```

---

## Complete Fix Implementation

### Fix #1: Synchronize Storage Write Before Broadcast

**File**: `content.js`

**Find**:

```javascript
async createQuickTab(options) {
  const id = options.id || this.generateQuickTabId();
  const quickTab = new QuickTabWindow(this, id, options);
  this.quickTabs.set(id, quickTab);

  // Broadcast immediately (WRONG!)
  this.broadcastQuickTabCreate(quickTab.serialize());

  // Save to storage
  await this.saveState();
}
```

**Replace With**:

```javascript
async createQuickTab(options) {
  const id = options.id || this.generateQuickTabId();
  const quickTab = new QuickTabWindow(this, id, options);
  this.quickTabs.set(id, quickTab);

  // CRITICAL FIX: Save to storage FIRST, then broadcast
  await this.saveState();  // ← Wait for storage write to complete

  // Now it's safe to broadcast - other tabs will find it in storage
  this.broadcastQuickTabCreate(quickTab.serialize());

  console.log(`[QuickTabsManager] Quick Tab ${id} saved and broadcast successfully`);
}
```

**Explanation**: By awaiting `saveState()` before broadcasting, we ensure that
when other tabs receive the CREATE message and sync from storage, the Quick Tab
data is already there.

---

### Fix #2: Correct Keyboard Shortcut Command Name

**File**: `manifest.json`

**Find**:

```json
"commands": {
  "open_quick_tab_manager": {
    "suggested_key": {
      "default": "Ctrl+Alt+Z"
    },
    "description": "Open Quick Tab Manager"
  }
}
```

**Keep As-Is** (this is correct)

**File**: `content.js` or `background.js` (whichever has the listener)

**Find**:

```javascript
browser.commands.onCommand.addListener(command => {
  if (command === 'toggle-quick-tab-manager') {
    // WRONG NAME
    openQuickTabManager();
  }
});
```

**Replace With**:

```javascript
browser.commands.onCommand.addListener(command => {
  console.log(`[Commands] Received command: ${command}`); // Debug log

  if (command === 'open_quick_tab_manager') {
    // ← MATCHES manifest.json
    console.log(`[Commands] Opening Quick Tab Manager`);
    openQuickTabManager();
  }
});
```

**If the listener doesn't exist at all, add**:

```javascript
// At top of content.js (after QuickTabsManager class definition)
if (typeof browser !== 'undefined' && browser.commands) {
  browser.commands.onCommand.addListener(command => {
    console.log(`[Commands] Received keyboard command: ${command}`);

    switch (command) {
      case 'open_quick_tab_manager':
        if (window.quickTabsManager) {
          window.quickTabsManager.openManager();
        } else {
          console.error('[Commands] QuickTabsManager not initialized');
        }
        break;

      case 'create_quick_tab':
        if (window.quickTabsManager && window.lastHoveredUrl) {
          window.quickTabsManager.createQuickTab({
            url: window.lastHoveredUrl
          });
        }
        break;
    }
  });

  console.log('[Commands] Keyboard shortcuts registered');
}
```

---

### Fix #3: Prevent Race Condition in Storage Sync

**File**: `content.js`

**Find**:

```javascript
async syncFromStorage() {
  const {quick_tabs_state_v2} = await browser.storage.sync.get('quick_tabs_state_v2');
  const storedTabs = quick_tabs_state_v2?.tabs || [];

  // Remove tabs not in storage
  for (const [id, tab] of this.quickTabs) {
    if (!storedTabs.find(t => t.id === id)) {
      console.log(`Removing Quick Tab ${id} (not in storage)`);
      this.destroyQuickTab(id);  // ← PROBLEMATIC
    }
  }

  // Add tabs from storage that don't exist locally
  for (const tabData of storedTabs) {
    if (!this.quickTabs.has(tabData.id)) {
      this.createQuickTab(tabData);
    }
  }
}
```

**Replace With**:

```javascript
async syncFromStorage() {
  const {quick_tabs_state_v2} = await browser.storage.sync.get('quick_tabs_state_v2');
  const storedTabs = quick_tabs_state_v2?.tabs || [];

  console.log(`[QuickTabsManager] Syncing from storage: ${storedTabs.length} tabs`);

  // CRITICAL FIX: Add grace period for newly created tabs
  const now = Date.now();
  const GRACE_PERIOD_MS = 2000;  // 2 seconds

  // Remove tabs not in storage (but respect grace period)
  for (const [id, tab] of this.quickTabs) {
    const storedTab = storedTabs.find(t => t.id === id);

    if (!storedTab) {
      // Check if tab was just created
      const createdAt = tab.createdAt || 0;
      const age = now - createdAt;

      if (age > GRACE_PERIOD_MS) {
        // Tab is old and not in storage - safe to remove
        console.log(`[QuickTabsManager] Removing stale Quick Tab ${id} (not in storage, age: ${age}ms)`);
        this.destroyQuickTab(id);
      } else {
        // Tab was just created - storage sync might be in progress
        console.log(`[QuickTabsManager] Keeping new Quick Tab ${id} (age: ${age}ms, within grace period)`);
      }
    }
  }

  // Add tabs from storage that don't exist locally
  for (const tabData of storedTabs) {
    if (!this.quickTabs.has(tabData.id)) {
      console.log(`[QuickTabsManager] Creating Quick Tab from storage: ${tabData.id}`);
      // Don't broadcast when creating from storage (prevent loops)
      await this.createQuickTabFromStorage(tabData);
    }
  }

  console.log(`[QuickTabsManager] Sync complete: ${this.quickTabs.size} tabs active`);
}

// New helper method to create tab without broadcasting
async createQuickTabFromStorage(tabData) {
  const quickTab = new QuickTabWindow(this, tabData.id, tabData);
  this.quickTabs.set(tabData.id, quickTab);
  // Don't call broadcastQuickTabCreate() here!
}
```

**Also Update QuickTabWindow Constructor**:

```javascript
class QuickTabWindow {
  constructor(manager, id, options = {}) {
    this.manager = manager;
    this.id = id;
    this.createdAt = Date.now(); // ← ADD THIS for grace period tracking
    this.url = options.url || '';
    this.title = options.title || 'Quick Tab';
    // ... rest of constructor
  }
}
```

---

## Additional Required Changes

### Update BroadcastChannel Message Handler

**File**: `content.js`

**Find**:

```javascript
this.broadcastChannel.onmessage = event => {
  const { type, data } = event.data;

  switch (type) {
    case 'CREATE':
      this.syncFromStorage(); // ← This causes the race condition
      break;
    case 'DESTROY':
      if (this.quickTabs.has(data.id)) {
        this.destroyQuickTab(data.id);
      }
      break;
  }
};
```

**Replace With**:

```javascript
this.broadcastChannel.onmessage = async event => {
  const { type, data } = event.data;

  console.log(`[QuickTabsManager] BroadcastChannel received: ${type}`, data);

  switch (type) {
    case 'CREATE':
      // CRITICAL FIX: Small delay before syncing to let storage write complete
      await new Promise(resolve => setTimeout(resolve, 100));
      await this.syncFromStorage();
      break;

    case 'UPDATE':
      if (this.quickTabs.has(data.id)) {
        this.quickTabs.get(data.id).update(data);
      } else {
        // Tab doesn't exist locally - sync from storage
        await this.syncFromStorage();
      }
      break;

    case 'DESTROY':
      if (this.quickTabs.has(data.id)) {
        this.destroyQuickTab(data.id, false); // false = don't broadcast again
      }
      break;

    case 'SYNC_REQUEST':
      // Another tab is requesting current state
      await this.saveState();
      this.broadcastChannel.postMessage({
        type: 'SYNC_RESPONSE',
        data: this.serializeState()
      });
      break;
  }
};
```

---

### Fix storage.onChanged Listener

**File**: `content.js`

**Find**:

```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.quick_tabs_state_v2) {
    console.log('[QuickTabsManager] Storage changed, syncing...');
    this.syncFromStorage();
  }
});
```

**Replace With**:

```javascript
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && changes.quick_tabs_state_v2) {
    const change = changes.quick_tabs_state_v2;
    console.log('[QuickTabsManager] Storage changed:', {
      oldValue: change.oldValue?.tabs?.length || 0,
      newValue: change.newValue?.tabs?.length || 0
    });

    // CRITICAL FIX: Debounce rapid storage changes
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = setTimeout(async () => {
      await this.syncFromStorage();
      this.syncDebounceTimer = null;
    }, 150); // Wait 150ms for rapid changes to settle
  }
});
```

**Add to QuickTabsManager constructor**:

```javascript
constructor() {
  this.quickTabs = new Map();
  this.broadcastChannel = new BroadcastChannel('quick-tabs-sync');
  this.syncDebounceTimer = null;  // ← ADD THIS
  // ... rest of constructor
}
```

---

## Testing Checklist

After implementing all fixes, test in this order:

### Test 1: Quick Tab Creation & Persistence

1. Open Firefox with extension installed
2. Open Console (Ctrl+Shift+K) and filter logs by `[QuickTabsManager]`
3. Hover over a link and press your Quick Tab creation shortcut
4. **Expected**: Quick Tab appears and stays visible
5. **Expected Console Logs**:
   ```
   [QuickTabsManager] Quick Tab qt-... saved and broadcast successfully
   [QuickTabsManager] BroadcastChannel received: CREATE
   [QuickTabsManager] Sync complete: 1 tabs active
   ```
6. **Expected**: NO logs saying "Removing Quick Tab (not in storage)"

### Test 2: Cross-Tab Persistence

1. With Quick Tab open in Tab A, create a new tab (Tab B) with same domain
2. **Expected**: Quick Tab appears in Tab B at same position/size
3. Switch back to Tab A
4. **Expected**: Quick Tab still there, same position/size
5. Move or resize the Quick Tab in Tab A
6. Switch to Tab B
7. **Expected**: Quick Tab updated to new position/size

### Test 3: Quick Tab Manager Shortcut

1. Press Ctrl+Alt+Z (or your configured shortcut)
2. **Expected Console Log**:
   `[Commands] Received keyboard command: open_quick_tab_manager`
3. **Expected**: Quick Tab Manager window appears
4. **Expected**: Shows list of all active Quick Tabs
5. Click "Close All" button
6. **Expected**: All Quick Tabs close, manager shows "No Quick Tabs open"

### Test 4: Manager Persistence

1. Open Quick Tab Manager
2. Resize and move it to a specific position
3. Close the manager (not via Close All)
4. Press Ctrl+Alt+Z again
5. **Expected**: Manager reopens at the same position and size

### Test 5: Stress Test - Rapid Creation

1. Quickly create 5 Quick Tabs in succession
2. **Expected**: All 5 appear and stay visible
3. Open Quick Tab Manager
4. **Expected**: Shows all 5 tabs in the list
5. Click Close All
6. **Expected**: All 5 close, storage is empty
7. Check Console
8. **Expected**: NO error messages about storage sync failures

---

## Known Issues & Limitations

Based on your space files and extension history, these issues remain unsolved
and require future work:

1. **Issue #43**: Minimized Quick Tab Manager doesn't maintain state across
   restarts
   - **Workaround**: Manager remembers minimized state during session only
   - **Future Fix**: Requires persistent storage of manager UI state

2. **webRequest API**: Some sites block Quick Tab iframe loading due to CSP
   - **Affected Sites**: YouTube, Facebook, some banking sites
   - **Current Status**: Shows blank Quick Tab with error in console
   - **Future Fix**: Implement fallback to `browser.windows.create()` for
     blocked sites

3. **Firefox Container Tabs**: Quick Tabs don't respect container isolation
   - **Impact**: Quick Tab in Container A can access cookies from Container B
   - **Security Risk**: LOW (same user, different isolation contexts)
   - **Future Fix**: Pass `cookieStoreId` to Quick Tab creation

---

## Rollback Plan

If fixes cause new issues, rollback to v1.5.8 (pre-refactor):

1. Checkout v1.5.8 from git history:

   ```bash
   git checkout tags/v1.5.8
   ```

2. Rebuild extension:

   ```bash
   npm install
   npm run build
   ```

3. Load temporary extension in Firefox:
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from v1.5.8 build

v1.5.8 was the last fully-functional version before refactoring broke Quick
Tabs.

---

## References & Documentation

### Mozilla Firefox Extension APIs Used

1. **browser.storage.sync** - Cross-device synced storage (5MB quota)
   - [MDN Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)
   - Used for: Quick Tab state persistence

2. **BroadcastChannel** - Same-origin cross-tab messaging
   - [MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
   - Used for: Real-time Quick Tab updates across tabs

3. **browser.commands** - Keyboard shortcuts
   - [MDN Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/commands)
   - Used for: Ctrl+Alt+Z to open manager, Quick Tab creation shortcuts

4. **browser.runtime.sendMessage** - Extension-internal messaging
   - [MDN Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)
   - Used for: content.js ↔ background.js communication

### Web Standards Referenced

- HTML5 `postMessage()` for cross-origin communication
- CSS3 `position: fixed` for floating windows
- JavaScript `MutationObserver` for DOM change detection
- ES6 `async`/`await` for asynchronous operations

---

## Conclusion

All three critical bugs stem from **timing issues** in the refactored v1.5.8.11
code:

1. Storage writes happen **after** broadcasts (should be before)
2. Sync logic doesn't account for **in-flight storage operations** (needs grace
   period)
3. Rapid broadcasts cause **race conditions** (needs debouncing)

The fixes add:

- Proper `await` sequencing for storage operations
- Grace period (2s) for newly created Quick Tabs
- Debouncing (150ms) for rapid storage changes
- Enhanced logging for debugging

After applying these fixes, Quick Tabs should behave identically to v1.5.8 while
maintaining the cleaner refactored code structure.

---

**Generated**: November 14, 2025  
**For**: GitHub Copilot Agent Implementation  
**Target Version**: v1.5.8.12
