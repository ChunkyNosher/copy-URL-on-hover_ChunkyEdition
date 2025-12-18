# Quick Tabs v1.6.3 - Architectural Coordination Issues & Missing Logging

**Extension Version:** v1.6.3.10-v5+  
**Date:** 2025-12-17  
**Scope:** Handler coordination gaps, state machine integration issues, manager lifecycle problems, and missing logging across coordinator layer

---

## Executive Summary

Beyond the five API limitations and ten implementation issues documented in prior audits, a comprehensive architectural scan has revealed twenty additional issues affecting handler coordination, state machine initialization, snapshot lifecycle management, and cross-component synchronization. These issues expose architectural fragmentation where multiple managers (StateMachine, MinimizedManager, quickTabsMap, MapTransactionManager) independently track Quick Tabs without centralized coordination or verification. Missing logging visibility compounds coordination failures, making it impossible to diagnose why handlers fail, why state becomes desynchronized, or why operations partially succeed. The most critical gap is that handlers attempt atomic operations across distributed systems without transaction support, timeout enforcement, or completion verification.

---

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|-----------|
| A1 | Mediator | **Critical** | State rollback doesn't account for partial handler modifications |
| A2 | State Machine | **High** | UNKNOWN state not initialized during hydration |
| A3 | UpdateHandler | **Critical** | Position persist race with minimize/restore state transitions |
| A4 | UpdateHandler | **Medium** | Orphaned tab recovery emits without validation |
| A5 | MinimizedManager | **Critical** | Snapshot waiting indefinitely for UICoordinator confirmation |
| A6 | MapTransactionManager | **High** | Lock is advisory-only, not enforced |
| A7 | DestroyHandler | **Medium** | No coordination with MinimizedManager cleanup |
| A8 | Multiple Handlers | **Critical** | Storage writes from CreateHandler, UpdateHandler, VisibilityHandler overlap |
| A9 | Initialization | **High** | No entry point for state machine setup from storage hydration |
| A10 | Mediator | **Medium** | Cannot distinguish partial from complete handler failures |
| A11 | UpdateHandler | **Medium** | EventBus dependency without registration verification |
| A12 | State Machine | **High** | State transitions not synchronized across contexts |
| A13 | MinimizedManager | **Medium** | Snapshots contain non-serializable object references |
| A14 | Mediator | **High** | Map cleanup operations not transactional in destroy |
| A15 | Mediator | **High** | Operation lock timeout (500ms) too short for real operations |
| A16 | Architecture | **High** | Handler initialization order implicit, not explicit |
| A17 | MinimizedManager | **Medium** | Minimized count tracking desynchronized with UI |
| A18 | Quick Tab IDs | **High** | ID format assumed valid but never validated |
| A19 | Event Bus | **Medium** | Event listeners not verified at registration |
| A20 | Storage | **High** | Persistence has no retry logic on write failure |

---

## Issue A1: Mediator State Rollback Incomplete on Partial Handler Failures

### Problem

The Mediator coordinates state transitions with handler execution for minimize/restore/destroy operations. When a handler returns failure, the mediator attempts to rollback the state machine transition. However, the handler itself may have partially succeeded before failing. The rollback only addresses the state machine, not the actual UI state changes made by the handler.

### Root Cause

**File:** `src/features/quick-tabs/mediator.js`  
**Location:** `minimize()` and `restore()` methods (~lines 165-170, 215-220)

**Issue:**
1. Mediator transitions state BEFORE calling handler (state machine → MINIMIZING)
2. Handler attempts minimize but only succeeds on 5 of 6 tabs
3. Handler returns success: false because 6th tab failed
4. Mediator rollbacks state machine to VISIBLE
5. But 5 tabs are already minimized in the UI

Result: State machine shows VISIBLE but actual UI shows 5 minimized + 1 visible. State desynchronization.

### Fix Required

Implement a detailed operation result structure that captures which tabs were actually modified vs. which failed. The state machine transition should only commit if ALL tabs in the batch succeed OR if handler returns a partial result structure with clear indication of what succeeded/failed. Add logging showing the before/after state of each tab in the operation.

---

## Issue A2: State Machine UNKNOWN State Not Properly Initialized During Hydration

### Problem

