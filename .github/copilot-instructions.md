# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.12-v8  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with sidebar Quick Tabs Manager

**Key Features:**

- **Option 4 Architecture** - Background script in-memory storage (SINGLE SOURCE
  OF TRUTH)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port Messaging** - `'quick-tabs-port'` for all Quick Tabs communication
- **Tab Isolation** - Filter by `originTabId` at hydration time
- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Ephemeral Storage** - Quick Tabs stored in-memory, NOT persisted to disk
- **Session-Only Quick Tabs** - Browser restart clears all Quick Tabs
  automatically

**v1.6.3.12-v8 Features (NEW) - Bulk Close + Circuit Breaker Auto-Reset:**

- **Bulk Close Operations** - `closeAllQuickTabsViaPort()`,
  `closeMinimizedQuickTabsViaPort()`
- **Circuit Breaker Auto-Reset** - 60-second timer
  (`QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS`)
- **Message Actions Allowlist** - Added EXPORT_LOGS, CLEAR_CONSOLE_LOGS,
  RESET_GLOBAL_QUICK_TAB_STATE
- **Settings Page Robustness** - `sendMessageWithTimeout()` with 5-second
  timeout protection
- **Listener Registration Guard** - `_messageListenerRegistered` prevents
  duplicate listeners
- **Code Health** - background.js: 9.09, quick-tabs-manager.js: 9.09,
  settings.js: 10.0

**v1.6.3.12-v7 Features - Message Routing Fixes + Code Health:**

- **VALID_MESSAGE_ACTIONS Fix** - Added EXPORT_LOGS,
  COORDINATED_CLEAR_ALL_QUICK_TABS
- **Manager Port Messaging** - Buttons use `closeQuickTabViaPort`,
  `minimizeQuickTabViaPort`
- **QUICKTAB_REMOVED Handler** - Background notifies Manager when Quick Tab
  closed from UI

**v1.6.3.12-v6 Features - Manager Sync + Port Resilience:**

- **storage.onChanged Fix** - Checks `'local'` area instead of `'session'` (MV2)
- **Close All Handler** - `CLOSE_ALL_QUICK_TABS` message type implemented
- **Defensive Port Handlers** - Input validation in all handlers
- **Sequence Tracking** - `_lastReceivedSequence` for FIFO ordering resilience
- **Port Circuit Breaker** - Max 10 reconnect attempts with exponential backoff

**v1.6.3.12-v5 Features - Circuit Breaker + Priority Queue:**

- **Circuit Breaker** - Trips after 5 failures, test write every 30s
- **Priority Queue** - QUEUE_PRIORITY enum (HIGH/MEDIUM/LOW) for writes
- **Timeout Backoff** - Progressive delays: 1s → 3s → 5s

**v1.6.3.12-v4:** storage.session Removal, Cache Staleness (30s/60s)  
**v1.6.3.12-v3:** Container ID Resolution, Manager Refresh, Test Bridge API  
**v1.6.3.12-v2:** QUICKTAB_MINIMIZED Handler, Port Roundtrip Tracking  
**v1.6.3.12:** Option 4 In-Memory Architecture, Port-Based Messaging  
**v1.6.3.11-v12:** Solo/Mute REMOVED, Version-Based Log Cleanup  
**v1.6.3.12-v7:** Message Routing Fixes, Code Health 10.0

**Core Modules:** QuickTabStateMachine, QuickTabMediator, TabStateManager,
MessageBuilder, StructuredLogger, MessageRouter

**Deprecated:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
`browser.storage.session` (REMOVED in v1.6.3.12-v4), `runtime.sendMessage` for
Quick Tabs sync (v1.6.3.12), Solo/Mute (v12)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

**Important:** When using context7, look up JavaScript/ES6/Web API
documentation, NOT "Quick Tabs" directly. context7 is for standard API
references.

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Option 4 Architecture (v1.6.3.12+)

**Background Script as SINGLE SOURCE OF TRUTH:**

```javascript
const quickTabsSessionState = {
  quickTabsByTab: {}, // { [tabId]: [quickTab, ...] }
  contentScriptPorts: {}, // { [tabId]: port }
  sidebarPort: null,
  sessionId: generateUUID(),
  sessionStartTime: Date.now()
};
```

