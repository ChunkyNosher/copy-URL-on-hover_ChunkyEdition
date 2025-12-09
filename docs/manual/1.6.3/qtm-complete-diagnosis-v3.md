# Quick Tab Manager - Complete Bug Diagnosis & Enhanced Logging Guide

**Document Version:** 3.0 (Comprehensive Analysis)  
**Date:** November 28, 2025  
**Extension Version:** v1.6.3  
**Branch:** `copilot/fix-critical-bugs-and-robustness` (PR #294)  
**Analysis Source:** Current repository + extension logs + browser console logs

---

## Executive Summary

**ALL user-reported bugs trace to a single root cause:** The `updateContent()`
method in `PanelContentManager.js` checks if panel is open BEFORE updating, but
this check is INVERTED - it updates when closed, skips when open.

**Critical Finding:** Event listeners ARE firing, events ARE being received, but
UI updates are BLOCKED by the `isOpen` check.

**Priority Fixes:**

1. **CRITICAL:** Fix `isOpen` logic inversion in `updateContent()`
2. **CRITICAL:** Add missing error logging throughout event chains
3. **HIGH:** Enhance button click logging for debugging
4. **HIGH:** Add panel state transition logging

---

## Table of Contents

1. [Bug #12: Panel Never Updates When Open (ROOT CAUSE)](#bug-12-panel-never-updates-when-open-root-cause)
2. [Bug #13: Minimize Indicator Doesn't Change](#bug-13-minimize-indicator-doesnt-change)
3. [Bug #14: Close Button Doesn't Remove from List](#bug-14-close-button-doesnt-remove-from-list)
4. [Bug #15: Clear Storage Doesn't Update Panel](#bug-15-clear-storage-doesnt-update-panel)
5. [Bug #16: Panel Buttons Don't Work](#bug-16-panel-buttons-dont-work)
6. [Bug #17: Keyboard Shortcut Opens Wrong UI](#bug-17-keyboard-shortcut-opens-wrong-ui)
7. [Bug #20: Panel Opens with Wrong State](#bug-20-panel-opens-with-wrong-state)
8. [Enhanced Logging Requirements](#enhanced-logging-requirements)
9. [Testing Verification Procedures](#testing-verification-procedures)

---

## Bug #12: Panel Never Updates When Open (ROOT CAUSE)

### User-Visible Symptom

When Quick Tab Manager is OPEN:

- Closing a Quick Tab via X button → Panel list doesn't update
- Minimizing a Quick Tab → Indicator stays green instead of yellow
- Clicking "Clear Storage" → Panel still shows tabs

**ALL reported bugs stem from this single issue.**

### Root Cause Analysis

**File:** `src/features/quick-tabs/panel/PanelContentManager.js`  
**Location:** Lines 143-165 (`updateContent()` method)

**The Inverted Logic:**

```javascript
async updateContent(options = { forceRefresh: false }) {
  const isCurrentlyOpen = this._getIsOpen();  // Line 145

  // v1.6.3 - FIX Issue #1: If forceRefresh is true, skip isOpen check
  if (!options.forceRefresh && !isCurrentlyOpen) {  // Line 148 ← BUG IS HERE
    debug(`[PanelContentManager] updateContent skipped: panel=${!!this.panel}, isOpen=${isCurrentlyOpen}`);
    this.stateChangedWhileClosed = true;
    return;  // ← Exits BEFORE updating when panel is closed
  }

  // ... rest of update logic
}
```

**The Problem:** This condition says:

- "IF NOT forceRefresh AND NOT open → skip update"
- Translated: "Only update when panel is OPEN"

**BUT logs show:**

```
[PanelContentManager] updateContent skipped: panel=true, isOpen=false
```

**Wait, that's correct behavior!** The bug is more subtle...

### Deeper Analysis: The REAL Bug

Looking at `_getIsOpen()` at lines 107-130:

```javascript
_getIsOpen() {
  // Query PanelStateManager for authoritative state if available
  const stateManagerAvailable = this.stateManager && typeof this.stateManager.getState === 'function';
  if (!stateManagerAvailable) {
    return this.isOpen;  // Fallback to local cached state
  }

  const state = this.stateManager.getState();
  const hasAuthoritativeState = typeof state.isOpen === 'boolean';
  if (!hasAuthoritativeState) {
    return this.isOpen;
  }

  // Sync local state if it differs (for logging purposes)
  if (this.isOpen !== state.isOpen) {
    debug(`[PanelContentManager] Syncing isOpen: local=${this.isOpen}, stateManager=${state.isOpen}`);
    this.isOpen = state.isOpen;
  }
  return state.isOpen;
}
```

**The ACTUAL bug:** `PanelStateManager.getState()` is returning stale state OR
panel is actually closed when events fire!

**Evidence from logs:**

```
[PanelContentManager] state:updated received for qt-121-1764360044908-1a4qad71t7mf0m
[PanelContentManager] updateContent skipped: panel=true, isOpen=false
```

**This proves:** When `state:updated` event fires, `_getIsOpen()` returns
`false`, so update is skipped.

### What Needs to Be Fixed

**Problem #1:** `updateContent()` should UPDATE IMMEDIATELY when panel is open,
regardless of events

**Problem #2:** When panel is closed and events fire, should set
`stateChangedWhileClosed = true` and update when re-opened

**Problem #3:** `forceRefresh` option exists but is NEVER USED by event handlers

**Solution #1: Fix Event Handlers to Pass forceRefresh**

**File:** `PanelContentManager.js`  
**Location:** Lines 668-710 (`setupStateListeners()` method)

**Current Code (Lines 668-688):**

```javascript
const updatedHandler = data => {
  try {
    const quickTab = data?.quickTab || data;
    debug(`[PanelContentManager] state:updated received for ${quickTab?.id}`);

    // v1.6.3 - Only mark state changed if panel is closed
    if (!this._getIsOpen()) {
      this.stateChangedWhileClosed = true;
    }

    // v1.6.3 - Try to update content - it will handle isOpen internally
    this.updateContent({ forceRefresh: false }); // ← BUG: Should be true!
  } catch (err) {
    console.error('[PanelContentManager] Error handling state:updated:', err);
  }
};
```

**Required Change:**

Change `forceRefresh: false` to `forceRefresh: true` in ALL event handlers:

- `addedHandler` (line 656)
- `updatedHandler` (line 679)
- `deletedHandler` (line 693)
- `hydratedHandler` (line 707)
- `clearedHandler` (line 721) - already has `forceRefresh: true` ✓

**Solution #2: Alternative - Invert the Logic**

Instead of changing all handlers, change `updateContent()` to ALWAYS update when
panel is open:

```javascript
async updateContent(options = { forceRefresh: false }) {
  const isCurrentlyOpen = this._getIsOpen();

  // NEW LOGIC: Only skip if panel is closed AND forceRefresh is false
  if (!isCurrentlyOpen && !options.forceRefresh) {
    debug(`[PanelContentManager] Panel closed, deferring update`);
    this.stateChangedWhileClosed = true;
    return;
  }

  // If panel is open OR forceRefresh, proceed with update
  // ... rest of update logic
}
```

**This makes the logic clearer:**

- Panel open → ALWAYS update
- Panel closed + no forceRefresh → Defer update
- Panel closed + forceRefresh → Force update anyway

### Testing After Fix

**Test Procedure:**

1. Open Quick Tab Manager
2. Minimize a Quick Tab (via Quick Tab button)
3. **Expected:** Indicator turns yellow immediately
4. **Current:** Indicator stays green

**Verification:**

Check logs for:

- ✅ `[PanelContentManager] state:updated received`
- ✅ `[PanelContentManager] Panel opened OR forceRefresh, updating...` (new log)
- ❌ **Current:** `updateContent skipped: isOpen=false`

---

## Bug #13: Minimize Indicator Doesn't Change

### User-Visible Symptom

When clicking minimize button on Quick Tab:

- Quick Tab minimizes correctly ✅
- `state:updated` event IS emitted ✅
- PanelContentManager receives event ✅
- **BUT:** Panel doesn't update, indicator stays green ❌

### Root Cause

**Same as Bug #12** - `updateContent()` is skipped because panel is open but
`_getIsOpen()` returns false.

**Evidence from logs:**

```
[2025-11-28T20:00:46.024Z] [Quick Tab] Minimized - ID: qt-121-1764360044908-1a4qad71t7mf0m
[2025-11-28T20:00:46.024Z] [VisibilityHandler] Handling minimize for: qt-121-1764360044908-1a4qad71t7mf0m
[2025-11-28T20:00:46.024Z] [MinimizedManager] Added minimized tab: qt-121-1764360044908-1a4qad71t7mf0m
[2025-11-28T20:00:46.024Z] [DEBUG] [PanelContentManager] state:updated received ✅
[2025-11-28T20:00:46.025Z] [PanelContentManager] updateContent skipped: panel=true, isOpen=false ❌
```

**The chain IS working:**

1. User clicks minimize → Handler fires
2. QuickTab minimizes → `state:updated` emitted
3. PanelContentManager receives event → Calls `updateContent()`
4. **BUT:** `updateContent()` exits early due to `isOpen=false` check

### What Needs to Be Fixed

**Apply Solution #1 from Bug #12:** Pass `forceRefresh: true` in
`updatedHandler`

OR

**Apply Solution #2 from Bug #12:** Invert logic in `updateContent()`

### Testing After Fix

**Test Procedure:**

1. Open Quick Tab Manager
2. Create a Quick Tab
3. Click minimize button on Quick Tab's title bar
4. **Expected:** Indicator in panel turns yellow immediately
5. **Current:** Stays green

**Verification:**

Check logs for:

- ✅ `[VisibilityHandler] Handling minimize`
- ✅ `[PanelContentManager] state:updated received`
- ✅ `[PanelContentManager] Updating content...` (NOT "skipped")
- ✅ Panel UI refreshes with yellow indicator

---

## Bug #14: Close Button Doesn't Remove from List

### User-Visible Symptom

When clicking X button on Quick Tab:

- Quick Tab closes (DOM removed) ✅
- `state:deleted` event IS emitted ✅
- **BUT:** Panel doesn't remove tab from list ❌
- Tab remains visible in panel as "closed"

### Root Cause

**Same root cause as Bug #12** + additional issue

**Evidence from logs:**

```
[2025-11-28T20:00:17.540Z] [DestroyHandler] Handling destroy for: qt-121-1764360010188-1mwcozz1su59yk
[2025-11-28T20:00:17.540Z] [DestroyHandler] Emitted state:deleted for: qt-121-1764360010188-1mwcozz1su59yk
```

**MISSING:** `[PanelContentManager] state:deleted received` log

**This means:** Either:

1. EventBus isn't emitting `state:deleted` properly
2. EventBus is emitting but PanelContentManager's listener isn't attached
3. EventBus is emitting but listener is throwing error silently

### Additional Diagnosis Needed

**File:** Check where `DestroyHandler` emits `state:deleted`

**Probable location:** `src/features/quick-tabs/handlers/DestroyHandler.js` or
similar

**Need to verify:**

1. Is `this.eventBus.emit('state:deleted', {...})` actually called?
2. Is the data structure correct? (expects `{ id, quickTab }`)
3. Is there a try-catch swallowing errors?

### What Needs to Be Fixed

**Problem #1:** Verify EventBus emission in DestroyHandler

Check that destroy logic includes:

```javascript
this.eventBus.emit('state:deleted', {
  id: quickTabId,
  quickTab: quickTabData // May be optional
});
```

**Problem #2:** Apply Bug #12 fix (forceRefresh or logic inversion)

Once events are received, they must trigger `updateContent()` immediately.

**Problem #3:** Add error handling in deletedHandler

Current code (lines 688-702):

```javascript
const deletedHandler = data => {
  try {
    const id = data?.id || data?.quickTab?.id;
    debug(`[PanelContentManager] state:deleted received for ${id}`);

    if (!this._getIsOpen()) {
      this.stateChangedWhileClosed = true;
    }

    this.updateContent({ forceRefresh: false }); // ← Should be true
  } catch (err) {
    console.error('[PanelContentManager] Error handling state:deleted:', err);
  }
};
```

**Add logging BEFORE the try-catch:**

```javascript
const deletedHandler = data => {
  console.log('[PanelContentManager] deletedHandler INVOKED with data:', data);
  try {
    // ... existing code
  } catch (err) {
    console.error('[PanelContentManager] Error handling state:deleted:', err);
    console.error('[PanelContentManager] Stack trace:', err.stack);
  }
};
```

### Testing After Fix

**Test Procedure:**

1. Open Quick Tab Manager
2. Create a Quick Tab
3. Click X button on Quick Tab (not panel button!)
4. **Expected:** Tab disappears from panel list immediately
5. **Current:** Tab stays in list

**Verification:**

Check logs for:

- ✅ `[DestroyHandler] Emitted state:deleted`
- ✅ `[PanelContentManager] deletedHandler INVOKED` (new log)
- ✅ `[PanelContentManager] state:deleted received for qt-...`
- ✅ `[PanelContentManager] Updating content...` (NOT "skipped")
- ✅ Panel UI refreshes without deleted tab

---

## Bug #15: Clear Storage Doesn't Update Panel

### User-Visible Symptom

When clicking "Clear Storage" button:

- Confirmation dialog appears ✅
- User confirms ✅
- Storage IS cleared ✅
- Quick Tabs ARE destroyed ✅
- `state:cleared` event IS emitted ✅
- **BUT:** Panel list still shows tabs ❌

### Root Cause

**Combination of Bug #12 + event timing issue**

**Evidence from logs:**

```
[2025-11-28T20:00:05.825Z] [Background] Storage cleared (empty/missing tabs)
[2025-11-28T20:00:05.839Z] [Content] Received CLEAR_ALL_QUICK_TABS request ✅
[2025-11-28T20:00:05.839Z] [Content] Clearing 3 Quick Tabs ✅
[2025-11-28T20:00:05.839Z] [DestroyHandler] Closing all Quick Tabs ✅
... (all tabs destroyed successfully)
[2025-11-28T20:00:06.678Z] [PanelContentManager] Storage changed - updating content (debounced) ✅
[2025-11-28T20:00:06.678Z] [PanelContentManager] Storage changed while panel closed ❌
```

**What's happening:**

1. User clicks "Clear Storage"
2. `handleClearStorage()` calls `quickTabsManager.closeAll()` ✅
3. `handleClearStorage()` clears storage ✅
4. `handleClearStorage()` emits `state:cleared` ✅
5. Storage listener detects change ✅
6. **BUT:** Storage listener thinks panel is closed, so sets
   `stateChangedWhileClosed` flag instead of updating

**The bug:** Storage listener uses DIFFERENT code path than state event
listeners!

### What Needs to Be Fixed

**File:** `PanelContentManager.js`  
**Location:** Lines 593-612 (storage.onChanged listener in
`setupEventListeners()`)

**Current Code:**

```javascript
const storageListener = (changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.quick_tabs_state_v2) {
    debug(
      '[PanelContentManager] Storage changed from another tab - updating content'
    );

    // v1.6.2.4 - FIX: Use _getIsOpen() for authoritative state check
    if (this._getIsOpen()) {
      // ← SAME BUG as state event handlers
      this.updateContent();
    } else {
      this.stateChangedWhileClosed = true;
      debug(
        '[PanelContentManager] Storage changed while panel closed - will update on open'
      );
    }
  }
};
```

**Required Change:**

Change to always call `updateContent({ forceRefresh: true })`:

```javascript
const storageListener = (changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.quick_tabs_state_v2) {
    console.log(
      '[PanelContentManager] Storage changed from another tab - force updating content'
    );

    // Always update, let updateContent() decide whether to defer
    this.updateContent({ forceRefresh: true });
  }
};
```

OR apply the inverted logic fix from Bug #12.

### Additional Issue: state:cleared Handler

**File:** `PanelContentManager.js`  
**Location:** Lines 711-728 (`clearedHandler` in `setupStateListeners()`)

**Current Code:**

```javascript
const clearedHandler = data => {
  try {
    debug(
      `[PanelContentManager] state:cleared received, ${data?.count ?? 0} tabs cleared`
    );

    // Mark state changed if panel is closed
    if (!this._getIsOpen()) {
      this.stateChangedWhileClosed = true;
    }

    // v1.6.3 - FIX Issue #6: Force refresh to update immediately
    this.updateContent({ forceRefresh: true }); // ✅ This one is correct!

    debug('[PanelContentManager] State cleared - panel updated');
  } catch (err) {
    console.error('[PanelContentManager] Error handling state:cleared:', err);
  }
};
```

**This handler is CORRECT** - it uses `forceRefresh: true`.

**BUT:** Need to verify it's being called. Add explicit logging:

```javascript
const clearedHandler = (data) => {
  console.log('[PanelContentManager] clearedHandler INVOKED with data:', data);
  try {
    // ... existing code
  }
};
```

### Testing After Fix

**Test Procedure:**

1. Open Quick Tab Manager
2. Create 2-3 Quick Tabs
3. Click "Clear Storage" button
4. Confirm dialog
5. **Expected:** Panel list clears immediately, shows "No Quick Tabs"
6. **Current:** Panel still shows tabs

**Verification:**

Check logs for:

- ✅ `[PanelContentManager] handleClearStorage starting...`
- ✅ `[PanelContentManager] Destroying all Quick Tab DOM elements...`
- ✅ `[PanelContentManager] Forcing in-memory state clear...`
- ✅ `[PanelContentManager] clearedHandler INVOKED` (new log)
- ✅ `[PanelContentManager] state:cleared received`
- ✅ `[PanelContentManager] Updating content...` (NOT "skipped")
- ✅ Panel shows "No Quick Tabs" empty state

---

## Bug #16: Panel Buttons Don't Work

### User-Visible Symptom

When clicking buttons in panel list (minimize, restore, close):

- Button appears to click (visual feedback) ✅
- **BUT:** Nothing happens ❌
- No logs appear ❌
- Quick Tab doesn't minimize/restore/close ❌

### Root Cause

**Two possibilities:**

**Possibility #1: Event Delegation Not Working**

Event delegation is set up on `#panel-containersList` (lines 565-590), but:

- Container may not exist when listener is attached
- Container may be replaced during updates, losing listener
- Selector `button[data-action]` may not match rendered buttons

**Possibility #2: Buttons Not Being Rendered**

`PanelUIBuilder.renderQuickTabItem()` creates buttons, but:

- Data attributes may be missing
- Button elements may be malformed
- Event delegation selector doesn't match

### Diagnosis

**Check #1: Are buttons being rendered correctly?**

**File:** `PanelUIBuilder.js`  
**Location:** Lines 273-322 (`_createActions()` method)

**Current rendering code (lines 287-292):**

```javascript
// Minimize button
const minBtn = PanelUIBuilder._createButton('➖', 'Minimize', 'minimize', {
  quickTabId: tab.id
});
actions.appendChild(minBtn);
```

**Check button creation (lines 333-349):**

```javascript
static _createButton(text, title, action, data) {
  const button = document.createElement('button');
  button.className = 'panel-btn-icon';
  button.textContent = text;
  button.title = title;
  button.dataset.action = action;

  // Set data attributes
  Object.entries(data).forEach(([key, value]) => {
    button.dataset[key] = value;
  });

  return button;
}
```

**This looks correct.** Button SHOULD have:

- `class="panel-btn-icon"`
- `data-action="minimize"`
- `data-quick-tab-id="qt-..."`

**Check #2: Is event delegation attached?**

**File:** `PanelContentManager.js`  
**Location:** Lines 565-590 (`setupEventListeners()` method)

**Current code:**

```javascript
const containersList = this.panel.querySelector('#panel-containersList');
if (containersList) {
  const actionHandler = async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    e.stopPropagation();

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    // v1.6.3 - FIX Bug #2 & #3: Log button click for debugging
    console.log(
      `[PanelContentManager] Button clicked: action=${action}, quickTabId=${quickTabId}, tabId=${tabId}`
    );

    await this._handleQuickTabAction(action, quickTabId, tabId);
  };
  containersList.addEventListener('click', actionHandler);
  // ... store listener
}
```

**This looks correct too.**

**BUT:** Notice the dataset property access uses **camelCase**:

- `button.dataset.quickTabId`
- `button.dataset.tabId`

**HTML data attributes use kebab-case:**

- `data-quick-tab-id`
- `data-tab-id`

**JavaScript automatically converts kebab-case to camelCase** when accessing via
`dataset`, so this should work.

**Check #3: Is containersList found?**

**Evidence from logs:**

```
[PanelContentManager] ✓ Delegated action listener attached to #panel-containersList
```

**This log appears**, so containersList IS found and listener IS attached.

**WAIT!** That log is at line 588:

```javascript
console.log(
  '[PanelContentManager] ✓ Delegated action listener attached to #panel-containersList'
);
```

**But this log ONLY appears if `containersList` is truthy.**

**So listener IS attached...**

### The REAL Problem

**If listener is attached AND buttons exist, but clicks don't work, then:**

1. **Buttons are rendered AFTER listener is attached** (listener attached to
   empty container)
2. **Event delegation breaks** when container is replaced during
   `updateContent()`

**Evidence:** `updateContent()` calls `renderContainerSectionFromData()` which
does:

```javascript
containersList.innerHTML = '';  // ← WIPES OUT ENTIRE CONTAINER
const section = PanelUIBuilder.renderContainerSection(...);
containersList.appendChild(section);  // ← REPLACES WITH NEW CONTENT
```

**Event delegation on `containersList` itself should still work** because we're
listening on the container, not the children.

**BUT:** If `updateContent()` is NEVER called (Bug #12), then buttons are NEVER
rendered!

### What Needs to Be Fixed

**Primary Fix:** Fix Bug #12 - Once `updateContent()` works, buttons will be
rendered and clickable.

**Secondary Fix:** Add extensive logging to button click handler to diagnose why
clicks don't register:

**File:** `PanelContentManager.js`  
**Location:** Lines 565-590

**Enhanced logging:**

```javascript
const containersList = this.panel.querySelector('#panel-containersList');
if (containersList) {
  console.log(
    '[PanelContentManager] Setting up click delegation on #panel-containersList'
  );

  const actionHandler = async e => {
    console.log('[PanelContentManager] Click detected on containersList');
    console.log('[PanelContentManager] Event target:', e.target);
    console.log(
      '[PanelContentManager] Event target class:',
      e.target.className
    );
    console.log(
      '[PanelContentManager] Event target data-action:',
      e.target.dataset?.action
    );

    const button = e.target.closest('button[data-action]');
    console.log('[PanelContentManager] Closest button found:', button);

    if (!button) {
      console.log(
        '[PanelContentManager] No button with data-action found, ignoring click'
      );
      return;
    }

    e.stopPropagation();

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    console.log(
      `[PanelContentManager] Button clicked: action=${action}, quickTabId=${quickTabId}, tabId=${tabId}`
    );
    console.log(`[PanelContentManager] Calling _handleQuickTabAction...`);

    await this._handleQuickTabAction(action, quickTabId, tabId);

    console.log(`[PanelContentManager] _handleQuickTabAction completed`);
  };

  containersList.addEventListener('click', actionHandler);
  this.eventListeners.push({
    element: containersList,
    type: 'click',
    handler: actionHandler
  });
  console.log(
    '[PanelContentManager] ✓ Click delegation attached to #panel-containersList'
  );
} else {
  console.error(
    '[PanelContentManager] #panel-containersList NOT FOUND - buttons will not work!'
  );
}
```

### Testing After Fix

**Test Procedure:**

1. Open Quick Tab Manager
2. Create a Quick Tab
3. **FIRST:** Verify panel shows the tab (tests Bug #12 fix)
4. Click minimize button on tab in panel
5. **Expected:** Quick Tab minimizes, indicator turns yellow
6. **Current:** Nothing happens

**Verification:**

Check logs for:

- ✅ `[PanelContentManager] Setting up click delegation`
- ✅ `[PanelContentManager] ✓ Click delegation attached`
- ✅ `[PanelContentManager] Click detected on containersList`
- ✅ `[PanelContentManager] Button clicked: action=minimize, quickTabId=qt-...`
- ✅ `[PanelContentManager] handleMinimizeTab called for qt-...`
- ✅ `[PanelContentManager] Calling minimizeById`

---

## Bug #17: Keyboard Shortcut Opens Wrong UI

### User-Visible Symptom

When pressing keyboard shortcut (Alt+Shift+Z or whatever is configured):

- Opens a POPUP menu instead of sidebar ❌
- OR opens floating panel instead of sidebar ❌
- User expects sidebar to open

### Root Cause

**File:** `manifest.json` (keyboard command configuration)

**Probable issue:** Keyboard shortcut is mapped to wrong action:

- `_execute_browser_action` → Opens popup.html
- `toggle-quick-tabs-manager` → Opens floating panel
- `_execute_sidebar_action` → Opens sidebar

**Need to check manifest.json** to see which command is assigned to which
shortcut.

### What Needs to Be Fixed

**Check current keyboard command mappings:**

```json
"commands": {
  "_execute_browser_action": {
    "suggested_key": {
      "default": "Alt+Shift+Q"
    }
  },
  "toggle-quick-tabs-manager": {
    "suggested_key": {
      "default": "Alt+Shift+Z"
    },
    "description": "Toggle Quick Tabs Manager Panel"
  },
  "_execute_sidebar_action": {
    "suggested_key": {
      "default": "Alt+Shift+S"
    }
  }
}
```

**User wants Alt+Shift+Z to open SIDEBAR, not floating panel.**

**Solution:** Change `toggle-quick-tabs-manager` to `_execute_sidebar_action`:

```json
"commands": {
  "_execute_sidebar_action": {
    "suggested_key": {
      "default": "Alt+Shift+Z"
    },
    "description": "Open Quick Tabs Manager Sidebar"
  },
  "toggle-quick-tabs-manager": {
    "suggested_key": {
      "default": "Alt+Shift+F"
    },
    "description": "Toggle Quick Tabs Manager Floating Panel"
  }
}
```

**OR:** Redirect `toggle-quick-tabs-manager` to open sidebar instead of panel:

**File:** `background.js`  
**Location:** Keyboard command handler (search for
`commands.onCommand.addListener`)

**Change floating panel open to sidebar open:**

```javascript
browser.commands.onCommand.addListener(async command => {
  if (command === 'toggle-quick-tabs-manager') {
    // Open sidebar instead of floating panel
    await browser.sidebarAction.open();
  }
});
```

### Testing After Fix

**Test Procedure:**

1. Close sidebar if open
2. Press Alt+Shift+Z (or configured shortcut)
3. **Expected:** Sidebar opens
4. **Current:** Popup or floating panel opens

**Verification:**

Check logs for:

- ✅ `[Background] Command received: toggle-quick-tabs-manager`
- ✅ `[Background] Opening sidebar...`
- ✅ `[Sidebar] Sidebar opened`

---

## Bug #20: Panel Opens with Wrong State

### User-Visible Symptom

When opening Quick Tab Manager:

- Shows "0 tabs, 0 minimized" ❌
- **BUT:** There ARE tabs (minimized from previous session) ❌
- Panel has stale/incorrect state

### Root Cause

**File:** `PanelContentManager.js`  
**Location:** `updateContent()` not called on panel open

**Evidence from logs:**

```
[2025-11-28T20:02:05.590Z] [PanelManager] Panel opened
[2025-11-28T20:02:05.590Z] [PanelContentManager] Live state: 0 tabs, 0 minimized ❌
```

**What's happening:**

1. Panel opens
2. `setIsOpen(true)` is called
3. `setIsOpen()` checks `stateChangedWhileClosed` flag
4. If true, calls `updateContent()`
5. **BUT:** Flag may be false if no events fired while panel was closed

**The bug:** Panel doesn't load INITIAL state when first opened.

### What Needs to Be Fixed

**File:** `PanelContentManager.js`  
**Location:** Lines 131-141 (`setIsOpen()` method)

**Current Code:**

```javascript
setIsOpen(isOpen) {
  const wasOpen = this.isOpen;
  this.isOpen = isOpen;

  // v1.6.2.x - Update content if panel was just opened and state changed while closed
  if (isOpen && !wasOpen && this.stateChangedWhileClosed) {
    debug('[PanelContentManager] Panel opened after state changes - updating content');
    this.stateChangedWhileClosed = false;
    this.updateContent();
  }
}
```

**Required Change:**

ALWAYS update when panel opens, not just when `stateChangedWhileClosed`:

```javascript
setIsOpen(isOpen) {
  const wasOpen = this.isOpen;
  this.isOpen = isOpen;

  // v1.6.3 - ALWAYS update when panel opens to load current state
  if (isOpen && !wasOpen) {
    console.log('[PanelContentManager] Panel opened - loading current state');
    this.stateChangedWhileClosed = false;  // Reset flag
    this.updateContent({ forceRefresh: true });  // Force immediate update
  }
}
```

**This ensures:** Panel ALWAYS shows correct state when opened, even if no
events fired while closed.

### Testing After Fix

**Test Procedure:**

1. Create 2-3 Quick Tabs
2. Minimize 1-2 of them
3. Close Quick Tab Manager
4. Wait 5 seconds
5. Re-open Quick Tab Manager
6. **Expected:** Shows correct tab count and minimized count
7. **Current:** Shows "0 tabs, 0 minimized"

**Verification:**

Check logs for:

- ✅ `[PanelContentManager] Panel opened - loading current state`
- ✅ `[PanelContentManager] Updating content...` (NOT "skipped")
- ✅ `[PanelContentManager] Live state: X tabs, Y minimized`
- ✅ Panel displays correct tab list

---

## Enhanced Logging Requirements

### 1. Button Click Logging (Panel Buttons)

**Purpose:** Track when panel buttons are clicked and whether handlers execute

**Files to Modify:**

**A. Close Minimized Button**

**File:** `PanelContentManager.js`  
**Location:** Lines 518-530

**Add console.log at start and end of handler:**

```javascript
const closeMinimizedHandler = async e => {
  e.stopPropagation();
  console.log('[PanelContentManager] ✦ Close Minimized button CLICKED');
  console.log('[PanelContentManager] ✦ handleCloseMinimized STARTING...');

  try {
    await this.handleCloseMinimized();
    console.log(
      '[PanelContentManager] ✦ handleCloseMinimized COMPLETED successfully'
    );
  } catch (err) {
    console.error('[PanelContentManager] ✦ handleCloseMinimized FAILED:', err);
    console.error('[PanelContentManager] ✦ Error stack:', err.stack);
  }
};
```

**B. Close All Button**

**File:** `PanelContentManager.js`  
**Location:** Lines 544-557

**Add console.log at start and end:**

```javascript
const closeAllHandler = async e => {
  e.stopPropagation();
  console.log('[PanelContentManager] ✦ Close All button CLICKED');
  console.log('[PanelContentManager] ✦ handleCloseAll STARTING...');

  try {
    await this.handleCloseAll();
    console.log(
      '[PanelContentManager] ✦ handleCloseAll COMPLETED successfully'
    );
  } catch (err) {
    console.error('[PanelContentManager] ✦ handleCloseAll FAILED:', err);
    console.error('[PanelContentManager] ✦ Error stack:', err.stack);
  }
};
```

**C. Clear Storage Button**

**File:** `PanelContentManager.js`  
**Location:** Lines 564-577

**Add console.log at start and end:**

```javascript
const clearStorageHandler = async e => {
  e.stopPropagation();
  console.log('[PanelContentManager] ✦ Clear Storage button CLICKED');
  console.log('[PanelContentManager] ✦ User confirmation dialog showing...');
  console.log('[PanelContentManager] ✦ handleClearStorage STARTING...');

  try {
    await this.handleClearStorage();
    console.log(
      '[PanelContentManager] ✦ handleClearStorage COMPLETED successfully'
    );
  } catch (err) {
    console.error('[PanelContentManager] ✦ handleClearStorage FAILED:', err);
    console.error('[PanelContentManager] ✦ Error stack:', err.stack);
  }
};
```

### 2. Individual Quick Tab Button Logging

**Purpose:** Track clicks on minimize/restore/close buttons for individual tabs
in panel list

**File:** `PanelContentManager.js`  
**Location:** Lines 739-790 (`_handleQuickTabAction()` and individual handlers)

**A. Action Dispatcher Logging**

**Add at start of `_handleQuickTabAction()` (line 739):**

```javascript
async _handleQuickTabAction(action, quickTabId, tabId) {
  console.log(`[PanelContentManager] ⚡ Quick Tab action DISPATCHED: action=${action}, quickTabId=${quickTabId}, tabId=${tabId}`);

  try {
    switch (action) {
      case 'goToTab':
        console.log(`[PanelContentManager] ⚡ Routing to handleGoToTab...`);
        await this.handleGoToTab(parseInt(tabId, 10));
        break;
      case 'minimize':
        console.log(`[PanelContentManager] ⚡ Routing to handleMinimizeTab...`);
        this.handleMinimizeTab(quickTabId);
        break;
      case 'restore':
        console.log(`[PanelContentManager] ⚡ Routing to handleRestoreTab...`);
        this.handleRestoreTab(quickTabId);
        break;
      case 'close':
        console.log(`[PanelContentManager] ⚡ Routing to handleCloseTab...`);
        this.handleCloseTab(quickTabId);
        break;
      default:
        console.warn(`[PanelContentManager] ⚡ UNKNOWN action: ${action}`);
    }
    console.log(`[PanelContentManager] ⚡ Action ${action} handler completed`);
  } catch (err) {
    console.error(`[PanelContentManager] ⚡ Action ${action} FAILED:`, err);
    console.error(`[PanelContentManager] ⚡ Error stack:`, err.stack);
  }
}
```

**B. Individual Handler Logging**

**Already exists** (lines 806-838), but verify these logs are present:

```javascript
handleMinimizeTab(quickTabId) {
  console.log(`[PanelContentManager] ⚡ handleMinimizeTab CALLED for ${quickTabId}`);

  if (!this.quickTabsManager) {
    console.error('[PanelContentManager] ⚡ CANNOT minimize - quickTabsManager not available');
    return;
  }

  console.log(`[PanelContentManager] ⚡ Calling quickTabsManager.minimizeById(${quickTabId})`);
  this.quickTabsManager.minimizeById(quickTabId);
  console.log(`[PanelContentManager] ⚡ quickTabsManager.minimizeById COMPLETED`);
}
```

**Same pattern for `handleRestoreTab()` and `handleCloseTab()`.**

### 3. Panel Open/Close State Logging

**Purpose:** Track when panel opens, closes, and state transitions

**File:** `PanelContentManager.js`  
**Location:** Lines 131-141 (`setIsOpen()` method)

**Enhanced logging:**

```javascript
setIsOpen(isOpen) {
  const wasOpen = this.isOpen;
  const stateChanged = wasOpen !== isOpen;

  console.log(`[PanelContentManager] ◈ setIsOpen called: wasOpen=${wasOpen}, newOpen=${isOpen}, stateChanged=${stateChanged}`);
  console.log(`[PanelContentManager] ◈ stateChangedWhileClosed flag: ${this.stateChangedWhileClosed}`);

  this.isOpen = isOpen;

  if (isOpen && !wasOpen) {
    console.log(`[PanelContentManager] ◈ PANEL OPENED - loading current state`);
    this.stateChangedWhileClosed = false;

    console.log(`[PanelContentManager] ◈ Calling updateContent({ forceRefresh: true })...`);
    this.updateContent({ forceRefresh: true });
    console.log(`[PanelContentManager] ◈ updateContent call completed`);
  } else if (!isOpen && wasOpen) {
    console.log(`[PanelContentManager] ◈ PANEL CLOSED - deferring updates`);
  } else {
    console.log(`[PanelContentManager] ◈ No state change (already ${isOpen ? 'open' : 'closed'})`);
  }
}
```

### 4. Update Content Call Logging

**Purpose:** Track every time `updateContent()` is called and why it
succeeds/fails

**File:** `PanelContentManager.js`  
**Location:** Lines 143-165 (`updateContent()` method)

**Enhanced logging:**

```javascript
async updateContent(options = { forceRefresh: false }) {
  const callTimestamp = Date.now();
  const callStack = new Error().stack;  // Capture call stack for debugging

  console.log(`[PanelContentManager] ► updateContent CALLED at ${callTimestamp}`);
  console.log(`[PanelContentManager] ► Options:`, options);
  console.log(`[PanelContentManager] ► Called from:`, callStack.split('\n')[2].trim());

  const isCurrentlyOpen = this._getIsOpen();
  console.log(`[PanelContentManager] ► Panel state: isOpen=${isCurrentlyOpen}, forceRefresh=${options.forceRefresh}`);

  if (!options.forceRefresh && !isCurrentlyOpen) {
    console.warn(`[PanelContentManager] ► UPDATE SKIPPED: panel closed and forceRefresh=false`);
    this.stateChangedWhileClosed = true;
    console.log(`[PanelContentManager] ► stateChangedWhileClosed flag SET`);
    return;
  }

  if (!this.panel) {
    console.error(`[PanelContentManager] ► UPDATE FAILED: panel DOM element not initialized`);
    return;
  }

  console.log(`[PanelContentManager] ► UPDATE PROCEEDING...`);

  try {
    // ... existing update logic
    console.log(`[PanelContentManager] ► UPDATE COMPLETED successfully in ${Date.now() - callTimestamp}ms`);
  } catch (err) {
    console.error(`[PanelContentManager] ► UPDATE FAILED with error:`, err);
    console.error(`[PanelContentManager] ► Error stack:`, err.stack);
  }
}
```

### 5. Event Listener Setup Logging

**Purpose:** Verify all event listeners are attached correctly

**File:** `PanelContentManager.js`  
**Location:** Lines 496-617 (`setupEventListeners()` method)

**Add at start of method:**

```javascript
setupEventListeners() {
  console.log('[PanelContentManager] ◉ setupEventListeners STARTING...');
  console.log('[PanelContentManager] ◉ Panel element:', this.panel);
  console.log('[PanelContentManager] ◉ EventBus available:', !!this.eventBus);
  console.log('[PanelContentManager] ◉ QuickTabsManager available:', !!this.quickTabsManager);

  // ... existing code

  console.log('[PanelContentManager] ◉ setupEventListeners COMPLETED');
  console.log('[PanelContentManager] ◉ Total DOM listeners:', this.eventListeners.length);
}
```

**Add at end of EACH button setup:**

```javascript
// After closeBtn listener
debug('[PanelContentManager] ◉ Close button (.panel-close) listener attached');

// After minimizeBtn listener
debug(
  '[PanelContentManager] ◉ Minimize button (.panel-minimize) listener attached'
);

// After closeMinimizedBtn listener
debug(
  '[PanelContentManager] ◉ Close Minimized button (#panel-closeMinimized) listener attached'
);

// After closeAllBtn listener
debug(
  '[PanelContentManager] ◉ Close All button (#panel-closeAll) listener attached'
);

// After clearStorageBtn listener
debug(
  '[PanelContentManager] ◉ Clear Storage button (#panel-clearStorage) listener attached'
);

// After containersList delegation
console.log(
  '[PanelContentManager] ◉ Delegated action listener attached to #panel-containersList'
);
```

### 6. State Event Listener Logging

**Purpose:** Track when state events are received and processed

**File:** `PanelContentManager.js`  
**Location:** Lines 618-747 (`setupStateListeners()` method)

**Add at start of method:**

```javascript
setupStateListeners() {
  console.log('[PanelContentManager] ◉ setupStateListeners STARTING...');

  if (!this.eventBus) {
    console.error('[PanelContentManager] ◉ CANNOT setup state listeners - eventBus not available!');
    return;
  }

  console.log('[PanelContentManager] ◉ EventBus available, attaching state listeners...');

  // ... existing code

  console.log('[PanelContentManager] ◉ setupStateListeners COMPLETED');
  console.log('[PanelContentManager] ◉ State listeners registered:', Object.keys(this._stateHandlers));
}
```

**Add at START of each event handler (BEFORE try-catch):**

```javascript
const addedHandler = (data) => {
  console.log('[PanelContentManager] ◆ state:added EVENT RECEIVED');
  console.log('[PanelContentManager] ◆ Event data:', data);
  try {
    // ... existing code
  }
};

const updatedHandler = (data) => {
  console.log('[PanelContentManager] ◆ state:updated EVENT RECEIVED');
  console.log('[PanelContentManager] ◆ Event data:', data);
  try {
    // ... existing code
  }
};

const deletedHandler = (data) => {
  console.log('[PanelContentManager] ◆ state:deleted EVENT RECEIVED');
  console.log('[PanelContentManager] ◆ Event data:', data);
  try {
    // ... existing code
  }
};

const hydratedHandler = (data) => {
  console.log('[PanelContentManager] ◆ state:hydrated EVENT RECEIVED');
  console.log('[PanelContentManager] ◆ Event data:', data);
  try {
    // ... existing code
  }
};

const clearedHandler = (data) => {
  console.log('[PanelContentManager] ◆ state:cleared EVENT RECEIVED');
  console.log('[PanelContentManager] ◆ Event data:', data);
  try {
    // ... existing code
  }
};
```

### 7. Failure Logging Throughout Extension

**Purpose:** Explicitly log ALL failures with ERROR level and stack traces

**Pattern to apply EVERYWHERE:**

```javascript
try {
  // ... risky code
  console.log('[Component] ✓ Operation succeeded');
} catch (err) {
  console.error('[Component] ✗ Operation FAILED:', err.message);
  console.error('[Component] ✗ Error type:', err.name);
  console.error('[Component] ✗ Full error:', err);
  console.error('[Component] ✗ Stack trace:', err.stack);

  // Re-throw if critical
  throw err;
}
```

**Apply this pattern to:**

1. All async functions
2. All event handlers
3. All DOM manipulation
4. All storage operations
5. All message passing
6. All EventBus emissions/listeners

### 8. Storage Operation Logging

**Purpose:** Track when storage is read/written

**File:** `PanelContentManager.js`  
**Location:** All storage operations

**A. Storage Read Logging**

**Location:** `_fetchQuickTabsFromStorage()` (lines 178-203)

**Add:**

```javascript
async _fetchQuickTabsFromStorage() {
  console.log('[PanelContentManager] ◐ Fetching Quick Tabs from storage...');

  try {
    const result = await browser.storage.local.get('quick_tabs_state_v2');
    console.log('[PanelContentManager] ◐ Storage read result:', result);

    if (!result?.quick_tabs_state_v2) {
      console.warn('[PanelContentManager] ◐ No storage data found (key missing or empty)');
      return null;
    }

    const state = result.quick_tabs_state_v2;
    console.log('[PanelContentManager] ◐ Storage format:', state.tabs ? 'unified' : state.containers ? 'container' : 'unknown');

    // ... rest of logic

  } catch (err) {
    console.error('[PanelContentManager] ◐ Storage read FAILED:', err);
    console.error('[PanelContentManager] ◐ Error stack:', err.stack);
    return null;
  }
}
```

**B. Storage Write Logging**

**Pattern for all storage writes:**

```javascript
try {
  console.log('[Component] ◑ Writing to storage:', dataToSave);
  await browser.storage.local.set({ quick_tabs_state_v2: dataToSave });
  console.log('[Component] ◑ Storage write SUCCEEDED');
} catch (err) {
  console.error('[Component] ◑ Storage write FAILED:', err);
  console.error('[Component] ◑ Error stack:', err.stack);
  throw err;
}
```

---

## Testing Verification Procedures

### Pre-Fix Testing (Reproduce Bugs)

**Purpose:** Confirm bugs exist before implementing fixes

**Test Suite:**

```
1. Bug #12 Test - Panel Update Blocking
   - Open Quick Tab Manager
   - Create Quick Tab
   - Minimize Quick Tab via button on Quick Tab window
   - VERIFY: Indicator stays green (BUG)
   - CHECK LOGS: "updateContent skipped: isOpen=false"

2. Bug #13 Test - Minimize Indicator
   - Same as Test 1
   - VERIFY: Yellow indicator not shown (BUG)

3. Bug #14 Test - Close Button
   - Open Quick Tab Manager
   - Create Quick Tab
   - Click X button on Quick Tab window
   - VERIFY: Tab remains in panel list (BUG)
   - CHECK LOGS: No "state:deleted received" log

4. Bug #15 Test - Clear Storage
   - Open Quick Tab Manager
   - Create 2-3 Quick Tabs
   - Click "Clear Storage"
   - Confirm dialog
   - VERIFY: Panel still shows tabs (BUG)
   - CHECK LOGS: "Storage changed while panel closed"

5. Bug #16 Test - Panel Buttons
   - Open Quick Tab Manager
   - Create Quick Tab
   - Click minimize button IN PANEL
   - VERIFY: Nothing happens (BUG)
   - CHECK LOGS: No button click logs appear

6. Bug #20 Test - Stale State
   - Create and minimize Quick Tabs
   - Close panel
   - Wait 5 seconds
   - Re-open panel
   - VERIFY: Shows "0 tabs" instead of correct count (BUG)
```

### Post-Fix Testing (Verify Fixes)

**Purpose:** Confirm all bugs are resolved

**Test Suite:**

```
1. Bug #12 Fix Verification
   - Open Quick Tab Manager
   - Create Quick Tab
   - Minimize Quick Tab
   - VERIFY: Indicator turns yellow immediately ✓
   - CHECK LOGS: "updateContent PROCEEDING" (NOT "skipped")

2. Bug #13 Fix Verification
   - Same as Test 1
   - VERIFY: Yellow indicator appears ✓
   - VERIFY: Panel shows "1 active, 1 minimized" ✓

3. Bug #14 Fix Verification
   - Open Quick Tab Manager
   - Create Quick Tab
   - Click X on Quick Tab window
   - VERIFY: Tab disappears from panel list ✓
   - CHECK LOGS: "state:deleted received" appears

4. Bug #15 Fix Verification
   - Open Quick Tab Manager
   - Create 2-3 Quick Tabs
   - Click "Clear Storage"
   - Confirm
   - VERIFY: Panel shows "No Quick Tabs" ✓
   - CHECK LOGS: "state:cleared received"

5. Bug #16 Fix Verification
   - Open Quick Tab Manager
   - Create Quick Tab
   - Click minimize button IN PANEL
   - VERIFY: Quick Tab minimizes ✓
   - CHECK LOGS: "Button clicked: action=minimize"

6. Bug #20 Fix Verification
   - Create Quick Tabs
   - Close panel
   - Re-open panel
   - VERIFY: Shows correct tab count ✓
   - CHECK LOGS: "Panel opened - loading current state"
```

### Log Verification Checklist

After implementing enhanced logging, verify these logs appear:

```
Panel Opening:
✓ [PanelContentManager] ◈ PANEL OPENED
✓ [PanelContentManager] ◈ Calling updateContent
✓ [PanelContentManager] ► updateContent CALLED
✓ [PanelContentManager] ► UPDATE PROCEEDING

Button Clicks:
✓ [PanelContentManager] ✦ Close All button CLICKED
✓ [PanelContentManager] ✦ Close Minimized button CLICKED
✓ [PanelContentManager] ✦ Clear Storage button CLICKED
✓ [PanelContentManager] ⚡ Quick Tab action DISPATCHED

State Events:
✓ [PanelContentManager] ◆ state:updated EVENT RECEIVED
✓ [PanelContentManager] ◆ state:deleted EVENT RECEIVED
✓ [PanelContentManager] ◆ state:cleared EVENT RECEIVED

Storage Operations:
✓ [PanelContentManager] ◐ Fetching Quick Tabs from storage
✓ [PanelContentManager] ◑ Writing to storage

Failures (if any):
✓ [PanelContentManager] ✗ Operation FAILED
✓ [PanelContentManager] ✗ Error stack: (full trace)
```

---

## Summary of Code Changes Required

### Critical Priority (Fixes User-Reported Bugs)

**1. Fix updateContent() Logic**

**File:** `PanelContentManager.js` (lines 143-165)

**Change:** Pass `forceRefresh: true` in ALL event handlers OR invert the
`isOpen` check logic

**2. Fix setIsOpen() to Always Update on Open**

**File:** `PanelContentManager.js` (lines 131-141)

**Change:** Remove `stateChangedWhileClosed` condition, always call
`updateContent({ forceRefresh: true })` when panel opens

**3. Verify EventBus Emissions**

**Files:** Search for `DestroyHandler.js` or wherever `state:deleted` is emitted

**Change:** Ensure `eventBus.emit('state:deleted', { id, quickTab })` is called
correctly

### High Priority (Enhanced Logging)

**4. Add Logging to All Button Handlers**

**File:** `PanelContentManager.js` (lines 518-590)

**Change:** Add `console.log` at start/end of each button handler with try-catch

**5. Add Logging to State Event Handlers**

**File:** `PanelContentManager.js` (lines 618-747)

**Change:** Add `console.log` BEFORE try-catch in each handler

**6. Add Logging to updateContent()**

**File:** `PanelContentManager.js` (lines 143-165)

**Change:** Add detailed logging showing why update proceeds/skips

### Medium Priority (Code Quality)

**7. Add Error Logging Throughout**

**Files:** All components

**Change:** Wrap ALL risky operations in try-catch with error logging

**8. Add Storage Operation Logging**

**File:** `PanelContentManager.js`

**Change:** Log all storage reads/writes with data

---

## Conclusion

**Root Cause Summary:**

ALL user-reported bugs trace to the `updateContent()` method's `isOpen` check
blocking updates when panel is open. This is because:

1. Event handlers call `updateContent({ forceRefresh: false })`
2. `updateContent()` checks if panel is open via `_getIsOpen()`
3. `_getIsOpen()` returns stale state or incorrect state
4. Update is skipped when it should proceed

**Primary Fix:**

Change ALL event handlers to pass `forceRefresh: true` OR invert the logic in
`updateContent()` to ALWAYS update when panel is open.

**Secondary Fixes:**

1. Always update when panel opens (`setIsOpen()`)
2. Verify EventBus emissions are correct
3. Add extensive logging for debugging

**Testing Strategy:**

1. Implement primary fix first
2. Test ALL bugs to confirm they're resolved
3. Add enhanced logging
4. Test again to verify logging works
5. Monitor logs for any new issues

**Expected Outcome:**

After fixes:

- ✅ Panel updates immediately when Quick Tabs change
- ✅ Minimize indicator turns yellow instantly
- ✅ Close button removes tab from list
- ✅ Clear Storage empties panel list
- ✅ Panel buttons work correctly
- ✅ Panel shows correct state on open

**All bugs should be resolved** with the `updateContent()` logic fix + enhanced
logging for future debugging.
