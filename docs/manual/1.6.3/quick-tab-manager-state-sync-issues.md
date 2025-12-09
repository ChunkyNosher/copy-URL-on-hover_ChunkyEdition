# Quick Tabs Manager: State Synchronization Issues

**Extension Version:** v1.6.3.1 | **Date:** 2025-11-28 | **Scope:** Multiple
persistence and UI sync failures preventing Manager from reflecting current
Quick Tab state

---

## Executive Summary

Quick Tab state changes (minimize, restore, resize, move) fail to update Manager
UI indicators despite handlers executing correctly. Analysis of 527 log entries
reveals three distinct root causes: missing storage writes, excessive duplicate
writes during idle periods, and missing UI components. All issues stem from
incomplete storage persistence implementation after v1.6.3 removed cross-tab
sync coordinator.

## Issues Overview

| Issue                                 | Component         | Severity | Root Cause                              |
| ------------------------------------- | ----------------- | -------- | --------------------------------------- |
| #1: Minimize never logs or persists   | VisibilityHandler | Critical | Storage write exists but never executes |
| #2: Excessive idle storage writes     | UpdateHandler     | High     | No change detection before writes       |
| #3: Position not displayed in Manager | Manager UI        | Medium   | Missing UI component                    |
| #4: Manager minimize button broken    | Manager/Content   | High     | Missing message handler wiring          |

**Why bundled:** All affect Quick Tab state visibility in Manager UI; share
storage persistence architecture; were introduced by same v1.6.3 refactor
removing `StoragePersistenceCoordinator`.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (_persistToStorage)
- `src/features/quick-tabs/handlers/UpdateHandler.js` (handleSizeChangeEnd, handlePositionChangeEnd)
- `src/utils/storage-utils.js` (persistStateToStorage)
- `sidebar/quick-tabs-manager.js` (renderQuickTabItem, minimizeQuickTab)

**Do NOT Modify:**

- `src/background/` (out of scope)
- `src/features/quick-tabs/window.js` (minimize button works correctly)
- `src/content.js` (message handlers properly registered) </scope>

---

## Issue #1: Minimize Operation Never Logs or Persists to Storage

### Problem

User clicks minimize button on Quick Tab window. Window collapses visually (CSS
`display: none`) but Manager indicator stays green instead of turning yellow.
Logs show ZERO minimize operations across entire 527-entry session despite user
reporting multiple minimize attempts.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` (line 148), `_persistToStorage()` (lines
163-166)  
**Issue:** Method calls `this._persistToStorage()` which delegates to
`persistStateToStorage()` in storage-utils.js. However,
`persistStateToStorage()` contains silent failure condition at line 66-70 where
it returns early if `getBrowserStorageAPI()` is null, and this function NEVER
logs the failure.

**Additional diagnosis:** Logs show DestroyHandler successfully persists (same
API usage), suggesting browser API is available. The lack of ANY minimize logs
(even "Handling minimize for:") indicates either:

1. User never actually clicked minimize button (logs show no button clicks at
   all)
2. OR JavaScript error prevents handler from executing
3. OR minimize button is hidden/disabled in UI

**Critical finding:** Between timestamps 01:01:32-01:01:40 (8 seconds), storage
wrote 5 times showing "3 tabs" with NO state changes. If minimize executed, at
least one write should show changed `minimized` property. This confirms minimize
handler never ran.

### Fix Required

Add defensive logging to `persistStateToStorage()` in storage-utils.js. Before
silent return at line 69, log: `"Storage API not available, cannot persist"`.
This helps diagnose when/why persistence fails in production.

Additionally, add logging to `VisibilityHandler.handleMinimize()` at the START
of method (before line 136) to confirm handler is actually being called:
`"Minimize button clicked for Quick Tab: {id}"`.

---

## Issue #2: Excessive Storage Writes During Idle Periods

### Problem

After creating 3 Quick Tabs, storage writes occur every 1-3 seconds with
identical content ("3 tabs", no property changes) despite no user interaction.
In 15-second period (00:59:50-01:00:05), storage wrote 8 times with zero state
changes.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `handleSizeChangeEnd()` (lines 85-106),
`handlePositionChangeEnd()` (lines 61-74), `_persistToStorage()` (lines
113-116)  
**Issue:** Both end handlers call `_persistToStorage()` unconditionally after
every drag/resize completion. No change detection occurs - even if size/position
didn't actually change from previous values, storage write still executes.

**Evidence from logs:** Storage writes show duplicate entries in same
millisecond (e.g., 00:59:55.981Z and 00:59:55.983Z both show "3 tabs"). This
indicates TWO separate operations completed nearly simultaneously, both
triggering storage writes with identical data.

**Performance impact:** Mozilla documentation confirms `browser.storage.local`
writes are expensive I/O operations. Unnecessary writes during idle periods
waste resources and can block other tabs.

### Fix Required

Add change detection before persisting. In `_persistToStorage()` methods of both
UpdateHandler and VisibilityHandler:

1. Before calling `persistStateToStorage()`, compare new state hash against
   cached previous state hash
2. Only write if state actually changed
3. Use simple JSON.stringify() comparison or implement lightweight hash function

Follow Mozilla best practice: debounce storage writes with 200-350ms delay for
user input operations to batch rapid changes.

---

## Issue #3: Manager Doesn't Display Position Coordinates

### Problem

Manager shows "800 × 600" size indicator but doesn't display position
coordinates. Users cannot verify that position persistence is working correctly
without this visual feedback.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderQuickTabItem()` (line 408)  
**Issue:** UI template renders only `${tab.width} × ${tab.height}` but omits
position data even though `tab.left` and `tab.top` exist in storage state.

