# Quick Tabs State Synchronization & Duplicate Prevention Issues

**Extension Version:** v1.6.3.5-v8  
**Date:** 2025-12-03  
**Scope:** Multiple critical bugs affecting state persistence, cross-tab coordination, and duplicate window prevention

---

## Executive Summary

Quick Tabs extension has **7 critical bugs** affecting state synchronization, duplicate window creation, and cross-tab coordination. The root cause is a **multi-instance storage war**: 6+ content script instances simultaneously write to the same `browser.storage.local` key with zero coordination, causing continuous storage corruption cycles. This affects minimize/restore operations, Manager UI synchronization, and creates duplicate Quick Tab windows. Additionally, missing duplicate prevention safeguards allow multiple windows with the same ID to exist simultaneously.

These issues were introduced in v1.6.3 when cross-tab sync infrastructure was removed but storage write coordination was not implemented as a replacement.

## Issues Overview

| # | Issue | Component | Severity | Root Cause |
|---|-------|-----------|----------|------------|
| 1 | Restored Quick Tabs "appear" cross-tab | Storage/UICoordinator | Medium | Storage corruption + Zen Browser split-screen |
| 2 | Yellow indicator + duplicate on 2nd minimize | Manager/VisibilityHandler | **Critical** | Storage race + orphaned window recovery failure |
| 3 | Position/size updates stop after restore | DragController/Window | **Critical** | Event listeners attached to stale element reference |
| 4 | Z-index broken after restore | UICoordinator/VisibilityHandler | High | CSS stacking context or DOM insertion order |
| 5 | Continuous "Last Sync" updates | Background/Storage | Medium | Storage thrash loop (3-7 second cycle) |
| 6 | "Clear Storage" doesn't clear Manager | Background/Content Scripts | High | Other tabs re-populate storage immediately |
| 7 | Duplicate Quick Tab windows | UICoordinator/Window | **Critical** | Missing `__quickTabWindow` property prevents recovery |

**Why bundled:** All issues stem from lack of storage write coordination and share the same architectural context. Can be fixed in coordinated PR with per-tab storage keys + duplicate prevention safeguards.

<scope>
**Modify:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` - Add duplicate detection, per-tab filtering
- `src/features/quick-tabs/handlers/VisibilityHandler.js` - Fix storage persistence
- `src/features/quick-tabs/window.js` - Add `__quickTabWindow` property, fix event listener attachment
- `src/features/quick-tabs/window/DragController.js` - Update element reference on re-render
- `src/utils/storage-utils.js` - Per-tab storage key implementation
- `src/background/background.js` - Coordinate "Clear All" operation

**Do NOT Modify:**
- `src/features/quick-tabs/managers/` - StateManager architecture is correct
- `src/features/quick-tabs/mediator.js` - Event bus working as designed
- Browser API imports - Standard WebExtension APIs
</scope>

---

## Issue #1: Restored Quick Tabs "Appear" in Other Tabs

### Problem
User reports Quick Tabs appearing in other browser tabs after restore, violating single-tab architecture. Investigation reveals this is NOT actual cross-tab rendering but **Zen Browser split-screen** showing the same tab in two panels + **storage corruption** making Quick Tabs vanish/reappear unpredictably.

### Root Cause

**File:** Multiple content scripts, all tabs  
**Location:** Storage write coordination (architecture-level issue)  
**Issue:** 6+ content script instances all write to `browser.storage.local` key `quick_tabs_state_v2` with zero coordination.

**Timeline:**
1. Tab 629 creates Quick Tab → writes `{tabs: 3}`
2. `storage.onChanged` fires in ALL other tabs (641, 650, 654, etc.)
3. Those tabs have empty `quickTabsMap` → build `{tabs: 0}`
4. They write empty state → **last write wins**
5. Tab 629's Quick Tabs disappear from storage
6. User interprets vanishing behavior as "cross-tab leaking"

**Evidence from logs:**
```
writingInstanceId: inst-1764808010615-c57afedb1548 (Tab 629)
writingInstanceId: inst-1764808001641-92c64e1aa98a (Tab 641)
writingInstanceId: inst-1764808001679-2be0e4dad8d0 (Tab 679)
... 3 more instances all writing to same key
```

### Fix Required

Implement **per-tab storage keys** to eliminate write conflicts:
- Each tab writes to `quick_tabs_tab_${tabId}` instead of shared key
- Manager aggregates from all tab keys
- Zero cross-tab write conflicts by design
- No BroadcastChannel needed for simple isolation

**Reference pattern:** Queue-based write coordination (Stack Overflow answer on Chrome storage race conditions) uses callback queue for sequential writes. Our simpler approach eliminates the problem entirely via namespace isolation.

---

## Issue #2: Yellow Indicator + Duplicate on Second Minimize

### Problem
After first minimize→restore cycle, Manager shows yellow indicator (pending state). User clicks yellow entry → Quick Tab restores. User minimizes again → Manager stays yellow. User clicks again → **duplicate Quick Tab window appears**.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleMinimize()` lines 509-577, `handleRestore()` lines 817-893  
**Issue:** Storage write race prevents Manager from receiving confirmation. Second restore creates new window while original still exists hidden.

