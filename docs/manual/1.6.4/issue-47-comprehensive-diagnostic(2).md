# Quick Tabs Persistence & Storage Synchronization: Comprehensive Diagnostic Report

**Extension Version:** v1.6.3.10 | **Date:** 2025-12-18 | **Scope:** Storage
persistence failures, state synchronization races, and missing initialization
across multiple components

---

## Executive Summary

Quick Tab state fails to persist across page reloads, browser restarts, and tab
navigation. The root cause is a dual-blocking storage persistence mechanism
combined with missing variable initialization and storage format mismatches.
While each issue has a distinct root cause, all converge on storage architecture
failures introduced during v1.6.3's cross-tab sync refactor. These issues affect
every Quick Tab operation: creation, minimization, resizing, positioning,
deletion, and restoration.

## Issues Overview

| Issue # | Component                                | Severity     | Category        | Root Cause                                                                                                          |
| ------- | ---------------------------------------- | ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| #1      | StorageUtils                             | **Critical** | Persistence     | Dual-block check prevents ALL writes: `originTabId != null && currentTabId != null` (second condition always false) |
| #2      | StorageUtils                             | **Critical** | Initialization  | `currentTabId` variable never initialized anywhere in codebase                                                      |
| #3      | StorageUtils                             | **Critical** | Persistence     | `originTabId` starts null; adoption fixes it too late, after write already blocked                                  |
| #4      | SyncStorageAdapter/SessionStorageAdapter | **Critical** | Format Mismatch | Session storage uses old container format; Sync storage uses unified format; content scripts can't read             |
| #5      | TabLifecycleHandler                      | **High**     | Logic           | Adoption only sets `originTabId`, never triggers retry of blocked storage writes                                    |
| #6      | background.js                            | **High**     | Persistence     | No retry mechanism after adoption completes; blocked writes never attempted again                                   |
| #7      | UpdateHandler/VisibilityHandler          | **High**     | Logging         | No logs indicating storage write initiated or blocked during minimize/resize operations                             |
| #8      | storage.onChanged                        | **High**     | Race Condition  | Firefox fires spurious storage.onChanged events without data change; deduplication misses edge cases                |
| #9      | DeleteAckTimeout                         | **High**     | Timing          | Deletion confirmation timeout (1000ms) too aggressive for slow networks or overloaded systems                       |
| #10     | background.js:handleClose                | **High**     | API             | Close All operation never sets `forceEmpty` flag; empty check always fails                                          |
| #11     | CreateHandler                            | **High**     | Initialization  | Content script never passes `originTabId` to background; Quick Tab created with null originTabId                    |
| #12     | browser.runtime.sendMessage              | **Medium**   | Timeout         | Message timeout during background script idle termination (30s); content script gets no response                    |
| #13     | Port Connection                          | **Medium**   | Lifecycle       | Port doesn't reset Firefox idle timer; background terminates mid-operation despite activity                         |
| #14     | StorageUtils                             | **Medium**   | Logging         | No diagnostic logs when `currentTabId` prevents storage write; silent failure                                       |
| #15     | SessionStorageAdapter                    | **Medium**   | Format          | Uses outdated container-based storage format; data lost on read by unified-format code                              |

**Why bundled:** All 15 issues affect storage persistence; share storage
architecture context; can be addressed through coordinated fixes to
initialization, format standardization, and logging.

<scope>
**Modify:**
- `src/storage/StorageUtils.js` (persistStateToStorage, validateTabOwnership)
- `src/storage/adapters/SyncStorageAdapter.js` (storage format)
- `src/storage/adapters/SessionStorageAdapter.js` (format compatibility)
- `src/background/handlers/TabLifecycleHandler.js` (adoption flow)
- `src/features/quick-tabs/handlers/UpdateHandler.js` (logging)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (logging)
- `src/background.js` (handleClose, retry logic, initialization)
- `src/content.js` (originTabId initialization, CreateHandler)

**Do NOT Modify:**

- `src/core/` (config, events, state - read-only context)
- `sidebar/` (Manager UI - read current storage format only)
- `.github/` (configuration files)
- Test infrastructure or bridge handlers

</scope>

---

## Issue #1: Dual-Block Storage Check Prevents ALL Persistence Writes

