# Quick Tabs State Synchronization: Multiple Critical Issues

**Extension Version:** v1.6.3.5-v6  
**Date:** 2025-12-02  
**Scope:** Storage event loop race conditions, missing logging infrastructure,
and state corruption cascade

---

## Executive Summary

The Quick Tabs feature has multiple critical synchronization failures affecting
minimize/restore operations, Manager UI state display, and cross-tab
persistence. Root causes include: (1) circular `storage.onChanged` event
propagation creating write storms, (2) asynchronous event timing violations
where Promise resolution occurs before storage listeners fire, (3) missing
self-write detection allowing tabs to process their own storage writes as
external changes, and (4) comprehensive logging gaps preventing diagnosis of
event flow through StorageManager, UICoordinator rendering pipeline, and
MinimizedManager snapshot lifecycle. These issues were exposed when v1.6.3+
refactored cross-tab synchronization to rely on `browser.storage.onChanged`
without accounting for Firefox's asynchronous event delivery guarantees.

## Issues Overview

| #   | Component                     | Severity     | Root Cause                                        |
| --- | ----------------------------- | ------------ | ------------------------------------------------- |
| 1   | Storage Event Storm           | **Critical** | No self-write detection → circular propagation    |
| 2   | Promise/Event Race            | **Critical** | `storage.set()` resolves before `onChanged` fires |
| 3   | Event Loop Timing             | **High**     | Microtask/macrotask execution order chaos         |
| 4   | Missing StorageManager Logs   | **High**     | No visibility into `onChanged` event processing   |
| 5   | Missing UICoordinator Logs    | **High**     | No rendering pipeline visibility                  |
| 6   | Missing MinimizedManager Logs | **High**     | No snapshot lifecycle tracking                    |
| 7   | Missing Timer Callback Logs   | **Medium**   | `setTimeout` callbacks execute silently           |
| 8   | Firefox Event Behavior        | **Medium**   | `onChanged` may fire without actual data change   |

**Why bundled:** All issues affect Quick Tab state visibility and persistence;
share storage architecture context; stem from v1.6.3+ refactor introducing
`storage.onChanged`-based sync; can be fixed in coordinated PR with unified
logging and synchronization strategy.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (_debouncedPersist, _persistToStorage, _emitRestoreStateUpdate)
- `src/features/quick-tabs/managers/StorageManager.js` (presumed location - storage.onChanged handler)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (state:updated event handler, rendering pipeline)
- `src/features/quick-tabs/managers/MinimizedManager.js` (snapshot create/restore/clear operations)
- `background.js` (_handleQuickTabStateChange, transaction tracking)

**Do NOT Modify:**

- `src/content.js` (message handlers work correctly)
- `.github/` (configuration out of scope)
- Quick Tab entity classes (QuickTabWindow, UpdateHandler, DragController,
  ResizeController) </scope>

---

## Issue 1: Storage.onChanged Circular Event Storm

**Problem:**  
Content script writes to storage → triggers `storage.onChanged` in ALL tabs
including the writing tab → each tab processes event → may trigger another write
→ infinite loop creates write storm with 10+ storage operations in <500ms.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_debouncedPersist()` method (lines ~1083-1130)  
**Issue:** Method calls `browser.storage.local.set()` without marking the write
with tab-specific identifier. When `storage.onChanged` fires, there's no
mechanism to distinguish "this tab's write" from "another tab's write."

**File:** `background.js`  
**Location:** `_handleQuickTabStateChange()` (lines ~1387-1450)  
**Issue:** Receives ALL `storage.onChanged` events and updates
`globalQuickTabState` cache. Does NOT check if the write originated from
background script vs. content script. Only tracks `IN_PROGRESS_TRANSACTIONS` Set
for background's own writes (lines 1345-1349), not content script writes.

**File:** Presumed `src/features/quick-tabs/managers/StorageManager.js`  
**Location:** Unknown - file content not accessible  
**Issue:** Receives `storage.onChanged` events but lacks logging to show event
processing. No evidence of self-write filtering.

**Evidence from Logs:**

```
2025-12-03T01:04:20.018Z LOG VisibilityHandler Storage write STARTED txn-1764723860018-dnjep0
2025-12-03T01:04:20.019Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:21.229Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:21.261Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:21.301Z DEBUG Background Storage changed (local) quick_tabs_state_v2
[...15+ more storage.onChanged events within 1 second...]
```

**Fix Required:**  
Add tab instance identifier to every storage write payload (e.g.,
`writingTabId`, `writingInstanceId`). In `storage.onChanged` handlers
(background and StorageManager), compare writing identifier against current
tab's identifier - if match, SKIP processing (already have latest state
locally). This prevents circular propagation where Tab A's write triggers Tab
A's own `onChanged` handler.

**Reference Pattern:**  
Background script's `IN_PROGRESS_TRANSACTIONS` Set demonstrates intent but only
tracks background's own writes. Extend this pattern to ALL writes from ALL
sources (content scripts, background, sidebar).

---

## Issue 2: Promise Resolution Before storage.onChanged Fires

**Problem:**  
`browser.storage.local.set()` Promise resolves immediately, but
`storage.onChanged` listener fires in LATER event loop cycle. This creates race
condition where subsequent operations start before storage event propagates,
leading to stale data reads.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_persistToStorage()` method (presumed lines ~1100-1120)  
**Issue:** Method awaits `browser.storage.local.set()`, logs "Storage write
COMPLETED", then returns. Code assumes storage is synchronized across tabs at
this point. **FALSE ASSUMPTION** per Firefox Bugzilla #1554088: Promise resolves
BEFORE `onChanged` fires.

