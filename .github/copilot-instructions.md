# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7-v3  
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

**v1.6.3.7-v3 Features (NEW):**

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

### v1.6.3.7-v3: BroadcastChannel + Storage Routing

**BroadcastChannel Pattern (NEW):**

```javascript
const updateChannel = new BroadcastChannel('quick-tabs-updates');
updateChannel.postMessage({
  type: 'quick-tab-created|updated|deleted|minimized|restored',
  quickTabId: id,
  data: quickTab,
  timestamp: Date.now()
});
```

**Storage Routing Pattern (NEW):**

```javascript
// Session Quick Tabs: permanent: false → storage.session
// Permanent Quick Tabs: permanent: true (default) → storage.local
```

**Alarms Pattern (NEW):**

```javascript
browser.alarms.create('cleanup-orphaned', { periodInMinutes: 60 });
browser.alarms.create('sync-session-state', { periodInMinutes: 5 });
browser.alarms.create('diagnostic-snapshot', { periodInMinutes: 120 });
```

**DOM Reconciliation Pattern (NEW):**

```javascript
// Track existing elements by ID
_itemElements = new Map(); // quickTabId → DOM element
// Differential updates: only add new, remove deleted, update changed
```

**Message Protocol:**

```javascript
{
  type: ('ACTION_REQUEST|STATE_UPDATE|ACKNOWLEDGMENT|ERROR|BROADCAST|HEARTBEAT|REQUEST_FULL_STATE_SYNC',
    action,
    correlationId,
    source,
    timestamp,
    payload,
    metadata);
}
```

**Port Registry:**
`{ portId -> { port, origin, tabId, type, connectedAt, lastMessageAt } }`

**Event Flow:** Port connection → Background writes storage →
storage.onChanged + BroadcastChannel → `scheduleRender()` → hash check →
renderUI

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

## 🆕 v1.6.3.7-v3 Patterns

**storage.session API:** Session-scoped Quick Tabs auto-clear on browser close.

- `SESSION_STATE_KEY` - `session_quick_tabs` storage key
- `permanent: false` - Property for session Quick Tabs
- Session tabs use `storage.session`, permanent use `storage.local`

**BroadcastChannel API:** Real-time tab messaging via `BroadcastChannelManager`.

- Channel: `quick-tabs-updates`
- Message types: `quick-tab-created`, `updated`, `deleted`, `minimized`,
  `restored`

**browser.alarms API:** Scheduled cleanup tasks.

- `cleanup-orphaned` - Every 60 minutes
- `sync-session-state` - Every 5 minutes
- `diagnostic-snapshot` - Every 120 minutes

**tabs.group() API:** Tab grouping (Firefox 138+).

- `QuickTabGroupManager.js` handles grouping operations
- Context menu integration for group creation

**DOM Reconciliation:** Sidebar animation optimization.

- `_itemElements` Map tracks DOM elements by quickTabId
- Differential updates prevent full re-renders

### v1.6.3.7-v2 Patterns (Retained)

**Single Writer Authority:** Manager sends commands to background, never writes
storage directly.

- `handleFullStateSyncRequest()` - Background responds to sync requests
- `handleCloseMinimizedTabsCommand()` - Background closes minimized tabs

**Unified Render Pipeline:** `scheduleRender(source)` replaces direct
`renderUI()` calls.

- Hash-based deduplication prevents redundant renders
- `_checkAndReloadStaleState()` detects state staleness in debounce

**Orphaned Tab Recovery:** Hydration preserves orphaned tabs with
`orphaned: true` flag.

- UI shows adoption buttons for orphaned tabs
- Background handles `ADOPT_TAB` commands

**Storage Write Verification:** `writeStateWithVerificationAndRetry()` reads
back after write.

### v1.6.3.7-v1 Patterns (Retained)

**Background Keepalive:** `_startKeepalive()` every 20s resets Firefox 30s idle
timer.

**Port Circuit Breaker:** closed→open→half-open with exponential backoff
(100ms→10s).

**Port Reconnection:** `_requestFullStateSync()` on reconnection ensures state
consistency.

### Key Timing Constants