### Problem

Every Quick Tab operation (create, minimize, resize, move, close) silently fails
to persist. No error is thrown, no warning is logged—the write is simply
blocked.

### Root Cause

**File:** `src/storage/StorageUtils.js`  
**Location:** `persistStateToStorage()` method  
**Issue:** Method checks `if (originTabId != null && currentTabId != null)`
before executing storage write. The `currentTabId` variable is never set
anywhere in the codebase, so the second condition is always false. This
dual-block prevents 100% of storage writes from executing.

### Fix Required

Initialize `currentTabId` variable in all contexts where storage writes occur.
The second condition should validate the tab ID has been acquired from the
background script, not check a variable that was never initialized. Refactor the
ownership validation to use a single authoritative tab ID source rather than two
independent checks.

---

## Issue #2: `currentTabId` Variable Never Initialized

### Problem

The storage persistence mechanism depends on a `currentTabId` variable that is
never set anywhere in the codebase, making all persistence operations fail
silently.

### Root Cause

**File:** `src/storage/StorageUtils.js`  
**Location:** Global scope / initialization functions  
**Issue:** No code path assigns a value to `currentTabId`. While `originTabId`
gets set during adoption (retroactively), `currentTabId` has no initialization
point. This creates a permanent blocker for the dual-block check.

### Fix Required

Establish a single point where `currentTabId` is initialized when a storage
write is about to occur. This should happen in the content script during
initialization (after getting tab ID from background) or in the background
script for background-initiated operations. Add diagnostic logging at the
initialization point to confirm the value is set before first storage write
attempt.

---

## Issue #3: `originTabId` Initialization Race Condition

### Problem

Quick Tabs are created with `originTabId = null`. The background script's
adoption mechanism fixes this retroactively when the tab becomes active, but
this happens too late: the initial storage write (during creation) has already
been blocked.

### Root Cause

**File:** `src/content.js` (CreateHandler)  
**Location:** `buildQuickTabData()` (lines ~456-472)  
**Issue:** Content script creates Quick Tab data object without including
`originTabId` field. Message is sent to background where it's received with
`originTabId` missing, so it defaults to null. Later, adoption process sets
`originTabId`, but the initial write block persists because no retry mechanism
exists.

### Fix Required

Content script should pass the current tab ID as `originTabId` when creating
Quick Tab. Since content scripts cannot use `browser.tabs.getCurrent()`, this
requires the established pattern already in place: content.js gets tab ID from
background via `getCurrentTabIdFromBackground()`, then includes it in the Quick
Tab creation payload. Add validation logging to confirm `originTabId` is present
in Quick Tab data.

---

## Issue #4: Storage Format Mismatch Between Adapters

### Problem

SessionStorageAdapter and SyncStorageAdapter use different storage formats. When
content scripts read from SessionStorage (fast cache) and background reads from
SyncStorage (persistent), they interpret the same data differently, causing data
loss and state inconsistencies.

### Root Cause

**File:** `src/storage/adapters/SyncStorageAdapter.js` vs.
`src/storage/adapters/SessionStorageAdapter.js`  
**Location:** Data serialization methods in both adapters  
**Issue:** SyncStorageAdapter uses unified format:
`{ tabs: [...], saveId, timestamp }`. SessionStorageAdapter uses old
container-based format:
`{ containers: { 'firefox-default': { tabs: [...], lastUpdate } } }`. This
format divergence means data written by one adapter cannot be read by the other.
Content scripts reading from SessionStorage get data in container format, but
unified-format code expects different structure.

### Fix Required

Standardize both adapters to use the same unified format. SessionStorageAdapter
should match SyncStorageAdapter's format exactly. Add migration logic to handle
any existing data in old container format. Verify both adapters produce and
consume identical data structure.

---

## Issue #5: Adoption Doesn't Trigger Storage Write Retry

### Problem

When adoption completes and fixes `originTabId`, the storage persistence
mechanism should retry the blocked write. Instead, the blocked write is never
re-attempted, leaving the Quick Tab unpersisted.

### Root Cause

**File:** `src/background/handlers/TabLifecycleHandler.js`  
**Location:** `onTabActivated()` method  
**Issue:** Method updates `originTabId` during adoption but has no code path to
re-attempt storage writes that were previously blocked. The persistence failure
is permanent; there's no trigger to retry after adoption fixes the missing
field.

