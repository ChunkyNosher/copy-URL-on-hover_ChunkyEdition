# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.4-v5  
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

**v1.6.3.4-v5 Key Features (Spam-Click Fixes):**
- **Entity-Instance Same Object:** Entity in quickTabsMap IS the tabWindow (shared reference)
- **Snapshot Clear Delay:** `SNAPSHOT_CLEAR_DELAY_MS = 400ms` allows double-clicks before clearing
- **DragController Destroyed Flag:** Prevents stale callbacks from firing after destroy
- **Manager PENDING_OPERATIONS:** Set tracks in-progress operations, disables buttons during ops
- **Updated Timing Constants:** `STATE_EMIT_DELAY_MS = 100ms`, `MINIMIZE_DEBOUNCE_MS = 200ms`

**v1.6.3.4-v4 Code Health Improvements:**
| File | Before | After | Change |
|------|--------|-------|--------|
| background.js | 6.79 | 10.0 | +3.21 |
| state-manager.js | 8.28 | 10.0 | +1.72 |
| UICoordinator.js | 8.41 | 9.68 | +1.27 |
| content.js | 8.55 | 9.09 | +0.54 |
| window.js | 8.72 | 10.0 | +1.28 |
| settings.js | 8.88 | 10.0 | +1.12 |

**v1.6.3.4-v3 Key Features (Bug Fixes):**
- **Unified Restore Path:** UICoordinator ALWAYS deletes Map entry before restore for fresh render
- **Early Map Cleanup:** Manager minimize triggers explicit Map cleanup BEFORE state checks
- **Snapshot Lifecycle Fix:** `MinimizedManager.restore()` keeps snapshot in `minimizedTabs` until `clearSnapshot()` called
- **Callback Verification Logging:** window.js and UpdateHandler log callback wiring
- **Comprehensive Decision Logging:** All major decision points log conditions and outcomes

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

## 🏗️ Key Architecture Patterns (v1.6.3.4-v5)

### Timing Constants Reference (v1.6.3.4-v5)

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `STATE_EMIT_DELAY_MS` | 100 | VisibilityHandler | State event fires first |
| `MINIMIZE_DEBOUNCE_MS` | 200 | VisibilityHandler | Storage persist after state |
| `SNAPSHOT_CLEAR_DELAY_MS` | 400 | UICoordinator | Allows double-clicks |
| `DOM_VERIFICATION_DELAY_MS` | 150 | UICoordinator | DOM verification |
| `DOM_MONITORING_INTERVAL_MS` | 500 | UICoordinator | Monitor DOM presence |

### Entity-Instance Same Object Pattern (v1.6.3.4-v5+)

```javascript
// Entity in quickTabsMap IS the tabWindow - same object reference
const entity = this.quickTabsMap.get(id);
entity.minimized = false; // Updates both entity AND instance
```

### Snapshot Clear Delay Pattern (v1.6.3.4-v5+)

```javascript
const SNAPSHOT_CLEAR_DELAY_MS = 400;
_scheduleSnapshotClearing(id) {
  setTimeout(() => this.minimizedManager.clearSnapshot(id), SNAPSHOT_CLEAR_DELAY_MS);
}
```

### DragController Destroyed Flag (v1.6.3.4-v5+)

```javascript
destroy() { this.destroyed = true; }
_onDragEnd() { if (this.destroyed) return; } // Prevent stale callbacks
```

### Manager Pending Operations (v1.6.3.4-v5+)

```javascript
const PENDING_OPERATIONS = new Set();
_startPendingOperation(id) { PENDING_OPERATIONS.add(id); /* disable button */ }
_finishPendingOperation(id) { /* 2-second timeout */ PENDING_OPERATIONS.delete(id); }
```

### Refactoring Patterns (v1.6.3.4-v4)

