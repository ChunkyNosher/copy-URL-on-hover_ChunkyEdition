# Quick Tab State Synchronization Critical Bugs

**Extension Version:** v1.6.3.5  
**Date:** 2025-12-02  
**Scope:** Multiple state corruption, cross-tab contamination, and persistence failures

---

## Executive Summary

The Quick Tab system has catastrophic state synchronization failures after minimize-restore operations. Five critical bugs create cascading failures: storage corruption that wipes all Quick Tab state, cross-tab contamination causing Quick Tabs to appear on wrong tabs, event handler detachment preventing position/size updates, UI-storage desynchronization creating "ghost" Quick Tabs, and duplicate Quick Tab creation. These issues stem from misunderstanding Firefox's `browser.storage.onChanged` behavior (fires on ALL tabs), missing tab-scoping in storage state, premature snapshot clearing, and Map desynchronization. Additionally, extensive logging gaps prevent diagnosis of tab activation, storage change origins, and state transitions.

### Issues Overview

| # | Issue | Component | Severity | Root Cause |
|---|-------|-----------|----------|------------|
| 1 | Storage corruption after restore | VisibilityHandler/UICoordinator | **Critical** | Empty state write after clearSnapshot |
| 2 | Quick Tabs appear on wrong tabs | Content script storage listeners | **Critical** | storage.onChanged fires all tabs, no tab-scoping |
| 3 | Position/size stops updating | UpdateHandler/DragController | **High** | Event handlers not rewired after restore |
| 4 | Manager list clears without DOM removal | UICoordinator/DestroyHandler | **High** | renderedTabs Map out of sync with state |
| 5 | Duplicate Quick Tabs on restore | UICoordinator/MinimizedManager | **High** | Multiple restore transactions for same ID |
| 6 | Yellow indicator without DOM hiding | VisibilityHandler/Manager UI | **Medium** | Minimize via Manager doesn't update DOM |
| 7 | Missing critical logging | All components | **High** | No tab activation, storage source tracking |

**Why bundled:** All issues affect Quick Tab state visibility and synchronization, share storage architecture context, introduced when v1.6.3 removed cross-tab sync coordinator, can be addressed in coordinated fix.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - clearSnapshot, minimize/restore flows
- `src/features/quick-tabs/handlers/UpdateHandler.js` - handlePositionChangeEnd, handleSizeChangeEnd
- `src/features/quick-tabs/core/UICoordinator.js` - renderedTabs Map management, restore logic
- `src/features/quick-tabs/core/MinimizedManager.js` - snapshot lifecycle
- `src/features/quick-tabs/QuickTabsManager.js` - storage state structure, tab-scoping
- `src/content.js` - storage.onChanged listener, tab ID filtering
- All logging calls - add tab ID context, storage change source tracking

**Do NOT Modify:**
- `src/background.js` - cooldown system working correctly
- `.github/` - configuration out of scope
</scope>

---

## Issue #1: Storage Corruption Cascade After Restore

### Problem
After restoring a minimized Quick Tab, the entire Quick Tab storage state is wiped (tab count drops from 2+ to 0), causing all Quick Tabs to disappear from the Manager list while DOM elements remain on screen. This triggers 14+ rapid empty storage writes within 300ms, completely corrupting the state.

### Root Cause

**File:** `src/features/quick-tabs/core/UICoordinator.js` and `src/features/quick-tabs/handlers/VisibilityHandler.js`

**Location:** `clearSnapshot` method and restore completion flow

**Issue:** After a Quick Tab is successfully restored (DOM verified at `17:29:34.906`), `clearSnapshot` is called. However, 200ms later (`17:29:35.106`), storage tab count drops from 2 to 0, triggering cascading empty storage writes. The sequence shows:
1. Restore completes, UICoordinator calls `clearSnapshot`
2. Something writes empty state (`{tabs: [], minimizedTabs: []}`) to storage
3. Storage.onChanged fires with 0 tabs, triggering recursive state updates
4. 14+ empty storage writes occur within 300ms
5. Cache is completely cleared at `17:29:35.987`
6. All subsequent operations fail because state is empty

The root cause appears to be either:
- `clearSnapshot` inadvertently triggers empty state write
- Snapshot clearing happens before restore state is persisted
- Async race condition between clearSnapshot and storage persistence

