# State Persistence & Messaging: Critical Issues with Incomplete Implementations

**Extension Version:** v1.6.3.7-v10 | **Date:** 2025-12-10 | **Scope:** Storage
event ordering, message sequencing, port connection initialization, data
corruption recovery, and logging deficiencies affecting all state persistence
paths (storage.onChanged, BroadcastChannel, runtime.Port)

---

## Executive Summary

The extension implements advanced state persistence and messaging features
(sequence IDs, gap detection, storage validation, initialization guards,
corruption recovery) but leaves critical behavioral components incomplete or
unintegrated. This creates silent data losses, permanent state divergence, and
undiagnosed failures in production. The root cause pattern is consistent:
architectural infrastructure exists but integration of validation gates,
recovery callbacks, and message reordering logic is missing. Fixing requires
wiring components together and adding comprehensive logging throughout
persistence paths, not new architecture.

---

## Issues Overview

| Issue | Component                                                                | Severity | Root Cause                                                                                                      | Status                 |
| ----- | ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| #1    | `src/background/` (runtime.Port setup) + `sidebar/quick-tabs-manager.js` | Critical | Sidebar never initiates port connection; background onConnect listener has no sidebar ports                     | Not implemented        |
| #2    | `sidebar/quick-tabs-manager.js` (BroadcastChannel usage)                 | Critical | BroadcastChannel not available in sidebar extension context; architecture assumes cross-context communication   | Architectural mismatch |
| #3    | `sidebar/quick-tabs-manager.js` (storage.onChanged listener)             | Critical | Storage event ordering validation gate missing; watchdog timer not implemented                                  | Partially implemented  |
| #4    | `src/background/` (runtime.Port message handler)                         | High     | Port message reordering queue missing; sequence counter added but never used                                    | Partially implemented  |
| #5    | `src/background/` (storage validation) + `sidebar/quick-tabs-manager.js` | Critical | Storage corruption detection works but auto-recovery incomplete; sync backup timing misaligned                  | Partially implemented  |
| #6    | `sidebar/quick-tabs-manager.js` (DOMContentLoaded, initialization)       | High     | Listener registration synchronous during async initialization; race condition still possible                    | Partially guarded      |
| #7    | `sidebar/quick-tabs-manager.js` (quickTabHostInfo Map)                   | Medium   | TTL cleanup exists but entries accumulate before first cycle; no race protection against browser.tabs.onRemoved | Implemented            |
| #8    | All modules (storage, messaging, initialization paths)                   | Critical | Missing operation-level logging; no diagnostic timestamps or state transitions                                  | Not implemented        |

---

## Issue #1: Port Connection Not Established — Critical Initialization Failure

### Problem Summary

Sidebar never establishes persistent port connection with background script.
Background logs show "STORAGE_WATCHDOG_NOTIFICATION_SKIPPED: No sidebar ports
connected" hundreds of times. UI coordinator renders empty state and never
receives state updates. Button clicks (Close All, Close Minimized) produce no
logs, indicating message handlers never fire. Sidebar operates in complete
isolation from background state, causing permanent divergence and rendering
failures.

### Root Cause

**Files affected:**

- `src/background/` (background script loads but port listener setup unclear)
- `sidebar/quick-tabs-manager.js` (no `runtime.connect()` call at
  initialization)

**Issue:** Background script must register `runtime.onConnect` listener to
receive sidebar port connections. Sidebar must call
`runtime.connect({ name: 'managerPort' })` during initialization. Neither is
implemented or verified to exist. Sidebar HTML loads JS as module
(`<script type="module">`), causing timing uncertainty. Module execution is
async; port connection may never happen or happen before state is ready.

**Evidence:**

- Logs show zero "PORT_CONNECTED" or "PORT_REGISTERED" messages from sidebar
- Background never logs "SIDEBAR_PORT_ADDED" when sidebar connects
- Button click handlers completely silent (no onMessage fires)
- Background broadcasts state but sidebar UI coordinator never receives messages

### Fix Required

Establish explicit port connection flow from sidebar to background during
initialization. Sidebar initialization must ensure port connects BEFORE
registering event listeners. Background must accept and track sidebar ports,
making them available for broadcast operations.

**Required changes:**

