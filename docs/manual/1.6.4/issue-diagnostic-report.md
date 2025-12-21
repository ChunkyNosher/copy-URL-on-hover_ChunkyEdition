# Copy URL on Hover - Critical Issues Diagnostic Report

**Extension Version:** v1.6.3.10-v10  
**Date:** 2025-12-20  
**Scope:** Tab-scoped Quick Tab state synchronization and ownership validation

---

## Executive Summary

Copy URL on Hover has multiple critical and high-severity issues affecting
tab-scoped Quick Tab persistence and cross-tab ownership filtering. These issues
trace to architectural mismatches between Firefox's asynchronous message
ordering guarantees and the extension's synchronous assumptions, combined with
premature timeout exhaustion and incomplete ownership validation. Five root
causes across different code paths prevent Quick Tab state (position, size,
minimize status) from persisting to storage when created from content scripts.
All affected tabs fail to write state with "DUAL-BLOCK CHECK FAILED" errors
related to null tab IDs during initialization phase. Logs show consistent
pattern: `originTabId is NULL` warnings and `STORAGEWRITEBLOCKED` errors prevent
any persistence during critical initialization window (7.2 seconds).

---

## Issues Overview

| Issue ID | Component                       | Severity     | Root Cause                                                                              | Impact                                                                    |
| -------- | ------------------------------- | ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1        | Tab ID Acquisition              | **CRITICAL** | Retry exhaustion after 7.2s → no fallback mechanism                                     | All storage writes fail with null currentTabId                            |
| 2        | Message Ordering Assumption     | **CRITICAL** | Firefox doesn't guarantee message order → sequence IDs ineffective                      | RESTORE_QUICK_TAB arrives before CREATE; cross-tab filtering fails        |
| 3        | Storage Synchronization Race    | **CRITICAL** | storage.onChanged async relative to storage.local.set() → port messages arrive first    | Content script hydrates with stale originTabId values                     |
| 4        | originTabId Validation Gap      | **HIGH**     | No validation at background handler level → malformed requests accepted                 | Ownership filtering fails; data loss possible                             |
| 5        | Adoption Cache TTL Expiration   | **HIGH**     | Fixed 5s TTL doesn't account for network latency → cache expires mid-flight             | Late adoption messages fall back to ID pattern matching (different owner) |
| 6        | Message Queue Overflow          | **HIGH**     | MAX_INIT_MESSAGE_QUEUE_SIZE=20, silent drop on overflow → no retry                      | Quick Tab creation messages silently lost during slow init                |
| 7        | Write Queue Unbounded Asymmetry | **MEDIUM**   | Inconsistent queue strategies (bounded message, unbounded write) → backpressure failure | Write queue accumulates without limit; message queue drops                |
| 8        | Missing Logging Coverage        | **MEDIUM**   | No visibility into dropped messages, queue state, ownership filtering                   | Debugging failures difficult; root cause obscured                         |

---

## Issue 1: Tab ID Acquisition Retry Exhaustion

**Problem:** Content script cannot persist any Quick Tab state because tab ID
acquisition fails permanently after 7.2 seconds, with no recovery mechanism. All
subsequent storage operations fail with `currentTabId null` ownership validation
errors.

**Evidence from logs:**

```
2025-12-20T075750.307Z WARN StorageUtils v1.6.3.10-v9 generateTransactionId
  Identity not initialized tabId UNKNOWN, identityStateMode INITIALIZING
  warning Transaction ID generated before tab ID initialized

2025-12-20T075754.819Z WARN StorageUtils Storage write BLOCKED - DUAL-BLOCK CHECK FAILED
  checkFailed currentTabId is null, currentWritingTabId null
  isTabIdInitialized false
  suggestion Pass tabId parameter to persistStateToStorage or wait for initWritingTabId to complete
```

**Root Cause:**

File: `src/content.js`  
Location: `getCurrentTabIdFromBackground()` method (lines ~1200-1250)  
Issue: Exponential backoff implements retry delays [0ms, 200ms, 500ms, 1500ms,
5000ms] totaling 7.2 seconds. After final retry exhausted, method returns `null`
permanently. Content script has no mechanism to retry again if background
initializes after 7.2s threshold. All subsequent `persistStateToStorage()` calls
fail because `currentTabId` remains `null`.

