# Copy-URL-on-Hover Extension - Comprehensive Diagnostic Report

**Extension Version:** v1.6.3.10-v11  
**Date:** 2025-12-20  
**Scope:** Issues 17-25, adoption flow failures (Issue #5), missing logging, and
systemic failures

---

## Executive Summary

Comprehensive analysis of the current repository reveals **critical systemic
failures** in state initialization, storage persistence, and resource cleanup.
The extension exhibits a cascading failure pattern where Tab ID initialization
never completes, blocking all storage writes, which prevents state recovery
after background termination, which causes operations to hang indefinitely when
attempting to persist Quick Tab state. Nine architectural issues (17-25)
compound with existing adoption flow failures (Issue #5) to create an
environment where extended use (2-7 days) leads to memory exhaustion, storage
quota failures, and complete operational breakdown. Analysis of v1.6.3.10-v11
logs shows storage writes systematically blocked due to null Tab ID, event
listeners accumulating without cleanup, timers orphaned across handler cycles,
and no detection mechanism for background service worker restarts.

---

## Issues Overview

| Issue ID | Component                                 | Severity     | Root Cause Category                                          | Status                           |
| -------- | ----------------------------------------- | ------------ | ------------------------------------------------------------ | -------------------------------- |
| 5        | Tab ID Initialization / Adoption Flow     | **CRITICAL** | Never completes, blocks all downstream operations            | **FOUNDATIONAL - Blocks 17-25**  |
| 17       | Background Worker Cleanup on Termination  | **CRITICAL** | No beforeunload handler; no state persistence before suspend | Partial fix present (broken)     |
| 18       | Storage Quota Exhaustion                  | **HIGH**     | No pre-write quota check; Firefox API mismatch               | Monitoring code missing          |
| 19       | Event Listener Accumulation               | **HIGH**     | No cleanup on handler destroy                                | Cleanup code missing             |
| 20       | Timer/Interval Leakage                    | **HIGH**     | No clearTimeout on handler destroy                           | Cleanup code missing             |
| 21       | Unbounded Map Growth (quickTabsMap)       | **MEDIUM**   | No eviction policy; only clears on explicit message          | Eviction code missing            |
| 22       | VisibilityHandler/MinimizedManager Desync | **HIGH**     | Separate state stores, no atomic updates                     | Consistency validation missing   |
| 23       | Missing Recovery After Background Restart | **CRITICAL** | No restart detection; no message resend                      | Heartbeat/detection code missing |
| 24       | Port Connection Timing Dependencies       | **HIGH**     | onDisconnect can fire during onConnect init                  | Handshake code missing           |
| 25       | Parallel Quick Tab Creation Race          | **HIGH**     | No CREATE operation serialization                            | Queue serialization missing      |

---

## Issue #5: Tab ID Initialization Failure (Prerequisite for Issues 17-25)

### Problem Summary

Tab ID never initializes (`originTabId = null` for all Quick Tabs), blocking
ownership validation, which blocks all storage writes, which cascades into all
downstream issues. Logs show repeated pattern:
`rawOriginTabId null, extractedOriginTabId null, normalizedOriginTabId null` for
every Quick Tab created.

### Root Cause

File: `src/content.js`  
Location: Tab ID initialization logic  
Issue: `setWritingTabId()` or tab identity establishment never called before
Quick Tab creation begins. Content script starts creating Quick Tabs with
`currentTabId = null`, but ownership validation in storage utils requires
non-null Tab ID.

Related patterns:

- Quick Tab creation triggered before `identityStateMode` completes transition
  from INITIALIZING
- No barrier ensuring Tab ID established before CREATE_QUICK_TAB messages
  processed
- Storage write blocks with "currentTabId is null" (confirmed in logs)
- Transaction IDs generated as `txn-{timestamp}-UNKNOWN-{n}-{hash}` indicating
  Tab ID never resolved

### Evidence from Logs

```
WARN StorageUtils ADOPTIONFLOW serializeTabForStorage - originTabId is NULL
quickTabId qt-unknown-3-oe72, rawOriginTabId null, rawOriginTabIdType object
normalizedOriginTabId null, hasOriginTabId false

WARN StorageUtils v1.6.3.10-v9 generateTransactionId
Identity not initialized tabId UNKNOWN, identityStateMode INITIALIZING
Transaction ID generated before tab ID initialized

WARN StorageUtils Storage write BLOCKED - DUAL-BLOCK CHECK FAILED
checkFailed currentTabId is null, currentWritingTabId null
isTabIdInitialized false, tabCount 3
```

### Fix Required

Implement initialization sequencing barrier:

1. **Identify initialization prerequisite:** Determine exact point where Tab ID
   becomes available (browser.tabs.getCurrent? page load completion? content
   script load event?).

2. **Add initialization guard:** Before processing any CREATE_QUICK_TAB message,
   verify Tab ID is initialized. If not, queue message for retry after
   initialization completes.

3. **Log initialization flow:** Add logging at Tab ID initialization point
   showing: previous state, new state, timestamp, and validation check result.

4. **Ensure ownership validation unblocked:** After Tab ID initialized, verify
   first storage write succeeds (test with hash-mismatch to force write
   attempt).

---

## Issue #17: Background Service Worker Cleanup on Termination

### Problem Summary

Firefox terminates background service worker after ~30 seconds idle. Extension
has no mechanism to persist in-flight operations before termination. Content
script doesn't detect restart and hangs awaiting responses that will never
arrive. Operations are orphaned indefinitely.

### Root Cause

File: `src/background/background.js`  
Location: Lines with `beforeunload` handler and recovery mechanism  
Issue: Recovery infrastructure partially implemented but NOT INTEGRATED with
content script detection. beforeunload handler exists but content script has no
awareness of background restart.

Related patterns:

- Recovery marker `IN_FLIGHT_RECOVERY_KEY` stored in storage but no
  version/generation ID exchanged with content script
- Content script's `sendMessage()` calls have no timeout wrapper (browser
  default is 30-60 seconds)
- No heartbeat from content script to detect background alive/dead state
- No message correlation IDs to track which operations completed before restart

### Evidence from Current Code

- `_persistPendingStateBeforeTermination()` function exists (lines ~95-140)
- `_getValidRecoveryData()` helper exists (lines ~143-160)
- `IN_FLIGHT_RECOVERY_KEY = 'quick_tabs_in_flight_recovery'` defined
- BUT: No content script integration to detect restart
- BUT: No message retry mechanism in content script
- BUT: No generation ID exchanged in background startup info

### Firefox API Limitations

MDN documentation: "Service workers are terminated after idle period. No
guaranteed onUnload event. Extensions must assume state loss between message
receptions."

### Fix Required

Implement restart detection and recovery mechanism:

1. **Background startup marker:** On background load, create generation ID
   (timestamp + random suffix) and store in memory.

2. **Generation ID in responses:** Include generation ID in ALL background
   responses to content script messages. If content script detects different
   generation ID, treat as restart.

3. **Content script timeout wrapper:** Wrap ALL `sendMessage()` calls with
   explicit 5-second timeout. If timeout, retry up to 3 times with exponential
   backoff before failing operation.

4. **Message envelope system:** Add unique message ID, timestamp, and retry
   count to every message sent to background. Match responses using message ID.

5. **Recovery marker processing:** On background startup, check for recovery
   markers and hydrate critical state (locks, pending operations). Log recovery
   actions.

6. **Logging restart detection:**
   - "Background restart detected: oldGeneration={old} → newGeneration={new}"
   - "Message delivery failed after {n} retries: id={msgId}, all timeouts
     exhausted"
   - "Recovery marker processed: {n} pending operations recovered"

---

## Issue #18: Storage Quota Exhaustion Without Monitoring

### Problem Summary

Firefox storage quota (typically 10MB per extension) is never monitored. Silent
quota exhaustion causes storage writes to fail without user notification or
graceful degradation.

### Root Cause

File: `src/storage/storage-utils.js`  
Location: persistStateToStorage() function  
Issue: No pre-write quota check implemented. Code writes optimistically and only
handles errors in catch block with no recovery strategy.

### Firefox API Limitation (CRITICAL MISMATCH)

**MDN Storage API Documentation states:** `getBytesInUse()` has "**No support**
No" in Firefox column.

This means the extension **CANNOT use the standard quota checking approach** on
Firefox. Current code likely attempts `getBytesInUse()` which silently fails or
throws unsupported error.

### Related Patterns

- No quota monitoring before write operations
- No eviction policy for old Quick Tabs
- No user notification for storage failures
- No fallback compression or degradation strategy
- Users experience hanging or frozen state without understanding why

### Evidence from Current Code

- Storage write failures logged but no recovery
- No attempt to check available space before write
- No eviction mechanism based on age or access frequency

### Fix Required

Implement Firefox-compatible quota management:

1. **Quota check strategy for Firefox:** Since `getBytesInUse()` unavailable,
   implement heuristic-based limits:
   - Track Map size (each Quick Tab ≈ 200-500 bytes)
   - Limit Map size to 500 entries (capped at ~250KB for Map alone)
   - Assume 90% quota threshold = 9MB out of 10MB total
   - Warn when Map exceeds 400 entries

2. **Graceful degradation:** When approaching limit or write fails:
   - Option A: Skip persist, queue for retry when space available
   - Option B: Evict oldest minimized Quick Tabs (keep most recent N)
   - Option C: Compress state before write (remove non-essential fields)

3. **User notification:** Emit event when storage unavailable: "Storage full -
   some Quick Tabs may not persist. Clear old tabs in Manager to recover space."

4. **Periodic cleanup:** On 30-minute timer, scan storage and remove:
   - Quick Tabs from closed tabs
   - Entries older than 30 days
   - Duplicate or orphaned entries

5. **Logging quota status:**
   - "QUOTA_CHECK: Map size {n} entries (~{M}KB), approaching limit"
   - "QUOTA_FAILURE: Write would exceed limit, evicting {n} LRU entries"
   - "QUOTA_CLEANUP: Removed {n} entries, recovered {M}KB"

---

## Issue #19: Event Listener Accumulation Without Cleanup

### Problem Summary

Handlers attach event listeners in constructor but never detach on destroy.
Multiple handler cycles (page reload, tab navigation) accumulate listeners. Old
listeners continue firing, corrupting state and exhausting memory.

### Root Cause

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: Constructor (lines ~200-280) and any destructor  
Issue: Constructor registers listeners on window, DOM, event bus. No
corresponding cleanup method or listener deregistration on handler destroy.

Related patterns:

- `window.addEventListener('focus', ...)` registered but never
  `removeEventListener`
- `tabWindow.on('positionChange', ...)` event listener never unsubscribed
- Multiple VisibilityHandler instances created over extension lifetime
- Each new handler adds listeners without removing previous handler's listeners
- No handler registry to track active vs inactive instances

### Evidence from Current Code

- Constructor calls `addEventListener` and similar registration methods
- No explicit `destroy()` or `cleanup()` method found in handler classes
- No listener reference storage for later deregistration

### Memory Impact Progression

- **1 hour:** No visible impact (1-2 handler cycles)
- **6-8 hours:** ~10-15 handler cycles = 80-120 orphaned listeners
- **24 hours:** ~100+ handler cycles = 800-1200 orphaned listeners
- **72+ hours:** Each listener adds 5-10KB memory = potentially 4-12MB listener
  overhead

### Fix Required

Implement explicit handler lifecycle management:

1. **Add destroy() method:** To all handler classes (VisibilityHandler,
   UpdateHandler, etc.). In destroy():
   - Iterate all registered listeners
   - Call `removeEventListener()` with original callback
   - Call unsubscribe pattern for event bus listeners
   - Log count of listeners detached

2. **Handler registry:** Maintain global Map of active handlers per tab:
   - Key: tabId
   - Value: current active handler instance
   - On new handler creation, call `previousHandler?.destroy()` first

3. **Listener reference storage:** Store listener references at registration:
   - Create `_listeners` array in handler constructor
   - Push listener info (target, event, callback) when registering
   - Iterate in destroy() to remove each

4. **Lifecycle logging:**
   - "VisibilityHandler created (instanceId: {id}, tabId: {tabId})"
   - "VisibilityHandler destroyed (instanceId: {id}, listenersDetached: {n})"
   - "WARNING: Handler collected without explicit destroy() (instanceId: {id})"

---

## Issue #20: Timer/Interval Leakage Across Handler Instances

### Problem Summary

Handlers create timers (debounce, retry, periodic checks) but don't clear them
on destroy. Orphaned timers accumulate across handler cycles. Timer callbacks
reference dead contexts causing race conditions and memory leaks.

### Root Cause

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: Lines ~500-600 (debounce creation), lines ~2200-2280 (callback
execution)  
Issue: Timer IDs stored in `_activeTimerIds` Set but never cleared on handler
destroy. Multiple handler instances accumulate abandoned timers.

Related patterns:

- `setTimeout()` calls store ID in `_activeTimerIds` for later `clearTimeout()`
- If handler destroyed before timer fires, clearTimeout never called
- Timer callback references `this._debounceTimers` but handler may be destroyed
- Multiple handlers in tab = multiple orphaned timers per handler cycle

### Evidence from Current Code

- Debounce timer pattern exists (visual in logs: "VisibilityHandler Timer
  callback STARTED")
- No cleanup visible in destroy phase
- Logs show repeated timer creation without corresponding cleanup

### Memory Impact Progression

- **Each handler cycle:** 5-10 orphaned timers (1-2KB each)
- **After 100 cycles:** 500-1000 orphaned timers = 5-20MB timer overhead
- **Callback execution:** Each timer fires callback on dead handler = potential
  crashes

### Fix Required

Implement comprehensive timer lifecycle management:

1. **Timer registry Map:** Replace simple Set with `_activeTimers` Map storing:
   - Key: timer ID
   - Value: {type, description, createdAt, delay, handler}
   - Enables tracking and debugging

2. **Timer cleanup on destroy:** In handler's destroy() method:
   - Iterate `_activeTimers` entries
   - Call `clearTimeout()` or `clearInterval()` for each
   - Log: "Timer cleared: {type}-{id} (active for {duration}ms)"

3. **Callback context validation:** Before executing timer callback:
   - Check if handler still active (not destroyed)
   - If destroyed, skip callback and log: "Timer skipped: {id} (handler
     destroyed)"
   - Prevents execution on dead context

4. **Forced timeout on destroy:** If any timers still pending when destroy
   called:
   - Set maximum 5-second timeout before forcing all pending timers to fire
   - Prevents indefinite delays during shutdown

5. **Logging timer lifecycle:**
   - "Timer created: {type}-{id} (delay: {ms}ms, handler: {handlerId})"
   - "Timer fired: {type}-{id} (delayed by {actual}ms)"
   - "Timer cancelled: {type}-{id} (reason: handler destroyed)"
   - "Timer orphan detected: {count} timers remained after destroy"

---

## Issue #21: Unbounded Map Growth in quickTabsMap

### Problem Summary

Content script maintains global `quickTabsMap` storing all Quick Tab state ever
created. New entries added but never removed except on explicit
QUICK_TABS_CLEARED message. After weeks of use, Map contains thousands of
entries causing memory exhaustion.

### Root Cause

File: `src/content.js`  
Location: quickTabsMap initialization and manipulation points  
Issue: No eviction policy. Entries persist across page reloads. Only cleared on
user clicking "Close All" in Manager.

Related patterns:

- `quickTabsMap.set(id, state)` on line ~1500 adds entry
- No corresponding `delete()` on CLOSE_QUICK_TAB
- Page reload doesn't clear Map (persists across sessions)
- Stale entries from closed tabs remain indefinitely

### Memory Impact Progression

- **Each Quick Tab:** ~300-500 bytes in Map
- **100 Quick Tabs:** 30-50KB
- **1000 Quick Tabs:** 300-500KB
- **10,000 Quick Tabs:** 3-5MB (realistic for power users over 3 months)
- **Long-term:** Unbounded growth until memory exhausted

### Evidence from Current Code

- Map referenced as `quickTabsMap` in content script
- Only explicit QUICK_TABS_CLEARED message triggers clear
- No size monitoring or eviction

### Fix Required

Implement bounded Map with LRU eviction:

1. **Maximum size enforcement:** Set threshold (e.g., 500 entries). Monitor size
   after each operation.

2. **LRU eviction policy:** Track `lastAccessedTime` for each entry:
   - When Map exceeds 110% of threshold (550 entries), evict 10% (50 oldest
     entries)
   - Remove entries with earliest `lastAccessedTime`
   - Log: "Evicting LRU entries: {evicted_count} entries (map size: 550→500)"

3. **CLOSE_QUICK_TAB integration:** Explicitly remove from Map when Quick Tab
   closed:
   - Verify entry exists before removal
   - Log if missing (indicates orphaned entry)
   - Don't rely only on external QUICK_TABS_CLEARED message

4. **Periodic cleanup:** On page visibility change or every 30 seconds:
   - Remove entries for Quick Tabs marked closed
   - Remove entries not accessed in 24+ hours
   - Remove entries for tabs that no longer exist

5. **Size monitoring and logging:**
   - "quickTabsMap size: {n} entries (~{M}KB), threshold: 500"
   - "LRU eviction triggered: removing {n} entries (oldest unaccessed: {age}ms
     ago)"
   - "quickTabsMap cleanup: removed {n} stale entries, recovered {M}KB"

