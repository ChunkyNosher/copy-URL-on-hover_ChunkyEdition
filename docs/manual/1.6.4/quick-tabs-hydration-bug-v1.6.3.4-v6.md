# Quick Tabs Manager: Catastrophic Hydration Architecture Bug

**Extension Version:** v1.6.3.4-v6 | **Date:** 2025-12-01 | **Scope:** Complete
Quick Tab restore/minimize system failure due to fake placeholder objects

---

## Executive Summary

Quick Tab restore and minimize operations fail 100% of the time when the Manager
panel is open because the hydration system creates **fake placeholder objects**
instead of real QuickTabWindow instances for minimized tabs. When users attempt
to restore or minimize these tabs, all operations fail because the objects lack
the required methods (`restore()`, `minimize()`, `render()`, `isRendered()`).
The logs confirm this with warnings like "Tab not found for minimize" when tabs
clearly exist in the map - they exist as plain JavaScript objects, not as
QuickTabWindow instances. This architectural flaw affects all minimized tabs
across the entire session and causes ghost 400x300 windows, duplicate iframes,
and complete state desynchronization.

## Issues Overview

| Issue                                          | Component                              | Severity | Root Cause                                                 |
| ---------------------------------------------- | -------------------------------------- | -------- | ---------------------------------------------------------- |
| #1: Fake placeholder objects in map            | QuickTabsManager.\_hydrateMinimizedTab | CRITICAL | Creates plain objects instead of QuickTabWindow instances  |
| #2: Restore operations fail with undefined URL | UICoordinator + StateManager           | CRITICAL | QuickTab entities never receive URL from storage hydration |
| #3: Minimize operations fail silently          | VisibilityHandler                      | CRITICAL | tabWindow.minimize() doesn't exist on plain objects        |
| #4: 400x300 ghost windows at (100,100)         | UICoordinator                          | HIGH     | Fallback dimensions used when restore fails                |
| #5: Duplicate iframe processing                | UICoordinator + QuickTabWindow         | HIGH     | Multiple render attempts from failed operations            |
| #6: Operation lock never released              | VisibilityHandler                      | MEDIUM   | Lock held indefinitely after failed operations             |
| #7: Map always shows size 0                    | CreateHandler vs Hydration             | MEDIUM   | Hydrated tabs bypass CreateHandler.create()                |

**Why bundled:** All stem from same architectural flaw (fake placeholder
objects) that breaks the entire Quick Tab lifecycle when Manager is open.

<scope>
**Modify:**
- `src/features/quick-tabs/index.js` (QuickTabsManager._hydrateMinimizedTab, _hydrateVisibleTab)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (update() restore path logic)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleRestore, handleMinimize validation)
- `src/features/quick-tabs/managers/StateManager.js` (persistToStorage format validation)
- Logging additions across all modified files

**Do NOT Modify:**

- `src/features/quick-tabs/window.js` (QuickTabWindow class works correctly)
- `src/features/quick-tabs/minimized-manager.js` (snapshot system works
  correctly)
- `src/domain/QuickTab.js` (entity class works correctly)
- `src/features/quick-tabs/handlers/CreateHandler.js` (creation logic works
  correctly)

**Critical Constraint:** Must maintain backwards compatibility with existing
stored Quick Tabs. Any storage format changes require migration logic. </scope>

---

## Issue #1: Fake Placeholder Objects in quickTabsMap

### Problem

When Quick Tabs are hydrated from storage on page load/reload, minimized tabs
are created as **plain JavaScript objects** instead of real `QuickTabWindow`
instances. These fake objects are stored in `quickTabsManager.tabs` Map with the
same keys as real tabs, but lack all the methods and properties that the rest of
the system expects.

### Root Cause

**File:** `src/features/quick-tabs/index.js`  
**Location:** `_hydrateMinimizedTab()` method (lines ~486-508)  
**Issue:** Method creates a minimal plain object with tab properties but never
instantiates an actual `QuickTabWindow` class. The plain object is then stored
directly in the `tabs` Map.

**Evidence from logs (06:07:17.826Z):**

```
VisibilityHandler: Handling restore for: qt-120-1764569231627-1ydids1hqafp1
VisibilityHandler: WARN - Tab not found for minimize: qt-120-1764569231627-1ydids1hqafp1
```

**Analysis:** "Tab not found" doesn't mean the ID isn't in the map - it means
the object at that ID doesn't have the expected structure/methods. The code
checks for `tabWindow.minimize` or `tabWindow.restore` methods, and when those
don't exist on the plain object, it logs the warning.

**The fake object structure:**

