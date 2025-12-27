# Detailed Comparison: Options 2, 3, and 4 for Session-Only Quick Tabs Storage

**Date:** 2025-12-26  
**Context:** Evaluating architectural patterns for ephemeral Quick Tabs data  
**Reference:** issue-47-revised.md Scenarios 1-9

---

## Quick Reference: The Three Options

| Aspect                   | Option 2                        | Option 3                             | Option 4                             |
| ------------------------ | ------------------------------- | ------------------------------------ | ------------------------------------ |
| **Storage Medium**       | Content script memory (per-tab) | `browser.storage.local` (persistent) | Background script memory (cross-tab) |
| **Persistence**          | Lost on tab close/refresh       | Survives browser restart             | Lost on browser restart              |
| **Cross-Tab Visibility** | Via background message relay    | Direct (query same storage)          | Via background message relay         |
| **Data Scope**           | Per-tab isolation               | Per-extension, shared across tabs    | Per-tab grouping, managed centrally  |
| **Latency**              | <1ms (memory access)            | 10-50ms (disk I/O) [web:79]          | 1-5ms (IPC messaging) [web:128]      |
| **Browser Support**      | Firefox ✅ Chrome ✅            | Firefox ✅ Chrome ✅                 | Firefox ✅ Chrome ✅                 |
| **Complexity**           | Medium                          | High                                 | Medium-High                          |

---

## Option 2: In-Memory + Sidebar Sync via Port Messaging

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Content Script (Tab 1)                                  │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ renderedQuickTabs: Map<id, QuickTab> (module var)  │ │
│ │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│ │ │ Quick Tab 1  │ │ Quick Tab 2  │ │ Quick Tab 3  │ │ │
│ │ └──────────────┘ └──────────────┘ └──────────────┘ │ │
│ └─────────────────────────────────────────────────────┘ │
│ Event: USER_CREATES_TAB → postMessage to background    │
│ Event: USER_MINIMIZES_TAB → postMessage to background  │
└──────────────────────┬──────────────────────────────────┘
                       │ backgroundPort.postMessage()
                       │ (message relay)
┌──────────────────────▼──────────────────────────────────┐
│ Background Script                                       │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ portRouter.onMessage → route to appropriate tab    │ │
│ └─────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │ backgroundPort.postMessage()
                       │ (state query response)
┌──────────────────────▼──────────────────────────────────┐
│ Sidebar (Manager UI)                                    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ On load: query background for all tab Quick Tabs   │ │
│ │ ┌──────────────────────────────────────────────────┤ │
│ │ │ Tab 1 Quick Tabs: [Tab1-1, Tab1-2, Tab1-3]      │ │
│ │ │ Tab 2 Quick Tabs: [Tab2-1, Tab2-2]              │ │
│ │ │ Tab 3 Quick Tabs: [Tab3-1]                      │ │
│ │ └──────────────────────────────────────────────────┤ │
│ └─────────────────────────────────────────────────────┘ │
│ User interacts → sends message back to appropriate tab │
└─────────────────────────────────────────────────────────┘
```

### Implementation Details

#### Content Script State Management

```javascript
// src/content.js (module-level)
let sessionQuickTabs = new Map(); // key: tabId + quickTabId, value: QuickTab object

// Initialize on script load
async function hydrateQuickTabs() {
  sessionQuickTabs.clear(); // Always start empty (session-only)
  console.log('[Quick Tabs] Session initialized - empty state');
  return [];
}

// When user creates Quick Tab
function handleQuickTabCreation(url, metadata) {
  const quickTabId = generateUUID();
  const quickTab = {
    id: quickTabId,
    url: url,
    title: metadata.title,
    createdAt: Date.now(),
    minimized: false,
    originTabId: currentTabId, // CRITICAL: Track which tab created it
    sessionId: SESSION_ID // Helps identify stale tabs
  };

  sessionQuickTabs.set(quickTabId, quickTab);

  // Notify background that state changed
  backgroundPort.postMessage({
    type: 'QUICK_TAB_CREATED',
    payload: { quickTab, fromTabId: currentTabId }
  });

  // Emit locally for UI updates
  EventBus.emit('quickTabCreated', quickTab);
}
```

#### Port Message Protocol

```javascript
// Content → Background: CREATE_QUICK_TAB
{
  type: 'CREATE_QUICK_TAB',
  payload: {
    quickTab: { id, url, title, createdAt, originTabId, sessionId },
    fromTabId: 123
  }
}

// Sidebar → Background: GET_ALL_QUICK_TABS
{
  type: 'GET_ALL_QUICK_TABS',
  queryId: 'query-uuid'  // For request/response pairing
}

