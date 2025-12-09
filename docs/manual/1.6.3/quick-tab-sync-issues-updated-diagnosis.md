# Quick Tab Manager Sync Issues - Updated Diagnostic Report

**Extension Version:** v1.6.3.1  
**Date:** November 28, 2025  
**Reporter:** ChunkyNosher  
**Analysis Scope:** Quick Tab state persistence and Manager UI synchronization

---

## Executive Summary

After implementing fixes for close button persistence, **critical issues
remain** with Quick Tab state synchronization. The root cause is **incomplete
storage persistence** introduced when v1.6.3 removed the cross-tab sync
`StorageManager` component. Individual operations (minimize, restore, resize,
move) **emit events locally but never write to `browser.storage.local`**,
causing the Manager sidebar to display stale data.

This report documents the remaining issues identified through log analysis and
codebase review, providing specific file locations and architectural guidance
for fixes.

---

## Issue #1: Minimize Button on Quick Tab UI Doesn't Update Manager

### Observed Behavior

**User Action:**

- User clicks minimize button (➖) on Quick Tab window
- Quick Tab minimizes successfully (collapses visually)
- Manager indicator stays **green** instead of turning **yellow**
- Manager never reflects minimized state until page reload

### Log Evidence

**From `copy-url-extension-logs_v1.6.3.1_2025-11-28T23-03-43.txt`:**

**Expected logs (MISSING):**

```
[VisibilityHandler] Handling minimize for: qt-xxx-xxx
[MinimizedManager] Added minimized tab: qt-xxx-xxx
[Content] Saved state after minimize (N tabs, M minimized)
[Background] Storage changed: local ["quick_tabs_state_v2"]
```

**What actually appears:**

```
[22:57:13.410Z] [Background] Storage changed: local ["quick_tabs_state_v2"]
[22:57:13.410Z] [Background] Updated global state from storage (unified format): 2 tabs
```

**Analysis:** Storage change event appears **without** preceding minimize logs,
suggesting:

1. Minimize operation never fired properly
2. OR minimize operation fired but didn't log
3. OR minimize succeeded but never persisted to storage

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` method (lines 136-151)

**Problem:** The handler properly:

1. Adds tab to `minimizedManager` (line 142)
2. Updates local state: `tab.minimized = true`
3. Emits `state:updated` event (line 150)

**But:** There is **no storage write** after state changes. The event fires
locally but nothing persists the updated state to `browser.storage.local`.

**Why Manager doesn't update:**

- Manager's `storage.onChanged` listener (quick-tabs-manager.js line 631) only
  fires when storage is **actually written to**
- According to Mozilla's `storage.onChanged` documentation, the event only
  triggers on `storage.local.set()` or `.remove()` calls
- Since `handleMinimize()` never calls these methods, Manager never receives
  notification

### Required Fix

**Add storage persistence to minimize operation:**

1. After line 150 in `VisibilityHandler.js` (where `state:updated` is emitted),
   add storage write logic
2. Build current state from `quickTabsMap` including minimized status
3. Call
   `browser.storage.local.set({ quick_tabs_state_v2: { tabs: [...], timestamp, saveId } })`
4. Generate unique `saveId` to prevent hash collision (see Bug #7 from previous
   report)

**Implementation notes:**

- Should follow same pattern as `DestroyHandler.closeAll()` which properly
  persists (lines 90-124)
- Must include `minimized: true` property in saved tab state
- Should debounce rapid minimize/restore operations (100-200ms delay) to prevent
  storage write storms

---

## Issue #2: Manager's Minimize Button Sends Message But Handler Doesn't Persist

### Observed Behavior

**User Action:**

- User clicks minimize button on individual tab in Manager list
- Quick Tab **does minimize** on the page (window collapses)
- Manager indicator stays green
- Restore button shows "Tab not found in minimized manager" warning

### Log Evidence

**At 22:57:53.586Z and 22:57:55.227Z:**

```
[LOG] [Content] Received MINIMIZE_QUICK_TAB request: qt-121-1764370626642-1xf9wlnxy1xgv
[WARN] [VisibilityHandler] Tab not found in minimized manager: qt-121-1764370626642-1xf9wlnxy1xgv
```

**Wait, the user tried RESTORE, not minimize. Let me check the actual minimize
logs...**

**CRITICAL FINDING:** Searching the **entire 48KB log file** for
"MINIMIZE_QUICK_TAB" message yields **ZERO results**.

This means:

- Manager's minimize button **never sends the message**
- OR message is sent but content script doesn't receive it
- OR message handler exists but isn't registered properly

### Root Cause Analysis

**Diagnosis 1: Check if message is sent**

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `minimizeQuickTab()` function (lines 712-724)

The function **does send the message**:

```javascript
await browserAPI.tabs.sendMessage(tab.id, {
  action: 'MINIMIZE_QUICK_TAB',
  quickTabId: quickTabId
});
```

**Diagnosis 2: Check if handler exists**

**File:** `src/content.js`  
**Location:** Message listener (lines 770-787)

Handler **exists and is registered**:

```javascript
if (message.action === 'MINIMIZE_QUICK_TAB') {
  console.log(
    '[Content] Received MINIMIZE_QUICK_TAB request:',
    message.quickTabId
  );
  _handleMinimizeQuickTab(message.quickTabId, sendResponse);
  return true;
}
```

**Diagnosis 3: Check what handler does**

**File:** `src/content.js`  
**Location:** `_handleMinimizeQuickTab()` helper (lines 759-773)

Handler calls:

```javascript
quickTabsManager.minimizeById(quickTabId);
```

Which delegates to:

**File:** `src/features/quick-tabs/index.js`  
**Location:** `minimizeById()` method (line 534)

Which calls:

```javascript
return this.handleMinimize(id);
```

Which calls `VisibilityHandler.handleMinimize()`... **which doesn't save to
storage** (same as Issue #1).

### Root Cause

**The message handler chain works correctly**, but the underlying minimize
operation **fails to persist state**, causing the same problem as Issue #1.

**Why logs show "Tab not found in minimized manager":**

- User clicks Manager restore button on a tab that **was never properly
  minimized**
- The tab shows as active (green) because minimize didn't save to storage
- Restore handler looks for tab in `minimizedManager` but it's not there
- Warning is logged

**The actual bug:** Not that the message handler is missing, but that
`VisibilityHandler.handleMinimize()` doesn't persist state (Issue #1 root cause
applies here too).

### Required Fix

Same fix as Issue #1 - add storage persistence to
`VisibilityHandler.handleMinimize()`.

---

## Issue #3: Size/Position Indicators Never Update in Manager

### Observed Behavior

**User Action:**

- User resizes Quick Tab from default 800×600 to 1024×768
- User drags Quick Tab from position (100,100) to (250,150)
- Manager still shows "800 × 600" size indicator
- Manager doesn't show position at all (feature request: should display
  position)

### Log Evidence

**Searching entire log file for resize/move operations:**

**Found:** ZERO instances of:

- `UPDATE_QUICK_TAB_SIZE`
- `UPDATE_QUICK_TAB_POSITION`
- `Size updated`
- `Position updated`
- `Saved state after resize`
- `Saved state after move`

**What this means:**

1. Resize/move operations don't log properly
2. OR operations are filtered by console logger
3. OR operations emit events but those events aren't logged

### Root Cause - Part A: Resize Operations

**File:** `src/features/quick-tabs/window/ResizeController.js`  
**Location:** Constructor and event handling

**How resize works:**

1. User drags resize handle
2. `ResizeController` emits resize events via callbacks
3. Callbacks trigger `QuickTabWindow.handleSizeChange()` (window.js line 274)
4. This calls `this.onSizeChange()` callback
5. Callback is set to `QuickTabsManager.handleSizeChange()` (window.js line 210)
6. Manager delegates to `UpdateHandler.handleSizeChange()`

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `handleSizeChange()` and `handleSizeChangeEnd()` methods

**Problem:** Both methods:

1. Update local window instance: `window.width = width; window.height = height`
2. Emit `state:updated` event to internal event bus
3. **Do NOT write to `browser.storage.local`**

**Why Manager doesn't show updated size:**

- Manager renders size from **storage state**: `${tab.width}×${tab.height}`
  (quick-tabs-manager.js line 408)
- Storage never receives size updates
- Manager always shows default 800×600

### Root Cause - Part B: Position Operations

**File:** `src/features/quick-tabs/window/DragController.js`  
**Location:** Pointer event handling

**How drag works:**

1. User drags title bar
2. `DragController` emits drag events via callbacks
3. Callbacks trigger `QuickTabWindow.handlePositionChange()` (window.js
   line 270)
4. This calls `this.onPositionChange()` callback
5. Callback is set to `QuickTabsManager.handlePositionChange()` (window.js
   line 209)
6. Manager delegates to `UpdateHandler.handlePositionChange()`

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** `handlePositionChange()` and `handlePositionChangeEnd()` methods

**Problem:** Same as resize - updates local state, emits events, **never writes
to storage**.

### Root Cause - Part C: Missing Logging

**File:** `src/utils/logger.js`  
**Location:** Category filtering

**Why operations don't log:**

- `UpdateHandler` logs with prefix `[UpdateHandler]`
- `ResizeController` logs with prefix `[QuickTabWindow]` or `[ResizeController]`
- `DragController` logs with prefix `[QuickTabWindow]` or `[DragController]`

**But:** Live console filter expects category `quick-tabs` or
`quick-tab-manager`

**Result:** Logs are emitted but **filtered out** by console interceptor because
category doesn't match enabled filters.

### Required Fix

**Part A: Add storage persistence for resize operations**

1. In `UpdateHandler.handleSizeChangeEnd()` (called when resize finishes):
   - Build current state from `quickTabsMap`
   - Include updated `width` and `height` for resized tab
   - Write to `browser.storage.local.set()`
   - Use debouncing (200ms) to prevent write spam during rapid resizing

2. **Do NOT save on `handleSizeChange()`** (called continuously during drag):
   - This fires dozens of times per second during resize
   - Would cause storage write storm
   - Only save on `handleSizeChangeEnd()` (final size)

**Part B: Add storage persistence for position operations**

1. In `UpdateHandler.handlePositionChangeEnd()` (called when drag finishes):
   - Build current state from `quickTabsMap`
   - Include updated `left` and `top` for moved tab
   - Write to `browser.storage.local.set()`
   - Use debouncing (200ms) to prevent write spam

2. **Do NOT save on `handlePositionChange()`**:
   - Same reasoning as resize
   - Only save final position, not intermediate positions

**Part C: Fix logging categories**

1. Update `UpdateHandler` to use `logNormal('quick-tabs', ...)` instead of
   console.log
2. Update `DragController` to use `logNormal('quick-tabs', ...)`
3. Update `ResizeController` to use `logNormal('quick-tabs', ...)`
4. This ensures operations appear in console when `quick-tabs` category is
   enabled

**Part D: Add position display to Manager (feature request)**

1. In `sidebar/quick-tabs-manager.js` line 408, add position display:
   - Show `(${tab.left}, ${tab.top})` alongside size
   - Format: "800 × 600 at (250, 150)"
   - This helps users verify position updates work

---

## Issue #4: "Delayed Update" - Minimized Tabs Appear After Closing Last Active Tab

### Observed Behavior

**User reports:**

> "When I open two or more Quick Tabs, minimize all but one, then close that
> last Quick Tab, all minimized tabs suddenly switch to yellow indicator with
> updated sizes. But restoring them doesn't change indicator back to green."

### Log Pattern Analysis

**Timeline from logs (22:52:15 - 22:53:04):**

1. **22:52:15-23Z:** Create 3 Quick Tabs
2. **22:52:23.037Z:** Storage shows **3 tabs** (presumably after user minimizes
   some)
3. **22:52:24.458Z:** Storage shows **2 tabs** (one closed)
4. **22:53:01-02Z:** Storage shows **2 tabs** → **1 tab** (another closed)
5. **22:53:04.097Z:** Manager close button closes last tab
6. **22:53:04.109Z:** Storage **cleared** (0 tabs)

**What user saw:**

- Manager still showed all 3 tabs as active (green)
- After closing last tab, Manager suddenly showed previous tabs with yellow
  indicators

### Root Cause

**This is NOT minimized tabs "appearing"** - it's a **UI rendering artifact**
caused by Manager's stale local cache.

**What actually happens:**

1. User minimizes tabs 1-2, keeps tab 3 active
2. Minimize operations **don't save to storage** (Issue #1)
3. Manager's storage listener never fires (no storage.onChanged event)
4. Manager's **local state** still has tabs 1-2 as "active" because it never
   received update
5. User closes tab 3 via close button
6. Close button **does save to storage** (DestroyHandler properly persists)
7. Storage now shows **0 tabs** (tab 3 deleted, tabs 1-2 were never saved as
   minimized)
8. Manager receives storage.onChanged event with empty state
9. Manager clears its storage-backed list
10. **But Manager's DOM still renders tabs 1-2** from previous render cycle
11. Manager's `renderQuickTabItem()` falls back to default state when tab data
    is missing
12. Default rendering shows yellow indicator (minimized fallback) with stale
    size data

**The "yellow indicators with updated sizes" are:**

- NOT the actual minimized tabs
- Ghost entries from Manager's render cache
- Rendered with fallback styles because storage has no data for them
- Manager thinks they're minimized because it can't find them in active state

### Why Restore Doesn't Work

**Log evidence (22:57:53.586Z):**

```
[Content] Received RESTORE_QUICK_TAB request: qt-121-1764370626642-1xf9wlnxy1xgv
[VisibilityHandler] Handling restore for: qt-121-1764370626642-1xf9wlnxy1xgv
[WARN] Tab not found in minimized manager: qt-121-1764370626642-1xf9wlnxy1xgv
```

**Why warning appears:**

- User clicks restore on ghost entry
- Content script receives restore request
- `VisibilityHandler.restoreById()` looks for tab in `minimizedManager`
- **Tab isn't there** because it was never properly minimized
- Warning is logged, restore fails silently

**The indicator stays yellow because:**

- Restore operation fails (tab not in minimized manager)
- No storage write occurs (restore failed)
- Manager never receives update
- Ghost entry stays rendered with yellow fallback style

### Required Fix

**Primary fix:** Resolve Issue #1 (add storage persistence to minimize)

Once minimize operations properly save to storage:

1. Manager will receive storage.onChanged events immediately
2. Manager will update indicators to yellow when tabs minimize
3. Manager won't show ghost entries (storage state matches reality)
4. Restore operations will work (tabs are in minimized manager)

**Secondary fix:** Improve Manager's ghost entry handling

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderQuickTabItem()` function (lines 390-440)

