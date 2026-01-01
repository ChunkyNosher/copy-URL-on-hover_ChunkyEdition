# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.4-v2  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with sidebar Quick Tabs Manager

**Key Features:**

- **Option 4 Architecture** - Background script in-memory storage (SINGLE SOURCE
  OF TRUTH)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port Messaging** - `'quick-tabs-port'` for all Quick Tabs communication
- **Tab Isolation** - Filter by `originTabId` at hydration time
- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Ephemeral Storage** - Quick Tabs stored in-memory, NOT persisted to disk
- **Session-Only Quick Tabs** - Browser restart clears all Quick Tabs
  automatically

**v1.6.4-v2 Bug Fixes (NEW):**

- **BUG FIX #1d** - Quick Tab title updates from link text to actual page title
  after iframe loads
- **BUG FIX #2d** - "Move to Current Tab" properly appears in Manager (state
  version race fix)
- **BUG FIX #3d** - Last Quick Tab close reflected in Manager (forceEmpty fix in
  VisibilityHandler)
- **BUG FIX #4d** - Manager updates when navigating to different URL within
  iframe
- **BUG FIX #5d** - "Open in New Tab" closes Quick Tab after opening URL

**v1.6.4-v2 Code Health:**

- **window.js** - Code Health: 8.28 → 9.38 (10+ helpers extracted)
- **VisibilityHandler.js** - Code Health: 8.28 → 9.38 (6 helpers extracted)
- **StorageChangeAnalyzer.js** - New module (20 functions from
  quick-tabs-manager.js)

**v1.6.4 Bug Fixes:**

- **BUG FIX #1-2** - Transfer/Duplicate race fix (removed redundant port calls)
- **BUG FIX #3** - Quick Tab reordering persistence
  (`_userQuickTabOrderByGroup`)
- **BUG FIX #4** - Last Quick Tab close fix (`_handleEmptyStateTransition()`)

**v1.6.4 Code Health:**

- **PortManager.js** - Port connection, circuit breaker (9.68)
- **RenderManager.js** - Render scheduling, UI helpers (9.17)

**v1.6.4 Features:**

- Drag-and-Drop reordering, Cross-Tab Transfer, Duplicate via Shift+Drag
- Click-to-Front, Move to Current Tab, Tab Group Actions, Open in New Tab
- Duplicate Modifier Key setting: Shift (default), Ctrl, None

