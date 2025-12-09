# Quick Tabs State Synchronization & DOM Lifecycle Failures

**Extension Version:** v1.6.3.4-v7  
**Date:** 2025-12-01  
**Scope:** Multiple critical bugs affecting state persistence, DOM lifecycle,
and UI synchronization across VisibilityHandler, UICoordinator,
MinimizedManager, and storage-utils

---

## Executive Summary

The Quick Tabs extension exhibits catastrophic storage corruption, persistent
state desynchronization between MinimizedManager and storage, and DOM lifecycle
race conditions. Analysis of production logs reveals **12 consecutive empty
storage writes** within 500ms that wipe all tab state, followed by **minimized
count mismatches**, **duplicate event firing**, and **Map corruption** in
UICoordinator. These issues stem from **missing storage.onChanged handlers** in
reviewed code, **incorrect method calls** in storage-utils, **circular event
propagation**, **snapshot lifecycle races**, and **unqueued storage transaction
overlaps**. All issues trace back to v1.6.3's cross-tab sync removal which left
orphaned event handlers and incomplete persistence flows.

---

## Issues Overview

| Issue                               | Component                             | Severity     | Root Cause                                                 |
| ----------------------------------- | ------------------------------------- | ------------ | ---------------------------------------------------------- |
| **#1** Storage Corruption Cascade   | storage.onChanged handler (not found) | **CRITICAL** | External handler wiping state - 12 empty writes in 500ms   |
| **#2** Minimized Count Mismatch     | storage-utils.js + MinimizedManager   | **CRITICAL** | Calls non-existent `getAllMinimized()` method              |
| **#3** Duplicate Minimize Events    | VisibilityHandler.js                  | **HIGH**     | Circular event propagation UI→Handler→Window→Handler       |
| **#4** Snapshot Lifecycle Race      | UICoordinator + MinimizedManager      | **HIGH**     | clearSnapshot() called 245ms early (155ms vs 400ms delay)  |
| **#5** UICoordinator Map Corruption | UICoordinator.js                      | **HIGH**     | Double-deletion during minimize+restore race               |
| **#6** Duplicate Focus Events       | VisibilityHandler.js                  | **MEDIUM**   | No lock/debounce on handleFocus() - z-index wasted         |
| **#7** Storage Write Overlaps       | storage-utils + handlers              | **MEDIUM**   | No transaction queue - concurrent writes race              |
| **#8** Missing Logging Gaps         | Multiple files                        | **HIGH**     | storage.onChanged, Map deletions, snapshot clears unlogged |

**Why bundled:** All affect Quick Tab state visibility, share storage/event
architecture, and were introduced when v1.6.3 removed cross-tab sync
coordinator. Can be fixed in coordinated PR with comprehensive logging
additions.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleMinimize, handleFocus)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (_handleExistingWindowInRender, _scheduleSnapshotClearing)
- `src/features/quick-tabs/minimized-manager.js` (add getAllMinimized method)
- `src/utils/storage-utils.js` (buildStateForStorage, persistStateToStorage - add queue)
- `src/features/quick-tabs/index.js` (add storage.onChanged logging)
- `src/background.js` (MUST REVIEW - suspected source of corruption)

**Do NOT Modify:**

- `src/features/quick-tabs/window.js` (QuickTabWindow internals)
- `src/core/config.js` (constants)
- Test files </scope>

---

## Issue #1: Storage Corruption Cascade - 12 Empty Writes

### Problem

Logs show catastrophic storage event at **17:27:32.278** where state jumps from
**2 tabs → 0 tabs**, followed by 11 rapid empty writes (different transaction
IDs) within 500ms, permanently wiping all Quick Tab state.

### Root Cause

**File:** Unknown (not in reviewed files - suspected `src/background.js`)  
**Location:** storage.onChanged handler (NOT FOUND in quick-tabs code)  
**Issue:** An external component is listening to `storage.onChanged` and
reacting to state changes by clearing/rewriting storage. The reviewed Quick Tabs
codebase contains **NO storage.onChanged listener** that could trigger this
clearing behavior.

**Evidence from logs:**

```
[17:27:32.278] oldTabCount: 2 → newTabCount: 0, oldSaveId: "1764610049728-66550zuoh"
[17:27:32.562] oldTabCount: 0 → newTabCount: 0 (txn-1764610052559-66ntlp)
[17:27:32.590] oldTabCount: 0 → newTabCount: 0 (txn-1764610052588-uarth7)
... [9 more identical empty writes with unique transaction IDs]
```

