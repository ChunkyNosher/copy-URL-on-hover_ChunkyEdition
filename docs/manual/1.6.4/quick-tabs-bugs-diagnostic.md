# Quick Tabs Manager & Restore Bugs – Diagnostic Report

Extension Version: v1.6.3.5-v3  
Date: 2025-12-02  
Scope: Quick Tabs windows, Quick Tabs Manager panel, minimize/restore behavior,
cross-tab behavior, storage synchronization, and logging

---

## Executive Summary

Quick Tabs minimize/restore and Manager behavior in v1.6.3.5-v3 are currently
unstable when multiple browser tabs are open. Restoring a minimized Quick Tab
while the Manager is open can trigger a cross-tab storage storm that temporarily
clears persisted state, empties the Manager list, and desynchronizes the
in-memory Quick Tab map from what is actually rendered on screen. In addition,
restored Quick Tabs can appear in other browser tabs, their position/size and
z-index are not reliably reflected in the Manager, and several critical
diagnostics are missing from logging.

All of these issues are rooted in how Quick Tab state is synchronized across
browser tabs via `browser.storage` and how the Manager and `UICoordinator`
maintain their internal maps, not in the core drag/resize controllers
themselves. The current design still effectively behaves as if cross-tab Quick
Tab sync is enabled, even though user-facing behavior is intended to be per-tab
only.

---

<scope>

Modify (high priority)

- `src/background/handlers/QuickTabHandler.js`
  - Storage `onChanged` handling and cache management
  - Self-write detection and cross-instance filtering
- `src/content.js`
  - Quick Tabs storage write helpers used by Visibility/Update/Destroy handlers
  - Per-tab Quick Tabs instance / origin-tab ownership logic
- `src/ui/quick-tabs/QuickTabsManager.js` (exact path may differ; refers to
  Manager panel implementation)
  - Manager list refresh logic when storage or bus events arrive
  - Manager-side handling of minimize/restore/close actions
- `src/ui/quick-tabs/UICoordinator.js` (or equivalent coordinator for Quick Tab
  windows)
  - `renderedTabs` map lifecycle during minimize/restore
  - Z-index and focus layering after restore

Modify (medium priority)

- `src/storage/` utilities used by Quick Tabs (state validation,
  saveId/transaction tracking)
  - State validation vs. force-empty semantics
  - Handling of zero-tab reads and cooldowns

Do NOT Modify (read-only context for this report)

- Core URL copying logic unrelated to Quick Tabs
- Non–Quick-Tab features (e.g., tooltip-only behavior, basic keyboard shortcuts
  unrelated to Quick Tabs)
- Build configuration, manifest, or packaging logic

</scope>

---

## Issues Overview

| #   | Component                                 | Severity | Short Description                                                  |
| --- | ----------------------------------------- | -------- | ------------------------------------------------------------------ |
| 1   | Cross-tab storage sync / background cache | Critical | Restores trigger 0-tab writes from other tabs, clearing Manager    |
| 2   | Manager list rendering / state sync       | High     | Manager list disappears or stops updating after restore            |
| 3   | Cross-tab Quick Tab rendering             | High     | Restored Quick Tabs appear on other open browser tabs              |
| 4   | Minimize → restore → minimize again       | High     | Re-minimizing and restoring produces duplicates / yellow-only tabs |
| 5   | Position/size persistence vs. Manager     | Medium   | Restored tabs move/resize but Manager stops reflecting changes     |
| 6   | Z-index ordering after restore            | Medium   | Restored Quick Tabs always remain behind newer tabs                |
| 7   | Logging gaps                              | Medium   | Missing Manager/UI/instance-level logging for debugging            |

All issues are closely related and should be addressed together, as they share
storage synchronization and UI coordination as a common foundation.

---

## Issue 1 – Cross-Tab Storage Storm After Restore (Zero-Tab Writes)

### Problem

When a minimized Quick Tab is restored while multiple browser tabs are open, a
cascade of `browser.storage` updates occurs where other tab instances write a
state snapshot containing zero Quick Tabs. This causes:

- The Quick Tabs Manager list to briefly show normal state, then clear out
  entirely.
- Background logs to show repeated "tab count dropped from 2 to 0" warnings and
  "storage corruption cascade" style messages.
- Temporary loss of persisted Quick Tab state until a later write restores the
  correct state.

The user experiences this as the Manager list clearing, even though the Quick
Tabs themselves remain visible on screen.

### Behavioral Evidence (From Logs)

- A restore operation in one tab writes a correct state of `2` Quick Tabs and
  `0` minimized.
- Within a few hundred milliseconds, multiple `storage.onChanged` events are
  observed with:
  - `oldTabCount = 2, newTabCount = 0` and a new `saveId`.
  - Background warnings about a sudden drop from `2` to `0` tabs and potential
    corruption.
- The background script logs multiple distinct `writingInstanceId` values, all
  writing 0-tab states during a cooldown window.

This pattern indicates that several content-script instances, each running in a
different browser tab, are reading stale Quick Tabs state (zero tabs) and
writing it back to shared storage.

### Root Cause (Code-Level Diagnosis)

File: `src/background/handlers/QuickTabHandler.js`  
Location: Storage `onChanged` listener and cache-handling logic

- The background script tracks `writingInstanceId`, `transactionId`,
  `oldTabCount`, and `newTabCount` in logs, but the logic does not fully prevent
  other tab instances from writing stale snapshots back to storage.
- All browser tabs share the same Quick Tabs storage key (`quickTabsStateV2` or
  equivalent) without enforcing a concept of "owner tab" or per-tab namespace.
- Content scripts in non-owner tabs appear to:
  - React to `storage.onChanged` events.
  - Rebuild local state from storage.
  - Potentially schedule debounced persistence operations using their own
    in-memory copies, which may contain `0` tabs if that tab never created Quick
    Tabs.
- The background cooldown logic warns and sometimes defers, but it still ends up
  clearing the cache or treating multiple consecutive 0-tab writes as legitimate
  under some timing sequences.

This leads to a cross-tab write storm: one tab writes `2` tabs; other tabs
overwrite with `0` tabs based on their own stale local state.

### Scope (What Should Change)

- Treat Quick Tabs state as **tab-owned**, not global, or at minimum enforce
  strict self-write detection and owner filtering.
- Ensure that only the tab instance that actually owns/created the Quick Tabs
  (for example, the tab whose `originTabId` matches the current environment) is
  allowed to write Quick Tabs state back to `browser.storage`.
- Ensure the background handler ignores 0-tab writes coming from non-owner
  instances or from content scripts that do not have active Quick Tabs.

### Fix Required (High-Level)

- Introduce a per-instance or per-tab ownership mechanism in both content and
  background layers so that:
  - Only the owner tab persists Quick Tab state.
  - Other tabs either read-only or ignore Quick Tab storage changes entirely.
- Strengthen the `storage.onChanged` handling to explicitly reject or quarantine
  zero-tab writes that do not come from the owner instance and that conflict
  with recent non-empty state.
- Keep background cooldown logic but add explicit checks against owner identity
  and last-known non-empty state, so that a valid `2 → 0` transition only occurs
  during a deliberate "Close All" or equivalent action.

---

## Issue 2 – Manager List Clears or Stops Updating After Restore

### Problem

When the user restores a minimized Quick Tab while the Quick Tabs Manager is
open:

- The restored Quick Tab briefly shows as expected in the Manager list
  (indicator switching from yellow → green), then the entire Manager list
  disappears.
- After the list disappears, the actual Quick Tabs remain on screen, but the
  Manager no longer reflects their state.
- Subsequent position/size changes of the restored Quick Tab do not result in
  visible updates in the Manager.

### Behavioral Evidence

- Logs show:
  - Manager-originated `RESTORE_QUICK_TAB` requests.
  - `VisibilityHandler` and `MinimizedManager` successfully applying stored
    position/size snapshots and calling `tabWindow.restore`.
  - `UICoordinator` receiving `stateupdated` events with
    `isRestoreOperation = true` and `inMap = false`, then creating a new window
    instance and adding it to the `renderedTabs` map.
  - Shortly after, background `storage.onChanged` events report `tabCount`
    changes that temporarily show `0` tabs and trigger warnings, leading to
    cache clear.
