# File-by-File Change Guide

**Document Purpose:** Identify what changes are needed in each source file  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Critical - Use as checklist during implementation  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document maps each source file to the changes needed:
- What stays
- What goes
- What changes
- New imports/exports
- Function signature changes

### Key Files

| File | Type | Status | Impact |
|------|------|--------|--------|
| `background.js` | Core | Major changes | Simplify state, remove port handlers |
| `sidebar/quick-tabs-manager.js` | UI Controller | Major changes | Remove port connection, simplify init |
| `src/background/handlers/QuickTabHandler.js` | Handler | Minor changes | Remove port message handler |
| `src/background/MessageRouter.js` | Router | Minor changes | Keep routing logic |
| `sidebar/modules/*.js` | Utilities | Cleanup | Remove unused state exports |
| `content.js` | Trigger | No changes | Keep as-is |

---

## FILE 1: `background.js`

### Overview
The main background script. Currently ~1000 lines with port logic, complex persistence, quota monitoring.

### What Stays

**Core state management:**
```javascript
// Keep this structure exactly
const globalQuickTabState = {
  tabs: [],
  lastModified: 0,
  isInitialized: false
};

let _storageWriteSequence = 0;
let _storageRevision = Date.now();
```

**Basic initialization:**
```javascript
// Keep this pattern
async function initializeState() {
  // Load from storage
  // Validate
  // Set isInitialized = true
}
```

**Message handlers:**
- `browser.runtime.onMessage.addListener()` - KEEP
- Handler for `GET_QUICK_TABS_STATE` - KEEP
- Handler for `CREATE_QUICK_TAB` - KEEP (refactor if needed)
- Handler for `UPDATE_QUICK_TAB` - KEEP
- Handler for `DELETE_QUICK_TAB` - KEEP

**Storage operations:**
- `browser.storage.local.set()` calls - KEEP
- `browser.storage.onChanged.addListener()` in background - KEEP
- Basic error logging - KEEP

**Backup functionality:**
- `storage.sync` backup write - KEEP (non-blocking)

### What Goes

**Port-related code (300+ lines):**
- `browser.runtime.onConnect.addListener()` - DELETE
- `_handleSidebarPortMessage()` function - DELETE
- All port connection logic - DELETE
- Port state variables (`connectedPorts`, `portMap`, etc.) - DELETE

**Complex persistence (200+ lines):**
- `_handleStorageWriteFailure()` function - DELETE
- `_performWriteAttempt()` function - DELETE
- `_retryWithBackoff()` function - DELETE
- Exponential backoff constants - DELETE
- Quota monitoring - DELETE
- `_monitorStorageQuota()` interval - DELETE

**Verification logic (150+ lines):**
- `_validateWriteReadback()` function - SIMPLIFY (keep basic check)
- Corruption recovery with multiple tiers - DELETE
- Complex error classification - DELETE

**Orphan cleanup (50+ lines):**
- Keep `browser.alarms` pattern - KEEP
- Simplify logic inside it - SIMPLIFY

### What Changes

#### Function: `_persistToStorage()`

**Current state:** 50+ lines with retry logic and error handling

