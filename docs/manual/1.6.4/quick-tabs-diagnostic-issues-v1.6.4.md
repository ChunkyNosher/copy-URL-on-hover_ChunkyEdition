# Quick Tabs State Management Race Conditions & Missing Logging

**Extension Version:** v1.6.4.12  
**Date:** December 02, 2025  
**Scope:** Multiple critical race conditions in Quick Tab minimize/restore
operations affecting `renderedTabs` Map integrity and state synchronization

---

## Executive Summary

Quick Tab minimize and restore operations experience race conditions causing
`renderedTabs` Map corruption, 73-second logging gaps, and duplicate 400x300
windows appearing on restore. The root cause is non-atomic Map operations during
state transitions, missing transaction-level logging, and snapshot lifecycle
timing issues. These problems were introduced in v1.6.3 when cross-tab sync was
refactored and persist through v1.6.4.12 despite multiple attempted fixes.

## Issues Overview

| Issue | Component                    | Severity     | Root Cause                                                  |
| ----- | ---------------------------- | ------------ | ----------------------------------------------------------- |
| 1     | Map size corruption          | **Critical** | Non-atomic delete+set sequence in restore flow              |
| 2     | 73-second logging gap        | **Critical** | No Map contents logging during operations                   |
| 3     | Duplicate windows on restore | **High**     | Snapshot not cleared atomically, reused by second restore   |
| 4     | Debounce timer corruption    | **High**     | Generation counter skips ALL timers during rapid operations |
| 5     | Missing storage write logs   | **Medium**   | No transaction sequencing visibility                        |

**Why bundled:** All issues stem from the async timing gap between
`renderedTabs.delete()` and `renderedTabs.set()` during restore operations. They
share the same architectural context (UICoordinator → MinimizedManager →
VisibilityHandler flow) and can be fixed with coordinated changes.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` (Map operation logging, atomic transactions)
- `src/features/quick-tabs/minimized-manager.js` (snapshot lifecycle)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (debounce generation counter)
- `src/utils/storage-utils.js` (transaction sequencing logs)

**Do NOT Modify:**

- `src/background/` (out of scope - background script working correctly)
- `src/content.js` (message handlers working correctly)
- `manifest.json` (configuration not affected) </scope>

---

## Issue 1: Map Size Corruption During Restore

**Problem:**  
When restoring a minimized Quick Tab, the `renderedTabs.size` unexpectedly
becomes 0 instead of the expected count minus one, triggering the sanity check
error at UICoordinator.js line 156: "CRITICAL: Map unexpectedly empty after
single delete!"

**Root Cause:**

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_handleRestoreOperation()`, lines 839-875  
**Issue:** The restore flow executes `renderedTabs.delete(quickTab.id)` at line
864 to "force fresh render path," then calls `this.render(quickTab)` which
eventually calls `renderedTabs.set(quickTab.id, tabWindow)`. During the timing
gap between delete and set, if another async operation (like a second
minimize/restore or a `_safeClearRenderedTabs()` call) reads the Map, it sees an
inconsistent intermediate state where the entry is missing.

**Why this causes corruption:**  
JavaScript Map operations are synchronous, but multiple async operations can be
in-flight simultaneously. The Map has no built-in transaction support, so:

1. Operation A calls `delete(id1)` → Map size drops from 2 to 1
2. Operation B (concurrent) calls `delete(id2)` → Map size drops from 1 to 0
3. Operation A completes `render()` and calls `set(id1)` → Map size becomes 1
4. But Operation B never completes `set()` because it saw Map was empty and
   bailed out

**Evidence:**  
The sanity check at line 156 specifically detects this: when `mapSizeBefore > 1`
but `this.renderedTabs.size === 0` after a single delete, multiple entries were
removed when only one was expected.

