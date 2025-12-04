# Quick Tab Callback Architecture & Manager List Bugs

**Extension Version:** v1.6.3.5-v10  
**Report Date:** December 4, 2025  
**Severity:** Critical  

<scope>
Multiple critical architectural failures in Quick Tab system affecting persistence, memory management, and UI synchronization.
</scope>

---

## Executive Summary

Analysis reveals **SIX critical architectural failures** in the Quick Tab system affecting drag/resize persistence, memory management, and Manager UI synchronization. These issues prevent position/size changes from persisting after browser restart or minimize/restore cycles, cause memory leaks through improper event listener cleanup, and result in stale Manager UI state.

Issues #1-5 form an interconnected architecture problem centered on JavaScript closure lifecycle management and DOM event handling. Issue #6 is a separate event listener registration bug in the Manager/Panel component.

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| 1 | Callback closure lifecycle | Critical | Stale closure references after restore |
| 2 | Handler restore flow | Critical | Missing callback re-wiring step |
| 3 | DOM event cleanup | High | Event listeners not removed before detach |
| 4 | Callback suppression | Medium | Overly broad time-based suppression |
| 5 | Diagnostic logging | Medium | Zero logging in critical callback paths |
| 6 | Manager list updates | Medium | Missing `state:deleted` event listener |

**Why bundled:** Issues #1-5 share callback lifecycle architecture and must be addressed together for proper fix. Issue #6 is independent but affects same user-facing feature (Manager UI accuracy).

<scope>
Modify:
- `src/features/quick-tabs/window.js` (callback re-wiring, cleanup, logging)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (restore flow, suppression fix)
- `src/features/quick-tabs/window/DragController.js` (cleanup methods, logging)
- `src/features/quick-tabs/window/ResizeController.js` (cleanup methods, logging)
- Manager/Panel component (location TBD - add event listener)

Do NOT Modify:
- `src/background/` (background script infrastructure)
- Storage utilities (already working correctly)
- Event emission code (DestroyHandler already emitting correctly)
- StateManager (state tracking correct)
</scope>

---

## Issue #1: Stale Closure References After Restore

### Problem

After browser restart with hydration OR minimize/restore cycle, user can drag/resize Quick Tabs but changes don't persist to storage. Visual position updates in viewport but page reload reverts to old position. No console errors appear, creating silent failure that confuses users.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Component:** `QuickTabWindow` class constructor  
**Approximate Lines:** 130-145 (callback initialization section)

The callbacks `onPositionChange`, `onSizeChange`, `onPositionChangeEnd`, and `onSizeChangeEnd` are assigned once at construction time. JavaScript closures capture the execution context at creation, meaning they permanently reference:

- Manager instance reference (at construction)
- `quickTabsMap` Map reference (at construction)  
- DOM element references (at construction)

**Timeline of failure:**

```
t0 (Construction):
  Manager instance: ManagerA
  quickTabsMap: MapA
  Callbacks capture: { manager: ManagerA, map: MapA }

t1 (Browser Restart):
  Manager instance: ManagerB (NEW - different memory address)
  quickTabsMap: MapB (NEW - different Map object)
  Callbacks STILL reference: { manager: ManagerA (undefined), map: MapA (undefined) }

t2 (User drags window):
  DragController calls: onPositionChangeEnd(newX, newY)
  Callback tries to access: ManagerA.updatePosition() (FAILS - undefined)
  Storage persist never happens (silent failure)
```

**Why silent failure occurs:** Callbacks likely have optional chaining (`manager?.updatePosition`), conditional checks (`if (manager) { ... }`), or try/catch blocks that prevent error propagation. When callback tries to access undefined Manager instance, code returns early without persisting to storage.

From Mozilla MDN on JavaScript closures:
> "A closure is the combination of a function bundled together with references to its surrounding state (the lexical environment). Closures give you access to an outer function's scope from an inner function. The closure 'remembers' the environment in which it was created."