```javascript
{
  id: "qt-...",
  url: "https://...",
  title: "...",
  left: 100,
  top: 100,
  width: 400,
  height: 300,
  minimized: true,
  // MISSING: All QuickTabWindow methods (render, restore, minimize, destroy, isRendered, etc.)
  // MISSING: All QuickTabWindow properties (container, iframe, titlebar, buttons, etc.)
}
```

**Why this breaks everything:**

- `VisibilityHandler.handleMinimize()` calls `tabWindow.minimize()` →
  **TypeError: tabWindow.minimize is not a function**
- `VisibilityHandler.handleRestore()` calls `tabWindow.restore()` → **TypeError:
  tabWindow.restore is not a function**
- `UICoordinator.render()` calls `tabWindow.isRendered()` → **TypeError:
  tabWindow.isRendered is not a function**
- `DestroyHandler` calls `tabWindow.destroy()` → **TypeError: tabWindow.destroy
  is not a function**

### The Cascade Failure Sequence

1. User loads page with 3 minimized Quick Tabs in storage
2. `QuickTabsManager._hydrateStateFromStorage()` reads storage
3. For each minimized tab, calls `_hydrateMinimizedTab()` which creates fake
   plain object
4. Plain objects stored in `quickTabsManager.tabs` Map
5. Manager panel reads storage and displays all 3 tabs with restore buttons
6. **User clicks restore on first tab**
7. Message sent to content script: `RESTORE_QUICK_TAB`
8. `VisibilityHandler.handleRestore()` calls `this.quickTabsMap.get(id)`
9. Gets the fake plain object (not a QuickTabWindow)
10. Tries to call `tabWindow.restore()` → **Method doesn't exist**
11. Logs "Tab not found in minimized manager"
12. `UICoordinator.update()` receives `state:updated` event
13. Tries to call `tabWindow.isRendered()` → **Method doesn't exist**
14. Creates fallback window at (100, 100) with 400x300 size
15. Tries to pass `url: undefined` to `createQuickTabWindow()`
16. **URL validation rejects with error**
17. Iframe processing still happens somehow (bug within bug)
18. User sees 400x300 empty window, no actual tab

### Fix Required

Hydrated minimized tabs must be instantiated as real `QuickTabWindow` objects
with the `minimized: true` flag set, not as plain JavaScript objects. The
hydration path should route through `createQuickTabWindow()` factory function
(same as regular tab creation) to ensure all methods and properties exist. The
`MinimizedManager.add()` should be called AFTER the real window instance is
created, not instead of creating it.

---

## Issue #2: QuickTab Entities Have Undefined URLs After Hydration

### Problem

When UICoordinator attempts to render restored tabs, it creates windows from
QuickTab entities that have `url: undefined`. The `createQuickTabWindow()`
factory rejects these with "Invalid URL" errors, but the system continues trying
to process iframes for the undefined URLs anyway.

### Root Cause

**File:** `src/features/quick-tabs/managers/StateManager.js`  
**Location:** `persistToStorage()` method (lines 44-56) and entity hydration
path  
**Issue:** The StateManager persists QuickTab entities to storage with full
serialization, but when hydrating, the URL property is not being correctly
transferred from storage data to the entity instance.

**Evidence from logs (06:07:17.827Z):**

```
UICoordinator: Creating window from entity: {
  id: "qt-120-1764569231627-1ydids1hqafp1",
  safePosition: { left: 100, top: 100 },
  safeSize: { width: 400, height: 300 },
  ...
}
ERROR: Invalid URL for Quick Tab creation
ERROR: Invalid URL for Quick Tab: undefined
```

**The logs explicitly state `url: undefined`** in the entity passed to
`_createWindow()`.

**Why this happens:**

The hydration flow has two separate state systems:

1. **StateManager** manages `QuickTab` domain entities (should have URLs)
2. **quickTabsManager.tabs** stores `QuickTabWindow` UI instances (should have
   URLs)

When `_hydrateMinimizedTab()` creates the fake plain object, it includes the URL
from storage. **But** the StateManager is ALSO supposed to be creating QuickTab
entities, and those entities are what UICoordinator reads when rendering.

**The race condition:**

- Storage read happens
- Fake plain object created with URL, added to `quickTabsManager.tabs`
- StateManager creates QuickTab entity **separately**
- Entity creation may not receive URL from storage data
- UICoordinator tries to render from entity (not from Map)
- Entity has `url: undefined`
- Render fails

### The Two-State Problem

The architecture maintains **duplicate state**:

- `quickTabsManager.tabs` (Map of window instances) - has URLs in fake objects
- `StateManager.quickTabs` (Map of domain entities) - missing URLs

When UICoordinator renders, it reads from **entities**, not from
`quickTabsManager.tabs`. So even though the fake placeholder object has the URL,
the entity being rendered doesn't.