**Missing Code Path:** Background script or panel manager must contain a handler
that:

1. Receives `storage.onChanged` event
2. Reads empty/corrupted state
3. Writes it back 12 times with different IDs
4. Has NO LOGGING for this operation

### Fix Required

**PRIORITY 1:** Locate the missing storage.onChanged handler (likely in
`background.js` or panel code) and add comprehensive logging:

- Log EVERY storage.onChanged event with oldValue/newValue tab counts
- Log the component that triggers the write
- Log full stack trace when writing 0-tab state
- Add validation to REJECT empty state writes unless explicitly cleared by user

**PRIORITY 2:** Add defensive validation in `storage-utils.js`
`persistStateToStorage()`:

- Reject writes with 0 tabs unless `forceEmpty` flag is true
- Log WARNING when state goes from N tabs → 0 tabs
- Add 1-second cooldown between empty writes to prevent cascades

---

## Issue #2: Minimized Count Mismatch - Method Not Found

### Problem

Logs consistently show:
`"Minimized count mismatch: stateMinimized: 1, managerMinimized: 0"` despite
minimize operations succeeding. State believes tab is minimized but
MinimizedManager has NO record of it.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `buildStateForStorage()` line ~480  
**Issue:** Code calls `this.minimizedManager?.getAllMinimized?.()` but
`MinimizedManager` class has **NO `getAllMinimized()` method**. The method
returns `undefined`, causing count to always be 0.

**Actual MinimizedManager API:**

- ✅ `getAll()` - returns array of window instances
- ✅ `getCount()` - returns minimized tab count
- ❌ `getAllMinimized()` - **DOES NOT EXIST**

**Evidence from code review:**

- `storage-utils.js:480`: Uses `this.minimizedManager?.getAllMinimized?.()`
- `minimized-manager.js`: Only exports `getAll()` and `getCount()`, NOT
  `getAllMinimized()`

### Fix Required

Change `storage-utils.js` to call the CORRECT method that actually exists. The
method name mismatch is causing undefined returns which default to 0, creating
persistent count mismatches. Reference the MinimizedManager API to use the
proper method name for retrieving minimized tab count.

---

## Issue #3: Duplicate Minimize Events - Circular Propagation

### Problem

Every minimize operation fires **TWICE** - once from `source: Manager`, once
from `source: UI`. Second call gets blocked by lock but event already
propagated, wasting cycles.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` lines 199-272  
**Issue:** Circular event propagation creates duplicate calls:

**Event Flow:**

1. Panel button → `handleMinimize(id, 'Manager')`
2. Handler calls `tabWindow.minimize()` (line 269)
3. `QuickTabWindow.minimize()` likely fires `onMinimize` callback
4. Callback → `handleMinimize(id, 'UI')` **AGAIN**
5. Lock blocks second call (line 272) but damage done

**Evidence from logs:**

```
[17:27:30.267] handleMinimize called (source: Manager)
[17:27:30.269] Called tabWindow.minimize()
[17:27:30.272] handleMinimize called (source: UI)
[17:27:30.272] Lock blocked duplicate minimize
```

### Fix Required

Refactor event flow to prevent circular calls. Consider adding mechanism to
suppress callbacks when handler is the initiator, or restructure to one-way
event flow where handler calls minimize but window doesn't trigger handler
callback in that scenario. Keep lock as safety net but eliminate the root
circular dependency.

---

## Issue #4: Snapshot Lifecycle Race - Early Clear

### Problem

Restore completes at **17:27:31.871** with 2 tabs, then `clearSnapshot()` called
at **17:27:32.158** (287ms later) finds **NO snapshot**, followed 120ms later by
storage corruption. The 400ms scheduled delay was ignored.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_scheduleSnapshotClearing()` lines ~180-195  
**Issue:** Code schedules snapshot clear at +400ms (`SNAPSHOT_CLEAR_DELAY_MS`)
but logs show it fires at +155ms. Something else is calling `clearSnapshot()`
prematurely, likely from VisibilityHandler or UpdateHandler.

**Evidence:**

```
[17:27:31.708] Scheduled snapshot clearing in 400ms
[17:27:31.863] Cleared snapshot after successful render (at +155ms - TOO EARLY)
[17:27:32.158] clearSnapshot called but no snapshot found (snapshot already gone)
[17:27:32.278] Storage corruption begins (0 tabs)
```

