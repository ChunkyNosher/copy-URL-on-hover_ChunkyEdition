# Missing Logging & Diagnostics Infrastructure

**Quick Tabs v1.6.3.10-v8** | **Date:** 2025-12-19 | **Scope:** Comprehensive
logging gaps blocking root-cause diagnosis

---

## Executive Summary

Beyond functional bugs, the codebase lacks the diagnostic infrastructure needed
to trace execution flow and confirm causal chains. This document catalogs every
logging gap that prevents root-cause confirmation of Issues A–T. Together, these
gaps create a "black box" where failures occur silently and operators cannot
confirm what went wrong.

---

## Section 1: Identity Readiness Diagnostics (Issues A, O, S, L)

### Gap 1.1: No Logging for Identity Initialization Milestones

**What Should Be Logged:**

- When `getCurrentTabIdFromBackground()` is called (time T)
- When background responds with tab ID (time T + latency, latency value)
- When `setWritingTabId()` is called with the actual value
- When `setWritingContainerId()` is called (if applicable)
- When identity-ready state transitions from FALSE → TRUE

**Current State:** No explicit logging showing when identity prerequisites are
satisfied.

**Impact:** Cannot confirm whether a hydration event that occurred at time T had
identity available or not.

**Example Log Entry That Should Exist:**

```
[Storage-Init] REQUEST tab ID from background at 2025-12-19T12:45:23.100Z
[Storage-Init] RESPONSE received after 145ms, tabId=12345
[Storage-Init] IDENTITY_READY state changed: false → true (both tabId and containerId initialized)
```

**Affected Root Causes:**

- Issue A (hydration before identity ready)
- Issue O (same problem, extended analysis)
- Issue S (container ID not serialized)
- Issue L (transaction ID with unknown tabId)

---

### Gap 1.2: No State Machine Logging for Identity Phases

**What Should Be Logged:**

- Explicit state transitions in identity initialization:
  - UNINITIALIZED → WAITING_FOR_BACKGROUND (started tab ID request)
  - WAITING_FOR_BACKGROUND → TAB_ID_RECEIVED (background responded)
  - TAB_ID_RECEIVED → IDENTITY_READY (all prerequisites met) OR IDENTITY_READY
    (container unknown, fallback applied)
- Whether final state is FULLY_READY or PARTIALLY_READY (unknown container)

**Current State:** No explicit state machine; transitions are implicit and
unlogged.

**Impact:** Cannot determine which identity prerequisites were missing when a
failure occurred.

**Example Log Entry That Should Exist:**

```
[Storage-Identity] STATE_TRANSITION: UNINITIALIZED → WAITING_FOR_BACKGROUND
[Storage-Identity] STATE_TRANSITION: WAITING_FOR_BACKGROUND → TAB_ID_RECEIVED (tabId=12345)
[Storage-Identity] STATE_TRANSITION: TAB_ID_RECEIVED → IDENTITY_READY (containerId available)
```

**Acceptance Criterion:** Every decision point that checks `currentWritingTabId`
or `currentWritingContainerId` should have accompanied logging showing whether
each value was UNKNOWN / KNOWN / NULL_LEGACY.

---

## Section 2: Hydration Flow Diagnostics (Issues A, O, P)

### Gap 2.1: No Complete Hydration Trace

**What Should Be Logged at Each Hydration Step:**

1. `storage.onChanged` event received (key changed, old value, new value sizes)
2. Identity state at receipt time (tabId status, containerId status)
3. Ownership filtering decision (originTabId vs currentWritingTabId comparison,
   result)
4. Container filtering decision (originContainerId vs currentWritingContainerId,
   legacy check, result)
5. Quick Tab count before hydration, count after hydration
6. Timestamp and correlation ID tying all steps together

**Current State:** No unified hydration trace; log statements scattered without
correlation.

**Impact:** Operator cannot trace why Quick Tab appeared in wrong tab or
container.

**Example Log Entry That Should Exist:**

