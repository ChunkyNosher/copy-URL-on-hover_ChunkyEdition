# Quick Tabs - Multiple Critical State Synchronization Bugs

**Extension Version**: v1.6.3.2  
**Date**: 2025-11-30  
**Scope**: Quick Tab minimize/restore operations, Manager UI sync, window lifecycle, z-indexing

---

## Executive Summary

Quick Tab restore operations fail catastrophically after the FIRST minimize/restore cycle, causing duplicate 400×300 windows, incorrect Manager indicators, broken z-index stacking, and ghost Quick Tabs. Analysis of extension logs reveals **nine distinct root causes** across VisibilityHandler, UICoordinator, QuickTabWindow, and DestroyHandler that prevent proper state synchronization. All issues trace to instance tracking loss, stale Map entries, and missing storage persistence introduced when v1.6.3 removed cross-tab sync coordinator.

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| 1 | Instance tracking loss | VisibilityHandler | **Critical** | QuickTabWindow reference lost from Map after first restore |
| 2 | Stale Map entries | UICoordinator | **Critical** | `inMap: true` + `domAttached: true` even when DOM removed by minimize |
| 3 | Third minimize cleanup | UICoordinator | **High** | Map eventually cleans up inconsistently (timing issue) |
| 4 | Z-index never increments | UICoordinator | **High** | Restored windows get base z-index (1000000) from storage, not current |
| 5 | DOM detachment detection | UICoordinator | **High** | `domAttached` check returns truthy when container is null |
| 6 | Close button bypass | QuickTabWindow/DestroyHandler | **Critical** | UI close button calls destroy() but never invokes DestroyHandler |
| 7 | Map never decrements | UICoordinator | **Critical** | `renderedTabs.size` grows indefinitely, never cleaned on close |
| 8 | DOM detaches post-restore | Browser/QuickTabWindow | **High** | Restored DOM becomes detached shortly after render (GC issue) |
| 9 | Drag doesn't bring to front | VisibilityHandler/DragController | **Medium** | No "bring to front" call during restored tab drag operations |

**Why bundled**: All affect Quick Tab restore/visibility lifecycle; share UICoordinator rendering authority and StateManager/Map architecture; introduced by v1.6.3 refactor that removed cross-tab sync; can be fixed in coordinated PR.

<scope>
**Modify**:
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleMinimize, handleRestore, instance tracking)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (update, render, Map lifecycle)
- `src/features/quick-tabs/window.js` (destroy, isRendered, close button binding)
- `src/features/quick-tabs/handlers/DestroyHandler.js` (handleDestroy invocation path)

**Do NOT Modify**:
- `src/background/` (out of scope)
- `sidebar/quick-tabs-manager.js` (reactive read-only view, receives storage changes)
</scope>

---

## Issue 1: "Tab not found" Errors on Second+ Minimize/Restore

**Problem**: After the FIRST successful minimize/restore cycle, all subsequent minimize/restore operations log `Tab not found for minimize` and `Tab not found in minimized manager` warnings. The operations appear to complete, but the QuickTabWindow instance is missing from VisibilityHandler's tracking.

**Root Cause**:

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `handleMinimize` lines 136-203, `handleRestore` lines 249-337  
Issue: After first restore completes, VisibilityHandler loses the QuickTabWindow reference from `this.quickTabsMap`. When second minimize is attempted, `this.quickTabsMap.get(id)` returns `undefined`. The log shows warnings but operations complete using only storage state, bypassing window instance methods entirely.

**Log Evidence (Second Minimize Attempt)**:
```
17:06:44.995 - VisibilityHandler: Minimize button clicked for Quick Tab qt-...1294jc4k13j2u
17:06:44.995 - WARN VisibilityHandler: Tab not found for minimize qt-...1294jc4k13j2u
17:06:44.995 - Content: Minimized Quick Tab qt-...1294jc4k13j2u
17:06:45.173 - Background: Storage changed (quicktabsstatev2)
```

Notice: No `tabWindow.minimize()` call, no MinimizedManager snapshot creation, just storage write.

**Fix Required**: VisibilityHandler must maintain QuickTabWindow reference across minimize/restore cycles. Investigate why `quickTabsMap.get(id)` returns undefined after first restore when the window instance still exists in UICoordinator's `renderedTabs` Map. Likely missing re-registration after UICoordinator creates new window during restore render.

---

## Issue 2: UICoordinator Shows `inMap: true` + `domAttached: true` During Second Minimize

