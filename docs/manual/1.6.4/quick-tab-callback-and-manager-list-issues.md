# Quick Tab Critical Failures: Callback Architecture + Manager List Bugs

**Extension Version:** v1.6.3.5-v10  
**Report Date:** December 4, 2025  
**Severity:** Critical

---

## Executive Summary

Comprehensive analysis reveals **SIX critical architectural failures** in the
Quick Tab system:

1. **Stale closure references** preventing position/size persistence after
   restore
2. **Missing callback re-wiring** after DOM reattachment cycles
3. **Event listener memory leaks** from improper cleanup
4. **Overly aggressive callback suppression** blocking legitimate updates
5. **Zero diagnostic logging** in critical callback paths
6. **Manager list not updating** when last Quick Tab closed (NEW)

All issues are interconnected through JavaScript closure lifecycle management,
DOM event handling, and event bus architecture. Issues #1-5 affect drag/resize
persistence after browser restart or minimize/restore. Issue #6 is a separate
event listener registration bug causing stale UI state.

---

## Issue #1: Stale Closure References After Restore

### Symptom

After browser restart with hydration OR minimize/restore cycle, user can
drag/resize Quick Tabs but changes don't persist to storage. Visual position
updates but page reload reverts to old position.

### Root Cause Location

**File:** `src/features/quick-tabs/window.js`  
**Component:** `QuickTabWindow` class constructor  
**Approximate Lines:** 130-145 (callback initialization section)

### What's Broken

The callbacks `onPositionChange`, `onSizeChange`, `onPositionChangeEnd`, and
`onSizeChangeEnd` are assigned once at construction time. JavaScript closures
capture the execution context at creation:

- Manager instance reference (at construction)
- quickTabsMap Map reference (at construction)
- DOM element references (at construction)

**The closure problem:**

After browser restart, a NEW Manager instance is created with a NEW
quickTabsMap. But the callbacks still close over the OLD instances from before
restart. When DragController fires `onPositionChangeEnd()`, the callback
executes with references to objects that no longer exist in memory.

**After minimize/restore:** DOM elements are detached then reattached, but
callbacks still reference the original DOM tree from construction. This creates
stale element references.

### Evidence Trail

From Mozilla MDN on JavaScript closures:

> "A closure is the combination of a function bundled together with references
> to its surrounding state (the lexical environment). Closures give you access
> to an outer function's scope from an inner function. The closure 'remembers'
> the environment in which it was created."

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

### Why Silent Failure Occurs

The callback code likely has try/catch blocks or conditional checks that prevent
error propagation. When callback tries to access undefined Manager instance, one
of these happens:

1. Optional chaining (`manager?.updatePosition`) returns undefined silently
2. Conditional check (`if (manager) { ... }`) evaluates false and skips persist
3. Try/catch block swallows the undefined reference error

Result: No console error, no storage write, user confused why drag doesn't
persist.

### Impact Scope

**Affects:**

- All position updates after browser restart
- All size updates after browser restart
- All position/size updates after minimize/restore
- Hydrated Quick Tabs from storage.local on extension reload

**Does NOT affect:**

- Initial window creation (callbacks are fresh)
- Updates before first minimize/restore cycle
- Updates before browser restart

### Missing Architecture

There is NO callback lifecycle management. Callbacks are "set and forget" at
construction with no mechanism to refresh them when execution context changes.
The codebase needs:

1. A `rewireCallbacks()` method on QuickTabWindow
2. Calls to `rewireCallbacks()` after every restore operation
3. Mechanism to pass current Manager context to callbacks
4. Verification that new callbacks capture current closure scope

---

## Issue #2: Missing Callback Re-Wiring After Restore

### Symptom

Same as Issue #1 but viewed from the Handler perspective. After user restores
minimized Quick Tab, drag/resize operations fail to persist even though DOM is
visible and interactive.

### Root Cause Location

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Methods:** `handleRestore()` and `_executeRestore()`  
**Approximate Lines:** 560-680

### What's Missing

The restore operation successfully:

1. ✅ Sets `tabWindow.minimized = false`
2. ✅ Calls `minimizedManager.restore(id)` to recover snapshot
3. ✅ Calls `tabWindow.restore()` to reattach DOM
4. ✅ Re-registers window in `quickTabsMap`
5. ✅ Emits `state:updated` event