**Port Messaging (`'quick-tabs-port'`):**

- **Content Script → Background:**
  - `CREATE_QUICK_TAB`, `MINIMIZE_QUICK_TAB`, `RESTORE_QUICK_TAB`
  - `DELETE_QUICK_TAB`, `QUERY_MY_QUICK_TABS`, `HYDRATE_ON_LOAD`
  - `UPDATE_QUICK_TAB`
- **Sidebar → Background:**
  - `GET_ALL_QUICK_TABS`, `SIDEBAR_READY`, `SIDEBAR_CLOSE_QUICK_TAB`
  - `SIDEBAR_MINIMIZE_QUICK_TAB`, `SIDEBAR_RESTORE_QUICK_TAB`
- **Background → Sidebar:** `STATE_CHANGED`, `QUICKTAB_MINIMIZED` (push
  notifications)

**Dual Architecture (Retained):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **Port handlers** - TYPE-based Quick Tabs routing via factory patterns

---

## 🆕 Version Patterns Summary

### v1.6.3.12-v8 Patterns (Current)

- **Bulk Close Operations** - `closeAllQuickTabsViaPort()`,
  `closeMinimizedQuickTabsViaPort()`
- **Circuit Breaker Auto-Reset** - 60-second timer resets tripped circuit
  breaker
- **Settings Timeout Protection** - `sendMessageWithTimeout()` with 5s timeout
- **Listener Guard** - `_messageListenerRegistered` prevents duplicate
  registration
- **Code Health** - settings.js: 10.0, MessageRouter.js: 10.0

### v1.6.3.12-v7 Patterns

- **VALID_MESSAGE_ACTIONS** - Complete allowlist (EXPORT_LOGS,
  COORDINATED_CLEAR_ALL_QUICK_TABS)
- **Port-Based Manager Buttons** - `closeQuickTabViaPort`,
  `minimizeQuickTabViaPort`, `restoreQuickTabViaPort`
- **QUICKTAB_REMOVED Handler** - Background notifies Manager when Quick Tab
  closed from UI

### v1.6.3.12-v6 Patterns

- **Sequence Tracking** - `_lastReceivedSequence` tracks message order
- **Port Circuit Breaker** - `_quickTabsPortCircuitBreakerTripped` flag
- **Defensive Handlers** - Input validation in all port message handlers
- **Close All Handler** - `CLOSE_ALL_QUICK_TABS` in background port handler

### v1.6.3.12-v5 Patterns

- **Circuit Breaker** - Trips after 5 failures, recovers via test write (30s)
- **Timeout Backoff** - Progressive delays: 1s → 3s → 5s
- **Priority Queue** - QUEUE_PRIORITY enum (HIGH/MEDIUM/LOW)
- **Rolling Heartbeat** - Window of 5 responses for retry decisions
- **Container Validation** - Unified `_validateContainerForOperation()` helper

### v1.6.3.12-v4 Patterns

- **storage.local Only** - `browser.storage.session` REMOVED
- **Startup Cleanup** - `_clearQuickTabsOnStartup()` for session-only behavior
- **Cache Staleness** - 30s warning, 60s auto-sync

### v1.6.3.12-v2 to v1.6.3.12 Patterns (Consolidated)

- **Option 4 Architecture** - Background script in-memory storage (v1.6.3.12)
- **Port Messaging** - `'quick-tabs-port'` replaces runtime.sendMessage
- **Container ID Resolution** - Identity system via `getWritingContainerId()`
  (v3)
- **Port Roundtrip Tracking** - `_quickTabPortOperationTimestamps` for ACK (v2)

### Previous Version Patterns (Consolidated)

- **v1.6.3.11-v12:** Solo/Mute REMOVED, version-based log cleanup
- **v1.6.3.11-v7:** Orphan Quick Tabs fix
- **v1.6.3.10:** tabs.sendMessage, storage.onChanged

### Key Timing Constants (v1.6.3.12-v8+)