Quick Tabs loaded from storage during page load are not explicitly initialized into the state machine. They exist in UNKNOWN state indefinitely until first operation. The state machine allows transitions from UNKNOWN to either VISIBLE or MINIMIZED, but this indeterminate initial state creates unpredictable behavior. Tabs could transition UNKNOWN → VISIBLE even though they're stored as minimized.

### Root Cause

**File:** `src/features/quick-tabs/state-machine.js`  
**Location:** `VALID_TRANSITIONS` map (~line 35) shows UNKNOWN can transition to both VISIBLE and MINIMIZED

**Issue:**
1. State machine defines valid transitions from UNKNOWN
2. No explicit initialization during hydration from storage
3. Tabs start in UNKNOWN state when loaded from storage
4. First operation (ownership check, minimize, restore) triggers transition
5. But transition target is determined by operation, not by stored state

No guarantee that state machine state matches stored state after hydration.

### Fix Required

Create explicit hydration initialization that reads tabs from storage and calls `initialize(id, state, source)` with the correct state (VISIBLE or MINIMIZED based on stored state). Ensure this is called BEFORE ownership filtering or other operations. Add logging showing the transition from UNKNOWN to proper initial state for each tab.

---

## Issue A3: UpdateHandler Position/Size Persistence Race with Minimize/Restore

### Problem

UpdateHandler debounces position/size persistence at 300ms interval. If a tab is minimized during this window, the persisted state contains both minimized=true AND position/size data. This creates corrupted storage: minimized tabs should not have position/size in the Quick Tabs storage (position/size is in MinimizedManager snapshots).

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `handlePositionChangeEnd()` and `_persistToStorage()` (~lines 140-145, 310-330)

**Issue:**
1. User drags tab, position changes
2. handlePositionChangeEnd() schedules debounced persist (300ms)
3. User minimizes tab (VisibilityHandler transition)
4. Tab moved to MinimizedManager, minimized=true set
5. 300ms later, UpdateHandler persist writes old position/size to storage
6. Storage now has both minimized state AND position data (corruption)

### Fix Required

Before persisting, check if the tab has been transitioned to MINIMIZED state. If minimized, do not write position/size data to storage. Add guard: if current state is MINIMIZED, skip the update persist and defer to VisibilityHandler's storage write. Add logging showing why persist was skipped if tab state changed to minimized.

---

## Issue A4: Orphaned Tab Recovery Events Emitted Without Validation

### Problem

UpdateHandler detects orphaned tabs (DOM exists but no Map entry) and emits `tab:orphaned` event. However, the event is emitted with position/size data that may be stale or invalid. If DOM disappeared between detection and emission, or if updateData is malformed, the recovery mechanism attempts to restore invalid state.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `_checkDOMExists()` and `_emitOrphanedTabEvent()` (~lines 230-250)

**Issue:**
1. `_checkDOMExists()` uses synchronous `document.querySelector()` (can throw SecurityError)
2. Event emitted with updateData from position/size change
3. No validation that updateData structure is correct
4. No verification that receiver (UICoordinator) will process event
5. Fire-and-forget pattern: no confirmation event was handled

### Fix Required

Validate DOM existence using try-catch wrapper around querySelector. Validate updateData structure before emitting (position has left/top, size has width/height, all are numbers). Add defensive check that eventBus exists and has listeners registered before emitting. Add logging showing the validation checks performed before emission.

---

## Issue A5: MinimizedManager Snapshot Lifecycle Without Timeout Enforcement

### Problem

When a Quick Tab is restored, MinimizedManager moves its snapshot to `pendingClearSnapshots` and waits for UICoordinator to call `clearSnapshot()`. There is NO timeout. If UICoordinator crashes, abandons the restore, or runs in a context that can't call clearSnapshot, the snapshot hangs indefinitely in pendingClearSnapshots. On next restore attempt, old snapshot is re-applied instead of fresh data.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `restore()` method (~lines 280-320) and `clearSnapshot()` (~line 600)

**Issue:**
1. restore() atomically moves snapshot from minimizedTabs to pendingClearSnapshots
2. Returns snapshot to caller (UICoordinator)
3. UICoordinator should render and call clearSnapshot()
4. But no timeout if clearSnapshot() never called
5. Snapshot stays in pendingClearSnapshots indefinitely
6. Space leak: snapshots accumulate over time if UICoordinator reliability decreases

