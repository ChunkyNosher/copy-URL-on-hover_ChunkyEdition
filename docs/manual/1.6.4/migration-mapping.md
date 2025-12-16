# Migration Mapping Document

**Document Purpose:** Show side-by-side comparison of old vs. new code patterns  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Important - Use as reference for understanding transformations  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document maps current implementation patterns to proposed simplified patterns. Each section shows:
- **Old Pattern:** How it works now (pseudocode)
- **Problem:** Why it's complex
- **New Pattern:** Simplified version
- **Migration:** How to transform the code

---

## PATTERN 1: INITIALIZATION

### Old Pattern (Current)

```javascript
// Multiple phases with verification
initializationStarted = false;
initializationComplete = false;
currentInitPhase = 'BARRIER';

_initializeStorageListener()
  └─ Write test key
  ├─ Wait for onChanged event
  ├─ Timeout? → retry with backoff
  └─ Phase: VERIFICATION

_verifyStorageListenerWithRetry()
  └─ Try 1: 1000ms backoff
  ├─ Try 2: 2000ms backoff
  ├─ Try 3: 4000ms backoff
  └─ Give up → fallback to port-only

Phase transition:
  BARRIER → VERIFICATION → HYDRATION → READY
  (with guards at each phase)

Message queueing:
  if (currentInitPhase < HYDRATION) {
    queue message
  } else {
    process immediately
  }

Total: ~400 lines of code
```

**Problems:**
- 4 initialization phases create complex state machine
- Verification with retries adds 150+ lines
- Phase guards in 10+ listener functions
- Message queue replay logic adds complexity
- Can take 4+ seconds if listener verification fails
- Multiple edge cases and race conditions

### New Pattern (Proposed)

```javascript
// Single barrier with promise
let initializationPromise = null;
let initializationResolve = null;

function _createInitializationBarrier() {
  initializationPromise = new Promise((resolve, reject) => {
    initializationResolve = resolve;
    initializationReject = reject;
  });
  
  setTimeout(() => {
    if (!initializationResolve) return;
    initializationReject(new Error('Init timeout'));
  }, 10000);
}

// Queue messages during init
const _initPhaseMessageQueue = [];
let _isInitPhaseComplete = false;

browser.storage.onChanged.addListener((changes, areaName) => {
  if (!_isInitPhaseComplete) {
    _initPhaseMessageQueue.push({ changes, timestamp: Date.now() });
    return;
  }
  _handleStorageChangedEvent(changes);
});

// Wait for initialization
await initializationPromise;

Total: ~80 lines of code
```

**Improvements:**
- Single barrier promise (no state machine)
- No listener verification (just trust it works)
- Simple message queue (just array push)
- Completes in <100ms (no retries)
- Clear error path if init fails

### Migration Steps

**Step 1: Add barrier variables**
```javascript
let initializationPromise = null;
let initializationResolve = null;
let initializationReject = null;
const _initPhaseMessageQueue = [];
let _isInitPhaseComplete = false;
```

**Step 2: Create barrier function**
```javascript
function _createInitializationBarrier() {
  initializationPromise = new Promise((resolve, reject) => {
    initializationResolve = resolve;
    initializationReject = reject;
  });
  
  setTimeout(() => {
    if (!initializationResolve) return;
    initializationReject(new Error('Initialization timeout'));
  }, 10000);
}
```

**Step 3: Update storage listener**
```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  
  if (!_isInitPhaseComplete) {
    _initPhaseMessageQueue.push({ changes, timestamp: Date.now() });
    return;
  }
  
  _handleStorageChangedEvent(changes);
});
```

**Step 4: Simplify DOMContentLoaded**
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  _createInitializationBarrier();
  
  try {
    const initialState = await browser.runtime.sendMessage({
      action: 'GET_QUICK_TABS_STATE'
    });
    
    sidebarLocalState = {
      tabs: initialState.tabs.slice(),
      lastModified: initialState.lastModified,
      revisionReceived: 0
    };
    
    _isInitPhaseComplete = true;
    initializationResolve();
    
    renderQuickTabsList(sidebarLocalState.tabs);
    _processInitPhaseMessageQueue();
  } catch (err) {
    console.error('[Manager] Init failed:', err);
    initializationReject(err);
  }
});
```

**Step 5: Delete old pattern**
- Delete `_initializeStorageListener()`
- Delete `_verifyStorageListenerWithRetry()`
- Delete all phase tracking variables
- Delete `_queueMessageDuringInit()`
- Delete `_processQueuedMessages()`
- Delete phase-based message guards

---

## PATTERN 2: STATE SYNCHRONIZATION

### Old Pattern (Current)

```javascript
// Complex sync with multiple layers
browser.storage.onChanged.addListener((changes, areaName) => {
  // Layer 1: Area check
  if (areaName !== 'local') return;
  
  // Layer 2: Message ID dedup
  if (_hasProcessedMessageId(correlationId)) return;
  _addProcessedMessageId(correlationId);
  
  // Layer 3: Revision buffering
  if (!_validateRevision(newState.revision)) {
    _bufferRevisionEvent(event);
    return;
  }
  _processBufferedRevisionEvents();
  
  // Layer 4: Checksum validation
  if (computedChecksum !== newState.checksum) {
    _triggerCorruptionRecovery();
    return;
  }
  
  // Layer 5: Age check
  if (event.age > 5 minutes) return;
  
  // Finally: render
  scheduleRender();
});

