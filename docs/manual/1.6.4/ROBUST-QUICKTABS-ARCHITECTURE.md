# Quick Tabs State Communication Architecture - Robust Design Plan

**Status:** Comprehensive Architecture Specification  
**Target Platform:** Firefox/Zen Browser (Manifest V2)  
**Minimum Version:** Firefox 115+  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document specifies a production-grade architecture for Quick Tabs state
management that prioritizes **correctness and reliability** over simplicity. The
design handles 50-100+ Quick Tabs simultaneously with 100-200ms synchronization
latency while ensuring state consistency across sidebar, background script, and
content scripts.

### Design Philosophy

- **Correctness First:** Detects and recovers from all known failure modes
- **Layered Redundancy:** Multiple fallback mechanisms ensure no state loss
- **Firefox MV2 Native:** Leverages platform strengths, avoids known pitfalls
- **Minimal Complexity:** Avoids over-engineering; each component serves a
  specific purpose

### Critical Requirements Met

✅ State sync between sidebar and Quick Tabs (position, size, minimize status)  
✅ Sidebar updates when Quick Tabs created/modified  
✅ Single unorganized list (no grouping by origin tab)  
✅ 100-200ms update latency  
✅ 50-100+ simultaneous Quick Tabs  
✅ Manifest V2 only

---

## ARCHITECTURE OVERVIEW

### High-Level Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    BACKGROUND SCRIPT (Authoritative State)      │
│                    ┌──────────────────────────────────┐         │
│                    │  globalQuickTabState             │         │
│                    │  - Array of Quick Tab objects    │         │
│                    │  - lastModified timestamp        │         │
│                    └──────────────────────────────────┘         │
│                                  │                              │
│                    Writes to storage.local when:               │
│                    - New Quick Tab created                      │
│                    - Quick Tab position/size changed            │
│                    - Quick Tab minimize status changed          │
│                    - Quick Tab closed                           │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ├─────────────────────────────────────┬──────────────┐
                  │                                     │              │
           storage.local.set()                    browser.runtime    browser.tabs.onRemoved
           (IndexedDB write)                       .sendMessage()     (detect closed tabs)
                  │                                     │              │
                  ▼                                     │              │
         ┌─────────────────────┐                       │              │
         │ storage.onChanged   │                       │              │
         │ fires in ALL        │                       │              │
         │ contexts:           │                       │              │
         │ - Background        │                       │              │
         │ - Sidebar           │                       ▼              ▼
         │ - Content Scripts   │                  ┌──────────────────────┐
         └──────────┬──────────┘                  │ REQUEST/RESPONSE    │
                    │                             │ Message Pattern:    │
                    │                             │ - CREATE_QUICK_TAB  │
                    ▼                             │ - DELETE_QUICK_TAB  │
         ┌──────────────────────────────┐         │ - UPDATE_POSITION   │
         │  SIDEBAR MANAGER             │         └─────────┬──────────┘
         │  ┌────────────────────────┐  │                   │
         │  │ storage.onChanged      │  │◄──────────────────┘
         │  │ listener (PRIMARY)     │  │
         │  │ - Validates events     │  │
         │  │ - Deduplicates        │  │
         │  │ - Updates local state │  │
         │  └────────────┬───────────┘  │
         │               │              │
         │               ▼              │
         │  ┌────────────────────────┐  │
         │  │ Render Queue System    │  │
         │  │ - Serial processing    │  │
         │  │ - 100ms debounce       │  │
         │  │ - DOM reconciliation   │  │
         │  └────────────┬───────────┘  │
         │               │              │
         │               ▼              │
         │  ┌────────────────────────┐  │
         │  │ DOM (Quick Tab List)   │  │
         │  │ - Only modified items  │  │
         │  │ - No full re-renders   │  │
         │  └────────────────────────┘  │
         └──────────────────────────────┘