| Constant                       | Value | Purpose                                     |
| ------------------------------ | ----- | ------------------------------------------- |
| `KEEPALIVE_INTERVAL_MS`        | 20000 | Firefox 30s timeout workaround              |
| `RENDER_DEBOUNCE_MS`           | 300   | UI render debounce                          |
| `RECONNECT_BACKOFF_INITIAL_MS` | 100   | Circuit breaker initial backoff             |
| `RECONNECT_BACKOFF_MAX_MS`     | 10000 | Circuit breaker max backoff                 |
| `HEARTBEAT_INTERVAL_MS`        | 25000 | Keep background alive                       |
| `CLEANUP_ORPHANED_MINUTES`     | 60    | Orphaned tab cleanup interval (v1.6.3.7-v3) |
| `SYNC_SESSION_STATE_MINUTES`   | 5     | Session state sync interval (v1.6.3.7-v3)   |

---

## Architecture Classes (Key Methods)

| Class                        | Methods                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| QuickTabStateMachine         | `canTransition()`, `transition()`                                    |
| QuickTabMediator             | `minimize()`, `restore()`, `destroy()`                               |
| MapTransactionManager        | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| UICoordinator                | `setHandlers()`, `clearAll()`, `scheduleRender()`                    |
| DestroyHandler               | `_closeAllInProgress`, `_destroyedIds`, `initiateDestruction()`      |
| TabStateManager (v3)         | `getTabState()`, `setTabState()`, `clearTabState()`                  |
| BroadcastChannelManager (v3) | `postMessage()`, `onMessage()`, `close()`                            |
| QuickTabGroupManager (v3)    | `createGroup()`, `addToGroup()`, `removeFromGroup()`                 |
| NotificationManager (v3)     | `show()`, `clear()`, `onClick()`                                     |
| Background                   | `handleFullStateSyncRequest()`, `handleCloseMinimizedTabsCommand()`  |
| Manager                      | `_requestFullStateSync()`, `_checkAndReloadStaleState()`             |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `SESSION_STATE_KEY`, `logStorageRead()`,
`logStorageWrite()`, `canCurrentTabModifyQuickTab()`,
`validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()`

**Storage Keys:**

- `quick_tabs_state_v2` - Permanent Quick Tabs (storage.local)
- `session_quick_tabs` - Session Quick Tabs (storage.session, v1.6.3.7-v3)

**CRITICAL:** Use `storage.local` for permanent Quick Tab state,
`storage.session` for session-scoped tabs.

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping,
transaction rollback, state machine, ownership validation, Single Writer
Authority, coordinated clear, closeAll mutex.

- **v1.6.3.7-v3:** storage.session, BroadcastChannel, alarms, tabs.group(), DOM
  reconciliation, notifications
- **v1.6.3.7-v2:** Single Writer Authority, unified render pipeline, orphaned
  tab recovery, state staleness detection, port reconnection sync, storage write
  verification
- **v1.6.3.7-v1:** Keepalive (20s), circuit breaker, debounced renderUI,
  differential storage updates

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

| File                                                          | Features                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `background.js`                                               | Port registry, keepalive, `handleFullStateSyncRequest()`, alarms handlers |
| `quick-tabs-manager.js`                                       | `scheduleRender()`, `_requestFullStateSync()`, `_itemElements` Map        |
| `src/utils/storage-utils.js`                                  | `writeStateWithVerificationAndRetry()`, `SESSION_STATE_KEY`               |
| `src/render-helpers.js`                                       | `_isValidOriginTabId()`, `groupQuickTabsByOriginTab()`                    |
| `src/core/TabStateManager.js`                                 | Per-tab state (sessions API, v1.6.3.7-v3)                                 |
| `src/features/quick-tabs/channels/BroadcastChannelManager.js` | Real-time messaging (v1.6.3.7-v3)                                         |
| `src/features/quick-tabs/QuickTabGroupManager.js`             | Tab grouping (Firefox 138+, v1.6.3.7-v3)                                  |
| `src/features/notifications/NotificationManager.js`           | System notifications (v1.6.3.7-v3)                                        |

### Storage

**Permanent State Key:** `quick_tabs_state_v2` (storage.local)  
**Session State Key:** `session_quick_tabs` (storage.session, v1.6.3.7-v3)  
**Format:** `{ tabs: [{ ..., orphaned: true, permanent: true|false }], saveId, timestamp, writingTabId }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`,
`BROADCAST`, `REQUEST_FULL_STATE_SYNC`, `ADOPT_TAB`, `CLOSE_MINIMIZED_TABS`

**BroadcastChannel (v1.6.3.7-v3):** `quick-tab-created`, `quick-tab-updated`,
`quick-tab-deleted`, `quick-tab-minimized`, `quick-tab-restored`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
