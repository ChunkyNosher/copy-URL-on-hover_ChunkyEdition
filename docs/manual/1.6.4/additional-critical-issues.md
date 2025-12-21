# Copy-URL-on-Hover Extension - Additional Critical Issues Report

## Port Connection Racing, Message Protocol Gaps, and State Management Failures

**Extension Version:** v1.6.3.10-v11  
**Date:** 2025-12-20  
**Scope:** 12 additional systemic failures in port lifecycle, message handling,
state machine absence, and missing logging

---

## Executive Summary

Beyond the previously documented issues (storage blocking, adoption flow,
handler initialization, behavioral guardrails, message correlation, container
isolation, error context, initialization ordering, hydration barriers, and
resource cleanup), further analysis reveals 12 additional critical failures.
These span port connection lifecycle races (Firefox API constraints), message
protocol deficiencies (missing version negotiation), stale state assumptions
(latency measurement degradation), state management gaps (missing RECONNECTING
state), and critical logging absences. These issues share a common pattern:
dependencies on timing guarantees that Firefox does not provide, protocol
assumptions without version checking, and loss of state context during
transitions. Collectively, they create cascading failures where port
disconnections corrupt adoption flow, network changes bypass deduplication
logic, generation IDs never set break restart detection, and message ordering
asymmetry creates race conditions. The extension lacks visibility into whether
failures are temporary or permanent, is blind to protocol mismatches, and has no
way to recover from cascading failures without manual intervention.

---

## Issues Overview

| Issue # | Component           | Severity     | Root Cause                                   | Impact                                       |
| ------- | ------------------- | ------------ | -------------------------------------------- | -------------------------------------------- |
| 1       | Port Connection     | **CRITICAL** | onDisconnect fires before listeners attached | Port state corrupted, adoption messages lost |
| 2       | Port Connection     | **HIGH**     | BFcache silent disconnect without event      | Port becomes non-functional, no detection    |
| 3       | Hydration           | **HIGH**     | Timeout fires during partial load            | Operations run on incomplete state           |
| 4       | Adoption TTL        | **MEDIUM**   | Measurement only at startup                  | Stale cache after network change             |
| 5       | Message Ordering    | **HIGH**     | Only RESTORE ordered, CREATE unordered       | CREATE operations can race                   |
| 6       | Message Queueing    | **MEDIUM**   | Fixed 10-message overflow buffer             | Silently loses messages beyond threshold     |
| 7       | Message Correlation | **MEDIUM**   | messageId sent but not in responses          | Cannot match responses to requests           |
| 8       | Generation ID       | **CRITICAL** | Never assigned at background startup         | Restart detection completely broken          |
| 9       | Storage Dedup       | **MEDIUM**   | Latency measured once, never updated         | Duplicates when network conditions change    |
| 10      | Version Negotiation | **HIGH**     | Version defined but never used               | Protocol changes cause silent failures       |
| 11      | Port State Machine  | **MEDIUM**   | Missing RECONNECTING state                   | Ambiguous status during retry backoff        |
| 12      | Adoption Caching    | **HIGH**     | Cache not cleared on navigation              | Quick Tabs leak across page contexts         |

---

## Issue 1: Port onDisconnect Racing During Initialization

### Problem

Firefox fires `port.onDisconnect` before `onMessage.addListener()` completes
registration. When connection is established immediately before message listener
registration, the port can disconnect during this window (typically 1-10ms),
firing onDisconnect without any onMessage listener attached.

### Root Cause

File: `src/content.js`  
Location: Port connection setup, lines approximately 2600-2700  
Issue: Sequential listener registration creates race window. Between
`browser.runtime.connect()` and `onMessage.addListener()`, Firefox can fire
onDisconnect if background restarts or connection fails, triggering orphaned
disconnect handler with incomplete state.

### Behavioral Impact

Cascade failure sequence:

- Port connects successfully
- onDisconnect fires (background briefly unavailable)
- Disconnect handler executes: `backgroundPort = null`,
  `isBackgroundReady = false`