```

---

## COMPONENT ARCHITECTURE

### 1. BACKGROUND SCRIPT - Authoritative State Owner

**Responsibility:** Single source of truth for all Quick Tab state

**Key Data Structures:**

```javascript
// Main state object (in-memory cache)
const globalQuickTabState = {
  tabs: [
    {
      id: 'qt-1702000000000-abc123',
      url: 'https://example.com',
      originTabId: 42, // Browser tab that created this
      position: { left: 100, top: 200 },
      size: { width: 800, height: 600 },
      minimized: false,
      creationTime: 1702000000000,
      lastModified: 1702000010000 // CRITICAL: Use for dedup
    }
    // ... up to 100+ tabs
  ],
  lastModified: 1702000010000, // Track state age
  isInitialized: false // Guard against partial reads
};

// Persistent storage key
const STORAGE_KEY = 'quick_tabs_state_v2';

// Storage write sequence tracking
let _storageWriteSequence = 0;
let _storageRevision = Date.now(); // Monotonic counter
```

**Initialization (startup):**

1. Load state from `storage.local` (IndexedDB)
2. Validate loaded state (checksum verification)
3. If corrupted, try `storage.sync` backup
4. If both fail, start with empty state
5. Set `isInitialized = true` only after validation

**Write Operations:**

When any Quick Tab operation occurs (create, update, delete):

1. Update `globalQuickTabState.tabs` array
2. Update `lastModified` timestamp
3. Increment `_storageWriteSequence`
4. Increment `_storageRevision` (before write)
5. Call `_persistToStorage()`
6. Validate write-back (read from storage and compare)

**Storage Write Pattern:**

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
      [STORAGE_KEY]: stateToWrite
    });

    // Write to backup (async, non-blocking)
    if (ENABLE_SYNC_BACKUP) {
      browser.storage.sync
        .set({
          quick_tabs_backup_v1: {
            tabs: stateToWrite.tabs,
            lastModified: stateToWrite.lastModified,
            checksum: stateToWrite.checksum
          }
        })
        .catch(err => {
          console.warn('[Background] Sync backup failed:', err);
        });
    }

    // Validate write-back
    const readBack = await browser.storage.local.get(STORAGE_KEY);
    if (
      !readBack[STORAGE_KEY] ||
      readBack[STORAGE_KEY].checksum !== stateToWrite.checksum
    ) {
      console.error(
        '[Background] WRITE VALIDATION FAILED - data corruption detected'
      );
      _triggerCorruptionRecovery();
    }
  } catch (err) {
    console.error('[Background] Storage write error:', err);
    _handleStorageWriteFailure(err);
  }
}
```

**Orphan Cleanup (periodic task):**

Runs hourly via `browser.alarms`:

1. Get all open browser tabs via `browser.tabs.query({})`
2. For each Quick Tab in state, check if `originTabId` still exists
3. If origin tab closed, remove Quick Tab from state
4. Write updated state to storage

---

### 2. SIDEBAR MANAGER - State Consumer & UI Controller

**Responsibility:** Display Quick Tabs and respond to user interactions

**Key Phases:**

#### Phase A: Initialization (synchronous guarantee)