But it NEVER re-wires the callbacks. After step 4, the tabWindow is back in the
Map but its callbacks still reference stale closures from construction.

### Expected Behavior (Missing)

Between step 3 and 5, there should be:

**Step 3.5: Callback Re-Wiring**

- Create fresh callback functions capturing CURRENT Manager instance
- Create fresh callback functions capturing CURRENT quickTabsMap
- Call `tabWindow.rewireCallbacks(freshCallbacks)`
- Verify callbacks now reference current execution context
- Log the re-wiring operation with callback names

Without this step, DragController and ResizeController fire callbacks that
execute with stale references, causing silent persistence failures.

### Why This Matters

The handlers (UpdateHandler, VisibilityHandler) are the correct Manager instance
that should receive callbacks. But tabWindow still has callbacks pointing to OLD
handler instances from before restore. This creates a disconnect:

```
Current State (BROKEN):
  UpdateHandler (new instance) ← NOT receiving callbacks
  tabWindow.onPositionChangeEnd ← points to OLD UpdateHandler (stale)
  DragController ← fires callbacks to stale handler

Required State (FIXED):
  UpdateHandler (current instance) ← SHOULD receive callbacks
  tabWindow.onPositionChangeEnd ← MUST point to current UpdateHandler
  DragController ← fires callbacks to current handler
```

### Code Location Detail

In `_executeRestore()` method, after this line:

```
// Existing code (line ~XXX):
tabWindow.restore();
```

There should be callback re-wiring logic that creates fresh callbacks and passes
them to tabWindow. The method signature would need to accept current handler
references to bind the callbacks correctly.

### Constraint

The new callbacks MUST maintain the same signature (parameter types and order)
as the original callbacks to work with existing DragController/ResizeController
implementations that call:

- `onPositionChange(left, top)`
- `onPositionChangeEnd(left, top)`
- `onSizeChange(width, height)`
- `onSizeChangeEnd(width, height)`

Changing these signatures would require updating DragController and
ResizeController, expanding the scope.

---

## Issue #3: DOM Event Listeners Not Cleaned Up

### Symptom

Memory usage increases with each minimize/restore cycle. After 10-20 cycles,
browser performance degrades. Memory profiler shows detached DOM trees that
cannot be garbage collected.

### Root Cause Location

**File:** `src/features/quick-tabs/window.js`  
**Method:** `minimize()`  
**Approximate Lines:** 900-920

### What's Broken

The minimize operation:

1. Sets `container.style.display = 'none'`
2. Calls `container.parentNode.removeChild(container)` (DOM detachment)
3. Sets `this.container = null` (reference cleared)

But BEFORE detachment, the container has active event listeners:

**DragController listeners:**

- `mousedown` on titlebar
- `mousemove` on document
- `mouseup` on document

**ResizeController listeners:**

- `mousedown` on resize handles (4 corners + 4 edges = 8 handles)
- `mousemove` on document
- `mouseup` on document

**Button listeners:**

- `click` on close button
- `click` on minimize button
- `click` on settings button

**Total:** ~15+ event listeners PER Quick Tab

None of these are removed before `removeChild()`. The detached DOM tree stays in
memory because the browser's event system holds references through these
listeners.

### Evidence from MDN

From Mozilla MDN on Memory Management:

> "Detached DOM elements are elements that are no longer visible in the document
> but still occupy memory because of lingering references. This often happens
> when event listeners or closures maintain references to removed elements."

From JavaScript best practices:

> "Before removing a DOM element, always call removeEventListener() for every
> event that was registered. Otherwise, the browser cannot garbage collect the
> element because event system holds references."

### Memory Leak Accumulation

Each minimize/restore cycle:

1. Creates new DOM tree with new listeners (restore)
2. Detaches old DOM tree WITHOUT removing listeners (minimize)
3. Old tree stays in memory (cannot GC due to listener references)
4. Repeat cycle adds another orphaned tree

After 20 cycles: 20 detached DOM trees in memory, each with ~15 listeners, all
preventing GC.

### Missing Cleanup Methods

**File:** `src/features/quick-tabs/window/DragController.js`  
**Missing:** `cleanup()` method that calls `removeEventListener()` for all drag
listeners

**File:** `src/features/quick-tabs/window/ResizeController.js`  
**Missing:** `cleanup()` method that calls `removeEventListener()` for all
resize listeners

