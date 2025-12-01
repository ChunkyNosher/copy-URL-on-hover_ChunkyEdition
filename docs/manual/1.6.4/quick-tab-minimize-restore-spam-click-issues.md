# Quick Tab Minimize/Restore Spam-Click Issues - Multiple Critical State Synchronization Bugs

**Extension Version:** v1.6.3.4-v4  
**Date:** 2025-11-30  
**Scope:** Quick Tab minimize/restore operations and state persistence

---

## Executive Summary

Spam-clicking the minimize and restore buttons in the Quick Tab Manager Panel causes multiple critical bugs that corrupt Quick Tab state. The root cause is a **three-way state desynchronization** between: 1) instance state (`tabWindow.minimized`), 2) entity state (`entity.minimized` in quickTabsMap), and 3) snapshot state (MinimizedManager). When these diverge during restore operations, the extension enters ghost states where tabs are visually broken, duplicated, or unresponsive.

**Critical Impact:**
- Spam-clicking restore creates ghost Quick Tabs that cannot be interacted with
- Duplicate windows appear at incorrect positions (initial creation position instead of saved position)
- Storage persists incorrect minimized states, corrupting future restore operations
- Drag callbacks fire 25+ seconds after tab is minimized, saving wrong positions
- Manager Panel shows incorrect state indicators (green when tab should be yellow)

All issues trace to VisibilityHandler and UICoordinator not updating entity state, coupled with race conditions in debounced persistence and premature snapshot cleanup.

---

## Issues Overview

| # | Issue | Component | Severity | Root Cause |
|---|-------|-----------|----------|------------|
| 1 | Spam restore creates ghost tabs | VisibilityHandler | **Critical** | No state:updated event when snapshot missing |
| 2 | Storage persists wrong minimized count | VisibilityHandler | **Critical** | Entity minimized flag never updated after restore |
| 3 | Duplicate windows at wrong position | DragController + VisibilityHandler | **High** | Stale drag callbacks fire after minimize + wrong position saved |
| 4 | Manager button doesn't disable | Manager Panel UI | **Medium** | Missing UI state check for already-restored tabs |
| 5 | Snapshot cleared too early | UICoordinator | **High** | Cleared immediately after render, before spam-click window |
| 6 | Storage persists before DOM renders | VisibilityHandler | **Medium** | 50ms race between debounce (150ms) and state event (200ms) |
| 7 | Entity minimized flag desync | VisibilityHandler + UICoordinator | **Critical** | Three-way state split - no single source of truth |

**Why bundled:** All issues stem from state synchronization failures in the minimize/restore pipeline and affect the same Quick Tab state visibility architecture. Fixing requires coordinated changes to VisibilityHandler, UICoordinator, and MinimizedManager state propagation.

<scope>
**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (`handleRestore`, `handleMinimize`, `_emitRestoreStateUpdate`, `_debouncedPersist`)
- `src/features/quick-tabs/coordinators/UICoordinator.js` (`_finalizeRender`, `update`, `_handleManagerMinimize`)
- `src/features/quick-tabs/managers/MinimizedManager.js` (snapshot lifecycle)
- `src/features/quick-tabs/window/DragController.js` (callback cleanup on destroy)
- Manager Panel UI component (restore button state)

**Do NOT Modify:**
- `src/utils/storage-utils.js` (buildStateForStorage is correct, problem is input data)
- `src/features/quick-tabs/window.js` (QuickTabWindow.restore() is correct)
- Background script or message handlers
</scope>

---

## Issue 1: Spam Restore Creates Ghost Tabs (No state:updated Event)

