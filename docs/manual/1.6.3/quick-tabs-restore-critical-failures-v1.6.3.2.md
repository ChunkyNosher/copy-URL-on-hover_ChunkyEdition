# Quick Tabs Restore: Multiple Critical Rendering Failures

**Extension Version:** v1.6.3.2 | **Date:** 2025-11-29 | **Scope:** Restore flow
creates 400×300 default windows instead of restoring original dimensions,
original windows never appear

---

## Executive Summary

The Quick Tab restore functionality has catastrophic failures causing minimized
tabs to either not restore at all or restore with incorrect 400×300 dimensions
instead of their saved size. The primary issue is a coordination failure between
UICoordinator's update() method and QuickTabWindow's restore() method, where
update() exits early when detecting a minimized state instead of rendering, and
restore() never creates DOM when container is null. Additionally, snapshot
dimensions are either never applied to the rendered window or are immediately
overwritten by default values. The Manager panel shows green indicators
(restored) while windows remain invisible, creating complete user confusion.

## Issues Overview

| Issue                                       | Component                      | Severity | Root Cause                                      |
| ------------------------------------------- | ------------------------------ | -------- | ----------------------------------------------- |
| #1: Only 400×300 window appears on restore  | UICoordinator + QuickTabWindow | Critical | Snapshot dimensions not applied or overwritten  |
| #2: Original window never appears           | UICoordinator.update()         | Critical | Early exit when isMinimized check fails         |
| #3: Subsequent restores don't render        | UICoordinator.update()         | Critical | Calls update() not render() for cached tabs     |
| #4: Manager shows green but no window       | VisibilityHandler              | Critical | State reflects entity not actual DOM            |
| #5: DOM detachment not detected immediately | UICoordinator                  | High     | Detection happens only on next user interaction |
| #6: Snapshot applied but not used           | QuickTabWindow.render()        | Critical | render() uses default or corrupted dimensions   |
| #7: restore() doesn't create DOM            | QuickTabWindow.restore()       | Critical | No fallback when container is null              |
| #8: isMinimized check prevents re-render    | UICoordinator.update()         | Critical | Checks entity state not actual DOM state        |

