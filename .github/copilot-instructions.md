# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.10-v9  
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

**v1.6.3.10-v9 Features (NEW) - Storage & Cross-Tab Fixes:**

- **Identity-Ready Gating** - `waitForIdentityInit()`, `IDENTITY_STATE_MODE` enum
- **Storage Error Classification** - `STORAGE_ERROR_TYPE` enum, `classifyStorageError()`
- **Storage Quota Monitoring** - `checkStorageQuota()` with preflight checks
- **Write Queue Recovery** - `_checkAndRecoverStalledQueue()`, queue state logging
- **StateManager Cleanup** - Subscription tracking, `dispose()`, leak warnings
- **Normalization Hardening** - `NORMALIZATION_REJECTION_REASON` enum, strict validation
- **Container Match Fail-Closed** - INITIALIZING mode in `_isContainerMatch()`
- **Write Rate-Limiting** - `_checkWriteCoalescing()`, `WRITE_COALESCE_MIN_INTERVAL_MS`
- **Duplicate Window Alignment** - `DUPLICATE_SAVEID_WINDOW_MS` increased to 5000ms
- **Storage Event Ordering** - `validateStorageEventOrdering()`, sequence numbering
- **Adoption Lock Mechanism** - MinimizedManager adoption locks
- **Z-Index Recycling** - `_recycleZIndices()` at threshold 100000
- **Memory Leak Fix** - Comprehensive `destroy()` method in QuickTabWindow

**v1.6.3.10-v8 Features (Previous) - Code Health & Bug Fixes:**

- Code Health 9.0+ scores (content.js 9.09, window.js 9.38)
- Options object pattern, consolidated duplications
- Storage/Cross-Tab/Manager issues fixed (#1-23)

**v1.6.3.10-v7 & Earlier (Consolidated):** Port circuit breaker, adaptive dedup,
storage write serialization, type-safe tab IDs, container isolation, atomic ops

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

### v1.6.3.10-v9 Patterns (Current)

- Identity-ready gating with `IDENTITY_STATE_MODE` enum (INITIALIZING, READY)
- Storage error classification with `STORAGE_ERROR_TYPE` enum
- Storage quota monitoring with `checkStorageQuota()` preflight checks
- Write queue stall recovery with `_checkAndRecoverStalledQueue()`
- Normalization hardening with `NORMALIZATION_REJECTION_REASON` enum
- Write rate-limiting with `WRITE_COALESCE_MIN_INTERVAL_MS` (100ms)
- Duplicate detection window aligned to 5000ms
- Z-index recycling at threshold 100000
- Comprehensive `destroy()` for memory leak prevention

### v1.6.3.10-v8 Patterns (Previous)

- Code health refactoring with extracted helper functions
- Options object pattern for functions with 5+ arguments
- Consolidated duplicate logging and handler functions

### v1.6.3.10-v7 & Earlier Patterns (Consolidated)

- Port reconnection circuit breaker, adaptive dedup window
- Type-safe tab ID handling with `normalizeOriginTabId(value)`
- Atomic operations, container isolation, adoption re-render

### Key Timing Constants (v1.6.3.10-v9)

| Constant                         | Value                 | Purpose                            |
| -------------------------------- | --------------------- | ---------------------------------- |
| `STORAGE_KEY`                    | 'quick_tabs_state_v2' | Storage key name                   |
| `INIT_BARRIER_TIMEOUT_MS`        | 10000                 | Unified barrier init timeout       |
| `RENDER_DEBOUNCE_MS`             | 100                   | Render queue debounce              |
| `MESSAGE_TIMEOUT_MS`             | 3000                  | runtime.sendMessage timeout        |
| `WRITE_COALESCE_MIN_INTERVAL_MS` | 100                   | Write rate-limiting interval       |
| `DUPLICATE_SAVEID_WINDOW_MS`     | 5000                  | Duplicate detection window         |
| `PERSIST_STORAGE_TIMEOUT_MS`     | 5000                  | Storage persist timeout            |
| `Z_INDEX_RECYCLE_THRESHOLD`      | 100000                | Z-index recycling threshold        |
| `PENDING_SNAPSHOT_EXPIRATION_MS` | 5000                  | Snapshot watchdog timeout          |
| `OPERATION_LOCK_MS`              | 2000                  | Mediator operation lock            |
| `MAX_QUICK_TABS`                 | 100                   | Maximum Quick Tabs allowed         |

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

**v1.6.3.10-v9 New Exports:** `waitForIdentityInit()`, `waitForContainerIdInit()`,
`checkStorageQuota()`, `classifyStorageError()`, `validateStorageEventOrdering()`,
`IDENTITY_STATE_MODE`, `STORAGE_ERROR_TYPE`, `NORMALIZATION_REJECTION_REASON`,
`OWNERSHIP_FILTER_REASON`, `TAB_ID_CALLER_CONTEXT`

**v1.6.3.10-v8 & Earlier Exports:** `normalizeOriginTabId()`, `waitForTabIdInit()`,
`normalizeOriginContainerId()`, `_enqueueStorageWrite()`, `_performStorageWrite()`

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
