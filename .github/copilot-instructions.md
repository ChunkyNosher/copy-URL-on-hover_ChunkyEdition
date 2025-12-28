# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.12-v12  
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

**v1.6.3.12-v12 Features (NEW) - Button Operation Fix + Code Health:**

- **Button Operation Fix** - Manager buttons (Close, Minimize, Restore, Close
  All, Close Minimized) now work reliably
  - ROOT CAUSE: Optimistic UI disabled buttons but STATE_CHANGED didn't always
    trigger re-render
  - FIX #1: Safety timeout in `_applyOptimisticUIUpdate()` reverts UI if no
    response
  - FIX #2: `_lastRenderedStateVersion` tracking in `scheduleRender()`
  - FIX #3: `_handleQuickTabsStateUpdate()` increments state version
- **Code Health Improvements** - quick-tabs-manager.js: 7.48 → 8.54
  - Refactored `_revertOptimisticUI` to use options object (5 args → 1)
  - Refactored `_applyOptimisticClasses` to use options object (5 args → 1)
  - Refactored `_applyOptimisticUIUpdate` to use lookup table (72 LoC → 42 LoC)
  - Extracted `_isTabsOnUpdatedAvailable()` predicate

**v1.6.3.12-v11 Features - Cross-Tab Display + Robustness:**

- **Cross-Tab Display Fix** - `_getAllQuickTabsForRender()` prioritizes port
  data for all-tabs visibility (Issue #1)
- **Options Page Async Guard** - `_isPageActive` + `isPageActive()` async safety
  (Issue #10)
- **Tab Info Cache Invalidation** - `browser.tabs.onUpdated` listener (Issue #12)
- **Heartbeat Restart Logging** - `HEARTBEAT_CONFIRMED_ACTIVE` prefix (Issue #20)

**v1.6.3.12-v10 Features - Issue #48 Port Routing Fix:**

- **Port Routing Fix** - Sidebar detection prioritized in
  `handleQuickTabsPortConnect()` (Issue #48 fix)
- **Code Health** - background.js: 8.79 → 9.09

**v1.6.3.12-v8 to v1.6.3.12-v9:** Comprehensive Logging, Optimistic UI, Render
Lock, Orphan UI, Bulk Close Operations, Circuit Breaker Auto-Reset
- **Code Health** - background.js: 9.09, quick-tabs-manager.js: 9.09, settings.js: 10.0

**v1.6.3.12-v5 to v1.6.3.12-v9:** Circuit breaker, priority queue, sequence
tracking, port circuit breaker, defensive handlers, QUICKTAB_REMOVED handler,
comprehensive logging, optimistic UI updates, render lock, orphan recovery UI  
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

### v1.6.3.12-v12 Patterns (Current)

- **Button Operation Fix** - Safety timeout + state version tracking for
  reliable button operations
- **Optimistic UI Timeout** - `_applyOptimisticUIUpdate()` reverts if no
  response
- **State Version Tracking** - `_lastRenderedStateVersion` in `scheduleRender()`
- **Code Health** - Options object pattern, lookup tables, predicate extraction

### v1.6.3.12-v11 Patterns

- **Cross-Tab Display** - `_getAllQuickTabsForRender()` prioritizes port data
  for all-tabs visibility (Issue #1 fix)
- **Options Page Guard** - `_isPageActive` + `isPageActive()` async safety
  (Issue #10 fix)
- **Tab Cache Invalidation** - `browser.tabs.onUpdated` listener (Issue #12 fix)
- **Heartbeat Logging** - `HEARTBEAT_CONFIRMED_ACTIVE` prefix (Issue #20 fix)

### v1.6.3.12-v8 to v1.6.3.12-v10 Patterns (Consolidated)

- **v10:** Port Routing Fix (Issue #48), Manager Button Operations, Code Health 9.09
- **v9:** Button Click Logging, Optimistic UI, Render Lock, Orphan UI
- **v8:** Bulk Close Operations, Circuit Breaker Auto-Reset, Settings Timeout

### v1.6.3.12-v5 to v1.6.3.12-v7 Patterns (Consolidated)

- **Circuit Breaker** - Trips after 5 failures, recovers via test write (30s)
- **Priority Queue** - QUEUE_PRIORITY enum (HIGH/MEDIUM/LOW)
- **Sequence Tracking** - `_lastReceivedSequence` for FIFO resilience
- **Port Circuit Breaker** - Max 10 reconnect attempts with backoff
- **Defensive Handlers** - Input validation in all port message handlers
- **QUICKTAB_REMOVED Handler** - Background notifies Manager when closed

### v1.6.3.12-v2 to v1.6.3.12-v4 Patterns (Consolidated)

- **Option 4 Architecture** - Background in-memory storage (v1.6.3.12)
- **Port Messaging** - `'quick-tabs-port'` replaces runtime.sendMessage
- **storage.local Only** - `browser.storage.session` REMOVED (v4)

### Previous Version Patterns

- **v1.6.3.11-v12:** Solo/Mute REMOVED
- **v1.6.3.11-v7:** Orphan Quick Tabs fix

### Key Timing Constants

| Constant                                        | Value | Purpose                       |
| ----------------------------------------------- | ----- | ----------------------------- |
| `CIRCUIT_BREAKER_TRANSACTION_THRESHOLD`         | 5     | Failures before circuit trips |
| `CIRCUIT_BREAKER_TEST_INTERVAL_MS`              | 30000 | Test write interval           |
| `QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS` | 60000 | Auto-reset circuit breaker    |
| `PORT_RECONNECT_MAX_ATTEMPTS`                   | 10    | Max reconnection attempts     |

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

**v1.6.3.12-v12 (NEW):** `[Manager] OPTIMISTIC_TIMEOUT:`,
`[Manager] STATE_VERSION_RENDER:`

**v1.6.3.12-v11:** `[Manager] RENDER_DATA_SOURCE:`,
`HEARTBEAT_CONFIRMED_ACTIVE`, `[Options] PAGE_ACTIVE_CHECK:`

**v1.6.3.12-v10:** `[Background] QUICK_TABS_PORT_CONNECT:`,
`[Background] SIDEBAR_MESSAGE_RECEIVED:`, `[Background] QUICK_TABS_PORT_UNHANDLED:`

**v1.6.3.12-v9:** `[Manager] BUTTON_CLICKED:`,
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
optimistic UI updates, render lock, orphan recovery UI, state version tracking,
port routing, sidebar URL detection.

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