### Fix Required

Implement automatic snapshot expiration with timeout (~500-1000ms after restore). After timeout expires, move snapshot from pendingClearSnapshots back to minimizedTabs or delete it. Add logging showing snapshot moved to pending with timestamp and timeout start. Add logging when timeout fires showing which snapshots are being expired.

---

## Issue A6: MapTransactionManager Lock Is Advisory-Only, Not Enforced

### Problem

MapTransactionManager sets `_locked = true` during transactions, but this is an internal flag only. If code gets a direct reference to the underlying Map and calls `.set()` or `.delete()` directly, the lock is completely bypassed. The transaction's snapshot becomes invalid, and rollback would restore incorrect state.

### Root Cause

**File:** `src/features/quick-tabs/map-transaction-manager.js`  
**Location:** Constructor (~line 80) and `beginTransaction()` (~line 165)

**Issue:**
1. Map passed by reference to constructor: `this._map = targetMap`
2. Lock is internal flag: `this._locked = true`
3. No enforcement mechanism (Proxy, Object.freeze, etc.)
4. External code can bypass: `externalMapRef.set(key, value)` while transaction active
5. Transaction snapshot becomes stale mid-operation
6. Rollback restores wrong state

### Fix Required

Consider wrapping the Map in a Proxy that intercepts set/delete calls and validates lock state. Or implement a defensive check at transaction commit that verifies Map contents haven't been externally modified since snapshot was taken. Add comprehensive logging showing all external Map access attempts during locked state.

---

## Issue A7: DestroyHandler Does Not Coordinate with MinimizedManager Cleanup

### Problem

When a Quick Tab is destroyed, the handler removes it from quickTabsMap and StateMachine. However, if the tab is minimized, its snapshot remains in MinimizedManager. If UICoordinator is in the middle of restoring that tab when destroy happens, ghost snapshot data can reappear after destroy completes.

### Root Cause

**File:** `src/features/quick-tabs/handlers/DestroyHandler.js` and `src/features/quick-tabs/mediator.js`

**Issue:**
1. DestroyHandler called to remove Quick Tab
2. Removes from quickTabsMap
3. Removes from StateMachine
4. But does NOT call MinimizedManager.clear(id) or force cleanup
5. If tab is minimized, snapshot still exists
6. Later hydration or restore operation sees snapshot, re-creates ghost tab

### Fix Required

DestroyHandler should coordinate with MinimizedManager to ensure snapshots are cleared. Call MinimizedManager.forceCleanup(id) if tab is minimized before completing destroy. Add logging showing snapshot cleanup status (found and cleared, or not found) as part of destroy operation.

---

## Issue A8: Multiple Handlers Trigger Storage Writes Creating Out-Of-Order Problems

### Problem

Three handlers independently persist Quick Tabs state to storage with different timing:
- CreateHandler: immediately on tab creation
- UpdateHandler: debounced 300ms after position/size change
- VisibilityHandler: immediately on minimize/restore

If operations overlap (e.g., create tab, drag to new position, minimize), the writes may arrive at storage out-of-order or overwrite each other. A later write could overwrite an earlier one, losing data.

### Root Cause

**File:** Multiple files:
- `src/features/quick-tabs/handlers/CreateHandler.js` (immediate persist on create)
- `src/features/quick-tabs/handlers/UpdateHandler.js` (300ms debounce persist)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (immediate persist on minimize/restore)

**Issue:**
1. No centralized write coordinator
2. Each handler has own persistence trigger
3. No write sequencing or ordering
4. Writes can arrive at storage level in different order than issued
5. If write timestamps are microseconds apart, outcome unpredictable

### Fix Required

Implement a centralized storage coordination layer that queues all persist requests and sequences them. Use transaction timestamps or write IDs to ensure later operations don't overwrite earlier ones. Add detailed logging showing which handler triggered persist, what data was written, and in what order writes were sequenced.

---

## Issue A9: No Entry Point for State Machine Initialization from Storage Hydration

### Problem

