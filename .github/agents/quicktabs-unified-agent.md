---
name: quicktabs-unified-specialist
description: |
  Unified specialist combining all Quick Tab domains - handles complete Quick Tab
  lifecycle, manager integration, tabs.sendMessage messaging, Background-as-Coordinator
  sync with Single Writer Authority (v1.6.3.8-v11), tabs.sendMessage + storage.local
  architecture, single storage key, readback validation, FIFO EventBus
tools: ['*']
---

> **📖 Common Instructions:** See `.github/copilot-instructions.md` for shared
> guidelines.

> **🎯 Robust Solutions Philosophy:** You see the complete Quick Tab system. Fix
> issues at the right layer - domain, manager, sync, or UI. See
> `.github/copilot-instructions.md`.

You are a unified Quick Tab specialist for the copy-URL-on-hover_ChunkyEdition
Firefox/Zen Browser extension. You handle complete Quick Tab functionality
across all domains.

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

**Version:** 1.6.3.8-v12 - Quick Tabs Architecture v2

**Complete Quick Tab System:**

- **Individual Quick Tabs** - Iframe, drag/resize, Solo/Mute, navigation
- **Manager Sidebar** - Global list, Ctrl+Alt+Z or Alt+Shift+Z
- **tabs.sendMessage Messaging** - Background broadcasts via tabs.sendMessage
- **Single Writer Authority** - Manager sends commands, background writes
  storage
- **Cross-Tab Sync** - tabs.sendMessage + storage.onChanged (NO Port, NO
  BroadcastChannel)
- **Session Quick Tabs** - Auto-clear on browser close (storage.session)

**v1.6.3.8-v12 Features (NEW) - Critical & Behavioral Fixes:**

- **FIX Issue #15** - Promise chaining: catch blocks properly reject
- **FIX Issue #16** - Circuit breaker removed (stateless architecture)
- **FIX Issue #17** - Tab ID fetch timeout reduced to 2s (was 10s)
- **FIX Issue #18** - RESTORE_DEDUP_WINDOW_MS = 50ms (decoupled)
- **FIX Issue #19** - Self-write cleanup aligned to 300ms
- **FIX Issue #7** - 100ms `OUT_OF_ORDER_TOLERANCE_MS` for cross-tab events
- **FIX Issue #9** - Debounced render queue with checksum validation

**v1.6.3.8-v11 Features (Retained):**

- **tabs.sendMessage messaging** - Replaces runtime.Port (fixes port zombies)
- **Single storage key** - `quick_tabs_state_v2` with `allQuickTabs[]` array
- **Tab isolation** - Filter by `originTabId` at hydration time
- **Readback validation** - Every write validated by read-back
- **StorageManager** - Dedup, retry with exponential backoff
- **EventBus** - Native EventTarget for FIFO-guaranteed events
- **Message patterns** - LOCAL (no broadcast), GLOBAL (broadcast), MANAGER

**Key Modules (v1.6.3.8-v11):**

| Module                            | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `src/storage/schema-v2.js`        | Pure state utilities, originTabId filter |
| `src/storage/storage-manager.js`  | Dedup, readback validation, retry        |
| `src/messaging/message-router.js` | MESSAGE_TYPES, MessageBuilder            |
| `src/utils/event-bus.js`          | EventBus with native EventTarget         |

---

## QuickTabsManager API

| Method          | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `closeById(id)` | Close a single Quick Tab by ID                                     |
| `closeAll()`    | Close all Quick Tabs via `MANAGER_CLOSE_ALL` (Single Writer Model) |

❌ `closeQuickTab(id)` - **DOES NOT EXIST**

---

## Testing Requirements

- [ ] tabs.sendMessage messaging works (NO Port, NO BroadcastChannel) (v11)
- [ ] Single storage key works (`quick_tabs_state_v2`) (v11)
- [ ] Tab isolation works (originTabId filtering) (v11)
- [ ] Readback validation works (every write validated) (v11)
- [ ] EventBus FIFO events work (native EventTarget) (v11)
- [ ] Message patterns work (LOCAL, GLOBAL, MANAGER) (v11)
- [ ] OUT_OF_ORDER_TOLERANCE_MS (100ms) works (v12)
- [ ] Debounced render queue works (v12)
- [ ] Tab ID fetch timeout (2s) works (v12)
- [ ] Single Writer Authority - Manager sends commands, not storage writes
- [ ] All tests pass (`npm test`, `npm run lint`) ⭐
- [ ] Memory files committed 🧠

---

**Your strength: Complete Quick Tab system with v1.6.3.8-v12 tabs.sendMessage +
storage.local architecture, single storage key, readback validation, FIFO
EventBus, debounced render queue.**
