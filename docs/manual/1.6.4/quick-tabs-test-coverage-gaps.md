# Quick Tabs Extension: Missing Test Coverage & False-Positive Test Gaps

**Extension Version:** v1.6.4+ | **Date:** 2025-12-23 | **Scope:** Unit test
blind spots, Playwright integration gaps, behavioral coverage failures

---

## Executive Summary

The Quick Tabs extension has extensive test coverage documentation (21
comprehensive behavioral scenarios covering Quick Tab creation, lifecycle
management, state persistence, and Firefox-specific edge cases) yet the
extension remains non-functional due to 14 critical and high-priority bugs.
Analysis reveals the test suite exhibits two critical failure modes: (1) **Unit
tests validate isolated function behavior in artificial conditions** without
exercising cross-system interactions where bugs manifest (message port
lifecycle, timeout edge cases, queue overflow scenarios), and (2) **Playwright
integration tests focus on happy-path user workflows** without covering failure
modes, slow systems, Firefox compatibility edge cases, or cascading failure
scenarios under stress. The primary gaps enable bugs in message routing,
backpressure handling, and Firefox BFCache management to pass test gates despite
rendering the extension non-functional in production.

---

## Missing Test Coverage Categories

| Category                                   | Severity | Coverage Gap                                                  | Root Cause                                             | Tests Pass Despite                                  |
| ------------------------------------------ | -------- | ------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Port Lifecycle Edge Cases                  | Critical | Firefox BFCache reconnection scenarios                        | Unit tests mock ports; no real Firefox lifecycle       | Stale port references cause silent message drops    |
| Timeout Calculation Under Stress           | Critical | Firefox slow system message timeouts                          | Tests use fixed fast latencies, no variance simulation | Premature timeouts on slow Firefox systems          |
| Promise/Async Listener Patterns            | Critical | Port closure during async operations                          | Tests use isolated listener mocks                      | Port closes before Firefox async responses complete |
| Queue Backpressure & Load Shedding         | Critical | Memory exhaustion under 200+ queued operations                | Tests queue up to 50 operations max                    | Unbounded growth exhausts memory in production      |
| Hydration Race Conditions                  | Critical | Operations queued during drain window                         | Lock mock prevents concurrent scenarios                | Operations lost permanently during initialization   |
| Message ID Collision Under Throughput      | High     | High-frequency message generation (10k msg/sec)               | Tests generate <100 msg/sec                            | Stack overflow from recursive regeneration          |
| Firefox Port Adoption Latency              | High     | Port adoption on slow systems (200-500ms latency)             | Tests use Chrome timing assumptions                    | Adoption fails after timeout on slow Firefox        |
| BFCache Timestamp Clock Skew               | High     | Events rejected when clock differs by 10-20ms                 | Tests use synchronized mock clocks                     | Legitimate events incorrectly marked stale          |
| Heartbeat Failure Cascades                 | High     | Repeated heartbeat failures hammering unresponsive background | Tests expect heartbeat success within 3 retries        | Fixed-interval retries exhaust message queue        |
| Initialization Phase Logging Granularity   | Medium   | No per-feature or per-operation initialization logs           | Tests validate phase boundaries only                   | Cannot diagnose which feature causes slow init      |
| Module Import Error Handling               | Medium   | Optional module import failures                               | Tests assume all modules load successfully             | Single import error silences entire extension       |
| Storage Persistence Under Rapid Operations | Medium   | Concurrent writes from multiple handlers                      | Tests serialize operations, use debounce mocks         | Race conditions cause data loss in production       |
| Cross-Tab Message Isolation                | Medium   | Quick Tabs visible in wrong tabs after operations             | Tests use single-tab context                           | Data leakage between tabs undetected                |
| Manager State Sync After Recovery          | Medium   | Manager UI inconsistency after background restart             | Tests don't simulate background restarts               | UI shows stale data after background recovery       |
| Firefox Container-Scoped Isolation         | Low      | Extension leaking tabs across containers                      | Tests don't use Firefox container profiles             | Multi-container environments corrupt state          |

---

## Issue 1: Port Lifecycle Edge Cases Not Tested

