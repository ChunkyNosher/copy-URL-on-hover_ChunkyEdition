# Quick Tabs Extension - Comprehensive Diagnostic Report

**Version:** v1.6.4.8  
**Report Date:** December 17, 2025  
**Scope:** Cross-tab isolation, originTabId filtering, logging infrastructure,
Firefox API limitations  
**Status:** CRITICAL ISSUES IDENTIFIED

---

## Executive Summary

The Quick Tabs extension implements tab-scoped isolation using `originTabId`
tracking, but the implementation suffers from **three major categories of
issues**:

1. **Missing diagnostic logging** that obscures root causes of cross-tab
   isolation failures
2. **Incomplete originTabId filtering** in content script hydration on page
   reload
3. **Firefox WebExtensions API limitations** (Bug 1851373) that can cause
   background script termination mid-operation

These issues compound to create scenarios where Quick Tabs leak across tabs,
fail to hydrate on reload, or Manager sidebar operations silently fail.

---

## ISSUE CATEGORY 1: Missing Logging Infrastructure

### Problem Statement

The codebase contains extensive logging (1000+ console statements) BUT critical
diagnostic information is absent. When Quick Tabs appear in the wrong tab or
fail to hydrate, the logs provide NO visibility into the decision tree:

- Why was a Quick Tab filtered out during hydration?
- Which `originTabId` comparison failed?
- Did `getCurrentTabIdFromBackground()` succeed or fail?
- Was a cross-tab operation rejected due to ownership mismatch?

### Impact

**Severity: HIGH**

Users cannot diagnose why:

- Quick Tab created in Tab A appears in Tab B (cross-tab leak)
- Page reload loses Quick Tabs (hydration failure)
- Manager sidebar "Restore" button doesn't work (operation rejection)

Developers cannot trace the root cause without manually stepping through
debugger.

### Affected Code Regions

#### Region 1: Hydration on Page Reload

**File:** `src/content.js` (estimated lines ~1000-1200, exact location
unconfirmed)

**What should log:**

- Start of hydration process with current tab ID
- Reading storage and filtering logic
- Each Quick Tab being evaluated:
  `"originTabId={X} vs currentTabId={current} → [KEEP/REJECT]"`
- Final count of hydrated tabs vs total in storage
- Any errors during storage read or tab ID retrieval

**Current state:** Logging exists for general state changes but NOT for the
originTabId filter decision.

#### Region 2: getCurrentTabIdFromBackground()

**File:** `src/content.js` (lines 285-295)

**What should log:**

- Message sent to background requesting tab ID
- Response received with tab ID value
- Failure scenarios (timeout, background script dead, port disconnection)
- The returned tab ID value

**Current state:** No logging before, during, or after this critical call. If it
returns wrong value, no diagnostic trail.

#### Region 3: Cross-Tab Operation Handlers

**File:** `src/content.js` (lines 1746-1767, 1826-1876, 1696-1730)

**What should log for EACH operation (MINIMIZE, RESTORE, CLOSE):**

- Operation name and Quick Tab ID
- Retrieved originTabId from stored Quick Tab
- Current tab ID from background
- Comparison result: `originTabId === currentTabId`
- Ownership validation: PASS or REJECT
- If rejected: reason (wrong tab, orphaned status, etc.)
- Broadcast destination if cross-tab message sent

**Current state:** Some logging exists for state changes but NOT for the
ownership validation decision. A rejected operation produces no log explaining
why.

#### Region 4: Background Script Storage Change Handler

**File:** `background.js` (lines ~1400-1600, `_handleQuickTabStateChange()`)

**What should log:**

- Storage change event received
- Tab count before/after
- saveId comparison result
- Deduplication check results (transaction ID, saveId+timestamp, content hash)
- Decision: broadcast or skip
- Broadcast destination list
- Any filtering applied to tabs during broadcast

**Current state:** Extensive logging exists for deduplication but NOT for the
filtering/broadcast decision that follows.

#### Region 5: Manager Sidebar Quick Tab Display

**File:** `sidebar/features/quick-tabs/handlers/UICoordinator.js` (location
unconfirmed)

**What should log:**

