# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.8-v5  
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

**v1.6.3.8-v5 Features (NEW) - Architecture Redesign:**

- **BroadcastChannel REMOVED** - Port + storage.local replaces BC entirely
- **Issue #1:** Monotonic revision versioning for storage event ordering
- **Issue #2:** BC origin isolation solved by removal (Port-based messaging only)
- **Issue #3:** Port disconnection - consecutive failure tracking, cleanup after 3 failures
- **Issue #4:** Storage quota recovery - iterative (75%→50%→25%), exponential backoff
- **Issue #5:** declarativeNetRequest with webRequest fallback for header modification
- **Issue #6:** Alarm initialization guards for proper ordering
- **Issue #7:** Robust URL validation with URL constructor, block dangerous protocols

**v1.6.3.8-v4 Features (Retained):** Initialization barrier (10s), exponential
backoff retry, port-based hydration, visibility change listener, proactive dedup
cleanup, probe queuing, sidebar modules.

**v1.6.3.8-v2/v3 Features (Retained):** ACK-based messaging, SIDEBAR_READY
handshake, BFCache lifecycle, WriteBuffer (75ms), port snapshots.

**Legacy Features:** DEBUG_DIAGNOSTICS, LRU eviction (1000), state machine
timeouts (7s), circuit breaker probing, Single Writer Authority.

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager

**Deprecated:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`,
`updateQuickTabSize()`, `BroadcastChannelManager` (REMOVED in v5)

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

### v1.6.3.8-v5: Port + Storage Architecture (NEW)

**BroadcastChannel REMOVED** - New two-layer architecture:

- **Layer 1a:** runtime.Port for real-time metadata sync (position, minimized, active)
- **Layer 1b:** storage.local with monotonic revision versioning for persistent state
- **Layer 2:** Robust fallback with state versioning via storage.onChanged

**Key Changes:**

- **Monotonic revision numbers** - `revisionId` increments on every state change
- **Event buffering** - Out-of-order storage events queued and replayed
- **Port failure counting** - 3 consecutive failures triggers cleanup
- **Storage quota recovery** - Iterative 75%→50%→25%, exponential backoff
- **declarativeNetRequest** - Feature detection with webRequest fallback
- **URL validation** - URL constructor, block javascript:, data:, vbscript: protocols

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

## 🆕 v1.6.3.8-v5 Patterns

- **Port-based messaging PRIMARY** - No BroadcastChannel, Port + storage.local only
- **Monotonic revision versioning** - `revisionId` for storage event ordering
- **Event buffering** - Queue out-of-order events for replay
- **Port failure counting** - 3 consecutive failures triggers reconnect/cleanup
- **Storage quota recovery** - Iterative 75%→50%→25% with exponential backoff
- **declarativeNetRequest** - Feature detection with webRequest fallback
- **URL validation** - Block javascript:, data:, vbscript: protocols

### New Sidebar Modules (`sidebar/modules/`)

| Module              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `init-barrier.js`   | Initialization barrier logic, CONNECTION_STATE |
| `state-sync.js`     | Port/storage sync, SaveId dedup, sequence IDs  |
| `diagnostics.js`    | Logging utilities, correlation IDs             |
| `health-metrics.js` | Storage/fallback health, dedup map monitoring  |
| `index.js`          | Re-exports for convenient importing            |

## v1.6.3.8-v4 Patterns (Retained)

- initializationBarrier Promise, port-based hydration, visibility change listener
- Proactive dedup cleanup (50%), sliding window eviction (95%), probe queuing

## v1.6.3.8-v2/v3 Patterns (Retained)

- ACK-based messaging, SIDEBAR_READY handshake
- BFCache lifecycle, port snapshots (60s), WriteBuffer (75ms)

### Key Timing Constants (v1.6.3.8-v5)

| Constant                         | Value     | Purpose                                |
| -------------------------------- | --------- | -------------------------------------- |
| `PORT_FAILURE_THRESHOLD`         | 3         | Consecutive failures before cleanup    |
| `STORAGE_QUOTA_RECOVERY`         | 75/50/25% | Iterative quota recovery thresholds    |
| `INIT_BARRIER_TIMEOUT_MS`        | 10000     | Initialization barrier timeout         |
| `HANDLER_TIMEOUT_MS`             | 5000      | Handler execution timeout              |
| `WRITE_BUFFER_FLUSH_MS`          | 75        | WriteBuffer batch window               |
| `KEEPALIVE_INTERVAL_MS`          | 20000     | Unified keepalive                      |

---

## Architecture Classes (Key Methods)

| Class                   | Methods                                            |
| ----------------------- | -------------------------------------------------- |
| QuickTabStateMachine    | `canTransition()`, `transition()`                  |
| QuickTabMediator        | `minimize()`, `restore()`, `destroy()`             |
| MapTransactionManager   | `beginTransaction()`, `commitTransaction()`        |
| TabStateManager (v3)    | `getTabState()`, `setTabState()`                   |
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
Authority, coordinated clear, closeAll mutex, **v1.6.3.8-v5:** monotonic revision
versioning, port failure counting, storage quota recovery, declarativeNetRequest
fallback, URL validation, **v1.6.3.8-v4:** initializationBarrier Promise,
port-based hydration, visibility change listener, proactive dedup cleanup.

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

| File                         | Features                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `quick-tabs-manager.js`      | Port-based sync (v8-v5), initializationBarrier, port hydration  |
| `sidebar/modules/index.js`   | Re-exports init-barrier, state-sync, diagnostics, health-metrics|
| `background.js`              | Port registry, storage versioning, declarativeNetRequest        |
| `QuickTabHandler.js`         | Handler timeout, init barrier, Code Health 9.41                 |
| `message-utils.js`           | ACK-based messaging, sendRequestWithTimeout()                   |
| `storage-utils.js`           | WriteBuffer, sequence rejection, quota recovery                 |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session, v3)  
**Format:** `{ tabs: [...], saveId, timestamp, writingTabId, revisionId }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`,
`BROADCAST`, `REQUEST_FULL_STATE_SYNC`, `ADOPT_TAB`, `CLOSE_MINIMIZED_TABS`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
