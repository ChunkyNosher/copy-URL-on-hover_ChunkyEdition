# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.9-v7  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Quick Tabs v2 Architecture** - tabs.sendMessage messaging, single storage
  key
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time
- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Single Barrier Initialization** - Unified barrier with resolve-only semantics
- **Storage.onChanged PRIMARY** - Primary sync mechanism for state updates
- **Runtime.onMessage Secondary** - Direct state push from background (v7)
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)
- **Tabs API Events** - onActivated, onRemoved, onUpdated listeners

**v1.6.3.9-v7 Features (NEW) - Logging & Message Infrastructure:**

- **GAP 1: Logging Capture** - Sidebar log capture matching background.js pattern
- **GAP 2: Message Listener** - Enhanced runtime.onMessage for state push/errors
- **GAP 3: Centralized Constants** - `KEEPALIVE_INTERVAL_MS`, `RENDER_STALL_TIMEOUT_MS`, etc.
- **GAP 4: Routing Refactor** - `_routeRuntimeMessage()` uses lookup table (CC 13→3)
- **Log Export API** - `GET_SIDEBAR_LOGS`, `CLEAR_SIDEBAR_LOGS` message handlers
- **Direct State Push** - `PUSH_STATE_UPDATE` bypasses storage.onChanged delay

**v1.6.3.9-v6 Features (Previous) - Sidebar & Background Cleanup:**

- **GAP 11: Simplified Init** - Manager reduced from ~8 state variables to 4
- **GAP 13: Unified Barrier** - Single barrier with resolve-only semantics
- **GAP 14: Render Queue Dedup** - Revision as PRIMARY over saveId
- **GAP 15: Dead Code Removal** - ~218 lines removed (CONNECTION_STATE, port stubs)
- **GAP 16: Unified Routing** - Enhanced `_routeRuntimeMessage()` with switch-based routing
- **GAP 17: State Hash** - `stateHashAtQueue` field for render queue validation
- **GAP 18: Lint Fixes** - 15+ unused import/variable warnings fixed
- **GAP 20: Response Helper** - `_buildResponse()` for standardized correlationId responses
- **Constants Centralized** - `WRITE_IGNORE_WINDOW_MS`, `STORAGE_CHANGE_COOLDOWN_MS` moved to `src/constants.js`

**v1.6.3.9-v5 Features (Previous) - Bug Fixes & Reliability:**

- **Tab ID Initialization** - `currentBrowserTabId` fallback to background script
- **Storage Event Routing** - `_routeInitMessage()` → `_handleStorageChangedEvent()`
- **Adoption Flow Fallback** - Handles null `currentBrowserTabId` gracefully
- **Response Format** - Background responses include `type` and `correlationId`
- **Message Cross-Routing** - Dispatcher handles both `type` and `action` fields

**v1.6.3.9-v4 Features (Previous) - Architecture Simplification:**

- **~761 Lines Removed** - Port stubs, BroadcastChannel stubs, complex init
- **Centralized Constants** - `src/constants.js` expanded (+225 lines)
- **Single Barrier Init** - Replaces multi-phase initialization
- **Storage Health Check** - Fallback polling every 5s

**v1.6.3.9-v3 Features (Retained):**

- **Dual Architecture** - MessageRouter (ACTION) vs message-handler (TYPE)
- **Diagnostic Logging** - STORAGE*LISTENER*\*, STATE_SYNC_MECHANISM

**v1.6.3.9-v2 Features (Retained):**

- **Container Isolation** - `originContainerId` field, container-aware queries
- **Tabs API Integration** - `src/background/tab-events.js` with 3 listeners

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager,
MessageBuilder, StructuredLogger, TabEventsManager, MessageRouter

**Deprecated/Removed:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
runtime.Port (v12), complex init layers (v4), revision event buffering (v4),
CONNECTION_STATE enum (v6), port lifecycle functions (v6)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.9-v6)

**Simplified stateless architecture (NO Port, NO BroadcastChannel):**

