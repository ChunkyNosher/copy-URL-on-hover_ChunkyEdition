# Quick Tabs Manager: Minimize/Restore Architecture Issues

**Extension Version:** v1.6.3.2 | **Date:** 2025-11-30 | **Scope:** Critical state synchronization and DOM lifecycle failures

---

## Executive Summary

Quick Tab minimize/restore operations through the Manager exhibit multiple critical failures including duplicate window creation, incorrect z-indexing, stale Map references, and missing cross-tab functionality. Analysis of console logs and source code reveals architectural issues in the UICoordinator-VisibilityHandler state machine, incomplete Map lifecycle management, and incorrect DOM attachment detection. All issues trace to v1.6.3+ architectural changes where cross-tab sync was removed and rendering authority was consolidated to UICoordinator.

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| #1: Duplicate 400×300 window on minimize | UICoordinator | Critical | Map never cleared on minimize, wrong render path on restore |
| #2: Restored tabs behind other tabs | VisibilityHandler, UICoordinator | High | Z-index not incremented, onFocus() called before DOM exists |
| #3: Cross-tab minimize delay | Content script (browser behavior) | High | Background tab throttling |
| #4: Cross-tab minimize doesn't work | Content script messaging | Critical | Messages not reaching inactive tabs |
| #5: Missing Map cleanup logging | UICoordinator | Medium | No log statements for renderedTabs.delete() |
| #6: DOM attachment check returns truthy object | UICoordinator | Critical | Returns `{}` instead of boolean false |

**Why bundled:** All affect Quick Tab minimize/restore state machine; share UICoordinator/VisibilityHandler architecture; require coordinated fixes to state synchronization flow.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` (update method, render/destroy cleanup)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleMinimize, handleRestore)
- `src/features/quick-tabs/window.js` (isRendered method)
- `src/features/quick-tabs/minimized-manager.js` (snapshot lifecycle)

**Do NOT Modify:**
- `src/background/` (message routing works correctly)
- `src/features/quick-tabs/window/` (DragController, ResizeController)
- `sidebar/quick-tabs-manager.js` (UI rendering works correctly)
</scope>

---

## Issue #1: Duplicate 400×300 Window Appears on Manager Minimize

### Problem
When minimizing Quick Tab via Manager button (not the Quick Tab's own minimize button), a 400×300 duplicate window appears in top-left corner. The duplicate can be closed, then clicking Manager minimize/restore button again shows the original window regardless of yellow/green indicator state.

### Root Cause
**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method (lines 400-460)  
**Issue:** When minimize occurs via Manager, the method detects `inMap: true` + `domAttached: {}` (truthy empty object) and calls normal update path instead of removing the Map entry. When restore happens, it sees `inMap: true` with `instanceMinimized: false` and creates duplicate render because the stale Map entry still exists.

**Secondary Issue:**  
**File:** `src/features/quick-tabs/window.js`  
**Location:** Default dimension constants (lines 14-17)  
**Issue:** The 400×300 size comes from `DEFAULT_WIDTH` and `DEFAULT_HEIGHT` fallback constants used when instance properties are corrupted or missing.

**State Machine Flow:**
1. User clicks Manager minimize button → `MINIMIZE_QUICK_TAB` message sent
2. VisibilityHandler.handleMinimize() → calls tabWindow.minimize() → removes DOM
3. UICoordinator.update() receives state:updated event
4. Detects `inMap: true` + `domAttached: {}` → treats as "normal update" instead of cleanup
5. Map entry persists with `container: null` reference
6. User clicks Manager restore → sees `inMap: true` + `instanceMinimized: false`
7. UICoordinator logic: "Window exists in map, DOM is missing, instance says not minimized → must render!"
8. Creates duplicate window with fallback dimensions because original instance properties corrupted

### Fix Required
UICoordinator.update() must explicitly remove from renderedTabs Map when DOM is detached AND storage entity state is minimized. Add logging for Map cleanup operations. Fix isRendered() or domAttached check to return proper boolean false instead of truthy empty object.

---

## Issue #2: Restored Quick Tabs Always Behind Other Tabs

### Problem
When Quick Tab is restored from minimized state, its z-index is always the base value (1000000) instead of being incremented, causing it to appear behind other Quick Tabs even if it was the most recently interacted with.

### Root Cause
**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleRestore()` method (lines 190-220)  
**Issue:** Method calls `this.onFocus(id)` immediately after calling `tabWindow.restore()`, but the DOM doesn't exist yet because `tabWindow.restore()` only updates instance state without rendering. The onFocus() callback tries to update z-index on non-existent DOM, so the operation is lost.

