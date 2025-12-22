# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.11-v4  
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

**v1.6.3.11-v4 Features (NEW) - 22 Issues Fixed:**

**Phase 1: Keyboard Shortcut & Settings (5 Issues):**

- **browser.commands.onCommand** - Listener in background.js
- **Dynamic Shortcut Updates** - browser.commands.update() integration
- **Firefox Format Validation** - Keyboard shortcut state validation
- **Sidebar-to-Commands API** - Connected settings to browser.commands

**Phase 2: Hover Detection & Shadow DOM (5 Issues):**

- **Shadow DOM Detection** - YouTube, Twitter, Instagram, TikTok support
- **Event Debouncing** - 100ms debounce, CPU 40-60% → 5-10%
- **Pointer Events API** - Migration from mouse events with passive listeners
- **New Module** - src/utils/shadow-dom.js for Shadow DOM traversal

**Phase 3: Logging & Instrumentation (6 Issues):**

- **Content Pipeline Logging** - Event tracking throughout content script
- **Event Bus Visibility** - [LISTENER_REG], [LISTENER_INVOKE], [EVENT_COMPLETE]
- **State Management Observability** - [STATE_UPDATE], [STORAGE_WRITE]
- **Storage Timing Telemetry** - Warns if operations >100ms
- **Error Context Augmentation** - Handler name, operation, request context

**Phase 4: Cross-Component Integration (6 Issues):**

- **Content Storage Sync** - storage.onChanged with [STORAGE_SYNC] prefix
- **Operation Acknowledgment** - { success, operation, details } pattern
- **Error Recovery** - Exponential backoff in content scripts
- **Multi-Tab Reconciliation** - [CROSS_TAB_SYNC] prefix

**v1.6.3.11-v3 Features (Previous) - 55+ Issues Fixed:**

- HEARTBEAT Handler, Re-entrance Queue, Message Structure Validation
- pendingMessages Cleared, State Machine Persistence, Memory Leak Fix
- sendMessageWithTimeout(), Adaptive Handshake, BFCache Message Queue
- Dedup Window 100ms, Content Hash Dedup Key, Enhanced Rejection Logging
- Storage Write Verification, Format Detection, Migration Validation

**v1.6.3.11 & Earlier (Consolidated):** GET_CURRENT_TAB_ID no init dependency,
BFCache port recovery, cross-queue overflow protection, Tab ID pending queue,
three-phase port handshake, LRU map guard, checkpoint system, code health 9.0+

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

---

## 🆕 Version Patterns Summary

### v1.6.3.11-v4 Patterns (Current)

- **Shadow DOM Detection** - Traverse shadow roots for link detection
- **Event Debouncing** - 100ms debounce on hover events
- **Pointer Events API** - Passive listeners for hover detection
- **Operation Acknowledgment** - { success, operation, details } responses
- **Error Recovery Backoff** - Exponential backoff in content scripts
- **Storage Timing** - Telemetry warns if >100ms

### v1.6.3.11-v3 Patterns (Previous)

- Message Dedup 100ms window, 3s TTL, content hash key
- Firefox Message Timeout with adaptive timeout
- BFCache Message Queue during pagehide
- Storage Write Verification, Storage.onChanged Debouncing

### v1.6.3.11-v2 & Earlier (Consolidated)

- BFCache PORT_VERIFY timeout (2000ms), Tab ID acquisition (120s total)
- Hydration timeout (10s), tab onRemoved 200ms debounce
- browser.tabs.query 2s timeout, adoption cache 100 entries
- LRU Map Guard (500 max, 30s cleanup, 24h stale)
- Tab ID exponential backoff, `VALID_MESSAGE_ACTIONS` allowlist
- Checkpoint system, identity-ready gating, code health 9.0+

### Key Timing Constants (v1.6.3.11-v4)

