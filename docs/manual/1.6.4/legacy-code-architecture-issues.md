# Legacy Code Architecture Issues - State Communication Interference

**Extension Version:** v1.6.3.5-v4  
**Date:** 2025-12-03  
**Scope:** Deprecated cross-tab sync code, legacy state mutation paths, and architectural remnants that interfere with modern state communication pipeline

---

## Executive Summary

The Quick Tabs codebase contains multiple legacy code paths from the pre-v1.6.3 cross-tab synchronization architecture that remain active and can interfere with the current single-tab state communication model. These deprecated paths include direct geometry mutation methods in QuickTabWindow, parallel persistence pipelines in StateManager, global singleton access patterns, and residual cross-tab sync metadata. While individually these may appear benign, they collectively create multiple competing channels for state updates that bypass the modern handlers → UICoordinator → storage-utils pipeline, leading to state desynchronization and unpredictable behavior.

**Impact:** State changes can occur through legacy side channels that bypass validation, debouncing, ownership checks, and transaction tracking. This causes entity/DOM/storage desync, storage write storms from parallel persistence paths, and silent failures when old code mutates state without proper event emission.

---

## Issues Overview

| # | Issue | Component | Severity | Root Cause |
|---|-------|-----------|----------|------------|
| 1 | Legacy geometry mutation methods bypass handlers | QuickTabWindow | High | setPosition/setSize/updatePosition/updateSize provide direct state access |
| 2 | Global currentTabId access creates coupling | QuickTabWindow solo/mute | Medium | Solo/mute reads window.quickTabsManager.currentTabId directly |
| 3 | Parallel persistence pipelines conflict | StateManager vs storage-utils | Critical | Two independent write paths to same storage key |
| 4 | Legacy cross-tab sync metadata misleads | QuickTabWindow, multiple files | Medium | Comments and fields suggest cross-tab sync is still active |
| 5 | Backward-compat API exposes dangerous mutations | QuickTabsManager facade | High | Public API allows state manipulation bypassing handlers |
| 6 | Residual timestamp fields unused by new architecture | QuickTabWindow lastPositionUpdate/lastSizeUpdate | Low | Dead metadata that could be misused for sync logic |

**Why bundled:** All issues stem from incomplete migration from cross-tab sync architecture to single-tab model. Legacy code paths remain active and create competing state update channels that conflict with new handler-based architecture.

---

<scope>
**Modify:**
- `src/features/quick-tabs/window.js` (deprecate legacy sync methods, remove global access)
- `src/features/quick-tabs/managers/StateManager.js` (route persistence through storage-utils)
- `src/features/quick-tabs/index.js` (restrict public API to read-only where possible)

**Do NOT Modify:**
- `src/utils/storage-utils.js` (new persistence pipeline is correct, keep as-is)
- Handler files (CreateHandler, UpdateHandler, VisibilityHandler, DestroyHandler) - these are the correct paths
- UICoordinator (single rendering authority, correct architecture)
</scope>

---

## Issue 1: Legacy Geometry Mutation Methods Bypass Handlers

**Problem:**  
QuickTabWindow exposes direct geometry mutation methods (`setPosition`, `setSize`, `updatePosition`, `updateSize`) that were originally created for cross-tab synchronization. These methods allow external code to mutate window position and size without going through UpdateHandler, bypassing debouncing, validation, event emission, and storage persistence. If any code (including test harnesses, panel logic, or leftover sync modules) calls these methods directly, state changes occur invisibly to the rest of the architecture.

**Root Cause:**

**File:** `src/features/quick-tabs/window.js`  
**Location:** Lines 765-802 (setPosition, setSize, updatePosition, updateSize methods)  
**Issue:** These methods directly mutate instance properties (`this.left`, `this.top`, `this.width`, `this.height`) and DOM styles (`this.container.style.*`) without involving UpdateHandler or emitting state change events. Comments explicitly state they are "for sync from other tabs" and "for cross-tab sync via UICoordinator.update", indicating they were designed for the deprecated cross-tab architecture.

**Current Architecture:**  
The modern flow for geometry updates is:
1. User drags/resizes via DragController/ResizeController
2. Controllers call callbacks (onPositionChange, onSizeChange, onPositionChangeEnd, onSizeChangeEnd)
3. Callbacks route to QuickTabsManager methods (handlePositionChange, handleSizeChange, etc.)
4. Manager delegates to UpdateHandler
5. UpdateHandler updates entity state, emits events, triggers storage persist

