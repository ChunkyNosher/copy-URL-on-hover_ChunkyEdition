# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v12  
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

**v1.6.3.8-v12 Features (NEW) - Architecture Migration:**

- **REMOVED all port-based messaging** (~2,364 lines removed)
- **Stateless messaging** - `runtime.sendMessage()` content→background,
  `tabs.sendMessage()` background→content
- **storage.onChanged** as primary sync mechanism (no port registry)
- **Simplified BFCache** - No port reconnection needed

**v1.6.3.8-v12 Critical Fixes:**

- **FIX Issue #15** - Promise chaining fixed: catch blocks properly reject
- **FIX Issue #16** - Circuit breaker removed (stateless architecture)
- **FIX Issue #17** - Init timeout reduced from 10s to 2s (non-blocking)
- **FIX Issue #18** - RESTORE_DEDUP_WINDOW_MS decoupled (50ms)
- **FIX Issue #19** - Self-write detection aligned (300ms)

**v1.6.3.8-v12 Behavioral Fixes:**

- **FIX Issue #1** - Orphan message cleanup
- **FIX Issue #5** - Per-message logging with type, correlationId, ageMs
- **FIX Issue #6** - `_buildMessageResponse()` standardized responses
- **FIX Issue #7** - 100ms `OUT_OF_ORDER_TOLERANCE_MS` for cross-tab events
- **FIX Issue #9** - 100ms debounced render queue with checksum validation
- **FIX Issue #10** - `_storageListenerIsActive` flag with fallback retry

**v1.6.3.8-v11 Features (Retained):**

- **Quick Tabs Architecture v2** - tabs.sendMessage + storage.onChanged
  messaging
- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time (structural)
- **Readback Validation** - Every write validated by read-back (Issue #8 fix)
- **Deduplication** - correlationId with 50ms window
- **EventBus** - Native EventTarget for FIFO-guaranteed events (Issue #3 fix)
- **StorageManager** - Retry with exponential backoff (100ms, 200ms, 400ms)
- **Message Patterns** - LOCAL (no broadcast), GLOBAL (broadcast), MANAGER
  (broadcast)
- **Migration Logic** - Legacy storage format migration with grace period

**v1.6.3.8-v10 Features (Retained):**

- **Tab ID fetch retry** - Exponential backoff with extracted helper functions
- **Storage write retry** - `_handleStorageWriteRetryDelay` helper extracted
- **Stricter sequenceId ordering** - Only accept exact duplicates, reject gaps
- **Content script unload** - runtime.sendMessage signals (port removed in v12)
- **ESLint max-depth fixes** - Extracted helpers reduce nesting depth
- **LISTENERS_READY event** - UICoordinator emits when listeners registered

**v1.6.3.8-v9 Features (Retained):**

- **DestroyHandler event order** - `statedeleted` emitted BEFORE Map deletion
- **UICoordinator `_isInitializing`** - Suppresses orphan recovery during init
- **DestroyHandler retry logic** - `_pendingPersists` queue, max 3 retries
- **Handler readiness** - `startRendering()` called from `UICoordinator.init()`
- **EventEmitter3 logging** - Timestamps for handler/listener registration order
- **Message queue conflict** - `_checkMessageConflict()` deduplication
- **Init sequence fix** - `signalReady()` before hydration (Step 5.5)
- **INIT logging** - INIT*START, INIT_STEP*\*, INIT_COMPLETE, BARRIER_CHECK
- **Timestamp map limit** - Max 1000 entries with cleanup
- **Event listener cleanup** - `cleanupStateListeners()` method
- **Message queue limit** - Max 100 messages
- **Tab ID timeout** - Reduced to 2s with retry fallback (was 5s in v10, 10s
  temporarily)

**v1.6.3.8-v8 Features (Retained):** Self-write detection (300ms aligned),
transaction timeout 1000ms, storage event ordering (300ms), explicit tab ID
barrier, extended dedup 10s, BFCache session tabs. *(Port message queue removed
in v12)*

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager,
MessageBuilder

**Deprecated/Removed:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`,
`updateQuickTabSize()`, `BroadcastChannelManager` (DELETED in v6), runtime.Port
(DELETED in v12 - ~2,364 lines removed)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.8-v12)

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

### v1.6.3.8-v12: Architecture v2 (PRODUCTION)

**Fully stateless architecture (NO Port, NO BroadcastChannel):**

- **Layer 1:** `runtime.sendMessage()` / `tabs.sendMessage()` for real-time
- **Layer 2:** `storage.onChanged` as primary sync with readback validation

**Key Changes (v12 - Port Removal):**

- **~2,364 lines removed** - Port code from content.js, manager.js, background.js
- **No port registry** - No port reconnection, no message queues
- **Simplified BFCache** - storage.onChanged handles page restoration
- **StorageManager** - Dedup, readback validation, retry with backoff
- **MessageBuilder** - Builds typed messages with correlationId

### v1.6.3.8-v10: Modern APIs Audit (Retained)

- Tab ID fetch retry, storage write retry, stricter sequenceId
- Content script unload signals, ESLint max-depth fixes

### v1.6.3.8-v8: Storage & Init (Retained)

- initializationBarrier Promise, visibility change listener *(port-based
  hydration removed in v12)*

### v1.6.3.8-v2/v3: Communication Layer (Retained)

- ACK-based messaging, SIDEBAR_READY handshake, BFCache lifecycle

### v1.6.3.8: Initialization & Diagnostics (Retained)

- Initialization barriers, centralized storage validation

---

## 🆕 v1.6.3.8-v12 Patterns

- **Stateless Messaging** - No ports, no reconnection logic
- **runtime.sendMessage()** - Content → Background communication
- **tabs.sendMessage()** - Background → Content/Manager broadcasts
- **storage.onChanged** - Primary sync mechanism for state updates
- **Single Storage Key** - `quick_tabs_state_v2.allQuickTabs[]`
- **Tab Isolation** - Filter by `originTabId` at hydration (structural)
- **Readback Validation** - Every write verified by reading back
- **Deduplication** - correlationId with 50ms window prevents dupes
- **EventBus** - Native EventTarget for FIFO-guaranteed events
- **StorageManager** - Retry with exponential backoff (100ms, 200ms, 400ms)

### New Modules (v1.6.3.8-v12)

| Module                                          | Purpose                                         |
| ----------------------------------------------- | ----------------------------------------------- |
| `src/storage/schema-v2.js`                      | Pure state utilities, immutable operations      |
| `src/storage/storage-manager.js`                | Dedup, readback validation, retry               |
| `src/messaging/message-router.js`               | MESSAGE_TYPES, MessageBuilder, MessageValidator |
| `src/background/quick-tabs-v2-integration.js`   | V2 init, feature flags, cleanup                 |
| `src/background/broadcast-manager.js`           | broadcastToAllTabs(), sendToTab()               |
| `src/background/message-handler.js`             | Background runtime.onMessage handling           |
| `src/features/quick-tabs/content-message-listener.js` | Content script tabs.sendMessage listener  |
| `sidebar/manager-state-handler.js`              | Manager Pattern C actions                       |
| `src/utils/event-bus.js`                        | EventBus with native EventTarget                |

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

## Previous Patterns (v10 and earlier)

**v9:** DestroyHandler event order, UICoordinator `_isInitializing`, message
conflict detection  
**v8:** Self-write detection, transaction timeout *(port message queue removed)*  
**v7:** Per-port sequence IDs *(removed)*, circuit breaker *(removed)*,
correlationId tracing  
**v6:** Port-based messaging *(removed in v12)*, storage quota, checksum
validation  
**v5:** Monotonic revision versioning, declarativeNetRequest fallback

### Key Timing Constants (v1.6.3.8-v12)

| Constant                          | Value         | Purpose                            |
| --------------------------------- | ------------- | ---------------------------------- |
| `DEDUP_WINDOW_MS`                 | 50            | correlationId deduplication window |
| `RESTORE_DEDUP_WINDOW_MS`         | 50            | Restore message deduplication      |
| `STORAGE_RETRY_DELAYS`            | [100,200,400] | Exponential backoff for writes     |
| `TAB_ID_FETCH_TIMEOUT_MS`         | 2000          | Tab ID fetch timeout (reduced)     |
| `TAB_ID_FETCH_MAX_RETRIES`        | 2             | Max retry attempts                 |
| `TAB_ID_FETCH_RETRY_DELAY_MS`     | 300           | Delay between retries              |
| `SELF_WRITE_DETECTION_WINDOW_MS`  | 300           | Self-write cleanup window          |
| `OUT_OF_ORDER_TOLERANCE_MS`       | 100           | Cross-tab event ordering tolerance |
| `RENDER_QUEUE_DEBOUNCE_MS`        | 100           | Manager render debounce            |
| `MAX_MESSAGE_QUEUE_SIZE`          | 100           | Message queue limit                |
| `TRANSACTION_FALLBACK_CLEANUP_MS` | 1000          | Transaction timeout                |

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

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, **v1.6.3.8-v12:** Stateless messaging (runtime.sendMessage /
tabs.sendMessage), storage.onChanged sync, readback validation, correlationId
deduplication, FIFO EventBus.

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
| `src/storage/schema-v2.js`                    | Pure state utilities, originTabId filtering     |
| `src/storage/storage-manager.js`              | Dedup, readback validation, retry               |
| `src/messaging/message-router.js`             | MESSAGE_TYPES, MessageBuilder, MessageValidator |
| `src/background/quick-tabs-v2-integration.js` | V2 initialization, feature flags                |
| `src/utils/event-bus.js`                      | EventBus with native EventTarget                |
| `background.js`                               | Message handler, storage versioning             |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, correlationId, timestamp }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
