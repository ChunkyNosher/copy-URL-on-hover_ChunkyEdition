# Quick Tabs: Additional Critical Issues & Missing Logging

**Extension Version:** v1.6.4.15 | **Date:** 2025-12-10 | **Scope:** Storage
ordering race conditions, message coalescing, IndexedDB corruption, and
initialization synchronization failures not covered in primary issues document

---

## Executive Summary

Beyond the five documented issues (Firefox idle timeout, logging consolidation,
fragmented deduplication, port registry age, and storage race cooldown), the
codebase has six additional critical problems affecting reliability and data
persistence. These issues exist at the intersection of multiple systems (storage
events, BroadcastChannel, port messaging, initialization) and share a common
root: insufficient coordination and missing validation between asynchronous
operations. All stem from assumptions about event ordering and message delivery
that WebExtension APIs do NOT guarantee.

## Issues Overview

| Issue                                      | Component                                        | Severity | Root Cause                                                                             |
| ------------------------------------------ | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| #6: Storage.onChanged ordering race        | background.js, sidebar/quick-tabs-manager.js     | Critical | Browser provides no ordering guarantees between sequential storage.set() calls         |
| #7: BroadcastChannel message coalescing    | BroadcastChannelManager.js                       | High     | Background tabs throttle BroadcastChannel messages; rapid posts lose updates           |
| #8: IndexedDB corruption unhandled         | background.js (storage layer)                    | Critical | Firefox Bug 1979997 causes silent data corruption; no recovery mechanism               |
| #9: Port message ordering not guaranteed   | sidebar/quick-tabs-manager.js, background.js     | High     | Runtime.Port provides no serialization guarantees between rapid postMessage() calls    |
| #10: Tab affinity map desynchronization    | sidebar/quick-tabs-manager.js (quickTabHostInfo) | Medium   | Map entries accumulate indefinitely for closed tabs; no TTL or cleanup                 |
| #11: Initialization race between listeners | background.js, sidebar/quick-tabs-manager.js     | High     | storage.onChanged fires before initializeGlobalState completes; handlers fail silently |

**Why bundled:** All affect core state persistence and synchronization; all have
non-obvious root causes in browser API semantics; all require architectural
changes rather than simple fixes; fixing one affects approach to others.

<scope>
**Modify:**
- `background.js` (initialization sequence, storage write coordination, error handling)
- `sidebar/quick-tabs-manager.js` (listener registration timing, quickTabHostInfo cleanup)
- `src/features/quick-tabs/channels/BroadcastChannelManager.js` (backpressure, message loss detection)
- `src/background/handlers/QuickTabHandler.js` (storage validation, corruption detection)

**Do NOT Modify:**

