# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.10-v6  
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

**v1.6.3.10-v6 Features (NEW) - Type Safety & Container Isolation:**

- **Type-Safe Tab IDs** - `normalizeOriginTabId()` ensures numeric/null IDs
- **Async Tab ID Init** - `waitForTabIdInit()` prevents race conditions
- **Container ID Normalization** - `normalizeOriginContainerId()` for Firefox
- **Dual Ownership Validation** - Tab ID AND Container ID checks
- **Operation Lock Increase** - `OPERATION_LOCK_MS` 500ms→2000ms in mediator
- **Storage Write Retry** - Exponential backoff (100ms, 500ms, 1000ms)
- **Position Persistence Fix** - Skip persist if tab minimized (A3)
- **Snapshot Timeout** - MinimizedManager 1000ms expiration (A5)

**v1.6.3.10-v5 Features (Previous):** Atomic ops, exponential backoff, circuit
breaker, transaction ID entropy, surgical DOM, cache sync, targeted restore

**v1.6.3.10-v4 Features (Previous):** Container isolation, cross-tab validation,
Scripting API fallback, transaction cleanup, background restart detection

**v1.6.3.10-v3 & Earlier (Consolidated):** Adoption re-render, TabLifecycleHandler,
orphan detection, render debounce, circuit breaker, heartbeat, unified barrier

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

### v1.6.3.10-v6 Patterns (Current)

- Type-safe tab ID handling with `normalizeOriginTabId(value)`
- Async tab ID initialization with `waitForTabIdInit(timeoutMs)`
- Container ID normalization with `normalizeOriginContainerId(value)`
- Dual ownership validation (tab ID AND container ID)
- Increased operation lock timeout (2000ms vs 500ms)
- Storage write retry with exponential backoff (100ms, 500ms, 1000ms)
- Position persistence race condition fix (skip if minimized)
- MinimizedManager snapshot timeout (1000ms expiration)

### v1.6.3.10-v5 Patterns (Previous)

- Atomic operations, exponential backoff (150ms→8s, 1.5x, ±20%)
- Per-Quick Tab circuit breaker, higher entropy transaction IDs
- Surgical DOM updates, cache sync, targeted restore, diagnostic logging

### v1.6.3.10-v4 & Earlier Patterns (Consolidated)

- Container isolation (`originContainerId`), cross-tab validation
- Scripting API fallback, transaction cleanup, background restart detection
- Adoption re-render, TabLifecycleHandler, orphan detection
- Sliding-window debounce, circuit breaker, heartbeat, unified barrier

### Key Timing Constants (v1.6.3.10-v6)

| Constant                            | Value                 | Purpose                              |
| ----------------------------------- | --------------------- | ------------------------------------ |
| `STORAGE_KEY`                       | 'quick_tabs_state_v2' | Storage key name                     |
| `INIT_BARRIER_TIMEOUT_MS`           | 10000                 | Unified barrier init timeout         |
| `RENDER_DEBOUNCE_MS`                | 100                   | Render queue debounce (was 300)      |
| `RENDER_DEBOUNCE_MAX_WAIT_MS`       | 300                   | Sliding-window max cap               |
| `MESSAGE_TIMEOUT_MS`                | 3000                  | runtime.sendMessage timeout          |
| `CIRCUIT_BREAKER_OPEN_DURATION_MS`  | 3000                  | Circuit breaker cooldown             |
| `CIRCUIT_BREAKER_SLIDING_WINDOW_MS` | 5000                  | Failure sliding window               |
| `RECONNECT_BACKOFF_INITIAL_MS`      | 150                   | Initial reconnect delay              |
| `RECONNECT_BACKOFF_MAX_MS`          | 8000                  | Max reconnect backoff (was 2000)     |
| `RECONNECT_BACKOFF_MULTIPLIER`      | 1.5                   | Backoff multiplier                   |
| `KEEPALIVE_INTERVAL_MS`             | 20000                 | Keepalive interval (was 25000 in v3) |
| `HEARTBEAT_INTERVAL_MS`             | 15000                 | Heartbeat interval                   |
| `HEARTBEAT_TIMEOUT_MS`              | 2000                  | Heartbeat timeout                    |
| `TRANSACTION_TIMEOUT_MS`            | 30000                 | Transaction expiration               |
| `TRANSACTION_CLEANUP_INTERVAL_MS`   | 60000                 | Stale transaction cleanup (was 10s)  |
| `PORT_CLEANUP_INTERVAL_MS`          | 30000                 | Port cleanup interval (was 5min)     |
| `PORT_INACTIVITY_THRESHOLD_MS`      | 60000                 | Port inactivity threshold (was 10m)  |
| `LOGGING_THROTTLE_MS`               | 1000                  | Message logging throttle             |
| `SCRIPTING_FALLBACK_TIMEOUT_MS`     | 2000                  | Messaging timeout for Scripting API  |
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
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`                  |
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)                            |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`                          |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`                            |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                                 |
| Manager               | `scheduleRender()`, `sendMessageToBackground()`, `_handleOperationAck()`             |
| TabLifecycleHandler   | `start()`, `stop()`, `handleTabRemoved()`, `validateAdoptionTarget()`, `isTabOpen()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `_computeStateChecksum()`

**v1.6.3.10-v6 New Exports:** `normalizeOriginTabId()`, `waitForTabIdInit()`,
`isWritingTabIdInitialized()`, `normalizeOriginContainerId()`,
`setWritingContainerId()`, `getWritingContainerId()`, `serializeTabForStorage()`

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
