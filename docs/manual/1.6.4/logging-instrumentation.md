# Logging & Instrumentation Guide

**Document Purpose:** Define logging formats, what to log, and log levels  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Important - Use for consistent debugging and diagnostics  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document specifies:

- Log format and prefixes
- What to log at each phase
- Log levels (DEBUG, INFO, WARN, ERROR)
- Sample log outputs
- Performance measurement

### Key Principles

- **Consistency:** Same format everywhere
- **Traceability:** Correlation IDs link related logs
- **Observability:** Enough detail to debug without noise
- **Performance:** Logging overhead < 5ms

---

## LOG FORMAT & PREFIXES

### Standard Log Format

All logs follow this pattern:

```
[Context] ACTION: detail1=value1 detail2=value2 ... correlationId={id}
```

**Where:**

- `[Context]` = Where the log originates
  - `[Background]` = Background script
  - `[Manager]` = Sidebar manager
  - `[Content]` = Content script
  - `[Storage]` = Storage event
- `ACTION` = What happened
- `detail1=value1` = Key-value pairs
- `correlationId={id}` = Unique trace ID (optional but recommended)

### Example Logs

```javascript
// Good
console.log(
  '[Background] CREATE_QUICK_TAB received url=https://example.com originTabId=42'
);
console.log('[Manager] STATE_SYNC revision=1000 tabCount=5 latency=45ms');
console.error('[Manager] CHECKSUM_MISMATCH stored=abc123 computed=def456');

// Bad
console.log('quick tab created');
console.error('error');
console.warn('thing');
```

---

## LOG LEVELS

### DEBUG (console.debug)

**When:** Development/verbose troubleshooting

**Examples:**

- Render queue processing
- Storage read operations
- Message send/receive
- State updates

```javascript
console.debug(
  '[Manager] RENDER_DEQUEUE revision=1000 source=storage-event queueSize=2'
);
console.debug(
  '[Background] STORAGE_READ key=quick_tabs_state_v2 sizeBytes=15234'
);
```

---

### INFO (console.info)

**When:** Normal operation milestones

**Examples:**

- Initialization complete
- Quick Tab created/deleted
- State persisted
- Orphan cleanup completed

```javascript
console.info(
  '[Background] QUICK_TAB_CREATED id=qt-1702000000000-abc123 url=https://example.com'
);
console.info('[Manager] INITIALIZATION_COMPLETE latency=85ms tabCount=0');
console.info('[Background] ORPHAN_CLEANUP_COMPLETED removed=3 remaining=12');
```

---

### WARN (console.warn)

**When:** Unexpected but recoverable

**Examples:**

- Stale revision received
- Event older than threshold
- Backup write failed
- Message timeout

```javascript
console.warn('[Manager] STALE_REVISION received=500 expected>501');
console.warn('[Manager] EVENT_TOO_OLD age=350000ms ignoring');
console.warn('[Background] SYNC_BACKUP_FAILED error=QuotaExceededError');
console.warn(
  '[Manager] MESSAGE_TIMEOUT action=GET_QUICK_TABS_STATE waitTime=3000ms'
);
```

---

### ERROR (console.error)

**When:** Error or failure

**Examples:**

- Invalid state received
- Checksum mismatch
- Storage write failed
- Initialization failed

```javascript
console.error('[Manager] INVALID_STATE_RECEIVED tabs=null');
console.error('[Manager] CHECKSUM_MISMATCH stored=abc123 computed=def456');
console.error('[Background] STORAGE_WRITE_FAILED error=QuotaExceededError');
console.error(
  '[Manager] INITIALIZATION_FAILED error=Timeout correlationId=req-1702000000000-abc'
);
```

---

## INITIALIZATION PHASE LOGGING

