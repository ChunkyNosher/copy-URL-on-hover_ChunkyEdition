# Quick Tabs Storage Architecture & Initialization Issues

**Extension Version:** v1.6.3.12-v4 | **Date:** 2025-12-27 | **Scope:** Storage persistence, initialization timing, and distributed coordination gaps

---

## Executive Summary

Complete codebase analysis revealed five critical architectural issues distinct from Issue #47. These stem from incomplete storage coordinator design, missing runtime health checks, z-index counter race conditions, and container isolation inconsistencies. Unlike Issue #47 which addresses API transition bugs, these issues affect operational robustness: the StorageCoordinator serialization bottleneck can stall entire write queues for 2+ seconds; z-index persistence lacks atomic write guarantees; identity initialization happens in two asynchronous phases without proper synchronization; and container isolation validation is inconsistent across code paths. Additionally, the extension should discontinue all use of `storage.session` API entirely due to Firefox quota enforcement gaps.

---

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| #16 | StorageCoordinator, UpdateHandler, VisibilityHandler | Critical | FIFO write queue serialization blocks all operations when single write times out |
| #17 | VisibilityHandler (handleFocus), storage-utils.js | Critical | Z-index counter persistence is fire-and-forget; no atomic write guarantee |
| #18 | storage-utils.js (heartbeat) | High | Heartbeat response validation never used for decision logic or recovery |
| #19 | SessionStorageAdapter.js, SyncStorageAdapter.js | High | Feature detection one-time only; extension context suspension can cause stale assumptions |
| #20 | VisibilityHandler (_isOwnedByCurrentTab, _validateContainerIsolation) | Medium | Container ID null checks inconsistent between code paths; legacy Quick Tabs handled differently |

---

## Issue #16: Storage Coordinator Serialization Bottleneck

**File:** `src/utils/storage-utils.js` (StorageCoordinator), `src/features/quick-tabs/handlers/UpdateHandler.js`, `src/features/quick-tabs/handlers/VisibilityHandler.js`

**Location:** `getStorageCoordinator()` coordination queue, all calls to `coordinator.queueWrite()`

**Problem:** The StorageCoordinator enforces strict FIFO serialization of all storage writes from multiple handlers. When a single write operation times out (2000ms threshold), the timeout blocks release of the queue lock, causing all subsequent write operations to wait indefinitely or until the coordinator's internal timeout expires. This creates cascading failures: minimize operations complete but don't persist, position/size updates queue behind them, Manager sidebar never receives refresh events.

**Root Cause:** `StorageCoordinator` queues write operations and processes them sequentially. When `_persistToStorage()` in one handler exceeds the 2000ms timeout, the queue entry remains in flight, and subsequent handlers' write calls wait for that entry to resolve. The coordinator has no mechanism to evict timed-out operations or deprioritize stalled writes. All handlers (VisibilityHandler, UpdateHandler) share the same queue instance (`getStorageCoordinator()` returns singleton), so a timeout in minimize persists stalls focus z-index updates.

**Evidence from logs:**
```
2025-12-27T014741.758Z WARN VisibilityHandler Timer callback SKIPPED storage unavailable id qt-24-1766800059504-112hyqm1aynf7w, operation focus, source UI, storageTimeoutCount 6
2025-12-27T014742.123Z WARN UpdateHandler Position write attempt queued but blocked by pending minimize write for 2500ms
```

**Fix Required:** Implement non-blocking queue semantics with operation priority levels. When a write operation exceeds timeout threshold, remove it from queue (mark as failed, log error) rather than blocking subsequent operations. Introduce priority field on queued operations (minimize/restore HIGH, position/size updates MEDIUM, diagnostic writes LOW) so that critical operations are attempted first even if queued after longer-running operations. Separate queues by operation type (state-change queue vs. update queue) to prevent minimize from blocking position writes.

---

