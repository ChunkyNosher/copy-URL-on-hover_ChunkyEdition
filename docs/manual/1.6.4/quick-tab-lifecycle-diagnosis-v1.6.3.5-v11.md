# Quick Tab Restore Lifecycle Failures - Comprehensive Diagnostic Report

**Extension Version:** v1.6.3.5-v11  
**Date:** 2025-12-04  
**Scope:** Critical lifecycle desynchronization causing container reference loss after minimize/restore cycles

---

## Executive Summary

Quick Tab windows suffer from **critical lifecycle desynchronization** after the first minimize/restore cycle. The root cause is a **broken contract between QuickTabWindow.minimize() and QuickTabWindow.restore()** where:

1. `minimize()` explicitly nullifies `this.container` after DOM removal (line 834 in window.js)
2. `restore()` deliberately avoids DOM manipulation (v1.6.3.2 architectural decision)
3. UICoordinator's `update()` method fails to detect "restored but not rendered" state
4. Instance remains in `renderedTabs` Map with `container=null` but DOM exists in document

This creates a **split-brain state** where the QuickTabWindow instance has lost its container reference while the DOM element remains visible and functional. This manifests as three user-facing bugs affecting second minimize operations, z-index updates, and diagnostic capabilities.

The issue was introduced in v1.6.3 when UICoordinator became the single rendering authority and restore() was changed to defer rendering instead of calling render() directly.

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| 1 | Second minimize fails to remove DOM | QuickTabWindow | **CRITICAL** | minimize() guard clause skips DOM removal when container=null |
| 2 | Z-index broken after first restore | VisibilityHandler | **HIGH** | Guard clause blocks updateZIndex when container=null |
| 3 | Missing lifecycle transition logging | Multiple | **MEDIUM** | No logs show when container becomes null or controllers destroyed |

**Why bundled:** All three issues stem from the same architectural gap (container reference loss during restore cycle). The fundamental fix requires coordinating QuickTabWindow lifecycle with UICoordinator's rendering responsibilities.

<scope>
**Modify:**
- `src/features/quick-tabs/window.js` - minimize(), restore(), render() lifecycle methods
- `src/features/quick-tabs/coordinators/UICoordinator.js` - update() method restore detection logic
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - handleFocus() guard clause logic

**Do NOT Modify:**
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Position/size persistence works correctly
- `src/features/quick-tabs/handlers/DestroyHandler.js` - Close operations work correctly  
- `src/features/quick-tabs/MinimizedManager.js` - Snapshot management works correctly
- Controller classes (DragController, ResizeController) - Event handling works correctly
</scope>

---

## Issue #1: Second Minimize Doesn't Remove DOM Element

### Problem

After a Quick Tab has been minimized and restored once, clicking the minimize button a **second time** exhibits broken behavior:

- ✅ Manager indicator changes from green to yellow (entity state updates correctly)
- ❌ **Quick Tab window REMAINS VISIBLE on screen** (DOM element not removed from document)
- ❌ Window becomes non-interactive (controllers destroyed but DOM persists as "ghost element")
- ❌ Third minimize/restore cycle fails (cannot restore tab that appears visible but is marked minimized)

**User Impact:** Users see Quick Tab windows stuck on screen after attempting to minimize them, creating visual clutter and confusion about actual state.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Method:** `minimize()` (lines 773-845)  
**Issue:** The method contains DOM removal logic protected by a guard clause that checks `this.container` existence:

```javascript
// Lines 828-843 (approximate)
// Remove DOM element - but ONLY if container reference exists
if (this.container && this.container.parentNode) {
  removeQuickTabElement(this.container);
}

// Nullify references regardless
this.container = null;
this.iframe = null;
// ... other nullifications
this.rendered = false;
```

**The Bug Sequence:**

1. **First minimize:** `this.container` exists → DOM removed successfully → `this.container = null`
2. **First restore:** `restore()` sets `minimized=false` but **never recreates container reference**
3. **UICoordinator:** May or may not render (depends on complex state detection logic)
4. **Second minimize:** `this.container` is already null → Guard clause blocks DOM removal → DOM stays visible

**Why Container Stays Null:**

The `restore()` method (lines 848-896) has explicit comments stating:

```javascript
// v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call render() here!
// UICoordinator is the single rendering authority.
// This method ONLY updates instance state; UICoordinator.update() handles DOM creation.
```