**Secondary Issue:**  
**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_restoreExistingWindow()` method (lines 285-330)  
**Issue:** When UICoordinator eventually calls render(), it uses entity.zIndex from storage which is the stale base value, not an incremented value.

**Timing Analysis from Logs:**
```
05:29:34.229 - VisibilityHandler: Called tabWindow.restore()
05:29:34.229 - VisibilityHandler: Bringing to front (onFocus called)
05:29:34.443 - UICoordinator: Creating window from entity with zIndex: 1000000
```

The onFocus() call happens 214ms before DOM creation, so z-index update is lost.

### Fix Required
Move onFocus() callback to AFTER UICoordinator confirms DOM render is complete. Alternatively, ensure restored windows get incremented z-index during UICoordinator.render() by reading from global zIndex counter instead of stale storage value.

---

## Issue #3: Cross-Tab Close Has Substantial Delay

### Problem
When closing a Quick Tab via Manager while on a different browser tab than where the Quick Tab exists, there's a 1+ second delay before the Quick Tab actually closes.

### Root Cause
**File:** Browser behavior (not in extension code)  
**Location:** N/A  
**Issue:** Firefox/Chrome throttle content script execution in background tabs. When `CLOSE_QUICK_TAB` message is sent to inactive tab's content script, the browser delays JavaScript execution due to tab suspension policies. This is expected browser behavior for performance optimization.

**Log Evidence:**
```
05:33:55.649 - Content script receives CLOSE_QUICK_TAB request
05:33:55.649 - Content script closes Quick Tab
05:33:56.667 - Background detects storage changed (1+ second later)
```

### Fix Required
This is browser-imposed throttling and cannot be directly fixed. Mitigation options: Add "processing..." indicator in Manager UI when operation is sent to inactive tab, or implement timeout with retry logic for cross-tab operations. Consider whether cross-tab operations are essential use case - if rare, document the limitation instead of adding complexity.

---

## Issue #4: Cross-Tab Minimize Button Doesn't Work

### Problem
When attempting to minimize a Quick Tab via Manager button while on a different browser tab than where the Quick Tab exists, the minimize button does nothing - no state change occurs.

### Root Cause
**File:** Content script messaging (implementation not captured in logs)  
**Location:** Message routing between background script and inactive tab content scripts  
**Issue:** `MINIMIZE_QUICK_TAB` messages sent to background tabs either don't reach the content script, or reach it but the content script is suspended and doesn't process the message. Unlike close operations which eventually complete, minimize operations fail silently.

**Evidence from Logs:**
No logs exist showing `MINIMIZE_QUICK_TAB` messages reaching content scripts on inactive tabs. Only active tab (ID 121) shows minimize message processing.

### Fix Required
Investigate whether minimize messages are being sent to correct tab context. Add logging to background script message routing to verify message delivery. If messages reach content script but aren't processed, this is same root cause as Issue #3 (tab suspension). If messages aren't being sent, fix routing logic to target correct tab ID.

---

## Issue #5: Missing Map Cleanup Logging

### Problem
No log statements exist showing when entries are removed from UICoordinator's `renderedTabs` Map, making debugging of duplicate window and state corruption issues nearly impossible.

### Root Cause
**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Throughout file  
**Issue:** The `update()` method logs Map state checks but never logs when `renderedTabs.delete(id)` is called because those delete operations don't exist in the minimize flow. The `destroy()` method logs removal but minimize operations don't call destroy.

**Missing Logging Points:**
- No log when Map entry should be removed during minimize
- No log verifying Map entry was removed after cleanup
- No log showing Map size before/after operations
- No differentiation between "removed from Map" vs "never was in Map"

### Fix Required
Add comprehensive logging for all Map lifecycle operations: additions, updates, removals, and size changes. Log whenever `renderedTabs.delete()` is called. Log Map size and presence of specific IDs during state transitions.

---

## Issue #6: DOM Attachment Check Returns Truthy Object

### Problem
The UICoordinator's check for whether a window's DOM is attached returns a truthy empty object `{}` instead of boolean `false`, causing conditional logic to incorrectly treat destroyed windows as "attached".

### Root Cause
**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method line 430  
**Issue:** The `domAttached` variable is set from `tabWindow.isRendered()` but logs show it contains `{}` (empty object) instead of `false`. In JavaScript, `{}` is truthy, so conditions like `if (domAttached)` incorrectly evaluate to true.

**Log Evidence:**
```
05:54:03.114 - UICoordinator Update decision: {
  "inMap": true,
  "domAttached": {},        ← Should be false (boolean)
  "entityMinimized": true,
  "instanceMinimized": false,
  "action": "evaluating..."
}
```

**Suspected Implementation:**  
The `isRendered()` method likely returns `this.container && this.container.parentNode` which evaluates to the parentNode object when attached or `null`/`undefined` when detached. The logging serialization converts this to `{}` for objects or properly shows `false`/`null` for falsy values.

### Fix Required
Ensure `isRendered()` always returns strict boolean. Either coerce the return value to boolean using `!!` operator, or change the check to explicitly return `true` or `false` based on DOM presence. Update logging to clearly show "attached: true/false" instead of serializing objects.

---

## Shared Implementation Notes

**Map Lifecycle Pattern:**
The `renderedTabs` Map must follow strict lifecycle: add on render() → update references → remove on minimize OR destroy. Currently, minimize doesn't remove from Map, causing stale references.

**State Machine Authority:**
UICoordinator is the single rendering authority per v1.6.3.2 architecture. All render/destroy decisions must flow through UICoordinator.update() based on entity state. The current implementation has gaps where minimize state changes don't properly trigger Map cleanup.

**Z-Index Management:**
Global z-index counter should be incremented before ANY render operation, not just on focus events. Restored windows should receive fresh z-index from counter, not stale value from storage.

**Snapshot Lifecycle:**
MinimizedManager correctly implements two-phase snapshot lifecycle (active → pending-clear → deleted), but UICoordinator doesn't consistently call `clearSnapshot()` after render confirmation. This can leave snapshots in pending state indefinitely.

**Cross-Tab Operations:**
Browser tab suspension is expected behavior. If cross-tab operations are critical, implement fallback using background script to track Quick Tab states independently of content script availability.

<acceptance_criteria>
**Issue #1:**
- [ ] Minimize via Manager button removes entry from renderedTabs Map
- [ ] Restore via Manager button creates exactly one window with correct dimensions (960×540 or last saved size)
- [ ] No 400×300 duplicate windows appear under any circumstance
- [ ] Log shows: "[UICoordinator] Removed from renderedTabs Map during minimize: qt-xxx"

**Issue #2:**
- [ ] Restored Quick Tabs receive incremented z-index (e.g., 1000010, 1000011)
- [ ] Most recently restored tab appears in front of other tabs
- [ ] Z-index updates apply even when restore happens via Manager on different tab
- [ ] Log shows: "[UICoordinator] Applied incremented z-index XXXXX to restored tab: qt-xxx"

**Issue #3:**
- [ ] Cross-tab close operations complete within 2 seconds (document limitation in user-facing docs if delay persists)
- [ ] OR: Manager shows "processing..." indicator during cross-tab operations
- [ ] No silent failures - either operation completes or user sees timeout message

**Issue #4:**
- [ ] Minimize messages successfully reach content scripts on inactive tabs
- [ ] OR: Manager disables minimize button for tabs on inactive browser tabs with tooltip explaining limitation
- [ ] Log shows: "[Content] Received MINIMIZE_QUICK_TAB on inactive tab: XXX"

**Issue #5:**
- [ ] Logs show every renderedTabs.delete() operation with tab ID and reason (minimize/destroy/cleanup)
- [ ] Logs show Map size before/after operations
- [ ] Logs differentiate between "removed from Map" and "not in Map"
- [ ] Example: "[UICoordinator] renderedTabs.delete(qt-xxx) | reason: minimize | mapSize: 3 → 2"

**Issue #6:**
- [ ] domAttached check returns strict boolean (true/false, never object/null/undefined)
- [ ] Logs show: "domAttached: true" or "domAttached: false" (never "domAttached: {}")
- [ ] Conditional logic correctly identifies detached DOM as falsy

**All Issues:**
- [ ] Manual test: minimize via Manager → restore via Manager → correct window appears exactly once
- [ ] Manual test: minimize via Manager → close duplicate (if any) → restore via Manager → window appears
- [ ] Manual test: create 3 Quick Tabs → minimize all → restore in sequence → z-indexing is correct (last restored is frontmost)
- [ ] All existing unit tests pass
- [ ] No new console errors or warnings during minimize/restore cycles
</acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Detailed Log Analysis</summary>

**Minimize via Quick Tab UI Button (WORKS CORRECTLY):**
```
05:29:33.120 - VisibilityHandler: Minimize button clicked
05:29:33.120 - QuickTabWindow: Removed DOM element for minimize
05:29:33.120 - UICoordinator: Update decision: {
  "inMap": false,              ← Not in map (was removed during minimize)
  "entityMinimized": true,
  "action": "skip (minimized)"
}
```
UICoordinator correctly skips render because `inMap: false`.

**Minimize via Quick Tab Manager Button (BROKEN):**
```
05:54:03.114 - Content: Received MINIMIZE_QUICK_TAB request
05:54:03.114 - VisibilityHandler: Minimize button clicked
05:54:03.114 - QuickTabWindow: Removed DOM element for minimize
05:54:03.114 - UICoordinator: Update decision: {
  "inMap": true,               ← Still in map!
  "domAttached": {},           ← Truthy empty object
  "entityMinimized": true,
  "instanceMinimized": false,
  "action": "evaluating..."
}
05:54:03.114 - UICoordinator: Update decision: normal update
```

The key difference: When minimizing via Manager, the window stays in renderedTabs Map with corrupted `domAttached` value. This causes wrong code path on subsequent restore.

**Subsequent Restore After Manager Minimize:**
```
05:54:17.823 - Content: Received MINIMIZE_QUICK_TAB request (user clicked again)
05:54:17.823 - UICoordinator: Update decision: {
  "inMap": true,
  "domAttached": false,          ← NOW correctly false
  "entityMinimized": true,
  "instanceMinimized": false,
  "action": "evaluating..."
}
05:54:17.823 - UICoordinator: Instance NOT minimized but DOM missing, MUST render
05:54:17.823 - UICoordinator: Creating window from entity: {
  "rawPosition": { "left": 387, "top": 333 },
  "rawSize": { "width": 960, "height": 540 }   ← Correct size read from snapshot
}
```

But somehow the rendered window appears as 400×300. This suggests either:
1. Snapshot values are corrupted between read and render
2. Fallback constants are triggered due to validation failure
3. CSS or layout system overrides applied dimensions

The 400×300 values match `DEFAULT_WIDTH` and `DEFAULT_HEIGHT` in window.js:14-17.
</details>

<details>
<summary>Issue #2: Z-Index Timing Analysis</summary>

**First Restore (works correctly):**
```
05:29:34.229 - VisibilityHandler: Called tabWindow.restore()
05:29:34.229 - VisibilityHandler: Bringing to front (onFocus)
05:29:34.443 - UICoordinator: Creating window with zIndex: 1000000
05:29:34.444 - QuickTabWindow: Rendered
```

**Second Restore (z-index not incremented):**
```
05:54:04.563 - VisibilityHandler: Called tabWindow.restore()
05:54:04.563 - VisibilityHandler: Bringing to front (onFocus)
05:54:04.773 - UICoordinator: Creating window with zIndex: 1000000
```

Both restores use the same z-index value from storage. The global z-index counter is never incremented during restore flow. Only drag operations increment the counter:

```
05:29:32.166 - QuickTabWindow: Drag started
05:29:32.166 - VisibilityHandler: Bringing to front (increments counter)
```

The pattern shows z-index is only incremented on drag/focus events, not on restore events. Restored windows need to trigger the same z-index increment logic.
</details>

<details>
<summary>Issue #6: JavaScript Truthy Object Behavior</summary>

In JavaScript, all objects are truthy including empty objects:
```javascript
if ({}) {
  console.log("This executes"); // ✓ {} is truthy
}