**Suspected culprit:** `VisibilityHandler._debouncedPersist()` or
`UpdateHandler` may be calling `MinimizedManager.clearSnapshot()` directly
without coordinating with UICoordinator's scheduled timer.

### Fix Required

Centralize snapshot clearing to ONLY UICoordinator. Remove any direct
`clearSnapshot()` calls from VisibilityHandler and UpdateHandler that bypass
UICoordinator's lifecycle management. UICoordinator should own the complete
snapshot lifecycle. Add logging to `MinimizedManager.clearSnapshot()` to track
all callers and identify which component is calling prematurely. Consider
increasing delay from 400ms to 600ms for additional grace period.

---

## Issue #5: UICoordinator Map Corruption - Double Deletion

### Problem

`renderedTabs` Map shows `mapSizeBefore: 0` repeatedly despite tabs being
created. Map is being over-cleared, causing duplicate 400x300 windows on
restore.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Locations:**

- `_handleExistingWindowInRender()` lines 240-254
- `_handleManagerMinimize()` lines 525-543

**Issue:** Two code paths delete from Map when minimize happens:

1. `_handleManagerMinimize()` deletes when `source='Manager'` +
   `entityMinimized=true`
2. `_handleExistingWindowInRender()` deletes when `DOM detached`

**Race condition:** If minimize happens during restore flow, Map entry gets
deleted TWICE:

- First delete: Manager minimize removes entry
- Second delete: Next render sees "DOM detached" and removes entry again
  (already gone)
- Result: Map size becomes 0, subsequent operations fail

**Evidence from logs:**

```
[17:27:30.272] renderedTabs.delete() - Manager minimize (mapSize: 1 → 0)
[17:27:31.705] update() entry: inMap: false, mapSizeBefore: 0 (should be 1)
```

### Fix Required

Add Map existence checks before deletion operations. Before calling
`renderedTabs.delete(id)`, verify entry exists with `renderedTabs.has(id)`
check. Log WARNING when attempting to delete non-existent entry. Add validation
that Map size never goes negative or unexpectedly to zero during normal
operations.

---

## Issue #6: Duplicate Focus Events - No Debounce

### Problem