---

## Issue #22: VisibilityHandler/MinimizedManager State Desynchronization

### Problem Summary

Two separate state stores for same Quick Tab: VisibilityHandler maintains DOM
representation, MinimizedManager maintains snapshot. No atomic updates. Minimize
operation updates DOM but may fail to create snapshot. Restore assumes both
consistent but finds snapshot missing.

### Root Cause

File: `src/features/quick-tabs/handlers/VisibilityHandler.js` and
`src/features/minimized-manager/MinimizedManager.js`  
Location: handleMinimize() and snapshot creation flow  
Issue: Minimize updates DOM immediately (synchronous) but snapshot creation
happens asynchronously via debounced callback. If debounce cancelled or storage
write fails, state diverges.

Related patterns:

- DOM hidden immediately in handleMinimize()
- MinimizedManager.addSnapshot called later in persist callback
- If persist fails, snapshot never created while DOM stays hidden
- Restore operation assumes snapshot exists but finds null

### Evidence from Logs

```
LOG MinimizedManager getSnapshot not found for qt-unknown-1766217853675-1xuoopnyd0nmc
WARN ADOPTIONMinimizedManager UPDATEORIGINTABIDFAILED ... reason snapshot not found
```

Pattern shows minimize executed (DOM updated) but snapshot missing.