| Constant                     | Value    | Purpose                        |
| ---------------------------- | -------- | ------------------------------ |
| `HOVER_DEBOUNCE_MS`          | 100      | Event debouncing (NEW)         |
| `STORAGE_SLOW_THRESHOLD_MS`  | 100      | Storage timing warning (NEW)   |
| `DEDUP_WINDOW_MS`            | 100      | Message dedup                  |
| `DEDUP_TTL_MS`               | 3000     | Dedup entry TTL                |
| `DEFAULT_MESSAGE_TIMEOUT_MS` | 5000     | Firefox message timeout        |
| `BFCACHE_VERIFY_TIMEOUT_MS`  | 2000     | PORT_VERIFY timeout            |
| `TAB_ID_EXTENDED_TOTAL_MS`   | 120000   | Extended tab ID timeout        |
| `HYDRATION_TIMEOUT_MS`       | 10000    | Storage hydration              |
| `TAB_REMOVAL_DEBOUNCE_MS`    | 200      | Tab onRemoved debounce         |
| `QUERY_TIMEOUT_MS`           | 2000     | browser.tabs.query timeout     |
| `ADOPTION_CACHE_MAX_SIZE`    | 100      | Max adoption cache entries     |
| `HEARTBEAT_INTERVAL_MS`      | 15000    | Background health check        |
| `LRU_MAP_MAX_SIZE`           | 500      | Maximum map entries            |
| `LRU_STALE_THRESHOLD_MS`     | 86400000 | Stale threshold (24h)          |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                            |
| --------------------- | ------------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                  |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                             |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                        |
| TabStateManager       | `getTabState()`, `setTabState()`                                   |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`           |
| QuickTabHandler       | `_ensureInitialized()`, `_enqueueStorageWrite()`                   |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`|
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)          |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`        |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`          |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`               |
| Manager               | `scheduleRender()`, `_startHostInfoMaintenance()`                  |
| TabLifecycleHandler   | `start()`, `stop()`, `handleTabRemoved()`, `validateAdoptionTarget()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `_computeStateChecksum()`

**v1.6.3.10-v11 New Exports:** `OPERATION_TYPE` enum, `trackStorageLatency()`,
`getAdaptiveDedupWindow()`, `LRUMapGuard`, `createSerialQueue()`

**Earlier Exports:** `normalizeOriginTabId()`, `checkStorageQuota()`

---

## 📝 Logging Prefixes

**v1.6.3.11-v4 (NEW):** `[MSG_COMMAND]` `[MSG_VALIDATION]` `[MSG_ROUTE]`
`[HOVER_EVENT]` `[PLATFORM_DETECT]` `[HANDLER_SELECT]` `[SHADOW_DOM_SEARCH]`
`[URL_EXTRACT]` `[TOOLTIP]` `[LISTENER_REG]` `[LISTENER_INVOKE]`
`[EVENT_COMPLETE]` `[STATE_UPDATE]` `[STORAGE_WRITE]` `[STATE_LISTEN]`
`[MSG:VALIDATE]` `[MSG:ROUTE]` `[MSG:EXEC]` `[MSG:RESPONSE]` `[STORAGE_SYNC]`
`[RECONCILE]` `[CROSS_TAB_SYNC]`

**Previous:** `[INIT]` `[ADOPTION]` `[RESTORE]` `[MSG]` `[PORT_HANDSHAKE]`
`[QUEUE_BACKPRESSURE]` `[OWNERSHIP_VALIDATION]` `[STATE_CONSISTENCY]`
`[HEARTBEAT]` `[LRU_GUARD]` `[OPERATION_ID]` `[STORAGE_LATENCY]`
`[HYDRATION_BARRIER]` `[TIMER_LIFECYCLE]` `[LISTENER_CLEANUP]`
`[CREATION_QUEUE]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, Shadow DOM traversal (v4), operation acknowledgment (v4).

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

| File                                             | Features                                        |
| ------------------------------------------------ | ----------------------------------------------- |
| `src/constants.js`                               | Centralized constants                           |
| `src/utils/shadow-dom.js`                        | Shadow DOM link detection (NEW v4)              |
| `src/background/tab-events.js`                   | Tabs API listeners                              |
| `src/utils/structured-logger.js`                 | StructuredLogger class with contexts            |
| `src/storage/storage-manager.js`                 | Simplified persistence, checksum validation     |
| `src/messaging/message-router.js`                | ACTION-based routing                            |
| `src/background/message-handler.js`              | TYPE-based v2 routing                           |
| `background.js`                                  | \_computeStateChecksum(), commands listener (v4)|
| `sidebar/quick-tabs-manager.js`                  | scheduleRender(), sendMessageToBackground()     |
| `src/background/handlers/TabLifecycleHandler.js` | Tab lifecycle, orphan detection                 |

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
