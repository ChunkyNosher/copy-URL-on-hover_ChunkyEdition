# Port Infrastructure Removal Guide

**Document Type**: Technical Implementation Guide  
**Target**: GitHub Copilot Coding Agent + Development Team  
**Purpose**: Identify and remove all remaining port-related code
infrastructure  
**Date**: December 16, 2025  
**Scope**: copy-URL-on-hover_ChunkyEdition repository

---

## EXECUTIVE SUMMARY

The port infrastructure was officially removed in **v1.6.3.8-v13**, but analysis
of the current codebase shows **significant dead code and misleading logic
remains** that claims removal but still carries port-related patterns. The
sidebar manager file (quick-tabs-manager.js) is ~8,000+ lines with extensive
**removed but undocumented port code** still consuming file size and creating
maintainability issues.

**Critical Finding**: The code contains multiple **`@deprecated` markers,
comments claiming removal, and no-op function stubs** that create false
impressions of cleanup while actual port patterns persist.

---

## PART 1: DEAD CODE VERIFIED AS NOT DELETED

### Category 1.1: Port-Related Constants (Claimed Removed, Still Present)

**Location**: quick-tabs-manager.js, lines ~100-200 (constants section)

#### Code to Remove

```javascript
// v1.6.3.8-v13 - PORT REMOVED: All port-related constants deleted
// Circuit breaker, heartbeat, and reconnection constants no longer needed
```

**Issue**: Comment claims deletion but surrounding context shows incomplete
cleanup. The following should be deleted entirely:

- **CONNECTION_STATE constants**: `_CONNECTION_STATE_DEPRECATED`,
  `connectionState` (set to 'connected'), `_lastConnectionStateChange`,
  `_consecutiveConnectionFailures`
  - These variables are marked as deprecated but still declared and initialized
  - `connectionState = 'connected'` is redundant post-removal (connection state
    no longer tracked)
  - No code path actually uses these, making them pure dead weight

**Lines Affected**:

- Constant declaration: 4-5 lines per variable × 4 variables = ~20 lines
- Comments claiming removal: ~5 lines
- Total: ~25 lines of dead constants

#### Why This Matters

These constants create false signals in code review:

- Developers see `connectionState = 'connected'` and might assume connection
  tracking exists
- The `@deprecated` markers suggest cleanup when variable still exists
- `_lastConnectionStateChange = 0` will never be updated (true dead code)

---

### Category 1.2: No-Op Function Stubs (Dead Code Disguised as Compatibility)

**Location**: quick-tabs-manager.js, lines ~400-500

#### Code to Remove

```javascript
/**
 * Log port lifecycle event
 * v1.6.3.8-v13 - PORT REMOVED: Simplified logging
 * @param {string} event - Event name
 * @param {Object} details - Event details
 */
function logPortLifecycle(_event, _details = {}) {
  // v1.6.3.9-v6 - NO-OP: Port removed, function is no-op
}

/**
 * @deprecated v1.6.3.9-v6 - GAP #15: Port removed, function is no-op
 */
function _transitionConnectionState(_newState, _reason) {
  // v1.6.3.9-v6 - NO-OP: Connection state no longer tracked
}
```

**Problem**: These functions serve zero purpose:

- `logPortLifecycle()` accepts parameters but does nothing (no-op)
- `_transitionConnectionState()` claims to transition state but has no
  implementation
- They exist ONLY to prevent "undefined function" errors in code that calls them
- They are called from `_logPortMessageReceived()` and
  `_logPortMessageRouting()` functions

**All remaining callers of these no-op functions**:

1. In `_logPortMessageReceived()` (~line 1250):

   ```javascript
   logPortLifecycle('message', {
     type: message.type,
     action: message.action,
     correlationId
   });
   ```

2. This call can be **deleted entirely** along with the stub function

---

### Category 1.3: Backwards Compatibility Aliases (Not Needed)

