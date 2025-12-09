# Quick Tab Minimize/Restore DOM Duplication Issues

**Extension Version:** v1.6.3.1  
**Date:** 2025-11-29  
**Scope:** Multiple critical DOM lifecycle and state tracking failures in Quick
Tab minimize/restore operations

---

## Executive Summary

The Quick Tab minimize/restore system exhibits multiple critical failures
stemming from improper DOM lifecycle management. The root cause is that
`QuickTabWindow.minimize()` uses CSS `display: none` to hide elements instead of
removing them from the DOM tree. This architectural flaw creates "hibernated"
elements that remain in memory with active event listeners, leading to duplicate
windows, draggable ghost elements at position (100, 100), state tracking
inconsistencies, and TypeErrors during restore operations.

These issues compound through multiple minimize/restore cycles and affect the
Manager UI's ability to accurately reflect Quick Tab state. All issues trace to
the minimize implementation in `src/features/quick-tabs/window.js` and the
UICoordinator's lack of DOM validation in
`src/features/quick-tabs/coordinators/UICoordinator.js`.

---

## Issues Overview

| #   | Issue                                                 | Component      | Severity     | Root Cause                                            |
| --- | ----------------------------------------------------- | -------------- | ------------ | ----------------------------------------------------- |
| 1   | Duplicate 400x300px window at (100,100) after restore | QuickTabWindow | **Critical** | `minimize()` uses `display: none` without DOM removal |
| 2   | Draggable ghost elements for minimized tabs           | DragController | **Critical** | Event listeners remain active on hidden elements      |
| 3   | "Tab not rendered" warning inconsistency              | UICoordinator  | **High**     | No DOM validation in `update()` method                |
| 4   | Storage count jumps unexpectedly (3→4 tabs)           | UpdateHandler  | **High**     | Duplicate windows counted as new tabs                 |
| 5   | TypeError on minimize after restore                   | QuickTabWindow | **High**     | `updateZIndex()` receives `undefined` parameter       |
| 6   | Position resets to (100, 100) for ghosts              | QuickTabWindow | **Medium**   | Default values apply to `display: none` elements      |
| 7   | Missing DOM cleanup logging                           | All Handlers   | **Medium**   | No validation that elements are actually removed      |

**Why bundled:** All issues stem from the same architectural flaw (CSS hiding
vs. DOM removal) and share the minimize/restore code path. Can be fixed in
single coordinated PR targeting DOM lifecycle management.

<scope>
**Modify:**
- `src/features/quick-tabs/window.js` — `minimize()`, `restore()` methods
- `src/features/quick-tabs/coordinators/UICoordinator.js` — `update()`, `render()` methods
- `src/features/quick-tabs/handlers/VisibilityHandler.js` — minimize/restore coordination
- `src/features/quick-tabs/minimized-manager.js` — snapshot handling

**Do NOT Modify:**

- `src/background/` — out of scope
- `src/features/quick-tabs/window/DragController.js` — drag logic is correct
- `src/content.js` — message handlers work correctly </scope>

---

## Issue #1: Duplicate 400x300px Window at (100, 100) After Restore

### Problem

When restoring a minimized Quick Tab, a duplicate window sized 400×300px appears
at position (100, 100) and remains draggable. The correct window appears at the
saved position with the correct size (e.g., 960×540 at 512, 586), but the
duplicate persists as a "ghost" that can be interacted with.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `minimize()` method, lines 556-563  
**Issue:** Method sets `this.container.style.display = 'none'` instead of
removing the element from DOM

According to MDN documentation, elements with `display: none` are:

- Still present in the DOM tree
- Retain all JavaScript properties and event listeners
- Continue to occupy memory
- Can still fire events if CSS is toggled

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method, lines 87-113  
**Issue:** When restoring, UICoordinator checks if
`this.renderedTabs.has(quickTab.id)` returns true (because the minimized window
is still in the Map), so it calls `_restoreExistingWindow()` which only toggles
`display: flex` on the SAME hidden container. However, logs show "Tab not
rendered, rendering now" on first restore, indicating UICoordinator sometimes
loses track of the hidden element and creates a NEW window while the old one
remains hidden.