**Problem**: When user clicks Manager minimize button for the SECOND time on same Quick Tab, UICoordinator's update decision shows `inMap: true, domAttached: true, entityMinimized: true, instanceMinimized: false` even though `tabWindow.minimize()` just removed the DOM. This causes "normal update" path instead of Map cleanup.

**Root Cause**:

File: `src/features/quick-tabs/coordinators/UICoordinator.js`  
Location: `update` method lines 347-462  
Issue: The `domAttached` check at line 394 (`tabWindow.isRendered()`) evaluates to `true` immediately after minimize removes DOM. This prevents the Map deletion logic from executing. UICoordinator takes the "normal update" path at lines 436-447, updating an entry that should have been removed.

**Log Evidence (Second Minimize via Manager)**:
```
17:06:45.008 - UICoordinator: Update decision: {
  "inMap": true,
  "domAttached": true,        ← Should be false (DOM just removed)
  "entityMinimized": true,
  "instanceMinimized": false,
  "action": "evaluating..."
}
17:06:45.008 - UICoordinator: Update decision: normal update
17:06:45.008 - UICoordinator: Updating tab qt-...1294jc4k13j2u
```

This stale Map entry with `domAttached: true` prevents subsequent restores from working correctly.

**Fix Required**: The `isRendered()` check timing is wrong. When `tabWindow.minimize()` is called (which removes DOM), the subsequent `update()` call must detect DOM detachment and delete the Map entry. Current implementation may be checking DOM attachment before minimize completes, or `isRendered()` is caching stale state. Add explicit DOM re-verification after state changes.

---

## Issue 3: Third Minimize Shows `inMap: false` (Delayed Cleanup)

**Problem**: By the THIRD minimize operation on the same Quick Tab, UICoordinator suddenly shows `inMap: false` with proper cleanup. This inconsistent timing suggests race condition or delayed garbage collection.

**Root Cause**:

File: `src/features/quick-tabs/coordinators/UICoordinator.js`  
Location: `update` method lines 347-400  
Issue: Map cleanup that should happen on second minimize mysteriously occurs by third operation. Log shows `inMap: false, entityMinimized: true, action: "skip (minimized)"` at 17:06:51.493, suggesting something eventually triggers Map deletion between second and third minimize, but it's not the expected code path.

**Log Evidence (Third Minimize)**:
```
17:06:51.493 - UICoordinator: Update decision: {
  "inMap": false,              ← Now correctly cleaned up
  "entityMinimized": true,
  "mapSize": 2,
  "action": "skip (minimized)"
}
```

**Fix Required**: Identify what causes delayed Map cleanup between operations. Likely a DOM monitoring interval or garbage collection trigger that eventually removes stale entries. This timing dependency creates unpredictable restore behavior (sometimes works, sometimes creates duplicates). Need consistent immediate cleanup on minimize.

---

## Issue 4: Restored Windows Always Get Base Z-Index (1000000)

**Problem**: All restored Quick Tabs receive `zIndex: 1000000` (base value) instead of incrementing from current highest z-index. Drag operations correctly increment z-index (1000001, 1000002...), but restore operations reset to base value from storage.

**Root Cause**:

File: `src/features/quick-tabs/coordinators/UICoordinator.js`  
Location: `_createWindow` method lines 605-632, `_restoreExistingWindow` lines 523-585  
Issue: When creating window from entity during restore, `_getSafeZIndex` at line 590 reads `quickTab.zIndex ?? CONSTANTS.QUICK_TAB_BASE_Z_INDEX` which returns the base value (1000000) from storage. The z-index increments from drag operations are never persisted to storage, so restores always use stale base value.

**Log Evidence (All Restore Operations)**:
```
17:06:29.032 - UICoordinator: Creating window from entity... zIndex: 1000000
17:06:30.306 - UICoordinator: Creating window from entity... zIndex: 1000000
17:06:49.345 - UICoordinator: Creating window from entity... zIndex: 1000000
```

Notice: Every restore uses 1000000, never increments. Drag operations show increments (1000001, 1000002) but these are lost on minimize.

**Fix Required**: Current z-index must be persisted to storage when drag operations increment it. Alternatively, UICoordinator should maintain "current highest z-index" in memory and apply it during restore instead of reading from stale storage. Storage persistence of z-index is the robust solution to survive browser restarts.

---

## Issue 5: `domAttached` Check Returns Truthy When Container is Null

**Problem**: UICoordinator's `domAttached` variable evaluates to truthy value even when `tabWindow.container` is null, preventing proper Map cleanup detection.

