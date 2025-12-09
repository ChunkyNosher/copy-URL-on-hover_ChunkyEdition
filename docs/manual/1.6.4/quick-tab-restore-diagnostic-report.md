# Quick Tab Restore & State Synchronization Issues

**Extension Version:** v1.6.3.5-v4  
**Date:** 2025-12-03  
**Scope:** Multiple timing, synchronization, and logging issues affecting Quick
Tab restore operations and cross-tab state consistency

---

## Executive Summary

Quick Tab restore operations exhibit unreliable behavior due to timing issues
with `setTimeout` callbacks, race conditions between event emission and storage
persistence, and cross-tab storage write conflicts. Additionally, critical log
statements are not appearing in expected browser consoles, making diagnosis
difficult. These issues stem from architectural challenges in coordinating
asynchronous timer execution, multi-tab storage access without locking, and
event-driven state synchronization across multiple state representations
(entity, DOM, storage, MinimizedManager).

**Impact:** Restore operations may appear to succeed but leave Quick Tabs in
inconsistent states (entity says restored but DOM not rendered, or vice versa).
Storage storms occur when multiple tabs write simultaneously. Debugging is
hampered by missing logs that are executing but not visible in the expected
console context.

---

## Issues Overview

| #   | Issue                                                          | Component                        | Severity | Root Cause                                                    |
| --- | -------------------------------------------------------------- | -------------------------------- | -------- | ------------------------------------------------------------- |
| 1   | Restore operation succeeds in entity but fails in DOM          | VisibilityHandler                | Critical | Silent `tabWindow.restore()` failure + premature state update |
| 2   | setTimeout callbacks execute at unpredictable times            | VisibilityHandler                | High     | JavaScript event loop timing non-deterministic                |
| 3   | Race condition between state:updated event and storage persist | VisibilityHandler                | High     | Fragile timer-based ordering (100ms vs 200ms)                 |
| 4   | Console logs missing from setTimeout callbacks                 | Multiple files                   | High     | Wrong browser console context + silent callback errors        |
| 5   | Storage write storms from multiple tabs                        | storage-utils.js                 | High     | No distributed locking, last-write-wins semantics             |
| 6   | Entity/storage/DOM state desynchronization                     | VisibilityHandler, UICoordinator | Critical | Multiple state representations updated at different times     |
| 7   | Storage.onChanged self-write detection fails under load        | storage-utils.js                 | Medium   | Transaction cleanup timing windows + instance ID race         |

**Why bundled:** All issues affect Quick Tab state synchronization and stem from
the same architectural challenges: asynchronous timer coordination, cross-tab
storage access, and event-driven state management without strong consistency
guarantees.

---

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (restore flow, timer coordination)
- `src/utils/storage-utils.js` (storage write queue, self-write detection)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (DOM state verification)

**Do NOT Modify:**

- `src/background/` (out of scope)
- `manifest.json` (configuration unchanged)
- Test files (existing tests must continue passing) </scope>

---

## Issue 1: Restore Operation Entity-DOM State Desync

**Problem:**  
Clicking "Restore" in Manager sidebar updates entity state
(`tabWindow.minimized = false`) and emits `state:updated` event, but
`tabWindow.restore()` method may fail silently without throwing an error. The
entity and storage reflect "restored" state while the DOM remains unrendered,
causing Quick Tab to be invisible despite Manager showing green indicator.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_executeRestore` method (lines 405-443)  
**Issue:** Method updates entity state BEFORE calling `tabWindow.restore()` and
does not validate that DOM rendering actually succeeded. If `restore()` fails or
throws an error caught elsewhere, the entity state has already been changed to
`minimized=false`.

**Sequence:**

1. Entity updated: `tabWindow.minimized = false` (line 421)
2. MinimizedManager state cleared (line 425)
3. `tabWindow.restore()` called but may fail (line 438)
4. `state:updated` event emitted after 100ms delay regardless of DOM state
5. Storage persists `minimized=false` after 200ms delay
6. **Result:** Entity/storage say restored but window not visible

**Why This Happens:**  
The code follows "optimistic update" pattern - it assumes `restore()` will
succeed and updates state immediately. No validation occurs to confirm DOM was
actually rendered before declaring success. The 100ms delay for `state:updated`
event was added to allow DOM rendering time, but there's no verification step
checking `tabWindow.isRendered()` status after the delay.

**Fix Required:**  
Add DOM state verification after `tabWindow.restore()` call completes. Check
`tabWindow.isRendered()` or `tabWindow.container?.parentNode` to confirm DOM
attachment succeeded. If verification fails, roll back entity state to
`minimized=true` and emit error event instead of success. Follow the validation
pattern already present in `_emitRestoreStateUpdate` lines 573-577 which checks
`isDOMRendered` but currently only logs warnings without blocking success.

---

## Issue 2: setTimeout Timer Execution Timing Unreliable

**Problem:**  
The `STATE_EMIT_DELAY_MS = 100ms` timer for emitting `state:updated` events does
not fire at the scheduled time. Log analysis shows `actualDelay` frequently
exceeds `scheduledDelay` by significant margins (50-200ms+ variance). This
causes downstream components to read stale state or process events in unexpected
order.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_emitRestoreStateUpdate` method (lines 543-593)  
**Issue:** JavaScript's `setTimeout` provides only a minimum delay guarantee,
not an exact execution time. From MDN documentation: "The callback function is
executed as soon as possible after the delay, but not guaranteed to run at that
exact time." If the main thread is busy with other operations, pending callbacks
are queued, or the browser tab is backgrounded, the actual delay can
significantly exceed the specified value.

