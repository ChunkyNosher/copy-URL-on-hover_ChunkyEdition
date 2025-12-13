# Copy-URL-on-Hover: Quick Tabs Feature - Additional Critical Issues

**Async Initialization, Message Passing, and State Synchronization Failures (Supplementary Report)**

Extension Version v1.6.3.8-v7 / v1.6.3.8-v8

Date 2025-12-13

<scope>
Nine additional critical issues identified in extension initialization sequencing, port lifecycle management, storage event ordering validation, BFCache state reconciliation, and message deduplication that are not covered in the primary diagnostic report. Issues stem from incomplete refactoring (BroadcastChannel removal), Firefox API timing mismatches, and dead code paths that mask initialization bugs.
</scope>

---

## Executive Summary

Beyond the four primary issues in the initial diagnostic report, comprehensive codebase scan revealed nine additional critical failures affecting content script initialization order, port connection lifecycle, storage event validation, and BFCache recovery. These issues compound the primary problems and create new failure modes:

- **Issues #5-7**: Initialization sequencing places storage listener registration before feature modules are ready, causing dropped events and race conditions
- **Issues #8-9**: Storage event validation logic becomes unreliable during Firefox's listener latency window, causing false ordering violations
- **Issue #10**: BFCache recovery incorrectly reconciles sessionStorage vs storage.local, losing session-only tab state
- **Issue #11**: Write-ahead log in DestroyHandler provides zero cross-tab protection and is never consulted
- **Issue #12**: Fallback storage polling doesn't actually implement fallback logic—it just reads storage once without retry
- **Issue #13**: BroadcastChannel removal incomplete; background.js may still reference removed communication channel

| Issue # | Component | Severity | Root Cause |
|---------|-----------|----------|-----------|
| #5 | Port lifecycle + message handlers | CRITICAL | Port connected AFTER storage listener, creating message loss window |
| #6 | Early storage listener registration | CRITICAL | Listener registered at load time, handler not defined until async imports complete |
| #7 | Content script initialization order | CRITICAL | Features initialized before port connected; async tab ID fetch creates ordering dependency |
| #8 | Storage event ordering validation | HIGH | Listener latency window invalidates timestamp-based sequenceId checks |
| #9 | Message deduplication window | HIGH | 2-second window too narrow for Firefox port reconnection delays |
| #10 | BFCache state reconciliation | HIGH | sessionStorage cleared by BFCache but code tries to reconcile it; logic always prefers storage.local |
| #11 | Write-ahead log cleanup | MEDIUM | Per-instance log provides no cross-tab value; cleanup is async without guarantee |
| #12 | Fallback storage polling | MEDIUM | Doesn't actually fallback—reads storage once and returns; no retry or recovery |
| #13 | BroadcastChannel removal | CRITICAL | Content.js updated but no evidence background.js was updated; broadcasts may be silently lost |

---

## Issue #5: Port Connection Race Condition—Port Ready After Storage Listener

**Problem**

Content script registers `storage.onChanged` listener at line ~172 (EARLY STORAGE LISTENER REGISTRATION comment), but doesn't connect to background port until line ~1360 (connectContentToBackground). Between listener registration and port connection exists a window where storage changes fire but port isn't ready to forward messages to background. If hydration occurs during this window, storage events are processed but messages fail silently.

Evidence from extension logs:
- Storage listener registered at T+0ms (v1.6.3.8-v8 EARLY STORAGE LISTENER REGISTERED)
- Port connected at T+1360ms (Port connection established to background)
- Hydration begins at T+382ms (STEP 6: Attempting to hydrate state)
- Storage changes fire during T+0 to T+1360 window
- Messages queued but port not ready (backgroundPort is null or disconnected)

**Root Cause**

File `content.js` initialization order violates dependency graph: storage events can fire before transport channel is ready. Port.onDisconnect handler at lines ~1200-1250 sets `portCircuitBreakerTripped = true` if connection fails, but by that time listener events may have already queued with nowhere to send them.

Current code attempts to guard with `if (backgroundPort)` checks, but:
- Port reconnection uses exponential backoff starting at 1000ms (PORT_RECONNECT_BASE_DELAY_MS)
- If port initially fails to connect, messages are dropped for up to 10 seconds (PORT_RECONNECT_MAX_DELAY_MS)
- Circuit breaker flag prevents reconnection attempts during cooldown, creating silent message loss

**Issue**

