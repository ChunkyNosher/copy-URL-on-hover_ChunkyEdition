# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.6-v2  
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

**v1.6.3.5-v8 Manifest:** `unlimitedStorage`, `sessions`, `contextualIdentities` permissions; removed `state-manager.js` from `web_accessible_resources`

**v1.6.3.5-v10 Fixes:** Callback wiring (`setHandlers()`, `_buildCallbackOptions()`), z-index after append, cross-tab scoping, storage corruption (`forceEmpty`)

**v1.6.3.6-v2 Fixes:**
1. **Storage Write Infinite Loop Fixed** - Triple-source entropy for `WRITING_INSTANCE_ID` (`performance.now()` + `Math.random()` + `crypto.getRandomValues()` + `writeCounter`), `lastWrittenTransactionId` for deterministic self-write detection
2. **Loop Detection Logging** - STORAGE WRITE BACKLOG warnings (`pendingWriteCount > 5/10`), `saveIdWriteTracker` Map for duplicate saveId detection, transaction timeout `console.error`
3. **Empty State Corruption Fixed** - `previouslyOwnedTabIds` Set tracks ownership history, empty writes require `forceEmpty=true` AND ownership history

**v1.6.3.6 Fixes (Retained):**
1. **Cross-Tab Filtering** - `_handleRestoreQuickTab()`/`_handleMinimizeQuickTab()` check quickTabsMap/minimizedManager before processing
2. **Transaction Timeout Reduction** - `STORAGE_TIMEOUT_MS` and `TRANSACTION_FALLBACK_CLEANUP_MS` reduced from 5000ms to 2000ms
3. **Button Handler Logging** - `closeAllTabs()` logs button click, pre-action state, dispatch, response, cleanup, timing

**v1.6.3.5-v10 thru v12 Fixes (Retained):**
- Callback wiring (`setHandlers()`, `_buildCallbackOptions()`), z-index (`_applyZIndexAfterAppend()`, `_applyZIndexUpdate()`, `_applyZIndexViaFallback()`)
- Cross-tab scoping (`getCurrentTabIdFromBackground()`), storage corruption (`forceEmpty`), `_logIfStateDesync()`, `rewireCallbacks()`, operation flags

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

## 🆕 v1.6.3.6-v2 Patterns

- **Triple-Source Entropy** - `WRITING_INSTANCE_ID` uses `performance.now()` + `Math.random()` + `crypto.getRandomValues()` + module-level `writeCounter`
- **Deterministic Self-Write** - `lastWrittenTransactionId` tracks last transaction for `isSelfWrite()` detection
- **Ownership History** - `previouslyOwnedTabIds` Set tracks tabs that have ever created Quick Tabs
- **Loop Detection** - `saveIdWriteTracker` Map detects duplicate saveId writes (>2 in 1000ms)
- **Backlog Warnings** - STORAGE WRITE BACKLOG at `pendingWriteCount > 5` (warn) or `>10` (critical)

### v1.6.3.6 Patterns (Retained)

- **Cross-Tab Filtering** - Handlers check `quickTabsMap`/`minimizedManager` before processing broadcast messages
- **Reduced Timeouts** - 2000ms (down from 5000ms) for faster first restore (<500ms vs 2-3s)
- **Button Handler Logging** - `closeAllTabs()` logs full operation lifecycle with timing

### Prior Version Patterns (v1.6.3.5-v9+)

