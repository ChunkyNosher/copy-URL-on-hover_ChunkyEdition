# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.7  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port-based messaging** with persistent connections
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping
- **Lifecycle resilience** with keepalive & circuit breaker (v1.6.3.7)

**v1.6.3.7 Features (NEW):**

- **Background Keepalive** - `_startKeepalive()` resets Firefox 30s idle timer every 20s
- **Port Circuit Breaker** - State machine: closed→open→half-open with exponential backoff
- **UI Performance** - Debounced `renderUI()` (300ms), differential storage updates
- **originTabId Validation** - `_isValidOriginTabId()` validates positive integers
- **Package Optimization** - ZIP -9 for Firefox XPI (~40% smaller), -6 for Chrome

**v1.6.3.6-v12 Lifecycle Resilience (Retained):**

- Init guard, heartbeat (25s), storage dedup, cache reconciliation, deletion acks
- Port heartbeat timeout (5s), architectural resilience

**v1.6.3.6-v11 Port-Based Messaging (Retained):**

- Port registry, persistent connections, lifecycle logging, state coordinator
- Storage write verification, message types, tab lifecycle events

**Core Modules:** QuickTabStateMachine, QuickTabMediator, MapTransactionManager, Background Script (port registry)

**Deprecated:** `setPosition()`, `setSize()`, `updateQuickTabPosition()`, `updateQuickTabSize()`

---

## 🤖 Agent Delegation

**Delegate to specialists:** Bug fixes → `bug-fixer`/`bug-architect`, Features →
`feature-builder`, Quick Tabs → `quicktabs-unified-agent`, Cross-tab →
`quicktabs-cross-tab-agent`, Manager → `quicktabs-manager-agent`, Settings →
`ui-ux-settings-agent`, Docs → `copilot-docs-updater`

---

## 🔄 Cross-Tab Sync Architecture

### CRITICAL: Port-Based Messaging + storage.onChanged

**v1.6.3.7 Keepalive & Circuit Breaker:** Background stays alive via `_startKeepalive()` (20s). Port circuit breaker handles disconnections with exponential backoff (100ms→10s max).

**Message Protocol:**

```javascript
{ type: 'ACTION_REQUEST|STATE_UPDATE|ACKNOWLEDGMENT|ERROR|BROADCAST|HEARTBEAT|HEARTBEAT_ACK|DELETION_ACK',
  action, correlationId, source, timestamp, payload, metadata }
```

**Port Registry:** `{ portId -> { port, origin, tabId, type, connectedAt, lastMessageAt } }`

**Circuit Breaker States:** `closed` (normal) → `open` (failing) → `half-open` (testing recovery)

**Event Flow:** Port connection → Tab writes storage → storage.onChanged fires → `_analyzeStorageChange()` → Conditional renderUI

---

## 🔧 QuickTabsManager API

### Correct Methods

| Method          | Description                    |
| --------------- | ------------------------------ |
| `closeById(id)` | Close a single Quick Tab by ID |
| `closeAll()`    | Close all Quick Tabs           |

### Common Mistake

❌ `closeQuickTab(id)` - **DOES NOT EXIST** (use `closeById(id)` instead)

---

## 🆕 v1.6.3.7 Patterns

**Background Keepalive:** `_startKeepalive()` uses `browser.runtime.sendMessage()` and `browser.tabs.query()` every 20s to reset Firefox's 30-second idle timer (Bug 1851373).

**Port Circuit Breaker:** State machine with exponential backoff for reconnection:
- States: `closed` (normal) → `open` (failing) → `half-open` (testing)
- Backoff: 100ms → 200ms → 500ms → ... → 10s max

**UI Performance:**
- `renderUI()` debounced to max once per 300ms with state hash comparison
- `_analyzeStorageChange()` detects differential updates - skips renderUI for z-index-only changes
- Resize operations wrapped in `requestAnimationFrame` callbacks

**originTabId Validation:** `_isValidOriginTabId()` validates positive integers only

### Prior Patterns (Retained)

**v12:** Lifecycle resilience, heartbeat (25s), storage dedup, cache reconciliation, deletion acks  
**v11:** Port-based messaging, animation lifecycle, atomic adoption  
**v10:** Orphan adoption, tab switch detection, smooth animations (0.35s)