**File:** `background.js`  
**Location:** `_handleQuickTabStateChange()` (lines ~1387-1450)  
**Issue:** Handler may execute 50-200ms AFTER the storage write completed.
During this gap, another operation (e.g., restore from Manager) reads from
storage and gets stale cached state.

**Architectural Context:**  
Per MDN documentation on `browser.storage.local.set()`:

> "This is an asynchronous function that returns a Promise."

Per Firefox Bugzilla #1554088:

> "Promise returned by `browser.storage.local.set` is fulfilled BEFORE
> `storage.onChanged` listener is executed."

**Evidence from Logs:**

```
2025-12-03T01:04:20.018Z LOG VisibilityHandler Storage write COMPLETED txn-1764723860018-dnjep0 (2 tabs)
2025-12-03T01:04:20.019Z DEBUG Background Storage changed (local) quick_tabs_state_v2
```

Time gap: 1ms in this case, but can be 50-200ms under load. Next operation may
start at T+10ms, reading stale cache.

**Fix Required:**  
After `storage.local.set()` completes, add explicit synchronization barrier that
waits for ALL tabs' `storage.onChanged` handlers to acknowledge receipt.
Implement request/response pattern:

1. Writing tab calls `storage.set()` with unique `writeId`
2. Writing tab broadcasts "STORAGE_WRITE_PENDING" message to all tabs with
   `writeId`
3. Each tab's StorageManager processes `onChanged`, then sends "STORAGE_ACK"
   back with `writeId`
4. Writing tab waits for all ACKs (or timeout after 200ms)
5. Only then proceed with next operation

Alternatively, implement version numbers: increment on each write, readers wait
until they see expected version in `onChanged`.

---

## Issue 3: Event Loop Microtask/Macrotask Timing Chaos

**Problem:**  
Code mixes `setTimeout()` macrotasks with Promise microtasks without
coordination. `state:updated` event fires before storage persistence completes,
causing UICoordinator to render DOM before data is saved. If user switches tabs
rapidly, emergency save may be skipped.

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_emitRestoreStateUpdate()` method (line ~965)  
**Issue:** Uses
`setTimeout(() => { this.eventBus.emit('state:updated', ...) }, STATE_EMIT_DELAY_MS=100)`.
This queues event emission as MACROTASK.

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_debouncedPersist()` method (line ~1083)  
**Issue:** Uses
`setTimeout(async () => { await this._persistToStorage() }, MINIMIZE_DEBOUNCE_MS=200)`.
This queues persistence as MACROTASK.

**Architectural Context:**  
Per MDN documentation on Event Loop:

> "Promise callbacks are handled as a **microtask** whereas `setTimeout()`
> callbacks are handled as **task queues**."

**Execution Order:**

1. User clicks minimize → calls `handleMinimize()`
2. `_emitRestoreStateUpdate()` → schedules `state:updated` event for T+100ms
   (MACROTASK)
3. UICoordinator receives event → renders DOM immediately (SYNCHRONOUS)
4. `_debouncedPersist()` → schedules persist for T+200ms (MACROTASK)
5. `storage.set()` executes → returns Promise (MICROTASK)
6. **GAP:** User switches tabs at T+150ms
7. Persistence completes at T+200ms but tab is inactive - `visibilitychange` may
   not fire
8. Result: DOM rendered but state not saved

**Evidence from Logs:**

```
2025-12-03T01:04:21.206Z LOG UICoordinator Received state:updated event (quickTabId: qt-629-..., source: Manager, isRestoreOperation: true)
2025-12-03T01:04:21.298Z LOG VisibilityHandler Timer callback executing (source: Manager, operation: restore, timerId: timer-qt-629-...-8)
```

Time gap: 92ms between render trigger and persist execution.