**Fix Required:**  
Make Map delete+set sequences atomic by wrapping them in a transaction helper
that prevents other operations from reading/writing the Map during the critical
section. The transaction should capture the Map state before modifications,
perform all changes, then validate the final state matches expectations. Follow
the pattern established in `storage-utils.js` with `beginTransaction()` /
`commitTransaction()` / `rollbackTransaction()`.

---

## Issue 2: 73-Second Logging Gap During State Transitions

**Problem:**  
During minimize/restore operations, logs show activity at timestamp T, then
nothing until T+73 seconds, making it impossible to diagnose what happened
during the gap. The next log entry shows the Map in an inconsistent state with
no record of intermediate operations.

**Root Cause:**

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Multiple methods including `_safeDeleteFromRenderedTabs()` (lines
117-132), `_safeClearRenderedTabs()` (lines 133-169), `update()` (lines
686-924)  
**Issue:** Current logging only captures Map size before/after operations, not
the contents (which IDs are present). When corruption occurs, logs show
"mapSizeBefore: 2, mapSizeAfter: 0" but don't reveal WHICH IDs were in the Map
or what operations were attempted during the gap.

**Why this creates diagnostic blindness:**  
Between log entries, multiple async operations can execute:

- Minimize operation removes entry from Map
- Restore operation deletes then re-adds entry
- Another restore operation runs concurrently
- DOM monitoring timer fires and checks Map state
- Storage write completes and triggers event

None of these intermediate steps log the Map contents, only the sizes. When the
Map becomes corrupted (size 0 when it should be 1), there's no record of which
operation removed which ID.

**Fix Required:**  
Add Map contents logging to every operation that reads or modifies
`renderedTabs`. Log should include:

- Current Map keys as array: `mapKeys: ['qt-123', 'qt-456']`
- Operation being performed: `operation: 'delete'`
- ID being operated on: `targetId: 'qt-123'`
- Timestamp with millisecond precision: `timestamp: Date.now()`
- Call stack depth to detect recursive calls:
  `stackDepth: new Error().stack.split('\n').length`

This creates a complete audit trail showing which operations touched the Map and
in what order.

---

## Issue 3: Duplicate 400x300 Windows on Rapid Restore

**Problem:**  
When a minimized Quick Tab is restored, then minimized again, then restored a
second time rapidly (within 400ms), two windows appear: one with the correct
saved dimensions and one default 400x300 window. Both have the same Quick Tab ID
but different DOM elements.

**Root Cause:**

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `restore()` method, lines 94-184, and `clearSnapshot()` method,
lines 194-246  
**Issue:** The snapshot clearing has a 400ms delay (`SNAPSHOT_CLEAR_DELAY_MS` in
UICoordinator.js line 66). The flow is:

1. First restore: `minimizedManager.restore(id)` applies snapshot, UICoordinator
   renders window
2. Snapshot stays in `minimizedTabs` Map for 400ms grace period (v1.6.3.4-v5
   change)
3. User minimizes again before 400ms elapsed: new snapshot is added to SAME Map
   entry (overwrites)
4. Second restore (at 200ms): `minimizedManager.restore(id)` finds snapshot,
   applies it
5. UICoordinator calls `render()` which creates NEW window
6. Original snapshot clear timer (from first restore) fires at 400ms, clears
   snapshot
7. But SECOND snapshot was never cleared, so `hasSnapshot()` still returns true
8. Race condition: Second `render()` sees no existing `renderedTabs` entry (due
   to Issue 1) and creates duplicate

**Why this creates duplicates:**  
The snapshot is the "source of truth" for a minimized tab's dimensions. When
rapid minimize/restore happens:

- Snapshot from first restore is not atomically cleared
- Second minimize overwrites snapshot with new position/size
- Second restore reads the new snapshot
- Both restores call `render()` which checks `renderedTabs.has(id)` - if false,
  creates new window
- Due to Issue 1's race condition, `has()` returns false for second restore even
  though first restore added entry

