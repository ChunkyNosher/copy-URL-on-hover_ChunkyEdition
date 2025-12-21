# Copy URL on Hover: Additional Issues Report - Part 2

**Extension Version:** v1.6.3.11 | **Date:** December 20, 2025 | **Scope:** Tab lifecycle, message routing, tab adoption, and performance issues not covered in Part 1

---

## Executive Summary

This report covers 12 additional issues discovered during comprehensive scanning of `QuickTabHandler.js`, `TabLifecycleHandler.js`, and `MessageRouter.js`. These issues span four new categories: (1) tab event timing race conditions in Firefox's browser.tabs API, (2) missing persistence hooks after tab adoption operations, (3) incomplete message protocol validation and response handling, and (4) performance degradation at scale (100+ tabs). While these issues are less critical than Part 1's port/initialization problems, they create data loss scenarios in specific edge cases and reduce reliability during rapid tab operations. Collectively, they affect Scenarios 10, 11, 17, 18, 19 from issue-47-revised.md, particularly for users with many tabs open.

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| #9: Tab onRemoved Timing Race | TabLifecycleHandler (browser.tabs.onRemoved) | High | Event fires before tab actually removed from system |
| #10: browser.tabs.query() Degradation | Background initialization | High | Performance slows dramatically with 100+ tabs |
| #11: originTabId Not Persisted After Adoption | Tab adoption handler | Critical | Updated originTabId not saved to storage |
| #12: Missing originTabId in CREATE Response | QuickTabHandler.handleCreate() | High | Content script can't validate ownership of created Quick Tab |
| #13: Tab Memory Leak with 100+ Tabs | TabLifecycleHandler.openTabs Map | Medium | Closed tabs accumulate in memory if onRemoved misses events |
| #14: Protocol Version Not Enforced | MessageRouter._validateProtocolVersion() | Medium | Version mismatch logged but not enforced |
| #15: Missing Content Script Ownership Validation Logging | Content script handlers | Medium | No logging when originTabId validation fails |
| #16: No Timeout on browser.tabs.query() | TabLifecycleHandler.initializeOpenTabs() | High | Can hang for seconds with 100+ tabs during init |
| #17: GET_CURRENT_TAB_ID Missing Cross-Origin Iframe Handling | QuickTabHandler.handleGetCurrentTabId() | Medium | Nested iframes may fail silently without fallback |
| #18: Message Deduplication Window Too Short | QuickTabHandler.DEDUP_WINDOW_MS | Medium | Legitimate rapid CREATE operations rejected as duplicates |
| #19: No Cleanup of Pending Operations on Tab Close | Content script pendingRestoreOperations | Medium | Map grows unbounded across rapid tab switches |
| #20: No Recovery If MessageRouter Fails to Initialize | MessageRouter initialization | High | Pre-initialization messages rejected without queue |

**Why separate report:** Issues #9-20 are distinct from Part 1's port/initialization/storage synchronization problems. They affect tab event handling, message protocol, and performance at scale, requiring separate fixes in different architectural layers.

<scope>
**Modify:**
- `src/background/handlers/TabLifecycleHandler.js` (tab event timing, adoption persistence, memory cleanup)
- `src/background/handlers/QuickTabHandler.js` (CREATE response format, originTabId persistence, deduplication window)
- `src/background/MessageRouter.js` (protocol enforcement, initialization queueing)
- `background.js` (browser.tabs.query() timeout, pre-initialization message handling)
- `src/content.js` (ownership validation logging, pending operation cleanup)

**Do NOT Modify:**
- `manifest.json`
- `sidebar/quick-tabs-manager.js`
- `src/features/quick-tabs/`
- `src/utils/storage-utils.js`
</scope>

---

## Issue #9: Tab onRemoved Event Timing Race with Browser.tabs.onRemoved

### Problem

Firefox fires `browser.tabs.onRemoved` event, but when the handler calls `browser.tabs.query({})` or other tab APIs, the removed tab may still appear in query results. This creates a timing window where TabLifecycleHandler removes the tab from its internal `openTabs` Map, but orphan detection code in background.js might query old tab state and incorrectly think the tab is still open.

### Root Cause

