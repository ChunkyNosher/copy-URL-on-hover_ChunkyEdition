# Quick Tabs Restore Operation - Multiple Critical Failures

**Extension Version:** v1.6.3.5-v9  
**Date:** 2025-12-03  
**Scope:** Restored Quick Tabs lose functionality, cross-tab scoping broken,
storage corruption

---

## Executive Summary

Quick Tabs that are minimized and then restored suffer from **three critical
architectural failures** that prevent core functionality from working. After
restore, lifecycle callbacks are not wired to handlers, preventing position/size
updates from persisting. Additionally, UICoordinator's `currentTabId` is null,
completely bypassing single-tab scoping and allowing Quick Tabs to render across
all browser tabs. These issues stem from UICoordinator's restore path creating
fresh instances without proper initialization, and content scripts lacking tab
ID awareness.

Storage corruption from cross-tab writes creates a 2→0→2→0 oscillation during
every operation, further destabilizing state persistence.

## Issues Overview

| #   | Issue                                         | Component                       | Severity     | Root Cause                                                      |
| --- | --------------------------------------------- | ------------------------------- | ------------ | --------------------------------------------------------------- |
| 1   | Position/size updates stop after restore      | UICoordinator/UpdateHandler     | **Critical** | Callbacks not passed to `createQuickTabWindow()` during restore |
| 2   | Z-index broken - restored tab behind new tabs | UICoordinator/VisibilityHandler | **Critical** | `onFocus` callback not wired + z-index set before appendChild   |
| 3   | Cross-tab scoping completely bypassed         | UICoordinator initialization    | **Critical** | `currentTabId = null` triggers fallback allowing all renders    |
| 4   | Storage corruption from other tabs            | Content scripts (all tabs)      | High         | Other tabs write empty state during restore operations          |

**Why bundled:** All issues stem from UICoordinator's restore path bypassing
normal initialization. Issues #1 and #2 are callback wiring failures. Issue #3
is missing tab ID initialization. Issue #4 is architectural (all tabs write to
shared storage). Can be fixed in coordinated effort.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` - `_createWindow()` to pass callbacks, constructor to accept currentTabId, `_shouldRenderOnThisTab()` logging
- `src/features/quick-tabs/managers/QuickTabsManager.js` - Initialize UICoordinator with currentTabId, expose callback wiring for restore
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Add z-index application AFTER restore completes
- `src/features/quick-tabs/window.js` - Apply z-index after appendChild, not before
- `src/content.js` - Obtain tab ID via message passing, pass to QuickTabsManager initialization

**Do NOT Modify:**

- `src/features/quick-tabs/window/DragController.js` - Event wiring is correct
- `src/features/quick-tabs/window/ResizeController.js` - Event wiring is correct
- `src/features/quick-tabs/handlers/UpdateHandler.js` - Callback handlers are
  correct
- Storage write queue implementation - Working as designed </scope>

---

## Issue #1: Position and Size Updates Stop Working After Restore

### Problem

After restoring a minimized Quick Tab, dragging or resizing the window no longer
persists changes to storage. The window moves/resizes visually but Manager UI
does not update, and changes revert after page reload.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_createWindow()` method (called during restore path)  
**Issue:** The options object passed to `createQuickTabWindow()` does **not
include** lifecycle callbacks (`onPositionChangeEnd`, `onSizeChangeEnd`,
`onFocus`) that connect DragController/ResizeController to UpdateHandler and
VisibilityHandler.

**Evidence from logs (timestamp 03:59:56.353):**

```
UICoordinator: Creating new window instance qt-629-1764820788407-1t3f7wc1mswtxp
UICoordinator: Creating window from entity
<NO "Tab options" log - callbacks NOT passed>
```

Compare to initial creation (timestamp 03:59:48.407):

```
CreateHandler: Tab options id qt-629-1764820788407-1t3f7wc1mswtxp,
  onPositionChangeEnd: function,
  onSizeChangeEnd: function,
  onFocus: function,
  originTabId: 629
```

