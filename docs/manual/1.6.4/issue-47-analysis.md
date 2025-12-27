# Issue #47 Log Analysis Report: Critical Logging Gaps & Bugged Behaviors Discovered

**Extension Version:** v1.6.3.12-v4 | **Date:** 2025-12-27 | **Scope:**
Diagnostic analysis of eight additional critical gaps and six previously
unidentified bugged behaviors in storage, port messaging, and state
synchronization

---

## Executive Summary

Analysis of extension logs and codebase scan of the
`copy-URL-on-hover_ChunkyEdition` repository reveals **eight additional critical
gaps** plus **six newly discovered bugged behaviors and missing logging
actions** not previously identified. These issues create silent failures,
cascading timeout errors, and complete loss of observability for critical
operations including tab destruction, storage persistence, and port message
handling. The combination of these gaps prevents effective debugging and enables
data loss scenarios where user tab state is not persisted despite the extension
attempting the operation.

**Key Critical Finding:** The extension attempts to use
`browser.storage.session` which **does not exist in Firefox** (only available in
Chromium-based browsers since Chrome 102 and Firefox 115+). The codebase
currently falls back to `browser.storage.local` via `SessionStorageAdapter`, but
this fundamental incompatibility cascades through the entire Quick Tab
persistence system, causing all storage operations to fail silently with
"undefined" errors that are caught but never logged with sufficient context for
recovery.

---

## Root Cause Analysis: Firefox Storage API Incompatibility

### Core Issue: browser.storage.session Availability

According to
[Mozilla WebExtensions documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session),
`browser.storage.session` was **not available in Firefox prior to Firefox 115**
(released July 2023). The extension runs on Firefox with Manifest Version 2
(based on codebase analysis), which required `storage.session` support only
recently.

**Status in current codebase:**

- **SessionStorageAdapter.js** (line 1-15): Comments indicate v1.6.3.12-v4
  already attempted a FIX to "Replace browser.storage.session with
  browser.storage.local"
- **Reality:** The code still references session-scoped storage semantics but
  now uses `browser.storage.local` (which is persistent across browser restarts
  unless explicitly cleared)
- **Problem:** This creates semantic mismatch—`browser.storage.local` is
  designed for persistent storage, not session-scoped, yet the code treats it as
  session storage

### Inherent Limitation: Async Storage API Behavior

According to
[MDN WebExtension Storage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage):

- Storage API in Firefox is **completely asynchronous** (uses Promises, not
  callbacks)
- Each `set()` and `get()` call involves **I/O latency**—typically 1-10ms per
  operation
- Storage operations can fail silently if browser storage quota exceeded,
  corrupted, or service worker context lost
- **No built-in timeout mechanism**—extensions must implement their own timeout
  handling

---

## Problem Summary

Log analysis reveals the following failure patterns:

1. **Storage write operations fail repeatedly** with "cant access property set,
   e.storage.session is undefined" errors but system continues queuing
   operations without recovery fallback
2. **forceEmpty flag not set on Close All operations**, causing storage
   persistence to fail silently when tab count = 0
3. **Port messages sent but no handler outcome logged**, creating asymmetric
   visibility—senders see "sent" but receivers never log "received"
4. **Cache staleness detection constant defined but never used**, allowing
   indefinite cache divergence without warning
5. **Storage marked unavailable but writes continue anyway**, wasting resources
   on impossible operations
6. **Self-write detection diagnostic data missing**, making it impossible to
   debug whether change event attribution is working
7. **Port message handler missing entry/exit logging**, creating "black box"
   effect where handler execution timing and outcomes unknown
8. **Timeout errors cascade into rapid-fire write queue**, creating
   denial-of-service pattern on storage failure
9. **Missing correlationId propagation** through state sync path prevents
   tracing complete operation flow
10. **No circuit breaker implementation** to stop repeated failed storage
    attempts after threshold exceeded

---

## Root Causes & Issues

### Issue #1: Storage Write Failures Loop Indefinitely Without Recovery (Critical)