- Port connection setup (working correctly)
- BroadcastChannel API usage (browser-level constraint)
- Deduplication methods (addressed in Issue #3 of primary document)
- DOM rendering (not affected by these issues) </scope>

---

## Issue #6: Storage.onChanged Event Ordering - No Guarantees Between Sequential Writes

### Problem

When background script performs sequential storage writes (create → minimize →
update), the Manager's storage.onChanged listener may receive events OUT OF
ORDER. This causes Manager UI to show stale state, with tabs appearing in wrong
order or with incorrect properties.

### Root Cause

**Files:** `background.js` (lines 1850-1900, saveStateToStorage),
`sidebar/quick-tabs-manager.js` (lines 2400-2450, storage.onChanged listener)  
**Issue:** The browser does NOT guarantee that storage.onChanged events fire in
the same order as storage.set() calls, nor that subsequent calls are ordered
relative to previous ones. MDN and Firefox source code explicitly document this
as "asynchronous with eventual consistency, not ordering guaranteed."

The extension assumes sequential writes generate ordered events:

1. Create tab → writeSourceId-001 → storage.onChanged fires
2. Minimize tab → writeSourceId-002 → storage.onChanged fires
3. Update position → writeSourceId-003 → storage.onChanged fires

But browser may fire these events as: 1, 3, 2 or 3, 1, 2. Manager's cache then
applies updates in wrong sequence, resulting in final state that diverges from
what background actually saved.

The `lastWriteTimestamp` tracking (background.js line 1890) attempts to detect
self-writes but doesn't prevent out-of-order application of DIFFERENT write
sources.

### Specific Problem Areas

- Line 1870-1880 (background.js): `saveStateToStorage()` writes to storage but
  has NO ordering guarantees
- Line 2400-2450 (sidebar/quick-tabs-manager.js): `storage.onChanged` listener
  processes events immediately without sequence validation
- No "generation number" or "sequence ID" in saved state to detect out-of-order
  application
- No "expected update" tracking to detect missing intermediate events
- The SAVEID field exists (for deduplication) but is NOT used for ordering
  validation

### Fix Required

Implement event ordering validation using immutable sequence identifiers. Add a
`sequenceId` counter (incremented per storage write) to state object. When
storage.onChanged fires, check if new sequenceId > lastAppliedSequenceId; if
not, log warning and reject update (or queue for later application). This
ensures only forward-moving state updates are applied.

Additionally, implement a watchdog timer: if no storage.onChanged fires within 2
seconds after a storage.set() call, assume event may be lost and explicitly
re-read from storage to verify state consistency.

---

## Issue #7: BroadcastChannel Message Coalescing Under Load - Silent Message Loss

### Problem

When background script rapidly posts updates via BroadcastChannel (5+ messages
in <500ms), some messages are silently dropped entirely. Manager never receives
them, creating permanent state divergence. This happens specifically when
Manager sidebar is in a background tab (inactive window).

### Root Cause

**Files:** `src/features/quick-tabs/channels/BroadcastChannelManager.js` (lines
200-250, postMessage), `sidebar/quick-tabs-manager.js` (lines 1400-1450,
handleBroadcastChannelMessage)  
**Issue:** BroadcastChannel has implicit throttling in background/inactive tabs:

- Chrome: Well-documented 1 message per 1000ms minimum in background tabs
- Firefox: NOT documented, but exhibits similar behavior in practice (observed
  during testing)
- The backpressure protection added in v1.6.4.15 (ACK tracking, throttle
  duration) only tracks messages SENT, not whether receivers PROCESSED them

Current backpressure implementation sends an ACK timeout warning after 500ms,
then throttles for 1000ms. But this only addresses the SENDER's perspective. If
receiver (Manager sidebar) is in background tab, the browser may coalesce the
messages BEFORE the listener fires at all.

The extension has NO mechanism to detect when messages are coalesced. If message
1, 2, 3, 4, 5 are posted but only 1, 3, 5 arrive (due to browser coalescing),
the manager never knows messages 2, 4 were dropped.

### Specific Problem Areas

- Line 220-240 (BroadcastChannelManager.js): `_postMessageWithBackpressure()`
  checks throttle status but has no coalescing detection
- Line 1400-1420 (sidebar/quick-tabs-manager.js): Listener registers for
  'message' events but doesn't track message IDs or detect gaps
- No monotonic message sequence counter to detect missing intermediate updates
- The `messageId` field (added in v1.6.4.15) is only used for ACK tracking, not
  for gap detection
- No fallback to storage.onChanged when message loss is detected

### Fix Required

Implement monotonic message sequence counter in BroadcastChannel messages. Each
broadcast includes incrementing `sequenceNumber`. Manager's listener tracks
`lastReceivedSequenceNumber` and detects gaps (e.g., received 1, 3 means 2 was
lost). When gap detected, immediately trigger full state re-read from storage as
fallback.

Additionally, add heuristic: if BroadcastChannel listener hasn't received ANY
message for >5 seconds, assume browser has throttled the tab and switch Manager
to polling-only mode (force storage.onChanged as primary, BroadcastChannel as
best-effort only).

---

## Issue #8: IndexedDB Corruption - Silent Data Loss (Firefox Bug 1979997/1885297)

### Problem

Firefox has known corruption bugs in IndexedDB (which browser.storage.local uses
internally). When corruption occurs, storage.local returns empty state (tabs:
[]) instead of stored data. The extension has NO recovery mechanism and silently
accepts the empty state as valid, permanently losing all Quick Tab data.

### Root Cause

**Files:** `background.js` (lines 1870-1880, saveStateToStorage),
`sidebar/quick-tabs-manager.js` (lines 2200-2250, loadQuickTabsState)  
**Issue:** Firefox Bugzilla entries 1979997 and 1885297 document IndexedDB
corruption in extension storage. The bugs can cause:

1. Stored data becomes inaccessible (returned as null/undefined)
2. Read operations return partial data (missing keys)
3. Write operations silently fail with no error
4. Corruption persists until extension is reloaded or profile is recreated

The extension's current mitigation (in-memory cache, v1.6.3.5-v4) only protects
against SHORT-TERM storage storms (< 2 seconds). If the underlying IndexedDB is
corrupted, the cache and storage diverge and the cache becomes unreliable.

Current code at line 2220-2250 (sidebar/quick-tabs-manager.js) checks if
returned state is empty and uses in-memory cache as fallback. But if the cache
was populated BEFORE corruption occurred, it contains stale data.

No validation of storage integrity exists. No detection of corruption (e.g.,
comparing read-back data against write expectations). No recovery strategy
beyond "use cache" which may be equally corrupted.

### Specific Problem Areas

- Line 1870-1880 (background.js): `saveStateToStorage()` writes data but never
  validates write succeeded by reading it back
- Line 2220-2250 (sidebar/quick-tabs-manager.js): `_detectStorageStorm()`
  assumes cache is accurate but never validates it
- No call to `browser.storage.local.get()` immediately after
  `browser.storage.local.set()` to verify persistence
- No calculation of data checksum before/after storage operations to detect
  corruption
- No graceful degradation when corruption detected (just silently uses cache)

### Fix Required

Implement storage integrity validation. After every storage.set() call,
immediately read back the same data and validate it matches what was written. If
mismatch or read returns null/undefined, log CRITICAL error and trigger manual
data reconstruction.

Add optional pref-based recovery (requires documentation): Users experiencing
data loss can enable `extensions.webextensions.keepStorageOnCorrupted` in
about:config to prevent Firefox from deleting corrupted storage on next startup.

For missing data, implement emergency restore: keep a second copy of tabs in
browser.storage.sync (has separate IndexedDB instance) as redundant backup. On
startup, if storage.local is empty but storage.sync has data, restore from sync
with user notification.

---

## Issue #9: Runtime.Port Message Ordering - No Serialization Guarantees

### Problem

The sidebar sends HEARTBEAT and keepalive messages (in rapid succession) via
runtime.Port, and background processes them without guaranteed ordering. If both
messages arrive nearly simultaneously, the Firefox idle timer may NOT reset
(defeating the purpose of the keepalive mechanism).

### Root Cause

**Files:** `sidebar/quick-tabs-manager.js` (lines 700-750, sendHeartbeat),
`background.js` (lines 1600-1650, message listeners)  
**Issue:** The runtime.Port API does NOT guarantee message ordering across
multiple rapid `postMessage()` calls. From Firefox source code and MDN: "Port
messages are asynchronous and may be reordered by the browser event loop."

Current code assumes that messages sent in sequence arrive in sequence:

1. sendPortMessageWithTimeout({ type: 'HEARTBEAT' }) at t=0
2. browser.runtime.sendMessage({ type: 'KEEPALIVE' }) at t=5ms

But browser may deliver them as: KEEPALIVE (t=5ms), HEARTBEAT (t=0ms). If
background's KEEPALIVE handler and HEARTBEAT handler both touch the same state
variable (e.g., `lastHeartbeatTime`), the final state depends on processing
order, not send order.

More critically: If KEEPALIVE message is delayed and arrives AFTER the next
HEARTBEAT is sent, the background may transition to ZOMBIE state incorrectly
because it processes messages out of order.

### Specific Problem Areas

- Line 725-750 (sidebar/quick-tabs-manager.js): `sendHeartbeat()` sends
  HEARTBEAT via port, followed immediately by other operations
- Line 1600-1650 (background.js): Message handlers for port messages have no
  ordering protection
- No sequence counter on port messages to detect out-of-order delivery
- Background's `lastHeartbeatResponse` tracking (line 1610) can be clobbered by
  message reordering
- The ZOMBIE state detection (line 1800) relies on implicit ordering of
  timeout + response handling

### Fix Required

Add monotonic sequence counter to all port messages. Each postMessage includes
`messageSequence: incrementingCounter`. Background's listener checks sequence
numbers and queues out-of-order messages for later processing.

Alternatively (simpler but more resource-intensive): Add explicit ACK
requirement for HEARTBEAT messages. Sidebar doesn't send next HEARTBEAT until
previous one is ACK'd. This enforces serialization but adds latency (~10ms per
round trip).