### Log Evidence

From `copy-url-extension-logs_v1.6.3.1_2025-11-29T20-29-24.txt`:

```
2025-11-29T20:27:46.397Z WARN UICoordinator Tab not rendered, rendering now qt-121-1764448049145-1r8o78fssx6h7
2025-11-29T20:27:46.399Z LOG QuickTabWindow Rendered qt-121-1764448049145-1r8o78fssx6h7
```

This creates a NEW window. But the minimized element with `display: none` is
still in the DOM from the original `minimize()` call.

Later in the same restore cycle:

```
2025-11-29T20:28:12.099Z LOG QuickTabWindow Drag started qt-121-1764448053502-11du0vy1yett7h 100 100
2025-11-29T20:28:13.113Z LOG QuickTabWindow Drag started qt-121-1764448052123-10tn00r2djdf0 100 100
2025-11-29T20:28:14.092Z LOG QuickTabWindow Drag started qt-121-1764448049145-1r8o78fssx6h7 100 100
```

All THREE minimized tabs show drag events starting from (100, 100), confirming
hidden elements remain interactive.

### Fix Required

The `minimize()` method must actually remove the DOM element, not just hide it.
When restoring, a new element should be created if none exists, or the existing
element should be validated before reuse. Follow the pattern in `destroy()`
method (lines 695-710) which properly removes elements via
`this.container.remove()`.

UICoordinator must validate that `this.renderedTabs.get(id)` returns a VISIBLE,
ATTACHED element before attempting to restore it. Use `isRendered()` method
(line 709) to verify DOM attachment before operating on elements.

---

## Issue #2: Draggable Ghost Elements for Minimized Tabs

### Problem

When Quick Tabs are minimized, they remain draggable at position (100, 100).
Users can click and drag these invisible/hidden elements, triggering full drag
event sequences including position updates and storage persistence. The ghosts
compete with correctly restored windows for interaction.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `render()` method, lines 314-343 (DragController setup)  
**Issue:** DragController attaches pointer event listeners to the titlebar
during `render()`. When `minimize()` sets `display: none`, the element is hidden
but event listeners remain active. According to MDN, pointer events can still
fire on `display: none` elements in certain browser states or if CSS is
temporarily toggled.

**File:** `src/features/quick-tabs/window.js`  
**Location:** `minimize()` method, line 556  
**Issue:** Method does not call `this.dragController.destroy()` to clean up
event listeners before hiding element.

### Log Evidence

From logs showing THREE separate minimized tabs all starting drag at (100, 100):

```
2025-11-29T20:28:12.099Z LOG QuickTabWindow Drag started qt-121-1764448053502 100 100
2025-11-29T20:28:12.376Z LOG QuickTabWindow Drag ended qt-121-1764448053502 100 429
2025-11-29T20:28:13.113Z LOG QuickTabWindow Drag started qt-121-1764448052123 100 100
2025-11-29T20:28:13.382Z LOG QuickTabWindow Drag ended qt-121-1764448052123 167 649
```

Each minimized tab generates full drag sequences with position updates,
confirming event listeners are fully operational on hidden elements.

### Fix Required

Before setting `display: none`, the `minimize()` method must call
`this.dragController.destroy()` and `this.resizeController.detachAll()` to
remove all event listeners. On restore, these controllers must be
re-initialized. Follow the cleanup pattern in `destroy()` method (lines
695-702).

