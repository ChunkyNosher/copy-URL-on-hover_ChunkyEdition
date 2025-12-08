# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.6-v9  
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

**v1.6.3.6-v9 Fixes:**
1. **Enhanced Group Headers** - 16x16 favicon, tab ID display, prominent count badge
2. **Orphaned Tab Detection** - ⚠️ icon, warning colors, "Adopt" button with `adoptQuickTabToCurrentTab()`
3. **Closed Tab Indication** - Strikethrough title, 🚫 badge for closed browser tabs
4. **Tab Switch Detection** - `browser.tabs.onActivated` listener triggers refresh
5. **Structured Confirmations** - VisibilityHandler returns `{ success, quickTabId, action }` responses
6. **Position/Size Update Logging** - `_identifyChangedTabs()` helper, source tracking (`sourceTabId`, `sourceContext`)
7. **Smooth Animations** - 0.35s collapse/expand, height animations via JavaScript `animate()` API
8. **Responsive Design** - Media queries at 250/300/400/500px breakpoints
9. **Favicon Loading** - 2s timeout with fallback icon
10. **Active/Minimized Divider** - Section headers distinguish tab states

**v1.6.3.6-v8 Fixes (Retained):**
1. **originTabId Initialization** - CreateHandler uses `_extractTabIdFromQuickTabId()` as final fallback
2. **Hydration Recovery** - `_checkTabScopeWithReason()` patches originTabId from ID pattern back into entity
3. **Snapshot Capture** - MinimizedManager.add() extracts originTabId from ID pattern when null
4. **Manager Restore Validation** - Triple ownership check (snapshot, ID pattern, global/null permission)
5. **Cross-Tab Grouping UI** - Manager groups Quick Tabs by originTabId in collapsible `<details>` sections
6. **Browser Tab Metadata** - `fetchBrowserTabInfo()` uses `browser.tabs.get()` with 30s TTL cache
7. **Diagnostic Logging** - Emoji-prefixed: `📸 SNAPSHOT_CAPTURED`, `📍 ORIGIN_TAB_ID_RESOLUTION`, `🔄 RESTORE_REQUEST`

**v1.6.3.6-v5 Fixes:**
1. **Strict Tab Isolation** - `_shouldRenderOnThisTab()` REJECTS Quick Tabs with null/undefined originTabId
2. **Deletion State Machine** - DestroyHandler._destroyedIds prevents deletion loops/log explosion
3. **Unified Deletion Path** - `initiateDestruction()` is single entry point; UI button and Manager close produce identical behavior
4. **Storage Operation Logging** - `logStorageRead()`, `logStorageWrite()` with correlation IDs in storage-utils.js
5. **Message Correlation IDs** - `generateMessageId()`, `logMessageDispatch()`, `logMessageReceipt()` in background.js

**v1.6.3.6-v7 Fixes:**
1. **ID Pattern Recovery** - `_extractTabIdFromQuickTabId()` extracts tab ID from Quick Tab ID pattern `qt-{tabId}-{timestamp}-{random}`
2. **Orphaned Quick Tab Recovery** - `_checkTabScopeWithReason()` recovers orphaned tabs by extracting tab ID from ID pattern
3. **Manager Restore Recovery** - `_shouldRenderOnThisTab()` patches originTabId in-place when ID pattern matches current tab
4. **3-Stage Restoration Logging** - RESTORE_QUICK_TAB handler logs command receipt, handler invocation, and completion

**v1.6.3.6-v6 Fixes (renamed from v1.6.4):**
1. **originTabId Snapshot Preservation** - MinimizedManager now includes `savedOriginTabId` in snapshots
2. **originTabId Restore Application** - UICoordinator `_tryApplySnapshotFromManager()` applies originTabId from snapshot
3. **originTabId Restore Logging** - VisibilityHandler logs originTabId throughout restore flow

**v1.6.3.6-v5 Patterns:**
- `_checkTabScopeWithReason()` - Unified tab scope validation with structured init logging
- `_broadcastDeletionToAllTabs()` - Sender filtering prevents echo back to initiator
- DestroyHandler is the **single authoritative deletion path** (UICoordinator.destroy() only handles Map cleanup)

**v1.6.3.6-v4 Fixes (Retained):**
1. **Circuit Breaker Pattern** - Blocks ALL writes when `pendingWriteCount >= 15`, auto-resets below 10
2. **Fail-Closed Tab ID Validation** - `validateOwnershipForWrite()` blocks when `tabId === null`
3. **Position/Size Logging** - Full trace visibility from pointer event → storage
4. **Broadcast Deduplication** - Circuit breaker in background.js (10+ broadcasts/100ms trips)

