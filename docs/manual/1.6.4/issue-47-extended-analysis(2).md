# Quick Tabs: Additional Issues & Missing Logging in Manager UI

**Extension Version:** v1.6.3.1 → v1.6.4.x | **Date:** 2025-12-26 | **Scope:**
Manager UI state synchronization, port lifecycle, and event handling logging
gaps

---

## Executive Summary

Beyond the critical container ID mismatch issues documented in
issue-47-revised.md, the Manager UI implementation has additional structural
problems that prevent proper Quick Tab rendering and state synchronization. The
Manager relies on port-based communication and storage events to stay in sync,
but critical logging is missing across the entire lifecycle. Additionally,
Firefox MV2 API constraints create architectural mismatches that current code
patterns do not fully account for. This report documents issues that became
apparent during comprehensive codebase analysis.

---

## Issues Overview

| Issue | Component                | Severity | Root Cause                                     |
| ----- | ------------------------ | -------- | ---------------------------------------------- |
| #11   | Port Message Ordering    | High     | TCP ordering assumption without async handling |
| #12   | Port Disconnect Logging  | Medium   | Missing lifecycle entry/exit logs              |
| #13   | Storage Listener Missing | Critical | No onChanged listener fallback                 |
| #14   | Hash Computation Timing  | High     | Hash computed at debounce, not render          |
| #15   | MV2 API Mismatch         | Critical | storage.session referenced but unavailable     |
| #16   | Port Handler Logging     | Medium   | No entry/exit logs in dispatcher               |
| #17   | Ack Tracking             | High     | Incomplete correlation logging                 |
| #18   | Render Debounce Mismatch | High     | 100ms vs 200ms vs 300ms timing conflict        |
| #19   | Host Info Memory Leak    | Medium   | No cleanup despite MAX_ENTRIES constant        |
| #20   | Hash Collision Risk      | Medium   | Expensive 64-bit hash during debounce          |

---

## Issue #11: Port Message Handler Order Guarantees

### Problem

The Manager UI relies on receiving port messages in a specific order:
SIDEBAR_READY response first, then STATE_CHANGED broadcasts. However,
browser.runtime.connect() does not guarantee in-order delivery for async message
handlers.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 1000-1100)

**Location:** `initializeQuickTabsPort()` and `handleQuickTabsPortMessage()`

**Issue:** Code assumes TCP-level ordering prevents message reordering, but
async handlers can execute out of sequence. If a STATE_CHANGED message arrives
before SIDEBAR_READY completes processing, Manager may render incomplete state.

### Why This Matters

- Port messages can arrive out of order if handlers are async
- Manager may render state before hydration completes
- Race condition between port initialization and first broadcast

### Fix Required

Add monotonically increasing sequence numbers to port messages. Implement
handshake validation where SIDEBAR_READY must be acknowledged before processing
STATE_CHANGED events.

---

## Issue #12: Missing Port.onDisconnect Handler Entry Logging

### Problem

When the Manager's port disconnects from background, only a single warning is
logged. The recovery flow (cleanup, reconnect scheduling) lacks detailed
lifecycle logging.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 580-620)

**Location:** `quickTabsPort.onDisconnect.addListener()` handler

**Issue:** Handler logs a warning but provides no visibility into:

- Port state before disconnect
- Whether heartbeat stopped successfully
- Reconnect scheduling confirmation
- Distinction between background unload vs. network failure

### Fix Required

Add comprehensive logging throughout onDisconnect handler matching
connectToBackground() pattern. Log entry state, cleanup confirmation, and
reconnect scheduling details.

---

## Issue #13: Storage.onChanged Listener Never Registered

### Problem

The Manager has NO `browser.storage.onChanged.addListener()` for quick tabs
state. Without this fallback, Manager only receives updates via port messages.
If the port disconnects or background fails to send broadcasts, Manager becomes
permanently stale.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 150-250)

**Location:** Initialization code