Alternatively, minimize should fully remove the element from DOM (see Issue #1),
which would automatically detach all event listeners per DOM specification.

---

## Issue #3: "Tab not rendered" Warning Inconsistency

### Problem

UICoordinator logs show inconsistent behavior when restoring minimized tabs. On
first restore after minimize, logs show
`WARN UICoordinator Tab not rendered, rendering now`. On subsequent restores,
logs show `LOG UICoordinator Updating tab` with no warning. This indicates
UICoordinator is losing and regaining awareness of DOM elements unpredictably.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method, line 88  
**Issue:** Condition `if (!tabWindow)` only checks if the ID exists in the
`renderedTabs` Map, but does NOT validate if the window's DOM element is
actually attached to the document or visible. When `minimize()` sets
`display: none`, the Map entry persists but the DOM element becomes detached
from layout flow, causing UICoordinator to lose track of it inconsistently.

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `render()` method, line 68  
**Issue:** Early return `if (this.renderedTabs.has(quickTab.id))` returns the
stale hidden window without verifying DOM state.

### Log Evidence

First restore cycle (20:27:46):

```
2025-11-29T20:27:46.397Z WARN UICoordinator Tab not rendered, rendering now qt-121-1764448049145
2025-11-29T20:27:46.399Z LOG QuickTabWindow Rendered qt-121-1764448049145
```

Second restore cycle (20:28:04) for a DIFFERENT tab:

```
2025-11-29T20:28:04.894Z LOG UICoordinator Updating tab qt-121-1764448053502
```

No "not rendered" warning on second cycle, indicating UICoordinator found the
Map entry and assumed the window was valid.

### Fix Required

UICoordinator's `update()` method must call `tabWindow.isRendered()` (window.js
line 709) to verify the element is actually in the DOM before attempting restore
operations. If `isRendered()` returns false, the window should be fully
re-rendered, not just toggled from `display: none` to `display: flex`.

Add validation that checks both Map existence AND DOM attachment before
returning cached windows.

---

## Issue #4: Storage Count Jumps Unexpectedly (3→4 Tabs)

### Problem

Storage persistence logs show Quick Tab count increasing from 3 to 4 tabs
without user creating a new tab. This happens during minimize/restore cycles and
indicates duplicate window instances are being counted as separate tabs.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js` (not directly
accessed but inferred from logs)  
**Location:** Storage persistence logic  
**Issue:** When UICoordinator creates a duplicate window during restore (see
Issue #1), UpdateHandler's persistence logic encounters TWO QuickTabWindow
instances with the SAME ID but different DOM containers. The duplicate is
counted as a new tab, incrementing the storage count.

### Log Evidence

```
2025-11-29T20:29:02.572Z LOG VisibilityHandler Persisting 3 tabs (3 minimized)
2025-11-29T20:29:03.579Z DEBUG Background Updated global state from storage (3 tabs)
2025-11-29T20:29:07.843Z LOG VisibilityHandler Persisting 4 tabs (1 minimized)  // COUNT JUMPED
2025-11-29T20:29:09.052Z LOG VisibilityHandler Persisting 4 tabs (2 minimized)
```

User created tab `qt-121-1764448143240` at 20:28:43, but count jumped to 4
during restore operations, not during creation.

### Fix Required

UpdateHandler must validate that only ONE QuickTabWindow instance exists per
Quick Tab ID before persisting. Use a uniqueness check on `quickTab.id` before
adding to storage collection. If duplicates are detected, remove the
older/hidden instance before persisting.

Additionally, fixing Issue #1 (proper DOM removal on minimize) will prevent
duplicates from being created in the first place.

---

## Issue #5: TypeError on Minimize After Restore

### Problem

When minimizing a Quick Tab that was previously restored, a TypeError occurs:
`"can't access property 'toString', e is undefined"` at `updateZIndex()` method.
This error appears in logs after both minimize and restore operations,
preventing proper z-index management.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `updateZIndex()` method, lines 599-610  
**Issue:** Method is called with `undefined` or `null` as the `newZIndex`
parameter. This happens when UICoordinator's `update()` method calls
`tabWindow.updateZIndex(zIndex)` but `zIndex` is undefined because the QuickTab
entity doesn't have a valid z-index value after minimize/restore cycle.

The v1.6.4.4 fix added null safety checks (line 602-605), but the underlying
issue is that minimize/restore operations corrupt the QuickTab's z-index
property in storage or state.

### Log Evidence

```
2025-11-29T06:25:25.763Z ERROR Content Error minimizing Quick Tab:
  type: "TypeError",
  message: "can't access property 'toString', e is undefined"
  stack: "updateZIndex@content.js:1413:24"