- In sidebar initialization: After DOM content loaded and state ready, call
  `runtime.connect()` with explicit port name; log connection success/failure
  with timestamp
- In background: Set up `runtime.onConnect` listener that accepts sidebar port,
  stores reference, and registers onMessage handler for UI commands
- Add barrier: Defer storage.onChanged listener registration until port
  connected
- Add comprehensive logging: Every connection attempt, success, failure, and
  disconnection must log with context

**Ensure:**

- Port connection happens AFTER sidebar state initialized, not during module
  load
- onConnect listener active BEFORE sidebar can connect (register at background
  script startup)
- No race condition where button clicks arrive before handler registered
- Graceful disconnection handling and reconnection attempts

<scope>
**Modify:**
- `src/background/` (MessageRouter.js or main background entry): Add `runtime.onConnect` listener for sidebar port; store port reference; log all connection events
- `sidebar/quick-tabs-manager.js`: Add `runtime.connect()` call in deferred initialization block (after DOM + state ready); log connection outcome; defer critical listeners until port connected

**Do NOT Modify:**

- Message types or payload structure
- Background storage mechanisms
- UI rendering logic
- Content script messaging paths </scope>

<acceptance_criteria>

- [ ] Sidebar logs "PORT_CONNECTION_INITIATED" with timestamp on startup
- [ ] Background logs "SIDEBAR_PORT_ADDED" when sidebar connects
- [ ] Button clicks produce onMessage handler logs (Close All, Close Minimized,
      etc.)
- [ ] Manual test: Open sidebar → click Close All → verify tabs close and UI
      updates
- [ ] Manual test: Open sidebar, click buttons rapidly → verify all messages
      processed
- [ ] Zero "No sidebar ports connected" log entries during normal operation
- [ ] Port disconnection detected and logged; reconnection attempted on next
      sidebar open </acceptance_criteria>

---

## Issue #2: BroadcastChannel Architecture Mismatch — Unavailable in Extension Context

### Problem Summary

Background broadcasts state via BroadcastChannel, but sidebar cannot receive
messages (context mismatch). Browser returns "BroadcastChannel not available" or
receives no messages because sidebar is not a standard browsing context.
Architecture assumes BroadcastChannel provides cross-tab/cross-context
communication, but extension context (sidebar) is isolated from web origins.
This breaks fallback mechanism entirely and creates permanent out-of-sync state.

### Root Cause

**Files affected:**

- `sidebar/quick-tabs-manager.js` (BroadcastChannel message listener setup)
- `src/background/` (BroadcastChannel postMessage calls)

**Issue:** BroadcastChannel API (W3C spec) only works between pages of **same
origin** in standard browsing contexts (tabs, windows, iframes). WebExtension
sidebar is a special extension context, not a standard browsing context.
Background and sidebar exist in different security contexts despite same
extension. BroadcastChannel cannot bridge them.

**Architectural assumption broken:** Extension treated BroadcastChannel as
primary state delivery mechanism. Design expected sidebar to receive background
updates via BroadcastChannel. Storage.onChanged + Port messaging intended as
fallbacks. But BroadcastChannel is fundamentally unavailable in sidebar.

**Evidence:**

- All BroadcastChannel logs from background marked "BroadcastChannel not
  available"
- Sidebar BroadcastChannel listeners register but never fire
- UICoordinator state never updates despite background broadcasting

### Fix Required

Replace BroadcastChannel with Port-based messaging as primary state delivery
mechanism. Use storage.onChanged as secondary fallback (not BroadcastChannel).
Accept that BroadcastChannel is only viable for content-script-to-content-script
communication, not sidebar communication.

**Required changes:**

- Remove BroadcastChannel listener from sidebar initialization (it will never
  receive messages)
- Implement Port-based state broadcasts: Background sends state updates via
  `port.postMessage()` after every state change
- Implement storage polling fallback: If Port connection lost, switch to
  periodic storage.local reads (every 2-5 seconds)
- Add logging: Every state broadcast attempt, delivery success, and fallback
  activation

**Ensure:**

