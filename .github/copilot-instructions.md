# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.4-v5  
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
- **Container Filter** - Filter Quick Tabs by container in Manager (v1.6.4-v4)
- **Context Menu** - Right-click context menu for bulk Quick Tab operations
- **Ephemeral Storage** - Quick Tabs stored in-memory, NOT persisted to disk
- **Session-Only Quick Tabs** - Browser restart clears all Quick Tabs
  automatically

**v1.6.4-v5 Features (CURRENT):**

- **Go to Tab Same-Container Fix** - Sidebar stays open for same-container tab
  switches
- **Go to Tab Cross-Container Reopen** - Sidebar closes, tab switches, sidebar
  reopens after 300ms for cross-container switches
- **Toggle Sidebar Context Menu** - "Toggle Quick Tabs Manager" right-click menu
  item using `browser.sidebarAction.toggle()`
- **Minimized Transfer Window Fix** - `updateTransferredSnapshotWindow()` enables
  restore after cross-container transfer

**v1.6.4-v4 Features:**

- **Go to Tab Cross-Container Fix** - `sidebarAction.close()` called synchronously
  FIRST for proper focus transfer; Zen Browser compatible
- **Minimized Drag Restore Fix** - `minimizedSnapshot` transferred with Quick Tab
  data; `storeTransferredSnapshot()` enables restore after cross-tab transfer
- **Right-Click Context Menu** - "Close All" and "Minimize All" Quick Tabs via
  `browser.menus` API (`_initializeContextMenus()` in background.js)
- **Minimize All Button** - New ⏬ button in tab group headers
- **Shift+Move Duplicates** - Holding Shift while clicking "Move to Current Tab"
  duplicates instead of moving
- **Duplicate Container Fix** - Duplicated Quick Tabs now have correct
  `originContainerId` for proper filtering

**v1.6.4-v4 Container Features:** Container Filter Dropdown, Container Badge,
Name Resolution via contextualIdentities, ContainerManager.js module, Filter
Persistence (`quickTabsContainerFilter`), Go to Tab focus sequence

**v1.6.4-v4 Bug Fixes:** Container filter fix, dropdown cleanup, drag-drop
bubble fix, container switch refresh, auto-detect indicator

**v1.6.4-v3:** Metrics footer, DEBOUNCE logging, title/state fixes

**v1.6.4:** Drag-and-Drop, Cross-Tab Transfer, Duplicate via Shift+Drag

**v1.6.3.12:** Option 4 Architecture, Port-Based Messaging, Solo/Mute REMOVED

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
  sessionStartTime: Date.now(),
  minimizedSnapshots: {} // { [quickTabId]: { left, top, width, height } }
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

### v1.6.4-v5 Patterns (Current)

- **Go to Tab Same-Container** - `_getGoToTabContainerContext()` extracts container
  context; sidebar stays open for same-container switches
- **Go to Tab Cross-Container** - `_handleGoToTabSidebarClose()` conditionally
  closes sidebar, then reopens after 300ms for cross-container switches
- **Toggle Sidebar Menu** - "Toggle Quick Tabs Manager" context menu item via
  `browser.sidebarAction.toggle()`
- **Minimized Transfer Window** - `updateTransferredSnapshotWindow()` updates
  snapshot window reference after cross-container transfer

### v1.6.4-v4 Patterns

- **Go to Tab Focus Fix** - `sidebarAction.close()` FIRST; Zen Browser compatible
- **Minimized Drag Restore** - `minimizedSnapshots`, `storeTransferredSnapshot()`
- **Context Menu** - `_initializeContextMenus()` for "Close All"/"Minimize All"
- **Minimize All** - `_handleMinimizeAllInTabGroup()`
- **Shift+Move Duplicate** - `_executeMoveOrDuplicate()` checks shiftKey
- **Container Filter/Badge** - `_filterQuickTabsByContainer()`, ContainerManager.js
- **Name Resolution** - `_getContainerNameByIdAsync()`, `_getContainerNameSync()`

### v1.6.4-v3 Patterns

- **Title/Navigation Update** - UPDATE_QUICK_TAB updates title from iframe
- **State Fixes** - forceEmpty, State Version Race, Open-and-Close
- **Transfer/Duplicate** - Direct state refresh, Critical State Refresh flag
- **Metrics** - Single footer, reduced DEBOUNCE logging

### v1.6.4 Patterns

- **Race Fixes** - Removed redundant `requestAllQuickTabsViaPort()` calls
- **Order Persistence** - `_userQuickTabOrderByGroup`,
  `_handleEmptyStateTransition()`
- **Drag Features** - Reordering, Cross-Tab Transfer, Duplicate, Click-to-Front

### v1.6.3.12 Patterns (Consolidated)

- **v10-v13:** Port Routing, Button Op, Cross-Tab, Resize/Move Sync, Helper
  Extraction
- **v5-v9:** Circuit Breaker, Priority Queue, Optimistic UI, Render Lock, Bulk
  Close