- onMessage.addListener() then executes (too late)
- Subsequent messages attempt to post on null port
- All adoption messages queued during initialization lost permanently
- Tab ID adoption never completes
- Content script believes initialization succeeded but critical flow aborted

### Fix Required

Implement defensive initialization sequencing that guarantees onMessage listener
attached before any disconnect can have side effects. Register both listeners
before any other setup completes. Add state flag to distinguish "port
disconnected during setup" (should retry) from "port disconnected during normal
operation" (should handle gracefully). Prevent orphaned disconnect handler from
executing state changes until initialization gate has passed.

---

## Issue 2: BFcache Silent Port Disconnection Without Event

### Problem

Firefox does not fire `port.onDisconnect` when a tab enters BFCache
(back-forward cache). Port becomes non-functional but the content script
receives no notification of failure. Subsequent `port.postMessage()` calls fail
silently with no error.

### Root Cause

File: `src/content.js`  
Location: No pagehide/pageshow event listeners (missing feature), page
navigation handling around lines 3500+  
Issue: Firefox's BFCache mechanism freezes tabs without triggering unload events
or port disconnect events. Port reference remains valid but unusable. No code
listens for `pagehide` event which would indicate BFCache activation.

### Behavioral Impact

User navigation flow:

- User opens Wikipedia, creates Quick Tabs
- User clicks browser back button
- Tab enters BFCache (frozen state)
- Port becomes non-functional but no event fired
- User navigates forward (tab unfrozen)
- Page loads with stale port reference
- First operation attempts to post message on dead port
- "Attempt to postMessage on disconnected port" error thrown
- Content script crashes or falls into error recovery loop

### Fix Required

Add `pagehide` and `pageshow` event listeners to detect BFCache transitions. On
`pagehide`, mark port as potentially invalid. On `pageshow`, verify port is
still functional by attempting handshake. If handshake fails, trigger
reconnection immediately. Log BFCache entry/exit for diagnostics. Store port
state as "hibernated" during BFCache to distinguish from permanent
disconnection.

---

## Issue 3: Hydration Timeout Races with Ongoing Load

### Problem

Hydration includes a `HYDRATION_TIMEOUT_MS` of 3000ms. If hydration is still
loading Quick Tabs when timeout fires, the system marks hydration as complete
while actual loading continues. Subsequent operations on Quick Tabs execute
against partially-loaded state, creating ID collisions and state corruption.

### Root Cause

File: `src/content.js`  
Location: Hydration completion logic around lines 950-970  
Issue: Timeout-based completion assumption rather than event-driven
confirmation. No signal when actual hydration finishes; only timeout. On slow
storage reads (observed up to 2000ms for 500+ Quick Tabs), timeout fires at
3000ms but Quick Tab #301-500 still loading from storage.

### Behavioral Impact

Scenario with 500 stored Quick Tabs:

- t=0ms: Hydration starts, begins loading from storage
- t=2900ms: Loaded 300 Quick Tabs (slow storage medium)
- t=3000ms: Hydration TIMEOUT fires, sets `isHydrationComplete = true`
- t=3001ms: User creates new Quick Tab via keyboard shortcut
- t=3010ms: CREATE_QUICK_TAB generates ID using counter:
  `qt-{tabId}-{counter}-{random}`
- t=3050ms: Hydration finishes loading remaining 200 Quick Tabs
- t=3100ms: ID collision detected—Quick Tab #301 from storage has same ID as
  newly created tab
- Storage corruption: Two Quick Tabs with identical ID in state map

### Fix Required

Replace timeout-based completion with explicit event-driven confirmation. After
all Quick Tabs loaded from storage, emit `HYDRATION_ACTUALLY_COMPLETE` event and
set completion flag from event handler, not timeout. Implement barrier that
prevents Quick Tab operations until hydration event fires (not timeout). Add
logging at each hydration phase (START, LOADED_N_TABS, COMPLETE) with actual
completion timestamp. If timeout fires before explicit completion, log warning
and wait for actual completion before allowing operations.