**Behavioral evidence - 4 drag operations after restore:**

```
03:59:58.660 - QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler NEVER logs "handlePositionChangeEnd called">

03:59:59.347 - QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler NEVER logs "handlePositionChangeEnd called">

04:00:02.266 - QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler NEVER logs "handlePositionChangeEnd called">

04:00:04.750 - QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler NEVER logs "handlePositionChangeEnd called">
```

Result: **0/4 drag operations persisted** for restored Quick Tab.

Compare to non-restored Quick Tab (same session):

```
04:00:00.484 - UpdateHandler: handlePositionChangeEnd called - left 291, top 325
04:00:01.187 - UpdateHandler: handlePositionChangeEnd called - left 59, top 356
04:00:03.258 - UpdateHandler: handlePositionChangeEnd called - left 696, top 811
```

Result: **3/3 drag operations persisted** for non-restored Quick Tab.

**Architecture gap:**  
UICoordinator builds options object from QuickTab entity during restore. Entity
contains data fields (id, url, position, size) but does NOT contain callback
function references. QuickTabWindow constructor falls back to no-op functions
when callbacks are missing.

### Fix Required

Wire callbacks during restore by one of two approaches:

**Approach A:** Modify `UICoordinator._createWindow()` to include callbacks in
options object. Callbacks should reference the same UpdateHandler and
VisibilityHandler instances used during initial creation.

**Approach B:** After creating fresh instance via `_createWindow()`, re-wire
callbacks by emitting event that QuickTabsManager handles, setting callbacks
directly on the new QuickTabWindow instance.

**Reference pattern:** Existing code in `CreateHandler.create()` where callbacks
are passed to `createQuickTabWindow()`. The same callback references must be
used during restore. QuickTabsManager likely has access to UpdateHandler and
VisibilityHandler instances that should be bound to callbacks.

---

## Issue #2: Restored Quick Tab Appears Behind New Tabs (Z-Index Broken)

### Problem

After restoring a minimized Quick Tab, it appears visually **behind** Quick Tabs
created after the restore operation, even though it has a numerically higher
z-index value. User cannot interact with restored tab because it's hidden behind
others.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js` and
`src/features/quick-tabs/window.js`  
**Location:** Z-index application during restore + missing focus callback  
**Issue:** Two-part failure.

**Part A - Z-index set before appendChild:**

From logs (timestamp 03:59:56.353):

```
UICoordinator: Creating window from entity, zIndex = 1000008
QuickTabWindow: DOM dimensions AFTER createElement ... zIndex 1000008
QuickTabWindow: Rendered (appendChild happens here)
```

Z-index set on element's inline style **before** `document.body.appendChild()`
is called. Mozilla DOM documentation indicates setting styles before element is
in DOM tree may not take effect reliably in all browsers, particularly for
z-index which affects stacking context.

**Part B - onFocus callback not wired:**

Non-restored Quick Tab logs show:

```
QuickTabWindow: Bringing to front via onFocus callback qt-629-1764820786743-agkuza1yw0d5y
VisibilityHandler: Bringing to front qt-629-1764820786743-agkuza1yw0d5y
VisibilityHandler: debouncedPersist scheduling (focus operation)
```

Every drag triggers explicit z-index bump and storage persist.

Restored Quick Tab logs show:

```
QuickTabWindow: Bringing to front via onFocus callback qt-629-1764820788407-1t3f7wc1mswtxp
<VisibilityHandler NEVER logs "Bringing to front">
```

QuickTabWindow invokes `onFocus` callback but VisibilityHandler never receives
it. Without explicit z-index increment on interaction, restored tab's z-index
becomes stale.

**Evidence of z-index values:**

```
Quick Tab #1 (created first): z-index 1000001
Quick Tab #2 (restored): z-index 1000008