```javascript
// Step 1: Create initialization barrier
let initializationPromise = null;
let initializationResolve = null;
let initializationReject = null;

function _createInitializationBarrier() {
  initializationPromise = new Promise((resolve, reject) => {
    initializationResolve = resolve;
    initializationReject = reject;
  });

  // Safety timeout: if init takes >10 seconds, force fail
  setTimeout(() => {
    if (!initializationResolve) return; // Already resolved
    initializationReject(new Error('Initialization timeout'));
  }, 10000);
}

// Step 2: Set up message queue for events that fire during init
const _initPhaseMessageQueue = [];
let _isInitPhaseComplete = false;

// Step 3: Attach storage listener FIRST (before any state load)
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  // During init, queue messages instead of processing
  if (!_isInitPhaseComplete) {
    _initPhaseMessageQueue.push({ changes, timestamp: Date.now() });
    return;
  }

  // After init, process normally
  _handleStorageChangedEvent(changes);
});

// Step 4: Load initial state
document.addEventListener('DOMContentLoaded', async () => {
  _createInitializationBarrier();

  try {
    // Load from background (request/response)
    const initialState = await browser.runtime.sendMessage({
      action: 'GET_QUICK_TABS_STATE',
      requestId: _generateRequestId()
    });

    // Validate received state
    if (!initialState || !Array.isArray(initialState.tabs)) {
      throw new Error('Invalid initial state received');
    }

    // Load into local cache
    sidebarLocalState = {
      tabs: initialState.tabs.slice(), // Deep copy
      lastModified: initialState.lastModified,
      revisionReceived: 0
    };

    _isInitPhaseComplete = true;
    initializationResolve();

    // Render initial UI
    renderQuickTabsList(sidebarLocalState.tabs);

    // Process any messages queued during init
    _processInitPhaseMessageQueue();
  } catch (err) {
    console.error('[Manager] Init failed:', err);
    initializationReject(err);
  }
});

async function _processInitPhaseMessageQueue() {
  const queued = _initPhaseMessageQueue.splice(0);
  for (const { changes } of queued) {
    _handleStorageChangedEvent(changes);
  }
}
```

#### Phase B: Runtime (event-driven updates)

**storage.onChanged listener (PRIMARY sync mechanism):**

```javascript
async function _handleStorageChangedEvent(changes) {
  const stateChange = changes[STORAGE_KEY];
  if (!stateChange) return;

  const newState = stateChange.newValue;

  // Guard 1: Validate state structure
  if (!newState || !Array.isArray(newState.tabs)) {
    console.warn('[Manager] Received invalid state structure');
    return;
  }

  // Guard 2: Check if we've already processed this exact revision
  if (newState.revision <= sidebarLocalState.revisionReceived) {
    console.log('[Manager] Ignoring stale revision:', newState.revision);
    return;
  }

  // Guard 3: Verify checksum (corruption detection)
  const expectedChecksum = _computeStateChecksum(newState.tabs);
  if (newState.checksum && newState.checksum !== expectedChecksum) {
    console.error('[Manager] CHECKSUM MISMATCH - state may be corrupted');
    _requestStateRepair();
    return;
  }

  // Guard 4: Age check (reject ancient events older than 5 min)
  if (Date.now() - newState.lastModified > 300000) {
    console.warn('[Manager] Ignoring event older than 5 minutes');
    return;
  }

  // Update local cache
  sidebarLocalState = {
    tabs: newState.tabs.slice(), // Deep copy
    lastModified: newState.lastModified,
    revisionReceived: newState.revision,
    writeSequence: newState.writeSequence
  };

  // Schedule render (debounced, serialized)
  scheduleRender('storage-event', newState.revision);
}
```

**Request/Response Messages (secondary, for operations):**

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'QUICK_TAB_OPERATION_ACK') {
    // Background confirming an operation succeeded
    const { operationId, operationSequence } = message;

    // If we're ahead, ignore (we already rendered from storage event)
    if (operationSequence <= sidebarLocalState.writeSequence) {
      sendResponse({ received: true });
      return;
    }

    // Otherwise, if storage event is delayed, update immediately
    sidebarLocalState.writeSequence = operationSequence;
    scheduleRender('operation-ack', operationSequence);

    sendResponse({ received: true });
  }
});
```

**Render Queue System:**

```javascript
let _renderInProgress = false;
const _renderQueue = [];
let _renderDebounceTimer = null;
const RENDER_DEBOUNCE_MS = 100;

function scheduleRender(source, revision) {
  // Deduplicate: don't schedule if we just processed this revision
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
  }, RENDER_DEBOUNCE_MS);
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
```

**DOM Reconciliation (no full re-renders):**

```javascript
const _domItemMap = new Map(); // tabId → DOM element