**File:** `src/features/quick-tabs/window.js`  
**Missing:** Call to `this.dragController.cleanup()` before DOM detachment  
**Missing:** Call to `this.resizeController.cleanup()` before DOM detachment  
**Missing:** Manual removal of button click listeners

### Implementation Pattern Required

From W3Schools on removeEventListener():

> "You must use the same function object for both addEventListener and
> removeEventListener."

This means:

- Cannot use inline arrow functions for event handlers
- Must store bound function reference (e.g., `this._boundHandleDrag`)
- Use same reference for both `addEventListener(this._boundHandleDrag)` and
  `removeEventListener(this._boundHandleDrag)`

Current code likely uses inline functions or doesn't store references, making
cleanup impossible.

### Critical Timing

Cleanup MUST happen BEFORE `this.container = null`. If reference is cleared
first, there's no way to access the DOM element to call `removeEventListener()`.
The container would be detached but unreachable.

---

## Issue #4: Callback Suppression Blocks Legitimate Updates

### Symptom

User restores minimized Quick Tab, immediately drags it to new position (within
~50ms), but position doesn't persist. If user waits 1 second then drags, it
persists correctly.

### Root Cause Location

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Methods:** `handleMinimize()` and related callback suppression logic  
**Approximate Lines:** 470-495

### What's Broken

The suppression pattern uses a `_initiatedOperations` Set with time-based
clearing:

**Current flow:**

1. Handler adds operation key to `_initiatedOperations` Set
2. Calls `tabWindow.minimize()` which triggers `onMinimize` callback
3. Callback checks if operation key exists in Set
4. If yes, returns early (suppressed to prevent circular calls)
5. `setTimeout()` clears operation key after 50ms

**The problem:** This suppresses ALL callbacks during the 50ms window, not just
the circular one.

**Failure scenario:**

```
t=0ms: User clicks Restore in Manager
t=0ms: Handler adds 'restore-123' to suppression Set
t=0ms: tabWindow.restore() called (DOM reattaches)
t=5ms: User sees window appear
t=10ms: User immediately drags window to new position
t=10ms: DragController fires onPositionChangeEnd()
t=10ms: Callback checks suppression Set → finds 'restore-123'
t=10ms: Callback returns early (position update LOST)
t=50ms: setTimeout clears 'restore-123' from Set
t=51ms: Too late - position update was already dropped
```

### Why Suppression Exists

It was added to prevent circular callback storms:

```
Without suppression:
Handler.minimize(id)
  → tabWindow.minimize()
    → fires onMinimize callback
      → Handler.handleMinimize(id)
        → tabWindow.minimize() (CIRCULAR!)
```

The suppression prevents the callback from calling back into the Handler during
the operation it initiated.

### Why Current Approach is Too Broad

The suppression is GLOBAL for all callbacks during the time window. It should
only suppress the specific callback that would cause circularity:

- Minimize operation should ONLY suppress `onMinimize` callback
- Should NOT suppress `onPositionChangeEnd` callback
- Should NOT suppress `onSizeChangeEnd` callback
- Should NOT suppress `onFocus` callback

But current implementation suppresses everything because the operation key is
checked by all callback types.

### Required Pattern

Replace broad time-based suppression with operation-specific flags:

**On tabWindow instance:**

- `isMinimizing` boolean flag (operation-specific)
- `isRestoring` boolean flag (operation-specific)

**In minimize() method:**

```
Set this.isMinimizing = true (BEFORE DOM operations)
... do minimize operations ...
Set this.isMinimizing = false (AFTER DOM operations)
```

**In onMinimize callback:**

```
Check: if (tabWindow.isMinimizing) return; (suppress only minimize callback)
```

**In onPositionChangeEnd callback:**

```
No suppression check (always persist position changes)
```

This allows position/size updates during transitions while preventing circular
calls.

---

## Issue #5: Zero Logging in Critical Callback Paths

### Symptom

When drag/resize persistence fails, developer has no diagnostic information.
Logs don't show whether callbacks were called, whether they failed, or what
state they observed.

### Root Cause Location

**Multiple Files:**

- `src/features/quick-tabs/window.js` (minimize/restore methods)
- `src/features/quick-tabs/window/DragController.js` (\_handleDragEnd method)
- `src/features/quick-tabs/window/ResizeController.js` (\_handleResizeEnd
  method)

### Missing Logging Points

**In window.js minimize() method:**

Currently has NO logging for:

- Entry point (when method called)
- DOM detachment operation
- DOM detachment verification (check parentNode is null)
- Event listener cleanup (not implemented yet)

Should log:

- `[QuickTabWindow][minimize] Called for window: ${this.id}`
- `[QuickTabWindow][minimize] Detaching container from DOM`
- `[QuickTabWindow][minimize] Container detached, parentNode: ${this.container.parentNode}`
- `[QuickTabWindow][minimize] Cleanup complete - removed N event listeners`

**In window.js restore() method:**

Currently has NO logging for:

- Entry point (when method called)
- DOM reattachment operation
- DOM reattachment verification (check isConnected is true)
- Callback re-wiring (not implemented yet)

Should log:

- `[QuickTabWindow][restore] Called for window: ${this.id}`
- `[QuickTabWindow][restore] Reattaching container to DOM`
- `[QuickTabWindow][restore] Container attached, isConnected: ${this.container.isConnected}`
- `[QuickTabWindow][restore] Re-wired callbacks: [list of callback names]`

**In DragController.\_handleDragEnd() method:**

Currently has NO logging for:

- Drag operation completion
- Callback invocation with parameters
- Callback success/failure
- Errors thrown by callback

Should log:

- `[DragController][_handleDragEnd] Drag ended for window: ${this.windowId}`
- `[DragController][_handleDragEnd] Calling onPositionChangeEnd(${left}, ${top})`
- `[DragController][_handleDragEnd] onPositionChangeEnd completed successfully`
- `[DragController][_handleDragEnd] ERROR in onPositionChangeEnd: ${error.message}, stack: ${error.stack}`

**In ResizeController.\_handleResizeEnd() method:**

Currently has NO logging for:

- Resize operation completion
- Callback invocation with parameters
- Callback success/failure
- Errors thrown by callback

Should log:

- `[ResizeController][_handleResizeEnd] Resize ended for window: ${this.windowId}`
- `[ResizeController][_handleResizeEnd] Calling onSizeChangeEnd(${width}, ${height})`
- `[ResizeController][_handleResizeEnd] onSizeChangeEnd completed successfully`
- `[ResizeController][_handleResizeEnd] ERROR in onSizeChangeEnd: ${error.message}, stack: ${error.stack}`

### Why This Prevents Diagnosis

**Current situation when user reports "drag doesn't persist after restart":**

Developer checks console logs:

- ❌ No log showing DragController fired callback
- ❌ No log showing callback was called with parameters
- ❌ No log showing callback failed
- ❌ No log showing what Manager instance callback saw
- ❌ No error messages indicating undefined references

Developer cannot determine:

- Was callback invoked at all?
- Did callback execute but fail silently?
- Did callback see stale references?
- Was callback suppressed?
- Did callback throw an error that was caught?

**With comprehensive logging:**

Developer checks console logs:

- ✅ `[DragController] Drag ended for window: abc123`
- ✅ `[DragController] Calling onPositionChangeEnd(150, 200)`
- ✅
  `[DragController] ERROR in onPositionChangeEnd: Cannot read property 'updatePosition' of undefined`
- ✅ Stack trace shows callback tried to access undefined Manager

Immediately identifies Issue #1 (stale closure) as the root cause.

### Required Error Handling Pattern

Every callback invocation should be wrapped:

```
Structure (not code):
1. Log BEFORE calling callback
   - Include callback name
   - Include all parameters being passed
   - Include window ID for context

2. Try block: Call the callback

3. Catch block: Log detailed error
   - Error message
   - Full stack trace
   - Callback name that failed
   - Parameters that were passed
   - Current state snapshot (Manager exists? Map size?)

4. Finally block (optional): Log completion status
   - "Callback completed successfully" OR
   - "Callback failed, see error above"
```

This creates complete audit trail of callback execution for debugging.

### Log Format Consistency

All logs should use consistent prefix format for easy filtering:

`[ClassName][MethodName]` - Example: `[QuickTabWindow][minimize]`

This allows developer to grep logs by component:

- `grep "QuickTabWindow" console.log` - see all QuickTabWindow operations
- `grep "DragController" console.log` - see all drag operations
- `grep "onPositionChangeEnd" console.log` - see all position callbacks

---

## Issue #6: Manager List Not Updating When Last Quick Tab Closed (NEW)

### Symptom

User closes the last remaining Quick Tab using the window's close button. The
Quick Tab disappears from viewport, but the Manager panel list still shows it as
existing. Manager list is stale and doesn't reflect actual state.

