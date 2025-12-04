# Additional Quick Tab Lifecycle Issues and Missing Logging (Not Covered in Previous Report)

**Extension Version:** v1.6.3.5-v11  
**Date:** 2025-12-04  
**Scope:** Newly identified lifecycle, state, and logging problems not documented in the prior Quick Tab restore report

---

## Executive Summary

This document captures **additional issues and missing diagnostics** in the Quick Tab lifecycle that were **not described in the previous restore-lifecycle report**. These problems are adjacent to the minimize/restore/z-index bugs but represent **distinct behaviors and blind spots** that can:

- Obscure the real root cause of lifecycle desynchronization
- Make it harder to confirm whether fixes are actually working
- Allow new regressions in `VisibilityHandler`, `UICoordinator`, and `QuickTabWindow` to slip through unobserved

All issues below are based on the **current HEAD** of the repo (v1.6.3.5-v11) and live logs from the latest test runs.

| Issue | Component | Severity | Category |
|-------|-----------|----------|----------|
| A | VisibilityHandler focus persistence spam | Medium | Logging + storage write behavior |
| B | Missing linkage between z-index state and background cache | Medium | Observability + potential state drift |
| C | Transaction fallback spam in StorageUtils | Low | Log noise + masking real failures |
| D | Incomplete lifecycle logging for DOM verification after restore | Medium | Missing visibility into DOM/Map invariants |
| E | No explicit logging when `isRendered()` and `container` disagree | Medium | Hidden split-brain indicators |

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js`
- `src/features/quick-tabs/coordinators/UICoordinator.js`
- `src/features/quick-tabs/window.js`
- `src/utils/storage-utils.js` (or equivalent storage transaction helper if present)

**Do NOT Modify:**
- `src/features/quick-tabs/handlers/UpdateHandler.js` persistence logic (functional and well-instrumented)
- `background.js` state hashing and storage-onChanged routing (already heavily logged)
</scope>

---

## Issue A: Excessive Focus-Triggered Storage Persists (Silent Performance Risk)

### Problem Summary

Under normal dragging/focus usage, **VisibilityHandler persists full Quick Tab state to storage on every focus event**, even when only z-index changes. This is working "correctly" from a functional perspective but:

- Generates **unnecessary write load** to `browser.storage.local`
- Adds noise to logs and storage transaction queues
- Makes it harder to isolate restore-related writes vs. pure focus/z-index writes

This was not described in the previous document, which focused on lifecycle and DOM issues rather than storage behavior.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleFocus()` and `_debouncedPersist()`

- `handleFocus(id)` increments `currentZIndex.value` and **always** calls `_debouncedPersist(id, 'focus', 'UI')`, even when no other state changed.
- `_debouncedPersist` then builds **full state** via `buildStateForStorage()` and persists all tabs, not just the focused one.
- Live logs show a sequence of back-to-back focus → persist cycles even when the only change is a small z-index bump.

This behavior is **not a correctness bug**, but it is:

- A silent performance risk
- A source of log and transaction noise
- A confounder when analyzing logs for minimize/restore regressions

### Fix Required (Behavioral + Logging)

- Keep the persistence behavior for now (to avoid destabilizing storage contracts), but **add specific logging that distinguishes focus-only persists** from structural changes.
- Add a simple state-diff or flag in `_debouncedPersist` / `_persistToStorage` so future work can optionally **skip full writes for pure z-index-only changes**, while still keeping the current behavior as a fallback.

The goal is **not** to change semantics immediately, but to:

- Make focus-only writes clearly visible in logs
- Prepare ground for future optimization where focus-only operations may not require a full persist

---

## Issue B: Z-Index State Drift Not Surfaced in Background Cache Logging

### Problem Summary

Background state (`globalQuickTabState` in `background.js`) is updated via storage-onChanged, but **there is no explicit correlation between per-tab z-index changes and the background cache**. 

In practice this can lead to situations where:

