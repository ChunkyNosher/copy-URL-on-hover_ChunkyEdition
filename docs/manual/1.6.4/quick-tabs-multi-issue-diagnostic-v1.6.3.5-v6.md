Quick Tabs Multi-Issue Diagnostic Report Extension Version v1.6.3.5-v6 Date
2025-12-03 Scope Quick Tabs visibility, restore, minimized state, storage sync,
and Quick Tab Manager behaviors while Quick Tab Manager is open.

---

Executive Summary

Quick Tabs in v1.6.3.5-v6 still exhibit multiple, tightly related issues around
minimize/restore, state synchronization, rendering scope, and storage/manager
reconciliation. These issues span the content-side Quick Tabs stack
(UICoordinator, VisibilityHandler, MinimizedManager, QuickTabWindow, event bus)
and the background/storage logic, and they surface most clearly when the Quick
Tab Manager is open.

From log traces and current code, the root problems cluster around:

- Incomplete isolation of Quick Tabs per browser tab, causing restored Quick
  Tabs to show up in other tab contexts.
- Desynchronization between renderedTabs, MinimizedManager snapshots, and the
  global storage state, leading to duplicated windows, stale minimized entries,
  and manager indicators that do not match reality.
- Z-index and focus logic that does not reliably ensure a restored Quick Tab is
  on top of other windows.
- Storage and cache-clearing logic that is global and cross-context, so "Close
  All" and "Clear Quick Tab Storage" do not reliably eradicate all Quick Tab
  instances and stale state.
- Gaps in logging around per-tab scoping and the Quick Tab Managers list, making
  it hard to see which context is taking which action.

All of these issues share the same feature context: Quick Tabs lifecycle and
Manager behavior, so they are documented together here.

---

Issues Overview Table

| Issue | Component                                              | Severity | Core Problem                                                                                                                                                                               |
| ----- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Cross-tab rendering / scoping                          | Critical | Restored Quick Tabs appear in other open browser tabs even though cross-tab sync is supposed to be disabled.                                                                               |
| 2     | Minimizerestoreminimize via Manager                    | High     | Manager minimize after a restore leaves corrupted state: yellow indicator, non-disappearing window, and potential duplicate re-renders.                                                    |
| 3     | Position/size updates after restore                    | High     | After minimize+restore, Quick Tab drag/resize no longer reliably updates position/size in storage or in the Manager.                                                                       |
| 4     | Z-index and stacking order                             | Medium   | Restored Quick Tabs can appear behind newer windows, even when they were the most recently interacted window.                                                                              |
| 5     | Repeated Last sync updates after restore               | Medium   | Restore actions and subsequent storage thrashing cause repeated storage writes, making the Managers "Last sync" update every few seconds.                                                  |
| 6     | Clear Quick Tab Storage incomplete                     | High     | "Clear Quick Tab Storage" clears windows on screen but does not fully clear the Manager list or all underlying state.                                                                      |
| 7     | Phantom Quick Tabs surviving Close All / Clear Storage | Critical | Some Quick Tabs (including cross-tab ones) survive both "Close All" and "Clear Quick Tab Storage" due to cross-context state rehydration.                                                  |
| 8     | Storage transaction and zero-tab cooldown thrashing    | Medium   | Background cache-clearing, zero-tab read heuristics, and transaction fallbacks cause oscillation between empty and non-empty storage, amplifying many of the above issues.                 |
| 9     | Snapshot / MinimizedManager inconsistencies            | High     | Mismatches between minimized snapshots, pending-clear snapshots, and renderedTabs allow multiple fresh renders of the same ID and stale minimized entries.                                 |
| 10    | Missing logging coverage                               | Medium   | Key flows (per-tab scoping, Manager list contents, and global actions like Close All / Clear Storage) are not fully logged, hiding the source of cross-context behavior and stale entries. |

Why bundled: All issues affect the same Quick Tabs feature, share the same
storage/event architecture, and typically manifest while the Quick Tab Manager
is open. Fixing them will likely require coordinated changes to
VisibilityHandler, UICoordinator, MinimizedManager, the Manager UI, and
background storage logic.