**File:** `src/background/handlers/TabLifecycleHandler.js`  
**Location:** `handleTabRemoved()` (lines 200-230) and `initializeOpenTabs()` (line 115)  
**Issue:** Firefox's `browser.tabs.onRemoved` event fires asynchronously before the tab is fully removed from the browser's internal tab list. Between the time the event fires and the time the handler executes, other browser APIs may still see the tab. After handler removes from `openTabs` Map, background's orphan detection might still query old tab state from cached values.

**Timeline:**
1. User closes tab ID 42
2. Firefox fires onRemoved event for tabId=42
3. Handler `handleTabRemoved()` executes, removes from `openTabs` Map
4. But `browser.tabs.get(42)` elsewhere might still succeed temporarily
5. Code in background.js queries tabs, sees 42 still exists (stale cache), marks Quick Tab as NOT orphaned
6. Quick Tab ownership is incorrectly preserved when it should be orphaned

### Fix Required

Add debouncing to `handleTabRemoved()` callback. Instead of immediately marking Quick Tabs as orphaned, queue the tab ID and process orphan updates after 200-500ms delay. This gives browser time to fully remove the tab from all APIs. Alternatively, wrap tab queries in try-catch and treat "tab not found" as valid close signal even if event timing seems wrong.

---

## Issue #10: browser.tabs.query() Performance Degradation with 100+ Tabs

### Problem

Users with 100+ browser tabs open experience 5-15 second delays when extension calls `browser.tabs.query({})` without filters. This blocks background initialization, which delays content script handshake, which delays Quick Tab restoration. On extremely loaded systems, this timeout can cause complete initialization failure.

### Root Cause

**File:** `background.js` (lines variable - anywhere `browser.tabs.query()` called without filters)  
**Location:** `src/background/handlers/TabLifecycleHandler.js` line 115 in `initializeOpenTabs()`  
**Issue:** Firefox's tab querying performance degrades linearly with tab count. Each unfiltered query() scans entire tab list. With 100+ tabs, this takes seconds. If background initialization calls unfiltered queries multiple times, total init time could exceed content script's 60-second timeout.