**Legacy Flow Still Possible:**  
Any code can call `window.quickTabsManager.getQuickTab(id).setPosition(x, y)` and bypass steps 2-5 entirely. The window moves on screen but no event fires, no storage write occurs, UICoordinator doesn't know about the change, and Manager sidebar shows stale position.

**Why This Happens:**  
These methods were never removed or deprecated when cross-tab sync was eliminated in v1.6.3. They remain as public methods on QuickTabWindow instances, accessible to any code holding a reference. Additionally, `updatePosition` and `updateSize` add timestamp tracking (`lastPositionUpdate`, `lastSizeUpdate`) which suggests they were intended for conflict resolution in cross-tab scenarios - but these timestamps are not integrated into the current storage or event system.

**Evidence from Code:**  
Method comments explicitly reference legacy architecture:
```
Set position of Quick Tab window (v1.5.8.13 - for sync from other tabs)
```
```
Update position of Quick Tab window (Bug #3 Fix - UICoordinator compatibility)
v1.6.2.3 - Added for cross-tab sync via UICoordinator.update()
```

**Fix Required:**  
Mark setPosition, setSize, updatePosition, and updateSize as internal-only or deprecated. Add console warnings when called to identify any remaining usage. Ensure all geometry updates from external sources (panel, sidebar, keyboard shortcuts) route through UpdateHandler. If UICoordinator still needs to apply position/size from storage during restore, it should create new QuickTabWindow instances with correct geometry rather than mutating existing instances via these methods.

---

## Issue 2: Global currentTabId Access Creates Tight Coupling

**Problem:**  
QuickTabWindow's solo/mute toggle logic reads `window.quickTabsManager.currentTabId` directly from the global singleton rather than using the currentTabId value tracked by VisibilityHandler and UICoordinator. This creates tight coupling to global state and a potential divergence point where QuickTabWindow's notion of "current tab" differs from what the handlers believe.

**Root Cause:**

**File:** `src/features/quick-tabs/window.js`  
**Location:** Methods `isCurrentTabSoloed`, `isCurrentTabMuted`, `_validateCurrentTabId`, toggleSolo, toggleMute (lines 726-904)  
**Issue:** Solo/mute toggle methods access global state directly:
```
window.quickTabsManager && 
window.quickTabsManager.currentTabId && 
this.soloedOnTabs.includes(window.quickTabsManager.currentTabId)
```

This pattern appears in multiple locations checking whether current tab is soloed or muted. The solo/mute toggle methods call `_validateCurrentTabId` which returns `window.quickTabsManager.currentTabId` or null.

**Why This Is Problematic:**  
The modern architecture passes `currentTabId` explicitly through constructor options to StateManager, VisibilityHandler, and UICoordinator. These components maintain their own references to `currentTabId` and use them for visibility filtering and ownership validation. When QuickTabWindow reaches back into the global `window.quickTabsManager` for `currentTabId`, several issues arise:

1. **Timing/Initialization**: If solo/mute buttons are clicked before `window.quickTabsManager` is fully initialized (e.g., during hydration), `currentTabId` may be null or stale, causing silent no-ops.

2. **Divergence**: If `window.quickTabsManager.currentTabId` is updated but handlers haven't been notified, or vice versa, QuickTabWindow makes solo/mute decisions based on different tab ID than what VisibilityHandler expects.

3. **Testability**: Tests that inject QuickTabWindow instances without initializing global `window.quickTabsManager` will fail or exhibit unexpected behavior in solo/mute features.

**Evidence from Code:**  
v1.5.9.13 era code from before facade refactoring, when QuickTabsManager was monolithic:
```
Check if current tab is in solo list
v1.5.9.13 - Check if current tab is in mute list
```

These predate the handler extraction and were designed when reaching back into the manager was the only option.

**Fix Required:**  
Pass `currentTabId` to QuickTabWindow via constructor options or as a parameter to solo/mute methods. Store it as instance property `this.currentTabId` updated via a setter method when tab changes. Remove all `window.quickTabsManager.currentTabId` references from QuickTabWindow. Ensure solo/mute state changes continue to use `onSolo`/`onMute` callbacks which properly route through VisibilityHandler.