<scope>
Modify
- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/handlers/VisibilityHandler.js
- src/features/quick-tabs/minimized-manager.js
- src/features/quick-tabs/handlers/UpdateHandler.js
- src/features/quick-tabs/handlers/DestroyHandler.js
- src/features/quick-tabs/handlers/CreateHandler.js
- background.js (Quick Tabs storage and zero-tab / cache-clearing logic)
- popup.js or sidebar/Quick Tab Manager UI code (Manager list, indicators, and buttons)

Do NOT Modify

- Non-Quick-Tab features (URL copying, notifications, unrelated background
  listeners)
- Test harness and Playwright configs except where explicitly needed to cover
  these Quick Tab behaviors </scope>

---

Issue 1: Restored Quick Tabs Still Appear in Other Tabs (Cross-Tab Rendering)

Problem

Even though cross-tab Quick Tab sync was removed in v1.6.3, restored Quick Tabs
can still appear in other open browser tabs (for example, in Zen Browser
split-screen scenarios). A Quick Tab restored in one tab context sometimes shows
up rendered in a different tab, even when Quick Tab Manager is only open in one.

Root Cause

File

- src/features/quick-tabs/coordinators/UICoordinator.js
- background.js (Quick Tab storage management and onChanged handling)

Location (conceptual)

- UICoordinator.render(), update(), setupStateListeners(),
  reconcileRenderedTabs()
- Background storage.onChanged listener and zero-tab / cache-clearing logic

What is going wrong

- UICoordinator is designed as a per-tab rendering authority but it responds to
  generic state:updated events that do not encode the originating browser tab or
  a strict per-tab scope.
- The stateManager behind UICoordinator reflects a unified quicktabsstatev2 from
  storage, which is shared across all extension contexts in that profile.
- When VisibilityHandler emits state:updated for a restore, each tab that has
  the Quick Tabs content script and UICoordinator listening to the same event
  bus can see the updated entity and decide to render it.
- In update(), when isRestoreOperation is true and the entity is not minimized,
  \_handleRestoreOperation forces a restore via unified fresh render path,
  potentially creating a window in any context that has that ID in its
  StateManager regardless of which browser tab actually owns it.
- The code relies on comments stating "single-tab Quick Tabs only" but does not
  consistently enforce originTabId/currentTabId scoping in UICoordinator,
  stateManager, or in the event payloads.
- Background logic still aggressively reads and writes unified quicktabsstatev2
  and, on storage change, may hydrate entities into multiple contexts without
  per-tab filtering.

High-level behavior

- Quick Tab entities remain globally visible to all tabs running the extension
  because storage is global and state listeners are not fully scoped.
- Any context with UICoordinator + stateManager listening to state:updated can
  choose to render a restored Quick Tab irrespective of the tab it originated
  from.

Fix Required (conceptual)

- Enforce strict per-tab scoping for Quick Tabs at the state/event level.
- Ensure UICoordinator only renders Quick Tabs whose originTabId (or equivalent)
  matches the current tab context, and avoid rendering entities that belong to
  other tabs.
- Ensure background and storage.onChanged logic do not indiscriminately
  rehydrate Quick Tabs into all contexts.

Issue 2: Minimize  Restore  Minimize via Manager Creates Stale State and
Duplicates

Problem

When a Quick Tab is minimized, restored, and then minimized again via the Quick
Tab Manager:

- The on-screen Quick Tab sometimes does not disappear when it should.
- The Manager indicator turns yellow and may not reflect the actual on-screen
  state.
- Restoring the yellow-indicator tab can lead to duplicate instances of the same
  Quick Tab.

Root Cause

File

- src/features/quick-tabs/handlers/VisibilityHandler.js
- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/minimized-manager.js

Location (conceptual)

- VisibilityHandler.handleMinimize(), handleRestore(), \_debouncedPersist()
- UICoordinator.update(), \_handleManagerMinimize(), \_handleRestoreOperation(),
  \_handleDetachedDOMUpdate()
- MinimizedManager snapshot add/restore/clear operations

What is going wrong

