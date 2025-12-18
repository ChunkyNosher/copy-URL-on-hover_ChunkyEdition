# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.10-v7  
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
- **Single Barrier Initialization** - Unified barrier with resolve-only
  semantics
- **Storage.onChanged PRIMARY** - Primary sync mechanism for state updates
- **Runtime.onMessage Secondary** - Direct state push from background
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)
- **Tabs API Events** - onActivated, onRemoved, onUpdated listeners

**v1.6.3.10-v7 Features (NEW) - Reliability & Robustness:**

- **Port Reconnection Circuit Breaker** - State machine (DISCONNECTED/CONNECTING/CONNECTED/FAILED), 5 failure limit, 30s max backoff
- **Background Handshake Ready Signal** - `isReadyForCommands`, command buffering, latency tracking
- **Adaptive Dedup Window** - 2x observed latency (min 2s, max 10s)
- **Port Message Ordering** - sequenceId tracking for critical messages
- **Handler Init Guards** - All handlers use `_ensureInitialized()` consistently
- **Storage Event De-duplication** - 200ms window, correlationId/timestamp versioning
- **quickTabHostInfo Cleanup** - 5-min maintenance, max 500 entries
- **Storage Write Serialization** - Write queue with optimistic locking (max 3 retries)
- **Adoption-Aware Ownership** - Track recently-adopted Quick Tab IDs (5s TTL)

**v1.6.3.10-v6 Features (Previous):** Type-safe tab IDs, async tab ID init,
container ID normalization, dual ownership validation, operation lock increase

**v1.6.3.10-v5 Features (Previous):** Atomic ops, exponential backoff, circuit
breaker, transaction ID entropy, surgical DOM, cache sync, targeted restore

**v1.6.3.10-v4 & Earlier (Consolidated):** Container isolation, cross-tab validation,
Scripting API fallback, adoption re-render, TabLifecycleHandler, orphan detection

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager,
MessageBuilder, StructuredLogger, TabEventsManager, MessageRouter

**Deprecated/Removed:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
runtime.Port (v12), complex init layers (v4), CONNECTION_STATE enum (v6)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.10-v4)

**Simplified stateless architecture (NO Port, NO BroadcastChannel):**

- `runtime.sendMessage()` - Content script → Background
- `tabs.sendMessage()` - Background → Content script / Manager
- `storage.onChanged` - **PRIMARY** sync mechanism for state updates
- Storage health check fallback - Polling every 5s if listener fails
- Unified barrier initialization - Resolve-only semantics

**Dual Architecture (Retained from v3):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **message-handler.js** - TYPE-based v2 routing (QT_CREATED, QT_MINIMIZED)

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes)
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close minimized)

### v1.6.3.10-v3: Issue #47 Adoption Re-render & Tabs API Phase 2

- `ADOPTION_COMPLETED` message for instant Manager re-render
- TabLifecycleHandler, orphan detection, `validateAdoptionTarget()`

---

## 🆕 Version Patterns Summary

### v1.6.3.10-v7 Patterns (Current)

- Port reconnection circuit breaker with state machine (5 failures, 30s backoff)
- Background handshake ready signal with command buffering
- Adaptive dedup window (2x latency, min 2s, max 10s)
- Port message ordering with sequenceId validation
- Storage event de-duplication (200ms window)
- quickTabHostInfo periodic cleanup (5-min, max 500 entries)
- Storage write serialization with optimistic locking (max 3 retries)
- Adoption-aware ownership tracking (5s TTL)

### v1.6.3.10-v6 Patterns (Previous)

- Type-safe tab ID handling with `normalizeOriginTabId(value)`
- Async tab ID initialization with `waitForTabIdInit(timeoutMs)`
- Container ID normalization, dual ownership validation

### v1.6.3.10-v5 & Earlier Patterns (Consolidated)

- Atomic operations, exponential backoff, per-Quick Tab circuit breaker
- Container isolation, cross-tab validation, Scripting API fallback
- Adoption re-render, TabLifecycleHandler, orphan detection

### Key Timing Constants (v1.6.3.10-v7)