// Background → Sidebar: GET_ALL_QUICK_TABS_RESPONSE
{
  type: 'GET_ALL_QUICK_TABS_RESPONSE',
  queryId: 'query-uuid',
  payload: {
    tabs: [
      {
        tabId: 123,
        quickTabs: [{ id, url, title, ... }],
        tabTitle: 'Example.com'
      },
      {
        tabId: 124,
        quickTabs: [{ id, url, title, ... }],
        tabTitle: 'GitHub'
      }
    ]
  }
}

// Sidebar → Background: MINIMIZE_QUICK_TAB
{
  type: 'MINIMIZE_QUICK_TAB',
  payload: {
    tabId: 123,           // Which content script
    quickTabId: 'uuid',   // Which Quick Tab
    minimize: true
  }
}
```

#### Sidebar Implementation

```javascript
// sidebar/settings.html script
let currentSessionQuickTabs = [];

async function refreshQuickTabsList() {
  // Query background for current state
  const response = await new Promise(resolve => {
    const queryId = generateUUID();
    const timeout = setTimeout(() => resolve(null), 5000); // 5s timeout

    queryPendingResponse.set(queryId, data => {
      clearTimeout(timeout);
      resolve(data);
    });

    backgroundPort.postMessage({
      type: 'GET_ALL_QUICK_TABS',
      queryId: queryId
    });
  });

  if (response && response.tabs) {
    currentSessionQuickTabs = response.tabs;
    renderQuickTabsList(response.tabs);
  } else {
    renderError('Failed to fetch Quick Tabs');
  }
}

