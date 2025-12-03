# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.5-v8  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping
- **Per-Tab Ownership Validation** (v1.6.3.5-v4)
- **Promise-Based Sequencing** (v1.6.3.5-v5)
- Direct local creation pattern, State hydration on page reload

**v1.6.3.5-v8 Manifest Changes:**
- `unlimitedStorage` permission - Prevents storage quota errors
- `sessions` permission - Enables crash recovery and tab history
- `contextualIdentities` permission - Better container API integration
- Security: Removed `state-manager.js` from `web_accessible_resources`

**v1.6.3.5-v8 Architecture (Background-as-Coordinator):**

**Core Modules:**
- **QuickTabStateMachine** (`state-machine.js`) - Explicit lifecycle state tracking
- **QuickTabMediator** (`mediator.js`) - Operation coordination with rollback
- **MapTransactionManager** (`map-transaction-manager.js`) - Atomic Map operations
- **Background Script** - Coordinator for state broadcasts and manager commands

**v1.6.3.5-v8 Fixes (10 Issues):**
1. **Cross-tab rendering** - `_shouldRenderOnThisTab()` in UICoordinator enforces strict per-tab scoping
2. **Manager minimize/restore** - Coordinated MinimizedManager snapshots, renderedTabs, entity.minimized
3. **Position/size after restore** - `_emitOrphanedTabEvent()` in UpdateHandler for re-wiring
4. **Z-index/stacking** - `_executeRestore()` increments z-index on restore
5. **Last sync flicker** - Stabilized restore-related persistence, no duplicate writes
6. **Clear Quick Tab Storage** - `clearAll()` in UICoordinator, clears `quickTabHostInfo`
7. **Phantom Quick Tabs** - `quickTabHostTabs` cleared in background.js during coordinated clear
8. **Storage thrashing** - Reset counters, `saveId: 'cleared-{timestamp}'` pattern
9. **Snapshot inconsistencies** - `forceCleanup()`, `getAllSnapshotIds()` in MinimizedManager
10. **Logging coverage** - `_logPrefix` with tab ID in UICoordinator and VisibilityHandler

**v1.6.3.5-v7 Fixes (Retained):**
- Manager Empty List, Duplicate Window, Drag/Resize Persistence, State Logging

