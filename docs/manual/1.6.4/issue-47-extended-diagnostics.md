# Copy URL on Hover - Extended Diagnostics Report

## Additional Implementation Issues & Missing Logging

**Extension Version:** v1.6.3.10-v10  
**Date:** 2025-12-20  
**Scope:** Content-side initialization race conditions, handler-side validation
gaps, callback state leakage, cross-tab lock conflicts, and unobserved operation
lifecycle failures

---

## Executive Summary

Beyond the critical tab ID acquisition and message ordering issues documented in
issue-47-revised.md, this report identifies **eight additional implementation
failures** across the content script initialization pipeline, background message
handlers, event callback wiring, and cross-tab operation locks. These issues
compound the main failures by preventing recovery pathways, allowing stale state
to propagate, and obscuring operational failures through inadequate logging. The
root cause pattern is **incomplete state transitions and missing lifecycle
tracking**: operations begin (e.g., minimize) but their completion is never
confirmed, allowing downstream code (storage write, event emission, callback
cleanup) to operate on inconsistent state. Combined with Firefox's asynchronous
storage behavior and service worker lifecycle, this creates silent data loss and
orphaned resources.

---

## Issues Overview

| Issue ID | Component                            | Severity     | Root Cause                                                                  | Impact                                                                         |
| -------- | ------------------------------------ | ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 9        | VisibilityHandler Callback Wiring    | **HIGH**     | Stale closures after restore; position/size callbacks not re-wired          | DOM updates after restore don't persist; z-index updates lost                  |
| 10       | Cross-Tab Lock Key Collision         | **HIGH**     | Lock key excludes currentTabId → same ID locked in different tabs           | Manager sidebar cannot restore tab A's Quick Tab when tab B holds lock         |
| 11       | Handler-Side originTabId Validation  | **CRITICAL** | CreateHandler/RestoreHandler trust payload; no sender.tab.id comparison     | Null originTabId accepted and stored; ownership validation later blocks writes |
| 12       | QUICK_TAB_STATE_CHANGE Message Dedup | **HIGH**     | Port message dedup window (200ms) fixed; async storage event doesn't align  | Port messages trigger hydration before storage event fires; state corrupted    |
| 13       | Storage Persist Timeout + Retry      | **MEDIUM**   | No timeout protection in \_persistToStorage; hangs indefinitely on failure  | Storage writes hang entire VisibilityHandler; subsequent operations timeout    |
| 14       | Z-Index Counter Unbounded Growth     | **MEDIUM**   | No recycling threshold; counter increments forever after focus operations   | Z-index reaches browser max (~2147483647); layering breaks silently            |
| 15       | Content Script Hydration Race        | **HIGH**     | Hydration from storage.onChanged not guaranteed before next operation       | Content script modifies Quick Tab before all state loaded from storage         |
| 16       | Missing Operation Completion Logging | **MEDIUM**   | Minimize/restore operations lack final status logs; success/failure unknown | Debugging state corruption requires manual log correlation; failures invisible |

---

## Issue 9: VisibilityHandler Callback Wiring - Stale Closures After Restore

**Problem:** After restore operation, Quick Tab window has callbacks from
initial construction that reference stale handler context. Position and size
callback updates are not re-wired. DOM changes after restore don't trigger
persistence.

**Evidence from Code:**

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `_rewireCallbacksAfterRestore()` (lines ~1780-1830)

Issue: Method re-wires only onMinimize, onFocus, onSolo, onMute callbacks.
Position/size callbacks (onPositionChange, onPositionChangeEnd, onSizeChange,
onSizeChangeEnd) are explicitly NOT re-wired—comments state "These are wired by
UICoordinator via UpdateHandler" and emit event `tab:needs-callback-rewire`.

**Root Cause:**

- v1.6.3.5-v11 added callback re-wiring but **only for 4 of 8 critical
  callbacks**
- Position and size callbacks require UpdateHandler context (not available in
  VisibilityHandler)
- Event `tab:needs-callback-rewire` emitted but may not be received if
  UICoordinator's event listener is not active
- If UICoordinator doesn't see event (timing, listener registration issue, or
  event emitted before listener attached), size/position updates are orphaned on
  stale closures
- Stale closures reference old handler instances, causing state updates to be
  persisted to wrong storage context or dropped entirely