function renderQuickTabsList(tabGroups) {
  const container = document.getElementById('quick-tabs-container');
  container.innerHTML = '';

  if (tabGroups.length === 0) {
    container.innerHTML = '<p>No Quick Tabs created yet</p>';
    return;
  }

  tabGroups.forEach(group => {
    const tabSection = createTabGroupElement(group);
    container.appendChild(tabSection);
  });
}
```

### Performance Characteristics

**Memory Usage:**

- Per Quick Tab: ~200 bytes (URL + metadata)
- With 100 Quick Tabs total: ~20 KB
- Background script: ~5 KB (message routing)
- Sidebar: ~5 KB (state cache)
- **Total: ~30 KB** for typical usage

**Latency Analysis [web:125, web:128]:**

- Create Quick Tab: Content script updates map (~1ms) + post message to
  background (~1-2ms) + sidebar auto-refresh (~2ms on next interval) = **~5-10ms
  total**
- Query all Quick Tabs (sidebar open): Post message (~1ms) + background routes
  to content scripts (~1-3ms) + sidebar renders (~5-20ms) = **~10-25ms total**

**Message Frequency:**

- Per Quick Tab creation: 2 messages (content→background, background→sidebar)
- Per minimize/restore: 2 messages
- Sidebar refresh interval: 1 message every 2-5 seconds (configurable)

### Advantages

1. **Clear Session Boundaries** - Data is explicitly in-memory, making
   session-only nature obvious
2. **Low Latency** - No disk I/O, pure memory access
3. **Per-Tab Isolation** - Each tab's Quick Tabs are completely independent
4. **Easy to Debug** - All operations logged as port messages
5. **No Storage API Complexity** - No `setAccessLevel()` or Firefox
   compatibility issues
6. **Natural Cleanup** - Tab closes → memory freed automatically
7. **Sidebar Synchronization** - Explicit messages make state transitions
   visible

### Disadvantages

1. **Message Relay Overhead** - Every sidebar operation requires round-trip to
   background
2. **No Cross-Tab Quick Tab Access** - Quick Tab created in Tab A cannot be
   opened from Tab B
3. **Race Conditions Possible** - Sidebar queries at T=0, user creates Quick Tab
   at T=1, sidebar shows stale state until next refresh
4. **Network Latency** - Message passing introduces 1-3ms delays (small but
   measurable)
5. **Message Serialization Risk** - Large Quick Tab objects might serialize
   slowly (Issue #22)
6. **Sidebar Must Poll** - Needs refresh interval or event listeners to stay
   synchronized
7. **Complex Message Protocol** - Need query ID tracking, timeouts, response
   matching

### Failure Modes & Recovery

| Failure                       | Symptom                                                           | Recovery                                              |
| ----------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| **Port disconnection**        | Sidebar queries timeout, Quick Tabs appear to freeze              | Automatic reconnection with exponential backoff       |
| **Message lost**              | Operation never completes, user clicks button but nothing happens | Need timeout + retry mechanism in sidebar             |
| **Sidebar crashes**           | Manager UI unresponsive, but content scripts still working        | Sidebar reloads automatically, queries background     |
| **Background script crashes** | All port communication fails                                      | Browser reloads background, content scripts reconnect |
| **Tab navigates away**        | Quick Tabs map in content script cleared                          | Session state lost (intended), sidebar reflects empty |

### Browser Restart Behavior

✅ **Browser closes** → Content scripts unload → renderedQuickTabs maps garbage
collected → memory freed  
✅ **Browser reopens** → New content scripts loaded with fresh renderedQuickTabs
= empty  
✅ **Sidebar opens** → Queries background → background queries all content
scripts → they respond with empty/current state  
✅ **User sees empty manager** → Expected behavior for session-only storage

---

## Option 3: Hybrid - Use `browser.storage.local` + Session Flag

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Background Script (Startup)                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ SESSION_ID = generateUUID()                         │ │
│ │ browser.storage.local.set({ sessionId: SESSION_ID })│ │
│ │ Delete all Quick Tabs from previous sessions        │ │
│ └─────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Content Script (Hydration)                              │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 1. Read SESSION_ID from storage.local               │ │
│ │ 2. Query browser.storage.local for all Quick Tabs   │ │
│ │ 3. Filter: keep only tabs where sessionId matches   │ │
│ │ 4. Load filtered tabs into renderedQuickTabs        │ │
│ │ 5. Store in memory for fast access                  │ │
│ └─────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Storage Layer (browser.storage.local)                   │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ sessionId: 'uuid-abc-123'                           │ │
│ │ quickTabs: [                                        │ │
│ │   {                                                 │ │
│ │     id: 'qt-1',                                     │ │
│ │     url: 'https://example.com',                     │ │
│ │     sessionId: 'uuid-abc-123',   ← CRITICAL        │ │
│ │     originTabId: 456,                              │ │
│ │     createdAt: 1735165200000                        │ │
│ │   },                                                │ │
│ │   {                                                 │ │
│ │     id: 'qt-2',                                     │ │
│ │     sessionId: 'uuid-xyz-789',   ← STALE (old)     │ │
│ │     url: '...'                                      │ │
│ │   }                                                 │ │
│ │ ]                                                   │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Implementation Details

#### Background Script Initialization

```javascript
// src/background/index.js (startup)
async function initializeBackgroundSession() {
  // Generate unique session ID
  const sessionId = generateUUID();

  // Store session ID for the entire session
  await browser.storage.local.set({
    currentSessionId: sessionId,
    sessionStartTime: Date.now()
  });

  console.log('[Background] Session initialized:', sessionId);

  // Optional: Clean up old Quick Tabs from previous sessions
  // This maintains storage quota over long-term use
  const { quickTabs = [] } = await browser.storage.local.get('quickTabs');
  const activeQuickTabs = quickTabs.filter(qt => qt.sessionId === sessionId);

  if (activeQuickTabs.length < quickTabs.length) {
    // Some Quick Tabs are from old sessions, remove them
    await browser.storage.local.set({
      quickTabs: activeQuickTabs
    });

    const removed = quickTabs.length - activeQuickTabs.length;
    console.log(
      `[Background] Removed ${removed} stale Quick Tabs from previous session`
    );
  }
}
```

#### Content Script Hydration with Session Filtering

```javascript
// src/content.js hydration
async function hydrateQuickTabs() {
  try {
    // Step 1: Get current session ID from background
    const { currentSessionId } =
      await browser.storage.local.get('currentSessionId');

    if (!currentSessionId) {
      console.warn('[Hydration] No session ID found, initializing empty');
      return [];
    }

    // Step 2: Read ALL Quick Tabs from storage (includes old sessions)
    const { quickTabs: allQuickTabs = [] } =
      await browser.storage.local.get('quickTabs');

    // Step 3: CRITICAL FILTER - keep only tabs from THIS session
    const sessionQuickTabs = allQuickTabs.filter(qt => {
      const isThisSession = qt.sessionId === currentSessionId;
      const isThisTab = qt.originTabId === getCurrentTabId();
      return isThisSession && isThisTab;
    });

    // Step 4: Load into memory
    sessionQuickTabs.forEach(qt => {
      renderedQuickTabs.set(qt.id, qt);
    });

    console.log(
      `[Hydration] Loaded ${sessionQuickTabs.length} Quick Tabs for this session`
    );
    return sessionQuickTabs;
  } catch (err) {
    console.error('[Hydration] Failed:', err);
    return [];
  }
}

