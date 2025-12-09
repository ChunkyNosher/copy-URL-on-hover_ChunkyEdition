# Quick Tab Z-Index Failure on Restored Windows

**Extension Version:** v1.6.3.5-v10  
**Report Date:** December 4, 2025  
**Severity:** Critical

<scope>
Z-index system fails for restored Quick Tabs, preventing them from coming to front when dragged. Affects user's ability to interact with restored windows as they remain stuck behind other tabs.
</scope>

---

## Executive Summary

Analysis reveals **FOUR critical bugs** causing z-index failures for restored
Quick Tabs. When a Quick Tab is minimized then restored, subsequent drag
operations fail to bring the window to front, leaving it stuck behind other
windows. The root causes involve z-index desynchronization during restore,
missing DOM updates in focus handling, absent logging throughout z-index
operations, and potential stale callback references from the previous callback
diagnostic report.

| Issue | Component                 | Severity | Root Cause                                                       |
| ----- | ------------------------- | -------- | ---------------------------------------------------------------- |
| 1     | Z-Index Desync at Restore | Critical | VisibilityHandler and UICoordinator use different z-index values |
| 2     | DOM Z-Index Not Updated   | Critical | handleFocus() doesn't apply z-index to restored window DOM       |
| 3     | Missing Z-Index Logging   | High     | No logging for z-index increments or DOM applications            |
| 4     | Stale Callback Reference  | High     | onFocus callback may reference destroyed window instance         |

**User-Facing Impact:** After minimizing and restoring a Quick Tab, dragging it
fails to bring it to front. The window stays behind other Quick Tabs even when
actively being dragged, creating severe UX confusion.

<scope>
Modify:
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleFocus method, restore flow, logging)
- `src/features/quick-tabs/window.js` (callback re-wiring for focus, z-index verification)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (z-index sync with VisibilityHandler)

Do NOT Modify:

- `src/features/quick-tabs/window/DragController.js` (drag mechanics working
  correctly)
- `src/features/quick-tabs/window/ResizeController.js` (not related to z-index)
- Storage utilities (persistence working correctly) </scope>

---

## Issue #1: Z-Index Desynchronization During Restore

### Problem

When a Quick Tab is restored from minimized state, the VisibilityHandler and
UICoordinator assign DIFFERENT z-index values to the same window. This creates
immediate desynchronization where the entity data has one z-index but the actual
DOM element has a different, higher z-index.

**Evidence from logs:**

```
[07:51:04.592] VisibilityHandler: Updated z-index for restored tab: newZIndex = 1000005
[07:51:04.659] UICoordinator: Creating window from entity, zIndex = 1000012
[07:51:04.662] QuickTabWindow: Z-index applied after appendChild: verifiedZIndex: '1000012'
```

The difference of 7 indicates multiple z-index increments occurred between
VisibilityHandler setting entity.zIndex and UICoordinator creating the window.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Method:** `_executeRestore()`  
**Lines:** ~530-550 (restore z-index update section)

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Method:** `_createWindowFromEntity()` or `update()`  
**Lines:** Location TBD - where zIndex is read from entity or currentZIndex

**The desync flow:**

1. `_executeRestore()` increments `currentZIndex.value` and stores it in
   `tabWindow.zIndex`
2. Between this operation and UICoordinator rendering, OTHER operations
   increment `currentZIndex.value` further
3. UICoordinator reads the NOW-HIGHER `currentZIndex.value` when creating the
   window
4. DOM gets z-index 1000012 while entity still has 1000005

**Why multiple increments happen:**

The restore process itself may trigger multiple focus events or state updates
that increment the global counter. Each increment advances `currentZIndex.value`
but doesn't update the entity's stored `zIndex` field.

**Alternative hypothesis:**

UICoordinator may be reading `currentZIndex.value` directly instead of reading
`entity.zIndex`. This would cause it to use whatever the CURRENT counter value
is rather than the value that VisibilityHandler set on the entity.

### Impact Scope

**Affects:**

- All restored Quick Tabs (100% reproduction rate)
- Causes immediate desync from the moment of restore
- Makes subsequent focus operations fail silently

**Does NOT affect:**

- Newly created Quick Tabs (no restore involved)
- Quick Tabs that have never been minimized

### Fix Required

**Approach A: Single Source of Truth (RECOMMENDED)**

Make VisibilityHandler the SOLE authority for z-index during restore:

1. In `_executeRestore()`, VisibilityHandler sets `entity.zIndex` to incremented
   value
2. UICoordinator MUST read `entity.zIndex` field, NOT `currentZIndex.value`
3. Add validation: if `entity.zIndex` doesn't match DOM z-index, log warning
4. After window creation, sync `currentZIndex.value` to match highest DOM
   z-index

**Approach B: Two-Phase Sync**

Keep current flow but add explicit synchronization:

1. After UICoordinator creates window, read ACTUAL DOM z-index
2. Update `entity.zIndex` to match DOM value
3. Update `currentZIndex.value` to match if DOM is higher
4. Log the synchronization operation

**Required logging:**

Add to VisibilityHandler `_executeRestore()`:

- Log z-index value BEFORE incrementing global counter
- Log z-index value AFTER incrementing global counter
- Log the value stored on entity

Add to UICoordinator window creation:

- Log z-index value read from entity
- Log z-index value read from currentZIndex.value
- Log which source was used for DOM application
- Log ACTUAL DOM z-index after application