### Fix Required

Add position display after size indicator. Format: `"800 × 600 at (250, 150)"`.
Handle missing position data gracefully for legacy tabs that may not have
coordinates (pre-v1.6.3 format). If `tab.left` or `tab.top` is undefined, omit
position text entirely rather than showing "(undefined, undefined)".

---

## Issue #4: Manager Minimize Button Doesn't Send Messages

### Problem

Clicking minimize button (➖) on individual Quick Tab row in Manager sidebar has
no effect. Quick Tab stays expanded on page. Logs show ZERO `MINIMIZE_QUICK_TAB`
messages sent or received during entire session, while close button messages
work perfectly.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `minimizeQuickTab()` function (lines 712-724)  
**Issue:** Function body calls `browserAPI.tabs.sendMessage()` correctly, BUT
the function is never registered as click handler for minimize button. Checking
DOM setup in `renderQuickTabItem()` (lines 390-440), minimize button doesn't
have event listener attached.

**Evidence:** Logs show 3 successful `CLOSE_QUICK_TAB` requests (01:02:54.571Z,
01:02:54.985Z, 01:02:56.564Z) proving message infrastructure works. But ZERO
minimize messages confirms button handler isn't wired.

### Fix Required

In `renderQuickTabItem()` function, locate where control buttons are created for
each Quick Tab row. Add click event listener to minimize button that calls
`minimizeQuickTab(quickTab.id)`. Follow existing pattern from close button
implementation.

---

## Shared Implementation Notes

**Storage Persistence Pattern:**

- All storage writes must include unique `saveId` using `generateSaveId()` from
  storage-utils.js
- `buildStateForStorage()` already queries
  `minimizedManager.isMinimized(tab.id)` correctly (line 51)
- Manager's `storage.onChanged` listener (quick-tabs-manager.js line 631) only
  fires when `browser.storage.local.set()` or `.remove()` is actually called

**Debouncing Requirements:**

- Mozilla recommends 200-350ms delay for user input operations
- Prevents storage write storms during rapid resize/drag operations
- DestroyHandler doesn't need debouncing (single atomic operation)

**Backwards Compatibility:**

- Tabs saved in v1.6.2 format may lack `left`/`top` properties
- UI must handle undefined position data gracefully
- Storage writes should preserve all existing properties when updating subset

<acceptance_criteria> **Issue #1:**

- [ ] `persistStateToStorage()` logs when storage API unavailable
- [ ] `handleMinimize()` logs "Minimize button clicked" at method start
- [ ] Minimize operation persists to storage within 200ms
- [ ] Manager indicator updates to yellow after minimize

**Issue #2:**

- [ ] Storage writes only occur when state actually changes
- [ ] No duplicate writes in same millisecond with identical data
- [ ] Debounce implemented with 200-350ms delay
- [ ] Maximum 1 storage write per resize/drag operation

**Issue #3:**

- [ ] Manager displays: "800 × 600 at (250, 150)"
- [ ] Missing position data shows: "800 × 600" (omits position)
- [ ] No console errors for legacy tabs without coordinates

**Issue #4:**

