# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.5-v2  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged exclusively**
- **Cross-tab isolation via `originTabId`** (v1.6.3.5-v2)
- Direct local creation pattern
- **State hydration on page reload**

**v1.6.3.5-v2 Architecture (16 Bug Fixes + New Features):**

**Core Modules:**
- **QuickTabStateMachine** (`state-machine.js`) - Explicit lifecycle state tracking
- **QuickTabMediator** (`mediator.js`) - Operation coordination with rollback
- **MapTransactionManager** (`map-transaction-manager.js`) - Atomic Map operations

**v1.6.3.5-v2 Fixes:**
- **Cross-Tab Filtering** - `originTabId` prevents Quick Tabs appearing on wrong tabs
- **Storage Debounce** - Reduced from 300ms to 50ms for faster UI updates
- **DOM Verification** - Restore operations verify DOM presence before UI updates
- **Tab ID Logging** - All logs include `[Tab ID]` prefix for cross-tab debugging

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

**Use `bug-fixer`** when:
- Issue has clear reproduction steps
- Single file or component affected
- Quick surgical fix needed

**Use `bug-architect`** when:
- Root cause unclear
- Multiple components involved
- May need architectural changes

**Use `quicktabs-unified-agent`** when:
- Complete Quick Tab lifecycle involved
- Crosses single-tab, manager, and sync domains
- Global visibility issues

**Use `quicktabs-cross-tab-agent`** when:
- storage.onChanged not firing
- State not syncing between tabs

**Use `copilot-docs-updater`** when:
- Updating the Copilot instructions and agent files to have the most up-to-date information
- Shortening the Copilot instructions and agent files to be under 15KB
- Editing out or deleting old/legacy/out-of-date information from the Copilot instructions and agent files

### Delegation Template

```
@[agent-name] Please:
1. [Specific task description]
2. Files involved: [list files]
3. Use Context7 MCP for API verification
4. Use Perplexity MCP for research
5. Run npm test and npm run lint
6. Commit changes with report_progress
```

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: storage.onChanged is Primary Sync Mechanism

**Event Flow:**
```
Tab A writes to storage.local
    ↓
storage.onChanged fires in Tab B, C, D (NOT Tab A)
    ↓
StorageManager._onStorageChanged() → scheduleStorageSync()
    ↓
EventBus.emit('storage:changed')
    ↓
SyncCoordinator.handleStorageChange()
    ↓
StateManager.hydrate() → emit state:added/updated/deleted events
    ↓
UICoordinator event listeners → render/update/destroy Quick Tabs
```

**Key Points:**
- storage.onChanged does NOT fire in the tab that made the change
- Tab A updates local UI immediately after write
- Background script only updates its cache, does NOT broadcast to tabs
- Each tab handles its own sync via storage.onChanged listener

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

## 🆕 v1.6.3.5-v2 New Architecture Features

### Cross-Tab Filtering with `originTabId`

Each Quick Tab now tracks which browser tab created it via `originTabId`. The `storage.onChanged` listener filters by this field to prevent Quick Tabs appearing on wrong tabs.

```javascript
// storage-utils.js - Tab serialization includes originTabId
originTabId: tab.originTabId ?? tab.activeTabId ?? null

// index.js - Filter by originTabId before rendering
const hasOriginTabId = tabData.originTabId !== null && tabData.originTabId !== undefined;
if (hasOriginTabId && tabData.originTabId !== currentTabId) {
  return false; // Skip - belongs to different tab
}
```