**Log Evidence:**
```
17:29:34.906 - clearSnapshot called but no snapshot found (id: qt-20-1764696568730-p1t9xh1xbf9js)
17:29:35.106 - WARNING State change totalTabs 2 -> 0
17:29:35.162 - Storage write STARTED (0 tabs)
17:29:35.162 - Storage write STARTED (0 tabs) [repeated 14 times]
17:29:35.987 - Cache cleared with 0 tabs
```

### Fix Required

The restore completion flow must ensure storage state is persisted BEFORE clearSnapshot is called. Add transaction sequencing to guarantee:
1. Quick Tab restored to DOM (already working)
2. Updated state (with restored Quick Tab) written to storage
3. Storage write confirmed completed
4. THEN clearSnapshot called to remove snapshot

Additionally, clearSnapshot should verify storage state is non-empty before proceeding, and should never trigger storage writes itself.

---

## Issue #2: Quick Tabs Appear on Wrong Tabs (Cross-Tab Contamination)

### Problem
After restoring a Quick Tab on Tab A, that Quick Tab also appears on Tabs B, C, D, even though cross-tab sync was intentionally removed in v1.6.3. Quick Tabs should only exist on their originating tab unless explicitly soloed/muted to other tabs.

### Root Cause

**File:** `src/content.js` (and any content script with storage.onChanged listener)

**Location:** `browser.storage.onChanged` listener

**Issue:** Per Mozilla documentation, `browser.storage.onChanged` fires in **ALL tabs and contexts** whenever ANY tab modifies storage. This is by design for Firefox WebExtensions. When Tab A restores a Quick Tab and updates storage, the `onChanged` event fires in Tabs B, C, D. If content scripts lack tab-scoping logic, they ALL attempt to render the Quick Tab.

The Quick Tab storage state does not include a `tabId` field or tab-scoping mechanism. When `storage.onChanged` fires, all tabs read the same global state and render all Quick Tabs. Without filtering by tab ID, every tab thinks it should display every Quick Tab.

**Per MDN:** "The `storage.onChanged` event is fired when a storage area is changed. This is a global event that fires in all contexts (background scripts, content scripts, popup scripts) of an extension." (Source: [Mozilla Web Docs - storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged))

### Fix Required

The storage state structure must include tab-scoping information for each Quick Tab. Add `originTabId` field to each Quick Tab's storage entry to track which tab created it. In the `storage.onChanged` listener, compare `originTabId` with current tab's ID using `browser.tabs.getCurrent()` before rendering. Only render Quick Tabs that:
- Match the current tab's ID (originTabId === currentTabId)
- Are explicitly soloed to the current tab (soloedOnTabs includes currentTabId)
- Are NOT muted on the current tab (mutedOnTabs excludes currentTabId)

This requires architectural changes to:
1. Storage state schema to include `originTabId` per Quick Tab
2. Content script storage.onChanged handler to get current tab ID and filter
3. QuickTabsManager createQuickTab flow to capture originating tab ID

---

## Issue #3: Position/Size Stops Updating After Minimize-Restore

### Problem
After a Quick Tab is minimized and then restored, dragging and resizing the Quick Tab no longer persists to storage. The DOM updates locally (visual feedback works), but the Manager never reflects new position/size values. The Quick Tab becomes "orphaned" from the storage sync system.

