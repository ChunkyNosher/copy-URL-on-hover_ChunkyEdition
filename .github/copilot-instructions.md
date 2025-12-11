# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7-v12  
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

**v1.6.3.7-v12 Features (NEW):**

- **DEBUG_DIAGNOSTICS flag** - Separate verbose diagnostics from DEBUG_MESSAGING
- **BroadcastChannel fallback logging** - Logs when BC unavailable and sidebar activates fallback
- **Keepalive health sampling** - First failure + 10% sampling for diagnostic visibility
- **Port registry threshold monitoring** - Logs warnings at 50 ports, errors at 100 with cleanup
- **Storage validation logging** - Structured logging for each validation stage
- **Deduplication decision logging** - Every skip/process decision logged with reason
- **Initialization race barrier** - async await with 10s timeout in handleGetQuickTabsState()
- **Storage corruption recovery** - Re-write + verification when validation fails
- **Sequence ID prioritization** - Uses sequenceId over arbitrary 50ms timestamp window
- **Sidebar fallback health monitoring** - 30s interval status logging for fallback
- **currentTabId barrier** - 2s timeout exponential backoff in content script init
- **Centralized storage write validation** - Background direct writes now validated

**v1.6.3.7-v11 Features (Retained):**

- Promise-based listener barrier, LRU eviction (1000 entries), correlation ID echo
- State machine timeout watchers (7s), WeakRef callbacks, deferred handlers
- Cascading rollback, write-ahead logging, timestamp cleanup (30s/60s)
- ID pattern validation, CodeScene: background.js 9.09, quick-tabs-manager.js 9.09

**v1.6.3.7-v10 Features (Retained):** Storage watchdog (2s), BC gap detection,
IndexedDB checksum, port message reordering (1s), tab affinity buckets, init timing.

**v1.6.3.7-v9 Features (Retained):** Unified keepalive (20s), correlation IDs,
MESSAGE_RECEIVED logging, sequenceId/messageSequence/sequenceNumber tracking,
storage integrity with sync backup, port age management (90s max, 30s stale),
tab affinity cleanup (24h TTL), initialization barrier flags, race cooldown (200ms).

**Legacy Features (v1-v8):** Port message queue (v8), heartbeat hysteresis (v8),
BroadcastChannel from background (v7), full state sync (v7), operation confirmations (v7),
connection state tracking (v5), zombie detection (v5), circuit breaker probing (v4),
storage.session API (v3), DOM reconciliation (v3), Single Writer Authority (v2),
background keepalive (v1), port circuit breaker (v1).

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

### v1.6.3.7-v12: Logging & Diagnostics Improvements (NEW)

- **BroadcastChannel fallback** - Context detection, fallback activation logging
- **Keepalive health** - First failure + 10% sampling with context
- **Port registry** - WARN at 50, CRITICAL at 100 with auto-cleanup
- **Storage validation** - Each stage logged with expected vs actual
- **Dedup visibility** - All skip/process decisions logged with reasons
- **Init race barrier** - async await with 10s timeout in handleGetQuickTabsState()
- **Sequence ID ordering** - Prioritized over 50ms timestamp window
- **Sidebar fallback** - 30s interval health monitoring
- **currentTabId barrier** - 2s exponential backoff before hydration
- **Corruption recovery** - Re-write + verify on validation failure

### v1.6.3.7-v11: Architecture Fixes (Retained)

- Promise-based listener barrier, LRU dedup (1000), correlation ID echo
- State machine timeouts (7s), WeakRef callbacks, deferred handlers
- Cascading rollback, write-ahead logging, timestamp cleanup
- CodeScene: background.js 9.09, quick-tabs-manager.js 9.09

### v1.6.3.7-v10: State Persistence (Retained)

Storage watchdog (2s), BC gap detection (5s), IndexedDB checksum,
port message reordering (1s), tab affinity buckets, init timing.

### v1.6.3.7-v9: Messaging Hardening (Retained)

Unified keepalive (20s), correlation IDs, sequence tracking (storage/port/BC),
port age (90s max), tab affinity cleanup (24h TTL), race cooldown (200ms).

### v1.6.3.7-v3-v8: Infrastructure (Retained)

**v8:** Port queue, heartbeat hysteresis, StorageCache, MemoryMonitor.
**v7:** BC from background, full state sync, confirmations.
**v6:** Channel logging (`[BC]`, `[PORT]`, `[STORAGE]`).
**v5:** Connection states (connected→zombie→disconnected).
**v4:** Circuit breaker probing (500ms).
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

## 🆕 v1.6.3.7-v12 Patterns