| Constant                                        | Value | Purpose                            |
| ----------------------------------------------- | ----- | ---------------------------------- |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD`         | 5     | Failures before circuit trips      |
| `CIRCUIT_BREAKER_TEST_INTERVAL_MS`              | 30000 | Test write interval for recovery   |
| `QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS` | 60000 | Auto-reset circuit breaker (v8)    |
| `SETTINGS_MESSAGE_TIMEOUT_MS`                   | 5000  | Timeout for settings operations    |
| `POST_FAILURE_MIN_DELAY_MS`                     | 5000  | Delay after failure before dequeue |
| `TIMEOUT_BACKOFF_DELAYS`                        | Array | [1000, 3000, 5000]ms               |
| `QUEUE_PRIORITY.HIGH`                           | 1     | Highest priority writes            |
| `QUEUE_PRIORITY.MEDIUM`                         | 2     | Normal priority writes             |
| `QUEUE_PRIORITY.LOW`                            | 3     | Lowest priority writes             |
| `MESSAGE_TIMEOUT_MS`                            | 5000  | Message timeout                    |
| `CACHE_STALENESS_ALERT_MS`                      | 30000 | Warn if no sync for 30s            |
| `CACHE_STALENESS_EMERGENCY_MS`                  | 60000 | Auto-request sync after 60s        |
| `PORT_RECONNECT_MAX_ATTEMPTS`                   | 10    | Max port reconnection attempts     |

---

## Architecture Classes (Key Methods)

| Class                | Methods                                  |
| -------------------- | ---------------------------------------- |
| QuickTabStateMachine | `canTransition()`, `transition()`        |
| QuickTabMediator     | `minimize()`, `restore()`, `destroy()`   |
| TabStateManager      | `getTabState()`, `setTabState()`         |
| MessageRouter        | ACTION-based routing                     |
| EventBus             | `on()`, `off()`, `emit()`, `once()`      |
| StructuredLogger     | `debug()`, `info()`, `warn()`, `error()` |
| Manager              | `scheduleRender()`                       |
| CreateHandler        | `getWritingContainerId()` (v3)           |
| TestBridge           | `getManagerState()` (v3)                 |

---

## 🔧 Storage & State

**v1.6.3.12 In-Memory State:** Quick Tabs stored in background script memory
(not persisted to disk)

**State Object:** `quickTabsSessionState` with `quickTabsByTab`,
`contentScriptPorts`, `sidebarPort`, `sessionId`, `sessionStartTime`

**Key Exports:** `STATE_KEY`, `logStorageRead()`, `logStorageWrite()`,
`canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`

**Sync Mechanism:** Port messaging is PRIMARY; `storage.onChanged` with
`'local'` area is FALLBACK (Firefox MV2 has no `browser.storage.session`)

---

## 📝 Logging Prefixes

**v1.6.3.12-v8 (NEW):** `[CIRCUIT_BREAKER_AUTO_RESET_SCHEDULED]`
`[CIRCUIT_BREAKER_AUTO_RESET]` `[Settings][INIT]`

**v1.6.3.12-v7:** `[VALID_MESSAGE_ACTIONS]` `[QUICKTAB_REMOVED_HANDLER]`
`[PORT_BASED_MANAGER]`

**v1.6.3.12-v6:** `[PORT_RECONNECT_ATTEMPT]` `[PORT_CIRCUIT_BREAKER]`
`[SEQUENCE_TRACKING]` `[CLOSE_ALL_HANDLER]` `[TAB_CLOSED_NOTIFY]`
`[SIDEBAR_CLEANUP]` `[HEARTBEAT_RESTART]` `[MESSAGE_VALIDATION]`

**v1.6.3.12-v5:** `[CIRCUITBREAKER_TRIPPED]` `[CIRCUITBREAKER_RECOVERED]`
`[CIRCUITBREAKER_TEST_WRITE]` `[TIMEOUT_BACKOFF_APPLIED]` `[FALLBACK_ACTIVATED]`
`[FALLBACK_DEACTIVATED]` `[TIMEOUT_COUNTER_RESET]` `[STORAGE_RECOVERY]`
`[QUEUE_ENTRY_EVICTED]` `[HEARTBEAT_STATUS_CHECK]` `[Z_INDEX_PERSIST_FAILED]`
`[STORAGE_BACKEND_SWITCH]` `[EVENT_ORDERING_VIOLATION]`
`[FEATURE_AVAILABILITY_CHANGED]` `[QUICKTABREMOVED_HANDLER_ENTRY/EXIT]`
`[SELF_WRITE_CHECK]` `[PORT_HANDLER_ENTRY/EXIT]`

**v1.6.3.12-v4:** `[HYDRATION][*]` `[DEBOUNCE][*]` `[OWNERSHIP_FILTER][*]`
`[DRAG][*]` `[CACHE_STALENESS]`

**Previous:** `[SIDEBAR_PORT_LIFECYCLE]` `[STORAGE_ONCHANGED]`
`[STORAGE_HEALTH]` `[WRITE_QUEUE]` `[STATE_SYNC]` `[CORRELATION_ID]`
`[SCENARIO_LOG]` `[MSG_ROUTER]` `[MSG_HANDLER]` `[HYDRATION]`
`[QuickTabHandler]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, state
machine, ownership validation, Single Writer Authority, Shadow DOM traversal,
error telemetry, originTabId resolution, container isolation, z-index recycling,
port messaging, factory patterns, lookup tables, generic wrapper functions,
in-memory state, push notifications, port roundtrip tracking, circuit breaker,
priority queue, timeout backoff, rolling heartbeat window, sequence number
tracking, port reconnection circuit breaker, defensive input validation, circuit
breaker auto-reset, listener registration guards, message timeout protection.

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

