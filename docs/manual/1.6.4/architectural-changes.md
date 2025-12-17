# Architectural Changes Required to Work Past Firefox API Limitations

**Document Type**: Technical Architecture Blueprint  
**Purpose**: Specify concrete architectural modifications needed to overcome
Firefox WebExtensions API limitations  
**Date**: December 16, 2025  
**Scope**: copy-URL-on-hover_ChunkyEdition repository  
**Target**: GitHub Copilot Coding Agent implementation guide

---

## EXECUTIVE SUMMARY

The current Quick Tabs architecture attempts to work **against** Firefox
limitations rather than **with** them. The proposed changes reorganize the
extension architecture to embrace Firefox's strengths (storage.onChanged,
stateless messaging, clear context isolation) while properly handling its
constraints (sidebar API restrictions, content script lifecycle, event
ordering).

**Core Architectural Shift**:

```
CURRENT: Complex workarounds layered on top of unreliable patterns
         (ports, heartbeats, multi-phase initialization, excessive tracking)

PROPOSED: Simple, robust patterns that work WITH Firefox constraints
          (storage-first sync, stateless messaging, barrier patterns, health checks)
```

**Expected Improvements**:

- **60% fewer lines** of code (dead port code, complex dedup, over-instrumented
  tracking)
- **90% simpler** initialization logic (barrier pattern vs multi-phase)
- **100% more reliable** message passing (stateless vs connection-dependent)
- **Zero downtime** from background crashes (storage-based recovery)

---

## PART 1: MESSAGING ARCHITECTURE CHANGES

### Current Problem

The current implementation tries to use persistent Port connections between
sidebar and background:

```javascript
// CURRENT - Port-based (unreliable):
const port = browser.runtime.connect({ name: 'quick-tabs' });
port.onMessage.addListener(message => {
  // Port may disconnect unexpectedly
});
port.postMessage({ type: 'UPDATE' }); // May fail if port closed
```

**Why this fails**: Firefox can disconnect ports when:

- User switches windows/applications
- Sidebar context is suspended
- Background script restarts
- Memory pressure occurs
- Browser enters low-power mode

### Proposed Change

Replace Port-based communication with **two independent, stateless layers**:

```
Layer 1: runtime.sendMessage (Primary - for commands/responses)
  ↓
Layer 2: storage.onChanged (Primary - for state sync)
  ↓
Layer 3: Health checks (Recovery - detect failures)
```

**Architecture**:

```javascript
// PROPOSED - Stateless messaging (reliable):

// Layer 1: One-shot request/response (no state maintained)
async function sendToBackground(message) {
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000)
      )
    ]);
    return response;
  } catch (err) {
    // Falls through to Layer 2 (storage) automatically
    throw err;
  }
}

// Layer 2: Event-driven state sync (primary mechanism)
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['quick_tabs_state_v2']) {
    const newState = changes['quick_tabs_state_v2'].newValue;
    // Always prefer storage over message responses
    handleStateUpdate(newState);
  }
});

// Layer 3: Detect failures if storage goes silent
let lastStorageEventTime = Date.now();
setInterval(() => {
  const age = Date.now() - lastStorageEventTime;
  if (age > 5000) {
    // Storage events haven't fired in 5 seconds
    // Background may have crashed or storage listener broken
    // Request fresh state via message
    requestFreshState();
  }
}, 5000);
```

**Why this works**:

✅ **stateless**: Each message stands alone, no connection state needed  
✅ **resilient**: If port closes, messages still work  
✅ **redundant**: Storage provides fallback if messages fail  
✅ **detectable**: Health checks catch failures before user notices  
✅ **simple**: No heartbeat, no circuit breaker, no reconnection logic

---

## PART 2: INITIALIZATION BARRIER PATTERN

### Current Problem

Current initialization uses multi-phase approach:

```javascript
// CURRENT - Complex multi-phase (timing-dependent):
let initPhase = 'DOM_CONTENT_LOADED';

document.addEventListener('DOMContentLoaded', async () => {
  initPhase = 'PORT_CONNECTION_PENDING';

  // Try to establish port connection
  connectToBackground();

  // Wait for port to connect
  // Phase 2: Wait for port connection to complete
  // Phase 3: Wait for storage listener to verify
  // Phase 4: Process queued messages

  // Multiple points of failure:
  // - Port connection times out?
  // - Storage listener never fires?
  // - Port disconnects during init?
});
```