**New implementation:** Simplified to 20-30 lines
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
  }
}
```

**Changes:**
- Remove all retry logic
- Remove error classification
- Remove quota monitoring calls
- Keep simple try/catch
- Keep write validation
- Keep backup write

#### Constants to Keep

```javascript
const STORAGE_KEY = 'quick_tabs_state_v2';
const ENABLE_SYNC_BACKUP = true;
// Keep: ORPHAN_CLEANUP_INTERVAL_MS (hourly)
```

#### Constants to Delete

```javascript
// DELETE all of these:
const STORAGE_VERIFICATION_RETRY_MS = [1000, 2000, 4000];
const LISTENER_REGISTRATION_TIMEOUT_MS = 3000;
const PROBE_MIN_INTERVAL_MS = 500;
const PROBE_FORCE_RESET_MS = 1000;
const HOST_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const HOST_INFO_CLEANUP_INTERVAL_MS = 60000;
const MESSAGE_ID_MAX_AGE_MS = 5000;
const MESSAGE_DEDUP_MAX_SIZE = 1000;
const RENDER_QUEUE_DEBOUNCE_MS = 100;
const RENDER_STALL_TIMEOUT_MS = 5000;
const RENDER_QUEUE_MAX_SIZE = 10;
const RENDER_RECOVERY_DELAY_MS = 50;
// ... any other magic numbers for probes, quotas, retries
```

### New Imports Needed

```javascript
// None needed - remove all port/quota related imports
// Keep existing imports for browser API, handlers
```

### New Exports

None needed (background script is not an ES module in typical setup).

---

## FILE 2: `sidebar/quick-tabs-manager.js`

### Overview
The sidebar manager. Currently ~1500 lines with port connection, complex init, multi-layer dedup.

### What Stays

**Core DOM elements:**
- `containersList` DOM reference - KEEP
- Quick Tab DOM element creation - KEEP
- DOM reconciliation logic - KEEP

**Storage listener:**
- `browser.storage.onChanged.addListener()` - KEEP (primary mechanism)

**Render queue:**
- `_renderQueue` array - KEEP
- `scheduleRender()` function - KEEP (basic version)
- `_processRenderQueue()` function - KEEP
- `_renderInProgress` flag - KEEP
- Debounce logic (100ms) - KEEP

**State validation:**
- Revision checking - KEEP
- Checksum validation for storage - KEEP

### What Goes

**Port connection (500+ lines):**
- `connectToBackground()` function - DELETE
- `_establishPortConnection()` function - DELETE
- `_setupPortListeners()` function - DELETE
- `_handlePortDisconnect()` function - DELETE
- `backgroundPort` variable - DELETE
- Port message queue - DELETE
- `_flushPortMessageQueue()` function - DELETE
- Heartbeat functions - DELETE
- `startHeartbeat()`, `stopHeartbeat()`, `sendHeartbeat()` - DELETE
- All heartbeat state variables - DELETE

**Complex initialization (400+ lines):**
- `_initializeStorageListener()` - DELETE
- `_verifyStorageListenerWithRetry()` - DELETE
- Storage verification test key writes - DELETE
- Multi-phase init tracking - DELETE
- `initializationStarted`, `initializationComplete` variables - DELETE
- `currentInitPhase` variable - DELETE
- `preInitMessageQueue` - DELETE
- `_queueMessageDuringInit()` - DELETE
- `_processQueuedMessages()` - DELETE

**Multi-layer dedup (250+ lines):**
- `recentlyProcessedMessageIds` map - DELETE
- `_messageIdTimestamps` map - DELETE
- `_revisionEventBuffer` - DELETE
- `_addProcessedMessageId()` - DELETE
- `_cleanupExpiredMessageIds()` - DELETE
- `_slidingWindowEviction()` - DELETE
- `_bufferRevisionEvent()` - DELETE
- `_processBufferedRevisionEvents()` - DELETE

**Render stall detection (100+ lines):**
- `_renderStallTimerId` - DELETE
- `_startRenderStallTimer()` - DELETE
- `_clearRenderStallTimer()` - DELETE
- `_handleRenderStall()` - DELETE
- Render stall recovery logic - DELETE

**Render corruption validation (80+ lines):**
- `_validateRenderIntegrity()` - DELETE (before/after validation)
- Render corruption recovery attempts - DELETE

**Storage probes (150+ lines):**
- `_lastStorageEventTime` - DELETE
- `_probeInProgress` flag - DELETE
- `_canStartProbe()` - DELETE
- `_startStorageProbe()` - DELETE
- `_completeStorageProbe()` - DELETE
- `_checkStorageHealth()` - DELETE
- Probe interval running - DELETE

### What Changes

#### Function: Initialization Pattern

**Current state:** Multiple phases with verification and queueing

**New implementation:**
```javascript
let initializationPromise = null;
let initializationResolve = null;
let initializationReject = null;
const _initPhaseMessageQueue = [];
let _isInitPhaseComplete = false;

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

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  
  if (!_isInitPhaseComplete) {
    _initPhaseMessageQueue.push({ changes, timestamp: Date.now() });
    return;
  }
  
  _handleStorageChangedEvent(changes);
});