### Problem
When user spam-clicks restore button after first restore completes, VisibilityHandler finds no snapshot (already cleared) and returns early WITHOUT emitting a state:updated event. UICoordinator never gets notified, leaving tab in ghost state where entity.minimized=true but no DOM exists and no snapshot available.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleRestore()` lines 345-375  
**Issue:** Early return when snapshot not found prevents state:updated emission

The handleRestore method calls minimizedManager.restore() which returns null when snapshot doesn't exist. The function then returns early at line 365 without calling `_emitRestoreStateUpdate()`. This leaves UICoordinator in the dark - it never knows a restore was attempted.

**Evidence from logs:**
```
03:10:55.511 - MinimizedManager: Cleared snapshot after successful render
03:10:56.675 - MinimizedManager: No snapshot found for restore
03:10:56.675 - WARN VisibilityHandler: Tab not found in minimized manager
03:10:56.675 - Content: Restored Quick Tab (MISLEADING - nothing was restored!)
(NO UICoordinator logs - never received state:updated event)
```

### Fix Required
When snapshot is not found during restore, VisibilityHandler MUST still emit a state:updated event to notify UICoordinator that a restore was attempted. The event should include a flag indicating "no snapshot available" so UICoordinator can handle appropriately (log warning, attempt render from entity state, or skip).

Alternatively, add defensive check: if entity.minimized is false AND no snapshot exists, emit state:updated with isRestoreOperation=true to trigger UICoordinator's unified fresh render path which can handle missing snapshots.

---

## Issue 2: Storage Persists Wrong Minimized Count

### Problem
After restore completes, storage still shows "2 tabs (2 minimized)" when it should be "2 tabs (1 minimized)". The entity's minimized flag is never updated from true to false, causing all downstream operations to see incorrect state.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleRestore()` line 366, `_persistToStorage()` lines 456-485  
**Issue:** Only instance state updated, entity state ignored

The restore flow is:
1. `minimizedManager.restore(id)` - removes from minimizedTabs Map, applies snapshot to instance
2. `tabWindow.restore()` - sets `instance.minimized = false`
3. **ENTITY in quickTabsMap NEVER updated** - still has `minimized: true`
4. `_debouncedPersist()` calls `buildStateForStorage(quickTabsMap, minimizedManager)`
5. buildStateForStorage reads from quickTabsMap ENTITIES, finds entity.minimized=true
6. Storage persists with wrong minimized count

**Evidence from logs:**
```
03:10:55.306 - QuickTabWindow: restore() called
03:10:55.306 - QuickTabWindow: Restored (state updated) <-- INSTANCE updated
03:10:55.463 - VisibilityHandler: Persisting 2 tabs (2 minimized) <-- SHOULD BE 1!
```

**File:** `src/utils/storage-utils.js`  
**Location:** `buildStateForStorage()` line 105  
**Context:** Function reads `minimizedManager.isMinimized(tab.id)` which returns false (tab was removed from minimizedTabs), but the entity object in quickTabsMap STILL has its minimized property set to true from when it was first minimized.

### Fix Required
After calling `tabWindow.restore()`, VisibilityHandler MUST update the entity object in quickTabsMap to set its minimized flag to false. The entity is the source of truth for storage persistence. Instance state alone is insufficient.

Pattern to follow: Locate the entity in quickTabsMap by ID, update its minimized property to false, THEN proceed with debounced persistence. This ensures buildStateForStorage reads correct entity state.

---

## Issue 3: Duplicate Windows at Wrong Position (Stale Drag Callbacks)

### Problem
User described seeing duplicate Quick Tab windows appear at the "initial position where original Quick Tab was created" rather than the saved position. This happens when spam-clicking minimize/restore while a drag operation is in progress.

### Root Cause

**File:** `src/features/quick-tabs/window/DragController.js` (not retrieved but inferred)  
**Location:** Callback wiring in QuickTabWindow render() + DragController.destroy()  
**Issue:** Old drag callbacks remain in event queue after destroy() is called

Timeline from logs:
```
03:11:02.473 - Restore starts, NEW window created
03:11:02.627 - QuickTabWindow render() wires NEW DragController
(User spam-clicks minimize/restore for 18 seconds)
03:11:20.885 - Minimize called, DragController.destroy() removes listeners
03:11:28.133 - OLD drag callback FIRES 25.66 seconds after drag started!
03:11:28.133 - onPositionChangeEnd saves position for ALREADY MINIMIZED tab
```

When minimize() calls `dragController.destroy()`, it removes event listeners but does NOT cancel pending callbacks already in the browser's event queue. If a `pointerup` or `pointercancel` event is delayed (browser busy, tab switch, etc.), the callback fires AFTER the window was minimized and destroyed.

