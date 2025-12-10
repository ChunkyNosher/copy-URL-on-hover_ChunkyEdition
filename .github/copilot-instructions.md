# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7-v9  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port-based messaging** with persistent connections
- **Cross-tab sync via storage.onChanged + BroadcastChannel +
  Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping
- **Lifecycle resilience** with keepalive & circuit breaker
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)

**v1.6.3.7-v9 Features (NEW):**

- **Unified Keepalive** - Single 20s interval with correlation IDs (consolidated from 25s heartbeat + 20s keepalive)
- **Unified Logging** - MESSAGE_RECEIVED format with `[PORT]`, `[BC]`, `[RUNTIME]` prefixes
- **Unified Deduplication** - saveId-based dedup, removed dead IN_PROGRESS_TRANSACTIONS code
- **Port Age Management** - Port metadata with 90s max age, 30s stale timeout
- **Storage Race Cooldown** - Single authoritative dedup, cooldown increased to 200ms
- **Storage Ordering** - sequenceId with event ordering validation
- **BC Sequence Tracking** - sequenceNumber with gap detection for BroadcastChannel
- **Storage Integrity** - Write validation with sync backup and corruption recovery
- **Port Message Ordering** - messageSequence counter with reorder buffer
- **Tab Affinity Cleanup** - 24h TTL with browser.tabs.onRemoved listener
- **Initialization Barrier** - `initializationStarted`/`initializationComplete` flags

**v1.6.3.7-v8 Features (Retained):** Port message queue, atomic reconnection guard,
VisibilityHandler broadcasts, dynamic debounce, heartbeat hysteresis, Firefox
termination detection, EventBus bridge, hybrid storage cache, memory monitoring,
performance metrics, virtual scrolling, message batching, object pooling.

**v1.6.3.7-v7 Features (Retained):** BroadcastChannel from background, full state sync,
operation confirmations, DEBUG_MESSAGING flags, storage write confirmations.

**v1.6.3.7-v3 to v6 Features (Retained):** Connection state tracking (v5), zombie
detection (v5), circuit breaker probing (v4), storage.session API (v3),
BroadcastChannel API (v3), browser.alarms (v3), DOM reconciliation (v3), Single
Writer Authority (v2), unified render pipeline (v2), background keepalive (v1),
port circuit breaker (v1).

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, BroadcastChannelManager, QuickTabGroupManager,
NotificationManager