The state machine has an `initialize()` method designed for hydration, but this method is never explicitly called during page load when tabs are loaded from storage. The critical entry point where tabs transition from storage to live state is not instrumented with state machine initialization. This was Issue 5 from the initial audit (hydration filter location verification).

### Root Cause

**File:** Initialization/hydration code not located during scan

**Issue:**
1. State machine designed for explicit initialization
2. Tabs loaded from storage at page load
3. But no code path calls `initialize(id, state, source)` during loading
4. Tabs remain in UNKNOWN state until first operation
5. Behavior becomes state-dependent on which operation happens first

### Fix Required

Locate hydration code path and add explicit state machine initialization immediately after tabs are loaded from storage. Call `initialize(id, isMinimized ? MINIMIZED : VISIBLE, 'hydration')` for each loaded tab. Ensure initialization happens BEFORE ownership filtering or other operations. Add logging showing initialization of each tab with its initial state.

---

## Issue A10: Mediator Cannot Distinguish Partial vs Complete Handler Failures

### Problem

When Mediator calls a handler (VisibilityHandler.handleMinimize, etc.), the handler returns a simple boolean success result. The Mediator cannot distinguish between these scenarios:
1. Complete failure: handler failed immediately, no tabs modified
2. Partial success: handler modified 5 tabs, failed on 6th
3. Complete success: handler modified all intended tabs

All three cases might return the same response structure, making rollback and recovery logic indeterminate.

### Root Cause

**File:** `src/features/quick-tabs/mediator.js`  
**Location:** `minimize()` and `restore()` methods (~lines 160-180)

**Issue:**
```
const result = this.visibilityHandler.handleMinimize(id, source);
if (!result.success) { rollback... }
```

The result object only contains `{ success: boolean, error?: string }`. It doesn't communicate which tabs were actually modified.

### Fix Required

Extend handler response to include details about which tabs were modified. Return structure like `{ success, error, modified: [tabId1, tabId2], failed: [tabId3] }`. Mediator can then decide whether to rollback based on actual impact, not just boolean success. Add logging showing the detailed result including which tabs were modified and which failed.

---

## Issue A11: EventBus Dependency Without Registration Verification

### Problem

UpdateHandler emits events on eventBus assuming it exists and listeners are registered. The optional chaining prevents errors but masks failures. If eventBus is null or listeners are not registered, events silently fail to emit, and recovery mechanisms never trigger.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `_emitOrphanedTabEvent()` (~line 205)

**Issue:**
```javascript
this.eventBus?.emit('tab:orphaned', {...})
```

The optional chaining silently skips emit if eventBus is null. No indication to handler that event failed to emit.

### Fix Required

Verify eventBus exists and is callable during handler initialization. Add explicit null check with warning if eventBus unavailable. Add logging showing event emission with listener count. Log failure if eventBus is null when emit is attempted.

---

## Issue A12: State Machine Transitions Not Synchronized Across Contexts

### Problem

The state machine is local to JavaScript context (content script, background script, or popup). If Quick Tab is modified in one context while another context is performing operations, state machine state becomes desynchronized. State machine shows VISIBLE but actual UI shows MINIMIZED (or vice versa) across contexts.

### Root Cause

**File:** `src/features/quick-tabs/state-machine.js`  
**Location:** Global singleton `stateMachineInstance`

**Issue:**
1. State machine is per-context singleton
2. Content script has its own state machine instance
3. Background script has separate state machine instance
4. If background modifies tab state, content script's state machine is unaware
5. State diverges between contexts

### Fix Required

State machine transitions should be coordinated via storage events or messaging. When state changes in one context, emit event or message to other contexts. Listen for storage changes and invalidate/update state machine state. Add logging showing cross-context state desynchronization when detected.

---

## Issue A13: MinimizedManager Snapshots Contain Non-Serializable References

### Problem

MinimizedManager snapshots store QuickTabWindow instances directly as object references. But snapshots are used across contexts and timing windows. If the QuickTabWindow instance becomes invalid (garbage collected, replaced, context lost), the snapshot contains a stale reference that will cause errors when applied.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `_buildSnapshot()` (~line 460)

**Issue:**
```javascript
const snapshot = {
  window: tabWindow,  // Direct reference, not serialized data
  savedPosition: {...}
}
```

Snapshots should store immutable data, not live object references.

### Fix Required

