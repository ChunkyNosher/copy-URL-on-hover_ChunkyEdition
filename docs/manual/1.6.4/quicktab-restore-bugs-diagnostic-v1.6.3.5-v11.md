# Quick Tab Restore Lifecycle Failures - Multiple Critical Bugs

**Extension Version:** v1.6.3.5-v11  
**Date:** 2025-12-04  
**Scope:** Multiple lifecycle desynchronization bugs affecting minimize/restore operations

---

## Executive Summary

Quick Tab windows suffer from **critical lifecycle desynchronization** after the first minimize/restore cycle. The core issue is that `QuickTabWindow` instances **lose their container references** (`this.container` becomes null) even though DOM elements remain attached and functional. This creates a split-brain state where:

1. The QuickTabWindow instance believes it has no container (`hasContainer: false`)
2. The DOM element is visibly rendered and accepting user interactions (drag, minimize buttons work)
3. Controllers (DragController, ResizeController) exist and function but cannot be properly cleaned up
4. Second minimize operation fails to remove DOM because the instance has lost its reference

This manifests as **three user-facing bugs**:
- **Bug #1:** Second minimize doesn't remove DOM (indicator changes but window stays visible)
- **Bug #2:** Z-index stops updating on drag after first restore (restored windows stuck behind others)
- **Bug #3:** Missing logging for critical lifecycle transitions (container reference loss, controller destruction)

These bugs were introduced during the v1.6.3 restore refactor when UICoordinator's restore detection logic was implemented.

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| 1 | Second minimize fails | QuickTabWindow | Critical | Container reference lost, cannot remove DOM |
| 2 | Z-index broken after restore | VisibilityHandler | High | Guard clause blocks updateZIndex when !hasContainer |
| 3 | Missing lifecycle logging | QuickTabWindow, UICoordinator | Medium | No logging for container loss or controller destruction |

**Why bundled:** All three issues stem from the same root cause (container reference loss during restore). Fixing the lifecycle desynchronization will resolve all three bugs simultaneously.

<scope>
**Modify:**
- `src/features/quick-tabs/window.js` - QuickTabWindow lifecycle methods (minimize, restore, render)
- `src/features/quick-tabs/coordinators/UICoordinator.js` - Restore detection and window recovery logic
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Focus/minimize guard clause logic

**Do NOT Modify:**
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Position/size persistence works correctly
- `src/features/quick-tabs/handlers/DestroyHandler.js` - Close operations work correctly
- `src/features/quick-tabs/MinimizedManager.js` - Snapshot management is not the issue
</scope>

---

## Issue #1: Second Minimize Doesn't Remove DOM Element

### Problem
After a Quick Tab has been minimized and restored once, clicking the minimize button a second time:
- Changes the Manager indicator from green to yellow (state updates correctly)
- **Leaves the Quick Tab window visible on screen** (DOM not removed)
- Cannot be interacted with after state says "minimized" (controllers destroyed but DOM persists)

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `QuickTabWindow.minimize()` method (approximate lines 450-480)  
**Issue:** Guard clauses at the beginning of `minimize()` check for `this.container` existence. If the container reference is null, the method skips DOM removal entirely:

```javascript
// Pseudocode representation of current logic:
if (!this.dragController) { /* skip cleanup */ }
if (!this.resizeController) { /* skip cleanup */ }
if (!this.container) { 
  // DOM removal is skipped here - method returns early or doesn't execute removeQuickTabElement()
  // BUT entity.minimized is STILL set to true
}
```

**Why container is null:** During the first minimize operation, `this.container = null` is explicitly set after DOM cleanup. When the first restore happens, something in the restore path fails to re-establish the container reference, leaving the instance in a permanently broken state where:
- `this.container === null`
- `this.isRendered() === false` (depends on container reference)
- DOM element exists in document and is visible
- Controllers exist and can receive events

**Evidence from logs:**
```
16:32:46 (First drag after restore):
  hasContainer: false, isAttachedToDOM: false, isRendered: false
  (Yet DOM is clearly visible and drag works)

16:33:03 (Second minimize):
  hasDragController: false, hasResizeController: false, hasContainer: false
  (Nothing to clean up, DOM removal skipped)
```

### Fix Required

The `QuickTabWindow.minimize()` method needs to **defensively locate its DOM element** even when `this.container` reference is lost. The current guard clause pattern assumes the instance always knows about its DOM, but the restore path breaks this assumption.