### Impact Scope

**Affects:**
- All position updates after browser restart
- All size updates after browser restart
- All position/size updates after minimize/restore
- Hydrated Quick Tabs from storage.local on extension reload

**Does NOT affect:**
- Initial window creation (callbacks are fresh)
- Updates before first minimize/restore cycle

### Fix Required

Add callback lifecycle management architecture to QuickTabWindow:

1. Create `rewireCallbacks()` method that accepts fresh callback functions
2. Method must replace old callback references with new ones capturing current context
3. New callbacks must capture CURRENT Manager instance and CURRENT `quickTabsMap`
4. Include verification that new callbacks reference correct execution context
5. Log the re-wiring operation with callback names for diagnostics

The new callbacks MUST maintain identical signatures to work with existing DragController/ResizeController:
- `onPositionChange(left: number, top: number): void`
- `onPositionChangeEnd(left: number, top: number): void`
- `onSizeChange(width: number, height: number): void`  
- `onSizeChangeEnd(width: number, height: number): void`

---

## Issue #2: Missing Callback Re-Wiring After Restore

### Problem

Same symptom as Issue #1 but viewed from Handler perspective. After user restores minimized Quick Tab, drag/resize operations fail to persist even though DOM is visible and interactive. This is the missing integration point between Issue #1's architecture and the restore operation flow.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Methods:** `handleRestore()` and `_executeRestore()`  
**Approximate Lines:** 560-680

The restore operation successfully completes multiple steps:
1. ✅ Sets `tabWindow.minimized = false`
2. ✅ Calls `minimizedManager.restore(id)` to recover snapshot
3. ✅ Calls `tabWindow.restore()` to reattach DOM
4. ✅ Re-registers window in `quickTabsMap`
5. ✅ Emits `state:updated` event

**Missing step between 3 and 5:** Callback re-wiring with CURRENT handler references.

After step 4, the `tabWindow` is back in the Map but its callbacks still reference stale closures from construction. When DragController fires callbacks, they execute with stale references to OLD Manager instances that no longer exist, causing silent persistence failures.

### Current vs Required State

**Current State (BROKEN):**
```
UpdateHandler (new instance) ← NOT receiving callbacks
tabWindow.onPositionChangeEnd ← points to OLD UpdateHandler (stale)
DragController ← fires callbacks to stale handler
```

**Required State (FIXED):**
```
UpdateHandler (current instance) ← SHOULD receive callbacks
tabWindow.onPositionChangeEnd ← MUST point to current UpdateHandler
DragController ← fires callbacks to current handler
```

### Fix Required

In `_executeRestore()` method, after the line that calls `tabWindow.restore()`, add callback re-wiring logic:

1. Create fresh callback functions capturing CURRENT handler instances
2. Bind callbacks to CURRENT UpdateHandler and VisibilityHandler
3. Capture CURRENT Manager context in closure scope
4. Call `tabWindow.rewireCallbacks(freshCallbacks)` with new functions
5. Verify callbacks reference current objects (spot check in logs)
6. Log re-wiring operation with callback names

The method signature may need to accept current handler references to properly bind the callbacks to active handler instances rather than stale ones.

---

## Issue #3: DOM Event Listeners Not Cleaned Up

### Problem

Memory usage increases with each minimize/restore cycle. After 10-20 cycles, browser performance degrades noticeably. Memory profiler shows detached DOM trees that cannot be garbage collected, indicating memory leak.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Method:** `minimize()`  
**Approximate Lines:** 900-920

The minimize operation performs DOM detachment:
1. Sets `container.style.display = 'none'`
2. Calls `container.parentNode.removeChild(container)`
3. Sets `this.container = null`

**Before detachment**, the container has ~15+ active event listeners:

**DragController listeners:**
- `mousedown` on titlebar
- `mousemove` on document
- `mouseup` on document

**ResizeController listeners:**
- `mousedown` on 8 resize handles (4 corners + 4 edges)
- `mousemove` on document  
- `mouseup` on document

