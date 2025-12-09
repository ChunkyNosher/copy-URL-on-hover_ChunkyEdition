# Quick Tabs Manager: Architectural State Communication Redesign

**Extension Version:** v1.6.4.12+ | **Date:** 2025-12-08 | **Scope:** Runtime messaging architecture, persistent background script coordination, cross-tab state synchronization patterns, and missing logging infrastructure for message lifecycle

---

## Executive Summary

The current Quick Tabs Manager implementation relies exclusively on `browser.storage.local` + `browser.storage.onChanged` for cross-tab state coordination. This creates a fundamental architectural gap: no acknowledgment mechanism exists between when state is written and when the UI reflects it, and no validation confirms storage writes succeeded before sidebar re-renders. This report identifies 12 additional architectural issues beyond the 9 animation/logging issues in the previous report, all stemming from the absence of a **persistent background script coordinator pattern using `browser.runtime.onConnect` persistent messaging ports**. Fixing these issues requires implementing a robust message-passing architecture that treats the background script as the source-of-truth state manager.

---

## Architectural Issues Overview

| Issue | Component | Severity | Root Cause | Architecture Impact |
|-------|-----------|----------|------------|---------------------|
| #10: No message acknowledgment system | All | Critical | Sidebar doesn't wait for storage confirmation | Race conditions, state desync |
| #11: Background script not persistent | background.js | Critical | No long-lived connections to sidebar/content scripts | State updates lost when background unloads |
| #12: Port connection lifecycle invisible | runtime.onConnect | High | Missing logging for port open/close/disconnect | Silent connection drops, orphaned ports |
| #13: Missing state coordinator pattern | Manager + handlers | High | Multiple sources writing storage (race conditions) | Competing writes, conflicting state |
| #14: Storage write verification gap | Storage API | High | No confirmation storage write actually succeeded | Write failures silent, UI shows stale state |
| #15: Message type ambiguity | runtime.sendMessage | Medium | No discrimination between state update vs. action request | Wrong handlers invoked, unintended side effects |
| #16: Tab lifecycle events ignored | browser.tabs | Medium | No tracking when tabs open/close/unload | Orphaned Quick Tabs in storage, dead references |
| #17: Port cleanup on tab close missing | Content scripts | Medium | Ports stay in background script memory after tab unload | Memory leak, orphaned port listeners |
| #18: Adoption operation not atomic | adoptQuickTabToCurrentTab | High | Multiple storage operations not coordinated | Partial failures leave state inconsistent |
| #19: Minimize/restore not synchronized | Visibility handlers | Medium | State changes not broadcast to all contexts | Some tabs see old state, others see new state |
| #20: Count badge changes not reliable | renderUI | Low | No count change detection across render cycles | Badge animation never applies reliably |
| #21: Offscreen document simulation missing | Manager UI | Low | Current sidebar-centric approach can't handle headless scenarios | No isolation of state from UI rendering |

**Why bundled:** All 12 issues are architectural consequences of the single-source (storage.local) pattern. Fixing them requires implementing a message-passing coordinator system as the primary state channel with storage as fallback persistence.

---

## Architectural Pattern: Current vs. Proposed

### Current Architecture (Storage-First)

```
Content Script (Tab 1)          Sidebar Manager              Content Script (Tab 2)
        |                              |                              |
        +-- writes to -->  storage.local  <-- reads from --+
        |                              |                              |
        +-- listens to --> storage.onChanged <-- listens to --+
```

**Problems:**
- No acknowledgment of writes
- Race condition when multiple tabs write simultaneously
- No verification writes succeeded
- No message correlation
- No real-time state synchronization

### Proposed Architecture (Message-First with Storage Fallback)

```
Content Script (Tab 1)
        |
        +-- runtime.connect() -->  Background Script (Persistent)  <-- runtime.connect() -- Sidebar Manager
        |                                    |
        +-- port.onMessage.addListener() -- | -- port.postMessage() --> Sidebar renders
        |                                    |
        +-- storage.local.set() -->         | <-- storage.onChanged listener (fallback)
        |                              (state coordinator)
        +-- browser.tabs.onCreated -->      | <-- browser.tabs listener
                                           | <-- browser.tabs.onRemoved listener
                                           |
                                   Broadcasts to all connected ports
                                   on any state change
```

