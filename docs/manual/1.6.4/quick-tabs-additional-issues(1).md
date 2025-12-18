# Quick Tabs: Storage, Adoption & Message Lifecycle Issues

**Extension Version:** v1.6.3.10+ | **Date:** 2025-12-17 | **Scope:** Storage event de-duplication, message queueing, adoption safety, and memory leaks in Quick Tab lifecycle

---

## Executive Summary

Beyond the seven previously documented initialization and port lifecycle issues, the codebase exhibits eight additional systemic vulnerabilities affecting storage event handling, message delivery during disconnection, tab adoption correctness, and long-term memory stability. These issues are distinct from initialization patterns but create correlated failure modes during cross-tab operations, background restarts, and Firefox container switching. Root causes span missing de-duplication layers, unvalidated state transitions, unbounded data structures, and absent message queuing mechanisms. All stem from incomplete lifecycle management rather than architectural flaws.

## Issues Overview

| Issue # | Component | Severity | Root Cause |
|---------|-----------|----------|-----------|
| #8 | content.js | Medium | No storage event de-duplication; simultaneous writes from multiple tabs trigger duplicate handlers |
| #9 | Manager | Medium | `quickTabHostInfo` Map never cleaned; unbounded memory growth as tabs created/destroyed |
| #10 | Manager | Medium | Adoption flow lacks container validation; cross-container adoptions may route to wrong group |
| #11 | content.js | High | No message queue during port disconnection backoff; state-critical messages silently lost |
| #12 | MinimizedManager | Medium | Snapshot expiration timeout races with restore retry loop; orphaned windows or ghost tabs |
| #13 | content.js | Medium | ID pattern extraction races with adoption; stale tabId from pattern causes ownership misrouting |
| #14 | Manager | Medium | Port viability check timeout prevents legitimate message retry; duplicates on reconnect |
| #15 | QuickTabHandler | High | No concurrent write locking for multi-container operations; data loss in simultaneous writes |
| #16 | QuickTabHandler | High | `_ensureInitialized()` checks flag only, not dependencies; returns success before storage loads |

**Why bundled:** All affect message reliability, state consistency, and long-term extension stability. Root causes span missing synchronization primitives, incomplete lifecycle validation, and unguarded concurrent access. Require coordinated fixes to establish robust state management across disconnection, adoption, and multi-container scenarios.

<scope>
**Modify:**
- `src/content.js` - Storage event de-duplication, message queueing during backoff, adoption-aware ownership checks
- `sidebar/quick-tabs-manager.js` - Orphan cleanup for `quickTabHostInfo`, adoption container validation, port message queueing
- `src/features/quick-tabs/minimized-manager.js` - Snapshot TTL race condition handling
- `src/background/handlers/QuickTabHandler.js` - Initialization dependency validation, concurrent write serialization

**Do NOT Modify:**
- `src/background/background.js` - Core handler registration (separate scope)
- Firefox WebExtension API contracts (work within existing API limitations)
- Event bus architecture (use existing messaging pattern)
</scope>

---

## Issue #8: Storage Event De-duplication Missing - Duplicate Handler Execution

### Problem

When multiple tabs write to `storage.local` simultaneously or when background restarts, storage event listeners trigger multiple times in rapid succession (< 100ms windows) without de-duplication. Content script processes identical storage updates 2-3 times before first handler completes, causing duplicate Quick Tab rendering, memory leaks from duplicate event handlers, and stale state if first handler completes partially before second handler starts.

### Root Cause

**File:** `src/content.js`  
**Location:** Storage event listeners (approx. lines 850-920)  
**Issue:** Event listeners registered directly on `storage.onChanged` without tracking recently-processed updates. De-duplication logic in `_isDuplicateRestoreMessage()` only protects RESTORE_QUICK_TAB messages, not general storage updates. When content script reads storage, fires event handler, then storage fires again within 100ms, second handler re-executes the same state mutation.

**Pattern evidence:** Manager's `STORAGE_READ_DEBOUNCE_MS` (100ms) is shorter than background initialization time (200-2000ms), creating windows where duplicate events arrive. Each tab listening to storage fires independently; no cross-tab coordination exists.