- State broadcasts go through Port immediately after storage.set() succeeds
- Sidebar can detect Port disconnection and fall back to storage polling
- No reliance on BroadcastChannel for any sidebar communication

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js`: Remove BroadcastChannel listener; implement Port message handler for state updates; add storage polling fallback
- `src/background/` (state update operations): Add `port.postMessage()` call after every storage.set() to broadcast state to connected sidebar

**Do NOT Modify:**

- Storage write mechanism itself
- Port connection setup (addressed in Issue #1)
- Content script messaging </scope>

<acceptance_criteria>

- [ ] BroadcastChannel listener removed or disabled in sidebar
- [ ] State updates broadcast via Port immediately after storage changes
- [ ] Sidebar logs "STATE_UPDATE_RECEIVED" when port message arrives
- [ ] If Port disconnected, sidebar switches to storage polling with
      "STORAGE_POLLING_FALLBACK_ACTIVATED" log
- [ ] Manual test: Create tab in background → verify sidebar receives update via
      Port within 100ms
- [ ] Manual test: Kill background process → sidebar switches to polling and
      recovers state on reconnect </acceptance_criteria>

---

## Issue #3: Storage Event Ordering Validation — Gate Missing, Watchdog Not Implemented

### Problem Summary

Background sends sequential storage updates (create tab → minimize → update
state). Browser provides no ordering guarantee; storage.onChanged events arrive
out of order. Manager applies updates as received, causing final UI state to
diverge permanently from stored state. Extension added sequence ID
infrastructure but never implemented validation gate or watchdog timer.
Out-of-order updates silently applied; stale state cached.

### Root Cause

**Files affected:**

- `src/background/` (storage write operations add sequenceId)
- `sidebar/quick-tabs-manager.js` (storage.onChanged listener receives events)

**Issue:** MDN explicitly states `storage.onChanged` provides no ordering
guarantee. Browser can batch, reorder, or delay events. Extension correctly
added monotonic `sequenceId` to all storage writes but never validates incoming
events against `lastAppliedSequenceId` in listener. No watchdog timer to detect
missing events (if onChanged doesn't fire within expected window, explicit
re-read should trigger).

**Evidence:**

- `sequenceId` field present in storage writes but never compared in listener
- `lastAppliedSequenceId` tracked but never updated
- Out-of-order events logged but not rejected
- No watchdog timeout implemented

### Fix Required

Implement sequence validation gate in storage.onChanged listener. Reject or
queue out-of-order updates. Add watchdog timer that re-reads storage if
onChanged doesn't fire within 2 seconds of write.

**Required changes:**

- In storage.onChanged listener: Check if
  `incomingSequenceId > lastAppliedSequenceId`; if not, reject or queue update;
  log comparison result
- Implement priority queue for out-of-order messages: Store rejected updates,
  reprocess when in-order message arrives
- Add watchdog timer: After every `storage.set()`, set 2-second timeout; if
  onChanged doesn't fire, explicitly re-read storage and compare tab counts; log
  "STORAGE_WATCHDOG_TRIGGERED"
- Add comprehensive logging: Every storage.set() logs operationId + sequenceId;
  every onChanged logs sequenceId + comparison result + accept/reject decision

**Ensure:**

- Out-of-order events never update UI state
- Watchdog detects and recovers from missed storage events
- All operations have unique operationId for tracking through system

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js`: Add sequence validation logic in storage.onChanged listener; implement out-of-order message queue
- `src/background/` (writeStorageWithValidation): Add watchdog timer after storage.set(); generate unique operationId; log before and after write

**Do NOT Modify:**

- Sequence ID generation algorithm
- Storage write mechanism itself
- Manager cache reconciliation logic </scope>

<acceptance_criteria>

- [ ] storage.onChanged listener logs sequenceId comparison result for every
      event
- [ ] Updates with sequenceId ≤ lastAppliedSequenceId rejected (or queued)
- [ ] Watchdog timer fires 2s after storage.set() if onChanged doesn't arrive
- [ ] All storage operations log unique operationId + sequenceId before and
      after
- [ ] Manual test: Rapid create → minimize → update → verify final UI state
      matches expected order
- [ ] Zero log entries showing out-of-order updates applied to UI
      </acceptance_criteria>

---

## Issue #4: Port Message Reordering — Sequence Counter Added, Reordering Logic Missing

### Problem Summary