### Root Cause

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`, `src/features/quick-tabs/QuickTabWindow.js`

**Location:** `handlePositionChangeEnd` and `handleSizeChangeEnd` callbacks, DragController/ResizeController wiring

**Issue:** Before minimize-restore, position changes are logged via `handlePositionChangeEnd` (e.g., `17:29:32.055 handlePositionChangeEnd left 645, top 222`). After restore at `17:29:34.750`, the Quick Tab is dragged multiple times (`17:29:37.787`, `17:29:40.047`), but NO `handlePositionChangeEnd` logs appear. The callbacks are not being invoked.

This indicates the DragController and ResizeController's callbacks to UpdateHandler are not properly re-wired during the restore process. When UICoordinator creates a "new window instance" for restore (logged at `17:29:34.750`), it appears to create a fresh QuickTabWindow but fails to reconnect the event handlers that UpdateHandler relies on.

**Log Evidence:**
```
17:29:32.055 - handlePositionChangeEnd (left: 645, top: 222) [BEFORE restore]
17:29:34.750 - UICoordinator creating new window instance for restore
[No handlePositionChangeEnd logs after this point despite drag events]
```

### Fix Required

The restore flow in UICoordinator must re-establish the callback chain between QuickTabWindow's DragController/ResizeController and UpdateHandler. When creating a new window instance during restore, explicitly wire callbacks:
1. QuickTabWindow.onPositionChangeEnd → UpdateHandler.handlePositionChangeEnd
2. QuickTabWindow.onSizeChangeEnd → UpdateHandler.handleSizeChangeEnd
3. QuickTabWindow.onFocus → VisibilityHandler.bringToFront

Follow the same callback wiring pattern used in the initial createQuickTab flow. Verify callbacks are attached immediately after window instantiation and before rendering.

---

## Issue #4: Manager List Clears Without Removing DOM Elements

### Problem
The Quick Tab Manager list suddenly clears (shows "No Quick Tabs"), but Quick Tabs remain visible on screen as "ghost" elements. The Manager loses track of these Quick Tabs, making them impossible to manage via UI controls.

### Root Cause

**File:** `src/features/quick-tabs/core/UICoordinator.js`

**Location:** `renderedTabs` Map management, DestroyHandler destroy flow

**Issue:** At `17:29:21.822`, a `CLEARALLQUICKTABS` command is received. DestroyHandler attempts to destroy Quick Tabs, but UICoordinator logs "Tab not found for destruction qt-20-1764696559284-17nclpfiwbhxd". This means the Quick Tab exists in storage and on screen, but is NOT in UICoordinator's `renderedTabs` Map.

The Map becomes desynchronized from actual state when:
- Quick Tabs are created but not added to Map
- Quick Tabs are removed from Map but not destroyed from DOM
- Storage state is updated without corresponding Map operations
- Async operations complete out of order

When DestroyHandler queries the Map to get DOM references for destruction, it finds nothing, leaving orphaned DOM elements.

**Log Evidence:**
```
17:29:21.822 - CLEARALLQUICKTABS request received
17:29:21.823 - WARNING: Tab not found for destruction qt-20-1764696559284-17nclpfiwbhxd
```

### Fix Required

Enforce strict synchronization between `renderedTabs` Map and DOM state:
1. Add Quick Tab to Map immediately after DOM creation, before any async operations
2. Remove from Map only AFTER confirmed DOM destruction
3. Add logging for all Map operations (set, delete, size) to track synchronization
4. On storage state changes, cross-reference Map contents with storage state and log discrepancies
5. Implement Map validation check before destroy operations - if Map is empty but storage has tabs, rebuild Map from DOM before proceeding

Consider adding a recovery mechanism: if UICoordinator detects Map desynchronization (storage shows N tabs but Map has M entries where N ≠ M), scan DOM for Quick Tab containers and rebuild Map.

---

## Issue #5: Duplicate Quick Tabs Created on Restore

### Problem
After minimizing a Quick Tab and clicking restore in the Manager, TWO instances of the same Quick Tab appear on screen. Both instances are functional but share the same ID, causing state corruption.

### Root Cause

**File:** `src/features/quick-tabs/core/UICoordinator.js`, `src/features/quick-tabs/core/MinimizedManager.js`

**Location:** Restore transaction handling

**Issue:** At `17:29:34.750`, UICoordinator creates a "new window instance" for restore (Transaction BEGIN txn-2). Then at `17:29:44.986`, another restore happens for the same Quick Tab ID (Transaction BEGIN txn-3). Both transactions complete, rendering two DOM instances.

This suggests:
- The first restore doesn't clear the minimized state quickly enough
- The Manager's restore button can be clicked multiple times before state updates
- Async transaction handling allows concurrent restores for same ID
- No mutex/lock prevents duplicate restore operations

### Fix Required

Implement restore operation locking per Quick Tab ID:
1. When restore begins, add Quick Tab ID to "restoring" Set
2. If ID already in Set, reject duplicate restore request
3. Remove from Set only after DOM rendering completes AND storage state updated
4. Add debouncing to Manager restore button clicks (200-300ms)

Additionally, MinimizedManager should immediately mark snapshot as "consumed" when restore begins, preventing re-use before clearSnapshot completes.

---

## Issue #6: Yellow Indicator Without DOM Hiding

### Problem
When minimizing a Quick Tab via the Quick Tab Manager's minimize button (not the Quick Tab's own minimize button), the Manager indicator turns yellow but the Quick Tab remains visible on screen. Attempting to restore it creates a duplicate.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`, Manager minimize button handler