**Benefits:**
- Persistent background script keeps ports alive
- Acknowledgment message confirms UI can re-render
- Validation loop detects storage write failures
- Message correlation prevents interpretation errors
- Real-time state distribution to all contexts

---

## Issue #10: No Acknowledgment System for State Updates

### Problem

Sidebar UI initiates state change (e.g., collapse group), writes to storage, but never waits for confirmation that storage write succeeded or that other tabs received the update. If storage write fails silently, sidebar still re-renders showing new state while other tabs still have old state.

### Root Cause

**Architecture:** Current implementation uses one-way fire-and-forget messaging  
**Pattern:** `storage.local.set(data) → onChanged fires → UI updates`  
**Missing:** Confirmation handshake between write completion and UI render  
**Files Affected:**
- `sidebar/quick-tabs-manager.js` (all state-changing operations)
- `sidebar/utils/render-helpers.js` (render triggering)
- `background.js` (if it existed as coordinator)

### Fix Required

Implement request-acknowledgment message pattern: instead of direct storage writes from sidebar, sidebar sends message to background script via `runtime.sendMessage()` with callback. Background script writes to storage, validates write succeeded, then sends acknowledgment. Sidebar only re-renders after acknowledgment received. This pattern prevents rendering stale state when storage write fails.

---

## Issue #11: Background Script Not Persistent (Critical Architecture Issue)

### Problem

Background script may unload due to inactivity (no active ports), causing in-flight messages to be lost and state synchronization to fail. Sidebar and content scripts have no guarantee background script is listening.

### Root Cause

**Firefox Behavior:** Manifest V2 persistent background scripts remain loaded indefinitely, BUT only if they maintain active listeners or connections. If no listeners exist and no messages are in flight, the script can be garbage collected or unloaded in memory-constrained scenarios.

**Current Implementation:** Quick Tabs Manager does not establish persistent connections to sidebar/content scripts, so background script has no reason to remain active.

**File:** `background.js` (if present) or manifest.json background_page configuration

### Fix Required

Establish persistent port connections using `browser.runtime.onConnect` that the background script never closes. Content scripts and sidebar should call `browser.runtime.connect()` on load with a persistent port ID. Background script listens for these connections and stores port references. Keep at least one port open at all times (e.g., sidebar tab or primary content script) to prevent background script unload. Log port connection/disconnection lifecycle to detect orphaned ports.

---

## Issue #12: Port Lifecycle Completely Invisible

### Problem

No logging exists for when content scripts establish connections, disconnect, reconnect, or fail to connect. Silent port failures (dropped connections) are indistinguishable from successful connections, making state sync failures impossible to diagnose.

### Root Cause

**Files:** `background.js` (runtime.onConnect missing), `sidebar/quick-tabs-manager.js` (runtime.connect not logged), content scripts (no connection logging)

**Missing Logging:**
- Port open timestamp with script origin/tab ID
- Port close/disconnect with reason (tab unload, explicit disconnect, error)
- Port message send/receive with message type and correlation ID
- Port error with stack trace
- Port orphan detection (port closed but listener still firing)

### Fix Required

Wrap all `browser.runtime.connect()`, `port.onMessage.addListener()`, and `port.onDisconnect.addListener()` with comprehensive logging. Log format: `[Manager] PORT_LIFECYCLE [origin] [event]: [details], { tabId, portId, timestamp }`. This creates a complete audit trail of connection state across all extension contexts.

---

## Issue #13: Missing State Coordinator Pattern (Race Conditions)

### Problem

Multiple sources can write to storage.local simultaneously: sidebar Manager, content scripts (adoption), visibility handlers, resize handlers, position handlers. When multiple writes happen in same tick, storage.onChanged fires multiple times and handlers execute in unpredictable order, causing state corruption.

Example race condition:
1. Tab A writes: `qt-123.originTabId = 5`
2. Tab B writes: `qt-123.orphaned = true` 
3. Manager sees event 1, renders with originTabId=5
4. Manager sees event 2, renders orphaned state
5. If events reorder, state could show as "not orphaned but no owner"

### Root Cause

**Architecture:** No central coordinator that sequences writes  
**Files:** All files that call `storage.local.set()` without coordination  
**Pattern:** Distributed writes from N sources instead of centralized writes from 1 coordinator

