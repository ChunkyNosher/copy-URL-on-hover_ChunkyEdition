# Quick Tabs Manager Panel State Wipe Bug - Complete Diagnostic

**Extension Version:** v1.6.3.4-v8  
**Date:** 2025-12-01  
**Scope:** Manager Panel restore triggers complete state wipe and cascade of
render failures

---

## Executive Summary

Clicking "Restore" in Manager Panel on ANY Quick Tab (whether actually minimized
or not) triggers a catastrophic storage corruption cascade that wipes all Quick
Tabs from storage and clears the Manager Panel list, while leaving Quick Tab
windows visible on screen. The root cause is incomplete event payload data in
`VisibilityHandler._emitRestoreStateUpdate()` which creates entities missing
critical fields like `url`, causing UICoordinator to reject rendering. The
rejection error handling then writes empty state to storage instead of rolling
back, creating a cascade that destroys all Quick Tab state data.

**Impact:** CRITICAL - Users lose entire Quick Tab state requiring manual
recreation. Quick Tabs remain visible on screen but are orphaned (not in
storage), creating confusion. Moving any orphaned tab triggers storage rebuild
from memory, "magically" restoring the list.

### Issues Overview Table

| Issue   | Component                        | Severity                        | Root Cause   |
| ------- | -------------------------------- | ------------------------------- | ------------ | -------------------------------------------- |
| **#14** | Incomplete event payload         | VisibilityHandler               | **CRITICAL** | Event missing url, position, size, title     |
| **#15** | Restore on non-minimized tabs    | Manager Panel                   | **HIGH**     | No minimized state validation before restore |
| **#16** | No state rollback on error       | UICoordinator                   | **CRITICAL** | Rejection writes empty state vs. rollback    |
| **#17** | No transaction safety            | Storage layer                   | **HIGH**     | Partial failures corrupt entire state        |
| **#18** | Manager missing storage listener | Manager Panel                   | **HIGH**     | Only debounces, never reconciles storage     |
| **#19** | Entity reference corruption      | VisibilityHandler/UICoordinator | **HIGH**     | Entity and instance are same object          |
| **#20** | Missing restore validation       | VisibilityHandler               | **MEDIUM**   | No check if tab actually minimized           |

**Why bundled:** All issues contribute to the same catastrophic failure -
Manager Panel restore triggering complete state wipe. Share event emission,
storage reconciliation, and error handling architecture.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (_emitRestoreStateUpdate, handleRestore validation)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (render rejection error handling, transaction rollback)
- `sidebar/quick-tabs-manager.js` (restore button state validation, storage reconciliation)
- `src/utils/storage-utils.js` (transaction pattern with rollback capability)

**Do NOT Modify:**

- `src/background/` (storage.onChanged handling is correct)
- `src/features/quick-tabs/minimized-manager.js` (snapshot logic works as
  designed)
- Event bus infrastructure (event emission timing is not the issue) </scope>

---

## Issue #14: State Event Payload Missing Critical Entity Data

### Problem

When VisibilityHandler emits `state:updated` event for restore operations, the
event payload contains only
`{id, minimized, domVerified, source, isRestoreOperation}` but is **missing
critical entity fields**: `url`, `title`, `position`, `size`, and `container`.
UICoordinator receives this incomplete entity and attempts to render it, but
fails validation because `url` is undefined.

**Log Evidence:**