**Cascade:**
1. User minimizes → `handleMinimize()` removes DOM, queues storage write (200ms debounce)
2. **Before persist completes**, other tab writes empty state
3. Storage goes to 0 tabs → Manager sees state cleared → shows yellow indicator
4. User clicks restore → Manager sends `RESTORE_QUICK_TAB` message
5. Restore creates NEW window but storage inconsistent → yellow persists
6. Second minimize attempt: DOM removed but storage write fails (race) → Manager never receives confirmation
7. User clicks yellow entry again → **second restore creates duplicate window**

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_handleRestoreOperation()` lines 1613-1667  
**Issue:** Deletes from `renderedTabs` Map before restore to force fresh render path, but doesn't verify orphaned window was properly cleaned up.

**File:** `src/features/quick-tabs/window.js`  
**Location:** `render()` line 176, `minimize()` line 673  
**Issue:** `minimize()` removes DOM and sets `this.container = null`, but if instance is still referenced somewhere, it persists hidden. Second restore creates fresh instance → duplicate.

### Fix Required

1. **VisibilityHandler:** Ensure atomic storage writes with per-tab keys (fixes race condition)
2. **UICoordinator:** Verify orphaned windows are fully destroyed before creating new instance
3. **Window.js:** Add duplicate prevention check before `document.body.appendChild()`

Follow pattern in `DestroyHandler.js` lines 90-124 for coordinated cleanup with verification steps.

---

## Issue #3: Position/Size Updates Stop After Restore

### Problem
After restoring minimized Quick Tab, drag and resize operations no longer persist to storage. Quick Tab window moves/resizes visually but Manager doesn't update, and position/size revert after page reload.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `render()` method, specifically `_setupDragController()` lines 380-395  
**Issue:** DragController stores element reference at construction time. When `minimize()` removes DOM and `restore()` triggers re-render via `UICoordinator.render()`, a **fresh container element** is created. DragController still references the **old, detached element**. Events fire on new element but listeners are attached to old element.

**Evidence from logs:**
```
BEFORE minimize:
[QuickTabWindow] Drag ended: qt-629-... 904 377
[UpdateHandler] handlePositionChangeEnd called
[UpdateHandler] Updated tab position in Map

AFTER restore:
<NO DRAG LOGS AT ALL>
```

**File:** `src/features/quick-tabs/window/DragController.js` (need to verify)  
**Location:** Constructor and event listener attachment  
**Issue:** Element reference likely stored as `this.element` in constructor and never updated when parent calls `render()` again.

### Fix Required

Implement **element reference update** on re-render:
- When `render()` is called on existing instance, update DragController and ResizeController element references
- OR use **event delegation** pattern: attach listeners to `document.body` with target filtering instead of direct element listeners
- Verify element is connected to DOM before invoking callbacks

**Reference:** Mozilla MDN on event delegation pattern for dynamically created elements. Event delegation on stable parent (document.body) ensures listeners survive element removal/re-addition.

---

## Issue #4: Restored Quick Tab Appears Behind New Tabs

### Problem
After restoring minimized Quick Tab, it appears visually **behind** Quick Tabs created after the restore, despite having numerically higher z-index value.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_executeRestore()` lines 920-950  
**Issue:** Z-index is incremented correctly (`this.currentZIndex.value++`), but **CSS stacking context** or **DOM insertion order** prevents visual front-bringing.

**Evidence from logs:**
```
Original creation:
qt-629-1764808032503 - zIndex: 1000001
qt-629-1764808034242 - zIndex: 1000003

After minimize + restore:
qt-629-1764808034242 - zIndex: 1000016  <-- HIGHER but visually behind
```

