# Quick Tabs Manager - Additional Communication & Persistence Issues

**Extension Version:** v1.6.4+  
**Date:** 2025-12-11  
**Scope:** Twelve additional architectural and implementation defects in Quick Tabs Manager sidebar communication, listener initialization, and state synchronization discovered during comprehensive code review.

---

## Executive Summary

Beyond the primary eight issues detailed in the initial diagnostic report, a systematic code review reveals twelve additional defects that compound communication failures, create race conditions, and introduce silent state corruption pathways. These issues span listener initialization timing, port connection state machine consistency, atomic operation violations, memory management gaps, and health monitoring brittleness. Collectively, they represent a second tier of architectural fragility that prevents the documented fallback mechanisms from functioning reliably, and create conditions where the sidebar can silently diverge from authoritative backend state without triggering observable failures or recovery attempts.

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|-----------|
| 9 | Listener Registration Timing | High | storage.onChanged listener may register after sidebar fully loads, missing events during initialization window |
| 10 | Port Message Queue Ordering | High | Queue flush preserves insertion order but lacks sequence validation during ZOMBIE-to-CONNECTED transitions |
| 11 | Port Connection Handler Duplication | High | Old onMessage listener not removed on reconnection, creates dual-handler message processing |
| 12 | Tier Status Hysteresis Missing | High | Single BroadcastChannel message flips tier status without sustained activity confirmation |
| 13 | Storage Watchdog Timer Leaks | High | Multiple START_STORAGE_WATCHDOG messages create concurrent timers without cleanup |
| 14 | BC Verification Can Process Multiple Times | Medium | Handler lacks guard against duplicate PONG processing, creates state inconsistencies |
| 15 | Implicit storage.onChanged Registration | High | Listener registration location and timing undefined, no explicit verification logging |
| 16 | State Machine Missing Disconnect Check | High | Queue flush processes messages against DISCONNECTED port state, silencing errors |
| 17 | Concurrent Background Health Probes | High | Overlapping health check intervals trigger multiple simultaneous probes, cascading state transitions |
| 18 | Non-Atomic Failure Counter Updates | High | Connection state checked independently from failure counters, race condition on thresholds |
| 19 | Browser Tab Info Cache Not Cleared | Medium | quickTabHostInfo Map grows indefinitely across sidebar reload cycles, memory leak |
| 20 | Fallback Health Stats Never Reset | Medium | Counters accumulate across fallback activation cycles, metrics span session boundaries |

---

## Issue 9: Listener Registration Timing Race Condition During Sidebar Load

### Problem

The `browser.storage.local.onChanged` listener may register after the sidebar HTML document has finished loading and reached `readyState === 'complete'`. If background script writes state to storage during the initialization window (between sidebar panel open and listener registration completion), the sidebar's onChanged handler never fires for that critical first state write.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Module initialization, listener registration in DOMContentLoaded handler  
**Issue:** Firefox sidebar panels have a different document lifecycle than regular HTML. The sidebar's `document.readyState` may become `'complete'` before event listeners intended for `'interactive'` phase actually register. No explicit timing barrier exists—listener registration competes with other async imports and module initialization. Background may write state during this gap, expecting sidebar to receive it immediately. This creates a cold-start problem where first state synchronization silently fails.

### Why This Is Critical

- First state update after sidebar opens is silently lost
- Manager UI displays empty even though state exists in storage
- Sidebar never catches up because subsequent updates arrive while listener is unregistered
- Recovery depends on user triggering a different action that forces state resync
- Two-second initial load timeout (per code review) may not wait long enough for listener registration

### Fix Required

Implement explicit registration barrier: defer DOMContentLoaded event processing until listener registration is verified. Add registration acknowledgment pattern where listener immediately writes a test value to storage after registration completes, then waits for its own onChanged callback to fire (proving listener works). Only proceed with main initialization after listener verification succeeds. Document that listener must register before background writes first state, establish this ordering guarantee in initialization sequence.

---

## Issue 10: Port Message Queue Ordering Lacks Sequence Validation

### Problem

