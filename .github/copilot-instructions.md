# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.4-v7  
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

**v1.6.3.4-v7 Key Features (Hydration Architecture Fixes):**
- **Real QuickTabWindow Hydration:** `_hydrateMinimizedTab()` creates actual instances via factory
- **Instance Validation:** Check `typeof tabWindow.render === 'function'` before operations
- **URL Validation in Render:** UICoordinator validates URL before `_createWindow()`
- **Try/Finally Lock Pattern:** Guaranteed lock cleanup in VisibilityHandler
- **Handler Return Objects:** `handleMinimize/handleRestore` return `{ success, error }`
- **State Events on Hydration:** emit `state:added` for hydrated tabs

**v1.6.3.4-v6 Key Features (Storage Race Condition Fixes):**
- **Transactional Storage:** `IN_PROGRESS_TRANSACTIONS` Set prevents concurrent writes
- **URL Validation:** `isValidQuickTabUrl()` prevents ghost iframes
- **Debounced Storage Reads:** `STORAGE_READ_DEBOUNCE_MS = 300ms` in Manager
- **Write Deduplication:** `computeStateHash()` and `hasStateChanged()` prevent redundant writes

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
| `persistStateToStorage(state, prefix)` | **Async** persist with 5-second timeout |
| `IN_PROGRESS_TRANSACTIONS` | **v6:** Set for transaction tracking |
| `generateTransactionId()` | **v6:** Create unique transaction ID |
| `isValidQuickTabUrl(url)` | **v6:** Validate URL for Quick Tab |
| `computeStateHash(state)` | **v6:** Hash state for comparison |
| `hasStateChanged(old, new)` | **v6:** Compare states by hash |
| `shouldProcessStorageChange()` | **v6:** Check if change should be processed |
| `validateStateForPersist(state)` | **v6:** Validate state before persist |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns (v1.6.3.4-v7)

### Timing Constants Reference

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `STATE_EMIT_DELAY_MS` | 100 | VisibilityHandler | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | VisibilityHandler | Storage persist after state |
| `STORAGE_READ_DEBOUNCE_MS` | 300 | quick-tabs-manager.js | Debounce storage reads |
| `SNAPSHOT_CLEAR_DELAY_MS` | 400 | UICoordinator | Allows double-clicks |
| `STORAGE_COOLDOWN_MS` | 50 | background.js | Prevent duplicate processing |
| `RENDER_COOLDOWN_MS` | 1000 | UICoordinator | Prevent duplicate renders |
| `DOM_VERIFICATION_DELAY_MS` | 150 | UICoordinator | DOM verification |
| `DOM_MONITORING_INTERVAL_MS` | 500 | UICoordinator | Monitor DOM presence |

### Real QuickTabWindow Hydration (v1.6.3.4-v7)

```javascript
// _hydrateMinimizedTab() creates REAL instances, not plain objects
const tabWindow = createQuickTabWindow(tabData, this.internalEventBus, dependencies);
this.quickTabsMap.set(tabData.id, tabWindow);
this.internalEventBus.emit('state:added', { quickTab: tabWindow });
```

### Instance Validation Pattern (v1.6.3.4-v7)

```javascript
// Validate instance before calling methods
if (typeof tabWindow.render !== 'function') {
  throw new Error('Invalid QuickTabWindow instance');
}
```

### Try/Finally Lock Pattern (v1.6.3.4-v7)

```javascript
async handleRestore(id) {
  const lock = this._acquireLock(id);
  try {
    // restore logic
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    this._releaseLock(lock); // Guaranteed cleanup
  }
}
```

### Handler Return Objects (v1.6.3.4-v7)

```javascript
// Handlers return { success, error } for proper error propagation
const result = await visibilityHandler.handleRestore(id);
if (!result.success) {
  sendResponse({ success: false, error: result.error });
}
```

### URL Validation in Render (v1.6.3.4-v7)

```javascript
render(quickTab) {
  if (!quickTab.url) {
    console.warn('Cannot render Quick Tab with undefined URL');
    return;
  }
  // proceed with render
}
```

### Entity-Instance Same Object Pattern

```javascript
const entity = this.quickTabsMap.get(id);
entity.minimized = false; // Updates both entity AND instance
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
- `src/content.js` - Content script, Quick Tab creation, Manager action handlers, **v7:** checks result.success
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings
- `src/utils/storage-utils.js` - Shared storage utilities with async persist
- `src/utils/dom.js` - DOM utilities including `cleanupOrphanedQuickTabElements()`
- `src/features/quick-tabs/coordinators/UICoordinator.js`:
  - Z-index tracking with `_highestZIndex`, `_getNextZIndex()`
  - DOM re-render recovery on unexpected detachment
  - **v1.6.3.4-v7:** URL validation in render(), `_renderTimestamps` Map, `RENDER_COOLDOWN_MS = 1000`
- `src/features/quick-tabs/index.js`:
  - **v1.6.3.4-v7:** `_hydrateMinimizedTab()` creates real QuickTabWindow instances
  - **v1.6.3.4-v7:** Hydration emits `state:added` events for UICoordinator tracking
- `src/features/quick-tabs/handlers/CreateHandler.js`:
  - Uses `storage.local` with key `quickTabShowDebugId`
  - **`async init()`** with storage fallback pattern
- `src/features/quick-tabs/handlers/DestroyHandler.js`:
  - Debounced batch writes, **`_batchMode`**
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - **v1.6.3.4-v7:** `handleMinimize/handleRestore` return `{ success, error }` objects
  - **v1.6.3.4-v7:** try/finally pattern guarantees `_releaseLock()` on all paths
  - Entity state updated FIRST in handleMinimize/handleRestore before instance
- `src/features/quick-tabs/window.js`:
  - `DEFAULT_WIDTH/HEIGHT/LEFT/TOP` constants
  - **v1.6.3.4-v7:** Window creation wrapped in try/catch, returns null on failure
- `src/features/quick-tabs/window/DragController.js`:
  - `destroyed` flag prevents stale callbacks after destroy
- `sidebar/quick-tabs-manager.js`:
  - `PENDING_OPERATIONS` Set tracks in-progress minimize/restore
  - Buttons disabled while operation is pending

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