```
[Hydration] TRACE_ID=hyd-2025-12-19T12:45:23.200Z-abc123
[Hydration] STORAGE_CHANGED: key=quickTabs, oldSize=1024B, newSize=2048B
[Hydration] IDENTITY_STATE: tabId=KNOWN(12345), containerId=KNOWN(firefox-container-1)
[Hydration] OWNERSHIP_FILTER: originTabId=12346, currentTabId=12345 → REJECTED
[Hydration] CONTAINER_FILTER: originContainerId=firefox-container-1, currentContainerId=firefox-container-1 → ACCEPTED
[Hydration] DOM_UPDATE: count_before=3, count_after=4, new_quick_tab_id=qt-abc123
```

**Acceptance Criterion:** Every hydration event produces a single TRACE entry
correlating all filtering decisions.

---

### Gap 2.2: No Migration Trace During Adapter Load

**What Should Be Logged:**

- Format detection (unified vs. container vs. legacy)
- Migration decision and reason
- Atomic migration success/failure
- Versioning info if format version exists

**Current State:** `SyncStorageAdapter.load()` has no logging; migration is
silent.

**Impact:** Cannot confirm whether data was migrated or lost (Issue P).

**Example Log Entry That Should Exist:**

```
[StorageAdapter] LOAD: Checking format type
[StorageAdapter] FORMAT_DETECTED: unified_v2 found at key=quickTabs
[StorageAdapter] RETURNING: unified_v2 data (count=42 tabs)

OR

[StorageAdapter] FORMAT_DETECTED: container format found (legacy_v1)
[StorageAdapter] MIGRATION: Converting container format → unified format
[StorageAdapter] MIGRATION_COMPLETE: atomic write succeeded
[StorageAdapter] RETURNING: migrated data (count=42 tabs)
```

**Acceptance Criterion:** Every load operation logs which format was detected
and whether migration occurred.

---

## Section 3: Storage Write Pipeline Diagnostics (Issues C, D, F, M)

### Gap 3.1: No Write Lifecycle Tracing

**What Should Be Logged:**

- When write is queued (caller, reason, data size)
- When write execution starts (attempt number, current queue depth)
- When write completes (success/failure, duration)
- If write fails, error classification (quota, permission, transient, unknown)

**Current State:** `_executeStorageWrite()` logs generically; no structured
lifecycle.

**Impact:** Cannot trace why a write failed or why queue stalled.

**Example Log Entry That Should Exist:**

```
[StorageWrite] QUEUED: caller=feature:quick-tabs, reason=user_closed_tab, size_bytes=1024
[StorageWrite] EXECUTE_START: attempt=1, queue_depth=0, retry_attempt=0
[StorageWrite] EXECUTE_SUCCESS: duration_ms=45, bytes_written=1024, storage_bytes_used_now=4096000
[StorageWrite] QUOTA_CHECK: available_quota_mb=6.0, write_size_mb=0.001, headroom_percent=60%
```

**Acceptance Criterion:** Every write produces a complete lifecycle trace with
attempt number and error classification.

---

### Gap 3.2: No Quota Monitoring Telemetry

**What Should Be Logged:**

- At each write, current bytes-in-use (from `navigator.storage.estimate()`)
- Quota limit and headroom percentage
- If approaching limit (>90%), explicit warning
- If quota exceeded, detailed error with current state size estimate

**Current State:** No quota checks at all (Issue M).

**Impact:** Silent write failures when quota exceeded; no user notification.

**Example Log Entry That Should Exist:**

```
[QuotaMonitor] ESTIMATE: bytes_used=8500000, quota_limit=10485760, headroom=19.4%
[QuotaMonitor] WARNING: Quota headroom low (19%), pruning old tabs recommended

OR

[QuotaMonitor] WRITE_FAILED: QuotaExceededError
[QuotaMonitor] QUOTA_EXCEEDED: bytes_used=10485760, quota_limit=10485760, state_size_estimate=15MB+
[QuotaMonitor] ACTION: Write rejected, state persisted to IndexedDB fallback
```