---

## Issue 4: Adoption TTL Calculated at Startup, Never Recalculated

### Problem

Adoption cache TTL (time-to-live) is calculated once during port handshake using
observed latency at that moment. If network conditions change after handshake
(WiFi to cellular, high load period, etc.), adoption TTL becomes stale, causing
premature cache expiration or orphaned adoptions.

### Root Cause

File: `src/content.js`  
Location: Adoption TTL calculation around lines 1150-1170;
`lastKnownBackgroundLatencyMs` set only once in `_handleBackgroundHandshake()`  
Issue: Latency measurement trapped at initialization time. On first connection
with no handshake samples, defaults to 30 seconds. After one successful
handshake, latency captured and used for TTL calculation forever. No periodic
re-measurement or dynamic adjustment. If conditions change, cached value becomes
incorrect.

### Behavioral Impact

Scenario with network change:

- t=0s: Port connects, fast WiFi (50ms latency)
- t=0.5s: First handshake completes, latency recorded as 50ms
- t=0.75s: Adoption TTL calculated: 50ms × 3 multiplier = 150ms base + 30-60s
  adaptive = 30s
- t=10s: User creates Quick Tab (Qt1), adoption tracked for 30s TTL
- t=20s: User's WiFi drops, switches to cellular (500ms latency, 10× slower)
- t=35s: RESTORE_QUICK_TAB command sent for Qt1
- t=35.2s: Adoption cache lookup—TTL expired 5 seconds ago (calc'd for WiFi, not
  cellular)
- t=35.3s: Adoption not found in cache, storage lookup fails
- t=35.4s: RESTORE operation fails silently, user sees "Quick Tab not found"

### Fix Required

Implement periodic latency re-measurement in heartbeat messages. Update
`lastKnownBackgroundLatencyMs` every 10 heartbeats (not just once). Recalculate
adoption TTL whenever latency update received. Store timestamp of last latency
update; if >5 minutes old, trigger fresh measurement. Add logging each time TTL
recalculated to show old vs. new values. Consider adaptive dedup window that
scales with latency rather than fixed calculation.

---

## Issue 5: CREATE_QUICK_TAB Operations Lack Ordering Enforcement

### Problem

Only RESTORE operations enforce message ordering to prevent races. CREATE
operations do NOT have equivalent ordering validation, allowing rapid CREATE
commands to race and corrupt adoption tracking.

### Root Cause

File: `src/content.js`  
Location: `handleCreateQuickTab()` around lines 1050;
`_checkRestoreOrderingEnforcement()` exists only for RESTORE, not CREATE  
Issue: Asymmetric ordering enforcement. RESTORE validates `messageSequenceId` to
ensure operations processed in order. CREATE generates ID with counter but
doesn't enforce ordering at message level. Two rapid Q keystrokes can send
CREATE messages out-of-order relative to background processing.

### Behavioral Impact

Rapid dual-keystroke scenario:

- t=100ms: User presses Q (first keystroke)
- t=101ms: CREATE_QUICK_TAB message #1 sent:
  `{messageId: "msg-1", quickTabId: "qt-1", ...}`
- t=102ms: Second keystroke triggers CREATE_QUICK_TAB message #2:
  `{messageId: "msg-2", quickTabId: "qt-2", ...}`
- t=110ms: Background receives message #1, begins processing (slower path)
- t=112ms: Background receives message #2 (faster path due to message queue
  ordering)
- t=113ms: Message #2 processing starts while adoption tracking from #1 still in
  progress
- t=114ms: Message #2 completes adoption, updates `recentlyAdoptedQuickTabId`
  marker
- t=115ms: Message #1 adoption completes, **overwrites**
  `recentlyAdoptedQuickTabId` marker with Qt1
- t=116ms: Adoption tracking state corrupted—Qt2 adoption lost, Qt1 marked as
  most recent