Focus operations fire TWICE within 1-2ms, incrementing z-index unnecessarily and
wasting stack space.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleFocus()` lines 310-327  
**Issue:** No lock or debounce on focus operations. Similar to minimize bug -
handler calls `tabWindow.updateZIndex()` which likely triggers focus callback
that calls `handleFocus()` again.

**Evidence:**

```
[17:27:27.768] Bringing to front: qt-121-1764610047060-zzcz7p4iw7o6
[17:27:27.770] Bringing to front: qt-121-1764610047060-zzcz7p4iw7o6 [+2ms DUPLICATE]
```

### Fix Required

Add focus operation lock similar to minimize/restore pattern. Use same mutex
mechanism as minimize operations with reasonable timeout (suggest 100ms for
focus). Keep lock lightweight since focus is high-frequency operation. Consider
debouncing instead of pure locking for better UX.

---

## Issue #7: Storage Write Overlaps - No Queue

### Problem

Multiple handlers can call `persistStateToStorage()` simultaneously, causing
race conditions. Focus persist at +200ms, position persist at +300ms - both can
overlap.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `persistStateToStorage()` lines 545-630  
**Issue:** `IN_PROGRESS_TRANSACTIONS` Set tracks ongoing writes but does NOT
queue overlapping requests. Two handlers can call persist simultaneously:

- VisibilityHandler: schedules at +200ms (MINIMIZE_DEBOUNCE_MS)
- UpdateHandler: schedules at +300ms (position debounce)
- Both execute in parallel - no serialization

**Evidence from logs:**

```
[17:27:27.997] VisibilityHandler Storage write STARTED [txn-1]
[17:27:28.302] UpdateHandler Storage write STARTED [txn-2] (305ms overlap)
```

### Fix Required

Implement write queue in storage-utils to serialize all storage operations.
Create module-level Promise chain that ensures FIFO ordering of all persist
calls. Each new write should wait for previous write to complete before
starting. This prevents race conditions while maintaining async performance.
Follow established async queue patterns from browser extension background
scripts.

---

## Issue #8: Missing Logging - Critical Blind Spots

### Problem

Multiple critical operations have NO logging, making diagnosis impossible:

1. storage.onChanged handler - WHO receives storage changes?
2. Map.delete operations - WHY is Map being cleared?
3. clearSnapshot() calls - WHO calls this prematurely?
4. storage.get() reads - WHAT state is being read?
5. Panel refresh triggers - WHEN does panel sync?

### Root Cause

**Files:** Multiple (index.js, background.js, UICoordinator.js,
MinimizedManager.js)  
**Issue:** Logging was not added when v1.6.3 refactored cross-tab sync. Critical
event handlers now execute silently.

### Fix Required

Add comprehensive logging to critical blind spots:

1. **storage.onChanged handler** (wherever it exists - likely background.js):
   - Log EVERY change with oldValue/newValue tab counts
   - Log transaction IDs
   - Log calling component

2. **UICoordinator Map operations**:
   - Log EVERY `renderedTabs.delete()` with reason
   - Log Map size before/after
   - Log stack trace if Map becomes empty unexpectedly

3. **MinimizedManager.clearSnapshot()**:
   - Log EVERY call with caller identification
   - Log whether snapshot was actually found
   - Add stack trace capability for debugging

4. **All storage reads**:
   - Log `browser.storage.local.get()` calls with keys
   - Log returned data structure

5. **Panel sync operations**:
   - Log panel state refresh requests
   - Log panel UI update triggers

---

## Shared Implementation Notes

- **ALL storage writes** must go through centralized queue in storage-utils.js
- **ALL Map deletions** must check `.has()` first and log the operation
- **ALL snapshot lifecycle** operations must coordinate through UICoordinator
  only
- **Follow logging pattern:** `[Component] Action: {contextObject}`
- **Add timestamps** to all new logs for correlation analysis
- **Use transaction IDs** for tracking storage write chains across components
- Ensure **backwards compatibility** with tabs saved in v1.6.2 format
- **Debouncing constants** should be configurable but default to proven values
  (100-300ms range)

<acceptancecriteria>
**Issue #1 (Storage Corruption):**
- No more 0-tab storage writes unless user explicitly triggers "Clear All"
- Storage corruption cascade prevented via defensive validation
- Full logging of storage.onChanged handler activity with stack traces

**Issue #2 (Minimized Count):**

- Minimized count matches between state and MinimizedManager in all scenarios
- No more mismatch warnings in console logs
- Correct method call resolves count accurately

**Issue #3 (Duplicate Minimize):**

- Only ONE minimize log entry per user minimize action
- Lock blocks duplicates but root circular cause eliminated
- No circular event propagation between handler and window

**Issue #4 (Snapshot Lifecycle):**

- Snapshot persists for full configured delay (400ms or increased to 600ms)
- clearSnapshot() only called by UICoordinator's scheduled timer
- No premature snapshot clearing from other components

**Issue #5 (Map Corruption):**

- Map size never unexpectedly becomes 0 during normal operations
- No double-deletion warnings in logs
- All Map operations logged with before/after state

**Issue #6 (Duplicate Focus):**

- Only ONE focus event log per user focus action
- Z-index increments exactly once per focus
- Lock or debounce prevents duplicate focus calls

**Issue #7 (Write Overlaps):**

- All storage writes serialized via FIFO queue
- No overlapping transaction logs
- Write order preserved across handlers

**Issue #8 (Missing Logging):**

- storage.onChanged handler logs ALL events with full context
- Map deletions logged with reason and caller
- clearSnapshot() calls logged with caller identification
- Panel refresh operations visible in logs

**All Issues:**

- All existing tests pass without modification
- No new console errors or warnings introduced
- Manual test: Create 3 tabs → minimize all → restore all → reload page → state
  persists correctly with accurate counts
- Manual test: Rapid drag + resize + minimize → no duplicate events → no storage
  corruption
- Manual test: Focus different tabs rapidly → no z-index explosion → no
  duplicate logs </acceptancecriteria>

---

## Supporting Context

<details>
<summary>Issue #1: Storage Corruption Log Evidence</summary>

Complete sequence showing 12 empty writes within 517ms:

```
[17:27:32.278] Storage change: oldTabCount: 2, newTabCount: 0
[17:27:32.278] Storage cleared (empty/missing tabs), clearing cache immediately
[17:27:32.562] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052559-66ntlp
[17:27:32.590] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052588-uarth7
[17:27:32.591] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052588-xgkkzg
[17:27:32.628] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052626-e15bxz
[17:27:32.666] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052664-bqwwpq
[17:27:32.702] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052700-4vwprb
[17:27:32.740] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052738-55e7gx
[17:27:32.758] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052756-vdagtf
[17:27:32.759] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052756-ljpcmi
[17:27:32.760] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052756-2i51o6
[17:27:32.795] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052793-26ib3s
[17:27:32.796] Storage change: oldTabCount: 0, newTabCount: 0, txn: txn-1764610052793-v0xvt0
```

All writes have DIFFERENT transaction IDs but identical empty state. This
pattern indicates a loop or external trigger writing repeatedly, NOT a single
debounced operation.

</details>

<details>
<summary>Issue #2: MinimizedManager API Mismatch Details</summary>

**Current MinimizedManager API (from code review):**

```javascript
class MinimizedManager {
  getAll() {
    return Array.from(this.minimizedTabs.values()).map(s => s.window);
  }
  getCount() {
    return this.minimizedTabs.size;
  }
  isMinimized(id) {
    return this.minimizedTabs.has(id);
  }
  hasSnapshot(id) {
    return this.minimizedTabs.has(id) || this.pendingClearSnapshots.has(id);
  }
  // ❌ getAllMinimized() DOES NOT EXIST IN CLASS
}
```

**What storage-utils.js attempts to call:**

```javascript
// Line ~480 in buildStateForStorage()
const minimizedManagerCount =
  this.minimizedManager?.getAllMinimized?.()?.length ?? 0;
