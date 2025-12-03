# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.5-v4  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`**
- **Per-Tab Ownership Validation** (v1.6.3.5-v4)
- Direct local creation pattern, State hydration on page reload

**v1.6.3.5-v4 Architecture (Background-as-Coordinator):**

**Core Modules:**
- **QuickTabStateMachine** (`state-machine.js`) - Explicit lifecycle state tracking
- **QuickTabMediator** (`mediator.js`) - Operation coordination with rollback
- **MapTransactionManager** (`map-transaction-manager.js`) - Atomic Map operations
- **Background Script** - Coordinator for state broadcasts and manager commands

**v1.6.3.5-v4 New Features:**
- **Per-Tab Ownership Validation** - `canCurrentTabModifyQuickTab()` prevents non-owner tabs from writing
- **Manager Storage Storm Protection** - `inMemoryTabsCache` survives 0-tab anomalies
- **UICoordinator Invariant Checks** - `_verifyInvariant()` ensures mutual exclusion
- **Content Script Identity Logging** - Logs tab ID, URL, timestamp on init

---

## 🤖 CRITICAL: Agent Delegation Strategy

### DELEGATE MOST CODING TO SPECIALIST AGENTS

Copilot main task is to **coordinate** and **delegate**, not code everything directly.

### When to Delegate (ALWAYS for these tasks)

| Task Type | Delegate To | When |
|-----------|-------------|------|
| Bug fixes | `bug-fixer` or `bug-architect` | Any bug in Quick Tabs or extension |
| New features | `feature-builder` | Adding new functionality |
| Refactoring | `refactor-specialist` | Large code reorganization |
| Quick Tab issues | `quicktabs-unified-agent` | Anything Quick Tab related |
| Cross-tab sync | `quicktabs-cross-tab-agent` | Sync, storage.onChanged, state |
| Manager sidebar | `quicktabs-manager-agent` | Sidebar Quick Tabs Manager issues |
| Single Quick Tab | `quicktabs-single-tab-agent` | Drag, resize, Solo/Mute UI |
| Settings/UI | `ui-ux-settings-agent` | Settings page, appearance |
| URL detection | `url-detection-agent` | Link detection, site handlers |
| Copilot Docs Updater | `copilot-docs-updater` | Updating Copilot instructions and agent files |

### Agent Selection Criteria

**`bug-fixer`** - Clear repro steps, single file, surgical fix  
**`bug-architect`** - Root cause unclear, multiple components  
**`quicktabs-unified-agent`** - Complete lifecycle, cross-domain  
**`quicktabs-cross-tab-agent`** - storage.onChanged, sync issues  
**`copilot-docs-updater`** - Update instructions/agents, compress to <15KB

### Delegation Template

```
@[agent-name] [task], Files: [list], run npm test/lint, commit with report_progress
```

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Background-as-Coordinator + storage.onChanged

**v1.6.3.5-v4 Message Types:**
- `QUICK_TAB_STATE_CHANGE` - Content script → Background for state changes
- `QUICK_TAB_STATE_UPDATED` - Background → All contexts for broadcasts
- `MANAGER_COMMAND` - Manager → Background for remote control
- `EXECUTE_COMMAND` - Background → Content script for command execution

**Event Flow:**
```
Tab A writes to storage.local
    ↓
storage.onChanged fires in Tab B, C, D (NOT Tab A - uses Self-Write Detection)
    ↓
StorageManager._onStorageChanged() → scheduleStorageSync()
    ↓
Background broadcasts QUICK_TAB_STATE_UPDATED to all contexts
    ↓
UICoordinator event listeners → render/update/destroy Quick Tabs
```

**Key Points:**
- storage.onChanged does NOT fire in the tab that made the change
- **v1.6.3.5-v4:** `canCurrentTabModifyQuickTab()` validates ownership before writes
- Background script coordinates broadcasts, does NOT store state
- Manager commands routed through background.js to host tabs

---

## 🔧 QuickTabsManager API

### Correct Methods

