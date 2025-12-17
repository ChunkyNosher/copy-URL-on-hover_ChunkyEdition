# Quick Tabs Extension: Port Lifecycle & Storage Synchronization Issues

**Extension Version:** v1.6.3.10  
**Date:** 2025-12-17  
**Scope:** Multiple interconnected issues affecting Manager UI responsiveness,
cross-tab state synchronization, and background script lifecycle management

---

## Executive Summary

The Quick Tabs Manager extension exhibits critical failures in cross-tab state
synchronization, background script lifecycle management, and port communication
reliability. Five distinct but related issues prevent reliable minimization,
restoration, and visibility of Quick Tabs across browser tabs. Root causes span
storage concurrency, port reconnection logic, render debouncing, and heartbeat
timing. All were introduced or exacerbated in v1.6.3 when cross-tab sync
architecture was refactored. These issues collectively cause data loss, orphaned
Manager connections, and silently dropped user actions.

---

## Issues Overview

| Issue | Component                 | Severity | Root Cause                                           |
| ----- | ------------------------- | -------- | ---------------------------------------------------- |
| 1     | Manager Render Timing     | High     | Render debounce too slow for storage churn rate      |
| 2     | Port Lifecycle Management | Critical | Background unload not detected, zombie ports persist |
| 3     | Storage Concurrency       | Critical | No serialization for multi-tab concurrent writes     |
| 4     | Circuit Breaker Blocking  | High     | 10-second hard block masks transient failures        |
| 5     | Heartbeat Margin          | High     | 25s interval too close to 30s Firefox idle timeout   |

**Why bundled:** All affect Quick Tab state visibility and cross-tab
communication. Share port/storage architecture. Can be fixed in coordinated PR.

---

## Issue 1: Manager Render Debounce Stale State During Storage Churn

**Problem:**  
Manager UI shows outdated Quick Tab list when minimize/restore operations occur
during render debounce window. Evidence from logs shows 3-5 storage updates
occurring every 300-400ms, but debounce delays render by full 300ms, causing UI
to lag behind actual state.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js`  
Location `renderUI()` function, line ~2000, and `RENDER_DEBOUNCE_MS = 300`
constant  
Issue: Debounce timer resets on every state change, but during 300ms wait,
storage can mutate multiple times. `_checkAndReloadStaleState()` detects
divergence but only re-renders if hash differs from captured hash at
debounce-set time. Under rapid operations (user creating/minimizing multiple
Quick Tabs), the captured hash may match final hash even though intermediate
states were missed.

**Fix Required:**  
Reduce debounce timeout to 100-150ms to match actual storage churn rate observed
in logs. Implement sliding window debounce that extends timer on each state
change rather than resetting. Ensure state reload compares against CURRENT
storage, not state at debounce-set time, to detect all intermediate changes.

---

## Issue 2: Background Script Port Lifecycle & Zombie Port Detection

**Problem:**  
When Firefox background script unloads (after ~30s inactivity per Firefox idle
timeout), Manager port connection becomes "zombie"—appears connected but all
messages fail silently. Subsequent reconnection attempts fail because circuit
breaker logic doesn't distinguish between transient network failures and
background-unload disconnects.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js`  
Location `connectToBackground()` function around line 450 and
`handlePortMessage()` around line 800  
Issue: Manager stores port reference in `backgroundPort` global variable. When
background unloads, port becomes zombie (still references valid port object but
background context no longer exists). `onDisconnect` handler may not fire
reliably. Subsequent `postMessage()` calls throw errors or fail silently.
Manager has no way to distinguish "background died" from "network hiccup"
because both result in port failures.

**Fix Required:**  
Implement explicit background-alive detection by wrapping port messages with
short timeouts (500ms). If timeout fires, treat as background unload rather than
transient failure and force immediate reconnect without circuit breaker delay.
Add explicit port state machine that tracks: `connected`, `zombie`,
`reconnecting`, `dead`. Verify port viability before each critical operation
(minimize, restore, close).

---

## Issue 3: Storage Concurrency & Partial Write Race Conditions

**Problem:**  
Multiple tabs writing simultaneously to `browser.storage.local` without
serialization creates race conditions. Concurrent writes can result in partial
state being persisted, which other tabs then read as corrupted. Manager detects
this as "storage storm" (tab count jumps 0→4→0) but only after corruption
occurs.