Sidebar sends HEARTBEAT, KEEPALIVE, and command messages rapidly via Port.
Browser's event loop may deliver messages out of FIFO order. If KEEPALIVE
arrives before HEARTBEAT response processed, background's `lastHeartbeatTime`
gets overwritten incorrectly, breaking idle-timer logic. Extension added
`messageSequence` counter to all port messages but never implemented reordering
queue in background message handler. Out-of-order messages processed
immediately, defeating sequence infrastructure.

### Root Cause

**Files affected:**

- `sidebar/quick-tabs-manager.js` (adds messageSequence to port messages)
- `src/background/` (port message handler processes messages)

**Issue:** MDN explicitly documents: "Port messages may be reordered." Browser
event loop doesn't guarantee FIFO delivery. Extension correctly added counter
but never implemented reordering gate: no message queue, no sequence-driven
dequeue, no timeout fallback. Messages processed in arrival order, not sequence
order.

**Evidence:**

- `_managerPortMessageSequence` counter exists
- Messages include `messageSequence` field
- Background handler logs sequence but processes FIFO
- Heartbeat logic assumes FIFO but occasionally gets LIFO

### Fix Required

Implement message reordering logic in background port message handler. Maintain
pending message queue keyed by messageSequence. Process in-order messages
immediately; queue out-of-order messages. Dequeue after processing in-order
message if next sequence available.

**Required changes:**

- Create pending message queue in background port handler
- On message arrival: Check if `messageSequence > lastProcessedSequence`; if
  yes, process immediately; if no (out of order), add to queue
- After processing in-order message: Check if next-expected sequence in queue;
  if yes, dequeue and process; repeat until gap
- Add timeout: If messages queued for >1 second with gap remaining, force
  process oldest queued message (fallback to prevent deadlock); log
  "QUEUE_TIMEOUT_FALLBACK"
- Log throughout: Every message entry logs messageSequence + isOutOfOrder flag;
  queue insertions/dequeues logged with before/after state

**Ensure:**

- Out-of-order messages never bypass queue
- Stuck queue timeout prevents indefinite blocking
- Heartbeat logic always processes in correct order
- Idle timer reset works correctly

<scope>
**Modify:**
- `src/background/MessageRouter.js` or main port handler: Add message queue and sequence-driven dequeue logic; add timeout fallback

**Do NOT Modify:**

- Port connection setup
- Message payload structure
- Heartbeat interval timing
- Idle timer logic </scope>

<acceptance_criteria>

- [ ] Port messages queued if out of order (messageSequence ≤
      lastProcessedSequence)
- [ ] In-order messages processed immediately; queue flushed after each in-order
      process
- [ ] Queue timeout triggers after 1s with unprocessed messages; logs warning
      with queue state
- [ ] Manual test: Rapid heartbeat + keepalive spam → verify lastHeartbeatTime
      always updated correctly
- [ ] Manual test: Force message reordering (via test harness) → verify no
      behavioral divergence
- [ ] Zero timeout fallback triggers in normal operation (fallback only for edge
      cases) </acceptance_criteria>

---

## Issue #5: Storage Corruption Detection & Recovery — Incomplete Auto-Recovery

### Problem Summary

Firefox has known IndexedDB corruption bugs (1979997, 1885297). When corruption
occurs, storage.local returns empty or partial data. Extension validates writes
and detects corruption but recovery mechanism incomplete: startup check only
restores from sync backup if local storage completely empty. Subtle corruption
(wrong tab count, missing states, data integrity issues) never triggers
recovery. Sync backup timing misaligned with local writes, so backup often
stale. Users lose tabs silently.

### Root Cause

**Files affected:**

- `src/background/` (validateStorageWrite, checkStorageIntegrityOnStartup,
  attemptRecoveryFromSyncBackup)

**Issue:** Corruption validation reads back data and compares tab counts.
Corruption recovery attempts to restore from storage.sync backup. However: (1)
Validation doesn't compute data integrity checksums; (2) Startup check requires
local storage completely EMPTY to trigger recovery (doesn't detect subtle
corruption); (3) storage.sync writes not synchronized with storage.local writes,
so backup can be stale; (4) Auto-recovery path only triggered for obvious
corruption, not silent data loss.

**Firefox bugs:** Bug 1979997 causes storage.local to return empty {}. Bug
1885297 causes partial data loss. No automatic workaround in extension.

**Evidence:**