- `runtime.sendMessage()` - Content script → Background
- `tabs.sendMessage()` - Background → Content script / Manager
- `storage.onChanged` - **PRIMARY** sync mechanism for state updates
- Storage health check fallback - Polling every 5s if listener fails
- Unified barrier initialization - Resolve-only semantics (v1.6.3.9-v6)

**Dual Architecture (Retained from v3):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **message-handler.js** - TYPE-based v2 routing (QT_CREATED, QT_MINIMIZED)

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes)
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close minimized)

### v1.6.3.9-v7: Logging & Message Infrastructure (NEW)

**Sidebar (quick-tabs-manager.js):**

- Log capture: `SIDEBAR_LOG_BUFFER` with console override (matching background.js)
- Log export API: `getSidebarLogs()`, `clearSidebarLogs()`, `_exportSidebarLogs()`
- Message handlers: `GET_SIDEBAR_LOGS`, `CLEAR_SIDEBAR_LOGS`
- Direct state push: `PUSH_STATE_UPDATE` bypasses storage.onChanged
- Error notifications: `ERROR_NOTIFICATION` handler
- Init status query: `REQUEST_INIT_STATUS` handler
- Refactored routing: `_runtimeMessageHandlers` lookup table (CC 13→3)

**Constants (src/constants.js):**

- `KEEPALIVE_INTERVAL_MS` (25000ms) - moved from background.js
- `RENDER_STALL_TIMEOUT_MS` (5000ms) - moved from sidebar
- `RENDER_QUEUE_MAX_SIZE` (10) - moved from sidebar
- `STORAGE_WATCHDOG_TIMEOUT_MS` (2000ms) - moved from sidebar

### v1.6.3.9-v6: Sidebar & Background Cleanup (Previous)

- Simplified init (4 state vars), unified barrier, ~218 lines removed
- Render queue dedup: revision PRIMARY, `stateHashAtQueue` validation
- `_buildResponse()` helper, centralized timing constants

### v1.6.3.9-v5: Bug Fixes & Reliability (Previous)

- Tab ID fallback, storage event routing fix, response format fix

### v1.6.3.9-v4: Simplified Architecture (Previous)

- `scheduleRender()` with revision dedup, `_computeStateChecksum()`
- Storage health check (5s), orphan removal

### v1.6.3.9-v3 & v2: Retained Features

- **v3:** Dual architecture (MessageRouter + message-handler), diagnostic logging
- **v2:** Container isolation (`originContainerId`), tabs API events

---

## 🆕 Version Patterns Summary

### v1.6.3.9-v7 Patterns (Current)

- Log capture with `SIDEBAR_LOG_BUFFER`, O(1) message routing
- Direct state push (`PUSH_STATE_UPDATE`), error/init notifications
- New constants: `KEEPALIVE_INTERVAL_MS`, `RENDER_STALL_TIMEOUT_MS`

### v1.6.3.9-v6 Patterns (Previous)

- Unified barrier init, render queue revision PRIMARY, state hash
- `_buildResponse()` helper, centralized timing constants

### v1.6.3.9-v5 & Earlier Patterns

- **v5:** Tab ID fallback, storage event routing fix
- **v4:** Single barrier, storage.onChanged PRIMARY, render debounce
- **v3:** Dual architecture, diagnostic logging
- **v2:** Container isolation

### Key Timing Constants (v1.6.3.9-v7)