**Add validation:**

1. Before rendering tab, check if tab exists in storage state
2. If tab is missing from storage but exists in local cache, **remove from
   cache**
3. This prevents ghost entries from lingering after state clears

**Tertiary fix:** Add Manager cache synchronization

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `refreshQuickTabsList()` function (lines 340-365)

**Current behavior:** Only updates list when storage changes

**Improved behavior:**

1. When storage state is received, iterate through **Manager's local DOM**
2. Remove any rendered tabs that **aren't in storage state**
3. This ensures UI matches storage reality (no ghost entries)

---

## Bug #5: Excessive Storage Clear Events (Storm of 17 Writes in 8ms)

### Observed Behavior

**Log evidence (22:53:43.597-605Z):**

```
[22:53:43.597Z] [Background] Storage cleared (17 identical events)
[22:53:43.605Z] [Background] Updated global state: 1 tabs
[22:53:43.605Z] [Background] Storage cleared (2 more events)
```

**Pattern:** "Clear All Quick Tabs" button triggers **19 storage write events in
8 milliseconds**.

### Root Cause

**File:** `sidebar/settings.js`  
**Location:** "Clear Quick Tab Storage" button handler (lines 1093-1122)

**Current implementation:**

1. Button sends `CLEAR_ALL_QUICK_TABS` message **to all browser tabs**
   (line 1112)
