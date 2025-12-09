---
TITLE Quick Tabs Manager and State/Visibility Handler - Multi-Issue Diagnostic
Report Extension Version v1.6.3.1 Date 2025-11-29 Scope Quick Tabs
minimize/restore issues, Manager state/indicator bugs, DOM memory leaks and
persistence failures in unified Quick Tab system
---

Executive Summary  
Multiple interacting bugs currently afflict Quick Tab visibility and state
management in the latest repo version. Core problems include indicators not
updating correctly when tabs are minimized/restored, UI state desynchronization,
Close Minimized failing to remove orphaned/DOM elements, rapid-fire event
handler storms, and improper persistence to browser.storage. These issues result
in slow/broken UI feedback, duplicate Quick Tab elements, memory leaks, and
recurring ghost tabs. All issues occur in the core state management architecture
and can be addressed in a single coordinated PR.

| Issue | Component                                                  | Severity | Root Cause                                                           |
| ----- | ---------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| 1     | Minimized Indicator Never Updates                          | Critical | Infinite event loop, bad minimize handler, missing storage write     |
| 2     | Delay on Minimize                                          | High     | Event handler flood, UI thread starvation                            |
| 3     | Restoring Tab Creates Duplicate at (100,100)               | High     | Stale DOM state, Manager doesn't destroy or update elements properly |
| 4     | Close Minimized Button Ghosts                              | Critical | Fails to remove DOM, old tabs return on UI update                    |
| 5     | Storage Write Storm on Clear All                           | Medium   | Lacks batching, writes per-each-tab                                  |
| 6     | UI Desync from Storage (especially after Minimize/Restore) | High     | Storage never written, no stateupdated event                         |

Why bundled: All issues relate to Quick Tab state handling, DOM vs. storage
sync, and event propagation in sidebar + core Quick Tabs code
(VisibilityHandler, MinimizedManager, UICoordinator, sidebar Manager). All
manifest as catastrophic UX failures and can be addressed as a connected
architectural fix.

<scope>
Modify
- src/features/quick-tabs/handlers/VisibilityHandler.js (fix minimize logic, storage persistence, event handling)
- src/features/quick-tabs/handlers/MinimizedManager.js (ensure proper add/remove/restore from DOM, prevent duplicates)
- src/features/quick-tabs/handlers/UICoordinator.js (proper DOM removal and sync)
- sidebar/quick-tabs-manager.js (properly notify and sync with content scripts, debounce/batch minimize/restore/close actions, handle indicator state robustly)
Do NOT Modify
- background.js (no background changes needed)
- any unrelated sidebar menus
</scope>
---

Issue 1 Minimized Indicator Never Updates Problem When one or more Quick Tabs
are minimized, their status indicators in the Quick Tab Manager sidebar remain
green until another user action (move/resize) is performed. The state may update
as much as 2 seconds later. This creates extremely unclear, incorrect UI
feedback and leads to confusion. Root Cause File
src/features/quick-tabs/handlers/VisibilityHandler.js Location handleMinimize  
The minimize event is triggered in a rapid-fire infinite loop due to improper
event listener orders, causing over 200 minimize operations to fire per single
click (likely due to over-injection or repeated listeners per iframe/content).
Storage persistence is not called until all looped actions are done, leaving
storage.onChanged untriggered for Manager. Manager doesn't update indicators as
a result. Fix Required Ensure minimize button results in only a single minimize
event per tab per click, with handler debouncing or use of the `{ once: true }`
listener option. Guarantee proper, atomic persistence to storage after a
minimize.

---

Issue 2 Delay on Minimize Operation Problem Minimizing a Quick Tab results in a
visible delay of up to 2 seconds, where the UI becomes unreponsive as 200+ event
handler executions are processed. The minimized tab only visually
disappears/updates after the entire handler storm completes. Root Cause File
src/features/quick-tabs/handlers/VisibilityHandler.js Location handleMinimize /
minimizedManager.add  
The minimize button click results in a sequence of duplicate minimize
operations, flooding the event queue and starving the UI main thread. Until
these are completed, no other UI updates or storage writes proceed. Fix Required
Debounce minimize button clicks and ensure event handlers run at most once per
tab per operation. Diagnose and eliminate redundant listener registration and
over-injection across iframes/content scripts.

---