**Issue:** Code initializes `quickTabsPort` with message listeners but never
implements storage.onChanged registration. v1.6.4.18 comments claim session
storage, but Firefox MV2 has no `browser.storage.session` API.

### Why This Matters

This is a critical single point of failure. If port disconnects, Manager UI has
no mechanism to discover state updates. No resilience or fallback exists.

### Fix Required

Implement hybrid state sync:

1. Keep port messages as primary (real-time)
2. Add `browser.storage.onChanged` listener as fallback for port failures
3. Use both listeners together for resilience

---

## Issue #14: State Hash Computed During Debounce Window

### Problem

Manager computes state hash when scheduleRender() is called (100ms into
debounce), not when rendering actually occurs. This creates a staleness window
where hash becomes outdated.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 2400-2450)

**Location:** `scheduleRender()` function and debounce implementation

**Issue:** State can change during the 100-300ms debounce window, but hash
comparison uses the outdated captured hash. Multiple renders may fire for single
logical state change.

### Why This Matters

- Double renders during rapid updates
- Manager position badge shows intermediate values
- Hash collision detection fails during debounce window

### Fix Required

Capture state hash immediately before rendering (in renderUI()), not at debounce
scheduling. Implement debounce-final-state pattern that recomputes hash from
current state when debounce fires.

---

## Issue #15: MV2 API Incompatibility on Storage.session

### Problem

File header claims Quick Tabs switched to storage.session (line 18-25). However,
Firefox Manifest V2 does NOT have `browser.storage.session` API. This
architectural assumption is fundamentally broken.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 18-25)

**Location:** File header comment and storage initialization

**Issue:** Comment states switching to session storage, but code never calls
storage.session APIs. Implementation uses port-based sync instead. If code ever
tries to use storage.session, it fails silently because API doesn't exist.

### Why This Matters

Critical incompatibility creates confusion about storage strategy. If fallback
code later attempts storage.session calls, extension breaks without clear error
message.

### Fix Required

Explicitly resolve storage strategy:

- **Option A:** Use port-based sync only (remove storage.session references, add
  storage.onChanged listener)
- **Option B:** Use storage.local as persistent store (update comments, ensure
  storage.onChanged registered)

Document chosen approach clearly in code comments.

---

## Issue #16: Missing Port Message Handler Logging

### Problem

Port message dispatcher has minimal logging. Handler lookup table processes
messages silently without entry/exit logs.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 555-600)

**Location:** `handleQuickTabsPortMessage()` and `_portMessageHandlers` lookup
table

**Issue:** Only logs message type, no logging for:

- Handler execution entry/exit
- State data received in message
- Unknown message types
- State transition after update

### Fix Required

Add comprehensive logging to handler execution:

1. Entry log showing message type and payload size
2. Handler-specific logs for each message type
3. State transition logs when state updates
4. Exit logs showing success/skip/error outcome

---

## Issue #17: Incomplete Port Message Correlation Tracking

### Problem

Manager tracks pending acknowledgments with correlation IDs but never logs when
acknowledgments are resolved successfully. Only timeout failures are logged.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 39-45, 750-800)

**Location:** `pendingAcks` map and `handleAcknowledgment()` function

**Issue:**

- Map populated with pending operations
- Failures logged with timeouts
- Successful resolution has minimal logging
- No roundtrip time tracking
- No visibility into pending acks queue

### Fix Required

Add comprehensive ack tracking:

1. Log entry in handleAcknowledgment() showing correlationId and type
2. Calculate and log roundtrip times
3. Warn if more than 2 acks pending
4. Distinguish timeout reasons (port dead vs. slow response)

---

## Issue #18: Render Debounce Mismatch Between Components

### Problem