**Button listeners:**
- `click` on close button
- `click` on minimize button
- `click` on settings button

None of these are removed before `removeChild()`. The detached DOM tree stays in memory because the browser's event system holds references through these listeners.

From Mozilla MDN on Memory Management:
> "Detached DOM elements are elements that are no longer visible in the document but still occupy memory because of lingering references. This often happens when event listeners or closures maintain references to removed elements."

### Memory Leak Accumulation

Each minimize/restore cycle:
1. Creates new DOM tree with new listeners (restore)
2. Detaches old DOM tree WITHOUT removing listeners (minimize)
3. Old tree stays in memory (cannot GC due to listener references)
4. Repeat cycle adds another orphaned tree

After 20 cycles: 20 detached DOM trees in memory, each with ~15 listeners, all preventing garbage collection.

### Missing Components

**In DragController (`src/features/quick-tabs/window/DragController.js`):**
- Missing `cleanup()` method that calls `removeEventListener()` for all drag listeners
- Missing storage of bound function references (needed for removal)

**In ResizeController (`src/features/quick-tabs/window/ResizeController.js`):**
- Missing `cleanup()` method that calls `removeEventListener()` for all resize listeners
- Missing storage of bound function references (needed for removal)

**In window.js `minimize()` method:**
- Missing call to `this.dragController.cleanup()` BEFORE DOM detachment
- Missing call to `this.resizeController.cleanup()` BEFORE DOM detachment
- Missing manual removal of button click listeners

### Fix Required

Add cleanup architecture following symmetric setup/teardown pattern:

**In controllers:**
1. Store bound function references during setup (e.g., `this._boundHandleDrag = this.handleDrag.bind(this)`)
2. Use stored reference for both `addEventListener()` and `removeEventListener()`
3. Create `cleanup()` method that removes all listeners using stored references
4. Set stored references to null after removal
5. Make cleanup idempotent (safe to call multiple times)

From W3Schools on removeEventListener():
> "You must use the same function object for both addEventListener and removeEventListener."

**In window.js `minimize()` method:**
1. Call controller cleanup methods BEFORE `this.container = null`
2. Verify listeners removed (check count or log)
3. THEN perform DOM detachment
4. FINALLY clear container reference

**Critical timing:** Cleanup MUST happen BEFORE `this.container = null`. If reference is cleared first, there's no way to access the DOM element to call `removeEventListener()`.

---

## Issue #4: Callback Suppression Blocks Legitimate Updates

### Problem

User restores minimized Quick Tab, immediately drags it to new position (within ~50ms), but position doesn't persist. If user waits 1 second then drags, it persists correctly. This creates confusing UX where rapid interactions after restore are silently dropped.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Methods:** `handleMinimize()` and related callback suppression logic  
**Approximate Lines:** 470-495

The suppression pattern uses a `_initiatedOperations` Set with time-based clearing:

**Current flow:**
1. Handler adds operation key to `_initiatedOperations` Set
2. Calls `tabWindow.minimize()` which triggers `onMinimize` callback
3. Callback checks if operation key exists in Set
4. If yes, returns early (suppressed to prevent circular calls)
5. `setTimeout()` clears operation key after 50ms

**The problem:** This suppresses ALL callbacks during the 50ms window, not just the circular one.

**Failure scenario:**
```
t=0ms: User clicks Restore in Manager
t=0ms: Handler adds 'restore-123' to suppression Set
t=5ms: User sees window appear
t=10ms: User immediately drags window to new position
t=10ms: DragController fires onPositionChangeEnd()
t=10ms: Callback checks suppression Set → finds 'restore-123'
t=10ms: Callback returns early (position update LOST)
t=50ms: setTimeout clears 'restore-123' from Set
t=51ms: Too late - position update was already dropped
```

### Why Suppression Exists