- On first minimize, VisibilityHandler:
  - Sets tabWindow.minimized = true and domVerified = false.
  - Adds a snapshot to MinimizedManager and calls tabWindow.minimize().
  - Emits state:updated with minimized = true, then debounces a storage persist.
- UICoordinator sees the state:updated event with source "Manager" or "UI" and,
  in update(), hits the Manager minimize early path, which deletes the Map entry
  and stops DOM monitoring, but MinimizedManager still holds a snapshot.
- On restore, VisibilityHandler.handleRestore():
  - Updates entity.minimized = false and calls minimizedManager.restore(id).
  - Calls tabWindow.restore() when a tabWindow exists.
  - Emits state:updated with isRestoreOperation = true and domVerified based on
    a quick DOM check.
- UICoordinator.update() sees isRestoreOperation = true, and
  \_handleRestoreOperation() always deletes any existing Map entry and then
  calls render(quickTab) via the unified fresh render path.
- During this sequence, MinimizedManager snapshots can be moved into
  pending-clear and then cleared, but subsequent minimize/restore operations
  re-add and clear snapshots multiple times.
- On the second minimize via the Manager, the Manager-side minimize path may
  delete renderedTabs entries while MinimizedManager is holding fresh snapshots,
  then storage thrashing and further state:updated events cause additional
  restore render paths to fire, creating new QuickTabWindow instances for the
  same id.

High-level behavior

- The combination of:
  - Manager-specific minimize cleanup (Map deletion),
  - Unified restore path always deleting Map entries,
  - Multiple restore attempts with snapshots being re-added and cleared,
  - And storage-based rehydration,

  allows the same Quick Tab ID to be rendered multiple times or to exist in
  inconsistent states between MinimizedManager and renderedTabs.

Fix Required (conceptual)

- Ensure Manager-initiated minimize/restore paths consistently synchronize
  MinimizedManager snapshots, renderedTabs entries, and entity.minimized state
  without leaving stale or duplicate entries.
- Make Manager-specific minimize behavior and the unified restore path
  coordinate rather than both independently deleting or re-creating Map entries
  for the same ID.

Issue 3: Position and Size Stop Updating After Minimize+Restore

Problem

After minimizing and then restoring a Quick Tab, further drag or resize
operations on that tab often stop updating the Quick Tab Managers position/size
display. The window moves and resizes visually, but the Manager and/or storage
no longer reflect those changes.

Root Cause

File

- src/features/quick-tabs/handlers/UpdateHandler.js
- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/window.js (QuickTabWindow implementation)
- src/features/quick-tabs/handlers/VisibilityHandler.js (persist behavior)
- background.js (storage handling)

Location (conceptual)

- UpdateHandler callbacks for onPositionChangeEnd and onSizeChangeEnd
- UICoordinator.update() and normal update path
- VisibilityHandler.\_debouncedPersist() and \_persistToStorage()

What is going wrong

- Prior to minimize/restore, drag/resize sequences invoke QuickTabWindow
  callbacks that feed into UpdateHandler, which updates entity position/size and
  then schedules a persist via storage-utils.
- After minimize+restore cycles, the relationships between:
  - QuickTabWindow instance,
  - renderedTabs Map entry,
  - StateManager entity,
  - and the stored quicktabsstatev2

  may no longer be consistent.

- In some sequences, UICoordinator update paths for detached DOM or state
  mismatch delete and recreate Map entries for the same id, potentially
  replacing the QuickTabWindow instance or losing the wiring between window
  callbacks and UpdateHandler.
- When the background storage logic starts emitting warnings about tab count
  dropping to 0 and clearing cache, some of these state updates get dropped or
  treated as no-ops because the unified state is in a transient or
  partially-cleared state.
- As a result, the manager and/or storage do not receive reliable new
  position/size writes after the restore, even though the user continues to
  drag/resize.

Fix Required (conceptual)

- Ensure that after any minimize+restore sequence, the QuickTabWindow instance
  linked to UpdateHandler and renderedTabs is stable and correctly wired.
