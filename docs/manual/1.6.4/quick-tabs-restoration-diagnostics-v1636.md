# Quick Tabs Restoration System: Interconnected State Persistence Failures

**Extension Version:** v1.6.3.6 | **Date:** 2025-12-08 | **Scope:** Minimized
Quick Tabs fail to restore with Manager, state hydration blocks tabs on page
reload, cross-tab validation incorrectly rejects restorations

---

## Executive Summary

The Quick Tabs restoration system has multiple interconnected failures
preventing minimized tabs from being restored while the Manager is open. All
issues trace to a single root cause chain: the `originTabId` field is never
initialized during Quick Tab creation, causing it to be null throughout the
tab's lifecycle. This cascades through hydration validation, snapshot handling,
and Manager restoration, with critical logging gaps preventing visibility into
the failure chain. Five distinct code paths contribute to the complete
restoration failure.

## Issues Overview

| Issue                                               | Component        | Severity | Root Cause                                                   |
| --------------------------------------------------- | ---------------- | -------- | ------------------------------------------------------------ |
| #1: originTabId never initialized on creation       | CreateHandler    | Critical | No originTabId assignment in create()                        |
| #2: Hydration rejects tabs with null originTabId    | QuickTabsManager | Critical | Validation filters out tabs without originTabId              |
| #3: Snapshot missing originTabId field              | MinimizedManager | High     | Snapshot extraction doesn't capture field                    |
| #4: Manager restore blocked by cross-tab validation | UICoordinator    | Critical | \_shouldRenderOnThisTab() rejects null originTabId           |
| #5: Missing logging throughout restoration pipeline | Multiple         | High     | No visibility into state transitions and validation failures |