// When user creates Quick Tab
async function handleQuickTabCreation(url, metadata) {
  const { currentSessionId } =
    await browser.storage.local.get('currentSessionId');

  const newQuickTab = {
    id: generateUUID(),
    url: url,
    title: metadata.title,
    sessionId: currentSessionId, // ← Attach session ID
    originTabId: getCurrentTabId(),
    createdAt: Date.now(),
    minimized: false
  };

  // Add to memory first
  renderedQuickTabs.set(newQuickTab.id, newQuickTab);

  // Persist to storage
  const { quickTabs = [] } = await browser.storage.local.get('quickTabs');
  quickTabs.push(newQuickTab);
  await browser.storage.local.set({ quickTabs });

  console.log('[Quick Tab] Created and persisted:', newQuickTab.id);

  // Emit event
  EventBus.emit('quickTabCreated', newQuickTab);
}
```

#### Storage Schema

```javascript
// browser.storage.local structure
{
  // Session metadata
  "currentSessionId": "uuid-12345",
  "sessionStartTime": 1735165200000,

  // All Quick Tabs (filtered by sessionId when loaded)
  "quickTabs": [
    {
      "id": "qt-abc-1",
      "url": "https://example.com",
      "title": "Example",
      "sessionId": "uuid-12345",        // ← Attached at creation
      "originTabId": 123,
      "createdAt": 1735165210000,
      "minimized": false
    },
    {
      "id": "qt-xyz-9",
      "url": "https://old-example.com",
      "sessionId": "uuid-99999",        // ← Different session (filtered out)
      "originTabId": 456,
      "createdAt": 1735160000000,
      "minimized": false
    }
  ],

  // User settings (persists across sessions)
  "userSettings": {
    "theme": "dark",
    "defaultContainer": "firefox-default"
  }
}
```

### Storage Quota Analysis [web:79, web:127]

**Available Quota:**

- Firefox: 5-10 MB per extension
- Chrome: 10 MB per extension (5 MB in Chrome 113 and earlier)

**With Option 3:**

- Per Quick Tab: ~400 bytes (with serialization overhead)
- Estimated capacity: 10 MB ÷ 400 bytes = ~25,000 Quick Tabs
- Realistic capacity: ~5,000-10,000 Quick Tabs (accounting for other data)

**Quota Management:**

- Sessions can accumulate Quick Tabs over time
- Cleanup strategy required (delete old sessions periodically)
- Or: Implement LRU eviction when approaching quota

### Performance Characteristics

**Storage I/O Times [web:79]:**

- Reading session ID: **5-15ms** (disk access)
- Reading all Quick Tabs: **10-50ms** (depends on count)
- Filtering by session: **1-5ms** (in-memory operation)
- Writing new Quick Tab: **15-50ms** (disk write + synchronization)
- **Total hydration time: 20-70ms per content script load**

**Memory Usage:**

- Filtered session Quick Tabs cached in memory (same as Option 2)
- Plus storage read overhead

### Advantages

1. **Cross-Tab Coordination** - All tabs can query same stored Quick Tabs
2. **Optional Persistence** - If you want to restore Quick Tabs later, data is
   preserved
3. **User Preference Coexistence** - Can store user settings alongside Quick
   Tabs
4. **Graceful Stale Data Handling** - Explicit sessionId filtering is clear and
   debuggable
5. **No Message Relay** - Direct storage access from all contexts
6. **Accidental Persistence Safety** - Quick Tabs stay only for current session
   (if cleanup works)

### Disadvantages

1. **Storage I/O Latency** - 20-70ms slower than in-memory options [web:79]
2. **Hydration Complexity** - Multiple async calls (get sessionId, get
   quickTabs, filter)
3. **Storage Quota Management** - Need cleanup strategy for old sessions
4. **Stale Data Risk** - If cleanup fails, old Quick Tabs accumulate forever
5. **Session ID Dependency** - If session ID generation/storage fails, all Quick
   Tabs become inaccessible
6. **Sidebar Synchronization** - Must reload sidebar to see other tabs' Quick
   Tabs (or implement port messaging anyway)
7. **Clock Skew Issues** - If background script crashes and restarts before
   session cleanup, sessions may overlap
8. **Serialization Overhead** - Every Quick Tab must be serializable for
   storage.local

### Failure Modes & Recovery

| Failure                     | Symptom                                                 | Recovery                                           |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| **Session ID lost**         | All Quick Tabs become inaccessible (sessionId mismatch) | Regenerate new session ID, old Quick Tabs orphaned |
| **Storage quota full**      | New Quick Tabs fail to persist                          | Need cleanup or LRU eviction                       |
| **Old sessions accumulate** | Storage fills up with stale Quick Tabs                  | Scheduled cleanup task required                    |
| **Serialization error**     | Quick Tab cannot be stored (non-cloneable data)         | Need data sanitization before storage.set()        |
| **Storage read fails**      | Hydration cannot load Quick Tabs                        | Fallback to empty state, continue with in-memory   |
| **Clock changes**           | Session cleanup logic breaks (relies on timestamps)     | Use sequence numbers instead of timestamps         |

### Browser Restart Behavior

⚠️ **Browser closes** → storage.local persists to disk  
⚠️ **Browser reopens** → Background script re-initializes with NEW session ID  
⚠️ **Cleanup task runs** → Old Quick Tabs with old sessionId deleted  
✅ **Content script loads** → Hydrates with new session ID → finds no matching
Quick Tabs (old ones deleted)  
✅ **User sees empty Quick Tabs** → Intended behavior (session-only)

However, if cleanup task fails: ❌ **Old Quick Tabs remain in storage** →
Violates "session-only" guarantee  
❌ **Storage quota can be wasted** → Long-term issue

---

## Option 4: Per-Session Storage via Background Script Memory

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Background Script (Single Source of Truth)                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ // Module-level state (NOT persisted to disk)           │ │
│ │ let sessionQuickTabs = {                                │ │
│ │   123: [                    // Tab ID                    │ │
│ │     { id: 'qt-1', url: ... },                           │ │
│ │     { id: 'qt-2', url: ... }                            │ │
│ │   ],                                                    │ │
│ │   124: [                                                │ │
│ │     { id: 'qt-3', url: ... }                            │ │
│ │   ]                                                     │ │
│ │ };                                                      │ │
│ │                                                         │ │
│ │ // Port connections to all content scripts             │ │
│ │ let contentScriptPorts = {                             │ │
│ │   123: port,                                           │ │
│ │   124: port                                            │ │
│ │ };                                                      │ │
│ └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
         ▲                              ▲                    ▲
         │                              │                    │
  messages │                      messages │            messages │
    (ops) │                    (queries)   │               (ops) │
         │                              │                    │
┌────────┴──────────┐         ┌────────┴──────────┐    ┌────────┴──────────┐
│ Content Script    │         │ Sidebar Manager   │    │ Content Script    │
│ (Tab 123)         │         │ (Port to BG)      │    │ (Tab 124)         │
│                   │         │                   │    │                   │
│ CREATE_QUICK_TAB  │         │ GET_ALL_TABS      │    │ MINIMIZE_TAB      │
│ ──────────────►   │         │ ──────────────►   │    │ ──────────────►   │
│                   │         │                   │    │                   │
└───────────────────┘         └───────────────────┘    └───────────────────┘
```