**Location**: quick-tabs-manager.js, lines ~300-350

#### Code to Remove

```javascript
// v1.6.3.9-v6 - Backwards compatibility aliases
// These allow existing code to reference the old variable names directly.

/**
 * @deprecated v1.6.3.9-v6 - Use _isInitPhaseComplete instead
 * Mutable alias that gets updated when _resolveInitBarrier() is called.
 */
let initializationComplete = false;

/**
 * @deprecated v1.6.3.9-v6 - Removed, phase tracking simplified
 * Kept for backwards compatibility with code that sets this variable
 * v1.6.3.9-v6 - GAP #18: Prefixed with underscore as currently unused
 */
let _currentInitPhase = 'simplified';
```

**Problem**: These are **not backwards compatibility** – they're **dead variable
declarations**:

- `initializationComplete` is assigned in `_resolveInitBarrier()` but never read
- `_currentInitPhase = 'simplified'` is never read (the variable exists but
  serves no purpose)
- These exist only as vestigial references to old logic

**Where they're assigned** (can be removed):

- Line ~1100: `initializationComplete = true;` in `_resolveInitBarrier()`
  function
  - This assignment should be deleted; `_isInitPhaseComplete` is the source of
    truth

**Why this matters**: Future developers will see these and wonder if they serve
a purpose, creating confusion and potential for misuse.

---

## PART 2: INCOMPLETE FUNCTION REMOVALS

### Category 2.1: Port-Related Initialization Removed Partially

**Location**: quick-tabs-manager.js header comments, lines ~50-100

#### Code Pattern to Clean Up

Multiple version history comments reference removed port infrastructure that
should be consolidated:

```javascript
 * v1.6.3.8-v13 - FULL Port Removal: Replaced runtime.Port with stateless runtime.sendMessage
 *   - REMOVED: backgroundPort, _portOnMessageHandler, portMessageQueue
 *   - REMOVED: connectToBackground(), scheduleReconnect(), handleConnectionFailure()
 *   - REMOVED: startHeartbeat(), stopHeartbeat(), sendHeartbeat()
 *   ... [40+ more removed items listed but not verified deleted]
 *
 * v1.6.3.9-v4 - PORT REMOVED: Connection management, circuit breaker, and heartbeat functions removed:
 * - connectToBackground() - was no-op since v13
 * - All message queue helpers (_extractQueuedMessages, _validateAndSortQueuedMessages, etc.)
 * ... [more items]
```

**Issue**: The comments **claim** removal but don't verify it happened. A
grep/search should confirm:

1. **`backgroundPort` variable** - Should not exist anywhere in file
2. **`_portOnMessageHandler` function** - Should not exist
3. **`portMessageQueue` variable** - Should not exist
4. **`_flushPortMessageQueue()` function** - Should not exist
5. **All "try to route X via port first" logic** - Should be deleted

---

### Category 2.2: Port-Related Message Handling Still Present

**Location**: quick-tabs-manager.js, `handlePortMessage()` function (~line 1200)

#### Code Structure to Analyze

```javascript
/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #10: Process acknowledgments
 * v1.6.3.6-v12 - FIX Issue #4: Handle HEARTBEAT_ACK
 * v1.6.4.0 - FIX Issue E: Handle FULL_STATE_SYNC response
 * v1.6.3.7-v4 - FIX Issue #3: Handle STATE_UPDATE from port (not just runtime.onMessage)
 * v1.6.3.7-v4 - FIX Issue #9: Wrapped in try-catch for error handling
 * @param {Object} message - Message from background
 */
function handlePortMessage(message) {
  // Function body with routing logic
  _routePortMessage(message);
}
```

**Problem**: The entire `handlePortMessage()` function should **not exist** if
port is truly removed:

- If `backgroundPort` no longer exists, this function cannot be called
- Comments suggest it handles HEARTBEAT_ACK, STATE_UPDATE, etc. – all
  port-specific
