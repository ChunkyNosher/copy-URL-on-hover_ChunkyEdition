# Quick Tabs (Tab-Scoped Model v1.6.3+): Codebase Defects + Missing Logging (Audit)

**Extension Version:** v1.6.3.10-v8 (latest scanned) | **Date:** 2025-12-19 |
**Scope:** Storage persistence + hydration + ownership/container isolation +
lifecycle cleanup, as measured against `issue-47-revised.md` scenarios

---

## Executive Summary

Multiple failure modes remain possible even after the v1.6.3+ “tab-scoped”
architecture: **state may hydrate before tab/container identity is known**,
**storage write loops can still happen under specific timing**,
**queue/transaction recovery can stall on unload**, and **diagnostics are still
missing in the exact places needed to confirm causal chains**.

These problems directly threaten the behavioral guarantees in
`issue-47-revised.md`, especially Scenario 11 (originTabId hydration filtering),
Scenario 14 (container isolation), Scenario 17 (rapid switching emergency save),
Scenario 10 (restart persistence), and Scenario 12 (tab closure cleanup).

---

## Issues Overview

| ID  | Issue (Short)                                                                   |          Primary Component |    Severity | Breaks which `issue-47-revised.md` scenarios |
| --- | ------------------------------------------------------------------------------- | -------------------------: | ----------: | -------------------------------------------- |
| A   | Hydration/storage-change path can run before async prerequisites settle         |          Storage/Hydration |    Critical | 10, 11, 17                                   |
| B   | StateManager subscriptions lack lifecycle cleanup → leaks + ghost callbacks     |                 Core state |        High | 17, long-session stability                   |
| C   | Storage API wrapper errors are undifferentiated (quota vs perm vs transient)    |           Core browser API |        High | 10, 21                                       |
| D   | No storage quota / bytes-in-use monitoring before writes                        |                    Storage |        High | 10, 21                                       |
| E   | originTabId normalization accepts “number-ish” corrupted values                 |          Storage ownership |        High | 11, 12, 14                                   |
| F   | Write queue can stall on unload/timeout edge cases                              |              Storage queue |    Critical | 17, 10                                       |
| G   | Container match logic “current container unknown” is permissive                 |        Container isolation |    Critical | 14, 18                                       |
| H   | No write rate-limiting before queue/circuit breaker thresholds                  |        Storage performance | Medium/High | 17, general responsiveness                   |
| I   | Duplicate-saveId loop detection window may miss long cascades                   | Diagnostics/loop detection |      Medium | 17, stability                                |
| J   | Transaction snapshot rollback exists but appears unused/untriggered             |        Storage transaction |      Medium | 10, 17 (recovery)                            |
| K   | Orphan adoption risk: ownership model doesn’t confirm “owner tab still exists”  |                  Ownership |      Medium | 12, 10                                       |
| L   | Transaction ID generation can proceed with tabId “0” state (identity not ready) |            Storage txn IDs |      Medium | 11, diagnostics accuracy                     |

---

<scope>
**Modify (in-scope targets):**
- `src/utils/storage-utils.js` (ownership validation, container matching, queue/transaction lifecycle, hydration gating hooks, diagnostic logging)
- `src/core/state.js` (subscription lifecycle + teardown)
- `src/core/browser-api.js` (error classification + structured logging)

**Do NOT Modify (out of scope for this report):**

- Any unrelated feature logic not involved in Quick Tabs state
  persistence/hydration
- Build tooling / CI config </scope>

---

## Issue A: Hydration / storage-change processing can run before async prerequisites settle

### Problem

Hydration and storage-change handling can execute while **tab identity (tabId)
and container identity (cookieStoreId)** are still unknown, causing
mis-filtering and “wrong tabs/containers” eligibility decisions.

### Root Cause (probable)

**File:** `src/utils/storage-utils.js`  
**Locations:** `waitForTabIdInit()`, `validateOwnershipForWrite()`, container
logic paths, and any storage-change consumers that act before identity is
ready.  
**Issue:** The module contains mechanisms to “wait” for initialization, but the
overall architecture still permits flows where storage changes are handled
before identity is known, especially during early page load and rapid
navigation.

### Fix Required (high-level)

