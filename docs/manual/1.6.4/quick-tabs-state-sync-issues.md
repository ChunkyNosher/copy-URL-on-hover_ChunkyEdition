# Quick Tabs State Synchronization: Complete Issue Report

**Extension Version:** v1.6.3.7-v3 | **Date:** 2025-12-09 | **Scope:** Critical
state synchronization failures preventing sidebar from receiving Quick Tab
updates; background script lifecycle mismanagement; broken message routing and
listener coordination

---

## Executive Summary

Quick Tabs state updates fail to reach the sidebar consistently, causing users
to see stale or empty UI. Investigation reveals a fundamental architectural
issue: four independent communication paths were partially implemented but never
unified into a coherent system. The background script is terminated by Firefox
every 30 seconds (confirmed in official Mozilla bug tracker), breaking
port-based communication. Meanwhile, the fallback mechanisms (BroadcastChannel,
storage polling) lack proper implementation or coordination. Result: sidebar
receives updates through multiple paths, creating race conditions and duplicate
renders; fails entirely when background is terminated; provides no error
feedback to users; caches stale data across sessions.

**Why bundled:** All issues affect the core ability to synchronize Quick Tab
state from background/content scripts to sidebar. Together they explain why
sidebar shows stale/blank UI and fails to respond to user actions.

---

## Issues Overview

| Issue # | Component             | Severity | Missing/Broken                                        | Root Cause                                                      |
| ------- | --------------------- | -------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| #1      | Port Connection       | Critical | Heartbeat works but background still dies every 30s   | Firefox terminates background regardless of active ports        |
| #2      | BroadcastChannel      | Critical | Sender never implemented                              | Backend handlers have no broadcast calls                        |
| #3      | Message Routing       | Critical | Two separate paths for heartbeat vs state updates     | Port receives heartbeat, runtime.sendMessage gets state updates |
| #4      | Listener Coordination | Critical | Four listeners create duplicate renders without dedup | No message versioning or deduplication logic                    |
| #5      | Error Feedback        | High     | Silent failures throughout                            | No success/failure responses from operations                    |
| #6      | Session Cache         | High     | Cache can restore deleted tabs across sessions        | Cache lacks session timestamp validation                        |
| #7      | Storage Poll Latency  | High     | 2-second delay makes rapid ops appear broken          | Poll interval too slow, debounce ineffective                    |
| #8      | Circuit Breaker       | Medium   | 10-second blackout window after 5 failures            | No probes to detect early recovery                              |
| #9      | Message Validation    | Medium   | Corrupted messages cause silent failures              | No try-catch or field validation in handlers                    |
| #10     | Listener Registration | Low      | No confirmation listeners actually registered         | No logging or verification after registration                   |

---

## Issue #1: Background Script Terminates Every 30 Seconds Despite Active Port Connection

### Problem Summary

Sidebar establishes port connection to background script successfully. Heartbeat
mechanism attempts to keep connection alive by sending messages every 25
seconds. Firefox still forcefully terminates the background script after 30
seconds of inactivity. Sidebar's port remains open but recipient is dead (zombie
connection). No state updates reach sidebar until port reconnects.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `connectToBackground()` (lines 733-835), `startHeartbeat()` (lines
849-906)  
**Issue:** Firefox WebExtension architecture terminates non-persistent
background scripts after 30 seconds regardless of active port connection.
Mozilla Bugzilla #1851373 explicitly confirms: "For backgrounds with active
ports, Firefox will still force stop after 30 seconds." The `runtime.connect()`
port does not prevent termination. Heartbeat messages provide no protection
against this timeout.

### Missing Logging

- No logs showing heartbeat message was delivered vs. failed
- No detection of "port open but background actually dead" state
- No distinction between "port disconnected" vs "background died but port still
  open"
- No logging when Firefox terminates background process
- No indication to sidebar when it enters zombie connection state

### What Must Change