- The function routes to `_routePortMessage()` which itself should not exist

**Action Required**:

- Verify `handlePortMessage()` is not called from anywhere
- Verify `_routePortMessage()` is not called from anywhere
- Delete both functions entirely

---

### Category 2.3: Port-Related Message Routing Functions

**Location**: quick-tabs-manager.js, lines ~1250-1350

#### Functions to Remove

```javascript
/**
 * Route port message to appropriate handler
 * v1.6.3.7-4 - FIX Issue #9: Extracted for complexity reduction
 * v1.6.3.7-5 - FIX Issue #3: Added logging for STATE_UPDATE via port path
 * v1.6.3.7-10 - FIX Issue #6: Handle START_STORAGE_WATCHDOG message
 * v1.6.3.7-10 - FIX ESLint: Refactored to use lookup table to reduce complexity
 * @private
 * @param {Object} message - Message to route
 */
function _routePortMessage(message) {
  // ... routing logic for port messages
}

function _tryRoutePortMessageByType(message) {
  // Routing table for port messages
}

function _handlePortStateUpdate(message) {
  // Port-specific state update handling
}
```

**Why These Must Be Deleted**:

- These functions only exist to handle port messages
- If port is removed, there are no port messages to route
- All routing handlers reference port-specific behavior
- Comments explicitly state "port-connection" and "port-based fallback"

---

## PART 3: MESSAGING INFRASTRUCTURE STILL CONTAINING PORT PATTERNS

### Category 3.1: Port-Related Message Constants and Types

**Location**: quick-tabs-manager.js, throughout message handling code

#### Port Message Types Still Referenced

These message types were ONLY for port-based communication:

- `HEARTBEAT_ACK` - No longer needed (port removed)
- `START_STORAGE_WATCHDOG` - Was coordination between port and storage
- `PORT_STATE_UPDATE` - Was port-specific state sync
- `ACKNOWLEDGMENT` - Port-based acknowledgment pattern

**Pattern to Find and Remove**:

```javascript
// Any check like:
if (message.type === 'HEARTBEAT_ACK' || message.type === 'ACKNOWLEDGMENT') {
  handleAcknowledgment(message);
  return;
}

// Or any handler for port-specific types:
if (message.type === 'START_STORAGE_WATCHDOG') {
  _handleStartStorageWatchdog(message);
  return;
}
```

These checks should be **deleted entirely** because:

1. Port is gone → no port messages exist
2. runtime.sendMessage is stateless → no acknowledgments via port
3. Storage coordination is direct → no WATCHDOG messages

---

### Category 3.2: Pendingacknowledgments Map (Port-Specific)

**Location**: quick-tabs-manager.js, line ~970

#### Code to Remove

```javascript
/**
 * Pending acknowledgments map - stub for compatibility
 * v1.6.3.8-v13 - PORT REMOVED: Kept as stub
 */
const pendingAcks = new Map();
```

**Issue**: This map is:

- Initialized but only used in port-related functions
- Updated in `_handleOperationConfirmation()` which is port-specific
- Never read by runtime.sendMessage-based code
- Pure dead code taking up memory

**What needs to happen**:

- Delete the `pendingAcks` initialization
- Delete any code that adds/removes entries: `pendingAcks.get()`,
  `pendingAcks.set()`, `pendingAcks.delete()`
- Delete `handleAcknowledgment()` function that processes port acknowledgments

---

## PART 4: MISLEADING OR INCOMPLETE FUNCTION CLEANUP

### Category 4.1: Functions with Port-Related Comments But Changed Purpose

**Location**: quick-tabs-manager.js, `_probeBackgroundHealth()` function
(~line 900)

#### Code Pattern

```javascript
/**
 * Probe background health with a lightweight ping
 * v1.6.3.9-v4 - Kept for health checks using runtime.sendMessage
 * @private
 * @returns {Promise<boolean>} True if background is healthy
 */
async function _probeBackgroundHealth() {
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage({
        type: 'HEALTH_PROBE',
        timestamp: Date.now()
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 500)
      )
    ]);
    return response?.healthy === true || response?.type === 'HEALTH_ACK';
  } catch {
    return false;
  }
}
```

