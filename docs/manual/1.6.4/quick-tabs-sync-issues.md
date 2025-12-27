---
title: Quick Tab Manager Synchronization and State Persistence Failures
extension_version: v1.6.3.11-v11
date: 2025-12-25
---

# Executive Summary

Quick Tab state changes (minimize, move, resize, close) fail to synchronize with
the Quick Tab Manager sidebar. Multiple distinct root causes prevent the Manager
from reflecting current Quick Tab state when the Manager is open. All issues
trace to a fundamental container identity mismatch that blocks storage
persistence, combined with missing event propagation mechanisms and incomplete
handler implementations.

---

## Issues Overview

| Issue | Component                        | Severity     | Root Cause                                                                                      |
| ----- | -------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| 1     | Container Ownership Filter       | **Critical** | `originContainerId` mismatch (firefox-default vs firefox-container-9) blocks all storage writes |
| 2     | Minimize Implementation          | **Critical** | No handler wired to minimize button; state never persists                                       |
| 3     | Close Button State Cleanup       | **Critical** | Close destroys DOM but never notifies Manager or removes from internal state Map                |
| 4     | Move/Resize Updates Not Visible  | **High**     | Storage persistence fails silently; no event bridge to notify sidebar of in-memory changes      |
| 5     | Missing Sidebar Message Protocol | **High**     | No event messages sent between content script and sidebar for real-time Manager updates         |
| 6     | Sidebar Polling Mechanism Absent | **Medium**   | Manager relies entirely on storage.onChanged, which never fires due to storage write failures   |

---

## Issue 1: Container Ownership Mismatch Blocks All Storage Writes

**Problem**

Every storage write attempt fails with ownership validation errors. When
Move/Resize/Focus operations trigger persistence, the system filters out **all 4
Quick Tabs** as "cross-container," logging:
`totalTabs 4, ownedTabs 0, filteredOut 4`. The Manager never receives storage
updates, so it cannot reflect any state changes.

**Root Cause**

File: `src/features/quick-tabs/handlers/UpdateHandler.js` and
`VisibilityHandler.js`  
Location: Storage ownership filtering logic (container validation)  
Issue: Quick Tabs are created with `originContainerId: firefox-default` (from
`createQuickTab` with `cookieStoreId: firefox-default`). However, the content
script running in the page is in `firefox-container-9` (Multi-Account
Container). The `ContainerFilter` performs an exact string match:

```
originContainerIdRaw: firefox-default
currentContainerId: firefox-container-9
result: false (CONTAINERMISMATCH)
```

Every single ownership check rejects these tabs. The system then blocks the
storage write with reason:
`STORAGEWRITEBLOCKED - no owned tabs - non-owner write blocked`.

**Fix Required**

The container ownership validation logic needs to be adjusted to either:

1. Accept Quick Tabs created in a parent/default container when the current
   script context is in a child container, OR
2. Capture and store the **current container ID** (firefox-container-9) when
   Quick Tabs are created, instead of relying on the creation-time
   `cookieStoreId`

The filter currently uses strict string equality. It should account for
container inheritance or cross-container tab relationships without requiring
exact container ID matches.

---

## Issue 2: Minimize Functionality Completely Non-Functional

**Problem**

Clicking the minimize button on a Quick Tab window produces no effect. No state
change occurs, no storage write is triggered, and the Manager shows no minimize
indicator. The minimize button exists in the UI but performs no action.

**Root Cause**

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: Minimize button event handler registration  
Issue: The logs show **zero evidence** of minimize operations being handled:

- Quick Tab creation logs always show `minimized: false`
- No logs show state transition from `minimized: false` → `minimized: true`
- The system tracks `pendingMinimizeSize` and `pendingRestoreSize` in the
  VisibilityHandler, but these are always `0` (never populated)
- No minimize-specific persistence calls appear in logs
- No minimize event is emitted on the internal EventBus

Either the minimize button click handler is not wired up at all, or it triggers
but immediately fails silently with no logging.

**Fix Required**

Implement complete minimize/restore functionality:

1. Wire the minimize button to an event handler in the VisibilityHandler that
   toggles the `minimized` state
2. Capture window dimensions before collapsing (store as `pendingMinimizeSize`)
3. Emit a `quicktab:minimized` or `quicktab:minimize-state-changed` event on the
   EventBus
