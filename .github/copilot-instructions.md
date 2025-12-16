# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.9-v6  
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
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)
- **Tabs API Events** - onActivated, onRemoved, onUpdated listeners

**v1.6.3.9-v6 Features (NEW) - Sidebar & Background Cleanup:**

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

### v1.6.3.9-v6: Sidebar & Background Cleanup (NEW)

**Sidebar (quick-tabs-manager.js):**

- Simplified initialization: 4 state variables (was ~8)
- Unified barrier with resolve-only semantics
- Render queue dedup: revision PRIMARY over saveId
- ~218 lines dead code removed
- Enhanced `_routeRuntimeMessage()` with switch-based routing
- `stateHashAtQueue` field for state validation

**Background Script (background.js):**

- Port infrastructure remnants removed
- `_buildResponse()` helper for correlationId responses
- `version: 2` field added to globalQuickTabState

**Constants (src/constants.js):**

- `WRITE_IGNORE_WINDOW_MS` (100ms) - moved from background.js
- `STORAGE_CHANGE_COOLDOWN_MS` (200ms) - moved from background.js

### v1.6.3.9-v5: Bug Fixes & Reliability (Previous)

**Critical Fixes:**

- Tab ID initialization with background script fallback
- Storage event routing via `_handleStorageChangedEvent()`
- Adoption flow fallback for null tab IDs
- Response format includes `type` and `correlationId`

### v1.6.3.9-v4: Simplified Architecture (Previous)

- `scheduleRender()` with revision-based deduplication
- `_computeStateChecksum()` for data integrity
- Storage health check fallback (5s polling)
- Orphan cleanup now removes (not marks)

### v1.6.3.9-v3: Diagnostic Logging (Retained)

- `STORAGE_LISTENER_REGISTERED/FIRED` - Listener lifecycle
- `STATE_SYNC_MECHANISM` - Which sync mechanism was used

**Container Isolation (v2):**

- `originContainerId` field in Quick Tab data structure
- Container-aware queries: `getQuickTabsByOriginTabIdAndContainer()`
- Backward compatible: defaults to `'firefox-default'`

---

## 🆕 v1.6.3.9-v6 Patterns

- **Unified Barrier Init** - Single barrier with resolve-only semantics
- **Render Queue Priority** - Revision PRIMARY over saveId for dedup
- **Switch-Based Routing** - `_routeRuntimeMessage()` unified routing
- **State Hash Validation** - `stateHashAtQueue` field in render queue
- **Response Helper** - `_buildResponse()` with correlationId tracking
- **Centralized Timing** - `WRITE_IGNORE_WINDOW_MS`, `STORAGE_CHANGE_COOLDOWN_MS`

### v1.6.3.9-v5 Patterns (Previous)

- **Tab ID Fallback** - `currentBrowserTabId` fallback to background script
- **Storage Event Routing** - `_routeInitMessage()` → `_handleStorageChangedEvent()`
- **Message Cross-Routing** - Dispatcher handles both `type` and `action` fields

### v1.6.3.9-v4 Patterns (Previous)

- **Single Barrier Init** - Simple initialization, no multi-phase complexity
- **Storage.onChanged PRIMARY** - Primary sync, health check fallback
- **Render Queue Debounce** - 100ms debounce with revision deduplication
- **State Checksum** - `_computeStateChecksum()` for data integrity
- **Simplified Persistence** - `_persistToStorage()` with validation + sync
  backup
- **Orphan Removal** - Cleanup now removes orphans instead of marking

### v1.6.3.9-v3 Patterns (Previous)

- **Dual Architecture** - MessageRouter (ACTION) + message-handler (TYPE)
- **Diagnostic Logging** - Storage listener lifecycle, sync mechanism tracking

### v1.6.3.9-v2 Patterns (Retained)

- **Container Isolation** - `originContainerId` with Firefox Container support

### Key Timing Constants (v1.6.3.9-v6)

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
Authority, **v1.6.3.9-v6:** Unified barrier init, render queue revision PRIMARY,
switch-based routing, state hash validation, response helper, centralized timing
constants, **v1.6.3.9-v5:** Tab ID fallback, storage event routing fix, message
cross-routing, **v1.6.3.9-v4:** Single barrier init, storage.onChanged PRIMARY,
render queue debounce (100ms), storage health check (5s), state checksum,
simplified persistence, orphan removal, **v1.6.3.9-v3:** Dual architecture
(MessageRouter + message-handler), diagnostic logging, **v1.6.3.9-v2:**
Container isolation, tabs API events.

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

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