**Evidence:** The logs show `UICoordinator: Creating window from entity` with
undefined URL, meaning it's reading entity state, not the map state.

### Fix Required

Ensure QuickTab entities are properly instantiated from storage with all
required properties including URL. The `QuickTab.fromStorage()` factory method
should validate that URL is present before creating the entity. Add explicit
logging when entities are created without URLs to catch this at the source.
Consider unifying the state systems so there's only ONE source of truth for tab
data (either entities OR window instances, not both).

---

## Issue #3: Minimize Operations Fail Silently When Called from Manager

### Problem

When user clicks minimize button in Manager panel, the operation appears to
succeed (logs say "Minimized Quick Tab") but the tab never actually minimizes.
The indicator stays green instead of turning yellow, and the tab remains visible
on screen.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` method (lines 216-273)  
**Issue:** Method retrieves tab from `quickTabsMap`, finds the fake placeholder
object (Issue #1), then tries to call `tabWindow.minimize()` which doesn't exist
on plain objects. The method logs a warning and returns early, but the Manager
is never notified that the operation failed.

**Evidence from logs (06:07:25.005Z):**

```
QuickTabsManager: handleMinimize called for: qt-120-1764569231627-1ydids1hqafp1
VisibilityHandler: Minimize button clicked (source: Manager)
VisibilityHandler: WARN - Tab not found for minimize: qt-120-1764569231627-1ydids1hqafp1
Content: Minimized Quick Tab (source: Manager)  <-- FALSE SUCCESS
```

**The code path:**

1. Manager sends `MINIMIZE_QUICK_TAB` message
2. Content script calls `quickTabsManager.handleMinimize(id, 'Manager')`
3. Routes to `VisibilityHandler.handleMinimize(id, 'Manager')`
4. Gets fake plain object from `quickTabsMap`
5. Checks if `tabWindow` exists → YES (the fake object exists)
6. Tries to call `tabWindow.minimize()` → Method doesn't exist
7. Logs warning "Tab not found for minimize"
8. Returns early
9. **BUT** the content script response handler logs "Minimized Quick Tab" anyway
10. Manager receives success response
11. Manager doesn't update indicator because the tab wasn't actually minimized

### The False Success Problem

The content script message handler always returns success:

```javascript
if (message.action === 'MINIMIZE_QUICK_TAB') {
  quickTabsManager.handleMinimize(id, 'Manager');
  sendResponse({ success: true }); // <-- ALWAYS SUCCESS
}
```

Even though `handleMinimize()` returned early due to the fake object, the
message handler still sends `success: true` to the Manager.

### Fix Required

Add validation in `VisibilityHandler.handleMinimize()` to check if the tab
object is a real QuickTabWindow instance (check for presence of required
methods). If validation fails, throw an error that bubbles up to the message
handler. The message handler should catch errors and send `success: false` to
the Manager. Manager should handle failed minimize operations by showing an
error notification and not updating its UI state.

---

## Issue #4: 400x300 Ghost Windows Appear at Position (100, 100)

### Problem

When restore operations fail, UICoordinator falls back to creating windows with
default dimensions (400x300) at default position (100, 100). These ghost windows
are visible on screen but non-functional, and multiple copies can stack up at
the same position.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_createWindow()` method (lines 748-786) and
`_getSafePosition()`/`_getSafeSize()` helpers  
**Issue:** When entity has no position/size data (because hydration failed), the
safe getters return hardcoded defaults. The window is created with these
defaults, appears on screen, but has no URL so it's just an empty frame.

**Evidence from logs (06:07:17.827Z):**

```
UICoordinator: Creating window from entity: {
  id: "qt-120-1764569231627-1ydids1hqafp1",
  safePosition: { left: 100, top: 100 },     <-- DEFAULT
  safeSize: { width: 400, height: 300 },    <-- DEFAULT
  visibility: { minimized: false, ... },
  zIndex: 1000000
}
```

**Why 400x300?**  
Looking at `QuickTab.js` defaults and `UICoordinator._getSafeSize()`:

- Entity position defaults: `{ left: 100, top: 100 }`
- Entity size defaults: `{ width: 400, height: 300 }`
- These are the "safe" values returned when entity has no real dimensions

**Why do they appear?**  
Even though `createQuickTabWindow()` rejects with "Invalid URL" error, some code
path still creates a DOM container and positions it. The iframe processing logs
show processing happens even after the error, suggesting multiple code paths are
trying to render the tab.

### The Multiple Render Attempts

From logs showing duplicate iframe processing at 06:07:18.013Z and 06:07:18.015Z
(2ms apart), it appears:

1. UICoordinator tries to render → fails due to no URL
2. Error logged but render partially completes
3. Another component (maybe event handler) tries to render again
4. Both attempts create DOM elements
5. Only one URL validation error is logged
6. But TWO iframe processing events fire

