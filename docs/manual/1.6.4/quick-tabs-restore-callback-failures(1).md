# Quick Tab Restore and Callback Architecture Critical Failures

**Extension Version:** v1.6.3.5-v10  
**Date:** December 4, 2025

**<scope>**  
Five critical architectural issues causing Quick Tab position/size updates to
fail after browser restart and restore operations.

**Modify:**

- `src/features/quick-tabs/window.js` (QuickTabWindow class - minimize/restore
  methods, callback re-wiring)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleRestore
  method - callback restoration)
- `src/features/quick-tabs/window/DragController.js` (cleanup and logging)
- `src/features/quick-tabs/window/ResizeController.js` (cleanup and logging)

**Do NOT Modify:**

- `src/background/` (out of scope)
- Storage utilities (working correctly)
- Event emission architecture (correct design) **</scope>**

---

## Executive Summary

Quick Tab position and size updates fail to persist after browser restart with
hydration, and minimized Quick Tabs fail to properly respond to drag/resize
events after restore. Root cause analysis reveals **five distinct architectural
issues** with JavaScript closure management, callback lifecycle, and DOM
cleanup. All issues stem from callbacks being initialized once at construction
time and never being re-wired after DOM detachment/reattachment cycles.

These issues affect:

1. Position/size persistence after browser restart
2. Drag/resize responsiveness after minimize/restore
3. Memory leaks from detached DOM elements
4. Missing diagnostic logging in critical callback paths
5. Callback suppression interfering with legitimate updates

---

## Issues Overview

| #   | Issue                                          | Component              | Severity     | Root Cause                                                             |
| --- | ---------------------------------------------- | ---------------------- | ------------ | ---------------------------------------------------------------------- |
| 1   | Stale closure references after restore         | `window.js` callbacks  | **Critical** | Callbacks capture construction-time state, never updated after restore |
| 2   | Missing callback re-wiring after restore       | `VisibilityHandler.js` | **Critical** | Restore operation never re-registers callbacks with fresh closures     |
| 3   | DOM event listeners not cleaned up             | `window.js` minimize() | **High**     | Detached DOM elements retain event listeners causing memory leaks      |
| 4   | Callback suppression blocks legitimate updates | `VisibilityHandler.js` | **High**     | Suppression flag prevents position/size updates during restore window  |
| 5   | Zero logging in critical callback paths        | Multiple files         | **Medium**   | Impossible to diagnose callback execution failures                     |

**Why bundled:** All issues are interconnected through the callback lifecycle
architecture. Fixing callbacks requires addressing closure management, cleanup,
re-wiring, and logging together. Issues were introduced when v1.6.3+ refactored
to single-tab architecture without updating callback lifecycle management.

---

## Issue #1: Stale Closure References After Restore

### Problem

After browser restart with hydration or minimize/restore cycle, drag and resize
callbacks execute but updates don't persist to storage. Callbacks reference
stale closure variables from construction time.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `QuickTabWindow` constructor, `_initializeCallbacks()` method
(lines ~130-145)

**Issue:** Callbacks like `onPositionChange`, `onSizeChange`,
`onPositionChangeEnd`, and `onSizeChangeEnd` are set once at construction time.
They capture closure scope over:

- The Manager instance at construction time
- The quickTabsMap Map reference at construction time
- DOM element references at construction time

After restore or hydration:

- **New Manager instance created** (browser restart)
- **New quickTabsMap created** (browser restart)
- **DOM elements detached and reattached** (minimize/restore)

But callbacks still hold references to the **old, stale state**. When
DragController or ResizeController fires these callbacks, they execute with
undefined/null references or stale objects that no longer exist.

### Evidence from JavaScript Closure Semantics

From Mozilla MDN documentation on closures:

> "A closure is the combination of a function bundled together with references
> to its surrounding state (the lexical environment). Closures give you access
> to an outer function's scope from an inner function. The closure 'remembers'
> the environment in which it was created."

When callbacks are created:

```
Construction Time (t0):
- Manager instance: ManagerA
- quickTabsMap: MapA
- Callbacks capture: { manager: ManagerA, map: MapA }

After Browser Restart (t1):
- Manager instance: ManagerB (NEW)
- quickTabsMap: MapB (NEW)
- Callbacks still reference: { manager: ManagerA, map: MapA } (STALE)
```

Result: Callbacks execute but reference non-existent objects, silently failing
or throwing undefined reference errors.

### Why It Breaks Position/Size Persistence

When user drags a Quick Tab after restore:

1. DragController detects drag end
2. Calls `onPositionChangeEnd(newLeft, newTop)`
3. Callback closure references **old Manager instance**
4. Attempts to update state on non-existent object
5. Storage persist never happens because callback fails silently
6. User sees position change visually, but reload loses it

### Fix Required

After every restore operation (minimize/restore or browser restart hydration),
re-wire all callbacks to capture **fresh closures** over the current Manager
state and quickTabsMap.

Pattern to follow: After `tabWindow.restore()` completes, immediately call a new
method like `tabWindow.rewireCallbacks(newCallbacks)` that replaces the callback
references with fresh functions that capture the current execution context.

**Critical:** Do NOT just reassign `this.onPositionChange = newCallback`. Must
ensure new callback captures current Manager instance, current quickTabsMap, and
current DOM references in its closure scope.

---

## Issue #2: Missing Callback Re-Wiring After Restore

### Problem

The `handleRestore()` method in VisibilityHandler successfully restores the
Quick Tab's DOM and state but never re-wires the callbacks to fresh handler
functions. This causes drag/resize operations after restore to fail silently.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleRestore()` and `_executeRestore()` methods (lines ~560-680)

**Issue:** The restore flow is:

1. ✅ Set `tabWindow.minimized = false`
2. ✅ Call `minimizedManager.restore(id)` (recovers snapshot)
3. ✅ Call `tabWindow.restore()` (reattaches DOM)
4. ✅ Re-register window in `quickTabsMap`
5. ✅ Emit `state:updated` event
6. ❌ **NEVER re-wires callbacks**

After step 4, the `tabWindow` object is back in the quickTabsMap, but its
callbacks (`onPositionChange`, `onSizeChange`, etc.) are still the original
functions from construction. These callbacks have stale closures over the old
Manager state.

### What Should Happen

After `tabWindow.restore()` completes (step 3), immediately re-wire callbacks:

**Required Step (missing):**

```
After tabWindow.restore() but before emitting state:updated:
- Create fresh callback functions that capture current Manager context
- Call method to update tabWindow's callback references
- Verify callbacks are wired to current handlers
```

This ensures that when DragController or ResizeController fires callbacks after
restore, they reference the **current, valid Manager instance and
quickTabsMap**.

### Why This Causes Silent Failures

Without callback re-wiring:

1. User restores minimized Quick Tab
2. DOM is reattached successfully (window visible)
3. User drags window to new position
4. DragController calls `onPositionChangeEnd()`
5. Callback executes with **stale Manager reference**
6. Storage persist attempt fails (undefined object access)
7. **No error logged** because callback suppression or try/catch swallows it
8. User sees visual position change but reload loses it

### Fix Required

In `_executeRestore()` method, after calling `tabWindow.restore()`, add callback
re-wiring step:

1. Create fresh callback functions that reference **current** VisibilityHandler
   instance
2. Pass these to a new `tabWindow.rewireCallbacks()` method
3. Log the re-wiring operation for diagnostics
4. Verify callbacks are properly attached before emitting `state:updated`

Pattern: Similar to how callbacks are initially registered in QuickTabWindow
constructor, but done dynamically after restore to capture current execution
context.

**Constraint:** Must maintain same callback signature (parameters and return
values) to work with existing DragController/ResizeController implementations.

---

## Issue #3: DOM Event Listeners Not Cleaned Up on Minimize

### Problem

When Quick Tab is minimized, the DOM container is detached from document but
event listeners registered by DragController and ResizeController remain
attached. This causes memory leaks and prevents proper garbage collection of
detached DOM trees.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `minimize()` method (approximately lines ~900-920)

**Issue:** The minimize flow is:

1. Sets `container.style.display = 'none'`
2. Calls `container.parentNode.removeChild(container)` (DOM detached)
3. Sets `this.container = null` (reference cleared)

But **before** detaching, there are active event listeners:

- DragController has `mousedown`, `mousemove`, `mouseup` listeners
- ResizeController has `mousedown`, `mousemove`, `mouseup` listeners
- Titlebar buttons have `click` listeners

None of these are removed before detachment. The detached DOM tree remains in
memory with all event listeners intact, held by closure references in the event
system.

### Evidence from MDN Documentation

From Mozilla MDN on memory management:

> "Detached DOM elements are elements that are no longer visible in the document
> but still occupy memory because of lingering references. This often happens
> when event listeners or closures maintain references to removed elements."

From JavaScript memory management best practices:

> "Before removing a DOM element, always call removeEventListener() for every
> event that was registered. Otherwise, the browser cannot garbage collect the
> element because event system holds references."

### Why This Causes Memory Leaks

Each minimize/restore cycle creates a **new detached DOM tree** that cannot be
garbage collected:

1. Minimize removes container from document
2. Event listeners still hold references to container
3. Callbacks in event handlers close over container
4. Browser cannot free memory
5. Multiple minimize/restore cycles accumulate memory
6. After 10-20 cycles, significant memory leak visible

### Fix Required

Before detaching DOM in `minimize()` method, explicitly clean up all event
listeners:

**Required cleanup steps:**

1. Call `DragController.cleanup()` to remove drag event listeners
2. Call `ResizeController.cleanup()` to remove resize event listeners
3. Remove all titlebar button click listeners
4. Only then detach container from DOM
5. Log cleanup operation for verification

DragController and ResizeController must implement `cleanup()` methods that call
`removeEventListener()` for all registered events.

Pattern to follow: Symmetric setup/teardown - every `addEventListener` must have
corresponding `removeEventListener`.

**Critical:** Cleanup must happen **before** setting `this.container = null`,
otherwise we lose the reference needed to remove listeners.

---

## Issue #4: Callback Suppression Flag Blocks Legitimate Updates

### Problem

The `_initiatedOperations` Set in VisibilityHandler suppresses callbacks during
restore window to prevent circular updates. But this also blocks legitimate
position/size updates if user interacts with window immediately after restore.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` and callback suppression logic (lines ~470-495)