```

This returns `undefined?.length` which becomes `0`, causing persistent count
mismatches even when tabs are correctly minimized.

</details>

<details>
<summary>Issue #4: Snapshot Timing Evidence</summary>

Timeline showing premature snapshot clearing:

```
[17:27:31.708] UICoordinator: Scheduled snapshot clearing in 400ms (should fire at 32.108)
[17:27:31.863] MinimizedManager: Cleared snapshot after successful render (FIRED at +155ms - TOO EARLY)
[17:27:32.108] [Expected time - no log entry, snapshot already gone]
[17:27:32.158] UICoordinator: clearSnapshot() called but found no snapshot (snapshot missing)
[17:27:32.278] Storage corruption begins (0 tabs written)
```

The 400ms timer was scheduled but snapshot cleared at +155ms instead, suggesting
a rogue caller bypassed the scheduled timer.

</details>

<details>
<summary>Architecture Context: Storage Event Flow</summary>

**Current flow (broken):**

1. Handler updates local state
2. Handler MAY OR MAY NOT persist to storage (inconsistent across handlers)
3. Background receives storage.onChanged (if storage was written)
4. Background updates cache
5. Panel MAY receive update (if listening)

**Missing components:**

- Background's storage.onChanged handler NOT in reviewed Quick Tabs code
- Panel's sync mechanism NOT visible in reviewed files
- No centralized persistence coordinator (was removed in v1.6.3 refactor)

**Expected flow (needs implementation):**

1. Handler updates local state
2. Handler ALWAYS persists via centralized queued write
3. Background receives ALL changes via storage.onChanged
4. Background broadcasts state change to all listeners
5. Panel updates UI synchronously
6. All steps LOGGED for complete audit trail

</details>

<details>
<summary>Issue #5: Map Double-Deletion Race Condition</summary>

**Sequence showing Map corruption:**

```
[17:27:30.267] _handleManagerMinimize: source=Manager, deleting from renderedTabs
[17:27:30.272] renderedTabs.delete(qt-121-xxx) - mapSize: 1 → 0
[17:27:31.705] update() called for restore
[17:27:31.705] Checking renderedTabs: inMap=false, mapSizeBefore=0 (SHOULD BE 1)
[17:27:31.706] _handleExistingWindowInRender: DOM appears detached
[17:27:31.706] Attempting renderedTabs.delete(qt-121-xxx) again (ALREADY GONE)
[17:27:31.706] Map size remains 0 - double deletion completed
```

The minimize operation deletes from Map, then restore finds "DOM detached" and
tries to delete again, over-clearing the Map.

</details>

---

**Priority:** CRITICAL (blocks all Quick Tab state reliability)  
**Target:** Fix all in single coordinated PR with comprehensive testing  
**Estimated Complexity:** HIGH (requires background.js review + multi-file
coordination + extensive logging additions)

---
