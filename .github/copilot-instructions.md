# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.12-v10  
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

**v1.6.3.12-v10 Features (NEW) - Issue #48 Port Routing Fix:**

- **Port Routing Fix** - Sidebar detection prioritized over content script
  detection in `handleQuickTabsPortConnect()` to fix Manager button operations
- **Enhanced Port Logging** - Additional logging for `QUICK_TABS_PORT_CONNECT`
  with `senderFrameId` and `hasTab` fields
- **Sidebar Message Logging** - New `[Background] SIDEBAR_MESSAGE_RECEIVED:`
  logging showing handler availability and available handlers
- **Issue #48 Fix** - Manager buttons (Close, Minimize, Restore, Close All,
  Close Minimized) now properly route through sidebar port handlers

**v1.6.3.12-v9 Features - Comprehensive Logging + Optimistic UI:**

- **Button Click Logging** - Logging for Manager buttons (Close, Minimize,
  Restore, Close All, Close Minimized) with `[Manager] BUTTON_CLICKED:` prefix
- **Optimistic UI Updates** - Instant feedback via `_applyOptimisticUIUpdate()`
- **Port Message Validation** - `_validateQuickTabObject()`,
  `_filterValidQuickTabs()`, `_isValidSequenceNumber()`
- **Cross-Tab Aggregation** - `_computeOriginTabStats()` for per-origin-tab
  counts with `STATE_SYNC_CROSS_TAB_AGGREGATION` logging
- **Orphan Quick Tab UI** - Visual indicator (orange background, badge) for
  orphaned tabs with `.quick-tab-item.orphaned` CSS class
- **Render Lock** - `_isRenderInProgress`, `_pendingRerenderRequested`, max 3
  consecutive re-renders
- **Storage Transaction** - Self-write uses promise resolution,
  `requestAnimationFrame()` for DOM batching, `_stateVersion` tracking
- **Settings Logging** - `[Settings][INIT]` prefix, button initialization
  tracking
- **Code Health** - quick-tabs-manager.js: 7.87 → 8.54

**v1.6.3.12-v8 Features - Bulk Close + Circuit Breaker Auto-Reset:**

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

**v1.6.3.12-v4 to v1.6.3.12-v7:** storage.session Removal, Container ID,
QUICKTAB_MINIMIZED, Port Roundtrip Tracking, Message Routing Fixes  
**v1.6.3.12:** Option 4 In-Memory Architecture, Port-Based Messaging  
**v1.6.3.11-v12:** Solo/Mute REMOVED

**Core Modules:** QuickTabStateMachine, QuickTabMediator, TabStateManager,
MessageBuilder, StructuredLogger, MessageRouter

**Deprecated:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
`browser.storage.session` (v4), `runtime.sendMessage` for Quick Tabs
(v1.6.3.12), Solo/Mute (v12)

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

### v1.6.3.12-v9 Patterns (Current)

- **Button Click Logging** - `[Manager] BUTTON_CLICKED:` prefix for all button
  actions
- **Optimistic UI Updates** - `_applyOptimisticUIUpdate()` for instant visual
  feedback
- **Port Message Validation** - `_validateQuickTabObject()`,
  `_filterValidQuickTabs()`
- **Orphan Quick Tab UI** - `.quick-tab-item.orphaned` CSS class, orange badge
- **Render Lock** - `_isRenderInProgress`, max 3 consecutive re-renders
- **State Version Tracking** - `_stateVersion` for render consistency
- **Code Health** - quick-tabs-manager.js: 8.54

### v1.6.3.12-v8 Patterns

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

### v1.6.3.12-v5 to v1.6.3.12-v6 Patterns (Consolidated)

- **Circuit Breaker** - Trips after 5 failures, recovers via test write (30s)
- **Timeout Backoff** - Progressive delays: 1s → 3s → 5s
- **Priority Queue** - QUEUE_PRIORITY enum (HIGH/MEDIUM/LOW)
- **Sequence Tracking** - `_lastReceivedSequence` for FIFO resilience
- **Port Circuit Breaker** - Max 10 reconnect attempts with backoff

### v1.6.3.12-v2 to v1.6.3.12-v4 Patterns (Consolidated)

- **Option 4 Architecture** - Background in-memory storage (v1.6.3.12)
- **Port Messaging** - `'quick-tabs-port'` replaces runtime.sendMessage
- **storage.local Only** - `browser.storage.session` REMOVED (v4)
- **Startup Cleanup** - `_clearQuickTabsOnStartup()` (v4)

### Previous Version Patterns

- **v1.6.3.11-v12:** Solo/Mute REMOVED
- **v1.6.3.11-v7:** Orphan Quick Tabs fix

### Key Timing Constants

| Constant                                        | Value | Purpose                          |
| ----------------------------------------------- | ----- | -------------------------------- |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD`         | 5     | Failures before circuit trips    |
| `CIRCUIT_BREAKER_TEST_INTERVAL_MS`              | 30000 | Test write interval for recovery |
| `QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS` | 60000 | Auto-reset circuit breaker       |
| `TIMEOUT_BACKOFF_DELAYS`                        | Array | [1000, 3000, 5000]ms             |
| `PORT_RECONNECT_MAX_ATTEMPTS`                   | 10    | Max port reconnection attempts   |

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

**v1.6.3.12-v9 (NEW):** `[Manager] BUTTON_CLICKED:`,
`[Manager] OPTIMISTIC_UI_*:`, `[Manager] VALIDATE_QUICK_TAB:`,
`[Manager] ORPHAN_DETECTED:`, `[Manager] RENDER_LOCK:`,
`[Manager] STATE_VERSION:`, `[Settings][INIT]`

**v1.6.3.12-v5 to v8:** `[CIRCUIT_BREAKER_*]`, `[PORT_RECONNECT_*]`,
`[SEQUENCE_TRACKING]`, `[TIMEOUT_BACKOFF_*]`, `[FALLBACK_*]`

**Core:** `[STORAGE_ONCHANGED]`, `[STATE_SYNC]`, `[MSG_ROUTER]`, `[HYDRATION]`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, state
machine, ownership validation, Single Writer Authority, Shadow DOM traversal,
error telemetry, originTabId resolution, container isolation, z-index recycling,
port messaging, factory patterns, lookup tables, generic wrapper functions,
in-memory state, push notifications, port roundtrip tracking, circuit breaker,
priority queue, timeout backoff, rolling heartbeat window, sequence number
tracking, port reconnection circuit breaker, defensive input validation, circuit
breaker auto-reset, listener registration guards, message timeout protection,
optimistic UI updates, render lock, orphan recovery UI, state version tracking.

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