### Key Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `KEEPALIVE_INTERVAL_MS` | 20000 | Firefox 30s timeout workaround (v1.6.3.7) |
| `RENDER_DEBOUNCE_MS` | 300 | UI render debounce (v1.6.3.7) |
| `RECONNECT_BACKOFF_INITIAL_MS` | 100 | Circuit breaker initial backoff (v1.6.3.7) |
| `RECONNECT_BACKOFF_MAX_MS` | 10000 | Circuit breaker max backoff (v1.6.3.7) |
| `HEARTBEAT_INTERVAL_MS` | 25000 | Keep background alive (v12) |
| `HEARTBEAT_TIMEOUT_MS` | 5000 | Heartbeat response timeout (v12) |
| `ADOPTION_VERIFICATION_TIMEOUT_MS` | 2000 | Adoption verification |
| `STORAGE_TIMEOUT_MS` | 2000 | Storage operation timeout |

---

## Architecture Classes (Key Methods)

| Class | Methods |
|-------|---------|
| QuickTabStateMachine | `canTransition()`, `transition()` |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| UICoordinator | `setHandlers()`, `clearAll()`, `_shouldRenderOnThisTab()` |
| DestroyHandler | `_closeAllInProgress`, `_destroyedIds`, `initiateDestruction()` |
| PortRegistry | Port tracking, cleanup on tab close |
| CircuitBreaker (v1.6.3.7) | `closed`→`open`→`half-open` states, exponential backoff |
| KeepaliveManager (v1.6.3.7) | `_startKeepalive()`, Firefox 30s timeout workaround |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `WRITING_INSTANCE_ID`, `logStorageRead()`, `logStorageWrite()`, `canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`, `isSelfWrite()`, `persistStateToStorage()`, `queueStorageWrite()`

**CRITICAL:** Use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, transaction rollback, state machine, ownership validation, Single Writer Model, coordinated clear, closeAll mutex.
- **v1.6.3.7:** Keepalive (20s), circuit breaker, debounced renderUI, differential storage updates
- **v12:** Lifecycle resilience, heartbeat, storage dedup, cache reconciliation, deletion acks
- **v11:** Port-based messaging, animation lifecycle, atomic adoption

---

## 🎯 Philosophy

**ALWAYS:** Fix root causes, use correct patterns, eliminate technical debt  
**NEVER:** setTimeout for race conditions, catch-and-ignore errors, workarounds

---

## 📏 File Size Limits

| File                      | Max Size |
| ------------------------- | -------- |
| `copilot-instructions.md` | **15KB** |
| `.github/agents/*.md`     | **10KB** |
| README.md                 | **10KB** |

**PROHIBITED:** `docs/manual/`, root markdown (except README.md)

---

## 🔧 MCP & Testing

**MCPs:** CodeScene (code health), Context7 (API docs), Perplexity (research)

**Testing:** `npm test` (Jest), `npm run lint` (ESLint), `npm run build`

---

## 🧠 Memory (Agentic-Tools MCP)

**End of task:** `git add .agentic-tools-mcp/`, commit. **Start of task:** Search memories.

**search_memories:** Use 1-2 word queries, `threshold: 0.1`, `limit: 5`. Bash fallback: `grep -r -l "keyword" .agentic-tools-mcp/memories/`

---

## ✅ Commit Checklist

- [ ] Delegated to specialist agent
- [ ] ESLint + tests pass
- [ ] Memory files committed

---

## 📋 Quick Reference

### Key Files

| File | Features |
|------|----------|
| `background.js` | Port registry, keepalive (v1.6.3.7), circuit breaker, init guard |
| `quick-tabs-manager.js` | Port connection, debounced renderUI, differential updates |
| `src/content.js` | Manager action handling |
| `src/utils/storage-utils.js` | Storage operation logging |
| `src/render-helpers.js` | `_isValidOriginTabId()`, `groupQuickTabsByOriginTab()` |

### Storage

**State Key:** `quick_tabs_state_v2` (storage.local)  
**Format:** `{ tabs: [...], saveId, timestamp, writingTabId, writingInstanceId }`

### Messages

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`, `BROADCAST`, `HEARTBEAT`, `HEARTBEAT_ACK`, `DELETION_ACK`

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