- **v1.6.3.12:** Option 4 Architecture, Port Messaging, storage.local Only
- **v1.6.3.11-v12:** Solo/Mute REMOVED

### Key Timing Constants

| Constant                                        | Value                           | Purpose                     |
| ----------------------------------------------- | ------------------------------- | --------------------------- |
| `QUICK_TAB_ORDER_STORAGE_KEY`                   | 'quickTabsManagerQuickTabOrder' | Order persistence key       |
| `CONTAINER_FILTER_STORAGE_KEY`                  | 'quickTabsContainerFilter'      | Container filter preference |
| `MAX_OVERLAY_Z_INDEX`                           | 2147483646                      | Click overlay z-index       |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD`         | 5                               | Failures before trip        |
| `PORT_RECONNECT_MAX_ATTEMPTS`                   | 10                              | Max reconnect attempts      |

---

## Architecture Classes (Key Methods)

| Class                | Methods                                             |
| -------------------- | --------------------------------------------------- |
| QuickTabStateMachine | `canTransition()`, `transition()`                   |
| QuickTabMediator     | `minimize()`, `restore()`, `destroy()`              |
| TabStateManager      | `getTabState()`, `setTabState()`                    |
| MessageRouter        | ACTION-based routing                                |
| EventBus             | `on()`, `off()`, `emit()`, `once()`                 |
| StructuredLogger     | `debug()`, `info()`, `warn()`, `error()`            |
| Manager              | `scheduleRender()`, `_filterQuickTabsByContainer()`, `_getGoToTabContainerContext()` |
| CreateHandler        | `getWritingContainerId()` (v3)                      |
| TestBridge           | `getManagerState()` (v3)                            |

---

## 🔧 Storage & State

**v1.6.3.12 In-Memory State:** Quick Tabs stored in background script memory
(not persisted to disk)

**State Object:** `quickTabsSessionState` with `quickTabsByTab`,
`contentScriptPorts`, `sidebarPort`, `sessionId`, `sessionStartTime`,
`minimizedSnapshots`

**Key Exports:** `STATE_KEY`, `logStorageRead()`, `logStorageWrite()`,
`canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`

**Sync Mechanism:** Port messaging is PRIMARY; `storage.onChanged` with
`'local'` area is FALLBACK (Firefox MV2 has no `browser.storage.session`)

---

## 📝 Logging Prefixes

**v1.6.4-v5 Logging:** `[Manager] GO_TO_TAB_SAME_CONTAINER:`,
`[Manager] GO_TO_TAB_CROSS_CONTAINER:`, `[Manager] GO_TO_TAB_SIDEBAR_REOPEN:`,
`[Background] CONTEXT_MENU: Toggle sidebar clicked`

**v1.6.4-v4 Logging:** `[Manager] GO_TO_TAB: Cross-container switch detected`,
`[Background] CONTEXT_MENU:`, `[Background] SNAPSHOT_STORED:`,
`[Background] SNAPSHOT_INCLUDED:`, `[Content] MINIMIZED_SNAPSHOT_STORED:`

**v1.6.4-v4:** `[Manager] CONTAINER_FILTER:`,
`[Manager] CONTAINER_NAME_RESOLVED:`

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
container isolation, container filter, z-index recycling, port messaging,
factory patterns, lookup tables, in-memory state, push notifications, circuit
breaker, port routing, sidebar URL detection, context menu.

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

| File                                        | Features                                          |
| ------------------------------------------- | ------------------------------------------------- |
| `src/constants.js`                          | Centralized constants                             |
| `src/utils/shadow-dom.js`                   | Shadow DOM link detection                         |
| `src/utils/storage-utils.js`                | Storage utilities                                 |
| `src/background/tab-events.js`              | Tabs API listeners                                |
| `src/utils/structured-logger.js`            | StructuredLogger class with contexts              |
| `src/messaging/message-router.js`           | ACTION-based routing                              |
| `background.js`                             | In-memory state, port handlers, minimizedSnapshots|
| `sidebar/quick-tabs-manager.js`             | Port-based queries, container filter (v1.6.4-v4)  |
| `sidebar/managers/PortManager.js`           | Port connection, circuit breaker (v1.6.4)         |
| `sidebar/managers/RenderManager.js`         | Render scheduling, UI helpers (v1.6.4)            |
| `sidebar/managers/DragDropManager.js`       | Drag-and-drop reordering (v1.6.4)                 |
| `sidebar/managers/OrderManager.js`          | Group/Quick Tab order persistence (v1.6.4)        |
| `sidebar/managers/ContainerManager.js`      | Container isolation, filtering, badge (v1.6.4-v4) |
| `sidebar/managers/StorageChangeAnalyzer.js` | Storage change analysis helpers (v1.6.4-v2)       |
| `src/content.js`                            | Port messaging, storeTransferredSnapshot          |
| `src/features/quick-tabs/minimized-manager.js` | Snapshot storage for minimize/restore          |
| `src/features/quick-tabs/handlers/VisibilityHandler.js` | Sends minimizedSnapshot        |

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
