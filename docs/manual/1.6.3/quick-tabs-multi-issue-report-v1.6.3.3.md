# Quick Tabs – Multifaceted State Sync, Restore, and Logging Bugs (v1.6.3.3)

**Extension Version**: v1.6.3.3  
**Date**: 2025-11-30  
**Scope**: Quick Tab minimize/restore/close cycles, page reload persistence,
z-index, and logging architecture

---

## Executive Summary

Multiple state, restore, and feedback bugs remain in Quick Tabs as of v1.6.3.3.
Core issues include: inability to restore Quick Tabs after page reload; z-index
bugs on subsequent restores; misleading map/DOM state after multi-cycle
minimize/restore; frozen Manager indicators; and ambiguous log trails. No
logging discriminates user action sources (Manager vs. Quick Tab UI). Combined,
these undermine reliability, user intuition, and debuggability.

| Issue | Component                                            | Severity | Root Cause                                                                                        |
| ----- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| 1     | No restore from storage on reload                    | Critical | QuickTabsManager omits hydration/init step for storage state                                      |
| 2     | Second+ restore creates phantom DOM/Map state        | Critical | `domAttached` check evaluates true on detached nodes; Map not cleaned up after minimize           |
| 3     | Restored tab drag does not re-attach Z-Index logic   | High     | Drag event handlers not re-wired; z-index not updated in local state or storage                   |
| 4     | UI close button doesn’t clear Manager                | High     | UI close destroys DOM only; doesn’t call DestroyHandler, leaves entry in storage/Manager          |
| 5     | Z-Index always resets after restore                  | High     | VisibilityHandler increments z-index only locally; restore always reads base z-index from storage |
| 6     | No source indication in logs for user action origins | Medium   | All minimize/restore/close look same in logs; no `source` param added                             |
| 7     | DOM/Map lifecycle ambiguities on long cycles         | High     | Reference cycles and missing cleanup after failed restores cause ghost state                      |
| 8     | Minimized/closed tabs log ambiguous                  | Medium   | No log IDs or distinguishing fields for origin or operation                                       |
| 9     | DestroyHandler logging incomplete                    | Medium   | DestroyHandler only logs from Manager-invoked actions                                             |
| 10    | No error log when storage-hydrate is skipped         | Medium   | Repo logs state "initialized empty" but not why; page reload diagnostic is nearly impossible      |

**Why Bundled**: All issues impact state synchronization, cross-session
persistence, cleanup, and maintenance signals in core Quick Tab workflows. All
are affected by missing storage/DOM/Map bridging.

<scope>
**Modify**:
- `src/features/quick-tabs/index.js` (restore/hydrate state on init, add log)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (fix DOM cleanup, origin logs)
- `src/features/quick-tabs/handlers/DestroyHandler.js` (invoke on ALL UI closes)
- `src/features/quick-tabs/UICoordinator.js` (fix domAttached bug, strengthen cleanup)
- `src/features/quick-tabs/window.js` (ensure proper callbacks on close)
- `src/content.js` (add origin/source to all actions)

**Do NOT Modify**:

- `src/background/` (external scripts, outside DOM)
- `sidebar/quick-tabs-manager.js` (Manager as reactive read-only view) </scope>

---

## Issue 1: No Quick Tab Restore After Page Reload

**Problem**: Reloading a page or extension instance erases all on-screen Quick
Tabs, but Manager sidebar still shows all previously present tabs as active.
None are re-created or restored.

**Root Cause**: `QuickTabsManager` initialization (step 6) explicitly omits
restoration of state from browser storage. Logs say “state initialized empty (no
persistence in v1.6.3)” even though storage contains tab data. All hydration
code is missing.

**Fix Required**: Add a state rehydration method, on startup, that reads the
latest serialized Quick Tab state from storage and repopulates both local `Map`
and DOM. Log explicit reason when hydration is skipped.

---

## Issue 2: Second+ Restore on a Tab Enters Phantom State (Map/DOM Desync)

**Problem**: After the first minimize/restore cycle, subsequent cycles for the
same tab log `inMap: true, domAttached: true`, even though DOM is removed. No
window appears on screen, but Map still believes it exists. Eventually, a
duplicate 400×300 Quick Tab may appear, and indicators desync.

**Root Cause**: `UICoordinator` and `VisibilityHandler` rely on `isRendered()`
or `parentNode` to test DOM presence. JavaScript retains references due to Map
and non-null parentNode, even for detached elements. Map cleanup is
deferred/dependent on GC and never happens at end of minimize. “Normal update”
is chosen instead of proper re-render, skipping window creation.

**Fix Required**: Change the minimize/restore and DOM cleanup flow so Map
deletes and DOM detaches are atomic and guaranteed. `isRendered()` and
`domAttached` logic must strictly use live DOM relationship, not cached object
or parentNode reference.

---

## Issue 3: Z-Index Never Persists Between Restores; Drag Broken

**Problem**: Newly created or dragged Quick Tabs get incrementing z-index.
Restored tabs always revert to z-index 1000000. Drag events do not log or
increment z-index after restore.

