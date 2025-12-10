# State Persistence & Messaging: Six Critical Issues with Incomplete Implementations

**Extension Version:** v1.6.3.7-v9 | **Date:** 2025-12-10 | **Scope:** Storage ordering, message sequencing, data corruption detection, and initialization synchronization affecting all state persistence paths (storage.onChanged, BroadcastChannel, runtime.Port)

---

## Executive Summary

The extension has implemented advanced state persistence features (sequence IDs, gap detection, storage validation, initialization guards) but left critical components incomplete or partially integrated. These gaps create silent data losses and permanent state divergence in production:

1. **Storage event ordering** validated but watchdog timeout missing
2. **BroadcastChannel gap detection** implemented but storage fallback not triggered
3. **Port message reordering** tracked but not actually reordered
4. **IndexedDB corruption** detection implemented but recovery not fully automatic
5. **Initialization race condition** guards present but not comprehensive
6. **Missing logging** throughout causes diagnosis failures

All six issues share a common pattern: architectural support exists (sequence IDs, validation, guards) but behavioral completion is missing. Fixing requires integration work, not new architecture.

---

## Issues Overview

| Issue # | Component | Severity | Root Cause | Status |
|---------|-----------|----------|-----------|--------|
| #6 | background.js, sidebar/quick-tabs-manager.js | Critical | Storage.onChanged has no ordering guarantees; watchdog re-read not implemented | Partially fixed |
| #7 | BroadcastChannelManager.js, sidebar/quick-tabs-manager.js | High | Gap detection callback defined but storage fallback not triggered on gap | Partially fixed |
| #8 | background.js (storage layer) | Critical | Validation works but recovery not fully automatic; sync backup not restored on startup | Partially fixed |
| #9 | sidebar/quick-tabs-manager.js, background.js | High | Message sequence counter added but out-of-order messages not reordered, only logged | Partially fixed |
| #10 | sidebar/quick-tabs-manager.js (quickTabHostInfo) | Medium | TTL cleanup implemented but browser.tabs.onRemoved may race with tab close | Implemented |
| #11 | background.js, sidebar/quick-tabs-manager.js | High | Initialization guards added but listener registration still synchronous during async init | Partially fixed |

---

## Issue #6: Storage.onChanged Event Ordering — Validation Present, Watchdog Missing

### Problem

Manager receives storage.onChanged events out of order. When background creates → minimizes → updates tab sequentially, Manager may process as: create, update, minimize (wrong order). Final rendered state diverges permanently from stored state.

**Evidence:**
- `sequenceId` field exists in all storage writes (background.js, line ~1085)
- `lastAppliedSequenceId` tracked in sidebar (sidebar/quick-tabs-manager.js, line ~3050)
- Validation logic exists (`sequenceId > lastAppliedSequenceId` rejection would work)
- **Watchdog timer completely missing** — no 2-second re-read if event doesn't fire

### Root Cause

**Files affected:**
- `background.js` (lines 1080-1090: storage write, adds sequenceId)
- `sidebar/quick-tabs-manager.js` (lines 3045-3065: storage.onChanged listener has sequenceId available but never validates ordering)

**Issue:** Browser provides no ordering guarantee between sequential storage.set() calls. Extension added sequence ID infrastructure but never implemented the validation gate or watchdog timeout. Result: stale state silently applied, cache diverges from storage.

### Fix Required

Implement three behavioral additions:

1. **Sequence validation gate** in storage.onChanged listener: Before applying state update, check if incoming sequenceId > lastAppliedSequenceId. If not, log warning and REJECT update (or queue for later). This prevents out-of-order application.

2. **Watchdog timer** on every storage.set() call: Set 2-second timer. If storage.onChanged doesn't fire within that window, explicitly re-read storage to verify state persisted. Log "STORAGE_WATCHDOG_TRIGGERED" with old/new tab count comparison.

3. **Logging throughout:** Every storage.set() must log operation ID + sequenceId + expected tab count. Every storage.onChanged must log sequenceId + comparison to lastAppliedSequenceId + decision (accept/reject/queue).

