---
TITLE:
  Additional Critical Issues and Missing Instrumentation in
  copy-URL-on-hoverChunkyEdition v1.6.3+
Core Problem:
  Hidden Initialization Race Conditions, Tab ID Adoption Failures, and
  Insufficient Event Sequencing Logging
Extension Version: v1.6.3.10-v10+
Date: 2025-12-24
---

## Executive Summary

Beyond the issues identified in the previous diagnostic report, the extension
contains several **additional critical failures** that are actively occurring in
production but remain undetected due to insufficient logging. The most severe
involve **initialization race conditions where Quick Tabs are created with
`originTabId=null`**, **transaction ID generation failures before tab ID
initialization**, and **missing validation at hydration boundaries**. These
issues directly contradict the expected behavior outlined in
issue-47-revised.md, where all Quick Tabs must be scoped to their origin tab.

The logs reveal a consistent pattern: **operations proceed with incomplete
identity information** (tabId=UNKNOWN, originTabId=null), creating "orphan"
Quick Tabs that violate the foundational architecture of tab-scoping.
Additionally, the codebase has **no holistic event sequencing validation**,
preventing detection of message ordering violations that cause state corruption
during concurrent operations.

---

## Section 1: Additional Critical Issues

### Issue #12: Quick Tab Creation with originTabId=null (Adoption Flow Failure)

**Severity:** CRITICAL  
**Category:** Data integrity failure  
**Affected Components:** StorageUtils.extractOriginTabId(),
QuickTabHandler.handleCreate(), VisibilityHandler

#### Problem Description

Per the logs (copy-url-extension-logs_v1.6.3.11-v7_2025-12-24T16-36-29.txt),
Quick Tabs are being created with `originTabId=null`:

```
WARN StorageUtils ADOPTIONFLOW serializeTabForStorage - originTabId is NULL
quickTabId qt-unknown-1766594146191-1fgkjf14my9md
rawOriginTabId null
rawOriginTabIdType object
```

This directly violates the tab-scoping architecture documented in
issue-47-revised.md (Scenario 11: Hydration on Page Reload originTabId
Filtering). The behavior model explicitly requires that Quick Tabs have valid
`originTabId` matching their origin tab.

**Adoption Flow Consequences:**

When `originTabId=null`, the content script hydration process cannot filter
Quick Tabs correctly:

```javascript
// In hydrate-quick-tabs.js (expected behavior from issue-47)
// Scenario 11 step 4-5: Should filter by originTabId
const filteredQTs = allQTs.filter(qt => qt.originTabId === currentTabId);
// Result with originTabId=null: null === 1 is always false
// The Quick Tab becomes INVISIBLE in all tabs (filtering fails)
// But PERSISTS in storage (never cleaned up)
```

Additionally, when restoring state across browser restart (Scenario 10), the
Quick Tab with `originTabId=null` cannot be restored because the hydration layer
cannot determine which tab to restore it to.

**Root Cause:**

The extraction logic in StorageUtils.extractOriginTabId() rejects null values
but allows the extraction to "succeed" by returning null:

```javascript
// StorageUtils.extractOriginTabId() lines (from logs)
normalizeOriginTabId Rejected context extractOriginTabId
originalValue null
rejectionReason NULLISH
// ... extraction completes with result null (still succeeds!)
```