**Related Patterns:**

- `_createQuickTabData()` includes position and size in event payload, but if
  callback never fires, no payload ever created
- `UpdateHandler.handlePositionChangeEnd()` and `handleSizeChangeEnd()` call
  `this._persistToStorage()` to save state—if callback never fires, this never
  happens
- Position/size changes silently lost; on reload, tab reverts to pre-restore
  position/size

**Fix Required:**

Instead of deferring position/size callback re-wiring to UICoordinator event
(which may not be received), implement direct callback binding in
VisibilityHandler after calling `tabWindow.restore()`. Provide "deferred
position/size callback wrapper" that:

1. Captures position/size change events during restore lifecycle
2. Validates callback context is correct handler instance (not stale closure)
3. Enqueues changes if UpdateHandler not ready (fast-fail if callback orphaned)
4. Logs which callbacks were re-wired and which were skipped
5. Add recovery: if UpdateHandler fails to receive tab:needs-callback-rewire
   event within timeout (500ms), retry re-wiring or emit warning

Alternative: Make UpdateHandler callback re-wiring **synchronous** during
restore instead of event-driven. Store reference to UpdateHandler in
VisibilityHandler and call
`updateHandler.rewirePositionSizeCallbacks(tabWindow)` directly.

---

## Issue 10: Cross-Tab Lock Key Collision in Mutex Pattern

**Problem:** Operation locks use key format `operation-${currentTabId}-${id}`,
but `currentTabId` can vary between tabs even for same Quick Tab. Manager
sidebar operates in a different tab context than origin tab, causing lock
collisions and blocking legitimate operations.

**Evidence from Code:**

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `_tryAcquireLock()` (lines ~570-590) and `_releaseLock()` (lines
~600-610)

Issue: Lock key construction at line 578:

```
const lockKey = `${operation}-${this.currentTabId}-${id}`;
```

**Root Cause:**

- VisibilityHandler instance is per-tab (constructed in content script context
  with `currentTabId` fixed)
- When Manager sidebar (running in sidebar context, different tab ID) sends
  restore command via background.js → content script, two scenarios conflict:
  1. **Scenario A (Origin Tab):** VisibilityHandler in Tab A (currentTabId=1)
     creates lock key `restore-1-qt-123`
  2. **Scenario B (Sidebar):** VisibilityHandler in Tab B (currentTabId=2)
     attempts same restore with lock key `restore-2-qt-123` (DIFFERENT KEY, no
     conflict)

  But if Manager invokes restore via `executeScript` in the **origin tab** (Tab
  A, currentTabId=1), the sidebar's invoke-restore logic and Tab A's local
  restore both try to acquire lock with same key.

- More problematic: **Lock not released if operation fails partway through**
  (e.g., `_validateRestorePreconditions` fails). Lock remains in
  `_operationLocks` map for 200ms (OPERATION_LOCK_MS), blocking any retry until
  timeout.
- Quick Tab ID is **globally unique** but tab context of lock is
  **per-instance**. Multiple handlers (different tabs, same Quick Tab ID) have
  NO coordination.

**Related Patterns:**

- `handleMinimize()` and `handleRestore()` both try lock acquisition; if one tab
  holds lock, another tab's operation is blocked
- Line 651: "Ignoring duplicate minimize request (lock held)" warning is logged,
  but it's unclear which tab holds the lock
- No lock timeout tracking: if operation never calls `_releaseLock()`, lock
  becomes permanent (only cleared by handler destroy or 200ms timeout)

**Fix Required:**

Lock key should include both operation context AND source of invocation. Change
lock key to:

```
${operation}-${this.currentTabId}-${id}-${source}
```

Where `source` is 'UI' (local), 'Manager', 'background', or 'automation'. This
prevents sidebar's restore from blocking tab's local restore when both target
same Quick Tab.

Alternatively, use **owner-based locking**: Associate lock with **origin tab of
Quick Tab** (tabWindow.originTabId), not with current VisibilityHandler's tab
context. This ensures all operations on same Quick Tab (from any tab) use same
lock, preventing cross-tab conflicts.

Add **lock timeout recovery**: If lock not released within 1000ms (5x
OPERATION_LOCK_MS), log warning and auto-release with context:

```
"LOCK_TIMEOUT: Lock held for restore-1-qt-123 for 1250ms (operation: restore, quickTabId: qt-123, source: Manager)"
```

