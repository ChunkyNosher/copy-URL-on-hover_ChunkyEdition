# Code Removal Guide for Quick Tabs Architecture Migration

**Document Purpose:** Identify all code that must be removed during migration to the simplified architecture  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Critical - Use as reference during implementation  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This guide identifies **~1500+ lines of code** that should be removed from the current implementation. The removals fall into 5 major categories:

1. **Port-based messaging infrastructure** (300+ lines) - Removed in v1.6.3.8-v13
2. **Complex initialization layers** (400+ lines) - Simplified to single barrier
3. **Multi-layer deduplication** (250+ lines) - Replaced by revision versioning
4. **Storage verification & retry logic** (200+ lines) - Replaced by fallback patterns
5. **Render queue corruption recovery** (150+ lines) - Simplified to basic recovery

### Key Principle
**Do NOT delete code blindly.** Each removal must account for:
- Other code that might reference the deleted function
- Stub patterns for backward compatibility
- Order dependencies (some deletions enable others)

---

## REMOVAL CATEGORY 1: PORT-BASED MESSAGING (300+ lines)

### Current State in Repository
Port-based messaging was removed in v1.6.3.8-v13 but may still have remnants in:
- `sidebar/quick-tabs-manager.js`
- Background script message handlers
- Utility modules

### What to Remove

#### Pattern 1A: Port Connection Functions

**Pseudocode of what exists:**
```
connectToBackground()
  └─ Create runtime.Port
     ├─ Set up onMessage listener
     ├─ Set up onDisconnect listener
     └─ Start heartbeat

_establishPortConnection()
  └─ Validate port is connected
     ├─ Send verification message
     ├─ Wait for ack
     └─ Resolve promise

_setupPortListeners()
  └─ Handle incoming port messages
     ├─ Process state updates
     ├─ Acknowledge receipt
     └─ Schedule renders

_handlePortDisconnect()
  └─ Port unexpectedly closed
     ├─ Log disconnection
     ├─ Attempt reconnect
     └─ Fallback to storage.onChanged
```

**Search patterns to find:**
- `runtime.connect()`
- `backgroundPort` variable references
- `connectToBackground()` function calls
- `_establishPortConnection()` function
- `_setupPortListeners()` function
- `_handlePortDisconnect()` function

**Removal order:**
1. Delete helper functions first (`_setupPortListeners`, `_handlePortDisconnect`)
2. Delete main functions (`connectToBackground`, `_establishPortConnection`)
3. Remove all `backgroundPort` variable declarations and initializations
4. Remove port-related constants

**Dependency warning:**
- Check for `sendWithAck()` calls - replace with `sendToBackground()`
- Check for port message queue flushes - these become no-ops
- Background script may have port handlers - remove those too

---

#### Pattern 1B: Heartbeat Mechanism

**Pseudocode of what exists:**
```
startHeartbeat()
  └─ Send heartbeat every 30s
     ├─ Measure roundtrip time
     ├─ Track consecutive failures
     └─ Reconnect on threshold

stopHeartbeat()
  └─ Clear heartbeat timer

sendHeartbeat()
  └─ Send HEARTBEAT message
     ├─ Record timestamp
     ├─ Wait for response
     └─ Update health stats

_handlePortMessageWithQueue()
  └─ Complex message handling
     ├─ Handle port messages
     ├─ Queue if port down
     ├─ Flush queue on reconnect
     └─ Track message IDs
```

**Search patterns:**
- `startHeartbeat()`
- `stopHeartbeat()`
- `sendHeartbeat()`
- `heartbeatTimer` variable
- `consecutiveHeartbeatFailures` variable
- `lastHeartbeatResponse` variable
- `HEARTBEAT_INTERVAL_MS` constant
- `_handlePortMessageWithQueue()`

