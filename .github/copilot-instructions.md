# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v2  
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

**v1.6.3.8-v2 Features (NEW):**

- **Background Relay pattern** - Sidebar communication bypasses BC origin isolation
- **ACK-based messaging** - `sendRequestWithTimeout()` utility for reliable delivery
- **SIDEBAR_READY handshake** - Protocol before routing messages to sidebar
- **BFCache lifecycle events** - `PAGE_LIFECYCLE_BFCACHE_ENTER/RESTORE`
- **Port registry snapshots** - Every 60s with active/idle/zombie counts
- **Port eviction logging** - `PORT_EVICTED` with reason codes
- **Circuit breaker for ACKs** - `PORT_CIRCUIT_BREAKER_TRIGGERED` when pending > 50
- **Storage sequence rejection** - `STORAGE_SEQUENCE_REJECTED` for out-of-order events
- **Write latency logging** - `STORAGE_WRITE_LATENCY`, `STORAGE_BACKPRESSURE_DETECTED`
- **WriteBuffer pattern** - 75ms batching to prevent IndexedDB deadlocks
- **Version-based conflict resolution** - `STATE_CONFLICT_DETECTED` logging
- **Message queuing** - `INIT_MESSAGE_QUEUED/REPLAY` until READY signal
- **Handler timeout** - 5000ms with `HANDLER_TIMEOUT/COMPLETED` logging
- **New file:** `src/utils/message-utils.js` - ACK-based messaging utilities

**v1.6.3.8 Features (Retained):**

- Initialization barriers (QuickTabHandler 10s, currentTabId 2s backoff)
- Centralized storage validation with re-write + verify
- Dedup decision logging, BC fallback detection, keepalive health reports
- Code Health: background.js (9.09), QuickTabHandler.js (9.41)

**v1.6.3.7-v11-v12 Features (Retained):** DEBUG_DIAGNOSTICS flag, Promise-based
listener barrier, LRU eviction (1000 entries), correlation ID echo, state
machine timeout watchers (7s), port registry thresholds.

**Legacy Features (v1-v10):** Storage watchdog, BC gap detection, IndexedDB
checksum, unified keepalive (20s), sequence tracking, port message queue,
heartbeat hysteresis, circuit breaker probing, Single Writer Authority.

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

### v1.6.3.8-v2: Communication & Storage Layer (NEW)

- **Background Relay pattern** - `BC_SIDEBAR_RELAY_ACTIVE` bypasses BC origin isolation
- **ACK-based messaging** - `MESSAGE_ACK_RECEIVED`, `SIDEBAR_MESSAGE_DELIVERED`
- **SIDEBAR_READY handshake** - Protocol ensures sidebar is ready before messages
- **BFCache lifecycle** - `PAGE_LIFECYCLE_BFCACHE_ENTER/RESTORE` events
- **Port registry snapshots** - 60s interval with active/idle/zombie counts
- **Port eviction** - `PORT_EVICTED` with reason codes
- **ACK circuit breaker** - `PORT_CIRCUIT_BREAKER_TRIGGERED` when pending > 50
- **Sequence rejection** - `STORAGE_SEQUENCE_REJECTED` for out-of-order events
- **Write latency** - `STORAGE_WRITE_LATENCY`, `STORAGE_BACKPRESSURE_DETECTED`
- **WriteBuffer pattern** - 75ms batching prevents IndexedDB deadlocks
- **Conflict resolution** - `STATE_CONFLICT_DETECTED` version-based logging
- **Message queuing** - `INIT_MESSAGE_QUEUED/REPLAY` until READY
- **Handler timeout** - 5000ms with `HANDLER_TIMEOUT/COMPLETED`

### v1.6.3.8: Initialization & Diagnostics (Retained)

- **Initialization barriers** - QuickTabHandler (10s), currentTabId (2s backoff)
- **Centralized storage validation** - Type-specific recovery with re-write +
  verify
- **Dedup decision logging** -
  `DEDUP_DECISION: saveId=X, decision=[SKIP|PROCESS]`
