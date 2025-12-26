# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.11-v12  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with sidebar Quick Tabs Manager

**Key Features:**

- **Quick Tabs v2 Architecture** - tabs.sendMessage messaging, single storage
  key
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time
- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Single Barrier Initialization** - Unified barrier with resolve-only
  semantics
- **Storage.onChanged PRIMARY** - Primary sync mechanism for state updates
- **Session-Only Quick Tabs** - Quick Tabs cleared on browser close (no
  cross-session persistence)

**v1.6.3.11-v12 Features (NEW) - Solo/Mute Removal + Real-Time Updates:**

- **Solo/Mute REMOVED** - Solo (🎯) and Mute (🔇) features completely removed
- **Cross-Session Persistence REMOVED** - Quick Tabs are session-only now
- **Version-Based Log Cleanup** - Logs auto-cleared when extension version
  changes
- **Real-Time Manager Updates** - New message types for instant sync:
  - `QUICKTAB_MOVED` - Position changes
  - `QUICKTAB_RESIZED` - Size changes
  - `QUICKTAB_MINIMIZED` - Minimize state changes
  - `QUICKTAB_REMOVED` - Tab destroyed
- **Sidebar Polling Sync** - Manager polls every 3-5s with staleness tracking
- **Scenario-Aware Logging** - Source (toolbar/manager/background), container
  ID, state changes

**v1.6.3.11-v11 Features - Container Identity + Message Diagnostics:**

- **Container Identity Fix** - GET_CURRENT_TAB_ID returns `tabId` AND
  `cookieStoreId`
- **Message Routing Diagnostics** - `[MSG_ROUTER]`/`[MSG_HANDLER]` logging
- **Code Health 10.0** - QuickTabHandler.js fully refactored

**v1.6.3.11-v9 Features - Diagnostic Report Fixes:**

- **Identity Init Logging** - `[IDENTITY_INIT]` phases for tab identity
- **Write Phase Logging** - `[WRITE_PHASE]` phases for storage operations
- **Container Validation** - `_validateContainerIsolation()` in visibility ops

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, StorageManager, MessageBuilder, StructuredLogger, MessageRouter

**Deprecated:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
runtime.Port (v12), complex init layers (v4), Solo/Mute (v12), cross-session
persistence (v12)

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

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.11-v12)

**Simplified stateless architecture (NO Port, NO BroadcastChannel):**

- `runtime.sendMessage()` - Content script → Background
- `tabs.sendMessage()` - Background → Content script / Manager
- `storage.onChanged` - **PRIMARY** sync mechanism for state updates
- **Sidebar Polling Fallback** - Manager polls every 3-5s with staleness
  tracking
- Unified barrier initialization - Resolve-only semantics

**Dual Architecture (Retained from v3):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **message-handler.js** - TYPE-based v2 routing (QUICKTAB_MOVED,
  QUICKTAB_RESIZED)

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes) - **Now also sent to
  Manager**
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close by ID)

**Real-Time Manager Message Types (v1.6.3.11-v12 NEW):**

- `QUICKTAB_MOVED` - Position changes sent to Manager
- `QUICKTAB_RESIZED` - Size changes sent to Manager
- `QUICKTAB_MINIMIZED` - Minimize state changes sent to Manager
- `QUICKTAB_REMOVED` - Tab destroyed sent to Manager

---

## 🆕 Version Patterns Summary

### v1.6.3.11-v12 Patterns (Current)

- **Solo/Mute REMOVED** - Solo (🎯) and Mute (🔇) features completely removed
- **Cross-Session Persistence REMOVED** - Quick Tabs are session-only now
- **Version-Based Log Cleanup** - Logs auto-cleared on extension version change
- **Real-Time Manager Updates** - QUICKTAB_MOVED, QUICKTAB_RESIZED,
  QUICKTAB_MINIMIZED, QUICKTAB_REMOVED message types
- **Sidebar Polling Sync** - Manager polls every 3-5s with staleness tracking
- **Scenario-Aware Logging** - Source, container ID, state changes tracked

### v1.6.3.11-v11 Patterns

- **Container Identity Fix** - GET_CURRENT_TAB_ID returns `tabId` AND
  `cookieStoreId`
- **Identity State Transitions** - `[IDENTITY_STATE] TRANSITION:` logging
- **Message Routing Diagnostics** - `[MSG_ROUTER]`/`[MSG_HANDLER]` logging
- **Code Health 10.0** - QuickTabHandler.js fully refactored

### v1.6.3.11-v9 Patterns

- **Identity Init Logging** - `[IDENTITY_INIT]` markers for lifecycle phases
- **Write Phase Logging** - `[WRITE_PHASE]` markers for storage operations
- **State Validation Delta** - `[STATE_VALIDATION] PRE_POST_COMPARISON`
- **Container Validation** - `_validateContainerIsolation()` added

### Previous Version Patterns (Consolidated)

- **v1.6.3.11-v8:** Transaction tracking, null originTabId rejection
- **v1.6.3.11-v7:** Orphan Quick Tabs fix, helper methods, Code Health 8.0+
- **v1.6.3.10-v10:** tabs.sendMessage, storage.onChanged, unified barrier
- **v1.6.3.10:** Tab ID backoff, handler deferral, adoption lock timeout

