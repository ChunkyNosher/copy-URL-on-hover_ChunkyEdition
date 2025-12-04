# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.5-v12  
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

**v1.6.3.5-v10 Fixes:**
1. **Callback wiring** - `setHandlers()` for deferred initialization, `_buildCallbackOptions()` for restore path
2. **Z-index after append** - `_applyZIndexAfterAppend()` forces reflow via `void container.offsetHeight`
3. **Cross-tab scoping** - `getCurrentTabIdFromBackground()` retrieves tab ID before Quick Tabs init
4. **Storage corruption** - `forceEmpty` parameter, stricter `_shouldRejectEmptyWrite()`
5. **Diagnostic logging** - Enhanced init/message logging, `_broadcastQuickTabsClearedToTabs()`

**v1.6.3.5-v12 Fixes:**
1. **Second Minimize DOM Removal** - Defensive DOM query fallback in `minimize()` when `this.container` is null
2. **Z-Index After Restore** - `_applyZIndexUpdate()` and `_applyZIndexViaFallback()` helpers
3. **Lifecycle Logging** - Enhanced logging at render/minimize/restore completion
4. **Focus Persistence Logging** - `isFocusOperation` flag in `_debouncedPersist()`
5. **Z-Index Background Logging** - Sample z-index logging in `_logStorageChange()`
6. **Transaction Fallback Clarity** - Enhanced `scheduleFallbackCleanup()` context
7. **DOM Verification Invariants** - Invariant logging in `_verifyRestoreAndEmit()`
8. **State Desync Detection** - `_logIfStateDesync(operation)` helper to detect rendered/container mismatch

**v1.6.3.5-v11 Fixes (Retained):**
1-5: `rewireCallbacks()`, `_rewireCallbacksAfterRestore()`, `cleanup()` methods, `isMinimizing`/`isRestoring` flags, logging
6-10: Manager cache protection, `QUICK_TAB_DELETED`, z-index sync/defensive checks/logging, stale onFocus fix

**Core Modules:**
- **QuickTabStateMachine** - Explicit lifecycle state tracking
- **QuickTabMediator** - Operation coordination with rollback
- **MapTransactionManager** - Atomic Map operations
- **Background Script** - Coordinator for broadcasts and manager commands

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
- `QUICK_TAB_DELETED` - Background → Manager for single Quick Tab deletions (v1.6.3.5-v11)

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

## 🆕 v1.6.3.5-v12 Patterns

- **`_applyZIndexUpdate()`/`_applyZIndexViaFallback()`** - Defensive z-index with DOM fallback
- **`_logIfStateDesync()`** - Split-brain detection (rendered/container mismatch)
- **Defensive DOM Query in `minimize()`** - Queries `.quick-tab-window[data-quicktab-id]` when container null
- **`isFocusOperation` Flag** - Focus-only persist differentiation
- **DOM Verification Invariants** - `_verifyRestoreAndEmit()` checks

### v1.6.3.5-v11 Patterns (Retained)

- `rewireCallbacks()` - Re-wires callbacks after restore
- `_rewireCallbacksAfterRestore()` - Calls rewireCallbacks in VisibilityHandler
- `cleanup()` Pattern - Public cleanup in DragController/ResizeController/ResizeHandle
- `isMinimizing`/`isRestoring` - Operation flags prevent circular suppression
- `QUICK_TAB_DELETED` - Background → Manager for single deletions

### v1.6.3.5-v10 Patterns (Retained)

- `setHandlers()` - Deferred handler init, `_buildCallbackOptions()` for restore
- `_applyZIndexAfterAppend()` - Z-index with reflow, `getCurrentTabIdFromBackground()` for tab ID
- `forceEmpty` parameter, `_broadcastQuickTabsClearedToTabs()` diagnostics

### v1.6.3.5-v9 Features (Retained)

- `__quickTabWindow`, `data-quicktab-id`, `DragController.updateElement()`, reflow forcing

### Per-Tab Scoping

UICoordinator uses `currentTabId` + `_shouldRenderOnThisTab()` for strict per-tab scoping. Tab ID retrieved via `getCurrentTabIdFromBackground()` before init.

### Coordinated Clear

- `UICoordinator.clearAll()` - Global destruction path
- `forceEmpty: true` - Intentional empty writes
- `saveId: 'cleared-{timestamp}'` - Prevents storage thrashing

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

## Architecture Classes

| Class | Key Methods/Properties |
|-------|----------------------|
| QuickTabStateMachine | `canTransition()`, `transition()`, `initialize()`, States: VISIBLE/MINIMIZING/MINIMIZED/RESTORING/DESTROYED |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()`, `executeWithRollback()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| MinimizedManager | `forceCleanup()`, `getAllSnapshotIds()`, `onStoragePersistNeeded` |
| UpdateHandler | `_debouncedDragPersist()`, `_emitOrphanedTabEvent()` |
| UICoordinator | `setHandlers()`, `_buildCallbackOptions()`, `_shouldRenderOnThisTab()`, `clearAll()` |
| VisibilityHandler | `_executeRestore()`, `_rewireCallbacksAfterRestore()`, `_checkMinimizePreconditions()`, `_validateMinimizeInstance()`, `_applyZIndexUpdate()`, `_applyZIndexViaFallback()` |
| DragController | `updateElement()`, `_removeListeners()`, `cleanup()` |
| ResizeController | `cleanup()` |
| ResizeHandle | `cleanup()`, `destroyed` flag, `_removeListeners()`, `_invokeCallbackWithLogging()` |
| QuickTabWindow | `__quickTabWindow`, `data-quicktab-id`, `_applyZIndexAfterAppend()`, `rewireCallbacks()`, `isMinimizing`, `isRestoring`, `_logIfStateDesync()` |
| DestroyHandler | `_closeAllInProgress` mutex, `_scheduleMutexRelease()`, `_notifyBackgroundOfDeletion()` |
| CreateHandler | `_emitWindowCreatedEvent()` |