document.addEventListener('DOMContentLoaded', async () => {
  _createInitializationBarrier();
  
  try {
    const initialState = await browser.runtime.sendMessage({
      action: 'GET_QUICK_TABS_STATE',
      requestId: _generateRequestId()
    });
    
    if (!initialState || !Array.isArray(initialState.tabs)) {
      throw new Error('Invalid initial state received');
    }
    
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

async function _processInitPhaseMessageQueue() {
  const queued = _initPhaseMessageQueue.splice(0);
  for (const { changes } of queued) {
    _handleStorageChangedEvent(changes);
  }
}
```

**Changes:**
- Remove all verification/retry logic
- Remove phase tracking variables
- Keep simple barrier pattern
- Remove queue complexity
- Just wait for initial state load

#### Function: `_handleStorageChangedEvent()`

**Current state:** Multiple guards, buffer management, phase checking

**New implementation:**
```javascript
async function _handleStorageChangedEvent(changes) {
  const stateChange = changes['quick_tabs_state_v2'];
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
    tabs: newState.tabs.slice(),
    lastModified: newState.lastModified,
    revisionReceived: newState.revision,
    writeSequence: newState.writeSequence
  };
  
  // Schedule render (debounced, serialized)
  scheduleRender('storage-event', newState.revision);
}
```

**Changes:**
- Remove buffer management
- Remove phase detection
- Remove message ID dedup checks
- Keep core validation guards
- Keep revision check
- Keep checksum check

#### Function: `scheduleRender()`

**Current state:** 30+ lines with queue management and stall detection

**New implementation:**
```javascript
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
  }, 100);
}
```

**Changes:**
- Remove queue size check
- Remove stall timer
- Keep basic debounce
- Keep dedup by revision

#### Function: `_processRenderQueue()`

**Current state:** 50+ lines with stall detection and corruption recovery

**New implementation:**
```javascript
async function _processRenderQueue() {
  if (_renderInProgress || _renderQueue.length === 0) return;
  
  _renderInProgress = true;
  
  try {
    const latestRender = _renderQueue[_renderQueue.length - 1];
    
    _renderQuickTabsWithReconciliation(sidebarLocalState.tabs);
    
    sidebarLocalState.lastRenderedRevision = latestRender.revision;
  } catch (err) {
    console.error('[Manager] Render error:', err);
  } finally {
    _renderInProgress = false;
    _renderQueue.length = 0;
    
    if (_renderQueue.length > 0) {
      scheduleRender(_renderQueue[0].source, _renderQueue[0].revision);
    }
  }
}
```

**Changes:**
- Remove stall timer calls
- Remove corruption validation before/after
- Remove recovery logic
- Keep basic try/catch
- Keep simple cleanup

### Constants to Keep

```javascript
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';
const INIT_BARRIER_TIMEOUT_MS = 10000;
const RENDER_QUEUE_DEBOUNCE_MS = 100;
const MESSAGE_TIMEOUT_MS = 3000;
```

### Constants to Delete

```javascript
// DELETE all of these:
const STORAGE_VERIFICATION_RETRY_MS = [1000, 2000, 4000];
const LISTENER_REGISTRATION_TIMEOUT_MS = 3000;
const VISIBILITY_REFRESH_INTERVAL_MS = 15000;
const DEDUP_CLEANUP_THRESHOLD = 0.5;
const DEDUP_EVICTION_THRESHOLD = 0.95;
const PROBE_MIN_INTERVAL_MS = 500;
const PROBE_FORCE_RESET_MS = 1000;
const HOST_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const HOST_INFO_CLEANUP_INTERVAL_MS = 60000;
const MESSAGE_ID_MAX_AGE_MS = 5000;
const MESSAGE_DEDUP_MAX_SIZE = 1000;
const RENDER_STALL_TIMEOUT_MS = 5000;
const RENDER_QUEUE_MAX_SIZE = 10;
const RENDER_RECOVERY_DELAY_MS = 50;
const DEBUG_MESSAGING = true;
```

### New Imports Needed

```javascript
// Remove all these imports:
// - Port-related utilities
// - Initialization barrier utilities (if in modules)
// - Health metrics utilities
// - Storage probe utilities