### Fix Required

After adoption completes and `originTabId` is set, trigger a full state
persistence write for all Quick Tabs on that tab. This should call the standard
persistence function (same one that runs on state changes) so all
previously-blocked data is now written successfully. Add logging to track: (1)
adoption completion, (2) persistence retry initiated, (3) write success/failure.

---

## Issue #6: No Retry Mechanism in Background Storage Write Flow

### Problem

When a storage write is blocked (due to missing `currentTabId`), there is no
automatic retry mechanism. Once blocked, the write fails silently and
permanently.

### Root Cause

**File:** `src/background.js`  
**Location:** Storage write coordination logic / error handling  
**Issue:** No queue or retry system for failed storage writes. The write either
succeeds or is silently logged as blocked. There's no mechanism to re-attempt
the write once conditions improve (e.g., after tab ID is acquired or adoption
completes).

### Fix Required

Implement a simple queue for failed storage writes. When a write is blocked due
to missing tab ID, queue it with metadata (timestamp, retry count). After
adoption or other state changes, automatically retry queued writes. Log each
retry attempt and final success/failure. Set maximum retry count (3-5 attempts)
to prevent infinite loops.

---

## Issue #7: Missing Diagnostic Logging for Storage Writes

### Problem

When storage writes fail silently, there are no logs indicating: (1) write was
initiated, (2) write was blocked, (3) reason for block. This makes diagnostics
impossible without adding extensive debugging.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`,
`VisibilityHandler.js`, etc.  
**Location:** Methods that trigger state changes: `handleSizeChangeEnd()`,
`handleMinimize()`, etc.  
**Issue:** These handlers update local state and emit events, but don't log
whether subsequent storage write succeeded or failed. The absence of "storage
write initiated" logs makes it impossible to detect persistence failures in
production.

### Fix Required

Add diagnostic logs at key points: (1) immediately after state change, log
"storage write about to be initiated", (2) in
StorageUtils.persistStateToStorage(), log whether checks pass/fail with reasons,
(3) after storage.local.set() completes, log success with metadata. These logs
should use the extension's standard logging format and include context (Quick
Tab ID, tab ID, operation type).

---

## Issue #8: Storage.onChanged Spurious Events and Deduplication Race

### Problem

Firefox fires `storage.onChanged` events even without actual data changes.
Existing deduplication logic based on timestamps and version tracking misses
edge cases where rapid operations cause false duplicates to be rejected.

### Root Cause

**File:** `src/storage/adapters/SyncStorageAdapter.js` / storage.onChanged
listener in background.js  
**Location:** Deduplication logic using `saveId` and timestamp  
**Issue:** Firefox's browser.storage API fires events unpredictably.
Deduplication tracking by timestamp alone is insufficient when multiple writes
happen within the same millisecond or when Firefox fires spurious events.
Current implementation rejects valid updates as "duplicates" in high-frequency
scenarios.

### Fix Required

Enhance deduplication to use a combination of: (1) saveId/correlationId (unique
per write), (2) version/content hash (data actually changed), (3) timestamp
(ordering). Reject as duplicate only if ALL three match. For spurious events,
add a secondary check: read storage back after rejecting as duplicate to confirm
rejection was correct. Log all deduplication decisions with full context.

---

## Issue #9: Deletion Acknowledgment Timeout Too Aggressive

### Problem

When closing Quick Tabs, the system waits for confirmation from other tabs
(1000ms timeout). On slower networks or under system load, this timeout expires
prematurely, leaving Quick Tabs in inconsistent state (marked deleted locally
but still open in other tabs).

### Root Cause

**File:** `src/background.js` or `src/storage/DeleteAckTimeout`  
**Location:** Deletion flow and acknowledgment waiting logic  
**Issue:** Fixed 1000ms timeout doesn't account for network latency, storage
operation latency, or system performance variation. On slow systems, the 1000ms
window is insufficient for all tabs to complete deletion and acknowledge.

### Fix Required

Increase base timeout to 3000-5000ms or make it adaptive based on observed
latency (similar to adaptive dedup window in Issue #13 context). Allow
configuration override for testing. Add logging for each deletion
acknowledgment: (1) deletion initiated, (2) waiting for acks from N tabs, (3)
acks received (list), (4) timeout or completion. If timeout expires, log which
tabs failed to acknowledge for debugging.

---

## Issue #10: Close All Operation Never Sets `forceEmpty` Flag

### Problem

When user clicks "Clear All Quick Tabs", the backend should persist an empty
Quick Tabs list. Instead, the empty state is not written to storage, so closing
all Quick Tabs is not persistent—Quick Tabs reappear on reload.

### Root Cause

**File:** `src/background.js`  
**Location:** `handleClose()` method (all-close variant)  
**Issue:** Close All operation should set a flag like `forceEmpty = true` to
signal that storage should record an explicit empty state (not just "no Quick
Tabs in memory"). Without this flag, the empty state is never persisted because
the system assumes an empty in-memory state means "not initialized yet" rather
than "explicitly cleared".

### Fix Required

Add a `forceEmpty` flag parameter to the close operation. When closing all Quick
Tabs, set this flag to true in the storage payload. The persistence layer should
treat explicit empty state (with flag set) differently from missing state—write
it to storage as `{ tabs: [], forceEmpty: true, timestamp }` so it persists. On
load, if forceEmpty is true, initialize with empty Quick Tabs (don't try to
migrate or restore anything).

---

## Issue #11: Content Script Never Passes `originTabId` to Background

### Problem

When a Quick Tab is created in a content script, the Quick Tab data object sent
to the background never includes the content script's tab ID. This results in
Quick Tabs being created with `originTabId = null`.

### Root Cause

**File:** `src/content.js`  
**Location:** `buildQuickTabData()` method and `handleCreateQuickTab()` /
CREATE_QUICK_TAB message payload  
**Issue:** The function that builds Quick Tab data object doesn't include a
field for `originTabId`. The message sent to background contains:
`{ id, url, left, top, width, height, title, cookieStoreId, minimized, pinnedToUrl }`
but no `originTabId`. Background receives this and treats originTabId as
missing/undefined.

### Fix Required

Content script should acquire current tab ID (using established pattern with
`getCurrentTabIdFromBackground()`) before calling `buildQuickTabData()`. The
acquired tab ID should be included in the data object as `originTabId`. Verify
the tab ID is present in the message payload before sending to background. Add
validation logging in both content script (confirming tab ID acquired) and
background (confirming tab ID received).

---

## Issue #12: Message Timeout During Background Script Idle Termination

### Problem

When background script becomes idle (no activity for 30 seconds), Firefox
terminates it. If content script sends a message during this window, the message
times out with "no connection" error because the background script was
terminated by the runtime.

### Root Cause

**File:** Architecture-level limitation in `browser.runtime.sendMessage()` API  
**Location:** Content scripts using one-off sendMessage() calls instead of
persistent ports  
**Issue:** Firefox terminates background scripts after 30 seconds idle. If
content script sends a one-off message during this window, the background script
isn't running to receive it. This causes "no connection" errors. The extension
works around this with persistent ports, but some operations still use
sendMessage() which doesn't reset the idle timer.

### Fix Required

Ensure all content-to-background communication uses persistent ports (already
partially implemented in v1.6.3.10). Any remaining one-off sendMessage() calls
should be migrated to port-based messaging. Port keeps connection alive and
resets idle timer. For operations that must use sendMessage() (e.g., emergency
fallbacks), implement exponential backoff with message queueing so failures
retry when background becomes available again.

---

## Issue #13: Port Connection Doesn't Reset Firefox Idle Timer

### Problem

The extension uses persistent ports to avoid termination, but Firefox's
30-second idle timeout still applies. If no actual data flows through the port
for 30 seconds, Firefox terminates the background script even though the port is
open.

### Root Cause

**File:** Architecture-level limitation in Firefox browser.runtime.connect()  
**Location:** Port management in background.js and content.js  
**Issue:** Firefox's idle termination counts "no activity" as "no messages being
actively sent/received", not "no connections open". A persistent port can sit
idle for 30 seconds, at which point Firefox terminates the background script.
The port object remains in the content script but stops receiving messages.

### Fix Required

Implement heartbeat messaging through the port: periodically send lightweight
heartbeat messages (every 20-25 seconds) to keep the connection "active" and
reset idle timer. These heartbeats should include metadata about extension state
(tab count, memory usage) for diagnostic value. Content script sends heartbeat
to background; background responds. Both log heartbeat activity for diagnostics.
When background restarts, port disconnect handler triggers reconnection.

---

## Issue #14: Silent Failure When `currentTabId` Prevents Storage Write

### Problem

When storage write is blocked because `currentTabId` is null, the system logs
this as "blocked - unknown tab ID initialization race" but doesn't alert
developers. This makes the root cause easy to miss in logs.

### Root Cause

**File:** `src/storage/StorageUtils.js`  
**Location:** `persistStateToStorage()` method, error handling section  
**Issue:** Current logging uses generic message "blocked - unknown tab ID
initialization race?" which could refer to several different issues. There's no
specific diagnostic indicator that `currentTabId` is the problem, making root
cause analysis difficult.

### Fix Required

Add specific diagnostic logs that clearly indicate which part of the dual-block
check failed: Log separately for
`(originTabId != null ? "✓" : "✗ originTabId is null")` and
`(currentTabId != null ? "✓" : "✗ currentTabId is null")`. Include stack trace
showing which code path attempted the storage write. Use clear error message:
"Storage write blocked: currentTabId not initialized (originTabId = X)".

---

## Issue #15: SessionStorageAdapter Uses Outdated Container Format

### Problem

SessionStorageAdapter writes Quick Tabs in old container-based format. When this
data is read by newer code expecting unified format, parsing fails or data is
lost.

### Root Cause

**File:** `src/storage/adapters/SessionStorageAdapter.js`  
**Location:** Data serialization / key naming in storage  
**Issue:** SessionStorageAdapter saves data under container-specific keys using
structure:
`quick_tabs_state_v1_container_firefox-default = { tabs: [...], lastUpdate }`.
New unified format code expects:
`quick_tabs_state_v2 = { tabs: [...], saveId, timestamp }`. The key names and
structure are incompatible.

### Fix Required

Migrate SessionStorageAdapter to use same key and format as SyncStorageAdapter.
Remove container-based key naming (unless container isolation is critical
requirement—confirm with architecture). Serialize data in unified format. Add
migration code to detect old format and transform it on first read. Verify
content scripts and background scripts both read from updated format.

---

## Shared Implementation Notes

- All storage writes must include unique `saveId` to prevent hash collision with
  concurrent operations
- Initialization must be synchronous or complete before first storage write
  attempt occurs
- Use consistent logging format across all modules:
  `[Module] OPERATION: status → details`
- Tab ID validation should use single authoritative source, not multiple
  independent checks
- Adopt the heartbeat pattern already implemented in v1.6.3.10 for idle timer
  reset
- Ensure backwards compatibility with Quick Tabs saved in v1.6.2 and earlier
  formats
- All storage adapter format changes must update both SyncStorageAdapter and
  SessionStorageAdapter consistently

<acceptance_criteria>

**Issue #1 (Dual-Block):**

- [ ] `originTabId` check passes for adopted tabs
- [ ] `currentTabId` check passes after initialization
- [ ] At least one storage write succeeds per session
- [ ] Manual test: Create Quick Tab → reload page → Quick Tab persists

**Issue #2 (currentTabId Initialization):**

- [ ] `currentTabId` has value (number) before first storage write
- [ ] Logs show "currentTabId initialized: ✓" or similar positive indicator
- [ ] No "currentTabId is null" failures after initialization completes

**Issue #3 (originTabId Race):**

- [ ] Quick Tabs created with `originTabId` in payload (not null)
- [ ] No adoption needed to fix orphaned Quick Tabs
- [ ] Initial storage write succeeds even for new Quick Tabs

**Issue #4 (Format Mismatch):**

- [ ] SyncStorageAdapter and SessionStorageAdapter use identical format
- [ ] Content script reads from SessionStorage successfully
- [ ] Background reads from SyncStorageAdapter successfully
- [ ] No data loss when reading same Quick Tab ID from different adapters

**Issue #5 (Adoption Retry):**

- [ ] After adoption, storage write is automatically retried
- [ ] Logs show "Adoption completed → persistence retry initiated →
      success/failure"
- [ ] Manual test: Create tab with orphaned Quick Tab, activate tab → Quick Tab
      persists

**Issue #6 (Retry Mechanism):**

- [ ] Failed storage writes are queued with retry metadata
- [ ] Queued writes retry automatically (up to 3-5 times)
- [ ] Logs show each retry attempt and final outcome

**Issue #7 (Diagnostic Logging):**

- [ ] "Storage write initiated" logs appear for each state change
- [ ] "Check: originTabId=X, currentTabId=Y" logs show both values
- [ ] "Storage write failed/succeeded" logs indicate final outcome
- [ ] No silent failures—every storage operation is logged

**Issue #8 (Deduplication):**

- [ ] Multiple rapid operations don't cause false duplicate rejections
- [ ] Spurious Firefox events are rejected without affecting valid operations
- [ ] Logs show deduplication decision for every storage.onChanged event

**Issue #9 (Deletion Timeout):**

- [ ] Timeout is at least 3000ms (increased from 1000ms)
- [ ] Adaptive timeout is calculated based on observed latency
- [ ] Logs show: deletion initiated → acks pending → received → complete
- [ ] Manual test: Close Quick Tab on slow network → persists without timeout
      error

**Issue #10 (Close All):**

- [ ] `forceEmpty` flag is set during Close All operation
- [ ] Storage records explicit empty state: `{ tabs: [], forceEmpty: true }`
- [ ] Manual test: Clear All → reload page → no Quick Tabs appear

**Issue #11 (originTabId in Payload):**

- [ ] Quick Tab creation payload includes `originTabId` field
- [ ] Field contains correct tab ID (not null)
- [ ] Background receives payload with `originTabId` populated

**Issue #12 (Message Timeout):**

- [ ] All content-to-background communication uses persistent ports
- [ ] No one-off sendMessage() calls that don't reset idle timer
- [ ] Message queueing handles connection failures gracefully

**Issue #13 (Idle Timer Reset):**

- [ ] Heartbeat messages sent every 20-25 seconds through port
- [ ] Background responds to heartbeats (keeps connection active)
- [ ] Port stays connected across 30+ second idle periods
- [ ] Manual test: Wait 45+ seconds → heartbeat keeps connection alive

**Issue #14 (Specific Error Logs):**

- [ ] Logs show which dual-block check failed: "✓ originTabId" or "✗ originTabId
      is null"
- [ ] "currentTabId not initialized" error is specific and actionable
- [ ] Stack trace indicates which code path triggered write attempt

**Issue #15 (Format Standardization):**

- [ ] SessionStorageAdapter uses unified format (matches SyncStorageAdapter)
- [ ] Old container-based format is migrated or discarded
- [ ] Content script reads from SessionStorage in unified format
- [ ] No parsing errors when reading Quick Tab data

**All Issues:**

- [ ] All existing tests pass
- [ ] No new console errors or warnings in normal operation
- [ ] Manual test: perform all Quick Tab operations → reload → state fully
      preserved
- [ ] No regression in Quick Tab feature areas outside storage persistence

</acceptance_criteria>

## Supporting Context

<details>
<summary>Firefox WebExtensions API Limitations (Architecture Context)</summary>

Firefox's extension APIs impose several constraints that interact to create
storage persistence challenges:

1. **No Transaction Support:** browser.storage API is completely asynchronous
   with no atomic operations. Multiple writes are not guaranteed to complete as
   one unit. If background script crashes mid-operation, partial state can be
   left in storage.

2. **30-Second Idle Timeout:** Firefox terminates background scripts after 30
   seconds of inactivity. Only certain operations (tabs.query, sendMessage)
   reset the idle timer. Persistent ports do NOT reset the timer just by being
   open—they must have active message flow.

3. **storage.onChanged Unreliability:** MDN and Firefox bug tracking show
   spurious events fire without data changes. Deduplication must be
   multi-layered to handle this.

4. **Content Script Tab ID Limitation:** browser.tabs.getCurrent() is not
   available in content scripts. Must use sendMessage to background (slow,
   async) or embed tab ID in Quick Tab ID pattern (fragile).

These limitations combine to create the dual-block situation: the system needs
strong ownership validation (originTabId + currentTabId) but one field can't be
reliably obtained by content scripts.

</details>

<details>
<summary>Issue #1 Deep Dive: Dual-Block Mechanism</summary>

The dual-block check appears in StorageUtils.persistStateToStorage():

```
Check: if (originTabId != null && currentTabId != null) { write to storage }
```

Why it exists:

- originTabId: Identifies which tab created the Quick Tab (ownership)
- currentTabId: Identifies which tab is performing the write (for validation)

Why it fails:

- originTabId: Starts as null, adoption fixes it later ✓ (works eventually)
- currentTabId: Never initialized anywhere ✗ (never works)

Result: The AND condition is always false because of the second operand.

Evidence from codebase scan:

- No assignment: `currentTabId = ...` found in background.js
- No initialization in createQuickTab() method
- No adoption mechanism updates it
- No fallback extraction from Quick Tab ID pattern
- No synchronous initialization at module load time

The second condition was likely intended as a safety check but was never
implemented. The codebase would need significant refactoring to make this work
unless the condition is removed entirely and replaced with single-source
validation.

</details>

<details>
<summary>Issue #4 Deep Dive: Storage Format Divergence</summary>

Two different storage formats are in use:

**SessionStorageAdapter (old format):**

```
Key: quick_tabs_state_v1_container_firefox-default
Value: {
  tabs: [{ id, url, originTabId, ... }, ...],
  lastUpdate: timestamp
}
```

**SyncStorageAdapter (new format):**

```
Key: quick_tabs_state_v2
Value: {
  tabs: [{ id, url, originTabId, ... }, ...],
  saveId: 'timestamp-random',
  timestamp: number,
  forceEmpty: boolean (optional)
}
```

Impact:

- Content script reads from SessionStorage → gets container format
- Background reads from SyncStorageAdapter → expects unified format
- Code expecting unified format can't parse container format
- Data written in one format may be unreadable in the other

Example failure scenario:

1. Content script updates Quick Tab in SessionStorage (container format)
2. Background reads from SyncStorageAdapter (unified format)
3. Background doesn't see the update because it's in different format
4. Deletion of Quick Tab happens anyway
5. Quick Tab is deleted in background but still exists in SessionStorage
6. On next reload, Quick Tab appears again (from stale SessionStorage) then
   disappears (deleted by background)

This explains the "ghost Quick Tabs" behavior reported in issue-47-revised.md.

</details>

<details>
<summary>Integration Test Recommendations</summary>

To verify fixes work end-to-end:

1. **Creation Persistence Test:**
   - Disable port connection (simulate background unavailable)
   - Create Quick Tab in content script
   - Verify: error is logged, write is queued
   - Enable port connection
   - Verify: queued write retries, succeeds, persists

2. **Adoption Retry Test:**
   - Activate new tab before adoption occurs
   - Create Quick Tab on new tab
   - Verify: originTabId is null (not adopted yet)
   - Verify: storage write is blocked
   - Activate original tab to trigger adoption
   - Verify: adoption updates originTabId
   - Verify: storage write retries, succeeds

3. **Format Compatibility Test:**
   - Write Quick Tab in SessionStorage (container format)
   - Background reads from SyncStorageAdapter
   - Verify: formats are compatible (conversion happens or unified)
   - Delete and recreate Quick Tab
   - Verify: no data loss, consistent state

4. **Cross-Tab Deletion Test:**
   - Create Quick Tab on Tab A
   - Switch to Tab B
   - Close Quick Tab from Tab A
   - Verify: deletion acknowledgment within 3-5 seconds (not 1 second)
   - Verify: Quick Tab is deleted from storage
   - Verify: Quick Tab doesn't reappear on reload

5. **Idle Timeout Test:**
   - Create Quick Tab
   - Wait 45+ seconds (beyond 30-second idle)
   - Perform operation on Quick Tab
   - Verify: operation succeeds (port stayed alive via heartbeat)
   - Verify: heartbeat logs show continuous connectivity

</details>

---

**Priority:** **Critical** (Issues #1-3), **High** (Issues #4-13), **Medium**
(Issues #14-15) | **Target:** Coordinated fix across all storage-related modules
| **Estimated Complexity:** High | **Est. Implementation Tokens:** 8,000-12,000