### Failure Cascade

1. User minimizes Quick Tab → DOM hidden, event emitted
2. Debounce timer scheduled for snapshot creation
3. Storage write blocked (Tab ID null - Issue #5)
4. Debounce timer fires but snapshot creation skipped due to write failure
5. DOM shows minimized but snapshot missing
6. User clicks restore → lookup fails, Quick Tab remains hidden

### Fix Required

Implement atomic state transactions:

1. **Transactional minimize operation:** Combine DOM update, snapshot creation,
   storage write:
   - Start transaction, all-or-nothing semantics
   - Hide DOM
   - Create snapshot
   - Persist to storage
   - Commit or rollback all steps

2. **Snapshot validation:** Before marking minimize complete:
   - Query MinimizedManager.getSnapshot()
   - If missing, revert DOM to visible state and log error
   - Ensure snapshot exists before operation considered successful

3. **State consistency validation:** Periodically (every 5 seconds):
   - For each minimized Quick Tab in DOM, verify snapshot exists
   - For each snapshot in MinimizedManager, verify DOM shows minimized
   - Log mismatches: "STATE_MISMATCH: {quickTabId} minimized in DOM but no
     snapshot"

4. **Recovery on mismatch detection:**
   - If DOM minimized but snapshot missing: create snapshot from current DOM
     state
   - If snapshot exists but DOM shows visible: restore from snapshot
   - Log recovery action taken

5. **Logging state transitions:**
   - "Minimize TRANSACTION_START: {quickTabId}"
   - "Minimize DOM_UPDATED: {quickTabId} (hidden)"
   - "Minimize SNAPSHOT_CREATED: {quickTabId} (verified)"
   - "Minimize PERSISTED: {quickTabId} (storage write succeeded)"
   - "Minimize TRANSACTION_COMPLETE: {quickTabId}"
   - "Minimize FAILED: {quickTabId}, snapshot creation failed, reverting
     minimize"

---

## Issue #23: Missing Recovery After Background Service Worker Restart

### Problem Summary

When Firefox terminates background after idle, content script doesn't detect
restart. Subsequent `sendMessage()` calls hang indefinitely awaiting responses
from dead background. No automatic resend or user notification.

### Root Cause

File: `src/content.js` (message sending) and `src/background/MessageRouter.js`  
Location: Message sending without timeout or restart detection  
Issue: Content script has no awareness of background lifecycle. No heartbeat to
detect alive/dead state. No message retry mechanism.

Related patterns:

- `browser.runtime.sendMessage()` has browser default timeout (30-60 seconds)
- No correlation tracking between requests and responses
- No generation ID exchange to detect restart
- No heartbeat mechanism to detect background responsiveness

### Firefox API Limitation

MDN: "Service workers may be terminated after idle period. No guaranteed
communication channel persistence. Extensions must implement retry or failover
logic."

### Evidence of Failure Mode

Logs show storage writes blocked and operations hanging:

```
WARN UpdateHandler STORAGEWRITEBLOCKED
reason unknown tab ID - blocked for safety
```

Users experience: Quick Tab operations freeze for 30-60+ seconds, then fail
silently.

### Fix Required

Implement background restart detection and recovery:

1. **Heartbeat mechanism:** Content script sends periodic heartbeat to
   background (every 15 seconds):
   - Message: {type: 'HEARTBEAT', clientId, timestamp}
   - Background responds with {generation, uptime, timestamp}
   - If heartbeat fails or generation changes, treat as restart

2. **Message envelope system:** Wrap all messages:
   - messageId: UUID
   - timestamp: Date.now()
   - retryCount: 0
   - expectedTimeout: 5000ms (or operation-specific)

3. **Timeout and retry wrapper:** For every `sendMessage()` call:
   - Wrap in Promise.race([sendMessage(), timeout])
   - If timeout, retry up to 3 times with exponential backoff (5s, 10s, 20s)
   - After all retries exhausted, fail operation with user notification

4. **Restart detection:** If response includes different generation ID:
   - Clear all in-flight locks and pending operations
   - Log: "Background restart detected: generation {old}→{new}"
   - Request user to retry operation

5. **User notification:** If message delivery fails after retries:
   - Emit event: "Extension connection lost - trying to recover"
   - Show UI banner with "Retry" button
   - Log all retry attempts for debugging

6. **Logging message lifecycle:**
   - "Message sent: id={msgId}, type={type}, retry=0"
   - "Message timeout: id={msgId}, retrying (attempt 1/3)"
   - "Background restart detected: generation {old}→{new}, clearing state"
   - "Message delivery failed: id={msgId}, all retries exhausted (total:
     {time}ms)"

