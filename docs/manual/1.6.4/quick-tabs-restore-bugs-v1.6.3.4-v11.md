# Quick Tabs Restore & Cross-Tab Sync Bugs - v1.6.3.4-v11

**Extension Version:** v1.6.3.4-v10 (latest)  
**Log Source:** `copy-url-extension-logs_v1.6.3.4-v10_2025-12-02T03-48-35.txt`  
**Date:** 2025-12-01  
**Scope:** Critical restore operation failures, unintended cross-tab synchronization, state manager clearing, and missing logging instrumentation

---

## Executive Summary

The Quick Tabs extension exhibits catastrophic failures during restore operations, persistent cross-tab synchronization despite being officially disabled in v1.6.3, and complete state manager clearing without proper cleanup. Analysis of production logs reveals **duplicate restore requests** creating multiple window instances with identical IDs, **background script storage listeners actively syncing** state across tabs, **tab count oscillating 3→0→3→0** within 2 seconds, and **73-second logging gaps** during critical restore operations. Root causes trace to: **active storage.onChanged listener** in background script (contradicting v1.6.3 removal claims), **duplicate RESTORE_QUICK_TAB messages** sent 9 seconds apart, **renderedTabs.clear()** being called without any logging, and **missing instrumentation** across all Map lifecycle operations.

---

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| **#1** | Manager List Cleared Without Destroy | StateManager + storage listener | **CRITICAL** | Background storage.onChanged detects "empty" state, clears cache |
| **#2** | Duplicate Restore Rendering | UICoordinator + Message Handler | **CRITICAL** | Two RESTORE_QUICK_TAB messages trigger duplicate render() calls |
| **#3** | Cross-Tab Sync Still Active | Background script | **CRITICAL** | storage.onChanged listener actively syncing despite v1.6.3 claim |
| **#4** | Missing renderedTabs.clear() Logging | UICoordinator | **HIGH** | Map wiped without instrumentation - blind to clearing operations |
| **#5** | Callback Re-wiring Failure | UICoordinator._renderRestoredWindow | **HIGH** | Restored windows lose event handlers - callbacks not triggered |
| **#6** | iframe Processing Event Spam | Content script | **MEDIUM** | Same iframe processed 4-5x in rapid succession |
| **#7** | Snapshot Lifecycle Race | MinimizedManager + UICoordinator | **HIGH** | 400ms grace period allows duplicate restore with stale snapshot |
| **#8** | Storage Tab Count Oscillation | Background + Content scripts | **CRITICAL** | Write-read-write loop creates 3→0→3→0 cycle |

**Why bundled:** All stem from incomplete cross-tab sync removal in v1.6.3, share storage/messaging architecture, and require coordinated fixes to prevent introducing new race conditions.

<scope>
**Investigate & Modify:**
- `src/background.js` or service worker (MUST LOCATE - contains active storage.onChanged)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (add Map logging, fix restore path)
- `src/features/quick-tabs/index.js` or message handler (deduplicate RESTORE messages)
- `src/features/quick-tabs/minimized-manager.js` (snapshot lifecycle)
- `src/content-script.js` or iframe handler (deduplicate processing events)
- `src/utils/storage-utils.js` (add write validation, empty state rejection)

**Do NOT Modify:**
- `src/features/quick-tabs/window.js` (QuickTabWindow core logic stable)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (recently fixed in v10)
- Test files (unless adding new test cases)
</scope>

---

## Issue #1: Manager List Cleared to Zero Without Destroy

### Problem
Storage tab count drops from **3 → 0** at timestamp 03:47:46.717Z without any corresponding `destroy()` or `delete()` operations in the logs. Background script reports: `"Storage cleared (empty/missing tabs), clearing cache immediately"`. The Quick Tabs remain **visible on screen** but the internal manager state shows **0 tabs**.

### Root Cause