The callback then saves the WRONG position - either the stale drag position OR the initial creation position (848, 541) from logs. When user restores again, UICoordinator reads this corrupted position from storage and renders at the wrong location.

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_debouncedPersist()` timing  
**Contributing factor:** Storage persist happens 150ms after minimize, but stale callback fires 6+ seconds later and triggers ANOTHER storage write with wrong position.

### Fix Required
DragController.destroy() must set an internal destroyed flag that ALL callbacks check before executing. If destroyed=true, callbacks should early-return without calling onPositionChangeEnd or updating any state.

Additionally, VisibilityHandler should verify tab is NOT minimized before accepting position updates from UpdateHandler. If entity.minimized=true, ignore the position update and log a warning about stale callback.

---

## Issue 4: Manager Panel Doesn't Disable Restore Button

### Problem
Manager Panel allows spam-clicking the restore button even when tab is already restored and DOM is visible. There's no disabled state or visual feedback to prevent the spam-click scenario.

### Root Cause

**File:** Manager Panel UI component (path unknown)  
**Location:** Restore button click handler  
**Issue:** No check for tab's current state before enabling restore button

The Manager Panel shows minimize/restore buttons but doesn't verify whether the tab is ALREADY in the desired state. It allows clicking restore on a tab that was restored 1 second ago, which triggers the "No snapshot found" path.

### Fix Required
Manager Panel must check tab state before enabling/disabling buttons:
- If entity.minimized=false AND DOM exists (renderedTabs.has(id)): disable restore button, enable minimize button
- If entity.minimized=true: enable restore button, disable minimize button
- If operation lock is held (restore/minimize in progress): disable BOTH buttons temporarily

Follow pattern from other UI components that grey out buttons during pending operations.

---

## Issue 5: Snapshot Cleared Too Early (Spam-Click Window)

### Problem
Snapshot is cleared immediately after first successful restore, leaving no tolerance for spam-clicks that might occur within the next second. If user double-clicks restore (common UI behavior), second click finds no snapshot and fails silently.

### Root Cause

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_finalizeRender()` lines 219-227  
**Issue:** clearSnapshot() called immediately after renderedTabs.set()

The flow is:
```
03:10:55.511 - renderedTabs.set() adds window to Map
03:10:55.511 - MinimizedManager: Cleared snapshot from minimizedTabs (IMMEDIATELY!)
03:10:56.675 - Second restore click (1.16 seconds later)
03:10:56.675 - MinimizedManager: No snapshot found
```

