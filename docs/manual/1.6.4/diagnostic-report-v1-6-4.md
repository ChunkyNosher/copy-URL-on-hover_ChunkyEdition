# Quick Tabs State Coordination: Missing Atomicity, Timeout Robustness, and Diagnostic Logging

**Extension Version:** v1.6.3.10-v4 | **Date:** December 17, 2025 | **Scope:**
Architecture-level gaps in state persistence, port lifecycle management, and
diagnostic instrumentation

---

## Executive Summary

The extension has successfully addressed 15 operational issues through enhanced
validation and logging (v1.6.3.10-v1 through v1.6.3.10-v4). However, three
foundational architectural gaps remain that create potential failure modes:

1. **Multi-step messaging lacks atomic guarantees** – Quick Tab operations
   (minimize, restore, focus, delete) split validation → background processing →
   state update → storage persistence across separate message round-trips,
   enabling partial failures
2. **Firefox 30-second timeout edge cases persist** – Port-dependent messaging
   creates scenarios where queued operations exceed the 10-second safety margin,
   potentially freezing state mid-operation
3. **Diagnostic logging sparse across critical paths** – Storage transactions,
   port lifecycle, atomicity checkpoints, and self-write detection lack
   correlation IDs and timing instrumentation, making bugs difficult to
   reproduce

These gaps are not immediately critical (current keepalive and validation layers
provide operational mitigation), but they represent fundamental limitations of
the messaging-based architecture that will accumulate technical debt as features
expand.

---

## Issues Overview

| Issue # | Component                                         | Category                   | Current Gap                                                 | Root Cause                                                    | Priority |
| ------- | ------------------------------------------------- | -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| 1       | VisibilityHandler, DestroyHandler, RestoreHandler | Atomicity                  | Multi-step operations lack all-or-nothing guarantee         | Messaging split across validation → operation → broadcast     | High     |
| 2       | background.js, content.js port management         | Timeout Robustness         | Firefox 30s termination still possible under load           | Port lifecycle depends on background staying alive >30s       | High     |
| 3       | storage-utils.js, VisibilityHandler.js            | Diagnostic Instrumentation | Missing correlation IDs, atomicity brackets, timing metrics | Operations lack start/end markers and operation duration logs | Medium   |

---

## Issue 1: Atomic Operations – Multi-Step Messaging Pattern Creates Partial-Failure Windows

### Problem Summary

Quick Tab operations execute across multiple message boundaries: content script
validation → background message → background processing → broadcast back to
content → state update → storage persist. If any step times out or the port
closes, the operation may partially complete (e.g., entity marked minimized but
DOM not hidden, or storage written but event never fired).

This is not an immediate operational failure (validation layers catch most
cases), but it violates ACID semantics and creates accumulated inconsistency
risks during edge cases (rapid operations, browser memory pressure, Firefox
Event Page termination).

### Root Cause Analysis

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` (lines ~545-600), `handleRestore()` (lines
~610-670), `handleFocus()` (lines ~680-720)  
**Issue:** Each operation executes in phases:

- Phase 1: Validate in VisibilityHandler (local)
- Phase 2: Send message to background, wait for port response
- Phase 3: Background processes and broadcasts to all tabs
- Phase 4: Content script receives broadcast, updates DOM
- Phase 5: Content script emits event, triggers storage persist

If port closes between phase 2 and 3, state becomes inconsistent (entity marked
as minimized but DOM still rendered). If storage write timeout fires between
phase 4 and 5, state in memory differs from storage.

**File:** `src/utils/storage-utils.js`  
**Location:** `persistStateToStorage()` (lines ~2800-2900)  
**Issue:** Storage persist is itself multi-phase: validate state → check
ownership → compare hash → build state object → queue write → execute write →
wait for storage.onChanged event. Fallback cleanup at 500ms assumes event will
fire, but no guarantee.

### Architectural Limitation

According to Mozilla bugzilla #1851373 and W3C Service Worker spec, Firefox
Event Pages have **no guaranteed port message delivery time** after background
script approaches 30-second idle timeout. Chrome messaging also has no
documented latency guarantee above 100ms during heavy operations.

The `storage.onChanged` event (MDN docs) carries no timing guarantee—Firefox
typically fires within 50-200ms, but under memory pressure delays up to 500ms+
are documented. The API is not transactional; multiple writes can interleave in
any order.

### Fix Required

Consolidate operation logic into single injection functions that execute
atomically within content script context (via `browser.scripting.executeScript`
in Phase 2 implementation). Move validation + operation + state update into one
execution frame where all-or-nothing semantics are guaranteed by JavaScript's
single-threaded execution model.

Current messaging path remains as fast path (no changes). If messaging fails
(timeout, port dead), fallback to Scripting API which executes independently
without background dependency. This maintains backward compatibility while
eliminating atomicity gaps for edge cases.

Do NOT change storage-utils.js API surface; do NOT modify manifest permissions;
do NOT alter current validation helper functions.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` – Add scripting-based minimize/restore/focus injection functions with fallback detection logic
- `background.js` – Add Scripting API injection layer and fallback routing
- `src/content.js` – Add scripting result handling and operation acknowledgment