**Acceptance Criterion:** Storage estimate is checked before every write; quota
conditions are logged.

---

### Gap 3.3: No Queue State Transitions

**What Should Be Logged:**

- Queue ENQUEUE, DEQUEUE_START, DEQUEUE_SUCCESS, DEQUEUE_FAILURE, QUEUE_RESET
  events
- For each transition, queue depth before and after
- For QUEUE_RESET, reason (timeout, unload, error threshold, explicit)

**Current State:** Queue state is not logged; stuck queues are not detected.

**Impact:** Cannot confirm if queue stalled or when it recovered (Issue F).

**Example Log Entry That Should Exist:**

```
[StorageQueue] ENQUEUE: txn_id=txn-123, queue_depth_before=0, queue_depth_after=1
[StorageQueue] DEQUEUE_START: txn_id=txn-123, queue_depth=1
[StorageQueue] DEQUEUE_SUCCESS: txn_id=txn-123, duration_ms=50
[StorageQueue] QUEUE_EMPTY: last_success_timestamp=2025-12-19T12:45:24.100Z

OR

[StorageQueue] DEQUEUE_FAILURE: txn_id=txn-123, error=timeout, duration_ms=5000
[StorageQueue] QUEUE_RESET: reason=dequeue_timeout, pending_txn_count=3, age_of_oldest_ms=8500
```

**Acceptance Criterion:** Queue state is logged at every transition; stuck
detection triggers warning.

---

## Section 4: Event Ordering & Concurrency Diagnostics (Issues N, R, U)

### Gap 4.1: No storage.onChanged Event Sequence Logging

**What Should Be Logged:**

- Receive timestamp of each storage.onChanged event
- Sequence number assigned by content script
- Changes included in event (which keys changed, old/new sizes)
- Processing timestamp and duration
- Whether event was skipped due to isSelfWrite()

**Current State:** Event listeners have no sequence numbers; events are
processed silently.

**Impact:** Cannot detect if events arrived out-of-order (Issue N).

**Example Log Entry That Should Exist:**

```
[StorageEvent] RECEIVED: seq_id=1, timestamp_rcvd=2025-12-19T12:45:24.100Z, changes={quickTabs}
[StorageEvent] PROCESS_START: seq_id=1, timestamp_process_start=2025-12-19T12:45:24.102Z
[StorageEvent] SELF_WRITE_CHECK: seq_id=1, result=false (not self write)
[StorageEvent] PROCESS_COMPLETE: seq_id=1, duration_ms=3, new_qt_count=5

[StorageEvent] RECEIVED: seq_id=2, timestamp_rcvd=2025-12-19T12:45:23.950Z, changes={quickTabs}
[StorageEvent] OUT_OF_ORDER_DETECTED: expected_min_seq=2, received_seq=2, but_timestamp_earlier=150ms
```

**Acceptance Criterion:** Every storage event is timestamped and sequenced;
out-of-order detection logs a warning.

---

### Gap 4.2: No Port Message Sequence Validation Logging

**What Should Be Logged:**

- Outgoing port messages with assigned sequence ID
- Incoming port messages with their sequence ID
- Sequence number validation result (in-order, out-of-order, or duplicate)

**Current State:** Sequence tracking exists (v1.6.3.10-v7) but is
informational-only.

**Impact:** Out-of-order operations execute without notice; failures are not
attributed to ordering (Issue R).

**Example Log Entry That Should Exist:**

```
[PortMessage] SEND: type=RESTORE_QUICK_TAB, seq_id=1, qt_id=qt-abc123
[PortMessage] RECV: type=RESTORE_RESPONSE, seq_id=1, timestamp_latency_ms=120

[PortMessage] SEND: type=RESTORE_QUICK_TAB, seq_id=2, qt_id=qt-def456
[PortMessage] RECV: type=RESTORE_RESPONSE, seq_id=3, error=OUT_OF_SEQUENCE (expected_max=2)
```