**v1.6.3.12-v13:** Resize/Move Sync Fix, UI Flicker Fix, Helper Extraction  
**v1.6.3.12-v12:** Button Operation Fix, Cross-Tab Display, Code Health 8.54  
**v1.6.3.12-v11:** Cross-Tab Display Fix, Options Page Async Guard  
**v1.6.3.12-v10:** Port Routing Fix (Issue #48), Code Health 9.09  
**v1.6.3.12-v8 to v9:** Optimistic UI, Render Lock, Orphan UI, Bulk Close  
**v1.6.3.12:** Option 4 In-Memory Architecture, Port-Based Messaging  
**v1.6.3.11-v12:** Solo/Mute REMOVED

**Core Modules:** QuickTabStateMachine, QuickTabMediator, TabStateManager,
MessageBuilder, StructuredLogger, MessageRouter

**Deprecated:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
`browser.storage.session` (v4), `runtime.sendMessage` for Quick Tabs
(v1.6.3.12), Solo/Mute (v12)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

**Important:** When using context7, look up JavaScript/ES6/Web API
documentation, NOT "Quick Tabs" directly. context7 is for standard API
references.

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Option 4 Architecture (v1.6.3.12+)

**Background Script as SINGLE SOURCE OF TRUTH:**

```javascript
const quickTabsSessionState = {
  quickTabsByTab: {}, // { [tabId]: [quickTab, ...] }
  contentScriptPorts: {}, // { [tabId]: port }
  sidebarPort: null,
  sessionId: generateUUID(),
  sessionStartTime: Date.now()
};
```

**Port Messaging (`'quick-tabs-port'`):**

- **Content Script → Background:**
  - `CREATE_QUICK_TAB`, `MINIMIZE_QUICK_TAB`, `RESTORE_QUICK_TAB`
  - `DELETE_QUICK_TAB`, `QUERY_MY_QUICK_TABS`, `HYDRATE_ON_LOAD`
  - `UPDATE_QUICK_TAB`
- **Sidebar → Background:**
  - `GET_ALL_QUICK_TABS`, `SIDEBAR_READY`, `SIDEBAR_CLOSE_QUICK_TAB`
  - `SIDEBAR_MINIMIZE_QUICK_TAB`, `SIDEBAR_RESTORE_QUICK_TAB`
- **Background → Sidebar:** `STATE_CHANGED`, `QUICKTAB_MINIMIZED` (push
  notifications)

**Dual Architecture (Retained):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **Port handlers** - TYPE-based Quick Tabs routing via factory patterns

---

## 🆕 Version Patterns Summary

### v1.6.4-v2 Patterns (Current)

- **Title Update Fix** - Quick Tab title updates from link text to page title
  after iframe loads
- **State Version Race Fix** - "Move to Current Tab" properly reflects in
  Manager
- **forceEmpty Fix** - VisibilityHandler correctly handles last Quick Tab close
- **Navigation Update** - Manager updates when navigating within Quick Tab
  iframe
- **Open-and-Close** - "Open in New Tab" closes Quick Tab after opening URL

### v1.6.4 Patterns

- **Transfer/Duplicate Race Fix** - Removed redundant
  `requestAllQuickTabsViaPort()` calls
- **Quick Tab Order Persistence** - `_userQuickTabOrderByGroup` map
- **Empty State Handling** - `_handleEmptyStateTransition()` helper
- **Drag-and-Drop Reordering** - Reorder tabs and Quick Tabs via drag
- **Cross-Tab Transfer** - Drag Quick Tab to another tab group
- **Duplicate via Modifier** - Hold Shift while dragging
- **Click-to-Front** - Transparent overlay with `MAX_OVERLAY_Z_INDEX`
- **Fallback Messaging** - `browser.tabs.sendMessage` fallback

### v1.6.3.12-v13 Patterns

- **Resize/Move Sync Fix** - `_updateQuickTabProperty()` searches ALL session
  tabs
- **Helper Extraction** - `_findInHintTab()`, `_findInAllSessionTabs()`,
  `_findInGlobalState()`
- **UI Flicker Fix** - `replaceChildren()` for atomic DOM swap in Manager

### v1.6.3.12 Patterns (Consolidated)

- **v12:** Button Operation Fix, Cross-Tab Render Fix, Fallback Messaging, State
  Version Tracking
- **v11:** Cross-Tab Display, Options Page Guard, Tab Cache Invalidation
- **v10:** Port Routing Fix, Manager Button Operations
- **v8-v9:** Optimistic UI, Render Lock, Orphan UI, Bulk Close, Circuit Breaker
  Auto-Reset
- **v5-v7:** Circuit Breaker, Priority Queue, Sequence Tracking, Defensive
  Handlers

### Previous Version Patterns

- **v1.6.3.12:** Option 4 Architecture, Port Messaging, storage.local Only
- **v1.6.3.11-v12:** Solo/Mute REMOVED
- **v1.6.3.11-v7:** Orphan Quick Tabs fix

### Key Timing Constants

| Constant                                        | Value                           | Purpose                         |
| ----------------------------------------------- | ------------------------------- | ------------------------------- |
| `QUICK_TAB_ORDER_STORAGE_KEY`                   | 'quickTabsManagerQuickTabOrder' | Quick Tab order persistence key |
| `MAX_OVERLAY_Z_INDEX`                           | 2147483646                      | Click overlay z-index (v1.6.4)  |
| `OVERLAY_REACTIVATION_DELAY_MS`                 | 500                             | Pointer events re-enable delay  |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD`         | 5                               | Failures before circuit trips   |
| `CIRCUIT_BREAKER_TEST_INTERVAL_MS`              | 30000                           | Test write interval             |
| `QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS` | 60000                           | Auto-reset circuit breaker      |
| `PORT_RECONNECT_MAX_ATTEMPTS`                   | 10                              | Max reconnection attempts       |

---

## Architecture Classes (Key Methods)

| Class                | Methods                                  |
| -------------------- | ---------------------------------------- |
| QuickTabStateMachine | `canTransition()`, `transition()`        |
| QuickTabMediator     | `minimize()`, `restore()`, `destroy()`   |
| TabStateManager      | `getTabState()`, `setTabState()`         |
| MessageRouter        | ACTION-based routing                     |
| EventBus             | `on()`, `off()`, `emit()`, `once()`      |
| StructuredLogger     | `debug()`, `info()`, `warn()`, `error()` |
| Manager              | `scheduleRender()`                       |
| CreateHandler        | `getWritingContainerId()` (v3)           |
| TestBridge           | `getManagerState()` (v3)                 |

---

## 🔧 Storage & State

**v1.6.3.12 In-Memory State:** Quick Tabs stored in background script memory
(not persisted to disk)

**State Object:** `quickTabsSessionState` with `quickTabsByTab`,
`contentScriptPorts`, `sidebarPort`, `sessionId`, `sessionStartTime`

**Key Exports:** `STATE_KEY`, `logStorageRead()`, `logStorageWrite()`,
`canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`

**Sync Mechanism:** Port messaging is PRIMARY; `storage.onChanged` with
`'local'` area is FALLBACK (Firefox MV2 has no `browser.storage.session`)

---

## 📝 Logging Prefixes

**v1.6.4:** `[Manager] TRANSFER_RACE_FIX:`, `[Manager] QUICKTAB_ORDER:`,
`[Manager] EMPTY_STATE_TRANSITION:`, `[Manager] LOW_QUICKTAB_COUNT:`

**v1.6.4:** `[Manager] DRAG_DROP:`, `[Manager] TRANSFER_QUICK_TAB:`,
`[Manager] DUPLICATE_QUICK_TAB:`, `[Manager] MOVE_TO_CURRENT_TAB:`

**v1.6.3.12:** `[Background] _updateQuickTabProperty:`,
`[Manager] OPTIMISTIC_TIMEOUT:`, `[Manager] RENDER_DATA_SOURCE:`,
`[Background] QUICK_TABS_PORT_CONNECT:`, `[Manager] BUTTON_CLICKED:`

**Core:** `[STORAGE_ONCHANGED]`, `[STATE_SYNC]`, `[MSG_ROUTER]`, `[HYDRATION]`,
`[CIRCUIT_BREAKER_*]`, `[PORT_RECONNECT_*]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, state
machine, ownership validation, Single Writer Authority, Shadow DOM traversal,
error telemetry, originTabId resolution, container isolation, z-index recycling,
port messaging, factory patterns, lookup tables, generic wrapper functions,
in-memory state, push notifications, port roundtrip tracking, circuit breaker,
priority queue, timeout backoff, rolling heartbeat window, sequence number
tracking, port reconnection circuit breaker, defensive input validation, circuit
breaker auto-reset, listener registration guards, message timeout protection,
optimistic UI updates, render lock, orphan recovery UI, state version tracking,
port routing, sidebar URL detection.

---

## 🔧 QuickTabsManager API

### Correct Methods

| Method          | Description                    |
| --------------- | ------------------------------ |
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()`    | Close all Quick Tabs           |

### Common Mistake

❌ `closeQuickTab(id)` - **DOES NOT EXIST** (use `closeById(id)` instead)

---

## 🎯 Philosophy

**ALWAYS:** Fix root causes, use correct patterns, eliminate technical debt  
**NEVER:** setTimeout for race conditions, catch-and-ignore errors, workarounds

---

## 📏 File Size Limits

| File                      | Max Size |
| ------------------------- | -------- |
| `copilot-instructions.md` | **15KB** |
| `.github/agents/*.md`     | **10KB** |
| README.md                 | **10KB** |

**PROHIBITED:** `docs/manual/`, root markdown (except README.md)

---

## 🔧 MCP & Testing

**MCPs:** CodeScene (code health), Context7 (JavaScript API docs), Perplexity
(research)

**Context7 Usage:** Use for JavaScript, ES6, Web API, and browser extension API
documentation. Do NOT search for "Quick Tabs" - search for standard APIs like
"Map", "Promise", "storage.local", "tabs.sendMessage", etc.

**Testing:** `npm test` (Jest), `npm run lint` (ESLint), `npm run build`

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass

---

## 📋 Quick Reference

### Key Files

| File                                  | Features                                   |
| ------------------------------------- | ------------------------------------------ |
| `src/constants.js`                    | Centralized constants                      |
| `src/utils/shadow-dom.js`             | Shadow DOM link detection                  |
| `src/utils/storage-utils.js`          | Storage utilities                          |
| `src/background/tab-events.js`        | Tabs API listeners                         |
| `src/utils/structured-logger.js`      | StructuredLogger class with contexts       |
| `src/messaging/message-router.js`     | ACTION-based routing                       |
| `background.js`                       | In-memory state, port handlers             |
| `sidebar/quick-tabs-manager.js`       | Port-based queries to background           |
| `sidebar/managers/PortManager.js`     | Port connection, circuit breaker (v1.6.4)  |
| `sidebar/managers/RenderManager.js`   | Render scheduling, UI helpers (v1.6.4)     |
| `sidebar/managers/DragDropManager.js`       | Drag-and-drop reordering (v1.6.4)            |
| `sidebar/managers/OrderManager.js`          | Group/Quick Tab order persistence (v1.6.4)   |
| `sidebar/managers/StorageChangeAnalyzer.js` | Storage change analysis helpers (v1.6.4-v2)  |
| `src/content.js`                            | Port messaging for Quick Tabs                |

### Storage (v1.6.3.12-v8+)

**In-Memory State:** `quickTabsSessionState` in background.js  
**Persistence:** `browser.storage.local` with startup cleanup
(`_clearQuickTabsOnStartup()`)  
**Format:** `{ quickTabsByTab: {}, contentScriptPorts: {}, sidebarPort, sessionId, sessionStartTime }`
**Circuit Breaker:** Trips after 5 failures, test write every 30s, fallback mode
bypasses storage

**Note:** `browser.storage.session` COMPLETELY REMOVED - uses `storage.local` +
startup cleanup for session-only behavior.

### Port Messages (v1.6.4+)

**Content → Background:** `CREATE_QUICK_TAB`, `MINIMIZE_QUICK_TAB`,
`RESTORE_QUICK_TAB`, `DELETE_QUICK_TAB`, `QUERY_MY_QUICK_TABS`,
`HYDRATE_ON_LOAD`, `UPDATE_QUICK_TAB`

**Sidebar → Background:** `GET_ALL_QUICK_TABS`, `SIDEBAR_READY`,
`SIDEBAR_CLOSE_QUICK_TAB`, `SIDEBAR_MINIMIZE_QUICK_TAB`,
`SIDEBAR_RESTORE_QUICK_TAB`, `CLOSE_ALL_QUICK_TABS`,
`CLOSE_MINIMIZED_QUICK_TABS`, `TRANSFER_QUICK_TAB`, `DUPLICATE_QUICK_TAB`,
`MOVE_QUICK_TAB_TO_CURRENT_TAB`

**Background → Sidebar:** `STATE_CHANGED`, `QUICKTAB_MINIMIZED`,
`ORIGIN_TAB_CLOSED`, `CLOSE_MINIMIZED_QUICK_TABS_ACK`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