**Location:** Minimize flow initiated from Manager UI

**Issue:** There are two minimize code paths:
1. Quick Tab's own minimize button → works correctly
2. Manager's minimize button for that Quick Tab → updates state but not DOM

The Manager's minimize flow likely updates storage state (setting `minimized: true`) without calling the VisibilityHandler's minimize method that hides the DOM element. The indicator turns yellow because storage state changed, but the DOM remains visible because the actual hide operation wasn't executed.

### Fix Required

Ensure the Manager's minimize button handler invokes the same VisibilityHandler.minimize method used by the Quick Tab's toolbar button. The flow should be:
1. Manager button clicked
2. Message sent to content script with Quick Tab ID
3. Content script calls VisibilityHandler.minimize(id)
4. VisibilityHandler hides DOM AND updates storage state atomically
5. Storage.onChanged fires, Manager indicator updates

Do not split minimize logic between DOM hiding and state updates - they must be coupled in a single VisibilityHandler method.

---

## Issue #7: Missing Critical Logging

### Problem
Key events are not logged, making it impossible to diagnose cross-tab contamination, state transitions, and asynchronous race conditions. The logs lack context about which tab generated each log entry.

### Missing Logging

1. **Tab Activation Events**
   - **Location:** Content script initialization, `tabs.onActivated` handler
   - **Should log:** When user switches between browser tabs with tab IDs
   - **Example:** `"Tab activated: from tabId 15 to tabId 20"`
   - **Why critical:** Explains when/why Quick Tabs appear on newly activated tabs

2. **Storage Change Source Tracking**
   - **Location:** All `browser.storage.onChanged` listeners
   - **Should log:** Which tab/context triggered each storage change
   - **Example:** `"Storage changed: triggered by tabId 20, received in tabId 15"`
   - **Why critical:** Tracks cross-tab contamination propagation

3. **Tab ID Context in All Logs**
   - **Location:** Every log statement across all components
   - **Should include:** Current tab ID from `browser.tabs.getCurrent()`
   - **Example:** `"[Tab 20] QuickTabWindow render called"`
   - **Why critical:** Disambiguates logs from multiple tabs

4. **Quick Tab Manager State Changes**
   - **Location:** Manager UI indicator updates, list rendering
   - **Should log:** When indicators change color, when list is cleared
   - **Example:** `"Manager indicator changed: qt-123 green→yellow (minimized)"`
   - **Why critical:** Explains visual discrepancies between Manager and DOM

5. **Snapshot Lifecycle Events**
   - **Location:** MinimizedManager snapshot create/access/clear
   - **Should log:** Timestamp, Quick Tab ID, operation, snapshot existence
   - **Example:** `"Snapshot created: qt-123 at 17:29:34.500, existing: false"`
   - **Example:** `"Snapshot accessed: qt-123 at 17:29:34.700, found: true"`
   - **Example:** `"Snapshot cleared: qt-123 at 17:29:34.906, found: false"`
   - **Why critical:** Diagnoses premature clearing and race conditions

6. **UICoordinator renderedTabs Map Operations**
   - **Location:** UICoordinator add/remove Quick Tabs
   - **Should log:** Map.set, Map.delete, Map.size after operation
   - **Example:** `"renderedTabs.set(qt-123): mapSize 2→3"`
   - **Example:** `"renderedTabs.delete(qt-123): mapSize 3→2"`
   - **Why critical:** Tracks Map desynchronization with storage/DOM

7. **Event Handler Wiring Status**
   - **Location:** QuickTabWindow callback attachment
   - **Should log:** When DragController/ResizeController callbacks connect/disconnect
   - **Example:** `"Callbacks wired: qt-123 onPositionChangeEnd=true, onSizeChangeEnd=true"`
   - **Why critical:** Explains why position/size updates stop working