### Implementation Details

#### Background Script State Management

```javascript
// src/background/index.js

// Module-level state (ephemeral, cleared on browser restart)
let sessionQuickTabs = {}; // { [tabId]: [quickTab, ...] }
let contentScriptPorts = {}; // { [tabId]: port }
let nextMessageId = 1; // For request/response matching

// Initialize background
async function initializeBackground() {
  console.log('[Background] Session initialized - in-memory storage');

  // Listen for port connections from content scripts
  browser.runtime.onConnect.addListener(handlePortConnection);
}

function handlePortConnection(port) {
  if (port.name !== 'quick-tabs-port') return;

  // Extract tab ID from port (varies by browser)
  const tabId = port.sender.tab?.id;
  if (!tabId) {
    console.error('[Background] Port connected without tab ID');
    port.disconnect();
    return;
  }

  console.log(`[Background] Content script connected: tab ${tabId}`);

  // Store port for this tab
  contentScriptPorts[tabId] = port;

  // Initialize this tab's Quick Tabs array if needed
  if (!sessionQuickTabs[tabId]) {
    sessionQuickTabs[tabId] = [];
  }

  // Listen for messages from this content script
  port.onMessage.addListener(message => {
    handleContentScriptMessage(tabId, message);
  });

  // Cleanup on disconnect
  port.onDisconnect.addListener(() => {
    console.log(`[Background] Content script disconnected: tab ${tabId}`);
    delete contentScriptPorts[tabId];
    delete sessionQuickTabs[tabId];
  });
}

function handleContentScriptMessage(tabId, message) {
  const { type, payload, messageId } = message;

  console.log(`[Background] Message from tab ${tabId}:`, type);

  switch (type) {
    case 'CREATE_QUICK_TAB':
      handleCreateQuickTab(tabId, payload, messageId);
      break;

    case 'MINIMIZE_QUICK_TAB':
      handleMinimizeQuickTab(tabId, payload, messageId);
      break;

    case 'DELETE_QUICK_TAB':
      handleDeleteQuickTab(tabId, payload, messageId);
      break;

    case 'GET_MY_QUICK_TABS':
      handleGetMyQuickTabs(tabId, messageId);
      break;

    default:
      console.warn(`[Background] Unknown message type: ${type}`);
  }
}

function handleCreateQuickTab(tabId, payload, messageId) {
  const { quickTab } = payload;

  // Add to background memory
  if (!sessionQuickTabs[tabId]) {
    sessionQuickTabs[tabId] = [];
  }

  sessionQuickTabs[tabId].push(quickTab);

  console.log(`[Background] Quick Tab created in tab ${tabId}:`, quickTab.id);

  // Send ACK back to content script
  const port = contentScriptPorts[tabId];
  if (port) {
    port.postMessage({
      type: 'CREATE_QUICK_TAB_ACK',
      messageId: messageId,
      success: true
    });
  }

  // Notify sidebar (all tabs' Quick Tabs changed)
  notifySidebarOfStateChange();
}

function handleMinimizeQuickTab(tabId, payload, messageId) {
  const { quickTabId, minimize } = payload;

  // Find and update the Quick Tab
  if (sessionQuickTabs[tabId]) {
    const quickTab = sessionQuickTabs[tabId].find(qt => qt.id === quickTabId);
    if (quickTab) {
      quickTab.minimized = minimize;

      console.log(`[Background] Quick Tab ${quickTabId} minimized=${minimize}`);

      // ACK
      const port = contentScriptPorts[tabId];
      if (port) {
        port.postMessage({
          type: 'MINIMIZE_QUICK_TAB_ACK',
          messageId: messageId,
          success: true
        });
      }

      // Notify sidebar
      notifySidebarOfStateChange();
    }
  }
}

function handleGetMyQuickTabs(tabId, messageId) {
  const myTabs = sessionQuickTabs[tabId] || [];

  // Send back to content script
  const port = contentScriptPorts[tabId];
  if (port) {
    port.postMessage({
      type: 'GET_MY_QUICK_TABS_RESPONSE',
      messageId: messageId,
      payload: { quickTabs: myTabs }
    });
  }
}

// When sidebar connects and queries state
function handleSidebarQuery(sidebarPort, query) {
  // Collect all Quick Tabs from all tabs
  const allTabsData = [];

  for (const [tabId, quickTabs] of Object.entries(sessionQuickTabs)) {
    allTabsData.push({
      tabId: parseInt(tabId),
      quickTabs: quickTabs
    });
  }

  sidebarPort.postMessage({
    type: 'GET_ALL_QUICK_TABS_RESPONSE',
    payload: { tabs: allTabsData }
  });

  console.log(
    `[Background] Returned ${allTabsData.length} tab groups to sidebar`
  );
}

function notifySidebarOfStateChange() {
  // Broadcast to all connected sidebar ports
  // (Implementation depends on how many sidebar instances can connect)
  // For now, assumes single sidebar port

  if (sidebarPort) {
    const allTabsData = Object.entries(sessionQuickTabs).map(
      ([tabId, quickTabs]) => ({
        tabId: parseInt(tabId),
        quickTabs: quickTabs
      })
    );

    sidebarPort.postMessage({
      type: 'STATE_CHANGED',
      payload: { tabs: allTabsData }
    });
  }
}

initializeBackground();
```