UpdateHandler persists drag/resize with 200ms debounce (during drag) and 300ms
debounce (at end). Manager renders at 100ms. This timing mismatch causes double
renders and intermediate visual states.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js` (line 24)

**Location:** `_debouncedDragPersist()` (200ms) vs `_persistToStorage()` (300ms)

**File:** `sidebar/quick-tabs-manager.js` (line 72)

**Location:** `RENDER_DEBOUNCE_MS = 100`

**Issue:**

- UpdateHandler drag updates debounce at 200ms
- Final storage persist debounces at 300ms
- Manager renders at 100ms
- Timeline: Manager renders intermediate position → UpdateHandler persists final
  → Manager renders again

### Why This Matters

- Performance: Extra render cycle per drag
- Visual flicker: Manager shows intermediate positions
- Inconsistent: Desktop drag smooth, Manager jumpy

### Fix Required

Align debounce windows. Either:

- Increase Manager render debounce to 250ms
- Decrease UpdateHandler drag persist to 100ms
- Skip intermediate renders from position-changing events

---

## Issue #19: Host Info Map Memory Leak

### Problem

The `quickTabHostInfo` map grows unbounded. While `HOST_INFO_MAX_ENTRIES`
constant is defined, no cleanup code exists to enforce the limit.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 85-86)

**Location:** `const quickTabHostInfo = new Map();` initialization

**Issue:**

- Constant `HOST_INFO_MAX_ENTRIES = 500` defined (line 65)
- Constant `HOST_INFO_MAINTENANCE_INTERVAL_MS` defined (line 66)
- But NO maintenance code calls cleanup
- Entries only added, never removed
- Over weeks, map accumulates orphaned entries

### Why This Matters

- Memory leak over long sessions
- Map lookups slow as size grows
- No cleanup of stale host info from closed tabs

### Fix Required

Implement maintenance cleanup:

1. Initialize hostInfoMaintenanceIntervalId with setInterval()
2. On interval, remove entries older than MAX_AGE_MS
3. Check if tab IDs still exist (call browser.tabs.get() and handle errors)
4. Trim if map exceeds HOST_INFO_MAX_ENTRIES
5. Log pruning: entries removed and final map size

---

## Issue #20: Hash Collision Risk During Debounce

### Problem

Manager computes expensive 64-bit hash frequently (every 100ms during drag).
While 64-bit reduces collision risk, it doesn't eliminate it. Hash computation
is wasteful during frequent updates.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js` (lines 77-78)

**Location:** `computeStateHash()` call in render logic

**Issue:**

- Called every 100ms during active dragging
- With 30-60 tabs, means 30-60 hash operations per second
- 64-bit hash computed from scratch each time
- Hash computed again during debounce resolution
- No practical fallback if collision occurs

### Why This Matters

- CPU usage during drag operations
- Debounce ineffective if collision occurs
- No way to detect and recover from collision

### Fix Required

Optimize hash computation:

1. Cache hash of individual tab state instead of recomputing from scratch
2. Use event ID from UpdateHandler instead of hash-based comparison
3. Only compute full hash periodically, use counter-based debounce otherwise

---

## Shared Architectural Issues

### Port-Based State Without Storage Fallback

Manager assumes port connectivity for all state updates. Without
storage.onChanged listener, any port disconnect leaves Manager permanently
stale.

**Recommendation:** Implement dual-path sync (port + storage listener) for
resilience.

### Missing Initialization Sequencing

No handshake ensures Manager hydration completes before state updates arrive.
SIDEBAR_READY sent but no acknowledgment required.

**Recommendation:** Add explicit handshake requiring acknowledgment before
UPDATE mode activation.

### Inconsistent Storage Strategy Documentation

Code comments reference storage.session (MV2 incompatible), but implementation
uses ports. Creates confusion and fragility.

**Recommendation:** Document chosen strategy explicitly and ensure all code
follows it consistently.

---

## Acceptance Criteria

**Issue #11:**

- Port messages include monotonic sequence numbers
- Manager filters and reorders out-of-sequence messages
- SIDEBAR_READY handshake requires acknowledgment before processing
  STATE_CHANGED