- **Sidebar BC fallback** - `SIDEBAR_BC_UNAVAILABLE`, `FALLBACK_HEALTH` logging
- **Storage tier probing** - `BC_VERIFICATION_STARTED/SUCCESS/FAILED`, latency
- **BFCache handling** - pageshow/pagehide events for state restoration
- **Keepalive health reports** -
  `KEEPALIVE_HEALTH_REPORT: X successes, Y failures (Z%)`
- **Port activity tracking** -
  `PORT_ACTIVITY: portId=X, lastMessageTime=NN ms ago`
- **Code Health** - background.js (9.09), QuickTabHandler.js (9.41)

### v1.6.3.7-v12: Logging & Diagnostics (Retained)

- DEBUG_DIAGNOSTICS flag, BC fallback, keepalive sampling, port thresholds
- Storage validation logging, sequence ID prioritization, corruption recovery

### v1.6.3.7-v9-v11: Architecture (Retained)

- **v11:** Promise barrier, LRU dedup (1000), correlation ID echo, state machine
  timeouts (7s)
- **v10:** Storage watchdog (2s), BC gap detection, IndexedDB checksum, port
  reordering
- **v9:** Unified keepalive (20s), sequence tracking, storage integrity, port
  age (90s)

### v1.6.3.7-v3-v8: Infrastructure (Retained)

**v8:** Port queue, heartbeat hysteresis. **v7:** BC from background, full state
sync. **v6:** Channel logging. **v5:** Connection states. **v4:** Circuit
breaker probing. **v3:** storage.session, BroadcastChannel, browser.alarms, DOM
reconciliation.

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

## 🆕 v1.6.3.8-v2 Patterns

- **Background Relay** - Sidebar messages routed through background for BC isolation
- **ACK-based messaging** - `sendRequestWithTimeout()` with configurable timeout
- **SIDEBAR_READY handshake** - Sidebar sends READY signal before receiving messages
- **BFCache lifecycle events** - pageshow/pagehide with persisted flag detection
- **Port registry snapshots** - 60s interval logging with zombie detection
- **Port eviction** - `PORT_EVICTED: reason=timeout|zombie|limit` codes
- **ACK circuit breaker** - Triggers at 50 pending ACKs to prevent memory bloat
- **Sequence rejection** - `STORAGE_SEQUENCE_REJECTED: expected=X, got=Y`
- **Write latency tracking** - `STORAGE_WRITE_LATENCY: Xms` with backpressure detection
- **WriteBuffer batching** - 75ms window to batch writes, prevents IndexedDB deadlocks
- **Version-based conflicts** - `STATE_CONFLICT_DETECTED: local=X, remote=Y`
- **Message queuing** - Queues messages during init, replays after READY
- **Handler timeout** - 5000ms max with `HANDLER_TIMEOUT` if exceeded

## v1.6.3.8 Patterns (Retained)

- **Initialization barriers** - QuickTabHandler (10s timeout), currentTabId (2s
  exponential backoff)
- **Storage validation** - Centralized type-specific recovery with re-write +
  verify
- **Dedup decision logging** - `DEDUP_DECISION` with saveId, decision, reason
- **BC fallback detection** - `SIDEBAR_BC_UNAVAILABLE` activates storage polling
- **Fallback health monitoring** - 30s interval with message count and latency
- **Storage tier probing** - `BC_VERIFICATION_STARTED/SUCCESS/FAILED` with
  timeout
- **BFCache events** - pageshow/pagehide for browser back/forward navigation
- **Keepalive health reports** - 60s interval with success/failure rate
- **Port activity logging** - `PORT_ACTIVITY` with lastMessageTime tracking

## v1.6.3.7-v11-v12 Patterns (Retained)

- DEBUG_DIAGNOSTICS flag, Promise-based barrier, LRU eviction (1000)
- Correlation ID echo, state machine timeouts (7s), port registry thresholds

## Prior Version Patterns (v1-v10)