- A tab repeatedly calls `handleFocus()` and persists z-index updates
- The background cache reflects new `saveId` and tab count, but **z-index drift or anomalies** are not visible at a glance
- When investigating z-index issues, it is hard to tell whether:
  - The background cache is missing the latest z-index values, or
  - The content-side DOM is simply not applying them

The prior document focused on DOM/application of z-index to the window, not on how well z-index changes are surfaced in the background caching logs.

### Root Cause

**Files:**
- `background.js` (globalQuickTabState + storage.onChanged handlers)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (focus + persist)

Current logging in background:

- Confirms `oldTabCount`, `newTabCount`, `oldSaveId`, `newSaveId`
- Logs transaction IDs and instance IDs
- **Does not log any representative per-tab field**, such as z-index, to confirm that visually meaningful properties have synchronized.

As a result, when investigating z-index bugs, logs can show **healthy storage transactions** even if z-index data is corrupt, stale, or misapplied.

### Fix Required (Diagnostics Only)

- Add a **lightweight, sampled log** in the background storage-onChanged path that logs a small subset of per-tab fields (e.g., first N tabs):
  - `id`
  - `zIndex`
  - `minimized`

- This should be done in a way that **does not explode log volume** (e.g., cap number of entries, or only log when z-index changes relative to prior cache).

This is purely diagnostic and will greatly simplify verifying that **z-index changes made by VisibilityHandler are actually reaching the background cache**.

---

## Issue C: Transaction Fallback Cleanup Warnings Mask Real Storage Behavior

### Problem Summary

`StorageUtils` (and/or the transaction helper used by UpdateHandler/VisibilityHandler) frequently emits:

> `Transaction fallback cleanup storage.onChanged not received txn-...`

These warnings were not covered in the previous restore-focused document but show up heavily in the latest logs. They indicate that:

- The expected `storage.onChanged` callback for a transaction **was not observed within the expected window**, so a fallback cleanup path is invoked.
- This may be benign (timing) or may indicate noisy expectations around storage signaling.

The main risk is that these warnings become **background noise** and:

- Make it harder to spot real storage failures associated with the minimize/restore lifecycle
- Suggest that some internal storage invariants are not holding as tightly as intended

### Root Cause

**File:** `src/utils/storage-utils.js` (or equivalent)  
**Location:** Transaction tracking and `storage.onChanged` reconciliation

- The transaction system expects a `storage.onChanged` event for each transaction within some timeout.
- Under certain timing patterns (back-to-back writes from different handlers), some transactions **complete successfully** but the corresponding onChanged handler either:
  - Processes a later transaction and treats the earlier one as "missing", or
  - Is throttled/debounced in a way that causes the earlier transaction to appear as unacknowledged.

### Fix Required (Observability + Criteria)

- Do **not** change the core transaction behavior yet, but:
  - Make the warning **more structured**, including which module triggered the write (UpdateHandler vs. VisibilityHandler) and whether subsequent transactions were observed.
  - Add a **counter or flag** that distinguishes "benign timeout" cases from truly missing onChanged events.
- Optionally, add a **summary log** after a burst of writes that states:
  - Total transactions started vs. onChanged callbacks observed
  - Whether any transactions remained unacknowledged beyond a safe window

This will help distinguish **harmless timing noise** from **actual data-loss risk**.

---

## Issue D: Incomplete Lifecycle Logging Around DOM Verification After Restore

### Problem Summary

`VisibilityHandler._verifyRestoreAndEmit()` logs DOM verification after restore, but **does not surface Map or Manager invariants** that would reveal subtle desyncs, such as:

- Tab present in `quickTabsMap` but `isRendered() === false`
- Tab reported as `domVerified = true` while `minimizedManager` still holds a snapshot for the same ID

These are exactly the kinds of invariants that would expose split-brain states early, but current logging only shows:

- `isDOMRendered` boolean
- That rollback is disabled