### Fix Required

Implement storage event de-duplication layer that tracks recently-processed storage keys with timestamps. When storage event fires, check if same key was processed within last 200ms (configurable debounce window). If duplicate detected within window, skip handler execution and log at DEBUG level. Window should be at least 2x longer than handler execution time (typically 50-100ms for state mutations). For multi-tab updates (e.g., one tab creates Quick Tab while another reads it), allow legitimate updates by using content hash or version number rather than simple timestamp—if storage content has changed, it's a new update, not a duplicate.

---

## Issue #9: Orphan Registry in quickTabHostInfo - Unbounded Memory Growth

### Problem

The `quickTabHostInfo` Map in sidebar/quick-tabs-manager.js tracks which tab hosts each Quick Tab (used for adoption and cross-tab routing). Entries are added/updated during adoption and creation but **never removed** when Quick Tabs are deleted. Map grows unbounded as extension runs, accumulating stale entries for Quick Tabs that no longer exist. After heavy usage (100+ Quick Tabs created/destroyed over weeks), this Map can consume several MB of memory with data from deleted tabs.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Lines 184-186 (map initialization/usage in adoption flow)  
**Issue:** `quickTabHostInfo` updated only in `handleAdoptionCompletion()` and on Quick Tab creation. No cleanup occurs in `handleDelete()`, `closeAll()`, or on periodic maintenance. No TTL or maximum size enforcement. Map has no expiration strategy.

### Fix Required

Implement cleanup mechanism that removes orphaned entries from `quickTabHostInfo` when corresponding Quick Tab is deleted. Hook into Quick Tab deletion flow (both `handleDelete()` for single deletion and `closeAll()` for batch deletion) to remove entry from map. Add periodic maintenance task (e.g., on extension idle, every 5 minutes) that validates map entries still correspond to existing Quick Tabs and prunes stale entries. Add maximum size guard: if map exceeds 500 entries, trigger aggressive pruning of entries older than 10 minutes. Log cleanup operations at DEBUG level including number of entries removed.

---

## Issue #10: Adoption Flow Lacks Firefox Container Validation

### Problem

When Quick Tab is adopted between tabs, adoption logic updates `quickTabHostInfo` and attempts to re-render in new owner tab's context. However, if adoption occurs **across different Firefox containers** (Multi-Account Containers extension), the adopted Quick Tab may be routed to wrong container's Quick Tabs group. No validation exists that `newOriginTabId` and `adoptedQuickTabId` are in same container. Manager UI could display Quick Tab in wrong container or fail silently if container IDs diverge.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `handleAdoptionCompletion()` (approx. lines 1410-1480)  
**Issue:** Adoption flow captures `savedOriginContainerId` in minimized snapshot but never compares it against new owner's container. When adoption completes, code assumes new owner is in same container without validation. Container ID stored in `quickTabHostInfo` but not checked during adoption routing logic.

**Firefox API:** `browser.tabs.get()` returns `cookieStoreId` indicating container (e.g., "firefox-default", "firefox-container-1"). Adoption should validate both old and new owner tabs are in same container before proceeding.

### Fix Required

Add explicit container validation during adoption. Before routing adopted Quick Tab to new owner tab, retrieve both old owner's and new owner's container IDs (via `browser.tabs.get()` returning `cookieStoreId`). Compare against stored `savedOriginContainerId`. If containers diverge, either: (1) log WARNING and abort adoption, routing Quick Tab back to original container group, or (2) if supporting cross-container adoption, validate new container exists and is accessible. Update `quickTabHostInfo` entry to include container ID alongside origin tab ID to enable container-aware lookups in future cross-tab operations.

---

## Issue #11: Port Message Queueing Missing During Backoff - Silent Message Loss

### Problem

During port reconnection with exponential backoff (150ms-8s), content script may send state-critical messages (minimize/restore) while `backgroundPort === null`. Messages sent during backoff window are **lost permanently**—no queue exists, no retry mechanism fires, no error callback alerts user. User minimizes Quick Tab, backoff triggers, message lost, UI shows minimized state but background never received minimize request, leading to state divergence.