**Issue**:

- This function was part of port health checking
- Comment says "Kept for health checks using runtime.sendMessage" but background
  doesn't send HEALTH_ACK via runtime
- Sending unsolicited HEALTH_PROBE messages creates overhead
- Background script may not handle this message type

**Verification Needed**:

- Does background.js actually handle `HEALTH_PROBE` messages?
- Is `_probeBackgroundHealth()` actually called?
- Should this be deleted entirely or properly implemented?

---

## PART 5: MIGRATION PATTERNS STILL SHOWING PORT ASSUMPTIONS

### Category 5.1: Comments Suggesting Port-Based Fallback Still Active

**Location**: Quick-tabs-manager.js header comments, various locations

#### Example Comment Pattern

```javascript
// ARCHITECTURE: storage.onChanged is now PRIMARY sync mechanism
// ARCHITECTURE: runtime.sendMessage for request/response patterns only
```

**Issue**: While comments claim storage is primary, code still contains:

- Checks for `connectionState` (which no longer changes)
- Port message handlers that "should" not exist
- Heartbeat fallback logic patterns
- Circuit breaker fallback references in comments

**What needs to happen**:

- Audit EVERY comment mentioning "port", "fallback to storage", "Tier 3",
  "heartbeat"
- Verify the code below the comment matches what the comment claims
- Delete comments that describe removed code
- Update comments that claim behavior that no longer exists

---

## PART 6: SPECIFIC FUNCTIONS TO REMOVE (VERIFICATION CHECKLIST)

### Functions That Must Be Completely Deleted

Check each function and delete if found:

- [ ] `connectToBackground()` - Port connection setup (should not exist if port
      removed)
- [ ] `_establishPortConnection()` - Port establishment (should not exist)
- [ ] `_setupPortListeners()` - Port listener registration (should not exist)
- [ ] `_handlePortDisconnect()` - Port disconnection handling (should not exist)
- [ ] `scheduleReconnect()` - Port reconnection scheduling (should not exist)
- [ ] `handleConnectionFailure()` - Port failure handling (should not exist)
- [ ] `tripCircuitBreaker()` - Circuit breaker for port (should not exist)
- [ ] `_startCircuitBreakerProbes()` - CB probe startup (should not exist)
- [ ] `_stopCircuitBreakerProbes()` - CB probe shutdown (should not exist)
- [ ] `startHeartbeat()` - Port heartbeat (should not exist)
- [ ] `stopHeartbeat()` - Stop heartbeat (should not exist)
- [ ] `sendHeartbeat()` - Send heartbeat (should not exist)
- [ ] `_handlePortMessageWithQueue()` - Port message queueing (should not exist)
- [ ] `_flushPortMessageQueue()` - Port queue flushing (should not exist)
- [ ] `waitForListenerReady()` - Port listener readiness (should not exist)
- [ ] `_startBackgroundActivityCheck()` - Port health check (should not exist)
- [ ] `_stopBackgroundActivityCheck()` - Port health check stop (should not
      exist)

### Verify Complete Removal With Grep

For each function above, run:

```bash
grep -n "functionName" sidebar/quick-tabs-manager.js
```

If any results appear, function or reference still exists and must be removed.

---

## PART 7: WHAT SHOULD REMAIN (NOT TO BE DELETED)

### Keep These Port-Related Items

- **Comments documenting removed code** - For historical context
- **Version history notes** (v1.6.3.8-v13, etc.) - For audit trail
- **`handlePortMessage()` function** - ONLY if called by actual port somewhere
  (verify first)
- **Acknowledgment handling** - ONLY if runtime.sendMessage uses correlation IDs
  (verify first)

### Critical: Don't Remove These

