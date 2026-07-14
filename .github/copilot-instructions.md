# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.4-v7  
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

- **Clean URL Copying** - Strips 90+ tracking parameters from copied URLs
- **Dark Mode First UI** - Complete UI overhaul with dark-mode-first design

**v1.6.4-v7 Features (CURRENT):**

- **Clean URL Copying** - `cleanUrl()` strips UTM, Facebook, Google, Amazon,
  YouTube tracking params from copied URLs by default
- **Copy Raw URL Shortcut** - New `copyRawUrl` shortcut (unbound by default)
  copies URLs with all parameters intact
- **Dark Mode First UI** - Complete CSS overhaul with #121212 dark backgrounds,
  #6c5ce7 purple-blue accent, glass-morphism effects on Quick Tab windows
- **Performance: Debug-Gated Logging** - Verbose console.log wrapped behind
  `CONFIG.debugMode` checks (-28.8% logging overhead)
- **Performance: State Broadcast Dedup** - Hash-based STATE_CHANGED dedup in
  background.js eliminates redundant broadcasts
- **Performance: Render Debouncing** - 16ms debounce for rapid render requests
  in Quick Tabs Manager sidebar
- **ESLint Clean** - All ESLint warnings resolved (25 → 0)

**v1.6.4-v5 Features:**

- **Go to Tab** - Same-container stays open; cross-container reopens after 300ms
- **Toggle Sidebar** - Context menu via `sidebarAction.toggle()`
- **Transfer Fixes** - Window, restore, tab ID, display fixes for cross-tab
- **Metrics** - Footer persistence, flush on close, clear confirmation

**v1.6.4-v4 Features:**

- **Go to Tab Cross-Container Fix** - `sidebarAction.close()` called
  synchronously FIRST; Zen Browser compatible
- **Minimized Drag Restore Fix** - `minimizedSnapshot` transferred with Quick
  Tab data
- **Right-Click Context Menu** - "Close All" and "Minimize All" via
  `browser.menus` API
- **Minimize All Button** - ⏬ button in tab group headers

**v1.6.4-v7:** Clean URL Copy, Dark Mode UI, Performance Optimization  
**v1.6.4-v4:** Container Filter, Badge, ContainerManager.js  
**v1.6.4-v3:** Metrics footer, title/state fixes  
**v1.6.4:** Drag-Drop, Cross-Tab Transfer, Duplicate  
**v1.6.3.12:** Option 4 Architecture, Port Messaging

**Core:** QuickTabStateMachine, QuickTabMediator, TabStateManager,
MessageBuilder, StructuredLogger, MessageRouter

**Deprecated:** `setPosition()`, `setSize()`, BroadcastChannel, storage.session,
runtime.sendMessage for Quick Tabs, Solo/Mute

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

### v1.6.4-v7 Patterns (Current)

- **Clean URL Copy** - `cleanUrl()` in `src/utils/url-cleaner.js` strips 90+
  tracking params; `handleCopyURL()` uses it by default
- **Copy Raw URL** - `handleCopyRawURL()` copies without cleaning; unbound by
  default via `copyRawUrlKey: ''`