| Constant                           | Value                 | Purpose                        |
| ---------------------------------- | --------------------- | ------------------------------ |
| `STORAGE_KEY`                      | 'quick_tabs_state_v2' | Storage key name               |
| `INIT_BARRIER_TIMEOUT_MS`          | 10000                 | Unified barrier init timeout   |
| `RENDER_QUEUE_DEBOUNCE_MS`         | 100                   | Render queue debounce          |
| `MESSAGE_TIMEOUT_MS`               | 3000                  | runtime.sendMessage timeout    |
| `STORAGE_HEALTH_CHECK_INTERVAL_MS` | 5000                  | Health check fallback interval |
| `WRITE_IGNORE_WINDOW_MS`           | 100                   | Self-write detection window    |
| `STORAGE_CHANGE_COOLDOWN_MS`       | 200                   | Storage change cooldown        |
| `MAX_QUICK_TABS`                   | 100                   | Maximum Quick Tabs allowed     |
| `QUICK_TAB_ID_PREFIX`              | 'qt-'                 | Quick Tab ID prefix            |
| `ORPHAN_CLEANUP_INTERVAL_MS`       | 3600000 (1hr)         | Orphan cleanup interval        |
| `DEFAULT_CONTAINER_ID`             | 'firefox-default'     | Default container ID           |
| `KEEPALIVE_INTERVAL_MS`            | 25000                 | Background keepalive (v7)      |
| `RENDER_STALL_TIMEOUT_MS`          | 5000                  | Render stall detection (v7)    |
| `RENDER_QUEUE_MAX_SIZE`            | 10                    | Max queued renders (v7)        |
| `STORAGE_WATCHDOG_TIMEOUT_MS`      | 2000                  | Storage watchdog timeout (v7)  |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                        |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                   |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                              |
| TabStateManager       | `getTabState()`, `setTabState()`                                         |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`                 |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`      |
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)                |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`              |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`                |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                     |
| Manager               | `scheduleRender()`, `sendMessageToBackground()`, `_handleOperationAck()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `_computeStateChecksum()`

**Schema v2 Exports:** `validateStateWithDiagnostics()`, `version: 2` field,
`getQuickTabsByOriginTabIdAndContainer()`, `getQuickTabsByContainerId()`

**Browser API Exports:** `getTabsByContainer()`, `validateTabExists()`,
`getTabContainerId()`, `areTabsInSameContainer()`, `getAllContainers()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority. See Version Patterns Summary above for version-specific patterns.

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

**MCPs:** CodeScene (code health), Context7 (API docs), Perplexity (research)

**Testing:** `npm test` (Jest), `npm run lint` (ESLint), `npm run build`

---

## 🧠 Memory (Agentic-Tools MCP)

**End of task:** `git add .agentic-tools-mcp/`, commit. **Start of task:**
Search memories.

**search_memories:** Use 1-2 word queries, `threshold: 0.1`, `limit: 5`. Bash
fallback: `grep -r -l "keyword" .agentic-tools-mcp/memories/`

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass
- [ ] Memory files committed

---

## 📋 Quick Reference

### Key Files

| File                                | Features                                         |
| ----------------------------------- | ------------------------------------------------ |
| `src/constants.js`                  | Centralized constants (+225 lines in v4)         |
| `src/background/tab-events.js`      | Tabs API listeners (onActivated/Removed/Updated) |
| `src/utils/structured-logger.js`    | StructuredLogger class with contexts             |
| `src/storage/schema-v2.js`          | Container-aware queries, version field           |
| `src/storage/storage-manager.js`    | Simplified persistence, checksum validation      |
| `src/utils/browser-api.js`          | Container functions, validateTabExists()         |
| `src/messaging/message-router.js`   | ACTION-based routing (GET_CURRENT_TAB_ID, etc.)  |
| `src/background/message-handler.js` | TYPE-based v2 routing (QT_CREATED, etc.)         |
| `background.js`                     | \_computeStateChecksum(), \_generateQuickTabId() |
| `sidebar/quick-tabs-manager.js`     | scheduleRender(), sendMessageToBackground()      |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, originContainerId, correlationId, timestamp, version: 2 }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**v1.6.3.9-v7 New Messages:** `GET_SIDEBAR_LOGS`, `CLEAR_SIDEBAR_LOGS`,
`PUSH_STATE_UPDATE`, `ERROR_NOTIFICATION`, `REQUEST_INIT_STATUS`,
`CONTENT_SCRIPT_READY`, `CONTENT_SCRIPT_UNLOADING`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