It prevents circular callback storms:
```
Without suppression:
Handler.minimize(id)
  → tabWindow.minimize()
    → fires onMinimize callback
      → Handler.handleMinimize(id)
        → tabWindow.minimize() (CIRCULAR!)
```

The suppression prevents the callback from calling back into the Handler during the operation it initiated.

### Why Current Approach is Too Broad

The suppression is GLOBAL for all callbacks during the time window. It should only suppress the specific callback that would cause circularity:

- Minimize operation should ONLY suppress `onMinimize` callback
- Should NOT suppress `onPositionChangeEnd` callback
- Should NOT suppress `onSizeChangeEnd` callback
- Should NOT suppress `onFocus` callback

Current implementation suppresses everything because the operation key is checked by all callback types.

### Fix Required

Replace broad time-based suppression with operation-specific flags:

**On tabWindow instance:**
- Add `isMinimizing` boolean flag (operation-specific)
- Add `isRestoring` boolean flag (operation-specific)

**In minimize() method:**
- Set `this.isMinimizing = true` BEFORE DOM operations
- Perform minimize operations
- Set `this.isMinimizing = false` AFTER DOM operations complete

**In onMinimize callback:**
- Check: `if (tabWindow.isMinimizing) return;` (suppress only minimize callback)

**In onPositionChangeEnd callback:**
- No suppression check (always persist position changes)

This allows position/size updates during transitions while preventing circular calls. User can drag immediately after restore without losing updates.

---

## Issue #5: Zero Logging in Critical Callback Paths

### Problem

When drag/resize persistence fails, developer has no diagnostic information. Console logs don't show whether callbacks were called, whether they failed, or what state they observed. This makes debugging Issues #1-4 extremely difficult.

### Root Cause

**Multiple Files:**
- `src/features/quick-tabs/window.js` (minimize/restore methods)
- `src/features/quick-tabs/window/DragController.js` (_handleDragEnd method)
- `src/features/quick-tabs/window/ResizeController.js` (_handleResizeEnd method)

### Missing Logging Points

**In window.js `minimize()` method (currently has NO logging for):**
- Entry point with window ID
- DOM detachment operation
- DOM detachment verification (check parentNode is null)
- Event listener cleanup execution
- Cleanup completion with listener count

**In window.js `restore()` method (currently has NO logging for):**
- Entry point with window ID
- DOM reattachment operation
- DOM reattachment verification (check isConnected is true)
- Callback re-wiring execution
- Re-wiring completion with callback names

**In DragController `_handleDragEnd()` (currently has NO logging for):**
- Drag operation completion with window ID
- Callback invocation with exact parameters
- Callback success confirmation
- Errors thrown by callback (with stack trace)

**In ResizeController `_handleResizeEnd()` (currently has NO logging for):**
- Resize operation completion with window ID
- Callback invocation with exact parameters
- Callback success confirmation
- Errors thrown by callback (with stack trace)

### Why This Prevents Diagnosis

**Current situation when user reports "drag doesn't persist after restart":**

Developer checks console logs:
- ❌ No log showing DragController fired callback
- ❌ No log showing callback was called with parameters
- ❌ No log showing callback failed
- ❌ No log showing what Manager instance callback saw
- ❌ No error messages indicating undefined references

Developer cannot determine: Was callback invoked? Did it fail silently? Did it see stale references? Was it suppressed?

**With comprehensive logging:**

Developer checks console logs:
- ✅ `[DragController] Drag ended for window: abc123`
- ✅ `[DragController] Calling onPositionChangeEnd(150, 200)`
- ✅ `[DragController] ERROR in onPositionChangeEnd: Cannot read property 'updatePosition' of undefined`
- ✅ Stack trace shows callback tried to access undefined Manager

Immediately identifies Issue #1 (stale closure) as root cause.

### Fix Required

Add comprehensive logging throughout callback execution paths:

**For every callback invocation:**
1. Log BEFORE calling callback (callback name, parameters, window ID)
2. Wrap callback in try/catch block
3. In catch block: Log detailed error (message, stack trace, callback name, parameters, current state snapshot)
4. Log completion status ("Callback completed successfully" OR "Callback failed")

**Log format consistency:**
- Use `[ClassName][MethodName]` prefix for easy grep filtering
- Include window ID in all logs for correlation
- Include operation type (minimize, restore, drag, resize)
- Include timestamp for sequence reconstruction

**Example pattern:**
```
[DragController][_handleDragEnd] Drag ended for window: qt-123
[DragController][_handleDragEnd] Calling onPositionChangeEnd(150, 200)
[DragController][_handleDragEnd] ERROR in onPositionChangeEnd: Cannot read property 'updatePosition' of undefined
  Stack: <full stack trace>
  Callback: onPositionChangeEnd
  Parameters: left=150, top=200
  State: Manager exists=false, Map size=3
```

This creates complete audit trail of callback execution for debugging.

---

## Issue #6: Manager List Not Updating When Last Quick Tab Closed

### Problem

User closes the last remaining Quick Tab using the window's close button. The Quick Tab disappears from viewport, but the Manager panel list still shows it as existing. Manager list is stale and doesn't reflect actual state until manual refresh.

### Root Cause

**Missing Component:** Event listener for `state:deleted` events in Manager/Panel code

**Event flow (CORRECT emission):**
1. ✅ User clicks close button on Quick Tab window
2. ✅ `tabWindow.destroy()` called
3. ✅ Routes to `DestroyHandler.handleDestroy(id, 'UI')`
4. ✅ DestroyHandler emits `state:deleted` event with payload
5. ✅ Event successfully emitted to event bus

**Event consumption (PARTIAL):**
- ✅ UICoordinator receives event
- ✅ UICoordinator removes window from DOM  
- ✅ UICoordinator updates internal Map
- ❌ Manager/Panel component NEVER receives event
- ❌ Manager list UI never updated

### Evidence from Code

**File:** `src/features/quick-tabs/handlers/DestroyHandler.js`  
**Lines:** 63-68

Comment states: "Panel listens for this event to update its display"

**Reality:** No Panel listener exists in codebase. Comment describes intended behavior, not actual implementation.

The `state:deleted` event is emitted correctly with valid data. Event bus works correctly. UICoordinator receives the event. The ONLY problem is that the Manager/Panel component never registered a listener for this event.

### Why Silent Failure

JavaScript event systems don't throw errors for events with zero listeners. Event emission is fire-and-forget. If no listeners registered, event is simply dropped without error or warning.

### Event Bus Scope Concern

The Manager/Panel component may be in a different JavaScript context:
- QuickTabWindow runs in content script context
- Manager/Panel might run in popup context OR sidebar context  
- Event bus instance might not be shared across contexts

If Manager/Panel is in popup/sidebar, it may need to:
1. Listen to `browser.storage.onChanged` events (cross-context), OR
2. Listen to `browser.runtime.onMessage` events (cross-context), OR
3. Share the same event bus instance (requires proper initialization)

### Fix Required

1. Locate Manager/Panel component that renders the Quick Tab list
2. Add event listener for `state:deleted` events
3. Listener should remove Quick Tab from list UI on event receipt
4. Update count display ("You have N Quick Tabs")
5. Handle zero-count state (show "No Quick Tabs" message)
6. Include defensive checks (verify ID exists, verify list item found)
7. Log listener registration at startup for verification
8. Log event receipt with ID for diagnostics

**Listener pattern structure:**
- Verify event payload has valid ID
- Find corresponding list item in Manager UI
- Remove from DOM
- Update count display
- Log operation completion

If Manager/Panel uses alternative update mechanisms (storage polling, storage listeners, message passing, direct state access), determine why it's not responding to the last Quick Tab being closed.

---

## Shared Implementation Patterns

### Callback Lifecycle Architecture

All callback-related fixes must follow this lifecycle:

