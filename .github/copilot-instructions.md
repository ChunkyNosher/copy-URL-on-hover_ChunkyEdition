# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.10-v4  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Quick Tabs v2 Architecture** - tabs.sendMessage messaging, single storage
  key
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Single Storage Key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab Isolation** - Filter by `originTabId` at hydration time
- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Single Barrier Initialization** - Unified barrier with resolve-only
  semantics
- **Storage.onChanged PRIMARY** - Primary sync mechanism for state updates
- **Runtime.onMessage Secondary** - Direct state push from background
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)
- **Tab Grouping** - tabs.group() API support (Firefox 138+)
- **Tabs API Events** - onActivated, onRemoved, onUpdated listeners

**v1.6.3.10-v4 Features (NEW) - Container Isolation & Cross-Tab Validation:**

- **Container Isolation** - `originContainerId` field for Firefox Containers
- **Cross-Tab Validation** - `_isOwnedByCurrentTab()`,
  `_validateCrossTabOwnership()` in VisibilityHandler, DestroyHandler
- **Scripting API Fallback** - `executeWithScriptingFallback()` for timeout
  recovery
- **Transaction Cleanup** - 30s timeout for stale transactions, 10s cleanup
  interval
- **Background Restart Detection** - `BACKGROUND_HANDSHAKE` message
- **Enhanced Logging** - Hydration filtering, tab ID retrieval, storage changes
- **Mutex Tab Context** - `${operation}-${currentTabId}-${id}` lock format

**v1.6.3.10-v3 Features (Previous) - Adoption Re-render & Tabs API Phase 2:**

- `ADOPTION_COMPLETED` port message for Manager re-render
- TabLifecycleHandler for browser tab lifecycle events
- Orphan Detection via `ORIGIN_TAB_CLOSED`, `isOrphaned`/`orphanedAt` fields
- Smart adoption validation via `validateAdoptionTarget()`

**v1.6.3.10-v2 Features (Previous) - Render, Circuit Breaker & Cache Fixes:**

- Render Debounce 100ms base, 300ms max cap (sliding-window)
- Circuit Breaker 3s open, 2s backoff max, 5s sliding window
- Cache staleness alert 30s, `cacheHydrationComplete` flag
- `FAILURE_REASON` enum: `TRANSIENT`, `ZOMBIE_PORT`, `BACKGROUND_DEAD`

**v1.6.3.10-v1 & Earlier (Consolidated):** Port state machine, heartbeat 15s/2s,
message retry 2x+150ms, O(1) message routing, unified barrier init

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager,
TabStateManager, QuickTabGroupManager, NotificationManager, StorageManager,
MessageBuilder, StructuredLogger, TabEventsManager, MessageRouter

**Deprecated/Removed:** `setPosition()`, `setSize()`, BroadcastChannel (v6),
runtime.Port (v12), complex init layers (v4), CONNECTION_STATE enum (v6)

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.10-v4)

**Simplified stateless architecture (NO Port, NO BroadcastChannel):**

- `runtime.sendMessage()` - Content script → Background
- `tabs.sendMessage()` - Background → Content script / Manager
- `storage.onChanged` - **PRIMARY** sync mechanism for state updates
- Storage health check fallback - Polling every 5s if listener fails
- Unified barrier initialization - Resolve-only semantics

**Dual Architecture (Retained from v3):**

- **MessageRouter.js** - ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL)
- **message-handler.js** - TYPE-based v2 routing (QT_CREATED, QT_MINIMIZED)

**Message Patterns:**

- **LOCAL** - No broadcast (position, size changes)
- **GLOBAL** - Broadcast to all tabs (create, minimize, restore, close)
- **MANAGER** - Manager-initiated actions (close all, close minimized)

### v1.6.3.10-v3: Issue #47 Adoption Re-render & Tabs API Phase 2 (Previous)