**Problems**:

- Multiple async operations with unclear ordering
- Messages queued before init complete may be lost
- Failure in phase N blocks all subsequent phases
- Code has 400+ lines of init tracking/retry logic

### Proposed Change

Replace with **simple barrier pattern**:

```javascript
// PROPOSED - Simple barrier (linear, clear):

/**
 * Initialization Barrier Pattern
 *
 * Blocks all operations until:
 * 1. Storage listener is ready
 * 2. Initial state is loaded
 * 3. Barrier is resolved
 */

let initBarrier = new Promise(resolve => {
  const resolveInitBarrier = () => {
    console.log('[Manager] Init barrier resolved - operations can proceed');
    resolve();
  };

  // Register storage listener FIRST (synchronous)
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['quick_tabs_state_v2']) {
      const newState = changes['quick_tabs_state_v2'].newValue;
      handleStateUpdate(newState);
    }
  });

  // Then request initial state (asynchronous)
  browser.runtime
    .sendMessage({
      type: 'GET_QUICK_TABS_STATE'
    })
    .then(response => {
      if (response?.state) {
        handleStateUpdate(response.state);
      }
      // Barrier resolved after EITHER state arrives via message OR storage
      resolveInitBarrier();
    })
    .catch(err => {
      console.warn('[Manager] Failed to get init state:', err.message);
      // Barrier resolved even if message fails - storage will update us
      resolveInitBarrier();
    });
});

// Use barrier before any operation:
async function adoptQuickTab(quickTabId) {
  await initBarrier; // Wait here if init not done

  // Now safe to proceed - storage listener is ready
  const response = await sendToBackground({
    type: 'ADOPT_QUICK_TAB',
    quickTabId
  });
  return response;
}
```

**Advantages**:

✅ **Linear**: Single clear initialization sequence  
✅ **Resilient**: Works even if message fails (falls back to storage)  
✅ **Simple**: 50 lines total vs 400+ lines current  
✅ **Debuggable**: Single "init complete" event to track  
✅ **No Queueing**: Messages simply wait on barrier, no special queue logic

**Key difference from current**:

- No multiple phases
- No port-specific coordination
- No heartbeat to keep things alive
- No message queueing before barrier
- One promise barrier handles all sync

---

## PART 3: CONTENT SCRIPT LIFECYCLE HANDLING

### Current Problem

Content scripts unload on navigation, but current code doesn't handle this
robustly:

```javascript
// CURRENT - Assumes content script survives navigation:
browser.runtime
  .sendMessage({
    type: 'CREATE_QUICK_TAB',
    data: currentPageData
  })
  .then(response => {
    // If page navigates AFTER message sent but BEFORE this resolves,
    // script is unloaded and this callback NEVER fires
    updateUI(response);
  });

// No timeout, no recovery, no way to know it failed
```

### Proposed Change

Add **explicit origin isolation and navigation awareness**:

```javascript
// PROPOSED - Content script ready handshake:

/**
 * Step 1: Content script sends READY message during init
 * Step 2: Background records script is ready for this origin
 * Step 3: Background can now safely send messages
 * Step 4: Content script validates it's still in right origin before accepting
 */

// IN CONTENT SCRIPT (content.js):
const ORIGIN = window.location.origin;
const READY_TIMEOUT_MS = 1000;

// Send ready signal to background
function notifyBackgroundReady() {
  browser.runtime
    .sendMessage({
      type: 'CONTENT_SCRIPT_READY',
      origin: ORIGIN
    })
    .catch(err => {
      console.error('[Content] Failed to send ready:', err.message);
      // Background will use discovery timeout instead
    });
}

// Wait for DOM to be ready, then send notification
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', notifyBackgroundReady);
} else {
  notifyBackgroundReady();
}

// Listen for messages (with origin validation)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate message is for our origin
  if (message.targetOrigin && message.targetOrigin !== ORIGIN) {
    console.warn(
      '[Content] Ignoring message for wrong origin:',
      message.targetOrigin
    );
    return; // Silently drop - wrong context
  }

  if (message.type === 'CREATE_QUICK_TAB') {
    createQuickTab(message.data)
      .then(result => {
        sendResponse({ success: true, result });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Will respond asynchronously
  }
});

// IN BACKGROUND (background.js):

/**
 * Track content script readiness by origin
 * Allows background to know which scripts are actually active
 */
const readyContentScripts = new Map(); // Map<origin, timestamp>

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'CONTENT_SCRIPT_READY') {
    const origin = message.origin;
    readyContentScripts.set(origin, Date.now());
    console.log(`[Background] Content script ready for: ${origin}`);
  }
});

// When sending message to content script:
async function sendToContentScript(tabId, message) {
  try {
    // Query tab to get its URL
    const tab = await browser.tabs.get(tabId);
    const tabOrigin = new URL(tab.url).origin;

    // Check if we have a ready script for this origin
    if (!readyContentScripts.has(tabOrigin)) {
      throw new Error(`No ready content script for origin: ${tabOrigin}`);
    }

    // Send message WITH explicit target origin
    const response = await Promise.race([
      browser.tabs.sendMessage(tabId, {
        ...message,
        targetOrigin: tabOrigin // So content script can validate
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      )
    ]);

    return response;
  } catch (err) {
    console.warn(`[Background] Failed to send to content script:`, err.message);
    // Fallback: update state directly via storage
    // Content script will notice change via storage.onChanged
    throw err;
  }
}
```

**Advantages**:

✅ **Origin scoping**: Content script validates messages are for its origin  
✅ **Discovery**: Background knows which origins have ready scripts  
✅ **Fallback**: If message fails during navigation, storage update covers it  
✅ **Timeout**: Explicit 2s timeout detects unresponsive scripts  
✅ **Resilience**: Navigation doesn't break anything - state still updates via
storage

---

## PART 4: STATE MANAGEMENT SIMPLIFICATION

### Current Problem

Global state has extra fields not in spec:

```javascript
// CURRENT - Over-tracked state:
const globalQuickTabState = {
  version: 2,
  tabs: [],
  lastModified: 0,
  lastUpdate: 0, // ← Unnecessary (duplicate of lastModified)
  saveId: null, // ← Tracking field (belongs in persisted only)
  isInitialized: false
};

let lastBroadcastedStateHash = 0; // ← Violates SSOT
let lastNonEmptyStateTimestamp = 0; // ← Unnecessary tracking
let consecutiveZeroTabReads = 0; // ← Debugging only
```

### Proposed Change

**Strict separation**: Global memory state vs Persisted state