<scope>
**Modify:**
- `background.js`: Add watchdog timer logic after each writeStorageWithValidation() call. Generate unique operation ID for each write; include in logging.
- `sidebar/quick-tabs-manager.js`: Add sequence validation gate in storage.onChanged listener. Check sequenceId before applying state. Implement queue for out-of-order messages.

**Do NOT Modify:**
- Sequence ID generation (already correct)
- Storage write mechanism itself
- Manager's cache reconciliation logic
</scope>

<acceptance_criteria>
- [ ] storage.onChanged listener rejects updates with sequenceId ≤ lastAppliedSequenceId
- [ ] Watchdog timer fires 2s after storage.set() if onChanged doesn't arrive
- [ ] All storage operations log with unique operationId + sequenceId
- [ ] Manual test: rapid create → minimize → update → verify final state matches expected tab order
- [ ] Zero divergence between background cache and Manager cache in test scenario
</acceptance_criteria>

---

## Issue #7: BroadcastChannel Message Coalescing — Gap Detection Implemented, Fallback Missing

### Problem

Manager in background tab loses BroadcastChannel messages silently. When background posts 5+ updates in <500ms, Manager receives only 1, 3, 5 due to browser throttling. Extension detects gaps via sequence numbers but never triggers storage fallback, leaving Manager permanently out of sync.

**Evidence:**
- Monotonic `_broadcastSequenceCounter` in BroadcastChannelManager.js (line ~95)
- `processReceivedSequence()` function detects gaps (line ~150-180)
- Gap detection callback registered in sidebar (sidebar/quick-tabs-manager.js, line ~3180)
- `_triggerStorageFallbackOnGap()` defined (sidebar/quick-tabs-manager.js, line ~3200)
- **Callback never invoked** — setGapDetectionCallback defined but _gapDetectionCallback is never called in handleBroadcastChannelMessage

### Root Cause

**Files affected:**
- `BroadcastChannelManager.js` (lines 150-180: gap detection works, but _invokeGapDetectionCallback never called from processReceivedSequence in the detection path)
- `sidebar/quick-tabs-manager.js` (lines 3175-3185: callback registered but never fires; handleBroadcastChannelMessage calls processReceivedSequence but ignores hasGap result)

**Issue:** Browser throttles background tabs to ~1 message per 1000ms. Extension detects gaps but communication between detector and responder is broken. Callback defined but never reached.

### Fix Required

Implement message loss recovery flow:

1. **Integrate gap detection callback invocation** in handleBroadcastChannelMessage: After calling processReceivedSequence, check hasGap result. If true, immediately call the gap detection callback.

2. **Implement heuristic for polling fallback**: If BroadcastChannel has received no messages for >5 seconds, assume browser has throttled Manager tab. Switch to storage polling as primary, BroadcastChannel as best-effort only. Use isBroadcastChannelStale() function already present.