**Deprecated (v1.6.3.5-v5):**
- ⚠️ `window.js`: `setPosition()`, `setSize()`, `updatePosition()`, `updateSize()` - Bypass UpdateHandler
- ⚠️ `index.js`: `updateQuickTabPosition()`, `updateQuickTabSize()` - Log deprecation warnings

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features → `feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab → `quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings → `ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Background-as-Coordinator + storage.onChanged

**Message Types:**
- `QUICK_TAB_STATE_CHANGE` - Content script → Background for state changes
- `QUICK_TAB_STATE_UPDATED` - Background → All contexts for broadcasts
- `MANAGER_COMMAND` - Manager → Background for remote control
- `EXECUTE_COMMAND` - Background → Content script for command execution
- `CLEAR_ALL_QUICK_TABS` - Manager → Background for closeAll (Single Writer Model)

**Events:**
- `window:created` - CreateHandler → UICoordinator to populate `renderedTabs` Map

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
- `canCurrentTabModifyQuickTab()` validates ownership before writes
- Single Writer Model - Manager uses background-coordinated commands
- Targeted tab messaging via `quickTabHostInfo` or `originTabId`
- **v1.6.3.5-v8:** `_shouldRenderOnThisTab()` enforces strict per-tab scoping
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

## 🆕 v1.6.3.5-v8 Architecture Features

### New Manifest Permissions (v1.6.3.5-v8)

- **unlimitedStorage** - Prevents storage quota errors for Quick Tab state
- **sessions** - Enables crash recovery and tab history features
- **contextualIdentities** - Better container API integration
- **Security Fix** - Removed `state-manager.js` from `web_accessible_resources`

### Per-Tab Scoping Fix (v1.6.3.5-v8)

UICoordinator now has `currentTabId` property and `_shouldRenderOnThisTab()` method that enforces strict per-tab scoping via originTabId check. Prevents Quick Tabs from appearing in wrong browser tabs.

### Coordinated Clear Operation (v1.6.3.5-v8)

- `UICoordinator.clearAll()` - Coordinated global destruction path
- `quickTabHostInfo` cleared on Close All in Manager
- `quickTabHostTabs` cleared in background.js during coordinated clear
- `saveId: 'cleared-{timestamp}'` pattern prevents storage thrashing

### Enhanced MinimizedManager (v1.6.3.5-v8)

- `forceCleanup()` - Atomic snapshot cleanup during clear operations
- `getAllSnapshotIds()` - Enhanced logging support for debugging
- `_updateLocalTimestamp()` - Accurate "Last sync" timestamp in Manager

### Orphaned Tab Recovery (v1.6.3.5-v8)

UpdateHandler has `_emitOrphanedTabEvent()` that requests re-wiring when orphaned DOM is detected after restore operations. Fixes position/size issues.

### Enhanced Logging (v1.6.3.5-v8)

`_logPrefix` with tab ID added to UICoordinator and VisibilityHandler for easier debugging of cross-tab issues.

### v1.6.3.5-v7 Features (Retained)

- **Manager Empty List Fix** - `onStoragePersistNeeded` callback
- **Debounced Drag/Resize** - `_debouncedDragPersist()` with 200ms debounce
- **closeAll Mutex** - `_closeAllInProgress` with 2000ms cooldown
- **window:created Event** - CreateHandler→UICoordinator coordination

### Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | Suppress circular callbacks |
| `STORAGE_READ_DEBOUNCE_MS` | 50 | Fast UI updates |
| `STATE_EMIT_DELAY_MS` | 100 | State event fires first |
| `DRAG_DEBOUNCE_MS` | 200 | Debounced drag/resize persistence |
| `DOM_VERIFICATION_DELAY_MS` | 500 | DOM verify timing |
| `RENDER_COOLDOWN_MS` | 1000 | Prevent duplicate renders |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | Restore message dedup |
| `CLOSE_ALL_MUTEX_RELEASE_MS` | 2000 | closeAll mutex cooldown |

---

## v1.6.3.5-v8 Architecture Classes

### QuickTabStateMachine
States: UNKNOWN, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED  
Methods: `getState(id)`, `canTransition()`, `transition()`, `initialize()`, `getHistory()`

### QuickTabMediator
Single entry point with rollback: `minimize()`, `restore()`, `destroy()`, `executeWithRollback()`

### MapTransactionManager
Atomic Map ops: `beginTransaction()`, `deleteEntry()`, `setEntry()`, `commitTransaction()`, `rollbackTransaction()`

### MinimizedManager (v1.6.3.5-v8)
`onStoragePersistNeeded` callback, `forceCleanup()`, `getAllSnapshotIds()`, `_updateLocalTimestamp()`

### UpdateHandler (v1.6.3.5-v8)
`_debouncedDragPersist()`, `_dragDebounceTimers` Map, `_emitOrphanedTabEvent()` for orphan recovery

### UICoordinator (v1.6.3.5-v8)
`currentTabId`, `_shouldRenderOnThisTab()`, `clearAll()`, `_logPrefix`, `_registerCreatedWindow()`

### VisibilityHandler (v1.6.3.5-v8)
`_logPrefix` with tab ID, enhanced `_executeRestore()` increments z-index

### DestroyHandler
`_closeAllInProgress` mutex, `_scheduleMutexRelease()` method for 2000ms cooldown

### CreateHandler
`_emitWindowCreatedEvent()` emits `window:created` event for UICoordinator coordination

---

## 🔧 Storage Utilities (`src/utils/storage-utils.js`)

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key (`quick_tabs_state_v2`) |
| `canCurrentTabModifyQuickTab()` | Check tab ownership |
| `validateOwnershipForWrite()` | Filter tabs by ownership |
| `isSelfWrite(storageValue)` | Check if write from current tab |
| `persistStateToStorage()` | Write with ownership validation |
| `cleanupTransactionId()` | Event-driven transaction cleanup |
| `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` | Transaction lifecycle |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

- **Promise-Based Sequencing** - `_delay()` + async/await for event→storage ordering
- **Debounced Drag Persistence** - `_debouncedDragPersist()` with separate timers
- **Orphaned Tab Recovery** - `_emitOrphanedTabEvent()` requests re-wiring (v1.6.3.5-v8)
- **Per-Tab Scoping** - `_shouldRenderOnThisTab()` prevents cross-tab rendering (v1.6.3.5-v8)
- **Transaction Rollback** - `preRestoreState` captured via MapTransactionManager
- **Active Timer IDs** - `_activeTimerIds` Set checks validity before executing
- **State Machine** - `canTransition()` validates, `transition()` logs with source
- **Map Transaction** - `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`
- **Ownership Validation** - Only owner tabs persist via `persistStateToStorage()`
- **Single Writer Model** - Manager uses `CLEAR_ALL_QUICK_TABS` via background
- **Coordinated Clear** - `UICoordinator.clearAll()` + `quickTabHostTabs` reset (v1.6.3.5-v8)
- **closeAll Mutex** - `_closeAllInProgress` prevents duplicate execution
- **window:created Event** - CreateHandler→UICoordinator coordination

---

## 🎯 Philosophy

**ALWAYS:** Fix root causes, use correct patterns, eliminate technical debt  
**NEVER:** setTimeout for race conditions, catch-and-ignore errors, workarounds

---

## 📏 File Size Limits

| File | Max Size |
|------|----------|
| `copilot-instructions.md` | **15KB** |
| `.github/agents/*.md` | **25KB** |
| README.md | **10KB** |

**PROHIBITED:** `docs/manual/`, root markdown (except README.md)

---

## 🔧 MCP & Testing

**MCPs:** CodeScene (code health), Context7 (API docs), Perplexity (research)

**Testing:** `npm test` (Jest), `npm run lint` (ESLint), `npm run build`

---

## 🧠 Memory (Agentic-Tools MCP)

**End of task:** `git add .agentic-tools-mcp/`, commit with `report_progress`  
**Start of task:** `searchMemories({ query: "keywords", limit: 5 })`

**DO NOT USE** `store_memory` tool - use agentic-tools MCP instead.

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass
- [ ] Memory files committed

---

## 📋 Quick Reference

### Key Files
- `background.js` - Background-as-Coordinator with `handleQuickTabStateChange()`, `broadcastQuickTabStateUpdate()`, `handleManagerCommand()`, `quickTabHostTabs` Map
- `src/content.js` - Identity logging on init, `QUICK_TAB_COMMAND_HANDLERS`, message deduplication (2000ms)
- `src/core/config.js` - **`QUICK_TAB_SETTINGS_KEY`** constant for debug settings
- `src/utils/storage-utils.js` - `canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`, `cleanupTransactionId()`
- `src/features/quick-tabs/state-machine.js` - QuickTabStateMachine, States: VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED
- `src/features/quick-tabs/mediator.js` - QuickTabMediator, `minimize()`, `restore()`, `destroy()`, `executeWithRollback()`
- `src/features/quick-tabs/map-transaction-manager.js` - MapTransactionManager with rollback
- `src/features/quick-tabs/coordinators/UICoordinator.js` - **v1.6.3.5-v8:** `currentTabId`, `_shouldRenderOnThisTab()`, `clearAll()`, `_logPrefix`
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - **v1.6.3.5-v8:** `_logPrefix`, enhanced `_executeRestore()` increments z-index
- `src/features/quick-tabs/handlers/UpdateHandler.js` - **v1.6.3.5-v8:** `_emitOrphanedTabEvent()`, `_debouncedDragPersist()`, `_dragDebounceTimers`
- `src/features/quick-tabs/handlers/DestroyHandler.js` - `_closeAllInProgress` mutex, `_scheduleMutexRelease()` method
- `src/features/quick-tabs/handlers/CreateHandler.js` - `_emitWindowCreatedEvent()` emits `window:created` event
- `src/features/quick-tabs/managers/StateManager.js` - Enhanced `persistToStorage(source)` with comprehensive logging
- `src/features/quick-tabs/minimized-manager.js` - **v1.6.3.5-v8:** `forceCleanup()`, `getAllSnapshotIds()`, `_updateLocalTimestamp()`
- `src/features/quick-tabs/window.js` - `currentTabId` via constructor, `_getCurrentTabId()`, deprecated: `setPosition/setSize/updatePosition/updateSize`
- `src/features/quick-tabs/index.js` - Deprecated `updateQuickTabPosition()`, `updateQuickTabSize()`
- `sidebar/quick-tabs-manager.js` - **v1.6.3.5-v8:** Clears `quickTabHostInfo` on Close All, enhanced logging with IDs

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