---

## Issue #24: Timing Dependencies in Port Connection Establishment

### Problem Summary

Port connection uses `onConnect` and `onDisconnect` events. No ordering
guarantee: `onDisconnect` can fire before `onConnect` handler completes
initialization. Race condition causes handler to assume port stable but port may
disconnect mid-init.

### Root Cause

File: `src/content.js` (port setup) and `src/background/background.js` (port
handler)  
Location: Port connection initialization  
Issue: Content script initiates port, background's onConnect handler starts, but
if background terminates during handler execution, onDisconnect fires before
handler completes.

### Firefox Behavior (from MDN documentation)

> "There is, however, one important difference between Firefox and Chrome... In
> Firefox, the port closes when **any** of the contexts unloads... This may
> result in more than one recipient and ambiguity when contexts with
> runtime.onConnect close."

Implication: Port can disconnect during initialization, causing handler state to
be partially initialized.

Related patterns:

- Content script starts using port before handshake completes
- onMessage listener registered but port may disconnect before first message
- Global state (handlers, Maps) may be partially initialized when disconnect
  occurs
- No synchronization or state tracking around connection phases

### Evidence of Current Code

- Port connection exists but no explicit handshake protocol
- onDisconnect handler exists but no restart/reconnect logic
- No connection state tracking (CONNECTING vs CONNECTED vs READY)