This suggests the render path isn't fully atomic - parts of it complete even
when validation fails.

### Fix Required

Add strict validation in UICoordinator BEFORE calling `_createWindow()` - check
that entity has valid URL, position, and size before attempting any render
operations. If validation fails, emit error event and return early without
creating ANY DOM elements. Add explicit cleanup in the createQuickTabWindow
factory's validation failure path to ensure no partial DOM is left behind.
Consider adding a "zombie detector" that scans for orphaned DOM elements at
fixed intervals and removes them.

---

## Issue #5: Duplicate Iframe Processing Within Milliseconds

### Problem

The same iframe URL is processed twice in rapid succession (2ms - 850ms apart),
suggesting multiple code paths are trying to render/initialize the same Quick
Tab simultaneously.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js` +
`src/features/quick-tabs/window.js`  
**Location:** Multiple render paths converging on same tab  
**Issue:** When restore operation fails, multiple recovery/retry mechanisms
trigger simultaneously. Each thinks it needs to render the tab, so they all call
render methods, causing duplicate iframe initialization.

**Evidence from logs:**

```
06:07:18.013Z → Processing iframe: Meiji_period
06:07:18.015Z → Processing iframe: Meiji_period (2ms later - DUPLICATE)

06:07:23.380Z → Processing iframe: Meiji_period
06:07:23.381Z → Processing iframe: Meiji_period (1ms later - DUPLICATE)

06:07:26.011Z → Processing iframe: Meiji_period (alone, no duplicate)
```

**The pattern:** Duplicates occur immediately after restore attempts, but later
operations don't duplicate. This suggests the restore path specifically has
multiple overlapping render calls.

### The Competing Render Paths

When restore is called from Manager:

1. **Path A:** VisibilityHandler.handleRestore() → emits state:updated event →
   UICoordinator.update() → render()
2. **Path B:** UICoordinator receives isRestoreOperation flag → calls
   \_handleRestoreOperation() → render()
3. **Path C:** Error recovery in UICoordinator → detects detached DOM → calls
   render() again

All three paths can execute for the same restore operation because they're
listening to different events/flags and don't coordinate with each other.

**Additional evidence:** The logs show at 06:07:17.827Z the restore error is
logged, then 186ms later at 06:07:18.013Z the FIRST iframe processes, then 2ms
later the SECOND processes. This timing suggests:

- Error path completes
- First render attempt happens
- Almost immediately, second render attempt happens
- Both succeed in initializing iframe (even though URL is undefined in entity)

### Fix Required

Implement a render lock/flag in UICoordinator that prevents simultaneous render
operations on the same tab ID. When render() is called, check if a render is
already in progress for that ID - if yes, return immediately. Track render
operations with a Set of in-progress IDs that are added at the start of render()
and removed at the end (or after timeout). Add explicit logging showing which
code path triggered each render call (include stack trace or source identifier).

---

## Issue #6: Operation Locks Never Released After Failed Operations

### Problem

When restore operations fail, the operation lock in VisibilityHandler remains
held indefinitely. Subsequent restore attempts are blocked with "Ignoring
duplicate restore request (pending)" even though the previous operation already
failed and completed.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleRestore()` method, lock management (lines 395-447)  
**Issue:** Lock is acquired at the start via `_tryAcquireLock('restore', id)`
but never released when the operation fails early due to missing tab. The
`_releaseLock()` call only happens in the debounced storage persist path, which
never executes when the tab isn't found.

**Evidence from logs (06:07:23.187Z):**

```
06:07:17.826Z → RESTORE_QUICK_TAB request: qt-120-1764569231627-1ydids1hqafp1
06:07:23.187Z → RESTORE_QUICK_TAB request: qt-120-1764569231627-1ydids1hqafp1 (5.4s later)
06:07:23.187Z → Ignoring duplicate restore request (pending, source: Manager)
06:07:25.847Z → RESTORE_QUICK_TAB request: qt-120-1764569231627-1ydids1hqafp1 (2.6s later)
06:07:25.847Z → Ignoring duplicate restore request (pending, source: Manager)
```

**Analysis:** Three restore requests are made for the same tab over 8 seconds.
The first fails immediately (warning logged), but the lock from the first
attempt is never released. The second and third attempts are blocked by the
stale lock.

### The Lock Lifecycle Bug

**Current behavior:**

```
handleRestore(id) {
  if (!_tryAcquireLock('restore', id)) return;  // ← Lock acquired

  const tabWindow = this.quickTabsMap.get(id);
  if (!tabWindow) {
    console.warn("Tab not found");
    return;  // ← EARLY RETURN WITHOUT RELEASING LOCK
  }

  // ... rest of method ...

  _debouncedPersist(id, 'restore');  // ← Only releases lock after 200ms delay
}
```