2. Each tab that has content script loaded receives message
3. Each tab calls `quickTabsManager.closeAll()` (content.js line 744)
4. Each tab writes empty state to storage (DestroyHandler.js line 115)
5. Each write triggers `storage.onChanged` event **across all tabs**
6. Creates feedback loop of storage writes

**Why this happens:**

- `browserAPI.tabs.query({})` returns **all tabs** (line 1112)
- Extension is installed on multiple tabs (user was testing on tabs 120, 121, 2,
  3, 4, 8, etc.)
- Each tab responds to broadcast message
- All try to clear storage simultaneously
- Race condition as tabs overwrite each other's writes

**Evidence from logs:**

```
[22:53:43.586Z] [Content] Received CLEAR_ALL_QUICK_TABS request
[22:53:43.587Z] [Content] Clearing 0 Quick Tabs
```

Content script reports "Clearing **0** Quick Tabs" - meaning its local
`quickTabsMap` is already empty, but it **still writes to storage**
(DestroyHandler.closeAll() always writes regardless of count).

### Required Fix

**Approach A: Coordinate through background script (recommended)**

1. Change Settings button to send message to **background script only**
2. Background script clears storage once:
   `browser.storage.local.remove('quick_tabs_state_v2')`
3. Background script broadcasts `QUICK_TABS_CLEARED` notification to all tabs
4. Content scripts receive notification and clear local state **without writing
   to storage**