if (false) {
  console.log("This does not execute"); // ✗ false is falsy
}
```

The isRendered() method implementation:
```javascript
isRendered() {
  return this.rendered && this.container && this.container.parentNode;
}
```

When DOM is detached, `this.container` is `null`, so the expression returns `null`. When logging serializes this, it may show as `{}` if there's intermediate object access that creates temporary objects.

**Proper Implementation:**
```javascript
isRendered() {
  return Boolean(this.rendered && this.container && this.container.parentNode);
}
```

Or explicit true/false:
```javascript
isRendered() {
  if (!this.rendered || !this.container) return false;
  return this.container.parentNode !== null;
}
```
</details>

<details>
<summary>Architecture Context: v1.6.3 Rendering Authority Changes</summary>

Prior to v1.6.3, both MinimizedManager.restore() and UICoordinator.update() would call rendering methods, causing duplicate windows. The v1.6.3 refactor attempted to fix this by making UICoordinator the single rendering authority:

**Intended Flow:**
1. VisibilityHandler.handleRestore() → applies snapshot to instance properties
2. Emits state:updated event
3. UICoordinator.update() detects restore needed → calls render()

**Current Broken Flow:**
1. VisibilityHandler.handleRestore() → applies snapshot
2. Emits state:updated event (200ms delay)
3. UICoordinator.update() sees `inMap: true` → wrong code path
4. Creates duplicate render because Map was never cleaned up on minimize

The architectural intent was correct but implementation gaps in Map lifecycle management broke the state machine. The minimize flow was never updated to remove Map entries, leaving stale references that corrupt the restore flow.
</details>

---

**Priority:** Critical (Issues #1, #4, #6), High (Issues #2, #3), Medium (Issue #5)  
**Target:** Single coordinated PR for Issues #1, #2, #5, #6; separate investigation for Issues #3, #4  
**Estimated Complexity:** High (requires state machine refactoring)