**Why bundled:** All issues stem from fundamental coordination failures in
restore flow where no single component ensures DOM creation with correct
dimensions. Multiple code paths assume other components will handle rendering,
resulting in no rendering at all.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` (update, _restoreExistingWindow, render methods)
- `src/features/quick-tabs/window.js` (restore, render, initialization methods)
- `src/features/quick-tabs/minimized-manager.js` (restore method snapshot application)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (restore completion verification)

**Do NOT Modify:**

- `src/features/quick-tabs/window/ResizeController.js` (minimum constraints
  working correctly)
- `src/features/quick-tabs/window/DragController.js` (drag functionality
  unrelated)
- Storage schema or persistence logic </scope>

---

## Issue #1: Only 400×300 Default Window Appears Instead of Original Size

### Problem

When user restores minimized Quick Tab, a 400×300 window appears instead of the
original saved dimensions (e.g., 960×540 or 615×466).

### Root Cause

**Files:**

- `src/features/quick-tabs/window.js`
- `src/features/quick-tabs/coordinators/UICoordinator.js`

**Location:**

- `QuickTabWindow.render()` (lines 202-304)
- `UICoordinator._createWindow()` (lines 478-507)

**Issue:** Snapshot dimensions are applied to QuickTabWindow instance properties
by MinimizedManager, but when render() executes, it uses either default values
(400×300) or values that were corrupted/reset between snapshot application and
rendering. The render() method creates container using `this.width` and
`this.height`, but these properties contain 400×300 instead of the snapshot
values (960×540).

**Evidence from logs:**

- MinimizedManager logs: "Applied snapshot to instance properties... width 960,
  height 540"
- QuickTabWindow logs: "restore called... Size 960x540"
- But user sees 400×300 window on screen

**Possible causes:**

1. Another code path resets width/height to defaults after snapshot application
2. UICoordinator.\_createWindow() uses \_getSafeSize() which returns defaults
   when entity size is missing
3. Snapshot applied to wrong QuickTabWindow instance (stale reference in Map)
4. ResizeController initialization overwrites dimensions with minimum
   constraints

### Fix Required

Ensure snapshot dimensions flow from MinimizedManager through UICoordinator to
actual render() execution without being lost or overwritten. Verify
QuickTabWindow instance receiving snapshot is same instance that calls render().
Add verification logging showing actual CSS dimensions applied to DOM element,
not just instance property values. Consider applying snapshot dimensions
directly in render() method as fallback if instance properties are incorrect.

---

## Issue #2: Original Minimized Window Never Appears After Restore

### Problem

After minimizing then restoring a Quick Tab, the original window with correct
dimensions never appears on screen. Only the 400×300 default window (Issue #1)
becomes visible, or no window appears at all.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method (lines 234-291)  
**Issue:** When restore is triggered, update() method detects tab is in
renderedTabs Map but DOM is detached. It deletes the Map entry and checks if tab
is minimized. The isMinimized check evaluates TRUE (because entity still has
minimized property set somewhere), causing method to exit with early return
instead of calling render() to create DOM.

**Evidence from logs (23:27:57.670 - First Restore):**

- UICoordinator: "Tab not rendered, rendering now"
- QuickTabWindow: "Rendered"
- This suggests first restore DOES render

**Evidence from logs (23:28:07.929 - Second Restore):**

- UICoordinator: "Updating tab" (not "Tab not rendered")
- NO "QuickTabWindow Rendered" log
- This proves subsequent restores DON'T render

**Critical code path:** When update() finds tab in Map but detects DOM is
detached via isRendered() check, it deletes Map entry then checks
`if (isMinimized)` before re-rendering. If entity's minimized property is still
true or visibility.minimized is true, the method returns early without creating
DOM.

### Fix Required

Remove early exit when isMinimized check fails during DOM detachment recovery.
If DOM is detached and tab is being restored (minimized flag transitioning to
false), always proceed with render() regardless of current entity state.
Alternatively, check BOTH the previous minimized state AND current state to
determine if restore is in progress. Add logging showing decision path: "DOM
detached, tab was minimized, now restoring - proceeding with render()" vs "DOM
detached, tab still minimized - skipping render()".

---

## Issue #3: Subsequent Restores Don't Create New DOM

### Problem

First restore after minimize attempts to render window (may fail due to Issue
#1/2). All subsequent restore attempts on same tab never call render() again,
only call update() which doesn't create DOM when it's missing.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` method (lines 234-291)  
**Issue:** After first restore adds tab to renderedTabs Map, all subsequent
state updates call update() method instead of render(). The update() method
assumes tab is already rendered and only updates properties. When DOM is
actually missing or detached, update() should fall back to render() but the
conditional logic prevents this in certain scenarios.

**Flow breakdown:**