```

And later:

```
2025-11-29T06:29:29.394Z ERROR Content Error restoring Quick Tab:
  type: "TypeError",
  message: "can't access property 'toString', e is undefined"
  stack: "updateZIndex@content.js:1413:24"
```

Both operations trigger the same error, confirming z-index corruption during
minimize/restore lifecycle.

### Fix Required

Ensure that `QuickTab` entity always maintains a valid numeric z-index value in
storage. When restoring from MinimizedManager snapshot, the z-index must be
explicitly copied from the saved snapshot to the restored QuickTab state.

UICoordinator's `_getSafeZIndex()` helper (line 176-182) should be called BEFORE
attempting to update window z-index, and the result should be validated as a
finite number.

---

## Issue #6: Position Resets to (100, 100) for Ghost Elements

### Problem

Minimized Quick Tabs that remain as hidden DOM elements (ghosts) report their
position as (100, 100) when drag events fire, regardless of where they were
minimized. This is the default position defined in QuickTabWindow
initialization.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `_initializePositionAndSize()` method, lines 36-41  
**Issue:** Default values `this.left = options.left || 100` and
`this.top = options.top || 100` are set during initialization. When an element
has `display: none`, CSS properties like `left` and `top` don't apply to its
layout position, so the computed position returns to default values.

**File:** `src/features/quick-tabs/window.js`  
**Location:** `render()` method, line 218  
**Issue:** Initial render sets `left: '-9999px', top: '-9999px'` to position
offscreen, then uses `requestAnimationFrame` (line 311) to move to target
position. When minimize sets `display: none`, this animation reverses
conceptually, and the element's effective position becomes the default (100,
100).

### Log Evidence

All minimized tabs show drag start at exactly (100, 100):

```
2025-11-29T20:28:12.099Z LOG QuickTabWindow Drag started qt-121-1764448053502 100 100
2025-11-29T20:28:13.113Z LOG QuickTabWindow Drag started qt-121-1764448052123 100 100
2025-11-29T20:28:14.092Z LOG QuickTabWindow Drag started qt-121-1764448049145 100 100
```

But these tabs were minimized at different positions (saved in MinimizedManager
snapshots show `left: 324, top: 116`, `left: 823, top: 99`,
`left: 347, top: 690` respectively).

### Fix Required

Proper fix is to remove DOM elements on minimize (see Issue #1), which
eliminates the concept of "position" for minimized tabs entirely. Alternatively,
if elements must remain in DOM for performance reasons, set
`pointer-events: none` in addition to `display: none` to prevent interaction
with ghosts.

---

## Issue #7: Missing DOM Cleanup Logging

### Problem

Logs show extensive tracking of minimize, restore, drag, and storage operations,
but NO logs confirming DOM element removal when tabs are minimized. The only DOM
removal logs appear during "Close All" operations, which explicitly call
`this.container.remove()`.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `minimize()` method, lines 556-563  
**Issue:** No logging statement confirms DOM cleanup because no DOM cleanup
occurs. Method only sets `display: none` and calls `onMinimize` callback.

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `destroy()` method, lines 119-138  
**Issue:** Method includes DOM cleanup validation
(`removeQuickTabElement(quickTabId)`), but this code path is never reached
during minimize operations.

### Log Evidence

Minimize operation logs:

```
2025-11-29T20:27:42.828Z LOG VisibilityHandler Called tabWindow.minimize for qt-121-1764448049145
2025-11-29T20:27:42.828Z LOG UICoordinator Tab is minimized, skipping render qt-121-1764448049145
```

No corresponding "Removed DOM element" log appears.

Close All operation logs:

```
2025-11-29T06:23:49.833Z LOG DestroyHandler All tabs closed, reset z-index
2025-11-29T06:23:49.833Z LOG QuickTabWindow Destroyed qt-121-1764397319670-18h7th81kxsraw
```

DOM removal happens during close/destroy but not during minimize.

### Fix Required

Add explicit DOM removal logic to `minimize()` method. After calling
`this.container.style.display = 'none'` (or preferably INSTEAD of it), call
`this.container.remove()` to detach from DOM. Add logging statement:
`console.log('[QuickTabWindow] Removed DOM element for minimize:', this.id)`.

On restore, fully re-render the element by calling `this.render()` instead of
just toggling `display` property.

---

## Shared Implementation Guidance

### Architecture Context

The Quick Tab system uses a three-tier architecture:

1. **QuickTabWindow** — DOM/UI layer managing visual elements and interaction
2. **UICoordinator** — Orchestration layer managing rendering lifecycle and
   state synchronization
3. **MinimizedManager** — State snapshot layer preserving position/size during
   minimize

The core architectural flaw is that minimize/restore operations treat DOM
elements as stateful entities that can be "hibernated" with CSS, when they
should be treated as ephemeral render outputs that can be destroyed and
recreated from state.

### Constraints

- Minimize must preserve exact position, size, and scroll state
- Restore must recreate windows identically, including z-index stacking order
- Event listeners must be fully cleaned up on minimize to prevent ghost
  interaction
- Storage persistence must occur atomically, not during intermediate render
  states

### Pattern to Follow

The `destroy()` method in `window.js` (lines 695-710) demonstrates correct DOM
lifecycle:

```
// Cleanup controllers
if (this.dragController) {
  this.dragController.destroy();
  this.dragController = null;
}