**Removal order:**
1. Delete heartbeat functions (`startHeartbeat`, `stopHeartbeat`, `sendHeartbeat`)
2. Remove heartbeat-related state variables
3. Remove heartbeat constants
4. Remove calls to `startHeartbeat()` / `stopHeartbeat()` throughout code

**Dependency warning:**
- Heartbeat failures may trigger reconnection logic - that can be deleted too
- Some logging may reference heartbeat state - update log messages
- Connection state transitions may rely on heartbeat - simplify to basic on/off

---

#### Pattern 1C: Port Message Queue

**Pseudocode of what exists:**
```
portMessageQueue = []

_flushPortMessageQueue()
  └─ After reconnect, replay queued messages
     ├─ For each message in queue
     ├─ Send to background
     ├─ Track responses
     └─ Clear queue

_handleConnectionFailure()
  └─ Port disconnected
     ├─ Queue pending messages
     ├─ Try to reconnect
     └─ Fall back to storage.onChanged

sendWithAck(message)
  └─ Send message, wait for ack
     ├─ If connected: use port
     ├─ If disconnected: queue it
     └─ Timeout after 3s
```

**Search patterns:**
- `portMessageQueue` variable
- `_flushPortMessageQueue()` function
- `_handleConnectionFailure()` function
- `sendWithAck()` function
- `PORT_QUEUE_MAX_SIZE` constant
- `QUEUE_TTL_MS` constant

**Removal order:**
1. Delete queue flushing function (`_flushPortMessageQueue`)
2. Delete connection failure handler (`_handleConnectionFailure`)
3. Delete `sendWithAck()` - replace all calls with `sendToBackground()`
4. Remove queue variable and constants
5. Remove queue management intervals

**Dependency warning:**
- `sendWithAck()` is called from multiple places - systematic replacement needed
- Queue management cleanup intervals still running - stop them
- Some error paths may assume queue exists - simplify error handling

---

### Background Script Port Handlers

**Pattern 1D: Port message listener in background**

**Pseudocode of what exists:**
```
browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'quick-tabs-sidebar') {
    setupPortHandler(port)
      ├─ Add message listener
      ├─ Add disconnect listener
      └─ Track connected ports
})

_handleSidebarPortMessage(message, sender, sendResponse)
  └─ Message came from sidebar via port
     ├─ Route to handler
     ├─ Get Quick Tab state
     ├─ Send response
     └─ Track latency
```

**Search patterns:**
- `browser.runtime.onConnect.addListener()`
- Port name `'quick-tabs-sidebar'`
- `setupPortHandler()` in background
- `_handleSidebarPortMessage()` function

**Removal order:**
1. Delete port message listener setup
2. Delete port handler functions
3. Keep `browser.runtime.onMessage.addListener()` (this is still needed for stateless messages)

---

## REMOVAL CATEGORY 2: COMPLEX INITIALIZATION LAYERS (400+ lines)

### Current State
Current implementation has multiple initialization phases with listeners, verification, and message queueing. Proposed simplifies to single barrier.

### What to Remove

#### Pattern 2A: Storage Listener Verification

**Pseudocode of what exists:**
```
_initializeStorageListener()
  └─ Complex verification with retries
     ├─ Write test key to storage
     ├─ Listen for onChanged event
     ├─ If event fires: listener works
     ├─ If timeout: retry with backoff
     └─ Try 3-4 times before giving up

_verifyStorageListenerWithRetry()
  └─ Retry logic with exponential backoff
     ├─ Try interval: 1s
     ├─ Try interval: 2s
     ├─ Try interval: 4s
     └─ Fallback to port-only mode

STORAGE_VERIFICATION_RETRY_MS = [1000, 2000, 4000]
```

**Search patterns:**
- `_initializeStorageListener()` function
- `_verifyStorageListenerWithRetry()` function
- `STORAGE_VERIFICATION_RETRY_MS` constant
- `LISTENER_REGISTRATION_TIMEOUT_MS` constant
- Storage verification test key writes
- Retry backoff logic

