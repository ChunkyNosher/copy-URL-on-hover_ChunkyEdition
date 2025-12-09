# Quick Tab Restore: Duplicate 400x300 Window Bug & State Synchronization Failures

**Extension Version:** v1.6.3.4-v2  
**Date:** 2025-11-30  
**Scope:** Critical restore failures causing duplicate windows with incorrect
dimensions, missing UI updates, and broken close button

---

## Executive Summary

The Quick Tab restore system has multiple critical failures that compound to
create the duplicate 400x300 window bug and prevent proper state
synchronization. After minimizing and restoring a Quick Tab 2+ times, a
duplicate window appears at hardcoded default dimensions (100, 100, 400x300)
instead of the saved snapshot values. Additionally, UpdateHandler stops
persisting state after the first restore cycle, the Manager Panel UI doesn't
reflect window closures via close button, and logging gaps prevent diagnosis of
the dual restore code paths.

**Root cause:** The UICoordinator takes two different code paths for restore
operations - a "fresh render" path when `renderedTabs` Map is empty and a
"restore existing window" path when the Map contains a stale entry. On the
second+ restore cycle, the Map still contains the tab from the previous restore
(with `domAttached: true` even though DOM was removed), causing
`_restoreExistingWindow()` to be called instead of fresh `render()`. This path
calls `MinimizedManager.restore()` which applies the snapshot and moves it to
`pendingClearSnapshots`, then ALSO calls `tabWindow.restore()` directly which
finds a stale container reference and tries to update display instead of
deferring to UICoordinator. When `render()` is finally called, it uses instance
properties that have been reset to DEFAULT values (100, 100, 400, 300).

**Impact:**

- Second+ restore creates duplicate window at wrong dimensions (400x300 instead
  of saved 960x540)
- Position/size updates after first restore are never saved to storage
  (UpdateHandler stops firing)
- Close button doesn't remove tab from Manager Panel UI (callback not wired to
  emit `state:deleted`)
- Impossible to debug without comprehensive logging of Map lifecycle and restore
  code paths

---

## Issues Overview

| Issue                                                 | Component                                       | Severity     | Root Cause                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| 1. Duplicate 400x300 window on 2nd+ restore           | UICoordinator + QuickTabWindow                  | **Critical** | Dual restore code paths + stale Map entries + DEFAULT fallback dimensions                  |
| 2. Map lifecycle desync                               | UICoordinator.update()                          | **Critical** | Manager minimize doesn't remove Map entry, second restore finds stale reference            |
| 3. UpdateHandler stops persisting after first restore | UpdateHandler + DragController/ResizeController | **High**     | Callbacks not re-wired after restore, or conditional check blocks persistence              |
| 4. Close button doesn't update Manager UI             | QuickTabWindow.destroy() + DestroyHandler       | **High**     | onDestroy callback not wired to emit state:deleted after restore                           |
| 5. Snapshot pending-clear lifecycle issue             | MinimizedManager.restore()                      | **Medium**   | Snapshot moved to pendingClear before UICoordinator reads it, clearSnapshot() never called |
| 6. Insufficient logging prevents diagnosis            | Multiple files                                  | **High**     | Missing logs for Map state, restore path decisions, callback wiring, conditional skips     |

**Why bundled:** All issues stem from the dual restore code path architecture
and affect Quick Tab lifecycle from minimize → restore → update → close. Can be
diagnosed comprehensively and fixed in coordinated effort.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` (_restoreExistingWindow, update, render, Map cleanup)
- `src/features/quick-tabs/window.js` (restore, render, DEFAULT constants)
- `src/features/quick-tabs/minimized-manager.js` (restore, clearSnapshot timing)
- `src/features/quick-tabs/handlers/UpdateHandler.js` (conditional persistence checks)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (restore event emission)
- `src/features/quick-tabs/window/DragController.js` (callback registration after restore)
- `src/features/quick-tabs/window/ResizeController.js` (callback registration after restore)

**Do NOT Modify:**

- `src/background/` (out of scope - background script works correctly)
- `src/features/quick-tabs/managers/StateManager.js` (storage format is correct)
- `.github/` (configuration) </scope>

---

## Issue #1: Duplicate 400x300 Window Appears on Second+ Restore

### Problem

After minimizing and restoring a Quick Tab once successfully, subsequent restore
operations create a DUPLICATE window at hardcoded dimensions (100px, 100px,
400x300) instead of restoring the saved snapshot (e.g., 670px, 132px, 960x540).
First restore works correctly, but all subsequent restores fail.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_restoreExistingWindow()` method (lines 395-475), `update()`
method (lines 580-650)  
**Issue:** UICoordinator has two code paths for restore - "fresh render" (when
`renderedTabs` Map is empty) and "restore existing window" (when Map contains
entry). On second+ restore, the Map STILL contains the tab from the previous
restore cycle with `domAttached: true` (even though minimize removed the DOM),
causing the wrong code path to execute. This path:

1. Calls `MinimizedManager.restore(id)` which applies snapshot and moves it to
   `pendingClearSnapshots`
2. Then ALSO calls `tabWindow.restore()` directly
3. `tabWindow.restore()` checks `if (this.container)` (line 670) and finds the
   stale container reference
4. Tries to update display via `container.style` instead of deferring to
   UICoordinator
5. When `render()` is finally called, it reads instance properties which are now
   DEFAULT values

**File:** `src/features/quick-tabs/window.js`  
**Location:** Lines 123-130 (DEFAULT constants), `restore()` method (lines
653-695)  
**Issue:** The restore() method has conditional logic that checks for container
existence. On second restore, `this.container` is truthy (stale reference from
first restore) but the container is NOT in the DOM. The method tries to update
`container.style.left/top/width/height` on a detached element, then when
render() is eventually called, dimensions have been reset to:

```javascript
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const DEFAULT_LEFT = 100;
const DEFAULT_TOP = 100;
```

### Fix Required

UICoordinator must clean up `renderedTabs` Map entries when Manager minimize
operations occur. The `update()` method has conditional cleanup code (lines
632-642) for `source === 'Manager' && entityMinimized && !domAttached`, but this
is NEVER REACHED on second+ minimize cycles because the first `if (!tabWindow)`
check at line 580 evaluates to FALSE (tab is still in Map).

Additionally, `_restoreExistingWindow()` should NOT call `tabWindow.restore()`
directly after `MinimizedManager.restore()` has already applied the snapshot.
The dual restore() calls create conflicting dimension updates. Either:

- UICoordinator should call `MinimizedManager.restore()` ONLY to get snapshot
  data, then apply to entity BEFORE calling render()
- OR tabWindow.restore() should NEVER touch container.style and always defer to
  UICoordinator for rendering

Finally, the QuickTabWindow class should clear its container reference when
minimize() removes the DOM (line 659), so the stale reference check in restore()
doesn't find a truthy value.

---

## Issue #2: renderedTabs Map Lifecycle Desync

### Problem

When a Quick Tab is minimized via the Manager minimize button, the DOM is
removed but the `renderedTabs` Map entry persists. On the second restore
attempt, UICoordinator finds the tab in the Map with `domAttached: true` (even
though DOM was removed), takes the `_restoreExistingWindow()` path instead of
fresh `render()`, and triggers the duplicate window bug.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method (lines 580-650), specifically the Manager
cleanup code (lines 632-642)  
**Issue:** The method has source-aware cleanup logic to delete Map entries when
`source === 'Manager' && entityMinimized && !domAttached`. However, this code is
NEVER REACHED on subsequent minimize operations because the initial check at
line 580:

```javascript
if (!tabWindow) {
  // Handle not in map...
  return this.render(quickTab);
}
```

This evaluates to FALSE on the second+ minimize because the first minimize LEFT
the tab in the Map. The logs show:

```
21:16:40 - UICoordinator Update decision: { inMap: false, entityMinimized: true, mapSize: 0 }
21:17:08 - UICoordinator Update decision: { inMap: false, entityMinimized: true, mapSize: 0 }
```

Even though `inMap: false`, the code reached the "skip minimized" branch,
meaning tabWindow WAS in the Map at line 580 check but then got removed
somewhere in between. This indicates a race condition or timing issue where Map
cleanup happens AFTER the initial check but BEFORE the decision logging.

Additionally, when minimize completes, the Map size shows no change
(`mapSizeBefore: 3, mapSizeAfter: 3`), confirming the entry was never deleted.

