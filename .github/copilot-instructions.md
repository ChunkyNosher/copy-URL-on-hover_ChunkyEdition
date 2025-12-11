# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8  
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

**v1.6.3.8 Features (NEW):**

- **Initialization barriers** - QuickTabHandler (10s) and currentTabId (2s
  exponential backoff)
- **Centralized storage validation** - Type-specific recovery strategies with
  re-write + verify
- **Dedup decision logging** - All skip/process decisions with sequence ID
  prioritization
- **Sidebar BC fallback** - Context detection, fallback activation, 30s health
  monitoring
- **Active storage tier probing** - Latency measurement with 500ms timeout
- **BFCache handling** - pageshow/pagehide events for proper state restoration
- **Keepalive health reporting** - Every 60s with success rate percentage
- **Port lifecycle metadata** - Activity logging with last message time tracking
- **Code Health improvements** - background.js (9.09), QuickTabHandler.js (9.41)

**v1.6.3.7-v12 Features (Retained):**

- DEBUG_DIAGNOSTICS flag, BroadcastChannel fallback logging, keepalive health
  sampling
- Port registry thresholds (50 warn, 100 critical), storage validation logging
- Sequence ID prioritization over 50ms timestamp window

**v1.6.3.7-v11 Features (Retained):**

- Promise-based listener barrier, LRU eviction (1000 entries), correlation ID
  echo
- State machine timeout watchers (7s), WeakRef callbacks, deferred handlers
- Cascading rollback, write-ahead logging, timestamp cleanup (30s/60s)

**v1.6.3.7-v9-v10 Features (Retained):** Storage watchdog (2s), BC gap
detection, IndexedDB checksum, port message reordering (1s), unified keepalive
(20s), sequence tracking, storage integrity, port age management (90s max).

**Legacy Features (v1-v8):** Port message queue, heartbeat hysteresis, full
state sync, connection state tracking, zombie detection, circuit breaker
probing, storage.session API, DOM reconciliation, Single Writer Authority,
background keepalive, port circuit breaker.

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

### v1.6.3.8: Initialization & Diagnostics (NEW)

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

## 🆕 v1.6.3.8 Patterns

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

## v1.6.3.7-v12 Patterns (Retained)

- DEBUG_DIAGNOSTICS flag, keepalive first-failure logging + 10% sampling
- Port registry thresholds (50 warn, 100 critical), sequence ID ordering

## v1.6.3.7-v11 Patterns (Retained)

- Promise-based barrier, LRU eviction (1000), correlation ID echo
- State machine timeouts (7s), WeakRef callbacks, deferred handlers
- Cascading rollback, write-ahead logging, timestamp cleanup (30s/60s)

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

| Constant                              | Value | Purpose                           |
| ------------------------------------- | ----- | --------------------------------- |
| `INIT_BARRIER_TIMEOUT_MS`             | 10000 | QuickTabHandler init barrier (v8) |
| `CURRENTTABID_BARRIER_TIMEOUT_MS`     | 2000  | currentTabId detection (v8)       |
| `BC_VERIFICATION_TIMEOUT_MS`          | 1000  | Sidebar BC verification (v8)      |
| `STORAGE_PROBE_TIMEOUT_MS`            | 500   | Storage health probe (v8)         |
| `FALLBACK_HEALTH_INTERVAL_MS`         | 30000 | Sidebar fallback status (v8)      |
| `KEEPALIVE_HEALTH_REPORT_INTERVAL_MS` | 60000 | Keepalive health reports (v8)     |
| `RECOVERY_KEEP_PERCENTAGE`            | 0.75  | Storage recovery threshold (v8)   |
| `STATE_MACHINE_TIMEOUT_MS`            | 7000  | Auto-recovery timeout (v11)       |
| `DEDUP_MAP_MAX_SIZE`                  | 1000  | LRU eviction threshold (v11)      |
| `STORAGE_WATCHDOG_TIMEOUT_MS`         | 2000  | Watchdog timer for writes (v10)   |
| `KEEPALIVE_INTERVAL_MS`               | 20000 | Unified keepalive (v9)            |
| `PORT_MAX_AGE_MS`                     | 90000 | Port registry max age (v9)        |

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
Authority, coordinated clear, closeAll mutex, **v1.6.3.8:** init barriers,
centralized storage validation, dedup decision logging, BC fallback detection,
storage tier probing, BFCache handling, keepalive health reports,
**v1.6.3.7-v12:** DEBUG_DIAGNOSTICS, keepalive sampling, port thresholds,
**v1.6.3.7-v11:** promise barrier, LRU eviction, correlation echo, state machine
timeouts, **v1.6.3.7-v10:** storage watchdog, BC gap detection, IndexedDB
checksum, **v1.6.3.7-v9:** unified keepalive, port message queue,
**v1.6.3.7-v4:** circuit breaker.

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
| `background.js`              | Init barrier (v8), dedup logging (v8), keepalive health (v8)         |
| `quick-tabs-manager.js`      | Fallback health monitoring (v8), Promise barrier (v11)               |
| `QuickTabHandler.js`         | Init barrier timeout (v8), storage validation (v8), Code Health 9.41 |
| `index.js` (quick-tabs)      | currentTabId barrier (v8), BFCache handling (v8)                     |
| `BroadcastChannelManager.js` | BC verification (v8), fallback detection (v8)                        |
| `storage-utils.js`           | Centralized validation (v8), checksum (v10), integrity (v9)          |
| `TabStateManager.js`         | Per-tab state (sessions API, v3)                                     |
| `StorageCache.js`            | Hybrid read-through caching (v8)                                     |
| `MemoryMonitor.js`           | Heap usage tracking (v8)                                             |

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