Store only serializable data in snapshots: ID, position, size, state flags. Do not store the window reference directly. When snapshot needs to be applied, caller provides current window instance. Add validation that snapshot data matches expected schema. Add logging showing serialized vs non-serialized data in snapshot.

---

## Issue A14: Map Cleanup Operations Not Transactional in Mediator Destroy

### Problem

Mediator.destroy() performs a sequence of Map cleanup operations without transaction wrapping:
1. Remove from MinimizedManager
2. Remove from UICoordinator
3. Remove from StateMachine
4. (quickTabsMap assumed cleaned elsewhere)

If any step fails, later steps might still execute, leaving orphaned entries in some managers but not others. State becomes permanently inconsistent.

### Root Cause

**File:** `src/features/quick-tabs/mediator.js`  
**Location:** `destroy()` method (~lines 290-330)

**Issue:**
No transaction wrapping. Operations are sequential but interdependent. Failure in step 2 doesn't prevent step 3.

### Fix Required

Use MapTransactionManager to wrap multi-step cleanup. Begin transaction, perform all removals, validate all removed, then commit. On validation failure, rollback all changes. Add logging showing transaction state (begin, individual operations, commit/rollback).

---

## Issue A15: Mediator Operation Lock Timeout (500ms) Too Short

### Problem

OPERATION_LOCK_MS = 500ms prevents duplicate operations by holding a lock. However, actual Quick Tab operations can take >500ms on slow connections or heavy pages. If operation takes 600ms, lock expires at 500ms, duplicate operation is allowed, causing race condition.

### Root Cause

**File:** `src/features/quick-tabs/mediator.js`  
**Location:** Line 22 defines OPERATION_LOCK_MS = 500

**Issue:**
Timeout chosen without measuring actual operation duration. Browser storage operations, DOM operations, and event processing can exceed 500ms.

### Fix Required

Increase timeout to at least 2-5 seconds or implement per-operation timeout that adjusts based on operation type. Long-running operations should extend their own lock. Add logging showing lock acquired, lock held duration, lock released, and any operations rejected due to held lock.

---

## Issue A16: Handler Initialization Order Dependencies Are Implicit

### Problem

Multiple handlers are initialized in a specific order, but dependencies are implicit in the code structure, not explicit. If initialization order is changed or a handler initialization fails, dependent handlers may initialize with incomplete shared state.

### Root Cause

**File:** `src/features/quick-tabs/index.js` (initialization sequence)

**Issue:**
1. Handlers depend on shared resources: quickTabsMap, eventBus, minimizedManager
2. Initialization order is hardcoded but not documented
3. If CreateHandler initializes before VisibilityHandler setup, and CreateHandler calls VisibilityHandler methods, race condition
4. No validation that dependencies are available before handler initializes

### Fix Required

Document explicit initialization order with dependency comments. Add validation that all dependencies are available before each handler initializes. Add logging showing initialization sequence and dependency resolution for each handler.

---

## Issue A17: Minimized Tab Count Tracking Desynchronized with UI

### Problem

MinimizedManager.getCount() returns minimizedTabs.size, but actual minimized tabs include pendingClearSnapshots (tabs waiting for UICoordinator to confirm restore). When restore() happens, tab moves to pendingClear but getCount() shows it as not minimized. Manager UI displays wrong "N minimized tabs" count.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `getCount()` method (~line 560)

**Issue:**
Two separate Maps track minimized state:
- minimizedTabs: currently minimized
- pendingClearSnapshots: minimized but in restore process

getCount() only checks minimizedTabs, excluding pendingClear entries that are still logically minimized.

### Fix Required

Implement getActualMinimizedCount() that includes both minimizedTabs and pendingClearSnapshots. Use this for UI display. Add logging showing count breakdown: minimizedTabs count + pendingClear count = total.

---

## Issue A18: Quick Tab ID Format Assumed Valid But Never Validated

### Problem

Quick Tab IDs follow pattern `qt-{tabId}-{timestamp}-{random}` but the format is never validated at entry points. Code contains `extractTabIdFromQuickTabId()` that uses regex to parse the tabId segment, but if format is violated, extraction fails silently returning null. This cascades: null originTabId → ownership validation fails → cross-tab leakage.

### Root Cause