- Ensure UpdateHandlers position/size end handlers always result in valid
  updates to the StateManager and a corresponding storage persist, regardless of
  previous storage clearing or cache oscillation.

Issue 4: Z-Index and Stacking Order Inconsistent After Restore

Problem

Restored Quick Tabs are supposed to appear on top of other Quick Tabs, but in
practice, a newly created or non-restored Quick Tab can sit above a recently
restored tab. Dragging or focusing the restored tab does not always bring it to
the true top of the stack.

Root Cause

File

- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/handlers/VisibilityHandler.js

Location (conceptual)

- UICoordinator.\_getNextZIndex(), \_applyZIndexAfterRestore(), \_createWindow()
- VisibilityHandler.handleFocus()

What is going wrong

- UICoordinator tracks a highest z-index in memory and applies an incremented
  value when creating or rendering windows. This is meant to ensure stacking
  order is consistent.
- \_applyZIndexAfterRestore() specifically applies a new z-index during
  \_renderRestoredWindow(), but this logic is only invoked in certain restore
  paths.
- VisibilityHandler.handleFocus() also increments a shared currentZIndex
  reference and updates a tabs z-index, but these increments are not necessarily
  synchronized with UICoordinators \_highestZIndex.
- When Quick Tabs are created and restored in different orders and from
  different contexts, z-index values derived from these separate counters can
  produce situations where a newly created tab has a higher z-index than a
  restored tab that logically should be on top.

Fix Required (conceptual)

- Ensure there is a single, authoritative z-index source for Quick Tabs in a
  given tab context.
- Ensure that all restore and focus paths consistently use that source to assign
  a strictly higher z-index to the most recently brought-to-front tab.

Issue 5: Restore Triggers Repeated Storage Writes and Last Sync Flicker

Problem

Pressing the restore button on a minimized Quick Tab causes the "Last sync"
indicator in the Quick Tab Manager to update every few seconds, even when the
user is not performing further actions. This suggests repeated storage writes or
cache churn following a restore.

Root Cause

File

- src/features/quick-tabs/handlers/VisibilityHandler.js
- background.js (quicktabsstatev2 storage handling, onChanged, zero-tab and
  cache-clearing logic)

Location (conceptual)

- VisibilityHandler.\_debouncedPersist(), \_persistToStorage()
- Background storage.onChanged listeners and zero-tab read / cache-clearing
  heuristics

What is going wrong

- handleRestore() and \_verifyRestoreAndEmit() always call \_debouncedPersist()
  after emitting state:updated for the restore operation.
- \_debouncedPersist() schedules a storage write of the entire Quick Tabs state
  using buildStateForStorage and persistStateToStorage.
- Background logic subscribes to storage.onChanged for the quicktabsstatev2 key
  and reacts by reading and updating its internal cache, sometimes logging
  warnings about tab count dropping to 0 and performing cache-clearing or
  rehydration.
- When multiple contexts are doing similar writes or when the zero-tab and
  cooldown heuristics are triggered, storage can oscillate between empty and
  non-empty states, causing repeated onChanged events and further writes.
- The Managers "Last sync" indicator appears to be tied to these storage change
  events, so the user sees sync timestamps updating repeatedly after a single
  restore action.

Fix Required (conceptual)

- Make restore-related persistence more stable by avoiding unnecessary re-writes
  of identical state and by harmonizing the background zero-tab and
  cache-clearing heuristics with the content-side debounced persists.
- Ensure that post-restore storage writes stabilize quickly rather than
  oscillating due to multiple contexts re-writing or clearing state.

Issue 6: Clear Quick Tab Storage Does Not Fully Clear Manager State

Problem

The "Clear Quick Tab Storage" button clears visible Quick Tabs from the screen
but does not fully clear the Quick Tab Manager list or all underlying Quick Tab
instances. Some entries remain in the Manager, and phantom tabs can still be
present in internal state even when no windows are visible.

Root Cause

File

- popup.js or sidebar/Quick Tab Manager UI code (Clear Quick Tab Storage
  behavior)
- background.js (Quick Tab storage clearing and zero-tab handling)
- src/features/quick-tabs/coordinators/UICoordinator.js (reconcileRenderedTabs
  and Map clearing)
