# Quick Tabs Restore Operation - Callback Wiring & Z-Index Failures

**Extension Version:** v1.6.3.5-v9  
**Date:** 2025-12-03  
**Scope:** Critical bugs affecting restored Quick Tabs - position/size updates stop working, z-index broken, storage corruption

---

## Executive Summary

Quick Tabs that have been minimized and then restored exhibit **2 critical callback wiring failures** that prevent core functionality from working. After restore, dragging or resizing the Quick Tab window no longer persists changes to storage, and the restored window appears visually behind newly created windows despite having a numerically higher z-index. 

**Root cause:** UICoordinator's restore path creates a fresh QuickTabWindow instance via `_createWindow()` but **does not pass lifecycle callbacks** (`onPositionChangeEnd`, `onSizeChangeEnd`, `onFocus`) in the options object. The fresh instance has DragController and ResizeController wired to internal callbacks, but those callbacks have **no connection** to UpdateHandler or VisibilityHandler. This is a **fundamental architecture gap** where the restore path bypasses the normal callback wiring performed by QuickTabsManager during initial creation.

Additionally, **6+ content script instances** from other browser tabs continuously write empty state to storage, creating a 2→0→2→0 oscillation cycle that destabilizes state for 1-2 seconds after every operation.

## Issues Overview

| # | Issue | Component | Severity | Root Cause |
|---|-------|-----------|----------|------------|
| 1 | Position updates stop after restore | UICoordinator/UpdateHandler | **Critical** | Callbacks not passed to createQuickTabWindow() during restore |
| 2 | Size updates stop after restore | UICoordinator/UpdateHandler | **Critical** | Same - callbacks missing from options object |
| 3 | Z-index broken - restored tab behind new tabs | UICoordinator/VisibilityHandler | **Critical** | onFocus callback not wired + z-index set before appendChild |
| 4 | Storage corruption from other tabs | Content Scripts (all tabs) | High | Other tabs write empty state during restore operations |

**Why bundled:** All issues stem from UICoordinator's restore path bypassing normal initialization flow. Can be fixed by ensuring callback wiring happens during `_createWindow()` call or by re-wiring callbacks after fresh instance creation.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` - `_createWindow()` method to include callbacks in options, OR add callback re-wiring after instance creation
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Add explicit z-index bump + focus operation AFTER restore render completes
- `src/features/quick-tabs/managers/QuickTabsManager.js` - May need to expose callback wiring method for restore path
- `src/features/quick-tabs/window.js` - Verify z-index applied AFTER appendChild, not before

**Do NOT Modify:**
- `src/features/quick-tabs/window/DragController.js` - Event wiring is correct
- `src/features/quick-tabs/window/ResizeController.js` - Event wiring is correct  
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Callback implementation is correct
- Storage write queue implementation - Working as designed
</scope>

---

## Issue #1: Position Updates Stop Working After Restore

### Problem
After restoring a minimized Quick Tab, dragging the window no longer persists position changes to storage. The window moves visually but Manager UI does not update, and position reverts to pre-drag value after page reload.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_createWindow()` method (called during restore path)  
**Issue:** The options object passed to `createQuickTabWindow()` does **not include** the `onPositionChangeEnd` callback that connects DragController to UpdateHandler.

**Evidence from logs (timestamp 03:59:56.353):**
```
UICoordinator: Creating NEW window instance qt-629-1764820788407-1t3f7wc1mswtxp
UICoordinator: Creating window from entity, zIndex = 1000008
QuickTabWindow: render() called with dimensions...
QuickTabWindow: Wiring DragController callbacks
```

**Critical observation:** The "Wiring DragController callbacks" log shows callbacks ARE wired, but there is **NO log** showing what those callbacks are or where they point.

**Comparison - Initial creation (timestamp 03:59:46.743):**
```
CreateHandler: Tab options id qt-629-1764820786743-agkuza1yw0d5y, url ..., 
  onPositionChangeEnd: function, onSizeChangeEnd: function, onFocus: function
```

**Comparison - Restore creation (timestamp 03:59:56.353):**
```
<NO "Tab options" log appears>
```

**Behavioral evidence from logs:**

**Non-restored Quick Tab #1 (4 drag operations, ALL successful):**
```
04:00:00.484 - UpdateHandler: handlePositionChangeEnd called - left 291, top 325
04:00:00.484 - Updated tab position in Map
04:00:00.662 - Storage write COMPLETED