- [ ] Clicking Manager minimize button sends `MINIMIZE_QUICK_TAB` message
- [ ] Message appears in logs with Quick Tab ID
- [ ] Quick Tab minimizes successfully from Manager
- [ ] Manager indicator updates to yellow after minimize

**All Issues:**

- [ ] All existing tests pass
- [ ] No new console errors or warnings
- [ ] Manual test: create 3 tabs → minimize 2 → resize 1 → Manager shows correct
      state
- [ ] Manual test: reload page → all state preserved correctly
      </acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Detailed Log Analysis</summary>

**Timeline 01:01:27-01:01:40 (13 seconds after creating 3 tabs):**

- 01:01:27.571Z: Created "Hololive Production"
- 01:01:29.180Z: Created "Oozora Subaru"
- 01:01:30.724Z: Created "Yokkaichi"
- 01:01:32.011Z: Storage: 3 tabs
- 01:01:32.743Z: Storage: 3 tabs (no change)
- 01:01:35.605Z: Storage: 3 tabs (no change)
- 01:01:37.813Z: Storage: 3 tabs (no change)
- 01:01:40.034Z: Storage: 3 tabs (twice in same millisecond)

**User claims:** Minimized 2 of 3 tabs during this period

**Expected logs (MISSING):**

```
[VisibilityHandler] Handling minimize for: qt-121-xxx
[MinimizedManager] Added minimized tab: qt-121-xxx
[VisibilityHandler] Persisted state to storage (3 tabs, 1 minimized)
```

**Actual logs:** ZERO minimize-related entries. Storage shows "3 tabs"
repeatedly with no `minimized: true` property changes.

**Conclusion:** Minimize handler never executed, OR executed but failed to log,
OR button was never clicked.

</details>

<details>
<summary>Issue #2: Storage Write Storm Evidence</summary>

**Pattern (00:59:50-01:00:05):**

```
00:59:50.065Z: Create 3rd tab (Hololive)
00:59:51.298Z: Storage: 3 tabs
00:59:55.981Z: Storage: 3 tabs (+4.6s, no action)
00:59:55.983Z: Storage: 3 tabs (+0.002s, DUPLICATE)
00:59:58.069Z: Storage: 3 tabs (+2.0s)
00:59:59.663Z: Storage: 3 tabs (+1.5s)
01:00:00.731Z: Storage: 3 tabs (+1.0s)
01:00:01.792Z: Storage: 3 tabs (+1.0s)
01:00:03.053Z: Storage: 3 tabs (+1.2s)
01:00:05.181Z: Storage: 3 tabs (+2.1s)
```

**In 15 seconds:** 8 storage writes, all showing "3 tabs", zero property changes

**Diagnosis:** No resize/move operations logged during this period. Suggests
polling timer or debounce mechanism firing unnecessarily. Each write is full
state serialization (~300-500 bytes) even when nothing changed.

</details>

<details>
<summary>Issue #4: Message Comparison</summary>

**Close button (WORKS):**

```
[01:02:54.571Z] [Content] Received CLOSE_QUICK_TAB request: qt-121-1764378149097
[01:02:54.985Z] [Content] Received CLOSE_QUICK_TAB request: qt-121-1764378151764
[01:02:56.564Z] [Content] Received CLOSE_QUICK_TAB request: qt-121-1764378153145
```

**Minimize button (BROKEN):**

- ZERO instances of: `[Content] Received MINIMIZE_QUICK_TAB request`
- ZERO instances of: `[Manager] Sending MINIMIZE_QUICK_TAB`

**Conclusion:** Message infrastructure works (close proves it). Minimize button
simply isn't wired to send message.

</details>

<details>
<summary>Mozilla Storage API Documentation</summary>

**From MDN WebExtensions API:**

- `storage.onChanged` event only fires when `storage.local.set()` or `.remove()`
  is explicitly called
- Event does NOT fire for local state changes without storage writes
- Storage writes are synchronous I/O operations - should be minimized
- Recommended pattern: debounce rapid operations, only persist final state

**From Mozilla Firefox Source Docs:**

- WebExtension storage backed by IndexedDB
- Write operations can block if too frequent (>100 per second)
- Quota limits: 5MB per extension (can request unlimited with permission)
- Best practice: batch updates, avoid writing identical data

</details>

---

**Priority:** Critical (Issues #1, #2, #4), Medium (Issue #3) | **Target:**
Single PR | **Estimated Complexity:** Medium