```
[20:15:38.161] [UICoordinator] _applySnapshotForRestore - entity dimensions BEFORE: {"id":"qt-20-1764620098198-bcdjqz1ppruln"}
                                                                                   ^^^^^^^ Entity has ONLY id!
[20:15:38.161] [ERROR] [UICoordinator] REJECTED: Cannot render Quick Tab with undefined URL
```

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_emitRestoreStateUpdate()` method line ~284  
**Issue:** Helper method `_createQuickTabData()` only copies
`{id, minimized, url, title}` from tabWindow, but when tabWindow is null (not in
quickTabsMap), the fallback creates an entity with ONLY
`{id, minimized, domVerified, source, isRestoreOperation}`.

The event payload construction logic:

```
Line ~284:
if (!tabWindow) {
  const quickTabData = { id, minimized: false, domVerified: false, source, isRestoreOperation: true };
  this.eventBus.emit('state:updated', { quickTab: quickTabData, source });
}
```

**Missing fields:** `url`, `position`, `size`, `title`, `container` are all
undefined when tabWindow doesn't exist in quickTabsMap.

**Why tabWindow is null:** When Manager Panel sends restore for a tab that was
never minimized, VisibilityHandler's `handleRestore()` checks
`minimizedManager.restore(id)` which returns false (no snapshot), then checks
`quickTabsMap.get(id)` which returns null because the window is active (not in
the Map due to prior cleanup), creating the incomplete event payload.

### Fix Required

Fetch entity data from storage or StateManager when tabWindow is null. The event
payload MUST include complete entity data to enable UICoordinator rendering. Do
NOT emit `state:updated` with incomplete entities.

Pattern: Before emitting event, validate payload has all required fields (`url`,
`position`, `size`, `title`, `container`). If missing, fetch from storage using
the Quick Tab ID. Only emit if complete entity can be constructed.

Alternative: Do NOT handle restore when tabWindow doesn't exist - return early
with error instead of emitting incomplete event.

---

## Issue #15: Manager Panel Allows Restore on Non-Minimized Tabs

### Problem

Manager Panel's restore button is active and clickable even for Quick Tabs that
show green indicator (active, not minimized). Clicking restore on an active tab
triggers the cascade because the tab was never actually minimized, so no
snapshot exists, leading to incomplete event payload (Issue #14).

**Visual Evidence:** Screenshots show Manager Panel with green indicators
(active tabs) but restore operation executes anyway.

**Log Evidence:**

```
[20:15:17.931] [VisibilityHandler] Handling restore (source: Manager)
[20:15:17.931] [MinimizedManager] No snapshot found for restore
[20:15:17.931] [WARN] Tab not found in minimized manager (source: Manager)
```

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_createTabActions()` method line ~350  
**Issue:** Restore button logic only checks `if (isMinimized)` to decide which
buttons to show, but the `isMinimized` parameter comes from
`isTabMinimizedHelper(tab)` which reads `tab.minimized` from storage. There's a
timing window where storage state is stale or user clicks before Manager UI
updates.

Additionally, `restoreQuickTab()` function (line ~680) has NO validation before
sending RESTORE_QUICK_TAB message - it blindly sends to all tabs without
checking current state.

**No validation performed:**

- Manager doesn't check if tab is actually in minimized state before allowing
  restore
- No validation in `restoreQuickTab()` before sending message
- Button state is based on storage snapshot, not real-time Quick Tab window
  state

### Fix Required

Add state validation in `restoreQuickTab()` function before sending
RESTORE_QUICK_TAB message. Check if Quick Tab is actually minimized by verifying
`tab.minimized === true` in current storage state. If not minimized, show error
notification and prevent restore operation.

Additionally, disable restore button when `tab.domVerified === false` (restore
already in progress) to prevent double-clicks.

Pattern: Follow same validation pattern as minimize button which checks instance
state before executing.

---

## Issue #16: UICoordinator Render Rejection Writes Empty State Instead of Rollback

### Problem

When UICoordinator's `render()` method rejects an entity due to undefined URL,
the error handling code path writes an EMPTY state `{tabs: []}` to storage
instead of rolling back to previous valid state. This causes immediate loss of
all Quick Tab state data.

**Log Evidence:**