Dedup management:
  _cleanupExpiredMessageIds() → runs every 5s
  _slidingWindowEviction() → on 95% capacity
  MESSAGE_DEDUP_MAX_SIZE = 1000

Total: ~250 lines of code
```

**Problems:**
- 5 validation layers create deep nesting
- Message ID dedup with 2 maps + cleanup interval
- Revision buffering with sorting/processing
- Buffer cleanup every 10 seconds
- Checksum computation + validation
- Age checks add minimal value
- Multiple edge cases at each layer

### New Pattern (Proposed)

```javascript
async function _handleStorageChangedEvent(changes) {
  const stateChange = changes['quick_tabs_state_v2'];
  if (!stateChange) return;
  
  const newState = stateChange.newValue;
  
  // Guard 1: Structure validation
  if (!newState || !Array.isArray(newState.tabs)) {
    console.warn('[Manager] Invalid state structure');
    return;
  }
  
  // Guard 2: Revision ordering
  if (newState.revision <= sidebarLocalState.revisionReceived) {
    console.log('[Manager] Ignoring stale revision');
    return;
  }
  
  // Guard 3: Corruption detection
  const expectedChecksum = _computeStateChecksum(newState.tabs);
  if (newState.checksum !== expectedChecksum) {
    console.error('[Manager] Checksum mismatch');
    _requestStateRepair();
    return;
  }
  
  // Guard 4: Age check
  if (Date.now() - newState.lastModified > 300000) {
    console.warn('[Manager] Event too old');
    return;
  }
  
  // Update and render
  sidebarLocalState = {
    tabs: newState.tabs.slice(),
    lastModified: newState.lastModified,
    revisionReceived: newState.revision,
    writeSequence: newState.writeSequence
  };
  
  scheduleRender('storage-event', newState.revision);
}

Total: ~60 lines of code
```

**Improvements:**
- 4 simple sequential guards (no nesting)
- No message ID dedup (revision handles ordering)
- No buffering (just reject stale events)
- Checksum validation kept (essential for integrity)
- Age check kept (low overhead)
- Clear, linear logic flow

### Migration Steps

**Step 1: Remove message ID dedup**
```javascript
// DELETE:
recentlyProcessedMessageIds = new Set();
_messageIdTimestamps = new Map();
_addProcessedMessageId(id);
_hasProcessedMessageId(id);
_cleanupExpiredMessageIds();
_slidingWindowEviction();

// REMOVE from listener:
if (_hasProcessedMessageId(msg.correlationId)) return;
```

**Step 2: Remove revision buffer**
```javascript
// DELETE:
_revisionEventBuffer = [];
_bufferRevisionEvent(event);
_processBufferedRevisionEvents();
_cleanupRevisionBuffer();

// REPLACE with simple check:
if (newState.revision <= sidebarLocalState.revisionReceived) {
  return; // Reject stale
}
```

**Step 3: Simplify storage listener**
```javascript
// REPLACE complex listener with simple version (see New Pattern above)
```

**Step 4: Remove phase/queue checks**
```javascript
// REMOVE:
if (!_isInitPhaseComplete) {
  _queueMessageDuringInit(change);
  return;
}

// These are now handled by initialization barrier
```

**Step 5: Delete cleanup intervals**
```javascript
// DELETE:
setInterval(_cleanupExpiredMessageIds, 5000);
setInterval(_cleanupRevisionBuffer, 10000);
setInterval(_logDedupMapSize, 60000);
```

---

## PATTERN 3: RENDER QUEUE

### Old Pattern (Current)

```javascript
// Complex queue with stall detection
_renderQueue = [];
_renderInProgress = false;
_renderStallTimerId = null;