### Step 1: DOMContentLoaded

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  console.info('[Manager] DOM_CONTENT_LOADED');
  _createInitializationBarrier();

  // ... rest of init
});
```

**Log Output:**

```
[Manager] DOM_CONTENT_LOADED
```

---

### Step 2: Initial State Request

```javascript
try {
  console.debug('[Manager] STATE_REQUEST_SENT requestId=req-1702000000000-abc');
  const initialState = await browser.runtime.sendMessage({
    action: 'GET_QUICK_TABS_STATE',
    requestId: _generateRequestId()
  });
  console.info('[Manager] STATE_REQUEST_RECEIVED latency=32ms tabCount=5');
  // ... process state
```

**Log Output:**

```
[Manager] STATE_REQUEST_SENT requestId=req-1702000000000-abc
[Manager] STATE_REQUEST_RECEIVED latency=32ms tabCount=5
```

---

### Step 3: Barrier Resolution

```javascript
_isInitPhaseComplete = true;
initializationResolve();
console.info('[Manager] INITIALIZATION_BARRIER_RESOLVED');

renderQuickTabsList(sidebarLocalState.tabs);
_processInitPhaseMessageQueue();
```

**Log Output:**

```
[Manager] INITIALIZATION_BARRIER_RESOLVED
[Manager] QUEUED_MESSAGES_PROCESSED count=3
```

---

### Step 4: Error Handling

```javascript
catch (err) {
  console.error('[Manager] INITIALIZATION_FAILED error=' + err.message +
                ' correlationId=' + errorContext.requestId);
  initializationReject(err);
}
```

**Log Output:**

```
[Manager] INITIALIZATION_FAILED error=Invalid state structure correlationId=req-1702000000000-abc
```

---

## STORAGE SYNC LOGGING

### Storage Event Received

```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  const stateChange = changes['quick_tabs_state_v2'];

  console.debug(
    '[Manager] STORAGE_EVENT_RECEIVED areaName=' +
      areaName +
      ' hasState=' +
      (stateChange !== undefined)
  );

  // ... validation
});
```

**Log Output:**

```
[Manager] STORAGE_EVENT_RECEIVED areaName=local hasState=true
```

---

### State Validation

```javascript
if (!newState || !Array.isArray(newState.tabs)) {
  console.warn('[Manager] INVALID_STATE_STRUCTURE received=undefined');
  return;
}

if (newState.revision <= sidebarLocalState.revisionReceived) {
  console.debug(
    '[Manager] STALE_REVISION received=' +
      newState.revision +
      ' lastProcessed=' +
      sidebarLocalState.revisionReceived
  );
  return;
}

const expectedChecksum = _computeStateChecksum(newState.tabs);
if (newState.checksum !== expectedChecksum) {
  console.error(
    '[Manager] CHECKSUM_MISMATCH expected=' +
      expectedChecksum +
      ' received=' +
      newState.checksum +
      ' tabCount=' +
      newState.tabs.length
  );
  _requestStateRepair();
  return;
}