```
[20:15:38.161] [ERROR] [UICoordinator] REJECTED: Cannot render Quick Tab with undefined URL
[20:15:38.524] [Background] │ tabs: 4 → 0
[20:15:38.524] [WARN] │ ⚠️ WARNING: Tab count dropped from 4 to 0!
                         ^^^^^^^ 37 MILLISECONDS after rejection
```

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js` OR storage
reconciliation logic  
**Location:** Error handling path after `render()` rejection (not visible in
logs - must be inferred)  
**Issue:** When `render()` fails validation and returns null, some code path
attempts to "reconcile" storage state with current memory state. Since the
rejected entity was never added to `renderedTabs`, the reconciliation logic sees
empty Map and writes empty state to storage.

**Suspected flow:**

1. UICoordinator rejects render → returns null
2. Caller interprets null as failure → triggers reconciliation
3. Reconciliation reads `renderedTabs.size === 0` (all tabs were previously
   cleaned up)
4. Writes `{tabs: []}` to storage to "sync" with empty memory state
5. Background script propagates empty state

**No rollback mechanism exists** - failed operations don't restore previous
valid state.

### Fix Required

Implement transaction pattern with rollback capability. Before ANY storage
write, capture current state snapshot. If operation fails validation or
execution, restore the snapshot instead of writing corrupted state.

Pattern:

1. Snapshot current storage state before destructive operation
2. Attempt operation (render, restore, minimize)
3. On success: commit changes to storage
4. On failure: restore snapshot and log error WITHOUT writing to storage

Never write empty state to storage as result of error condition. Rejection
should be silent (no storage write) or should restore previous state.

---

## Issue #17: No Transaction Safety - Partial Failures Corrupt Entire State

### Problem

Storage operations lack transaction safety. When multi-step operations fail
partway through (e.g., restore fails after Map cleanup), the system ends up in
inconsistent state with some steps completed and others not, ultimately leading
to complete state loss.

**Example cascade:**

1. UICoordinator deletes entry from `renderedTabs` (step 1 of restore)
2. Render validation fails due to missing URL (step 2 fails)
3. Map is now empty but storage still has 4 tabs (inconsistent)
4. Reconciliation attempts to "fix" inconsistency by clearing storage
5. All state lost

### Root Cause

**File:** Storage layer utilities and coordinator logic  
**Issue:** No atomic transaction wrapper around multi-step operations. Each step
(Map modification, DOM manipulation, storage write) executes independently
without coordination. Failures in any step leave system in partial state.

**Missing patterns:**

- No BEGIN/COMMIT/ROLLBACK transaction boundaries
- No state capture before destructive operations
- No automatic rollback on exceptions
- No validation of final state before commit

### Fix Required

Wrap all multi-step state operations in transaction pattern:

1. **Acquire transaction lock** (prevent concurrent modifications)
2. **Capture current state** (snapshot quickTabsMap, renderedTabs, storage)
3. **Execute operation steps** in try block
4. **Validate final state** (all required fields present, counts match)
5. **Commit changes** to storage only if validation passes
6. **On ANY error:** Restore snapshot and release lock WITHOUT writing to
   storage

Apply to: restore operations, minimize operations, bulk close operations, any
operation that modifies both memory state and storage.

Pattern: Database ACID transaction model - all steps succeed or all steps
rollback.

---

## Issue #18: Manager Panel Missing Storage Reconciliation Logic

### Problem

Manager Panel only debounces storage reads (300ms delay) but never reconciles
its UI state with actual storage state. When storage is corrupted or wiped,
Manager Panel's debounce timer fires, reads empty storage, and clears the UI -
but doesn't attempt to reconcile with potentially valid memory state in content
scripts.

**Log Evidence:**

```
[Manager] Storage change detected: oldTabCount: 4, newTabCount: 0
[Manager] Debouncing storage read, waiting 300ms
// 300ms later - UI clears, no reconciliation attempted
```

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `storage.onChanged` listener line ~520 and `loadQuickTabsState()`
line ~160  
**Issue:** Storage listener only debounces and re-renders from storage. No logic
to detect anomalies (sudden count drop to 0) or reconcile with content script
state.

**Missing logic:**

- No detection of suspicious state changes (e.g., 4 tabs → 0 tabs in single
  write)
- No reconciliation attempt when storage appears corrupted
- No query to content scripts for current Quick Tab state
- No warning to user that state may be corrupted

### Fix Required

Add reconciliation logic in storage listener:

1. **Detect anomalies:** If tab count drops to 0 and previous count was > 0,
   flag as suspicious
2. **Query content scripts:** Send message to active tab requesting current
   `quickTabsMap` state
3. **Compare states:** If content script reports active Quick Tabs but storage
   is empty, storage is corrupted
4. **Reconcile:** Rebuild storage from content script state OR show warning to
   user
5. **Only clear UI** if reconciliation confirms Quick Tabs should actually be
   empty

Pattern: Background script reconciliation logic that validates storage
consistency before propagating changes.

---

## Issue #19: Entity and Instance Reference Confusion Creates State Desync

### Problem

The entity stored in `quickTabsMap` and the `tabWindow` instance are the SAME
OBJECT REFERENCE in memory. When state updates happen in multiple steps (e.g.,
set entity.minimized, then call instance.minimize()), failures in later steps
leave the entity in inconsistent state because earlier steps already mutated the
shared object.

**Log Evidence from Previous Session:**

```
[UICoordinator] update() entry: {
  entityMinimized: false,    // ← Entity says NOT minimized
}
[UICoordinator] Checking MinimizedManager: {
  isMinimized: true          // ← Manager says IS minimized
}
```

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js` and
`UICoordinator.js`  
**Issue:** `quickTabsMap.get(id)` returns the QuickTabWindow instance directly.
Code treats it as both entity (data) and instance (behavior), leading to state
mutations that aren't atomic.

