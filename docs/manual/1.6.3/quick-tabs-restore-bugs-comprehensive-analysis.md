# Quick Tabs Restore: Comprehensive Bug Analysis

**Extension Version:** v1.6.3.2 | **Analysis Date:** 2025-11-29 | **Status:**
Critical - Multiple Rendering Failures

---

## Executive Summary

The Quick Tab restore functionality has **catastrophic failures** causing
minimized tabs to either not restore at all or restore with incorrect 400×300
dimensions instead of their saved size (e.g., 960×540, 615×466). Through
extensive log analysis and codebase inspection, we've identified the **root
cause**: a fundamental **entity-instance synchronization gap** where snapshot
dimensions are applied to QuickTabWindow instance properties but never propagate
to the QuickTab entity, resulting in UICoordinator creating windows with default
dimensions.

### Critical Findings

| Issue                         | Component                               | Severity     | User Impact                      |
| ----------------------------- | --------------------------------------- | ------------ | -------------------------------- |
| Entity-Instance Sync Gap      | UICoordinator + MinimizedManager        | **CRITICAL** | 100% dimension loss on restore   |
| Duplicate Window Creation     | UICoordinator.\_restoreExistingWindow() | **CRITICAL** | Wrong window appears             |
| Subsequent Restore Failure    | UICoordinator.update()                  | **CRITICAL** | No window on 2nd+ restore        |
| Phantom Manager Indicators    | VisibilityHandler                       | **CRITICAL** | Green shows when nothing visible |
| DOM Detachment Silent Failure | UICoordinator                           | **HIGH**     | Broken state undetected          |
| Missing Event Deduplication   | VisibilityHandler                       | **MEDIUM**   | Duplicate minimize calls         |

**Total Impact:** Restore feature is completely non-functional. Users cannot
recover minimized Quick Tabs with correct dimensions.

---

## Root Cause Analysis

### PRIMARY BUG: Entity-Instance Synchronization Gap

**The Problem:** Snapshot dimensions are applied to QuickTabWindow **instance**
properties, but UICoordinator.\_createWindow() reads from QuickTab **entity**
properties, which are never updated.

**Evidence Chain:**

1. **MinimizedManager.restore()** (lines 52-126 in minimized-manager.js):
   - Applies snapshot to instance: `tabWindow.left = savedLeft`
   - Logs: "Instance dimensions AFTER snapshot application: width 960, height
     540"
   - **But never updates the QuickTab entity object**

2. **UICoordinator.\_createWindow()** (lines 478-507 in UICoordinator.js):
   - Reads from entity: `const size = this._getSafeSize(quickTab)`
   - `quickTab` is the **entity**, not the instance
   - Entity has no size data, so defaults to 400×300

3. **Result:**
   - Instance has correct dimensions (960×540)
   - Entity has default dimensions (400×300)
   - New window created from entity = **400×300 duplicate window**

**From the logs (212KB file, 01:20:20.205):**

```
MinimizedManager Instance dimensions AFTER snapshot application... width 960, height 540
QuickTabWindow restore called - Size 960x540
UICoordinator Rendering tab qt-121-1764465547576-3uv5qq13zp5zk
QuickTabWindow render called with dimensions... width 400, height 300 ← DIMENSION LOSS
```

**The gap:** 960×540 → 400×300 happens between lines 2 and 4 above.

### SECONDARY BUG: UICoordinator Creates New Window Instead of Reusing Instance

**The Problem:** When restoring an existing minimized window,
UICoordinator.\_restoreExistingWindow() creates a **new** QuickTabWindow
instance instead of rendering the existing one.

**Evidence:**

From UICoordinator.js lines 179-220:

- Line 199: `tabWindow.restore()` - updates existing instance state
- Line 202: `tabWindow.render()` - tries to render on existing instance
- But `tabWindow` is already in `renderedTabs` Map from first restore attempt
- This creates a second window instance with wrong dimensions

**The Working Code Path (53KB log, 01:24:02.316):**

When DOM is detached, this code path executes:

```
UICoordinator Tab in map but DOM detached, cleaning up
UICoordinator Instance NOT minimized but DOM missing, rendering
UICoordinator Restoring from snapshot, applying saved position... width 960, height 540
QuickTabWindow render called with dimensions... width 960, height 540 ← WORKS!
```

**Why it works:**

- Calls `_applySnapshotForRestore(quickTab)` which updates the **ENTITY**
- Then creates window from entity which now has correct dimensions

**Why regular restore fails:**

- Never calls `_applySnapshotForRestore()`
- Creates window from entity which still has defaults

---