- validateStorageWrite() reads back but never validates checksum
- Corruption detection works but passes with wrong tab count if > 0
- Recovery only attempts if local storage empty
- No sync backup update after every local write

### Fix Required

Enhance corruption detection with data integrity checksums. Ensure automatic
sync backup updates after every local write. Extend startup recovery to trigger
on subtle corruption, not just zero-data.

**Required changes:**

- Add checksum computation: Before storage.set(), compute hash/checksum of tab
  IDs + states; after read-back, compare hashes
- Mismatch triggers immediate recovery: Log "DATA_CORRUPTION_DETECTED" with
  operationId + expected hash + actual hash; attempt sync backup restore
- Enhance startup check: Always compare cache against storage.local; if count
  differs by >0, assume corruption and restore from sync
- Implement automatic sync backup: Every successful storage.set() to
  storage.local also writes to storage.sync within 100ms
- Add recovery logging: Every corruption detection and recovery attempt logged
  with operationId + action taken

**Ensure:**

- Every data write validated immediately
- Corruption detected even if tab count non-zero
- Sync backup always fresh (within seconds of writes)
- No data loss on startup due to prior corruption

<scope>
**Modify:**
- `src/background/` (validateStorageWrite function): Add checksum computation and comparison; trigger recovery on mismatch
- `src/background/` (checkStorageIntegrityOnStartup): Extend check to compare cache vs storage count; restore from sync if differs
- `src/background/` (writeStorageWithValidation): Add automatic storage.sync write after local write succeeds

**Do NOT Modify:**

- storage.onChanged listener
- Cache update logic
- Browser API calls </scope>

<acceptance_criteria>

- [ ] Data checksum computed before and after every storage.set()
- [ ] Mismatch triggers recovery with operationId logging
- [ ] Startup check restores from sync backup if cache count differs from
      storage count
- [ ] storage.sync written within 100ms of storage.local write
- [ ] Manual test: Simulate corruption (clear storage.local key) → startup
      restore recovers data from sync
- [ ] Manual test: Wrong tab count in storage → startup recovery triggers
- [ ] Zero data loss in corruption recovery flows </acceptance_criteria>

---

## Issue #6: Initialization Race Condition — Guards Present, Registration Still Synchronous

### Problem Summary

Three initialization paths run concurrently: `initializeGlobalState()` (async),
module script load (async), and `storage.onChanged` listener (can fire
immediately). If storage.onChanged fires BEFORE initialization completes,
listener may operate on uninitialized state. Guards check `isFullyInitialized()`
but don't prevent cache divergence during initialization window. Extension loads
sidebar JS as ES module, making timing unpredictable.

### Root Cause

**Files affected:**

- `sidebar/quick-tabs-manager.html` (loads module script asynchronously)
- `sidebar/quick-tabs-manager.js` (DOMContentLoaded, initialization, listener
  registration)

**Issue:** HTML loads JS with `<script type="module">`, which executes
asynchronously. Module script may not complete before DOMContentLoaded fires.
Background listener registration is synchronous at script load time, but async
initialization follows. Browser can fire storage.onChanged before initialization
complete. Sidebar has guards that check initialization status but doesn't
prevent race—guards only prevent exceptions, not logic errors.

**Evidence:**

- `initializationStarted` and `initializationComplete` flags exist
- `isFullyInitialized()` guard called but doesn't defer listener registration
- No logging of initialization start/completion
- No barrier that blocks listeners until init complete

### Fix Required

Defer critical listener registration until initialization complete. Move
listener registration to end of initialization sequence, not at script load. Add
initialization barrier that blocks handlers until ready.

**Required changes:**

- Defer storage.onChanged listener registration: Don't register until
  `initializationComplete === true`; register in finally block after all async
  init operations complete
- Add initialization barrier: Implement function that blocks until
  `isFullyInitialized()` returns true with timeout; critical handlers call this
  on entry
- If not initialized, return error response from handler and queue for retry
- Add comprehensive logging: "INITIALIZATION_STARTED",
  "INITIALIZATION_COMPLETE", "LISTENER_REGISTERED", "LISTENER_DEFERRED",
  "INITIALIZATION_BARRIER_WAIT"

**Ensure:**

