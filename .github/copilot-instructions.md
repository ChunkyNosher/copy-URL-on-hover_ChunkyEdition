# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v9  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port-based messaging** with persistent connections (PRIMARY)
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping
- **Lifecycle resilience** with keepalive & circuit breaker
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)

**v1.6.3.8-v9 Features (NEW) - Initialization & Event Fixes:**

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

**v1.6.3.8-v8 Features (Retained):** Self-write detection (50ms), transaction
timeout 1000ms, storage event ordering (300ms), port message queue, explicit
tab ID barrier, extended dedup 10s, BFCache session tabs.

**v1.6.3.8-v7 Features (Retained):** Per-port sequence ID tracking, circuit
breaker escalation, correlationId tracing, adaptive quota monitoring.

**v1.6.3.8-v6 Features (Retained):** Storage quota monitoring, MessageBatcher
queue limits (100), checksum validation, BroadcastChannelManager.js DELETED.

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager

**Deprecated:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`,
`updateQuickTabSize()`, `BroadcastChannelManager` (DELETED in v6)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Single Writer Authority (v1.6.3.7-v2+)

**Manager no longer writes to storage directly.** All state changes flow through
background:

- `ADOPT_TAB` - Manager sends adoption request to background
- `CLOSE_MINIMIZED_TABS` - Background handler
  `handleCloseMinimizedTabsCommand()`
- `REQUEST_FULL_STATE_SYNC` - Manager requests full state on port reconnection

### v1.6.3.8-v9: Initialization & Event Fixes (PRODUCTION)

**Two-layer architecture (NO BroadcastChannel):**

- **Layer 1:** runtime.Port for real-time metadata sync (position, minimized,
  active)
- **Layer 2:** storage.local with monotonic revision versioning +
  storage.onChanged fallback

**Key Changes (v9):**

- **DestroyHandler event order** - `statedeleted` emitted BEFORE Map deletion
- **UICoordinator init flag** - `_isInitializing` suppresses orphan recovery
- **DestroyHandler retry** - `_pendingPersists` queue with max 3 retries (500ms delay)
- **Handler readiness** - `startRendering()` from `UICoordinator.init()`
- **EventEmitter3 logging** - Timestamps for handler/listener order validation
- **Message conflict detection** - `_checkMessageConflict()` prevents duplicates
- **Init sequence** - `signalReady()` moved BEFORE hydration (Step 5.5)
- **Comprehensive logging** - INIT_START, INIT_STEP_*, INIT_COMPLETE, BARRIER_CHECK
- **Resource limits** - Timestamp map max 1000, message queue max 100
- **Tab ID timeout** - Increased to 5s with retry fallback

### v1.6.3.8-v8: Storage & Init Improvements (Retained)

- **initializationBarrier Promise** - All async tasks complete before listeners
- **`_hydrateStateFromBackground()`** - Port-based hydration before storage
- **`document.visibilitychange`** - State refresh when sidebar becomes visible
- **Proactive dedup cleanup** - 50% threshold with sliding window at 95%

### v1.6.3.8-v2/v3: Communication Layer (Retained)

- ACK-based messaging, SIDEBAR_READY handshake
- BFCache lifecycle, port snapshots (60s), WriteBuffer (75ms)
- Storage listener verification

### v1.6.3.8: Initialization & Diagnostics (Retained)

- **Initialization barriers** - QuickTabHandler (10s), currentTabId (2s backoff)
- **Centralized storage validation** - Type-specific recovery with re-write +
  verify
- **Code Health** - background.js (9.09), QuickTabHandler.js (9.41)

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

## 🆕 v1.6.3.8-v9 Patterns

- **DestroyHandler event order** - `statedeleted` emitted BEFORE Map deletion
- **UICoordinator `_isInitializing`** - Flag suppresses orphan recovery during init
- **DestroyHandler retry logic** - `_pendingPersists` queue, 3 retries, 500ms delay
- **Handler readiness** - `startRendering()` called from `UICoordinator.init()`
- **EventEmitter3 logging** - Timestamps for handler/listener registration order
- **Message conflict detection** - `_checkMessageConflict()` prevents duplicates
- **Init sequence fix** - `signalReady()` BEFORE hydration (Step 5.5)
- **INIT logging** - INIT_START, INIT_STEP_*, INIT_COMPLETE, BARRIER_CHECK
- **Timestamp map limit** - Max 1000 entries with automatic cleanup
- **Event listener cleanup** - `cleanupStateListeners()` method
- **Message queue limit** - Max 100 messages
- **Tab ID timeout 5s** - Increased from 2s with retry fallback

### New Methods/Patterns (v1.6.3.8-v9)

**UICoordinator:**
- `_isInitializing` flag - tracks initialization phase
- `cleanupStateListeners()` - removes registered event listeners
- `_firstEventReceived` Map - tracks when events first fire
- Callback error handling wraps all handler calls in try-catch

**QuickTabsManager (index.js):**
- `_checkMessageConflict()` - detects duplicate/stale messages
- `_checkStaleDestructiveMessage()` - checks if delete message is stale
- Step 5.5: Message replay BEFORE hydration
- Delayed hydration retry if currentTabId barrier fails

**DestroyHandler:**
- `_pendingPersists` queue for retry logic
- `_persistedDeletions` Set for tracking
- `_schedulePersistRetry()` and `_processRetryQueue()` methods
- Event emission order reversed (emit before delete)

### v1.6.3.8-v8 Patterns (Retained)

| Module              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `init-barrier.js`   | Initialization barrier logic, CONNECTION_STATE |
| `state-sync.js`     | Port/storage sync, SaveId dedup, sequence IDs  |
| `diagnostics.js`    | Logging utilities, correlation IDs             |
| `health-metrics.js` | Storage/fallback health, dedup map monitoring  |
| `index.js`          | Re-exports for convenient importing            |

### Test Helpers (v1.6.3.8-v8)

| Helper                                   | Purpose                             |
| ---------------------------------------- | ----------------------------------- |
| `tests/helpers/manager-factory.js`       | Manager instance creation for tests |
| `tests/helpers/port-simulator.js`        | Port connection simulation          |
| `tests/helpers/storage-test-helper.js`   | Storage operations mock             |
| `tests/helpers/cross-tab-simulator.js`   | Cross-tab sync simulation           |
| `tests/helpers/state-machine-utils.js`   | State machine test utilities        |
| `tests/helpers/coordinator-utils.js`     | Background coordinator helpers      |
| `tests/e2e/helpers/multi-tab-fixture.js` | Multi-tab E2E fixtures              |
| `tests/e2e/helpers/assertion-helpers.js` | E2E assertion utilities             |

## v1.6.3.8-v7 Patterns (Retained)

- Per-port sequence IDs, circuit breaker escalation, correlationId tracing
- Adaptive quota monitoring, storage aggregation, iframe port tracking
- Queue TTL (60s), max event age (5-min), content script unload

## v1.6.3.8-v6 Patterns (Retained)

- Port-based messaging PRIMARY, storage quota monitoring, MessageBatcher limits
- Port reconnection backoff, checksum validation, beforeunload cleanup

## v1.6.3.8-v5 Patterns (Retained)

- Monotonic revision versioning, port failure counting, storage quota recovery
- declarativeNetRequest fallback, URL validation

## v1.6.3.8-v4 Patterns (Retained)

- initializationBarrier Promise, port-based hydration, visibility change
  listener
- Proactive dedup cleanup (50%), sliding window eviction (95%), probe queuing

### Key Timing Constants (v1.6.3.8-v9)

| Constant                               | Value    | Purpose                                   |
| -------------------------------------- | -------- | ----------------------------------------- |
| `CURRENT_TAB_ID_WAIT_TIMEOUT_MS`       | 5000     | Tab ID barrier timeout (was 2000ms)       |
| `MAX_MESSAGE_QUEUE_SIZE`               | 100      | Message queue limit                       |
| `MAX_MAP_ENTRIES`                      | 1000     | Timestamp map size limit                  |
| `MAX_PERSIST_RETRY_ATTEMPTS`           | 3        | Persist retry limit                       |
| `PERSIST_RETRY_DELAY_MS`               | 500      | Delay between persist retries             |
| `TRANSACTION_FALLBACK_CLEANUP_MS`      | 1000     | Transaction timeout                       |
| `SELF_WRITE_TIMESTAMP_WINDOW_MS`       | 50       | Self-write detection window               |
| `STORAGE_EVENT_ORDER_TOLERANCE_MS`     | 300      | Firefox latency tolerance                 |
| `RESTORE_DEDUP_WINDOW_MS`              | 10000    | Dedup window                              |
| `PORT_CIRCUIT_STATES`                  | 4 states | HEALTHY, DEGRADED, CRITICAL, DISCONNECTED |
| `INIT_BARRIER_TIMEOUT_MS`              | 10000    | Initialization barrier timeout            |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                      |
| --------------------- | ------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                            |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                       |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                  |
| TabStateManager (v3)  | `getTabState()`, `setTabState()`                             |
| Manager               | `scheduleRender()`, `_transitionConnectionState()`           |
| UICoordinator         | `init()`, `cleanupStateListeners()`, `_isInitializing` flag  |
| DestroyHandler        | `_pendingPersists`, `_schedulePersistRetry()`, emit-before-delete |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, coordinated clear, closeAll mutex, **v1.6.3.8-v9:** event emission
before deletion, `_isInitializing` flag, persist retry queue, message conflict
detection, init sequence reorder, **v1.6.3.8-v8:** self-write detection,
transaction timeout 1000ms, port message queue, **v1.6.3.8-v7:** per-port
sequence IDs, circuit breaker escalation.

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

| File                       | Features                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| `quick-tabs-manager.js`    | Port-based sync, initializationBarrier, port hydration           |
| `sidebar/modules/index.js` | Re-exports init-barrier, state-sync, diagnostics, health-metrics |
| `background.js`            | Port registry, storage versioning, quota monitoring              |
| `QuickTabHandler.js`       | Handler timeout, init barrier, Code Health 9.41                  |
| `message-utils.js`         | ACK-based messaging, MessageBatcher with queue limits            |
| `storage-utils.js`         | WriteBuffer, sequence rejection, checksum validation             |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session, v3)  
**Format:** `{ tabs: [...], saveId, timestamp, writingTabId, revisionId, checksum }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`,
`BROADCAST`, `REQUEST_FULL_STATE_SYNC`, `ADOPT_TAB`, `CLOSE_MINIMIZED_TABS`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
