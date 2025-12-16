# Quick Tabs State Synchronization: Multiple Critical Issues

**Extension Version:** v1.6.3.8+  
**Date:** 2025-12-14  
**Scope:** Cross-tab state synchronization, storage persistence, self-write
detection

---

## Executive Summary

The Quick Tabs feature has multiple interconnected issues affecting state
persistence, tab isolation, and message delivery. While the tabs API
implementation is correct, the state management layer has 6 critical problems
across storage validation, self-write detection, ownership filtering, and
container isolation. These issues cause state corruption, silent failures, and
cross-tab contamination in specific scenarios documented in issue-47-revised.md.
All issues share architectural context around storage.onChanged listener
reliability and transactional integrity.

---

## Issues Overview

| Issue | Component                   | Severity | Root Cause                                                 |
| ----- | --------------------------- | -------- | ---------------------------------------------------------- |
| 1     | Self-Write Detection        | Critical | Timing window mismatch and async calculation unreliability |
| 2     | Ownership Filtering         | High     | Empty write paradox blocks legitimate operations           |
| 3     | Promise Chain Contamination | Critical | Catch handler returns false instead of rejecting           |
| 4     | Storage Listener Latency    | High     | Firefox delays inconsistent with window constants          |
| 5     | Tab ID Race Condition       | Critical | GET_CURRENT_TAB_ID response format mismatch                |
| 6     | Container Isolation Gap     | Medium   | Container context not stored in Quick Tab data             |

---

## Issue 1: Self-Write Detection Timing Window Unreliable

**Problem:** Storage change events from the current tab are incorrectly
identified as external updates, causing duplicate operations and state
re-application.

**Root Cause:** File `src/content.js` lines 1473-1524 in
`_handleStorageChange()`. The self-write detection compares `Date.now()` at
storage listener callback time against `writeSinceWrite` timestamp captured
during write. Between the write and listener callback, async operations (Promise
microtask queue, garbage collection, event loop delays) cause timing
calculations to exceed the 300ms window defined in `src/constants.js`.

**Issue:** The deduplication window (`STORAGE_DEDUP_WINDOW_MS = 300`) assumes
synchronous execution between write and listener registration. In reality,
Firefox's storage.onChanged fires 100-250ms after write completion (per Bugzilla
#1554088). If ANY async operation occurs during this window, the
`timeSinceWrite` calculation becomes unreliable. Additionally, the actual
detection code checks `if (timeSinceWrite < 300)` but adds extra buffer logic
that makes the effective window ~400ms, not 300ms (Issue 19 coupling from
constants mismatch).

**Fix Required:** Replace timestamp-based detection with transaction ID
matching. The infrastructure already exists (`transactionId` field in state,
`lastWrittenTransactionId` tracking in storage-utils.js lines 1509-1510). Use
this deterministic check instead of timing window. Add multiple independent
detection layers: (1) transactionId match, (2) writingInstanceId match, (3)
writingTabId match. Fall through gracefully if all fail.

---

## Issue 2: Ownership Filtering Creates Empty Write Paradox

**Problem:** When a user closes all their Quick Tabs, the system blocks the
empty write unless `forceEmpty=true` flag is set, preventing legitimate cleanup.

**Root Cause:** File `src/utils/storage-utils.js` lines 1700-1760 in
`validateOwnershipForWrite()`. The function enforces: (1) filter tabs to only
those owned by current tab, (2) if result is empty, block write unless
`forceEmpty=true`. This creates a catch-22: a tab legitimately has 0 Quick Tabs
it owns, but cannot write empty state to storage without `forceEmpty`. The flag
is only set for "Close All" operations, not for normal tab cleanup.

