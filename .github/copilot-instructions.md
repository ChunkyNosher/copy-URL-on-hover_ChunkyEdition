# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.11-v5  
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

**v1.6.3.11-v5 Features (NEW) - 23 Issues Fixed:**

**Phase 1: Critical Missing Listeners (2 Issues):**

- **browser.commands.onCommand** - Enhanced with [COMMAND_RECEIVED],
  [COMMAND_EXECUTED], [COMMAND_LISTENER_REGISTERED] logging
- **browser.browserAction.onClicked** - Enhanced with [ACTION_BUTTON_CLICKED],
  [ACTION_BUTTON_LISTENER_REGISTERED], [SIDEBAR_TOGGLED] logging

**Phase 2: Storage Sync Infrastructure (2 Issues):**

- **Content storage.onChanged** - STORAGE_STATE_SYNC handler in content scripts
- **Background storage.onChanged** - Re-broadcast to all tabs via
  tabs.sendMessage

**Phase 3: Message Ordering & Port Lifecycle (3 Issues):**

- **Global Operation Sequence** - Counter for cross-tab message ordering
- **Port Viability Checks** - Enhanced port handling with heartbeat
- **Port Readiness Flag** - Message queue for BFCache restoration

**Phase 4: State Verification & Error Handling (5 Issues):**

- **Sidebar State Verification** - Origin tab existence checks on load
- **Handler Error Response** - Retry logic for transient failures
- **Notification Delivery Verification** - Retry and success tracking
- **Hover Detection Recovery** - Diagnostic messages to background
- **Map Storage Consistency** - quickTabHostInfo verification with backoff

**Phase 5: Content Script Init & Cache (2 Issues):**

- **State Readiness Gating** - Features wait for hydration before activating
- **Cache Dirty Flag** - Storage storm detection for adaptive rendering

**Phase 6: Logging & Telemetry (2 Issues):**

- **Logging Infrastructure** - L1-L7 prefixes via logging-infrastructure.js
- **Error Telemetry** - Threshold-based alerting via error-telemetry.js

**v1.6.3.11-v4 Features (Previous) - 22 Issues Fixed:**

- Shadow DOM Detection (YouTube, Twitter, Instagram, TikTok)
- Event Debouncing 100ms, Pointer Events API, Content Pipeline Logging
- Event Bus Visibility, Storage Timing Telemetry, Error Context Augmentation
- Content Storage Sync, Operation Acknowledgment, Error Recovery Backoff

**v1.6.3.11-v3 & Earlier (Consolidated):** HEARTBEAT Handler, Re-entrance Queue,
Message Validation, sendMessageWithTimeout(), BFCache Message Queue, Dedup
Window, GET_CURRENT_TAB_ID no init, BFCache port recovery, LRU map guard

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

### v1.6.3.11-v5 Patterns (Current)

- **Global Operation Sequence** - Cross-tab message ordering counter
- **Port Viability Checks** - Heartbeat-based port health monitoring
- **State Readiness Gating** - Features wait for hydration
- **Cache Storm Detection** - 100ms threshold, adaptive 200ms debounce
- **Error Telemetry** - 5 errors/minute threshold, 100 buffer max

### v1.6.3.11-v4 Patterns (Previous)

- **Shadow DOM Detection** - Traverse shadow roots for link detection
- **Event Debouncing** - 100ms debounce on hover events
- **Pointer Events API** - Passive listeners for hover detection
- **Operation Acknowledgment** - { success, operation, details } responses
- **Error Recovery Backoff** - Exponential backoff in content scripts

### v1.6.3.11-v3 & Earlier (Consolidated)

- BFCache PORT_VERIFY timeout (2000ms), Tab ID acquisition (120s total)
- Hydration timeout (10s), tab onRemoved 200ms debounce
- browser.tabs.query 2s timeout, adoption cache 100 entries
- LRU Map Guard (500 max, 30s cleanup, 24h stale)
- Tab ID exponential backoff, `VALID_MESSAGE_ACTIONS` allowlist
- Checkpoint system, identity-ready gating, code health 9.0+

### Key Timing Constants (v1.6.3.11-v5)