| Method | Description |
|--------|-------------|
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()` | Close all Quick Tabs |

### Common Mistake

❌ `closeQuickTab(id)` - **DOES NOT EXIST** (use `closeById(id)` instead)

---

## 🆕 v1.6.3.5-v4 New Architecture Features

### Per-Tab Ownership Validation

**Exports from `src/utils/storage-utils.js`:**
- `canCurrentTabModifyQuickTab(tabData, currentTabId)` - Check if current tab can modify a Quick Tab
- `validateOwnershipForWrite(tabs, currentTabId)` - Filter tabs by ownership before write
- `isOwnerOfQuickTab` - Alias for `canCurrentTabModifyQuickTab`

**Ownership rules:** Only the tab that created a Quick Tab (matching `originTabId`) can persist changes. Empty states bypass ownership for Close All scenarios.

### Manager Storage Storm Protection

**`sidebar/quick-tabs-manager.js`:**
- `inMemoryTabsCache` - Local cache protects against storage anomalies
- `lastKnownGoodTabCount` - Tracks last valid tab count
- `_handleEmptyStorageState()` - Use cache when storage returns empty
- `_detectStorageStorm()` - Detect 0-tab anomalies and recover from cache
- `_updateInMemoryCache()` - Update cache from validated storage

### UICoordinator Invariant Checks

- `_verifyInvariant(quickTabId)` - Verify mutual exclusion (renderedTabs vs MinimizedManager)
- `_lastRenderTime` Map - Track render timestamps per Quick Tab
- Enhanced `_finalizeRender()` with invariant checking

### Content Script Identity Logging

**v1.6.3.5-v4:** Content script logs identity on init (FIX Diagnostic Issue #7):
```javascript
console.log('[Copy-URL-on-Hover] Content Script Identity:', { tabId, url, timestamp });
```

### Updated Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | Suppress circular callbacks |
| `STORAGE_READ_DEBOUNCE_MS` | 50 | Fast UI updates |
| `STATE_EMIT_DELAY_MS` | 100 | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | Storage persist after state |
| `IFRAME_DEDUP_WINDOW_MS` | 200 | Iframe processing dedup |
| `OPERATION_LOCK_MS` | 500 | Operation lock timeout |
| `DOM_VERIFICATION_DELAY_MS` | 500 | DOM verify timing |
| `RENDER_COOLDOWN_MS` | 1000 | Prevent duplicate renders |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | Restore message dedup |
| `MIN_TABS_FOR_CACHE_PROTECTION` | 1 | **v1.6.3.5-v4:** Cache threshold |

---

## v1.6.3.5 Architecture Classes

### QuickTabStateMachine (`state-machine.js`)

**States:** UNKNOWN, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED

| Method | Description |
|--------|-------------|
| `getState(id)` | Get current state for Quick Tab |
| `canTransition(id, toState)` | Check if transition is valid |
| `transition(id, toState, options)` | Perform validated state transition |
| `initialize(id, state, source)` | Initialize tab in specific state |
| `getHistory(id)` | Get state history for debugging |

### QuickTabMediator (`mediator.js`)

Single entry point for all operations with rollback support.

| Method | Description |
|--------|-------------|
| `minimize(id, source)` | Coordinate minimize with state validation |
| `restore(id, source)` | Coordinate restore with state validation |
| `destroy(id, source)` | Coordinate destroy with cleanup |
| `executeWithRollback(op, rollbackFn)` | Execute with auto-rollback on failure |

### MapTransactionManager (`map-transaction-manager.js`)

Atomic Map operations with logging and rollback.

| Method | Description |
|--------|-------------|
| `beginTransaction(reason)` | Capture state before modifications |
| `deleteEntry(id, reason)` | Delete with logging |
| `setEntry(id, value, reason)` | Set with logging |
| `commitTransaction(validation)` | Commit with optional size validation |
| `rollbackTransaction()` | Restore to snapshot state |

---

## 🔧 Storage Utilities

**Location:** `src/utils/storage-utils.js`

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key (`quick_tabs_state_v2`) |
| `canCurrentTabModifyQuickTab()` | **v1.6.3.5-v4:** Check tab ownership |
| `validateOwnershipForWrite()` | **v1.6.3.5-v4:** Filter tabs by ownership |
| `isSelfWrite(storageValue)` | Check if write from current tab |
| `generateSaveId()` | Unique saveId for deduplication |
| `persistStateToStorage()` | Write with ownership validation |
| `queueStorageWrite()` | Queue write, resets on failure |
| `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` | Transaction lifecycle |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns

### Active Timer IDs Pattern

`_activeTimerIds` Set replaces generation counters. Each timer has unique ID, checks if still in Set before executing.

### State Machine Pattern

`QuickTabStateMachine.canTransition()` validates before ops, `transition()` logs with source.

### Map Transaction Pattern

`MapTransactionManager` wraps Map ops with `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`.

### Ownership Validation Pattern (v1.6.3.5-v4)

Only owner tabs can persist Quick Tab changes. `persistStateToStorage()` calls `_validatePersistOwnership()` before writing.

---

## 🎯 Robust Solutions Philosophy

**ALWAYS prioritize:**
- ✅ Fix root causes, not symptoms
- ✅ Use correct patterns even if more code
- ✅ Eliminate technical debt

**NEVER accept:**
- ❌ setTimeout to "fix" race conditions
- ❌ Catch and ignore errors
- ❌ Workarounds instead of proper fixes

---

## 📏 File Size Limits

| File Type | Maximum Size |
|-----------|--------------|
| `.github/copilot-instructions.md` | **15KB** |
| `.github/agents/*.md` | **25KB each** |
| Documentation files | **20KB** |
| README.md | **10KB** |

**PROHIBITED locations:**
- ❌ `docs/manual/` - Reserved for user docs
- ❌ Root directory markdown (except README.md)

---

## 🔧 MCP Server Usage

### Mandatory MCPs (ALWAYS use)

**CodeScene MCP** - Check the code health at the end of every change and make sure there are no technical debt hotspots
**Context7 MCP** - Verify API usage with current docs  
**Perplexity MCP** - Research best practices (paste code, can't read files)

### Testing

```bash
npm test                    # All unit tests
npm run lint               # ESLint
npm run build              # Build extension
npm run test:coverage      # With coverage
```

**Note:** Playwright is broken. Use Jest unit tests.

---

## 🧠 Memory Persistence (Agentic-Tools MCP)

**MANDATORY at end of EVERY task:**
1. `git add .agentic-tools-mcp/`
2. Commit with `report_progress`

**Before starting ANY task:**
- Search memories: `searchMemories({ query: "keywords", limit: 5 })`
- Keep queries SHORT (1-3 keywords max)

## For storing memories, **DO NOT USE THE "store_memory" TOOL CALL, IT DOES NOT EXIST
Use the agentic-tools MCP to create memories instead.

---

## ✅ Before Every Commit

- [ ] Delegated coding to appropriate specialist agent
- [ ] Agent used Context7/Perplexity MCPs
- [ ] ESLint passed
- [ ] Unit tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Memory files committed

---

## 📋 Quick Reference

### Key Files
- `background.js` - Background-as-Coordinator with `handleQuickTabStateChange()`, `broadcastQuickTabStateUpdate()`, `handleManagerCommand()`, `quickTabHostTabs` Map
- `src/content.js` - **v1.6.3.5-v4:** Identity logging on init, `QUICK_TAB_COMMAND_HANDLERS`, message deduplication (2000ms)
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings
- `src/utils/storage-utils.js` - **v1.6.3.5-v4:** `canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`, ownership validation
- `src/features/quick-tabs/state-machine.js` - QuickTabStateMachine, States: VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED
- `src/features/quick-tabs/mediator.js` - QuickTabMediator, `minimize()`, `restore()`, `destroy()`, `executeWithRollback()`
- `src/features/quick-tabs/map-transaction-manager.js` - MapTransactionManager with rollback
- `src/features/quick-tabs/coordinators/UICoordinator.js` - **v1.6.3.5-v4:** `_verifyInvariant()`, `_lastRenderTime` Map
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - `_activeTimerIds` Set, Tab ID prefixed logging
- `src/features/quick-tabs/minimized-manager.js` - `_restoreInProgress` Set
- `sidebar/quick-tabs-manager.js` - **v1.6.3.5-v4:** `inMemoryTabsCache`, `_detectStorageStorm()`, `_handleEmptyStorageState()`

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quickTabShowDebugId` (storage.local)

**State Format:**
```javascript
{
  tabs: [{
    id: 'unique-id',
    originTabId: 12345,  // Track originating browser tab
    domVerified: true,
    zIndex: 1000,
    // ... other tab properties
  }],
  saveId: 'unique-id',
  timestamp: Date.now(),
  writingTabId: 12345,      // v1.6.3.5-v3: Tab that wrote this state
  writingInstanceId: 'abc'  // v1.6.3.5-v3: Instance that wrote this state
}
```

### Manager Action Messages

**Background-as-Coordinator Messages:**
- `QUICK_TAB_STATE_CHANGE` - Content script → Background for state changes
- `QUICK_TAB_STATE_UPDATED` - Background → All contexts for broadcasts
- `MANAGER_COMMAND` - Manager → Background for remote control
- `EXECUTE_COMMAND` - Background → Content script for command execution
- `CLOSE_QUICK_TAB` / `MINIMIZE_QUICK_TAB` / `RESTORE_QUICK_TAB` - Legacy messages

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