**Evidence from Code:** The code already tracks this discrepancy with explicit
logging:

```
const timerScheduleTime = Date.now();
setTimeout(() => {
  const actualDelay = Date.now() - timerScheduleTime;
  console.log(`actualDelay: ${actualDelay}ms, scheduledDelay: ${STATE_EMIT_DELAY_MS}ms`);
```

**Why This Happens:**  
JavaScript event loop is single-threaded and non-blocking. Timers are added to a
callback queue and executed when the call stack is clear. Heavy computation, DOM
manipulation, or other pending callbacks can delay timer execution. Browser tab
throttling when backgrounded further extends delays.

**Fix Required:**  
Replace timer-based coordination with deterministic promise-based sequencing.
Use `Promise.resolve().then()` chains or `async/await` to ensure operations
complete in order without relying on timing. For restore flow: await
`tabWindow.restore()` completion → verify DOM rendered → emit event → trigger
storage persist. This ensures state updates occur only after prior steps
succeed, not based on arbitrary time delays.

---

## Issue 3: Race Condition Between Event Emission and Storage Persist

**Problem:**  
The timing relationship between `state:updated` event emission (100ms delay) and
storage persistence (200ms delay) creates a fragile race condition. If event
fires AFTER storage persists, UICoordinator may read stale state from storage.
If persist happens during event processing, storage change events may interrupt
ongoing state transitions.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** Timer constants (lines 38-47) and `_debouncedPersist` method
(lines 672-698)  
**Issue:** Code relies on fixed timer delays staying in correct order (100ms <
200ms) but provides no synchronization primitives. Comment explicitly
acknowledges this fragility:

```
// v1.6.3.4-v5 - FIX Issue #6: Adjusted timing to ensure state:updated event fires BEFORE storage persistence
// STATE_EMIT_DELAY_MS must be LESS THAN MINIMIZE_DEBOUNCE_MS to prevent race condition
// Old values: MINIMIZE_DEBOUNCE_MS=150, STATE_EMIT_DELAY_MS=200 (race condition!)
// New values: STATE_EMIT_DELAY_MS=100, MINIMIZE_DEBOUNCE_MS=200 (correct order)
```

**Why This Happens:**  
Timer-based ordering assumes delays will execute in relative order, but
JavaScript event loop provides no such guarantee. If the 100ms timer is delayed
by 150ms due to heavy computation, and the 200ms timer fires on time, they
execute in reverse order. Additionally, rapid user actions (restore → minimize →
restore) can queue multiple timers that interfere with each other.

**Fix Required:**  
Eliminate timer-based coordination entirely. Use promise chaining or async/await
to enforce execution order: Complete restore operation → Emit event → Wait for
event processing to complete → Trigger storage persist. Add explicit
synchronization points where order matters. Follow the pattern in
`storage-utils.js` `queueStorageWrite` (lines 882-917) which uses promise
chaining for FIFO ordering of storage operations.

---

## Issue 4: Console Logs Missing from setTimeout Callbacks