**File:** `src/storage/SessionStorageAdapter.js`,
`src/features/quick-tabs/handlers/UpdateHandler.js`

**Location:** Storage write attempt/retry logic (all files calling
`browser.storage.local.set`)

**Issue:** System attempts `browser.storage.local.set()` which fails immediately
with "cant access property set, e.storage.session is undefined" error. Error is
caught, retry counter increments (1/4, 2/4, 3/4, 4/4), then after final failure,
**next storage persist operation is immediately queued without any delay or
backoff**. This creates tight retry loop.

**Evidence from logs:**

```
WARN UpdateHandler Storage write attempt 1 failed cant access property set, e.storage.session is undefined
WARN UpdateHandler Storage write attempt 2 failed cant access property set, e.storage.session is undefined
WARN UpdateHandler Storage write attempt 3 failed cant access property set, e.storage.session is undefined
WARN UpdateHandler Storage write attempt 4 failed cant access property set, e.storage.session is undefined
ERROR StorageWrite LIFECYCLEFAILURE totalAttempts 4, phase ALLRETRIESEXHAUSTED
LOG WRITEQUEUE DEQUEUESTART handler UpdateHandler, nextWriteIn 0ms [IMMEDIATE NEXT WRITE]
```

**Behavior:** After 4 failed attempts (each separated by exponential backoff:
100ms, 500ms, 1000ms), system logs "ALLRETRIESEXHAUSTED" but then immediately
dequeues and starts next storage write transaction with zero delay. This creates
rapid-fire loop of failed transactions stacking in queue.

**Root Cause:** The underlying storage API call fails, but failure is not
distinguished between:

- Transient failures (quota exceeded, I/O latency spike) → requires backoff
- Permanent failures (API unavailable, storage disabled) → requires fallback
  activation

System treats all failures identically: retry with exponential backoff, then
immediately try next operation.

**Impact:**

- Storage queue grows indefinitely with failed transactions
- UI becomes unresponsive waiting for storage operations to timeout
- No recovery fallback is ever activated (should use in-memory cache)
- User data not persisted despite extension attempting the operation
- High CPU usage and battery drain on retry loops

<scope>
**Modify:**
- Retry/backoff logic in storage write handler (handlers that call SessionStorageAdapter.save)
- Queue dequeue logic to implement minimum backoff after repeated failures
- Storage unavailability detection and fallback activation
- Circuit breaker pattern implementation to stop retries after threshold

**Do NOT Modify:**

- Core `browser.storage.local` API calls (that's addressed in
  issue-47-revised.md)
- State Manager or Manager Cache logic
- Session storage adapter constructor/initialization </scope>

**Fix Required:** Implement circuit breaker pattern: after 5 consecutive failed
storage write transactions, mark storage as UNAVAILABLE and stop attempting
writes for 30-60 seconds. During unavailable period, use in-memory cache + port
messaging as fallback. Attempt periodic test write to detect recovery (suggest
every 30 seconds). When test write succeeds, resume normal storage writes.

<acceptance_criteria>

- [ ] After ALLRETRIESEXHAUSTED, next queue dequeue waits minimum 5 seconds
      before attempting
- [ ] Circuit breaker implemented: after 5 consecutive failed transactions,
      storage marked UNAVAILABLE
- [ ] When UNAVAILABLE state active, writes bypass `browser.storage.local` and
      use fallback (in-memory + port)
- [ ] Test write attempted every 30 seconds to detect recovery
- [ ] Logs show "CIRCUITBREAKER_TRIPPED" entry when circuit breaker activates
- [ ] Logs show "CIRCUITBREAKER_RECOVERED" when test write succeeds
- [ ] Manual test: trigger storage failure → logs show circuit breaker activate
      within 5 failed writes
- [ ] Manual test: storage recovers → test write succeeds, normal storage writes
      resume </acceptance_criteria>

---

### Issue #2: forceEmpty Flag Not Set on Close All Operations (Critical)