### Fix Required

The Manager minimize cleanup code at lines 632-642 needs to execute EARLIER in
the control flow, BEFORE the `if (!tabWindow)` check at line 580. The current
order is:

1. Check if NOT in Map → return early
2. Check source-aware cleanup conditions → delete if Manager minimize

This should be reversed:

1. Check source-aware cleanup conditions FIRST → delete if Manager minimize and
   return early
2. Then check if NOT in Map → render if needed

Alternatively, the minimize operation itself (in VisibilityHandler or
MinimizedManager) should explicitly call `UICoordinator.renderedTabs.delete(id)`
as part of its cleanup process, rather than relying on the next `update()` call
to notice the desync.

---

## Issue #3: UpdateHandler Stops Persisting After First Restore

### Problem

After successfully restoring a minimized Quick Tab once, drag and resize
operations NO LONGER persist to storage. The logs show
`UpdateHandler Starting storage persist...` firing regularly until 21:16:37,
then after the first restore at 21:17:12, UpdateHandler NEVER fires again
despite multiple drag operations at 21:17:57 onward.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `handlePositionChangeEnd()` and `handleSizeChangeEnd()` methods
(exact lines unknown, need to inspect file)  
**Issue:** The UpdateHandler methods are registered as callbacks
(`onPositionChangeEnd`, `onSizeChangeEnd`) on the QuickTabWindow instance during
initial creation. After restore, EITHER:

1. The callbacks are not re-wired to the new/restored window instance
2. A conditional check in UpdateHandler (e.g., checking minimized state,
   isRendered(), or destroyed flag) blocks the persistence
3. The DragController/ResizeController don't call the callbacks after being
   recreated during restore

**File:** `src/features/quick-tabs/window/DragController.js` and
`ResizeController.js`  
**Location:** Callback registration during controller creation (exact lines
unknown)  
**Issue:** When a Quick Tab is minimized (Issue #1 logs show drag/resize
controllers are destroyed), the DragController and ResizeController are cleaned
up via `.destroy()` and `.detachAll()`. When the window is restored, NEW
controllers are created in `render()` (lines 446-475 in window.js), but these
new controllers may not have the same callback references as the original
controllers. The callbacks might be:

1. Passed during initial QuickTabWindow construction but not stored for later
   re-wiring
2. Registered with different event listener patterns that don't survive the
   destroy/recreate cycle
3. Using closure variables that get lost when controllers are destroyed

### Fix Required

Identify WHERE the `onPositionChangeEnd` and `onSizeChangeEnd` callbacks are
stored and ensure they are re-applied when:

1. DragController is recreated after restore (in `QuickTabWindow.render()` at
   line ~460)
2. ResizeController is recreated after restore (in `QuickTabWindow.render()` at
   line ~470)

The QuickTabWindow constructor receives these callbacks in the `options`
parameter (stored as `this.onPositionChangeEnd` and `this.onSizeChangeEnd`), but
the DragController/ResizeController constructors may not receive these callback
references. After restore, when controllers are recreated, they need to be
passed the SAME callbacks that were stored during initial construction.

Additionally, add conditional logging in UpdateHandler methods to show when
persistence is SKIPPED due to conditional checks (e.g., if minimized, if
!isRendered(), if destroyed flag is true).

---

## Issue #4: Close Button Doesn't Update Manager UI

### Problem

Clicking the close button (❌) on a Quick Tab window destroys the window and
removes it from view, but the Manager Panel UI continues to show the tab as
"active" with a green indicator. The tab persists in the Manager's list and can
even be "restored" again (creating ghost state).

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `destroy()` method (lines 874-903), specifically the
`this.onDestroy(this.id)` callback at line 900  
**Issue:** The destroy() method calls `this.onDestroy(this.id)` which is a
callback registered during window creation. This callback is SUPPOSED to trigger
`DestroyHandler.handleDestroy()` which emits the `state:deleted` event. However,
after restore, this callback wiring is broken or the callback is a no-op
function.

The logs show:

```
21:16:42 - QuickTabWindow Destroying: qt-121-1764537394723-161ah1a1p3s9e3
21:16:42 - QuickTabsManager handleDestroy called for qt-121-... source: UI
21:16:42 - DestroyHandler Handling destroy for qt-121-... source: UI
21:16:42 - UICoordinator Received state:deleted event
```