- From the user perspective, this matches the 0.5–1 second window where the
  Manager list looks correct, then clears.

### Root Cause (Code-Level Diagnosis)

Files:

- `src/ui/quick-tabs/QuickTabsManager.js` (Manager panel)
- `src/ui/quick-tabs/UICoordinator.js` (Quick Tab windows)
- `src/storage/*` (validation and save ID handling)

Key observations:

- `UICoordinator` maintains a `renderedTabs` map, and logs clearly when entries
  are added or deleted.
- On minimize, `renderedTabs` may be pruned (map size can drop to `0`), leaving
  minimized tabs represented only in storage and `MinimizedManager` snapshots.
- On restore, `UICoordinator` creates a fresh window instance if `inMap = false`
  and uses snapshot data from `MinimizedManager`.
- When the cross-tab storm (Issue 1) temporarily drives the tab count to `0` in
  background cached state, the Manager likely receives storage or bus events
  that cause it to:
  - Rebuild its internal list from a transient 0-tab snapshot.
  - Clear its display, even though `renderedTabs` in the active tab still
    references live Quick Tabs.

Because Manager-specific logging is sparse, the exact failure mode cannot be
observed directly, but the symptoms strongly indicate that the Manager is tied
too closely to transient global storage state rather than to the active tab's
in-memory state.

### Scope (What Should Change)

- Decouple Manager's list from transient global storage snapshots and cross-tab
  writers.
- Ensure Manager primarily reflects **the active tab's Quick Tabs** known to
  that tab's `UICoordinator` and in-memory store.
- Restrict Manager to listen to storage/bus events originating from the same tab
  instance and ignore events that only reflect another tab's temporary 0-tab
  state.

### Fix Required (High-Level)

- Adjust Manager initialization and refresh logic to:
  - Use the local `renderedTabs` map (or a per-tab Quick Tabs data source) as
    the primary truth for what should be displayed.
  - Treat background storage as a persistence layer, not as the single authority
    for active Quick Tabs when other tabs are open.
- Add defensive logic so that a short-lived 0-tab state from storage does not
  cause the Manager list to be cleared unless it is a deliberate "Close All" or
  a known terminal state.
- Ensure that when the Manager is open and a restore occurs, subsequent
  drag/resize operations on that restored Quick Tab continue to publish updates
  to the Manager list.

---

## Issue 3 – Restored Quick Tabs Appearing in Other Browser Tabs

### Problem

After restoring a minimized Quick Tab, that same Quick Tab window can appear in
other open tabs (e.g., in a split-screen Zen Browser layout). This contradicts
the current design, where cross-tab Quick Tab syncing is supposed to be
disabled.

### Behavioral Evidence

- Quick Tabs created in one tab (e.g., Tab A with `originTabId = 629`) later
  appear in another tab (e.g., Tab B) after a restore.
- Logs confirm multiple `writingInstanceId` values for the same Quick Tab state,
  reflecting content scripts active in many tabs.
- The state format includes an `originTabId` field, but this is not being used
  to prevent other tabs from rendering Quick Tabs they do not own.

### Root Cause (Code-Level Diagnosis)

Files:

- `src/content.js`
- `src/ui/quick-tabs/UICoordinator.js`
- `src/background/handlers/QuickTabHandler.js`

Key issues:

- Quick Tabs state is still effectively treated as globally visible to all
  content-script instances.
- No strong gating exists that says "only render this Quick Tab if the current
  tab's ID matches `originTabId`" or equivalent.
- `storage.onChanged` events and state broadcasts are consumed by all content
  scripts without a per-tab filter, so non-owner tabs treat incoming Quick Tabs
  as their own and render them.

### Scope (What Should Change)

