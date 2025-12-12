# Quick Tabs: Complete Logic Flow and API Integration Timeline

**Extension Version:** v1.6.3.7-v3 | **Date:** 2025-12-09 | **Focus:**
End-to-end Quick Tab creation flow with all API integration points

---

## Overview: Multi-Process Architecture

The Quick Tabs feature operates across three separate execution contexts that
must coordinate:

1. **Content Script** (`src/content.js`) - Runs on every browser tab, handles
   user actions
2. **Background Script** (`src/background/`) - Shared across all tabs, handles
   persistence and cross-tab messaging
3. **QuickTabsManager** (`src/features/quick-tabs/index.js`) - Facade
   coordinating all components

Each context has different lifecycle, API access, and responsibilities. Quick
Tab creation requires **11 distinct stages** across these contexts before user
sees result.

---

## Stage 1: User Action Detection (Content Script)

**File:** `src/content.js`, lines 1056-1150 (`handleCreateQuickTab`)  
**Triggered:** User hovers link and presses configured keyboard shortcut  
**APIs Used:**

- `eventBus.emit()` (internal event bus)
- `browser.tabs.getCurrent()` (UNAVAILABLE - not accessible in content script)
- `browser.runtime.sendMessage()` (cross-context messaging)

### What Happens

```
1. handleCreateQuickTab(url, targetElement) called
2. EventBus emits: Events.QUICK_TAB_REQUESTED
3. Calculate Quick Tab position based on mouse position
4. Generate unique Quick Tab ID: qt-{tabId}-{timestamp}-{random}
5. Build Quick Tab data object with URL, dimensions, position
6. Call createQuickTab() to create locally
7. Send CREATE_QUICK_TAB message to background
```

### Key Detail: Tab ID Problem

Content scripts **cannot access** `browser.tabs.getCurrent()`. The Quick Tab ID
**MUST** include the current tab ID for cross-tab isolation (pattern:
`qt-{tabId}-...`). But how does content script know its own tab ID?

**Solution (v1.6.3.5-v10):**

1. Content script sends `GET_CURRENT_TAB_ID` message to background
2. Background receives message with `sender.tab.id` and responds
3. Content script stores `currentTabId` globally before initializing Quick Tabs
4. Passes `currentTabId` as option to
   `initQuickTabs(eventBus, Events, { currentTabId })`

**Code Location:**

- `src/content.js` lines 740-763: `getCurrentTabIdFromBackground()` fetches and
  caches tab ID
- `src/content.js` line 827: Passes `currentTabId` to `initQuickTabs()`

---

## Stage 2: Quick Tabs Manager Initialization (Content Script)

**File:** `src/features/quick-tabs/index.js` (QuickTabsManager.init method)  
**Called From:** Content script initialization  
**APIs Used:**

- EventEmitter (internal, for component communication)
- `browser.runtime.sendMessage()` (for container detection)
- `browser.storage.local.get()` (for state hydration)

### Seven Sequential Initialization Steps

**STEP 1: Detect Context** (lines 1186-1208)

- Detects Firefox container (Multi-Account Containers extension)
- Sets `this.cookieStoreId` to container ID or 'firefox-default'
- Detects or uses pre-fetched `currentTabId`

**APIs:**

- `browser.runtime.sendMessage()` → `GET_CONTAINER_CONTEXT` action to background

**STEP 2: Initialize Managers** (lines 1209-1229)

- Create StateManager (tracks state changes)
- Create EventManager (coordinates events between components)
- Create MemoryGuard (monitors memory usage, prevents crashes)

**STEP 3: Initialize Handlers** (lines 1230-1248)

- Create CreateHandler (handles Quick Tab creation)
- Create UpdateHandler (handles position/size changes)
- Create VisibilityHandler (handles minimize/restore/solo/mute)
- Create DestroyHandler (handles deletion)

**APIs:** (None at this stage - all component initialization)

**STEP 4: Initialize Coordinators** (lines 1249-1269)