Related locations:

- `TAB_ID_RETRY_DELAYS_MS` constant: Hard-coded 7.2s total budget
- `_storeTabIdAcquisitionResult()`: Sets final result without continuation
  option
- `setWritingTabId()` never called in storage-utils.js when tab ID
  initialization fails

**Fix Required:**

Implement fallback retry mechanism after initial backoff exhaustion. Instead of
returning null after 7.2s, extend acquisition with slower "background
initialization" retry loop (30s-60s total timeout with 5-10s intervals).
Implement event-driven retry trigger that re-attempts tab ID acquisition when
background messages are received, signaling background has initialized. Add
continuation handler that monitors for background readiness beyond initial
timeout window. Ensure `setWritingTabId()` is called with resolved tab ID once
acquisition succeeds, even if delayed.

---

## Issue 2: Message Ordering Assumption Violation

**Problem:** Extension assumes Firefox guarantees order of
`runtime.sendMessage()` between content scripts, but Firefox provides no such
guarantee. RESTORE_QUICK_TAB messages can arrive before CREATE_QUICK_TAB,
causing cross-tab filtering logic to fail.

**Root Cause:**

File: `src/content.js`  
Location: `_handleRestoreQuickTab()` (lines ~2100-2150) and
`_checkRestoreOrderingEnforcement()` (lines ~2000-2050)  
Issue: Implementation uses `sequenceId` tracking to prevent duplicate RESTORE
operations. However, sequence IDs only track ordering within a single content
script context. Firefox browser-level message routing can reorder messages from
multiple content scripts arbitrarily. When RESTORE arrives from Tab B before
CREATE from Tab A completes, the sequence check cannot prevent out-of-order
application.

Related patterns:

- Content script tracks `pendingRestoreOperations` Map per tab
- Deduplication window checks if message sequence ID > previous → assumes
  ordered delivery
- Cross-tab filtering in `_isDuplicateRestoreMessage()` depends on prior CREATE
  having completed

**Fix Required:**

Implement protocol-level ordering enforcement independent of browser message
ordering. Add `operationType` field (CREATE vs RESTORE vs UPDATE) and
`targetQuickTabId` to all messages. Implement command queue at content script
level that buffers all operations and processes them in a deterministic order:
sort by (tabId, operationType, sequenceId, timestamp). Process queue
sequentially rather than relying on arrival order. For RESTORE operations
specifically, validate that target Quick Tab exists in local Map before applying
state changes. Add explicit acknowledgment protocol where background confirms
CREATE completion before content script can send RESTORE.

---

## Issue 3: Storage Synchronization Race - Async Event Timing

**Problem:** Firefox's `storage.onChanged` listener fires asynchronously AFTER
`storage.local.set()` Promise resolves, unlike Chrome. Port messages from
background arrive before storage events, causing content script to hydrate with
outdated state including stale `originTabId`.

**Evidence from logs:**

```
2025-12-20T075750.307Z LOG VisibilityHandler Persisting 1 tabs 0 minimized
2025-12-20T075750.307Z WARN StorageUtils ADOPTIONFLOW serializeTabForStorage -
  originTabId is NULL
```

Storage write completes (or fails), then later storage.onChanged should fire.
But logs show content script continues without waiting for event.

**Root Cause:**

File: `src/background/handlers/QuickTabHandler.js` and `src/content.js`  
Background Location: `saveStateToStorage()` (lines ~800-850) calls
`await browser.storage.local.set()`  
Content Location: Port connection handler (lines ~1400-1450) processes
background messages immediately

Issue: Port messages describing state changes reach content script BEFORE
`storage.onChanged` listener fires. Content script hydrates from port message
data, then 200ms dedup window expires. When storage event finally fires (async),
dedup window has closed and event is incorrectly filtered as duplicate.

**Fix Required:**

