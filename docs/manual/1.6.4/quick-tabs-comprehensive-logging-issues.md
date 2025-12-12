# Quick Tabs State Synchronization: Comprehensive Logging & Initialization Issues

**Extension Version:** v1.6.3.7-v12 | **Date:** 2025-12-11 | **Scope:** Missing
diagnostic logging across initialization, message deduplication, storage
validation, sidebar communication, and port registry monitoring

---

## Executive Summary

Analysis of v1.6.3.7-v12 reveals **thirteen critical logging gaps and
architectural issues** preventing developers from diagnosing state
synchronization failures, initialization races, storage corruption, and
communication fallbacks. While underlying state mutation logic is largely sound,
the absence of diagnostic logging creates a "black box" where failures remain
invisible until catastrophic data loss occurs. Issues span content script
initialization races, asymmetric storage validation, undocumented sidebar
communication fallbacks, and silent threshold monitoring across three critical
subsystems: background script initialization, message deduplication, and port
registry lifecycle.

## Issues Overview

| Issue                                             | Component                                  | Severity | Root Cause                                                         |
| ------------------------------------------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------ |
| #1: Initialization Race in QuickTabHandler        | QuickTabHandler.handleGetQuickTabsState()  | Critical | No async barrier preventing early response                         |
| #2: Storage Write Validation Split                | QuickTabHandler + background.js            | High     | Asymmetric validation: handler validates, background doesn't       |
| #3: Arbitrary 50ms Dedup Window                   | background.js storage.onChanged            | High     | No ordering guarantees from Firefox; timestamp window insufficient |
| #4: Port Registry Thresholds Undefined            | background.js port monitoring              | High     | Thresholds defined but never checked or acted upon                 |
| #5: Sidebar Communication Fallback Silent         | sidebar/quick-tabs-manager.js              | High     | BroadcastChannel failure activation undocumented                   |
| #6: Content Script currentTabId Race              | src/features/quick-tabs/index.js           | High     | No barrier between detection and hydration                         |
| #7: Storage Corruption Detection Without Recovery | QuickTabHandler.\_validateStorageWrite()   | Medium   | Validation finds corruption but has no recovery strategy           |
| #8: Dedup Decision Logging Missing                | background.js \_multiMethodDeduplication() | Medium   | No logs when messages skipped (silent failure mode)                |
| #9: Keepalive Success Rate Not Tracked            | background.js triggerIdleReset()           | Medium   | Periodic reset happens but health visibility missing               |
| #10: Port Lifecycle Metadata Incomplete           | background.js port registry                | Medium   | createdAt/lastMessageTime exist but not always updated             |
| #11: Storage Validation Only for Handler Writes   | QuickTabHandler.saveStateToStorage()       | Medium   | Background writes (multiple locations) bypass validation           |
| #12: Sidebar Fallback Health Monitoring Missing   | sidebar/quick-tabs-manager.js              | Medium   | No way to determine active communication tier                      |
| #13: Cross-tab Message Ordering Undocumented      | background.js + storageOnChanged           | Low      | Sequence ID exists but comments don't explain why ordering needed  |

**Why bundled:** All prevent effective diagnosis of state synchronization;
interconnect across initialization, message routing, storage, and communication
layers; require instrumentation-only fixes without behavior changes.

<scope>
**Modify (logging only):**
- `src/background/handlers/QuickTabHandler.js` (initialization barrier, storage validation)
- `background.js` (dedup logging, port monitoring, keepalive tracking, storage validation)
- `sidebar/quick-tabs-manager.js` (fallback detection and health monitoring)
- `src/features/quick-tabs/index.js` (currentTabId initialization barrier)

**Do NOT Modify:**

- State mutation logic or deduplication behavior
- Storage write/read operations themselves
- Message routing or event handling logic
- UI rendering or visual state
- `src/background/` folder structure </scope>

---

## Issue #1: Initialization Race in QuickTabHandler.handleGetQuickTabsState()