When minimize operation executes:

```
Line ~242: tabWindow.minimized = true;  // ← Mutates entity (source of truth)
Line ~244: this.minimizedManager.add(id, tabWindow);  // ← Adds to manager
Line ~252: tabWindow.minimize();  // ← If THIS fails, entity already corrupted
```

If step 3 fails, entity has `minimized: true` but DOM is still visible, creating
desync.

### Fix Required

Separate entity (data) from instance (behavior):

1. **Entity:** Plain object with only data fields
   (`{id, url, position, size, minimized, ...}`)
2. **Instance:** QuickTabWindow class with behavior methods
3. **Map stores:** Entity objects only
4. **Instance references:** Stored separately in `renderedTabs`

Alternatively, implement **Copy-on-Write** pattern: Clone entity before
mutation, validate all steps succeed, then commit updated entity to Map. On
failure, discard clone without affecting original.

Pattern: Immutable state updates - never mutate entities in place, always create
new version and swap atomically.

---

## Issue #20: VisibilityHandler Missing Restore Validation

### Problem

`VisibilityHandler.handleRestore()` doesn't validate whether the Quick Tab is
actually in minimized state before attempting restore. It accepts restore
requests from any source (Manager Panel, automation) and only warns if snapshot
not found, but still emits `state:updated` event with incomplete data.

**Log Evidence:**