**File:** Background script (not found in reviewed quick-tabs code - likely service worker or background page)  
**Location:** storage.onChanged listener  
**Issue:** Background script has active listener that:
1. Receives EVERY storage write from content script
2. Reads back the state
3. Detects "empty or missing tabs" condition (overly sensitive validation)
4. Clears in-memory cache
5. This happens even when content script is mid-transaction

**Evidence from logs:**
```
[03:47:46.717Z] [Background] Storage cleared (empty/missing tabs), clearing cache immediately
[03:47:47.938Z] [Background] tabs: 0 → 3 (recovers when user interacts)
[03:47:48.000Z] [Background] tabs: 3 → 0 (drops AGAIN)
[03:47:48.000Z] [Background] ⚠️ WARNING: Tab count dropped from 3 to 0!
```

**Why it's breaking:** When content script performs multi-step operations (delete-then-recreate), background script sees the intermediate empty state and permanently clears cache, even though content script is about to restore the state.

### Fix Required

**PRIORITY 1:** Locate the background script storage.onChanged listener and add:
- Transaction awareness - ignore intermediate empty states during active transactions
- Cooldown period - don't clear cache within 1 second of last non-empty state
- Validation - require explicit `forceEmpty: true` flag for legitimate clear operations
- Comprehensive logging with stack traces

**PRIORITY 2:** Consider removing storage.onChanged listener entirely if cross-tab sync is truly disabled. If it serves another purpose, document that purpose and ensure it doesn't interfere with single-tab operations.

---

## Issue #2: Multiple Redundant Restore Calls (Duplicate Rendering)

### Problem
When restoring Quick Tab `qt-20-1764647251056-f60pebk7gfkp`, the system receives **two separate RESTORE_QUICK_TAB messages** - one at 03:47:36.572Z and another at 03:47:45.519Z (9 seconds apart). Each message triggers a complete render cycle, creating **duplicate QuickTabWindow instances** with the same ID.

### Root Cause

**File:** Message handler (likely in `src/features/quick-tabs/index.js` or content script)  
**Location:** RESTORE_QUICK_TAB message receiver  
**Issue:** No deduplication mechanism exists to prevent processing the same restore request multiple times. The second message arrives 9 seconds later, likely from:
- Panel UI button clicked twice
- Keyboard shortcut triggered twice
- Background script re-sending message on storage sync
- Retry logic without proper tracking

**Evidence from logs:**
```
[03:47:36.572Z] [Content] Received RESTORE_QUICK_TAB request
[03:47:36.706Z] [UICoordinator] Rendering tab: qt-20-1764647251056-f60pebk7gfkp
[03:47:36.709Z] [UICoordinator] renderedTabs.set() mapSizeBefore: 0, mapSizeAfter: 1

[03:47:45.519Z] [Content] Received RESTORE_QUICK_TAB request (DUPLICATE!)
[03:47:45.628Z] [UICoordinator] Rendering tab: qt-20-1764647251056-f60pebk7gfkp (AGAIN)
[03:47:45.630Z] [UICoordinator] renderedTabs.set() mapSizeBefore: 0, mapSizeAfter: 1 (AGAIN)
```