Add an explicit “**identity-ready gating**” rule for any code path that:

- applies hydrated state to DOM,
- performs ownership filtering,
- performs container filtering,
- or persists state.

### Missing Logging

Add single-line structured logs that clearly answer:

- “Was tabId initialized at time of hydration?”
- “Was containerId initialized at time of hydration?”
- “Did we block hydration because identity was unknown (fail-closed), or did we
  allow it (fail-open)?”

---

## Issue B: StateManager subscription cleanup is not enforced

### Problem

Listeners are added but not systematically cleaned up on content-script
teardown, page navigation, or feature disable, risking memory leaks and
callbacks firing after state is no longer valid.

### Root Cause

**File:** `src/core/state.js`  
**Location:** `subscribe()` returns an unsubscribe closure, but there’s no
centralized teardown ensuring these are invoked.  
**Issue:** In long sessions or frequent navigation, orphan listeners accumulate.

### Fix Required (high-level)

Introduce a lifecycle policy ensuring every subscription is tracked and disposed
on teardown/unload/navigation boundaries.

### Missing Logging

- Add logging when subscriptions are created (include key, feature/component,
  and a lightweight listener id).
- Add logging when subscriptions are disposed.
- Add a warning log if teardown occurs with non-zero active listener count.

---

## Issue C: Storage wrapper does not classify error types

### Problem

Storage failures are treated uniformly, preventing correct remediation
strategies (retry vs stop vs user-visible error).

### Root Cause

**File:** `src/core/browser-api.js`  
**Locations:** `getStorage()`, `setStorage()`, `removeStorage()`,
`clearStorage()`  
**Issue:** Errors are logged generically and rethrown without classification
(quota, permissions, API missing, transient).

### Fix Required (high-level)

Add error classification and emit a consistent “storage error event” payload
used by Quick Tabs code to decide:

- retry with backoff,
- stop and trip “permanent failure” mode,
- or prompt user.

### Missing Logging

- Log a normalized error category (e.g., QUOTA / PERMISSION / UNAVAILABLE /
  TRANSIENT / UNKNOWN).
- Include operation type (get/set/remove/clear), key count, bytes estimate (if
  available), and whether a retry will occur.

---

## Issue D: No storage quota / bytes-in-use monitoring

### Problem

Quick Tabs state can grow (Scenario 21), but there’s no proactive monitoring to
prevent quota-based write failures and silent degradation.

### Root Cause

**File:** `src/utils/storage-utils.js` and related persistence call sites  
**Issue:** Writes proceed without checking bytes-in-use or available quota
headroom.

### Fix Required (high-level)

Add a preflight check (or periodic telemetry) to detect approaching quota and
apply a policy:

- refuse new writes with a clear diagnostic,
- compact legacy fields,
- or rotate / prune safely (must not violate `issue-47-revised.md`
  expectations).

### Missing Logging

- Log bytes-in-use (or best-effort estimate) at persistence time at a low
  sampling rate.
- On quota-related failures, log: “quota exceeded likely” + current state size
  estimate + count of tabs persisted.

---

## Issue E: originTabId normalization is vulnerable to “number-ish corruption”

### Problem

Corrupted origin identifiers can be mistakenly accepted if they convert to a
valid integer, which breaks isolation guarantees.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `normalizeOriginTabId()`  
**Issue:** Normalization uses numeric conversion and validates integer > 0, but
“number-ish strings” may still slip through in ways that conceal upstream
corruption and complicate diagnosis.

### Fix Required (high-level)

Tighten identity parsing rules so only known-good representations are accepted,
and corruption is rejected loudly (fail-closed) with diagnostic breadcrumbs.

### Missing Logging

- Add “normalization rejection reason codes” (NULLISH / NAN / NON_INTEGER /
  OUT_OF_RANGE / MALFORMED_STRING).
- When a value is rejected, log a compact record containing: quickTabId (if
  present), raw value, raw type, and where it came from (deserialize/serialize
  path).

---

## Issue F: Storage write queue can stall on unload/timeout edge cases

### Problem

Under certain failure modes (tab closes mid-write, extension context unloads,
Promise.race timeout behavior), the serialized write queue can become stuck and
never drain, producing cascading “blocked” behavior and/or persistent desync.

