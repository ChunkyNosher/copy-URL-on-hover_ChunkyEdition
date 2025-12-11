# Quick Tabs Manager: Secondary Issues, Port Communication Failures, and Firefox Lifecycle Problems

**Extension Version:** v1.6.4.13 | **Date:** 2025-12-10 | **Scope:** Additional
critical issues affecting port reconnection, heartbeat timing, Firefox
background termination, and VisibilityHandler broadcast integration

---

## Executive Summary

Beyond the primary messaging tier failures (Issues #1-8 from prior report), the
extension suffers from seven additional critical issues affecting port
connection lifecycle, heartbeat timing reliability, Firefox background script
termination handling, and VisibilityHandler state operation isolation. These
compound the original issues by introducing race conditions in port
reconnection, cascading heartbeat failures into premature zombie detection,
insufficient error recovery after Firefox background termination, and state
operation events that never propagate to content scripts. Additionally, storage
polling debounce timing is misconfigured based on false assumptions about Tier 1
functionality. These issues create a cascade failure pattern where a single
transient glitch can degrade the system from attempting recovery to falling back
to slow polling permanently.

---

## Issues Overview (Supplementary to Prior Report)

| Issue | Component                      | Severity | Root Cause                                                                          |
| ----- | ------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| #9    | Port message listeners         | Critical | Silent drops if Manager listener registration delayed during reconnection           |
| #10   | Port connection lifecycle      | High     | Race condition between port null-check and connection attempt                       |
| #11   | VisibilityHandler operations   | Critical | Minimize/restore operations never emit broadcasts to content scripts                |
| #12   | Storage polling debounce       | Medium   | 500ms debounce based on false assumption Tier 1 is functional                       |
| #13   | Heartbeat failure handling     | High     | Single timeout triggers zombie state instead of requiring multiple failures         |
| #14   | Firefox background termination | Critical | Manager unaware of 30-second background termination, cascades to cascading failures |
| #15   | Event bus scope                | Medium   | Internal eventBus messages don't cross context boundaries to background             |

---

## Issue #9: Silent Port Message Drops on Reconnection

### Problem

When Manager reconnects to background after a disconnect, state update messages
sent by background via port can arrive after disconnect but before listener is
re-registered on new port. These messages are silently lost with no error, no
retry queue, and no notification that they were dropped.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** connectToBackground() function and port lifecycle management  
**Issue:** Port listeners are added immediately after creating port via
`backgroundPort.onMessage.addListener()`, but there is a race window between
when old port is set to null and when new port's listeners are attached. If
background sends a STATE_UPDATE message after old port disconnect but before new
listener registration completes, the message is silently dropped by the port
routing system. No queue, no retry, no log.

### Fix Required

Implement port message queue that buffers any messages arriving before listener
is fully registered. After attaching listener, flush the queue. Additionally,
add comprehensive logging for every port.onMessage listener attachment and every
port message reception to make the race condition visible during debugging.

---

## Issue #10: Race Condition in Port Reconnection

### Problem

Multiple simultaneous port connection attempts can occur if heartbeat fails and
immediately calls scheduleReconnect() while a previous reconnection attempt is
already in progress. This creates resource leaks and duplicate connections.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** connectToBackground() function and scheduleReconnect()
sequencing  
**Issue:** Between checking `if (!backgroundPort)` and executing
`browser.runtime.connect()`, state can change. If two reconnection attempts are
scheduled concurrently (one from heartbeat timeout, one from user interaction),
both see backgroundPort as null and both attempt to create connections. Port
creation is not atomic; there is no mutex protecting it.

### Fix Required

Add atomic guard using a flag (e.g., `isReconnecting`) that blocks new
connection attempts while one is already in progress. This flag should be set
before calling connect() and cleared only after listener registration completes
or error is handled. Implement with try/finally to guarantee cleanup even on
exceptions.

---

## Issue #11: VisibilityHandler State Operations Don't Emit Broadcasts

### Problem

When a Quick Tab is minimized or restored via VisibilityHandler, the operation
updates internal state and persists to storage, but never notifies content
scripts via BroadcastChannel. This breaks integration between sidebar operations
and content scripts, preventing content scripts from showing minimized state
indicators or responding to visibility changes.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** handleMinimize() and handleRestore() methods, approximately lines
600-1200  
**Issue:** VisibilityHandler imports from storage utilities and
BroadcastChannelManager is NOT imported. Code calls
`this.eventBus.emit('state:updated', ...)` which notifies internal sidebar
listeners, but eventBus is module-scoped and does not cross context boundaries.
No calls to broadcastQuickTabMinimized() or broadcastQuickTabRestored() exist
anywhere in the file. State changes are completely invisible to content scripts
listening on BroadcastChannel.

### Fix Required

Import BroadcastChannelManager functions into VisibilityHandler and call
appropriate broadcast functions after state operations complete. Each
handleMinimize() call should emit broadcast, each handleRestore() call should
emit broadcast. This completes the data flow from sidebar operations to content
script presentation layer.

---

## Issue #12: Storage Polling Debounce Misconfigured for Failing Tiers

### Problem

Storage polling debounce interval is set to 500ms with comment stating "Since
BroadcastChannel is now PRIMARY for instant updates, storage polling is BACKUP"
and debounce was increased from 50ms. However, BroadcastChannel is
non-functional (Issue #1-2), so polling is actually PRIMARY but has SLOWER
debounce, degrading sync performance further.

### Root Cause

**File:** `sidebar/utils/storage-handlers.js`  
**Location:** STORAGE_READ_DEBOUNCE_MS constant (line ~18)  
**Issue:** Debounce value was increased based on assumption that Tier 1
messaging works correctly. This assumption is false - BroadcastChannel posts
don't happen from background. Decision to increase debounce made before
discovering Tier 1 failure. Code comment indicates intent was safety
optimization when primary channels work, not performance when they fail.

### Fix Required

Debounce timing should be context-dependent: when BroadcastChannel and Port are
working (determined by successful receipt of messages), debounce can be 500ms+.
But during fallback mode (when Tier 1-2 have failed), debounce should be reduced
to 100-200ms to compensate for slower sync mechanism. Add runtime detection of
which tier is actively providing updates and adjust debounce accordingly.

---

## Issue #13: Single Heartbeat Timeout Triggers Zombie State Too Aggressively

### Problem

A single heartbeat timeout immediately transitions Manager to ZOMBIE state and
activates BroadcastChannel fallback. But if the timeout was caused by transient
network delay and background responds to next heartbeat, Manager is now in
fallback mode even though connection recovered. Additionally, if both Tier 1 and
Tier 2 are failing (Issue #1 + this), fallback provides no benefit.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** \_handleHeartbeatFailure() function and CONNECTION_STATE
transitions  
**Issue:** Logic is: first timeout = ZOMBIE state immediately. Should be: first
timeout = warning, increment counter, second timeout = ZOMBIE. Current code
requires only one failure to declare background dead, but single-packet loss or
temporary blocking should not cause state machine transition. Context: Firefox
idle termination happens at 30s, but transient delays could be shorter.

### Fix Required

Implement hysteresis in heartbeat failure detection: require minimum 2-3
consecutive heartbeat failures (across ~50-100ms window) before transitioning to
ZOMBIE. This filters out transient glitches while still detecting real
connection loss. Add logging to show failure count each heartbeat so developers
can distinguish transient from real failures.

---

## Issue #14: Firefox 30-Second Background Script Termination Creates Cascade

### Problem

Firefox terminates WebExtension background scripts after 30 seconds of
inactivity (no events received). When this happens, Manager has no active
heartbeat check running (heartbeat only starts when port connects successfully).
Manager doesn't know background is dead. Storage polling is running but has
500ms debounce, so Manager won't detect the termination for up to 500ms + next
polling cycle. By then, 30+ seconds have passed and background is gone. When
Manager finally polls, data is stale. User is now operating on outdated state
until next operation triggers a sync.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` and Firefox WebExtensions
architecture  
**Location:** Heartbeat mechanism and port lifecycle  
**Issue:** Heartbeat is triggered by port connection, but if Manager sidebar is
not visible/active, no events are generated and heartbeat can lapse. When
heartbeat stops, background becomes idle candidate. Firefox terminates it.
Manager has no trigger to check if background is alive. Storage polling alone is
insufficient because it's debounced and not proactive. The 30-second Firefox
termination window is shorter than the typical polling cycle + debounce delays.

### Fix Required

Implement background activity detector: if no port messages received for 10
seconds, assume background may be terminating soon and proactively ping it via a
lightweight health check (not full heartbeat). This resets Firefox's 30-second
idle timer before it reaches the termination threshold. Additionally, Manager
should maintain a "last-known-background-state" timestamp and warn if it exceeds
30 seconds without update. This creates an explicit alert that background may
have terminated.

---

## Issue #15: Event Bus Messages Don't Cross Context Boundaries

### Problem

VisibilityHandler emits "state:updated" events to eventBus after
minimize/restore operations. These events are received by internal sidebar
components (UI coordinators, listeners). But eventBus is module-scoped and never
broadcasts these events to background script or content scripts. State changes
in sidebar are invisible to other contexts.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** this.eventBus.emit() calls throughout file  
**Issue:** eventBus is an EventEmitter instance passed into VisibilityHandler
constructor. It's scoped to sidebar context. Emitting events on it notifies only
listeners in same JavaScript context (same sidebar frame/module). Content
scripts listening on BroadcastChannel, background script listening on port
messages - neither of these receive eventBus emissions because they're in
different contexts. eventBus is used for internal coordination but doesn't map
to cross-context channels.

### Fix Required

After emitting internal eventBus events (for sidebar coordination), also emit
corresponding broadcast or port messages for cross-context visibility. Pattern:
eventBus emit happens first (immediate local update), then setTimeout(() =>
broadcast(), 0) to ensure local listeners process first. This separates internal
coordination from external notification without blocking either.

---

## Shared Context and Cascading Failure Analysis

### The Cascade Failure Pattern

These seven issues create a specific failure cascade:

1. User opens sidebar, Manager starts (Issue #14 starts: heartbeat starts,
   background idle timer starts)
2. Sidebar hidden by user → heartbeat stops → Firefox idle timer progresses
   toward 30s
3. At 20s: Firefox terminates background script silently
4. At 25s: Manager makes first storage.onChanged check (500ms debounce + check
   timing)
5. At 30s+: Manager finally sees storage is stale, tries to reconnect port
6. First heartbeat fails → immediately enters ZOMBIE state (Issue #13) instead
   of retrying
7. Now using BroadcastChannel fallback, but broadcasts don't happen (Issue
   #1-2), AND BroadcastChannel messages can race (Issue #9)
8. VisibilityHandler operations from this point don't broadcast (Issue #11), so
   content scripts see no updates
9. Sidebar operations complete but content scripts never see state changes

### Why These Issues Compound

- Issue #9 makes Tier 2 lossy during reconnection (race condition)
- Issue #10 creates resource leak during reconnection (duplicate ports)
- Issue #11 makes Tier 1 incomplete for sidebar-initiated changes
- Issue #12 makes fallback slower than it should be
- Issue #13 makes recovery premature and pessimistic
- Issue #14 makes background termination undetectable until too late
- Issue #15 means internal coordination never becomes external visibility

Result: System degrades from instant feedback (if Tiers 1-2 worked) to 30+
second round-trip cycles (polling after background dies).

---

## Supporting Context

<details>
<summary>Evidence: Firefox Background Script Termination (Issue #14)</summary>

Firefox bugzilla report #1851373 explicitly documents background script
termination:

- Background scripts are idle candidates if no events received
- Idle background scripts are terminated after 30 seconds
- Termination is silent - no notification to sidebar or content scripts
- Sidebar must actively detect termination via connection loss

Implementation pattern: Keep-alive connections (like persistent port) prevent
termination by keeping background "busy". But if sidebar is hidden, no events
flow to background, and port connection alone doesn't prevent idle termination.
Heartbeat mechanism was designed to solve this, but if heartbeat isn't running
(sidebar hidden), it provides no protection.

The extension's heartbeat implementation is correct in principle but incomplete
in execution - it only runs when port is connected, so if port is already lost
due to background termination, heartbeat can't recover it.

</details>

<details>
<summary>Evidence: Port Message Loss (Issue #9)</summary>

WebExtensions runtime.Port API does not guarantee message delivery if listener
is not attached at time of sending. Messages are queued at sender side
(background) but dequeued and dropped if no receiver handler exists.

From runtime.Port documentation: "If no listener is attached to the receiving
end, messages are silently dropped."

This means:

1. Background sends STATE_UPDATE via port.postMessage()
2. Manager's port connection hasn't finished registering listener yet
3. Port driver has no registered handler
4. Message is dropped
5. No error event, no exception, no queue for replay

This is by design in WebExtensions - messages are fire-and-forget unless
explicit ACK protocol is implemented.

</details>

<details>
<summary>Evidence: VisibilityHandler Broadcast Absence (Issue #11)</summary>

VisibilityHandler.js file structure:

- Line 1-50: Imports (missing BroadcastChannelManager imports)
- Line 100-150: Constructor and initialization
- Line 300-600: handleMinimize() - calls minimizedManager.add(),
  tabWindow.minimize(), eventBus.emit()
- Line 650-900: handleRestore() - calls minimizedManager.restore(),
  tabWindow.restore(), eventBus.emit()
- Line 1100+: handleFocus() - calls updateZIndex(), eventBus.emit()

No imports of any broadcast functions. No calls to broadcastQuickTabMinimized,
broadcastQuickTabRestored anywhere.

Content scripts import and use BroadcastChannelManager functions (verified in
search). VisibilityHandler does not.

The gap is structural - broadcast functions exist but are not wired into the
handler that performs the operations.

</details>

<details>
<summary>Evidence: Debounce Timing Configuration (Issue #12)</summary>

File: sidebar/utils/storage-handlers.js

- Line ~18: `const STORAGE_READ_DEBOUNCE_MS = 500;`
- Comment above: "v1.6.3.7-v4 - FIX Issue #7: Increased from 50ms to 500ms"
- Comment reason: "Since BroadcastChannel is now PRIMARY for instant updates,
  storage polling is BACKUP"
- Followed by: "Higher debounce prevents rapid storage reads during burst
  operations"

The comment indicates debounce increase was optimization for when Tier 1 is
working. But current codebase shows Tier 1 is not working (background doesn't
post to BroadcastChannel). The optimization was premature - applied before Tier
1 was verified functional.

</details>

<details>
<summary>Evidence: Heartbeat Zombie Transition (Issue #13)</summary>

File: sidebar/quick-tabs-manager.js

- Function: \_handleHeartbeatFailure()
- Line ~700:
  `if (isTimeout && connectionState === CONNECTION_STATE.CONNECTED) { _transitionConnectionState(CONNECTION_STATE.ZOMBIE, 'heartbeat-timeout-zombie'); }`

Comment says: "v1.6.3.7-v5 - FIX Issue #1: IMMEDIATELY detect zombie state on
first timeout"

This shows explicit intent: first timeout = zombie. But the comment indicates
this was a "fix" implying the previous behavior was to wait for multiple
failures. Current behavior is aggressive - single glitch becomes permanent state
change.

</details>

---

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (port message queue for Issue #9, atomic reconnection guard for Issue #10, heartbeat hysteresis for Issue #13, background activity detector for Issue #14)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (add broadcast emissions after state operations for Issue #11, add cross-context event forwarding for Issue #15)
- `sidebar/utils/storage-handlers.js` (implement dynamic debounce based on active tier for Issue #12)

**Do NOT Modify:**

- `manifest.json` (out of scope)
- `src/features/quick-tabs/storage/` (storage persistence logic is correct)
- `tests/` (test infrastructure)
- `background.js` - Handle this in separate fix cycle after primary messaging
  issues (#1-8) are resolved </scope>

---

<acceptance_criteria> **Issue #9 - Port Message Queue:**

- [ ] Port message queue implemented for buffering pre-listener-registration
      messages
- [ ] Queue flushed after listener attached
- [ ] Every message reception logged: [PORT] [MESSAGE_RECEIVED]: {type, source,
      timestamp}
- [ ] Every listener registration logged: [PORT] [LISTENER_REGISTERED]:
      {timestamp}

**Issue #10 - Atomic Port Reconnection:**

- [ ] isReconnecting flag prevents concurrent connection attempts
- [ ] Flag set before connect(), cleared after listener attached or error
- [ ] Concurrent attempt blocked with log: [PORT] [RECONNECT_BLOCKED]: {reason:
      already_in_progress}
- [ ] try/finally ensures flag is always cleared

**Issue #11 - VisibilityHandler Broadcasts:**

- [ ] Import BroadcastChannelManager in VisibilityHandler
- [ ] handleMinimize() calls broadcastQuickTabMinimized() after state update
- [ ] handleRestore() calls broadcastQuickTabRestored() after state update
- [ ] Broadcast includes complete tab data (id, url, position, size, container)
- [ ] Log shows: [VISIBILITY] [BROADCAST_SENT]: {operation, tabId, timestamp}

**Issue #12 - Dynamic Debounce:**

- [ ] Detect active messaging tier (check if BroadcastChannel messages arriving)
- [ ] Tier 1 active (BroadcastChannel): debounce = 500ms
- [ ] Tier 1 inactive (fallback): debounce = 200ms
- [ ] Log shows tier status and current debounce: [POLLING] [TIER_STATUS]:
      {activeTier, debounceMs}

**Issue #13 - Heartbeat Hysteresis:**

- [ ] Heartbeat failure requires 2-3 consecutive failures before ZOMBIE
      transition
- [ ] Each failure increments counter, logged: [HEARTBEAT] [FAILURE]: {count,
      maxBeforeZombie}
- [ ] After 3 failures (or N failures), transition to ZOMBIE
- [ ] Successful heartbeat resets counter to 0

**Issue #14 - Firefox Background Termination Detection:**

- [ ] Implement health check ping if heartbeat not received in 10 seconds
- [ ] Ping logged: [HEALTH_CHECK] [PING_SENT]: {timestamp}
- [ ] If background not responding within 10s window, log: [HEALTH_CHECK]
      [BACKGROUND_UNRESPONSIVE]
- [ ] Warn user if last background update >30 seconds old: [WARNING]
      [BACKGROUND_POSSIBLY_DEAD]

**Issue #15 - Cross-Context Event Forwarding:**

- [ ] After eventBus emit, schedule broadcast via setTimeout (ensure local
      processing first)
- [ ] Pattern: eventBus.emit() → setTimeout(() => broadcast(), 0)
- [ ] Log shows both emissions: [EVENT] [INTERNAL_EMIT] then [EVENT]
      [BROADCAST_SCHEDULED]
- [ ] No deadlock or duplicate processing between internal and cross-context
      events

**All Issues:**

- [ ] All existing tests pass
- [ ] No new console errors or warnings
- [ ] Manual test: Minimize → content script detects state change within 100ms
- [ ] Manual test: Hide sidebar for 35+ seconds → background termination
      detected within 10s
- [ ] Manual test: Rapid reconnections don't create duplicate ports
- [ ] No resource leaks (ports, listeners, timers properly cleaned up)
      </acceptance_criteria>

---

**Priority:** Critical (Issue #9, #11, #14), High (Issue #10, #13), Medium
(Issue #12, #15) | **Dependencies:** Should follow fix of Issues #1-8 but can be
addressed in parallel for port lifecycle issues | **Complexity:** Medium-High
(requires careful state machine work and cross-context coordination)