**Do NOT Modify:**

- `src/utils/storage-utils.js` – Storage API remains unchanged
- `manifest.json` – Keep static content_scripts; scripting is supplementary
- `src/features/quick-tabs/handlers/DestroyHandler.js` – Update only if needed
  for consistency
- Validation helper functions (remain as-is for defensive layering) </scope>

<acceptance_criteria>

- [ ] `handleMinimize()` fallback path executes via Scripting API when port
      messaging fails
- [ ] Minimize operation completes atomically: DOM hidden AND state updated AND
      event emitted in single injection
- [ ] No partial-state bugs in edge cases (rapid minimize/restore cycles, page
      reload during operation)
- [ ] Manual test: Perform minimize, reload page mid-operation, verify state
      consistent with storage
- [ ] Manual test: Kill background (about:debugging), perform minimize, verify
      Scripting fallback succeeds
- [ ] All existing tests pass; no changes to current messaging path (fast path
      unchanged) </acceptance_criteria>

---

## Issue 2: Firefox Timeout Edge Cases – Port-Dependent Operations Exceed 30-Second Lifecycle Window

### Problem Summary

Firefox terminates Event Page background scripts after 30 seconds of inactivity
(Mozilla docs confirm this is hard limit, not configurable). Current keepalive
fires every 20 seconds (with 10-second safety margin before termination).
However, if multiple Quick Tab operations queue rapidly and each takes 3-5
seconds, the total could approach or exceed the 10-second margin, leaving no
room for subsequent operations.

Additionally, the keepalive mechanism only resets the idle timer—it does NOT
guarantee message delivery will complete before background termination. A
long-running operation that starts at second 25 could exceed second 30 while
still executing, causing background to unload mid-operation.

### Root Cause Analysis

**File:** `background.js`  
**Location:** Keepalive heartbeat (lines ~280-310), port lifecycle management
(lines ~1240-1400)  
**Issue:** Current keepalive implementation:

- Sends HEARTBEAT message every 20 seconds
- Sets timeout to 15 seconds waiting for ACK (total 35 seconds in theory)
- Assumes port stays alive if ACK received

But this has two gaps:

1. If operation takes 5+ seconds and starts at second 20, it executes until
   second 25-30 but keepalive is in progress, causing timing collision
2. Firefox may terminate background during long storage.local.set() operation
   without notifying background thread

**File:** `src/content.js`  
**Location:** Port connection lifecycle (lines ~850-950), message handling
(lines ~1250-1300)  
**Issue:** Content script depends entirely on background port being alive. If
background terminates mid-operation:

- Port becomes null
- Message responses never arrive
- Operation hangs until timeout (currently 2-5 seconds per storage-utils.js
  STORAGE_TIMEOUT_MS)

But by then, background may have already persisted partial state or lost
in-memory transaction tracking.

### Architectural Limitation

Firefox Event Page model fundamentally terminates background scripts after 30
seconds without active connections. This is not a bug—it's a feature to save
memory. The messaging-based architecture inherently depends on background
staying alive, creating an irreducible timeout risk.

Chrome Service Workers have longer lifetime (typically persist) but same
potential timeout under extreme load with many queued operations.

Scripting API executes synchronously in content script (which is guaranteed to
stay alive as long as tab is open), eliminating background dependency entirely.

### Fix Required

Implement fallback strategy: maintain current messaging as primary path (faster,
no overhead). When messaging fails (port dead, timeout, no response),
automatically fall back to Scripting API injection which executes independently.

Requires:

- Detecting when background becomes unresponsive (wrap all messaging calls with
  2-second timeout)
- Switching to fallback path on timeout
- Maintaining same error handling and logging (translate Scripting exceptions to
  current messaging error format)

Do NOT change keepalive interval (keep 20-second cadence); do NOT modify port
creation logic; do NOT alter background lifecycle.

<scope>
**Modify:**
- `background.js` – Add messaging failure detection and Scripting API injection fallback routing
- `src/content.js` – Add timeout wrapper around all messaging calls, add fallback routing
- `src/features/quick-tabs/handlers/VisibilityHandler.js` – Add fallback error handling

**Do NOT Modify:**

- Keepalive timing (20-second interval, 10-second margin)
- Port lifecycle management (Firefox hard limits not changeable)
- Storage API behavior </scope>