### Root Cause

**File:** `src/content.js`  
**Location:** `connectContentToBackground()` (lines 695-750), `handleContentPortMessage()`, and all port.postMessage calls  
**Issue:** When `onDisconnect` fires and port becomes null, code sets reconnection timeout but provides no message queue. Synchronous code paths (e.g., minimize button click) call `backgroundPort.postMessage()` immediately, which fails silently if `backgroundPort === null`. No guard checks if port is connected before sending. No queue accumulates messages for retry on reconnect.

### Fix Required

Implement message queue that buffers outgoing messages when port is disconnected or in CONNECTING state. Create internal queue structure (array or Map by messageId) that stores messages with retry count and timestamp. When application code calls port.postMessage, first check if port is connected; if not, buffer message instead. On successful reconnect, drain queue by re-sending buffered messages in order with sequence IDs intact. Add maximum queue size guard (suggest 50 messages) to prevent unbounded memory growth. For critical messages (minimize/restore), implement acknowledgment tracking so sender knows if message was lost vs. successfully processed. Log queue state changes at INFO level.

---

## Issue #12: Snapshot Expiration Races with Restore Retry Loop

### Problem

Minimize snapshot expiration timeout (`PENDING_SNAPSHOT_EXPIRATION_MS = 1000ms` in minimized-manager.js) can fire **while restore retry logic is still attempting to restore the same Quick Tab**. If restore fails and caller retries after 900ms, snapshot expires during the retry, leaving state machine in inconsistent position where: (1) restoration logic thinks snapshot still exists and valid, (2) snapshot already garbage-collected, (3) retry handler operates on stale snapshot data. Result: orphaned Quick Tab windows stuck on-screen or disappearing mid-animation.

### Root Cause

**File:** `src/features/quick-tabs/minimized-manager.js`  
**Location:** Lines 102-131 (snapshot expiration and restore)  
**Issue:** Restore operation moves snapshot to `pendingClearSnapshots` with single timeout. No coordination between restore retry loop (which may retry on handler failure) and expiration timeout. If first restore fails asynchronously and caller retries, both pending restore and expiration timeout exist, creating race where expiration can win and delete snapshot before retry completes.

### Fix Required

Implement snapshot lifecycle guard that prevents expiration while restore is in progress. When snapshot enters `pendingClearSnapshots`, create expiration timeout but attach it to snapshot object for cancellation. If restore is retried before timeout fires, cancel existing timeout and set new one from retry completion time. Alternatively, move snapshot to non-expiring state during retry window, only resuming expiration countdown after retry completes or max retries exceeded. Add state field to snapshot indicating `isRestoring` (boolean) and check this before allowing expiration. If expiration fires while `isRestoring === true`, defer expiration until restore completes. Log snapshot lifecycle transitions including retry attempts and timeout resets at DEBUG level.

---

## Issue #13: ID Pattern Extraction Race with Adoption - Stale TabId Misrouting

### Problem

Restore ownership validation uses fallback ID pattern extraction (`_extractTabIdFromQuickTabId()`) that can return **stale** tabId when Quick Tab was recently adopted. After adoption completes in Tab B, a restore request arrives in Tab A (intended for different Quick Tab, wrong ID). Pattern extraction returns old Tab A ID from pattern. Ownership check finds pattern match and routes restore to Tab A, even though Quick Tab now belongs to Tab B. Result: ghost Quick Tab appears in wrong tab or wrong container.

### Root Cause

**File:** `src/content.js`  
**Location:** `_getRestoreOwnership()` (lines 2775-2800) and `_extractTabIdFromQuickTabId()` (lines 2765-2775)  
**Issue:** Ownership validation occurs **asynchronously** after adoption broadcast processed. Quick Tab ID pattern `qt-{tabId}-{timestamp}-{random}` is immutable; adoption updates `originTabId` in cache but not ID pattern. If restore request arrives immediately after adoption, pattern extraction returns old tabId, cache shows new owner, but ownership decision prioritizes pattern match over cache mismatch, routing to stale owner.