Only 1.16 seconds elapsed between first restore completing and second restore attempt. This is well within typical double-click timing (user might think first click didn't register). Clearing snapshot immediately eliminates safety buffer.

### Fix Required
Delay snapshot clearing by 300-500ms after render completes to allow for accidental double-clicks. Use setTimeout to schedule clearSnapshot() after a short grace period.

Alternatively, keep snapshot for 1-2 seconds and only clear it when:
1. Tab is minimized again (new snapshot replaces old), OR
2. Grace period expires without new restore attempts

This provides tolerance for UI race conditions and user double-clicks without keeping stale data indefinitely.

---

## Issue 6: Storage Persists Before DOM Renders (50ms Race)

### Problem
VisibilityHandler persists state to storage 157ms after restore starts, but UICoordinator doesn't receive state:updated event until 203ms (46ms gap). During this window, storage says tab is restored but DOM doesn't exist yet.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_debouncedPersist()` timing constants  
**Issue:** MINIMIZE_DEBOUNCE_MS (150ms) < STATE_EMIT_DELAY_MS (200ms)

Timeline:
```
03:10:55.306 - handleRestore() starts
03:10:55.463 - Storage persist completes (157ms elapsed) <-- DEBOUNCE 150ms
03:10:55.509 - UICoordinator receives state:updated (203ms elapsed) <-- DELAY 200ms
03:10:55.511 - DOM render completes
```

The 50ms gap creates race where spam-clicking restore during this window triggers "No snapshot found" because:
1. Storage already shows restored (minimized=false)
2. But DOM doesn't exist yet
3. Snapshot was cleared after first restore

### Fix Required
Ensure STATE_EMIT_DELAY_MS < MINIMIZE_DEBOUNCE_MS so state:updated event fires BEFORE storage persistence. This guarantees UICoordinator has rendered DOM before storage write commits the new state.

Suggested values:
- STATE_EMIT_DELAY_MS = 100ms (give DOM time to attach)
- MINIMIZE_DEBOUNCE_MS = 200ms (ensure state event fires first)

This eliminates race condition while maintaining debouncing benefit.

---

## Issue 7: Three-Way State Desynchronization (Entity vs Instance vs Snapshot)

### Problem
The extension maintains three separate representations of minimized state that can diverge:
1. **Instance state:** `tabWindow.minimized` - updated by tabWindow.restore()
2. **Entity state:** `entity.minimized` in quickTabsMap - NEVER updated by VisibilityHandler
3. **Snapshot state:** MinimizedManager.minimizedTabs Map - cleared after restore

When these get out of sync, all logic breaks down because different components read different sources of truth.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js` + `UICoordinator.js`  
**Location:** Entire minimize/restore pipeline  
**Issue:** No single source of truth, no synchronization between states

VisibilityHandler updates instance and snapshot but ignores entity. UICoordinator reads entity for decisions but doesn't update it. buildStateForStorage reads entity but cross-checks with MinimizedManager, leading to inconsistencies.

**Example from logs:**
After first restore at 03:10:55:
- Instance state: `minimized = false` ✓
- Entity state: `minimized = true` ✗ (never updated)
- Snapshot state: cleared (removed from minimizedTabs) ✓
- Storage: "2 tabs (2 minimized)" ✗ (entity read during buildStateForStorage)

### Fix Required
Establish entity state as single source of truth. All operations must update entity FIRST, then synchronize instance and snapshot:

**Restore flow should be:**
1. Update entity.minimized = false in quickTabsMap
2. Update instance.minimized = false via tabWindow.restore()
3. Clear snapshot from MinimizedManager
4. Emit state:updated event
5. Persist to storage (reads updated entity)

**Minimize flow should be:**
1. Update entity.minimized = true in quickTabsMap
2. Update instance.minimized = true via tabWindow.minimize()
3. Add snapshot to MinimizedManager
4. Emit state:updated event
5. Persist to storage

This ensures all three states stay synchronized and buildStateForStorage always reads correct entity state.

---

## Shared Implementation Notes

- All entity updates must happen in quickTabsMap by retrieving entity via ID and directly modifying its properties
- Entity is a plain JavaScript object, not a class instance, so direct property assignment is correct approach
- After updating entity state, verify change took effect before proceeding with storage persist
- Debounce timing constants must ensure state events fire BEFORE storage writes (reversed from current)
- Snapshot clearing should be delayed by grace period to handle accidental double-clicks
- DragController and ResizeController must check destroyed flag in ALL callbacks
- Manager Panel button state must reflect actual tab state from both entity AND renderedTabs Map

<acceptancecriteria>
**Issue 1:**
- Spam-clicking restore emits state:updated event even when snapshot not found
- UICoordinator receives event and logs appropriate warning
- No silent failures that leave tab in ghost state

**Issue 2:**
- After restore, storage shows correct minimized count (e.g., "2 tabs (1 minimized)")
- Entity.minimized flag updated to false in quickTabsMap after restore
- buildStateForStorage reads updated entity state

**Issue 3:**
- Drag callbacks check destroyed flag before executing
- Stale callbacks after minimize do NOT save position updates
- Restored tabs appear at saved position, never at initial creation position

**Issue 4:**
- Manager Panel restore button disabled when tab already restored
- Button states update dynamically based on actual tab state
- No spam-clicking possible during operation locks

**Issue 5:**
- Snapshot retained for 300-500ms after render to allow double-clicks
- Accidental double-click restore succeeds without "No snapshot found" error

**Issue 6:**
- state:updated event fires BEFORE storage persistence
- No race condition window where storage shows restored but DOM missing
- Timing constants: STATE_EMIT_DELAY_MS < MINIMIZE_DEBOUNCE_MS

**Issue 7:**
- Entity state always matches instance state after minimize/restore
- Single source of truth for minimized flag (entity in quickTabsMap)
- All three states (entity, instance, snapshot) synchronized after every operation

**All Issues:**
- All existing tests pass
- No console errors or warnings during minimize/restore operations
- Manual test: Spam-click restore 5 times rapidly - no ghost tabs, no duplicates, correct positions
- Manual test: Minimize during active drag - no position corruption after drag completes
</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Log Evidence: First Restore Success</summary>

```
03:10:55.305 - VisibilityHandler: Handling restore (source: Manager)
03:10:55.305 - MinimizedManager: restore() snapshot lookup found
03:10:55.306 - QuickTabWindow: restore() called - Container is null (expected)
03:10:55.306 - VisibilityHandler: Called tabWindow.restore()
03:10:55.463 - VisibilityHandler: Persisting 2 tabs (2 minimized) <-- WRONG COUNT
03:10:55.509 - UICoordinator: Received state:updated event
03:10:55.509 - UICoordinator: Rendering tab via unified fresh render path
03:10:55.511 - renderedTabs.set() mapSizeAfter: 1
03:10:55.511 - MinimizedManager: Cleared snapshot after successful render
```

First restore works correctly EXCEPT entity.minimized is never updated to false.

</details>

<details>
<summary>Log Evidence: Second Restore Fails</summary>

```
03:10:56.675 - Content: Received RESTORE_QUICK_TAB request (1.37 seconds after first)
03:10:56.675 - VisibilityHandler: Handling restore (source: Manager)
03:10:56.675 - MinimizedManager: No snapshot found for restore
03:10:56.675 - WARN VisibilityHandler: Tab not found in minimized manager
03:10:56.675 - Content: Restored Quick Tab (MISLEADING LOG!)
(NO UICoordinator logs - state:updated event NEVER emitted)
```

Second restore finds no snapshot (cleared 1.16 seconds ago) and fails silently without notifying UICoordinator.

</details>

<details>
<summary>Log Evidence: Stale Drag Callback</summary>

```
03:11:02.473 - QuickTabWindow: restore() called during active drag
03:11:02.627 - QuickTabWindow: render() creates NEW DragController
(User spam-clicks minimize/restore for 18 seconds)
03:11:20.885 - Minimize called, DragController.destroy() removes listeners
03:11:21.828 - Tab minimized AGAIN (spam-clicking continues)
03:11:28.133 - QuickTabWindow: Drag ended (STALE callback from 03:11:02!)
03:11:28.133 - QuickTabWindow: Calling onPositionChangeEnd callback
03:11:28.133 - UpdateHandler: handlePositionChangeEnd called
```

Drag callback fires 25.66 seconds after drag started and 6+ seconds after tab was minimized.

</details>

<details>
<summary>Architecture Context: State Representation Split</summary>

The extension maintains three separate state representations:

**1. Instance State (tabWindow object):**
- Managed by QuickTabWindow class
- Properties: minimized, left, top, width, height
- Updated by: tabWindow.minimize(), tabWindow.restore()
- Read by: isRendered(), DOM manipulation methods

**2. Entity State (quickTabsMap):**
- Plain JavaScript objects stored in Map
- Properties: id, url, minimized, position {left, top}, size {width, height}
- Updated by: CreateHandler (on create), UpdateHandler (position/size), VisibilityHandler (SHOULD update minimized but doesn't!)
- Read by: buildStateForStorage(), UICoordinator decision logic

**3. Snapshot State (MinimizedManager):**
- Temporary storage during minimize/restore
- Properties: savedPosition {left, top}, savedSize {width, height}
- Updated by: MinimizedManager.add() on minimize, MinimizedManager.restore() applies and clears
- Read by: VisibilityHandler.handleRestore(), UICoordinator._applySnapshotForRestore()

The root architectural flaw: entity state is treated as read-only by VisibilityHandler, but it's the source of truth for storage persistence. This creates immediate desync on every restore operation.

</details>

---

## Missing Logging

1. **No logging for entity.minimized flag updates** - Cannot verify when/if VisibilityHandler updates entity after restore
2. **No logging showing which window instance is rendered** - Cannot tell if UICoordinator creates NEW instance or reuses existing
3. **No logging for Manager Panel button state changes** - Cannot see when buttons should be disabled/enabled
4. **No logging for DragController destroyed flag check** - Cannot verify callbacks are checking destroyed state
5. **No logging for spam-restore path** - When no snapshot found, VisibilityHandler doesn't log WHY it's not emitting state:updated
6. **No logging for storage state entity values** - See "2 minimized" but don't see actual entity.minimized values
7. **No logging for rendered position after restore** - Missing "DOM dimensions AFTER position correction" log in some restore operations

**Recommended additions:**
- Log entity state BEFORE and AFTER minimize/restore operations in VisibilityHandler
- Log DragController callback execution with destroyed flag status
- Log Manager Panel button state transitions (enabled → disabled → enabled)
- Log all three state representations (entity, instance, snapshot) after critical operations
- Log reason for skipping state:updated emission (e.g., "No snapshot but entity already restored")

---

**Priority:** Critical (Issues 1, 2, 7), High (Issues 3, 5), Medium (Issues 4, 6)  
**Target:** Single coordinated PR fixing all state synchronization issues  
**Estimated Complexity:** High - requires careful state flow refactoring across multiple components