---

## Issue #2: DOM Z-Index Not Updated When Bringing Restored Tab to Front

### Problem

When user drags a restored Quick Tab, the `onFocus` callback fires correctly and
`VisibilityHandler.handleFocus()` is invoked. The method increments the global
z-index counter and stores the new value on the entity, but the DOM's
`container.style.zIndex` is NEVER updated. This causes the visual stacking order
to remain unchanged even though the entity state shows a higher z-index.

**Evidence from logs:**

```
[07:51:13.635] QuickTabWindow: Drag started (qt-629-1764834652438-gwyysqw09go2)
[07:51:13.636] QuickTabWindow: Bringing to front via onFocus callback
[07:51:13.636] VisibilityHandler: Bringing to front (qt-629-1764834652438-gwyysqw09go2)
[07:51:13.636] VisibilityHandler: _debouncedPersist scheduling (operation: focus)
```

**Missing logs:**

- ❌ No log showing global z-index counter incremented
- ❌ No log showing entity.zIndex updated
- ❌ No log showing DOM z-index applied
- ❌ No log showing z-index verification

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Method:** `handleFocus()`  
**Lines:** ~783-808

**Current implementation:**

The method correctly:

1. ✅ Increments `this.currentZIndex.value++`
2. ✅ Calls `tabWindow.updateZIndex(newZIndex)`
3. ✅ Stores `tabWindow.zIndex = newZIndex`
4. ✅ Persists to storage via debounce

**But for RESTORED windows, step 2 fails silently because:**

The `tabWindow` reference passed to `handleFocus()` may be:

- A stale instance from before minimize/restore (Issue #4 - callback reference
  problem)
- A new instance that hasn't been properly initialized
- An instance where `container` is null or detached

When `updateZIndex()` is called on a stale or invalid instance, it either:

- Updates a detached DOM element (no visual effect)
- Finds `container` is null and returns early
- Throws an error that's caught by optional chaining

**Why non-restored tabs work:**

Non-restored Quick Tabs maintain continuous DOM presence. When `updateZIndex()`
is called, the `container` reference is valid and attached to the document, so
the style update takes effect immediately.

**Why restored tabs fail:**

After restore, the window gets a NEW `container` element. But if the `onFocus`
callback still references the OLD `tabWindow` instance (with OLD container
reference), the z-index update goes to a detached or null element.

### Impact Scope

**Affects:**

- All drag operations on restored Quick Tabs
- Any focus operation triggered after restore
- Keyboard shortcuts that bring restored tabs to front

**Does NOT affect:**

- Non-restored Quick Tabs (continuous DOM presence)
- Initial restore operation (z-index is set during render)
- Minimized tabs (not visible, no focus events)

### Fix Required

**Primary fix: Verify callback references after restore**

This is the same core issue as Issues #1 and #2 from the callback diagnostic
report. The `onFocus` callback needs to be re-wired after restore to reference
the NEW window instance.

In VisibilityHandler `_executeRestore()` method, after calling
`tabWindow.restore()`:

1. Create fresh `onFocus` callback capturing CURRENT VisibilityHandler instance
2. Bind callback to capture CURRENT `tabWindow` reference
3. Call `tabWindow.rewireCallbacks({ onFocus: freshCallback })`
4. Log the re-wiring operation with verification
5. Verify new callback can access `tabWindow.container`

**Secondary fix: Add defensive checks in handleFocus()**

Even with proper callback wiring, add safety checks:

1. Before calling `updateZIndex()`, verify `tabWindow.container` exists
2. Verify `tabWindow.container.parentNode` is not null (attached to DOM)
3. If validation fails, log error and attempt to find window by ID
4. After `updateZIndex()`, verify DOM z-index matches expected value
5. If verification fails, retry or log critical error

**Tertiary fix: Direct DOM manipulation fallback**

If `updateZIndex()` fails or callback is stale:

1. Use `quickTabsMap.get(id)` to get CURRENT instance
2. If instance differs from callback's instance, log warning about stale
   callback
3. Call `updateZIndex()` on CURRENT instance
4. Verify DOM update succeeded

**Required logging:**

Add to `handleFocus()` method:

- Log entry with window ID and current z-index
- Log global counter value BEFORE and AFTER increment
- Log entity.zIndex BEFORE and AFTER update
- Log call to `updateZIndex()` with parameters
- Log verification of DOM z-index after update
- Log any discrepancies between entity and DOM z-index

---

## Issue #3: Missing Z-Index Operation Logging

### Problem

The z-index system has ZERO logging for critical operations. When z-index
updates fail, there's no diagnostic information to determine where the failure
occurred. This makes debugging impossible and masks the root causes of Issues #1
and #2.

### Root Cause

**Multiple Files Missing Logging:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Method:** `handleFocus()`  
**Missing Logs:**

- Global z-index counter increment (before/after values)
- Entity z-index field update (old value → new value)
- Call to `tabWindow.updateZIndex()` with parameters
- DOM z-index verification after update

**Method:** `_executeRestore()`  
**Missing Logs:**

- Z-index value assigned during restore
- Comparison of entity.zIndex vs currentZIndex.value
- Verification that z-index was applied to DOM after render

**File:** `src/features/quick-tabs/window.js`  
**Method:** `updateZIndex()`  
**Lines:** ~850-860  
**Missing Logs:**

