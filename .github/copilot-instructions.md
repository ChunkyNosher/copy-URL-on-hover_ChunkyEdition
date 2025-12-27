# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.12-v5  
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

**v1.6.3.12-v5 Features (NEW) - Circuit Breaker + Priority Queue:**

- **Circuit Breaker Pattern** - Trips after 5 consecutive failed transactions
- **Timeout Backoff** - Progressive delays: 1s → 3s → 5s
- **Post-Failure Delay** - 5s delay before next queue dequeue
- **Fallback Mode** - Bypasses storage writes when circuit trips
- **Test Write Recovery** - Every 30s probe for recovery detection
- **Priority Queue** - QUEUE_PRIORITY enum (HIGH/MEDIUM/LOW) for writes
- **Atomic Z-Index** - `saveZIndexCounterWithAck()` for persistence
- **Rolling Heartbeat** - Window of 5 responses for retry decisions
- **Storage Backend Tracking** - `currentStorageBackend` state tracking
- **Error Type Discrimination** - API unavailable vs quota vs transient
- **Unified Container Validation** - `_validateContainerForOperation()` helper

**v1.6.3.12-v4 Features - storage.session Removal + Cache Staleness:**

- **storage.session API Removal** - All `browser.storage.session` calls replaced
  with `browser.storage.local` for Firefox MV2 compatibility
- **Startup Cleanup** - `_clearQuickTabsOnStartup()` simulates session-only
  behavior
- **Cache Staleness Detection** - 30s warning, 60s auto-sync
- **Code Health** - SyncStorageAdapter refactored to 10.0

**v1.6.3.12-v3 Features - Critical Bug Fixes + Logging Gaps:**

- **Container ID Resolution** - CreateHandler queries Identity system via
  `getWritingContainerId()` at creation time (not stale constructor values)
- **Context Detection Fix** - `setWritingTabId()` receives proper context
- **Manager Refresh Fix** - UICoordinator notifies sidebar via STATE_CHANGED
- **Logging Gaps #1-8** - Port lifecycle, storage.onChanged, correlation IDs,
  health monitoring, write queue, debounce timing, end-to-end sync
- **Test Bridge API** - `getManagerState()`, `verifyContainerIsolationById()`
- **Code Health** - background.js 9.09, quick-tabs-manager.js 9.09, index.js
  10.0

**v1.6.3.12-v2 Features - Port Diagnostics:**

- **QUICKTAB_MINIMIZED Handler** - Forwards minimize/restore events to sidebar
- **Port Roundtrip Tracking** - `_quickTabPortOperationTimestamps` for ACK
  timing

**v1.6.3.12 Features - Option 4 In-Memory Architecture:**

- **Background Script Memory** - Quick Tabs stored in `quickTabsSessionState`
- **Port-Based Messaging** - All Quick Tabs use `runtime.connect()` ports
- **browser.storage.local Only** - Uses `storage.local` + startup cleanup (MV2)

**v1.6.3.11-v12 Features:** Solo/Mute REMOVED, Version-Based Log Cleanup

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

### v1.6.3.12-v5 Patterns (Current)

- **Circuit Breaker** - Trips after 5 failed transactions, recovers via test
  write every 30s
- **Timeout Backoff** - Progressive delays: 1s → 3s → 5s via
  `TIMEOUT_BACKOFF_DELAYS`
- **Post-Failure Delay** - 5s (`POST_FAILURE_MIN_DELAY_MS`) before next dequeue
- **Priority Queue** - `QUEUE_PRIORITY` enum for write ordering (HIGH > MEDIUM >
  LOW)
- **Atomic Z-Index** - `saveZIndexCounterWithAck()` persists with ACK
  confirmation
- **Rolling Heartbeat** - Window of 5 responses for retry decisions
- **Error Discrimination** - API unavailable vs quota exceeded vs transient
  errors
- **Storage Backend State** - `currentStorageBackend` tracks active storage API
- **Container Validation** - Unified `_validateContainerForOperation()` helper

### v1.6.3.12-v4 Patterns

- **storage.local Only** - `browser.storage.session` REMOVED, uses
  `storage.local`
- **Startup Cleanup** - `_clearQuickTabsOnStartup()` simulates session-only
  behavior
- **Port Disconnect lastError** - Capture immediately on first line of handler
- **Cache Staleness** - 30s warning, 60s auto-sync via
  `setInterval(checkCacheStaleness, 10000)`
- **Correlation ID FIFO** - Full propagation with documented FIFO ordering
  assumption
- **SyncStorageAdapter 10.0** - Refactored from 8.91 to 10.0 Code Health

### v1.6.3.12-v3 Patterns

- **Container ID Resolution** - Identity system via `getWritingContainerId()` at
  creation
- **Context Detection** - Proper `TAB_ID_CALLER_CONTEXT.CONTENT_SCRIPT` context
- **Manager Refresh** - UICoordinator notifies sidebar via STATE_CHANGED
- **Logging Gaps Fixed** - Port lifecycle, correlation IDs, health monitoring
- **Test Bridge API** - Container verification methods, Manager state API
- **Scenario Logging** - `enableScenarioLogging()`, `logScenarioStep()`

### v1.6.3.12-v2 Patterns

- **Container ID Priority** - Identity context takes priority over explicit
  options
- **Port Messaging PRIMARY** - storage.onChanged is fallback, not primary sync
- **Port Roundtrip Tracking** - `_quickTabPortOperationTimestamps` for ACK
  timing

### v1.6.3.12 Patterns

- **Option 4 Architecture** - Background script in-memory storage
- **Port Messaging** - `'quick-tabs-port'` replaces runtime.sendMessage
- **Push Notifications** - Background → Sidebar via `STATE_CHANGED`

### Previous Version Patterns (Consolidated)

- **v1.6.3.11-v12:** Solo/Mute REMOVED, version-based log cleanup
- **v1.6.3.11-v7:** Orphan Quick Tabs fix, helper methods
- **v1.6.3.10:** tabs.sendMessage, storage.onChanged, unified barrier

### Key Timing Constants (v1.6.3.12-v5+)

| Constant                                | Value | Purpose                            |
| --------------------------------------- | ----- | ---------------------------------- |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD` | 5     | Failures before circuit trips      |
| `CIRCUIT_BREAKER_TEST_INTERVAL_MS`      | 30000 | Test write interval for recovery   |
| `POST_FAILURE_MIN_DELAY_MS`             | 5000  | Delay after failure before dequeue |
| `TIMEOUT_BACKOFF_DELAYS`                | Array | [1000, 3000, 5000]ms               |
| `QUEUE_PRIORITY.HIGH`                   | 1     | Highest priority writes            |
| `QUEUE_PRIORITY.MEDIUM`                 | 2     | Normal priority writes             |
| `QUEUE_PRIORITY.LOW`                    | 3     | Lowest priority writes             |
| `MESSAGE_TIMEOUT_MS`                    | 5000  | Message timeout                    |
| `CACHE_STALENESS_ALERT_MS`              | 30000 | Warn if no sync for 30s            |
| `CACHE_STALENESS_EMERGENCY_MS`          | 60000 | Auto-request sync after 60s        |

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

**v1.6.3.12-v5 (NEW):** `[CIRCUITBREAKER_TRIPPED]` `[CIRCUITBREAKER_RECOVERED]`
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
priority queue, timeout backoff, rolling heartbeat window.

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

### Storage (v1.6.3.12-v5+)

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
`SIDEBAR_RESTORE_QUICK_TAB`

**Background → Sidebar:** `STATE_CHANGED`, `QUICKTAB_MINIMIZED`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