### Fix Required

Add comprehensive logging to all identified locations. Use a consistent format with tab ID prefix, component name, operation, and relevant state. Consider implementing a `LogContext` utility that automatically includes tab ID in all log calls.

---

## Shared Implementation Notes

- All storage writes must use unique `saveId` to prevent hash collision detection false positives
- Storage writes must complete and be confirmed before related cleanup operations (clearSnapshot, Map removal)
- Use debouncing (100-200ms) for rapid operations (minimize/restore, drag/resize)
- Tab ID scoping requires async `browser.tabs.getCurrent()` - cache result per content script instance
- `storage.onChanged` listeners must filter events by tab ID before processing
- Restore operations must re-establish ALL callback chains (drag, resize, focus)
- Map operations must be atomic with respect to DOM/storage operations - no partial updates
- Implement locking/mutex for operations that must not run concurrently (duplicate restore prevention)

<acceptance_criteria>

**Issue #1 (Storage Corruption):**
- Restore operation completes without triggering empty storage writes
- Storage tab count never drops to 0 unless user explicitly closes all Quick Tabs
- Cache clearing only happens when storage state is intentionally emptied
- Manual test: Minimize and restore Quick Tab 5 times → state remains intact

**Issue #2 (Cross-Tab Contamination):**
- Quick Tabs only appear on their originating tab by default
- `storage.onChanged` fires in all tabs but only originating tab renders (unless solo/mute configured)
- Storage state includes `originTabId` for each Quick Tab
- Manual test: Create Quick Tab in Tab A, switch to Tab B → Quick Tab does NOT appear in Tab B

**Issue #3 (Position/Size Updates):**
- After restore, dragging Quick Tab triggers `handlePositionChangeEnd` logs
- After restore, resizing Quick Tab triggers `handleSizeChangeEnd` logs
- Position/size changes persist to storage within 200ms of drag/resize end
- Manual test: Restore Quick Tab, drag it, open Manager → Manager shows updated position

**Issue #4 (Manager List Clearing):**
- Manager list clearing always accompanied by DOM destruction
- `renderedTabs` Map size always matches number of visible Quick Tabs on screen
- "Tab not found for destruction" warning never appears
- Manual test: Create 3 Quick Tabs, close all via Manager → Manager empty AND DOM clear

**Issue #5 (Duplicate Restore):**
- Clicking restore multiple times rapidly only creates one Quick Tab instance
- Restore operations for same ID are queued or rejected while in-progress
- Manual test: Minimize Quick Tab, click restore 5 times rapidly → only one instance appears

**Issue #6 (Yellow Indicator):**
- Minimize via Manager button hides Quick Tab DOM AND updates indicator
- Restore via Manager button shows Quick Tab DOM AND updates indicator green
- Manual test: Minimize via Manager button → Quick Tab disappears and indicator turns yellow

**Issue #7 (Logging):**
- All logs include `[Tab ID]` prefix showing which tab generated the log
- Tab activation logs appear when switching between browser tabs
- Storage change logs show both trigger tab and receiving tab IDs
- Snapshot lifecycle fully logged (create/access/clear with timestamps)
- Map operations logged with before/after sizes

**All Issues:**
- All existing tests pass
- No console errors or warnings during minimize/restore cycles
- Manual test: Create 2 Quick Tabs, minimize both, restore both, drag both, resize both, switch tabs 3 times → all operations persist correctly, no duplicates, no cross-tab contamination

</acceptance_criteria>

---

## Supporting Context

<details>
<summary>Issue #1: Storage Corruption Log Evidence</summary>

**Restore completes successfully:**
```
17:29:34.906 - clearSnapshot called but no snapshot found (id: qt-20-1764696568730-p1t9xh1xbf9js, minimizedTabsIds: [], pendingClearIds: [])
```

**200ms later, catastrophic failure:**
```
17:29:35.106 - WARNING: State change detected totalTabs 2 -> 0
17:29:35.162 - Storage write STARTED (0 tabs, minimized: 0) [repeated 14 times within 300ms]
17:29:35.162 - Background REJECTED: Clear within cooldown period
17:29:35.987 - WARNING: Clearing cache with 0 tabs
17:29:36.035 - Cache cleared due to empty state
```

