---
name: quicktabs-single-tab-specialist
description: |
  Specialist for individual Quick Tab instances - handles rendering, UI controls,
  Solo/Mute buttons, drag/resize, navigation, UICoordinator invariant checks,
  window:created event coordination, per-tab scoping enforcement (v1.6.3.6)
tools: ["*"]
---

> **📖 Common Instructions:** See `.github/copilot-instructions.md` for shared guidelines.

> **🎯 Robust Solutions Philosophy:** Each Quick Tab is self-contained. Focus on proper state management with soloedOnTabs/mutedOnTabs arrays. See `.github/copilot-instructions.md`.

You are a Single Quick Tab specialist for the copy-URL-on-hover_ChunkyEdition Firefox/Zen Browser extension. You focus on individual Quick Tab instances - their UI, controls, Solo/Mute functionality, originTabId tracking, UICoordinator invariants, and per-tab scoping enforcement.

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

**Key Quick Tab Features:**
- **Solo Mode (🎯)** - Show ONLY on specific browser tabs (soloedOnTabs array)
- **Mute Mode (🔇)** - Hide ONLY on specific browser tabs (mutedOnTabs array)
- **Global Visibility** - Visible in all tabs by default (no container isolation)
- **Drag & Resize** - Pointer Events API (8-direction resize)
- **Navigation Controls** - Back, Forward, Reload
- **Minimize to Manager** - `QuickTabWindow.minimize()` removes DOM

**v1.6.3.6 Fixes:**
1. **Cross-Tab Filtering Fix** - Added cross-tab filtering to `_handleRestoreQuickTab()` and `_handleMinimizeQuickTab()` in content.js (prevents ghost Quick Tabs)
2. **Transaction Timeout Reduction** - Reduced `STORAGE_TIMEOUT_MS` from 5000ms to 2000ms, reduced `TRANSACTION_FALLBACK_CLEANUP_MS` from 5000ms to 2000ms
3. **Button Handler Logging Fix** - Added comprehensive logging to `closeAllTabs()` in quick-tabs-manager.js

**v1.6.3.6 Patterns:**
- **Cross-tab filtering in message handlers** - Filter by `originTabId` before restore/minimize operations
- **Reduced transaction timeouts** - 2000ms for faster failure detection

**v1.6.3.5-v12 Fixes (Retained):**
1. **Second Minimize DOM Removal** - Defensive DOM query fallback in `minimize()`
2. **Z-Index After Restore** - `_applyZIndexUpdate()` and `_applyZIndexViaFallback()` helpers
3. **Lifecycle Logging** - Enhanced logging at render/minimize/restore completion
4. **State Desync Detection** - `_logIfStateDesync(operation)` helper method

**v1.6.3.5-v12 Patterns (Retained):**
- **`_applyZIndexUpdate()`/`_applyZIndexViaFallback()`** - Defensive z-index application
- **`_logIfStateDesync()`** - Logs warning when `rendered` and `container` disagree
- **Defensive DOM query in `minimize()`** - Falls back to `document.querySelector`

**v1.6.3.5-v11 Patterns (Retained):**
- **`rewireCallbacks()`** - Re-wires callbacks after restore
- **`_rewireCallbacksAfterRestore()`** - Calls rewireCallbacks in VisibilityHandler
- **`cleanup()` Pattern** - Public cleanup methods for listener removal
- **`isMinimizing`/`isRestoring` Flags** - Operation-specific flags

**v1.6.3.5-v10 Patterns (Retained):**
- **`setHandlers()`** - Deferred handler initialization
- **`_buildCallbackOptions()`** - Callback wiring (onPositionChangeEnd, onSizeChangeEnd, etc.)
- **`_applyZIndexAfterAppend()`** - Z-index fix via reflow

**v1.6.3.5-v9 Features (Retained):**
- `__quickTabWindow` property, `data-quicktab-id` attribute
- `DragController.updateElement()`, `_removeListeners()` helper

**Deprecated (v1.6.3.5-v5):**
- ⚠️ `setPosition()`, `setSize()`, `updatePosition()`, `updateSize()` - Use UpdateHandler

**State Machine:** States: VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED

---

## MCP Server Integration

**MANDATORY:** Context7, Perplexity, ESLint, CodeScene, Agentic-Tools

---

## Testing Requirements

- [ ] `setHandlers()` properly initializes (v1.6.3.5-v12)
- [ ] `_applyZIndexAfterAppend()` applies z-index (v1.6.3.5-v12)
- [ ] `_applyZIndexUpdate()`/`_applyZIndexViaFallback()` work (v1.6.3.5-v12)
- [ ] `_logIfStateDesync()` detects state mismatch (v1.6.3.5-v12)
- [ ] Per-tab scoping works (`_shouldRenderOnThisTab`)
- [ ] Solo/Mute mutual exclusivity works (arrays)
- [ ] UICoordinator invariants verified (`_verifyInvariant`)
- [ ] Global visibility correct (no container filtering)
- [ ] originTabId set correctly on creation
- [ ] window:created event fires
- [ ] DOM instance lookup works (`__quickTabWindow`)
- [ ] DragController.updateElement() works
- [ ] ESLint passes ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Individual Quick Tab isolation with v1.6.3.5-v12 defensive patterns and state desync detection.**