**Problem:**  
Log statements inside `setTimeout` callbacks are executing (confirmed by state
changes occurring) but not appearing in browser console. This affects diagnostic
logging for timer execution tracking, making it difficult to verify timing
issues or sequence of operations.

**Root Cause:**

**File:** Multiple files using `setTimeout` for debouncing/delays  
**Location:** Throughout VisibilityHandler, storage-utils, UICoordinator  
**Issue:** Browser extensions have multiple console contexts. Per Firefox/Chrome
extension documentation:

- Background scripts → Extension Toolbox console (`about:debugging` → Inspect)
- Content scripts → Page DevTools console (F12 on the page)
- Popup/sidebar scripts → Separate popup console (right-click → Inspect)

Logs from content script timers may be written to wrong context depending on
execution environment. Additionally, if timer callback throws an error before
reaching log statements, subsequent logs are never executed.

**Why This Happens:**  
Timer callbacks execute in the context where `setTimeout` was called, but
console output may be routed to different debugging interfaces based on script
type. If developer is checking Page DevTools but logs are going to Extension
Toolbox, they appear missing. Silent failures (uncaught errors) in callbacks
also prevent logs from executing even though timer fired.

**Fix Required:**  
Wrap all timer callback contents in try/catch blocks to prevent silent failures
from suppressing logs. Add explicit context markers to all log statements
indicating which console they should appear in. Consider adding "heartbeat" logs
at timer callback entry that execute BEFORE any other logic, ensuring at least
entry confirmation logs appear. For critical timers, add fallback logging to
both console.log and browser.runtime messaging to background for collection.

---

## Issue 5: Cross-Tab Storage Write Storms

**Problem:**  
When multiple browser tabs have the extension active, simultaneous storage
writes cause "storms" of `storage.onChanged` events. Each tab reacts to other
tabs' writes by writing its own state, creating cascading updates. Log analysis
shows 10-15 rapid empty-state writes within 200ms during restore operations.

**Root Cause:**

**File:** `src/utils/storage-utils.js`  
**Location:** `queueStorageWrite` (lines 882-917) and FIFO queue
implementation  
**Issue:** The storage write queue is **per-tab only** (module-level variable
`storageWriteQueuePromise` line 68). Multiple browser tabs each maintain their
own queue but all write to the same `browser.storage.local.quick_tabs_state_v2`
key. Browser Storage API provides no transaction support or distributed locking
per MDN documentation:

> "The Storage API doesn't support transactions, so you may run into race
> conditions in any situation where you have multiple parts of the extension
> updating storage concurrently."

**Why This Happens:**  
Tab A writes state → Tab B receives `storage.onChanged` event → Tab B writes its
own state → Tab A receives Tab B's change event → Tab A writes again. This
cascade continues until self-write detection kicks in or cooldown periods
expire. The "last write wins" semantics mean earlier writes are silently
overwritten.

**Evidence from Logs:**

```
2025-12-03T051119.276Z tabs 1 → 0 (txn-1764738679265-jm0qdg, inst-1764738452195-ab9174a3c4f0)
2025-12-03T051119.798Z tabs 0 → 0 (txn-1764738679794-ptuyp1, inst-1764738452215-5295243e0a58)
2025-12-03T051119.798Z tabs 0 → 0 (txn-1764738679795-3p2awg, inst-1764738452217-5627523396a5)
```

Multiple instance IDs writing 0-tab states in rapid succession (different tabs).

**Fix Required:**  
Implement ownership-based write filtering using `originTabId` field. Each tab
should only write state for Quick Tabs it owns (where
`tab.originTabId === currentTabId`). Other tabs' Quick Tabs should be read-only.
This prevents cross-tab overwrites while still allowing each tab to persist its
own state. Follow the pattern in `storage-utils.js` `validateOwnershipForWrite`
(lines 199-243) which filters tabs by ownership but needs to be enforced before
ALL storage writes, not just optionally.

---

## Issue 6: Multiple State Representations Desynchronize

