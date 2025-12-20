# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.10-v11  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Quick Tabs v2 Architecture** - tabs.sendMessage messaging, single storage key
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time
- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Single Barrier Initialization** - Unified barrier with resolve-only semantics
- **Storage.onChanged PRIMARY** - Primary sync mechanism for state updates
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)

**v1.6.3.10-v11 Features (NEW) - 25 Issues Fixed (3 Diagnostic Reports):**

- **Extended Tab ID Acquisition** - 60s total timeout with 5s intervals
- **Operation Type Tracking** - CREATE/RESTORE/UPDATE/CLOSE/MINIMIZE enum
- **Adaptive Dedup Window** - 2x observed latency, 500ms minimum
- **Ownership Validation Middleware** - MessageRouter validates originTabId
- **Queue Backpressure** - 100 items, 75% warning threshold, retry dropped
- **Callback Re-wiring Timeout** - 500ms UICoordinator acknowledgment recovery
- **Hydration Barrier** - Operations queued until storage loaded (3s timeout)
- **Background Lifecycle** - In-flight recovery markers, beforeunload handler
- **Three-Phase Port Handshake** - INIT_REQUEST → INIT_RESPONSE → INIT_COMPLETE
- **LRU Map Guard** - 500 entry max, 10% eviction, 30s cleanup

**v1.6.3.10-v10 Features (Previous) - Issues 1-28 & Areas A-F:**

- Tab ID exponential backoff, storage write validation, handler deferral
- Adoption lock timeout, message validation, checkpoint system

**v1.6.3.10-v9 & Earlier (Consolidated):** Identity gating, storage errors,
quota monitoring, write queue recovery, code health 9.0+, type-safe tab IDs

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, StorageManager, MessageBuilder, StructuredLogger, MessageRouter

**Deprecated/Removed:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
runtime.Port (v12), complex init layers (v4), CONNECTION_STATE enum (v6)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

**Important:** When using context7, look up JavaScript/ES6/Web API documentation,
NOT "Quick Tabs" directly. context7 is for standard API references.

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

### v1.6.3.10-v11 Patterns (Current)

- Extended Tab ID acquisition (60s total with 5s intervals vs 7.2s)
- OPERATION_TYPE enum (CREATE/RESTORE/UPDATE/CLOSE/MINIMIZE) for sequencing
- Adaptive dedup window (2x observed storage latency, 500ms minimum)
- Ownership validation middleware in MessageRouter (originTabId vs sender)
- Queue backpressure at 75%, 100 items max, retry dropped messages
- Callback re-wiring with 500ms timeout for UICoordinator acknowledgment
- Lock key includes source (UI/Manager/background/automation)
- Hydration barrier: operations queued until storage loaded (3s timeout)
- Operation ID tracking with COMPLETED/FAILED completion logging
- Dynamic adoption cache TTL (3x handshake latency, 30s default)
- Background lifecycle with in-flight recovery markers
- Storage quota monitoring at 90% threshold with UI notification
- Event listener tracking (_registeredListeners) with cleanup
- Timer lifecycle tracking (_activeTimers Map, _cleanupTrackedTimers)
- State consistency checks every 5s with auto-recovery
- Background restart detection (15s heartbeat, 3 retry attempts)
- Three-phase port handshake (INIT_REQUEST/RESPONSE/COMPLETE)
- Serial Quick Tab creation queue with atomic ID generation
- LRU Map Guard (500 max, 10% eviction at 110%, 30s cleanup, 24h stale)

### v1.6.3.10-v10 & Earlier Patterns (Consolidated)

- Tab ID exponential backoff (200ms, 500ms, 1500ms, 5000ms)
- `VALID_MESSAGE_ACTIONS` allowlist, `RESPONSE_ENVELOPE` helpers
- Checkpoint system: `createCheckpoint()`, `rollbackToCheckpoint()`
- Identity-ready gating, storage error classification, write queue recovery
- Z-index recycling at threshold 100000, code health 9.0+ refactoring

### Key Timing Constants (v1.6.3.10-v11)

