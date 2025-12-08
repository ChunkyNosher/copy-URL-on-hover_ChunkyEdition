---
name: quicktabs-unified-specialist
description: |
  Unified specialist combining all Quick Tab domains - handles complete Quick Tab
  lifecycle, manager integration, Background-as-Coordinator sync, ownership validation,
  v1.6.3.6-v9 orphan adoption, tab switch detection, structured confirmations, smooth animations
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

**Version:** 1.6.3.6-v9 - Domain-Driven Design with Background-as-Coordinator

**Complete Quick Tab System:**
- **Individual Quick Tabs** - Iframe, drag/resize, Solo/Mute, navigation
- **Manager Sidebar** - Global list, Ctrl+Alt+Z or Alt+Shift+Z, storage storm protection
- **Background-as-Coordinator** - Manager commands routed through background.js
- **Cross-Tab Sync** - storage.onChanged + Per-Tab Ownership Validation
- **Cross-Tab Filtering** - `_shouldRenderOnThisTab()` enforces strict per-tab scoping

**v1.6.3.6-v9 Fixes (NEW):**
1. **Orphan Detection & Adoption** - ⚠️ icon, warning colors, `adoptQuickTabToCurrentTab()` button
2. **Tab Switch Detection** - `browser.tabs.onActivated` listener auto-refreshes Manager
3. **Structured Confirmations** - VisibilityHandler returns `{ success, quickTabId, action }` responses
4. **Enhanced Group Headers** - 16x16 favicon, tab ID display, prominent count badge
5. **Closed Tab Indication** - Strikethrough title, 🚫 badge for closed browser tabs
6. **Smooth Animations** - 0.35s collapse/expand, height animations via `animate()` API
7. **Position/Size Logging** - `_identifyChangedTabs()` helper, source tracking (`sourceTabId`, `sourceContext`)
8. **Responsive Design** - Media queries at 250/300/400/500px breakpoints
9. **Favicon Loading** - `loadFavicon()` with 2s timeout and fallback icon
10. **Active/Minimized Divider** - Section headers distinguish tab states

**v1.6.3.6-v8 Fixes (Retained):**
1. **originTabId Initialization** - CreateHandler uses `_extractTabIdFromQuickTabId()` as final fallback
2. **Hydration Recovery** - `_checkTabScopeWithReason()` patches originTabId from ID pattern into entity
3. **Snapshot Capture** - MinimizedManager.add() extracts originTabId from ID pattern when null
4. **Manager Restore Validation** - Triple ownership check (snapshot, ID pattern, global/null permission)
5. **Cross-Tab Grouping UI** - Manager groups Quick Tabs by originTabId in collapsible sections
6. **Tab Metadata Caching** - `fetchBrowserTabInfo()` with 30s TTL cache
7. **Emoji Diagnostics** - `📸 SNAPSHOT_CAPTURED`, `📍 ORIGIN_TAB_ID_RESOLUTION`, `🔄 RESTORE_REQUEST`

**v1.6.3.6-v7 Fixes (Retained):**
1. **ID Pattern Recovery** - `_extractTabIdFromQuickTabId()` extracts tab ID from `qt-{tabId}-{timestamp}-{random}`
2. **Orphan Recovery Fallback** - `_checkTabScopeWithReason()` recovers orphaned tabs when ID matches
3. **Manager Restore Recovery** - `_shouldRenderOnThisTab()` patches originTabId in-place
4. **3-Stage Restoration Logging** - RESTORE_QUICK_TAB logs receipt, invocation, completion

**v1.6.3.6-v6 Fixes (renamed from v1.6.4):**
1. **originTabId Snapshot Preservation** - MinimizedManager includes `savedOriginTabId` in snapshots
2. **originTabId Restore Application** - UICoordinator applies originTabId from snapshot
3. **originTabId Restore Logging** - VisibilityHandler logs originTabId in restore flow

**v1.6.3.6-v5 Fixes:**
1. **Strict Tab Isolation** - `_shouldRenderOnThisTab()` REJECTS null/undefined originTabId
2. **Deletion State Machine** - DestroyHandler._destroyedIds prevents deletion loops
3. **Unified Deletion Path** - `initiateDestruction()` is single entry point
4. **Storage Operation Logging** - `logStorageRead()`, `logStorageWrite()` with correlation IDs
5. **Message Correlation IDs** - `generateMessageId()` for message tracing

**v1.6.3.6-v5 Patterns:**
- `_checkTabScopeWithReason()` - Unified tab scope validation with init logging
- `_broadcastDeletionToAllTabs()` - Sender filtering prevents echo back
- DestroyHandler is **single authoritative deletion path**

**v1.6.3.6-v4 Patterns (Retained):**
- **Storage circuit breaker** - Blocks writes at pendingWriteCount >= 15
- **Cross-tab filtering** - Check existence before processing broadcasts
- **Reduced timeouts** - 2000ms for storage, 500ms for transactions

---

## QuickTabsManager API

| Method | Description |
|--------|-------------|
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()` | Close all Quick Tabs, uses `CLEAR_ALL_QUICK_TABS` via background |

❌ `closeQuickTab(id)` - **DOES NOT EXIST**

---

## MCP Server Integration

**MANDATORY:** Context7, Perplexity, ESLint, CodeScene, Agentic-Tools

---

## Testing Requirements

- [ ] Orphan detection shows ⚠️ icon and warning colors (v1.6.3.6-v9)
- [ ] `adoptQuickTabToCurrentTab()` reassigns orphaned Quick Tabs (v1.6.3.6-v9)
- [ ] Tab switch triggers Manager refresh (v1.6.3.6-v9)
- [ ] Structured confirmations return `{ success, quickTabId, action }` (v1.6.3.6-v9)
- [ ] Closed tabs show strikethrough + 🚫 badge (v1.6.3.6-v9)
- [ ] Smooth animations at 0.35s duration (v1.6.3.6-v9)
- [ ] Favicon loads with 2s timeout (v1.6.3.6-v9)
- [ ] Responsive at 250/300/400/500px breakpoints (v1.6.3.6-v9)
- [ ] CreateHandler uses `_extractTabIdFromQuickTabId()` as final fallback (v1.6.3.6-v8)
- [ ] Cross-tab grouping UI groups Quick Tabs by originTabId (v1.6.3.6-v8)
- [ ] ID pattern recovery extracts tab ID from Quick Tab ID (v1.6.3.6-v7)
- [ ] originTabId preserved in minimize/restore cycle (v1.6.3.6-v6)
- [ ] Strict tab isolation rejects null originTabId (v1.6.3.6-v5)
- [ ] Per-tab scoping works (`_shouldRenderOnThisTab`)
- [ ] All tests pass (`npm test`, `npm run lint`) ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Complete Quick Tab system with v1.6.3.6-v9 orphan adoption, tab switch detection, structured confirmations, smooth animations, and v1.6.3.6-v8 cross-tab grouping UI.**