**Strategy:** Before DOM removal, verify the DOM element exists using `document.querySelector()` with the Quick Tab's data attribute. If found, remove it regardless of internal container state. This ensures DOM cleanup happens even when instance references are desynchronized.

**Pattern to follow:** UICoordinator's `_findDOMElementById()` method (lines 427-442) demonstrates safe DOM querying with CSS.escape() for security.

---

## Issue #2: Z-Index Stops Updating After First Restore

### Problem
After a Quick Tab has been minimized and restored once, dragging it to bring it to the front:
- Z-index value increments in entity state (`oldZIndex: 1000009, newZIndex: 1000010`)
- **Z-index is NOT applied to DOM** (window stays behind other windows visually)
- Storage persistence works (new z-index is saved)
- Visual stacking order never changes

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleFocus()` method (approximate lines 380-420)  
**Issue:** Guard clause blocks `updateZIndex()` call when container reference is missing:

```javascript
// Current guard clause pattern:
if (!tabWindow.container || !tabWindow.isRendered()) {
  console.warn('Skipped updateZIndex - container not ready');
  return; // Z-index updated in entity but NEVER applied to DOM
}
```

**Why this happens:** After first restore, `tabWindow.container` is null (same root cause as Issue #1). The guard clause treats this as "container not ready" and skips the DOM update. The z-index value IS incremented and stored, but the CSS property is never set on the actual element.

**Evidence from logs:**
```
16:32:46 (First drag after restore):
  Container validation: hasContainer false, isAttachedToDOM false, isRendered false
  Z-index increment: oldZIndex 1000009, newZIndex 1000010
  WARN: Skipped updateZIndex - container not ready
  (zIndexStoredOnEntity: 1000010, but DOM never updated)

16:32:49 (Different tab - normal lifecycle):
  Container validation: hasContainer true, isAttachedToDOM true, isRendered true
  Called tabWindow.updateZIndex, domZIndex 1000011, verified true
  (This tab works correctly because container reference exists)