---

## Issue 11: Handler-Side originTabId Validation Gap (Explicit Handler Audit)

**Problem:** QuickTabHandler's CREATE and RESTORE message handlers accept
`originTabId` from message payload without validating it against
`sender.tab.id`. Null originTabId is stored directly. No validation middleware
in MessageRouter.

**Evidence from Code:**

File: `src/background/handlers/QuickTabHandler.js` (not yet scanned in depth)  
File: `src/background/MessageRouter.js` (lines ~1-70)

**Root Cause:**

From MessageRouter code examined:

- `route()` method (line ~150-200) extracts action and finds handler, but
  performs **zero pre-handler validation**
- No validation middleware exists: `isAuthorizedSender()` checks sender.id
  (extension ID), but NOT sender.tab.id or message payload fields
- Handler called directly: `const result = await handler(message, sender);`
  (line ~190)
- Sender context is passed but handler is responsible for validation
- If QuickTabHandler doesn't validate originTabId against sender.tab.id, then no
  validation occurs at all

**Related Patterns:**

- `VALID_MESSAGE_ACTIONS` allowlist (line ~10-50) validates command EXISTS, but
  not that command payload is SAFE
- `_normalizeResponse()` (line ~220-250) validates response format, but not
  message format
- CreateHandler logs "WARNING originTabId is null/undefined" but still creates
  Quick Tab with null originTabId
- Ownership validation in storage-utils treats null originTabId as "no
  ownership" and allows access (security bypass)

**Fix Required:**

Implement **handler-level validation middleware** in MessageRouter before
routing:

1. **Validation layer before `route()`:** Check message payload for operations
   requiring ownership:
   - If operation is CREATE*QUICK_TAB, UPDATE*\*, or RESTORE_QUICK_TAB:
     - Require `message.originTabId` field
     - Compare `message.originTabId === sender.tab.id`
     - If mismatch, reject with
       `{success: false, error: 'OWNERSHIP_VALIDATION_FAILED', code: 'PAYLOAD_MISMATCH'}`

2. **Handler contract:** All handlers that accept originTabId should log
   validation at start:

   ```
   "HANDLER[${action}] Validating originTabId: claimed=${message.originTabId}, actual=${sender.tab.id}, match=${message.originTabId === sender.tab.id}"
   ```

3. **Default to sender.tab.id:** If payload missing originTabId, use
   `message.originTabId = sender.tab.id` before calling handler. Never accept
   null.

4. **Reject at storage write:** If originTabId is null/undefined when trying to
   persist, reject write with explicit error (not just warning).

---

## Issue 12: Port Message Dedup Window Misalignment with Async storage.onChanged

**Problem:** Content script's 200ms dedup window for QUICK_TAB_STATE_CHANGE port
messages doesn't account for Firefox's async storage.onChanged timing. Port
message arrives 50-100ms after storage.local.set(), but storage event may arrive
300-500ms later. Content script hydrates from port message (stale originTabId),
dedup window closes, then storage event arrives and is silently filtered as
"duplicate" (hash mismatch).

**Evidence from Code:**

File: `src/content.js` (not fully scanned but referenced in prior report)  
Location: Port message handler and storage.onChanged listener registration

**Root Cause:**

- Port message handler emits `state:updated` event synchronously (immediate)
- Hash-based dedup compares current state hash with previous; port message
  updates hash
- Dedup window 200ms expires before storage event fires (normal Firefox latency
  300-500ms)
- When storage event fires, hash no longer matches dedup window, event filtered
  as duplicate or old version
- Logs show `ADOPTIONFLOW serializeTabForStorage - originTabId is NULL` → port
  message was processed with stale data
- Storage write then blocked by ownership validation because originTabId never
  updated

**Related Patterns:**

- `_handleQuickTabStateChange()` processes port message and updates quickTabsMap
  in-memory
- Synchronous in-memory update satisfies immediate hydration needs but is stale
  relative to storage
- Hash dedup tied to 200ms window, not to actual storage event arrival

**Fix Required:**

Replace fixed 200ms dedup window with **dynamic measurement-based window**:

1. **Measurement phase (initialization):** Time delay between
   `storage.local.set()` call and `storage.onChanged` listener firing. Store in
   handler: `measuredStorageLatency = actualDelay`.