1000008 > 1000001 → should be in front
BUT user reports it appears behind
```

**Additional finding:** VisibilityHandler sets z-index during restore (1000007),
then UICoordinator immediately overrides to 1000008, but there's no explicit
front-bringing operation after override.

### Fix Required

**Part A:** Ensure z-index is applied AFTER element is appended to DOM. Modify
QuickTabWindow.render() to set `container.style.zIndex` after
`document.body.appendChild(container)` call.

**Part B:** Wire `onFocus` callback during restore (same fix as Issue #1).
Callback should point to `VisibilityHandler.handleFocus`.

**Part C:** Add explicit bring-to-front operation after restore completes. After
UICoordinator finishes rendering, VisibilityHandler should trigger a focus event
or directly increment z-index and apply to container.

**Reference:** Existing focus handling in VisibilityHandler.handleFocus() where
z-index is incremented and storage persisted. Same pattern should execute
immediately after restore render completes, not just during user interaction.

---

## Issue #3: Cross-Tab Scoping Completely Bypassed (Quick Tabs Render Everywhere)

### Problem

Quick Tabs appear in all browser tabs regardless of which tab they were created
in. The single-tab architecture (introduced in v1.6.3 to replace buggy cross-tab
sync) is completely bypassed. User sees Quick Tabs rendering in tabs where they
don't belong.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** Constructor initialization (currentTabId never set)  
**Issue:** UICoordinator's `currentTabId` property is `null`, causing
`_shouldRenderOnThisTab()` to hit fallback path that allows ALL renders
regardless of `originTabId`.

**Smoking gun evidence (timestamp 03:59:56.353):**

```
UICoordinator: No currentTabId set, allowing render qt-629-1764820788407-1t3f7wc1mswtxp
```

This log appears during restore operation, proving `this.currentTabId === null`.

**Evidence #2 - Cross-tab blocking NEVER triggers:**

Searched entire log file for "CROSS-TAB BLOCKED" warning message.  
**Result: ZERO instances found.**

This message should appear when a Quick Tab from a different tab is blocked from
rendering. It never appears because the check never rejects a render.

**Architecture analysis:**

UICoordinator constructor likely has signature:

```javascript
constructor(
  stateManager,
  minimizedManager,
  panelManager,
  eventBus,
  (currentTabId = null)
);
```

If `currentTabId` parameter not passed during initialization, it defaults to
`null`.

Then `_shouldRenderOnThisTab()` logic:

```javascript
if (this.currentTabId === null) {
  console.log('No currentTabId set, allowing render');
  return true; // Fallback - allows rendering ANYWHERE
}

return originTabId === this.currentTabId; // Actual check (never reached)
```

**Why this is broken:**

CreateHandler logs show both `originTabId` and `currentTabId` during Quick Tab
creation:

```
CreateHandler: Creating Quick Tab with options
  originTabId: 629
  currentTabId: 629