While port messages buffer before listener registration (architectural Issue 9 from primary report), the queue flush process doesn't validate message ordering. If messages arrive during ZOMBIE state and get queued, then flush during reconnection, their relative ordering may not match their logical dependencies. A state-read operation could execute before the corresponding state-write if queued in reverse sequence.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_flushPortMessageQueue()`, `_extractQueuedMessages()`, message dequeue logic  
**Issue:** Queue preserves insertion order but provides no sequence number validation. Port messages generated before listener registration lack monotonic sequence IDs to detect reordering. During flush, messages process in FIFO order but no validation confirms this matches their original send sequence from background. If background sends sequence [1,2,3] but sidebar receives [1,3,2] due to transport variance, queue flush outputs [1,3,2] without detecting the anomaly.

### Why This Is Critical

- State consistency violated when dependent operations flush out of order
- Example: minimize (operation 1) followed by state-read (operation 2) could process as read-then-minimize
- Manager displays stale UI state because operations executed in wrong order
- No diagnostic logging identifies that queue reordering occurred
- Compound failures with Issue 11 (dual handlers) when second handler processes wrong operation

### Fix Required

Add message sequence number tracking to port messages before listener registration. Include monotonic sequence ID in each queued message. During flush, validate that sequence numbers are monotonically increasing. If reordering detected, log warning with sequence numbers and consider re-ordering messages back to correct sequence before processing. Alternatively, delay flush until a brief stabilization period confirms no new messages arrive (indicating queue fully populated).

---

## Issue 11: Old Port onMessage Listener Not Removed on Reconnection

### Problem

When port transitions to ZOMBIE state and gets destroyed, the original `onMessage` listener registered in `connectToBackground()` is never explicitly removed. On reconnection, a new port is created and a new listener is registered via `backgroundPort.onMessage.addListener()`. Both listeners remain active, creating dual message processing where each incoming message gets handled twice by two separate callback functions.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `connectToBackground()` initial listener registration, `onDisconnect` handler  
**Issue:** JavaScript browser.runtime.Port doesn't auto-cleanup listeners when port closes. The original listener callback reference persists in memory even after `backgroundPort = null`. When reconnection creates a new port, old callback still references the old port object (now detached). New listener processes messages correctly, but old listener attempts to process messages from wrong port context, causing state inconsistencies or silent errors. No cleanup code calls `backgroundPort.onMessage.removeListener()` before port destruction.

### Why This Is Critical

- First reconnection creates two message handlers
- Each message triggers handler twice with potentially conflicting side effects
- Example: ZOMBIE state triggers twice, fallback activates twice, health monitoring counts double
- Second handler operates on stale port reference, errors are silently swallowed
- Multiple reconnection cycles leak listeners, accumulating handlers

### Fix Required

Add explicit listener cleanup in `onDisconnect` handler before setting `backgroundPort = null`. Store listener callback reference and call `port.onMessage.removeListener(storedCallbackRef)` before releasing port. Alternatively, create new unique listener callback per port (arrow function capturing port ID) so old callbacks become garbage-collected when port closes. Verify listener is removed by checking listener count before and after disconnection.

---

## Issue 12: Tier Status Flips on Single BroadcastChannel Message

### Problem

The tier status detection system (`notifyBroadcastMessageReceived()` in storage-handlers.js) immediately sets `isTier1Active = true` upon receiving any BroadcastChannel message. A single stray BC message can flip tier status from fallback-mode back to Tier 1 active, causing debounce to increase to 500ms despite ongoing Port connection issues. When Port fails minutes later, debounce reset takes additional time.

### Root Cause

**File:** `sidebar/utils/storage-handlers.js`  
**Location:** `notifyBroadcastMessageReceived()`, tier status check  
**Issue:** Function has no hysteresis or confirmation logic. One BC message sets `isTier1Active = true` and updates `STORAGE_READ_DEBOUNCE_MS = 500`. If BC is actually unreliable (false positive), this single message creates false confidence. No minimum message rate threshold or window-based confirmation—status flips immediately on event arrival. Conversely, 10-second timeout for `TIER1_INACTIVE_THRESHOLD_MS` is too long; tier could actually be dead for 9 seconds before timeout triggers.

