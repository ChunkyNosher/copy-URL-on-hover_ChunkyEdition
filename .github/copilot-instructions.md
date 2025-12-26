# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.12  
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

**v1.6.3.12 Features (NEW) - Option 4 In-Memory Architecture:**

- **Background Script Memory** - Quick Tabs stored in `quickTabsSessionState`
  object
- **Port-Based Messaging** - All Quick Tabs use `runtime.connect()` ports
- **No browser.storage.session** - Fixed Firefox MV2 compatibility issue
- **Push Notifications** - Background → Sidebar via `STATE_CHANGED` messages
- **Factory Patterns** - Port handlers use factory/lookup table patterns
- **Generic Wrappers** - `executeQuickTabPortOperation()`,
  `executeSidebarPortOperation()`

**v1.6.3.11-v12 Features - Solo/Mute Removal:**

- **Solo/Mute REMOVED** - Solo (🎯) and Mute (🔇) features completely removed
- **Version-Based Log Cleanup** - Logs auto-cleared when extension version
  changes

**Core Modules:** QuickTabStateMachine, QuickTabMediator, TabStateManager,
MessageBuilder, StructuredLogger, MessageRouter

**Deprecated:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
`browser.storage.session` for Quick Tabs (v1.6.3.12), `runtime.sendMessage` for
Quick Tabs sync (v1.6.3.12), Solo/Mute (v12)

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

### CRITICAL: Option 4 Architecture (v1.6.3.12)

**Background Script as SINGLE SOURCE OF TRUTH:**

```javascript
const quickTabsSessionState = {
  quickTabsByTab: {},     // { [tabId]: [quickTab, ...] }
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
- **Background → Sidebar:** `STATE_CHANGED` (push notifications)

**Dual Architecture (Retained):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **Port handlers** - TYPE-based Quick Tabs routing via factory patterns

---

## 🆕 Version Patterns Summary

### v1.6.3.12 Patterns (Current)

- **Option 4 Architecture** - Background script in-memory storage
- **Port Messaging** - `'quick-tabs-port'` replaces runtime.sendMessage for
  Quick Tabs
- **No browser.storage.session** - Fixed Firefox MV2 compatibility
- **Factory Patterns** - Port handlers use lookup tables (reduce switch
  complexity)
- **Generic Wrappers** - `executeQuickTabPortOperation()`,
  `executeSidebarPortOperation()`
- **Push Notifications** - Background → Sidebar via `STATE_CHANGED`

### v1.6.3.11-v12 Patterns

- **Solo/Mute REMOVED** - Solo (🎯) and Mute (🔇) features completely removed
- **Version-Based Log Cleanup** - Logs auto-cleared on extension version change

### Previous Version Patterns (Consolidated)

- **v1.6.3.11-v11:** Container identity fix, message diagnostics, Code Health
  10.0
- **v1.6.3.11-v9:** Identity init logging, write phase logging, container
  validation
- **v1.6.3.11-v7:** Orphan Quick Tabs fix, helper methods
- **v1.6.3.10:** tabs.sendMessage, storage.onChanged, unified barrier

### Key Timing Constants (v1.6.3.12)

| Constant                | Value | Purpose                          |
| ----------------------- | ----- | -------------------------------- |
| `MESSAGE_TIMEOUT_MS`    | 5000  | Message timeout                  |
| `_MAX_EARLY_QUEUE_SIZE` | 100   | Max queued messages before ready |
| `TAB_ID_BACKOFF_DELAYS` | Array | 200, 500, 1500, 5000ms           |
| `LRU_MAP_MAX_SIZE`      | 500   | Maximum map entries              |

---

## Architecture Classes (Key Methods)

| Class                | Methods                                                     |
| -------------------- | ----------------------------------------------------------- |
| QuickTabStateMachine | `canTransition()`, `transition()`                           |
| QuickTabMediator     | `minimize()`, `restore()`, `destroy()`                      |
| TabStateManager      | `getTabState()`, `setTabState()`                            |
| MessageBuilder       | `buildLocalUpdate()`, `buildGlobalAction()`                 |
| MessageRouter        | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)   |
| EventBus             | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()` |
| StructuredLogger     | `debug()`, `info()`, `warn()`, `error()`, `withContext()`   |
| Manager              | `scheduleRender()`, `_startHostInfoMaintenance()`           |
| TabLifecycleHandler  | `start()`, `stop()`, `handleTabRemoved()`                   |

---

## 🔧 Storage & State

**v1.6.3.12 In-Memory State:** Quick Tabs stored in background script memory
(not persisted to disk)

**State Object:** `quickTabsSessionState` with `quickTabsByTab`,
`contentScriptPorts`, `sidebarPort`, `sessionId`, `sessionStartTime`

**Key Exports:** `STATE_KEY`, `logStorageRead()`, `logStorageWrite()`,
`canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`

**Note:** `browser.storage.session` NOT used for Quick Tabs (Firefox MV2
compatibility)

---

## 📝 Logging Prefixes

**v1.6.3.12 (NEW):** `[Background] PORT_CONNECT:` `[Background] PORT_MESSAGE:`
`[Content] QUICK_TABS_PORT:` `[Sidebar] QUICK_TABS_PORT:`

**v1.6.3.11-v12:** `[VERSION_LOG_CLEANUP]` `[SCENARIO_LOG]`

**Previous:** `[MSG_ROUTER]` `[MSG_HANDLER]` `[HYDRATION]` `[QuickTabHandler]`
`[ERROR_TELEMETRY]` `[HOVER_EVENT]` `[SHADOW_DOM_SEARCH]` `[INIT]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, state
machine, ownership validation, Single Writer Authority, Shadow DOM traversal,
error telemetry, originTabId resolution, container isolation, z-index recycling,
port messaging, factory patterns, lookup tables, generic wrapper functions,
in-memory state, push notifications.

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

| File                              | Features                              |
| --------------------------------- | ------------------------------------- |
| `src/constants.js`                | Centralized constants                 |
| `src/utils/shadow-dom.js`         | Shadow DOM link detection             |
| `src/utils/storage-utils.js`      | Storage utilities                     |
| `src/background/tab-events.js`    | Tabs API listeners                    |
| `src/utils/structured-logger.js`  | StructuredLogger class with contexts  |
| `src/messaging/message-router.js` | ACTION-based routing                  |
| `background.js`                   | In-memory state, port handlers        |
| `sidebar/quick-tabs-manager.js`   | Port-based queries to background      |
| `src/content.js`                  | Port messaging for Quick Tabs         |

### Storage (v1.6.3.12)

**In-Memory State:** `quickTabsSessionState` in background.js (NOT persisted)  
**Format:** `{ quickTabsByTab: {}, contentScriptPorts: {}, sidebarPort, sessionId, sessionStartTime }`

**Note:** No `browser.storage.session` for Quick Tabs - Firefox MV2
incompatible.

### Port Messages (v1.6.3.12)

**Content → Background:** `CREATE_QUICK_TAB`, `MINIMIZE_QUICK_TAB`,
`RESTORE_QUICK_TAB`, `DELETE_QUICK_TAB`, `QUERY_MY_QUICK_TABS`, `HYDRATE_ON_LOAD`,
`UPDATE_QUICK_TAB`

**Sidebar → Background:** `GET_ALL_QUICK_TABS`, `SIDEBAR_READY`,
`SIDEBAR_CLOSE_QUICK_TAB`, `SIDEBAR_MINIMIZE_QUICK_TAB`, `SIDEBAR_RESTORE_QUICK_TAB`

**Background → Sidebar:** `STATE_CHANGED`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