- src/features/quick-tabs/minimized-manager.js (snapshot and minimized tab
  clearing)

Location (conceptual)

- Manager button handler for "Clear Quick Tab Storage"
- Background logic that clears quicktabsstatev2 when it detects 0 tabs
- UICoordinator.reconcileRenderedTabs(), \_safeClearRenderedTabs(), and
  destroy()

What is going wrong

- Clear Quick Tab Storage currently focuses on clearing the unified storage key
  and possibly some DOM, but it does not necessarily:
  - Clear all MinimizedManager snapshots for all Quick Tab IDs.
  - Clear all renderedTabs entries in every active content context.
  - Clear the Managers list of Quick Tab entries (which may be driven by its own
    local representation or by a partially-cleared state).
- UICoordinator has \_safeClearRenderedTabs and reconcileRenderedTabs helpers,
  but these are not clearly wired to the Managers Clear Storage action in every
  context.
- Background cache-clearing logic may clear quicktabsstatev2 in one moment and
  then rehydrate it from another context that still has Quick Tabs in
  quickTabsMap and MinimizedManager.

Fix Required (conceptual)

- Treat Clear Quick Tab Storage as a global, authoritative destruction path for
  all Quick Tab state: storage, renderedTabs, MinimizedManager snapshots, and
  Manager list entries.
- Ensure that after a successful Clear Storage action, no Quick Tab or snapshot
  remains in any context, and the Manager list is fully empty.

Issue 7: Phantom Quick Tabs Survive Close All and Clear Storage

Problem

Some Quick Tabs, particularly those involved in cross-tab behavior described in
Issue 1, remain visible or reappear even after the user presses both "Close All"
and "Clear Quick Tab Storage." These phantom Quick Tabs are confusing and
undermine the users expectation that those actions should fully reset the Quick
Tabs feature.

Root Cause

File

- background.js (quicktabsstatev2 management, zero-tab heuristic,
  cache-clearing)
- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/minimized-manager.js
- popup.js / Manager UI actions for Close All and Clear Storage

Location (conceptual)

- Background logic that detects tab count dropping to 0 and decides when to
  clear cache versus deferring or rejecting clears.
- UICoordinator.reconcileRenderedTabs() and \_safeClearRenderedTabs()
- MinimizedManager clearAll/clearSnapshot operations

What is going wrong

- When Close All or Clear Storage is invoked in one context, that context may
  clear quicktabsstatev2 or its local structures.
- Another content script or tab that still holds Quick Tabs in quickTabsMap or
  MinimizedManager can later re-persist its own view of the state into
  quicktabsstatev2, effectively resurrecting previously "cleared" Quick Tabs.
- UICoordinator and MinimizedManager do not currently treat Close All and Clear
  Storage as globally final for Quick Tabs; they may continue to hold references
  in renderedTabs or snapshot maps, which can rejoin state once background sees
  non-zero tabs again.

Fix Required (conceptual)

- Implement a coordinated global clearing protocol for Quick Tabs so that Close
  All and Clear Storage cannot be undone by another context still holding stale
  state.
- Ensure that every Quick Tab instance and snapshot is destroyed and every
  renderedTabs entry is removed across all contexts as part of those actions.

Issue 8: Storage Transaction and Zero-Tab Cooldown Thrashing

Problem

The background storage layer repeatedly logs warnings such as "Tab count dropped
from N to 0" and toggles between clearing cache and deferring or rejecting
clears due to a cooldown heuristic. This thrashing behavior interacts badly with
content-side debounced persists and can cause Quick Tab state to oscillate
between empty and non-empty.

Root Cause

File

- background.js

Location (conceptual)

- Storage listeners for quicktabsstatev2
- Zero-tab detection and cooldown logic
- Transaction fallback cleanup that runs when storage.onChanged is not observed
  as expected

What is going wrong

- The background script attempts to detect when quicktabsstatev2 is truly empty
  and clear its cache accordingly, but it also guards against clearing during
  transient transaction windows by using a cooldown and multiple zero-tab reads.
