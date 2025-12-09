# Quick Tabs Manager: Minimized Quick Tab Restoration Failure

**Extension Version:** v1.6.3.6-v6 | **Date:** 2025-12-08 | **Scope:** Restored
Quick Tabs fail to appear on screen while Manager is open

---

## Executive Summary

When users attempt to restore a previously minimized Quick Tab while the Manager
is open, the restored Quick Tab does not appear on screen despite storage state
being updated. Multiple state synchronization failures prevent the restoration
operation from reaching completion. The issue manifests as either orphaned Quick
Tabs (missing `originTabId` field) blocking hydration during page load, or
cross-tab validation incorrectly rejecting same-tab restoration attempts.

---

## Issues Overview

| Issue                                      | Component        | Severity | Root Cause                                      |
| ------------------------------------------ | ---------------- | -------- | ----------------------------------------------- |
| #1: Orphaned Quick Tabs block hydration    | QuickTabsManager | Critical | `originTabId` never set during creation         |
| #2: Manager restoration rejected cross-tab | UICoordinator    | Critical | Validation treats same-tab restore as cross-tab |
| #3: Snapshot lacks `originTabId` field     | MinimizedManager | High     | Snapshot extraction missing required field      |
| #4: Missing restoration message to content | background.js    | High     | No DOM rendering command after Manager restore  |
| #5: Logging blind spots                    | Multiple         | Medium   | Missing visibility into restore pipeline        |

**Why bundled:** All affect Quick Tab restoration path; share state persistence
and validation architecture; compound to completely block restoration when
Manager is open.

<scope>
**Modify:**
- `src/features/quick-tabs/managers/QuickTabsManager.js` (hydration validation)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (restoration validation, restore operation logic)
- `src/features/quick-tabs/managers/MinimizedManager.js` (snapshot creation)
- `background.js` (state creation, Manager command routing)
- `src/features/quick-tabs/handlers/` (logging instrumentation)

**Do NOT Modify:**

- `src/features/quick-tabs/handlers/VisibilityHandler.js` (minimize operation
  works correctly)
- `content.js` (message handling is functional)
- `state-manager.js` (storage architecture is correct) </scope>

---

## Issue #1: Orphaned Quick Tabs Block Hydration on Page Load

### Problem

When content script initializes, Quick Tabs stored in `browser.storage.local`
are rejected during hydration because they have `originTabId: null`. Both Quick
Tabs fail validation and zero tabs appear on screen until manually created
again.

### Root Cause

**File:** `src/features/quick-tabs/managers/QuickTabsManager.js`  
**Location:** `STEP 6: Hydrate state from storage` hydration validation (appears
to be in hydration loop)  
**Issue:** Hydration filter rejects all Quick Tabs with `originTabId === null`,
even when the Quick Tab was created in the SAME tab being restored. The
validation assumes `originTabId: null` indicates a cross-tab orphaned tab, but
it never accounts for Quick Tabs created before `originTabId` field was
consistently populated.

**Evidence:** From logs:

```
HYDRATION BLOCKED - Orphaned Quick Tab has no originTabId: {
  "id": "qt-14-1765153135859-efdbdi1x8x3v1",
  "originTabId": null,
  "currentTabId": 14
}
TAB SCOPE ISOLATION VALIDATION: { "total": 2, "passed": 0, "filtered": 2, ... "noOriginTabId": 2 }
Hydrated 0 Quick Tab(s) from storage
```

### Fix Required

During hydration, when a Quick Tab lacks `originTabId`, implement fallback
logic: if the Quick Tab's ID prefix contains the current tab ID (pattern:
`qt-{tabId}-*`), treat it as same-tab and allow hydration. Alternatively, use
current tab ID as fallback when field is missing and tab ownership cannot be
determined. This preserves safety against true cross-tab leaks while fixing
legitimate same-tab restorations.

---

## Issue #2: Manager Restore Rejects Same-Tab Restoration as Cross-Tab Violation

