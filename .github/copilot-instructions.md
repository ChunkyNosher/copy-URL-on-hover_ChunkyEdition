# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.10-v3  
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

**v1.6.3.10-v3 Features (NEW) - Issue #47 Adoption Re-render & Tabs API Phase
2:**

- **Issue #47: Adoption Re-render** - `ADOPTION_COMPLETED` port message for
  immediate Manager re-render
- **TabLifecycleHandler** - New handler tracking browser tab lifecycle events
- **Orphan Detection** - `ORIGIN_TAB_CLOSED` broadcast when origin tab closes,
  `isOrphaned`/`orphanedAt` fields
- **Smart Adoption Validation** - Validates target tab exists before adoption
- **Port Message Types** - Added `ADOPTION_COMPLETED`, `ORIGIN_TAB_CLOSED` to
  port routing

**v1.6.3.10-v2 Features (Previous) - Render, Circuit Breaker & Cache Fixes:**

- **Issue 1: Render Debounce** - 300ms→100ms, sliding-window with 300ms max cap
- **Issue 4: Circuit Breaker** - Open 10s→3s, backoff max 10s→2s, 5s sliding
  window
- **Issue 8: Cache Handling** - `lastCacheSyncFromStorage`,
  `cacheHydrationComplete` flag, 30s staleness alert
- **FAILURE_REASON enum** - `TRANSIENT`, `ZOMBIE_PORT`, `BACKGROUND_DEAD`
- **Pending action queue** - Circuit breaker queues actions during open state

**v1.6.3.10-v1 Features (Previous) - Port Lifecycle & Reliability:**

- **Issue 2: Port Lifecycle** - State machine
  (connected/zombie/reconnecting/dead), 500ms zombie detection
- **Issue 3: Storage Concurrency** - Storage batching constants
- **Issue 5: Heartbeat Timing** - 25s→15s interval, 5s→2s timeout, adaptive ≤20s
- **Issue 6: Port/Message Logging** - `logPortStateTransition()`, enhanced
  structured logging
- **Issue 7: Messaging Reliability** - 2 retries + 150ms backoff,
  `_sendMessageWithRetry()`
- **PORT_STATE enum** - `CONNECTED`, `ZOMBIE`, `RECONNECTING`, `DEAD`

**v1.6.3.9-v7 & Earlier (Consolidated):** Logging capture, O(1) message routing,
unified barrier init, Tab ID fallback, dual architecture, container isolation

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

### CRITICAL: Quick Tabs Architecture v2 (v1.6.3.10-v3)

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

### v1.6.3.10-v3: Issue #47 Adoption Re-render & Tabs API Phase 2 (NEW)

- `ADOPTION_COMPLETED` port message for instant Manager re-render after adoption
- `ORIGIN_TAB_CLOSED` broadcast when origin tab closes → marks Quick Tabs
  orphaned
- TabLifecycleHandler tracks open tabs in memory for O(1) validation
- Smart adoption validation via `validateAdoptionTarget()`
- `isOrphaned`/`orphanedAt` fields for orphaned Quick Tab tracking

### v1.6.3.10-v2: Render, Circuit Breaker & Cache (Previous)

**Render Debounce (Issue 1):**

- `RENDER_DEBOUNCE_MS` 300ms→100ms for faster updates
- Sliding-window debounce with 300ms max cap (`RENDER_DEBOUNCE_MAX_WAIT_MS`)
- Force current storage read on render

**Circuit Breaker (Issue 4):**

- Open duration 10s→3s (`CIRCUIT_BREAKER_OPEN_DURATION_MS`)
- Backoff max 10s→2s (`RECONNECT_BACKOFF_MAX_MS`)
- 5s sliding window for failure counting (`CIRCUIT_BREAKER_SLIDING_WINDOW_MS`)
- Pending action queue during open state
- `FAILURE_REASON` enum: `TRANSIENT`, `ZOMBIE_PORT`, `BACKGROUND_DEAD`

**Cache Handling (Issue 8):**

- `lastCacheSyncFromStorage` timestamp tracking
- `cacheHydrationComplete` flag for hydration state
- 30s staleness alert (`CACHE_STALENESS_ALERT_MS`)
- Immediate reconciliation (no fallback)

### v1.6.3.10-v1: Port Lifecycle & Reliability (Previous)