- When many minimize/restore or close/clear operations occur in quick
  succession, and when multiple contexts perform writes, the count can
  legitimately flicker between 0 and some non-zero value.
- The zero-tab heuristics and transaction fallback path can both try to clear or
  re-read state frequently, which leads to repeated warnings and internal churn.
- This churn feeds back into the content-side logic, because each storage write
  leads to onChanged events and further state updates in each context.

Fix Required (conceptual)

- Make background quicktabsstatev2 management more robust to transient zero-tab
  states caused by in-progress transactions and multi-context writes.
- Avoid repeated clears and rehydrations in short windows of time, and ensure
  that the decision to clear or keep state is consistent and stable.

Issue 9: Snapshot / MinimizedManager Inconsistencies and Duplicate Renders

Problem

Snapshots and minimized state in MinimizedManager do not always align with
renderedTabs and the actual DOM. This can lead to multiple renders for the same
Quick Tab ID, missing snapshots when they are expected, and unexpected "no
snapshot found" warnings.

Root Cause

File

- src/features/quick-tabs/minimized-manager.js
- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/handlers/VisibilityHandler.js

Location (conceptual)

- MinimizedManager.add(), restore(), getSnapshot(), hasSnapshot(),
  clearSnapshot()
- UICoordinator.\_scheduleSnapshotClearing(), \_applySnapshotForRestore(),
  \_tryApplySnapshotFromManager(), \_tryApplyDimensionsFromInstance()
- VisibilityHandler.handleMinimize(), handleRestore(), \_verifyRestoreAndEmit()

What is going wrong

- MinimizedManager maintains:
  - Active minimizedTabs entries,
  - Pending-clear snapshot maps,
  - And isMinimized()/hasSnapshot()/getSnapshot()/clearSnapshot APIs.
- UICoordinator and VisibilityHandler both participate in snapshot lifecycle:
  - VisibilityHandler adds snapshots via minimizedManager.add() before
    minimizing.
  - MinimizedManager.restore() applies snapshots back during restore.
  - UICoordinator also uses hasSnapshot()/getSnapshot() to apply position/size
    during restore.
  - UICoordinator then eagerly clears snapshots, sometimes both immediately and
    via delayed verification timers.
- Under high-frequency minimize/restore cycles and cross-context writes, the
  same IDs snapshot can be:
  - Cleared earlier than some code paths expect.
  - Still present when UICoordinator expects it to be gone.
  - Logged as "clearSnapshot called but no snapshot found" indicating a mismatch
    between expected and actual internal state.
- These inconsistencies contribute to the ability to render the same Quick Tab
  ID more than once, re-add snapshots that should be gone, or attempt restoral
  from snapshots that no longer exist.

Fix Required (conceptual)

- Treat MinimizedManager as the single source of truth for minimized state, and
  ensure that only one layer (not both UICoordinator and VisibilityHandler) owns
  the timing and semantics of snapshot clearing for each ID.
- Guarantee that every minimize+restore cycle has a clearly defined snapshot
  lifecycle: when snapshots are created, when they are consumed, and when they
  are finally cleared.

Issue 10: Missing Logging Around Per-Tab Scoping and Manager State

Problem

While logging is extensive for many Quick Tab internals, there are still
important blind spots that make it hard to reason about cross-tab behavior,
Manager list state, and global actions like Close All and Clear Storage.

Root Cause

File

- src/features/quick-tabs/coordinators/UICoordinator.js
- src/features/quick-tabs/handlers/VisibilityHandler.js
- src/features/quick-tabs/minimized-manager.js
- background.js
- Manager UI code (popup.js or sidebar quick tab manager script)

Location (conceptual)

- UICoordinator.setupStateListeners(), update(), render(), \_handleNotInMap(),
  reconcileRenderedTabs()
- Manager UI event handlers for Close All, Clear Quick Tab Storage, and
  per-entry operations
- Background quicktabsstatev2 clear / rehydrate paths

What is missing

- No explicit logging of which browser tab context (tabId) UICoordinator is
  running in when it decides to render, restore, or destroy a Quick Tab.
