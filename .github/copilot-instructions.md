# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.5  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged exclusively**
- Direct local creation pattern
- **State hydration on page reload**

**v1.6.3.5 Architecture (5 Critical Fixes + 3 New Modules):**

**New Modules:**
- **QuickTabStateMachine** (`state-machine.js`) - Explicit lifecycle state tracking
- **QuickTabMediator** (`mediator.js`) - Operation coordination with rollback
- **MapTransactionManager** (`map-transaction-manager.js`) - Atomic Map operations

**Fixes:**
- **Issue 1: Map Size Corruption** - MapTransactionManager with rollback
- **Issue 2: 73-Second Logging Gap** - Comprehensive Map contents logging
- **Issue 3: Duplicate Windows** - Clear-on-first-use + restore-in-progress lock
- **Issue 4: Debounce Timer Skips** - `_activeTimerIds` Set approach
- **Issue 5: Missing Write Logs** - `prevTransaction`/`queueDepth` logging

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

## 🆕 v1.6.3.5 New Architecture Classes

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
| `STATE_KEY` | Storage key constant (`quick_tabs_state_v2`) |
| `generateSaveId()` | Generate unique saveId for deduplication |
| `getBrowserStorageAPI()` | Get browser/chrome storage API |
| `buildStateForStorage(map, minMgr)` | Build state from quickTabsMap |
| `persistStateToStorage(state, prefix, forceEmpty)` | **v12:** Write initiator logging with file, op type, tab count |
| `queueStorageWrite(writeOperation)` | Queue write, resets on failure |
| `IN_PROGRESS_TRANSACTIONS` | Set for transaction tracking |
| `isValidQuickTabUrl(url)` | Validate URL for Quick Tab |
| `EMPTY_WRITE_COOLDOWN_MS` | 1000ms cooldown between empty writes |
| `beginTransaction(logPrefix)` | Start transaction, capture snapshot |
| `commitTransaction(logPrefix)` | Complete transaction, clear snapshot |
| `rollbackTransaction(logPrefix)` | Restore snapshot on failure |
| `pendingWriteCount` | **v12:** Tracks pending write operations |
| `lastCompletedTransactionId` | **v12:** Tracks transaction sequencing |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns (v1.6.3.5)

### Timing Constants Reference

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | VisibilityHandler | Suppress circular callbacks |
| `STATE_EMIT_DELAY_MS` | 100 | VisibilityHandler | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | VisibilityHandler | Storage persist after state |
| `IFRAME_DEDUP_WINDOW_MS` | 200 | background.js | Iframe processing deduplication |
| `OPERATION_LOCK_MS` | 500 | QuickTabMediator | Operation lock timeout |
| `RENDER_COOLDOWN_MS` | 1000 | UICoordinator | Prevent duplicate renders |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | content.js | Restore message deduplication |

### Active Timer IDs Pattern (v1.6.3.5)

```javascript
// VisibilityHandler uses _activeTimerIds Set instead of generation counters
// Old approach: generation counter - ALL timers skip on rapid operations
// New approach: Each timer has unique ID, checks if still in Set
this._activeTimerIds = new Set();
this._timerIdCounter = 0;
_debouncedPersist(id) {
  const timerId = `${id}-${++this._timerIdCounter}`;
  this._activeTimerIds.add(timerId);
  setTimeout(() => {
    if (this._activeTimerIds.has(timerId)) {
      this._activeTimerIds.delete(timerId);
      this._persist(id);
    }
  }, DEBOUNCE_MS);
}
```

### State Machine Pattern (v1.6.3.5)

```javascript
// QuickTabStateMachine validates transitions before operations
const stateMachine = getStateMachine();
if (stateMachine.canTransition(id, QuickTabState.MINIMIZING)) {
  stateMachine.transition(id, QuickTabState.MINIMIZING, { source: 'user' });
  // Perform minimize...
  stateMachine.transition(id, QuickTabState.MINIMIZED, { source: 'user' });
}
```

### Map Transaction Pattern (v1.6.3.5)

```javascript
// MapTransactionManager wraps all Map operations
const txnManager = new MapTransactionManager(renderedTabs, 'renderedTabs');
txnManager.beginTransaction('minimize operation');
txnManager.deleteEntry(id, 'tab minimized');
const result = txnManager.commitTransaction({ expectedSize: renderedTabs.size });
if (!result.success) txnManager.rollbackTransaction();
```

### Clear-on-First-Use + Restore Lock (v1.6.3.5)

```javascript
// MinimizedManager prevents duplicate windows
this._restoreInProgress = new Set();
getSnapshotForRestore(id) {
  if (this._restoreInProgress.has(id)) return null;
  this._restoreInProgress.add(id);
  setTimeout(() => this._restoreInProgress.delete(id), RESTORE_LOCK_DURATION_MS);
  return this._snapshots.get(id);
}
```

### Storage Queue Logging (v1.6.3.5)

```javascript
// Enhanced write logging with prevTransaction and queueDepth
console.log('[storage-utils] Write:', {
  prevTransaction: lastCompletedTransactionId,
  queueDepth: pendingWriteCount,
  tabCount: state.tabs.length
});
```

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
- `src/utils/storage-utils.js` - **v1.6.3.5:** `prevTransaction`, `queueDepth` logging
- `src/features/quick-tabs/state-machine.js`:
  - **NEW v1.6.3.5:** QuickTabStateMachine class
  - States: UNKNOWN, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED
  - `getStateMachine()` singleton access
- `src/features/quick-tabs/mediator.js`:
  - **NEW v1.6.3.5:** QuickTabMediator class
  - `minimize()`, `restore()`, `destroy()` with state validation
  - `executeWithRollback()` for atomic operations
- `src/features/quick-tabs/map-transaction-manager.js`:
  - **NEW v1.6.3.5:** MapTransactionManager class
  - `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`
  - Full Map contents logging at every operation
- `src/features/quick-tabs/coordinators/UICoordinator.js`:
  - Z-index tracking, `_safeClearRenderedTabs(userInitiated)`
  - `_verifyAllTabsDOMDetached()`, duplicate prevention
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - **v1.6.3.5:** `_activeTimerIds` Set for debounce (replaces generation counters)
  - `_fetchEntityFromStorage()`, `_validateEventPayload()`
- `src/features/quick-tabs/minimized-manager.js`:
  - **v1.6.3.5:** `_restoreInProgress` Set for restore lock
  - Clear-on-first-use pattern, `validateStateConsistency()`
- `sidebar/quick-tabs-manager.js`:
  - `PENDING_OPERATIONS` Set, `_reconcileWithContentScripts()`

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quickTabShowDebugId` (storage.local)

**State Format:**
```javascript
{
  tabs: [...],           // Array with domVerified, zIndex properties
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