**Root Cause**: z-index is only tracked and updated in live local state. Any
increments or changes from dragging are never written back to storage. On
restore, only the stale or base value is loaded. Event handlers for “bring to
front” are not reattached after restore.

**Fix Required**: Write z-index changes to persistent storage immediately on
update. Ensure drag and focus event callbacks are re-wired at every window
re-render.

---

## Issue 4: UI Close Button Leaves Tab Active in Manager

**Problem**: Closing a Quick Tab using its UI `✕` button destroys only
client-side DOM and tab instance. The Manager sidebar still lists the tab as
open/active; no storage change is triggered.

**Root Cause**: UI close button calls `tabWindow.destroy()`, but the callback
chain does NOT invoke `DestroyHandler.handleDestroy`. All storage and state
update logic (and related logs) exist ONLY in DestroyHandler, which fires only
for Manager close actions.

**Fix Required**: Wire UI close button to the same destroy path as Manager
close. All close operations (UI and Manager) must call DestroyHandler and
persist updated state to storage. Add corresponding logging for all destroy
invocations, with source indication.

---

## Issue 5: Map/DOM Lifecycle Ambiguities on Multi-Restore

**Problem**: After multiple minimize/restore cycles, phantom tab entries persist
in state. Memory leaks or “ghost” tab artifacts develop as Map and DOM gradually
desync.

**Root Cause**: JavaScript `Map`/strong references, weak DOM/GC patterns, and
partial cleanup flows prevent reliable finalization of resources. No forced
cleanup on failed or partial restores.

**Fix Required**: On every minimize and close, explicitly delete tab/window
references from Map and ensure DOM objects are forcibly detached. Periodically
sweep and cleanup any stale artifacts. Add logging for “already detached” or
“not found” cases as internal warnings.

---

## Issue 6: No Differentiation Between Manager and UI Actions in Logs

**Problem**: All minimize, restore, and close event logs look the same. There’s
no field or log content that tells whether a user action originated from the
sidebar/Manager or the in-window UI.

**Root Cause**: content.js, VisibilityHandler, DestroyHandler, and UICoordinator
do not record the `source` of user actions. All code paths converge and log the
same messages.

**Fix Required**: Add a `source` property (UI/Manager/automation/background/etc)
to every log (and state operation) that is user-initiated. Add to every
MessageAction, and propagate through logs, especially for minimize, restore, and
close.

---

## Issue 7: DestroyHandler Logging is Incomplete

**Problem**: DestroyHandler only logs when invoked from Manager button closes,
not from UI button closes. There’s no insight as to why a tab is still present
in Manager after the ✕ button is used.

**Root Cause**: UI close path never enters DestroyHandler, so all
destroy/persistence/log/cleanup logic is bypassed for native UI closes.

**Fix Required**: Consolidate ALL destroy/close logic in DestroyHandler,
guaranteeing that every destroy routes through a single entry point. Expand
logging to identify origin, lifecycle, and storage outcomes.

---

## Issue 8: Error Logging and Storage Hydration

**Problem**: There is no log at startup explaining WHY the extension starts with
an empty state. Diagnostic logs merely say “No persistence in v1.6.3”, which is
misleading and prevents diagnosis of user data loss.

**Root Cause**: No error, warning, or diagnostic logging exists in any hydration
or state initialization logic. Skipped state rehydration is silent.

**Fix Required**: At init, log a WARNING when no restore/hydration is attempted.
At every error path or deviation (missing storage, parse errors, permission
errors), log explicit contextual error messages and suggested support actions.

---

## Missing and Ambiguous Logging – All Issues

1. **No user action source in logs** (cannot tell UI vs Manager events)
2. **No log when destroy is skipped** (UI button path)
3. **Lack of log on “already minimized/closed”** (ambiguous state)
4. **No log for failed DOM/Map cleanups** (phantom/ghost artifacts)
5. **No error/warning if storage state load fails/skipped**

---

<acceptancecriteria>
- Quick Tabs are reliably restored after page reloads; Manager and DOM states are always synchronized
- Any close action (UI or Manager) successfully removes tab from all state and storage, and Manager UI updates
- Z-index is persisting and restoring correctly; drag and focus bring restored tabs to front
- All minimize/restore/close logs clearly state origin (Manager, UI, background, automation)
- Map and DOM never retain references to destroyed or minimized tabs; no phantom tabs accumulate
- DestroyHandler is called for all closes and logs are written in all pathways
- All actions log warnings or errors if storage or cleanup paths fail
- A WARNING log is emitted at startup if storage restoration isn’t attempted
- All critical state and transition events are represented in storage and logging
</acceptancecriteria>

---

<details>
<summary>Reference: MDN and Web Documentation</summary>
- [web.dev: Detached window memory leaks][71]
- [MDN: JavaScript Memory Management][33]
- [Reddit: JS Map leaks][30][73]
- [DitDot: Memory leaks in JS][76]
- [StackOverflow: DOM parentNode]
</details>

---

**Priority**: Critical  
**Target**: Single coordinated PR addressing all SMART failure points  
**Estimated Complexity**: High (multiple interacting code regions and
architectural design changes)
