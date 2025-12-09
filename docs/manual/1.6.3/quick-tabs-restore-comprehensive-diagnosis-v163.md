# Quick Tabs Restore: Comprehensive Diagnosis of Persistent Bugs

**Extension Version:** v1.6.3.2 | **Date:** 2025-11-29 | **Scope:** Critical
restore failures and missing diagnostics

---

## Executive Summary

Quick Tab restore functionality completely fails to render windows with correct
dimensions. Users click restore and see only 400×300 duplicate windows instead
of original 960×540 Quick Tabs. The root cause is a **timing synchronization
gap** where snapshot dimensions are deleted from MinimizedManager before
UICoordinator can read them, combined with UICoordinator reading from entity
properties that are never updated during restore. These bugs persist in v1.6.3.2
despite attempted fixes in v1.6.4.x branches.

## Issues Overview

| Issue                                     | Component                        | Severity     | User Impact                        |
| ----------------------------------------- | -------------------------------- | ------------ | ---------------------------------- |
| #1: 400×300 duplicate appears             | UICoordinator + MinimizedManager | **CRITICAL** | 100% dimension loss on restore     |
| #2: Original window never appears         | UICoordinator.update()           | **CRITICAL** | Only duplicate visible             |
| #3: Subsequent restores fail silently     | UICoordinator.update()           | **CRITICAL** | No window on 2nd+ restore          |
| #4: Manager shows green despite no window | VisibilityHandler                | **CRITICAL** | Misleading UI state                |
| #5: DOM detachment undetected             | UICoordinator                    | **HIGH**     | Broken state persists indefinitely |
| #6: Missing critical logging              | All components                   | **HIGH**     | Impossible to debug                |

**Why bundled:** All issues stem from the restore operation's snapshot lifecycle
and timing architecture. Fixing requires coordinated changes across
MinimizedManager, VisibilityHandler, and UICoordinator.

<scope>
**Modify:**
- `src/features/quick-tabs/minimized-manager.js` (restore method)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleRestore, _emitRestoreStateUpdate)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (_applySnapshotForRestore, update, _tryApplySnapshotFromManager)

**Do NOT Modify:**

- `src/features/quick-tabs/window.js` (QuickTabWindow works correctly)
- `src/background/` (out of scope)
- Storage utilities (persistence works correctly)

**Critical Constraint:** UICoordinator must remain the single rendering
authority. Do NOT call render() from multiple locations. </scope>

---

## Issue #1: Only 400×300 Duplicate Window Appears on Restore

### Problem

User minimizes 960×540 Quick Tab, clicks restore button in Manager, sees only
400×300 window at default position (100, 100) instead of original 960×540 at
saved position (822, 214).

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_tryApplySnapshotFromManager()` (lines 129-147), `update()`
(lines 265-314)  
**Issue:** Snapshot deleted by MinimizedManager.restore() before UICoordinator
tries to read it. When UICoordinator checks `isMinimized(quickTab.id)` the
snapshot is already gone, returns false, falls through to
\_tryApplyDimensionsFromInstance() which also fails because tab not in
renderedTabs Map yet. UICoordinator then renders with entity defaults (400×300).

**Event Sequence:**

1. **t=0ms:** VisibilityHandler.handleRestore() calls
   MinimizedManager.restore(id)
2. **t=0ms:** MinimizedManager.restore() applies snapshot to instance
   properties, then **deletes snapshot** via `this.minimizedTabs.delete(id)`
   (line 116 in minimized-manager.js)
3. **t=0ms:** VisibilityHandler calls tabWindow.restore() which sets
   minimized=false
4. **t=200ms:** STATE_EMIT_DELAY_MS timeout fires, emits state:updated event
5. **t=200ms+:** UICoordinator.update() receives event
6. **t=200ms+:** Calls \_applySnapshotForRestore() →
   \_tryApplySnapshotFromManager()
7. **t=200ms+:** Checks `isMinimized(id)` → **FALSE** (snapshot deleted 200ms
   ago)
8. **t=200ms+:** Returns false, logs "No snapshot available"
9. **t=200ms+:** Calls \_createWindow() with entity that has no position/size →
   defaults to 400×300

**Log Evidence (from 02:31:15.818 in latest logs):**

```
MinimizedManager Instance dimensions AFTER snapshot application... width 960, height 540
UICoordinator No snapshot available for qt-121-1764469870289-yn9jme1p5eql5
UICoordinator Rendering tab
QuickTabWindow render called with dimensions... width 400, height 300  ← DIMENSION LOSS
```

### Fix Required

Do NOT delete snapshot in MinimizedManager.restore(). Keep snapshot available
until UICoordinator confirms successful render. Add snapshot cleanup method that
UICoordinator calls after DOM verification passes. Alternatively, apply snapshot
to both instance AND entity before deleting.

---

## Issue #2: Original Window Never Appears After Restore Attempt

### Problem

After restore button clicked and 400×300 duplicate appears, the original window
dimensions (960×540) are never rendered on screen. Clicking restore again does
nothing.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` (lines 265-314)  
**Issue:** First restore adds tab to renderedTabs Map even though render failed
with wrong dimensions. Second restore calls update() instead of render() because
tab already in Map. update() detects DOM missing but exits early due to stale
entity.minimized check instead of using instance.minimized state.