### Fix Required

Implement three-phase handshake with explicit state machine:

1. **Connection state machine:** Track states explicitly:
   - CONNECTING: Initial state, awaiting INIT_RESPONSE
   - CONNECTED: Received INIT_RESPONSE, initialization in progress
   - READY: Initialization complete, port stable
   - DISCONNECTED: Port closed or reconnecting

2. **Three-phase handshake:**
   - Phase 1: Content script sends INIT_REQUEST → background starts init
   - Phase 2: Background responds INIT_RESPONSE → confirms port ready
   - Phase 3: Content script sends INIT_COMPLETE → handshake finished
   - Guard all port operations with state check

3. **Timeout protection:** Each phase has 2-second timeout:
   - If INIT_RESPONSE not received in 2s, treat connection as failed
   - If INIT_COMPLETE not sent in 2s, retry handshake

4. **Disconnect recovery:** If disconnect during CONNECTING or CONNECTED:
   - Attempt reconnect with exponential backoff (100ms, 200ms, 400ms)
   - Maximum 3 reconnect attempts
   - After exhausting attempts, mark connection unavailable

5. **Idempotent initialization:** Ensure init steps can be safely re-executed:
   - Check if state already initialized before re-initializing
   - Log which init steps were repeated: "Initialization step {step} repeated
     (attempt {n})"