**Performance Data (from Reddit #1oblntf):**
- 50 tabs: ~100ms per query
- 100 tabs: ~500ms per query
- 200+ tabs: ~2-5 seconds per query

### Fix Required

Add timeout wrapper around all `browser.tabs.query()` calls. If query takes >2000ms, abort and use fallback behavior. In `initializeOpenTabs()`, use filtered query with specific properties instead of unfiltered query. Use `browser.tabs.query({ active: true })` or `{ lastFocusedWindow: true }` to reduce search space.

---

## Issue #11: originTabId Not Persisted to Storage After Tab Adoption

### Problem

When a Quick Tab is adopted to a new browser tab (e.g., Scenario 18: origin tab closes, adopts to another tab), the `originTabId` property is updated in memory and passed through `triggerPostAdoptionPersistence()` callback, but the updated state is NEVER saved back to storage. After browser restart, the Quick Tab reverts to the old originTabId, making it orphaned again or attached to the wrong tab.

### Root Cause

**File:** `src/background/handlers/TabLifecycleHandler.js`  
**Location:** `triggerPostAdoptionPersistence()` (lines 410-440)  
**Issue:** Method calls the registered callback to trigger persistence, but there's no guarantee the callback actually updates storage. The Quick Tab's originTabId field is not explicitly saved. Response says "post-persistence hook triggered" but doesn't verify storage was updated.

**Flow:**
1. Origin tab closes
2. `background.js` finds new adoption target
3. Updates Quick Tab's originTabId in memory
4. Calls `triggerPostAdoptionPersistence(quickTabId, newOriginTabId)`
5. Method logs "Adoption complete" but no actual storage write
6. Browser restarts
7. Storage loads with old originTabId
8. Quick Tab is orphaned again

### Fix Required

Ensure `triggerPostAdoptionPersistence()` or its callback explicitly calls `QuickTabHandler.saveStateToStorage()` with the updated Quick Tab. Add verification logging that shows the adopted Quick Tab's new originTabId was actually persisted to storage. Consider making adoption persistence synchronous (await the storage write) rather than asynchronous callback.

---

## Issue #12: Missing originTabId in CREATE_QUICK_TAB Response

### Problem

When content script creates a Quick Tab and sends CREATE_QUICK_TAB message, the background validates the `originTabId` against sender.tab.id with detailed logging. However, the response message does NOT include the validated/resolved originTabId. Content script has no way to know if its originTabId was accepted, rejected, or modified, creating ambiguity about Quick Tab ownership.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js`  
**Location:** `handleCreate()` (lines 550-580)  
**Issue:** Response object includes `{ success: true, sequenceId: assignedSequenceId }` but not `originTabId`. Content script sends originTabId in request, background logs validation details, but response doesn't confirm what originTabId was actually stored.

**Response Missing:**
```
Missing: originTabId: validatedOriginTabId
```

### Fix Required

Include validated originTabId in successful CREATE response. This allows content script to verify that its ownership claim was accepted. If originTabId had to be corrected (e.g., taken from sender.tab.id), the response should show the corrected value so content script knows there was a discrepancy.

---

## Issue #13: Tab Memory Leak in TabLifecycleHandler.openTabs Map

### Problem

TabLifecycleHandler maintains an `openTabs` Map to track currently open browser tabs. When tabs close, `handleTabRemoved()` removes them from the Map. However, if any `handleTabRemoved()` calls are missed or delayed (e.g., due to event timing issues in Issue #9), entries accumulate indefinitely. Over hours of operation with rapid tab switching, the Map could grow to thousands of entries, consuming memory.

### Root Cause

**File:** `src/background/handlers/TabLifecycleHandler.js`  
**Location:** `openTabs` Map initialization (line 20) and `handleTabRemoved()` (lines 200-230)  
**Issue:** No automatic cleanup mechanism. If `onRemoved` event is missed even once, that tab ID stays in the Map forever. With users switching 100+ tabs per hour, a single missed event could lead to rapid accumulation.

**Leak Scenario:**
1. User opens/closes 100 tabs in an hour
2. One `onRemoved` event is delayed or missed
3. That tab ID remains in `openTabs` Map
4. Over a week of use: hundreds of orphaned entries accumulate
5. Memory usage grows unbounded

### Fix Required

Implement periodic cleanup of `openTabs` Map. Add a cleanup function that runs every 5 minutes and removes tab IDs that haven't been updated recently. Alternatively, when `browser.tabs.query({})` is called (during initialization or other operations), compare returned tabs with `openTabs` entries and remove any that are missing from the query result. This self-healing mechanism prevents unbounded growth.

---

## Issue #14: Protocol Version Not Enforced in Message Validation

### Problem

MessageRouter logs protocol version mismatches but doesn't reject or enforce version compatibility. Old content scripts (v1.6.2) might send messages with different format. No version mismatch detection in content script itself. Silent compatibility issues could cause data loss without clear error messages.

### Root Cause

**File:** `src/background/MessageRouter.js`  
**Location:** `_validateProtocolVersion()` (lines 250-270)  
**Issue:** Validation returns `{ valid: true }` even on version mismatch. Logging says "PROTOCOL_VERSION_MISMATCH" but then continues as if nothing happened. No enforcement means old and new versions run simultaneously without compatibility verification.

**Code Pattern:**
```
// Version mismatch detected
// But valid is still true!
// No rejection of message
```

### Fix Required

Decide on protocol enforcement policy: either (1) enforce strict version matching and reject old clients, or (2) continue allowing mismatches but add comprehensive logging and fallback handling for each version combination. Don't leave it in a state where mismatches are logged but ignored. Document the policy clearly in comments.

---

## Issue #15: Missing Content Script Ownership Validation Logging

### Problem

Background validates `originTabId` against sender.tab.id with detailed logging (see QuickTabHandler.js lines 200-280). However, content script has no corresponding logging when it sends the originTabId. If validation fails in background, content script receives error response but has no idea what the problem was because it never logged what it sent. Makes debugging ownership issues very difficult.

### Root Cause

**File:** `src/content.js`  
**Location:** Handlers for CREATE_QUICK_TAB and other ownership-required operations (approximately lines 1400-1500)  
**Issue:** Content script sends CREATE_QUICK_TAB with originTabId without logging. When response comes back with error, there's no log showing "I sent originTabId=42 with action CREATE_QUICK_TAB". Only background logs show the validation details, creating one-sided visibility.

### Fix Required

Add logging in content script's message handlers to log what originTabId is being sent before message dispatch. Pattern: `"[Content] Sending CREATE_QUICK_TAB with originTabId={originTabId}"`. Add corresponding logging when response received: check response for validation-related errors and log: `"[Content] CREATE_QUICK_TAB rejected - origin validation failed: {error}"`.

---

## Issue #16: No Timeout on browser.tabs.query() During Initialization

### Problem

TabLifecycleHandler.`initializeOpenTabs()` calls `browser.tabs.query({})` without timeout protection. If user has 100+ tabs, this single query can take 5-15 seconds, blocking entire background initialization. Content scripts timeout waiting for handshake because background is stuck in tab query.

### Root Cause

**File:** `src/background/handlers/TabLifecycleHandler.js`  
**Location:** `initializeOpenTabs()` (line 115)  
**Issue:** `await browser.tabs.query({})` has no timeout wrapper. On slow systems with many tabs, this single operation can stall for seconds, cascading to content script timeouts.

**Flow:**
1. Background starts initialization
2. `initializeOpenTabs()` called
3. `browser.tabs.query({})` takes 10 seconds with 200+ tabs
4. Content script waiting for BACKGROUND_HANDSHAKE times out after 5 seconds
5. Content script gives up and fails initialization

### Fix Required

Wrap `browser.tabs.query()` calls with 2-second timeout. If query takes longer, abort and use fallback (assume no tabs initially, populate later with filtered queries). Add logging when timeout occurs: `"[TAB_LIFECYCLE] Tab query timeout - proceeding with fallback"`. This prevents one slow API call from blocking entire system.

---

## Issue #17: GET_CURRENT_TAB_ID Handler Missing Cross-Origin Iframe Handling

### Problem

`handleGetCurrentTabId()` checks if `sender.tab` exists but doesn't handle edge cases where content script runs inside cross-origin iframe or nested frame. In these cases, sender.tab might not be available even though the frame is in a valid tab. No fallback mechanism to handle these scenarios gracefully.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js`  
**Location:** `handleGetCurrentTabId()` (lines 620-650)  
**Issue:** Only checks `sender.tab.id` and returns error if missing. Doesn't distinguish between "iframe in valid tab but tab info not available" vs "not a frame at all". No fallback like querying for the sending frame's parent tab or using sender.frameId to infer tab.

**Edge Case:**
- Content script in cross-origin iframe
- sender.tab is undefined (security isolation)
- Handler returns error
- Content script can't proceed without tab ID

### Fix Required

Add fallback logic: if sender.tab not available, try to identify tab through other means (sender.frameId context, sender.url parsing, etc.). Or add pre-initialization discovery where content script sends frame information and background resolves it. Document this as limitation and provide workaround for nested frame scenarios.

---

## Issue #18: Message Deduplication Window (100ms) May Reject Legitimate Operations

### Problem

QuickTabHandler deduplicates CREATE_QUICK_TAB messages within a 100ms window to prevent double-creation from UI double-clicks. However, legitimate rapid operations (user creates two Quick Tabs within 100ms from different content scripts) may be rejected as duplicates even though they're valid distinct operations.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js`  
**Location:** `DEDUP_WINDOW_MS = 100` (line 95) and `_isDuplicateMessage()` (lines 110-150)  
**Issue:** Deduplication uses `messageKey = "${message.action}-${message.id}"` which matches on action + id only. Two rapid CREATE calls with different ids might fall within the same 100ms window and be wrongly rejected. Timing window too aggressive for fast users creating multiple Quick Tabs intentionally.

**Scenario:**
1. User creates Quick Tab from Tab A at time T
2. User creates Quick Tab from Tab B at time T+50ms (same action type)
3. If both messages reach background before dedup TTL expires
4. Second message might be rejected as duplicate if timing is unlucky

### Fix Required

Increase deduplication window from 100ms to 200-300ms to be more conservative. Or refine deduplication logic to check not just action+id but also originTabId or messageId to distinguish operations from different sources. Document the deduplication window clearly so it's not a hidden gotcha.

---

## Issue #19: No Cleanup of Pending RESTORE Operations on Tab/Frame Unload

### Problem

Content script tracks `pendingRestoreOperations` Map to ensure RESTORE operations complete in order. When tab closes or frame is destroyed, these pending entries are never cleaned up. Over hours of rapid tab switching (100+ tabs per hour), the Map grows to thousands of stale entries, consuming memory and slowing down lookups.

### Root Cause

**File:** `src/content.js`  
**Location:** `pendingRestoreOperations` Map (approximately line 1850) and `handleTabRemoved()` (not present - missing handler)  
**Issue:** No cleanup mechanism when frame unloads. Pending entries accumulate indefinitely. JavaScript doesn't garbage collect pending Promise objects or Map entries if they're never explicitly removed.

**Leak Timeline:**
1. User switches between tabs 100 times in an hour
2. Each switch generates RESTORE operations
3. If some operations never complete (timeout, rejection), they stay in Map
4. After 1 hour: 100+ pending entries
5. After 1 day: 1000+ entries
6. Memory bloat and slowdown

### Fix Required

Add window beforeunload or unload handler that clears `pendingRestoreOperations` Map. Or implement automatic cleanup: remove pending entries older than 30 seconds. Add logging to track when pending operations are cleaned up: `"[Content] Cleared {count} stale pending RESTORE operations"`.

---

## Issue #20: No Recovery Mechanism If MessageRouter Fails to Initialize

### Problem

Content scripts send messages to MessageRouter during initialization. If MessageRouter hasn't finished initializing yet, these messages are rejected without queuing. No recovery mechanism: rejected messages are lost, not retried. If background is slow to start, early messages are permanently lost, causing initialization failures.

### Root Cause

**File:** `src/background/MessageRouter.js` (lines 40-60) and `background.js` (message handler registration)  
**Issue:** MessageRouter.route() doesn't check `isInitialized()` flag. Messages routed before `markInitialized()` is called might be rejected. No queue mechanism for pre-initialization messages. When initialization completes, there's no retry of previously rejected messages.

**Flow:**
1. Content script sends CREATE_QUICK_TAB at T=0
2. MessageRouter registered but not yet initialized
3. Message routed immediately (no checking)
4. Router not yet ready, rejects with "No handler"
5. Content script receives error, doesn't retry
6. Quick Tab creation permanently fails

### Fix Required

Check `isInitialized()` in message routing. If router not initialized, queue the message instead of rejecting. When `markInitialized()` is called, drain the queued messages through normal routing. This requires: (1) message queue, (2) initialization state check in route(), (3) queue draining on initialization complete.

---

## Shared Implementation Notes

- Tab event timing issues in Firefox are unavoidable (browser limitation), so defensive programming with debouncing and fallbacks is required rather than trying to fix the timing.
- Performance optimizations for large tab counts (100+) should be applied defensively throughout the codebase - any `browser.tabs.query()` should have timeout and filtered parameters.
- Adoption operations must be treated as critical persistence points - any state change during adoption must be immediately persisted to storage with verification logging.
- Message protocol version enforcement should be decided strategically: either enforce strictly (reject old clients) or document compatibility matrix and add version-specific handling for each combination.
- Content script and background logging should be symmetrical - if background logs validation details, content script should log what it sent so bidirectional visibility is maintained.
- Map-based tracking in background should have periodic self-healing cleanup to prevent unbounded growth from missed events.

<acceptance_criteria>
**Issue #9 - Tab onRemoved Timing Race:**
- [ ] handleTabRemoved() debounces tab removal processing by 200-500ms
- [ ] Orphan detection waits for debounce period before marking tabs as orphaned
- [ ] browser.tabs.query() called AFTER debounce to verify tab removal
- [ ] Manual test: close tab rapidly → no "stale tab" in openTabs Map

**Issue #10 - browser.tabs.query() Degradation:**
- [ ] All browser.tabs.query() calls include filters or timeout wrapper
- [ ] initializeOpenTabs() uses filtered query (not unfiltered) where possible
- [ ] 2-second timeout on long-running queries
- [ ] Logging shows when query timeout occurs
- [ ] Manual test: 100+ tabs open → background initialization <10 seconds

**Issue #11 - originTabId Not Persisted After Adoption:**
- [ ] triggerPostAdoptionPersistence() ensures storage.local.set() is called
- [ ] Adopted Quick Tab's originTabId verified in storage after adoption
- [ ] Logging shows "ADOPTION_PERSISTED: quickTabId={id}, originTabId={newId}"
- [ ] Manual test: adopt Quick Tab → close browser → reopen → originTabId correct

**Issue #12 - Missing originTabId in CREATE Response:**
- [ ] CREATE response includes originTabId: validatedOriginTabId
- [ ] Content script logs response originTabId to verify acceptance
- [ ] Mismatch between sent and received originTabId logged as warning
- [ ] Manual test: CREATE Quick Tab → content log shows confirmed originTabId

**Issue #13 - Tab Memory Leak:**
- [ ] Periodic cleanup function runs every 5 minutes
- [ ] Cleanup removes entries not matching current browser.tabs.query() result
- [ ] Logging shows cleanup count: "Cleaned up {count} stale tab entries"
- [ ] Manual test: 1000+ tab switches → openTabs Map stays <500 entries

**Issue #14 - Protocol Version Not Enforced:**
- [ ] Protocol version enforcement policy documented in code comments
- [ ] Decide: reject mismatches OR add version-specific handlers
- [ ] Implement chosen policy consistently throughout MessageRouter
- [ ] Logging clearly distinguishes "accepted with warning" vs "rejected" versions

**Issue #15 - Missing Content Script Ownership Logging:**
- [ ] Content script logs originTabId before sending ownership-required messages
- [ ] Response handler logs validation-related errors from background
- [ ] Log pattern: "[Content] Sending CREATE_QUICK_TAB with originTabId={id}"
- [ ] Log pattern: "[Content] CREATE rejected - {validation_error}"

**Issue #16 - No Timeout on browser.tabs.query():**
- [ ] 2-second timeout wrapper on all browser.tabs.query() calls
- [ ] Timeout logs: "Tab query timeout - using fallback behavior"
- [ ] Fallback behavior defined (empty list, filtered query, etc.)
- [ ] Manual test: 200+ tabs + slow system → init completes in <5 seconds

**Issue #17 - Cross-Origin Iframe Handling:**
- [ ] GET_CURRENT_TAB_ID handles cross-origin iframe case
- [ ] Fallback mechanism implemented (frameId context, url parsing, etc.)
- [ ] Documentation explains limitation for nested frames
- [ ] Manual test: create Quick Tab in nested iframe → tab ID resolved

**Issue #18 - Deduplication Window:**
- [ ] Deduplication window increased to 200-300ms
- [ ] Deduplication logic refined to distinguish operations from different sources
- [ ] Comment explains why 100ms window was insufficient
- [ ] Manual test: rapidly create 2 Quick Tabs → both succeed

**Issue #19 - Pending Operations Memory Leak:**
- [ ] beforeunload/unload handler clears pendingRestoreOperations
- [ ] OR automatic cleanup removes entries older than 30 seconds
- [ ] Logging shows cleanup: "[Content] Cleared {count} stale RESTORE operations"
- [ ] Manual test: 1000+ tab switches → pending Map <100 entries

**Issue #20 - No MessageRouter Initialization Recovery:**
- [ ] Pre-initialization messages queued instead of rejected
- [ ] Queue drained when markInitialized() called
- [ ] Logging shows queue draining: "Draining {count} queued pre-init messages"
- [ ] Manual test: fast content script (T=0) sends message → succeeds after init

**All Issues:**
- [ ] All existing tests pass
- [ ] No new console errors or warnings in normal operation
- [ ] Manual test: 100+ tabs open → no performance degradation
- [ ] Manual test: rapid tab switching + Quick Tab operations → all operations succeed
</acceptance_criteria>

---

## Supporting Context

<details>
<summary>Issue #9: Firefox Tab Event Timing Details</summary>

Firefox's `browser.tabs.onRemoved` event fires when tab closure is initiated, but the tab may still exist in internal browser structures for a brief period. This is a Firefox implementation detail from [Mozilla Discourse #68907](https://discourse.mozilla.org/t/browser-tabs-onremoved-event-listener-still-queries-the-removed-tab/68907).

When handler executes immediately, other async operations queued before the handler might still see the tab in query results. The solution is not to fix Firefox but to add defensive debouncing: don't immediately mark Quick Tabs as orphaned, instead queue the update and execute after 200-500ms when the browser has definitely removed the tab.

Current implementation removes from `openTabs` immediately in `handleTabRemoved()`, which is correct for internal state. But orphan marking should be deferred.

</details>

<details>
<summary>Issue #10: Performance Degradation with Many Tabs</summary>

Per Reddit discussions (#1oblntf, #1geysiw) and support threads, Firefox's tab querying performance degrades significantly:
- 50 tabs: ~100ms
- 100 tabs: ~500ms  
- 200+ tabs: 2-5 seconds

This is because Firefox scans the entire tab list for unfiltered queries. The extension should use filtered queries with specific properties (active, lastFocusedWindow, windowId, etc.) to reduce search space.

In `initializeOpenTabs()`, instead of `browser.tabs.query({})`, use `browser.tabs.query({ lastFocusedWindow: true })` to get only tabs in the current window. This dramatically reduces query time.

</details>

<details>
<summary>Issue #11: Adoption Persistence Flow</summary>

Current adoption flow in background.js:
1. Origin tab closes (detected by TabLifecycleHandler)
2. Background finds new adoption target
3. Updates Quick Tab's originTabId in memory
4. Calls TabLifecycleHandler.triggerPostAdoptionPersistence()
5. Method invokes callback to persist state
6. BUT: callback doesn't explicitly call saveStateToStorage()

The issue is that originTabId is updated in memory but the update is never flushed to storage. After browser restart, storage loads with old originTabId.

Fix requires: Make triggerPostAdoptionPersistence() call QuickTabHandler.saveStateToStorage() or ensure the callback provided does so. Add verification: log the Quick Tab before and after adoption to show originTabId changed.

</details>

<details>
<summary>Issue #13: Memory Leak Accumulation Scenario</summary>

Over a week of typical use with rapid tab switching:
- Day 1: ~100 tab switches, 0 missed events → 0 leaks
- Day 2: ~100 tab switches, 1 missed event → 1 orphaned entry
- Day 3: ~100 tab switches, 1 missed event → 2 orphaned entries
- ...
- Day 7: ~100 tab switches, multiple missed events → 7+ orphaned entries
- But this assumes 1 miss per day

If even 1 out of 100 onRemoved events is missed (1% rate), then:
- Week 1: ~700 tab switches, 7 missed events → 7 orphaned entries
- Week 2: ~1400 total, 14 missed → 14 entries
- Week 4: ~2800 total, 28 missed → 28 entries

The Map could grow to hundreds or thousands over months. Periodic cleanup every 5 minutes with reconciliation against browser.tabs.query() prevents this.

</details>

<details>
<summary>Issue #16: Tab Query Timeout Impact on Init</summary>

Background initialization sequence:
1. Start init (T=0)
2. Call TabLifecycleHandler.start()
3. start() calls initializeOpenTabs()
4. initializeOpenTabs() awaits browser.tabs.query({})
5. With 200+ tabs, query takes 5-15 seconds
6. Content script waiting for BACKGROUND_HANDSHAKE at T=5000ms times out
7. Content script gives up
8. Background is still doing browser.tabs.query()

Wrapping with 2-second timeout allows initialization to continue: if query takes >2s, abort and use fallback (empty tabs, populate later with filtered queries). This unblocks the initialization handshake.

</details>

<details>
<summary>Issue #20: MessageRouter Pre-Initialization Queue</summary>

Currently, when content script sends CREATE_QUICK_TAB at T=0:
1. browser.runtime.onMessage.addListener(router.createListener())
2. Message routed immediately
3. router.route() calls handler(message, sender)
4. If handler not yet registered (router not initialized), returns error
5. Content script receives error, doesn't retry
6. Message is permanently lost

Solution:
1. Add messageQueue array to MessageRouter
2. In route(), check isInitialized()
3. If not initialized, push message to queue
4. In markInitialized(), drain queue through normal routing
5. Content script retries automatically via port after small delay
6. Retry succeeds because router is now initialized

This requires coordination with port connection logic to ensure retries happen.

</details>

---

**Priority:** Critical (Issue #11), High (Issues #9, #10, #12, #16, #20), Medium (Issues #13-15, #17-19) | **Target:** Fix in second coordinated PR | **Estimated Complexity:** High | **Files Affected:** TabLifecycleHandler.js, QuickTabHandler.js, MessageRouter.js, background.js, content.js

