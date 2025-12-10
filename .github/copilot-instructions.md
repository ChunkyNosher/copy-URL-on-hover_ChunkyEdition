# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7-v8  
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

**v1.6.3.7-v8 Features (NEW):**

- **Port Message Queue** - Messages queued during reconnection (#9)
- **Atomic Reconnection Guard** - `isReconnecting` flag prevents race conditions (#10)
- **VisibilityHandler Broadcasts** - `broadcastQuickTabMinimized/Restored` (#11)
- **Dynamic Debounce** - 500ms Tier1 (port), 200ms fallback (BC) (#12)
- **Heartbeat Hysteresis** - 3 failures before ZOMBIE state (#13)
- **Firefox Termination Detection** - 10s health check interval (#14)
- **EventBus to Broadcast Bridge** - Forward events via setTimeout (#15)
- **Hybrid Storage Cache** - Read-through caching (StorageCache.js)
- **Memory Monitoring** - MemoryMonitor.js for heap tracking
- **Performance Metrics** - PerformanceMetrics.js for timing collection
- **Content IntersectionObserver** - LinkVisibilityObserver.js
- **Incremental State Persistence** - IncrementalSync.js
- **Selective Persistence** - PersistenceSchema.js
- **Message Batching** - MessageBatcher.js with adaptive windows
- **Broadcast Backpressure** - BroadcastChannelManager enhancement
- **Virtual Scrolling** - VirtualScrollList.js for large lists
- **Debounced DOM Updates** - DOMUpdateBatcher.js
- **Event Listener Lifecycle** - ManagedEventListeners.js
- **Object Pool** - QuickTabUIObjectPool.js for UI elements

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

### v1.6.3.7-v8: Performance & Resilience Optimizations

**Port Resilience:**
- **Message Queue** - Messages queued during port reconnection
- **Atomic Guard** - `isReconnecting` flag prevents concurrent reconnection attempts
- **Heartbeat Hysteresis** - 3 consecutive failures before ZOMBIE state transition

**Broadcast Enhancements:**
- **VisibilityHandler Broadcasts** - `broadcastQuickTabMinimized()`, `broadcastQuickTabRestored()`
- **Dynamic Debounce** - 500ms for Tier1 (port), 200ms for fallback (BroadcastChannel)
- **EventBus Bridge** - Forward events to broadcasts via setTimeout

**Performance Modules:**
- **StorageCache.js** - Hybrid read-through caching
- **MemoryMonitor.js** - Heap usage tracking
- **PerformanceMetrics.js** - Timing collection
- **IncrementalSync.js** - Incremental state persistence
- **MessageBatcher.js** - Adaptive message batching
- **VirtualScrollList.js** - Virtual scrolling for large lists
- **DOMUpdateBatcher.js** - Debounced DOM updates

**Lifecycle Improvements:**
- **Firefox Termination Detection** - 10s health check interval
- **ManagedEventListeners.js** - Automatic cleanup
- **QuickTabUIObjectPool.js** - Object pooling for UI elements

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

## 🆕 v1.6.3.7-v8 Patterns

- **Port Message Queue** - Queue messages during reconnection
- **Atomic Reconnection** - `isReconnecting` guard prevents race conditions
- **Heartbeat Hysteresis** - 3 failures threshold before state change
- **Dynamic Debounce** - Tier-based debounce timing (500ms/200ms)
- **Hybrid Storage Cache** - Read-through caching with invalidation
- **Virtual Scrolling** - Render only visible items
- **Object Pooling** - Reuse UI elements to reduce GC pressure
- **Message Batching** - Adaptive windows based on message rate

## Prior Version Patterns (v1-v7 Retained)

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
| `KEEPALIVE_INTERVAL_MS`             | 20000 | Firefox 30s timeout workaround |
| `RENDER_DEBOUNCE_MS`                | 300   | UI render debounce             |
| `CIRCUIT_BREAKER_OPEN_DURATION_MS`  | 2000  | Open state (v4)                |
| `STORAGE_POLLING_INTERVAL_MS`       | 10000 | Polling backup (v4)            |
| `HEARTBEAT_INTERVAL_MS`             | 25000 | Keep background alive          |

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
virtual scrolling (v8), object pooling (v8), message batching (v8).

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
| `background.js`          | Port registry, BroadcastChannel posting, confirmations (v7)  |
| `quick-tabs-manager.js`  | `scheduleRender()`, confirmation handlers, dedup (v7)        |
| `storage-utils.js`       | `writeStateWithVerificationAndRetry()`, write lifecycle (v6) |
| `TabStateManager.js`     | Per-tab state (sessions API, v3)                             |
| `BroadcastChannelManager.js` | Real-time messaging, backpressure (v8)                   |
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
**Format:** `{ tabs: [{ ..., orphaned, permanent }], saveId, timestamp, writingTabId }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`,
`BROADCAST`, `REQUEST_FULL_STATE_SYNC`, `ADOPT_TAB`, `CLOSE_MINIMIZED_TABS`

**BroadcastChannel (v3):** `quick-tab-created`, `quick-tab-updated`,
`quick-tab-deleted`, `quick-tab-minimized`, `quick-tab-restored`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