function scheduleRender(source, revision) {
  // Queue size check
  if (_renderQueue.length >= RENDER_QUEUE_MAX_SIZE) {
    _renderQueue = _renderQueue.slice(-5);  // Keep only last 5
  }
  
  // Dedup by multiple methods
  if (revision === _lastRenderedRevision) return;
  if (_hasProcessedRevision(revision)) return;
  
  // Check for capacity
  if (_renderQueue.length > 10) {
    console.warn('Render queue full');
  }
  
  clearTimeout(_renderDebounceTimer);
  _renderQueue.push({ source, revision, timestamp });
  
  _renderDebounceTimer = setTimeout(() => {
    _processRenderQueue();
  }, RENDER_QUEUE_DEBOUNCE_MS);
}

async function _processRenderQueue() {
  if (_renderInProgress) return;
  _renderInProgress = true;
  _startRenderStallTimer();  // 5 second timeout
  
  try {
    const latestRender = _renderQueue[_renderQueue.length - 1];
    
    // Validation before render
    _validateRenderIntegrity();
    
    // Render
    _renderQuickTabsWithReconciliation(tabs);
    
    // Validation after render
    _validateRenderIntegrity();
    
    // Handle corruption
    if (corruption detected) {
      _triggerRenderCorruptionRecovery();
      return;
    }
    
    sidebarLocalState.lastRenderedRevision = latestRender.revision;
  } catch (err) {
    // Complex error handling
    _handleRenderError(err);
  } finally {
    _clearRenderStallTimer();
    _renderInProgress = false;
    _renderQueue.length = 0;
  }
}

_handleRenderStall()
  └─ Render took >5s
     ├─ Request fresh state
     ├─ Clear queue
     └─ Retry render

Total: ~150 lines of code
```

**Problems:**
- Stall detection with 5s timeout
- Before/after corruption validation (expensive)
- Corruption recovery attempts
- Queue size management
- Dedup by multiple methods
- Complex error handling

### New Pattern (Proposed)

```javascript
let _renderInProgress = false;
const _renderQueue = [];
let _renderDebounceTimer = null;

function scheduleRender(source, revision) {
  // Simple dedup: don't schedule if just rendered
  if (revision === sidebarLocalState.lastRenderedRevision) {
    return;
  }
  
  clearTimeout(_renderDebounceTimer);
  
  // Enqueue
  _renderQueue.push({
    source,
    revision,
    timestamp: Date.now()
  });
  
  // Debounce: wait 100ms before processing
  _renderDebounceTimer = setTimeout(() => {
    _processRenderQueue();
  }, 100);
}

async function _processRenderQueue() {
  if (_renderInProgress || _renderQueue.length === 0) return;
  
  _renderInProgress = true;
  
  try {
    // Get latest state (may have multiple queued renders)
    const latestRender = _renderQueue[_renderQueue.length - 1];
    
    // Render with DOM reconciliation
    _renderQuickTabsWithReconciliation(sidebarLocalState.tabs);
    
    sidebarLocalState.lastRenderedRevision = latestRender.revision;
  } catch (err) {
    console.error('[Manager] Render error:', err);
    // Even on error, clear queue to avoid infinite loop
  } finally {
    _renderInProgress = false;
    _renderQueue.length = 0;
    
    // If new renders queued during processing, schedule next batch
    if (_renderQueue.length > 0) {
      scheduleRender(_renderQueue[0].source, _renderQueue[0].revision);
    }
  }
}

Total: ~60 lines of code
```

**Improvements:**
- No stall detection (simple try/catch)
- No before/after validation (just render)
- No recovery attempts (just log error)
- No queue size management (rarely exceeds 2-3 items)
- Simple dedup by revision
- Clean error handling

### Migration Steps

**Step 1: Remove stall detection**
```javascript
// DELETE:
_renderStallTimerId = null;
_startRenderStallTimer();
_clearRenderStallTimer();
_handleRenderStall();
RENDER_STALL_TIMEOUT_MS = 5000;
```

**Step 2: Simplify scheduleRender()**
```javascript
// REPLACE complex function with simple version (see New Pattern above)
```

**Step 3: Simplify _processRenderQueue()**
```javascript
// DELETE:
_validateRenderIntegrity() before render
_validateRenderIntegrity() after render
_triggerRenderCorruptionRecovery()
Complex error handling with recovery

