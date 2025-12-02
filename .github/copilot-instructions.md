# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.4-v11  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged exclusively**
- Direct local creation pattern
- **State hydration on page reload** (v1.6.3.4+)

**v1.6.3.4-v11 Key Features (8 Critical Fixes):**
- **QuickTabsManager.destroy():** Proper cleanup with `beforeunload` handler for storage listener memory leak
- **Message Deduplication:** 2000ms window for RESTORE_QUICK_TAB, 200ms for iframe processing
- **Background Cache Validation:** Consecutive read validation before clearing cache
- **Atomic Snapshot Clear:** `clearSnapshot()` pattern for clear-on-first-use
- **Safe Rendered Tabs Clearing:** `_safeClearRenderedTabs()` with comprehensive logging
- **Callback Verification:** `_verifyCallbacksAfterRestore()` ensures callbacks exist post-restore
- **Background Isolation:** Background storage.onChanged only updates its own cache
- **Empty Write Warning:** Explicit warning when writing 0 tabs without forceEmpty flag

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

## 🔧 Storage Utilities

**Location:** `src/utils/storage-utils.js`

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key constant (`quick_tabs_state_v2`) |
| `generateSaveId()` | Generate unique saveId for deduplication |
| `getBrowserStorageAPI()` | Get browser/chrome storage API |
| `buildStateForStorage(map, minMgr)` | Build state from quickTabsMap |
| `persistStateToStorage(state, prefix, forceEmpty)` | **v11:** Warns when writing 0 tabs without forceEmpty |
| `queueStorageWrite(writeOperation)` | Queue write, resets on failure |
| `IN_PROGRESS_TRANSACTIONS` | Set for transaction tracking |
| `isValidQuickTabUrl(url)` | Validate URL for Quick Tab |
| `EMPTY_WRITE_COOLDOWN_MS` | 1000ms cooldown between empty writes |
| `beginTransaction(logPrefix)` | Start transaction, capture snapshot |
| `commitTransaction(logPrefix)` | Complete transaction, clear snapshot |
| `rollbackTransaction(logPrefix)` | Restore snapshot on failure |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns (v1.6.3.4-v11)

### Timing Constants Reference

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | VisibilityHandler | Suppress circular callbacks |
| `STATE_EMIT_DELAY_MS` | 100 | VisibilityHandler | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | VisibilityHandler | Storage persist after state |
| `IFRAME_DEDUP_WINDOW_MS` | 200 | background.js | Iframe processing deduplication |
| `STORAGE_READ_DEBOUNCE_MS` | 300 | quick-tabs-manager.js | Debounce storage reads |
| `SNAPSHOT_CLEAR_DELAY_MS` | 400 | UICoordinator | Allows double-clicks |
| `RENDER_COOLDOWN_MS` | 1000 | UICoordinator | Prevent duplicate renders |
| `EMPTY_WRITE_COOLDOWN_MS` | 1000 | storage-utils.js | Prevent empty write cascades |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | content.js | Restore message deduplication |

### Generation Counter Debounce

```javascript
// VisibilityHandler uses generation counters to prevent timer callback corruption
this._timerGeneration = new Map();
_debouncedPersist(id) {
  const currentGen = (this._timerGeneration.get(id) || 0) + 1;
  this._timerGeneration.set(id, currentGen);
  setTimeout(() => {
    if (this._timerGeneration.get(id) === currentGen) this._persist(id);
  }, DEBOUNCE_MS);
}
```

### Look-Ahead Pattern

```javascript
// UICoordinator determines final state BEFORE Map modifications
_handleDetachedDOMUpdate(ctx) {
  const willRender = !entityMinimized && (!instanceMinimized || isRestoreOperation);
  if (!willRender) this._safeDeleteFromRenderedTabs(id, 'final state minimized');
}
```

### 64-bit Hash Function

```javascript
_computeStateHash(state) {
  const str = JSON.stringify(state);
  return { lo: djb2Hash(str), hi: sdbmHash(str) };
}
```

### Batch Set Pattern

```javascript
this._batchOperationIds = new Set();
closeAll() {
  for (const id of quickTabsMap.keys()) this._batchOperationIds.add(id);
}
```

### Storage Queue Reset

```javascript
async function queueStorageWrite(writeOperation) {
  try { return await writeOperation(); }
  catch (error) { _writeQueue = Promise.resolve(); throw error; }
}
```

### Transaction Pattern

