# Message Protocol Specification

**Document Purpose:** Define all message types and request/response patterns  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Critical - Use as reference for message handling implementation  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document specifies all message types exchanged between:

- **Background Script ↔ Sidebar Manager**
- **Background Script ↔ Content Script**
- **Sidebar Manager ↔ Content Script** (minimal direct communication)

### Key Principles

- **Request/Response Pattern:** All messages use stateless `runtime.sendMessage`
- **Timeout Handling:** 3 second timeout on all message waits
- **Error Handling:** All responses include explicit success/error fields
- **Logging:** All messages logged with correlationId for tracing

---

## MESSAGE CATEGORIES

### Category 1: State Retrieval (Background → Sidebar)

#### Message: `GET_QUICK_TABS_STATE`

**Purpose:** Sidebar requests complete Quick Tab state from background

**Sender:** Sidebar Manager  
**Receiver:** Background Script  
**Direction:** Request → Response

**Request Schema:**

```javascript
{
  action: 'GET_QUICK_TABS_STATE',
  requestId: 'req-1702000000000-abc123',  // Unique request ID (correlationId)
  includeMetadata: true                    // Optional: include revision, checksum
}
```

**Request Fields:**

- `action` (string, required): Literal value `'GET_QUICK_TABS_STATE'`
- `requestId` (string, required): Unique correlation ID for logging
  - Format: `req-{timestamp}-{randomId}` or UUID
  - Used to trace request through logs
- `includeMetadata` (boolean, optional): If true, include revision/checksum in
  response
  - Default: `true`

**Response Schema:**

```javascript
{
  success: true,
  data: {
    tabs: [
      {
        id: 'qt-1702000000000-abc123',
        url: 'https://example.com',
        originTabId: 42,
        position: { left: 100, top: 200 },
        size: { width: 800, height: 600 },
        minimized: false,
        creationTime: 1702000000000,
        lastModified: 1702000010000
      },
      // ... more tabs
    ],
    lastModified: 1702000010000,
    revision: 1702000010001,       // Only if includeMetadata = true
    checksum: 'v1:2:a1b2c3d4'      // Only if includeMetadata = true
  },
  error: null,
  requestId: 'req-1702000000000-abc123'  // Echo back for correlation
}
```

**Response Fields:**

- `success` (boolean, required): `true` if state retrieved successfully
- `data` (object, required if success): Contains state
  - `tabs` (array): All Quick Tab objects
  - `lastModified` (number): Timestamp
  - `revision` (number): Current revision (if requested)
  - `checksum` (string): State checksum (if requested)
- `error` (string|null, required): Error message if `success = false`
- `requestId` (string, required): Echo of request's `requestId`

**Error Responses:**

```javascript
// If background not initialized
{
  success: false,
  error: 'Background script not initialized',
  requestId: 'req-1702000000000-abc123'
}

// If storage read fails
{
  success: false,
  error: 'Failed to read state from storage: QuotaExceededError',
  requestId: 'req-1702000000000-abc123'
}
```

**Timeout:** 3000ms

**Logging:**

```
[Sidebar] GET_QUICK_TABS_STATE sent requestId={requestId}
[Background] GET_QUICK_TABS_STATE received, returning {tabCount} tabs
[Sidebar] GET_QUICK_TABS_STATE response received, latency={ms}ms
```

---

### Category 2: Quick Tab Operations (Background → Multiple Senders)

#### Message: `CREATE_QUICK_TAB`

**Purpose:** Create new Quick Tab

**Sender:** Content Script (via user action)  
**Receiver:** Background Script

**Request Schema:**

```javascript
{
  action: 'CREATE_QUICK_TAB',
  url: 'https://example.com',
  currentTabId: 42,                    // Browser tab creating the Quick Tab
  title: 'Page Title',                 // Optional
  favicon: 'data:image/png;base64,...' // Optional
}
```

**Request Fields:**