**Issue:** The suppression pattern is:

```
Pattern (pseudocode):
1. Add operation key to _initiatedOperations Set
2. Call tabWindow.minimize() which triggers onMinimize callback
3. Callback checks if operation key is in Set
4. If yes, returns early (suppressed)
5. setTimeout clears operation key after 50ms
```

Problem scenario:

1. User clicks Restore button in Manager
2. VisibilityHandler adds restore operation to suppression Set
3. Quick Tab window appears (DOM reattached)
4. **User immediately drags window** (within 50ms window)
5. DragController fires `onPositionChangeEnd` callback
6. Callback checks suppression Set → finds restore operation
7. **Returns early without persisting position change**
8. 50ms later, suppression clears
9. But position update was already lost

### Why This Design Exists

The suppression was added to prevent circular callback storms:

- Handler calls `tabWindow.minimize()`
- minimize() triggers `onMinimize` callback
- Callback calls back into Handler
- Handler tries to minimize again (circular)

But current implementation is too aggressive - it suppresses **all callbacks
during the time window**, not just the specific circular callback.

### Fix Required

Replace broad callback suppression with **operation-specific guards**:

1. Remove `_initiatedOperations` Set entirely
2. Add `isMinimizing` and `isRestoring` boolean flags on tabWindow instance
3. In `minimize()` method, set `this.isMinimizing = true` before DOM operations
4. Callback checks `if (tabWindow.isMinimizing) return;` for minimize-specific
   callbacks only
5. Set `this.isMinimizing = false` after DOM operations complete
6. **Do NOT suppress** position/size callbacks - these should always persist

Pattern: Fine-grained operation flags instead of broad time-based suppression.

**Critical:** Position and size callbacks should **never** be suppressed. Only
suppress callbacks that would cause the same operation to repeat (minimize
suppresses minimize, restore suppresses restore).

---

## Issue #5: Zero Logging in Critical Callback Paths

### Problem

When callbacks fail (stale closures, undefined references, suppressed
execution), there is no logging to diagnose the failure. This makes it
impossible to identify where the callback chain breaks.

### Root Cause

**Files:**

- `src/features/quick-tabs/window.js` (minimize/restore methods)
- `src/features/quick-tabs/window/DragController.js` (\_handleDragEnd method)
- `src/features/quick-tabs/window/ResizeController.js` (\_handleResizeEnd
  method)

**Missing Logging:**

**In window.js minimize():**

- No log when method is called
- No log when detaching DOM
- No log confirming DOM detachment
- No log of event listener cleanup (currently not happening)

**In window.js restore():**

- No log when method is called
- No log when reattaching DOM
- No log confirming DOM is connected to document
- No log of callback re-wiring (currently not happening)

**In DragController \_handleDragEnd():**

- No log when drag operation completes
- No log before calling `onPositionChangeEnd` callback
- No log after callback completes
- No log if callback throws error

**In ResizeController \_handleResizeEnd():**

- No log when resize operation completes
- No log before calling `onSizeChangeEnd` callback
- No log after callback completes
- No log if callback throws error

### Why This Prevents Diagnosis

When position/size updates fail after restore:

1. User reports "drag doesn't persist after restart"
2. Developer checks logs
3. **No logs show callback was even called**
4. No logs show callback failed
5. No logs show what state callback saw
6. Impossible to determine if:
   - Callback wasn't called at all
   - Callback was called but suppressed
   - Callback executed with stale references
   - Callback threw error that was swallowed