**Removal order:**
1. Delete verification functions
2. Remove retry constants
3. Remove test key writes (won't be needed)
4. Simplify initialization to just: add listener, load state, render

**Dependency warning:**
- Current code may have fallback mode that disables storage - remove that flag
- Logging may reference verification state - simplify log messages

---

#### Pattern 2B: Multi-Phase Initialization Tracking

**Pseudocode of what exists:**
```
State variables for tracking init phases:
- initializationStarted (boolean)
- initializationComplete (boolean)
- currentInitPhase (enum: BARRIER, VERIFICATION, HYDRATION, etc.)
- initPhaseStartTime (timestamp)
- initializationStartTime (timestamp)
- _isInitPhaseComplete (boolean)
- initialStateLoadComplete (boolean)

Phase detection code:
if (!initializationStarted) {
  queueMessage()
} else if (!initializationComplete) {
  handlePartialInit()
} else {
  processNormally()
}
```

**Search patterns:**
- `initializationStarted` variable
- `initializationComplete` variable
- `currentInitPhase` variable
- `_isInitPhaseComplete` variable
- `initialStateLoadComplete` variable
- Phase enum definitions
- Phase-based message queueing

**Removal order:**
1. Keep only: `initializationPromise`, `initializationResolve`, `initializationReject` (barrier pattern)
2. Delete all other init tracking variables
3. Simplify phase detection to just: `await initializationPromise`
4. Remove phase-specific message handling

**Dependency warning:**
- Listeners may check `initializationComplete` before processing - replace with barrier await
- Logging may emit phase names - update to simpler format
- Error paths may have phase-specific recovery - generalize them

---

#### Pattern 2C: Pre-Initialization Message Queue

**Pseudocode of what exists:**
```
preInitMessageQueue = []

if (!initializationComplete) {
  _queueMessageDuringInit({
    type: message.type,
    timestamp: Date.now(),
    correlationId: generateCorrelationId()
  })
} else {
  processMessage()
}

_processQueuedMessages()
  └─ After init complete
     ├─ Sort by timestamp
     ├─ Deduplicate
     ├─ Replay in order
     └─ Clear queue
```

**Search patterns:**
- `preInitMessageQueue` variable
- `_queueMessageDuringInit()` function
- `_processQueuedMessages()` function
- `_initPhaseMessageQueue` variable (alternative name)
- Queue size checks / capacity limits
- Message timestamp tracking

**Removal order:**
1. Delete queue variables
2. Delete queueing functions
3. Replace all pre-init queue paths with direct barrier await
4. Remove queue processing

**Dependency warning:**
- storage.onChanged listener may have complex queue logic - simplify it
- Message handlers may check queue status - remove those checks
- Logging may reference queue size - remove that instrumentation

---

#### Pattern 2D: Initialization Wait/Timeout Logic

**Pseudocode of what exists:**
```
initialLoadTimeoutId = null
stateLoadStartTime = 0

_createInitializationBarrier()
  └─ Promise + timeout guard
     ├─ setTimeout 10s
     ├─ If not resolved: force reject
     └─ Log timeout error

document.addEventListener('DOMContentLoaded', async () => {
  initialLoadTimeoutId = setTimeout(() => {
    // Wait 2 seconds before rendering empty state
    if (initialStateLoadComplete === false) {
      renderEmptyUI()
    }
  }, 2000)
})
```

**Search patterns:**
- `initialLoadTimeoutId` variable
- `stateLoadStartTime` variable
- `INIT_BARRIER_TIMEOUT_MS` constant
- Timeout setup in `DOMContentLoaded`
- Empty state render paths

**Removal order:**
1. Keep basic timeout in barrier (10s is reasonable)
2. Remove "2 second wait before empty render" logic - just render loaded state
3. Remove extra timeout tracking variables
4. Simplify to single barrier timeout

---

## REMOVAL CATEGORY 3: MULTI-LAYER DEDUPLICATION (250+ lines)

### Current State
Current has 4+ dedup layers: revision versioning, message ID tracking, checksum validation, and saveId checking. Proposed keeps only revision + checksum.

### What to Remove

#### Pattern 3A: Message ID Deduplication Map

**Pseudocode of what exists:**
```
recentlyProcessedMessageIds = new Set()
_messageIdTimestamps = new Map()

function _addProcessedMessageId(correlationId)
  └─ Track processed messages
     ├─ Set.add(correlationId)
     ├─ Map.set(correlationId, timestamp)
     └─ Schedule cleanup

function _hasProcessedMessageId(correlationId)
  └─ Check if already seen
     ├─ Return Set.has(correlationId)

function _cleanupExpiredMessageIds()
  └─ Every 5 seconds
     ├─ Iterate Map
     ├─ Remove old entries
     └─ Log cleanup stats

function _slidingWindowEviction()
  └─ When map hits 95% capacity
     ├─ Remove oldest 10%
     ├─ Log eviction
     └─ Track metrics

MESSAGE_ID_MAX_AGE_MS = 5000
MESSAGE_DEDUP_MAX_SIZE = 1000
```

**Search patterns:**
- `recentlyProcessedMessageIds` variable
- `_messageIdTimestamps` variable
- `_addProcessedMessageId()` function
- `_hasProcessedMessageId()` function
- `_cleanupExpiredMessageIds()` function
- `_slidingWindowEviction()` function
- `MESSAGE_ID_MAX_AGE_MS` constant
- `MESSAGE_DEDUP_MAX_SIZE` constant
- Dedup map size logging
- Correlation ID checking before processing

**Removal order:**
1. Delete dedup map variables
2. Delete cleanup functions
3. Delete eviction logic
4. Remove dedup checks from message handlers
5. Remove dedup-related constants

**Dependency warning:**
- Message handlers use `_hasProcessedMessageId()` - remove those checks
- Logging may show dedup map stats - remove that instrumentation
- Cleanup interval still running - stop it

---

#### Pattern 3B: Revision Event Buffering

**Pseudocode of what exists:**
```
_lastAppliedRevision = 0
_revisionEventBuffer = []

_validateRevision(newRevision)
  └─ Check if revision is newer
     ├─ If stale: return false
     ├─ If newer: buffer it
     └─ Return true

_bufferRevisionEvent(event, revision)
  └─ Store out-of-order event
     ├─ Push to buffer
     ├─ Sort buffer by revision
     └─ Check size limits

_processBufferedRevisionEvents()
  └─ After new event arrives
     ├─ Check if buffer ready to process
     ├─ Process in order
     ├─ Update _lastAppliedRevision
     └─ Clear buffer entries

_cleanupRevisionBuffer()
  └─ Every 10 seconds
     ├─ Remove old events
     ├─ Compact buffer
     └─ Log cleanup

REVISION_BUFFER_MAX_AGE_MS = 5000
REVISION_BUFFER_MAX_SIZE = 50
```

**Search patterns:**
- `_lastAppliedRevision` variable
- `_revisionEventBuffer` variable
- `_validateRevision()` function
- `_bufferRevisionEvent()` function
- `_processBufferedRevisionEvents()` function
- `_cleanupRevisionBuffer()` function
- `REVISION_BUFFER_MAX_AGE_MS` constant
- `REVISION_BUFFER_MAX_SIZE` constant
- Buffer sorting/processing logic
- Revision validation logic

**Removal order:**
1. **KEEP** revision validation (check `if (revision <= lastRevision) return`)
2. Delete buffer variables
3. Delete buffer processing functions
4. Delete buffer cleanup
5. Simplify to: simple revision check, no buffering
6. Remove buffer-related constants

**Why keep revision validation:**
- Revision ordering is core to dedup strategy
- Just reject stale revisions, don't buffer

---

#### Pattern 3C: SaveId Deduplication

**Pseudocode of what exists:**
```
globalState.saveId = null

function _persistToStorage()
  ├─ Increment saveId
  ├─ Include saveId in storage write
  └─ Track saveId for dedup

_handleStorageChangedEvent(changes)
  ├─ Check if saveId matches
  ├─ If already seen: return
  └─ Process new saveId

SAVEID_RECONCILED = 'reconciled'
SAVEID_CLEARED = 'cleared'
```

**Search patterns:**
- `saveId` variable in state
- SaveId increment/tracking
- SaveId checks in storage handlers
- `SAVEID_RECONCILED` constant
- `SAVEID_CLEARED` constant

**Removal order:**
1. Keep saveId in stored state (for potential future use)
2. Remove saveId checks from `_handleStorageChangedEvent`
3. Remove saveId comparison logic
4. Remove saveId constants
5. Keep saveId writes but don't use for dedup

**Why keep saveId writes:**
- Minimal overhead (just an incrementing number)
- May be useful for diagnostics
- Removing would require storage schema change

---

#### Pattern 3D: Checksum Validation Complexity

**Pseudocode of what exists:**
```
function _computeStateChecksum(tabs)
  └─ Generate hash of state
     ├─ Map each tab to signature string
     ├─ Sort signatures
     ├─ Compute hash
     └─ Return as string

_validateRenderIntegrity()
  └─ Before AND after render
     ├─ Compute checksum before
     ├─ Render DOM
     ├─ Compute checksum after
     ├─ Compare checksums
     └─ If mismatch: trigger recovery

_triggerRenderCorruptionRecovery()
  └─ On corruption detected
     ├─ Log error with context
     ├─ Request full state refresh
     ├─ Clear render queue
     └─ Retry render
```

**Search patterns:**
- `_computeStateChecksum()` function
- `_validateRenderIntegrity()` function
- `_triggerRenderCorruptionRecovery()` function
- Checksum computation logic
- Before/after render validation
- Corruption recovery attempts

**Removal order:**
1. **KEEP** `_computeStateChecksum()` for storage event validation
2. **KEEP** checksum check in `_handleStorageChangedEvent()`
3. Delete render integrity validation (check before render only)
4. Delete corruption recovery complexity (just log and fallback to fresh state)
5. Simplify recovery to: request fresh state, don't try multiple retries

**Why keep storage checksums:**
- Detects corrupted storage writes
- Essential for data integrity
- Minimal overhead

**Why remove render checksums:**
- Render errors are less critical (UI visual glitch, not data loss)
- Too invasive (checking before AND after)
- Recovery is just "refresh state anyway"

---

## REMOVAL CATEGORY 4: STORAGE VERIFICATION & RETRY (200+ lines)

### Current State
Complex retry logic with quota monitoring, exponential backoff, multiple fallback tiers.

### What to Remove

#### Pattern 4A: Storage Listener Health Probes

**Pseudocode of what exists:**
```
_lastStorageEventTime = Date.now()

_canStartProbe()
  └─ Check min interval between probes
     ├─ If last probe < 500ms ago: return false
     ├─ Else: return true

_startStorageProbe()
  └─ Write test key to storage
     ├─ Record timestamp
     ├─ Set flag: _probeInProgress

_completeStorageProbe()
  └─ Called when storage.onChanged fires
     ├─ Clear _probeInProgress flag
     ├─ Calculate latency
     ├─ Record in metrics

_checkStorageHealth()
  └─ Every 5 seconds
     ├─ If no recent events: start probe
     ├─ If probe running > 1000ms: force-reset
     └─ Log health status

PROBE_MIN_INTERVAL_MS = 500
PROBE_FORCE_RESET_MS = 1000
```

**Search patterns:**
- `_lastStorageEventTime` variable
- `_probeInProgress` flag
- `_canStartProbe()` function
- `_startStorageProbe()` function
- `_completeStorageProbe()` function
- `_checkStorageHealth()` function
- `PROBE_MIN_INTERVAL_MS` constant
- `PROBE_FORCE_RESET_MS` constant
- Probe latency tracking
- Health check interval (5s)

**Removal order:**
1. Delete probe functions
2. Delete probe-related state variables
3. Remove probe constants
4. Delete health check interval
5. Keep simple: if no storage event for 5s, request state via message

**Simplification:**
Replace complex probes with simpler fallback:
```
if (timeSinceLastStorageEvent > 5000) {
  sendMessageToBackground(GET_QUICK_TABS_STATE)
}
```

---

#### Pattern 4B: Storage Quota Monitoring

**Pseudocode of what exists:**
```
storageQuotaStats = {
  lastCheckTime: 0,
  estimatedUsageBytes: 0,
  quotaBytes: 0,
  checkInterval: 5 * 60 * 1000  // Every 5 min
}

_monitorStorageQuota()
  └─ Every 5 minutes
     ├─ Get storage estimate
     ├─ Calculate percentage
     ├─ If 50%: log warning
     ├─ If 75%: log warning
     ├─ If 90%: trigger cleanup

_handleStorageQuotaExceeded()
  └─ When quota hit
     ├─ Delete old Quick Tabs
     ├─ Retry write
     ├─ Log cleanup details
     └─ Notify user if needed
```

**Search patterns:**
- `storageQuotaStats` variable
- `_monitorStorageQuota()` function
- `_handleStorageQuotaExceeded()` function
- Quota check intervals
- Percentage threshold constants (50%, 75%, 90%)
- Cleanup logic based on quota

**Removal order:**
1. Delete quota monitoring function
2. Delete quota stats object
3. Remove quota check interval
4. Keep simple: on write error, try once more, then log error

**Why simplify:**
- With only core Quick Tab state, quota is unlikely to be exceeded
- If quota is exceeded, cleanup strategy is complex
- Simpler: just log error, user can clear data

---

#### Pattern 4C: Write Retry with Exponential Backoff

**Pseudocode of what exists:**
```
async function _persistToStorage()
  └─ Main persistence with retries
     ├─ Try write once
     ├─ If error: call _handleStorageWriteFailure
     └─ Return result

_handleStorageWriteFailure(error)
  └─ Complex error handling
     ├─ Classify error type
     ├─ If quota: trigger cleanup
     ├─ If timeout: retry 3x with backoff
     ├─ If corrupted: attempt recovery
     └─ Log with context

_performWriteAttempt(attempt)
  └─ Single write attempt
     ├─ If attempt 1: 100ms backoff
     ├─ If attempt 2: 200ms backoff
     ├─ If attempt 3: 400ms backoff
     └─ Give up after 3

async function _retryWithBackoff(fn, attempts)
  └─ Generic retry wrapper
     ├─ Try up to N times
     ├─ Exponential backoff
     └─ Throw after final attempt
```

**Search patterns:**
- `_persistToStorage()` error handling section
- `_handleStorageWriteFailure()` function
- `_performWriteAttempt()` function
- `_retryWithBackoff()` function
- Backoff constant arrays
- Error classification logic
- Retry attempt tracking

**Removal order:**
1. **KEEP** basic `_persistToStorage()` try/catch
2. **KEEP** write validation (read-back checksum)
3. Delete complex error classification
4. Delete retry logic (write once, fail loudly if error)
5. Delete exponential backoff
6. Keep simple logging

**Simplification:**
```javascript
async function _persistToStorage() {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: stateToWrite })
    
    // Validate
    const readBack = await browser.storage.local.get(STORAGE_KEY)
    if (!readBack[STORAGE_KEY] || readBack[STORAGE_KEY].checksum !== stateToWrite.checksum) {
      throw new Error('Checksum mismatch')
    }
  } catch (err) {
    console.error('[Background] Storage write failed:', err)
    // Let sidebar detect via health check fallback
  }
}
```

---

## REMOVAL CATEGORY 5: RENDER QUEUE COMPLEXITY (150+ lines)

### Current State
Render queue has stall detection, corruption recovery, complex state tracking.

### What to Remove

#### Pattern 5A: Render Stall Detection

**Pseudocode of what exists:**
```
_renderStallTimerId = null

function _startRenderStallTimer()
  └─ When render starts
     ├─ Set timeout: 5 seconds
     ├─ If not cleared: consider stalled
     └─ Trigger recovery

function _clearRenderStallTimer()
  └─ When render completes
     ├─ clearTimeout()

_handleRenderStall()
  └─ Render took >5s
     ├─ Log error
     ├─ Request full state
     ├─ Clear queue
     └─ Retry

RENDER_STALL_TIMEOUT_MS = 5000
```

**Search patterns:**
- `_renderStallTimerId` variable
- `_startRenderStallTimer()` function
- `_clearRenderStallTimer()` function
- `_handleRenderStall()` function
- `RENDER_STALL_TIMEOUT_MS` constant
- Stall recovery logic

**Removal order:**
1. Delete stall timer variables
2. Delete stall detection functions
3. Delete stall recovery logic
4. Remove stall constant
5. Keep basic render timeout for safety (just log error)

**Why simplify:**
- DOM rendering on 100+ items shouldn't take 5s unless browser is broken
- If it does, just log it; forcing recovery is complex
- Better to monitor in testing, not production

---

#### Pattern 5B: Render Corruption Validation

**Pseudocode of what exists:**
```
_renderInProgress = false

async function _executeQueuedRender()
  └─ Execute single render
     ├─ Call _validateRenderIntegrity()
     ├─ Render DOM
     ├─ Call _validateRenderIntegrity()
     ├─ If corruption: trigger recovery
     └─ Return result

_validateRenderIntegrity()
  └─ Check state before/after
     ├─ Compute checksum
     ├─ Compare to expected
     ├─ If mismatch: log error
     └─ Return validation result

_triggerRenderCorruptionRecovery()
  └─ On corruption detected
     ├─ Request fresh state
     ├─ Clear render queue
     ├─ Attempt re-render
     └─ Track recovery attempts
```

**Search patterns:**
- `_validateRenderIntegrity()` function
- `_triggerRenderCorruptionRecovery()` function
- `_executeQueuedRender()` function
- Render validation logic
- Corruption recovery attempts
- Recovery attempt tracking

**Removal order:**
1. Delete `_validateRenderIntegrity()` before/after validation
2. Keep basic try/catch in render
3. Delete recovery attempt logic
4. Simplify recovery to: just request fresh state, don't retry

**Why simplify:**
- Before/after validation is expensive
- Render errors are UI issues, not data issues
- Simple recovery: if render fails, get fresh state next

---

#### Pattern 5C: Render Queue Limits

**Pseudocode of what exists:**
```
_renderQueue = []

function scheduleRender(source, revision)
  └─ Before queueing
     ├─ Check queue size
     ├─ If >= 10: drop oldest
     ├─ Log queue capacity
     └─ Add to queue

RENDER_QUEUE_MAX_SIZE = 10
RENDER_QUEUE_DEBOUNCE_MS = 100
RENDER_RECOVERY_DELAY_MS = 50
```

**Search patterns:**
- Queue size checks before adding
- `RENDER_QUEUE_MAX_SIZE` constant
- Queue capacity logging
- Drop oldest queue entry logic

**Removal order:**
1. Remove queue size checks
2. Keep debounce constant (100ms is good)
3. Remove recovery delay constant (not used in simplified version)
4. Keep queue as-is (small enough that size limit unnecessary)

**Why simplify:**
- Queue should rarely have >3 items in practice
- Size check adds complexity for minimal benefit
- If queue grows, that's a symptom to investigate, not handle

---

## REMOVAL CATEGORIES SUMMARY TABLE

| Category | Lines | Functions | Constants | Variables |
|----------|-------|-----------|-----------|-----------|
| 1. Port Messaging | 300+ | 12+ | 10+ | 8+ |
| 2. Initialization | 400+ | 8+ | 6+ | 12+ |
| 3. Deduplication | 250+ | 15+ | 8+ | 8+ |
| 4. Storage Retry | 200+ | 8+ | 4+ | 3+ |
| 5. Render Stall | 150+ | 6+ | 2+ | 2+ |
| **TOTAL** | **1300+** | **49+** | **30+** | **33+** |

---

## SAFE DELETION CHECKLIST

### Before Deleting Any Code

- [ ] **Search for all references** - Use GitHub code search to find every call site
- [ ] **Identify dependents** - What functions call this function?
- [ ] **Plan replacement** - What will replace this code?
- [ ] **Check logging** - Are there log messages that reference this code?
- [ ] **Review error paths** - Do error handlers assume this exists?
- [ ] **Update docs** - Does architecture doc need updates?

### Deletion Order (Recommended)

**Phase 1 - Safe deletions (no dependents):**
1. Port verification functions (nothing depends on them)
2. Dedup cleanup functions (just remove interval)
3. Storage probes (nothing else calls them)
4. Quota monitoring (standalone)

**Phase 2 - Deletions with replacement:**
1. Message ID dedup (remove all dedup checks)
2. Revision buffering (keep validation, remove buffer)
3. Heartbeat (replace with message timeout)
4. Port handlers (move logic to storage.onChanged)

**Phase 3 - Major refactoring:**
1. Port connection (replace all sendWithAck with sendToBackground)
2. Initialization phases (simplify to barrier)
3. Pre-init queue (replace with barrier await)

**Phase 4 - Cleanup:**
1. Render stall detection (simplify render try/catch)
2. Corruption recovery (keep validation, simplify recovery)
3. Unused constants (clean up all removed constants)

---

## COMMON PITFALLS TO AVOID

### Pitfall 1: Incomplete Reference Cleanup
**Problem:** Delete a function but forget to remove all calls to it
**Prevention:** Use GitHub code search with regex `functionName\(`
**Check:** Run linter to find undefined function references

### Pitfall 2: State Variable Orphans
**Problem:** Delete a function that sets a variable, but other code still reads it
**Prevention:** Track all usages of state variables before deleting
**Example:** Delete `_startHeartbeat()` but forget `lastHeartbeatResponse` is used elsewhere

### Pitfall 3: Constant Dependencies
**Problem:** Delete a constant but other code still references it
**Prevention:** Search for constant name in all files
**Example:** Delete `MESSAGE_ID_MAX_AGE_MS` but cleanup still uses it

### Pitfall 4: Async/Promise Chain Breaks
**Problem:** Delete await/promise that breaks async chains
**Prevention:** Review all async contexts before deletion
**Example:** Delete `await _verifyListener()` but promise chain still expects it

### Pitfall 5: Fallback Path Removal
**Problem:** Delete fallback code that's still needed
**Prevention:** Understand ALL code paths before deletion
**Example:** Delete fallback to port, but storage.onChanged is broken

---

## VALIDATION STRATEGY

After deletions, verify:

```
1. No undefined function errors in console
2. No orphaned variable references
3. Linter passes with 0 errors
4. Basic Quick Tab create/update/delete works
5. Sidebar renders with 10+ tabs
6. No stale intervals/timers running
7. All error logs are meaningful
```

---

## REFERENCES

- Architecture specification: See main document sections on Components
- Current code: `sidebar/quick-tabs-manager.js`, `background.js`, `sidebar/modules/`
- Related issues: Port disconnection (v1.6.3.8-v13), initialization race (v1.6.3.8-v4)

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial removal guide created for migration to simplified architecture

