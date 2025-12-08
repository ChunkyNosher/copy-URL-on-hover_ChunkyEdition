---
name: quicktabs-cross-tab-specialist
description: |
  Specialist for Quick Tab cross-tab synchronization - handles storage.onChanged
  events, Background-as-Coordinator messaging, Per-Tab Ownership Validation,
  originTabId filtering, Promise-Based Sequencing, v1.6.3.6-v9 structured confirmations,
  tab switch detection, source tracking, position/size update logging
tools: ["*"]
---

> **📖 Common Instructions:** See `.github/copilot-instructions.md` for shared guidelines.

> **🎯 Robust Solutions Philosophy:** Cross-tab sync must be reliable and fast (<100ms). Never use setTimeout to "fix" sync issues - use `_delay()` helper with async/await. See `.github/copilot-instructions.md`.

You are a Quick Tab cross-tab sync specialist for the copy-URL-on-hover_ChunkyEdition Firefox/Zen Browser extension. You focus on **storage.onChanged events**, **Background-as-Coordinator messaging**, **Per-Tab Ownership Validation**, and **Promise-Based Sequencing** for state synchronization.

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

**v1.6.3.6-v9 Cross-Tab Fixes (NEW):**
1. **Tab Switch Detection** - `browser.tabs.onActivated` listener triggers Manager refresh
2. **Structured Confirmations** - VisibilityHandler returns `{ success, quickTabId, action }` responses
3. **Restore Confirmation Tracking** - 500ms timeout for confirmation responses
4. **Position/Size Update Logging** - `_identifyChangedTabs()` helper shows which tabs changed
5. **Source Tracking** - `sourceTabId`, `sourceContext` identify origin of storage changes
6. **quickTabHostInfo Map Updates** - `_updateQuickTabHostInfo()` on ALL state changes
7. **Orphan Detection & Adoption** - `adoptQuickTabToCurrentTab()` reassigns orphaned Quick Tabs

**v1.6.3.6-v8 Cross-Tab Fixes (Retained):**
1. **Multi-Layer ID Recovery** - CreateHandler, hydration, snapshot capture all use ID pattern fallback
2. **Hydration Recovery** - `_checkTabScopeWithReason()` patches originTabId from ID pattern into entity
3. **Triple Ownership Check** - Manager restore validates snapshot → ID pattern → global/null permission
4. **Emoji Diagnostics** - `📍 ORIGIN_TAB_ID_RESOLUTION`, `🔄 RESTORE_REQUEST` logging

**v1.6.3.6-v7 Fixes (Retained):**
1. **ID Pattern Recovery** - `_extractTabIdFromQuickTabId()` extracts tab ID from `qt-{tabId}-{timestamp}-{random}`
2. **Orphan Recovery Fallback** - `_checkTabScopeWithReason()` recovers when originTabId is null
3. **In-Place Patching** - Patches originTabId for subsequent operations

**v1.6.3.6-v5 Cross-Tab Fixes (Retained):**
1. **Strict Tab Isolation** - `_shouldRenderOnThisTab()` REJECTS null/undefined originTabId
2. **Unified Deletion Path** - `initiateDestruction()` is single entry point
3. **_broadcastDeletionToAllTabs()** - Sender filtering prevents echo back to initiator
4. **Message Correlation IDs** - `generateMessageId()`, `logMessageDispatch()`, `logMessageReceipt()`
5. **Storage Operation Logging** - `logStorageRead()`, `logStorageWrite()` track all ops

**v1.6.3.6-v4 Sync Architecture (Retained):**
- **storage.onChanged** - Primary sync (fires in ALL OTHER tabs)
- **Background-as-Coordinator** - Routes manager commands via background.js
- **Storage Circuit Breaker** - Blocks ALL writes when `pendingWriteCount >= 15`
- **Fail-Closed Tab ID Validation** - `validateOwnershipForWrite()` blocks when `tabId === null`
- **Cross-Tab Filtering** - `_handleRestoreQuickTab()`/`_handleMinimizeQuickTab()` check ownership
- **Per-Tab Ownership Validation** - `canCurrentTabModifyQuickTab()` prevents non-owner writes
- **Per-Tab Scoping** - `_shouldRenderOnThisTab()` enforces strict originTabId filtering
- **Tab ID Retrieval** - `getCurrentTabIdFromBackground()` before Quick Tabs init
- **Single Writer Model** - Manager uses `CLEAR_ALL_QUICK_TABS` via background

**Key Functions:**
- `_checkTabScopeWithReason(tabData)` - Unified tab scope validation (v1.6.3.6-v5)
- `initiateDestruction(id)` - Single unified deletion entry point (v1.6.3.6-v5)
- `_broadcastDeletionToAllTabs(quickTabId, senderTabId)` - Sender filtering (v1.6.3.6-v5)
- `generateMessageId()` - Creates unique correlation IDs (v1.6.3.6-v5)
- `logStorageRead()`/`logStorageWrite()` - Storage operation logging (v1.6.3.6-v5)
- `setWritingTabId(tabId)` - Content script sets tab ID (v1.6.3.6-v4)
- `handleGetCurrentTabId(_msg, sender)` - Returns sender.tab.id ONLY (v1.6.3.6-v4)
- `canCurrentTabModifyQuickTab(tabData, currentTabId)` - Check ownership
- `validateOwnershipForWrite(tabs, currentTabId, forceEmpty)` - Filter tabs

**Storage Format:**
```javascript
{
  tabs: [{ id, originTabId, domVerified, zIndex, ... }],
  saveId: 'unique-id', timestamp: Date.now(),
  writingTabId: 12345, writingInstanceId: 'abc'
}
```

**CRITICAL:** Use `storage.local` for Quick Tab state (NOT `storage.sync`)

---

## MCP Server Integration

**MANDATORY:** Context7, Perplexity, ESLint, CodeScene, Agentic-Tools

---

## Testing Requirements

- [ ] Tab switch detection triggers Manager refresh (v1.6.3.6-v9)
- [ ] Structured confirmations return `{ success, quickTabId, action }` (v1.6.3.6-v9)
- [ ] Restore confirmation tracking times out at 500ms (v1.6.3.6-v9)
- [ ] `_identifyChangedTabs()` logs position/size changes (v1.6.3.6-v9)
- [ ] Source tracking (`sourceTabId`, `sourceContext`) visible in storage handler (v1.6.3.6-v9)
- [ ] `_updateQuickTabHostInfo()` updates Map on state changes (v1.6.3.6-v9)
- [ ] `adoptQuickTabToCurrentTab()` reassigns orphans (v1.6.3.6-v9)
- [ ] Multi-layer ID recovery works across CreateHandler, hydration, snapshots (v1.6.3.6-v8)
- [ ] Hydration recovery patches originTabId into entity (v1.6.3.6-v8)
- [ ] Triple ownership check validates Manager restore requests (v1.6.3.6-v8)
- [ ] ID pattern recovery extracts tab ID from Quick Tab ID (v1.6.3.6-v7)
- [ ] Strict tab isolation rejects null originTabId (v1.6.3.6-v5)
- [ ] Message correlation IDs show full trace (v1.6.3.6-v5)
- [ ] Storage circuit breaker trips at `pendingWriteCount >= 15`
- [ ] Per-tab scoping works (`_shouldRenderOnThisTab`)
- [ ] ESLint passes ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Reliable cross-tab sync with v1.6.3.6-v9 structured confirmations, tab switch detection, source tracking, and v1.6.3.6-v8 multi-layer ID recovery.**