- `action` (string, required): Literal `'CREATE_QUICK_TAB'`
- `url` (string, required): URL of Quick Tab (http/https)
- `currentTabId` (number, required): ID of browser tab that triggered creation
- `title` (string, optional): Page title
- `favicon` (string, optional): Base64 data URI of favicon

**Response Schema:**

```javascript
{
  success: true,
  data: {
    id: 'qt-1702000000000-abc123',     // New Quick Tab ID
    position: { left: 100, top: 200 },
    size: { width: 800, height: 600 }
  },
  error: null
}
```

**Response Fields:**

- `success` (boolean): `true` if created
- `data` (object, if success): Created Quick Tab info
  - `id` (string): Unique ID of new Quick Tab
  - `position` (object): Initial position
  - `size` (object): Initial size
- `error` (string|null): Error message if failed

**Error Responses:**

```javascript
{
  success: false,
  error: 'Invalid URL: must start with http/https'
}

{
  success: false,
  error: 'Current tab not found'
}
```

**Timeout:** 3000ms

---

#### Message: `UPDATE_QUICK_TAB`

**Purpose:** Update Quick Tab properties (position, size, minimized state)

**Sender:** Sidebar Manager (via user drag/resize/minimize)  
**Receiver:** Background Script

**Request Schema:**

```javascript
{
  action: 'UPDATE_QUICK_TAB',
  quickTabId: 'qt-1702000000000-abc123',
  updates: {
    position: { left: 150, top: 250 },    // Optional
    size: { width: 900, height: 700 },    // Optional
    minimized: true,                      // Optional
    title: 'New Title',                   // Optional
    containerColor: '#FF5733'             // Optional
  }
}
```

**Request Fields:**

- `action` (string, required): Literal `'UPDATE_QUICK_TAB'`
- `quickTabId` (string, required): ID of Quick Tab to update
- `updates` (object, required): Properties to update
  - Each field optional, only specified fields are updated
  - `position` (object): New { left, top }
  - `size` (object): New { width, height }
  - `minimized` (boolean): New minimized state
  - `title` (string): New title
  - `containerColor` (string): New color hex code

**Response Schema:**

```javascript
{
  success: true,
  data: {
    id: 'qt-1702000000000-abc123',
    lastModified: 1702000010005
  },
  error: null
}
```

**Error Responses:**

```javascript
{
  success: false,
  error: 'Quick Tab not found'
}

{
  success: false,
  error: 'Invalid position: left must be >= 0'
}
```

**Timeout:** 3000ms

---

#### Message: `DELETE_QUICK_TAB`

**Purpose:** Close/delete a Quick Tab

**Sender:** Sidebar Manager  
**Receiver:** Background Script

**Request Schema:**

```javascript
{
  action: 'DELETE_QUICK_TAB',
  quickTabId: 'qt-1702000000000-abc123'
}
```

**Request Fields:**

- `action` (string, required): Literal `'DELETE_QUICK_TAB'`
- `quickTabId` (string, required): ID of Quick Tab to delete

**Response Schema:**

```javascript
{
  success: true,
  data: {
    deletedId: 'qt-1702000000000-abc123'
  },
  error: null
}
```

**Error Responses:**

```javascript
{
  success: false,
  error: 'Quick Tab not found'
}
```

**Timeout:** 3000ms

---

#### Message: `DELETE_ALL_QUICK_TABS`

**Purpose:** Close all Quick Tabs at once

**Sender:** Sidebar Manager (via "Close All" button)  
**Receiver:** Background Script

**Request Schema:**

```javascript
{
  action: 'DELETE_ALL_QUICK_TABS',
  confirmDelete: true  // Safety flag
}
```

**Request Fields:**

- `action` (string, required): Literal `'DELETE_ALL_QUICK_TABS'`
- `confirmDelete` (boolean, required): Must be `true` to prevent accidents

**Response Schema:**