```

This proves `currentTabId` value is available during QuickTabsManager
initialization, but is NOT being passed to UICoordinator constructor.

**How content scripts should obtain tab ID (from Mozilla MDN documentation):**

Content scripts CANNOT call `browser.tabs.getCurrent()` - it returns
`undefined`.

Correct approach:

```javascript
// Background script or service worker sends message with tab ID
browser.runtime.onMessage.addListener((message, sender) => {
  const currentTabId = sender.tab.id; // Available from sender object
  // Send to content script or use during initialization
});
```

Content script must receive tab ID via message passing, then pass it to
QuickTabsManager initialization, which passes it to UICoordinator.

### Fix Required

**Step 1:** Modify content script initialization to obtain current tab ID.

Approach: Content script sends message to background script on load. Background
script replies with `sender.tab.id`. Content script stores tab ID.

**Step 2:** Pass currentTabId to QuickTabsManager during initialization.

Modify QuickTabsManager constructor or initialization method to accept
`currentTabId` parameter.

**Step 3:** Pass currentTabId to UICoordinator during construction.

Modify QuickTabsManager where it instantiates UICoordinator:

```javascript
this.uiCoordinator = new UICoordinator(
  this.stateManager,
  this.minimizedManager,
  this.panelManager,
  this.eventBus,
  currentTabId // Pass the tab ID here
);
```

**Reference:** Mozilla documentation on browser.runtime.onMessage sender object
and tab ID retrieval. Existing CreateHandler code shows `currentTabId` is
available at some point - need to trace where it comes from and ensure it
reaches UICoordinator.

---

## Issue #4: Storage Corruption from Cross-Tab Writes

### Problem

During restore and other operations, at least 6 other browser tab instances
write empty state (`{tabs: 0}`) to storage, creating an oscillation where state
alternates between valid and empty multiple times per second. Manager UI may
briefly show incorrect state, and restore operations risk reading empty state
during critical operations.

### Root Cause

**File:** Content scripts across all browser tabs  
**Location:** Storage event listeners in every tab  
**Issue:** When any tab writes to `browser.storage.local`, `storage.onChanged`
event fires in **all other tabs**. Those tabs have empty `quickTabsMap` (no
Quick Tabs), so they build state from their empty Map and write it back to
storage, overwriting the valid state.

**Evidence from logs (timestamp 03:59:56.533 to 03:59:57.665):**

At least 6 different `writingInstanceId` values writing `{tabs: 0}` within 1
second:

```
writingInstanceId: inst-1764820761061 → {tabs: 0}
writingInstanceId: inst-1764820761082 → {tabs: 0}
writingInstanceId: inst-1764820761080 → {tabs: 0}
writingInstanceId: inst-1764820761084 → {tabs: 0}
writingInstanceId: inst-1764820761081 → {tabs: 0}
writingInstanceId: inst-1764820761083 → {tabs: 0}
```

**Background script logs:**

```
Background: tabs 2 → 0 ⚠️ WARNING: Tab count dropped from 2 to 0!
Background: DEFERRED Zero-tab read (waiting for confirmation)
Background: tabs 0 → 2 (restored from cache)
Background: tabs 2 → 0 ⚠️ WARNING: Tab count dropped from 2 to 0!
Background: REJECTED Clear within cooldown period
```

Cooldown mechanism prevents complete data loss but cannot stop oscillation
cycle.

**Architecture flow:**

1. Tab 629 (active tab) creates Quick Tab → writes to storage
2. `storage.onChanged` fires in ALL content script instances (all open tabs)
3. Tab 641, 650, 655, etc. receive event → check local `quickTabsMap` → find
   nothing
4. Other tabs build state from empty Map → `{tabs: 0, saveId: <new>}`
5. Other tabs write empty state to storage
6. Cycle repeats

**Impact:**

- State unstable for 1-2 seconds after every operation
- Manager may briefly display incorrect tab count
- Restore operations may read empty state if timing is unlucky
- Background script must maintain cooldown and cache to prevent total loss

### Fix Required

Implement per-tab storage keys architecture:

Each content script instance writes to tab-specific key:
`quick_tabs_tab_${tabId}` instead of shared `quick_tabs_state_v2`.

Manager aggregates state by reading all `quick_tabs_tab_*` keys.

This eliminates cross-tab write conflicts entirely - each tab owns its storage
key.

**Interim fix (less robust):** Add `writingTabId` to stored data structure.
Content scripts check if `writingTabId === currentTabId` before reacting to
storage changes. If IDs don't match, ignore the change instead of rebuilding and
re-writing state.

**Reference:** Mozilla storage API documentation on `storage.onChanged`
behavior. Event fires in all extension contexts, so extension must implement
coordination to prevent write loops.

---

## Shared Implementation Notes

**Callback Wiring Architecture:**

Normal creation flow (working):

```
QuickTabsManager.createQuickTab()
  → CreateHandler.create()
    → createQuickTabWindow({
        onPositionChangeEnd: this.updateHandler.handlePositionChangeEnd.bind(...),
        onSizeChangeEnd: this.updateHandler.handleSizeChangeEnd.bind(...),
        onFocus: this.visibilityHandler.handleFocus.bind(...),
        ...
      })