**Acceptance Criterion:** Every port message is logged with sequence ID and
validation result.

---

### Gap 4.3: No Rapid-Fire Event Coalescing Telemetry

**What Should Be Logged:**

- When multiple writes are queued in short time window (rate limiting signal)
- Coalescing decision (why writes were combined or deduplicated)
- Reason for coalescing (hash unchanged, rate limit, debounce)

**Current State:** No rate limiting (Issue H); no coalescing telemetry.

**Impact:** Cannot see if event storms are happening or being mitigated (Issue U
energy).

**Example Log Entry That Should Exist:**

```
[RateLimit] HIGH_FREQUENCY_WRITES: 5 writes queued in 50ms, source=drag_resize_listener
[RateLimit] COALESCE: Combining writes 1–3 (hash identical), keeping write 5 (different hash)
[RateLimit] DEDUP: Write 2 matches write 1, rejecting duplicate
```

**Acceptance Criterion:** High-frequency write sources are detected and logged;
coalescing decisions are explained.

---

## Section 5: Ownership & Container Filtering Diagnostics (Issues E, G, Q, S)

### Gap 5.1: No originTabId Validation Logging

**What Should Be Logged:**

- When originTabId is normalized, log raw value and normalized result
- If normalization rejects value, log rejection reason (NULLISH, NAN,
  NON_INTEGER, etc.)
- Whether normalizer is being called from tab context or background context

**Current State:** `normalizeOriginTabId()` has no logging; failures are silent.

**Impact:** Cannot diagnose originTabId corruption (Issue E).

**Example Log Entry That Should Exist:**

```
[OwnershipValidation] NORMALIZE: raw_value="12345" (type=string)
[OwnershipValidation] NORMALIZE_RESULT: normalized=12345, normalized_type=number, context=content_script_tab

OR

[OwnershipValidation] NORMALIZE: raw_value="abc" (type=string)
[OwnershipValidation] NORMALIZE_REJECTED: reason=NAN, source_quick_tab_id=qt-xyz
[OwnershipValidation] NORMALIZE_CONTEXT: current_context=background, expected_context=content_script
```

**Acceptance Criterion:** Every normalization attempt is logged with input,
output, and rejection reason.

---

### Gap 5.2: No Container Match Logging (Fallback Detection)

**What Should Be Logged:**

- Container matching decision at every point where filtering is applied
- Whether match used strict rule or legacy fallback
- Current container ID state (KNOWN / UNKNOWN / LEGACY_NULL)

**Current State:** `_isContainerMatch()` has no logging; permissive fallback is
silent.

**Impact:** Cannot confirm whether cross-container leak occurred due to fallback
(Issue G, S).

**Example Log Entry That Should Exist:**

```
[ContainerFilter] MATCH_CHECK: originContainerId=firefox-container-1, currentContainerId=firefox-container-1
[ContainerFilter] MATCH_RESULT: true (strict match)

OR

[ContainerFilter] MATCH_CHECK: originContainerId=firefox-container-1, currentContainerId=UNKNOWN
[ContainerFilter] MATCH_RESULT: true (LEGACY_FALLBACK: container unknown during init)
[ContainerFilter] WARNING: Using fallback during identity-not-ready window
```

**Acceptance Criterion:** Every container match decision logs which rule applied
and whether fallback was used.

---

### Gap 5.3: No Ownership Filtering Attribution

**What Should Be Logged:**

- At hydration time, list of all Quick Tabs considered and their ownership check
  result
- For each tab, why it was accepted/rejected (OWNER_MATCH, OWNER_MISMATCH,
  ADOPTION, ORPHAN_POLICY, CONTAINER_MISMATCH)

**Current State:** Filtering logic has no logging; filtering decisions are
silent.

**Impact:** Cannot trace why Quick Tab did or did not hydrate (Issues 11, 12,
14).