### Why This Is Critical

- Stray BC message causes cascade of debounce timing changes
- Sidebar optimizes for wrong tier, then suffers when wrong tier fails
- No way to distinguish "single message worked" from "tier is reliably working"
- Health monitoring can't distinguish between transient message and sustained connectivity
- Multiple tier flips create jerky UX where debounce timing constantly changes

### Fix Required

Implement hysteresis: require sustained BC message arrival (e.g., 3 consecutive messages within 2-second window) before setting tier to active. Require 3 consecutive message timeouts (or 15-second silence window instead of 10) before flipping to inactive. Add explicit tracking of message arrival times and compute message rate. Log tier status changes with confidence level (e.g., "Tier1 activated with 5/5 messages arrived, confidence HIGH" vs. "single message, confidence LOW"). Only adjust debouncing after confirming sustained activity.

---

## Issue 13: Storage Watchdog Timer Leaks Without Cleanup

### Problem

The `_handleStartStorageWatchdog()` function initiates a storage watchdog timer that expects a storage.onChanged event within `STORAGE_WATCHDOG_TIMEOUT_MS` (2 seconds). If background sends multiple `START_STORAGE_WATCHDOG` messages before the first completes, previous timers are never cleared. Each START message creates a new timer without cancelling pending timers, leading to timeout handlers firing independently and triggering multiple fallback activations.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_handleStartStorageWatchdog()`, `_startStorageWatchdog()` implementation  
**Issue:** Function receives `START_STORAGE_WATCHDOG` from background but doesn't store timeout ID globally with check-before-create logic. Each call to `_startStorageWatchdog()` creates a new timer via `setTimeout()` without clearing the previous one. If background sends START twice (e.g., for two consecutive state writes), both timers run. First timeout fires, triggers fallback, re-reads storage. Second timeout also fires 2 seconds later, triggers fallback again unnecessarily. Timer IDs accumulate in closure without cleanup reference.

### Why This Is Critical

- Multiple rapid storage writes trigger cascading watchdog timeouts
- Each timeout triggers fallback re-read even if first one already succeeded
- Health monitoring counts become inflated (multiple watchdog triggers per actual state write)
- Sidebar switches to fallback multiple times unnecessarily
- Performance degradation under high-frequency state updates

### Fix Required

Store watchdog timer ID in a global variable (e.g., `let currentStorageWatchdogId = null`). Before creating new timeout in `_startStorageWatchdog()`, clear any existing timer via `if (currentStorageWatchdogId) clearTimeout(currentStorageWatchdogId)`. Store new timer ID before returning. Add logging: "Watchdog started (cleared previous: YES/NO)". Verify this in acceptance criteria by checking logs show at most one active watchdog per expected storage event.

---

## Issue 14: BC Verification Handler Processes Multiple Times

### Problem

The `_handleBCVerificationPong()` handler lacks atomic guard against duplicate processing. If background sends multiple `BC_VERIFICATION_PONG` messages (e.g., if sidebar subscribes to BC twice), the handler could execute twice for the same verification request. Second execution clears already-cleared timeout, logs redundant success, creates confusion in diagnostics.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_handleBCVerificationPong()`, verification state management  
**Issue:** Handler checks `if (!bcVerificationPending) return` but this guard is evaluated AFTER entering the function. If two PONG messages arrive in quick succession (before first handler completes), both pass the initial check because `bcVerificationPending` is still true until first handler sets it false. Second handler then executes identical cleanup logic. Additionally, no check ensures `bcVerificationTimeoutId` is valid before clearing—if both handlers try to clear the timeout, second one clears a null or already-cleared reference.

### Why This Is Critical

- Duplicate verification success logs create misleading diagnostics
- Multiple handlers clearing timeout simultaneously is non-idempotent
- Latency recorded twice for single verification, skewing health metrics
- Second handler's log timestamp doesn't match actual PONG receipt time
- Complicates debugging: diagnostician sees two successful verifications for one request

### Fix Required