### Root Cause (probable)

**File:** `src/utils/storage-utils.js`  
**Locations:** `queueStorageWrite()`, `_executeStorageWrite()`, fallback cleanup
timers.  
**Issue:** The design assumes a narrow set of rejection paths for queue reset;
lifecycle-driven aborts don’t necessarily follow those paths.

### Fix Required (high-level)

Ensure the queue has explicit recovery logic for:

- content-script unload,
- extension context invalidation,
- aborted storage operations,
- and unhandled timeouts.

### Missing Logging

- Log queue state transitions: enqueue, dequeue start, dequeue success/failure,
  queue reset reason.
- Log unload-triggered cleanup actions (clear timers, clear pending txn ids,
  decrement pending counters).
- Log “queue stuck detection” (e.g., no progress for N ms) with the last known
  transaction id and last success timestamp.

---

## Issue G: Container matching is permissive when current container is unknown

### Problem

When the current containerId is not yet known, the system may temporarily treat
container boundaries as matching, risking cross-container leakage during early
hydration (Scenario 14/18).

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** container match helper logic (e.g., the “current container unknown
→ allow” fallback).  
**Issue:** A permissive fallback is safe for backwards compatibility, but it is
unsafe during identity-not-ready windows.

### Fix Required (high-level)

Make container isolation **fail-closed until identity is known**, while
preserving legacy compatibility for stored records with no container id
(explicitly distinguish “legacy null” vs “not initialized”).

### Missing Logging

- Log whether container matching is operating in: INITIALIZING / READY /
  LEGACY_FALLBACK mode.
- Log when a tab is allowed to modify/hydrate due to legacy fallback vs true
  container match.

---

## Issue H: No rate-limiting prior to queue/circuit breaker threshold

### Problem

Rapid UI events (dragging/resizing, Scenario 17) can enqueue many writes
quickly, increasing risk of backlog, timing races, and degraded
responsiveness—even if a true infinite loop is not present.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `queueStorageWrite()`, write callers that fire on high-frequency
UI events.  
**Issue:** A circuit breaker exists, but there’s insufficient upstream
throttling/debouncing policy for event storms.

### Fix Required (high-level)

Add a write scheduling policy ensuring high-frequency UI updates coalesce to a
smaller number of durable writes without changing observed behavior.

### Missing Logging

- Log when writes are coalesced/deduped (include reason: “rate limit”,
  “debounce”, “hash unchanged”).
- Log when high-frequency write sources are detected (drag/resize).

---

## Issue I: Duplicate saveId write detection window may miss longer cascades

### Problem

Loop detection based on a short time window can miss cascades when the
environment is slower (busy system, storage delays, or heavy tab load).

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `_trackDuplicateSaveIdWrite()` windowing constants.  
**Issue:** The window is shorter than some of the timeouts/backoffs and may not
represent worst-case event latency.

### Fix Required (high-level)

Align duplicate tracking windows with worst-case storage timing and
lifecycle-driven delays so loop detection remains reliable.

### Missing Logging

- When a duplicate is detected, log: first-seen timestamp, current timestamp,
  elapsed, and whether it coincides with storage timeout warnings.

---

## Issue J: Transaction snapshot/rollback appears unused (recovery mechanism incomplete)

### Problem

The code contains a transaction/snapshot/rollback mechanism, but it appears not
integrated into real failure paths, meaning recovery from partial failure may
not occur.

### Root Cause (probable)

**File:** `src/utils/storage-utils.js`  
**Location:** `beginTransaction()`, `rollbackTransaction()`,
`commitTransaction()` and call graph.  
**Issue:** Lack of a “policy” for when rollback is invoked and how it interacts
with ownership validation and queue execution.

### Fix Required (high-level)

Define and enforce the rollback policy (what triggers it, what it restores, and
how to prevent re-trigger loops).

### Missing Logging

- Log transaction lifecycle at INFO level: BEGIN / COMMIT / ROLLBACK with
  correlation IDs.
- Log why rollback triggered (validation failure, write failure after retries,
  etc.).

---

## Issue K: Orphan adoption risk (ownership model doesn’t confirm owner tab identity continuity)

### Problem