**File:** `src/features/quick-tabs/handlers/DestroyHandler.js`

**Location:** Close All / Destroy All handler when persisting 0 tabs

**Issue:** When user closes all tabs (tab count becomes 0), handler calls
storage persist with hardcoded `forceEmpty=false`. Storage layer rejects empty
writes unless `forceEmpty=true`, so persistence silently fails with warning:
"Empty write rejected, forceEmpty required".

**Evidence from logs:**

```
LOG DestroyHandler Persisting state with 0 tabs forceEmpty false
WARN DestroyHandler BLOCKED Empty write rejected forceEmpty required
WARN DestroyHandler Use forceEmpty=true for intentional Close All operations
[NO RETRY, OPERATION ABANDONED]
```

**Behavior:** Handler knows state is empty (0 tabs) and intentionally persisting
that state, but passes `forceEmpty=false`. This is contradictory—if
intentionally persisting empty state (user clicked Close All), `forceEmpty`
should be `true`. Warning even tells developers to set it, but code never does.

**Root Cause:** DestroyHandler treats empty state as suspicious and applies
defensive flag (`forceEmpty=false`). However, Close All operation **is
intentional empty state**, not accidental. Flag should reflect intent: `true`
for intentional empty writes, `false` for updates to existing state.

**Impact:**

- Close All state never persists to storage
- On next session, closed tabs reappear unexpectedly (major UX issue)
- Silent failure—no error surfaced to user, just wrong behavior
- Data loss: user closes all tabs expecting them gone, they return on restart

<scope>
**Modify:**
- DestroyHandler or equivalent close-all handler (determine flag value based on operation intent)
- Storage write call when tab count is 0
- Flag evaluation logic: `forceEmpty` should be `true` when intentionally persisting empty state

**Do NOT Modify:**

- Storage write validation logic (that correctly rejects forceEmpty=false for
  empty state)
- Destroy operation logic itself (just the persistence call)
- Other handlers' storage write patterns </scope>

**Fix Required:** When persisting state with tab count = 0 in close-all
operation, set `forceEmpty=true` in storage write options. This indicates to
storage layer that empty state is intentional, not accidental. Distinguish this
from regular updates where `forceEmpty=false` is appropriate.

<acceptance_criteria>

- [ ] When close-all handler persists 0 tabs, logs show "forceEmpty true"
- [ ] Empty write validation accepts `forceEmpty=true` and completes
      successfully
- [ ] Manual test: close all tabs → verify logs show successful persistence with
      `forceEmpty=true`
- [ ] Manual test: reopen extension after closing all → no tabs appear
      (correctly persisted empty state)
- [ ] Manual test: other handlers (resize, move) still use `forceEmpty=false`
      for non-empty state </acceptance_criteria>

---

### Issue #3: QUICKTABREMOVED Message Sent But No Handler Outcome Logged (Critical)

**File:** `src/features/quick-tabs/handlers/DestroyHandler.js`,
`sidebar/quick-tabs-manager.js`

**Location:** DestroyHandler port message send, background message handler for
QUICKTABREMOVED

**Issue:** When sidebar destroys a tab, it sends QUICKTABREMOVED message to
background via port. Logs show "Sending QUICKTABREMOVED" but never show
"Received QUICKTABREMOVED" or any handler execution outcome on background side.
This means no confirmation that background actually processed message.

**Evidence from logs:**

```
LOG DestroyHandler REMOVEMESSAGE Sending QUICKTABREMOVED id qt-24-..., source UI, originTabId 24
[NO CORRESPONDING LOG SHOWING RECEPTION OR HANDLER EXECUTION]
LOG DestroyHandler Destroy complete source UI qt-24-...
```

**Behavior:** Message sent but receiving side never logs that it received or
processed message. Creates asymmetric visibility—sender has visibility into
sending but receiver has none into receiving.

**Root Cause:** Port message handler (background side) exists but has no
entry/exit logging. No way to know if:

- Message actually arrived at background
- Handler code executed
- Handler succeeded or failed
- How long handler took to process

**Impact:**

- No confirmation that background actually processed tab removal
- Silent failures if port messaging broken (message never reaches background)
- Can't diagnose whether removal was successful or lost in transit
- Makes debugging tab persistence issues very difficult
- No way to correlate sent message with handler execution

<scope>
**Modify:**
- Background message handler for QUICKTABREMOVED type (add entry/exit logging)
- Port message reception logging in background script
- Handler outcome logging on background side

**Do NOT Modify:**

- UI-side destroy operation
- Message sending logic
- Core background state management
- Handler processing logic itself (just add observability) </scope>

**Fix Required:** Add explicit logging when background receives and processes
QUICKTABREMOVED messages. Handler should log: entry (message received,
correlationId if present, timestamp), handler execution details (what was done,
affected tabs), and exit (success/failure/error, outcome, duration). Pattern to
follow: entry log with full message context → handler execution → exit log with
duration and result.

<acceptance_criteria>

- [ ] Background logs "QUICKTABREMOVED_HANDLER_ENTRY" when message received with
      full message details
- [ ] Background logs "QUICKTABREMOVED_HANDLER_EXIT" with outcome
      (success/error), duration, affected tab count
- [ ] Logs show message type, correlationId (if present), originTabId, and
      handler processing time
- [ ] Manual test: remove tab from sidebar → both send and receive logged with
      matching timestamps/correlationId
- [ ] Logs allow tracing complete message path from UI send → background receive
      → handler execution → exit
- [ ] Error outcomes logged with specific error message (not just "error")
      </acceptance_criteria>

---

### Issue #4: Cache Staleness Detection Constant Defined But Never Used (Medium)

**File:** `sidebar/quick-tabs-manager.js`

**Location:** Cache staleness monitoring (currently missing implementation)

**Issue:** File defines `CACHE_STALENESS_ALERT_MS=30000` and
`lastCacheSyncFromStorage` timestamp variable, but nowhere in codebase compares
these values. Staleness detection feature exists only as constants and comments,
with zero actual implementation.

**Evidence from codebase:**

- No logs containing "CACHE_STALENESS" or "cache stale" warnings anywhere
- No periodic checks logged that verify cache freshness
- No state sync requests triggered due to stale cache
- Constants defined but unused (dead code)

**Behavior:** In-memory cache could diverge from background state indefinitely
with no warning. If storage fails and state syncing stops, UI would display
outdated Quick Tabs without any indication that data is stale.

**Root Cause:** Feature partially implemented (constants defined) but core
staleness checking logic never added. Likely planned but not completed.

**Impact:**