**Issue:** The ownership model assumes tabs always have some Quick Tabs they
own. But a user can rightfully have NO Quick Tabs on their tab. When this
happens, the tab cannot update storage to reflect its empty state. The filter
correctly prevents non-owner tabs from corrupting storage, but overzealously
blocks legitimate empty writes. The `previouslyOwnedTabIds` Set (line 1513)
tries to detect ownership history, but initialization timing makes this
unreliable—if a tab loads before ANY Quick Tabs are created, it has no history
and cannot write empty state.

**Fix Required:** Separate "ownership validation" from "empty write validation."
The ownership check should determine IF a tab is allowed to write (not whether
it SHOULD write). An empty write from a tab with no owned Quick Tabs should be
permitted if the tab can prove it previously owned Quick Tabs (via
`previouslyOwnedTabIds`) OR if called from system cleanup operations. Implement
a "cleanup write" permission level distinct from ownership.

---

## Issue 3: Promise Chain Contamination in Storage Write Queue

**Problem:** Storage write failures propagate incorrectly through the Promise
chain, contaminating subsequent writes with stale error state.

**Root Cause:** File `src/utils/storage-utils.js` lines 2050-2070 in
`queueStorageWrite()`. The `.catch()` handler returns a rejected promise, but
before that, the code sets `storageWriteQueuePromise = Promise.resolve()` to
reset the queue. This creates an unhandled rejection: the previous Promise's
error is not caught, so it propagates to the next `.then()` handler in the
chain.

**Issue:** When write operation fails, the catch block attempts to reset the
queue by assigning `Promise.resolve()`. However, the actual Promise chain is:
`promise1.then(writeOp).catch(err => { reset queue; return rejected })`. The
returned rejection is NOT chained to the new `Promise.resolve()`, creating an
orphaned rejection that will fire when the current Promise settles. Next write
operation chains onto a resolved promise but the previous rejection is still
pending. Modern Promise implementations may log "Unhandled Rejection" warnings
or cause subsequent writes to behave unexpectedly.

**Fix Required:** Use proper Promise chain semantics. Instead of returning a
rejected promise in catch, return a successful promise that logs the error and
resets queue state. Or, chain the queue reset to the returned promise. The queue
assignment should be:
`storageWriteQueuePromise = storageWriteQueuePromise.then(...).catch(err => { queue reset; rethrow or handle gracefully })`.
Ensure no orphaned rejections.

---

## Issue 4: Storage Listener Latency Mismatch with Detection Window

**Problem:** Firefox fires storage.onChanged 100-250ms after write completes,
but deduplication code assumes 300ms is sufficient, creating a timing-dependent
detection failure.