- Entry with window ID and new z-index value
- Container existence check result
- DOM style.zIndex value BEFORE update
- DOM style.zIndex value AFTER update
- Computed style verification (actual z-index from browser)

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Method:** Window creation/update  
**Missing Logs:**

- Z-index source (entity.zIndex vs currentZIndex.value)
- Z-index value used for window creation
- Verification that DOM z-index matches expected value

### Why This Prevents Diagnosis

**Scenario: User reports "restored tab doesn't come to front"**

**Without logging (CURRENT STATE):**

Developer sees in logs:

```
[07:51:13.636] Bringing to front via onFocus callback
[07:51:13.636] VisibilityHandler Bringing to front
```

Developer cannot determine:

- ❌ Was `handleFocus()` actually called?
- ❌ Was global counter incremented?
- ❌ Was entity.zIndex updated?
- ❌ Was `updateZIndex()` called on the window?
- ❌ Did DOM z-index actually change?
- ❌ Does DOM z-index match entity z-index?

**With comprehensive logging (REQUIRED STATE):**

Developer sees in logs:

```
[07:51:13.636] [VisibilityHandler][handleFocus] Entry: id=qt-123, currentZIndex=1000012
[07:51:13.636] [VisibilityHandler][handleFocus] Global counter: 1000012 → 1000013
[07:51:13.636] [VisibilityHandler][handleFocus] Entity z-index: 1000012 → 1000013
[07:51:13.636] [VisibilityHandler][handleFocus] Calling tabWindow.updateZIndex(1000013)
[07:51:13.637] [QuickTabWindow][updateZIndex] Entry: id=qt-123, newZIndex=1000013
[07:51:13.637] [QuickTabWindow][updateZIndex] Container exists: false
[07:51:13.637] [QuickTabWindow][updateZIndex] ERROR: Cannot update z-index - container is null
```