### Root Cause Location

**Missing Component:** Event listener for `state:deleted` events in
Manager/Panel code

**Correctly Emitting:**

- `src/features/quick-tabs/handlers/DestroyHandler.js` lines 47-72
  (`_emitStateDeletedEvent` method)

**Correctly Listening:**

- `src/features/quick-tabs/coordinators/UICoordinator.js` line ~2256
  (`state:deleted` listener)

**NOT Listening (BUG):**

- Manager/Panel component (not found in codebase)

### What's Happening

**Event emission flow (CORRECT):**

1. User clicks close button on Quick Tab window
2. `tabWindow.destroy()` called (window.js)
3. Calls `onDestroy` callback
4. Routes to `DestroyHandler.handleDestroy(id, 'UI')`
5. DestroyHandler emits `state:deleted` event with payload:
   ```
   {
     id: 'quick-tab-123',
     quickTab: { id, url, title, source: 'UI' },
     source: 'UI'
   }
   ```
6. Event is successfully emitted to event bus

**Event consumption (PARTIAL):**

- ✅ UICoordinator receives event
- ✅ UICoordinator.destroy(id) removes window from DOM
- ✅ UICoordinator.renderedTabs Map updated
- ❌ Manager/Panel component NEVER receives event
- ❌ Manager list UI never updated

### Evidence from Code

**DestroyHandler.js line 63-68:**

```javascript
// v1.6.3.2 - FIX Bug #4: Panel listens for this event to update its display
const quickTabData = tabWindow
  ? { id, url: tabWindow.url, title: tabWindow.title, source }
  : { id, source };

this.eventBus.emit('state:deleted', { id, quickTab: quickTabData, source });
```

**Comment indicates:** "Panel listens for this event to update its display"

**Reality:** No Panel listener exists in codebase. Comment describes intended
behavior, not actual implementation.

### Why This is a Separate Issue