function _renderQuickTabsWithReconciliation(tabs) {
  const newTabIds = new Set(tabs.map(t => t.id));
  const oldTabIds = new Set(_domItemMap.keys());

  // 1. Add new items
  for (const tab of tabs) {
    if (!_domItemMap.has(tab.id)) {
      const element = _createQuickTabElement(tab);
      _domItemMap.set(tab.id, element);
      containersList.appendChild(element);
    } else {
      // Update existing (only changed properties)
      _updateQuickTabElement(_domItemMap.get(tab.id), tab);
    }
  }

  // 2. Remove deleted items
  for (const tabId of oldTabIds) {
    if (!newTabIds.has(tabId)) {
      const element = _domItemMap.get(tabId);
      element.remove();
      _domItemMap.delete(tabId);
    }
  }

  // Update summary stats
  document.querySelector('#quick-tabs-count').textContent = tabs.length;
}
```

---

### 3. CONTENT SCRIPT - Event Trigger

**Responsibility:** Detect user actions and send to background

**Pattern:**

```javascript
// When user creates a Quick Tab (keyboard shortcut or context menu)
function handleQuickTabCreate(url) {
  browser.runtime
    .sendMessage({
      action: 'CREATE_QUICK_TAB',
      url: url,
      currentTabId: browser.tabs.query({ active: true, currentWindow: true })
    })
    .then(response => {
      if (!response.success) {
        console.error('Failed to create Quick Tab:', response.error);
      }
    })
    .catch(err => {
      console.error('Message send error:', err);
    });
}

// When user modifies Quick Tab (drag, resize, minimize)
function handleQuickTabUpdate(quickTabId, updatedProps) {
  browser.runtime.sendMessage({
    action: 'UPDATE_QUICK_TAB',
    quickTabId: quickTabId,
    ...updatedProps // { position, size, minimized }
  });
}
```

---

## DEDUPLICATION & ORDERING STRATEGY

### Problem Statement

Firefox's `storage.onChanged` fires events **in arbitrary order** and may fire
**multiple times** for the same write. The sidebar must detect and ignore
duplicates while processing legitimate state changes in correct order.

### Solution: Multi-Layer Deduplication

**Layer 1: Revision-Based Ordering (Primary)**

Every state write includes an incrementing revision counter:

```javascript
// Background script
let _storageRevision = Date.now(); // e.g., 1702000000000

function _getNextRevision() {
  _storageRevision++;
  return _storageRevision;
}

// Sidebar tracks highest revision seen
sidebarLocalState.revisionReceived = 0;