### Fix Required

Add comprehensive logging at every step of callback execution path:

**In window.js minimize():**

- Log entry: "minimize() called on window: {id}"
- Log before detach: "Detaching container from DOM"
- Log after detach: "Container detached, parentNode: {parentNode}"
- Log cleanup: "Cleaned up event listeners"

**In window.js restore():**

- Log entry: "restore() called on window: {id}"
- Log before attach: "Reattaching container to DOM"
- Log after attach: "Container attached, isConnected: {isConnected}"
- Log callback wiring: "Re-wired callbacks to current handlers"

**In DragController \_handleDragEnd():**

- Log entry: "Drag ended for window: {id}"
- Log before callback: "Calling onPositionChangeEnd({left}, {top})"
- Wrap callback in try/catch with error logging
- Log after callback: "onPositionChangeEnd completed successfully"

**In ResizeController \_handleResizeEnd():**

- Log entry: "Resize ended for window: {id}"
- Log before callback: "Calling onSizeChangeEnd({width}, {height})"
- Wrap callback in try/catch with error logging
- Log after callback: "onSizeChangeEnd completed successfully"

Pattern: Log before operation, log after operation, log errors. This creates
audit trail of callback execution.

**Constraint:** Use consistent log prefix format: `[ClassName][Method]` for easy
filtering.

---

## Shared Implementation Notes

### Callback Lifecycle Pattern

All fixes must follow this callback lifecycle:

1. **Construction:** Set callbacks with current Manager context
2. **Minimize:** Clean up event listeners before DOM detachment
3. **Restore:** Re-wire callbacks after DOM reattachment
4. **Destruction:** Clean up all callbacks and listeners

### DOM Cleanup Pattern

Before any DOM detachment (minimize, destroy):

1. Call controller cleanup methods (DragController.cleanup(),
   ResizeController.cleanup())
2. Remove all button event listeners
3. Verify no references remain to detached elements
4. Only then detach from document

### Callback Re-Wiring Pattern

After any DOM reattachment (restore, hydration):

1. Create fresh callback functions with current Manager context
2. Replace old callback references on tabWindow instance
3. Verify callbacks reference current objects (not stale)
4. Log re-wiring operation with callback names

### Error Handling Pattern

Every callback invocation must be wrapped:

```
Pattern (description, not code):
- Log before calling callback with parameters
- Try block: Call callback
- Catch block: Log error with full context (callback name, parameters, error message, stack trace)
- Finally block: Log completion status
```

### Closure Freshness Verification

After re-wiring callbacks, verify:

- Callbacks reference current Manager instance (not stale)
- Callbacks reference current quickTabsMap (not old Map)
- Callbacks can successfully access current state
- Log verification results

---

## **<acceptancecriteria>**

### Issue #1: Stale Closure References

- After browser restart, drag/resize operations persist to storage
- Callbacks reference current Manager instance, not stale objects
- Position/size changes survive page reload
- No undefined reference errors in console

### Issue #2: Missing Callback Re-Wiring

- After restore operation, callbacks are re-wired automatically
- Re-wiring logged to console with callback names
- Drag/resize after restore persists correctly
- Storage receives updates from callbacks after restore

### Issue #3: DOM Event Listener Cleanup

- Event listeners removed before DOM detachment
- DragController and ResizeController implement cleanup() methods
- No detached DOM trees in memory profiler after 10 minimize/restore cycles
- Memory usage stable across multiple minimize/restore operations

### Issue #4: Callback Suppression Removed

- Position/size callbacks never suppressed
- User can drag/resize immediately after restore
- Updates persist even during restore transition window
- \_initiatedOperations Set removed or replaced with operation-specific flags

### Issue #5: Comprehensive Logging

- Every callback invocation logged (entry and exit)
- Errors in callbacks logged with full stack trace
- DOM detachment/reattachment logged with verification
- Callback re-wiring logged with success/failure status
- Logs include window ID, operation type, and timestamp

### All Issues

- All existing tests pass
- No new console errors or warnings
- Manual test: Create Quick Tab → Minimize → Restore → Drag → Reload → Position
  persists
- Manual test: Create Quick Tab → Close browser → Reopen → Drag → Position
  persists
- Memory profiler shows no leaks after 20 minimize/restore cycles

## **</acceptancecriteria>**

---

## Supporting Context

<details>
<summary>JavaScript Closure Memory Leak Evidence</summary>

From multiple authoritative sources on JavaScript memory management:

**Mozilla MDN - Memory Management:**