```

Restore flow (BROKEN):

```
VisibilityHandler.handleRestore()
  → QuickTabWindow.restore() (sets minimized = false, defers render)
    → UICoordinator.update() (receives state:updated event)
      → UICoordinator._handleRestoreOperation()
        → UICoordinator._createWindow(quickTab)
          → createQuickTabWindow({
              id: quickTab.id,
              url: quickTab.url,
              // Callbacks NOT included!
            })
```

**Critical gap:** QuickTab entity object does not store callback function
references. Callbacks wired during initial creation by QuickTabsManager, but
entity only stores data (id, url, position, size). When UICoordinator builds
options from entity during restore, callbacks are missing.

**Solution approaches:**

A. Store callback references in separate Map keyed by Quick Tab ID.
UICoordinator looks up callbacks and includes them in options.

B. UICoordinator emits event after creating fresh instance. QuickTabsManager
listens and re-wires callbacks to new instance.

C. Pass UpdateHandler and VisibilityHandler references to UICoordinator
constructor. During `_createWindow()`, UICoordinator builds callback options
directly from handler methods.

**Recommended:** Approach C - cleanest architecture, handlers are already
dependencies.

**Tab ID Acquisition Pattern:**

Content scripts cannot directly determine their tab ID. Must use message
passing:

```
Content script sends initialization message to background:
  browser.runtime.sendMessage({type: 'CONTENT_SCRIPT_INIT'})

Background script receives message:
  browser.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab.id;
    // Reply with tab ID or store for later use
  })