- Create UICoordinator (manages DOM rendering and updates)
- Wire handlers to coordinator for callback routing

**STEP 5: Setup Components** (lines 1270-1290)

- Attach storage listeners (CreateHandler.init())
- Initialize UICoordinator rendering
- Setup event bridges between internal and external buses

**APIs:**

- `browser.storage.onChanged` listener (triggered when storage updates)

**STEP 6: Hydrate State From Storage** (lines 1291-1363)

- **Critical Stage:** Restores Quick Tabs from previous session
- Reads `storage.local[STATE_KEY]` to get stored Quick Tab list
- Filters by `originTabId` to prevent cross-tab contamination
- Creates real QuickTabWindow instances for each tab
- Emits `state:hydrated` event to update sidebar

**APIs:**

- `browser.storage.local.get(STATE_KEY)` (read stored state)
- Cross-tab scope validation (prevents ghost tabs)

**STEP 7: Expose Manager** (lines 1364-1376)

- Store manager reference globally as `window.quickTabsManager`
- Ready for public API calls

### Critical Detail: Cross-Tab Isolation During Hydration

**File:** `src/features/quick-tabs/index.js`, lines 1402-1515
(`_checkTabScopeWithReason`)

When hydrating stored Quick Tabs from previous session:

1. Check stored tab's `originTabId` field
2. Compare against manager's `currentTabId`
3. Only render tab if `originTabId === currentTabId`
4. If `originTabId` is missing, try extracting from Quick Tab ID pattern
5. If extraction succeeds and matches current tab, patch `originTabId` in-place
6. Reject tabs from other browser tabs (prevent cross-tab ghost tabs)

**Purpose:** Prevents a Quick Tab created in Tab A from appearing in Tab B when
browser reloads.

---

## Stage 3: First Quick Tab Creation (Content Script → Manager)

**File:** `src/content.js`, lines 1056-1167 (`handleCreateQuickTab` and
`createQuickTabLocally`)  
**Entry Point:** User presses keyboard shortcut while hovering link

### Phase 3A: Build Quick Tab Data

```javascript
// src/content.js lines 1087-1110
const width = CONFIG.quickTabDefaultWidth || 800;
const height = CONFIG.quickTabDefaultHeight || 600;
const position = calculateQuickTabPosition(targetElement, width, height);
const title = targetElement?.textContent?.trim() || 'Quick Tab';
const { quickTabId, saveId, canUseManagerSaveId } = generateQuickTabIds();
const quickTabData = buildQuickTabData({
  url,
  id: quickTabId,
  position,
  size: { width, height },
  title
});
```

**Outputs:**

- `quickTabId`: Unique identifier (e.g., `qt-42-1733826372421-a1b2c3d4`)
- `saveId`: Correlation ID for tracking persistence (different from quickTabId)
- `quickTabData`: Full Quick Tab configuration object

### Phase 3B: Create Locally in Content Script

**File:** `src/features/quick-tabs/index.js`, lines 1693-1768 (`createQuickTab`
method)

```
1. Call this.createHandler.create(optionsWithCallbacks)
   └─ Returns: { tabWindow: QuickTabWindow instance, newZIndex: number }
2. Store result in this.tabs Map (keyed by quickTabId)
3. Update this.currentZIndex to new z-index value
4. Return QuickTabWindow instance to caller
```

**APIs Used:**

- EventEmitter.emit() (internal component communication)

**Inside CreateHandler.create():**

- Create QuickTabWindow instance (DOM element)
- Attach all UI event listeners (drag, resize, close, minimize, etc.)
- Emit `state:created` event to UICoordinator
- Render iframe with Quick Tab content
- Store in `this.tabs` Map for reference

### Phase 3C: Persist to Background via Message

**File:** `src/content.js`, lines 1114-1127 (`persistQuickTabToBackground`)

```javascript
await sendMessageToBackground({
  action: 'CREATE_QUICK_TAB',
  id: quickTabId,
  url: url,
  title: title,
  // ... all Quick Tab fields
  saveId: saveId
});
```

