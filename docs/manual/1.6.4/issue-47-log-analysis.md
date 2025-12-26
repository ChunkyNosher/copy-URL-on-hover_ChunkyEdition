# Quick Tabs: Log-Derived Issues, Bugged Behaviors, and Missing Logging

**Extension Version:** v1.6.3.12 | **Date:** 2025-12-26 | **Scope:** Analysis of actual runtime logs showing container ID mismatch, persistence failures, and logging gaps

---

## Executive Summary

Analysis of extension logs captured during Quick Tab creation reveals critical behavioral failures that prevent state persistence and Manager UI synchronization. Three Quick Tabs are successfully created and rendered to the DOM with correct positioning and event handling, but all three fail to persist to storage due to container ID mismatch between the Identity system and the CreateHandler. This cascades into complete Manager UI failure as no state reaches storage, and no storage updates trigger Manager rendering. Additionally, critical logging is missing across port lifecycle, storage health monitoring, and state synchronization paths.

---

## Confirmed Issues from Log Analysis

### **Issue A: Container ID Mismatch During Quick Tab Creation**

**Severity:** Critical  
**Evidence:** Log timestamps 2025-12-26T04:23:26.191Z through 04:23:29.482Z

**Problem:**
Content script correctly acquires container context `firefox-container-9` through the Identity system. However, all Quick Tabs created during the session receive `originContainerId: "firefox-default"` from `options.cookieStoreId`, creating a permanent mismatch.

**Log Evidence:**
```
[2025-12-26T04:23:26.191Z] [IDENTITY_ACQUIRED] Container ID acquired: firefox-container-9
[2025-12-26T04:23:28.288Z] [CreateHandler] 📦 CONTAINER_CONTEXT:
  originContainerId: "firefox-default"
  source: "options.cookieStoreId"
```

**Bugged Behavior:**
- Content script initializes with correct container context (firefox-container-9)
- CreateHandler receives options with cookieStoreId field
- CreateHandler uses cookieStoreId as originContainerId source instead of Identity context
- All 3 Quick Tabs receive wrong container ID
- Identity context is never consulted during creation

**Why This Happens:**
The Identity system successfully determines actual container context, but this value is not passed through the initialization chain to CreateHandler. Instead, CreateHandler relies on `options.cookieStoreId`, which was set during initialization and does not reflect runtime context acquired by Identity.

<scope>
This affects tab ownership validation during persistence and Manager state sync. Quick Tabs are created with wrong metadata, preventing them from persisting to storage that will be accessed by correct container.
</scope>

---

### **Issue B: Ownership Filter Cascading Rejection**

**Severity:** Critical  
**Evidence:** Log timestamps 2025-12-26T04:23:30.240Z

**Problem:**
VisibilityHandler applies ownership filter during state persistence. Filter checks if `originContainerId` matches `currentContainerId`. Due to Issue A, all Quick Tabs have `originContainerId: "firefox-default"` but `currentContainerId: "firefox-container-9"`, failing the ownership check.

**Log Evidence:**
```
[2025-12-26T04:23:30.240Z] [VisibilityHandler][Tab 23] [CONTAINER_VALIDATION] Container mismatch:
  quickTabId: "qt-23-1766723008288-1bun038kqj8ob"
  originContainerId: "firefox-default"
  currentContainerId: "firefox-container-9"

[2025-12-26T04:23:30.240Z] [VisibilityHandler] Filtering out cross-tab Quick Tab from persist:
  id: "qt-23-1766723008288-1bun038kqj8ob"

[2025-12-26T04:23:30.240Z] [VisibilityHandler] Ownership filter result:
  totalTabs: 3
  ownedTabs: 0
  filteredOut: 3
```

**Bugged Behavior:**
- All 3 Quick Tabs successfully created and registered in UICoordinator.renderedTabs map
- All visible in DOM with correct positioning (left, top, width, height)
- On focus event, VisibilityHandler attempts to persist state
- Ownership filter identifies all 3 as non-owned (container mismatch)
- All 3 filtered out before storage write
- Storage write receives 0 tabs