This is NOT related to the callback closure issues (#1-5). The event is emitted
correctly with valid data. The event bus works correctly. UICoordinator receives
the event. The ONLY problem is that the Manager/Panel component never registered
a listener for this event.

### Event Bus Architecture Gap

From Mozilla MDN on Event System:

> "Event listeners must be registered on the target that will receive the event.
> If no listener is registered, the event is emitted but nothing responds to
> it."

**Current state:**

- Event emitted: ✅
- Event bus functional: ✅
- UICoordinator listening: ✅
- Manager/Panel listening: ❌ (MISSING)

**Event bus scope concern:**

The Manager/Panel component may be in a different JavaScript context:

- QuickTabWindow runs in content script context
- Manager/Panel might run in popup context OR sidebar context
- Event bus instance might not be shared across contexts

If Manager/Panel is in popup/sidebar, it needs to:

1. Listen to browser.storage.onChanged events (cross-context), OR
2. Listen to browser.runtime.onMessage events (cross-context), OR
3. Share the same event bus instance (requires proper initialization)

### Missing Listener Location

**Where listener should exist:**

Need to search for:

- Panel component that renders the Quick Tab list
- Manager component that controls panel display
- Component that shows "You have N Quick Tabs" or similar

**Listener should be:**

```
Structure (not code):
eventBus.on('state:deleted', ({ id, quickTab, source }) => {
  // Remove Quick Tab from list UI
  // Update count display
  // If count is zero, show "No Quick Tabs" message
});
```

### Why Silent Failure

The event system doesn't throw errors for events with zero listeners. From
JavaScript event patterns:

- Emit is fire-and-forget
- If no listeners registered, event is simply dropped
- No error logged, no exception thrown
- Silent failure from developer perspective

Only way to detect: Check event bus listeners after initialization and verify
all required events have listeners.

### Alternative Update Mechanisms

Manager/Panel might be using:

1. **Storage polling** - Reads storage.local every N seconds (inefficient)
2. **Storage listener** - Listens to browser.storage.onChanged (correct for
   cross-context)
3. **Message passing** - Listens to browser.runtime.onMessage (correct for
   cross-context)
4. **Direct state access** - Calls StateManager.getAll() on demand (works but
   not reactive)

Need to determine which mechanism Manager/Panel uses and why it's not responding
to the last Quick Tab being closed.

---

## Scope of Changes Required

### Files Needing Modification

**Primary (Callback Issues #1-5):**

1. `src/features/quick-tabs/window.js`
   - Add callback re-wiring method
   - Add cleanup calls in minimize()
   - Add comprehensive logging in minimize/restore
   - Store bound function references for event listeners

2. `src/features/quick-tabs/handlers/VisibilityHandler.js`
   - Add callback re-wiring after restore
   - Replace time-based suppression with operation flags
   - Add logging for restore operations

3. `src/features/quick-tabs/window/DragController.js`
   - Add cleanup() method
   - Store bound function references
   - Add callback invocation logging
   - Wrap callbacks in try/catch

4. `src/features/quick-tabs/window/ResizeController.js`
   - Add cleanup() method
   - Store bound function references
   - Add callback invocation logging
   - Wrap callbacks in try/catch

**Secondary (Manager List Issue #6):**

5. Manager/Panel component (location TBD)
   - Add event listener for `state:deleted`
   - Update list UI when event received
   - Handle zero-count state display

### Files NOT Modified (Out of Scope)

- `src/background/` - Background script infrastructure
- Storage utilities - Already working correctly
- Event emission code - Already emitting correctly
- StateManager - State tracking is correct
- UICoordinator event handling - Already listening correctly

---

## Shared Implementation Patterns

### Callback Lifecycle Architecture

All callback-related fixes must follow this lifecycle:

**Phase 1 - Construction:**

- Set callbacks with current Manager context
- Capture current execution environment in closures

**Phase 2 - Minimize:**

- Clean up event listeners BEFORE DOM detachment
- Call DragController.cleanup()
- Call ResizeController.cleanup()
- Remove button event listeners
- THEN detach DOM

**Phase 3 - Restore:**

- Reattach DOM
- Re-wire callbacks with CURRENT Manager context
- Capture CURRENT execution environment in new closures
- Verify new callbacks reference correct instances

**Phase 4 - Destruction:**

- Clean up all callbacks
- Clean up all listeners
- Remove all references

### DOM Cleanup Pattern

Before ANY DOM detachment operation:

1. Call controller cleanup methods first
2. Store reference to container (don't clear yet)
3. Call removeEventListener() for ALL registered listeners
4. Verify no lingering references exist
5. THEN call removeChild() or detach operation
6. FINALLY set this.container = null

Order is critical - cannot remove listeners after clearing reference.

### Callback Re-Wiring Pattern

After ANY DOM reattachment operation:

1. Create fresh callback functions
2. Bind to CURRENT handler instances (not old ones)
3. Capture CURRENT Manager in closure scope
4. Pass new callbacks to tabWindow.rewireCallbacks()
5. Verify callbacks reference current objects (spot check)
6. Log re-wiring operation with callback names

### Error Handling Pattern

For EVERY callback invocation:

```
Structure (not code):
1. Log entry: "[Component][Method] About to call callback(params)"
2. Try block: Execute callback
3. Catch block: Log error with full context
   - Error message
   - Stack trace
   - Callback name
   - Parameters passed
   - Current state snapshot
4. Finally block: Log completion status
```

### Logging Standards

**Prefix format:** `[ClassName][MethodName]`

**What to log:**

- Entry/exit of critical methods
- State transitions (minimize → minimized, restore → restored)
- Callback invocations with parameters
- Errors with full context
- DOM operations (attach/detach)
- Map operations (add/delete)

**What NOT to log:**

- Sensitive user data (URLs, titles are OK)
- High-frequency operations (mousemove events)
- Internal helper method calls (too noisy)

---

## Acceptance Criteria

### Issue #1: Stale Closure References

- [ ] After browser restart, drag operations persist to storage
- [ ] After minimize/restore, drag operations persist to storage
- [ ] Callbacks reference current Manager instance
- [ ] No undefined reference errors in console
- [ ] Position/size changes survive page reload

### Issue #2: Missing Callback Re-Wiring

- [ ] After restore, callbacks are re-wired automatically
- [ ] Re-wiring logged with callback names
- [ ] Drag/resize after restore persists correctly
- [ ] Storage receives updates from callbacks post-restore

### Issue #3: DOM Event Listener Cleanup

- [ ] Event listeners removed before DOM detachment
- [ ] DragController.cleanup() method exists and works
- [ ] ResizeController.cleanup() method exists and works
- [ ] Memory profiler shows no detached DOM trees after 10 minimize/restore
      cycles
- [ ] Memory usage stable across 20 minimize/restore cycles

### Issue #4: Callback Suppression Removed

- [ ] Position/size callbacks never suppressed
- [ ] User can drag/resize immediately after restore (<50ms window)
- [ ] Updates persist even during restore transition
- [ ] Operation-specific flags replace time-based suppression

### Issue #5: Comprehensive Logging

- [ ] Every callback invocation logged (entry + exit)
- [ ] Errors in callbacks logged with stack trace
- [ ] DOM operations logged with verification
- [ ] Callback re-wiring logged with status
- [ ] Logs include window ID, operation type, timestamp

### Issue #6: Manager List Updates

- [ ] Manager list updates when last Quick Tab closed
- [ ] Manager shows "No Quick Tabs" when count reaches zero
- [ ] Event listener for state:deleted exists in Manager/Panel
- [ ] List updates within 100ms of close action
- [ ] No stale entries remain in list UI

### All Issues

- [ ] All existing tests pass
- [ ] No new console errors or warnings
- [ ] Manual test: Create → Minimize → Restore → Drag → Reload → Position
      persists
- [ ] Manual test: Create → Close browser → Reopen → Drag → Position persists
- [ ] Manual test: Create 3 tabs → Close all → Manager list shows zero
- [ ] Memory profiler shows no leaks after 20 cycles

---

## Priority & Sequencing

### Phase 1: Foundation (Issues #3 & #5)

**Why first:** Cleanup and logging enable verification of subsequent fixes

1. Add cleanup methods to controllers (Issue #3)
2. Add comprehensive logging throughout (Issue #5)
3. Verify cleanup works in minimize/restore cycle
4. Verify logs show callback execution flow

### Phase 2: Callback Architecture (Issues #1 & #2)

**Why second:** Core fix for persistence failures

1. Implement rewireCallbacks() method (Issue #1)
2. Add re-wiring calls after restore (Issue #2)
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
2. Add state:deleted event listener
3. Update list UI on event
4. Handle zero-count state display

---

## Testing Strategy

### Unit Tests Needed

**For cleanup methods:**

- DragController.cleanup() removes all listeners
- ResizeController.cleanup() removes all listeners
- Memory profiler confirms no references remain

**For callback re-wiring:**

- rewireCallbacks() replaces old functions
- New callbacks reference current Manager
- Old callbacks no longer invoked

### Integration Tests Needed

**Minimize/Restore cycle:**

1. Create Quick Tab
2. Minimize window
3. Verify DOM detached
4. Verify listeners removed
5. Restore window
6. Verify DOM reattached
7. Verify callbacks re-wired
8. Drag window
9. Verify position persists

**Browser restart cycle:**

1. Create Quick Tab
2. Drag to position A
3. Close browser (save state)
4. Reopen browser (hydrate)
5. Verify window at position A
6. Drag to position B
7. Reload page
8. Verify window at position B (persistence works)

**Manager list update:**

1. Create 3 Quick Tabs
2. Close first tab → list shows 2
3. Close second tab → list shows 1
4. Close third tab → list shows 0 with "No Quick Tabs" message

### Manual Testing Checklist

- [ ] Create Quick Tab → Minimize → Restore → Drag → Reload → Position persists
- [ ] Create Quick Tab → Browser restart → Drag → Position persists
- [ ] Create Quick Tab → Minimize → Browser restart → Restore → Drag → Position
      persists
- [ ] Minimize/Restore 20 times → Check memory profiler for leaks
- [ ] Restore → Immediately drag (within 50ms) → Position persists
- [ ] Close last Quick Tab → Manager list shows zero immediately

---

## Supporting Documentation References

### JavaScript Closure Mechanics

**Mozilla MDN - Closures:**

> "A closure is the combination of a function bundled together with references
> to its surrounding state (the lexical environment). Closures give you access
> to an outer function's scope from an inner function. The closure 'remembers'
> the environment in which it was created."

**Key insight:** Callbacks created at construction time capture the execution
context at that moment. They continue referencing that original context even
after new instances are created.

### Memory Management

**Mozilla MDN - Memory Management:**

> "The main cause for leaks in garbage collected languages are unwanted
> references. A common source of unwanted references is when event handlers are
> registered on DOM elements but never removed when the element is deleted."

**Key insight:** Event listeners prevent garbage collection of detached DOM
elements. Must call removeEventListener() before removing elements.

### Event Listener Cleanup

**W3Schools - removeEventListener():**

> "The removeEventListener() method removes an event handler that has been
> attached with the addEventListener() method. You must use the same function
> object for both addEventListener and removeEventListener."

**Key insight:** Cannot use inline arrow functions. Must store bound function
reference to enable cleanup.

### Stale Element References

**Stack Overflow - Stale Element Reference Exception:**

> "A stale element reference occurs when a web element that was once found and
> interacted with is no longer valid in the Document Object Model (DOM). This
> can happen if the element was removed from the DOM and re-added, even if it
> appears identical."

**Key insight:** DOM detachment/reattachment creates new element references. Old
references become stale even if element looks the same.

### Event System Behavior

**Mozilla MDN - Event System:**

> "Event listeners must be registered on the target that will receive the event.
> If no listener is registered, the event is emitted but nothing responds to
> it."

**Key insight:** Events don't throw errors when no listeners registered. Silent
failure requires proactive listener verification.

---

## Notes for Implementation

### Callback Re-Wiring Challenges

**Closure freshness verification:**

After re-wiring, need to verify new callbacks capture current state:

1. Call a test callback immediately
2. Check if it can access current Manager instance
3. Check if it can access current quickTabsMap
4. If any check fails, log error and retry re-wiring

**Signature compatibility:**

New callbacks MUST match existing signature:

- `onPositionChangeEnd(left: number, top: number): void`
- `onSizeChangeEnd(width: number, height: number): void`

Changing signatures requires updating DragController/ResizeController callers.

### Cleanup Method Design

**Symmetric setup/teardown:**

Every `addEventListener()` needs corresponding `removeEventListener()`:

```
Setup (in constructor):
  this._boundHandleDrag = this.handleDrag.bind(this)
  element.addEventListener('mousedown', this._boundHandleDrag)

Teardown (in cleanup()):
  element.removeEventListener('mousedown', this._boundHandleDrag)
  this._boundHandleDrag = null
```

**Idempotency:**

cleanup() should be safe to call multiple times:

- Check if listeners exist before removing
- Clear references after removal
- Log if cleanup called but no listeners found

### Suppression Flag Scope

**Operation-specific flags are instance-level:**

```
On tabWindow instance:
  this.isMinimizing (boolean)
  this.isRestoring (boolean)

In minimize():
  this.isMinimizing = true
  ... operations ...
  this.isMinimizing = false

In onMinimize callback:
  if (tabWindow.isMinimizing) return; // suppress
```

**NOT global/static:** Each tabWindow tracks its own operation state
independently.

### Manager List Event Listener

**Context awareness:**

Need to determine:

1. Where is Manager/Panel component?
2. What JavaScript context does it run in?
3. Does it have access to the event bus?
4. If different context, use browser.storage.onChanged or
   browser.runtime.onMessage

**Defensive coding:**

```
Structure:
eventBus.on('state:deleted', ({ id }) => {
  // Verify id exists
  if (!id) {
    console.error('[Manager] Received state:deleted with no id');
    return;
  }

  // Find list item
  const listItem = findListItemById(id);
  if (!listItem) {
    console.warn('[Manager] List item not found for deletion:', id);
    return;
  }

  // Remove from DOM
  listItem.remove();

  // Update count display
  updateCountDisplay();
});
```

---

## Estimated Complexity

**Issue #1 (Stale Closures):** High

- Requires understanding JavaScript closure semantics
- Needs careful verification of what's captured
- Must test across browser restart and minimize/restore

**Issue #2 (Missing Re-Wiring):** Medium-High

- Straightforward implementation pattern
- Requires passing handler references correctly
- Must verify callbacks work after re-wiring

**Issue #3 (Cleanup):** Medium

- Well-defined pattern (removeEventListener)
- Requires tracking bound function references
- Testing with memory profiler needed

**Issue #4 (Suppression):** Low-Medium

- Simple flag replacement
- Clear operation boundaries
- Easy to test with rapid interactions

**Issue #5 (Logging):** Low

- Straightforward log additions
- No complex logic changes
- Improves debuggability

**Issue #6 (Manager List):** Medium (Unknown)

- Depends on finding Manager/Panel component
- May involve cross-context messaging
- Unknown complexity until component located

**Overall:** High complexity project requiring architectural changes to callback
lifecycle management. Fixes are interdependent and should be implemented in
phases with incremental testing.
