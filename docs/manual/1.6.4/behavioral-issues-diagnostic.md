# Current Architecture Behavioral Issues & Diagnostic Report

**Extension Version:** v1.6.3.8-v10  
**Date:** December 14, 2025  
**Scope:** Non-removal issues affecting runtime behavior and observability

---

## Executive Summary

Beyond the architectural removal gaps documented in previous reports, the
current v1.6.3.8-v10 codebase exhibits 11 distinct behavioral issues, fragmented
logging, and observable diagnostic problems that compound the migration gap.
These issues are NOT about code removal—they are about broken behaviors, silent
failures, and missing observability in the current architecture. This report
focuses exclusively on **what is broken NOW** and **what is missing in current
implementations** that the proposed v2.0 architecture will NOT fix
automatically.

---

## Issues Overview

| #   | Issue                                   | Component         | Severity | Root Location                               | Behavioral Impact                                                            |
| --- | --------------------------------------- | ----------------- | -------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Port Zombie Queuing Race                | Port Messaging    | Critical | `content.js:940-1050`                       | Orphaned messages queue indefinitely, Manager never receives updates         |
| 2   | Overlapping Port Reconnection Delay     | Port Lifecycle    | High     | `content.js:850-900`                        | Exponential backoff delays user interactions for 30+ seconds                 |
| 3   | Self-Write Detection Timing Paradox     | Storage Sync      | High     | `content.js:1260-1320`                      | Events dropped due to misaligned timing windows (200ms vs 300ms)             |
| 4   | Constant Coupling Fragility             | State Ordering    | High     | `content.js:810-840`                        | Port timeout constants control storage deduplication—unrelated concepts      |
| 5   | Port Disconnect Silent Cleanup          | Port Lifecycle    | High     | `content.js:2350-2400`                      | BFCache page hide silently flushes message queue without logging             |
| 6   | Incomplete Message Handler Contracts    | Messaging         | Medium   | `content.js:3000-3120`                      | Some handlers return `{success: false}`, others throw, inconsistent failures |
| 7   | State Ordering Validation Too Strict    | Storage Sync      | Medium   | `content.js:1500-1600`                      | Rejects valid out-of-order events due to overly complex logic                |
| 8   | Missing Tab ID Initialization Trace     | Initialization    | Medium   | `content.js:3500-3650`                      | Features bootstrap with null tab ID silently—no logging of degradation       |
| 9   | Manager Grouping Race Condition         | Manager UI        | Medium   | `src/sidebar/quick-tabs-manager.js:600-750` | Sidebar renders stale groupings during rapid cross-tab operations            |
| 10  | Storage Listener Fragility              | Storage Lifecycle | Medium   | `content.js:150-250`                        | Early listener may not capture first events if script timing varies          |
| 11  | BFCache Checksum Unnecessary Complexity | BFCache           | Low      | `content.js:2300-2500`                      | 200+ lines validating state checksums that are never used for recovery       |

---

## Issue 1: Port Zombie Queuing Race Condition

**Problem**

When port connection fails or is delayed (10+ seconds), `_queueMessageForPort()`
accumulates messages. If port later establishes but immediately disconnects
(zombie scenario), queued messages are NOT flushed—they remain in
`_pendingPortMessages` indefinitely. Next message attempt requeues more stale
items, creating backlog.

**Root Cause**

File: `src/content.js`  
Location: `_processPendingPortMessages()` lines 940-1050  
Issue: Method only called ONCE on successful port connection. If port
immediately disconnects after processing, future messages go to new queue but
old queue is never retried. No circuit breaker or max-age enforcement for
orphaned messages.

**Behavioral Evidence**

1. User creates Quick Tab at T=0ms
2. Port connection starts, queues message at T=50ms
3. Port connects, processes queue at T=8000ms (8 second delay)
4. Port immediately disconnects (zombie)
5. New message arrives at T=8100ms, goes to fresh queue
6. Old queue item remains in `_pendingPortMessages` with T=50ms timestamp
7. After 60 seconds, stale item is discarded silently
8. Manager never receives first update

**What's Missing**

- Orphaned queue cleanup on port disconnect should occur immediately
- Each message needs max age relative to CURRENT time, not creation time
- No notification that messages were dropped
- No mechanism to retry orphaned messages if port reconnects

---

## Issue 2: Overlapping Port Reconnection Delay Complexity