**Phase 1 - Construction:**
- Set callbacks with current Manager context
- Capture current execution environment in closures

**Phase 2 - Minimize:**
- Clean up event listeners BEFORE DOM detachment
- Call `DragController.cleanup()`
- Call `ResizeController.cleanup()`
- Remove button event listeners
- THEN detach DOM
- FINALLY clear references

**Phase 3 - Restore:**
- Reattach DOM
- Re-wire callbacks with CURRENT Manager context
- Capture CURRENT execution environment in new closures
- Verify new callbacks reference correct instances
- Log re-wiring operation

**Phase 4 - Destruction:**
- Clean up all callbacks
- Clean up all listeners
- Remove all references

### Error Handling Pattern

For EVERY callback invocation throughout the codebase:

1. Log entry with callback name and parameters
2. Try block: Execute callback
3. Catch block: Log error with full context (message, stack trace, callback name, parameters, state snapshot)
4. Finally block: Log completion status

This creates audit trail for debugging Issues #1-2.

### Logging Standards

**Prefix format:** `[ClassName][MethodName]`

**What to log:**
- Entry/exit of critical methods
- State transitions (minimize → minimized)
- Callback invocations with parameters
- Errors with full context
- DOM operations (attach/detach)
- Map operations (add/delete)

**What NOT to log:**
- Sensitive user data
- High-frequency operations (mousemove)
- Internal helper method calls

---

<acceptancecriteria>
**Issue #1: Stale Closure References**
- After browser restart, drag operations persist to storage
- After minimize/restore, drag operations persist to storage
- Callbacks reference current Manager instance
- No undefined reference errors in console
- Position/size changes survive page reload

**Issue #2: Missing Callback Re-Wiring**
- After restore, callbacks are re-wired automatically
- Re-wiring logged with callback names
- Drag/resize after restore persists correctly
- Storage receives updates from callbacks post-restore

**Issue #3: DOM Event Listener Cleanup**
- Event listeners removed before DOM detachment
- `DragController.cleanup()` method exists and works
- `ResizeController.cleanup()` method exists and works
- Memory profiler shows no detached DOM trees after 10 minimize/restore cycles
- Memory usage stable across 20 minimize/restore cycles

**Issue #4: Callback Suppression Removed**
- Position/size callbacks never suppressed
- User can drag/resize immediately after restore (<50ms window)
- Updates persist even during restore transition
- Operation-specific flags replace time-based suppression

**Issue #5: Comprehensive Logging**
- Every callback invocation logged (entry + exit)
- Errors in callbacks logged with stack trace
- DOM operations logged with verification
- Callback re-wiring logged with status
- Logs include window ID, operation type, timestamp

**Issue #6: Manager List Updates**
- Manager list updates when last Quick Tab closed
- Manager shows "No Quick Tabs" when count reaches zero
- Event listener for `state:deleted` exists in Manager/Panel
- List updates within 100ms of close action
- No stale entries remain in list UI

**All Issues**
- All existing tests pass
- No new console errors or warnings
- Manual test: Create → Minimize → Restore → Drag → Reload → Position persists
- Manual test: Create → Close browser → Reopen → Drag → Position persists
- Manual test: Create 3 tabs → Close all → Manager list shows zero
- Memory profiler shows no leaks after 20 cycles
</acceptancecriteria>

---

## Priority & Sequencing

### Phase 1: Foundation (Issues #3 & #5)
**Why first:** Cleanup and logging enable verification of subsequent fixes

1. Add cleanup methods to controllers
2. Add comprehensive logging throughout
3. Verify cleanup works in minimize/restore cycle
4. Verify logs show callback execution flow

### Phase 2: Callback Architecture (Issues #1 & #2)
**Why second:** Core fix for persistence failures

1. Implement `rewireCallbacks()` method
2. Add re-wiring calls after restore
3. Verify callbacks reference current instances
4. Test browser restart and minimize/restore scenarios