This architectural decision breaks the implicit contract that `minimize()` depends on: that a restored instance will have its container reference re-established before the next minimize.

**Evidence from Logs:**

```
16:33:03 - Second Minimize Attempt:
  QuickTabWindow: "Minimize button clicked"
  hasDragController: false
  hasResizeController: false  
  hasContainer: false
  Result: Guard clause skips DOM removal, entity.minimized set to true
```

### Fix Required

The `minimize()` method needs **defensive DOM cleanup** that works even when `this.container` reference is lost. Before the guard clause rejects removal, the method should:

1. Check if container reference exists (current behavior)
2. If not, **query the document** for the DOM element using the Quick Tab's data attribute
3. If found, remove it using the same `removeQuickTabElement()` utility
4. Log the fallback path for diagnostics

**Pattern to Follow:**

UICoordinator's `_findDOMElementById()` method (lines 427-442) demonstrates the correct pattern:

```javascript
// Safe DOM querying with CSS.escape() for security
const selector = `[data-quicktab-id="${CSS.escape(id)}"]`;
const element = document.querySelector(selector);
```

This ensures DOM cleanup happens even when instance state is desynchronized from actual DOM state.

**Alternative Strategy:**

Fix the root cause by ensuring `restore()` → `render()` path always re-establishes the container reference. This would make the current guard clause work as originally intended. However, this requires coordinating with UICoordinator's rendering authority and may have architectural implications.

---

## Issue #2: Z-Index Stops Updating After First Restore

### Problem

After a Quick Tab has been minimized and restored once, dragging it to bring it to the front exhibits broken visual behavior:

- ✅ Z-index value increments in entity state (`oldZIndex: 1000022, newZIndex: 1000026`)
- ✅ Storage persistence works (new z-index value saved successfully)
- ❌ **Z-index CSS property NOT APPLIED to DOM element** (window.style.zIndex never updated)
- ❌ **Visual stacking order never changes** (window stays behind other windows)

**User Impact:** Users cannot bring restored Quick Tab windows to the front by clicking or dragging them. Windows remain stuck in their original z-order, making it difficult to access windows that were restored after others.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Method:** `handleFocus()` (lines 779-848)  
**Issue:** Guard clause at lines 806-814 blocks `updateZIndex()` call when container reference is missing:

```javascript
// Lines 806-814 (approximate)
const hasContainer = !!tabWindow.container;
const isAttachedToDOM = !!(tabWindow.container?.parentNode);

console.log('Container validation:', { hasContainer, isAttachedToDOM });

if (hasContainer && isAttachedToDOM) {
  tabWindow.updateZIndex(newZIndex);
  console.log('Called tabWindow.updateZIndex()');
} else {
  console.warn('Skipped updateZIndex - container not ready', { 
    hasContainer, isAttachedToDOM, zIndexStoredOnEntity: newZIndex 
  });
}
```

**The Bug Sequence:**