**Fix Required:**  
Unify timing model - use ONLY Promises for coordination, eliminate `setTimeout`
for critical operations. Refactor to:

1. `handleMinimize()` → immediately update entity state
2. Await `_persistToStorage()` (Promise-based, no setTimeout wrapper)
3. After persist completes, THEN emit `state:updated` event
4. UICoordinator renders only after receiving event

This ensures render NEVER happens before persistence. For debouncing, use
Promise-based debouncer that cancels pending operation and returns new Promise.

---

## Issue 4: Missing StorageManager Logging

**Problem:**  
StorageManager (presumed location:
`src/features/quick-tabs/managers/StorageManager.js`) receives
`storage.onChanged` events but provides ZERO logging. Cannot diagnose:

- Which events are being processed vs. ignored
- What changed (oldValue vs newValue comparison)
- Whether self-write detection is working
- How many events are queued/pending

**Root Cause:**

**File:** Presumed `src/features/quick-tabs/managers/StorageManager.js`  
**Location:** `storage.onChanged` listener registration  
**Issue:** Handler likely exists but lacks comprehensive logging at entry,
decision points, and exit. Background script shows pattern of detailed logging
(`background.js:1387-1450`) but StorageManager does not.

**Evidence:**  
Logs show background processing storage events:

```
2025-12-03T01:04:20.019Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:20.020Z DEBUG Background Storage change comparison (oldTabCount: 2, newTabCount: 2, oldSaveId: 1764723859257-7ke3gn0o0, newSaveId: 1764723860018-uihvjk1fg)
```

But NO corresponding logs from content script's StorageManager showing same
event was received/processed.

**Fix Required:**  
Add logging to StorageManager's `storage.onChanged` handler:

**At handler entry:**

- Log event received with timestamp, area (local/sync), changed keys
- Log oldValue vs newValue for `quick_tabs_state_v2`
- Log current tab ID and instance ID

**At decision point:**

- If self-write detected: log "SKIPPED self-write (writeId matches current tab)"
- If external write: log "PROCESSING external write (writeId from Tab X)"
- If hash matches last processed: log "SKIPPED duplicate (hash collision)"

**At handler exit:**

- Log action taken: "Updated local state from storage", "Triggered re-render",
  "No action needed"
- Log processing duration (ms)

Follow pattern established in `background.js:_handleQuickTabStateChange()` which
includes saveId comparison, tab count change detection, and cooldown tracking.

---

## Issue 5: Missing UICoordinator Rendering Pipeline Logs

**Problem:**  
UICoordinator receives `state:updated` events and renders DOM but lacks logging
for critical rendering decisions. Cannot diagnose:

- Why DOM sometimes doesn't appear after restore
- Which code path was taken (create new vs. update existing)
- Whether entity dimensions were read from snapshot vs. entity state
- If rendering completed successfully or failed silently

**Root Cause:**

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `state:updated` event handler (file is 70KB+, exact line unknown
due to truncation)  
**Issue:** File has SOME logs (visible in log output) but missing key decision
points in rendering pipeline. Logs show transaction boundaries and snapshot
application but NOT intermediate steps.

**Evidence from Logs:**

```
2025-12-03T01:04:21.206Z LOG UICoordinator Received state:updated event (quickTabId: qt-629-..., source: Manager, isRestoreOperation: true)
2025-12-03T01:04:21.206Z LOG UICoordinator update entry (mapKeys: [], operation: update-entry, targetId: qt-629-..., inMap: false)
2025-12-03T01:04:21.206Z LOG UICoordinator Creating new window instance (qt-629-...)
[...DOM rendering happens here but no logs...]
2025-12-03T01:04:21.209Z LOG UICoordinator Tab rendered (qt-629-...)
```

**Gap:** No logs showing:

- Why "Creating new window instance" was chosen over "Update existing window"
- What entity state looked like before render decision
- Whether snapshot was available and what it contained
- If any errors occurred during createElement/DOM manipulation

**Fix Required:**  
Add detailed logging to rendering pipeline:

**Before render decision:**

- Log entity state: `{ minimized, position, size, url, zIndex, solo, mute }`
- Log map lookup result: `renderedTabs.has(id)` → true/false
- Log snapshot availability: `MinimizedManager.hasSnapshot(id)` → true/false

**At decision point:**

- If creating new window: log "Path: CREATE_NEW (reason: not in renderedTabs
  map)"
- If updating existing: log "Path: UPDATE_EXISTING (reason: found in
  renderedTabs map, minimized state changed)"
- If restoring from snapshot: log "Path: RESTORE_FROM_SNAPSHOT (reason:
  isRestoreOperation=true, snapshot found)"

**During rendering:**

- Log DOM element creation: "Created container div (id: qt-629-..., className:
  quick-tab-container)"