| Pattern | Problem Solved | Files Applied |
|---------|----------------|---------------|
| Early Returns | Bumpy Road (deep nesting) | background.js, state-manager.js |
| Method Extraction | Complex methods >15 lines | UICoordinator.js, content.js |
| Code Consolidation | Duplicate logic | state-manager.js, settings.js |
| Parameter Objects | Excess arguments (>4) | window.js |
| Validation Rules | Long validation chains | background.js, content.js |
| Handler Maps | Large switch/if-else | background.js, settings.js |

### Legacy Patterns (v1.6.3.4-v3/v4)

**Unified Restore Path:** UICoordinator deletes Map entry before restore for fresh render  
**Early Map Cleanup:** Manager minimize triggers explicit cleanup BEFORE state checks  
**Snapshot Lifecycle:** `restore()` keeps snapshot until `clearSnapshot()` called  
**State Hydration:** `_initStep6_Hydrate()` restores Quick Tabs from storage on page reload  
**Source Tracking:** All handlers accept source parameter ('Manager', 'UI', 'hydration')

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
  - **v1.6.3.4-v5:** `SNAPSHOT_CLEAR_DELAY_MS = 400`, `_scheduleSnapshotClearing()` method
  - **v1.6.3.4-v3:** Helper methods: `_handleManagerMinimize()`, `_handleRestoreOperation()`, `_handleNotInMap()`, `_handleStateMismatchRestore()`, `_performNormalUpdate()`
- `src/features/quick-tabs/index.js`:
  - DestroyHandler receives `internalEventBus` for state:deleted
  - **v1.6.3.4+:** `_initStep6_Hydrate()` for page reload hydration
- `src/features/quick-tabs/handlers/CreateHandler.js`:
  - Uses `storage.local` with key `quickTabShowDebugId`
  - **`async init()`** with storage fallback pattern
- `src/features/quick-tabs/handlers/DestroyHandler.js`:
  - Debounced batch writes, **`_batchMode`**
  - **v1.6.3.4+:** Source parameter for logging
- `src/features/quick-tabs/handlers/VisibilityHandler.js`:
  - **v1.6.3.4-v5:** `STATE_EMIT_DELAY_MS = 100ms`, `MINIMIZE_DEBOUNCE_MS = 200ms`
  - **v1.6.3.4-v5:** Entity state updated FIRST in handleMinimize/handleRestore before instance
  - **v1.6.3.4-v5:** handleRestore emits state:updated even when snapshot not found
  - Re-registers window in quickTabsMap after restore, `_operationLocks` mutex
- `src/features/quick-tabs/handlers/UpdateHandler.js`:
  - **v1.6.3.4+:** zIndex included in state hash for change detection
  - **v1.6.3.4-v3:** Callback verification logging after restore
- `src/features/quick-tabs/minimized-manager.js`:
  - **v1.6.3.4-v3:** `restore()` keeps snapshot in minimizedTabs until `clearSnapshot()` called
  - **v1.6.3.4-v3:** Snapshot cleared by UICoordinator after confirmed render
- `src/features/quick-tabs/window.js`:
  - `DEFAULT_WIDTH/HEIGHT/LEFT/TOP` constants
  - **v1.6.3.4-v3:** `destroy()` verifies and logs onDestroy callback execution
- `src/features/quick-tabs/window/DragController.js`:
  - **v1.6.3.4-v5:** `destroyed` flag prevents stale callbacks after destroy
  - All drag callbacks check `this.destroyed` before executing
- `src/features/quick-tabs/window/TitlebarBuilder.js`:
  - Shows LAST 12 chars of UID (unique suffix)
  - `updateDebugIdDisplay(showDebugId)`
- `src/utils/storage-utils.js`:
  - Shared storage utilities with async persist
  - **v1.6.3.4+:** `serializeTabForStorage()` includes zIndex field
- `sidebar/quick-tabs-manager.js`:
  - **v1.6.3.4-v5:** `PENDING_OPERATIONS` Set tracks in-progress minimize/restore
  - **v1.6.3.4-v5:** `_startPendingOperation()`, `_finishPendingOperation()` with 2-second timeout
  - **v1.6.3.4-v5:** Buttons disabled while operation is pending
  - `_getIndicatorClass()` returns 'orange' when `domVerified=false`
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
