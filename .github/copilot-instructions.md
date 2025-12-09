# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7 (Build v2)  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port-based messaging** with persistent connections
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping
- **Lifecycle resilience** with keepalive & circuit breaker

**Build v2 Features (NEW):**

- **New Permissions** - `notifications`, `clipboardRead/Write` (Firefox), `alarms`
- **Single Writer Authority** - Manager sends commands (ADOPT_TAB, CLOSE_MINIMIZED_TABS) to background
- **Unified Render Pipeline** - `scheduleRender(source)` with hash-based deduplication
- **Orphaned Tab Recovery** - Hydration keeps orphaned tabs with `orphaned: true` flag
- **State Staleness Detection** - `_checkAndReloadStaleState()` hash-based detection
- **Port Reconnection Sync** - `REQUEST_FULL_STATE_SYNC` on port reconnection
- **Storage Write Verification** - `writeStateWithVerificationAndRetry()` with read-back confirmation

**v1.6.3.7 Base Features (Retained):**

- **Background Keepalive** - `_startKeepalive()` resets Firefox 30s idle timer every 20s
- **Port Circuit Breaker** - closed→open→half-open with exponential backoff (100ms→10s)
- **UI Performance** - Debounced `renderUI()` (300ms), differential storage updates
- **originTabId Validation** - `_isValidOriginTabId()` validates positive integers

**Prior Versions (Retained):**

- v12: Init guard, heartbeat (25s), storage dedup, cache reconciliation, deletion acks
- v11: Port registry, persistent connections, lifecycle logging, state coordinator

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager, Background Script

**Deprecated:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`, `updateQuickTabSize()`

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Single Writer Authority (v1.6.3.7-v2)

**Manager no longer writes to storage directly.** All state changes flow through background:
- `ADOPT_TAB` - Manager sends adoption request to background
- `CLOSE_MINIMIZED_TABS` - Background handler `handleCloseMinimizedTabsCommand()`
- `REQUEST_FULL_STATE_SYNC` - Manager requests full state on port reconnection

**Unified Render Pipeline:** `scheduleRender(source)` with hash-based deduplication prevents redundant renders.

**Message Protocol:**

```javascript
{ type: 'ACTION_REQUEST|STATE_UPDATE|ACKNOWLEDGMENT|ERROR|BROADCAST|HEARTBEAT|REQUEST_FULL_STATE_SYNC',
  action, correlationId, source, timestamp, payload, metadata }
```

**Port Registry:** `{ portId -> { port, origin, tabId, type, connectedAt, lastMessageAt } }`

**Event Flow:** Port connection → Background writes storage → storage.onChanged → `scheduleRender()` → hash check → renderUI

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

## 🆕 v1.6.3.7-v2 Patterns

**Single Writer Authority:** Manager sends commands to background, never writes storage directly.
- `handleFullStateSyncRequest()` - Background responds to sync requests
- `handleCloseMinimizedTabsCommand()` - Background closes minimized tabs

**Unified Render Pipeline:** `scheduleRender(source)` replaces direct `renderUI()` calls.
- Hash-based deduplication prevents redundant renders
- `_checkAndReloadStaleState()` detects state staleness in debounce

**Orphaned Tab Recovery:** Hydration preserves orphaned tabs with `orphaned: true` flag.
- UI shows adoption buttons for orphaned tabs
- Background handles `ADOPT_TAB` commands

**Storage Write Verification:** `writeStateWithVerificationAndRetry()` reads back after write.

### v1.6.3.7 Patterns (Retained)

**Background Keepalive:** `_startKeepalive()` every 20s resets Firefox 30s idle timer.

**Port Circuit Breaker:** closed→open→half-open with exponential backoff (100ms→10s).

**Port Reconnection:** `_requestFullStateSync()` on reconnection ensures state consistency.

### Key Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `KEEPALIVE_INTERVAL_MS` | 20000 | Firefox 30s timeout workaround |
| `RENDER_DEBOUNCE_MS` | 300 | UI render debounce |
| `RECONNECT_BACKOFF_INITIAL_MS` | 100 | Circuit breaker initial backoff |
| `RECONNECT_BACKOFF_MAX_MS` | 10000 | Circuit breaker max backoff |
| `HEARTBEAT_INTERVAL_MS` | 25000 | Keep background alive |
| `STORAGE_WRITE_RETRY_MS` | 1000 | Write verification retry (v1.6.3.7-v2) |

---

## Architecture Classes (Key Methods)

| Class | Methods |
|-------|---------|
| QuickTabStateMachine | `canTransition()`, `transition()` |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| UICoordinator | `setHandlers()`, `clearAll()`, `scheduleRender()` |
| DestroyHandler | `_closeAllInProgress`, `_destroyedIds`, `initiateDestruction()` |
| Background (v1.6.3.7-v2) | `handleFullStateSyncRequest()`, `handleCloseMinimizedTabsCommand()` |
| Manager (v1.6.3.7-v2) | `_requestFullStateSync()`, `_checkAndReloadStaleState()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `logStorageRead()`, `logStorageWrite()`, `canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`, `writeStateWithVerificationAndRetry()` (v1.6.3.7-v2)

**CRITICAL:** Use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, transaction rollback, state machine, ownership validation, Single Writer Authority, coordinated clear, closeAll mutex.
- **v1.6.3.7-v2:** Single Writer Authority, unified render pipeline, orphaned tab recovery, state staleness detection, port reconnection sync, storage write verification
- **v1.6.3.7:** Keepalive (20s), circuit breaker, debounced renderUI, differential storage updates
- **v12:** Lifecycle resilience, heartbeat, storage dedup, cache reconciliation

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

**End of task:** `git add .agentic-tools-mcp/`, commit. **Start of task:** Search memories.

**search_memories:** Use 1-2 word queries, `threshold: 0.1`, `limit: 5`. Bash fallback: `grep -r -l "keyword" .agentic-tools-mcp/memories/`

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass
- [ ] Memory files committed

---

## 📋 Quick Reference

### Key Files

| File | Features |
|------|----------|
| `background.js` | Port registry, keepalive, `handleFullStateSyncRequest()`, `handleCloseMinimizedTabsCommand()` |
| `quick-tabs-manager.js` | `scheduleRender()`, `_requestFullStateSync()`, `_checkAndReloadStaleState()` |
| `src/utils/storage-utils.js` | `writeStateWithVerificationAndRetry()` |
| `src/render-helpers.js` | `_isValidOriginTabId()`, `groupQuickTabsByOriginTab()` |

### Storage

**State Key:** `quick_tabs_state_v2` (storage.local)  
**Format:** `{ tabs: [{ ..., orphaned: true }], saveId, timestamp, writingTabId }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`, `BROADCAST`, `REQUEST_FULL_STATE_SYNC`, `ADOPT_TAB`, `CLOSE_MINIMIZED_TABS`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
