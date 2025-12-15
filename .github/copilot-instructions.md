# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.9-v3  
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

**v1.6.3.9-v3 Features (NEW) - Issue #47 Fixes:**

- **Dual Architecture Docs** - MessageRouter (ACTION) vs message-handler (TYPE)
- **Adoption Flow** - `pendingAdoptionWriteQueue[]`, `replayPendingAdoptionWrites()`
- **Reduced Tab ID Timeout** - CURRENT_TAB_ID_WAIT_TIMEOUT_MS: 5000→2000ms
- **Increased Fallback Timeout** - FALLBACK_SYNC_TIMEOUT_MS: 2000→2500ms
- **Write Retry** - Exponential backoff [100,200,400]ms, MAX_WRITE_RETRIES=3
- **Diagnostic Logging** - STORAGE_LISTENER_*, STATE_SYNC_MECHANISM, ADOPTION_FLOW

**v1.6.3.9-v2 Features (Retained):**

- **Multi-Layer Self-Write Detection** - TransactionId → WritingInstanceId →
  WritingTabId → Timing fallback
- **Container Isolation** - `originContainerId` field, container-aware queries
- **Tabs API Integration** - `src/background/tab-events.js` with 3 listeners
- **Ownership History** - `previouslyOwnedTabIds` for empty write validation

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
MessageBuilder, StructuredLogger, TabEventsManager, MessageRouter

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

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.9-v3)

**Stateless messaging architecture (NO Port, NO BroadcastChannel):**

- `runtime.sendMessage()` - Content script → Background
- `tabs.sendMessage()` - Background → Content script / Manager
- `storage.onChanged` - Primary sync mechanism for state updates
- `QT_STATE_SYNC` - Background broadcasts state updates to all tabs
- `REQUEST_FULL_STATE_SYNC` - Request full state from background

**Dual Architecture (v1.6.3.9-v3):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **message-handler.js** - TYPE-based v2 routing (QT_CREATED, QT_MINIMIZED)

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes)
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close minimized)

### v1.6.3.9-v3: Adoption Flow & Diagnostic Logging (NEW)

**Adoption Flow (null originTabId handling):**

- `pendingAdoptionWriteQueue[]` - Queues writes when originTabId is null
- `replayPendingAdoptionWrites()` - Called when currentTabId available
- `PENDING_WRITE_MAX_AGE_MS` = 10000ms (queue item expiry)

**New Diagnostic Logs:**

- `STORAGE_LISTENER_REGISTERED/FIRED` - Listener lifecycle
- `STORAGE_FALLBACK_POLLING_START/COMPLETE` - Fallback polling
- `STATE_SYNC_MECHANISM` - Which sync mechanism was used
- `STORAGE_WRITE_QUEUED` - Write queued for adoption
- `ADOPTION_FLOW` - Replaying pending writes
- `STORAGE_WRITE_RETRY_*` - Write retry logs

### v1.6.3.9-v2: Self-Write Detection & Container Isolation (Retained)

**Multi-Layer Self-Write Detection:**

1. **Primary:** TransactionId match (`getLastWrittenTransactionId()`)
2. **Secondary:** WritingInstanceId match (`getWritingInstanceId()`)
3. **Tertiary:** WritingTabId match
4. **Fallback:** Timing-based detection (legacy)

**Container Isolation:**

- `originContainerId` field in Quick Tab data structure
- Container-aware queries: `getQuickTabsByOriginTabIdAndContainer()`
- Backward compatible: defaults to `'firefox-default'`

---

## 🆕 v1.6.3.9-v3 Patterns

- **Dual Architecture** - MessageRouter (ACTION) + message-handler (TYPE)
- **Adoption Flow** - Queue writes when originTabId null, replay on availability
- **Write Retry** - Exponential backoff [100,200,400]ms with MAX_WRITE_RETRIES=3
- **Graceful Degradation** - Barrier timeout as warning, not error
- **Diagnostic Logging** - Storage listener lifecycle, sync mechanism tracking