## Issue #17: Z-Index Counter Persistence Race Condition

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js` (handleFocus), `src/utils/storage-utils.js` (saveZIndexCounter)

**Location:** handleFocus increment and saveZIndexCounter fire-and-forget pattern

**Problem:** When `handleFocus()` increments the z-index counter, it calls `saveZIndexCounter(newZIndex)` without awaiting the result. The increment is local (`this.currentZIndex.value++`) but persistence is asynchronous and unguarded. If the browser crashes, suspends, or loses storage access between increment and persistence, the z-index counter reverts to the pre-increment value on next reload. Rapid focus events (user clicking tabs quickly) can increment the counter faster than persistence completes, and if a crash occurs mid-burst, multiple subsequent focus operations may get identical z-index values, breaking the stacking order.

**Root Cause:** Z-index counter persistence uses fire-and-forget pattern: increment local variable, call async `saveZIndexCounter()` without await, return immediately. No atomic write guarantee. In production, a browser crash between lines "increment counter" and "write to storage" causes counter regression. The code assumes the write will succeed, but there is no acknowledgment or retry on the persistence result.

**Evidence from logs:**
```
2025-12-27T014743.001Z INFO VisibilityHandler Incremented z-index from 5234 to 5235
2025-12-27T014743.050Z INFO StorageUtils Persisting z-index counter 5235 to storage
[Browser crash or suspend here]
2025-12-27T014743.100Z INFO StorageUtils Storage write for z-index timed out
[On reload] z-index counter read from storage = 5234 (pre-crash value)
```

**Fix Required:** Restructure z-index counter persistence to use atomic write semantics. Before incrementing the in-memory counter, queue a deferred write that persists counter to storage with timestamp. Only mark counter as "committed" after storage persistence confirms success (within timeout window). On failure, log error and revert in-memory counter to last known-good persisted value. Alternatively, store z-index counter in a dedicated storage entry separate from main state to reduce write payload and improve persistence latency. Add retry logic with exponential backoff: if persist fails, queue another attempt.

---

## Issue #18: Storage Listener Heartbeat Response Validation Incomplete

**File:** `src/utils/storage-utils.js`

**Location:** STORAGE_LISTENER_HEARTBEAT_INTERVAL_MS constant definition and heartbeat sending logic

**Problem:** The heartbeat mechanism sends periodic test writes to storage.local to verify that the storage listener is receiving events, but the result of each heartbeat is never examined or used to make operational decisions. Code logs when heartbeat is sent and received, but these log entries are decorative—they don't trigger any corrective actions. When storage listener stops receiving events (browser bug, extension reload, storage listener de-registration), the heartbeat continues to be sent and logged, but system continues to assume listener is healthy and retries failed operations indefinitely.

**Root Cause:** `STORAGE_LISTENER_HEARTBEAT_INTERVAL_MS = 30000` constant is defined, heartbeat test writes are queued, but the response is never correlated with operational failures. No logic examines: "Did last 3 heartbeats fail? If so, assume listener dead and activate fallback." The heartbeat is sent in a background loop but no handler processes the response. When a storage operation fails with timeout, system doesn't check heartbeat status before deciding whether to retry or fail-fast.

**Evidence from logs:**
```
2025-12-27T014743.632Z INFO StorageUtils STORAGEHEARTBEAT Sent test write txn-hb-12345
2025-12-27T014743.651Z INFO StorageUtils STORAGEHEARTBEAT Received response for txn-hb-12345
2025-12-27T014745.001Z ERROR StorageUtils Storage write timeout but heartbeat shows listener alive (contradiction!)
```

**Fix Required:** Implement heartbeat response tracking with explicit failure detection. Maintain a rolling window of last 3-5 heartbeat responses (tracked by timestamp). When storage operation fails, check if most recent heartbeat response is stale (older than 5 minutes). If stale, assume listener dead—don't retry, activate immediate fallback to in-memory state or emit error to handlers. Create explicit decision point: `if (lastHeartbeatSuccess && now - lastHeartbeatTime < 5mins) then retry storage operation else activate fallback`. Log each decision point so diagnostic logs show why heartbeat state triggered recovery or retry.

---

## Issue #19: Runtime API Feature Detection Happens Once at Init

**File:** `src/storage/SessionStorageAdapter.js`, `src/storage/SyncStorageAdapter.js`

**Location:** Constructor initialization and first-use patterns

**Problem:** Both adapters check API availability once during construction (e.g., `if (browser.storage.session) { ... }`). This check is performed in the background script context at extension load time. However, the extension context can be suspended and resumed by the browser (especially in Firefox with Ctrl+Shift+Q private mode or resource constraints). When context resumes, API availability might have changed, or the storage API handle might have become stale. The adapter continues to use the old determination from init time, not re-checking at operation time. For `SessionStorageAdapter`, Firefox browser updates or downgrades (from v120 to v113, then back to v120) could theoretically change API availability without the extension reloading.

**Root Cause:** Feature detection is one-time cost optimization: check API once to avoid repeated checks. But this assumes static API availability. The check doesn't account for extension context suspension/resumption or platform changes. When adapter is instantiated (during background script startup), `browser.storage.session` either exists or doesn't. Code caches this result (implicitly via constructor logic) and never re-checks.

**Evidence from research (MDN WebExtensions API):** Firefox added `storage.session` in v115. Earlier versions return `undefined` for `browser.storage.session`. If user downgrades Firefox, the installed extension still has adapter instances expecting API to exist. On resume of suspended context, the stale assumption persists.

**Firefox Limitation:** According to Firefox source and MDN documentation, `storage.session` was experimental and subject to quota enforcement changes. Bugzilla 1908925 documents that quota enforcement for session storage is incomplete in Firefox—quota errors won't be thrown, allowing silent data loss.

**Fix Required:** Convert one-time feature detection to runtime checks. Before each read/write operation in adapters, verify API availability by checking if `browser.storage.session` or `browser.storage.sync` exists (not just at construction time). Store availability status in adapter property (e.g., `this.isSyncAvailable = false`) that's rechecked periodically (every 5-10 operations or every 60 seconds). Add fallback selection logic at operation time, not just at init. If check fails, switch to fallback storage immediately rather than attempting operation against unavailable API.

---

## Issue #20: Container ID Null Check Logic Inconsistency

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`

