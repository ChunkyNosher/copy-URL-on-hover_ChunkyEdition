# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.2  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged exclusively**
- Direct local creation pattern

**v1.6.3.2+ Architectural Patterns:**
- **UICoordinator Single Rendering Authority:** Only UICoordinator calls `render()` - uses `_verifyDOMAfterRender()` with `DOM_VERIFICATION_DELAY_MS = 150`
- **Mutex Pattern for Visibility:** `VisibilityHandler._operationLocks` prevents duplicate operations; `STATE_EMIT_DELAY_MS = 100` delays emit for DOM verification
- **MinimizedManager Changes:** `restore()` only applies snapshot with BEFORE/AFTER dimension logging, returns data
- **CreateHandler Async Init:** `async init()` loads `quickTabShowDebugId` setting from `QUICK_TAB_SETTINGS_KEY`
- **QuickTabWindow Defaults:** `DEFAULT_WIDTH = 400`, `DEFAULT_HEIGHT = 300`, `DEFAULT_LEFT = 100`, `DEFAULT_TOP = 100`
- **Close All Batch Mode:** `DestroyHandler._batchMode` prevents storage write storms (1 write vs 6+)

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

## 🔧 QuickTabsManager API (v1.6.3.2)

### Correct Methods

| Method | Description |
|--------|-------------|
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()` | Close all Quick Tabs |

### Common Mistake

❌ `closeQuickTab(id)` - **DOES NOT EXIST** (use `closeById(id)` instead)

---

## 🔧 Storage Utilities (v1.6.3.2)

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

## 🏗️ Key Architecture Patterns (v1.6.3.2)

### Restore Flow (v1.6.3.2 - UICoordinator as Single Rendering Authority)

```
VisibilityHandler.handleRestore()
    ↓
MinimizedManager.restore(id) → applies snapshot to instance, returns snapshot data
    ↓
emits 'state:updated' event
    ↓
UICoordinator.update(quickTab) → calls render() if needed
```

**Key Point:** `QuickTabWindow.restore()` NO LONGER calls `render()` directly. This prevents duplicate windows.

### Mutex Pattern for Visibility Operations (v1.6.3.2)

```javascript
// VisibilityHandler prevents duplicate minimize/restore operations
this._operationLocks = new Map();  // id → operation type

handleMinimize(id) {
  if (this._operationLocks.has(id)) return;  // Prevent duplicate
  this._operationLocks.set(id, 'minimize');
  // ... do work ...
  // Lock cleared after debounce timer completes
}
```

### MinimizedManager.restore() Pattern (v1.6.3.2)

```javascript
// restore() only applies snapshot, does NOT call tabWindow.restore()
restore(id) {
  const snapshot = this.getSnapshot(id);
  tabWindow.left = snapshot.savedPosition.left;
  tabWindow.top = snapshot.savedPosition.top;
  tabWindow.width = snapshot.savedSize.width;
  tabWindow.height = snapshot.savedSize.height;
  tabWindow.minimized = false;
  this.minimizedTabs.delete(id);
  return snapshot;  // Caller uses snapshot data
}
```

### DragController Destroyed Flag (v1.6.3.2)

```javascript
// Prevents ghost events after cleanup
class DragController {
  destroyed = false;
  
  destroy() {
    this.destroyed = true;
    // Remove event listeners...
  }
  
  onPointerMove(e) {
    if (this.destroyed) return;  // Guard against ghost events
    // ...
  }
}
```

### Close All Batch Mode (v1.6.3.2)

```javascript
// DestroyHandler prevents storage write storms during closeAll()
closeAll() {
  this._batchMode = true;  // Suppress individual storage writes
  try {
    for (const id of quickTabIds) {
      this.destroy(id);  // No storage write during batch
    }
  } finally {
    this._batchMode = false;
    this.persistState();  // Single storage write
  }
}
```

### QuickTabWindow.minimize() Pattern (v1.6.3.2)

```javascript
// minimize() pauses media, removes DOM, destroys controllers
minimize() {
  this._pauseMediaInIframe();          // Pause any playing video/audio
  this.dragController.destroy();       // Cleanup event listeners
  this.resizeController.detachAll();   // Cleanup resize handles
  this.container.remove();             // Actually remove from DOM
  this.container = null;
  this.rendered = false;
  this.onMinimize(this.id);
}
```

### UICoordinator DOM Verification (v1.6.4.7)

```javascript
const DOM_VERIFICATION_DELAY_MS = 150;  // Delay for async verification