1. First restore: Tab not in Map → calls render() → adds to Map
2. Window fails to appear (Issue #1/2)
3. User clicks restore again
4. Tab IS in Map → calls update() not render()
5. update() checks isRendered() → false (DOM detached)
6. Should call render() but exits early due to isMinimized check

**Evidence:**

- First restore logs: "WARN Tab not rendered, rendering now"
- Second restore logs: "Updating tab" (never "rendering now")
- Third restore logs: Same as second

### Fix Required

When update() detects DOM is detached via isRendered() check, always call
render() regardless of Map state or minimized flag. The presence of tab in Map
should not prevent re-rendering when DOM is confirmed missing. Add fallback
logic: if update() completes without creating DOM and isRendered() still returns
false, force call to render() as emergency recovery. Consider removing
renderedTabs Map entirely and always checking actual DOM presence instead of
cached Map state.

---

## Issue #4: Manager Indicator Shows Green (Restored) But No Window Visible

### Problem

Manager panel shows green indicator indicating Quick Tab is restored and
visible, but no window appears on screen. This creates complete confusion where
UI state contradicts actual visibility.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** Restore completion and state emission  
**Issue:** VisibilityHandler emits state updated event with minimized false as
soon as restore() method completes, before verifying DOM actually rendered.
Manager panel listens to this event and updates indicator color based on entity
state, not actual DOM presence.

**Evidence from logs:**

- "Content Restored Quick Tab" logged immediately after restore() call
- "VisibilityHandler Emitted state updated for restore"
- No verification that DOM element exists in document
- Manager receives state updated event and changes indicator to green
- But isRendered() would return false because container.parentNode is null

### Fix Required

Delay state updated event emission until after DOM verification confirms window
is actually rendered and attached. Add verification step in VisibilityHandler
that checks tabWindow.isRendered() after restore completes. Only emit state
updated with minimized false if DOM verification passes. If verification fails,
keep state as minimized true and log error. Alternatively, have Manager panel
query actual DOM presence when updating indicators instead of trusting entity
state.

---

## Issue #5: DOM Detachment Not Detected Until Next Interaction

### Problem

When restore fails to create DOM or DOM becomes detached, UICoordinator doesn't
detect this until user tries to interact again (minimize, focus, etc.). The
detached state exists silently without warnings.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** isRendered() validation only occurs reactively  
**Issue:** The isRendered() check that detects DOM detachment only executes when
update() or other methods are called. There's no proactive monitoring that
detects when DOM becomes detached between operations. The system can remain in
broken state indefinitely until user triggers another operation.

**Evidence from logs (23:29:33.549):**

- "UICoordinator Tab in map but DOM detached, cleaning up"
- This log appears 14+ seconds after initial restore
- Only appears when user clicked minimize again
- No proactive detection when detachment occurred

### Fix Required

Add proactive DOM verification after restore completes. Implement setTimeout
check 100-200ms after render() to verify DOM is still attached. If detachment
detected, immediately clean up Map entry and emit warning event. Consider adding
periodic reconciliation sweep that validates all entries in renderedTabs Map
have attached DOM. Log warning immediately when detachment detected instead of
waiting for next user interaction.

---

## Issue #6: Snapshot Dimensions Applied But Not Used in Rendering

### Problem

MinimizedManager successfully applies snapshot dimensions to QuickTabWindow
instance (logs confirm this), but the rendered window appears with different
dimensions (400×300 defaults).

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `render()` method (lines 202-304)  
**Issue:** Even though instance properties this.width and this.height are set to
snapshot values before render() executes, the actual DOM element created has
default dimensions. This suggests either render() doesn't use instance
properties correctly, or something between snapshot application and DOM creation
resets the values.

**Evidence:**

- Logs show: "Applied snapshot to instance properties... width 960, height 540"
- Logs show: "restore called... Size 960x540"
- User sees: 400×300 window
- Gap: No log confirming DOM element created with specified dimensions

**Possible causes:**

1. render() method initializes width/height from options parameter instead of
   instance properties
2. UICoordinator.\_createWindow() calls factory with default values instead of
   snapshot values
3. ResizeController initialization enforces minimum size and overwrites snapshot
   values
4. Snapshot applied to stale QuickTabWindow instance in MinimizedManager Map,
   but UICoordinator uses different instance

### Fix Required

Add logging in render() showing exact values used for DOM creation: "Creating
container with width this.width, height this.height". Verify render() uses
this.width not options.width or defaults. Ensure MinimizedManager returns same
QuickTabWindow instance that UICoordinator uses for rendering. Consider passing
snapshot dimensions as explicit parameters to render() method instead of relying
on instance properties. Verify ResizeController doesn't override dimensions
during initialization.

---

## Issue #7: QuickTabWindow.restore() Doesn't Create DOM When Container Null

### Problem

The restore() method sets minimized flag to false and updates position/size
properties, but when this.container is null (after minimize removed it), the
method doesn't create new DOM.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `restore()` method (lines 615-641)  
**Issue:** Method contains conditional "if container exists, update display" but
no else clause to handle case where container is null. After minimize sets
container to null, restore() just updates instance state and exits without
creating DOM. Comment says "UICoordinator is single rendering authority" but
UICoordinator doesn't always render when it should (Issue #2, #3).

**Code structure:**

```
restore() {
  this.minimized = false;

  if (this.container) {
    // Update existing container display
  }

  // NO ELSE - if container null, does nothing!

  this.onFocus(this.id);
}
```

**Result:** restore() becomes a no-op when container is null, violating
principle of least surprise. Method called "restore" should actually restore the
window, not just update a flag.

### Fix Required

Add fallback in restore() to call render() when container is null. This provides
defensive programming against UICoordinator failures. Alternatively, if
UICoordinator must remain single rendering authority, add explicit verification
that UICoordinator WILL call render(), and log error if it doesn't. At minimum,
add warning log when restore() called with null container: "restore called but
container is null, relying on UICoordinator to render". Consider renaming method
to updateMinimizedState() if it's not responsible for actual restoration.

---

## Issue #8: isMinimized Check Uses Entity State Not DOM State

### Problem

Throughout UICoordinator, checks for "is this tab minimized" use
entity.minimized or entity.visibility.minimized properties instead of checking
actual DOM state. This causes wrong decisions when entity state doesn't match
reality.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Multiple methods including update() line 238  
**Issue:** The isMinimized check evaluates entity properties that may not
reflect actual current state. During restore operation, entity might still have
minimized true while transition to restored state is in progress. Checking this
stale state causes update() to skip rendering when it should proceed.

**Specific code:**

```
const isMinimized = Boolean(quickTab.minimized || quickTab.visibility?.minimized);

if (isMinimized) {
  return; // Early exit prevents rendering
}
```

**Problem scenarios:**

1. Entity updated asynchronously, minimized property lags behind actual
   operation
2. Restore sets QuickTabWindow.minimized to false but entity object still has
   minimized true
3. Race condition between state update and DOM creation

### Fix Required

Replace isMinimized checks with actual DOM state verification. Instead of
checking entity.minimized, check tabWindow.minimized (instance property). For
render decisions, check both previous state and target state to determine if
transition is in progress. Add state machine logic: if was minimized AND now not
minimized → render required. If minimized hasn't changed → skip render. Consider
adding explicit "restoring" state flag that's true during transition from
minimized to restored.

---

## Shared Implementation Notes

**Rendering Authority:**

- Establish clear contract: either UICoordinator is SOLE authority (remove all
  render() calls from other components), OR QuickTabWindow is responsible for
  own lifecycle (always call render() in restore())
- Current hybrid approach where both components assume the other will render
  causes failures
- Recommended: UICoordinator is authority, but QuickTabWindow.restore() must
  verify UICoordinator will render and error if not

**Snapshot Flow:**

- Snapshot application must happen immediately before render() with no
  intermediate code that could reset values
- Consider passing snapshot as parameter directly to render() instead of relying
  on instance properties
- Add checksum or validation to verify snapshot values survive from application
  to DOM creation

**DOM Verification:**

- Every render() call must be followed by verification that DOM was created and
  attached
- isRendered() check must return true before declaring operation successful
- Add timeout-based verification: if render() called but isRendered() still
  false after 100ms, log critical error

**State Synchronization:**

- Manager indicator updates must wait for DOM verification, not just entity
  state change
- Add verification callback: VisibilityHandler emits "restore-complete" only
  after isRendered() returns true
- Consider adding DOM mutation observer to detect when Quick Tab windows removed
  without going through proper destroy flow

**Dimension Preservation:**

- Add logging at every step showing width/height values: snapshot application →
  instance properties → render() parameters → actual CSS
- This creates audit trail to identify where dimensions get lost
- Consider storing dimensions in multiple places (instance, Map entry, DOM
  dataset attribute) for redundancy

**Error Recovery:**

- Add periodic reconciliation that verifies all tabs in Manager have
  corresponding DOM (or are marked minimized)
- If mismatch detected, force re-render or update Manager to match reality
- Consider "force restore" button in Manager that bypasses all caching and
  always creates fresh window

<acceptance_criteria> **Issue #1 (Critical):**

- [ ] Restored window appears with exact saved dimensions (e.g., 960×540, not
      400×300)
- [ ] Snapshot dimensions flow from MinimizedManager to rendered DOM without
      loss
- [ ] Logging confirms DOM created with correct width/height CSS values
- [ ] Manual test: create 960×540 window → minimize → restore → verify 960×540
      window appears

**Issue #2 (Critical):**

- [ ] Original window always appears after restore, never remains hidden
- [ ] No early exit in update() when restoring minimized tab
- [ ] Manual test: minimize → restore → verify window visible at saved position

**Issue #3 (Critical):**

- [ ] Subsequent restore attempts (2nd, 3rd, etc.) successfully render if DOM
      missing
- [ ] update() always falls back to render() when isRendered() returns false
- [ ] Manual test: minimize → restore → minimize → restore → both restores show
      window

**Issue #4 (Critical):**

- [ ] Manager indicator only turns green after DOM verification confirms window
      visible
- [ ] State updated event only emitted after isRendered() returns true
- [ ] Manual test: restore → verify Manager green matches actual window
      visibility

**Issue #5 (High):**

- [ ] DOM detachment detected within 200ms of occurrence
- [ ] Warning logged immediately when detachment detected
- [ ] Manual test: cause DOM detachment → verify warning appears within 200ms

**Issue #6 (Critical):**

- [ ] Snapshot dimensions applied to instance properties survive to render()
      execution
- [ ] render() uses snapshot values not defaults
- [ ] Logging shows: snapshot → instance → render params → CSS all match
- [ ] Manual test: minimize 615×466 window → restore → verify 615×466 appears

**Issue #7 (Critical):**

- [ ] restore() either creates DOM when container null OR verifies UICoordinator
      will render
- [ ] No silent no-op when restore() called with null container
- [ ] Error logged if restore() completes but DOM still not created

**Issue #8 (High):**

- [ ] isMinimized checks use actual QuickTabWindow instance state not entity
      state
- [ ] No early exits based on stale entity minimized property
- [ ] State transitions properly detected (minimized → restored)

**All Issues:**

- [ ] All existing tests pass
- [ ] No console errors or warnings during restore operations
- [ ] Integration test: create tab → move/resize → minimize → restore → verify
      exact position/size
- [ ] Stress test: minimize/restore same tab 10 times rapidly → all restores
      succeed
- [ ] Manager state always matches actual DOM visibility (no green indicators
      for hidden windows) </acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Dimension Loss Analysis</summary>

**Snapshot Application Evidence:** Logs confirm MinimizedManager.restore()
successfully sets instance properties:

```
Applied snapshot to instance properties id qt-121-1764458872999-1wlp32esed25t, left 186, top 398, width 960, height 540
```

**QuickTabWindow Confirmation:** Instance properties correctly set as shown in
restore() log:

```
QuickTabWindow restore called - ID qt-121-1764458872999-1wlp32esed25t, Position 186, 398, Size 960x540
```

**Missing Evidence:** No log shows actual DOM creation with these dimensions.
The gap between "Applied snapshot" and user seeing 400×300 window suggests
dimensions lost during one of these steps:

1. UICoordinator.\_createWindow() may call factory with default options
2. createQuickTabWindow() factory may not use instance properties
3. render() may initialize from defaults instead of instance
4. ResizeController may enforce minimums during initialization

**Default Size Source:** The 400×300 dimensions exactly match ResizeController
minimum constraints defined in window.js render():

```
this.resizeController = new ResizeController(this, {
  minWidth: 400,
  minHeight: 300
});
```

This suggests either:

- Window created smaller than minimums, ResizeController enforces floor
- Window properties corrupted to 0 or undefined, defaults to minimums
- Separate code path creates window without snapshot dimensions
</details>

<details>
<summary>Issue #2: Early Exit Logic Trace</summary>

**UICoordinator.update() Decision Tree:**

```
update(quickTab) {
  const tabWindow = this.renderedTabs.get(quickTab.id);
  const isMinimized = Boolean(quickTab.minimized || quickTab.visibility?.minimized);

  if (!tabWindow) {
    if (isMinimized) {
      return; // Skip render for minimized tabs
    }
    return this.render(quickTab); // Render new tab
  }

  if (!tabWindow.isRendered()) {
    // DOM detached
    this.renderedTabs.delete(quickTab.id);

    if (isMinimized) {
      return; // ← PROBLEM: Early exit when restoring!
    }
    return this.render(quickTab);
  }

  // Handle restore transition
  if (tabWindow.minimized && !isMinimized) {
    return this._restoreExistingWindow(tabWindow, quickTab.id);
  }
}
```

**The Bug:** When restore is in progress:

1. tabWindow exists in Map (from first restore attempt)
2. tabWindow.isRendered() returns false (DOM detached)
3. Map entry deleted
4. isMinimized checks quickTab.minimized → still TRUE (entity not updated yet)
5. Early return prevents rendering

**Why Entity Still Shows Minimized:** State update may be asynchronous.
QuickTabWindow.minimized set to false, but QuickTab entity minimized property
updated separately. If update() checks entity before async update completes,
sees stale minimized true value.

</details>

<details>
<summary>Issue #3: First vs Subsequent Restore Behavior</summary>

**First Restore Sequence (23:27:57.670):**

1. RESTOREQUICKTAB message received
2. VisibilityHandler.handleRestore() called
3. MinimizedManager.restore() applies snapshot
4. QuickTabWindow.restore() updates instance state
5. VisibilityHandler emits state updated
6. UICoordinator.update() receives event
7. Tab NOT in renderedTabs Map
8. Logs: "WARN Tab not rendered, rendering now"
9. UICoordinator.render() creates window
10. Tab added to Map

**Second Restore Sequence (23:28:07.929):**

1. RESTOREQUICKTAB message received
2. MinimizedManager.restore() applies snapshot
3. QuickTabWindow.restore() updates instance state
4. VisibilityHandler emits state updated
5. UICoordinator.update() receives event
6. Tab IS in renderedTabs Map (from first restore)
7. Logs: "UICoordinator Updating tab" (no "rendering now")
8. update() calls update() not render()
9. No QuickTabWindow.Rendered log
10. Window never appears

**Key Difference:** Map presence determines code path. Once tab added to Map
(even if render failed), all subsequent updates follow update() path not
render() path.

</details>

<details>
<summary>Issue #6: Instance Property vs DOM State Mismatch</summary>

**Instance Properties Set Correctly:**

```
tabWindow.left = 186
tabWindow.top = 398
tabWindow.width = 960
tabWindow.height = 540
```

**But DOM Element Has Different Values:** User reports seeing 400×300 window,
suggesting DOM created with:

```
container.style.width = '400px'
container.style.height = '300px'
```

**Possible Explanations:**

**Theory 1: Wrong Instance**

- MinimizedManager stores snapshot for instance A
- UICoordinator renders instance B (different reference)
- Instance B has default width/height 400×300

**Theory 2: Race Condition**

- Snapshot applied to instance at time T
- Instance properties reset to defaults at time T+1
- render() executes at time T+2 using reset values

**Theory 3: Factory Override**

- createQuickTabWindow() factory receives options with width/height defaults
- Factory creates new instance with these defaults
- Snapshot-updated instance never used for rendering

**Theory 4: Initialization Order**

- render() called before snapshot applied
- Window created with default dimensions
- Snapshot applied after DOM already created
- No code updates existing DOM to match new instance properties

**Verification Needed:** Add logging showing object identity: "Applying snapshot
to instance [object ID]" and "Rendering instance [object ID]". If IDs differ,
confirms Theory 1. If same ID but different values, confirms Theory 2-4.

</details>

<details>
<summary>Architecture Context: Rendering Responsibility Confusion</summary>

**v1.6.3.2 Comment in QuickTabWindow.restore():**

> "Do NOT call render() here! UICoordinator is the single rendering authority."

**Intent:** Prevent duplicate rendering bug where both QuickTabWindow and
UICoordinator call render(), creating two windows.

**Actual Result:** Neither component renders in failure scenarios:

- QuickTabWindow doesn't render (follows comment)
- UICoordinator doesn't render (exits early due to isMinimized check)
- Result: No window at all

**Better Approach:** Explicit rendering contract with verification:

- QuickTabWindow.restore() NEVER renders
- UICoordinator.\_restoreExistingWindow() ALWAYS verifies render happens
- If isRendered() returns false after restore completes, throw error
- Error forces fix instead of silent failure

**Current Problem:** Implicit assumptions without verification:

- QuickTabWindow assumes UICoordinator will render
- UICoordinator assumes QuickTabWindow already rendered
- No component verifies assumption correct
- Failure mode is silent (no error, just no window)
</details>

---

**Priority:** Critical (All Issues) | **Target:** Single coordinated PR with
comprehensive fix | **Estimated Complexity:** High (requires architectural
clarification of rendering responsibility)