Add atomic flag check at start of handler: `if (!bcVerificationPending) return` becomes part of an atomic block. Immediately set `bcVerificationPending = false` at handler start to prevent second entry. Move timeout clear into conditional: `if (bcVerificationTimeoutId !== null) { clearTimeout(...); bcVerificationTimeoutId = null; }` to handle null safely. Add log line: "BC_VERIFICATION_PONG_PROCESSED: First time" or "...Duplicate, ignoring" to track multiplicity. Verify acceptance criteria shows at most one log entry per verification round.

---

## Issue 15: Implicit storage.onChanged Listener Registration Location Undefined

### Problem

Based on code review of quick-tabs-manager.js, the exact location where `browser.storage.local.onChanged.addListener()` executes is unclear. No explicit function call is visible; listener appears to register implicitly during module load or DOMContentLoaded. No log entry confirms registration timing relative to background state writes or DOM readiness.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Top-level module scope vs. DOMContentLoaded handler—ambiguous  
**Issue:** If listener registers at module import time (top-level code), it may register before sidebar DOM is ready and fire events into uninitialized handler. If listener registers during DOMContentLoaded, background may write state before DOMContentLoaded fires, missing first event (Issue 9). No code log clarifies which path executes or when. Initialization sequence doesn't document ordering guarantees between module load, listener registration, and background first write. No verification logging shows listener actually registered.

### Why This Is Critical

- Silent registration creates invisible dependency on initialization timing
- Debugging requires searching entire module for where listener actually registers
- Sidebar reload cycles create unpredictable timing—sometimes listener ready first, sometimes not
- No trace evidence whether listener ever fires successfully
- Violates explicit requirement from primary report Issue 2 for "explicit verification"

### Fix Required

Consolidate listener registration into single, explicit named function (e.g., `_initializeStorageListener()`). Call from DOMContentLoaded handler immediately before other async operations. Add try/catch wrapper with logging: "Storage listener registration attempted" (log before add), "Storage listener registered successfully" (log after add). Store callback reference as named variable, not inline arrow function. Log callback name in success message. Add comment documenting that registration must complete before background writes state. Verify listener by writing test key immediately after registration and confirm callback fires within timeout (per Issue 2 requirements).

---

## Issue 16: Message Flush During DISCONNECTED State Silences Errors

### Problem