**Possible causes:**
1. **DOM insertion order:** Restored element appended last to document.body but in different stacking context
2. **CSS properties:** Parent container has `transform`, `filter`, or `opacity` creating new stacking context
3. **Focus logic:** `onFocus()` callback not bringing window visually forward despite z-index

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_applyZIndexAfterRestore()` lines 1311-1324  
**Issue:** Z-index set on container style but may not take effect if container is in isolated stacking context.

### Fix Required

Verify and fix stacking context:
- Check if Quick Tab containers have CSS properties that create stacking contexts
- Ensure restored window gets explicit `container.style.zIndex` update
- Add visual z-index verification after restore (not just numeric check)
- Consider using `Element.requestFullscreen()` or `focus()` API to force visual front-bringing

**Reference:** MDN documentation on CSS stacking contexts and z-index behavior with positioned elements.

---

## Issue #5: Continuous "Last Sync" Updates Every 3-7 Seconds

### Problem
Background script logs show "Last Sync" timestamp updating every 3-7 seconds indefinitely, indicating continuous storage write cycles even when no user actions are occurring.

### Root Cause

**File:** Multiple content scripts + background script  
**Location:** Storage write loop architecture  
**Issue:** Storage thrash loop where Tab 629 writes state, other tabs overwrite with empty state, Tab 629 detects mismatch and re-writes, repeating indefinitely.

**Loop timeline:**
```
T+0ms:    Tab 629 restores Quick Tab → writes {tabs: 2}
T+50ms:   Tab 641 sees change → writes {tabs: 0}
T+100ms:  Background rejects (cooldown) but cache stays at 2
T+3000ms: Tab 629 sees mismatch (cache=2, storage=0) → triggers persist
T+3050ms: GOTO start of loop
```

**Evidence from logs:**
```
[Background] │ tabs: 2 → 0
[Background] │ ⚠️ WARNING: Tab count dropped from 2 to 0!
[Background] Cooldown rejection

<3 seconds later>