```

Alternative: Background script injects content script programmatically and
passes tab ID as parameter. This requires restructuring injection mechanism.

**Z-Index Front-Bringing Pattern:**

Working pattern from non-restored Quick Tabs:

```
1. User interaction (drag starts) → onFocus callback invoked
2. VisibilityHandler.handleFocus() executes
3. Z-index incremented: this.currentZIndex.value++
4. Z-index applied: tabWindow.container.style.zIndex = newValue
5. Storage persisted (debounced)
```

This explicit z-index bump happens **every time** user interacts with
non-restored tab.

Restored tabs skip step 2-4 because onFocus callback not wired, so z-index set
once at restore time and never updated during interaction.

**Storage Write Coordination:**

Current architecture: All content script instances write to
`quick_tabs_state_v2`.

Problem: No coordination mechanism prevents simultaneous writes from different
tabs.

Solutions:

- **Per-tab keys:** Each tab writes to its own key, eliminating conflicts
- **Write ownership:** Only tab with `currentTabId` matching
  `quickTab.originTabId` can write
- **Debounced aggregation:** Manager reads from all tabs, aggregates, then
  broadcasts read-only snapshot

<acceptancecriteria>
**Issue #1 - Position/Size Updates:**
- Drag restored Quick Tab → UpdateHandler.handlePositionChangeEnd logged
- Resize restored Quick Tab → UpdateHandler.handleSizeChangeEnd logged
- Position and size persist to storage immediately after operation
- Manager UI updates position and size indicators in real-time
- Position and size preserved after page reload

**Issue #2 - Z-Index:**

- Restored Quick Tab appears visually in front of older tabs
- Z-index value matches visual stacking order
- Dragging restored tab brings it to front (VisibilityHandler.handleFocus
  logged)
- Z-index incremented on every interaction
- No visual flickering during restore

**Issue #3 - Cross-Tab Scoping:**

- Quick Tab only renders in tab where it was created
- "CROSS-TAB BLOCKED" log appears when attempting cross-tab render
- UICoordinator logs show valid currentTabId at initialization
- Cross-tab check executes for every render decision
- Quick Tabs do NOT appear in split-screen viewports of different tabs

**Issue #4 - Storage Corruption:**

- Other tabs do NOT write to storage when they have no Quick Tabs
- No oscillation cycles (2→0→2→0) during restore or any operation
- State remains stable throughout restore operation
- Background script does NOT log "Tab count dropped" warnings
- Manager UI never displays incorrect tab count

**All Issues:**

- All existing tests pass
- No new console errors or warnings
- Manual test sequence works identically for restored vs. non-restored tabs:
  1. Create Quick Tab → minimize → restore → drag → resize → reload
  2. All operations persist correctly
  3. Manager UI updates in real-time for all operations
  4. Callbacks logged for every operation (position, size, focus)
- No performance degradation from callback wiring or tab ID checks
  </acceptancecriteria>

---

**Priority:** Critical (Issues #1, #2, #3), High (Issue #4)  
**Target:** Fix all in coordinated PR (shared root cause)  
**Estimated Complexity:** Medium-High - architectural fixes required, not just
patches

---

## Supporting Context

<details>
<summary>Issue #1 - Log Timeline (Restored vs. Non-Restored Comparison)</summary>

**Restored Quick Tab #2 - Drag Operation #1:**

```
03:59:57.775 - QuickTabWindow: Drag started (260, 405)
03:59:57.775 - QuickTabWindow: Bringing to front via onFocus callback
03:59:58.660 - QuickTabWindow: Drag ended (703, 693)
03:59:58.660 - QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler.handlePositionChangeEnd NOT logged>
<Storage write NOT logged>
```

**Restored Quick Tab #2 - Drag Operation #2:**

```
03:59:59.210 - QuickTabWindow: Drag started (703, 693)
03:59:59.347 - QuickTabWindow: Drag ended (781, 703)
03:59:59.347 - QuickTabWindow: Calling onPositionChangeEnd callback
<UpdateHandler.handlePositionChangeEnd NOT logged>
<Storage write NOT logged>
```

**Non-Restored Quick Tab #1 - Drag Operation (same session):**

```
04:00:00.038 - QuickTabWindow: Drag started (291, 325)
04:00:00.483 - QuickTabWindow: Drag ended (291, 325)
04:00:00.484 - QuickTabWindow: Calling onPositionChangeEnd callback
04:00:00.484 - UpdateHandler: handlePositionChangeEnd called - left 291, top 325 ✓
04:00:00.484 - UpdateHandler: Updated tab position in Map ✓
04:00:00.662 - UpdateHandler: Storage write COMPLETED ✓
```

**Result:** Callback chain works for non-restored tabs, completely fails for
restored tabs.

</details>

<details>
<summary>Issue #2 - Z-Index Timeline and Override Sequence</summary>

**Restore operation z-index sequence:**

```
T+0.000s (03:59:56.302):
  VisibilityHandler: Updated z-index for restored tab, newZIndex = 1000007

T+0.051s (03:59:56.353):
  UICoordinator: Creating window from entity, zIndex = 1000008

T+0.003s (03:59:56.356):
  QuickTabWindow: DOM dimensions AFTER createElement ... zIndex 1000008

T+0.004s (03:59:56.357):
  QuickTabWindow: Rendered (appendChild executed here)

T+0.005s (03:59:56.362):
  QuickTabWindow: DOM dimensions AFTER position correction ... zIndex 1000008
```

**Analysis:**

- VisibilityHandler sets z-index = 1000007
- UICoordinator overrides to 1000008 (higher value - correct)
- Z-index applied to style **before** appendChild
- No explicit focus operation after render completes

**Expected behavior:**

```
1. Create container element
2. appendChild(container)  ← Add to DOM first
3. container.style.zIndex = newValue  ← Then apply z-index
4. Trigger focus event or DOM reflow
```

</details>

<details>
<summary>Issue #3 - Cross-Tab Check Execution (Never Blocks)</summary>

**Expected log when cross-tab blocking works:**

```
UICoordinator: CROSS-TAB BLOCKED: Quick Tab belongs to different tab
  id: qt-629-...
  originTabId: 629
  currentTabId: 641
  renderAllowed: false
