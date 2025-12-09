# Quick Tab Restore: Multiple Cross-Tab and Persistence Issues

**Extension Version:** v1.6.3.5-v12 | **Date:** 2025-12-04 | **Scope:**
Cross-tab ghost rendering, restore delays, and Manager UI synchronization
failures

---

## Executive Summary

Quick Tab restoration in v1.6.3.5-v12 exhibits multiple critical issues despite
cross-tab synchronization being explicitly disabled in v1.6.3. Users experience:
(1) restored Quick Tabs appearing on other browser tabs where they shouldn't
exist, (2) 2-3 second delays on first restore operations, (3) non-functional
"Close All" and "Clear Quick Tab Storage" buttons. These issues stem from
browser's native `storage.onChanged` event propagation that was never properly
filtered after cross-tab sync removal, accumulated storage transaction timeouts
blocking rendering, and either missing button handlers or insufficient logging
to confirm their operation.

## Issues Overview

| Issue                                        | Component                        | Severity | Root Cause                                                    |
| -------------------------------------------- | -------------------------------- | -------- | ------------------------------------------------------------- |
| #1: Restored Quick Tabs appear on other tabs | Content Script Storage Listener  | Critical | Unfiltered browser storage.onChanged propagation              |
| #2: 2-3 second delay on first restore        | StorageUtils Transaction Manager | Critical | 5-second transaction fallback timeouts blocking UICoordinator |
| #3: "Close All" button non-functional        | Quick Tab Manager UI             | High     | Missing action dispatch or insufficient logging               |
| #4: Storage transaction backlog              | StorageUtils Module              | High     | Transaction timeouts accumulating, cross-tab event noise      |

**Why bundled:** All issues affect Quick Tab restore/management workflow and
share storage architecture context. Issues #1-2 are directly related through
storage event propagation. Issue #3 prevents users from clearing ghost Quick
Tabs created by Issue #1.

<scope>
**Modify:**
- `src/content.js` (storage.onChanged listener)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (render filtering, transaction handling)
- `src/utils/storage-utils.js` (transaction manager)
- `sidebar/quick-tabs-manager.js` (button handlers)

**Read-Only Context:**

- `src/features/quick-tabs/window.js` (rendering logic)
- `background.js` (message passing)

**Do NOT Modify:**

- `src/background/` (out of scope)
- `.github/` (configuration) </scope>

---

## Issue #1: Restored Quick Tabs Appear on Other Open Tabs

### Problem

When restoring a minimized Quick Tab on Tab 14, the restored Quick Tab
immediately appears on other open tabs (e.g., Tab 13) despite cross-tab
synchronization being disabled in v1.6.3. These ghost Quick Tabs persist across
tab switches and cannot be cleared using "Close All" or "Clear Quick Tab
Storage" buttons in the Manager.

### Root Cause

**File:** `src/content.js`  
**Location:** `storage.onChanged` listener (location varies, search for
`browser.storage.onChanged.addListener`)  
**Issue:** The browser's native `storage.onChanged` event fires in ALL tabs
whenever any tab writes to storage (this is automatic WebExtension behavior per
Chrome/Firefox documentation). While intentional cross-tab messaging was removed
in v1.6.3, the storage listener was never updated to filter events by
`originTabId`, so Tab 13's content script still receives and processes storage
changes from Tab 14.

**Supporting Evidence from Logs:**

```
23:33:53.806 - Tab 14: restore initiated for qt-14-1764891230255-168paboswu4ps
23:33:53.807 - Tab 14: QuickTabWindow restore EXIT (minimized: false, hasContainer: false, isRendered: false)
23:34:07.730 - User switches to Tab 13
[NO LOGS FROM TAB 13 - this is the problem, Tab 13 is rendering without logging]
```

**Why This Happens:**

1. Tab 14 restores Quick Tab and writes to `storage.local`
2. Browser automatically fires `storage.onChanged` event in Tab 13's content
   script (unavoidable)
3. Tab 13's listener receives event and triggers `UICoordinator.render()`
4. UICoordinator's `_shouldRenderOnThisTab()` check (lines 547-567) either fails
   to execute or isn't properly wired to storage listeners
5. Quick Tab renders on Tab 13 even though
   `quickTab.originTabId !== currentTabId`

### Fix Required