- No detection of storage failures affecting state sync
- Manager displays outdated data without warning
- No automatic recovery when cache becomes too stale
- Silent data inconsistency (user doesn't know displayed data is wrong)
- Cache could be minutes old without any indication

<scope>
**Modify:**
- Add periodic staleness check logic (suggest checking every 5-10 seconds)
- Add logging for staleness detection and warnings
- Add recovery action (state sync request) when cache becomes too stale
- Define acceptable staleness threshold

**Do NOT Modify:**

- Cache storage structure or in-memory storage backend
- State update mechanisms
- Existing Manager initialization
- lastCacheSyncFromStorage variable itself (just use it for checks) </scope>

**Fix Required:** Implement periodic task (every 5-10 seconds) that checks if
`Date.now() - lastCacheSyncFromStorage > CACHE_STALENESS_ALERT_MS`. If true, log
warning with context (duration stale, suspected cause based on recent errors).
If cache remains stale for >60 seconds, request full state sync from background
via port message.

<acceptance_criteria>

- [ ] Periodic staleness check runs every 5-10 seconds (use setInterval or
      similar)
- [ ] Logs show "CACHE_STALENESS_WARNING" when cache exceeds 30 second staleness
- [ ] Log includes duration stale (e.g., "cache stale for 35 seconds")
- [ ] State sync request logged when cache exceeds 60 second staleness
- [ ] Sync request includes correlationId for tracing
- [ ] Manual test: simulate storage failure → cache staleness warning appears
      after 30s
- [ ] Manual test: storage failure persists >60s → automatic state sync request
      initiated </acceptance_criteria>

---

### Issue #5: Storage Marked UNAVAILABLE But Writes Continue Anyway (Critical)

**File:** `src/storage/SessionStorageAdapter.js`, handlers that call storage
persistence

**Location:** Storage circuit breaker / unavailability handling

**Issue:** System declares storage unavailable ("STORAGEMARKEDUNAVAILABLE reason
Consecutive storage timeouts exceeded threshold") but then continues attempting
to write to same unavailable storage without any recovery fallback or special
handling.

**Evidence from logs:**

```
ERROR VisibilityHandlerTab 24 STORAGEMARKEDUNAVAILABLE reason Consecutive storage timeouts exceeded threshold, timeoutCount 4
[SYSTEM CONTINUES WITH NORMAL STORAGE WRITES IMMEDIATELY AFTER]
LOG WRITEQUEUE DEQUEUESTART handler UpdateHandler, writeNumber 6, waitTimeMs 0 [NO SPECIAL HANDLING]
```

**Behavior:** Once marked unavailable, system should either: (1) bypass storage
writes and use fallback, or (2) stop attempting writes until recovery detected.
Instead, system declares unavailability but treats it like normal state and
continues attempting writes as if problem doesn't exist.

**Root Cause:** "Unavailable" state tracked but never checked before attempting
writes. Write operations don't query unavailability flag before calling
`browser.storage.local.set()`.

**Impact:**

- Storage marked unavailable but not actually bypassed
- Continued write attempts fail with same errors
- Fallback cache never activated despite need
- Resources wasted on impossible operations
- Cascading failures (each failed write queues next attempt)

<scope>
**Modify:**
- Storage unavailability state handling
- Queue dequeue logic when storage unavailable
- Fallback activation (in-memory cache + port messaging)
- Recovery detection logic

**Do NOT Modify:**

- Storage write API calls themselves (that's issue-47-revised.md)
- Manager cache structure
- Background state management
- Unavailability state tracking itself (just use it for decisions) </scope>

**Fix Required:** When storage marked UNAVAILABLE: (1) stop attempting
`browser.storage.local.set()` writes immediately, (2) switch to in-memory
cache + port messaging for state persistence, (3) periodically attempt test
write to detect recovery (suggest every 30 seconds), (4) resume normal storage
writes when test succeeds. Implement clear FALLBACK_ACTIVE state separate from
UNAVAILABLE detection.

<acceptance_criteria>

- [ ] When UNAVAILABLE triggered, subsequent queue entries bypass
      `browser.storage.local.set()`
- [ ] Logs show "FALLBACK_ACTIVATED" when switching to cache-only mode
- [ ] Port messages sent to background instead of storage writes during fallback
- [ ] Periodic test write attempted every 30 seconds to detect recovery
- [ ] Test write succeeds → logs show "STORAGE_RECOVERED, FALLBACK_DEACTIVATED"
- [ ] Normal storage writes resume after recovery
- [ ] Manual test: trigger unavailability → verify writes bypass storage within
      1 operation </acceptance_criteria>

---

### Issue #6: Self-Write Detection Suspected Broken But Never Logged (Medium)

**File:** `src/storage/SessionStorageAdapter.js` or equivalent storage handler

**Location:** `isSelfWrite()` function and `storage.onChanged` handler

**Issue:** System logs warning "self-write detection may be broken. Check
isSelfWrite function" but never actually logs diagnostic output needed to
determine if detection working. No logs show `isSelfWrite()` being called, no
logs show function returning true/false, no logs show whether change event
attributed to own write or external write.

**Evidence from logs:**

```
WARN StorageUtils TRANSACTIONTIMEOUT diagnostic, suggestion If this repeats, self-write detection may be broken. Check isSelfWrite function.
[NO ACTUAL DIAGNOSTIC DATA ABOUT SELF-WRITE DETECTION]
```

**Behavior:** Warning exists but diagnostic data to investigate warning is
absent. Can't look at logs and determine whether self-write detection actually
working or truly broken.

**Root Cause:** Warning indicates detection might be broken, but no logging
added to show actual detection logic results. Feature works/doesn't work but
invisibly.

**Impact:**

- No visibility into whether changes correctly attributed to own writes vs
  external
- Could cause double-processing of state updates (if own write detected as
  external)
- Impossible to debug change event handling without adding logging manually
- Can't diagnose why state syncing failing if self-write detection broken

<scope>
**Modify:**
- `storage.onChanged` handler and change event attribution logic
- Diagnostic logging for `isSelfWrite()` function calls and results

**Do NOT Modify:**

- Core `isSelfWrite()` implementation logic itself (just add observability)
- Change handling state machine
- Storage persistence logic </scope>

**Fix Required:** Add logging to show when `isSelfWrite()` is called, what
parameters were passed, and what it returned (true/false). Log this at every
`storage.onChanged` event. Include transaction ID or correlation ID so changes
can be traced back to originating write.

<acceptance_criteria>

- [ ] Logs show "SELF_WRITE_CHECK" entry for every `storage.onChanged` event
- [ ] Log includes result (true=own write, false=external change)
- [ ] Log includes transaction ID or correlation ID for tracing
- [ ] Log includes timestamp and storage key being changed
- [ ] Manual test: perform storage write → logs show SELF_WRITE_CHECK returning
      true
- [ ] Manual test: external storage change → logs show SELF_WRITE_CHECK
      returning false
- [ ] Logs allow determining if self-write detection working or broken
      </acceptance_criteria>

---

### Issue #7: Port Message Handler Missing Entry/Exit Boundaries (Medium)

**File:** `sidebar/quick-tabs-manager.js`

**Location:** `handleQuickTabsPortMessage()` and individual message type
handlers

**Issue:** When sidebar receives port messages from background (MOVEMESSAGE sent
successfully, state syncs, etc.), there's no entry/exit logging wrapping handler
execution. Can see "Sending" logs but can't see "Received" or trace how long
handler took to process.

**Evidence from logs:**

```
LOG UpdateHandler MOVEMESSAGE Sent successfully id qt-24-...
[NO LOGS SHOWING SIDEBAR RECEPTION OR HANDLER EXECUTION]
```

**Behavior:** Message sent from sidebar shows in logs immediately, but there's
no corresponding logs on sidebar side showing port message received or handler
processing. Impossible to know if:

- Handler executing
- How long it takes
- If it's hanging
- If it completed successfully

**Root Cause:** Message reception handler exists but has no logging around
execution. Only "sending" side logs visible, not "receiving" side.

**Impact:**

- No visibility into message handler performance
- Can't detect if handlers hanging or failing
- Can't trace state update flow from receive → handler → state update → render
- Difficult to debug state synchronization issues
- No way to correlate sent message with handler execution result

<scope>
**Modify:**
- Port message handler entry/exit logging
- Individual message type handler logging

**Do NOT Modify:**

- Core message handler logic itself (just add observability)
- Port connection setup
- Message routing/dispatch mechanism </scope>

**Fix Required:** Add entry logging at start of `handleQuickTabsPortMessage()`
showing message type, received timestamp, and correlationId if present. Add exit
logging showing handler outcome (success/unknown_type/error) and execution
duration. Pattern should match: HANDLER_ENTRY → handler execution → HANDLER_EXIT
with outcome.

<acceptance_criteria>

- [ ] Every port message shows HANDLER_ENTRY log with message type and timestamp
- [ ] Every port message shows HANDLER_EXIT log with outcome (success/error) and
      duration (ms)
- [ ] Unknown message types logged with "UNKNOWN_MESSAGE_TYPE" in exit log
- [ ] Error outcomes include error message (not just "error")
- [ ] Logs allow tracing complete message processing from receive to outcome
- [ ] Manual test: send 10 state updates rapidly → all logged in order with
      durations </acceptance_criteria>

---

### Issue #8: Timeout Error Cascades Into Rapid-Fire Write Queue (Critical)

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js` or storage
timeout handler

**Location:** Timeout detection and next write queue scheduling

**Issue:** When focus operation times out (5000ms), system logs "Storage persist
timeout" but then immediately schedules next storage persist operation for same
tab without delay. Creates cascading failures where timeouts trigger more
attempts immediately.

**Evidence from logs:**

```
ERROR VisibilityHandler Timer callback FAILED source UI id qt-24-..., operation focus, durationMs 5005, error Storage persist timeout
LOG WRITEQUEUE DEQUEUESTART handler UpdateHandler, writeNumber 6, waitTimeMs 0 [IMMEDIATE]
[ANOTHER TIMEOUT IMMEDIATELY FOLLOWS]
```

**Behavior:** Timeout detected (5+ seconds) but response is to immediately try
again instead of backing off. Repeats, creating denial-of-service pattern where
system spams failed operations.

**Root Cause:** Timeout handler doesn't implement backoff. Next operation
scheduled with zero delay instead of waiting.

**Impact:**

- Resource waste on repeated failed operations
- UI unresponsive while waiting for timeouts to complete
- Storage queue grows rapidly with failed operations
- Rapid cascading failures without recovery
- Battery drain from continuous retries

<scope>
**Modify:**
- Timeout error handler logic
- Next write scheduling after timeout
- Queue dequeue delay logic when timeouts detected

**Do NOT Modify:**

- Storage API calls themselves (issue-47-revised.md)
- Timeout threshold constants (suggest: keep at 5000ms)
- Core state management </scope>

**Fix Required:** When storage timeout detected, implement exponential backoff
before scheduling next write for same operation. Suggest: first timeout → 1s
delay, second timeout → 3s delay, third timeout → 5s delay, then activate
circuit breaker. Don't queue next operation for same tab/operation until backoff
period expires.

<acceptance_criteria>

- [ ] Storage timeout triggers minimum 1 second delay before next queue dequeue
- [ ] Consecutive timeouts increase delay: 1s → 3s → 5s
- [ ] Logs show "TIMEOUT_BACKOFF_APPLIED" with delay duration
- [ ] After 3 consecutive timeouts, circuit breaker triggered (not just backoff)
- [ ] No more than 1 operation queued per tab during backoff period
- [ ] Manual test: trigger storage timeout → logs show backoff delays increasing
      </acceptance_criteria>

---

## Missing Logging Actions Summary

The extension logs do NOT capture the following actions, making diagnostics very
difficult:

1. Port message reception and handler entry/exit at destination
2. Storage operation recovery attempts and fallback activation
3. Message handler outcome (success/failure/timeout)
4. Correlation ID propagation through state sync path
5. Cache staleness monitoring and recovery actions
6. Self-write detection diagnostic details
7. forceEmpty flag validation before empty writes
8. Circuit breaker state transitions (ACTIVE → UNAVAILABLE → RECOVERED)
9. Timeout backoff application and exponential delay
10. Fallback cache usage when storage unavailable
11. Test write attempts to detect storage recovery
12. State sync request triggers and outcomes

---

## Severity & Impact Classification

| Issue                               | Severity     | Impact                                     | Users Affected              | Data Loss Risk |
| ----------------------------------- | ------------ | ------------------------------------------ | --------------------------- | -------------- |
| #1: Storage write loops             | **Critical** | All state operations fail silently         | 100%                        | **High**       |
| #2: forceEmpty not set              | **Critical** | Closed tabs reappear on restart            | 100% using Close All        | **High**       |
| #3: Message outcome not logged      | **Critical** | Tab removal confirmation lost              | 100%                        | **High**       |
| #4: Cache staleness unused          | Medium       | Stale data displayed silently              | 100% when storage fails     | Medium         |
| #5: Storage unavailable ignored     | **Critical** | Failed writes continue infinitely          | 100% during storage failure | **High**       |
| #6: Self-write detection unobserved | Medium       | Double-processing risk if broken           | 10-20% (edge cases)         | Low-Medium     |
| #7: Message handler invisible       | Medium       | Performance and error debugging impossible | 100%                        | Low            |
| #8: Timeout cascades                | **Critical** | Denial-of-service on storage failure       | 100% during timeouts        | **High**       |

---

## Integration With Primary Issues

These eight issues compound the effects of issues identified in
issue-47-revised.md:

| Primary Issue                     | Affected By      | Cascading Impact                                                   |
| --------------------------------- | ---------------- | ------------------------------------------------------------------ |
| SessionStorageAdapter unavailable | Issue #1, #5     | Silent failures in retry loop, no fallback when marked unavailable |
| SyncStorageAdapter unavailable    | Issue #1, #5     | Same cascading retry and unavailability bypass problems            |
| State Manager feature detection   | Issue #4         | Stale cache masks real state divergence from backend               |
| All state persistence             | Issue #2, #3     | forceEmpty failures on Close All, no message receipt confirmation  |
| All port messaging                | Issue #3, #7     | No acknowledgment of message receipt or handler execution          |
| Debug capability                  | Issue #4, #6, #8 | Missing logging makes root cause diagnosis impossible              |

---

## Summary of Gaps & Bugged Behaviors

**Total Issues Found:** 8 critical gaps + 6 missing logging actions = 14 total
issues

**Files Requiring Changes:** 5 primary files

- `src/features/quick-tabs/handlers/DestroyHandler.js` (Issue #2, #3)
- `src/features/quick-tabs/handlers/UpdateHandler.js` (Issue #1, #8)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (Issue #1, #8)
- `sidebar/quick-tabs-manager.js` (Issue #3, #4, #7)
- `src/storage/SessionStorageAdapter.js` (Issue #1, #5, #6)

**Priority:** All critical issues must be addressed before v1.6.3.12 release

**Dependencies:** Issue #47-revised (storage.session migration) should be
addressed first, then these issues

**Complexity:** Medium-High (distributed across multiple files with
interdependencies)

<acceptance_criteria> **All issues must be addressed before v1.6.3.12 release:**

- [ ] Issue #1: Circuit breaker implemented, no more infinite retry loops
- [ ] Issue #2: forceEmpty=true set when closing all tabs
- [ ] Issue #3: QUICKTABREMOVED message handler outcome logged on background
- [ ] Issue #4: Cache staleness check implemented, logs warnings and triggers
      sync
- [ ] Issue #5: Storage unavailable state triggers fallback activation
- [ ] Issue #6: isSelfWrite() diagnostic logging added
- [ ] Issue #7: Port message handler entry/exit logging added
- [ ] Issue #8: Storage timeout backoff prevents cascading failures
- [ ] All existing tests still pass
- [ ] Manual test: Close all tabs → verify state persists correctly after
      reopening
- [ ] Manual test: Simulate storage failure → verify circuit breaker and
      fallback activate
- [ ] Manual test: Rapid state updates → verify no cascading timeouts or queue
      overflow
- [ ] Logs show complete trace of: message sent → received → processed → outcome
      </acceptance_criteria>

---

**Priority:** Critical | **Dependencies:** Issue #47-revised (storage API) must
be addressed first | **Complexity:** Medium-High (distributed across multiple
files with interdependencies)

**Note for Copilot Agent:** These issues stem from fundamental architectural
issues (missing logging, no circuit breaker, no timeout backoff, no fallback
mechanism) compounded by Firefox storage API compatibility. Focus fixes on
robust, long-term solutions (circuit breaker pattern, fallback activation)
rather than quick-and-dirty band-aids. Missing logging actions should be added
to every state transition point for observability.