// Keep existing imports for:
// - Render helpers
// - Tab operations
// - Validation utilities
```

### New Message Handler

Add this handler:
```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'QUICK_TAB_OPERATION_ACK') {
    const { operationId, operationSequence } = message;
    
    if (operationSequence <= sidebarLocalState.writeSequence) {
      sendResponse({ received: true });
      return;
    }
    
    sidebarLocalState.writeSequence = operationSequence;
    scheduleRender('operation-ack', operationSequence);
    
    sendResponse({ received: true });
  }
});
```

---

## FILE 3: `src/background/handlers/QuickTabHandler.js`

### Overview
Handler for Quick Tab operations (create, update, delete).

### What Stays

**Operation handlers:**
- `handleCreateQuickTab()` - KEEP (refactor if needed)
- `handleUpdateQuickTab()` - KEEP
- `handleDeleteQuickTab()` - KEEP
- `handleDeleteAllQuickTabs()` - KEEP

**Validation:**
- Input validation - KEEP
- State validation - KEEP

### What Goes

**Port-specific handling:**
- Any port message routing - DELETE
- Port acknowledgment sending - DELETE

### What Changes

**Return values:**
- Ensure all handlers return `{ success, data, error }` format
- Remove port-specific response handling
- Use plain `runtime.sendMessage` responses

---

## FILE 4: `src/background/MessageRouter.js`

### Overview
Routes messages from sidebar/content scripts to appropriate handlers.

### What Stays

**Core routing logic:**
- Message action routing - KEEP
- Handler dispatch - KEEP
- Error handling - KEEP

### What Goes

**Port-specific routing:**
- Port vs. message differentiation - DELETE
- Port message queue management - DELETE

### What Changes

**Route handling:**
- Simplify to single path (all via `runtime.onMessage`)
- Remove fallback branching

---

## FILE 5: `sidebar/modules/` Directory

### Files to Review

```
sidebar/modules/
├── init-barrier.js           // Check if state exports still used
├── health-metrics.js         // DELETE or reduce
├── storage-handlers.js       // KEEP, might simplify
├── tab-operations.js         // KEEP
├── validation.js             // KEEP
└── index.js                  // Update exports
```

### What to Do

- `init-barrier.js`: If it exports state vars, those are now handled locally in manager
- `health-metrics.js`: DELETE if only used for probes/quotas
- Others: KEEP but verify no unused exports

---

## FILE 6: `content.js`

### Overview
Content script that triggers Quick Tab creation.

### What Stays

**All of it.** No changes needed.

---

## FILE 7: `manifest.json`

### What Changes

**Permissions:**
- Remove if any port-specific permissions were added
- Keep all storage permissions
- Keep all tab permissions

**Background script:**
- Should already be configured
- No changes needed

---

## CHANGE SUMMARY TABLE

| File | Lines Changed | Functions Deleted | Functions Added | Complexity Impact |
|------|----------------|-------------------|-----------------|-------------------|
| `background.js` | 200-250 | 15+ | 0 | Simpler |
| `sidebar/quick-tabs-manager.js` | 400-500 | 25+ | 1 | Much simpler |
| `QuickTabHandler.js` | 50-100 | 2 | 0 | Simpler |
| `MessageRouter.js` | 20-50 | 0 | 0 | Simpler |
| `sidebar/modules/` | 100-200 | 5+ | 0 | Cleanup |
| `content.js` | 0 | 0 | 0 | No change |
| **TOTAL** | **770-1100** | **47+** | **1** | **Significantly simpler** |

---

## IMPLEMENTATION ORDER

### Phase 1: Safe Deletions (low risk)

1. Delete health probe functions from sidebar
2. Delete quota monitoring from background
3. Delete dedup cleanup functions
4. Delete heartbeat functions

### Phase 2: Refactoring (medium risk)

1. Simplify `_persistToStorage()` in background
2. Simplify `_handleStorageChangedEvent()` in sidebar
3. Simplify `scheduleRender()` in sidebar
4. Update initialization pattern

### Phase 3: Port Removal (higher risk)

1. Remove all port connection code from sidebar
2. Remove port message handlers from background
3. Remove port-related imports
4. Replace `sendWithAck()` calls with `runtime.sendMessage()`

### Phase 4: Cleanup

1. Delete unused constants
2. Delete unused utility functions
3. Remove unused imports
4. Update module exports

---

## VALIDATION CHECKLIST

After all changes, verify:

- [ ] Linter passes with 0 errors
- [ ] No undefined function references
- [ ] All message handlers return correct format
- [ ] All async operations have proper error handling
- [ ] No orphaned intervals/timers still running
- [ ] Sidebar renders correctly with 10+ Quick Tabs
- [ ] Quick Tab operations (create/update/delete) work
- [ ] Storage events properly trigger sidebar updates
- [ ] Initialization completes in <1000ms
- [ ] All log messages use correct prefixes
- [ ] No console errors on startup

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial file-by-file change guide