**Root Cause:**  
File `sidebar/utils/storage-handlers.js` and `content/quick-tabs-handler.js`
(inferred from logs)  
Location All `browser.storage.local.set()` calls across multiple files  
Issue: Firefox `browser.storage.local` provides no transaction semantics or
write ordering guarantees. Multiple tabs calling
`storage.local.set({tabs: [...], timestamp: X, saveId: "xxx"})` simultaneously
means writes interleave. If Tab A writes [QT1, QT2, QT3], then Tab B writes
[QT4, QT5], but Tab A's write is partially applied, Tab B's write could
overwrite with incomplete state. When Manager reads, it gets partial data that
triggers storm detection.

**Fix Required:**  
Implement write serialization using a `transactionId` + `saveId` versioning
scheme where each write includes both. Before processing storage change in
Manager, verify write sequence isn't broken (saveId version always increments).
For rapid operations, batch writes within 50-100ms window instead of individual
set calls. Add transaction log to track write order:
`{transactionId, fromTabId, sequence, timestamp, savedTabCount}` for debugging.

---

## Issue 4: Circuit Breaker Reconnection Blocking All Communication

**Problem:**  
After 5 failed port connection attempts, circuit breaker enters "open" state for
10 seconds, during which Manager cannot send ANY messages (minimize, restore,
close commands). If user clicks buttons during this window, actions queue but
cannot transmit, then are lost when circuit reopens.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js`  
Location `connectToBackground()` function line ~450, `tripCircuitBreaker()` line
~550, `scheduleReconnect()` line ~500  
Issue: Circuit breaker implements state machine: `closed` (normal) → `open`
(hard-block for 10s) → `half-open` (retry). After 5 failures, trips to `open`
and blocks all operations for full 10s. Logic treats all failures identically
(network jitter, background unload, port zombie) without distinguishing
severity. A single transient DNS failure causes entire system to stop for 10
seconds.

**Fix Required:**  
Differentiate failure types: transient (retry immediately with 100ms backoff),
zombie-port (clear port and reconnect), background-dead (request full state
sync). For transient failures, use exponential backoff capped at 2 seconds, not
10 seconds. For background-dead, attempt reconnect immediately since background
may have just restarted. Remove hard 10-second block—use sliding backoff window
instead where failures older than 5 seconds don't count toward threshold.

---

## Issue 5: Heartbeat Interval Too Close to Firefox Idle Timeout

**Problem:**  
Firefox background scripts unload after ~30 seconds of inactivity. Current
heartbeat interval is 25 seconds, leaving only 5-second safety margin. Network
jitter or delayed heartbeat responses can cause background to unload while
Manager believes it's still connected. Subsequent heartbeat fails, triggering
reconnect sequence that takes 100-2000ms depending on backoff state.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js`  
Location Constants `HEARTBEAT_INTERVAL_MS = 25000` line ~200,
`HEARTBEAT_TIMEOUT_MS = 5000` line ~210  
Issue: Firefox documentation states background scripts suspend after ~30s
inactivity. Heartbeat at 25s is an architectural gamble—assumes heartbeat always
completes within 5s. If background is slow to respond or network latency spikes,
heartbeat timeout fires, heart failure counter increments, triggering reconnect.
After 2 consecutive failures, reconnect backoff starts at 100ms but grows
exponentially.

**Fix Required:**  
Increase heartbeat interval to 15 seconds (reducing idle margin to 15s instead
of 5s) OR implement keep-alive event listeners in background that prevent unload
independently of heartbeat. Reduce heartbeat timeout from 5s to 2s to fail
faster and reconnect sooner if background is truly dead. Add adaptive heartbeat
that backs off when network is slow but never exceeds 20s.

---

## Issue 6: Missing Logging for Port State Transitions & Message Failures