**Fix Required:**  
Implement "clear-on-first-use" atomic pattern. When `restore()` is called,
immediately delete the snapshot from `minimizedTabs` Map BEFORE applying it to
the window instance. Store the snapshot in a local variable for the current
operation. This ensures a second concurrent `restore()` call will NOT find a
snapshot and will correctly identify it as an invalid operation.

Additionally, add a restore-in-progress flag per Quick Tab ID to reject
duplicate restore operations entirely. Use the existing `RESTORE_IN_PROGRESS`
Set in UICoordinator.js (line 65) but extend the lock duration from 500ms to
match the snapshot clear delay.

---

## Issue 4: Debounce Timer Generation Counter Skips Persist

**Problem:**  
When minimize/restore operations happen rapidly (3+ times within 200ms), the
debounced storage persist never executes. Timer callbacks check generation
counters, find mismatches, and skip execution, leaving state unpersisted.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_debouncedPersist()` method, lines 597-687  
**Issue:** The generation counter pattern increments on each call. If operations
happen at:

- T+0ms: minimize, generation=1, schedule timer for T+200ms
- T+50ms: restore, generation=2, schedule timer for T+250ms
- T+100ms: minimize again, generation=3, schedule timer for T+300ms

When timers fire:

- T+200ms: Timer 1 checks generation (now 3), sees mismatch (expected 1), skips
- T+250ms: Timer 2 checks generation (now 3), sees mismatch (expected 2), skips
- T+300ms: Timer 3 checks generation (now 3), matches, executes

**Why this fails:**  
The pattern assumes only ONE timer is active at a time. But the code at line 614
only clears the `existingTimer` for the CURRENT operation, not previous timers
that are already scheduled. So all three timers remain scheduled, but only the
LAST one executes.

This breaks persistence in the scenario:

- User minimizes → Timer 1 scheduled (gen=1)
- User restores → Timer 2 scheduled (gen=2), clears Timer 1
- User minimizes → Timer 3 scheduled (gen=3), clears Timer 2
- Timer 3 fires and persists "minimized" state
- User restores again → Timer 4 scheduled (gen=4), clears Timer 3
- Timer 4 checks gen (now 4), matches, but `_pendingMinimize` and
  `_pendingRestore` flags were cleared by Timer 3
- Persist happens but with stale flags, writes wrong state

**Fix Required:**  
Change the generation counter logic to track WHICH timers are active, not just
increment a counter. Maintain a Set of active timer IDs:

When scheduling a new timer:

1. Generate unique timer ID: `timerXXXX`
2. Add to `_activeTimers` Set
3. When timer fires, check if its ID is still in the Set
4. Remove from Set after execution

This ensures only timers that were EXPLICITLY cancelled (by clearTimeout) skip
execution. Timers that were simply superseded by newer operations still execute,
but their flags will be cleared by the time they run.

---

## Issue 5: Missing Storage Write Sequencing Logs

**Problem:**  
When multiple storage writes happen concurrently (e.g., minimize → resize →
focus all within 200ms), logs show writes completing but don't indicate their
ORDER or which write corresponds to which operation. This makes it impossible to
verify the FIFO queue is working correctly.

**Root Cause:**

**File:** `src/utils/storage-utils.js`  
**Location:** `persistStateToStorage()` method, lines 556-656, and
`_executeStorageWrite()` method, lines 537-582  
**Issue:** Current logging at line 569 shows: "Storage write STARTED [txn-123]",
then at line 570 shows pending count, but doesn't log:

- WHICH operation initiated the write (minimize vs. restore vs. focus)
- What the PREVIOUS completed transaction was
- How many writes are queued BEHIND this one

**Why this hides bugs:**  
The FIFO queue (`storageWriteQueuePromise`) ensures writes are serialized, but
if a write fails and resets the queue (v1.6.3.4-v10 change at line 526),
subsequent writes start fresh. Without sequencing logs, you can't detect:

- Write A starts
- Write B queued behind A
- Write A fails, resets queue
- Write B starts (but should have been cancelled because A failed)
- Write B completes with stale data

**Fix Required:**  
Add transaction sequencing logs that show the relationship between writes:

When a write starts:

- Log the previous completed transaction ID: `prevTransaction: 'txn-122'`
- Log the queue depth: `queueDepth: 3`

When a write completes:

- Log success/failure and update `lastCompletedTransactionId`
- Log how many writes are still pending: `remainingWrites: 2`

When queue is reset (after failure):

- Log: "Queue RESET after failure [txn-124] - X pending writes dropped"

This creates a complete audit trail showing write ordering and queue state.

---

## Shared Context

### Map Operations Are Not Atomic

The `renderedTabs` Map is a JavaScript `Map` object with no built-in transaction
support. The pattern throughout UICoordinator:

```
this.renderedTabs.delete(id);  // Step 1: Remove old entry
// ... do work ...
this.renderedTabs.set(id, newWindow);  // Step 2: Add new entry
```

Has a timing gap between steps where other operations can observe inconsistent
state. This pattern appears in:

- `_handleRestoreOperation()` lines 864-875
- `_handleDetachedDOMUpdate()` lines 1151-1169
- `_restoreExistingWindow()` (implicit via render() call)

### Snapshot Lifecycle Timing

The 400ms delay for clearing snapshots (UICoordinator.js line 66,
`SNAPSHOT_CLEAR_DELAY_MS`) creates a window where:

- Snapshot exists in MinimizedManager
- But tab is no longer minimized (entity.minimized = false)
- Second minimize can overwrite snapshot
- Second restore can read overwritten snapshot
- Both operations think they have exclusive access

### Debounce Delays and Event Storms

The codebase has multiple debounce delays:

- `MINIMIZE_DEBOUNCE_MS = 200` (VisibilityHandler.js line 28)
- `STATE_EMIT_DELAY_MS = 100` (VisibilityHandler.js line 37)
- `SNAPSHOT_CLEAR_DELAY_MS = 400` (UICoordinator.js line 66)
- `RESTORE_LOCK_MS = 500` (UICoordinator.js line 65)

When operations happen faster than these delays, timers pile up and race
conditions occur. The generation counter pattern in `_debouncedPersist()`
attempts to solve this but has a logic flaw (Issue 4).

<acceptancecriteria>

**Issue 1:**

- Restore operation never causes `renderedTabs.size` to become 0 unexpectedly
- Sanity check at UICoordinator.js line 156 never fires
- Map size transitions follow expected pattern: delete reduces by 1, set
  increases by 1

**Issue 2:**

- Every Map operation logs its contents (array of IDs present)
- No logging gap exceeds 5 seconds during active operations
- Logs show which operation touched Map and in what order

**Issue 3:**

- Restoring minimized tab creates exactly ONE window
- Second restore within 400ms is rejected (no snapshot available)
- Snapshot is cleared atomically when first restore begins

**Issue 4:**

- Rapid minimize/restore (3+ operations within 200ms) results in storage persist
- Generation counter allows at least ONE timer to execute
- Pending flags (`_pendingMinimize`, `_pendingRestore`) are cleared correctly

**Issue 5:**

- Storage write logs show transaction sequence: "After [txn-122], starting
  [txn-123]"
- Queue depth is visible: "3 writes pending"
- Queue reset events are logged with count of dropped writes

**All Issues:**

- All existing tests pass
- No new console errors or warnings
- Manual test: minimize → restore → minimize → restore rapidly (100ms between
  ops)
  - Expected: Single window appears, correct dimensions, storage persists final
    state

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Issue 1: Log Evidence - Map Size Mismatch</summary>

From actual extension logs (sanitized):

```
[UICoordinator] renderedTabs.delete(): { id: 'qt-abc', reason: 'restore operation cleanup', mapSizeBefore: 2, mapSizeAfter: 1 }
[UICoordinator] Update decision: restore via unified fresh render path
[UICoordinator] Creating new window instance: qt-abc
... [73-second gap] ...
[UICoordinator] CRITICAL: Map unexpectedly empty after single delete! { id: 'qt-def', reason: 'restore operation cleanup', mapSizeBefore: 1 }
[UICoordinator] renderedTabs.size = 0 (expected 0 or more)
```

The gap shows Map went from size 1 to size 0, but no operation logged the
deletion of the entry. This indicates a concurrent operation removed the entry
without logging.

</details>

<details>
<summary>Issue 2: Missing Operation Trace</summary>

Current logs show:

```
[VisibilityHandler] Minimize button clicked (source: UI) for Quick Tab: qt-123
[UICoordinator] Tab already rendered and DOM attached: qt-123
[MinimizedManager] Added minimized tab with snapshot: { id: 'qt-123', savedPosition: {...}, savedSize: {...} }
... [73-second gap] ...
[UICoordinator] renderedTabs.size = 0
```

What's missing:

- Did `update()` get called during the gap? What was the source?
- Did `_handleManagerMinimize()` delete the entry? When?
- Did `_safeClearRenderedTabs()` get called? By whom?
- What was the Map contents at each step?

Without these logs, the gap is a black box.

</details>

<details>
<summary>Issue 3: Duplicate Window Creation Evidence</summary>

User report: "After minimize then restore twice quickly, I see two YouTube Quick
Tabs at different positions. One is at my saved position (top-left), the other
is at default position (100, 100) with default size (400x300)."

Analysis:

- First restore: Uses snapshot → renders at saved position
- Second restore (before snapshot cleared): Uses SAME snapshot → renders at
  saved position AGAIN
- But first restore's render() added entry to Map
- Second restore's `_handleRestoreOperation()` deletes that entry (line 864)
- Second restore's render() sees no existing entry, creates new window
- Race condition: Both windows have same ID but different DOM elements
- Only one entry in Map (second window) but TWO `.quick-tab-window` elements in
  DOM

</details>

<details>
<summary>Issue 4: Timer Execution Pattern</summary>

Trace of generation counter with rapid operations:

```
T+0ms: handleMinimize('qt-123') called
  generation = 1
  Schedule timer for T+200ms

