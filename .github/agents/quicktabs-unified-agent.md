---
name: quicktabs-unified-specialist
description: |
  Unified specialist combining all Quick Tab domains - handles complete Quick Tab
  lifecycle, manager integration, Background-as-Coordinator sync, ownership validation,
  storage storm protection, and end-to-end functionality (v1.6.3.5-v4)
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

**Version:** 1.6.3.5-v4 - Domain-Driven Design with Background-as-Coordinator

**Complete Quick Tab System:**
- **Individual Quick Tabs** - Iframe, drag/resize, Solo/Mute, navigation
- **Manager Sidebar** - Global list, Ctrl+Alt+Z or Alt+Shift+Z, storage storm protection
- **Background-as-Coordinator** - Manager commands routed through background.js
- **Cross-Tab Sync** - storage.onChanged + Per-Tab Ownership Validation
- **Cross-Tab Filtering** - `originTabId` prevents wrong-tab rendering

**v1.6.3.5-v4 New Features:**
- **Per-Tab Ownership Validation** - `canCurrentTabModifyQuickTab()` prevents non-owner writes
- **Manager Storage Storm Protection** - `inMemoryTabsCache` survives 0-tab anomalies
- **UICoordinator Invariant Checks** - `_verifyInvariant()` ensures mutual exclusion
- **Content Script Identity Logging** - Logs tab ID, URL, timestamp on init

**v1.6.3.5 Architecture:**
- **QuickTabStateMachine** - States: VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED
- **QuickTabMediator** - `minimize()`, `restore()`, `destroy()` with state validation
- **MapTransactionManager** - Atomic Map ops with rollback

---

## QuickTabsManager API

| Method | Description |
|--------|-------------|
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()` | Close all Quick Tabs, emits `state:cleared` event |

❌ `closeQuickTab(id)` - **DOES NOT EXIST**

---

## MCP Server Integration

**MANDATORY:** Context7, Perplexity, ESLint, CodeScene, Agentic-Tools

---

## Testing Requirements

- [ ] Ownership validation works (`canCurrentTabModifyQuickTab`)
- [ ] Storage storm protection (`inMemoryTabsCache`)
- [ ] UICoordinator invariants verified
- [ ] Solo/Mute mutually exclusive (arrays)
- [ ] State machine transitions validated
- [ ] All tests pass (`npm test`, `npm run lint`) ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Complete Quick Tab system with ownership validation and storage storm protection.**