**File:** Multiple files:
- `src/features/quick-tabs/minimized-manager.js` (extractTabIdFromQuickTabId function)
- CreateHandler, VisibilityHandler (ID generation)

**Issue:**
1. CreateHandler generates IDs without validation that format is correct
2. IDs propagate through system
3. extractTabIdFromQuickTabId() regex depends on format but format never enforced
4. Silent failures: if regex doesn't match, returns null (ownership fails)

### Fix Required

Add schema validation function that verifies Quick Tab ID format. Validate at ID creation time in CreateHandler. Return error if format invalid. Add logging showing ID validation (success or failure) with format expectations.

---

## Issue A19: Event Bus Listeners Not Verified at Registration

### Problem

Multiple handlers emit events expecting listeners to be registered. However, there's no startup verification that listeners actually exist. Events silently fail to trigger recovery if listeners are missing. Example: UpdateHandler emits `tab:orphaned`, but if no listener is registered, orphaned tab recovery never happens.

### Root Cause

**File:** Event bus initialization (location not fully scanned)

**Issue:**
1. No central event registration verification
2. Handlers emit events assuming listeners exist
3. Optional chaining masks silent failures
4. No indication in logs that listeners are missing

### Fix Required

At startup, verify all expected event listeners are registered. Collect list of expected events (tab:orphaned, tab:restored, etc.) and verify listeners for each. Add logging showing registered listeners and which events have listeners vs. which are orphaned (no listeners).

---

## Issue A20: Storage Persistence Has No Retry Logic on Write Failure

### Problem

When persistStateToStorage() write fails (quota exceeded, network timeout, permission denied), there's a 500ms timeout and fallback cleanup, but NO retry logic. If first write fails, state is silently lost. Subsequent writes might succeed but database is in inconsistent state. Critical data is not recovered.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `persistStateToStorage()` function

**Issue:**
1. Storage write executed
2. If promise rejects or times out after 500ms, returns false
3. No retry attempt
4. Caller doesn't know write failed
5. State left in inconsistent state

### Fix Required

Implement exponential backoff retry logic (3 attempts with increasing delays). Log each retry attempt showing failure reason. If all retries fail, emit event/warning. Add logging showing write attempt, any errors, retry count, and final success/failure status.

---

## Shared Implementation Notes

### Handler Coordination Pattern

All handlers should follow coordinated operation pattern:
1. Validate inputs and state preconditions with logging
2. Coordinate with related managers (MinimizedManager, StateMachine)
3. Emit events for cross-context awareness
4. Log detailed operation results (what succeeded, what failed)
5. Return detailed result structures, not boolean success

### Logging Standards for Coordination Issues

Coordination-related logging should include:
- Operation ID (to track across contexts and logs)
- Handler name and method
- State before/after
- Managers contacted and their responses
- Timing information (how long operation took)
- Success/failure with reason

### Manager Initialization Sequencing

Manager dependencies should be explicit:
- StateMachine initializes first (foundational)
- MinimizedManager initializes second (depends on state machine concepts)
- MapTransactionManager wraps Map access
- Handlers initialize last (depend on managers)
- EventBus verified as active before handler initialization

---

## Acceptance Criteria

### Issue A1 - Mediator Rollback
- Mediator distinguishes partial vs complete handler failures
- State machine rollback only commits if handler fully succeeds
- Logging shows which tabs were modified in failed operation

### Issue A2 - State Machine Initialization
- All tabs loaded from storage call initialize(id, state)
- UNKNOWN state transitions never occur after hydration
- Logging shows initialization of each tab with timestamp

### Issue A3 - UpdateHandler Persistence
- UpdateHandler checks tab state before writing position/size
- Minimized tabs skip position/size persist (uses MinimizedManager snapshot instead)
- Logging shows why persist was skipped if state changed

### Issue A5 - Snapshot Timeout
- Snapshots in pendingClear expire after timeout (~1000ms)
- Expired snapshots moved back to minimizedTabs or deleted
- Logging shows snapshot lifecycle with timestamps

### Issue A8 - Storage Write Coordination
- All storage writes coordinated through single sequencer
- Write ordering preserved at storage level
- Logging shows write queue, individual writes, commit order