---

## Issue 3: Parallel Persistence Pipelines Conflict

**Problem:**  
StateManager has its own direct `browser.storage.local.set` persistence logic (`persistToStorage` method) that bypasses the new transaction-based persistence pipeline in `storage-utils.js`. This creates two independent write paths to the same storage key, causing write conflicts, missing transaction IDs, and bypassed self-write detection. When StateManager writes occur simultaneously with VisibilityHandler/DestroyHandler writes, last-write-wins semantics cause data loss.

**Root Cause:**

**File:** `src/features/quick-tabs/managers/StateManager.js`  
**Location:** `persistToStorage` method (lines 35-53) and callers (add, update, delete, clear)  
**Issue:** StateManager directly calls `browser.storage.local.set` with plain state object:
```
await browser.storage.local.set({ [STATE_KEY]: state });
```

This write operation:
- Has no transaction ID for self-write detection
- Bypasses `queueStorageWrite` FIFO ordering
- Doesn't use `hasStateChanged` hash deduplication
- Ignores ownership validation (`validateOwnershipForWrite`)
- Skips state validation (`validateStateForPersist`)
- Doesn't respect empty-write cooldown protection

Meanwhile, handlers use the modern pipeline:
```
persistStateToStorage(state, logPrefix, forceEmpty)
  → validates state
  → checks ownership
  → checks hash changes
  → generates transaction ID
  → queues write via queueStorageWrite
```

**Why Two Pipelines Exist:**  
StateManager was originally responsible for all Quick Tab state management before the Phase 2 refactoring. When handlers were extracted (CreateHandler, UpdateHandler, VisibilityHandler, DestroyHandler), each handler got its own persistence logic using the new `storage-utils.js` pipeline. However, StateManager kept its original `persistToStorage` implementation for backward compatibility with sidebar/panel code that uses `StateManager.add/update/delete` directly.

**Consequences:**  
1. **Transaction ID Mismatch**: StateManager writes lack transaction IDs, causing other tabs' `storage.onChanged` handlers to always process these writes (can't detect as self-writes from same instance).

2. **Write Collisions**: StateManager write can overwrite handler write if both execute within same event loop tick, since StateManager doesn't respect the FIFO queue.

3. **Duplicate Writes**: StateManager write triggers `storage.onChanged` → handlers may respond by writing again → cascade.

4. **Lost Updates**: Handler write persists geometry change at time T, StateManager write at time T+50ms with stale geometry from before the change → newer data lost.

**Evidence from Logs:**  
Storage write storms frequently show alternating transaction IDs from handlers (txn-XXX-*) and no-transaction-ID writes that must be from StateManager or other direct callers.

**Fix Required:**  
Replace StateManager's `persistToStorage` implementation with a call to the centralized `persistStateToStorage` from `storage-utils.js`. Ensure StateManager builds state using the same `buildStateForStorage` function handlers use. This consolidates all persistence through one pipeline with consistent transaction tracking, validation, and queuing.

---

## Issue 4: Legacy Cross-Tab Sync Metadata Misleads

**Problem:**  
Multiple comments and field names throughout the codebase reference "cross-tab sync" even though this feature was removed in v1.6.3. These references mislead contributors into thinking cross-tab synchronization is still active or partially supported, encouraging misuse of deprecated APIs and creation of new code that relies on non-existent sync infrastructure.

**Root Cause:**

**Files:** `src/features/quick-tabs/window.js`, `src/features/quick-tabs/managers/StateManager.js`, `src/utils/storage-utils.js`  
**Location:** Comments and field names scattered throughout  
**Issue:** Numerous references to cross-tab behavior remain:

In QuickTabWindow:
- Constructor comment: "Track update timestamps for cross-tab sync"
- Field definitions: `lastPositionUpdate`, `lastSizeUpdate` with "v1.6.2.3 - Track update timestamps for cross-tab sync"
- Method comments: "for sync from other tabs", "for cross-tab sync via UICoordinator.update"

In storage-utils.js:
- `originTabId` field introduced "for cross-tab filtering" but now used for ownership validation
- Comments referencing "other tabs" in context where single-tab behavior is expected

**Why This Is Problematic:**  
1. **Contributor Confusion**: New developers reading these comments may attempt to restore or extend cross-tab functionality by using these fields/methods, reintroducing race conditions and synchronization bugs.