- Log dimension application: "Applied dimensions to container (left: 392px, top:
  389px, width: 960px, height: 540px)"
- Log snapshot application: "Applied snapshot dimensions override (from
  MinimizedManager)"

**After rendering:**

- Log final DOM state verification: "DOM container.style = { left, top, width,
  height, zIndex }"
- If error: log full stack trace and entity state at time of error

Follow pattern in QuickTabWindow.js which logs before/after for dimension
changes.

---

## Issue 6: Missing MinimizedManager Snapshot Lifecycle Logs

**Problem:**  
MinimizedManager has SOME logging for snapshot operations but missing critical
lifecycle events. Cannot diagnose:

- When snapshots are created (only logs lookup, not creation)
- Why snapshot validation sometimes fails after restore
- How many snapshots exist at any given time
- If snapshot clearing logic is working correctly

**Root Cause:**

**File:** `src/features/quick-tabs/managers/MinimizedManager.js`  
**Location:** Snapshot create, update, validation methods  
**Issue:** Logs show snapshot retrieval (`getSnapshot found for qt-629-...`) and
atomic moves (`Atomically moved snapshot to pendingClear`), but NOT snapshot
creation or validation failures.

**Evidence from Logs:**

```
2025-12-03T01:04:21.096Z LOG MinimizedManager Atomically moved snapshot to pendingClear (clear-on-first-use, qt-629-...)
2025-12-03T01:04:21.096Z LOG MinimizedManager restore snapshot lookup (id: qt-629-..., source: minimizedTabs, savedPosition: {left: 392, top: 389}, savedSize: {width: 960, height: 540})
2025-12-03T01:04:21.206Z LOG MinimizedManager getSnapshot found for qt-629-... (source: pendingClearSnapshots, position: {left: 392, top: 389}, size: {width: 960, height: 540})
```

**Gap:** No logs showing:

- When snapshot was CREATED (before minimize operation)
- If snapshot dimensions were validated (non-zero width/height check)
- If snapshot was updated during drag/resize operations
- When snapshot was definitively cleared (only logs "called" but not "cleared
  from Map")

**Fix Required:**  
Add logging to snapshot lifecycle:

**At snapshot creation (minimize operation):**

- Log "Creating snapshot (id: X, position: {left, top}, size: {width, height},
  source: minimize)"
- Log validation: "Snapshot dimensions VALID (width > 0, height > 0)" or
  "INVALID - using default dimensions"
- Log Map insertion: "Stored in minimizedTabs Map (mapSize: N)"

**At snapshot update (position/size change while minimized):**

- Log "Updating snapshot (id: X, field: position/size, oldValue: {...},
  newValue: {...})"
- Log "Snapshot updated in minimizedTabs Map"

**At snapshot validation (restore operation):**

- Log "Validating snapshot (id: X, hasPosition: true/false, hasSize:
  true/false)"
- If validation fails: log "Snapshot validation FAILED (reason: missing
  position/size), using entity fallback"
- If validation passes: log "Snapshot validation PASSED"

**At snapshot clearing:**

- Log Map removal: "Removed from minimizedTabs Map (id: X, remainingSnapshots:
  N)"
- Log Map removal: "Removed from pendingClearSnapshots (id: X, remainingPending:
  N)"
- If snapshot not found: log "clearSnapshot called but snapshot missing (id: X,
  checked: [minimizedTabs, pendingClear])"

Follow pattern in VisibilityHandler which logs Map sizes and operation results.

---

## Issue 7: Missing Timer Callback Execution Logs

**Problem:**  
VisibilityHandler uses `setTimeout` extensively for debouncing but only logs
timer SCHEDULING, not timer EXECUTION. Cannot diagnose:

- If timer actually fired or was cancelled
- How long timer waited before executing
- If multiple timers for same operation are running concurrently