**Expected behavior:**  
Lock should be released in ALL code paths, including early returns on error.

### User Impact

After the first restore attempt fails, the user cannot try again by clicking the
restore button repeatedly. The Manager thinks the operation is "in progress"
when it actually failed seconds ago. The user has to wait for the lock timeout
(200ms according to OPERATION_LOCK_MS constant) to expire naturally, but the
logs show locks lasting much longer (5+ seconds), suggesting the timeout isn't
working properly.

### Fix Required

Add explicit `_releaseLock()` calls in ALL early return paths (before any return
statement that exits handleRestore early). Consider using try/finally pattern
where lock is acquired in try block and released in finally block to guarantee
cleanup. Reduce OPERATION_LOCK_MS to a shorter duration (50ms instead of 200ms)
since operations complete quickly. Add explicit logging when locks are acquired
AND released with timestamps to diagnose lock leaks.

---

## Issue #7: quickTabsMap Always Shows Size 0 in Logs

### Problem

Throughout the entire session, the `mapSizeBefore` log in UICoordinator shows
`0` for every operation, even though tabs clearly exist (iframes are processing,
Manager shows tabs, operations are being called). This indicates the
`renderedTabs` Map in UICoordinator is not being populated correctly.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js` +
`src/features/quick-tabs/index.js`  
**Location:** Hydration path bypasses normal tab creation flow  
**Issue:** The `renderedTabs` Map is only populated when UICoordinator.render()
successfully completes. But hydrated tabs bypass this flow entirely - they're
added directly to `quickTabsManager.tabs` by the hydration logic, and
UICoordinator never gets notified to add them to its own tracking map.

**Evidence from logs:**

```
06:07:17.827Z → UICoordinator: update() entry: { mapSizeBefore: 0 }
06:07:33.413Z → UICoordinator: update() entry: { mapSizeBefore: 0 }
06:07:52.809Z → UICoordinator: update() entry: { mapSizeBefore: 0 }
```

Every single operation across the entire 45-second session shows
`mapSizeBefore: 0`.

### The Dual Map Problem

There are **THREE** separate Maps tracking tabs:

1. `quickTabsManager.tabs` - Main map in QuickTabsManager facade (contains fake
   objects from hydration)
2. `UICoordinator.renderedTabs` - Tracks actually rendered windows
3. `StateManager.quickTabs` - Tracks QuickTab domain entities

When hydration happens:

- `quickTabsManager.tabs` gets populated with fake objects
- `StateManager.quickTabs` may or may not get entities (Issue #2)
- `UICoordinator.renderedTabs` stays empty because render() never succeeds

Operations check different maps:

- VisibilityHandler checks `quickTabsManager.tabs` (finds fake objects)
- UICoordinator checks `UICoordinator.renderedTabs` (always empty)
- Manager panel reads from storage directly (sees real data)

**This is why operations fail with contradictory logs:**

- VisibilityHandler: "Tab found" (in quickTabsManager.tabs)
- UICoordinator: "mapSizeBefore: 0" (renderedTabs is empty)
- Manager: Shows all tabs correctly (reading storage)

### The Synchronization Gap

When `_hydrateMinimizedTab()` creates the fake object and does
`this.tabs.set(id, minimalTab)`, it should ALSO emit an event that causes
UICoordinator to populate its own renderedTabs map. But no such event is emitted
for hydrated tabs.

**Expected flow:**

- Hydrate tab
- Add to quickTabsManager.tabs
- Emit event: `state:added` or `state:hydrated`
- UICoordinator listens to event
- UICoordinator adds entry to renderedTabs

**Actual flow:**

- Hydrate tab
- Add to quickTabsManager.tabs
- No event emitted
- UICoordinator never notified
- renderedTabs stays empty

### Fix Required

When hydration completes, emit explicit events for each hydrated tab so
UICoordinator knows to track them in renderedTabs. The event should include
enough data for UICoordinator to populate its map even if the tab hasn't been
rendered yet. Alternatively, consolidate to a SINGLE authoritative Map
(eliminate the dual/triple map architecture) where all components read from the
same source. Add validation logging that compares map sizes across all three
Maps and warns if they're out of sync.

---

## Missing Logging Coverage

The following critical operations have insufficient or missing logging, making
it impossible to diagnose the exact sequence of events and which code paths
execute:

### CRITICAL - Never Logged

1. **QuickTabWindow instance validation** - When operations retrieve tab from
   map, log whether it's a real QuickTabWindow instance or a plain object
   - Check: `tabWindow instanceof QuickTabWindow` or
     `typeof tabWindow.render === 'function'`
   - Location: Every map retrieval in VisibilityHandler, UICoordinator,
     DestroyHandler

2. **Hydration object creation** - What type of object is being created during
   hydration (plain object vs QuickTabWindow)
   - Log the constructor name: `obj.constructor.name`
   - Log presence of key methods:
     `hasRender: !!obj.render, hasMinimize: !!obj.minimize`
   - Location: `_hydrateMinimizedTab()` and `_hydrateVisibleTab()`

3. **QuickTab entity URL property** - Where does the entity get its URL (or fail
   to get it)
   - Log entity properties immediately after creation:
     `{ id, url, hasUrl: !!url }`
   - Location: `QuickTab.fromStorage()`, `StateManager.add()`,
     `QuickTabsManager._hydrateTab()`

4. **Storage persistence format** - What exactly is being written to storage (to
   verify URL is included)
   - Log the serialized state before writing:
     `JSON.stringify(state).substring(0, 500)`
   - Location: `StateManager.persistToStorage()`, storage-utils.js persistence
     methods

5. **Map.set() operations** - When objects are added to any Map, log what type
   of object
   - Log:
     `map.set(id, obj) → { id, type: obj.constructor.name, size: map.size }`
   - Location: All `.set()` calls on quickTabsMap, renderedTabs, quickTabs

### HIGH Priority Missing

6. **Message handler responses** - What success/failure is being sent back to
   Manager
   - Log before sendResponse: `{ action, id, success, error }`
   - Location: All content script message handlers (RESTORE_QUICK_TAB,
     MINIMIZE_QUICK_TAB, etc.)

7. **Lock acquisition/release timestamps** - To diagnose lock leaks
   - Log: `Lock acquired [restore-${id}] at ${timestamp}`
   - Log: `Lock released [restore-${id}] after ${duration}ms`
   - Location: `_tryAcquireLock()` and `_releaseLock()`

8. **Multiple render path identification** - Which code path triggered each
   render
   - Add source parameter to render(): `render(quickTab, source = 'unknown')`
   - Log: `Render called from: ${source}`
   - Location: All calls to UICoordinator.render()

9. **Entity-to-window mapping** - When entities are used to create windows,
   verify data flow
   - Log entity before createWindow:
     `{ entityUrl: entity.url, entityPos: entity.position }`
   - Log window after creation:
     `{ windowUrl: window.url, windowPos: { left: window.left, top: window.top } }`
   - Location: `UICoordinator._createWindow()`

10. **Operation completion markers** - When operations fully complete (not just
    start)
    - Log: `RESTORE COMPLETE: ${id} - success: ${success}`
    - Log: `MINIMIZE COMPLETE: ${id} - success: ${success}`
    - Location: End of handleRestore(), handleMinimize(), all handler methods

### MEDIUM Priority Missing

11. **Event emission payloads** - What data is included in state:updated,
    state:added events
    - Log before emit: `Emitting ${eventName}: ${JSON.stringify(payload)}`
    - Location: All eventBus.emit() calls

12. **Storage read operations** - What data is retrieved from storage during
    hydration
    - Log:
      `Read from storage: { tabCount: result.tabs.length, firstTabUrl: result.tabs[0]?.url }`
    - Location: `_hydrateStateFromStorage()`, StateManager storage reads

13. **Snapshot availability** - Whether MinimizedManager has snapshots when
    needed
    - Log: `Snapshot check: { id, hasSnapshot, hasInPending, hasInActive }`
    - Location: `UICoordinator._applySnapshotForRestore()`, MinimizedManager
      queries

14. **DOM attachment state** - Whether containers are actually in document
    - Log:
      `DOM check: { id, hasContainer: !!container, inDocument: document.contains(container) }`
    - Location: `QuickTabWindow.isRendered()` and before all DOM manipulations

---

## Shared Implementation Guidance

### Instance Validation Pattern

Before operating on any object retrieved from a Map, validate it's a real
QuickTabWindow:

```
const tabWindow = this.quickTabsMap.get(id);
if (!tabWindow) return; // Not in map