2. **Dead Metadata**: Fields like `lastPositionUpdate` and `lastSizeUpdate` are set during `updatePosition`/`updateSize` calls but never read by any current code. They consume memory and could be mistaken for active conflict resolution timestamps.

3. **Ambiguous Intent**: Some fields serve dual purposes (e.g., `originTabId` was for cross-tab rendering, now for ownership) but comments don't clarify the migration, leaving unclear which interpretation is correct.

4. **Testing Confusion**: Tests written based on these comments may make incorrect assumptions about behavior, leading to test cases that verify deprecated functionality instead of current architecture.

**Evidence from Code:**  
Direct quotes from source files showing cross-tab references despite v1.6.3 removing cross-tab sync feature.

**Fix Required:**  
Audit all comments referencing "cross-tab", "sync from other tabs", "sync independently", and similar phrases. Update comments to clarify current behavior (single-tab ownership model). Remove or deprecate fields that are no longer used (`lastPositionUpdate`, `lastSizeUpdate`). Where fields like `originTabId` have migrated to new purposes, update docstrings to explain current usage (ownership validation) and remove references to old usage (cross-tab rendering).

---

## Issue 5: Backward-Compat API Exposes Dangerous Mutations

**Problem:**  
QuickTabsManager facade exposes a large backward-compatibility public API with methods that allow direct manipulation of Quick Tab state without going through the handler pipeline. Old panel code, sidebar logic, or external modules using these legacy methods can bypass validation, debouncing, and persistence, causing invisible state changes.

**Root Cause:**

**File:** `src/features/quick-tabs/index.js`  
**Location:** Public API methods (lines 700-900+), global exposure (lines 385-391)  
**Issue:** QuickTabsManager exposes itself globally via `window.quickTabsManager` and provides many legacy methods that appear to support direct state manipulation:

Public Mutation Methods:
- `getQuickTab(id)` - returns QuickTabWindow instance with all mutation methods accessible
- `getAllQuickTabs()` - returns array of instances, each with mutation methods
- `updateQuickTabPosition(id, left, top)` - marked deprecated but still callable
- `updateQuickTabSize(id, width, height)` - marked deprecated but still callable
- `closeById(id)` - delegates to DestroyHandler but could be called redundantly
- `restoreById(id)` - delegates to VisibilityHandler but could be called redundantly
- `minimizeById(id)` - delegates to VisibilityHandler but could be called redundantly

Additionally, getting a QuickTabWindow instance via `getQuickTab` exposes all of Issue #1's legacy methods (setPosition, setSize, etc.) plus direct access to state properties.

**Why This Is Problematic:**  
1. **Multiple Entry Points**: State can be changed via handlers (correct) OR via legacy public API (incorrect), creating confusion about which path is canonical.

2. **Bypass Protections**: Code calling `updateQuickTabPosition` directly avoids UpdateHandler's debouncing, storage persistence, and event emission. Change occurs but Manager sidebar doesn't update because no event fired.

3. **Global Mutability**: Any script with access to `window` object can manipulate Quick Tabs state, making it difficult to reason about who is changing what and when.

4. **Test Leakage**: Tests that rely on these public methods may pass but not reflect real-world usage if production code uses handlers instead, or vice versa.

**Current Architecture Intent:**  
The facade pattern was introduced to hide implementation details and provide clean delegation to handlers. However, the backward-compatibility surface area was kept too large, allowing old patterns to persist. The intent is:
- Handlers (CreateHandler, UpdateHandler, VisibilityHandler, DestroyHandler) are the **only** authorized mutators
- QuickTabsManager facade delegates to handlers, providing a clean API
- External code should use only the high-level methods (createQuickTab, handleMinimize, etc.)
- Direct access to QuickTabWindow instances should be for read-only inspection, not mutation

**Fix Required:**  
Mark legacy mutation methods as deprecated with console warnings when called. Remove or make internal the methods that duplicate handler functionality (updateQuickTabPosition, updateQuickTabSize). Change `getQuickTab` and `getAllQuickTabs` to return read-only proxies or DTO objects instead of live QuickTabWindow instances. Audit all internal and external callers to ensure they use handler-based APIs only.

---

## Issue 6: Residual Timestamp Fields Unused by Architecture