**Event Sequence:**

1. **First restore (02:31:15.818):** Tab NOT in Map → calls render() → 400×300
   duplicate created → tab added to Map
2. **Second restore (02:32:21.560):** Tab IS in Map → calls update() instead of
   render()
3. **update() detects DOM detached** but checks entity.minimized which may still
   be true during async state transition
4. **Early return** without re-render
5. **No window appears**

**Log Evidence:**

```
# First restore
UICoordinator Tab not rendered, rendering now
QuickTabWindow Rendered qt-121-1764469870289-yn9jme1p5eql5

# Second restore (same tab)
UICoordinator Updating tab qt-121-1764469870289-yn9jme1p5eql5  ← Calls update() not render()
UICoordinator Tab updated  ← No "rendering now" log
```

### Fix Required

When DOM is detached and instance.minimized is false, ALWAYS re-render
regardless of entity state. Use instance.minimized (line 278) not
entity.minimized for decision logic in update(). Already partially implemented
in lines 284-297 but conditional logic still references entity state in some
paths.

---

## Issue #3: Subsequent Restore Attempts Do Nothing

### Problem

First restore creates 400×300 duplicate. Second, third, fourth restore attempts
create no window at all. User must close duplicate, minimize "restored" tab,
then restore again to trigger working code path.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` (lines 284-297)  
**Issue:** After first restore adds tab to Map, subsequent calls use update()
path which detects DOM detached but exits without rendering when
entity.minimized check passes. No re-render logic executed.

**Decision Tree:**

```
update(quickTab) receives event
  → Tab in renderedTabs Map? YES (from first restore)
  → Call isRendered()? FALSE (DOM detached)
  → Delete from Map
  → Check entityMinimized? TRUE (stale state)
  → Early return  ← BUG: Should render here
```

**Log Evidence:**

- **First restore:** "WARN Tab not rendered, rendering now" + creates window
- **Second restore:** "Updating tab" (no warning, no render, no window)
- **Third restore:** "Updating tab" (no warning, no render, no window)

### Fix Required

Remove early exit based on entity.minimized in update() method lines 289-293.
When DOM is detached and instance is NOT minimized, always call render(). The
instance state is authoritative during restore transitions, not entity state.

---

## Issue #4: Manager Shows Green Indicator But No Window Visible

### Problem

User clicks restore in Manager. Indicator immediately turns green (restored) but
no window appears on screen. Creates user confusion - green means "visible" but
nothing is actually visible.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_emitRestoreStateUpdate()` (lines 317-342), `STATE_EMIT_DELAY_MS`
constant (line 23)  
**Issue:** state:updated event emitted after 200ms delay, but DOM verification
happens asynchronously. Manager receives event with domVerified:false but still
updates indicator based on minimized=false in event data, not actual DOM
presence.

**Event Sequence:**