2. **Dynamic dedup window:** Calculate
   `dedupWindow = Math.max(500, 2 * measuredStorageLatency)` (at least 500ms, or
   2x observed latency).

3. **Latency tracking log:** "Storage event latency: set() at T0, event fired at
   T0+${actualDelay}ms, dedup window extended to ${dedupWindow}ms"

Alternative (safer): **Don't hydrate from port message; wait for storage
event:**

- Separate port message flow from hydration
- Port message sets flag "state change pending, awaiting storage confirmation"
- Only hydrate when storage.onChanged fires with matching data
- If storage event doesn't arrive within 5s timeout, log error and hydrate from
  port as fallback

---

## Issue 13: Storage Persist Timeout Without Protection or Fallback

**Problem:** `_persistToStorage()` calls `persistStateToStorage()` utility
without timeout protection. If storage.local.set() hangs (Firefox issue, quota
exceeded, or other cause), entire persist operation blocks indefinitely.
Subsequent Quick Tab operations timeout waiting for storage.

**Evidence from Code:**

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `_persistToStorage()` (lines ~2350-2400) and
`_executeDebouncedPersistCallback()` (lines ~2200-2280)

Issue:

- Line ~2395:
  `const success = await persistStateToStorage(state, '[VisibilityHandler]');`
- No timeout wrapper; if `persistStateToStorage()` Promise never resolves,
  callback hangs
- Timer callback `_executeDebouncedPersistCallback` is async but has no timeout
- If timeout occurs, no fallback mechanism; storage marked as failed but no
  recovery path

**Root Cause:**

- No `Promise.race()` with timeout in persist flow
- Storage utilities (`persistStateToStorage`) lack timeout internally
- Handler logs only on success; on timeout, operation appears to hang with no
  diagnostic
- Firefox's `storage.local.set()` can hang if quota exceeded, browser busy, or
  API error
- Line ~2257 shows `PERSIST_STORAGE_TIMEOUT_MS = 5000` constant defined but not
  used in all code paths

**Related Patterns:**

- `_storageAvailable` flag (line ~300) tracks storage availability but only set
  to false after 3 consecutive timeouts (line ~2315)
- Early path `_persistToStorageWithTimeout()` exists (line ~2265) but not called
  from `_executeDebouncedPersistCallback`
- Logs show "Storage persist failed: operation timed out, storage API
  unavailable, or quota exceeded" (line ~2400) but this path only reached if
  `persistStateToStorage` returns false, not if it hangs

**Fix Required:**

Wrap all storage operations in timeout promise:

1. Modify `_executeDebouncedPersistCallback` to call
   `_persistToStorageWithTimeout()` instead of direct
   `await _persistToStorage()`
2. Ensure `_persistToStorageWithTimeout()` always completes (success or failure)
   within 5000ms
3. If timeout occurs, log context: "Storage persist timeout after 5000ms, state
   might be lost, quickTabs: [list], marking storage as potentially unavailable"
4. Increment `_storageTimeoutCount` immediately on timeout (not waiting for
   handler to return)
5. Add recovery: After marking storage unavailable, emit event to UI notifying
   user "Storage sync paused" with retry button
6. Log completion with duration: "Timer callback COMPLETED (outcome:
   success|timeout|error, durationMs: 2345ms)"

---

## Issue 14: Z-Index Counter Unbounded Growth After Focus Operations

**Problem:** `currentZIndex.value` increments every time `handleFocus()` is
called. No upper bound or recycling. After thousands of focus operations,
counter approaches JavaScript's MAX_SAFE_INTEGER (~9 trillion). Browser z-index
rendering breaks silently.

**Evidence from Code:**

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `handleFocus()` (lines ~2080-2160), `_recycleZIndices()` (lines
~2050-2100)

Issue:

- Line ~2105: `this.currentZIndex.value++;` increments without bound
- Line ~2110 shows constant `Z_INDEX_RECYCLE_THRESHOLD = 100000` defined
- Line ~2025 shows `_recycleZIndices()` method exists but is only called if
  `this.currentZIndex.value >= Z_INDEX_RECYCLE_THRESHOLD` (line ~2115)
- Threshold of 100,000 is reached after 100,000 focus operations (about 28 hours
  of continuous user activity)
