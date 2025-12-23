# Quick Tabs Extension: Message Port Lifecycle & Backpressure Management Issues

**Extension Version:** v1.6.4+ | **Date:** 2025-12-23 | **Scope:** Message handling architecture including Firefox-specific port lifecycle edge cases, backpressure management, and initialization synchronization

---

## Executive Summary

The Quick Tabs extension exhibits multiple interconnected issues in its message routing and state initialization architecture, particularly affecting Firefox users. These problems manifest as phantom Quick Tab creation failures, silent message drops during rapid operations, and recovery failures after browser back/forward navigation. The root causes involve incomplete Firefox BFCache port lifecycle handling, insufficient backpressure mechanisms that log warnings without shedding load, unprotected race conditions in hydration draining, and timing gaps in message timeout calculations. These issues are bundled because they collectively create cascading failure modes under stress conditions on slow systems.

---

## Issue 1: Firefox BFCache Silent Port Disconnection Not Handled

### Problem Summary
When a tab enters Firefox's Back/Forward Cache (BFCache) state, message ports may disconnect silently without triggering the `onDisconnect` event. Subsequently, when the page restores from BFCache, the extension continues using stale port references, causing all message operations to fail. Firefox's behavior differs from Chrome—Firefox may not fire `onDisconnect` during BFCache transitions, leaving the content script with invalid port state.

### Root Cause
**File:** `src/content.js`  
**Location:** BFCache handling code (lines ~2320-2380; `_markPageInactive()`, `_markPageActive()`, pageshow/pagehide listeners)  
**Issue:** The extension tracks BFCache state via timestamp but doesn't actively validate port connectivity when page restores. The `pageshow` listener calls `_markPageActive()` which clears the inactive timestamp, but doesn't verify that the message port to the background is actually still connected. If the port was silently disconnected during BFCache, subsequent messages on that stale port reference fail without triggering reconnection logic.

**File:** `src/content.js`  
**Location:** Port initialization and reconnection logic (lines ~1200-1400 across multiple port management functions)  
**Issue:** No explicit port cleanup or validation on `pagehide`. The extension relies on implicit `onDisconnect` handling that Firefox may not trigger for BFCache scenarios.

<scope>
**Modify:**
- `src/content.js` (BFCache event listeners, port validation logic)
- Port initialization functions that establish message channel

**Do NOT Modify:**
- `src/background/` (out of scope for this issue)
- UI/DOM elements in `src/ui/` (independent concern)
</scope>

### Fix Required
Implement explicit port validation after BFCache restoration. When `pageshow` event fires, the content script should verify port connectivity before using it for message operations. If port connectivity check fails, initiate immediate reconnection rather than assuming the existing port is valid. Additionally, add explicit port cleanup on `pagehide` to ensure clean state transition into BFCache. This requires adding a ping/validation mechanism that runs after page restoration but before allowing Quick Tabs operations to proceed.

<acceptance_criteria>
- [ ] Port connectivity is validated when `pageshow` event fires
- [ ] If port validation fails after BFCache restoration, reconnection is initiated automatically
- [ ] Explicit port cleanup occurs on `pagehide` event
- [ ] Manual test: Navigate back/forward on a page with Quick Tabs → Quick Tabs operations succeed after restoration
- [ ] Firefox-specific: BFCache navigation doesn't leave stale port references in memory
</acceptance_criteria>

### Supporting Context