Decouple port messages from storage event handling. Instead of assuming storage
events will fire quickly, use explicit acknowledgment protocol: background sends
message AFTER confirming storage.local.set() completion AND waiting for storage
event in background to confirm broadcast to listeners. Content script should not
hydrate from port message data; instead wait for explicit storage.onChanged
event with confirmed data. Alternatively, extend dedup window dynamically based
on observed latency. Add latency tracking: measure time between
`storage.local.set()` call and `storage.onChanged` listener firing, then set
dedup window to 1.5x observed latency.

---

## Issue 4: originTabId Validation Gap at Background Handler

**Problem:** Content script sets `originTabId` in message payload, but
background handler does NOT validate that `originTabId` matches `sender.tab.id`.
Malicious or buggy code could set incorrect `originTabId`, breaking ownership
filtering and enabling cross-tab data corruption.

**Evidence from logs:**

```
2025-12-20T075751.561Z ERROR CreateHandler WARNING originTabId is nullundefined!
  optionsOriginTabId null, defaultsOriginTabId null, currentTabId null
```

Handler creates Quick Tab with `originTabId: null`, stores it, no validation
error thrown.

**Root Cause:**

File: `src/background/handlers/QuickTabHandler.js`  
Location: `CREATE_QUICK_TAB` handler (lines ~150-200) and `RESTORE_QUICK_TAB`
handler (lines ~250-300)  
Issue: Handlers accept `originTabId` from message payload and trust it
implicitly. No code path validates that payload-provided `originTabId` matches
`sender.tab.id`. Storage write accepts null `originTabId` without enforcing
constraint.

Related: `storage-utils.js` `serializeTabForStorage()` checks `originTabId` but
only logs warning when null; doesn't reject write.

**Fix Required:**

Add mandatory validation in all handlers that accept `originTabId`:

- Extract `sender.tab.id` from message context
- Compare payload-provided `originTabId` with `sender.tab.id`
- If mismatch: reject message with explicit error, log security concern
- If payload missing `originTabId`: use `sender.tab.id` as default, don't accept
  null
- Add validation middleware that runs BEFORE any handler processes message
- Throw error (not just log warning) when `originTabId` is null/undefined for
  operations that require ownership

---

## Issue 5: Adoption Cache TTL Expiration During Network Delay

**Problem:** Adoption tracking uses fixed 5-second TTL. When adoption message is
delayed beyond 5s (normal network latency), cache expires. Late-arriving
adoption is missed, Quick Tab reverts to ID pattern matching, using different
owner context.

**Root Cause:**

File: `src/content.js`  
Location: `_trackAdoptedQuickTab()` (lines ~1900-1950) and
`ADOPTION_TRACKING_TTL_MS = 5000`  
Issue: Cache stores recently adopted Quick Tab IDs with fixed expiration. No
correlation between adoption message travel time and TTL duration. If adoption
handshake latency exceeds TTL, cache entry expires before message arrives.

Example timeline:

- T0: Adoption message sent from background
- T1 (2.5s): Cache expires (TTL = 5s)
- T2 (6s): Adoption message arrives (network delay 6s)
- T3: Cache miss, falls back to ID pattern matching (WRONG OWNER)

**Fix Required:**

Replace fixed TTL with dynamic TTL based on observed network latency. Implement
latency tracker that measures round-trip time for handshake messages (already in
code: handshake latency measurement). Calculate
`adoptionCacheTTL = 3 * observedHandshakeLatency` (3x multiplier for safety
margin). Store alongside adoption entry:
`{adopting: true, timestamp, ttl: dynamicTTL}`. Check TTL at retrieval time:
`if (Date.now() - entry.timestamp <= entry.ttl)` rather than using timer-based
expiration. Add metrics logging: track cache hit rate, miss count, and cases
where TTL expired before message arrival. If latency measurement unavailable,
use safe default of 30 seconds instead of 5 seconds.

---

## Issue 6: Message Queue Silent Drop on Overflow

**Problem:** Message initialization queue has fixed size of 20 items. When queue
fills during slow background initialization, oldest message is silently dropped.
No retry mechanism, no notification to caller. Quick Tab creation messages lost
forever.

**Evidence from logs:** Logs don't show dropped message events, but queue logic
in code silently discards.

**Root Cause:**