- `ADOPTION_COMPLETED` port message for instant Manager re-render after adoption
- `ORIGIN_TAB_CLOSED` broadcast when origin tab closes → marks Quick Tabs
  orphaned
- TabLifecycleHandler tracks open tabs in memory for O(1) validation
- Smart adoption validation via `validateAdoptionTarget()`
- `isOrphaned`/`orphanedAt` fields for orphaned Quick Tab tracking

### v1.6.3.10-v2 & Earlier (Consolidated)

- Render debounce 100ms, circuit breaker 3s open, cache staleness 30s alert
- Port state machine, heartbeat 15s/2s, message retry 2x+150ms
- Log capture, O(1) routing, unified barrier, Tab ID fallback

---

## 🆕 Version Patterns Summary

### v1.6.3.10-v4 Patterns (Current)

- Container isolation via `originContainerId` field
- Cross-tab ownership validation via `_isOwnedByCurrentTab()`,
  `_validateCrossTabOwnership()`
- Scripting API fallback via `executeWithScriptingFallback()`
- Background restart detection via `BACKGROUND_HANDSHAKE`
- Transaction timeout cleanup (30s timeout, 10s cleanup interval)
- Mutex locks include tab context: `${operation}-${currentTabId}-${id}`

### v1.6.3.10-v3 Patterns (Previous)

- `ADOPTION_COMPLETED` port message for instant adoption UI updates
- `ORIGIN_TAB_CLOSED` port message for orphan detection
- TabLifecycleHandler for browser.tabs event tracking
- Smart adoption validation via `validateAdoptionTarget()`
- `isOrphaned`/`orphanedAt` fields for orphaned Quick Tabs

### v1.6.3.10-v2 & Earlier Patterns (Consolidated)

- Sliding-window debounce (100ms base, 300ms max cap)
- Circuit breaker 3s open, 2s max backoff, 5s sliding window
- Port state machine, heartbeat 15s/2s, message retry 2x+150ms
- O(1) message routing, unified barrier, Tab ID fallback

### Key Timing Constants (v1.6.3.10-v4)

| Constant                            | Value                 | Purpose                              |
| ----------------------------------- | --------------------- | ------------------------------------ |
| `STORAGE_KEY`                       | 'quick_tabs_state_v2' | Storage key name                     |
| `INIT_BARRIER_TIMEOUT_MS`           | 10000                 | Unified barrier init timeout         |
| `RENDER_DEBOUNCE_MS`                | 100                   | Render queue debounce (was 300)      |
| `RENDER_DEBOUNCE_MAX_WAIT_MS`       | 300                   | Sliding-window max cap               |
| `MESSAGE_TIMEOUT_MS`                | 3000                  | runtime.sendMessage timeout          |
| `CIRCUIT_BREAKER_OPEN_DURATION_MS`  | 3000                  | Circuit breaker cooldown             |
| `CIRCUIT_BREAKER_SLIDING_WINDOW_MS` | 5000                  | Failure sliding window               |
| `RECONNECT_BACKOFF_MAX_MS`          | 2000                  | Max reconnect backoff                |
| `KEEPALIVE_INTERVAL_MS`             | 20000                 | Keepalive interval (was 25000 in v3) |
| `HEARTBEAT_INTERVAL_MS`             | 15000                 | Heartbeat interval                   |
| `HEARTBEAT_TIMEOUT_MS`              | 2000                  | Heartbeat timeout                    |
| `TRANSACTION_TIMEOUT_MS`            | 30000                 | Transaction expiration (NEW)         |
| `TRANSACTION_CLEANUP_INTERVAL_MS`   | 10000                 | Stale transaction cleanup (NEW)      |
| `SCRIPTING_FALLBACK_TIMEOUT_MS`     | 2000                  | Messaging timeout for Scripting API  |
| `MAX_QUICK_TABS`                    | 100                   | Maximum Quick Tabs allowed           |

---

## Architecture Classes (Key Methods)

