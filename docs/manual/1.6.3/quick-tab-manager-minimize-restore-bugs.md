# Quick Tab Manager: Minimize/Restore & Keyboard Shortcut Issues

**Extension Version:** v1.6.3.1  
**Date:** 2025-11-29  

<scope>
Investigation of Quick Tab Manager sidebar synchronization failures, minimize/restore lifecycle bugs, and keyboard shortcut functionality. All issues affect user experience when using Quick Tab Manager sidebar while Quick Tabs are open.
</scope>

---

## Executive Summary

The Quick Tab Manager has multiple critical bugs related to the minimize/restore lifecycle and keyboard shortcut integration. The core issues stem from improper handling of `state:updated` events during minimize operations, causing UICoordinator to re-render already-minimized tabs as duplicate visible windows. Additionally, the keyboard shortcut for opening Quick Tab Manager is completely non-functional due to missing command handler implementation in the background script.

**Impact:** Users cannot reliably minimize/restore Quick Tabs, duplicate windows appear and persist, and the dedicated keyboard shortcut does nothing. These bugs collectively make the Quick Tab Manager feature unreliable and confusing.

**Root Context:** Issues introduced in v1.6.3 when cross-tab sync coordinator was removed, and v1.6.3.4 attempted fix for duplicate rendering checked wrong property path.

---

## Issues Overview

| # | Issue | Component | Severity | Root Cause |
|---|-------|-----------|----------|------------|
| 1 | Keyboard shortcut doesn't work | Background Script | Critical | Missing `browser.commands.onCommand` handler |
| 2 | Duplicate 400×300 window after minimize | UICoordinator | Critical | Re-renders minimized tab due to wrong property check |
| 3 | Duplicate persists after "Close All" | UICoordinator / StateManager | High | Duplicate not tracked in StateManager |
| 4 | Restored tab has wrong position/size | MinimizedManager / UICoordinator | High | Duplicate overwrites original window reference |
| 5 | Manager indicator stays yellow after restore | Sidebar (quick-tabs-manager.js) | Medium | Checks both `minimized` AND `visibility.minimized` |

**Why bundled:** All issues affect Quick Tab Manager synchronization and minimize/restore lifecycle. Share storage architecture context and can be fixed in coordinated manner.

<scope>
**Modify:**
- `src/background/` — Add keyboard command handler
- `src/features/quick-tabs/coordinators/UICoordinator.js` — Fix minimized tab property check
- `src/features/quick-tabs/minimized-manager.js` — Preserve position/size data correctly
- `sidebar/quick-tabs-manager.js` — Fix indicator filter logic

**Do NOT Modify:**
- `src/content.js` — Message handlers work correctly
- `src/features/quick-tabs/handlers/VisibilityHandler.js` — Emit logic is correct
- Storage format structure — Must maintain backwards compatibility
</scope>

---

## Issue 1: Keyboard Shortcut Not Working

### Problem
Pressing `Ctrl+Alt+Z` (configured as "toggle-quick-tabs-manager" in manifest.json) does nothing. Sidebar does not open, and no logs indicate the command was received.

### Root Cause

**File:** `src/background/` (missing file)  
**Location:** No `browser.commands.onCommand` listener exists  
**Issue:** The manifest.json defines custom command `toggle-quick-tabs-manager` but background script has NO handler to intercept it. Per Mozilla WebExtensions API documentation, custom commands require explicit `browser.commands.onCommand.addListener()` implementation.

**Evidence from logs:**
- Zero occurrences of keyboard command logs for "toggle-quick-tabs-manager"
- Only `_execute_sidebar_action` would work (different key: `Alt+Shift+S`)
- `_execute_sidebar_action` opens sidebar to default `settings.html` page, not Quick Tab Manager

### Fix Required

Add command listener in background script initialization that:
1. Listens for "toggle-quick-tabs-manager" command
2. Opens sidebar using `browser.sidebarAction.open()`
3. Switches sidebar content to Quick Tab Manager using `browser.sidebarAction.setPanel({ panel: "sidebar/quick-tabs-manager.html" })`

**Note:** `browser.sidebarAction.setPanel()` must be called BEFORE or immediately after `open()` to ensure correct page loads. Cannot be called from command listener directly—must message sidebar or use Promise chain.