- Enforce **per-tab ownership** for Quick Tab rendering and persistence:
  - Use `browser.tabs` APIs and/or a stable tab identifier to bind Quick Tabs to
    a single tab.
  - Ensure content scripts in other tabs only see Quick Tabs that are supposed
    to be visible in that context (or see none at all in the current
    non–cross-sync design).

### Fix Required (High-Level)

- Add a per-tab ownership check in the code path that:
  - Hydrates Quick Tabs from storage.
  - Instantiates `QuickTabWindow` objects via `UICoordinator`.
- Condition Quick Tab rendering on a comparison between the active tab ID and
  each Quick Tab's `originTabId` (or a future `ownerTabId`), skipping creation
  for mismatched tabs.
- Optionally, remove or disable any legacy cross-tab visibility logic until a
  new, robust cross-sync design is reintroduced.

---

## Issue 4 – Minimize → Restore → Minimize Again Creates Duplicates / Yellow-Only Tabs

### Problem

When a Quick Tab is minimized and then restored, and then minimized again via
the Manager:

- The Quick Tab sometimes does not disappear from the screen, even though the
  Manager indicator turns yellow (minimized).
- Attempting to restore the yellow-indicator entry can produce what appears to
  be a duplicate Quick Tab window.

### Behavioral Evidence

From the logs:

- On minimize, `UICoordinator` often removes the Quick Tab from `renderedTabs`
  (`mapSize` goes to 0) and `MinimizedManager` stores a snapshot.
- On restore, `UICoordinator` sees `inMap = false` and `mapSizeBefore = 0`,
  fetches the snapshot from `MinimizedManager`, and creates a new window
  instance, adding it to `renderedTabs`.
- There are multiple `clearSnapshot` calls around restore and later operations
  that can leave `MinimizedManager` with no snapshot for the same ID.

Combined with intermittent cache clears and inconsistent Manager state, this
produces a scenario where the Manager and `UICoordinator` disagree about whether
the tab is minimized or active, and restoring again effectively creates another
instance.

### Root Cause (Code-Level Diagnosis)

Files:

- `src/ui/quick-tabs/UICoordinator.js`
- `src/ui/quick-tabs/MinimizedManager.js` (or equivalent)
- `src/ui/quick-tabs/QuickTabsManager.js`

Key points:

- Minimize removes the Quick Tab from `renderedTabs` and tracks it via
  `MinimizedManager` snapshots.
- Restore uses a unified "fresh render" path that recreates the window entirely
  when `inMap = false`.
- When subsequent events (like storage clears, cross-tab storms, or extra
  `clearSnapshot` calls) desynchronize `MinimizedManager` vs. `renderedTabs`,
  the Manager may still think a Quick Tab is minimized (yellow), even though a
  window is already visible.
- A second restore request then causes another new window instance to be created
  for the same logical Quick Tab, leading to visible duplicates.

### Scope (What Should Change)

- Make the relationship between `renderedTabs` and `MinimizedManager` strictly
  one-to-one and robust against repeated minimize/restore cycles.
- Ensure that a Quick Tab can never be simultaneously considered minimized
  (yellow in Manager) and active (visible window) from the system's point of
  view.

### Fix Required (High-Level)

- Introduce stronger invariant checks around minimize/restore:
  - Before minimizing, confirm that `renderedTabs` contains the tab and that
    `MinimizedManager` has no existing snapshot for that ID.
  - Before restoring, confirm that either the tab is in `MinimizedManager`
    **or** in `renderedTabs`, but not both.
- Make restore idempotent for a given tab ID during a short time window so that
  multiple restore signals do not create multiple window instances.
- Ensure Manager state is updated atomically together with `renderedTabs` and
  `MinimizedManager` transitions.

---

## Issue 5 – Restored Tab Position/Size Stop Updating in Manager

### Problem

After a tab is minimized and restored, the user can still drag and resize it,
but its position and size no longer update in the Quick Tabs Manager. The
Manager effectively "freezes" that tab's geometry after the first restore.

### Behavioral Evidence

