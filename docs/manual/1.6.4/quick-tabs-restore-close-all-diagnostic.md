# Quick Tabs Manager: Restore & Close All Critical Failures

**Extension Version:** v1.6.3.5-v5 | **Date:** 2025-12-03 | **Scope:** Restore
operation deadlock, storage write storms, and missing Manager UI logging

---

## Executive Summary

Quick Tabs Manager exhibits complete restore failure and Close All corruption
across multiple mechanisms. Restore operations enter an infinite rollback loop
preventing any minimized Quick Tab from ever being restored. Close All
operations trigger multi-tab storage write cascades causing tabs to "reappear"
after deletion. UICoordinator Map inconsistencies and missing Manager UI logging
make diagnosis extremely difficult. All issues stem from architectural race
conditions introduced when DOM verification and cross-component coordination
were added in v1.6.3.5-v5.

**Impact:** Restore feature is completely non-functional. Close All corrupts
state across all browser tabs. Manager UI state changes are invisible to
diagnostics.

## Issues Overview

| Issue                                     | Component                         | Severity     | Root Cause                                |
| ----------------------------------------- | --------------------------------- | ------------ | ----------------------------------------- |
| #1: Restore infinite rollback loop        | VisibilityHandler + UICoordinator | **Critical** | DOM verification deadlock with rollback   |
| #2: Storage write storm on Close All      | Multi-tab cascade                 | **Critical** | Each tab writes empty state independently |
| #3: DestroyHandler closeAll multi-execute | DestroyHandler + Manager          | **High**     | Duplicate button handler or event loop    |
| #4: UICoordinator Map never populated     | CreateHandler + UICoordinator     | **Medium**   | Missing Map registration during creation  |
| #5: Manager UI state changes unlogged     | Manager panel components          | **High**     | Zero logging for UI add/remove/refresh    |

**Why bundled:** All discovered during same restore/Close All testing session.
Issues create interlocking cascade making individual diagnosis impossible.
Shared context: state synchronization architecture and event coordination.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (_verifyRestoreAndEmit, _handleDOMVerificationFailure)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (update decision logic, Map population)
- `src/features/quick-tabs/handlers/DestroyHandler.js` (closeAll deduplication)
- `src/features/quick-tabs/handlers/CreateHandler.js` (UICoordinator notification)
- Manager panel UI components (add comprehensive logging)

**Do NOT Modify:**

- `src/features/quick-tabs/window.js` (QuickTabWindow implementation correct)
- `src/features/quick-tabs/managers/MinimizedManager.js` (snapshot logic works
  correctly)
- `src/utils/storage-utils.js` (persistence utilities correct) </scope>

---

## Issue #1: Restore Operation Infinite Rollback Deadlock

### Problem