## Detailed Issue Breakdown

### Issue #1: Only 400×300 Default Window Appears

**Observed Behavior:** User minimizes 960×540 Quick Tab, clicks restore, sees
400×300 window at (100, 100) instead.

**Root Cause:** UICoordinator.\_getSafeSize() returns defaults when entity.size
is undefined:

```javascript
_getSafeSize(quickTab) {
  const size = quickTab.size || {};
  return {
    width: size.width ?? 400,   // ← DEFAULTS
    height: size.height ?? 300
  };
}
```

**Log Evidence (212KB, first restore 01:20:20.205-01:20:20.312):**

1. Snapshot applied: "width 960, height 540"
2. Instance updated: "Size 960x540"
3. **But render called with:** "width 400, height 300"
4. User sees 400×300 window

**Why This Happens:**

- Snapshot applied to instance properties
- Entity properties never updated
- \_createWindow() reads entity not instance
- Default dimensions used

### Issue #2: Original Window Never Appears

**Observed Behavior:** After minimize→restore, the original window with correct
dimensions never appears. Only the 400×300 duplicate (Issue #1) becomes visible.

**Root Cause:** UICoordinator.update() early exit when entity still shows
minimized=true during restore transition.

**Log Evidence (212KB, second restore 01:21:21.236):**

```
UICoordinator Received state:updated event
WARN UICoordinator Tab not rendered, rendering now
UICoordinator Rendering tab
QuickTabWindow render called with dimensions... left 100, top 100, width 400, height 300
```

**Critical Flow:**

1. First restore adds tab to renderedTabs Map (even though render failed)
2. Second restore: tab IS in Map
3. update() called instead of render()
4. Detects DOM detached
5. Checks entity.minimized → still TRUE
6. Early return prevents re-render

**Why Entity Still Shows Minimized:** State updates may be asynchronous.
QuickTabWindow.minimized set to false, but QuickTab entity.minimized not updated
until later. Race condition causes wrong decision.

### Issue #3: Subsequent Restores Don't Create New DOM

**Observed Behavior:** First restore attempt creates 400×300 duplicate. Second,
third, fourth restore attempts create nothing at all.

**Root Cause:** After first restore adds tab to renderedTabs Map, all subsequent
calls use update() which doesn't re-render when DOM is missing.

**Log Evidence:**

- **First restore:** "WARN Tab not rendered, rendering now" + "QuickTabWindow
  Rendered"
- **Second restore:** "UICoordinator Updating tab" (no "rendering now", no
  "Rendered")
- **Third restore:** Same as second

**Decision Tree:**

```
update(quickTab) {
  if (!renderedTabs.has(id)) {
    return render(quickTab);  // ← First restore takes this path
  }

  if (!tabWindow.isRendered()) {
    renderedTabs.delete(id);
    if (entityMinimized) {
      return;  // ← Subsequent restores exit here
    }
  }
}
```

**Why Subsequent Calls Fail:**

- Tab added to Map on first restore
- Map presence triggers update() not render()
- update() detects DOM missing but exits due to entity.minimized check
- No re-render happens

### Issue #4: Manager Shows Green But No Window Visible

**Observed Behavior:** Manager panel indicator turns green (restored)
immediately, but no window appears on screen. Creates user confusion.

**Root Cause:** VisibilityHandler emits state:updated event **before** DOM
verification.

**Log Evidence (212KB, 01:20:20.312-01:20:20.314):**

```
VisibilityHandler Emitted state:updated for restore... domVerified false
```

**Flow:**

1. User clicks restore in Manager
2. VisibilityHandler.handleRestore() called
3. State:updated event emitted immediately
4. Manager receives event, updates indicator to green
5. DOM verification runs 100ms later
6. Verification fails (isRendered() returns false)
7. But Manager already shows green

**Why This Happens:**

- STATE_EMIT_DELAY_MS is only 100ms
- DOM creation may take longer
- No retry if verification fails
- Manager trusts entity state not actual DOM

### Issue #5: DOM Detachment Not Detected Until Next Interaction

**Observed Behavior:** When restore fails to create DOM, system remains in
broken state silently. No warning until user clicks minimize again (14+ seconds
later).

**Root Cause:** Reactive detection only - no proactive monitoring.

**Log Evidence (212KB, 01:21:33.549):**

```
UICoordinator Tab in map but DOM detached, cleaning up
```

This appears 73+ seconds after initial restore failure, only when user clicked
minimize button.

**Why This Happens:**

- isRendered() check only runs when update() or other methods called
- No setTimeout verification after render()
- No periodic reconciliation
- Broken state exists indefinitely

### Issue #6: Duplicate Minimize Calls

**Observed Behavior:** Every minimize operation logs duplicate lock messages.

**Log Evidence (53KB, every minimize):**

```
VisibilityHandler Minimize button clicked
MinimizedManager Added minimized tab with snapshot
VisibilityHandler Lock blocked duplicate minimize
VisibilityHandler Ignoring duplicate minimize request lock held
```

**Why This Happens:**

- Minimize button click triggers event
- Event handler called twice
- Lock prevents second execution
- But indicates event handler duplication issue

### Issue #7: Storage Write Thrashing

**Observed Behavior:** Every operation triggers 3-4 storage persist calls.

**Log Evidence:**

```
VisibilityHandler Persisting 3 tabs to storage...
DEBUG Background Storage changed
DEBUG Background Quick Tab state changed, updating cache
```

**Why This Happens:**

- Debounce delay too short
- Multiple state updates per operation
- Each triggers storage write
- Excessive I/O

---

## The "Magic Fix" Behavior

**Observed in 53KB log (01:24:02.315):**

When user performs this exact sequence:

1. Close the 400×300 duplicate window
2. Click minimize on the broken "restored" Quick Tab
3. Original Quick Tab suddenly appears with correct dimensions!

**Why This Works:**

The minimize click on the already-destroyed window triggers:

```
UICoordinator Tab in map but DOM detached, cleaning up
UICoordinator Instance NOT minimized but DOM missing, rendering
UICoordinator Restoring from snapshot, applying saved position... width 960, height 540
QuickTabWindow render called with dimensions... width 960, height 540  ← CORRECT!
```

**The difference:**

- This code path calls `_applySnapshotForRestore(quickTab)` which updates the
  **ENTITY**
- Then creates window from entity which now has correct dimensions
- Regular restore path skips `_applySnapshotForRestore()` entirely

**Key insight:** The detached DOM recovery code path is the ONLY code path that
works correctly. It should be the model for fixing regular restore.

---

## Missing Logging (Critical Gaps)

### Gap #1: No Entity-Instance Relationship Logging

**Missing:** Logs showing which instance ID receives snapshot vs which instance
ID renders **Needed:** Object identity verification to detect instance mismatch

### Gap #2: No UICoordinator Parameter Source Logging

**Missing:** Where render() dimensions come from **Current:** "render called
with dimensions... 400, 300" **Needed:** "render called with dimensions from
entity.size (400, 300)" or "from instance (960, 540)"

### Gap #3: No Map Entry Creation Logging

**Missing:** When/why tab added to renderedTabs Map **Needed:** "Added to
renderedTabs Map: id=XXX, isRendered=true/false"

### Gap #4: No Update Decision Path Logging

**Missing:** Why update() chose specific branch **Current:** "Updating tab"
**Needed:** "Updating tab: in Map=true, DOM attached=false, entity
minimized=true → early exit"

### Gap #5: No Snapshot→Entity Transfer Logging

**Missing:** Whether snapshot applied to entity **Needed:** "Applied snapshot to
entity: entity.size.width now 960"

---

## Architectural Issues

### Issue: Rendering Responsibility Confusion

**Current State:**

- QuickTabWindow.restore() comment: "Do NOT call render() here! UICoordinator is
  the single rendering authority."
- But UICoordinator doesn't always render when it should
- Result: Neither component renders → no window

**The Problem:** Implicit assumptions without verification:

- QuickTabWindow assumes UICoordinator will render
- UICoordinator assumes QuickTabWindow already rendered
- No component verifies assumption
- Failure mode is silent (no error, just no window)

**Better Approach:** Explicit contract with verification:

- Define clear SRP (Single Responsibility Principle)
- Add verification: if restore() completes but isRendered() still false after
  200ms, throw error
- Error forces fix instead of silent failure

### Issue: Entity vs Instance State Divergence

**Current State:**

- Snapshot applied to instance properties
- Entity properties never updated
- UICoordinator reads entity for rendering
- Instance properties ignored

**The Problem:** Two sources of truth with no synchronization:

- Instance properties (from snapshot)
- Entity properties (from storage)
- No mechanism to keep them in sync
- Rendering uses wrong source

**Better Approach:** Single source of truth:

- Either instance IS the entity (no separate objects)
- Or entity always updated when instance changes
- Or UICoordinator reads from instance not entity

---

## Phased Fix Strategy

### Phase 1: Immediate Fix (Entity-Instance Sync)

**Goal:** Make restore work with correct dimensions

**Approach:**

1. Update `_applySnapshotForRestore()` to modify entity.position and entity.size
2. Ensure all restore paths call this before \_createWindow()
3. Add verification logging

**Expected Result:**

- Snapshot dimensions flow to entity
- \_createWindow() uses correct values
- 960×540 window appears

### Phase 2: Eliminate Duplicate Window Creation

**Goal:** Restore existing instance instead of creating new one

**Approach:**

1. Check if tabWindow already exists before calling \_createWindow()
2. If exists and minimized, call restore() then render() on existing instance
3. If exists but DOM detached, call render() on existing instance
4. Only create new instance if none exists

**Expected Result:**

- No duplicate windows
- Original instance reused
- Correct dimensions preserved

### Phase 3: Fix Subsequent Restore Failures

**Goal:** All restore attempts succeed, not just first

**Approach:**

1. Remove early exits based on entity.minimized in update()
2. Always re-render if DOM is missing and instance.minimized is false
3. Use instance state not entity state for decisions

**Expected Result:**

- 2nd, 3rd, 4th restore all create window
- No dependency on Map state

### Phase 4: Proactive DOM Verification

**Goal:** Detect detachment immediately, not on next interaction

**Approach:**

1. Add setTimeout verification after render()
2. Check isRendered() after 150ms
3. If false, clean up Map and log error
4. Consider periodic reconciliation

**Expected Result:**

- Broken state detected within 200ms
- Warning logged immediately
- Map cleaned up proactively

### Phase 5: Manager State Synchronization

**Goal:** Green indicator only when window actually visible

**Approach:**

1. Delay state:updated emission until DOM verification passes
2. Increase STATE_EMIT_DELAY_MS to 200ms minimum
3. Add retry logic if verification fails
4. Manager queries actual DOM state not entity state

**Expected Result:**

- Indicator reflects reality
- No green when nothing visible
- User confusion eliminated

---

## Acceptance Criteria

### Critical (Must Fix)

- [ ] Restored window appears with exact saved dimensions (960×540, not 400×300)
- [ ] Snapshot dimensions flow from MinimizedManager to rendered DOM without
      loss
- [ ] Original window always appears after restore, never remains hidden
- [ ] Subsequent restore attempts (2nd, 3rd, etc.) successfully render if DOM
      missing
- [ ] Manager indicator only turns green after DOM verification confirms window
      visible

### High Priority (Should Fix)

- [ ] DOM detachment detected within 200ms of occurrence
- [ ] No early exits based on stale entity.minimized property
- [ ] Instance properties used for render decisions, not entity properties

### Medium Priority (Nice to Have)

- [ ] Duplicate minimize calls eliminated
- [ ] Storage write thrashing reduced
- [ ] Comprehensive logging for debugging

### Integration Tests

- [ ] Manual: create 960×540 window → minimize → restore → verify 960×540
      appears
- [ ] Manual: minimize → restore → minimize → restore → both restores show
      window
- [ ] Manual: restore → verify Manager green matches actual window visibility
- [ ] Stress: minimize/restore same tab 10 times rapidly → all succeed

---

## Technical Debt Notes

### Identified During Analysis

1. **renderedTabs Map caching:**
   - Prevents re-render when needed
   - Consider removing and always checking DOM
   - Or add staleness detection

2. **Async state updates:**
   - Entity updated separately from instance
   - Race conditions possible
   - Consider synchronous updates or transactions

3. **Multiple event sources:**
   - Minimize can be triggered from window OR manager
   - Lock pattern needed to prevent duplicates
   - Consider single event bus

4. **Default dimension source:**
   - Hardcoded 400×300 in multiple places
   - Should be constants
   - Or read from last successful render

5. **Instance vs Entity confusion:**
   - Two objects represent same thing
   - No clear ownership
   - Should consolidate

---

## Conclusion

The Quick Tabs restore feature has **systematic failures** caused by a
fundamental architectural flaw: snapshot dimensions are applied to instance
properties but never propagate to entity properties, and rendering reads from
entity not instance. This results in 100% dimension loss on restore operations.

The fix requires:

1. **Entity-instance synchronization** - ensure snapshot updates both
2. **Instance reuse** - stop creating duplicate windows
3. **Proactive verification** - detect failures immediately
4. **State consistency** - Manager reflects actual DOM state

Priority: **CRITICAL** - Feature completely non-functional Complexity:
**HIGH** - Requires architectural changes Risk: **MEDIUM** - Changes affect core
rendering flow

**Recommended approach:** Phased implementation starting with entity-instance
sync (highest ROI, lowest risk), followed by instance reuse and verification
improvements.
