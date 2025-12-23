# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.11-v6  
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

**v1.6.3.11-v6 Features (NEW) - 14 Firefox Critical Fixes:**

- **BFCache Port Validation** - Validate port on pageshow, auto-reconnect on stale
- **Adaptive Timeout** - 90th percentile, 7s default, backoff 2x/4x/8x
- **Load Shedding** - 50%/75%/90% thresholds, OPERATION_PRIORITY_LEVEL enum
- **Hydration Drain Scheduler** - Queue-based with re-drain on concurrent completions
- **Message ID Collision** - Iterative retry with -r1/-r2 suffix, O(1) detection
- **Clock Skew Tolerance** - 150ms tolerance for stale event rejection
- **Heartbeat Circuit Breaker** - 15s→30s→60s→120s backoff, pause at 10 failures
- **Queued Operation Timeout** - 5s per-op timeout, hung ops don't block drain
- **Init Phase Logging** - _logFeatureInitStart/Complete(), _logHydrationProgress()
- **Response Field Validation** - RESPONSE_FIELD_SCHEMA, _checkRequiredResponseFields()
- **Port Adoption Scaling** - Dynamic 3x/5x/7x multiplier based on latency
- **Module Import Degradation** - _moduleLoadStatus, critical vs optional distinction

**v1.6.3.12 (Previous):** Early message listener at TOP, queue (max 100), drain via
_setMessageRouterReady(), type-based handlers

**v1.6.3.11-v5 (Previous):** commands.onCommand, storage.onChanged, state gating, telemetry

**v1.6.3.11-v4 & Earlier:** Shadow DOM, event debouncing, LRU guard, message validation

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

### v1.6.3.11-v6 Patterns (Current)

- **BFCache Port Validation** - `_handlePageShow()` validates, `_handlePageHide()` cleanup
- **Adaptive Timeout** - 90th percentile, 7s base, background restart detection
- **Load Shedding** - OPERATION_PRIORITY_LEVEL enum (CRITICAL/HIGH/MEDIUM/LOW)
- **Hydration Drain** - `pendingHydrationCompletions`, `redrainScheduled` flag
- **Message ID Collision** - Iterative loop with counter suffix (-r1, -r2)
- **Clock Skew** - 150ms tolerance window for stale event detection
- **Heartbeat Circuit** - Exponential backoff, pause at 10 consecutive failures
- **Response Validation** - RESPONSE_FIELD_SCHEMA, `_checkRequiredResponseFields()`
- **Module Degradation** - `_moduleLoadStatus`, critical vs optional modules

### Previous Version Patterns (Consolidated)

- **v12:** Early message listener, queue drain, type-based handlers
- **v5:** Operation sequence, port viability, state gating, error telemetry
- **v4:** Shadow DOM traversal, event debouncing, operation acknowledgment
- **v3:** LRU Map Guard, checkpoint system, identity gating, code health 9.0+

### Key Timing Constants (v1.6.3.11-v6)

| Constant                       | Value  | Purpose                              |
| ------------------------------ | ------ | ------------------------------------ |
| `DEFAULT_MESSAGE_TIMEOUT_MS`   | 7000   | Firefox message timeout (was 5s)     |
| `ADAPTIVE_PERCENTILE`          | 0.90   | 90th percentile for Firefox          |
| `CLOCK_SKEW_TOLERANCE_MS`      | 150    | Stale event tolerance window         |
| `QUEUED_OPERATION_TIMEOUT_MS`  | 5000   | Per-operation timeout in queue       |
| `BACKPRESSURE_50_THRESHOLD`    | 50     | Reject non-critical operations       |
| `BACKPRESSURE_75_THRESHOLD`    | 75     | Reject medium-priority operations    |
| `BACKPRESSURE_90_THRESHOLD`    | 90     | Critical-only mode                   |
| `HEARTBEAT_BACKOFF_MAX_MS`     | 120000 | Max heartbeat interval after fails   |
| `HEARTBEAT_PAUSE_THRESHOLD`    | 10     | Consecutive failures before pause    |
| `_MAX_EARLY_QUEUE_SIZE`        | 100    | Max queued messages before ready     |
| `HYDRATION_TIMEOUT_MS`         | 10000  | Storage hydration timeout            |
| `BFCACHE_VERIFY_TIMEOUT_MS`    | 2000   | PORT_VERIFY timeout                  |
| `TAB_ID_EXTENDED_TOTAL_MS`     | 120000 | Extended tab ID timeout              |
| `LRU_MAP_MAX_SIZE`             | 500    | Maximum map entries                  |

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

**v1.6.3.11-v6 (NEW):** `[PORT_VALIDATE]` `[PORT_RECONNECT]` `[BACKPRESSURE]`
`[LOAD_SHEDDING]` `[DRAIN_SCHEDULER]` `[TIMEOUT_BACKOFF]` `[HEARTBEAT_CIRCUIT]`
`[MSG_ID_COLLISION]` `[INIT_PHASE]` `[INIT_FEATURE]` `[INIT_HYDRATION]`
`[RESPONSE_VALIDATE]` `[MODULE_LOAD]`

**Previous:** `[EARLY_LISTENER_REGISTRATION]` `[MESSAGE_ROUTER_READY]`
`[COMMAND_RECEIVED]` `[COMMAND_EXECUTED]` `[STORAGE_PROPAGATE]` `[ERROR_TELEMETRY]`
`[MSG_COMMAND]` `[HOVER_EVENT]` `[SHADOW_DOM_SEARCH]` `[INIT]` `[ADOPTION]`
`[HEARTBEAT]` `[LRU_GUARD]` `[STORAGE_LATENCY]` `[HYDRATION_BARRIER]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, Shadow DOM traversal, operation acknowledgment, state readiness
gating, error telemetry, port viability checks, heartbeat circuit breaker,
message ID collision handling, clock skew tolerance, module degradation.

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
| `background.js`                                  | Early message listener, queue drain (v12)       |
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