Clicking restore on any minimized Quick Tab causes infinite flickering and never
successfully restores. Quick Tab Manager's "Last sync" indicator updates every
2-4 seconds. Quick Tab entry flickers light gray repeatedly but window never
appears on screen.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_verifyRestoreAndEmit()` (lines 647-678) and
`_handleDOMVerificationFailure()` (lines 686-708)  
**Issue:** DOM verification check creates deadlock with UICoordinator's
rendering decision logic, causing infinite rollback cycle.

**The Deadlock Sequence:**

1. User clicks restore → VisibilityHandler.handleRestore()
2. Sets `entity.minimized = false` at line 573
3. Calls `tabWindow.restore()` which updates instance state but **does NOT
   render DOM** (defers to UICoordinator per v1.6.3.2 design)
4. **127ms later**: `_verifyRestoreAndEmit()` checks if DOM exists via
   `_isDOMRendered()` (line 659)
5. **DOM check FAILS** because UICoordinator hasn't rendered yet
   (UICoordinator's `update()` method hasn't run)
6. **Rollback triggered** at line 687:
   `tabWindow.minimized = preRestoreState.minimized` (sets back to `true`)
7. Re-adds snapshot to MinimizedManager at line 692
8. Focus timer still fires at line 398, persisting the **rolled-back state**
   (minimized=true) to storage
9. UICoordinator.update() eventually processes the state:updated event but sees
   `entityMinimized: true` and **skips rendering** (line 1165: "Update decision:
   skip (Manager minimize, cleanup complete)")
10. Next restore attempt sees the same rolled-back minimized state → cycle
    repeats infinitely

**Why DOM Never Appears:**

UICoordinator's decision logic at lines 1151-1169 explicitly checks
`if (source !== 'Manager' || !entityMinimized)` before deleting Map entry and
re-rendering. When rollback sets `minimized = true`, UICoordinator interprets
this as "Manager already handled minimize, cleanup complete" and skips all
rendering.

**Evidence from Logs:**

```
[07:33:09.398] VisibilityHandler: Updating entity.minimized = false
[07:33:09.398] QuickTabWindow: restore() called - deferred to UICoordinator
[07:33:09.525] ERROR VisibilityHandler: DOM verification FAILED
[07:33:09.525] VisibilityHandler: Rolling back entity state
[07:33:09.604] VisibilityHandler: Persisting 2 tabs (1 minimized) [txn-xxx]
[07:33:09.606] UICoordinator: Update decision: skip (Manager minimize, cleanup complete)
```

The 127ms gap between restore call (398ms) and verification (525ms) is
insufficient for UICoordinator's async event processing pipeline to complete
rendering.

### Fix Required

Remove DOM verification rollback logic entirely or redesign coordination
contract between VisibilityHandler and UICoordinator. The fundamental issue is
that VisibilityHandler **assumes synchronous rendering** but UICoordinator uses
**asynchronous event-driven rendering**.

**Recommended approach:** VisibilityHandler should emit state:updated event with
`isRestoreOperation: true` flag and **trust UICoordinator** to handle rendering.
Do NOT verify DOM existence or roll back state. If UICoordinator fails to
render, it should emit an error event that VisibilityHandler can respond to,
rather than VisibilityHandler preemptively assuming failure.

**Alternative approach:** Change UICoordinator to render synchronously during
restore operations (call render() directly in the same tick as receiving
state:updated event) so DOM exists before verification timeout.

Either approach requires eliminating the rollback mechanism which creates the
deadlock.

---

## Issue #2: Storage Write Storm from Multi-Tab Close All Cascade

### Problem

Clicking "Close All" or "Clear Quick Tabs Storage" button causes Quick Tabs to
disappear for a few milliseconds, then immediately reappear in the Manager list
even though the actual Quick Tab windows don't reappear on screen. "Last sync"
indicator updates continuously.

### Root Cause

**File:** Background script `storage.onChanged` handlers + all open browser
tabs  
**Location:** Each tab's response to `storage.onChanged` events  
**Issue:** When any one tab writes empty state (0 tabs) to storage, ALL other
open browser tabs see the `storage.onChanged` event and each independently
writes their own empty-state confirmation, triggering a cascade where each write
triggers the next tab's write.

**The Cascade Sequence:**

1. User clicks "Close All" in Tab A (inst-1764747162118)
2. Tab A's DestroyHandler.closeAll() writes `{ tabs: [] }` to storage with
   txn-1764747190390-gt4g73
3. **All 10+ other open browser tabs** see `storage.onChanged` event within ~5ms
4. Each tab independently processes the event:
   - Sees `newTabCount: 0`
   - Clears its local quickTabsMap
   - **Writes its own empty state confirmation** to storage
5. This creates 10+ consecutive writes within 50ms window:
   - inst-1764747149912 writes at T+0ms
   - inst-1764747149915 writes at T+10ms
   - inst-1764747149932 writes at T+20ms
   - (pattern continues for all 10 instances)
6. Each write triggers `storage.onChanged` in all other tabs, creating
   exponential cascade
7. **After ~10-15 seconds**, the active content tab (inst-1764747162118) that
   still has Quick Tabs in memory from before the clear performs a routine
   persist operation (e.g., focus change, timer callback)
8. This writes `{ tabs: 2 }` back to storage with current in-memory state
9. All other tabs see this new non-empty state and **restore the "deleted"
   tabs** in their Manager UI

**Evidence from Logs:**

```
[07:33:10.394] tabs: 2 → 0 [txn-1764747190390-gt4g73] inst-1764747149912
[07:33:10.404] tabs: 0 → 0 [txn-1764747190392-g5hu0y] inst-1764747149915
[07:33:10.411] tabs: 0 → 0 [txn-1764747190405-6w420g] inst-1764747149932
[07:33:10.412] tabs: 0 → 0 [txn-1764747190405-alo71s] inst-1764747149935
... (6 more empty writes within 50ms)
```

The 1000ms empty-write cooldown protection (line 394: "REJECTED Clear within
cooldown period") prevents cache corruption but doesn't stop the writes
themselves or the cascade.

### Fix Required

Implement proper cross-tab write coordination using one of these strategies:

**Strategy A - Leader Election:**  
Designate one "leader" tab responsible for persistence. All other tabs listen to
storage.onChanged but never write. Leader election via lowest instance ID or
explicit mutex acquisition.

**Strategy B - Write Ownership Tags:**  
Each storage write includes `originTabId` field. Tabs ignore `storage.onChanged`
events where `originTabId` matches their own tab ID. This prevents
self-triggered cascades but still allows legitimate cross-tab updates.

**Strategy C - Debounce All Storage Reads:**  
When any tab sees `storage.onChanged`, instead of immediately processing and
writing, debounce for 500-1000ms. This allows cascades to settle before any tab
responds. Only process the final settled state.

**Current architecture already has `writingInstanceId` in storage format** but
doesn't use it for cascade prevention. The self-write detection at line 229
("Ignoring self-write: bg-xxx") only applies to background script writes, not
content script writes.

---

## Issue #3: DestroyHandler closeAll Executes Multiple Times

### Problem

"Close All" operation executes 2-3 times within ~1.2 seconds, causing redundant
storage writes and event emissions despite batch mode Set tracking.

### Root Cause

**File:** `src/features/quick-tabs/handlers/DestroyHandler.js`  
**Location:** `closeAll()` method (lines 167-225) and caller sources  
**Issue:** The closeAll() method is invoked multiple times from different
sources, but batch mode Set (`_batchOperationIds`) is cleared immediately after
first execution completes, allowing second execution to create new batch.

**Evidence from Logs:**

```
[07:33:20.411] DestroyHandler: Closing all Quick Tabs (source: Manager)
[07:33:20.421] DestroyHandler: closeAll complete source Manager - performing single atomic storage write
[07:33:21.607] DestroyHandler: closeAll complete source Manager - performing single atomic storage write
[WARNING: Writing 0 tabs without forceEmpty flag]
```

The second execution at 21.607 is 1.2 seconds after the first at 20.411, but
**also has source: Manager**, suggesting either:

1. Manager UI's "Close All" button handler fires twice (possible debouncing
   issue)
2. First closeAll's storage write triggers `storage.onChanged` cascade which
   causes Manager to re-invoke closeAll
3. External event bus message is bridged multiple times

**Current Deduplication Logic:**

Lines 181-188 add all IDs to `_batchOperationIds` Set before destroy loop. Line
220 clears the Set after persistence completes. However, if a second closeAll()
fires after line 220 of the first execution, the Set is empty and provides no
protection.

### Fix Required

Add closeAll-specific mutex/lock pattern to prevent duplicate executions within
a time window (e.g., 2000ms). When closeAll() is called:

1. Check if `_closeAllInProgress` flag is set
2. If yes, log warning and return immediately (duplicate call)
3. If no, set flag and schedule clearance after 2000ms
4. Proceed with closeAll logic
5. Clear flag after delay

This is similar to the restore lock pattern in UICoordinator (lines 1287-1291
using `RESTORE_IN_PROGRESS` Set) but adapted for closeAll's different execution
characteristics.

Additionally, investigate Manager UI button handler to ensure proper debouncing
(100-200ms) to prevent rapid double-clicks from triggering duplicate closeAll
calls.

---

## Issue #4: UICoordinator Map Never Populated During Creation

### Problem

Every Quick Tab destruction logs "Tab not found for destruction" warning even
though tabs exist and are rendered. UICoordinator's `renderedTabs` Map is empty
or incomplete.

### Root Cause

**File:** `src/features/quick-tabs/handlers/CreateHandler.js` +
`src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** QuickTabWindow creation flow (CreateHandler.js lines 80-120) and
UICoordinator.render() (UICoordinator.js lines 390-480)  
**Issue:** When CreateHandler creates new QuickTabWindow via
`createQuickTabWindow()` factory, the window is rendered and added to
`quickTabsMap`, but UICoordinator's `renderedTabs` Map is never updated.
UICoordinator only populates its Map when:

- `UICoordinator.render()` is called directly (rare - mostly used during
  hydration)
- `UICoordinator.update()` is called with restore operation (only during
  restore)

Normal creation flow:

1. User creates Quick Tab via keyboard shortcut
2. CreateHandler.handleCreate() is called
3. CreateHandler calls `createQuickTabWindow()` factory which returns rendered
   QuickTabWindow
4. CreateHandler adds to `quickTabsMap` and emits events
5. **UICoordinator never receives notification** to add entry to its
   `renderedTabs` Map

When destruction occurs:

1. DestroyHandler emits `state:deleted` event
2. UICoordinator receives event via `setupStateListeners()` (line 1586)
3. UICoordinator.destroy() checks `this.renderedTabs.get(quickTabId)` at line
   1524
4. **Tab not found** because it was never added during creation
5. Warning logged at line 1526: "Tab not found for destruction"

**Why This Happens:**

CreateHandler was extracted during Phase 2 refactoring but the UICoordinator
notification path was never added. The original monolithic QuickTabsManager
handled both creation and rendering in a single method, so Map population was
automatic. After extraction, CreateHandler and UICoordinator became separate
with no direct communication.

### Fix Required

Add UICoordinator registration during QuickTabWindow creation. After
CreateHandler creates the window (line 110), emit an internal event that
UICoordinator listens for:

```
this.eventBus.emit('window:created', { id, tabWindow });
```

UICoordinator should listen for this event in `setupStateListeners()` and add
the entry to `renderedTabs` Map:

```
this.eventBus.on('window:created', ({ id, tabWindow }) => {
  this.renderedTabs.set(id, tabWindow);
  console.log('[UICoordinator] Registered window in renderedTabs:', id);
});
```

This ensures the Map accurately reflects all rendered windows, making
destruction, updates, and reconciliation operations work correctly without "not
found" warnings.

---

## Issue #5: Manager UI State Changes Completely Unlogged

### Problem

When Quick Tabs "come back" after being cleared, or when Manager UI updates
during restore flickering, there are ZERO logs showing what triggered the
Manager to add/remove/refresh entries. This makes diagnosing Issue #2 (tabs
reappearing) impossible from logs alone.

### Root Cause

**File:** Manager panel UI components (specific files not provided in
analysis)  
**Location:** Methods that add Quick Tab entries to Manager list, remove
entries, update "Last sync" timestamp, handle storage.onChanged events  
**Issue:** Manager UI components have no instrumentation logging for:

1. When Quick Tab entries are **added** to the display list
2. When entries are **removed**
3. What triggers Manager to **refresh** its display
4. Which `storage.onChanged` events Manager **processes**
5. What storage state Manager **reads** during refresh
6. When "Last sync" indicator **updates** and why

**What IS logged:**

- Storage writes from content script (handlers)
- Storage.onChanged events in background script
- Quick Tab window lifecycle (render, minimize, destroy)

**What is NOT logged:**

- Manager's response to storage.onChanged
- Manager reading Quick Tab state from storage
- Manager building UI list from storage state
- Manager deciding to add/remove/update list entries

**Impact on Diagnostics:**

When analyzing Issue #2 (tabs reappearing after Close All):

1. Logs show storage writes: 2 tabs → 0 tabs → 2 tabs
2. User reports: "tabs came back in Manager UI"
3. **Missing data:** Which storage.onChanged event did Manager process? What
   state did it read? Did it read from cache or storage? Which component
   triggered the UI refresh?