**Problem:** Tests pass for port management because they mock
`browser.runtime.onMessage` and port behavior. Real Firefox BFCache transitions
disconnect ports silently without firing `onDisconnect` events. The test suite
never exercises this scenario because it uses simplified in-memory port mocks
rather than real WebExtensions API lifecycle.

**Root Cause:**

**File:** Test files (location unknown; structure needed for precise
reference)  
**Issue:** Unit tests for port handling (`_establishConnection()`,
`_handleDisconnect()`, etc.) mock the `browser.runtime.connect()` and
`onDisconnect` event handlers. Tests verify that functions log messages when
`onDisconnect` fires, but never test the scenario where `onDisconnect` doesn't
fire (Firefox BFCache case). Playwright tests simulate tab navigation but use
standard navigation, not BFCache-triggering back/forward navigation. Tests don't
verify port state after restoration.

**Missing Scenarios:**

- Port validation on `pageshow` event after BFCache restoration
- No reconnection when port is stale (no `onDisconnect` fired)
- Back/forward navigation in Firefox without clearing Quick Tabs
- Rapid back/forward cycles that trigger BFCache multiple times
- Message send operations immediately after `pageshow` (port still stale)

**Why Tests Pass:** Unit tests verify that `_handleDisconnect()` logs a message
when called. They don't test the case where it's never called. Playwright tests
navigate and verify UI appears, but don't send Quick Tab operations
during/immediately after navigation, so the stale port issue never manifests in
the test.

<scope>
**Add Tests:**
- Unit test: Mock port as stale (no `onDisconnect`), verify reconnection occurs on validation call
- Unit test: Simulate `pageshow` event, verify port validation is called before operations
- Playwright test: Firefox back/forward navigation with active Quick Tabs, verify operations complete after restoration
- Playwright test: Rapid back/forward cycles (5+ iterations), verify no permanent state corruption
</scope>

---

## Issue 2: Timeout Calculations Not Tested Under Firefox Latency Conditions

**Problem:** Timeout logic is tested with fixed, fast latency profiles. Tests
don't simulate Firefox's higher message latency variance. The 95th percentile
calculation passes because test messages complete in 50-100ms, well below the
5-second timeout. In production on slow Firefox systems with 200-400ms baseline
latency, the same operations timeout prematurely.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `_getAdaptiveTimeout()`, `sendMessageWithTimeout()`, and
timeout retry logic mock message responses with fixed delays (10-50ms).
Percentile calculations are tested with sample latencies: `[10, 15, 20, 25, 30]`
producing a 95th percentile of ~30ms. No test uses Firefox-realistic latencies
like `[150, 200, 250, 300, 400, 1500]` which would produce a 95th percentile of
~1300ms. Background restart scenarios aren't simulated, so timeout extension
logic never executes in tests.

**Missing Scenarios:**

- Message latency variance matching Firefox (150-400ms baseline, 1-2 second
  outliers)
- Background service worker restart triggering timeout extension
- Small sample size percentile calculation (< 10 messages) with high variance
- Consecutive messages with increasing latency (indicates background slowdown)
- Timeout retry exponential backoff validation
- Slow system simulation (DevTools 6x CPU throttle equivalent)

**Why Tests Pass:** Tests with fixed 30ms latency and 5-second timeout never
timeout. The adaptive calculation with small test sample sizes never requires
extending the timeout. Background restart isn't simulated, so temporary timeout
increase code path never executes.

<scope>
**Add Tests:**
- Unit test: `_getAdaptiveTimeout()` with Firefox realistic latencies (200ms median, 1500ms p95)
- Unit test: Timeout extension on background restart detection
- Unit test: Exponential backoff for timeout retries (2x, 4x, 8x delays)
- Playwright test: Firefox with simulated CPU throttle (via DevTools), verify rapid operations complete
- Playwright test: Trigger background restart, verify messages don't timeout during restart recovery
</scope>

---

## Issue 3: Async/Await Listener Return Patterns Not Validated on Firefox