### Problem

Manager initiates a restoration operation for a minimized Quick Tab.
UICoordinator retrieves the snapshot from MinimizedManager and attempts to
restore, but validation intercepts and logs
`CROSS-TAB BLOCKED: Quick Tab has null/undefined originTabId - REJECTED`. The
restoration never completes, and no iframe is rendered.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Restoration validation during `_applySnapshotForRestore()` or
similar restore-path validation (lines show this occurs during restore
operation)  
**Issue:** Validation logic checks `if (!originTabId) { REJECT }` without
context that the restoration operation is happening IN THE SAME TAB that
initiated it. The defensive cross-tab check is correctly implemented but
incorrectly applied to same-tab operations. No fallback exists to use current
tab ID when field is missing.

**Evidence:** From logs:

```
CROSS-TAB BLOCKED: Quick Tab has null/undefined originTabId - REJECTED: {
  "quickTabId": "qt-14-1765148664901-1cgvs7fonsdz7",
  "currentTabId": 14,
  "url": "https://en.wikipedia.org/wiki/Yokkaichi",
  "reason": "Orphaned Quick Tab - originTabId must be set during creation"
}
```

Despite `currentTabId: 14` matching the tab ID in the Quick Tab's ID string
(`qt-14-*`), validation still rejects.

### Fix Required

Modify restoration validation to accept same-tab restorations with missing
`originTabId`. When validation encounters null/undefined `originTabId`, check if
the Quick Tab ID contains the current tab ID prefix. If match found, allow
restoration and assign `originTabId = currentTabId` for future operations. Only
reject if ID prefix doesn't match (true cross-tab).

---

## Issue #3: Minimized Manager Snapshots Don't Include `originTabId`

### Problem

When a Quick Tab is minimized, MinimizedManager stores a snapshot containing
position and size but omits the `originTabId` field. When restoration later
attempts to use this snapshot, the field is null, triggering Issue #2's
cross-tab validation rejection.

### Root Cause

**File:** `src/features/quick-tabs/managers/MinimizedManager.js`  
**Location:** Snapshot creation during minimize operation (likely in
`saveSnapshot()` or snapshot extraction method)  
**Issue:** Snapshot extraction code captures only position and size properties:

```
{ position: { left, top }, size: { width, height }, originTabId: null }
```

The code never includes `originTabId` when creating the snapshot. There's also
no logging showing what fields are being extracted, making this invisible in
current logging infrastructure.

**Evidence:** From logs showing snapshot structure:

```
MinimizedManager.getSnapshot found for: qt-14-1765148664901-1cgvs7fonsdz7 {
  "source": "pendingClearSnapshots",
  "position": { "left": 90, "top": 66 },
  "size": { "width": 960, "height": 540 },
  "originTabId": null
}
```

### Fix Required

When creating minimized snapshots, include the Quick Tab's current `originTabId`
value in the snapshot object. If `originTabId` is missing from the Quick Tab
entity being minimized, fall back to current tab ID. This ensures restoration
has all required fields to pass validation.

---

## Issue #4: Manager Restore Doesn't Trigger Content Script Rendering

### Problem

Manager sends restore command to background. UICoordinator processes the
restoration and updates state, but no message is sent to content script to
actually render the iframe on screen. State is updated in storage but DOM
remains empty.

### Root Cause

