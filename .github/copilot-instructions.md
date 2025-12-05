# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.6-v3  
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

**v1.6.3.6-v3 Fixes:**
1. **Circuit Breaker Pattern** - Blocks ALL writes when `pendingWriteCount >= 15`, auto-resets when queue drains below 10
2. **Fail-Closed Tab ID Validation** - `validateOwnershipForWrite()` blocks writes when `tabId === null` (prevents async init race)
3. **Enhanced Loop Detection** - Escalation warning at 250ms, reduced `DUPLICATE_SAVEID_THRESHOLD` to 1
4. **Faster Transaction Cleanup** - `TRANSACTION_FALLBACK_CLEANUP_MS` reduced from 2000ms to 500ms

**v1.6.3.6-v2 Fixes (Retained):**
1. **Triple-Source Entropy** - `WRITING_INSTANCE_ID` uses `performance.now()` + `Math.random()` + `crypto.getRandomValues()` + `writeCounter`
2. **Deterministic Self-Write** - `lastWrittenTransactionId` for `isSelfWrite()` detection
3. **Ownership History** - `previouslyOwnedTabIds` Set, empty writes require `forceEmpty=true` AND ownership

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

## 🆕 v1.6.3.6-v3 Patterns

- **Circuit Breaker** - Blocks ALL writes when `pendingWriteCount >= 15`, logs recovery instructions, auto-resets at `< 10`
- **Fail-Closed Validation** - `validateOwnershipForWrite()` returns `shouldWrite: false` when `tabId === null`
- **Escalation Warning** - `scheduleFallbackCleanup()` fires warning at 250ms if transaction still pending
- **Faster Loop Detection** - `DUPLICATE_SAVEID_THRESHOLD = 1`, `TRANSACTION_FALLBACK_CLEANUP_MS = 500ms`

### v1.6.3.6-v2 Patterns (Retained)

- **Triple-Source Entropy** - `WRITING_INSTANCE_ID` uses multiple entropy sources + `writeCounter`
- **Deterministic Self-Write** - `lastWrittenTransactionId` for `isSelfWrite()` detection
- **Ownership History** - `previouslyOwnedTabIds` Set, `saveIdWriteTracker` for loop detection

### v1.6.3.6 Patterns (Retained)

- **Cross-Tab Filtering** - Handlers check `quickTabsMap`/`minimizedManager` before processing
- **Button Handler Logging** - `closeAllTabs()` logs full operation lifecycle

### Prior Version Patterns (v1.6.3.5-v9+)

- z-index helpers, `_logIfStateDesync()`, `isFocusOperation`, `rewireCallbacks()`, `cleanup()`, operation flags
- `setHandlers()`, `_buildCallbackOptions()`, `_applyZIndexAfterAppend()`, `forceEmpty`
- `__quickTabWindow`, `data-quicktab-id`, `DragController.updateElement()`

### Per-Tab Scoping

`_shouldRenderOnThisTab()` enforces strict per-tab scoping. Tab ID via `getCurrentTabIdFromBackground()`.

### Coordinated Clear

`clearAll()` with `forceEmpty: true` and `saveId: 'cleared-{timestamp}'`

### Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | Suppress circular callbacks |
| `STORAGE_READ_DEBOUNCE_MS` | 50 | Fast UI updates |
| `STATE_EMIT_DELAY_MS` | 100 | State event fires first |
| `DRAG_DEBOUNCE_MS` | 200 | Debounced drag/resize persistence |
| `ESCALATION_WARNING_MS` | 250 | Intermediate stale transaction warning (v1.6.3.6-v3) |
| `DOM_VERIFICATION_DELAY_MS` | 500 | DOM verify timing |
| `TRANSACTION_FALLBACK_CLEANUP_MS` | 500 | Transaction cleanup timeout (v1.6.3.6-v3: reduced from 2000) |
| `DUPLICATE_SAVEID_WINDOW_MS` | 1000 | Duplicate saveId detection window |
| `DUPLICATE_SAVEID_THRESHOLD` | 1 | Max same saveId writes before warning (v1.6.3.6-v3: reduced from 2) |
| `RENDER_COOLDOWN_MS` | 1000 | Prevent duplicate renders |
| `STORAGE_TIMEOUT_MS` | 2000 | Storage operation timeout |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | Restore message dedup |
| `CLOSE_ALL_MUTEX_RELEASE_MS` | 2000 | closeAll mutex cooldown |
| `CIRCUIT_BREAKER_THRESHOLD` | 15 | Block ALL writes when queue exceeds this (v1.6.3.6-v3) |
| `CIRCUIT_BREAKER_RESET_THRESHOLD` | 10 | Auto-reset circuit breaker when below this (v1.6.3.6-v3) |

