# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.4-v9  
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

**v1.6.3.4-v9 Key Features (Restore State Wipe Fixes - Issues #14-#20):**
- **Complete Event Payload:** `_fetchEntityFromStorage()` fetches complete entity when tabWindow null
- **Event Payload Validation:** `_validateEventPayload()` prevents incomplete event emission
- **Enhanced _createQuickTabData:** Includes position, size, container, zIndex
- **Restore Precondition Validation:** `_validateRestorePreconditions()` validates entity before operations
- **Manager Restore Validation:** `restoreQuickTab()` validates tab is minimized before message
- **Transaction Pattern:** `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` with snapshots
- **Storage Reconciliation:** Manager detects suspicious storage changes (count drop to 0) and reconciles
- **Error Notifications:** `_showErrorNotification()` for user feedback

**v1.6.3.4-v8 Key Features (Storage & Sync Fixes):**
- **Empty Write Protection:** `_shouldRejectEmptyWrite()` + `forceEmpty` param, 1s cooldown
- **FIFO Storage Write Queue:** `queueStorageWrite()` serializes all writes via Promise chain
- **Callback Suppression:** `_initiatedOperations` Set + `CALLBACK_SUPPRESSION_DELAY_MS = 50`
- **Focus Debounce:** `_lastFocusTime` Map with 100ms threshold
- **Safe Map Deletion:** `_safeDeleteFromRenderedTabs()` checks `has()` before `delete()`

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
| `persistStateToStorage(state, prefix, forceEmpty)` | **v8:** Added `forceEmpty` param (default false) |
| `queueStorageWrite(writeOperation)` | **v8:** Queue write for FIFO ordering |
| `IN_PROGRESS_TRANSACTIONS` | Set for transaction tracking |
| `isValidQuickTabUrl(url)` | Validate URL for Quick Tab |
| `EMPTY_WRITE_COOLDOWN_MS` | **v8:** 1000ms cooldown between empty writes |
| `beginTransaction(logPrefix)` | **v9:** Start transaction, capture snapshot |
| `commitTransaction(logPrefix)` | **v9:** Complete transaction, clear snapshot |
| `rollbackTransaction(logPrefix)` | **v9:** Restore snapshot on failure |
| `captureStateSnapshot(logPrefix)` | **v9:** Capture current storage state |
| `isTransactionActive()` | **v9:** Check if transaction in progress |
| `getStateSnapshot()` | **v9:** Get current snapshot |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns (v1.6.3.4-v9)

### Timing Constants Reference

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | VisibilityHandler | **v8:** Suppress circular callbacks |
| `STATE_EMIT_DELAY_MS` | 100 | VisibilityHandler | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | VisibilityHandler | Storage persist after state |
| `STORAGE_READ_DEBOUNCE_MS` | 300 | quick-tabs-manager.js | Debounce storage reads |
| `SNAPSHOT_CLEAR_DELAY_MS` | 400 | UICoordinator | Allows double-clicks |
| `RENDER_COOLDOWN_MS` | 1000 | UICoordinator | Prevent duplicate renders |
| `EMPTY_WRITE_COOLDOWN_MS` | 1000 | storage-utils.js | **v8:** Prevent empty write cascades |

### Transaction Pattern (v1.6.3.4-v9)

```javascript
import { beginTransaction, commitTransaction, rollbackTransaction } from '@utils/storage-utils.js';

const started = await beginTransaction('[HandlerName]');
if (!started) { /* handle error */ }
try {
  // ... multi-step operation
  commitTransaction('[HandlerName]');
} catch (error) {
  await rollbackTransaction('[HandlerName]');
}
```

### Restore Validation Pattern (v1.6.3.4-v9)

```javascript
// VisibilityHandler validates before proceeding
const validation = this._validateRestorePreconditions(tabWindow, id, source);
if (!validation.valid) {
  return { success: false, error: validation.error };
}
```

### Complete Event Payload Pattern (v1.6.3.4-v9)

```javascript
// Fetch from storage when tabWindow is null
if (!tabWindow) {
  const entity = await this._fetchEntityFromStorage(id);
  if (!entity) return; // Cannot emit incomplete event
  // Build complete payload from storage entity
}
// Validate before emitting
const validation = this._validateEventPayload(quickTabData);
if (!validation.valid) return;
```

### Empty Write Protection (v1.6.3.4-v8)

```javascript
// Use forceEmpty=true ONLY for explicit user-initiated "Clear All"
await persistStateToStorage(state, '[Handler]', false); // Normal - rejects empty
await persistStateToStorage(state, '[Handler]', true);  // Allow empty for Clear All
```

### FIFO Queue Pattern (v1.6.3.4-v8)

```javascript
import { queueStorageWrite } from '@utils/storage-utils.js';
await queueStorageWrite(async () => {
  // your async storage operation - serialized via Promise chain
  return true;
});
```

### Callback Suppression Pattern (v1.6.3.4-v8)

```javascript
// Track initiated operation to suppress callbacks
this._initiatedOperations.add(`minimize-${id}`);
try {
  tabWindow.minimize(); // This may fire callback
} finally {
  setTimeout(() => this._initiatedOperations.delete(`minimize-${id}`), 50);
}
```

### Safe Map Deletion (v1.6.3.4-v8)

```javascript
// Check has() before delete() to prevent double-deletion
_safeDeleteFromRenderedTabs(id) {
  if (this._renderedTabs.has(id)) {
    this._renderedTabs.delete(id);
  } else {
    console.warn(`Attempted to delete non-existent entry: ${id}`);
  }
}
```

### Try/Finally Lock Pattern (v1.6.3.4-v7)

```javascript
async handleRestore(id) {
  const lock = this._acquireLock(id);
  try {
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    this._releaseLock(lock); // Guaranteed cleanup
  }
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
- `background.js` - Background script, storage listeners, saveId tracking
- `src/content.js` - Content script, Quick Tab creation, Manager action handlers
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings
- `src/utils/storage-utils.js` - **v9:** Transaction pattern (`beginTransaction`, `commitTransaction`, `rollbackTransaction`)
- `src/utils/dom.js` - DOM utilities including `cleanupOrphanedQuickTabElements()`
- `src/features/quick-tabs/coordinators/UICoordinator.js`:
  - Z-index tracking with `_highestZIndex`, `_getNextZIndex()`
  - **v8:** `_safeDeleteFromRenderedTabs()` helper method
- `src/features/quick-tabs/index.js`:
  - `_hydrateMinimizedTab()` creates real QuickTabWindow instances
- `src/features/quick-tabs/handlers/CreateHandler.js`:
  - Uses `storage.local` with key `quickTabShowDebugId`
- `src/features/quick-tabs/handlers/DestroyHandler.js`:
  - Debounced batch writes, **`_batchMode`**
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - **v9:** `_fetchEntityFromStorage()` fetches complete entity
  - **v9:** `_validateEventPayload()` prevents incomplete events
  - **v9:** `_validateRestorePreconditions()` validates before restore
  - **v9:** `_createQuickTabData()` includes position, size, container
  - **v8:** `_initiatedOperations` Set for callback suppression
  - try/finally pattern guarantees `_releaseLock()` on all paths
- `src/features/quick-tabs/window.js`:
  - `DEFAULT_WIDTH/HEIGHT/LEFT/TOP` constants
- `sidebar/quick-tabs-manager.js`:
  - `PENDING_OPERATIONS` Set tracks in-progress minimize/restore
  - **v9:** `_reconcileWithContentScripts()` detects storage corruption
  - **v9:** `_showErrorNotification()` for user feedback
  - **v9:** `restoreQuickTab()` validates tab is minimized before restore

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
- `RESTORE_QUICK_TAB` - Restore a minimized Quick Tab (UICoordinator handles rendering)

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
