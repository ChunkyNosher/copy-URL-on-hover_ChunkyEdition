# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v11  
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
- **Readback Validation** - Every storage write validated by read-back
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)

**v1.6.3.8-v11 Features (NEW) - Quick Tabs Architecture v2:**

- **Quick Tabs Architecture v2** - tabs.sendMessage + storage.onChanged messaging
- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time (structural)
- **Readback Validation** - Every write validated by read-back (Issue #8 fix)
- **Deduplication** - correlationId with 50ms window
- **EventBus** - Native EventTarget for FIFO-guaranteed events (Issue #3 fix)
- **StorageManager** - Retry with exponential backoff (100ms, 200ms, 400ms)
- **Message Patterns** - LOCAL (no broadcast), GLOBAL (broadcast), MANAGER (broadcast)
- **Migration Logic** - Legacy storage format migration with grace period

**v1.6.3.8-v10 Features (Retained):**

- **Tab ID fetch retry** - Exponential backoff with extracted helper functions
- **Storage write retry** - `_handleStorageWriteRetryDelay` helper extracted
- **Stricter sequenceId ordering** - Only accept exact duplicates, reject gaps
- **Content script unload** - Multi-channel (port + runtime.sendMessage) signals
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
- **INIT logging** - INIT_START, INIT_STEP_*, INIT_COMPLETE, BARRIER_CHECK
- **Timestamp map limit** - Max 1000 entries with cleanup
- **Event listener cleanup** - `cleanupStateListeners()` method
- **Message queue limit** - Max 100 messages
- **Tab ID timeout** - Increased to 5s with retry fallback

**v1.6.3.8-v8 Features (Retained):** Self-write detection (300ms aligned),
transaction timeout 1000ms, storage event ordering (300ms), port message queue,
explicit tab ID barrier, extended dedup 10s, BFCache session tabs.

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager, MessageBuilder

**Deprecated:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`,
`updateQuickTabSize()`, `BroadcastChannelManager` (DELETED in v6), runtime.Port (v11)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.8-v11)

**tabs.sendMessage + storage.onChanged architecture:**

- `QT_STATE_SYNC` - Background broadcasts state updates to all tabs
- `MANAGER_CLOSE_ALL` / `MANAGER_CLOSE_MINIMIZED` - Manager pattern actions
- `REQUEST_FULL_STATE_SYNC` - Request full state from background

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes)
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close minimized)

### v1.6.3.8-v11: Architecture v2 (PRODUCTION)

**Two-layer architecture (NO Port, NO BroadcastChannel):**

- **Layer 1:** tabs.sendMessage for real-time broadcasts
- **Layer 2:** storage.local with readback validation + storage.onChanged fallback

**Key Changes (v11):**

- **StorageManager class** - Dedup, readback validation, retry with backoff
- **MessageBuilder** - Builds typed messages with correlationId
- **EventBus** - Native EventTarget for FIFO events (replaces EventEmitter3)
- **schema-v2.js** - Pure state utilities with immutable operations
- **content-message-listener.js** - Content script receives via tabs.sendMessage
- **manager-state-handler.js** - Manager handles Pattern C actions
- **broadcast-manager.js** - `broadcastToAllTabs()` utility

### v1.6.3.8-v10: Modern APIs Audit (Retained)

- Tab ID fetch retry, storage write retry, stricter sequenceId
- Content script unload signals, ESLint max-depth fixes

### v1.6.3.8-v8: Storage & Init (Retained)

- initializationBarrier Promise, port-based hydration, visibility change listener

### v1.6.3.8-v2/v3: Communication Layer (Retained)

- ACK-based messaging, SIDEBAR_READY handshake, BFCache lifecycle

### v1.6.3.8: Initialization & Diagnostics (Retained)

- Initialization barriers, centralized storage validation

---

## 🆕 v1.6.3.8-v11 Patterns

- **Single Storage Key** - `quick_tabs_state_v2.allQuickTabs[]`
- **Tab Isolation** - Filter by `originTabId` at hydration (structural)
- **Readback Validation** - Every write verified by reading back
- **Deduplication** - correlationId with 50ms window prevents dupes
- **EventBus** - Native EventTarget for FIFO-guaranteed events
- **Message Patterns** - LOCAL, GLOBAL, MANAGER with MessageBuilder
- **StorageManager** - Retry with exponential backoff (100ms, 200ms, 400ms)
- **Migration** - Legacy format migration with grace period cleanup

### New Modules (v1.6.3.8-v11)

| Module                            | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `src/storage/schema-v2.js`        | Pure state utilities, immutable operations  |
| `src/storage/storage-manager.js`  | Dedup, readback validation, retry           |
| `src/messaging/message-router.js` | MESSAGE_TYPES, MessageBuilder, MessageValidator |
| `src/background/quick-tabs-v2-integration.js` | V2 init, feature flags, cleanup |
| `src/background/broadcast-manager.js` | broadcastToAllTabs(), sendToTab()       |
| `src/background/message-handler.js` | Background message handling               |
| `src/features/quick-tabs/content-message-listener.js` | Content script listener |
| `sidebar/manager-state-handler.js` | Manager Pattern C actions                  |
| `src/utils/event-bus.js`          | EventBus with native EventTarget           |

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

**v9:** DestroyHandler event order, UICoordinator `_isInitializing`, message conflict detection  
**v8:** Self-write detection, transaction timeout, port message queue  
**v7:** Per-port sequence IDs, circuit breaker, correlationId tracing  
**v6:** Port-based messaging, storage quota, checksum validation  
**v5:** Monotonic revision versioning, declarativeNetRequest fallback

### Key Timing Constants (v1.6.3.8-v11)

| Constant                      | Value       | Purpose                              |
| ----------------------------- | ----------- | ------------------------------------ |
| `DEDUP_WINDOW_MS`             | 50          | correlationId deduplication window   |
| `STORAGE_RETRY_DELAYS`        | [100,200,400] | Exponential backoff for writes     |
| `CURRENT_TAB_ID_WAIT_TIMEOUT_MS` | 5000     | Tab ID barrier timeout               |
| `MAX_MESSAGE_QUEUE_SIZE`      | 100         | Message queue limit                  |
| `TRANSACTION_FALLBACK_CLEANUP_MS` | 1000    | Transaction timeout                  |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                      |
| --------------------- | ------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                            |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                       |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                  |
| TabStateManager (v3)  | `getTabState()`, `setTabState()`                             |
| StorageManager        | `readState()`, `writeStateWithValidation()`, `triggerStorageRecovery()` |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()` |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`  |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, **v1.6.3.8-v11:** tabs.sendMessage messaging, readback validation,
correlationId deduplication, FIFO EventBus, message patterns (LOCAL/GLOBAL/MANAGER).

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

| File                              | Features                                          |
| --------------------------------- | ------------------------------------------------- |
| `src/storage/schema-v2.js`        | Pure state utilities, originTabId filtering       |
| `src/storage/storage-manager.js`  | Dedup, readback validation, retry                 |
| `src/messaging/message-router.js` | MESSAGE_TYPES, MessageBuilder, MessageValidator   |
| `src/background/quick-tabs-v2-integration.js` | V2 initialization, feature flags    |
| `src/utils/event-bus.js`          | EventBus with native EventTarget                  |
| `background.js`                   | Message handler, storage versioning               |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, correlationId, timestamp }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER (manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
