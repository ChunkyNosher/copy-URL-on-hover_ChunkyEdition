# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.4  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged exclusively**
- Direct local creation pattern
- **State hydration on page reload** (v1.6.3.4)

**v1.6.3.4 Key Features:**
- **State Hydration:** `_initStep6_Hydrate()` restores Quick Tabs from storage on page reload
- **Source Tracking:** All actions log source ('Manager', 'UI', 'hydration', 'automation')
- **Z-Index Persistence:** Focus changes persist z-index to storage immediately
- **Unified Destroy Path:** UI close button uses DestroyHandler for consistent cleanup

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

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns (v1.6.3.4)

### State Hydration on Page Reload (v1.6.3.4)

```javascript
// index.js - _initStep6_Hydrate() restores Quick Tabs from storage
async _hydrateStateFromStorage() {
  const { quick_tabs_state_v2: storedState } = await browser.storage.local.get('quick_tabs_state_v2');
  if (!storedState?.tabs?.length) return;
  // Hydrate each tab, repopulate Map and DOM
}
```

### Source Tracking Pattern (v1.6.3.4)

```javascript
// All handlers accept source parameter for logging
handleMinimize(id, source = 'UI') {
  console.log(`[VisibilityHandler] Minimizing ${id} from ${source}`);
}
// Sources: 'Manager', 'UI', 'hydration', 'automation'
```

### Z-Index Persistence (v1.6.3.4)

```javascript
// VisibilityHandler.handleFocus() persists z-index to storage
async handleFocus(id) {
  // Increment z-index and persist immediately
  await persistStateToStorage(state, '[VisibilityHandler.handleFocus]');
}
// serializeTabForStorage() includes zIndex field
// UpdateHandler includes zIndex in state hash for change detection
```

### Unified Destroy Path (v1.6.3.4)

```javascript
// UI close button now uses DestroyHandler for consistent cleanup
// Manager and UI closes both call DestroyHandler
// Proper storage cleanup on all closes
```

### Z-Index Tracking (v1.6.3.3+)

```javascript
// UICoordinator tracks highest z-index in memory
this._highestZIndex = CONSTANTS.QUICK_TAB_BASE_Z_INDEX;
_getNextZIndex() { this._highestZIndex++; return this._highestZIndex; }
```

### UID Truncation (v1.6.3.3+)

```javascript
// TitlebarBuilder shows LAST 12 chars (unique suffix)
const displayId = id.length > 15 ? '...' + id.slice(-12) : id;
```

### Constants Reference

| Constant | Value | Location |
|----------|-------|----------|
| `DOM_VERIFICATION_DELAY_MS` | 150 | UICoordinator |
| `DOM_MONITORING_INTERVAL_MS` | 500 | UICoordinator |
| `STATE_EMIT_DELAY_MS` | 200 | VisibilityHandler |
| `DEFAULT_WIDTH/HEIGHT` | 400/300 | QuickTabWindow |

### Consistent Minimized State Detection

```javascript
const isMinimized = tab.minimized ?? tab.visibility?.minimized ?? false;
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
- `src/utils/storage-utils.js` - Shared storage utilities with async persist
- `src/utils/dom.js` - DOM utilities including `cleanupOrphanedQuickTabElements()`
- `src/features/quick-tabs/coordinators/UICoordinator.js`:
  - Z-index tracking with `_highestZIndex`, `_getNextZIndex()`
  - DOM re-render recovery on unexpected detachment
  - Unified settings loading from `storage.local`
  - `DOM_VERIFICATION_DELAY_MS = 150`, `DOM_MONITORING_INTERVAL_MS = 500`
- `src/features/quick-tabs/index.js`:
  - DestroyHandler receives `internalEventBus` for state:deleted
  - **v1.6.3.4:** `_initStep6_Hydrate()` for page reload hydration
- `src/features/quick-tabs/handlers/CreateHandler.js`:
  - Uses `storage.local` with key `quickTabShowDebugId`
  - **`async init()`** with storage fallback pattern
- `src/features/quick-tabs/handlers/DestroyHandler.js`:
  - Debounced batch writes, **`_batchMode`**
  - **v1.6.3.4:** Source parameter for logging
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - `STATE_EMIT_DELAY_MS = 200`, `_operationLocks` mutex
  - Re-registers window in quickTabsMap after restore
  - **v1.6.3.4:** Source parameter, z-index persistence on focus
- `src/features/quick-tabs/handlers/UpdateHandler.js`:
  - **v1.6.3.4:** zIndex included in state hash for change detection
- `src/features/quick-tabs/minimized-manager.js` - Snapshot lifecycle with pendingClearSnapshots
- `src/features/quick-tabs/window.js` - `DEFAULT_WIDTH/HEIGHT/LEFT/TOP` constants
- `src/features/quick-tabs/window/TitlebarBuilder.js`:
  - Shows LAST 12 chars of UID (unique suffix)
  - `updateDebugIdDisplay(showDebugId)`
- `src/utils/storage-utils.js`:
  - Shared storage utilities with async persist
  - **v1.6.3.4:** `serializeTabForStorage()` includes zIndex field
- `sidebar/quick-tabs-manager.js` - `_getIndicatorClass()` returns 'orange' when `domVerified=false`
- `sidebar/settings.html` - UID display checkbox in Advanced tab
- `sidebar/settings.js` - `quickTabShowDebugId` in DEFAULT_SETTINGS

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