The previous report focused more on UICoordinator's restore decisions than on this post-restore verification gap.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_verifyRestoreAndEmit()`

- After a short delay, `_verifyRestoreAndEmit` logs `isDOMRendered` but does not:
  - Cross-check `minimizedManager` for residual snapshots
  - Cross-check `quickTabsMap` vs. DOM presence in a structured way

Given the complexity of restore flows, **this is a missed opportunity** to enforce invariants and catch issues before they show up as user-facing glitches.

### Fix Required (Stronger Diagnostic Coverage)

Enhance `_verifyRestoreAndEmit()` logging to include:

- Whether the tab ID is still present in `minimizedManager` after restore
- Whether `quickTabsMap` contains the tab and what `tabWindow.isRendered()` returns
- A single consolidated log object that states whether the following invariant holds:
  
  > If `isDOMRendered === true`, then `minimizedManager.hasSnapshot(id) === false` and `quickTabsMap.has(id) === true`.

No behavioral changes are needed; this is strictly additional logging to tighten observability around restore success.

---

## Issue E: No Explicit Logging When `isRendered()` and `container` Disagree

### Problem Summary

`QuickTabWindow.isRendered()` returns a boolean based on `this.rendered && this.container && this.container.parentNode`. However, there is **no explicit logging** anywhere that:

- Detects when `this.rendered === true` but `this.container` is null
- Detects when `this.container` exists but `isRendered()` is false

These discrepancies are precisely the kind of **"split-brain" indicators** that would reveal lifecycle desync early, but they are not surfaced in any structured way.

The previous document described split-brain symptoms conceptually but did not call out this specific instrumentation gap.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `isRendered()` and lifecycle methods that mutate `rendered`/`container`:

- `render()`
- `minimize()`
- `destroy()`
- (indirectly) `restore()` via UICoordinator

These methods log **entry/exit** and some state snapshots, but there is no **central check** that asserts `rendered` and `container` stay in sync over time.

### Fix Required (Invariant Logging Only)

- Add a **small helper** in `QuickTabWindow` that can be called from key lifecycle points (`render`, `minimize`, `destroy`, `restore` entry/exit) to log when:
  - `rendered === true` but `!container` or `!container.parentNode`
  - `rendered === false` but `container` is still attached
- This helper should:
  - Avoid throwing or changing behavior
  - Just emit **clear, single-purpose logs** that make these mismatches trivial to spot in exported logs

This will significantly reduce the time needed to diagnose future lifecycle regressions in the Quick Tab window component.

---

<acceptancecriteria>

### Issue A - Focus Persistence Logging
- Logs clearly distinguish focus-only persists from other operations.
- It is possible to filter logs to see only writes triggered by focus/z-index changes.
- No change in functional behavior for focus persistence.

### Issue B - Z-Index and Background Cache Visibility
- Background storage-onChanged logs include at least one representative tab entry with `id` and `zIndex`.
- During z-index changes, logs show that background cache reflects the new z-index values.

### Issue C - Transaction Fallback Clarity
- `Transaction fallback cleanup` warnings include enough context to distinguish benign timing from real failures.
- A short test session does not produce unexplained fallback warnings with missing context fields.

### Issue D - Restore DOM Verification Invariants
- Logs after restore explicitly state whether minimizedManager and quickTabsMap are consistent with `isDOMRendered`.
- Any future violation of the stated invariant is visible in a single consolidated log entry.

### Issue E - `isRendered` vs. `container` Mismatch Logging
- If `rendered` and `container` ever drift out of sync, a targeted log entry is emitted with the Quick Tab ID and key flags.
- Exported logs from a failing session make it obvious whether a split-brain state originates in `QuickTabWindow` itself.

### All Issues
- No changes to storage schemas or public message contracts.
- All existing tests pass with added logging.
- Typical usage (create → drag → minimize → restore → drag → close) produces **more structured logs** but no new functional regressions.

</acceptancecriteria>