**Example Log Entry That Should Exist:**

```
[Hydration-Ownership] FILTER_BATCH: considering=5 quick_tabs
[Hydration-Ownership] QT_ID=qt-abc → originTabId=12345, currentTabId=12345 → ACCEPTED (strict match)
[Hydration-Ownership] QT_ID=qt-def → originTabId=12346, currentTabId=12345 → REJECTED (TABID_MISMATCH)
[Hydration-Ownership] QT_ID=qt-ghi → originTabId=12346, originContainerId=firefox-container-1, currentContainerId=firefox-default → REJECTED (CONTAINER_MISMATCH)
[Hydration-Ownership] RESULT: 1 of 5 quick_tabs hydrated
```

**Acceptance Criterion:** Every hydration produces a filtered batch report
showing which tabs were accepted/rejected and why.

---

## Section 6: Transaction & Error Recovery Diagnostics (Issues C, J, V, W)

### Gap 6.1: No Transaction Lifecycle Logging

**What Should Be Logged:**

- When transaction begins (snapshot captured, transaction ID assigned)
- When transaction commits (success)
- When transaction rolls back (reason, what was restored)

**Current State:** Transaction methods exist but are unused; no logging.

**Impact:** Dead code (Issue V) is undetected; rollback is never triggered.

**Example Log Entry That Should Exist:**

```
[Transaction] BEGIN: txn_id=txn-2025-12-19T12:45:23.100Z, snapshot_size=2048B
[Transaction] COMMIT: txn_id=txn-2025-12-19T12:45:23.100Z, duration_ms=50

OR

[Transaction] ROLLBACK: txn_id=txn-2025-12-19T12:45:23.100Z, reason=write_failed, restoring_snapshot_size=2048B
[Transaction] SNAPSHOT_RESTORED: txn_id=txn-2025-12-19T12:45:23.100Z, state_size_now=2048B
```

**Acceptance Criterion:** Every transaction begin/commit/rollback is logged;
usage is detected (not dead code).

---

### Gap 6.2: No Error Classification Logging

**What Should Be Logged:**

- When storage operation fails, log error type classification (QUOTA_EXCEEDED,
  PERMISSION_DENIED, UNAVAILABLE, TRANSIENT, UNKNOWN)
- Error message, code if available
- Retry strategy chosen based on error type

**Current State:** `browser-api.js` has generic error handling; no
classification.

**Impact:** Cannot distinguish quota failure from permission failure from
transient failure (Issue C).

**Example Log Entry That Should Exist:**

```
[StorageError] OPERATION_FAILED: operation=set, error_message=QuotaExceededError: quota exceeded
[StorageError] CLASSIFICATION: QUOTA_EXCEEDED
[StorageError] RECOVERY_STRATEGY: REJECT_WRITE (quota exhausted, no retry)
[StorageError] AFFECTED_KEYS: [quickTabs]

OR

[StorageError] OPERATION_FAILED: operation=get, error_message=browser.storage is unavailable
[StorageError] CLASSIFICATION: TRANSIENT
[StorageError] RECOVERY_STRATEGY: RETRY_WITH_BACKOFF (attempt 1/5)
```

**Acceptance Criterion:** Every storage error is classified and recovery
strategy is logged.

---

### Gap 6.3: No Retry Backoff Attempt Logging

**What Should Be Logged:**

- When retry backoff is initiated (which attempt, delay)
- When retry executes (attempt number, result)
- When retry sequence succeeds or exhausts

**Current State:** Retry logic exists but has no logging; state is not tracked
across restarts (Issue W).

**Impact:** Cannot see if retries are helping or if backoff is effective.

**Example Log Entry That Should Exist:**