```

### Fix Required

The `VisibilityHandler.handleFocus()` guard clause needs to **defensively query for DOM element** when `tabWindow.container` is null but the tab is supposed to be rendered (not minimized). 

**Strategy:** Before the guard clause rejects the update, check if the Quick Tab is **supposed to be visible** (entity.minimized === false). If yes and container is null, this indicates desynchronization - attempt to locate the DOM element and apply z-index directly using `document.querySelector()`. Only skip the update if the DOM truly doesn't exist.

**Alternative approach:** Fix the root cause in QuickTabWindow lifecycle so container reference is never lost. This would make the guard clause work as originally intended.

---

## Issue #3: Missing Lifecycle Logging for Container Reference Loss

### Problem
The logs show symptoms of container reference loss but **never log WHERE or WHEN the reference becomes null**:
- After first restore renders successfully, logs show `hasContainer: true, isRendered: true`
- Before first drag (seconds later), logs show `hasContainer: false, isRendered: false`
- **No log entry exists between these two states** showing what caused the transition

Additionally, controller destruction is implied but never explicitly logged:
- After first minimize, controllers report as existing
- After first restore, controllers report as not existing
- **No log entry shows when/why controllers were destroyed**

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** Multiple methods - `render()`, `minimize()`, `restore()`, and any place `this.container` is modified  
**Issue:** The codebase doesn't log when critical instance properties change state:

1. **Container reference assignment/nullification** - Logs show AFTER the fact (`hasContainer: false`) but not the transition itself
2. **Controller lifecycle** - `DragController` and `ResizeController` destruction is never logged
3. **Restore completion** - `restore()` method doesn't log what state the instance is in after completion

**Why this matters:** The missing logs make it impossible to pinpoint:
- Which code path sets `this.container = null` during/after restore
- Whether controllers are destroyed during minimize and never recreated
- What the intended vs actual state is after restore completes

### Fix Required

Add comprehensive lifecycle logging at **state transition points** (not just before operations):

**In `window.js`:**
- Log immediately AFTER `this.container` is set or nullified (both assignments)
- Log AFTER `this.dragController` and `this.resizeController` are created or destroyed
- Log at the END of `restore()` method with full instance state snapshot

**In `UICoordinator.js`:**
- Log AFTER orphaned window recovery completes with before/after state
- Log when `renderedTabs.set()` is called after restore render
- Log if restore path creates instance without setting container reference

**Logging pattern:** Use the existing structured logging style:
```javascript
console.log('[QuickTabWindow] Container reference changed:', {
  id: this.id,
  operation: 'minimize', // or 'render', 'restore', etc.
  beforeState: 'attached',
  afterState: 'null',
  hasControllers: { drag: !!this.dragController, resize: !!this.resizeController }
});
```

---

## Shared Implementation Notes

### Root Cause Analysis: The Lifecycle Desynchronization

The fundamental problem is a **broken assumption in the QuickTabWindow lifecycle**:

**Intended Lifecycle:**
```
render() → container exists → minimize() → container = null, DOM removed
→ restore() → render() called again → container exists
```

**Actual Lifecycle (After v1.6.3 Restore Refactor):**
```
render() → container exists → minimize() → container = null, DOM removed
→ restore() → UICoordinator detects desync → render() OR orphaned recovery
→ [SOMETHING LOSES CONTAINER REFERENCE HERE] → container = null
→ Instance has no container but DOM exists
```

**The critical gap:** Between successful render and first user interaction (drag), something nullifies the container reference. Possible causes:

1. **Double render race condition** - UICoordinator calls `render()` twice in rapid succession, second call may clear state
2. **Orphaned window recovery** - Recovery path may create new instance or modify existing instance incorrectly
3. **Event handler timing** - Minimize snapshot clearing or DOM monitoring may interfere
4. **Garbage collection edge case** - Container reference lost during closure cleanup

### Fix Strategy: Two-Phase Approach

**Phase 1 (Immediate):** Add defensive DOM queries
- Modify `minimize()` to query for DOM element when container is null
- Modify `handleFocus()` to query for DOM element when container is null but tab should be visible
- This fixes user-facing bugs without requiring full lifecycle rewrite

**Phase 2 (Comprehensive):** Fix lifecycle desynchronization
- Add logging to identify WHERE container reference is lost
- Ensure `restore()` → `render()` path always establishes container reference
- Verify orphaned window recovery doesn't create split-brain state
- Add lifecycle invariant checks (container must exist if entity.minimized === false && DOM exists)

### Key Constraints

1. **Preserve existing restore logic** - UICoordinator's orphaned window detection is a safety net, don't remove it
2. **Maintain __quickTabWindow property** - This DOM property is used for recovery, must persist
3. **Keep callback wiring** - UpdateHandler and DestroyHandler callbacks work correctly, don't break them
4. **No storage changes** - Entity persistence is working, this is purely an in-memory instance issue

<acceptancecriteria>

### Issue #1 - Second Minimize
- Second minimize operation successfully removes DOM element from document
- Quick Tab window is no longer visible after second minimize
- Manager indicator correctly shows yellow (minimized state)
- Third restore works correctly (full cycle repeatable)

### Issue #2 - Z-Index After Restore  
- Dragging restored Quick Tab brings it to front visually
- Z-index CSS property is applied to DOM element during drag
- Restored tabs can be stacked in correct visual order
- Z-index updates work on every drag, not just first drag after restore

### Issue #3 - Lifecycle Logging
- Log entry exists showing when `this.container` becomes null
- Log entry exists showing controller destruction during minimize
- Log entry exists showing full instance state at end of `restore()`
- Logs make it possible to trace lifecycle desynchronization from render → drag

### All Issues
- All existing tests pass (no regressions)
- First minimize → restore cycle works (already working)
- Second minimize → restore → drag cycle works (currently broken)
- No console errors or warnings during normal operations
- Manual test: Create tab → minimize → restore → drag (z-index updates) → minimize (DOM removed) → restore → drag (z-index updates) → close

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Evidence: Container Reference Loss Timeline</summary>

**16:32:44 - First Restore Completes:**
```
UICoordinator render() → hasContainer: false, rendered: false
→ Creates NEW window instance
→ render() succeeds, DOM attached
```

**16:32:46 - First Drag (2 seconds later):**
```
VisibilityHandler Container validation:
  hasContainer: false, isAttachedToDOM: false, isRendered: false