---

## Issue #10: Tab Affinity Map Desynchronization - Stale Entries Accumulate Indefinitely

### Problem

The `quickTabHostInfo` Map (sidebar/quick-tabs-manager.js, line 1200) tracks
which browser tab "owns" each Quick Tab for cleanup and operation routing. Map
entries are added when Quick Tabs are created but NEVER removed when browser
tabs close. Over extended use sessions, the Map grows indefinitely with stale
entries for closed tabs, consuming memory and potentially blocking cleanup
operations.

### Root Cause

**Files:** `sidebar/quick-tabs-manager.js` (lines 1200-1210, quickTabHostInfo
declaration and management)  
**Issue:** The Map is populated in `_updateQuickTabHostInfo()` (line 2800)
whenever a Quick Tab's state changes. But the only place entries are removed is
in `_removeFromHostInfo()` (line 3100), which is ONLY called when a Quick Tab is
deleted from Manager UI.

If a browser tab closes WITHOUT its Quick Tab being explicitly deleted from
Manager, the Map entry persists forever. Over weeks of use, the Map accumulates
hundreds of stale entries for closed tabs.

The Map has no TTL, max size limit, or age-based eviction. No diagnostic logging
shows how many entries exist or how old they are.

### Specific Problem Areas

- Line 1200-1210: `quickTabHostInfo` declared as `new Map()` with no size
  constraints