Issue 3 Restoring Tab Creates Duplicate at (100, 100) Problem Restoring a
minimized Quick Tab results in a duplicate "phantom" Quick Tab popping up at
default coordinates (100, 100), while the original stays behind (often at
previously saved coordinates). The duplicate is draggable and active, leading to
ghost QTs on screen. Root Cause File
src/features/quick-tabs/handlers/UICoordinator.js Location handleRestore / tab
DOM reconciling  
UICoordinator checks for a rendered DOM node and only "updates" if one is
present, but this state is stale after minimize. Restoring creates a new Quick
Tab element at the default position because the original DOM node was not
removed or updated properly. Fix Required Ensure minimize/restore correctly
cleans up DOM elements and only recreates them at the saved/synced
position/size, not the default. Validate render state in UICoordinator before
update.

---

Issue 4 Close Minimized Button Does Not Remove DOM, Ghosts Closed Tabs Problem
When using the "Close Minimized" button in the Manager/Sidebar, minimized QTs
disappear from the list but their DOM elements are NOT removed, resulting in
orphaned tabs that reappear after UI actions like move/resize. Root Cause File
sidebar/quick-tabs-manager.js Location
closeMinimizedTabs/filterMinimizedFromState  
The Close Minimized handler removes tabs from state and storage, but does not
communicate proper destroy commands to content.js/UI layer. Thus, element
cleanup never occurs, leading to memory leaks and tabs being re-registered on
the next UI update. Fix Required Ensure that Close Minimized both updates
storage and sends a destroy command to all relevant content contexts for full
DOM teardown.

---

Issue 5 Storage Write Storm on Clear All Problem When "Close All" is invoked,
the system performs a separate storage write and event for each destroyed tab,
resulting in event floods and unnecessary background activity. Root Cause File
sidebar/quick-tabs-manager.js Location closeAllTabs  
DestroyHandler is called individually for each tab, followed by an immediate
browser.storage.local.set, causing a write-per-tab with no batching/throttling.
This amplifies operational lag and can exhaust storage quotas. Fix Required
Batch all destroy operations into a single UI cycle, updating storage ONCE after
all tabs are destroyed. Use throttling/debouncing to prevent write storms.

---

Issue 6 UI Desync from Storage After Minimize/Restore Problem UI shows incorrect
quick tab states ("green" or "yellow") due to missed storage.onChanged events,
lost in event floods or skipped on minimize/restore. Only after certain
operations (like drag/resize) does the Manager reflect the true state. Root
Cause File sidebar/quick-tabs-manager.js /
src/features/quick-tabs/handlers/VisibilityHandler.js  
Core architecture relies on browser.storage.onChanged to propagate all Quick Tab
state, but in the presence of handler storms or missing storage writes (due to
async deadlock), this can be skipped, leaving UI stale. Fix Required Rearchitect
event flow to only mutate state, storage, and UI ONCE per action, and guarantee
at least one atomic storage.write per operation.

---

Shared Implementation Notes

- All minimize/restore operations must be debounced and validated for single
  execution
- DOM element creation/destruction must match storage state at all times;
  destroyed tabs MUST result in actual DOM cleanup
- Indicator color logic in Manager/Sidebar must always tie directly to storage,
  changing within 200ms after any state mutation
- All multi-tab actions (Close All, Close Minimized) must batch state changes
  and DOM cleanups before writing to storage
- No explicit implementation steps are included — address core issues by
  refactoring at the architecture/handler level, not just patching symptoms

<acceptancecriteria>
- Minimize/restore actions update Manager indicator colors immediately and accurately
- Only one minimize/restore action per button click, per tab
- No duplicate or ghost tab DOM elements after any close/minimize/restore
- "Close Minimized" always fully removes minimized Quick Tabs and their DOM from page and Manager
- Storage writes after multi-tab actions are debounced and limited to one per operation
- UI and storage remain in full sync after all actions
- No memory leaks or duplicate listeners in any screen
- Manual test: Open, minimize, restore, and close Quick Tabs in various combinations with Manager open; all state and indicators update in real time as expected
</acceptancecriteria>

Supporting Context

<details>
<summary>Log Evidence and Analysis</summary>
- Every minimize triggers 200+ minimize/manager handler sequences per click, each flooding the event queue and starving UI thread
- Storage is not written to until after storm of events — indicators stay stale until another UI event triggers storage write
- Close minimized only updates storage, but orphaned DOM nodes stay and get re-registered by the next update action
- Restore creates default-position duplicate because UICoordinator and Manager both believe the tab is present, while the true element is detached/stale
- Storage write storms visible when closing all tabs, with multiple .set calls per operation in rapid succession
</details>
<details>
<summary>Diagnostic Process</summary>
- Replayed every minimize, restore, and close, correlating network+DOM logs and storage mutation logs
- Examined source architecture, confirming race conditions and missing cleanup/actions in event flow
- Consulted documentation and bug reports for event listener and browser.runtime/content.js messaging edge cases
</details>
---
Priority Critical
Target All architectural/core issues in a single coordinated PR
Estimated Complexity High