**Root Cause:**

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_debouncedPersist()` method line ~1083,
`_emitRestoreStateUpdate()` method line ~965  
**Issue:** Both methods log "scheduling" but the `setTimeout` callback itself
has NO entry log.

**Evidence from Logs:**

```
2025-12-03T01:04:19.809Z LOG VisibilityHandler debouncedPersist scheduling (source: UI, id: qt-629-..., operation: minimize, timerId: timer-qt-629-...-6, activeTimerCount: 1)
[...200ms gap with no logs...]
2025-12-03T01:04:20.018Z LOG VisibilityHandler Timer callback executing (source: UI, id: qt-629-..., operation: minimize, timerId: timer-qt-629-...-6)
```

**Gap:** Timer callback HAS a log at start ("Timer callback executing"), but if
callback were silently cancelled or threw error, there would be NO visibility.
Also, `_emitRestoreStateUpdate` timer has NO callback log at all - only
scheduling log.

**Fix Required:**  
Add comprehensive timer lifecycle logging:

**At timer scheduling (already exists):**

- Continue logging timerId, operation, existing timer status

**At timer callback ENTRY (add this):**

- Log "Timer callback STARTED (timerId: X, operation: Y, scheduledDelay: 200ms,
  actualDelay: 205ms)"
- Calculate actualDelay by storing schedule timestamp and comparing to execution
  timestamp

**At timer callback EXIT (add this):**

- Log "Timer callback COMPLETED (timerId: X, operation: Y, duration: 15ms,
  outcome: success/error)"
- If error thrown: log full stack trace with "Timer callback FAILED"

**At timer cancellation (already exists):**

- Continue logging "Cleared previous debounce timer"

**For `_emitRestoreStateUpdate` specifically:** Add entry log inside
`setTimeout` callback:

```javascript
setTimeout(() => {
  console.log(`[VisibilityHandler] state:updated emit timer FIRED (id: ${id}, delay: ${STATE_EMIT_DELAY_MS}ms)`);
  this.eventBus.emit('state:updated', ...);
}, STATE_EMIT_DELAY_MS);
```

This ensures visibility into ALL timer executions, not just debounced persist
operations.

---

## Issue 8: Firefox-Specific storage.onChanged Behavior

**Problem:**  
Firefox's `storage.onChanged` implementation has non-standard behavior: (1) may
fire even when underlying data didn't change, (2) includes ALL keys in storage
area (not just changed keys), (3) fires AFTER Promise resolution. This causes
spurious event processing and hash collision false positives.

**Root Cause:**

**Architectural Context:**  
Per MDN documentation on `storage.onChanged`:

> "**Note:** In Firefox, the information returned includes **all keys within the
> storage area**. Also, the callback may be invoked when there is **no change to
> the underlying data**."

Per Firefox Bugzilla #1554088:

> "Promise returned by `browser.storage.local.set` is fulfilled BEFORE
> `storage.onChanged` listener is executed."

**File:** `background.js`  
**Location:** `computeStateHash()` function (lines ~1234-1264)  
**Issue:** Function computes hash of state for deduplication. Background script
tracks `lastBroadcastedStateHash` to skip redundant broadcasts. However, if
Firefox fires `onChanged` without actual data change, hash will match but event
still gets processed - wasting CPU cycles.

**File:** `background.js`  
**Location:** `_handleQuickTabStateChange()` (lines ~1387-1450)  
**Issue:** Handler compares `oldSaveId` vs `newSaveId` to detect changes (line
~1420). If Firefox fires event without data change, both saveIds will match but
handler still executes comparison logic. No early return for this case.

**Evidence from Code:**

```javascript
// background.js line ~1345
const IN_PROGRESS_TRANSACTIONS = new Set();
```

Set only tracks background's own writes. If Firefox fires spurious `onChanged`
for unrelated storage key, Set won't help.

**Fix Required:**  
Add early-exit check in `storage.onChanged` handler:

**At handler entry:**

1. Check if `changes` object contains `quick_tabs_state_v2` key - if NO, return
   early (different storage key changed)
2. Compare `changes.quick_tabs_state_v2.oldValue` vs
   `changes.quick_tabs_state_v2.newValue` using deep equality or hash - if
   EQUAL, return early with log "Firefox spurious onChanged - no actual data
   change"
3. Only then proceed to saveId comparison and cache update

**Additional safeguard:** Track last processed saveId separately from cache.
Before processing event:

```javascript
if (newSaveId === lastProcessedSaveId) {
  console.log(
    '[Background] SKIPPED duplicate saveId (Firefox fired onChanged twice for same write)'
  );
  return;
}
```

This prevents double-processing same write even if Firefox's behavior is
non-standard.

---

## Shared Implementation Notes

**Storage Write Pattern:**

- Every `storage.local.set()` call must include:
  - Unique `saveId` (already implemented: `${timestamp}-${randomString}`)
  - NEW: `writingTabId` (from `browser.tabs.getCurrent()` or passed from content
    script)
  - NEW: `writingInstanceId` (generated once per tab load, stored in closure)
  - Timestamp for ordering

**Self-Write Detection:**

- In `storage.onChanged` handler, compare `newValue.writingTabId` against
  current tab's ID
- If match: log "SKIPPED self-write" and return early
- If no match: proceed with processing

**Synchronization Barrier:**

- After critical operations (minimize, restore, resize, position), wait for
  `storage.onChanged` confirmation before allowing next operation
- Implement timeout (200ms max) - if no confirmation, proceed anyway but log
  warning
- Use Promise-based coordination, not `setTimeout`

**Logging Consistency:**

- All storage operations: log `[StorageUtils]` prefix with transaction ID
- All event handlers: log entry/exit with duration
- All timer operations: log schedule/fire/cancel/complete
- All Map operations: log before/after sizes

**Hash Collision Handling:**

- Include `saveId` in hash calculation (already done in `background.js`)
- Store last processed saveId separately from last broadcasted hash
- Skip processing if saveId already seen (Firefox duplicate event)

**Firefox-Specific Handling:**

- Always check `changes` object for target key before processing
- Compare oldValue vs newValue before assuming change occurred
- Document Firefox Bug #1554088 in code comments near `storage.onChanged`
  listeners

<acceptancecriteria>
**Issue 1 (Storage Event Storm):**
- VisibilityHandler writes include `writingTabId` and `writingInstanceId`
- StorageManager's `onChanged` handler skips self-writes (logs "SKIPPED self-write")
- Background's `_handleQuickTabStateChange` skips content script's own writes
- Log analysis shows max 2-3 storage events per operation (down from 10+)

**Issue 2 (Promise/Event Race):**

- After `storage.set()`, code waits for `storage.onChanged` acknowledgment
  before next operation
- OR: Version number incremented on each write, readers wait for expected
  version
- Log timestamps show `onChanged` fires BEFORE next operation starts
- No "stale data" warnings in logs after implementing synchronization barrier

**Issue 3 (Event Loop Timing):**

- `_emitRestoreStateUpdate` replaced with Promise-based coordination
- `_debouncedPersist` uses Promise-based debouncer (no `setTimeout` wrapper)
- `state:updated` event emitted AFTER persistence completes, not before
- Log order shows: persist → event emit → UI render (not event → render →
  persist)

**Issue 4 (StorageManager Logging):**

- StorageManager logs every `onChanged` event with oldValue/newValue comparison
- Self-write detection logged: "SKIPPED self-write (writingTabId matches)"
- External write processing logged: "PROCESSING external write (from Tab X)"
- Hash collision logged: "SKIPPED duplicate (saveId already processed)"

**Issue 5 (UICoordinator Logging):**

- Before render: entity state, map lookup, snapshot availability logged
- Render path decision logged: CREATE_NEW / UPDATE_EXISTING /
  RESTORE_FROM_SNAPSHOT
- During render: DOM creation, dimension application, snapshot override logged
- After render: final DOM state verification logged
- Errors include full stack trace and entity state dump

**Issue 6 (MinimizedManager Logging):**

- Snapshot creation logged with dimensions and validation result
- Snapshot updates logged with old/new values
- Snapshot validation logged with pass/fail and reason
- Snapshot clearing logged with Map sizes before/after

**Issue 7 (Timer Callback Logging):**

- Timer callback entry logged: "Timer callback STARTED (timerId, actualDelay)"
- Timer callback exit logged: "Timer callback COMPLETED (duration, outcome)"
- `_emitRestoreStateUpdate` timer logs when callback fires
- Cancelled timers logged: "Timer CANCELLED before execution"

**Issue 8 (Firefox Behavior):**

- `onChanged` handler checks if target key changed before processing
- OldValue vs newValue deep comparison returns early if equal
- Last processed saveId tracked to skip Firefox duplicate events
- Log shows: "Firefox spurious onChanged - no data change" when detected

**All Issues:**

- Manual test: minimize → restore → minimize → restore (5 cycles) produces <20
  storage events total
- No "WARNING Tab count dropped from 2 to 0!" messages in background logs
- Manager indicator updates within 200ms of minimize/restore operations
- All existing tests pass
- No new console errors or warnings
- Transaction IDs match across VisibilityHandler → background → StorageManager
  logs </acceptancecriteria>

---

## Supporting Context

<details>
<summary>Issue 1 Log Evidence - Storage Event Storm</summary>

From `copy-url-extension-logs_v1.6.3.5-v2_2025-12-03T01-04-33.txt`:

Single restore operation triggered 23 storage.onChanged events in 800ms:

```
2025-12-03T01:04:21.229Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:21.261Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:21.301Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:21.737Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:22.030Z DEBUG Background Storage changed (local) quick_tabs_state_v2
2025-12-03T01:04:22.031Z DEBUG Background Storage changed (local) quick_tabs_state_v2
[...17 more events within same 800ms window...]
```

Background cache cleared and re-populated 3 times during single operation:

```
2025-12-03T01:04:21.261Z WARN Background WARNING: Clearing cache with 0 tabs
2025-12-03T01:04:21.301Z DEBUG Background Updating cache (tabCount: 2, saveId: 1764723861298-l307ejtmq)
2025-12-03T01:04:21.737Z WARN Background WARNING: Tab count dropped from 2 to 0!
```

This pattern indicates circular propagation where each tab processes same event
and may trigger new write.

</details>

<details>
<summary>Issue 2 Log Evidence - Promise/Event Race Condition</summary>

VisibilityHandler completes storage write but background processes change 1ms
later:

```
2025-12-03T01:04:20.018Z LOG VisibilityHandler Storage write COMPLETED (txn-1764723860018-dnjep0, 2 tabs)
2025-12-03T01:04:20.019Z DEBUG Background Storage changed (local) quick_tabs_state_v2
```

Under load, this gap can be 50-200ms. If user clicks "restore" during gap,
operation reads stale cached state.

Another example showing restore operation starting before storage settled:

```
2025-12-03T01:04:21.096Z LOG Content Received RESTORE_QUICK_TAB request (qt-629-...)
2025-12-03T01:04:21.206Z LOG UICoordinator Received state:updated event
2025-12-03T01:04:21.229Z DEBUG Background Storage changed (local) quick_tabs_state_v2
```

Restore started at T+0ms, UI rendered at T+110ms, but storage event arrived at
T+133ms - race condition confirmed.

</details>

<details>
<summary>Issue 3 Log Evidence - Event Loop Timing Chaos</summary>

`state:updated` event fires 92ms BEFORE storage persist executes:

```
2025-12-03T01:04:21.206Z LOG UICoordinator Received state:updated event (isRestoreOperation: true)
2025-12-03T01:04:21.298Z LOG VisibilityHandler Timer callback executing (operation: restore, timerId: timer-qt-629-...-8)
```

UI rendered based on event at T+0ms, but persist didn't execute until T+92ms. If
user switched tabs at T+50ms, persist would complete in background tab -
`visibilitychange` listener may not capture final state.

Another example showing event emission scheduled for T+100ms, persist for
T+200ms:

```javascript
// Line ~965: _emitRestoreStateUpdate
setTimeout(() => { this.eventBus.emit('state:updated', ...) }, 100);