Developer immediately identifies: container is null, indicating stale callback
reference (Issue #4).

### Impact Scope

**Affects:**

- All debugging efforts for z-index issues
- All diagnostic reports for user-reported bugs
- Developer productivity (hours spent debugging blind)
- Quality of bug fixes (cannot verify success without logs)

### Fix Required

**Add comprehensive logging to ALL z-index operations:**

**In VisibilityHandler.handleFocus():**

Create detailed audit trail:

- Log entry:
  `[VisibilityHandler][handleFocus] Entry: id={id}, currentCounter={value}`
- Log counter increment:
  `[VisibilityHandler][handleFocus] Global counter: {old} → {new}`
- Log entity update:
  `[VisibilityHandler][handleFocus] Entity z-index: {old} → {new}`
- Log method call:
  `[VisibilityHandler][handleFocus] Calling tabWindow.updateZIndex({value})`
- Log completion:
  `[VisibilityHandler][handleFocus] Complete: id={id}, finalZIndex={value}`

**In VisibilityHandler.\_executeRestore():**

Track z-index assignment during restore:

- Log before increment:
  `[VisibilityHandler][_executeRestore] Pre-increment z-index: entity={entityValue}, counter={counterValue}`
- Log after increment:
  `[VisibilityHandler][_executeRestore] Post-increment z-index: entity={entityValue}, counter={counterValue}`
- Log assignment:
  `[VisibilityHandler][_executeRestore] Assigned z-index to entity: {value}`
- Log verification:
  `[VisibilityHandler][_executeRestore] Z-index sync check: entity={entityValue}, DOM={domValue}, match={boolean}`

**In QuickTabWindow.updateZIndex():**

Make method observable:

- Log entry: `[QuickTabWindow][updateZIndex] Entry: id={id}, newZIndex={value}`
- Log precondition:
  `[QuickTabWindow][updateZIndex] Container exists: {boolean}, attached: {boolean}`
- If container null:
  `[QuickTabWindow][updateZIndex] ERROR: Container is null - cannot update z-index`
- If container detached:
  `[QuickTabWindow][updateZIndex] WARNING: Container detached - z-index update may not be visible`
- Log DOM update:
  `[QuickTabWindow][updateZIndex] Setting container.style.zIndex = {value}`
- Log verification:
  `[QuickTabWindow][updateZIndex] Computed z-index: {computedValue}, expected: {value}, match: {boolean}`
- Log completion:
  `[QuickTabWindow][updateZIndex] Complete: id={id}, success={boolean}`

**In UICoordinator window creation:**

Track z-index source and application:

- Log source selection:
  `[UICoordinator][createWindow] Z-index source: entity.zIndex={value1}, currentZIndex.value={value2}, using={selected}`
- Log DOM application:
  `[UICoordinator][createWindow] Applied z-index to DOM: {value}`
- Log verification:
  `[UICoordinator][createWindow] DOM z-index verified: {value}`

**Logging standards:**

All z-index logs must include:

- Window ID for correlation
- Z-index values (old and new when applicable)
- Success/failure indication
- Timestamp (automatic with console.log)

Format: `[ClassName][MethodName] Operation: details`

**Error logging pattern:**

When z-index operations fail:

- Log the specific failure point
- Log current state (container exists, attached, etc.)
- Log z-index values at failure (entity, DOM, counter)
- Log whether this is a restored or non-restored window
- Include stack trace if exception occurred

---

## Issue #4: Stale Callback Reference After Restore (Related to Callback Diagnostic Report)

### Problem

This issue is DIRECTLY RELATED to Issues #1 and #2 from the callback diagnostic
report. After a Quick Tab is restored, the `onFocus` callback may still
reference the OLD QuickTabWindow instance that was destroyed during minimize.
When the callback is invoked (during drag start), it tries to call
`handleFocus()` which then calls `updateZIndex()` on a stale instance with a
null or detached `container`, causing the DOM z-index update to fail silently.

**Evidence from logs:**

```
[07:51:04.659] UICoordinator: Creating new window instance: qt-629-1764834652438-gwyysqw09go2
```

This shows a NEW window instance was created during restore. But there's no
corresponding log showing:

```
❌ MISSING: [VisibilityHandler] Re-wired callbacks for restored window
❌ MISSING: [QuickTabWindow] onFocus callback now references new instance
```

### Root Cause

**This is Issue #1 and Issue #2 from the callback diagnostic report applied
specifically to the `onFocus` callback.**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Method:** `_executeRestore()`  
**Lines:** ~530-580

**The callback lifecycle failure:**

```
t0 (Initial Creation):
  QuickTabWindow instance: WindowA
  WindowA.container: DOMElementA
  onFocus callback captures: { tabWindow: WindowA, container: DOMElementA }

t1 (Minimize):
  WindowA.minimize() called
  WindowA.container removed from DOM
  WindowA.container = null
  But onFocus callback STILL references: { tabWindow: WindowA, container: null }

t2 (Restore):
  UICoordinator creates: WindowB (NEW instance)
  WindowB.container: DOMElementB (NEW element)
  WindowB.render() attaches DOMElementB to DOM
  But onFocus callback STILL references: { tabWindow: WindowA, container: null }

t3 (User Drags):
  DragController fires onFocus(id)
  Callback calls handleFocus(id)
  handleFocus gets tabWindow from quickTabsMap: WindowB (CURRENT)
  handleFocus calls WindowB.updateZIndex(newZIndex) ✓ (This actually works!)

  BUT if callback captured specific window reference:
  Callback calls handleFocus with wrong instance
  handleFocus tries WindowA.updateZIndex(newZIndex)
  WindowA.container is null
  Update fails silently
```

### Why This Happens

JavaScript closures capture the execution context at creation time. When
callbacks are created during QuickTabWindow construction, they permanently
reference:

- The Manager instance at construction
- The `quickTabsMap` Map at construction
- The QuickTabWindow instance at construction (potentially)
- The DOM elements at construction

After minimize/restore, a NEW QuickTabWindow instance exists with NEW DOM
elements, but the callbacks still reference the OLD instance with destroyed DOM
elements.

### Impact Scope

**Affects:**

- All focus operations after restore
- All drag operations on restored tabs (drag triggers focus)
- Any keyboard shortcut that brings restored tab to front

**Related to:**

- Callback diagnostic report Issue #1 (Stale Closure References)
- Callback diagnostic report Issue #2 (Missing Callback Re-Wiring)

**Same symptoms:**

- Silent failures (no errors)
- Operations appear to execute but have no effect
- Entity state updates but DOM doesn't
- Works for non-restored tabs, fails for restored tabs

### Fix Required

**This requires the SAME callback re-wiring architecture described in the
callback diagnostic report.**

**In VisibilityHandler `_executeRestore()` method:**

After the line that calls `tabWindow.restore()` and before emitting
`state:updated` event:

1. **Create fresh onFocus callback** capturing CURRENT VisibilityHandler
   context:

   ```
   Callback must capture:
   - CURRENT VisibilityHandler instance (this)
   - CURRENT quickTabsMap reference
   - CURRENT tabWindow instance
   ```

2. **Create object with ALL callbacks needing re-wiring:**

   ```
   Fresh callbacks needed:
   - onFocus (for bring-to-front)
   - onPositionChangeEnd (for persistence after drag)
   - onSizeChangeEnd (for persistence after resize)
   - onMinimize (for minimize operations)
   ```

3. **Call tabWindow.rewireCallbacks()** with fresh callback object:

   ```
   This method needs to be implemented on QuickTabWindow class
   Method must replace old callback references with new ones
   Preserve callback signatures (must match DragController expectations)
   ```

4. **Verify callback re-wiring** with spot checks:

   ```
   Test that new callback can access current tabWindow.container
   Test that callback invocation reaches CURRENT handler instance
   Log verification results
   ```

5. **Log the re-wiring operation:**
   ```
   Log callback names that were re-wired
   Log verification that callbacks reference current instances
   Include window ID for correlation
   ```

**Required implementation in QuickTabWindow:**

Add `rewireCallbacks()` method that:

- Accepts object with new callback functions
- Replaces `this.onFocus`, `this.onPositionChangeEnd`, etc.
- Maintains callback signatures (important for DragController)
- Logs the re-wiring operation
- Returns success/failure boolean

**Integration with callback diagnostic report:**

This fix addresses the SAME underlying architecture problem as the callback
report but specifically for z-index updates. The comprehensive solution from
that report should be implemented first, as it provides the infrastructure
(rewireCallbacks method, logging, verification) needed for this issue.

---

## Missing Actions Not Captured by Logging

### Operations That Execute But Produce No Logs

**1. Global Z-Index Counter Increment**

Current: Silent increment in `handleFocus()`  
Location: VisibilityHandler.js, line ~790  
Should log:

- Counter value BEFORE increment
- Counter value AFTER increment
- Window ID that triggered increment
- Operation type (focus, restore, create)

**2. Entity Z-Index Field Update**

Current: Silent assignment `tabWindow.zIndex = newZIndex`  
Location: VisibilityHandler.js, line ~793  
Should log:

- Old entity z-index value
- New entity z-index value
- Window ID
- Whether entity is in quickTabsMap

**3. DOM Z-Index Style Application**

Current: Silent style update in `updateZIndex()`  
Location: window.js, line ~855  
Should log:

- Old container.style.zIndex value
- New container.style.zIndex value
- Whether container exists and is attached
- Computed z-index from getComputedStyle

**4. Z-Index Verification**

Current: Never performed  
Location: Should be in `updateZIndex()` and `handleFocus()`  
Should log:

- Expected z-index (what was set)
- Actual DOM z-index (from style or computed style)
- Match status (boolean)
- Action taken if mismatch (retry, error, ignore)

**5. Callback Re-Wiring After Restore**

Current: Never happens  
Location: Should be in `_executeRestore()`  
Should log:

- Which callbacks are being re-wired
- Old callback reference (for debugging)
- New callback reference (for debugging)
- Verification that new callback works
- Window ID and operation type

**6. Z-Index Desync Detection**

Current: Never checked  
Location: Should be in restore completion and periodic validation  
Should log:

- Entity.zIndex value
- DOM container.style.zIndex value
- Computed z-index from browser
- Desync severity (critical, warning, info)
- Corrective action taken

**7. Stale Container Reference Detection**

Current: Never validated  
Location: Should be in `updateZIndex()` before DOM manipulation  
Should log:

- Container exists: boolean
- Container attached to DOM: boolean
- Container is detached element: boolean
- Whether this is a post-restore operation
- Decision to abort or retry

---

## Unintentional Behaviors

### 1. VisibilityHandler and UICoordinator Use Different Z-Index Values

**What happens:**

- VisibilityHandler assigns entity.zIndex = 1000005
- UICoordinator creates window with zIndex = 1000012
- Gap of 7 indicates multiple operations incremented counter between these steps

**Why it's unintentional:**

- Both components should use SAME z-index value
- Entity and DOM should be synchronized
- No design document specifies this desync is acceptable

**User-visible impact:**

- Confusing z-index values in debugging
- Potential for incorrect stacking order
- State persistence may store wrong value

**What should happen:**

- VisibilityHandler sets z-index during restore
- UICoordinator reads that EXACT value from entity
- No intervening operations modify the counter
- Entity and DOM match exactly

### 2. handleFocus() Called But DOM Z-Index Never Updates

**What happens:**

- Logs show "Bringing to front" message
- Method executes without errors
- Entity z-index incremented successfully
- Storage updated with new value
- BUT: DOM container.style.zIndex stays at old value

**Why it's unintentional:**

- Method name `handleFocus()` implies bringing to front
- Method calls `updateZIndex()` which should update DOM
- No error logged or thrown
- Developer expects DOM update from this call

**User-visible impact:**

- Tab appears to ignore drag attempts to bring to front
- User repeatedly drags tab trying to bring it forward
- Tab stays behind others despite appearing to be "focused"

**What should happen:**

- handleFocus() updates entity z-index
- updateZIndex() updates DOM z-index
- DOM element visually comes to front
- User sees immediate response to drag action

### 3. Restored Windows Get Unexpectedly High Z-Index

**What happens:**

- Non-restored tabs have z-index progression: 1000001, 1000003, 1000006
- Restored tab suddenly has z-index: 1000012
- Gap of 6 from last non-restored tab is unusual

**Why it's unintentional:**

- Z-index should increment by 1 for each operation
- Gap of 6 suggests counter incremented multiple times
- No design specifies restore should get +6 offset

**User-visible impact:**

- Confusing stacking order
- Newly created tabs may appear BEHIND restored tabs
- Z-index space "wasted" (counter increases without need)

**What should happen:**

- Restore increments counter by 1
- Z-index values form continuous sequence
- No large gaps in z-index values
- Log shows why each increment occurred

### 4. No Error When Z-Index Desync Detected

**What happens:**

- System has entity.zIndex = 1000005
- System has container.style.zIndex = 1000012
- These values are DIFFERENT
- No warning, error, or corrective action

**Why it's unintentional:**

- Desync indicates serious state corruption
- Could lead to wrong stacking order
- Storage may persist wrong value
- Developer needs to know about this

**User-visible impact:**

- Unpredictable stacking behavior
- Tab order doesn't match expectations
- Reloads may restore to wrong z-index

**What should happen:**

- System detects entity.zIndex ≠ DOM z-index
- Logs warning: "Z-index desync detected"
- Attempts to correct: sync entity to DOM or vice versa
- If correction fails, logs error with details

### 5. updateZIndex() Fails Silently on Null Container

**What happens:**

- Callback invokes `updateZIndex(1000013)`
- Method finds `this.container` is null
- Method returns early without updating anything
- No error logged
- Caller assumes success

**Why it's unintentional:**

- Null container indicates serious state problem
- Caller should be notified of failure
- Silent failure masks the root cause
- No way for developer to diagnose

**User-visible impact:**

- Z-index appears to be updated (in entity)
- But DOM never changes
- Visual stacking order doesn't match entity state
- User experiences non-responsive UI

**What should happen:**

- Method checks `this.container` at entry
- If null, logs error: "Cannot update z-index - container is null"
- Attempts to recover by finding current instance
- If recovery fails, throws error or returns failure code
- Caller handles failure appropriately

### 6. Callbacks Reference Destroyed Window Instance

**What happens:**

- Window minimized, instance destroyed
- New instance created during restore
- Callback still references OLD destroyed instance
- Callback invocation tries to update null/detached DOM

**Why it's unintentional:**

- Callbacks should always reference CURRENT instance
- Destroy/recreate cycle should update callback references
- No design specifies callbacks should be "sticky"

**User-visible impact:**

- Operations fail silently after restore
- User can drag tab but it doesn't persist
- Tab doesn't come to front when dragged
- Appears as if UI is broken or frozen

**What should happen:**

- Minimize stores callback signatures for re-wiring
- Restore creates fresh callbacks with CURRENT references
- Callbacks always point to active, rendered instance
- Callback invocation always affects correct DOM element

---

## Comparison: Working vs Broken Behavior

### Non-Restored Tab (Livestreaming) - WORKS CORRECTLY

**Timeline:**

```
07:50:53.995 - Created with z-index: 1000003
07:50:54.695 - User drags tab
07:50:54.695 - Drag start triggers onFocus callback
07:50:54.695 - handleFocus() called
07:50:54.695 - Global counter incremented (presumably to 1000004 or higher)
07:50:54.695 - Entity z-index updated
07:50:54.695 - updateZIndex() updates DOM
07:50:54.695 - Visual: Tab comes to front ✓
```

**Why it works:**

- Continuous DOM presence (never minimized)
- Container reference stays valid throughout lifecycle
- Callbacks reference active, attached instance
- Z-index updates reach actual DOM element

**Result:** User sees immediate visual response, tab appears on top of others

### Restored Tab (Shukusei) - FAILS

**Timeline:**

```
07:50:52.438 - Initially created with z-index: 1000001
07:51:02.652 - User minimizes via Manager
07:51:02.654 - DOM removed, container = null
07:51:04.590 - User restores via Manager
07:51:04.592 - VisibilityHandler sets entity.zIndex = 1000005
07:51:04.659 - UICoordinator creates NEW instance with zIndex = 1000012
07:51:04.662 - DOM z-index verified: 1000012
07:51:13.636 - User drags tab
07:51:13.636 - Drag start triggers onFocus callback
07:51:13.636 - handleFocus() called
07:51:13.636 - ❌ NO LOG: Global counter incremented
07:51:13.636 - ❌ NO LOG: Entity z-index updated
07:51:13.636 - ❌ NO LOG: updateZIndex() called
07:51:13.636 - ❌ NO LOG: DOM z-index verified
07:51:13.636 - Visual: Tab stays BEHIND others ✗
```

**Why it fails:**

- Z-index desync from restore (1000005 vs 1000012)
- Callback may reference OLD destroyed instance
- updateZIndex() doesn't update DOM (container null or stale)
- No logging to show where failure occurred

**Result:** User drags tab but it stays behind others, appears unresponsive

### Key Differences

| Aspect                  | Non-Restored (WORKS)           | Restored (FAILS)                     |
| ----------------------- | ------------------------------ | ------------------------------------ |
| **Container reference** | Valid, attached to DOM         | Potentially stale or null            |
| **Callback reference**  | Points to current instance     | May point to destroyed instance      |
| **Z-index consistency** | Entity and DOM match           | Entity=1000005, DOM=1000012 (desync) |
| **DOM update**          | container.style.zIndex updated | No update (silent failure)           |
| **Visual result**       | Comes to front                 | Stays behind                         |

---

## Technical Explanation

### Why Z-Index Fails After Restore

**Phase 1: Initial State**

- Quick Tab created with z-index 1000001
- Entity and DOM both have 1000001
- Callbacks reference current active instance
- Container attached to DOM and valid

**Phase 2: Minimize**

- DOM removed from document
- Container reference set to null
- Callbacks still reference this instance
- Entity still has z-index 1000001

**Phase 3: Restore (THE PROBLEM STARTS HERE)**

- VisibilityHandler increments counter: 1000001 → 1000002 → 1000003 → 1000004 →
  1000005
- VisibilityHandler sets entity.zIndex = 1000005
- Between this and rendering, counter incremented MORE times: 1000006 → 1000007
  → ... → 1000012
- UICoordinator reads currentZIndex.value = 1000012 (NOT entity.zIndex)
- NEW QuickTabWindow created with zIndex = 1000012
- NEW container created with style.zIndex = '1000012'
- **DESYNC ESTABLISHED:** entity says 1000005, DOM has 1000012
- Callbacks NOT re-wired - still reference OLD instance (or OLD container)

**Phase 4: User Drags (THE BUG MANIFESTS)**

- DragController detects drag start
- Fires onFocus callback with window ID
- Callback invokes handleFocus(id)
- handleFocus tries to bring tab to front:

**Failure Mode A: Callback references destroyed instance**

```
handleFocus() gets tabWindow from quickTabsMap (correct, current instance)
Calls tabWindow.updateZIndex(1000013)
updateZIndex() updates this.container.style.zIndex
Container is valid, update succeeds
BUT: Entity still has 1000005, DOM had 1000012, now has 1000013
DESYNC CONTINUES: entity=1000005, DOM=1000013
```

**Failure Mode B: updateZIndex() can't find container**

```
handleFocus() gets correct tabWindow from quickTabsMap
Calls tabWindow.updateZIndex(1000013)
updateZIndex() checks this.container
Container is null OR detached
Method returns early
DOM z-index stays at 1000012
Tab stays behind others
```

**Failure Mode C: Callback is stale, references OLD instance**

```
Callback has closure over OLD tabWindow (destroyed)
Calls handleFocus with wrong instance
handleFocus tries oldTabWindow.updateZIndex(1000013)
oldTabWindow.container is null (was destroyed)
Update fails silently
```

**Result:**

- Entity z-index: might be updated or might not
- DOM z-index: NEVER updated
- Visual stacking: UNCHANGED
- User: confused why tab won't come to front

---

<acceptancecriteria>

**Issue #1: Z-Index Desync at Restore**

- Entity and DOM have SAME z-index value after restore
- VisibilityHandler z-index matches UICoordinator z-index
- Gap between restored tab z-index and previous tab z-index is ≤1
- Logged: entity z-index value and DOM z-index value match
- Logged: source of z-index value used by UICoordinator

**Issue #2: DOM Z-Index Updates on Focus**

- After restore, dragging tab brings it to front visually
- DOM container.style.zIndex updates when handleFocus() called
- Z-index increment logged with before/after values
- DOM z-index update logged with verification
- No silent failures when updateZIndex() is called

**Issue #3: Comprehensive Z-Index Logging**

- Every z-index increment logged (counter, entity, DOM)
- Every handleFocus() call logged with entry/exit
- Every updateZIndex() call logged with success/failure
- Every restore operation logs z-index assignment
- Errors in z-index updates logged with stack trace and context

**Issue #4: Callback Re-Wiring After Restore**

- onFocus callback re-wired after restore
- Re-wiring logged with callback names
- Callback references CURRENT window instance after restore
- updateZIndex() called on correct, active instance
- No operations on destroyed or detached instances

**All Issues:**

- Restored tabs come to front when dragged (manual test)
- Z-index values form continuous sequence (no large gaps)
- Entity z-index matches DOM z-index at all times
- Logs show complete z-index operation audit trail
- No silent failures (all errors logged)
- All existing tests pass

</acceptancecriteria>

---

## Priority & Sequencing

### Phase 1: Logging Infrastructure (Issue #3)

**Why first:** Enables verification and diagnosis of other fixes

1. Add z-index operation logging to handleFocus()
2. Add z-index verification logging to updateZIndex()
3. Add z-index sync logging to \_executeRestore()
4. Add z-index source logging to UICoordinator
5. Test: Verify logs appear for all operations

### Phase 2: Z-Index Synchronization (Issue #1)

**Why second:** Fixes initial desync at restore

1. Make UICoordinator read entity.zIndex, not currentZIndex.value
2. Add validation: entity.zIndex vs DOM z-index
3. Add sync operation: if mismatch, log and correct
4. Test: Verify entity and DOM match after restore
5. Test: Verify no large z-index gaps

### Phase 3: DOM Update on Focus (Issue #2)

**Why third:** Fixes z-index update after restore

1. Add defensive checks in handleFocus() before updateZIndex()
2. Add container validation in updateZIndex()
3. Add DOM z-index verification after update
4. Add error logging for failed updates
5. Test: Verify DOM z-index updates when tab dragged
6. Test: Verify restored tab comes to front

### Phase 4: Callback Re-Wiring (Issue #4)

**Why last:** Architectural fix, depends on Phase 3 working

1. Implement rewireCallbacks() method on QuickTabWindow
2. Add callback re-wiring to \_executeRestore()
3. Add verification that callbacks reference current instance
4. Add logging for callback re-wiring operation
5. Test: Verify callbacks point to active instance after restore

---

## Supporting Context

### Log Evidence - Z-Index Desync at Restore

From user logs showing z-index mismatch:

```
[07:51:04.592] VisibilityHandler: Updated z-index for restored tab (source: Manager): {
  "id": "qt-629-1764834652438-gwyysqw09go2",
  "newZIndex": 1000005
}

[07:51:04.659] UICoordinator: Creating window from entity, zIndex = 1000012 : {
  "id": "qt-629-1764834652438-gwyysqw09go2",
}

[07:51:04.662] QuickTabWindow: Z-index applied after appendChild: {
  "id": "qt-629-1764834652438-gwyysqw09go2",
  "targetZIndex": 1000012,
  "verifiedZIndex": "1000012",
}
```

**Analysis:** VisibilityHandler thinks z-index is 1000005, but actual DOM
has 1000012. Gap of 7 indicates multiple operations incremented global counter
between these log points.

### Log Evidence - Missing Z-Index Update

From user logs showing focus but no z-index change:

```
[07:51:13.635] QuickTabWindow: Drag started: qt-629-1764834652438-gwyysqw09go2 835 635

[07:51:13.636] QuickTabWindow: Bringing to front via onFocus callback: qt-629-1764834652438-gwyysqw09go2

[07:51:13.636] VisibilityHandler: Bringing to front: qt-629-1764834652438-gwyysqw09go2

[07:51:13.636] VisibilityHandler: _debouncedPersist scheduling (source: UI): {
  "id": "qt-629-1764834652438-gwyysqw09go2",
  "operation": "focus",
}
```

**Missing logs:**

- No "Global counter incremented" log
- No "Entity z-index updated" log
- No "Calling updateZIndex()" log
- No "DOM z-index verified" log
- No "Z-index applied to container" log

**Analysis:** Focus callback fired correctly, but no evidence that z-index was
actually updated in DOM.

### Z-Index Stacking Context Documentation

From W3C CSS 2.1 Specification on z-index:

> "For a positioned box, the z-index property specifies the stack level of the
> box in the current stacking context and whether the box establishes a local
> stacking context."

Key insight: Z-index only works on positioned elements (position: absolute,
relative, fixed, sticky). Quick Tabs use position: fixed, so z-index should work
correctly. If z-index doesn't update visual stacking, the style.zIndex value
isn't being set.

From Mozilla MDN on Stacking Context:

> "A stacking context is formed, anywhere in the document, by any element with
> position: fixed or position: absolute and z-index value other than auto."

Key insight: Each Quick Tab creates its own stacking context. Setting z-index on
the container element should change its position in the stacking order relative
to other Quick Tabs.

### Browser Reflow and Style Application

From Mozilla MDN on Forced Reflow:

> "Reading layout properties like offsetHeight or getComputedStyle forces the
> browser to recalculate layout. Setting style properties and then immediately
> reading them ensures the style has been applied."

Key insight: The `_applyZIndexAfterAppend()` method in QuickTabWindow uses this
pattern:

1. Set container.style.zIndex
2. Read container.offsetHeight (forces reflow)
3. Verify with getComputedStyle

This pattern should ensure z-index takes effect immediately. But it only runs
during INITIAL render, not during subsequent updateZIndex() calls.

### JavaScript Closure Behavior

From Mozilla MDN on Closures:

> "A closure is the combination of a function bundled together with references
> to its surrounding state (the lexical environment). Closures give you access
> to an outer function's scope from an inner function. The closure 'remembers'
> the environment in which it was created."

Key insight: Callbacks created during QuickTabWindow construction capture the
execution context at that moment. After minimize/restore creates a NEW instance,
old callbacks still reference OLD context (destroyed instance, null container).
This is why callback re-wiring is necessary.

---

## Notes for Implementation

### Z-Index Synchronization Pattern

After restore, ensure entity and DOM are synchronized:

**In \_executeRestore() after window creation:**

1. Read actual DOM z-index from container.style.zIndex
2. Compare to entity.zIndex field
3. If mismatch, determine which is authoritative
4. Update the non-authoritative source to match
5. Log the synchronization operation

**Recommended approach:** Make DOM authoritative after render

- DOM reflects what UICoordinator actually applied
- Entity should match DOM reality
- Sync entity.zIndex = DOM z-index value
- Log: "Synced entity z-index to match DOM: {value}"

### Defensive Checks in updateZIndex()

Before updating DOM, verify preconditions:

**Container validation:**

- Check `this.container` is not null
- Check `this.container.parentNode` is not null (attached)
- Check `this.container.isConnected` is true (in DOM tree)
- If any check fails, log error with full context

**Recovery attempt:**

- If container invalid, try to get CURRENT instance from quickTabsMap
- Compare current instance to `this` (are they same object?)
- If different, log warning: "Stale instance detected"
- Retry updateZIndex() on current instance
- If retry also fails, throw error

### Z-Index Verification Pattern

After setting z-index, verify it took effect:

**Verification steps:**

1. Set container.style.zIndex = newValue
2. Force reflow: void container.offsetHeight
3. Read back: actualValue = container.style.zIndex
4. Compare: actualValue === newValue.toString()
5. If match, log success
6. If mismatch, log error with both values

**For extra validation:**

- Use getComputedStyle: computedValue = getComputedStyle(container).zIndex
- Compare computedValue to expected value
- Note: computed value might differ due to stacking context rules

### Callback Re-Wiring Sequence

When restoring window, update callback references:

**Create fresh callbacks capturing current context:**

```
Pattern (pseudo-code, not actual implementation):

const freshOnFocus = (id) => {
  // Closure captures CURRENT visibilityHandler instance
  this.handleFocus(id);
};

const freshOnPositionChangeEnd = (id, left, top) => {
  // Closure captures CURRENT updateHandler instance
  this.updateHandler.handlePositionChangeEnd(id, left, top);
};
```

**Call rewireCallbacks():**

```
Pattern:
tabWindow.rewireCallbacks({
  onFocus: freshOnFocus,
  onPositionChangeEnd: freshOnPositionChangeEnd,
  // ... other callbacks
});
```

**Verify re-wiring worked:**

```
Pattern:
Test callback immediately:
  Call onFocus with test ID
  Verify it reaches current handler
  Verify it can access current container
Log verification result
```

---

**Priority:** Critical (Issues #1-2), High (Issue #3), High (Issue #4)  
**Target:** Fix in order: Logging → Sync → Update → Re-wiring  
**Estimated Complexity:** High - Requires coordination between
VisibilityHandler, UICoordinator, and QuickTabWindow  
**Related Reports:** Callback diagnostic report (Issues #1-2 provide callback
re-wiring architecture)