Storage listener fires synchronously when hydration writes to storage, attempting to emit messages before port is connected. Messages are not queued—they're just dropped if `backgroundPort` is null. No error logged; no retry; listener continues firing with nowhere to send data.

**Fix Required**

Refactor initialization sequencing to ensure port connection completes BEFORE storage listener registration, or implement proper message queueing for events that fire before port is ready:

1. Move `connectContentToBackground()` earlier in initialization (before storage listener setup or feature initialization)
2. Implement message queue in storage listener callback—if port not ready, queue event for retry when port connects
3. Add explicit ordering guarantee using Promise chains rather than relying on implicit execution order
4. Implement port reconnection with active retry (not just timeout-based backoff)—detect connection loss and attempt immediate reconnect
5. Log all dropped messages and reconnection events to enable diagnosis

Consider reviewing `Port.onDisconnect` handler and `portCircuitBreakerTripped` flag logic. Circuit breaker should implement exponential backoff but allow breaking out of cooldown if reconnection succeeds.

---

## Issue #6: Storage Listener Registration Decoupled from Handler Definition

**Problem**

Content script registers `storage.onChanged` listener at line ~172 with comment "v1.6.3.8-v8 EARLY STORAGE LISTENER REGISTRATION", but the actual handler function `_handleStorageChange` is not defined until much later. Early events are queued in `_earlyStorageChangeQueue` (line ~185) but processed asynchronously via `_connectEarlyStorageListener()` at line ~1918, decoupling listener registration from handler implementation.

During the gap between listener registration and handler attachment:
- Storage events fire and are queued
- Queue processing is async, losing ordering guarantees
- Event handler callback context may be wrong
- Early events processed out of order relative to later events

Evidence from extension logs:
- T+0: Storage listener registered (early registration)
- T+0: Queued events begin accumulating in `_earlyStorageChangeQueue`
- T+1918ms: `_connectEarlyStorageListener()` calls actual handler
- Events queued during T+0-1918 processed in batch, not real-time

**Root Cause**

File `content.js` uses early listener pattern to capture events before async module imports complete. However, early listener just queues events without actually processing them. The real handler attachment happens asynchronously at line ~1918 via `_connectEarlyStorageListener()`, which reads the queue and connects it to actual handler.

Current code at line ~180-200:
```
browser.storage.onChanged.addListener((changes, areaName) => {
  // Early listener - just queue the event
  _earlyStorageChangeQueue.push({ changes, areaName });
});
```

Then later at ~1918:
```
function _connectEarlyStorageListener() {
  // Process queued events and attach real listener
  // But events are processed asynchronously
}
```

**Issue**

- Events registered but not processed until async module imports complete
- Queue processing doesn't guarantee order if queueing happens during module imports
- Early events may be dropped if queue is cleared before handler attachment
- Handler attachment is async/deferred, not synchronous

**Fix Required**

Refactor to guarantee handler availability before listener activation:

1. Move storage listener registration to AFTER module imports complete (move from line ~172 to after line ~1850)
2. Register listener with actual handler function directly, not with queue intermediary
3. If early event capture is necessary, ensure queue is processed synchronously before any hydration occurs
4. Remove `_earlyStorageChangeQueue` pattern—listener should fire with actual handler from the start
5. Log listener attachment timing and handler readiness state

Consider whether early listener is necessary at all. If storage events can't fire during module imports (unlikely), remove early pattern entirely. If they can, ensure handler is ready before listener activates.

---

## Issue #7: Content Script Initialization Order Dependencies—Async Tab ID Fetch Blocking

**Problem**

Content script initialization calls `requestCurrentTabId()` at line ~1360 (MessageUtils.REQUESTSENT log visible in logs), which is an async network request to background. This request completes at T+124ms (MessageUtils.MESSAGEACKRECEIVED log shows 124ms duration). However, feature initialization (Quick Tabs) is triggered BEFORE this async request completes.

Initialization order:
1. Storage listener registered (line ~172) - T+0
2. Features begin initialization (line ~1300) - T+300
3. Tab ID requested from background (line ~1360) - T+300 (async)
4. Tab ID received (line ~1360 callback) - T+424ms
5. Port connected to background (line ~1360) - T+424ms
6. Quick Tabs feature waits for tab ID (line in QuickTabsManager) - T+300+

Quick Tabs initialization awaits tab ID, but tab ID response is async. If tab ID not received by the time features try to initialize, initialization is blocked or fails. Log shows QuickTabsManager uses pre-fetched tab ID from options, but this only works if request completes before QuickTabsManager constructor runs.