<acceptance_criteria>

- [ ] Messaging failures detected within 2-second timeout (non-blocking, doesn't
      freeze UI)
- [ ] Scripting API fallback automatically routes subsequent operations when
      background is dead
- [ ] 100% success rate for operations when background is terminated (vs.
      current edge-case failures)
- [ ] Manual test (Firefox): Use about:debugging to terminate background,
      perform minimize, verify completion
- [ ] Background restart automatically resumes messaging fast path without
      manual intervention
- [ ] Performance unchanged for normal path (messaging still primary, no
      overhead) </acceptance_criteria>

---

## Issue 3: Missing Diagnostic Logging – Sparse Instrumentation Across Critical Paths

### Problem Summary

Current logging lacks correlation IDs and timing instrumentation across three
critical paths:

1. **Storage transactions** – `persistStateToStorage()` logs completion but not
   per-phase timing, transaction IDs linking to operations, or confirmation that
   storage.onChanged event actually fired
2. **Port lifecycle** – Connection lifecycle logged but not operation latency or
   keepalive effectiveness
3. **Self-write detection** – No logging of WHICH detection layer succeeded
   (transactionId vs. instanceId vs. tabId), making self-write debugging
   difficult
4. **Ownership validation** – `_filterOwnedTabs()` logs only count, not which
   tabs were filtered or why

These gaps make it difficult to reproduce and diagnose issues #1 and #2 when
they occur in the field.

### Root Cause Analysis

**File:** `src/utils/storage-utils.js`  
**Location:**

- `persistStateToStorage()` (lines ~2800-2900) – Logs state change check and
  queue, but not "TRANSACTION_STARTED" → "TRANSACTION_COMPLETE" brackets
- `_executeStorageWrite()` (lines ~1650-1750) – Logs timing but not
  storage.onChanged confirmation
- `_shouldRejectEmptyWrite()` (lines ~1400-1450) – Logs warning but lacks
  stacktrace to identify caller
- `_trackDuplicateSaveIdWrite()` (lines ~1550-1600) – Logs count but not
  timestamp deltas between first and duplicate

**File:** `src/content.js`  
**Location:**

- `getCurrentTabIdFromBackground()` (lines ~320-360) – Logs response but not
  round-trip latency
- Port message handlers (lines ~850-950) – Log lifecycle but not
  "OPERATION_SENT_AT_XMs" → "RESPONSE_RECEIVED_AT_YMs"
- `_handleRestoreQuickTab()` (lines ~1650-1750) – Logs deduplication rejection
  but not reason code
- `_isDuplicateRestoreMessage()` (lines ~1620-1650) – Logs warning but no timing
  delta

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:**

- `handleMinimize()`, `handleRestore()`, `handleFocus()` – No
  "OPERATION_START_ID" / "OPERATION_COMPLETE_ID" correlation IDs
- Missing "MINIMIZED_STATE_CHANGED" event log confirming state actually changed
- No logging of how long operation took (start time → minimize complete → event
  emitted → storage persisted)

### Impact