**Why bundled:** All five issues exist in the same restoration code path
(minimize → snapshot → Manager restore → render). Each issue is a prerequisite
for the next, creating a complete restoration failure even though individual
operations work. Fixing requires coordinated changes across all files because
state flows between them.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/CreateHandler.js` (create method initialization)
- `src/features/quick-tabs/index.js` (hydration validation and logging)
- `src/features/quick-tabs/minimized-manager.js` (snapshot field extraction and logging)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (restoration validation and logging)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (restoration logging)

**Do NOT Modify:**

- `src/content.js` (message handling works correctly)
- `src/features/quick-tabs/window.js` (rendering logic works correctly)
- `src/storage/state-manager.js` (storage architecture is correct)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` minimize operation
  (works correctly, Issue #4 only) </scope>

---

## Issue #1: originTabId Never Initialized During Quick Tab Creation

### Problem

New Quick Tabs are created without an `originTabId` field set. This causes the
field to be null or undefined throughout the tab's lifecycle, blocking hydration
and restoration.

### Root Cause

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** `create()` method  
**Issue:** When a new QuickTabWindow instance is constructed, the `originTabId`
parameter is never passed or set. The field defaults to undefined or null
because CreateHandler doesn't assign the current tab ID to the new tab object.

### Fix Required

Ensure `originTabId` is set to the current browser tab ID when creating each new
QuickTab instance. This should happen in the handler before passing options to
the QuickTabWindow constructor. Pass the current tab ID from the context or
configuration options passed to CreateHandler. The field must be set BEFORE the
QuickTabWindow is added to any storage or maps.

---

## Issue #2: Hydration Validation Filters Out Tabs with Null originTabId

### Problem

When a page reloads and QuickTabsManager attempts to hydrate tabs from storage,
all tabs with null originTabId are filtered out by validation. The user sees
zero Quick Tabs despite tabs being stored, forcing them to recreate tabs
manually.

### Root Cause

**File:** `src/features/quick-tabs/index.js`  
**Location:** `_checkTabScopeWithReason()` method and
`_hydrateTabsFromStorage()` method  
**Issue:** The validation logic checks `if (!originTabId)` and rejects tabs.
While the code attempts to extract tab ID from the Quick Tab ID pattern (format:
`qt-{tabId}-*`), this extraction only works if the Quick Tab ID was formatted
correctly during creation. For tabs created without proper originTabId, the ID
pattern may not contain the tab ID either. The validation is also overly strict
during hydration—it should recover from missing originTabId more aggressively.

### Fix Required

Improve the hydration recovery logic to handle missing originTabId more
robustly. The extraction from Quick Tab ID pattern is correct but should be
validated more carefully. Consider making the originTabId fallback mechanism
more forgiving: if the tab ID can be extracted from the ID pattern OR if the tab
was created in the current tab context, allow hydration. Enhance logging to show
why tabs are being filtered (missing originTabId, extraction failed, etc.).

---

## Issue #3: Snapshot Extraction Missing originTabId Field

### Problem

When a Quick Tab is minimized, MinimizedManager creates a snapshot containing
position and size but the snapshot lacks the originTabId field. When restoration
later retrieves the snapshot, the null originTabId is applied to the entity,
failing subsequent cross-tab validation.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** `add()` method snapshot creation (around line 80)  
**Issue:** The code creates a snapshot object with `savedPosition` and
`savedSize` fields by extracting from the tabWindow instance. However, it only
captures position and size—it never extracts `tabWindow.originTabId` into the
snapshot. The v1.6.3.6-v6 fix adds `savedOriginTabId` to the snapshot
constructor but only references `tabWindow.originTabId`, which is null from
Issue #1.

### Fix Required

Extract originTabId into the snapshot alongside position and size. The code
structure is correct but the field reference is incomplete. Ensure the snapshot
captures all required fields for full restoration. Add comprehensive logging
showing what fields are being extracted during snapshot creation—log position,
size, AND originTabId explicitly. This visibility will catch any missing field
extraction immediately in future development.

---

## Issue #4: Manager Restore Blocked by Cross-Tab Validation

### Problem

When Manager initiates a restore operation, the Quick Tab's restored snapshot
has originTabId as null (from Issue #3). UICoordinator's
`_shouldRenderOnThisTab()` validation sees the null originTabId and rejects the
restoration with "CROSS-TAB BLOCKED", preventing the iframe from being rendered.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_shouldRenderOnThisTab()` method and `render()` entry point  
**Issue:** The validation enforces cross-tab isolation by checking if
`originTabId` matches the current tab ID. When `originTabId` is null, the
validation correctly rejects it as a potential cross-tab leak. However, the
validation has a fallback to extract the tab ID from the Quick Tab ID pattern.
The issue is that this extraction and fallback logic is incomplete or the tab ID
pattern itself is malformed (because Issue #1 didn't set originTabId properly
during creation). The fallback recovery patches the Quick Tab entity in-place
but this only helps for the current operation—it doesn't solve the root cause of
null originTabId.

### Fix Required

The validation logic and fallback extraction in `_shouldRenderOnThisTab()` is
architecturally correct. The fix needed is primarily in Issues #1 and #3 to
ensure originTabId is properly set and captured. However, enhance the fallback
logic to be even more aggressive: log what's being extracted, verify the
extraction result, and apply more robust pattern matching. Ensure the logged
rejection message clearly indicates whether the rejection is due to cross-tab
mismatch (different tab IDs) vs. missing originTabId field (null value). This
distinction is critical for debugging.

---

## Issue #5: Missing Logging Throughout Restoration Pipeline

### Problem

The restoration pipeline has critical blind spots in logging making it
impossible to debug why restoration fails. Logs jump from "restore initiated"
directly to "CROSS-TAB BLOCKED" with no intermediate visibility into state
transformations, validation steps, or message routing.

### Root Cause

**File:** Multiple files across restoration pathway  
**Issue:** Several code sections lack instrumentation:

- `MinimizedManager.add()` doesn't log which fields are extracted into the
  snapshot
- `MinimizedManager.getSnapshot()` doesn't log whether it's returning from
  minimizedTabs or pendingClearSnapshots
- `UICoordinator.render()` doesn't log WHY it's calling
  `_shouldRenderOnThisTab()` or what validation result was returned
- `UICoordinator._shouldRenderOnThisTab()` doesn't log intermediate steps of tab
  ID extraction or why fallback recovery succeeded/failed
- No logging shows whether the state written to storage includes originTabId
- Content script reaction to restoration is not logged
- No logs show the difference between "snapshot lookup succeeded but originTabId
  is null" vs. "snapshot not found"

### Fix Required

Add structured logging at pipeline entry/exit points to make state flow visible.
Log what fields are in the snapshot when it's created and when it's retrieved.
Log validation decision paths with clear logging of which branch was taken (ID
pattern extraction, direct match, cross-tab rejection). Log whether the
extracted tab ID actually matched the Quick Tab ID pattern. Add logging
before/after any state mutations (originTabId assignment, snapshot clearing,
entity updates). Include the actual values in logs (not just success/failure
flags). This logging should be comprehensive enough that a developer can follow
the exact state path a Single Tab ID takes from creation through minimize
through restore through render.

---

## Shared Implementation Context

### originTabId Field: Current State vs. Required State

The `originTabId` field exists in the schema but is never properly initialized.
It should be set to the current browser tab ID during Quick Tab creation. The
field is used throughout for cross-tab isolation: only Quick Tabs with matching
originTabId should render in a given tab. This is critical for the single-tab
model implemented in v1.6.3+.

### Snapshot Lifecycle Architecture

Snapshots are immutable copies of position/size/originTabId captured when a tab
is minimized. They persist in MinimizedManager (two Maps: `minimizedTabs` and
`pendingClearSnapshots`). When restoration occurs, the snapshot must include ALL
fields needed for rendering: position, size, originTabId, and any other
rendering parameters. The current architecture is sound but Issue #3 prevents
originTabId from being captured.

### Fallback Tab ID Extraction Pattern

Quick Tab IDs follow format: `qt-{browserTabId}-{timestamp}-{random}`. The
extraction pattern `match(/^qt-(\d+)-/)` should recover the browser tab ID from
the string. This extraction works correctly and is used as a fallback when
originTabId is null, but the extraction only helps if the ID was formatted
correctly during creation (Issue #1). Improve logging to show when extraction
succeeds/fails and what value was extracted.

### Cross-Tab Validation Rules

A Quick Tab should render on a browser tab only if:

1. `originTabId` field matches current tab ID (primary check)
2. OR tab ID can be extracted from Quick Tab ID pattern AND matches current tab
   ID (fallback recovery)
3. OR tab is soloed to specific tabs (override - check `soloedOnTabs`)
4. AND tab is not muted on current tab (check `mutedOnTabs`)

Current code implements rules 1-4 but Issue #1 prevents rule 1 from working,
making the system depend entirely on rule 2 (fallback extraction).

<acceptance_criteria> **Issue #1:**

- [ ] CreateHandler.create() sets originTabId to current tab ID before
      constructing QuickTabWindow
- [ ] All new Quick Tabs have originTabId field populated (verify in storage)
- [ ] Logs show originTabId being set during creation

**Issue #2:**

- [ ] Hydration recovers tabs with null originTabId using ID pattern extraction
- [ ] Extracted tab ID is logged showing pattern match result
- [ ] Hydrated tabs with recovered originTabId render correctly
- [ ] Tabs are NOT filtered out during hydration due to null originTabId

**Issue #3:**

- [ ] MinimizedManager.add() captures originTabId in snapshot alongside
      position/size
- [ ] Snapshot logs show all extracted fields (position, size, originTabId)
- [ ] getSnapshot() returns originTabId field in snapshot data
- [ ] Restored tabs have originTabId available from snapshot

**Issue #4:**

- [ ] UICoordinator.\_shouldRenderOnThisTab() logs validation decision path
- [ ] Cross-tab rejection logs clearly distinguish between "null originTabId"
      vs. "mismatched originTabId"
- [ ] Fallback extraction logs show what tab ID was extracted and whether it
      matched
- [ ] Manager restore successfully renders Quick Tabs (originTabId passes
      validation)

**Issue #5:**

- [ ] Snapshot creation logs show field extraction (position, size, originTabId
      values)
- [ ] Snapshot retrieval logs show source (minimizedTabs vs.
      pendingClearSnapshots)
- [ ] Restoration validation logs show each validation rule evaluated
- [ ] Tab ID extraction logs show pattern, match result, and extracted value
- [ ] State mutation logs show field assignments (originTabId updates, etc.)

**All Issues:**

- [ ] Manual test: Create Quick Tab → Minimize → Reload page → Tab appears
      (Issue #2)
- [ ] Manual test: Create Quick Tab → Minimize → Open Manager → Click Restore →
      Tab renders
- [ ] Manual test: Check storage to verify originTabId is present in all tabs
- [ ] All existing tests pass
- [ ] No new console errors or warnings
- [ ] Logs are structured and queryable (searchable by component, operation, tab
      ID) </acceptance_criteria>

## Supporting Context

<details>
<summary>Cascading Failure Chain</summary>

The five issues combine to create complete restoration failure:

1. User creates Quick Tab (originTabId = null from Issue #1)
2. User minimizes Quick Tab
3. MinimizedManager.add() creates snapshot without originTabId (Issue #3)
4. User refreshes page
5. Hydration tries to restore tab but rejects it due to null originTabId (Issue
   #2)
6. User opens Manager
7. Manager initiates restore from snapshot
8. UICoordinator.render() calls \_shouldRenderOnThisTab()
9. Validation sees originTabId is null (inherited from Issue #3)
10. Validation rejects with CROSS-TAB BLOCKED (Issue #4)
11. No iframe is rendered despite successful snapshot lookup
12. Logs show only "CROSS-TAB BLOCKED" without showing originTabId was the
    problem (Issue #5)

Each issue is necessary but not sufficient for failure. Fixing only Issue #1
doesn't fully solve restoration because Issue #2 and #3 also need fixes to
ensure proper state throughout.

</details>

<details>
<summary>Root Cause Analysis: Why originTabId Initialization Was Missed</summary>

During v1.6.3 refactoring, the architecture shifted from cross-tab sync
(multiple tabs could share Quick Tabs) to single-tab model (each tab owns its
Quick Tabs). The originTabId field was added to schema to track ownership but
initialization was never implemented. CreateHandler.create() was refactored to
delegate to QuickTabWindow constructor but the tab ID was never passed as a
parameter. The field design is correct but the initialization point was missed.

</details>

<details>
<summary>Log Evidence: Current vs. Required Logging</summary>

Current logs show:

```
CROSS-TAB BLOCKED: Quick Tab has null/undefined originTabId - REJECTED
```

Required enhanced logs should show:

```
_shouldRenderOnThisTab ENTRY: id=qt-14-xxx, originTabId=null, currentTabId=14
  Attempting tab ID extraction from ID pattern...
  Extracted tab ID: 14 from pattern qt-14-xxx
  Extracted ID matches currentTabId: true
  Result: Allow rendering (recovered via ID pattern)
```

Or when extraction fails:

```
_shouldRenderOnThisTab ENTRY: id=qt-14-xxx, originTabId=null, currentTabId=14
  Attempting tab ID extraction from ID pattern...
  Pattern match failed (malformed ID)
  Result: Reject rendering (cannot determine ownership)
```

</details>

<details>
<summary>Architecture: Storage Persistence vs. State Synchronization</summary>

Firefox WebExtension storage.local architecture (from MDN):

- storage.local is per-extension, NOT per-tab
- storage.onChanged fires when ANY script calls storage.local.set() or .remove()
- Tabs can listen to storage.onChanged to sync state, but storage doesn't
  automatically sync—only explicit writes trigger events
- storage.local is asynchronous; writes may take time
- No built-in cross-tab communication; must use storage as message medium

Quick Tabs uses storage.local for persistence (reload recovery) and for Manager
sync (Manager listens to storage.onChanged). When VisibilityHandler minimizes a
tab, it must call storage.local.set() to trigger Manager's listener. Simply
updating in-memory state is not sufficient because Manager is in a different
context.

</details>

<details>
<summary>Snapshot Field Extraction Current Implementation</summary>

MinimizedManager.add() currently captures:

- position: {left: tabWindow.left, top: tabWindow.top}
- size: {width: tabWindow.width, height: tabWindow.height}

v1.6.3.6-v6 added originTabId capture but references tabWindow.originTabId which
is null. The snapshot structure is:

```
{
  window: tabWindow,
  savedPosition: {...},
  savedSize: {...},
  savedOriginTabId: tabWindow.originTabId  // Always null from Issue #1
}
```

After fix, it should reliably populate all three fields with valid data.

</details>

<details>
<summary>State Field Dependencies</summary>

Cross-tab validation depends on:

- originTabId: Primary field for ownership tracking
- Quick Tab ID pattern: Secondary fallback (must include tab ID)
- currentTabId: Context parameter for validation
- soloedOnTabs: Override—allow rendering even if originTabId != currentTabId if
  tab is in this list
- mutedOnTabs: Override—hide rendering even if originTabId == currentTabId if
  tab is in this list

All these fields must be present in entity and snapshot for full restoration.
Currently originTabId propagation fails.

</details>

---

**Priority:** Critical (Issues #1-4), High (Issue #5) | **Target:** Single
coordinated PR | **Estimated Complexity:** Medium | **Dependencies:** None (can
fix independently)

**Notes:**

- Issues must be fixed in dependency order: #1 → #3 → #4 → #2 (hydration), but
  all should be in same PR for coherence
- Issue #5 (logging) should be done alongside others to verify fixes work
- Existing minimize operation works correctly (Issue #4 severity is for
  restoration, not minimize)
- Storage architecture and content script handling are correct; issues are
  purely in state field initialization and validation