The calling code (QuickTabHandler.handleCreate or VisibilityHandler) does not
validate that extraction returned a non-null value before serializing to
storage. The `_resolveOriginTabId()` function (Issue #9 from previous report)
allows fallback to null, but this is occurring even when the Quick Tab is
created FROM a valid content script context that has a valid tabId.

**Evidence from Logs:**

Multiple entries show the pattern:

```
extractOriginTabId Extraction started
quickTabId qt-unknown-1766594146191-1fgkjf14my9md
rawOriginTabId null
rawOriginTabIdType object
sourceField none

normalizeOriginTabId Rejected context extractOriginTabId
originalValue null
rejectionReason NULLISH

extractOriginTabId Extraction completed
normalizedOriginTabId null
extractedOriginTabIdType object
action serialize
result null

serializeTabForStorage Serialization completed
originTabIdSource null
originTabIdRaw null
originTabIdRawType object
extractedOriginTabId null
```

This suggests the message arriving at the background script either:

1. Does not include originTabId (rawOriginTabId null, sourceField none), OR
2. Is arriving from a context where the sender's tab ID is not accessible

**Missing Validation:**

After serialization completes with `originTabId=null`, the code should either:

1. Reject creation and return error (not occurring)
2. Log critical warning and continue (warning IS logged, but operation proceeds)
3. Attempt fallback extraction from quickTabId pattern (occurs but pattern may
   be empty: qt-unknown-...)

The "unknown" prefix in the quickTabId (qt-unknown-...) suggests the tabId was
not available even for the ID generation step.

#### Context: Identity Initialization State

The same logs reveal an additional issue at the initialization boundary:

```
v1.6.3.10-v9 generateTransactionId
Identity not initialized
tabId UNKNOWN
identityStateMode INITIALIZING
warning Transaction ID generated before tab ID initialized
```

This indicates that transaction ID generation is occurring **before the identity
system has determined the current tab ID**. The transaction ID becomes
`txn-1766594151093-UNKNOWN-14-...`, making it impossible to correlate the
operation to a specific tab later.

---

### Issue #13: Content Script to Background Message Ordering Violations

**Severity:** CRITICAL  
**Category:** Message sequencing/race condition  
**Affected Components:** Content script message sending, background message
routing, storage write coalescing

#### Problem Description

When multiple content scripts send messages in rapid succession (within
50-200ms), the background script may process them out of order due to:

1. **Message handler race conditions** - Multiple content scripts send
   CREATE_QUICK_TAB messages while background is processing previous messages
2. **Rate limiting coalescing** - Messages that arrive while previous write is
   in progress get coalesced, but the coalescing decision doesn't account for
   message order
3. **Async storage.local.get() delays** - The background script reads current
   storage state, but by the time the read completes, another message has
   arrived and modified the in-memory state

**Evidence from Logs:**

```
LOG VisibilityHandler v1.6.3.10-v10 WRITECOALESCED
txn-1766594151093-UNKNOWN-14-f1b137c1
reason ratelimit
timeSinceLastWriteMs 57
minIntervalMs 100
coalescedCount 1

LOG StorageWrite LIFECYCLECOALESCED
phase RATELIMIT
reason ratelimit
```

The log shows a write was coalesced due to rate limiting (only 57ms since last
write, minimum interval is 100ms). However, the log does NOT show:

- How many messages arrived during the coalescing window
- Whether messages were processed in order or batched
- What the state was BEFORE the coalesce vs AFTER the coalesce
- Whether any message's operations were lost or merged incorrectly

#### Message Ordering Problem

Consider this scenario:

```
T=0ms    Content Script 1 sends CREATE_QUICK_TAB (QT-A)
T=50ms   Content Script 2 sends CREATE_QUICK_TAB (QT-B)
T=100ms  Background processes message 1, writes state (QT-A)
T=105ms  Background's storage write completes, fires storage.onChanged
T=110ms  Content Script 3 sends CREATE_QUICK_TAB (QT-C)
T=115ms  Background receives message 2, tries to write
T=120ms  Background checks rate limit: 115-100=15ms (< 100ms min interval)
T=120ms  Background coalesces message 2 with message 3 (which hasn't arrived yet!)
T=125ms  Content Script 3's message arrives, but background is already committed to coalescing decision
T=130ms  Background finally writes, merging state, but order is unclear
```

The result: **QT-C might be written before QT-B**, or **QT-B might be lost if
the merge wasn't bidirectional**.

#### Missing Logging

The code logs that coalescing occurred, but does NOT log:

- The message queue state (how many messages waiting)
- The merge strategy (how were queued operations combined)
- The resulting state after merge (what ended up in storage)
- Whether any operations were dropped or re-ordered

---

### Issue #14: Hydration Failure Detection Lacks Boundary Markers

**Severity:** HIGH  
**Category:** Initialization/observability  
**Affected Components:** hydrate-quick-tabs.js, content script initialization,
GET_QUICK_TABS_STATE handler

#### Problem Description

When a content script calls GET_QUICK_TABS_STATE during the hydration phase, if
the background is still initializing, the response may be incomplete or
incorrect. However, there is **no clear boundary marker** distinguishing:

1. "Background is initializing, retry" (temporary failure, retryable)
2. "Background loaded but state is empty" (permanent, no state to restore)
3. "Background loaded but originTabId doesn't match current tab" (filter logic
   failed)
4. "Background loaded but security check failed" (container mismatch)

**Current Response Envelope** (from background message handlers):

```javascript
// Success case - unclear if full
{ success: true, tabs: [...], timestamp: ... }

// Failure case - unclear if retryable
{ success: false, error: "...", code: "..." }
```

The content script has no way to distinguish between:

- `{ success: false, error: "Not initialized" }` → Should retry with backoff
- `{ success: false, error: "Container mismatch" }` → Should NOT retry, silently
  skip

**Evidence from Logs (Missing):**

The logs do NOT show entries like:

```
[Hydration] GET_QUICK_TABS_STATE handler invoked
[Hydration] Background initialization status: INITIALIZING (tabCount still loading)
[Hydration] Returning empty response with retryable flag

[Hydration] GET_QUICK_TABS_STATE handler invoked
[Hydration] Background initialization status: READY (tabCount=5)
[Hydration] Filtering by originTabId=1
[Hydration] Filtered result: 2 tabs (3 filtered out due to originTabId mismatch)
[Hydration] Returning filtered response
```

Without these boundaries, the content script cannot determine success vs.
recoverable failure.

---

### Issue #15: Missing Message Handler Entry/Exit Instrumentation

**Severity:** HIGH  
**Category:** Observability  
**Affected Components:** Message routing layer, all handlers (handleCreate,
handleGetCurrentTabId, etc.)

#### Problem Description

When a content script sends a message to the background, the logs should show:

1. **Entry:** Message received at handler entry point (name, sender tab ID,
   parameters)
2. **Processing:** Each significant operation within handler (read, update,
   write, validation)
3. **Exit:** Handler exiting with result and duration

Currently, individual handlers log some internal operations (e.g., UpdateHandler
logs "Updated tab position in Map"), but there is **no handler-level envelope
logging** showing:

- When the handler started
- How long it took to process
- Whether it succeeded or failed
- What the return value was

**Evidence from Logs:**

The logs show messages being processed and operations being completed, but not a
clear handler lifecycle:

```
LOG UpdateHandler handlePositionChangeEnd called
id qt-unknown-1766594145392-1b130ks1kel0px
left 858
top 716

LOG UpdateHandler Updated tab position in Map
id qt-unknown-1766594145392-1b130ks1kel0px
left 858
top 716

LOG UpdateHandler Scheduling storage persist after position change...
```

Missing:

- Timestamp when handler entry occurred
- Whether this was the FIRST handler entry or a re-entrant call
- Handler exit status (success/error)
- Return value sent to content script
- Round-trip latency (entry time to content script receiving response)

---

### Issue #16: Storage Write Lifecycle Events Are Incomplete

**Severity:** HIGH  
**Category:** Observability  
**Affected Components:** StorageUtils, storage persistence layer

#### Problem Description

The code logs `StorageWrite LIFECYCLE` events with phases:

```
LOG StorageWrite LIFECYCLEQUEUED
correlationId write-2025-12-24T163551.093Z-bkzdee
transactionId txn-1766594151093-UNKNOWN-14-f1b137c1
tabCount 2
forceEmpty false
caller VisibilityHandler
timestamp 2025-12-24T163551.093Z

LOG StorageWrite LIFECYCLECOALESCED
correlationId write-2025-12-24T163551.093Z-bkzdee
transactionId txn-1766594151093-UNKNOWN-14-f1b137c1
phase RATELIMIT
reason ratelimit
tabCount 2
durationMs 0
timestamp 2025-12-24T163551.093Z
```

However, the lifecycle is INCOMPLETE. Missing phases:

1. **INITIATED** - After decoalescing, right before calling
   browser.storage.local.set()
   - Should log: state snapshot being written, state hash, version number
2. **IN_FLIGHT** - While promise is pending
   - Should log periodically: elapsed time, whether callbacks are backed up
3. **COMPLETED** - After promise resolves
   - Should log: actual completion time, latency, whether storage.onChanged
     event fired
4. **FAILED** - If promise rejects
   - Should log: error details, retry count, whether retry scheduled
5. **EVENT_RECEIVED** - When storage.onChanged fires
   - Should log: event data hash, whether it matches the write that triggered
     it, latency since write completed

Currently, logs jump from QUEUED → COALESCED, and then...nothing. There's no log
showing when the actual storage write happened or completed.

---

### Issue #17: Tab ID Extraction from Quick Tab ID Pattern Has No Validation

**Severity:** HIGH  
**Category:** Data integrity  
**Affected Components:** QuickTabHandler.\_extractTabIdFromPattern(), tab ID
fallback logic

#### Problem Description

When originTabId cannot be extracted from message parameters, the code attempts
to extract it from the quickTabId pattern:

```javascript
// Pattern: qt-<tabId>-<randomId>
const match = quickTabId.match(/^qt-(\d+)-/);
```

However, the logs show:

```
quickTabId qt-unknown-1766594145392-1b130ks1kel0px
```

The pattern is `qt-unknown-...`, not `qt-<number>-...`. This means:

1. The regex match FAILS to extract a tabId
2. The fallback returns null
3. The code allows creation with originTabId=null (Issue #12)

**Root Cause:**

The tabId was "unknown" at the time the quickTabId was generated. This indicates
the identity system (determining the current tab ID) failed during Quick Tab
creation. The code generated a quickTabId with a placeholder "unknown",
expecting to fill in the real tabId later—but never did.

**Missing Validation:**

After the regex match fails, there is NO validation checking:

1. Is "unknown" a valid fallback, or does it indicate creation failure?
2. Should creation be rejected if tabId cannot be determined?
3. Is there any downstream code that will fix the "unknown" to a real tabId
   later?

Currently, "unknown" Quick Tabs persist through the entire lifecycle with no
mechanism to upgrade them to a known tabId.

---

### Issue #18: Manager Panel State Synchronization Across Tab Switches

**Severity:** MEDIUM  
**Category:** Cross-tab state coherence  
**Affected Components:** Quick Tabs Manager sidebar,
SYNC_QUICK_TAB_STATE_FROM_BACKGROUND message

#### Problem Description

Per issue-47-revised.md Scenario 16 (Manager Panel Position Persistence), the
Manager's own position and size should persist across tab switches within a
session. However, the logs show no evidence of Manager state being synchronized
when switching tabs:

**Expected (from Scenario 16):**

```
1. Move Manager to bottom-left, resize to 450×600
2. Switch to YT 1 new tab
3. Manager should remain at bottom-left, 450×600
4. Close and reopen Manager → appears at last saved position
```

**Missing Logs:**

No logs show:

- When tab switch occurred
- Whether Manager state was read from storage or cached
- Whether Manager position was validated on tab switch
- Whether Manager reused cached position or refreshed from storage

This is critical because the Manager sidebar is shared across tabs. When
switching tabs, the Manager must know:

1. Did the current tab's Quick Tab state change?
2. Should the Manager refresh the tab list?
3. Should the Manager's own position be reloaded or kept current?

---

### Issue #19: Container Identity Validation Is Incomplete at Hydration

**Severity:** MEDIUM  
**Category:** Container isolation  
**Affected Components:** hydrate-quick-tabs.js, originContainerId validation

#### Problem Description

Per issue-47-revised.md Scenario 14 and 18 (Container Isolation), Quick Tabs
created in one Firefox container must NOT appear in another container, even on
the same domain.

**Expected Container Isolation:**

- Wikipedia in Personal Container has QT-1
- Wikipedia in Work Container opened → QT-1 should NOT appear (different
  container)
- Manager shows only Quick Tabs for current container

**Current Implementation Gap:**

The code attempts to track `originContainerId` (the container where the Quick
Tab was created), but during hydration, there is NO validation checking:

1. Does the originTabId's container match the current tab's container?
2. If the user navigated from Container A to Container B in the SAME tab, should
   the old Quick Tabs be hidden?
3. If the user closed a container, should Quick Tabs from that container be
   cleaned up?

**Missing Logs:**

Hydration logs do NOT show:

```
[Hydration] Current container: firefox-default
[Hydration] Quick Tab originContainerId: firefox-default ✓ MATCH
[Hydration] Including Quick Tab in hydration

[Hydration] Current container: firefox-default
[Hydration] Quick Tab originContainerId: firefox-personal ✗ MISMATCH
[Hydration] Excluding Quick Tab from hydration
```

Without these logs, it's impossible to debug container mismatch issues.

---

### Issue #20: Minimized State Persistence Lacks Validation

**Severity:** MEDIUM  
**Category:** State integrity  
**Affected Components:** VisibilityHandler, minimized state tracking, storage
serialization

#### Problem Description

Per issue-47-revised.md Scenario 5 and 8 (Minimize/Restore operations),
minimized state must be stored and restored correctly:

**Expected (Scenario 10: Persistence Across Browser Restart):**

```
1. Create QT in YT 1, minimize it (yellow)
2. Close browser
3. Reopen browser, open YouTube
4. QT should NOT be visible (minimized state persisted)
5. Open Manager → QT shown with yellow indicator
```

**Current Implementation Gap:**

The logs show minimize operations being tracked, but there is NO validation of
the minimized state field in the stored JSON:

```
LOG VisibilityHandler State validation totalTabs 2, minimizedCount 0, activeCount 2, minimizedManagerCount 0
```

This logs aggregates (totalTabs, minimizedCount), but does NOT log:

- For each tab: { id, minimized: true/false }
- Whether minimized state matches expected value for each tab
- Whether minimized status matches the Manager's tracking

**Missing Validation:**

After restoring from storage, there should be a validation step:

1. For each Quick Tab, is `minimized` field a boolean?
2. If minimized=true, is the tab hidden from viewport display?
3. If minimized=true, is the tab listed in Manager with yellow indicator?
4. Are counts (minimizedCount, activeCount) correct?

---

## Section 2: Missing Logging Infrastructure (Extended)

### Missing Logging #6: Storage Write Latency Tracking

The code logs when writes are queued and coalesced, but does NOT log:

- Time from "write decision" to "browser.storage.local.set() called"
- Time from "storage.local.set() called" to "promise resolves"
- Time from "promise resolves" to "storage.onChanged event fires"
- Total end-to-end latency from "content script sends message" to "background
  persistence complete"

**Why This Matters:**

If a write takes 1 second instead of expected 100-200ms, the application might
appear to hang. Without latency logs, it's impossible to detect performance
regressions or identify bottlenecks.

---

### Missing Logging #7: Identity System State Transitions

The logs show `identityStateMode INITIALIZING`, but there are no logs of state
transitions:

- When does identity change from INITIALIZING → READY?
- How long does initialization take?
- If initialization fails, what was the cause?
- Does identity ever transition from READY → INITIALIZING (e.g., during
  background timeout)?

---

### Missing Logging #8: Content Script Lifecycle Events

When a content script loads on a page, there should be logs:

```
[ContentScript][Init] Page loaded: url, tabId, container
[ContentScript][Init] Sending GET_QUICK_TABS_STATE
[ContentScript][Init] Received response: success, tabCount
[ContentScript][Hydration] Filtering by originTabId
[ContentScript][Hydration] Rendering Quick Tabs: count
[ContentScript][Ready] Hydration complete, listeners attached
```

Currently, these lifecycle events are missing, making it hard to debug what
happens when a user opens a new tab.

---

### Missing Logging #9: Storage.onChanged Event Cascade Details

When storage.onChanged fires, the logs should show:

```
[Storage][Event] storage.onChanged triggered
[Storage][Event] Cause: (self-write | external-write | other-extension)
[Storage][Event] Previous version: X
[Storage][Event] New version: Y
[Storage][Event] Changed fields: [list]
[Storage][Event] Processing handler: [name]
[Storage][Event] Deduplication result: (processed | skipped)
[Storage][Event] Handler completed in Xms
```

Currently, storage.onChanged events are handled but the logs don't show details
about what triggered the event or how it was processed.

---

### Missing Logging #10: Retry and Backoff Timing

The code has retry logic with exponential backoff, but does NOT log:

- When a retry is about to occur
- What backoff delay was chosen
- Whether the retry succeeded
- Whether max retries were exhausted

---

## Section 3: Architectural Issues Reinforced by Log Analysis

### Issue #21: Identity System Initialization Must Precede Quick Tab Creation

The logs show `identityStateMode INITIALIZING` at the time of Quick Tab
creation:

```
generateTransactionId
Identity not initialized
tabId UNKNOWN
identityStateMode INITIALIZING
```

This indicates a **sequence violation**. The expected order should be:

1. Content script loads
2. Identify current tab/container (set identityStateMode=READY)
3. Create Quick Tabs (use known tabId)

But instead:

1. Content script loads
2. Quick Tab creation initiated (identityStateMode still INITIALIZING)
3. Uses tabId=UNKNOWN, generates quickTabId with "unknown" placeholder

**Missing Validation:**

The handlers should check `identityStateMode === READY` before proceeding with
creation. If not ready, operations should either:

1. Wait for identity to initialize (with timeout)
2. Queue the operation until identity is ready
3. Return error indicating "not ready" (content script should retry)

Currently, operations proceed with unknown identity, creating malformed Quick
Tabs.

---

### Issue #22: Coalescing Strategy Must Account for Operation Ordering

When multiple messages arrive within the rate-limit window, the coalescing
strategy must preserve operation ordering. Currently:

**Example Scenario:**

```
T=0ms    Message 1: CREATE_QUICK_TAB(A)
T=50ms   Message 2: MINIMIZE_QUICK_TAB(X)
T=100ms  Background processes Message 1, writes state
T=110ms  Message 3: DELETE_QUICK_TAB(A)
T=115ms  Background receives Message 2, attempts to minimize X
T=120ms  Rate limit check: write 15ms ago, can't write yet
T=120ms  Coalesce Message 2 and Message 3
T=125ms  Message 3 arrives: delete A
T=130ms  Coalesced write includes: A (deleted by msg3) and X (minimized by msg2)
         But A was just created, so the create/delete happens in the same tick
         Are dependencies respected?
```

The logs show coalescing occurred but NOT whether operation ordering was
preserved. Missing validation:

- Are operations topologically sorted (dependencies first)?
- Are destructive operations (delete) correctly ordered after read operations?
- Is the final state correct given the operation order?

---

## Section 4: Contract Violations Between Layers

### Violation #1: hydrate-quick-tabs.js Expects Valid originTabId, But Receives null

**Contract (from issue-47):** Quick Tabs have valid originTabId matching origin
tab **Reality (from logs):** Quick Tabs created with originTabId=null
**Result:** Hydration filtering fails, Quick Tab becomes invisible

---

### Violation #2: Manager Sidebar Expects Container-Scoped QTs, But Receives All QTs

**Contract (from issue-47 Scenario 14):** Manager shows only QTs from current
container **Reality:** No container validation during hydration **Result:**
Cross-container Quick Tabs may appear (if hydration filtering is disabled)

---

### Violation #3: Content Script Expects Clear Initialization Status, But Gets Ambiguous Responses

**Contract:** GET_QUICK_TABS_STATE response includes initialization status
**Reality:** Response envelope lacks status field **Result:** Content script
cannot distinguish retryable from permanent failures

---

## Section 5: Recommended Logging Additions (Prioritized)

### P0: Critical Boundary Markers (Implement Immediately)

1. **[Identity] Mode state changes:** "Identity state transitioning:
   INITIALIZING → READY" with duration
2. **[QuickTab][Create] Operation validation:** Before serialization, log: tabId
   (known/unknown), containerId, will succeed/fail
3. **[Hydration] Filter results:** Log each QT filtered (include reason:
   originTabId mismatch, container mismatch, minimized, etc.)
4. **[Message][Handler] Envelope:** Entry and exit timestamps, handler name,
   sender tab, return status

### P1: Event Sequencing Tracking (Implement Next Sprint)

1. **[Storage][Write] Lifecycle completion:** When storage.onChanged fires,
   match to write that triggered it
2. **[Message][Queue] Processing:** Log message queue state before and after
   each dequeue
3. **[Coalesce] Merge strategy:** Log how operations were merged, final state
   after merge
4. **[Retry] Backoff decisions:** Log retry attempt count, backoff delay chosen,
   outcome

### P2: State Validation (Implement Future)

1. **[Storage][Validate] After write:** Immediately read state back to confirm
   persistence
2. **[Manager][Validate] Tab sync:** Log when Manager updates due to tab changes
3. **[Container] Boundaries:** Log container checks during hydration and
   minimize/restore operations

---

## Section 6: Reference Mapping to Previous Report

This report extends the previous diagnostic with findings from:

- **Previous Issue #1-5** (initialization, storage writes, dedup): Reinforced
  with log evidence showing initialization happening with UNKNOWN identity
- **Previous Issue #6** (cross-tab sync): Extended with message ordering
  violation patterns
- **Previous Issue #7** (missing logging): Detailed 10 additional missing log
  categories
- **New Issues #12-22** (not previously covered): Orphan QTs, container
  violations, contract mismatches

---

## Acceptance Criteria for Fixes

All fixes must verify:

- [ ] originTabId is never null for persisted Quick Tabs (reject creation if
      identity unknown)
- [ ] Identity state is READY before any Quick Tab operation (wait/queue if
      initializing)
- [ ] Hydration filtering works correctly (logs show matches and rejections per
      QT)
- [ ] Message handler envelopes log entry/exit with duration and status
- [ ] Storage write lifecycle is complete (QUEUED → IN_FLIGHT → COMPLETED)
- [ ] Manager respects container boundaries (hydration validates
      originContainerId)
- [ ] GET_QUICK_TABS_STATE response includes clear initialization status
- [ ] Coalescing preserves message order (logs show merge strategy and final
      state)
- [ ] All logs include timestamp, correlationId, and context (tabId, container)

---

## Supporting Context

### Evidence Source: Production Logs

File: `copy-url-extension-logs_v1.6.3.11-v7_2025-12-24T16-36-29.txt`

Key patterns observed:

- Multiple entries showing `originTabId null` and `tabId UNKNOWN`
- Identity state `INITIALIZING` during Quick Tab creation
- Transaction IDs generated with `UNKNOWN` tab reference
- Coalescing decisions logged without merge strategy details
- No storage.onChanged event feedback (write triggering event not confirmed)

### Evidence Source: Expected Behavior

File: `issue-47-revised.md`

Key scenarios violated:

- Scenario 11: Hydration filtering assumes valid originTabId (not null)
- Scenario 14: Container isolation requires originContainerId validation
- Scenario 10: Persistence requires correct minimized state (validation missing)
- All scenarios assume valid tab-scoping (originTabId present and validated)

---

**Priority:** Fix Issues #12-22 in order of severity (CRITICAL → HIGH → MEDIUM)
to restore tab-scoping guarantees and enable proper state debugging.

**Complexity:** Issues #12-14 require architectural changes (delay creation
until identity ready). Issues #15-22 require logging instrumentation only
(non-breaking, can be phased).

**Target:** All CRITICAL issues must be resolved before next release to prevent
orphan QT creation.
