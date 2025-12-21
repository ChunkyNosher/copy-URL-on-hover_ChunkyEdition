# Additional Message Queue & Initialization Issues: Content Script Architecture

**Extension Version:** v1.6.3.10-v12 | **Date:** December 20, 2025 | **Scope:**
Message queuing, hydration timing, state initialization, cross-tab coordination

---

## Executive Summary

The extension has 15 additional problematic areas that create subtle but
critical failures in message handling, state initialization, and cross-tab
coordination. These issues are distributed across message queuing (Issues #26,
#28, #31), initialization state corruption (Issues #27, #34, #36), timing gaps
(Issues #30, #32, #37, #38), and architectural gaps (Issues #33, #35, #39, #40).
Unlike Issues #1-11 which create immediate failures, these manifest as race
conditions, memory leaks, and timing-dependent bugs that are difficult to
reproduce. All 15 contribute to the overall initialization cascade failure
described in Issue #47-revised.md.

| Issue | Component             | Severity | Root Cause                                         |
| ----- | --------------------- | -------- | -------------------------------------------------- |
| #26   | Message queue system  | Critical | Four independent queues without cross-queue limits |
| #27   | Hydration mechanism   | Critical | Timeout race during queue drain                    |
| #28   | Message ID generation | Critical | Non-unique IDs across execution contexts           |
| #29   | Port lifecycle        | High     | Confirmed race in listener registration            |
| #30   | Handshake timeout     | High     | Backoff timing mismatch with phase timeouts        |
| #31   | Sequence coordination | High     | Non-atomic counters across tabs                    |
| #32   | BFCache verification  | High     | No timeout on port test message                    |
| #33   | Adoption cache        | Medium   | Unbounded TTL on Set                               |
| #34   | Navigation state      | Medium   | Flags not reset on beforeunload                    |
| #35   | Background visibility | Medium   | No logging of MessageRouter initialization         |
| #36   | Init symmetry         | Medium   | Asymmetrical readiness validation                  |
| #37   | DOM timing            | Medium   | Iframe detection assumes DOM ready                 |
| #38   | Keyboard handling     | Medium   | Shortcuts processed before manager init            |
| #39   | Broadcast processing  | Medium   | No idempotency guarantees on handlers              |
| #40   | Message routing       | Medium   | No sender tab validation                           |

---

## Issue #26: Message Queue System Lacks Cross-Queue Overflow Protection

**Problem:** The extension implements four independent message queues that can
accumulate simultaneously without coordination, potentially exceeding memory and
timeout limits.

**Root Cause**

File: `src/content.js`  
Location: Queue declarations at lines ~3200-3300  
Issue: Four separate queues exist with independent size limits:

1. `initializationMessageQueue` (MAX_INIT_MESSAGE_QUEUE_SIZE = 100)
2. `messageQueue` (MAX_MESSAGE_QUEUE_SIZE = 50)
3. `pendingCommandsBuffer` (MAX_PENDING_COMMANDS = 50)
4. `preHydrationOperationQueue` (no explicit size limit)

Each queue independently checks its own limit but has no awareness of total
message backlog. During slow background initialization, all four could fill
simultaneously, creating 400+ accumulated operations. The system lacks
mechanisms to:

- Detect combined queue depth
- Coordinate overflow across queues
- Prioritize between queue types
- Backpressure upper layers when ANY queue approaches limits

<scope>
**Modify:**
- `src/content.js` - Add cross-queue coordination mechanism
- Implement unified queue depth tracking (sum of all queue sizes)
- Add global backpressure threshold (e.g., total messages > 300)
- Implement queue priority system for flush order

**Do NOT Modify:**

- Individual queue flush logic
- Handler signatures
- Message format or protocol </scope>

**Acceptance Criteria**

- [ ] Total message count tracked across all four queues
- [ ] Global backpressure threshold triggers when combined depth exceeds 300
- [ ] Backpressure warning logged with details of all queue depths
- [ ] Flush order prioritized: INIT_MESSAGES first, then HYDRATION, then
      COMMANDS, then PORT_MESSAGES
- [ ] Manual test: Slow background (simulated 5s delay) with 100 Quick Tab
      creates → no queue exceeds individual limit AND total doesn't exceed 350
- [ ] Manual test: Console shows single backpressure warning (not per-queue)

<details>
<summary>Why Queue Coordination Matters</summary>

Each queue was designed independently assuming others would be empty. During
normal operation they are. But during slow initialization or heavy user
activity, all four could be active simultaneously:

- User clicks to create 50 Quick Tabs (fills INIT_MESSAGE_QUEUE to 100)
- Hydration still in progress (fills HYDRATION_QUEUE to some threshold)
- Background sends commands (fills COMMAND_BUFFER)
- Port receives messages (fills MESSAGE_QUEUE)

Without coordination, each queue fills independently, but the browser's total
message handling capacity is exceeded, causing timeouts.

The fix is not to make queues smaller (would lose messages) but to track
combined depth and backpressure appropriately.

</details>

---

## Issue #27: Hydration Timeout Race During Queue Drain

**Problem:** The hydration timeout forces completion after 3 seconds, but if
operations are being drained from the queue simultaneously, they could execute
twice or out-of-order.

**Root Cause**

File: `src/content.js`  
Location: Hydration logic at lines ~3730-3800  
Issue: The hydration timeout and queue drain race:

1. Hydration started at T=0, timeout set for T=3000
2. User creates Quick Tab at T=100 → operation queued
3. Hydration completes at T=2500 → calls `_drainPreHydrationQueue()`
4. Drain starts executing queued operations
5. Timeout fires at T=3000 while drain still processing
6. `_markHydrationComplete()` called again (idempotent check exists but timing
   is tight)
7. New operation arrives at T=3050 during last drain operation
8. Is this new operation queued again or executed immediately?

The code has guard `if (isHydrationComplete) return;` but between drain
finishing and flag update, race window exists.

<scope>
**Modify:**
- `src/content.js` - Synchronize hydration completion with queue drain
- Ensure timeout doesn't fire while drain in progress
- Add lock or state machine to prevent concurrent drain/timeout execution

**Do NOT Modify:**

- Hydration timeout duration (3 seconds is reasonable)
- Queue drain logic itself
- Operation data structures </scope>

**Acceptance Criteria**

- [ ] Hydration timeout cannot fire while drain is executing
- [ ] Operations never execute twice from same queue
- [ ] No operations queued after drain completes while timeout still pending
- [ ] Manual test: Hydration timeout + user creates Quick Tab during drain → no
      duplicate operations in manager
- [ ] Log shows clear "DRAIN_IN_PROGRESS" → "DRAIN_COMPLETE" sequence with no
      interleaving timeout
- [ ] No new operations accepted from queued operations after drain marked
      complete

---

## Issue #28: Message ID Generation Creates Collision Risk

**Problem:** Message IDs generated using `Date.now()` plus counter could collide
with IDs generated in background script, breaking message correlation.

**Root Cause**

File: `src/content.js`  
Location: Message ID generation at lines ~2643-2650  
Issue: The ID generation pattern is:

```
function _generateMessageId() {
  return `msg-${Date.now()}-${++messageIdCounter}`;
}
```

If background script uses similar pattern (likely), IDs could collide:

- Content sends `msg-1734000000000-5` at T=1734000000000ms
- Background generates `msg-1734000000000-5` in parallel
- When background sends response with ID `msg-1734000000000-5`, content can't
  distinguish which request it's responding to

Additionally, there's no namespace separation between execution contexts. Both
content and background could generate `msg-1734000000000-1` independently,
creating ambiguity in correlation map.

<scope>
**Modify:**
- `src/content.js` - Add execution context namespace to message IDs
- Ensure background generates IDs with different namespace
- Implement ID validation before using in correlation map

**Do NOT Modify:**

- Message format or protocol
- Correlation tracking mechanism
- Response handling logic </scope>

**Acceptance Criteria**

- [ ] Message IDs include namespace prefix indicating origin (e.g.,
      `msg-content-${Date.now()}-${counter}`)
- [ ] Background uses different namespace (e.g.,
      `msg-bg-${Date.now()}-${counter}`)
- [ ] Collision detection: if ID already in correlation map, generate new ID
      with higher counter
- [ ] Manual test: Concurrent messages from both content and background → no ID
      collisions in pending map
- [ ] ID format includes origin for debugging (clearlyidentifiable which script
      generated it)

---

## Issue #30: Handshake Timeout Mismatch with Reconnection Backoff

**Problem:** Handshake phases timeout faster than reconnection backoff cycles,
creating extended unresponsive periods when repeated handshake failures occur.

**Root Cause**

File: `src/content.js`  
Location: Handshake and backoff configuration at lines ~2900-3000 and
~2270-2300  
Issue: Timing mismatch:

- **Handshake phase timeout:** 2000ms (HANDSHAKE_PHASE_TIMEOUT_MS)
- **Reconnection backoff:** 150ms initial, multiplies by 1.5x per attempt
  - Attempt 1: 150ms
  - Attempt 2: 225ms
  - Attempt 3: 338ms
  - Attempt 4: 507ms
  - ...
  - Max caps at 30000ms

During repeated handshake failures, the sequence becomes:

1. Handshake Phase 1 timeout: 2s
2. Reconnect attempt 1: 150ms wait
3. Handshake Phase 1 timeout again: 2s
4. Reconnect attempt 2: 225ms wait ...continues with 2s gaps

When attempting to recover from background restart, the 2s per-phase timeout
becomes the dominant delay, not the reconnect backoff. This was designed for
single-phase connections, not three-phase handshakes.

<scope>
**Modify:**
- `src/content.js` - Align handshake timeouts with reconnection backoff strategy
- Consider combining timeout into single overall connection timeout
- OR adjust phase timeouts (e.g., 500ms each, 1500ms total) to reflect reconnect delays

**Do NOT Modify:**

- Handshake protocol or phases
- Reconnection backoff multiplier (1.5x is standard)
- Maximum backoff cap (30s is reasonable) </scope>

**Acceptance Criteria**

- [ ] Handshake timeout sequence doesn't exceed overall port connection timeout
- [ ] If handshake times out and triggers reconnect, backoff delay is meaningful
      (not microseconds after 3x 2s timeouts)
- [ ] Manual test: Block INIT_RESPONSE from background → see backoff delays
      between reconnection attempts (not tiny delays after 3x 2s waits)
- [ ] Timing math verified: max(phase timeouts) + backoff delay creates
      predictable recovery curve
- [ ] Recovery time from failed handshake is consistent and documented

---

## Issue #32: BFCache Port Verification Has No Timeout

**Problem:** When verifying port functionality after BFCache restoration, the
test message has no response timeout, potentially causing indefinite hangs.

**Root Cause**

File: `src/content.js`  
Location: BFCache verification at lines ~2485-2510  
Issue: The verification code sends a test message but doesn't set a timeout:

```javascript
backgroundPort.postMessage(testMessage);
// No timeout set on response - if port is dead, hangs forever
```

Compared to other message operations that use MESSAGE_RESPONSE_TIMEOUT_MS
(5000ms), the BFCache verification is missing this safety mechanism. If the port
is dead (service worker unloaded, communication channel broken), the
verification never receives a response and hangs indefinitely.

This is especially problematic because BFCache restoration happens in the
background without user awareness. A hung port would silently prevent all Quick
Tab operations without user knowing.

<scope>
**Modify:**
- `src/content.js` - Add timeout to port verification message
- Implement timeout-based fallback to reconnection
- Add explicit logging showing verification timeout

**Do NOT Modify:**

- BFCache detection logic (pagehide/pageshow listeners)
- Port reconnection sequence
- Message format </scope>

**Acceptance Criteria**

- [ ] PORT_VERIFY message has 1000ms timeout
- [ ] If timeout expires without response, triggers immediate port reconnection
- [ ] Logs show: "[Content][BFCACHE] VERIFY_TIMEOUT: No response, reconnecting"
- [ ] Manual test: After BFCache restore, if background is slow/unresponsive,
      verification completes within 1s and retries connection (not hangs)
- [ ] No silent failures—all timeout scenarios logged

---

## Issue #31: Sequence ID Not Atomic Across Multiple Tabs

**Problem:** Quick Tab creation assigns sequence IDs from a per-tab counter, but
multiple tabs creating Quick Tabs simultaneously could have out-of-order
sequence IDs at the background, causing ordering enforcement to fail.

**Root Cause**

File: `src/content.js`  
Location: Sequence ID assignment at lines ~5520 and atomic counter at line
~5480  
Issue: Tab 1 and Tab 2 both creating Quick Tabs:

- **Tab 1 (T=0ms):** `globalCommandSequenceId = 1`, sends CREATE with
  sequenceId: 1
- **Tab 2 (T=5ms):** `globalCommandSequenceId = 1`, sends CREATE with
  sequenceId: 1 (collision!)
- **OR** Tab 2 increments independently: sequenceId: 2, but arrives at
  background before Tab 1's message
- **At background:** Sees sequenceId 2 before sequenceId 1, violates FIFO
  ordering

The root cause is each tab has its own `globalCommandSequenceId` counter (stored
in `src/content.js`). When multiple tabs create Quick Tabs, their sequence IDs
are not globally ordered, just locally sequential.

The ordering enforcement at background (Issue #10 in the previous report's
`_checkRestoreOrderingEnforcement()`) expects messages from ALL tabs to have
globally increasing sequence IDs, but gets per-tab sequences instead.

<scope>
**Modify:**
- `src/content.js` - Remove sequence ID generation from content script
- Let background generate sequence IDs (it sees all tabs)
- OR use message arrival order at background instead of client-generated sequence

**Do NOT Modify:**

- Ordering enforcement logic at background
- Message format (sequence ID can remain in message)
- Cross-tab synchronization mechanism </scope>

**Acceptance Criteria**

- [ ] Content script no longer generates sequence IDs for CREATE operations
- [ ] Background generates sequence IDs for all CREATE operations (globally
      ordered)
- [ ] OR: Ordering enforced by message arrival time at background, not
      client-provided sequence
- [ ] Manual test: Two tabs creating Quick Tabs simultaneously → both operations
      succeed with correct ordering
- [ ] No out-of-order sequence IDs logged at background
- [ ] Manual test: Rapid creates from 3+ tabs → all persist correctly without
      ordering conflicts

---

## Issue #33: Adoption Cache Has Unbounded TTL

**Problem:** The `recentlyAdoptedQuickTabs` Set tracks tabs for cross-tab dedup
but never expires entries, causing unbounded memory growth and potential
confusion with tabs created hours apart.

**Root Cause**

File: `src/content.js`  
Location: Adoption cache handling (mentioned in code comments around lines
5380-5420)  
Issue: The adoption cache is used to prevent duplicate dedup entries when same
Quick Tab ID created in different tabs. But the cache has no expiration:

- Tab 1 creates Quick Tab ID "qt-1-500-abc" at T=0, added to cache
- Tab 1 closes
- 2 hours later, Tab 2 coincidentally uses same ID pattern "qt-1-500-xyz"
- Cache still contains "qt-1-500-abc", confuses ownership detection

Additionally, in long-lived browser sessions with hundreds of Quick Tabs
created, the Set grows unbounded, wasting memory. Original purpose was to handle
rapid creation (de-dup within 10-100ms), but persists entire session.

<scope>
**Modify:**
- `src/content.js` - Add TTL to adoption cache entries
- Implement timestamp tracking for each cached entry
- Periodically purge entries older than 5 minutes (or measure storage latency)
- OR use WeakSet with objects that can be garbage collected

**Do NOT Modify:**

- Adoption detection logic
- Cross-tab communication
- Message format </scope>

**Acceptance Criteria**

- [ ] Adoption cache entries expire after 5 minutes
- [ ] Periodic cleanup runs every 60 seconds, removing expired entries
- [ ] Cache size logged on cleanup: "ADOPTION_CACHE_CLEANUP: 5 entries expired,
      3 remaining"
- [ ] Manual test: Create Quick Tab, wait 6 minutes, create another → no
      confusion from stale cache entry
- [ ] Memory usage in long sessions stable (not growing unbounded)

---

## Issue #34: Initialization State Not Reset on Page Navigation

**Problem:** When page navigates but content script isn't fully unloaded
(BFCache or long-lived document), initialization flags become stale and indicate
"ready" when systems may not be.

**Root Cause**

File: `src/content.js`  
Location: Navigation handler at lines ~2470 and initialization flags at lines
~3200-3220  
Issue: Multiple initialization flags exist:

- `contentScriptInitialized` (line ~3215)
- `isHydrationComplete` (line ~3220)
- `portListenersRegistered` (line ~2455)
- `isBackgroundReady` (line ~2750)

The `beforeunload` handler clears adoption cache but doesn't reset these flags:

```javascript
window.addEventListener('beforeunload', _clearAdoptionCacheOnNavigation);
// But doesn't reset: contentScriptInitialized, isHydrationComplete, etc.
```

After BFCache restore, if page is restored but service worker restarted:

- Flags still indicate `isBackgroundReady = true` from before navigation
- But background is actually different instance
- Quick Tab creation proceeds with stale state

<scope>
**Modify:**
- `src/content.js` - Reset initialization state on beforeunload
- Detect hostname change and reset flags accordingly
- Add state reset logic to match flag clearing

**Do NOT Modify:**

- Flag purpose or usage
- Navigation detection logic
- State initialization itself </scope>

**Acceptance Criteria**

- [ ] beforeunload handler resets: contentScriptInitialized,
      isHydrationComplete, isBackgroundReady
- [ ] Hostname change detected and triggers reset
- [ ] BFCache restore followed by background restart: flags properly
      reinitialized
- [ ] Manual test: Navigate away and back with page navigation → initialization
      retries (not assumes old state)
- [ ] Log shows: "STATE_RESET_ON_NAVIGATION: 4 flags reset"

---

## Issue #35: MessageRouter Initialization Not Logged

**Problem:** The background's MessageRouter initialization has minimal logging,
making it impossible to diagnose when message handlers are registered and ready.

**Root Cause**

File: `src/background/MessageRouter.js`  
Location: Initialization sequence (not fully scanned, but evidence in content
logs)  
Issue: Content script logs comprehensively:

```
[INIT][Content] INIT_PHASE_1: Content script loaded
[INIT][Content] INIT_PHASE_2: Message listener registered
[INIT][Content] INIT_PHASE_3: Tab ID obtained
```

But background likely has no corresponding logging:

```
// Background never logs:
[INIT][Background] INIT_PHASE_1: Background script loaded
[INIT][Background] INIT_PHASE_2: onConnect listener registered
[INIT][Background] INIT_PHASE_3: onMessage listener registered
[INIT][Background] INIT_PHASE_4: Handlers initialized
```

This asymmetry makes it impossible to correlate initialization timing between
content and background.

<scope>
**Modify:**
- `src/background/MessageRouter.js` - Add initialization logging
- Log when listeners are registered
- Log when each handler type is initialized
- Log storage initialization start/complete

**Do NOT Modify:**

- Handler initialization logic
- Listener registration pattern
- Storage loading sequence </scope>

**Acceptance Criteria**

- [ ] Background logs "Background script loaded" at very start
- [ ] Background logs "onConnect listener registered" before content connects
- [ ] Background logs "onMessage listener registered" with handler count
- [ ] Background logs "Handler group X initialized: [list of handlers]"
- [ ] Background logs storage initialization start and complete with duration
- [ ] Manual test: Enable console, observe background logs matching content log
      timeline
- [ ] Logs include component names and timestamps for correlation

---

## Issue #36: Asymmetrical Readiness Validation Between Content and Background

**Problem:** Content script checks multiple conditions before considering
background ready, but background doesn't validate content readiness
symmetrically, creating one-way dependencies that mask failures.

**Root Cause**

File: `src/content.js` (lines ~2750-2800) vs expected background patterns  
Location: Handshake and readiness validation  
Issue: Content validates:

```javascript
// Content checks:
if (!backgroundPort) return;
if (portConnectionState !== PORT_CONNECTION_STATE.CONNECTED) return;
if (!isBackgroundReady) return;
```

But background only validates:

```javascript
// Background likely checks only:
if (!sender) return; // minimal context check
```

The asymmetry means content can wait for background to be ready, but background
has no way to know if content is ready. If background sends messages during
content initialization, they're buffered silently. If content sends during
background initialization, content retries aggressively.

This creates a hidden assumption: background must always wait for content, never
vice versa.

<scope>
**Modify:**
- Background message handlers need equivalent readiness checks
- Implement bidirectional readiness validation
- Ensure neither side makes assumptions about the other's state

**Do NOT Modify:**

- Content readiness checks
- Handshake protocol
- Message format </scope>

**Acceptance Criteria**

- [ ] Background handlers check port state before responding (symmetric to
      content's checks)
- [ ] Both content and background log readiness state with same detail level
- [ ] Manual test: Background receives message while initializing → logs
      "NOT_READY, queuing" (not silently handling)
- [ ] Readiness checks use same timeout/retry logic on both sides
- [ ] No silent failures where one side assumes other is ready

---

## Issue #37: Iframe Guard Assumes DOM Is Fully Constructed

**Problem:** The iframe recursion guard checks parent elements to detect Quick
Tab iframes, but runs at script load time before DOM might be fully constructed,
causing false negatives.

**Root Cause**

File: `src/content.js`  
Location: Iframe guard at lines ~1-100  
Issue: The guard runs immediately on script load:

```javascript
const _shouldSkipInitialization = _checkShouldSkipInitialization();
```

And checks parent structure:

```javascript
function _hasQuickTabParentStructure(parentFrame) {
  try {
    const parent = parentFrame.parentElement;  // DOM might not be ready
    if (!parent) return false;
    // Check for Quick Tab indicators...
  }
}
```

If the script runs before DOM is fully attached, `parentFrame.parentElement`
could be null even if parent exists in final DOM. This could cause the guard to
fail to detect a Quick Tab iframe and allow content script to run inside it,
causing the recursion bug it's meant to prevent.

<scope>
**Modify:**
- `src/content.js` - Ensure DOM is ready before iframe guard runs
- OR defer guard execution until after DOMContentLoaded
- Add explicit DOM readiness check before parentElement access

**Do NOT Modify:**

- Iframe detection logic
- Guard pattern (immediate execution is still needed for safety) </scope>

**Acceptance Criteria**

- [ ] Iframe guard explicitly checks `document.readyState` or waits for
      readiness
- [ ] If DOM not ready, guard still prevents execution (fail-safe)
- [ ] Manual test: Script loads in Quick Tab iframe → guard prevents execution
      (not silent failures due to DOM timing)
- [ ] All parent element checks handle null returns gracefully

---

## Issue #38: Keyboard Shortcuts Processed During Initialization Window

**Problem:** Keyboard shortcut handlers are registered during content script
initialization, before QuickTabsManager might be ready, allowing user actions to
trigger operations on uninitialized system.

**Root Cause**

File: `src/content.js`  
Location: Initialization sequence around lines ~5000-5200  
Issue: The execution order is:

1. Line ~5000: `setupKeyboardShortcuts()` called early
2. Line ~5050: Port connection initiated (async)
3. Line ~5150: `initQuickTabsFeature()` awaited
4. Line ~5200: `quickTabsManager` initialized

If user presses keyboard shortcut between step 1 and step 4 (potentially 100+
milliseconds), the handler executes:

```javascript
async function handleCreateQuickTab(url, targetElement) {
  const quickTabId = _generateAtomicQuickTabId();  // But manager not initialized yet
  const quickTabData = buildQuickTabData({ ... });
  await _queueQuickTabCreation(quickTabData, saveId, canUseManagerSaveId);
}
```

The handler attempts to create Quick Tab before `quickTabsManager` is available.
The operation gets queued, then processed, potentially creating tabs before
manager is fully initialized.

<scope>
**Modify:**
- `src/content.js` - Defer keyboard shortcut registration until after QuickTabsManager initialization
- OR add guard: if quickTabsManager not ready, buffer shortcuts instead of failing
- Register shortcuts AFTER all managers initialized

**Do NOT Modify:**

- Shortcut handler logic
- Manager initialization
- Event listener patterns </scope>

**Acceptance Criteria**

- [ ] Keyboard shortcuts registered after QuickTabsManager initialized
- [ ] Manual test: Open page, immediately press Quick Tab shortcut → either
      queued safely OR shows "not ready" message (not crashes/fails silently)
- [ ] Log shows keyboard handler registered AFTER manager init (not before)
- [ ] No race conditions where shortcut runs during manager setup

---

## Issue #39: Broadcast Handlers Assume Idempotency

**Problem:** When background broadcasts messages to all tabs (e.g.,
QUICK_TABS_CLEARED), content script handlers are called without idempotency
guarantees, risking duplicate operations.

**Root Cause**

File: `src/content.js`  
Location: Broadcast handling around lines ~3060-3100  
Issue: The code broadcasts to ALL tabs:

```javascript
// Background sends to all tabs:
browser.tabs.query({}).then(tabs => {
  tabs.forEach(tab => {
    browser.tabs.sendMessage(tab.id, { action: 'QUICK_TABS_CLEARED' });
  });
});

// Each content script receives and processes:
function _handleQuickTabsCleared(sendResponse) {
  // Clears all Quick Tabs
  for (const id of tabIds) {
    _destroyTabWindow(quickTabsManager.tabs, id);
  }
}
```

If a tab receives the broadcast twice (network retry, accidental double-send),
`_handleQuickTabsCleared()` gets called twice. Current implementation is
idempotent (clearing an empty manager is safe), but future handlers might not
be. Without explicit idempotency, this pattern is fragile.

<scope>
**Modify:**
- `src/content.js` - Add idempotency tracking to broadcast handlers
- Include messageId in broadcasts for deduplication
- Track received message IDs and skip if already processed

**Do NOT Modify:**

- Handler logic itself
- Broadcast mechanism
- Tab query pattern </scope>

**Acceptance Criteria**

- [ ] Broadcasts include unique messageId for deduplication
- [ ] Content script tracks received messageIds and skips duplicates
- [ ] Log shows: "BROADCAST_DEDUPED: Already processed messageId-X"
- [ ] Manual test: Simulate duplicate broadcast → handler runs once, not twice
- [ ] Documentation: "All broadcast handlers must be idempotent"

---

## Issue #40: No Sender Tab ID Validation in Message Handlers

**Problem:** Messages received from background don't validate they're intended
for current tab, potentially causing handlers to execute operations for the
wrong tab in cross-tab broadcasts.

**Root Cause**

File: `src/content.js`  
Location: Broadcast handling around lines ~3050-3100  
Issue: Handler receives message and processes immediately:

```javascript
function handleContentBroadcast(message) {
  const { action } = message;
  switch (action) {
    case 'VISIBILITY_CHANGE':
      // Processes for ANY tab, no check if message intended for this tab
      // If background broadcasts to all tabs, all process
      break;
  }
}
```

Better approach would be:

```javascript
function handleContentBroadcast(message) {
  // Validate this message is intended for current tab
  if (message.targetTabId && message.targetTabId !== cachedTabId) {
    return; // Not for us
  }
  // Process
}
```

Currently broadcasts are processed by all receiving tabs, relying on downstream
handlers to filter. This is inefficient (all tabs parse all messages) and
fragile (easy to forget filtering in new handlers).

<scope>
**Modify:**
- `src/content.js` - Add sender tab ID validation before handler processing
- Check targetTabId field before processing broadcast
- Early return if message not intended for current tab

**Do NOT Modify:**

- Handler logic itself
- Broadcast mechanism
- Message format (targetTabId already in format) </scope>

**Acceptance Criteria**

- [ ] handleContentBroadcast checks targetTabId before processing
- [ ] Messages not intended for current tab logged: "BROADCAST_IGNORED:
      targetTabId X != currentTabId Y"
- [ ] Manual test: Multi-tab broadcast → each tab processes only messages for
      itself
- [ ] Performance: Fewer parsed messages (not all tabs parse all messages)
- [ ] Clear pattern for new handlers: "Always check targetTabId first"

---

## Shared Context: Message Queue & Initialization Architecture

All 15 issues stem from the content script managing **multiple concurrent
initialization phases** (tab ID acquisition, port connection, handshake,
hydration, feature initialization) with **multiple message queues** (init,
hydration, commands, port) and **multiple state flags** (4+ independent flags).
The architecture lacks:

- **Unified state machine:** Uses 4 separate flags instead of single state
  machine
- **Queue coordination:** Treats queues independently, not as unified messaging
  system
- **Timeout consistency:** Different components use different timeout patterns
- **Logging uniformity:** Content logs comprehensively, background silent
- **Idempotency guarantees:** Assumes handlers won't be called twice
- **Cross-context coordination:** Content and background don't validate
  symmetrical readiness

The proper solution requires treating these as a **single initialization
choreography** where all components (content, background, port, queues, state)
are synchronized, logged uniformly, and guaranteed to be idempotent.

---

## Implementation Dependencies

- **Issues #26-27:** Must fix together (queue coordination + hydration race)
- **Issues #28, #31:** Must fix before #32 (ID/sequence issues affect message
  correlation)
- **Issues #30, #32:** Can fix independently (timeout tuning)
- **Issues #34, #36, #37:** Should fix together (state reset across multiple
  flags)
- **Issue #35:** Can fix independently (logging only, no behavior change)
- **Issues #38, #39, #40:** Can fix independently (safeguards)
- **Issue #33:** Can fix independently (cache TTL)

Recommended fix order:

1. **Issues #26-27** (queue system stability)
2. **Issues #28, #31** (message ID/sequence integrity)
3. **Issues #34, #36** (state coherence)
4. **Issue #35** (visibility)
5. **Issues #30, #32** (timeout consistency)
6. **Issues #37, #38, #39, #40** (safeguards)
7. **Issue #33** (memory management)

---

**Priority:** Critical (#26-28), High (#29-32), Medium (#33-40) |
**Dependencies:** Queue system must be fixed before hydration race |
**Complexity:** Medium (most issues are localized) | **Estimated Token Cost:**
~1000 tokens total for all 15 fixes
