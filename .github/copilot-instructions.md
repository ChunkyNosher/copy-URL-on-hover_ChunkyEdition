# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7-v6  
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

**v1.6.3.7-v6 Features (NEW):**

- **Initial State Load Wait** - 2-second wait before rendering empty state
- **Unified Message Channel Logging** - `[BC]`, `[PORT]`, `[STORAGE]` prefixes
- **Deduplication Decision Visibility** - `RENDER_SKIPPED reason=...` logging
- **Connection State Enhancements** - Duration tracking, fallback status logging
- **Clear All Tracing** - Correlation ID for `CLEAR_ALL_COMMAND_INITIATED`
- **Keepalive Health Monitoring** - 60s health check, consecutive failure tracking
- **Port Registry Lifecycle** - `PORT_REGISTERED`, `PORT_UNREGISTERED` logging
- **Storage Write Lifecycle** - `STORAGE_WRITE_ATTEMPT`, `_RETRY`, `_SUCCESS`
- **Adoption Lifecycle** - `ADOPTION_STARTED`, `_COMPLETED`, `_FAILED` logging

**v1.6.3.7-v5 Features (Retained):**

- **Connection State Tracking** - Three states: connected → zombie → disconnected
- **Zombie Detection** - 5s heartbeat timeout triggers BroadcastChannel fallback
- **Listener Deduplication** - `lastProcessedSaveId` prevents duplicate renders
- **Session Cache Validation** - `_initializeSessionId()` rejects cross-session

**v1.6.3.7-v4 Features (Retained):**

- **Circuit Breaker Probing** - Early recovery with 500ms health probes during
  open state (`_probeBackgroundHealth()`, `_startCircuitBreakerProbes()`)
- **Close All Feedback** - `_showCloseAllErrorNotification()` for user-facing
  errors when background returns failure
- **Message Error Handling** - `handlePortMessage()` wrapped in try-catch with
  graceful degradation
- **Listener Verification** - `_verifyPortListenerRegistration()` sends test
  message after connection
- **Refactored Message Handling** - Extracted `_logPortMessageReceived()`,
  `_routePortMessage()`, `_handleQuickTabStateUpdate()` (complexity 10→4)
- **Storage Polling Backup** - Increased from 2s to 10s (BroadcastChannel is now
  PRIMARY for instant updates)

**v1.6.3.7-v3 Features (Retained):**

- **storage.session API** - Session-scoped Quick Tabs (`permanent: false`)
- **BroadcastChannel API** - Real-time messaging (`quick-tabs-updates` channel)
- **sessions API** - Per-tab state management (TabStateManager.js)
- **browser.alarms API** - Scheduled tasks (`cleanup-orphaned`,
  `sync-session-state`, `diagnostic-snapshot`)
- **tabs.group() API** - Tab grouping (Firefox 138+, QuickTabGroupManager.js)
- **notifications API** - System notifications (NotificationManager.js)
- **DOM Reconciliation** - Sidebar animation optimization with `_itemElements`
  Map

**v1.6.3.7-v2 Features (Retained):**

- **Single Writer Authority** - Manager sends commands (ADOPT_TAB,
  CLOSE_MINIMIZED_TABS) to background
- **Unified Render Pipeline** - `scheduleRender(source)` with hash-based
  deduplication
- **Orphaned Tab Recovery** - Hydration keeps orphaned tabs with
  `orphaned: true` flag
- **Storage Write Verification** - `writeStateWithVerificationAndRetry()` with
  read-back confirmation

**v1.6.3.7-v1 Features (Retained):**

- **Background Keepalive** - `_startKeepalive()` resets Firefox 30s idle timer
  every 20s
- **Port Circuit Breaker** - closed→open→half-open with exponential backoff
  (100ms→10s)
- **UI Performance** - Debounced `renderUI()` (300ms), differential storage
  updates
- **originTabId Validation** - `_isValidOriginTabId()` validates positive
  integers

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

### v1.6.3.7-v6: Enhanced Observability + Lifecycle Logging

**State Load:** 2s wait before empty state, `STATE_LOAD_STARTED/COMPLETED` logging.

**Channel Logging:** `[BC]`, `[PORT]`, `[STORAGE]` prefixes. Channel-aware dedup.

**Dedup Visibility:** `RENDER_SKIPPED reason=...`, `DEDUP_CHECK/RESULT` logging.

**Lifecycle Tracing:**
- **Clear All:** `CLEAR_ALL_COMMAND_INITIATED/RESPONSE` with correlation ID
- **Keepalive:** 60s health check, `KEEPALIVE_HEALTH_WARNING` at 90s
- **Port Registry:** `PORT_REGISTERED/UNREGISTERED`, size warnings at 50/100+
- **Storage Write:** `STORAGE_WRITE_ATTEMPT/RETRY/SUCCESS/FINAL_FAILURE`
- **Adoption:** `ADOPTION_STARTED/COMPLETED/FAILED` with correlation ID

