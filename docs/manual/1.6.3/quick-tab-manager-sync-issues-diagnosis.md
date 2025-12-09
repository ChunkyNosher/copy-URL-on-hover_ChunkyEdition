# Quick Tab Manager Sync Issues - Diagnostic Report

**Extension Version:** v1.6.3.1  
**Date:** November 28, 2025  
**Reporter:** ChunkyNosher  
**Diagnostic Scope:** Quick Tab Manager UI synchronization failures

---

## Executive Summary

The Quick Tab Manager sidebar panel fails to synchronize with actual Quick Tab
state due to **incomplete storage persistence** after v1.6.3's removal of
cross-tab Quick Tab functionality. Individual Quick Tab operations (close,
minimize, restore) properly update local UI state and emit internal events, but
these changes **never propagate to `browser.storage.local`**, causing the
Manager to display stale data.

Additional issues include a **storage area mismatch** (Settings writes to
`sync`, Manager reads from `local`) and **missing message handlers** for
Manager-initiated actions.

---

## Issue #1: Closing Quick Tab via UI Button Doesn't Update Manager

### Observed Behavior

- User clicks the close button (×) on a Quick Tab window
- Quick Tab closes successfully and disappears from the page
- Quick Tab Manager continues showing the tab as "open" with green indicator
- Manager list never updates until page reload or "Close All" is used

### Log Evidence

From `copy-url-extension-logs_v1.6.3.1_2025-11-28T21-28-24.txt`:

```
[21:27:47.597Z] [LOG] [DestroyHandler] Handling destroy for: qt-121-1764365265293-19kpof41i75159
[21:27:47.597Z] [LOG] [DestroyHandler] Emitted state:deleted for: qt-121-1764365265293-19kpof41i75159
[21:27:47.597Z] [LOG] [QuickTabWindow] Destroyed: qt-121-1764365265293-19kpof41i75159
```

**What's Missing:** No `browser.storage.local.set()` call after destruction. No
storage change event logged.

### Root Cause

**File:** `src/features/quick-tabs/handlers/DestroyHandler.js`  
**Location:** `handleDestroy()` method (lines 55-77)

**Problem:** The handler properly:

1. Removes tab from `quickTabsMap` (line 61)
2. Removes from `minimizedManager` (line 62)
3. Emits `state:deleted` event (line 69)

**But:** There is **no listener** anywhere in the codebase that responds to
`state:deleted` by saving state to storage. The event fires into the void.

**Architecture Gap:** When v1.6.3 removed cross-tab Quick Tab support, the
storage persistence layer that previously listened to these events was removed,
but no replacement was added for single-tab persistence.

### Required Fix

**Add a storage persistence handler** that listens for `state:deleted` events
and saves the updated Quick Tab state to `browser.storage.local`. This handler
should:

1. Listen for the `state:deleted` event from EventEmitter
2. Build current state from `quickTabsMap` (all remaining tabs)
3. Call
   `browser.storage.local.set({ quick_tabs_state_v2: { tabs: [...], timestamp, saveId } })`
4. Generate unique `saveId` to trigger storage change detection

**Alternative approach:** Modify `DestroyHandler.handleDestroy()` to directly
call a storage save method after cleanup, bypassing the event system.

---

## Issue #2: Minimize Button Doesn't Turn Indicator Yellow

### Observed Behavior

- User clicks minimize button (➖) on Quick Tab window
- Quick Tab minimizes successfully (visually collapses)
- Manager indicator stays **green** instead of turning **yellow**
- Manager never reflects minimized state

### Log Evidence

```
[21:27:55.023Z] [LOG] [VisibilityHandler] Handling minimize for: qt-121-1764365273037-qvb1xcfuk5tu
[21:27:55.023Z] [LOG] [MinimizedManager] Added minimized tab: qt-121-1764365273037-qvb1xcfuk5tu
[21:27:55.023Z] [LOG] [VisibilityHandler] Emitted state:updated for minimize: qt-121-1764365273037-qvb1xcfuk5tu
```