**APIs:**

- `browser.runtime.sendMessage()` (cross-context messaging to background script)

**Message Format:**

```
{
  action: 'CREATE_QUICK_TAB',
  id: 'qt-42-1733826372421-xyz',
  url: 'https://example.com',
  title: 'Example',
  left: 100,
  top: 100,
  width: 800,
  height: 600,
  saveId: '1733826372421-xyz',
  originTabId: 42,
  minimized: false
}
```

---

## Stage 4: Background Script Receives Create Message

**File:** `src/background/handlers/CreateHandler.js`  
**Entry Point:** Message dispatched by background message router  
**APIs Used:**

- `browser.storage.local.set()` (persist to browser storage)
- `browser.runtime.sendMessage()` (broadcast to all tabs)
- BroadcastChannel (cross-tab messaging, currently NOT WIRED - Issue #2)

### Phase 4A: Validate and Store State

Inside CreateHandler.handle():

1. Validate message has required fields
2. Apply default values (cookieStoreId, minimized=false, etc.)
3. Create DomainTab model (internal representation)
4. Store in `this.map` (memory cache)
5. Validate state consistency (prevent corruption)
6. Log creation with timestamp and ID

### Phase 4B: Persist to Storage

**Critical APIs:**

- `browser.storage.local.set({ 'quick-tabs-state': { tabs: [...] } })`

This persists the Quick Tab so it survives:

- Page reload
- Browser restart
- Tab close and re-open

**Storage Structure:**

```javascript
{
  'quick-tabs-state': {
    tabs: [
      {
        id: 'qt-42-1733826372421-xyz',
        url: 'https://example.com',
        title: 'Example',
        originTabId: 42,
        minimized: false,
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        // ... more fields
      }
    ],
    saveId: '1733826372421-xyz',
    transactionId: 'uuid-v4'
  }
}
```

### Phase 4C: Broadcast State Change (Issue #2 - NOT CURRENTLY WORKING)

**Current State:** CreateHandler has code to broadcast but never sends

**What SHOULD happen:**

```javascript
// Pseudo-code - currently missing
const channel = new BroadcastChannel('quick-tabs-updates');
channel.postMessage({
  action: 'CREATE',
  quickTabId: 'qt-42-...',
  tabData: { url, title, ... }
});
```

**Purpose:** Notify all other tabs' sidebars that new Quick Tab was created, so
they can update their UI if needed.

**Current Workaround:** Sidebar polls storage every 2 seconds (Issue #7 - too
slow)

---

## Stage 5: Storage Update Listener Fires

**File:** Multiple locations (UICoordinator, CreateHandler)  
**Triggered:** After background writes to storage  
**APIs Used:**

- `browser.storage.onChanged` listener (browser API)

### What Gets Triggered

In every tab with Quick Tabs:

```javascript
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['quick-tabs-state']) {
    // Storage was updated - read new state
    const newState = changes['quick-tabs-state'].newValue;
    // Update UI
  }
});
```

**Problem:** This listener fires in background script context, which might be
dead (Firefox kills background after 30 seconds - Issue #1)

**Result:** Storage listener fires but message never reaches sidebar (no port
connection available)

---

## Stage 6: Content Script Receives Storage Update

**File:** Content scripts listening for storage changes  
**Triggered:** Storage updated by background  
**APIs Used:**

- `browser.storage.onChanged` (browser API)

### What Happens

1. Storage change fires across all contexts
2. All tabs' content scripts get notified
3. Each content script checks if change is relevant to its Quick Tabs
4. If relevant, re-render the Quick Tab list

---

## Stage 7: Sidebar Receives State Update (Three Possible Paths)

**File:** `sidebar/quick-tabs-manager.js`  
**Multiple Entry Points:** Port, RuntimeMessage, or Storage Poll

### Path A: Port Connection (Intended but Currently Broken - Issue #3)

**Expected Flow:**

1. Background sends STATE_UPDATE through established port
2. Sidebar's `port.onMessage` handler fires
3. Handler updates internal state
4. Calls `renderUI()` to update DOM

**Current Reality:**

- Background doesn't send through port
- Handler never receives STATE_UPDATE
- Port connection dies every 30 seconds anyway (Firefox timeout - Issue #1)

**Code Location:** `sidebar/quick-tabs-manager.js` lines 1397-1471

### Path B: BroadcastChannel (Designed But Sender Never Implemented - Issue #2)

**Expected Flow:**

1. Background sends message to `'quick-tabs-updates'` BroadcastChannel
2. Sidebar's `channel.onmessage` handler fires
3. Updates state and renders

**Current Reality:**

- Sidebar listener is registered and waiting
- Background never calls `channel.postMessage()`
- Listener receives nothing

**Code Location:** `sidebar/quick-tabs-manager.js` lines 1026-1158

### Path C: runtime.sendMessage (Currently Working But Dies With Background - Issue #3)

**Working Flow:**

1. Background sends message via `browser.runtime.sendMessage()`
2. Sidebar's `browser.runtime.onMessage` handler fires
3. Updates state and renders

**Problem:**

- Dies when background script is terminated (every 30 seconds - Issue #1)
- Two-second latency possible during polling interval

**Code Location:** `sidebar/quick-tabs-manager.js` lines 2318-2330

### Path D: Storage Polling (Slowest Fallback - Issue #7)

**Current Flow:**

1. Sidebar polls `browser.storage.local` every 2 seconds
2. Reads stored Quick Tab list
3. Debounces updates (50ms debounce at 2000ms interval - ineffective)
4. Renders UI

**Problem:**

- 2-second latency unacceptable for rapid operations
- User creates tab, sees nothing for 2 seconds, assumes broken
- Debounce logic doesn't help at this timescale

**Code Location:** `sidebar/quick-tabs-manager.js` lines 2147-2157, 2199

---

## Stage 8: Sidebar State Update Processing

**File:** `sidebar/quick-tabs-manager.js`  
**Triggered:** Via one of four paths above  
**APIs Used:**

- DOM manipulation (update sidebar HTML)
- CSS animations (show/hide Quick Tab entry)

### What Happens

```
1. Message/storage update received
2. Parse and validate Quick Tab data
3. Check if Quick Tab already in sidebar state
4. If new: Add to local state Map
5. Call renderUI() to update HTML
6. Emit event for other components
```

### Issue #4: Duplicate Renders

**Problem:** Multiple listeners might fire for same update:

- Port message received
- RuntimeMessage received (same update)
- BroadcastChannel message (same update)
- Storage poll reads same state
- **Result:** renderUI() called 4 times for 1 update

**Current Behavior:** No deduplication, DOM remounts multiple times, visual
flicker

---

## Stage 9: UICoordinator Renders Quick Tab in Sidebar

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Triggered:** State change detected  
**APIs Used:**

- DOM manipulation APIs
- Browser CSS and layout APIs

### What Gets Rendered

Sidebar HTML structure for each Quick Tab:

```html
<div class="quick-tab" data-quick-tab-id="qt-42-...">
  <div class="quick-tab-header">
    <span class="title">Example</span>
    <button class="close-btn">×</button>
  </div>
  <iframe src="https://example.com" class="quick-tab-content"></iframe>
</div>
```

### UI Event Wiring

Each rendered Quick Tab gets listeners for:

- Click (focus/bring to front)
- Close button (triggers DestroyHandler)
- Minimize button (triggers VisibilityHandler)
- Solo button (toggles solo mode)
- Mute button (toggles mute mode)
- Drag handlers (position updates)
- Resize handlers (size updates)

---

## Stage 10: Quick Tab Window Creates iframe

**File:** `src/features/quick-tabs/window.js` (QuickTabWindow class)  
**Entry Point:** Called from UICoordinator during rendering  
**APIs Used:**

- `document.createElement('iframe')`
- `element.style.*` (CSS properties)
- DOM event listeners

### What QuickTabWindow Does

1. Create iframe element with unique ID
2. Set src to requested URL
3. Apply CSS for positioning and sizing
4. Attach drag and resize listeners
5. Attach close/minimize buttons
6. Render iframe into DOM
7. Store reference in tabs Map

### iframe Security & Isolation

- Each Quick Tab gets separate iframe process
- URL is loaded inside iframe (same origin policies apply)
- iframe can be closed independently
- iframe state doesn't affect parent tab

---

## Stage 11: Sidebar Port Connection Syncs State Back (Optional)

**File:** `sidebar/quick-tabs-manager.js` lines 733-835  
**Triggered:** After sidebar updates state  
**APIs Used:**

- `runtime.connect()` port messaging
- Heartbeat mechanism every 25 seconds

### What Should Happen (Currently Broken)

1. Sidebar connects to background via port
2. Sidebar sends heartbeat every 25 seconds (proves sidebar alive)
3. When background dies, sidebar detects via heartbeat failure
4. Sidebar switches to BroadcastChannel or storage polling
5. When background restarts, sidebar reconnects

### Current Problems

**Issue #1:** Firefox terminates background after 30 seconds regardless of port
**Issue #3:** State updates sent via separate runtime.sendMessage, not through
port **Issue #8:** Circuit breaker blocks reconnection for 10 seconds after 5
failures

### Heartbeat Timing

```
T+0s:   Background starts
T+0s:   Sidebar connects to background
T+25s:  Sidebar sends HEARTBEAT
T+25s:  Background sends HEARTBEAT_ACK
T+30s:  Firefox kills background script
T+50s:  Sidebar sends heartbeat → FAILS (background dead)
T+50s:  Sidebar detects: background is dead, switches to fallback
T+50s:  Sidebar uses BroadcastChannel or storage polling
T+60s:  Sidebar attempts reconnection
T+60s:  background script restarts (Firefox spins up new process)
T+60s:  Sidebar connects via port again
```

---

## Quick Tab Lifecycle Events

At each stage, QuickTabsManager emits events for component coordination:

| Event                 | File             | When                              | Data                             |
| --------------------- | ---------------- | --------------------------------- | -------------------------------- |
| `state:created`       | CreateHandler    | Quick Tab created (before render) | `{ quickTab: {...} }`            |
| `state:added`         | UICoordinator    | Quick Tab added to DOM            | `{ quickTab: {...} }`            |
| `state:updated`       | UpdateHandler    | Position/size changed             | `{ quickTabId, changes: {...} }` |
| `state:deleted`       | DestroyHandler   | Quick Tab destroyed               | `{ quickTabId }`                 |
| `state:hydrated`      | QuickTabsManager | Restored from storage on startup  | `{ count: number }`              |
| `QUICK_TAB_REQUESTED` | Content script   | User requested Quick Tab creation | `{ url, element }`               |

---

## Storage State Structure (Persistence Format)

**Key:** `'quick-tabs-state'`  
**Location:** `browser.storage.local`

```javascript
{
  // Array of all Quick Tabs (across all tabs)
  tabs: [
    {
      id: 'qt-42-1733826372421-xyz',        // Unique ID
      url: 'https://example.com',           // Content URL
      title: 'Example Site',                // Display title
      originTabId: 42,                      // Which tab created this
      minimized: false,                     // Visibility state
      left: 100,                            // X position in pixels
      top: 100,                             // Y position in pixels
      width: 800,                           // Width in pixels
      height: 600,                          // Height in pixels
      zIndex: 1000,                         // Stacking order
      cookieStoreId: 'firefox-default',     // Container ID
      soloedOnTabs: [],                     // Tabs where tab is visible when solo mode active
      mutedOnTabs: [],                      // Tabs where tab is hidden in mute mode
      pinnedToUrl: null,                    // URL this tab is pinned to (if any)
      visibility: {
        soloedOnTabs: [],
        mutedOnTabs: []
      }
    }
    // ... more Quick Tabs
  ],

  // Tracking fields
  saveId: '1733826372421-xyz',             // Correlation ID for this save
  transactionId: 'uuid-string',            // Transaction ID for integrity checking

  // Metadata
  timestamp: 1733826372421,                // When state was saved
  version: 1                               // State schema version
}
```

---

## API Reference: Browser APIs Used

| API                             | Used By            | Purpose                        | When Available                    |
| ------------------------------- | ------------------ | ------------------------------ | --------------------------------- |
| `browser.tabs.getCurrent()`     | Background only    | Identify current tab ID        | Background context only           |
| `browser.tabs.query()`          | Background         | Find tabs by criteria          | Background context only           |
| `browser.tabs.create()`         | Background         | Open new browser tab           | Background context only           |
| `browser.runtime.sendMessage()` | Content/Background | Cross-context messaging        | Always (except dead background)   |
| `browser.runtime.onMessage`     | All contexts       | Receive cross-context messages | Always                            |
| `runtime.connect()`             | Sidebar            | Persistent port connection     | Always (but dies every 30s)       |
| `port.onMessage`                | Sidebar            | Receive port messages          | While port connected              |
| `browser.storage.local.get()`   | All contexts       | Read persistent state          | Always                            |
| `browser.storage.local.set()`   | All contexts       | Write persistent state         | Always                            |
| `browser.storage.onChanged`     | All contexts       | Listen for state changes       | Always                            |
| `BroadcastChannel`              | Content scripts    | Cross-tab messaging            | Always (sender currently missing) |
| `document.createElement()`      | Content script     | Create DOM elements            | Always                            |
| `element.addEventListener()`    | Content script     | Attach UI event listeners      | Always                            |

---

## State Machine: Quick Tab States

A Quick Tab progresses through states during its lifecycle:

```
CREATED
   ↓ (user doesn't minimize)
VISIBLE (rendered in sidebar and as iframe)
   ↓ (user clicks minimize button)
MINIMIZED (stored in minimizedManager, no DOM)
   ↓ (user clicks restore button)
VISIBLE
   ↓ (user clicks close button)
DESTROYED (removed from state, DOM cleaned up)
```

**Storage Impact:**

- VISIBLE: Stored in `storage.local['quick-tabs-state'].tabs`
- MINIMIZED: Still in storage, but `minimized: true`
- DESTROYED: Removed from storage

**On Page Reload (Hydration):**

- VISIBLE → recreated with DOM
- MINIMIZED → recreated as real QuickTabWindow instance but no DOM (dormant
  mode)
- DESTROYED → not restored

---

## Timeout and Lifecycle Constraints

| Component         | Lifetime            | Constraint                        | Impact                               |
| ----------------- | ------------------- | --------------------------------- | ------------------------------------ |
| Background script | ~30 seconds         | Firefox non-persistent context    | State updates stop arriving          |
| Port connection   | ~30 seconds         | Dies when background dies         | Sidebar can't use port path          |
| Content script    | Duration of tab     | Survives background death         | Can receive broadcasts, read storage |
| Sidebar script    | Duration of sidebar | Always alive                      | Primary state sync target            |
| Storage           | Indefinite          | Persistent across browser restart | Ultimate source of truth             |

---

## Critical Dependencies and Order

For Quick Tab creation to succeed:

1. **Content script must know its tab ID** (from background via
   GET_CURRENT_TAB_ID message)
2. **QuickTabsManager must be initialized** (7-step process, includes hydration)
3. **CreateHandler must be ready** (with all managers and coordinators)
4. **Storage must be accessible** (for persistence and hydration)
5. **UICoordinator must be initialized** (for rendering)
6. **Sidebar port must be connected** (for state sync, though optional fallbacks
   exist)

If any step fails, Quick Tab creation fails or state sync breaks.