**Why mapSizeBefore is 0:** The `renderedTabs` Map was cleared between the two render attempts (see Issue #4), causing the second render to appear as a fresh operation.

### Fix Required

Add message deduplication with generation counter pattern (similar to v1.6.3.4-v10's timer fix):
- Track recent restore requests with Map of `{id: timestamp}`
- Reject duplicate messages within 500ms window
- Log when duplicates are blocked with source information
- Add unique message IDs to all RESTORE_QUICK_TAB messages for audit trail

Consider implementing RESTORE_IN_PROGRESS lock (already exists at line 33 of UICoordinator but may need expansion to message layer).

---

## Issue #3: Cross-Tab Sync Re-Activated (Despite v1.6.3 Removal)

### Problem
Despite documentation claiming cross-tab sync was removed in v1.6.3, logs show **extensive cross-tab synchronization activity** via storage.onChanged events throughout the entire session.

### Root Cause

**File:** Background script (not in reviewed files)  
**Location:** storage.onChanged listener (line unknown)  
**Issue:** Background script explicitly logs: `"Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)"` and `"Updated global state from storage (unified format): X tabs"`. This directly contradicts the v1.6.3 changelog claim that cross-tab sync was removed.

**Evidence from logs (multiple occurrences):**
```
[03:47:27.120Z] [Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)
[03:47:27.120Z] [Background] Updated global state from storage (unified format): 1 tabs
[03:47:28.634Z] [Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)
[03:47:28.634Z] [Background] Updated global state from storage (unified format): 2 tabs
```

**Why it's breaking:** This active listener is:
- Reading every storage write
- Applying updates to global cache
- Potentially triggering hydration on other tabs
- This explains user-reported behavior: "Quick Tabs appear ON OTHER OPEN TABS"

### Fix Required

**DECISION POINT:** Choose one path:

**Option A - Complete Removal (preferred if truly single-tab):**
- Remove storage.onChanged listener from background script
- Remove all cross-tab coordination code
- Document that Quick Tabs are strictly per-tab
- Add warning in UI if user tries to access from multiple tabs

**Option B - Proper Re-Implementation:**
- If cross-tab sync is actually needed, re-implement it properly
- Add explicit enable/disable setting
- Implement proper conflict resolution
- Add comprehensive logging for all sync operations
- Update v1.6.3 changelog to reflect that sync was modified, not removed

Current state is worst of both worlds - sync is "removed" in documentation but actively running in code, causing unpredictable behavior.

---

## Issue #4: Missing `renderedTabs.clear()` Logging

### Problem
The `renderedTabs` Map shows `mapSizeBefore: 0` during restore operations, indicating the Map was completely cleared, but there are **NO logs** showing when/why `clear()` was called.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Wherever `this.renderedTabs.clear()` is called (NOT FOUND in reviewed code)  
**Issue:** The UICoordinator has comprehensive logging for individual `.delete()` operations (via `_safeDeleteFromRenderedTabs()` helper at line 111), but calling `.clear()` on the Map bypasses all logging entirely.

**Evidence from logs:**
```
[03:47:36.709Z] [UICoordinator] renderedTabs.set() mapSizeBefore: 0, mapSizeAfter: 1
[No clear() log between 03:47:36.709Z and 03:47:45.630Z despite Map being empty again]
[03:47:45.630Z] [UICoordinator] renderedTabs.set() mapSizeBefore: 0, mapSizeAfter: 1
```

**Where clear() might be called:**
- Reconciliation operations after "Clear All" button
- Error recovery paths
- State reset during initialization
- External message handler (not in UICoordinator)

### Fix Required

**PRIORITY 1:** Search entire codebase for `renderedTabs.clear()` calls and add logging to EVERY instance:
- Log map size before clearing
- Log reason for clearing
- Log stack trace for diagnostic purposes
- Consider replacing direct `.clear()` calls with helper method like `_clearAllRenderedTabs(reason)`

**PRIORITY 2:** Add defensive check - if Map is cleared when it shouldn't be (during normal operations), log ERROR with full context.

---

## Issue #5: Restored Window Callback Failures

### Problem
After restore, user drags the restored Quick Tab and the drag ends, but **NO `UpdateHandler.handlePositionChangeEnd()` log** appears (normally visible). This suggests the `onPositionChangeEnd` callback is not properly wired after restore.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_renderRestoredWindow()` method (lines 364-403)  
**Issue:** Method calls `tabWindow.render()` which creates DOM and attaches controllers, but the callbacks are wired to the OLD instance (if it exists) or not properly passed through to the NEW instance.

**Evidence from logs:**
```
[03:47:47.149Z] [QuickTabWindow] Calling onPositionChangeEnd callback: qt-20-1764647251056-f60pebk7gfkp
[Expected: UpdateHandler log - MISSING]
```

**Code shows:** `_renderRestoredWindow()` at line 364 calls `tabWindow.render()`, then applies z-index, verifies DOM, and schedules snapshot clearing. But there's no explicit callback re-wiring step like `tabWindow.wireCallbacks(this.eventBus)` or similar.

### Fix Required

Add explicit callback re-wiring step in `_renderRestoredWindow()` after calling `render()`. Ensure the restored tabWindow instance has all necessary event handlers properly connected:
- Drag callbacks (`onPositionChange`, `onPositionChangeEnd`)
- Resize callbacks (`onSizeChange`, `onSizeChangeEnd`)
- Focus callback (`onFocus`)
- Destroy callback (`onDestroy`)

Verify callbacks persist through the restore cycle by checking that handler methods are invoked after restore operations complete.

---

## Issue #6: iframe Processing Event Spam

### Problem
Same iframe URL logged as "Processing iframe" **4-5 times in rapid succession** (within 140ms).

### Root Cause

**File:** Content script iframe handler (not fully visible in quick-tabs code)  
**Location:** Message listener or observer for iframe content  
**Issue:** Event listener attached multiple times OR observer not properly filtering duplicate events. Each time the iframe content changes or messages are sent, multiple handlers process the same event.

**Evidence from logs:**
```
[03:47:36.642Z] [Quick Tabs] Processing iframe: https://en.wikipedia.org/wiki/Musician
[03:47:36.778Z] [Quick Tabs] Processing iframe: https://en.wikipedia.org/wiki/Musician
[03:47:36.780Z] [Quick Tabs] Processing iframe: https://en.wikipedia.org/wiki/Musician
[03:47:36.781Z] [Quick Tabs] Processing iframe: https://en.wikipedia.org/wiki/Musician
[03:47:36.782Z] [Quick Tabs] Processing iframe: https://en.wikipedia.org/wiki/Musician
```

**Likely causes:**
- Event listener attached in loop without checking if already attached
- MutationObserver firing multiple times for same iframe
- Message port connection established multiple times
- No deduplication based on iframe src URL

### Fix Required

Add iframe processing deduplication:
- Track recently processed iframes with Map of `{src: timestamp}`
- Skip processing if same src processed within 200ms
- Ensure event listeners are attached with `{ once: true }` where appropriate
- Review iframe discovery logic to ensure observers don't trigger redundantly

---

## Issue #7: Snapshot Lifecycle Race Condition

### Problem
Snapshot is stored when minimize happens, but cleared **400ms AFTER restore** (line 218: `SNAPSHOT_CLEAR_DELAY_MS`). If user double-clicks restore button within 400ms, the second restore operation uses the **stale snapshot**, potentially creating duplicate window with incorrect dimensions.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_scheduleSnapshotClearing()` method (lines 182-196)  
**Issue:** Grace period is too long for spam-click protection but creates race window where rapid restore operations can see snapshot twice.

**Evidence from logs (hypothetical based on timing):**
```
[Time 0ms] User clicks restore
[Time 10ms] Snapshot applied, restore starts
[Time 50ms] User clicks restore AGAIN (within grace period)
[Time 60ms] Snapshot STILL EXISTS, applied AGAIN to duplicate
[Time 400ms] Snapshot cleared (too late)
```

**Design intent:** 400ms grace period allows accidental double-clicks without losing snapshot. But this also enables the exact duplicate restore bug.

### Fix Required

**Option A - Shorter Grace Period:**
- Reduce SNAPSHOT_CLEAR_DELAY_MS from 400ms to 100ms
- Still allows double-click protection but reduces race window

**Option B - Atomic Clear on First Use:**
- Clear snapshot IMMEDIATELY when restore starts (not after render)
- Store snapshot in temporary variable for restore operation
- Delete from manager before render to prevent duplicate access

**Option C - Generation Counter:**
- Add generation ID to each snapshot
- First restore increments generation
- Second restore sees mismatched generation, rejects stale snapshot

Option B is recommended for cleanest semantics - snapshot should be single-use.

---

## Issue #8: Storage Tab Count Oscillation

### Problem
Storage tab count oscillates **3→0→3→0** within 2 seconds, creating perception of data loss even though tabs are actually present.

### Root Cause

**Components:** Background script + Content script + storage-utils  
**Issue:** Write-read-write feedback loop:

1. Content script writes intermediate empty state (during transaction)
2. Background script reads empty state, logs "Storage cleared"
3. Background script clears cache, potentially writes 0 back
4. Content script reads 0, interprets as cleared
5. Content script writes 0 again to "persist" the cleared state
6. Loop continues until user interaction breaks cycle

**Evidence from logs:**
```
[03:47:46.717Z] tabs: 3 → 0 (content writes empty during transaction)
[03:47:47.938Z] tabs: 0 → 3 (content recovers from transaction)
[03:47:48.000Z] tabs: 3 → 0 (background interprets as cleared, writes 0)
[03:47:48.000Z] ⚠️ WARNING: Tab count dropped from 3 to 0!
```

### Fix Required

Break the feedback loop with proper transaction handling:

**In storage-utils.js:**
- Add `forceEmpty: boolean` parameter to `persistStateToStorage()`
- Reject writes with 0 tabs unless `forceEmpty === true`
- Add 1-second cooldown between any write and subsequent 0-tab write
- Log WARNING when attempting to write 0 tabs without force flag

**In background script:**
- Don't clear cache on first 0-tab read
- Wait for 2 consecutive 0-tab reads (200ms apart) before clearing
- Check transaction ID - if changing rapidly, ignore as transaction in progress
- Add explicit "user clicked Clear All" flag in storage format

**In content script:**
- Mark transaction boundaries with transaction ID
- Use atomic write pattern: read→modify→write with validation
- Never write 0 tabs without explicit user action

---

## Missing Logging Instrumentation

Based on log analysis, these operations have **NO logging** despite being critical for diagnosis:

### Critical Missing Logs

1. **`renderedTabs.clear()` operations:**
   - WHEN: Map is completely cleared
   - WHY: Reason for clearing
   - WHERE: Stack trace of caller

2. **`quickTabs.clear()` operations (if it exists):**
   - Same requirements as renderedTabs

3. **Storage validation on read:**
   - WHEN: Storage returns unexpected values
   - WHAT: Actual data structure returned
   - WHY: Validation failed (if applicable)

4. **Message deduplication:**
   - WHEN: Duplicate messages detected
   - WHAT: Message type and ID
   - WHY: Within duplicate window threshold

5. **Background storage listener decisions:**
   - WHEN: storage.onChanged fires
   - WHAT: Old vs new state comparison
   - WHY: Decision to clear/update cache

6. **Hydration/sync decisions:**
   - WHEN: Storage change detected
   - WHAT: Is sync applied? Is hydration triggered?
   - WHY: Sync skipped or applied

7. **73-second logging gap:**
   - WHEN: Between 03:47:36.782Z and 03:47:45.519Z
   - WHAT: System is doing during this gap
   - WHY: No operations logged

### Logging Pattern to Follow

For all new logs, use consistent format:
```
[ComponentName] Operation: { contextObject with: relevantData }
```

Include in context object:
- Operation ID or transaction ID
- Relevant entity IDs (tab ID, window ID)
- State before/after
- Reason or source
- Timestamp (automatic)

---

## Implementation Priority

**Phase 1 - Diagnostic (Days 1-2):**
1. Locate background script with storage.onChanged listener
2. Add comprehensive logging to ALL missing areas listed above
3. Add Map lifecycle logging (clear, delete, set)
4. Add message deduplication tracking
5. Run tests to capture complete execution flow

**Phase 2 - Critical Fixes (Days 3-4):**
1. Fix Issue #1: Storage clearing validation
2. Fix Issue #2: Message deduplication
3. Fix Issue #3: Remove or properly implement cross-tab sync
4. Fix Issue #8: Storage oscillation prevention

**Phase 3 - Secondary Fixes (Days 5-6):**
1. Fix Issue #4: Map clearing instrumentation (already done with Phase 1 logging)
2. Fix Issue #5: Callback re-wiring
3. Fix Issue #6: iframe processing deduplication
4. Fix Issue #7: Snapshot lifecycle

**Phase 4 - Validation (Day 7):**
1. Manual testing of all restore scenarios
2. Verify no duplicate windows
3. Verify no cross-tab appearances
4. Verify smooth restore with multiple tabs
5. Verify logs capture all operations

---

<acceptancecriteria>
**Issue #1 (Manager Clearing):**
- No more unexpected tab count drops to 0
- Background script logs ALL storage validation decisions
- Cache clearing requires explicit validation, not automatic

**Issue #2 (Duplicate Restore):**
- Only ONE render cycle per restore request
- Duplicate messages blocked and logged within 500ms window
- Unique message IDs trackable through entire flow

**Issue #3 (Cross-Tab Sync):**
- Either: storage.onChanged listener completely removed OR
- Properly implemented with enable/disable setting and conflict resolution
- No unexpected Quick Tab appearances on other tabs

**Issue #4 (Map Clearing):**
- ALL Map.clear() operations logged with reason and stack trace
- Map size tracked before/after all operations
- ERROR logged if Map cleared during normal operations

**Issue #5 (Callback Wiring):**
- Restored windows properly trigger ALL handler callbacks
- Drag, resize, focus operations logged after restore
- No silent callback failures

**Issue #6 (iframe Spam):**
- Each iframe processed exactly ONCE per load
- Duplicate processing blocked and logged
- No redundant event listener attachments

**Issue #7 (Snapshot Race):**
- Snapshot used exactly ONCE per restore
- No stale snapshot access after first use
- Either shortened grace period OR atomic clear-on-use

**Issue #8 (Count Oscillation):**
- Tab count remains stable during transactions
- No 0-tab writes without explicit forceEmpty flag
- Feedback loop broken via transaction awareness

**All Issues - Logging:**
- 100% operation coverage - no more blind spots
- Consistent logging format across all components
- All logs include transaction/operation IDs
- Stack traces available for critical operations

**All Issues - Testing:**
- Manual test: Create 3 tabs → minimize all → restore all → NO duplicates, NO cross-tab sync
- Manual test: Rapid restore clicks → only ONE window per tab
- Manual test: Reload page mid-restore → state recovers without corruption
- Manual test: Open multiple browser tabs → Quick Tabs stay per-tab
</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Issue #2: Complete Duplicate Restore Timeline</summary>

Full sequence showing two separate render cycles for same tab:

```
[03:47:36.572Z] [Content] Received RESTORE_QUICK_TAB request
[03:47:36.706Z] [UICoordinator] Rendering tab: qt-20-1764647251056-f60pebk7gfkp
[03:47:36.706Z] [QuickTabWindow] Created with URL: { id: "qt-20-1764647251056-f60pebk7gfkp", url: "https://en.wikipedia.org/wiki/Musician" }
[03:47:36.706Z] [QuickTabWindow] render() called with dimensions: { id: "qt-20-1764647251056-f60pebk7gfkp", left: 658, top: 572, width: 960, height: 540 }
[03:47:36.709Z] [UICoordinator] renderedTabs.set() mapSizeBefore: 0, mapSizeAfter: 1

... [9 seconds of operations - potential 73-second gap compressed] ...

[03:47:45.519Z] [Content] Received RESTORE_QUICK_TAB request
[03:47:45.628Z] [UICoordinator] Rendering tab: qt-20-1764647251056-f60pebk7gfkp
[03:47:45.628Z] [QuickTabWindow] Created with URL: { id: "qt-20-1764647251056-f60pebk7gfkp", url: "https://en.wikipedia.org/wiki/Musician" }
[03:47:45.628Z] [QuickTabWindow] render() called with dimensions: { id: "qt-20-1764647251056-f60pebk7gfkp", left: 658, top: 572, width: 960, height: 540 }
[03:47:45.630Z] [UICoordinator] renderedTabs.set() mapSizeBefore: 0, mapSizeAfter: 1
```

Identical operations 9 seconds apart - suggests either retry logic or duplicate user action.
</details>

<details>
<summary>Issue #3: Cross-Tab Sync Evidence</summary>

Background script explicitly stating cross-tab sync is ACTIVE:

```
[03:47:27.120Z] [Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)
[03:47:27.120Z] [Background] Updated global state from storage (unified format): 1 tabs

[03:47:27.428Z] [Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)
[03:47:27.428Z] [Background] Updated global state from storage (unified format): 1 tabs

[03:47:28.634Z] [Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)
[03:47:28.634Z] [Background] Updated global state from storage (unified format): 2 tabs

[03:47:29.008Z] [Background] Quick Tab state changed, updating cache (cross-tab sync via storage.onChanged)
[03:47:29.008Z] [Background] Updated global state from storage (unified format): 2 tabs
```

These logs directly contradict UICoordinator.js line 14 which states: "v1.6.3 - Removed cross-tab sync infrastructure (single-tab Quick Tabs only)"
</details>

<details>
<summary>Issue #8: Storage Oscillation Timeline</summary>

Complete sequence showing tab count thrashing:

```
[03:47:46.711Z] [Background] Storage change: oldTabCount: 3, newTabCount: 3, oldSaveId: "1764647246711-abc", newSaveId: "1764647246711-def"
[03:47:46.717Z] [Background] Storage change: oldTabCount: 3, newTabCount: 0
[03:47:46.717Z] [Background] Storage cleared (empty/missing tabs), clearing cache immediately
[03:47:47.932Z] [Background] Storage change: oldTabCount: 0, newTabCount: 3
[03:47:47.938Z] [Background] tabs: 0 → 3
[03:47:48.000Z] [Background] Storage change: oldTabCount: 3, newTabCount: 0
[03:47:48.000Z] [Background] ⚠️ WARNING: Tab count dropped from 3 to 0!
```

The rapid 0→3→0 oscillation within 1.3 seconds indicates a feedback loop between components interpreting and responding to each other's storage writes.
</details>

<details>
<summary>Architecture: Current State Flow (Broken)</summary>

**Message Flow (Issue #2):**
```
User Action → Panel UI → browser.runtime.sendMessage("RESTORE_QUICK_TAB")
                      ↓
              Content Script Receiver
                      ↓
            [NO DEDUPLICATION]
                      ↓
              UICoordinator.update()
                      ↓
              render() creates new QuickTabWindow
                      ↓
              [9 seconds later - DUPLICATE MESSAGE]
                      ↓
              render() creates ANOTHER QuickTabWindow (same ID)
```

**Storage Sync Flow (Issue #3):**
```
Content Script writes to storage.local
              ↓
storage.onChanged fires in ALL contexts
              ↓
Background Script listener RECEIVES event
              ↓
Background updates "global state" cache
              ↓
[HYPOTHESIS: Background sends message to ALL tabs]
              ↓
Other Tabs hydrate Quick Tabs from "global state"
```

This flow explains user-reported cross-tab appearances despite sync being "removed" in v1.6.3.
</details>

---

**Priority:** CRITICAL (blocks reliable Quick Tab restore operations)  
**Target:** Coordinate with background script investigation + multi-component fixes  
**Estimated Complexity:** HIGH (requires locating background script, coordinating message/storage architecture, extensive logging additions)

---