1. **02:31:15.614:** User clicks restore
2. **02:31:15.614:** VisibilityHandler.handleRestore() completes
3. **02:31:15.817:** STATE_EMIT_DELAY_MS (200ms) timeout fires
4. **02:31:15.817:** DOM verification runs: `tabWindow.isRendered()` returns
   FALSE
5. **02:31:15.817:** Logs "WARN DOM not rendered after restore, emitting with
   warning"
6. **02:31:15.818:** Emits state:updated with `domVerified: false`
7. **Manager receives event, sees minimized=false, updates indicator to green**
8. **No window exists on screen**

**Log Evidence:**

```
WARN VisibilityHandler DOM not rendered after restore, emitting with warning
VisibilityHandler Emitted state:updated for restore... domVerified false
```

### Fix Required

Manager UI must check domVerified property in state:updated events and show
warning indicator (yellow/orange) when domVerified=false. Alternatively, delay
state:updated emission until DOM verification passes OR emit second
"verification failed" event if DOM check fails. Do NOT show green "restored"
indicator when domVerified=false.

---

## Issue #5: DOM Detachment Not Detected Until Next User Interaction

### Problem

When restore fails to create DOM, system remains in broken state silently. No
warning until user clicks minimize button 14+ seconds later, which triggers DOM
detachment detection.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_verifyDOMAfterRender()` (lines 256-263), `update()` (lines
275-282)  
**Issue:** DOM verification is reactive (only runs when update() called) not
proactive (no periodic monitoring). isRendered() check added in v1.6.4.7 but
only runs on next event, not continuously. Broken state exists indefinitely
between events.

**Event Sequence:**

1. **02:31:15.820:** Restore completes, 400×300 duplicate created
2. **02:31:15.971:** DOM verification PASSES for duplicate (wrong window)
3. **02:32:22.616:** User closes duplicate window manually
4. **~73 seconds pass in broken state**
5. **02:33:24.029:** User clicks minimize on "restored" tab
6. **02:33:24.029:** UICoordinator.update() called
7. **02:33:24.029:** First time detachment detected: "Tab in map but DOM
   detached, cleaning up"

**Log Evidence:**

```
# 73-second gap with no detection
02:31:15.820 UICoordinator Tab rendered  ← Wrong window (400×300)
02:33:24.029 UICoordinator Tab in map but DOM detached  ← First detection
```

### Fix Required

Add setTimeout periodic verification (every 500-1000ms) after render() that
checks isRendered() and removes from Map if false. Emit warning event if
detachment detected. Alternatively, use MutationObserver to detect when
container.parentNode becomes null and immediately clean up.

---

## Issue #6: Missing Critical Logging Prevents Debugging

### Problem

When bugs occur, logs don't show WHERE render() dimensions came from, WHICH
instance received snapshot, or WHY snapshot is unavailable. Impossible to debug
snapshot lifecycle without enhanced logging.

### Missing Logs

**#6A: No Entity Property Logging** **File:**
`src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_createWindow()` (lines 478-507), `_getSafeSize()` (lines
458-465)  
**Missing:** Log showing entity.size and entity.position values before creating
window  
**Need:** `console.log('Creating window from entity:', { id, position: quickTab.position, size: quickTab.size });`

**#6B: No Snapshot Source Logging** **File:**
`src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_tryApplySnapshotFromManager()` (lines 129-147)  
**Missing:** Log showing WHERE snapshot check happens and WHAT it finds  
**Need:** `console.log('Checking MinimizedManager for snapshot:', id, 'found:', !!snapshot);`  
**Current:**
Only logs "No snapshot available" AFTER all attempts fail (line 161)

**#6C: No Map Entry Creation Logging** **File:**
`src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `render()` (lines 113-134)  
**Missing:** Log when tab added to renderedTabs Map with isRendered() status  
**Need:** `console.log('Added to renderedTabs Map:', id, 'isRendered:', tabWindow.isRendered());`  
**Current:**
Only logs "Tab rendered" without Map addition confirmation

