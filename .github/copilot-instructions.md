# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.9-v2  
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
- **Readback Validation** - Every storage write validated by read-back
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)
- **Tabs API Events** - onActivated, onRemoved, onUpdated listeners

**v1.6.3.9-v2 Features (NEW):**

- **Multi-Layer Self-Write Detection** - TransactionId → WritingInstanceId →
  WritingTabId → Timing fallback
- **Container Isolation** - `originContainerId` field, container-aware queries
- **Tabs API Integration** - `src/background/tab-events.js` with 3 listeners
- **Ownership History** - `previouslyOwnedTabIds` for empty write validation
- **Promise Chain Fix** - Clean error handling in `queueStorageWrite()`
- **Response Format** - `{ success: true, data: { tabId } }` standard

**v1.6.3.9 Features (Retained) - Gap Analysis Implementation:**

- **Feature Flag Wiring** - `bootstrapQuickTabs()` checks `isV2Enabled()`
- **Message Routing** - Handlers send MESSAGE_TYPES to background
- **CorrelationId Integration** - All messages use `generateCorrelationId()`
- **Ownership Validation** - `_validateOwnership()` checks `originTabId`
- **Storage Listener to UI** - `onStorageChanged()`, `syncState()` methods
- **Centralized Constants** - `src/constants.js` with timing values
- **Structured Logger** - `src/utils/structured-logger.js`

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager,
MessageBuilder, StructuredLogger, TabEventsManager

**Deprecated/Removed:** `setPosition()`, `setSize()`,
`updateQuickTabPosition()`, `updateQuickTabSize()`, `BroadcastChannelManager`
(DELETED in v6), runtime.Port (DELETED in v12)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.9-v2)

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

### v1.6.3.9-v2: Self-Write Detection & Container Isolation (PRODUCTION)

**Multi-Layer Self-Write Detection:**

1. **Primary:** TransactionId match (`getLastWrittenTransactionId()`)
2. **Secondary:** WritingInstanceId match (`getWritingInstanceId()`)
3. **Tertiary:** WritingTabId match
4. **Fallback:** Timing-based detection (legacy)

**Container Isolation:**

- `originContainerId` field in Quick Tab data structure
- Container-aware queries: `getQuickTabsByOriginTabIdAndContainer()`
- Backward compatible: defaults to `'firefox-default'`

**Tabs API Integration:**

- `browser.tabs.onActivated` - Immediate state refresh on tab switch
- `browser.tabs.onRemoved` - Automatic Quick Tab cleanup on tab close
- `browser.tabs.onUpdated` - Metadata sync with 500ms debounce

### v1.6.3.9: Gap Analysis Implementation (Retained)

**New patterns implemented:**

- **Feature Flag Bootstrap** - `bootstrapQuickTabs()` checks `isV2Enabled()`
- **Handler Message Routing** - `_sendPositionChangedMessage()`,
  `_sendMinimizeMessage()`
- **Ownership Validation** - `_validateOwnership()` in UpdateHandler,
  DestroyHandler
- **UI Sync Methods** - `onStorageChanged()`, `syncState()` in UICoordinator
- **Fallback Tracking** - `_pendingFallbackOperations` Map with 2s timeout

### v1.6.3.8-v12: Architecture v2 (Retained)

**Stateless architecture (NO Port, NO BroadcastChannel):**

- **Layer 1:** `runtime.sendMessage()` / `tabs.sendMessage()` for real-time
- **Layer 2:** `storage.onChanged` with readback validation

---

## 🆕 v1.6.3.9-v2 Patterns

- **Multi-Layer Self-Write Detection** - 4 layers: TransactionId → InstanceId →
  TabId → Timing
- **Container Isolation** - `originContainerId` with Firefox Container support
- **Ownership History** - `previouslyOwnedTabIds` for empty write validation
- **Promise Chain Fix** - `queueStorageWrite()` returns `false` on error
- **Response Format** - `{ success: true, data: { tabId } }` for GET_CURRENT_TAB_ID

### v1.6.3.9 Patterns (Retained)

- **Feature Flag Bootstrap** - `bootstrapQuickTabs()` gates initialization
- **Handler Message Routing** - Handlers send MESSAGE_TYPES to background
- **CorrelationId Generation** - `${tabId}-${timestamp}-${random}` format
- **Ownership Validation** - `_validateOwnership()` checks originTabId
- **Schema Version** - `version: 2` field, `validateStateWithDiagnostics()`

### New Modules (v1.6.3.9-v2)