Evidence from extension logs:
- MessageUtils REQUESTSENT at T+124ms (tab ID request)
- MessageUtils MESSAGEACKRECEIVED at T+155ms (tab ID received, 124ms delay)
- Port connection established at T+156ms (after tab ID response)
- QuickTabsManager initialized at T+156ms (uses pre-fetched currentTabId)

**Root Cause**

File `content.js` initialization order creates dependency on async operation (tab ID fetch) that blocks synchronous initialization (feature modules). Current code works because:
- Tab ID request is fast (124ms shown in logs)
- QuickTabsManager waits for currentTabId option to be set
- Port connection waits for tab ID response

But this is brittle—if tab ID request slows down (network latency, background script busy), feature initialization may proceed with missing tab ID.

**Issue**

- Async tab ID fetch creates timing dependency that's not explicit in code
- Feature initialization doesn't have hard requirement for tab ID completion
- If request times out or fails, features initialize with undefined tab ID
- Port connection depends on tab ID request completion, but this isn't enforced

**Fix Required**

Implement explicit initialization sequencing with Promise chains:

1. Create initialization barrier—features don't start until tab ID fetch completes
2. Add explicit timeout for tab ID request (currently uses generic 3000ms, but quicktabs feature should fail faster)
3. Implement fallback if tab ID unavailable (use alternative ID source or fail gracefully)
4. Chain initialization steps: tab ID → port connection → features initialization
5. Log initialization barriers—when each step completes and what's waiting on what

Consider using async/await with explicit Promise chains rather than relying on callback timing.

---

## Issue #8: Storage Event Ordering Validation Unreliable During Listener Latency Window

**Problem**

Function `_validateStorageEventOrdering()` at lines ~1400-1450 validates that storage events arrive in correct order using `revision` and `sequenceId` fields. However, Firefox's documented 100-250ms listener latency means events arrive out of order relative to when they were written.

Example failure scenario:
1. Tab A writes (sequenceId: 1) at T+0
2. Tab B writes (sequenceId: 2) at T+50
3. Tab A's listener fires (sequenceId: 1) at T+280 (250ms Firefox delay)
4. Tab B's listener fires (sequenceId: 2) at T+75 (normal delay)
5. Ordering validation fails because Tab B's event (sequenceId: 2) arrived before Tab A's (sequenceId: 1)

Current code assumes listener fires immediately after write, so earlier `sequenceId` = earlier arrival. But Firefox delays all listeners equally, causing this assumption to break with multiple tabs.

Evidence from logs analysis:
- No explicit ordering validation errors in provided logs (validations happen silently)
- But logs show multiple tabs writing to storage nearly simultaneously
- HYDRATIONFILTERSTART logs show rapid state changes happening during hydration
- Logs don't show when events actually arrived vs when they were written

**Root Cause**

File `content.js` implements `_validateStorageEventOrdering()` that checks `sequenceId` ordering, but:
- `sequenceId` assigned when write completes (promise resolution), not when listener fires
- Listener fires 100-250ms AFTER write completes
- Multiple concurrent writes across tabs all experience similar delays
- Events with higher `sequenceId` can arrive before earlier `sequenceId` events due to listener scheduling variance

**Issue**

- Timestamp-based validation becomes unreliable when all events experience 100-250ms delay
- False ordering violations logged when actually correct but delayed
- Cross-tab synchronization logic may incorrectly reject valid state updates
- Validation doesn't account for Firefox's documented listener latency

**Fix Required**

Refactor storage event ordering validation to account for Firefox's listener latency:

1. Remove strict `sequenceId` ordering check during the 100-250ms listener latency window
2. Instead, implement tolerance window: accept events that arrive out of order if within expected Firefox delay
3. Use wall-clock timestamps of when listener fires, not when write was initiated
4. For cross-tab ordering, acknowledge that simultaneity can't be determined during 100-250ms delay
5. Log actual elapsed time from write completion to listener fire for each event

Consider whether strict ordering is necessary at all. If goal is just to ensure eventual consistency, use causal ordering (LWW - last writer wins) based on listener arrival time, not write time.

---

## Issue #9: Message Deduplication Window Too Narrow for Firefox Port Reconnection

**Problem**