**Issue #12:**

- onDisconnect handler logs entry with port state
- Heartbeat stop logged with confirmation
- Reconnect scheduling logged with backoff calculation

**Issue #13:**

- browser.storage.onChanged listener added and registered
- Listener handles quick_tabs_state_v2 changes
- Storage updates trigger scheduleRender() as fallback
- Logging shows source (port vs storage) of state update

**Issue #14:**

- State hash captured immediately before rendering, not at debounce scheduling
- Logging shows hash at debounce vs final render
- No duplicate renders for same state

**Issue #15:**

- File header updated to reflect actual storage strategy
- No references to storage.session API
- Documentation explains why MV2 incompatibility was accepted

**Issue #16:**

- Entry log in handleQuickTabsPortMessage shows type, size, timestamp
- Each handler logs execution entry and exit
- Unknown message types logged as warnings
- State updates logged with tab count and hash

**Issue #17:**

- Ack received logged with correlationId, roundtrip time, result
- Pending acks logged if more than 1 pending for 2+ seconds
- Ack timeout reason distinguished (port dead vs slow)

**Issue #18:**

- Debounce timing aligned (consistent across components)
- No double renders during drag operations
- Manager position badge does not show intermediate positions

**Issue #19:**

- hostInfoMaintenanceIntervalId initialized with setInterval()
- Maintenance runs every HOST_INFO_MAINTENANCE_INTERVAL_MS
- Prunes entries older than MAX_AGE_MS
- Trims map if size exceeds HOST_INFO_MAX_ENTRIES
- Pruning logged with entry count

**Issue #20:**

- Hash computation optimized (cached or event-based)
- CPU usage reduced during drag operations
- No regression in collision detection

**All Issues:**

- Comprehensive logging added matching content script depth
- No new console errors or warnings
- Manual test: Create 3+ Quick Tabs, drag/resize, minimize/restore, observe
  Manager sync
- Port lifecycle visible in console logs

---

## Supporting Details

### Firefox WebExtensions Port Documentation

Per Mozilla WebExtensions documentation:

- browser.runtime.connect() creates persistent connection
- Order depends on handler implementation (not guaranteed with async handlers)
- browser.storage.session does NOT exist in MV2 (only MV3)
- browser.storage.local recommended for MV2 persistent storage

Source:
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/connect

### Port Message Ordering Issue

While TCP guarantees order, browser extension message dispatch can reorder if
handlers are async:

- Handler A for message 1 is async (returns Promise)
- Handler B for message 2 is sync
- If 1 then 2 arrive, and A doesn't complete when 2 arrives, B may fire first

Current code assumes ordering without addressing this. Fix requires sequence
numbers, sync handlers, or handshake coordination.

### Storage Strategy Inconsistency

Comments claim session storage, but:

- No calls to browser.storage.session.get() or set()
- Port-based state sync is primary mechanism
- Fallback uses \_allQuickTabsFromPort in-memory cache
- Code would fail at runtime if storage.session was actually called

Suggests either outdated comment, incomplete implementation, or design decision
not reflected in documentation.

---

## Dependencies and Fix Order

These issues are interdependent:

- Issue #13 (storage listener) unblocks Issue #15 (storage clarity)
- Issues #11, #12, #16, #17 enable port debugging
- Issues #14, #18 fix render timing independently but together improve UX
- Issues #19, #20 are performance optimizations

**Recommended Fix Order:**

1. Issue #15 (clarify storage strategy)
2. Issue #13 (add storage listener fallback)
3. Issues #11, #12, #16, #17 in parallel (port lifecycle)
4. Issues #14, #18 in parallel (render timing)
5. Issues #19, #20 final (performance)

---

**Priority:** Critical (Issues #13, #15), High (Issues #11, #14, #18), Medium
(Issues #12, #16, #17, #19, #20)

**Estimated Complexity:** Medium

**Regression Risk:** Low