Implement explicit detection of background death separate from port state. Track
heartbeat failures explicitly. When heartbeat fails, transition to fallback
communication paths (BroadcastChannel, storage polling) immediately without
waiting for port disconnect. Log each heartbeat attempt with success/failure
status. Distinguish three states: "port connected & background alive", "port
open but background dead (zombie)", "port disconnected".

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (heartbeat logic, port connection lifecycle tracking, fallback path triggering)

**Do NOT Modify:**

- Firefox browser engine (30-second timeout is environmental constraint)
- manifest.json (configuration) </scope>

<acceptance_criteria>

- [ ] Heartbeat failures logged with timestamp and state
- [ ] Three connection states explicitly tracked and logged
- [ ] When heartbeat fails, sidebar immediately uses BroadcastChannel (if
      available)
- [ ] Sidebar recovers from background death without 30-second wait for port
      reconnect
- [ ] No zombie connection states lasting more than 2 seconds
      </acceptance_criteria>

---

## Issue #2: BroadcastChannel Infrastructure Is Only Half-Built

### Problem Summary

Sidebar imports and initializes BroadcastChannel with complete message handlers
for create/update/delete operations. Backend never sends messages to this
channel. Sidebar listens to empty channel. Infrastructure for **receiving**
broadcasts is complete and functional. Infrastructure for **sending** broadcasts
is completely missing.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `initializeBroadcastChannel()` (lines 1026-1080),
`handleBroadcastChannelMessage()` (lines 1073-1158)  
**Backend Files:** `src/features/quick-tabs/handlers/CreateHandler.js`,
`UpdateHandler.js`, `DestroyHandler.js`  
**Issue:** BroadcastChannel exists in sidebar but corresponding broadcaster does
not exist in backend. Every handler (CreateHandler, UpdateHandler,
DestroyHandler) creates/updates/deletes Quick Tabs but never broadcasts
notification of change. Sidebar has listener infrastructure with no incoming
messages. This is a one-sided implementation: receiver without sender.

### Missing Logging

- No logs confirming BroadcastChannel was initialized successfully
- No logs showing messages received from channel (because nothing is sent)
- No error logs if channel initialization fails
- No monitoring to detect if channel is active vs. dormant
- No indication that broadcast sender is missing

### What Must Change