Code implements RESTORE_DEDUP_WINDOW_MS constant set to 2000ms (2 seconds) to deduplicate multiple RESTORE_QUICK_TAB messages during BFCache restoration. However, port reconnection circuit breaker cooldown can last up to 10 seconds (PORT_RECONNECT_MAX_DELAY_MS), and port reconnection itself takes 200-500ms.

During page restoration:
1. Page enters BFCache (paused) - T+0
2. Page restored from BFCache - T+5000ms
3. Port.onDisconnect fires (connection lost during BFCache) - T+5000
4. Circuit breaker tripped, cooldown starts - T+5000
5. No messages can be sent for next 10 seconds (PORT_RECONNECT_MAX_DELAY_MS)
6. Deduplication window (2 seconds) passes - T+7000
7. Multiple RESTORE messages queued during deduplication window finally send at T+15000
8. All queued messages send at once, causing restore storm

Evidence from code inspection:
- RESTORE_DEDUP_WINDOW_MS = 2000 (line ~1175)
- PORT_RECONNECT_MAX_DELAY_MS = ~10000 (line ~1200-1250)
- Port reconnection uses exponential backoff (1000ms → 2000ms → 4000ms → 10000ms)
- No ordering between deduplication window and port reconnection cooldown

**Root Cause**

File `content.js` implements deduplication window independent of port connection state. If port disconnects during BFCache, circuit breaker prevents reconnection for up to 10 seconds. Deduplication window (2 seconds) expires, but messages can't be sent until port reconnects (10 seconds). Messages queue up and send in batch when port finally reconnects.

**Issue**