**File:** `background.js` and
`src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Manager command routing and restoration handling  
**Issue:** After UICoordinator handles the restore operation (assuming it passes
validation), there's no explicit message sent to the content script with
instructions to render the Quick Tab. The Manager attempts restoration but the
command routing doesn't include a step to tell the hosting content script
"render this Quick Tab now". Storage writes occur but content scripts rely on
storage.onChanged events to trigger re-renders; if the Manager's restore
operation doesn't properly write state that includes the Quick Tab, content
scripts have nothing to render.

**Evidence:** Log sequence shows:

1. Manager initiates restore
2. UICoordinator validates and rejects (blocked by Issue #2)
3. State is supposedly updated
4. But NO log entries showing message sent to content script to render
5. No entry showing iframe being created in content script

The logging infrastructure does not capture what message (if any) is sent to
content scripts after Manager restore.

### Fix Required

After Manager restore operation completes successfully (after validation
passes), explicitly send a message to the hosting content script to render or
make visible the Quick Tab iframe. Alternatively, ensure the state written to
storage includes all necessary fields and that content scripts have listeners
that detect restoration state changes. Add logging to show which message is sent
and to which tab.

---

## Issue #5: Missing Logging Throughout Restoration Pipeline

### Problem

The restoration workflow has critical blind spots in logging that prevent
visibility into what's happening:

**Missing logs:**

- When snapshots are created during minimize: what fields are extracted?
- When restoration validation runs: which checks pass/fail before cross-tab
  rejection?
- When originTabId is assigned (or attempted): logs should show assignment or
  rejection
- Whether restoration message is sent to content script: what message type and
  target tab?
- Content script reaction to restoration: does it receive message? does it
  render?
- Why validation decides to reject: more detail about the decision path

### Root Cause

**Files:** Multiple across `UICoordinator.js`, `MinimizedManager.js`,
`background.js`  
**Issue:** Current logging shows the symptom (CROSS-TAB BLOCKED) but not the
decision path that led there. Snapshot creation has no instrumentation. Message
routing after Manager restore has no visibility. Content script reaction to
restoration messages is not logged.

This makes diagnosing restoration failures extremely difficult—logs jump from
"restore initiated" to "cross-tab blocked" with no intermediate visibility.

### Fix Required

Add structured logging at these pipeline stages:

- Snapshot creation: log all fields being captured (position, size, originTabId,
  etc.)
- Restoration initiation: log source, Quick Tab ID, current validation state
- Validation checks: log each validation rule evaluated and result
- originTabId fallback logic: log when field is missing and what fallback
  applies
- Message dispatch: log when/if restoration message is sent to content script
- Content script reception: log when content script receives and processes
  restoration

---

## Shared Implementation Context

### State Creation Must Always Set originTabId

When Quick Tabs are created in `background.js` QuickTabHandler.handleCreate(),
ensure `originTabId` is set to the requesting tab ID immediately. This prevents
orphaned tabs from ever entering storage. Check: does handleCreate() set this
field currently?

### Restoration Validation Should Be Permissive for Same-Tab

The cross-tab validation serves an important safety function to prevent
cross-origin Quick Tabs from appearing in wrong tabs. However, it should allow
same-tab restorations even with missing `originTabId` by falling back to current
tab ID when context confirms same-tab ownership.

### Snapshot Extraction Must Be Complete

Any code that extracts Quick Tab data into a snapshot or cache must include all
fields required for restoration: position, size, originTabId, minimized state,
and any other fields needed by validators.

<acceptance_criteria>

**Issue #1 - Hydration:**

- [ ] Quick Tabs with `originTabId: null` and matching tab ID prefix are
      hydrated successfully
- [ ] `originTabId` is assigned to current tab ID if missing but same-tab
      ownership confirmed
- [ ] Logging shows hydration acceptance with fallback reasoning
- [ ] Cross-tab orphans (ID prefix mismatch) are still rejected safely

**Issue #2 - Manager Restore:**

- [ ] Manager restore attempts with null `originTabId` are accepted for same-tab
      operations
- [ ] Tab ID matching logic prevents false cross-tab rejections
- [ ] Validation logs which rule triggered acceptance/rejection
- [ ] Content script receives and renders restored Quick Tab

**Issue #3 - Snapshot Completeness:**

- [ ] MinimizedManager snapshots include `originTabId` field
- [ ] Snapshot creation logs all extracted fields
- [ ] Restoration retrieves complete snapshot without field mutations

**Issue #4 - Restoration Messaging:**

- [ ] Manager restore triggers explicit message to content script
- [ ] Content script logs receipt and renders iframe
- [ ] Logging shows message dispatch with target tab and Quick Tab ID

**Issue #5 - Logging Coverage:**

- [ ] Snapshot creation logged with all fields
- [ ] Restoration validation logged with decision path
- [ ] originTabId fallback logic logged
- [ ] Message dispatch and reception logged
- [ ] No blind spots in restoration pipeline

**All Issues:**

- [ ] Manual test: minimize Quick Tab → open Manager → click restore → iframe
      appears immediately
- [ ] Manual test: refresh page → previously minimized Quick Tab appears on page
      load
- [ ] All existing tests pass
- [ ] No new console errors or validation rejections during normal restoration

</acceptance_criteria>

---

## Supporting Context

<details>
<summary>Issue #1 & #2: Hydration and Validation Sequence</summary>

On page load:

1. Content script initializes QuickTabsManager
2. Manager attempts hydration: `STEP 6: Hydrate state from storage`
3. Reads 2 Quick Tabs from storage with `originTabId: null`
4. Validation checks: `Quick Tabs with null/undefined originTabId` → FILTERED
   OUT
5. Result: `Hydrated 0 Quick Tab(s) from storage`
6. User sees blank page with no Quick Tabs

During Manager restore:

1. Manager sends restore command to background
2. UICoordinator processes: looks up snapshot from MinimizedManager
3. Snapshot retrieved has `originTabId: null`
4. Restoration validation triggered
5. Check: `if (!tab.originTabId)` → TRUE
6. Result: `CROSS-TAB BLOCKED` with rejection
7. No message sent to content script to render
8. User clicks restore button but nothing happens

</details>

<details>
<summary>Issue #3: Snapshot Structure Evidence</summary>

When MinimizedManager returns snapshot:

```
{
  source: "pendingClearSnapshots",
  position: { left: 90, top: 66 },
  size: { width: 960, height: 540 },
  originTabId: null  // ← MISSING
}
```

Should include:

```
{
  originTabId: 14,  // ← REQUIRED
  position: { left: 90, top: 66 },
  size: { width: 960, height: 540 }
}
```

No logging shows how the snapshot object is constructed, making it invisible how
`originTabId` field is (or is not) added.

</details>

<details>
<summary>Issue #4: Missing Message Dispatch Logging</summary>

Current log sequence:

```
UICoordinator: Checking MinimizedManager for snapshot
MinimizedManager: getSnapshot found for qt-14-...
UICoordinator: CROSS-TAB BLOCKED (validation rejects)
[NO LOG showing message sent to content script]
[NO LOG showing content script received message]
[NO LOG showing iframe rendered or not]
```

Should show:

```
Background: Routing MANAGER_COMMAND: restoreQuickTab to tab 14
Content Script: Received RESTORE_QUICK_TAB message for qt-14-...
Content Script: Creating iframe for restoration
QuickTabWindow: Iframe rendered with restored dimensions
```

</details>

<details>
<summary>Issue #5: Logging Blind Spots in Current Implementation</summary>

**Snapshot Creation Invisible:**

- No log when minimize operation captures state into snapshot
- No visibility into which fields are included/excluded

**Validation Decision Path Unclear:**

- Logs show final REJECTED state but not which validation rule triggered
  rejection
- No intermediate checkpoint logs for each validation check

**Message Routing Unknown:**

- No log showing whether Manager sends restoration message
- No log showing content script receiving restoration directive
- No log showing iframe creation or render attempt

**State Mutation Untracked:**

- When originTabId is assigned as fallback, no log
- When state is updated in storage, minimal logging of what changed

These gaps mean debugging restoration failures requires reconstructing logic
flow manually instead of reading clear log trail.

</details>

---

**Priority:** Critical (Issues #1-4), Medium (Issue #5) | **Target:** Single
coordinated PR | **Estimated Complexity:** Medium | **Dependencies:** None (can
fix independently)
