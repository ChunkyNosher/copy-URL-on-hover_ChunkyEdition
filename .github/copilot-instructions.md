# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.11-v3  
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
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)

**v1.6.3.11-v3 Features (NEW) - 55+ Issues Fixed:**

**Message Routing & Security (Issues #24, #25, #36, #47, #56):**

- **HEARTBEAT Handler** - Added to MessageRouter VALID_MESSAGE_ACTIONS
- **Re-entrance Queue** - Queue instead of reject re-entrant messages
- **Message Structure Validation** - Validates action/type before routing
- **originTabId Validation** - REQUIRE for ownership operations (no bypass)
- **Backward Compat Bypass Removed** - Security fix for ownership validation

**Port/State Lifecycle (Issues #27, #29, #30, #33, #37):**

- **pendingMessages Cleared** - On port disconnect with port generation tracking
- **State Machine Persistence** - Persist/restore from storage.session
- **Minimized State Persistence** - Persist/restore minimized Quick Tabs
- **Memory Leak Fix** - Garbage collection for pendingMessages Map
- **Mediator Listener Cleanup** - Already implemented in cleanup() method

**Cross-Browser & BFCache (Issues #48, #49, #51, #52):**

- **sendMessageWithTimeout()** - Firefox message timeout wrapper (adaptive)
- **Adaptive Handshake Timeout** - measuredHandshakeBaselineMs baseline tracking
- **BFCache Message Queue** - Queue messages during pagehide, drain on pageshow
- **Stale Event Rejection** - Reject events with timestamps before inactivity

**Message Deduplication (Issues #53, #54, #55, #60):**

- **Dedup Window Reduced** - 100ms (from 250ms) to allow rapid operations
- **Dedup TTL Reduced** - 3s (from 10s), cleanup 1s (from 5s)
- **Content Hash in Dedup Key** - Prevents false duplicate rejection
- **Enhanced Rejection Logging** - Full sender context in rejection logs

**Storage & Sync (Issues #21, #22, #32, #40, #69, #70):**

- **Storage Write Verification** - Verify writes by reading back data
- **Format Detection Refactored** - _detectStorageFormat() + _normalizeStorageFormat()
- **Migration Validation** - Atomic migration with rollback marker
- **Stale Data Rejection** - 1-hour threshold for sync storage fallback
- **Storage.onChanged Debouncing** - 100ms debounce in sidebar panel

**v1.6.3.11 Features (Previous):** GET_CURRENT_TAB_ID no init dependency,
synchronous listener registration, BFCache port recovery, port listener race
fix, INIT_RESPONSE timeout, cross-queue overflow protection, hydration drain
lock, namespaced message IDs, adoption cache TTL, navigation state reset

**v1.6.3.10-v14 & Earlier (Consolidated):** Tab ID pending queue, generation ID
tracking, handler init state, three-phase port handshake, BFCache detection,
message correlation, protocol versioning, adoption cache cleanup, dynamic
message buffer, LRU map guard, checkpoint system, code health 9.0+

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

**Important:** When using context7, look up JavaScript/ES6/Web API
documentation, NOT "Quick Tabs" directly. context7 is for standard API
references.

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

### v1.6.3.11-v3 Patterns (Current)

- **Message Dedup** - 100ms window (from 250ms), 3s TTL (from 10s), content hash key
- **Firefox Message Timeout** - sendMessageWithTimeout() with adaptive timeout
- **BFCache Message Queue** - Queue during pagehide, drain on pageshow
- **Storage Write Verification** - Read back after write to verify success
- **Storage.onChanged Debouncing** - 100ms debounce in sidebar panel
- **Enhanced Rejection Logging** - Full sender context in MessageRouter

### v1.6.3.11-v2 Patterns (Previous)

- BFCache PORT_VERIFY timeout (2000ms), Tab ID acquisition (120s total)
- Hydration timeout (10s), dedup window (250ms), tab onRemoved 200ms debounce
- browser.tabs.query 2s timeout, adoption cache 100 entries, 5-min cleanup
- Sidebar write protection, storage format detection, re-entrance guard
- State machine staleness, RESTORE validation, config migration

### v1.6.3.10-v11 & Earlier Patterns (Consolidated)

- Extended Tab ID (60s total, 5s intervals), OPERATION_TYPE enum
- Adaptive dedup window (2x latency, 500ms min), queue backpressure 75%/100
  items
- Hydration barrier (3s timeout), operation ID tracking
- Background lifecycle markers, storage quota monitoring (90% threshold)
- Three-phase port handshake, LRU Map Guard (500 max, 30s cleanup, 24h stale)
- Tab ID exponential backoff (200ms, 500ms, 1500ms, 5000ms)
- `VALID_MESSAGE_ACTIONS` allowlist, `RESPONSE_ENVELOPE` helpers
- Checkpoint system: `createCheckpoint()`, `rollbackToCheckpoint()`
- Identity-ready gating, storage error classification, write queue recovery
- Z-index recycling at threshold 100000, code health 9.0+ refactoring

### Key Timing Constants (v1.6.3.11-v3)

| Constant                        | Value    | Purpose                             |
| ------------------------------- | -------- | ----------------------------------- |
| `DEDUP_WINDOW_MS`               | 100      | Message dedup (was 250)             |
| `DEDUP_TTL_MS`                  | 3000     | Dedup entry TTL (was 10000)         |
| `DEDUP_CLEANUP_INTERVAL_MS`     | 1000     | Dedup cleanup (was 5000)            |
| `STORAGE_CHANGE_DEBOUNCE_MS`    | 100      | Sidebar storage.onChanged debounce  |
| `DEFAULT_MESSAGE_TIMEOUT_MS`    | 5000     | Firefox message timeout default     |
| `BFCACHE_VERIFY_TIMEOUT_MS`     | 2000     | PORT_VERIFY timeout                 |
| `TAB_ID_EXTENDED_TOTAL_MS`      | 120000   | Extended tab ID timeout             |
| `TAB_ID_EXTENDED_INTERVAL_MS`   | 5000     | Extended retry interval             |
| `HYDRATION_TIMEOUT_MS`          | 10000    | Storage hydration                   |
| `TAB_REMOVAL_DEBOUNCE_MS`       | 200      | Tab onRemoved debounce              |
| `QUERY_TIMEOUT_MS`              | 2000     | browser.tabs.query timeout          |
| `ADOPTION_CACHE_MAX_SIZE`       | 100      | Max adoption cache entries          |
| `OPEN_TABS_CLEANUP_INTERVAL_MS` | 300000   | 5-minute cleanup interval           |
| `QUEUE_BACKPRESSURE_THRESHOLD`  | 0.75     | Warning threshold (75%)             |
| `MAX_INIT_MESSAGE_QUEUE_SIZE`   | 100      | Max queue items                     |
| `CALLBACK_REWIRE_TIMEOUT_MS`    | 500      | UICoordinator acknowledgment        |
| `ADOPTION_CACHE_DEFAULT_TTL_MS` | 30000    | Dynamic TTL default                 |
| `HEARTBEAT_INTERVAL_MS`         | 15000    | Background health check             |
| `LRU_MAP_MAX_SIZE`              | 500      | Maximum map entries                 |
| `LRU_CLEANUP_INTERVAL_MS`       | 30000    | Periodic cleanup (30s)              |
| `LRU_STALE_THRESHOLD_MS`        | 86400000 | Stale threshold (24h)               |

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
`getAdaptiveDedupWindow()`, `LRUMapGuard`, `createSerialQueue()`

**v1.6.3.10-v10 Exports:** `validateOwnershipForWriteAsync()`,
`validateSnapshotIntegrity()`, `withTimeout()`, `createCheckpoint()`,
`rollbackToCheckpoint()`, `VALID_MESSAGE_ACTIONS`, `RESPONSE_ENVELOPE`

**Earlier Exports:** `normalizeOriginTabId()`, `checkStorageQuota()`

---

## 📝 Logging Prefixes

`[INIT]` `[ADOPTION]` `[RESTORE]` `[MSG]` `[PORT_HANDSHAKE]`
`[QUEUE_BACKPRESSURE]` `[OWNERSHIP_VALIDATION]` `[STATE_CONSISTENCY]`
`[HEARTBEAT]` `[LRU_GUARD]` `[OPERATION_ID]` `[STORAGE_LATENCY]`
`[HYDRATION_BARRIER]` `[TIMER_LIFECYCLE]` `[LISTENER_CLEANUP]`
`[CREATION_QUEUE]`

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
