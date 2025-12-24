# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.11-v9  
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

**v1.6.3.11-v9 Features (NEW) - Diagnostic Report Fixes:**

- **Issue A Fix** - Content script tab identity initialization before state changes
  - `[IDENTITY_INIT]` logging markers added (SCRIPT_LOAD, TAB_ID_REQUEST, TAB_ID_RESPONSE, IDENTITY_READY)
- **Issue C Fix** - Identity initialization has comprehensive logging
  - All identity phases logged with timestamps
- **Issue D Fix** - Storage write queue enforces identity-ready precondition
  - `waitForIdentityInit()` called before processing writes
  - `[WRITE_PHASE]` logging for FETCH_PHASE, QUOTA_CHECK_PHASE, SERIALIZE_PHASE, WRITE_API_PHASE
- **Issue E Fix** - State validation has pre/post comparison logging
  - `[STATE_VALIDATION] PRE_POST_COMPARISON` shows delta
- **Issue I Fix** - Debounce timer captures tab context at schedule time
  - `capturedTabId` stored when timer is scheduled, not when it fires
- **Issue 3.2 Fix** - Z-index counter recycling threshold lowered (100000 → 10000)
- **Issue 5 Fix** - Container isolation validated in all visibility operations
  - `_validateContainerIsolation()` helper added
  - `currentContainerId` stored in VisibilityHandler constructor

**v1.6.3.11-v8 Features - Transaction Tracking + Null originTabId Rejection:**

- **Issue #10 Fix** - Transaction tracking wired to storage writes
  - `setTransactionCallbacks()` method for background.js injection
  - `transactionId` included in storage payloads for deduplication
- **Issue #12 Fix** - Quick Tab creation rejected if originTabId is null
  - `_validateOriginTabIdResolution()` validates before creation
  - Returns retryable error with clear message
- **Issue #21 Fix** - Identity system must be ready before creation
  - `_hasUnknownPlaceholder()` detects "unknown" in quickTabId
  - Creation rejected with `IDENTITY_NOT_READY` error
- **Issue #5 Fix** - Hydration race condition handling improved
  - `[HydrationBoundary]` logging markers added
  - All error responses include `retryable: true` flag

**v1.6.3.11-v7 Features - Orphan Quick Tabs Fix + Code Health:**

- **Orphan Quick Tabs Fix** - `originTabId` and `originContainerId` now stored
  in `handleCreate()` method in `QuickTabHandler.js`
- **Helper Methods** - `_resolveOriginTabId()`, `_validateTabId()`,
  `_extractTabIdFromPattern()` for robust tab ID handling
- **Code Health Improvements** - 16+ complex methods refactored across 4 files:
  - `sidebar/quick-tabs-manager.js` - Score 7.32 → 8.26
  - `src/utils/storage-utils.js` - Score 7.44 → 7.78
  - `src/content.js` - Score 8.71 → 9.09
  - `background.js` - Score 8.02 → 8.40

**v1.6.3.10-v10 Base (Restored):** Tab ID acquisition, handler deferral,
adoption lock timeout, checkpoint system, message validation, identity gating,
storage quota monitoring, container isolation

**v1.6.3.10 & Earlier (Consolidated):** Shadow DOM traversal, event debouncing,
LRU guard, operation acknowledgment, code health 9.0+ targets

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

### v1.6.3.11-v9 Patterns (Current)

- **Identity Init Logging** - `[IDENTITY_INIT]` markers for SCRIPT_LOAD, TAB_ID_REQUEST, TAB_ID_RESPONSE, IDENTITY_READY
- **Write Phase Logging** - `[WRITE_PHASE]` markers for FETCH_PHASE, QUOTA_CHECK_PHASE, SERIALIZE_PHASE, WRITE_API_PHASE
- **State Validation Delta** - `[STATE_VALIDATION] PRE_POST_COMPARISON` shows pre/post tabs filtered
- **Debounce Context Capture** - `capturedTabId` stored at schedule time, not fire time
- **Z-Index Recycling** - Threshold lowered from 100000 to 10000
- **Container Validation** - `_validateContainerIsolation()` added to visibility operations
- **Identity Precondition** - Write queue awaits `waitForIdentityInit()` before processing

### v1.6.3.11-v8 Patterns

- **Transaction Tracking Wired** - `setTransactionCallbacks()` connects
  background.js `_trackTransaction/_completeTransaction` to QuickTabHandler
- **transactionId in Storage** - Included in payloads for deduplication via
  `_isTransactionSelfWrite()`
- **Null originTabId Rejection** - `handleCreate()` rejects with retryable error
- **Identity System Gate** - `_hasUnknownPlaceholder()` detects "unknown" in
  quickTabId
- **Hydration Boundary Logging** - `[HydrationBoundary]` markers in
  `handleGetQuickTabsState()`

### v1.6.3.11-v7 Patterns