### Phase 3: Suppression Fix (Issue #4)
**Why third:** Depends on working callback re-wiring

1. Remove time-based suppression Set
2. Add operation-specific flags
3. Update callbacks to check appropriate flags
4. Test rapid interactions after restore

### Phase 4: Manager List (Issue #6)
**Why last:** Independent issue, separate from callback architecture

1. Locate Manager/Panel component code
2. Add `state:deleted` event listener
3. Update list UI on event
4. Handle zero-count state display

---

## Supporting Context

<details>
<summary>Log Evidence - Minimize/Restore Cycle</summary>

From logs showing successful minimize but callbacks not persisting after restore:

```
2025-12-04T072732.845Z LOG VisibilityHandler Called tabWindow.minimize source Manager
2025-12-04T072733.932Z LOG VisibilityHandler Called tabWindow.restore source Manager
2025-12-04T072735.757Z LOG QuickTabWindow Calling onPositionChangeEnd callback
2025-12-04T072735.757Z LOG UpdateHandler handlePositionChangeEnd called
2025-12-04T072735.757Z LOG UpdateHandler Updated tab position in Map
```

Note: Position updated in Map but logs don't show callback re-wiring after restore, confirming Issue #2.
</details>

<details>
<summary>JavaScript Closure Mechanics</summary>

From Mozilla MDN on Closures:
> "A closure is the combination of a function bundled together with references to its surrounding state (the lexical environment). Closures give you access to an outer function's scope from an inner function. The closure 'remembers' the environment in which it was created."

Key insight: Callbacks created at construction time capture execution context at that moment. They continue referencing that original context even after new instances are created.
</details>

<details>
<summary>Memory Management</summary>

From Mozilla MDN on Memory Management:
> "The main cause for leaks in garbage collected languages are unwanted references. A common source of unwanted references is when event handlers are registered on DOM elements but never removed when the element is deleted."

Key insight: Event listeners prevent garbage collection of detached DOM elements. Must call `removeEventListener()` before removing elements.
</details>

<details>
<summary>Event System Behavior</summary>

From Mozilla MDN on Event System:
> "Event listeners must be registered on the target that will receive the event. If no listener is registered, the event is emitted but nothing responds to it."

Key insight: Events don't throw errors when no listeners registered. Silent failure requires proactive listener verification.
</details>

---

## Notes for Implementation

### Callback Re-Wiring Verification

After re-wiring, verify new callbacks capture current state:
1. Call a test callback immediately
2. Check if it can access current Manager instance
3. Check if it can access current `quickTabsMap`
4. If any check fails, log error and retry re-wiring

New callbacks MUST match existing signatures:
- `onPositionChangeEnd(left: number, top: number): void`
- `onSizeChangeEnd(width: number, height: number): void`

Changing signatures requires updating DragController/ResizeController callers.

### Cleanup Method Design

Every `addEventListener()` needs corresponding `removeEventListener()`:

Setup pattern:
- Store bound function reference: `this._boundHandleDrag = this.handleDrag.bind(this)`
- Use stored reference: `element.addEventListener('mousedown', this._boundHandleDrag)`

Teardown pattern:
- Use same reference: `element.removeEventListener('mousedown', this._boundHandleDrag)`
- Clear reference: `this._boundHandleDrag = null`

Make cleanup idempotent - safe to call multiple times, checks if listeners exist before removing.

### Suppression Flag Scope

Operation-specific flags are instance-level, not global:

On tabWindow instance:
- `this.isMinimizing` (boolean)
- `this.isRestoring` (boolean)

In `minimize()`: Set flag true, perform operations, set flag false
In `onMinimize` callback: Check flag, return early if true

NOT global/static - each tabWindow tracks its own operation state independently.

---

**Priority:** Critical (Issues #1-2), High (Issue #3), Medium (Issues #4-6)  
**Target:** Address in phases with incremental testing  
**Estimated Complexity:** High - requires architectural changes to callback lifecycle management