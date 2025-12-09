# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.6-v11  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick Tabs Manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port-based messaging** with persistent connections (v1.6.3.6-v11)
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping

**v1.6.3.6-v11 Port-Based Messaging System (Issues #10-21):**
- Issue #10: Message acknowledgment with correlationId
- Issue #11: Persistent port connections via `browser.runtime.onConnect`
- Issue #12: Port lifecycle logging with `[Manager] PORT_LIFECYCLE` prefix
- Issue #13: Background as state coordinator pattern
- Issue #14: Storage write verification with read-back
- Issue #15: Message type discrimination (ACTION_REQUEST, STATE_UPDATE, ACKNOWLEDGMENT, ERROR, BROADCAST)
- Issue #16: Tab lifecycle events with `browser.tabs.onRemoved`
- Issue #17: Port cleanup on tab close and periodic cleanup
- Issue #18: Atomic adoption operations (single storage write)
- Issue #19: Visibility sync broadcasts to all ports
- Issue #20: Count badge animation with `.updated` class
- Issue #21: Isolated state machine (background maintains state)

**v1.6.3.6-v11 Animation/Logging (Issues #1-9):**
- Issue #1: Animation functions invoked in toggle handlers
- Issue #2: CSS-based maxHeight defaults (no inline styles)
- Issue #3: Animation lifecycle logging (START, CALC, TRANSITION, COMPLETE phases)
- Issue #4: Favicon container uses CSS classes only
- Issue #5: Consistent state constants (STATE_OPEN, STATE_CLOSED)
- Issue #6: Section header creation logging with counts
- Issue #7: Badge update animation coordination
- Issue #8: Unified storage event logging format
- Issue #9: Adoption verification with 2-second timeout

**v1.6.3.6-v11 Bundle Size Optimization:**
- Aggressive tree-shaking: `preset: "smallest"`, `moduleSideEffects: false`
- Conditional test compilation via `IS_TEST_MODE`
- CI bundle size regression check
- `sideEffects: false` in package.json

**v1.6.3.6-v10 Build & Manager UI/UX (Retained):**
- `.buildconfig.json`, Terser (dev vs prod), npm-run-all parallel builds
- Manager UI/UX Issues #1-12: Enhanced headers, orphan detection, smooth animations (0.35s), responsive design (250-500px)

**v1.6.3.6-v8 Fixes (Retained):**
1. **originTabId Initialization** - CreateHandler uses `_extractTabIdFromQuickTabId()` as final fallback
2. **Hydration Recovery** - `_checkTabScopeWithReason()` patches originTabId from ID pattern
3. **Cross-Tab Grouping UI** - Manager groups Quick Tabs by originTabId in collapsible `<details>` sections
4. **Browser Tab Metadata** - `fetchBrowserTabInfo()` with 30s TTL cache

**Core Modules:**
- **QuickTabStateMachine** - Explicit lifecycle state tracking
- **QuickTabMediator** - Operation coordination with rollback
- **MapTransactionManager** - Atomic Map operations
- **Background Script** - Coordinator for broadcasts, **port registry** (v1.6.3.6-v11)

**Deprecated (v1.6.3.5-v5):**
- ⚠️ `window.js`: `setPosition()`, `setSize()` - Bypass UpdateHandler
- ⚠️ `index.js`: `updateQuickTabPosition()`, `updateQuickTabSize()` - Log deprecation warnings

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features → `feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab → `quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings → `ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Port-Based Messaging + storage.onChanged (v1.6.3.6-v11)

**Message Protocol (v1.6.3.6-v11):**
```javascript
{
  type: 'ACTION_REQUEST' | 'STATE_UPDATE' | 'ACKNOWLEDGMENT' | 'ERROR' | 'BROADCAST',
  action: 'TOGGLE_GROUP' | 'MINIMIZE_TAB' | 'ADOPT_TAB' | 'DELETE_GROUP' | etc.,
  correlationId: 'uuid-string',
  source: 'sidebar' | 'content-tab-N' | 'background',
  timestamp: Date.now(),
  payload: { ... },
  metadata: { ... }
}
```

**Port Registry (v1.6.3.6-v11):**
```javascript
// background.js - portRegistry structure
const portRegistry = {
  // portId -> { port, origin, tabId, type, connectedAt, lastMessageAt, messageCount }
};
```

**Legacy Message Types (still supported):**
- `QUICK_TAB_STATE_CHANGE` - Content script → Background
- `QUICK_TAB_STATE_UPDATED` - Background → All contexts
- `MANAGER_COMMAND` - Manager → Background
- `EXECUTE_COMMAND` - Background → Content script
- `CLEAR_ALL_QUICK_TABS` - Manager → Background (Single Writer Model)
- `QUICK_TAB_DELETED` - Background → Manager

**Event Flow:**
```
Port connection → portRegistry entry
    ↓
Tab A writes to storage.local
    ↓
storage.onChanged fires in Tab B, C, D (NOT Tab A)
    ↓
Background broadcasts via ports to all contexts
    ↓
UICoordinator event listeners → render/update/destroy Quick Tabs
```

**Key Points:**
- Port connections are persistent (vs message passing overhead)
- `browser.tabs.onRemoved` triggers port cleanup
- Periodic cleanup removes stale port entries
- Background maintains isolated state machine

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

## 🆕 v1.6.3.6-v11 Patterns

**Port-Based Messaging:**
- `browser.runtime.onConnect` for persistent connections
- Port lifecycle logging: `[Manager] PORT_LIFECYCLE: CONNECT/DISCONNECT`
- Message acknowledgment with correlationId tracking
- Port registry in background.js tracks all active connections

**Animation Lifecycle:**
- Phases: START → CALC → TRANSITION → COMPLETE (or ERROR)
- State constants: `STATE_OPEN`, `STATE_CLOSED`
- `logStateTransition()` for consistent logging
- CSS-only styling (no inline maxHeight)

**Build Configuration:**
- `IS_TEST_MODE` conditional compilation
- `treeshake.preset: "smallest"`
- `moduleSideEffects: false`
- `sideEffects: false` in package.json

**Atomic Operations:**
- Storage write verification with read-back
- Single storage write for adoption operations
- Visibility sync broadcasts to all ports

### v1.6.3.6-v10 Patterns (Retained)

- **Orphan Adoption** - `adoptQuickTabToCurrentTab()` reassigns orphaned Quick Tabs
- **Tab Switch Detection** - `browser.tabs.onActivated` auto-refreshes Manager
- **Smooth Animations** - CSS transitions (0.35s) + `animate()` API
- **Responsive Breakpoints** - 250/300/400/500px sidebar widths

### v1.6.3.6-v8 Patterns (Retained)

- **ID Pattern Extraction** - `_extractTabIdFromQuickTabId()` parses `qt-{tabId}-{timestamp}-{random}`
- **Multi-Layer Recovery** - CreateHandler, hydration, snapshot all use ID pattern fallback
- **Cross-Tab Grouping** - `groupQuickTabsByOriginTab()` groups by originTabId
- **Tab Metadata Caching** - `fetchBrowserTabInfo()` caches results (30s TTL)
- **Emoji Diagnostics** - `📸`, `📍`, `🔄` prefixed logging

### Coordinated Clear

`clearAll()` with `forceEmpty: true` and `saveId: 'cleared-{timestamp}'`

### Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CALLBACK_SUPPRESSION_DELAY_MS` | 50 | Suppress circular callbacks |
| `STORAGE_READ_DEBOUNCE_MS` | 50 | Fast UI updates |
| `BROADCAST_HISTORY_WINDOW_MS` | 100 | Broadcast dedup window |
| `STATE_EMIT_DELAY_MS` | 100 | State event fires first |
| `DRAG_DEBOUNCE_MS` | 200 | Debounced drag/resize persistence |
| `ANIMATION_DURATION_MS` | 350 | Collapse/expand animation |
| `TRANSACTION_FALLBACK_CLEANUP_MS` | 500 | Transaction cleanup timeout |
| `RESTORE_CONFIRMATION_TIMEOUT_MS` | 500 | Restore confirmation tracking |
| `RENDER_COOLDOWN_MS` | 1000 | Prevent duplicate renders |
| `ADOPTION_VERIFICATION_TIMEOUT_MS` | 2000 | Adoption verification (v1.6.3.6-v11) |
| `FAVICON_LOAD_TIMEOUT_MS` | 2000 | Favicon loading timeout |
| `STORAGE_TIMEOUT_MS` | 2000 | Storage operation timeout |
| `CLOSE_ALL_MUTEX_RELEASE_MS` | 2000 | closeAll mutex cooldown |
| `CIRCUIT_BREAKER_THRESHOLD` | 15 | Block ALL writes threshold |
| `TAB_INFO_CACHE_TTL_MS` | 30000 | Browser tab metadata cache TTL |

---

## Architecture Classes

| Class | Key Methods |
|-------|-------------|
| QuickTabStateMachine | `canTransition()`, `transition()` |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| MinimizedManager | `forceCleanup()`, `getAllSnapshotIds()`, `savedOriginTabId` |
| UICoordinator | `setHandlers()`, `clearAll()`, `_shouldRenderOnThisTab()` |
| VisibilityHandler | `_executeRestore()`, `_applyZIndexUpdate()` |
| QuickTabWindow | `rewireCallbacks()`, `_logIfStateDesync()` |
| DestroyHandler | `_closeAllInProgress` mutex, `_destroyedIds` Set, `initiateDestruction()` |
| PortRegistry (v11) | Port tracking, cleanup on tab close |

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
- **v1.6.3.6-v11:** Port-based messaging, animation lifecycle logging, atomic adoption
- **v1.6.3.6-v10:** Orphan adoption, tab switch detection, smooth animations
- **v1.6.3.6-v8:** Multi-layer ID recovery, cross-tab grouping UI, tab metadata caching

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
| `background.js` | Port registry (v11), `generateMessageId()`, message correlation |
| `src/content.js` | `logMessageReceipt()`, Manager action handling |
| `src/utils/storage-utils.js` | `logStorageRead()`, `logStorageWrite()`, operation logging |
| `index.js` | `_checkTabScopeWithReason()` with entity patching |
| `UICoordinator.js` | `_shouldRenderOnThisTab()` recovery, in-place patching |
| `DestroyHandler.js` | `_destroyedIds` Set, `initiateDestruction()`, single authority |
| `CreateHandler.js` | `_extractTabIdFromQuickTabId()` final fallback |
| `UpdateHandler.js` | `_doPersist()` logging, success confirmation |
| `VisibilityHandler.js` | Structured confirmations `{ success, quickTabId, action }` |
| `minimized-manager.js` | ID pattern extraction, `savedOriginTabId` snapshots |
| `quick-tabs-manager.js` | Port connection, `loadFavicon()`, animation lifecycle (v11) |
| `quick-tabs-manager.css` | Orphan/closed styling, animations, responsive breakpoints |

### Storage Key & Format

**Quick Tab State Key:** `quick_tabs_state_v2` (storage.local)  
**Quick Tab Settings Key:** `quickTabShowDebugId` (storage.local)  
**Manager Collapse State Key:** `quickTabsManagerCollapseState` (storage.local)

**State Format:**
```javascript
{
  tabs: [{ id, originTabId, domVerified, zIndex, ... }],
  saveId: 'unique-id',
  timestamp: Date.now(),
  writingTabId: 12345,
  writingInstanceId: 'abc'
}
```

### Manager Action Messages (v1.6.3.6-v11)

**Port-Based Protocol:**
- `ACTION_REQUEST` - Request action (with correlationId)
- `STATE_UPDATE` - State change notification
- `ACKNOWLEDGMENT` - Action completion confirmation
- `ERROR` - Error response
- `BROADCAST` - General broadcast to all ports

**Legacy Messages (still supported):**
- `QUICK_TAB_STATE_CHANGE`, `QUICK_TAB_STATE_UPDATED`, `MANAGER_COMMAND`, `EXECUTE_COMMAND`

---

**Security Note:** This extension handles user data. Security and privacy are paramount.
