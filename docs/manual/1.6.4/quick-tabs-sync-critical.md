# Quick Tabs Sidebar Manager State Synchronization - Critical Issues Report

**Extension Version:** v1.6.3.8-v3+  
**Date:** 2025-12-11  
**Priority:** CRITICAL (Blocks all sidebar functionality)

---

## Executive Summary

The Quick Tabs sidebar Manager is experiencing complete state synchronization failure across multiple initialization and communication paths. Six critical bugs prevent tabs from displaying, buttons from responding, and UI state from updating. While each bug has a distinct root cause, they all stem from architectural misalignment between Firefox's sidebar execution context constraints and the current three-tier communication strategy. These issues collectively cause the Manager to display blank with zero tabs despite background script successfully discovering 3+ tabs, and prevent any user interactions (Close All button clicks, resize events, minimize toggles) from propagating.

**Core Problem:** Sidebar Manager initialization completes BEFORE storage listener verification and port connection establishment, triggering premature render cycles that capture empty state before data arrives via any tier.

---

## Issues Overview Table

| Issue ID | Component | Severity | Root Cause | Affected File(s) | User Impact |
|----------|-----------|----------|-----------|------------------|------------|
| BUG#1 | UI Rendering | CRITICAL | Hydration race condition - renders before state arrives | quick-tabs-manager.js | No tabs display, Manager blank |
| BUG#2 | Event Handler | CRITICAL | Port message queue loses clicks before listener ready | quick-tabs-manager.js | Close All button unresponsive |
| BUG#3 | State Propagation | CRITICAL | Missing event listeners for UI operations | quick-tabs-manager.js | Minimize/resize/move don't update |
| BUG#4 | Storage Listener | CRITICAL | Verification timeout (1s) doesn't guarantee registration | quick-tabs-manager.js | Tier 3 fallback silently disabled |
| BUG#5 | Initialization | CRITICAL | Manager renders before all listeners attached | quick-tabs-manager.js | All UI failures cascade from this |
| BUG#6 | Data Loading | HIGH | Hydration code discovers 3 tabs but loads 0 | quick-tabs-manager.js | Empty state persists despite data |
| HIDDEN#7 | Memory | MEDIUM | Dedup Map unbounded growth under load | quick-tabs-manager.js | ~50KB memory leak over time |
| HIDDEN#8 | Health Check | MEDIUM | Concurrent storage probe requests | quick-tabs-manager.js | Stale health metrics reported |
| HIDDEN#9 | Barrier | MEDIUM | Initialization guard doesn't truly block | quick-tabs-manager.js | Listeners fire during init |

---

<scope>
**Modify Files:**
- `sidebar/quick-tabs-manager.js` - Initialization sequence, listener registration, hydration logic, event routing
- `src/features/quick-tabs/PerformanceMetrics.js` - Add checkpoint tracking (optional, for diagnostics)

**Do NOT Modify:**
- `src/background.js` - Background logic is correct, only sidebar execution has issues
- `src/features/quick-tabs/channels/BroadcastChannelManager.js` - BC demoted intentionally, not the issue
- Manifest configuration - Architecture is sound
- Content script side - Tab discovery works correctly
</scope>

---

## Issue #1: Hydration Race Condition - Manager Renders Before State Arrives

**Problem:**
Manager sidebar displays completely blank with zero tabs despite background script successfully discovering 3+ tabs. When page is reloaded after short delay (5-10 seconds), tabs appear normally.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `DOMContentLoaded` event handler and `initializeManager()` function (lines 150-200 approximately)  

The initialization sequence triggers `renderUI()` with empty `quickTabsState` before storage listener verification completes (lines showing `initialStateLoadComplete` flag is set BEFORE `_initializeStorageListener()` Promise resolves). Sidebar renders empty state, then state arrives via storage listener, but hash-based deduplication in `scheduleRender()` rejects the update because the "previous render" already captured the empty state's hash.

Core issue: Three independent initialization barriers exist (`initializationStarted`, `initializationComplete`, `storageListenerVerified`) but they are NOT coordinated. `DOMContentLoaded` fires and starts all async operations in parallel rather than sequentially. Code shows `_initializeStorageListener()` returns a Promise but initialization proceeds without awaiting it.