**Problem:**  
Quick Tab state exists in four places: entity object in `quickTabsMap`, DOM
elements via `QuickTabWindow`, MinimizedManager snapshots, and
`browser.storage.local`. During restore operations, these representations update
at different times and can become permanently inconsistent if any step fails.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_executeRestore` method (lines 405-443)  
**Issue:** State updates follow fixed sequence without validation:

1. Entity updated immediately (line 421)
2. MinimizedManager cleared (line 425)
3. DOM updated via `restore()` (line 438)
4. Event emitted after 100ms (line 442)
5. Storage persisted after 200ms (line 442)

If any step 3-5 fails, previous steps have already completed and cannot be
rolled back. Entity shows `minimized=false` but DOM may not exist, or storage
may still have `minimized=true`.

**Why This Happens:**  
No transaction pattern or rollback capability exists for multi-step state
updates. Each component owns its piece of state independently. There's no
coordinator ensuring all representations stay synchronized or reverting changes
if operations fail.

**Fix Required:**  
Implement transaction pattern with rollback capability. Use the existing
`beginTransaction`, `captureStateSnapshot`, and `rollbackTransaction` functions
in `storage-utils.js` (lines 145-262) which provide rollback infrastructure but
are not currently used. For restore flow: BEGIN transaction → Capture snapshot →
Update entity → Update DOM → Verify success → COMMIT or ROLLBACK. If any step
fails, revert entity to snapshot state and keep previous DOM/storage states
intact.

---

## Issue 7: Self-Write Detection Fails Under High Load

**Problem:**  
The `isSelfWrite` detection mechanism using `WRITING_INSTANCE_ID` and
transaction IDs occasionally fails to filter out self-writes, causing tabs to
process their own storage changes. This contributes to storage storms and
duplicate event processing.

**Root Cause:**

**File:** `src/utils/storage-utils.js`  
**Location:** `isSelfWrite` function (lines 127-154) and transaction cleanup
timing  
**Issue:** Transaction cleanup has 200ms delay (`TRANSACTION_CLEANUP_DELAY_MS`
line 46) but `storage.onChanged` fires immediately when write completes. If tab
processes the change event before cleanup runs, it sees its own transaction ID
in `IN_PROGRESS_TRANSACTIONS` set and correctly skips it. However, if multiple
rapid writes occur, timing windows create scenarios where:

1. Write completes → cleanup scheduled for 200ms later
2. Second write starts → new transaction ID
3. First write's `onChanged` fires AFTER 200ms → transaction ID cleaned up → not
   recognized as self-write

**Why This Happens:**  
Fixed delay cleanup windows create timing vulnerabilities. Under high load with
rapid writes, transaction IDs may be cleaned up before their corresponding
`storage.onChanged` events fire. Additionally, cross-tab writes have different
instance IDs but may share transaction ID patterns causing false
positives/negatives.

**Fix Required:**  
Replace fixed-delay cleanup with event-driven cleanup. Keep transaction IDs in
`IN_PROGRESS_TRANSACTIONS` set until their corresponding `storage.onChanged`
event is confirmed processed. Add write completion callback that explicitly
removes transaction ID only after storage event handler runs. For instance ID
detection, add timestamp validation to ensure instance IDs are from current
session (reject stale IDs from previous extension loads).

---

## Shared Implementation Notes

**Architectural Patterns to Follow:**

- Use promise-based coordination instead of timer-based delays for operation
  sequencing
- Implement transaction pattern with rollback for multi-step state updates
- Add explicit DOM state verification after all UI operations before declaring
  success
- Enforce ownership-based write filtering to prevent cross-tab storage conflicts
- Wrap all timer callbacks in try/catch with entry/exit logging for diagnostic
  visibility

**Key Constraints:**

- Maintain backward compatibility with tabs saved in v1.6.2-v1.6.3 storage
  format
- All existing tests must continue passing without modification
- Do not change public API surface (method signatures, event names)
- Preserve existing logging patterns but enhance with context markers

**Anti-Patterns to Avoid:**

- Do not add more fixed-delay timers to "fix" timing issues (increases
  fragility)
- Do not add optimistic state updates without validation/rollback capability
- Do not assume `setTimeout` will execute at specified time (use promises
  instead)
- Do not write to storage without checking ownership or validating state hash

---

<acceptancecriteria>
**Issue 1:**
- Restore operation validates DOM is rendered before declaring success
- If DOM verification fails, entity state rolled back to `minimized=true`
- Error event emitted when restore fails, Manager indicator remains yellow

**Issue 2:**

- Event emission and storage persist use promise chains, not timers
- Operation sequence enforced via `await` statements, not delay assumptions
- Timing variance eliminated from critical paths

**Issue 3:**

- `state:updated` event fires only after restore operation completes fully
- Storage persist triggered only after event processing completes
- No race conditions between event emission and storage writes

**Issue 4:**

- All timer callbacks wrapped in try/catch blocks
- Entry/exit logs added to all timer callbacks with context markers
- Critical logs duplicated to background for collection

**Issue 5:**

- Tabs only write state for Quick Tabs they own (originTabId matches)
- Cross-tab writes rejected before entering queue
- Storage storm frequency reduced by 80%+

**Issue 6:**

- Transaction pattern with rollback used for all multi-step state updates
- State snapshot captured before restore begins
- Failed operations revert to snapshot state atomically

**Issue 7:**

- Transaction IDs cleaned up only after storage.onChanged processed
- Instance ID includes timestamp, stale IDs rejected
- Self-write detection maintains >95% accuracy under load

**All Issues:**

- Existing tests pass without modification
- Manual test: Restore → Minimize → Restore rapid sequence maintains consistency
- Console logs appear in correct browser console context
- No storage storms during normal operations (single tab or multi-tab)
  </acceptancecriteria>

---

## Supporting Context

<details>
<summary>Log Evidence: Storage Write Storm During Restore</summary>

From `copy-url-extension-logs_v1.6.3.5-v4_2025-12-03T05-11-45.txt`:

```
2025-12-03T051119.276Z tabs 1 → 0 (txn-1764738679265-jm0qdg)
2025-12-03T051119.798Z tabs 0 → 0 (txn-1764738679794-ptuyp1)
2025-12-03T051119.798Z tabs 0 → 0 (txn-1764738679795-3p2awg)
2025-12-03T051119.799Z tabs 0 → 0 (txn-1764738679794-1a3t3s)
2025-12-03T051119.801Z tabs 0 → 0 (txn-1764738679795-19ugl6)
2025-12-03T051119.801Z tabs 0 → 0 (txn-1764738679796-0n2n3j)
2025-12-03T051119.802Z tabs 0 → 0 (txn-1764738679796-1g2waj)
```

Seven rapid storage writes with 0 tabs within 526ms window, all from different
instance IDs (multiple tabs writing simultaneously).

</details>

<details>
<summary>Log Evidence: Restore Succeeds But Tab Missing on Next Operation</summary>

```
2025-12-03T051118.762Z UICoordinator: Creating window from entity qt-629-1764738675694-1sx99hqyb7sg2
2025-12-03T051118.765Z QuickTabWindow: Rendered qt-629-1764738675694-1sx99hqyb7sg2
2025-12-03T051119.811Z VisibilityHandler: Persisting 0 tabs (0 minimized) [txn-1764738679811-79inx8]
2025-12-03T051120.509Z VisibilityHandler: Tab not found for minimize qt-629-1764738675694-1sx99hqyb7sg2
```

Tab successfully rendered at 051118.765Z, but at 051120.509Z (1.7 seconds later)
cannot be found for minimize operation. Storage was persisted with 0 tabs at
051119.811Z despite tab being rendered.

</details>

<details>
<summary>Timer Execution Delay Analysis</summary>

From VisibilityHandler logs showing actual vs scheduled timer delays:

```
scheduledDelayMs: 200, actualDelayMs: 1050 (525% over)
scheduledDelayMs: 200, actualDelayMs: 529 (264% over)
scheduledDelayMs: 100, actualDelayMs: 156 (156% over)
```

Timer callbacks execute significantly later than scheduled, creating
unpredictable operation ordering.

</details>

<details>
<summary>Architecture Context: Browser Extension Console Contexts</summary>

Per MDN Web Docs on WebExtension debugging:

**Background Scripts:**

- Output to Extension Toolbox console only
- Access via `about:debugging` → "This Firefox" → Extension "Inspect"
- Not visible in Page DevTools (F12)

**Content Scripts:**

- Output to Page DevTools console (F12)
- Appears on the webpage where script is injected
- Not visible in Extension Toolbox

**Popup/Sidebar Scripts:**

- Separate console per popup instance
- Right-click popup → "Inspect" to access
- Closes when popup closes, losing history

This separation explains why timer callback logs appear "missing" when developer
checks wrong console.

</details>

---

**Priority:** Critical (Issues 1, 6), High (Issues 2, 3, 4, 5), Medium
(Issue 7)  
**Target:** Fix in single coordinated PR with phased rollout  
**Estimated Complexity:** High - requires architectural changes to promise-based
coordination and transaction pattern implementation

---