[Background] │ tabs: 0 → 2
[VisibilityHandler] Storage write STARTED
```

### Fix Required

Eliminate storage thrash with per-tab keys:
- Each tab writes only to its own key → no overwrites
- Background aggregates state from all tab keys for telemetry
- Storage writes only happen on actual Quick Tab operations, not storage.onChanged reactions
- Optional: Add `writingTabId` field and ignore storage changes from other tabs as interim fix

---

## Issue #6: "Clear Quick Tab Storage" Doesn't Clear Manager

### Problem
Using "Clear Quick Tab Storage" button in settings clears storage but Manager sidebar still shows Quick Tab entries. Reopening Manager sometimes clears bugged entries but not always.

### Root Cause

**File:** `src/background/background.js`  
**Location:** `RESET_GLOBAL_QUICK_TAB_STATE` message handler  
**Issue:** Background clears storage and broadcasts `QUICK_TABS_CLEARED` message, but other tabs' storage listeners re-populate storage immediately.

**Cascade:**
1. Background clears storage → `{tabs: []}`
2. Message sent to ALL 406 tabs
3. Tab 629 receives message → clears local QuickTabsMap
4. **Tab 641, 650, etc.** still have storage listeners active
5. They see storage change (empty state), trigger validation/rebuild logic
6. If they had Quick Tabs (unlikely), they write them back
7. Manager sidebar listening to storage sees tabs reappear

**Why reopening Manager sometimes works:**
```javascript
async loadState() {
  const tabs = state.quick_tabs_state_v2?.tabs || [];
  const validTabs = tabs.filter(tab => {
    return tab.url && tab.id && !tab.corrupted;
  });
  this.render(validTabs);
}
```
Invalid entries (missing URL, undefined fields) filtered out on fresh load.

### Fix Required

Coordinate "Clear All" using Web Locks API:
- Background acquires exclusive lock before clearing
- All tabs check for lock before writing to storage
- If lock held, defer write until released
- Ensures atomic clear operation without re-population

**Reference:** W3C Web Locks API specification for cross-tab resource coordination.

---

## Issue #7: Duplicate Quick Tab Windows Can Appear Simultaneously

### Problem
Under certain conditions (rapid restore clicks, storage race conditions), multiple Quick Tab windows with the same ID can exist on screen simultaneously.

### Root Cause

**File:** `src/features/quick-tabs/window.js`  
**Location:** `_createContainer()` lines 250-275  
**Issue:** **CRITICAL - Missing `__quickTabWindow` property assignment**. The container element is created but never has its instance reference stored.

**Evidence:** UICoordinator has orphan recovery mechanism in `_tryRecoverWindowFromDOM()`:
```javascript
_tryRecoverWindowFromDOM(domElement, quickTab) {
  const recoveredWindow = domElement.__quickTabWindow; // ALWAYS undefined!
  
  if (recoveredWindow && typeof recoveredWindow.isRendered === 'function') {
    // This code NEVER executes
    recoveredWindow.restore();
    this.renderedTabs.set(quickTab.id, recoveredWindow);
    return recoveredWindow;
  }
  
  return null; // Always returns null → orphan removed instead of recovered
}
```

**File:** `src/features/quick-tabs/coordinators/UICoordinator.js`  
**Location:** `_handleOrphanedDOMElement()` lines 642-658  
**Issue:** When orphan recovery fails (because `__quickTabWindow` is undefined), orphaned element is removed. But if removal hasn't completed before new instance is created, **duplicate briefly exists**.

### Fix Required

1. **Add `__quickTabWindow` property in window.js:**
   - After creating container element, assign `this.container.__quickTabWindow = this`
   - This enables UICoordinator orphan recovery to work correctly

2. **Add pre-render duplicate check in UICoordinator:**
   - Before creating new window, scan document for existing `[data-quicktab-id="${id}"]`
   - If found, attempt recovery via `__quickTabWindow` property
   - If recovery fails, BLOCK creation and log error (don't create duplicate)

3. **Add MutationObserver for real-time detection:**
   - Observe `document.body` with `childList: true`
   - When `.quick-tab-window` added, check if duplicate ID exists
   - If duplicate detected, remove the newer instance immediately

**Reference:** Mozilla MDN MutationObserver API guide, WeakMap for DOM-instance tracking patterns.

---

## Missing Logging Identified

### 1. Storage onChanged Listener in Content Scripts

**File:** `src/features/quick-tabs/index.js`  
**Location:** QuickTabsManager initialization  
**Missing:** Storage change event logging

**What's needed:**
```
Track which tabs are reacting to storage changes, when empty writes happen, 
and correlate storage changes with UI operations
```

**Impact:** Can't diagnose which tabs are causing storage corruption, can't see timing of race conditions.

---

### 2. DragController Event Verification After Restore

**File:** `src/features/quick-tabs/window/DragController.js`  
**Location:** Event handler methods  
**Missing:** Event firing confirmation and element validity checks

**What's needed:**
```
Log when mousedown/pointermove events fire, verify element is in DOM, 
confirm element reference matches event target
```

**Impact:** Can't confirm if events firing at all vs. listeners not attached vs. attached to wrong element.

---

### 3. Manager Sidebar State Tracking

**File:** Manager sidebar panel code (path TBD)  
**Location:** State update methods  
**Missing:** Manager's view of Quick Tab state

**What's needed:**
```
Log listed tabs with their ID, minimized status, and indicator color whenever 
Manager updates state from storage or broadcast events
```

**Impact:** Can't debug yellow indicator issue, can't track when Manager updates vs. when it should update.

---

### 4. UpdateHandler Hash Computation Logging

**File:** `src/features/quick-tabs/handlers/UpdateHandler.js`  
**Location:** Hash computation methods  
**Missing:** Hash value calculation and comparison logging

**What's needed:**
```
Log position/size values being hashed, resulting hash values (high and low), 
and hash comparison results (match vs. mismatch) for each update operation
```

**Impact:** Can't verify if position/size values actually changing, can't debug "hash match, skipping write" decisions.

---

## Shared Implementation Notes

**Per-Tab Storage Architecture:**
- All tabs write to `quick_tabs_tab_${tabId}` keys instead of shared `quick_tabs_state_v2`
- Manager aggregates by reading all `quick_tabs_tab_*` keys
- Background telemetry aggregates from all tab keys
- Eliminates ALL cross-tab write conflicts by namespace isolation

**Duplicate Prevention Pattern:**
- Set `container.__quickTabWindow = this` immediately after element creation
- Query DOM for `[data-quicktab-id]` before creating new instance
- Use MutationObserver on document.body for real-time duplicate detection
- Removal priority: newer instance if duplicates detected

**Event Listener Attachment:**
- Use event delegation on `document.body` with target filtering
- OR update DragController/ResizeController element references when `render()` called on existing instance
- Verify `element.isConnected` before invoking callbacks

**Storage Write Coordination:**
- Optional: Use Web Locks API (`navigator.locks.request()`) for atomic operations
- All debounced writes must check if lock available before proceeding
- "Clear All" operation acquires exclusive lock

<acceptancecriteria>
**Issue #1:**
- Quick Tabs only render in their origin tab (cross-tab blocking enforced)
- Storage writes isolated per tab (no overwrites from other tabs)
- Manager can aggregate Quick Tabs from all tabs

**Issue #2:**
- Minimize persists to storage immediately (no race with other tabs)
- Manager indicator updates to yellow within 200ms
- Second minimize doesn't create duplicate window
- Orphaned windows recovered instead of removed

**Issue #3:**
- Drag operations persist after restore
- Resize operations persist after restore
- UpdateHandler receives callbacks for all position/size changes
- Events logged for every drag/resize operation

**Issue #4:**
- Restored Quick Tab appears visually in front
- Z-index value AND visual stacking order match
- Focus brings window to front reliably

**Issue #5:**
- No storage writes when no user actions occurring
- "Last Sync" timestamp only updates during actual operations
- Background script not in continuous write loop

**Issue #6:**
- "Clear Quick Tab Storage" removes all Quick Tabs
- Manager shows zero entries after clear
- Other tabs don't re-populate storage after clear
- Clear operation is atomic (lock-protected)

**Issue #7:**
- Only one Quick Tab window per ID can exist in DOM
- Orphaned windows recovered via `__quickTabWindow` property
- MutationObserver blocks duplicate creation attempts
- Pre-render check prevents duplicate creation

**All Issues:**
- All existing tests pass
- No new console errors or warnings
- Manual test: create, minimize, restore, drag, resize, reload → all operations work correctly
- Storage inspection shows only per-tab keys, no shared key conflicts
</acceptancecriteria>

---

## Supporting Context

<details>
<summary>Architecture Background - Storage Coordination</summary>

**v1.6.3 Removed Cross-Tab Sync Infrastructure:**
- Previous version had `BroadcastChannel` for instant cross-tab updates
- Storage was used for persistence only, not primary sync mechanism
- When cross-tab sync was removed, storage became the ONLY coordination point
- But no write coordination was added → multiple instances thrash storage

**Current Storage Flow:**
```
Tab creates Quick Tab → writes to storage
  ↓