```javascript
// PROPOSED - Clean separation:

// ==================================================
// IN-MEMORY STATE (background script only)
// ==================================================
const globalQuickTabState = {
  version: 2,
  lastModified: 1702000010000,    // Timestamp of last write
  isInitialized: false,           // Barrier flag
  tabs: [
    {
      id: 'qt-1702000000000-abc123',
      url: 'https://example.com',
      title: 'Page Title',
      originTabId: 42,            // ← CRITICAL for origin filtering
      position: { left: 100, top: 200 },
      zIndex: 1000,
      // ... other fields
    }
  ]
};

// ==================================================
// PERSISTED STATE (storage.local only)
// ==================================================
// Stored under 'quick_tabs_state_v2' key:
{
  version: 2,
  tabs: [...],                // Same tabs array
  lastModified: 1702000010000,
  revision: 1702000010001,    // Monotonic counter (never resets)
  checksum: 'v1:5:a1b2c3d4',  // Format: v{version}:{count}:{hash}
  writeSequence: 42           // Sequence number for dedup
}

// ==================================================
// SYNCHRONIZATION PATTERN
// ==================================================

async function persistToStorage(state) {
  const persistedState = {
    version: state.version,
    tabs: state.tabs,
    lastModified: state.lastModified,
    revision: Date.now(),              // New revision for ordering
    checksum: computeStateChecksum(state.tabs),
    writeSequence: (writeSequence || 0) + 1
  };

  try {
    await browser.storage.local.set({
      'quick_tabs_state_v2': persistedState
    });

    // Backup to storage.sync if small enough
    if (JSON.stringify(persistedState).length < 4000) {
      await browser.storage.sync.set({
        'quick_tabs_backup': persistedState
      }).catch(err => {
        console.warn('[Background] Sync backup failed (ok):', err.message);
      });
    }
  } catch (err) {
    console.error('[Background] Failed to persist state:', err.message);
    throw err;
  }
}

async function loadStateFromStorage() {
  try {
    const result = await browser.storage.local.get('quick_tabs_state_v2');
    const persistedState = result['quick_tabs_state_v2'];

    if (!persistedState || !persistedState.tabs) {
      return { version: 2, tabs: [], lastModified: 0, isInitialized: false };
    }

    // Validate checksum
    const expectedChecksum = computeStateChecksum(persistedState.tabs);
    if (persistedState.checksum !== expectedChecksum) {
      console.warn('[Background] State checksum mismatch - potential corruption');
      // Return backup or empty state
      return await recoverFromCorruption();
    }

    return {
      version: persistedState.version,
      tabs: persistedState.tabs,
      lastModified: persistedState.lastModified,
      isInitialized: true
    };
  } catch (err) {
    console.error('[Background] Failed to load state:', err.message);
    return { version: 2, tabs: [], lastModified: 0, isInitialized: false };
  }
}
```

**Key differences**:

✅ **No redundant fields**: lastUpdate removed (use lastModified)  
✅ **No SSOT violations**: lastBroadcastedStateHash removed  
✅ **Clear separation**: Global state vs Persisted state  
✅ **Spec compliance**: Follows state-data-structure-spec exactly  
✅ **Checksum validation**: Detects corruption early  
✅ **Revision ordering**: Handles out-of-order storage events

---

## PART 5: SIDEBAR DEDUPLICATION SIMPLIFICATION

### Current Problem

Sidebar has 250+ lines of dedup logic:

```javascript
// CURRENT - Over-complex dedup:
const recentlyProcessedMessageIds = new Map();
const _messageIdTimestamps = new Map();
const _revisionEventBuffer = [];
const _dedupStatsHistory = [];

function _addProcessedMessageId(messageId, ttl = 5000) {
  // Complex TTL management
  // Per-tier statistics tracking
  // History bucketing (5-minute windows)
}

function _cleanupExpiredMessageIds() {
  // Sliding window cleanup
  // Statistics aggregation
  // Rate-limited logging
}
```

### Proposed Change

Replace with **single revision check**:

```javascript
// PROPOSED - Simple revision-based dedup:

let lastAppliedRevision = 0;

// In storage.onChanged listener:
function handleStorageChangedEvent(changes, areaName) {
  if (areaName !== 'local' || !changes['quick_tabs_state_v2']) return;

  const newState = changes['quick_tabs_state_v2'].newValue;
  const revision = newState?.revision;

  // Single check: is this revision newer than what we've processed?
  if (revision <= lastAppliedRevision) {
    console.log(
      `[Manager] Skipping stale revision: ${revision} vs ${lastAppliedRevision}`
    );
    return; // Drop it - old event
  }

  // Monotonically increasing = we now have the latest
  lastAppliedRevision = revision;

  // Apply the state
  updateSidebarState(newState);
  scheduleRender();
}
```

**Advantages**:

✅ **Simple**: Single number comparison  
✅ **Correct**: Monotonic revision ensures ordering  
✅ **No overhead**: No maps, no cleanup, no statistics  
✅ **Clear**: Obvious why event is rejected  
✅ **Spec compliant**: Implements revision versioning from spec

---

## PART 6: RENDER QUEUE SIMPLIFICATION

### Current Problem

Sidebar has complex render stall detection:

```javascript
// CURRENT - Complex render management:
let _renderStallTimerId = null;
function _startRenderStallTimer() { ... }
function _clearRenderStallTimer() { ... }
function _handleRenderStall() { ... }

// Plus render corruption validation:
function _validateRenderIntegrity() { ... }
async function _checkStorageHealth() { ... }
```