```javascript
const started = await beginTransaction('[Handler]');
try { /* op */ commitTransaction('[Handler]'); }
catch (error) { await rollbackTransaction('[Handler]'); }
```

### Message Deduplication (v11)

```javascript
const RESTORE_DEDUP_WINDOW_MS = 2000;
const _restoreMessageTimestamps = new Map();
function _isDuplicateRestoreMessage(id) {
  const last = _restoreMessageTimestamps.get(id);
  if (last && (Date.now() - last) < RESTORE_DEDUP_WINDOW_MS) return true;
  _restoreMessageTimestamps.set(id, Date.now());
  return false;
}
```

### Atomic Snapshot Clear (v11)

```javascript
// UICoordinator calls clearSnapshot() after successful render
this.minimizedManager.clearSnapshot(quickTabId);
```

### Consecutive Read Validation (v11)

```javascript
let consecutiveZeroTabReads = 0;
if (consecutiveZeroTabReads < 2) return; // Wait for validation
```

### QuickTabsManager.destroy() (v11)

```javascript
destroy() {
  if (!this.initialized) return;
  this.memoryGuard?.stopMonitoring();
  this.createHandler?.destroy();
  this.closeAll();
  this.internalEventBus?.removeAllListeners?.();
  this.initialized = false;
}
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
- `background.js` - **v11:** Consecutive read validation, iframe deduplication (200ms window)
- `src/content.js` - **v11:** `beforeunload` handler calls `quickTabsManager.destroy()`, message deduplication (2000ms)
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings
- `src/utils/storage-utils.js` - **v11:** Warns when writing 0 tabs without forceEmpty
- `src/utils/dom.js` - DOM utilities including `cleanupOrphanedQuickTabElements()`
- `src/features/quick-tabs/coordinators/UICoordinator.js`:
  - Z-index tracking with `_highestZIndex`, `_getNextZIndex()`
  - **v11:** `_safeClearRenderedTabs()` with comprehensive logging
  - **v11:** `_verifyCallbacksAfterRestore()` ensures callbacks exist
  - Atomic snapshot clear with `clearSnapshot()`
- `src/features/quick-tabs/index.js`:
  - `_hydrateMinimizedTab()` creates real QuickTabWindow instances
  - **v11:** `destroy()` method for proper cleanup
- `src/features/quick-tabs/handlers/CreateHandler.js`:
  - **v11:** `destroy()` method removes storage listener
  - Uses `storage.local` with key `quickTabShowDebugId`
- `src/features/quick-tabs/handlers/DestroyHandler.js`:
  - `_batchOperationIds` Set replaces `_batchMode` boolean
- `src/features/quick-tabs/handlers/UpdateHandler.js`:
  - `_computeStateHash()` returns `{lo, hi}` 64-bit hash
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - `_timerGeneration` Map for debounce generation counters
  - `_fetchEntityFromStorage()` fetches complete entity
  - `_validateEventPayload()` prevents incomplete events
  - `_validateRestorePreconditions()` validates before restore
  - `_initiatedOperations` Set for callback suppression
- `src/features/quick-tabs/window.js`:
  - `restore()` only updates `this.minimized = false` + `onFocus()`
  - `DEFAULT_WIDTH/HEIGHT/LEFT/TOP` constants
- `src/features/quick-tabs/minimized-manager.js`:
  - **v11:** `clearSnapshot()` atomic clear-on-first-use
- `sidebar/quick-tabs-manager.js`:
  - `PENDING_OPERATIONS` Set tracks in-progress minimize/restore
  - `_reconcileWithContentScripts()` detects storage corruption
  - `_showErrorNotification()` for user feedback

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quickTabShowDebugId` (storage.local, individual key)

**CRITICAL:** Use `storage.local` for Quick Tab state AND settings.

**State Format:**
```javascript
{
  tabs: [...],           // Array with domVerified, zIndex properties
  saveId: 'unique-id',
  timestamp: Date.now()
}
```

### Manager Action Messages

Content script handles these messages from Manager:
- `CLOSE_QUICK_TAB` - Close a specific Quick Tab
- `CLOSE_MINIMIZED_QUICK_TABS` - Close all minimized Quick Tabs
- `MINIMIZE_QUICK_TAB` - Minimize a Quick Tab (removes DOM)
- `RESTORE_QUICK_TAB` - Restore a minimized Quick Tab (**v11:** 2000ms deduplication window)

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