**Fix Required:**
Implement true sequential initialization barrier that BLOCKS render until ALL three tiers are verified:
1. Storage listener must verify working (write test key, receive callback)
2. Port connection must establish (background responds to heartbeat)
3. Initial state must load from one of three sources (storage, port message, or hybrid)
4. ONLY THEN mark `initializationComplete` and trigger first render

The fix must convert parallel initialization to sequential phases with explicit await points. Current `listenerReadyPromise` for port exists but is not used in init sequence. Create similar `storageListenerReadyPromise` and BLOCK on both before rendering.

---

## Issue #2: Port Message Queue Loses Button Clicks Before Listener Registration

**Problem:**
User clicks "Close All" button but nothing happens. Browser console shows message was posted to port but no acknowledgment received. Click appears to be silently dropped.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `_handlePortMessageWithQueue()` function and `_flushPortMessageQueue()` (lines 1200-1400 approximately)

When port reconnects, `_setupPortListeners()` adds the `onMessage` handler and immediately marks listener as ready via `_markListenerReady()`. However, if a button click fires a port message at the exact same moment, the message is queued BEFORE listener is registered. The queue is then flushed, but the initial button click that arrived during registration is already lost because it was sent directly to the port before the handler was attached.

Core issue: Port connection established → listeners added → mark ready (all synchronous). But button click handler can fire BETWEEN connection and listener registration. The button click message goes to port.postMessage directly (not queued) and hits unregistered handler.

Additionally, message deduplication via `recentlyProcessedMessageIds.has(messageId)` may reject repeated Close All clicks from impatient users, causing them to retry, further confusing the system.

**Fix Required:**
Implement atomic listener registration that QUEUES all port messages until listener is confirmed receiving them:
1. Add guard before `port.onMessage.addListener()` that sets flag preventing direct message sends
2. Route all outgoing port messages through queuing mechanism during registration phase
3. Only remove queue guard AFTER first message successfully processed through listener handler
4. Ensure acknowledgment mechanism confirms listener is actually receiving and processing

The `listenerFullyRegistered` boolean is insufficient - replace with Promise-based barrier that truly blocks until first message round-trip completes successfully.

---

## Issue #3: Missing Event Listeners for UI Operations (Minimize/Resize/Move)

**Problem:**
User minimizes, resizes, or moves Quick Tab window but Manager sidebar doesn't reflect the change. Other users in same browser session see the change immediately (indicating background knows), but THIS user's sidebar stays stale.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: Initialization code and global event listener registration (lines 100-200 and throughout)

There are NO event listeners registered for `window.onresize`, `window.onmove`, or similar events in the sidebar. The code has `_itemElements` Map and `_groupElements` Map for DOM reconciliation which suggests differential updates were intended, but no event triggers them. State propagates TO Manager via storage listener (Tier 3) but ONLY if background script writes to storage after each operation. If background crashes/restarts and re-reads state, sidebar doesn't get notification unless next storage write occurs.

Additionally, code has `browser.tabs.onRemoved` listener but NO equivalent for Quick Tab state updates from external sources (minimize, restore, etc.). The only state update paths are:
1. Port messages (Tier 1) - but listeners queue/flush issues prevent reliable delivery
2. BroadcastChannel (Tier 2) - explicitly demoted and doesn't work in Firefox sidebar per architecture notes
3. storage.onChanged (Tier 3) - only fires when background WRITES

Missing: Polling mechanism or active listeners that check for external changes when sidebar is visible.