- **Orphan Quick Tabs Fix** - `originTabId` + `originContainerId` stored in
  `handleCreate()` in `QuickTabHandler.js`
- **Tab ID Resolution** - `_resolveOriginTabId()` with pattern extraction
  fallback
- **Tab ID Validation** - `_validateTabId()` for robust integer checks
- **Pattern Extraction** - `_extractTabIdFromPattern()` extracts from
  qt-{tabId}-{timestamp}
- **Code Health 8.0+** - All core files now at Code Health 8.0 or higher

### v1.6.3.10-v10 Base Architecture (Restored)

- **tabs.sendMessage** - Background → Content script / Manager messaging
- **storage.onChanged PRIMARY** - Primary sync mechanism for state updates
- **Single Storage Key** - `quick_tabs_state_v2` with unified format
- **Unified Barrier** - Single barrier initialization with resolve-only semantics
- **Tab ID Backoff** - Exponential backoff (200ms, 500ms, 1500ms, 5000ms)

### Previous Version Patterns (Consolidated)

- **v1.6.3.10:** Tab ID exponential backoff, handler deferral, adoption lock
  timeout
- **v5:** Operation sequence, port viability, state gating, error telemetry
- **v4:** Shadow DOM traversal, event debouncing, operation acknowledgment
- **v3:** LRU Map Guard, checkpoint system, identity gating, code health 9.0+

### Key Timing Constants (v1.6.3.11-v8)

| Constant                   | Value  | Purpose                        |
| -------------------------- | ------ | ------------------------------ |
| `MESSAGE_TIMEOUT_MS`       | 5000   | Message timeout                |
| `_MAX_EARLY_QUEUE_SIZE`    | 100    | Max queued messages before ready |
| `HYDRATION_TIMEOUT_MS`     | 3000   | Storage hydration timeout      |
| `TAB_ID_BACKOFF_DELAYS`    | Array  | 200, 500, 1500, 5000ms         |
| `STORAGE_TIMEOUT_MS`       | 2000   | Storage operation timeout      |
| `LRU_MAP_MAX_SIZE`         | 500    | Maximum map entries            |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                               |
| --------------------- | --------------------------------------------------------------------- |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                     |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                           |
| TabStateManager       | `getTabState()`, `setTabState()`                                      |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`              |
| QuickTabHandler       | `handleCreate()`, `_resolveOriginTabId()`, `_validateTabId()`             |
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

**v1.6.3.11-v9 (NEW):** `[IDENTITY_INIT]` `[WRITE_PHASE]` `[STATE_VALIDATION]`
`[CONTAINER_VALIDATION]` `TAB_CONTEXT_CHANGED`

**v1.6.3.11-v8:** `[HydrationBoundary]` `[CREATE_REJECTED]`
`[IDENTITY_NOT_READY]`

**v1.6.3.11-v7:** `[QuickTabHandler]` `[CREATE_ORPHAN_WARNING]`

**Previous:** `[EARLY_LISTENER_REGISTRATION]` `[MESSAGE_ROUTER_READY]`
`[COMMAND_RECEIVED]` `[COMMAND_EXECUTED]` `[STORAGE_PROPAGATE]`
`[ERROR_TELEMETRY]` `[MSG_COMMAND]` `[HOVER_EVENT]` `[SHADOW_DOM_SEARCH]`
`[INIT]` `[ADOPTION]` `[HEARTBEAT]` `[LRU_GUARD]` `[STORAGE_LATENCY]`
`[HYDRATION_BARRIER]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, Shadow DOM traversal, operation acknowledgment, state readiness
gating, error telemetry, originTabId resolution, tab ID pattern extraction,
transaction tracking, null originTabId rejection, identity system gating,
debounce context capture, container isolation, z-index recycling.

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

| File                                             | Features                                      |
| ------------------------------------------------ | --------------------------------------------- |
| `src/constants.js`                               | Centralized constants                         |
| `src/utils/shadow-dom.js`                        | Shadow DOM link detection                     |
| `src/utils/storage-utils.js`                     | Storage utilities (Code Health 7.78)          |
| `src/background/tab-events.js`                   | Tabs API listeners                            |
| `src/utils/structured-logger.js`                 | StructuredLogger class with contexts          |
| `src/storage/storage-manager.js`                 | Simplified persistence, checksum validation   |
| `src/messaging/message-router.js`                | ACTION-based routing                          |
| `src/background/message-handler.js`              | TYPE-based v2 routing                         |
| `background.js`                                  | Early message listener (Code Health 8.40)     |
| `sidebar/quick-tabs-manager.js`                  | scheduleRender() (Code Health 8.26)           |
| `src/content.js`                                 | Content script (Code Health 9.09)             |
| `src/background/handlers/QuickTabHandler.js`     | handleCreate(), originTabId fix               |
| `src/background/handlers/TabLifecycleHandler.js` | Tab lifecycle, orphan detection               |

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