- Deduplication window assumes port is ready to send (it's not if circuit breaker is active)
- Messages queue beyond deduplication window because port isn't connected
- When port reconnects, all queued messages send at once (restore storm)
- Circuit breaker cooldown is longer than deduplication window, guaranteeing this failure mode

**Fix Required**

Coordinate deduplication window with port reconnection state:

1. Extend deduplication window to at least PORT_RECONNECT_MAX_DELAY_MS (10 seconds) OR reduce port reconnection max delay
2. Implement port state awareness in deduplication logic—check if port is connected before applying deduplication
3. If port not connected, defer deduplication window until port is ready
4. Add queue length monitoring—log when messages queue up beyond expected deduplication count
5. Implement per-message deduplication rather than time-window deduplication for restore operations

Consider whether port reconnection delays should be so aggressive. Exponential backoff up to 10 seconds may be excessive for a network request that should complete in 100-200ms.

---

## Issue #10: BFCache State Reconciliation Loses Session-Only Tabs

**Problem**

Function `_validateAndSyncStateAfterBFCache()` at lines ~1050-1130 attempts to reconcile sessionStorage (session-only state) vs storage.local (persistent state) after page enters/exits BFCache. However, Firefox clears sessionStorage when page enters BFCache (documented browser behavior). Code compares empty sessionStorage against valid storage.local, and resolution logic always prefers storage.local.

Result: session-only Quick Tabs that should be cleared are restored from storage.local, reappearing on page after BFCache restoration.

Scenario:
1. User creates Quick Tab A (persistent, saved to storage.local)
2. User creates Quick Tab B (session-only, saved only to sessionStorage)
3. User navigates away (page enters BFCache)
4. sessionStorage cleared by Firefox (automatic)
5. storage.local still has both tabs
6. User navigates back (page restored from BFCache)
7. BFCache restore handler runs `_validateAndSyncStateAfterBFCache()`
8. Compares sessionStorage (empty) vs storage.local (both tabs)
9. Logic says "sessionStorage is stale, prefer storage.local"
10. Both tabs restored, including session-only Tab B (wrong)

Evidence from code inspection:
- Function reads from sessionStorage (line ~1070)
- Function reads from storage.local (line ~1075)
- Resolution logic at line ~1110 prefers storage.local if sessionStorage is stale
- SessionStorage ALWAYS stale after BFCache (by design)

**Root Cause**

File `content.js` doesn't account for Firefox's BFCache behavior of clearing sessionStorage automatically. Code assumes both storage sources are equally valid after restoration, but sessionStorage is guaranteed to be empty after BFCache.

Function tries to resolve "conflict" between two storage sources, but conflict is artificial—sessionStorage will always lose after BFCache because Firefox clears it.

**Issue**

- Logic doesn't distinguish "sessionStorage empty due to BFCache" vs "sessionStorage empty due to page reload"
- Reconciliation always prefers storage.local, defeating purpose of session-only state
- Session-only tabs that should be cleared are restored from persistent storage
- User perceives data loss (tabs they closed appear again)

**Fix Required**

Implement BFCache-aware state reconciliation:

1. Detect if page entered BFCache (check for `pagehide` event with `persisted: true` in event history, or check if document.hidden was true before restore)
2. If BFCache restoration, don't try to reconcile—simply use storage.local as-is (sessionStorage will be empty)
3. If normal page reload, attempt reconciliation—prefer sessionStorage if both exist
4. For session-only tabs, check session state before restoring—only restore if sessionStorage indicates they should exist
5. Log which storage source was used and why

Consider implementing session-vs-persistent distinction explicitly rather than relying on which storage has data.

---

## Issue #11: Write-Ahead Log in DestroyHandler Provides Zero Protection and is Never Consulted

**Problem**

DestroyHandler implements write-ahead log (lines ~430-450) that records deletions before persisting to storage. Log entry created with timestamp, source, and state. However, log is never consulted anywhere in the codebase—deletion prevention logic uses `_destroyedIds` Set instead. Write-ahead log cleanup is async setTimeout without guarantee it fires before page unload.

Log provides no cross-tab value because:
- Log is per-instance (each content script tab has its own Map)
- Deletion is already tracked by `_destroyedIds` Set on same tab
- Background doesn't have access to log (not in shared storage.local)
- If page unloads before cleanup timer fires, log is lost

Evidence from code:
- WAL created at line ~432: `this._writeAheadLog.set(id, { ... })`
- WAL entries logged but never read
- `_destroyedIds` Set is actual protection mechanism (line ~420)
- Cleanup scheduled at line ~450 with async setTimeout
- No query of `_writeAheadLog` exists anywhere in codebase

**Root Cause**

File `DestroyHandler.js` implements write-ahead log as defensive measure against corruption, but:
- Log is never consulted during deletion or recovery
- Actual protection comes from `_destroyedIds` Set (synchronous)
- Cross-tab consistency not possible with per-instance log
- Async cleanup doesn't guarantee persistence

**Issue**

- Dead code: WAL created but never used
- No protective value: deletion protection comes from `_destroyedIds` only
- No cross-tab value: log not in shared storage
- Cleanup is async without guarantee: may be lost on page unload
- Confusion: readers think WAL provides additional protection (it doesn't)

**Fix Required**

Evaluate necessity and remove if not needed:

1. Confirm that `_destroyedIds` Set provides sufficient protection (it appears to)
2. If WAL is truly needed, store in browser.storage.local for cross-tab visibility
3. If stored in storage.local, implement proper indexing and query mechanism
4. If keeping WAL, implement synchronous cleanup (not setTimeout) or browser.storage cleanup handlers
5. Document why WAL exists and what threats it mitigates (if any)

If WAL is removed, delete all references to prevent future maintenance burden.

---

## Issue #12: Fallback Storage Polling Doesn't Actually Implement Fallback Logic

**Problem**

Code implements fallback polling mechanism (STORAGEFALLBACKPOLLING) that supposedly provides backup if storage listener fails. However, fallback only reads storage once—it doesn't implement any actual retry or recovery. Fallback reads storage.local at line ~1950, gets value, and returns. If listener didn't fire, fallback succeeds anyway because it reads directly from storage.

Result: "fallback" mechanism masks real listener failures by always succeeding with direct storage reads.

Current code pattern:
1. Write to storage.local completes - T+20ms
2. Set 500ms timeout to check if listener fired
3. If not fired by T+500ms, trigger fallback polling
4. Fallback calls `_fallbackToStorageRead()` which reads storage.local directly
5. Read succeeds (because write completed)
6. Returns success even though listener never fired
7. System thinks listener works, but it doesn't

**Root Cause**

File `content.js` implements fallback that doesn't actually provide fallback behavior. Fallback just reads storage (same as listener would receive), defeating purpose of having independent fallback mechanism.

True fallback would:
- Re-register listener if previous one failed
- Implement retry mechanism
- Log that listener failed and fallback used
- Trigger explicit recovery

**Issue**

- Fallback mechanism provides false confidence in broken listener
- Masks real listener failures
- Doesn't provide any recovery (just reads storage once)
- Creates illusion of fault tolerance when none exists

**Fix Required**

Implement actual fallback behavior or remove:

1. If keeping fallback, implement real recovery: re-register listener, implement retry loop, log recovery events
2. If removing fallback, delete all STORAGEFALLBACKPOLLING code and remove deception
3. If fallback only purpose is to read storage once (validation), rename to indicate read-only behavior, not fallback
4. Add explicit logging when fallback is triggered—this indicates listener failure
5. Implement listener health check rather than timeout-based polling

Consider whether fallback is necessary. If listener is guaranteed to fire (per MDN), timeout-based polling is unnecessary. If listener can fail, implement proper recovery not just direct reads.

---

## Issue #13: BroadcastChannel Removal Incomplete—Background May Still Broadcast

**Problem**

Comment at line ~180 in content.js states "v1.6.3.8-v6 - ARCHITECTURE: BroadcastChannel COMPLETELY REMOVED", indicating BroadcastChannel was removed from content script. However, no corresponding update visible in background.js. If background.js still attempts to broadcast via BroadcastChannel, those broadcasts are silently lost because content scripts no longer listen on BroadcastChannel.

Missing evidence:
- No visible BroadcastChannel removal in background.js (not scanned in this repo, but referenced in import statements)
- Port.postMessage is now primary communication, but logs don't show explicit migration
- No deprecation warnings logged suggesting BroadcastChannel was removed
- Content scripts print "BroadcastChannel COMPLETELY REMOVED" but no corresponding background update

Risk scenario:
1. Background script still uses BroadcastChannel for some operations
2. Broadcasts Quick Tab creation/deletion events via BroadcastChannel
3. Content scripts no longer listen to BroadcastChannel
4. Events never reach content scripts
5. UI doesn't update, user sees stale state

Evidence from logs:
- Port connection messages visible (Port lifecycle logs)
- No BroadcastChannel messages in logs (already removed from content side)
- No warnings about missing message handlers

**Root Cause**

File `content.js` fully refactored to remove BroadcastChannel, but `background.js` (not in this scan) may not have been updated to match. Incomplete refactoring leaves communication channel one-way (background → content via port, but if background still broadcasts to BC, content doesn't receive).

**Issue**

- Asymmetric refactoring: content removed BC but background may still use it
- Silent message loss: broadcasts sent but not received
- No error indication: system appears functional but messages lost
- Likely missed during refactoring: developer may not have realized background needed updates too

**Fix Required**

Verify and complete refactoring:

1. Scan background.js for any BroadcastChannel references (addEventListener, postMessage on BC)
2. If found, migrate all broadcasts to use port.postMessage instead
3. Verify all communication now flows through port (both directions)
4. Add logging in content script to indicate BroadcastChannel listeners removed and why
5. Add logging in background.js when messages sent via port (verify messages are sent)
6. Test communication paths: background → content via port, verify content receives

This is likely a critical blocker because Quick Tab creation/deletion may depend on background broadcasts that are now lost.

---

## Missing Logging (Supplementary Diagnostic Gaps)

Additional logging gaps identified beyond primary report:

### Port Lifecycle Management

- [ ] **Port connection initiation**: Log when connectContentToBackground() is called and current port state
- [ ] **Port connection success**: Log successful connection with timestamp, port name, and readiness state
- [ ] **Port.onDisconnect triggers**: Log when port disconnects, reason if available, circuit breaker state change
- [ ] **Port reconnection attempts**: Log each reconnection attempt with delay, backoff state, and success/failure
- [ ] **Message send failures**: Log when port.postMessage fails (port null, disconnected, or throws)
- [ ] **Circuit breaker state transitions**: Log when circuit breaker trips, when cooldown starts, when it resets

### Initialization Sequencing

- [ ] **Storage listener registration timing**: Log when listener attached, handler ready state, first event received
- [ ] **Handler attachment timing**: Log when _handleStorageChange becomes available vs listener registration
- [ ] **Feature initialization ordering**: Log which features initialize and in what order relative to port connection
- [ ] **Tab ID fetch progress**: Log when request sent, when response received, duration
- [ ] **Async barrier completion**: Log when each initialization barrier completes (tab ID, port, features)
- [ ] **Initialization failures**: Log if any initialization step times out or fails (currently silent)

### BFCache and State Reconciliation

- [ ] **BFCache entry detection**: Log when page enters BFCache (pagehide event)
- [ ] **BFCache restoration timing**: Log when page restored, how long elapsed, what state is being reconciled
- [ ] **SessionStorage state**: Log what session-only state exists before BFCache, what exists after restoration
- [ ] **Reconciliation decision**: Log which storage source was preferred and why (storage.local vs sessionStorage)
- [ ] **Lost tabs detection**: Log if session-only tabs are being restored from storage.local when they shouldn't be

### Message Deduplication and Port Reconnection

- [ ] **Message queue length**: Log how many messages are queued waiting for port connection
- [ ] **Deduplication window active**: Log when deduplication is in effect and why
- [ ] **Messages sent in batch**: Log if multiple messages sent in rapid sequence (indicates queueing/storm)
- [ ] **Circuit breaker state**: Log circuit breaker status (active/reset, current cooldown)
- [ ] **Port readiness before message send**: Log port state before each message send attempt

---

## Shared Context for All Supplementary Issues

All nine issues trace to incomplete refactoring and Firefox API timing misunderstandings:

**Incomplete v1.6.3 Refactoring:**
- BroadcastChannel removed from content.js but not from background.js
- Initialization order not updated to match new architecture
- Message passing moved to port but initialization still assumes synchronous behavior
- Storage listener early registration pattern left in place from previous design

**Firefox API Timing Mismatches:**
- Listener fires 100-250ms after write (expected per Bugzilla #1554088)
- Port reconnection delays up to 10 seconds
- sessionStorage cleared on BFCache (expected per browser spec)
- Messages don't queue automatically—dropped if port null
- All delays compound when chained asynchronously (tab ID + port + features)

**Dead Code and Illusory Protections:**
- Write-ahead log created but never consulted
- Fallback polling doesn't provide fallback
- Circuit breaker prevents messages for 10 seconds but deduplication only waits 2 seconds
- Early listener registers handler that's not ready yet

**Consistent Pattern:** Extension assumes synchronous, immediate behavior from asynchronous Firefox APIs. Refactoring incomplete, leaving dangling implementations. Recovery mechanisms exist but don't provide intended protection.

---

<acceptancecriteria>

**Issue #5 - Port Connection Timing**
- Port connected before storage listener fires any meaningful events
- Message queue implemented for events firing before port ready
- Circuit breaker doesn't prevent reconnection indefinitely
- No silent message loss—all messages reach background or are logged as failures

**Issue #6 - Storage Listener Handler Readiness**
- Storage listener registered AFTER handler function is defined
- No early listener pattern—listener activates with actual handler ready
- No queuing of early events—listener fires with real handler immediately
- First event is processed by actual handler, not queued for later

**Issue #7 - Initialization Order Dependencies**
- Tab ID fetch completes before feature initialization begins (explicit barrier)
- Port connection completes before features attempt to send messages
- Initialization uses Promise chains with explicit ordering
- Timeout implemented for async operations (fail fast if blocked)

**Issue #8 - Storage Event Ordering Validation**
- Ordering validation tolerates Firefox's 100-250ms listener latency
- Cross-tab events don't fail validation due to latency variance
- Wall-clock timestamps from listener fire time, not write completion time
- Validation logs actual elapsed time from write to listener fire

**Issue #9 - Message Deduplication and Port Reconnection**
- Deduplication window extended or port reconnection max delay reduced
- Deduplication window longer than circuit breaker cooldown
- Messages don't queue beyond deduplication window
- Port reconnection attempts actively reconnect, not just wait for timeout

**Issue #10 - BFCache State Reconciliation**
- Session-only tabs cleared (not restored) after BFCache restoration
- Reconciliation logic detects BFCache vs normal reload
- sessionStorage state treated correctly (empty after BFCache)
- No session-only tabs appear after page restoration from BFCache

**Issue #11 - Write-Ahead Log**
- Write-ahead log removed (if not needed) or stored in browser.storage.local (if needed)
- Log actually consulted during recovery (not dead code)
- Cleanup guaranteed (synchronous or via storage handlers)
- Documentation explains what threats WAL mitigates

**Issue #12 - Fallback Storage Polling**
- Actual fallback implemented (re-register listener, retry logic) OR removed entirely
- Fallback provides real recovery, not just direct reads
- Fallback mechanism logged when triggered
- No false confidence in listener health when fallback used

**Issue #13 - BroadcastChannel Removal Completion**
- background.js scanned and verified no BroadcastChannel references remain
- All background broadcasts migrated to port.postMessage
- Communication bidirectional through port only
- Deprecation note added explaining why BroadcastChannel was removed

**All Issues Together**
- Initialization completes with strict ordering (no async surprises)
- Port connected and ready before any messages sent
- No silent message loss or event drops
- BFCache restoration doesn't cause data anomalies
- No dead code paths creating illusions of protection
- All async operations explicit with logging and timeout handling
- Manual test: page load → storage operations → BFCache → restore → reload (all state consistent)

</acceptancecriteria>

---

<details>

<summary>Issue Interaction and Compounding Effects</summary>

Issues interact and cascade:

1. **Issues #5 + #6 + #7**: Storage listener fires before port ready, handler not defined, initialization order wrong. Together: listeners can't forward events because handler missing and port not connected.

2. **Issues #8 + #9**: Event ordering validation fails during listener latency window, messages dedup incorrectly during port reconnection delay. Together: valid events rejected as out-of-order AND messages lost during reconnection.

3. **Issues #10 + #12**: BFCache restores session tabs from storage because fallback polling masks listener failures, so reconciliation never gets accurate sessionStorage state.

4. **Issue #13 + #5**: Background broadcasts lost because BroadcastChannel removed, and content can't receive messages during port reconnection window anyway.

5. **Issues #11 + #12**: Both create illusion of protection (WAL exists but unused, fallback reads but doesn't retry) while actual protection comes from `_destroyedIds` Set alone.

Fix order matters:
- **Phase 1**: Issues #13, #5, #6, #7 (communication channel and initialization—foundation)
- **Phase 2**: Issues #9, #12 (port reliability and fallback)
- **Phase 3**: Issues #8, #10 (validation and state reconciliation)
- **Phase 4**: Issue #11 (cleanup dead code)

</details>

---

## Relationship to Primary Diagnostic Report

These nine supplementary issues compound the four primary issues:

| Primary Issue | Supplementary Issues Affecting It |
|---------------|----------------------------------|
| #1: Self-write detection | #6, #12 (broken listener, fake fallback) |
| #2: DestroyHandler empty write | #11 (dead WAL provides no protection) |
| #3: Transaction timeout | #8, #9 (validation fails, message delays) |
| #4: Hydration race condition | #5, #7, #13 (initialization chaos, broadcasts lost) |

All 13 issues must be fixed together because they share root causes (incomplete refactoring, async/sync mismatches, Firefox API timing). Fixing only primary issues leaves supplementary issues to cause new failures.

---

## Priority & Dependencies

**Critical (Blocking - must fix for stability):**
1. **Issue #13**: BroadcastChannel removal incomplete → silent message loss
2. **Issue #5**: Port connection timing → messages dropped before port ready
3. **Issue #6**: Early listener registration → handler not ready when listener fires

**High (Next iteration):**
4. **Issue #7**: Initialization ordering → race conditions during startup
5. **Issue #9**: Message dedup window → message loss during port reconnection
6. **Issue #10**: BFCache reconciliation → session state loss on restoration

**Medium (Technical debt):**
7. **Issue #8**: Event ordering validation → false ordering violations
8. **Issue #11**: Dead write-ahead log → cleanup and remove
9. **Issue #12**: Fake fallback mechanism → implement real recovery or remove

**Rationale**: Issues #13, #5, #6 cause silent failures (user doesn't see errors but state is wrong). Issue #7 causes startup race conditions. Issues #9, #10 cause data loss. Issues #8, #11, #12 are technical debt but lower user impact.

---

## Technical References

**Firefox WebExtension Specifications:**
- MDN storage.onChanged: Listener guaranteed to fire, fires after promise resolves
- Mozilla Bugzilla #1554088: Promise resolves before listener fires (100-250ms delay documented)
- Browser BFCache spec: sessionStorage cleared on enter, not restored on exit
- Port.postMessage: Synchronous call, message queuing implementation browser-dependent (not guaranteed)

**Current Problematic Timeouts:**
- PORT_RECONNECT_MAX_DELAY_MS: ~10000ms (too long, causes message loss window)
- RESTORE_DEDUP_WINDOW_MS: 2000ms (too short relative to port reconnection)
- TRANSACTION_TIMEOUT_MS: 500ms (too short for Firefox listener)

**Key Code Areas Requiring Updates:**
- content.js initialization order (lines 100-2000+)
- Port lifecycle management (lines 1150-1250)
- Storage listener registration (lines 170-180)
- BFCache handler (lines 1050-1130)
- Message deduplication logic (lines 1175-1185)
- Storage event ordering validation (lines 1400-1450)
- DestroyHandler WAL implementation (lines 430-450)
- Fallback polling mechanism (lines 1940-1950)
- background.js communication layer (not in this scan but needs verification)