---

## Issue 2: Duplicate 400×300 Window After Minimize

### Problem
When user clicks minimize button on Quick Tab window, the tab correctly minimizes and Manager indicator turns yellow, but immediately a duplicate visible window appears in top-left corner at position (0, 0) with size 400×300.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method, lines ~115-120  
**Issue:** The v1.6.3.4 fix attempted to prevent rendering minimized tabs by checking `quickTab.visibility?.minimized`, but the ACTUAL minimized state is stored at TOP-LEVEL property `quickTab.minimized`, not nested in `visibility` object.

**Evidence from logs:**
```
[04:30:38.133Z] [UICoordinator] Received state:updated event {"quickTabId": "qt-121-1764390626078-10nauni1uz89qi"}
[04:30:38.133Z] [WARN] [UICoordinator] Tab not rendered, rendering now: qt-121-1764390626078-10nauni1uz89qi
[04:30:38.134Z] [QuickTabWindow] Rendered: qt-121-1764390626078-10nauni1uz89qi
```

**Sequence of events:**
1. VisibilityHandler.handleMinimize() emits `state:updated` event
2. UICoordinator.update() receives event
3. Check `Boolean(quickTab.visibility?.minimized)` returns FALSE (wrong property)
4. Method calls render() to create new QuickTabWindow
5. createQuickTabWindow() called with defaults: left=0, top=0, width=400, height=300
6. Duplicate window appears visible even though tab is minimized

### Fix Required

Change property check from `quickTab.visibility?.minimized` to `quickTab.minimized` (top-level property). When tab is minimized, UICoordinator must NOT attempt to render it, regardless of `state:updated` event.

**Alternative approach:** Check BOTH `quickTab.minimized` AND `quickTab.visibility?.minimized` with OR logic to handle both legacy and current formats.

---

## Issue 3: Duplicate Persists After "Close All"

### Problem
The duplicate 400×300 window created in Issue #2 remains visible even after clicking "Close All" or "Clear Quick Tab Storage" buttons in Manager sidebar.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `destroy()` method and `renderAll()` lifecycle  
**Issue:** The duplicate window is added to `UICoordinator.renderedTabs` Map but NOT tracked in `StateManager` because the tab is minimized. When "Clear All" executes:
1. Background clears storage → StateManager clears tab list
2. UICoordinator's `renderAll()` or destruction logic should remove windows not in state
3. BUT duplicate's ID exists in `renderedTabs` without corresponding StateManager entry
4. Destruction logic doesn't execute for orphaned entries

**Evidence from logs:**
```
[04:31:54.418Z] [Background] Coordinated clear: Clearing Quick Tab storage once
[04:31:54.430Z] [Background] Storage cleared (empty/missing tabs), clearing cache immediately
[04:31:54.467Z] [Background] Coordinated clear complete: Notified 291 tabs
```
No corresponding `[UICoordinator] Destroying tab` log for duplicate window.

### Fix Required

UICoordinator needs lifecycle validation that destroys rendered tabs NOT present in StateManager after storage clear operations. Implement reconciliation logic that compares `renderedTabs.keys()` against `stateManager.getAll().map(t => t.id)` and destroys orphans.

---

## Issue 4: Restored Tab Has Wrong Position/Size

### Problem
When user clicks "Restore" button in Manager for minimized tab, the restored window appears at position (0, 0) with size 400×300 instead of original position/size before minimization.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `restore()` method, lines 28-50  
**Issue:** MinimizedManager stores full `QuickTabWindow` instance reference, which SHOULD preserve position/size. However, when duplicate window is created in Issue #2, it OVERWRITES the original window's DOM container, corrupting the stored position data.

**Sequence:**
1. Original window at position (991, 257) with size 689×498
2. User minimizes → MinimizedManager stores reference to QuickTabWindow instance
3. Issue #2 bug creates duplicate at (0, 0) / 400×300
4. Duplicate shares same ID, overwrites original's DOM properties
5. MinimizedManager.restore() reads `tabWindow.left/top/width/height` from CORRUPTED instance
6. Restored window uses duplicate's position/size instead of original