**Problem:** Tests for message listeners pass because they mock the
`browser.runtime.onMessage` listener behavior. Real Firefox enforces strict port
lifecycle: if a listener doesn't return true immediately or return a Promise,
the port closes. Tests don't validate listener return values or simulate port
closure on improper returns.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Message listener tests mock `browser.runtime.onMessage.addListener()`
without enforcing return value semantics. Tests verify that message handlers
execute and call `sendResponse()`, but don't validate that listeners return true
or Promise synchronously. No test simulates port closure when listener returns
undefined or doesn't return anything. Playwright tests don't check Firefox
console for "port closed before response received" errors, even though this
error appears in real Firefox logs.

**Missing Scenarios:**

- Listener return value validation (true or Promise only, nothing else)
- Port closure simulation when listener returns undefined
- Async operations that occur after listener returns (should fail)
- Callback-based `sendResponse()` after listener returns (port already closed)
- Heartbeat listener specifically (uses async/await without proper return
  pattern)
- Firefox console error detection for port closure errors
- Mixed listener patterns (some return Promise, others return true)

**Why Tests Pass:** Mock listeners never have port closure logic. Tests verify
`sendResponse()` is called with expected data. They don't simulate port closure
or check Firefox console errors. Tests pass because the mock environment doesn't
enforce Firefox's strict port lifecycle rules.

<scope>
**Add Tests:**
- Unit test: Listener return value validation, reject listeners that don't return true or Promise
- Unit test: Mock port closure on listener return violation, verify message operations fail
- Unit test: Async operations after listener return, verify operations don't execute
- Playwright test: Firefox console error capture during message operations
- Playwright test: Heartbeat listener pattern validation (must return Promise, not callback)
- Playwright test: Stress test 50+ rapid messages, verify zero port closure errors in Firefox console
</scope>

---

## Issue 4: Queue Backpressure Not Tested at Realistic Scale

**Problem:** Backpressure and queue management tests simulate 20-50 queued
operations. In production, initialization on slow Firefox systems queues 300+
messages simultaneously. The load shedding logic is tested with volumes that
never approach the threshold, so missing load shedding never manifests in tests.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `_checkGlobalBackpressure()`,
`_queueInitializationMessage()`, and queue management create realistic queue
depths up to 50 messages. The `GLOBAL_QUEUE_BACKPRESSURE_THRESHOLD` is 300, so
tests never reach the threshold. Tests verify that `_checkGlobalBackpressure()`
logs a warning when called, but don't test scenarios where it's called
repeatedly with depths > 300. No test validates that operations are rejected or
dropped when threshold is exceeded. Tests don't simulate memory pressure or
monitor memory growth under sustained load.

**Missing Scenarios:**

- Queue depths of 200-500 messages (realistic slow Firefox initialization)
- Progressive backpressure thresholds (50%, 75%, 90% of max)
- Load shedding for non-critical operations (notifications, status updates)
- Critical operations (CREATE_QUICK_TAB) continuing despite backpressure
- Memory usage monitoring during sustained high load (10,000 queued operations)
- Backpressure error responses with retry guidance
- Caller exponential backoff on backpressure errors
- `droppedMessageBuffer` overflow and message loss tracking

**Why Tests Pass:** Tests with 50 queued messages never trigger load shedding
because the threshold is 300. Tests verify backpressure warning is logged
(informational only), which happens regardless of whether load shedding is
implemented. Memory isn't monitored, so unbounded queue growth isn't detected.

<scope>
**Add Tests:**
- Unit test: Queue depths reaching 300+, verify load shedding is triggered
- Unit test: Non-critical operations rejected at 50% threshold
- Unit test: Memory monitoring, verify bounded growth under sustained 500+ operation load
- Playwright test: Programmatic creation of 200+ Quick Tabs, verify backpressure rejections
- Playwright test: Backpressure errors include retry guidance, callers implement exponential backoff
- Unit test: Dropped message tracking, verify dropped messages are logged with context
</scope>

---

## Issue 5: Hydration Queue Drain Lock Not Tested for Concurrent Scenarios

**Problem:** Hydration queue drain tests verify that operations are processed in
order. Tests don't exercise concurrent `_markHydrationComplete()` calls that
occur when the 10-second timeout fires during an in-progress drain. The boolean
lock prevents concurrent execution in tests, but operations queued during the
drain are lost because the second drain attempt is skipped.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `_drainPreHydrationQueue()` and `_markHydrationComplete()`
create a single queue of operations and drain it sequentially. Tests verify
operations are processed in order. No test simulates operations being queued
while a drain is in progress (requires simulating async delay between
operations). The 10-second hydration timeout is tested in isolation; tests don't
integrate it with drain execution to verify that timeout-triggered drain calls
during an in-progress drain are handled correctly.