Connect backend handlers to BroadcastChannel. When Quick Tabs are
created/updated/deleted, handlers must broadcast change notifications. This
requires creating BroadcastChannel instance in backend (content script context)
and calling postMessage() from each state-changing operation. Add comprehensive
logging for every broadcast sent and received. Handle the case where broadcast
fails (channel not available) with fallback to storage write. Ensure broadcasts
happen after storage updates are committed.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/CreateHandler.js` (broadcast on tab creation)
- `src/features/quick-tabs/handlers/UpdateHandler.js` (broadcast on tab update)
- `src/features/quick-tabs/handlers/DestroyHandler.js` (broadcast on tab deletion)
- `sidebar/quick-tabs-manager.js` (add logging for broadcasts received)

**Do NOT Modify:**

- BroadcastChannel API (browser provided)
- Storage persistence layer </scope>

<acceptance_criteria>

- [ ] CreateHandler broadcasts immediately after creating Quick Tab
- [ ] UpdateHandler broadcasts immediately after updating Quick Tab
- [ ] DestroyHandler broadcasts immediately after deleting Quick Tab
- [ ] All broadcasts logged with timestamp and data
- [ ] Sidebar logs show broadcasts being received
- [ ] Only changed Quick Tab renders, not entire list (no full remount)
      </acceptance_criteria>

---

## Issue #3: Port Connection Receives Only Heartbeat Acks, Not State Updates

### Problem Summary

The `handlePortMessage()` function has infrastructure to receive STATE_UPDATE
messages through the port. However, background script sends state updates via
separate `browser.runtime.onMessage` path instead of through the port. Two
independent message paths exist: port (for heartbeat/ack) and runtime (for state
updates). When background dies, both paths fail but sidebar is confused about
which path matters.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `handlePortMessage()` (lines 1397-1471 handles port messages),
`browser.runtime.onMessage` listener (lines 2318-2330 handles direct messages)  
**Issue:** Two independent message handlers for different purposes. Port handler
has complete STATE_UPDATE infrastructure but never receives them (background
doesn't send through port). Runtime message handler receives state updates but
this path dies when background dies. No coordination between paths. State
updates and heartbeat on different channels means failure detection is confusing
(port alive but state updates missing? or both dead?).

### Missing Logging

- No logs showing STATE_UPDATE received in handlePortMessage
- No logs in runtime.onMessage handler showing messages received
- No metrics on which path is being used for which operations
- No indication that messages are being sent via wrong channel
- No error if message arrives in unexpected handler

### What Must Change

Unify message routing so backend sends all state updates through the same
reliable channel as heartbeat (the port). When port is closed, both heartbeat
AND state updates fail simultaneously, providing clear signal that background is
unreachable. This simplifies failure detection: one path to monitor instead of
two. Add detailed logging showing message type, source handler (port vs
runtime), and processing result.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (enhance logging in message handlers, consolidate routing)
- Backend state update senders (send through port instead of runtime.sendMessage)

**Do NOT Modify:**

- Browser message APIs (platform provided)
- Port connection lifecycle </scope>

<acceptance_criteria>

- [ ] All state updates sent through port when available
- [ ] No STATE_UPDATE messages via separate runtime.sendMessage()
- [ ] Logging shows message source and handler executed
- [ ] When port closes, both heartbeat and state updates stop (unified failure)
      </acceptance_criteria>

---

## Issue #4: Four Independent Message Listeners Create Race Conditions and Duplicate Renders

### Problem Summary

Sidebar processes state updates through four completely independent mechanisms
without deduplication or ordering: (1) port.onMessage handler, (2)
browser.runtime.onMessage handler, (3) BroadcastChannel listener, (4)
auto-refresh interval reading storage. When Quick Tab state changes, multiple
listeners might process the update at different times, triggering renderUI()
multiple times. This causes DOM remounts, CSS animation re-triggers, and visual
flicker.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Multiple listener registrations (line 1396 port, line 2318
runtime, line 1073 BroadcastChannel, line 2199 storage interval)  
**Issue:** Each listener independently calls renderUI() without checking if
another listener already processed the same update. No state versioning to
detect duplicate updates. No message IDs to track "did I already process this
update". No lock mechanism to ensure only one listener updates state at a time.
When single state change is sent through multiple paths, sidebar re-renders 2-4
times.

### Missing Logging

- No logs showing all listeners that fired for single state change
- No metrics on how many times renderUI() called per update
- No tracking of which updates were deduplicated vs. processed
- No visibility into listener ordering/timing
- No indication of duplicate render suppression

### What Must Change

Implement message deduplication using versioning. Each state update must have
unique ID or version number. When update arrives through any listener, check if
already processed before calling renderUI(). Alternatively, use message priority
(port = highest, BroadcastChannel = medium, storage = lowest) and process only
highest-priority update. Add comprehensive logging showing which listeners
fired, which updates were deduplicated, and final render count per update.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (add state versioning, deduplication logic, listener coordination)

**Do NOT Modify:**

- Browser listener APIs
- renderUI() function logic (only add guard to prevent calling it) </scope>

<acceptance_criteria>

- [ ] Each state update has unique version/ID
- [ ] Deduplication prevents renderUI() firing twice for same update
- [ ] Logging shows which updates were deduplicated
- [ ] renderUI() called exactly once per unique state change
- [ ] No visual flicker from multiple renders </acceptance_criteria>

---

## Issue #5: "Close All" and Other Operations Blocked Silently, No User Feedback

### Problem Summary

User clicks "Close All Quick Tabs" button. Sidebar sends command to background.
Background's DestroyHandler blocks the operation due to anti-corruption logic
checking for `forceEmpty: true` flag. Sidebar receives no failure confirmation.
Sidebar's local state cache still contains old Quick Tabs. UI appears frozen
with tabs still listed. User has zero visibility that operation was blocked and
why.

### Root Cause

**File:** Interaction between `sidebar/quick-tabs-manager.js` (closeAllTabs
command, ~line 2827) and background DestroyHandler (anti-corruption
validation)  
**Issue:** Sidebar sends command without `forceEmpty: true` flag. Backend
validation requires this flag. Message rejected silently with no response.
Sidebar code expects operation to succeed (no error handler) and continues
showing old data. No error message shown to user explaining why operation
failed. Other operations (minimize, restore) also lack error feedback.

### Missing Logging

- No logs in sidebar showing Close All was attempted
- No confirmation message back to sidebar showing operation succeeded/failed
- No error handler if background rejects the command
- No user-visible feedback (toast, notification) of operation failure
- No backend logging explaining why operation was blocked

### What Must Change

Backend must return explicit success/failure response to every user-initiated
command. Sidebar must log the response and act accordingly. If operation fails,
show error message to user explaining why. Add logging in DestroyHandler showing
whether anti-corruption check passed or rejected and reason. Implement standard
response format with success flag, reason code, and user-readable message.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (add error handlers and user feedback)
- Background handlers (return explicit responses for all operations)

**Do NOT Modify:**

- Anti-corruption validation logic (keep security checks) </scope>

<acceptance_criteria>

- [ ] Backend returns explicit response (success/failure) for all commands
- [ ] Sidebar logs response and acts accordingly
- [ ] User sees error message if Close All fails
- [ ] User error message explains why operation was blocked
- [ ] All operations (minimize, restore, close) have error handling
      </acceptance_criteria>

---

## Issue #6: In-Memory Cache Could Restore Deleted Quick Tabs from Previous Session

### Problem Summary

Sidebar maintains in-memory cache of Quick Tabs (lines 230-245). When storage
read returns 0 tabs (corruption or first run), cache is used as fallback. Cache
has no session timestamp. If user closes browser with 5 Quick Tabs, then deletes
all tabs in next session, sidebar's cache still contains tabs from first
session. Sidebar could restore deleted tabs as "ghost tabs" because cache
doesn't know it's from a different session.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `inMemoryTabsCache` variable (line 230), fallback logic
(~line 235)  
**Issue:** Cache is plain object with no metadata. No timestamp on cache
entries. No way to detect if cache is 10 seconds old or from previous browser
session hours ago. When storage returns empty, assumes corruption and uses cache
as rescue without validation that cache is from current session.

### Missing Logging

- No logs showing when cache is used as fallback
- No logging of cache age or session identity
- No warning when using potentially stale cache data
- No metrics on how often cache fallback is triggered
- No indication to user that data is being restored from cache

### What Must Change

Add session metadata to cache entries (session ID, creation timestamp). Validate
cache belongs to current session before using as fallback. When cache is used as
fallback, log clear warning indicating stale data is being restored and from
when. Implement mechanism to invalidate cache when new browser session starts.
Generate unique session identifier (from browser or extension context) and
validate against cache session ID.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (cache structure, validation, logging)

**Do NOT Modify:**

- Storage persistence layer
- Session management APIs </scope>

<acceptance_criteria>

- [ ] In-memory cache includes session timestamp and session ID
- [ ] Cache from different session is rejected
- [ ] Logging shows when cache is used as fallback and why
- [ ] Warning logged if stale cache restored with timestamps
- [ ] Cache invalidated when session changes </acceptance_criteria>

---

## Issue #7: Storage Read Debounce Logic Allows Stale State During Rapid Operations

### Problem Summary

Sidebar polls storage every 2 seconds for state updates. Debounce set to 50ms.
During rapid Quick Tab creation (user creates 3 tabs in 1 second), state updates
arrive faster than sidebar polls. User clicks "Create Tab", sees nothing for up
to 2 seconds, assumes operation failed. The debounce of 50ms is meaningless when
the poll interval is 2000ms (debounce only spreads requests by 50ms but sidebar
won't read for another 1500ms).

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `STORAGE_READ_DEBOUNCE_MS = 50` (line 2147), auto-refresh interval
of 2000ms (line 2199)  
**Issue:** Debounce is too short relative to poll interval. If backend updates
state 10 times in 500ms, debounce only spreads these by 50ms each, but sidebar
won't read storage for another 1500ms. Debounce logic is ineffective at
preventing the real bottleneck which is the 2-second poll interval itself.

### Missing Logging

- No logs showing how often debounce actually delays reads
- No tracking of time from user action (create tab) to UI update
- No metrics on update latency during rapid operations
- No indication that polling interval is the bottleneck
- No correlation between rapid operations and missing updates

### What Must Change

Either increase debounce to meaningful value (200-500ms relative to poll
interval) or remove debounce entirely and use event-driven updates. Better
solution: use port/BroadcastChannel for immediate updates and only use polling
as fallback. Current 2-second poll interval is main bottleneck, not 50ms
debounce. Consider storage change listeners (if available) instead of timed
polling. Add detailed logging showing time from user action to renderUI()
execution.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (storage poll interval, debounce logic, event-driven updates)

**Do NOT Modify:**

- Storage API
- Browser polling mechanisms </scope>

<acceptance_criteria>

- [ ] Rapid operations (3 tabs in 1s) all visible within 500ms
- [ ] Storage read interval reduced from 2s or event-driven
- [ ] Logging shows latency from action to render
- [ ] Debounce logic revisited and optimized or removed </acceptance_criteria>

---

## Issue #8: Circuit Breaker Creates 10-Second Silent Failure Window After Recovery

### Problem Summary

When port connection fails 5 times consecutively, circuit breaker trips and
blocks all reconnection attempts for 10 seconds. If background script becomes
responsive after 5 seconds, sidebar still waits another 5 seconds before
attempting reconnection. User sees disconnected UI for full 10 seconds even
though background recovered after 5 seconds.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `circuitBreakerState`, `CIRCUIT_BREAKER_OPEN_DURATION_MS = 10000`
(line 710), `tripCircuitBreaker()` (lines 826-844)  
**Issue:** Circuit breaker uses fixed 10-second cooldown regardless of when
background recovers. No mechanism to detect if background becomes responsive
sooner. Designed to prevent thundering herd but artificially extends downtime to
full 10 seconds even when background recovers early.

### Missing Logging

- No logs showing circuit breaker state transitions
- No timestamp showing when circuit breaker will reopen
- No user-facing indication that connection is temporarily blocked
- No metrics on circuit breaker open durations
- No indication of estimated reconnection time

### What Must Change

Add periodic probe attempts during circuit breaker open period to detect early
recovery. If probe succeeds, immediately transition to half-open and attempt
reconnection. Alternatively, reduce circuit breaker duration from 10 seconds to
2 seconds maximum or use exponential backoff (start at 1s, increase if failures
continue). Add user-visible logging showing circuit breaker state and estimated
time to reconnection.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (circuit breaker logic, probe mechanism, duration)

**Do NOT Modify:**

- Reconnection retry logic
- Port connection mechanics </scope>

<acceptance_criteria>

- [ ] Circuit breaker duration reduced to 2s maximum
- [ ] Probes attempt to detect early recovery during open period
- [ ] Logging shows circuit breaker state and countdown timer
- [ ] User sees clear indication of reconnection status </acceptance_criteria>

---

## Issue #9: No Error Handling in Message Listeners for Corrupted State

### Problem Summary

The `browser.runtime.onMessage` listener and `handlePortMessage()` process
messages without try-catch blocks. If message data is corrupted or missing
required fields, processing throws exception but listener has no error handler.
Exception is silently swallowed. Sidebar continues displaying old data without
indicating error occurred.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Message listeners (lines 2318-2330, 1397-1471)  
**Issue:** No validation that message contains expected fields before
processing. No try-catch wrapping message processing. No error logging if
exception occurs. No fallback behavior if update fails. Corrupted messages crash
the listener without indication.

### Missing Logging

- No logs when message contains invalid data
- No error logs if exception thrown during processing
- No tracking of failed update attempts
- No indication to user that sync is broken
- No recovery mechanism if update fails

### What Must Change

Wrap all message processing in try-catch blocks. Validate that message contains
required fields before processing. Log all errors with full context (message
type, error details, attempted operation). Implement graceful fallback: if
update fails, retry with exponential backoff or notify user that state sync is
broken. Separate validation failures (log and skip) from execution errors (log
and retry).

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (message listener error handling, validation, logging)

**Do NOT Modify:**

- Browser message APIs </scope>

<acceptance_criteria>

- [ ] All message listeners wrapped in try-catch blocks
- [ ] Error logging includes message content and exception stack
- [ ] Invalid messages logged and skipped gracefully
- [ ] No silent failures or swallowed exceptions </acceptance_criteria>

---

## Issue #10: No Verification That Message Listener Registration Succeeded

### Problem Summary

The `backgroundPort.onMessage.addListener()` call and
`browser.runtime.onMessage.addListener()` registrations have no error handling
or verification. If registration fails silently, sidebar believes it is
listening but never receives messages because listener was never actually
registered.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Line 1396 and line 2318 - listener registrations  
**Issue:** Browser API methods rarely throw errors for registration failures. If
listener registration fails, no exception is raised, only silent non-delivery of
messages. Code continues assuming listener is active and receiving.

### Missing Logging

- No logs confirming listeners were registered successfully
- No error handling if registration throws exception
- No mechanism to detect if listeners are actually receiving messages
- No heartbeat/probe to verify listeners are alive
- No metrics on messages received per listener type

### What Must Change

Add explicit logging after each listener registration confirming success.
Implement test message after registration to verify listener is actually
receiving. If test message fails, log error and indicate listener registration
failed. Add metrics showing messages received per listener type. This enables
rapid detection of "listener registration failed" failures instead of mysterious
silent message loss.

<scope>
**Modify:**
- `sidebar/quick-tabs-manager.js` (listener registration verification, test messaging, metrics)

**Do NOT Modify:**

- Browser listener APIs </scope>

<acceptance_criteria>

- [ ] Logging confirms each listener registered successfully
- [ ] Test message sent after registration to verify listener works
- [ ] Metrics show messages received per listener type
- [ ] Unregistered listeners detected early via failed test
      </acceptance_criteria>

---

## Implementation Priority and Dependencies

**Critical (Blocking):**

- Issue #1 (Background death detection) → fixes foundation
- Issue #2 (BroadcastChannel sender) → provides fallback path
- Issue #3 (Unified message routing) → simplifies all other fixes

**High (Important):**

- Issue #4 (Deduplication) → prevents UI flicker
- Issue #5 (Error feedback) → improves user experience
- Issue #6 (Session cache) → prevents data corruption

**Medium (Quality):**

- Issue #7 (Poll latency) → improves perceived performance
- Issue #8 (Circuit breaker) → reduces reconnection time

**Low (Diagnostic):**

- Issue #9 (Error handling) → improves debugging
- Issue #10 (Registration verification) → improves diagnostics

**Dependency Order:** Start with #1 → #2 → #3, then handle #4-#10 in parallel

---

## Architecture Overview: Three-Tier Fallback System

After fixes, communication should follow this hierarchy:

**Tier 1: BroadcastChannel (Primary)** - Immediate, survives background death,
used when available  
**Tier 2: Port Connection (Secondary)** - Reliable when active, fails every 30s,
reconnects with backoff  
**Tier 3: Storage Polling (Tertiary)** - Always available but slowest, fallback
only, reduced to 500ms

Each tier independently logs activity. Sidebar uses highest-priority path that's
delivering updates.