// NEW: Validate instance type
if (typeof tabWindow.render !== 'function' ||
    typeof tabWindow.minimize !== 'function') {
  console.error('[Component] Invalid tab instance (not a QuickTabWindow):', {
    id,
    type: tabWindow.constructor?.name,
    hasRender: !!tabWindow.render,
    hasMinimize: !!tabWindow.minimize
  });
  // Remove fake object from map
  this.quickTabsMap.delete(id);
  return;
}
```

This should be added at the start of: handleRestore(), handleMinimize(),
destroy(), update()

### Hydration Must Use Real Instances

The hydration path must create real QuickTabWindow instances, not plain objects:

**For minimized tabs:**

- Create QuickTabWindow with `minimized: true` flag
- Call MinimizedManager.add() AFTER instance is created
- Do NOT render the window (keep DOM detached)
- Store the real instance in quickTabsManager.tabs

**For visible tabs:**

- Create QuickTabWindow with `minimized: false`
- Call render() to attach DOM
- Store in quickTabsManager.tabs
- Emit state:added event for UICoordinator

### Error Response Pattern

Message handlers must report actual operation results:

```
try {
  const result = quickTabsManager.handleMinimize(id, 'Manager');
  if (!result || result.error) {
    sendResponse({ success: false, error: result?.error || 'Operation failed' });
  } else {
    sendResponse({ success: true });
  }
} catch (err) {
  console.error('[Content] Minimize failed:', err);
  sendResponse({ success: false, error: err.message });
}
```

Handlers should return error objects instead of undefined when operations fail.

### Lock Management Pattern

Use try/finally for guaranteed lock cleanup:

```
handleRestore(id) {
  if (!this._tryAcquireLock('restore', id)) return;

  try {
    // All operation logic here
    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) {
      throw new Error('Tab not found');
    }
    // ... rest of restore logic ...
  } finally {
    // Always release lock, even on error/early return
    this._releaseLock('restore', id);
  }
}
```

### Unified State Architecture

Consider refactoring to eliminate duplicate Maps:

**Option A: Single source of truth in StateManager**

- Only StateManager.quickTabs Map exists
- All components read from StateManager
- UICoordinator tracks rendering separately (which IDs have DOM attached)

**Option B: Single source in quickTabsManager.tabs**

- Only quickTabsManager.tabs Map exists
- StateManager becomes a thin wrapper/query interface
- UICoordinator.renderedTabs tracks same objects (reference equality)

**Option C: Explicit synchronization**

- Keep all three Maps
- Add sync method that validates all Maps contain same IDs
- Call sync after every hydration/add/remove operation
- Log warnings when Maps diverge

<acceptance_criteria> **Issue #1 (Fake Placeholder Objects):**

- [ ] \_hydrateMinimizedTab() creates real QuickTabWindow instances, not plain
      objects
- [ ] All hydrated tabs can successfully call .render(), .minimize(),
      .restore(), .destroy()
- [ ] No "Tab not found for minimize/restore" warnings when tabs exist in map
- [ ] Instance validation detects and removes any fake objects that slip through

**Issue #2 (Undefined URLs in Entities):**

- [ ] QuickTab entities always have valid url property after hydration
- [ ] QuickTab.fromStorage() validates URL presence and throws if missing
- [ ] No "Invalid URL: undefined" errors during restore operations
- [ ] Entity creation logs show URL for every created entity

**Issue #3 (Minimize Failures):**

- [ ] handleMinimize() returns error object when operation fails
- [ ] Message handlers send success:false to Manager on failures
- [ ] Manager shows error notification when minimize fails
- [ ] Manager indicator only changes when minimize actually succeeds

**Issue #4 (400x300 Ghost Windows):**

- [ ] UICoordinator validates entity has URL before calling \_createWindow()
- [ ] No windows created with default 100,100 position and 400x300 size
- [ ] Failed render operations do not leave partial DOM elements
- [ ] Zombie detector removes any orphaned DOM elements

**Issue #5 (Duplicate Iframe Processing):**

- [ ] Render lock prevents simultaneous renders of same tab ID
- [ ] Each tab processed maximum once per restore operation
- [ ] Render logs show single iframe processing per operation
- [ ] Lock is acquired before render, released after completion

**Issue #6 (Lock Leaks):**

- [ ] Locks released in ALL code paths including early returns
- [ ] Lock logging shows acquisition and release for every operation
- [ ] Subsequent restore attempts not blocked by stale locks
- [ ] Lock timeout actually works (locks auto-expire after configured duration)

**Issue #7 (Empty renderedTabs Map):**

- [ ] UICoordinator.renderedTabs populated during hydration
- [ ] mapSizeBefore logs show non-zero values when tabs exist
- [ ] Map sync validation passes after all operations
- [ ] Single source of truth for tab tracking (pick Option A, B, or C)

**All Issues:**

- [ ] All missing logging items added with appropriate log levels
- [ ] Manual test: minimize 3 tabs → reload page → restore each → all work
      correctly, no ghost windows
- [ ] Manual test: Manager open during all operations → indicators update
      correctly, no false successes
- [ ] No regression in tab creation, position/size updates, close operations
- [ ] Storage format maintains backwards compatibility with existing saved tabs
      </acceptance_criteria>

## Supporting Context

<details>
<summary>Complete Log Timeline Showing Failure Pattern</summary>

**Restoration attempt #1 (06:07:17.826Z):**

```
17.826Z - RESTORE_QUICK_TAB request: qt-120-1764569231627-1ydids1hqafp1
17.826Z - VisibilityHandler: Handling restore (source: Manager)
17.826Z - MinimizedManager: No snapshot found
17.826Z - WARN: Tab not found in minimized manager
17.826Z - VisibilityHandler: No tabWindow for restore event, UICoordinator will handle
17.827Z - UICoordinator: update() entry { mapSizeBefore: 0 }
17.827Z - UICoordinator: Creating window from entity { width: 400, height: 300 }
17.827Z - ERROR: REJECTED - Invalid URL (undefined)
17.827Z - ERROR: Invalid URL for Quick Tab: undefined
18.013Z - Processing iframe: Meiji_period
18.015Z - Processing iframe: Meiji_period (DUPLICATE - 2ms later)
```

**Restoration attempt #2 (06:07:23.187Z):**

```
23.187Z - RESTORE_QUICK_TAB request: qt-120-1764569231627-1ydids1hqafp1
23.187Z - Ignoring duplicate restore request (pending, source: Manager)  <-- LOCK LEAK
23.187Z - Restored Quick Tab (source: Manager)  <-- FALSE SUCCESS
23.380Z - Processing iframe: Meiji_period
23.381Z - Processing iframe: Meiji_period (DUPLICATE - 1ms later)
```

**Minimize attempt (06:07:25.005Z):**

```
25.005Z - MINIMIZE_QUICK_TAB request: qt-120-1764569231627-1ydids1hqafp1
25.005Z - QuickTabsManager: handleMinimize called
25.005Z - VisibilityHandler: Minimize button clicked (source: Manager)
25.005Z - WARN: Tab not found for minimize  <-- FAKE OBJECT IN MAP
25.005Z - Minimized Quick Tab (source: Manager)  <-- FALSE SUCCESS
```

**Pattern repeats for ALL tabs across entire session - 100% failure rate.**

</details>

<details>
<summary>Architectural Analysis: The Fake Object Anti-Pattern</summary>

**Why fake objects were created in the first place:**

The original intent was optimization - minimized tabs don't need full window
instances with DOM elements and event listeners. Storing lightweight placeholder
objects saves memory and reduces initialization time.

**Why this optimization is wrong:**

1. **Method expectations:** Every other component expects QuickTabWindow
   methods. When they don't exist, operations fail silently.

2. **Type confusion:** JavaScript's duck typing means the Map can hold any
   object. Without validation, fake objects masquerade as real ones.

3. **Lifecycle complexity:** Managing two types of objects (real instances and
   fake placeholders) in the same Map requires complex branching logic
   everywhere.

4. **State synchronization:** Real instances have properties (left, top, width,
   height) that update during operations. Fake objects never update, causing
   state desync.

**Better architectural approach:**

QuickTabWindow should support a "dormant" mode where the instance exists with
all methods but no DOM is attached. The `minimized` flag already exists for this
purpose - use it properly. When minimized=true, the instance has no
container/iframe but retains all methods. When restored, render() attaches the
DOM. This keeps instance type consistent while still saving memory.

</details>

<details>
<summary>Map Synchronization Diagnostic Data</summary>

**From logs showing Map states at 06:07:17.827Z:**

```
quickTabsManager.tabs.size: Unknown (not logged, but operations succeed implying > 0)
UICoordinator.renderedTabs.size: 0 (logged as mapSizeBefore)
StateManager.quickTabs.size: Unknown (not logged)
Storage tab count: 3 (Manager shows 3 tabs)
```

**This proves the Maps are completely desynchronized:**

- Storage has 3 tabs
- quickTabsManager.tabs probably has 3 fake objects
- UICoordinator.renderedTabs has 0 entries
- StateManager.quickTabs status unknown (likely 0 or 3 with missing URLs)

**Expected synchronized state:**

- Storage: 3 tabs with all data
- quickTabsManager.tabs: 3 real QuickTabWindow instances (minimized=true)
- UICoordinator.renderedTabs: 3 entries pointing to same instances
- StateManager.quickTabs: 3 QuickTab entities with all data

**Synchronization validation needed:** After every operation that changes Maps
(add, remove, hydrate), assert:

- All Maps have same key set (same IDs present)
- quickTabsManager.tabs entries are all QuickTabWindow instances
- UICoordinator.renderedTabs entries reference objects from
  quickTabsManager.tabs
- StateManager.quickTabs entities match stored data format
</details>

---

**Priority:** CRITICAL (Issues #1-3), HIGH (Issues #4-5), MEDIUM (Issues #6-7) |
**Target:** Complete architecture refactor required | **Estimated Complexity:**
Very High (touches core state management and hydration systems)