4. Trigger storage persistence after state change (following the pattern in
   UpdateHandler's `handlePositionChangeEnd`)
5. Add logging at each step to verify the flow executes

The implementation should mirror the existing pattern for position/resize
changes: event trigger → state update → debounced persistence → EventBus emit.

---

## Issue 3: Close Button Does Not Clean Up Manager State

**Problem**

When a Quick Tab is closed, the DOM element is destroyed, but the Quick Tab
remains in the Manager's list indefinitely. Closed tabs are not removed from the
`renderedTabs` Map, and the Manager is never notified of the closure.

**Root Cause**

File: `src/features/quick-tabs/handlers/DestroyHandler.js` and
`src/sidebar/quick-tabs-manager.js`  
Location: Close button click handler and Manager state synchronization  
Issue: The logs show **no evidence** of close/destroy handlers firing when
buttons are clicked:

- No logs show `DestroyHandler.closeTab()` being invoked
- No messages with type `QUICKTAB_REMOVED` or `QUICKTAB_DESTROYED` are sent from
  content script to sidebar
- The `renderedTabs` Map never has entries removed (mapSize remains 4 after
  operations)
- No `quicktab:destroyed` event appears on the EventBus

The close button likely triggers DOM removal but never calls the destroy handler
that would:

1. Remove the tab from the internal state Map
2. Emit a destroy event
3. Send a message to the sidebar to update its list
4. Persist the removal to storage

**Fix Required**

The close button needs to be properly wired to invoke the complete destroy flow:

1. Button click handler should call the DestroyHandler's close method for that
   Quick Tab
2. DestroyHandler should remove the tab from the `renderedTabs` Map immediately
3. Emit a `quicktab:destroyed` event with the tab ID on the EventBus
4. Send a message to the sidebar with the destroyed tab ID (new message type:
   `QUICKTAB_REMOVED` or similar)
5. Persist the removal to storage (or trigger an empty-write if it was the last
   tab)

---

## Issue 4: Move and Resize Operations Don't Update Manager

**Problem**

Dragging or resizing Quick Tab windows updates their on-screen position and
size, but the Manager's state display never updates. Users cannot see the new
position/size in the Manager list while the Manager is open.

**Root Cause**

File: `src/features/quick-tabs/handlers/UpdateHandler.js`  
Location: Storage persistence after position/size changes  
Issue: Position and size changes ARE being captured in the internal
`renderedTabs` Map:

- Logs show
  `UpdateHandler Updated tab position in Map id qt-23-..., left 310, top 119`
- The Map is updated immediately after drag/resize ends

However, the subsequent storage persistence **silently fails** due to Issue #1
(container mismatch). The logs show:

```
UpdateHandler STORAGEPERSISTFAILED tabCount 4, timestamp 1766695438865
reason: Ownership validation failed
```

Since storage persistence fails, the `storage.onChanged` listener in the sidebar
never fires, so the Manager never receives the update. The state lives only in
memory on the content script.

**Fix Required**

This issue is **blocked by Issue #1**. Once the container ownership filter is
fixed:

1. Verify that storage persistence succeeds after position/resize changes
2. Confirm that the Manager's `storage.onChanged` listener fires correctly
3. Add a message bridge as a backup: after a successful storage write for
   position/size changes, also send a message to the sidebar with the new state
   (new message type: `QUICKTAB_MOVED` or `QUICKTAB_RESIZED`)
4. The sidebar should update its display on message receipt, not just on
   storage.onChanged

---

## Issue 5: No Message Protocol for Real-Time Manager Updates

**Problem**

The Manager relies entirely on `storage.onChanged` events to update its display.
When operations occur while the Manager is open, there is no immediate
notification mechanism. Users see stale state until the next storage write
succeeds (which currently never happens).

**Root Cause**

File: `src/sidebar/quick-tabs-manager.js`  
Location: Event listener setup and message handlers  
Issue: The sidebar Manager listens **only** for storage changes:

- No evidence in logs of messages like `QUICKTAB_MOVED`, `QUICKTAB_RESIZED`,
  `QUICKTAB_MINIMIZED`, `QUICKTAB_REMOVED` being handled
- The Manager has no message handler for real-time updates from the content
  script
- All updates must flow through storage.local (which is currently blocked by
  Issue #1)

This creates a single point of failure: if storage writes fail, the Manager has
no alternative notification path.

**Fix Required**

Implement a supplementary message-based notification system:

1. Create new message types for state changes: `QUICKTAB_MOVED`,
   `QUICKTAB_RESIZED`, `QUICKTAB_MINIMIZED`, `QUICKTAB_DESTROYED`
2. After each state-changing operation (move, resize, minimize, close), send the
   appropriate message from the content script to the sidebar
3. The sidebar should have message handlers that immediately update the
   Manager's display
4. Storage persistence remains the source of truth for page reloads; messages
   provide real-time updates while the Manager is open

Example flow:

- User drags Quick Tab → position changes → UpdateHandler calls
  `port.postMessage({type: 'QUICKTAB_MOVED', id: '...', left: 310, top: 119})`
- Sidebar receives message → Manager.updateTabPosition(id, left, top) → UI
  refreshes immediately

---

## Issue 6: Sidebar Polling Mechanism Doesn't Exist

**Problem**

The Manager has no fallback mechanism to poll or refresh state. If a storage
write fails (as they currently all do), the Manager shows stale information
indefinitely.

**Root Cause**

File: `src/sidebar/quick-tabs-manager.js`  
Location: State synchronization initialization  
Issue: The Manager sets up a listener for storage changes but has no:

- Periodic polling mechanism to check state freshness
- Heartbeat or sync request to verify state matches content script
- Fallback to request full state if storage listener fails
- Error handling when storage.onChanged never fires

The architecture assumes storage persistence always succeeds, which breaks when
ownership validation fails.

**Fix Required**

Add defensive synchronization mechanisms:

1. Implement a periodic (every 2-5 seconds) message to request current state
   from the content script
2. Compare received state with displayed state; update if different
3. On Manager open, send an immediate sync request to populate initial state
   (not relying on stored state)
4. Add error logging if a full sync cycle is triggered, indicating the primary
   storage mechanism is failing

---

## Shared Implementation Notes

- All storage writes must succeed for the Manager to update; any failure blocks
  the entire synchronization pipeline
- The container ownership filter is the root blocker—fixing it unblocks Issues
  #4, #5, and #6
- Issue #2 (minimize) is an independent implementation gap with no state
  persistence at all
- Issue #3 (close cleanup) is also independent, requiring proper destroy handler
  wiring
- Once Issues #1, #2, and #3 are resolved, the message bridge (Issue #5) becomes
  a supplementary robustness improvement
- All new event emissions should follow the existing EventBus pattern (see
  UpdateHandler for reference)
- All message sends should use the established port/messaging infrastructure
  (see CreateHandler for reference)

---

<scope>

**Modify:**

- `src/features/quick-tabs/handlers/UpdateHandler.js` — Add message sends after
  successful persistence; verify ownership filter integration
- `src/features/quick-tabs/handlers/VisibilityHandler.js` — Fix container
  mismatch in ownership validation; implement minimize handler and persistence
- `src/features/quick-tabs/handlers/DestroyHandler.js` — Ensure close button is
  wired; implement destroy event and message send
- `src/sidebar/quick-tabs-manager.js` — Add message handlers for real-time
  updates; implement polling/sync mechanism
- `src/features/quick-tabs/ports/ContentScriptPort.js` — Verify port messaging
  infrastructure supports all new message types

**Do NOT Modify:**

- `src/background.js` — Background script state management is out of scope;
  persistence logic lives in handlers
- `src/features/quick-tabs/core/QuickTabsManager.js` — Core creation logic is
  correct; ownership filters are the issue

</scope>

---

<acceptancecriteria>

**Issue 1: Container Ownership Filter**

- Storage writes succeed when Quick Tabs and content script are in different
  containers
- Manager receives storage.onChanged events after operations
- Logs show `ownedTabs > 0` (not all filtered out)
- Move/resize/focus operations persist to storage

**Issue 2: Minimize Functionality**

- Clicking minimize button toggles Quick Tab visual state
- `minimized` state in storage changes from `false` to `true`
- Manager displays minimize indicator (visual change)
- `pendingMinimizeSize` and `pendingRestoreSize` are populated during
  minimize/restore
- Logs show minimize event emission and storage persistence

**Issue 3: Close Button**

- Clicking close removes Quick Tab from Manager list immediately
- `renderedTabs` Map size decreases after close
- Storage no longer contains the closed tab
- Logs show destroy event and manager message sent

**Issue 4: Move/Resize Updates**

- Position and size changes appear in Manager while Manager is open
- Manager displays updated position `800x600 at 250, 150`
- Storage persistence succeeds (depends on Issue #1 fix)

**Issue 5: Message Protocol**

- New message types (`QUICKTAB_MOVED`, `QUICKTAB_RESIZED`, `QUICKTAB_MINIMIZED`,
  `QUICKTAB_REMOVED`) are sent after operations
- Sidebar immediately updates display upon message receipt
- Manager shows changes in real-time while open

**Issue 6: Polling Mechanism**

- Manager sends sync request every 3 seconds when open
- Stale state is detected and corrected via polling
- Logs show polling requests and responses

**All Issues:**

- All existing tests pass
- No new console errors or WARN/ERROR logs during normal operations
- Manual test: Create Quick Tab → Move it → Resize it → Minimize it → Close it →
  Open Manager → All operations reflected correctly
- Page reload: All state persists correctly
- Manual test with multi-account containers: Operations work across container
  boundaries

</acceptancecriteria>

---

<details>
<summary>Log Evidence: Container Mismatch Details</summary>

Every storage persistence attempt filters out all Quick Tabs due to container
mismatch:

```
VisibilityHandlerTab 23 CONTAINERVALIDATION
  Container mismatch
  quickTabId: qt-23-1766695433653-924yb19gd1fz
  originContainerId: firefox-default
  currentContainerId: firefox-container-9

VisibilityHandler Filtering out cross-tab Quick Tab from persist
  id: qt-23-1766695433653-924yb19gd1fz
  originTabId: 23
  currentTabId: 23

VisibilityHandler Ownership filter result
  totalTabs: 4
  ownedTabs: 0
  filteredOut: 4

StorageUtils v1.6.3.10-v6 Ownership filtering
  currentTabId: 23
  currentContainerId: firefox-container-9
  totalTabs: 4
  ownedTabs: 0
  filteredOut: 4
  filterReason: CONTAINERMISMATCH
```

This pattern repeats for every storage write attempt. The `ContainerFilter` logs
show:

```
ContainerFilter MATCHRESULT
  originContainerId: firefox-default
  currentContainerId: firefox-container-9
  result: false
  matchRule: MISMATCH
  identityStateMode: INITIALIZING
```

Result: Storage persistence is blocked 100% of the time.

</details>

<details>
<summary>Log Evidence: Minimize Non-Functionality</summary>

Quick Tab creation always shows minimized as false:

```
CreateHandler Creating Quick Tab with options
  id: qt-23-1766695432857-8qs0tp14mv9ig
  minimized: false
```

Focus operations show:

```
VisibilityHandler Timer callback STARTED
  pendingMinimizeSize: 0
  pendingRestoreSize: 0
```

These fields are never populated with non-zero values, indicating the minimize
handler was never triggered or implemented.

No logs show:

- `handleMinimize` being called
- `minimized` state being toggled
- `quicktab:minimized` events
- Minimize-specific storage writes

</details>

<details>
<summary>Log Evidence: Close Button Missing State Cleanup</summary>

After Quick Tab creation, logs show:

```
UICoordinator Registered window in renderedTabs from windowcreated
  id: qt-23-1766695432857-8qs0tp14mv9ig
  mapSizeAfter: 1

UICoordinator Registered window in renderedTabs from windowcreated
  id: qt-23-1766695433653-924yb19gd1fz
  mapSizeAfter: 2

UICoordinator Registered window in renderedTabs from windowcreated
  id: qt-23-1766695436894-3xfykm1ypvvb1
  mapSizeAfter: 3

UICoordinator Registered window in renderedTabs from windowcreated
  id: qt-23-1766695437316-kq5jl912ebspx
  mapSizeAfter: 4
```

The mapSize reaches 4 (all tabs created). However, there are **no subsequent
logs showing tabs being removed** from the map. No `handleDestroy`, `closeTab`,
or map-removal operations appear in the logs.

No messages of type `QUICKTAB_REMOVED` or `QUICKTAB_DESTROYED` are sent to the
sidebar.

</details>

---

**Priority:** Critical (Issues 1, 2, 3); High (Issues 4, 5); Medium (Issue 6)  
**Target:** Fix Issues 1–3 in single PR; then add Issues 5–6 as supplementary
robustness  
**Estimated Complexity:** High (container filter refactor) + Medium (missing
handlers) + Low (message additions)