// Line ~1083: _debouncedPersist
setTimeout(async () => { await this._persistToStorage() }, 200);
```

This creates 100ms window where UI is rendered but data not saved.

</details>

<details>
<summary>Issue 4 Evidence - StorageManager Logging Gap</summary>

Background script shows detailed storage event processing:

```
2025-12-03T01:04:20.020Z DEBUG Background Storage change comparison (oldTabCount: 2, newTabCount: 2, oldSaveId: 1764723859257-7ke3gn0o0, newSaveId: 1764723860018-uihvjk1fg, transactionId: txn-1764723860018-dnjep0)
2025-12-03T01:04:20.020Z DEBUG Background Updating cache only (no broadcast, tabCount: 2, saveId: 1764723860018-uihvjk1fg)
```

But content script's StorageManager has ZERO equivalent logs. Only evidence of
StorageManager's existence is indirect - UICoordinator receives updates, so
SOMETHING must be processing storage events. But no logs prove it.

Search through entire log file for "StorageManager" or "storage.onChanged" in
content context: **0 results**.

</details>

<details>
<summary>Issue 5 Evidence - UICoordinator Rendering Pipeline Gap</summary>

UICoordinator logs show transaction boundaries but not decision points:

```
2025-12-03T01:04:21.206Z LOG UICoordinator update entry (mapKeys: [], operation: update-entry, targetId: qt-629-..., inMap: false, entityMinimized: false)
2025-12-03T01:04:21.206Z LOG UICoordinator Update decision: restore via unified fresh render path
2025-12-03T01:04:21.206Z LOG UICoordinator Creating new window instance (qt-629-...)
[...gap - no logs during createElement, dimension application...]
2025-12-03T01:04:21.209Z LOG UICoordinator renderedTabs.set (id: qt-629-..., isRendered: true, mapSizeBefore: 0, mapSizeAfter: 1)
```

Missing logs:

- Why "restore via unified fresh render path" was chosen (what other paths
  exist?)
- What entity state looked like:
  `{ minimized: false, position: {left: 392, top: 389}, size: {width: 960, height: 540} }`
- Whether snapshot was consulted: `MinimizedManager.getSnapshot(id)` → found/not
  found
- DOM element creation success/failure

If rendering had failed silently, only evidence would be "Creating new window
instance" log followed by nothing - no error, no completion log.

</details>

<details>
<summary>Issue 6 Evidence - MinimizedManager Snapshot Lifecycle Gap</summary>

MinimizedManager logs show snapshot USAGE but not CREATION:

```
2025-12-03T01:04:21.096Z LOG MinimizedManager Atomically moved snapshot to pendingClear (clear-on-first-use, qt-629-...)
2025-12-03T01:04:21.096Z LOG MinimizedManager restore snapshot lookup (id: qt-629-..., savedPosition: {left: 392, top: 389}, savedSize: {width: 960, height: 540})
2025-12-03T01:04:21.206Z LOG MinimizedManager getSnapshot found for qt-629-... (source: pendingClearSnapshots)
```

Missing logs:

- When was snapshot CREATED? (before minimize at T-200ms?)
- Were dimensions validated when snapshot created?
- Was snapshot updated during any intermediate operations?

Search through logs for "Creating snapshot" or "Snapshot created": **0
results**.

Only creation-adjacent log is "Atomically moved snapshot to pendingClear" which
assumes snapshot already existed - but no log proving when it was created.

</details>

<details>
<summary>Issue 7 Evidence - Timer Callback Execution Gap</summary>

Timer scheduling logged but callback execution SOMETIMES missing:

**Case 1 - Minimize (HAS callback log):**

```
2025-12-03T01:04:19.809Z LOG VisibilityHandler debouncedPersist scheduling (operation: minimize, timerId: timer-qt-629-...-6)
2025-12-03T01:04:20.018Z LOG VisibilityHandler Timer callback executing (operation: minimize, timerId: timer-qt-629-...-6)
```

**Case 2 - Restore (HAS callback log):**

```
2025-12-03T01:04:21.097Z LOG VisibilityHandler debouncedPersist scheduling (operation: restore, timerId: timer-qt-629-...-8)
2025-12-03T01:04:21.298Z LOG VisibilityHandler Timer callback executing (operation: restore, timerId: timer-qt-629-...-8)
```

**Case 3 - state:updated emit (NO callback log):**

```
// Search for "_emitRestoreStateUpdate" timer callback firing: 0 results
```

The `_emitRestoreStateUpdate` method schedules timer but callback has no entry
log. If timer were cancelled or threw error, there would be no visibility.

</details>

<details>
<summary>Issue 8 Evidence - Firefox storage.onChanged Behavior</summary>

Background logs show multiple rapid-fire `onChanged` events with same saveId:

```
2025-12-03T01:04:22.062Z DEBUG Background saveId: 1764723862057-zac21hd1m → 1764723862057-pylq69vyt
2025-12-03T01:04:22.065Z DEBUG Background saveId: 1764723862057-pylq69vyt → 1764723862057-aeedxyr6k
2025-12-03T01:04:22.067Z DEBUG Background saveId: 1764723862057-aeedxyr6k → 1764723862062-qzilatu5c
```

Notice: First 3 events have SAME timestamp prefix (1764723862057) but different
random suffixes. This pattern suggests Firefox fired multiple `onChanged` events
for same underlying write, or events are being generated by different sources
without coordination.

Per MDN documentation, Firefox may fire `onChanged` even without actual data
change - this explains why background sees multiple events within 5ms window.

</details>

<details>
<summary>Architectural Context - Storage Architecture</summary>

Quick Tabs state synchronization relies on `browser.storage.local` as shared
state hub:

**Write Sources:**

1. **VisibilityHandler** (content script) - minimize, restore, focus operations
2. **UpdateHandler** (content script) - position, size changes
3. **QuickTabHandler** (background) - create, close, pin, solo, mute operations

**Read Sources:**

1. **Background script** - maintains `globalQuickTabState` cache for cross-tab
   sync
2. **StorageManager** (content script) - processes `storage.onChanged` to update
   local state
3. **Settings page** - reads state for Manager panel display

**Synchronization Model:**

- Each write source calls `browser.storage.local.set()` independently
- All contexts listen to `browser.storage.onChanged` events
- NO central coordinator - each context decides whether to process event
- Background broadcasts state via messages BUT storage events are primary sync
  mechanism

**Problem:** This architecture assumes `storage.onChanged` fires synchronously
and deterministically. Per Firefox Bug #1554088, this assumption is **FALSE** -
events fire asynchronously AFTER Promise resolution, creating race conditions.

</details>

---

**Priority:** Critical (Issues 1-3), High (Issues 4-6), Medium (Issues 7-8)  
**Target:** Single coordinated PR addressing all issues with unified logging and
synchronization strategy  
**Estimated Complexity:** High - requires rearchitecting storage event handling
and adding comprehensive logging infrastructure

---

## References

- **MDN browser.storage.local.set():**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/set
- **MDN storage.onChanged:**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged
- **Firefox Bug #1554088:** https://bugzilla.mozilla.org/show_bug.cgi?id=1554088
  (Promise resolves before `onChanged` fires)
- **MDN Event Loop (Microtasks):**
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises#task_queues_vs_microtasks
- **Extension Version:** v1.6.3.5-v6
- **Log File:** copy-url-extension-logs_v1.6.3.5-v2_2025-12-03T01-04-33.txt