---

## 🔧 Storage Utilities (`src/utils/storage-utils.js`)

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key (`quick_tabs_state_v2`) |
| `canCurrentTabModifyQuickTab()` | Check tab ownership |
| `validateOwnershipForWrite()` | Filter tabs by ownership |
| `isSelfWrite(storageValue)` | Check if write from current tab |
| `persistStateToStorage()` | Write with ownership validation, `forceEmpty` param |
| `_shouldRejectEmptyWrite()` | Stricter check - ALWAYS rejects unless `forceEmpty=true` |
| `cleanupTransactionId()` | Event-driven transaction cleanup |
| `scheduleFallbackCleanup()` | Enhanced with `{ transactionId, expectedEvent, elapsedMs, triggerModule }` |
| `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` | Transaction lifecycle |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

**v1.6.3.5-v12 Patterns:**
- `_applyZIndexUpdate()` / `_applyZIndexViaFallback()` - Defensive z-index application
- `_logIfStateDesync()` - Split-brain state detection
- Defensive DOM query fallback in `minimize()`
- `isFocusOperation` flag for focus-only persist differentiation
- DOM verification invariants in `_verifyRestoreAndEmit()`

**v1.6.3.5-v11 Patterns:**
- `rewireCallbacks()` - Fresh callback context after restore
- `cleanup()` - Public listener removal in DragController/ResizeController/ResizeHandle
- `isMinimizing`/`isRestoring` - Operation flags prevent circular suppression
- `_notifyBackgroundOfDeletion()` - Background notification for deletions

**v1.6.3.5-v10 Patterns:**
- `setHandlers()` - Deferred handler init
- `_buildCallbackOptions()` - Callback wiring
- `getCurrentTabIdFromBackground()` - Tab ID retrieval
- `forceEmpty` - Intentional empty writes
- `_applyZIndexAfterAppend()` - Z-index with reflow

**Core Patterns:**
- Promise sequencing, debounced drag, orphan recovery, per-tab scoping
- Transaction rollback, state machine, ownership validation, Single Writer Model
- Coordinated clear, closeAll mutex, `window:created` event
- DOM lookup (`__quickTabWindow`), `data-quicktab-id`, `DragController.updateElement()`

---

## 🎯 Philosophy

**ALWAYS:** Fix root causes, use correct patterns, eliminate technical debt  
**NEVER:** setTimeout for race conditions, catch-and-ignore errors, workarounds

---

## 📏 File Size Limits

| File | Max Size |
|------|----------|
| `copilot-instructions.md` | **15KB** |
| `.github/agents/*.md` | **15KB** |
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

| File | Key Features (v1.6.3.5-v12) |
|------|---------------------------|
| `background.js` | `_broadcastQuickTabsClearedToTabs()`, `QUICK_TAB_DELETED` notifications, `_logStorageChange()` with sample z-index |
| `src/content.js` | `getCurrentTabIdFromBackground()`, enhanced logging |
| `src/utils/storage-utils.js` | `_shouldRejectEmptyWrite()` with `forceEmpty`, `scheduleFallbackCleanup()` with enhanced context |
| `UICoordinator.js` | `setHandlers()`, `_buildCallbackOptions()` |
| `StateManager.js` | `persistToStorage(source, forceEmpty)` |
| `window.js` | `_applyZIndexAfterAppend()`, `rewireCallbacks()`, `isMinimizing`/`isRestoring` flags, `_logIfStateDesync()`, defensive DOM query in `minimize()` |
| `VisibilityHandler.js` | `_rewireCallbacksAfterRestore()`, `_checkMinimizePreconditions()`, `_applyZIndexUpdate()`, `_applyZIndexViaFallback()`, `_verifyRestoreAndEmit()` invariants, `isFocusOperation` |
| `DragController.js` | `updateElement()`, `cleanup()` |
| `ResizeController.js` | `cleanup()` |
| `ResizeHandle.js` | `cleanup()`, `destroyed` flag |
| `DestroyHandler.js` | `_notifyBackgroundOfDeletion()` |
| `quick-tabs-manager.js` | `handleStateDeletedMessage()`, cache protection fix |
| `index.js` | `initQuickTabs()` accepts `currentTabId`, calls `setHandlers()` |

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
- `QUICK_TAB_DELETED` - Background → Manager for single Quick Tab deletions (v1.6.3.5-v11)
- `CLOSE_QUICK_TAB` / `MINIMIZE_QUICK_TAB` / `RESTORE_QUICK_TAB` - Legacy messages

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
