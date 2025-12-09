# Quick Tabs Manager & Sidebar: Multi-Issue State/Sync Bug Report

**Extension Version:** v1.6.3.5 | **Date:** 2025-12-02 | **Scope:** State sync
and UI reliability across Quick Tabs and Manager

---

## Executive Summary

Multiple issues in state communication and UI logic are degrading the
reliability and user experience of Quick Tabs and the Manager Panel. Broken
synchronization, excessive message spam, ambiguous minimized state, insufficient
logging, and legacy code artifacts from previous architectures are all affecting
correct behavior and debuggability. This multi-issue report itemizes each
problem and root cause using repository-relative file paths, references specific
lines/sections, and gives actionable constraints.

## Issues Overview

| Issue                             | Component/File                                                              | Severity | Root Cause                                                                |
| --------------------------------- | --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| #1: Broken Event Bridge           | src/features/quick-tabs/index.js                                            | High     | Dead/bypassed internal event system                                       |
| #2: Storage Debounce Lag          | sidebar/quick-tabs-manager.js                                               | High     | Debounce set too high, creates UI lag                                     |
| #3: Message Spam on Min/Restore   | sidebar/quick-tabs-manager.js                                               | Medium   | Operations send IPC to all tabs                                           |
| #4: Hydration Ghost Tabs          | src/features/quick-tabs/index.js                                            | High     | No DOM verification after restore                                         |
| #5: Minimized State Ambiguity     | src/features/quick-tabs/minimized-manager.js, sidebar/quick-tabs-manager.js | Critical | Three disjoint state authorities out of sync                              |
| #6: Spurious Corruption Detection | sidebar/quick-tabs-manager.js                                               | Medium   | Corruption heuristics false-trigger                                       |
| #7: Outdated/Degraded Docs/Vars   | Multiple (esp. quick-tabs-manager.js)                                       | Low      | Old references to BroadcastChannel, APIs removed in code but not comments |
| #8: Missing Restore Verification  | sidebar/quick-tabs-manager.js                                               | High     | UI assumes restore succeeded but has no confirmation                      |
| #9: Missing/Weak Logging          | Multiple                                                                    | Medium   | Several core sync actions lack detailed log events                        |

**Why bundled:** All issues concern state synchronization, correct reflection of
Quick Tab state/operations, and Manager reliability post-architecture changes.
Addressing together maximizes consistency and test coverage.

<scope>
**Modify:**
- `src/features/quick-tabs/index.js` (event bridge, hydrate/restore, minimize logic)
- `src/features/quick-tabs/minimized-manager.js` (minimized state authority)
- `sidebar/quick-tabs-manager.js` (UI sync, debounce, messaging, logging)

**Do NOT Modify:**

- `src/background/` (unless required by acceptance criteria)
- `core/config.js` (unless modifying constants referenced above)
- Any Firefox container detection unless related to Manager sync </scope>

---

## Issue #1: Broken Event Bridge

### Problem

The internal/external event bus relay is not functional—Manager relies solely on
storage…onChanged, rendering event bridge code dead.

### Root Cause

**File:** `src/features/quick-tabs/index.js`  
**Location:** Event bridge (lines 402-433)  
**Issue:** Sidebar doesn't subscribe; all sync is via storage. Legacy event
logic still present but bypassed.

### Fix Required

Remove legacy event bridge code, or wire up sidebar to listen and act on events,
not just storage.

---

## Issue #2: Storage Read Debounce Causes Stale UI

### Problem

Sidebar UI is slow to reflect changes after minimize/restore, leading to user
confusion and extra/bad clicks.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` **Location:** STORAGE_READ_DEBOUNCE_MS
and all uses (lines 937-975) **Issue:** Debounce at 300ms is too high and not
dynamically tuned.

### Fix Required

Lower debounce to 50ms and/or adopt exponential backoff. Analyze whether
debounce is even required or could be replaced by atomic operation guards.

---

## Issue #3: Message Passing to Wrong Tabs (Spam)

### Problem

Every minimize/restore op messages all tabs; increases IPC cost and produces
errors where Quick Tab is not found.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` **Location:** minimizeQuickTab,
restoreQuickTab and associated helpers **Issue:** No targeting of only relevant
tabs due to lack of tab→Quick Tab mapping.

### Fix Required

Add mapping/index so message is only sent to browser tabs known to have the
relevant Quick Tab instance.

---

## Issue #4: Hydration Ghost Tabs

### Problem

Hydration process creates QuickTabWindow instances for tabs that cannot be
rendered (e.g., minimized state), leading to inconsistencies and "ghost" tabs in
Manager.

### Root Cause

**File:** `src/features/quick-tabs/index.js` **Location:**
\_hydrateStateFromStorage and associated hydrators **Issue:** Managers hold
references to non-DOM windows. Only domVerified: false flag applied.

### Fix Required

Ensure unrendered/failed-hydrate tabs are pruned; incorporate
feedback/confirmation before updating storage and Manager display.

---

## Issue #5: Minimized State Ambiguity

### Problem

Multiple sources of truth for minimized state—QuickTabWindow property,
MinimizedManager map, and storage['minimized'] or nested visibility—are
diverging after recent refactoring, producing mismatch bugs.