### v1.6.3.9-v2 Patterns (Retained)

- **Multi-Layer Self-Write Detection** - 4 layers: TransactionId → InstanceId →
  TabId → Timing
- **Container Isolation** - `originContainerId` with Firefox Container support
- **Ownership History** - `previouslyOwnedTabIds` for empty write validation

### Key Timing Constants (v1.6.3.9-v3)

| Constant                              | Value         | Purpose                                |
| ------------------------------------- | ------------- | -------------------------------------- |
| `CURRENT_TAB_ID_WAIT_TIMEOUT_MS`      | 2000          | Tab ID fetch timeout (was 5000)        |
| `FALLBACK_SYNC_TIMEOUT_MS`            | 2500          | Fallback sync timeout (was 2000)       |
| `PENDING_WRITE_MAX_AGE_MS`            | 10000         | Adoption queue item expiry             |
| `MAX_WRITE_RETRIES`                   | 3             | Storage write retry count              |
| `WRITE_RETRY_DELAYS`                  | [100,200,400] | Exponential backoff delays             |
| `FIREFOX_STORAGE_LISTENER_LATENCY_MAX_MS` | 250       | Firefox listener latency max           |
| `STORAGE_LATENCY_BUFFER_MS`           | 50            | Storage latency buffer                 |
| `STORAGE_ORDERING_TOLERANCE_MS`       | 300           | Storage write ordering tolerance       |
| `MESSAGE_DEDUP_WINDOW_MS`             | 50            | correlationId deduplication window     |
| `TAB_ID_FETCH_RETRY_DELAY_MS`         | 300           | Tab ID fetch retry delay               |
| `TAB_UPDATED_DEBOUNCE_MS`             | 500           | tabs.onUpdated debounce                |
| `DEFAULT_CONTAINER_ID`                | 'firefox-default' | Default container ID               |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                              |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                         |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                                    |
| TabStateManager (v3)  | `getTabState()`, `setTabState()`                                               |
| StorageManager        | `readState()`, `writeStateWithValidation()`, `replayPendingAdoptionWrites()`   |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`            |
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)                      |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`                    |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`                      |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                           |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`,
`getLastWrittenTransactionId()`, `queueStorageWrite()`,
`replayPendingAdoptionWrites()`, `pendingAdoptionWriteQueue`

**Schema v2 Exports:** `validateStateWithDiagnostics()`, `version: 2` field,
`getQuickTabsByOriginTabIdAndContainer()`, `getQuickTabsByContainerId()`

**Browser API Exports:** `getTabsByContainer()`, `validateTabExists()`,
`getTabContainerId()`, `areTabsInSameContainer()`, `getAllContainers()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, **v1.6.3.9-v3:** Dual architecture (MessageRouter + message-handler),
adoption flow, write retry with exponential backoff, diagnostic logging,
graceful degradation, **v1.6.3.9-v2:** Multi-layer self-write detection,
container isolation, tabs API events, ownership history.

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

| File                                          | Features                                           |
| --------------------------------------------- | -------------------------------------------------- |
| `src/constants.js`                            | Centralized timing constants (all values)          |
| `src/background/tab-events.js`                | Tabs API listeners (onActivated/Removed/Updated)   |
| `src/utils/structured-logger.js`              | StructuredLogger class with contexts               |
| `src/storage/schema-v2.js`                    | Container-aware queries, version field             |
| `src/storage/storage-manager.js`              | Dedup, readback, retry, adoption flow              |
| `src/storage/storage-utils.js`                | Self-write detection, queueStorageWrite()          |
| `src/utils/browser-api.js`                    | Container functions, validateTabExists()           |
| `src/messaging/message-router.js`             | ACTION-based routing (GET_CURRENT_TAB_ID, etc.)    |
| `src/background/message-handler.js`           | TYPE-based v2 routing (QT_CREATED, etc.)           |
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