3. **Log gap detection thoroughly**: When gap detected, log "SEQUENCE_GAP_DETECTED" with expectedSeq/receivedSeq/gapSize. When fallback triggered, log "STORAGE_FALLBACK_ACTIVATED" with reason and current cache state.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js`: Wire gap detection callback invocation in handleBroadcastChannelMessage. Implement polling heuristic check.
- `BroadcastChannelManager.js`: No changes needed (gap detection logic already correct)

**Do NOT Modify:**
- Sequence number generation
- BroadcastChannel postMessage calls
- Backpressure throttling mechanism
</scope>

<acceptance_criteria>
- [ ] Gap detection callback invoked when sequenceNumber gap detected
- [ ] Storage fallback read triggered immediately on gap
- [ ] Manager switches to polling mode if no BC messages for >5 seconds
- [ ] Manual test: Create 10 tabs while sidebar in background tab → all 10 appear after switching to foreground
- [ ] Logging shows "STORAGE_FALLBACK_ACTIVATED" and recovered tab count
</acceptance_criteria>

---

## Issue #8: IndexedDB Corruption Detection — Validation Works, Automatic Recovery Incomplete

### Problem

Firefox has known IndexedDB corruption bugs (1979997, 1885297). When corruption occurs, storage.local silently returns empty state. Extension validates writes but recovery mechanism isn't fully automatic: startup backup restore only happens if tabs are present, leaving data-loss window open.

**Evidence:**
- `validateStorageWrite()` implemented with read-back verification (background.js, line ~680)
- `writeStorageWithValidation()` with retry logic (line ~720)
- `handleStorageCorruption()` triggers recovery (line ~800)
- `checkStorageIntegrityOnStartup()` checks health (line ~1050)
- `attemptRecoveryFromSyncBackup()` tries restore (line ~920)
- **Issue:** Startup backup restore only attempts if local storage empty. Never checks if cache differs from storage.

### Root Cause

**Files affected:**
- `background.js` (lines 680-800: validation + recovery framework in place)
- `background.js` (lines 1050-1100: startup check exists but incomplete)

**Issue:** Firefox corruption can return data with wrong tab count or missing keys. Extension's startup check (checkStorageIntegrityOnStartup) compares tab count but doesn't validate data checksum. Recovery path exists but isn't triggered for subtle corruption (wrong count but not zero).

### Fix Required

Implement comprehensive corruption detection and automatic recovery:

1. **Add data integrity checksum** on every storage.set(): Compute hash of tab IDs + states before write. Read back and compare hashes. If mismatch, trigger corruption recovery immediately.

2. **Enhance startup check**: On initialization, always compare storage.local with storage.sync backup. If count differs by >0, assume corruption and restore from sync. Don't require zero-tab state to trigger recovery.

3. **Implement automatic sync backup updates**: Every successful storage.set() also writes to storage.sync as redundant copy. This ensures backup is always fresh (within seconds of writes).

4. **Add recovery logging**: Every corruption detection must log operationId + expected data + actual data + recovery action taken.

<scope>
**Modify:**
- `background.js` (lines 680-800): Add checksum computation and comparison in validateStorageWrite
- `background.js` (lines 1050-1100): Enhance startup integrity check to use checksum comparison
- `background.js` (writeStorageWithValidation): Automatically update storage.sync after every successful local write

**Do NOT Modify:**
- storage.onChanged listener
- Storage cache update logic
- Browser API calls (no workarounds)
</scope>

<acceptance_criteria>
- [ ] Data checksum computed and compared on every write
- [ ] Mismatch triggers immediate corruption recovery with operationId logging
- [ ] Startup check restores from sync backup if cache differs from storage
- [ ] storage.sync always updated within 100ms of storage.local writes
- [ ] Manual test: Simulate corruption (delete key from storage) → verify recovery from backup on next startup
</acceptance_criteria>

---

## Issue #9: Runtime.Port Message Ordering — Sequence Counter Present, Reordering Logic Missing

### Problem

Sidebar sends HEARTBEAT and other port messages rapidly. Background may process out of order due to browser event loop scheduling. If KEEPALIVE arrives before HEARTBEAT response, background's lastHeartbeatTime gets clobbered, defeating idle-timer reset purpose.

**Evidence:**
- `_managerPortMessageSequence` counter exists (sidebar/quick-tabs-manager.js, line ~3300)
- `_getNextManagerPortMessageSequence()` increments it (line ~3305)
- Messages include `messageSequence` field (sidebar/quick-tabs-manager.js, line ~3330: `messageSequence`)
- **Missing:** Background never checks messageSequence or reorders messages. Logging shows sequence but processing is still FIFO.

### Root Cause

**Files affected:**
- `sidebar/quick-tabs-manager.js` (lines 3300-3330: sequence number added to messages)
- `background.js` (message handler: logs sequence but doesn't reorder)

**Issue:** Runtime.Port does NOT guarantee message ordering. MDN explicitly states "Port messages may be reordered." Extension added sequence counter infrastructure but never implemented the reordering gate. Result: heartbeat logic assumes FIFO ordering but gets LIFO occasionally.

### Fix Required

Implement message reordering with queuing:

1. **Create pending message queue** in background.js: Maintain ordered queue of incoming port messages by messageSequence. On message arrival, check if messageSequence > lastProcessedSequence. If yes, process immediately. If no (out of order), queue for later.

2. **Implement sequence-driven dequeue** in handler: After processing in-order message, check if next-expected sequence is now in queue. If yes, process it. Repeat until queue has gap.

3. **Add timeout for stuck messages**: If queue has messages but gap remains for >1 second, log warning and process out-of-order (fallback to LIFO to prevent deadlock).

4. **Log sequence throughout**: Every port message entry logs messageSequence + isOutOfOrder flag. Dequeue operation logs queue state before/after.

<scope>
**Modify:**
- `background.js`: Create message queue and sequence-driven dequeue logic. Add to port message handler.

**Do NOT Modify:**
- Port connection setup
- Message types or payload structure
- Heartbeat interval timing
</scope>

<acceptance_criteria>
- [ ] Port messages queued if out of order (messageSequence ≤ lastProcessedSequence)
- [ ] In-order messages processed immediately; queue flushed after
- [ ] Stuck queue timeout triggers after 1s; logs warning with queue state
- [ ] Manual test: Rapid heartbeat + keepalive → verify lastHeartbeatTime always reset correctly
- [ ] Zero timeout failures in hour-long stress test with simulated message reordering
</acceptance_criteria>

---

## Issue #10: Tab Affinity Map Desynchronization — TTL Cleanup Implemented, Race Condition Possible

### Problem

`quickTabHostInfo` Map grows indefinitely with stale entries for closed tabs. TTL cleanup is implemented (24-hour age eviction) but browser.tabs.onRemoved listener may race: if tab closes before its Quick Tab is deleted from Manager, entry persists indefinitely until TTL expiration.

**Evidence:**
- `quickTabHostInfo` Map declared (sidebar/quick-tabs-manager.js, line ~1200)
- TTL cleanup job runs every 60s (line ~3550)
- HOST_INFO_TTL_MS = 24 * 60 * 60 * 1000 (line ~565)
- browser.tabs.onRemoved listener exists (implied in codebase, not found in sidebar scan)
- **Issue:** Entry removal on tab close may not be guaranteed to execute before Manager state diverges

### Root Cause

**Files affected:**
- `sidebar/quick-tabs-manager.js` (lines 1200-1210: Map management)

**Issue:** No synchronous guarantee that browser.tabs.onRemoved fires before Manager operations execute. Browser may fire event asynchronously, leaving race window where Map entry exists for closed tab. TTL provides eventual cleanup but not prompt cleanup.

### Fix Required

Implement prompt cleanup with race protection:

1. **Add timestamp to each Map entry**: Store lastUpdate timestamp alongside hostTabId. This enables diagnostic logging of entry age.

2. **Enhance cleanup job**: Every 60 seconds, iterate through Map. Remove any entries where lastUpdate > 24 hours. Log size before/after cleanup.

3. **Defensive cleanup during operation**: Before adding new entry to Map, scan for any entries with closed tabs (cross-check against browser.tabs.query() results). Remove stale entries proactively.

4. **Add diagnostic logging**: Log Map size + sample entries (IDs + age) every 60 seconds. This enables detection of unbounded growth.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (lines 1200-1210): Add timestamp and lastUpdate field to Map entries

**Do NOT Modify:**
- Browser API calls (tabs.query, etc.)
- Map usage in other functions
- Quick Tab operation logic
</scope>

<acceptance_criteria>
- [ ] quickTabHostInfo entries include lastUpdate timestamp
- [ ] TTL cleanup removes entries older than 24 hours
- [ ] Diagnostic logging shows Map size + age stats every 60s
- [ ] Manual test: Open 50 tabs, create Quick Tabs, close all tabs → Map should be empty or near-empty after cleanup cycle
- [ ] No unbounded growth in logs over 24-hour test
</acceptance_criteria>

---

## Issue #11: Initialization Race Between Listeners — Guards Added, Registration Still Synchronous

### Problem

Three initialization paths run concurrently: `initializeGlobalState()` (async), `DOMContentLoaded` listener (sync), and `storage.onChanged` listener (fires immediately). If storage.onChanged fires BEFORE initializeGlobalState completes, listener may call methods expecting initialized state, causing silent failures.

**Evidence:**
- `initializationStarted` flag exists (sidebar/quick-tabs-manager.js, line ~650)
- `initializationComplete` flag exists (line ~655)
- `isFullyInitialized()` guard function exists (line ~660)
- `logListenerEntry()` with initialization status exists (line ~670)
- `storage.onChanged` listener HAS guard check (sidebar/quick-tabs-manager.js, line ~3050: checks isFullyInitialized)
- **Issue:** storage.onChanged listener registered DURING initialization, not AFTER. Guard prevents errors but initialization itself may be incomplete when listener fires.

### Root Cause

**Files affected:**
- `sidebar/quick-tabs-manager.js` (line ~200-250: DOMContentLoaded calls async functions; other listeners register synchronously)
- `background.js` (line ~600-650: initializeGlobalState async; listeners registered at script load, not after init completes)

**Issue:** Listener registration is synchronous (line 10). Initialization is asynchronous (awaited at line 20). Browser can fire events before await completes. Guards prevent exceptions but don't prevent incomplete state.

### Fix Required

Implement deferred listener registration:

1. **Background.js**: Move all listener registrations (storage.onChanged, message handlers, etc.) to END of initializeGlobalState(). Don't register until isInitialized = true.

2. **Sidebar**: Defer critical listeners (storage.onChanged) until initializationComplete = true. Register them in finally block after loadQuickTabsState completes.

3. **Add initialization barrier**: Implement function that blocks until isInitialized = true with timeout. All critical handlers call this on entry. If not initialized, return error response and queue for retry.

4. **Log listener registration**: Every listener registration must log "LISTENER_REGISTERED: [name]" with initialization status. Every listener entry must log "LISTENER_ENTRY: [name]" with initialization status + duration since init.

<scope>
**Modify:**
- `background.js` (initializeGlobalState function): Move listener registrations to end of function, after isInitialized = true
- `sidebar/quick-tabs-manager.js` (DOMContentLoaded listener): Defer storage.onChanged and other critical listeners until initializationComplete = true

**Do NOT Modify:**
- Initialization logic itself
- Message handler implementations
- Storage write/read mechanisms
</scope>

<acceptance_criteria>
- [ ] All listener registrations deferred until initialization complete
- [ ] Listener entry logs include initialization status + time since init start
- [ ] storage.onChanged listener always found isInitialized = true on first entry
- [ ] Manual test: Reload sidebar, check logs for "LISTENER_ENTRY_BEFORE_INIT" → should be zero
- [ ] Hour-long stress test: zero initialization race condition logs
</acceptance_criteria>

---

## Critical Missing Logging

Beyond the six issues above, logging is incomplete throughout state persistence paths. Missing logging makes diagnosis impossible in production:

**Storage write path:**
- No logging of storage.set() operationId BEFORE write
- No logging of validation result (passed/failed/retry)
- No logging of read-back data comparison

**BroadcastChannel path:**
- Gap detection logged but fallback activation not logged
- Message coalescing suspected but never confirmed with sequence logging
- No logging of "stale channel" heuristic check result

**Port messaging path:**
- Message sequence logged but "out of order" flag not logged
- Queue state not logged on insertion/dequeue
- Timeout fallback not logged

**Initialization path:**
- listener entry lacks timestamp for duration calculation
- No logging of which initialization async operation completed
- No logging of barrier wait (if any handler blocks waiting for init)

### Fix Required

Add unified logging harness across all persistence paths:

1. **Storage operations**: Log operationId + sequenceId + expected state hash BEFORE write. Log result + actual state hash + comparison AFTER validation.

2. **Message routing**: Log messageSequence + "in-order"/"out-of-order" flag on every message entry. Log queue state on out-of-order.

3. **Initialization**: Log initialization START with timestamp. Log each barrier wait with duration. Log listener registration with init status.

4. **Consolidate format**: Use consistent log entry structure: `[Component] EVENT_TYPE: { field1, field2, timestamp }`. This enables grep-able diagnostic logs.

---

## Shared Root Cause & Why These Bundle Together

All six issues stem from incomplete integration of architectural features that were partially implemented:

- **Sequence IDs exist** (Issue #6) but validation gate not wired
- **Gap detection implemented** (Issue #7) but callback not fired
- **Corruption validation works** (Issue #8) but recovery not automatic
- **Message sequencing added** (Issue #9) but reordering not implemented
- **TTL cleanup created** (Issue #10) but doesn't prevent initial accumulation
- **Initialization guards present** (Issue #11) but registration still synchronous

Pattern: Infrastructure in place, behavioral completion missing. Fixes require wiring components together, not architectural redesign.

---

<scope>
**Modify:**
- `background.js` (multiple sections: storage, initialization, port messaging)
- `sidebar/quick-tabs-manager.js` (multiple sections: storage, BroadcastChannel, port, initialization)
- `BroadcastChannelManager.js` (gap detection callback integration)

**Do NOT Modify:**
- Existing sequence ID generation (correct)
- Storage write mechanism (correct)
- Listener interfaces (correct)
- DOM rendering or UI logic
- Content script messaging
</scope>

<acceptance_criteria>
- [ ] Issue #6: Watchdog timer fires 2s after storage.set(); sequence validation rejects out-of-order events
- [ ] Issue #7: Gap detected → storage fallback read triggered; Manager recovers missed updates
- [ ] Issue #8: Corruption detected → automatic sync backup restore; no data loss on startup
- [ ] Issue #9: Out-of-order port messages queued and reordered; heartbeat always resets correctly
- [ ] Issue #10: quickTabHostInfo cleaned every 60s; no unbounded growth over 24h
- [ ] Issue #11: storage.onChanged listener always finds initialization complete; zero race logs
- [ ] Logging: All storage/messaging operations log with operationId + sequence + validation result
- [ ] 4-hour stress test: zero divergence between background cache and Manager cache; zero silent failures
- [ ] All existing tests pass; manual test scenarios from each issue pass
</acceptance_criteria>

---

**Priority:** Critical (Issues #6, #8), High (Issues #7, #9, #11), Medium (Issue #10) | **Dependencies:** None (independent fixes) | **Complexity:** High (integration work across multiple modules)

---

## Supporting Context

<details>
<summary>Why These Issues Were Not Caught</summary>

All six issues exhibit the pattern: partial implementation detected by code review but incomplete behavioral integration not caught by unit tests. Specifically:

1. **Sequence ID infrastructure added** but validation gate never tested
2. **Gap detection callback defined** but integration with storage fallback never tested
3. **Corruption validation implemented** but auto-recovery path not exercised in tests
4. **Message sequence counter added** but reordering queue never implemented
5. **TTL cleanup coded** but race conditions with browser.tabs.onRemoved never simulated
6. **Initialization guards created** but listener registration timing never verified

Each could pass code review ("good pattern, guard exists, callback defined") while failing production ("guard never checked, callback never called, queue not implemented").

Recommendation: Add integration tests that exercise full flow (write → storage.onChanged → Manager update → verify consistency) under adverse conditions (message reordering, storage corruption, rapid operations).

</details>

<details>
<summary>Firefox Bug References (Issue #8 Context)</summary>

**Bug 1979997:** "IndexedDB storage for WebExtension becomes corrupted and inaccessible"
- Affects Firefox 102+
- Symptom: storage.local.get() returns empty {} instead of stored tabs
- Root cause: IndexedDB backend corruption on unclean shutdown
- Workaround: Set pref `extensions.webextensions.keepStorageOnCorrupted = true`
- Status: WONTFIX (design limitation)

**Bug 1885297:** "WebExtension storage corruption after unclean shutdown"
- Affects Firefox 115+
- Symptom: Partial data loss (some keys readable, others return null)
- Root cause: Incomplete transaction recovery
- Workaround: Manual profile backup/restore
- Status: Open

The extension currently has no mitigation for either. Implementing automatic sync backup restore (Issue #8 fix) provides recovery path without requiring manual intervention.

</details>