### Root Cause

**Files:** `src/features/quick-tabs/minimized-manager.js`,
`sidebar/quick-tabs-manager.js`  
**Locations:** All minimized tracking helpers (isTabMinimizedHelper, snapshot
apply/clear, etc.) **Issue:** Helper relies on nullish coalescing but can desync
between formats; delayed snapshot clear logic may lose state on fast ops.

### Fix Required

Centralize minimized state through a single authority (recommended:
MinimizedManager); all other locations become views or derived state.

---

## Issue #6: Storage Corruption False Alarms

### Problem

Corruption detection logic triggers unnecessarily on mass-close or normal tab
clearance, running expensive full-tab reconciliation and delaying normal
operation.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` **Location:** isSuspiciousDrop check,
full reconcile routines (line 963+) **Issue:** Uses blunt threshold logic on tab
count == 0; no expectation of legit zero state.

### Fix Required

Trigger only when combined with error return from storage, or presence of
domVerified: false in multiple tabs, not just count==0.

---

## Issue #7: Outdated Architecture References

### Problem

References to BroadcastChannel and old sync mechanisms remain in comments and
some variable names, increasing maintenance friction.

### Root Cause

**Files:** Comments throughout `sidebar/quick-tabs-manager.js`, some docs in
root, potentially within `README.md`.

### Fix Required

Audit/comment update pass; ensure all architecture docs/code refer only to
currently used storage/event APIs.

---

## Issue #8: Restore Missing DOM Confirmation

### Problem

Sidebar assumes DOM render succeeded after minimizing/restoring; user may see
green indicator even if window did not materialize.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` **Location:** restoreQuickTab and
post-restore UI update **Issue:** No actual handshake/DOM-check feedback, only
fire-and-forget messages.

### Fix Required

Use callback/message response to confirm DOM presence before updating UI and
removing pending/ghost state.

---

## Issue #9: Missing/Weak Logging For Sync & State Operations

### Problem

Critical UX/logic issues are difficult to reproduce/debug due to minimal
granular logging, especially around storage state/prune, snapshot lifecycles,
DOM verification, and edge-case failures.

### Root Cause

**Files:** All ops in above issues, but especially hydraulic paths touching
minimized/restore/hydrate

### Fix Required

Add structured log events for: every storage write, snapshot
addition/removal/prune, all failures of DOM rehydrate, and reconciliation
triggers/results. Ensure both Manager and Quick Tabs log enough info to
reconstruct all state changes under corner cases.

---

## Shared Implementation Notes

- Make all state/sync code robust to rapid multi-operation events, including
  partial failure or unexpected user timing (esp. storage race conditions)
- Test with multi-tab/multi-container, rapid open/close, and minimize/restore as
  well as normal use cases.
- Ensure all involved logs include sufficient metadata: operation type, tab ID,
  Quick Tab ID, container ID, and operation outcome (success/failure)
- All public API in Manager and Quick Tabs must propagate and consume DOM
  verification explicitly—never trust "success" until DOM present

<acceptance_criteria> **Issue #1:**

- [ ] Only one functional event system; sidebar+manager UI listen to/emit same
      source

**Issue #2:**

- [ ] UI state updates within 50ms-100ms after operation; debounce absent or
      minimal

**Issue #3:**

- [ ] IPC messages for minimize/restore only go to tabs containing the affected
      Quick Tab

**Issue #4:**

- [ ] Hydration leaves no ghost/DOM-failed tabs; all tabs in Manager have real,
      visible windows

**Issue #5:**

- [ ] Minimized state only tracked in one authority, sync never produces
      divergence in Manager vs. window vs. storage

**Issue #6:**

- [ ] Corruption detection/triggers only on true error, not legit clear/close

**Issue #7:**

- [ ] All obsolete doc/code references to removed sync API are purged

**Issue #8:**

- [ ] Restore confirmation requires DOM-verified handshake before Manager
      updates state/indicator

**Issue #9:**

- [ ] Storage ops, snapshot changes, and hydrate/restore all have structured
      logs with success/fail and metadata

**All Issues:**

- [ ] No changes to code outside declared <scope>
- [ ] All existing tests pass, all new tests for sync/edge-cases pass

## Supporting Context

<details>
<summary>Diagnostic Process</summary>
- Manual review of repo against latest feature/bugfix branches (as of 2025-12-02)
- Code walkthrough of critical files: index.js, minimized-manager.js, quick-tabs-manager.js
- Review of all log statements and event bus/storage coordination logic
- Sanity-check with diagnostic scenarios from support documentation and behavior replay
</details>

<details>
<summary>Issue Evidence and Example Cases</summary>
- Multiple logs show state desyncs, especially during rapid multi-window operation
- UI "ghost" tab issues observed after network or render failures during minimize/restore
- Manager indicator lags and false-positives: double yellow/green for same window, particularly on resume after mass close/minimize
- Legacy event bus logic untouched since early v1.6 refactor
</details>

---

**Priority:** Critical (code/data sync), High (logging/UI), Medium (doc debt) |
**Target:** All issues fixed in one coordinated PR | **Estimated Complexity:**
High