04:00:01.187 - UpdateHandler: handlePositionChangeEnd called - left 59, top 356
04:00:01.187 - Updated tab position in Map
04:00:01.394 - Storage write COMPLETED

04:00:03.258 - UpdateHandler: handlePositionChangeEnd called - left 696, top 811
04:00:03.258 - Updated tab position in Map
04:00:03.457 - Storage write COMPLETED
```

**Restored Quick Tab #2 (4 drag operations, ZERO successful):**
```
03:59:58.660 - QuickTabWindow: Calling onPositionChangeEnd callback
<NO UpdateHandler log>

03:59:59.347 - QuickTabWindow: Calling onPositionChangeEnd callback
<NO UpdateHandler log>

04:00:02.266 - QuickTabWindow: Calling onPositionChangeEnd callback
<NO UpdateHandler log>

04:00:04.750 - QuickTabWindow: Calling onPositionChangeEnd callback
<NO UpdateHandler log>
```

**Analysis:** QuickTabWindow is calling its `onPositionChangeEnd` callback (wired by DragController), but UpdateHandler **never receives** the call. This means the callback points to a no-op function or undefined reference, not to `UpdateHandler.handlePositionChangeEnd`.

### Fix Required

Ensure callbacks are passed during restore path. Two approaches:

**Approach A:** Modify `UICoordinator._createWindow()` to include callbacks in options object passed to `createQuickTabWindow()`. Callbacks should reference the same UpdateHandler and VisibilityHandler instances used during initial creation.

**Approach B:** After creating fresh instance, re-wire callbacks by calling a method on QuickTabsManager that sets `tabWindow.onPositionChangeEnd = this.updateHandler.handlePositionChangeEnd.bind(this.updateHandler)` and similar for all lifecycle callbacks.

**Reference pattern:** Existing code in `CreateHandler.create()` where callbacks are passed to `createQuickTabWindow()`. The same callback references must be used during restore.

---

## Issue #2: Size Updates Stop Working After Restore

### Problem
After restoring a minimized Quick Tab, resizing the window no longer persists size changes to storage. The window resizes visually but Manager UI does not update size indicator, and size reverts after page reload.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_createWindow()` method (called during restore path)  
**Issue:** Same as Issue #1 - the options object does **not include** `onSizeChangeEnd` callback.

**Evidence:** No logs exist showing ResizeController callbacks reaching UpdateHandler after restore. While logs don't show resize operations in this specific test session, the same callback wiring gap that affects position updates also affects size updates.

**Architecture symmetry:** DragController and ResizeController use identical callback patterns:
- DragController invokes `onPositionChangeEnd` 
- ResizeController invokes `onSizeChangeEnd`
- Both callbacks should point to `UpdateHandler.handlePositionChangeEnd` and `UpdateHandler.handleSizeChangeEnd` respectively

Since position callbacks are proven broken (0/4 successes), size callbacks have the same failure mode.

### Fix Required

Same fix as Issue #1. Include `onSizeChangeEnd` callback in options object during `_createWindow()` call, pointing to `UpdateHandler.handleSizeChangeEnd`.

---

## Issue #3: Restored Quick Tab Appears Behind New Tabs (Z-Index Broken)

### Problem
After restoring a minimized Quick Tab, it appears visually **behind** Quick Tabs that were created after the restore operation, even though it has a numerically higher z-index value.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js` and `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** Z-index application during restore + missing focus operation  
**Issue:** Two-part failure:

**Part A - Z-index set before appendChild:**

From logs (timestamp 03:59:56.353):
```
UICoordinator: Creating window from entity, zIndex = 1000008
QuickTabWindow: render() called with dimensions...
QuickTabWindow: DOM dimensions AFTER createElement ... zIndex 1000008
QuickTabWindow: Rendered (appendChild happens here)
```

Z-index is set on element's inline style **before** `document.body.appendChild()` is called. This may prevent z-index from taking effect properly in some browsers/contexts.

**Part B - onFocus callback not reaching VisibilityHandler:**

**Non-restored Quick Tab #1 - Every drag triggers focus:**
```
03:59:49.876 - QuickTabWindow: Bringing to front via onFocus callback
03:59:49.876 - VisibilityHandler: Bringing to front qt-629-1764820786743-agkuza1yw0d5y
03:59:49.876 - VisibilityHandler: debouncedPersist scheduling (focus operation)
```