**Problem:**  
QuickTabWindow maintains `lastPositionUpdate` and `lastSizeUpdate` timestamp fields that are set during geometry updates but never read or used by any component in the current architecture. These fields consume memory and create false impression that timestamp-based conflict resolution is active.

**Root Cause:**

**File:** `src/features/quick-tabs/window.js`  
**Location:** `_initializeState` (lines 120-121), `updatePosition` (line 795), `updateSize` (line 809)  
**Issue:** Fields are defined in constructor and set during geometry updates:
```
this.lastPositionUpdate = null;
this.lastSizeUpdate = null;

updatePosition(left, top) {
  this.setPosition(left, top);
  this.lastPositionUpdate = Date.now();
}
```

However, no code anywhere in the repository reads these fields. They were originally intended for cross-tab sync conflict resolution - when two tabs updated the same Quick Tab simultaneously, the tab with the newer timestamp would "win". Since cross-tab sync was removed, these timestamps serve no purpose.

**Why This Is Problematic:**  
1. **Dead Code**: Fields are written but never read, violating "You Ain't Gonna Need It" principle.

2. **Memory Waste**: Every QuickTabWindow instance carries two unused Number fields.

3. **Misleading**: Presence of timestamps suggests conflict resolution logic exists somewhere, causing confusion during debugging when developers search for their usage.

4. **Revival Risk**: Future contributor may see these fields and attempt to implement timestamp-based sync logic, reintroducing the exact cross-tab issues that were removed.

**Evidence from Code:**  
Comment explicitly states purpose: "v1.6.2.3 - Track update timestamps for cross-tab sync"  
But no code reads `lastPositionUpdate` or `lastSizeUpdate` anywhere in the repository.

**Fix Required:**  
Remove `lastPositionUpdate` and `lastSizeUpdate` field definitions and all assignments. If timestamp tracking is needed for future features (e.g., undo/redo history), implement it explicitly in a dedicated manager rather than as passive metadata on instances.

---

## Shared Implementation Notes

**Migration Strategy - Phased Approach:**

**Phase 1: Mark Legacy Paths as Deprecated**
- Add console warnings to all legacy mutation methods (setPosition, setSize, updatePosition, updateSize, updateQuickTabPosition, updateQuickTabSize)
- Add deprecation notices to method docstrings
- Monitor console logs to identify active usage

**Phase 2: Route to Modern Pipeline**
- Replace StateManager.persistToStorage implementation with call to storage-utils.persistStateToStorage
- Update solo/mute logic to accept currentTabId as parameter instead of reading from global
- Modify public API getQuickTab to return read-only proxy

**Phase 3: Remove Dead Code**
- Delete unused timestamp fields (lastPositionUpdate, lastSizeUpdate)
- Remove legacy mutation methods entirely
- Update all cross-tab comments to reflect single-tab architecture

**Key Constraints:**
- Maintain backward compatibility during Phase 1 to avoid breaking existing integrations
- All existing tests must pass without modification during Phases 1-2
- Phase 3 can break backward compatibility but requires version bump and migration guide

**Testing Strategy:**
- Add integration tests verifying that all state mutations go through handlers
- Add tests confirming no direct QuickTabWindow mutations occur during normal operations
- Monitor production logs for deprecation warnings to identify remaining legacy usage

---

<acceptancecriteria>
**Issue 1:**
- setPosition, setSize, updatePosition, updateSize log deprecation warnings when called
- All geometry updates route through UpdateHandler
- Tests confirm no direct QuickTabWindow mutation during normal operations

**Issue 2:**
- Solo/mute logic accepts currentTabId as parameter or instance field
- No references to window.quickTabsManager.currentTabId in QuickTabWindow
- Solo/mute operations continue to work correctly with explicit currentTabId

**Issue 3:**
- StateManager.persistToStorage uses storage-utils.persistStateToStorage internally
- All storage writes have transaction IDs and respect FIFO queue
- Storage write storms reduced by consolidating persistence pipeline

**Issue 4:**
- All comments referencing "cross-tab sync" updated to reflect single-tab model
- originTabId docstrings explain current usage (ownership validation)
- No references to deprecated cross-tab synchronization remain

**Issue 5:**
- Legacy mutation methods (updateQuickTabPosition, updateQuickTabSize) log deprecation warnings
- getQuickTab returns read-only view of state, not live mutable instance
- Audit confirms no production code uses deprecated public API