### Key Timing Constants (v1.6.3.11-v12)

| Constant                  | Value   | Purpose                           |
| ------------------------- | ------- | --------------------------------- |
| `MESSAGE_TIMEOUT_MS`      | 5000    | Message timeout                   |
| `_MAX_EARLY_QUEUE_SIZE`   | 100     | Max queued messages before ready  |
| `HYDRATION_TIMEOUT_MS`    | 3000    | Storage hydration timeout         |
| `TAB_ID_BACKOFF_DELAYS`   | Array   | 200, 500, 1500, 5000ms            |
| `STORAGE_TIMEOUT_MS`      | 2000    | Storage operation timeout         |
| `LRU_MAP_MAX_SIZE`        | 500     | Maximum map entries               |
| `MANAGER_POLL_INTERVAL`   | 3000-5s | Sidebar polling interval          |
| `STALENESS_THRESHOLD_MS`  | 5000    | State staleness tracking          |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                               |
| --------------------- | --------------------------------------------------------------------- |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                     |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                           |
| TabStateManager       | `getTabState()`, `setTabState()`                                      |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`              |
| QuickTabHandler       | `handleCreate()`, `_resolveOriginTabId()`, `_validateTabId()`         |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`   |
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)             |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`           |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`             |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                  |
| Manager               | `scheduleRender()`, `_startHostInfoMaintenance()`                     |
| TabLifecycleHandler   | `start()`, `stop()`, `handleTabRemoved()`, `validateAdoptionTarget()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `_computeStateChecksum()`, `getFilterState()`

**v1.6.3.11-v12 Note:** Cross-session persistence removed - Quick Tabs are
session-only

**Earlier Exports:** `normalizeOriginTabId()`, `checkStorageQuota()`

---

## 📝 Logging Prefixes

**v1.6.3.11-v12 (NEW):** `[VERSION_LOG_CLEANUP]` `[SCENARIO_LOG]`
`[MANAGER_POLL]` `[STALENESS_CHECK]` `[REALTIME_SYNC]`

**v1.6.3.11-v11:** `[IDENTITY_STATE] TRANSITION:` `[IDENTITY_ACQUIRED]`
`[MSG_ROUTER]` `[MSG_HANDLER]` `[HYDRATION]` `[Manager] BUTTON_CLICKED:`

**v1.6.3.11-v9:** `[IDENTITY_INIT]` `[WRITE_PHASE]` `[STATE_VALIDATION]`
`[CONTAINER_VALIDATION]`

**Previous:** `[HydrationBoundary]` `[QuickTabHandler]` `[STORAGE_PROPAGATE]`
`[ERROR_TELEMETRY]` `[MSG_COMMAND]` `[HOVER_EVENT]` `[SHADOW_DOM_SEARCH]`
`[INIT]` `[ADOPTION]` `[HEARTBEAT]` `[LRU_GUARD]` `[STORAGE_LATENCY]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, Shadow DOM traversal, operation acknowledgment, state readiness
gating, error telemetry, originTabId resolution, tab ID pattern extraction,
transaction tracking, null originTabId rejection, identity system gating,
debounce context capture, container isolation, z-index recycling, container
identity acquisition, message routing diagnostics, version-based log cleanup,
scenario-aware logging, sidebar polling sync, real-time manager updates.

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

| File                                             | Features                                    |
| ------------------------------------------------ | ------------------------------------------- |
| `src/constants.js`                               | Centralized constants                       |
| `src/utils/shadow-dom.js`                        | Shadow DOM link detection                   |
| `src/utils/storage-utils.js`                     | Storage utilities (Code Health 9.09)        |
| `src/background/tab-events.js`                   | Tabs API listeners                          |
| `src/utils/structured-logger.js`                 | StructuredLogger class with contexts        |
| `src/storage/storage-manager.js`                 | Simplified persistence, checksum validation |
| `src/messaging/message-router.js`                | ACTION-based routing                        |
| `src/background/message-handler.js`              | TYPE-based v2 routing                       |
| `background.js`                                  | Early message listener (Code Health 9.09)   |
| `sidebar/quick-tabs-manager.js`                  | scheduleRender() (Code Health 9.09)         |
| `src/content.js`                                 | Content script (Code Health 9.09)           |
| `src/background/handlers/QuickTabHandler.js`     | handleCreate(), originTabId fix             |
| `src/background/handlers/TabLifecycleHandler.js` | Tab lifecycle, orphan detection             |

### Storage

**Session State Key:** `quick_tabs_state_v2` (storage.session - session-only)  
**Format:** `{ allQuickTabs: [...], originTabId, originContainerId, correlationId, timestamp, version: 2 }`

**Note:** Cross-session persistence removed in v1.6.3.11-v12 - Quick Tabs cleared
on browser close.

### Messages

**MESSAGE_TYPES (v1.6.3.11-v12):** `QUICKTAB_MOVED`, `QUICKTAB_RESIZED`,
`QUICKTAB_MINIMIZED`, `QUICKTAB_REMOVED`, `MANAGER_CLOSE_ALL`,
`MANAGER_CLOSE_BY_ID`, `QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated), REALTIME (sent to Manager)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