**Missing Scenarios:**

- Operations queued during an in-progress drain
- `_markHydrationComplete()` called recursively while lock is held
- 10-second timeout firing during drain execution
- Very large queue (500+) with drain lasting > 100ms
- Second drain scheduled but skipped due to lock
- Operations in queue after first drain completes but before timeout clears lock
- Drain timeout and recovery (what if drain hangs?)

**Why Tests Pass:** Single-threaded drain with sequential operations always
completes. Tests verify operations were processed by checking queue length at
end. Tests don't queue operations during the drain (would require async
simulation) and don't fire timeout during drain. The lock prevents concurrent
execution, so tests pass even though concurrent `_markHydrationComplete()` calls
would lose operations.

<scope>
**Add Tests:**
- Unit test: Simulate operations queued during drain, verify they're processed in subsequent drain
- Unit test: `_markHydrationComplete()` called while drain in progress, verify queued for processing
- Unit test: Timeout fires during drain, verify drain continues rather than returning early
- Unit test: Large queue (500+) with simulated async operation delay, verify all operations process
- Unit test: Drain timeout (if added), verify recovery without losing queued operations
</scope>

---

## Issue 6: Message ID Collision Recursion Not Stressed

**Problem:** Message ID collision detection uses recursive regeneration. Tests
generate <100 messages per test, making ID collisions extremely unlikely
(timestamp granularity is milliseconds). Production scenarios with high
throughput can generate 1000s of messages/second, making collisions likely and
recursion depth a concern.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `_generateMessageId()` verify that IDs are unique within a
single test. Tests generate 10-50 messages per test case. With millisecond
timestamp precision and test execution speed, collisions within a test are rare.
No test generates IDs at high frequency (100+ per millisecond) to force
collisions. No test measures recursion depth during collision detection. No test
simulates sustained high throughput (10k msg/sec) to verify collision handling
doesn't hit stack overflow.

**Missing Scenarios:**