- Line 2800-2850: `_updateQuickTabHostInfo()` adds entries but never removes
  stale ones
- Line 3100-3110: `_removeFromHostInfo()` only called for explicit Quick Tab
  deletions, not for closed browser tabs
- No timer or cleanup process to periodically purge entries for closed tabs
- No logging of Map size or age statistics for debugging

### Fix Required

Implement age-based TTL for quickTabHostInfo entries. Add `lastUpdate` timestamp
to each entry. Periodically (every 60 seconds), iterate through Map and remove
entries older than 24 hours. This prevents unbounded growth.

Additionally, listen to `browser.tabs.onRemoved` events and immediately remove
any quickTabHostInfo entries for closed tabs. This ensures cleanup happens
promptly, not just on TTL expiration.

Add diagnostic logging: On startup and every 60 seconds, log quickTabHostInfo
size and age statistics. This enables detection of memory leaks during
development.

---

## Issue #11: Initialization Race Between Listeners - Silent Handler Failures

### Problem

Three independent initialization paths exist and run concurrently:

1. `initializeGlobalState()` in background (async, file line 600-650)
2. `loadQuickTabsState()` in sidebar (async, file line 2200, called on
   DOMContentLoaded)
3. `storage.onChanged` listener (fires immediately on script load)

If storage.onChanged fires BEFORE initializeGlobalState completes, the handler
may call methods that expect initialized state, causing silent failures.

### Root Cause

**Files:** `background.js` (lines 600-650, initializeGlobalState +
storage.onChanged listener registration), `sidebar/quick-tabs-manager.js` (lines
200-250, DOMContentLoaded listener)  
**Issue:** Background script initialization is asynchronous:

```
Line 615: initializeGlobalState() — async function
Line 616: // <- listener registration happens here, not at end of initialization
Line 800: browser.storage.onChanged.addListener(listener)
```

The problem: storage.onChanged listener is registered DURING initialization, not
AFTER. If storage changes before initialization completes, the listener's
handler may execute with `globalState.tabs === undefined` or
`isInitialized === false`, causing exceptions or silent failures.

Sidebar has the same issue: DOMContentLoaded fires and calls loadQuickTabsState
(async), but other listeners are registered synchronously and may fire before
load completes.

The code has `if (!isInitialized)` guards in some handlers (e.g.,
QuickTabHandler line 200-250) but NOT in all storage listeners. Background's
storage.onChanged handler has no initialization guard at all.

### Specific Problem Areas

- Line 615-620 (background.js): `initializeGlobalState()` is async but listener
  registration happens immediately after (not awaited)
- Line 800-850 (background.js): `browser.storage.onChanged.addListener()`
  registered before `isInitialized` is set to true
- Sidebar line 200-250: DOMContentLoaded listener calls async functions but
  doesn't block other listeners from firing
- Line 2200-2250 (sidebar/quick-tabs-manager.js): `storage.onChanged` listener
  has no check for initialization completion
- Background's storage.onChanged handler (line 900-950) has NO initialization
  guard whatsoever

### Fix Required

Move listener registration to the END of initialization, not during. Wrap all
listener registration in an async function that awaits initialization completion
before registering listeners. This ensures no listener fires until state is
fully initialized.

For sidebar: Implement initialization barrier. Set a flag
`initializationStarted = true` on DOMContentLoaded, then set
`initializationComplete = true` after all async loads finish. All listener
handlers check both flags and return early if not yet initialized (OR queue the
event for processing after initialization).