### Problem

Content scripts call handleGetQuickTabsState() during initialization before
background.js fully loads state from storage. Handler returns empty state
`{ tabs: [] }` causing content script to think no Quick Tabs exist, even though
tabs are saved. Impossible to distinguish from "storage is actually empty"
without logging.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js`  
**Location:** `handleGetQuickTabsState()` and `_ensureInitialized()` (lines
530-600)  
**Issue:** \_ensureInitialized() awaits initializeFn() but handler responds
before confirmation that isInitialized was actually set to true. No timeout
protection; timeout constant INIT_TIMEOUT_MS = 10000 defined but background.js
waitForInitialization() uses only 5000ms—mismatch creates race window.

### Fix Required

Add explicit initialization barrier with before/after logging at each state
transition: "awaiting initialization" → "initialization complete" → "responding
with X tabs". Log timestamp of message arrival, initialization start/end, and
response. Add timeout protection (use existing INIT_TIMEOUT_MS constant). When
timeout occurs, log "INIT_TIMEOUT" with duration and expected vs. actual
isInitialized state. If initialization was pending but completes, log "recovered
after NN ms" showing recovery time.

---

## Issue #2: Storage Write Validation Split Across Components

### Problem

QuickTabHandler.saveStateToStorage() validates writes by reading back and
comparing saveId/tab count/checksum. However, background.js makes direct
storage.local.set() calls in multiple locations without any validation. If
IndexedDB corruption occurs (Firefox bugs 1979997, 1885297), background writes
persist corrupted data silently while handler writes would have detected it.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js` lines 797-854 (has
validation)  
**File:** `background.js` lines 1500+ (direct writes without validation)  
**Issue:** Validation logic isolated to handler's \_validateStorageWrite(),
creating asymmetry. Background's direct browser.storage.local.set() calls bypass
verification entirely. No recovery mechanism when validation fails except
generic error log.

### Fix Required

Centralize storage write validation: whenever browser.storage.local.set() is
called for quick_tabs_state_v2 key, immediately follow with readback validation.
Log validation result ("passed" or "failed") with operation ID, tab count, and
saveId. When validation fails, identify failure type (READ_RETURNED_NULL,
TAB_COUNT_MISMATCH, SAVEID_MISMATCH, CHECKSUM_MISMATCH) and log each type with
expected vs actual values. Implement recovery attempt: if validation fails, log
"RECOVERY_ATTEMPT" with method (re-write, trim, or restore-from-backup). Log
recovery success/failure with result details.

---

## Issue #3: Arbitrary 50ms Dedup Window Without Ordering Guarantees

### Problem