// KEEP:
Basic try/catch
Queue clearing
Simple logging
```

**Step 4: Remove validation functions**
```javascript
// DELETE:
_validateRenderIntegrity()
_triggerRenderCorruptionRecovery()
Recovery attempt logic
```

**Step 5: Delete constants**
```javascript
// DELETE:
RENDER_STALL_TIMEOUT_MS
RENDER_QUEUE_MAX_SIZE
RENDER_RECOVERY_DELAY_MS
```

---

## PATTERN 4: MESSAGE HANDLING

### Old Pattern (Current)

```javascript
// Multiple message paths with different handling
sendWithAck(message)
  └─ If connected
     ├─ Use port (with heartbeat tracking)
     └─ Expect acknowledgment with latency measurement
  └─ If disconnected
     ├─ Queue message
     ├─ Attempt reconnect
     └─ Retry on failure

Port path:
  runtime.Port
    ├─ onMessage listener
    ├─ onDisconnect listener
    ├─ Message queue
    ├─ Heartbeat every 30s
    └─ Reconnect on failure

Fallback path:
  storage.onChanged
    └─ Secondary sync mechanism

runtime.sendMessage path:
  └─ For operation acks only

Total: ~300 lines of code
```

**Problems:**
- Multiple message paths create conditional logic
- Port lifecycle management (connect/disconnect/reconnect)
- Heartbeat mechanism adds complexity
- Message queue replay logic
- Fallback between port and storage
- 3+ layers of retry/backoff logic

### New Pattern (Proposed)

```javascript
// Single message path: stateless runtime.sendMessage
async function sendMessageToBackground(message) {
  try {
    return await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 3000)
      )
    ]);
  } catch (err) {
    if (err.message === 'Timeout') {
      console.warn('[Sidebar] Message timeout:', message.action);
      // Sidebar continues using storage.onChanged for state
    }
    throw err;
  }
}

// Primary sync: storage.onChanged listener
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  _handleStorageChangedEvent(changes);
});

// Fallback: if storage stops firing, request state
async function _checkStorageHealth() {
  const age = Date.now() - _lastStorageEventTime;
  
  if (age > 5000) {
    const state = await sendMessageToBackground({
      action: 'GET_QUICK_TABS_STATE'
    });
    _handleStorageChangedEvent({
      'quick_tabs_state_v2': { newValue: state }
    });
  }
}

Total: ~80 lines of code
```

**Improvements:**
- Single message path (stateless)
- No connection state tracking
- No heartbeat mechanism
- Simple timeout (3 seconds)
- Storage events as primary sync
- Message as fallback only

### Migration Steps

**Step 1: Replace sendWithAck()**
```javascript
// DELETE:
sendWithAck()
_handlePortMessageWithQueue()
_flushPortMessageQueue()
portMessageQueue
QUEUE_TTL_MS
PORT_QUEUE_MAX_SIZE

// REPLACE with:
async function sendMessageToBackground(message) {
  try {
    return await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 3000)
      )
    ]);
  } catch (err) {
    if (err.message === 'Timeout') {
      console.warn('[Sidebar] Message timeout');
    }
    throw err;
  }
}
```

**Step 2: Remove port connection**
```javascript
// DELETE:
connectToBackground()
_establishPortConnection()
_setupPortListeners()
_handlePortDisconnect()
backgroundPort variable
Port connection state
Port lifecycle logic
```

**Step 3: Remove heartbeat**
```javascript
// DELETE:
startHeartbeat()
stopHeartbeat()
sendHeartbeat()
heartbeatTimer
consecutiveHeartbeatFailures
lastHeartbeatResponse
HEARTBEAT_INTERVAL_MS
Heartbeat failure logic
```

**Step 4: Simplify health check**
```javascript
// OLD: Complex probe with retries
_checkStorageHealth()
  └─ Write test key
  ├─ Wait for onChanged
  └─ Retry with backoff

// NEW: Simple fallback
async function _checkStorageHealth() {
  const age = Date.now() - _lastStorageEventTime;
  if (age > 5000) {
    const state = await sendMessageToBackground({
      action: 'GET_QUICK_TABS_STATE'
    });
    _handleStorageChangedEvent({
      'quick_tabs_state_v2': { newValue: state }
    });
  }
}
```

---

## PATTERN 5: STORAGE PERSISTENCE

### Old Pattern (Current)

```javascript
// Complex retry and recovery
async function _persistToStorage() {
  let attempt = 0;
  while (attempt < 3) {
    try {
      await browser.storage.local.set({ stateToWrite });
      
      // Verify write
      const readBack = await browser.storage.local.get(key);
      if (!_validateReadback(readBack)) {
        attempt++;
        await _backoffDelay(attempt);
        continue;
      }
      
      // Success
      break;
    } catch (err) {
      attempt++;
      
      if (err.name === 'QuotaExceededError') {
        _handleStorageQuotaExceeded();
      } else if (err.name === 'TimeoutError') {
        await _backoffDelay(attempt);
      } else {
        _classifyError(err);
        _handleErrorByType(err.type);
      }
    }
  }
}