**v1.6.3.6 Fixes (Retained):**
1. **Cross-Tab Filtering** - `_handleRestoreQuickTab()`/`_handleMinimizeQuickTab()` check quickTabsMap/minimizedManager
2. **Transaction Timeout Reduction** - `STORAGE_TIMEOUT_MS` = 2000ms
3. **Button Handler Logging** - `closeAllTabs()` logs full operation lifecycle

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

## 🆕 v1.6.3.6-v9 Patterns

- **Orphan Adoption** - `adoptQuickTabToCurrentTab()` reassigns orphaned Quick Tabs to current browser tab
- **Tab Switch Detection** - `browser.tabs.onActivated` listener auto-refreshes Manager on tab focus change
- **Structured Confirmations** - Handlers return `{ success, quickTabId, action, ... }` for confirmation tracking
- **Favicon Loading** - `loadFavicon()` with 2s timeout and fallback to default icon
- **Smooth Animations** - CSS transitions (0.35s) + JavaScript `animate()` API for height changes
- **Responsive Breakpoints** - Media queries at 250/300/400/500px for sidebar widths
- **Active/Minimized Sections** - Visual divider separates tab states with section headers
- **Source Tracking** - `sourceTabId`, `sourceContext` identify origin of storage changes

### v1.6.3.6-v8 Patterns (Retained)

- **ID Pattern Extraction** - `_extractTabIdFromQuickTabId()` parses `qt-{tabId}-{timestamp}-{random}` format
- **Multi-Layer Recovery** - CreateHandler, hydration, snapshot capture all use ID pattern fallback
- **Triple Ownership Check** - Manager restore validates snapshot → ID pattern → global/null permission
- **Cross-Tab Grouping** - `groupQuickTabsByOriginTab()` groups Quick Tabs by originTabId
- **Tab Metadata Caching** - `fetchBrowserTabInfo()` caches `browser.tabs.get()` results (30s TTL)
- **Collapse State Persistence** - `quickTabsManagerCollapseState` in storage.local
- **Emoji Diagnostics** - `📸`, `📍`, `🔄` prefixed logging for traceability

### v1.6.3.6-v9 Key Files

| File | New Features (v1.6.3.6-v9) |
|------|---------------------------|
| `quick-tabs-manager.js` | `adoptQuickTabToCurrentTab()`, `loadFavicon()`, tab switch listener, orphan detection |
| `quick-tabs-manager.css` | Orphan/closed styling, animations, responsive media queries (250-500px) |
| `quick-tabs-manager.html` | `lang="en"`, viewport meta tag |
| `VisibilityHandler.js` | Structured confirmation responses `{ success, quickTabId, action }` |
| `content.js` | Enhanced `_handleManagerAction()` confirmation responses |

### v1.6.3.6-v7 Patterns (Retained)

- **ID Pattern Recovery** - `_extractTabIdFromQuickTabId()` extracts tab ID from ID pattern
- **Orphan Recovery Fallback** - `_checkTabScopeWithReason()` recovers when originTabId is null
- **In-Place Patching** - Patches originTabId for subsequent operations
- **3-Stage Restoration Logging** - Command receipt, handler invocation, completion

## v1.6.3.6-v5 Patterns

- **Strict Tab Isolation** - `_shouldRenderOnThisTab()` REJECTS null/undefined originTabId (rejects instead of accepts)
- **_checkTabScopeWithReason()** - Unified validation with structured init logging (total/validated/filtered counts)
- **Deletion State Machine** - DestroyHandler._destroyedIds Set prevents deletion loops
- **initiateDestruction()** - Single unified entry point for all deletions
- **_broadcastDeletionToAllTabs()** - Sender filtering prevents echo back to deletion initiator
- **Storage Operation Logging** - `logStorageRead()`, `logStorageWrite()` track all storage ops
- **Message Correlation IDs** - `generateMessageId()` creates unique IDs for message tracing

### v1.6.3.6-v6 Key Files (renamed from v1.6.4)

| File | New Features (v1.6.3.6-v6) |
|------|---------------------------|
| `minimized-manager.js` | `savedOriginTabId` in snapshots, originTabId restore application |
| `UICoordinator.js` | `_tryApplySnapshotFromManager()` applies originTabId from snapshot |
| `VisibilityHandler.js` | originTabId logging in `_performTabWindowRestore()`, `_verifyRestoreAndEmit()` |

### v1.6.3.6-v5 Key Files