5. Prevents race condition and storage write storm

**Implementation:**

- Settings: Send `CLEAR_GLOBAL_QUICK_TAB_STATE` to background (like existing
  handler at background.js line 1187)
- Background: Clear storage once, broadcast notification
- Content: Listen for notification, clear local maps without storage write

**Approach B: Add coordination flag (simpler but less robust)**

1. When first tab receives `CLEAR_ALL_QUICK_TABS`, set flag in storage:
   `{ quick_tabs_clearing: true }`
2. Other tabs check flag before clearing
3. If flag exists, skip storage write
4. First tab unsets flag after clearing

**Risk:** Race condition if multiple tabs check flag simultaneously before first
sets it.

**Recommendation:** Use Approach A for reliability.

---

## Bug #6: Manager Doesn't Show Position Coordinates (Feature Request)

### Current Behavior

Manager displays:

```
[Title]
800 × 600
```

### Requested Behavior

Manager should display:

```
[Title]
800 × 600 at (250, 150)
```

This helps users:

1. Verify position updates are persisting (related to Issue #3)
2. Understand Quick Tab layout without switching tabs
3. Debug position-related issues

### Implementation

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** `renderQuickTabItem()` function (line 408)

**Current code structure:**

```
Size: ${tab.width} × ${tab.height}
```

**Add position display:**

1. After size, add position text: `at (${tab.left}, ${tab.top})`
2. Format as: `800 × 600 at (250, 150)`
3. Use same styling as size indicator
4. Ensure position values come from storage state (tab.left, tab.top)

**Validation:**

- Check if `tab.left` and `tab.top` exist before displaying
- If missing, show "at (?, ?)" or omit position entirely
- This handles legacy tabs saved without position data

---

## Missing Logging Actions

The following operations should log but don't, making debugging difficult:

### 1. Minimize Operations from Quick Tab UI

**Current:** Silent - no logs emitted

**Should log:**

```
[Quick Tabs] [Action] Minimize button clicked: qt-xxx-xxx
[VisibilityHandler] [State] Handling minimize for: qt-xxx-xxx
[MinimizedManager] [State] Added tab to slot #N: qt-xxx-xxx
[Content] [Storage] Saved state after minimize (X tabs, Y minimized)
```

**File to modify:** `src/features/quick-tabs/handlers/VisibilityHandler.js`

### 2. Minimize Operations from Manager

**Current:** Logs message receipt but not execution

**Should log:**

```
[Manager] [Action] Sending MINIMIZE_QUICK_TAB: qt-xxx-xxx
[Content] [Message] Received MINIMIZE_QUICK_TAB request: qt-xxx-xxx
[Content] [Result] Minimized Quick Tab: qt-xxx-xxx
[Content] [Storage] Saved state after minimize
```

**Files to modify:**

- `sidebar/quick-tabs-manager.js` (add log before sending message)
- `src/content.js` (add log after minimize succeeds)

### 3. Size/Position Updates During Resize/Drag

**Current:** Silent - operations happen without logs

**Should log:**

```
[Quick Tabs] [Action] Resize started: qt-xxx-xxx
[UpdateHandler] [State] Size updating: qt-xxx-xxx (800×600 → 850×650)
[UpdateHandler] [State] Size update complete: qt-xxx-xxx (1024×768)
[Content] [Storage] Saved state after resize

[Quick Tabs] [Action] Drag started: qt-xxx-xxx
[UpdateHandler] [State] Position updating: qt-xxx-xxx (100,100 → 150,120)
[UpdateHandler] [State] Drag complete: qt-xxx-xxx (250,150)
[Content] [Storage] Saved state after move
```

**File to modify:** `src/features/quick-tabs/handlers/UpdateHandler.js`

### 4. Storage Writes After Individual Operations

**Current:** Only batch operations log storage writes

**Should log for ALL operations:**

```
[Content] [Storage] Writing Quick Tab state: N tabs (M active, P minimized)
[Content] [Storage] State saved successfully (saveId: xxx)
[Background] [Storage] Detected change from tab 121: quick_tabs_state_v2
```

**Files to modify:**

- Add logging wrapper around all `browser.storage.local.set()` calls
- Log before write with operation context
- Log after write with success confirmation

### 5. Manager UI State Updates

**Current:** Manager updates silently

**Should log:**

```
[Manager] [Render] Rendering 3 Quick Tabs (2 active, 1 minimized)
[Manager] [Update] Indicator updated: qt-xxx-xxx → yellow (minimized)
[Manager] [Update] Size updated: qt-xxx-xxx → 1024×768
[Manager] [Cache] Removed ghost entry: qt-xxx-xxx (not in storage)
```

**File to modify:** `sidebar/quick-tabs-manager.js`

### 6. Restore Operations

**Current:** Logs warning when tab not found, but not success

**Should log:**

```
[Content] [Message] Received RESTORE_QUICK_TAB request: qt-xxx-xxx
[VisibilityHandler] [State] Restoring tab from slot #N: qt-xxx-xxx
[MinimizedManager] [State] Removed from minimized: qt-xxx-xxx
[VisibilityHandler] [State] Tab restored successfully: qt-xxx-xxx
[Content] [Storage] Saved state after restore
```

**File to modify:** `src/features/quick-tabs/handlers/VisibilityHandler.js`

---

## Implementation Priority

### Critical (Breaks Core Functionality)

1. **Issue #1** - Add storage persistence after minimize (VisibilityHandler.js)
2. **Issue #3 Part A** - Add storage persistence after resize (UpdateHandler.js)
3. **Issue #3 Part B** - Add storage persistence after move (UpdateHandler.js)

**Rationale:** These three fixes restore basic state persistence. Without them,
Manager is completely out of sync with reality.

### High (Prevents Future Issues)

4. **Bug #5** - Fix "Clear All" storage write storm (settings.js)
5. **Issue #4 Secondary** - Add ghost entry validation to Manager
   (quick-tabs-manager.js)
6. **Issue #3 Part C** - Fix logging categories (UpdateHandler.js,
   DragController.js, ResizeController.js)