Error handling:
  ├─ Error classification (5+ types)
  ├─ Quota exceeded → cleanup old tabs
  ├─ Timeout → exponential backoff
  ├─ Corruption → recovery attempts
  └─ Unknown → complex fallback logic

Quota monitoring:
  _monitorStorageQuota()
    └─ Every 5 minutes
       ├─ Check usage %
       ├─ If 50%: warn
       ├─ If 75%: warn
       ├─ If 90%: cleanup

Total: ~200 lines of code
```

**Problems:**
- Retry loop with 3 attempts
- Exponential backoff logic
- Error classification with 5+ types
- Quota monitoring every 5 minutes
- Complex recovery for each error type
- Cleanup strategies for quota

### New Pattern (Proposed)

```javascript
async function _persistToStorage() {
  const stateToWrite = {
    tabs: globalQuickTabState.tabs,
    lastModified: Date.now(),
    writeSequence: _storageWriteSequence,
    revision: _storageRevision,
    checksum: _computeStateChecksum(globalQuickTabState.tabs)
  };
  
  try {
    // Write to primary storage
    await browser.storage.local.set({
      'quick_tabs_state_v2': stateToWrite
    });
    
    // Write to backup (non-blocking)
    browser.storage.sync.set({
      'quick_tabs_backup_v1': {
        tabs: stateToWrite.tabs,
        lastModified: stateToWrite.lastModified,
        checksum: stateToWrite.checksum
      }
    }).catch(err => {
      console.warn('[Background] Sync backup failed:', err);
    });
    
    // Validate write-back
    const readBack = await browser.storage.local.get('quick_tabs_state_v2');
    if (!readBack['quick_tabs_state_v2'] || 
        readBack['quick_tabs_state_v2'].checksum !== stateToWrite.checksum) {
      console.error('[Background] WRITE VALIDATION FAILED');
      _triggerCorruptionRecovery();
    }
  } catch (err) {
    console.error('[Background] Storage write error:', err);
    // Let sidebar detect via health check fallback
  }
}

Total: ~40 lines of code
```

**Improvements:**
- Write once, fail loudly (no retry)
- Keep simple try/catch
- Validation with checksum
- Non-blocking backup write
- No quota monitoring
- No error classification
- Clear error logging

### Migration Steps

**Step 1: Remove retry logic**
```javascript
// DELETE:
Retry loop (while attempt < 3)
_backoffDelay() function
Exponential backoff constants
Retry attempt tracking
```

**Step 2: Remove error classification**
```javascript
// DELETE:
_handleStorageWriteFailure()
_classifyErrorType()
_handleErrorByType()
Error type constants (QUOTA_ERROR, TIMEOUT_ERROR, etc.)
```

**Step 3: Remove quota monitoring**
```javascript
// DELETE:
_monitorStorageQuota()
storageQuotaStats object
Quota check interval (5 min)
Quota percentage thresholds (50%, 75%, 90%)
_handleStorageQuotaExceeded()
Quota cleanup logic
```

**Step 4: Simplify _persistToStorage()**
```javascript
// REPLACE with simple version (see New Pattern above)
```

---

## MIGRATION CHECKLIST

Use this checklist to track pattern migrations:

### Initialization
- [ ] Added `initializationPromise` barrier
- [ ] Removed `_initializeStorageListener()`
- [ ] Removed `_verifyStorageListenerWithRetry()`
- [ ] Removed phase tracking variables
- [ ] Removed pre-init message queue logic
- [ ] Updated `DOMContentLoaded` handler

### State Sync
- [ ] Removed message ID dedup maps
- [ ] Removed revision event buffer
- [ ] Simplified `_handleStorageChangedEvent()`
- [ ] Removed buffer cleanup intervals
- [ ] Kept revision checking
- [ ] Kept checksum validation

### Render Queue
- [ ] Removed `_renderStallTimerId`
- [ ] Removed `_startRenderStallTimer()`
- [ ] Simplified `scheduleRender()`
- [ ] Simplified `_processRenderQueue()`
- [ ] Removed corruption validation before/after
- [ ] Kept basic try/catch

### Message Handling
- [ ] Removed `sendWithAck()`
- [ ] Removed port connection code
- [ ] Removed heartbeat mechanism
- [ ] Added simple `sendMessageToBackground()`
- [ ] Simplified health check

### Storage Persistence
- [ ] Removed retry logic from `_persistToStorage()`
- [ ] Removed error classification
- [ ] Removed quota monitoring
- [ ] Kept validation with checksum
- [ ] Kept non-blocking backup write

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial migration mapping document