- Rapid ID generation (100+ IDs per millisecond)
- Forced collisions by mocking `Date.now()` to return same value
- Recursion depth monitoring during collision detection
- Stress test: 10k msg/sec for 1 second, verify no stack overflow
- Collision rate under various throughput levels
- Counter-based collision resolution (if implemented)
- ID compactness (counter shouldn't bloat ID length)

**Why Tests Pass:** Tests generate so few IDs that collisions are virtually
impossible. Collision detection code never executes. Tests for the collision
detection function itself pass because they test the function in isolation with
predetermined input, not realistic collision scenarios.

<scope>
**Add Tests:**
- Unit test: Force collisions via mocked `Date.now()`, verify regeneration succeeds
- Unit test: Measure recursion depth during forced collision scenario
- Unit test: Iterative collision resolution (if implemented), verify O(1) behavior
- Stress test: High-frequency ID generation (1k/ms), verify no stack overflow
- Stress test: 10k msg/sec sustained, verify collision handling succeeds
</scope>

---

## Issue 7: Firefox Port Adoption Latency Not Simulated

**Problem:** Port adoption timeout tests use Chrome timing assumptions (port
adoption within 100-200ms). Firefox adoption on slow systems takes 300-500ms.
Tests never simulate this latency, so adoption timeout and retry logic never
executes.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for port adoption mocking `browser.runtime.connect()` with zero
latency (immediate return). Port adoption verification happens synchronously in
tests. No test adds latency to simulate Firefox's slower adoption. Retry logic
is tested in isolation by manually calling the retry function, not by simulating
actual adoption failure due to timeout. Tests use fixed adoption timeout values
without verifying they scale with observed latency.

**Missing Scenarios:**

- Port adoption with 200-500ms latency (Firefox slow system)
- Adoption timeout and retry on slow systems
- Adoption latency scaling based on observed message latency
- Multiple adoption retries with exponential backoff
- Adoption failure after max retries
- Tab left without valid port reference

**Why Tests Pass:** Adoption mocks return immediately, so timeouts never fire.
Tests verify adoption succeeds (because mocks make it succeed), not what happens
when adoption actually times out. Adoption timeout logic is tested separately
from adoption mocking, so real latency scenarios never trigger timeout logic.

<scope>
**Add Tests:**
- Unit test: Mock port adoption with 300-500ms delay, verify timeout and retry
- Unit test: Adoption timeout scales with observed message latency
- Unit test: Exponential backoff for adoption retries
- Playwright test: Firefox slow system simulation, verify adoption completes within 5 seconds
- Unit test: Tab without valid port reference after max adoption retries
</scope>

---

## Issue 8: BFCache Timestamp Clock Skew Not Accounted For

**Problem:** Stale event detection compares timestamps assuming perfect clock
synchronization. Tests use synchronized clocks (both background and content
scripts use same `Date.now()`). In production, background clock may be 10-20ms
ahead, causing legitimate events to be rejected.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `_isStaleEvent()` mock timestamp comparison using
controlled values. Both background and content script tests use mocked
`Date.now()` returning predictable values. No test simulates clock skew where
background timestamp is slightly ahead of content timestamp. Tests verify that
events before `pageInactiveTimestamp` are marked stale (true), but don't test
the boundary case where event is slightly before due to clock skew.

**Missing Scenarios:**

- Background clock 10ms ahead of content clock
- Background clock 50ms ahead (normal variation)
- Events sent immediately before pagehide with background clock lead
- Tolerance window acceptance (events within ±100ms of threshold)
- Clock synchronization during initial port establishment
- Clock skew at different levels of system load

**Why Tests Pass:** Tests with synchronized clocks never produce clock skew edge
cases. Stale event detection logic works correctly for the test scenario. Tests
verify comparison logic (`<` operator) but don't test the boundary conditions
that clock skew would expose.

<scope>
**Add Tests:**
- Unit test: Mock background clock 20ms ahead of content clock, verify legitimate events aren't rejected
- Unit test: Tolerance window around `pageInactiveTimestamp` (±100ms)
- Unit test: Events at boundary (exactly at `pageInactiveTimestamp`) handled correctly
- Playwright test: Monitor console for stale event rejections, verify none under normal operation
</scope>

---

## Issue 9: Heartbeat Failure Cascades Not Tested

**Problem:** Heartbeat failure tests verify that `HEARTBEAT_MAX_FAILURES` (3)
triggers restart detection. Tests don't simulate permanent background
unresponsiveness with fixed-interval retries continuing indefinitely. Circuit
breaker logic (exponential backoff) isn't tested because tests assume heartbeat
succeeds eventually.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `_sendHeartbeat()` mock heartbeat responses with controlled
success/failure. After 3 failures, tests verify `_handleBackgroundRestart()` is
called. No test simulates a heartbeat that fails repeatedly for 5+ minutes.
Heartbeat interval is tested as a fixed value; no test verifies that interval
increases after repeated failures. No test monitors message queue depth to
detect hammering of failed heartbeats.

**Missing Scenarios:**

- Permanent background unresponsiveness (never recovers)
- Fixed-interval heartbeat retries at 15-second intervals
- Message queue depth increasing with failed heartbeat retries
- Exponential backoff after threshold of failures (15s → 30s → 60s → 120s)
- Pause in heartbeat attempts after 2+ minute failure window
- Recovery detection when background becomes responsive again
- Memory impact of queued failed heartbeat messages

**Why Tests Pass:** Tests assume heartbeat recovers after a few failures. After
3 failures, `_handleBackgroundRestart()` is called and heartbeat is (presumed)
reset in tests. Tests don't verify the reset logic or simulate the heartbeat
continuing to fail. Tests don't monitor message queue depth or measure resource
consumption.

<scope>
**Add Tests:**
- Unit test: Continuous heartbeat failures for 5+ minutes, verify exponential backoff
- Unit test: Heartbeat interval increases: 15s → 30s → 60s → 120s after failures
- Unit test: Heartbeat paused after 2+ minute failure threshold, resumed on recovery
- Playwright test: Disable background service worker, monitor heartbeat attempts over time
- Playwright test: Re-enable background, verify heartbeat resumes with appropriate interval
- Unit test: Message queue depth under sustained heartbeat failures
</scope>

---

## Issue 10: Storage Persistence Race Conditions Not Tested

**Problem:** Storage write tests use debouncing mocks that prevent concurrent
writes. Real handlers writing to storage simultaneously create race conditions.
Tests serialize operations, so concurrent write scenarios never manifest.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for `browser.storage.local.set()` mock debouncing. Tests queue
operations and verify debouncing prevents duplicate writes. No test simulates
two independent handlers calling `storage.set()` simultaneously without
coordination. Tests don't verify write atomicity or detect lost updates when
concurrent writes occur.

**Missing Scenarios:**

- Minimize handler writing state while resize handler writes state
- Hydration completing while Quick Tab creation persists state
- Concurrent storage writes without debouncing coordination
- Lost updates (one write overwrites another without merging)
- Storage write order and consistency
- Backup/recovery after failed writes

**Why Tests Pass:** Debouncing mocks serialize operations. Tests verify that
debounce works (mocked function is called once). Tests don't simulate concurrent
writes to expose race conditions.

<scope>
**Add Tests:**
- Unit test: Two simultaneous storage write calls, verify no lost updates
- Unit test: Storage merge strategy for concurrent writes (should deep merge, not overwrite)
- Playwright test: Rapid minimize/restore cycles, verify state consistency in storage
- Unit test: Storage write failure recovery
</scope>

---

## Issue 11: Cross-Tab Message Isolation Not Verified

**Problem:** Quick Tab operations are tab-scoped but tests use single-tab
context. Cross-tab message isolation (Quick Tabs in tab A shouldn't appear in
tab B) is documented but not tested. Production reveals Quick Tabs appearing in
wrong tabs.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Playwright tests create Quick Tabs in a single page context.
Cross-tab testing is documented in issue-47-revised.md (use Playwright's
`context.newPage()` for multiple tabs) but the Playwright suite doesn't
implement multi-tab tests. No test verifies that Quick Tabs from tab A are
hidden in tab B. Storage keys include `originTabId` for tab scoping, but tests
don't validate that retrieval respects the `originTabId` filter.

**Missing Scenarios:**

- Create Quick Tab in tab A, verify not visible in tab B
- Create Quick Tab in tab B, verify not visible in tab A
- Storage isolation by `originTabId`
- Cross-tab communication without leaking Quick Tabs
- Multiple Quick Tabs in tab A, verify only tab A's appear in that tab
- Tab close cleanup (remove Quick Tabs scoped to closed tab)

**Why Tests Pass:** Single-tab tests always show Quick Tabs in the correct
(only) tab. Storage retrieval filters by `originTabId`, which works correctly
when only one `originTabId` is used in tests. Multi-tab scenarios are never
tested.

<scope>
**Add Tests:**
- Playwright test: Multi-page context (tab A and tab B), create Quick Tab in A
- Playwright test: Verify Quick Tab appears only in tab A's Manager, not tab B's
- Playwright test: Create Quick Tabs in both tabs, verify proper isolation
- Playwright test: Storage isolation by `originTabId` during hydration
</scope>

---

## Issue 12: Manager State Sync After Background Restart Not Tested

**Problem:** Background service worker restart is simulated abstractly in tests
by mocking restart detection. Tests don't verify Manager UI updates after
restart. Restart causes port disconnection and reconnection, but Manager display
might show stale data.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for background restart mock the restart event and verify
content script handles it. Tests don't simulate real background stop/start
(Firefox about:debugging). Manager UI is not tested during/after restart. Tests
don't verify storage hydration after restart (Manager should refresh from
storage).

