# Quick Tabs Manager State Synchronization & Logging Issues

Extension Version v1.6.3.1+ Date 2025-12-08

**Scope** Panel synchronization failures, cross-tab messaging bugs, and missing
diagnostic logging across multiple components

---

## Executive Summary

The Quick Tabs Manager sidebar fails to accurately reflect state changes across
browser tabs due to fundamental flaws in the cross-tab messaging architecture
and missing feedback logging. When tabs are minimized, resized, or restored, the
Manager UI either displays stale data or shows Quick Tabs that don't belong to
the current tab context. Additionally, critical diagnostic logging is missing at
multiple decision points, making it impossible to diagnose failures in
production. These issues stem from v1.6.3's removal of cross-tab sync
infrastructure without establishing proper per-tab ownership tracking and
confirmation messaging.

| Issue | Component                   | Severity | Root Cause                                                   |
| ----- | --------------------------- | -------- | ------------------------------------------------------------ |
| 1     | Manager Panel               | Critical | No per-tab messaging confirmation + stale state rendering    |
| 2     | Cross-Tab Restoration       | Critical | Broadcast messaging without origin validation                |
| 3     | Minimize/Restore Operations | High     | Missing message responses to Manager                         |
| 4     | Position/Size Updates       | High     | No callback confirmation from UpdateHandler to sidebar       |
| 5     | Storage Change Events       | High     | Sidebar doesn't know which tab initiated write               |
| 6     | Logging Gaps                | High     | Missing confirmation logs at message handlers                |
| 7     | Tab Affinity Tracking       | Medium   | quickTabHostInfo never confirmed on minimize                 |
| 8     | State Desynchronization     | Medium   | No mechanism to detect when Manager is showing orphaned tabs |

**Why bundled** All affect Quick Tab state synchronization and Manager UI
accuracy. Each has distinct root cause in different components but share
underlying architectural flaw: missing feedback loops from content scripts back
to sidebar. Can be addressed through coordinated messaging pattern
implementation across handlers and UICoordinator.

---

<scope>

**Modify**

- `sidebar/quick-tabs-manager.js` - Message handling, response tracking, state
  validation
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Add event emissions and
  callbacks
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Add storage
  persistence and event emissions
- `src/features/quick-tabs/coordinators/UICoordinator.js` - Add message
  responses and confirmations
- `src/features/quick-tabs/index.js` - Wire event listeners for sidebar
  communication

**Do NOT Modify**

- `src/background.js` - Background script event routing out of scope
- `src/content.js` - Content script initialization logic not directly related
- `.github/` - GitHub configuration not relevant

</scope>

---

## Issue 1: Manager Panel Shows Orphaned Quick Tabs Not Belonging to Current Tab

**Problem**

When multiple browser tabs are open, the Manager sidebar displays Quick Tabs
that were created in different tabs. For example, open Tab A and create Quick
Tab 1, then open Tab B and open Manager (Ctrl+Alt+Z). The Manager shows Quick
Tab 1 even though it belongs to Tab A. This causes user confusion and broken
drag-to-restore operations because Quick Tab 1 cannot be restored in Tab B
context.

**Root Cause**

File `sidebar/quick-tabs-manager.js` Location `renderUI()` function, lines
720-780; `groupQuickTabsByOriginTab()` function, lines 55-90

Issue The sidebar receives state from `browser.storage.local` via the
`loadQuickTabsState()` function. All Quick Tabs in storage are displayed
regardless of the current browser tab's ID. The `groupQuickTabsByOriginTab()`
helper groups tabs by `originTabId`, but the sidebar has no mechanism to filter
out Quick Tabs that don't belong to the current tab. Additionally, when
`loadQuickTabsState()` fires, it doesn't validate whether the tabs belong to the
current context before rendering.

The sidebar attempts to identify the current tab ID via
`browser.tabs.query({ active: true, currentWindow: true })` in the
`DOMContentLoaded` handler, but this query is executed once at initialization
and stored in `currentBrowserTabId`. If the user switches tabs,
`currentBrowserTabId` is never updated, causing subsequent storage reads to
display stale groupings.