| File | New Features (v1.6.3.6-v5) |
|------|---------------------------|
| `UICoordinator.js` | `_checkTabScopeWithReason()`, strict null originTabId rejection |
| `DestroyHandler.js` | `_destroyedIds` Set, `initiateDestruction()`, single authority |
| `background.js` | `_broadcastDeletionToAllTabs()`, `generateMessageId()`, `logMessageDispatch()` |
| `storage-utils.js` | `logStorageRead()`, `logStorageWrite()`, operation correlation IDs |
| `content.js` | `logMessageReceipt()` with correlation IDs |

### v1.6.3.6-v4 Patterns (Retained)

- **Circuit Breaker** - Blocks ALL writes when `pendingWriteCount >= 15`, auto-resets at `< 10`
- **Fail-Closed Validation** - `validateOwnershipForWrite()` returns `shouldWrite: false` when `tabId === null`
- **Escalation Warning** - `scheduleFallbackCleanup()` fires warning at 250ms if transaction still pending
- **Faster Loop Detection** - `DUPLICATE_SAVEID_THRESHOLD = 1`, `TRANSACTION_FALLBACK_CLEANUP_MS = 500ms`

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
| `BROADCAST_HISTORY_WINDOW_MS` | 100 | Broadcast dedup window (v1.6.3.6-v4) |
| `STATE_EMIT_DELAY_MS` | 100 | State event fires first |
| `DRAG_DEBOUNCE_MS` | 200 | Debounced drag/resize persistence |
| `ESCALATION_WARNING_MS` | 250 | Intermediate stale transaction warning |
| `DOM_VERIFICATION_DELAY_MS` | 500 | DOM verify timing |
| `TRANSACTION_FALLBACK_CLEANUP_MS` | 500 | Transaction cleanup timeout |
| `BROADCAST_CIRCUIT_BREAKER_LIMIT` | 10 | Trips after 10+ broadcasts/100ms (v1.6.3.6-v4) |
| `DUPLICATE_SAVEID_WINDOW_MS` | 1000 | Duplicate saveId detection window |
| `DUPLICATE_SAVEID_THRESHOLD` | 1 | Max same saveId writes before warning |
| `RENDER_COOLDOWN_MS` | 1000 | Prevent duplicate renders |
| `ANIMATION_DURATION_MS` | 350 | Collapse/expand animation (v1.6.3.6-v9) |
| `FAVICON_LOAD_TIMEOUT_MS` | 2000 | Favicon loading timeout (v1.6.3.6-v9) |
| `RESTORE_CONFIRMATION_TIMEOUT_MS` | 500 | Restore confirmation tracking (v1.6.3.6-v9) |
| `STORAGE_TIMEOUT_MS` | 2000 | Storage operation timeout |
| `RESTORE_DEDUP_WINDOW_MS` | 2000 | Restore message dedup |
| `CLOSE_ALL_MUTEX_RELEASE_MS` | 2000 | closeAll mutex cooldown |
| `CIRCUIT_BREAKER_THRESHOLD` | 15 | Block ALL writes when queue exceeds this |
| `CIRCUIT_BREAKER_RESET_THRESHOLD` | 10 | Auto-reset circuit breaker below this |
| `TAB_INFO_CACHE_TTL_MS` | 30000 | Browser tab metadata cache TTL (v1.6.3.6-v8) |

---

## Architecture Classes

| Class | Key Methods |
|-------|-------------|
| QuickTabStateMachine | `canTransition()`, `transition()` |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| MinimizedManager | `forceCleanup()`, `getAllSnapshotIds()`, `savedOriginTabId` snapshots |
| UICoordinator | `setHandlers()`, `_buildCallbackOptions()`, `clearAll()`, `_tryApplySnapshotFromManager()` |
| VisibilityHandler | `_executeRestore()`, `_applyZIndexUpdate()` |
| QuickTabWindow | `rewireCallbacks()`, `_logIfStateDesync()` |
| DestroyHandler | `_closeAllInProgress` mutex, `_destroyedIds` Set, `initiateDestruction()` |

---

## 🔧 Storage Utilities (`src/utils/storage-utils.js`)

| Export | Description |
|--------|-------------|
| `STATE_KEY` | Storage key (`quick_tabs_state_v2`) |
| `WRITING_INSTANCE_ID` | Triple-source entropy unique ID |
| `logStorageRead()`, `logStorageWrite()` | Storage operation logging with correlation IDs (v1.6.3.6-v5) |
| `canCurrentTabModifyQuickTab()` | Check tab ownership |
| `validateOwnershipForWrite(tabs, tabId, forceEmpty)` | Filter tabs by ownership |
| `isSelfWrite(storageValue)` | Check if write from current tab |
| `persistStateToStorage()` | Write with ownership validation |
| `queueStorageWrite()` | Queue writes with circuit breaker check |