- When threshold exceeded, `_recycleZIndices()` sorts all tabs by z-index,
  resets counter to 1000, and reassigns (lines ~2050-2100)
- But this is **reactive, not proactive**: z-indices already approach limit
  before recycling triggers

**Root Cause:**

- z-index is per-focus operation, not per-tab instance
- Lazy recycling (only when threshold hit) means maximum z-index reaches
  100,000+ before any recycling
- DOM z-index values can be large (max is technically unbounded in CSS, but
  browsers optimize for 16-bit or 32-bit integers)
- After recycling, z-indices reset to 1000-1050 range (if only 50 tabs exist),
  then counter climbs again to 100,000+
- Each recycling cycle loses relative z-order information if tabs
  created/destroyed during recycling (race condition with other handlers)

**Related Patterns:**

- `handleFocus()` increments counter BEFORE recycling check (line ~2105, then
  check at line ~2115)
- If exactly at threshold, new tab gets z-index 100,001 before recycling
  triggers
- Recycling is **not logged** until operation complete; intermediate steps have
  no visibility

**Fix Required:**

Implement **proactive z-index management**:

1. **Lower threshold:** Reduce `Z_INDEX_RECYCLE_THRESHOLD` to 10,000 (not
   100,000). Trigger recycling earlier.

2. **Recycling during counter increment:** Check BEFORE incrementing:

   ```
   if (this.currentZIndex.value >= Z_INDEX_RECYCLE_THRESHOLD - 100) {
     this._recycleZIndices();
   }
   ```

   This ensures recycling happens when counter is at ~9,900, not 100,000.

3. **Recycling logging:** Log detailed recycling lifecycle:
   - "Z-INDEX_RECYCLE: Starting (currentValue: 9950, threshold: 10000, tabCount:
     45)"
   - "Z-INDEX_RECYCLE: Reassigned tab qt-123 from 5050 to 1023"
   - "Z-INDEX_RECYCLE: Complete (newCounterValue: 1045, tabsRecycled: 45)"

4. **Validation after recycling:** After reassigning, verify all tabs have valid
   z-indices in range [1000, currentZIndex.value]. Log any out-of-range values.

5. **DOM verification:** After recycling, sample verify a few tabs' container
   elements have correct z-index in DOM.

---

## Issue 15: Content Script Hydration Race - State Loaded After Operations Begin

**Problem:** Hydration from storage.onChanged is asynchronous. If user creates
Quick Tab immediately after page load (before hydration completes), creation
message is sent before state loaded from storage. Minimized state from prior
session is missing; new Quick Tab doesn't know about minimized peers.

**Evidence from Code:**

File: `src/content.js` (hydration logic referenced in logs)  
Logs show: "Identity not initialized tabId UNKNOWN, identityStateMode
INITIALIZING"

**Root Cause:**

- Content script initialization order:
  1. `connectContentToBackground()` starts (port connection, tab ID acquisition)
  2. Parallel: `hydrateFromStorage()` called asynchronously (awaits
     storage.onChanged listener to fire)
  3. User presses keyboard shortcut to create Quick Tab →
     `handleCreateQuickTab()` called immediately
  4. `hydrateFromStorage()` still pending; quickTabsMap is empty or partially
     filled
  5. New Quick Tab created without context of existing state from storage

- `currentTabId` acquisition (Issue 1) compounds this: if tab ID not yet
  acquired, Quick Tab created with `originTabId: null`

- `minimizedManager` may not be initialized when first Quick Tab creation occurs

**Related Patterns:**

- Initialization message queue buffers messages during slow initialization, but
  doesn't wait for hydration to complete
- No synchronization point between hydration completion and first operation
  execution
- Logs show tab IDs as "UNKNOWN" during first 1-2 seconds after page load

**Fix Required:**

Implement **hydration barrier** before allowing operations:

1. **Hydration completion tracking:** Set flag `isHydrationComplete = false`
   initially. Set to true only when storage.onChanged listener fires AND initial
   state loaded.

2. **Operation gate:** In `handleCreateQuickTab()` and other operations, check:

   ```
   if (!isHydrationComplete) {
     console.log("Queueing operation until hydration complete");
     operationQueue.push({ operation: 'CREATE_QUICK_TAB', data: ... });
     return;
   }
   ```