| Constant                        | Value  | Purpose                         |
| ------------------------------- | ------ | ------------------------------- |
| `TAB_ID_EXTENDED_TOTAL_MS`      | 60000  | Extended tab ID timeout         |
| `TAB_ID_EXTENDED_INTERVAL_MS`   | 5000   | Extended retry interval         |
| `QUEUE_BACKPRESSURE_THRESHOLD`  | 0.75   | Warning threshold (75%)         |
| `MAX_INIT_MESSAGE_QUEUE_SIZE`   | 100    | Max queue items (up from 20)    |
| `CALLBACK_REWIRE_TIMEOUT_MS`    | 500    | UICoordinator acknowledgment    |
| `HYDRATION_TIMEOUT_MS`          | 3000   | Operation gating timeout        |
| `ADOPTION_CACHE_DEFAULT_TTL_MS` | 30000  | Dynamic TTL default             |
| `HEARTBEAT_INTERVAL_MS`         | 15000  | Background health check         |
| `MESSAGE_RETRY_TIMEOUT_MS`      | 5000   | Message retry timeout           |
| `MESSAGE_MAX_RETRIES`           | 3      | Max retry attempts              |
| `STATE_CONSISTENCY_CHECK_MS`    | 5000   | Periodic validation interval    |
| `PORT_HANDSHAKE_PHASE_MS`       | 2000   | Per-phase handshake timeout     |
| `LRU_MAP_MAX_SIZE`              | 500    | Maximum map entries             |
| `LRU_CLEANUP_INTERVAL_MS`       | 30000  | Periodic cleanup (30s)          |
| `LRU_STALE_THRESHOLD_MS`        | 86400000 | Stale threshold (24h)           |

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

**v1.6.3.10-v11 New Exports:** `OPERATION_TYPE` enum, `trackStorageLatency()`,
`getAdaptiveDedupWindow()`, `validateOwnershipMiddleware()`, `LRUMapGuard`,
`createSerialQueue()`, `threePhaseHandshake()`, `checkBackgroundHealth()`

**v1.6.3.10-v10 Exports:** `validateOwnershipForWriteAsync()`,
`validateSnapshotIntegrity()`, `withTimeout()`, `createCheckpoint()`,
`rollbackToCheckpoint()`, `VALID_MESSAGE_ACTIONS`, `RESPONSE_ENVELOPE`

**Earlier Exports:** `normalizeOriginTabId()`, `waitForTabIdInit()`,
`checkStorageQuota()`, `IDENTITY_STATE_MODE`, `STORAGE_ERROR_TYPE`

---

## 📝 Logging Prefixes (v1.6.3.10-v11)

`[INIT]` Init | `[ADOPTION]` Adoption | `[RESTORE]` Restore | `[MSG]` Messages |
`[PORT_HANDSHAKE]` Three-phase handshake | `[QUEUE_BACKPRESSURE]` Queue warnings |
`[OWNERSHIP_VALIDATION]` Middleware | `[STATE_CONSISTENCY]` Periodic checks |
`[HEARTBEAT]` Background health | `[LRU_GUARD]` Map eviction | `[OPERATION_ID]`
Completion tracking | `[STORAGE_LATENCY]` Adaptive dedup | `[HYDRATION_BARRIER]`
Operation gating | `[TIMER_LIFECYCLE]` Timer tracking | `[LISTENER_CLEANUP]`
Event cleanup | `[CREATION_QUEUE]` Serial creation

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

**MCPs:** CodeScene (code health), Context7 (JavaScript API docs), Perplexity (research)

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
| `src/utils/lru-map-guard.js`                     | LRU eviction, 500 entry max, 30s cleanup (v11)              |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, originContainerId, correlationId, timestamp, version: 2 }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**v1.6.3.10-v11 New Messages:** `PORT_INIT_REQUEST`, `PORT_INIT_RESPONSE`,
`PORT_INIT_COMPLETE`, `OPERATION_COMPLETED`, `HEARTBEAT_PING`, `HEARTBEAT_PONG`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