| Class                 | Methods                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| QuickTabStateMachine  | `canTransition()`, `transition()`                                                    |
| QuickTabMediator      | `minimize()`, `restore()`, `destroy()`                                               |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`                                          |
| TabStateManager       | `getTabState()`, `setTabState()`                                                     |
| StorageManager        | `readState()`, `writeState()`, `_computeStateChecksum()`                             |
| MessageBuilder        | `buildLocalUpdate()`, `buildGlobalAction()`, `buildManagerAction()`                  |
| MessageRouter         | ACTION-based routing (GET_CURRENT_TAB_ID, COPY_URL, etc.)                            |
| EventBus              | `on()`, `off()`, `emit()`, `once()`, `removeAllListeners()`                          |
| StructuredLogger      | `debug()`, `info()`, `warn()`, `error()`, `withContext()`                            |
| UICoordinator         | `syncState()`, `onStorageChanged()`, `setHandlers()`                                 |
| Manager               | `scheduleRender()`, `sendMessageToBackground()`, `_handleOperationAck()`             |
| TabLifecycleHandler   | `start()`, `stop()`, `handleTabRemoved()`, `validateAdoptionTarget()`, `isTabOpen()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `_computeStateChecksum()`

**Schema v2 Exports:** `validateStateWithDiagnostics()`, `version: 2` field,
`getQuickTabsByOriginTabIdAndContainer()`, `getQuickTabsByContainerId()`

**Browser API Exports:** `getTabsByContainer()`, `validateTabExists()`,
`getTabContainerId()`, `areTabsInSameContainer()`, `getAllContainers()`

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority. See Version Patterns Summary above for version-specific patterns.

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

| File                                             | Features                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `src/constants.js`                               | Centralized constants (+225 lines in v4)                    |
| `src/background/tab-events.js`                   | Tabs API listeners (onActivated/Removed/Updated)            |
| `src/utils/structured-logger.js`                 | StructuredLogger class with contexts                        |
| `src/storage/schema-v2.js`                       | Container-aware queries, version field                      |
| `src/storage/storage-manager.js`                 | Simplified persistence, checksum validation                 |
| `src/utils/browser-api.js`                       | Container functions, validateTabExists()                    |
| `src/messaging/message-router.js`                | ACTION-based routing (GET_CURRENT_TAB_ID, etc.)             |
| `src/background/message-handler.js`              | TYPE-based v2 routing (QT_CREATED, etc.)                    |
| `background.js`                                  | \_computeStateChecksum(), \_generateQuickTabId()            |
| `sidebar/quick-tabs-manager.js`                  | scheduleRender(), sendMessageToBackground()                 |
| `src/background/handlers/TabLifecycleHandler.js` | Tab lifecycle events, orphan detection, adoption validation |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session)  
**Format:** `{ allQuickTabs: [...], originTabId, originContainerId, correlationId, timestamp, version: 2 }`

### Messages

**MESSAGE_TYPES:** `QT_POSITION_CHANGED`, `QT_SIZE_CHANGED`, `QT_MINIMIZED`,
`QT_RESTORED`, `QT_CLOSED`, `MANAGER_CLOSE_ALL`, `MANAGER_CLOSE_MINIMIZED`,
`QT_STATE_SYNC`, `REQUEST_FULL_STATE_SYNC`

**v1.6.3.10-v4 New Messages:** `BACKGROUND_HANDSHAKE`

**v1.6.3.10-v3 New Messages:** `ADOPTION_COMPLETED`, `ORIGIN_TAB_CLOSED`

**v1.6.3.9-v7 New Messages:** `GET_SIDEBAR_LOGS`, `CLEAR_SIDEBAR_LOGS`,
`PUSH_STATE_UPDATE`, `ERROR_NOTIFICATION`, `REQUEST_INIT_STATUS`,
`CONTENT_SCRIPT_READY`, `CONTENT_SCRIPT_UNLOADING`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
