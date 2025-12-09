# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.3.6-v12  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Background-as-Coordinator  
**Purpose:** URL management with Solo/Mute visibility control and sidebar Quick
Tabs Manager

**Key Features:**

- Solo/Mute tab-specific visibility control
- **Global Quick Tab visibility** (Container isolation REMOVED)
- Sidebar Quick Tabs Manager (Ctrl+Alt+Z or Alt+Shift+Z)
- **Port-based messaging** with persistent connections (v1.6.3.6-v11)
- **Cross-tab sync via storage.onChanged + Background-as-Coordinator**
- **Cross-tab isolation via `originTabId`** with strict per-tab scoping
- **Lifecycle resilience** with heartbeat mechanism (v1.6.3.6-v12)

**v1.6.3.6-v12 Lifecycle Resilience (Issues #1-8):**

- #1: Init guard with `checkInitializationGuard()`, `waitForInitialization()`
- #2: Heartbeat - `HEARTBEAT` every 25s, `HEARTBEAT_ACK` response
- #3: Storage dedup - transactionId, saveId+timestamp, content hash
- #4: Port heartbeat timeout (5s)
- #5: Cache reconciliation - `_triggerCacheReconciliation()`
- #6: Deletion acks - `handleDeletionAck()`, `_waitForDeletionAcks()`
- #7: Enhanced logging - state snapshots, broadcast tracking, correlation IDs
- #8: Architectural resilience - coordinator is optimization, not requirement

**v1.6.3.6-v11 Port-Based Messaging (Issues #10-21):**

- Port registry, persistent connections, lifecycle logging, state coordinator
- Storage write verification, message types, tab lifecycle events
- Atomic adoption, visibility broadcasts, count badge animation

**v1.6.3.6-v11 Animation/Logging (Issues #1-9):**

- Animation lifecycle (START→CALC→TRANSITION→COMPLETE), state constants
- CSS-only styling, section header logging, adoption verification (2s timeout)

**v1.6.3.6-v11 Bundle Size Optimization:**

- Tree-shaking: `preset: "smallest"`, `moduleSideEffects: false`, `IS_TEST_MODE`

**v1.6.3.6-v10 Build & Manager UI/UX:** `.buildconfig.json`, Terser, animations

**v1.6.3.6-v8 Fixes:** originTabId init, hydration recovery, cross-tab grouping UI

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

### CRITICAL: Port-Based Messaging + storage.onChanged (v1.6.3.6-v11+)

**v1.6.3.6-v12 Lifecycle Resilience:** Background stays alive via heartbeat (25s). If background dies, content scripts write directly to storage. Coordinator is optimization, not requirement.

**Message Protocol:**

```javascript
{ type: 'ACTION_REQUEST|STATE_UPDATE|ACKNOWLEDGMENT|ERROR|BROADCAST|HEARTBEAT|HEARTBEAT_ACK|DELETION_ACK',
  action, correlationId, source, timestamp, payload, metadata }
```

**Port Registry:** `{ portId -> { port, origin, tabId, type, connectedAt, lastMessageAt } }`

**Message Types:** Legacy: `QUICK_TAB_STATE_CHANGE`, `QUICK_TAB_STATE_UPDATED`, `MANAGER_COMMAND`, `EXECUTE_COMMAND`, `CLEAR_ALL_QUICK_TABS`, `QUICK_TAB_DELETED`. v12: `HEARTBEAT`, `HEARTBEAT_ACK`, `DELETION_ACK`

**Event Flow:** Port connection → Tab writes storage → storage.onChanged fires → Background broadcasts → UICoordinator renders

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

## 🆕 v1.6.3.6-v12 Patterns

**Lifecycle Resilience:** `checkInitializationGuard()`, `waitForInitialization()` with exponential backoff. Return `{ success: false, error: 'NOT_INITIALIZED' }` when uninitialized.

**Heartbeat:** `startHeartbeat()`, `stopHeartbeat()`, `sendHeartbeat()`, `handleHeartbeat()`. Constants: `HEARTBEAT_INTERVAL_MS=25000`, `HEARTBEAT_TIMEOUT_MS=5000`

**Storage Deduplication:** `_multiMethodDeduplication()` checks transactionId → saveId+timestamp → content hash

**Cache Reconciliation:** `_triggerCacheReconciliation()` queries content scripts. If they have tabs, restore to storage; if 0, accept and clear cache.

**Deletion Acks:** `handleDeletionAck()`, `_setupDeletionAckTracking()`, `_waitForDeletionAcks()` - wait for acks from all tabs

## 🆕 v1.6.3.6-v11 Patterns

**Port-Based Messaging:** `browser.runtime.onConnect`, lifecycle logging, correlationId tracking

**Animation Lifecycle:** START→CALC→TRANSITION→COMPLETE, `STATE_OPEN`/`STATE_CLOSED`, CSS-only styling

**Atomic Operations:** Storage write verification, single write for adoption, visibility broadcasts

### Prior Patterns (Retained)

**v10:** Orphan adoption, tab switch detection, smooth animations (0.35s)  
**v8:** ID pattern extraction, multi-layer recovery, cross-tab grouping, tab metadata caching (30s TTL)

### Key Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `HEARTBEAT_INTERVAL_MS` | 25000 | Keep background alive (v12) |
| `HEARTBEAT_TIMEOUT_MS` | 5000 | Heartbeat response timeout (v12) |
| `ADOPTION_VERIFICATION_TIMEOUT_MS` | 2000 | Adoption verification |
| `STORAGE_TIMEOUT_MS` | 2000 | Storage operation timeout |
| `CIRCUIT_BREAKER_THRESHOLD` | 15 | Block ALL writes threshold |
| `TAB_INFO_CACHE_TTL_MS` | 30000 | Tab metadata cache TTL |

---

## Architecture Classes (Key Methods)

| Class | Methods |
|-------|---------|
| QuickTabStateMachine | `canTransition()`, `transition()` |
| QuickTabMediator | `minimize()`, `restore()`, `destroy()` |
| MapTransactionManager | `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()` |
| UICoordinator | `setHandlers()`, `clearAll()`, `_shouldRenderOnThisTab()` |
| DestroyHandler | `_closeAllInProgress`, `_destroyedIds`, `initiateDestruction()` |
| PortRegistry (v11) | Port tracking, cleanup on tab close |
| HeartbeatManager (v12) | `startHeartbeat()`, `stopHeartbeat()`, `handleHeartbeat()` |
| DeletionAckTracker (v12) | `handleDeletionAck()`, `_waitForDeletionAcks()` |

---

## 🔧 Storage Utilities

**Key Exports:** `STATE_KEY`, `WRITING_INSTANCE_ID`, `logStorageRead()`, `logStorageWrite()`, `canCurrentTabModifyQuickTab()`, `validateOwnershipForWrite()`, `isSelfWrite()`, `persistStateToStorage()`, `queueStorageWrite()`

**CRITICAL:** Use `storage.local` for Quick Tab state, NOT `storage.sync`.

---

## 🏗️ Key Patterns

Promise sequencing, debounced drag, orphan recovery, per-tab scoping, transaction rollback, state machine, ownership validation, Single Writer Model, coordinated clear, closeAll mutex.
- **v12:** Lifecycle resilience, heartbeat, storage dedup, cache reconciliation, deletion acks
- **v11:** Port-based messaging, animation lifecycle, atomic adoption
- **v10:** Orphan adoption, tab switch detection
- **v8:** Multi-layer ID recovery, cross-tab grouping UI

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
| `background.js` | Port registry, heartbeat handler (v12), init guard, deduplication |
| `quick-tabs-manager.js` | Port connection, heartbeat (v12), animation lifecycle |
| `src/content.js` | Manager action handling |
| `src/utils/storage-utils.js` | Storage operation logging |

### Storage

**State Key:** `quick_tabs_state_v2` (storage.local)  
**Format:** `{ tabs: [...], saveId, timestamp, writingTabId, writingInstanceId }`

### Messages (v11+)

**Protocol:** `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`, `BROADCAST`, `HEARTBEAT` (v12), `HEARTBEAT_ACK` (v12), `DELETION_ACK` (v12)

---

**Security Note:** This extension handles user data. Security and privacy are
paramount.