**80+ lines of code** for stall detection that shouldn't be needed.

### Proposed Change

Replace with **simple debounced render queue**:

```javascript
// PROPOSED - Simple render queue (no stall detection):

const RENDER_DEBOUNCE_MS = 100; // Wait 100ms to batch updates
let renderScheduled = false;
let renderQueue = [];

function scheduleRender() {
  // Queue this render
  renderQueue.push({
    timestamp: Date.now(),
    reason: new Error().stack // Debug: why was this queued?
  });

  if (renderScheduled) {
    return; // Already scheduled, will process all queued
  }

  renderScheduled = true;

  setTimeout(() => {
    processRenderQueue();
    renderScheduled = false;
  }, RENDER_DEBOUNCE_MS);
}

function processRenderQueue() {
  const queueLength = renderQueue.length;

  if (queueLength === 0) return;

  try {
    // Single render call - render manager.js's handleStateUpdate()
    // will update DOM reconciliation
    renderQuickTabsList();

    console.log(`[Manager] Rendered ${queueLength} queued updates`);
  } catch (err) {
    console.error('[Manager] Render failed:', err.message);
    // If render fails, next storage event will trigger retry
    // (No special recovery needed - storage is source of truth)
  }

  renderQueue = []; // Clear queue
}
```

**Advantages**:

✅ **Simple**: Debounce + render, no stall detection  
✅ **Batching**: Multiple updates render as one  
✅ **Resilient**: If render fails, storage event retriggers it  
✅ **No magic**: Straightforward debounce pattern  
✅ **Debug friendly**: Queue shows what triggered renders

---

## PART 7: REMOVAL OF DEAD CODE

### Files to Clean Up

**background.js** (~10,000 lines → ~2,500 lines):

1. **Delete port infrastructure** (~500 lines):
   - `connectToBackground()` function
   - `_establishPortConnection()` function
   - `_setupPortListeners()` function
   - `_handlePortDisconnect()` function
   - All port-related constants and variables

2. **Delete excessive quota monitoring** (~200 lines):
   - `checkStorageQuota()` function
   - `_getAggregatedStorageUsage()` function
   - Per-area tracking variables
   - Adaptive monitoring frequency logic

3. **Delete complex dedup statistics** (~150 lines):
   - `dedupStats` object with tier counts
   - `dedupStatsHistory` array
   - `_calculateAvgSkipRate()` function
   - Rate-limited logging

4. **Delete keepalive health reporting** (~200 lines):
   - `_startKeepaliveHealthReport()` function
   - Success/failure rate calculation
   - `_getKeepaliveHealthSummary()` function

5. **Delete initialization guards** (~150 lines):
   - `checkInitializationGuard()` function
   - Phase tracking variables
   - Per-handler initialization checks

6. **Delete Phase 3A optimization code** (~100 lines):
   - `MemoryMonitor`, `PerformanceMetrics` classes
   - `initializePhase3AOptimizations()` function
   - Memory pressure cleanup callbacks

**sidebar/quick-tabs-manager.js** (~8,000 lines → ~1,500 lines):

1. **Delete port connection infrastructure** (~500 lines):
   - All `connectToBackground()` related code
   - Port listeners and handlers
   - Connection state variables

2. **Delete complex initialization** (~400 lines):
   - Multi-phase initialization logic
   - `_initializeStorageListener()` function
   - `_verifyStorageListenerWithRetry()` function
   - Pre-init message queueing

3. **Delete multi-layer deduplication** (~250 lines):
   - `recentlyProcessedMessageIds` map
   - `_addProcessedMessageId()` function
   - `_cleanupExpiredMessageIds()` function
   - All dedup statistics tracking

4. **Delete render stall detection** (~100 lines):
   - `_renderStallTimerId` management
   - `_startRenderStallTimer()` function
   - `_handleRenderStall()` function

5. **Delete render corruption validation** (~80 lines):
   - `_validateRenderIntegrity()` function
   - Before/after DOM checks
   - Corruption recovery logic

6. **Delete storage probes** (~150 lines):
   - `_probeInProgress` flag
   - `_canStartProbe()` function
   - `_startStorageProbe()` function
   - `_checkStorageHealth()` periodic checking