```javascript
{
  success: true,
  data: {
    deletedCount: 5,
    remainingTabs: 0
  },
  error: null
}
```

**Error Responses:**

```javascript
{
  success: false,
  error: 'confirmDelete must be true'
}
```

**Timeout:** 3000ms

---

### Category 3: Sidebar Notifications (Background → Sidebar)

#### Event: `storage.onChanged` (Primary State Sync)

**Purpose:** Background notifies sidebar of state changes via storage API

**Sender:** Background Script (via `browser.storage.local.set()`)  
**Receiver:** Sidebar Manager (storage.onChanged listener)

**Event Schema:**

```javascript
// In storage.onChanged listener
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  const change = changes['quick_tabs_state_v2'];
  if (!change) return;

  const newValue = change.newValue;
  // Structure:
  // {
  //   tabs: [...],
  //   lastModified: 1702000010000,
  //   writeSequence: 42,
  //   revision: 1702000010001,
  //   checksum: 'v1:5:a1b2c3d4'
  // }
});
```

**Event Structure:**

- `areaName` (string): Storage area ('local' or 'sync')
- `changes` (object): Changed keys
  - `'quick_tabs_state_v2'` (object):
    - `newValue`: New state object
    - `oldValue`: Previous state (may be undefined first time)

**Listener Processing:**

1. Check area is 'local'
2. Check change key is 'quick_tabs_state_v2'
3. Validate `newValue.tabs` is array
4. Check `newValue.revision > lastRevisionSeen`
5. Verify checksum matches
6. Update local cache
7. Schedule render

**Latency Goal:** 0-100ms from storage write to listener fire

---

### Category 4: Health Checks & Diagnostics

#### Message: `PING` (Keep-Alive)

**Purpose:** Verify background script is responsive

**Sender:** Sidebar Manager (periodically)  
**Receiver:** Background Script

**Request Schema:**

```javascript
{
  action: 'PING',
  timestamp: 1702000000000
}
```

**Response Schema:**

```javascript
{
  action: 'PONG',
  timestamp: 1702000000000,  // Echo request timestamp
  backgroundTime: 1702000000050
}
```

**Timeout:** 1000ms (shorter than main operations)

**Frequency:** Every 30 seconds (if no state updates)

---

#### Message: `GET_DIAGNOSTICS`

**Purpose:** Get diagnostic info for debugging

**Sender:** Sidebar Manager (on user request)  
**Receiver:** Background Script

**Request Schema:**

```javascript
{
  action: 'GET_DIAGNOSTICS';
}
```

**Response Schema:**

```javascript
{
  success: true,
  data: {
    uptime: 3600000,           // Background uptime in ms
    tabCount: 5,
    lastStateUpdate: 1702000010000,
    storageSize: 12345,        // Bytes
    errors: [                  // Recent errors
      { time: 1702000005000, message: 'Write failed' }
    ]
  }
}
```

**Timeout:** 3000ms

---

## MESSAGE FLOW DIAGRAMS

### Flow 1: Sidebar Initialization

```
Timeline:
  T=0ms:   Sidebar loads HTML
  T=10ms:  DOMContentLoaded fires
           └─ Create initializationPromise
           └─ Add storage.onChanged listener

  T=20ms:  Send GET_QUICK_TABS_STATE message
           ├─ Background receives
           ├─ Retrieves state from storage

  T=40ms:  Response received
           ├─ Validate state
           ├─ Update sidebarLocalState
           ├─ Resolve initializationPromise

  T=50ms:  Render initial UI
           └─ Display Quick Tabs
```

### Flow 2: User Creates Quick Tab