### Fix Required

Designate background script as sole writer to storage.local. All other contexts (sidebar, content scripts, handlers) must send messages to background script requesting state changes. Background script sequences operations, writes once per change, then broadcasts confirmation via ports. This ensures atomic writes and predictable state evolution.

---

## Issue #14: Storage Write Verification Gap (No Confirmation Loop)

### Problem

After calling `storage.local.set(data)`, code assumes write succeeded immediately. If storage quota is exceeded, storage system is corrupted, or write partially fails, there's no detection mechanism. UI renders "success" even though storage never updated.

### Root Cause

**API:** `storage.local.set()` is not transactional; callback fires when set() completes, not when storage is actually persisted  
**Missing:** Read-back verification that written data matches what was sent  
**Files:** All files calling `storage.local.set()`

### Fix Required

After `storage.local.set()` callback, immediately call `storage.local.get()` to verify written data matches sent data. If mismatch or error, log warning with diff showing what was sent vs. what was stored. This catches quota exceeded, corruption, and partial write failures before UI commits to new state.

---

## Issue #15: Message Type Ambiguity in runtime.sendMessage()

### Problem

When sidebar or content script sends message to background script via `runtime.sendMessage({...})`, receiver doesn't know if message is a "state update notification", "action request", "acknowledgment", or "error report". Without message type discrimination, background script might invoke wrong handler, triggering unintended side effects.

Example ambiguity:
- Message: `{ groupId: 'qt-group-1', open: true }`
- Could mean: "please open this group" OR "I observed this group is now open"
- Background script doesn't know which

### Root Cause

**Files:** All uses of `runtime.sendMessage()` and `onMessage` listeners

**Missing:** Message type field (e.g., `{ type: 'STATE_UPDATE', action: 'TOGGLE_GROUP', ... }`)

### Fix Required

Add mandatory `type` field to all messages: `{ type: 'ACTION_REQUEST' | 'STATE_UPDATE' | 'ACKNOWLEDGMENT' | 'ERROR', action: '...', ... }`. Define constants for all valid types. Background script routes messages by type to appropriate handlers. This prevents misinterpretation and enables logging discrimination by message category.

---

## Issue #16: Tab Lifecycle Events Not Tracked

### Problem

When tab is closed, any Quick Tabs that belonged to that tab become orphaned references in storage. No mechanism removes them or alerts Manager. Manager continues displaying dead tabs, clicking opens nothing, sidebar shows stale state.

### Root Cause

**Missing Listener:** `browser.tabs.onRemoved` listener doesn't exist  
**Missing Listener:** `browser.tabs.onCreated` listener doesn't exist  
**Current Pattern:** Quick Tab state only changes when user manually minimizes/adopts, not when tab life changes

**Files:** No listener exists; needs implementation in background script

### Fix Required

Add `browser.tabs.onRemoved` listener that queries storage for Quick Tabs belonging to closed tab ID. If found, mark tab as orphaned or remove from active list depending on adoption state. Add `browser.tabs.onCreated` listener that checks if new tab inherits Quick Tabs from previous tab (for session restore scenarios). Broadcast tab lifecycle changes to all contexts via ports.

---

## Issue #17: Port Cleanup on Tab Close Missing (Memory Leak)

### Problem

When user closes a tab, the content script in that tab unloads, but its port connection in the background script's memory never closes properly. Background script accumulates references to closed tab's ports, eventually consuming memory. After closing 100+ tabs, extension becomes slow.

### Root Cause

**Missing Cleanup:** Content script doesn't explicitly disconnect port on `window.unload`  
**Missing Listener:** Background script has no handler for `port.onDisconnect` event  
**Files:** Content script (missing unload handler), background.js (missing disconnect listener)

### Fix Required

In content script, listen for `window.unload` or `beforeunload` and call `port.disconnect()`. In background script, listen for `port.onDisconnect` and remove port reference from in-memory registry. Log disconnect with tab ID and port count remaining. Implement periodic port cleanup (every 5 minutes) to detect orphaned ports still in memory.

---

## Issue #18: Adoption Operation Not Atomic (State Corruption Risk)

### Problem