> "The main cause for leaks in garbage collected languages are unwanted
> references. A common source of unwanted references is when event handlers are
> registered on DOM elements but never removed when the element is deleted."

**LogRocket Blog - Memory Leaks in JavaScript:**

> "Closures can unintentionally keep references to outer scope variables. If
> these variables reference DOM elements or large objects, they cannot be
> garbage collected even after the DOM element is removed."

**Developer Way - Closures in React:**

> "Stale closures occur when a closure captures values from an outer scope, and
> those values become outdated. The closure continues to reference the old
> values even though the component has re-rendered with new values."

This applies directly to Quick Tabs:

- Callbacks are closures capturing Manager instance and quickTabsMap
- After restore, new instances created but closures still reference old ones
- Old Manager and Map cannot be garbage collected (held by closures)
- Callbacks execute with stale references causing silent failures

</details>

<details>
<summary>Event Listener Cleanup Best Practices</summary>

From W3Schools and MDN documentation:

**W3Schools - removeEventListener():**

> "The removeEventListener() method removes an event handler that has been
> attached with the addEventListener() method. You must use the same function
> object for both addEventListener and removeEventListener."

**Stefan Judis - Removing Event Listeners:**

> "Removing event listeners is crucial for memory management. If you attach
> event listeners to DOM elements and then remove those elements without
> cleaning up the listeners, you create a memory leak. The element cannot be
> garbage collected because the event system still holds references."

Pattern for cleanup:

1. Store reference to bound handler function (not inline arrow function)
2. Use same function reference for both addEventListener and removeEventListener
3. Call removeEventListener before removing element from DOM
4. Verify no lingering references remain

</details>

<details>
<summary>DOM Reattachment and Reference Staleness</summary>

From Stack Overflow and Selenium documentation on stale element references:

**Understanding Stale Element Reference Exception:**

> "A stale element reference occurs when a web element that was once found and
> interacted with is no longer valid in the Document Object Model (DOM). This
> can happen if the element was removed from the DOM and re-added, even if it
> appears identical."

**How to Deal with StaleElementReferenceException:**

> "The element reference becomes stale when: The element has been deleted from
> the DOM, the page has been refreshed, or the element has been replaced with a
> new element that has the same attributes."

For Quick Tabs:

- Minimize removes container from DOM (element reference becomes stale)
- Restore creates new container or reattaches old one
- Callbacks still reference the original container from construction
- Event handlers and closures hold stale element references
- Results in undefined behavior or silent failures

</details>

<details>
<summary>Callback Architecture Context</summary>

Current callback flow (BROKEN after restore):

```
Construction:
QuickTabWindow.constructor()
  ↓
Sets callbacks: onPositionChange = Manager.handlePositionUpdate
  ↓
Callbacks capture: { manager: ManagerInstanceA, map: MapInstanceA }

After Restore:
New Manager: ManagerInstanceB
New Map: MapInstanceB
  ↓
User drags window
  ↓
DragController calls onPositionChangeEnd()
  ↓
Callback executes with stale closure: { manager: ManagerInstanceA (undefined), map: MapInstanceA (undefined) }
  ↓
Storage persist fails silently
```

Required callback flow (FIXED with re-wiring):

```
After Restore:
VisibilityHandler.handleRestore()
  ↓
Calls tabWindow.restore() (DOM reattached)
  ↓
Calls tabWindow.rewireCallbacks(freshCallbacks)
  ↓
Fresh callbacks capture: { manager: ManagerInstanceB (current), map: MapInstanceB (current) }
  ↓
User drags window
  ↓
DragController calls onPositionChangeEnd()
  ↓
Callback executes with fresh closure: { manager: ManagerInstanceB (valid), map: MapInstanceB (valid) }
  ↓
Storage persist succeeds
```

</details>

---

**Priority:** Critical  
**Target:** Single coordinated PR addressing all five issues  
**Estimated Complexity:** High (requires architectural changes to callback
lifecycle)

---

**Note for GitHub Copilot Agent:** These issues are deeply interconnected
through JavaScript closure semantics and DOM lifecycle management. The fixes
require careful coordination:

1. Add cleanup methods before implementing re-wiring (Issue #3 before #2)
2. Add logging throughout to verify fixes work (Issue #5 supports all others)
3. Remove callback suppression only after re-wiring is verified working (Issue
   #4 after #2)
4. Test each fix incrementally with logging to confirm behavior changes

The root cause is architectural: callbacks set once at construction with no
mechanism for refresh after state changes. Solution requires implementing
callback lifecycle management with cleanup, re-wiring, and verification at each
state transition.
