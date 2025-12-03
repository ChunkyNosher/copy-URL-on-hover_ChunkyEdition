# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.5-v7  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`**
- **Per-Tab Ownership Validation** (v1.6.3.5-v4)
- **Promise-Based Sequencing** (v1.6.3.5-v5) - Deterministic operation ordering
- **Debounced Drag/Resize Persistence** (v1.6.3.5-v7) - Live sync during drag
- Direct local creation pattern, State hydration on page reload

**v1.6.3.5-v7 Architecture (Background-as-Coordinator):**

**Core Modules:**
- **QuickTabStateMachine** (`state-machine.js`) - Explicit lifecycle state tracking
- **QuickTabMediator** (`mediator.js`) - Operation coordination with rollback
- **MapTransactionManager** (`map-transaction-manager.js`) - Atomic Map operations
- **Background Script** - Coordinator for state broadcasts and manager commands

**v1.6.3.5-v7 Fixes (8 Issues):**
- **Manager Empty List Fix** - `onStoragePersistNeeded` callback in MinimizedManager
- **Duplicate Window Prevention** - render() early return guard checking `this.container`
- **Cross-Tab Restore** - Targeted tab messaging via `quickTabHostInfo` or `originTabId`
- **Drag/Resize Persistence** - 200ms debounced persistence via `_debouncedDragPersist()`
- **State Transition Logging** - Comprehensive logging in `StateManager.persistToStorage()`
- **Minimize State on Reload** - Set `domVerified: false` explicitly when minimizing
- **Manager Sync Timestamp** - `lastLocalUpdateTime` tracks actual UI update time
- **Z-Index Persistence** - Storage persistence after `updateZIndex()`

**v1.6.3.5-v6 Features (Retained):**
- **Restore Trusts UICoordinator** - No DOM verification rollback
- **closeAll Mutex** - `_closeAllInProgress` prevents duplicate closeAll
- **window:created Event** - CreateHandler→UICoordinator coordination
- **Promise-Based Sequencing** - `_delay()` helper for event→storage ordering

**Deprecated (v1.6.3.5-v5):**
- ⚠️ `window.js`: `setPosition()`, `setSize()`, `updatePosition()`, `updateSize()` - Bypass UpdateHandler
- ⚠️ `index.js`: `updateQuickTabPosition()`, `updateQuickTabSize()` - Log deprecation warnings

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

**`bug-fixer`** - Clear repro steps, single file, surgical fix  
**`bug-architect`** - Root cause unclear, multiple components  
**`quicktabs-unified-agent`** - Complete lifecycle, cross-domain  
**`quicktabs-cross-tab-agent`** - storage.onChanged, sync issues  
**`copilot-docs-updater`** - Update instructions/agents, compress to <15KB

### Delegation Template

```
@[agent-name] [task], Files: [list], run npm test/lint, commit with report_progress
```

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Background-as-Coordinator + storage.onChanged

**v1.6.3.5-v7 Message Types:**
- `QUICK_TAB_STATE_CHANGE` - Content script → Background for state changes
- `QUICK_TAB_STATE_UPDATED` - Background → All contexts for broadcasts
- `MANAGER_COMMAND` - Manager → Background for remote control
- `EXECUTE_COMMAND` - Background → Content script for command execution
- `CLEAR_ALL_QUICK_TABS` - Manager → Background for closeAll (Single Writer Model)

**v1.6.3.5-v7 Events:**
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
- **v1.6.3.5-v7:** `canCurrentTabModifyQuickTab()` validates ownership before writes
- **v1.6.3.5-v7:** Single Writer Model - Manager uses background-coordinated commands
- **v1.6.3.5-v7:** Targeted tab messaging via `quickTabHostInfo` or `originTabId`
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

## 🆕 v1.6.3.5-v7 Architecture Features

### Manager Empty List Fix (v1.6.3.5-v7)

MinimizedManager now has `onStoragePersistNeeded` callback that triggers storage persist after `clearSnapshot()`. This ensures Manager UI updates after minimize/restore operations.

### Debounced Drag/Resize Persistence (v1.6.3.5-v7)

UpdateHandler has `_debouncedDragPersist()` with `_dragDebounceTimers` Map and 200ms `DRAG_DEBOUNCE_MS` constant. Enables live sync during drag/resize operations.

### Targeted Tab Messaging (v1.6.3.5-v7)

Manager now uses `quickTabHostInfo` or `originTabId` for targeted tab messaging, fixing cross-tab restore positioning issues.

### Enhanced State Logging (v1.6.3.5-v7)

`StateManager.persistToStorage(source)` has comprehensive logging with timing, source, and state snapshot for debugging state transitions.

### Minimize State Preservation (v1.6.3.5-v7)

VisibilityHandler sets `domVerified: false` explicitly when minimizing, ensuring state is preserved on page reload.

### Manager Sync Timestamp (v1.6.3.5-v7)