**Evidence from logs:**
```
[04:30:38.132Z] [Quick Tab] Minimized - Position: (991, 257), Size: 689x498
[04:57:57.592Z] [MinimizedManager] Restored tab with position: {"id": "...", "left": 991, "top": 257}
```
BUT window actually appears at different position (duplicate's coordinates).

### Fix Required

Ensure MinimizedManager captures and stores position/size as IMMUTABLE snapshot data when minimizing, not relying on live QuickTabWindow instance properties. Alternatively, fix Issue #2 to prevent duplicate creation entirely, which would preserve original instance integrity.

---

## Issue 5: Manager Indicator Stays Yellow After Restore

### Problem
After restoring minimized Quick Tab, Manager sidebar still shows yellow indicator (minimized state) instead of green (active state).

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderUI()` method, lines ~280-285  
**Issue:** Tab filtering logic checks BOTH top-level `minimized` property AND nested `visibility.minimized` property with OR logic. After restore operation:
- Top-level `minimized` may be set to `false`
- BUT `visibility.minimized` might still be `true` in storage (stale data)
- Filter includes tab in BOTH `activeTabs` and `minimizedTabs` arrays simultaneously
- Yellow indicator renders because tab appears in minimizedTabs

**Code pattern causing issue:**
```javascript
const activeTabs = allTabs.filter(t => !t.minimized && !(t.visibility && t.visibility.minimized));
const minimizedTabs = allTabs.filter(t => t.minimized || (t.visibility && t.visibility.minimized));
```

### Fix Required

Choose single source of truth for minimized state. Either:
1. Use ONLY top-level `minimized` property (simpler)
2. OR migrate all minimized state to `visibility.minimized` (structural consistency)
3. OR during restore, ensure BOTH properties are updated atomically

Additionally, add reconciliation logic in `renderUI()` that handles conflicting state gracefully, preferring top-level `minimized` property when discrepancy exists.

---

## Shared Implementation Notes

- All storage writes must include unique `saveId` to prevent hash collision (already implemented)
- Minimize/restore operations must update storage atomically—both top-level AND nested properties if using nested format
- UICoordinator must validate tab state before rendering—check `minimized` flag BEFORE attempting to create QuickTabWindow
- Manager sidebar filters must use consistent property path for minimized state checks
- Backwards compatibility required: Handle tabs saved in v1.6.2 format that may have different property structure

---

<acceptancecriteria>

### Issue 1: Keyboard Shortcut
- Pressing `Ctrl+Alt+Z` opens sidebar to Quick Tab Manager page
- Background logs show command received: `[Background] Command: toggle-quick-tabs-manager`
- Works even when sidebar is already open to Settings page (switches view)

### Issue 2: Duplicate Window
- Minimize button hides Quick Tab window completely
- NO duplicate window appears in top-left corner
- Only Manager indicator updates (turns yellow)

### Issue 3: Duplicate Persistence
- "Close All" button removes ALL Quick Tab windows from screen
- "Clear Quick Tab Storage" button removes ALL Quick Tab windows
- No orphaned windows remain after storage clear

### Issue 4: Restore Position
- Restored Quick Tab appears at SAME position as before minimization
- Restored Quick Tab has SAME size as before minimization
- MinimizedManager logs show correct position values being applied

### Issue 5: Manager Indicator
- Indicator turns GREEN immediately after restore (within 200ms)
- Indicator matches actual Quick Tab visibility state
- Filter logic handles both legacy and current storage formats gracefully

### All Issues
- All existing tests pass
- No new console errors or warnings
- Manual test: Minimize → reload browser → restore → position preserved
- Manual test: Minimize → "Close All" → no windows remain
- Storage format maintains backwards compatibility with v1.6.2 tabs

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Log Evidence: Issue #2 Duplicate Rendering</summary>

**First minimize operation (Hololive Production tab):**
```
[04:30:38.132Z] [Quick Tab] Minimized - Position: (991, 257), Size: 689x498
[04:30:38.133Z] [VisibilityHandler] Minimize button clicked for Quick Tab: qt-121-1764390626078-10nauni1uz89qi
[04:30:38.133Z] [MinimizedManager] Added minimized tab: qt-121-1764390626078-10nauni1uz89qi
[04:30:38.133Z] [UICoordinator] Received state:updated event {"quickTabId": "qt-121-1764390626078-10nauni1uz89qi"}
[04:30:38.133Z] [WARN] [UICoordinator] Tab not rendered, rendering now: qt-121-1764390626078-10nauni1uz89qi
[04:30:38.134Z] [QuickTabWindow] Rendered: qt-121-1764390626078-10nauni1uz89qi
```

**Second minimize operation (Livestreaming tab):**
```
[04:31:13.686Z] [VisibilityHandler] Minimize button clicked for Quick Tab: qt-121-1764390669199-mf52lg1vykxg7
[04:31:13.687Z] [MinimizedManager] Added minimized tab: qt-121-1764390669199-mf52lg1vykxg7
[04:31:13.687Z] [UICoordinator] Received state:updated event {"quickTabId": "qt-121-1764390669199-mf52lg1vykxg7"}
[04:31:13.687Z] [WARN] [UICoordinator] Tab not rendered, rendering now: qt-121-1764390669199-mf52lg1vykxg7
[04:31:13.688Z] [QuickTabWindow] Rendered: qt-121-1764390669199-mf52lg1vykxg7
```

Pattern: **Every** minimize operation triggers duplicate rendering via WARN log.

</details>

<details>
<summary>Log Evidence: Issue #4 Restore Position Corruption</summary>

**Original minimize:**
```
[04:30:38.132Z] [Quick Tab] Minimized - Position: (991, 257), Size: 689x498, ID: qt-121-1764390626078-10nauni1uz89qi
```

**Restore attempt:**
```
[04:57:57.592Z] [Content] Received RESTORE_QUICK_TAB request: qt-121-1764390626078-10nauni1uz89qi
[04:57:57.592Z] [VisibilityHandler] Handling restore for: qt-121-1764390626078-10nauni1uz89qi
[04:57:57.592Z] [MinimizedManager] Restored tab with position: {"id": "qt-121-1764390626078-10nauni1uz89qi", "left": 991, "top": 257}
[04:57:57.592Z] ERROR [Content] Error restoring Quick Tab: TypeError: can't access property "toString", e is undefined
```

Error indicates QuickTabWindow instance is corrupted—likely due to duplicate window overwriting original.

</details>

<details>
<summary>Log Evidence: Issue #3 "Clear All" Doesn't Remove Duplicate</summary>

**Storage clear operation:**
```
[04:31:54.418Z] [Background] Coordinated clear: Clearing Quick Tab storage once
[04:31:54.430Z] [Background] Storage cleared (empty/missing tabs), clearing cache immediately
[04:31:54.467Z] [Background] Coordinated clear complete: Notified 291 tabs
```

**Expected but missing:** `[UICoordinator] Destroying tab: qt-121-1764390669199-mf52lg1vykxg7`

No destruction log for duplicate window, indicating it's not tracked in normal lifecycle.

</details>

<details>
<summary>Architecture Context: Storage Event Flow</summary>

Quick Tab state synchronization relies on this flow:

1. Content script modifies Quick Tab state (minimize/restore/move/resize)
2. Handler calls `persistStateToStorage()` → `browser.storage.local.set()`
3. Background script's `storage.onChanged` listener fires
4. Background updates cached state and broadcasts to all tabs
5. Sidebar's `storage.onChanged` listener fires
6. Sidebar calls `renderUI()` to update Manager display

**Critical dependency:** Manager indicator ONLY updates when storage.local.set() is called. Local state changes without storage write DO NOT trigger Manager updates.

</details>

---

**Priority:** Critical (Issues 1, 2) | High (Issues 3, 4) | Medium (Issue 5)  
**Target:** Fix all in single coordinated PR  
**Estimated Complexity:** Medium  

---

**Additional Notes:**

- Issue #2 is the PRIMARY bug causing cascading failures in Issues #3 and #4
- Fixing Issue #2 may automatically resolve Issue #4 by preventing window corruption
- Issue #1 is independent and can be fixed separately
- Issue #5 is cosmetic but indicates deeper state inconsistency that should be addressed

**Testing Priority:**
1. Fix Issue #2 first (duplicate rendering)
2. Verify Issue #4 resolves automatically
3. Fix Issue #3 lifecycle cleanup
4. Fix Issue #5 indicator logic
5. Implement Issue #1 keyboard shortcut last (independent feature)