- All critical listeners registered only after init complete
- Listener entry always finds `isFullyInitialized() === true`
- No handlers execute before state ready
- Initialization barrier timeout prevents indefinite waits

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (initialization and listener setup): Move listener registrations to end of init sequence; add initialization barrier to critical handlers

**Do NOT Modify:**

- Initialization logic itself
- State reconciliation mechanisms
- Message handler implementations
- Storage read/write mechanisms </scope>

<acceptance_criteria>

- [ ] All listener registrations deferred until
      `initializationComplete === true`
- [ ] Listener entry logs include "LISTENER_ENTRY_INITIALIZATION_STATUS:
      [initialized/pending]"
- [ ] Zero log entries showing listeners firing before initialization
- [ ] Manual test: Reload sidebar → check logs for initialization sequence → no
      race logs
- [ ] Manual test: Stress test initialization with rapid storage changes → zero
      race condition errors </acceptance_criteria>

---

## Issue #7: Tab Affinity Map (quickTabHostInfo) — TTL Cleanup Doesn't Prevent Initial Accumulation

### Problem Summary

`quickTabHostInfo` Map stores associations between tabs and Quick Tabs. TTL
cleanup runs every 60 seconds, removing entries older than 24 hours. However,
entries accumulate indefinitely until first cleanup cycle (up to 24 hours). If
tab closes before Quick Tab deleted from Map, entry persists. Race condition
between browser.tabs.onRemoved and Manager operations leaves stale entries. Map
can grow unbounded in production.

### Root Cause

**Files affected:**

- `sidebar/quick-tabs-manager.js` (quickTabHostInfo Map management, TTL cleanup
  job)

**Issue:** TTL cleanup is eventual, not immediate. Entries created when tab
associated with Quick Tab; removed only when age exceeds 24 hours.
browser.tabs.onRemoved listener may fire async, race with operations, or
complete before Manager cleans up associated Map entry. No synchronous
validation that tabs still exist. Map entries can reference closed tabs
indefinitely until TTL expiration.

**Evidence:**

- quickTabHostInfo Map declared with no size limits
- TTL cleanup job runs every 60 seconds (600000ms cleanup interval)
- HOST*INFO_TTL_MS = 24 * 60 \_ 60 \* 1000 (86400000ms)
- No browser.tabs.onRemoved cleanup for quickTabHostInfo entries
- No logging of Map size or cleanup results

### Fix Required

Add prompt cleanup with race protection. Add timestamp to each Map entry.
Implement defensive cleanup before operations. Add diagnostic logging of Map
health.

**Required changes:**

- Add `lastUpdate` timestamp to each quickTabHostInfo entry (tracks when entry
  created/updated)
- Enhance cleanup job: Iterate through Map entries; remove any where
  `lastUpdate > 24 hours`; log size before/after
- Implement defensive cleanup: Before adding new entry, scan Map for closed tabs
  (cross-check against browser.tabs.query() results); remove stale entries
  proactively
- Add diagnostic logging: Every 60 seconds log "QUICKTABINFO_CLEANUP: {
  beforeSize, afterSize, removedCount, sampleEntryAges }"

**Ensure:**

- No unbounded Map growth over extended operation
- Stale entries cleaned quickly after tab close
- Diagnostic logging enables early detection of accumulation issues

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (Map entry structure, cleanup job, operation entries): Add lastUpdate timestamp; enhance cleanup; add defensive scan

**Do NOT Modify:**

- Browser API calls (tabs.query)
- Map usage in other functions
- Quick Tab operation logic
- TTL constant or cleanup interval </scope>

<acceptance_criteria>

- [ ] quickTabHostInfo entries include lastUpdate timestamp
- [ ] TTL cleanup removes entries older than 24 hours
- [ ] Defensive cleanup scans for closed tabs before new entries added
- [ ] Diagnostic log "QUICKTABINFO_CLEANUP" emitted every 60s with size metrics
- [ ] Manual test: Create 50 Quick Tabs, close all tabs → Map empty or
      near-empty after cleanup cycle
- [ ] Manual test: 24-hour operation → no unbounded growth logged
      </acceptance_criteria>

---

## Issue #8: Missing Comprehensive Logging — Silent Failures Across All Persistence Paths

### Problem Summary