- Port state machine: `CONNECTED`, `ZOMBIE`, `RECONNECTING`, `DEAD`
- 500ms zombie detection timeout, `verifyPortViability()`
- Heartbeat 25s→15s interval, 5s→2s timeout, adaptive ≤20s
- Message retry: 2 retries + 150ms backoff, `_sendMessageWithRetry()`
- `logPortStateTransition()` for enhanced logging

### v1.6.3.9-v7 & Earlier (Consolidated)

- **v7:** Log capture, direct state push, `_runtimeMessageHandlers` lookup table
- **v5-v2:** Tab ID fallback, unified barrier, dual architecture, container
  isolation

---

## 🆕 Version Patterns Summary

### v1.6.3.10-v3 Patterns (Current)

- `ADOPTION_COMPLETED` port message for instant adoption UI updates
- `ORIGIN_TAB_CLOSED` port message for orphan detection
- TabLifecycleHandler for browser.tabs event tracking
- Smart adoption validation via `validateAdoptionTarget()`
- `isOrphaned`/`orphanedAt` fields for orphaned Quick Tabs

### v1.6.3.10-v2 Patterns (Previous)

- Sliding-window debounce (100ms base, 300ms max cap)
- Circuit breaker 3s open duration, 2s max backoff, 5s sliding window
- `FAILURE_REASON` enum for categorized failures
- Cache staleness tracking with 30s alert, `cacheHydrationComplete` flag

### v1.6.3.10-v1 Patterns (Previous)

- Port state machine: `CONNECTED`, `ZOMBIE`, `RECONNECTING`, `DEAD`
- Heartbeat 15s interval, 2s timeout, adaptive ≤20s
- Message retry: 2 retries + 150ms backoff
- Enhanced port/message logging with `logPortStateTransition()`

### v1.6.3.9-v7 & Earlier Patterns (Consolidated)

Log capture, O(1) message routing, unified barrier, Tab ID fallback, dual
architecture

### Key Timing Constants (v1.6.3.10-v3)

| Constant                            | Value                 | Purpose                              |
| ----------------------------------- | --------------------- | ------------------------------------ |
| `STORAGE_KEY`                       | 'quick_tabs_state_v2' | Storage key name                     |
| `INIT_BARRIER_TIMEOUT_MS`           | 10000                 | Unified barrier init timeout         |
| `RENDER_DEBOUNCE_MS`                | 100                   | Render queue debounce (was 300)      |
| `RENDER_DEBOUNCE_MAX_WAIT_MS`       | 300                   | Sliding-window max cap (NEW)         |
| `MESSAGE_TIMEOUT_MS`                | 3000                  | runtime.sendMessage timeout          |
| `CIRCUIT_BREAKER_OPEN_DURATION_MS`  | 3000                  | Circuit breaker cooldown (was 10000) |
| `CIRCUIT_BREAKER_SLIDING_WINDOW_MS` | 5000                  | Failure sliding window (NEW)         |
| `RECONNECT_BACKOFF_MAX_MS`          | 2000                  | Max reconnect backoff (was 10000)    |
| `HEARTBEAT_INTERVAL_MS`             | 15000                 | Heartbeat interval (was 25000)       |
| `HEARTBEAT_TIMEOUT_MS`              | 2000                  | Heartbeat timeout (was 5000)         |
| `CACHE_STALENESS_ALERT_MS`          | 30000                 | Cache staleness alert (NEW)          |
| `MESSAGE_RETRY_COUNT`               | 2                     | Message retry attempts (NEW)         |
| `MESSAGE_RETRY_DELAY_MS`            | 150                   | Message retry delay (NEW)            |
| `STORAGE_HEALTH_CHECK_INTERVAL_MS`  | 5000                  | Health check fallback interval       |
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

**v1.6.3.10-v3 New Messages:** `ADOPTION_COMPLETED`, `ORIGIN_TAB_CLOSED`

**v1.6.3.9-v7 New Messages:** `GET_SIDEBAR_LOGS`, `CLEAR_SIDEBAR_LOGS`,
`PUSH_STATE_UPDATE`, `ERROR_NOTIFICATION`, `REQUEST_INIT_STATUS`,
`CONTENT_SCRIPT_READY`, `CONTENT_SCRIPT_UNLOADING`

**Patterns:** LOCAL (no broadcast), GLOBAL (broadcast to all), MANAGER
(manager-initiated)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