File: `src/content.js`  
Location: `_queueInitializationMessage()` (lines ~1600-1650) and
`MAX_INIT_MESSAGE_QUEUE_SIZE = 20`  
Issue: Queue implemented as fixed-size array:
`if (initializationMessageQueue.length >= MAX_INIT_MESSAGE_QUEUE_SIZE) { shift() }`.
When 21st message arrives, oldest message removed without logging or retry.
Caller has no indication message was dropped.

**Fix Required:**

Implement backpressure mechanism instead of silent drop. When queue approaches
limit (trigger at 15/20), pause accepting new messages and emit warning.
Implement unbounded queue with memory monitoring: allow queue to grow beyond 20
but track cumulative memory. When memory threshold exceeded (e.g., >50MB
or >1000 items), then implement FIFO drop with explicit logging of dropped
message metadata. For each dropped message, log: message type, Quick Tab ID,
timestamp, queue size at drop time. Implement exponential backoff in message
sender: if message queued, wait 100ms before sending next, if queue still
exists. Retry dropped messages at least once after background becomes ready.

---

## Issue 7: Write Queue Unbounded vs Message Queue Bounded Asymmetry

**Problem:** Inconsistent queue strategies create backpressure asymmetry.
Message initialization queue bounded at 20, but write queue unbounded. If
background initialization slow, message queue fills and drops oldest, but write
queue keeps accumulating. Leads to memory bloat and lost operations in different
code paths.

**Root Cause:**

File: `src/content.js` and `src/background/handlers/QuickTabHandler.js`  
Content Location: `_queueInitializationMessage()` (message queue bounded),
`_writeQueue` array (unbounded)  
Background Location: `QuickTabHandler` accumulates writes in queue without size
limit

Issue: Architectural inconsistency. Message queue designed for initialization
phase (temporary buffering), write queue designed for persistence (critical
operations). But no coordination between them. Message queue fills and drops at
20 items. Write queue accepted unlimited items and background processes them in
order. Creates situation where: DROP-MESSAGE → QUEUE-WRITE → PROCESS-WRITE → but
source message never created

**Fix Required:**

Unify queue strategies across both message and write paths. Choose single
bounding strategy:

1. **Option A (Recommended):** Keep both queues unbounded but add memory
   monitoring. Implement garbage collection that removes completed operations
   from queue. Log warnings at 100 items, 500 items, 1000 items thresholds. Add
   periodic cleanup of "processed" entries (those with confirmation from
   background).
2. **Option B:** Set both queues to same bounded size (e.g., 50 items).
   Coordinate backpressure: message queue full → slow down message send rate →
   this naturally reduces write queue growth.
3. **Option C:** Split strategy intentionally with documentation. Message queue
   stays 20, write queue stays unbounded BUT add fallback: if write queue
   exceeds 100 items, pause new Quick Tab creation (user-facing), emit
   notification "Waiting for background to sync state".

Implement retry mechanism that operates independently of queue size: keep
separate retry list of "critical operations" (CREATE, DELETE) that must succeed.
Re-attempt until confirmed.

---

## Issue 8: Missing Logging Coverage for Queue Operations

**Problem:** Extension lacks visibility into queue state transitions, dropped
messages, and ownership filtering failures. Debugging why Quick Tabs fail to
persist is nearly impossible without extensive manual log analysis.

**Root Cause:**

Scattered across multiple files:

- `src/content.js`: Queue overflow has no log statement
- `src/content.js`: Message dedup window does log, but dedup FAILURES (when
  message rejected) not logged
- `src/background/handlers/QuickTabHandler.js`: Write queue state not logged
- `src/storage/storage-utils.js`: Ownership validation logs warning but not
  failure path
- `src/content.js`: When tab ID acquisition times out, no final error log

**Impact:** When user reports "my Quick Tab didn't save position", logs show:

- Quick Tab created ✓
- Position change event fired ✓
- Storage write initiated ✓
- Storage write FAILED (null tab ID) ✗

But missing: WHY tab ID null (retry exhaustion not logged), HOW MANY retries
attempted, WHEN retry loop ended.

**Fix Required:**

Add comprehensive logging at these points:

1. **Tab ID Acquisition Lifecycle:**
   - Log each retry attempt: "Retry #{N} with delay {ms}ms, elapsed {total}ms"
   - Log exhaustion: "Tab ID acquisition exhausted all {N} retries after
     {total}ms, final result: null"
   - Log recovery (if implemented): "Background readiness detected, resuming tab
     ID acquisition"

2. **Message Queue Operations:**
   - Log when queue fills: "Message queue at capacity ({current}/{max}),
     dropping oldest message of type {type} for Quick Tab {id}"
   - Log dropped message details: "Dropped message: type={type},
     quickTabId={id}, timestamp={age}ms old"
   - Log queue state periodically: "Queue snapshot: {N} pending messages, oldest
     {age}ms old"

3. **Write Queue State:**
   - Log write queue depth after each operation: "Write queue depth: {N} pending
     writes"
   - Log accumulation warnings: "Write queue growing: {N} items (threshold
     warning at 100)"
   - Log failed write operations with Full context: "Write failed:
     transaction={id}, reason={reason}, retrying after {delay}ms"

4. **Ownership Validation:**
   - Log all ownership filter operations: "Ownership filter: input {N} tabs,
     output {M} tabs after filtering (filtered out {N-M})"
   - Log individual validation failures: "Ownership filter rejected tab {id}:
     originTabId mismatch (claimed {claimedId}, actual {actualId})"
   - Log null originTabId explicitly: "CRITICAL: originTabId validation FAILED,
     tab will not persist, quickTabId {id}"

5. **Storage Event Synchronization:**
   - Log port message receipt with timestamp: "Port message received:
     type={type}, timestamp={T}, dedup window until {T+200}ms"
   - Log dedup decision: "Dedup check: message ACCEPTED (no conflict)" or "Dedup
     check: message REJECTED (duplicate within window, age={age}ms)"
   - Log storage event receipt: "storage.onChanged fired at {T}, {delay}ms after
     preceding storage.local.set() call"

All logs should include correlation ID (transaction ID) to trace message through
system, Quick Tab ID for context, and timing information.

---

<scope>
Modify:
- `src/content.js`: Tab ID acquisition (add continuation mechanism), message queuing (add overflow handling), logging (add queue/dedup/timeout logs)
- `src/background/handlers/QuickTabHandler.js`: originTabId validation (add mandatory sender comparison), write queue logging
- `src/storage/storage-utils.js`: originTabId validation (reject null, not just warn), add logging for ownership filter results
- `MessageRouter.js`: Add validation middleware for originTabId before routing to handlers

Do NOT Modify:

- Core port connection handler architecture (fix synchronization, not replace)
- Storage API usage (work with async, not against it)
- URL copying functionality (separate from Quick Tab issues) </scope>

---

<acceptancecriteria>

**Issue 1 - Tab ID Acquisition Exhaustion:**

- Content script acquires tab ID even if background delayed beyond 7.2s
- Acquisition retries for minimum 30s total (5x current timeout)
- `setWritingTabId()` called with resolved ID once acquired
- Ownership validation succeeds after ID acquired (no "null tab ID" blocks)
- Manual test: Reload background, immediately create Quick Tab on new page,
  state persists

**Issue 2 - Message Ordering:**

- Content script buffers operations and processes in deterministic order
- RESTORE_QUICK_TAB validates target exists before applying changes
- Cross-tab filtering works regardless of message arrival order
- Manual test: Create Quick Tab in Tab A, Tab B simultaneously creates another,
  both persist with correct owners
- No "out-of-order" state corruption observed in logs

**Issue 3 - Storage Synchronization:**

- Port messages don't trigger hydration; only storage.onChanged does
- Dedup window extended to account for async delay (minimum 1.5x measured
  latency)
- Content script waits for storage event before considering write complete
- Manual test: Create Quick Tab, immediately refresh page, restored state
  matches persisted

**Issue 4 - originTabId Validation:**

- Background rejects any message with originTabId != sender.tab.id
- Default to sender.tab.id if payload missing (never null)
- Validation middleware runs before handler execution
- Manual test: Malformed message (wrong originTabId) rejected with error log

**Issue 5 - Adoption Cache TTL:**