| Constant                            | Value                 | Purpose                              |
| ----------------------------------- | --------------------- | ------------------------------------ |
| `STORAGE_KEY`                       | 'quick_tabs_state_v2' | Storage key name                     |
| `INIT_BARRIER_TIMEOUT_MS`           | 10000                 | Unified barrier init timeout         |
| `RENDER_DEBOUNCE_MS`                | 100                   | Render queue debounce (was 300)      |
| `MESSAGE_TIMEOUT_MS`                | 3000                  | runtime.sendMessage timeout          |
| `MAX_CONSECUTIVE_FAILURES`          | 5                     | Port circuit breaker failure limit   |
| `CIRCUIT_BREAKER_BACKOFF_MAX_MS`    | 30000                 | Port circuit breaker max backoff     |
| `GRACE_PERIOD_MS`                   | 5000                  | Port reconnect grace period          |
| `ADAPTIVE_DEDUP_MIN_MS`             | 2000                  | Min adaptive dedup window            |
| `ADAPTIVE_DEDUP_MAX_MS`             | 10000                 | Max adaptive dedup window            |
| `STORAGE_DEDUP_WINDOW_MS`           | 200                   | Storage event dedup window           |
| `MESSAGE_QUEUE_MAX_SIZE`            | 50                    | Port message queue limit             |
| `HOST_INFO_MAX_ENTRIES`             | 500                   | quickTabHostInfo max entries         |
| `HOST_INFO_MAINTENANCE_INTERVAL_MS` | 300000                | Host info cleanup (5 minutes)        |
| `ADOPTED_QUICKTAB_TTL_MS`           | 5000                  | Adoption ownership TTL               |
| `STORAGE_WRITE_MAX_RETRIES`         | 3                     | Storage write retry limit            |
| `PORT_VIABILITY_MIN_TIMEOUT_MS`     | 700                   | Min port viability timeout           |
| `PORT_VIABILITY_MAX_TIMEOUT_MS`     | 3000                  | Max port viability timeout           |
| `DEFERRED_EXPIRATION_WAIT_MS`       | 500                   | Snapshot TTL deferred wait           |
| `OPERATION_LOCK_MS`                 | 2000                  | Mediator operation lock (was 500)    |
| `SNAPSHOT_TIMEOUT_MS`               | 1000                  | MinimizedManager snapshot expiration |
| `MAX_QUICK_TABS`                    | 100                   | Maximum Quick Tabs allowed           |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                                    |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                               |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                                          |
| TabStateManager       | `getTabState()`, `setTabState()`                                                     |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`                             |
| QuickTabHandler       | `_ensureInitialized()`, `_enqueueStorageWrite()`, `_performStorageWrite()`           |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`                  |
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)                            |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`                          |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`                            |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                                 |
| Manager               | `scheduleRender()`, `_startHostInfoMaintenance()`, `_validateAdoptionContainers()`   |
| TabLifecycleHandler   | `start()`, `stop()`, `handleTabRemoved()`, `validateAdoptionTarget()`, `isTabOpen()` |
| MinimizedManager      | `_scheduleSnapshotExpiration()`, `_handleSnapshotExpiration()`                       |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `_computeStateChecksum()`

**v1.6.3.10-v7 New Exports:** `_enqueueStorageWrite()`, `_processWriteQueue()`,
`_performStorageWrite()`, `_isStorageEventDuplicate()`, `_trackAdoptedQuickTab()`,
`_getAdoptionOwnership()`, `_validateMessageSequence()`

**v1.6.3.10-v6 Exports:** `normalizeOriginTabId()`, `waitForTabIdInit()`,
`normalizeOriginContainerId()`, `serializeTabForStorage()`

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

| File                                             | Features                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `src/constants.js`                               | Centralized constants (+225 lines in v4)                    |
| `src/background/tab-events.js`                   | Tabs API listeners (onActivated/Removed/Updated)            |
| `src/utils/structured-logger.js`                 | StructuredLogger class with contexts                        |
| `src/storage/schema-v2.js`                       | Container-aware queries, version field                      |
| `src/storage/storage-manager.js`                 | Simplified persistence, checksum validation                 |
| `src/utils/browser-api.js`                       | Container functions, validateTabExists()                    |
| `src/messaging/message-router.js`                | ACTION-based routing (GET_CURRENT_TAB_ID, etc.)             |
| `src/background/message-handler.js`              | TYPE-based v2 routing (QT_CREATED, etc.)                    |
| `background.js`                                  | \_computeStateChecksum(), \_generateQuickTabId()            |
| `sidebar/quick-tabs-manager.js`                  | scheduleRender(), sendMessageToBackground()                 |
| `src/background/handlers/TabLifecycleHandler.js` | Tab lifecycle events, orphan detection, adoption validation |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, originContainerId, correlationId, timestamp, version: 2 }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**v1.6.3.10-v4 New Messages:** `BACKGROUND_HANDSHAKE`, `ADOPTION_COMPLETED`,
`ORIGIN_TAB_CLOSED`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