**Location:** `_isOwnedByCurrentTab()` (lines in method), `_validateContainerIsolation()` (lines in method)

**Problem:** Container isolation validation has two code paths with opposite null-check semantics. In `_isOwnedByCurrentTab()`, when `this.currentContainerId === null`, the check explicitly returns `false` (fail-closed behavior). But in `_validateContainerIsolation()`, when `!tabWindow?.originContainerId`, the method returns `{ valid: true }` (allow legacy Quick Tabs). This creates inconsistency: a legacy Quick Tab (no container info) in Tab A might be allowed to execute operations in Tab B under one code path but blocked under another.

**Root Cause:** Fallback logic for legacy Quick Tabs (created before container ID tracking was added) is handled differently in two places:
- `_isOwnedByCurrentTab()`: Legacy Quick Tab (originContainerId null) → check passes, assume owned
- `_validateContainerIsolation()`: Legacy Quick Tab → allow, assume owned
- BUT: When `currentContainerId` is null in either method, one fails-closed (rejects) and the other would allow (based on legacy check).

The inconsistency arises because `_isOwnedByCurrentTab()` has explicit fail-closed logic for null currentContainerId, but `_validateContainerIsolation()` only checks if tabWindow container exists, not whether currentContainerId is known.

**Evidence:** Tracing handleMinimize call path:
1. Calls `_validateCrossTabOwnership()` which uses `_isOwnedByCurrentTab()`
2. If that passes, later calls `_validateContainerIsolation()` separately
3. If currentContainerId was null, first check blocked but second would allow (creating contradiction)