```
[20:15:17.931] [VisibilityHandler] Handling restore (source: Manager)
[20:15:17.931] [MinimizedManager] No snapshot found for restore
[20:15:17.931] [WARN] Tab not found in minimized manager
// ← Should REJECT here, but continues with incomplete event emission
```

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleRestore()` method line ~330  
**Issue:** Method only checks `minimizedManager.restore(id)` result but doesn't
validate preconditions. When restore returns false, code logs warning but still
proceeds to emit event.

**Missing validation:**

- No check if `tabWindow.minimized === true` before restore
- No check if tabWindow exists in quickTabsMap
- No early return when snapshot not found - continues with incomplete data

### Fix Required

Add validation at start of `handleRestore()`:

1. **Check tabWindow exists:** `const tabWindow = this.quickTabsMap.get(id);`
2. **Validate minimized state:**
   `if (!tabWindow || !tabWindow.minimized) return error;`
3. **Verify snapshot exists:**
   `if (!minimizedManager.hasSnapshot(id)) return error;`
4. **Only proceed** if all validations pass
5. **Return error object** with reason if validation fails (don't emit
   incomplete event)

Pattern: Guard clause validation at method entry - fail fast with clear error
message instead of partial execution.

---

## Missing Logging Identified

### VisibilityHandler.js

- **Line ~284:** No log showing WHICH fields are missing from event payload when
  tabWindow is null
- **Line ~330:** No log showing validation failures when restore preconditions
  not met
- **No tracking:** Event payload contents before emission (would reveal missing
  url, position, size)
- **No verification:** tabWindow null vs. exists decision logging

### UICoordinator.js

- **After render rejection:** No log showing what happens next (reconciliation?
  rollback? storage write?)
- **No tracking:** State snapshot before destructive operations (Map cleanup,
  storage writes)
- **No verification:** Final state validation before storage commit
- **Missing:** Transaction boundary logs (BEGIN, COMMIT, ROLLBACK)

### Manager Panel (sidebar/quick-tabs-manager.js)

- **Line ~680 restoreQuickTab():** No log showing tab state validation before
  sending restore message
- **No detection:** Suspicious storage changes (4 tabs → 0 tabs) flagged as
  potential corruption
- **No reconciliation:** Logs showing attempt to query content scripts for
  current state
- **Missing:** Comparison logs when storage state differs from expected state

### Storage Utils

- **No transaction logs:** BEGIN/COMMIT/ROLLBACK boundaries for multi-step
  operations
- **No rollback logs:** When state restoration occurs after failed operation
- **No validation logs:** Pre-commit state validation results
- **Missing:** Checksum or version verification for storage integrity

### Content Script Message Handling

- **RESTORE_QUICK_TAB handler:** No log showing which tab received restore
  request
- **No validation:** Logs showing whether restore operation was appropriate (tab
  actually minimized)
- **No correlation:** Logs linking Manager Panel restore click to content script
  execution

---

## Shared Implementation Notes

- **Event payload validation:** All `state:updated` events MUST include complete
  entity data (`url`, `title`, `position`, `size`, `container`)
- **Transaction pattern:** All multi-step operations MUST capture state snapshot
  before execution and rollback on failure
- **State validation:** All operations MUST validate preconditions (is
  minimized, has snapshot, URL exists) before proceeding
- **Error handling:** Validation failures MUST return error WITHOUT emitting
  events or writing to storage
- **Reconciliation:** Manager Panel MUST detect and reconcile suspicious storage
  changes instead of blindly clearing UI
- **Separation of concerns:** Entity (data) and Instance (behavior) should be
  separate objects to prevent partial update corruption

<acceptance-criteria>

**Issue #14:**

- Event payload includes url, position, size, title, container when emitted
- UICoordinator receives complete entity data for all state:updated events
- No "REJECTED: Cannot render with undefined URL" errors during normal
  operations

**Issue #15:**

- Restore button disabled when tab.minimized === false
- restoreQuickTab() validates state before sending message
- Error notification shown if restore attempted on non-minimized tab

**Issue #16:**

- Render rejection does NOT write to storage
- Storage state unchanged after validation failure
- No tab count drops to 0 after render rejection

**Issue #17:**

- All multi-step operations wrapped in transaction pattern
- Failed operations trigger rollback to previous state
- No partial state corruption (some steps complete, others fail)

**Issue #18:**

- Manager Panel detects suspicious storage changes (count drop to 0)
- Reconciliation query sent to content scripts when storage appears corrupted
- UI only clears after confirming Quick Tabs actually empty

**Issue #19:**

- Entity and instance are separate objects (or copy-on-write pattern used)
- No state desync between entity.minimized and instance.minimized
- All state updates are atomic (all-or-nothing)

**Issue #20:**

- handleRestore() validates tab is minimized before proceeding
- Early return with error when preconditions not met
- No incomplete event emission when snapshot not found

**All Issues:**

- All existing tests pass
- No new console errors or warnings
- Manual test: Click restore on active (green) tab → Error shown, state
  preserved
- Manual test: Click restore on minimized tab → Restore succeeds, Manager list
  intact
- Manual test: Simulate render failure → Storage state unchanged, rollback
  occurs
- Manual test: Create 3 QTs → Minimize 1 → Restore → All 3 still in Manager list

</acceptance-criteria>

---

**Priority:** CRITICAL (Issues #14, #16, #17) | HIGH (Issues #15, #18, #19,
#20)  
**Target:** Single coordinated PR addressing event payload, validation, and
transaction safety  
**Estimated Complexity:** High (requires event payload redesign, transaction
pattern implementation, state reconciliation logic)