background.js storage.onChanged handler deduplicates using 50ms timestamp window
based on saveId + timestamp. This window is completely arbitrary and has no
justification against Firefox's actual storage.onChanged event delivery
guarantees. Firefox documentation explicitly states: **"No ordering guarantees
across multiple listeners or writes."** If two writes occur 100ms apart but
events fire out-of-order (older write's event fires second), the 50ms window has
expired, so older event is processed as current state, rolling back newer
changes silently.

### Root Cause

**File:** `background.js` lines 240 (DEDUP_SAVEID_TIMESTAMP_WINDOW_MS = 50)  
**Location:** storage.onChanged handler and \_multiMethodDeduplication()  
**Issue:** 50ms window hardcoded with no comment explaining why 50ms is safe.
Firefox's storage.onChanged provides no ordering guarantee. Sequence ID
(v1.6.3.7-v9) was added but timestamp-based dedup still used. No log entries
when dedup decisions made—when state rollback occurs, only evidence is "state
changed incorrectly" with no diagnostic pointing to dedup.

### Fix Required

Replace timestamp-only dedup decisions with sequence ID prioritization. Log all
dedup decisions: when message skipped due to timestamp window, log
"DEDUP_SKIPPED" with saveId, timestamp difference, and sequence ID comparison.
Add config comment explaining: "Sequence ID ordering is reliable because IDs
assigned at write-time before storage.local.set() call, not at event-fire time.
Firefox does not reorder events from same write operation, so sequence provides
ordering guarantee timestamp cannot provide." Log when sequence ID indicates
out-of-order events detected: "OUT_OF_ORDER_EVENTS: older sequence NN fired
after newer sequence MM". Consider deprecating timestamp window entirely in
favor of sequence ID alone. Enable dedup logging in DEBUG_DIAGNOSTICS mode.

---

## Issue #4: Port Registry Thresholds Never Monitored

### Problem

background.js defines PORT_REGISTRY_WARN_THRESHOLD = 50 and
PORT_REGISTRY_CRITICAL_THRESHOLD = 100 (lines 246-247), but these constants are
never checked anywhere in the codebase. Port registry (Map tracking sidebar
connections) can grow unbounded when sidebar connects/disconnects repeatedly
without cleanup. No warning is ever logged as registry approaches dangerous
sizes. When port count reaches 200+ and causes memory bloat or messaging
failures, developers have zero evidence in logs that port accumulation was the
issue.

### Root Cause

**File:** `background.js` lines 246-247 (constant definitions)  
**Location:** logDiagnosticSnapshot() logs port count but doesn't compare to
thresholds  
**Issue:** Constants defined but never referenced. Cleanup code attempts to
identify stale ports (inactive 60+ seconds) but only triggers at CRITICAL
threshold. Diagnostic snapshot includes "connectedPorts" count but no threshold
comparison. No periodic monitoring between snapshots.

### Fix Required

Implement periodic threshold monitoring (every 30 seconds, similar to dedup
stats): compare current portRegistry.size against WARN_THRESHOLD and
CRITICAL_THRESHOLD. Log "PORT_REGISTRY_WARN" when exceeds 50 with current size,
trend (increasing/stable/decreasing from last 5 checks), and recommendation. Log
"PORT_REGISTRY_CRITICAL" when exceeds 100 with error-level severity and
automatic cleanup attempt. Track port lifecycle: update port metadata
(lastMessageTime) whenever port receives/sends messages. Log stale port cleanup
attempt with ports removed, their ages, and recovery status. Include port health
in diagnostic snapshot: "connectedPorts: 35 (HEALTHY, stable trend)".

---

## Issue #5: Sidebar Communication Fallback Mechanism Undocumented

### Problem

BroadcastChannel initialization fails silently in sidebar context (Firefox API
constraint). Manager falls back to some other communication mechanism, but
neither the fallback type nor its activation is documented or logged. When
sidebar opens, developers have no way to determine: (1) Is sidebar using
BroadcastChannel or fallback? (2) What is fallback mechanism? (3) How often does
fallback retry? (4) When does fallback give up and log error? Unable to diagnose
why Manager shows 5+ second update delays.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines ~200-400 estimated)  
**File:** `src/features/quick-tabs/channels/BroadcastChannelManager.js` (lines
162-176)  
**Issue:** BroadcastChannel initialization attempts
`new BroadcastChannel(CHANNEL_NAME)` in sidebar. In sidebar context, this fails
silently (exception caught, channelSupported = false set). No explicit log:
"BroadcastChannel unavailable in sidebar context, activating fallback [TYPE]".
Manager code must have fallback logic but it's not instrumented. No indication
which tier is active (Tier 1 BroadcastChannel vs. Tier 2 port messaging vs. Tier
3 storage polling).

### Fix Required

Add explicit fallback activation logging in Manager startup: detect
BroadcastChannel initialization failure (via timeout ~1s with no message
received), log "SIDEBAR_BC_UNAVAILABLE: Activating fallback [mechanism type]".
Identify actual fallback mechanism from codebase (likely port-based or storage
polling) and document in inline comment. Add fallback health monitoring: every
30 seconds while fallback active, log "FALLBACK_HEALTH: received X state updates
in interval, average latency Y ms, last update Z ms ago". Log success
milestones: "FALLBACK_ACTIVATED: using [mechanism], will check fallback health
every 30s". Log when fallback messaging fails (port closes, storage events
stop): "FALLBACK_DEGRADED: no state updates for 60+ seconds". Create diagnostic
endpoint: show current active communication tier (BC or fallback) and why in
Manager's debug UI.