#### Content Script Integration

```javascript
// src/content.js

// Initialize background communication
async function initializeQuickTabsSystem() {
  // Connect to background
  const port = browser.runtime.connect({ name: 'quick-tabs-port' });

  console.log('[Content] Connected to background');

  // Listen for messages from background
  port.onMessage.addListener(handleBackgroundMessage);

  // Query background for existing Quick Tabs in this tab
  const myQuickTabs = await queryBackgroundForMyQuickTabs(port);

  // Load into memory
  myQuickTabs.forEach(qt => {
    renderedQuickTabs.set(qt.id, qt);
  });

  console.log(`[Content] Loaded ${myQuickTabs.length} existing Quick Tabs`);

  return port;
}

function handleBackgroundMessage(message) {
  const { type } = message;

  switch (type) {
    case 'CREATE_QUICK_TAB_ACK':
      console.log('[Content] Create ACK received');
      break;

    case 'MINIMIZE_QUICK_TAB_ACK':
      console.log('[Content] Minimize ACK received');
      break;

    case 'STATE_SYNC':
      // Background notifies of state changes (for multi-tab coordination)
      handleStateSyncMessage(message);
      break;
  }
}

function queryBackgroundForMyQuickTabs(port) {
  return new Promise(resolve => {
    const messageId = generateMessageId();
    const timeout = setTimeout(() => {
      resolve([]); // Timeout, return empty
    }, 5000);

    responsePending.set(messageId, response => {
      clearTimeout(timeout);
      resolve(response.payload.quickTabs || []);
    });

    port.postMessage({
      type: 'GET_MY_QUICK_TABS',
      messageId: messageId
    });
  });
}

// When user creates Quick Tab
async function createQuickTab(url, metadata) {
  const quickTab = {
    id: generateUUID(),
    url: url,
    title: metadata.title,
    createdAt: Date.now(),
    minimized: false
  };

  // Add to local memory
  renderedQuickTabs.set(quickTab.id, quickTab);

  // Send to background
  const messageId = generateMessageId();

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      resolve(false); // Timeout
    }, 5000);

    responsePending.set(messageId, response => {
      clearTimeout(timeout);
      resolve(response.success);
    });

    backgroundPort.postMessage({
      type: 'CREATE_QUICK_TAB',
      payload: { quickTab },
      messageId: messageId
    });
  });
}
```