**Problem:**  
When port messages fail (especially during background unload scenarios), there
is no detailed logging of why messages failed, what state the port was in, or
recovery actions taken. Makes debugging extremely difficult.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js` and background script  
Location `sendPortMessageWithTimeout()` function, `handlePortMessage()`, error
handlers throughout  
Issue: Error handlers catch exceptions but log only error message, not context.
When `backgroundPort.postMessage()` throws or times out, logs don't show: port
state, message type, whether background reconnect was triggered, how many
failures so far. Missing context means each failure appears isolated when
actually it's part of a cascade.

**Fix Required:**  
Add structured logging for all port state transitions: `CONNECT`, `DISCONNECT`,
`RECONNECT_ATTEMPT`, `RECONNECT_SUCCESS`, `MESSAGE_SENT`,
`MESSAGE_ACK_RECEIVED`, `MESSAGE_TIMEOUT`, `ZOMBIE_DETECTED`. Include context:
port ID, message correlation ID, current circuit breaker state, failure count,
timestamp. Log all `postMessage()` failures with error type (timeout,
disconnected, zombie) and recovery action taken.

---

## Issue 7: Minimize/Restore Cross-Tab Messaging Reliability & Silent Failures

**Problem:**  
When user clicks "Minimize" in Manager sidebar, message is sent to the origin
tab where Quick Tab lives. If that tab is closed or content script unloaded,
message fails. Current code falls back to broadcasting to ALL tabs, which is
inefficient and unreliable. If both fail, Quick Tab state is not updated in
storage, causing stale indicators in Manager.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js`  
Location `minimizeQuickTab()` function around line 2600, `_sendRestoreMessage()`
around line 2700  
Issue: Code attempts targeted message to specific tab ID, catches error, then
broadcasts fallback. No retry with backoff. If targeted fails because tab
closed, and broadcast fails because content script unloaded in all tabs, then no
minimization occurs but user sees no error. Manager shows minimize button
"working" but state never persists to storage.

**Fix Required:**  
Implement retry pattern: attempt targeted message 2 times with 100-200ms backoff
before fallback to broadcast. If broadcast also fails, show user error
notification instead of silent failure. For minimize/restore operations, send
command to background script instead of directly to content script, allowing
background to coordinate across tabs and handle closed tab scenarios.

---

## Issue 8: In-Memory Cache Fallback Masks Root Causes Instead of Fixing Them

**Problem:**  
Manager implements in-memory cache as fallback when storage returns 0 tabs but
cache has multiple tabs (storage storm detection). Cache protects UI from
flashing blank, but perpetuates stale data and prevents root storage corruption
issues from being detected and fixed.

**Root Cause:**  
File `sidebar/quick-tabs-manager.js`  
Location `_detectStorageStorm()` function line ~1600,
`_triggerCacheReconciliation()` line ~1700, `inMemoryTabsCache` global
variable  
Issue: Cache exists as "protection" against storage storms, but it's band-aid
solution. When storage returns corrupted state (0 tabs), code uses cache as
fallback, shows cached data to user, starts async reconciliation with content
scripts. If reconciliation fails, cache remains stale but Manager keeps using
it. This masks underlying storage concurrency bug rather than fixing it.

**Fix Required:**  
Cache should NOT be used as fallback for corrupted storage—instead trigger
immediate reconciliation and request that content scripts restore to storage
before rendering anything. Only use cache for initial hydration, not for ongoing
updates. Remove cache-based fallback logic entirely; instead fix root storage
concurrency issue (Issue 3) so corruption never happens. Add cache staleness
indicator: log when cache is >X seconds old without refresh from storage.

---

## Shared Implementation Notes

- All port/storage communication must include unique `correlationId` for
  end-to-end tracking
- Implement structured error logging following pattern:
  `{level, component, operation, error, context, recovery}`
- Storage writes must be debounced per-tab to prevent write storms (100-200ms
  window)
- Port reconnection must distinguish between background unload and transient
  failures
- All user-facing operations (minimize, restore, close) must have user-visible
  error feedback, not silent failures
- Firefox idle timeout of ~30 seconds is architectural constraint—design systems
  around this, don't fight it

---

## Acceptance Criteria

**Issue 1 (Render Timing):**

- Manager UI updates within 150ms of minimize/restore action
- No "stale state" indicators showing wrong minimized status
- Multiple rapid operations complete sequentially without skipped renders
- Debounce adapts to storage update frequency

**Issue 2 (Port Lifecycle):**

- Background unload properly detected within 500ms (heartbeat timeout)
- Zombie ports identified and cleared, not retried
- Reconnect succeeds within 1 second of background restart
- Port state logged: CONNECT, DISCONNECT, ZOMBIE_DETECTED, RECONNECT_SUCCESS

**Issue 3 (Storage Concurrency):**

- No storage storms detected (0 tabs suddenly appearing)
- Multiple simultaneous writes complete without data loss
- Storage write sequence tracked and validated via transactionId
- Cross-tab state divergence reconciliation works reliably