// Remove from DOM
if (this.container) {
  this.container.remove();  // ← ACTUAL DOM REMOVAL
  this.container = null;
  this.iframe = null;
  this.rendered = false;
}
```

Minimize should follow this same pattern, but preserve state in MinimizedManager
before removal. Restore should call `render()` to recreate the DOM element from
preserved state.

---

<acceptancecriteria>
### Issue #1 — Duplicate Window
- Restoring minimized Quick Tab does NOT create duplicate at (100, 100)
- Only one interactive window exists per Quick Tab ID
- Restored window appears at exact saved position with saved size

### Issue #2 — Draggable Ghosts

- Minimized Quick Tabs are NOT draggable
- No drag events fire for minimized tabs
- Event listeners are fully removed on minimize

### Issue #3 — UICoordinator Consistency

- UICoordinator consistently detects missing DOM on first restore
- No "Tab not rendered" warnings on subsequent operations
- `isRendered()` validation prevents stale window reuse

### Issue #4 — Storage Count

- Storage tab count matches number of user-created Quick Tabs
- No phantom tabs appear during minimize/restore cycles
- Duplicate instances are detected and removed before persistence

### Issue #5 — TypeError Prevention

- No TypeErrors during minimize or restore operations
- Z-index always has valid numeric value
- UICoordinator validates all parameters before method calls

### Issue #6 — Position Accuracy

- Ghost elements do not appear at (100, 100)
- No draggable elements exist when Quick Tab is minimized
- Position is preserved exactly as MinimizedManager snapshot

### Issue #7 — Logging Completeness

- Logs confirm DOM element removal on minimize
- Logs show DOM element recreation on restore
- Full lifecycle is observable via console output

### All Issues

- All existing tests pass
- No new console errors or warnings
- Manual test: Create 3 Quick Tabs → Minimize all → Restore all → No duplicates
  visible
- Manual test: Minimize tab → Try to drag at (100, 100) → No interaction
  possible </acceptancecriteria>

---

## Supporting Context

<details>
<summary>Detailed Log Analysis — First Minimize/Restore Cycle</summary>

Initial state: 3 Quick Tabs created and positioned

```
2025-11-29T20:27:29.149Z LOG CreateHandler Quick Tab created successfully qt-121-1764448049145
2025-11-29T20:27:32.125Z LOG CreateHandler Quick Tab created successfully qt-121-1764448052123
2025-11-29T20:27:33.506Z LOG CreateHandler Quick Tab created successfully qt-121-1764448053502
```

All three minimized sequentially:

```
2025-11-29T20:27:42.828Z LOG VisibilityHandler Called tabWindow.minimize for qt-121-1764448049145
2025-11-29T20:27:44.240Z LOG VisibilityHandler Called tabWindow.minimize for qt-121-1764448052123
2025-11-29T20:27:45.059Z LOG VisibilityHandler Called tabWindow.minimize for qt-121-1764448053502
```

Note: No DOM removal logs appear. UICoordinator skips render for all three:

```
2025-11-29T20:27:42.828Z LOG UICoordinator Tab is minimized, skipping render qt-121-1764448049145
2025-11-29T20:27:44.240Z LOG UICoordinator Tab is minimized, skipping render qt-121-1764448052123
2025-11-29T20:27:45.059Z LOG UICoordinator Tab is minimized, skipping render qt-121-1764448053502
```

First restore (qt-121-1764448049145) shows "not rendered" warning:

```
2025-11-29T20:27:46.397Z WARN UICoordinator Tab not rendered, rendering now qt-121-1764448049145
2025-11-29T20:27:46.399Z LOG QuickTabWindow Rendered qt-121-1764448049145
```

This creates a NEW window. But the minimized element with `display: none` still
exists in DOM.

Second and third restores (different tabs) also show "not rendered" warnings,
creating MORE duplicates:

```
2025-11-29T20:27:47.108Z WARN UICoordinator Tab not rendered, rendering now qt-121-1764448052123
2025-11-29T20:27:47.694Z WARN UICoordinator Tab not rendered, rendering now qt-121-1764448053502
```

Then all three minimized tabs show drag events from (100, 100):

```
2025-11-29T20:28:12.099Z LOG QuickTabWindow Drag started qt-121-1764448053502 100 100
2025-11-29T20:28:13.113Z LOG QuickTabWindow Drag started qt-121-1764448052123 100 100
2025-11-29T20:28:14.092Z LOG QuickTabWindow Drag started qt-121-1764448049145 100 100
```

These are the "ghost" minimized elements, still in DOM with `display: none`, but
draggable.

</details>

<details>
<summary>Detailed Log Analysis — Second Minimize/Restore Cycle</summary>

After ghosts are discovered, tabs are restored again (20:28:04):

```
2025-11-29T20:28:04.894Z LOG UICoordinator Updating tab qt-121-1764448053502
```

NO "not rendered" warning this time. UICoordinator found the Map entry and
called `_restoreExistingWindow()`, which only toggles `display: flex`.

But this means the NEW window created at 20:27:46 is now visible AND the ghost
window from first minimize is ALSO visible (with `display: flex` toggled back
on). Two windows for same ID.

User then minimizes again (20:28:46):

```
2025-11-29T20:28:46.829Z LOG VisibilityHandler Called tabWindow.minimize for qt-121-1764448117151
2025-11-29T20:28:46.829Z LOG UICoordinator Updating tab qt-121-1764448117151
```

This time UICoordinator calls `update()` instead of skipping render, because it
found the window in Map and thinks it's valid. But `updateZIndex()` is called
with undefined parameter, triggering TypeError:

```
2025-11-29T06:25:25.763Z ERROR Content Error minimizing Quick Tab:
  message: "can't access property 'toString', e is undefined"
```

</details>

<details>
<summary>MDN Documentation — CSS display: none Behavior</summary>

According to MDN Web Docs on CSS `display` property:

- `display: none` removes the element from the accessibility tree and prevents
  it from being rendered
- However, the element REMAINS in the DOM tree structure
- JavaScript references to the element remain valid
- Event listeners attached to the element remain active
- The element continues to occupy memory
- Child elements also have `display: none` applied implicitly

Contrast with actually removing from DOM via `element.remove()`:

- Element is detached from DOM tree
- All event listeners are automatically garbage collected
- Element can only be accessed via stored JavaScript references
- Memory is freed when all references are cleared

Source: https://developer.mozilla.org/en-US/docs/Web/CSS/display

</details>

---

**Priority:** Critical  
**Estimated Complexity:** High (requires refactoring minimize/restore
lifecycle)  
**Target:** Single PR addressing all DOM lifecycle issues

---