storage.onChanged fires in ALL tabs
  ↓
All tabs rebuild state from storage
  ↓
All tabs write their rebuilt state
  ↓
Last write wins (random winner)
```

**Per-Tab Keys Solution:**
```
Tab creates Quick Tab → writes to quick_tabs_tab_${tabId}
  ↓
storage.onChanged fires in ALL tabs (different keys)
  ↓
Each tab only reads its own key
  ↓
Manager aggregates from all keys
  ↓
Zero write conflicts
```

</details>

<details>
<summary>Duplicate Prevention - Technical Details</summary>

**Why `__quickTabWindow` Property is Critical:**

DOM elements can have arbitrary properties assigned in JavaScript. This pattern allows "reverse lookup" from DOM → instance without WeakMaps:

```
Element created → instance reference stored on element
Element found in DOM → retrieve instance via property
Instance recovered → re-add to Map without re-creating
```

**Without this property:**
- UICoordinator finds orphaned element but can't recover instance
- Only option is to remove orphan and create fresh instance
- If removal not immediate, both old and new exist → duplicate

**MutationObserver Pattern:**

Watches document.body for child additions. When Quick Tab window added:
1. Check if another element with same `data-quicktab-id` exists
2. If yes, determine which is "correct" (in Map vs. orphan)
3. Remove incorrect one immediately
4. Prevents duplicates from persisting even 1 frame

</details>

<details>
<summary>Event Delegation Pattern</summary>

**Current Approach (Broken After Restore):**
```
DragController stores element reference at construction
Element removed during minimize
New element created during restore
Old element still has listeners but detached from DOM
New element has no listeners
```

**Event Delegation Approach (Survives Restore):**
```
Attach ONE listener to document.body (stable, never removed)
When mousedown fires, check if target matches .quick-tab-window
If match, find instance from Map via data-quicktab-id
Delegate to instance's drag handler
```

**Tradeoff:**
- Event delegation: Slightly more CPU (target checking on every mousedown)
- Direct listeners: Slightly more memory (listener per window)
- For Quick Tabs use case, event delegation is better (few windows, restore operations common)

</details>

---

**Priority:** Critical (Issues #2, #3, #7), High (Issues #4, #6), Medium (Issues #1, #5)  
**Target:** Fix all in coordinated PR  
**Estimated Complexity:** High (requires architecture changes, not just bug fixes)