`lastLocalUpdateTime` variable tracks actual UI update time for accurate "Last sync" display in Manager.

### Z-Index Persistence (v1.6.3.5-v7)

Storage persistence added after `updateZIndex()` to prevent focus anomalies from z-index desync.

### v1.6.3.5-v6 Features (Retained)

- **Restore Trusts UICoordinator** - `_verifyRestoreAndEmit()` emits `isRestoreOperation: true`
- **closeAll Mutex** - `_closeAllInProgress` with 2000ms cooldown
- **window:created Event** - CreateHandler→UICoordinator coordination
- **Promise-Based Sequencing** - `_delay()` helper for deterministic ordering

### Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | Suppress circular callbacks |
| `STORAGE_READ_DEBOUNCE_MS` | 50 | Fast UI updates |
| `STATE_EMIT_DELAY_MS` | 100 | State event fires first |
| `DRAG_DEBOUNCE_MS` | 200 | Debounced drag/resize persistence (v1.6.3.5-v7) |
| `DOM_VERIFICATION_DELAY_MS` | 500 | DOM verify timing |
| `RENDER_COOLDOWN_MS` | 1000 | Prevent duplicate renders |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | Restore message dedup |
| `CLOSE_ALL_MUTEX_RELEASE_MS` | 2000 | closeAll mutex cooldown |

---

## v1.6.3.5-v7 Architecture Classes

### QuickTabStateMachine
States: UNKNOWN, VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED  
Methods: `getState(id)`, `canTransition()`, `transition()`, `initialize()`, `getHistory()`

### QuickTabMediator
Single entry point with rollback: `minimize()`, `restore()`, `destroy()`, `executeWithRollback()`

### MapTransactionManager
Atomic Map ops: `beginTransaction()`, `deleteEntry()`, `setEntry()`, `commitTransaction()`, `rollbackTransaction()`

### MinimizedManager (v1.6.3.5-v7)
`onStoragePersistNeeded` callback, `_triggerStoragePersist()` method for Manager sync

### UpdateHandler (v1.6.3.5-v7)
`_debouncedDragPersist()`, `_dragDebounceTimers` Map, live event emissions during drag/resize

### StateManager (v1.6.3.5-v7)
Enhanced `persistToStorage(source)` with comprehensive logging, timing, and state snapshot

### DestroyHandler
`_closeAllInProgress` mutex, `_scheduleMutexRelease()` method for 2000ms cooldown

### CreateHandler
`_emitWindowCreatedEvent()` emits `window:created` event for UICoordinator coordination

### UICoordinator
`_registerCreatedWindow()` listens for `window:created` events, `_verifyInvariant()`, `_lastRenderTime` Map

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
- **Debounced Drag Persistence** - `_debouncedDragPersist()` with separate timers (v1.6.3.5-v7)
- **Transaction Rollback** - `preRestoreState` captured via MapTransactionManager
- **Active Timer IDs** - `_activeTimerIds` Set checks validity before executing
- **State Machine** - `canTransition()` validates, `transition()` logs with source
- **Map Transaction** - `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`
- **Ownership Validation** - Only owner tabs persist via `persistStateToStorage()`
- **Single Writer Model** - Manager uses `CLEAR_ALL_QUICK_TABS` via background (v1.6.3.5-v7)
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
- `src/features/quick-tabs/coordinators/UICoordinator.js` - `_verifyInvariant()`, `_lastRenderTime` Map, `_registerCreatedWindow()` for `window:created`
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - `_delay()` helper, **v1.6.3.5-v7:** Sets `domVerified: false` on minimize
- `src/features/quick-tabs/handlers/UpdateHandler.js` - **v1.6.3.5-v7:** `_debouncedDragPersist()`, `_dragDebounceTimers`, `DRAG_DEBOUNCE_MS`
- `src/features/quick-tabs/handlers/DestroyHandler.js` - `_closeAllInProgress` mutex, `_scheduleMutexRelease()` method
- `src/features/quick-tabs/handlers/CreateHandler.js` - `_emitWindowCreatedEvent()` emits `window:created` event
- `src/features/quick-tabs/managers/StateManager.js` - **v1.6.3.5-v7:** Enhanced `persistToStorage(source)` with comprehensive logging
- `src/features/quick-tabs/minimized-manager.js` - **v1.6.3.5-v7:** `onStoragePersistNeeded` callback, `_triggerStoragePersist()` method
- `src/features/quick-tabs/window.js` - `currentTabId` via constructor, `_getCurrentTabId()`, deprecated: `setPosition/setSize/updatePosition/updateSize`
- `src/features/quick-tabs/index.js` - Deprecated `updateQuickTabPosition()`, `updateQuickTabSize()`
- `sidebar/quick-tabs-manager.js` - **v1.6.3.5-v7:** `lastLocalUpdateTime`, targeted tab messaging, `inMemoryTabsCache`

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