<details>
<summary>Firefox API Behavioral Difference</summary>
Per [Chrome Blog - BFCache behavior with extension message ports](https://developer.chrome.com/blog/bfcache-extension-messaging-changes): "When a page is put into BFCache, the extension cannot keep the page from being evicted via message channel closure." Firefox implements BFCache differently—the `onDisconnect` event is not guaranteed to fire when transitioning to BFCache state, creating a window where the content script believes the port is valid but the background has already closed it.
</details>

<details>
<summary>Symptom Pattern</summary>
Users report that after back/forward navigation in Firefox, Quick Tabs temporarily become unresponsive. Operations fail silently. Refreshing the page resolves the issue. This indicates a stale port reference that becomes invalid after BFCache restoration.
</details>

---

## Issue 2: Adaptive Message Timeout Insufficient for Firefox Latency Variance

### Problem Summary
The adaptive timeout mechanism in `sendMessageWithTimeout()` calculates timeouts based on recent message latencies using a 95th percentile calculation. However, Firefox's service worker message passing exhibits higher variance in latency than Chrome, and the adaptive calculation may undershoot the actual needed timeout, particularly during background service worker initialization or under system load.

### Root Cause
**File:** `src/content.js`  
**Location:** `_getAdaptiveTimeout()` function (lines ~2175-2195)  
**Issue:** The function uses `Math.floor(sorted.length * 0.95)` to find the 95th percentile, but on Firefox with small sample sizes (< 10 messages), this percentile may be too aggressive. Additionally, the function doesn't account for Firefox-specific latency spikes during service worker initialization. The default timeout is 5 seconds, but Firefox operations frequently exceed this under normal conditions.

**File:** `src/content.js`  
**Location:** `DEFAULT_MESSAGE_TIMEOUT_MS` constant (line ~2150) and `_computeEffectiveTimeout()` (line ~2375)  
**Issue:** The 5-second default was optimized for Chrome and doesn't account for Firefox's inherently slower message round-trip time, particularly after background service worker restarts.

<scope>
**Modify:**
- `src/content.js` timeout calculation functions
- Timeout constant definitions

**Do NOT Modify:**
- Message routing logic in `src/background/MessageRouter.js`
- Handler implementations in `src/background/handlers/`
</scope>

### Fix Required
Adjust the adaptive timeout calculation to use a more conservative percentile estimate on Firefox and increase the baseline timeout multiplier. The solution should distinguish between normal operation latencies and initialization/restart scenarios. When background restart is detected, temporarily increase timeout thresholds to account for background service worker startup delay. Additionally, implement exponential backoff for timeout retries rather than fixed retry intervals.

<acceptance_criteria>
- [ ] Adaptive timeout uses more conservative percentile (90th or lower) for Firefox
- [ ] Default timeout increased from 5 seconds to a value accounting for Firefox baseline
- [ ] Background restart detection triggers temporary timeout increase
- [ ] Timeout retries use exponential backoff pattern
- [ ] Manual test: Slow Firefox system (simulated with DevTools throttling) successfully sends messages without timeout
</acceptance_criteria>

---

## Issue 3: Multiple Async/Await Patterns Creating Port Closure Race Conditions

### Problem Summary
The extension uses inconsistent async/await patterns across multiple message sending paths. Some paths use `Promise.race()` with manual timeout logic, others rely on implicit async handling, and some don't properly return promises to the message listener. In Firefox, if a message listener doesn't return a true value or return a Promise, the port closes before the async response completes, resulting in "port closed before response received" errors.

### Root Cause
**File:** `src/content.js`  
**Location:** Multiple message sending functions: `_sendHeartbeat()` (lines ~2535-2570), `_sendMessageWithRetry()` (lines ~2815-2850), port message listeners  
**Issue:** Functions use `async/await` but don't consistently return true from the listener or ensure proper Promise handling. Firefox's stricter port lifecycle means a listener MUST either return true immediately (to indicate async response) or return a Promise. Some paths in the code don't follow this pattern.

**File:** `src/content.js`  
**Location:** Where `browser.runtime.onMessage` listener is attached and how responses are handled  
**Issue:** No centralized management of listener return value consistency. Different code paths have different response patterns.

<scope>
**Modify:**
- `src/content.js` message listener attachment and response handling
- All async message sending functions to ensure consistent Promise return pattern

**Do NOT Modify:**
- Handler business logic in `src/background/handlers/`
- Background message routing core
</scope>

### Fix Required
Standardize all message listener patterns to explicitly return promises or true values in a consistent manner. Wrap all async operations in a Promise-based architecture that guarantees the listener returns a promise to the browser API before any async work begins. For heartbeat and other critical messages, ensure the response is sent through the Promise chain, not via callback-based `sendResponse()` after async delay.

<acceptance_criteria>
- [ ] All `browser.runtime.onMessage` listeners return true or Promise immediately
- [ ] No async operations occur after listener returns
- [ ] Manual test: Firefox DevTools console shows no "port closed before response received" errors
- [ ] Firefox stress test: 50+ rapid message sends succeed without port closure
</acceptance_criteria>

---

## Issue 4: Unbounded Queue Backpressure Without Load Shedding

### Problem Summary
The extension implements four separate message queues during initialization (`initializationMessageQueue`, `preHydrationOperationQueue`, `droppedMessageBuffer`, `pendingMessages` Map) with various size limits (100, unlimited, 10-50, 30s TTL). When initialization is slow on Firefox, these queues fill simultaneously, triggering backpressure warnings at 300+ combined messages. However, the system only logs warnings without implementing load shedding—it continues queuing indefinitely, exhausting memory and causing cascading failures.

### Root Cause
**File:** `src/content.js`  
**Location:** Queue management and backpressure checking (lines ~2430-2600; `_checkGlobalBackpressure()`, `_handleQueueOverflow()`, queue-related constants)  
**Issue:** The `_checkGlobalBackpressure()` function logs a warning when total queue depth exceeds `GLOBAL_QUEUE_BACKPRESSURE_THRESHOLD` (300), but this warning is informational only. The function doesn't trigger load shedding, rate limiting, or operation rejection. Messages continue to be accepted and queued even after backpressure threshold is exceeded.

**File:** `src/content.js`  
**Location:** `_queueInitializationMessage()` (lines ~2560-2590)  
**Issue:** Function checks backpressure but doesn't reject or drop lower-priority messages. It only buffers overflow messages to `droppedMessageBuffer` with dynamic size limits, but this buffer itself has limited capacity and silently drops messages when full.

<scope>
**Modify:**
- `src/content.js` backpressure management functions
- Queue overflow handling to implement load shedding
- Priority assignment for different operation types

**Do NOT Modify:**
- Core initialization sequence in `_markContentScriptInitialized()`
- Handler logic in `src/background/handlers/`
</scope>

### Fix Required
Implement load shedding when queue backpressure exceeds thresholds. Lower-priority operations should be rejected with explicit backpressure error responses, allowing callers to implement their own retry logic. Distinguish between critical operations (Quick Tab creation) and non-critical ones (status updates). Additionally, implement progressive backpressure levels: at 50% threshold, reject non-critical operations; at 75%, reject medium-priority operations; at 90%, only accept critical operations. Add metrics tracking to distinguish between backpressure due to slow background vs. slow initialization.

<acceptance_criteria>
- [ ] Load shedding rejects non-critical operations when queue depth exceeds 50% of max
- [ ] Backpressure errors include retry-able flag so callers can exponentially back off
- [ ] Critical operations (CREATE_QUICK_TAB) continue to queue even under backpressure
- [ ] Manual test: Flood extension with 200+ messages → system responds with backpressure rejections, not hangs
- [ ] Memory usage remains bounded even under sustained high load
</acceptance_criteria>

---

## Issue 5: Hydration Queue Drain Lock Race Condition

### Problem Summary
The hydration timeout mechanism uses a drain lock (`isHydrationDrainInProgress`) to prevent concurrent draining of the pre-hydration operation queue. However, operations arriving during an in-progress drain window are queued, but subsequent hydration completion calls skip the drain if the lock is held. This creates a scenario where operations queued during the initial drain never get processed.

### Root Cause
**File:** `src/content.js`  
**Location:** `_drainPreHydrationQueue()` and `_markHydrationComplete()` (lines ~2750-2820)  
**Issue:** The drain lock is acquired in `_drainPreHydrationQueue()` but released only in the finally block. If `_markHydrationComplete()` is called recursively during drain, the second call returns early because the lock is held. Operations queued between the first drain starting and the recursive call never get processed because the second drain is skipped.

**File:** `src/content.js`  
**Location:** Hydration timeout initialization and warning logic (lines ~2920-3000)  
**Issue:** The 10-second hydration timeout can fire while a drain is in progress. If the timeout fires during drain, it calls `_markHydrationComplete()` which returns early due to the lock, silencing any indication that a second drain was needed.

<scope>
**Modify:**
- `src/content.js` hydration draining and completion logic
- Drain lock mechanism to handle concurrent arrivals

**Do NOT Modify:**
- Core initialization flow
- Background hydration sending logic
</scope>

### Fix Required
Instead of a simple boolean lock, implement a queue-based drain mechanism that tracks whether a drain is scheduled. When a drain is in progress and new `_markHydrationComplete()` calls arrive, queue them for processing after the current drain completes. Alternatively, extend the drain to continuously check for new operations in the queue until the queue is empty, rather than processing a single snapshot.

<acceptance_criteria>
- [ ] Operations arriving during drain window are processed in subsequent drains
- [ ] No operations are lost due to concurrent _markHydrationComplete() calls
- [ ] Manual test: Queue operations throughout entire initialization window → all operations eventually process
- [ ] Drain completes within 100ms for 500+ queued operations
</acceptance_criteria>

---

## Issue 6: Global Backpressure Calculation References Undeclared Variables

### Problem Summary
The `_getTotalQueueDepth()` function references `messageQueue` and `pendingCommandsBuffer` variables that are declared later in the file. While the code uses `typeof` checks to handle undefined gracefully, this creates a fragile dependency on declaration order. During early initialization, these variables haven't been initialized yet, causing the function to report queue depths as 0 even when actual queues exist, leading to false negatives in backpressure detection.

### Root Cause
**File:** `src/content.js`  
**Location:** `_getTotalQueueDepth()` function (lines ~2475-2500)  
**Issue:** Function accesses `messageQueue` and `pendingCommandsBuffer` which are declared later in the file (around lines 3200+). Using `typeof` checks prevents runtime errors but doesn't guarantee the variables have been initialized when the function is called early. Early initialization calls report inaccurate queue depths.

<scope>
**Modify:**
- `src/content.js` backpressure calculation function
- Variable initialization order or function logic to handle initialization state

**Do NOT Modify:**
- Core message queue implementations
- Background message handling
</scope>

### Fix Required
Either move variable declarations earlier in the file (before backpressure functions) or modify `_getTotalQueueDepth()` to check whether variables are initialized rather than just checking if they're defined. Additionally, track initialization state explicitly so backpressure functions know whether to include certain queues in their calculations. This ensures accurate backpressure metrics from the very start of initialization.

<acceptance_criteria>
- [ ] Queue depth calculations are accurate from initialization start
- [ ] Backpressure detection doesn't have false negatives during early init
- [ ] Variables are either initialized before use or state is tracked explicitly
- [ ] Unit test: Call _getTotalQueueDepth() at T=0ms of initialization → returns accurate count
</acceptance_criteria>

---

## Issue 7: Message ID Collision Detection Uses Recursive Regeneration

### Problem Summary
The message ID collision detection mechanism regenerates message IDs recursively if a collision is detected. On systems with very high message throughput or rapid port reconnections, the timestamp-based ID generation (`Date.now()`) could produce identical timestamps, creating collision chains that potentially hit JavaScript stack depth limits.

### Root Cause
**File:** `src/content.js`  
**Location:** `_generateMessageId()` function (lines ~2650-2665)  
**Issue:** The function generates IDs using `Date.now()` which has millisecond precision. On fast systems, multiple calls within the same millisecond generate identical timestamps. The collision detection uses recursive regeneration instead of iterative retry, risking stack overflow on systems with sustained high message throughput.

<scope>
**Modify:**
- `src/content.js` message ID generation function
- Collision detection to use iterative instead of recursive approach

**Do NOT Modify:**
- Message routing or correlation logic
- Background message handling
</scope>

### Fix Required
Replace recursive regeneration with an iterative retry loop or add microsecond-precision supplementary ID components. Add a counter suffix to the message ID that increments on collision rather than regenerating the entire ID. This ensures deterministic, bounded ID generation without recursion.

<acceptance_criteria>
- [ ] Message ID generation doesn't use recursion
- [ ] No stack depth issues even under 10k msg/sec throughput
- [ ] Collision detection completes in O(1) time
- [ ] Unit test: Rapid message generation doesn't produce duplicate IDs
</acceptance_criteria>

---

## Issue 8: Stale Event Rejection Timestamp Comparison Not Clock-Skew-Aware

### Problem Summary
The stale event rejection mechanism (Issue #52) compares event timestamps against `pageInactiveTimestamp` to determine if events occurred while the page was in BFCache. However, the comparison doesn't account for clock skew or processing delays between content and background contexts. Events generated by the background immediately before page inactivity may be marked as stale if background clock is slightly ahead of content clock.

### Root Cause
**File:** `src/content.js`  
**Location:** `_isStaleEvent()` function (lines ~2345-2350)  
**Issue:** The comparison `eventTimestamp < pageInactiveTimestamp` assumes perfect clock synchronization. If background clock is 10ms ahead of content clock, legitimate events from background appear stale.

<scope>
**Modify:**
- `src/content.js` stale event detection logic
- Add tolerance window or clock synchronization

**Do NOT Modify:**
- BFCache state tracking
- Event queueing mechanism
</scope>

### Fix Required
Add a tolerance window (e.g., 100ms) around the `pageInactiveTimestamp` to account for clock skew and processing delays. Events within the tolerance window are not considered stale. Alternatively, implement clock synchronization between content and background to establish a canonical time reference.

<acceptance_criteria>
- [ ] Stale event detection accounts for 100ms clock skew tolerance
- [ ] Legitimate events from background are not rejected as stale
- [ ] Manual test: Events sent by background just before pagehide are processed, not rejected
</acceptance_criteria>

---

## Issue 9: Missing Circuit Breaker Pattern for Repeated Heartbeat Failures

### Problem Summary
The heartbeat mechanism tracks failure count and assumes background restart after max failures, but doesn't implement exponential backoff. If the background becomes permanently unresponsive, the extension retries heartbeats at fixed 15-second intervals indefinitely, creating a cascading queue of failed messages without reducing load.

### Root Cause
**File:** `src/content.js`  
**Location:** `_sendHeartbeat()` and heartbeat interval management (lines ~2535-2580)  
**Issue:** After `HEARTBEAT_MAX_FAILURES` (3 failures), the extension calls `_handleBackgroundRestart()` but then continues the interval-based heartbeat at the same frequency. If background is truly unresponsive, subsequent heartbeat attempts fail immediately, without slowing down.

<scope>
**Modify:**
- `src/content.js` heartbeat interval and retry logic
- Implement exponential backoff for failed heartbeats

**Do NOT Modify:**
- Background service worker logic
- Port lifecycle management
</scope>

### Fix Required
Implement exponential backoff for the heartbeat interval after failures. After the first 3 failures, increase the heartbeat interval from 15 seconds to 30, 60, then 120 seconds. Provide a mechanism to reset the backoff when heartbeat succeeds. Additionally, after a certain threshold of consecutive failures, pause heartbeat attempts entirely and rely on operational messages to detect recovery.

<acceptance_criteria>
- [ ] Heartbeat interval increases exponentially after repeated failures
- [ ] No heartbeat attempts occur for 2+ minutes after threshold of failures
- [ ] Successful heartbeat resets backoff counter to baseline
- [ ] Manual test: Disable background service worker → extension reduces heartbeat attempts over time
</acceptance_criteria>

---

## Issue 10: Missing Timeout Per Queued Pre-Hydration Operation

### Problem Summary
The pre-hydration operation queue (`preHydrationOperationQueue`) processes operations sequentially but doesn't enforce individual operation timeouts. If a single queued operation hangs indefinitely, all subsequent operations in the queue are blocked, causing the entire initialization to stall.

### Root Cause
**File:** `src/content.js`  
**Location:** `_executeQueuedOperation()` and queue draining logic (lines ~2790-2820)  
**Issue:** The `await operation.callback(operation.data)` has no timeout. If the callback never resolves, the drain loop halts indefinitely.

<scope>
**Modify:**
- `src/content.js` queue operation execution logic
- Add per-operation timeouts to prevent blocking drain

**Do NOT Modify:**
- Queue insertion logic
- Caller responsibility
</scope>

### Fix Required
Wrap each queued operation in a timeout Promise that rejects after a fixed duration (e.g., 5 seconds). Catch timeout rejections and continue to the next operation. Log operations that timed out for diagnostics.

<acceptance_criteria>
- [ ] Individual queued operations timeout after 5 seconds
- [ ] Timeout doesn't block subsequent operations in queue
- [ ] Timed-out operations are logged with caller context
- [ ] Manual test: Add operation that never resolves → queue drain continues after timeout
</acceptance_criteria>

---

## Issue 11: Missing Comprehensive Initialization Phase Logging

### Problem Summary
While the extension tracks initialization phase completion times (v1.6.3.11-v5 improvements), the logging lacks detail about transitions between phases and doesn't log which specific operations complete within each phase. On slow Firefox systems, it's difficult to diagnose where time is being spent and which operations are blocking initialization completion.

### Root Cause
**File:** `src/content.js`  
**Location:** Initialization phase logging functions (lines ~1100-1150; `_logInitPhaseStart()`, `_logInitPhaseComplete()`)  
**Issue:** Logging tracks phase boundaries but doesn't log individual operation completions within phases. For example, during `featureActivation` phase, which operations complete and in what order?

<scope>
**Modify:**
- `src/content.js` initialization logging to add per-operation granularity
- Feature activation code to emit detailed operation logs

**Do NOT Modify:**
- Core initialization sequence
- Feature implementation details
</scope>

### Fix Required
Add detailed logging at key points within each initialization phase:
- Feature initialization start/complete with duration
- State hydration progress (% of tabs loaded, duration per batch)
- Message queue depth at each phase transition
- Handler registration completion with count
These logs should use consistent prefixes and timestamps for correlation.

<acceptance_criteria>
- [ ] Each feature (notifications, quick-tabs) logs initialization start/complete
- [ ] State hydration logs progress every 100ms if taking longer than 1 second
- [ ] Message queue depth logged at each phase transition
- [ ] Firefox slow system test: Logs clearly show which phase is slow
</acceptance_criteria>

---

## Issue 12: Response Validation Doesn't Check Required Data Fields

### Problem Summary
The `_validateResponseMatchesRequest()` function validates that response message IDs and Quick Tab IDs match the request, but doesn't validate that the response contains required data fields. If a handler returns `{success: true}` without including the expected `data` field, validation passes but subsequent code crashes when accessing `response.data`.

### Root Cause
**File:** `src/content.js`  
**Location:** `_validateResponseMatchesRequest()` and related response handling (lines ~2620-2700)  
**Issue:** Validation checks structural correlation but not semantic completeness. No validation that response contains fields expected by the caller.

<scope>
**Modify:**
- `src/content.js` response validation functions
- Add schema validation for response data based on request type

**Do NOT Modify:**
- Handler implementations in `src/background/handlers/`
- Message routing core
</scope>

### Fix Required
Create a simple schema map from request action to required response fields. For example: `CREATE_QUICK_TAB` requires `{success: true, quickTabId: number}`. Validate responses against this schema and log warnings if required fields are missing, rather than silently passing validation.

<acceptance_criteria>
- [ ] Response schema validation catches missing required fields
- [ ] Validation logs warnings when fields are missing
- [ ] Manual test: Handler returns success=true without data → validation reports issue
</acceptance_criteria>

---

## Issue 13: Port Adoption Timeout Doesn't Account for Slow Firefox Systems

### Problem Summary
The extension manages port adoption to track which tabs own which ports, with adoption timeouts designed for Chrome performance. On slow Firefox systems, the adoption attempts may exhaust allowed retries before a port can be successfully adopted, leaving tabs without valid port references for message operations.

### Root Cause
**File:** `src/content.js`  
**Location:** Port adoption and TTL recalculation logic (mentioned in comments around line 1500; references "Issue #4: Periodic adoption TTL recalculation via heartbeat latency updates")  
**Issue:** Adoption retry delays are fixed and don't scale with observed latency. If Firefox operations are slow, adoption retries may fail before establishing valid port ownership.

<scope>
**Modify:**
- `src/content.js` port adoption retry logic
- Timeout and retry constants to scale with Firefox latency

**Do NOT Modify:**
- Background port management
- Port lifecycle core
</scope>

### Fix Required
Use the heartbeat latency tracking (which already exists) to adjust adoption retry delays. If observed latency is high, increase adoption timeout thresholds proportionally. Implement exponential backoff for adoption retries similar to message retries.

<acceptance_criteria>
- [ ] Adoption timeout scales with observed message latency
- [ ] Adoption succeeds on slow Firefox systems within 5 seconds
- [ ] Manual test: Firefox with simulated 500ms latency → port adoption completes
</acceptance_criteria>

---

## Issue 14: Missing Graceful Degradation on Module Import Failure

### Problem Summary
If any ES6 module import fails in content.js, the entire script halts due to the iframe recursion guard throwing an error at the top of the file. There's no graceful degradation—the content script is either fully functional or completely non-functional. On Firefox with specific extension loading conditions, a single module import failure breaks all Quick Tabs functionality.

### Root Cause
**File:** `src/content.js`  
**Location:** Top of file (lines ~1-150) with iframe guard and module imports  
**Issue:** The iframe recursion guard (lines ~1-120) throws an intentional error to halt execution. If ANY module import fails after the guard, the error propagates and stops execution. No try/catch wrapping the module imports.

<scope>
**Modify:**
- `src/content.js` module import and error handling
- Add fallback/degradation for partial module failures

**Do NOT Modify:**
- Module implementations in core/ and features/
- Error telemetry exports
</scope>

### Fix Required
Wrap module imports in try/catch blocks and provide fallback or degraded functionality if imports fail. Log which modules failed and continue initialization with remaining modules. Provide feature-level degradation rather than complete failure.

<acceptance_criteria>
- [ ] Module import failures are caught and logged
- [ ] Content script continues with degraded functionality if optional modules fail
- [ ] Critical modules trigger explicit failure, optional modules degrade gracefully
</acceptance_criteria>

---

## Summary of Interconnected Issues

These 14 issues create cascading failure modes:

1. **BFCache port disconnection** (Issue 1) makes Firefox back/forward unreliable
2. **Timeout calculation** (Issue 2) + **async/await patterns** (Issue 3) = port closure errors
3. **Unbounded queues** (Issue 4) + **missing load shedding** overflow capacity
4. **Hydration race condition** (Issue 5) loses operations during initialization
5. **Backpressure miscalculation** (Issue 6) fails to detect overload
6. **Message ID collision** (Issue 7) under high throughput degrades performance
7. **Stale event detection** (Issue 8) incorrectly rejects valid operations
8. **Missing circuit breaker** (Issue 9) hammers unresponsive background
9. **Missing operation timeouts** (Issue 10) block queue draining
10. **Insufficient logging** (Issue 11) makes diagnosis difficult
11. **Incomplete validation** (Issue 12) hides handler bugs
12. **Slow Firefox adoption** (Issue 13) leaves tabs without ports
13. **No graceful degradation** (Issue 14) complete failure on import issues

Under stress (rapid operations, slow Firefox, BFCache navigation), these combine to create the symptoms described in issue-47-revised.md.

---

**Priority:** Critical | **Dependencies:** Issues #47, #52, #73 | **Complexity:** High