**What's Missing:** No `browser.storage.local.set()` call after minimize. No
storage change event.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` method (lines 136-151)

**Problem:** Same architecture gap as Issue #1. The handler:

1. Adds tab to `minimizedManager` (line 142)
2. Emits `state:updated` event (line 150)

**But:** No listener saves this state change to storage.

**Why the indicator doesn't update:** The Manager's `renderQuickTabItem()`
function (quick-tabs-manager.js lines 408-409) checks for `tab.minimized` or
`tab.visibility?.minimized` from the **storage state**, not live page state.
Since storage is never updated, the Manager never knows the tab was minimized.

### Required Fix

**Add storage persistence** for minimize/restore operations:

1. Listen for `state:updated` events with minimized state changes
2. Update storage with modified tab's `minimized: true` or
   `visibility.minimized: true` property
3. Ensure the saved state reflects the current `quickTabsMap` state including
   minimized tabs

**Dual fix needed:** The same handler must also respond to restore events
(`handleRestore()` at lines 156-174) to update storage when tabs are restored.

---

## Issue #3: "Clear Quick Tab Storage" Button Doesn't Clear Manager List

### Observed Behavior

- User clicks "Clear Quick Tab Storage" button in Settings sidebar
- Active Quick Tabs close successfully on the page
- Manager list still shows all previously open tabs
- Clicking button repeatedly has no effect on Manager display

### Log Evidence

```
[21:28:04.343Z] [DEBUG] [Background] Storage changed: sync []
[21:28:09.444Z] [DEBUG] [Background] Storage changed: local ["quick_tabs_state_v2"]
[21:28:09.444Z] [DEBUG] [Background] Storage cleared (empty/missing tabs), clearing cache immediately
```

**Critical detail:** First storage change is to `sync` area (empty), second is
to `local` area (the actual state storage).

### Root Cause

**File:** `sidebar/settings.js`  
**Location:** "Clear Quick Tab Storage" button handler (lines 1093-1122)

**Problem:** The button clears from **wrong storage area**:

```javascript
await browserAPI.storage.sync.remove('quick_tabs_state_v2');
```

**But the Manager listens to `local` area:**

**File:** `sidebar/quick-tabs-manager.js`  
**Location:** Storage change listener (line 631)

```javascript
if (areaName === 'local' && changes[STATE_KEY]) {
```

**Historical context:** Version v1.6.0.12 migrated Quick Tab state from
`storage.sync` to `storage.local` due to quota errors (background.js comments at
line 440-442). The Settings UI was never updated to match this change.

**Why it eventually clears:** The Manager eventually receives the correct
storage change when content scripts clear their local state, but the initial
Settings button action targets the wrong storage area.

### Required Fix

**Modify settings.js button handler** to:

1. Clear from `storage.local` instead of `storage.sync`:

   ```javascript
   await browserAPI.storage.local.remove('quick_tabs_state_v2');
   ```

2. Also notify background script to reset its cache:
   - Send `RESET_GLOBAL_QUICK_TAB_STATE` message to background
   - Background already has handler registered (background.js line 1187-1193)
   - This ensures background's `globalQuickTabState` cache is cleared
     immediately

3. Update session storage clearing to match:
   - Keep the session storage clear logic (lines 1101-1103)
   - This is correct and should remain unchanged

---

## Issue #4: Manager's Per-Tab Minimize/Close Buttons Don't Work

### Observed Behavior

- User clicks minimize button on individual tab in Manager list
- Nothing happens (tab doesn't minimize)
- User clicks close button on individual tab in Manager list
- Nothing happens (tab doesn't close)
- Console shows no errors

### Log Evidence

When buttons are clicked, logs show Quick Tabs are **focused** instead of
minimized/closed:

```
[21:28:15-17Z] [LOG] [VisibilityHandler] Bringing to front: qt-121-1764365293807-cc9cp61h84388
[21:28:15-17Z] [LOG] [DestroyHandler] Handling destroy for: qt-121-1764365293807-cc9cp61h84388
```

This suggests the messages are reaching content script but being misrouted.

### Root Cause

**File:** `sidebar/quick-tabs-manager.js`  
**Locations:**

- `minimizeQuickTab()` function (lines 712-724)
- `restoreQuickTab()` function (lines 728-740)
- `closeQuickTab()` function (lines 747-763)

**Problem:** The Manager sends messages with actions:

- `MINIMIZE_QUICK_TAB`
- `RESTORE_QUICK_TAB`
- `CLOSE_QUICK_TAB`

**But content script has no handlers registered** for these specific actions.
Searching the entire codebase shows:

**Registered handlers in content script:**

- `CLEAR_ALL_QUICK_TABS` ✓ exists
- `CLOSE_MINIMIZED_QUICK_TABS` ✓ exists
- `MINIMIZE_QUICK_TAB` ✗ missing
- `RESTORE_QUICK_TAB` ✗ missing
- `CLOSE_QUICK_TAB` ✗ missing

**Why errors are silent:** The Manager functions all have `.catch()` blocks
(lines 717, 733, 751) that swallow rejected promises when no handler responds.

**Why tabs sometimes close anyway:** The logs show destroy events firing,
suggesting clicks might be triggering click-through to the actual Quick Tab
windows rather than properly sending messages. This is unreliable and depends on
window positioning.

### Required Fix

**Add message handlers to content script** for Manager actions:

1. **For `CLOSE_QUICK_TAB`:**
   - Register handler that receives `{ action: 'CLOSE_QUICK_TAB', quickTabId }`
   - Call `DestroyHandler.closeById(quickTabId)`
   - After closing, save updated state to storage

2. **For `MINIMIZE_QUICK_TAB`:**
   - Register handler that receives
     `{ action: 'MINIMIZE_QUICK_TAB', quickTabId }`
   - Call `VisibilityHandler.handleMinimize(quickTabId)`
   - After minimizing, save updated state to storage

3. **For `RESTORE_QUICK_TAB`:**
   - Register handler that receives
     `{ action: 'RESTORE_QUICK_TAB', quickTabId }`
   - Call `VisibilityHandler.handleRestore(quickTabId)` or
     `restoreById(quickTabId)`
   - After restoring, save updated state to storage

**Implementation location:** These handlers should be registered in the same
message listener that handles `CLEAR_ALL_QUICK_TABS` (search for this in
content.js or src/content.js).

---

## Bug #5: Missing State Persistence After Individual Operations

### Pattern Identified

**Systemic issue:** ALL individual Quick Tab operations fail to persist:

- Close individual tab ✗
- Minimize tab ✗
- Restore tab ✗
- Move tab (position updates) - needs verification
- Resize tab - needs verification

**Only batch operations persist:**

- "Close All" button ✓ works (writes to storage)
- "Close Minimized" button ✓ works (writes to storage)

### Root Cause

**Architecture gap from v1.6.3 refactoring:** When cross-tab Quick Tab support
was removed, the handlers were updated to only emit events locally:

**File:** `DestroyHandler.js` header comment (lines 3-4):

```
v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
```

**File:** `VisibilityHandler.js` header comment (lines 3-4):

```
v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
```

The old cross-tab sync system included automatic storage writes after events.
When it was removed, **no single-tab persistence layer was added to replace
it**.

### Required Fix

**Create a unified storage persistence coordinator** that:

1. Listens for all state-changing events:
   - `state:deleted` (from DestroyHandler)
   - `state:updated` (from VisibilityHandler, UpdateHandler)
   - `state:created` (from CreateHandler)

2. Debounces rapid changes (optional but recommended):
   - Use 100-200ms debounce to batch rapid operations
   - Prevents excessive storage writes during drag/resize

3. Builds current state from `quickTabsMap`:
   - Iterate through all tabs in the map
   - Serialize to unified format: `{ tabs: [...], timestamp, saveId }`

4. Writes to storage:
   - Call `browser.storage.local.set({ quick_tabs_state_v2: state })`
   - Include unique `saveId` to prevent hash collision (see Bug #7)

**Alternative lightweight fix:** Add direct storage writes to each handler
method after state changes, bypassing the event system. This is simpler but less
maintainable.

---

## Bug #6: Storage Area Mismatch Throughout Extension

### Identified Mismatches

**Settings writes to `sync`:**

- File: `sidebar/settings.js` line 1098
- Clears `storage.sync.remove('quick_tabs_state_v2')`

**Manager reads from `local`:**

- File: `sidebar/quick-tabs-manager.js` line 631
- Listens `if (areaName === 'local' && changes[STATE_KEY])`

**Background writes to `local`:**

- File: `background.js` line 440-442
- Comments indicate migration to `local` in v1.6.0.12

### Root Cause

**Incomplete migration:** When v1.6.0.12 changed Quick Tab storage from `sync`
to `local` (due to quota errors with large states), some UI components were not
updated to match:

1. Background script ✓ updated to use `local`
2. Content script ✓ updated (uses background's state)
3. Quick Tab Manager ✓ updated to listen to `local`
4. Settings UI ✗ still clears from `sync`

### Required Fix

**Update Settings UI consistency:**

1. Change "Clear Quick Tab Storage" button to use `local`:
   - Modify line 1098 in `sidebar/settings.js`
   - Change from `storage.sync.remove()` to `storage.local.remove()`

2. Audit all other Settings UI storage operations:
   - Verify Settings itself still uses `local` for its own data
   - Ensure no other Quick Tab operations target `sync`

3. Add migration cleanup (optional):
   - Clear old `sync` storage on extension update
   - Prevents confusion from stale data in old location

---

## Bug #7: Hash Collision Prevents Cache Updates

### Observed Behavior

- Background script logs: "Storage cleared (empty/missing tabs), clearing cache
  immediately"
- But sometimes logs: "State unchanged (same hash), skipping cache update"
- Empty storage writes don't always trigger Manager updates

### Log Evidence

```
[21:27:38.644Z] [DEBUG] [Background] Storage cleared (empty/missing tabs), clearing cache immediately
```

But background.js line 1081 can prevent this:

```javascript
if (newHash === lastBroadcastedStateHash) {
  console.log(
    '[Background] State unchanged (same hash), skipping cache update'
  );
  return;
}
```

### Root Cause

**File:** `background.js`  
**Location:** `computeStateHash()` function (lines 184-201)

**Problem:** The hash function was updated in v1.6.3.2 to include `saveId` to
prevent collisions, but there's an edge case:

1. When storage is cleared to empty state:
   `{ tabs: [], saveId: '...', timestamp: ... }`
2. The hash is computed from: `{ saveId, tabData: [] }`
3. If two separate clear operations occur, they produce different `saveId`
   values
4. **But** if background's cache already has empty tabs, and storage is cleared
   again, the hash might not update properly due to the `_isSelfWrite()` check
   (line 1073-1082)

**The conditional in `_handleQuickTabStateChange()` (line 1088-1091):**

```javascript
if (newHash === lastBroadcastedStateHash) {
  console.log(
    '[Background] State unchanged (same hash), skipping cache update'
  );
  return;
}
```

This is too aggressive - it skips the update even when `saveId` changed, which
should indicate a new write operation.

### Required Fix

**Refine hash collision detection:**

1. **Check `saveId` directly** before computing hash:
   - Compare `newValue.saveId` to the cached state's `saveId`
   - If `saveId` changed, always update cache (even if hash matches)
   - Only skip update if both `saveId` and hash are identical

2. **Improve empty state handling:**
   - The v1.6.3.2 fix at lines 1076-1080 already handles empty tabs
   - But move this check **before** the hash comparison
   - This ensures empty state clears cache immediately without hash checks

3. **Add saveId validation:**
   - Ensure all storage writes include a valid `saveId`
   - Log warning if `saveId` is missing (indicates incomplete migration)

**Code location to modify:** `_handleQuickTabStateChange()` function in
`background.js` (lines 1068-1099).

---

## Missing Logging Actions

The following operations should log but don't, making debugging difficult:

### 1. Storage Writes After Individual Operations

**Missing:** `browser.storage.local.set()` calls after:

- Individual Quick Tab close
- Individual Quick Tab minimize
- Individual Quick Tab restore

**Add logging:** When storage persistence is added (per Bug #5 fix), log:

```
[StorageManager] Saved state after close: qt-xxx-xxx (N tabs remaining)
[StorageManager] Saved state after minimize: qt-xxx-xxx
[StorageManager] Saved state after restore: qt-xxx-xxx
```

### 2. Content Script Message Handler Reception

**Missing:** Log when Manager messages are received:

- `MINIMIZE_QUICK_TAB` received
- `RESTORE_QUICK_TAB` received
- `CLOSE_QUICK_TAB` received

**Add logging:** In new message handlers (per Bug #4 fix), log:

```
[Content] Received MINIMIZE_QUICK_TAB request: qt-xxx-xxx
[Content] Received RESTORE_QUICK_TAB request: qt-xxx-xxx
[Content] Received CLOSE_QUICK_TAB request: qt-xxx-xxx
```

### 3. Manager Button Click Failures

**Missing:** Log when messages fail silently in Manager

**Current behavior:** `.catch()` blocks swallow errors (quick-tabs-manager.js
lines 717, 733, 751)

**Add logging:** Replace silent catches with:

```
.catch(err => {
  console.error('[Manager] Failed to minimize Quick Tab:', quickTabId, err);
})
```

### 4. Storage Area Write Confirmation

**Missing:** Confirm which storage area is being written to

**Add logging:** In all storage operations, log:

```
[Storage] Writing to local: quick_tabs_state_v2 (N tabs)
[Storage] Cleared from local: quick_tabs_state_v2
```

This prevents future storage area mismatches.

---

## Implementation Priority

### Critical (Breaks Core Functionality)

1. **Issue #1** - Add storage persistence after destroy
2. **Issue #2** - Add storage persistence after minimize/restore
3. **Issue #3** - Fix storage area mismatch in Settings
4. **Issue #4** - Add missing message handlers

### High (Prevents Future Issues)

5. **Bug #5** - Implement unified storage persistence coordinator
6. **Bug #6** - Audit and fix all storage area references

### Medium (Improves Reliability)

7. **Bug #7** - Refine hash collision detection
8. **Missing Logs** - Add comprehensive logging

---

## Testing Recommendations

After implementing fixes, verify:

1. **Individual close:**
   - Close Quick Tab via × button
   - Verify Manager removes tab immediately
   - Check logs for storage write

2. **Individual minimize:**
   - Minimize Quick Tab via ➖ button
   - Verify Manager indicator turns yellow
   - Restore and verify indicator turns green

3. **Manager controls:**
   - Use Manager's minimize button on active tab
   - Use Manager's close button on active tab
   - Use Manager's restore button on minimized tab
   - All should work instantly

4. **Clear storage:**
   - Click "Clear Quick Tab Storage" in Settings
   - Verify Manager list clears immediately
   - Verify background cache is reset

5. **Cross-tab verification:**
   - Open Quick Tab on tab A
   - Switch to tab B
   - Manager should show tab from A (read-only display)

---

## Architectural Notes

### Event System vs Direct Storage

The current architecture uses an EventEmitter pattern:

- Handlers emit events: `state:deleted`, `state:updated`, `state:created`
- Coordinators are supposed to listen and persist

**Problem:** The persistence listeners were removed in v1.6.3 refactoring.

**Solution options:**

**A) Restore event listeners (recommended for maintainability):**

- Create `StoragePersistenceCoordinator` class
- Listen for all state events
- Debounce and batch writes
- More flexible for future features

**B) Direct storage writes (simpler short-term fix):**

- Add `await saveStateToStorage()` calls directly in handlers
- After each state change, immediately persist
- Less maintainable but faster to implement

**Recommendation:** Implement Option B as immediate fix, refactor to Option A in
next major version.

### Storage Layer Hierarchy

Current storage flow should be:

```
QuickTab UI Action
    ↓
Handler (Destroy/Visibility/Update)
    ↓
Local State Update (quickTabsMap)
    ↓
Event Emission (state:deleted/updated)
    ↓
[MISSING] Storage Persistence Layer ← ADD THIS
    ↓
browser.storage.local.set()
    ↓
storage.onChanged event
    ↓
Quick Tab Manager updates UI
```

The gap is the Storage Persistence Layer - no component currently fills this
role for individual operations.

---

## References

- **Mozilla WebExtensions Storage API:**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
- **storage.onChanged documentation:**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged
- **runtime.sendMessage() documentation:**
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage

---

## Version History

- **v1.6.3.1** - Current version with reported issues
- **v1.6.3** - Removed cross-tab Quick Tab support (introduced bugs)
- **v1.6.3.2** - Attempted fix for hash collision (Bug #7)
- **v1.6.2.2** - Unified storage format
- **v1.6.0.12** - Migrated from storage.sync to storage.local (incomplete
  migration)

---

**End of Diagnostic Report**