console.info(
  '[Manager] STATE_SYNC revision=' +
    newState.revision +
    ' tabCount=' +
    newState.tabs.length +
    ' latency=' +
    (Date.now() - changes['quick_tabs_state_v2'].oldValue.lastModified) +
    'ms'
);
```

**Log Output:**

```
[Manager] STALE_REVISION received=500 lastProcessed=501
[Manager] CHECKSUM_MISMATCH expected=v1:5:abc123 received=v1:5:def456 tabCount=5
[Manager] STATE_SYNC revision=501 tabCount=5 latency=45ms
```

---

## RENDER LOGGING

### Schedule Render

```javascript
function scheduleRender(source, revision) {
  if (revision === sidebarLocalState.lastRenderedRevision) {
    console.debug('[Manager] RENDER_DEDUP revision=' + revision);
    return;
  }

  clearTimeout(_renderDebounceTimer);
  _renderQueue.push({ source, revision, timestamp: Date.now() });

  console.debug(
    '[Manager] RENDER_SCHEDULED source=' +
      source +
      ' revision=' +
      revision +
      ' queueSize=' +
      _renderQueue.length
  );

  _renderDebounceTimer = setTimeout(() => {
    _processRenderQueue();
  }, 100);
}
```

**Log Output:**

```
[Manager] RENDER_DEDUP revision=500
[Manager] RENDER_SCHEDULED source=storage-event revision=501 queueSize=1
```

---

### Process Render Queue

```javascript
async function _processRenderQueue() {
  if (_renderInProgress || _renderQueue.length === 0) return;

  _renderInProgress = true;
  const startTime = performance.now();

  console.debug('[Manager] RENDER_START queueSize=' + _renderQueue.length);

  try {
    const latestRender = _renderQueue[_renderQueue.length - 1];
    _renderQuickTabsWithReconciliation(sidebarLocalState.tabs);
    sidebarLocalState.lastRenderedRevision = latestRender.revision;

    const duration = performance.now() - startTime;
    console.info(
      '[Manager] RENDER_COMPLETE duration=' +
        duration.toFixed(1) +
        'ms ' +
        'tabCount=' +
        sidebarLocalState.tabs.length +
        ' revision=' +
        latestRender.revision
    );
  } catch (err) {
    console.error('[Manager] RENDER_ERROR error=' + err.message);
  } finally {
    _renderInProgress = false;
    _renderQueue.length = 0;

    if (_renderQueue.length > 0) {
      scheduleRender(_renderQueue[0].source, _renderQueue[0].revision);
    }
  }
}
```

**Log Output:**

```
[Manager] RENDER_START queueSize=2
[Manager] RENDER_COMPLETE duration=23.4ms tabCount=5 revision=501
```

---

## MESSAGE LOGGING

### Message Sent

```javascript
async function sendMessageToBackground(message) {
  const startTime = performance.now();
  const correlationId =
    'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);

  console.debug(
    '[Manager] MESSAGE_SENT action=' +
      message.action +
      ' correlationId=' +
      correlationId
  );

  try {
    const response = await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 3000)
      )
    ]);

    const latency = performance.now() - startTime;
    console.info(
      '[Manager] MESSAGE_RECEIVED action=' +
        message.action +
        ' latency=' +
        latency.toFixed(1) +
        'ms ' +
        ' success=' +
        response.success +
        ' correlationId=' +
        correlationId
    );

    return response;
  } catch (err) {
    const latency = performance.now() - startTime;
    console.error(
      '[Manager] MESSAGE_ERROR action=' +
        message.action +
        ' error=' +
        err.message +
        ' latency=' +
        latency.toFixed(1) +
        'ms ' +
        ' correlationId=' +
        correlationId
    );
    throw err;
  }
}
```

**Log Output:**

```
[Manager] MESSAGE_SENT action=GET_QUICK_TABS_STATE correlationId=msg-1702000000000-abc123
[Manager] MESSAGE_RECEIVED action=GET_QUICK_TABS_STATE latency=45.2ms success=true correlationId=msg-1702000000000-abc123
```

---

## BACKGROUND SCRIPT LOGGING

### Quick Tab Operations

```javascript
// CREATE
console.info(
  '[Background] CREATE_QUICK_TAB id=' +
    newId +
    ' url=' +
    request.url +
    ' originTabId=' +
    request.currentTabId
);

// UPDATE
console.info(
  '[Background] UPDATE_QUICK_TAB id=' +
    request.quickTabId +
    ' updates=' +
    Object.keys(request.updates).join(',')
);