Add ENTRY logging to all listener handlers showing whether initialization is
complete. This enables rapid diagnosis of race conditions in logs:
"LISTENER_CALLED but initialization_incomplete = true" clearly indicates the
problem.

---

## Shared Implementation Notes

**For all issues:**

1. **Add Diagnostic Logging:** Every persistence operation (storage.set,
   BroadcastChannel.postMessage, port.postMessage) needs explicit logging of
   what data is being persisted, with unique operation IDs for tracing. Missing
   logging is why these issues are hard to diagnose.

2. **Implement Validation Layer:** After every write, implement read-back
   validation (e.g., "wrote X bytes, read back Y bytes, hashes match: Z"). This
   catches corruption immediately instead of silently.

3. **Add Watchdog Timers:** Critical operations (initialization, storage writes,
   state syncs) should have timeout watchers. If expected callback doesn't fire
   within timeout, log warning and trigger fallback/recovery.

4. **Preserve Ordering Invariants:** Use immutable sequence IDs (incrementing
   counters) on all state updates. Listeners check sequenceId to detect
   out-of-order delivery and reject old updates.

5. **Implement Explicit Coordination:** Between background keepalive/heartbeat
   systems, between storage.onChanged and BroadcastChannel updates, and between
   sidebar storage listeners. Use messaging to coordinate state instead of
   assuming implicit synchronization.

<acceptance_criteria>

**Issue #6 (Storage Ordering):**

- [ ] State includes `sequenceId` (incrementing counter per storage write)
- [ ] storage.onChanged listener rejects updates with sequenceId <=
      lastAppliedSequenceId
- [ ] Watchdog timer: if no storage.onChanged fires within 2s of storage.set(),
      explicitly re-read to verify
- [ ] Manual test: Perform create → minimize → update rapidly; verify final
      state matches expected (correct order applied)

**Issue #7 (BroadcastChannel Coalescing):**

- [ ] BroadcastChannel messages include monotonic `sequenceNumber`
- [ ] Manager listener detects gaps in sequence numbers; logs warning and
      triggers storage.onChanged fallback
- [ ] Manual test: Rapidly create 10 Quick Tabs while sidebar is in background
      tab; all 10 appear in Manager after returning to foreground

**Issue #8 (IndexedDB Corruption):**

- [ ] After every storage.set(), immediately read back and validate data matches
- [ ] If corruption detected, log CRITICAL and trigger recovery (restore from
      sync storage if available)
- [ ] Documentation: explain Firefox Bug 1979997 and keepStorageOnCorrupted pref

**Issue #9 (Port Message Ordering):**

- [ ] Port messages include `messageSequence` counter
- [ ] Background listener reorders out-of-order messages (queues and processes
      by sequence)
- [ ] Manual test: Sidebar sends rapid heartbeat + keepalive; background
      processes in correct order

**Issue #10 (Tab Affinity Cleanup):**

- [ ] quickTabHostInfo entries include `lastUpdate` timestamp
- [ ] Cleanup job (every 60s): remove entries older than 24h
- [ ] Listen to browser.tabs.onRemoved: immediately remove corresponding
      quickTabHostInfo entry
- [ ] Diagnostic logging: Log Map size and age stats every 60s

**Issue #11 (Initialization Race):**

- [ ] Listener registration moved to END of initialization (after isInitialized
      = true)
- [ ] All listener handlers check isInitialized; return early if not complete
- [ ] storage.onChanged listener has explicit initialization guard
- [ ] Sidebar has initialization barrier (initializationStarted,
      initializationComplete flags)
- [ ] All listeners log ENTRY message showing initialization status

**All Issues:**

- [ ] All storage/messaging operations log with unique operation IDs for tracing
- [ ] No data loss during manual test: create state → reload → state persists
- [ ] No silent failures: all errors logged with context (operation, expected vs
      actual, recovery action)

</acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #6: Storage Ordering Race - Technical Background</summary>

Browser storage APIs (browser.storage.local on Firefox, chrome.storage.local on
Chrome) are built on top of IndexedDB. IndexedDB is fully asynchronous and makes
NO ordering guarantees between sequential calls from the same context.

From Firefox source (storage/Extension.jsm): "Storage write operations are
queued and processed independently. The order of queued writes is not guaranteed
to match the order of API calls."

This means:

```
storage.set({ key: 'A', value: '1' })
storage.set({ key: 'B', value: '2' })
// Listener may receive: B → A (not A → B)
```