- TTL is dynamic based on observed latency (3x handshake latency minimum)
- Cache minimum TTL 30s (fallback if latency unavailable)
- Late adoption messages (up to 30s) correctly recognized
- Manual test: Create Quick Tab, wait 10s, adoption message arrives, correctly
  adopted

**Issue 6 - Message Queue Overflow:**

- Dropped messages logged with metadata (type, ID, age)
- Queue backpressure prevents silent drops when possible
- Critical messages (CREATE, DELETE) have retry mechanism separate from queue
- Manual test: Create 50 Quick Tabs while background initializing, none are
  silently lost

**Issue 7 - Queue Asymmetry:**

- Message queue and write queue use consistent strategy
- Backpressure applied uniformly across both queues
- Manual test: Heavy load doesn't cause memory bloat or lost operations

**Issue 8 - Logging Coverage:**

- Tab ID acquisition logs all retry attempts and exhaustion point
- Message queue logs overflow events and dropped messages
- Ownership validation logs all failures with context
- Storage sync logs all port messages and dedup decisions
- Manual test: Enable debug logs, create Quick Tab, troubleshoot any issue from
  logs alone

**All Issues:**

- All existing tests pass
- No new console errors or unhandled rejections
- No memory leaks under heavy Quick Tab creation load
- Manual test: Create 100 Quick Tabs across multiple tabs, reload browser, all
  state persists correctly
- Cross-browser consistency: Test on Chrome to verify behavior matches

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Log Analysis Summary</summary>

**Common Failure Pattern Observed:**

1. User creates Quick Tab via keyboard shortcut (Ctrl+E)
2. Content script generates Quick Tab ID (e.g.,
   `qt-unknown-1766217468967-eg3l9wbrx0jl`)
3. CreateHandler logs: `originTabId is null/undefined` (ERROR level)
4. VisibilityHandler attempts storage persist (focus event)
5. StorageUtils logs:
   `ADOPTIONFLOW serializeTabForStorage - originTabId is NULL`
6. Storage write queued with transaction ID
7. **Ownership validation BLOCKS write:
   `DUAL-BLOCK CHECK FAILED currentTabId is null`**
8. StorageWrite logs: `LIFECYCLEFAILURE ... Ownership validation failed`
9. VisibilityHandler logs: `Storage persist failed`
10. No state persisted; on reload, Quick Tab gone

**Critical Timing Window:** All failures occur within first 7.2 seconds after
content script initializes. After this window, failures continue because
`currentTabId` remains null permanently.

**All Observed Failures Share Same Root:** Tab ID acquisition never completes
successfully, either because:

- Background not ready (returns null from `GET_CURRENT_TAB_ID`)
- Backoff exhaustion reached before background initialized
- Port disconnection during initialization

</details>

<details>
<summary>Firefox API Behavior Research</summary>

**storage.onChanged Async Timing (MDN, Mozilla Discourse #40757):**

> The storage.onChanged listener fires asynchronously AFTER the
> storage.local.set() Promise resolves. This is a fundamental difference from
> Chrome, where the event may fire synchronously or with minimal latency.
> Applications must not assume storage events will fire within any specific time
> window.

**Message Ordering (Firefox WebExtensions):**

> Messages sent via runtime.sendMessage() from different content scripts are not
> guaranteed to be delivered in send order. The browser processes messages based
> on internal queue scheduling and may deliver them out of order if multiple
> content scripts send simultaneously.

**Service Worker Initialization (MV3, Firefox):**

> Service workers can be terminated when idle and restarted on demand. Event
> listeners must be registered synchronously during startup. Late registration
> (inside async/await) may be missed if the worker is terminated and restarted.
> First message after restart may fail with "Receiving end does not exist"
> error.

</details>

---

## Priority and Complexity

**Priority:** CRITICAL (Issues 1-3) and HIGH (Issues 4-7)  
**Estimated Complexity:** HIGH  
**Recommended Approach:** Implement as single coordinated fix across content.js
and background handlers. Changes to tab ID acquisition will cascade through
storage validation, which enables message ordering fixes. Fix Issues 1-3 before
4-7 for proper foundation.

---