WARN: Skipped updateZIndex - container not ready
```

**Analysis:** Between render completion (44s) and first drag (46s), container reference was lost. No log entry shows this transition. The 2-second gap suggests this isn't immediate - something happens during the post-render stabilization period.

</details>

<details>
<summary>Evidence: Controller Lifecycle Desynchronization</summary>

**16:33:03 - Second Minimize Attempt:**
```
QuickTabWindow Minimize button clicked
hasDragController: false
hasResizeController: false
hasContainer: false
(Nothing to clean up, DOM removal skipped)
```

**16:33:06 - Second Restore:**
```
UICoordinator finds: inMap: false, inDOM: true
WARN: Orphaned window detected
Tries to recover via __quickTabWindow property
Creates/reuses window with hasContainer: true
```

**Analysis:** Controllers were destroyed at some point between first restore (when they worked) and second minimize. But there's no log entry showing their destruction. The orphaned detection finds `hasContainer: true`, suggesting recovery creates a NEW instance reference while the old instance (receiving drag events) still has `hasContainer: false`.

</details>

<details>
<summary>Evidence: Split-Brain Instance State</summary>

**Instance A (in UICoordinator.renderedTabs Map after recovery):**
```
hasContainer: true
isRendered: true
(Reported by UICoordinator orphaned recovery logs)
```

**Instance B (receiving drag events):**
```
hasContainer: false
isAttachedToDOM: false
isRendered: false
(Reported by VisibilityHandler.handleFocus logs)
```

**Analysis:** Two different QuickTabWindow conceptual "instances" exist for the same ID. Instance A is in the Map with correct state. Instance B is receiving user events but has broken state. This explains why drag works (Instance B's controllers still exist) but z-index doesn't update (Instance B's container is null so guard clause blocks it).

</details>

<details>
<summary>UICoordinator Orphaned Window Detection Logic</summary>

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Lines:** 427-442 (`_findDOMElementById`) and restoration logic

The orphaned window detection works as follows:
1. `render()` checks if ID exists in `renderedTabs` Map
2. If not in Map but DOM element exists (via `querySelector('[data-quicktab-id="..."]')`), it's orphaned
3. Recovery attempts to use `__quickTabWindow` property from DOM element
4. If property exists, reuse instance; otherwise create new instance

**The problem:** Recovery path may create/reference a different instance than the one that originally rendered. The DOM element's `__quickTabWindow` property may point to the original instance (with broken state), while UICoordinator stores a new instance reference in the Map.

</details>

<details>
<summary>QuickTabWindow.minimize() Guard Clause Pattern</summary>

**Current implementation pattern** (not exact code):

```javascript
minimize() {
  // Destroy controllers first
  if (this.dragController) {
    this.dragController.destroy();
    this.dragController = null;
  }
  if (this.resizeController) {
    this.resizeController.destroy();
    this.resizeController = null;
  }
  
  // Remove DOM - BUT only if container reference exists
  if (this.container) {
    removeQuickTabElement(this.container);
    this.container = null;
  }
  
  // Update entity state (happens regardless of container)
  this.entity.minimized = true;
}
```

**The bug:** If `this.container` is already null (from previous minimize), the DOM removal is skipped but `entity.minimized` is still set to true. This creates mismatch between entity state (minimized) and actual UI state (visible).

**The fix approach:** Query for DOM element by ID before the container check:

```javascript
minimize() {
  // ... controller cleanup ...
  
  // Defensive DOM cleanup - even if container reference lost
  if (this.container) {
    removeQuickTabElement(this.container);
  } else {
    // Container reference lost, but DOM might still exist
    const domElement = document.querySelector(`[data-quicktab-id="${CSS.escape(this.id)}"]`);
    if (domElement) {
      console.warn('[QuickTabWindow] Container reference lost, using fallback DOM removal');
      removeQuickTabElement(domElement);
    }
  }
  this.container = null; // Always nullify, even if already null
  
  this.entity.minimized = true;
}
```

</details>

---

**Priority:** Critical (Issues #1-2), Medium (Issue #3)  
**Target:** Single PR to fix all three issues  
**Estimated Complexity:** Medium  
**Dependencies:** None (self-contained to Quick Tab lifecycle)

---

**Notes for GitHub Copilot Agent:**

1. **Focus on Instance State:** The core issue is `this.container` becoming null when it shouldn't. Find WHERE and WHY this happens.

2. **Two Valid Fix Paths:**
   - Path A (Defensive): Make `minimize()` and `handleFocus()` query DOM even when container is null
   - Path B (Root Cause): Fix restore lifecycle so container reference is never lost
   - **Recommend Path B** if you can locate the desynchronization point, otherwise Path A as fallback

3. **Logging is Critical:** Before fixing the bugs, add the missing lifecycle logs. They will help verify the fix works and prevent future regressions.

4. **Test the Full Cycle:** The bug only appears on the SECOND minimize after first restore. Single minimize-restore-drag works fine. Test the full sequence: create → minimize → restore → drag → minimize → restore → drag.

5. **Watch for Instance References:** The split-brain state suggests callback closures may capture old instance references. Verify that callbacks always reference the current instance in `renderedTabs` Map, not stale references from before recovery.