### v1.6.3.7-v5: Connection State Tracking + Deduplication (Retained)

### v1.6.3.7-v4: Circuit Breaker Probing + Message Handling (Retained)

**Circuit Breaker Probing:** Early recovery with health probes during open state.
`CIRCUIT_BREAKER_OPEN_DURATION_MS` reduced 10000→2000ms, `CIRCUIT_BREAKER_PROBE_INTERVAL_MS` = 500ms.
If `_probeBackgroundHealth()` succeeds → immediate half-open → reconnect.

**Close All Feedback:** `_showCloseAllErrorNotification()` on background failure.

**Message Error Handling:** `handlePortMessage()` wrapped in try-catch with graceful degradation.

**Listener Verification:** `_verifyPortListenerRegistration()` sends test message after connection.

**Refactored Message Handling:** Extracted `_logPortMessageReceived()`, `_routePortMessage()`,
`_handleQuickTabStateUpdate()` (complexity 10→4).

**Storage Polling Backup:** Increased 2s→10s (BroadcastChannel is PRIMARY).

### v1.6.3.7-v3: BroadcastChannel + Storage Routing (Retained)

**BroadcastChannel:** `new BroadcastChannel('quick-tabs-updates')` for real-time sync

**Storage Routing:** Session (`permanent: false` → storage.session), Permanent (→ storage.local)

**Alarms:** `cleanup-orphaned` (60min), `sync-session-state` (5min), `diagnostic-snapshot` (120min)

**DOM Reconciliation:** `_itemElements` Map for differential updates

**Message Protocol:** `{ type, action, correlationId, source, timestamp, payload, metadata }`

**Port Registry:** `{ portId -> { port, origin, tabId, type, connectedAt, lastMessageAt } }`

**Event Flow:** Port → Background writes storage → storage.onChanged + BroadcastChannel → `scheduleRender()` → renderUI

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

## 🆕 v1.6.3.7-v6 Patterns

- **Initial State Load Wait** - 2s wait before empty state render
- **Message Channel Logging** - `[BC]`, `[PORT]`, `[STORAGE]` prefixes
- **Deduplication Visibility** - `RENDER_SKIPPED reason=...` logging
- **Keepalive Health** - 60s health check with `KEEPALIVE_HEALTH_WARNING`
- **Port Registry Lifecycle** - `PORT_REGISTERED`, `PORT_UNREGISTERED`
- **Storage Write Lifecycle** - `STORAGE_WRITE_ATTEMPT/RETRY/SUCCESS`
- **Adoption Lifecycle** - `ADOPTION_STARTED/COMPLETED/FAILED`

## 🆕 v1.6.3.7-v5 Patterns (Retained)

- **Connection States** - `connectionState`: connected/zombie/disconnected
- **Zombie Detection** - 5s heartbeat timeout triggers BroadcastChannel fallback
- **Listener Deduplication** - `lastProcessedSaveId` comparison

## 🆕 v1.6.3.7-v4 Patterns (Retained)

- **Circuit Breaker** - `_probeBackgroundHealth()`, `CIRCUIT_BREAKER_OPEN_DURATION_MS`=2000ms
- **Close All Feedback** - `_showCloseAllErrorNotification()` on failure
- **Listener Verification** - `_verifyPortListenerRegistration()` with test message
- **Refactored Handlers** - `_routePortMessage()`, `_handleQuickTabStateUpdate()` (complexity 10→4)

## 🆕 v1.6.3.7-v3 Patterns (Retained)

- **storage.session** - `SESSION_STATE_KEY`, `permanent: false` for session Quick Tabs
- **BroadcastChannel** - `quick-tabs-updates` channel
- **browser.alarms** - `cleanup-orphaned`, `sync-session-state`, `diagnostic-snapshot`
- **DOM Reconciliation** - `_itemElements` Map for differential updates

### v1.6.3.7-v2 Patterns (Retained)

- **Single Writer Authority** - Manager sends commands to background
- **Unified Render Pipeline** - `scheduleRender(source)`, hash-based deduplication
- **Orphaned Tab Recovery** - `orphaned: true` flag, `ADOPT_TAB` commands

### v1.6.3.7-v1 Patterns (Retained)

- **Background Keepalive** - `_startKeepalive()` every 20s
- **Port Circuit Breaker** - closed→open→half-open with exponential backoff (100ms→10s)

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
connection state tracking (v5), enhanced observability (v6).

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
| `background.js`          | Port registry, keepalive, alarms, lifecycle logging (v6)     |
| `quick-tabs-manager.js`  | `scheduleRender()`, channel logging, dedup visibility (v6)   |
| `storage-utils.js`       | `writeStateWithVerificationAndRetry()`, write lifecycle (v6) |
| `TabStateManager.js`     | Per-tab state (sessions API, v3)                             |
| `BroadcastChannelManager.js` | Real-time messaging (v3)                                 |

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