_verifyDOMAfterRender(tabWindow, quickTabId) {
  // Immediate check
  if (!tabWindow.isRendered()) {
    console.error('[UICoordinator] Immediate DOM verification FAILED');
    return;
  }
  // Delayed verification catches async detachment
  setTimeout(() => {
    if (!tabWindow.isRendered()) {
      this.renderedTabs.delete(quickTabId);  // Cleanup stale reference
    }
  }, DOM_VERIFICATION_DELAY_MS);
}
```

### VisibilityHandler Delayed Emit (v1.6.4.7)

```javascript
const STATE_EMIT_DELAY_MS = 100;  // Wait for DOM verification before emit

_emitRestoreStateUpdate(id, tabWindow) {
  // Delay to ensure DOM is attached before notifying listeners
  setTimeout(() => {
    this.eventBus.emit('state:updated', { quickTab: data });
  }, STATE_EMIT_DELAY_MS);
}
```

### CreateHandler Async Initialization (v1.6.3.2)

```javascript
// CreateHandler now has async init() for loading settings
async init() {
  await this._loadDebugIdSetting();  // Loads from QUICK_TAB_SETTINGS_KEY
}

// QuickTabsManager calls this during initialization
async _initStep3_Handlers() {
  this.createHandler = new CreateHandler(...);
  await this.createHandler.init();  // Load debug settings before use
}
```

### UICoordinator DOM Validation (v1.6.3.2)

```javascript
// Validate DOM attachment before operating
if (!tabWindow.isRendered()) {
  this.renderedTabs.delete(quickTab.id);  // Remove stale reference
  return this.render(quickTab);           // Re-render
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
- `background.js` - Background script, storage listeners, saveId tracking
- `src/content.js` - Content script, Quick Tab creation, Manager action handlers
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings (v1.6.3.2)
- `src/utils/storage-utils.js` - Shared storage utilities with async persist
- `src/utils/dom.js` - DOM utilities including `cleanupOrphanedQuickTabElements()`
- `src/features/quick-tabs/coordinators/UICoordinator.js` - **`DOM_VERIFICATION_DELAY_MS = 150`**, `_verifyDOMAfterRender()` (v1.6.4.7)
- `src/features/quick-tabs/handlers/CreateHandler.js` - **`async init()`** for loading debug settings (v1.6.3.2)
- `src/features/quick-tabs/handlers/DestroyHandler.js` - Debounced batch writes, **`_batchMode`**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - **`STATE_EMIT_DELAY_MS = 100`**, **`_operationLocks`** mutex
- `src/features/quick-tabs/minimized-manager.js` - Snapshot storage with BEFORE/AFTER dimension logging
- `src/features/quick-tabs/window.js` - **`DEFAULT_WIDTH/HEIGHT/LEFT/TOP`** constants (v1.6.4.7)
- `src/features/quick-tabs/index.js` - **`async _initStep3_Handlers()`** for handler init
- `src/features/quick-tabs/ui/builders/TitlebarBuilder.js` - `_createDebugIdElement()` for debug ID display
- `options_page.html` / `options_page.js` - `quickTabShowDebugId` setting
- `sidebar/quick-tabs-manager.js` - Manager UI

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quick_tab_settings` (storage.sync)

**CRITICAL:** Use `storage.local` for Quick Tab state, `storage.sync` for settings.

**State Format (v1.6.3.2):**
```javascript
{
  tabs: [...],           // Array of Quick Tab objects
  saveId: 'unique-id',   // Deduplication ID
  timestamp: Date.now()
}
```

**Settings Format (v1.6.3.2):**
```javascript
{
  quickTabShowDebugId: false  // Show UID in titlebar
}
```

### Manager Action Messages (v1.6.3.2)

Content script handles these messages from Manager:
- `CLOSE_QUICK_TAB` - Close a specific Quick Tab
- `CLOSE_MINIMIZED_QUICK_TABS` - Close all minimized Quick Tabs
- `MINIMIZE_QUICK_TAB` - Minimize a Quick Tab (removes DOM)
- `RESTORE_QUICK_TAB` - Restore a minimized Quick Tab (UICoordinator handles rendering)

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