T+50ms: handleRestore('qt-123') called
  generation = 2
  Clear previous timer (generation 1)
  Schedule timer for T+250ms

T+100ms: handleMinimize('qt-123') called
  generation = 3
  Clear previous timer (generation 2)
  Schedule timer for T+300ms

T+200ms: [Timer from T+0 already cleared, doesn't fire]

T+250ms: [Timer from T+50 already cleared, doesn't fire]

T+300ms: Timer callback fires
  currentGeneration = 3, timerGeneration = 3
  Match! Execute persist.
```

Problem: User expects persist after EACH operation, but only the LAST operation
persists. If the last operation was "minimize" but user intended "restore,"
final state is wrong.

</details>

<details>
<summary>Issue 5: Storage Write Queue Visibility</summary>

Current logs:

```
[VisibilityHandler] Storage write STARTED [txn-789]
[StorageUtils] Persisting 2 tabs (1 minimized) [txn-789]
[StorageUtils] Storage write COMPLETED [txn-789] (2 tabs)
```

What's missing:

- Was there a previous write? What was its transaction ID?
- Are there writes queued behind this one? How many?
- If this write fails, what happens to queued writes?

Enhanced logs should show:

```
[StorageUtils] Storage write queued: { pending: 3, transaction: 'txn-789' }
[StorageUtils] Storage write executing: { transaction: 'txn-789', prevTransaction: 'txn-788', pendingCount: 2, tabCount: 2 }
[StorageUtils] Storage write COMPLETED [txn-789] | Queue depth: 2 remaining
```

This shows the write is third in queue, follows txn-788, and leaves 2 writes
pending.

</details>

---

**Priority:** Critical (Issues 1-3), High (Issue 4), Medium (Issue 5)  
**Target:** Single coordinated fix addressing all issues  
**Estimated Complexity:** High - requires architectural changes to Map
operations and snapshot lifecycle