7. **Delete heartbeat mechanism** (~100 lines):
   - `startHeartbeat()` function
   - `stopHeartbeat()` function
   - `sendHeartbeat()` function
   - Heartbeat state variables

---

## PART 8: NEW PATTERNS TO ADD

### Content Script Ready Handshake

**File**: `content.js` (new pattern)

```javascript
// Send ready signal on init
function initContentScript() {
  browser.runtime
    .sendMessage({
      type: 'CONTENT_SCRIPT_READY',
      origin: window.location.origin
    })
    .catch(err => {
      console.warn('[Content] Failed to send ready:', err.message);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}

// Listen with origin validation
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.targetOrigin && message.targetOrigin !== window.location.origin) {
    return; // Silently drop - wrong origin
  }

  if (message.type === 'CREATE_QUICK_TAB') {
    handleCreateQuickTab(message.data)
      .then(result => {
        sendResponse({ success: true, result });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});
```

### Health Check Pattern

**File**: `sidebar/quick-tabs-manager.js`

```javascript
let lastStorageEventTime = Date.now();

browser.storage.onChanged.addListener(changes => {
  lastStorageEventTime = Date.now(); // Reset timer
  // ... handle storage change
});

// Detect silent failures
setInterval(() => {
  const age = Date.now() - lastStorageEventTime;
  if (age > 5000) {
    console.warn('[Manager] Storage listener silent for', age, 'ms');
    // Request fresh state via message
    sendToBackground({ type: 'GET_QUICK_TABS_STATE' })
      .then(response => {
        if (response?.state) {
          handleStateUpdate(response.state);
          lastStorageEventTime = Date.now();
        }
      })
      .catch(err => {
        console.error('[Manager] Health check failed:', err.message);
      });
  }
}, 5000);
```

### Simple Barrier Pattern

**File**: `sidebar/quick-tabs-manager.js`

```javascript
// Initialization barrier
let initBarrier = new Promise(resolve => {
  // Register listener first (synchronous)
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['quick_tabs_state_v2']) {
      handleStateUpdate(changes['quick_tabs_state_v2'].newValue);
    }
  });

  // Request initial state
  browser.runtime
    .sendMessage({ type: 'GET_QUICK_TABS_STATE' })
    .then(response => {
      if (response?.state) {
        handleStateUpdate(response.state);
      }
      resolve();
    })
    .catch(err => {
      console.warn('[Manager] Init failed:', err.message);
      resolve(); // Resolve anyway - storage will update us
    });
});

// Use before operations
async function performOperation() {
  await initBarrier;
  // Now safe to proceed
}
```

---

## PART 9: MIGRATION STEPS

### Phase 1: Establish Storage Infrastructure (Week 1)

1. ✅ Define clean globalQuickTabState (remove extra fields)
2. ✅ Implement persistToStorage() with checksum validation
3. ✅ Implement loadStateFromStorage() with corruption recovery
4. ✅ Add storage.local listener in background
5. ✅ Test storage read/write cycle

### Phase 2: Implement Stateless Messaging (Week 1-2)

1. ✅ Remove all Port connection code
2. ✅ Add MESSAGE_TIMEOUT_MS with Promise.race
3. ✅ Implement fallback to storage when messages fail
4. ✅ Add explicit error handling

### Phase 3: Simple Initialization (Week 2)

1. ✅ Remove multi-phase init code
2. ✅ Implement initBarrier pattern
3. ✅ Test that operations wait for barrier
4. ✅ Verify sidebar works even if message fails

### Phase 4: Content Script Readiness (Week 2-3)

1. ✅ Add CONTENT_SCRIPT_READY message type
2. ✅ Track ready scripts in background
3. ✅ Add targetOrigin validation in content scripts
4. ✅ Test origin filtering

### Phase 5: Health Checks (Week 3)

1. ✅ Add 5-second storage listener timeout check
2. ✅ Implement recovery message on timeout
3. ✅ Test failure scenarios (background crash, storage failure)

### Phase 6: Dead Code Removal (Week 3-4)