- **DEBUG_DIAGNOSTICS flag** - Separate from DEBUG_MESSAGING for verbose diagnostics
- **Keepalive first-failure logging** - Always log first failure, then sample 10%
- **Port registry threshold checks** - 50 warn, 100 critical with auto-cleanup
- **Dedup decision logging** - Skip/process with reason (saveId, timestamp, hash)
- **Initialization barrier** - async await with timeout protection
- **Storage validation symmetry** - All writes validated regardless of source
- **Sequence ID ordering** - Prioritized over arbitrary timestamp windows
- **Fallback health monitoring** - 30s interval status for sidebar
- **currentTabId barrier** - Exponential backoff polling (2s max)
- **Corruption recovery** - Re-write + verify on validation failure

## v1.6.3.7-v11 Patterns (Retained)

- Promise-based barrier, LRU eviction (1000), correlation ID echo
- State machine timeouts (7s), WeakRef callbacks, deferred handlers
- Cascading rollback, write-ahead logging, timestamp cleanup (30s/60s)
- ID validation (QUICK_TAB_ID_PATTERN constant)

## Prior Version Patterns (v1-v10)

- **v10:** Storage watchdog (2s), BC gap detection, IndexedDB checksum, port reordering (1s)
- **v9:** Unified keepalive (20s), sequence tracking, storage integrity, initialization barrier
- **v8:** Port message queue, atomic reconnection, heartbeat hysteresis, dynamic debounce
- **v7:** BC from background, full state sync, operation confirmations
- **v6:** Channel logging (`[BC]`, `[PORT]`, `[STORAGE]`), keepalive health
- **v5:** Connection states (connected→zombie→disconnected), deduplication
- **v4:** Circuit breaker probing (500ms), close all feedback
- **v3:** storage.session, BroadcastChannel, browser.alarms, DOM reconciliation
- **v2:** Single Writer Authority, unified render pipeline, orphan recovery
- **v1:** Background keepalive (20s), port circuit breaker (100ms→10s)

### Key Timing Constants

| Constant                            | Value | Purpose                            |
| ----------------------------------- | ----- | ---------------------------------- |
| `INIT_BARRIER_TIMEOUT_MS`           | 10000 | Initialization race timeout (v12)  |
| `CURRENTTABID_BARRIER_TIMEOUT_MS`   | 2000  | currentTabId detection (v12)       |
| `FALLBACK_HEALTH_INTERVAL_MS`       | 30000 | Sidebar fallback status (v12)      |
| `PORT_REGISTRY_WARN_THRESHOLD`      | 50    | Port warning threshold (v12)       |
| `PORT_REGISTRY_CRITICAL_THRESHOLD`  | 100   | Port critical + cleanup (v12)      |
| `STATE_MACHINE_TIMEOUT_MS`          | 7000  | Auto-recovery timeout (v11)        |
| `TIMESTAMP_CLEANUP_INTERVAL_MS`     | 30000 | Periodic cleanup interval (v11)    |
| `TIMESTAMP_MAX_AGE_MS`              | 60000 | Max timestamp age (v11)            |
| `DEDUP_MAP_MAX_SIZE`                | 1000  | LRU eviction threshold (v11)       |
| `STORAGE_WATCHDOG_TIMEOUT_MS`       | 2000  | Watchdog timer for writes (v10)    |
| `PORT_MESSAGE_QUEUE_TIMEOUT_MS`     | 1000  | Stuck message timeout (v10)        |
| `KEEPALIVE_INTERVAL_MS`             | 20000 | Unified keepalive (v9)             |
| `PORT_MAX_AGE_MS`                   | 90000 | Port registry max age (v9)         |
| `STORAGE_COOLDOWN_MS`               | 200   | Storage race cooldown (v9)         |

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
Authority, coordinated clear, closeAll mutex,
**v12:** DEBUG_DIAGNOSTICS, keepalive sampling, port threshold monitoring,
dedup decision logging, init barrier timeout, storage validation symmetry,
sequence ID prioritization, fallback health monitoring, currentTabId barrier,
corruption recovery,
**v11:** promise barrier, LRU eviction, correlation echo, state machine timeouts,
WeakRef callbacks, cascading rollback,
**v10:** storage watchdog, BC gap detection, IndexedDB checksum,
**v9:** unified keepalive, port message queue,
**v8:** hybrid storage cache,
**v4:** circuit breaker.

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
| `background.js`          | Port registry thresholds (v12), dedup logging (v12), keepalive sampling (v12) |
| `quick-tabs-manager.js`  | Fallback health monitoring (v12), Promise barrier (v11)         |
| `QuickTabHandler.js`     | Init barrier timeout (v12), corruption recovery (v12)           |
| `index.js` (quick-tabs)  | currentTabId barrier (v12)                                      |
| `BroadcastChannelManager.js` | Context detection (v12), fallback logging (v12)             |
| `storage-utils.js`       | Validation logging (v12), checksum (v10), integrity (v9)        |
| `TabStateManager.js`     | Per-tab state (sessions API, v3)                                |
| `StorageCache.js`        | Hybrid read-through caching (v8)                                |
| `MemoryMonitor.js`       | Heap usage tracking (v8)                                        |

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