The sidebar assumes ordered events and builds its cache incrementally. If events
arrive out of order, the cache state diverges from the stored state, causing
permanent inconsistency.

</details>

<details>
<summary>Issue #7: BroadcastChannel Throttling - Documented Behavior</summary>

From Chromium source (content/browser/broadcast_channel/) and Firefox source
(dom/broadcastchannel/):

Background tabs have reduced event processing frequency to save CPU/battery.
BroadcastChannel messages posted to a background tab listener are coalesced:
multiple messages within a 1000ms window are merged into a single event.

This is documented behavior in Chromium but NOT documented in Firefox (though
observable in practice).

The extension's backpressure mechanism (ACK tracking) doesn't prevent coalescing
because coalescing happens BEFORE the listener fires. The listener never knows
intermediate messages were dropped.

</details>

<details>
<summary>Issue #8: IndexedDB Corruption - Firefox Bugzilla References</summary>

**Bug 1979997:** "IndexedDB storage for WebExtension becomes corrupted and
inaccessible"

- Affects: Firefox 102+
- Symptom: browser.storage.local.get() returns empty {} instead of stored data
- Workaround: Set preference
  `extensions.webextensions.keepStorageOnCorrupted = true`
- Status: WONTFIX (design limitation of IndexedDB backend)

**Bug 1885297:** "WebExtension storage corruption after unclean shutdown"

- Affects: Firefox 115+
- Symptom: Partial data loss (some keys present, others missing)
- Workaround: Manual profile backup and restoration
- Status: Open

The extension has no mitigation for either bug. Relying solely on in-memory
cache (v1.6.3.5-v4) is insufficient because the cache may be populated before
corruption occurs.

</details>

<details>
<summary>Issue #9: Port Message Ordering - Runtime.Port Semantics</summary>

From MDN
(developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/runtime/Port):

"The onMessage event is fired when the port receives a message. The order of
messages received is not guaranteed to match the order in which they were sent."

This is rare but possible under high load or when sender and receiver are busy
with other tasks. The JavaScript event loop is single-threaded but the browser's
internal message handling is not.

Current code at sidebar/quick-tabs-manager.js:725 assumes:

```
sendPortMessageWithTimeout(HEARTBEAT) // arrives first
_probeBackgroundHealth()              // uses result, assumes it's fresh
```

But if \_probeBackgroundHealth's message arrives before HEARTBEAT's response,
the probe result is stale.

</details>

<details>
<summary>Issue #10: Memory Accumulation Analysis</summary>

quickTabHostInfo Map growth over extended use (example):

- User opens extension, creates 5 Quick Tabs: Map has 5 entries
- User switches to 10 different tabs over 1 hour: Map has ~50 entries (each
  Quick Tab's hostTabId updated)
- User closes Safari window without closing Quick Tabs: 50 entries for closed
  tabs remain in Map
- After 2 weeks of normal use: Map may have 1000+ entries (50 per day × 20 days)

Each entry is small (~200 bytes), but 1000+ entries = 200KB+ memory just for
this one Map. On slow systems or after months of use, accumulation becomes
noticeable.

No TTL or eviction means memory is never reclaimed. Implementing 24-hour TTL on
entries solves this completely.

</details>

<details>
<summary>Issue #11: Initialization Race - Reproduction Scenario</summary>

Scenario that triggers the race:

1. Extension loads, background.js line 615 calls `initializeGlobalState()`
   (async)
2. Background.js line 800 immediately registers `storage.onChanged` listener
   (doesn't await initialization)
3. User has browser.storage.local with Quick Tabs data saved from previous
   session
4. storage.onChanged listener fires immediately (storage already exists at
   script load time)
5. storage.onChanged handler tries to call `_shouldIgnoreStorageChange()` but
   `globalState` is still `undefined`
6. Silent error (or exception if handlers aren't wrapped in try-catch)

The sidebar has the same issue: DOMContentLoaded calls loadQuickTabsState
(async), but storage.onChanged listener fires synchronously during page load,
before loadQuickTabsState completes.

To confirm: Add logging to initializeGlobalState (line 615: "INIT_START") and
storage.onChanged handler (line 900: "LISTENER_FIRE"). If logs show
LISTENER_FIRE before INIT_START, the race is occurring.

</details>

---

**Priority:** Critical (Issues #6, #8), High (Issues #7, #9, #11), Medium (Issue
#10) | **Dependencies:** None (can be fixed independently) | **Complexity:**
High (requires architectural changes to initialization and message coordination)