**Problem**

Port reconnection uses exponential backoff: 100ms → 200ms → 400ms → ... →
10000ms. User interaction during backoff window is blocked. If user operates
Quick Tab at T=2000ms during backoff, they experience 8+ second freeze waiting
for next reconnection attempt.

**Root Cause**

File: `src/content.js`  
Location: `_schedulePortReconnect()` lines 850-900  
Issue: Backoff multiplier stacks linearly. By attempt 7, delay is 6400ms. If
reconnection fails at attempt 4 (1600ms delay), next attempt waits another
3200ms. Total blocking time compounds.

**Code Pattern**

```
Attempt 1: 100ms
Attempt 2: 200ms
Attempt 3: 400ms
Attempt 4: 800ms
Attempt 5: 1600ms <- User operates Quick Tab here, waits 1600ms
Attempt 6: 3200ms <- Now waits 3200ms AFTER attempt 5 completes
Total: User sees 4800ms of unresponsive UI
```

**Behavioral Evidence**

From logs: When port dies at attempt 4, next message send timeout is
`timeoutMs: 2000` but reconnect delay is `3200ms`. Message timeout fires at
T+2s, reconnect hasn't started yet, fallback to storage is attempted.

**What's Missing**

- No adaptive backoff (adjust based on success rate, not just attempt count)
- No prioritization of user interactions over reconnection delays
- No "fast path" for tab visibility changes that bypass backoff
- Backoff delay and message timeout are independent concepts but are coupled

---

## Issue 3: Self-Write Detection Timing Paradox

**Problem**

Self-write detection uses two conflicting windows:

- Tracking writes: `SELF_WRITE_DETECTION_WINDOW_MS = 200ms`
- Accepting out-of-order events: `STORAGE_ORDERING_TOLERANCE_MS = 300ms`