| Constant                     | Value  | Purpose                        |
| ---------------------------- | ------ | ------------------------------ |
| `ERROR_THRESHOLD_PER_MINUTE` | 5      | Telemetry escalation (NEW v5)  |
| `ERROR_BUFFER_MAX_SIZE`      | 100    | Rolling error buffer (NEW v5)  |
| `STORM_DETECTION_THRESHOLD`  | 100    | Cache storm detection ms (NEW) |
| `STORM_DEBOUNCE_MS`          | 200    | Adaptive render debounce (NEW) |
| `HOVER_DEBOUNCE_MS`          | 100    | Event debouncing               |
| `STORAGE_SLOW_THRESHOLD_MS`  | 100    | Storage timing warning         |
| `DEDUP_WINDOW_MS`            | 100    | Message dedup                  |
| `DEFAULT_MESSAGE_TIMEOUT_MS` | 5000   | Firefox message timeout        |
| `BFCACHE_VERIFY_TIMEOUT_MS`  | 2000   | PORT_VERIFY timeout            |
| `TAB_ID_EXTENDED_TOTAL_MS`   | 120000 | Extended tab ID timeout        |
| `HYDRATION_TIMEOUT_MS`       | 10000  | Storage hydration              |
| `TAB_REMOVAL_DEBOUNCE_MS`    | 200    | Tab onRemoved debounce         |
| `HEARTBEAT_INTERVAL_MS`      | 15000  | Background health check        |
| `LRU_MAP_MAX_SIZE`           | 500    | Maximum map entries            |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                               |
| --------------------- | --------------------------------------------------------------------- |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                     |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                           |
| TabStateManager       | `getTabState()`, `setTabState()`                                      |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`              |
| QuickTabHandler       | `_ensureInitialized()`, `_enqueueStorageWrite()`                      |
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
`validateOwnershipForWrite()`, `_computeStateChecksum()`

**v1.6.3.10-v11 New Exports:** `OPERATION_TYPE` enum, `trackStorageLatency()`,
`getAdaptiveDedupWindow()`, `LRUMapGuard`, `createSerialQueue()`

**Earlier Exports:** `normalizeOriginTabId()`, `checkStorageQuota()`

---

## 📝 Logging Prefixes

**v1.6.3.11-v5 (NEW):** `[COMMAND_RECEIVED]` `[COMMAND_EXECUTED]`
`[COMMAND_LISTENER_REGISTERED]` `[ACTION_BUTTON_CLICKED]`
`[ACTION_BUTTON_LISTENER_REGISTERED]` `[SIDEBAR_TOGGLED]` `[STORAGE_PROPAGATE]`
`[ERROR_RECOVERY]` `[PORT_LIFECYCLE]` `[STATE_RECONCILE]` `[SYNC_LATENCY]`
`[ERROR_TELEMETRY]`

**v1.6.3.11-v4:** `[MSG_COMMAND]` `[MSG_VALIDATION]` `[MSG_ROUTE]`
`[HOVER_EVENT]` `[PLATFORM_DETECT]` `[HANDLER_SELECT]` `[SHADOW_DOM_SEARCH]`
`[URL_EXTRACT]` `[TOOLTIP]` `[LISTENER_REG]` `[LISTENER_INVOKE]`
`[EVENT_COMPLETE]` `[STATE_UPDATE]` `[STORAGE_WRITE]` `[STATE_LISTEN]`
`[MSG:VALIDATE]` `[MSG:ROUTE]` `[MSG:EXEC]` `[MSG:RESPONSE]` `[STORAGE_SYNC]`
`[RECONCILE]` `[CROSS_TAB_SYNC]` `[MSG_HANDLER]`

**Previous:** `[INIT]` `[ADOPTION]` `[RESTORE]` `[MSG]` `[PORT_HANDSHAKE]`
`[QUEUE_BACKPRESSURE]` `[OWNERSHIP_VALIDATION]` `[STATE_CONSISTENCY]`
`[HEARTBEAT]` `[LRU_GUARD]` `[OPERATION_ID]` `[STORAGE_LATENCY]`
`[HYDRATION_BARRIER]` `[TIMER_LIFECYCLE]` `[LISTENER_CLEANUP]`
`[CREATION_QUEUE]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, Shadow DOM traversal (v4), operation acknowledgment (v4), state
readiness gating (v5), error telemetry (v5), port viability checks (v5).

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
| `src/utils/shadow-dom.js`                        | Shadow DOM link detection (v4)                  |
| `src/utils/error-telemetry.js`                   | Threshold-based alerting (NEW v5)               |
| `src/utils/logging-infrastructure.js`            | L1-L7 logging prefixes (NEW v5)                 |
| `src/background/tab-events.js`                   | Tabs API listeners                              |
| `src/utils/structured-logger.js`                 | StructuredLogger class with contexts            |
| `src/storage/storage-manager.js`                 | Simplified persistence, checksum validation     |
| `src/messaging/message-router.js`                | ACTION-based routing                            |
| `src/background/message-handler.js`              | TYPE-based v2 routing                           |
| `background.js`                                  | commands, browserAction listeners (enhanced v5) |
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