**Issue 4 (Circuit Breaker):**

- Circuit breaker enters "open" only for background unload, not transient
  failures
- No 10-second hard blocks—maximum 2 seconds between retries
- User actions queued during reconnect and sent once connection restored
- Circuit state logged with failure reason (timeout, zombie, background-dead)

**Issue 5 (Heartbeat):**

- Heartbeat timeout never causes background unload (sufficient margin)
- Heartbeat completes in <2 seconds (or times out and reconnects)
- Adaptive heartbeat backs off during network latency but never exceeds 20s
- Heartbeat failures logged with round-trip time and timeout reason

**Issue 6 (Logging):**

- All port state transitions logged with context (port ID, message type, circuit
  state)
- Message failures include error type, recovery action, timestamp
- Logs sufficient to reconstruct cascade of failures without guessing

**Issue 7 (Cross-Tab Messaging):**

- Minimize/restore commands retry 2x before broadcasting fallback
- Failed operations show user error notification (not silent failure)
- All state changes persisted to storage before UI feedback shown
- Command routing uses background script for cross-tab coordination

**Issue 8 (Cache Handling):**

- Cache only used for initial hydration, not ongoing fallback
- Storage corruption triggers immediate reconciliation (not cache delay)
- Cache staleness tracked: log when >30 seconds without refresh
- Root cause (storage concurrency) fixed so cache protection unnecessary

**All Issues:**

- All existing tests continue passing
- No new console errors or unhandled promise rejections
- Manual test: create multiple Quick Tabs, minimize/restore rapidly, switch
  tabs, storage state remains consistent
- Manual test: close background script (simulate Firefox idle timeout), Manager
  detects and reconnects within 1s

---

## Supporting Context

<details>
<summary>Storage Update Frequency Analysis</summary>

Extension logs show storage updates every 250-400ms during normal operation:

- QT created: storage write
- ~300ms later: z-index update (click/focus)
- ~400ms later: position update (drag)
- ~300ms later: size update (resize)
- Pattern repeats

Manager's 300ms debounce means every render waits full 300ms, but storage
already changed 1-2 times during wait. By the time render executes, state is
already outdated. Logs show saveId increments 3-4 times per second, but Manager
only processes final state, missing intermediate operations.

**Evidence:** Log timestamps show:

```
2025-12-17T020018.277Z storage changed saveId A→B
2025-12-17T020018.662Z storage changed saveId B→C (385ms later)
2025-12-17T020020.806Z storage changed saveId C→D (2.1s later, but 5 changes between)
```

</details>

<details>
<summary>Port Lifecycle Under Background Unload</summary>

Firefox behavior (per MDN + Mozilla Discourse):

1. Background script runs
2. No user input for 30s → Firefox suspends background
3. Content script still running, has active port connection
4. Content script sends message → port appears open but background not listening
5. Message either drops or error thrown (timing dependent)
6. Content script calls onDisconnect (may be delayed)
7. Manager attempts reconnect but background still suspended
8. Port connection succeeds (background wakes), but state lost

Current code doesn't distinguish step 3-4 (zombie) from transient network
failure. Both cause message failures, both trigger reconnect, both use same
exponential backoff. Should use different strategy for each.

</details>

<details>
<summary>Storage Concurrency Risk Scenario</summary>

Multi-tab write race:

- Tab A (Wikipedia): User creates QT1
- Tab B (YouTube): User creates QT2
- Tab A writes: `{tabs: [{id: QT1}], timestamp: T1, saveId: SID1}`
- Tab B writes (overlapping): `{tabs: [{id: QT2}], timestamp: T2, saveId: SID2}`
- Firefox storage layer queues both writes
- If both writes reference same underlying key, one overwrites other
- Manager reads back and sees either only QT1 or only QT2, not both
- Reconciliation with content scripts discovers missing tabs
- Triggers cache usage as fallback (masking issue)

This is why storage storms appear intermittent—they occur when write timing
aligns wrong. Rare under slow operations, frequent under rapid user input.

</details>

---

## Priority

**Critical:** Issues 2, 3  
**High:** Issues 1, 4, 5  
**Medium:** Issues 6, 7, 8

**Target:** Fix all in single coordinated PR  
**Estimated Complexity:** High (requires architectural changes to port lifecycle
and storage serialization)