A write at T=0ms is tracked until T=200ms. Storage event fires at T=210ms
(within Firefox's documented 100-250ms latency). Event arrives at
T=210ms—OUTSIDE the 200ms tracking window, marked as REMOTE change, incorrectly
re-applied.

**Root Cause**

File: `src/content.js`  
Location: Self-write detection setup at lines 1260-1320 vs ordering tolerance at
lines 800-840  
Issue: Two independent constants with no validation that they align.
`SELF_WRITE_DETECTION_WINDOW_MS` should be >=
`STORAGE_LISTENER_LATENCY_TOLERANCE_MS`.

**Behavioral Evidence**

1. Tab 1 writes Quick Tab state at T=100ms
2. Firefox listener latency: T=210ms
3. Self-write check: `writeTime=100, eventTime=210, timeSince=110ms`
4. Check 1: "Is this a self-write?" `110ms <= 200ms detection window?` YES →
   marked self-write
5. But check 2 happens in ordering validation:
   `lastAppliedTime=100, eventTime=210, difference=110ms`
6. Different code path accepts it anyway as "eventual consistency"
7. Same event processed TWICE: once as self-write (skipped), once as remote
   change (applied)

**What's Missing**

- No validation that constants are aligned at runtime
- No single source of truth for "what is recent enough to be self-write"
- Two separate code paths doing similar checks with different thresholds
- Comments say "must align" but nothing enforces it

---

## Issue 4: Constant Coupling Fragility

**Problem**

Constants that control unrelated concepts are coupled together, creating fragile
implicit dependencies:

```javascript
const PORT_RECONNECT_MAX_DELAY_MS = 10000; // Port backoff timing
const RESTORE_DEDUP_WINDOW_MS = PORT_RECONNECT_MAX_DELAY_MS; // Storage dedup!
const SELF_WRITE_DETECTION_WINDOW_MS = STORAGE_LISTENER_LATENCY_TOLERANCE_MS; // Indirect coupling
```

Why this is broken:

- Changing port reconnect delay (e.g., to 5000ms for battery life) inadvertently
  changes storage deduplication window
- A write that occurs during port reconnection delay might be deduplicated
  incorrectly
- Storage deduplication has NOTHING to do with port timing—they're coupled only
  by accident

**Root Cause**

File: `src/content.js`  
Location: Constant definitions lines 810-840, usage at lines 2625, 1270  
Issue: No documented reason WHY they're the same. Likely historical artifact
from incomplete refactoring.

**What's Missing**

- Independent constant definitions with clear rationale
- Runtime validation: if constants diverge, throw error
- Documentation explaining why each constant has its specific value
- Deduplication logic should NOT depend on port timing at all

---

## Issue 5: Port Disconnect Silent Cleanup Without Logging

**Problem**

When page enters BFCache (`_handleBFCachePageHide()`), port is disconnected and
`_pendingPortMessages` queue is cleared. This happens silently with minimal
logging. If port had 10 queued messages from pending operations, they are LOST
with only a single info log.

**Root Cause**

File: `src/content.js`  
Location: `_disconnectPortForBFCache()` lines 2350-2400  
Issue: Message queue flush (line 2365) happens but no detailed logging of what
was discarded. Only logs "flushed {pendingCount} messages" without identifying
which operations they represent.

**Behavioral Evidence**

1. User creates Quick Tab QT1 at T=1000ms
2. Port not connected, message queued
3. User navigates backward (BFCache entry) at T=2000ms
4. `_disconnectPortForBFCache()` called
5. Log shows "Flushed 1 pending messages"
6. QT1 creation message is LOST
7. Manager never informed of QT1 creation
8. When user navigates forward, storage.onChanged listener is relied upon for
   recovery
9. If storage write never occurred (message was in queue), state is corrupted

**What's Missing**

- Per-message logging before discarding (message type, correlationId, intended
  recipient)
- Strategy for retry or fallback before discarding
- Notification to caller that operation failed
- Queue persistence across BFCache cycles (save to sessionStorage before page
  hide)

---

## Issue 6: Inconsistent Message Handler Response Contracts

**Problem**

Different message handlers return responses in different formats:

- Some return `{success: true, data: {...}}`
- Some return `{success: false}`
- Some throw errors
- Some return nothing (undefined)

Callers don't know what to expect, leading to defensive code paths and ignored
failures.

**Root Cause**

File: `src/content.js`  
Location: Message handlers at lines 3000-3120  
Issue: No unified response contract. Each handler evolved independently. Callers
must check multiple conditions: `if (response?.success)` AND
`if (response?.data?.tabId)` AND catch exceptions.

**Behavioral Evidence**

```javascript
// Handler A returns {success: false}
const response = await sendRequestWithTimeout({ action: 'GET_CURRENT_TAB_ID' });
if (response?.success && response.data?.tabId) {
  // Handles success
}
// But doesn't check: response?.error, response?.message, etc.

// Handler B throws
try {
  const port = browser.runtime.connect({ name: '...' });
} catch (err) {
  // Catches exception - different from handler A
}

// Caller doesn't know which to expect
```

**What's Missing**

- Unified response interface:
  `{success: boolean, method: 'port'|'storage', error?: string, correlationId: string}`
- All handlers return Promise (no exceptions)
- All failures logged with same structure
- Caller always gets consistent failure information

---

## Issue 7: State Ordering Validation Too Strict for Real-World Timing

**Problem**

`_validateStorageEventOrdering()` rejects ANY event where
`sequenceId <= lastAppliedSequenceId`, even if other tabs legitimately generated
that ID. Cross-tab operations can legitimately have out-of-order sequence IDs:

1. Tab A applies sequence ID 5 at T=100ms
2. Tab B applies sequence ID 4 at T=105ms (was delayed by 5ms, legitimate)
3. Tab A receives Tab B's update, rejects it as "out of order"
4. Manager never syncs Tab B's Quick Tab operations

**Root Cause**

File: `src/content.js`  
Location: `_validateStorageEventOrdering()` lines 1500-1600  
Issue: Ordering validation assumes single-threaded, sequential updates. Real
cross-tab async operations create legitimate out-of-order events.

**What's Missing**

- Tolerance window for out-of-order events (e.g., accept if within 100ms)
- Per-tab ordering instead of global ordering
- Distinction between "duplicate" (same sequenceId) vs "out-of-order" (earlier
  sequenceId but later timestamp)
- Recovery path when rejecting an event (request full state refresh)

---

## Issue 8: Missing Tab ID Initialization Trace Points

**Problem**

Tab ID fetch happens asynchronously during initialization, but there's no clear
logging of whether features initialized before or after tab ID was available.
Code contains comments like "v1.6.3.6-v4 - FIX Cross-Tab Isolation Issue #1"
suggesting features should handle null tab ID, but there's no evidence they do.

**Root Cause**

File: `src/content.js`  
Location: `getCurrentTabIdFromBackground()` called at line 3500, used by
features at lines 3600-3650  
Issue: No phase markers in logs distinguishing "pre-tabId" vs "post-tabId"
initialization. When debugging, impossible to tell if feature initialized with
valid tab ID or null.

**Behavioral Evidence**

Logs show:

```
[Copy-URL-on-Hover] Starting module imports...
[Copy-URL-on-Hover] ConfigManager initialized
[Copy-URL-on-Hover] StateManager initialized
[Content] Requesting current tab ID from background...
[Copy-URL-on-Hover] STEP: Initializing features...
// At this point, tab ID may or may not be available
// No log indicating which state we're in
```

**What's Missing**

- Explicit phase logging: `[Initialization Phase] PRE_TABID` →
  `[Initialization Phase] POST_TABID`
- Per-feature logging of what state was available at init time
- Trace point when tab ID becomes available and features are notified
- Validation that features handle null tab ID gracefully (or fail fast)

---

## Issue 9: Manager Sidebar Grouping Race Condition

**Problem**

Manager sidebar renders Quick Tabs grouped by origin tab. During rapid cross-tab
operations (user clicks between tabs), storage.onChanged fires with stale data.
Sidebar may render incomplete groupings or duplicate entries.

**Root Cause**

File: `src/sidebar/quick-tabs-manager.js`  
Location: `renderManagerSections()` lines 600-750  
Issue: No debouncing or deduplication of rapid render calls. If
storage.onChanged fires twice in 50ms with slightly different state, second
render may execute before first completes, creating UI inconsistency.

**Behavioral Evidence**

1. User opens Tab A (create QT1), opens Tab B (create QT2) rapidly
2. Storage written for QT1 at T=100ms, for QT2 at T=120ms
3. Listener fires at T=105ms (QT1 written) → renderManagerSections() starts
4. Listener fires at T=125ms (QT2 written) → renderManagerSections() called
   again
5. First render still executing, second render starts before first completes
6. DOM updates interleaved, final state may show QT2 without proper grouping
   header or duplicate entries

**What's Missing**

- Debounce render calls: buffer changes for 100ms before re-rendering
- Queue manager: ensure renders complete serially, not parallel
- Checksum before/after render to detect corruption
- Recovery: if state doesn't match expected, request full refresh

---

## Issue 10: Early Storage Listener Registration Fragility

**Problem**

At line ~150 in content.js, `browser.storage.onChanged.addListener()` is called
immediately at script load. However, if this call fails (rare but possible),
there's a single try/catch that logs but continues. If listener registration
fails silently, ALL storage changes are missed—no fallback, no retry, no circuit
breaker notification.

**Root Cause**

File: `src/content.js`  
Location: Lines 150-170 (early listener registration)  
Issue: Single try/catch wraps listener registration. If it fails, we can't
detect the failure mode (permission issue vs. runtime issue). Subsequent code
assumes listener is active.

**Behavioral Evidence**

```javascript
try {
  browser.storage.onChanged.addListener(_earlyStorageChangeHandler);
} catch (err) {
  console.error(
    '[Content] CRITICAL: Failed to register early storage listener:',
    err.message
  );
  // Then execution continues silently
  // _handleStorageChange is defined later, but listener never fires
  // Application continues with broken assumption
}
```

**What's Missing**

- Fallback listener registration if first attempt fails
- Flag to track if listener is actually active:
  `_storageListenerIsActive = true/false`
- Runtime checks: before relying on storage events, validate listener is
  registered
- Heartbeat mechanism: periodically verify listener is working (write test key,
  verify event fires)

---

## Issue 11: BFCache Checksum Validation Unnecessary Complexity

**Problem**

`_validateHydrationChecksum()` and `_computeStateChecksum()` implement a djb2
hash algorithm to validate state wasn't corrupted. However, checksums are
computed but the result is never used for recovery. Function returns
`{valid: true, computed: 'chk-...', reason: 'match'}` but callers only log
it—never take corrective action.

**Root Cause**

File: `src/content.js`  
Location: `_computeStateChecksum()` lines 2100-2150, used at lines 2200-2250  
Issue: 50+ lines implementing hashing algorithm with no recovery path. If
checksum fails, we log the mismatch and continue anyway. Checksum validation has
zero effect on behavior.

**Behavioral Evidence**

```javascript
const checksumResult = _validateHydrationChecksum(localState, localState.checksum);
if (!checksumResult.valid) {
  console.error('[Content] CHECKSUM_VALIDATION_FAILED:', {...});
  // But then what? We continue anyway!
  // No recovery, no reload, no corruption handling
}
_updateAppliedOrderingState(localState);  // Use corrupted state anyway
```

**What's Missing**

- Recovery path if checksum fails: request full state refresh from background
- Action taken based on validation result (currently validation is purely
  informational)
- If checksum invalid, mark state as suspect and apply additional safeguards
- Clear documentation of what the checksum detects vs. what it cannot detect

---

## Shared Architecture Pattern: Incomplete Error Recovery

**Observation**

Issues 1, 5, 6, 10, and 11 share a common pattern: **error conditions are
detected but recovery is incomplete**.

- Orphaned messages are identified but not retried
- Port disconnects flush messages but don't persist them
- Handler responses are inconsistent without recovery options
- Listener registration failures don't fallback
- Checksum failures don't trigger recovery

This incomplete error recovery is a symptom of the port-based architecture's
fundamental limitation: port connections are binary (connected/disconnected), so
recovery logic was never fully developed.

---

## Logging Observability Gaps

### Gap 1: Missing Correlation IDs Across Operations

Many operations lack a single `correlationId` that traces the entire flow:

- Message sent from content → background receives (different context)
- Background processes message → storage written (different handler)
- Storage.onChanged fires → content receives (different listener)

Currently, logs show individual pieces but can't trace a single user operation
end-to-end.

### Gap 2: Inconsistent Log Prefixes

Logs use different prefixes inconsistently:

```
[Content] PORT_LIFECYCLE
[Content] PENDING_MESSAGE_SENT
[Copy-URL-on-Hover] ✓ Content script loaded  // Different prefix!
[Content] v1.6.3.8-v8 Port connection established
```

Makes grepping for related logs difficult.

### Gap 3: No Structured Logging Format

Logs mix formats:

```
console.log('[Content] MESSAGE_SENT', {type: msg.type, ...})  // Object
console.log('[Content] Failed to send')  // Plain string
console.error('[Content] Error:', err.message)  // Error object
```

Difficult to parse logs programmatically.

### Gap 4: Missing "Happy Path" Logging

Only errors and warnings are logged. Success paths are absent or minimal:

```
if (response?.success) {
  console.log('[Content] Got current tab ID from background:', {tabId});
}
// But no log on timeout or error? Check lines 3050-3080
```

Makes it hard to trace normal execution flow.

---

## Recommendations for v2.0 Design

While these 11 issues will NOT be "fixed" by the v2.0 removal process, the new
architecture WILL prevent their recurrence by:

1. **No message queuing** (Issue 1) — Messages use runtime.sendMessage with
   timeout, not queues
2. **No port reconnection delays** (Issue 2) — No persistent port, no
   reconnection logic needed
3. **Single storage mechanism** (Issues 3, 4) — One way to write state,
   consistent timing
4. **Unified error handling** (Issue 6) — All operations return Promise with
   standard response
5. **Simple ordering** (Issue 7) — Storage-based, eventual consistency, no
   complex validation
6. **Clear initialization phases** (Issue 8) — Features initialize without tab
   ID, get notified when available
7. **Async-safe UI updates** (Issue 9) — Debouncing built into storage.onChanged
8. **Fallback-first design** (Issue 10) — Storage.onChanged is primary
   mechanism, always works
9. **No checksums** (Issue 11) — Fetch fresh state on uncertainty, no validation
   complexity
10. **Structured logging** (Gap fixes) — Log format standardized, correlationIds
    mandatory

---

## Conclusion

These 11 behavioral issues and logging gaps represent the cost of the hybrid
architecture's incomplete migration. They are not bugs in v2.0 (v2.0 doesn't
exist yet), but they are symptoms of v1.6.3.8-v10's fundamental limitations.
Completing the migration to v2.0 will eliminate the root causes, not patch these
symptoms.

---

**Document Quality Metrics:**

- Token count: ~3,200
- Scope: 11 behavioral issues + 4 logging gaps
- Code references: 25 specific file locations
- Actionability: Low (these are diagnostic, not prescriptive—meant to inform
  design not to guide removal)

---