**Restored Quick Tab #2 - Focus callback broken:**
```
03:59:57.775 - QuickTabWindow: Bringing to front via onFocus callback
<NO VisibilityHandler log>

03:59:59.210 - QuickTabWindow: Bringing to front via onFocus callback
<NO VisibilityHandler log>

04:00:01.644 - QuickTabWindow: Bringing to front via onFocus callback
<NO VisibilityHandler log>
```

QuickTabWindow invokes `onFocus` callback during drag start, but VisibilityHandler **never receives** the call. Without explicit "bring to front" operation, z-index alone may not make window appear visually in front, especially if DOM insertion order takes precedence.

**Evidence of z-index values:**
```
Quick Tab #1 (created first): z-index 1000001
Quick Tab #2 (restored): z-index 1000008

1000008 > 1000001 → should be in front
BUT user reports it appears behind
```

**Additional finding from logs (timestamp 03:59:56.302):**

VisibilityHandler sets z-index during restore:
```
VisibilityHandler: Updated z-index for restored tab, newZIndex = 1000007
```

Then UICoordinator **overrides** it during window creation:
```
UICoordinator: Creating window from entity, zIndex = 1000008
```

The override itself is fine (higher value), but there's no explicit focus/front-bringing operation after the override.

### Fix Required

**Part A:** Ensure z-index is applied AFTER element is appended to DOM. Modify QuickTabWindow.render() to set `container.style.zIndex` after `document.body.appendChild(container)`.