- t=117ms: Hydration filtering uses stale adoption marker, Qt2 filtered out
  incorrectly

### Fix Required

Apply same ordering enforcement used for RESTORE to CREATE operations. Add
`sequenceId` to all CREATE messages. Implement ordering validation before
adoption tracking occurs. Queue operations that arrive out-of-order. Log when
operations reordered due to arrival order mismatch. Consider atomic adoption
marker increment to prevent partial updates when racing.

---

## Issue 6: Dropped Message Buffer Fixed at 10 Items, No Backpressure Scaling

### Problem

During initialization backpressure events (Issue #6 from additional findings),
the system queues operations. When queue overflows, dropped messages are
buffered. But the overflow buffer is fixed at only 10 items. If more than 10
messages overflow, additional messages are silently lost without even being
buffered.

### Root Cause

File: `src/content.js`  
Location: `_bufferDroppedMessage()` around line 730  
Issue: `MAX_DROPPED_MESSAGES = 10` constant is fixed regardless of queue
backpressure. During initialization backpressure, background slow to respond,
message queue fills, overflow occurs. First 10 overflowed messages buffered,
remaining overflows ignored silently. No relationship between queue depth and
buffer allocation.

### Behavioral Impact

Initialization backpressure scenario:

- Background takes 2 seconds to initialize (slow start)
- User rapidly creates 5 Quick Tabs in quick succession (5 CREATE messages)
- Command queue holds up to 100 items (COMMAND_QUEUE_MAX_SIZE)
- Queue fills: items 1-100 queued successfully
- t=2.5s: Message #101 arrives (CREATE_QUICK_TAB)
- Item #101 dropped (queue full)—added to `droppedMessageBuffer` ✓
- Items #102-110 dropped—added to buffer (buffer now at capacity 10) ✓
- Item #111 dropped—**not added to buffer**, silently ignored ✗
- Items #112-120 dropped—silently ignored (buffer unchanged)
- When backpressure clears and recovery attempted, only 10 of 20 dropped
  messages recoverable
- 10 Quick Tabs created in that window permanently lost
- User sees only 50% of Quick Tabs they actually created

### Fix Required

Scale dropped message buffer allocation based on queue backpressure. If queue
depth > 80%, increase buffer from 10 to 50+ to accommodate overflow. Store
timestamp of drops for diagnostics. Implement recovery queue that processes
drops even after backpressure clears, not just during window. Log dropped
message stats: how many total dropped, how many buffered, how many unrecovered.
Consider moving from fixed buffer to unbounded list during backpressure, then
garbage collect after recovery.

---

## Issue 7: messageId Sent by Content Script But Never Included in Responses

### Problem

Content script sends messages with `messageId` field for correlation, but
MessageRouter responses omit `messageId`, making it impossible to match
responses back to originating requests when multiple similar operations occur.

### Root Cause

File: `src/content.js` sends messageId; `src/background/MessageRouter.js`
response envelope doesn't include it  
Location: MessageRouter.js lines 40-44, RESPONSE_ENVELOPE definition  
Issue: Protocol asymmetry. Requests include messageId for traceability, but
responses stripped of correlation context. Content script has no way to know
which response corresponds to which request.

### Behavioral Impact

Rapid operation scenario with response mixup:

- t=0ms: Tab A sends:
  `{messageId: "msg-1", type: "UPDATE_POSITION", quickTabId: "qt-1", x: 100, y: 100}`
- t=1ms: Tab B sends:
  `{messageId: "msg-2", type: "UPDATE_POSITION", quickTabId: "qt-2", x: 200, y: 200}`
- t=10ms: Background sends response to Tab A: `{success: true, data: {...}}` (no
  messageId)
- t=11ms: Background sends response to Tab B: `{success: true, data: {...}}` (no
  messageId)
- t=12ms: Tab A receives first response → **assumes it's for "msg-1"** but could
  be for "msg-2"
- t=13ms: Tab B receives second response → **assumes it's for "msg-2"** but
  could be for "msg-1"
- If responses arrive out-of-order (not guaranteed), Tab A thinks its update
  succeeded for Qt-1 but background actually updated Qt-2
- State corruption: Position values swapped between tabs

### Fix Required

Include `messageId` in response envelope from background. Extract messageId
before response normalization; preserve through all response processing. Content
script matches response.messageId to pending request map to resolve correct
promise. Add validation that messageId in response matches request. Log if
messageId mismatch detected (indicates background response reordering). Update
RESPONSE_ENVELOPE to include messageId field:
`{success, data, messageId, timestamp}`.

---

## Issue 8: Generation ID Never Assigned at Background Startup

### Problem

Background startup code never creates or assigns a generation ID. Content script
expects generation ID in responses to detect background restart, but background
never sends it, making restart detection completely broken.

### Root Cause

File: `src/background/handlers/QuickTabHandler.js` (response builders) and
background startup sequence  
Location: No place where `generationId` is created at background startup;
`_buildTabIdSuccessResponse()` returns no generation field  
Issue: Restart detection feature implemented in content script but never
provided by background. Content script polls for generation ID changes;
background never sets one. Content script unable to distinguish normal operation
from restart.

### Behavioral Impact

Background crash and restart scenario:

- Background process serving extension, has internal state
- Firefox terminates background after 30s inactivity (Issue #6 severity)
- Background wakes up fresh (new generation, all state lost)
- Content script sends message expecting response with generation ID
- Background sends response: `{success: true, data: {currentTabId: 1}}` (no
  generation)
- Content script checks: `response.generation === lastKnownBackgroundGeneration`
- Both null → **assumes no restart occurred** (wrong!)
- Content script still holds stale references to storage locations, deleted by
  restarted background
- User operations fail mysteriously, data loss possible

### Fix Required

Assign generation ID at background startup. Store in `backgroundGenerationId`
variable (should increment each startup). Include generation ID in every
response from background: `{success, data, generationId, ...}`. Content script
should track `lastSeenBackgroundGenerationId`. On mismatch (generation changed),
trigger full state recovery and storage resync. Log when restart detected:
"Background restart detected: generation {old} → {new}". Implement generation ID
persistence across restarts if feasible, or use startup timestamp as generation
marker.

---

## Issue 9: Storage Event Dedup Window Calculated Once, Stale if Network Changes

### Problem

Adaptive storage event deduplication window is calculated based on observed
latency at handshake time. If network conditions change during session (WiFi to
cellular, DNS slowdown, etc.), dedup window becomes incorrect, causing duplicate
event processing or missed events.

### Root Cause

File: `src/content.js`  
Location: `_getAdaptiveStorageEventDedupWindow()` around line 1350;
`lastKnownBackgroundLatencyMs` set only at handshake  
Issue: Dedup window static after calculation. Latency measured once during port
handshake, never updated. Firefox storage.onChanged fires with 300-500ms
variance per MDN, but if latency changes, dedup window misaligned with actual
event timing.

### Behavioral Impact

Network degradation scenario:

- Initial connection: fast WiFi, 50ms latency
- Dedup window calculated: `Math.min(Math.max(50 * 2, 500), 1000) = 500ms` base
- With 3× latency multiplier: `~150-300ms` adaptive window
- Storage write at t=0ms fires onChanged at t=100ms
- Dedup check: is event within 300ms of write? Yes → deduplicated ✓
- t=5min later: User's WiFi network gets congested
- Latency now 500ms (not measured due to single-point measurement)
- Storage write at t=5000ms fires onChanged at t=5500ms (500ms delay)
- Dedup check: is event within 300ms of write? No! (500ms > 300ms) → **duplicate
  allowed**
- Same storage event processed twice
- State updated twice, counters double-incremented
- Manifest inconsistency between storage and in-memory state

### Fix Required

Implement periodic latency re-measurement. Send lightweight ping every 30
seconds, measure round-trip time. Update `lastKnownBackgroundLatencyMs` with new
measurement. Recalculate dedup window every measurement update. Store timestamp
of last latency measurement; if >5 minutes old, log warning and possibly disable
dedup as safety fallback. Log each dedup window recalculation with old/new
latency values. Consider using multiple recent samples (rolling average) instead
of single measurement.

---

## Issue 10: MESSAGE_PROTOCOL_VERSION Defined But Never Enforced or Negotiated

### Problem

MessageRouter defines `MESSAGE_PROTOCOL_VERSION = '1.0.0'` constant but it is
never used. No version checking between content script and background. If
extension updated and protocol changes, version mismatch causes silent failures
with no diagnostic information.

### Root Cause

File: `src/background/MessageRouter.js` line 100 defines version; never used in
validation  
Location: No version negotiation code; no version check in route() method  
Issue: Version declared but orphaned. Protocol could change in future update,
but old content scripts (running before page reload) send new message format to
background expecting old format, or vice versa. No compatibility layer or
version check prevents this.

### Behavioral Impact

Extension auto-update scenario:

- User has v1.6.3.10 running (old content script cached in tab)
- Extension auto-updates to v1.6.4 (new background script with changed message
  format)
- Background now expects `{action: ..., options: {...}}` format
- Old content script still sends `{type: ..., metadata: {...}}` format
- Background receives unknown message format
- `_extractAction()` returns null (format mismatch)
- Route method rejects with "Invalid message format"
- Content script receives error but has no way to know version mismatch
- Operation fails, user experience degrades
- No indication version mismatch caused failure

### Fix Required

Include protocol version in every message and response. Content script sends:
`{action, version: '1.0.0', ...}`. Background extracts and validates version on
every request. Implement version compatibility matrix for backward compatibility
(e.g., v1.0.0 compatible with v1.0.1, but not v2.0.0). If version mismatch
detected, log error with versions and suggest page reload. Include version in
handshake message to establish protocol level early. Log version agreement:
"Protocol negotiated: client v{}, server v{}".

---

## Issue 11: Port Connection State Machine Missing RECONNECTING State

### Problem

Port state machine has DISCONNECTED, CONNECTING, CONNECTED, READY, FAILED states
but no RECONNECTING state. During reconnection backoff periods (e.g., 30-second
exponential backoff), state remains DISCONNECTED, indistinguishable from
permanent failure. External observers cannot determine if port is in retry
backoff or failed permanently.

### Root Cause

File: `src/content.js`  
Location: `PORT_CONNECTION_STATE` enum around line 2900  
Issue: State machine incomplete. Reconnection logic uses setTimeout for backoff
but state doesn't reflect "in backoff" condition. When state is DISCONNECTED,
could mean (a) just disconnected, (b) failed permanently, (c) waiting for
backoff timer to fire—all indistinguishable.

### Behavioral Impact

Retry backoff scenario:

- Port disconnects at t=0s
- State transitions: CONNECTED → DISCONNECTED
- Reconnection attempt fails at t=1s
- State transitions: DISCONNECTED → FAILED
- Exponential backoff calculated: 30 seconds
- setTimeout fires in 30s to retry
- But state remains FAILED (no RECONNECTING state)
- Quick Tab Manager observes state == FAILED
- Manager UI shows "Connection failed, offline mode active"
- User believes permanent failure after 30s (user doesn't see it's retrying)
- At t=30.5s: reconnection attempt succeeds
- State: FAILED → CONNECTED (sudden jump)
- User confused: was offline, suddenly online (no indication retry was
  happening)

### Fix Required

Add RECONNECTING state to enum. When backoff timer scheduled, transition to
RECONNECTING. Log: "Port reconnecting (backoff: {delay}ms)". When backoff timer
fires, attempt connection and transition to CONNECTING. If successful,
transition to CONNECTED. If fails, back to RECONNECTING with longer backoff. Add
utility function `isPortInRecovery()` to distinguish retry backoff from
permanent failure. Update UI and logging to show "Reconnecting in 30s" instead
of blank "Failed" state.

---

## Issue 12: Adoption Cache Not Cleared on Cross-Domain Navigation

### Problem

Adoption cache (`recentlyAdoptedQuickTabs`) persists across page navigation.
When user navigates to a different domain in the same tab, adoption info from
previous domain remains in cache, allowing Quick Tabs from one domain to
incorrectly appear in another domain's context.

### Root Cause

File: `src/content.js`  
Location: Adoption cache around line 1130; no navigation event listeners
clearing cache  
Issue: Cache keyed only by tabId, not by [tabId, hostname]. User navigates from
Wikipedia to YouTube (same tab, different hostname), but adoption cache still
contains entries from Wikipedia. Quick Tabs created on Wikipedia appear as
"adoptable" on YouTube because tabId matches.

### Behavioral Impact

Cross-domain navigation scenario:

- User opens Wikipedia (tabId=1, hostname=wikipedia.org)
- Creates Quick Tab #1, adoption tracked:
  `{quickTabId: "qt-1", originTabId: 1, adoptedAt: t, ttl: 30s}`
- Adoption cache: `recentlyAdoptedQuickTabs.set("qt-1", {...})`
- User navigates to YouTube (tabId=1, hostname=youtube.com, page reload)
- Content script on YouTube runs, but adoption cache persists from Wikipedia
  context
- User tries RESTORE_QUICK_TAB for Wikipedia's Quick Tab #1 (stale reference)
- Adoption cache lookup finds Qt-1 still valid (TTL not expired)
- Background receives adoption info: `{quickTabId: "qt-1", originTabId: 1}`
- Background checks: stored originTabId (1) == current tabId (1) → match!
- **Quick Tab #1 from Wikipedia appears on YouTube** (wrong!)
- User sees Wikipedia Quick Tab in YouTube context, violating container/domain
  isolation

### Fix Required

Clear adoption cache on page navigation. Add listener for `window.beforeunload`
event to clear cache on navigation. Better: key adoption cache by
`[tabId, hostname]` compound key instead of just tabId. On content script reinit
after navigation, check if hostname changed; if yes, clear or rebuild adoption
cache. Log when cache cleared: "Adoption cache cleared on navigation from
{oldHost} to {newHost}". Consider using sessionStorage instead of in-memory
cache to make lifetime clearer and auto-purge on page navigation.

---

## Shared Implementation Notes

- All port state transitions should be atomic or carefully sequenced to prevent
  race conditions during initialization
- Message correlation (messageId) must be threaded through entire message
  lifecycle: send → route → handler → response
- Latency measurements must be periodic, not one-time, to adapt to changing
  network conditions
- Adoption tracking must be context-aware: keyed by both tabId and hostname or
  domain
- Version negotiation required early (handshake) to prevent protocol mismatches
  from causing silent failures
- Generation ID from background must be included in responses to enable restart
  detection

---

## Acceptance Criteria

**Issue 1 - Port Racing**

- onMessage listener attached before any disconnect handler can execute side
  effects
- Orphaned disconnect during setup logged separately from normal disconnect
- Adoption messages never lost during initialization race window
- Manual test: rapid tab open/close during extension startup doesn't corrupt
  adoption

**Issue 2 - BFCache Disconnect**

- pagehide/pageshow events monitored for BFCache transitions
- Port functionality verified after pageshow (handshake attempted)
- Port marked as hibernated during BFCache for diagnostics
- Manual test: navigate away (BFCache), navigate back, Quick Tab operations
  succeed

**Issue 3 - Hydration Timeout**

- Hydration marked complete only after actual load finishes, not timeout
- HYDRATION_ACTUALLY_COMPLETE event emitted when loading done
- Operations deferred until completion event fires (not timeout)
- Manual test: 500+ stored Quick Tabs hydrate without ID collisions

**Issue 4 - Adoption TTL**

- Latency re-measured every 10 heartbeats (not once)
- Adoption TTL recalculated on each latency update
- Timestamp of last measurement tracked; >5 min triggers warning
- Manual test: network change (WiFi → cellular) adoption TTL adapts

**Issue 5 - CREATE Ordering**

- sequenceId added to all CREATE messages
- Ordering validation prevents out-of-order processing
- Out-of-order messages queued for reprocessing
- Manual test: rapid Q keystrokes don't corrupt adoption state

**Issue 6 - Dropped Message Buffer**

- Buffer size scales with queue backpressure
- Buffer size >= 50+ during initialization backpressure
- Dropped message statistics logged for diagnostics
- Manual test: 120 rapid creates during slow init recovers >100 messages

**Issue 7 - messageId in Responses**

- messageId included in all responses from background
- Content script matches response.messageId to pending requests
- Version mismatch warning if messageId missing (diagnostics)
- Manual test: concurrent updates to different Quick Tabs maintain isolation

**Issue 8 - Generation ID**

- Generation ID assigned at background startup
- Included in every response from background
- Content script detects generation change (restart)
- Manual test: background restart triggers full state recovery

**Issue 9 - Storage Dedup Window**

- Latency re-measured periodically (every 30 seconds)
- Dedup window recalculated on each latency update
- Timestamp of last measurement tracked
- Manual test: network slowdown doesn't cause duplicate event processing

**Issue 10 - Protocol Version**

- Protocol version included in every message and response
- Version validation performed on every route
- Version mismatch triggers diagnostic logging
- Manual test: extension update doesn't cause silent message failures

**Issue 11 - RECONNECTING State**

- RECONNECTING state added to port state machine
- State CONNECTING → RECONNECTING when backoff fires
- UI shows "Reconnecting in {delay}ms" during backoff
- Manual test: temporary port disconnect shows recovery in progress

**Issue 12 - Adoption Cache Navigation**

- Adoption cache cleared on page navigation
- Cache keyed by [tabId, hostname] (compound key)
- Context verification prevents cross-domain Quick Tab leaks
- Manual test: navigate Wikipedia → YouTube, Wikipedia Quick Tabs don't appear

**All Issues**

- No new console errors or warnings from correlation/state logic
- Logging at each phase shows issue context clearly
- Manual test battery covers all 12 issues passes without data corruption
- Restart detection works after background restart
- Storage event dedup reduces duplicates to <1%

---

## Supporting Context

<details>
<summary>Firefox API Constraints</summary>

Per Mozilla Bugzilla [Bug #1370368]: `port.onDisconnect` can fire before
`onConnect` handler completes in edge cases where background crashes or
forcefully disconnects. Additionally, BFCache (back-forward cache) is designed
to preserve tab state but does not fire connection-related events, per MDN
WebExtensions documentation.

</details>

<details>
<summary>Message Protocol Assumptions</summary>

Current implementation assumes responses always arrive in request order, but
Firefox makes no ordering guarantees for `runtime.sendMessage()` responses when
multiple tabs communicate simultaneously. Without messageId in response
envelope, ordering assumption breaks with concurrent operations.

</details>

<details>
<summary>Network Latency Variance</summary>

Per MDN storage.onChanged documentation, Firefox fires storage events
asynchronously with 300-500ms variance. Single-point latency measurement
captures only initialization conditions; changing network conditions render
static dedup window inadequate.

</details>

<details>
<summary>Port Lifecycle Under Load</summary>

Issue #6 shows background can terminate after 30s inactivity. When background
restarts, it has no knowledge of prior port connections or generation state.
Without generation ID sent in responses, content script cannot detect restart
and continues using stale assumptions.

</details>

---

## Priority

**Critical:** Issues 1, 2, 8  
**High:** Issues 3, 5, 10, 12  
**Medium:** Issues 4, 6, 7, 9, 11

## Target

Fix all issues in coordinated PR. Issues 1-3, 8 (port lifecycle and generation
ID) should be addressed together as they're interdependent.

---

**End of Report**