```
[Retry] BACKOFF_INITIATED: operation=storage_write, attempt_1_failed_with=transient_error
[Retry] BACKOFF_DELAY: attempt=2, delay_ms=100, backoff_multiplier=1.5
[Retry] RETRY_EXECUTE: attempt=2, timestamp=2025-12-19T12:45:24.200Z
[Retry] RETRY_SUCCESS: attempt=2, total_duration_ms=150

OR

[Retry] BACKOFF_EXHAUSTED: operation=storage_write, attempts=5, last_error=timeout
[Retry] PERMANENT_FAILURE: Marking storage as unavailable
```

**Acceptance Criterion:** Every retry attempt is logged with attempt number and
outcome; retry exhaustion triggers permanent failure flag.

---

## Section 7: Subscription & Lifecycle Diagnostics (Issue B)

### Gap 7.1: No Subscription Lifecycle Logging

**What Should Be Logged:**

- When subscription is created (subscriber key, component name, listener ID)
- When subscription fires (listener ID, state change details)
- When subscription is disposed (listener ID, reason)

**Current State:** `StateManager` has no subscription logging; teardown is not
tracked.

**Impact:** Cannot detect orphan listeners or verify cleanup (Issue B).

**Example Log Entry That Should Exist:**

```
[Subscription] CREATED: key=quickTabsState, component=quick_tabs_manager, listener_id=sub-001
[Subscription] FIRED: listener_id=sub-001, old_value_size=1024B, new_value_size=2048B
[Subscription] DISPOSED: listener_id=sub-001, reason=feature_disabled, active_listeners_before=3, after=2

OR

[Subscription] TEARDOWN_COMPLETE: total_listeners_disposed=5, remaining_active=0 (expected)
[Subscription] TEARDOWN_WARNING: remaining_active=2 (expected 0), listener_ids=[sub-003, sub-004]
```

**Acceptance Criterion:** Every subscription has lifecycle logging; teardown
produces active listener count.

---

### Gap 7.2: No Memory Leak Detection Telemetry

**What Should Be Logged:**

- Periodically (every N page navigations or N seconds), count active
  subscriptions
- If count increases monotonically, issue warning
- At unload, log expected vs. actual active subscription count

**Current State:** No telemetry; leaks are silent.

**Impact:** Cannot detect if subscriptions are accumulating (Issue B).

**Example Log Entry That Should Exist:**

```
[MemoryTelemetry] SUBSCRIPTION_COUNT: active=3, navigation_count=5 (session avg=2)
[MemoryTelemetry] WARNING: Subscription count higher than average, possible leak

[Content-Unload] LISTENER_CLEANUP: active_listeners_at_unload=0 (expected), teardown_reason=page_unload
OR
[Content-Unload] LISTENER_CLEANUP_WARNING: active_listeners_at_unload=2 (expected=0), orphan_listener_ids=[sub-001, sub-002]
```

**Acceptance Criterion:** Subscription counts are monitored; unload cleanup is
verified.

---

## Section 8: Self-Write Detection Diagnostics (Issue T)

### Gap 8.1: No Heuristic Match Attribution

**What Should Be Logged:**

- Which heuristic(s) matched in `isSelfWrite()` call
- If multiple heuristics matched, which was prioritized
- If heuristics conflicted, log warning with values

**Current State:** `isSelfWrite()` returns boolean; no info on which heuristic
matched.

**Impact:** Cannot debug self-write detection conflicts (Issue T).

**Example Log Entry That Should Exist:**

```
[SelfWrite] CHECK: newValue.transactionId=txn-123, lastWritten=txn-123, instanceId=inst-A, current=inst-B, tabId=5, current=5
[SelfWrite] HEURISTIC_MATCH: transactionId (yes), instanceId (no), tabId (yes)
[SelfWrite] PRIORITY_ORDER: transactionId > instanceId > tabId
[SelfWrite] RESULT: true (transactionId matched, highest priority)

OR

[SelfWrite] HEURISTIC_CONFLICT: transactionId matched but instanceId didn't (tab reloaded?)
[SelfWrite] RESULT: true (using primary heuristic transactionId)
[SelfWrite] WARNING: Conflicting heuristics suggest state inconsistency
```