```

**Actual - Log search results:**

```
Search query: "CROSS-TAB BLOCKED"
Results: 0 matches in 709 total logs
```

**Conclusion:** Cross-tab check NEVER rejects a render during entire session.

**Fallback path evidence:**

```
03:59:56.353 - UICoordinator: No currentTabId set, allowing render qt-629-...
```

This is the fallback log when `this.currentTabId === null`. Appears during
restore, proving currentTabId was never initialized.

</details>

<details>
<summary>Issue #4 - Storage Oscillation Cycle (Timestamps)</summary>

**Full oscillation sequence (03:59:56.533 to 03:59:57.665):**

```
T+0.0s - Valid state exists (2 tabs)
  Background: Updated global state - 2 tabs

T+0.2s - Other tab writes empty state
  Background: tabs 2 → 0
  Background: ⚠️ WARNING: Tab count dropped from 2 to 0!
  writingInstanceId: inst-1764820761061

T+0.5s - Original tab writes valid state back
  VisibilityHandler: Storage write COMPLETED (2 tabs)
  writingInstanceId: inst-1764820767500

T+0.6s - Background restores from cache
  Background: tabs 0 → 2

T+1.0s - Another different tab writes empty state
  Background: tabs 2 → 0
  Background: ⚠️ WARNING: Tab count dropped!
  writingInstanceId: inst-1764820761082
  Background: REJECTED Clear within cooldown

T+1.1s - Yet another tab writes empty state
  writingInstanceId: inst-1764820761080

T+1.2s - Another tab
  writingInstanceId: inst-1764820761084

T+1.3s - Another tab
  writingInstanceId: inst-1764820761081

T+1.4s - Another tab
  writingInstanceId: inst-1764820761083
```

**Pattern:** Each `writingInstanceId` represents a different browser tab's
content script. All have empty local state, so they write `{tabs: 0}` when
storage.onChanged fires. Creates cascading write storm.

</details>

<details>
<summary>Mozilla MDN Documentation References</summary>

**browser.tabs.getCurrent() - Limitations:**

From MDN
(https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/getCurrent):

> "Get a tabs.Tab object containing information about the tab that the script is
> running in."
>
> "Note: This function is only useful in contexts where a tab is present. For
> example, it works in popups, sidebars, and options pages, but not in
> background scripts or content scripts."

Content scripts return `undefined` when calling `browser.tabs.getCurrent()`.

**browser.runtime.onMessage sender.tab - Tab ID Access:**

From MDN
(https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage):

> "sender: Information about the script that sent the message." "sender.tab: The
> tabs.Tab object which sent the message, if it was sent from a tab."
> "sender.tab.id: The tab's ID."

This is the correct way for content scripts to learn their tab ID.

**storage.onChanged - Event Behavior:**

From Mozilla storage API documentation:

> "Fired when one or more items change in a storage area." "The
> storage.onChanged event fires in all extension contexts (background, popups,
> content scripts, options pages) when storage changes occur."

All content script instances receive the event, regardless of which tab caused
the change.

**DOM Element z-index - Stacking Context:**

From MDN (https://developer.mozilla.org/en-US/docs/Web/CSS/z-index):

> "The z-index property sets the z-order of a positioned element and its
> descendants." "For a positioned box, the z-index property specifies the stack
> level of the box in the current stacking context."

Setting z-index before element is in DOM may not establish proper stacking
context in all browsers. Recommended to appendChild first, then apply z-index.

</details>

---

**Note to Copilot Agent:** All log timestamps are from actual extension
execution logs. The "CRITICAL" finding that callbacks are not wired is proven by
the complete absence of UpdateHandler logs after restore, despite QuickTabWindow
explicitly logging that it's calling the callbacks. The currentTabId=null
finding is proven by the explicit log message "No currentTabId set, allowing
render" which only appears when the fallback path executes.