Without this logging, we can only **infer** that Manager saw the final "2 tabs"
write and refreshed, but cannot **confirm** the exact code path or timing.

### Fix Required

Add comprehensive logging to all Manager UI components that handle Quick Tab
state:

**Storage Event Handler:**

```
When storage.onChanged received:
  Log: [Manager] storage.onChanged received: oldCount → newCount, saveId, txnId
  Log: [Manager] Processing storage update from instance: {instanceId}
  Log: [Manager] Storage read result: {tabCount} tabs, minimized: {count}
```

**UI List Management:**

```
When adding entry to list:
  Log: [Manager] Adding Quick Tab to UI list: {id}, {url}, {title}

When removing entry:
  Log: [Manager] Removing Quick Tab from UI list: {id}, reason: {why}

When refreshing entire list:
  Log: [Manager] Refreshing UI list: {count} tabs, trigger: {source}
```

**Last Sync Indicator:**

```
When timestamp updates:
  Log: [Manager] Last sync updated: {timestamp}, reason: {storage event/user action}
```

**State Source Tracking:**

```
When reading state:
  Log: [Manager] Reading Quick Tab state from: {storage/cache/memory}
  Log: [Manager] State read result: {tabCount} tabs
```

These logs should use the same format as other components (timestamp, component
prefix, structured data) and be enabled by default (not debug-only) since
they're critical for diagnosing state sync issues.

---

## Shared Implementation Notes

### Cross-Component Coordination Contract

**Current Problem:** VisibilityHandler, UICoordinator, and Manager each have
different assumptions about when DOM should exist, when state is authoritative,
and who is responsible for rendering.

**Required Fix:** Establish explicit contract:

1. **VisibilityHandler** is responsible for **entity state updates only**
   (setting minimized flag, managing snapshots)
2. **UICoordinator** is the **single rendering authority** - only UICoordinator
   creates/destroys DOM
3. **Manager** is a **passive observer** - reads state via storage.onChanged,
   never writes (except for user-initiated actions)

No component should verify another component's work (e.g., VisibilityHandler
verifying UICoordinator rendered DOM). Instead, use event-driven communication:

- Component A emits intent event: "I want to restore this tab"
- Component B executes and emits result event: "I successfully rendered" or "I
  failed to render"
- Component A handles result without preemptive verification

### Storage Write Deduplication

All handlers should check `writingInstanceId` before processing
`storage.onChanged` events:

```
if (event.writingInstanceId === this.instanceId) {
  // Skip - this was our own write
  return;
}
```

This prevents self-triggered cascades. Current code only does this for
background script writes, not content script writes.

### Event Bus Discipline

All state-mutating operations should follow this sequence:

1. Update local state
2. Emit state:\* event (state:updated, state:deleted, etc.)
3. Persist to storage (debounced)

Never:

- Persist without emitting event (Manager won't update)
- Emit event without persisting (state lost on reload)
- Skip debouncing on rapid operations (write storms)

<acceptancecriteria>

**Issue #1 (Restore Deadlock):**

- [ ] Restore operation completes without rollback
- [ ] Quick Tab window appears on screen within 500ms of clicking restore
- [ ] Manager indicator turns green immediately
- [ ] No flickering or repeated restore attempts
- [ ] Storage persisted state shows minimized=false

**Issue #2 (Storage Write Storm):**

- [ ] Close All triggers maximum 1 storage write per tab
- [ ] Tabs do not reappear in Manager after Close All
- [ ] Storage shows 0 tabs after Close All and stays at 0
- [ ] No cascading writes in logs (max 2-3 writes total, not 10+)
- [ ] Empty-write cooldown protection never triggered

**Issue #3 (closeAll Multi-Execute):**

- [ ] closeAll() executes exactly once per user action
- [ ] Only one "closeAll complete" log entry per button click
- [ ] No duplicate storage writes from same closeAll operation
- [ ] Mutex prevents duplicate calls within 2000ms window

**Issue #4 (UICoordinator Map):**

- [ ] renderedTabs Map contains all created Quick Tabs
- [ ] No "Tab not found for destruction" warnings
- [ ] Map size matches quickTabsMap size at all times
- [ ] Map correctly updated during creation, minimize, restore, destroy

**Issue #5 (Manager Logging):**

- [ ] Manager logs all storage.onChanged events it receives
- [ ] Manager logs when adding/removing UI list entries
- [ ] Manager logs "Last sync" timestamp updates with reason
- [ ] Logs show which storage state Manager reads during refresh
- [ ] All logs use consistent format with component prefix

**All Issues:**

- [ ] Restore operation works reliably
- [ ] Close All removes all tabs permanently
- [ ] No storage write storms or cascades
- [ ] All state changes visible in logs
- [ ] Manual test: create 2 tabs → minimize → restore → Close All → verify all
      operations complete correctly

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Issue #1: Detailed Log Sequence</summary>

**First Restore Attempt (07:33:09.398):**

```
[07:33:09.398] Content: Received RESTORE_QUICK_TAB request: qt-629-1764747184280-rdt1ucvwsq1h
[07:33:09.398] VisibilityHandler: Handling restore (source: Manager)
[07:33:09.398] VisibilityHandler: Updating entity.minimized = false
[07:33:09.398] MinimizedManager: Atomically moved snapshot to pendingClear
[07:33:09.398] QuickTabWindow: restore() called - deferred to UICoordinator
[07:33:09.525] ERROR VisibilityHandler: DOM verification FAILED
[07:33:09.525] VisibilityHandler: Rolling back entity state
[07:33:09.525] MinimizedManager: Added minimized tab with snapshot (ROLLBACK)
[07:33:09.604] VisibilityHandler: Persisting 2 tabs (1 minimized) [txn-xxx]
```

**Second Restore Attempt (07:33:13.479) - Same Pattern:**

```
[07:33:13.479] Content: Received RESTORE_QUICK_TAB request
[07:33:13.593] ERROR VisibilityHandler: DOM verification FAILED
[07:33:13.593] VisibilityHandler: Rolling back entity state
```

**Pattern continues through 07:33:24** - total of 5+ restore attempts, all with
identical rollback.

**Key Observation:** UICoordinator.update() logs show "Update decision: skip
(Manager minimize, cleanup complete)" for every restore attempt because
rolled-back state has entityMinimized=true.

</details>

<details>
<summary>Issue #2: Multi-Tab Write Storm Evidence</summary>

**Storage Cascade Timeline (50ms window):**

| Timestamp    | Event | Instance ID    | Transaction ID | Tab Count |
| ------------ | ----- | -------------- | -------------- | --------- |
| 07:33:10.394 | Write | inst-...149912 | txn-...gt4g73  | 2 → 0     |
| 07:33:10.404 | Write | inst-...149915 | txn-...g5hu0y  | 0 → 0     |
| 07:33:10.411 | Write | inst-...149932 | txn-...6w420g  | 0 → 0     |
| 07:33:10.412 | Write | inst-...149935 | txn-...alo71s  | 0 → 0     |
| 07:33:10.414 | Write | inst-...149948 | txn-...276n4b  | 0 → 0     |
| 07:33:10.415 | Write | inst-...149941 | txn-...p907km  | 0 → 0     |
| 07:33:10.424 | Write | inst-...149946 | txn-...sjz3qo  | 0 → 0     |
| 07:33:10.425 | Write | inst-...149934 | txn-...ukdd5v  | 0 → 0     |

**Total:** 8 different browser tab instances wrote empty state within 31ms.

**Resurrection Event (14 seconds later):**

```
[07:33:24.xxx] tabs: 0 → 2 (active tab wrote in-memory state)
[All other tabs see this write and "restore" deleted tabs in UI]
```

</details>

<details>
<summary>Issue #3: closeAll Duplicate Execution Evidence</summary>

**First Execution:**

```
[07:33:20.411] DestroyHandler: Closing all Quick Tabs (source: Manager)
[07:33:20.411] DestroyHandler: Added 2 IDs to batch Set
[07:33:20.421] DestroyHandler: closeAll complete source Manager - performing single atomic storage write
[07:33:20.421] Storage write: 0 tabs [txn-1764747200421-896hmq]
```

**Second Execution (1.2 seconds later):**

```
[07:33:21.607] DestroyHandler: closeAll complete source Manager - performing single atomic storage write
[07:33:21.607] WARNING: Writing 0 tabs without forceEmpty flag
[07:33:21.607] Storage write: 0 tabs [txn-1764747201607-plzsq7]
```

**Third Invocation (0.5 seconds after second):**

```
[07:33:21.093] Content: Received CLEARALLQUICKTABS request
[07:33:21.093] DestroyHandler: Clearing 0 Quick Tabs (map already empty)
```

All three have `source: Manager`, suggesting Manager UI button handler or event
listener is triggering multiple times.

</details>

<details>
<summary>Issue #4: UICoordinator Map State Evidence</summary>

**Creation Flow (No Map Update):**

```
[07:33:02.218] CreateHandler: Window created: [object Object]
[07:33:02.218] CreateHandler: Quick Tab created successfully: qt-xxx
[NO LOG: UICoordinator registering in renderedTabs Map]
```

**Destruction Flow (Map Miss):**

```
[07:33:20.xxx] DestroyHandler: Emitted state:deleted (source: UI): qt-xxx
[07:33:20.xxx] UICoordinator: Received state:deleted event
[07:33:20.xxx] WARN UICoordinator: Tab not found for destruction: qt-xxx
```

**Map State During Operations:**

```
Logs show quickTabsMap.size = 2 during operations
Logs show renderedTabs.size = 0 ("mapKeys: []")
```

This proves UICoordinator's Map is never populated during normal creation flow.

</details>

<details>
<summary>Issue #5: Manager UI Logging Gaps</summary>

**What Logs Show:**

- Content script handlers emitting events
- Storage writes with transaction IDs
- Background script processing storage.onChanged

**What Logs DON'T Show:**

- Manager receiving storage.onChanged
- Manager reading storage state
- Manager building UI list
- Manager adding/removing list entries
- Manager updating "Last sync" indicator

**Example Gap (Issue #2 - Tabs Reappearing):**

```
[07:33:10.394] Storage: tabs 2 → 0
... (cascade of empty writes)
[07:33:24.xxx] Storage: tabs 0 → 2
[USER OBSERVATION: "tabs came back in Manager"]
[NO LOGS: showing Manager's response to the 0→2 write]
```

Without Manager logs, cannot determine:

- Did Manager read from storage or cache?
- Which saveId did Manager use?
- Was this triggered by storage.onChanged or user action?
- Did Manager process intermediate writes or only final state?

</details>

<details>
<summary>Promise vs setTimeout Execution Order</summary>

Based on JavaScript event loop documentation and testing:

**Microtask Queue (Promises):**

- Executes immediately after current task completes
- Before any setTimeout callbacks
- Before browser rendering

**Macrotask Queue (setTimeout):**

- Executes after all microtasks complete
- After browser rendering (if needed)
- Order: Current task → All microtasks → Rendering → Next macrotask

**Why This Matters for Issue #1:**

VisibilityHandler uses `await this._delay(DOM_VERIFICATION_DELAY_MS)` which
creates a Promise-based delay. This executes in microtask queue. However,
UICoordinator's `update()` decision logic and rendering happens in response to
`state:updated` event, which may fire in a different macrotask cycle.

The issue is NOT the Promise vs setTimeout mechanism, but that **rollback
decision happens synchronously** while **rendering decision is deferred to async
event handler** in a separate component. The coordination timing is
fundamentally broken.

Solution must either:

1. Make rendering synchronous during restore (UICoordinator renders immediately
   when receiving state:updated with isRestoreOperation=true)
2. Remove rollback entirely and trust UICoordinator to handle rendering failure
   via error events

</details>

---

**Priority:** Critical (Issues #1, #2), High (Issues #3, #5), Medium (Issue
#4)  
**Target:** Fix Issues #1, #2, #3 immediately (restore and Close All are
completely broken). Issues #4, #5 can follow in separate PR.  
**Estimated Complexity:** High - requires refactoring cross-component
coordination contracts and event flow.