### Memory Architecture Details

**Background Script Memory Layout:**

```javascript
// Worst-case scenario: user has 20 tabs open, each with 50 Quick Tabs

sessionQuickTabs = {
  123: [50 Quick Tabs],     // ~20 KB
  124: [50 Quick Tabs],     // ~20 KB
  125: [50 Quick Tabs],     // ~20 KB
  ... (17 more tabs)        // ~340 KB total
  // Total for Quick Tabs data: ~400 KB

  // Sidebar access: reads entire object: ~400 KB
  // Content script access: reads array for their tab: ~20 KB per tab
}

// Message queue (pending request/response pairs):
responsePending = Map(100);  // ~10 KB

// Port connections:
contentScriptPorts = {       // ~200 bytes per port
  123: port,
  124: port,
  ... (18 more)
  // Total: ~4 KB
}

// TOTAL MEMORY IN BACKGROUND: ~420 KB for active session
```

**Memory Cleanup:**

- When tab closes → `onDisconnect` fires → tab entry deleted from both objects
- When browser restarts → background script reloaded → all memory cleared
- **Guaranteed cleanup** (unlike Option 3's cleanup task)

### Performance Characteristics

**Latency Analysis [web:128]:**

- Create Quick Tab: postMessage (~1-2ms) + background updates map (~<1ms) +
  response postMessage (~1-2ms) = **~3-5ms**
- Query state (sidebar): postMessage (~1ms) + background collects all tabs
  (~1-3ms) + response (~1-2ms) = **~3-6ms**
- Minimize Quick Tab: postMessage + background update + response = **~3-5ms**

**Comparison with other options:**

- Option 2 (in-memory): **~5-10ms** (same messaging latency, but also sidebar
  refresh cycle)
- Option 3 (storage): **~20-70ms** (disk I/O dominates)
- Option 4 (background memory): **~3-5ms** (fastest - memory access in single
  process)

### Advantages

1. **Fastest Performance** - All operations in background memory, no disk I/O
   [web:128]
2. **Single Source of Truth** - All Quick Tabs managed by background script
3. **Guaranteed Cleanup** - Browser restart = clean slate (automatic)
4. **Cross-Tab Coordination** - All tabs query same background state
5. **Simple Message Protocol** - No deduplication or query ID tracking needed
   (background handles ordering)
6. **Sidebar Synchronization Easy** - Can push updates to sidebar when state
   changes
7. **Transactional Consistency** - All operations atomic (single background
   process)
8. **Sidebar Doesn't Need Polling** - Background can notify sidebar of changes

### Disadvantages

1. **Complex Port Management** - Must track all content script ports
2. **Message Complexity** - Need messageId tracking for request/response pairing
3. **Potential Port Leaks** - If `onDisconnect` doesn't fire, memory builds up
4. **Background Script Restart Risk** - If background crashes, all Quick Tabs
   lost (intended but abrupt)
5. **Sidebar Coordination** - Sidebar needs separate port connection or message
   relay
6. **Race Conditions** - Multiple content scripts can send overlapping
   operations
7. **Memory Unbounded** - No quota, could grow if ports don't disconnect
   properly
8. **BFCache Issues** - Tabs in browser cache may cause port connection issues
   [web:133]

### Failure Modes & Recovery

| Failure                    | Symptom                                    | Recovery                                                |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| **Background crashes**     | All ports close, all Quick Tabs lost       | Background auto-reloads, content scripts auto-reconnect |
| **Port leak**              | Memory grows over time                     | Implement maximum tab count limit, force cleanup        |
| **Message lost**           | Operation timeout, no ACK                  | Content script retries with timeout                     |
| **Malformed message**      | Background can't process                   | Add message validation, respond with error              |
| **BFCache tab reconnects** | Port may have stale reference              | Re-establish port connection, sync state                |
| **Concurrent operations**  | Race condition (two tabs minimize same QT) | Add operation sequencing or versioning                  |

### Browser Restart Behavior

✅ **Browser closes** → Background script unloaded → all memory freed  
✅ **Background script termination** → sessionQuickTabs object garbage
collected  
✅ **Browser reopens** → Background script fresh reload → sessionQuickTabs = {}
(empty)  
✅ **Content scripts reconnect** → Query background → get empty response  
✅ **User sees empty manager** → Perfect (session-only behavior)

**No cleanup task needed!** Memory automatically managed by JavaScript GC.

---

## Detailed Comparison Table

| Aspect                         | Option 2                        | Option 3                            | Option 4                      |
| ------------------------------ | ------------------------------- | ----------------------------------- | ----------------------------- |
| **Storage Location**           | Content script memory (per-tab) | Disk (browser.storage.local)        | Background memory (cross-tab) |
| **Persistence**                | Lost on tab close               | Survives restart (if not cleaned)   | Lost on background reload     |
| **Cross-Tab Access**           | Via background relay            | Direct (same storage)               | Via background querying       |
| **Latency**                    | 5-10ms                          | 20-70ms                             | 3-5ms                         |
| **Memory Usage**               | ~30 KB total                    | ~5-10 KB (+ storage overhead)       | ~400 KB (worst case)          |
| **Storage Quota**              | N/A                             | 10 MB extension limit               | N/A (memory)                  |
| **Capacity**                   | ~5,000 tabs                     | ~25,000 total QTs                   | ~1,000 tabs                   |
| **Port Messages Required**     | Many (relay)                    | None (direct storage)               | Many (queries)                |
| **Message Serialization Risk** | Low-medium                      | Medium-high                         | Medium                        |
| **Sidebar Polling Needed**     | Yes (refresh cycle)             | Yes (manual reload)                 | No (can push updates)         |
| **Cleanup Logic Required**     | No                              | Yes (session cleanup task)          | No (automatic)                |
| **Browser Restart Cleanup**    | Automatic (memory freed)        | Manual (if cleanup fails, orphaned) | Automatic (memory freed)      |
| **Multi-Browser Support**      | Firefox ✅ Chrome ✅            | Firefox ✅ Chrome ✅                | Firefox ✅ Chrome ✅          |
| **Implementation Complexity**  | Medium                          | High                                | Medium                        |
| **Debugging Difficulty**       | Medium (trace port messages)    | High (trace storage + sessions)     | Medium (trace messages)       |
| **Race Condition Risk**        | Low (per-tab isolation)         | Medium (concurrent storage ops)     | Medium (concurrent messages)  |
| **Code Maintainability**       | Good (clear message flow)       | Medium (session logic complex)      | Good (state centralized)      |

---

## Recommendation by Use Case

### Choose Option 2 If...

- Quick Tabs are strictly tab-specific
- You want minimal background script involvement
- Per-tab isolation is a requirement
- Message latency of 5-10ms is acceptable
- Sidebar doesn't need to coordinate across tabs

**Example:** Quick Tabs as bookmarks for current page only

### Choose Option 3 If...

- You might want to restore Quick Tabs later
- User settings need to persist alongside Quick Tabs
- You want direct storage access (no message relay)
- You can implement and maintain session cleanup
- The 20-70ms latency is acceptable

**Example:** Semi-persistent Quick Tabs with user preferences

### Choose Option 4 If...

- You want fastest performance (3-5ms)
- Cross-tab coordination is important
- Automatic cleanup (no manual session management)
- Sidebar needs real-time state updates
- Background script is already complex (centralized management)

**Example:** Active Quick Tab session manager with live sidebar sync

---

## My Recommendation

**For your use case (Quick Tabs from issue-47-revised.md), I recommend
Option 4.**

**Rationale:**

1. Performance advantage is significant (3-5ms vs 5-10ms vs 20-70ms)
2. Guaranteed session-only behavior (no cleanup task)
3. Sidebar can show live updates without polling
4. Single source of truth reduces sync bugs
5. Automatic memory management (browser restart = fresh start)
6. Your codebase already has background script routing infrastructure

**Second choice:** Option 2 (if you want simpler background script, don't need
cross-tab coordination)

**Avoid:** Option 3 (cleanup complexity outweighs persistence benefit for
session-only use case)