When port transitions from ZOMBIE to DISCONNECTED and then reconnects, queued messages flush against a DISCONNECTED port connection. The message flush code in `_flushPortMessageQueue()` processes queued messages by calling `handlePortMessage()`, but if port is DISCONNECTED, any errors from message processing are silently swallowed because error handling assumes port exists and is responsive.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_flushPortMessageQueue()`, connection state check before flush  
**Issue:** Queue flush doesn't verify `connectionState === CONNECTION_STATE.CONNECTED` before processing messages. If port becomes DISCONNECTED, queued messages still flush when listener becomes ready. `handlePortMessage()` receives messages and attempts to process them, but messages may reference stale port state or expect responses that never arrive. Error handlers in `handlePortMessage()` are designed for normal operation—they don't handle the edge case of processing messages against a DISCONNECTED port. Errors are caught but not rethrown, creating silent failures.

### Why This Is Critical

- Critical state update messages lost silently
- Queued messages processed against wrong connection state
- No diagnostic trace showing "queued messages processed during DISCONNECTED state"
- Sidebar thinks state is updated but messages never reached properly initialized handlers
- Compounds with Issue 11 (dual handlers)—second handler processes against disconnected state

### Fix Required

Add pre-check in queue flush: before processing messages, verify `connectionState === CONNECTION_STATE.CONNECTED` and `backgroundPort !== null`. If not connected, log warning "Queue flush aborted: port not connected" and keep messages queued for later flush. After reconnection completes (during CONNECTED establishment), retry flush. Alternatively, add connection state tag to queued messages indicating what state they were queued in, then verify match on flush. Add explicit error logging in `handlePortMessage()` to distinguish "connection state error" from "message processing error".

---

## Issue 17: Concurrent Background Health Probes Trigger Cascading Transitions

### Problem

The `_checkBackgroundActivity()` function runs inside `BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS` (10 seconds). If `_probeBackgroundHealth()` internally uses `Promise.race()` with a 500ms timeout, a check triggered at T=0 might not complete until T=1500 (if probe takes time). Meanwhile, T=10s arrives and starts a new check. If first probe finally resolves at T=1500 with failure, it triggers ZOMBIE transition. At T=2000, second probe resolves and triggers another ZOMBIE transition. Multiple concurrent probes cause cascade of state transitions.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Background activity check interval timing, `_checkBackgroundActivity()`, probe concurrency  
**Issue:** Interval fires every 10 seconds but `_checkBackgroundActivity()` doesn't prevent overlapping probe execution. Each check calls `_probeBackgroundHealth()` which awaits a Promise. If probes are slow, multiple in-flight probes can resolve out of order. Function doesn't guard against concurrent probe state changes. Additionally, probe latency (~500ms) means probes complete during subsequent checks, causing state-checking race conditions where one check detects healthy but another (from minutes ago) finally completes with failure.

### Why This Is Critical

- Multiple ZOMBIE transitions trigger fallback mode multiple times
- Health monitoring reports duplicate state changes
- Fallback activation is non-idempotent—multiple activations increment counters multiple times
- Diagnostic logs show spurious transitions (CONNECTED→ZOMBIE→ZOMBIE instead of CONNECTED→ZOMBIE→CONNECTED)
- Under network latency, probes queue up and resolve unpredictably

### Fix Required

Add concurrency guard: track `let isHealthProbeInFlight = false`. Before starting new probe in `_checkBackgroundActivity()`, check if previous probe still running via `if (isHealthProbeInFlight) return; isHealthProbeInFlight = true;`. Set `isHealthProbeInFlight = false` in finally block of probe execution. This ensures max one probe runs at a time. Add logging: "Health probe started/completed" with duration. Document that probe timeout (500ms) should be well under check interval (10s). Verify acceptance criteria show no concurrent probes in logs and at most one state transition per actual health event.

---

## Issue 18: Failure Counters Updated Non-Atomically with State Checks

### Problem

Connection state transitions depend on failure counter thresholds (e.g., "transition to ZOMBIE if consecutiveHeartbeatTimeouts >= HEARTBEAT_FAILURES_BEFORE_ZOMBIE"), but counter increments and state checks happen in different functions, creating race conditions. Example: `_handleHeartbeatFailure()` increments counter, then checks threshold in separate conditional. Between increment and check, another function could change connection state, making threshold check stale.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_handleHeartbeatFailure()`, `_triggerKeepaliveFallback()`, counter management scattered across functions  
**Issue:** Counters `consecutiveHeartbeatFailures`, `consecutiveHeartbeatTimeouts`, `consecutiveKeepaliveFailures` are updated independently in different functions. State transition logic checks these counters in conditional blocks that are not atomic. Example flow: (1) `sendHeartbeat()` catches error, calls `_handleHeartbeatFailure()` (2) counter incremented to 3 (3) within same function, check `if (consecutiveHeartbeatTimeouts >= HEARTBEAT_FAILURES_BEFORE_ZOMBIE)` BUT another execution path may have already triggered transition. Race condition if multiple heartbeat failures occur simultaneously (timeout during one, port error during another).

### Why This Is Critical

- State transitions can fire multiple times for single fault event
- ZOMBIE state reaches via multiple paths, counters become inconsistent
- Circuit breaker state and failure counters diverge, creating logical inconsistency
- Debugger sees counter=3 but connection state=CONNECTED (mismatch)
- Subsequent recovery attempts confused by inconsistent state

### Fix Required

Consolidate all failure detection and counter updates into single function to ensure atomicity. Create `_checkConnectionHealthAndTransition()` that atomically: (1) increments relevant counter, (2) checks all thresholds, (3) performs state transition, (4) logs with all state details. Replace scattered `_transitionConnectionState()` calls with single consolidated check. Use closure to ensure counter and state checks are in same execution scope. Add explicit state validation before and after transition: log "State transition validation: counter=X, state before=Y, state after=Z" to catch inconsistencies.

---