**Acceptance Criterion:** Every self-write decision logs which heuristics
matched and which was chosen.

---

## Section 9: Diagnostic Aggregation (Cross-Cutting)

### Gap 9.1: No Unified State Lifecycle Trace

**What Should Be Logged:** A single trace entry correlating entire lifecycle
from user action → persist → storage.onChanged → hydrate:

```
[LifecycleTrace] TRACE_ID=cycle-2025-12-19T12:45:23.100Z-xyz
[LifecycleTrace-Action] Trigger: user_closed_quick_tab qt-abc123
[LifecycleTrace-Persist] PERSIST_START: caller=quick_tab_close, data_size=1024B
[LifecycleTrace-Persist] PERSIST_SUCCESS: duration_ms=50
[LifecycleTrace-StorageEvent] STORAGE_EVENT_RECEIVED: seq=1, latency_from_write=10ms
[LifecycleTrace-Hydrate] HYDRATION: identity_state=READY, ownership_result=ACCEPTED, final_count=4
[LifecycleTrace-Complete] Total cycle time=100ms
```

**Current State:** Logs are scattered; no correlation ID across steps.

**Impact:** Operator must manually correlate logs across time and modules;
traces are error-prone.

**Acceptance Criterion:** Every complete state transition produces a single
TRACE_ID entry at each major step.

---

## Section 10: Logging Standards & Implementation

### Logging Format Requirements

Every log entry should include:

- **Timestamp** (ISO 8601 format: 2025-12-19T12:45:23.123Z)
- **Component** (e.g., `[Storage]`, `[Hydration]`, `[Ownership]`)
- **Level** (DEBUG, INFO, WARN, ERROR)
- **Message** (short human-readable description)
- **Structured Data** (key-value pairs for programmatic parsing)

### Logging Levels

- **DEBUG:** Low-level traces (every event, high-frequency logging)
- **INFO:** Major transitions (lifecycle events, decisions, state changes)
- **WARN:** Unexpected conditions (fallback usage, heuristic conflicts, resource
  constraints)
- **ERROR:** Failures (write failed, error classification)

### Correlation IDs

Every major operation should have a correlation ID that ties together related
log entries:

- Hydration: `hyd-2025-12-19T12:45:23.100Z-{randomSuffix}`
- Write: `write-2025-12-19T12:45:23.100Z-{randomSuffix}`
- Transaction: `txn-2025-12-19T12:45:23.100Z-{randomSuffix}`

### Sampling & Aggregation

To prevent log spam:

- Storage estimate telemetry: log every 10th write (10% sample)
- Subscription count telemetry: log every page navigation (or every 30 seconds)
- Event sequences: log at INFO level; DEBUG only under debugMode

---

## Acceptance Criteria: Logging Infrastructure

- [ ] Every identity initialization step is logged with timestamp and values
- [ ] Hydration produces complete trace showing filtering decisions
- [ ] Storage quota is checked and logged before writes
- [ ] Queue state transitions are logged with depth
- [ ] Storage.onChanged events have sequence numbers and order validation
- [ ] Port messages logged with sequence IDs and ordering validation
- [ ] Ownership/container decisions logged with match rule and fallback usage
- [ ] Transaction lifecycle fully logged (BEGIN / COMMIT / ROLLBACK)
- [ ] Storage errors classified and retry strategy logged
- [ ] Subscriptions tracked with lifecycle logging and teardown verification
- [ ] Self-write heuristic matches and conflicts logged
- [ ] Unified lifecycle traces use correlation IDs

---

## Implementation Priority

1. **Critical (P0):** Identity initialization, hydration trace, storage quota,
   error classification
2. **High (P1):** Queue state, storage events, ownership filtering, transaction
   lifecycle
3. **Medium (P2):** Subscription tracking, retry backoff, self-write heuristics,
   correlation IDs
4. **Low (P3):** Telemetry sampling, fine-grained event logging, debug-mode
   enhancements
