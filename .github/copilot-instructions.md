# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.4.5  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged exclusively**
- Direct local creation pattern

**Recent Changes (v1.6.4.5):**
- **VisibilityHandler Debounce:** Prevents 200+ duplicate minimize events with `_pendingMinimize`/`_pendingRestore` Sets and 150ms per-tab debounce
- **UICoordinator Restore Fix:** `_applySnapshotForRestore()` applies saved position/size BEFORE rendering to prevent duplicates at (100,100)
- **Close Minimized Fix:** `closeMinimizedTabs()` collects IDs BEFORE filtering, sends `CLOSE_QUICK_TAB` to all browser tabs
- **Backwards Compatibility:** `CLOSE_MINIMIZED_QUICK_TABS` handler added to content.js

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

## 🔧 QuickTabsManager API (v1.6.4.5)

### Correct Methods

| Method | Description |
|--------|-------------|
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()` | Close all Quick Tabs |

### Common Mistake

❌ `closeQuickTab(id)` - **DOES NOT EXIST** (use `closeById(id)` instead)

---

## 🔧 Storage Utilities (v1.6.4.5)

**Location:** `src/utils/storage-utils.js`

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key constant (`quick_tabs_state_v2`) |
| `generateSaveId()` | Generate unique saveId for deduplication |
| `getBrowserStorageAPI()` | Get browser/chrome storage API |
| `buildStateForStorage(map, minMgr)` | Build state from quickTabsMap |
| `persistStateToStorage(state, prefix)` | **Async** persist with 5-second timeout |

**Private Helpers:**
- `serializeTabForStorage(tab, isMinimized)` - Safe value serialization
- `validateStateSerializable(state)` - Pre-write JSON validation
- `_getNumericValue()` / `_getArrayValue()` - Safe property extraction

**Usage:**
```javascript
import { buildStateForStorage, persistStateToStorage } from '../utils/storage-utils.js';
const state = buildStateForStorage(quickTabsMap, minimizedManager);
const success = await persistStateToStorage(state, '[MyHandler]'); // Returns boolean
```

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Architecture Patterns (v1.6.4.5)

### VisibilityHandler Debounce Pattern (v1.6.4.5)

```javascript
// Prevent 200+ duplicate minimize events per click
this._pendingMinimize = new Set();
this._pendingRestore = new Set();
this._debounceTimers = new Map();

handleMinimize(id) {
  if (this._pendingMinimize.has(id)) return; // Skip duplicate
  this._pendingMinimize.add(id);
  // ... do work ...
  this._scheduleDebounce(id, 'minimize', 150);
}
```

### UICoordinator Restore Pattern (v1.6.4.5)

```javascript
// Apply snapshot BEFORE rendering to prevent duplicates at (100,100)
_applySnapshotForRestore(quickTab) {
  const snapshotData = this.minimizedManager.getSnapshot(quickTab.id);
  if (snapshotData) {
    quickTab.position = snapshotData.position;
    quickTab.size = snapshotData.size;
  }
}
```

### closeMinimizedTabs Pattern (v1.6.4.5)

```javascript
// Collect IDs BEFORE filtering, then send destroy to ALL browser tabs
closeMinimizedTabs() {
  const minimizedIds = state.tabs.filter(t => isTabMinimizedHelper(t)).map(t => t.id);
  // Filter state...
  for (const id of minimizedIds) {
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => browser.tabs.sendMessage(tab.id, { type: 'CLOSE_QUICK_TAB', id }));
    });
  }
}
```

### MinimizedManager Restore Pattern

```javascript
// restore() returns object with window and snapshot data
const result = minimizedManager.restore(id);
if (result) {
  const { window: tabWindow, savedPosition, savedSize } = result;
  tabWindow.setPosition(savedPosition.left, savedPosition.top);
  tabWindow.setSize(savedSize.width, savedSize.height);
}
```

### Consistent Minimized State Detection

Use this pattern everywhere for minimized state:
```javascript
const isMinimized = tab.minimized ?? tab.visibility?.minimized ?? false;
```

### UICoordinator Reconciliation

`reconcileRenderedTabs()` destroys orphaned windows and cleans up DOM:
```javascript
reconcileRenderedTabs() {
  for (const [id] of this.renderedTabs) {
    if (!this.stateManager.has(id)) {
      this.destroy(id);
    }
  }
  cleanupOrphanedQuickTabElements();
}
```

### state:cleared Event

Emitted by `closeAll()` to trigger full UI cleanup via `reconcileRenderedTabs()`.

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
- `background.js` - Background script, storage listeners, saveId tracking, synchronous gesture handlers
- `src/content.js` - Content script, Quick Tab creation, Manager action handlers, `CLOSE_MINIMIZED_QUICK_TABS` (v1.6.4.5)
- `src/utils/storage-utils.js` - Shared storage utilities with async persist
- `src/utils/dom.js` - DOM utilities including `cleanupOrphanedQuickTabElements()`
- `src/features/quick-tabs/coordinators/SyncCoordinator.js` - Cross-tab sync
- `src/features/quick-tabs/managers/StorageManager.js` - Storage operations
- `src/features/quick-tabs/managers/StateManager.js` - State management
- `src/features/quick-tabs/coordinators/UICoordinator.js` - UI rendering, `_applySnapshotForRestore()` (v1.6.4.5)
- `src/features/quick-tabs/handlers/DestroyHandler.js` - Debounced batch writes, `state:cleared` event
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Position/size updates with async persistence
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Solo/Mute, debounce mechanism (v1.6.4.5)
- `src/features/quick-tabs/minimized-manager.js` - Snapshot-based storage, `restore()` returns object
- `src/features/quick-tabs/window.js` - QuickTabWindow with null-safe `updateZIndex()`
- `sidebar/quick-tabs-manager.js` - Manager UI, `closeMinimizedTabs()` fix (v1.6.4.5)
- `sidebar/settings.js` - Sidebar initialization

### Storage Key & Format

**Storage Key:** `quick_tabs_state_v2`

**CRITICAL:** Use `storage.local` for Quick Tab state (NOT `storage.sync`)

**Unified Format (v1.6.4.5):**
```javascript
{
  tabs: [...],           // Array of Quick Tab objects
  saveId: 'unique-id',   // Deduplication ID (tracked by background.js)
  timestamp: Date.now()  // Last update timestamp
}
```

**Quick Tab Object:**
```javascript
{
  id: 'qt-xxx',
  url: 'https://...',
  title: 'Page Title',
  soloedOnTabs: [tabId1, tabId2],  // Show ONLY on these tabs
  mutedOnTabs: [tabId3],           // Hide on these tabs
  position: { x, y },
  size: { width, height }
}
```

### Manager Action Messages (v1.6.4.5)

Content script handles these messages from Manager:
- `CLOSE_QUICK_TAB` - Close a specific Quick Tab
- `CLOSE_MINIMIZED_QUICK_TABS` - Close all minimized Quick Tabs (v1.6.4.5 backwards compat)
- `MINIMIZE_QUICK_TAB` - Minimize a Quick Tab
- `RESTORE_QUICK_TAB` - Restore a minimized Quick Tab (uses snapshot data)

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