## Issue 19: Browser Tab Affinity Map Grows Indefinitely Across Reload Cycles

### Problem

The `quickTabHostInfo` Map maintains tab affinity information (which browser tab hosts each Quick Tab) with TTL-based cleanup (24 hours). However, when sidebar reloads (user navigates away from extension, then returns), the Map instance persists across the old sidebar module load and new load. The old Map is never cleared; if sidebar loads 10 times in a session, up to 10 copies of tab data could accumulate (though same keys). More critically, if Quick Tab IDs change across sessions, old entries referencing dead IDs accumulate indefinitely.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Global `const quickTabHostInfo = new Map()` declaration  
**Issue:** Map is global module-level state that persists across sidebar reload. While cleanup job removes entries older than 24 hours, if sidebar is open for days (continuous browser session), cleanup never removes anything—all entries are younger than 24 hours. No cleanup on sidebar unload or window.beforeunload. Map keys are Quick Tab IDs; if background deletes a Quick Tab but old sidebar instance had it in Map, entry never removed. Multiple reload cycles create duplicates of same keys if IDs are recycled. No upper bound on Map size; cleanup is only age-based, not size-based.

### Why This Is Critical

- Memory leak grows over days of continuous extension use
- Map memory usage compounds with each reload without cleanup
- If Quick Tab IDs are reused (after deletion/recreation), stale host info could reference wrong tabs
- Cleanup job (60s interval) adds overhead to tick cycle
- No visibility into Map size or ability to manually clear it

### Fix Required

Add explicit window unload handler to clear Map before sidebar destroys: `window.addEventListener('beforeunload', () => { quickTabHostInfo.clear(); })`. Alternatively, move Map into scoped object with lifecycle (not global module-level). Add size-based cleanup: if Map size exceeds N entries (e.g., 1000), run aggressive cleanup removing oldest entries. Add logging: "Host info map size: X entries" every 5 minutes during normal operation. Add Map size check in diagnostics to alert if size exceeds expected bounds. Verify acceptance criteria show Map is cleared on sidebar unload and size stays below threshold.

---

## Issue 20: Fallback Health Stats Accumulate Across Activation Cycles

### Problem

The `fallbackStats` object tracks statistics for fallback mode health (message counts, latency, timestamps). When fallback activates, object is initialized with `fallbackStats.startTime = Date.now()`. However, if fallback deactivates (port recovers) and then reactivates later, `fallbackStats` object is not reset—it continues accumulating from previous session. Message counts, latency sums, and timestamps span multiple fallback periods, creating misleading health metrics that appear to show ongoing degradation when actually each session is independent.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `_startFallbackHealthMonitoring()`, initialization of fallback metrics  
**Issue:** Function sets `fallbackStats.startTime = Date.now()` but doesn't clear other fields. Previous cumulative counters (`stateUpdatesReceived`, `latencySum`, `lastLatencyMs`) persist from prior session. If fallback ran for 1 minute, then recovered, then ran again for 30s, metrics show combined 90s of activity when second session is only 30s. Average latency calculation uses old `latencySum` divided by new `latencyCount`, producing meaningless values. Health probe logs appear to show degrading performance over days when actually each fallback cycle is independent.

### Why This Is Critical

- Diagnostic metrics mislead about actual fallback health
- Alert thresholds based on cumulative stats fire on stale data
- Impossible to compare one fallback cycle to another—all mixed together
- Multiple reactivations appear as single long degradation event
- Recovery validation can't distinguish "truly recovered" from "still degraded from old session"

### Fix Required

Create reset function `_resetFallbackStats()` that clears all fields: `stateUpdatesReceived = 0`, `latencySum = 0`, `latencyCount = 0`, `lastLatencyMs = 0`, etc. Call this function at START of `_startFallbackHealthMonitoring()` before initializing. Similarly, add `_stopFallbackHealthMonitoring()` that captures final stats before clearing, logs summary of that cycle (e.g., "Fallback session: 45 messages in 30s, avg latency 150ms"). Call stop function when fallback deactivates. Add lifecycle markers in logs: "FALLBACK_SESSION_START", "FALLBACK_SESSION_STOP" to clearly delineate cycles. Verify acceptance criteria show separate logs for each activation cycle, not cumulative metrics.