**MCPs:** CodeScene (code health), Context7 (JavaScript API docs), Perplexity
(research)

**Context7 Usage:** Use for JavaScript, ES6, Web API, and browser extension API
documentation. Do NOT search for "Quick Tabs" - search for standard APIs like
"Map", "Promise", "storage.local", "tabs.sendMessage", etc.

**Testing:** `npm test` (Jest), `npm run lint` (ESLint), `npm run build`

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass

---

## 📋 Quick Reference

### Key Files

| File                              | Features                             |
| --------------------------------- | ------------------------------------ |
| `src/constants.js`                | Centralized constants                |
| `src/utils/shadow-dom.js`         | Shadow DOM link detection            |
| `src/utils/storage-utils.js`      | Storage utilities                    |
| `src/background/tab-events.js`    | Tabs API listeners                   |
| `src/utils/structured-logger.js`  | StructuredLogger class with contexts |
| `src/messaging/message-router.js` | ACTION-based routing                 |
| `background.js`                   | In-memory state, port handlers       |
| `sidebar/quick-tabs-manager.js`   | Port-based queries to background     |
| `src/content.js`                  | Port messaging for Quick Tabs        |

### Storage (v1.6.3.12-v8+)

**In-Memory State:** `quickTabsSessionState` in background.js  
**Persistence:** `browser.storage.local` with startup cleanup
(`_clearQuickTabsOnStartup()`)  
**Format:** `{ quickTabsByTab: {}, contentScriptPorts: {}, sidebarPort, sessionId, sessionStartTime }`
**Circuit Breaker:** Trips after 5 failures, test write every 30s, fallback mode
bypasses storage

**Note:** `browser.storage.session` COMPLETELY REMOVED - uses `storage.local` +
startup cleanup for session-only behavior.

### Port Messages (v1.6.3.12+)

**Content → Background:** `CREATE_QUICK_TAB`, `MINIMIZE_QUICK_TAB`,
`RESTORE_QUICK_TAB`, `DELETE_QUICK_TAB`, `QUERY_MY_QUICK_TABS`,
`HYDRATE_ON_LOAD`, `UPDATE_QUICK_TAB`

**Sidebar → Background:** `GET_ALL_QUICK_TABS`, `SIDEBAR_READY`,
`SIDEBAR_CLOSE_QUICK_TAB`, `SIDEBAR_MINIMIZE_QUICK_TAB`,
`SIDEBAR_RESTORE_QUICK_TAB`, `CLOSE_ALL_QUICK_TABS`,
`CLOSE_MINIMIZED_QUICK_TABS`

**Background → Sidebar:** `STATE_CHANGED`, `QUICKTAB_MINIMIZED`,
`ORIGIN_TAB_CLOSED`, `CLOSE_MINIMIZED_QUICK_TABS_ACK`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