- **Dark Mode First** - CSS variables with dark defaults (#121212, #6c5ce7),
  light mode via `prefers-color-scheme: light` override
- **Debug-Gated Logging** - `console.log` wrapped behind `CONFIG.debugMode`
- **State Broadcast Dedup** - `_lastBroadcastStateHash` prevents redundant
  STATE_CHANGED messages
- **Render Debounce** - `_scheduleRenderDebounceTimer` with 16ms window

### v1.6.4-v5 Patterns

- **Go to Tab** - Same-container (sidebar stays) / Cross-container (close →
  reopen 300ms); Toggle Sidebar context menu
- **Transfer Fixes** - `updateTransferredSnapshotWindow()`,
  `storeTransferredSnapshot(id, snapshot, newTabId)`, display fix
- **Metrics** - `TOTAL_LOG_ACTIONS_KEY`, debounced persistence, beforeunload
  flush

### v1.6.4-v4 Patterns

- **Go to Tab Focus Fix** - `sidebarAction.close()` FIRST; Zen Browser
  compatible
- **Minimized Drag Restore** - `minimizedSnapshots`,
  `storeTransferredSnapshot()`
- **Context Menu** - `_initializeContextMenus()` for "Close All"/"Minimize All"
- **Container Filter/Badge** - `_filterQuickTabsByContainer()`, ContainerManager

### v1.6.4-v3 Patterns

- **Title/Navigation Update** - UPDATE_QUICK_TAB updates title from iframe
- **State Fixes** - forceEmpty, State Version Race, Open-and-Close
- **Metrics** - Single footer, reduced DEBOUNCE logging

### v1.6.4 Patterns

- **Race Fixes** - Removed redundant `requestAllQuickTabsViaPort()` calls
- **Order Persistence** - `_userQuickTabOrderByGroup`
- **Drag Features** - Reordering, Cross-Tab Transfer, Duplicate, Click-to-Front

### v1.6.3.12 Patterns (Consolidated)

- **v10-v13:** Port Routing, Button Op, Cross-Tab, Resize/Move Sync
- **v5-v9:** Circuit Breaker, Priority Queue, Optimistic UI, Render Lock
- **Base:** Option 4 Architecture, Port Messaging, storage.local Only

### Key Timing Constants

| Constant                                | Value                           | Purpose                     |
| --------------------------------------- | ------------------------------- | --------------------------- |
| `QUICK_TAB_ORDER_STORAGE_KEY`           | 'quickTabsManagerQuickTabOrder' | Order persistence key       |
| `CONTAINER_FILTER_STORAGE_KEY`          | 'quickTabsContainerFilter'      | Container filter preference |
| `TOTAL_LOG_ACTIONS_KEY`                 | 'quickTabsTotalLogActions'      | Metrics footer persistence  |
| `MAX_OVERLAY_Z_INDEX`                   | 2147483646                      | Click overlay z-index       |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD` | 5                               | Failures before trip        |
| `PORT_RECONNECT_MAX_ATTEMPTS`           | 10                              | Max reconnect attempts      |

---

## Architecture Classes (Key Methods)

| Class                | Methods                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| QuickTabStateMachine | `canTransition()`, `transition()`                                            |
| QuickTabMediator     | `minimize()`, `restore()`, `destroy()`                                       |
| TabStateManager      | `getTabState()`, `setTabState()`                                             |
| MessageRouter        | ACTION-based routing                                                         |
| EventBus             | `on()`, `off()`, `emit()`, `once()`                                          |
| StructuredLogger     | `debug()`, `info()`, `warn()`, `error()`                                     |
| Manager              | `scheduleRender()`, `_filterQuickTabsByContainer()`, `_handleBeforeUnload()` |
| UICoordinator        | `_updateRecoveredWindowDisplay()` for orphan window recovery                 |
| CreateHandler        | `getWritingContainerId()` (v3)                                               |
| TestBridge           | `getManagerState()` (v3)                                                     |

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

**v1.6.4-v7:** `[Clipboard] CLEAN_URL:`, `[Clipboard] RAW_URL:`

**v1.6.4-v5:** `[Manager] GO_TO_TAB_SAME_CONTAINER:`,
`GO_TO_TAB_CROSS_CONTAINER:`, `GO_TO_TAB_SIDEBAR_REOPEN:`,
`[Settings] CLEAR_LOG_HISTORY:`,
`[Content] TRANSFERRED_SNAPSHOT_WINDOW_UPDATED:`,
`[Content] SNAPSHOT_STORED_WITH_NEW_TAB_ID:`,
`[Manager] METRICS_FOOTER_LOADED:`, `METRICS_FOOTER_SAVED:`,
`METRICS_FOOTER_FLUSHED:`, `[UICoordinator] RECOVERED_WINDOW_DISPLAY_UPDATED:`

**v1.6.4-v4:** `CONTAINER_FILTER:`, `CONTEXT_MENU:`, `SNAPSHOT_*:`

**v1.6.4:** `DRAG_DROP:`, `TRANSFER_QUICK_TAB:`, `QUICKTAB_ORDER:`

**Core:** `STORAGE_ONCHANGED`, `STATE_SYNC`, `MSG_ROUTER`, `HYDRATION`,
`CIRCUIT_BREAKER_*`, `PORT_RECONNECT_*`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, per-tab scoping, state machine, Single
Writer Authority, container isolation, port messaging, in-memory state, circuit
breaker, port routing, context menu, clean URL copying, debug-gated logging,
state broadcast deduplication.

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

**MCPs:** CodeScene, Context7 (JS API docs), Perplexity

**Context7:** Search standard APIs (Map, Promise, storage.local) NOT "Quick
Tabs"

**Testing:** `npm test` | `npm run lint` | `npm run build`

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass

---

## 📋 Quick Reference

### Key Files

| File                                                    | Features                                   |
| ------------------------------------------------------- | ------------------------------------------ |
| `background.js`                                         | In-memory state, port handlers             |
| `sidebar/quick-tabs-manager.js`                         | Port queries, container filter (v1.6.4-v4) |
| `src/content.js`                                        | Port messaging, clean URL copy (v1.6.4-v7) |
| `src/utils/url-cleaner.js`                              | URL tracking param removal (v1.6.4-v7)     |
| `src/features/quick-tabs/minimized-manager.js`          | Snapshot storage for minimize/restore      |
| `src/features/quick-tabs/coordinators/UICoordinator.js` | Orphan recovery, display fix (v1.6.4-v5)   |
| `sidebar/managers/ContainerManager.js`                  | Container isolation, filtering (v1.6.4-v4) |

### Storage (v1.6.3.12+)

**In-Memory State:** `quickTabsSessionState` in background.js  
**Persistence:** `browser.storage.local` + startup cleanup **Note:**
`browser.storage.session` REMOVED - uses `storage.local` + startup cleanup for
session-only behavior.

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