These are NOT port-related despite similar names:

- `_storageListenerVerificationTimeout()` - Storage verification (keep)
- `_handleStorageListenerVerification()` - Storage listener setup (keep)
- `_initStorageListenerReadyPromise()` - Storage initialization (keep)
- Any `storage.onChanged` related code - This is the primary mechanism now
  (keep)
- `sendToBackground()` function - This replaced port.postMessage (keep, verify
  it uses runtime.sendMessage)

---

## IMPLEMENTATION CHECKLIST

### Phase 1: Dead Code Removal

- [ ] Remove `connectionState` constant and related connection state variables
- [ ] Remove `logPortLifecycle()` function (no-op stub)
- [ ] Remove `_transitionConnectionState()` function (no-op stub)
- [ ] Remove any calls to these no-op functions
- [ ] Remove `initializationComplete` backwards compatibility alias
- [ ] Remove `_currentInitPhase` variable
- [ ] Remove `pendingAcks` Map initialization (port-specific)

### Phase 2: Function Removal

For each function in Part 6:

- [ ] Search for all references to function
- [ ] Delete function definition
- [ ] Delete all calls to function
- [ ] Delete related constants/variables unique to that function

### Phase 3: Message Type Cleanup

- [ ] Remove port-specific message type checks (HEARTBEAT_ACK,
      START_STORAGE_WATCHDOG, etc.)
- [ ] Verify all message handlers expect runtime.sendMessage (stateless)
- [ ] Delete port-specific message routing logic

### Phase 4: Comment and Documentation Cleanup

- [ ] Update file header to remove port removal notes (consolidate into single
      note)
- [ ] Remove `@deprecated` markers for port-related items
- [ ] Update ARCHITECTURE comments to reflect actual current architecture
- [ ] Keep version history for audit trail only

### Phase 5: Verification

- [ ] Run `grep -r "backgroundPort"` - Should return 0 results
- [ ] Run `grep -r "portMessageQueue"` - Should return 0 results
- [ ] Run `grep -r "_handlePortMessage"` - Should return only definitions in
      this removal guide
- [ ] Run `grep -r "HEARTBEAT_ACK"` - Should return 0 results
- [ ] Search for "port" in comments - Review context, remove irrelevant ones
- [ ] File size should reduce from ~8,000+ lines to ~6,000-6,500 lines

---

## EXPECTED OUTCOMES

### After Successful Cleanup

**File Size**: ~8,000+ lines → ~6,000-6,500 lines (20-25% reduction)

**Lines Removed**:

- Dead constants: ~25 lines
- No-op functions: ~30 lines
- Port message routing: ~150-200 lines
- Port health checks: ~50-75 lines
- Deprecated compatibility aliases: ~10 lines
- Port-specific message handlers: ~100-150 lines
- Backwards compatibility code: ~50-100 lines
- **Total estimated removal: 400-600 lines of pure dead code**

**Code Quality Improvements**:

- Reduced confusion about what's actually implemented
- Faster code review (less dead code to parse)
- Clearer initialization barrier logic
- Elimination of misleading no-op functions
- Proper separation: storage.onChanged (primary) vs runtime.sendMessage
  (command/response)

---

## NOTES FOR GITHUB COPILOT AGENT

When implementing these changes:

1. **Do NOT** assume a function is unused just because it has `@deprecated`.
   Verify with grep.
2. **Do NOT** delete function stubs without checking all callers first.
3. **Do verify** that every deletion doesn't break the initialization barrier or
   storage listener logic.
4. **Do consolidate** version history comments into a single "Port removal
   history" section at the top.
5. **Do test** that `_initializeStorageListener()` still works correctly after
   cleanup.
6. **Do verify** that `handlePortMessage()` is truly never called (not called by
   any actual port).

The goal is to remove port infrastructure **cleanly** while preserving the
robust simplified architecture that storage.onChanged + runtime.sendMessage
provides.