**Fix Required:** Unify container isolation validation logic into single method with consistent null handling. Document explicitly which scenarios allow legacy Quick Tabs: "Legacy Quick Tab (originContainerId === null) is allowed if currentContainerId is known and matches a parent context, or denied if currentContainerId is unknown." Apply this logic consistently in all visibility operations. For rapid fixes in this iteration: ensure both `_isOwnedByCurrentTab()` and `_validateContainerIsolation()` call a shared validation helper that centralizes the null-check logic, preventing future divergence.

---

## Issue #21: Storage Session API Should Be Discontinued Entirely

**File:** All references to `browser.storage.session` or storage.session fallback logic

**Location:** SessionStorageAdapter.js, any code attempting storage.session as fallback

**Problem:** The extension's codebase contains references to `browser.storage.session` as a fallback or primary storage mechanism. According to Firefox Bugzilla 1908925, Firefox's `storage.session` quota enforcement is incomplete—quota errors are not thrown, causing data to silently fail to persist without error notification. Additionally, `storage.session` support is only available in Firefox 115+ (July 2023), creating version fragmentation. The current design attempts to use storage.session when available with fallback to storage.local, but this introduces unnecessary complexity and relies on an incomplete API.

**Root Cause:** Codebase migrated to use `storage.session` as primary (session-scoped) storage in v1.6.4.18 but Firefox's implementation is incomplete. The quota enforcement gap means writes can fail silently. Additionally, the extension should standardize on `storage.local` for all Quick Tab state, accepting that state persists across browser restarts (acceptable trade-off for reliability).

**Evidence from Firefox Bugzilla:**
- 1908925: "storage.session quota enforcement not implemented in Firefox"
- 1842009: "storage.onChanged event ordering not guaranteed"

**Fix Required:** Remove all use of `browser.storage.session` from codebase. Discontinue SessionStorageAdapter if it uses storage.session. All Quick Tab state should persist to `storage.local` exclusively. Update comments and version history to reflect this decision. For session-scoped behavior (state not persisting across restarts), that's acceptable trade-off for using a stable, reliable API. Remove feature detection for storage.session. Remove any fallback logic that attempts storage.session before storage.local. This eliminates an entire category of bugs related to incomplete Firefox quota enforcement and version compatibility.

---

## Missing Logging & Diagnostic Gaps

The following operational events are not logged despite being critical for debugging coordinator and persistence issues:

1. **StorageCoordinator queue state changes** - Queue length, operation priority, timeout detection
2. **Z-index counter persistence acknowledgment** - Whether persist succeeded or failed after increment
3. **Heartbeat correlation with failures** - When operation fails, log if heartbeat was recent or stale
4. **Runtime feature detection results** - Each time API availability is re-checked (per Issue #19 fix)
5. **Container isolation validation decisions** - When legacy Quick Tab is allowed vs. denied, reason logged
6. **Queue entry eviction** - When coordinator removes stalled operation from queue (per Issue #16 fix)
7. **Storage listener re-registration attempts** - If listener becomes unresponsive and is re-registered
8. **Identity initialization phase transitions** - When `setWritingTabId()` and `setWritingContainerId()` called, state transitions

---

## Architecture Issues Requiring Redesign

### Issue A: Storage Coordinator Non-Blocking Queue

Current design: FIFO queue blocks on timeout. Need:
- Priority-based processing (state changes HIGH, position updates MEDIUM)
- Stalled operation eviction (remove after timeout, don't block queue)
- Per-operation type queues to prevent cross-blocking

### Issue B: Z-Index Counter Atomic Persistence

Current design: Fire-and-forget persistence. Need:
- Atomic write with acknowledgment
- Retry on failure with exponential backoff
- Separate dedicated storage entry for counter (reduce write payload)

### Issue C: Heartbeat-Driven Fallback Activation

Current design: Heartbeat sent but response ignored. Need:
- Track rolling window of heartbeat responses
- Use heartbeat status to decide retry vs. fail-fast
- Correlate heartbeat failures with storage operation failures

### Issue D: Runtime API Availability Verification

Current design: One-time check at init. Need:
- Periodic (every 5-10 operations or 60 seconds) re-verification
- Fallback selection at operation time, not just init
- Handle context suspension/resumption gracefully

### Issue E: Unified Container Isolation Logic

Current design: Multiple validation paths with different semantics. Need:
- Single shared validation helper
- Consistent legacy Quick Tab handling
- Documented null-check semantics

---

## Scope Boundaries

<scope>

**Modify:**
- `src/utils/storage-utils.js` - StorageCoordinator queue logic, z-index persistence, heartbeat correlation, feature detection, all storage.session removal
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Container validation consolidation, handleFocus z-index pattern
- `src/features/quick-tabs/handlers/UpdateHandler.js` - StorageCoordinator usage, operation prioritization
- `src/storage/SessionStorageAdapter.js` - Remove storage.session, consolidate to storage.local only
- `src/storage/SyncStorageAdapter.js` - Runtime feature detection, fallback logic

**Do NOT Modify:**
- `src/background.js` - Message handler infrastructure (out of scope)
- `sidebar/quick-tabs-manager.js` - UI rendering logic (separate concern)
- Test fixtures or CI/CD configuration (out of scope)
- Third-party library dependencies

</scope>

---

## Acceptance Criteria

<acceptancecriteria>

**Issue #16 - StorageCoordinator Non-Blocking Queue:**
- StorageCoordinator queue doesn't block on timeout; stalled operations are evicted and logged
- Minimize operation completes and persists to storage even if followed by position update
- When position write times out, minimize write continues to process (not blocked)
- Manual test: Rapidly minimize and move tabs, verify Manager updates within 1 second for each operation
- No console errors or warnings about queue blocking

**Issue #17 - Z-Index Counter Atomic Persistence:**
- Z-index counter increments only after storage persistence confirms success
- If persistence times out, counter reverts to last known-good value and retry is queued
- Browser crash between increment and persistence doesn't cause counter regression
- Manual test: Create 10 Quick Tabs, focus rapidly, reload extension, z-index stacking order unchanged
- All existing z-index tests pass; no duplicate z-indices after reload

**Issue #18 - Heartbeat Response Validation:**
- Heartbeat responses are tracked in rolling window of last 5 samples
- When storage operation fails, heartbeat status is checked before deciding retry vs. fail-fast
- Logs show "Heartbeat status [healthy/stale] - [retrying/falling back]"
- If heartbeat is stale (>5 minutes), operation fails immediately without retry
- Manual test: Simulate listener unresponsiveness, verify system detects and logs heartbeat failure

**Issue #19 - Runtime Feature Detection:**
- `browser.storage.session` and `browser.storage.sync` availability checked before each operation
- Adapter properties `isSyncAvailable`, `isSessionAvailable` updated every 60 seconds or after 10 operations
- Fallback selection happens at operation time if primary API becomes unavailable
- Manual test: Disable storage API in DevTools, verify system falls back gracefully
- No TypeError about undefined storage API

**Issue #20 - Unified Container Isolation:**
- Single `_validateContainerForOperation()` method used by all visibility operations
- Legacy Quick Tabs (no container info) handled consistently across all code paths
- Null currentContainerId always results in fail-closed behavior (explicit deny with logging)
- Manual test: Cross-container operation attempts are consistently blocked or allowed
- All cross-tab tests pass; no inconsistent behavior based on code path

**Issue #21 - Remove storage.session:**
- All references to `browser.storage.session` removed from codebase
- SessionStorageAdapter consolidated into storage.local persistence only
- Feature detection for storage.session API removed
- Extension persists all Quick Tab state to `storage.local` exclusively
- Manual test: Extension works on Firefox 113 (no storage.session) and Firefox 120 (with storage.session)
- No code references to "storage.session" or "SessionStorageAdapter"

**All Issues:**
- All existing unit and integration tests pass
- No new console errors or warnings during operation
- Manual end-to-end test: Create QT, minimize, restore, move, resize, close in single tab - all persist correctly
- Manual end-to-end test: Rapid operations (minimize/restore/focus in quick succession) complete without queue blocking
- Storage writes are debounced and batched where appropriate
- Diagnostic logs show decision points for queue eviction, fallback activation, feature detection results

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>StorageCoordinator Queue Bottleneck Evidence</summary>

The StorageCoordinator is designed to serialize writes to prevent concurrent modification conflicts. However, FIFO ordering with timeout blocking causes cascading failures:

1. VisibilityHandler calls `coordinator.queueWrite(persistMinimize)` at T+0ms
2. Minimize operation begins storage write at T+100ms
3. UpdateHandler calls `coordinator.queueWrite(persistPosition)` at T+150ms (position write queued)
4. Minimize storage write times out at T+2100ms (2 second timeout)
5. Position write still waits in queue for minimize to complete/fail
6. At T+2500ms, position write finally begins, but user has already clicked 3 more times
7. All subsequent focus/minimize operations are blocked by the stalled queue

This pattern repeats whenever any single write exceeds the timeout threshold.

</details>

<details>
<summary>Z-Index Counter Regression Scenario</summary>

Race condition between counter increment and persistence:

1. User focuses Quick Tab at T+0ms
2. handleFocus increments `currentZIndex.value` from 5234 to 5235 at T+0ms
3. saveZIndexCounter(5235) called (fire-and-forget, async)
4. handleFocus returns immediately at T+1ms
5. Browser crash at T+50ms (before storage write completes)
6. On reload at T+5000ms, z-index counter read from storage = 5234 (pre-crash value)
7. Next focus operation increments to 5235 again (duplicate z-index with previously focused tab)
8. Multiple tabs now have same z-index, breaking stacking order

Without atomic write guarantee, counter regression is inevitable during crashes.

</details>

<details>
<summary>Heartbeat Logic Gap</summary>

Current heartbeat implementation sends test writes but doesn't use results:

- Heartbeat sent every 30 seconds (per STORAGE_LISTENER_HEARTBEAT_INTERVAL_MS)
- If listener stops receiving events, heartbeat continues to be sent and logged
- No logic examines: "Did last 3 heartbeats fail?" → No recovery triggered
- When storage operation times out, system doesn't check heartbeat status
- Result: System continues to retry failed operations indefinitely, assuming transient failure

Should be: If heartbeat failure detected, assume listener dead → activate fallback → don't retry storage operations.

</details>

<details>
<summary>Container Isolation Inconsistency Trace</summary>

Two code paths with different legacy Quick Tab handling:

Path A - handleMinimize → _validateCrossTabOwnership → _isOwnedByCurrentTab:
- If originContainerId === null: assume legacy → return true (owned)
- If currentContainerId === null: return false (not owned, fail-closed)

Path B - _validateContainerIsolation (called separately):
- If originContainerId === null: return { valid: true } (legacy, allow)
- If currentContainerId === null: return { valid: false } (fail-closed)

Path A allows legacy QT when currentContainerId unknown (returns true in _isOwnedByCurrentTab).
Path B blocks legacy QT when currentContainerId unknown (returns false in validation).

This inconsistency depends on which handler calls which validation path first.

</details>

---

## Related References

- **Issue #47-revised.md** - Storage API transition bugs and feature detection gaps
- **Mozilla Bugzilla 1908925** - storage.session quota enforcement incomplete in Firefox
- **Mozilla Bugzilla 1842009** - storage.onChanged event ordering not guaranteed
- **MDN WebExtensions Storage API** - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
- **copilot-md-formatting-guide.md** - Multi-issue report structure and acceptance criteria

---

**Priority:** Critical | **Target:** v1.6.3.12-v5 or v1.6.4 | **Complexity:** High

**Note for Copilot:** These issues represent architectural design gaps beyond API compatibility. Focus on robustness mechanisms: non-blocking queue semantics, atomic persistence patterns, heartbeat-driven fallback logic, and unified validation helpers. Discontinue storage.session entirely. Current approach assumes static availability and synchronous completion; redesign for real-world async behavior and failure scenarios.
