# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7-v10  
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

**v1.6.3.7-v10 Features (NEW):**

- **Storage Watchdog** - 2s watchdog timer after writes, triggers re-read if storage.onChanged doesn't fire
- **BC Gap Detection** - Gap detection callback wired, storage fallback on sequence gap, 5s staleness check
- **IndexedDB Corruption Detection** - Checksum validation on startup, auto-restore from sync backup on mismatch
- **Port Message Reordering** - Queue with 1s timeout for stuck messages, sequence-based dequeue with fallback
- **Tab Affinity Diagnostics** - Age bucket logging (< 1h, 1-6h, 6-24h, > 24h), defensive cleanup via browser.tabs.query()
- **Initialization Timing** - initializationStartTime tracking, LISTENER_REGISTERED logging with init status

**v1.6.3.7-v9 Features (Retained):** Unified keepalive (20s), correlation IDs,
MESSAGE_RECEIVED logging, sequenceId/messageSequence/sequenceNumber tracking,
storage integrity with sync backup, port age management (90s max, 30s stale),
tab affinity cleanup (24h TTL), initialization barrier flags, race cooldown (200ms).

**v1.6.3.7-v8 Features (Retained):** Port message queue, atomic reconnection guard,
VisibilityHandler broadcasts, dynamic debounce, heartbeat hysteresis, Firefox
termination detection, EventBus bridge, hybrid storage cache, memory monitoring,
performance metrics, virtual scrolling, message batching, object pooling.

**Legacy Features (v1-v7):** BroadcastChannel from background (v7), full state sync (v7),
operation confirmations (v7), connection state tracking (v5), zombie detection (v5),
circuit breaker probing (v4), storage.session API (v3), DOM reconciliation (v3),
Single Writer Authority (v2), background keepalive (v1), port circuit breaker (v1).

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

### v1.6.3.7-v10: State Persistence Hardening

**Storage Event Ordering (Issue #6):**
- **Watchdog Timer** - 2s timer after writes triggers re-read if storage.onChanged doesn't fire
- **Sequence Validation Gate** - lastAppliedSequenceId tracking for event ordering

**BroadcastChannel Gap Detection (Issue #7):**
- **Gap Callback Wired** - Gap detection properly triggers storage fallback
- **Staleness Check** - 5s threshold for BroadcastChannel message freshness

**IndexedDB Corruption Detection (Issue #8):**
- **Checksum Validation** - Compare local storage checksum with sync backup on startup
- **Auto-Restore** - Automatic recovery from sync backup on mismatch

**Port Message Reordering (Issue #9):**
- **Reorder Queue** - Queue for out-of-order port messages
- **Timeout Fallback** - 1s timeout for stuck messages with sequence-based dequeue

**Tab Affinity Diagnostics (Issue #10):**
- **Age Bucket Logging** - Distribution logging (< 1h, 1-6h, 6-24h, > 24h)
- **Defensive Cleanup** - browser.tabs.query() validation for stale entries

**Initialization Timing (Issue #11):**
- **Start Time Tracking** - initializationStartTime for timing diagnostics
- **Listener Logging** - LISTENER_REGISTERED with timeSinceInitStartMs

### v1.6.3.7-v9: Messaging & Storage Hardening (Retained)

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

## 🆕 v1.6.3.7-v10 Patterns

- **Storage Watchdog** - 2s timer triggers re-read if storage.onChanged doesn't fire
- **BC Gap Detection** - Storage fallback on sequence gap, 5s staleness check
- **IndexedDB Checksum** - Checksum validation with auto-restore from sync backup
- **Port Message Queue** - 1s timeout for stuck messages with sequence-based dequeue
- **Tab Affinity Buckets** - Age distribution logging (< 1h, 1-6h, 6-24h, > 24h)
- **Init Timing** - initializationStartTime with LISTENER_REGISTERED logging

## Prior Version Patterns (v1-v9 Retained)

- **v9:** Unified keepalive, sequence tracking, storage integrity, initialization barrier
- **v8:** Port message queue, atomic reconnection, heartbeat hysteresis, dynamic debounce
- **v7:** BC from background, full state sync, operation confirmations
- **v6:** Channel logging, lifecycle tracing, keepalive health
- **v5:** Connection states, zombie detection, listener deduplication
- **v4:** Circuit breaker probing, close all feedback
- **v3:** storage.session, BroadcastChannel, browser.alarms, DOM reconciliation
- **v2:** Single Writer Authority, unified render pipeline, orphan recovery
- **v1:** Background keepalive, port circuit breaker

### Key Timing Constants

| Constant                            | Value | Purpose                            |
| ----------------------------------- | ----- | ---------------------------------- |
| `STORAGE_WATCHDOG_TIMEOUT_MS`       | 2000  | Watchdog timer for writes (v10)    |
| `PORT_MESSAGE_QUEUE_TIMEOUT_MS`     | 1000  | Stuck message timeout (v10)        |
| `KEEPALIVE_INTERVAL_MS`             | 20000 | Unified keepalive (v9)             |
| `PORT_MAX_AGE_MS`                   | 90000 | Port registry max age (v9)         |
| `PORT_STALE_TIMEOUT_MS`             | 30000 | Port stale timeout (v9)            |
| `TAB_AFFINITY_TTL_MS`               | 86400000 | 24h TTL for tab affinity (v9)   |
| `STORAGE_COOLDOWN_MS`               | 200   | Storage race cooldown (v9)         |
| `RENDER_DEBOUNCE_MS`                | 300   | UI render debounce                 |
| `CIRCUIT_BREAKER_OPEN_DURATION_MS`  | 2000  | Open state (v4)                    |
| `STORAGE_POLLING_INTERVAL_MS`       | 10000 | Polling backup (v4)                |

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
Authority, coordinated clear, closeAll mutex, storage watchdog (v10),
BC gap detection (v10), IndexedDB checksum (v10), port message reordering (v10),
tab affinity buckets (v10), init timing (v10), unified keepalive (v9),
sequence tracking (v9), storage integrity (v9), initialization barrier (v9),
port message queue (v8), hybrid storage cache (v8), virtual scrolling (v8),
object pooling (v8), circuit breaker probing (v4), connection state tracking (v5).

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

| File                     | Features                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `background.js`          | Port registry, BC posting, watchdog timer (v10), keepalive (v9) |
| `quick-tabs-manager.js`  | `scheduleRender()`, port reordering queue (v10), sequence (v9)  |
| `storage-utils.js`       | Checksum validation (v10), integrity (v9), write verification   |
| `TabStateManager.js`     | Per-tab state (sessions API, v3)                                |
| `BroadcastChannelManager.js` | Gap detection (v10), sequence tracking (v9)                 |
| `StorageCache.js`        | Hybrid read-through caching (v8)                                |
| `MemoryMonitor.js`       | Heap usage tracking (v8)                                        |
| `PerformanceMetrics.js`  | Timing collection (v8)                                          |
| `IncrementalSync.js`     | Incremental state persistence (v8)                              |
| `MessageBatcher.js`      | Adaptive message batching (v8)                                  |
| `VirtualScrollList.js`   | Virtual scrolling for lists (v8)                                |
| `DOMUpdateBatcher.js`    | Debounced DOM updates (v8)                                      |
| `ManagedEventListeners.js` | Event listener lifecycle (v8)                                 |
| `QuickTabUIObjectPool.js` | UI element object pooling (v8)                                 |
| `LinkVisibilityObserver.js` | Content IntersectionObserver (v8)                            |
| `PersistenceSchema.js`   | Selective persistence schema (v8)                               |

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