Critical operations throughout state persistence architecture lack logging.
Storage writes have no pre-write logging. Message routing has no sequence
validation logs. Initialization has no completion signals. BroadcastChannel
fallback activation never logged. Port connection status never reported.
Corruption detection results never recorded. Extension produces silent failures:
operations execute but no diagnostic trail exists. Production failures
completely invisible.

### Root Cause

**Files affected:**

- `src/background/` (storage operations, message routing, initialization)
- `sidebar/quick-tabs-manager.js` (listeners, initialization, message handling)
- All modules with state persistence operations

**Issue:** Logging added sporadically, not systematically. Storage write
operations don't log operationId before write. Validation results not logged.
Message routing logs sequence but not queue state. Initialization lacks
timestamps and transition markers. BroadcastChannel fallback never logged.
Corruption recovery never logged. No unified logging format across modules.

**Evidence:**

- No "STORAGE_WRITE_START" logs with operationId + sequenceId
- No "STORAGE_VALIDATION_RESULT" logs (passed/failed/retry)
- Message sequence logged but "out of order" flag never logged
- No "INITIALIZATION_COMPLETE" log marking ready state
- No "BROADCASTCHANNEL_FALLBACK_ACTIVATED" logs
- No corruption recovery action logs

### Fix Required

Implement systematic logging harness across all persistence paths. Add
operation-level logging for storage, messaging, initialization, and recovery
flows.

**Required changes:**

- **Storage write path:** Log
  `[STORAGE] OPERATION_START: { operationId, sequenceId, expectedTabCount, timestamp }`
  before write; log
  `[STORAGE] OPERATION_RESULT: { operationId, success, actualTabCount, validationPassed, timestamp }`
  after validation
- **BroadcastChannel path:** Log gap detection with
  `[BROADCAST] SEQUENCE_GAP: { expected, received, gapSize, timestamp }`; log
  fallback with
  `[BROADCAST] FALLBACK_ACTIVATED: { reason, cacheSize, timestamp }`
- **Port messaging path:** Log
  `[PORT] MESSAGE_RECEIVED: { messageSequence, isOutOfOrder, queueSize, timestamp }`;
  log dequeue operations
- **Initialization path:** Log `[INIT] INITIALIZATION_STARTED: { timestamp }`;
  log each async operation completion; log
  `[INIT] INITIALIZATION_COMPLETE: { elapsedMs, timestamp }`; log listener
  registration with init status
- **Corruption recovery:** Log
  `[CORRUPTION] DETECTED: { operationId, expectedHash, actualHash, timestamp }`;
  log `[CORRUPTION] RECOVERY_ATTEMPTED: { source, success, timestamp }`

**Ensure:**

- Every state mutation has unique operationId traceable through system
- All timestamps consistent format (ISO 8601 or consistent epoch)
- Logs include contextual state (cache size, message count, etc.)
- Grep-able format: consistent "COMPONENT EVENT_TYPE: { fields }"

<scope>
**Modify:**
- `src/background/` (all storage operations, port handlers, initialization): Add comprehensive logging at operation boundaries
- `sidebar/quick-tabs-manager.js` (all listeners, initialization, message handlers): Add comprehensive logging
- All modules with state mutations: Add operationId generation and logging

**Do NOT Modify:**

- Business logic
- Message structures
- Listener implementations
- State update algorithms </scope>

<acceptance_criteria>

- [ ] Every storage operation logs before-write with operationId + sequenceId +
      expected state
- [ ] Every message routed logs messageSequence + queue state + outcome
- [ ] Initialization logs start/complete with elapsed time
- [ ] Corruption detected/recovered logged with operationId + action
- [ ] BroadcastChannel fallback activation logged with reason + cache state
- [ ] Manual test: 10 rapid tab creates → grep logs show all operations with
      operationIds, no gaps
- [ ] Manual test: Corrupt storage → grep logs show detection, recovery, success
- [ ] All logs follow consistent format:
      `[Component] EVENT_NAME: { field1, field2, timestamp }`
      </acceptance_criteria>

---

## Supporting Context