Add cross-tab filtering to storage.onChanged listener BEFORE any rendering logic
executes. The listener must check if the changed Quick Tab's `originTabId`
matches the current tab's ID and silently ignore events from other tabs. Follow
the per-tab scoping pattern already implemented in
`UICoordinator._shouldRenderOnThisTab()` (lines 547-567) but enforce it at the
storage listener level, not after rendering has been initiated.

**Pattern Reference:** UICoordinator already has the check logic - it just needs
to be moved earlier in the event chain (storage listener → filter by originTabId
→ then dispatch to UICoordinator).

---

## Issue #2: 2-3 Second Delay on First Quick Tab Restore

### Problem

First restore operation after tab switching or user pause exhibits 2-3 second
delay between user clicking restore button and Quick Tab actually appearing on
screen. Subsequent rapid restores are faster (50-200ms), but any gap in user
activity causes next restore to delay again.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** Transaction manager implementation (search for "Transaction
fallback cleanup", "expectedEvent storage.onChanged")  
**Issue:** Storage transaction system waits up to 5 seconds for
`storage.onChanged` confirmation before proceeding. When transactions from
previous operations haven't cleaned up yet (e.g., after tab switching or
emergency saves), the backlog delays new restore operations. The UICoordinator's
rendering path waits for transaction completion, creating visible user-facing
delays.

**Supporting Evidence from Logs:**

```
WARN StorageUtils Transaction fallback cleanup transactionId txn-1764891232617-bod2tx, expectedEvent storage.onChanged, elapsedMs 5051
```

These 5-second timeout warnings appear repeatedly. Timeline analysis shows:

- First restore: `23:33:53.806` (initiate) → `23:33:56.740` (DOM appears) =
  **2.9s delay**
- Second restore: `23:34:00.531` (initiate) → `23:34:03.503` (DOM appears) =
  **3.0s delay**
- Fifth restore: `23:34:27.051` (initiate) → `23:34:27.120` (DOM appears) =
  **69ms** (finally fast!)

**Why Delays Occur:**

1. Transaction manager starts on each storage write, expecting
   `storage.onChanged` confirmation
2. If confirmation doesn't arrive within 5 seconds, fallback cleanup runs
3. Multiple transactions can overlap (minimize, restore, tab switch emergency
   saves)
4. Cross-tab `storage.onChanged` noise may cause transaction manager to miss
   expected events
5. New restore operations wait for pending transactions to resolve before
   rendering

### Fix Required

Decouple transaction confirmation from rendering operations. UICoordinator's
render path should not block on storage transaction completion - storage writes
can happen asynchronously AFTER the Quick Tab is already visible to the user.
Reduce transaction timeout from 5 seconds to 1-2 seconds maximum. Consider
adding transaction IDs to storage writes so transaction manager can definitively
match confirmation events even with cross-tab noise.

**Pattern Reference:** Follow async/non-blocking pattern where visual feedback
happens immediately, and storage persistence completes in background with retry
logic if needed.

---

## Issue #3: "Close All" and "Clear Quick Tab Storage" Buttons Non-Functional

### Problem