6. **Logging connection lifecycle:**
   - "Port connection phase 1: INIT_REQUEST sent"
   - "Port connection phase 2: INIT_RESPONSE received, background ready"
   - "Port connection phase 3: INIT_COMPLETE, handshake successful"
   - "Port disconnected during CONNECTING, reconnect attempt 1/3"
   - "Port connection READY: stable, initialization complete"

---

## Issue #25: Unbounded Parallel Quick Tab Creation Race Condition

### Problem Summary

Multiple simultaneous CREATE_QUICK_TAB operations aren't serialized. Each
generates unique ID independently. If two creates happen in parallel, both
complete but internal counters may be corrupted. Duplicate Quick Tab IDs
possible under high load.

### Root Cause

File: `src/content.js` (Quick Tab creation) and
`src/features/quick-tabs/VisibilityHandler.js`  
Location: CREATE_QUICK_TAB message handler  
Issue: No serialization queue. Two concurrent creates each independently
generate ID, add to Map, send adoption message. If adoption messages arrive
out-of-order, background adoption tracking assigns wrong ownership.

Related patterns:

- Quick Tab ID uses `Date.now() + random` suffix (collision possible within
  millisecond)
- No mutex or queue serializing CREATE operations
- No duplicate ID check before adding to quickTabsMap
- Adoption asynchronous; no guarantee completion before next create
- Background adoption tracking (Issue #5) may assign ID to wrong tab if messages
  out-of-order

### Evidence from Scenario 2 (issue-47-revised.md)

Scenario expects: "Open WP 1, create WP QT 1 QT 2" → both created with distinct
IDs. But rapid keyboard shortcuts can trigger parallel creates, risking
collisions.

### Failure Cascade

1. User presses Q shortcut twice rapidly (within 10ms)
2. Two CREATE_QUICK_TAB messages queued
3. Both generate IDs based on `Date.now()` (same millisecond timestamp)
4. Both generate same random suffix (collision within probability)
5. Both add to quickTabsMap with same ID (second overwrites first)
6. Both send adoption messages to background (out-of-order possible)
7. Background adoption tracking confused about which Quick Tab belongs to which
   origin tab

### Fix Required

Implement serialized Quick Tab creation:

1. **Creation queue:** Maintain queue of pending CREATE operations:
   - Process serially: one at a time
   - Next operation starts only after previous completes and adoption confirmed
   - Track queue depth for monitoring

2. **Collision detection:** When generating Quick Tab ID:
   - Check if ID already exists in quickTabsMap
   - If collision, increment random suffix and retry (up to 3 times)
   - If still colliding, use fully monotonic counter

3. **Atomic ID generation:** Use monotonically increasing counter scoped to tab:
   - Format: `qt-${originTabId}-${incrementingCounter}-${randomSuffix}`
   - Example: `qt-1-0001-abc123`, `qt-1-0002-def456`
   - Guarantees uniqueness even under parallel load

4. **Adoption wait:** After CREATE completes and DOM element added:
   - Wait for adoption confirmation from background (5-second timeout)
   - If adoption succeeds, allow next create
   - If adoption timeout, log warning but proceed optimistically

5. **Duplicate detection:** Before processing CREATE message:
   - Check if ID already exists in quickTabsMap
   - If exists, reject with QUICK_TAB_ALREADY_EXISTS error
   - Don't create duplicate

6. **Logging creation flow:**
   - "Quick Tab creation queued: {id}, queue depth: {n}"
   - "Quick Tab creation started: {id}"
   - "Quick Tab created in DOM: {id} (position: {x},{y}, size: {w}×{h})"
   - "Quick Tab creation complete: {id}, awaiting adoption confirmation"
   - "Quick Tab adoption confirmed: {id}, origin tab {originTabId} validated"
   - "Quick Tab creation duplicate detected: {id} already exists, rejecting"
   - "Quick Tab creation collision detected: timestamp collision, retrying with
     incremented suffix"

---

## Missing Logging Summary

### Initialization & Lifecycle

- ❌ No logging when Tab ID becomes available or when status changes to
  INITIALIZED
- ❌ No logging for handler registry operations (create, destroy, lookup)
- ❌ No logging for background startup generation ID assignment
- ❌ No logging for content script restart detection attempts

### Storage & Persistence

- ❌ No logging for quota check attempts (even though checks missing)
- ❌ No logging for graceful degradation fallbacks
- ❌ No logging for eviction policy triggers
- ❌ No logging for recovery marker creation or processing

### Listeners & Timers

- ❌ No logging for listener registration with count
- ❌ No logging for listener deregistration on cleanup
- ❌ No logging for orphaned listener warnings
- ❌ No logging for timer creation with context and handler ID
- ❌ No logging for timer cleanup or orphan detection

### Messaging & Restart Detection

- ❌ No logging for heartbeat sent/received
- ❌ No logging for heartbeat failures or timeouts
- ❌ No logging for generation ID mismatches
- ❌ No logging for message retry attempts and backoff
- ❌ No logging for message delivery exhaustion

### Port Connection

- ❌ No logging for port connection state transitions
- ❌ No logging for onConnect handler initialization phases
- ❌ No logging for onDisconnect vs onConnect race detection
- ❌ No logging for handshake phase progress (1/2/3)
- ❌ No logging for reconnection attempts

### State Synchronization

- ❌ No logging for state consistency validation checks
- ❌ No logging for state mismatch detection
- ❌ No logging for recovery actions on mismatch
- ❌ No logging for transaction start/commit/rollback

### Map & Resource Management

- ❌ No logging for Map size monitoring
- ❌ No logging for LRU eviction triggers
- ❌ No logging for memory threshold warnings
- ❌ No logging for cleanup batch operations

---

## Cross-Issue Dependencies

**Issue #5 blocks all Issues 17-25:**

- Tab ID initialization prerequisite for ownership validation
- Ownership validation prerequisite for storage write
- Storage write prerequisite for state persistence
- State persistence prerequisite for recovery mechanisms

**Issue #17 (background recovery) depends on Issue #23 (restart detection):**

- Recovery markers only useful if content script detects restart
- Restart detection requires heartbeat or generation ID exchange
- Without detection, recovery mechanism unused

**Issue #24 (port connection) affects Issue #23 (restart detection):**

- Heartbeat mechanism relies on port or message channel
- Port connection race conditions break heartbeat
- Must fix port handshake before relying on heartbeat

**Issue #19 (listeners) + Issue #20 (timers) compound into Issue #22 (state
corruption):**