- Logs show `QuickTabWindow` drag/resize events firing for the restored tab and:
  - `onPositionChangeEnd` and `onSizeChangeEnd` callbacks executing.
  - `UpdateHandler` updating the tab position/size in the in-memory map and
    scheduling storage persistence.
  - Background `storage.onChanged` events confirming new `saveId` values with
    unchanged tab counts.
- However, there is no corresponding Manager-side log indicating that the
  geometry was re-read or rendered in the list after restore.
- This matches the user experience of the Manager no longer reflecting changes
  post-restore.

### Root Cause (Code-Level Diagnosis)

Files:

- `src/ui/quick-tabs/QuickTabsManager.js`
- `src/ui/quick-tabs/UICoordinator.js`
- `src/storage/*` (state validation)

Key points:

- The post-restore code path reconstructs the Quick Tab via a new
  `QuickTabWindow` instance and updates storage, but the Manager does not seem
  to subscribe consistently to:
  - `stateupdated` events for restore-created instances, or
  - Post-restore storage changes as a trigger to re-render geometry.
- Manager/Coordinator coupling is likely missing an explicit "geometry changed"
  event or is only partially wired for the restore path.

### Scope (What Should Change)

- Ensure that any geometry change (position or size) after restore goes through
  the same notification path that the Manager already uses for initial
  create/drag/resize actions.
- Guarantee that restore-created windows are fully integrated into Manager's
  update subscriptions.

### Fix Required (High-Level)

- Audit Manager subscriptions to:
  - `stateupdated` bus events from `UICoordinator`.
  - Storage changes that indicate new geometry.
- For restore operations, explicitly ensure that once a tab is re-rendered and
  reinserted into `renderedTabs`, Manager receives and processes the same update
  events as it would for a non-restored tab.
- Avoid using restore-specific flags (`isRestoreOperation`) to skip Manager
  updates unless there is a very strong reason; instead, treat restore as
  another state change that Manager must display.

---

## Issue 6 – Z-Index Ordering After Restore

### Problem

Restored Quick Tabs do not always come to the front correctly:

- A newly created Quick Tab or a non-restored tab tends to appear on top of a
  restored tab, even after the restored tab has been dragged or focused.
- The user perceives this as restored tabs always being "behind" others in
  z-order, even when they are the most recently interacted-with window.

### Behavioral Evidence

- Creation logs show z-index values like `1000001`, `1000003`, etc., for initial
  Quick Tabs.
- Restore logs show the restored tab being created with a z-index like
  `1000007`.
- However, subsequent focus or drag events do not clearly show z-index being
  incremented or re-applied for the restored tab in a way that dominates newer
  tabs.
- Manager behavior and z-index tests described in the scenarios suggest the
  intended layering is:
  - Manager on top of all Quick Tabs.
  - Most recently focused Quick Tab on top within the Quick Tab stack.

### Root Cause (Code-Level Diagnosis)

Files:

- `src/ui/quick-tabs/UICoordinator.js`
- `src/ui/quick-tabs/VisibilityHandler.js` (or equivalent focus handler)

Key points:

- Restore path uses a "fresh render" approach, assigning a z-index based on
  saved or computed state.
- Subsequent focus events may not correctly bump the z-index of the restored
  window if the coordination logic assumes only non-restored windows participate
  in z-index updates.
- There may be hidden assumptions around `mapSize`, transaction snapshots, or
  `domVerified` flags that prevent z-index recalculation from running for
  restore-created instances.

### Scope (What Should Change)

- Treat restored windows as fully participating in the z-index focus algorithm.
- Ensure that clicking or dragging a restored window triggers the same "bring to
  front" path that was used for non-restored tabs.

### Fix Required (High-Level)

- Verify that the focus handling code path in `VisibilityHandler` or
  `UICoordinator` does not special-case restored windows in a way that skips
  z-index updates.
- Ensure that z-index increments are applied consistently, independent of
  whether a window was recently restored or newly created.

---

## Issue 7 – Missing or Incomplete Logging

### Problem

The current logging is excellent for background storage, drag/resize, and some
minimize/restore operations, but several key areas are either under-logged or
not logged at all. This makes it difficult to diagnose:

- Which tab instance is actually responsible for a given storage write.
- How the Manager builds and updates its Quick Tab list.
- Whether `renderedTabs` and `MinimizedManager` are in sync after complex
  sequences.

### Missing Logging Areas

1. **Manager UI State and Updates**
   - No explicit logs when the Manager:
     - Receives a fresh Quick Tabs state snapshot.
     - Decides to clear or rebuild its list.
     - Updates the indicator color for a Quick Tab (yellow vs. green).
     - Reflects position/size changes.
   - Without these logs, it is impossible to see exactly why the Manager list
     disappears after a restore.

2. **Content Script / Instance Identity**
   - Background logs include `writingInstanceId`, but there is no mapping from
     instance ID to browser tab ID or URL.
   - There are no logs when a content script instance initializes, attaches to a
     tab, or decides to participate in Quick Tabs features.
   - This hides which browser tabs are contributing 0-tab writes during storage
     storms.

3. **UICoordinator Map Consistency**
   - Logs show map size changes (e.g., `mapSizeBefore`, `mapSizeAfter`) on
     individual operations.
   - There is no periodic or post-operation verification log that prints the
     full set of keys in `renderedTabs` and their basic state.
   - This makes it easier for subtle desynchronizations between `renderedTabs`,
     `MinimizedManager`, and Manager to go unnoticed.

4. **Storage Event Source Filtering**
   - Background logs show decisions around cooldowns and zero-tab reads, but do
     not clearly log whether:
     - A given `storage.onChanged` event is considered owner vs. non-owner.
     - A 0-tab write was quarantined because it came from a non-owner instance.
   - This makes it difficult to confirm that new filtering logic is working as
     expected.

5. **Restore-Path-Specific Decisions**
   - While restore operations log a lot at `UICoordinator` and
     `MinimizedManager` levels, there is little high-level logging that
     summarizes:
     - Whether a restore reused an existing window vs. created a new one.
     - Whether Manager and storage were both updated in response.

### Scope (What Should Change)

- Expand logging in Manager and `UICoordinator` to give a concise but complete
  picture of:
  - Manager list contents after each significant event.
  - Mappings between instance IDs, tab IDs, and active Quick Tabs.
  - Key decisions around ignoring or accepting storage changes.

### Fix Required (High-Level)

- Add targeted, low-noise log statements in the following places:
  - Manager panel: after each list rebuild, after each item update, and when the
    list becomes empty.
  - Content script initialization: log the tab ID, URL, and a stable instance
    ID, and whether Quick Tabs features are enabled in that tab.
  - Background storage handler: log explicit accept/reject decisions for each
    `storage.onChanged` event, including whether it was treated as owner or
    non-owner, and whether it was a 0-tab write.
  - `UICoordinator`: add a summary log whenever `renderedTabs` transitions from
    non-empty to empty, or vice versa, including all keys involved.

These logging improvements will not change behavior directly but will make it
significantly easier to validate the fixes for Issues 1–6 and to diagnose any
remaining edge cases.

---

<acceptancecriteria>

- Restoring a Quick Tab while the Manager is open no longer clears the Manager
  list unless the underlying state truly has zero tabs due to an intentional
  "Close All" or equivalent action.
- Quick Tabs only appear in the tab(s) they are supposed to appear in under the
  current non–cross-tab design; restoring a tab in one browser tab does not
  cause it to appear in unrelated tabs.
- Minimize → restore → minimize again does not create duplicates or leave
  visible windows marked as minimized-only in the Manager.
- After restore, dragging or resizing a Quick Tab continues to update its
  position/size in the Manager within the expected debounce window.
- Z-index behavior matches the intended layering rules: restored tabs can be
  brought to front normally, and Manager remains on top of all Quick Tabs when
  open.
- Background logs show zero-tab writes being accepted only when they are
  intentional (e.g., after "Close All") and rejected or ignored when they come
  from non-owner or stale instances.
- New logging clearly shows Manager list contents, tab-to-instance mapping, and
  storage filtering decisions, making it straightforward to confirm correct
  behavior in future log captures.

</acceptancecriteria>
