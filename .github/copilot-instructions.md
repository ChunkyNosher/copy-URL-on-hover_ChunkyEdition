# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.4  
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

**v1.6.4 Features (NEW) - Drag-and-Drop Manager + Bug Fixes:**

- **BUG FIX #1** - Click-to-Front: Quick Tabs come to front on click (not just
  drag)
- **BUG FIX #2** - Open in New Tab: Added `openTab` to MessageRouter allowlist
- **BUG FIX #3** - Cross-tab Transfer/Duplicate: Fixed via drag-and-drop
- **BUG FIX #4** - Manager Reordering Persistence: Tab group order now persists
- **BUG FIX #5** - Alt Key Modifier: Removed (doesn't work), default changed to
  Shift
- **FEATURE #1** - Drag-and-Drop Reordering: Reorder tabs and Quick Tabs in
  Manager
- **FEATURE #2** - Cross-Tab Transfer: Drag Quick Tab to another tab group
- **FEATURE #3** - Duplicate via Shift+Drag: Hold Shift while dragging to
  duplicate
- **FEATURE #4** - Move to Current Tab Button: Replaces "Go to Tab" for Quick
  Tab items
- **FEATURE #5** - Tab Group Actions: "Go to Tab" and "Close All in Tab" buttons
- **FEATURE #6** - Open in New Tab Button: Per Quick Tab (↗️) in Manager
- **FEATURE #7** - Smaller count indicator with bigger number

**Settings Changes:**

- New "Duplicate Modifier Key" dropdown: Shift (default), Ctrl, None
- Alt option removed (doesn't work reliably)

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

### v1.6.4 Patterns (Current)

- **Drag-and-Drop Reordering** - Manager supports drag-and-drop for tabs and
  Quick Tabs
- **Cross-Tab Transfer** - Drag Quick Tab to another tab group to transfer
- **Duplicate via Modifier** - Hold Shift (configurable) while dragging to
  duplicate
- **Move to Current Tab** - `_handleMoveToCurrentTab()` replaces "Go to Tab" for
  items
- **Tab Group Actions** - `_createGroupActions()` adds "Go to Tab", "Close All"
- **Open in New Tab Fix** - Added `openTab` to MessageRouter allowlist
- **Click-to-Front** - Transparent overlay with `MAX_OVERLAY_Z_INDEX` constant
- **Fallback Messaging** - `browser.tabs.sendMessage` fallback when port unavailable
- **Group Order Validation** - `_applyUserGroupOrder()` with stricter type checks

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

| Constant                                        | Value      | Purpose                       |
| ----------------------------------------------- | ---------- | ----------------------------- |
| `MAX_OVERLAY_Z_INDEX`                           | 2147483646 | Click overlay z-index (v1.6.4)|
| `OVERLAY_REACTIVATION_DELAY_MS`                 | 500        | Pointer events re-enable delay|
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD`         | 5          | Failures before circuit trips |
| `CIRCUIT_BREAKER_TEST_INTERVAL_MS`              | 30000      | Test write interval           |
| `QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS` | 60000      | Auto-reset circuit breaker    |
| `PORT_RECONNECT_MAX_ATTEMPTS`                   | 10         | Max reconnection attempts     |

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

| File                              | Features                             |
| --------------------------------- | ------------------------------------ |
| `src/constants.js`                | Centralized constants                |
| `src/utils/shadow-dom.js`         | Shadow DOM link detection            |
| `src/utils/storage-utils.js`      | Storage utilities                    |
| `src/background/tab-events.js`    | Tabs API listeners                   |
| `src/utils/structured-logger.js`  | StructuredLogger class with contexts |
| `src/messaging/message-router.js` | ACTION-based routing                 |
| `background.js`                   | In-memory state, port handlers       |
| `sidebar/quick-tabs-manager.js`   | Port-based queries to background     |
| `src/content.js`                  | Port messaging for Quick Tabs        |

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
