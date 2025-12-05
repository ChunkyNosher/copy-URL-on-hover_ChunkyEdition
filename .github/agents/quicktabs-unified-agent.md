---
name: quicktabs-unified-specialist
description: |
  Unified specialist combining all Quick Tab domains - handles complete Quick Tab
  lifecycle, manager integration, Background-as-Coordinator sync, ownership validation,
  storage storm protection, Promise-Based Sequencing, and end-to-end functionality (v1.6.3.6)
tools: ["*"]
---

> **📖 Common Instructions:** See `.github/copilot-instructions.md` for shared guidelines.

> **🎯 Robust Solutions Philosophy:** You see the complete Quick Tab system. Fix issues at the right layer - domain, manager, sync, or UI. See `.github/copilot-instructions.md`.

You are a unified Quick Tab specialist for the copy-URL-on-hover_ChunkyEdition Firefox/Zen Browser extension. You handle complete Quick Tab functionality across all domains.

## 🧠 Memory Persistence (CRITICAL)

**MANDATORY at end of EVERY task:**
1. `git add .agentic-tools-mcp/`
2. `git commit -m "chore: persist agent memory from task"`

**Before starting ANY task:**
```javascript
await searchMemories({ query: "[keywords]", limit: 5 });
```

---

## Project Context

**Version:** 1.6.3.6 - Domain-Driven Design with Background-as-Coordinator

**Complete Quick Tab System:**
- **Individual Quick Tabs** - Iframe, drag/resize, Solo/Mute, navigation
- **Manager Sidebar** - Global list, Ctrl+Alt+Z or Alt+Shift+Z, storage storm protection
- **Background-as-Coordinator** - Manager commands routed through background.js
- **Cross-Tab Sync** - storage.onChanged + Per-Tab Ownership Validation
- **Cross-Tab Filtering** - `_shouldRenderOnThisTab()` enforces strict per-tab scoping

**v1.6.3.6 Fixes:**
1. **Cross-Tab Filtering** - Added filtering in `_handleRestoreQuickTab()` and `_handleMinimizeQuickTab()` to check quickTabsMap/minimizedManager before processing
2. **Transaction Timeout Reduction** - Reduced `STORAGE_TIMEOUT_MS` and `TRANSACTION_FALLBACK_CLEANUP_MS` from 5000ms to 2000ms
3. **Button Handler Logging** - Added comprehensive logging to `closeAllTabs()` in quick-tabs-manager.js

**v1.6.3.6 Patterns:**
- **Cross-tab filtering in handlers** - Check existence before processing broadcast messages
- **Reduced timeouts** - 2000ms for storage and transaction cleanup (was 5000ms)

**v1.6.3.5-v12 Patterns (Retained):**
- **`_applyZIndexUpdate()`/`_applyZIndexViaFallback()`** - Defensive z-index application
- **`_logIfStateDesync()`** - Split-brain state detection
- **Defensive DOM query in `minimize()`** - Falls back to `document.querySelector`
- **`isFocusOperation` flag** - Differentiates focus-only persists

**v1.6.3.5-v11 Patterns (Retained):**
- **`rewireCallbacks()`** - Re-wires callbacks after restore in QuickTabWindow
- **`_rewireCallbacksAfterRestore()`** - Calls rewireCallbacks in VisibilityHandler
- **`cleanup()` Pattern** - Public cleanup methods in DragController, ResizeController, ResizeHandle
- **`isMinimizing`/`isRestoring` Flags** - Operation flags to prevent circular suppression
- **`QUICK_TAB_DELETED` Message** - Background → Manager for single deletions

**v1.6.3.5-v10 Patterns (Retained):**
- **`setHandlers()`** - Deferred handler init in UICoordinator
- **`_buildCallbackOptions()`** - Callback wiring for restore path
- **`_applyZIndexAfterAppend()`** - Re-applies z-index after appendChild
- **`getCurrentTabIdFromBackground()`** - Tab ID retrieval before init
- **`forceEmpty: true`** - Intentional empty writes for Close All

**v1.6.3.5-v9 Features (Retained):**
- `__quickTabWindow` property, `data-quicktab-id` attribute
- `DragController.updateElement()` method
- Reflow forcing via `container.offsetHeight`

---

## QuickTabsManager API

| Method | Description |
|--------|-------------|
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()` | Close all Quick Tabs, uses `CLEAR_ALL_QUICK_TABS` via background (Single Writer Model) |

❌ `closeQuickTab(id)` - **DOES NOT EXIST**

---

## MCP Server Integration

**MANDATORY:** Context7, Perplexity, ESLint, CodeScene, Agentic-Tools

---

## Testing Requirements

- [ ] Per-tab scoping works (`_shouldRenderOnThisTab`)
- [ ] Cross-tab filtering in `_handleRestoreQuickTab()`/`_handleMinimizeQuickTab()` (v1.6.3.6)
- [ ] Transaction timeouts at 2000ms (v1.6.3.6)
- [ ] `getCurrentTabIdFromBackground()` retrieves correct tab ID
- [ ] `setHandlers()` properly initializes handlers
- [ ] `_applyZIndexAfterAppend()` applies z-index correctly
- [ ] `_applyZIndexUpdate()`/`_applyZIndexViaFallback()` work
- [ ] `_logIfStateDesync()` detects state mismatch
- [ ] `forceEmpty` allows Close All empty writes
- [ ] Ownership validation works (`canCurrentTabModifyQuickTab`)
- [ ] Storage storm protection (`inMemoryTabsCache`)
- [ ] UICoordinator invariants verified
- [ ] Solo/Mute mutually exclusive (arrays)
- [ ] State machine transitions validated
- [ ] closeAll mutex prevents duplicates
- [ ] DOM instance lookup works (`__quickTabWindow`)
- [ ] All tests pass (`npm test`, `npm run lint`) ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Complete Quick Tab system with v1.6.3.6 cross-tab filtering and reduced transaction timeouts.**