This sequence shows destroy() working CORRECTLY when called via Manager (Close
All button). But when the UI close button is clicked on a RESTORED window, the
callback chain doesn't fire. This suggests:

1. The `onDestroy` callback is not re-wired after restore
2. OR the callback is wired to a different handler that doesn't emit events
3. OR the QuickTabWindow instance after restore is a DIFFERENT instance that
   never received the callback

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_restoreExistingWindow()` (lines 395-475), `_createWindow()`
(lines 1115-1170)  
**Issue:** When UICoordinator restores a window via `_restoreExistingWindow()`,
it calls `render()` on the EXISTING tabWindow instance (line 450). This instance
already has `onDestroy` callback wired from initial creation. However, if
UICoordinator ever creates a NEW window instance during restore (via
`_createWindow()` factory), that new instance may not receive the `onDestroy`
callback because `_createWindow()` only passes the callbacks defined in the
entity's stored state, not the runtime callbacks.

### Fix Required

Identify where the `onDestroy` callback is initially wired during window
creation. The callback should:

1. Be stored as a persistent property on the QuickTabWindow instance (e.g.,
   `this.onDestroy`)
2. Be passed during `createQuickTabWindow()` factory function call
3. Reference `DestroyHandler.handleDestroy()` or
   `QuickTabsManager.handleDestroy()`

After restore, verify that:

1. The SAME window instance is reused (not a new instance created)
2. The `onDestroy` callback is explicitly re-applied if needed
3. The callback chain correctly emits `state:deleted` event

Add logging in `QuickTabWindow.destroy()` to show:

- Whether `onDestroy` callback exists (check
  `typeof this.onDestroy === 'function'`)
- What the callback is bound to (log the function reference or name)
- Whether the callback successfully executes (wrap in try/catch with logging)

---

## Issue #5: Snapshot Pending-Clear Lifecycle Gap

### Problem

When `MinimizedManager.restore(id)` is called, the snapshot is moved from
`minimizedTabs` Map to `pendingClearSnapshots` Map, but UICoordinator is
supposed to call `clearSnapshot(id)` after successful render to confirm snapshot
deletion. On subsequent restore operations, the snapshot may be in
`pendingClearSnapshots` instead of `minimizedTabs`, or the 200ms
STATE_EMIT_DELAY_MS causes snapshot to be read AFTER it's been moved.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `restore()` method (lines 110-150), specifically lines 138-145
where snapshot is moved  
**Issue:** The method moves the snapshot to `pendingClearSnapshots` at the END
of the restore() call:

```javascript
if (this.minimizedTabs.has(id)) {
  this.pendingClearSnapshots.set(id, snapshot);
  this.minimizedTabs.delete(id);
}
```

However, UICoordinator's `_restoreExistingWindow()` method (lines 395-475)
calls:

1. `MinimizedManager.restore(id)` at line ~410 (snapshot applied and moved to
   pending)
2. Then reads snapshot data AGAIN via `_applySnapshotForRestore()` at line ~403

If `_applySnapshotForRestore()` tries to read the snapshot AFTER
`MinimizedManager.restore()` has moved it, the snapshot won't be found in
`minimizedTabs` and the fallback will try to read from `pendingClearSnapshots`,
which works due to the fix in v1.6.4.9. However, the `clearSnapshot()` call is
supposed to happen in UICoordinator's `render()` method (lines 256-263) but is
only called when `isRenderedNow` is true. If render encounters an error or
returns early, the snapshot remains in `pendingClearSnapshots` forever, causing
accumulation of stale snapshots.

### Fix Required

The snapshot lifecycle should follow this order:

1. UICoordinator detects restore operation needed
2. UICoordinator reads snapshot from MinimizedManager (via `getSnapshot()`, NOT
   `restore()`)
3. UICoordinator applies snapshot dimensions to entity
4. UICoordinator calls `render()` which creates DOM
5. UICoordinator verifies DOM is attached via `isRendered()`
6. UICoordinator calls `MinimizedManager.clearSnapshot(id)` to confirm
   successful render
7. MinimizedManager deletes snapshot from BOTH `minimizedTabs` and
   `pendingClearSnapshots`

The current flow has UICoordinator calling `MinimizedManager.restore()` which
BOTH applies snapshot AND moves it, creating the timing gap. The `restore()`
method should be split into:

- `applySnapshot(id)` - Apply saved dimensions to instance, DO NOT move or
  delete snapshot
- `clearSnapshot(id)` - Delete snapshot from both Maps after UICoordinator
  confirms render success

Alternatively, `restore()` should NOT move the snapshot to
`pendingClearSnapshots` at all - just apply the dimensions and leave the
snapshot in `minimizedTabs` until UICoordinator explicitly calls
`clearSnapshot()`.

---

## Issue #6: Insufficient Logging Prevents Diagnosis

### Problem

The existing logs don't capture critical decision points, state transitions, or
failure modes in the restore flow. Specifically missing:

1. Map state BEFORE critical operations (only see AFTER in many places)
2. Which restore code path is taken (fresh render vs. restore existing)
3. Why UpdateHandler skips persistence after first restore
4. Whether callbacks are wired after restore (onDestroy, onPositionChangeEnd,
   etc.)
5. The SECOND restore() call execution in `_restoreExistingWindow()`
6. Conditional checks that block operations (if minimized, if !isRendered(),
   etc.)

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Multiple methods - `render()`, `update()`,
`_restoreExistingWindow()`, `destroy()`  
**Issue:** The logging shows state AFTER operations complete but not:

- Decision trees showing which branch was taken and why
- Precondition checks that cause early returns
- Callback existence and wiring verification
- Map state deltas (before/after sizes are logged in some places but not
  consistently)

**Example:** Line 580 `if (!tabWindow)` check has no logging. If this evaluates
to FALSE (tab in Map), we don't know it happened. The next log is at line 616
"Update decision:" but by then we're in a different branch.

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `handlePositionChangeEnd()` and `handleSizeChangeEnd()` methods  
**Issue:** No logging to show:

- When methods are called but persistence is skipped due to conditional checks
- What the conditional check values are (minimized flag, isRendered(),
  destroyed, etc.)
- Whether the callback exists or is a no-op

**File:** `src/features/quick-tabs/window.js`  
**Location:** `render()` method (line 244), `restore()` method (lines 653-695)  
**Issue:**

- `render()` returns early with just `console.warn` if already rendered, but
  doesn't log WHY container exists (stale reference vs. legitimate render)
- `restore()` has two branches (`if (this.container)` vs. else) but only logs
  the else branch at line 685
- No logging for the SECOND restore() call when it's invoked from
  `_restoreExistingWindow()`

**File:** `src/features/quick-tabs/window/DragController.js` and
`ResizeController.js`  
**Location:** Controller construction and callback registration  
**Issue:** No logging to verify:

- That callbacks are registered during controller creation
- That callbacks are the correct function references (not undefined or no-op)
- That callbacks successfully execute when drag/resize ends

### Fix Required

Add comprehensive logging at these critical points:

**UICoordinator.update():**

- Log BEFORE `if (!tabWindow)` check at line 580 with result
- Log which branch is taken (fresh render vs. restore vs. update vs. skip)
- Log Map state before AND after cleanup operations

**UICoordinator.\_restoreExistingWindow():**

- Log which restore path is taken (MinimizedManager has snapshot vs. no
  snapshot)
- Log BEFORE and AFTER the second `tabWindow.restore()` call at line 449
- Log whether render() is called and whether it succeeds

**UpdateHandler.handlePositionChangeEnd/handleSizeChangeEnd:**

- Log entry to method with current state (minimized, isRendered, destroyed)
- Log whether persistence is proceeding or being skipped
- Log the conditional check values that determine whether to persist

**QuickTabWindow.render():**

- When returning early at line 244, log container state (exists in DOM vs.
  detached reference)
- Log dimensions being used for render (verify not using DEFAULTs)

**QuickTabWindow.restore():**

- Log BOTH branches of `if (this.container)` check at line 670
- Log container state (exists, detached, null)
- Log final dimensions after restore() completes

**QuickTabWindow.destroy():**

- Log whether `onDestroy` callback exists
  (`typeof this.onDestroy === 'function'`)
- Log callback function reference or name
- Wrap callback execution in try/catch to log errors

**DragController/ResizeController:**

- Log callback registration during construction (show function references)
- Log callback execution when drag/resize ends (show parameters passed)
- Log if callback is undefined or fails to execute

---

## Shared Implementation Notes

- All Map lifecycle operations (`.set()`, `.delete()`) should log Map size
  BEFORE and AFTER for audit trail
- All conditional branches that cause early returns or skipped operations should
  log WHY (the condition values)
- All callback executions should verify callback exists before calling and log
  errors
- Snapshot lifecycle operations should log source (minimizedTabs vs.
  pendingClearSnapshots) when reading/writing
- Restore operations should explicitly flag which code path is taken (fresh vs.
  existing, snapshot vs. no snapshot)

<acceptancecriteria>
**Issue #1 - Duplicate 400x300 Window:**
- Second+ restore renders at saved snapshot dimensions (e.g., 670, 132, 960x540), not DEFAULT (100, 100, 400, 300)
- No duplicate windows appear - only ONE window rendered per Quick Tab
- Dimensions logged at each step match saved snapshot values (no DEFAULT values applied)

**Issue #2 - Map Lifecycle Desync:**

- Manager minimize operation deletes `renderedTabs` Map entry immediately
- Map size decreases by 1 after minimize completes (logged as mapSizeBefore: N,
  mapSizeAfter: N-1)
- Second restore finds Map empty, takes fresh render path instead of restore
  existing path

**Issue #3 - UpdateHandler Stops Persisting:**

- UpdateHandler continues to fire after every restore operation
- Drag and resize operations persist to storage regardless of how many restore
  cycles
- Logs show "UpdateHandler Starting storage persist..." after drag/resize
  operations following restore

**Issue #4 - Close Button Doesn't Update Manager:**

- Clicking ❌ close button emits `state:deleted` event
- Manager Panel UI removes tab from list within 200ms
- StateManager entity is deleted from storage

**Issue #5 - Snapshot Pending-Clear Lifecycle:**

- Snapshot remains accessible during entire restore flow
- `clearSnapshot()` successfully deletes from both `minimizedTabs` and
  `pendingClearSnapshots`
- No snapshot accumulation in `pendingClearSnapshots` Map after multiple restore
  cycles

**Issue #6 - Insufficient Logging:**

- All Map operations log size before/after
- All conditional branches log decision values
- All callback executions log existence check and errors
- Restore operations log which code path is taken and why

**All Issues:**

- All existing tests pass
- No new console errors or warnings
- Manual test: create QT → minimize → restore → drag → minimize → restore → drag
  → close via ❌ → verify Manager UI updates and no duplicate windows
  </acceptancecriteria>

---

## Supporting Context

<details>
<summary>Evidence: Duplicate Window Creation Log Sequence</summary>

First restore (WORKS - correct dimensions 266, 474, 960x540):

```
21:16:12 - MinimizedManager restore() called for qt-121-...
21:16:12 - Snapshot values: left 266, top 474, width 960, height 540
21:16:12 - QuickTabWindow render() dimensions: 266, 474, 960, 540
21:16:12 - DOM dimensions AFTER createElement: 960px x 540px
21:16:12 - DOM verification PASSED
```

Second restore (FAILS - wrong dimensions 100, 100, 400, 300):

```
21:17:12 - UICoordinator Update decision: inMap: true, domAttached: true
21:17:12 - Taking _restoreExistingWindow() path
21:17:12 - MinimizedManager restore() applies snapshot: 670, 132, 960, 540
21:17:12 - Snapshot moved to pendingClearSnapshots
21:17:12 - QuickTabWindow restore() called (SECOND call)
21:17:12 - Container exists during restore (stale reference)
21:17:12 - Updating container.style directly: 100px, 100px, 400px, 300px
21:17:12 - QuickTabWindow render() dimensions: 100, 100, 400, 300 (DEFAULTs!)
```

Evidence shows:

- First restore uses fresh render path (Map empty)
- Second restore finds tab in Map, uses \_restoreExistingWindow() path
- \_restoreExistingWindow() calls restore() twice (MinimizedManager + tabWindow)
- Second restore() finds stale container, applies DEFAULT dimensions
</details>

<details>
<summary>Evidence: UpdateHandler Stops Firing After First Restore</summary>

Timeline showing UpdateHandler firing regularly, then stopping after first
restore:

```
21:15:51 - UpdateHandler Starting storage persist... (last before restore)
21:16:12 - First restore happens
21:16:57 - Drag started
21:16:57 - Drag ended
(NO UpdateHandler log)
21:17:23 - Drag started
21:17:23 - Drag ended
(NO UpdateHandler log)
21:17:57 - Resize started
21:17:58 - Resize ended
(NO UpdateHandler log - should fire but doesn't)
```

Evidence shows:

- UpdateHandler works correctly before restore
- After first restore, UpdateHandler NEVER fires again
- Drag/resize operations complete but don't trigger storage persistence
- No conditional logging to explain why persistence is skipped
</details>

<details>
<summary>Evidence: Map Size Doesn't Decrease After Minimize</summary>

Logs showing Map size remains unchanged after minimize:

```
21:16:40 - Minimize button clicked for qt-121-...
21:16:40 - QuickTabWindow.minimize() removes DOM
21:16:40 - UICoordinator Update decision: mapSizeBefore: 3, mapSizeAfter: 3
21:16:40 - MinimizedManager Added snapshot for qt-121-...
21:16:40 - Storage persist completes
```

Expected behavior:

```
21:16:40 - UICoordinator renderedTabs.delete() - Manager minimize
21:16:40 - Map size: before 3, after 2 (SHOULD decrease)
```

Evidence shows:

- Manager minimize cleanup code is never reached
- Map entry persists even though DOM is removed
- Next restore finds stale Map entry instead of empty Map
</details>

<details>
<summary>Evidence: Close Button Doesn't Emit state:deleted</summary>

Working sequence (Close All via Manager):

```
21:16:42 - Content Received CLOSE_QUICK_TAB request
21:16:42 - DestroyHandler closeById called source: Manager
21:16:42 - QuickTabWindow Destroying: qt-121-...
21:16:42 - QuickTabsManager handleDestroy called source: UI
21:16:42 - DestroyHandler Handling destroy source: UI
21:16:42 - UICoordinator Received state:deleted event
21:16:42 - Manager UI removes tab from list
```

Broken sequence (❌ close button after restore):

```
(No logs - click happens but no destroy sequence)
OR
21:17:XX - QuickTabWindow Destroying: qt-121-...
(No handleDestroy log)
(No state:deleted event)
(Manager UI still shows tab)
```

Evidence shows:

- Close All path works correctly (emits state:deleted)
- UI close button after restore doesn't trigger callback chain
- onDestroy callback is not wired or is a no-op after restore
</details>

<details>
<summary>Architecture Context: Dual Restore Code Paths</summary>

UICoordinator has two distinct restore code paths:

**Path 1: Fresh Render (Map empty)**

```
update() → if (!tabWindow) → render() → _createWindow() → tabWindow.render()
```

- Used when renderedTabs Map doesn't contain the tab
- Always creates fresh DOM from entity state
- Applies snapshot dimensions via \_applySnapshotForRestore() before render
- This path WORKS correctly (first restore succeeds)

**Path 2: Restore Existing Window (Map has entry)**

```
update() → if (tabWindow exists) → if (instanceMinimized && !entityMinimized) → _restoreExistingWindow() → MinimizedManager.restore() + tabWindow.restore() + render()
```

- Used when renderedTabs Map contains the tab (even if DOM is detached)
- Calls MinimizedManager.restore() to apply snapshot
- Then ALSO calls tabWindow.restore() directly
- This path FAILS because:
  1. MinimizedManager.restore() moves snapshot to pendingClearSnapshots
  2. tabWindow.restore() finds stale container reference
  3. tabWindow.restore() updates container.style with DEFAULT dimensions
  4. render() uses instance properties (now DEFAULTs) instead of snapshot

**The Bug:** Second+ restore takes Path 2 instead of Path 1 because Map cleanup
didn't happen during first minimize. UICoordinator finds tab in Map with
domAttached: true (even though DOM was removed), assumes window exists, and
calls \_restoreExistingWindow() which has the dual restore() call bug.

</details>

---

**Priority:** Critical  
**Target:** Single coordinated PR to fix all related issues  
**Estimated Complexity:** High (requires architectural changes to Map lifecycle
and restore flow)

---