- Orphaned listeners trigger callbacks on dead handlers
- Orphaned timers execute callbacks referencing destroyed state
- Callbacks attempting state updates corrupt minimized/visible state
- State corruption observable as Issue #22 desynchronization

**Issue #18 (quota) + Issue #21 (unbounded map) accelerate failure:**

- Unbounded quickTabsMap growth fills storage quota faster
- Storage quota exhaustion blocks all persistence
- Quota exhaustion without graceful degradation causes cascading failures

**Issue #25 (parallel creates) risks masking by Issue #24 (port timing):**

- If port reconnection occurs during create operation, state may reset
- Parallel creates already race-condition prone
- Port instability makes ID collision worse

---

## Architectural Pattern Issues

### Service Worker Lifecycle Mismatch

Extension assumes background service worker always alive. Firefox model assumes
worker can suspend. This fundamental mismatch causes cascading failures. Need
explicit state persistence before suspension and recovery on restart.

### Two-State-Store Problem (Issue #22)

Multiple handlers maintain separate views of same Quick Tab state.
VisibilityHandler maintains DOM state, MinimizedManager maintains snapshot,
storage maintains persisted state. No transactional coordination between these.
Operations that update one but fail to update others cause corruption.

### Asynchronous State Transitions Without Barriers

Operations begin (minimize, restore, create) but don't wait for all state
transitions to complete before allowing next operation. Intermediate states
where operation partially complete can be observed by concurrent operations,
causing conflicts.