**CRITICAL:** Always use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

**Core Patterns:**
- Promise sequencing, debounced drag, orphan recovery, per-tab scoping
- Transaction rollback, state machine, ownership validation, Single Writer Model
- Coordinated clear, closeAll mutex, `window:created` event
- DOM lookup (`__quickTabWindow`), `data-quicktab-id`, `DragController.updateElement()`
- Cross-tab filtering in handlers prevents ghost Quick Tabs
- **v1.6.3.6-v9:** Orphan adoption, tab switch detection, structured confirmations, smooth animations
- **v1.6.3.6-v8:** Multi-layer ID recovery, cross-tab grouping UI, tab metadata caching, emoji diagnostics
- **v1.6.3.6-v7:** ID pattern recovery, in-place patching, 3-stage restoration logging
- **v1.6.3.6-v6:** originTabId snapshot preservation, restore application, restore logging
- **v1.6.3.6-v5:** Strict tab isolation, deletion state machine, unified deletion path, storage/message logging

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
**Start of task:** Search for relevant memories before starting work

### ⚠️ PERMANENT: search_memories Usage Guide

**DO NOT EDIT THIS SECTION** - Verified working method for GitHub Copilot Coding Agent environment.

**Optimal search_memories Parameters:**
```javascript
agentic-tools-search_memories({
  query: "single keyword",  // Use 1-2 words MAX, NOT long phrases
  threshold: 0.1,           // REQUIRED: Default 0.3 is too high, use 0.1
  limit: 5,                 // 5-10 results is optimal
  workingDirectory: "/full/path/to/repo"  // Always use absolute path
})
```

**Working Examples:**
- ✅ `query: "storage"` - Finds storage-related memories
- ✅ `query: "Quick Tab"` - Finds Quick Tab memories
- ✅ `query: "bug"` - Finds bug fix memories
- ✅ `query: "cross-tab"` - Finds cross-tab sync memories
- ❌ `query: "deletion bug fix"` - Too many words, returns nothing
- ❌ `query: "Quick Tab Manager synchronization issues"` - Too long

**Bash Fallback (if search_memories fails):**
```bash
# Search memory file names and content
grep -r -l "keyword" .agentic-tools-mcp/memories/ 2>/dev/null
# View specific memory file
cat .agentic-tools-mcp/memories/category/filename.json
```

**Key Rules:**
1. Always use `threshold: 0.1` (critical - default is too high)
2. Use single words or 2-word phrases only
3. If compound query fails, try individual words separately
4. Use bash grep as fallback for complex searches

**DO NOT USE** `store_memory` tool - use agentic-tools MCP create_memory instead.

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass
- [ ] Memory files committed

---

## 📋 Quick Reference

### Key Files

| File | Key Features |
|------|-------------|
| `background.js` | `_broadcastDeletionToAllTabs()`, `generateMessageId()`, message correlation |
| `src/content.js` | `logMessageReceipt()`, 3-stage RESTORE_QUICK_TAB logging |
| `src/utils/storage-utils.js` | `logStorageRead()`, `logStorageWrite()`, operation logging |
| `index.js` | `_checkTabScopeWithReason()` recovery with entity patching (v1.6.3.6-v8) |
| `UICoordinator.js` | `_shouldRenderOnThisTab()` recovery, in-place patching |
| `DestroyHandler.js` | `_destroyedIds` Set, `initiateDestruction()`, single authority path |
| `CreateHandler.js` | `_extractTabIdFromQuickTabId()` final fallback (v1.6.3.6-v8) |
| `UpdateHandler.js` | `_doPersist()` logging, success confirmation |
| `window.js` | `rewireCallbacks()`, operation flags, `_logIfStateDesync()` |
| `VisibilityHandler.js` | Structured confirmations `{ success, quickTabId, action }` (v1.6.3.6-v9) |
| `minimized-manager.js` | ID pattern extraction in `add()`, `savedOriginTabId` snapshots |
| `quick-tabs-manager.js` | `adoptQuickTabToCurrentTab()`, `loadFavicon()`, tab switch detection (v1.6.3.6-v9) |
| `quick-tabs-manager.css` | Orphan/closed styling, animations, responsive breakpoints (v1.6.3.6-v9) |

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quickTabShowDebugId` (storage.local)  
**Manager Collapse State Key:** `quickTabsManagerCollapseState` (storage.local) (v1.6.3.6-v8)

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