### Updated Timing Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | VisibilityHandler | Suppress circular callbacks |
| `STORAGE_READ_DEBOUNCE_MS` | 50 | quick-tabs-manager.js | **v1.6.3.5-v2:** Reduced from 300ms |
| `STATE_EMIT_DELAY_MS` | 100 | VisibilityHandler | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | VisibilityHandler | Storage persist after state |
| `IFRAME_DEDUP_WINDOW_MS` | 200 | background.js | Iframe processing deduplication |
| `OPERATION_LOCK_MS` | 500 | QuickTabMediator | Operation lock timeout |
| `DOM_VERIFICATION_DELAY_MS` | 500 | quick-tabs-manager.js | **v1.6.3.5-v2:** DOM verify timing |
| `RENDER_COOLDOWN_MS` | 1000 | UICoordinator | Prevent duplicate renders |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | content.js | Restore message deduplication |

### Tab ID Prefixed Logging

All VisibilityHandler logs now include Tab ID for cross-tab debugging:

```javascript
this._logPrefix = `[VisibilityHandler][Tab ${options.currentTabId ?? 'unknown'}]`;
console.log(`${this._logPrefix} Minimize button clicked for:`, id);
```

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
| `generateSaveId()` | Unique saveId for deduplication |
| `persistStateToStorage()` | Write with `prevTransaction`/`queueDepth` logging |
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

### Clear-on-First-Use + Restore Lock

`_restoreInProgress` Set prevents duplicate windows during restore operations.

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
- `background.js` - Consecutive read validation, iframe deduplication (200ms window)
- `src/content.js` - `beforeunload` handler, message deduplication (2000ms)
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings
- `src/utils/storage-utils.js` - `prevTransaction`, `queueDepth` logging, **v1.6.3.5-v2:** `originTabId` serialization
- `src/features/quick-tabs/state-machine.js`:
  - QuickTabStateMachine class
  - States: UNKNOWN, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED
  - `getStateMachine()` singleton access
- `src/features/quick-tabs/mediator.js`:
  - QuickTabMediator class
  - `minimize()`, `restore()`, `destroy()` with state validation
  - `executeWithRollback()` for atomic operations
- `src/features/quick-tabs/map-transaction-manager.js`:
  - MapTransactionManager class
  - `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`
  - Full Map contents logging at every operation
- `src/features/quick-tabs/handlers/CreateHandler.js`:
  - **v1.6.3.5-v2:** `originTabId` support for cross-tab filtering
- `src/features/quick-tabs/index.js`:
  - **v1.6.3.5-v2:** `_shouldFilterByOriginTabId()` cross-tab filtering
- `src/features/quick-tabs/coordinators/UICoordinator.js`:
  - Z-index tracking, `_safeClearRenderedTabs(userInitiated)`
  - `_verifyAllTabsDOMDetached()`, duplicate prevention
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - `_activeTimerIds` Set for debounce (replaces generation counters)
  - **v1.6.3.5-v2:** `_logPrefix` with Tab ID for cross-tab debugging
- `src/features/quick-tabs/minimized-manager.js`:
  - `_restoreInProgress` Set for restore lock
  - Clear-on-first-use pattern, `validateStateConsistency()`
- `sidebar/quick-tabs-manager.js`:
  - `PENDING_OPERATIONS` Set, `_reconcileWithContentScripts()`
  - **v1.6.3.5-v2:** `STORAGE_READ_DEBOUNCE_MS` (50ms), `DOM_VERIFICATION_DELAY_MS` (500ms)

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quickTabShowDebugId` (storage.local)

**State Format:**
```javascript
{
  tabs: [{
    id: 'unique-id',
    originTabId: 12345,  // v1.6.3.5-v2: Track originating browser tab
    domVerified: true,
    zIndex: 1000,
    // ... other tab properties
  }],
  saveId: 'unique-id',
  timestamp: Date.now()
}
```

### Manager Action Messages

- `CLOSE_QUICK_TAB` - Close a specific Quick Tab
- `CLOSE_MINIMIZED_QUICK_TABS` - Close all minimized Quick Tabs
- `MINIMIZE_QUICK_TAB` - Minimize a Quick Tab (removes DOM)
- `RESTORE_QUICK_TAB` - Restore a minimized Quick Tab (2000ms dedup)

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