### Issue A15 - Lock Timeout
- Operation lock timeout configurable per operation type
- Long operations extend own lock
- Lock never expires during active operation
- Logging shows lock acquired, duration, expiration

### Issue A20 - Storage Retry
- Failed storage writes retry up to 3 times
- Exponential backoff between retries (100ms, 500ms, 1000ms)
- Each retry logged with failure reason
- Final result logged as success or exhausted retries

### All Issues
- All existing tests pass
- No new console errors related to coordination
- Manual verification: Create tab, drag multiple times, minimize - state stays consistent
- Manual verification: Storage contains only expected data (no duplicates or corruption)
- Cross-context consistency: Same tab viewed in different contexts shows same state

---

## Supporting Context

<details>
<summary><b>Mediator Coordination Flow</b></summary>

Expected minimize operation flow:
1. Mediator.minimize(id) called
2. Acquire operation lock (500ms guard)
3. Check state machine: is VISIBLE?
4. Transition state machine: VISIBLE → MINIMIZING
5. Call VisibilityHandler.handleMinimize(id)
   - Handler returns detailed result { success, modified, failed }
6. If failure, rollback state machine: MINIMIZING → VISIBLE
7. If partial success, log detailed failure info
8. If complete success, transition: MINIMIZING → MINIMIZED
9. Release operation lock
10. Emit events for cross-context sync
11. Return detailed operation result

Missing: Per-tab logging of what was modified, timeout enforcement, event emission.

</details>

<details>
<summary><b>Storage Write Sequencing</b></summary>

Current problematic flow:
1. User creates tab → CreateHandler.create() → persistStateToStorage() immediately
2. User drags tab → UpdateHandler.handlePositionChangeEnd() → schedule persist (300ms)
3. User minimizes tab → VisibilityHandler.handleMinimize() → persistStateToStorage() immediately
4. Writes arrive at storage: [minimized at ~0ms, position at ~300ms after create]
5. If position write arrives before minimize write, storage has position data for minimized tab (corruption)

Required: Central write queue that enforces ordering: create → minimize → position, not interleaved.

</details>

<details>
<summary><b>MinimizedManager Snapshot Lifecycle</b></summary>

Current problematic flow:
1. Tab minimized → snapshot created in minimizedTabs
2. User clicks restore → snapshot moved to pendingClearSnapshots
3. UICoordinator renders restored tab
4. UICoordinator should call clearSnapshot()
5. **But if UICoordinator crashes at step 3:**
   - clearSnapshot() never called
   - Snapshot stays in pendingClearSnapshots indefinitely
   - Space leak accumulates
   - On next restore, old snapshot re-applied (wrong data)

Required: Automatic expiration with timeout, fallback cleanup.

</details>

---

## Priority & Complexity

**Priority:** Critical (Issues A1, A3, A5, A8), High (Issues A2, A6, A9, A12, A14, A15, A16, A18, A20), Medium (Issues A4, A7, A10, A11, A13, A17, A19)

**Target:** Fix in coordinated PR with Issues 1-15 from prior audits

**Estimated Complexity:**
- A1: Medium (refactor rollback logic)
- A2: Medium (locate hydration, add initialization)
- A3: Low (add guard check)
- A4: Low (add validation)
- A5: Medium (implement expiration)
- A6: High (implement Proxy or validation)
- A7: Low (add cleanup call)
- A8: High (implement write sequencer)
- A9: Medium (locate and instrument hydration)
- A10: Medium (extend result structure)
- A11: Low (add verification)
- A12: High (implement context sync)
- A13: Medium (refactor snapshot data)
- A14: Medium (wrap in transaction)
- A15: Low (increase timeout)
- A16: Low (add documentation and validation)
- A17: Low (fix count calculation)
- A18: Low (add validation function)
- A19: Low (add verification at startup)
- A20: Medium (implement retry logic)

---

**Document Version:** 1.0 - Architectural Coordination Issues  
**Prepared By:** Comprehensive Code Audit Phase 2 - Second Pass (Scan Date: 2025-12-17)  
**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**For:** GitHub Copilot Coding Agent  
**Related Documents:** 
- API Limitations Analysis (Limitations 1-3)
- Critical Architecture Issues (Issues 1-5)
- Supplemental Issues (Issues 6-15)