**Cascading Effect:**
When 0 tabs reach storage, the empty write rejection validation fires. This prevents storage write and blocks any subsequent Manager UI updates that depend on storage events. Essentially, Issue B is a **direct consequence of Issue A**.

<scope>
This blocks all persistence operations for the session. Quick Tabs remain visible in DOM but completely disconnected from storage and Manager UI. No state synchronization possible.
</scope>

---

### **Issue C: Empty Write Rejection Blocking Sync Path**

**Severity:** Critical  
**Evidence:** Log timestamps 2025-12-26T04:23:30.240Z, 04:23:31.923Z, 04:23:43.171Z

**Problem:**
Storage validation rejects empty state writes (0 tabs) unless `forceEmpty: true` is set. When VisibilityHandler filters all Quick Tabs as non-owned (Issue B), it attempts to persist 0 tabs without setting forceEmpty flag, triggering the validation block.

**Log Evidence:**
```
[2025-12-26T04:23:30.240Z] [WARN] [VisibilityHandler] BLOCKED: Empty write rejected (forceEmpty required)
  correlationId: "write-2025-12-26T04:23:30.240Z-27sgqn"
  tabCount: 0
  forceEmpty: false

[2025-12-26T04:23:30.240Z] [ERROR] [StorageWrite] LIFECYCLE_FAILURE:
  reason: "Empty write rejected"
  phase: "EMPTY_CHECK"
  tabCount: 0
  forceEmpty: false
```

**Bugged Behavior:**
- VisibilityHandler calls persistStateToStorage() with empty tabs array
- Storage validation checks if tabCount === 0
- If forceEmpty !== true, write is rejected
- VisibilityHandler does not set forceEmpty for legitimate operation
- Storage never receives the "cleared" state
- No storage.onChanged event fires (no update to storage)
- Manager UI receives no signal that state was attempted

**Repeated Failures:**
Empty write rejection occurs at:
- 04:23:30: On focus event
- 04:23:31: On drag end (second tab)
- 04:23:43: On page unload (DestroyHandler)

Each time, the write is silently rejected.

<scope>
This creates a hard block on all persistence operations once Issue A causes filtering. The rejection is a safety feature (prevent non-owner corruption), but here it's blocking legitimate operations caused by upstream bug. Secondary to Issue A but blocks recovery.
</scope>

---

### **Issue D: Storage.session API Incompatibility on First Hydration**

**Severity:** High  
**Evidence:** Log timestamps 2025-12-26T04:23:26.424Z

**Problem:**
Code attempts to read Quick Tabs state from `browser.storage.session` during hydration. Firefox MV2 does not have this API. Code gracefully catches the error and skips hydration, but no state is ever loaded from persistent storage.

**Log Evidence:**
```
[2025-12-26T04:23:26.424Z] [LOG] [QuickTabsManager] Reading state from storage.session (key: quick_tabs_state_v2 )
[2025-12-26T04:23:26.424Z] [WARN] [QuickTabsManager] storage.session unavailable
[2025-12-26T04:23:26.424Z] [WARN] [QuickTabsManager] STEP 6: ⚠️ WARNING - State hydration skipped or failed: No stored state found (first run or cleared)
```

