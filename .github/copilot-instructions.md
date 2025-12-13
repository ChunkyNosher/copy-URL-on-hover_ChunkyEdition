# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v7  
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

**v1.6.3.8-v7 Features (NEW) - Communication & Storage Fixes:**

- **Per-port sequence ID tracking** - Concurrent message ordering per port
- **Enhanced circuit breaker** - Time-based escalation
  (HEALTHY→DEGRADED→CRITICAL→DISCONNECTED)
- **CorrelationId tracing** - End-to-end state change tracking
- **Client-side timestamp** - Rapid operations ordering
- **Adaptive quota monitoring** - 1-min when >50%, 5-min otherwise
- **Storage quota aggregation** - Across local, sync, session areas
- **Early storage.onChanged** - 1-second fallback registration
- **Content script unload** - pagehide/beforeunload → CONTENT_SCRIPT_UNLOAD
- **Iframe port tracking** - Frame ID-based port management
- **Queue TTL (60s)** - Dead port message flood prevention
- **Max event age (5-min)** - Stale event enforcement
- **Port registry rotation** - 24h diagnostic data cleanup

**v1.6.3.8-v6 Features (Retained):** Storage quota monitoring, MessageBatcher
queue limits (100), TTL pruning (30s), port reconnection backoff, checksum
validation, BroadcastChannelManager.js DELETED.

**v1.6.3.8-v5 Features (Retained):** Monotonic revision versioning, port failure
counting, storage quota recovery (75%→50%→25%), URL validation.

**v1.6.3.8-v4 Features (Retained):** Initialization barrier (10s), port-based
hydration, visibility change listener, proactive dedup cleanup, sidebar modules.

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

### v1.6.3.8-v7: Port + Storage Architecture (PRODUCTION)

**Two-layer architecture (NO BroadcastChannel):**

- **Layer 1:** runtime.Port for real-time metadata sync (position, minimized,
  active)
- **Layer 2:** storage.local with monotonic revision versioning +
  storage.onChanged fallback

**Key Changes (v7):**

- **Per-port sequence IDs** - Concurrent message ordering per port connection
- **Circuit breaker escalation** - HEALTHY→DEGRADED→CRITICAL→DISCONNECTED states
- **CorrelationId tracing** - End-to-end state change tracking
- **Adaptive quota monitoring** - 1-min at >50% usage, 5-min otherwise
- **Storage aggregation** - Quota across local, sync, session areas
- **Iframe frame ID tracking** - Port management by frame ID
- **Queue TTL (60s)** - Dead port message flood prevention
- **Max event age (5-min)** - Stale state change rejection
- **Port registry cleanup** - 24h diagnostic data rotation

### v1.6.3.8-v4: Sidebar Sync Fixes (Retained)

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

## 🆕 v1.6.3.8-v7 Patterns

- **Per-port sequence IDs** - Concurrent message ordering per port
- **Circuit breaker escalation** - HEALTHY→DEGRADED→CRITICAL→DISCONNECTED
- **CorrelationId tracing** - End-to-end state change tracking
- **Adaptive quota monitoring** - 1-min at >50%, 5-min otherwise
- **Storage aggregation** - Quota across all storage areas
- **Iframe frame ID tracking** - Port management by frame ID
- **Queue TTL (60s)** - Dead port message flood prevention
- **Max event age (5-min)** - Stale state change rejection
- **Content script unload** - CONTENT_SCRIPT_UNLOAD on pagehide/beforeunload

### New Sidebar Modules (`sidebar/modules/`)

| Module              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `init-barrier.js`   | Initialization barrier logic, CONNECTION_STATE |
| `state-sync.js`     | Port/storage sync, SaveId dedup, sequence IDs  |
| `diagnostics.js`    | Logging utilities, correlation IDs             |
| `health-metrics.js` | Storage/fallback health, dedup map monitoring  |
| `index.js`          | Re-exports for convenient importing            |

### Test Helpers (v1.6.3.8-v7)

| Helper                             | Purpose                              |
| ---------------------------------- | ------------------------------------ |
| `tests/helpers/manager-factory.js` | Manager instance creation for tests  |
| `tests/helpers/port-simulator.js`  | Port connection simulation           |
| `tests/helpers/storage-test-helper.js` | Storage operations mock          |
| `tests/helpers/cross-tab-simulator.js` | Cross-tab sync simulation        |
| `tests/helpers/state-machine-utils.js` | State machine test utilities     |
| `tests/helpers/coordinator-utils.js` | Background coordinator helpers     |
| `tests/e2e/helpers/multi-tab-fixture.js` | Multi-tab E2E fixtures         |
| `tests/e2e/helpers/assertion-helpers.js` | E2E assertion utilities        |

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

### Key Timing Constants (v1.6.3.8-v7)

| Constant                          | Value    | Purpose                              |
| --------------------------------- | -------- | ------------------------------------ |
| `PORT_CIRCUIT_STATES`             | 4 states | HEALTHY, DEGRADED, CRITICAL, DISCONNECTED |
| `PORT_CIRCUIT_BREAKER_WINDOW_MS`  | 5000     | Circuit breaker evaluation window    |
| `PORT_CIRCUIT_BREAKER_MAX_DURATION_MS` | 10000 | Max circuit breaker duration       |
| `DEAD_PORT_MESSAGE_TTL_MS`        | 60000    | Dead port message TTL                |
| `MAX_STATE_CHANGE_AGE_MS`         | 300000   | Max event age (5 min)                |
| `MAX_MESSAGE_COUNT_TRACKED`       | 999999   | Sequence ID max before reset         |
| `PORT_IDLE_CLEANUP_MS`            | 86400000 | Port registry cleanup (24h)          |
| `PORT_FAILURE_THRESHOLD`          | 3        | Consecutive failures before cleanup  |
| `MAX_QUEUE_SIZE`                  | 100      | MessageBatcher queue limit           |
| `MAX_MESSAGE_AGE_MS`              | 30000    | TTL for message pruning              |
| `INIT_BARRIER_TIMEOUT_MS`         | 10000    | Initialization barrier timeout       |
| `WRITE_BUFFER_FLUSH_MS`           | 75       | WriteBuffer batch window             |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                            |
| --------------------- | -------------------------------------------------- |
| QuickTabStateMachine  | `canTransition()`, `transition()`                  |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`             |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`        |
| TabStateManager (v3)  | `getTabState()`, `setTabState()`                   |
| Manager               | `scheduleRender()`, `_transitionConnectionState()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, coordinated clear, closeAll mutex, **v1.6.3.8-v7:** per-port sequence
IDs, circuit breaker escalation, correlationId tracing, adaptive quota
monitoring, **v1.6.3.8-v6:** MessageBatcher limits, checksum validation,
**v1.6.3.8-v5:** monotonic revision versioning, port failure counting,
**v1.6.3.8-v4:** initializationBarrier Promise, port-based hydration.

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