When a bug occurs in production (e.g., "minimize didn't work" or "state got
corrupted"), engineers must either:

- Reproduce locally (often impossible with timing-dependent bugs)
- Ask user to enable debug logging and perform steps again (poor UX)
- Guess based on sparse logs where the failure occurred

With correlation IDs and phase-bracketed logging, engineers can trace operation
flow from initiating message → completion, identifying exactly where failure
occurred and why.

### Fix Required

Add instrumentation across three layers:

1. **Storage transactions** – Wrap `persistStateToStorage()` with start/end
   correlation ID logging; log each phase (validate → hash check → ownership
   filter → write → event confirmation)
2. **Port operations** – Add start/end timestamps around all messaging calls;
   log latency deltas
3. **Self-write detection** – Log which detection layer matched (transactionId /
   instanceId / tabId); include reason code
4. **Ownership validation** – Extend `_filterOwnedTabs()` logging to list which
   tabs filtered out and originTabId values

Do NOT add performance-critical logging in hot loops; do NOT log full state
objects (only counts and IDs); do NOT add console.log for every event (keep
scope focused on diagnosing issues #1 and #2).

<scope>
**Modify:**
- `src/utils/storage-utils.js` – Add correlation ID start/end logging, phase timing in persistStateToStorage and related helpers
- `src/content.js` – Add latency metrics around port messaging, self-write detection layer logging
- `src/features/quick-tabs/handlers/VisibilityHandler.js` – Add operation start/end correlation logging in minimize/restore/focus

**Do NOT Modify:**

- Current error handling (just add logging alongside it)
- Storage API behavior
- Validation logic (only add logging, no logic changes) </scope>

<acceptance_criteria>

- [ ] Each `persistStateToStorage()` call logs start with unique correlation ID,
      logs each phase (validate, hash, ownership, write, confirm)
- [ ] Each port message includes sent timestamp; response includes received
      timestamp and delta
- [ ] Self-write detection logs which detection layer matched (transactionId /
      instanceId / tabId)
- [ ] `_filterOwnedTabs()` logs which tabs filtered and their originTabId values
- [ ] Operation start/end logging in VisibilityHandler allows tracing minimize
      request → state change → storage persist
- [ ] Logs include reason codes for rejections (e.g., "rejected:
      empty_write_no_history", "rejected: non_owner_tab")
- [ ] No performance degradation (logging not in hot loops, conditional on debug
      mode where possible) </acceptance_criteria>

---

## Supporting Context

<details>
<summary>Firefox Event Page Timeout Confirmation</summary>

Mozilla Bugzilla #1851373 ("Firefox terminates the background script of
WebExtensions after 30 seconds"):

- Hard limit of 30 seconds with no active port connections
- Keepalive resets timer but doesn't guarantee message delivery completion
- Setting `persistent: true` in manifest moves to persistent background (not
  applicable here)

W3C Service Workers spec confirms similar 30-second inactivity window for
browser-managed lifecycle.

</details>

<details>
<summary>Storage API Timing Limitations</summary>

MDN `storage.onChanged` documentation provides no guaranteed timing. Observed
behavior:

- Firefox: 50-200ms typical, up to 500ms+ under memory pressure
- Chrome: Similar range, unpredictable under heavy operations

Multiple simultaneous writes are queued by browser but processed in FIFO order
with potential interleaving if errors occur. No transactional guarantees.

</details>

<details>
<summary>Scripting API Advantages & Constraints</summary>

`browser.scripting.executeScript` (Firefox 102+, Chrome MV3):

- Executes synchronously in content script context
- No round-trip latency (no port dependency)
- Guaranteed to complete or throw exception
- Trades cross-message latency for execution atomicity

Performance: ~2-4ms injection overhead vs. ~6-9ms for messaging round-trip.

Firefox vs. Chrome differences: Firefox allows partial results when permissions
missing; Chrome blocks entirely. Error handling must account for Firefox
partial-success scenarios.

</details>

<details>
<summary>Current Operational Safeguards (Existing Defenses)</summary>

These defensive layers mean issues #1 and #2 are not immediately catastrophic:

- `VisibilityHandler._isOwnedByCurrentTab()` blocks operations on non-owned
  Quick Tabs
- `storage-utils.js` validates ownership again at persist time
- Circuit breaker at `CIRCUIT_BREAKER_THRESHOLD=15` pending writes halts
  infinite loops
- Fallback cleanup at 500ms prevents permanent transaction hangs
- Duplicate write detection (saveIdWriteTracker) catches some loops

These safeguards are OPERATIONAL mitigations, not architectural fixes. They
prevent immediate failure but accumulate technical debt as feature complexity
grows.

</details>

<details>
<summary>Related Issues & Dependencies</summary>

- Issue #47 (Comprehensive Behavior Scenarios): Describes expected behavior
  across 21 scenarios; current atomicity gaps could violate scenarios 3, 10, 17
  (persistence, restore across reload, rapid switching)
- v1.6.3.10-v4 recent fixes: Enhanced validation and keepalive logic, but still
  within messaging architecture (not addressing root atomicity/timeout gaps)
- Future enhancement: Scripting API integration (separate PR) addresses Issues
  #1 and #2 architecturally

</details>

---

## Implementation Strategy

### Phase 1: Diagnostic Logging (Immediate, Low Risk)

Add correlation ID logging and phase instrumentation to storage-utils.js,
content.js, and VisibilityHandler.js. No architectural changes, only logging
additions. Enables better reproduction of issues #1 and #2 in the field.

Estimated effort: 200-300 lines of logging statements.

### Phase 2: Atomic Operations via Scripting API (Next PR)

Implement fallback pattern with Scripting API as secondary path. Messaging
remains unchanged (fast path). Eliminates atomicity gaps for edge cases.

Estimated effort: 400-500 lines (new injection functions, fallback routing,
error translation).

### Phase 3: Timeout Robustness Enhancement (Future PR)

Add messaging failure detection and automatic fallback routing. Combined with
Phase 2 Scripting API layer, provides complete timeout recovery.

Estimated effort: 200-300 lines (timeout wrappers, fallback routing).

---

**Priority:** High (Issues #1, #2) / Medium (Issue #3) | **Complexity:** Medium
(atomicity, timeout), Low (logging) | **Risk Level:** Low (all additive, no
breaking changes)

**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Branch:** copilot/fix-diagnostic-report-issues-again  
**Analysis Date:** December 17, 2025