// DELETE
console.info('[Background] DELETE_QUICK_TAB id=' + request.quickTabId);
```

**Log Output:**

```
[Background] CREATE_QUICK_TAB id=qt-1702000000000-abc123 url=https://example.com originTabId=42
[Background] UPDATE_QUICK_TAB id=qt-1702000000000-abc123 updates=position,minimized
[Background] DELETE_QUICK_TAB id=qt-1702000000000-abc123
```

---

### Storage Persistence

```javascript
async function _persistToStorage() {
  const startTime = performance.now();
  console.debug(
    '[Background] PERSIST_START tabCount=' + globalQuickTabState.tabs.length
  );

  try {
    await browser.storage.local.set({ [STORAGE_KEY]: stateToWrite });

    const duration = performance.now() - startTime;
    console.info(
      '[Background] PERSIST_COMPLETE duration=' +
        duration.toFixed(1) +
        'ms ' +
        ' revision=' +
        _storageRevision
    );
  } catch (err) {
    console.error('[Background] PERSIST_ERROR error=' + err.message);
  }
}
```

**Log Output:**

```
[Background] PERSIST_START tabCount=5
[Background] PERSIST_COMPLETE duration=28.4ms revision=1702000010001
```

---

## SAMPLE COMPLETE LOG SEQUENCE

### Scenario: User creates Quick Tab and sidebar updates

```
[Manager] DOM_CONTENT_LOADED
[Manager] STATE_REQUEST_SENT requestId=req-1702000000000-abc123
[Background] STATE_REQUEST_RECEIVED action=GET_QUICK_TABS_STATE
[Manager] STATE_REQUEST_RECEIVED latency=32ms tabCount=0
[Manager] INITIALIZATION_BARRIER_RESOLVED
[Content] QUICK_TAB_CREATE_TRIGGERED url=https://github.com

[Manager] MESSAGE_SENT action=CREATE_QUICK_TAB correlationId=msg-1702000000001-def456
[Background] CREATE_QUICK_TAB id=qt-1702000000002-xyz789 url=https://github.com originTabId=42
[Background] PERSIST_START tabCount=1
[Background] PERSIST_COMPLETE duration=35.2ms revision=1702000010001

[Manager] STORAGE_EVENT_RECEIVED areaName=local hasState=true
[Manager] STATE_SYNC revision=1702000010001 tabCount=1 latency=45ms
[Manager] RENDER_SCHEDULED source=storage-event revision=1702000010001 queueSize=1
[Manager] RENDER_START queueSize=1
[Manager] RENDER_COMPLETE duration=18.3ms tabCount=1 revision=1702000010001

[Manager] MESSAGE_RECEIVED action=CREATE_QUICK_TAB latency=125.4ms success=true correlationId=msg-1702000000001-def456
```

**Analysis:**

- Total time: ~125ms (within 200ms goal)
- Each phase logged with timing
- Correlation IDs link related operations
- Error path would have ERROR level logs

---

## PERFORMANCE LOGGING

### Latency Measurement

Track end-to-end latency for key operations:

```javascript
// Sidebar
console.info(
  '[Manager] E2E_LATENCY operation=CREATE_QUICK_TAB ' +
    'userAction=+125ms ' +
    'messageLatency=+45ms ' +
    'storageEvent=+15ms ' +
    'render=+20ms ' +
    'total=205ms'
);

// Operations should be:
// - Create: 100-200ms
// - Update: 50-150ms
// - Delete: 50-150ms
// - State sync: 10-100ms
```

---

## LOG CLEANUP & ROTATION

### Browser Console

- No automatic cleanup (user can clear console)
- Recommend: Keep last 100 messages in buffer

### Performance Concerns

- Logging overhead: < 5ms per operation
- JSON.stringify calls: Minimal (only on errors)
- String concatenation: Preferred over template literals (faster)

---

## DEBUG MODE

### Enable Debug Logging

```javascript
const DEBUG_MODE = true; // Set to true for verbose logging

if (DEBUG_MODE) {
  console.debug('[Manager] DEBUG_MODE enabled, extra logging active');
}

// In functions:
if (DEBUG_MODE) {
  console.debug('[Manager] EXTRA_DEBUG info=' + JSON.stringify(state));
}
```

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial logging and instrumentation guide
