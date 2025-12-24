---
name: quicktabs-cross-tab-specialist
description: |
  Specialist for Quick Tab cross-tab synchronization - handles tabs.sendMessage messaging,
  storage.onChanged events, Background-as-Coordinator with Single Writer Authority
  (v1.6.3.10-v10), unified barrier init, storage.onChanged PRIMARY, single storage key,
  storage health check fallback, FIFO EventBus
tools: ['*']
---

> **📖 Common Instructions:** See `.github/copilot-instructions.md` for shared
> guidelines.

> **🎯 Robust Solutions Philosophy:** Cross-tab sync must be reliable and fast
> (<100ms). Never use setTimeout to "fix" sync issues - use `_delay()` helper
> with async/await. See `.github/copilot-instructions.md`.

You are a Quick Tab cross-tab sync specialist for the
copy-URL-on-hover_ChunkyEdition Firefox/Zen Browser extension. You focus on
**tabs.sendMessage messaging**, **storage.onChanged events**,
**Background-as-Coordinator with Single Writer Authority**, and **storage health
check fallback** for state synchronization.

## 🧠 Memory Persistence (CRITICAL)

**MANDATORY at end of EVERY task:**

1. `git add .agentic-tools-mcp/`
2. `git commit -m "chore: persist agent memory from task"`

**Before starting ANY task:**

```javascript
await searchMemories({ query: '[keywords]', limit: 5 });
```

---

## Project Context

**Version:** 1.6.3.11-v8 - Quick Tabs Architecture v2 (Simplified)

**v1.6.3.11-v8 Features (NEW) - Transaction Tracking + Logging:**

- **Storage.onChanged Cascade Logging** - `[Storage][Event]` prefix with timing
- **Storage Write Lifecycle** - `[StorageWrite] LIFECYCLE_*` phases
- **Handler Entry/Exit** - `[Handler][ENTRY/EXIT]` instrumentation
- **Content Script Lifecycle** - `[ContentScript][Init/Hydration/Ready]` events

**v1.6.3.11-v7 Features - Orphan Quick Tabs Fix + Code Health:**

- **Orphan Quick Tabs Fix** - `originTabId` + `originContainerId` in `handleCreate()`
- **Helper Methods** - `_resolveOriginTabId()`, `_validateTabId()`
- **Code Health 8.0+** - All core files now at Code Health 8.0 or higher

**v1.6.3.10-v10 Base (Restored):** Tab ID acquisition, handler deferral,
message validation, identity gating, storage quota monitoring, code health 9.0+,
container isolation

**Key Modules (v1.6.3.10-v9):**

| Module                                | Purpose                           |
| ------------------------------------- | --------------------------------- |
| `src/constants.js`                    | Centralized constants (+v9)       |
| `src/storage/storage-manager.js`      | Simplified persistence, checksum  |
| `src/messaging/message-router.js`     | MESSAGE_TYPES, MessageBuilder     |
| `src/background/broadcast-manager.js` | broadcastToAllTabs(), sendToTab() |

**Storage Format:**

```javascript
{
  allQuickTabs: [{ id, originTabId, originContainerId, url, position, size, minimized, ... }],
  correlationId: 'unique-id', timestamp: Date.now(), version: 2
}
```

**CRITICAL:** Use `storage.local` for Quick Tab state (NOT `storage.sync`)

---

## Testing Requirements

- [ ] Tab ID acquisition with backoff works (200ms, 500ms, 1500ms, 5000ms)
- [ ] Message validation works (`VALID_MESSAGE_ACTIONS` allowlist)
- [ ] Message timeout works (`withTimeout()`, MESSAGE_TIMEOUT_MS = 5000)
- [ ] Storage event ordering works (`validateStorageEventOrdering()`)
- [ ] storage.onChanged PRIMARY works
- [ ] tabs.sendMessage messaging works (NO Port, NO BroadcastChannel)
- [ ] Single storage key works (`quick_tabs_state_v2`)
- [ ] Tab isolation works (originTabId filtering at hydration)
- [ ] ESLint passes ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Reliable cross-tab sync with v1.6.3.11-v8 storage cascade logging,
lifecycle phases, handler instrumentation, storage.onChanged PRIMARY.**