**Root Cause**:

File: `src/features/quick-tabs/window.js`  
Location: `isRendered` method lines 622-627  
Issue: Method returns `this.rendered && this.container && this.container.parentNode` which evaluates to the `parentNode` object (truthy) when attached, but when detached the AND chain should return `false` (Boolean). If `parentNode` is an empty object `{}` instead of `null`, the check incorrectly returns truthy. Bug introduced in v1.6.4.10 fix attempt.

**Log Evidence (Context)**:
```
17:06:47.869 - UICoordinator: Update decision: {
  "domAttached": true,         ← DOM is actually null
  "entityMinimized": false,
  "instanceMinimized": false
}
```

**Fix Required**: The `isRendered()` method must return explicit Boolean `false` when container is detached, not a truthy object reference. Wrap the entire expression in `Boolean()` or use `!!` to ensure strict boolean return. Current implementation from v1.6.4.10 attempted this fix but the AND chain may still leak truthy objects in edge cases.

---

## Issue 6: Quick Tab UI Close Button Doesn't Trigger DestroyHandler

**Problem**: Clicking the `✕` close button on a Quick Tab window removes the DOM and calls `destroy()`, but DestroyHandler is never invoked. Storage is never updated, so Manager continues showing the closed tab as active indefinitely.

**Root Cause**:

File: `src/features/quick-tabs/window.js`  
Location: `destroy` method lines 657-690, titlebar close button binding (TitlebarBuilder)  
Issue: The close button's `onClick` handler directly calls `this.destroy()` on the QuickTabWindow instance. This method removes DOM, cleans up controllers, and sets `this.destroyed = true`, but never calls `DestroyHandler.handleDestroy()`. The `onDestroy` callback at line 689 is invoked, but this callback is NOT wired to DestroyHandler in the current architecture.

**Log Evidence (UI Close Button Click)**:
```
17:06:57.442 - QuickTabWindow: Destroying qt-...1f5r09s9wvia8
17:06:57.442 - QuickTabWindow: Cleaned up drag controller
17:06:57.442 - QuickTabWindow: Cleaned up resize controller
17:06:57.716 - QuickTabWindow: Removed DOM element
17:06:57.716 - QuickTabWindow: Destroyed qt-...1f5r09s9wvia8
```

**MISSING**: No `DestroyHandler: Closing Quick Tab` log, no storage persist, no `renderedTabs.delete()`.

**Fix Required**: The `onDestroy` callback passed to QuickTabWindow during construction must be wired to `DestroyHandler.handleDestroy(id)`. Currently, CreateHandler constructs windows with callbacks for minimize/focus/etc but the destroy callback path is disconnected. Ensure destroy button → `tabWindow.destroy()` → `onDestroy(id)` → `DestroyHandler.handleDestroy(id)` chain is complete.

---

## Issue 7: `renderedTabs` Map Size Never Decrements on Close

**Problem**: UICoordinator's `renderedTabs` Map grows indefinitely. After closing Quick Tabs via UI button, Map size stays constant or inconsistently decrements. After THREE windows destroyed, Map still shows `mapSize: 3` or `mapSize: 2`.

**Root Cause**:

File: `src/features/quick-tabs/coordinators/UICoordinator.js`  
Location: `destroy` method lines 491-525, Map deletion at line 519  
Issue: The `destroy` method is never called when user clicks UI close button (see Issue #6). When destroy IS called (e.g., via Manager's close button or closeAll), the Map deletion at line 519 executes, but there's no corresponding call path from UI button. Map entries accumulate as ghost references.

**Log Evidence (Map Size Tracking)**:
```
17:06:29.033 - renderedTabs.set... mapSizeBefore: 0, mapSizeAfter: 1
17:06:30.308 - renderedTabs.set... mapSizeBefore: 1, mapSizeAfter: 2
17:06:49.347 - renderedTabs.set... mapSizeBefore: 2, mapSizeAfter: 3
17:06:59.114 - renderedTabs.set... mapSizeBefore: 2, mapSizeAfter: 3   ← Same after close?
```

No `renderedTabs.delete()` logs after close operations. Map never shrinks.

**Fix Required**: Link Issue #6 fix (wire destroy callback) to ensure `UICoordinator.destroy(id)` is called when UI button clicked. Additionally, add logging to all Map operations (`set`, `delete`, `clear`) with before/after sizes to track lifecycle. Current logging exists but is incomplete.

---

## Issue 8: Restored Window DOM Detaches Shortly After Render

**Problem**: After successful restore renders DOM and passes immediate verification, the DOM becomes detached within seconds (observed 1.5-73 seconds later). UICoordinator's periodic DOM check detects detachment and logs warning, but it's too late—user sees duplicate 400×300 window.

**Root Cause**:

File: Browser garbage collection / `src/features/quick-tabs/window.js` + `UICoordinator.js`  
Location: `render` method lines 167-268 (QuickTabWindow), periodic monitoring lines 431-467 (UICoordinator)  
Issue: Restored windows may have weak references or event listener issues that cause browser to garbage collect the DOM element. The container is removed from `document.body.appendChild()` at some point after render completes. v1.6.4.9 added periodic DOM monitoring (500ms intervals for 5 seconds) but this only detects detachment AFTER it happens, not prevents it.

**Log Evidence (Delayed Detachment)**:
```
17:07:00.445 - WARN UICoordinator: Periodic DOM check detected detachment: {
  "id": "qt-...1294jc4k13j2u",
  "checkNumber": 3,
  "elapsedMs": 1500                ← Detached 1.5 seconds after render
}
```

**Fix Required**: Investigate why restored DOM elements become detached. Possible causes:
1. Event listeners removed incorrectly during minimize, not re-attached on restore
2. Circular references between window instance and DOM causing premature GC
3. Multiple restore operations creating conflicting DOM trees
4. Browser removing orphaned iframes with same src URL

Add stronger DOM attachment (use DocumentFragment or ensure container never loses parentNode reference). Consider making UICoordinator hold explicit DOM reference to prevent GC.

---

## Issue 9: Drag Operations Don't Bring Restored Tabs to Front

**Problem**: Newly created Quick Tabs show "Bringing to front" logs during drag start. Restored Quick Tabs do NOT show these logs when dragged, causing z-index to remain at base value (1000000) instead of incrementing.

**Root Cause**:

File: `src/features/quick-tabs/window/DragController.js` + `src/features/quick-tabs/window.js`  
Location: Drag initialization lines 231-253 (QuickTabWindow render method)  
Issue: DragController's `onDragStart` callback calls `this.onFocus(this.id)` at line 239, which should trigger VisibilityHandler to bring window to front. For restored windows, this callback chain may be broken or the DragController is not re-initialized properly after restore creates new DOM.

**Log Evidence (Comparison)**:
```
// Newly created tab - shows "bring to front" on drag
17:06:22.400 - QuickTabWindow: Drag started qt-...1294jc4k13j2u
17:06:22.400 - VisibilityHandler: Bringing to front qt-...1294jc4k13j2u

// Restored tab - NO "bring to front" logs during subsequent drags
17:06:31.xxx - QuickTabWindow: Drag started qt-...1294jc4k13j2u
(missing VisibilityHandler logs)
```

**Fix Required**: When UICoordinator renders restored window, ensure DragController is fully initialized with correct callbacks. The `onFocus` callback must be wired to VisibilityHandler's `handleFocus` method. Current code at QuickTabWindow.render() lines 231-253 sets up DragController, but if render() is called during restore, verify all callbacks are re-established.

---

## Missing Logging

The following critical operations have no logging, making debugging impossible:

1. **`renderedTabs.delete()` during UI close button**: Map cleanup completely absent (Issue #6 symptom)
2. **DestroyHandler invocation path**: No logging showing WHY `handleDestroy` is/isn't called from UI button
3. **`domAttached` boolean evaluation**: No logging showing actual `true`/`false` value vs truthy object (Issue #5)
4. **Map size before/after ALL operations**: Current logging incomplete, missing close/destroy paths
5. **Window instance tracking in VisibilityHandler**: No logging when `quickTabsMap.get(id)` returns `undefined` explaining WHY reference was lost (Issue #1)

**Fix Required**: Add debug logs at:
- Every `renderedTabs.delete()` call site with reason and before/after sizes
- DestroyHandler entry points showing call source (UI button vs Manager vs closeAll)
- `isRendered()` method showing `this.container`, `this.parentNode`, return value
- VisibilityHandler Map operations (`get`, `set`, `delete`) to track instance lifecycle

---

<acceptancecriteria>
**Issue 1 (Instance Tracking)**:
- Second minimize operation finds QuickTabWindow reference in VisibilityHandler
- Logs show `Tab found for minimize` instead of `Tab not found`
- No warnings during second+ restore operations

**Issue 2 (Stale Map)**:
- Second minimize shows `inMap: true, domAttached: false` (correct DOM state)
- UICoordinator deletes Map entry when DOM detached + entity minimized
- No "normal update" path during minimize operations

**Issue 3 (Delayed Cleanup)**:
- Map cleanup happens immediately on minimize, not delayed until third operation
- Consistent `inMap: false` on ALL minimize operations after cleanup

**Issue 4 (Z-Index)**:
- Restored windows receive incremented z-index, not base value
- Z-index persists to storage when drag operations increment it
- Subsequent restores use last saved z-index from storage

**Issue 5 (DOM Attached Check)**:
- `isRendered()` returns strict Boolean `false` when container is null
- No truthy object leakage from `parentNode` reference

**Issue 6 (Close Button)**:
- UI close button triggers DestroyHandler invocation
- Storage updated when UI button clicked (Manager reflects closure within 200ms)
- Logs show full chain: `QuickTabWindow.destroy` → `DestroyHandler.handleDestroy` → storage persist

**Issue 7 (Map Lifecycle)**:
- `renderedTabs` Map decrements size when Quick Tabs closed via UI button
- Logs show `renderedTabs.delete()` with before/after sizes for ALL close operations
- Map size matches actual number of rendered Quick Tabs

**Issue 8 (DOM Detachment)**:
- Restored windows remain attached for entire session (no periodic detachment warnings)
- UICoordinator's DOM monitoring shows stable attachment for restored windows
- No duplicate 400×300 windows appear after restore

**Issue 9 (Drag Z-Index)**:
- Restored tabs show "Bringing to front" logs when dragged
- Z-index increments on drag of restored windows, not just newly created windows
- All Quick Tabs respond to drag with same z-index behavior

**All Issues**:
- All existing tests pass
- No new console errors or warnings
- Manual test: Create 3 Quick Tabs → Minimize all → Restore all → Minimize all → Restore all → Close all → Manager shows 0 tabs, no DOM elements remain
</acceptancecriteria>

---

<details>
<summary>Storage Architecture Context</summary>

**Manager's Reactive Data Flow**:

Quick Tab Manager (`sidebar/quick-tabs-manager.js`) is a **reactive read-only view** of `browser.storage.local`. It does NOT maintain independent state.

```
Content Script (Quick Tab operations)
         ↓
  browser.storage.local.set('quickTabsStateV2')
         ↓
  storage.onChanged event fires
         ↓
Quick Tab Manager (listener at line 631)
         ↓
  loadQuickTabsState() re-reads ENTIRE state
         ↓
  renderUI() updates display
```

Additionally, Manager polls storage every 2 seconds (line 53) as fallback.

**Critical Implication**: When content script performs operation (minimize, restore, close) but does NOT update storage, Manager's `onChanged` listener never fires. Manager continues showing stale data from its last read, even though DOM was destroyed in content script.

This is why Issue #6 (close button doesn't update storage) causes Manager to show closed tabs indefinitely—storage was never modified, so Manager has no signal to refresh.

**Reference**: [MDN storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged) - Event only fires when storage API methods (`set`, `remove`, `clear`) are called, NOT on local state changes.
</details>

<details>
<summary>UICoordinator Rendering Authority</summary>

v1.6.3.2 established UICoordinator as the **single rendering authority**. QuickTabWindow methods (`minimize()`, `restore()`) update instance state but do NOT render DOM.

**Minimize Flow**:
1. User clicks minimize → VisibilityHandler.handleMinimize
2. VisibilityHandler calls `tabWindow.minimize()` (removes DOM, sets `minimized: true`)
3. VisibilityHandler emits `state:updated` event
4. UICoordinator receives event, sees `entityMinimized: true`, skips render

**Restore Flow**:
1. User clicks restore → VisibilityHandler.handleRestore
2. VisibilityHandler calls `tabWindow.restore()` (sets `minimized: false`, does NOT render)
3. VisibilityHandler emits `state:updated` event
4. UICoordinator receives event, detects `inMap: false` or `domAttached: false`, calls `render()`

**The Bug**: Step 4 in restore flow fails when `inMap: true` + `domAttached: true` (Issue #2). UICoordinator takes "normal update" path instead of render, so no DOM is created. QuickTabWindow has `minimized: false` but no container. Subsequent restore attempts see existing Map entry and skip render.

</details>

---

**Priority**: Critical  
**Target**: Single coordinated PR addressing all 9 issues  
**Estimated Complexity**: High (multiple interacting components)
