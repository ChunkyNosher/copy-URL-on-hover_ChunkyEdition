# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.9  
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
- **Readback Validation** - Every storage write validated by read-back
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)

**v1.6.3.9 Features (NEW) - Gap Analysis Implementation:**

- **Feature Flag Wiring** - `bootstrapQuickTabs()` checks `isV2Enabled()`
- **Message Routing** - Handlers send MESSAGE_TYPES to background
- **CorrelationId Integration** - All messages use shared `generateCorrelationId()`
- **Broadcast After Operations** - Enhanced `broadcastStateToAllTabs()` logging
- **Ownership Validation** - `_validateOwnership()` checks `originTabId`
- **Storage Listener to UI** - `onStorageChanged()`, `syncState()` methods
- **Centralized Constants** - `src/constants.js` with timing values
- **Fallback Sync Logging** - `_pendingFallbackOperations` with 2s timeout
- **Schema Version Field** - `version: 2` in schema-v2.js
- **Structured Logger** - `src/utils/structured-logger.js` with StructuredLogger

**v1.6.3.8-v12 Features (Retained) - Architecture Migration:**

- **REMOVED all port-based messaging** (~2,364 lines removed)
- **Stateless messaging** - `runtime.sendMessage()` content→background,
  `tabs.sendMessage()` background→content
- **storage.onChanged** as primary sync mechanism (no port registry)

**v1.6.3.8-v11 Features (Retained):**

- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time (structural)
- **Readback Validation** - Every write validated by read-back
- **Deduplication** - correlationId with 50ms window
- **EventBus** - Native EventTarget for FIFO-guaranteed events
- **StorageManager** - Retry with exponential backoff (100ms, 200ms, 400ms)
- **Message Patterns** - LOCAL (no broadcast), GLOBAL (broadcast), MANAGER

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager,
MessageBuilder, StructuredLogger

