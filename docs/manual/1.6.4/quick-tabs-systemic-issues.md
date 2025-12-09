# Quick Tabs Manager: Critical Systemic Architecture Issues Diagnostic Report

**Extension Version:** v1.6.3.7+ | **Date:** 2025-12-09 | **Scope:** State
management, rendering architecture, and data persistence

---

## Executive Summary

Beyond the Firefox event page timeouts and port connection issues documented in
the previous report, Quick Tabs Manager has CRITICAL SYSTEMIC ARCHITECTURE
PROBLEMS in its state management, rendering lifecycle, and data persistence
layer. The extension is failing due to:

1. **Multiple competing state authorities** (Manager, Background, Content
   Scripts) writing to storage without coordination
2. **Cascading render triggers** where storage.onChanged AND port messages both
   independently call renderUI() with separate debounce timers
3. **Orphaned tab detection exists but display path is blocked** at the
   hydration layer
4. **Race conditions in debounce logic** causing old state to be rendered while
   new state is pending
5. **No state sync on port reconnection** leaving Manager with stale cached
   state
6. **Storage timing uncertainty** - onChanged fires before writes complete,
   causing phantom 0-tab states

These are not bugs but ARCHITECTURAL FAILURES requiring refactoring, not
patches.

---

## Issue #A: Multiple Writers Competing for State Authority (CRITICAL)

### Problem Statement

Logs show state cascades where tab counts drop mysteriously:

- T=053604.646Z: Storage has 4 tabs
- T=053605.531Z: Storage transitions to 1 tab (3 tabs deleted)
- T=053607.242Z: Storage back to 4 tabs (mysteriously restored)

Example from logs:

```
STORAGE_CHANGED: tabs 4→1 (delta: -3), saveId: 'adopt-quick-tab-xyz-1765252123456'
STORAGE_CHANGED: tabs 1→4 (delta: +3), saveId: 'reconciled-1765252125678'
```

Tabs that were "deleted" reappear without explanation.

### Root Cause Analysis

**File:** `background.js`, `quick-tabs-manager.js`, content script handlers

The extension has THREE competing writers to storage:

1. **Background Script** (line ~400 in background.js)
   - Maintains `globalQuickTabState` as canonical state
   - Processes BATCH_QUICK_TAB_UPDATE from all sources
   - Saves to storage after each operation
   - Belief: "I am the single source of truth"

2. **Manager** (lines 3122, 3067, 2754 in quick-tabs-manager.js)
   - Directly writes to storage in:
     - `adoptQuickTabToCurrentTab()` (line 3122)
     - `closeAllTabs()` (line 3067)
     - `closeMinimizedTabs()` (line 2754)
   - Belief: "I can write directly when needed"

3. **Content Scripts** (via persist callbacks)
   - DragController, ResizeController update position/size
   - Call `persist()` which sends messages to background
   - Background saves to storage
   - But content scripts also maintain local state

**The Conflict Scenario:**

```
T=100ms: Content Script (Tab 13) updates position, sends POSITION_UPDATE to background
T=110ms: Manager user clicks "Adopt Quick Tab", writes adopt change directly to storage
T=115ms: Background processes POSITION_UPDATE, reads current state from storage
         - Sees the adopt change BUT not the position update yet
         - Saves state WITHOUT the position update
T=120ms: Background writes state (includes adopt, excludes position)
         - Position change from T=100ms is lost
```

**Why This Happens:**

The code assumes:

- "Background is the writer" (coordinator pattern)
- "Manager can write for UI-only operations" (conflicting assumption)
- "Content scripts send messages, not direct writes" (but they do indirectly)

When both write without ordering/versioning:

- Last write wins (data loss)
- No conflict detection
- No merge strategy
- No "undo" or recovery

### Required Fix

**BROAD STATEMENT (NOT explicit code):**

Implement a **Write Authorization and Versioning System** where:

1. **Designate Single Writer**: Only background script writes to storage
   (enforce via messaging)
   - Manager must send COMMAND messages to background, not direct storage.set()
   - Background processes command, updates state, writes to storage
   - Manager receives confirmation before updating UI cache

2. **Add Version/Timestamp Tracking**:
   - Each storage write includes:
     `{ saveId, timestamp, writingTabId, previousSaveId }`
   - Detect out-of-order writes: if new write has older timestamp than last
     write, reject and log
   - Implement "last-write-wins" with conflict detection: log when a write
     overwrites newer data

3. **Implement Operational Ordering**:
   - Use a `writeQueue` in background that processes writes sequentially
   - Don't process next write until current write is confirmed persisted
   - Content scripts and Manager both must wait for acknowledgment before
     proceeding

4. **Add Conflict Resolution Logic**:
   - When multiple sources update same Quick Tab field:
     - Compare timestamps
     - Keep entry with newer timestamp
     - Log data loss: "Discarded write from Tab X because write from Tab Y is
       newer"
   - For batch operations, use saveId as "atomic unit" - entire write succeeds
     or fails

**Why This is Not Simple Code:**

This requires redesigning the message flow and coordination pattern across 4+
files. It's not a 10-line fix; it's a refactoring of the entire write path.

---

## Issue #B: Cascading Render Triggers from Multiple Sources (CRITICAL)

### Problem Statement

Manager's renderUI() is being called from TWO independent sources without
coordination:

1. **storage.onChanged listener** (line 3020)

   ```javascript
   browser.storage.onChanged.addListener((changes, areaName) => {
     if (areaName !== 'local' || !changes[STATE_KEY]) return;
     _handleStorageChange(changes[STATE_KEY]);
   });
   ```

2. **Port message listener** (line 335 in handlePortMessage)
   ```javascript
   if (message.type === 'STATE_UPDATE') {
     handleStateUpdateBroadcast(message); // This calls renderUI()
   }
   ```

**Each has its own debounce timer:**

- storage.onChanged debounce: `STORAGE_READ_DEBOUNCE_MS = 50ms`
- Port message debounce: Potentially different timing or no debounce at all
- renderUI() debounce: `RENDER_DEBOUNCE_MS = 300ms`

**The Cascade:**

```
T=0ms:   Storage write (position update)
T=5ms:   Storage.onChanged fires → _handleStorageChange() → renderUI() schedules @ T=305ms
T=15ms:  Background processes write, broadcasts via port: { type: 'STATE_UPDATE' }
T=18ms:  Port message arrives → handleStateUpdateBroadcast() → renderUI() CANCELS previous timer, reschedules @ T=318ms
T=50ms:  Another storage change (z-index) → renderUI() called → timer reset to T=350ms
T=100ms: Port broadcast arrives → renderUI() called → timer reset to T=400ms
...
T=405ms: Finally renderUI() executes with OLDEST cached state (from T=5ms)
         Newer state changes from T=50ms and T=100ms are not reflected
```

**The Result:**

- Animation plays with stale state
- User sees a "jump" when new state finally catches up
- If another renderUI() queues while one is executing, infinite render loop
  possible

### Root Cause Analysis

**Files:** `quick-tabs-manager.js` lines 2631-2700

The debounce mechanism resets the timer on EVERY call:

```javascript
function renderUI() {
  pendingRenderUI = true;

  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer); // ← ALWAYS clears timer
  }

  renderDebounceTimer = setTimeout(() => {
    if (!pendingRenderUI) return;
    pendingRenderUI = false;
    requestAnimationFrame(() => _renderUIImmediate());
  }, RENDER_DEBOUNCE_MS);
}
```

**The Problem:**

Each call clears the SAME timer. If two sources call renderUI() in quick
succession:

- First call sets timer to T+300ms
- Second call clears it and resets to T+300ms
- But the second caller's state may be DIFFERENT from the first caller's state
- Only the timestamp is updated, not the state reference