**Part B:** Wire `onFocus` callback during restore (same fix as Issues #1 and #2). Callback should point to `VisibilityHandler.handleFocus`.

**Part C:** Add explicit bring-to-front operation after restore completes. VisibilityHandler should call `tabWindow.container.style.zIndex = this.currentZIndex.value++` AND trigger a focus event or DOM reflow to ensure visual front-bringing.

**Reference:** Existing focus handling in VisibilityHandler.handleFocus() lines where z-index is incremented and storage persisted. Same pattern should apply immediately after restore.

---

## Issue #4: Storage Corruption from Other Browser Tabs

### Problem
During restore operations, at least 6 other browser tab instances write empty state (`{tabs: 0}`) to storage, creating an oscillation cycle where state alternates between 2 tabs and 0 tabs multiple times per second.

### Root Cause

**File:** Multiple content script instances across all browser tabs  
**Location:** Storage event listeners in all tabs  
**Issue:** When any tab writes to `browser.storage.local`, `storage.onChanged` fires in **all other tabs**. Those tabs have no Quick Tabs locally, so they build state from their empty `quickTabsMap` and write it back to storage, overwriting the valid state.

**Evidence from logs (timestamp 03:59:56.533 to 03:59:57.382):**

```
Background: tabs 2 → 0 ⚠️ WARNING: Tab count dropped from 2 to 0!
writingInstanceId: inst-1764820761061-... (different tab)

Background: tabs 0 → 2 (restored from cache)
writingInstanceId: inst-1764820767500-... (original tab)

Background: tabs 2 → 0 ⚠️ WARNING: Tab count dropped from 2 to 0!
writingInstanceId: inst-1764820761082-... (different tab)

Background: REJECTED Clear within cooldown period
```

**At least 6 different writingInstanceIds detected:**
- inst-1764820761061
- inst-1764820761082
- inst-1764820761080
- inst-1764820761084
- inst-1764820761081
- inst-1764820761083

All writing `{tabs: 0}` within the same 1-second window.

**Impact:** 
- State unstable for 1-2 seconds after every restore operation
- Background script must use cooldown and cache to prevent complete state loss
- Manager UI may briefly show incorrect state during oscillation
- Potential for restore operations to fail if state is empty during critical read

### Fix Required

Implement per-tab storage keys architecture (as recommended in previous diagnostic report):
- Each tab writes to `quick_tabs_tab_${tabId}` instead of shared `quick_tabs_state_v2`
- Manager aggregates by reading all `quick_tabs_tab_*` keys
- Eliminates cross-tab write conflicts entirely

**Interim fix:** Add `writingTabId` check - if storage change event's `writingTabId !== currentTabId`, ignore the change instead of rebuilding and re-writing state.

---

## Missing Logging Identified

### 1. UICoordinator Callback Wiring During Restore

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_createWindow()` method when called during restore path  
**Missing:** Log showing what callbacks are included in options object

**What's needed:**
```
Log the complete options object passed to createQuickTabWindow(), specifically:
- onPositionChangeEnd: function vs. undefined
- onSizeChangeEnd: function vs. undefined  
- onFocus: function vs. undefined
- onMinimize: function vs. undefined
- onDestroy: function vs. undefined
```

**Impact:** Currently impossible to verify whether callbacks are missing from options or if callbacks exist but point to wrong references.

---

### 2. QuickTabWindow Callback Registration Verification

**File:** `src/features/quick-tabs/window.js`  
**Location:** Constructor after `_initializeCallbacks()` completes  
**Missing:** Log showing which callbacks were successfully registered

**What's needed:**
```
After callback initialization, log:
- onPositionChangeEnd: typeof this.onPositionChangeEnd (should be 'function')
- onSizeChangeEnd: typeof this.onSizeChangeEnd
- onFocus: typeof this.onFocus
- Callback targets (if possible): onPositionChangeEnd.name or bound context
```

**Impact:** Can't distinguish between "callback not passed" vs. "callback passed but no-op function" vs. "callback passed but wrong reference".

---

### 3. DragController Element Reference Verification

**File:** `src/features/quick-tabs/window/DragController.js`  
**Location:** Constructor and when element reference is used  
**Missing:** Log confirming element reference is stored and valid

**What's needed:**
```
When DragController initialized:
- Element reference stored: hasElement = true/false
- Element is connected to DOM: isConnected = true/false
- Element ID: data-quicktab-id value

When drag event fires:
- Event target matches stored element: true/false
- Stored element still in DOM: true/false
```

**Impact:** Can't verify if event listeners are attached to correct element or if element reference becomes stale.

---

### 4. UpdateHandler Callback Invocation Attempt

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** Top of `handlePositionChangeEnd()` and `handleSizeChangeEnd()`  
**Missing:** Log that method was invoked (currently only logs after validation passes)

**What's needed:**
```
Add log at VERY START of method, before any validation:
- handlePositionChangeEnd INVOKED: id, left, top
- Then existing validation logs
- Then existing success logs
```

**Impact:** Currently if callback is never called, there's zero log trail. If callback IS called but validation fails, can't distinguish from "never called".

---

### 5. VisibilityHandler Focus Callback Invocation

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** Top of `handleFocus()` method  
**Missing:** Log that method was invoked

**What's needed:**
```
Add log at start of handleFocus():
- handleFocus INVOKED: id, source
- Current z-index: tabWindow.zIndex
- Will increment to: this.currentZIndex.value + 1
```

**Impact:** Currently can't tell if handleFocus is never called vs. called but fails silently.

---

### 6. Z-Index Application Timing Verification

**File:** `src/features/quick-tabs/window.js`  
**Location:** In render() method around appendChild operation  
**Missing:** Logs showing z-index state before and after appendChild

**What's needed:**
```
Before appendChild:
- Z-index set on container.style: value
- Element in DOM: false

After appendChild:
- Element in DOM: true
- Computed z-index: getComputedStyle(container).zIndex
- Visual verification: element is topmost = true/false
```

**Impact:** Can't verify if z-index set before appendChild takes effect or if it's overridden by browser.

---

## Shared Implementation Notes

**Callback Wiring Architecture:**

Normal creation flow:
```
QuickTabsManager.createQuickTab()
  → CreateHandler.create()
    → createQuickTabWindow({
        onPositionChangeEnd: this.updateHandler.handlePositionChangeEnd.bind(this.updateHandler),
        onSizeChangeEnd: this.updateHandler.handleSizeChangeEnd.bind(this.updateHandler),
        onFocus: this.visibilityHandler.handleFocus.bind(this.visibilityHandler),
        // ...
      })
```

Restore flow (BROKEN):
```
VisibilityHandler.handleRestore()
  → QuickTabWindow.restore() (sets minimized = false, defers render)
    → UICoordinator.update() (receives state:updated event)
      → UICoordinator._handleRestoreOperation()
        → UICoordinator.render()
          → UICoordinator._createWindow(quickTab)
            → createQuickTabWindow({
                id: quickTab.id,
                url: quickTab.url,
                // WHERE ARE THE CALLBACKS?
              })
```

**Critical gap:** QuickTab entity object (stored in Map) does **not contain** callback function references. Callbacks are wired during initial creation by QuickTabsManager but entity only stores data (id, url, position, size, etc.). When UICoordinator builds options from entity during restore, callbacks are missing.

**Solution options:**

**Option A - Store callback references in Map:**
Add a separate `callbackRefs` Map that stores callback objects keyed by Quick Tab ID. UICoordinator._createWindow() looks up callbacks from this Map and includes them in options.

**Option B - Re-wire after creation:**
UICoordinator emits event after creating fresh instance. QuickTabsManager listens and re-wires callbacks to the new instance.

**Option C - Pass handlers to UICoordinator:**
UICoordinator constructor receives references to UpdateHandler and VisibilityHandler. During _createWindow(), UICoordinator constructs callback options directly from handler methods.

**Recommended:** Option C - cleanest architecture, no need for separate callback storage, handlers are already dependencies of UICoordinator.

**Z-Index Front-Bringing Pattern:**

Successful pattern from non-restored Quick Tabs:
```
1. Drag starts → onFocus callback invoked
2. VisibilityHandler.handleFocus() executes
3. Z-index incremented: this.currentZIndex.value++
4. Z-index applied: tabWindow.zIndex = newValue
5. Storage persisted (debounced)
```

This explicit z-index bump happens **every time** user interacts with non-restored tab, ensuring it's always visually in front.

Restored tabs **skip step 2-4** because onFocus callback not wired, so z-index set once at restore time and never updated during interaction.

<acceptancecriteria>
**Issue #1 - Position Updates:**
- Drag restored Quick Tab → UpdateHandler.handlePositionChangeEnd logged
- Position persists to storage immediately after drag
- Manager UI updates position indicator
- Position preserved after page reload

**Issue #2 - Size Updates:**
- Resize restored Quick Tab → UpdateHandler.handleSizeChangeEnd logged
- Size persists to storage immediately after resize
- Manager UI updates size indicator
- Size preserved after page reload

**Issue #3 - Z-Index:**
- Restored Quick Tab appears visually in front of older tabs
- Z-index value matches visual stacking order
- Dragging restored tab brings it to front (VisibilityHandler.handleFocus logged)
- Z-index incremented on every interaction

**Issue #4 - Storage Corruption:**
- Other tabs do NOT write to storage when they have no Quick Tabs
- No oscillation cycles (2→0→2→0) during restore
- State remains stable for entire restore operation
- Background script does NOT log "Tab count dropped" warnings

**All Issues:**
- All existing tests pass
- No new console errors or warnings
- Manual test: create Quick Tab → minimize → restore → drag → resize → reload
- All operations work identically to non-restored Quick Tabs
- Callbacks logged for every operation (position, size, focus)
</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Log Timeline - Restore Operation Detailed Breakdown</summary>

**T+0.000s (03:59:56.302) - Restore initiated:**
```
VisibilityHandler: Handling restore qt-629-1764820788407-1t3f7wc1mswtxp
VisibilityHandler: Updated entity.minimized = false
VisibilityHandler: Updated z-index for restored tab, newZIndex = 1000007
MinimizedManager: Snapshot applied - position {260, 405}, size {960, 540}
QuickTabWindow: restore() called, hasContainer = false
QuickTabWindow: "Restored state updated, render deferred to UICoordinator"
```

**T+0.050s (03:59:56.352) - UICoordinator takes over:**
```
UICoordinator: Update decision = "restore via unified fresh render path"
UICoordinator: Deleting from renderedTabs before restore
UICoordinator: renderedTabs.delete, mapSizeBefore = 2, mapSizeAfter = 1
```

**T+0.051s (03:59:56.353) - Fresh instance created:**
```
UICoordinator: Creating NEW window instance qt-629-1764820788407-1t3f7wc1mswtxp
UICoordinator: Creating window from entity, zIndex = 1000008
QuickTabWindow: Created with URL (no options log!)
QuickTabWindow: render() called with dimensions
QuickTabWindow: Applying dimensions to DOM
QuickTabWindow: Wiring DragController callbacks (but to what?)
QuickTabWindow: Wiring ResizeController callbacks (but to what?)
QuickTabWindow: Rendered
UICoordinator: renderedTabs.set, mapSizeAfter = 1
```

**T+1.473s (03:59:57.775) - First drag after restore:**
```
QuickTabWindow: Drag started (260, 405)
QuickTabWindow: Bringing to front via onFocus callback
<VisibilityHandler.handleFocus NOT logged - callback dead>
```

**T+2.358s (03:59:58.660) - First drag ends:**
```
QuickTabWindow: Drag ended (703, 693)
QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler.handlePositionChangeEnd NOT logged - callback dead>
```

**Comparison - Non-restored tab drag (04:00:00.483):**
```
QuickTabWindow: Drag ended (291, 325)
QuickTabWindow: Calling onPositionChangeEnd callback
UpdateHandler: handlePositionChangeEnd called ← THIS LOG PRESENT
UpdateHandler: Updated tab position in Map ← THIS LOG PRESENT
UpdateHandler: Storage write COMPLETED ← THIS LOG PRESENT
```

</details>

<details>
<summary>Storage Corruption Cycle Analysis</summary>

**Full oscillation timeline (03:59:56.533 to 03:59:57.665):**

```
T+0.0s - Valid state exists (2 tabs)
Background: Updated global state from storage - 2 tabs

T+0.2s - Other tab writes empty state
Background: tabs 2 → 0
Background: ⚠️ WARNING: Tab count dropped from 2 to 0!
Background: DEFERRED Zero-tab read (waiting for confirmation)
writingInstanceId: inst-1764820761061 (Tab 641 or similar)

T+0.5s - Original tab writes valid state back
VisibilityHandler: Storage write COMPLETED (2 tabs, 0 minimized)
writingInstanceId: inst-1764820767500 (Tab 629 - our tab)

T+0.6s - Background restores from cache
Background: tabs 0 → 2
Background: Updated global state from storage - 2 tabs

T+1.0s - Another tab writes empty state AGAIN
Background: tabs 2 → 0
Background: ⚠️ WARNING: Tab count dropped from 2 to 0!
Background: REJECTED Clear within cooldown period
writingInstanceId: inst-1764820761082 (Different tab)

T+1.3s - Cycle continues...
```

**Pattern:** Other tabs react to storage.onChanged, build empty state from their local quickTabsMap (which is empty), write it to storage, overwriting valid state. Background's cooldown mechanism prevents complete data loss but can't stop the oscillation.

**Impact on restore:** During the ~1 second window when state is oscillating, restore operations may read empty state and fail to find the Quick Tab being restored, leading to "Tab not found" errors or duplicate creation attempts.

</details>

<details>
<summary>Callback Architecture - Expected vs. Actual</summary>

**Expected callback flow (working in non-restored tabs):**

```
User drags window
  ↓
DragController.handleMouseMove (internal)
  ↓
DragController updates window position
  ↓
DragController.handleMouseUp triggers onPositionChange callback
  ↓
QuickTabWindow.onPositionChange (passed from options)
  ↓
UpdateHandler.handlePositionChange (bound during creation)
  ↓
Updates Map, emits event, schedules storage persist
  ↓
Drag ends, onPositionChangeEnd callback
  ↓
UpdateHandler.handlePositionChangeEnd
  ↓
Final position persisted to storage
```

**Actual callback flow in restored tabs (BROKEN):**

```
User drags window
  ↓
DragController.handleMouseMove (internal) - WORKS
  ↓
DragController updates window position - WORKS
  ↓
DragController.handleMouseUp triggers onPositionChange callback - WORKS
  ↓
QuickTabWindow.onPositionChange (no-op function or undefined) - DEAD END
  ↓
<UpdateHandler never reached>
  ↓
Map not updated, storage not persisted
```

**Root cause:** During initial creation, QuickTabsManager passes callbacks in options:
```javascript
createQuickTabWindow({
  onPositionChange: this.updateHandler.handlePositionChange.bind(this.updateHandler)
})
```

During restore, UICoordinator._createWindow() builds options from entity:
```javascript
createQuickTabWindow({
  id: quickTab.id,
  url: quickTab.url,
  left: quickTab.left,
  // onPositionChange: ??? - NOT INCLUDED
})
```

QuickTabWindow constructor has fallback for missing callbacks:
```javascript
this.onPositionChange = options.onPositionChange || noop;
```

So `onPositionChange` becomes a no-op function, DragController invokes it successfully, but nothing happens.

</details>

---

**Priority:** Critical (Issues #1, #2, #3), High (Issue #4)  
**Target:** Fix callback wiring in single focused PR  
**Estimated Complexity:** Medium - architectural fix required, not just bug patch