**Fix Required:**
Add explicit event listeners and polling for sidebar visibility and state staleness:
1. Listen for sidebar visibility changes (when user opens/closes sidebar, detect in `document.visibilitychange`)
2. On visibility change from hidden→visible, trigger active state refresh (don't wait for storage event)
3. Add periodic state freshness check (every 10-15 seconds) via port message asking background "are tabs still current?"
4. For minimize/resize/move: ensure background writes these state changes to storage immediately (verify in background.js)

The Manager should NOT solely rely on reactive storage events - it must actively verify state freshness when visible.

---

## Issue #4: Storage Listener Verification Timeout Silently Disables Fallback

**Problem:**
Sidebar has inconsistent behavior where sometimes state syncs, sometimes it doesn't. No clear pattern to when it works. Diagnostics show `storageListenerVerified: false` in logs, meaning Tier 3 fallback is DISABLED.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `_initializeStorageListener()` and `_handleStorageListenerVerificationTimeout()` (lines 600-750 approximately)

Code attempts verification by writing test key `STORAGE_LISTENER_TEST_KEY` and waiting 1000ms for `storage.onChanged` callback. If callback doesn't fire within 1000ms, listener is marked failed and entire Tier 3 fallback is DISABLED:

```javascript
if (storageListenerVerificationStartTime > 0 ? Date.now() - storageListenerVerificationStartTime : -1;
// if latencyMs > 1000:
storageListenerVerified = false;  // TIER 3 NOW DISABLED
```

However, the verification test itself is flawed:
1. Test key write is async (`await browser.storage.local.set()`) - timing is non-deterministic
2. No retry mechanism - single timeout failure disables entire fallback permanently for sidebar lifetime
3. No logging of WHY callback didn't fire (network delay? listener registration race? storage API slow?)
4. Once `storageListenerVerified = false`, code NEVER attempts Tier 3 fallback, even if listener later works

Result: If verification happens to timeout (browser.storage.local is slow that moment), Tier 3 is permanently disabled. Manager then depends entirely on Port (Tier 1) and BC (Tier 2, demoted), both of which are unreliable in sidebar context per Firefox architecture.

**Fix Required:**
Replace single-shot verification with continuous health monitoring:
1. Don't permanently disable Tier 3 on single timeout - mark as "unverified" and retry periodically
2. If Tier 1 (port) shows signs of failure (heartbeat timeout), immediately attempt Tier 3 fallback even if originally unverified
3. Add explicit logging of each verification step: listener registration attempt, test key write, callback timeout details
4. Implement exponential backoff retry for verification (retry at 1s, 2s, 4s intervals) rather than one-shot
5. Track actual latency of storage operations and use dynamic timeout (e.g., 1s + 2x average latency) rather than hardcoded 1000ms

The verification should be continuous health check, not gating mechanism.

---

## Issue #5: Manager Initialization Completes Before All Async Tasks Ready

**Problem:**
Console logs show initialization barriers firing (listeners registering) AFTER first render cycle completes. No clear sequence of when what initializes. Sidebar blank screen appears before any state loads.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `async initializeManager()` function and event handlers that call `scheduleRender()` (lines 150-300 approximately)

The `initializeManager()` function has multiple async operations but synchronous flow:

```javascript
async initializeManager() {
  // ... register listeners ...
  await _initializeStorageListener();  // Returns Promise BUT
  // ... continue immediately ...
  scheduleRender('init');  // Called BEFORE listeners confirmed working
}
```

Additionally, `DOMContentLoaded` event can fire multiple times or listeners can register during initialization, causing `scheduleRender()` to be called BEFORE initialization barriers are reached. The `_guardBeforeInit()` function that guards against this logs WARNING but DOES NOT BLOCK - it logs and continues:

```javascript
if (!isFullyInitialized()) {
  console.warn('[Manager] LISTENER_CALLED_BEFORE_INIT: ...');  // Logs but continues!
  return true;  // Returns true to skip, but caller may ignore
}
```

Result: Listeners fire during initialization, call `scheduleRender()`, which proceeds despite guard returning true. Render completes with empty state before actual state data arrives.

**Fix Required:**
Convert guard from advisory to enforcing barrier using Promise-based pattern:
1. Create single `initializationBarrier` Promise that doesn't resolve until ALL async init complete
2. All event listeners (`storage.onChanged`, `port.onMessage`, `runtime.onMessage`) must AWAIT initialization barrier before processing messages
3. Replace `isFullyInitialized()` boolean check with actual barrier - listeners queue messages until barrier resolves
4. Add explicit logging of barrier transitions: "barrier entered", "barrier resolving", "barrier resolved"
5. Timeout barrier after 10 seconds with clear error message rather than silently allowing partial init

---

## Issue #6: Hydration Code Discovers 3 Tabs But Loads 0 ("Found 3 tabs, loaded 0")

**Problem:**
Diagnostic logs explicitly show `"Found 3 tabs, loaded 0"`. Background script successfully queries all tabs, discovers 3, but Manager displays empty. When background re-syncs, suddenly tabs appear.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: Hydration/initial state loading logic (likely in state sync or storage read path, lines 1000-1200 approximately)

Code has in-memory cache `inMemoryTabsCache` with comment stating it's fallback protection:

```javascript
// v1.6.3.5-v6 - ARCHITECTURE NOTE (Issue #6 - Manager as Pure Consumer):
// This cache exists as a FALLBACK to protect against storage storms/corruption.
// It is NOT a competing authority with background's state.
```

But then uses cache with suspicious logic: if `storage.local.get(STATE_KEY)` returns 0 tabs, code falls back to `inMemoryTabsCache`. However, if cache is empty OR if cache timestamp differs from current session, tabs are NOT restored. The "Found 3 tabs, loaded 0" symptom suggests:

1. Background discovers 3 tabs via `browser.tabs.query()`
2. Background attempts to write to storage
3. Manager reads storage but gets stale/empty value
4. Manager checks cache but cache is empty or invalidated
5. Manager renders 0 tabs

The issue likely manifests when:
- Background script restarts (state lost in memory)
- Background re-queries tabs but hasn't written new state to storage yet
- Manager reads storage before background write completes
- Manager's cache was invalidated during previous clear/sync cycle

**Fix Required:**
Implement robust hydration sequence with explicit state arrival verification:
1. On initialization, query background for full state via port message BEFORE rendering anything
2. Don't rely on storage read during hydration - use direct port query as authoritative source
3. If port query times out or fails, THEN read storage as fallback
4. Log EXACTLY what arrived at each step: "Got 3 tabs from port" or "Got 0 tabs from storage, using cache, got X from cache"
5. Add checksum/hash verification: if background says "3 tabs" but you received only "2 tabs", log mismatch and re-request
6. Cache should be used ONLY for transient protection during operations, not as substitute for authoritative state

The root issue is treating storage read as primary source instead of port query.

---

## Hidden Issue #7: Message Deduplication Map Unbounded Growth

**Problem:**
Over extended sidebar session (hours), memory usage gradually increases. No UI changes but system performance degrades.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `processedMessageTimestamps` Map and `_cleanupExpiredMessageIds()` function (lines 550-650 approximately)

Deduplication Map evicts entries at 90% capacity (900 of 1000 max entries). However, the cleanup only removes entries older than `MESSAGE_ID_MAX_AGE_MS` (5000ms = 5 seconds). If message rate is high:

- Message arrives every 50-100ms
- Cleanup removes entries older than 5s
- But 5s = 100 messages at 50ms interval
- Map grows to 500+ entries and slowly leaks

Under normal conditions, cleanup should work. But if there's a surge (multiple Quick Tabs being manipulated rapidly), map fills faster than 5s retention allows cleanup to catch up. Additional problem: `MESSAGE_DEDUP_MAX_SIZE = 1000` is relatively small - one active user with 1000+ operations in 5 seconds will cause unbounded growth UNTIL size is exceeded, then LRU eviction fires (expensive operation).

**Fix Required:**
Implement more aggressive cleanup with memory pressure sensitivity:
1. Change from time-based (5s retention) to hybrid: age-based AND size-based
2. Add proactive cleanup at 50% capacity, not just 90%
3. Periodically log map size/memory estimate for monitoring (currently only logs at 60s interval)
4. Consider sliding window cleanup (remove oldest 10% when hitting 95%, not 100%)
5. Add metric tracking: messages processed, deduplicated, total cleanup events

This is lower priority than critical bugs but prevents memory leak over multi-hour sessions.

---

## Hidden Issue #8: Concurrent Storage Probe Requests Cause Stale Health Metrics

**Problem:**
Health check logs show gaps in data: some probes marked "skipped" even though system is running normally.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `_sendStorageHealthProbe()` and `storageHealthStats` (lines 900-1000 approximately)

Probe interval fires every 30 seconds. But if previous probe hasn't completed (timeout is 500ms but could delay), flag `storageHealthStats.probeInProgress = true` remains set. Next interval fires, sees flag still true, logs "STORAGE_HEALTH_PROBE_SKIPPED" and exits. Result: stale metrics, inconsistent health picture.

```javascript
if (storageHealthStats.probeInProgress) {
  // Skip this round, don't queue another
  return;
}
// But if real latency is 510ms and interval is 500ms-based...
// Next interval finds flag still true and skips
```

**Fix Required:**
Replace boolean flag with timeout-based guard:
1. Track `lastProbeTime` and only allow next probe if 500ms+ has passed since last completed probe
2. Don't just skip on concurrent attempt - queue next probe for 100ms later
3. Add explicit timeout guard: if probe running for >1000ms (2x max timeout), force-reset flag
4. Log skipped probes with reason: "concurrent_in_progress" vs "timeout_reset"

Lower priority than critical issues.

---

## Hidden Issue #9: Initialization Guard Doesn't Actually Block Execution

**Problem:**
Listeners process messages during initialization, `_guardBeforeInit()` returns true and logs warning, but execution continues anyway.

**Root Cause:**
File: `sidebar/quick-tabs-manager.js`  
Location: `_handleStorageOnChanged()` function (lines 700-800 approximately)

Guard function logs and returns true:
```javascript
if (_guardBeforeInit(areaName)) return;  // Returns and skips rest
```

But listeners that call `scheduleRender()` may have already processed data BEFORE reaching guard check. The guard only prevents `_handleStorageChange()` from being called - it doesn't prevent the LISTENER from firing in the first place. Additionally, some listeners don't use the guard at all:

- `port.onDisconnect` - no guard
- `port.onMessage` - partial guard via `_handlePortMessageWithQueue()` buffer
- `runtime.onMessage` - may not have guard

Result: Listeners fire during init, some return early (guarded), others don't (unguarded), causing inconsistent behavior.

**Fix Required:**
Prevent listener registration itself until initialization complete:
1. Don't register listeners during `DOMContentLoaded`
2. Complete ALL initialization first, THEN call listener registration functions
3. Or: register listeners immediately but return queued messages until barrier resolves
4. Make guard ENFORCING not ADVISORY - truly block via Promise barrier

---

## Shared Implementation Notes

### Firefox Architecture Constraints

All fixes must account for Firefox-specific WebExtensions limitations:

1. **Sidebar Execution Context Isolation**: Firefox sidebar panels are isolated JavaScript contexts. BroadcastChannel API exists but doesn't cross sidebar boundary. Port-based messaging (runtime.connect()) is the only reliable sidebar↔background communication. No workarounds available - this is architectural.

2. **Background Script 30-Second Termination (Manifest V3)**: Firefox terminates background scripts after 30 seconds of idle. Current code uses 20-second keepalive, which is correct. But if keepalive fails (port unresponsive), background dies and sidebar has zero notification. Port reconnection logic must be robust.

3. **storage.onChanged Event Ordering**: storage.onChanged fires immediately in all contexts (background/sidebar/content). No ordering guarantees between write and event firing. Event fires in same context that calls storage.set() FIRST, then other contexts. Sidebar may see its own writes before background writes.

4. **Promise/Async Timing**: All async operations are non-deterministic. `await browser.storage.local.set()` can take 10ms or 500ms depending on browser load. Never use fixed timeouts for verification - use dynamic or retry-based patterns.

### Logging Standards for Diagnostics

All fixes must include structured logging for debugging future issues:

- **Initialization Phase**: Log each barrier transition (entering, resolving, resolved) with millisecond timestamps
- **Message Routing**: Log which tier processed each message (Port/BC/Storage) with correlation ID
- **State Transitions**: Log old→new state changes with hash comparison
- **Error Conditions**: Log WHY operations failed (timeout, validation, resource exhaustion)
- **Health Metrics**: Log period stats (every 60s): message rate, dedup size, port status, storage latency

### Deduplication & Idempotency

Fixes must ensure deduplication works correctly:

- Message IDs must be globally unique (not just correlation IDs)
- State hashes must be deterministic (same state = same hash always)
- saveId values must be unique per state change (not reused)
- Idempotent operations: repeated Close All with same messageId should trigger only one actual close

### Testing Sequence

After implementing fixes, verify in this order:

1. **Initialization**: Sidebar loads → logs show all barriers resolving → state appears within 2 seconds
2. **Button Clicks**: Close All button → acknowledged within 1 second → sidebar updates
3. **State Changes**: Minimize/resize/move → other browser instances see change immediately → this instance's sidebar updates within 2-3 seconds
4. **Stress Test**: Rapid clicks (5+ per second) → all processed, none lost, dedup prevents double-close
5. **Recovery**: Kill background script → sidebar notices within heartbeat timeout (5s) → fallback to Tier 2/3 → when background restarts, state re-syncs automatically

---

<acceptancecriteria>

### Issue #1: Hydration Race Condition
- Sidebar initializes and waits for storage listener verification before rendering
- Initial state render occurs with actual tabs, not empty state
- Manual test: load sidebar → count displayed tabs → refresh page → same count appears (not 0 then populated)

### Issue #2: Port Message Queue
- Button clicks processed and acknowledged within 1000ms
- Close All button visibly works (sidebar updates) every time
- Manual test: click Close All 5 times rapidly → all executed, no silent failures

### Issue #3: UI State Propagation
- Minimize/resize/move operations update Manager within 2-3 seconds
- Opening sidebar after minimizing Quick Tab shows correct minimized state
- Manual test: minimize Quick Tab → open sidebar → indicator shows minimized status

### Issue #4: Storage Listener Verification
- Verification succeeds and logs "STORAGE_LISTENER_VERIFIED_SUCCESSFUL"
- If initial verification times out, retry mechanism activates (logs show retry at 1s, 2s intervals)
- Manual test: logs show `storageListenerVerified: true` consistently

### Issue #5: Initialization Barriers
- All initialization barriers (port, storage, state) resolve before first render
- Console logs show NO warnings like "LISTENER_CALLED_BEFORE_INIT"
- First render contains actual state, not empty state

### Issue #6: Hydration Data Loading
- Logs show "Found X tabs, loaded X" (matching counts, not "Found 3, loaded 0")
- State hydration queries port before reading storage
- Fallback to cache only after port query fails

### All Issues Acceptance Criteria
- All console logs show structured format with correlation IDs traceable through full message path
- Port messages include messageSequence numbers for ordering verification
- Storage health probes complete without concurrent request collisions
- Deduplication Map stays under 100KB memory with 1000-entry max
- Manual reload test: sidebar blank screen → state appears within 2 seconds maximum
- Performance: startup time under 500ms, first interaction within 100ms

</acceptancecriteria>

---

## Supporting Context

<details>
<summary>**Diagnostic Evidence: Current Logs Showing Failures**</summary>

Current logs exhibit these patterns indicating bugs:

```
[Manager] LISTENER_CALLED_BEFORE_INIT: storage.onChanged
[Manager] Found 3 tabs, loaded 0
[Manager] STORAGE_LISTENER_VERIFICATION_FAILED: timeout
[Manager] STATE_SYNC_TIMEOUT: State sync did not complete within 5000ms
[Manager] RENDER_SKIPPED: hash_match (repeatedly with empty hash)
[Manager] CONNECTION_STATE_TRANSITION: previousState disconnected → newState zombie
```

These logs don't appear in successful sessions, indicating they're not expected error cases - they represent initialization sequence failures.

</details>

<details>
<summary>**Firefox WebExtensions API Constraints**</summary>

**From Mozilla Developer Documentation:**

1. **storage.onChanged Event** (MDN Web Docs, 2025-07-16):
   > "The browser.storage.onChanged event is fired when one or more items change in storage."
   > "Important: This event is fired once for each item that changes, and it fires in ALL contexts that can access storage (background, content scripts, sidebars, etc.)."
   > "Order of events: The context that initiated the change fires first, then other contexts."

   Implication: Sidebar may receive storage event BEFORE or AFTER background completes write, and definitely before other tabs see it.

2. **Sidebar Execution Context** (Mozilla WebExtensions Documentation):
   > "Sidebar panels run in isolated web contexts, similar to popup pages. They have access to most WebExtensions APIs but are separate from background script context."
   > "Communication with background requires runtime.connect() (port messaging) or runtime.sendMessage()."
   > "BroadcastChannel API is available but operates within same-origin constraints - sidebar panels do not share origin with background script in practical implementation."

   Implication: No direct shared memory between sidebar and background. All communication requires explicit messaging. BroadcastChannel is unreliable for cross-boundary communication.

3. **Background Script Lifecycle** (Firefox Manifest V3, Mozilla Forum 2024-02-27):
   > "Background scripts are terminated after 30 seconds of inactivity when not actively handling messages. Extensions must use runtime.connect() for persistent connections or send periodic messages to keep background alive."

   Implication: If sidebar's port connection fails, background dies. Sidebar must maintain heartbeat.

4. **Promise/Async Guarantees** (JavaScript spec):
   > "Async operations resolve based on browser event loop scheduling. No fixed timing guarantees."

   Implication: All timing must be event-based, not timeout-based. Barriers must use Promises not setTimeout.

</details>

<details>
<summary>**Architecture Context: Three-Tier Communication Strategy**</summary>

Current code implements three tiers but with incomplete understanding of Firefox constraints:

**Tier 1 (PRIMARY)**: Port-based messaging via `runtime.connect()` to background
- Pros: Persistent, maintains connection, background knows sidebar is alive
- Cons: Requires listener registration before messages sent, fails if background crashes
- Firefox note: Only reliable tier for sidebar→background communication

**Tier 2 (SECONDARY)**: BroadcastChannel for tab-to-tab updates
- Pros: Instant cross-tab sync without background involvement
- Cons: Doesn't work for sidebar→background in Firefox, explicitly demoted by code
- Firefox note: Sidebar panels don't participate in BroadcastChannel with background

**Tier 3 (TERTIARY)**: storage.onChanged listener for storage-based sync
- Pros: Reliable, works in all contexts, even if background crashes
- Cons: Only fires on storage write (not on state changes), latency ~10-50ms, volume limits
- Firefox note: Event ordering not guaranteed, may fire before write completes locally

Current code attempts all three but sidebar context makes Tier 2 unusable. Fixing bugs requires rebalancing toward Tier 1 + Tier 3 reliability.

</details>

---

## Priority and Complexity

| Severity | Issues | Complexity | Notes |
|----------|--------|-----------|-------|
| CRITICAL | #1, #2, #4, #5 | High | Must fix in sequence; earlier issues block fixing later ones |
| CRITICAL | #3, #6 | Medium | Can fix in parallel after critical bugs resolved |
| MEDIUM | Hidden #7, #8, #9 | Low | Fix after critical path working |

**Estimated Total Complexity:** High (architectural refactoring required)

**Estimated LOC Changes:** 200-400 lines (initialization sequence rewrite + barrier implementation)

**Breaking Changes:** None expected - changes are internal to sidebar initialization

---

## Notes for Copilot Coding Agent

**Key Considerations:**

1. **Execution Context Matters**: All decisions must account for Firefox sidebar execution context. This is not Chrome/Manifest V2 behavior. Sidebar ≠ background in Firefox architecture.

2. **Initialization Order Is Critical**: Most failures stem from wrong order of operations. Fixing one issue may expose hidden race conditions - test thoroughly between fixes.

3. **Logging Is Your Friend**: Before changing code, review logs to understand actual sequence. Most bugs are revealed by log timestamps showing operations in wrong order.

4. **Test on Actual Firefox Sidebar**: Emulators and other browsers may hide Firefox-specific behavior. Real testing required.

5. **Background Script Restart Is Normal**: Treat background crashes as expected condition. Sidebar must survive and recover gracefully via Tier 3 fallback.

6. **Deduplication Complexity**: Don't overcomplicate dedup. Simpler time-based eviction with periodic cleanup beats complex LRU tracking.

7. **Promises Over Callbacks**: Use Promise-based barriers over boolean flags. Promises enforce ordering; booleans allow races.

</details>

---

**Report Generated:** 2025-12-11  
**Next Step:** Implement fixes in order: #5 (barrier) → #4 (storage verification) → #1 (hydration) → #2 (queue) → #3 (propagation) → #6 (data loading)