**Race window:** Adoption completes at T=100ms, updates cache with new `originTabId`. Restore request arrives at T=105ms. Pattern extraction returns old tabId. Ownership check compares old tabId against new owner → false match, but pattern still takes priority in fallback logic.

### Fix Required

Add adoption-aware ownership validation that deprioritizes ID pattern matches when pattern and cached ownership diverge. After ADOPTION_COMPLETED broadcast is processed, explicitly track adopted Quick Tab IDs in a "recently adopted" set with 5-second TTL. When validating ownership in `_getRestoreOwnership()`, check if Quick Tab ID is in recently-adopted set. If yes, use cache ownership instead of pattern extraction. If no, follow normal priority (cache lookup → pattern extraction). Log WARNING when pattern and cache ownership diverge, including old tabId from pattern and current owner from cache. Clear recently-adopted set on periodic maintenance (every 30 seconds) to prevent memory leak.

---

## Issue #14: Port Viability Check Timeout Prevents Legitimate Retry - Duplicate Messages on Reconnect

### Problem

Before critical operations (minimize/restore/close), manager calls `verifyPortViability()` which sends heartbeat expecting response within `PORT_MESSAGE_TIMEOUT_MS` (500ms). If background latency exceeds 500ms (common on slow devices), timeout fires, port marked as zombie, forced reconnect triggered, but original message still in pending queue. On reconnect, both heartbeat message and original operation message re-send, potentially executing twice. User minimize request sends heartbeat, background slow to respond, timeout triggers, port reset, minimize message re-sent on reconnect, Quick Tab minimized twice (creating invalid state).

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `verifyPortViability()` (approx. lines 835-860)  
**Issue:** Viability check is too aggressive; 500ms timeout insufficient for slow devices or under browser memory pressure. When timeout fires, code immediately reconnects port without differentiating between connection failure vs. slow response. Original message not cleared from pending queue, so reconnect re-sends duplicate message.

### Fix Required

Implement adaptive timeout for port viability checks that adjusts based on observed background latency. Track successful heartbeat response times and calculate 95th percentile latency. Set timeout to max(700ms, 2x observed latency), not fixed 500ms. Before forcing reconnect on timeout, first check if port is still connected but just slow—don't disconnect valid but latent connection. Add message deduplication at operation level: if operation is already in pending queue waiting for response, don't re-send on reconnect, wait for original response. For critical operations, implement idempotency key so duplicate sends are safe even if both execute. Log viability check results (pass/fail/timeout) with latency measurements at DEBUG level.

---

## Issue #15: Background Storage Write Serialization Missing - Data Loss in Multi-Container

### Problem