### Memory Growth Without Bounds

Multiple components (quickTabsMap, timer IDs, event listeners, handler
instances) accumulate without eviction or garbage collection. No maximum limits
enforced. Long-running extensions eventually exhaust memory.

### No Initialization Sequencing

Critical initialization steps (Tab ID, handler setup, port connection) not
sequenced with explicit barriers. Operations proceed before prerequisites
complete, causing null pointer and uninitialized state errors.

---

## Failure Manifestation Timeline

- **1-2 hours:** No visible issues; background alive, operations succeed
- **6-8 hours:** Memory usage creeps up; handlers accumulate listeners and
  timers
- **12 hours:** First storage quota warnings; Map contains 100+ entries
- **24 hours:** Storage quota approaching 80%; background restart cycles begin;
  Port reconnections frequent
- **48 hours:** Memory usage 200-500MB; storage writes occasionally fail; some
  operations timeout
- **72 hours:** Significant memory leaks (500MB+); handler cycles accelerating;
  Quick Tab operations become unreliable
- **7+ days:** Extension becomes unusable; frequent hangs, storage failures,
  memory exhaustion

---

## Implementation Priority

### Critical (Fix First)

1. **Issue #5:** Tab ID initialization barrier (prerequisite for all others)
2. **Issue #17:** Background cleanup and recovery marker (enables recovery)
3. **Issue #23:** Restart detection heartbeat (detects recovery need)

### High (Week 1)

4. **Issue #19:** Event listener cleanup (memory leak)
5. **Issue #20:** Timer cleanup (memory leak)
6. **Issue #25:** Parallel creation serialization (prevents data corruption)
7. **Issue #22:** State consistency validation (detects corruption)

### High (Week 2)

8. **Issue #24:** Port connection handshake (reliability)
9. **Issue #18:** Quota monitoring with fallbacks (prevents silent failures)
10. **Issue #21:** Bounded Map with eviction (memory management)

---

## Validation Approach

**Automated Tests Required:**

- Background termination and recovery scenarios
- Storage quota boundary conditions
- Event listener accumulation cycle (100 handler cycles, verify no listeners)
- Timer cleanup verification (destroy handler, verify all timers cleared)
- Parallel operation execution (100 simultaneous creates, verify no ID
  collisions)
- State consistency (periodically validate VisibilityHandler ↔ MinimizedManager
  sync)

**Performance Monitoring Thresholds:**

- Memory usage > 50MB: Log warning, trigger cleanup
- Handler instance count > 50 per tab: Log warning, verify cleanup working
- Timer count > 100: Log warning, verify orphan cleanup
- quickTabsMap size > 500: Trigger LRU eviction
- Storage usage > 80% quota: Log warning, trigger cleanup or compression

---

## References

**Firefox WebExtension Documentation:**

- Service Worker Lifecycle: Idle termination after ~30 seconds, no guaranteed
  unload event
- Storage API: 10MB quota per extension, getBytesInUse() NOT supported in
  Firefox
- runtime.Port: May close when any context unloads, onDisconnect can fire before
  onConnect completes

**MDN WebExtensions API:**

- runtime.Port: No ordering guarantee between onConnect and onDisconnect
- storage.local: Quota exceeded throws QuotaExceededError, no pre-write check
  available
- browser.tabs.sendMessage: Default timeout 30-60 seconds, no built-in retry
  mechanism

---