If a tab that “owned” Quick Tabs closes, future tabs could theoretically reuse
identifiers or create ambiguous adoption scenarios. Even if tab IDs are
typically not reused quickly, the system lacks explicit orphan lifecycle rules.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** ownership validation + state model does not appear to include an
“owner session identity” stronger than tabId/containerId.  
**Issue:** Ownership is defined by tabId (+ containerId), but there’s no
explicit “tab instance” identity that survives across navigations/restarts in a
deterministic way.

### Fix Required (high-level)

Define an orphan policy that preserves the behavior expectations in
`issue-47-revised.md` while preventing accidental adoption when identity
continuity is unclear.

### Missing Logging

- When ownership checks pass, log whether it was by strict match or fallback
  policy.
- When tabs are filtered out, log a compact reason: TABID_MISMATCH /
  CONTAINER_MISMATCH / ORPHAN_POLICY.

---

## Issue L: Transaction ID generation can occur before tab identity is initialized

### Problem

Diagnostics and correlation can become misleading if transaction IDs embed a
placeholder tabId (e.g., “0”), or if identity isn’t ready during the earliest
persistence attempts.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** `generateTransactionId()` uses `currentWritingTabId ?? 0`.  
**Issue:** Using a non-real tabId in transaction identity makes debugging and
self-write checks less reliable during critical early lifecycle windows.

### Fix Required (high-level)

Enforce a consistent “identity-ready before persistence” invariant (or clearly
label transaction IDs as “identity unknown” so downstream logic can refuse them
safely).

### Missing Logging

- Log when a transaction ID is generated without a known tabId (and whether
  write was blocked or allowed).
- Log correlation fields consistently: transactionId, writingInstanceId,
  writingTabId, originTabId, originContainerId.

---

## Shared Diagnostic / Logging Gaps (Cross-Cutting)

These are not new functional bugs, but they block root-cause confirmation:

- Missing an explicit, unified “**Quick Tabs state lifecycle trace**” across:
  hydrate → render → user action → persist → storage.onChanged → rehydrate (if
  any).
- Missing “**who triggered this write**” attribution at the call sites that
  invoke persistence (a lightweight caller tag is sufficient; no need for stacks
  everywhere).
- Missing “**identity readiness state**” (tabId/containerId) at every decision
  point that filters owned tabs or allows/blocks writes.

---

<acceptance_criteria>

- [ ] Scenario 11 (Hydration on Page Reload): Only Quick Tabs owned by the
      current tab+container hydrate; no transient cross-tab/container flash
      during initialization.
- [ ] Scenario 14 + 18 (Container Isolation): Quick Tabs never appear across
      containers, including during early page load; legacy records without
      containerId remain handled deterministically.
- [ ] Scenario 17 (Rapid Tab Switching): No storage write queue stall; emergency
      save does not create backlog storms; system remains responsive.
- [ ] Scenario 10 (Browser Restart Persistence): State restores reliably; if
      storage quota prevents writes, the failure is surfaced with a clear
      diagnostic and no silent corruption.
- [ ] No persistent growth in listener count across repeated navigations (leak
      prevention).
- [ ] Logs provide a single clear causal chain for any write: caller → ownership
      decision → write queued → write executed → storage event observed/ignored
      → cleanup. </acceptance_criteria>

---

## Supporting Context

<details>
<summary>Behavior contract reference (why these are issues)</summary>

`issue-47-revised.md` defines the expected “tab-scoped” model: Quick Tabs must
never cross tab boundaries (Scenario 1/2/11), must persist correctly across
reload/restart (Scenario 3/10), and must respect container boundaries (Scenario
14/18). Any “identity-not-ready but allow anyway” fallback is a direct risk to
these guarantees.

</details>

<details>
<summary>Report formatting constraints followed</summary>

This report follows the structure in `copilot-md-formatting-guide.md` and
intentionally avoids large code inserts or explicit implementation patches.

</details>

---

**Priority:** Critical (A, F, G), High (B, C, D, E), Medium (H, I, J, K, L) |
**Target:** Split into 2–3 PRs by concern area to avoid risky mega-diff |
**Estimated Complexity:** High (because lifecycle + storage + isolation
interact)
