# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v4  
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

**v1.6.3.8-v4 Features (NEW) - 9 Critical Sync Fixes:**

- **Issue #5:** Promise-based initialization barrier with 10s timeout
- **Issue #4:** Exponential backoff retry for storage listener verification (1s, 2s, 4s)
- **Issue #1:** Sequential barrier blocking for hydration race fix
- **Issue #2:** Listener registration guard for port message queue
- **Issue #3:** Visibility change listener + periodic state refresh (15s)
- **Issue #6:** Port-based hydration before storage fallback
- **Issue #7:** Proactive dedup cleanup at 50%, sliding window eviction at 95%
- **Issue #8:** Probe queuing with min interval (500ms) and force-reset (1s)
- **Issue #9:** Enforcing initialization guard with message queuing
- **New sidebar modules:** `sidebar/modules/` (init-barrier, state-sync, diagnostics, health-metrics)

**v1.6.3.8-v3 Features (Retained):** Storage listener verification, tier hysteresis,
BC confidence levels, concurrent probe guard.

**v1.6.3.8-v2 Features (Retained):** Background Relay, ACK-based messaging,
SIDEBAR_READY handshake, BFCache lifecycle, WriteBuffer (75ms), port snapshots.

**v1.6.3.8 Features (Retained):** Init barriers (10s/2s), storage validation,
dedup logging. Code Health: background.js (9.09), QuickTabHandler.js (9.41).

**Legacy Features:** DEBUG_DIAGNOSTICS, LRU eviction (1000), state machine
timeouts (7s), circuit breaker probing, Single Writer Authority.

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

### v1.6.3.8-v4: Sidebar Sync Fixes (NEW)

- **initializationBarrier Promise** - All async tasks complete before listeners
- **`_hydrateStateFromBackground()`** - Port-based hydration before storage
- **`document.visibilitychange`** - State refresh when sidebar becomes visible
- **`_scheduleStateFreshnessCheck()`** - 15s periodic freshness check
- **`sendPortMessageWithTimeout()`** - Listener registration guard
- **Proactive dedup cleanup** - 50% threshold with sliding window at 95%
- **Probe queuing** - `_queueProbe()` with min interval (500ms) and force-reset

### v1.6.3.8-v2/v3: Communication Layer (Retained)

- Background Relay, ACK-based messaging, SIDEBAR_READY handshake
- BFCache lifecycle, port snapshots (60s), WriteBuffer (75ms)
- Storage listener verification, tier hysteresis, BC confidence

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

## 🆕 v1.6.3.8-v4 Patterns

- **initializationBarrier Promise** - Single barrier blocking ALL async init
- **Storage verification retry** - Exponential backoff [1s, 2s, 4s]
- **Port-based hydration** - `_hydrateStateFromBackground()` before storage
- **Visibility change listener** - `document.visibilitychange` → state refresh
- **State freshness check** - 15s periodic via `_scheduleStateFreshnessCheck()`
- **Listener registration guard** - `sendPortMessageWithTimeout()` with queue
- **Proactive dedup cleanup** - 50% threshold, sliding window eviction at 95%
- **Probe queuing** - Min interval 500ms, force-reset 1000ms
- **Pre-init message queue** - `_queueMessageDuringInit()` with replay

### New Sidebar Modules (`sidebar/modules/`)

| Module              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `init-barrier.js`   | Initialization barrier logic, CONNECTION_STATE |
| `state-sync.js`     | Port/storage sync, SaveId dedup, sequence IDs  |
| `diagnostics.js`    | Logging utilities, correlation IDs             |
| `health-metrics.js` | Storage/fallback health, dedup map monitoring  |
| `index.js`          | Re-exports for convenient importing            |

## v1.6.3.8-v3 Patterns (Retained)

- Storage listener verification, tier hysteresis, BC confidence scoring
- Concurrent probe guard, map cleanup on unload, fallback stats reset

## v1.6.3.8-v2 Patterns (Retained)

- Background Relay, ACK-based messaging, SIDEBAR_READY handshake
- BFCache lifecycle, port snapshots (60s), WriteBuffer (75ms)

## v1.6.3.8 Patterns (Retained)

- Init barriers (10s/2s), storage validation, dedup logging, BC fallback
- Keepalive health reports (60s), port activity logging

## Prior Patterns (v1-v12)

- DEBUG_DIAGNOSTICS, LRU eviction (1000), state machine timeouts (7s)
- Circuit breaker probing (500ms), storage watchdog, unified keepalive (20s)

### Key Timing Constants (v1.6.3.8-v4)

| Constant                              | Value | Purpose                              |
| ------------------------------------- | ----- | ------------------------------------ |
| `INIT_BARRIER_TIMEOUT_MS`             | 10000 | Initialization barrier timeout (v8-v4) |
| `STORAGE_VERIFICATION_RETRY_MS`       | [1s,2s,4s] | Exponential backoff (v8-v4)      |
| `VISIBILITY_REFRESH_INTERVAL_MS`      | 15000 | State freshness check (v8-v4)        |
| `DEDUP_CLEANUP_THRESHOLD`             | 0.5   | Proactive cleanup at 50% (v8-v4)     |
| `DEDUP_EVICTION_THRESHOLD`            | 0.95  | Sliding window eviction (v8-v4)      |
| `PROBE_MIN_INTERVAL_MS`               | 500   | Min probe interval (v8-v4)           |
| `PROBE_FORCE_RESET_MS`                | 1000  | Force-reset stuck probe (v8-v4)      |
| `HANDLER_TIMEOUT_MS`                  | 5000  | Handler execution timeout (v8-v2)    |
| `WRITE_BUFFER_FLUSH_MS`               | 75    | WriteBuffer batch window (v8-v2)     |
| `STATE_MACHINE_TIMEOUT_MS`            | 7000  | Auto-recovery timeout (v11)          |
| `DEDUP_MAP_MAX_SIZE`                  | 1000  | LRU eviction threshold (v11)         |
| `KEEPALIVE_INTERVAL_MS`               | 20000 | Unified keepalive (v9)               |

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
Authority, coordinated clear, closeAll mutex, **v1.6.3.8-v4:** initializationBarrier
Promise, port-based hydration, visibility change listener, proactive dedup cleanup,
probe queuing, **v1.6.3.8-v2/v3:** Background Relay, WriteBuffer, tier hysteresis,
**v1.6.3.7-v11-v12:** DEBUG_DIAGNOSTICS, LRU eviction.

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
| `quick-tabs-manager.js`      | 9 sync fixes (v8-v4), initializationBarrier, port hydration          |
| `sidebar/modules/index.js`   | Re-exports init-barrier, state-sync, diagnostics, health-metrics     |
| `background.js`              | Background Relay (v8-v2), port snapshots, init barrier               |
| `QuickTabHandler.js`         | Handler timeout (v8-v2), init barrier (v8), Code Health 9.41         |
| `message-utils.js`           | ACK-based messaging (v8-v2), sendRequestWithTimeout()                |
| `BroadcastChannelManager.js` | BC relay fallback (v8-v2), verification                              |
| `storage-utils.js`           | WriteBuffer (v8-v2), sequence rejection, validation                  |

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