---

## Shared Implementation Constraints

- All new logging must use consistent prefix `[QT-Manager]` or `[Manager]` for filtering, matching existing convention
- No changes to storage.local structure; all mechanisms must operate with existing `quick_tabs_state_v2` key
- Port connection state machine and listener registration mechanisms remain functionally unchanged—only add instrumentation and fix race conditions
- Fixes must not block initialization; warnings should log and continue, not throw or wait indefinitely
- All fixes must maintain backward compatibility with tabs stored in v1.6.3 or earlier formats

---

## Acceptance Criteria

**Issue 9: Listener Registration Timing**
- storage.onChanged listener registration verified before sidebar main initialization completes
- Test write to storage immediately after registration confirms listener fires within 1000ms
- Logs show "STORAGE_LISTENER_VERIFIED" with timestamp before first state load attempt
- Sidebar recovers from empty state even if background writes during init window

**Issue 10: Port Message Queue Ordering**
- Queued messages include monotonic sequence IDs before listener registration
- Queue flush validates monotonic sequence during flush (logs any reordering)
- Out-of-order messages logged explicitly with sequence numbers
- Manual test: rapid port disconnects during message flow show no state inconsistencies

**Issue 11: Old Port Listener Removal**
- Old onMessage listener explicitly removed in onDisconnect handler before port = null
- Reconnection logs show "old listener removed, new listener registered"
- Concurrent message processing doesn't occur (verified by message entry/exit logs non-overlapping)
- Multiple reconnect cycles show single handler per cycle, not accumulated listeners

**Issue 12: Tier Status Hysteresis**
- Tier status requires 3+ BC messages within time window before setting active (not single message)
- Tier status requires 15+ second silence before flipping to inactive (not 10s)
- Logs show "Tier status: Active (confidence HIGH - 5/5 messages)" vs. "single message received, confidence LOW"
- Rapid state flips do not occur when BC messages arrive sporadically

**Issue 13: Storage Watchdog Timer Cleanup**
- Multiple START_STORAGE_WATCHDOG messages cancel previous timer before creating new one
- Logs show "Watchdog started (cleared previous: YES)" when timer replaced
- Max one watchdog timeout per actual storage event, not multiple cascading timeouts
- Manual test: rapid state writes show only one fallback re-read per write, not multiple

**Issue 14: BC Verification Handler Atomicity**
- BC_VERIFICATION_PONG handler runs at most once per verification request
- Handler sets bcVerificationPending = false atomically to prevent re-entry
- Logs show single entry: "BC_VERIFICATION_SUCCESS" per round (no duplicates)
- Multiple PONG messages ignored after first processes (logged as duplicate)

**Issue 15: Storage Listener Registration Explicit**
- Single named function `_initializeStorageListener()` called from DOMContentLoaded
- Logs show "STORAGE_LISTENER_INITIALIZATION: attempting registration"
- Log shows "STORAGE_LISTENER_INITIALIZED: success" with callback reference
- If registration fails, logs "STORAGE_LISTENER_INITIALIZATION_FAILED" and disables Tier 3

**Issue 16: Queue Flush Connection State Check**
- Pre-check verifies `connectionState === CONNECTED` before flushing queued messages
- If disconnected, logs "QUEUE_FLUSH_DEFERRED: port not connected, will retry after reconnect"
- Messages stay queued until reconnection completes
- No silent errors from processing messages against wrong connection state

**Issue 17: Concurrent Health Probe Guard**
- Health probe concurrency guard prevents overlapping probes
- Logs show "Health probe started/completed" with duration and completion status
- No concurrent probes in diagnostic logs (max 1 in-flight at any time)
- Multiple state transitions do not occur from delayed probe resolutions

**Issue 18: Atomic Failure Counter Updates**
- Single consolidated function checks counters and transitions state atomically
- Logs show "STATE_TRANSITION_CHECK: counter=X, threshold=Y, action=TRANSITION" in single entry
- Before/after state logged with counter values to show consistency
- No mismatches between failure counter and actual connection state