**Root Cause:** File `src/constants.js` line 12 defines
`STORAGE_DEDUP_WINDOW_MS = 300`, and code in `src/content.js` adds a hardcoded
100ms buffer (line 1505-ish shows `timeSinceWrite < 300 + 100`), making
effective window 400ms. But Firefox docs (Bugzilla #1554088) state listener
fires 100-250ms AFTER write completes. The constants don't align with actual
Firefox behavior, and the buffer is inconsistently applied.

**Issue:** When storage.onChanged fires at 250ms after write, adding 100ms
buffer makes effective timeout 350ms, exceeding the 300ms constant. If multiple
storage events fire rapidly, timing can slip. Additionally, there's
inconsistency: constant says 300, code logic effectively uses 400, and actual
Firefox behavior is 100-250ms range. This creates scenarios where self-write
detection passes when it should fail, or fails when it should pass, depending on
browser load and timing.

**Fix Required:** Consolidate all timing constants. Define explicit values for:
(1) Firefox storage listener latency (100-250ms per docs), (2) buffer for edge
cases (+50ms), (3) total window for self-write detection (400ms). Use single
constant, not split across files. Alternatively, replace timing-based detection
entirely with transaction ID matching (fixes Issue 1 as well).

---

## Issue 5: GET_CURRENT_TAB_ID Response Format Mismatch

**Problem:** Content script expects tab ID responses in two different formats,
causing occasional failures when background script returns unexpected structure.

**Root Cause:** File `src/content.js` lines 1087-1113 in
`_initializeWritingTabId()` handles TWO response formats: legacy format
`{ success: true, tabId }` and new format `{ success: true, data: { tabId } }`.
The code checks for both: `response.data?.tabId || response.tabId`. However, the
corresponding background script handler in `src/background/message-handler.js`
needs verification—if it returns only one format and content expects the other,
initialization silently fails (currentWritingTabId remains null), blocking
ownership validation (Issue 2).

**Issue:** The dual-format handling suggests a migration between formats, but
it's incomplete. If background returns `{ success: true, data: { tabId: 42 } }`
and content expects `{ success: true, tabId: 42 }`, the OR operator
`response.data?.tabId || response.tabId` correctly falls back. However, if
response is malformed or neither format is present, there's no error
logging—initialization silently fails. Then `setWritingTabId()` never gets
called, leaving `currentWritingTabId = null`. This breaks ownership validation,
which has a fail-closed check at line 1810 in storage-utils.js: if tabId is
null, write is BLOCKED.

**Fix Required:** Standardize on a SINGLE response format. Pick either new or
legacy, update all callers. Add explicit validation: if response doesn't match
expected format, log error and fall back to null with warning (don't silently
fail). In storage-utils.js, when currentWritingTabId is null, attempt to
re-fetch it asynchronously instead of immediately blocking writes. This prevents
initialization race conditions from breaking the entire state system.

---

## Issue 6: Container Isolation Not Enforced at Storage Level

**Problem:** Firefox containers are not represented in Quick Tab data, so Quick
Tabs created in different containers appear in the same storage namespace,
causing cross-container contamination.

**Root Cause:** File `src/utils/storage-utils.js` lines 1370-1410 in
`serializeTabForStorage()` captures `originTabId` (numeric browser tab ID) but
ignores container context. Firefox containers are implicit in tab context, not
explicit IDs. A Quick Tab created in "Wikipedia in Personal Container" and
another in "Wikipedia in Default Container" both have different `tab.id` values
(Firefox creates new tab object per container), but if a user closes and reopens
the Personal container tab, its ID changes. The Quick Tab may now appear in the
Default container's view because container information is lost.

**Issue:** The storage schema assumes `originTabId` uniquely identifies the
owning tab across time. But Firefox containers can have the same URL with
different container IDs. When container tabs are closed and reopened, their tab
IDs change. The Quick Tab still references old `originTabId`, which may now
point to a different container tab or be invalid. Scenarios from
issue-47-revised.md (Container Isolation test case) show Quick Tabs leaking
between containers because the system has no way to know "this Quick Tab belongs
to Container 2, not Container 3."

**Fix Required:** Extend Quick Tab data structure to include container ID via
`tab.cookieStoreId` (available in Firefox 55+). When serializing for storage,
capture both `originTabId` AND `originContainerId`. When filtering Quick Tabs in
`getQuickTabsByOriginTabId()`, check both tab ID AND current container context.
Update hydration logic to only restore Quick Tabs that match both current tab ID
and container. This ensures container isolation at the data model level, not
just at the UI level.

---

## Shared Implementation Notes

All issues are interconnected through the storage layer:

- **Self-write detection (Issue 1)** must work reliably so that legitimate state
  changes aren't skipped. Improving this fixes cascading failures.
- **Ownership filtering (Issue 2)** must allow legitimate empty writes while
  preventing non-owner corruption. Currently it's too strict.
- **Promise chain (Issue 3)** must not lose errors or contaminate subsequent
  operations. Critical for write queue reliability.
- **Listener latency (Issue 4)** must have consistent, Firefox-validated
  constants. Currently split and inconsistent.
- **Tab ID initialization (Issue 5)** must complete reliably or fail with clear
  error. Currently silent failures break ownership checks.
- **Container isolation (Issue 6)** must store container context so Quick Tabs
  don't leak across containers.

---

<details>
<summary><strong>Acceptance Criteria</strong></summary>

**Issue 1 - Self-Write Detection**

- Self-writes detected within 100ms of actual listener callback
- No false positives (legitimate updates incorrectly marked as self-writes)
- Works reliably with tab switching and rapid state changes
- Timing window updates reflected in constants file

**Issue 2 - Ownership Filtering**

- Empty writes permitted when tab legitimately has 0 owned Quick Tabs
- Non-owner tabs still blocked from corrupting state
- Manual tests: create QT, close all QTs, verify storage updates
- Close All operation works without special forceEmpty flag

**Issue 3 - Promise Chain**

- No unhandled rejections in console logs
- Write failures don't contaminate subsequent writes
- Queue resets properly on error
- Manual test: trigger storage write failure, verify next write succeeds

**Issue 4 - Storage Latency**

- All timing constants consolidated in single file
- Effective window matches Firefox behavior (100-250ms + buffer = 350ms max)
- Constant mismatch (Issue 19) fixed and documented
- Self-write detection uses same constants as listener timeout

**Issue 5 - Tab ID Initialization**

- Response format standardized across background and content
- Initialization failure logged with actionable error message
- Tab ID fetch retried asynchronously if initial attempt fails
- Ownership validation handles null tab ID gracefully

**Issue 6 - Container Isolation**

- Quick Tab data includes originContainerId field
- Hydration checks both tab ID and container context
- Manual test with multiple containers: QTs don't leak between containers
- Container-aware filtering in getQuickTabsByOriginTabId function

**All Issues**

- No console errors or warnings related to state sync
- Storage state remains consistent across tab reloads
- Manual test suite from issue-47-revised.md passes all scenarios
- Performance: state updates complete within 200ms

</details>

---

<details>
<summary><strong>Issue 1 - Detailed Evidence</strong></summary>

**Timing-Dependent Failure Mode:** The code at `src/content.js` line 1505
calculates `timeSinceWrite = now - writeTime`. This works only if `now` and
`writeTime` are captured at predictable moments. However:

1. Write happens in message handler (background context)
2. Promise resolves, triggering state update in handler (still background)
3. Message sent to content script via sendMessage IPC
4. Content script receives message in event loop
5. storage.onChanged event queued by Firefox
6. Event loop processes storage.onChanged callback
7. Callback calculates timeSinceWrite

Between step 6 and 7, if event loop is busy, garbage collection runs, or other
microtasks queue, the delay exceeds 300ms.

**Evidence from Logs:** Diagnostic output from the codebase shows
storage.onChanged fires 100-250ms after write (storage-utils.js line 1838
comment references Firefox Bugzilla #1554088). If self-write detection uses
300ms window, it's insufficient for slow machines.

**Constant Mismatch (Issue 19):** `STORAGE_DEDUP_WINDOW_MS = 300` in
constants.js, but actual code uses ~400ms effective window due to hardcoded
buffer.

</details>

---

<details>
<summary><strong>Issue 2 - Detailed Evidence</strong></summary>

**Ownership Filtering Logic:** Function `validateOwnershipForWrite()` at lines
1700-1760:

1. Filter tabs to owned only: `tabs.filter(t => t.originTabId === tabId)`
2. If result is empty AND forceEmpty is false: BLOCK
3. If previouslyOwnedTabIds.has(tabId) AND forceEmpty=true: ALLOW

**Paradox Scenario:**

- Tab A creates Quick Tab (Tab A added to previouslyOwnedTabIds)
- User closes Quick Tab via Close button
- Ownership check filters: finds 0 owned tabs
- Must write empty state to storage to reflect cleanup
- But write is blocked unless forceEmpty=true
- forceEmpty is only set for "Close All" manager action
- Regular Close operation cannot update storage with empty state

**Initialization Timing Race:** If tab loads BEFORE any Quick Tabs are created
anywhere:

- previouslyOwnedTabIds.has(tabId) returns false
- Tab has no ownership history
- Even if tab later creates a Quick Tab and closes it, cannot write empty state
- Because previouslyOwnedTabIds only populated AFTER first write

This is documented in storage-utils.js lines 1707-1710 comments about ownership
history tracking.

</details>

---

<details>
<summary><strong>Issue 3 - Detailed Evidence</strong></summary>

**Promise Chain Contamination Pattern:** At storage-utils.js line 2060-2070:

Current code structure:

```
storageWriteQueuePromise = storageWriteQueuePromise
  .then(() => writeOperation())
  .catch(err => {
    pendingWriteCount--;
    storageWriteQueuePromise = Promise.resolve();  // PROBLEM
    return Promise.reject(err);  // Orphaned rejection
  });
```

When writeOperation() fails:

1. .catch() handler executes
2. Queue reset assignment happens
3. But the returned Promise.reject(err) is NOT chained to the new
   Promise.resolve()
4. The rejection is returned to the caller but queue is reset to a resolved
   promise
5. Next write chains onto resolved promise, while previous rejection is still in
   flight

**Impact:**

- Unhandled Rejection warnings in DevTools
- Subsequent writes may behave unpredictably
- Queue semantics broken: writes not truly serialized

</details>

---

<details>
<summary><strong>Storage Architecture Context</strong></summary>

**Two-Layer Sync Pattern:** The architecture relies on two synchronization
mechanisms:

1. **tabs.sendMessage** (direct, ~50ms): Broadcasts state changes to all tabs
2. **storage.onChanged** (fallback, 100-250ms): Eventually consistent
   synchronization

When storage.onChanged fires, listener at `src/content.js` line 1473 processes
the event. This listener MUST detect self-writes (changes made by same tab) to
prevent re-applying own state. If detection fails:

- Tab re-applies its own state change
- May cause visual flicker
- May trigger cascading updates if state comparison changes

**Storage Write Sequence:**

1. Handler receives message (e.g., minimize action)
2. Reads current state from storage
3. Applies transformation (mark tab minimized)
4. Writes new state to storage
5. Calls broadcastStateToAllTabs to sync other tabs
6. Returns success to caller
7. Firefox fires storage.onChanged on all listening tabs
8. Each tab's listener receives event and must decide: is this my own change?

**Why Self-Write Detection Matters:** If detection fails, listener re-processes
same state change, which may:

- Trigger unnecessary UI updates
- Cause duplicate events to fire
- Lead to state inconsistency if transaction ID tracking fails

</details>

---

## Priority & Complexity

| Issue | Priority | Complexity | Dependencies                                            |
| ----- | -------- | ---------- | ------------------------------------------------------- |
| 1     | Critical | High       | Requires architectural change (transaction ID priority) |
| 2     | High     | Medium     | Ownership model refactor                                |
| 3     | Critical | Low        | Promise chain fix in one function                       |
| 4     | High     | Low        | Constant consolidation                                  |
| 5     | Critical | Medium     | Response format standardization                         |
| 6     | Medium   | Medium     | Schema extension for container ID                       |

---

## Notes for Implementation

1. **Fix Issue 3 First** - Promise chain contamination is easy and critical. Fix
   prevents data corruption.

2. **Then Fix Issue 5** - Tab ID initialization race condition must be resolved
   before ownership checks can be reliable.

3. **Then Fix Issue 2** - Once tab ID is reliable, ownership filtering can be
   properly implemented.

4. **Then Address Issue 1** - Transaction ID-based detection is the proper
   long-term solution. Requires refactoring self-write detection logic.

5. **Issue 4** - Consolidate timing constants alongside Issue 1 fix.

6. **Issue 6** - Container isolation requires schema change but is lower
   priority (affects edge cases with multi-container users).

7. **Testing** - Use scenarios from issue-47-revised.md to validate fixes.
   Scenario 14 (Container Isolation) validates Issue 6. Scenario 3 (Rapid State
   Changes) validates Issue 1.

</details>