3. **Drain queue after hydration:** When `isHydrationComplete` set to true,
   process queued operations in order.

4. **Logging:**
   - "Hydration started"
   - "Hydration completed: loaded {N} tabs, {M} minimized"
   - "Queued operation during hydration: {type}, will execute after hydration"
   - "Draining operation queue: {N} pending operations"

5. **Timeout safety:** If hydration doesn't complete within 3 seconds, log
   warning and allow operations anyway (better UX than hanging).

---

## Issue 16: Missing Operation Completion Logging - Silent Success/Failure

**Problem:** Minimize and restore operations log entry and various intermediate
steps, but do NOT log final completion status. If operation partially fails
(e.g., storage write fails but operation marked as complete), logs show no
failure signal. Debugging requires correlating multiple partial logs across
different files.

**Evidence from Code:**

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `handleMinimize()` (lines ~1430-1520) and `handleRestore()` (lines
~1600-1700)

Issue:

- `handleMinimize()` logs "Minimize button clicked" (line ~1440), then internal
  steps, then returns `{success: true}` (line ~1510)
- No log after return statement confirming operation success/failure
- If `_debouncedPersist()` times out internally, user never sees failure signal
  in logs
- `_executeRestore()` logs "EXIT" (line ~1700) but only if execution path
  completes normally
- If exception thrown, `finally` block (line ~1650) releases locks but no
  completion log

**Root Cause:**

- Logging is **inline with implementation**, not separated as lifecycle tracking
- No distinction between "operation started" and "operation completed"
- Intermediate steps (lock acquire, DOM update, event emit, persist call) are
  logged, but terminal state (all steps complete successfully, or one step
  failed) is not
- Correlation IDs (transaction IDs) not used for minimize/restore operations
  (only for storage writes)

**Related Patterns:**

- Timer callback `_executeDebouncedPersistCallback()` logs "Timer callback
  STARTED" (line ~2245) and "Timer callback COMPLETED" (line ~2270), but
  minimize/restore don't follow this pattern