```
Timeline:
  T=0ms:   User clicks "New Quick Tab" button in sidebar
           └─ Content script: send CREATE_QUICK_TAB

  T=5ms:   Background receives CREATE_QUICK_TAB
           ├─ Generate new Quick Tab ID
           ├─ Add to globalQuickTabState.tabs
           ├─ Increment revision
           ├─ Write to storage.local

  T=35ms:  storage.onChanged fires in Background
           ├─ Background processes (updates _storageRevision)

  T=35ms:  storage.onChanged fires in Sidebar
           ├─ Sidebar validates revision
           ├─ Updates sidebarLocalState
           ├─ Schedules render (debounced 100ms)

  T=135ms: Render queue processes
           ├─ Renders new Quick Tab to DOM
           ├─ New Quick Tab visible to user
```

### Flow 3: Storage Event Deduplication

```
Scenario: Storage write triggers multiple onChanged events

Timeline:
  T=0ms:   Background writes state (revision = 1000)

  T=5ms:   storage.onChanged fires in Sidebar (event 1)
           ├─ Revision check: 1000 > lastRevision (0) ✓
           ├─ Process event
           └─ Set lastRevision = 1000

  T=6ms:   storage.onChanged fires in Sidebar (event 2 - duplicate)
           ├─ Revision check: 1000 <= lastRevision (1000) ✗
           ├─ Ignore event

  T=7ms:   storage.onChanged fires in Sidebar (event 3 - duplicate)
           ├─ Revision check: 1000 <= lastRevision (1000) ✗
           ├─ Ignore event
```

---

## ERROR HANDLING

### Standard Error Response

All error responses follow this format:

```javascript
{
  success: false,
  error: 'Descriptive error message',
  errorCode: 'ERROR_CODE_CONSTANT',  // Optional
  details: {                          // Optional
    fieldName: 'Specific details about what failed'
  }
}
```

### Error Categories

#### Validation Errors (400-level semantics)

```javascript
{
  success: false,
  error: 'Invalid URL format',
  errorCode: 'VALIDATION_ERROR',
  details: { field: 'url', value: 'not-a-url' }
}
```

#### Not Found Errors (404-level semantics)

```javascript
{
  success: false,
  error: 'Quick Tab not found',
  errorCode: 'NOT_FOUND',
  details: { quickTabId: 'qt-1702000000000-abc123' }
}
```

#### Server Errors (500-level semantics)

```javascript
{
  success: false,
  error: 'Failed to write state to storage',
  errorCode: 'STORAGE_ERROR',
  details: { storageError: 'QuotaExceededError' }
}
```

---

## TIMEOUT HANDLING

### Standard Timeouts

All messages default to **3000ms (3 seconds)** unless specified otherwise:

```javascript
async function sendMessageToBackground(message) {
  try {
    return await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Message timeout')), 3000)
      )
    ]);
  } catch (err) {
    if (err.message === 'Message timeout') {
      console.error('[Sidebar] Message timeout:', message.action);
      // Fallback: rely on storage.onChanged
    }
    throw err;
  }
}
```

### Recovery Strategy

If message times out:

1. **Sidebar:** Continue using `storage.onChanged` for updates
2. **Background:** Assume message was lost, state already written
3. **No retry:** Single attempt only (to avoid cascading delays)

---

## LOGGING PATTERNS

All message logging includes:

- Message action name
- Sender and receiver context
- Correlation ID (requestId)
- Latency (for request/response)
- Success/failure status

### Example Log Sequence

```
[Sidebar] GET_QUICK_TABS_STATE request sent, requestId=req-1702000000000-abc
[Background] GET_QUICK_TABS_STATE received, requestId=req-1702000000000-abc
[Background] State retrieved: 5 tabs, revision=1702000010001
[Background] GET_QUICK_TABS_STATE response sent, requestId=req-1702000000000-abc
[Sidebar] GET_QUICK_TABS_STATE response received, requestId=req-1702000000000-abc, latency=32ms
```

---

## PROTOCOL VERSIONING

Current protocol version: **1**

If major changes needed:

1. Add `protocolVersion` field to future messages
2. Keep backward compatibility for 1-2 versions
3. Graceful degradation on version mismatch

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial protocol specification