---

## Architecture Classes

| Class | Key Methods |
|-------|-------------|
| QuickTabStateMachine | `canTransition()`, `transition()` |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| MinimizedManager | `forceCleanup()`, `getAllSnapshotIds()` |
| UICoordinator | `setHandlers()`, `_buildCallbackOptions()`, `clearAll()` |
| VisibilityHandler | `_executeRestore()`, `_applyZIndexUpdate()` |
| QuickTabWindow | `rewireCallbacks()`, `_logIfStateDesync()` |
| DestroyHandler | `_closeAllInProgress` mutex |

---

## 🔧 Storage Utilities (`src/utils/storage-utils.js`)

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key (`quick_tabs_state_v2`) |
| `WRITING_INSTANCE_ID` | Triple-source entropy unique ID |
| `canCurrentTabModifyQuickTab()` | Check tab ownership |
| `validateOwnershipForWrite(tabs, tabId, forceEmpty)` | Filter tabs by ownership (v1.6.3.6-v3: blocks when `tabId === null`) |
| `isSelfWrite(storageValue)` | Check if write from current tab (uses `lastWrittenTransactionId`) |
| `persistStateToStorage()` | Write with ownership validation, `forceEmpty` param |
| `queueStorageWrite()` | Queue writes with circuit breaker check (v1.6.3.6-v3) |
| `_shouldRejectEmptyWrite()` | ALWAYS rejects unless `forceEmpty=true` AND ownership history |
| `_handleEmptyWriteValidation(tabId, forceEmpty)` | Validates empty writes with `previouslyOwnedTabIds` |
| `_trackDuplicateSaveIdWrite(saveId, transactionId)` | Tracks duplicate saveId writes for loop detection |
| `cleanupTransactionId()` | Event-driven transaction cleanup (also cleans warning timeouts) |
| `scheduleFallbackCleanup()` | Enhanced with 250ms escalation warning (v1.6.3.6-v3) |
| `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` | Transaction lifecycle |

**v1.6.3.6-v3 Module Variables:**
- `circuitBreakerTripped` - Boolean flag, blocks ALL writes when true
- `circuitBreakerTripTime` - Timestamp when circuit breaker tripped
- `TRANSACTION_WARNING_TIMEOUTS` - Map tracking 250ms warning timeouts

**v1.6.3.6-v2 Module Variables (Retained):**
- `writeCounter` - Module-level counter for unique transaction IDs
- `lastWrittenTransactionId` - Tracks last transaction for deterministic self-write detection
- `previouslyOwnedTabIds` - Set tracking tabs with ownership history
- `saveIdWriteTracker` - Map for duplicate saveId detection (`DUPLICATE_SAVEID_WINDOW_MS=1000`, `DUPLICATE_SAVEID_THRESHOLD=1`)

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

**Core Patterns:**
- Promise sequencing, debounced drag, orphan recovery, per-tab scoping
- Transaction rollback, state machine, ownership validation, Single Writer Model
- Coordinated clear, closeAll mutex, `window:created` event
- DOM lookup (`__quickTabWindow`), `data-quicktab-id`, `DragController.updateElement()`
- Cross-tab filtering in handlers prevents ghost Quick Tabs (v1.6.3.6)
- **v1.6.3.6-v3:** Circuit breaker pattern, fail-closed tab ID validation, 250ms escalation warnings
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

| File | Key Features (v1.6.3.6-v3) |
|------|---------------------------|
| `background.js` | `_isTransactionSelfWrite()` (simplified), `_broadcastQuickTabsClearedToTabs()`, `QUICK_TAB_DELETED` notifications |
| `src/content.js` | `getCurrentTabIdFromBackground()`, cross-tab filtering in `_handleRestoreQuickTab()`/`_handleMinimizeQuickTab()` |
| `src/utils/storage-utils.js` | Circuit breaker (`circuitBreakerTripped`), fail-closed validation, 250ms escalation warnings, `TRANSACTION_FALLBACK_CLEANUP_MS=500` |
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