**Bugged Behavior:**
- QuickTabsManager initialization explicitly attempts storage.session.get()
- Firefox MV2 throws error (API doesn't exist)
- Code logs warning and continues
- No fallback attempt to read from storage.local
- Hydration is completely skipped
- User gets blank Manager UI even if Quick Tabs existed in previous session
- On every page reload, previous Quick Tabs are not restored

**Architectural Inconsistency:**
Comments in code reference switching to session storage (v1.6.4.18 note), but this API doesn't exist in MV2. Fallback is missing or incomplete.

<scope>
This prevents session state recovery. Every page reload loses all previous Quick Tabs. Single point of failure for hydration path. No recovery mechanism exists.
</scope>

---

### **Issue E: SetWritingTabId Called from Unknown Context**

**Severity:** Medium  
**Evidence:** Log timestamp 2025-12-26T04:23:26.191Z

**Problem:**
During content script initialization, `setWritingTabId()` is called to establish context. However, caller context is identified as "unknown" instead of "content-script".

**Log Evidence:**
```
[2025-12-26T04:23:26.191Z] [WARN] [Storage-Init] setWritingTabId: Called from non-tab context
  callerContext: "unknown"
  tabId: 23
  isValidContext: false
  warning: "Only content scripts and sidebar should set writing tab ID"
  validContexts: ["content-script", "sidebar"]
```

**Bugged Behavior:**
- setWritingTabId() logs warning that context is not recognized
- Warning says "Only content scripts and sidebar should set"
- But this IS content script, yet context marked as unknown
- Validation logic doesn't identify content script context correctly
- Tab ID is still set despite invalid context flag
- State proceeds with warning logged

**Why This Matters:**
The context identification mechanism is broken or incomplete. The code cannot verify it's actually being called from content script even though it is. This could mask genuinely invalid context calls from background or popup scripts.

<scope>
Diagnostic logging is misleading. Actual context is correct, but detection mechanism fails. Could hide real cross-context violations. Indicates incomplete caller stack tracking.
</scope>

---

### **Issue F: Quick Tabs Render Successfully But Never Reach Manager UI**

**Severity:** Critical  
**Evidence:** Log timestamps 2025-12-26T04:23:28.288Z through 04:23:29.482Z

**Problem:**
Three Quick Tabs are created, rendered to DOM, and registered in UICoordinator. All show success. However, no logs exist showing Manager sidebar ever receiving state. Content script shows "Rendered 0 tabs" from Manager perspective.

**Log Evidence:**
```
[2025-12-26T04:23:26.424Z] [LOG] [UICoordinator] Rendering all visible tabs
[2025-12-26T04:23:26.424Z] [LOG] [UICoordinator] Rendered 0 tabs
[2025-12-26T04:23:26.424Z] [LOG] [UICoordinator] Initialized

[2025-12-26T04:23:28.292Z] [UICoordinator] Registered window in renderedTabs from window:created:
  mapSizeAfter: 1
  allMapKeys: ["qt-23-1766723008288-1bun038kqj8ob"]

[2025-12-26T04:23:28.996Z] [UICoordinator] Registered window in renderedTabs from window:created:
  mapSizeAfter: 2
  allMapKeys: [...]

[2025-12-26T04:23:29.393Z] [UICoordinator] Registered window in renderedTabs from window:created:
  mapSizeAfter: 3
  allMapKeys: [...all 3 tabs...]
```

**Bugged Behavior:**
- UICoordinator initializes and logs "Rendered 0 tabs"
- Quick Tabs are created and emit window:created events
- UICoordinator receives events and updates renderedTabs map to size 3
- But UICoordinator initial render happens BEFORE tabs are created
- No re-render is triggered when tabs are added
- Manager UI is never told to refresh
- Manager sidebar displays nothing

**Missing Behavior:**
After tabs are added to renderedTabs map, no render signal sent to Manager UI. UICoordinator should trigger Manager refresh when tab count changes.

<scope>
UI coordinate messaging may be broken. Event emitted correctly, but not propagated to Manager. State synchronization between content script and Manager is one-way only.
</scope>

---

### **Issue G: QUICKTAB_MOVED Message Sent But Position Not Persisted**

**Severity:** High  
**Evidence:** Log timestamps 2025-12-26T04:23:32.397Z

**Problem:**
When user drags a Quick Tab, UpdateHandler sends QUICKTAB_MOVED message to background and schedules persistence. However, persistence fails silently due to ownership filter, leaving position change unsaved.

**Log Evidence:**
```
[2025-12-26T04:23:32.397Z] [LOG] [UpdateHandler] [MOVE_MESSAGE] Sending QUICKTAB_MOVED:
  id: "qt-23-1766723008288-1bun038kqj8ob"
  left: 771
  top: 490

[2025-12-26T04:23:32.397Z] [LOG] [UpdateHandler] [MOVE_MESSAGE] Sent successfully

[2025-12-26T04:23:32.415Z] [LOG] [UpdateHandler] STORAGE_PERSIST_INITIATED:
  mapSize: 3
  timestamp: 1766723012415

[2025-12-26T04:23:32.415Z] [LOG] [StorageUtils] serializeTabForStorage:
  originContainerId: "firefox-default"
```

Then filtering occurs:
```
[Ownership filter rejects all 3 tabs due to container mismatch]
[Empty write rejection blocks persistence]
```

**Bugged Behavior:**
- User drags tab to new position (771, 490)
- DragController.handlePointerUp() calls onPositionChangeEnd
- UpdateHandler receives callback and updates internal map
- UpdateHandler sends QUICKTAB_MOVED message successfully
- UpdateHandler schedules persistence to storage
- But ownership filter blocks write
- Position change never reaches storage
- On Manager, position still shows old location (if Manager was working)

**Inconsistency:**
Message is sent (suggesting operation succeeded) but persistence fails. System is in inconsistent state: content script knows new position, storage doesn't, Manager doesn't.

<scope>
Messaging layer and persistence layer are decoupled. Message delivery success doesn't guarantee state was persisted. Background script may receive move command but content script's storage write fails. Cross-system state inconsistency.
</scope>

---

### **Issue H: Z-Index Recycling Persists But Changes Not Saved**

**Severity:** Medium  
**Evidence:** Log timestamp 2025-12-26T04:23:30.022Z

**Problem:**
VisibilityHandler correctly recycles Z-index values when counter exceeds threshold. Z-index changes are applied to DOM. However, immediately after recycling, the persistence attempt fails due to ownership filter, so Z-index changes are never saved to storage.

**Log Evidence:**
```
[2025-12-26T04:23:30.022Z] [LOG] [VisibilityHandler][Tab 23] Z-INDEX_RECYCLE: Complete
  newCounterValue: 1003
  tabsRecycled: 3

[2025-12-26T04:23:30.022Z] [LOG] [QuickTabWindow][updateZIndex] EXIT:
  domZIndex: "1004"
  verified: true

[Then immediately after...]
[2025-12-26T04:23:30.240Z] [VisibilityHandler] Ownership filter result:
  totalTabs: 3
  ownedTabs: 0
  filteredOut: 3

[2025-12-26T04:23:30.240Z] [WARN] [VisibilityHandler] BLOCKED: Empty write rejected
```

**Bugged Behavior:**
- Z-index recycle logic works correctly
- DOM is updated with new Z-index values
- But storage write never completes
- Manager never receives Z-index updates
- If page reloads, Z-index resets to old values
- Recycling is lost

<scope>
Partially successful operation leaves visual state (DOM) out of sync with persistent state (storage). Z-index continues incrementing, but recycling never persists. Over long sessions, Z-index could overflow again.
</scope>

---

### **Issue I: DestroyHandler Cannot Persist State on Page Unload**

**Severity:** High  
**Evidence:** Log timestamp 2025-12-26T04:23:43.171Z

**Problem:**
When page unloads, DestroyHandler attempts to persist final state to storage so Manager can recover minimized tabs and other state on next page load. This persistence fails silently due to ownership filter.

**Log Evidence:**
```
[2025-12-26T04:23:43.171Z] [DEBUG] [DestroyHandler] Persisting state with 0 tabs
  forceEmpty: false

[2025-12-26T04:23:43.171Z] [WARN] [DestroyHandler] BLOCKED: Empty write rejected (forceEmpty required)
  tabCount: 0
  forceEmpty: false

[2025-12-26T04:23:43.172Z] [ERROR] [DestroyHandler] Storage persist failed or timed out
```

**Bugged Behavior:**
- Page unload event triggers DestroyHandler
- DestroyHandler attempts final persistence (emergency save)
- All tabs filtered out by ownership check
- Empty write rejected
- Final state never written
- On next page load, session state is lost
- Minimized Manager position is lost
- Z-index state is lost

**Why This Matters:**
Emergency save on unload is critical recovery mechanism. Loss of this causes all session state to evaporate on page reload. User loses all Quick Tabs and Manager position.

<scope>
Session recovery completely broken. All state lost on page navigation. User must recreate Quick Tabs from scratch on every page visit. Severely impacts usability.
</scope>

---

## Missing Logging Identified

### **Logging Gap #1: Manager Sidebar Port Connection Lifecycle**

**Expected Behavior:**
Manager sidebar should log:
- Port connection attempt
- Port connection success/failure
- Port message received (with type and size)
- Port message handler entry/exit
- Port disconnect detection
- Reconnection attempts

**Actual Behavior:**
No logs exist showing Manager port lifecycle. Manager initialization, port connection, or message handling never logged. Complete silence from Manager component even though it's successfully initializing.

**Impact:**
Cannot diagnose Manager initialization failures. Cannot determine if port is connected. Cannot see if Manager receives state updates. Cannot track message flow from content script to Manager.

<scope>
Manager is completely unobservable via logs. Diagnostic visibility into sidebar component is zero. Any Manager failure is invisible.
</scope>

---

### **Logging Gap #2: Storage.onChanged Listener Registration and Events**

**Expected Behavior:**
Should log:
- Listener registration (entry/exit)
- Storage.onChanged event fired with changed keys
- Event handler invocation
- State update triggered by storage event
- Fallback path activation if port disconnects

**Actual Behavior:**
No logs show storage.onChanged listener being registered. No logs show storage events being received. Complete reliance on port messaging with no fallback visibility.

**Impact:**
Cannot verify storage listener exists. Cannot confirm storage events are being received. Cannot diagnose if fallback would work if port disconnects. Hidden single point of failure.

<scope>
Storage resilience path is completely unobservable. No way to verify dual-path sync is working.
</scope>

---

### **Logging Gap #3: Port Message Handler Entry and Exit**

**Expected Behavior:**
Each port message handler should log:
- Entry: Message type, timestamp, payload size
- Processing: State changes, decisions made
- Exit: Result, outcome (success/skip/error)
- Handler-specific operations

**Actual Behavior:**
Only message receipt logged. No entry/exit logs for handlers. No logs showing state updates from messages. Silent processing.

**Impact:**
Cannot see which handlers execute for which messages. Cannot see state changes triggered by messages. Cannot debug message ordering or timing issues. Cannot determine if handlers are even being called.

<scope>
Message dispatch is invisible. Cannot debug port communication failures.
</scope>

---

### **Logging Gap #4: Storage Health Monitoring and Heartbeat**

**Expected Behavior:**
Storage health monitor should log:
- Monitor initialization
- Heartbeat sent (timestamp)
- Heartbeat response received (latency)
- Health status (healthy/degraded/failed)
- Storage.getWritingTabId() results

**Actual Behavior:**
Monitor initialized but no subsequent logs. Heartbeats sent but response/latency never logged. Health status never reported.

**Log Evidence:**
```
[2025-12-26T04:23:26.200Z] [LOG] [QuickTabsManager] Storage health monitor: started
[Then silence...]
[2025-12-26T04:23:26.453Z] [LOG] [STORAGE_HEARTBEAT] Received: {\n  \"latencyMs\": 254
```

Only two heartbeat logs in entire session. No regular monitoring logs.

<scope>
Storage health invisible. Cannot determine if storage is functional or degraded. Cannot diagnose storage timeout issues.
</scope>

---

### **Logging Gap #5: Write Queue State and Processing**

**Expected Behavior:**
Should log:
- Write enqueued (handler, timestamp)
- Queue size after enqueue
- Write dequeue started (wait time)
- Write execution (handler, outcome)
- Next write scheduled

**Actual Behavior:**
Enqueue/dequeue logged minimally. No logs showing queue contents, wait times, or processing order. Cannot see if queue is backing up.

<scope>
Cannot diagnose write bottlenecks. Cannot see if multiple handlers are queued. Cannot determine write ordering.
</scope>

---

### **Logging Gap #6: Debounce Timing and Hash Computation**

**Expected Behavior:**
Should log:
- Debounce scheduled (source, ID, delay)
- State hash captured (value, timestamp)
- Debounce fired (actual delay vs scheduled)
- Hash recomputed (value, changed/unchanged)
- Render triggered (source, hash)

**Actual Behavior:**
Debounce scheduling logged but not firing. No hash computation logs. No render trigger logs. Cannot see debounce completion.

**Impact:**
Cannot diagnose double-render issues. Cannot see hash collision if occurs. Cannot verify debounce windows align between components.

<scope>
Render timing is invisible. Cannot debug render performance or hash collision detection.
</scope>

---

### **Logging Gap #7: State Synchronization Between Content Script and Manager**

**Expected Behavior:**
Should log:
- Content script state change (tabs added/removed/modified)
- State serialized to storage
- State sent to Manager (via port or storage)
- Manager received update
- Manager render triggered
- Manager rendered (tab count)

**Actual Behavior:**
Content script logging detailed. Storage logs exist. But no logs showing Manager receiving or processing updates. Manager render count stuck at 0.

**Impact:**
Cannot trace why Manager doesn't update. Cannot determine if state reaches Manager. Cannot see full sync path from creation to rendering.

<scope>
End-to-end state sync is invisible. Cannot diagnose Manager failure to display tabs.
</scope>

---

### **Logging Gap #8: Correlation ID and Request/Response Matching**

**Expected Behavior:**
Every async operation should include correlation ID:
- Port message send → includes correlationId
- Handler processes message → logs correlationId
- Response sent → includes matching correlationId
- Caller receives response → logs correlationId match

**Actual Behavior:**
Some operations have correlation IDs (storage writes), but message correlation missing. Cannot match requests to responses.

<scope>
Cannot trace async operation completion. Cannot determine which response matches which request.
</scope>

---

## Architectural Issues Revealed by Logs

### **Issue Z1: Identity Context Never Reaches CreateHandler**

**Problem:**
Identity system successfully determines correct container (`firefox-container-9`). But CreateHandler never receives this value. Instead, CreateHandler uses stale `options.cookieStoreId` from initialization.

**Root Cause:**
Container context is acquired late in initialization (Identity.READY). But QuickTabsManager options are constructed earlier with stale cookieStoreId. Identity context is never passed forward to CreateHandler.

**Fix Approach:**
Either:
1. Pass Identity context to CreateHandler during creation (synchronous after IDENTITY_READY)
2. Have CreateHandler query Identity system for current container ID instead of using options
3. Update QuickTabsManager options with correct container ID after Identity.READY

**No explicit code changes needed in report.**

---

### **Issue Z2: Ownership Filter Prevents Cross-Container Recovery**

**Problem:**
Ownership filter blocks persistence based on container match. This is correct behavior to prevent cross-container contamination. However, it also blocks legitimate Quick Tabs that were assigned wrong container ID due to Issue A.

**Consequence:**
Fix to Issue A alone is insufficient. Once Quick Tabs have wrong originContainerId, ownership filter will always reject them until they're recreated with correct container ID.

**Fix Approach:**
After fixing Issue A to ensure new Quick Tabs get correct container ID, provide migration path:
1. Detect Quick Tabs with wrong originContainerId on initialization
2. Update originContainerId to current container for orphaned tabs
3. Re-persist with correct container ID
4. Log each migration

---

### **Issue Z3: No Fallback When Port Disconnects**

**Problem:**
All state sync depends on port messaging. No `storage.onChanged` listener exists as fallback. If port disconnects, Manager has no way to receive updates.

**Log Evidence:**
No logs show storage.onChanged being registered. No logs show storage events being monitored. Complete reliance on port.

**Consequence:**
Manager becomes permanently stale if background script restarts or port connection fails. User sees frozen UI with outdated state.

**Fix Approach:**
Add dual-path sync:
1. Register `storage.onChanged` listener for quick_tabs_state changes
2. Log listener registration and all events received
3. Use both port messages (fast) and storage events (reliable) together

---

### **Issue Z4: Session Hydration Strategy Unclear**

**Problem:**
Code attempts to use storage.session (MV2 incompatible). No attempt to read from storage.local as fallback. Session state is never recovered.

**Log Evidence:**
Code skips hydration when storage.session unavailable. No fallback attempt.

**Consequence:**
Every page load loses all previous Quick Tabs. Session is never persistent.

**Fix Approach:**
Clarify storage strategy:
1. **Option A:** Use storage.local as persistent store, add storage.onChanged listener
2. **Option B:** Use port messages for sync only, accept session is ephemeral
3. Remove storage.session references
4. Document chosen approach clearly

---

## Detection Patterns in Logs

### **Pattern 1: Success Log Followed by Silent Failure**
```
[CreateHandler] Quick Tab created successfully: [ID]
[VisibilityHandler] Filtering out [ID] from persist
[Storage] BLOCKED: Empty write rejected
```
Quick Tab creation succeeds but persistence silently fails. User sees success notification but state doesn't persist.

### **Pattern 2: Events Generated But Not Consumed**
```
[UICoordinator] Received window:created event { id: "qt-..." }
[UICoordinator] Registered window in renderedTabs from window:created
[MapSizeAfter: 3]
[Then... no render triggered]
```
Events propagate correctly but no downstream action taken.

### **Pattern 3: Repeated Identical Failures**
```
[04:23:30] BLOCKED: Empty write rejected
[04:23:31] BLOCKED: Empty write rejected
[04:23:43] BLOCKED: Empty write rejected
```
Same error occurs repeatedly, indicating systematic problem not transient failure.

### **Pattern 4: Verification Against Expectations**
```
[CreateHandler] 📦 CONTAINER_CONTEXT:
  originContainerId: "firefox-default"
  [But earlier...]
[IDENTITY_ACQUIRED] Container ID acquired: firefox-container-9
```
Log explicitly shows mismatch, not just observation.

---

## Summary of Behavioral Impact

| Behavior | Impact | Persistence |
|----------|--------|-------------|
| Quick Tabs created and render | User sees tabs appear | DOM only |
| Tabs filtered from persistence | State never written | ✗ Not saved |
| Empty write rejection | Sync blocked | ✗ Blocked |
| Manager receives no updates | Sidebar shows nothing | ✗ Not visible |
| Position changes sent but not saved | Inconsistent state | ✗ Lost on reload |
| Z-index recycled but not saved | Z-index resets on reload | ✗ Lost on reload |
| Session not hydrated | No state recovery | ✗ Lost forever |
| On unload, state not saved | Session lost | ✗ Lost on navigate |

---

## Acceptance Criteria for Fixes

**Verification that Issue A (Container ID Mismatch) is fixed:**
- Log shows CreateHandler receiving container ID from Identity system
- Log shows originContainerId matches currentContainerId for created Quick Tabs
- Log shows ownership filter passes (ownedTabs >= totalTabs)
- Storage write succeeds with tab count > 0

**Verification that Issue B is fixed (cascading effect):**
- Following Issue A fix, persistence succeeds
- Storage.onChanged fires with state update
- Manager receives state update

**Verification that Issue C is fixed (empty write rejection):**
- Empty write rejection logs only appear for intentional empty operations
- forceEmpty: true set for intentional clears
- Only rejected writes are truly invalid (non-owner operations)

**Verification that Issue D is fixed (storage.session):**
- No storage.session references in code
- Fallback to storage.local or port-based sync documented
- Hydration logs show successful state recovery

**Verification that logging gaps are closed:**
- Manager port lifecycle fully logged
- Storage.onChanged listener registered and events logged
- Port message handlers log entry/exit
- Write queue state logged
- State sync path visible from creation to Manager render

**Manual test:**
- Create 3+ Quick Tabs
- Open Manager sidebar
- All tabs visible
- Drag tab to new position
- Position saved on next focus
- Refresh page
- All tabs restored
- Manager displays all tabs

---

**Priority:** Critical (Issues A, B, C), High (Issues D, G, H, I), Medium (Issues E, F, Z1-Z4)

**Estimated Impact:** Complete Manager UI failure due to cascading failures from Issue A

**Root Cause Hierarchy:** Issue A → Issue B → Issue C → Manager UI failure

**Regression Risk:** Low (fixes are additive, mostly initialization and logging changes)