**Issue 6:**
- lastPositionUpdate and lastSizeUpdate fields removed entirely
- No dead timestamp tracking code remains
- Memory usage per QuickTabWindow instance reduced

**All Issues:**
- Existing tests pass without modification
- Integration tests confirm single canonical state update path
- Console logs clear during normal operations (no deprecation warnings)
- Documentation updated to reflect modern architecture only
</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Code Evidence: Legacy Geometry Mutation Methods</summary>

From `src/features/quick-tabs/window.js`:

```
Set position of Quick Tab window (v1.5.8.13 - for sync from other tabs)
@param {number} left - X position
@param {number} top - Y position

setPosition(left, top) {
  this.left = left;
  this.top = top;
  if (this.container) {
    this.container.style.left = `${left}px`;
    this.container.style.top = `${top}px`;
  }
}
```

```
Update position of Quick Tab window (Bug #3 Fix - UICoordinator compatibility)
v1.6.2.3 - Added for cross-tab sync via UICoordinator.update()

updatePosition(left, top) {
  this.setPosition(left, top);
  this.lastPositionUpdate = Date.now();
}
```

These methods directly mutate instance state and DOM without involving UpdateHandler, bypassing validation, events, and persistence.

</details>

<details>
<summary>Code Evidence: Global currentTabId Access</summary>

From `src/features/quick-tabs/window.js`:

```
v1.5.9.13 - Check if current tab is in solo list
isCurrentTabSoloed() {
  return (
    this.soloedOnTabs &&
    this.soloedOnTabs.length > 0 &&
    window.quickTabsManager &&
    window.quickTabsManager.currentTabId &&
    this.soloedOnTabs.includes(window.quickTabsManager.currentTabId)
  );
}
```

Solo/mute toggles directly access global singleton state instead of using passed-in currentTabId.

</details>

<details>
<summary>Code Evidence: Parallel Persistence Pipelines</summary>

From `src/features/quick-tabs/managers/StateManager.js`:

```
Persist current state to browser.storage.local
v1.6.3.1 - New method for cross-context sync (sidebar, manager, other tabs)

async persistToStorage() {
  try {
    const tabs = this.getAll().map(qt => qt.serialize());
    const state = {
      tabs: tabs,
      timestamp: Date.now(),
      saveId: this._generateSaveId()
    };
    await browser.storage.local.set({ [STATE_KEY]: state });
  }
}
```

Direct `browser.storage.local.set` call bypasses all new transaction tracking, validation, and queuing logic in storage-utils.js.

</details>

<details>
<summary>Architecture Context: Cross-Tab Sync Removal</summary>

From v1.6.3 release notes and code comments:

```
v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
v1.6.3 - Simplified for single-tab Quick Tabs (no cross-tab sync or storage persistence)
```

The entire cross-tab synchronization feature was removed to eliminate race conditions, storage storms, and state inconsistencies. However, many code paths and metadata from that era remain active, creating confusion and potential for reintroducing the same issues.

Current architecture enforces:
- Each tab manages only Quick Tabs it owns (originTabId matches currentTabId)
- No broadcasting of state changes to other tabs
- Storage used for persistence and hydration only, not for live cross-tab sync
- Single rendering authority (UICoordinator) per tab

Legacy code that assumes cross-tab coordination or allows remote state mutation violates these architectural principles.

</details>

<details>
<summary>Evidence: Unused Timestamp Fields</summary>

From `src/features/quick-tabs/window.js`:

Fields defined but never read:
```
_initializeState() {
  // ...
  // v1.6.2.3 - Track update timestamps for cross-tab sync
  this.lastPositionUpdate = null;
  this.lastSizeUpdate = null;
}
```

Written during updates:
```
updatePosition(left, top) {
  this.setPosition(left, top);
  this.lastPositionUpdate = Date.now();
}
```

No code anywhere reads `lastPositionUpdate` or `lastSizeUpdate`. Search across entire repository returns zero usage sites except where fields are set.

</details>

---

**Priority:** High (Issues 1, 3, 5), Medium (Issues 2, 4), Low (Issue 6)  
**Target:** Phased migration over 2-3 releases to maintain backward compatibility  
**Estimated Complexity:** Medium-High - requires careful deprecation strategy and thorough testing

---