**Rationale:** Prevents performance issues, UI glitches, and improves
debuggability.

### Medium (Improves UX)

7. **Bug #6** - Add position display to Manager (quick-tabs-manager.js)
8. **Missing Logs** - Add comprehensive logging for all operations

**Rationale:** Helps users understand state and aids debugging.

---

## Architectural Recommendations

### Create Unified Storage Persistence Coordinator

**Problem:** Currently, each handler is responsible for its own storage writes,
but none actually do it.

**Solution:** Create a new `StoragePersistenceCoordinator` class that:

1. **Listens for state change events:**
   - `state:updated` (from VisibilityHandler, UpdateHandler)
   - `state:deleted` (from DestroyHandler)
   - `state:created` (from CreateHandler)

2. **Debounces rapid changes:**
   - Use 100-200ms debounce to batch operations
   - Prevents storage write spam during resize/drag
   - Ensures only final state is saved

3. **Builds current state from `quickTabsMap`:**
   - Iterates through all tabs
   - Serializes to unified format
   - Includes all properties: position, size, minimized, etc.

4. **Writes to storage:**
   - Calls `browser.storage.local.set({ quick_tabs_state_v2: state })`
   - Includes unique `saveId` to prevent hash collision
   - Logs write operation for debugging

**Benefits:**

- Centralized persistence logic (DRY principle)
- Consistent debouncing across all operations
- Single source of truth for state serialization
- Easier to test and maintain

**Files to create:**

- `src/features/quick-tabs/coordinators/StoragePersistenceCoordinator.js`

**Integration points:**

- Initialize in `QuickTabsManager._initializeCoordinators()` (index.js)
- Setup listeners in `QuickTabsManager._setupComponents()` (index.js)

### Alternative: Direct Storage Writes in Handlers

**Simpler approach:** Add storage write calls directly to each handler method:

**Pros:**

- Faster to implement
- No new components needed
- Clear ownership (each handler owns its persistence)

**Cons:**

- Code duplication (every handler writes to storage)
- Harder to maintain consistent debouncing
- Risk of different serialization formats

**Recommendation:** Use coordinator pattern for maintainability, but direct
writes are acceptable as a quick fix.

---

## Testing Recommendations

After implementing fixes, verify each scenario:

### Test 1: Individual Minimize from Quick Tab UI

**Steps:**