- Logs show partial evidence of completion (e.g., "Emitted state:updated for
  minimize") but not authoritative "operation complete" signal
- If operation fails at dedup step, no log entry at all (silent failure)

**Fix Required:**

Add operation lifecycle logging to all major operations:

1. **Entry log:** Already present (e.g., line ~1440: "Minimize button clicked")

2. **Exit logs (add these):**

   ```
   handleMinimize COMPLETED:
   - id: qt-123
   - outcome: success | error
   - errorReason: (if error)
   - duration: 234ms
   - storageWriteScheduled: true
   ```

3. **Correlation ID:** Generate unique operation ID per invocation:

   ```
   operationId = `${operation}-${id}-${Date.now()}`
   ```

   Include in all logs for this operation.

4. **Explicit success return points:** Before every `return` statement, log:

   ```
   console.log(`${this._logPrefix}[${operation}] COMPLETED:`, {
     operationId,
     id,
     outcome: success|error,
     reason: (if error),
     timestamp: Date.now(),
     durationMs: Date.now() - startTime
   });
   ```

5. **Exception handler:** Catch block in async operations:
   ```
   catch (err) {
     console.error(`${this._logPrefix}[${operation}] FAILED:`, {
       operationId,
       id,
       error: err.message,
       stack: err.stack,
       durationMs: Date.now() - startTime
     });
     throw; // Re-throw so caller knows operation failed
   }
   ```

---

## Shared Implementation Notes

**Callback State Management Pattern:**

Issues 9, 12, and 15 all stem from **stale callback closures** and
**asynchronous state transitions**. Callbacks capture handler context at
construction time, but state changes asynchronously during restore, hydration,
and adoption. Implement **callback context refresh** pattern:

- After any major state change (restore, adoption, hydration), refresh all
  callbacks with current handler instance
- Pass handler instance as parameter to callbacks instead of capturing in
  closure
- Log which callbacks were updated and which were skipped

**Operation Completion Tracking Pattern:**

Issues 13 and 16 require **explicit operation lifecycle tracking**. Implement
pattern:

1. Every operation gets unique ID
2. Every major step logs with operation ID
3. Final success/failure logged explicitly
4. Logs should be greppable: `grep "COMPLETED\|FAILED" logs | grep operationId`
   should show full lifecycle

**Lock and Synchronization Pattern:**

Issue 10 demonstrates that **distributed operations across tabs** require
careful lock design. When Quick Tab is owned by Tab A but Manager (Tab B)
invokes operations, locks must account for multi-tab coordination:

- Lock key should include operation context (source, invocation point)
- OR lock should be associated with Quick Tab's origin (tabWindow.originTabId),
  not invoking tab
- Always log which context holds lock and why

**Storage Timeout Pattern:**

Issue 13 shows **promise-based persistence** needs timeout protection. Implement
wrapper:

```
const result = await Promise.race([
  persistOperation(),
  timeoutPromise(5000)
]).catch(err => {
  if (err.code === 'TIMEOUT') {
    markStorageUnavailable();
    logWithContext('Storage timeout after 5000ms');
  }
  throw err;
});
```

---

<scope>
Modify:
- `src/features/quick-tabs/handlers/VisibilityHandler.js`: 
  - Add operation lifecycle logging to handleMinimize, handleRestore
  - Fix lock key to include source or use origin-tab-based locking
  - Ensure all persist operations wrapped in timeout promise
  - Implement z-index recycling proactively (check before increment)
  - Add callback re-wiring for position/size changes or defer to UpdateHandler properly
- `src/background/MessageRouter.js`: 
  - Add handler-level validation middleware for originTabId before routing
- `src/content.js`: 
  - Implement hydration barrier (gate operations until storage loaded)
  - Implement dynamic dedup window or wait-for-storage-event model
- `src/features/quick-tabs/handlers/CreateHandler.js` and `RestoreHandler.js`: 
  - Add originTabId validation and logging
- `src/background/handlers/QuickTabHandler.js`: 
  - Add originTabId validation against sender.tab.id

Do NOT Modify:

- Core port connection architecture
- Event bus design
- Storage API contract
- UI rendering pipeline (UpdateHandler position/size callbacks belong with
  UpdateHandler, not VisibilityHandler) </scope>

---

<acceptancecriteria>

**Issue 9 - Callback Wiring:**

- Position and size callbacks re-wired after restore (either directly or via
  confirmed UICoordinator receipt)
- Position/size changes after restore persist to storage
- Manual test: Restore tab, drag it immediately, refresh page, position persists
- Logs show: "Re-wired callbacks after restore: [callback list]"

**Issue 10 - Lock Collisions:**

- Lock key includes operation source or uses origin-tab-based locking
- Manager can restore tab's Quick Tab even if tab holds other locks
- Manual test: Minimize Quick Tab in Tab A, restore from Manager, succeeds
  without "lock held" error
- Logs show: "Lock acquire: key=restore-qt-123-Manager" (includes source)

**Issue 11 - originTabId Validation:**

- All messages with originTabId validated against sender.tab.id
- Mismatch logged as error and message rejected
- Null originTabId never accepted, defaults to sender.tab.id instead
- Manual test: Send CREATE_QUICK_TAB with mismatched originTabId, rejected with
  "OWNERSHIP_VALIDATION_FAILED"
- Logs show: "HANDLER[CREATE_QUICK_TAB] originTabId validation: claimed=1,
  actual=2, match=false"

**Issue 12 - Dedup Window:**

- Dedup window measured dynamically based on storage.onChanged latency OR
  operation waits for storage event
- Storage event no longer dropped as duplicate
- Manual test: Create Quick Tab immediately after page load, state persists (no
  lost updates)
- Logs show: "Storage event latency: 450ms, dedup window extended to 900ms"

**Issue 13 - Storage Timeout:**

- All storage.local.set() calls wrapped in timeout promise (5s max)
- Timeout triggers failure logging and storage marked unavailable
- Subsequent operations don't hang; they fail fast with context
- Manual test: Simulate storage hang, handler completes with timeout error
  within 5s
- Logs show: "Storage persist timeout after 5000ms, marking storage unavailable"

**Issue 14 - Z-Index Recycling:**

- Z-index counter recycled proactively (before reaching max)
- Recycling triggered at 9,900 (not 100,000)
- Recycling logged with full lifecycle (start, per-tab reassignment, complete)
- Manual test: Focus same Quick Tab 10,000 times, z-index never exceeds
  threshold
- No DOM layering issues after extensive focus operations

**Issue 15 - Hydration Barrier:**

- Operations queued during hydration, executed after storage loaded
- User cannot accidentally create Quick Tab before state hydrated
- Manual test: Rapidly create Quick Tab after page load, state hydration
  completes first
- Logs show: "Queueing operation until hydration complete: CREATE_QUICK_TAB"

**Issue 16 - Completion Logging:**

- Every minimize/restore operation logs explicit "COMPLETED" with status
- Correlation ID included in all logs for same operation
- Partial failures logged with error reason
- Manual test: Enable debug logs, minimize/restore Quick Tab, grep
  "COMPLETED\|FAILED" shows full lifecycle
- Logs show: "handleMinimize COMPLETED:
  operationId=minimize-qt-123-1734700000000, outcome=success, durationMs=245ms"

**All Issues:**

- No regression in existing minimize/restore/focus functionality
- No new console errors or unhandled rejections
- All existing tests pass
- Cross-browser: Tested on Chrome to ensure no behavior divergence
- Performance: Operations complete within 500ms (lock timeout doesn't block
  other operations)

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Implementation Architecture Notes</summary>

**Callback Closure Problem (Issue 9):** QuickTabWindow is constructed with
callbacks passed from VisibilityHandler/UpdateHandler at creation time. Those
callbacks capture the handler instance context. After restore, the tab is
brought back from minimizedManager but the closures still reference the
**original handler instance** from construction. If handler state changed (e.g.,
different \_debounceTimers, \_activeTimerIds), the callbacks operate on stale
context.

Solution: Instead of passing callbacks at construction, pass **handler instance
reference** to QuickTabWindow. QuickTabWindow calls
`handler.onPositionChange(id, ...)` at method call time, always using current
handler state.

**Cross-Tab Lock Coordination (Issue 10):** Firefox allows Manager sidebar (in
sidebar context, with different tab ID) to invoke operations on content scripts
in origin tab via background.js message relay. Two VisibilityHandler instances
(origin tab + sidebar context) both try to acquire locks for same Quick Tab ID.
Lock keys use currentTabId (different between instances), so no conflict is
detected. But semantic intent is: "only one operation on this Quick Tab at a
time, regardless of which tab invokes it."

Solution: Use originTabId (from Quick Tab's ownership) as lock key, not
currentTabId (from handler's context).

**originTabId Validation (Issue 11):** Message protocol requires content script
to tell background "this Quick Tab belongs to tab X." Background accepts this at
face value. If malicious code injects false ownership, ownership validation
layers (content script hydration, storage filters) accept the false claim.
Proper fix: background validates content script can only claim ownership of its
own tab (sender.tab.id).

**Storage Event Timing (Issue 12):** Firefox's storage.local.set() is
asynchronous. Promise resolves when write initiated, not when event fired. Port
messages in the same message path complete synchronously and may arrive before
storage.onChanged listener fires. Dedup window of 200ms assumes quick event
arrival; in Firefox, typical latency 300-500ms. Result: event arrives, is
compared against hash, hash is different (outdated because dedup window closed
and new port message updated hash), event is filtered as "stale."

Solution: measure storage event latency and extend dedup window accordingly, OR
don't dedup port messages (only dedup storage events).

**Z-Index Unbounded Growth (Issue 14):** JavaScript Number type can represent up
to 2^53-1 (about 9 quadrillion). DOM z-index has no specified limit but browsers
typically optimize for 16-bit or 32-bit integers. After 100,000 focus
operations, z-index reaches 100,000+ and DOM rendering optimization may break
(extreme z-indices require higher memory for stacking context or cause rounding
errors). More practical: browser behavior degrades after ~65,000 (16-bit max) or
~2,000,000,000 (32-bit max). Recycling at 100,000 is too late.

</details>

---

## Priority and Complexity

**Priority:** HIGH (Issues 9-11, 15) and MEDIUM (Issues 12-14, 16)  
**Estimated Complexity:** MEDIUM  
**Dependencies:** Issues 9-11 should be fixed before 12-16 (foundational);
Issues 13-14 are independent.  
**Recommended Approach:** Fix as two phases:

- **Phase 1:** Issues 11 (validation), 10 (locks), 9 (callbacks) — address data
  corruption root causes
- **Phase 2:** Issues 12-16 (timeout, recycling, hydration, logging) — add
  resilience and observability

---