**#6D: No Update Decision Path Logging** **File:**
`src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `update()` (lines 265-314)  
**Missing:** Log showing WHICH branch taken and WHY  
**Need:** `console.log('Update decision:', { inMap: !!tabWindow, DOMAttached: tabWindow?.isRendered(), entityMinimized, instanceMinimized, action: 'render/update/skip' });`  
**Current:**
Generic "Updating tab" without decision rationale

**#6E: No Snapshot Deletion Logging** **File:**
`src/features/quick-tabs/minimized-manager.js`  
**Location:** `restore()` (line 116)  
**Missing:** Log WHEN snapshot deleted and what triggered deletion  
**Need:** `console.log('Deleting snapshot from Map:', id, 'caller:', new Error().stack);`  
**Current:**
Only logs "Restored snapshot" AFTER deletion already happened

### Fix Required

Add all missing logs listed above. Include object identity tracking (e.g.,
instance memory address) to verify same instance receives snapshot and gets
rendered. Add stack trace logging for snapshot deletion to identify all callers.
Log entity vs instance property values side-by-side for comparison during
restore.

---

## Shared Implementation Notes

**Snapshot Lifecycle:**

- Snapshot created: minimize operation via MinimizedManager.add()
- Snapshot read: restore operation via MinimizedManager.getSnapshot() or
  restore()
- **Current bug:** Snapshot deleted immediately in restore() before
  UICoordinator reads it
- **Fix pattern:** Delay deletion until after UICoordinator.render() completes
  successfully

**Event Timing:**

- VisibilityHandler.handleRestore() executes synchronously
- MinimizedManager.restore() executes synchronously (deletes snapshot
  immediately)
- state:updated emission delayed 200ms via STATE_EMIT_DELAY_MS
- UICoordinator receives event 200ms+ after snapshot deleted
- **Gap:** 200ms+ window where snapshot needed but already deleted

**Instance vs Entity State:**

- **Instance:** QuickTabWindow object properties (left, top, width, height,
  minimized)
- **Entity:** QuickTab domain object from StateManager (position, size,
  visibility.minimized)
- **Current bug:** Snapshot applied to instance but entity never updated
- **Result:** UICoordinator reads entity defaults (400×300) instead of instance
  snapshot (960×540)

**DOM Detachment Recovery (The "Magic Fix"):** When user closes 400×300
duplicate then clicks minimize on broken "restored" tab:

1. minimize operation called on tab with detached DOM
2. UICoordinator.update() detects "Tab in map but DOM detached"
3. Calls `_applySnapshotForRestore()` which reads snapshot from MinimizedManager
4. Snapshot exists because minimize operation JUST CREATED it
5. Applies snapshot to ENTITY (not just instance)
6. Renders with correct dimensions (960×540)
7. **This is the ONLY code path that works correctly**

**Why it works:** DOM detachment recovery code in update() (lines 284-297) calls
\_applySnapshotForRestore() which updates the ENTITY before rendering. Regular
restore path skips this.

<acceptance_criteria> **Issue #1: 400×300 Duplicate**

- [ ] Restore button clicked → window appears with exact saved dimensions
      (960×540, not 400×300)
- [ ] Window appears at exact saved position (822, 214, not default 100, 100)
- [ ] First restore attempt succeeds with correct dimensions
- [ ] Log shows "Restoring from snapshot" with correct width/height values
- [ ] No "No snapshot available" warning logged

**Issue #2: Original Window Never Appears**

- [ ] After restore, original window dimensions always render on screen
- [ ] No orphaned 400×300 duplicates remain visible
- [ ] Only one window per Quick Tab exists after restore
- [ ] Log shows "Tab rendered" with correct dimensions

**Issue #3: Subsequent Restores**

- [ ] Second restore attempt creates window if first failed
- [ ] Third, fourth, Nth restore attempts always succeed
- [ ] Log shows "rendering now" on every restore attempt if DOM missing
- [ ] No "Updating tab" without "rendering now" when DOM detached

**Issue #4: Manager Indicator**

- [ ] Manager indicator only turns green after DOM verification passes
- [ ] Yellow/warning indicator shown when domVerified=false
- [ ] Indicator reflects actual window visibility, not just entity state
- [ ] Manual test: restore → verify indicator matches window presence

**Issue #5: DOM Detachment Detection**

- [ ] Detachment detected within 200ms of occurrence
- [ ] Warning logged immediately when isRendered() returns false after render()
- [ ] Tab removed from Map automatically when detachment detected
- [ ] No 73-second gaps with silent broken state

**Issue #6: Missing Logging**

- [ ] Every \_createWindow() call logs entity.position and entity.size values
- [ ] Every snapshot check logs where it looked and what it found
- [ ] Every Map.set() logs tab ID and isRendered() status
- [ ] Every update() decision logs which branch taken and why
- [ ] Every snapshot deletion logs caller via stack trace
- [ ] Entity vs instance properties logged side-by-side during restore

**All Issues:**

- [ ] No duplicate windows created during restore
- [ ] Snapshot lifecycle properly managed (created → read → deleted only after
      success)
- [ ] Instance properties always synchronized with entity properties
- [ ] UICoordinator remains single rendering authority (no double-render)
- [ ] Manual test: minimize 960×540 → restore → verify 960×540 appears correctly
- [ ] Manual test: minimize → restore → minimize → restore (4x rapid) → all
      succeed </acceptance_criteria>

## Supporting Context

<details>
<summary>Log Evidence: Issue #1 (400×300 Duplicate)</summary>

**First restore attempt (02:31:15.614):**

```
MinimizedManager Instance dimensions BEFORE snapshot application... width 960, height 540
MinimizedManager Instance dimensions AFTER snapshot application... width 960, height 540
MinimizedManager Restored snapshot render deferred to UICoordinator... size width 960, height 540
QuickTabWindow Dimensions to be used by UICoordinator left 152, top 681, width 960, height 540