**Impact:** All Quick Tabs lost, Manager shows "No Quick Tabs", but DOM elements remain visible as orphans.

</details>

<details>
<summary>Issue #2: Cross-Tab Contamination Architecture</summary>

Per Mozilla Developer Network documentation:

> "Fired when one or more items change in a storage area. Note that this event fires in **all contexts** where the extension is active (background script, content scripts in all tabs, popup, etc.)."  
> Source: [MDN - storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged)

The extension's current architecture assumes `storage.onChanged` only fires in the tab that made the change. This is incorrect. When Tab A updates storage, ALL tabs (B, C, D, etc.) receive the `onChanged` event and process it. Without tab ID filtering, all tabs render all Quick Tabs.

**Current flow (broken):**
1. Tab A creates Quick Tab, updates storage
2. storage.onChanged fires in Tabs A, B, C, D
3. All tabs read storage state
4. All tabs render the Quick Tab

**Required flow (fixed):**
1. Tab A creates Quick Tab with `originTabId: A`, updates storage
2. storage.onChanged fires in Tabs A, B, C, D
3. All tabs read storage state
4. Each tab filters: only render Quick Tabs where `originTabId === currentTabId`
5. Only Tab A renders the Quick Tab

</details>

<details>
<summary>Issue #3: Event Handler Detachment Evidence</summary>

**Before minimize-restore cycle (working):**
```
17:29:32.055 - UpdateHandler: handlePositionChangeEnd called (id: qt-20-..., left: 645, top: 222)
17:29:32.055 - UpdateHandler: Updated tab position in Map
17:29:32.055 - UpdateHandler: Scheduling storage persist after position change
```

**After restore (broken):**
```
17:29:34.750 - UICoordinator: Transaction BEGIN (txn-2) - Restore operation starting
17:29:34.750 - UICoordinator: Creating new window instance for restore
17:29:34.906 - QuickTabWindow: Rendered qt-20-1764696568730-p1t9xh1xbf9js
[User drags Quick Tab multiple times]
17:29:37.787 - QuickTabWindow: Drag started
17:29:37.989 - QuickTabWindow: Drag ended
[NO handlePositionChangeEnd logs]
17:29:40.047 - QuickTabWindow: Drag started
17:29:40.213 - QuickTabWindow: Drag ended
[NO handlePositionChangeEnd logs]
```

The DragController/ResizeController callbacks to UpdateHandler are not reconnected after restore.

</details>

<details>
<summary>Issue #4: Map Desynchronization Evidence</summary>

```
17:29:21.788 - Storage state changed: totalTabs 1 -> 0
17:29:21.822 - CLEARALLQUICKTABS request received
17:29:21.823 - DestroyHandler: Processing clear all Quick Tabs
17:29:21.823 - UICoordinator: WARNING: Tab not found for destruction qt-20-1764696559284-17nclpfiwbhxd
```

The Quick Tab exists in storage (triggered CLEARALLQUICKTABS) but is not in UICoordinator's `renderedTabs` Map, preventing destruction.

</details>

<details>
<summary>Issue #5: Duplicate Restore Evidence</summary>

```
17:29:34.750 - UICoordinator: Transaction BEGIN (txn-2) - Restore operation starting for qt-20-1764696568730-p1t9xh1xbf9js
17:29:34.906 - QuickTabWindow: Rendered qt-20-1764696568730-p1t9xh1xbf9js
[10 seconds later]
17:29:44.986 - UICoordinator: Transaction BEGIN (txn-3) - Restore operation starting for qt-20-1764696568730-p1t9xh1xbf9js
17:29:45.132 - QuickTabWindow: Rendered qt-20-1764696568730-p1t9xh1xbf9js
```

The same Quick Tab ID has two separate restore transactions within seconds, creating duplicate DOM instances.

</details>

---

**Priority:** Critical (Issues #1, #2), High (Issues #3, #4, #5, #7), Medium (Issue #6)  
**Target:** Address all issues in coordinated fix - storage architecture changes affect all components  
**Estimated Complexity:** High - requires architectural changes to storage schema, event handling, and cross-tab synchronization