**Fix Required**

Implement a mechanism to filter Quick Tabs by ownership before rendering. This
requires:

- Continuously track the current active tab ID across tab switches (not just at
  initialization)
- Filter rendered Quick Tabs to only those where
  `originTabId === currentBrowserTabId` or where the tab is explicitly
  "orphaned"
- Validate `originTabId` exists in QuickTab data before rendering (handle legacy
  tabs from v1.6.2)
- When a tab context switch is detected, re-render the UI with only the relevant
  subset of Quick Tabs
- Add clarifying logging when tabs are filtered out with reason and affected IDs

---

## Issue 2: Restore Button Sends Messages to All Tabs Without Confirmation

**Problem**

Clicking the restore button on a minimized Quick Tab sometimes restores the same
Quick Tab in multiple browser tabs simultaneously, or restores it in the wrong
tab context entirely. This occurs because the Manager's `restoreQuickTab()`
function broadcasts the `RESTORE_QUICK_TAB` message to every open tab without
waiting for or verifying responses.

**Root Cause**

File `sidebar/quick-tabs-manager.js` Location `_sendMessageToAllTabs()`
function, lines 770-810; `restoreQuickTab()` function, lines 1050-1120

Issue The Manager attempts to use per-tab messaging via `quickTabHostInfo` Map
(lines 1070-1085), but this Map is populated reactively from
`handleStateUpdateMessage()` which only receives updates when storage changes
occur, not when operations happen. If a minimize happens in Tab A but the
Manager is viewing Tab B, the `quickTabHostInfo` entry may not be updated with
the correct host tab ID for that Quick Tab.

When `quickTabHostInfo` lookup fails, the code falls back to
`_sendMessageToAllTabs()` which broadcasts to every tab. The function returns
aggregate success/error counts but never logs which specific tabs received the
message or whether they actually restored the Quick Tab. This creates a silent
failure mode where the restore completes locally (the function returns) but the
actual restoration happens in an unintended tab.

Additionally, the UICoordinator's cross-tab validation in
`_shouldRenderOnThisTab()` attempts to block cross-tab rendering, but if the
message is received by the wrong tab's content script, that content script may
not have the same validation logic or may bypass it.

**Fix Required**

Implement per-message confirmation responses that:

- Track which specific tab received and processed each message (not just counts)
- Log the response from each target tab including success/failure and actual tab
  context
- Implement a timeout mechanism that waits for responses from target tab
  (500-1000ms)
- If target tab doesn't respond within timeout, escalate alert to user or retry
  with broadcast
- Store response confirmations in Manager's state so UI can indicate operation
  status to user
- Add logging at each decision point showing target tab selection, message
  content, and response handling

---

## Issue 3: Minimize/Maximize Operations Don't Update Manager UI in Real-Time

**Problem**

When a Quick Tab is minimized by clicking the minimize button on the Quick Tab
window itself (not via Manager), the Manager UI doesn't immediately update to
show the Quick Tab as minimized. The minimize icon (yellow indicator) appears
only after navigating away and back to the Manager, or after manually refreshing
(F5).

**Root Cause**

File `src/features/quick-tabs/handlers/VisibilityHandler.js` Location
`handleMinimize()` function, lines 85-145

Issue The `handleMinimize()` method updates the internal state via
`stateManager` and emits an `state:updated` event on the internal event bus, but
this event is only received by components in the same tab's content script
context. The Manager sidebar runs in a different context (sidebar context) and
doesn't have access to the internal event bus.