// In storage.onChanged handler
if (newState.revision <= sidebarLocalState.revisionReceived) {
  return; // Ignore stale revision
}
sidebarLocalState.revisionReceived = newState.revision;
```

**Why this works:** Monotonically increasing revision ensures out-of-order
events are rejected.

**Layer 2: Checksum Verification (Corruption Detection)**

```javascript
function _computeStateChecksum(tabs) {
  // Create deterministic signature of state
  const signatures = tabs
    .map(
      t =>
        `${t.id}|${t.position.left}|${t.position.top}|${t.size.width}|${t.size.height}|${t.minimized ? 1 : 0}`
    )
    .sort()
    .join('||');

  // Simple hash (not cryptographic, just collision detection)
  let hash = 0;
  for (let i = 0; i < signatures.length; i++) {
    const char = signatures.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return `v1:${tabs.length}:${Math.abs(hash).toString(16)}`;
}

// In storage.onChanged
if (
  newState.checksum &&
  newState.checksum !== _computeStateChecksum(newState.tabs)
) {
  console.error('State checksum mismatch - potential corruption');
  _requestStateRepair();
  return;
}
```

**Why this works:** Detects if state was corrupted during storage write.

**Layer 3: Render Deduplication (Prevent animation flicker)**

```javascript
sidebarLocalState.lastRenderedRevision = 0;

function scheduleRender(source, revision) {
  // Don't render the same revision twice
  if (revision === sidebarLocalState.lastRenderedRevision) {
    return;
  }

  // Schedule debounced render
  _renderQueue.push({ revision });
}
```

**Why this works:** Multiple storage.onChanged events for same write are
skipped.

---

## FAILURE MODE HANDLING

### Scenario 1: Storage Write Fails

**Detection:**

```javascript
async function _persistToStorage() {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: stateToWrite });

    // Verify write succeeded
    const readBack = await browser.storage.local.get(STORAGE_KEY);
    if (readBack[STORAGE_KEY].checksum !== stateToWrite.checksum) {
      throw new Error('Checksum mismatch after write');
    }
  } catch (err) {
    _handleStorageWriteFailure(err);
  }
}
```

**Recovery:**

1. Log error with context
2. Retry with exponential backoff (100ms, 200ms, 400ms, then give up)
3. Notify sidebar (if possible) that write failed
4. Keep in-memory state unchanged so next operation retries

### Scenario 2: Storage Read Returns Corrupted Data

**Detection:**

```javascript
if (
  newState.checksum &&
  newState.checksum !== _computeStateChecksum(newState.tabs)
) {
  console.error('CORRUPTION DETECTED');
  _triggerCorruptionRecovery();
}
```

**Recovery:**

1. Attempt restore from `storage.sync` backup
2. If backup valid, restore to `storage.local`
3. If backup also corrupted, reset to empty state
4. Log detailed corruption report

### Scenario 3: storage.onChanged Never Fires

**Detection:**

Periodic health check (every 5 seconds):

```javascript
let _lastStorageEventTime = Date.now();

async function _checkStorageHealth() {
  const age = Date.now() - _lastStorageEventTime;

  if (age > 5000) {
    console.warn(
      '[Sidebar] Storage listener may be broken - no events for',
      age,
      'ms'
    );

    // Fallback: request state directly from background
    const state = await browser.runtime.sendMessage({
      action: 'GET_QUICK_TABS_STATE'
    });

    // Update sidebar with fresh state
    _handleStorageChangedEvent({
      [STORAGE_KEY]: { newValue: state }
    });

    _lastStorageEventTime = Date.now();
  }
}

// Reset timer when storage event fires
function _handleStorageChangedEvent(changes) {
  _lastStorageEventTime = Date.now();
  // ... rest of handler
}

setInterval(_checkStorageHealth, 5000);
```

**Recovery:** Request state directly via message if storage events stop
arriving.

### Scenario 4: Background Script Crashes or Reloads

**Problem:** Sidebar's in-memory state becomes stale

**Detection:**

Timeout on message sent to background:

```javascript
const MESSAGE_TIMEOUT_MS = 3000;