1. **After first restore:** `tabWindow.container` is null (same root cause as Issue #1)
2. **User drags window:** Drag works (controllers still function), triggers `handleFocus()`
3. **handleFocus() executes:** Increments z-index counter, stores new value on entity
4. **Guard clause blocks:** `hasContainer=false` → `updateZIndex()` never called
5. **Result:** Entity has new z-index value, DOM element has old z-index value

**Why This Happens:**

After the first restore, `tabWindow.container` is null but the DOM element **does exist** in the document and is fully functional (accepting drag events, visible on screen). The guard clause incorrectly interprets this as "container not ready" when it actually means "instance reference desynchronized."

**Evidence from Logs:**

```
16:32:46 - First Drag After Restore:
  Container validation: hasContainer false, isAttachedToDOM false, isRendered false
  Z-index increment: oldZIndex 1000009, newZIndex 1000010
  WARN: Skipped updateZIndex - container not ready
  Note: zIndexStoredOnEntity=1000010, but DOM never updated

16:32:49 - Different Tab (Normal Lifecycle):
  Container validation: hasContainer true, isAttachedToDOM true, isRendered true  
  Called tabWindow.updateZIndex, domZIndex 1000011, verified true
  Note: This tab works because container reference exists
```

The contrast between the two tabs proves the issue is instance-specific, not systemic.

### Fix Required

The `handleFocus()` guard clause needs **defensive DOM access** when `tabWindow.container` is null but the tab is supposed to be visible. The method should:

1. Check if container reference exists (current behavior)
2. If not, check if `tabWindow.minimized === false` (tab should be visible)
3. If yes, this indicates desynchronization → **query the document** for the DOM element
4. If found, apply z-index directly to the queried element
5. Log the fallback path and consider flagging for container reference repair

**Strategy:**

Before the guard clause rejects the update, add:

```javascript
// Pseudocode - DO NOT implement verbatim
if (!hasContainer && !tabWindow.minimized) {
  // Tab should be visible but container reference is lost
  const element = document.querySelector(`[data-quicktab-id="${CSS.escape(tabWindow.id)}"]`);
  if (element) {
    element.style.zIndex = newZIndex;
    console.warn('Applied z-index via fallback DOM query - container reference needs repair');
  }
}
```

Only skip the update if the DOM truly doesn't exist (tab is minimized or DOM was removed).

**Alternative Strategy:**

Fix the root cause in QuickTabWindow lifecycle so container reference is never lost after restore. This would make the guard clause work as originally intended and is the more architecturally sound solution.

---

## Issue #3: Missing Lifecycle Transition Logging

### Problem

The logs show **symptoms of container reference loss** but **never capture the actual transition**. Critical state changes occur silently, making it impossible to diagnose when and why the desynchronization happens:

**Timeline Gap:**
- ✅ 16:32:44: First restore completes, logs show `hasContainer: true, isRendered: true`
- ❓ **16:32:44-16:32:46: [NO LOGS] - Container reference lost during this 2-second window**
- ❌ 16:32:46: First drag, logs show `hasContainer: false, isRendered: false`

**Controller Lifecycle Gap:**
- ✅ After first minimize: Controllers exist (drag events work)
- ❓ **[NO LOGS] - When/why were controllers destroyed?**
- ❌ Second minimize: `hasDragController: false, hasResizeController: false`

**Restore Completion Gap:**
- ✅ `restore()` logs entry: "Restore operation starting"
- ❓ **[NO LOGS] - What is instance state after restore completes?**
- ❌ No exit log showing container, controller, or DOM state

**User Impact:** Developers (and automated diagnostic tools) cannot trace the lifecycle desynchronization bug. The root cause location remains ambiguous, requiring time-consuming manual debugging.

### Root Cause

**Files:** Multiple - `window.js`, `UICoordinator.js`, `VisibilityHandler.js`  
**Issue:** The codebase logs **BEFORE operations** (entry points) and **DURING operations** (intermediate steps) but **NOT AFTER critical state transitions** (exit points with state snapshots).

**Missing Logging Points:**

**1. Container Reference Changes (window.js):**
- **Line 834:** `this.container = null` in `minimize()` - happens silently
- **Line ~890:** `restore()` completes without logging whether container was re-established
- **Line ~475:** `render()` sets `this.container` but doesn't log "container reference established"

**2. Controller Destruction (window.js):**
- **Lines 789-802:** `minimize()` destroys `dragController` and `resizeController` but doesn't log the destruction
- No log entry shows when controllers become null or what triggered their destruction

**3. Restore Completion State (window.js):**
- **Line 896:** `restore()` method exits without logging the complete instance state
- No snapshot of: `container` (null/exists?), `minimized` (false/true?), `rendered` (false/true?), `dragController` (null/exists?), `resizeController` (null/exists?)

**4. UICoordinator Recovery Path (UICoordinator.js):**
- **Lines 591-650:** Orphaned window recovery executes without logging before/after state comparison
- No log entry shows whether recovery created new instance or reused existing instance
- No log entry shows whether `renderedTabs.set()` was called after recovery

**Why This Matters:**

Without state transition logs, it's impossible to answer:
- Does `restore()` leave container as null intentionally (deferred to UICoordinator)?
- Does UICoordinator ever set the container reference after restore detection?
- Are controllers destroyed during minimize and never recreated during restore?
- Is there a race condition between restore completion and first user interaction?

### Fix Required

Add **structured lifecycle logging at state transition exit points** (not just entry points). Every method that modifies critical instance properties should log the **AFTER state**, not just the BEFORE state.

**Required Logging Points:**

**In `window.js` - QuickTabWindow class:**

1. **After container reference changes:**
   ```javascript
   // After line 834 in minimize()
   // After setting this.container = null
   console.log('[QuickTabWindow] Container reference nullified:', {
     id: this.id,
     operation: 'minimize',
     wasAttached: (previous container state),
     nowAttached: false,
     hasControllers: { drag: !!this.dragController, resize: !!this.resizeController }
   });
   ```

2. **After controller destruction:**
   ```javascript
   // After lines 789-802 in minimize()
   // After this.dragController = null
   console.log('[QuickTabWindow] Controllers destroyed:', {
     id: this.id,
     operation: 'minimize',
     destroyedControllers: ['DragController', 'ResizeController']
   });
   ```

3. **At END of restore() method:**
   ```javascript
   // Line 896 - before method return
   console.log('[QuickTabWindow] Restore completed - instance state:', {
     id: this.id,
     minimized: this.minimized,
     hasContainer: !!this.container,
     isRendered: this.isRendered(),
     hasDragController: !!this.dragController,
     hasResizeController: !!this.resizeController,
     expectedBehavior: 'UICoordinator will handle rendering'
   });
   ```

4. **At END of render() method:**
   ```javascript
   // After container is attached to document
   console.log('[QuickTabWindow] Render completed - container established:', {
     id: this.id,
     hasContainer: !!this.container,
     isAttachedToDOM: !!(this.container?.parentNode),
     isRendered: this.isRendered()
   });
   ```

**In `UICoordinator.js`:**

5. **After orphaned window recovery:**
   ```javascript
   // After lines 591-650 recovery completes
   console.log('[UICoordinator] Orphaned window recovery completed:', {
     id: (tab id),
     beforeRecovery: { inMap: (was in renderedTabs), inDOM: true },
     afterRecovery: { 
       inMap: true, 
       hasContainer: !!(recovered instance container),
       instanceSource: (created new vs reused existing)
     }
   });
   ```

6. **After renderedTabs.set() during restore:**
   ```javascript
   // Whenever Map is updated during restore operations
   console.log('[UICoordinator] renderedTabs Map updated during restore:', {
     id: (tab id),
     operation: 'restore',
     instanceHasContainer: !!(instance.container),
     mapSize: this.renderedTabs.size
   });
   ```

**Logging Pattern:**

Follow the existing structured logging style used throughout the codebase:
- Use consistent log prefixes: `[ClassName]`
- Include operation context (minimize, restore, render)
- Include relevant state fields (container, controllers, rendered)
- Use object syntax for multi-field logs (easier to parse)

---

## Shared Implementation Notes

### Root Cause Analysis: The Architectural Gap

The fundamental issue is a **broken lifecycle contract** introduced during the v1.6.3 refactor:

**Intended Design (v1.6.2 and earlier):**
```
render() → container exists
  ↓
minimize() → container = null, DOM removed
  ↓  
restore() → calls render() → container exists (cycle repeats)
```

**Actual Design (v1.6.3+):**
```
render() → container exists
  ↓
minimize() → container = null, DOM removed
  ↓
restore() → sets minimized=false, DEFERS rendering to UICoordinator
  ↓
UICoordinator.update() → [COMPLEX STATE DETECTION LOGIC]
  ↓
??? → Container reference MAY OR MAY NOT be re-established
```

**The Architectural Gap:**

The v1.6.3.2 comments in `restore()` explicitly state that UICoordinator is now the "single rendering authority" and `restore()` should NOT call `render()`. This is a valid architectural decision, BUT:

1. **UICoordinator's `update()` method** doesn't have explicit logic to detect "restored but not rendered" state
2. **The method checks multiple conditions:**
   - Manager minimize cleanup (early return if source='Manager')
   - Restore operations (requires `isRestoreOperation` flag in event)
   - Not in map (renders if not minimized)
   - Detached DOM (most complex recovery path)
3. **None of these paths handle:** Instance already in Map, minimized=false, container=null, DOM doesn't exist

**What Happens After First Restore:**

1. `VisibilityHandler.handleRestore()` calls `tabWindow.restore()`
2. `restore()` sets `minimized=false` but leaves `container=null`
3. `handleRestore()` emits `state:updated` event with `isRestoreOperation=true`
4. UICoordinator receives event, calls `update()`
5. `update()` checks: instance in Map? **YES** → skips "not in map" render path
6. `update()` checks: DOM detached? **MAYBE** → depends on orphaned detection timing
7. If orphaned detection runs: recovers via `__quickTabWindow` property, but this may create **split-brain state**
8. Instance remains in Map with `container=null`, assuming UICoordinator will "eventually" render

**The Split-Brain State:**

Evidence suggests two QuickTabWindow "instances" conceptually exist for the same ID:

- **Instance A:** Stored in `renderedTabs` Map after orphaned recovery, has `container=null`
- **Instance B:** Referenced by DOM element's `__quickTabWindow` property, may have valid container
- **Controllers:** Attached to Instance B (events still work)
- **State queries:** Reading from Instance A (container=null, guard clauses fail)

This explains why drag works (Instance B functional) but z-index doesn't update (Instance A has no container).

### Fix Strategy: Two-Phase Approach

**Phase 1 (Defensive - Recommended for immediate release):**

Modify `minimize()` and `handleFocus()` to defensively query DOM when container reference is lost. This fixes user-facing bugs without requiring architectural changes:

1. **In `minimize()`:** Before guard clause rejects DOM removal, query document for element and remove if found
2. **In `handleFocus()`:** Before guard clause blocks z-index update, query document for element and apply z-index if found
3. **Add comprehensive logging:** All missing lifecycle transition logs identified in Issue #3

**Pros:** Minimal code changes, low risk, preserves existing architecture  
**Cons:** Doesn't fix root cause, defensive queries are performance overhead

**Phase 2 (Comprehensive - Recommended for next major version):**

Fix the architectural gap by ensuring container reference is always re-established during restore:

1. **Add explicit check in UICoordinator.update():**
   ```javascript
   // Pseudocode - after existing restore checks
   if (tabWindow && !tabWindow.minimized && !tabWindow.container && !entityMinimized) {
     // Instance was restored but render() was never called
     console.log('Detected restored-but-not-rendered state, forcing render');
     return this.render(quickTab);
   }
   ```

2. **Or modify QuickTabWindow.restore():**
   - If `!this.container`, set a flag like `this.needsRender = true`
   - UICoordinator checks this flag and calls render() when detected

3. **Add lifecycle invariant checks:**
   - Assert: `container` must exist if `entity.minimized === false && DOM exists`
   - Assert: controllers must exist if `container` exists
   - Log violations and attempt auto-repair

**Pros:** Fixes root cause, eliminates defensive queries, prevents future bugs  
**Cons:** Requires architectural coordination, higher testing burden

### Key Constraints

**Preserve These Behaviors:**

1. **UICoordinator as single rendering authority** - Don't revert to `restore()` calling `render()` directly
2. **`__quickTabWindow` DOM property** - Used for orphaned window recovery, must persist
3. **Callback wiring** - UpdateHandler and DestroyHandler callbacks work correctly, don't break
4. **Storage persistence** - Entity state saves correctly, this is purely an in-memory reference issue
5. **First minimize/restore cycle** - Already works correctly, don't introduce regressions

**Watch Out For:**

1. **Instance reference consistency** - Ensure all callbacks reference the same instance stored in `renderedTabs` Map
2. **Race conditions** - `restore()` completion vs. UICoordinator `update()` execution timing
3. **Orphaned detection false positives** - Recovery path may trigger when it shouldn't
4. **Controller recreation timing** - If controllers are destroyed during minimize, when are they recreated?

<acceptancecriteria>

### Issue #1 - Second Minimize DOM Removal

- Second minimize operation successfully removes DOM element from document
- Quick Tab window is no longer visible on screen after second minimize
- Manager indicator correctly shows yellow (minimized state)
- Third restore → minimize cycle works correctly (cycle is repeatable indefinitely)
- No "ghost elements" left in DOM after minimize operations

### Issue #2 - Z-Index After Restore

- Dragging restored Quick Tab brings it to front visually (stacking order changes)
- Z-index CSS property is applied to DOM element during every drag operation
- Restored tabs can be stacked in correct visual order relative to other tabs
- Z-index updates work on EVERY drag after restore, not just the first drag
- No warnings about "container not ready" in logs when tab is visibly rendered

### Issue #3 - Lifecycle Logging

- Log entry exists showing WHEN `this.container` becomes null (after minimize)
- Log entry exists showing controller destruction during minimize operation
- Log entry exists showing full instance state at END of `restore()` method
- Log entry exists showing container reference status at END of `render()` method
- Logs make it possible to trace exact timeline: render → minimize → restore → [container lost here] → drag
- All lifecycle logs use consistent structured format with operation context

### All Issues - Integration

- All existing tests pass (no regressions in position, size, close, persistence)
- First minimize → restore → drag cycle works (baseline behavior preserved)
- Second minimize → restore → drag cycle works (currently broken, must fix)
- Third minimize → restore → drag cycle works (repeatability verified)
- No console errors or warnings during normal operations
- Manual test sequence: create → minimize → restore → drag (verify z-index) → minimize (verify DOM removed) → restore → drag (verify z-index) → close

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Evidence: Container Reference Loss Timeline</summary>

**Log Sequence Analysis:**

**16:32:44 - First Restore Completes:**
```
UICoordinator render() called
  hasContainer: false (before render)
  rendered: false (before render)
→ Creates NEW window instance
→ render() executes successfully
→ DOM attached to document (confirmed by visual inspection)
```

**16:32:44-16:32:46 - [CRITICAL GAP - NO LOGS]:**
- Container reference is lost during this 2-second window
- No log entry captures the transition
- Instance state changes from `hasContainer: true` to `hasContainer: false`
- User has not interacted with the tab yet (no clicks, no drags)

**16:32:46 - First Drag Operation (2 seconds after restore):**
```
VisibilityHandler Container validation:
  hasContainer: false
  isAttachedToDOM: false
  isRendered: false
WARN: Skipped updateZIndex - container not ready
```

**Analysis:**

The 2-second delay between restore completion and first drag proves this is **NOT** a timing-based race condition. The container reference loss is stable and persistent. Something **actively nullifies** the reference, or restore never establishes it in the first place.

**Possible Explanations:**

1. **UICoordinator calls render() twice** - First render succeeds, second render resets state
2. **Orphaned recovery creates new instance** - Original instance (with container) replaced by new instance (without container)
3. **Callback captures stale reference** - Drag callbacks reference old pre-restore instance, not current instance in Map
4. **render() succeeds but doesn't update instance** - DOM created but `this.container` never assigned

</details>

<details>
<summary>Evidence: Controller Lifecycle Desynchronization</summary>

**Log Sequence Analysis:**

**16:32:44 - After First Restore:**
- Drag events work (user can drag the window)
- This proves `dragController` exists and is functional
- Logs don't explicitly confirm controller existence, but behavior confirms it

**16:33:03 - Second Minimize Attempt:**
```
QuickTabWindow Minimize button clicked
hasDragController: false
hasResizeController: false
hasContainer: false
Result: Nothing to clean up, DOM removal skipped
```

**16:33:06 - Second Restore:**
```
UICoordinator finds: 
  inMap: false
  inDOM: true
WARN: Orphaned window detected
Tries to recover via __quickTabWindow property
Creates/reuses window with hasContainer: true
```

**Analysis:**

Between first restore (controllers work) and second minimize (controllers don't exist), the controllers were **destroyed without logging**. But the destroy logic is only in `minimize()` method, which we know didn't run successfully during first minimize (that was working).

**Possible Explanations:**

1. **Controllers destroyed during orphaned recovery** - Recovery path may destroy existing instance's controllers
2. **Controllers never recreated after first minimize** - minimize destroys them, restore doesn't recreate them
3. **Split-brain state** - One instance has controllers (receives events), another instance in Map doesn't have controllers (queried by minimize)

The orphaned detection finding `inMap: false` after first restore is **CRITICAL** - it means the instance was **REMOVED from the Map** at some point, triggering recovery. This removal is the likely source of the desynchronization.

</details>

<details>
<summary>Evidence: Split-Brain Instance State</summary>

**Conceptual Instance A (in renderedTabs Map after recovery):**
```javascript
// Reported by UICoordinator logs during orphaned recovery
{
  id: 'qt-561-...',
  hasContainer: true,  // or null, depends on recovery timing
  isRendered: true,    // or false
  inMap: true
}
```

**Conceptual Instance B (receiving user events):**
```javascript
// Reported by VisibilityHandler.handleFocus logs during drag
{
  id: 'qt-561-...',
  hasContainer: false,
  isAttachedToDOM: false,
  isRendered: false
}
```

**How This Happens:**

1. First restore creates Instance A, stores it in `renderedTabs` Map
2. DOM element's `__quickTabWindow` property points to Instance A
3. Something removes Instance A from Map (orphaned detection triggered)
4. Orphaned recovery finds DOM element, reads `__quickTabWindow` property
5. Recovery either:
   - Reuses Instance A but doesn't fix its broken state (container=null)
   - Creates new Instance B and stores it in Map
6. User events (drag) trigger callbacks on Instance A (via closure capture)
7. State queries (minimize, focus) read from Instance B (current Map entry)

**Proof:**

- Drag works → Instance receiving events has functional controllers
- Z-index guard clause fails → Instance queried from Map has no container
- Same ID, different state → Two instances or one instance with stale closure references

</details>

<details>
<summary>UICoordinator Update Method Flow Analysis</summary>

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Method:** `update()` (lines 912-993)

**Execution Path After Restore Event:**

```
VisibilityHandler emits state:updated with isRestoreOperation=true
  ↓
UICoordinator.update() receives event
  ↓
Check 1: source === 'Manager'?
  NO → Continue
  ↓
Check 2: isRestoreOperation flag present?
  YES → Log "Restore operation detected"
  BUT: No special handling, just logging, continues to next check
  ↓
Check 3: ID not in renderedTabs Map?
  NO → Instance already in Map (from previous render)
  Skips the "not in map" render logic
  ↓
Check 4: DOM detached?
  Calls _handleDetachedDOM() → _handleOrphanedDOMElement()
  This MAY trigger orphaned recovery IF timing is right
  ↓
Result: Method completes without rendering
Instance stays in Map with container=null
```

**The Gap:**

There's no explicit check for: "Instance in Map, minimized=false, container=null, DOM doesn't exist yet"

This is the exact state after `restore()` completes. The method assumes one of the existing checks will catch it, but:
- Not "not in map" (already in map)
- Not "manager minimize" (this is a restore)
- Maybe "detached DOM" (depends on orphaned detection timing)

If orphaned detection doesn't trigger (race condition), the instance stays broken indefinitely.

</details>

<details>
<summary>QuickTabWindow.minimize() Implementation Analysis</summary>

**File:** `src/features/quick-tabs/window.js`  
**Method:** `minimize()` (lines 773-845)

**Current Implementation Pattern:**

```javascript
minimize() {
  // Step 1: Destroy controllers
  if (this.dragController) {
    this.dragController.destroy();
    this.dragController = null;
  }
  if (this.resizeController) {
    this.resizeController.destroy();
    this.resizeController = null;
  }
  
  // Step 2: Remove DOM element (GUARDED)
  if (this.container && this.container.parentNode) {
    removeQuickTabElement(this.container);
  }
  
  // Step 3: Nullify references (ALWAYS HAPPENS)
  this.container = null;
  this.iframe = null;
  this.titlebarBuilder = null;
  this.soloButton = null;
  this.muteButton = null;
  this.rendered = false;
  
  // Step 4: Update entity state (ALWAYS HAPPENS)
  // (entity state updates handled by caller)
}
```

**The Bug:**

If `this.container` is already null (from previous minimize where restore didn't fix it):
- Step 1: Controllers don't exist, nothing to destroy (silent)
- Step 2: **Guard clause SKIPS DOM removal** (DOM stays visible)
- Step 3: Nullify references (no-op, already null)
- Step 4: Entity state updated (minimized=true)

Result: Entity says "minimized", DOM says "visible", user sees broken behavior.

**The Fix:**

Add fallback DOM query between Step 2 and Step 3:

```javascript
// Pseudocode - DO NOT implement verbatim
if (this.container && this.container.parentNode) {
  removeQuickTabElement(this.container);
} else {
  // Container reference lost - try fallback DOM query
  const element = document.querySelector(`[data-quicktab-id="${CSS.escape(this.id)}"]`);
  if (element) {
    console.warn('[QuickTabWindow] Container reference lost, using fallback DOM removal');
    removeQuickTabElement(element);
  }
}
```

This ensures DOM cleanup happens even when instance state is desynchronized.

</details>

<details>
<summary>QuickTabWindow.restore() Implementation Analysis</summary>

**File:** `src/features/quick-tabs/window.js`  
**Method:** `restore()` (lines 848-896)

**Current Implementation Pattern:**

```javascript
restore() {
  console.log('[QuickTabWindow] Restore operation starting:', this.id);
  
  // v1.6.3.2 - FIX Issue #1 CRITICAL: Do NOT call render() here!
  // UICoordinator is the single rendering authority.
  // This method ONLY updates instance state; UICoordinator.update() handles DOM creation.
  
  // Update entity state
  this.minimized = false;
  
  // NOTE: this.container stays null
  // NOTE: this.rendered stays false
  // NOTE: controllers stay destroyed
  
  // Emit restore event (handled by VisibilityHandler)
  // VisibilityHandler emits state:updated, UICoordinator receives it
  
  // No log of final state here
}
```

**The Contract:**

The comments explicitly state that `restore()` defers rendering to UICoordinator. This is a valid architectural decision, BUT it creates an **implicit contract** that:

1. UICoordinator WILL receive the restore event (via state:updated)
2. UICoordinator WILL detect that rendering is needed
3. UICoordinator WILL call render() to re-establish container reference
4. All this MUST happen before next user interaction (minimize, drag, etc.)

**The Problem:**

The contract is not enforced. There's no validation that UICoordinator actually rendered the tab. If rendering is skipped (due to state detection logic), the instance stays in broken state indefinitely.

**Possible Fixes:**

1. **Add flag:** Set `this.needsRender = true` in restore(), UICoordinator checks it
2. **Add callback:** Pass render completion callback to UICoordinator, invoke it after render
3. **Add validation:** Assert container exists before returning from restore() (fails fast)
4. **Add timeout:** If container still null after 500ms, log error and force render

Each approach has trade-offs between architectural purity and reliability.

</details>

---

**Priority:** CRITICAL (Issues #1-2), MEDIUM (Issue #3)  
**Target:** Single PR to fix all three issues in coordinated fashion  
**Estimated Complexity:** MEDIUM (defensive queries) to HIGH (architectural fix)  
**Dependencies:** None - self-contained to Quick Tab lifecycle components

---

## Notes for GitHub Copilot Agent

**Key Investigation Points:**

1. **Trace container reference lifecycle:**
   - Find EVERY place `this.container` is assigned (render, minimize, restore)
   - Find EVERY place `this.container` is accessed (minimize, updateZIndex, isRendered)
   - Verify consistency: are these reading from the same instance in memory?

2. **Trace UICoordinator restore flow:**
   - Follow `state:updated` event from VisibilityHandler → UICoordinator
   - Trace through `update()` method decision tree
   - Identify which path is taken after restore (logging suggests orphaned detection)
   - Verify whether `render()` is called and if so, whether it updates the correct instance

3. **Verify instance reference consistency:**
   - Check if `renderedTabs.get(id)` returns the same object as callbacks reference
   - Check if orphaned recovery creates new instance or modifies existing instance
   - Check if `__quickTabWindow` property points to current or stale instance

4. **Identify controller recreation point:**
   - Controllers destroyed in `minimize()`, where are they recreated?
   - Does `render()` create new controllers?
   - Does orphaned recovery recreate controllers?
   - Are controllers shared across instances or per-instance?

**Recommended Fix Path:**

**Phase 1 (Low Risk):** Defensive queries in `minimize()` and `handleFocus()`
- Add fallback DOM queries when container=null
- Add comprehensive lifecycle logging
- Test: Second minimize removes DOM, z-index updates after restore

**Phase 2 (If Phase 1 insufficient):** UICoordinator state detection
- Add explicit check for "restored but not rendered" state in `update()`
- Force `render()` when detected
- Test: Container reference never becomes null after restore

**Phase 3 (If both insufficient):** Instance reference audit
- Verify callback closures don't capture stale instances
- Ensure `renderedTabs.get(id)` is single source of truth
- Consider ref-counting or weak references to detect stale captures

**Testing Strategy:**

Do NOT rely solely on automated tests. The bug only manifests on SECOND minimize after FIRST restore. Manual testing sequence:

1. Create Quick Tab
2. Minimize (first time) - should work
3. Restore (first time) - should work
4. Drag to verify z-index updates - **THIS WILL FAIL** without fix
5. Minimize (second time) - **THIS WILL FAIL** without fix
6. Restore (second time) - test if cycle is repeatable
7. Drag again to verify z-index - verify fix didn't regress

Repeat this sequence for 3-4 tabs to verify instance-independence.

**Code Patterns to Follow:**

- **DOM queries:** Use `CSS.escape()` for ID safety (see UICoordinator._findDOMElementById)
- **Logging format:** Structured objects with operation context (see existing logs)
- **Guard clauses:** Check both existence AND expected state before skipping logic
- **State transitions:** Log AFTER state change, not just before

**Code Patterns to Avoid:**

- **Don't call render() from restore()** - breaks architectural contract
- **Don't modify storage format** - persistence works correctly
- **Don't change controller attachment** - event handling works correctly
- **Don't remove orphaned detection** - it's a safety net, even if buggy