The fix applied in v1.6.3.5 is incomplete: while `stateManager` updates are now
persisted to storage (via the state manager's own persistence layer), the timing
of when the Manager receives the `storage.onChanged` event may be delayed or the
event may contain stale data if another tab simultaneously writes to storage.

Additionally, when a minimize operation completes, there's no confirmation
message sent back to the Manager indicating "Quick Tab with ID X was
successfully minimized in Tab Y context." The Manager only learns about minimize
operations through storage event polling, which may miss intermediate state
changes.

**Fix Required**

Establish a callback/confirmation pattern where:

- `VisibilityHandler.handleMinimize()` must emit a response message that can be
  received by content script message handlers
- This message should include the Quick Tab ID, new minimized state, and the tab
  context where the operation occurred
- The content script should relay this confirmation back to any listeners
  (including the Manager if a broadcast response channel exists)
- Alternatively, ensure that minimize operations immediately write to storage
  with a unique transaction ID so the Manager's `storage.onChanged` listener can
  detect them as "fresh" writes rather than stale events
- Add comprehensive logging showing minimize entry, state update, storage write,
  and message broadcast

---

## Issue 4: Position and Size Updates Don't Trigger Manager Display Updates

**Problem**

When a user drags or resizes a Quick Tab window, the position and size values in
the Manager don't update until several seconds later (or after a manual
refresh). Live drag/resize operations show no visual feedback in the Manager,
breaking the user expectation that Manager displays real-time state.

**Root Cause**

File `src/features/quick-tabs/handlers/UpdateHandler.js` Location
`handlePositionChange()` and `handleSizeChange()` functions, lines 50-85;
`handlePositionChangeEnd()` and `handleSizeChangeEnd()` functions, lines 120-180

Issue The `handlePositionChange()` and `handleSizeChange()` methods update the
in-memory tab state in the `quickTabsMap` and emit lightweight events
(`tab:position-changing`, `tab:size-changing`) for internal listeners only.
These events are not persisted to storage and are not broadcast to the Manager.

The `handlePositionChangeEnd()` and `handleSizeChangeEnd()` methods do trigger
`_persistToStorage()`, but this function uses a debounce timer of 300ms. During
the debounce window, if the Manager is updating (every 2 seconds per
`setInterval` in line 555), the storage write hasn't happened yet, so the
Manager reads the old position/size values from storage.

Additionally, the UpdateHandler never sends a confirmation message back to the
Manager indicating "Position/Size update completed for Quick Tab X." The Manager
has no way to know whether a storage write is in progress or has completed—it
must wait for the `storage.onChanged` event, which may not fire immediately
after the debounce timer completes.

**Fix Required**

Implement real-time feedback from UpdateHandler to Manager:

- Emit update events when debounce completes and storage write is initiated
- Send confirmation messages after storage persistence confirms success (include
  actual values written)
- For live drag/resize (before end), emit lightweight
  position-changing/size-changing events that Manager can receive without
  waiting for storage
- Add message channels or broadcast pattern so Manager can subscribe to these
  events
- Manager should distinguish between "in progress" (live drag) and "completed"
  (debounce finished) states in UI
- Add comprehensive logging showing debounce timers, storage write initiation,
  and confirmation completion

---

## Issue 5: Storage.onChanged Events Don't Indicate Which Tab Made the Change

**Problem**