| Module                            | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `src/background/tab-events.js`    | Tabs API listeners (onActivated/Removed/Updated) |
| `src/storage/schema-v2.js`        | Container-aware queries, version field       |
| `src/utils/browser-api.js`        | Container functions (getTabsByContainer)     |

### Modules (v1.6.3.9 Retained)

| Module                                        | Purpose                                         |
| --------------------------------------------- | ----------------------------------------------- |
| `src/constants.js`                            | Centralized timing constants                    |
| `src/utils/structured-logger.js`              | StructuredLogger class                          |
| `src/storage/storage-manager.js`              | Dedup, readback validation, retry               |
| `src/messaging/message-router.js`             | MESSAGE_TYPES, MessageBuilder                   |
| `src/background/quick-tabs-v2-integration.js` | V2 init, feature flags                          |
| `sidebar/manager-state-handler.js`            | Manager Pattern C actions                       |
| `src/utils/event-bus.js`                      | EventBus with native EventTarget                |

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
**v8:** Self-write detection, transaction timeout _(port message queue removed)_

### Key Timing Constants (v1.6.3.9-v2)

| Constant                              | Value         | Purpose                                |
| ------------------------------------- | ------------- | -------------------------------------- |
| `FIREFOX_STORAGE_LISTENER_LATENCY_MAX_MS` | 250       | Firefox listener latency max           |
| `STORAGE_LATENCY_BUFFER_MS`           | 50            | Storage latency buffer                 |
| `STORAGE_ORDERING_TOLERANCE_MS`       | 300           | Storage write ordering tolerance       |
| `MESSAGE_DEDUP_WINDOW_MS`             | 50            | correlationId deduplication window     |
| `OUT_OF_ORDER_TOLERANCE_MS`           | 100           | Cross-tab event ordering tolerance     |
| `TAB_ID_FETCH_TIMEOUT_MS`             | 2000          | Tab ID fetch timeout                   |
| `TAB_ID_FETCH_RETRY_DELAY_MS`         | 300           | Tab ID fetch retry delay               |
| `FALLBACK_SYNC_TIMEOUT_MS`            | 2000          | Fallback sync timeout with warning     |
| `FALLBACK_RETRY_DELAY_MS`             | 500           | Fallback retry delay                   |
| `TAB_UPDATED_DEBOUNCE_MS`             | 500           | tabs.onUpdated debounce                |
| `DEFAULT_CONTAINER_ID`                | 'firefox-default' | Default container ID               |
| `STORAGE_RETRY_DELAYS`                | [100,200,400] | Exponential backoff for writes         |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                              |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                         |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                                    |
| TabStateManager (v3)  | `getTabState()`, `setTabState()`                                               |
| StorageManager        | `readState()`, `writeStateWithValidation()`, `getLastWrittenTransactionId()`   |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`            |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`                    |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`                      |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                           |
| TabEventsManager      | `onActivated()`, `onRemoved()`, `onUpdated()` (listeners in tab-events.js)     |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`,
`getLastWrittenTransactionId()`, `queueStorageWrite()`

**Schema v2 Exports:** `validateStateWithDiagnostics()`, `version: 2` field,
`getQuickTabsByOriginTabIdAndContainer()`, `getQuickTabsByContainerId()`,
`removeQuickTabsByContainerId()`

**Browser API Exports:** `getTabsByContainer()`, `validateTabExists()`,
`getTabContainerId()`, `areTabsInSameContainer()`, `getAllContainers()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, **v1.6.3.9-v2:** Multi-layer self-write detection, container
isolation, tabs API events, ownership history, promise chain error handling,
**v1.6.3.9:** Feature flag bootstrap, handler message routing, correlationId
generation, ownership validation, UI sync methods, centralized constants.

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

| File                                          | Features                                           |
| --------------------------------------------- | -------------------------------------------------- |
| `src/constants.js`                            | Centralized timing constants (all values)          |
| `src/background/tab-events.js`                | Tabs API listeners (onActivated/Removed/Updated)   |
| `src/utils/structured-logger.js`              | StructuredLogger class with contexts               |
| `src/storage/schema-v2.js`                    | Container-aware queries, version field             |
| `src/storage/storage-manager.js`              | Dedup, readback validation, retry                  |
| `src/storage/storage-utils.js`                | Self-write detection, queueStorageWrite()          |
| `src/utils/browser-api.js`                    | Container functions, validateTabExists()           |
| `src/messaging/message-router.js`             | MESSAGE_TYPES, MessageBuilder, MessageValidator    |
| `src/background/quick-tabs-v2-integration.js` | V2 initialization, feature flags                   |
| `background.js`                               | Message handler, storage versioning                |

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