<details>
<summary>Firefox Storage Corruption Bug References (Issue #5 Context)</summary>

**Bug 1979997:** IndexedDB storage for WebExtension becomes corrupted and
inaccessible

- Affects Firefox 102+
- Symptom: storage.local.get() returns empty {} instead of stored data
- Root cause: IndexedDB backend corruption on unclean shutdown
- Workaround (not implemented): Set pref
  `extensions.webextensions.keepStorageOnCorrupted = true`
- Status: WONTFIX (design limitation)
- Impact: Users lose all Quick Tabs after unexpected shutdown

**Bug 1885297:** WebExtension storage corruption after unclean shutdown

- Affects Firefox 115+
- Symptom: Partial data loss (some keys readable, others return null)
- Root cause: Incomplete transaction recovery in IndexedDB backend
- Workaround (not implemented): Manual profile backup/restore
- Status: Open
- Impact: Users lose subset of Quick Tabs; state inconsistency

The extension has no mitigation for either bug. Implementing automatic sync
backup restore (Issue #5 fix) provides recovery path without requiring manual
intervention or Firefox workaround prefs.

</details>

<details>
<summary>MDN API Documentation References</summary>

**runtime.Port (MDN):** "Port messages may be reordered. Extensions should not
assume that messages will be delivered in the same order they were sent."

- Source:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/Port
- Impact: Justifies Issue #4 (Port message reordering logic required)

**runtime.onConnect (MDN):** Listener fires when port connection initiated from
external page/script to extension.

- Sidebar uses runtime.connect() to initiate connection
- Background must register runtime.onConnect listener before connection attempt
- Impact: Justifies Issue #1 (Port connection infrastructure required)

**storage.onChanged (MDN):** "Called when one or more items change. For details
of what changed and its new value, you would need to call storage.get()."

- No ordering guarantee documented
- Multiple sequential storage.set() calls may trigger onChanged out of order
- Impact: Justifies Issue #3 (Sequence validation required)

**BroadcastChannel (W3C spec):** "Send messages between different documents, or
between a document and a shared worker or service worker."

- Only works between browsing contexts (windows, tabs, iframes) of same origin
- WebExtension sidebar is not a standard browsing context
- Impact: Justifies Issue #2 (BroadcastChannel architectural mismatch)

</details>

<details>
<summary>Common Patterns in Root Cause Analysis</summary>

All eight issues exhibit consistent pattern: **Partial implementation with
missing integration**

- **Issue #1:** Connection infrastructure (runtime.connect/onConnect) exists but
  never called/set up
- **Issue #2:** BroadcastChannel implemented but not viable for sidebar;
  architecture doesn't adapt
- **Issue #3:** Sequence IDs generated and stored; validation gate not wired
- **Issue #4:** Message counter incremented; reordering queue never created
- **Issue #5:** Validation logic built; recovery not triggered for subtle
  corruption
- **Issue #6:** Initialization guards added; listener registration not deferred
- **Issue #7:** Cleanup job implemented; defensive scan never added
- **Issue #8:** Logging calls scattered; systematic logging framework missing

**Pattern:** Infrastructure exists, behavioral integration missing. Fixes
require wiring components together, not new architecture. This suggests code
review approved patterns ("good idea to add checksum") without verifying
integration of the pattern throughout system ("checksum never compared").

</details>

---

## Related Context: Why These Issues Coexist

These eight issues coexist because they stem from incomplete integration during
a multi-phase refactor or feature addition:

1. **Phase 1:** Advanced features designed (sequence IDs, checksums, reordering,
   TTL cleanup)
2. **Phase 2:** Infrastructure added (fields, counters, flags, timeouts)
3. **Phase 3:** Incomplete - validation gates, recovery callbacks, message
   queues, logging not wired

Result: Code review passes each component ("good pattern"), but integration
failures aren't caught because integration tests don't exercise full flows under
stress or adverse conditions.

Recommendation: Add integration tests exercising:

- Storage ordering under simulated event reordering
- Port messaging with forced out-of-order delivery
- Corruption detection with simulated IndexedDB failures
- Initialization with overlapping storage.onChanged events
- Full state persistence flows with all paths active simultaneously

---

**Priority:** Critical (Issues #1, #2, #3, #5), High (Issues #4, #6, #8), Medium
(Issue #7) | **Dependencies:** None (independent fixes) | **Complexity:** High
(integration work across multiple modules; requires systematic logging
framework)

**Estimated Impact:** Fixes will eliminate 80%+ of silent failures, enable
comprehensive diagnosis of remaining issues, prevent permanent state divergence,
and restore sidebar functionality.