async function sendMessageToBackground(message) {
  try {
    return await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), MESSAGE_TIMEOUT_MS)
      )
    ]);
  } catch (err) {
    if (err.message === 'Timeout') {
      console.warn('Background may be unresponsive');
      // Sidebar will rely on storage.onChanged if background recovers
    }
    throw err;
  }
}
```

**Recovery:** Sidebar continues using storage.onChanged events (which fire even
if background restarts). When background restarts, it writes current state to
storage, triggering sidebar update.

---

## SYNCHRONIZATION LATENCY ANALYSIS

**Goal:** 100-200ms between Quick Tab change and sidebar update

### Breakdown

1. **Content Script → Background** (runtime.sendMessage): ~5-20ms
2. **Background update state in memory**: ~1ms
3. **Background write to storage.local** (IndexedDB): ~20-50ms
4. **Storage write triggers storage.onChanged**: ~0-10ms
5. **Sidebar receives storage.onChanged**: ~0-5ms
6. **Sidebar debounces (100ms buffer)**: 0-100ms
7. **Sidebar renders DOM**: ~10-30ms
8. **Total**: **36-215ms** (within 100-200ms goal)

### Optimization Opportunities

- Use `storage.session` for faster reads (Firefox 115+) ✅
- Reduce debounce from 100ms to 50ms for quicker response
- Use `requestIdleCallback` for DOM updates if heavy

---

## IMPLEMENTATION CHECKLIST

### Background Script (`background.js`)

- [ ] Define `globalQuickTabState` object with proper structure
- [ ] Implement `_persistToStorage()` with validation and backup
- [ ] Implement orphan cleanup alarm task
- [ ] Add message handler for `GET_QUICK_TABS_STATE`
- [ ] Add message handler for `CREATE_QUICK_TAB`
- [ ] Add message handler for `UPDATE_QUICK_TAB`
- [ ] Add message handler for `DELETE_QUICK_TAB`
- [ ] Implement state initialization from storage
- [ ] Add corruption detection and recovery
- [ ] Add detailed logging with `[Background]` prefix

### Sidebar Manager (`sidebar/quick-tabs-manager.js`)

- [ ] Implement initialization barrier pattern
- [ ] Implement storage.onChanged listener with guards
- [ ] Implement render queue and debouncing
- [ ] Implement DOM reconciliation (no full re-renders)
- [ ] Implement deduplication (revision + checksum)
- [ ] Implement storage health check (5-second interval)
- [ ] Implement fallback message for missing updates
- [ ] Add message handler for operation acknowledgments
- [ ] Implement DOM item tracking map
- [ ] Add detailed logging with `[Manager]` prefix

### Content Script (`content.js`)

- [ ] Add message sender for `CREATE_QUICK_TAB`
- [ ] Add message sender for `UPDATE_QUICK_TAB`
- [ ] Add error handling with user feedback
- [ ] Add logging with `[Content]` prefix

### Testing Suite

- [ ] Unit tests for deduplication logic
- [ ] Integration tests for initialization sequence
- [ ] Stress tests with 100+ Quick Tabs
- [ ] Failure mode tests (corrupted storage, missing updates)
- [ ] Latency measurement tests

---

## KNOWN LIMITATIONS & TRADEOFFS

### Limitations

1. **Stateless Messages (no persistent port):** Each update is independent, no
   streaming capability
2. **100-200ms Latency:** Not real-time, but acceptable for UI updates
3. **Storage I/O Bottleneck:** IndexedDB writes limited to ~20-50ms; can't go
   faster
4. **Firefox MV2 Only:** Chrome would need different background persistence
   strategy

### Why NOT Using Persistent Port

Although `fix-permission-issues` branch uses ports:

- Ports disconnect unpredictably in Firefox sidebars
- Heartbeat mechanism adds 500 lines of complex code
- storage.onChanged is more reliable in Firefox MV2
- Simpler architecture with fewer failure modes

### Why NOT Using storage.session

Although Firefox 115+ supports it:

- Session storage clears on browser close (user loss)
- Sidebar still needs persistent state across restarts
- Main storage layer (storage.local) is most reliable

---

## SUMMARY: DESIGN PRINCIPLES

This architecture succeeds because it:

1. **Embraces Firefox MV2 strengths** (storage.local + storage.onChanged)
2. **Detects failures early** (checksum verification, age checks, timeouts)
3. **Recovers gracefully** (corruption detection, fallback messages, health
   probes)
4. **Keeps state single-source-of-truth** (background authoritative)
5. **Avoids race conditions** (initialization barrier, serial rendering)
6. **Stays simple** (no complex port lifecycle, no heartbeat)
7. **Scales to 100+ tabs** (efficient DOM reconciliation, render queue)
8. **Achieves 100-200ms latency** (storage I/O is bottleneck, acceptable)

---

## NEXT STEPS FOR COPILOT

1. Read this entire specification
2. Implement background script foundation (state structure, persistence)
3. Implement sidebar initialization and storage listener
4. Implement render queue and DOM reconciliation
5. Add comprehensive error handling and logging
6. Test with 50+ Quick Tabs simultaneously
7. Measure actual latencies and adjust debounce if needed
8. Verify corruption detection works correctly