- `_applyZIndexUpdate()`/`_applyZIndexViaFallback()`, `_logIfStateDesync()`, `isFocusOperation` flag (v12)
- `rewireCallbacks()`, `_rewireCallbacksAfterRestore()`, `cleanup()` methods, operation flags (v11)
- `setHandlers()`, `_buildCallbackOptions()`, `_applyZIndexAfterAppend()`, `forceEmpty` (v10)
- `__quickTabWindow`, `data-quicktab-id`, `DragController.updateElement()` (v9)

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
| `DUPLICATE_SAVEID_WINDOW_MS` | 1000 | Duplicate saveId detection window (v1.6.3.6-v2) |
| `DUPLICATE_SAVEID_THRESHOLD` | 2 | Max same saveId writes before warning (v1.6.3.6-v2) |
| `STORAGE_TIMEOUT_MS` | 2000 | Storage operation timeout (v1.6.3.6: reduced from 5000) |
| `TRANSACTION_FALLBACK_CLEANUP_MS` | 2000 | Transaction cleanup timeout (v1.6.3.6: reduced from 5000) |

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
| `WRITING_INSTANCE_ID` | Triple-source entropy unique ID (v1.6.3.6-v2) |
| `canCurrentTabModifyQuickTab()` | Check tab ownership |
| `validateOwnershipForWrite(tabs, tabId, forceEmpty)` | Filter tabs by ownership (v1.6.3.6-v2: accepts `forceEmpty`) |
| `isSelfWrite(storageValue)` | Check if write from current tab (uses `lastWrittenTransactionId`) |
| `persistStateToStorage()` | Write with ownership validation, `forceEmpty` param |
| `_shouldRejectEmptyWrite()` | Stricter check - ALWAYS rejects unless `forceEmpty=true` AND ownership history |
| `_handleEmptyWriteValidation(tabId, forceEmpty)` | Validates empty writes with `previouslyOwnedTabIds` (v1.6.3.6-v2) |
| `_trackDuplicateSaveIdWrite(saveId, transactionId)` | Tracks duplicate saveId writes for loop detection (v1.6.3.6-v2) |
| `cleanupTransactionId()` | Event-driven transaction cleanup |
| `scheduleFallbackCleanup()` | Enhanced with `{ transactionId, expectedEvent, elapsedMs, triggerModule }` |
| `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` | Transaction lifecycle |

**v1.6.3.6-v2 Module Variables:**
- `writeCounter` - Module-level counter for unique transaction IDs
- `lastWrittenTransactionId` - Tracks last transaction for deterministic self-write detection
- `previouslyOwnedTabIds` - Set tracking tabs with ownership history
- `saveIdWriteTracker` - Map for duplicate saveId detection (`DUPLICATE_SAVEID_WINDOW_MS=1000`, `DUPLICATE_SAVEID_THRESHOLD=2`)

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

**Core Patterns:**
- Promise sequencing, debounced drag, orphan recovery, per-tab scoping
- Transaction rollback, state machine, ownership validation, Single Writer Model
- Coordinated clear, closeAll mutex, `window:created` event
- DOM lookup (`__quickTabWindow`), `data-quicktab-id`, `DragController.updateElement()`
- Cross-tab filtering in handlers prevents ghost Quick Tabs (v1.6.3.6)
- **v1.6.3.6-v2:** Triple-source entropy, `lastWrittenTransactionId`, `previouslyOwnedTabIds`, loop detection logging

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

| File | Key Features (v1.6.3.6-v2) |
|------|---------------------------|
| `background.js` | `_isTransactionSelfWrite()` (simplified), `_broadcastQuickTabsClearedToTabs()`, `QUICK_TAB_DELETED` notifications |
| `src/content.js` | `getCurrentTabIdFromBackground()`, cross-tab filtering in `_handleRestoreQuickTab()`/`_handleMinimizeQuickTab()` |
| `src/utils/storage-utils.js` | Triple-source entropy `WRITING_INSTANCE_ID`, `lastWrittenTransactionId`, `previouslyOwnedTabIds`, `saveIdWriteTracker`, backlog warnings |
| `UICoordinator.js` | `setHandlers()`, `_buildCallbackOptions()` |
| `StateManager.js` | `persistToStorage(source, forceEmpty)` |
| `window.js` | `_applyZIndexAfterAppend()`, `rewireCallbacks()`, `isMinimizing`/`isRestoring` flags, `_logIfStateDesync()`, defensive DOM query in `minimize()` |
| `VisibilityHandler.js` | `_rewireCallbacksAfterRestore()`, `_checkMinimizePreconditions()`, `_applyZIndexUpdate()`, `_applyZIndexViaFallback()`, `_verifyRestoreAndEmit()` invariants, `isFocusOperation` |
| `DragController.js` | `updateElement()`, `cleanup()` |
| `ResizeController.js` | `cleanup()` |
| `ResizeHandle.js` | `cleanup()`, `destroyed` flag |
| `DestroyHandler.js` | `_notifyBackgroundOfDeletion()` |
| `quick-tabs-manager.js` | `handleStateDeletedMessage()`, `closeAllTabs()` with comprehensive logging |
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