**Deprecated:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`,
`updateQuickTabSize()`

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

### v1.6.3.7-v9: Messaging & Storage Hardening

**Keepalive & Logging:**
- **Unified Keepalive** - Single 20s interval (consolidated heartbeat + keepalive)
- **Correlation IDs** - Track keepalive round-trips with unique IDs
- **MESSAGE_RECEIVED Format** - Unified logging with `[PORT]`, `[BC]`, `[RUNTIME]` prefixes

**Sequence Tracking:**
- **Storage sequenceId** - Event ordering validation for storage writes
- **Port messageSequence** - Reorder buffer for out-of-order port messages
- **BC sequenceNumber** - Gap detection for BroadcastChannel coalescing

**Port & Tab Management:**
- **Port Age Metadata** - 90s max age, 30s stale timeout
- **Tab Affinity Cleanup** - 24h TTL with `browser.tabs.onRemoved` listener
- **Initialization Barrier** - `initializationStarted`/`initializationComplete` flags

**Storage Integrity:**
- **Write Validation** - Verify storage writes with sync backup
- **Corruption Recovery** - Detect and recover from IndexedDB corruption
- **Race Cooldown** - Single authoritative dedup with 200ms cooldown

### v1.6.3.7-v8: Performance & Resilience (Retained)

**Port Resilience:** Message queue, atomic reconnection guard, heartbeat hysteresis.
**Broadcast Enhancements:** VisibilityHandler broadcasts, dynamic debounce, EventBus bridge.
**Performance Modules:** StorageCache.js, MemoryMonitor.js, VirtualScrollList.js, MessageBatcher.js.
**Lifecycle:** Firefox termination detection, ManagedEventListeners.js, QuickTabUIObjectPool.js.

### v1.6.3.7-v7: BroadcastChannel from Background + Confirmations (Retained)

**BC Tier 1:** Background posts to `quick-tabs-updates` after state ops.
**Full State Sync:** `broadcastFullStateSync()` for complete state updates.
**Confirmations:** MINIMIZE/RESTORE/DELETE/ADOPT_CONFIRMED handlers.

### v1.6.3.7-v3 to v6: Core Infrastructure (Retained)

**v6:** Channel logging (`[BC]`, `[PORT]`, `[STORAGE]`), lifecycle tracing.
**v5:** Connection states (connected→zombie→disconnected), deduplication.
**v4:** Circuit breaker probing (500ms), close all feedback.
**v3:** storage.session, BroadcastChannel, browser.alarms, DOM reconciliation.

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

## 🆕 v1.6.3.7-v9 Patterns

- **Unified Keepalive** - Single 20s interval with correlation IDs
- **Sequence Tracking** - sequenceId (storage), messageSequence (port), sequenceNumber (BC)
- **Port Age Management** - 90s max age, 30s stale timeout for port registry
- **Initialization Barrier** - `initializationStarted`/`initializationComplete` flags
- **Storage Integrity** - Write validation with sync backup and corruption recovery
- **Tab Affinity Cleanup** - 24h TTL with `browser.tabs.onRemoved` listener
- **Race Cooldown** - Single authoritative dedup with 200ms cooldown

## Prior Version Patterns (v1-v8 Retained)

- **v8:** Port message queue, atomic reconnection, heartbeat hysteresis, dynamic debounce
- **v7:** BC from background, full state sync, operation confirmations
- **v6:** Channel logging, lifecycle tracing, keepalive health
- **v5:** Connection states, zombie detection, listener deduplication
- **v4:** Circuit breaker probing, close all feedback
- **v3:** storage.session, BroadcastChannel, browser.alarms, DOM reconciliation
- **v2:** Single Writer Authority, unified render pipeline, orphan recovery
- **v1:** Background keepalive, port circuit breaker

### Key Timing Constants

| Constant                            | Value | Purpose                        |
| ----------------------------------- | ----- | ------------------------------ |
| `KEEPALIVE_INTERVAL_MS`             | 20000 | Unified keepalive (v9)         |
| `PORT_MAX_AGE_MS`                   | 90000 | Port registry max age (v9)     |
| `PORT_STALE_TIMEOUT_MS`             | 30000 | Port stale timeout (v9)        |
| `TAB_AFFINITY_TTL_MS`               | 86400000 | 24h TTL for tab affinity (v9) |
| `STORAGE_COOLDOWN_MS`               | 200   | Storage race cooldown (v9)     |
| `RENDER_DEBOUNCE_MS`                | 300   | UI render debounce             |
| `CIRCUIT_BREAKER_OPEN_DURATION_MS`  | 2000  | Open state (v4)                |
| `STORAGE_POLLING_INTERVAL_MS`       | 10000 | Polling backup (v4)            |

---

## Architecture Classes (Key Methods)

| Class                   | Methods                                               |
| ----------------------- | ----------------------------------------------------- |
| QuickTabStateMachine    | `canTransition()`, `transition()`                     |
| QuickTabMediator        | `minimize()`, `restore()`, `destroy()`                |
| MapTransactionManager   | `beginTransaction()`, `commitTransaction()`           |
| TabStateManager (v3)    | `getTabState()`, `setTabState()`                      |
| BroadcastChannelManager | `postMessage()`, `onMessage()`                        |
| Manager                 | `scheduleRender()`, `_transitionConnectionState()`    |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, coordinated clear, closeAll mutex, circuit breaker probing (v4),
connection state tracking (v5), enhanced observability (v6), BroadcastChannel
from background (v7), port message queue (v8), hybrid storage cache (v8),
virtual scrolling (v8), object pooling (v8), message batching (v8), unified
keepalive (v9), sequence tracking (v9), storage integrity (v9), initialization
barrier (v9), tab affinity cleanup (v9).

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

| File                     | Features                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `background.js`          | Port registry, BroadcastChannel posting, keepalive (v9)      |
| `quick-tabs-manager.js`  | `scheduleRender()`, confirmation handlers, sequence tracking |
| `storage-utils.js`       | `writeStateWithVerificationAndRetry()`, integrity (v9)       |
| `TabStateManager.js`     | Per-tab state (sessions API, v3)                             |
| `BroadcastChannelManager.js` | Real-time messaging, sequence tracking (v9)              |
| `StorageCache.js`        | Hybrid read-through caching (v8)                             |
| `MemoryMonitor.js`       | Heap usage tracking (v8)                                     |
| `PerformanceMetrics.js`  | Timing collection (v8)                                       |
| `IncrementalSync.js`     | Incremental state persistence (v8)                           |
| `MessageBatcher.js`      | Adaptive message batching (v8)                               |
| `VirtualScrollList.js`   | Virtual scrolling for lists (v8)                             |
| `DOMUpdateBatcher.js`    | Debounced DOM updates (v8)                                   |
| `ManagedEventListeners.js` | Event listener lifecycle (v8)                              |
| `QuickTabUIObjectPool.js` | UI element object pooling (v8)                              |
| `LinkVisibilityObserver.js` | Content IntersectionObserver (v8)                         |
| `PersistenceSchema.js`   | Selective persistence schema (v8)                            |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session, v3)  
**Format:** `{ tabs: [{ ..., orphaned, permanent }], saveId, timestamp, writingTabId, sequenceId }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`,
`BROADCAST`, `REQUEST_FULL_STATE_SYNC`, `ADOPT_TAB`, `CLOSE_MINIMIZED_TABS`

**BroadcastChannel (v3):** `quick-tab-created`, `quick-tab-updated`,
`quick-tab-deleted`, `quick-tab-minimized`, `quick-tab-restored`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