When the Manager receives a `storage.onChanged` event indicating a Quick Tab was
updated, it has no way to know which browser tab initiated the change. This
causes the Manager to update its display for Quick Tabs from other tabs, leading
to the orphaned tab display issue (#1).

**Root Cause**

File `sidebar/quick-tabs-manager.js` Location `_handleStorageChange()` function,
lines 1220-1280

Issue The `browser.storage.onChanged` event fires on all tabs when any tab
updates `browser.storage.local`. The event includes the old and new values of
the stored data, but no metadata about which tab made the change. This is a
limitation of the WebExtension storage API—it doesn't provide origin information
in the change event.

When the Manager receives the `storage.onChanged` event, it calls
`loadQuickTabsState()` which reads all Quick Tabs from storage and re-renders
them. Because there's no per-tab filtering (Issue #1), all tabs are displayed
regardless of whether they belong to the current tab context.

Additionally, the sidebar has no way to distinguish between storage changes
initiated by the current tab's minimize operation versus changes coming from
another tab. The `_handleStorageChange()` function logs tab count deltas but
doesn't identify which tab caused the change.

**Fix Required**

Implement a tagging/metadata system for storage writes:

- When any handler writes to storage, include a `sourceTabId` or similar
  metadata field indicating which tab initiated the write
- The sidebar's `_handleStorageChange()` listener can then check this metadata
  and decide whether to update its display
- For cross-tab awareness, the sidebar could display a notification or badge
  showing which tab the changed Quick Tab belongs to
- Alternatively, implement a side-channel messaging pattern where content
  scripts send confirmation messages to the Manager after storage operations
  (addressing Issue #3 and #4)
- Add comprehensive logging showing storage change source inference, metadata
  validation, and filtering decisions

---

## Issue 6: Missing Confirmation Logging at Critical Message Handler Decision Points

**Problem**

When debugging why a restore operation failed, there are no logs showing whether
the message was received by the content script, whether UICoordinator accepted
or rejected the rendering, or why the rejection occurred. Logs exist in
UICoordinator (showing rejection reasons) but the Manager has no way to see
them, creating a diagnostic blind spot.

**Root Cause**

Files `src/features/quick-tabs/handlers/DestroyHandler.js`,
`src/features/quick-tabs/handlers/CreateHandler.js`,
`src/features/quick-tabs/coordinators/UICoordinator.js` Location Message
handlers for `RESTORE_QUICK_TAB`, `MINIMIZE_QUICK_TAB`, `CLOSE_QUICK_TAB`,
`FOCUS_QUICK_TAB`

Issue Content script message handlers (CreateHandler, VisibilityHandler,
DestroyHandler, etc.) receive messages from the Manager but don't send
confirmation responses back. They update state and emit internal events, but the
Manager never learns whether the operation succeeded or why it failed.

For example, in UICoordinator's `_shouldRenderOnThisTab()` (lines 480-530), the
code logs "CROSS-TAB BLOCKED" with detailed reason, but this log only exists in
the content script console of one tab. The Manager (in sidebar context) cannot
see this log and doesn't know why the restore failed.

The Manager's message handlers in `setupEventListeners()` (lines 1200-1250) call
`_sendMessageToAllTabs()` but never receive any response indicating
success/failure/reason. The functions return aggregate counts but don't parse or
log the actual responses from content scripts.

**Fix Required**

Implement response-based confirmation logging:

- Every content script message handler must respond with a structured result
  object including success, reason, and affected tab context
- The sidebar must parse these responses and log them with full context (which
  tab, which Quick Tab ID, what action, success/failure reason)
- For rejected operations, the response should include the rejection reason from
  UICoordinator (e.g., "CROSS-TAB BLOCKED")
- Implement a response timeout mechanism with logging if tabs don't respond
  within expected time
- Add granular logging at each decision point: message received, validation
  checks, state changes, persistence, response sent
- Ensure critical operation logs are tagged with Quick Tab ID and tab context
  for easy filtering

---

## Issue 7: Tab Affinity Tracking Map Not Updated on Manager-Initiated Minimize

**Problem**

The sidebar maintains a `quickTabHostInfo` Map that tracks which browser tab
"owns" each Quick Tab. However, when a user minimizes a Quick Tab via the
Manager sidebar, this map is never updated with the new host tab mapping. This
causes subsequent restore operations to fail or restore in the wrong tab
context.

**Root Cause**

File `sidebar/quick-tabs-manager.js` Location `quickTabHostInfo` Map
initialization and `handleStateUpdateMessage()` function, lines 290-340

Issue The `quickTabHostInfo` Map is populated only when the sidebar receives a
`QUICK_TAB_STATE_UPDATED` message from the content script (line 305-315 in
`handleStateUpdateMessage()`). This message is sent when the background script
detects a state change.

However, when the Manager's minimize button is clicked, the flow is:

1. Manager calls `minimizeQuickTab(quickTabId)`
2. This calls `_sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId)`
3. Content scripts receive this message and minimize the tab
4. Content scripts emit `state:updated` events internally
5. StateManager persists to storage
6. Storage.onChanged fires on all tabs including sidebar
7. Sidebar calls `loadQuickTabsState()` but this doesn't validate/update
   `quickTabHostInfo`

The `quickTabHostInfo` is only updated if a `QUICK_TAB_STATE_UPDATED` message
arrives from content scripts, but content scripts don't automatically send this
message after handling a minimize request. They only send it if the background
script broadcasts a state change event.

Without accurate `quickTabHostInfo`, the Manager cannot use targeted tab
messaging (Issue #2) and must fall back to broadcast messaging to all tabs.

**Fix Required**

Ensure `quickTabHostInfo` is updated whenever state changes occur:

- When Manager performs an operation (minimize, restore, close), capture which
  tab actually completed the operation
- Have content scripts send explicit `QUICK_TAB_STATE_UPDATED` messages back to
  Manager after operations complete
- Update `quickTabHostInfo` immediately when `handleStateUpdateMessage()`
  receives these confirmations
- Validate `quickTabHostInfo` entries before each operation (remove stale
  entries for closed tabs)
- Add comprehensive logging showing Map updates, validation checks, and stale
  entry removals
- Implement a periodic Map integrity check to remove entries for closed tabs

---

## Issue 8: No Mechanism to Detect Orphaned Tabs in Manager Display

**Problem**

If a Quick Tab is somehow restored in the wrong tab context (due to Issues #2 or
#6), there's no mechanism for the Manager to detect this and alert the user or
attempt recovery. The orphaned tab remains visible in the Manager but cannot be
operated on correctly.

**Root Cause**

File `sidebar/quick-tabs-manager.js` Location `renderUI()` function and entire
Manager lifecycle

Issue The Manager receives state from storage and renders all Quick Tabs without
validating whether each tab's `originTabId` actually matches any known browser
tab context. There's no periodic validation that `originTabId` values are still
valid (the browser tab may have been closed).

Additionally, there's no listening mechanism for when UICoordinator rejects a
rendering due to cross-tab validation (Issue #6). The Manager doesn't know that
a Quick Tab exists but cannot be rendered in the current context.

When a user attempts to interact with an orphaned tab (drag, minimize, restore),
the operation may fail silently or succeed in an unexpected context, with no
user feedback explaining the problem.

**Fix Required**

Implement orphaned tab detection and remediation:

- Periodically validate that `originTabId` values in Quick Tabs correspond to
  actual open browser tabs
- When UICoordinator rejects a rendering due to cross-tab validation, send a
  notification/event to Manager indicating the tab is orphaned
- Add a visual indicator in the Manager (e.g., grayed out icon, warning badge)
  for orphaned tabs
- Implement cleanup of orphaned tabs after a timeout or on explicit user action
- Add logging showing orphaned tab detection, affected IDs, and remediation
  actions
- Consider implementing a "Move to Current Tab" button for orphaned tabs that
  allows user to restore them in current context

---

## Shared Implementation Patterns

All solutions must follow these patterns to maintain consistency:

**Message Confirmation Pattern**

- Every content script message handler must return a structured response:
  `{ success: boolean, action: string, quickTabId: string, originTabId: number, reason?: string, completedAt: number }`
- Sidebar must log all responses with full context including sender tab ID
- Implement 500-1000ms timeout for responses with appropriate logging

**Storage Metadata Pattern**

- When writing to storage, include metadata:
  `{ sourceTabId: number, sourceContext: string, transactionId: string, timestamp: number }`
- Manager's storage change handler must validate metadata and filter tabs
  accordingly
- Include sourceTabId in all storage update logs

**Event Broadcasting Pattern**

- Use internal event bus for same-context communication (content script only)
- Use message passing for cross-context communication (content script ↔
  sidebar)
- Use storage metadata for cross-tab awareness (all tabs)

**Logging Pattern**

- All operations must log at entry and exit with relevant IDs, context, and
  decisions
- Critical paths (minimize, restore, close) require step-by-step logging
- Rejection reasons must be logged with affected IDs for debugging

**State Validation Pattern**

- Always validate `originTabId` exists and matches expected context before
  operations
- Handle null/undefined `originTabId` gracefully with fallback to ID pattern
  extraction
- Log all validation failures with reason and affected tab IDs

---

<acceptancecriteria>

**Issue 1: Orphaned Tab Display**

- Manager filters Quick Tabs to only those where originTabId ===
  currentBrowserTabId
- Tab context is updated when user switches browser tabs
- Manager displays different Quick Tab sets when switching tabs
- Orphaned tabs are not displayed (hidden from UI)

**Issue 2: Restore Confirmation**

- Restore operation logs which specific tab received the message
- Manager receives response from target tab confirming successful restoration
- If target tab doesn't respond within 1 second, Manager logs timeout and falls
  back appropriately
- Manager displays operation status (pending, success, failed) to user

**Issue 3: Minimize/Restore Updates**

- Manager UI updates within 500ms of minimize/restore button click
- Yellow indicator appears immediately when tab is minimized
- Manager shows storage write confirmation in logs

**Issue 4: Position/Size Updates**

- Manager displays updated position/size values within 500ms of resize
  completion
- Live drag operations show real-time feedback in Manager if subscribed to
  position-changing events
- Storage persistence completes before next Manager refresh cycle (2 second
  interval)

**Issue 5: Storage Change Attribution**

- Storage writes include sourceTabId metadata
- Manager's storage.onChanged handler logs the source tab and decides whether to
  update display
- Cross-tab storage changes are identified and logged distinctly from same-tab
  changes

**Issue 6: Message Handler Logging**

- Every message handler logs reception with tab context and Quick Tab ID
- UICoordinator rejection reasons appear in a log format accessible to Manager
- Manager receives confirmation responses with success/failure reason
- Timeout scenarios are logged explicitly

**Issue 7: Tab Affinity Tracking**

- quickTabHostInfo Map is updated after every minimize/restore operation
- Stale entries are removed when tabs close
- Map state is logged on each update
- Subsequent operations use accurate Map data for targeted messaging

**Issue 8: Orphaned Tab Detection**

- Manager validates originTabId against known browser tabs periodically
- Orphaned tabs display visual indicator (grayed out, warning badge)
- Logs show orphaned tab detection with affected IDs
- User has UI option to clean up orphaned tabs

**All Issues**

- All existing tests pass (unit, integration, e2e)
- No new console errors or warnings in Manager sidebar or content scripts
- No new console errors in UICoordinator logs
- Manual testing verifies all operations (create, minimize, restore, close) work
  correctly with multiple tabs open
- Storage state survives tab reload and browser restart
- Logs are tagged with Quick Tab ID and tab context for easy filtering

</acceptancecriteria>

---

<details>
<summary><strong>Issue 1 Detailed Evidence</strong></summary>

When Manager is opened in Tab B after creating a Quick Tab in Tab A:

- Tab A's Quick Tab remains visible in Manager UI even though originTabId !=
  currentBrowserTabId
- groupQuickTabsByOriginTab() correctly groups by originTabId, but renderUI()
  doesn't filter the groups
- currentBrowserTabId is set once at initialization and never updated on tab
  switches
- Switching back to Tab A and reopening Manager shows same set of Quick Tabs
  (demonstrating no re-filtering on tab switch)

</details>

<details>
<summary><strong>Issue 2 Detailed Evidence</strong></summary>

Restore operation logs from Manager:

- `[Manager] Sending RESTORE_QUICK_TAB to 3 tabs for: qt-123-456-789`
- Returns: `{ success: 2, errors: 1 }` (aggregate counts)
- No indication of which 2 tabs succeeded, which 1 failed, or why

Content script logs (not visible to Manager):

- Tab 1: RESTORE_QUICK_TAB received, rendering accepted
- Tab 2: RESTORE_QUICK_TAB received, rendering rejected with "CROSS-TAB BLOCKED"
- Tab 3: RESTORE_QUICK_TAB received, no response (timeout)

Manager cannot correlate aggregate count "2 success, 1 error" with actual tab
contexts.

</details>

<details>
<summary><strong>Issue 3 Detailed Evidence</strong></summary>

Minimize button click sequence:

- User clicks minimize button on Quick Tab window at T=0ms
- VisibilityHandler.handleMinimize() called, emits state:updated to internal bus
  at T=5ms
- StateManager persists to storage at T=10ms (async, completes at T=50ms)
- browser.storage.onChanged fires at T=100ms
- Manager receives event, calls loadQuickTabsState() at T=110ms
- Manager re-renders at T=120ms with updated minimized flag

Expected: Yellow indicator appears within 100-200ms Actual: Yellow indicator
appears after 100-300ms depending on storage event timing

No confirmation message from content script to Manager means Manager only learns
through storage polling.

</details>

<details>
<summary><strong>Issue 4 Detailed Evidence</strong></summary>

User drags Quick Tab window:

- At T=0ms, drag starts, handlePositionChange() fires every ~16ms during drag
- Each call updates quickTabsMap in-memory state but doesn't persist
- At T=500ms, user completes drag, handlePositionChangeEnd() called
- handlePositionChangeEnd() schedules \_persistToStorage() with 300ms debounce
- Storage write completes at T=800ms
- Manager's 2-second refresh cycle samples storage at T=800ms and shows updated
  value

Expected: Position updates visible in Manager during/immediately after drag
Actual: Position updates appear only after Manager's next refresh interval

No confirmation message means Manager doesn't know when storage write completes.

</details>

<details>
<summary><strong>Issue 6 Detailed Evidence</strong></summary>

Failed restore operation logs:

- Sidebar logs:
  `[Manager] Restored Quick Tab qt-123 via broadcast | success: 2, errors: 1`
- Tab 1 content logs:
  `[UICoordinator] CROSS-TAB BLOCKED: Quick Tab qt-123 belongs to tab 456 (currentTabId: 789)`
- Tab 2 content logs:
  `[UICoordinator] ✓ Cross-tab check PASSED: Quick Tab qt-123 origin tab 789 == currentTabId 789`

The rejection reason exists in content script logs but sidebar never sees it.
Sidebar only knows "1 error" without context.

</details>

<details>
<summary><strong>Storage Architecture Context</strong></summary>

Firefox WebExtension storage.local API:

- Writes from any context fire `browser.storage.onChanged` in all contexts
  simultaneously
- Change event includes oldValue and newValue but no metadata about source
- Per MDN documentation: "The listener is called on all pages that subscribe to
  the event, including the page that made the change"
- No built-in origin/source attribution in the change event

This means sidebar cannot distinguish between:

1. Storage changes from current tab's operations
2. Storage changes from other tabs' operations
3. Storage changes from background script operations

The extension must implement its own source attribution via metadata fields.

</details>

---

## Priority & Complexity

**Priority** Critical (Issues 1, 2, 6, 8) | High (Issues 3, 4, 5, 7)

**Target** Fix all in single coordinated PR using unified messaging and logging
patterns

**Estimated Complexity** High - Requires architectural changes to messaging
patterns and extensive logging instrumentation across 5+ files

**Dependencies** None - Issues can be addressed independently but share common
patterns

---

## Key Implementation Guidance

**Do NOT** attempt quick fixes that mask symptoms (e.g., adding arbitrary
timeouts to storage reads). Root cause is missing feedback loops in messaging
architecture.

**DO** implement proper confirmation/response patterns across all handlers. This
is the foundational fix that enables all other corrections.

**DO** tag all logging with Quick Tab ID, origin tab ID, and operation type for
debugging filter-ability.

**DO** validate originTabId existence before every rendering operation, with
fallback to ID pattern extraction for Manager restore scenarios.

**AVOID** storing detailed logs in storage (performance impact). Keep them in
console logs with appropriate filtering tags.