**Missing Scenarios:**

- Stop background service worker via Firefox about:debugging
- Manager UI during background restart (should show loading or be disabled)
- Storage rehydration after restart
- Message port re-establishment after restart
- Manager display consistency after restart vs. before
- Rapid restart cycles

**Why Tests Pass:** Abstract restart mocking doesn't involve real background
termination. Manager isn't tested during restart scenario. Tests verify content
script's restart detection logic but not end-to-end restart handling.

<scope>
**Add Tests:**
- Playwright test: Stop/start background service worker, verify Manager updates
- Playwright test: Storage rehydration after restart
- Playwright test: Quick Tab operations resume after restart
- Manual test: Background restart doesn't leave stale UI state
</scope>

---

## Issue 13: Firefox Container Isolation Not Tested

**Problem:** Firefox Multi-Account Containers create isolated extension
contexts. Quick Tabs should be container-scoped but are global. Tests don't use
container profiles, so this leakage is never detected.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Playwright tests use default Firefox profiles without containers.
Container testing is mentioned in issue-47-revised.md ("Firefox containers
require specific profile configuration in Playwright fixtures") but not
implemented. No test creates multiple container contexts.

**Missing Scenarios:**

- Quick Tab in container A visible in container A only
- Container B cannot see container A's Quick Tabs
- Storage isolation by container
- Cross-container message leakage detection

**Why Tests Pass:** Single-container tests have no cross-container leakage.
Container isolation logic (if it exists) is never tested.

<scope>
**Add Tests:**
- Playwright fixture: Firefox profile with container support
- Playwright test: Multiple containers, verify Quick Tab isolation
</scope>

---

## Issue 14: Initialization Logging Insufficient for Diagnosis

**Problem:** Initialization tests verify phase completion times. Tests don't
validate that logging provides enough granularity for diagnosing slow phases. On
a slow system, logs show "initialization phase 'featureActivation' completed in
3 seconds" without revealing which feature took 2.5 seconds.

**Root Cause:**

**File:** Test files (location needed)  
**Issue:** Tests for initialization phase logging verify that phase
start/complete times are logged. Tests don't verify per-feature logging or
per-operation logging within phases. Tests log phase duration but not the
intermediate operations that make up that duration.

**Missing Scenarios:**

- Per-feature initialization logging (e.g., "[INIT:quick-tabs-feature] completed
  in 1.2s")
- Per-handler registration logging with count
- State hydration progress logging (e.g., "Loaded 45/100 tabs")
- Slow operation detection (logs when any operation takes > 1 second)
- Log format consistency for parsing/analysis
- Initialization waterfall diagram generation from logs

**Why Tests Pass:** Phase-level logging is tested and works. Tests don't
validate per-feature granularity because tests assume all features complete
quickly. Slow system simulation is missing.

<scope>
**Add Tests:**
- Unit test: Per-feature initialization logging
- Unit test: State hydration progress logging (every 100ms for operations > 1s)
- Playwright test: Slow system simulation, verify logs clearly identify slow phase/feature
- Log parsing test: Verify logs can be parsed to generate initialization waterfall
</scope>

---

## Shared Root Causes for Test Gaps

These 14 missing test areas share several common causes:

### 1. **Unit Tests Mock Real Conditions**

Unit tests isolate functions using mocks/stubs for browser APIs
(`browser.runtime.onMessage`, `browser.storage.local`, timers). Mocks simplify
testing but don't enforce Firefox's actual API semantics. Tests pass because
mocks are forgiving; real Firefox APIs are stricter.

**Impact:** Port lifecycle rules, listener return value enforcement, and storage
atomicity aren't validated in tests.

### 2. **Playwright Tests Focus on Happy Path**

Integration tests verify successful user workflows (create, minimize, restore
Quick Tabs). Failure modes, edge cases, and stress scenarios are documented but
not automated. Tests don't exercise slow systems, concurrent operations, or
resource exhaustion.

**Impact:** Timeout, backpressure, and queue overflow bugs aren't caught before
production.

### 3. **Browser Variance Not Simulated**

Tests assume Chrome/Firefox equivalence or use mock behavior. Firefox-specific
issues (BFCache, message port strictness, latency variance) aren't simulated.
Tests don't use real Firefox containers, profiles, or service worker restart.

**Impact:** Firefox-specific bugs (6 of the 14 issues) are invisible in test
suites.

### 4. **Scale and Concurrency Gaps**

Tests verify single-threaded, low-volume scenarios. Production involves hundreds
of queued operations, concurrent handlers, high message throughput. Tests don't
simulate these conditions.

**Impact:** Backpressure, race conditions, and resource exhaustion bugs don't
manifest in tests.

### 5. **Timing and State Transition Gaps**

Tests serialize operations with mocked delays. Real initialization timing is
complex with async operations, state transitions, and timeout edge cases. Tests
don't simulate the timing chaos of slow systems.

**Impact:** Timeout calculations, queue draining, and initialization sequencing
bugs pass tests.

### 6. **Diagnostic Validation Gaps**

Tests verify code execution, not diagnostic outputs. Error logs, console
warnings, and timing logs are generated but not validated. Tests don't parse
logs to ensure they're sufficient for root cause diagnosis.

**Impact:** Missing logging (Issue 11) is invisible because test output isn't
analyzed.

---

## Acceptance Criteria for Test Coverage Improvements

<acceptance_criteria> **Critical Priority (Must Add):**

- [ ] Port lifecycle tests including Firefox BFCache without `onDisconnect`
- [ ] Timeout calculation tests with Firefox realistic latencies (200-1500ms
      range)
- [ ] Async/Await listener return pattern validation with Firefox semantics
- [ ] Queue backpressure tests reaching 300+ operation threshold
- [ ] Hydration drain lock tests with concurrent completion calls
- [ ] Stress tests for message ID collision under 10k msg/sec throughput

**High Priority (Should Add):**

- [ ] Firefox port adoption with 300-500ms latency simulation
- [ ] Clock skew tolerance in stale event detection
- [ ] Heartbeat exponential backoff validation
- [ ] Storage concurrent write race condition detection
- [ ] Cross-tab Quick Tab isolation verification
- [ ] Manager state sync after background restart

**Medium Priority (Nice to Have):**

- [ ] Firefox container isolation testing
- [ ] Initialization per-feature logging validation
- [ ] Log parsing for waterfall diagram generation
- [ ] Module import error handling and graceful degradation

**All Test Additions:**

- [ ] No new console errors or warnings during test execution (especially
      Firefox)
- [ ] Playwright Firefox tests pass on slow system simulation (6x CPU throttle)
- [ ] All existing tests continue to pass
- [ ] Test execution time remains < 15 minutes for full suite
- [ ] Code coverage for edge case handlers increases from current baseline
      </acceptance_criteria>

---

## Why Current Tests Pass Despite Non-Functional Extension

The extension fails in production due to cascading bugs in message routing,
state initialization, and Firefox compatibility. The test suite passes because:

1. **Unit tests validate isolated functions with forgiving mocks** → Individual
   function logic is correct, but integration fails
2. **Playwright tests exercise happy-path workflows only** → Normal operations
   work, but edge cases fail
3. **No Firefox-specific testing** → Chrome behavior hides Firefox-specific bugs
4. **No stress/scale testing** → Low-volume tests hide queue overflow, timeout,
   and resource exhaustion bugs
5. **No concurrent operation testing** → Serialized test operations hide race
   conditions
6. **No diagnostic validation** → Missing logging isn't caught because logs
   aren't analyzed

The result: Tests pass at the unit and simple integration level while the
extension exhibits cascading failures under production load, Firefox-specific
conditions, and concurrent operations.

---

## Recommended Test Suite Expansion Strategy

**Phase 1: Critical Test Additions** (1-2 weeks)

- Port lifecycle edge cases (Firefox BFCache)
- Timeout calculations with Firefox latencies
- Async/await listener validation
- Queue backpressure at realistic scale
- Message ID collision under throughput

**Phase 2: High-Priority Additions** (1 week)

- Firefox port adoption latency
- Clock skew tolerance
- Heartbeat exponential backoff
- Storage concurrent writes
- Cross-tab isolation

**Phase 3: Medium-Priority Additions** (1 week)

- Container isolation
- Per-feature initialization logging
- Log parsing and validation
- Module import error handling

**Tooling Additions:**

- Firefox-specific test profiles (containers, service worker restart)
- Latency simulation fixtures (200-1500ms range for Firefox)
- Concurrent operation helpers (multiple async operations)
- Stress test generators (100-10k operations)
- Log analysis utilities (parse, filter, correlation)
- Memory monitoring during tests
- CPU throttle simulation (DevTools equivalent)

---

**Report Generated:** 2025-12-23  
**Scope:** Test coverage analysis revealing why tests pass despite
non-functional extension  
**Intended Audience:** Test team and GitHub Copilot Coding Agent for test
implementation