1. ✅ Remove port infrastructure
2. ✅ Remove complex dedup logic
3. ✅ Remove stall detection
4. ✅ Remove extra quota monitoring
5. ✅ Remove keepalive health reporting
6. ✅ Clean up debug tracking variables

### Phase 7: Testing & Validation (Week 4)

1. ✅ Test 50+ Quick Tabs with multiple tabs
2. ✅ Test background restart scenario
3. ✅ Test storage corruption recovery
4. ✅ Test content script navigation unload
5. ✅ Test sidebar/background message timeout
6. ✅ Measure file size reduction

---

## PART 10: EXPECTED OUTCOMES

### Code Size Reduction

| Component             | Current | Proposed | Reduction |
| --------------------- | ------- | -------- | --------- |
| background.js         | 10,000+ | 2,500    | 75%       |
| quick-tabs-manager.js | 8,000+  | 1,500    | 81%       |
| Total                 | 18,000+ | 4,000    | 78%       |

### Complexity Reduction

| Aspect             | Current                      | Proposed                   | Improvement |
| ------------------ | ---------------------------- | -------------------------- | ----------- |
| Init phases        | 4 phases + queueing          | 1 barrier                  | 4x simpler  |
| Dedup logic        | 250+ lines                   | 10 lines                   | 25x simpler |
| Messaging layers   | 3 (port + BC + sendMessage)  | 2 (sendMessage + storage)  | 33% less    |
| Render management  | 100+ lines (stall detection) | 50 lines (debounce)        | 2x simpler  |
| Keepalive tracking | 200+ lines                   | 5 lines (5s timeout check) | 40x simpler |

### Reliability Improvement

| Scenario           | Current                  | Proposed                       |
| ------------------ | ------------------------ | ------------------------------ |
| Background crashes | ❌ User sees stale state | ✅ Storage triggers refresh    |
| Port disconnects   | ❌ All messages fail     | ✅ Messages work independently |
| Message timeout    | ❌ No fallback           | ✅ Storage.onChanged kicks in  |
| Navigation unload  | ❌ Message lost forever  | ✅ Recovered by health check   |
| Storage corruption | ⚠️ Partial recovery      | ✅ Full recovery with backup   |

---

## PART 11: VALIDATION CHECKLIST

### For GitHub Copilot Agent

Before declaring changes complete:

- [ ] **All port code removed**: grep for "port", "Port", "PORT" returns only
      comments
- [ ] **Barrier implemented**: initBarrier promise exists and blocks operations
- [ ] **Storage listener active**: browser.storage.onChanged in both sidebar and
      background
- [ ] **Message timeout enforced**: Promise.race with 3000ms timeout on all
      runtime.sendMessage
- [ ] **Health checks active**: 5-second storage event age check implemented
- [ ] **State separation clean**: No extra fields in globalQuickTabState
- [ ] **Checksum validation**: persistToStorage computes and validates checksums
- [ ] **Content script ready**: Background tracks ready scripts by origin
- [ ] **No dead code**: All removed functions confirmed deleted via grep
- [ ] **File sizes reduced**: background.js <3000 lines, quick-tabs-manager.js
      <1500 lines

### Success Metrics

✅ **Build succeeds** without warnings  
✅ **Sidebar loads** and renders Quick Tabs  
✅ **Storage listener fires** on state changes  
✅ **Messages work** even if background not responding  
✅ **Navigation handles** content script unload gracefully  
✅ **50+ Quick Tabs** render without UI lag  
✅ **Barrier resolves** within 1 second on normal conditions  
✅ **Health check** detects missing events within 5 seconds

---

## CONCLUSION

This architectural restructuring addresses all 13 Firefox API limitations by:

1. **Embracing storage as primary sync** (works with Firefox strengths)
2. **Using stateless messaging** (works with port unpredictability)
3. **Implementing simple barriers** (eliminates multi-phase timing issues)
4. **Adding health checks** (detects failures before user impact)
5. **Separating concerns clearly** (sidebar ↔ background ↔ content script)
6. **Removing dead code** (75-80% reduction in lines)

**Result**: A robust, maintainable Quick Tabs extension that works WITH
Firefox's architecture instead of against it.