**Deprecated/Removed:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`,
`updateQuickTabSize()`, `BroadcastChannelManager` (DELETED in v6), runtime.Port
(DELETED in v12)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.9)

**Stateless messaging architecture (NO Port, NO BroadcastChannel):**

- `runtime.sendMessage()` - Content script → Background
- `tabs.sendMessage()` - Background → Content script / Manager
- `storage.onChanged` - Primary sync mechanism for state updates
- `QT_STATE_SYNC` - Background broadcasts state updates to all tabs
- `REQUEST_FULL_STATE_SYNC` - Request full state from background

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes)
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close minimized)

### v1.6.3.9: Gap Analysis Implementation (PRODUCTION)

**New patterns implemented:**

- **Feature Flag Bootstrap** - `bootstrapQuickTabs()` checks `isV2Enabled()`
- **Handler Message Routing** - `_sendPositionChangedMessage()`, `_sendMinimizeMessage()`
- **Ownership Validation** - `_validateOwnership()` in UpdateHandler, DestroyHandler
- **UI Sync Methods** - `onStorageChanged()`, `syncState()` in UICoordinator
- **Fallback Tracking** - `_pendingFallbackOperations` Map with 2s timeout

### v1.6.3.8-v12: Architecture v2 (Retained)

**Fully stateless architecture (NO Port, NO BroadcastChannel):**

- **Layer 1:** `runtime.sendMessage()` / `tabs.sendMessage()` for real-time
- **Layer 2:** `storage.onChanged` as primary sync with readback validation

**Key Changes (v12 - Port Removal):**

- **~2,364 lines removed** - Port code from content.js, manager.js, background.js
- **No port registry** - No port reconnection, no message queues
- **Simplified BFCache** - storage.onChanged handles page restoration
- **StorageManager** - Dedup, readback validation, retry with backoff
- **MessageBuilder** - Builds typed messages with correlationId

---

## 🆕 v1.6.3.9 Patterns

- **Feature Flag Bootstrap** - `bootstrapQuickTabs()` gates initialization
- **Handler Message Routing** - Handlers send MESSAGE_TYPES to background
- **CorrelationId Generation** - `generateCorrelationId()` format: `${tabId}-${timestamp}-${random}`
- **Ownership Validation** - `_validateOwnership()` checks `originTabId === currentTabId`
- **UI Sync Methods** - `onStorageChanged()`, `syncState()` for cross-tab updates
- **Centralized Constants** - `src/constants.js` exports timing values
- **Fallback Tracking** - `_pendingFallbackOperations` with `FALLBACK_SYNC_CONFIRMED` logs
- **Schema Version** - `version: 2` field, `validateStateWithDiagnostics()` function
- **Structured Logger** - Pre-configured logger instances for different contexts

### New Modules (v1.6.3.9)

| Module                            | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `src/constants.js`                | Centralized timing constants (GAP-7)            |
| `src/utils/structured-logger.js`  | StructuredLogger class with contexts            |
| `src/storage/schema-v2.js`        | Pure state utilities, version field (GAP-19)    |
| `src/storage/storage-manager.js`  | Dedup, readback validation, retry               |
| `src/messaging/message-router.js` | MESSAGE_TYPES, MessageBuilder, MessageValidator |
| `src/background/quick-tabs-v2-integration.js` | V2 init, feature flags (GAP-1)        |
| `src/background/broadcast-manager.js`         | broadcastToAllTabs(), sendToTab()     |
| `sidebar/manager-state-handler.js`            | Manager Pattern C actions             |
| `src/utils/event-bus.js`                      | EventBus with native EventTarget      |

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

## Previous Patterns (v12 and earlier)

**v12:** Port removal (~2,364 lines), stateless messaging, simplified BFCache  
**v11:** tabs.sendMessage messaging, single storage key, tab isolation  
**v10:** Tab ID fetch retry, storage write retry, stricter sequenceId  
**v9:** DestroyHandler event order, UICoordinator `_isInitializing`  
**v8:** Self-write detection, transaction timeout *(port message queue removed)*

### Key Timing Constants (v1.6.3.9)

| Constant                     | Value         | Purpose                            |
| ---------------------------- | ------------- | ---------------------------------- |
| `STORAGE_DEDUP_WINDOW_MS`    | 300           | Firefox listener latency tolerance |
| `MESSAGE_DEDUP_WINDOW_MS`    | 50            | correlationId deduplication window |
| `RESTORE_DEDUP_WINDOW_MS`    | 50            | Restore message deduplication      |
| `HANDLER_DEDUP_WINDOW_MS`    | 100           | Handler-level deduplication        |
| `STORAGE_RETRY_DELAYS`       | [100,200,400] | Exponential backoff for writes     |
| `TAB_ID_FETCH_TIMEOUT_MS`    | 2000          | Tab ID fetch timeout               |
| `FALLBACK_SYNC_TIMEOUT_MS`   | 2000          | Fallback sync timeout with warning |
| `OUT_OF_ORDER_TOLERANCE_MS`  | 100           | Cross-tab event ordering tolerance |
| `RENDER_QUEUE_DEBOUNCE_MS`   | 100           | Manager render debounce            |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                       |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                  |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                             |
| TabStateManager (v3)  | `getTabState()`, `setTabState()`                                        |
| StorageManager        | `readState()`, `writeStateWithValidation()`, `triggerStorageRecovery()` |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`     |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`             |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`               |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                    |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

**Schema v2 Exports:** `validateStateWithDiagnostics()`, `version: 2` field

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, **v1.6.3.9:** Feature flag bootstrap, handler message routing,
correlationId generation, ownership validation, UI sync methods, centralized
constants, fallback tracking, schema versioning, structured logging.

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

| File                                          | Features                                        |
| --------------------------------------------- | ----------------------------------------------- |
| `src/constants.js`                            | Centralized timing constants (GAP-7)            |
| `src/utils/structured-logger.js`              | StructuredLogger class with contexts            |
| `src/storage/schema-v2.js`                    | Pure state utilities, version field             |
| `src/storage/storage-manager.js`              | Dedup, readback validation, retry               |
| `src/messaging/message-router.js`             | MESSAGE_TYPES, MessageBuilder, MessageValidator |
| `src/background/quick-tabs-v2-integration.js` | V2 initialization, feature flags                |
| `src/utils/event-bus.js`                      | EventBus with native EventTarget                |
| `background.js`                               | Message handler, storage versioning             |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, correlationId, timestamp, version: 2 }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