When the timer finally fires at T+300ms, `quickTabsState` may have been updated
multiple times by the second source, but `renderUI()` doesn't know if the state
it's about to render is the LATEST state or an intermediate state.

### Required Fix

**BROAD STATEMENT (NOT explicit code):**

Implement a **Unified Render Coordination System** where:

1. **Single Debounce Pipeline**: Route ALL renderUI() calls (from storage, from
   ports, from messages) through ONE debounce mechanism
   - Don't call renderUI() directly from port handler; instead call a
     `scheduleRender()` that goes through same debounce
   - Use state hash to detect if state actually changed before rendering
   - Only render if `hash(newState) !== hash(lastRenderedState)`

2. **Deduplicate Update Sources**: Before rendering, detect which sources
   triggered the update
   - storage.onChanged = "data changed in storage"
   - port message = "background notifying of change"
   - Both describing the same change? Only render once
   - Log when both fire for the same saveId

3. **Implement Render Priority Queue**: If multiple updates queue up, merge them
   - Don't cancel a pending render because a new update arrived
   - Instead, ADD the new update to a queue
   - When timer fires, apply ALL queued updates in order, then render once
   - Example: if position update and z-index update both pending, apply both
     THEN render

4. **Add State Synchronization Gate**:
   - Before rendering, load CURRENT state from storage (not cached state)
   - Compare with what was loaded at debounce time
   - If different, it means state changed while waiting, so use fresh state
   - Log: "Render using fresh state (hash changed T=100ms → T=320ms)"

**Why This is Complex:**

This requires refactoring how updates flow into the render pipeline. It's not a
setting change; it's a redesign of the update coordination.

---

## Issue #C: Orphaned Tab Detection Exists But Display Path Blocked (HIGH)

### Problem Statement

Manager code DETECTS orphaned tabs (originTabId is null) but NEVER DISPLAYS
them. Logs show:

```
HYDRATION BLOCKED - Orphaned Quick Tab [tab-xyz]...originTabId null
```

But Manager sidebar shows empty state even though orphaned tabs exist in
storage.

### Root Cause Analysis

**Files:** `quick-tabs-manager.js` multiple locations; `sidebar/utils/` helpers

The orphaned detection code IS present:

- Line 2424: `_isOrphanedQuickTab(tab)` - checks if `tab.originTabId == null`
- Line 2348: `groupQuickTabsByOriginTab()` - creates `'orphaned'` key for tabs
- Line 1928: `renderTabGroup()` - renders orphaned group with special styling
- Line 1951: Orphaned badge with "⚠️ Cannot restore" tooltip

**BUT tabs never reach renderTabGroup():**

Looking at render flow:

```
loadQuickTabsState() → loads from storage
  ↓
filterInvalidTabs(quickTabsState) → removes corrupted URLs
  ↓
extractTabsFromState(quickTabsState) → extracts tabs array
  ↓
groupQuickTabsByOriginTab(allTabs) → groups tabs including orphaned
  ↓
FOR EACH group: renderTabGroup(groupKey, group, collapseState) → renders group
```

**The Hydration Block:**

At startup, before renderUI(), there's a hydration phase that validates tabs
from storage. If a tab has `originTabId: null`, it's marked as
"HYDRATION_BLOCKED" and not included in the initial state.

**This means:**

1. Hydration loads from storage and validates
2. Tab with `originTabId: null` fails validation
3. Tab is REMOVED from quickTabsState
4. renderUI() is called with no orphaned tabs
5. renderTabGroup() never runs for orphaned group because the tabs don't exist
   in state

The orphaned rendering CODE exists but the ORPHANED TABS never reach that code.

### Required Fix

**BROAD STATEMENT (NOT explicit code):**

Implement a **Hydration Recovery Path** where:

1. **Track Blocked Tabs Separately**: During hydration validation, don't DELETE
   orphaned tabs
   - Instead, mark them with flag:
     `{ id: 'tab-xyz', orphaned: true, originTabId: null, blockReason: 'originTabId_null' }`
   - Keep them in state with the blocked flag
   - Log: "HYDRATION_KEPT_FOR_RECOVERY: tab-xyz (originTabId is null, can be
     adopted)"

2. **Pass Blocked Tabs to Render**: When extractTabsFromState(), include blocked
   tabs
   - Don't filter them out
   - Pass to groupQuickTabsByOriginTab() which already creates 'orphaned' group
   - Let renderTabGroup() render them with "Adopt" button

3. **Add Adoption UI Button**: When rendering orphaned tab (already mostly
   there, just needs to be reachable)
   - Show "⚠️ Orphaned - Cannot restore"
   - Show "📥 Adopt to Current Tab #[currentTabId]" button
   - Button calls adoptQuickTabToCurrentTab(quickTabId, currentBrowserTabId)

4. **Add Recovery Logging**: When user clicks Adopt button
   - Log: "ADOPTION_INITIATED: quick-tab-xyz → tab-123"
   - Update originTabId in state
   - Broadcast to all content scripts so they know this Quick Tab now belongs to
     tab-123

**Why This Matters:**

Users with orphaned Quick Tabs (from closed tabs) can't rescue them. The code to
render them exists but is unreachable. Just enabling the path would recover data
that users think is lost.

---

## Issue #D: Debounce Logic Has Race Condition with State Staleness (HIGH)

### Problem Statement

renderUI() debounce schedules a render 300ms in the future, but uses
`quickTabsState` THAT WAS CURRENT AT DEBOUNCE TIME, not at RENDER TIME.

Example:

```
T=0ms:   Storage position change → renderUI() called
         quickTabsState = { tabs: [tab-1 at x:100] }
         Debounce timer set for T=300ms

T=50ms:  Storage z-index change → renderUI() called again
         quickTabsState = { tabs: [tab-1 at x:100, zIndex: 5] }  ← state updated
         Timer cleared and reset for T=350ms

T=100ms: Port broadcast arrives → renderUI() called
         quickTabsState = { tabs: [tab-1 at x:100, zIndex: 10] }  ← state updated again
         Timer cleared and reset for T=400ms

T=400ms: Timer fires, _renderUIImmediate() executes
         Renders with quickTabsState = { tabs: [tab-1 at x:100, zIndex: 10] }
         ← But this is the state from T=100ms, not a fresh read from storage!
         What if state changed at T=300ms? We won't see it.
```

### Root Cause Analysis

**File:** `quick-tabs-manager.js` lines 2631-2700

The issue: debounce stores a reference to `quickTabsState`, but multiple sources
update this reference:

```javascript
function _renderUIImmediate() {
  const { allTabs, latestTimestamp } = extractTabsFromState(quickTabsState);
  // ↑ Uses the CURRENT value of quickTabsState variable
  // But quickTabsState may have been updated by storage.onChanged AFTER the debounce was set
}
```

**The problem:**

1. Debounce sets a timer to call `_renderUIImmediate()` in 300ms
2. In those 300ms, the Manager's `storage.onChanged` listener fires and updates
   `quickTabsState`
3. When timer fires and calls `_renderUIImmediate()`, it uses the UPDATED
   `quickTabsState`
4. This is intended behavior, BUT if a storage.onChanged updates state at
   T=250ms and debounce fires at T=300ms, the state is "fresh"
5. But if another debounce timer is set at T=300ms for T=600ms, and state
   changes at T=400ms, then at T=600ms we'll render with state from T=400ms

**The Real Issue:**

State can change WHILE a debounce is pending, and we don't have a way to know if
the state that will be rendered is:

- Older than the last change
- Newer than the last change
- Missing changes that happened while debounce was waiting

### Required Fix

**BROAD STATEMENT (NOT explicit code):**

Implement **Hash-Based State Change Detection in Debounce** where:

1. **Capture State Hash at Debounce Time**:
   - When renderUI() is called, compute `hash(quickTabsState)` immediately
   - Store this hash: `renderedStateHash`
   - When timer fires, compute `newHash = hash(quickTabsState)`

2. **Compare Hashes Before Rendering**:
   - If `newHash === renderedStateHash`: state hasn't changed, skip render
     (saves CPU)
   - If `newHash !== renderedStateHash`: state DID change, render with new state
   - Log both cases: "State unchanged (hash match), skipping render" or "State
     changed (hash mismatch), rendering"

3. **Add Timestamp Tracking**:
   - Store `capturedTimestamp` when debounce is set
   - Store `renderTimestamp` when debounce actually fires
   - If `renderTimestamp - capturedTimestamp > 300ms`, state might be stale
   - Log: "Render executed after 325ms delay (debounce duration 300ms) - state
     may be stale"

4. **Implement Cascading Debounce Cancel**:
   - If state changes during the 300ms wait, set a flag:
     `stateChangedDuringDebounce = true`
   - When timer fires, check this flag
   - If true, DON'T use the stored hash - fetch fresh state from storage and
     render
   - Log: "State changed while debounce was waiting, rendering with fresh state
     from storage"

**Why This Prevents Bugs:**

Currently, if state changes 3 times in 350ms:

```
T=0ms:   Change 1 → renderUI() → hash1 captured, timer set for T=300ms
T=50ms:  Change 2 → renderUI() → hash2 captured, timer RESET for T=350ms
T=100ms: Change 3 → renderUI() → hash3 captured, timer RESET for T=400ms
T=400ms: Timer fires → render with state from BEFORE Change 3 if state was updated at T=350ms
```

With hash detection:

```
T=400ms: Timer fires
         currentHash = hash(quickTabsState) = hash after Change 3
         capturedHash = hash after Change 1
         currentHash !== capturedHash? Yes! State changed, render with fresh state
```

---

## Issue #E: No State Sync on Port Reconnection (MEDIUM)

### Problem Statement

When sidebar's port to background disconnects and reconnects (due to background
script suspension), Manager assumes its cached `quickTabsState` is still valid.
If background state changed while disconnected, Manager displays stale data.

Example:

```
T=0s:   Port connected, Manager caches state: { tabs: [tab-1, tab-2] }
T=30s:  Port disconnects (background suspension)
T=31s:  Another browser tab closes tab-1, calls DELETE operation
        Background updates globalQuickTabState = { tabs: [tab-2] }
        Background saves to storage
T=32s:  Sidebar circuit breaker triggers reconnection
        Port successfully reconnects
        Manager still has cached state: { tabs: [tab-1, tab-2] }
        ← STALE! Doesn't know that tab-1 was deleted
T=35s:  User opens Manager sidebar
        Sees tab-1 in list (phantom tab that doesn't exist)
        Tries to restore tab-1 → fails
```

### Root Cause Analysis

**File:** `quick-tabs-manager.js` lines 234-300 (connectToBackground function)

Current reconnection logic:

```javascript
function connectToBackground() {
  try {
    backgroundPort = browser.runtime.connect({ name: 'quicktabs-sidebar' });

    backgroundPort.onMessage.addListener(handlePortMessage);
    backgroundPort.onDisconnect.addListener(() => {
      backgroundPort = null;
      stopHeartbeat();
      scheduleReconnect();
    });

    circuitBreakerState = 'closed';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

    startHeartbeat();
  } catch (err) {
    console.error('[Manager] Failed to connect to background:', err.message);
    handleConnectionFailure();
  }
}
```

**What's Missing:**

After successful reconnect, Manager doesn't request a state sync. It assumes its
cached state is still valid. But the background script may have processed
multiple changes while disconnected.

### Required Fix

**BROAD STATEMENT (NOT explicit code):**

Implement **Post-Reconnection State Synchronization** where:

1. **Add State Sync Request Message**:
   - After successful port connection, send a message:
     `{ type: 'REQUEST_FULL_STATE_SYNC' }`
   - Background receives this, sends back current `globalQuickTabState`

2. **Compare Cached vs. Server State**:
   - When sync response arrives, compute hash of old cached state
   - Compute hash of new synced state
   - If hashes differ, log: "STATE_DIVERGENCE_DETECTED: cache has 2 tabs, server
     has 1 tab"
   - Update cached state from server

3. **Trigger UI Update if State Changed**:
   - After sync, if state changed, call renderUI() to show new state
   - Log: "Synchronized state from background after reconnection"

4. **Add Timeout for Sync Request**:
   - If state sync doesn't arrive within 5 seconds, timeout and proceed with
     cached state
   - Log warning: "State sync timed out after 5s, proceeding with cached state
     (may be stale)"

**Why This Matters:**

Port reconnection happens silently to user. Without a state sync, Manager can
show phantom tabs or miss deleted tabs. A 5-line message request would fix this.

---

## Issue #F: Storage.onChanged Timing Uncertainty (MEDIUM)

### Problem Statement

`storage.onChanged` fires very quickly after `storage.local.set()` is called,
possibly BEFORE the data is fully persisted. This causes race conditions:

```
T=100ms: Content script calls browser.storage.local.set({ quick_tabs_state_v2: { tabs: [...] } })
T=105ms: storage.onChanged listener fires in Manager
         Manager calls browser.storage.local.get('quick_tabs_state_v2')
         ← What does it return? Fresh write or old data?
```

From logs:

```
VisibilityHandler Storage write STARTED (753.754ms)
Background storage.onChanged RECEIVED (753.777ms)  ← 23ms later!
```

### Root Cause Analysis

**Files:** Firefox WebExtensions API timing behavior; cross-process
communication delay

According to MDN docs: `storage.onChanged` fires "when storageArea.set...
executes". The phrase "when executes" is ambiguous:

- Does it mean "when the write has been persisted to disk"?
- Or "when the write operation is initiated"?

Evidence from logs suggests it's the latter. The 23ms gap in the logs might be:

- IPC communication latency (manager process to storage process)
- Storage operation not yet complete
- OR just the event being queued and fired asynchronously

### Required Fix

**BROAD STATEMENT (NOT explicit code):**

Implement **Explicit Write Confirmation Pattern** where:

1. **Add saveId to Every Write**:
   - When writing to storage, include a unique `saveId`:
     `{ tabs: [...], saveId: 'write-123-timestamp' }`
   - Background generates saveId, stores it

2. **Implement Write Acknowledgment**:
   - Don't rely on storage.onChanged to confirm the write happened
   - Instead, after `storage.local.set()`, immediately call
     `storage.local.get()` to verify
   - If returned saveId matches what we wrote, the write persisted
   - If it doesn't match, the write is still pending, wait and retry

3. **Add "Write In Progress" Flag**:
   - Before calling `storage.local.set()`, set a flag: `writingTabId`,
     `writingInstanceId`
   - When storage.onChanged fires, Manager checks if this write is from "self"
   - If yes, assume data is pending and wait for confirmation
   - If no, assume data is complete and render

4. **Log Write Timings**:
   - Log: "Write initiated at T=100ms, onChanged fired at T=105ms, get()
     confirmed at T=108ms"
   - If gap is >50ms, log warning: "Unusual delay in write confirmation"

**Why This Matters:**

If onChanged fires before data is persisted, Manager loads old data from
storage. This explains the mysterious "0 tabs temporarily" state changes. A
confirmation read after write would catch this.

---

## Missing Logging Diagnosis

The following logging is ABSENT and REQUIRED for debugging:

### Missing #1: Storage Write Confirmation Logging

**Location:** After every `browser.storage.local.set()` in Manager

Should log:

```
STORAGE_WRITE_INITIATED: saveId='adopt-xyz-timestamp', tabs=3, source='manager'
STORAGE_WRITE_CONFIRMED: saveId='adopt-xyz-timestamp', readBackCount=3 (write confirmed)
```

Currently missing: Only log at start, never at completion.

### Missing #2: Render Trigger Chain Logging

**Location:** Every call to renderUI()

Should log:

```
RENDER_SCHEDULED: trigger='storage.onChanged', source='_handleStorageChange', hash='abc123', delayMs=300
RENDER_TRIGGER_DEDUPLICATION: prevented duplicate render (hash unchanged)
```

Currently: Logs exist but don't show which source triggered render or if it was
a duplicate.

### Missing #3: Port Reconnection State Tracking

**Location:** After successful port reconnection

Should log:

```
PORT_RECONNECT_SUCCESSFUL: attempt=1, backoffUsed=100ms, timeSinceDisconnect=2500ms
STATE_SYNC_REQUESTED: expecting response with tab count
STATE_SYNC_RECEIVED: server has 2 tabs, cache had 3 tabs, DIVERGENCE DETECTED
```

Currently: Logs show reconnect but not whether state was synced.

### Missing #4: Orphaned Tab Hydration Logging

**Location:** During initial state load from storage

Should log:

```
HYDRATION_STARTED: tabsFromStorage=4
HYDRATION_VALIDATION: tab-1 valid, tab-2 valid, tab-3 blocked (originTabId null), tab-4 valid
HYDRATION_BLOCKED_TABS: count=1, reasons=['originTabId_null']
HYDRATION_RECOVERY: keeping blocked tabs for adoption UI (not deleting)
HYDRATION_COMPLETE: resultingState has 4 tabs (3 valid + 1 blocked/orphaned)
```

Currently: "HYDRATION_BLOCKED" log exists but doesn't say what happens to
blocked tabs.

### Missing #5: State Merge/Conflict Detection Logging

**Location:** When background processes state updates from different sources

Should log:

```
STATE_MERGE_ATTEMPT: source='content-tab-13', operation='position-update', quickTabId='tab-xyz'
STATE_MERGE_CONFLICT: tab-xyz already updated by different operation at 'T=105ms', new write at 'T=110ms'
STATE_MERGE_RESOLUTION: using 'last-write-wins', discarding older operation from tab-13
STATE_MERGE_WARNING: lost data: position update from tab-13 was overwritten by adopt from manager
```

Currently: No conflict detection or merge logging.

---

## Summary Table: Issues and Complexity

| Issue                             | Root Cause                                                | Missing Component                        | Fix Complexity | File(s) Affected                                      | Priority |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------------- | -------------- | ----------------------------------------------------- | -------- |
| **A: Multiple Writers**           | 3+ sources write to storage independently                 | Write authorization & versioning         | High           | background.js, quick-tabs-manager.js, content scripts | CRITICAL |
| **B: Cascading Renders**          | storage.onChanged & port messages both trigger renderUI() | Unified render pipeline                  | High           | quick-tabs-manager.js, port handlers                  | CRITICAL |
| **C: Orphaned Tabs Blocked**      | Hydration validation removes orphaned tabs before render  | Recovery path after hydration            | Medium         | quick-tabs-manager.js, utils/render-helpers.js        | HIGH     |
| **D: Debounce Race Condition**    | State captured at debounce time, stale at render time     | Hash-based state change detection        | Medium         | quick-tabs-manager.js (renderUI)                      | HIGH     |
| **E: No Reconnect Sync**          | Manager assumes cached state valid after port reconnect   | State sync message on reconnect          | Low            | quick-tabs-manager.js (connectToBackground)           | MEDIUM   |
| **F: Storage Timing Uncertainty** | onChanged fires before data persists                      | Write confirmation via get() after set() | Medium         | All storage writes                                    | MEDIUM   |

---

## Acceptance Criteria for Fixes

**For Issue A (Multiple Writers):**