- No explicit logging of the Managers internal list contents (entries, their
  status, whether indicators are red/yellow/green) when it updates, so there is
  no direct correlation between Manager UI state and underlying quickTabsMap /
  renderedTabs / storage.
- No explicit, consolidated action log when the user clicks "Close All" or
  "Clear Quick Tab Storage" that enumerates the IDs affected and confirms that
  each layer (renderedTabs, MinimizedManager, storage, Manager list) processed
  the action.

Fix Required (conceptual)

- Add explicit per-tab and per-context logging so cross-tab leaks and duplicate
  renders can be tied back to a specific context decision.
- Add logging in the Manager UI whenever it changes its list or indicator
  colors, including the source event (e.g., storage.onChanged, state:updated, or
  user button click).
- Add high-level logs for Close All and Clear Quick Tab Storage that show which
  Quick Tab IDs are being destroyed and what state each layer is left in
  afterward.

<acceptancecriteria>
Issue 1: Cross-Tab Rendering
- Restoring a Quick Tab in one browser tab never causes that Quick Tab to render in any other browser tab.
- Quick Tabs are scoped to the tab where they were created (or an explicitly defined scope), and this is enforced at the state and rendering layers.

Issue 2: Manager Minimize/Restore/Minimize

- Minimizing a Quick Tab via the Manager always removes the on-screen window and
  marks the Manager indicator as minimized without leaving duplicates.
- Restoring a minimized Quick Tab from the Manager produces exactly one visible
  Quick Tab window with consistent state and no ghost entries.
- A second minimize via the Manager after a restore does not create duplicates
  or leave the Quick Tab in a half-minimized, half-rendered state.

Issue 3: Position/Size Updates After Restore

- After any sequence of minimize and restore, dragging or resizing a Quick Tab
  continues to update position and size in storage and in the Manager.
- The Managers displayed position and size match the last user interaction and
  survive page reload and extension reload.

Issue 4: Z-Index and Stacking Order

- The most recently restored or focused Quick Tab always appears above all other
  Quick Tabs in that tab context.
- No Quick Tab can remain visually on top when another Quick Tab has just been
  restored or focused.

Issue 5: Restore and Last Sync Behavior

- After a restore, the Managers "Last sync" indicator stops updating within a
  short, predictable window once state settles.
- Repeated Last sync updates do not occur every few seconds in the absence of
  new user actions.

Issue 6: Clear Quick Tab Storage

- Pressing "Clear Quick Tab Storage" removes all Quick Tabs from screen,
  storage, MinimizedManager, and the Manager list across all contexts.
- No Quick Tab entities or snapshots remain in any internal structures after
  Clear Storage completes.

Issue 7: Phantom Quick Tabs

- After a "Close All" followed by "Clear Quick Tab Storage," there are no
  visible Quick Tabs and no way for phantom Quick Tabs to reappear without
  explicit user actions.
- Background logs no longer show rehydration of cleared IDs from stale contexts.

Issue 8: Storage and Zero-Tab Thrashing

- Background no longer logs repeated "tab count dropped from N to 0" messages
  for the same operation burst.
- Zero-tab heuristics do not oscillate between clearing and rehydrating
  quicktabsstatev2 during normal operations.

Issue 9: Snapshot and Minimized State

- For any Quick Tab, each minimize+restore cycle has a clear, single snapshot
  lifecycle: snapshot created at minimize, consumed at restore, then cleared
  once used.
- There are no "clearSnapshot called but no snapshot found" warnings in normal
  operation.

Issue 10: Logging Coverage

- Logs clearly attribute each Quick Tab operation (create, minimize, restore,
  focus, destroy) to the specific browser tab context.
- Manager logs show exact list entries and indicator status when state changes.
- Close All and Clear Storage actions log which Quick Tab IDs were affected and
  confirm full cleanup at all layers.

All Issues

- All existing tests pass.
- New tests are added (unit/integration/Playwright) to cover key
  minimize/restore, Manager, and Clear Storage flows across multiple tabs.
- No new console errors or unhandled promise rejections appear during normal
  Quick Tab usage. </acceptancecriteria>