---

## Issue #6: Content Script currentTabId Initialization Race

### Problem

src/features/quick-tabs/index.js initializes QuickTabsManager in seven steps.
Step 1 attempts to detect currentTabId (via runtime.sendMessage, may take 100+
ms), but Step 6 hydrates state from storage immediately after Step 5. If
currentTabId detection is slow, hydration runs with currentTabId = null, causing
tab scope check to reject ALL stored tabs as "belonging to different tab"
(because originTabId won't match null). Content script logs show "hydrated 0
tabs" with no indication why.

### Root Cause

**File:** `src/features/quick-tabs/index.js`  
**Location:** \_initStep1_Context() (async) and \_initStep6_Hydrate()  
**Issue:** Step 1 calls detectCurrentTabId() asynchronously but doesn't await or
set barrier. By time Step 6 runs, currentTabId might still be null. Hydration
uses currentTabId in \_checkTabScopeWithReason() which filters tabs: null
currentTabId → all tabs filtered as "wrong tab". No log indicates "currentTabId
was null at hydration time" or "detection was slow".

### Fix Required

Add initialization barrier after Step 1: explicitly check if currentTabId was
set to non-null value. If null, wait with timeout (2 seconds max) for
runtime.sendMessage result before proceeding to Step 2. Log entry to each init
step with currentTabId value: "INIT_STEP_1: currentTabId detection started" →
"INIT_STEP_1_COMPLETE: currentTabId=13" (or "INIT_STEP_1_TIMEOUT: currentTabId
still null after 2s"). In hydration (Step 6), add guard: if currentTabId is
null, log warning "HYDRATION_BLOCKED: currentTabId=null, skipping hydration"
rather than silently filtering all tabs. Log successful hydration completion:
"HYDRATION_COMPLETE: loaded 5 tabs from storage, currentTabId=13".

---

## Issue #7: Storage Corruption Detection Without Recovery Strategy

### Problem

QuickTabHandler.\_validateStorageWrite() detects storage corruption (readback
returns null, saveId mismatch, tab count mismatch, checksum mismatch) and logs
failures. However, there is no recovery attempt. When validation fails, handler
logs an error and returns false, but corrupted state remains in storage. Next
time Manager or content script reads, they get bad data. Only recovery option is
manual clearing of storage.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js` lines 797-854  
**Location:** \_validateStorageWrite() and supporting helpers  
**Issue:** Validation failure returns result with error code, but no recovery
code path. When validation detects READ_RETURNED_NULL (likely quota exceeded) or
TAB_COUNT_MISMATCH (likely corruption), handler logs error and stops. No attempt
to retry write, trim old data, restore from backup, or emit user notification.

### Fix Required

When validation fails, identify failure type and implement type-specific
recovery: for READ_RETURNED_NULL (quota likely exceeded), attempt to clear
oldest Quick Tabs (by creationTime) and retry write with reduced tab count; for
TAB_COUNT_MISMATCH (likely corruption), attempt to restore from previous
successful save if available; for SAVEID_MISMATCH, verify sequence ID ordering
to detect out-of-order events. Log recovery attempt: "RECOVERY_ATTEMPT: [failure
type] → trying [method]". Log result: "RECOVERY_SUCCESS: re-wrote X tabs to
storage" or "RECOVERY_FAILED: [reason], recommend manual intervention". If all
recovery attempts fail, emit critical error event to UI layer:
"STORAGE_INTEGRITY_RISK: Data may be lost, recommend clearing storage".

---

## Issue #8: Deduplication Decision Logging Missing

### Problem

background.js \_multiMethodDeduplication() silently skips messages matching
saveId within 50ms timestamp window. When dedup triggers, there's no log entry.
When state mysteriously rolls back or doesn't update, developers have zero
evidence that dedup was the cause.

### Root Cause

**File:** `background.js` storage.onChanged handler  
**Location:** \_multiMethodDeduplication() (exact lines not located in scan)  
**Issue:** Dedup decisions completely silent. When message skipped, no
"DEDUP_SKIPPED" log. When message processed, no "DEDUP_PROCESSED" log. Silent
failures are worst-case for diagnostics.

### Fix Required

Log all dedup decisions: add "DEDUP_DECISION" log whenever dedup evaluates
message. Include saveId, timestamp, sequence ID, decision (skip or process), and
reason (timestamp window expired, saveId matched, sequence ID indicated
duplicate). Enable this logging in DEBUG_DIAGNOSTICS mode without performance
penalty. Example: "DEDUP_DECISION: saveId=abc123, decision=SKIP,
reason=TIMESTAMP_WINDOW_ACTIVE (15ms ago), sequenceId=42". This allows
developers to trace "why did state not update" by reviewing dedup decisions.

---

## Issue #9: Keepalive Success Rate Not Tracked

### Problem

background.js triggerIdleReset() runs every 20 seconds to prevent Firefox idle
termination. Handler logs indicate "KEEPALIVE_RESET_SUCCESS" occasionally (every
10th success) but there's no overall health metric. Developers can't tell if
keepalive is working well (95% success rate) or poorly (30% success rate)
without manually counting log entries.

### Root Cause

**File:** `background.js` startKeepalive() and triggerIdleReset()  
**Location:** lines ~550-650 estimated  
**Issue:** Individual successes logged every Nth time (rate-limited), but no
aggregated health metric. Success rate, failure rate, and degradation trends
invisible without manual analysis.

### Fix Required

Track keepalive success/failure rates: maintain counter of successes and
failures (reset every 60 seconds). Log "KEEPALIVE_HEALTH_REPORT: last 60s: 35
successes, 2 failures (98.3% success rate), average method: tabs.query +
runtime.sendMessage, fastest: 2ms, slowest: 45ms". Log degradation warnings if
success rate drops below 90%: "KEEPALIVE_HEALTH_WARNING: success rate 85%,
inspect Firefox idle state or API availability". Include in diagnostic snapshot:
"keepalive health: 98% (excellent)".

---

## Issue #10: Port Lifecycle Metadata Incomplete

### Problem

portRegistry tracks ports with metadata (createdAt, lastMessageTime) for stale
detection, but these timestamps aren't consistently updated when ports
receive/send messages. This breaks stale port cleanup logic: ports appear stale
even if recently active because lastMessageTime wasn't updated.

### Root Cause

**File:** `background.js` port registry and message handlers  
**Location:** Port message listener (estimated lines 1400-1500)  
**Issue:** Port metadata initialized at creation but lastMessageTime may not be
updated on every message. Cleanup code assumes stale port = inactive port, but
metadata accuracy is unknown.

### Fix Required

Ensure every port message triggers lastMessageTime update: "port.lastMessageTime
= Date.now()" whenever port receives onMessage event. Log when port metadata is
updated: "PORT_ACTIVITY: portId=X, lastMessageTime=NN ms ago". In diagnostic
snapshot, include port lifecycle details: "4 active ports: [portId1 (created 2m
ago, last active 1s ago), portId2 (created 5m ago, last active 15s ago), ...]".
This ensures stale port cleanup correctly identifies truly inactive ports.

---

## Issue #11: Storage Validation Only for Handler Writes

### Problem

QuickTabHandler validates its own writes but doesn't validate writes from
background.js. Background.js makes storage.local.set() calls in createTab,
updatePosition, updateSize, etc. without readback validation. If IndexedDB fails
(quota exceeded, corruption), these writes silently fail or persist corrupted
data.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js` lines 797-854 (validation
exists)  
**File:** `background.js` multiple locations with direct storage.local.set()  
**Issue:** Validation logic written but isolated to one component. State
mutation happens in multiple places (handlers, message routers,
StateCoordinator) but only handler validates.

### Fix Required

For all storage.local.set(quick_tabs_state_v2, ...) calls throughout codebase:
add readback validation within same function or call shared validation helper.
Log validation results: "STORAGE_WRITE_VALIDATION: operation_id=X, saveId=Y,
expected_tabs=5, actual_tabs=5, checksum_match=true → PASSED" or "FAILED". When
validation fails, log decision: retry, recover, or fail. This prevents silent
corruption from persisting across all write paths.

---

## Issue #12: Sidebar Fallback Health Monitoring Missing

### Problem

When Manager detects BroadcastChannel is unavailable and activates fallback
communication (port-based or storage polling), there's no ongoing health
monitoring. Fallback could be degraded (30s latency instead of 100ms) and
developers would have no diagnostic indication.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Communication initialization and message reception  
**Issue:** Fallback activation is silent; no "fallback mode active" indicator.
No periodic health check: message receive rate, latency, last update time.

### Fix Required

When fallback is activated, start health monitoring: every 30 seconds, log
"FALLBACK_HEALTH: received X messages in interval (expected ~6 if state changes
every 5s), avg latency Y ms, last update Z ms ago". If no messages in 60+
seconds, log "FALLBACK_STALLED: no state updates for 60+ seconds, fallback may
be broken". Log health status in Manager UI: show badge or tooltip "Fallback
mode active - messages arriving every 10s" so users understand why updates might
be slow.

---

## Issue #13: Cross-tab Message Ordering Undocumented

### Problem

Code uses sequence ID for event ordering (v1.6.3.7-v9 feature) but comments
don't explain why ordering is needed or why sequence ID provides guarantees.
Developers modifying dedup or storage logic may not understand that sequence ID
is the source of truth for event ordering.

### Root Cause

**File:** `background.js` storage write path and dedup logic  
**Location:** Comments around \_getNextStorageSequenceId(),
DEDUP_SAVEID_TIMESTAMP_WINDOW_MS, and storage.onChanged handler  
**Issue:** Sequence ID added to fix event ordering issues but documentation is
sparse. New developers reading code won't understand architectural decision.

### Fix Required

Add comprehensive inline comment explaining event ordering architecture:
"Firefox storage.onChanged provides NO ordering guarantees across multiple
writes. Two writes 100ms apart may have events fire in any order. Sequence IDs
(assigned at write-time, not event-fire time) provide reliable ordering because
Firefox does not reorder messages from same JS execution. Dedup uses sequence ID
as primary ordering signal, timestamp window as secondary safety net." Reference
Firefox documentation link. Explain why timestamp-based dedup alone is
insufficient.

---

## Shared Implementation Notes

All fixes involve adding instrumentation without changing state mutation logic:

1. **Logging Location:** All new logs use console.log() (visible in browser
   console and exportable via existing log export) or console.error() for
   failures.

2. **Structured Logging:** Each log includes operation ID (unique per
   operation), relevant IDs (tabId, quickTabId, saveId, portId, sequenceId),
   before/after state, and timestamp.

3. **Initialization Barriers:** Use Promise-based barriers or polling with
   timeout rather than boolean flags. Await completion or timeout explicitly.

4. **Threshold Monitoring:** Implement as periodic checks (every 30 seconds)
   rather than per-operation checks to avoid log spam.

5. **Debug Flags:** All new diagnostic logging respects existing DEBUG_MESSAGING
   and DEBUG_DIAGNOSTICS flags defined in background.js. High-volume logs should
   check these flags before writing.

6. **No Behavior Changes:** All fixes are logging/instrumentation only. State
   mutation, deduplication logic, storage writes, message routing remain
   unchanged to avoid introducing new bugs.

<acceptance_criteria>

**Issue #1: Initialization Barrier**

- [ ] handleGetQuickTabsState awaits initialization with explicit logging
      before/after
- [ ] Timeout protection uses INIT_TIMEOUT_MS constant (10000ms)
- [ ] Log shows "AWAITING_INITIALIZATION" and "INITIALIZATION_COMPLETE" states
- [ ] Manual test: verify state loads correctly even if message arrives during
      init

**Issue #2: Storage Validation Symmetry**

- [ ] All browser.storage.local.set() calls followed by readback validation
- [ ] Validation logs include operation_id, expected vs actual values
- [ ] Recovery attempts logged: "RECOVERY_ATTEMPT: [method]"
- [ ] Manual test: trigger storage failure → recovery logs present

**Issue #3: Dedup Decision Logging**

- [ ] All dedup decisions logged: "DEDUP_DECISION: saveId=X,
      decision=[SKIP|PROCESS]"
- [ ] Sequence ID prioritized over timestamp window in comments
- [ ] Config comment explains why sequence ID provides ordering guarantee
- [ ] Manual test: observe dedup decisions during rapid operations

**Issue #4: Port Registry Thresholds**

- [ ] WARN_THRESHOLD (50) triggers "PORT_REGISTRY_WARN" log with trend analysis
- [ ] CRITICAL_THRESHOLD (100) triggers error-level log and cleanup attempt
- [ ] Port cleanup logged: "STALE_PORT_CLEANUP: removed X ports, recovered Y
      bytes"
- [ ] Health check every 30 seconds logs "PORT_HEALTH_REPORT"

**Issue #5: Sidebar Fallback**

- [ ] Manager logs "SIDEBAR_BC_UNAVAILABLE: Activating fallback [type]" on
      startup
- [ ] Fallback type (port-based or polling) explicitly identified
- [ ] Health check every 30s logs message rate, latency, last update time
- [ ] Manual test: verify fallback activates and health monitoring logs present

**Issue #6: CurrentTabId Initialization**

- [ ] Barrier ensures currentTabId set before hydration starts
- [ ] Step completion logs include currentTabId value or "null" with timeout
      indication
- [ ] Hydration guard logs "HYDRATION_BLOCKED: currentTabId=null" if needed
- [ ] Manual test: verify tabs load correctly even if detection slow

**Issue #7: Corruption Recovery**

- [ ] Validation failure identifies type: READ_RETURNED_NULL,
      TAB_COUNT_MISMATCH, etc.
- [ ] Recovery attempted with method logged: "re-write", "trim",
      "restore-from-backup"
- [ ] Recovery result logged: success with tab count or failure with reason
- [ ] Manual test: trigger write failure → recovery attempt logged

**Issue #8: Dedup Logging**

- [ ] Every dedup decision logged (skip or process) with saveId, timestamp,
      sequenceId
- [ ] Log includes reason: "TIMESTAMP_WINDOW_ACTIVE", "SAVEID_MATCHED", etc.
- [ ] Respects DEBUG_DIAGNOSTICS flag for conditional logging
- [ ] Manual test: observe dedup decisions during operations

**Issue #9: Keepalive Health**

- [ ] Keepalive success/failure rates tracked and logged every 60 seconds
- [ ] "KEEPALIVE_HEALTH_REPORT" includes success rate, failure count, average
      latency
- [ ] Degradation warnings logged if rate drops below 90%
- [ ] Diagnostic snapshot includes keepalive health status

**Issue #10: Port Metadata**

- [ ] Port lastMessageTime updated on every message
- [ ] "PORT_ACTIVITY" log when metadata updated
- [ ] Diagnostic includes port lifecycle: created time, last activity time
- [ ] Manual test: verify stale port cleanup correctly identifies inactive ports

**Issue #11: Symmetric Validation**

- [ ] All storage.local.set(quick_tabs_state_v2) calls followed by validation
- [ ] Validation results logged consistently across all write paths
- [ ] Recovery attempts logged when validation fails
- [ ] Manual test: all write paths produce validation logs

**Issue #12: Fallback Health Monitoring**

- [ ] Fallback health check logs every 30 seconds: message rate, latency, last
      update
- [ ] "FALLBACK_STALLED" logged if no messages for 60+ seconds
- [ ] Manager UI shows fallback active status and health
- [ ] Manual test: monitor fallback health logs during sidebar operations

**Issue #13: Ordering Documentation**

- [ ] Inline comment explains why sequence ID provides ordering guarantee
- [ ] Reference to Firefox storage.onChanged behavior included
- [ ] Explanation of timestamp-based dedup insufficient without ordering
- [ ] Manual test: code review confirms comment clarity

**All Issues:**

- [ ] All new logs use console.log/console.error with structured output
- [ ] All new logging respects DEBUG_MESSAGING and DEBUG_DIAGNOSTICS flags
- [ ] No behavior changes to state mutation or deduplication logic
- [ ] No new console errors or warnings from logging code itself
- [ ] Manual test: perform all operations and review complete diagnostic log
      trail

</acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Firefox API Constraint - Initialization Timing</summary>

Firefox background script initialization is asynchronous. Message handlers
registered before storage loads can fire immediately. Content scripts requesting
state during this window receive incomplete or empty state. The current
implementation has INIT_TIMEOUT_MS = 10000ms in QuickTabHandler but
background.js uses waitForInitialization(5000) creating a race: content script
timeout (10s) could fire before handler confirms initialization (5s window).
Critical for diagnosing "missing tabs on first load" issues.

</details>

<details>
<summary>Issue #3: Storage.onChanged Ordering Behavior</summary>

**Firefox Storage API Behavior:** storage.onChanged events are NOT ordered
across multiple storage operations. MDN documentation explicitly states no
ordering guarantees. If write A and write B occur 50ms apart, events can fire as
B then A, causing state rollback. The extension attempted to mitigate with 50ms
timestamp window, but this assumes event ordering that isn't guaranteed.
Sequence ID (added v1.6.3.7-v9) is superior because sequence numbers are
assigned BEFORE storage.local.set() call (during JS execution which is
single-threaded), not at event-fire time.

</details>

<details>
<summary>Issue #4: Firefox Bug 1851373 - Idle Timeout</summary>

Firefox terminates background scripts after 30 seconds idle (no user
interaction). The extension implements keepalive by calling
runtime.sendMessage() every 20 seconds. This works but creates silent
dependency: if sendMessage starts failing, background script terminates without
warning. The KEEPALIVE_HEALTH_REPORT would catch this by showing success rate
drop.

</details>

<details>
<summary>Issue #5: Firefox Sidebar Isolation</summary>

Firefox sidebar_action creates execution context separate from main extension.
BroadcastChannel API is available but may have isolation issues. Stack Overflow
confirms BroadcastChannel problems in Firefox sidebars. The extension needs
explicit fallback but activation is silent, making it impossible to diagnose
slow UI updates (5+ seconds) caused by fallback latency vs. BroadcastChannel
issues.

</details>

<details>
<summary>Issue #8: IndexedDB Corruption Symptoms</summary>

Firefox bugs 1979997 and 1885297 cause silent IndexedDB corruption where writes
appear successful but data is corrupted or lost. Detection requires readback
validation (which works), but recovery strategy doesn't exist. Developers see
"validation failed: tab count mismatch" but have no next step. Recovery logging
would guide developers: "re-write recovered 3 of 5 tabs" indicates partial
recovery.

</details>

---

**Priority:** Critical (Issues #1-3), High (Issues #4-6), Medium (Issues #7-13)
| **Target:** Single comprehensive PR | **Estimated Complexity:** Low (logging
instrumentation only, no behavior changes)