**Issue 19: Browser Tab Affinity Map Cleanup**
- window.beforeunload handler clears quickTabHostInfo Map before sidebar unload
- Logs show "HOST_INFO_MAP_CLEARED: X entries removed" on unload
- Map size stays below N threshold; if exceeded, aggressive cleanup runs
- Repeated reload cycles don't accumulate dead entries

**Issue 20: Fallback Health Stats Reset**
- `_resetFallbackStats()` clears all counters at start of `_startFallbackHealthMonitoring()`
- `_stopFallbackHealthMonitoring()` logs final stats before reset: "FALLBACK_SESSION_ENDED: 45 messages in 30s"
- Separate logs for each activation cycle: "FALLBACK_SESSION_START" and "FALLBACK_SESSION_ENDED"
- Metrics for cycle N are independent from cycle N-1, no cumulative calculations

**All Issues**
- No new console errors or warnings from fixes
- Existing message deduplication and port state machine logic unaffected
- All logging uses `[QT-Manager]` prefix for filtering
- Manual test: sidebar reload, port disconnect/reconnect, rapid state writes show logs from all fixed areas with no silent failures

---

## Supporting Context

<details>
<summary><strong>Firefox Document Lifecycle in Sidebars</strong></summary>

Firefox sidebars follow a different document lifecycle than regular tabs. `document.readyState` may become `'complete'` while module imports and initialization code are still executing. Event listener registration order is not guaranteed to follow `DOMContentLoaded` event order. This creates a window where background scripts can write state before sidebar listeners are ready to receive it.

Per Mozilla WebExtensions documentation, sidebar scripts should register persistent listeners (like storage.onChanged) during module load (top-level code), not inside event handlers, to avoid timing races.

</details>

<details>
<summary><strong>browser.runtime.Port Cleanup Requirements</strong></summary>

When a `browser.runtime.Port` created via `runtime.connect()` becomes closed or disconnected, the browser does NOT automatically remove listeners registered via `port.onMessage.addListener()`. Developers must explicitly call `port.onMessage.removeListener(callback)` before releasing the port reference, or listeners persist in memory.

This is documented in MDN under runtime.Port: "Listeners are not automatically removed when the port disconnects."

</details>

<details>
<summary><strong>Concurrent Promise Race Condition Pattern</strong></summary>

When `Promise.race()` or `Promise.timeout()` patterns are used inside interval handlers, overlapping intervals can create multiple in-flight promises. If probe timeout is 500ms and interval is 10s, overlapping is unlikely. However, under network latency or system lag, a probe from T=0 could still be pending at T=10s when next interval starts, creating two concurrent probes that resolve out-of-order. This is a known concurrency issue in timer-based polling patterns.

</details>

<details>
<summary><strong>Memory Accumulation in Global Maps</strong></summary>

JavaScript Maps at module scope persist for the lifetime of the module/context. Sidebar modules reload with each sidebar panel open/close cycle. Without explicit cleanup, state persists across reloads. TTL-based cleanup (age-based eviction) only works if entries are actually old—if sidebar stays open, all entries remain "young" and never evict. Size-based eviction (LRU) is needed as fallback.

</details>

---

## Priority and Dependencies

**Priority:** High (Issues 9-18), Medium (Issues 19-20)

**Target:** Single coordinated PR bundling Issues 9-20 after primary issues (1-8) are addressed

**Estimated Complexity:** Medium-High

**Dependencies:**
- Issues 9-20 should be addressed after primary Issues 1-8 are complete
- Issue 9 (listener registration) affects Issue 2 (listener verification) from primary report
- Issue 11 (handler cleanup) depends on port connection state from primary Issue 1
- Issues 17-18 (health probes, atomic counters) interact with primary Issues 4-5 (heartbeat tracking)

---

## Formatting Note

This diagnostic report covers 12 distinct issues that extend beyond the primary 8-issue architectural report. These issues form a second tier of systemic defects that create race conditions, state inconsistencies, and memory leaks. Each issue is documented with specific file locations and root causes to enable targeted fixes without code rewrites.