Multiple Firefox containers can trigger simultaneous `storage.local` writes from background handlers. When Tab 1 (container A) creates Quick Tab while Tab 2 (container B) closes Quick Tab simultaneously, both handlers call `saveStateToStorage()` without locking. Both read `globalState.tabs` array, modify it, write it back. Last write wins, earlier write lost. Quick Tab created in container A never persists, or Quick Tab deleted in container B still appears.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js`  
**Location:** `saveStateToStorage()` (approx. lines 1765-1800)  
**Issue:** No write serialization mechanism exists. Multiple handlers can execute concurrently (background script runs all handlers in parallel). Storage writes are not atomic transactions. Pattern: (1) read globalState, (2) modify array, (3) write to storage. If two handlers interleave at step 1, both read old state, both modify based on old state, one write overwrites the other.

**Comparison:** Content script uses `storage-utils.js` with sourceId tracking to validate ownership, but background storage writes have no equivalent transaction layer.

### Fix Required

Implement write serialization for background storage operations. Create async lock/queue mechanism that ensures only one handler modifies `globalState.tabs` and writes to storage at a time. Before calling `saveStateToStorage()`, acquire lock; hold lock until write completes and acknowledgment received from storage. If multiple handlers attempt concurrent writes, queue them and process sequentially. Add write version tracking: each successful write increments version number, stored alongside data. On read, compare stored version against expected version; if mismatch detected (indicating concurrent write occurred), log ERROR and trigger full state rebuild from all sources of truth (browser tabs API, minimized snapshots, etc.). For critical operations (create/delete), implement optimistic locking with retry: if write detects version mismatch, retry operation with fresh state read.

---

## Issue #16: Initialization Guard Checks Flag Only - No Dependency Validation

### Problem

`_ensureInitialized()` in QuickTabHandler validates only the `isInitialized` boolean flag. Flag is set to `true` before asynchronous dependencies actually complete (storage.local read, event bus registration, browser APIs). Content scripts receive SUCCESS response and immediately attempt operations that depend on storage data, but data still loading. Handlers return null/undefined responses or operate on empty state because underlying dependencies not ready.

### Root Cause

**File:** `src/background/handlers/QuickTabHandler.js`  
**Location:** `_ensureInitialized()` (approx. lines 370-385)  
**Issue:** Initialization logic (in background.js, called during handler constructor) sets flag to true as final step, before async tasks complete. Dependency chain not validated: (1) storage.local read must complete, (2) globalState.tabs must be populated, (3) event bus handlers registered, (4) broadcaster initialized. Current code only checks boolean, skipping intermediate states where flag is true but dependencies not ready.

**Pattern:** Flag set at line N, but storage read may still pending at line N+5. Content script receives SUCCESS based on flag, but globalState.tabs still empty when handler tries to access it.

### Fix Required

Enhance `_ensureInitialized()` to validate entire dependency chain, not just flag. Create dependency object that tracks completion state of each initialization phase: `{ storageReady: false, eventBusReady: false, broadcasterReady: false, allDependenciesReady: false }`. Before setting `isInitialized = true`, wait for all dependencies to complete. When calling `_ensureInitialized()`, check dependency object; if any dependency is false, wait for promised completion and log which dependency is blocking. Return error response if any dependency fails rather than continuing with incomplete initialization. Add diagnostics logging showing which dependencies are blocking and how long the wait is. Log initialization completion as `[InitBoundary] QuickTabHandler all_dependencies_ready 1250ms storage.local+eventBus+broadcaster` with duration for diagnostic purposes.

---

## Shared Implementation Patterns

**Storage Event De-duplication:** All storage listeners must track processed keys with timestamps. Implement debounce window (2x handler execution time, typically 200ms). For content script, reuse existing `_isDuplicateRestoreMessage()` pattern but generalize it.

**Message Queueing:** During port disconnection, maintain queue with messageId, timestamp, and retry count. Queue max size 50. On reconnect, drain queue preserving order. Add sequence IDs for ordering validation.

**Lifecycle Validation:** Track state machine explicitly (CONNECTING/CONNECTED/FAILED for port; INITIALIZING/READY/DEGRADED for background). Log all state transitions. Never allow state progression until dependencies validated.

**Container Safety:** Always retrieve container ID from `browser.tabs.get()` when adopting or routing cross-container. Validate container IDs match before proceeding with adoption. Store container ID in `quickTabHostInfo` alongside origin tab ID.

**Concurrent Write Safety:** Implement async lock (using Promise-based queue) for critical storage mutations. Before modifying globalState, acquire lock. Add version number tracking to detect concurrent writes. Retry with exponential backoff (max 3 attempts) if version conflict detected.

<acceptance_criteria>
**Issue #8: Storage Event De-duplication**
- [ ] Storage event listener de-duplication tracks recently-processed keys with 200ms+ window
- [ ] Duplicate storage events within window are skipped with DEBUG log
- [ ] Non-duplicate events with changed content pass through immediately
- [ ] De-duplication window configurable and scales with handler execution time
- [ ] Manual test: rapid multi-tab writes → single handler execution per unique key per window

**Issue #9: Orphan Cleanup**
- [ ] `quickTabHostInfo` entries removed when corresponding Quick Tab deleted
- [ ] Cleanup triggered in both `handleDelete()` and `closeAll()` paths
- [ ] Periodic maintenance validates map entries every 5 minutes
- [ ] Max size guard enforces 500-entry limit, prunes older entries if exceeded
- [ ] Manual test: create/destroy 200 Quick Tabs over time → map size stays under 100 entries

**Issue #10: Container Validation**
- [ ] Adoption flow validates old and new owner containers match
- [ ] Container IDs retrieved from `browser.tabs.get(cookieStoreId)` before adoption
- [ ] If containers diverge, adoption aborted with WARNING log
- [ ] Manual test: attempt cross-container adoption → adoption rejected or safely handled

**Issue #11: Message Queueing**
- [ ] Messages queued when port disconnected/CONNECTING
- [ ] Queue max size 50; messages dropped if exceeded (with ERROR log)
- [ ] Queue drained on reconnect in send order with sequence IDs preserved
- [ ] Acknowledgment tracking confirms message delivery to background
- [ ] Manual test: minimize Quick Tab → trigger port disconnect → restore port → verify minimize was delivered

**Issue #12: Snapshot TTL Race**
- [ ] Snapshot expiration timeout cancelled during restore retry
- [ ] New timeout set from retry completion, not from original creation
- [ ] Snapshot marked with `isRestoring` flag during retry
- [ ] Expiration deferred while `isRestoring === true`
- [ ] Manual test: restore fails → retry within 900ms window → verify snapshot not expired mid-retry

**Issue #13: Adoption-Aware Ownership**
- [ ] Recently-adopted Quick Tab IDs tracked in set with 5s TTL
- [ ] Pattern extraction deprioritized if ID in recently-adopted set
- [ ] WARNING logged when pattern and cache ownership diverge
- [ ] Ownership decision uses cache for recently-adopted tabs
- [ ] Manual test: adopt Quick Tab between tabs → restore → verify ownership detected correctly

**Issue #14: Port Viability Adaptive Timeout**
- [ ] Port timeout calculated as max(700ms, 2x observed latency)
- [ ] Heartbeat latency tracked and 95th percentile computed
- [ ] Timeout fires only if port actually disconnected, not just slow
- [ ] Pending messages not re-sent on reconnect (de-duplicated)
- [ ] Manual test: slow background (1s latency) → verify viability check doesn't timeout

**Issue #15: Concurrent Write Locking**
- [ ] Async lock/queue serializes storage writes
- [ ] Multiple concurrent write attempts queued and executed sequentially
- [ ] Write version number tracked and compared on read
- [ ] Version mismatch triggers full state rebuild
- [ ] Manual test: simultaneous create in container A + delete in container B → verify no data loss

**Issue #16: Dependency Validation**
- [ ] `_ensureInitialized()` validates all dependencies, not just flag
- [ ] Dependencies object tracks storage, eventBus, broadcaster, etc.
- [ ] Returns error if any dependency not ready
- [ ] Logs which dependency blocking and wait duration
- [ ] `[InitBoundary]` log emitted on completion with all dependencies ready
- [ ] Manual test: send GET_CURRENT_TAB_ID during initialization → handler waits for all deps → returns valid response

**All Issues:**
- [ ] All existing tests pass; no regressions
- [ ] No new console errors at INFO level
- [ ] Startup time under 3s on reference device
- [ ] Memory usage stable after 1000+ Quick Tab create/destroy cycles
- [ ] Comprehensive test: concurrent multi-container operations + port disconnection + rapid adoption → state consistent, no data loss
</acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #8: Storage Event Evidence</summary>
Content script storage listener fires on every write from any source. When Tab A creates Quick Tab → storage fires → Tab B listening sees same event → both process. When background writes → all content tabs see it. Without de-duplication, event handler may execute 3-5x for same state change, multiplying mutations and memory allocation.

Current code: `browser.storage.onChanged.addListener(handleStorageChanged)` with no tracking of what was already processed. Contrast with `_isDuplicateRestoreMessage()` which tracks message IDs—similar pattern needed for storage events.
</details>

<details>
<summary>Issue #9: Memory Leak Evidence</summary>
`quickTabHostInfo` is Map<quickTabId, { tabId, adoptionTime }>. Only written in adoption flow (line ~1440). Never cleaned. After week of usage creating/destroying Quick Tabs, map can hold 500-1000 entries from deleted tabs. Each entry is small but accumulates. No TTL or pruning mechanism exists.

Contrast with browser session storage which auto-clears on tab close—extension storage persists across sessions, so cleanup is manual responsibility.
</details>

<details>
<summary>Issue #10: Container Validation Evidence</summary>
`browser.tabs.get()` returns `cookieStoreId` field (e.g., "firefox-default", "firefox-container-1"). Current adoption code never checks this. If Tab A in container 1 adopts Quick Tab but new owner is Tab B in container 2, adoption proceeds blindly. Container 2's Quick Tabs group has no Quick Tab, but adoption marked ownership, causing orphaned state.

Firefox Multi-Account Containers API guarantees each tab has container ID; it's always available in `browser.tabs` results.
</details>

<details>
<summary>Issue #11: Message Loss Evidence</summary>
Port disconnect → reconnect delay (150ms-8s) → user action triggers message send → port null → `backgroundPort.postMessage()` fails silently (no exception, no queue, no callback). Message lost. No way for user or code to know. Background never receives minimize, UI shows minimized but background shows full.

Current pattern: `if (backgroundPort) { backgroundPort.postMessage(...) }` (implicit null check). But no fallback if port null. Should be queue.
</details>

<details>
<summary>Issue #12: TTL Race Evidence</summary>
Restore called → moves snapshot to `pendingClearSnapshots` → sets timeout to clear after 1000ms. If restore fails async → caller retries at 900ms → both retry and expiration timeout exist → race. Expiration can fire during retry, deleting snapshot while retry code still accessing it.

Similar to classic shutdown/cleanup races: resource freed while still in use.
</details>

<details>
<summary>Issue #13: Pattern Extraction Race Evidence</summary>
ID pattern: `qt-123-timestamp-xyz` (created in Tab 123). After adoption to Tab 456, pattern still says 123. If content script in Tab 456 sees this ID and calls pattern extraction, gets 123 even though Tab 456 now owns it. If content script in Tab 123 (different tab) calls restore with wrong ID, pattern matches 123, ownership check finds it, but cache shows it belongs to Tab 456 now. Ownership decision prioritizes pattern match → routes to Tab 123 → wrong tab.
</details>

<details>
<summary>Issue #14: Port Timeout Evidence</summary>
Slow device (1s latency) → heartbeat sent → 500ms timeout fires before response arrives → port marked dead → reconnected → original minimize message was queued, now re-sent on reconnect → minimize executes twice.

Also: false positive disconnections on slow networks, triggering unnecessary reconnects that disrupt smooth operation.
</details>

<details>
<summary>Issue #15: Concurrent Write Evidence</summary>
Two handlers execute in parallel (JavaScript event loop with async ops). Handler A reads globalState (tabs=[QT-1, QT-2]), adds QT-3, writes. Handler B reads globalState (tabs=[QT-1, QT-2]), deletes QT-2, writes. If Handler A writes first, globalState=[QT-1, QT-2, QT-3]. If Handler B writes second, overwrites with [QT-1], losing QT-3. Or vice versa—either way, one handler's mutation lost.

Atomic operation needed: read-modify-write must be indivisible or versioned.
</details>

<details>
<summary>Issue #16: Initialization Dependency Evidence</summary>
`isInitialized` set to true in handler constructor as final step. But storage.local read is async, not awaited properly. Content script receives SUCCESS based on flag, calls `handleGetQuickTabsState()`, which tries to access `globalState.tabs`, which is still `undefined` because storage read not complete. Returns `{ success: true, tabs: undefined }` which breaks UI.

Difference between "handler registered" and "handler ready to execute operations." Flag only tracks registration.
</details>

---

**Priority:** High (Issues #11, #15, #16), Medium (Issues #8-10, #12-14) | **Dependencies:** Coordinate with previous 7-issue PR if in flight | **Complexity:** Medium