1. Create Quick Tab via keyboard shortcut
2. Click minimize button (➖) on Quick Tab window
3. Open Manager sidebar

**Expected:**

- Manager indicator turns yellow immediately
- Manager shows tab in minimized section
- Storage shows `minimized: true` for tab
- Logs show minimize operation and storage write

### Test 2: Individual Minimize from Manager

**Steps:**

1. Create Quick Tab
2. Open Manager sidebar
3. Click minimize button on tab row in Manager

**Expected:**

- Quick Tab window collapses on page
- Manager indicator turns yellow immediately
- Storage shows `minimized: true`
- Logs show message sent, received, and storage write

### Test 3: Restore from Manager

**Steps:**

1. Create and minimize Quick Tab (using either method)
2. Click restore button in Manager

**Expected:**

- Quick Tab window re-appears on page
- Manager indicator turns green immediately
- Storage shows `minimized: false`
- Logs show restore operation and storage write

### Test 4: Resize Quick Tab

**Steps:**

1. Create Quick Tab (default 800×600)
2. Drag resize handle to 1024×768
3. Check Manager sidebar

**Expected:**

- Manager shows "1024 × 768" immediately after resize completes
- Storage shows updated width/height
- Logs show size updates during drag and final storage write
- Only ONE storage write (at end of resize, not during drag)

### Test 5: Move Quick Tab

**Steps:**

1. Create Quick Tab at position (100, 100)
2. Drag to position (250, 150)
3. Check Manager sidebar

**Expected:**

- Manager shows "at (250, 150)" immediately after drag completes
- Storage shows updated left/top coordinates
- Logs show position updates during drag and final storage write
- Only ONE storage write (at end of drag, not during drag)

### Test 6: Clear All Quick Tabs

**Steps:**

1. Create 3 Quick Tabs on current tab
2. Open 2 more browser tabs
3. Click "Clear Quick Tab Storage" in Settings
4. Watch console logs

**Expected:**

- All Quick Tabs close on all tabs
- Manager list clears immediately
- Storage cleared (0 tabs)
- Logs show **ONE** storage clear event (not 17+)
- Background script coordinates the clear

### Test 7: Cross-Tab Manager Sync

**Steps:**

1. Open tab A, create 2 Quick Tabs
2. Minimize one Quick Tab
3. Open tab B
4. Open Manager on tab B

**Expected:**

- Manager on tab B shows 2 tabs (1 active green, 1 minimized yellow)
- Manager is read-only (can't control tabs from other tabs in v1.6.3)
- Manager accurately reflects storage state

### Test 8: Page Reload Persistence

**Steps:**

1. Create Quick Tab, resize to 1024×768, move to (300, 200), minimize
2. Reload page (F5)
3. Check Manager after reload

**Expected:**

- Manager shows tab as minimized (yellow) with correct size and position
- Storage state survives reload
- All properties persisted correctly

---

## References

### Mozilla WebExtension Documentation

- **storage.local API:**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
- **storage.onChanged:**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged
  - **Critical quote:** "Fired when one or more items change in a storage
    area... This event will not fire when changes are made to storage outside
    the extension."
- **runtime.sendMessage():**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage

### JavaScript Performance Patterns

- **Debouncing resize/drag events:**
  https://developer.mozilla.org/en-US/docs/Web/API/Window/resize_event
  - **Recommended debounce time:** 100-200ms for storage writes
  - **Throttling vs Debouncing:** Use debouncing for final state, throttling for
    continuous updates
- **ResizeObserver API:**
  https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
  - Modern alternative to resize events
  - Better performance for tracking element size changes

---

## Conclusion

The Quick Tab Manager sync issues stem from **incomplete storage persistence**
introduced in v1.6.3 when cross-tab sync was removed. The core handlers
(`VisibilityHandler`, `UpdateHandler`) properly emit events and update local
state, but **never write to `browser.storage.local`**, breaking the Manager's
ability to reflect current state.

**The fix requires:**

1. Adding storage writes to all state-changing operations (minimize, restore,
   resize, move)
2. Implementing debouncing to prevent storage write storms during drag/resize
3. Improving logging to capture all operations for debugging
4. Fixing Manager's ghost entry handling to prevent stale UI

**All fixes can be implemented without breaking existing functionality** by
following the patterns already established in `DestroyHandler.closeAll()`, which
correctly persists state to storage.

---

**End of Diagnostic Report**