# 200ms delay #

UICoordinator No snapshot available for qt-121-1764469870289-yn9jme1p5eql5
UICoordinator Rendering tab
QuickTabWindow render called with dimensions... left 100, top 100, width 400, height 300  ← DIMENSION LOSS
```

**Pattern repeats for EVERY restore:**

- 02:32:16.878 - Tab qt-121-1764469926826: 960×540 → 400×300
- 02:32:17.759 - Tab qt-121-1764469925345: 960×540 → 400×300
- 02:32:42.263 - Same tab 2nd attempt: 960×540 → 400×300
- 02:32:43.874 - Same tab 2nd attempt: 960×540 → 400×300

**Snapshot logged as applied correctly, but render() uses defaults.**

</details>

<details>
<summary>Log Evidence: Issue #2 (Original Never Appears)</summary>

**First restore (02:31:15.818):**

```
WARN UICoordinator Tab not rendered, rendering now qt-121-1764469870289-yn9jme1p5eql5
UICoordinator Rendering tab
QuickTabWindow Rendered qt-121-1764469870289-yn9jme1p5eql5  ← Added to Map
```

**Second restore (02:32:21.560) - same tab:**

```
UICoordinator Received state:updated event
UICoordinator Updating tab qt-121-1764469870289-yn9jme1p5eql5  ← Calls update() not render()
UICoordinator Tab updated  ← No window created
```

**No "rendering now" log. No "Rendered" log. No window appears.**

</details>

<details>
<summary>Log Evidence: Issue #4 (Green Indicator, No Window)</summary>

**Every restore shows same pattern:**

```
WARN VisibilityHandler DOM not rendered after restore, emitting with warning qt-121-...
VisibilityHandler Emitted state:updated for restore... domVerified false
```

**Manager receives domVerified=false but shows green indicator anyway.**

Occurs at:

- 02:31:15.820 (first restore)
- 02:32:16.880 (second restore)
- 02:32:17.761 (third restore)
- 02:32:42.265 (fourth restore)
- 02:32:43.876 (fifth restore)

Every restore operation emits with domVerified=false, proving DOM never actually
renders.

</details>

<details>
<summary>Log Evidence: The "Magic Fix" (Issue #1 Solution)</summary>

**When user closes 400×300 duplicate then clicks minimize on broken "restored"
tab (02:33:24.029):**

```
UICoordinator Tab in map but DOM detached, cleaning up qt-121-1764469869342-1q9d75w16mm2ms
UICoordinator Instance NOT minimized but DOM missing, rendering qt-121-1764469869342-1q9d75w16mm2ms
UICoordinator Restoring from snapshot from minimizedManager... width 960, height 540  ← SNAPSHOT EXISTS!
MinimizedManager Instance dimensions AFTER snapshot application... width 960, height 540
UICoordinator Rendering tab
QuickTabWindow render called with dimensions... left 822, top 214, width 960, height 540  ← CORRECT DIMENSIONS!
```

**Why snapshot exists:** Minimize operation JUST created it. DOM detachment
recovery code reads it immediately before it gets deleted.

**Why dimensions correct:** This code path calls \_applySnapshotForRestore()
which updates the ENTITY, not just instance.

**This proves the fix:** Apply snapshot to entity BEFORE deleting from Map.
Regular restore path should use same pattern as DOM detachment recovery.

</details>

<details>
<summary>Architecture Context: Snapshot Lifecycle</summary>

**Snapshot Creation:**

- User clicks minimize button
- VisibilityHandler.handleMinimize() calls MinimizedManager.add()
- MinimizedManager captures current instance.left, instance.top, instance.width,
  instance.height
- Stores in Map as `{ window, savedPosition, savedSize }`

**Snapshot Application:**

- MinimizedManager.restore() reads from Map
- Applies to instance properties: `tabWindow.left = savedLeft`, etc.
- Logs "Instance dimensions AFTER snapshot application"
- **Then immediately deletes from Map** (line 116)

**Snapshot Deletion Timing:**

- Deleted synchronously at end of MinimizedManager.restore()
- Happens 200ms BEFORE UICoordinator needs to read it
- No cleanup callback or deferred deletion
- UICoordinator has no way to access deleted snapshot

**The Gap:**

```
t=0ms:     VisibilityHandler.handleRestore() starts
t=0ms:     MinimizedManager.restore() deletes snapshot
t=0ms:     tabWindow.restore() sets minimized=false
t=200ms:   state:updated emitted
t=200ms+:  UICoordinator tries to read snapshot → GONE
```

**Why DOM Detachment Recovery Works:**

- Minimize operation creates NEW snapshot
- UICoordinator.update() runs immediately (no 200ms delay)
- Snapshot read before it gets deleted
- Applied to ENTITY not just instance
- Render uses correct entity values
</details>

<details>
<summary>Technical Context: Entity vs Instance Properties</summary>

**Instance (QuickTabWindow):**

- Source: window.js, lines 29-80
- Properties: this.left, this.top, this.width, this.height, this.minimized
- Updated by: MinimizedManager.restore() when snapshot applied
- Read by: QuickTabWindow.render() when creating DOM
- Issue: Updated correctly but never read by UICoordinator

**Entity (QuickTab domain object):**

- Source: StateManager, passed to UICoordinator
- Properties: position{left, top}, size{width, height}, visibility{minimized}
- Updated by: Never updated during restore (BUG)
- Read by: UICoordinator.\_getSafePosition(), \_getSafeSize()
- Issue: Contains defaults (100, 100, 400, 300) instead of snapshot values

**The Synchronization Gap:**

```
MinimizedManager.restore():
  tabWindow.left = 822    ← Instance updated ✓
  tabWindow.width = 960   ← Instance updated ✓

UICoordinator._createWindow():
  const pos = quickTab.position || {}     ← Entity read (undefined)
  const left = pos.left ?? 100            ← Default used ✗
  const size = quickTab.size || {}        ← Entity read (undefined)
  const width = size.width ?? 400         ← Default used ✗
```

**Fix:** Update entity properties when applying snapshot, not just instance
properties.

</details>

---

**Priority:** Critical (all issues block restore feature) | **Target:** Single
coordinated PR | **Complexity:** High (requires architectural coordination
across 3 components)