`adoptQuickTabToCurrentTab()` performs multiple operations: read from source tab, modify `originTabId`, remove from source tab's list, add to destination tab's list. If any operation fails mid-process, state becomes inconsistent: same tab ID appears in both source and destination lists, or disappears from both.

### Root Cause

**Pattern:** Function makes multiple `storage.local.set()` calls sequentially without transaction semantics  
**Missing:** Atomic update mechanism (should be single `set()` call with entire state transform)  
**Missing:** Rollback on partial failure  
**File:** `sidebar/quick-tabs-manager.js` (adoptQuickTabToCurrentTab function)

### Fix Required

Restructure adoption as single storage write: read entire state, transform locally (update source list, update destination list, update tab's originTabId), write back as single `storage.local.set()` call. This ensures all-or-nothing semantics. If write fails, rollback in memory and don't update UI. Wrap in try-catch with detailed error logging showing what state changes failed.

---

## Issue #19: Visibility State Changes Not Synchronized Across Contexts

### Problem

When user minimizes Quick Tab in one tab, other tabs' sidebar Manager UIs don't reflect that state change immediately. They continue showing the tab as visible until their own storage.onChanged listener fires (potentially delayed). This creates "ghost tabs" that appear visible in one context but minimized in another.

### Root Cause

**Pattern:** Each tab's handler (minimize/restore) updates storage independently  
**Missing:** Broadcast to all other contexts that state changed  
**Current:** Manager only receives updates via storage.onChanged, which may batch or delay events  
**Files:** Visibility handlers, Manager UI rendering

### Fix Required

When any handler changes visibility state, send message to background script. Background script broadcasts visibility change to all connected ports (all other sidebar/content script contexts). Each context receives broadcast and updates UI immediately without waiting for storage.onChanged event. Storage write is secondary/fallback only.

---

## Issue #20: Count Badge Animation Unreliable (Render Cycle Issue)

### Problem

Badge scaling animation (`.tab-group-count.updated` class) should trigger when count changes. Currently, animation never applies reliably because old elements are destroyed and new elements created during re-render, so animation class never persists long enough to run.

### Root Cause

**Pattern:** `renderUI()` performs wholesale DOM replacement instead of differential updates  
**Missing:** Count change detection before re-render  
**Missing:** Animation class application to existing badge instead of new badge  
**Files:** `sidebar/quick-tabs-manager.js` (renderUI, _createGroupHeader)

### Fix Required

Implement diff-based rendering: before re-rendering groups, compare old count values (from `dataset.count`) with new counts. If count differs, apply `.updated` animation class to existing badge, remove class after animation completes (300-350ms), then update `dataset.count`. This preserves DOM element long enough for CSS animation to run. Alternatively, compute count delta and animate immediately, before re-render.

---

## Issue #21: Offscreen Document Pattern Not Available in Firefox

### Problem

Current sidebar-centric architecture means Quick Tabs Manager UI is tightly coupled to the sidebar DOM. If sidebar is closed, Manager state calculations stop. No isolated state machine exists that could continue operating if UI isn't visible. This creates dependency: UI must always be open for state to be managed.

### Root Cause

**Firefox Limitation:** Firefox doesn't support offscreen documents (Chrome MV3 feature)  
**Current Pattern:** Manager is sidebar script, not background service  
**Missing:** Isolated state machine separate from UI rendering  
**Files:** Architecture (not specific file)

### Fix Required

This isn't immediately fixable given Firefox limitations, but design toward it: background script should be the state machine (coordinator), sidebar should be a view/observer. Background script maintains all state independently of whether sidebar is open. Sidebar connects and subscribes to state changes. This separation means future Firefox MV3 migration would support offscreen state management without restructuring.

---

## Shared Implementation Architecture

### Message Protocol Definition

All new message passing should follow unified structure:

Define constants for message types: `ACTION_REQUEST`, `STATE_UPDATE`, `ACKNOWLEDGMENT`, `ERROR`, `BROADCAST`

Define constants for action names: `TOGGLE_GROUP`, `MINIMIZE_TAB`, `ADOPT_TAB`, `DELETE_GROUP`, etc.

Message envelope format:
- `type`: Message category (ACTION_REQUEST, STATE_UPDATE, etc.)
- `action`: Specific operation name
- `correlationId`: UUID to match request with acknowledgment
- `source`: Origin of message (sidebar, content-tab-47, background)
- `timestamp`: When message sent
- `payload`: Action-specific data
- `metadata`: Diagnostic info (saveId, affectedTabs, etc.)

### Port Connection Registry

Background script maintains registry of active ports:
- `ports[portId] = { port, origin, tabId, type, connectedAt, lastMessageAt, messageCount }`
- Log all registry changes
- Implement periodic cleanup (remove ports disconnected >5 minutes)
- Export registry state on request for debugging

### State Change Broadcast Pattern

When state changes (any source):
1. Coordinator (background) validates change
2. Writes to storage.local
3. Reads back to verify write succeeded
4. Broadcasts change to all connected ports with correlation ID
5. Logging: `[Manager] STATE_CHANGE [action] [correlationId]: old→new, { affectedTabs, ports_notified }`

### Cross-Tab Synchronization Guarantees

- All tabs receive same state changes in same order (guaranteed by background coordinator sequencing)
- Storage.local serves as fallback if port delivery fails
- Tab crash/reload: tab reconnects, background replays state from storage to reconnecting tab
- Message ordering preserved within same port; across ports may race (acceptable - background is source of truth)

---

## Storage Layer Integration

### Storage.local Role (Fallback Only)

After message-passing becomes primary:
- Background script writes to storage.local for persistence
- No other sources write to storage.local
- storage.onChanged listener becomes secondary validation
- If storage.onChanged fails to fire (rare), background script still maintains state in ports
- Storage quota exceeded: background script detects, logs error, continues coordinating via ports (next reload will fail to restore)

### Backwards Compatibility

Current extension version uses storage.local directly. New version must:
- Read existing storage.local on startup
- Populate background script's in-memory state from storage.local
- Broadcast state to all contexts
- Don't break if old storage format encountered

---

## Testing Scenarios for New Architecture

**Port Lifecycle:**
- [ ] Open sidebar: background script receives connection, port in registry, logged
- [ ] Close sidebar: port disconnected, removed from registry, logged
- [ ] Open multiple sidebars: multiple ports registered
- [ ] Rapid open/close (5x in 2 seconds): ports properly cleaned up, no orphans

**Message Acknowledgment:**
- [ ] Toggle group: sidebar sends ACTION_REQUEST, waits for ACKNOWLEDGMENT before re-render
- [ ] Adopt tab: background acknowledges, updates both source/destination tabs before broadc asting
- [ ] Storage write fails: background logs error, still sends ACKNOWLEDGMENT (state in memory correct), UI aware of storage issue

**State Synchronization:**
- [ ] Minimize in Tab A: Tab B's sidebar updates via broadcast within 50ms (not waiting for storage.onChanged)
- [ ] Rapid toggling (3 operations in 1 second): all applied in sequence, final state correct
- [ ] Tab connection drops mid-operation: operation still completes (background state correct)

**Cleanup:**
- [ ] Close 20 tabs rapidly: no memory leak, port registry clean
- [ ] Long-running session (1 week): no accumulated orphaned ports, cleanup working

<acceptance_criteria>

**Architecture #10 (Acknowledgment System):**
- [ ] Sidebar sends request message with correlationId
- [ ] Background processes, writes storage, broadcasts ACKNOWLEDGMENT with same correlationId
- [ ] Sidebar waits for ACKNOWLEDGMENT before re-rendering (timeout: 1 second fallback)
- [ ] Failed acknowledgment shows warning in console with diagnostic data

**Architecture #11 (Persistent Background):**
- [ ] Background script has active port listener: `browser.runtime.onConnect`
- [ ] At least one port stays connected at all times (sidebar preferred)
- [ ] Sidebar/content scripts call `browser.runtime.connect()` on load
- [ ] Port lifecycle logged with `[Manager] PORT_LIFECYCLE` prefix

**Architecture #12 (Port Logging):**
- [ ] Port open: `[Manager] PORT_LIFECYCLE [origin] CONNECTED: { tabId, portId, timestamp }`
- [ ] Port close: `[Manager] PORT_LIFECYCLE [origin] DISCONNECTED: { reason, portId }`
- [ ] Port error: `[Manager] PORT_LIFECYCLE [origin] ERROR: { error, portId }`
- [ ] All port logs searchable and correlatable

**Architecture #13 (Coordinator Pattern):**
- [ ] Only background script writes to storage.local
- [ ] All other sources send messages to background, background writes
- [ ] Storage writes sequenced (no simultaneous writes)
- [ ] Race condition test: 5 simultaneous adoption requests → all succeed atomically

**Architecture #14 (Write Verification):**
- [ ] After storage.local.set(), immediately call storage.local.get()
- [ ] Verify retrieved data matches sent data (deep equal)
- [ ] Log success: `[Manager] STORAGE_VERIFIED [key] [size_bytes]: write confirmed`
- [ ] Log failure: `[Manager] STORAGE_MISMATCH [key]: sent={...}, stored={...}`

**Architecture #15 (Message Types):**
- [ ] All messages have `type` field (ACTION_REQUEST, STATE_UPDATE, ACKNOWLEDGMENT, ERROR, BROADCAST)
- [ ] Background script routes by type to different handlers
- [ ] Logging includes message type: `[Manager] MESSAGE [type] [action] [correlationId]`
- [ ] No ambiguous messages pass filtering

**Architecture #16 (Tab Lifecycle):**
- [ ] `browser.tabs.onRemoved` listener exists and logs removals
- [ ] Closed tab's orphaned Quick Tabs are identified within 1 second
- [ ] Manager notified of orphaned tabs via port broadcast
- [ ] UI marks orphaned tabs with visual indicator

**Architecture #17 (Port Cleanup):**
- [ ] Content script calls `port.disconnect()` on `window.unload`
- [ ] Background script listens to `port.onDisconnect`
- [ ] Periodic cleanup task runs every 5 minutes, removes stale ports
- [ ] Port count never increases indefinitely over session lifetime

**Architecture #18 (Adoption Atomicity):**
- [ ] `adoptQuickTabToCurrentTab()` performs single storage.local.set() call
- [ ] All state changes in one atomic operation (source list, dest list, originTabId)
- [ ] Rollback on failure: state reverts to pre-adoption if write fails
- [ ] Adoption operation logged with sourceTabId, destTabId, saveId, result

**Architecture #19 (Visibility Sync):**
- [ ] Minimize handler sends message to background
- [ ] Background broadcasts to all ports immediately
- [ ] All connected sidebars update UI within 50ms (before storage.onChanged)
- [ ] Storage write is secondary, not primary coordination method

**Architecture #20 (Badge Animation):**
- [ ] Count change detected before re-render
- [ ] `.updated` class applied to existing badge (not replaced badge)
- [ ] Animation runs for full 300-350ms
- [ ] Class removed after animation, badge reverts to normal style

**Architecture #21 (Isolated State Machine):**
- [ ] Background script maintains state independently of sidebar visibility
- [ ] Sidebar can close and reopen without losing coordination
- [ ] State machine in background continues processing messages even if sidebar closed
- [ ] If sidebar unopened at startup, state still restored from storage and available to content scripts

**All Architecture Issues (Common):**
- [ ] All new message passing fully logged with timestamps and correlation IDs
- [ ] No console errors or warnings introduced
- [ ] Port registry accessible via `browser.storage.local.get('__PORT_REGISTRY__')` for debugging
- [ ] Manual test: open sidebar, close, reopen → state consistent, no message loss
- [ ] Manual test: adopt tabs in 3 tabs simultaneously → all succeed atomically, final state correct
- [ ] Manual test: rapid group toggles (10x in 5 seconds) → no UI glitches, final state preserved

</acceptance_criteria>

## Supporting Context

<details>
<summary>Why Firefox Manifest V2 Still Matters</summary>

Firefox announced gradual MV3 adoption but continues supporting MV2 indefinitely (unlike Chrome's aggressive MV2 deprecation). This means Quick Tabs Manager can leverage persistent background scripts reliably without worrying about MV3-forced service worker limitations. The current architecture should not hesitate to use `browser.runtime.onConnect` for persistent messaging because Firefox's MV2 background pages are guaranteed persistent as long as listeners exist.

</details>

<details>
<summary>Storage.onChanged Event Batching Behavior</summary>

When multiple `storage.local.set()` calls happen in the same JavaScript tick, Firefox batches them and fires a single `storage.onChanged` event with all changes in the `changes` object. However, if calls happen in different ticks (even separated by setTimeout 0), separate `storage.onChanged` events fire. This unpredictability makes storage the wrong primary sync channel. Message-passing guarantees immediate delivery and ordering.

</details>

<details>
<summary>Message Port Lifecycle in Firefox</summary>

Per MDN: "A port can be closed explicitly with `port.disconnect()` or implicitly when the page unload. A port is also closed if the other end of the connection was closed." When content script tab unloads without calling `port.disconnect()`, the port still exists in background script memory until background script detects it's orphaned. Without explicit cleanup, ports accumulate. This is why Issue #17 is critical - ports must be cleaned up explicitly.

</details>

<details>
<summary>Race Condition Example: Simultaneous Adoptions</summary>

Scenario: User drags Quick Tab qt-123 from Tab A to Tab B while Tab C's content script is also trying to adopt same qt-123.

Current (storage-only):
1. Tab A: storage.local.set({ tabs: { qt-123: { originTabId: 5 } } })
2. Tab C: storage.local.set({ tabs: { qt-123: { originTabId: 7 } } })
3. storage.onChanged fires with Tab C's write overwriting Tab A's write
4. Final state: qt-123 belongs only to Tab C, may still be in Tab A's local state
5. Manager UI shows inconsistent state across tabs

Proposed (message-first):
1. Tab A: sends ACTION_REQUEST { action: 'ADOPT_TAB', qtId: 'qt-123', fromTab: 5, toTab: 2, ... }
2. Tab C: sends ACTION_REQUEST { action: 'ADOPT_TAB', qtId: 'qt-123', fromTab: 5, toTab: 7, ... }
3. Background receives both, locks state, processes sequentially
4. First request completes: qt-123 → Tab 2, broadcast to all ports
5. Second request: qt-123 already owned by Tab 2, adoption fails with ALREADY_ADOPTED error
6. Both Tab A and Tab C receive appropriate ACKNOWLEDGMENT with final state
7. Manager UI correct everywhere

</details>

<details>
<summary>Offscreen Document Limitation</summary>

Chrome's MV3 allows `offscreen.html` documents that run separate JavaScript contexts with DOM access but no UI display. This enables state machines separate from visible UI. Firefox doesn't support offscreen documents yet (under discussion for future MV3 compatibility). However, the proposed architecture with background coordinator + port broadcasting achieves similar separation: background script is state machine, sidebar is subscriber/observer. When Firefox eventually supports offscreen documents (or if extension migrates to MV3), replacing sidebar messaging with offscreen document would be straightforward.

</details>

---

## Migration Path: From Storage-First to Message-First Architecture

### Phase 1: Add Background Coordinator (Non-Breaking)
- Implement background script message listeners without changing current storage writes
- Sidebar continues writing to storage.local
- Background script listens to storage.onChanged and broadcasts via ports (if ports exist)
- Current behavior unchanged, no UI modifications

### Phase 2: Add Port Infrastructure (Non-Breaking)
- Content scripts and sidebar establish runtime.connect() ports
- Ports stay idle (messages not used yet)
- Storage-based sync continues working
- New port infrastructure ready for Phase 3

### Phase 3: Migrate State Changes to Message-Based (Breaking)
- Update state-changing code to send messages instead of direct storage writes
- Background coordinator receives messages, validates, writes to storage, broadcasts acknowledgments
- Old storage-only paths removed
- UI waits for acknowledgments before re-rendering

### Phase 4: Add Storage Verification (Bug Fixes)
- After storage writes, implement read-back verification
- Handle storage quota exceeded, corruption, partial failures
- Logging comprehensive for all verification failures

### Phase 5: Add Port Lifecycle Cleanup (Bug Fixes)
- Implement `port.onDisconnect` handlers
- Add window.unload port cleanup in content scripts
- Periodic orphaned port cleanup in background

### Total Implementation: ~800-1200 lines of new code (message protocol, handlers, logging), ~400 lines of refactoring (remove direct storage writes from non-background contexts)

---

**Priority:** Critical (Issues #10-15), High (Issues #16-18), Medium (Issues #19-21) | **Target:** Two-phase implementation (Phase 1-2 foundation, Phase 3-5 migration) | **Estimated Complexity:** High (architectural redesign, but structured migration path exists)