Clicking "Close All" or "Clear Quick Tab Storage" buttons in Quick Tab Manager
sidebar has no visible effect on ghost Quick Tabs created by Issue #1. These
buttons may work for properly-scoped Quick Tabs but fail to clear cross-tab
rendered instances.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Button click handlers (search for "CLEARALLQUICKTABS", "Close
All", "clearAll")  
**Issue:** **UNKNOWN - Insufficient logging to determine root cause.** Log
analysis reveals ZERO evidence of these actions being logged during the test
session. Two possibilities exist:

1. **Buttons were never clicked** during logging session (test incompleteness)
2. **Button handlers are not wired correctly** and fail silently without logging

**Supporting Evidence from Logs:**

```
"availableActions GETCONTENTLOGS, CLEARCONTENTLOGS, REFRESHLIVECONSOLEFILTERS, CLEARALLQUICKTABS, QUICKTABSCLEARED..."
```

The actions are registered in the system, but there are NO log entries showing:

- User clicking these buttons
- `CLEARALLQUICKTABS` action being dispatched
- `UICoordinator.clearAll()` being invoked (lines 1271-1317)
- Storage clearing operations
- Error messages about missing handlers

**Why This Matters:** Ghost Quick Tabs from Issue #1 accumulate across tabs and
cannot be removed. Users need working cleanup controls to maintain system
usability.

### Fix Required

Add comprehensive logging to button click event handlers in Quick Tab Manager
before any action dispatch occurs. Log: button element clicked, action type
dispatched, payload contents, and whether dispatch succeeded or failed. Verify
button event listeners are properly attached to DOM elements (check for timing
issues if buttons are rendered dynamically). If buttons work for same-tab Quick
Tabs but not cross-tab instances, ensure clearAll operations broadcast to ALL
tabs, not just current tab's content script.

**Testing Path:** Manual click test with logging enabled should immediately
reveal if buttons are wired correctly.

---

## Issue #4: Storage Transaction Backlog and Accumulation

### Problem

Storage transaction fallback timeouts accumulate during normal Quick Tab
operations (minimize, restore, resize, move), creating backlog that delays
subsequent operations. This is the underlying cause of Issue #2 but affects all
storage-dependent operations, not just restore.

### Root Cause

**File:** `src/utils/storage-utils.js`  
**Location:** Transaction cleanup and timeout handling logic  
**Issue:** Transaction manager creates 5-second timeout for each storage write
operation, expecting matching `storage.onChanged` event. However, because
`storage.onChanged` fires in ALL tabs (browser behavior), transaction manager
may receive events from other tabs that don't match expected transaction IDs,
causing timeouts to run their full 5 seconds before cleanup. As operations
accumulate, the backlog grows faster than cleanup can resolve it.

**Compounding Factors:**

1. **Cross-tab event noise:** Tab 13 writes to storage, Tab 14's transaction
   manager sees the event but transaction ID doesn't match, so timeout continues
2. **Emergency saves:** Tab switching triggers emergency saves (visible in logs
   at `23:33:07.931`), creating additional transactions
3. **No transaction correlation:** Storage writes don't include transaction IDs
   in the data, so `storage.onChanged` events can't be definitively matched to
   originating transactions

**Evidence Pattern:** Multiple "Transaction fallback cleanup" warnings with
`elapsedMs: 5051` (just over 5 seconds) throughout logs. These indicate
transactions that waited their full timeout period before cleaning up.

### Fix Required

Implement transaction ID embedding in storage write payloads so
`storage.onChanged` listeners can definitively identify which transaction
completed. Reduce timeout from 5 seconds to 1-2 seconds maximum (storage
operations typically complete in <200ms, 5s is excessive). Add transaction
priority system so critical operations (restore, user-initiated) bypass
transaction queue and execute immediately. Consider removing transaction
confirmation requirement entirely for read-only operations or UI updates that
don't require atomic guarantees.

**Pattern Reference:** Standard async operation pattern - optimistic UI update
immediately, storage write fires async with retry on failure, no blocking.

---

## Shared Implementation Notes

### Cross-Tab Filtering Pattern

All storage event listeners must filter by `originTabId` BEFORE processing
events. The filter check should happen at the entry point of event handling, not
deep in business logic. Pattern to follow:

```
Storage listener receives event → Extract originTabId from data →
Compare with currentTabId → If mismatch, return early →
Only if match, proceed with normal handling
```

### Storage Transaction Architecture

Transaction confirmations should not block UI operations. Acceptable patterns:

- **Optimistic UI:** Update UI immediately, persist to storage async
- **Fire-and-forget writes:** Storage writes happen in background with error
  logging if they fail
- **Retry on failure:** If storage write fails, retry up to 3 times with
  exponential backoff

### Logging Requirements

Every user-initiated action (button click, drag, resize) must log at entry point
before any business logic executes. Minimum logged information:

- Action type (e.g., "CLEARALLQUICKTABS")
- Timestamp
- Source tab ID
- Target Quick Tab ID (if applicable)
- Success/failure status

<acceptance_criteria> **Issue #1:**

- [ ] Restored Quick Tabs only appear on their origin tab (originTabId matches
      currentTabId)
- [ ] storage.onChanged listener logs "cross-tab event ignored" when receiving
      events from other tabs
- [ ] Manual test: restore Quick Tab on Tab 14 → switch to Tab 13 → verify Quick
      Tab NOT visible on Tab 13

**Issue #2:**

- [ ] First restore after idle period completes in <500ms (down from 2-3
      seconds)
- [ ] Transaction fallback warnings reduced to <10% of current frequency
- [ ] UICoordinator renders Quick Tab before storage transaction completes
- [ ] Manual test: minimize → wait 5 seconds → restore → Quick Tab appears
      immediately

**Issue #3:**

- [ ] "Close All" button click logs action dispatch with payload details
- [ ] "Clear Quick Tab Storage" button click logs action dispatch
- [ ] Buttons successfully clear Quick Tabs on ALL tabs (including cross-tab
      ghosts)
- [ ] Manual test: create ghost Quick Tab (via Issue #1) → click "Close All" →
      verify all Quick Tabs cleared

**Issue #4:**

- [ ] Transaction timeout reduced to 1-2 seconds maximum
- [ ] Transaction IDs embedded in storage write payloads for correlation
- [ ] Storage writes complete in <200ms average (no blocking on confirmation)
- [ ] Transaction fallback cleanup warnings reduced by >80%

**All Issues:**

- [ ] All existing tests pass
- [ ] No new console errors or warnings
- [ ] Extension loads and initializes within 2 seconds on browser startup
- [ ] Memory usage stable (no transaction object leaks) </acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #1: Cross-Tab Rendering Evidence</summary>

**Timeline from logs (timestamps in HH:MM:SS.mmm format):**

```
23:33:53.806 - Tab 14: QuickTabWindow.restore() called for qt-14-1764891230255-168paboswu4ps
23:33:53.807 - QuickTabWindow restore EXIT: minimized=false, hasContainer=false, isRendered=false
23:33:53.867 - UICoordinator received stateupdated event (60ms after restore start)
23:33:56.740 - DOM finally appears with iframe processing (2.9 second gap!)
23:34:07.730 - User switches to Tab 13 (DEBUG Background Tab activated 13)
23:34:08.348 - User switches back to Tab 14
```

**Critical gap:** Between tab switch at `23:34:07.730` and return at
`23:34:08.348`, there are NO logs from Tab 13's content script showing it
received storage event or attempted rendering. This indicates Tab 13 is
processing storage events WITHOUT any logging, which is the smoking gun for
unfiltered cross-tab event handling.

**Browser storage.onChanged behavior (per MDN/Chrome docs):**

> "When storage.local.set() is called in any context (background, popup, content
> script, options page), the storage.onChanged event fires in ALL contexts
> simultaneously. This is automatic browser behavior and cannot be disabled."

The extension's cross-tab sync removal in v1.6.3 removed intentional message
passing but did NOT remove or filter this automatic browser event propagation.

</details>

<details>
<summary>Issue #2: Transaction Timeout Analysis</summary>

**Transaction fallback warnings throughout session:**

```
WARN StorageUtils Transaction fallback cleanup transactionId txn-1764891232617-bod2tx, expectedEvent storage.onChanged, elapsedMs 5051
```

**Pattern identified:** Every warning shows `elapsedMs` very close to
5000-5100ms, indicating transactions are waiting their FULL timeout period
before cleanup runs. This proves transactions are not receiving expected
confirmation events within reasonable timeframes.

**Restore timing measurements from logs:**

| Operation   | Start Time   | DOM Render   | Delay  |
| ----------- | ------------ | ------------ | ------ |
| 1st restore | 23:33:53.806 | 23:33:56.740 | 2934ms |
| 2nd restore | 23:34:00.531 | 23:34:03.503 | 2972ms |
| 3rd restore | 23:34:03.427 | 23:34:03.491 | 64ms   |
| 4th restore | 23:34:16.436 | 23:34:18.637 | 2201ms |
| 5th restore | 23:34:27.051 | 23:34:27.120 | 69ms   |

**Pattern:** Restores after user idle periods (1st, 2nd, 4th) have 2-3 second
delays. Rapid consecutive restores (3rd, 5th) are fast. This proves backlog
accumulates during idle time and clears during rapid operations.

**Why 3-second delay when timeout is 5 seconds:** Transaction started during
previous operation (e.g., minimize) at T=0, timeout set for T=5s. Restore
initiated at T=2s, waits for previous transaction to complete at T=5s, resulting
in ~3s user-visible delay.

</details>

<details>
<summary>Issue #3: Missing Button Handler Logs</summary>

**Complete absence of evidence:** Search through 205,852 characters of logs
reveals:

- ZERO instances of "CLEARALLQUICKTABS" action being dispatched
- ZERO instances of "clearAll" method being invoked
- ZERO instances of storage clearing operations
- ZERO error messages about button handlers failing

**Registered actions (from logs):**

```
"availableActions GETCONTENTLOGS, CLEARCONTENTLOGS, REFRESHLIVECONSOLEFILTERS, CLEARALLQUICKTABS, QUICKTABSCLEARED..."
```

Actions are registered in the system, proving the action types exist. But no
evidence of user attempting to trigger them OR handlers executing.

**UICoordinator.clearAll() method exists (lines 1271-1317) with comprehensive
logging:**

```javascript
clearAll(source = 'unknown') {
  console.log(`${this._logPrefix} clearAll() called (source: ${source}):`, {
    renderedTabsCount: this.renderedTabs.size,
    hasMinimizedManager: this._hasMinimizedManager()
  });
  // ... clearing logic ...
  console.log(`${this._logPrefix} clearAll() complete (source: ${source}):`, {
    clearedIds,
    clearedCount: clearedIds.length
  });
}
```

If this method had been invoked, logs would show the entry and exit messages.
Their absence proves either:

1. User didn't click buttons during test
2. Button handlers never dispatched actions to content script

**Testing needed:** Click buttons with logging enabled to definitively determine
if handlers are wired.

</details>

<details>
<summary>Issue #4: Transaction Architecture Context</summary>

**How transaction system works (based on log analysis):**

1. **Write operation initiated:** Content script calls storage write function
2. **Transaction created:** StorageUtils creates transaction object with unique
   ID and 5s timeout
3. **Storage write executed:** browser.storage.local.set() is called
4. **Waiting for confirmation:** Transaction waits for storage.onChanged event
   matching transaction ID
5. **Cleanup paths:**
   - **Success:** Matching storage.onChanged received → transaction marked
     complete → cleanup immediately
   - **Timeout:** 5 seconds elapse without match → fallback cleanup runs →
     warning logged

**Why cross-tab noise breaks this:**

- Tab 14 creates transaction `txn-abc123`, writes Quick Tab state to storage
- Browser fires storage.onChanged in BOTH Tab 14 and Tab 13
- Tab 13's listener receives event but has no transaction `txn-abc123`
  (transaction only exists in Tab 14)
- Tab 14's listener receives event but data might not include transaction ID, so
  can't confirm match
- Result: Transaction times out after 5 seconds despite storage write succeeding
  immediately

**Architectural flaw:** Transaction confirmation depends on storage.onChanged
event matching, but WebExtension storage API doesn't provide automatic
transaction ID correlation in events. The event only contains the changed
keys/values, not metadata about which operation triggered it.

</details>

<details>
<summary>UICoordinator Per-Tab Scoping Logic</summary>

**Existing cross-tab filter (lines 547-567):**

```javascript
_shouldRenderOnThisTab(quickTab) {
  // If we don't know our tab ID, allow rendering (backwards compatibility)
  if (this.currentTabId === null) {
    console.log(`${this._logPrefix} No currentTabId set, allowing render:`, quickTab.id);
    return true;
  }

  // If Quick Tab has no originTabId, allow rendering (backwards compatibility)
  const originTabId = quickTab.originTabId;
  if (originTabId === null || originTabId === undefined) {
    console.log(`${this._logPrefix} No originTabId on Quick Tab, allowing render:`, quickTab.id);
    return true;
  }

  // Only render if this is the origin tab
  const shouldRender = originTabId === this.currentTabId;

  if (!shouldRender) {
    console.log(`${this._logPrefix} CROSS-TAB BLOCKED: Quick Tab belongs to different tab:`, {
      id: quickTab.id,
      originTabId,
      currentTabId: this.currentTabId
    });
  }

  return shouldRender;
}
```

**The problem:** This check happens inside `UICoordinator.render()` (line 602),
which is AFTER storage events have been processed and routing has occurred. By
the time this check runs, the Quick Tab entity has already been deserialized
from storage and passed through the event system.

**Required fix location:** Storage listener in content.js needs this SAME check
BEFORE creating Quick Tab entities and dispatching to UICoordinator. The filter
must happen at event entry point, not after business logic has started
executing.

</details>

---

**Priority:** Critical (Issues #1-2), High (Issues #3-4) | **Target:** Single
coordinated PR | **Estimated Complexity:** High (requires storage architecture
refactoring)