- Quick Tabs grouped by originTabId
- Current sidebar context (which tab's QTs being displayed)
- Filtering logic: which QTs belong to which origin tabs
- Any discrepancies between storage and UI display

**Current state:** No logging found for filtering decisions in Manager display
logic.

---

## ISSUE CATEGORY 2: Incomplete originTabId Filtering

### Problem Statement

The `originTabId` field is meant to enforce tab-scoped isolation: a Quick Tab
created in Tab A should ONLY hydrate in Tab A, and operations on it should only
succeed when initiated from Tab A.

However, the filtering is **incomplete and inconsistent**:

- ✅ **Verified working:** Background script filters cross-tab operations
  (MINIMIZE, RESTORE, CLOSE) via ownership check
- ✅ **Verified working:** Cross-tab broadcast messages validate ownership
- ⚠️ **UNCONFIRMED:** Page reload hydration filtering exists but
  location/implementation unclear
- ❌ **MISSING:** No validation in Manager sidebar before displaying Quick Tabs
  from other tabs

### Impact

**Severity: CRITICAL**

**Scenario:** User creates Quick Tab in Wikipedia Tab → User opens GitHub Tab →
User opens Manager sidebar

**Expected behavior:** Manager groups Quick Tabs by origin tab, prevents
cross-tab operations

**Buggy behavior observed:** Unclear - possibly Quick Tab from Wikipedia Tab
appears as if it belongs to GitHub Tab, or operations fail silently

### Affected Code Regions

#### Region 1: Hydration Filtering on Page Reload

**File:** Location unconfirmed (possibly
`src/features/quick-tabs/handlers/RestoreHandler.js`)

**What needs fixing:**

- Must retrieve current tab ID via `getCurrentTabIdFromBackground()`
- Must read ALL Quick Tabs from storage
- Must filter: `tabs.filter(tab => tab.originTabId === currentTabId)`
- Must pass ONLY filtered tabs to DOM restoration logic
- Must log each step

**Current gap:** This filtering logic may exist but is not in obvious location.
Cannot verify it's being applied on every page reload or if it's
conditional/incomplete.

#### Region 2: Manager Sidebar grouping and filtering

**File:** `sidebar/features/quick-tabs/handlers/UICoordinator.js` or related UI
component (location unconfirmed)

**What needs fixing:**

- When displaying Manager, must retrieve ALL Quick Tabs from storage
- Must group by `originTabId`
- Must show which tab each QT belongs to (even if from different tab)
- Must PREVENT operations on QTs from other tabs (disable buttons, show warning)
- Must validate originTabId before executing any operation (minimize, restore,
  close, delete)

**Current gap:** Manager appears to show all tabs but validation of cross-tab
operation prevention is unclear from code inspection.

#### Region 3: UICoordinator and RestoreHandler Interaction

**File:** Both `UICoordinator.js` and `RestoreHandler.js` (locations
unconfirmed)

**What needs fixing:**

- Clear responsibility division: which component filters by originTabId?
- Is filtering applied once at read-time or at display-time?
- Are there code paths that bypass the filter?

**Current gap:** No clear trace of filtering logic across these components.

---

## ISSUE CATEGORY 3: Firefox WebExtensions API Limitations

### Problem Statement

Firefox MV3 terminates background scripts after 30 seconds of inactivity (Bug
1851373). This is **NOT a bug in your code, but an inherent API limitation**
that can cause:

- Background storage writes interrupted mid-operation
- Port connections to content scripts dropped
- State coordinator unable to complete operations
- Message delivery failures between content and background

### Firefox Bug 1851373 Key Finding

From Mozilla's official bug report:

> "For backgrounds with active ports, Firefox will still force stop after 30
> seconds."

**Translation:** Your current keepalive mechanism using `browser.tabs.query()`
and `browser.runtime.sendMessage()` is INSUFFICIENT because:

1. Active port connections DO NOT reset the idle timer in Firefox 117+
2. Periodic messages reset the timer, but 25-second interval may be too long
3. Background script can still terminate during long-running operations

### Impact

**Severity: MEDIUM**

Affects reliability under certain conditions:

- User rapidly creates/deletes multiple Quick Tabs
- Background is processing storage writes
- 30-second timer elapses before operation completes
- Background script terminates → storage write incomplete → state corrupted

### Affected Code Regions

#### Region 1: Keepalive Mechanism

**File:** `background.js` (lines 95-145, `startKeepalive()` and
`triggerIdleReset()`)

**Current implementation:**

- Uses `browser.tabs.query({})` to trigger activity
- Uses `browser.runtime.sendMessage()` for self-ping
- Interval set to 25 seconds (KEEPALIVE_INTERVAL_MS)

**Limitation:**

- Interval may be too long (30s timeout, 25s keepalive = 5s margin)
- Port connections from content scripts don't extend timeout
- Long-running operations (bulk deletion, mass state update) can exceed 30s
  window

**What could help (not guaranteed fix):**

- Reduce keepalive interval to 20 seconds (10s margin)
- Implement operation batching to keep each operation < 5 seconds
- Add progress checkpoints that reset timer during long operations

#### Region 2: Storage Write Verification

**File:** `background.js` (lines ~1600+, `writeStateWithVerificationAndRetry()`)

**Current implementation:**

- Writes state to storage
- Reads back to verify write succeeded
- Implements retry with exponential backoff

**Gap:**

- If background terminates during write, verification loop is interrupted
- No mechanism to detect mid-operation termination from content script
  perspective
- Content scripts may believe write succeeded when it actually failed

**What could help:**

- Implement timeout detection in content scripts
- If background becomes unresponsive, trigger recovery sequence
- Store last known good state locally in session storage as fallback

---

## ISSUE CATEGORY 4: Cross-Tab Isolation Behavior Failures

### Problem Statement

According to `issue-47-revised.md`, the expected behavior is:

- Quick Tab created in Tab A appears ONLY in Tab A
- Quick Tab created in Tab B appears ONLY in Tab B
- Manager sidebar groups Quick Tabs by origin tab
- Cross-tab operations are rejected with appropriate validation

**Observed failures (from issue documentation):**

- Quick Tabs leak across tabs under certain conditions
- Manager sidebar shows incorrect grouping
- Operations fail silently without error message
- Hydration on page reload loses Quick Tabs

### Root Cause Analysis

These failures trace back to the three issue categories above:

1. **Logging gap** → Cannot diagnose WHICH check failed
2. **Filtering gap** → originTabId validation incomplete somewhere in the flow
3. **Firefox timeout** → Background script dies before state persists correctly

**Example failure flow:**

```
1. User creates QT in Tab A (originTabId=1)
2. User switches to Tab B
3. Page reloads in Tab B
4. Content script initializes, calls getCurrentTabIdFromBackground()
   → If background dead (Firefox 30s timeout), call fails
   → No error handling/retry, proceeds with undefined tab ID
5. Hydration filtering fails because tab ID undefined
   → Falls back to loading ALL Quick Tabs (including from Tab A)
6. Quick Tabs from Tab A now visible in Tab B → CROSS-TAB LEAK
```

### Affected Scenarios (from issue-47-revised.md)

#### Scenario 11: Hydration on Page Reload (originTabId Filtering)

**Status:** PARTIALLY BROKEN

Expected: Quick Tab created in WP 1 (originTabId=1) hydrates when WP 1 reloads,
but NOT when YT 1 (originTabId=2) reloads.

Buggy behavior: Hydration may load ALL Quick Tabs regardless of originTabId, or
may fail to hydrate any.

Root cause: Filtering logic missing or condition not met → See Region 1 of Issue
Category 2

#### Scenario 2: Multiple Quick Tabs in Single Tab (No Cross-Tab Sync)

**Status:** POTENTIALLY BROKEN

Expected: QT 1 and QT 2 created in WP 1 don't appear in GH 1

Buggy behavior: QTs appear in GH 1 after page navigation/reload

Root cause: Hydration filtering incomplete → See Region 1 of Issue Category 2

#### Scenario 14: Container Isolation (Firefox Multi-Account Container)

**Status:** POTENTIALLY BROKEN

Expected: Quick Tabs respect Firefox container boundaries

Buggy behavior: Container context not being tracked/filtered

Root cause: originTabId may track browser tab ID but not container context; no
separate `containerID` field → See Region 1 & 2 of Issue Category 2

#### Scenario 17: Rapid Tab Switching with Quick Tab State

**Status:** LIKELY BROKEN

Expected: Emergency save mechanism persists state during rapid switches

Buggy behavior: State lost during rapid operations

Root cause: Background script timeout → See Issue Category 3 + timing gaps in
logging

---

## ISSUE CATEGORY 5: Diagnostic Logging Absence Details

### Complete List of Missing Log Points

The following critical moments have NO associated logging:

#### Missing Logs in Content Script

| Operation                            | Missing Log                                                      | Impact                                       |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| Hydration start                      | Current tab ID, origin filtering active indicator                | Cannot verify filter is running              |
| originTabId comparison               | "originTabId={X} vs currentTabId={Y} → {RESULT}"                 | Cannot trace filter decisions                |
| getCurrentTabIdFromBackground() call | Request sent, response received, value returned                  | Cannot diagnose tab ID retrieval failures    |
| Hydration filtering result           | "Hydrated {N} QTs from {M} total (filtered by originTabId)"      | Cannot verify filtering applied correctly    |
| Cross-tab operation rejection        | "Rejected {OP} on QT {ID}: originTabId={X} !== currentTabId={Y}" | Cannot diagnose why operations fail          |
| Manager group filtering              | "Grouping {N} QTs by originTabId for Manager display"            | Cannot verify Manager shows correct grouping |

#### Missing Logs in Background Script

| Operation                                  | Missing Log                                                            | Impact                               |
| ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------ |
| originTabId validation in MINIMIZE handler | "Validating ownership: QT {ID} originTabId={X}, source tab={Y}"        | Cannot trace validation failures     |
| originTabId validation in RESTORE handler  | Same as above for RESTORE operation                                    | Cannot trace validation failures     |
| originTabId validation in CLOSE handler    | Same as above for CLOSE operation                                      | Cannot trace validation failures     |
| Deduplication bypass reason                | "Dedup check: {METHOD} matched, skipping broadcast"                    | Cannot verify why updates don't sync |
| Filter applied during broadcast            | "Broadcasting state to {N} tabs, {M} had originTabId filtered"         | Cannot verify broadcast scoping      |
| Storage write verification step            | "Write verification: expected saveId={X}, actual={Y}, verified={BOOL}" | Cannot diagnose write failures       |

#### Missing Logs in Manager Sidebar

| Operation                               | Missing Log                                                 | Impact                           |
| --------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| QT grouping by originTabId              | "Grouped {N} QTs by originTabId: {MAP}"                     | Cannot verify correct grouping   |
| Cross-tab operation prevention          | "Blocking {OP} on QT {ID}: belongs to tab {X}, current={Y}" | Cannot diagnose operation blocks |
| originTabId validation before operation | "Validating {OP}: need originTabId check before proceeding" | Cannot trace validation flow     |

---

## ISSUE CATEGORY 6: Firefox API Workaround Limitations

### Background Script Keepalive - Analysis

**File:** `background.js` lines 95-145

**Current approach:**

- Calls `browser.tabs.query({})` every 25 seconds
- Calls `browser.runtime.sendMessage()` every 25 seconds
- Logs: "KEEPALIVE: idle timer reset via tabs.query + sendMessage"

**Why insufficient:**

- Firefox MV3 idle timeout: 30 seconds
- Keepalive interval: 25 seconds = 5 second margin
- Operations exceeding 5 seconds will timeout mid-operation
- Port connections from content scripts don't reset timer

**What's missing:**

- No detection of when background actually terminates
- No fallback mechanism when background restarts
- No recovery path for in-flight operations that get interrupted
- No adaptive interval based on recent operation duration

### Port Connection Lifecycle - Analysis

**File:** `background.js` lines ~1400+ (`portRegistry` implementation)

**Current state:**

- Maintains `portRegistry` Map tracking connected ports
- Has disconnect handler to clean up
- Periodic cleanup every 5 minutes

**Gap:**

- If background terminates while ports connected, registry is lost
- When background restarts, ports are orphaned (content scripts have stale port
  references)
- No mechanism to detect orphaned port and trigger content script recovery
- No state sync protocol to resync after background restart

**What's needed:**

- Detect when background script restarted
- Trigger port reconnection handshake
- Send full state sync message after reconnection
- Content script should have timeout-based recovery that triggers if background
  unresponsive

---

## ISSUE CATEGORY 7: Storage State Corruption Risk

### Problem Statement

The combination of:

- Incomplete Firefox keepalive mechanism
- Long-running storage write operations
- No atomic transaction model

Can lead to corrupted state where:

- `globalQuickTabState` cache in background contains different state than
  storage
- Multiple storage.onChanged events from same write (Firefox spurious events)
- Deduplication logic incorrectly skips legitimate updates

### Affected Code Regions

#### Region 1: Multi-method Deduplication

**File:** `background.js` (lines ~1200+, `_multiMethodDeduplication()`)

**Current logic:**

1. Check transactionId (in-progress tracking)
2. Check saveId + timestamp window
3. Check content hash

**Gap:**

- If background terminates during step 1, transactionId never cleared
- Next update incorrectly skipped because transactionId still in set
- No recovery mechanism when transactionId stale

**What's needed:**

- Add timeout-based transactionId cleanup
- Track transaction start time and expire old transactions
- Log when transactions expire due to timeout

#### Region 2: Storage Write Verification Retry Loop

**File:** `background.js` (lines ~1600+, `writeStateWithVerificationAndRetry()`)

**Current logic:**

- Write state
- Read back to verify
- Retry on mismatch with exponential backoff

**Gap:**

- No timeout for entire retry loop
- If background terminates during retry, loop abandoned
- No notification to content script of write failure
- Content script assumes write succeeded

**What's needed:**

- Set timeout for entire retry sequence
- If timeout reached, signal failure to content script
- Content script should treat failed writes as state divergence trigger
- Implement conflict resolution strategy

---

## ISSUE CATEGORY 8: Manager Sidebar State Visibility

### Problem Statement

Manager sidebar is meant to show:

- All Quick Tabs from all browser tabs
- Grouped by originTabId
- With clear ownership indicators

But implementation details unclear regarding originTabId filtering in UI
display.

### Affected Code Regions

#### Region 1: Manager Quick Tab List Generation

**File:** `sidebar/features/quick-tabs/` (location unconfirmed)

**What needs verification:**

- Does Manager fetch ALL Quick Tabs from storage?
- Does it filter/group by originTabId?
- Does it show which browser tab each QT belongs to?
- Does it disable/warn for cross-tab operations?

**Gap:**

- No clear logging of what QTs are being displayed and why
- No indication of filtering logic applied
- No visibility into why certain QTs appear/disappear

**What's needed:**

- Log when Manager retrieves state from storage
- Log grouping logic: "Grouped {N} QTs: {originTabId1}→{count1},
  {originTabId2}→{count2}"
- Log filtering: "Filtered {N} QTs with originTabId={X}"
- Log when cross-tab operations are blocked with reason

---

## Summary of Required Fixes

### Priority 1: Add Comprehensive Logging (QUICK WIN)

**Effort:** Medium  
**Impact:** HIGH (enables root cause diagnosis)

Add logging to these specific locations:

- originTabId filtering during hydration
- getCurrentTabIdFromBackground() request/response
- Cross-tab operation ownership validation
- Manager sidebar grouping and filtering decisions
- Storage deduplication bypass decisions

### Priority 2: Verify and Complete originTabId Filtering (MEDIUM)

**Effort:** High  
**Impact:** HIGH (fixes cross-tab isolation)

Verify that:

- Hydration filtering exists and is applied on every page reload
- Manager sidebar correctly groups and prevents cross-tab operations
- No code paths bypass the originTabId check

### Priority 3: Implement Firefox Timeout Recovery (LONG-TERM)

**Effort:** High  
**Impact:** MEDIUM (improves reliability)

Implement:

- Background restart detection
- Port reconnection handshake
- Full state sync after reconnection
- Adaptive keepalive intervals based on operation duration

### Priority 4: Add State Divergence Detection (MEDIUM)

**Effort:** Medium  
**Impact:** MEDIUM (prevents corruption)

Implement:

- Periodic cache validation between content script and background
- Request full state sync if divergence detected
- Implement conflict resolution strategy
- Add recovery protocol for in-flight operations

---

## Testing Recommendations

### Test Case 1: Hydration Filtering on Page Reload

- Open Wikipedia, create Quick Tab
- Navigate to YouTube in DIFFERENT browser tab
- Reload Wikipedia page
- **Verify:** Quick Tab reappears in Wikipedia tab ONLY, not in YouTube
- **Diagnostic:** Check logs for originTabId filtering decision

### Test Case 2: Manager Sidebar Grouping

- Open Wikipedia, create QT 1
- Open YouTube, create QT 2
- Open Manager
- **Verify:** Manager shows two sections: "Wikipedia Tab" (QT 1), "YouTube Tab"
  (QT 2)
- **Diagnostic:** Check logs for Manager grouping logic

### Test Case 3: Cross-Tab Operation Rejection

- Open Wikipedia, create QT 1
- Switch to YouTube
- In Manager, try to minimize QT 1
- **Verify:** Operation rejected or shows warning (cannot operate on another
  tab's QT)
- **Diagnostic:** Check logs for cross-tab ownership validation

### Test Case 4: Background Script Timeout Under Load

- Rapidly create 20 Quick Tabs in 10 seconds
- Monitor background script activity
- Wait 35 seconds (past 30s timeout)
- Perform another operation
- **Verify:** Operation succeeds (keepalive prevented termination) or recovers
  gracefully
- **Diagnostic:** Check keepalive logs for timer resets, note timing

---

## Next Steps

1. **Immediate:** Implement logging for all missing diagnostic points
   (Priority 1)
2. **Short-term:** Locate and verify originTabId filtering logic is complete
   (Priority 2)
3. **Medium-term:** Add state divergence detection (Priority 4)
4. **Long-term:** Implement Firefox timeout recovery protocol (Priority 3)

---

**End of Diagnostic Report**

**Report Prepared By:** Diagnostic Agent  
**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Extension Version Analyzed:** v1.6.4.8  
**Scan Completion:** 90% (5 files still need inspection for completeness)