- **v10:** Storage watchdog (2s), BC gap detection, IndexedDB checksum, port
  reordering
- **v9:** Unified keepalive (20s), sequence tracking, storage integrity, port
  age
- **v8:** Port message queue, atomic reconnection, heartbeat hysteresis
- **v7:** BC from background, full state sync, operation confirmations
- **v6:** Channel logging (`[BC]`, `[PORT]`, `[STORAGE]`)
- **v5:** Connection states (connected→zombie→disconnected)
- **v4:** Circuit breaker probing (500ms)
- **v3:** storage.session, BroadcastChannel, browser.alarms, DOM reconciliation

### Key Timing Constants

| Constant                              | Value | Purpose                              |
| ------------------------------------- | ----- | ------------------------------------ |
| `HANDLER_TIMEOUT_MS`                  | 5000  | Handler execution timeout (v8-v2)    |
| `WRITE_BUFFER_FLUSH_MS`               | 75    | WriteBuffer batch window (v8-v2)     |
| `PORT_REGISTRY_SNAPSHOT_INTERVAL_MS`  | 60000 | Port registry snapshots (v8-v2)      |
| `ACK_CIRCUIT_BREAKER_THRESHOLD`       | 50    | Pending ACK limit (v8-v2)            |
| `INIT_BARRIER_TIMEOUT_MS`             | 10000 | QuickTabHandler init barrier (v8)    |
| `CURRENTTABID_BARRIER_TIMEOUT_MS`     | 2000  | currentTabId detection (v8)          |
| `STATE_MACHINE_TIMEOUT_MS`            | 7000  | Auto-recovery timeout (v11)          |
| `DEDUP_MAP_MAX_SIZE`                  | 1000  | LRU eviction threshold (v11)         |
| `KEEPALIVE_INTERVAL_MS`               | 20000 | Unified keepalive (v9)               |
| `PORT_MAX_AGE_MS`                     | 90000 | Port registry max age (v9)           |

---

## Architecture Classes (Key Methods)

| Class                   | Methods                                            |
| ----------------------- | -------------------------------------------------- |
| QuickTabStateMachine    | `canTransition()`, `transition()`                  |
| QuickTabMediator        | `minimize()`, `restore()`, `destroy()`             |
| MapTransactionManager   | `beginTransaction()`, `commitTransaction()`        |
| TabStateManager (v3)    | `getTabState()`, `setTabState()`                   |
| BroadcastChannelManager | `postMessage()`, `onMessage()`                     |
| Manager                 | `scheduleRender()`, `_transitionConnectionState()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, coordinated clear, closeAll mutex, **v1.6.3.8-v2:** Background Relay,
ACK-based messaging, SIDEBAR_READY handshake, WriteBuffer batching, sequence
rejection, port snapshots, **v1.6.3.8:** init barriers, centralized validation,
dedup logging, BC fallback, **v1.6.3.7-v11-v12:** DEBUG_DIAGNOSTICS, promise
barrier, LRU eviction, **v1.6.3.7-v4:** circuit breaker.

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

| File                         | Features                                                             |
| ---------------------------- | -------------------------------------------------------------------- |
| `background.js`              | Background Relay (v8-v2), port snapshots (v8-v2), init barrier (v8)  |
| `quick-tabs-manager.js`      | SIDEBAR_READY handshake (v8-v2), WriteBuffer (v8-v2)                 |
| `QuickTabHandler.js`         | Handler timeout (v8-v2), init barrier (v8), Code Health 9.41         |
| `index.js` (quick-tabs)      | BFCache lifecycle (v8-v2), currentTabId barrier (v8)                 |
| `message-utils.js`           | ACK-based messaging (v8-v2), sendRequestWithTimeout() ⭐ NEW          |
| `BroadcastChannelManager.js` | BC relay fallback (v8-v2), verification (v8)                         |
| `storage-utils.js`           | WriteBuffer (v8-v2), sequence rejection (v8-v2), validation (v8)     |
| `TabStateManager.js`         | Per-tab state (sessions API, v3)                                     |

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