- [ ] All Manager direct storage.set() calls removed
- [ ] Manager sends COMMAND messages to background instead
- [ ] Background processes commands sequentially (write queue)
- [ ] Each write includes saveId + timestamp
- [ ] Log shows: "WRITE_RECEIVED from manager, queued as #3, will process after
      write #2"
- [ ] No out-of-order writes: logs show write timestamps always increasing
- [ ] Test: Rapid adopt + close operations don't lose data

**For Issue B (Cascading Renders):**

- [ ] Single renderUI() entry point used by all sources
- [ ] Hash comparison before rendering: "Render skipped (state hash unchanged)"
- [ ] Port message handler routes through scheduleRender(), not renderUI()
      directly
- [ ] storage.onChanged routes through scheduleRender(), not renderUI() directly
- [ ] Log shows: "RENDER_DEDUPLICATION: prevented 2 duplicate renders in 300ms
      window"
- [ ] Animation plays smoothly without interruption
- [ ] Test: Rapid storage changes + port broadcasts don't cause animation
      flicker

**For Issue C (Orphaned Tabs):**

- [ ] Hydration keeps blocked tabs (with flag `orphaned: true`)
- [ ] renderTabGroup() handles orphaned group rendering
- [ ] "Adopt to Current Tab" button visible for orphaned tabs
- [ ] Button click updates originTabId and syncs to background
- [ ] Log: "ADOPTION_INITIATED: tab-xyz → tab-123" then "ADOPTION_COMPLETED:
      tab-xyz now belongs to tab-123"
- [ ] Test: Close a tab containing Quick Tabs, Manager shows them as orphaned,
      user can adopt them

**For Issue D (Debounce Race):**

- [ ] State hash computed at debounce time and stored
- [ ] At render time, compare current hash to stored hash
- [ ] If unchanged: skip render (log "State unchanged since debounce, skipping
      render")
- [ ] If changed: render with fresh state (log "State changed, rendering with
      fresh data")
- [ ] Test: Rapid storage changes don't cause stale renders

**For Issue E (Reconnect Sync):**

- [ ] After successful port connection, background.js responds to
      REQUEST_FULL_STATE_SYNC
- [ ] Manager compares synced state with cached state
- [ ] If different: updates cache and renders (log "STATE_DIVERGENCE_DETECTED")
- [ ] Test: Disconnect background, modify state in another tab, reconnect
      sidebar, sidebar shows updated state within 1 second

**For Issue F (Storage Timing):**

- [ ] After storage.local.set(), immediately call storage.local.get() to verify
- [ ] Log: "Write confirmed: saveId matches, data persisted" or "Write pending:
      saveId doesn't match yet, retrying"
- [ ] If mismatch, implement exponential backoff retry (max 3 retries)
- [ ] Test: Monitor logs during high-frequency storage writes, no "0 tabs
      temporarily" states

---

## References & Documentation

**Firefox Event Pages & Persistence:**

- https://bugzilla.mozilla.org/show_bug.cgi?id=1851373
- https://discourse.mozilla.org/t/will-a-runtime-connect-port-keep-a-non-persistent-background-script-alive/124263

**Storage API Timing:**

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged
- https://developer.chrome.com/docs/extensions/reference/api/storage

**Animation Frame & Rendering:**

- https://humanwhocodes.com/blog/2011/05/03/better-javascript-animations-with-requestanimationframe/
- https://www.sitepoint.com/simple-animations-using-requestanimationframe/

**State Management Patterns:**

- Write Authorization: https://martinfowler.com/bliki/CQRS.html
- Circuit Breaker:
  https://aws.plainenglish.io/an-introduction-to-circuit-breaker-pattern-and-its-uses-a3e9c295e814
- Conflict Resolution: https://en.wikipedia.org/wiki/Operational_transformation

---

**This report is for GitHub Copilot Coding Agent to understand the systemic
issues and implement fixes. DO NOT provide exact code; DO provide clear
statements of what needs to change and why.**
